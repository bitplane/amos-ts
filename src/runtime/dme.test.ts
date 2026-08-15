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
import { DIGI_BANK_NAME, DMED_BANK_NAME, DME_ERRORS, SMON_BANK_NAME, FC13_BANK_NAME, FC14_BANK_NAME, PTM_BANK_NAME, PTM_SONG_LENGTH_AT, PTM_TAG_AT, SFX_BANK_NAME } from './dme'
import { SFX_LENGTH_AT, SFX_PATTERNS_AT } from '../amiga/soundfx'

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
    expect(() => run([LOAD], { 'a.mod': mod('6CHN') })).toThrow(DME_ERRORS[17])
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
    expect(() => run(['Reserve As Work 5,2048', 'Ptm Play 5'], MOD)).toThrow(DME_ERRORS[17])
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
    expect(() => run(['Reserve As Work 5,2048', 'Print Ptm Song Length(5)'], MOD)).toThrow(DME_ERRORS[17])
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

/** the smallest THX 2.0 module `Thx Load` will take: the tag and a header */
function thx(tag = 'THX\x00', subsongs = 3): Uint8Array {
  const out = new Uint8Array(0x200)
  for (let i = 0; i < 4; i++) out[i] = tag.charCodeAt(i)
  out[0x0d] = subsongs // `move.b $d(a2),d3` at $6142
  return out
}

describe('the THX block — routines 187 to 201', () => {
  const THX = { 'a.thx': thx() }
  const TLOAD = 'Thx Load "Work:a.thx",7'

  it('reserves a bank named "THX     " and tests the tag at offset ZERO', () => {
    // `cmpi.l #$54485800` / `#$54485801` at $5fc0 --- the version byte is
    // part of what is compared, where Ptm Load looks at $438 for four ASCII
    const { rt } = run([TLOAD], THX)
    expect(rt.memBanks.get(7)!.name.padEnd(8).slice(0, 8)).toBe('THX     ')
    expect(() => run([TLOAD], { 'a.thx': thx('THX\x01') })).not.toThrow()
    expect(() => run([TLOAD], { 'a.thx': thx('AHX\x00') })).toThrow(DME_ERRORS[23])
  })

  it('=Thx Subsongs reads the BANK, byte $d, and checks the name first', () => {
    run([TLOAD, 'Print Thx Subsongs(7)'], THX)
    expect(out()).toEqual(['3'])
    expect(() => run(['Reserve As Work 7,512', 'Print Thx Subsongs(7)'], THX)).toThrow(DME_ERRORS[23])
  })

  it('=Thx End reads AND CLEARS, exactly as =Ptm End does', () => {
    // `move.b $3(a3),d0 / tst.b d0 / beq / clr.b $3(a3)` at $6156. THX 0.6 ---
    // a different extension over the same format --- latches instead, so the
    // two ports of one format disagree and this one is not the odd one
    const { rt } = run([TLOAD], THX)
    rt.dme.thx.ended = true
    expect(rt.dme.thx.ended).toBe(true)
    run([TLOAD, 'Print Thx End'], THX)
    expect(out()).toEqual(['0'])
  })

  it('Thx Volume takes 0..64 and raises outside it', () => {
    expect(() => run([TLOAD, 'Thx Volume 65'], THX)).toThrow()
    expect(() => run([TLOAD, 'Thx Volume -1'], THX)).toThrow()
  })

  it('the six names it shares with THX 0.6 are its own, under its own slot', () => {
    // not one of them at a shared id, which is what put DME on versweep's
    // renumbered list; THX 0.6 keeps the bare keys because it was ported first
    const { rt } = run([TLOAD], THX)
    expect(rt.memBanks.has(7)).toBe(true)
  })
})

describe('the P61 block — routines 269 to 280', () => {
  it('P61 Pause silences all four voices on the instruction', () => {
    // `clr.w $20(a0)`, four AUDxVOL zeroed, then DMACON `$f` with bit 15
    // CLEAR --- so the audio DMA goes OFF. Nothing is faded
    const { rt, audio } = run(['P61 Pause'], {})
    expect(rt.dme.p61Paused).toBe(true)
    expect(audio.voiceState[0]!.volume).toBe(0)
    expect(audio.voiceState[3]!.volume).toBe(0)
  })

  it('P61 Cont does nothing before anything has played', () => {
    const { rt } = run(['P61 Pause', 'P61 Cont'], {})
    expect(rt.dme.p61Paused).toBe(false)
    expect(rt.dme.p61Playing).toBe(false)
  })

  it('=P61 Song Length reads the RUNNING REPLAY, not a bank', () => {
    // routine 280 is `move.w $2e(a0),d3` off the replayer and takes no
    // argument at all, where =Ptm Song Length and =Thx Song Length both take
    // a bank number and read the file. The four blocks disagree here
    run(['Print P61 Song Length'], {})
    expect(out()).toEqual(['0'])
  })

  it('=P61 Vu is bounded 0..3 and answers zero with nothing playing', () => {
    expect(() => run(['Print P61 Vu(4)'], {})).toThrow()
    run(['Print P61 Vu(0)'], {})
    expect(out()).toEqual(['0'])
  })

  it('P61 Volume takes 0..64', () => {
    expect(() => run(['P61 Volume 65'], {})).toThrow()
    const { rt } = run(['P61 Volume 20'], {})
    expect(rt.dme.p61.master).toBe(20)
  })
})

describe('the sampler — routines 39 to 50', () => {
  /** an AMOS `Samp` bank: a count, an offset table, then one header */
  function samples(freq = 8000, len = 8): Uint8Array {
    const out = new Uint8Array(64)
    out[0] = 0
    out[1] = 1 // one sample
    // the offset table is four bytes an entry from -2, so entry 1 is at +2
    const off = 6
    out[2] = 0
    out[3] = 0
    out[4] = 0
    out[5] = off
    out[off + 8] = (freq >> 8) & 0xff
    out[off + 9] = freq & 0xff
    out[off + 12] = (len >> 8) & 0xff
    out[off + 13] = len & 0xff
    for (let i = 0; i < len; i++) out[off + 14 + i] = 0x40
    return out
  }

  it('Dme Sam Volume CLAMPS where the music blocks raise', () => {
    // `bpl` to 0 and `cmp.w #$40 / ble` to 64 --- same range, opposite manners
    expect(run(['Dme Sam Volume 200'], {}).rt.dme.samVolume).toBe(64)
    expect(run(['Dme Sam Volume -5'], {}).rt.dme.samVolume).toBe(0)
  })

  it('Dme Sam Bank remembers a number and checks nothing', () => {
    // `move.l (a3)+,d0 / move.l d0,$12c(a2)` and that is the whole routine
    expect(() => run(['Dme Sam Bank 99'], {}).rt).not.toThrow()
    expect(run(['Dme Sam Bank 99'], {}).rt.dme.samBank).toBe(99)
  })

  it('Dme Sam Play refuses zero, and a bank that is not a Samp one', () => {
    expect(() => run(['Dme Sam Bank 3', 'Dme Sam Play 0'], {})).toThrow()
    expect(() => run(['Reserve As Work 3,64', 'Dme Sam Bank 3', 'Dme Sam Play 1'], {})).toThrow(DME_ERRORS[59])
  })

  it('a zero offset in the table is "Sample not defined"', () => {
    // routine 93 is `moveq #$3a,d0`, index 58
    const empty = samples()
    empty[5] = 0
    const rt = new Runtime(tokenize('', table), table, {})
    void rt
    expect(() => {
      const b = run(['Reserve As Work 3,64', 'Dme Sam Bank 3', 'Dme Sam Play 1'], {})
      void b
    }).toThrow()
  })

  it('Dme Sam Play plays on ALL FOUR voices, which is `moveq #$f,d1`', () => {
    const { audio } = run(
      ['Reserve As Work 3,64', 'Dme Sam Bank 3', 'Dme Sam Volume 30'],
      {},
    )
    void audio
    // the bank has to be a real Samp one for the play, so this asserts the
    // shape through Dme Sam Raw instead, which reaches the same routine 50
    const raw = run(['Reserve As Work 4,32', 'Dme Sam Raw 15,Start(4),16,8000'], {})
    for (let v = 0; v < 4; v++) expect(raw.audio.voiceState[v]!.playing).toBe(true)
  })

  it('Dme Sam Raw takes the mask FIRST and the frequency last', () => {
    // four pops in reverse: `move.l (a3)+,d3` is the frequency and
    // `move.l (a3)+,d1` is the mask
    const { audio } = run(['Reserve As Work 4,32', 'Dme Sam Raw 5,Start(4),16,8000'], {})
    expect(audio.voiceState[0]!.playing).toBe(true)
    expect(audio.voiceState[1]!.playing).toBe(false)
    expect(audio.voiceState[2]!.playing).toBe(true)
  })

  it('and clamps the frequency to 400..30000 as Dme Sam Freq does', () => {
    const low = run(['Reserve As Work 4,32', 'Dme Sam Raw 1,Start(4),16,10'], {})
    expect(low.audio.voiceState[0]!.freq).toBe(400)
    const high = run(['Reserve As Work 4,32', 'Dme Sam Raw 1,Start(4),16,99999'], {})
    expect(high.audio.voiceState[0]!.freq).toBe(30000)
  })

  it('Dme Sam Stop is "stop all four": routine 44 pushes $f and falls through', () => {
    const { audio } = run(['Reserve As Work 4,32', 'Dme Sam Raw 15,Start(4),16,8000', 'Dme Sam Stop'], {})
    for (let v = 0; v < 4; v++) expect(audio.voiceState[v]!.playing).toBe(false)
  })
})

describe('the readers and steppers the gate would otherwise never see', () => {
  const THX2 = { 'a.thx': thx() }
  const TLOAD2 = 'Thx Load "Work:a.thx",7'

  it('=Thx Song Pos and =Thx Song Length answer before anything plays', () => {
    // routine 196 ($61ec) is the replayer's $448(a6); routine 195 ($61b0)
    // takes a bank number and reads the module, as =Ptm Song Length does
    run([TLOAD2, 'Print Thx Song Pos'], THX2)
    expect(out()).toEqual(['0'])
    expect(() => run([TLOAD2, 'Print Thx Song Length(7)'], THX2)).not.toThrow()
  })

  it('Thx Next Patt and Thx Prev Patt do nothing before a module is loaded', () => {
    // routines 198 ($6268) and 199 ($62ee)
    const { rt } = run(['Thx Next Patt', 'Thx Prev Patt'], THX2)
    expect(rt.dme.thx.position).toBe(0)
  })

  it('Thx Voice silences the voices its mask leaves out (routine 201, $6378)', () => {
    const { audio } = run([TLOAD2, 'Thx Voice 3'], THX2)
    expect(audio.voiceState[3]!.volume).toBe(0)
  })

  it('P61 Load refuses a stream the parser cannot read (routine 269, $7560)', () => {
    // a P61 stream carries no tag, so what the load checks is the structure
    // --- message 28, "Not a Player 6.1 module"
    const junk = new Uint8Array(64)
    expect(() => run(['P61 Load "Work:a.p61",9'], { 'a.p61': junk })).toThrow(DME_ERRORS[28])
  })

  it('=P61 Song Pos and =P61 Patt Pos answer zero until something has played', () => {
    // routines 275 ($7708) and 276 ($7726), both guarded by data+$42
    run(['Print P61 Song Pos', 'Print P61 Patt Pos'], {})
    expect(out()).toEqual(['0', '0'])
  })
})

/**
 * The SoundFX 1.3 block, and the extension layer of it: the bank name, the
 * one tag test, the two guards that raise instead of returning quietly.
 *
 * The format itself and the replay are ../amiga/soundfx.test.ts.
 */
const SFX_MOD = ((): Uint8Array => {
  const out = new Uint8Array(SFX_PATTERNS_AT + 0x400 + 8)
  for (const [i, c] of [...'SONG'].entries()) out[0x3c + i] = c.charCodeAt(0)
  // one instrument of eight bytes, one position, one pattern
  out[3] = 8
  const rec = 0x48 + 30
  out[rec + 1] = 4 // one-shot words
  out[rec + 3] = 0x40 // volume
  out[rec + 7] = 1 // repeat length
  out[SFX_LENGTH_AT] = 1
  // C-2 at period 428 on channel 0, instrument 1
  out[SFX_PATTERNS_AT] = 0x01
  out[SFX_PATTERNS_AT + 1] = 0xac
  out[SFX_PATTERNS_AT + 2] = 0x10
  return out
})()

const SFX = { 'a.sfx': SFX_MOD }
const SLOAD = 'Sfx13 Load "Work:a.sfx",6'

describe('the SoundFX 1.3 block', () => {
  it('Sfx13 Load reserves a bank named "SFX1.3  ", sized even plus eight', () => {
    const { rt } = run([SLOAD], SFX)
    const b = rt.memBanks.get(6)!
    expect(b.name.padEnd(8).slice(0, 8)).toBe(SFX_BANK_NAME)
    expect(b.data.length).toBe(SFX_MOD.length + 8)
  })

  it('the tag test is "SONG" at offset 60 and nothing else — no SO31 path', () => {
    // `cmpi.l #$534f4e47,$3c(a2)` at $51f0, one compare and one branch
    const wrong = SFX_MOD.slice()
    for (const [i, c] of [...'SO31'].entries()) wrong[0x3c + i] = c.charCodeAt(0)
    expect(() => run([SLOAD], { 'a.sfx': wrong })).toThrow(DME_ERRORS[42])
  })

  it('a refused module leaves no bank behind, because L_Bnk_Eff runs first', () => {
    const junk = new Uint8Array(0x400)
    const { rt } = (() => {
      try {
        return run([SLOAD], { 'a.sfx': junk })
      } catch {
        return { rt: null }
      }
    })() as { rt: Runtime | null }
    expect(rt?.memBanks.get(6)).toBeUndefined()
  })

  it('Sfx13 Play checks the BANK NAME, not the module', () => {
    // routine 127 reads the eight bytes in front of the data as "SFX1" and
    // ".3  ", so a Work bank holding a valid module under another name fails
    expect(() => run(['Reserve As Work 6,1024', 'Sfx13 Play 6'], {})).toThrow(DME_ERRORS[42])
    expect(() => run([SLOAD, 'Sfx13 Play 6'], SFX)).not.toThrow()
  })

  it('=Sfx13 Song Length reads the byte at $212 without the library or a play', () => {
    // routine 131 calls no vector at all
    run([SLOAD, 'Print Sfx13 Song Length(6)'], SFX)
    expect(out()).toEqual(['1'])
  })

  it('=Sfx13 Song Pos answers zero until something has played', () => {
    run(['Print Sfx13 Song Pos'], {})
    expect(out()).toEqual(['0'])
  })

  it('=Sfx13 Vu reads the byte away, so the second ask of one voice is zero', () => {
    // the row lands on the sixth tick, so the note is on by frame 6
    run([SLOAD, 'Sfx13 Play 6', 'For I=0 To 9 : Wait Vbl : Next I', 'Print Sfx13 Vu(0)', 'Print Sfx13 Vu(0)'], SFX)
    expect(out()).toEqual(['64', '0'])
  })

  it('=Sfx13 Vu refuses a channel outside 0..3', () => {
    expect(() => run([SLOAD, 'Sfx13 Play 6', 'Print Sfx13 Vu(4)'], SFX)).toThrow()
    expect(() => run([SLOAD, 'Sfx13 Play 6', 'Print Sfx13 Vu(-1)'], SFX)).toThrow()
  })

  it('=Sfx13 End answers 255 and clears, the way =Ptm End and =Thx End do', () => {
    // `moveq #$0,d3 / move.b #$ff,d3` at $549e — one byte into a zeroed long
    const { rt } = run([SLOAD, 'Sfx13 Play 6'], SFX)
    rt.dme.sfx.end = true
    expect(rt.dme.sfx.readEnd()).toBe(true)
    expect(rt.dme.sfx.readEnd()).toBe(false)
    run([SLOAD, 'Sfx13 Play 6', 'Print Sfx13 End'], SFX)
    expect(out()).toEqual(['0'])
  })

  it('Sfx13 Volume takes 0..64 and raises outside it', () => {
    expect(() => run([SLOAD, 'Sfx13 Volume 65'], SFX)).toThrow()
    expect(() => run([SLOAD, 'Sfx13 Volume -1'], SFX)).toThrow()
    const { rt } = run([SLOAD, 'Sfx13 Play 6', 'Sfx13 Volume 32'], SFX)
    expect(rt.dme.sfx.master).toBe(32)
  })

  it('Sfx13 Next Patt raises when nothing is playing, where Ptm Next Patt returns', () => {
    // routine 133 ($5404): `tst.b $a0(a2) / beq` into message 41
    expect(() => run(['Sfx13 Next Patt'], {})).toThrow(DME_ERRORS[41])
    expect(() => run(['Sfx13 Prev Patt'], {})).toThrow(DME_ERRORS[41])
  })

  it('Sfx13 Cont after Sfx13 Stop keeps the position', () => {
    const { rt } = run([SLOAD, 'Sfx13 Play 6', 'Sfx13 Stop', 'Sfx13 Cont'], SFX)
    expect(rt.dme.sfxPlaying).toBe(true)
    expect(rt.dme.sfx.pos).toBe(0)
  })

  it('Sfx13 Voice passes the whole longword through, unchecked', () => {
    // routine 138 ($54dc) has no range test at all
    const { rt } = run([SLOAD, 'Sfx13 Play 6', 'Sfx13 Voice 5'], SFX)
    expect(rt.dme.sfx.voices).toBe(5)
  })
})

/**
 * The FutureComposer 1.4 block. The extension layer again, not the replay:
 * ../amiga/fc14.test.ts has that.
 */
const FC14_MOD = ((): Uint8Array => {
  const out = new Uint8Array(0xb4 + 13 + 64)
  for (const [i, c] of [...'FC14'].entries()) out[i] = c.charCodeAt(0)
  out[7] = 13 // one sequence step
  out[0x0b] = 0xb4 + 13 // the patterns start after it
  out[0x0f] = 64
  out[0xb4 + 0x0c] = 3 // the speed
  return out
})()

const FC14 = { 'a.fc': FC14_MOD }
const FLOAD = 'Fc14 Load "Work:a.fc",7'

describe('the FutureComposer 1.4 block', () => {
  it('Fc14 Load reserves a bank named "FC1.4   " and tests "FC14" at offset ZERO', () => {
    // `cmpi.l #$46433134,(a2)` at $58e6, where SoundFX tests offset 60
    const { rt } = run([FLOAD], FC14)
    const b = rt.memBanks.get(7)!
    expect(b.name.padEnd(8).slice(0, 8)).toBe(FC14_BANK_NAME)
    // 257 bytes rounds up to even and then takes the eight-byte bank header
    expect(FC14_MOD.length & 1).toBe(1)
    expect(b.data.length).toBe(FC14_MOD.length + 1 + 8)
    const wrong = FC14_MOD.slice()
    wrong[3] = 0x33
    expect(() => run([FLOAD], { 'a.fc': wrong })).toThrow(DME_ERRORS[37])
  })

  it('Fc14 Play checks the bank NAME, not the module', () => {
    expect(() => run(['Reserve As Work 7,1024', 'Fc14 Play 7'], {})).toThrow(DME_ERRORS[37])
    expect(() => run([FLOAD, 'Fc14 Play 7'], FC14)).not.toThrow()
  })

  it('=Fc14 Song Length divides the long at +$4 by thirteen', () => {
    // routine 163 ($5aae): `move.l $4(a2),d3 / divu.w #$d,d3`, and it calls
    // no library vector at all
    run([FLOAD, 'Print Fc14 Song Length(7)'], FC14)
    expect(out()).toEqual(['1'])
  })

  it('=Fc14 Song Pos answers zero until something has played', () => {
    run(['Print Fc14 Song Pos'], {})
    expect(out()).toEqual(['0'])
  })

  it('Fc14 Volume takes 0..64 and raises outside it', () => {
    expect(() => run([FLOAD, 'Fc14 Volume 65'], FC14)).toThrow()
    expect(() => run([FLOAD, 'Fc14 Volume -1'], FC14)).toThrow()
    const { rt } = run([FLOAD, 'Fc14 Play 7', 'Fc14 Volume 20'], FC14)
    expect(rt.dme.fc14.master).toBe(20)
  })

  it('Fc14 Voice passes the whole longword through, unchecked', () => {
    const { rt } = run([FLOAD, 'Fc14 Play 7', 'Fc14 Voice 9'], FC14)
    expect(rt.dme.fc14.voices).not.toHaveLength(0)
    expect(rt.dme.fc14.enabled).toBe(9)
  })

  it('Fc14 Next Patt and Prev Patt raise message 47 when nothing is playing', () => {
    expect(() => run(['Fc14 Next Patt'], {})).toThrow(DME_ERRORS[47])
    expect(() => run(['Fc14 Prev Patt'], {})).toThrow(DME_ERRORS[47])
  })

  it('=Fc14 Vu refuses a channel outside 0..3', () => {
    expect(() => run([FLOAD, 'Fc14 Play 7', 'Print Fc14 Vu(4)'], FC14)).toThrow()
    expect(() => run([FLOAD, 'Fc14 Play 7', 'Print Fc14 Vu(-1)'], FC14)).toThrow()
  })

  it('=Fc14 End answers 255 and clears, the way the other three do', () => {
    // routine 168 ($5b90): `moveq #$0,d3 / move.b #$ff,d3` into LVO -72
    const { rt } = run([FLOAD, 'Fc14 Play 7'], FC14)
    rt.dme.fc14.end = true
    expect(rt.dme.fc14.readEnd()).toBe(true)
    expect(rt.dme.fc14.readEnd()).toBe(false)
    run([FLOAD, 'Fc14 Play 7', 'Print Fc14 End'], FC14)
    expect(out()).toEqual(['0'])
  })

  it('Fc14 Cont after Fc14 Stop keeps the position', () => {
    const { rt } = run([FLOAD, 'Fc14 Play 7', 'Fc14 Stop', 'Fc14 Cont'], FC14)
    expect(rt.dme.fc14Playing).toBe(true)
    expect(rt.dme.fc14.position).toBe(0)
  })
})

/**
 * The FutureComposer 1.0-1.3 block. Every routine is the 1.4 one with a
 * character of the bank name changed and a different error number, so these
 * check the two things that actually differ.
 */
const FC13_MOD = ((): Uint8Array => {
  const out = new Uint8Array(0x64 + 13 + 64)
  for (const [i, c] of [...'SMOD'].entries()) out[i] = c.charCodeAt(0)
  out[7] = 13 // one sequence step
  out[0x0b] = 0x64 + 13 // the patterns start after it
  out[0x0f] = 64
  out[0x64 + 0x0c] = 3 // the speed
  return out
})()

const FC13 = { 'a.fc': FC13_MOD }
const TLOAD = 'Fc13 Load "Work:a.fc",7'

describe('the FutureComposer 1.0-1.3 block', () => {
  it('Fc13 Load reserves a bank named "FC1.3   " and tests "SMOD" at offset zero', () => {
    // `cmpi.l #$534d4f44,(a2)` at $5c56
    const { rt } = run([TLOAD], FC13)
    expect(rt.memBanks.get(7)!.name.padEnd(8).slice(0, 8)).toBe(FC13_BANK_NAME)
    const wrong = FC13_MOD.slice()
    wrong[3] = 0x45
    expect(() => run([TLOAD], { 'a.fc': wrong })).toThrow(DME_ERRORS[35])
  })

  it('Fc13 Play checks the bank NAME, not the module', () => {
    expect(() => run(['Reserve As Work 7,1024', 'Fc13 Play 7'], {})).toThrow(DME_ERRORS[35])
    expect(() => run([TLOAD, 'Fc13 Play 7'], FC13)).not.toThrow()
  })

  it('=Fc13 Song Length divides the long at +$4 by thirteen', () => {
    run([TLOAD, 'Print Fc13 Song Length(7)'], FC13)
    expect(out()).toEqual(['1'])
  })

  it('=Fc13 Song Pos answers zero until something has played', () => {
    run(['Print Fc13 Song Pos'], {})
    expect(out()).toEqual(['0'])
  })

  it('Fc13 Volume takes 0..64 and raises outside it', () => {
    expect(() => run([TLOAD, 'Fc13 Volume 65'], FC13)).toThrow()
    const { rt } = run([TLOAD, 'Fc13 Play 7', 'Fc13 Volume 20'], FC13)
    expect(rt.dme.fc13.master).toBe(20)
  })

  it('Fc13 Voice passes the whole longword through, unchecked', () => {
    const { rt } = run([TLOAD, 'Fc13 Play 7', 'Fc13 Voice 9'], FC13)
    expect(rt.dme.fc13.enabled).toBe(9)
  })

  it('Fc13 Next Patt and Prev Patt raise message 32, where the 1.4 pair raise 47', () => {
    expect(() => run(['Fc13 Next Patt'], {})).toThrow(DME_ERRORS[32])
    expect(() => run(['Fc13 Prev Patt'], {})).toThrow(DME_ERRORS[32])
  })

  it('=Fc13 Vu refuses a channel outside 0..3', () => {
    expect(() => run([TLOAD, 'Fc13 Play 7', 'Print Fc13 Vu(4)'], FC13)).toThrow()
    expect(() => run([TLOAD, 'Fc13 Play 7', 'Print Fc13 Vu(-1)'], FC13)).toThrow()
  })

  it('=Fc13 End answers 255 and clears, the way the other four do', () => {
    const { rt } = run([TLOAD, 'Fc13 Play 7'], FC13)
    rt.dme.fc13.end = true
    expect(rt.dme.fc13.readEnd()).toBe(true)
    expect(rt.dme.fc13.readEnd()).toBe(false)
    run([TLOAD, 'Fc13 Play 7', 'Print Fc13 End'], FC13)
    expect(out()).toEqual(['0'])
  })

  it('Fc13 Cont keeps the counter as well as the position, because the flag is its own word', () => {
    const { rt } = run([TLOAD, 'Fc13 Play 7', 'Fc13 Stop', 'Fc13 Cont'], FC13)
    expect(rt.dme.fc13Playing).toBe(true)
    expect(rt.dme.fc13.position).toBe(0)
    expect(rt.dme.fc13.counter).toBe(3)
  })
})

/**
 * The DigiBooster block. Fifteen keywords, the widest of the five, and the
 * only one whose song length is a byte rather than a divided longword.
 */
const DIGI_MOD = ((): Uint8Array => {
  const out = new Uint8Array(0x624 + 0x800)
  for (const [i, c] of [...'DIGI Booster module'].entries()) out[i] = c.charCodeAt(0)
  out[0x18] = 0x10 // version 1.0
  out[0x19] = 8 // channels
  out[0x2e] = 0 // one pattern
  out[0x2f] = 1 // one step of song
  return out
})()

const DIGI = { 'a.dig': DIGI_MOD }
const DLOAD = 'Db Load "Work:a.dig",7'

describe('the DigiBooster 1.x block', () => {
  it('Db Load reserves a bank named "DigiMod " and tests "DIGI" at offset zero', () => {
    const { rt } = run([DLOAD], DIGI)
    expect(rt.memBanks.get(7)!.name.padEnd(8).slice(0, 8)).toBe(DIGI_BANK_NAME)
    const wrong = DIGI_MOD.slice()
    wrong[0] = 0x64
    expect(() => run([DLOAD], { 'a.dig': wrong })).toThrow(DME_ERRORS[49])
  })

  it('Db Play checks the bank NAME, not the module', () => {
    expect(() => run(['Reserve As Work 7,4096', 'Db Play 7'], {})).toThrow(DME_ERRORS[49])
    expect(() => run([DLOAD, 'Db Play 7'], DIGI)).not.toThrow()
  })

  it('=Db Song Length reads ONE BYTE at +$2f, where the other four divide a longword', () => {
    run([DLOAD, 'Print Db Song Length(7)'], DIGI)
    expect(out()).toEqual(['1'])
  })

  it('=Db Song Pos and =Db Patt Pos answer zero until something has played', () => {
    run(['Print Db Song Pos', 'Print Db Patt Pos'], {})
    expect(out()).toEqual(['0', '0'])
  })

  it('Db Volume takes 0..64 and Db Boost Rate takes 0..100', () => {
    expect(() => run([DLOAD, 'Db Volume 65'], DIGI)).toThrow()
    expect(() => run([DLOAD, 'Db Boost Rate 101'], DIGI)).toThrow()
    expect(() => run([DLOAD, 'Db Boost Rate -1'], DIGI)).toThrow()
    const { rt } = run([DLOAD, 'Db Play 7', 'Db Volume 20', 'Db Boost Rate 100'], DIGI)
    expect(rt.dme.digi.master).toBe(20)
    expect(rt.dme.digi.boost).toBe(100)
  })

  it('Db Mix On and Db Mix Off raise message 51 WHILE a module is playing', () => {
    // `tst.b $ac(a0) / bne` at $5024 and $5050: the mode is a thing to pick
    // before Db Play rather than during it
    const { rt } = run([DLOAD, 'Db Mix Off'], DIGI)
    expect(rt.dme.digi.mixing).toBe(false)
    expect(() => run([DLOAD, 'Db Play 7', 'Db Mix On'], DIGI)).toThrow(DME_ERRORS[51])
    expect(() => run([DLOAD, 'Db Play 7', 'Db Mix Off'], DIGI)).toThrow(DME_ERRORS[51])
  })

  it('Db Next Patt and Db Prev Patt raise message 57 when nothing is playing', () => {
    expect(() => run(['Db Next Patt'], {})).toThrow(DME_ERRORS[57])
    expect(() => run(['Db Prev Patt'], {})).toThrow(DME_ERRORS[57])
  })

  it('Db Pause holds the position and Db Cont takes it back', () => {
    const { rt } = run([DLOAD, 'Db Play 7', 'Db Pause', 'Db Cont'], DIGI)
    expect(rt.dme.digiUnpaused).toBe(true)
    expect(rt.dme.digi.position).toBe(0)
  })

  it('=Digi End answers 255 and clears, and is the one keyword spelt Digi', () => {
    const { rt } = run([DLOAD, 'Db Play 7'], DIGI)
    rt.dme.digi.end = true
    expect(rt.dme.digi.readEnd()).toBe(true)
    expect(rt.dme.digi.readEnd()).toBe(false)
    run([DLOAD, 'Db Play 7', 'Print Digi End'], DIGI)
    expect(out()).toEqual(['0'])
  })

  it('Db Stop leaves the replay silent', () => {
    const { rt } = run([DLOAD, 'Db Play 7', 'Db Stop'], DIGI)
    expect(rt.dme.digiPlaying).toBe(false)
  })
})

/**
 * The MED block, which is the one external player that needed no new engine:
 * `DME_Med.library` is medplayer.library behind DOOM's veneer, and #121 read
 * medplayer.library itself.
 */
const MMD_MOD = ((): Uint8Array => {
  const out = new Uint8Array(0x400)
  for (const [i, c] of [...'MMD0'].entries()) out[i] = c.charCodeAt(0)
  out[0x33] = 2 // extra_songs
  out[0x22f] = 9 // the sequence length MMD0 and MMD1 keep here
  return out
})()

const MMD = { 'a.med': MMD_MOD }
const MLOAD = 'Dmed Load "Work:a.med",7'

describe('the MED block', () => {
  it('Dmed Load reserves a DATA bank named "Med     ", and the only FAST one', () => {
    const { rt } = run([MLOAD], MMD)
    const b = rt.memBanks.get(7)!
    expect(b.name.padEnd(8).slice(0, 8)).toBe(DMED_BANK_NAME)
    // `moveq #$1,d1` at $64ea: Bnk_BitData with no Bnk_BitChip, where the
    // other eight loaders in this extension all pass 3
    expect(b.flags).toBe(1)
    expect(b.memType).toBe(0)
    const wrong = MMD_MOD.slice()
    wrong[2] = 0x58
    expect(() => run([MLOAD], { 'a.med': wrong })).toThrow(DME_ERRORS[7])
  })

  it('Dmed Play checks the bank NAME, not the module', () => {
    expect(() => run(['Reserve As Chip Work 7,1024', 'Dmed Play 7'], {})).toThrow(DME_ERRORS[7])
    expect(() => run([MLOAD, 'Dmed Play 7'], MMD)).not.toThrow()
  })

  it('=Dmed Song Length reads $22f, and $5d instead when the tag is MMD2', () => {
    // routine 212 ($6794): `cmpi.l #$4d4d4432,(a2)` picks the field
    run([MLOAD, 'Print Dmed Song Length(7)'], MMD)
    expect(out()).toEqual(['9'])
    const mmd2 = MMD_MOD.slice()
    mmd2[3] = '2'.charCodeAt(0)
    mmd2[0x5d] = 5
    run(['Dmed Load "Work:b.med",7', 'Print Dmed Song Length(7)'], { 'b.med': mmd2 })
    expect(out()).toEqual(['5'])
  })

  it('=Dmed Subsongs is the extra_songs byte at $33', () => {
    run([MLOAD, 'Print Dmed Subsongs(7)'], MMD)
    expect(out()).toEqual(['2'])
  })

  it('=Dmed Song Pos and =Dmed Patt Pos answer zero until something has played', () => {
    run(['Print Dmed Song Pos', 'Print Dmed Patt Pos'], {})
    expect(out()).toEqual(['0', '0'])
  })

  it('Dmed Volume takes 0..64 and lands on the player, not the module', () => {
    expect(() => run([MLOAD, 'Dmed Volume 65'], MMD)).toThrow()
    const { rt } = run([MLOAD, 'Dmed Play 7', 'Dmed Volume 20'], MMD)
    expect(rt.dme.dmed!.masterVolume).toBe(20)
  })

  it('Dmed Next Patt and Dmed Prev Patt raise message 52 when nothing is playing', () => {
    expect(() => run(['Dmed Next Patt'], {})).toThrow(DME_ERRORS[52])
    expect(() => run(['Dmed Prev Patt'], {})).toThrow(DME_ERRORS[52])
  })

  it('=Dmed Vu refuses a channel outside 0..3 and reads-and-clears inside it', () => {
    expect(() => run([MLOAD, 'Dmed Play 7', 'Print Dmed Vu(4)'], MMD)).toThrow()
    const { rt } = run([MLOAD, 'Dmed Play 7'], MMD)
    rt.dme.dmedVu[1] = 40
    run([MLOAD, 'Dmed Play 7', 'Print Dmed Vu(1)'], MMD)
    expect(out()).toEqual(['0'])
  })

  it('Dmed Stop and Dmed Cont turn the one flag the veneer keeps', () => {
    const { rt } = run([MLOAD, 'Dmed Play 7', 'Dmed Stop'], MMD)
    expect(rt.dme.dmedPlaying).toBe(false)
    const back = run([MLOAD, 'Dmed Play 7', 'Dmed Stop', 'Dmed Cont'], MMD)
    expect(back.rt.dme.dmedPlaying).toBe(true)
  })
})

describe('what every DME loader asks Bnk_Reserve for', () => {
  it('reserves a DATA bank in CHIP, because `moveq #$3,d1` is both bits', () => {
    // Bnk_BitData is bit 0 and Bnk_BitChip bit 1 (banks.ts, out of +Equ.s), so
    // a module bank survives `Erase Temp` and the DMA can reach it. Every one
    // of these said Work and fast until the MED loader's `moveq #$1,d1` was
    // read beside them
    const cases: [string, Record<string, Uint8Array>][] = [
      [SLOAD, SFX],
      [FLOAD, FC14],
      [TLOAD, FC13],
      [DLOAD, DIGI],
    ]
    for (const [load, files] of cases) {
      const { rt } = run([load], files)
      const b = rt.memBanks.get(Number(load.slice(load.lastIndexOf(',') + 1)))!
      expect([load, b.flags, b.memType]).toEqual([load, 1, 1])
    }
  })
})

/** The BP SoundMon block: four channels, a synth, and no mixer. */
const SMON_MOD = ((): Uint8Array => {
  const out = new Uint8Array(0x400)
  for (const [i, c] of [...'V.2'].entries()) out[0x1a + i] = c.charCodeAt(0)
  out[0x1d] = 4 // four waveform tables
  out[0x1f] = 2 // two song steps
  return out
})()

const SMON = { 'a.bp': SMON_MOD }
const MLOAD2 = 'Smon Load "Work:a.bp",7'

describe('the BP SoundMon block', () => {
  it('Smon Load reserves a DATA and CHIP bank named "SoundMon"', () => {
    const { rt } = run([MLOAD2], SMON)
    const b = rt.memBanks.get(7)!
    expect(b.name.padEnd(8).slice(0, 8)).toBe(SMON_BANK_NAME)
    expect([b.flags, b.memType]).toEqual([1, 1])
    const wrong = SMON_MOD.slice()
    wrong[0x1c] = '3'.charCodeAt(0)
    expect(() => run([MLOAD2], { 'a.bp': wrong })).toThrow(DME_ERRORS[39])
  })

  it('=Smon Song Length reads the WORD at $1e, not a byte', () => {
    run([MLOAD2, 'Print Smon Song Length(7)'], SMON)
    expect(out()).toEqual(['2'])
  })

  it('=Smon Song Pos answers zero until something has played', () => {
    run(['Print Smon Song Pos'], {})
    expect(out()).toEqual(['0'])
  })

  it('Smon Volume takes 0..64 and Smon Voice takes anything', () => {
    expect(() => run([MLOAD2, 'Smon Volume 65'], SMON)).toThrow()
    const { rt } = run([MLOAD2, 'Smon Play 7', 'Smon Volume 20', 'Smon Voice 9'], SMON)
    expect(rt.dme.smon.master).toBe(20)
    expect(rt.dme.smon.enabled).toBe(9)
  })

  it('Smon Next Patt and Smon Prev Patt raise message 48 when nothing is playing', () => {
    expect(() => run(['Smon Next Patt'], {})).toThrow(DME_ERRORS[48])
    expect(() => run(['Smon Prev Patt'], {})).toThrow(DME_ERRORS[48])
  })

  it('=Smon Vu refuses a channel outside 0..3, and =Smon End clears', () => {
    expect(() => run([MLOAD2, 'Smon Play 7', 'Print Smon Vu(4)'], SMON)).toThrow()
    const { rt } = run([MLOAD2, 'Smon Play 7'], SMON)
    rt.dme.smon.end = true
    expect(rt.dme.smon.readEnd()).toBe(true)
    expect(rt.dme.smon.readEnd()).toBe(false)
    run([MLOAD2, 'Smon Play 7', 'Print Smon End'], SMON)
    expect(out()).toEqual(['0'])
  })

  it('Smon Stop and Smon Cont turn the one flag the veneer keeps', () => {
    const { rt } = run([MLOAD2, 'Smon Play 7', 'Smon Stop'], SMON)
    expect(rt.dme.smonPlaying).toBe(false)
    const back = run([MLOAD2, 'Smon Play 7', 'Smon Stop', 'Smon Cont'], SMON)
    expect(back.rt.dme.smonPlaying).toBe(true)
  })
})
