/**
 * OS DevKit 1.61 — first callable slice.
 *
 * This is deliberately an ExtensionImpl over the already-audited machine
 * helpers, not a 68k emulator. The routines cited below are workers resolved
 * through the library's Rbra trampolines by src/cli/osbackend.ts.
 */
import type { Func, Instr } from '../interp/builtins'
import { VI, VS, int, str } from '../interp/values'
import { OsCStringHeap } from '../amiga/oscstring'
import {
  chrLong, chrWord, extendByte, extendWithinWord, extendWord, joinWord, valLong, valWord,
} from '../amiga/osscalar'
import {
  A1200_ATTN_FLAGS, EXEC_SOFT_VERSION, EXEC_VERSION, systemCpu, systemFpu,
} from '../amiga/ossystem'
import type { Runtime } from './runtime'

export interface OsDevKitState {
  strings: OsCStringHeap
}

export const newOsDevKitState = (): OsDevKitState => ({ strings: new OsCStringHeap() })

function writeLong(rt: Runtime, address: number, value: number): void {
  rt.longsAt(address >>> 0, true)?.set(0, value)
}

export function makeOsDevKitInstructions(rt: Runtime): Record<string, Instr> {
  const heap = (): OsCStringHeap => rt.osdevkit.strings
  return {
    /** routine 1471: subtract the seven-byte private header, then FreeVec. */
    '_str free'(it) {
      heap().free(it.evalInt())
    },
    /** routine 1472: position word at -3, value byte at -1. */
    '_str pos'(it) {
      const text = it.evalInt()
      it.expect(',')
      const position = it.evalInt()
      it.expect(',')
      heap().position(text, position, it.evalInt())
    },
    /** routines 1473/1474: copy an AMOS string, optionally using a non-NUL terminator. */
    '_str put'(it) {
      const value = it.evalStr()
      it.expect(',')
      const text = it.evalInt()
      const terminator = it.accept(',') ? it.evalInt() : 0
      heap().put(text, value, terminator)
    },
    /** routine 512: CurrentTime writes seconds since 1978 and microseconds. */
    '_sys time'(it) {
      const secondsAt = it.evalInt()
      it.expect(',')
      const microsAt = it.evalInt()
      const now = rt.host.clock.now()
      writeLong(rt, secondsAt, now.days * 86_400 + now.mins * 60 + Math.floor(now.ticks / 50))
      writeLong(rt, microsAt, (now.ticks % 50) * 20_000)
    },
    /** routine 1755 is Exec CacheClearU; coherent managed memory needs no flush. */
    '_cache clr'() {},
  }
}

export function makeOsDevKitFunctions(rt: Runtime): Record<string, Func> {
  const heap = (): OsCStringHeap => rt.osdevkit.strings
  const n = (a: Parameters<Func>[1], at: number): number => int(a[at] ?? VI(0))
  return {
    /** routines 1466/1467: C length, optionally stopped by a caller byte. */
    '_str len'(_, a) { return VI(heap().length(n(a, 0), a.length > 1 ? n(a, 1) : 0)) },
    /** routines 1468/1469: copy that same bounded C span into an AMOS string. */
    '_str get'(_, a) { return VS(heap().get(n(a, 0), a.length > 1 ? n(a, 1) : 0)) },
    /** routine 1470: cleared AllocVec(capacity+8), returning base+7. */
    '_str alloc'(_, a) { return VI(heap().alloc(n(a, 0))) },
    /** routine 1475: AMOS length-word string to the private C allocation. */
    '_to str'(_, a) { return VI(heap().fromAmos(str(a[0] ?? VS('')))) },
    /** routine 1476 points at a static zero-length AMOS string. */
    '_0$'() { return VS('') },

    /** routines 1752, 1757–1759: exact register-width transformations. */
    '_join.w'(_, a) { return VI(joinWord(n(a, 0), n(a, 1))) },
    '_ext.b'(_, a) { return VI(extendByte(n(a, 0))) },
    '_ext.w'(_, a) { return VI(extendWithinWord(n(a, 0))) },
    '_ext.l'(_, a) { return VI(extendWord(n(a, 0))) },
    /** routines 26–29: fixed-width big-endian binary strings. */
    '_chr$.l'(_, a) { return VS(chrLong(n(a, 0))) },
    '_chr$.w'(_, a) { return VS(chrWord(n(a, 0))) },
    '_val.l'(_, a) { return VI(valLong(str(a[0] ?? VS('')))) },
    '_val.w'(_, a) { return VI(valWord(str(a[0] ?? VS('')))) },

    /** routines 675/676 and 1753/1754: ExecBase identity fields. */
    '_sys version'() { return VI(EXEC_VERSION) },
    '_sys revision'() { return VI(EXEC_SOFT_VERSION) },
    '_sys cpu'() { return VI(systemCpu(A1200_ATTN_FLAGS)) },
    '_sys fpu'() { return VI(systemFpu(A1200_ATTN_FLAGS)) },
  }
}
