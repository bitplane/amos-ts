import { describe, expect, it } from 'vitest'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS, EXTENSION_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { Runtime } from './runtime'
import { NullAudio, parseSampleBank, bellPcm } from './audio'
import type { MemoryBank } from '../loader/amosfile'

const table = new TokenTable(CORE_TOKENS)
const extensions = new Map([...EXTENSION_TOKENS].map(([slot, defs]) => [slot, new TokenTable(defs)]))

/** synthetic Samples bank: one 4-byte sample named TICK at 8363 Hz */
function sampleBank(): MemoryBank {
  const rec = [
    ...[...'TICK    '].map((c) => c.charCodeAt(0)),
    0x20, 0xab, // freq 8363
    0, 0, 0, 4, // length
    10, 20, 30, 40, // pcm
  ]
  const data = new Uint8Array([0, 1, 0, 0, 0, 6, ...rec])
  return { kind: 'memory', number: 5, memType: 1, name: 'Samples', flags: 0, data }
}

function run(src: string, frames = 100): { rt: Runtime; audio: NullAudio } {
  const audio = new NullAudio()
  const rt = new Runtime(tokenize(src, table, extensions), table, {
    extensions,
    audio,
    banks: [sampleBank()],
    maxSteps: 100_000,
  })
  rt.runHeadless(frames)
  return { rt, audio }
}

describe('sample bank', () => {
  it('parses count, offsets and records', () => {
    const entries = parseSampleBank(sampleBank().data)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.name).toBe('TICK')
    expect(entries[0]!.freq).toBe(8363)
    expect([...entries[0]!.pcm]).toEqual([10, 20, 30, 40])
  })
})

describe('sample playback', () => {
  it('plays on all voices with the bank frequency by default', () => {
    const { audio } = run('Sam Play 1')
    const plays = audio.events.filter((e) => e.kind === 'play')
    expect(plays).toHaveLength(4)
    expect(plays[0]).toMatchObject({ freq: 8363, length: 4, loop: false })
  })

  it('respects voice masks and frequency overrides', () => {
    const { audio } = run('Sam Play %101,1,4000')
    const plays = audio.events.filter((e) => e.kind === 'play')
    expect(plays.map((p) => p.voice)).toEqual([0, 2])
    expect(plays[0]!.freq).toBe(4000)
  })

  it('errors on undefined samples', () => {
    expect(() => run('Sam Play 7')).toThrow(/sample not defined/i)
  })

  it('loops when Sam Loop On is active and stops with Sam Stop', () => {
    const { audio } = run('Sam Loop On\nSam Play 1\nSam Stop')
    const play = audio.events.find((e) => e.kind === 'play')!
    expect(play.loop).toBe(true)
    expect(audio.events.some((e) => e.kind === 'stop')).toBe(true)
  })

  it('applies Volume to selected voices', () => {
    const { audio, rt } = run('Volume %0011,20')
    expect(rt.voices[0]!.volume).toBe(20)
    expect(rt.voices[2]!.volume).toBe(63)
    expect(audio.events.filter((e) => e.kind === 'volume')).toHaveLength(2)
  })
})

describe('effects and vumeter', () => {
  it('synthesizes Bell, Shoot and Boom', () => {
    const { audio } = run('Bell 60\nShoot\nBoom')
    const plays = audio.events.filter((e) => e.kind === 'play')
    expect(plays.map((p) => p.voice)).toEqual([0, 1, 2])
    expect(plays.every((p) => (p.length ?? 0) > 500)).toBe(true)
  })

  it('bell pitch changes the tone', () => {
    const low = bellPcm(20).pcm
    const high = bellPcm(80).pcm
    // higher pitch → more zero crossings in the same window
    const crossings = (p: Int8Array): number => {
      let n = 0
      for (let i = 1; i < 2000; i++) if ((p[i - 1]! < 0) !== (p[i]! < 0)) n++
      return n
    }
    expect(crossings(high)).toBeGreaterThan(crossings(low) * 2)
  })

  it('Vumeter reports activity while a voice is busy, silence after', () => {
    const audio = new NullAudio()
    const rt = new Runtime(
      tokenize('Sam Play %0001,1,50\nWait 1\nPrint Vumeter(0)\nWait 200\nPrint Vumeter(0)', table, extensions),
      table,
      { extensions, audio, banks: [sampleBank()], maxSteps: 100_000, onText: () => {} },
    )
    let out = ''
    rt.interp.io.write = (t) => (out += t)
    rt.runHeadless(400)
    const [busy, after] = out.trim().split('\n')
    expect(parseInt(busy!, 10)).toBeGreaterThan(0)
    expect(parseInt(after!, 10)).toBe(0)
  })
})
