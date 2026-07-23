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
  // flow sweep: FnFn/InGoto/InGosub/InReturn/InOn/InDim/InInput read
  'def fn',
  'fn', // parameters write through to the real variables
  'goto', // unwinds loop frames the target is outside of (LGoto)
  'gosub',
  'return', // discards loops opened since the Gosub (one shared stack)
  'on', // out-of-range selector continues to the next statement
  'dim', // re-dimensioning errors (AlrDim); 65535-element limits
  'input', // promptless prints "? "; numbers parse like Val
  'line input',
  'x curs', // XYCuWi cursor readbacks
  'y curs',
  'cmove', // relative move, elided args are 0
  'clw',
  'home', // chr(12): cursor home WITHOUT clearing
  'memorize x',
  'memorize y',
  'remember x',
  'remember y',
  'cdown', // chr(28-31) cursor moves
  'cup',
  'cleft',
  'cright',
  'cline',
  // drawing/palette sweep: InInk/InPaint/InSetLine/InSetPaint/InSetPattern/
  // FadeTOn+FadeI/InFlash/PalRout/InColourBack read
  'ink', // pen[,paper][,border] — border is the area outline pen
  'set line', // 16-bit line pattern on Draw/Box
  'set paint', // outline filled shapes with the border pen
  'paint', // Flood: mode 1 same-colour (default), mode 0 until outline
  'fade', // nibble ±1 per delay toward targets, elided untouched
  'flash', // "(rgb,ticks)..." palette animation
  'flash off',
  'get palette', // colour-mask selects entries (PalRout)
  'get sprite palette',
  'get bob palette',
  'get icon palette',
  'colour back', // border colour, composited as the background
  'colour',
  'palette',
  // objects/screens sweep: real bob pipeline (Actualise-style), buffers
  'bob', // blitted with background save/restore; Point sees bobs
  'bob off',
  'bob update', // manual pass
  'bob update on',
  'bob update off',
  'bob clear',
  'bob draw',
  'x bob',
  'y bob',
  'i bob',
  'priority on',
  'priority off',
  'priority reverse on',
  'priority reverse off',
  'limit bob',
  'double buffer',
  'screen swap',
  'autoback', // mode stored; 2 = logical shown (equivalent visuals)
  'logic', // \$BFFFFFFF / \$80000000|n buffer ids (FnLogic)
  'physic',
  'screen copy', // Logic/Physic-aware buffer blits
  'zoom', // nearest-neighbour scaled blit
  'x screen', // conversions match the AMAL XS/YS/XH/YH routines
  'y screen',
  'x hard',
  'y hard',
  // windows sweep: WOpen/WinDel/QWindow/SBord/STitle + escape W
  'wind open', // x aligned to 16px, per-window console state copied
  'wind close', // restores background under Wind Save
  'wind save',
  'window',
  'windon',
  'clw', // clears the current window only
  'border',
  'title top',
  'title bottom',
  'writing', // w1 replace/OR/XOR/AND/ignore, w2 both/paper/pen-on-0
  'gr writing', // SetDrMd; mode 2 = COMPLEMENT xor
  'set tab', // per-window WiTab
  // VFS sweep: Amiga path semantics + sequential file channels
  'open in',
  'open out',
  'append',
  'close',
  'print #', // CRLF line ends (sp14); comma writes a TAB
  'input #', // fields split at commas / the Set Input terminator
  'line input #',
  'set input',
  'input$', // file form full; keyboard form best-effort
  'eof',
  'lof',
  'pof',
  'mkdir',
  'kill',
  'rename',
  'assign',
  'dir$',
  'dir',
  'dir first$',
  'dir next$',
  'exist',
  'dfree',
  // correctness-pass cluster (help-manual verified)
  'sort',
  'match',
  'bset',
  'bclr',
  'bchg',
  'btst',
  'rol.b',
  'rol.w',
  'rol.l',
  'ror.b',
  'ror.w',
  'ror.l',
  'clear key',
  'x text',
  'y text',
  'x graphic',
  'y graphic',
  'repeat$',
  'hrev', // flip flags in the image number, mirrored hot spots
  'vrev',
  'get block',
  'put block', // remembers its origin position
  'del block',
  'get cblock',
  'put cblock',
  'del cblock',
  'screen clone', // shares the bitmap and palette
  'scroll on',
  'scroll off', // printing wraps to the window top
  'under on',
  'under off',
  'inverse on',
  'inverse off',
  'pen$', // console escapes, codes from ChPen/ChPap/ChCMv
  'paper$',
  'cmove$',
  // Interface (dialog) language: scanner/evaluator/prepass/interpreter
  // ported from the Dia_* routines in +Lib.s (19889-24850); resource banks
  // per Dia_GetPuzzle 14943, verified byte-level against
  // AMOSPro_Default_Resource.Abk; zone interaction per Dia_Tests 24162
  'dialog open',
  'dialog close',
  'dialog clr',
  'dialog freeze',
  'dialog unfreeze',
  'dialog update',
  'dialog run',
  'dialog',
  'dialog box',
  'edialog',
  'vdialog',
  'vdialog$',
  'rdialog',
  'rdialog$',
  'zdialog',
  'resource bank',
  'resource unpack',
  'resource screen open',
  // BASIC sliders: SliHor/SliVer/SliPour/SliSet +W.s:5051-5320
  'hslider',
  'vslider',
  'set slider',
])

/** Tokens the interpreter handles structurally (dispatch, literals, glue). */
export const STRUCTURAL = new Set([
  ':', ',', ';', '#', '(', ')', '[', ']', 'to', 'not', 'fn', 'then', 'step', 'rem', "'", 'procedure',
  'using', // parsed inside the Print handler
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
  'set bob': 'back modes implemented; planes/mask arguments ignored',
  autoback: 'mode 1 treated like 0',
  rain: 'stored, not rendered',
  rainbow: 'stored, not rendered',
  'set rainbow': 'stored, not rendered',
  'set pattern': 'sprite-image patterns only; bank patterns need the system resource bank',
  'input$': 'keyboard form is non-blocking best effort',
  start: 'fake address space: Start()-relative arithmetic works, absolute hardware addresses do not',
  peek: 'only addresses inside banks resolve; others read 0',
  poke: 'writes outside banks are ignored',
  'erase temp': 'heuristic: erases banks named Work',
  hscroll: 'window-region scroll, approximated',
  vscroll: 'window-region scroll, approximated',
  'shade on': 'dither approximates the original shading',
  'set text': 'bold/italic are synthesized from the single font',
  errn: 'all errors report code 1',
  'err$': 'generic message text',
  'border$': 'returns the text unchanged — border boxes not rendered',
  'menu$': 'two menu levels; deeper sub-menus parsed but flattened',
  'menu on': 'our Workbench-style rendering, not the original look',
  'choice': 'selection state matches; timing is per-frame',
  at: "escape codes 'X'/'Y' assumed, not read from the source",
  match: 'not-found result for closest index 0 returns -1',
  appear: 'copies instantly — the dissolve is not progressive',
  dir: 'plain listing; Set Dir width/filter cosmetic',
  'gr writing': 'JAM1/JAM2 identical for solid draws; XOR implemented',
  'wind move': 'moves the frame; content is not carried along',
  'wind size': 'resizes without preserving content',
  border: 'all styles render as the same simple frame',
  vumeter: 'synthesized level, not real amplitude',
  bell: 'modern synthesis, not chip waveform',
  shoot: 'modern synthesis',
  boom: 'modern synthesis',
  'load iff': 'HAM decodes as indexed (wrong colours)',
  centre: 'no Border$ handling',
  'hot spot': 'code form approximated',
  'mouse zone': 'current-screen coordinate mapping approximated',
  print: 'Print # channels unsupported',
  using: "'^' exponent slots not implemented",
  input: 'line editing keys are host-side, not the AMOS line editor',
  timer: 'writable, drives the frame clock directly',
  rnd: 'deterministic — original mixes in the raster beam position',
  inc: 'also works on float variables (original: integer only)',
  dec: 'also works on float variables (original: integer only)',
  add: 'also works on float variables (original: integer only)',
  // Interface language caveats
  'dialog open': 'SM screen-drag is a no-op; CA (machine code) raises a function call error; edit fields use a simplified line editor; MZ reads of raw memory return ""',
  'fsel$': 'the real bank dialog driven by a TS controller: Store and keyboard qualifiers unhandled, sizes/sort approximated',
  'resource$': 'negative system/editor message numbers return ""',
  'set slider': 'system patterns 1/2 approximated as dithers (the mouse bank is not in the fixtures)',
  hslider: 'system patterns approximated as dithers',
  vslider: 'system patterns approximated as dithers',
  array: 'returns an opaque handle (> 1024), not a real address',
  vdialog: 'integer reads of string-valued slots return 0 (raw pointers are not carried)',
  'dialog box': 'v$ seeds var 1 as a string, not an address',
}
