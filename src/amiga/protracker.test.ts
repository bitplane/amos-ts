/**
 * The ProTracker replay, checked three ways.
 *
 * 1. The two tables against the SHIPPED library. Neither is in the source —
 *    `610.2_devpac3.asm` `incbin`s `data/p61a.periods` and `data/p61a.vibtab`
 *    and the distribution has no data directory — so both were read out of
 *    the assembled `AMOSPro_P61.Lib`. A transcription with no way back to its
 *    origin is a guess with good handwriting; these tests are the way back.
 *
 * 2. `parseMod` against REAL modules. Five of them, from the corpus rather
 *    than built here: two are AMCAF's own example data, one ships with the
 *    Personnal demo, and two are from the AMOS PD library. A hand-made module
 *    would only prove the reader agrees with the builder, which is exactly the
 *    trap the CTLG reader fell into.
 *
 * 3. The effects against the assembly. These use small synthetic songs, and
 *    that is legitimate where a synthetic FILE is not: the oracle is a named
 *    routine in `610.2_devpac3.asm`, quoted in each test, not a layout this
 *    file invented.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { AMIGA_PERIODS, NullAudio, periodToHz } from './paula'
import {
  FINETUNE_STRIDE_BYTES,
  PT_PERIODS,
  PT_PERIODS_PER_ROW,
  PT_ROWS,
  PT_SINE,
  PT_VIBRATO,
  Protracker,
  parseMod,
} from './protracker'
import type { PtRow, PtSample, PtSong } from './protracker'

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures')
const P61_LIB = join(fixtures, 'extensions', 'p61-1.2', 'AMOSPro_P61.Lib')

/* ------------------------------------------------------------------ *
 * 1. the tables, against the binary that carries them
 * ------------------------------------------------------------------ */

describe.skipIf(!existsSync(P61_LIB))('the tables came out of the shipped library', () => {
  const lib = existsSync(P61_LIB) ? readFileSync(P61_LIB) : Buffer.alloc(0)

  /**
   * `P61_periods` at file offset $aa8: sixteen rows of thirty-seven words.
   *
   * The offset is not a guess — it is where the 856, 808, 762 run starts, one
   * word past the duplicate that opens the row, and the sixteen rows that
   * follow are contiguous and end at $f48.
   */
  it('has the period table, word for word, all 592 of them', () => {
    const at = 0xaa8
    const mismatches: string[] = []
    for (let i = 0; i < 16 * PT_PERIODS_PER_ROW; i++) {
      const want = lib.readUInt16BE(at + i * 2)
      if (PT_PERIODS[i] !== want) mismatches.push(`${i}: ${PT_PERIODS[i]} vs ${want}`)
    }
    expect(mismatches).toEqual([])
  })

  /**
   * `P61_vibtab` at $17a6, and this one is DERIVED rather than transcribed.
   *
   * 512 constants would be 512 chances to mistype one, so the table is
   * computed as `(sine * depth) >> 7` — and the only reason that is allowed to
   * stand as evidence is this comparison, which says the derivation is the
   * shipped bytes and not merely the shape of them.
   */
  it('derives the vibrato table to the same 512 bytes', () => {
    const at = 0x17a6
    expect([...PT_VIBRATO]).toEqual([...lib.subarray(at, at + 512)])
  })

  /**
   * The thirty-seventh word, which is why the table is flat.
   *
   * Entry 0 of every row repeats entry 1. It exists so that the arpeggio's
   * `add d0,P61_Note(a5)` can run past the top of a row without leaving the
   * table, and dropping it would silently turn a 37-word stride into 36 and
   * put every finetune above 0 a semitone out.
   */
  it('keeps the duplicated entry 0 that sets the stride at 37', () => {
    for (let r = 0; r < 16; r++) {
      const base = r * PT_PERIODS_PER_ROW
      expect(PT_PERIODS[base]).toBe(PT_PERIODS[base + 1])
    }
    expect(FINETUNE_STRIDE_BYTES).toBe(PT_PERIODS_PER_ROW * 2)
  })

  /**
   * `AMIGA_PERIODS` IS row 0 now, taken from this table rather than written
   * out beside it. The check is kept because it is what makes the derivation
   * legible: the thirty-six the rest of the port calls "the Amiga periods" are
   * the untuned row of the replay's sixteen, minus the duplicate at index 0.
   */
  it('is where AMIGA_PERIODS comes from — the untuned row, less the duplicate', () => {
    expect([...PT_PERIODS.subarray(1, 37)]).toEqual([...AMIGA_PERIODS])
    expect(AMIGA_PERIODS).toHaveLength(36)
  })

  /**
   * The independent corroboration, and the only place AMOS's own transcription
   * of it is recorded.
   *
   * `Sinus` at +Music.s:2146 is thirty-two `dc.b`s in a library that has
   * nothing to do with Player 6.1A, and they are the same thirty-two numbers.
   * Two Amiga replayers shipping the same table is what makes one copy of it
   * in `notes.ts` the right number of copies.
   */
  it('is the same sine AMOS ships at +Music.s:2146', () => {
    expect([...PT_SINE]).toEqual([
      0x00, 0x18, 0x31, 0x4a, 0x61, 0x78, 0x8d, 0xa1, 0xb4, 0xc5, 0xd4, 0xe0, 0xeb, 0xf4, 0xfa, 0xfd,
      0xff, 0xfd, 0xfa, 0xf4, 0xeb, 0xe0, 0xd4, 0xc5, 0xb4, 0xa1, 0x8d, 0x78, 0x61, 0x4a, 0x31, 0x18,
    ])
  })

  /** the sine is ProTracker's, symmetric about its own quarter */
  it('has the 32-point sine the vibrato walks', () => {
    expect(PT_SINE).toHaveLength(32)
    expect(PT_SINE[0]).toBe(0)
    expect(Math.max(...PT_SINE)).toBe(255)
    for (let i = 1; i < 16; i++) expect(PT_SINE[i]).toBe(PT_SINE[32 - i])
  })
})

/* ------------------------------------------------------------------ *
 * 2. parseMod, against modules nobody here made
 * ------------------------------------------------------------------ */

function* walk(p: string): Generator<string> {
  for (const e of readdirSync(p)) {
    const f = join(p, e)
    if (statSync(f).isDirectory()) yield* walk(f)
    else if (statSync(f).size > 1084) yield f
  }
}

/** every file in the fixtures tree that IS a ProTracker module, by signature */
const modules = existsSync(fixtures)
  ? [...walk(fixtures)].filter((f) => {
      const b = readFileSync(f)
      const sig = String.fromCharCode(...b.subarray(1080, 1084))
      return sig === 'M.K.' || sig === 'M!K!'
    })
  : []

describe.skipIf(modules.length === 0)('real modules parse', () => {
  it('found some', () => {
    expect(modules.length).toBeGreaterThanOrEqual(3)
  })

  for (const f of modules) {
    const name = f.slice(fixtures.length + 1)
    it(`reads ${name}`, () => {
      const s = parseMod(readFileSync(f))
      expect(s).not.toBeNull()
      const song = s!

      // a song that plays: at least one position, and every one of them
      // naming a pattern the file actually holds
      expect(song.positions.length).toBeGreaterThan(0)
      for (const p of song.positions) expect(p).toBeLessThan(128)

      // at least one sample with data — a module with none is a MED in
      // disguise or a truncated file, and either way not what was loaded
      const used = song.samples.filter((x) => x && x.pcm.length > 0)
      expect(used.length).toBeGreaterThan(0)
      for (const smp of used) {
        expect(smp!.volume).toBeLessThanOrEqual(64)
        expect(smp!.finetune).toBeLessThan(16)
        // the repeat must lie inside the sample, which is the check that the
        // header walk stayed in step with the sample data
        if (smp!.loopLen > 2) expect(smp!.loopStart + smp!.loopLen).toBeLessThanOrEqual(smp!.pcm.length + 2)
      }

      // every cell of every pattern the song reaches
      let notes = 0
      for (const p of new Set(song.positions)) {
        const rows = song.pattern(p)
        expect(rows).toHaveLength(PT_ROWS)
        for (const r of rows) {
          expect(r).toHaveLength(4)
          for (const c of r) {
            expect(c.note).toBeGreaterThanOrEqual(0)
            expect(c.note).toBeLessThanOrEqual(36)
            expect(c.instrument).toBeLessThanOrEqual(31)
            expect(c.command).toBeLessThan(16)
            expect(c.info).toBeLessThan(256)
            if (c.note > 0) notes++
          }
        }
      }
      // a real module has notes in it; zero would mean every period missed
      // the table, which is the failure mode of a period-to-index map that
      // has drifted off the finetune-0 row
      expect(notes).toBeGreaterThan(0)
    })
  }

  /**
   * The whole point, end to end: a real module, stepped, makes sound.
   *
   * Nothing in this port did that for a ProTracker module before. The
   * assertion is deliberately about the SINK rather than about internal
   * state — internal state was always fine, and silent.
   */
  it('plays: every real module drives the voices', () => {
    const silent: string[] = []
    const voicesUsed = new Set<number>()
    for (const f of modules) {
      const audio = new NullAudio()
      const p = new Protracker(() => audio)
      p.load(parseMod(readFileSync(f))!)
      p.playing = true
      for (let i = 0; i < 6 * PT_ROWS; i++) p.tick() // one pattern at speed 6

      const plays = audio.events.filter((e) => e.kind === 'play')
      if (plays.length === 0) silent.push(f.slice(fixtures.length + 1))
      for (const e of plays) {
        voicesUsed.add(e.voice)
        // every launch at an audible rate and a real length
        expect(e.freq!).toBeGreaterThan(1000)
        expect(e.freq!).toBeLessThan(40000)
        expect(e.length!).toBeGreaterThan(0)
      }
      // and the song moved
      expect(p.row + p.pos).toBeGreaterThan(0)
    }
    expect(silent).toEqual([])
    // across the set, all four channels get used — or it is not a
    // four-channel replay, whatever one sparse intro pattern happens to do
    expect(voicesUsed).toEqual(new Set([0, 1, 2, 3]))
  })
})

/* ------------------------------------------------------------------ *
 * 3. the effects, against the assembly
 * ------------------------------------------------------------------ */

const sample = (over: Partial<PtSample> = {}): PtSample => ({
  pcm: new Int8Array(64),
  loopStart: 0,
  loopLen: 0,
  volume: 64,
  finetune: 0,
  ...over,
})

const cell = (note = 0, instrument = 0, command = 0, info = 0): PtRow => ({ note, instrument, command, info })

const row = (...cs: PtRow[]): PtRow[] => [0, 1, 2, 3].map((i) => cs[i] ?? cell())

function pattern(...rows: PtRow[][]): PtRow[][] {
  const out = [...rows]
  while (out.length < PT_ROWS) out.push(row())
  return out
}

function song(patterns: PtRow[][][], samples: (PtSample | null)[] = [sample()], positions?: number[]): PtSong {
  return {
    samples,
    positions: positions ?? patterns.map((_, i) => i),
    pattern: (n) => patterns[n] ?? pattern(),
  }
}

/** a replay wound up and ready, with the sink it drives */
function replay(s: PtSong): { p: Protracker; audio: NullAudio } {
  const audio = new NullAudio()
  const p = new Protracker(() => audio)
  p.load(s)
  p.playing = true
  return { p, audio }
}

/** run n ticks */
const run = (p: Protracker, n: number): void => {
  for (let i = 0; i < n; i++) p.tick()
}

describe('which signatures parseMod takes', () => {
  /** the smallest thing with the shape: one pattern, one position, no samples */
  const bare = (sig: string): Uint8Array => {
    const b = new Uint8Array(1084 + 1024)
    b[950] = 1 // song length
    b.set([...sig].map((c) => c.charCodeAt(0)), 1080)
    return b
  }

  it('takes ProTracker\'s two and Startrekker\'s four-channel one', () => {
    for (const sig of ['M.K.', 'M!K!', 'FLT4']) expect(parseMod(bare(sig)), sig).not.toBeNull()
  })

  it('refuses FLT8, which is eight channels interleaved and needs a mixer', () => {
    expect(parseMod(bare('FLT8'))).toBeNull()
    expect(parseMod(bare('    '))).toBeNull()
  })

  it('refuses anything shorter than a header', () => {
    expect(parseMod(new Uint8Array(1083))).toBeNull()
  })
})

describe('the tick', () => {
  /**
   * `P61_Init` leaves `P61_cn` at 0 and the speed at 6, and `P61_Music` tests
   * `d4 = cn + 1` against the speed for EQUALITY. So the first row does not
   * play until the sixth call: five ticks of nothing, then the song starts.
   *
   * That is a tenth of a second and nobody has ever heard it, but reproducing
   * it is free and inventing a "start immediately" would be a deviation with
   * no evidence behind it.
   */
  it('plays the first row on tick six, not tick one', () => {
    const { p, audio } = replay(song([pattern(row(cell(13, 1)))]))
    run(p, 5)
    expect(audio.events.filter((e) => e.kind === 'play')).toHaveLength(0)
    p.tick()
    expect(audio.events.filter((e) => e.kind === 'play')).toHaveLength(1)
    expect(p.row).toBe(1)
  })

  /**
   * `P61_cspeed` splits at 32, not at 31: `cmp.b #32,d0 / bhs P61_STempo`.
   * So `F1F` is a speed of 31 and `F20` is a tempo of 32 bpm.
   */
  it('Fxx below 32 is a speed and 32 or more is a tempo', () => {
    const { p } = replay(song([pattern(row(cell(0, 0, 0xf, 0x1f)), row(cell(0, 0, 0xf, 0x20)))]))
    run(p, 6)
    expect(p.speed).toBe(31)
    expect(p.bpm).toBe(125)
    run(p, 31)
    expect(p.bpm).toBe(32)
    expect(p.speed).toBe(31)
  })

  /**
   * `P61_Tempo` clear means "do not use tempo", and the `tst / beq
   * P61_VBlank` skips the 32 test entirely — so on a VBL-timed replay every
   * Fxx is a speed, including F20.
   */
  it('with the tempo disabled, F20 is a speed of 32', () => {
    const { p } = replay(song([pattern(row(cell(0, 0, 0xf, 0x20)))]))
    p.ciaTempo = false
    run(p, 6)
    expect(p.speed).toBe(32)
    expect(p.bpm).toBe(125)
  })

  /**
   * `F00` stores a speed of zero, and the row test is `cmp / beq` against a
   * counter that starts at 1 — so it never matches again and the song stops
   * advancing while the voices play on. Reproduced; it is how a module ends
   * without cutting itself off.
   */
  it('F00 freezes the song where it stands', () => {
    const { p } = replay(song([pattern(row(cell(0, 0, 0xf, 0)), row(cell(13, 1)))]))
    run(p, 6)
    expect(p.speed).toBe(0)
    expect(p.row).toBe(1)
    run(p, 600)
    expect(p.row).toBe(1)
  })
})

describe('the effects, row by row', () => {
  /**
   * `P61_arpeggio` indexes `P61_arplist` — `0,1,-1` repeated — by the tick
   * counter, and the two nibbles are semitone offsets from the note.
   *
   * NOTE: a P61 file stores arpeggio as command 8 and this engine takes
   * ProTracker's 0, the swap being the packer's. The period walk is the same
   * either way.
   */
  it('arpeggio steps base, high nibble, low nibble', () => {
    // C-2 is index 13 in the table; 0x37 is +3 and +7 semitones
    const { p, audio } = replay(song([pattern(row(cell(13, 1, 0x0, 0x37)))]))
    run(p, 6) // the row
    const base = PT_PERIODS[13]!
    expect(audio.events.filter((e) => e.kind === 'play')).toHaveLength(1)
    const freqs: number[] = []
    for (let i = 0; i < 3; i++) {
      p.tick()
      const f = audio.events.filter((e) => e.kind === 'freq')
      freqs.push(f.length ? f[f.length - 1]!.freq! : 0)
    }
    // tick 1 -> +3, tick 2 -> +7, tick 3 -> back to the note
    expect(freqs[0]).toBeCloseTo(periodToHz(PT_PERIODS[13 + 3]!), 3)
    expect(freqs[1]).toBeCloseTo(periodToHz(PT_PERIODS[13 + 7]!), 3)
    expect(freqs[2]).toBeCloseTo(periodToHz(base), 3)
  })

  /**
   * `P61_portup` clamps at 113 and `P61_portdwn` at 856 — `moveq #113,d0 /
   * cmp / ble` and `cmp #856 / ble`. Those are the ENDS of the untuned row,
   * so a finetuned note can slide past its own row's limits and stops at the
   * plain table's instead.
   */
  it('portamento clamps at 113 and 856, the untuned row ends', () => {
    // 1FF slides up 255 a tick and 2FF down: five ticks of either overshoots
    // both ends, so what is left is the clamp
    const { p } = replay(song([pattern(row(cell(20, 1, 0x1, 0xff)), row(cell(0, 0, 0x2, 0xff)))]))
    run(p, 11) // row 0, then its five effect ticks
    expect(p.channels[0]!.period).toBe(113)
    run(p, 6) // row 1, then its five
    expect(p.channels[0]!.period).toBe(856)
  })

  /**
   * `P61_toneport` slides toward `P61_ToPeriod` and CLEARS it on arrival, and
   * `P61_settoneport` reaches `P61_nocha` rather than `P61_zample` — so the
   * note is aimed at, never retriggered. A sample that restarted on every 3xx
   * would click through every slide in every module.
   */
  it('tone portamento aims without retriggering', () => {
    // 3xx with a zero argument keeps the speed, which is how a slide carries
    // across the rows it takes to arrive
    const carry = Array.from({ length: 20 }, () => row(cell(0, 0, 0x3, 0)))
    const { p, audio } = replay(song([pattern(row(cell(25, 1)), row(cell(13, 0, 0x3, 0x08)), ...carry)]))
    run(p, 12)
    expect(audio.events.filter((e) => e.kind === 'play')).toHaveLength(1)
    expect(p.channels[0]!.toPeriod).toBe(PT_PERIODS[13]!)
    // it climbs by 8 a tick toward the longer period
    const before = p.channels[0]!.period
    p.tick()
    expect(p.channels[0]!.period).toBe(before + 8)
    // and settles exactly on the target rather than overshooting
    run(p, 6 * 20)
    expect(p.channels[0]!.period).toBe(PT_PERIODS[13]!)
    expect(p.channels[0]!.toPeriod).toBe(0)
    expect(audio.events.filter((e) => e.kind === 'play')).toHaveLength(1)
  })

  /**
   * `P61_volslide`'s single `sub.b` serves both directions, which only works
   * because the packer signs the delta. Fed a raw `Axy` the engine derives it
   * — `x` if the high nibble is set, else `-y` — so `A05` falls by five a tick
   * and `A50` climbs by five.
   */
  it('volume slide goes down on the low nibble and up on the high', () => {
    const { p } = replay(song([pattern(row(cell(13, 1, 0xc, 32)), row(cell(0, 0, 0xa, 0x05)))]))
    run(p, 6)
    expect(p.channels[0]!.volume).toBe(32)
    run(p, 6) // the Axy row itself does not slide
    expect(p.channels[0]!.volume).toBe(32)
    p.tick()
    expect(p.channels[0]!.volume).toBe(27)
    p.tick()
    expect(p.channels[0]!.volume).toBe(22)

    const up = replay(song([pattern(row(cell(13, 1, 0xc, 32)), row(cell(0, 0, 0xa, 0x50)))]))
    run(up.p, 13)
    expect(up.p.channels[0]!.volume).toBe(37)
  })

  /**
   * The other half of the same routine: a song that says `signedSlide` hands
   * the byte straight to `sub.b d0,P61_Volume+1(a5)`, which is what a P61
   * stream holds. $fb is -5 and climbs, $05 is +5 and falls — the SAME two
   * moves as `A50` and `A05` above, reached without the nibble step.
   */
  it('a pre-signed slide reaches the sub.b unchanged', () => {
    const packed = (info: number): PtSong => ({
      ...song([pattern(row(cell(13, 1, 0xc, 32)), row(cell(0, 0, 0xa, info)))]),
      signedSlide: true,
    })
    const down = replay(packed(0x05))
    run(down.p, 13)
    expect(down.p.channels[0]!.volume).toBe(27)

    const up = replay(packed(0xfb))
    run(up.p, 13)
    expect(up.p.channels[0]!.volume).toBe(37)
  })

  /** both clamps: `bpl` to zero and `cmp #64 / bge` to sixty-four */
  it('volume slide clamps at 0 and 64', () => {
    const { p } = replay(song([pattern(row(cell(13, 1, 0xc, 2)), row(cell(0, 0, 0xa, 0x0f)))]))
    run(p, 6 + 6 + 3)
    expect(p.channels[0]!.volume).toBe(0)

    const up = replay(song([pattern(row(cell(13, 1, 0xc, 60)), row(cell(0, 0, 0xa, 0xf0)))]))
    run(up.p, 6 + 6 + 3)
    expect(up.p.channels[0]!.volume).toBe(64)
  })

  /**
   * `P61_notecut` — ECx. `cmp (a3),d0 / bne` against the tick counter, then
   * `clr P61_Volume` AND `clr P61_Shadow`, so it silences without stopping the
   * DMA and the sample keeps running under it.
   */
  it('note cut silences on the named tick and not before', () => {
    const { p, audio } = replay(song([pattern(row(cell(13, 1, 0xe, 0xc3)))]))
    run(p, 6) // the row
    expect(p.channels[0]!.volume).toBe(64)
    run(p, 2)
    expect(p.channels[0]!.volume).toBe(64)
    p.tick() // tick 3
    expect(p.channels[0]!.volume).toBe(0)
    // silenced, not stopped
    expect(audio.events.filter((e) => e.kind === 'stop')).toHaveLength(0)
    expect(audio.events.filter((e) => e.kind === 'volume').pop()!.volume).toBe(0)
  })

  /**
   * `P61_ndelay` takes the note and the period but branches to `P61_skip`,
   * NOT to `P61_zample` — the trigger is withheld until `P61_notedelay` fires
   * on the named tick.
   */
  it('note delay holds the trigger back to its tick', () => {
    const { p, audio } = replay(song([pattern(row(cell(13, 1, 0xe, 0xd3)))]))
    run(p, 6)
    expect(audio.events.filter((e) => e.kind === 'play')).toHaveLength(0)
    expect(p.channels[0]!.note).toBe(13)
    run(p, 2)
    expect(audio.events.filter((e) => e.kind === 'play')).toHaveLength(0)
    p.tick()
    expect(audio.events.filter((e) => e.kind === 'play')).toHaveLength(1)
  })

  /**
   * `P61_setfinetune` — E5x through `P61_mulutab`, whose entries are the
   * nibble times 74: one row of the period table. The note played next is
   * therefore off a different row, and E51 is very slightly sharper than E50.
   *
   * The instrument comes FIRST here on purpose. `P61_dko` reloads volume and
   * finetune together out of the sample block, so an instrument number after
   * an E5x would undo it — which is the real behaviour and the next test.
   */
  it('E5x moves the channel onto another finetune row', () => {
    const { p } = replay(song([pattern(row(cell(0, 1, 0xe, 0x53)), row(cell(13, 0)))]))
    run(p, 12)
    expect(p.channels[0]!.fine).toBe(3)
    expect(p.channels[0]!.period).toBe(PT_PERIODS[3 * PT_PERIODS_PER_ROW + 13]!)
    expect(p.channels[0]!.period).toBeLessThan(PT_PERIODS[13]!)
  })

  /**
   * An instrument number with no note still resets the volume and the
   * finetune, because the sample header supplies both. `1 ... C20` and
   * `... C20` are different rows and every module relies on it.
   */
  it('an instrument alone resets volume and finetune', () => {
    const s = song([pattern(row(cell(13, 1, 0xc, 10)), row(cell(0, 2)))], [
      sample({ volume: 64, finetune: 0 }),
      sample({ volume: 40, finetune: 7 }),
    ])
    const { p, audio } = replay(s)
    run(p, 6)
    expect(p.channels[0]!.volume).toBe(10)
    run(p, 6)
    expect(p.channels[0]!.volume).toBe(40)
    expect(p.channels[0]!.fine).toBe(7)
    // and no retrigger, since there was no note
    expect(audio.events.filter((e) => e.kind === 'play')).toHaveLength(1)
  })
})

describe('song position', () => {
  /**
   * `P61_pattbreak` reads no argument at all — it always lands on row 0 —
   * because the P61 packer resolves the destination when it builds the
   * streams. A MOD carries it raw, so the argument is honoured here, and it
   * is two DECIMAL digits: D16 is row sixteen, not row twenty-two.
   */
  it('pattern break moves to the next position at the named row', () => {
    const { p } = replay(song([pattern(row(cell(0, 0, 0xd, 0x16))), pattern()]))
    run(p, 6)
    expect(p.pos).toBe(1)
    expect(p.patt).toBe(1)
    expect(p.row).toBe(16)
  })

  /** a break with no argument is row 0, which is what every P61 module has */
  it('pattern break with a zero argument lands on row 0', () => {
    const { p } = replay(song([pattern(row(cell(0, 0, 0xd, 0))), pattern()]))
    run(p, 6)
    expect([p.pos, p.row]).toEqual([1, 0])
  })

  /** `P61_posjmp`: "starts from the beginning if out of limits" */
  it('position jump goes where it is told, and to 0 when it cannot', () => {
    const three = [pattern(), pattern(), pattern(row(cell(0, 0, 0xb, 9)))]
    const { p } = replay(song(three, [sample()], [0, 1, 2]))
    p.setPosition(2)
    run(p, 6)
    expect(p.pos).toBe(0)
    expect(p.row).toBe(0)
  })

  /**
   * Running off the end of the song wraps to position 0 and posts -2 into
   * `P61_E8` — `move.w #-2,P61_E8-P61_cn(a3)`, the songend marker a program
   * reads to know a pass finished.
   */
  it('wrapping the song posts -2 into the E8 mailbox', () => {
    const { p } = replay(song([pattern(row(cell(0, 0, 0xd, 0)))], [sample()], [0]))
    expect(p.e8).toBe(0)
    run(p, 6)
    expect(p.pos).toBe(0)
    expect(p.e8).toBe(-2)
  })

  /**
   * `P61_patternloop` — E60 marks, E6x repeats. The count is `P61_plcount`,
   * beside `P61_cn` rather than in the channel block, so it belongs to the
   * SONG: two channels both carrying E6x share one counter, which is
   * ProTracker's behaviour and why such a loop runs half as long as written.
   */
  it('pattern loop repeats from the marked row, twice for E62', () => {
    const { p } = replay(
      song([pattern(row(cell(0, 0, 0xe, 0x60)), row(), row(cell(0, 0, 0xe, 0x62))), pattern()]),
    )
    run(p, 18) // rows 0, 1, 2 — the E62 sends it back to row 0
    expect(p.row).toBe(0)
    run(p, 18)
    expect(p.row).toBe(0) // the second repeat
    run(p, 18)
    expect(p.row).toBe(3) // spent, and on past it
  })

  /**
   * `P61_pattdelay` — EEx holds the row for x more passes, running the
   * BETWEEN-tick effects each time rather than re-reading the row.
   */
  it('pattern delay holds the row without re-triggering it', () => {
    const { p, audio } = replay(song([pattern(row(cell(13, 1, 0xe, 0xe2)), row(cell(25, 1)))]))
    run(p, 6)
    expect(audio.events.filter((e) => e.kind === 'play')).toHaveLength(1)
    run(p, 12) // two delayed passes
    expect(audio.events.filter((e) => e.kind === 'play')).toHaveLength(1)
    run(p, 6)
    expect(audio.events.filter((e) => e.kind === 'play')).toHaveLength(2)
  })
})

describe('the master volume', () => {
  /**
   * `P61_mfade` is pushed as `P61_Music`'s return address, so it runs on every
   * tick after everything else, and `mulu d0,d1 / lsr #6,d1` is the only place
   * the channel volume and the master meet.
   */
  it('scales every channel by the master', () => {
    const { p, audio } = replay(song([pattern(row(cell(13, 1, 0xc, 64)))]))
    p.master = 32
    p.fadeTo = 32
    run(p, 7)
    expect(p.channels[0]!.volume).toBe(64)
    expect(audio.voiceState[0]!.volume).toBe(32)
  })

  /**
   * The walk is `blt .add / subq #2 / .add addq #1` — one shared `addq`
   * serving both directions, a step of exactly one either way, gated by
   * `P61_FadeCount` counting down from `P61_FadeSpeed`.
   */
  it('fades one step at a time toward the target', () => {
    const { p } = replay(song([pattern(row(cell(13, 1)))]))
    p.fadeTo = 60
    p.fadeSpeed = 1
    run(p, 4)
    expect(p.master).toBe(60)
    p.fadeTo = 64
    run(p, 2)
    expect(p.master).toBe(62)
  })

  /**
   * `tst P61_Play / bne` returns BEFORE `pea P61_mfade`, so a stopped
   * replayer does not run the fade at all — one in flight freezes rather than
   * completing.
   */
  it('a stopped replay does not advance the fade', () => {
    const { p } = replay(song([pattern(row(cell(13, 1)))]))
    p.fadeTo = 0
    run(p, 3)
    const held = p.master
    expect(held).toBeLessThan(64)
    p.playing = false
    run(p, 50)
    expect(p.master).toBe(held)
  })
})

describe('the voice mask', () => {
  /**
   * A caller's sound effect takes a channel off the music, which is what
   * AMCAF's `Pt Voice` and P61's own channel mask are for. A masked-out voice
   * must see nothing at all from the replay — not a quieter note, not a
   * period write.
   */
  it('a voice the music does not hold is never written', () => {
    const { p, audio } = replay(song([pattern(row(cell(13, 1), cell(13, 1), cell(13, 1), cell(13, 1)))]))
    p.voices = 0b0011
    run(p, 12)
    expect(new Set(audio.events.map((e) => e.voice))).toEqual(new Set([0, 1]))
  })
})
