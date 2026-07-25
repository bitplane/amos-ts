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
 * How well we know what an extension's keywords actually *do*. This is
 * deliberately separate from whether we can read its token table: names and
 * parameter specs come free with the table, behaviour does not.
 */
export type ExtEvidence =
  /** Original assembler source available — behaviour can be read directly. */
  | 'source'
  /** The extension's own manual or command reference documents behaviour. */
  | 'manual'
  /** Token table only: names and arities are known, behaviour is inferred. */
  | 'table'

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

export function extensionById(id: string): Extension | undefined {
  const hit = cache.get(id)
  if (hit) return hit
  const info = EXT_INFO.find((e) => e.id === id)
  const tokens = EXT_TABLES[id]
  if (!info || !tokens) return undefined
  const ext: Extension = { ...info, tokens, table: new TokenTable(tokens) }
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
