/**
 * Personnal EXTRA 1.0a — Frederic Cordier's two-keyword companion, slot 17.
 *
 * `=Plib Ver` and `=Plib Rev`, and nothing else. They report the version and
 * revision of the Personnal library sitting in another slot, which is the only
 * thing this extension does and the reason it exists: a program can ask which
 * Personnal it got before using anything version-dependent.
 *
 * ## Evidence
 *
 * SOURCE tier. `Personnal-EXTRA.Lib.S`, 154 lines, ships inside the Personnal
 * 1.11 distribution at `demos/PersonnalEXTRA/`; the slot is its own
 * `ExtNb Equ 17-1` (:14). Both routines are eight instructions:
 *
 *     L3  DLea    _Exist,a0
 *         Move.l  (a0),d0
 *         Cmp.l   #0,d0
 *         Beq     LNOTLOADED
 *         PsJsr   AP_VERSION
 *         Move.l  d0,d3          ; L4 takes d1 instead
 *         Moveq   #0,d2
 *         Rts
 *
 * so ONE call answers both: `AP_VERSION` returns the version in d0 and the
 * revision in d1, and `Plib Ver` keeps the first while `Plib Rev` keeps the
 * second.
 *
 * ## How it decides Personnal is there, and why that is worth reading
 *
 * `_Exist` is a longword this extension owns, set once per program by its
 * DEFAULT routine (:72) — the hook AMOS calls at every program start:
 *
 *     P_TEST  PsLoad  a2
 *             Move.l  (a2),d0
 *             cmp.l   #"Fred",d0
 *             Bne     NOTLOADED
 *
 * It loads the base of Personnal's data zone and compares the first longword
 * to the ASCII **"Fred"** — the author's own signature, checked by his own
 * other library. `PsLoad`/`PsJsr` are `ExtAdr+12*16(a5)`, extension number 12
 * and therefore slot 13, which is where Personnal lives.
 *
 * NOTE, and it decides what these two keywords do: only Personnal **1.1** has
 * that signature. Its data zone opens with the "Fred" longword and
 * `_BitsPlanes` follows at +4 — which is the same fact `mplot start plane`
 * records from the other side, where 1.1's default of 0 makes a bare
 * `Mplot Draw` index `_BitsPlanes[-1]` and read the signature. Personnal
 * 1.0b's data zone opens with `_BitsPlanes` itself and carries no signature
 * anywhere (its only "Fred" is inside the title string "Auteur : Frederic
 * Cordier"), and no `AP_VERSION` stub either. So under 1.0b BOTH keywords
 * raise the not-loaded error even though Personnal is loaded. Reproduced.
 *
 * ## The numbers are read, not assumed
 *
 * `AP_VERSION` is `Jsr -6(a2)`, six bytes BEFORE the data zone, where 1.1 has
 * a `bra.l` into its own code. Following it in the shipped `AmosPro_Personnal.Lib`
 * lands on three instructions:
 *
 *     203c 00000001    move.l  #1,d0
 *     223c 00000001    move.l  #1,d1
 *     4e75             rts
 *
 * Version 1, revision 1. Constants, so the answer does not depend on anything
 * a program can change.
 */
import { AmosError, VI } from '../interp/values'
import type { Value } from '../interp/values'
import type { Func } from '../interp/builtins'
import type { Runtime } from './runtime'

/**
 * What `AP_VERSION` returns, at `FWC-6` of `AmosPro_Personnal.Lib`.
 *
 * A pair rather than two constants because the routine answers both at once
 * and the two keywords differ only in which register they keep.
 */
export const PERSONNAL_1_1_VERSION = { ver: 1, rev: 1 } as const

/** the custom error string, `ErrMess` at :136 — the library's own wording */
const NOT_LOADED = 'Extension PERSONNAL.LIB Not loaded !!!'

/**
 * `_Exist`, as the DEFAULT routine sets it.
 *
 * The 68k reads a longword out of slot 13 and compares it to "Fred"; here the
 * question "is the signed build of Personnal in the machine" is answered by
 * asking the bindings, because that is where identity lives in this port. Only
 * `personnal-1.1` carries the signature — see the header.
 */
function personnalVersion(rt: Runtime): { ver: number; rev: number } | null {
  for (const ext of rt.extBindings?.values() ?? []) {
    if (ext.id === 'personnal-1.1') return PERSONNAL_1_1_VERSION
  }
  return null
}

export function makePlibFunctions(rt: Runtime): Record<string, Func> {
  return {
    /** =Plib Ver — routine 3 (:99), d0 of AP_VERSION */
    'plib ver': (): Value => {
      const v = personnalVersion(rt)
      if (!v) throw new AmosError(NOT_LOADED)
      return VI(v.ver)
    },

    /**
     * =Plib Rev — routine 4 (:113). The same eight instructions as Plib Ver
     * with `Move.l d1,d3` where it has `Move.l d0,d3`, so it is the second
     * half of the one answer rather than a second call.
     */
    'plib rev': (): Value => {
      const v = personnalVersion(rt)
      if (!v) throw new AmosError(NOT_LOADED)
      return VI(v.rev)
    },
  }
}
