/**
 * JD-K3 1.1 — the smallest of Joerg Dommermuth's five libraries, six keywords
 * at slot 19. Volume renaming, AmigaDOS pattern matching, and the drive click.
 *
 * ## Evidence
 *
 * `AMOSPro_JDK3.Lib` (936 bytes) and its `.MANUAL`, in the same
 * Name/Parameter/Funktion/Ergebnis/Syntax/Beispiel/siehe form as the rest of
 * the JD set, so the manual settles the contracts and the binary the details.
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
import { amigaMatch } from './ldospat'

export function makeJdK3Instructions(rt: Runtime): Record<string, Instr> {
  return {
    /** Jd Star Joker On — "oeffnet >*< als DOS-Wildcard" */
    'jd star joker on'() {
      rt.jd.starJoker = true
    },
    /** Jd Star Joker Off — "entfernt >*< als DOS-Wildcard" */
    'jd star joker off'() {
      rt.jd.starJoker = false
    },
    /**
     * Jd Toggle Click — "wechselt Status des Laufwerk-Klickens", the click a
     * drive makes while polling for a disk. It takes no argument and reports
     * nothing: it flips whatever the state was.
     *
     * NOTE. The state is kept and nothing clicks, because there is no drive
     * to click. Same shape as the printer and serial settings, which are
     * recorded exactly and applied to a port with nothing on it.
     */
    'jd toggle click'() {
      rt.jd.driveClick = !rt.jd.driveClick
    },
  }
}

export function makeJdK3Functions(rt: Runtime): Record<string, Func> {
  /** the two matchers differ only in case folding */
  const match = (a: Value | undefined, b: Value | undefined, fold: boolean): Value => {
    const pattern = str(a ?? VI(0))
    const source = str(b ?? VI(0))
    const p = fold ? pattern.toLowerCase() : pattern
    const s = fold ? source.toLowerCase() : source
    return VI(amigaMatch(s, p, rt.jd.starJoker) ? 1 : 0)
  }

  return {
    /**
     * F=Jd Relabel(D$,N$) — "Benennt eine Diskette um", 0=ok / 1=Fehler.
     * Note the result is the opposite way round from most of AMOS: zero is
     * success here, as the manual's "Ergebnis : 0=ok / 1=Fehler" says.
     */
    'jd relabel'(_, a) {
      const from = str(a[0] ?? VI(0))
      const to = str(a[1] ?? VI(0))
      return VI(rt.vfs?.renameVolume(from, to) ? 0 : 1)
    },
    /**
     * X=Jd Match(A$,B$) — "Vergleich, ob Pattern auf den String passt",
     * 0=nein / 1=ja. A$ is the PATTERN and B$ the string, which is the
     * order the manual's example fixes:
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
    /** X=Jd Match Nocase(A$,B$) — "ohne Beruecksichtigung von Gross-/Kleinschreibung" */
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
