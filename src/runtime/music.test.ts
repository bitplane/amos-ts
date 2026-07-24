import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS, EXTENSION_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { parseAmosFile } from '../loader/amosfile'
import { Runtime } from './runtime'
import { NullAudio, periodToHz } from './audio'
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
    expect(() => boot('Music 1', noBank).rt.runHeadless(2)).toThrow(/music bank not reserved/i)
    expect(() => boot('Music 9', musicBank(BASIC)).rt.runHeadless(2)).toThrow(/music not defined/i)
    expect(() => boot('Music 0', musicBank(BASIC)).rt.runHeadless(2)).toThrow(/illegal function call/i)
    expect(() => boot('Tempo 101', musicBank(BASIC)).rt.runHeadless(2)).toThrow(/illegal function call/i)
    expect(() => boot('Mvolume 64', musicBank(BASIC)).rt.runHeadless(2)).toThrow(/illegal function call/i)
  })
})

describe('the real Music.abk', () => {
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
