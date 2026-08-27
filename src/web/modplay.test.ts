import { describe, expect, it } from 'vitest'
import { modProgram } from './modplay'
import { loadProgram } from '../loader/program'
import { parseAmosFile } from '../loader/amosfile'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { Runtime } from '../runtime/runtime'
import { NullAudio } from '../amiga/paula'
import type { ModFormat } from '../amiga/modformat'

const table = new TokenTable(CORE_TOKENS)

/** a module that is only long enough to be a bank */
const stub = (tag: string, at = 0, size = 2048): Uint8Array => {
  const d = new Uint8Array(size)
  d.set([...tag].map((c) => c.charCodeAt(0)), at)
  return d
}

/**
 * A ProTracker module with one note in it.
 *
 * 31 sample headers of 30 bytes from offset 20, the song length and restart,
 * 128 order bytes, `M.K.` at 1080, then the patterns. Sample 1 gets a length
 * and a volume so there is something for the replayer to trigger, and the
 * first row of pattern 0 plays it at period 428, which is C-2.
 */
function protrackerModule(): Uint8Array {
  const d = new Uint8Array(1084 + 1024 + 64)
  const v = new DataView(d.buffer)
  for (let i = 0; i < 20; i++) d[i] = 0
  // sample 1: 32 words long, volume 64
  v.setUint16(20 + 22, 32, false)
  d[20 + 25] = 64
  d[950] = 1 // one position in the order
  d[951] = 0 // restart
  d.set([...'M.K.'].map((c) => c.charCodeAt(0)), 1080)
  // Pattern 0, row 0, channel 0: sample 1, period 428, which is C-2.
  //
  // The instrument is SPLIT across the cell: its high nibble rides in the top
  // of the first byte, above the period's twelve bits, and its low nibble in
  // the top of the third. Putting all four bits in the first word asks for
  // instrument 17, which no module has, and the replayer plays nothing.
  v.setUint16(1084, 428, false)
  v.setUint16(1086, 0x1000, false)
  // the sample data, past the one pattern
  for (let i = 0; i < 64; i++) d[1084 + 1024 + i] = i < 32 ? 60 : -60 & 0xff
  return d
}

const FORMATS: [ModFormat, Uint8Array, string][] = [
  ['mod', protrackerModule(), 'Tracker'],
  ['med', stub('MMD0'), 'Med'],
  ['omed', stub('MMD2'), 'OctaMed'],
  ['thx', stub('THX\0'), 'THX'],
  ['p61', stub('P61A'), 'P61'],
  ['fc13', stub('SMOD'), 'FC1.3'],
  ['fc14', stub('FC14'), 'FC1.4'],
  ['sfx', stub('SONG', 0x3c), 'SFX1.3'],
  ['digi', stub('DIGI'), 'DigiMod'],
  ['smon', stub('V.2', 0x1a), 'SoundMon'],
  ['s3m', stub('SCRM', 0x2c), 'S3Mmod'],
]

describe('the program that plays a module', () => {
  it.each(FORMATS)('writes a loadable .AMOS for %s', (format, module, bankName) => {
    const prog = modProgram('title.mod', module, format)
    expect(prog).not.toBeNull()

    // it is a real AMOS file, which is the whole point: the preview is a
    // program somebody could open in the editor
    const file = parseAmosFile(prog!.bytes)
    expect(file.diagnostics).toEqual([])
    expect(file.banks).toHaveLength(1)
    const bank = file.banks[0]!
    expect(bank.kind).toBe('memory')
    if (bank.kind !== 'memory') throw new Error('unreachable')
    // The bank NAME is what every one of these keywords checks before it
    // plays a note, all eight characters of it
    expect(bank.name).toBe(bankName)
    expect([...bank.data]).toEqual([...module])
  })

  it.each(FORMATS)('tokenises to a keyword the loader can bind for %s', (format, module) => {
    const prog = modProgram('title.mod', module, format)
    const loaded = loadProgram(prog!.bytes, table)
    expect(loaded.lines.length).toBeGreaterThan(0)
    const toks = loaded.lines.flatMap((l) => l.tokens)
    expect(toks.map((t) => t.kind)).not.toContain('unknown')
    // A play keyword that failed to tokenise comes back as a VARIABLE, not as
    // an error: `Track Loop On` against the core table alone was a variable
    // called TRACK and a syntax error after it. So the check is that the
    // keyword is there, not that nothing is unknown.
    expect(toks.some((t) => t.kind === 'var')).toBe(false)
    if (format === 'mod' || format === 'med') {
      // `Track Play` is not a core keyword either: Music is an extension like
      // any other, and the stock configuration is what puts it in a slot.
      const slot = toks.find((t) => t.kind === 'ext')?.ext
      expect(slot).toBeDefined()
      expect(loaded.bindings.get(slot!)?.id).toBe('amospro-music-2.0')
    } else {
      // A DME recipe has to come back identified AS DME. The file carries a
      // slot and a token id and nothing else, and `identify.ts` fingerprints
      // the extension from the ids. That round trip is the whole reason this
      // writes a file rather than a listing.
      expect(toks.some((t) => t.kind === 'ext' && t.ext === 15)).toBe(true)
      expect(loaded.bindings.get(15)?.id).toBe('dme-2.0')
    }
  })

  it('actually reaches Paula, for the format most of the corpus is in', () => {
    // The structural tests above cannot tell a keyword that runs from one
    // that throws on the first frame. This one runs the program.
    const prog = modProgram('title.mod', protrackerModule(), 'mod')!
    const loaded = loadProgram(prog.bytes, table)
    const audio = new NullAudio()
    const rt = new Runtime(loaded.lines, table, {
      extensions: loaded.extensions,
      extBindings: loaded.bindings,
      banks: loaded.amos?.banks ?? [],
      audio,
      onText: () => {},
      maxSteps: 100_000,
    })
    for (let i = 0; i < 10; i++) rt.frame()
    expect(audio.events.some((e) => e.kind === 'play')).toBe(true)
  })

  it('names the file after the module it came from', () => {
    const prog = modProgram('AXEL_F.mod', protrackerModule(), 'mod')!
    expect(prog.name).toBe('AXEL_F.play.amos')
    expect(prog.keyword).toBe('Track Loop On')
  })
})
