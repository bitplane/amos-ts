/**
 * DME 2.0 batch 1 — the ProTracker block, and why `Nop` is not a keyword.
 *
 * The module these run against is built here rather than taken from the
 * corpus, because what is being checked is DME's own layer: the tag test at
 * $438, the "Tracker " bank, the read-and-clear readers and the two ranges.
 * ../amiga/protracker.ts is what plays it and has its own tests.
 */
import { describe, expect, it } from 'vitest'
import { mustFinish } from '../testing/run'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { extensionById } from '../ext/registry'
import { AmigaFS } from '../amiga/vfs'
import { NullAudio } from '../amiga/paula'
import { Runtime } from './runtime'
import { DME_ERRORS, PTM_BANK_NAME, PTM_SONG_LENGTH_AT, PTM_TAG_AT } from './dme'

const table = new TokenTable(CORE_TOKENS)
/**
 * Slot 15, off routine 0's `move.l d0,$1d8(a5)` and `moveq #$e,d0`. The row
 * had only a 1997 web page for it before the binary was read.
 */
const dme = extensionById('dme-2.0')!

/**
 * The smallest thing `Ptm Load` will accept: 31 instruments, one pattern, one
 * position, and a four-byte tag at $438.
 */
function mod(tag = 'M.K.', positions = 4): Uint8Array {
  const out = new Uint8Array(0x43c + 1024 + 2)
  for (let i = 0; i < 20; i++) out[i] = 0x20 // the title
  // 31 sample headers of 30 bytes from offset 20, all zero length
  out[PTM_SONG_LENGTH_AT] = positions // $3b6, the song length
  out[PTM_SONG_LENGTH_AT + 1] = 0x7f // the restart byte
  for (let i = 0; i < positions; i++) out[PTM_SONG_LENGTH_AT + 2 + i] = 0
  for (let i = 0; i < 4; i++) out[PTM_TAG_AT + i] = tag.charCodeAt(i)
  return out
}

let printed = ''

function run(src: string[], files: Record<string, Uint8Array> = {}): { rt: Runtime; audio: NullAudio } {
  const exts = new Map([[15, dme.table]])
  const fs = new AmigaFS()
  const vol = fs.mountMemory('Work')
  for (const [name, bytes] of Object.entries(files)) vol.write([name], bytes)
  fs.currentDir = 'Work:'
  printed = ''
  const audio = new NullAudio()
  const rt = new Runtime(tokenize(src.join('\n'), table, exts), table, {
    extensions: exts,
    extBindings: new Map([[15, dme]]),
    maxSteps: 500_000,
    onText: (t) => (printed += t),
    audio,
    fs,
  })
  mustFinish(rt.runHeadless(2000))
  return { rt, audio }
}

const out = (): string[] => printed.trim().split('\n').map((s) => s.trim())

const MOD = { 'a.mod': mod() }
const LOAD = 'Ptm Load "Work:a.mod",5'

describe('Ptm Load — routine 281', () => {
  it('reserves a Work bank named "Tracker ", which is what Ptm Play insists on', () => {
    const { rt } = run([LOAD], MOD)
    const b = rt.memBanks.get(5)!
    expect(b.name.padEnd(8).slice(0, 8)).toBe(PTM_BANK_NAME)
    // the file rounded up to even, plus eight ($7810-$781a)
    expect(b.data.length).toBe(mod().length + 8)
  })

  it('accepts M.K., M!K! and FLT4 and nothing else', () => {
    for (const tag of ['M.K.', 'M!K!', 'FLT4']) {
      expect(() => run([LOAD], { 'a.mod': mod(tag) })).not.toThrow()
    }
    // `6CHN` is a real ProTracker variant and this refuses it, because the
    // three `cmpi.l` at $784c-$7860 are the whole test
    expect(() => run([LOAD], { 'a.mod': mod('6CHN') })).toThrow(DME_ERRORS[0])
  })

  it('erases the bank again when the tag is wrong, so a failed load leaves nothing', () => {
    // `L_Bnk_Eff` at $7876, before the error
    const rt = new Runtime(tokenize('', table), table, {})
    void rt
    let caught = false
    try {
      run([LOAD, 'Print Length(5)'], { 'a.mod': mod('6CHN') })
    } catch {
      caught = true
    }
    expect(caught).toBe(true)
  })

  it('a bank number at or past 65,536 is AMOS error 23', () => {
    // `cmp.l #$10000,d3 / Rbge routine 92`, and the bank pops FIRST
    expect(() => run(['Ptm Load "Work:a.mod",65536'], MOD)).toThrow()
  })

  it('reloading the bank that is playing stops it; reloading another does not', () => {
    // `cmp.w $122(a2),d3` AND `tst.b $128(a2)` --- both, at $77ee
    const a = run([LOAD, 'Ptm Play 5', LOAD, 'Print Ptm Song Pos'], MOD)
    void a
    expect(out()).toEqual(['0'])
    const b = run([LOAD, 'Ptm Play 5', 'Ptm Load "Work:a.mod",6', 'Print Ptm Song Pos'], MOD)
    expect(b.rt.dme.ptmPlaying).toBe(true)
  })
})

describe('Ptm Play — routine 284, which branches into 285', () => {
  it('refuses a bank that is not a "Tracker " one', () => {
    expect(() => run(['Reserve As Work 5,2048', 'Ptm Play 5'], MOD)).toThrow(DME_ERRORS[0])
  })

  it('$80000000 means the bank Ptm Load last used, which is the only read of $122', () => {
    // routine 284 pushes the same constant as the play parameter, and the
    // body then compares the program's argument against it ($7900)
    const { rt } = run([LOAD, 'Ptm Play -2147483648'], MOD)
    expect(rt.dme.ptmPlaying).toBe(true)
    expect(rt.dme.ptmBank).toBe(5)
  })

  it('sets 125 bpm whatever the module said (`move.w #$7d,$0(a0)`)', () => {
    const { rt } = run([LOAD, 'Ptm Play 5'], MOD)
    expect(rt.dme.ptm.bpm).toBe(0x7d)
  })

  it('Ptm Stop stops and Ptm Cont resumes without restarting', () => {
    // `tst.b $128(a2) / bne` --- a second Cont cannot restart anything
    const { rt } = run([LOAD, 'Ptm Play 5', 'Ptm Stop', 'Ptm Cont', 'Ptm Cont'], MOD)
    expect(rt.dme.ptmPlaying).toBe(true)
  })

  it('Ptm Cont before anything has played does nothing', () => {
    const { rt } = run(['Ptm Cont'], MOD)
    expect(rt.dme.ptmPlaying).toBe(false)
  })
})

describe('the ranges, which are checked twice each', () => {
  it('Ptm Volume takes 0..64 and refuses either side', () => {
    // `Rbmi routine 92` and `cmp.l #$40,d7 / Rbhi`
    const { rt } = run([LOAD, 'Ptm Play 5', 'Ptm Volume 32'], MOD)
    expect(rt.dme.ptm.master).toBe(32)
    expect(() => run([LOAD, 'Ptm Play 5', 'Ptm Volume -1'], MOD)).toThrow()
    expect(() => run([LOAD, 'Ptm Play 5', 'Ptm Volume 65'], MOD)).toThrow()
  })

  it('Ptm Cia Speed takes 32..255, which is the extension\'s only CIA keyword', () => {
    // `cmp.l #$1f,d7 / Rbls` and `cmp.l #$ff,d7 / Rbhi`
    const { rt } = run([LOAD, 'Ptm Play 5', 'Ptm Cia Speed 200'], MOD)
    expect(rt.dme.ptm.bpm).toBe(200)
    expect(() => run([LOAD, 'Ptm Play 5', 'Ptm Cia Speed 31'], MOD)).toThrow()
    expect(() => run([LOAD, 'Ptm Play 5', 'Ptm Cia Speed 256'], MOD)).toThrow()
  })

  it('Ptm Vu is bounded to 0..3', () => {
    expect(() => run([LOAD, 'Ptm Play 5', 'Print Ptm Vu(4)'], MOD)).toThrow()
    expect(() => run([LOAD, 'Ptm Play 5', 'Print Ptm Vu(-1)'], MOD)).toThrow()
  })
})

describe('the readers', () => {
  it('answer zero before the first Ptm Play rather than raising', () => {
    // `tst.b $129(a2) / beq` on both, at $7a5e and $7a7e
    run([LOAD, 'Print Ptm Song Pos', 'Print Ptm Patt Pos'], MOD)
    expect(out()).toEqual(['0', '0'])
  })

  it('=Ptm Song Length reads the BANK, so it works on a module never played', () => {
    // routine 290 checks the "Tracker " name and reads $3b6
    run([LOAD, 'Print Ptm Song Length(5)'], MOD)
    expect(out()).toEqual(['4'])
    expect(() => run(['Reserve As Work 5,2048', 'Print Ptm Song Length(5)'], MOD)).toThrow(DME_ERRORS[0])
  })

  it('=Ptm Vu is read AND CLEARED, so a second read without a trigger is zero', () => {
    // `move.b $a(a0,d7.w),d3` then `clr.b` on the same byte ($7aba)
    const { rt } = run([LOAD, 'Ptm Play 5'], MOD)
    rt.dme.ptmVu[1] = 40
    expect(rt.dme.ptmVu[1]).toBe(40)
    run([LOAD, 'Ptm Play 5', 'Print Ptm Vu(1)', 'Print Ptm Vu(1)'], MOD)
    expect(out()).toEqual(['0', '0'])
  })

  it('=Ptm End is read and cleared, where THX 0.6\'s Thx End latches', () => {
    // `cmpi.w #$ff,$e(a0)` then `clr.w $e(a0)` ($7b7a). The same question
    // asked of two formats in one extension has two answers
    const { rt } = run([LOAD, 'Ptm Play 5'], MOD)
    rt.dme.ptmEnd = true
    const first = rt.dme.ptmEnd
    expect(first).toBe(true)
    run([LOAD, 'Ptm Play 5', 'Print Ptm End'], MOD)
    expect(out()).toEqual(['0'])
  })
})

describe('Ptm Voice — routine 287', () => {
  it('the low four bits say which voices the music may use', () => {
    const { rt } = run([LOAD, 'Ptm Play 5', 'Ptm Voice 5'], MOD)
    expect(rt.dme.ptmVoices).toBe(0b0101)
    expect(rt.dme.ptm.voices).toBe(0b0101)
  })

  it('a cleared bit silences that voice through AUDxVOL', () => {
    const { audio } = run([LOAD, 'Ptm Play 5', 'Ptm Voice 0'], MOD)
    // four `clr.w $a8/$b8/$c8/$d8(a2)` off $dff000, one per off bit
    expect(audio.voiceState[0]!.volume).toBe(0)
    expect(audio.voiceState[3]!.volume).toBe(0)
  })
})

describe('Nop is padding, and it does not parse', () => {
  it('is n/a: thirty-seven rows, thirty-seven routines, every one an rts', () => {
    // and the spec is "0" with the function routine -1, so AMOS reads `Nop`
    // as a FUNCTION and jumps through a null vector --- `S Mask$`'s shape.
    // No handler is registered, which is what this asserts
    const impl = dme.table
    const rows = impl.entries.filter((e) => e.name.replace(/^!/, '').trim() === 'nop')
    expect(rows.length).toBe(37)
    // every row carries an instruction routine and no function routine
    for (const r of rows) expect(r.func).toBe(0xffff)
    // and they are all different routines: one spare slot per format block
    expect(new Set(rows.map((r) => r.instr)).size).toBe(37)
  })
})

describe('Ptm Next Patt and Ptm Prev Patt — routines 294 and 295', () => {
  it('step the song position without stopping', () => {
    // $7ac8 and $7b16; the module here has four positions
    const { rt } = run([LOAD, 'Ptm Play 5', 'Ptm Next Patt', 'Ptm Next Patt'], MOD)
    expect(rt.dme.ptm.pos).toBe(2)
    expect(rt.dme.ptmPlaying).toBe(true)
    const back = run([LOAD, 'Ptm Play 5', 'Ptm Next Patt', 'Ptm Prev Patt'], MOD)
    expect(back.rt.dme.ptm.pos).toBe(0)
  })

  it('and do nothing at all before a module has been played', () => {
    expect(() => run(['Ptm Next Patt', 'Ptm Prev Patt'], MOD)).not.toThrow()
  })
})
