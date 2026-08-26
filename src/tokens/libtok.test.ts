import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { parseAmosLib, parseAmosLibOld, parseAmosToolsTable, parseTokenTable } from './libtok'
import { firstCodeHunk } from '../amiga/hunk'

const ch = (s: string) => [...s].map((c) => c.charCodeAt(0))

describe('parseTokenTable', () => {
  it('parses entries with names, variants and terminator styles', () => {
    const table = new Uint8Array([
      // null entry: instr 1, func 2, empty name, empty spec
      0, 1, 0, 2, 0x80, 0xff,
      // "bob" with spec I0, $FE variant marker
      0, 3, 0, 4, ...ch('bo'), 'b'.charCodeAt(0) | 0x80, ...ch('I0'), 0xfe,
      // unnamed variant, spec I, $FF (odd length -> padded)
      0, 5, 0, 6, 0x80, 'I'.charCodeAt(0), 0xff, 0,
      // terminator
      0, 0,
    ])
    const entries = parseTokenTable(table)
    expect(entries).toHaveLength(3)
    expect(entries[0]).toMatchObject({ id: 0, name: '', instr: 1, func: 2 })
    expect(entries[1]).toMatchObject({ id: 6, name: 'bob', spec: 'I0' })
    expect(entries[2]).toMatchObject({ id: 16, name: '', spec: 'I' })
  })

  /**
   * A spec ends at the first NEGATIVE byte, so a $00 terminates nothing and an
   * entry missing its `-1` swallows the next one. Not a tolerance we chose:
   * `Ver_Ech` (+Verif.s:5231) advances with `tst.b (a0)+ / bpl`.
   *
   * AMOSPro_Range.Lib is the real case, and the differential below is what
   * shows it is real. This is the same shape in forty bytes, because a
   * hand-built fixture is good for saying what the rule IS and proves nothing
   * about what the Amiga's libraries CONTAIN.
   */
  it('a $00 does not end a spec, so a missing terminator swallows the next entry', () => {
    const table = new Uint8Array([
      // "splot", routine 76, spec I0 -- and NO terminator after the spec
      0, 76, 0xff, 0xff, ...ch('splo'), 't'.charCodeAt(0) | 0x80, ...ch('I0'),
      0, // the assembler's even-alignment pad, which terminates nothing
      // what should have been routine 77, "planes"
      0, 77, 0xff, 0xff, ...ch('plane'), 's'.charCodeAt(0) | 0x80, ...ch('I0'), 0xff,
      0, // its pad
      // a well-formed entry, to show where the walk comes back into step
      0, 78, 0xff, 0xff, ...ch('fmo'), 'd'.charCodeAt(0) | 0x80, ...ch('00'), 0xff,
      0,
      0, 0,
    ])
    const entries = parseTokenTable(table)
    expect(entries.map((e) => e.name)).toEqual(['splot', 'es', 'fmod'])
    // splot keeps its name and routine, and carries the wreckage as its spec:
    // its own "I0", the pad, then routine 77's two header bytes
    expect(entries[0]).toMatchObject({ id: 0, instr: 76 })
    expect([...entries[0]!.spec].map((c) => c.charCodeAt(0))).toEqual([...ch('I0'), 0, 0, 77])
    // the fragment's routine numbers are the ASCII of the swallowed name --
    // "pl" and "an" of "planes". $706c is not a jump-table index, and that
    // impossibility is the signal src/cli/extdis.ts reports.
    expect(entries[1]).toMatchObject({ id: 16, instr: 0x706c, func: 0x616e, spec: 'I0' })
    // so routine 77 is unreachable: nothing names it
    expect(entries.some((e) => e.instr === 77 || e.func === 77)).toBe(false)
    // and the walk is back in step by the entry after
    expect(entries[2]).toMatchObject({ id: 26, instr: 78 })
  })
})

/**
 * The rule above, checked against every AMOS library held rather than against
 * a fixture we wrote. `amosWalk` is a line-by-line transcription of `Ver_Ech`
 * (+Verif.s:5259) — the interpreter's own walk over a token table, which it
 * uses to swap each entry's routine pair for the verify build's:
 *
 *     .Loop   move.l (a0),d0 / move.l (a1),(a0)+ / move.l d0,(a1)+
 *     .Skip1  tst.b (a0)+ / bpl.s .Skip1
 *     .Skip2  tst.b (a0)+ / bpl.s .Skip2
 *             move.w a0,d0 / and.w #$0001,d0 / add.w d0,a0
 *             cmp.l d1,a1 / bcs.s .Loop
 *
 * If the two ever disagree, every token id past the disagreement is wrong —
 * and a token id is precisely what a saved program holds, so nothing else in
 * the reader would notice. Hence a differential rather than expectations.
 */
function amosWalk(t: Uint8Array): number[] {
  const ids: number[] = []
  let p = 0
  while (p + 6 <= t.length) {
    if (p > 0 && t[p] === 0 && t[p + 1] === 0) break
    ids.push(p)
    p += 4
    while (p < t.length && !(t[p]! & 0x80)) p++ // .Skip1, the name
    p++
    while (p < t.length && !(t[p]! & 0x80)) p++ // .Skip2, the spec
    p++
    if (p % 2 !== 0) p++
  }
  return ids
}

/** every .Lib under fixtures/, which is gitignored — hence the skipIf */
function libraries(dir: string, into: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) libraries(p, into)
    else if (/\.lib$/i.test(e)) into.push(p)
  }
  return into
}

const fixtures = join(process.cwd(), 'fixtures')

describe.skipIf(!existsSync(fixtures))('the entry walk agrees with Ver_Ech', () => {
  it('on every library held', () => {
    let checked = 0
    for (const path of libraries(fixtures)) {
      let code: Uint8Array
      try {
        code = firstCodeHunk(new Uint8Array(readFileSync(path)))
      } catch {
        continue
      }
      if (code.length < 18) continue
      const jumpSize = new DataView(code.buffer, code.byteOffset, code.byteLength).getUint32(0, false)
      // the legacy layout, then the two AP20 ones (three and four size longs)
      let best: number[] = []
      let start = -1
      for (const s of [8 + jumpSize + 10, 12 + jumpSize + 10, 16 + jumpSize + 10]) {
        if (s >= code.length) continue
        let ids: number[] = []
        try {
          ids = parseTokenTable(code.subarray(s)).map((e) => e.id)
        } catch {
          continue
        }
        if (ids.length > best.length) {
          best = ids
          start = s
        }
      }
      if (best.length < 2) continue
      checked++
      expect(amosWalk(code.subarray(start)).slice(0, best.length), path).toEqual(best)
    }
    expect(checked).toBeGreaterThan(50)
  })
})

/*
 * The corroboration that earns `parseAmosToolsTable` its trust.
 *
 * AMOSTools ships token tables with the library stripped out from under them:
 * the hunk shell survives, both length fields read zero, there is no code, and
 * every entry's two routine words are overwritten with `====`. That is enough
 * to register an extension by — names, specs and ids — and not enough to port
 * one, and the only way to know the first half is true is to read a table both
 * ways and compare.
 *
 * CRAFT is the extension that lets us: the real `AMOSPro_CRAFT.Lib` came off
 * the installer disk, and AMOSTools has a stub of the same version. Everything
 * `musicraft-1.0` claims rests on these two agreeing.
 */
const craftLib = join(fixtures, 'extensions', 'craft-1.0', 'AMOSPro_CRAFT.Lib')
const craftStub = join(fixtures, 'extensions', 'musicraft-1.0', 'AMOSPro_CRAFT.Lib-V1.00')

describe.skipIf(!existsSync(craftLib) || !existsSync(craftStub))('AMOSTools table stubs', () => {
  it('agree with the real library on every id, name and spec', () => {
    const real = parseAmosLibOld(new Uint8Array(readFileSync(craftLib))).tokens
    const stub = parseAmosToolsTable(new Uint8Array(readFileSync(craftStub)))
    expect(stub.length).toBe(real.length)
    expect(stub.map((t) => [t.id, t.name, t.spec])).toEqual(real.map((t) => [t.id, t.name, t.spec]))
  })

  it('report the routine numbers as unknown rather than as the scrub', () => {
    // $3d3d is not a routine, and a table read this way must not pretend it
    // is. The side the SPEC says exists gets 1 -- AMOS's absent-routine
    // marker, which is what intuition-1.3b's assembled table already uses for
    // the same "present but unnumbered" case -- and the other side $ffff.
    const stub = parseAmosToolsTable(new Uint8Array(readFileSync(craftStub)))
    const upCase = stub.find((t) => t.name === 'up case$')!
    expect([upCase.instr, upCase.func]).toEqual([0xffff, 1])
    const strPoke = stub.find((t) => t.name === 'str poke')!
    expect([strPoke.instr, strPoke.func]).toEqual([1, 0xffff])
  })

  it('refuse a real library, which has routine numbers worth reading', () => {
    const real = new Uint8Array(readFileSync(craftLib))
    expect(() => parseAmosToolsTable(real)).toThrow(/not scrubbed/)
  })
})

/**
 * `LB_Title` (+B.s:2285): the fourth and last block of a `.Lib`.
 *
 * The stock Music library is the AP20 case and TURBO Plus the legacy one, so
 * both header layouts are covered. Neither string is invented here: they are
 * what those two files carry, and `Ed_AboutExt` is what puts them on screen.
 */
describe.skipIf(!existsSync(fixtures))('LB_Title', () => {
  const sys = join(fixtures, 'official-amos', 'APSystem')

  it.skipIf(!existsSync(join(sys, 'AMOSPro_Music.Lib')))('reads an AP20 library s banner and $VER', () => {
    const lib = parseAmosLib(new Uint8Array(readFileSync(join(sys, 'AMOSPro_Music.Lib'))))
    expect(lib.title).toBe('AMOSPro Music extension V 2.00')
    expect(lib.version).toBe('2.00')
  })

  const turbo = join(fixtures, 'extensions', 'turbo-plus-1.9', 'AMOSPro_Turbo1_9.Lib')
  it.skipIf(!existsSync(turbo))('reads a legacy library s, which has no AP20 magic', () => {
    const lib = parseAmosLibOld(new Uint8Array(readFileSync(turbo)))
    expect(lib.title).toBe('AMOSPro Turbo Extension V 1.9')
    expect(lib.version).toBe('1.9')
  })

  /**
   * Music 1.62's title block starts two bytes earlier than the sizes in its
   * own header predict, and the byte sitting there is below 32. `Dia_FStZero`
   * would stop dead on it, so the leading control bytes are skipped: an
   * off-by-two in a third-party header must not read as "this library has no
   * name".
   */
  const music13 = join(fixtures, 'extensions', 'music-1.62', 'Music.Lib')
  it.skipIf(!existsSync(music13))('skips a leading control byte rather than reporting no title', () => {
    expect(parseAmosLibOld(new Uint8Array(readFileSync(music13))).title).toBe('Music extension V 1.62')
  })
})
