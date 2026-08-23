import { describe, expect, it } from 'vitest'
import { mustFinish } from '../testing/run'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/source'
import { extensionById } from '../ext/registry'
import { Runtime } from './runtime'
import { FILEID_ERRORS } from './fileid'

const table = new TokenTable(CORE_TOKENS)
/**
 * Slot 25, off the source rather than off a binary: `ExtNb equ 25-1`, and the
 * file's own header comment says `Slot : 25`. The store is written out as
 * `move.l a3,ExtAdr+ExtNb*16(a5)` — the slot arithmetic this port uses, as
 * the assembler's own expression.
 */
const fileid = extensionById('fileid-1.0')!

interface Boot {
  rt: Runtime
  out: () => string
}

function boot(src: string): Boot {
  const exts = new Map([[25, fileid.table]])
  let printed = ''
  const rt = new Runtime(tokenize(src, table, exts), table, {
    extensions: exts,
    extBindings: new Map([[25, fileid]]),
    maxSteps: 200_000,
    onText: (t) => (printed += t),
  })
  return { rt, out: () => printed }
}

function run(src: string): Boot {
  const b = boot(src)
  const r = b.rt.runHeadless(2000)
  mustFinish(r)
  return b
}

describe('FileID 1.0 — the wrapper, with no library under it', () => {
  it('startup opens nothing, because FileID.library is not modelled (L0)', () => {
    // `OpenLibrary("FileID.library", 0)` --- version 0, so any version would
    // do; the library is a magic-number table maintained elsewhere and its ID
    // NUMBERS are its own, so inventing them would be worse than absence
    expect(boot('').rt.fileId).toEqual({ base: 0, fileInfo: 0, err: 0 })
  })

  it('the four guarded keywords report message 0 (L_Custom)', () => {
    // `Tst.l _IDbase / bne .ok / moveq #0,d0 / RBra L_Custom`
    for (const src of [
      'Print Id Get High Id',
      'Print Id Get String(1)',
      'Print Id Identify File("x")',
      'Print Id Identify Adresse(0)',
    ]) {
      expect(() => run(src)).toThrow(FILEID_ERRORS[0])
    }
  })

  it('the two UNGUARDED ones answer anyway (L7 and L8)', () => {
    // three instructions each --- `move.l FileInfo,d3 / moveq #0,d2 / Rts`
    // and the same over IDerr --- with no library test at all
    expect(run('Print Id Fileinfo').out().trim()).toBe('0')
    expect(run('Print Id Error').out().trim()).toBe('0')
  })

  it('the message table is the extension\'s, indexed by the library\'s own codes', () => {
    // only 0 and 4 have callers in the extension; the rest arrive as
    // `move.l #0,d3 / sub.l IDerr,d3`, the library's FIERR_* negated
    expect(FILEID_ERRORS).toHaveLength(8)
    expect(FILEID_ERRORS[0]).toBe('FileID.library nicht geöffnet')
    expect(FILEID_ERRORS[4]).toBe('Kein Speicher mehr')
  })
})
