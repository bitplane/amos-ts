/**
 * Coverage classification — the source of truth for KEYWORDS.md.
 *
 * Every implemented keyword defaults to "approximated" (works, passes our
 * tests, but not verified against the original). A keyword may only be
 * promoted to FAITHFUL when its behaviour has been checked against the
 * original 68k source (+Lib.s/+ILib.s/+W.s/extensions), the official
 * help manual, or byte-exact artifacts — and the test suite cites it.
 */

/** Verified against the original implementation or real artifacts. */
export const FAITHFUL = new Set<string>([
  // core semantics audited against +ILib.s (New_Evalue and operators),
  // exercised by tests citing the routines
  'int', // SPFloor
  'str$', // LongToAsc "avec signe" — leading space on non-negatives
  'not', // FnNot: fresh New_Evalue, bitwise not, floats convert
  'set tab', // SetTab/Tab in +W.s; default 4 from Wo3a
  // Pac.Pic decoder is a line-by-line port of UnPack_Bitmap; all corpus
  // banks decode pixel-perfect
  'unpack',
  // AMAL: compiler+VM ported from TokAMAL/Animeur (bank programs and
  // PLay excepted — see notes)
  'amal',
  'amal on',
  'amal off',
  'amal freeze',
  'channel',
  'synchro',
  'synchro on',
  'synchro off',
  'amreg',
  'chanan',
  'chanmv',
  'amalerr',
  // sample commands: bank format and argument forms from +Music.s GetSam
  'sam bank',
  'sam play',
  'sam stop',
  'sam loop on',
  'sam loop off',
  // string/maths sweep: every routine read in +Lib.s/+ILib.s, edge
  // behaviours (errors, empty cases, ranges) reproduced and tested
  'rnd', // FnRnd: LCG $BB40E62D, mask+retry, Rnd(0)=last (no raster noise)
  'randomize',
  'instr', // InstrFind: empty needle 0, start 0=1, negative errors
  'left$',
  'right$',
  'mid$', // RFnMid: position 0 acts as 1, negatives error
  'chr$', // 0-255 or error
  'asc',
  'len',
  'space$',
  'string$', // RString: negative errors, "" source -> ""
  'upper$', // ASCII-only
  'lower$',
  'flip$',
  'val', // ValRout: skips spaces anywhere, $/% prefixes, float detection
  'bin$',
  'hex$', // LongToBin/Hex: prefixed, fixed digits zero-padded
  'max', // MinMax: 2 args, int/float/string via Compat
  'min',
  'sgn',
  'abs',
  'sqr', // FlPos: negative errors
  'log',
  'ln',
  'exp',
  'sin',
  'cos',
  'tan',
  'asin', // AAngle: output converted in Degree mode
  'acos',
  'atan',
  'hsin', // spec "15": inputs angle-converted like Sin
  'hcos',
  'htan',
  'pi#',
  'degree',
  'radian',
  'fix', // InFix: 0-15 digits, >=16 default, negative = exponent
  'swap',
  'true',
  'false',
  'tab$', // FinChr control characters
  'cleft$',
  'cright$',
  'cup$',
  'cdown$',
  // statement sweep: InFor/InNext/ssprint/InRead/InData/InEvery read
  'for', // no initial test — the body always runs once
  'next', // always the innermost loop; the variable token is cosmetic
  'print', // ',' emits TAB; Using formats one expression; CR+LF ending
  'data',
  'read', // empty items by target type; per-procedure data pointers
  'every',
  'every on',
  'every off',
])

/** Tokens the interpreter handles structurally (dispatch, literals, glue). */
export const STRUCTURAL = new Set([
  ':', ',', ';', '#', '(', ')', '[', ']', 'to', 'not', 'then', 'step', 'rem', "'", 'procedure',
])

/** Editor/compiler-internal tokens that cannot execute in a program. */
export const NA = new Set<string>([
  'ask editor',
  'call editor',
  'close editor',
  'kill editor',
  'monitor',
  'include',
  'equ',
  'struc',
  'struc$',
  '||apcmp||',
  '\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\/',
  ',',
])

/** Known simplifications worth surfacing next to a keyword. */
export const NOTES: Record<string, string> = {
  amal: 'string programs only — Amal n,# bank programs unsupported',
  bob: 'rendered as composite overlay; framebuffer not blitted',
  'bob update': 'no-op — overlay model makes autoback implicit',
  'double buffer': 'no-op (logical = physical)',
  'screen swap': 'no-op',
  fade: 'instant, no ramp',
  rain: 'stored, not rendered',
  rainbow: 'stored, not rendered',
  'set rainbow': 'stored, not rendered',
  writing: 'only replace mode',
  'gr writing': 'ignored',
  vumeter: 'synthesized level, not real amplitude',
  bell: 'modern synthesis, not chip waveform',
  shoot: 'modern synthesis',
  boom: 'modern synthesis',
  'load iff': 'HAM decodes as indexed (wrong colours)',
  centre: 'no Border$ handling',
  ink: 'pattern/border arguments ignored',
  paint: 'border mode ignored',
  'hot spot': 'code form approximated',
  'mouse zone': 'current-screen coordinate mapping approximated',
  print: 'Print # channels unsupported',
  using: "'^' exponent slots not implemented",
  'def fn': 'implemented from the manual, FnFn body not yet read',
  fn: 'implemented from the manual, FnFn body not yet read',
  input: 'no editing keys; comma-splitting approximated',
  timer: 'writable, drives the frame clock directly',
  rnd: 'deterministic — original mixes in the raster beam position',
  inc: 'also works on float variables (original: integer only)',
  dec: 'also works on float variables (original: integer only)',
  add: 'also works on float variables (original: integer only)',
}
