/**
 * AMOS source text into the program the interpreter runs.
 *
 * Three steps, and all three are the machine's: `tokeniseSource` is the
 * editor's own `Tokenise` (+Edit.s:14226), `verify` is the Test pass
 * (+Verif.s:225), and `parseSource` reads the bytes back as the interpreter
 * does. Nothing in between is this port's invention.
 *
 * It used to be. `tokenizer.ts` was a hand-written text-to-token pass that
 * promoted procedure calls up front, because `Tokenise` genuinely cannot tell
 * a call from a variable -- it writes $0006 for both and the VERIFIER decides.
 * With the verifier ported there is nothing left for a second tokeniser to do,
 * and one fewer thing that can disagree with the Amiga.
 *
 * What that swap costs is strictness: this rejects what AMOS rejects. A line
 * that reads an array `Dim` never declared, or hands an instruction a string
 * where it wants a number, throws here rather than reaching the interpreter.
 */
import { TokenTable, parseSource } from './stream'
import type { TokenLine } from './stream'
import { tokeniseLine } from './edtok'
import { verify, VerifyError } from './verify'

/** a line the format cannot hold, which `Tokenise` answers with -1 */
export class LineTooLongError extends Error {
  constructor(readonly line: number) {
    super(`line ${line} is 510 bytes or more tokenised, which the editor cannot hold`)
    this.name = 'LineTooLongError'
  }
}

/**
 * A `VerifyError` with the line that caused it.
 *
 * The machine has no use for this. `Ed_Test` (+Edit.s:2557) takes the position
 * the verifier stopped at, seeks the line containing it and puts the cursor
 * there, so on an Amiga the offending text is on screen and needs no naming.
 * There is no screen here, and a byte offset into a token stream is not
 * something a caller can act on.
 */
export class SourceVerifyError extends Error {
  constructor(
    override readonly cause: VerifyError,
    readonly line: number,
    readonly text: string,
  ) {
    super(`${cause.message}, line ${line}: ${text.trim()}`)
    this.name = 'SourceVerifyError'
  }
}

/**
 * @param extensions token tables by the slot number a line stores
 * @param knownProcs procedure names the text does not declare, for one typed
 *   line verified against a program that is already loaded
 */
export function tokenize(
  source: string,
  table: TokenTable,
  extensions?: Map<number, TokenTable>,
  knownProcs?: Iterable<string>,
): TokenLine[] {
  return build(source, table, extensions, knownProcs, true)
}

/**
 * The same, for a program AMOS PROFESSIONAL would refuse.
 *
 * Every caller is a test of a routine that exists, is documented, and has no
 * argument list that reaches it. The verifier still runs and still writes;
 * only its refusal is dropped. Three shapes turned up in the audit of the
 * whole extension set, and all three are the library's fault rather than
 * this port's:
 *
 * **An instruction with the function form hung off it, nameless.** Sticks has
 * `!mouse x` as `I0,0` with a `00` behind it, D-Sam does the same for
 * `!smp speed`, Range for `!case`, AGA for `!aga colour`. AMOS Professional
 * cannot reach the function: `Ope_Extension` (+Verif.s:2718) is
 * `cmp.b #"I",d2 / beq VerSynt` before it looks at anything else, and the
 * $FD-and-class-$18 pair that lets `Screen` be both in the CORE table has no
 * equivalent for an extension --- the operand class of every extension token
 * is $06, whatever its own table says. AMOS 1.3 could. Of the 3,873 programs
 * in the corpus, exactly four carry an id that lands on one of those entries
 * --- `X=Mouse X(0)` in Forbidden-Mouse.AMOS and `Smp Speed(1)` in
 * D-Sam-Example.AMOS --- and both files open "AMOS Basic V1.3".
 *
 * **A spec no argument list can match.** Range's `splot` entry has no
 * terminator, so its spec reads on into the entry behind it as
 * `"I0,0,0,0\0\0M"`; SymBase's `db append from` ends `"I0,"`, a separator
 * where a type should be; JD Colour's `jd wait raster` says `"I0,0,0t0,0"`
 * where routine 59 pops one argument and the library's own manual writes
 * `Jd Wait Raster Z`.
 *
 * **A variant behind a $FF.** EasyLife's `!elzb multi add` is `"I0,0",-1`
 * with the usual nameless `"I0"` entry behind it, and `VerC4` (:3158) is
 * `cmp.b #-2,d1 / bne VerSynt`, so the search stops instead of continuing.
 * The variant has no name of its own for `TkKt` to find either. AMOS Pro's
 * own `!sam loop on` has the same mistake, and there the port simply drops
 * the unreachable form rather than testing it.
 *
 * Anything reaching for this is saying "AMOS Pro would not run this", so it
 * belongs in a test, next to an assertion that the typed form is refused,
 * and nowhere else.
 */
export function tokenizeUnchecked(
  source: string,
  table: TokenTable,
  extensions?: Map<number, TokenTable>,
  knownProcs?: Iterable<string>,
): TokenLine[] {
  return build(source, table, extensions, knownProcs, false)
}

/**
 * One line typed at the running program: `Ver_Direct` (+Verif.s:43).
 *
 * The only difference is `Direct(a5)`, which turns on the ten refusals a
 * typed line meets -- no procedure definitions, no labels, no remark, no
 * calling a procedure even though the program it is typed at is full of them.
 */
export function tokenizeDirect(
  source: string,
  table: TokenTable,
  extensions: Map<number, TokenTable> | undefined,
  knownProcs: Iterable<string>,
  knownVars: Iterable<{ name: string; flag: number; dims: number }>,
): TokenLine[] {
  return build(source, table, extensions, knownProcs, true, true, knownVars)
}

function build(
  source: string,
  table: TokenTable,
  extensions: Map<number, TokenTable> | undefined,
  knownProcs: Iterable<string> | undefined,
  checked: boolean,
  direct = false,
  knownVars?: Iterable<{ name: string; flag: number; dims: number }>,
): TokenLine[] {
  const opts = extensions === undefined ? {} : { extensions }
  // `tokeniseSource` drops a line it cannot hold, the way the editor leaves
  // one on screen and tokenises nothing. Silence is right for the editor and
  // wrong here: a caller handing this a 600-byte line wants to hear about it
  // rather than watch the line disappear.
  const parts: Uint8Array[] = []
  /** the 1-based source line each entry of `parts` was tokenised from */
  const from: number[] = []
  const lines = source.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const one = tokeniseLine(lines[i]!.replace(/\r$/, ''), table, opts)
    if (one[0] === 0) {
      if (lines[i]!.trim() !== '') throw new LineTooLongError(i + 1)
      continue
    }
    parts.push(one)
    from.push(i + 1)
  }
  let total = 2
  for (const q of parts) total += q.length
  const bytes = new Uint8Array(total)
  let at = 0
  for (const q of parts) {
    bytes.set(q, at)
    at += q.length
  }
  const options = {
    ...opts,
    // text has no argument counts to preserve, and $FF is what AMOS Pro's own
    // libraries leave behind, so a program typed here reads back as one saved
    // on a machine with 2.0 extensions
    ap20: new Set(extensions?.keys() ?? []),
    ...(knownProcs === undefined ? {} : { knownProcedures: knownProcs }),
    ...(direct ? { direct: true } : {}),
    ...(knownVars === undefined ? {} : { knownVariables: knownVars }),
  }
  let verified: Uint8Array
  try {
    verified = verify(bytes, options)
  } catch (e) {
    if (!checked) return parseSource(bytes, table)
    throw e instanceof VerifyError ? named(e, parts, from, lines) : e
  }
  return parseSource(verified, table)
}

/** the byte the verifier stopped at, back to the line it was tokenised from */
function named(e: VerifyError, parts: Uint8Array[], from: number[], lines: string[]): Error {
  let at = 0
  for (let i = 0; i < parts.length; i++) {
    at += parts[i]!.length
    if (e.at < at) return new SourceVerifyError(e, from[i]!, lines[from[i]! - 1]!)
  }
  return e
}
