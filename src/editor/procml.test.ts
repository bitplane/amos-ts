import { describe, expect, it } from 'vitest'
import { MACHINE_CODE_PROC, PROTECTED_PROC, TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { TK, detokLineBytes, tokeniseSource } from '../tokens/edtok'
import { verify } from '../tokens/verify'
import { extractCodeHunk } from '../runtime/runtime'
import { AmigaFS } from '../amiga/vfs'
import { PROC_CLOSED, ProgramBuffer } from './buffer'
import { EditBuffer } from './editbuf'
import { UndoBuffer } from './undo'
import { Edit } from './edit'
import { ED, edCall } from './commands'
import type { DialogueAnswer, EditorDialogues, SearchDialogue } from './search'

const table = new TokenTable(CORE_TOKENS)
const tested = (t: string): Uint8Array => verify(tokeniseSource(t, table), {}).slice(0, -2)
const PROG = 'Print "one"\nProcedure DEMO[A]\n  Print "in"\nEnd Proc\nPrint "two"'

function open(text = PROG, rows = 10): Edit {
  const e = new Edit(ProgramBuffer.load(tested(text)), new EditBuffer(rows), new UndoBuffer(50), table)
  e.fill()
  e.fs = new AmigaFS()
  ;(e.fs as AmigaFS).mountMemory('RAM')
  return e
}

/** a selector that answers `name`, or nothing at all when it is null */
const picks = (name: string | null): EditorDialogues => ({
  ask: (d: SearchDialogue): DialogueAnswer => ({ ...d, ok: true }),
  confirm: () => 1,
  select: () => name,
  pressKey: () => 0,
  pickWindow: () => 0,
  pickMenu: () => 0,
  text: () => '',
  flags: () => 0,
  value: () => 0,
})

const listing = (e: Edit): string[] =>
  Array.from({ length: e.prog.lineCount }, (_, i) => detokLineBytes(e.prog.bytes, e.prog.findLine(i).at, table))

const u16 = (b: Uint8Array, at: number): number => (b[at]! << 8) | b[at + 1]!
const u32 = (b: Uint8Array, at: number): number =>
  b[at]! * 0x1000000 + (b[at + 1]! << 16) + (b[at + 2]! << 8) + b[at + 3]!

/** 68k that does nothing, `n` longs of it, each one telling which it is */
const code = (longs: number): Uint8Array => {
  const out = new Uint8Array(longs * 4)
  for (let i = 0; i < longs; i++) out[i * 4 + 3] = i & 0xff
  return out
}

/**
 * An AmigaDOS load file: HUNK_HEADER, a name-less string list, the size table,
 * then HUNK_CODE and the code. `sizes` is the table, which is the code's own
 * length in longs unless a test wants something else in there.
 */
function hunkFile(body: Uint8Array, sizes?: number[]): Uint8Array {
  const hunks = sizes ?? [body.length >> 2]
  const out: number[] = []
  const long = (v: number): void => {
    out.push((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff)
  }
  long(0x3f3)
  long(0)
  long(hunks.length)
  long(0)
  long(hunks.length - 1)
  for (const s of hunks) long(s)
  long(0x3e9)
  long(body.length >> 2)
  return Uint8Array.from([...out, ...body])
}

/** run the command with `file` on disc, and answer where the fold ended up */
function insert(e: Edit, file: Uint8Array, at = 'RAM:Routine'): number {
  ;(e.fs as AmigaFS).writeFile(at, file)
  e.dialogues = picks(at)
  return edCall(e, ED.PROC_ML)
}

describe('Insert Machine Language', () => {
  it('makes the procedure locked, machine language, and one line long', () => {
    const e = open()
    e.yCu = 1
    const body = code(8)
    expect(insert(e, hunkFile(body))).toBe(0)

    const at = e.prog.findLine(1).at
    const flags = e.prog.procFlags(at)
    expect(flags & MACHINE_CODE_PROC).toBeTruthy()
    expect(flags & PROTECTED_PROC).toBeTruthy()
    expect(flags & PROC_CLOSED).toBeTruthy()
    expect(e.prog.lineCount).toBe(3)
    expect(listing(e)).toEqual(['Print "one"', 'Procedure DEMO[A]', 'Print "two"'])
  })

  it('lays the block out as header, @_apml_@, the code, End Proc', () => {
    const e = open()
    e.yCu = 1
    const body = code(8)
    insert(e, hunkFile(body))

    const b = e.prog.bytes
    const at = e.prog.findLine(1).at
    const line = b[at]! * 2
    expect(b[at + line]).toBe(3) // three words, indented one space
    expect(b[at + line + 1]).toBe(1)
    expect(u16(b, at + line + 2)).toBe(TK.ML)
    expect(b.subarray(at + line + 6, at + line + 6 + body.length)).toEqual(body)

    const end = at + line + 6 + body.length
    expect(u16(b, end + 2)).toBe(TK.END_PROC)
    expect(u16(b, end + 4)).toBe(0)
    // `sub.l #14,d0`: the size steps the fold when `Tk_SizeL` adds 12+2 back
    expect(u32(b, at + 4)).toBe(line + 6 + body.length + 6 - 14)
    expect(e.prog.sizeOfLine(at)).toBe(line + 12 + body.length)
  })

  it('points the parameter word back at the first parameter', () => {
    const e = open()
    e.yCu = 1
    insert(e, hunkFile(code(4)))

    const b = e.prog.bytes
    const at = e.prog.findLine(1).at
    const word = at + b[at]! * 2 + 4
    const offset = (u16(b, word) << 16) >> 16
    expect(offset).toBeLessThan(0)
    // it lands on a variable record, and the token in front of it is the `[`
    const params = word + offset
    expect(u16(b, params - 2)).toBe(TK.BRA1)
    expect(b[params + 4]).toBe(2) // the name is padded to a word
    // records hold the name folded down; the case on screen is DtkMaj2's
    expect(String.fromCharCode(b[params + 6]!, b[params + 7]!)).toBe('a\x00')
  })

  it('writes zero when the procedure takes no parameters', () => {
    const e = open('Procedure DEMO\nEnd Proc')
    insert(e, hunkFile(code(4)))
    const b = e.prog.bytes
    const at = e.prog.findLine(0).at
    expect(u16(b, at + b[at]! * 2 + 4)).toBe(0)
  })

  it('leaves a program the verifier still walks', () => {
    const e = open()
    e.yCu = 1
    insert(e, hunkFile(code(8)))
    // `Ed_Test` answers 197 when the walk got to the end, and the walk steps a
    // machine-code procedure by the size long rather than reading it as lines
    expect(edCall(e, ED.TEST)).toBe(197)
    expect(listing(e)).toEqual(['Print "one"', 'Procedure DEMO[A]', 'Print "two"'])
  })

  it('folds an open procedure first, and works from inside the body', () => {
    const e = open()
    e.yCu = 2 // `Print "in"`, which is inside the procedure
    expect(insert(e, hunkFile(code(4)))).toBe(0)
    expect(e.prog.lineCount).toBe(3)
    // `.Reloop` went round once: Ed_ProcOpen closed it and put the cursor on
    // the fold's own line, which is the line the block then replaced
    expect(e.line).toBe(1)
    expect(e.prog.procFlags(e.prog.findLine(1).at) & MACHINE_CODE_PROC).toBeTruthy()
  })

  it('says Not a procedure when the cursor is not in one', () => {
    const e = open()
    e.yCu = 0
    expect(insert(e, hunkFile(code(4)))).toBe(203)
  })

  it('says Not done when the selector is cancelled', () => {
    const e = open()
    e.yCu = 1
    e.dialogues = picks(null)
    expect(edCall(e, ED.PROC_ML)).toBe(206)
  })

  it('says the file is not relocatable when it does not open with $3F3', () => {
    const e = open()
    e.yCu = 1
    const junk = Uint8Array.from({ length: 64 }, (_, i) => i)
    expect(insert(e, junk)).toBe(182)
    expect(e.alertTime).toBe(250)
    // the program keeps the FOLD: `.Reloop` closed the procedure before the
    // file was opened, and nothing takes that back
    expect(e.prog.lineCount).toBe(3)
  })

  it('raises a DISC error, not 182, when the hunks run out', () => {
    const e = open()
    e.yCu = 1
    // $3F3 and then nothing that reads as $3E9: `.Plo0` runs off the end and
    // `Ed_Read` answering short is `bne Ed_DError`
    const short = Uint8Array.from([0, 0, 3, 0xf3, 0, 0, 0, 0])
    expect(insert(e, short)).toBe(0)
    expect(e.diskError).toBe(0)
    expect(e.prog.lineCount).toBe(3)
  })

  it('DEFECT: stops on a hunk SIZE of $3E9 and takes the code four bytes early', () => {
    const e = open()
    e.yCu = 1
    // a first hunk of 1001 longs, which is $000003E9 in the size table
    const body = code(1000)
    const file = hunkFile(body, [0x3e9])
    expect(insert(e, file)).toBe(0)

    const b = e.prog.bytes
    const at = e.prog.findLine(1).at
    const start = at + b[at]! * 2 + 6
    const took = u32(b, at + 4) + 14 - (b[at]! * 2 + 12)
    expect(took).toBe(0x3e9 * 4) // the marker was read as the length
    // and what it took starts at the real length long, not at the code
    expect(u32(b, start)).toBe(1000)
    expect(b.subarray(start + 4, start + 8)).toEqual(body.subarray(0, 4))
    // Pload reads the table size and skips it, so it gets the same file right
    expect(extractCodeHunk(file)).toEqual(body)
  })
})
