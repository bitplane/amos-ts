/**
 * Turning program bytes into something the Runtime can execute.
 *
 * Two kinds of file arrive here and they differ in one way that matters: a
 * tokenised `.AMOS` records which extensions were installed in which slots on
 * the machine that saved it, and a plain-text listing records nothing at all.
 *
 * That distinction decides the token table. AMOS keywords outside the core set
 * — `Med Play`, `Unpack`, `Fsel$`, the whole Music and Compactor vocabulary —
 * are extension tokens, resolved through a slot. Tokenizing a listing without
 * any slots bound means the tokenizer has never heard of them, so they parse as
 * ordinary identifiers and `Med Load "x",7` fails with `expected "="` as though
 * `Med` were a variable someone forgot to assign.
 *
 * So a listing is given the slots of a stock AMOS Professional installation.
 * That is a guess, but it is the only defensible one: a listing is source
 * somebody typed, and what they typed against is overwhelmingly a stock
 * install. A tokenised program is never guessed at — its own header wins.
 */
import { parseAmosFile, type AmosFile } from './amosfile'
import { parseSource, TokenTable, type TokenLine } from '../tokens/stream'
import { tokenize } from '../tokens/tokenizer'
import { extensionTablesFor } from '../ext/identify'
import { defaultExtensionTables } from '../ext/registry'

/** an AMOS program by content, not by name — plenty of them are extensionless */
export function isAmosProgram(bytes: Uint8Array | null | undefined): boolean {
  if (!bytes || bytes.length < 16) return false
  return /^AMOS (Basic|Pro)/.test(new TextDecoder('latin1').decode(bytes.subarray(0, 16)))
}

export interface LoadedProgram {
  lines: TokenLine[]
  /** slot -> token table, for both the tokenizer and the Runtime */
  extensions: Map<number, TokenTable>
  /** the parsed file, or null for a plain-text listing (which has no banks) */
  amos: AmosFile | null
}

export function loadProgram(bytes: Uint8Array, table: TokenTable): LoadedProgram {
  const amos = isAmosProgram(bytes) ? parseAmosFile(bytes) : null
  if (amos) {
    const lines = parseSource(amos.source, table)
    return { lines, extensions: extensionTablesFor(lines), amos }
  }
  const stock = defaultExtensionTables()
  const lines = tokenize(new TextDecoder('latin1').decode(bytes), table, stock)
  return { lines, extensions: stock, amos: null }
}
