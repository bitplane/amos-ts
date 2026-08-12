/**
 * The Varptr arena's one promise: a write to a mapped address reaches the
 * AMOS variable behind it.
 *
 * `Varptr(A(0))` hands a program an address in a fake address space, and the
 * bytes there are a COPY of the variable that `resolveInto` re-syncs on every
 * read. Nothing makes the reverse trip automatic — the copy has to be flushed
 * back — so the slot is handed out as a Proxy that flushes on write.
 *
 * A Proxy only sees what goes through it, and for a long time only ONE write
 * did. `view[i] = x` flushed and everything else did not, which meant the
 * promise held for `Poke` and quietly failed for every bulk write in the
 * tree. Three keywords did nothing at all as a result:
 *
 *   - **TFT's `Qsort`**, whose only documented call is
 *     `Qsort Varptr(TEST(0)),0,20`. It sorted a DataView over the buffer and
 *     left the array in its original order.
 *   - **LDos's `Lcrypt` and `Ldecrypt`**, the same DataView, and resolving
 *     for reading as well.
 *   - **AMOS's own `Copy`**, which moves its block with `.copyWithin` and
 *     `.set`. Not an extension: a core keyword, and `Bload` is another.
 *
 * So this file is a contract rather than a unit test. Every way the tree has
 * of writing bytes to an address is exercised against a Varptr, and each one
 * either flushes or is named here as not doing so. A new port copying any
 * pattern from any other is then copying something checked.
 */
import { describe, expect, it } from 'vitest'
import { mustFinish } from '../testing/run'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { extensionById } from '../ext/registry'
import { Runtime } from './runtime'

const table = new TokenTable(CORE_TOKENS)

/** one file, for the Bload case; every other test leaves the disc empty */
const FILES: Record<string, Uint8Array> = { 'ram:four.dat': new Uint8Array([0, 0, 0, 42, 0, 0, 0, 43]) }

function boot(src: string, id?: string, slot = 22): { rt: Runtime; out: () => string } {
  const ext = id === undefined ? undefined : extensionById(id)!
  const exts = ext ? new Map([[slot, ext.table]]) : new Map()
  let out = ''
  const rt = new Runtime(tokenize(src, table, exts), table, {
    extensions: exts,
    ...(ext ? { extBindings: new Map([[slot, ext]]) } : {}),
    maxSteps: 500_000,
    fs: { read: (p: string) => FILES[p] ?? null },
    onText: (t) => (out += t),
  })
  return { rt, out: () => out }
}

function run(src: string, id?: string, slot = 22): string {
  const b = boot(src, id, slot)
  mustFinish(b.rt.runHeadless(3_000))
  return b.out().trim().replace(/\s+/g, ' ')
}

/** an integer array of four, filled, then dumped after whatever came between */
const around = (body: string, init = 'A(0)=1 : A(1)=2 : A(2)=3 : A(3)=4'): string =>
  ['Dim A(3)', init, body, 'For K=0 To 3 : Print A(K);" "; : Next K'].join('\n')

describe('the Varptr arena flushes writes back into the variable', () => {
  it('through an indexed write, which is Poke and always worked', () => {
    expect(run('X=0\nPoke Varptr(X)+3,7\nPrint X')).toBe('7')
    expect(run('X=0\nLoke Varptr(X),$1234\nPrint X')).toBe('4660')
  })

  it('through .copyWithin and .set, which is what AMOS Copy uses', () => {
    // this is the one that proves the bug was not an extension's problem:
    // Copy is core, and it moved four longwords into a buffer nothing read
    const src = around('Copy Varptr(B(0)),Varptr(B(0))+16 To Varptr(A(0))', [
      'Dim B(3)',
      'A(0)=1 : A(1)=2 : A(2)=3 : A(3)=4',
      'B(0)=9 : B(1)=8 : B(2)=7 : B(3)=6',
    ].join('\n'))
    expect(run(src)).toBe('9 8 7 6')
  })

  it('and a same-buffer Copy, which takes the copyWithin arm rather than set', () => {
    expect(run(around('Copy Varptr(A(0)),Varptr(A(0))+8 To Varptr(A(0))+8'))).toBe('1 2 1 2')
  })

  it('through Poke$ and Fill, which were already byte loops and already right', () => {
    // here so the contract covers them, not because they were ever broken:
    // both write `m.data[i] = x` and go through the indexed trap
    expect(run(around('Poke$ Varptr(A(0)),Chr$(0)+Chr$(0)+Chr$(0)+Chr$(5)'))).toBe('5 2 3 4')
    expect(run(around('Fill Varptr(A(0)) To Varptr(A(0))+8,0'))).toBe('0 0 3 4')
  })

  it('through Bload, the other core keyword that moves a block with .set', () => {
    expect(run(around('Bload "ram:four.dat",Varptr(A(0))'))).toBe('42 43 3 4')
  })

  it('through rt.longsAt, which is what a port taking Varptr(A(0)) should use', () => {
    const b = boot('Dim A(3)\nA(0)=1 : A(1)=2 : A(2)=3 : A(3)=4\nAD=Varptr(A(0))\nPrint AD')
    mustFinish(b.rt.runHeadless(3_000))
    const addr = Number(b.out().trim())
    const v = b.rt.longsAt(addr)!
    expect(v.get(2)).toBe(3)
    v.set(2, -99)
    // read it back through a FRESH resolve, which re-syncs from the variable:
    // if the flush had not happened the sync would put the 3 back
    expect(b.rt.longsAt(addr)!.get(2)).toBe(-99)
  })

  it('and longsAt reports the room left, so a caller can bound itself', () => {
    const b = boot('Dim A(3)\nA(0)=1\nPrint Varptr(A(0))')
    mustFinish(b.rt.runHeadless(3_000))
    const v = b.rt.longsAt(Number(b.out().trim()))!
    expect(v.length).toBe(4)
    expect(b.rt.longsAt(0)).toBeNull()
  })
})

describe('the three keywords that wrote through a DataView and did nothing', () => {
  it('TFT Qsort sorts the array a program handed it', () => {
    // "Qsort Varptr(TEST(0)),0,20" is the extension's own example, and the
    // only shape the keyword has
    expect(run(around('Qsort Varptr(A(0)),0,3', 'A(0)=5 : A(1)=3 : A(2)=9 : A(3)=1'), 'tft-0.6')).toBe('1 3 5 9')
  })

  it('and still refuses an address with no room for the last element', () => {
    expect(() => run(around('Qsort Varptr(A(0)),0,9'), 'tft-0.6')).toThrow(/error 11/)
  })

  it('LDos Lcrypt changes the array, and Ldecrypt puts it back', () => {
    const crypted = run(around('Lcrypt Varptr(A(0)),4,"secret"'), 'ldos-2.5', 6)
    expect(crypted).not.toBe('1 2 3 4')
    expect(run(around('Lcrypt Varptr(A(0)),4,"secret" : Ldecrypt Varptr(A(0)),4,"secret"'), 'ldos-2.5', 6)).toBe(
      '1 2 3 4',
    )
  })
})
