import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/source'
import { extensionById } from '../ext/registry'
import { NullAudio } from '../amiga/paula'
import { Runtime } from './runtime'
import type { MemoryBank } from '../loader/amosfile'

const table = new TokenTable(CORE_TOKENS)

/**
 * Slot 1 — EME ships AS `AMOSPro_Music.Lib` and is copied over the stock one,
 * so it takes the Music slot and its table is a superset of the stock 64
 * entries. Two builds: the AMOS Pro one (74 entries) and the AMOS 1.3 one off
 * APD600 (70), which drops the six speech keywords and adds `med tempo` and
 * `tr credits`.
 */
const eme = extensionById('eme-3.0')!
const emeDemo = extensionById('eme-3.0-demo')!

function boot(src: string, ext = eme, bank?: MemoryBank): { rt: Runtime; audio: NullAudio } {
  const exts = new Map([[1, ext.table]])
  const audio = new NullAudio()
  const rt = new Runtime(tokenize(src, table, exts), table, {
    extensions: exts,
    extBindings: new Map([[1, ext]]),
    audio,
    banks: bank ? [bank] : [],
    maxSteps: 200_000,
    onText: () => {},
  })
  return { rt, audio }
}

function frames(rt: Runtime, n: number): void {
  for (let i = 0; i < n; i++) rt.frame()
}

/**
 * A driver, not a fixture.
 *
 * This builds a two-position M.K. module so the position keywords have
 * somewhere to move to. It is NOT evidence about the MOD format — the reader
 * under it is AMOS's own `mt_*`, tested in `music.test.ts` against the real
 * `Mod.Tracker` the AMOS Pro examples ship, and the real module is used below
 * as well. What is being tested here is EME's ten keywords over that reader.
 *
 * Row 0 of each pattern carries `F01`, speed 1, so a pattern is 64 vbls
 * instead of 384. The order table is [1, 0] so `=Trpat` answers something
 * other than its own argument.
 */
function modFile(): Uint8Array {
  const d = new Uint8Array(1084 + 2 * 1024 + 64)
  const dv = new DataView(d.buffer)
  dv.setUint16(20 + 22, 32) // sample 1: 64 bytes
  d[20 + 25] = 40 // volume
  dv.setUint16(20 + 28, 1) // the conventional one-word repeat
  d[950] = 2 // song length: two positions
  d[951] = 0 // restart
  d[952] = 1 // positions[0] = pattern 1
  d[953] = 0 // positions[1] = pattern 0
  d.set([0x4d, 0x2e, 0x4b, 0x2e], 1080) // "M.K."
  for (const pat of [0, 1]) {
    const row = 1084 + pat * 1024
    d[row] = 0x01 // instrument 1, high nibble of the period
    d[row + 1] = 0xac // period $1ac
    d[row + 2] = 0x1f // instrument low nibble, command F
    d[row + 3] = 0x01 // speed 1
  }
  for (let i = 0; i < 64; i++) d[1084 + 2048 + i] = i & 1 ? 80 : 176
  return d
}

const trackerBank = (): MemoryBank => ({
  kind: 'memory', number: 6, memType: 1, name: 'Tracker', flags: 0, data: modFile(),
})

describe('EME 3.0: the reporting keywords', () => {
  it('=Trpos, =Trlen and =Trstat follow the running module', () => {
    // routines 117/118/115, all three reading bytes of EME's own workspace at
    // $bd0, $be7 and $be6 rather than computing anything
    const { rt } = boot('Track Play', eme, trackerBank())
    frames(rt, 3)
    expect(rt.music.mtOn).toBe(true)
    expect(rt.music.trackPos).toBe(0)
    expect(rt.music.trackLen).toBe(2)
    // one pattern at speed 1 is 64 rows, then the position steps
    frames(rt, 70)
    expect(rt.music.trackPos).toBe(1)
  })

  it('all four answer 0 once the song has stopped', () => {
    // Track Stop (routine 90) clears $bd0, $be7 and $be6 in the same run, so
    // there is nothing left for any of them to report
    const { rt } = boot('Track Play', eme, trackerBank())
    frames(rt, 3)
    rt.music.trackStop()
    expect([rt.music.trackPos, rt.music.trackLen, rt.music.mtOn]).toEqual([0, 0, false])
    expect(rt.music.trackPattern(0)).toBe(0)
  })

  it('=Trpat reads the module order table, and bounds nothing', () => {
    // `movea.l $bdc(a1),a0 / adda.w d0,a0 / move.b $3b8(a0),d3`
    const { rt } = boot('Track Play', eme, trackerBank())
    frames(rt, 3)
    expect(rt.music.trackPattern(0)).toBe(1)
    expect(rt.music.trackPattern(1)).toBe(0)
    // the 68k would read past the order table into the pattern data; this
    // port answers 0 rather than inventing a byte
    expect(rt.music.trackPattern(9999)).toBe(0)
  })

  it('reports through the keywords a program actually writes', () => {
    const out: string[] = []
    const exts = new Map([[1, eme.table]])
    const src = 'Track Play : Print Trpos;" ";Trlen;" ";Trstat;" ";Trpat(0);" ";Trpat(1)'
    const rt = new Runtime(tokenize(src, table, exts), table, {
      extensions: exts,
      extBindings: new Map([[1, eme]]),
      audio: new NullAudio(),
      banks: [trackerBank()],
      maxSteps: 200_000,
      onText: (t) => out.push(t),
    })
    rt.runHeadless(20)
    // AMOS prints a leading space for a positive number. The order table is
    // [1, 0], so Trpat(0) is 1 and Trpat(1) is 0
    expect(out.join('').trim()).toBe('0  2  1  1  0')
  })
})

describe('EME 3.0: Patt Loop', () => {
  it('Patt Loop On holds the position, so the pattern repeats', () => {
    // routine 113 writes 1 at $be9; the replayer's `cmpi.b #1,$be9 / beq`
    // jumps past the `addq.b #1` on the song position
    const { rt } = boot('Track Play\nPatt Loop On', eme, trackerBank())
    frames(rt, 200)
    expect(rt.music.trackPos).toBe(0)
    expect(rt.music.mtOn).toBe(true)
  })

  it('Patt Loop No stops the song when the pattern ends', () => {
    // routine 120 writes 2, and mode 2's `beq` lands on the stop itself
    const { rt } = boot('Track Play\nPatt Loop No', eme, trackerBank())
    frames(rt, 3)
    expect(rt.music.mtOn).toBe(true)
    frames(rt, 70)
    expect(rt.music.mtOn).toBe(false)
  })

  it('Patt Loop Of puts it back, and the song advances again', () => {
    const { rt } = boot('Track Play\nPatt Loop On\nPatt Loop Of', eme, trackerBank())
    frames(rt, 70)
    expect(rt.music.trackPos).toBe(1)
  })

  it('a Track Play over a RUNNING module clears the mode, one from stopped does not', () => {
    // Track Play opens with `Rbsr routine 90`, and routine 90 is
    // `tst.b $be6(a0) / beq` to its own exit BEFORE the clears --- which is
    // why EME.doc's "if used before Track Play" is true from a stopped state
    const set = boot('Patt Loop On\nTrack Play', eme, trackerBank())
    frames(set.rt, 3)
    expect(set.rt.music.pattLoop).toBe(1)

    const cleared = boot('Track Play\nPatt Loop On\nTrack Play', eme, trackerBank())
    frames(cleared.rt, 3)
    expect(cleared.rt.music.pattLoop).toBe(0)
  })
})

describe('EME 3.0: Track Tempo', () => {
  it('sets the speed and restarts the tick', () => {
    // routine 116: `clr.b $bcf(a0)` then `move.b d0,$bce(a0)`, in that order
    const { rt, audio } = boot('Track Play\nTrack Tempo 6', eme, trackerBank())
    frames(rt, 3)
    const after3 = audio.events.filter((e) => e.kind === 'play').length
    // at speed 6 the row that reloads the sample comes round every sixth vbl
    frames(rt, 6)
    expect(audio.events.filter((e) => e.kind === 'play').length).toBeGreaterThan(after3)
  })

  it('stores a BYTE with no range check, so 256 is tempo 0', () => {
    // `move.l (a3)+,d0` then `move.b d0,(a0)` --- nothing between them, and
    // the doc calls tempo 0 the fastest
    const { rt } = boot('Track Tempo 256', eme, trackerBank())
    rt.runHeadless(5)
    expect(rt.music.trackSpeed).toBe(0)
    expect(boot('Track Tempo 9', eme, trackerBank()).rt.music.trackSpeed).toBe(6)
  })

  it('does NOT override the module, which writes the same byte', () => {
    // "if you set a tempo, it will be changed by any tempo commands in the
    // music. (eg. F03)" -- and nothing in routine 116 says otherwise: it
    // writes mt_speed, which is where the module's own Fxx lands
    const { rt } = boot('Track Play\nTrack Tempo 9', eme, trackerBank())
    frames(rt, 1) // both statements run on the first frame
    expect(rt.music.trackSpeed).toBe(9)
    // row 0 of the pattern carries F01, and the row falls on the ninth tick
    frames(rt, 12)
    expect(rt.music.trackSpeed).toBe(1)
  })
})

describe('EME 3.0: what the demo builds refuse', () => {
  it('Track Sample On and Off both raise the full-version message', () => {
    // routines 121 and 122 are the SAME twelve bytes: `moveq #$9,d0 / Rbra
    // routine 123`, message 9. EME.doc marks only Off as missing
    expect(() => boot('Track Sample On', eme).rt.runHeadless(5)).toThrow(/full version/i)
    expect(() => boot('Track Sample Off', eme).rt.runHeadless(5)).toThrow(/full version/i)
  })

  it('the AMOS 1.3 build refuses them too, through its own message number', () => {
    // `moveq #$d,d0` there, because that build's list carries five extra
    // medplayer strings ahead of the same text
    expect(() => boot('Track Sample On', emeDemo).rt.runHeadless(5)).toThrow(/full version/i)
  })

  it('Tr Credits is a credit delivered as an error', () => {
    // routine 119 of the AMOS 1.3 build: `moveq #$f,d0 / Rbra routine 120`,
    // and message 15 is the author's name
    expect(() => boot('Tr Credits', emeDemo).rt.runHeadless(5)).toThrow(/Paul Reece/)
  })

  it('Med Tempo is medplayer SetTempo under another name, and 1.3-only', () => {
    // `jsr -$42(a6)`, the same LVO MED 7.1's Med Set Tempo calls
    const { rt } = boot('Med Tempo 10', emeDemo)
    rt.runHeadless(5)
    // the AMOS Pro table has no such name at all
    expect(eme.table.entries.some((t) => t.name === 'med tempo')).toBe(false)
    expect(emeDemo.table.entries.some((t) => t.name === 'med tempo')).toBe(true)
  })
})

/**
 * The real module, which is what makes the position keywords worth anything.
 * `Mod.Tracker` ships with AMOS Professional's own examples.
 */
const REAL = join(__dirname, '../../fixtures/official-amos/Examples/Music/Mod.Tracker')

describe.skipIf(!existsSync(REAL))('EME 3.0 over the real Mod.Tracker', () => {
  it('reports a length and an order table that match the file', () => {
    const data = new Uint8Array(readFileSync(REAL))
    const bank: MemoryBank = { kind: 'memory', number: 6, memType: 1, name: 'Tracker', flags: 0, data }
    const { rt } = boot('Track Play', eme, bank)
    frames(rt, 3)
    expect(rt.music.trackLen).toBe(data[950])
    expect(rt.music.trackLen).toBeGreaterThan(0)
    for (let p = 0; p < rt.music.trackLen; p++) {
      expect(rt.music.trackPattern(p)).toBe(data[0x3b8 + p])
    }
    expect(rt.music.trackPos).toBe(0)
  })
})
