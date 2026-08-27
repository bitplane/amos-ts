/**
 * `playsid.library`, against its own error codes and against a real tune.
 *
 * Two halves. The state machine is checked against the eleven `SID_*`
 * constants in playsidbase.h and the branches in the library that return
 * them, using headers built here. The rest runs Matt Gray's "Last Ninja 2"
 * out of DME 2.0's `PlaySid_Example.amos` and looks at what reaches Paula,
 * which is the only end-to-end evidence available: nothing else on this
 * machine plays a PSID.
 *
 * What that second half can and cannot say is worth being straight about. It
 * can say the 6502 runs the tune without jamming, that all three voices come
 * alive, that the waveform tables are the library's lengths, and that the
 * envelope moves. It cannot say the result SOUNDS like a C64, because there
 * is nothing here to compare it against. `mos6502.test.ts` carries the part
 * that does have an oracle.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { describeWith } from '../testing/fixture'
import { parseAmosFile } from '../loader/amosfile'
import { corpusFile, haveCorpus } from '../cli/corpus'
import { NullAudio } from './paula'
import {
  PM_PAUSE,
  PM_PLAY,
  PM_STOP,
  PlaySid,
  SID_BADHEADER,
  SID_LIBINUSE,
  SID_NOMODULE,
  SID_NOPAUSE,
  SID_NOSONG,
  WAVE_LENGTHS,
} from './playsid'
import { PSID_HEADER_SIZE } from './psid'
import { CTRL_GATE, CTRL_PULSE, CTRL_TRIANGLE } from './sidchip'

/** sources/kyzer-dme/files/amospro_dme_v2.0/examples/PlaySid_Example.amos */
const EXAMPLE = 'e8eac620ee8442a237deb7e0d6e5df67d2ddc82f182900e0c291b4af9461e9e9'

function exampleBank(): Uint8Array | null {
  if (!haveCorpus()) return null
  const path = corpusFile(EXAMPLE)
  if (!path) return null
  const file = parseAmosFile(new Uint8Array(readFileSync(path)))
  const found = file?.banks.find((b) => 'data' in b && (b as { number?: number }).number === 3)
  return found && 'data' in found ? (found.data as Uint8Array) : null
}

/**
 * A one-part PSID whose body is 6502 that writes the SID and returns.
 *
 * `init` sets voice 1 to a triangle at $1000 with the gate on. `play` bumps
 * the pulse width, so a test can tell one frame from the next.
 */
function tinyTune(over: { songs?: number; defaultSong?: number; version?: number } = {}): Uint8Array {
  const LOAD = 0x1000
  const body = [
    // init at $1000:  LDA #$00 / STA $D400 / LDA #$10 / STA $D401
    0xa9, 0x00, 0x8d, 0x00, 0xd4, 0xa9, 0x10, 0x8d, 0x01, 0xd4,
    //                LDA #$11 / STA $D404   (triangle + gate)
    0xa9, 0x11, 0x8d, 0x04, 0xd4,
    //                LDA #$0f / STA $D418 / RTS
    0xa9, 0x0f, 0x8d, 0x18, 0xd4, 0x60,
    // play at $1015:  INC $02 / LDA $02 / STA $D402 / RTS
    //
    // The counter lives in RAM because the SID is write-only: `INC $D402`
    // reads zero every time and would write 1 for ever. There is a test for
    // exactly that below.
    0xe6, 0x02, 0xa5, 0x02, 0x8d, 0x02, 0xd4, 0x60,
  ]
  const b = new Uint8Array(PSID_HEADER_SIZE + body.length)
  const w = (at: number, v: number): void => {
    b[at] = (v >> 8) & 0xff
    b[at + 1] = v & 0xff
  }
  b.set([0x50, 0x53, 0x49, 0x44], 0)
  w(4, over.version ?? 2)
  w(6, PSID_HEADER_SIZE)
  w(8, LOAD)
  w(0x0a, LOAD)
  w(0x0c, LOAD + 0x15)
  w(0x0e, over.songs ?? 1)
  w(0x10, over.defaultSong ?? 1)
  b.set(body, PSID_HEADER_SIZE)
  return b
}

describe('the library\'s state machine', () => {
  it('refuses a second AllocEmulResource, which is $210262', () => {
    const ps = new PlaySid(() => undefined)
    expect(ps.allocEmulResource()).toBe(0)
    expect(ps.allocEmulResource()).toBe(SID_LIBINUSE)
  })

  it('StartSong before SetModule is SID_NOMODULE', () => {
    // `tst.w $6c(a6) / bne` at $210372, then `moveq #$fb,d0`.
    const ps = new PlaySid(() => undefined)
    ps.allocEmulResource()
    expect(ps.startSong(1)).toBe(SID_NOMODULE)
  })

  it('SetModule refuses what CheckModule would have', () => {
    const ps = new PlaySid(() => undefined)
    expect(ps.setModule(new Uint8Array(8))).toBe(SID_BADHEADER)
  })

  it('takes a ONE-based tune number, and 0 means the header default', () => {
    // `tst.w d0 / bne` at $21037e takes $44(a6) when the argument is zero.
    const ps = new PlaySid(() => undefined)
    ps.setModule(tinyTune({ songs: 4, defaultSong: 3 }))
    expect(ps.startSong(0)).toBe(0)
    expect(ps.song).toBe(2)
    expect(ps.startSong(1)).toBe(0)
    expect(ps.song).toBe(0)
  })

  it('refuses a song past the count, and song 0 of a default-0 file with it', () => {
    // `subq.w #$1 / cmp.w $42(a6),d0 / bcs` at $210386 is UNSIGNED, so the
    // underflow from song 0 lands at $ffff and is refused the same way.
    const ps = new PlaySid(() => undefined)
    ps.setModule(tinyTune({ songs: 4 }))
    expect(ps.startSong(4)).toBe(0)
    expect(ps.startSong(5)).toBe(SID_NOSONG)
    const zero = new PlaySid(() => undefined)
    zero.setModule(tinyTune({ songs: 4, defaultSong: 0 }))
    expect(zero.startSong(0)).toBe(SID_NOSONG)
  })

  it('walks PlayMode through the three values playsidbase.h names', () => {
    const ps = new PlaySid(() => undefined)
    ps.setModule(tinyTune())
    expect(ps.playMode).toBe(PM_STOP)
    ps.startSong(1)
    expect(ps.playMode).toBe(PM_PLAY)
    ps.pauseSong()
    expect(ps.playMode).toBe(PM_PAUSE)
    expect(ps.continueSong()).toBe(0)
    expect(ps.playMode).toBe(PM_PLAY)
    ps.stopSong()
    expect(ps.playMode).toBe(PM_STOP)
  })

  it('ContinueSong on anything but a paused song is SID_NOPAUSE', () => {
    // `cmpi.w #$2,$2c(a6) / beq` at $2104ba, then `moveq #$fc,d0`.
    const ps = new PlaySid(() => undefined)
    ps.setModule(tinyTune())
    expect(ps.continueSong()).toBe(SID_NOPAUSE)
    ps.startSong(1)
    expect(ps.continueSong()).toBe(SID_NOPAUSE)
  })

  it('PauseSong only bites on a PLAYING song', () => {
    const ps = new PlaySid(() => undefined)
    ps.setModule(tinyTune())
    ps.pauseSong()
    expect(ps.playMode).toBe(PM_STOP)
  })
})

describe('loading a module into the C64', () => {
  it('runs init and play, and the tune\'s writes land on the chip', () => {
    const ps = new PlaySid(() => undefined)
    ps.setModule(tinyTune())
    ps.startSong(1)
    expect(ps.sid.voices[0]!.freq).toBe(0x1000)
    expect(ps.sid.voices[0]!.control).toBe(CTRL_TRIANGLE | CTRL_GATE)
    expect(ps.sid.volume).toBe(15)
    const before = ps.sid.voices[0]!.pulseWidth
    ps.tick()
    ps.tick()
    expect(ps.sid.voices[0]!.pulseWidth).toBe(before + 2)
    expect(ps.frames).toBe(2)
  })

  it('INC on a SID register writes 1 for ever, because the chip reads as zero', () => {
    // Not a curiosity: a read-modify-write on $D400-$D7FF reads the bus, and
    // below $D419 the SID drives nothing onto it. `INC $D402` is therefore
    // `LDA #1 / STA $D402` however many times it runs, and a tune that meant
    // to sweep a pulse width this way sits still. Worth a test because the
    // first version of the fixture above did exactly that and looked right.
    const t = tinyTune()
    const at = PSID_HEADER_SIZE + 21
    t.set([0xee, 0x02, 0xd4, 0x60], at) // INC $D402 / RTS
    const ps = new PlaySid(() => undefined)
    ps.setModule(t)
    ps.startSong(1)
    for (let i = 0; i < 5; i++) ps.tick()
    expect(ps.sid.voices[0]!.pulseWidth).toBe(1)
  })

  it('sets $D418 to $0f before init, so a tune that never writes it is audible', () => {
    // `move.b #$f,$18(a0)` at $21041e, through a1 = ram + $d400.
    const t = tinyTune()
    // Strip the tune's own $D418 write, leaving the library's. Five bytes:
    // LDA #$0f is two and STA $D418 is three.
    for (let i = 15; i < 20; i++) t[PSID_HEADER_SIZE + i] = 0xea
    const ps = new PlaySid(() => undefined)
    ps.setModule(t)
    ps.startSong(1)
    expect(ps.sid.volume).toBe(15)
  })

  it('takes the load address out of the data when the header says zero', () => {
    // `$2107a0`: `movep.w $1(a0),d0 / move.b (a0),d0`, LITTLE-endian, and the
    // two bytes are consumed rather than loaded.
    const t = tinyTune()
    const body = t.subarray(PSID_HEADER_SIZE)
    const moved = new Uint8Array(PSID_HEADER_SIZE + 2 + body.length)
    moved.set(t.subarray(0, PSID_HEADER_SIZE), 0)
    moved[8] = 0
    moved[9] = 0 // load address zero
    moved[PSID_HEADER_SIZE] = 0x00 // $2000, little-endian
    moved[PSID_HEADER_SIZE + 1] = 0x20
    moved.set(body, PSID_HEADER_SIZE + 2)
    const ps = new PlaySid(() => undefined)
    ps.setModule(moved)
    ps.startSong(1)
    expect(ps.bus.ram[0x2000]).toBe(0xa9)
  })

  it('does not run off the end of memory when the body would overflow', () => {
    // `$210822`: `cmp.l #$10000,d2 / bls`, so the copy is clipped and does
    // not wrap to zero.
    const t = tinyTune()
    t[8] = 0xff
    t[9] = 0xf0 // load at $fff0, with more body than fits
    const big = new Uint8Array(PSID_HEADER_SIZE + 64)
    big.set(t.subarray(0, PSID_HEADER_SIZE))
    big.fill(0x60, PSID_HEADER_SIZE)
    const ps = new PlaySid(() => undefined)
    expect(ps.setModule(big)).toBe(0)
    expect(ps.startSong(1)).toBe(0)
    expect(ps.bus.ram[0]).toBe(0)
  })
})

describe('the SID lives at $D400 and is mirrored to $D800', () => {
  it('answers at $D400 and again 32 bytes up, which is $2126c6\'s pattern', () => {
    const ps = new PlaySid(() => undefined)
    ps.bus.write(0xd400, 0x22)
    expect(ps.sid.voices[0]!.freq & 0xff).toBe(0x22)
    ps.bus.write(0xd420, 0x33)
    expect(ps.sid.voices[0]!.freq & 0xff).toBe(0x33)
    ps.bus.write(0xd7e0, 0x44)
    expect(ps.sid.voices[0]!.freq & 0xff).toBe(0x44)
  })

  it('is write-only below $D419, so a read gives zero and not the last write', () => {
    const ps = new PlaySid(() => undefined)
    ps.bus.write(0xd400, 0x22)
    expect(ps.bus.read(0xd400)).toBe(0)
  })

  it('leaves $D3FF and $D800 as plain RAM', () => {
    const ps = new PlaySid(() => undefined)
    ps.bus.write(0xd3ff, 0x5a)
    ps.bus.write(0xd800, 0xa5)
    expect(ps.bus.read(0xd3ff)).toBe(0x5a)
    expect(ps.bus.read(0xd800)).toBe(0xa5)
  })
})

describeWith('Last Ninja 2, out of DME\'s own example', exampleBank(), (bank) => {
  function run(frames: number): { ps: PlaySid; audio: NullAudio } {
    const audio = new NullAudio()
    const ps = new PlaySid(() => audio)
    ps.allocEmulResource()
    ps.setModule(bank)
    ps.startSong(1)
    for (let i = 0; i < frames; i++) ps.tick()
    return { ps, audio }
  }

  it('initialises and runs ten seconds without the processor jamming', () => {
    const { ps } = run(500)
    expect(ps.cpu.jammed).toBe(false)
    expect(ps.frames).toBe(500)
    expect(ps.playMode).toBe(PM_PLAY)
  })

  it('brings all three voices alive, at many pitches each', () => {
    const { ps } = run(500)
    const audio = new NullAudio()
    void audio
    // A tune that only ever set one voice would still pass "it runs", so the
    // count of DISTINCT frequencies per voice is what says the replay works.
    const ps2 = new PlaySid(() => new NullAudio())
    ps2.setModule(bank)
    ps2.startSong(1)
    const seen = [new Set<number>(), new Set<number>(), new Set<number>()]
    for (let i = 0; i < 500; i++) {
      ps2.tick()
      ps2.sid.voices.forEach((v, n) => {
        if (v.freq) seen[n]!.add(v.freq)
      })
    }
    expect(seen.map((s) => s.size > 10)).toEqual([true, true, true])
    expect(ps.sid.volume).toBeGreaterThan(0)
  })

  it('plays on three Paula voices and never on the fourth', () => {
    // Voice 3 belongs to PlaySID's sample extension ($21187c writes AUD3PER
    // and AUD3VOL), and this tune does not use it.
    const { audio } = run(300)
    const voices = new Set(audio.events.filter((e) => e.kind === 'play').map((e) => e.voice))
    expect([...voices].sort()).toEqual([0, 1, 2])
  })

  it('only ever hands Paula a table length the library has', () => {
    // The thirteen at $21401c and nothing else. A length off that list would
    // mean the half-octave choice had drifted.
    const { audio } = run(300)
    const lengths = new Set(audio.events.filter((e) => e.kind === 'play').map((e) => e.length!))
    expect(lengths.size).toBeGreaterThan(0)
    for (const n of lengths) expect(WAVE_LENGTHS).toContain(n)
  })

  it('keeps every rate inside what Paula can clock', () => {
    const { audio } = run(300)
    const rates = audio.events.filter((e) => e.freq !== undefined).map((e) => e.freq!)
    expect(rates.length).toBeGreaterThan(100)
    expect(Math.max(...rates)).toBeLessThanOrEqual(3546895 / 124)
  })

  it('rewrites waveforms under the running DMA rather than restarting them', () => {
    // The same reason thxplay.ts needs `setWaveform`: at fifty changes a
    // second, a `play()` for each would be a click each time.
    const { audio } = run(300)
    const waveforms = audio.events.filter((e) => e.kind === 'waveform').length
    const plays = audio.events.filter((e) => e.kind === 'play').length
    expect(waveforms).toBeGreaterThan(plays)
  })

  it('moves the envelope, which is what makes it a tune and not a drone', () => {
    const ps = new PlaySid(() => new NullAudio())
    ps.setModule(bank)
    ps.startSong(1)
    const envs = new Set<number>()
    for (let i = 0; i < 300; i++) {
      ps.tick()
      envs.add(Math.round(ps.sid.voices[0]!.env))
    }
    expect(envs.size).toBeGreaterThan(10)
  })

  it('stops silent, and stopping twice is not an error', () => {
    const { ps, audio } = run(100)
    audio.events.length = 0
    ps.stopSong()
    ps.stopSong()
    expect(ps.playMode).toBe(PM_STOP)
    expect(audio.events.filter((e) => e.kind === 'stop').length).toBe(3)
  })

  it('a paused tune runs no frames, and continuing picks it up', () => {
    const { ps } = run(100)
    const at = ps.frames
    ps.pauseSong()
    ps.tick()
    ps.tick()
    expect(ps.frames).toBe(at)
    ps.continueSong()
    ps.tick()
    expect(ps.frames).toBe(at + 1)
  })

  it('ForwardSong runs the play routine that many extra times', () => {
    // Developer.doc: the play routine is called as many times as the speed.
    const { ps } = run(50)
    const at = ps.frames
    ps.forwardSong(16)
    expect(ps.frames).toBe(at + 16)
  })

  it('each of the twelve songs starts, and the thirteenth does not', () => {
    const ps = new PlaySid(() => new NullAudio())
    ps.setModule(bank)
    for (let n = 1; n <= 12; n++) expect(ps.startSong(n)).toBe(0)
    expect(ps.startSong(13)).toBe(SID_NOSONG)
  })

  it('the pulse waveform is reached, so the table choice is not triangle-only', () => {
    const ps = new PlaySid(() => new NullAudio())
    ps.setModule(bank)
    ps.startSong(1)
    let pulse = false
    for (let i = 0; i < 500; i++) {
      ps.tick()
      if (ps.sid.voices.some((v) => v.control & CTRL_PULSE)) pulse = true
    }
    expect(pulse).toBe(true)
  })
})
