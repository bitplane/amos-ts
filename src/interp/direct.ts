/**
 * Direct mode: one typed line, run against the program that is loaded.
 *
 * `Ver_Direct` (+Verif.s:71) is the whole entry point on the machine. It
 * reserves the direct variable space, points `Prg_Test` and `Prg_Run` at the
 * editor's line buffer, sets `Phase` and `DirFlag` to 1, verifies, and calls
 * `Ver_Run`. The variables the line sees are the program's own, because the
 * arena is not per-program: `ResDir` (+Verif.s:4012) carves the direct slots
 * off the top of the SAME `TabBas`.
 *
 * `DirFlag` and `Direct` are different words. `DirFlag` tells the verifier the
 * buffer holds a bare token stream with no line header (`SsTest` +Verif.s:237);
 * `Direct` is set by the editor while its escape screen is up (`Esc_Appear`
 * +Edit.s:9362, cleared by `Esc_Hide` :9538) and is what the ten checks below
 * and the three interpreter gates read.
 */
import { AmosError } from './values'
import type { Names } from './names'
import type { Tok, TokenLine } from '../tokens/stream'

/**
 * The core keywords `Ver_Direct` rejects, by name.
 *
 * Every one is a `tst.w Direct(a5) / bne VerIlD` at the head of the routine
 * that verifies it: `VerSStack` (+Verif.s:788), `VerSBu` (:834), `V1_Proc`
 * with `V1_OnBreak` sharing its label (:1530), `V1_Procedure` (:1550),
 * `V1_EndProc` (:1705) and `VerSha`, which takes both Global and Shared
 * (:3856).
 *
 * `On Error Proc` is not here because it does not tokenise as one keyword:
 * it is `on error` followed by the `proc` token, and the `proc` token is.
 */
const ILLEGAL_KEYWORDS = new Set([
  'set stack',
  'set buffer',
  'proc',
  'on break proc', // its own token, and V1_OnBreak shares V1_Proc's check
  'procedure',
  'end proc',
  'global',
  'shared',
])

/**
 * Whether a token is one of the ten things direct mode will not verify.
 *
 * The other four are token KINDS rather than keywords. `VerRem` (+Verif.s:745)
 * rejects a comment, `VerLab` (:792) a label definition, and `VerPro` (:781)
 * and `V1_CallProc` (:3299) between them reject the procedure-call token in
 * both the places it can appear --- which is why a direct line cannot call a
 * procedure even though the program it is typed at is full of them.
 */
function illegal(t: Tok, names: Names): boolean {
  if (t.kind === 'rem' || t.kind === 'label' || t.kind === 'procCall' || t.kind === 'proc') return true
  if (t.kind !== 'core') return false
  const name = names.coreName(t.id)
  return name !== undefined && ILLEGAL_KEYWORDS.has(name)
}

/**
 * Check a typed line before it runs, and say why not.
 *
 * The message is `ED_TST_MESSAGES[6]`, the verifier's own table --- `VerIlD`
 * is `moveq #7,d0` (+Verif.s:644) and that table is 1-based. It carries no
 * Errn: a verification error never reaches a running program, so there is
 * nothing for `On Error` to catch and nothing for `=Errn` to report.
 */
export function verifyDirect(line: TokenLine, names: Names): void {
  for (const t of line.tokens) {
    if (illegal(t, names)) throw new AmosError('Illegal direct mode')
  }
}
