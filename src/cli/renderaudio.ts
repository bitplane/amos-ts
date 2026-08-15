/**
 * Render a module to a WAV through this port's own replayer and mixer.
 *
 *   npm run cli -- src/cli/renderaudio.ts <module> <out.wav> [--engine E]
 *                  [--seconds N] [--rate N] [--filter on|off] [--gain G]
 *
 * Written for #130, which exists because pointing this at one MED module and
 * comparing the result with another player's found two bugs in an afternoon
 * that 5,401 passing tests had not. The engines here had never been heard by
 * anything: every audio test in this port reads the sequence of calls a
 * replayer makes to `AudioSink`, so a test can only ever confirm the reading
 * that produced it. A rendered WAV can be compared with somebody else's.
 *
 * `src/cli/audiocmp.ts` is the other half. ffmpeg on this machine is built
 * with libopenmpt, so `ffmpeg -i mod.x -t 30 -ar 44100 ref.wav` is an
 * independent reading of MOD, MED and most other tracker formats. It does NOT
 * read THX, and nothing on this machine does.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { PaulaMixer } from '../amiga/mixer'
import { VBL_HZ } from '../amiga/paula'
import { Protracker, parseMod } from '../amiga/protracker'
import { ThxPlayer } from '../amiga/thxplay'
import { thxParse } from '../amiga/thx'
import { p61Song, p61ToMod, parseP61 } from '../amiga/p61'
import { SoundFx, parseSfx } from '../amiga/soundfx'
import { Fc14, parseFc14 } from '../amiga/fc14'
import { Fc13, parseFc13 } from '../amiga/fc13'
import { DigiPlayer } from '../amiga/digiplay'
import { parseDigi } from '../amiga/digi'
import { SoundMon } from '../amiga/soundmonplay'
import { parseSmon } from '../amiga/soundmon'
import { MedPlayer } from '../runtime/med'
import { Runtime } from '../runtime/runtime'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { EXTENSION_TOKENS } from '../ext/registry'
import type { MemoryBank } from '../loader/amosfile'

export type Engine = 'mod' | 'p61' | 'thx' | 'med' | 'sfx' | 'fc14' | 'fc13' | 'digi' | 'smon' | 'track' | 'medext'

/**
 * What the first bytes say it is.
 *
 * MOD is last because it is the one with no magic at the front: the four-byte
 * tag sits at 1080, after 31 sample headers and the pattern order, and a
 * 15-sample module has no tag at all. `parseMod` decides that part.
 */
export function detectEngine(d: Uint8Array): Engine | null {
  const tag = (at: number, n = 4): string => String.fromCharCode(...d.subarray(at, at + n))
  if (tag(0) === 'MMD0' || tag(0) === 'MMD1' || tag(0) === 'MMD2' || tag(0) === 'MMD3') return 'med'
  if (tag(0, 3) === 'THX' || tag(0, 3) === 'HVL') return 'thx'
  if (tag(0) === 'P61A') return 'p61'
  if (tag(0) === 'FC14') return 'fc14'
  if (tag(0) === 'SMOD') return 'fc13'
  if (tag(0) === 'DIGI') return 'digi'
  if (d.length > 0x200 && tag(0x1a, 3) === 'V.2') return 'smon'
  // SoundFX 1.3's magic sits at 60, behind the fifteen sample lengths, and is
  // the only thing DME_SoundFX1.3.library checks
  if (d.length > 0x294 && tag(0x3c) === 'SONG') return 'sfx'
  if (d.length > 1084 && ['M.K.', 'M!K!', 'FLT4', '4CHN', 'M&K!'].includes(tag(1080))) return 'mod'
  return null
}

/** interleaved stereo out of an engine, at `rate` frames a second */
export function renderModule(
  data: Uint8Array,
  engine: Engine,
  opts: { seconds: number; rate: number; filter: boolean },
): Float32Array {
  const blocks: Float32Array[] = []
  const mix = new PaulaMixer({ rate: opts.rate, filter: opts.filter, onBlock: (b) => blocks.push(b) })
  const frames = Math.round(opts.seconds * VBL_HZ)

  if (engine === 'mod' || engine === 'p61') {
    const song = engine === 'mod' ? parseMod(data) : p61(data)
    if (!song) throw new Error(`not a ${engine} module`)
    const pt = new Protracker(() => mix)
    // the P61 arm is Player 6.1A and tests the speed with `beq`; `mod` stands
    // for the mt_ family, which is the shared replay's default. See `rowDue`.
    pt.speedIsEquality = engine === 'p61'
    pt.load(song)
    pt.playing = true
    for (let f = 0; f < frames; f++) {
      pt.tick()
      mix.runTo((f + 1) / VBL_HZ)
    }
  } else if (engine === 'thx') {
    const player = new ThxPlayer(() => mix)
    player.load(thxParse(data))
    for (let f = 0; f < frames; f++) {
      player.tick()
      mix.runTo((f + 1) / VBL_HZ)
    }
  } else if (engine === 'fc14') {
    const song = parseFc14(data)
    if (!song) throw new Error('not a FutureComposer 1.4 module')
    const fc = new Fc14(() => mix)
    fc.load(song)
    for (let f = 0; f < frames; f++) {
      fc.tick()
      mix.runTo((f + 1) / VBL_HZ)
    }
  } else if (engine === 'smon') {
    const song = parseSmon(data)
    if (!song) throw new Error('not a BP SoundMon 2.0 module')
    const sm = new SoundMon(() => mix)
    sm.load(song)
    for (let f = 0; f < frames; f++) {
      sm.tick()
      mix.runTo((f + 1) / VBL_HZ)
    }
  } else if (engine === 'digi') {
    const song = parseDigi(data)
    if (!song) throw new Error('not a DigiBooster 1.x module')
    const dp = new DigiPlayer(() => mix)
    dp.load(song)
    // the CIA rate is the module's own, and `Fxx` above $1f moves it
    let t = 0
    while (t < opts.seconds) {
      dp.tick()
      t += 1 / dp.tickHz
      mix.runTo(t)
    }
  } else if (engine === 'fc13') {
    const song = parseFc13(data)
    if (!song) throw new Error('not a FutureComposer 1.0-1.3 module')
    const fc = new Fc13(() => mix)
    fc.load(song)
    for (let f = 0; f < frames; f++) {
      fc.tick()
      mix.runTo((f + 1) / VBL_HZ)
    }
  } else if (engine === 'sfx') {
    const song = parseSfx(data)
    if (!song) throw new Error('not a SoundFX 1.3 module')
    const fx = new SoundFx(() => mix)
    fx.load(song)
    for (let f = 0; f < frames; f++) {
      fx.tick()
      mix.runTo((f + 1) / VBL_HZ)
    }
  } else if (engine === 'med') {
    let tick = 0
    const player = new MedPlayer({
      audio: mix,
      tick: () => tick,
      getBank: () => ({ name: 'Med', data }),
    })
    player.play(7, 0)
    for (let f = 0; f < frames; f++) {
      tick++
      player.vbl()
      mix.runTo(tick / VBL_HZ)
    }
  } else {
    // AMOS's own replayers, which are reached through the interpreter rather
    // than driven directly: the bank is what `Track Play` and `Med Play` read.
    const track = engine === 'track'
    const bank: MemoryBank = {
      kind: 'memory',
      number: track ? 6 : 7,
      memType: 1,
      name: track ? 'Tracker' : 'Med',
      flags: 0,
      data: new Uint8Array(data),
    }
    const table = new TokenTable(CORE_TOKENS)
    const extensions = new Map([...EXTENSION_TOKENS].map(([slot, defs]) => [slot, new TokenTable(defs)]))
    const source = track ? 'Track Loop On\nTrack Play\nDo\nLoop\n' : 'Med Play\nDo\nLoop\n'
    const rt = new Runtime(tokenize(source, table, extensions), table, {
      extensions,
      banks: [bank],
      audio: mix,
      onText: () => {},
      maxSteps: 100_000,
    })
    for (let f = 0; f < frames; f++) rt.frame()
  }

  const total = blocks.reduce((n, b) => n + b.length, 0)
  const out = new Float32Array(total)
  let at = 0
  for (const b of blocks) {
    out.set(b, at)
    at += b.length
  }
  return out
}

/** P61 with its samples in the same file, which is how a bank holds one */
function p61(data: Uint8Array): ReturnType<typeof p61Song> | null {
  const m = parseP61(data)
  return m ? p61Song(m) : null
}

/**
 * 16-bit stereo WAV.
 *
 * `gain` is applied before the clamp and defaults to a half, because a channel
 * is two voices and `PaulaMixer` hands over the analog sum unscaled: full
 * scale on both voices of one channel is 2.0. See src/amiga/mixer.ts.
 */
export function wavBytes(pcm: Float32Array, rate: number, gain = 0.5): Buffer {
  const body = Buffer.alloc(pcm.length * 2)
  for (let i = 0; i < pcm.length; i++) {
    const v = Math.max(-1, Math.min(1, pcm[i]! * gain))
    body.writeInt16LE(Math.round(v * 32767), i * 2)
  }
  const head = Buffer.alloc(44)
  head.write('RIFF', 0)
  head.writeUInt32LE(36 + body.length, 4)
  head.write('WAVE', 8)
  head.write('fmt ', 12)
  head.writeUInt32LE(16, 16)
  head.writeUInt16LE(1, 20)
  head.writeUInt16LE(2, 22)
  head.writeUInt32LE(rate, 24)
  head.writeUInt32LE(rate * 4, 28)
  head.writeUInt16LE(4, 32)
  head.writeUInt16LE(16, 34)
  head.write('data', 36)
  head.writeUInt32LE(body.length, 40)
  return Buffer.concat([head, body])
}

if (process.argv[1]?.endsWith('renderaudio.ts')) {
  const args = process.argv.slice(2)
  const opt = (name: string): string | undefined => {
    const i = args.indexOf(name)
    return i >= 0 ? args[i + 1] : undefined
  }
  const flags = new Set<string>()
  for (const name of ['--engine', '--seconds', '--rate', '--filter', '--gain', '--to-mod']) {
    const v = opt(name)
    if (v !== undefined) flags.add(v)
  }
  const files = args.filter((a) => !a.startsWith('--') && !flags.has(a))
  const [file, out] = files
  if (!file || !out) {
    console.error('usage: renderaudio <module> <out.wav> [--engine mod|p61|thx|med|sfx|fc14|fc13|digi|smon|track|medext]')
    console.error('                   [--seconds N] [--rate N] [--filter on|off] [--gain G]')
    console.error('       renderaudio <module.p61> - --to-mod out.mod')
    process.exit(1)
  }
  const data = new Uint8Array(readFileSync(file))
  // P61 is the one format no other player on this machine reads. Writing the
  // unpacked patterns back out as a MOD is how it gets a second opinion at
  // all: see `p61ToMod`, including what the round trip cannot preserve.
  const toMod = opt('--to-mod')
  if (toMod !== undefined) {
    const m = parseP61(data)
    if (!m) {
      console.error(`${file}: not a P61 module`)
      process.exit(1)
    }
    const mod = p61ToMod(m)
    writeFileSync(toMod, mod)
    console.log(`${toMod}: ${mod.length} bytes, ${m.patternOffsets.length} patterns, ${m.samples.length} samples`)
    process.exit(0)
  }
  const engine = (opt('--engine') as Engine | undefined) ?? detectEngine(data)
  if (!engine) {
    console.error(`${file}: no engine recognises this. Name one with --engine.`)
    process.exit(1)
  }
  const rate = parseInt(opt('--rate') ?? '44100', 10)
  const seconds = Number(opt('--seconds') ?? 30)
  const filter = opt('--filter') !== 'off'
  const gain = Number(opt('--gain') ?? 0.5)
  const pcm = renderModule(data, engine, { seconds, rate, filter })
  writeFileSync(out, wavBytes(pcm, rate, gain))

  let peak = 0
  let sum = 0
  for (const s of pcm) {
    peak = Math.max(peak, Math.abs(s))
    sum += s * s
  }
  const rms = Math.sqrt(sum / Math.max(1, pcm.length))
  console.log(
    `${out}: ${engine}, ${(pcm.length / 2 / rate).toFixed(2)}s, ` +
      `peak ${peak.toFixed(3)} of 2.0, RMS ${(20 * Math.log10(rms * gain)).toFixed(1)}dB, ` +
      `filter ${filter ? 'on' : 'off'}${peak * gain > 1 ? ', CLIPPED' : ''}`,
  )
}
