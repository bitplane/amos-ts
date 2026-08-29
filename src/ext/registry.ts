/**
 * The extension registry.
 *
 * AMOS Professional loads up to 26 extensions, each into a numbered slot, from
 * filenames held in the interpreter config: slot n comes from config message
 * 15+n (+B.s:2149-2166, +Interpreter_Config.s:150-157). A tokenised program
 * refers to an extension keyword as (slot, token id) and nothing else — there
 * is no name, no version, no checksum. When a program is loaded, Ver_Extension
 * (+Verif.s:430-460) simply indexes AdTokens[slot] and raises error 5,
 * "Extension not present", if that slot happens to be empty. It never checks
 * that the extension sitting there is the one the program was written against.
 *
 * So a slot number is a property of the machine a program was saved on, not of
 * the program, and certainly not an identity: TURBO Plus occupies slot 12 on
 * one person's Amiga and something else entirely on another's. Extension
 * authors make this worse by recommending a slot in their docs (Misc's manual
 * says "enter at number 23"), which users follow or ignore as they please.
 *
 * Everything here is therefore keyed by extension identity — a stable id like
 * "intuition-1.3b" — and slots are resolved separately, by fingerprint, in
 * ./identify.ts.
 */
import { TokenTable } from '../tokens/stream'
import type { TokenEntry } from '../tokens/libtok'
import { EXT_TABLES, EXT_INFO } from './tables.gen'

/** How an extension's token table was obtained. */
export type ExtFormat =
  /** AMOS Pro 2.0 library, "AP20" magic present (LBF_20 in +B.s:2255). */
  | 'ap20'
  /** Pre-2.0 / third-party library layout, no AP20 magic. */
  | 'legacy'
  /** Assembled from the extension's own token-table source. */
  | 'source'
  /**
   * A token table with the library stripped out from under it: the shape the
   * `AMOSTools/Extensions` directory ships, where the hunk shell and the
   * table survive and every entry's two routine words are overwritten with
   * `====`. Names, specs and ids are the original's -- checked entry for
   * entry against CRAFT, which is held both ways -- and the routine numbers
   * are gone, so a table read this way can never rise above `manual`.
   */
  | 'amostools'

/**
 * How well we know what an extension's keywords actually *do*. This is
 * deliberately separate from whether we can read its token table: names and
 * parameter specs come free with the table, behaviour does not.
 *
 * The tier records the strongest evidence AVAILABLE, not whichever artifact a
 * porter happened to consult. That distinction is the whole rule, because
 * `manual` is not evidence at all in the presence of a binary — it is what
 * you fall back on when there is nothing to read. So:
 *
 *   **`manual` is legal only when there is no library binary.**
 *
 * A shipped `.Lib` can always be disassembled: every keyword carries a routine
 * number, so the read is tens of instructions rather than thousands, and
 * src/cli/extdis.ts does the resolving. An extension whose binary we hold is
 * therefore never below `disassembly`, whatever its documentation looks like,
 * and `manual` for such an extension is a claim that we chose to believe a
 * paragraph over the code that shipped. ext.test.ts enforces this — for the
 * field and, separately, for the prose that describes it, because the field
 * was corrected once while twelve manifests went on narrating the old answer.
 *
 * There is no tier below `manual`, and as of 2026-08-21 nothing is IN
 * `manual` either: every registered extension holds a binary or the author's
 * source. There used to be a `table` tier below it — names and arities only,
 * behaviour guessed — and nothing ever occupied that: the token table alone
 * is what src/cli/libpool.ts produces from a scan, and a scan reads `.Lib`
 * files, so even that path has the binary by construction.
 */
export type ExtEvidence =
  /**
   * Original assembler source available — behaviour can be read directly,
   * with the author's own symbols and comments. Includes the case where the
   * source is not in this extension's own fixture: Personnal-EXTRA's ships
   * inside the personnal-1.1 archive, and the stock AMOS 1.3 libraries are
   * covered by the AMOS Professional sources their keywords survived into.
   */
  | 'source'
  /**
   * The library binary is available. This ranks with `source` for what it
   * permits — it is the shipped code, and strictly more authoritative than a
   * manual, which can be wrong (LDos's documents a password-length check that
   * only one of its two crypt routines actually has). It is tracked
   * separately because the failure mode differs: a disassembly has no symbols
   * or comments, data and code are easy to confuse, and there is no way to
   * grep for every caller. A keyword read this way can be faithful; what it
   * cannot be is re-checked as cheaply.
   *
   * Note this tier is about availability, not about work done. It says the
   * evidence is there to be read, and says nothing about whether any
   * particular keyword has been read yet. That is recorded per keyword and
   * nowhere else: the routine number in the doc block above the handler, which
   * src/ext/citations.test.ts resolves against the binary it names. A handler
   * with no routine number has no reading behind it, and no tool infers one.
   */
  | 'disassembly'
  /**
   * No binary and no source; the extension's own manual or command reference
   * is all that describes it. A keyword ported from here cannot be marked
   * faithful, because there is nothing to check it against.
   *
   * NOTHING IS HERE. intuition-1.3b was, on the reading that its archive held
   * `itokens.s` and nothing else --- and `itokens.s` really is only a token
   * table, so the reading was right about the file it looked at. It was wrong
   * about the directory: twenty-five more `.s` files sit beside it holding
   * every one of the 267 routines it names, and two shipped binaries and the
   * guide are in the corpus as well. The tier is empty and worth keeping
   * empty; a row that reaches it is a row nobody has finished looking for.
   */
  | 'manual'

export interface ExtensionInfo {
  id: string
  name: string
  version: string
  author: string
  origin: 'stock' | 'third-party'
  format: ExtFormat
  evidence: ExtEvidence
  /**
   * Whether the token-id base was proven against observed programs
   * ('calibrated') or taken from the shared layout of similar libraries
   * ('assumed'). An assumed base means ids may be uniformly offset.
   */
  idBaseEvidence: 'calibrated' | 'assumed'
  /** Slot the stock config assigns, or the extension's docs recommend. */
  defaultSlot?: number
  /**
   * The slot the LIBRARY ITSELF states, and the strongest of the three.
   *
   * Extension call 1025 raises a library's own error message, and `d2` at the
   * call site is the extension number, zero-based — so any library that can
   * report an error has its slot compiled into it, put there by whoever built
   * it. That outranks `defaultSlot`, which is a manual or a wiki page
   * recommending something, and it outranks `observedSlots`, which is where
   * one person happened to install it.
   *
   * DERIVED, NOT TRANSCRIBED. src/cli/genext.ts reads it out of the binary
   * with the same scan src/cli/errscan.ts uses, so it cannot drift from the
   * file the way a hand-copied number would; regenerating recomputes it. It
   * lives here rather than only in errscan because errscan needs the corpus
   * and this file is committed, so the evidence survives a checkout with no
   * `fixtures/`.
   *
   * Absent when the library raises no errors of its own — fourteen keywords
   * with no failure path need no message table — which is a fact about the
   * library and not a gap in the reading.
   */
  statedSlot?: number
  /** Slots this extension has actually been seen occupying in real programs. */
  observedSlots: number[]
  /** Identity strings embedded in the library binary ($VER cookies, banners). */
  titleStrings: string[]
  sha256: string
  provenance: string
  notes: string
}

export interface Extension extends ExtensionInfo {
  tokens: TokenEntry[]
  /** Lazily built lookup table for this extension's tokens. */
  table: TokenTable
}

const cache = new Map<string, Extension>()

/** Every extension we know about, keyed by identity. */
export const REGISTRY: readonly ExtensionInfo[] = EXT_INFO

/**
 * `LB_Title` (+Equ.s:2243): what the library calls itself.
 *
 * `Ed_AboutExt` (+Edit.s:4621) reads this field and nothing else about an
 * extension, so it is the whole of what the editor's About box has to show.
 * The banner is read out of the binary by src/cli/genext.ts and lands in
 * `titleStrings[0]`, which is why the box says "AMOSPro Music extension V
 * 2.00" and not "Music": the author wrote that line, we did not.
 *
 * Falls back to the registry's own name and version for the tables built from
 * an extension's source and for the AMOSTools stubs, which have no library to
 * read a banner out of. A library whose title block is empty is `.Empty dc.w
 * 0` on the machine -- a blank line under the extension number -- and this
 * answers the same nothing rather than inventing a line for it.
 */
export function extensionTitle(e: ExtensionInfo): string {
  const banner = e.titleStrings.find((t) => !t.startsWith('$VER:'))
  if (banner !== undefined) return banner
  if (e.format === 'source' || e.format === 'amostools') return `${e.name} ${e.version}`.trim()
  return ''
}

export function extensionById(id: string): Extension | undefined {
  const hit = cache.get(id)
  if (hit) return hit
  const info = EXT_INFO.find((e) => e.id === id)
  const tokens = EXT_TABLES[id]
  if (!info || !tokens) return undefined
  const ext: Extension = { ...info, tokens, table: new TokenTable(tokens, true) }
  cache.set(id, ext)
  return ext
}

/** All registered extensions, resolved. */
export function allExtensions(): Extension[] {
  return EXT_INFO.map((e) => extensionById(e.id)!).filter(Boolean)
}

/**
 * The slot bindings of a stock AMOS Professional installation, straight from
 * the shipped interpreter config. This is the right default for the official
 * corpus and the wrong one for anybody who added extensions of their own —
 * which is what identify.ts is for.
 */
export function defaultSlotBindings(): Map<number, Extension> {
  const m = new Map<number, Extension>()
  for (const info of EXT_INFO) {
    if (info.origin !== 'stock' || info.defaultSlot === undefined) continue
    m.set(info.defaultSlot, extensionById(info.id)!)
  }
  return m
}

/**
 * Slot -> token table for the stock configuration. Kept in the shape the
 * loaders and CLIs already expect.
 */
export function defaultExtensionTables(): Map<number, TokenTable> {
  const m = new Map<number, TokenTable>()
  for (const [slot, ext] of defaultSlotBindings()) m.set(slot, ext.table)
  return m
}

/**
 * Slot -> token defs for the stock configuration.
 *
 * This is the right binding for the official corpus, which was written on
 * stock installations. Anything that loads programs from elsewhere should
 * identify slots from the program's own evidence instead — see ./identify.ts.
 */
export const EXTENSION_TOKENS: Map<number, TokenEntry[]> = new Map(
  EXT_INFO.filter((e) => e.origin === 'stock' && e.defaultSlot !== undefined).map((e) => [
    e.defaultSlot!,
    EXT_TABLES[e.id]!,
  ]),
)
