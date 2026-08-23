import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { mustFinish } from '../testing/run'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
// this library gives a keyword an instruction entry with the function form
// behind it nameless, which only AMOS 1.3 could reach -- see tokenizeUnchecked
import { tokenizeUnchecked as tokenize } from '../tokens/source'
import { extensionById } from '../ext/registry'
import { firstCodeHunk } from '../tokens/libtok'
import { Runtime } from './runtime'
import { COLOURS } from './colours'

const table = new TokenTable(CORE_TOKENS)
/** slot 23, and the source says so itself: `ExtNb equ 23-1` (:21) */
const colours = extensionById('amospro-colours-1.0')!

const DIR = join(__dirname, '../../fixtures/extensions/amospro-colours-1.0')
const SRC = join(DIR, 'AMOSPro_Colours.Lib.s')
const LIB = join(DIR, 'AMOSPro_Colours.Lib')

/** the AMOS spelling of a keyword: `light grey` -> `Light Grey` */
const amos = (k: string): string => k.replace(/\b\w/g, (c) => c.toUpperCase())

function run(src: string): string {
  let out = ''
  const exts = new Map([[23, colours.table]])
  const rt = new Runtime(tokenize(src, table, exts), table, {
    extensions: exts,
    extBindings: new Map([[23, colours]]),
    maxSteps: 200_000,
    onText: (t) => (out += t),
  })
  const r = rt.runHeadless(50)
  mustFinish(r)
  return out
}

describe('AMOSPro Colours 1.0: the constants', () => {
  it('has the twenty-seven the token table names, and no others', () => {
    const named = colours.table.entries
      .map((e) => e.name.trim().replace(/^!/, ''))
      .filter((n) => n !== '')
    expect(new Set(named)).toEqual(new Set(Object.keys(COLOURS)))
    expect(Object.keys(COLOURS)).toHaveLength(27)
  })

  /**
   * Re-read from the shipped source rather than trusted.
   *
   * `AMOSPro_Colours.Lib.s:24-50` is twenty-seven `equ`s, and the token table
   * spells the same colours with spaces where the labels run them together
   * (`DARKRED` against `dark red`, `ORANGE` against `c orange`). Matching on
   * the squashed name is what lets the transcription be checked at all.
   */
  it.skipIf(!existsSync(SRC))('agrees with every equ in the source', () => {
    const text = readFileSync(SRC, 'latin1')
    // only the colour equs are hex — `ExtNb equ 23-1` and the `L_x equ N`
    // routine numbers are decimal, so the `$` is what separates them
    const equs = new Map<string, number>()
    for (const m of text.matchAll(/^(\w+)\s+equ\s+\$([0-9A-Fa-f]+)\s*$/gm)) {
      equs.set(m[1]!.toLowerCase(), parseInt(m[2]!, 16))
    }
    const ours = new Map(
      Object.entries(COLOURS).map(([k, v]) => [k.replace(/^c /, '').replace(/ /g, ''), v]),
    )
    expect(equs.size).toBe(27)
    expect([...ours].sort()).toEqual([...equs].sort())
  })

  /**
   * And re-read from the assembled library, which is a genuinely independent
   * check: each routine is `move.l #VALUE,d3 / moveq #0,d2 / rts`, encoded
   * `263c vvvvvvvv 7400 4e75` — ten bytes, which is also what the offset table
   * says every one of them is (`dc.w 5`, in words, at :58). Every value has to
   * appear in that exact shape or the source and the binary disagree.
   */
  it.skipIf(!existsSync(LIB))('agrees with the assembled library, byte for byte', () => {
    const code = firstCodeHunk(new Uint8Array(readFileSync(LIB)))!
    const found = new Set<number>()
    for (let i = 0; i + 9 < code.length; i += 2) {
      // `26 3c` is the d3 form; d0 would be `20 3c`
      if (code[i] !== 0x26 || code[i + 1] !== 0x3c) continue
      const v = ((code[i + 2]! << 24) | (code[i + 3]! << 16) | (code[i + 4]! << 8) | code[i + 5]!) >>> 0
      if (code[i + 6] === 0x74 && code[i + 7] === 0x00 && code[i + 8] === 0x4e && code[i + 9] === 0x75) {
        found.add(v)
      }
    }
    // Black is `move.l #0,d3`, which the assembler may or may not have kept as
    // a `move.l #imm` — everything else must be there
    for (const [name, v] of Object.entries(COLOURS)) {
      if (v === 0) continue
      expect(found.has(v), `${name} = $${v.toString(16)} is not in the library`).toBe(true)
    }
    expect(found.size).toBeGreaterThanOrEqual(26)
  })

  it('is twelve-bit $RGB, one nibble a channel', () => {
    // which is a COLORxx register, and therefore what `Colour n,v` takes
    for (const [name, v] of Object.entries(COLOURS)) {
      expect(v, name).toBeGreaterThanOrEqual(0)
      expect(v, name).toBeLessThanOrEqual(0xfff)
    }
    expect([COLOURS['red'], COLOURS['green'], COLOURS['blue']]).toEqual([0xf00, 0x0f0, 0x00f])
    expect([COLOURS['black'], COLOURS['white']]).toEqual([0x000, 0xfff])
  })
})

describe('AMOSPro Colours 1.0: the keywords', () => {
  it('every one of the twenty-seven answers its constant', () => {
    // dispatched through the keyword, not read off the table: the program
    // below is what a user would actually type
    for (const [name, want] of Object.entries(COLOURS)) {
      expect(Number(run(`Print ${amos(name)}`).trim()), name).toBe(want)
    }
  })

  it('C Orange is the spelling, and bare Orange is only a variable', () => {
    // `dc.b "c orang","e"+$80` (:95), the only prefixed name in the table.
    // `Orange` is not an error — AMOS reads any unknown word as a variable,
    // so a program that guessed the obvious name silently gets 0
    expect(Number(run('Print C Orange').trim())).toBe(0xa40)
    expect(Number(run('Print Orange').trim())).toBe(0)
  })

  it('reads as a colour where one is wanted', () => {
    // the whole point of the extension: `Colour 1,Red` with no conversion
    expect(run('Screen Open 0,320,200,4,0 : Colour 1,Red : Print Colour(1)').trim()).toBe('3840')
    expect(0xf00).toBe(3840)
  })
})
