import { describe, expect, it } from 'vitest'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { extensionById } from '../ext/registry'
import { Runtime } from './runtime'
import { decodeChannel, parseP61, unpackDelta } from '../amiga/p61'

const table = new TokenTable(CORE_TOKENS)
/** slot 25 — the doc says so outright: "Uses extension slot 25." */
const p61 = extensionById('p61-1.2')!

let printed = ''

function run(src: string, bank?: Uint8Array): Runtime {
  const exts = new Map([[25, p61.table]])
  printed = ''
  const rt = new Runtime(tokenize(src, table, exts), table, {
    extensions: exts,
    extBindings: new Map([[25, p61]]),
    maxSteps: 200_000,
    onText: (t) => (printed += t),
  })
  if (bank) rt.memBanks.set(1, { kind: 'memory', number: 1, memType: 0, name: 'Mod', flags: 0, data: bank })
  const r = rt.runHeadless(500)
  if (r.status !== 'ended' && r.status !== 'stopped') throw new Error(`program ${r.status}`)
  return rt
}

const val = (src: string, bank?: Uint8Array): number => {
  run(src, bank)
  return Number(printed.trim())
}

/**
 * A minimal module, built here.
 *
 * IT PROVES ONLY THAT THE READER AGREES WITH THIS BUILDER. There is no P61
 * module anywhere in the corpus or in the distribution, so nothing here can
 * falsify the decoder against a file some other tool wrote. The structural
 * tests below are worth having — they pin the offsets the assembly states —
 * but they are not evidence that a real module decodes correctly, and the
 * NOTES on `p61 play` say so.
 */
function tinyModule(): Uint8Array {
  const b: number[] = []
  b.push(0x50, 0x36, 0x31, 0x41) // "P61A"
  b.push(0x00, 0x00) // +0 the sample offset, filled in below
  b.push(0x01) // +2 one pattern
  b.push(0x01) // +3 no packing, no buffer, one sample
  // the sample table at +4: length 2 words, finetune 0, volume 40, no repeat
  b.push(0x00, 0x02, 0x00, 0x28, 0xff, 0xff)
  // the pattern table: one pattern, four channel offsets
  b.push(0x00, 0x00, 0x00, 0x02, 0x00, 0x04, 0x00, 0x06)
  b.push(0x00, 0xff) // the song: position 0, then the terminator
  // four channel streams, each one empty row with a 63-row repeat
  for (let i = 0; i < 4; i++) b.push(0xff, 0x3f)
  // `move (a0),d0 / lea (a0,d0.l),a1` runs AFTER the signature step, so the
  // offset is measured from byte 4 and not from the head of the file
  const off = b.length - 4
  b[4] = (off >> 8) & 0xff
  b[5] = off & 0xff
  b.push(0x10, 0x20, 0x30, 0x40) // the sample's four bytes
  return new Uint8Array(b)
}

describe('P61: the module reader (610.2_devpac3.asm, P61_Init)', () => {
  it('takes the P61A signature or its absence', () => {
    // `cmp.l #"P61A",(a0)+ / beq / subq.l #4,a0` -- present it steps over,
    // absent it rewinds, so both layouts parse
    const withSig = parseP61(tinyModule())
    expect(withSig).not.toBeNull()
    const without = parseP61(tinyModule().subarray(4))
    expect(without).not.toBeNull()
    expect(without!.samples).toHaveLength(1)
  })

  it('reads the counts out of bytes 2 and 3', () => {
    // low seven bits of +2 are the patterns, low five of +3 the samples
    const m = parseP61(tinyModule())!
    expect(m.patternOffsets).toHaveLength(1)
    expect(m.samples).toHaveLength(1)
    expect(m.samples[0]!.volume).toBe(40)
    expect(m.samples[0]!.words).toBe(2)
  })

  it('puts the sample table at +4 when bit 6 is clear', () => {
    // `lea 8(a0),a2` then `subq.l #4,a2` when the buffer bit is not set --
    // the four bytes it skips are the buffer size longword
    const m = parseP61(tinyModule())!
    expect(m.buffered).toBe(false)
    expect(m.samples[0]!.pcm).toEqual(new Int8Array([0x10, 0x20, 0x30, 0x40]))
  })

  it('reads the song as bytes ending in $FF', () => {
    // `.search cmp.b (a1)+,d0 / bne` with d0 = -1
    const m = parseP61(tinyModule())!
    expect(m.positions).toEqual([0])
  })

  it('a negative sample length ALIASES an earlier sample', () => {
    // `bmi / neg d4 / lea P61_samples-16(pc),a5` -- the entry borrows the
    // data of the sample it names instead of carrying its own
    const b = [...tinyModule()]
    b[7] = 0x02 // two samples
    b.splice(10, 0, 0xff, 0xff, 0x00, 0x30, 0xff, 0xff) // an alias to sample 1
    const m = parseP61(new Uint8Array(b))
    expect(m).not.toBeNull()
    expect(m!.samples[1]!.aliasOf).toBe(0)
  })
})

describe('P61: the four-bit delta unpacker', () => {
  it('subtracts through the table, high nibble first', () => {
    // `.table dc.b 0,1,2,4,8,16,32,64,128,-64,-32,-16,-8,-4,-2,-1` and
    // `sub.b .table(pc,d4),d5` -- the running value is SUBTRACTED by the step
    const out = unpackDelta(new Uint8Array([0x12, 0x00]), 0, 2)
    // high nibble 1 -> step 1 -> 0-1 = -1; low nibble 2 -> step 2 -> -1-2 = -3
    expect([out[0], out[1]]).toEqual([-1, -3])
    // a zero byte is two steps of 0, so the value holds
    expect([out[2], out[3]]).toEqual([-3, -3])
  })

  it('produces two bytes per packed byte', () => {
    expect(unpackDelta(new Uint8Array([0, 0, 0, 0]), 0, 4)).toHaveLength(8)
  })
})

describe('P61: the packed note stream (P61_takenorm)', () => {
  it('an $FF byte is an empty row, and the compression byte repeats it', () => {
    // (b & $78) == $78 is the empty case; %00nnnnnn repeats it n more times
    const rows = decodeChannel(new Uint8Array([0xff, 0x03]), 0, 8)
    expect(rows.slice(0, 4).every((r) => r.note === 0 && r.command === 0)).toBe(true)
  })

  it('a full entry is three bytes: note, instrument, command and info', () => {
    // (b0 & $60) != $60 -- b0 carries the note in bits 1..6, b1 the
    // instrument's low nibble and the command, b2 the info
    const rows = decodeChannel(new Uint8Array([0x10, 0x2c, 0x40]), 0, 1)
    expect(rows[0]!.note).toBe(0x10)
    expect(rows[0]!.command).toBe(0xc)
    expect(rows[0]!.info).toBe(0x40)
    expect(rows[0]!.instrument).toBe(2)
  })

  it('a command-only entry takes the low nibble and one info byte', () => {
    // (b0 & $70) != $70 but (b0 & $60) == $60
    const rows = decodeChannel(new Uint8Array([0x6a, 0x33]), 0, 1)
    expect([rows[0]!.note, rows[0]!.command, rows[0]!.info]).toEqual([0, 0xa, 0x33])
  })

  it('%10nnnnnn repeats the decoded row unchanged', () => {
    // the same note n more times, where %00 would have given empty ones
    const rows = decodeChannel(new Uint8Array([0x90, 0x2c, 0x40, 0x82]), 0, 3)
    expect(rows[0]!.note).toBe(0x10)
    expect(rows[1]!.note).toBe(0x10)
    expect(rows[2]!.note).toBe(0x10)
  })

  it('always returns the row count asked for, however short the stream', () => {
    // a malformed or truncated stream must not hang the decoder
    expect(decodeChannel(new Uint8Array([]), 0, 64)).toHaveLength(64)
    expect(decodeChannel(new Uint8Array([0x80]), 0, 64)).toHaveLength(64)
  })
})

describe('P61: the keywords (AMOSPro_P61A.Lib.s)', () => {
  it('P61 Play reads a module out of the bank and enables the song', () => {
    const rt = run('P61 Play 1', tinyModule())
    expect(rt.p61.enabled).toBe(true)
    expect(rt.p61.module).not.toBeNull()
    expect(rt.p61.bank).toBe(1)
  })

  it('P61 Play resets the replayer fields the source names', () => {
    // Master and FadeTo to 64, Pos/Patt/CRow to 0, Tempo to 125, E8 to -1
    const rt = run('P61 Play 1', tinyModule())
    expect([rt.p61.master, rt.p61.fadeTo]).toEqual([64, 64])
    expect([rt.p61.pos, rt.p61.patt, rt.p61.row]).toEqual([0, 0, 0])
    expect(rt.p61.tempo).toBe(125)
    expect(rt.p61.e8).toBe(-1)
  })

  it('the one-argument form pushes a zero, so no position is sought', () => {
    // `clr.l -(a3)` then `tst.l d6 / ble .nopos`
    expect(run('P61 Play 1', tinyModule()).p61.pos).toBe(0)
    expect(run('P61 Play 1,0', tinyModule()).p61.pos).toBe(0)
  })

  it('a position past the song restarts rather than erroring', () => {
    // `cmp P61_slen,d0 / blo` then `moveq #0,d0`
    expect(run('P61 Play 1,9', tinyModule()).p61.pos).toBe(0)
  })

  it('P61 Stop with nothing playing is not an error', () => {
    // `tst.w O_MusicEnabled(a2) / beq .nooff` skips straight to the free
    expect(() => run('P61 Stop')).not.toThrow()
    expect(run('P61 Play 1\nP61 Stop', tinyModule()).p61.enabled).toBe(false)
  })

  it('P61 Volume clamps to 0..64 and sets BOTH master and fade target', () => {
    // `bpl` sends a negative to 0, `cmp.w #64 / blt` sends 64 and up to 64,
    // and the pair is written together so a volume cancels a running fade
    expect(run('P61 Volume 30').p61.master).toBe(30)
    expect(run('P61 Volume -5').p61.master).toBe(0)
    expect(run('P61 Volume 99').p61.master).toBe(64)
    expect(run('P61 Volume 30').p61.fadeTo).toBe(30)
  })

  it('P61 Fade with one argument fades OUT', () => {
    // `L_P61Fade1` pushes 0 first, so the missing target is zero rather than
    // the current volume
    const out = run('P61 Volume 64\nP61 Fade 5')
    expect([out.p61.fadeTo, out.p61.fadeSpeed, out.p61.fadeCount]).toEqual([0, 5, 5])
    const to = run('P61 Fade 3 To 20')
    expect([to.p61.fadeTo, to.p61.fadeSpeed]).toEqual([20, 3])
  })

  it('a negative fade speed is Illegal Function Call', () => {
    expect(() => run('P61 Fade -1 To 10')).toThrow(/Illegal function call/)
  })

  it('P61 Pause silences and is a no-op when already paused', () => {
    // `tst.l O_MusicPaused(a2) / bne .skip`
    const rt = run('P61 Play 1\nP61 Pause\nP61 Pause', tinyModule())
    expect([rt.p61.paused, rt.p61.play]).toEqual([true, false])
  })

  it('P61 Continue is NOT guarded, unlike Pause', () => {
    const rt = run('P61 Continue')
    expect([rt.p61.paused, rt.p61.play]).toEqual([false, true])
  })

  it('P61 Cia Speed clamps to 32..255 and derives the pair', () => {
    // thi2 = P61_timer / bpm, thi = thi2 - $1f0*2
    const rt = run('P61 Cia Speed 125')
    expect(rt.p61.thi2).toBe(Math.floor(1773447 / 125) & 0xffff)
    expect(rt.p61.thi).toBe((rt.p61.thi2 - 0x1f0 * 2) & 0xffff)
    expect(run('P61 Cia Speed 10').p61.thi2).toBe(Math.floor(1773447 / 32) & 0xffff)
    expect(run('P61 Cia Speed 999').p61.thi2).toBe(Math.floor(1773447 / 255) & 0xffff)
  })

  it('=P61 Signal is read-once — it resets itself to -1', () => {
    // `move.w (a0),d3 / move.w #-1,(a0)` in the same routine
    const rt = run('P61 Play 1', tinyModule())
    rt.p61.e8 = 7
    expect(rt.p61.e8).toBe(7)
    expect(val('P61 Play 1 : Print P61 Signal', tinyModule())).toBe(-1)
  })

  it('=P61 Pos answers the song position', () => {
    expect(val('P61 Play 1 : Print P61 Pos', tinyModule())).toBe(0)
  })

  it('P61 Play on a bank that is not reserved is AMOS bank not reserved', () => {
    expect(() => run('P61 Play 4')).toThrow(/bank not reserved/i)
  })
})
