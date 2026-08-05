/**
 * JD-K3 1.1 — the smallest of Joerg Dommermuth's five libraries, six keywords
 * at slot 19. Volume renaming, AmigaDOS pattern matching, and the drive click.
 *
 * ## Evidence
 *
 * `AMOSPro_JDK3.Lib` (936 bytes, a 900-byte code hunk, 14 routines) and its
 * `.MANUAL`, in the same Name/Parameter/Funktion/Ergebnis/Syntax/Beispiel/siehe
 * form as the rest of the JD set.
 *
 * The manual was allowed to settle the CONTRACTS on the first pass and the
 * binary was never read. It should have been: the manual is wrong about every
 * result this library returns. `Jd Relabel` is documented "0=ok / 1=Fehler"
 * and `Jd Match` "0=nein / 1=ja", and both actually hand back dos.library's
 * own BOOL, DOSTRUE (-1) for yes and 0 for no. Every routine is cited below.
 *
 * NOTE on the manual: two entries are headed "Jd Compare" and "Jd Compare
 * Nocase", but their own Syntax lines read `X=Jd Match(A$,B$)` and
 * `X=Jd Match Nocase(A$,B$)`, and the token table names them `jd match` and
 * `jd match nocase`. The headings are stale; the table and the Syntax lines
 * agree with each other and are what a program is tokenised against.
 *
 * ## Patterns
 *
 * The manual documents the AmigaDOS syntax in full — `?`, `#`, `(a|b)`, `~`,
 * `[abc]`, `[~abc]`, `a-z`, `%` — and then notes of `*`:
 *
 *     Synonym for "#?", not available by default in 2.0. Available as an
 *     option that can be turned on.
 *
 * which is exactly what `Jd Star Joker On` and `Jd Star Joker Off` do, and
 * exactly the `star` flag `amigaMatch` already takes for LDos. So the matcher
 * is shared rather than written twice; only the flag is new. It starts OFF,
 * as the note says.
 *
 * The flag is NOT this extension's, though, which is what reading routines 11
 * and 12 changed. Both are sixteen bytes that reach through DOSBase to
 * `dl_Root->rn_Flags` and set or clear bit 24, RNF_WILDSTAR -- the machine's
 * one global "treat * as #?" setting, which every pattern parse consults. It
 * lives on Machine now (see ../amiga/machine.ts), and LDos's `Lwild` reads the
 * same field, because on the machine there is one RootNode and turning the
 * star on for K3 turns it on for everything.
 *
 * ## Jd Relabel, and why it is slot-qualified
 *
 * Two different libraries in this family have a keyword called `Jd Relabel`
 * and they are not the same keyword.
 *
 * The MAIN JD library's rewrites the volume's root block through
 * trackdisk.device (+|jd.s, alongside Read/Write Sector, Install, Format and
 * Diskchange). That whole family is n/a: AmigaFS is a filesystem, there is no
 * block device under it and no medium to format.
 *
 * K3's is 936 bytes of library for six keywords and cannot be doing raw track
 * work; its `F=Jd Relabel(D$,N$)` — "Benennt eine Diskette um", 0=ok and
 * 1=Fehler — is dos.library's Relabel, which is renaming a volume, and
 * `AmigaFS.renameVolume` does precisely that, carrying the files, the assigns
 * and the current directory across.
 *
 * So it is registered under `ext19:jd relabel`, bound to the slot where K3 was
 * actually identified. A program that installed K3 gets a working Jd Relabel;
 * a program calling JD's still meets the block device that is not here.
 */
import { VI, str, type Value } from '../interp/values'
import type { Func, Instr } from '../interp/builtins'
import type { Runtime } from './runtime'
import { amigaMatch } from '../amiga/dospattern'

export function makeJdK3Instructions(rt: Runtime): Record<string, Instr> {
  return {
    /**
     * Jd Star Joker On / Off — "oeffnet" and "entfernt >*< als DOS-Wildcard".
     *
     * Routines 11 ($2ba) and 12 ($2ca), sixteen bytes each and identical but
     * for one instruction:
     *
     *     movea.l $2b8(a5), a0      DOSBase
     *     movea.l $22(a0), a0       dl_Root
     *     bset.b  #$18, $34(a0)     rn_Flags bit 24, RNF_WILDSTAR  (bclr for Off)
     *
     * so this is AmigaDOS's global flag, not a private one -- see
     * ../amiga/machine.ts. Neither routine reads the old value or reports
     * anything, so On twice is On.
     */
    'jd star joker on'() {
      rt.machine.wildStar = true
    },
    'jd star joker off'() {
      rt.machine.wildStar = false
    },
    /**
     * Jd Toggle Click — "wechselt Status des Laufwerk-Klickens", the click a
     * drive makes while polling for a disk. It takes no argument and reports
     * nothing: it flips whatever the state was.
     *
     * Routine 13 ($2da), 120 bytes, and it is four drives rather than one --
     * the body runs with d0 = 0, 1, 2, 3 and does the whole dance per unit:
     *
     *     CreateMsgPort              (-$29a)
     *     CreateIORequest(port, $30) (-$28e)       $30 = sizeof(IOStdReq)
     *     OpenDevice("trackdisk.device", unit)     (-$1bc), d1 = 0
     *     tst.b d0 / bne .skip                     a drive that is not there
     *     movea.l $18(a3), a0                      io_Unit
     *     bchg.b  d0, $35(a0)                      d0 is 0 here: bit 0 of +$35
     *     CloseDevice / DeleteIORequest / DeleteMsgPort
     *
     * so each unit's own click bit is toggled independently, and units that
     * fail to open are silently skipped. "trackdisk.device" is the only device
     * name in the hunk.
     *
     * NOTE: one flag stands in for the four, because there is no drive to
     * click and no unit to open -- every unit would fail OpenDevice here, so
     * the faithful answer is to do nothing at all. The flag is kept because a
     * program may toggle and re-toggle, and the shape matches the printer and
     * serial settings, recorded exactly and applied to a port with nothing on
     * it.
     */
    'jd toggle click'() {
      rt.jd.driveClick = !rt.jd.driveClick
    },
  }
}

export function makeJdK3Functions(rt: Runtime): Record<string, Func> {
  /**
   * The two matchers differ only in which dos.library pair they call, and the
   * shared prologue (routine 9, $1de) is what fixes the argument order: the
   * FIRST written argument is the one whose length sizes the parse buffer
   * (`move.w (a0),d0 / lsl.l #$1,d0 / addq.l #$2,d0`, ParsePattern's
   * documented 2n+2), so A$ is the PATTERN and B$ the string.
   *
   * Routine 10 ($280) is the shared tail: FreeMem the parse buffer and hand
   * back what MatchPattern returned, untouched. So the result is dos.library's
   * BOOL -- DOSTRUE (-1) or 0 -- and NOT the manual's "0=nein / 1=ja". The
   * other two matchers in this tree, LDos's Lwild and AMCAF's Wildcard, both
   * already answer -1; this one was the odd one out.
   */
  const match = (a: Value | undefined, b: Value | undefined, noCase: boolean): Value =>
    VI(amigaMatch(str(b ?? VI(0)), str(a ?? VI(0)), rt.machine.wildStar, noCase) ? -1 : 0)

  return {
    /**
     * F=Jd Relabel(D$,N$) — "Benennt eine Diskette um". Routine 6 ($136), 48
     * bytes, and it is dos.library's Relabel at -$2d0 exactly as the manual's
     * wording implies:
     *
     *     moveq   #$ff, d0          the answer if either string is EMPTY
     *     movea.l (a3)+, a0         popped in reverse, so N$ first
     *     cmpi.w  #$0, (a0)+ / beq .out
     *     move.l  a0, d2            d2 = the new name
     *     movea.l (a3)+, a0         ...then D$
     *     cmpi.w  #$0, (a0)+ / beq .out
     *     move.l  a0, d1            d1 = the volume
     *     movea.l $2b8(a5), a6 / jsr -$2d0(a6)     Relabel(d1, d2)
     *  .out: move.l d0, d3
     *
     * DEFECT: the manual says "Ergebnis : 0=ok / 1=Fehler" and it is wrong in
     * both directions. Relabel answers DOSTRUE (-1) for success and 0 for
     * failure, and the routine returns that untouched -- so ok is -1, not 0.
     * `moveq #$ff,d0` SIGN-EXTENDS, so the empty-argument bail is -1 as well,
     * which means a program cannot tell "renamed" from "you passed me an empty
     * string" by the result alone. Reproduced, because that is what a program
     * written against the library would have been testing.
     */
    'jd relabel'(_, a) {
      const to = str(a[1] ?? VI(0))
      const from = str(a[0] ?? VI(0))
      // either string empty: the routine never reaches Relabel and still says -1
      if (from === '' || to === '') return VI(-1)
      return VI(rt.vfs?.renameVolume(from, to) ? -1 : 0)
    },
    /**
     * X=Jd Match(A$,B$) — "Vergleich, ob Pattern auf den String passt".
     * Routine 7 ($166): ParsePattern (-$348) then MatchPattern (-$34e).
     *
     * DEFECT: the manual's "0=nein / 1=ja" is wrong about the yes. It is
     * MatchPattern's DOSTRUE, -1 -- see `match` above. A$ is the PATTERN and
     * B$ the string, which the manual's example fixes:
     *
     *     X=Jd Match Nocase("*t-S*,"Test-String") -> X=1
     *
     * (the missing closing quote is the author's typo, not a second syntax).
     * That example also only works with the star joker on, so it is written
     * against a program that has turned it on.
     */
    'jd match'(_, a) {
      return match(a[0], a[1], false)
    },
    /**
     * X=Jd Match Nocase(A$,B$) — "ohne Beruecksichtigung von
     * Gross-/Kleinschreibung". Routine 8 ($1a2), the same shape against
     * ParsePatternNoCase (-$3c6) and MatchPatternNoCase (-$3cc).
     *
     * Those are the two AMCAF's Wildcard was already read as calling, so the
     * two extensions corroborate each other on the LVO pair. The fold is
     * dos.library's, which is why this now hands `noCase` to `amigaMatch` and
     * lets `dosUpper` do it, rather than calling JS `toLowerCase()` on both
     * strings -- that folded by Unicode rules where the library folds by a
     * fixed table, and they disagree outside ASCII.
     */
    'jd match nocase'(_, a) {
      return match(a[0], a[1], true)
    },
  }
}

/** every JD-K3 keyword this file implements, for the coverage manifest */
export const JDK3_IMPLEMENTED: readonly string[] = [
  'jd relabel', 'jd match', 'jd match nocase',
  'jd star joker on', 'jd star joker off', 'jd toggle click',
]
