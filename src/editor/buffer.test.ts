import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { TokenTable, decipheredSource, parseSource } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { detokLineBytes, tokeniseLine, tokeniseSource } from '../tokens/edtok'
import { verify } from '../tokens/verify'
import { parseAmosFile } from '../loader/amosfile'
import { extensionAp20For, extensionTablesFor } from '../ext/identify'
import { EMPTY_LINE_BYTES, ProgramBuffer } from './buffer'

const table = new TokenTable(CORE_TOKENS)

/**
 * A program through the Test pass, as a saved source block holds it.
 *
 * `tokeniseSource` ends with a zero word of its own and a saved block does
 * not, so it comes off again: `Prg_Load` writes the terminator itself and
 * reads the file below it.
 */
const tested = (text: string): Uint8Array => verify(tokeniseSource(text, table), {}).slice(0, -2)

const load = (text: string, size?: number): ProgramBuffer => ProgramBuffer.load(tested(text), size)

/** every editor line, listed the way the editor would draw it */
const listing = (p: ProgramBuffer): string[] =>
  Array.from({ length: p.lineCount }, (_, i) => detokLineBytes(p.bytes, p.findLine(i).at, table))

const PROG = 'Print "one"\nProcedure DEMO\n  Print "in"\nEnd Proc\nPrint "two"'

/** set bit 15 of the flags word at offset 10 of the Procedure line at `at` */
function fold(src: Uint8Array, at: number): Uint8Array {
  const out = Uint8Array.from(src)
  out[at + 10] = out[at + 10]! | 0x80
  return out
}

describe('the block a program is edited in', () => {
  it('an empty program is a zero word under the top of the buffer', () => {
    // `Prg_ChgTTexte` (+Verif.s:4758): allocate, StHaut at the top, `clr.w
    // -(a0)` and StBas at what that wrote
    const p = ProgramBuffer.create(1024)
    expect(p.stHaut).toBe(1024)
    expect(p.stBas).toBe(1022)
    expect(p.free()).toBe(1022)
    expect(p.countLines()).toBe(0)
    expect([...p.text()]).toEqual([0, 0])
  })

  it('rounds an odd size down, or the zero word would land odd', () => {
    expect(ProgramBuffer.create(1025).stHaut).toBe(1024)
  })

  it('free space is what is left below the first line', () => {
    const p = load(PROG, 4096)
    expect(p.stHaut - p.stBas).toBe(tested(PROG).length + 2)
    expect(p.free()).toBe(4096 - tested(PROG).length - 2)
  })
})

describe('the line table, which is a walk', () => {
  it('lands on the same offsets the loader parses', () => {
    const src = tested(PROG)
    const p = ProgramBuffer.load(src)
    const offsets = parseSource(src, table).map((l) => l.offset)
    expect(p.lineCount).toBe(offsets.length)
    expect(Array.from({ length: p.lineCount }, (_, i) => p.findLine(i).at - p.stBas)).toEqual(offsets)
  })

  it('walking off the end lands on the zero word and says so', () => {
    const p = load(PROG)
    const end = p.findLine(p.lineCount)
    expect(end.found).toBe(false)
    expect(end.at).toBe(p.stHaut - 2)
    expect(p.findLine(999).at).toBe(end.at)
  })

  it('names the open procedure a line sits in, End Proc included', () => {
    // `Fnd5` remembers the Procedure line and `Fnd8` forgets it at End Proc,
    // which runs AFTER the End Proc line has been counted
    const p = load(PROG)
    const proc = p.findLine(1).at
    expect([0, 1, 2, 3, 4].map((i) => p.findLine(i).proc)).toEqual([-1, proc, proc, proc, -1])
  })

  it('`Tk_FindN` cannot know what it was already inside', () => {
    // it opens with `sub.l a1,a1` like every other entry into the walk
    const p = load(PROG)
    expect(p.nextLine(p.findLine(2).at).proc).toBe(-1)
    expect(p.nextLine(p.findLine(0).at).proc).toBe(p.findLine(1).at)
  })
})

describe('a closed procedure is one line', () => {
  const folded = (): ProgramBuffer => ProgramBuffer.load(fold(tested(PROG), 14))

  it('collapses its whole body, so every number after it moves', () => {
    expect(listing(load(PROG))).toEqual(['Print "one"', 'Procedure DEMO', '  Print "in"', 'End Proc', 'Print "two"'])
    expect(listing(folded())).toEqual(['Print "one"', 'Procedure DEMO', 'Print "two"'])
  })

  it('is the one line the cursor may sit on and not change', () => {
    // `Tk_EditL` (+Verif.s:5093) is `btst #7,10(a0)` and nothing else
    const p = folded()
    expect([0, 1, 2].map((i) => p.isEditable(p.findLine(i).at))).toEqual([true, false, true])
  })

  it('sizes as header to End Proc inclusive', () => {
    // `moveq #12+2,d0 / add.l 4(a0),d0`, where the size runs from offset 8
    const p = folded()
    const at = p.findLine(1).at
    expect(p.sizeOfLine(at)).toBe(14 + ((p.bytes[at + 6]! << 8) | p.bytes[at + 7]!))
    expect(p.findLine(2).at).toBe(at + p.sizeOfLine(at))
  })

  it('an address inside it reports the fold\'s number and the real line', () => {
    // `FdA5` sets a1 every step and never touches d0: the number to show and
    // the bytes to look at are not the same line
    const p = folded()
    const inside = p.stBas + 38
    expect(p.findAddress(inside)).toEqual({ line: 1, start: inside, proc: p.findLine(1).at })
    expect(p.findAddress(p.stBas + 56)).toEqual({ line: 2, start: p.stBas + 56, proc: -1 })
  })

  it('is why closing one runs the Test pass first', () => {
    // a Procedure that has never been tested carries a zero size, so the fold
    // steps 14 bytes and lands INSIDE the Procedure line's own name record.
    // `Ed_ProcOpen` (+Edit.s:8807) does `moveq #-1,d0 / bsr Ed_VaTester`
    // before it sets the bit, which is what writes the size.
    const p = ProgramBuffer.load(fold(tokeniseSource(PROG, table), 14))
    const at = p.findLine(1).at
    expect(p.sizeOfLine(at)).toBe(14)
    expect(p.findLine(2).at).toBe(at + 14)
    expect(p.lineCount).toBe(2)
  })
})

describe('storing a line', () => {
  const NEW = tokeniseLine('Print "NEW"', table)

  it('replaces in place when the length is the same', () => {
    const p = load(PROG)
    const before = p.free()
    expect(p.store(0, tokeniseLine('Print "ONE"', table))).toEqual({ at: p.stBas, error: 0, added: false })
    expect(listing(p)[0]).toBe('Print "ONE"')
    expect(p.free()).toBe(before)
  })

  it('a longer line takes room from below, a shorter one gives it back', () => {
    const p = load(PROG)
    const before = p.free()
    p.store(4, tokeniseLine('Print "a much longer line"', table))
    expect(p.free()).toBeLessThan(before)
    expect(listing(p)[4]).toBe('Print "a much longer line"')
    p.store(4, tokeniseLine('Print "x"', table))
    expect(p.free()).toBeGreaterThan(before)
    expect(listing(p)[4]).toBe('Print "x"')
  })

  it('a line that merely grew is not an added line', () => {
    // `StoR5` branches to `StoI0` and skips `StoI`, where d5 is set
    const p = load(PROG)
    expect(p.store(0, tokeniseLine('Print "much longer than before"', table)).added).toBe(false)
  })

  it('inserting pushes the rest down and does not touch the count', () => {
    // `Ed_Stocke` returns d1 and never writes Prg_NLigne; the caller does
    const p = load(PROG)
    expect(p.store(2, NEW, true).added).toBe(true)
    expect(p.lineCount).toBe(5)
    p.lineCount++
    expect(listing(p)).toEqual(['Print "one"', 'Procedure DEMO', 'Print "NEW"', '  Print "in"', 'End Proc', 'Print "two"'])
  })

  it('refuses a closed procedure', () => {
    const p = ProgramBuffer.load(fold(tested(PROG), 14))
    expect(p.store(1, NEW)).toEqual({ at: p.findLine(1).at, error: -1, added: false })
  })

  it('appending past the last line adds one, but an empty line does not', () => {
    // `StoD` (:11000): the zero word, and `cmp.w #4,d2` is the empty line
    const p = load(PROG)
    const empty = tokeniseLine('', table)
    expect(empty.length).toBe(EMPTY_LINE_BYTES)
    expect(p.store(5, empty)).toEqual({ at: p.stBas + 70, error: 0, added: false })
    expect(p.text().length).toBe(tested(PROG).length + 2)
    expect(p.store(5, NEW).added).toBe(true)
    p.lineCount++
    expect(listing(p)[5]).toBe('Print "NEW"')
  })

  it('reports out of memory rather than writing below StMini', () => {
    // `StoI0`: `cmp.l Prg_StMini(a6),a3 / bls StoMem`
    const p = load(PROG, tested(PROG).length + 8)
    expect(p.store(0, tokeniseLine('Print "far too long for the room left"', table))).toMatchObject({ error: 1 })
    expect(listing(p)[0]).toBe('Print "one"')
  })
})

describe('deleting', () => {
  it('takes the line out and keeps the count itself', () => {
    const p = load(PROG)
    expect(p.deleteLine(2)).toBe(0)
    expect(p.lineCount).toBe(4)
    expect(listing(p)).toEqual(['Print "one"', 'Procedure DEMO', 'End Proc', 'Print "two"'])
  })

  it('says 1 past the end and -1 on a closed procedure', () => {
    expect(load(PROG).deleteLine(9)).toBe(1)
    expect(ProgramBuffer.load(fold(tested(PROG), 14)).deleteLine(1)).toBe(-1)
  })

  it('a chunk is a byte count, not a line count', () => {
    // `Ed_DelChunk` (:11058) is what a block cut uses, and it leaves both the
    // line count and the marks to the caller
    const p = load(PROG)
    const two = p.sizeOfLine(p.findLine(2).at) + p.sizeOfLine(p.findLine(3).at)
    p.deleteChunk(2, two)
    expect(listing(p).slice(0, 3)).toEqual(['Print "one"', 'Procedure DEMO', 'Print "two"'])
  })
})

describe('marks', () => {
  it('a mark on line 0 column 0 is still a set mark', () => {
    // `Ed_SMark0` writes $FF between the line and the column, so `tst.l` is
    // a real test for "set" and not a guess
    const p = load(PROG)
    expect(p.getMark(0)).toBeNull()
    p.setMark(0, 0, 0)
    expect(p.marks[0]).toBe(0x0000ff00)
    expect(p.getMark(0)).toEqual({ line: 0, column: 0 })
  })

  it('an insert moves the marks at or below it', () => {
    const p = load(PROG)
    p.setMark(0, 1, 3)
    p.setMark(1, 4, 0)
    p.marksChange(2, 1)
    expect(p.getMark(0)).toEqual({ line: 1, column: 3 })
    expect(p.getMark(1)).toEqual({ line: 5, column: 0 })
  })

  it('a delete clears a mark inside the run and moves the ones after it', () => {
    const p = load(PROG)
    p.setMark(0, 1, 0)
    p.setMark(1, 2, 7)
    p.setMark(2, 4, 0)
    p.marksChange(2, -2)
    expect(p.getMark(0)).toEqual({ line: 1, column: 0 })
    expect(p.getMark(1)).toBeNull()
    expect(p.getMark(2)).toEqual({ line: 2, column: 0 })
  })

  it('survives a fold, by going through offsets and back', () => {
    // `Ed_Marks2Adress` / `Ed_Marks2Number` (+Edit.s:4284/4304) are the pair
    // that carries a mark across anything that moves the text
    const p = load(PROG)
    p.setMark(0, 4, 5)
    p.marksToAddress()
    expect(p.marks[0]! >>> 8).toBe(56)
    p.marksToNumber()
    expect(p.getMark(0)).toEqual({ line: 4, column: 5 })
  })

  it('a mark whose line is gone is cleared rather than left dangling', () => {
    const p = load(PROG)
    p.setMark(0, 9, 0)
    p.marksToAddress()
    expect(p.getMark(0)).toBeNull()
  })
})

/* ---- the sweep ----------------------------------------------------------- */

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    let st
    try {
      st = statSync(p)
    } catch {
      continue
    }
    if (st.isDirectory()) yield* walk(p)
    else if (/\.amos$/i.test(name)) yield p
  }
}

const fixtures = join(process.cwd(), 'fixtures')
const sweep = { programs: 0, lines: 0, folded: 0, mismatch: [] as string[] }
if (existsSync(fixtures)) {
  for (const path of walk(fixtures)) {
    let src: Uint8Array
    let parsed: number[]
    let folds = 0
    try {
      const file = parseAmosFile(new Uint8Array(readFileSync(path)))
      if (file.source.length === 0) continue
      const lines = parseSource(file.source, table)
      src = decipheredSource(file.source, table)
      const opts = { extensions: extensionTablesFor(lines), ap20: extensionAp20For(lines) }
      src = verify(src, opts)
      const after = parseSource(src, table)
      parsed = after.map((l) => l.offset)
      for (const l of after) {
        const t = l.tokens[0]
        if (t?.kind === 'proc' && (t.flags & 0x8000) !== 0) folds++
      }
    } catch {
      continue
    }
    sweep.programs++
    if (folds > 0) sweep.folded++
    const p = ProgramBuffer.load(src)
    const offsets = new Set(parsed)
    const walked: number[] = []
    for (let i = 0; i < p.lineCount; i++) walked.push(p.findLine(i).at - p.stBas)
    sweep.lines += walked.length

    // an editor line is always a real line, never a position inside one
    if (!walked.every((o) => offsets.has(o))) {
      sweep.mismatch.push(`${path}: not physical lines`)
      continue
    }
    // and the walk stops on a zero length byte, never in the middle
    const end = p.findLine(p.lineCount)
    if (end.found) {
      sweep.mismatch.push(`${path}: walk did not reach the end`)
      continue
    }
    // with no fold the two numberings are the same, and a fold only ever
    // takes lines away
    if (folds === 0 ? p.lineCount !== parsed.length : p.lineCount >= parsed.length) {
      sweep.mismatch.push(`${path}: ${p.lineCount} editor lines against ${parsed.length} physical, ${folds} folded`)
      continue
    }
    // reading a line back by its address gives the number again. `Tk_FindA`
    // walks from the top like `Tk_FindL` does, so checking every line of
    // every program is quadratic; a spread of eight catches a walk that
    // disagrees with itself.
    for (let k = 0; k < 8; k++) {
      const i = Math.floor((p.lineCount * k) / 8)
      if (p.findAddress(p.findLine(i).at).line !== i) {
        sweep.mismatch.push(`${path}: line ${i} does not find itself`)
        break
      }
    }
  }
}

describe.skipIf(sweep.programs === 0)('the walk over every program in fixtures', () => {
  it('read enough programs that an empty sweep cannot pass for a clean one', () => {
    expect(sweep.programs).toBeGreaterThan(400)
    expect(sweep.lines).toBeGreaterThan(80_000)
    // and enough folded ones that the fold arm is reached at all
    expect(sweep.folded).toBeGreaterThan(10)
  })

  it('every editor line is a real line, and finding it by address agrees', () => {
    expect(sweep.mismatch).toEqual([])
  })
})
