export { BinReader } from './loader/binreader'
export { parseAmosFile } from './loader/amosfile'
export type { AmosFile, Bank, SpriteBank, MemoryBank, Sprite } from './loader/amosfile'
export { parseAmosLib, parseTokenTable, firstCodeHunk } from './tokens/libtok'
export type { TokenEntry, AmosLib } from './tokens/libtok'
export { TokenTable, parseSource, decodeFFP, OPERATORS, T, TokenStreamError } from './tokens/stream'
export type { Tok, TokenLine } from './tokens/stream'
export { detokLine, detokSource } from './tokens/edtok'
export type { EdtokOptions } from './tokens/edtok'
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
// The one-call path from bytes to something runnable: it works out the token
// table, the extension slots and the banks, which is otherwise four modules'
// worth of assembly a consumer has to rediscover. Both CLI runners and the web
// player go through it, and neither could without reaching past the package.
export { isAmosProgram, loadProgram } from './loader/program'
export type { LoadedProgram } from './loader/program'
export { Interp, AmosRuntimeError, newInputState } from './interp/interp'
export type { InterpOptions, RunResult, InputState } from './interp/interp'
// what a keyword handler IS — needed to write one, and to type a table of them
export type { Instr, Func } from './interp/builtins'
export { BufferIO } from './interp/io'
export type { AmosIO } from './interp/io'
export { prescan } from './interp/prescan'
export type { Program, Addr, ProcInfo, Ctrl } from './interp/prescan'
export { VI, VF, VS, display, AmosError } from './interp/values'
export type { Value } from './interp/values'
export { Runtime } from './runtime/runtime'
export type { RuntimeOptions } from './runtime/runtime'
export { Screen, DEFAULT_PALETTE } from './runtime/screen'
export { FONT8 } from './runtime/font.gen'

// The host boundary. RuntimeOptions.host is `Partial<Host>`, so without
// these a consumer could pass an object literal but could not name the type,
// write a helper, implement SerialHost, or reach the clocks -- which made
// `clock` unsatisfiable from outside the package.
export { defaultHost, fixedClock, systemClock, FIXED_DATE } from './amiga/host'
export type {
  Host,
  Clock,
  DateStamp,
  Unavailable,
  PrinterPage,
  SerialHost,
  SerialLineParams,
  SerialPortHandle,
} from './amiga/host'
