import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { EXTENSION_TOKENS } from '../ext/registry'
import { tokenize } from '../tokens/tokenizer'
import { parseAmosFile } from '../loader/amosfile'
import { Runtime } from './runtime'
import { NullAudio, periodToHz } from '../amiga/paula'
import { AmigaFS } from '../amiga/vfs'
import type { MemoryBank } from '../loader/amosfile'

const table = new TokenTable(CORE_TOKENS)
const extensions = new Map([...EXTENSION_TOKENS].map(([slot, defs]) => [slot, new TokenTable(defs)]))

// ---- synthetic "Music   " bank ------------------------------------------
// Layout per BkNew (+Music.s:1017): longs at +0/+4/+8 -> instruments,
// songs, patterns. Instrument records are 32 bytes at BankInst+2+n*32
// (EtInst +Music.s:1338).

const cmd = (c: number, arg = 0): number => 0x8000 | (c << 8) | (arg & 0xff)
const DELAY = (n: number): number => cmd(16, n)
const END = cmd(0)

/** build a one-song bank; voice 0 plays `stream`, voices 1-3 are silent */
function musicBank(stream: number[], opts?: { loopSong?: boolean; loopInst?: boolean }): MemoryBank {
  // instruments: count word + 2 records + 32 bytes of sample data
  const inst = new Uint8Array(2 + 2 * 32 + 32)
  const iv = new DataView(inst.buffer)
  iv.setUint16(0, 2)
  const smpOff = 2 + 2 * 32
  for (let rec = 0; rec < 2; rec++) {
    const base = 2 + rec * 32
    iv.setUint32(base + 0, smpOff)
    if (rec === 1 || opts?.loopInst) {
      iv.setUint32(base + 4, smpOff + 16) // repeat second half
      iv.setUint16(base + 10, 8) // 16 bytes of repeat
    } else {
      iv.setUint32(base + 4, smpOff)
      iv.setUint16(base + 10, 1) // one word = one-shot
    }
    iv.setUint16(base + 8, 16) // 32 bytes first pass
    iv.setUint16(base + 12, 40) // default volume
  }
  for (let i = 0; i < 32; i++) inst[smpOff + i] = i & 1 ? 100 : -100 + 256
  // song 1: word offsets to four voice pattern lists
  const list0 = [0x0000, opts?.loopSong ? 0xfffe : 0xffff] // pattern 0 then stop/loop
  const silent = [0xffff]
  const songData = 8 + 2 * (list0.length + 3 * silent.length)
  const song = new Uint8Array(2 + 4 + songData)
  const sv = new DataView(song.buffer)
  sv.setUint16(0, 1) // one song
  sv.setUint32(2, 6) // song 1 at +6
  const sb = 6
  let off = sb + 8
  sv.setUint16(sb + 0, off - sb)
  for (const w of list0) {
    sv.setUint16(off, w)
    off += 2
  }
  for (let v = 1; v < 4; v++) {
    sv.setUint16(sb + v * 2, off - sb)
    sv.setUint16(off, 0xffff)
    off += 2
  }
  // patterns: max number word + (pattern 0 x 4 voices) offsets + stream
  const pat = new Uint8Array(2 + 8 + stream.length * 2 + 2)
  const pv = new DataView(pat.buffer)
  pv.setUint16(0, 0) // highest pattern number
  pv.setUint16(2, 10) // pattern 0 voice 0 -> stream at +10
  const streamOff = 10
  stream.forEach((w, i) => pv.setUint16(streamOff + i * 2, w))
  pv.setUint16(streamOff + stream.length * 2, END)
  // assemble payload
  const payload = new Uint8Array(12 + inst.length + song.length + pat.length)
  const dv = new DataView(payload.buffer)
  dv.setUint32(0, 12)
  dv.setUint32(4, 12 + inst.length)
  dv.setUint32(8, 12 + inst.length + song.length)
  payload.set(inst, 12)
  payload.set(song, 12 + inst.length)
  payload.set(pat, 12 + inst.length + song.length)
  return { kind: 'memory', number: 3, memType: 1, name: 'Music', flags: 0, data: payload }
}

function boot(src: string, bank: MemoryBank): { rt: Runtime; audio: NullAudio } {
  const audio = new NullAudio()
  const rt = new Runtime(tokenize(src, table, extensions), table, {
    extensions,
    audio,
    banks: [bank],
    maxSteps: 100_000,
    onText: () => {},
  })
  return { rt, audio }
}

function frames(rt: Runtime, n: number): void {
  for (let i = 0; i < n; i++) rt.frame()
}

const BASIC = [cmd(8, 100), cmd(9, 0), cmd(3, 63), 0x0143, DELAY(2), 0x0120, DELAY(2)]

describe('music bank player', () => {
  it('steps patterns and triggers instrument notes (MuStep/DoNote +Music.s:1223)', () => {
    const { rt, audio } = boot('Music 1', musicBank(BASIC))
    frames(rt, 2)
    const plays = audio.events.filter((e) => e.kind === 'play')
    expect(plays).toHaveLength(1)
    expect(plays[0]).toMatchObject({ voice: 0, freq: periodToHz(0x143), length: 32, loop: false })
    // Set Volume 63 scaled by the default music volume 56: (63*56)>>6
    expect(plays[0]!.volume).toBe((63 * 56) >> 6)
    frames(rt, 2)
    const plays2 = audio.events.filter((e) => e.kind === 'play')
    expect(plays2).toHaveLength(2)
    expect(plays2[1]!.freq).toBe(periodToHz(0x120))
  })

  it('writes the vumeter bytes on note-on; Vumeter reads and clears (DoNote +Music.s:1245)', () => {
    const { rt } = boot('Music 1', musicBank(BASIC))
    frames(rt, 2) // frame 1 runs the statement, frame 2 is the first step
    expect(rt.vuBytes[0]).toBe((63 * 56) >> 6)
    expect(rt.vumeter(0)).toBe((63 * 56) >> 6)
    expect(rt.vumeter(0)).toBe(0)
  })

  it('maps the vumeter bytes at =Mubase (FnMusicBase +Music.s:3907)', () => {
    const { rt } = boot('Music 1', musicBank(BASIC))
    frames(rt, 2)
    const m = rt.resolveAddr(Runtime.MUBASE_ADDR)
    expect(m).not.toBeNull()
    expect(m!.data[m!.off]).toBe((63 * 56) >> 6)
  })

  it('Tempo controls the step rate (MuCpt/MuTempo +Music.s:1144)', () => {
    // tempo 50 -> the counter wraps every second vbl
    const stream = [cmd(8, 50), cmd(9, 0), cmd(3, 63), 0x0143, DELAY(2), 0x0143, DELAY(2)]
    const { rt, audio } = boot('Music 1', musicBank(stream))
    frames(rt, 2) // first step is immediate (MuCpt starts at TempoBase)
    expect(audio.events.filter((e) => e.kind === 'play')).toHaveLength(1)
    frames(rt, 3) // delay 2 at tempo 50 = one step-tick every 2 vbls
    expect(audio.events.filter((e) => e.kind === 'play')).toHaveLength(1)
    frames(rt, 1)
    expect(audio.events.filter((e) => e.kind === 'play')).toHaveLength(2)
  })

  it('finishes and silences when every voice halts (MuFin +Music.s:1204)', () => {
    const { rt, audio } = boot('Music 1', musicBank(BASIC))
    frames(rt, 8)
    expect(rt.music.playing).toBe(false)
    expect(audio.events.some((e) => e.kind === 'stop')).toBe(true)
  })

  it('a looped song keeps playing', () => {
    const { rt, audio } = boot('Music 1', musicBank(BASIC, { loopSong: true }))
    frames(rt, 30)
    expect(rt.music.playing).toBe(true)
    expect(audio.events.filter((e) => e.kind === 'play').length).toBeGreaterThan(4)
  })

  it('Music Stop pops at the next step-tick; Music Off is immediate (+Music.s:3688/3701)', () => {
    const { rt } = boot('Music 1\nMusic Stop', musicBank(BASIC, { loopSong: true }))
    frames(rt, 3)
    expect(rt.music.playing).toBe(false)
    const { rt: rt2 } = boot('Music 1\nMusic Off', musicBank(BASIC, { loopSong: true }))
    frames(rt2, 1)
    expect(rt2.music.playing).toBe(false)
  })

  it('stacks up to three musics and resumes the previous on finish (MuBuffer +Music.s:1206)', () => {
    // music 1 loops forever; music 2 (same song data) is cut by Music Stop
    const { rt, audio } = boot('Music 1\nMusic 1\nMusic 1\nMusic 1\nWait 5\nMusic Stop', musicBank(BASIC, { loopSong: true }))
    frames(rt, 4)
    expect(rt.music.playing).toBe(true)
    frames(rt, 30)
    // the stack popped once (stack was capped at 3, stop killed the top)
    expect(rt.music.playing).toBe(true)
    expect(audio.events.filter((e) => e.kind === 'play').length).toBeGreaterThan(2)
  })

  it('Voice off silences a music voice, Voice on reclaims it (VOnOf +Music.s:3767)', () => {
    const { rt, audio } = boot('Music 1\nWait 2\nVoice %1110\nWait 4\nVoice %1111', musicBank(BASIC, { loopSong: true, loopInst: true }))
    frames(rt, 3)
    expect(rt.music.dmask).toBe(0b1110)
    expect(audio.events.some((e) => e.kind === 'stop' && e.voice === 0)).toBe(true)
    frames(rt, 6)
    expect(rt.music.dmask).toBe(0b1111)
    expect(rt.music.playing).toBe(true)
  })

  it('volume slide walks the volume down each effect vbl (MuVSl +Music.s:1562)', () => {
    const stream = [cmd(8, 50), cmd(9, 0), cmd(3, 40), 0x0143, cmd(13, 0x02), DELAY(30)]
    const { rt, audio } = boot('Music 1', musicBank(stream))
    frames(rt, 12)
    const vols = audio.events.filter((e) => e.kind === 'volume' && e.voice === 0).map((e) => e.volume!)
    expect(vols.length).toBeGreaterThan(3)
    for (let i = 1; i < vols.length; i++) expect(vols[i]!).toBeLessThan(vols[i - 1]!)
  })

  it('slide up raises the pitch each effect vbl (MuSlide +Music.s:1466)', () => {
    const stream = [cmd(8, 50), cmd(9, 0), cmd(3, 40), 0x0143, cmd(14, 4), DELAY(30)]
    const { rt, audio } = boot('Music 1', musicBank(stream))
    frames(rt, 12)
    const freqs = audio.events.filter((e) => e.kind === 'freq' && e.voice === 0).map((e) => e.freq!)
    expect(freqs.length).toBeGreaterThan(3)
    for (let i = 1; i < freqs.length; i++) expect(freqs[i]!).toBeGreaterThan(freqs[i - 1]!)
  })

  it('portamento slides toward the target note and stops there (MuPTone +Music.s:1519)', () => {
    const stream = [cmd(8, 50), cmd(9, 0), cmd(3, 40), 0x0143, DELAY(2), cmd(11, 8), 0x0120, DELAY(40)]
    const { rt, audio } = boot('Music 1', musicBank(stream))
    frames(rt, 30)
    const freqs = audio.events.filter((e) => e.kind === 'freq' && e.voice === 0).map((e) => e.freq!)
    expect(freqs[freqs.length - 1]).toBe(periodToHz(0x120))
    // strictly rising pitch (period slides 0x143 -> 0x120)
    for (let i = 1; i < freqs.length; i++) expect(freqs[i]!).toBeGreaterThan(freqs[i - 1]!)
  })

  it('Sam Play steals voices and one-shots hand them back (GoSam/Sami +Music.s:3176/1080)', () => {
    const bank = musicBank(BASIC.slice(), { loopSong: true, loopInst: true })
    const { rt } = boot('Music 1', bank)
    frames(rt, 2)
    expect(rt.music.dmask).toBe(0b1111)
    rt.samPlay(0b0001, new Int8Array(400), 10000)
    expect(rt.music.dmask).toBe(0b1110)
    // 400 bytes at ~10kHz is ~2 vbls; the music reclaims the voice after
    frames(rt, 5)
    expect(rt.music.dmask).toBe(0b1111)
  })

  it('Mvolume rescales live voices (MVol +Music.s:3727)', () => {
    // tempo 50 so effect vbls happen (AUDxVOL is written by DoEffects)
    const stream = [cmd(8, 50), cmd(9, 0), cmd(3, 63), 0x0143, DELAY(60)]
    const { rt, audio } = boot('Music 1\nWait 2\nMvolume 20', musicBank(stream, { loopSong: true }))
    frames(rt, 10)
    expect(rt.musicVolume).toBe(20)
    const vols = audio.events.filter((e) => e.kind === 'volume' && e.voice === 0).map((e) => e.volume!)
    expect(vols[vols.length - 1]).toBe((63 * 20) >> 6)
  })

  it('errors: no bank, bad song, bad tempo/mvolume ranges', () => {
    const noBank: MemoryBank = { kind: 'memory', number: 5, memType: 1, name: 'Work', flags: 0, data: new Uint8Array(4) }
    expect(() => boot('Music 1', noBank).rt.runHeadless(2)).toThrow(/music bank not found/i)
    expect(() => boot('Music 9', musicBank(BASIC)).rt.runHeadless(2)).toThrow(/music not defined/i)
    expect(() => boot('Music 0', musicBank(BASIC)).rt.runHeadless(2)).toThrow(/illegal function call/i)
    expect(() => boot('Tempo 101', musicBank(BASIC)).rt.runHeadless(2)).toThrow(/illegal function call/i)
    expect(() => boot('Mvolume 64', musicBank(BASIC)).rt.runHeadless(2)).toThrow(/illegal function call/i)
  })
})

// ---- the wavetable synth ------------------------------------------------

describe('the wavetable synth (Play)', () => {
  const sampBank: MemoryBank = (() => {
    const rec = [
      ...[...'TICK    '].map((c) => c.charCodeAt(0)),
      0x20, 0xab, // 8363 Hz
      0, 0, 0, 8,
      10, 20, 30, 40, 50, 60, 70, 80,
    ]
    return { kind: 'memory', number: 5, memType: 1, name: 'Samples', flags: 0, data: new Uint8Array([0, 1, 0, 0, 0, 6, ...rec]) }
  })()

  it('Play loops the default square wave with the default envelope (VPl0 +Music.s:2887)', () => {
    const { rt, audio } = boot('Play 40,0', sampBank)
    frames(rt, 3)
    const plays = audio.events.filter((e) => e.kind === 'play')
    expect(plays).toHaveLength(4)
    // note 40: octave (40+2)/12 = 3 -> 64-byte mip at offset 384
    expect(plays[0]).toMatchObject({ length: 64, loop: true })
    // EnvDef first segment (1,64) -> volume 56 on the next vbl
    const vols = audio.events.filter((e) => e.kind === 'volume' && e.voice === 0)
    expect(vols[0]!.volume).toBe(56)
  })

  it('Play note,wait blocks like Wait (InPlay2 +Music.s:2802)', () => {
    const { rt } = boot('Play 40,10\nPrint "done"', sampBank)
    let out = ''
    rt.interp.io.write = (t) => (out += t)
    frames(rt, 5)
    expect(out).toBe('')
    frames(rt, 10)
    expect(out).toContain('done')
    expect(() => boot('Play 40,-1', sampBank).rt.runHeadless(2)).toThrow(/illegal function call/i)
    expect(() => boot('Play 97,0', sampBank).rt.runHeadless(2)).toThrow(/illegal function call/i)
  })

  it('Noise To routes a voice to the refreshed noise buffer (VPl4 +Music.s:2961)', () => {
    const { rt, audio } = boot('Noise To %0001\nPlay %0001,40,0', sampBank)
    frames(rt, 3)
    const play = audio.events.find((e) => e.kind === 'play')!
    expect(play.length).toBe(510)
    expect(play.loop).toBe(true)
    // the buffer refreshes 8 words per vbl (descending) while noise plays
    const before = [...audio.voiceState[0]!.pcm!]
    frames(rt, 6)
    const after = [...audio.voiceState[0]!.pcm!]
    expect(after).not.toEqual(before)
  })

  it('Sample To pitches a bank sample relative to A440 (VPl2 +Music.s:2947)', () => {
    const { rt, audio } = boot('Sample 1 To %0001\nPlay %0001,49,0', sampBank)
    frames(rt, 3)
    const play = audio.events.find((e) => e.kind === 'play')!
    // note 49 -> TNotes[49+2] = 523Hz: freq = 8363*523/440, then quantized
    const want = Math.floor((8363 * 523) / 440)
    expect(play.freq).toBeCloseTo(periodToHz(Math.max(124, Math.floor(3546895 / want))))
    expect(play.length).toBe(8)
  })

  it('Set Wave defines a wave, Set Envel shapes it, Del Wave resets voices (+Music.s:3387-3426)', () => {
    const src = 'A'.repeat(256)
    const { rt, audio } = boot(`Set Wave 2,"${src}"\nSet Envel 2,0 To 100,63\nWave 2 To %0001\nPlay %0001,40,0`, sampBank)
    frames(rt, 4)
    const play = audio.events.find((e) => e.kind === 'play')!
    expect(play.length).toBe(64)
    // 'A' = 65 everywhere; the mip of a constant wave is constant
    expect(audio.voiceState[0]!.pcm![0]).toBe(65)
    expect(rt.music.waves.get(2)!.env.slice(0, 3)).toEqual([100, 63, 0])
    expect(rt.music.voiceWave[0]).toBe(2)
    rt.music.delWave(2)
    expect(rt.music.voiceWave).toEqual([1, 1, 1, 1])
  })

  it('Set Wave needs 256 characters; waves 0/1 protected (+Music.s:3391/3405)', () => {
    expect(() => boot('Set Wave 2,"short"', sampBank).rt.runHeadless(2)).toThrow(/256 characters/i)
    expect(() => boot(`Del Wave 1`, sampBank).rt.runHeadless(2)).toThrow(/reserved/i)
    expect(() => boot(`Wave 9 To 15`, sampBank).rt.runHeadless(2)).toThrow(/wave not defined/i)
  })

  it('Play Off stops the envelopes and the music reclaims (EnvOff +Music.s:3611)', () => {
    const { rt, audio } = boot('Play 40,0\nPlay Off', sampBank)
    frames(rt, 3)
    expect(audio.events.filter((e) => e.kind === 'stop').length).toBeGreaterThanOrEqual(4)
    expect(audio.voiceState.every((s) => !s.playing)).toBe(true)
    void rt
  })
})

// ---- the Tracker (MOD) player -------------------------------------------

/**
 * Minimal M.K. module: one sample, one pattern; row 0 voice 0 plays
 * instrument 1 at period 0x143 with F01 (speed 1), so the whole pattern
 * runs in 64 vbls. The note period 0x1ac is distinct from the synthetic
 * music bank's notes so tests can tell the two players apart.
 */
function modFile(loopSample = false): Uint8Array {
  const d = new Uint8Array(1084 + 1024 + 64)
  const dv = new DataView(d.buffer)
  dv.setUint16(20 + 22, 32) // sample 1: 64 bytes
  d[20 + 25] = 40 // volume
  if (loopSample) {
    dv.setUint16(20 + 26, 8) // repeat at byte 16
    dv.setUint16(20 + 28, 8) // 16 bytes
  } else {
    dv.setUint16(20 + 28, 1) // conventional 1-word repeat
  }
  d[950] = 1 // song length
  d[951] = 0 // restart position
  d[952] = 0 // positions[0] = pattern 0
  d.set([0x4d, 0x2e, 0x4b, 0x2e], 1080) // "M.K."
  // row 0 voice 0: inst 1 (lo nibble in byte 2), period 0x1ac, cmd F01
  d[1084] = 0x01
  d[1085] = 0xac
  d[1086] = 0x1f
  d[1087] = 0x01
  for (let i = 0; i < 64; i++) d[1084 + 1024 + i] = i & 1 ? 80 : 176
  return d
}

function trackerBank(loopSample = false, number = 6): MemoryBank {
  return { kind: 'memory', number, memType: 1, name: 'Tracker', flags: 0, data: modFile(loopSample) }
}

describe('the MOD tracker', () => {
  it('plays rows at the module speed and writes the vumeter (mt_playvoice +Music.s:1800)', () => {
    const { rt, audio } = boot('Track Play', trackerBank())
    // statement on frame 1; first row when mt_counter reaches speed 6
    frames(rt, 8)
    const plays = audio.events.filter((e) => e.kind === 'play')
    expect(plays).toHaveLength(1)
    expect(plays[0]).toMatchObject({ voice: 0, freq: periodToHz(0x1ac), volume: 40 })
    // the trigger itself carries no repeat: Tracker pokes the second half of
    // the sample ($a0/$a4) at the top of the NEXT interrupt (+Music.s:1678)
    expect(plays[0]!.loopStart).toBe(-1)
    frames(rt, 1)
    // and then the conventional 1-word repeat loops two bytes, as on the Amiga
    const loops = audio.events.filter((e) => e.kind === 'loop')
    expect(loops).toHaveLength(1)
    expect(loops[0]).toMatchObject({ voice: 0, loopStart: 0, loopEnd: 2 })
    expect(rt.vuBytes[0]).toBe(40)
    expect(rt.music.mtOn).toBe(true)
  })

  it('stops at song end without Track Loop, loops with it (mt_next +Music.s:1760)', () => {
    const { rt } = boot('Track Play', trackerBank())
    frames(rt, 90) // 64 rows at speed 1 + the lead-in
    expect(rt.music.mtOn).toBe(false)
    const { rt: rt2, audio: a2 } = boot('Track Loop On\nTrack Play', trackerBank())
    frames(rt2, 200)
    expect(rt2.music.mtOn).toBe(true)
    expect(a2.events.filter((e) => e.kind === 'play').length).toBeGreaterThan(1)
  })

  it('Track Stop silences all four voices (InTrackStop +Music.s:4229)', () => {
    const { rt, audio } = boot('Track Play\nWait 10\nTrack Stop', trackerBank())
    frames(rt, 20)
    expect(rt.music.mtOn).toBe(false)
    expect(audio.events.filter((e) => e.kind === 'stop').length).toBeGreaterThanOrEqual(4)
  })

  it('separates "bank not reserved" from "not a tracker module" (+Lib.s:8082 / +Music.s:4356)', () => {
    // Bnk.OrAdr runs BEFORE the name compares and raises its own error:
    // `Rbsr L_Bnk.GetAdr / Rbeq L_BkNoRes`. A bare Track Play is bank 6, so a
    // program whose module sits anywhere else gets the bank error and never
    // reaches the compares. Ant Wars 1.1 is that program, with its module in 7.
    expect(() => boot('Track Play', musicBank(BASIC)).rt.runHeadless(2)).toThrow(/bank not reserved/i)
    // a bank that IS there and is misnamed reaches `cmp.l #"Trac",-8(a2)`
    const misnamed: MemoryBank = { kind: 'memory', number: 6, memType: 1, name: 'Music', flags: 0, data: modFile() }
    expect(() => boot('Track Play', misnamed).rt.runHeadless(2)).toThrow(/not a tracker module/i)
    // and the compare is the whole 8-byte name, so a prefix is not enough
    const nearly: MemoryBank = { kind: 'memory', number: 6, memType: 1, name: 'Traces', flags: 0, data: modFile() }
    expect(() => boot('Track Play', nearly).rt.runHeadless(2)).toThrow(/not a tracker module/i)
    // the real thing, named exactly "Tracker ", plays
    expect(() => boot('Track Play', trackerBank()).rt.runHeadless(2)).not.toThrow()
  })

  it('Track Load pulls a file into the bank and Track Play uses it (InTrackLoad +Music.s:4120)', () => {
    const audio = new NullAudio()
    const mod = modFile()
    const rt = new Runtime(tokenize('Track Load "song.mod",6\nTrack Play', table, extensions), table, {
      extensions,
      audio,
      maxSteps: 100_000,
      onText: () => {},
      fs: { read: (p: string) => (p === 'song.mod' ? mod : null) },
    })
    frames(rt, 10)
    expect(rt.memBanks.get(6)?.name).toBe('Tracker')
    expect(rt.music.mtOn).toBe(true)
    expect(audio.events.some((e) => e.kind === 'play')).toBe(true)
  })

  it('the tracker only steps while no bank music plays (Music: beq Tracker +Music.s:1138)', () => {
    const audio = new NullAudio()
    const rt = new Runtime(tokenize('Music 1\nTrack Play\nWait 10\nMusic Off', table, extensions), table, {
      extensions,
      audio,
      banks: [musicBank(BASIC, { loopSong: true }), trackerBank()],
      maxSteps: 100_000,
      onText: () => {},
    })
    frames(rt, 8)
    // while the music plays, the tracker is installed but silent
    expect(rt.music.mtOn).toBe(true)
    expect(audio.events.filter((e) => e.kind === 'play').every((e) => e.freq !== periodToHz(0x1ac))).toBe(true)
    frames(rt, 20)
    // Music Off frees the vbl for the tracker
    expect(audio.events.filter((e) => e.kind === 'play').some((e) => e.freq === periodToHz(0x1ac))).toBe(true)
  })
})

describe.skipIf(!existsSync(join(__dirname, '../../fixtures/official-amos/Examples/Music/Mod.Tracker')))('the real Mod.Tracker module', () => {
  const path = join(__dirname, '../../fixtures/official-amos/Examples/Music/Mod.Tracker')

  it('replays with sensible Paula periods on several voices', () => {
    const bank: MemoryBank = { kind: 'memory', number: 6, memType: 1, name: 'Tracker', flags: 0, data: new Uint8Array(readFileSync(path)) }
    const { rt, audio } = boot('Track Loop On\nTrack Play', bank)
    frames(rt, 400)
    expect(rt.music.mtOn).toBe(true)
    const plays = audio.events.filter((e) => e.kind === 'play')
    expect(plays.length).toBeGreaterThan(4)
    expect(new Set(plays.map((p) => p.voice)).size).toBeGreaterThan(1)
    for (const p of plays) {
      expect(p.freq!).toBeGreaterThanOrEqual(periodToHz(0x358) - 1)
      expect(p.freq!).toBeLessThanOrEqual(periodToHz(0x71) + 1)
    }
  })
})

describe('Sam Swap / Sload / Ssave', () => {
  const sampBank2: MemoryBank = (() => {
    const rec = [
      ...[...'TICK    '].map((c) => c.charCodeAt(0)),
      0x20, 0xab,
      0, 0, 0, 100,
      ...new Array(100).fill(7),
    ]
    return { kind: 'memory', number: 5, memType: 1, name: 'Samples', flags: 0, data: new Uint8Array([0, 1, 0, 0, 0, 6, ...rec]) }
  })()

  it('Sam Swap chains a second buffer when the first ends (Sami .swap +Music.s:1085)', () => {
    const audio = new NullAudio()
    const rt = new Runtime(
      tokenize('Reserve As Work 10,1000\nSam Play %0001,1,8000\nSam Swap %0001 To Start(10),400', table, extensions),
      table,
      { extensions, audio, banks: [sampBank2], maxSteps: 100_000, onText: () => {} },
    )
    rt.frame() // statements run; the vbl has not yet seen the sample end
    // playing, swap queued
    expect(rt.music.samState[0]).toBe(0)
    // 100 bytes at ~8kHz ends within a frame; the swap takes over
    rt.frame()
    expect(rt.music.samState[0]).toBe(-1)
    const plays = audio.events.filter((e) => e.kind === 'play' && e.voice === 0)
    expect(plays).toHaveLength(2)
    expect(plays[1]!.length).toBe(400)
    // and when the swap buffer itself ends, the voice reads 1
    for (let i = 0; i < 20; i++) rt.frame()
    expect(rt.music.samState[0]).toBe(1)
  })

  it('Sam Swapped validates the voice (FnSamSwapped +Music.s:4055)', () => {
    expect(() => boot('Print Sam Swapped(4)', musicBank(BASIC)).rt.runHeadless(2)).toThrow(/illegal function call/i)
    const { rt } = boot('Print Sam Swapped(0)', musicBank(BASIC))
    let out = ''
    rt.interp.io.write = (t) => (out += t)
    rt.runHeadless(3)
    expect(out.trim()).toBe('1') // idle voice: interrupts off
  })

  it('Sload reads channel bytes into memory, Ssave writes them out (+Music.s:3239/4426)', () => {
    const fs = new AmigaFS()
    const vol = fs.mountMemory('DH0')
    vol.write(['in.raw'], Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]))
    const rt = new Runtime(
      tokenize(
        'Reserve As Work 10,16\nOpen In 1,"in.raw"\nSload 1 To Start(10),8\nClose 1\n' +
          'Open Out 2,"out.raw"\nSsave 2,Start(10) To Start(10)+4\nClose 2',
        table,
        extensions,
      ),
      table,
      { extensions, audio: new NullAudio(), maxSteps: 100_000, onText: () => {}, fs },
    )
    rt.runHeadless(10)
    const bank = rt.memBanks.get(10)!
    expect([...bank.data.slice(0, 8)]).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect([...(fs.read('out.raw') ?? [])]).toEqual([1, 2, 3, 4])
  })

  it('Sload/Ssave validate channels and ranges', () => {
    expect(() => boot('Sload 11 To 10,4', musicBank(BASIC)).rt.runHeadless(2)).toThrow(/illegal function call/i)
    expect(() => boot('Ssave 1,100 To 100', musicBank(BASIC)).rt.runHeadless(2)).toThrow(/illegal function call/i)
  })
})

describe.skipIf(!existsSync(join(__dirname, '../../fixtures/official-amos/Examples/Music/Med_Module')))('the MED player', () => {
  const medPath = join(__dirname, '../../fixtures/official-amos/Examples/Music/Med_Module')

  function medBoot(src: string): { rt: Runtime; audio: NullAudio } {
    const audio = new NullAudio()
    const mod = new Uint8Array(readFileSync(medPath))
    const rt = new Runtime(tokenize(src, table, extensions), table, {
      extensions,
      audio,
      maxSteps: 100_000,
      onText: () => {},
      fs: { read: (p: string) => (p === 'mod.med' ? mod : null) },
    })
    return { rt, audio }
  }

  it('Med Load banks the module; bad magic erases the bank (InMedLoad +Music.s:4456)', () => {
    const { rt } = medBoot('Med Load "mod.med",7')
    frames(rt, 3)
    expect(rt.memBanks.get(7)?.name).toBe('Med')
    expect(rt.music.med.bank).toBe(7)
    const audio = new NullAudio()
    const rt2 = new Runtime(tokenize('Med Load "bad.med",7', table, extensions), table, {
      extensions, audio, maxSteps: 100_000, onText: () => {},
      fs: { read: () => new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]) },
    })
    expect(() => rt2.runHeadless(3)).toThrow(/not a med module/i)
    expect(rt2.memBanks.get(7)).toBeUndefined()
  })

  it('Med Play replays the shipped MMD0 module (reimplemented MMD replay)', () => {
    const { rt, audio } = medBoot('Med Load "mod.med",7\nMed Play')
    frames(rt, 400)
    expect(rt.music.med.on).toBe(true)
    const plays = audio.events.filter((e) => e.kind === 'play')
    expect(plays.length).toBeGreaterThan(2)
    // A sampled instrument enters the row 24 words in ($212ca8 holds sixteen
    // pointers and every one is $212088 + 48 + row * 192), so its notes are
    // ProTracker's three octaves. Reading the row from word 0 put this module
    // two octaves down and nothing here noticed.
    for (const p of plays) {
      expect(p.freq!).toBeGreaterThanOrEqual(periodToHz(856) - 1)
      expect(p.freq!).toBeLessThanOrEqual(periodToHz(113) + 1)
    }
  })

  it('Med Stop silences, Med Cont resumes (InMedStop/Cont +Music.s:4588/4732)', () => {
    const { rt, audio } = medBoot('Med Load "mod.med",7\nMed Play\nWait 100\nMed Stop')
    frames(rt, 200)
    expect(rt.music.med.on).toBe(false)
    const count = audio.events.filter((e) => e.kind === 'play').length
    rt.music.med.cont()
    frames(rt, 200)
    expect(rt.music.med.on).toBe(true)
    expect(audio.events.filter((e) => e.kind === 'play').length).toBeGreaterThan(count)
  })

  it('Med Play errors on a non-Med bank (error 189, +Music.s:4663)', () => {
    expect(() => boot('Med Play', musicBank(BASIC)).rt.runHeadless(3)).toThrow(/not a med module/i)
  })
})

describe.skipIf(!existsSync(join(__dirname, '../../fixtures/official-amos/Examples/Music/Music.abk')))('the real Music.abk', () => {
  const path = join(__dirname, '../../fixtures/official-amos/Examples/Music/Music.abk')

  it('parses as bank 3 and plays through the player', () => {
    const file = parseAmosFile(readFileSync(path))
    const bank = file.banks.find((b) => b.kind === 'memory')!
    expect(bank.number).toBe(3)
    expect(bank.name.startsWith('Musi')).toBe(true)
    const { rt, audio } = boot('Music 1', bank)
    frames(rt, 300)
    const plays = audio.events.filter((e) => e.kind === 'play')
    expect(plays.length).toBeGreaterThan(4)
    // real songs use several voices
    expect(new Set(plays.map((p) => p.voice)).size).toBeGreaterThan(1)
    expect(rt.music.playing).toBe(true)
  })

  it('Music Off silences it', () => {
    const file = parseAmosFile(readFileSync(path))
    const bank = file.banks.find((b) => b.kind === 'memory')!
    const { rt, audio } = boot('Music 1\nWait 50\nMusic Off', bank)
    frames(rt, 120)
    expect(rt.music.playing).toBe(false)
    expect(audio.events.some((e) => e.kind === 'stop')).toBe(true)
  })
})

describe('the one-vbl repeat latch (Tracker +Music.s:1678-1688)', () => {
  it('a trigger plays the whole sample; the repeat pointers arrive next frame', () => {
    // The interrupt sets AUDxLC/LEN to the full sample and enables DMA, then
    // pokes the REPEAT pointers ($a0/$a4) at the top of the FOLLOWING
    // interrupt. So the first pass always plays in full and looping only
    // takes hold from the next vbl — writing the loop at trigger time would
    // cut a one-shot attack short.
    const { rt, audio } = boot('Music 1', musicBank(BASIC, { loopInst: true }))
    frames(rt, 2)
    const plays = audio.events.filter((e) => e.kind === 'play')
    expect(plays).toHaveLength(1)
    // no loop on the trigger itself
    expect(plays[0]!.loopStart).toBe(-1)
    expect(audio.events.filter((e) => e.kind === 'loop')).toHaveLength(0)

    // the very next frame latches the repeat region
    frames(rt, 1)
    const loops = audio.events.filter((e) => e.kind === 'loop')
    expect(loops).toHaveLength(1)
    expect(loops[0]!.voice).toBe(0)
    expect(loops[0]!.loopStart).toBeGreaterThanOrEqual(0)
  })

  it('a one-shot instrument never latches a repeat at all', () => {
    const { rt, audio } = boot('Music 1', musicBank(BASIC))
    frames(rt, 4)
    expect(audio.events.filter((e) => e.kind === 'play').length).toBeGreaterThan(0)
    expect(audio.events.filter((e) => e.kind === 'loop')).toHaveLength(0)
  })
})
