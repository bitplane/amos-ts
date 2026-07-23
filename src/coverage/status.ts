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
  // the menu engine: tree + compiled label objects + interaction, ported
  // from the Mn* routines (+Lib.s:15355-17744); bank format verified
  // byte-level against the tutorial Data.Menu
  'menu$',
  'menu on',
  'menu off',
  'menu calc',
  'menu base',
  'menu del',
  'menu bar',
  'menu line',
  'menu tline',
  'menu active',
  'menu inactive',
  'menu separate',
  'menu link',
  'menu once',
  'menu called',
  'menu key',
  'menu mouse on',
  'menu mouse off',
  'menu movable',
  'menu static',
  'menu item movable',
  'menu item static',
  'menu to bank',
  'bank to menu',
  'set menu',
  'x menu',
  'y menu',
  'choice',
  'on menu',
  'on menu on',
  'on menu off',
  'on menu del',
  // objects: collision verified against ColRout +W.s:177 (rectangle-reject
  // then pixel-mask AND, mask = OR of planes = colour!=0 — our pixel-perfect
  // matches); bank access/editing against Bnk.* (+Lib.s:8013-8457)
  'bob col',
  'sprite col',
  'col',
  'bobsprite col',
  'spritebob col',
  'get bob',
  'get sprite',
  'get icon',
  'paste bob',
  'paste icon',
  'put bob',
  'put key',
  'del bob',
  'del sprite',
  'del icon',
  'ins bob',
  'ins sprite',
  'ins icon',
  'make mask',
  'no mask',
  'make icon mask',
  'no icon mask',
  // screen keywords verified against +Lib.s/+W.s Ec* routines: select
  // (InScreen 9154), close (9003), display window (EcView 3276), offset
  // hardware scroll (EcOffs 3546), hide/show (9053/9065), to front/back
  // (EcFirst/EcLast 9116/9135), width/height (EcTx/EcTy 8778/8758),
  // resolution constants (FnHires/Lowres/Laced 9174)
  'screen',
  'screen close',
  'screen display',
  'screen offset',
  'screen hide',
  'screen show',
  'screen to front',
  'screen to back',
  'screen width',
  'screen height',
  'hires',
  'lowres',
  'laced',
  // memory/bank sweep verified against +Lib.s (Deek/Doke/Leek/Loke
  // big-endian at any alignment 2764-2819; FillBis tail 2648; TransMem
  // overlap 2535; Length=0 for missing bank 2491; Erase Temp = Data flag)
  'deek',
  'doke',
  'leek',
  'loke',
  'peek$',
  'poke$',
  'fill',
  'copy',
  'length',
  'reserve as data',
  'reserve as work',
  'bank swap',
  'bank shrink',
  'erase temp',
  // drawing primitives verified against +Lib.s/+ILib.s: graphics cursor
  // side effects (Plot/Draw/Bar/Circle/Ellipse/Point/Text), filled
  // Polygon (InitArea 5535), hires Circle aspect (9632), radius errors
  'plot',
  'draw',
  'draw to',
  'gr locate',
  'circle',
  'ellipse',
  'polyline',
  'polygon',
  'point',
  'xgr',
  'ygr',
  'text length',
  'text base',
  'clip',
  // input read routines verified against +Lib.s (X/Y Mouse raw lowres hw
  // coords 12115; Joy bits 13669; Jup/Jdown/Jleft/Jright/Fire; Key State
  // matrix + $7F mask 13649; Mouse Click edge bitmask 12146; Scancode
  // clears on read 13631; Key$ = function-key definition 13757)
  'x mouse',
  'y mouse',
  'mouse key',
  'mouse click',
  'joy',
  'jup',
  'jdown',
  'jleft',
  'jright',
  'fire',
  'key state',
  'scancode',
  'key$',
  'inkey$',
  // display control (InUpdate* 11452, InView 9106, InDualPlayfield 8908)
  'update',
  'update on',
  'update off',
  'update every',
  'view',
  'auto view on',
  'auto view off',
  'default',
  'default palette',
  'screen mode',
  'ntsc',
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
  hscroll: 'window-region scroll, approximated',
  vscroll: 'window-region scroll, approximated',
  'shade on': 'dither approximates the original shading',
  'set text': 'bold/italic are synthesized from the single font',
  errn: 'all errors report code 1',
  'err$': 'generic message text',
  'border$': 'returns the text unchanged — border boxes not rendered',
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
  bar: 'inverted args are normalised rather than raising a function call error',
  box: 'dash phase restarts per edge (68k PolyDraws one continuous pattern)',
  text: 'single Topaz-8 face; Set Text soft styles are synthesized',
  bload: 'the < 1024 bank form creates a missing bank instead of erroring',
  hunt: 'the bare bank-number (Bnk.OrAdr) form is unsupported; Start() works',
  'mouse screen': 'returns -1 when the pointer is over no screen (68k: EntNul)',
  scanshift: 'reads live shift keys; the shift byte is not captured with Inkey$',
  'change mouse': 'pointer number stored; the host cursor is shown instead',
  'limit mouse': 'parsed but the pointer is not clamped',
  'key speed': 'parsed; key-repeat is host-owned',
  'menu called': 'items redraw every frame; (PR name) label procedures are not invoked',
  'menu movable': 'drag applies final positions — no XOR rubber band',
  'menu item movable': 'drag applies final positions — no XOR rubber band',
  'dual playfield': "each playfield uses its own palette, not the hardware's colour split; resolution/plane checks and back-screen auto-hide are not enforced",
  'screen open': 'width masked to /16; colour-count and HAM/EHB mode validation are not enforced',
  'screen display': 'the visible window w/h clips the composite; hardware scaling is not modelled',
  'screen colour': 'returns the plane colour count; HAM does not report 4096',
  'screen base': 'returns 0 — the chunky model has no bitmap address',
  logbase: 'fake unbacked addresses — plane pokes do not render',
  phybase: 'fake unbacked addresses — plane pokes do not render',
  'set font': 'a single Topaz-8 face; the number only selects metrics',
  'font$': 'the ROM list only (no disc fonts in the fixture set)',
  'request on': 'stored — the port never shows system requesters',
  'request off': 'stored — the port never shows system requesters',
  'request wb': 'stored — the port never shows system requesters',
}
