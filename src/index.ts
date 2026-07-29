export { BinReader } from './loader/binreader'
export { parseAmosFile } from './loader/amosfile'
export type { AmosFile, Bank, SpriteBank, MemoryBank, Sprite } from './loader/amosfile'
export { parseAmosLib, parseTokenTable, firstCodeHunk } from './tokens/libtok'
export type { TokenEntry, AmosLib } from './tokens/libtok'
export { TokenTable, parseSource, decodeFFP, OPERATORS, T, TokenStreamError } from './tokens/stream'
export type { Tok, TokenLine } from './tokens/stream'
export { detokLine, detokSource } from './tokens/detok'
export type { DetokOptions } from './tokens/detok'
export { CORE_TOKENS } from './tokens/tables.gen'
// EXTENSION_TOKENS is slot -> raw token defs. `Runtime` and `tokenize` want
// slot -> TokenTable, which is what defaultExtensionTables() builds — without
// it a consumer of the package cannot use an extension at all.
export {
  EXTENSION_TOKENS,
  REGISTRY,
  extensionById,
  allExtensions,
  defaultSlotBindings,
  defaultExtensionTables,
} from './ext/registry'
export type { Extension, ExtensionInfo } from './ext/registry'
export type { TokenDef } from './tokens/tables.gen'
export { tokenize, TokenizeError } from './tokens/tokenizer'
export { Interp, AmosRuntimeError } from './interp/interp'
export type { InterpOptions, RunResult } from './interp/interp'
export { BufferIO } from './interp/io'
export type { AmosIO } from './interp/io'
export { prescan } from './interp/prescan'
export type { Program, Addr, ProcInfo } from './interp/prescan'
export { VI, VF, VS, display, AmosError } from './interp/values'
export type { Value } from './interp/values'
export { Runtime } from './runtime/runtime'
export type { RuntimeOptions } from './runtime/runtime'
export { Screen, DEFAULT_PALETTE } from './runtime/screen'
export { FONT8 } from './runtime/font.gen'
