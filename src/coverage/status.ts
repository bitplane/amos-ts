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
  'rnd', // FnRnd: LCG $BB40E62D, mask+retry, Rnd(0)=last, VHPOSR word-add
  // on positive args (pseudo-beam), Rnd(-n) pure — +Lib.s:1976
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
  // rainbows: table build TRSet +W.s:3990 (channel wave machines, seed,
  // (interval,step,count) groups, colour &31 < PalMax); display TRDo
  // +W.s:3940 (elided params keep, RnAct latching at the vbl copper build,
  // y clamped to 28, out-of-range base ignored); rendering CopBow
  // +W.s:6079-6260 (one rainbow at a time, lowest slot wins, per-line
  // register writes, palette/fond restore after the span); Rain TRVar
  // +W.s:3966 (12-bit masked, bounds); errors map through EcWiErr code 1
  // = out of memory, faithfully
  'set rainbow',
  'rainbow',
  'rain',
  'rainbow del',
  // user copper (TCop* +W.s:6815-6935, CpInit 6764): two real 12K list
  // buffers in mapped chip RAM (T_CopLong = interpreter-config item 12);
  // Cop Move/Wait/Movel encode genuine copper words at T_CopPos with the
  // CopEr1-3 errors ("copper not deactivated", reg < 512, x/y < 313, the
  // one-shot $FFE1 line-255 crossing); Cop Swap terminates + swaps +
  // resets; Copper Off empties the logical list and parks the last system
  // list for Cop Logic readers; the system list itself is regenerated
  // each vbl word-for-word (HsCop header, EcCopHo screen blocks, CopBow
  // rainbow lines, EcCopBa, $FFFFFFFE) and the physical list is beam-
  // walked to render when the copper is off — verified by replaying the
  // system list verbatim through Cop Move/Loke pixel-identically, the
  // Multi_Rainbows.AMOS pattern
  'copper on',
  'copper off',
  'cop swap',
  'cop reset',
  'cop wait',
  'cop move',
  'cop movel',
  'cop logic',
  // HAM/EHB (InScreenOpen +Lib.s:8948): 4096 colours = HAM, lowres only,
  // stored as EcNbCol 64 with 6 planes; other counts must be exactly
  // 2..64 powers of two (error 5, "illegal number of colours"); hires
  // caps at 4 planes. The compositor decodes HAM6 modify chains and EHB
  // half-brite per scanline; Screen Colour faithfully reports 64 for HAM.
  'screen open',
  'screen colour',
  // dual playfield (SetDual/DualP +W.s:2810-2900): validation (same
  // resolution/mode, planes <= 3 or 2 in hires, equal or back-one-fewer),
  // BitHide on the back screen, PF2 through the FRONT palette 8-15,
  // Dual Priority = BPLCON2 PFBA for whichever screen is named first
  'dual playfield',
  'dual priority',
  // Hscroll/Vscroll (InHScroll/InVScroll +Lib.s:13544): the keywords just
  // print window control codes 16-19/20-23 — the scrolls themselves are
  // the escape handlers (ScGLine/ScGWi/ScDLine/ScDWi one character with
  // paper fill, ScBas/ScBasHaut/ScHaut/ScHautBas cursor-relative line
  // regions, +W.s:14539-14760), so Print Chr$(17) scrolls too
  'hscroll',
  'vscroll',
  // Limit Mouse (InLimitMouse +Lib.s): no-arg/current-screen, screen-n
  // and x1,y1 To x2,y2 hardware-rect forms, clamped each vbl (LimitMEc)
  'limit mouse',
  // Appear (InAppear +Lib.s:10466): p iterations stepping e mod p through
  // the source pixel index space, copying the shared planes only and
  // preserving the destination's higher planes; gcd patterns faithful
  'appear',
  // STOS compatibility (TokAMAL AniStos +W.s:7483, executors AmAnim/
  // AmMvtX/AmMvtY 8721/8749): Anim (image,delay) pairs with L looping;
  // Move X/Y [start](speed,step,count) groups, count 0 = 65536 steps,
  // L/E with an equality-triggered position, the loop re-applying the
  // start in the same vbl; independent slots beside the AMAL program
  // (channel*4+mode); Movon reports live move slots
  'anim',
  'anim on',
  'anim off',
  'anim freeze',
  'move x',
  'move y',
  'move on',
  'move off',
  'move freeze',
  'movon',
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
  // hardware sprites verified against +W.s HsNxya/HsXY/HsOff/HsPri: raw
  // hardware coords (CXyS 10840), 0..63 range, deferred-update model,
  // and the flip hot-spot / code forms (SpotH 600, BobCalc 1408)
  'sprite',
  'sprite off',
  'sprite update',
  'sprite update on',
  'sprite update off',
  'sprite priority',
  'x sprite',
  'y sprite',
  'i sprite',
  'hot spot',
  // FFP single-precision floats (mathffp.library): 24-bit mantissa via
  // Math.fround, the FFP exponent range (overflow/underflow), and the
  // Set Double Precision toggle to IEEE doubles
  'set double precision',
  // AMOS Compiler directives verified against +CompExt.s: Comp Test/Options are
  // bare `rts` at runtime (Rien 324), and the state functions report the
  // compiler-absent values (Comp Here 410 = 0, Comp Err$ = "", Comp Size 444 =
  // 0). Prg State/Under (+ILib.s:1803/1726) read as single-program-runtime.
  'comp options',
  'comp test',
  'comp test on',
  'comp test off',
  'comp err$',
  'comp here',
  'comp size',
  'prg state',
  'prg under',
  // ST "Squasher II" codec ported from Squash/UnSquash (+CompExt.s:1027-1558):
  // the forward-referencing bit-packed LZ, its guard-bit word stream, the XOR
  // checksum and the trailer layout, exercised by round-trip + corruption tests
  'squash',
  'unsquash',
  // Ppload's PP20 decoder is verified against a byte-exact real artifact (a
  // genuine PowerPacker-crunched AmigaGuide decodes to correct plaintext) and
  // matches two independent reference decoders (MilkyTracker/amigadepack)
  // line-by-line; the AMOS-side "PPbk" parse, bank install and error contract
  // are ported from +CompExt.s:686-767. (Ppsave stays approximated — it writes
  // valid PP20 but not bit-identical to real PowerPacker's crunch choices.)
  'ppload',
  // flow control verified against +ILib.s (loops 2102-2345, branch/on
  // 2364-2833, gosub/return/pop 2417-2479, error trapping 1296-2050):
  // For is a do-while, Pop discards subroutine loop frames, On Error Proc
  // Resume unwinds the handler frame, Errn/Err$ carry the real .Error1
  // numbers/messages
  'do',
  'loop',
  'while',
  'wend',
  'repeat',
  'until',
  'exit',
  'exit if',
  'if',
  'else',
  'else if',
  'pop',
  'proc',
  'on error',
  'resume',
  'resume next',
  'resume label',
  'trap',
  'errtrap',
  'errn',
  'err$',
  'error',
  // program/flow terminators + waits verified against the library source:
  //   End (InEnd +ILib.s:549 → RunErr NbEnd) and Stop (InStop +Lib.s:13042 →
  //     GoError 9) both halt the run — our halt('ended')/halt('stopped').
  //   End If (a runtime no-op: the multi-line If prepass has already branched;
  //     reaching End If just falls through).
  //   End Proc (InEndProc +ILib.s:2659) writes the optional [expr] into the
  //     type-matching Param slot (FnEProc) then restores the caller; Pop Proc
  //     (InPopProc → PopP +ILib.s:2724) force-exits from any depth by resetting
  //     to BasA3 — our returnFromProc truncates loops/gosubs to the proc base.
  //   Wait Vbl (InWtVbl +Lib.s:2133) waits one frame; Wait Key (InWtKy
  //     +Lib.s:2142) loops Inkey until a key arrives — both block until then.
  'end',
  'stop',
  'end if',
  'end proc',
  'pop proc',
  'wait vbl',
  'wait key',
  // text/console + language statements verified against +W.s/+Lib.s/+ILib.s:
  // Cls window-vs-screen (8722), Curs Pen/On/Off (13330-13418), Centre
  // (13289), Scroll (10221), Shade (14837), Param typed slots (FnEProc
  // 2701), Zone\$ escape wrap (14167), and the timing/scope keywords
  'cls',
  'curs pen',
  'curs on',
  'curs off',
  'centre',
  'scroll',
  'shade on',
  'shade off',
  'restore',
  'param',
  'param#',
  'param$',
  'timer',
  'command line$',
  'multi wait',
  'scin',
  'def scroll',
  'set curs',
  'set dir',
  'set zone',
  'reset zone',
  'reserve zone',
  'zone',
  'hzone',
  'zone$',
  'break on',
  'break off',
  'show',
  'hide',
  'show on',
  'hide on',
  'global',
  'shared',
  'display height',
  // straggler cluster verified against +W.s/+Lib.s: palette colour cycling
  // (Shifter 5464 — exact rotation/wrap/delay), Erase family (Bnk.Eff*
  // 7982-8069), Wind Move/Size (13900/13970), Key Shift qualifier byte
  'shift up',
  'shift down',
  'shift off',
  'erase',
  'erase all',
  'wind move',
  'wind size',
  'key shift',
  'mouse screen',
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
  // Logbase(n)/Phybase(n) return the real per-plane pointers (EcLogic[n]/
  // EcPhysic[n], FnLogBase/FnPhyBase +Lib.s:8851/8864) into the screen's
  // bitplane memory, which is now backed in chip RAM: planes are planeSize
  // apart (rowBytes*height, +W.s:1856), single-buffered Logbase==Phybase
  // (EcLogic==EcPhysic at open, +W.s:3001), Double Buffer splits them, and a
  // plane past the depth raises a function-call error. Pokes there round-trip
  // with chunky drawing/Point through a lossless chunky<->planar bijection.
  'logbase',
  'phybase',
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

/**
 * Tokens with no possible web semantics: editor-internal glue, plus keywords
 * that execute raw 68k machine code, call Amiga ROM library vectors, drive the
 * native compiler overlay, or open arbitrary exec devices. None of these can
 * run without *being* an Amiga, so they are n/a rather than "missing" — no
 * program's logic depends on them producing a result here. (Hardware features
 * that are meaningful but unrendered — the copper list, serial/printer/ARexx —
 * stay "missing": they are portable to a host capability, just not built.)
 */
export const NA = new Set<string>([
  // syntax-only phrase: the token table maps `screen size` to
  // L_Syntax/L_Syntax (+Lib.s:513) — it exists solely as the AMAL
  // `Channel ... To Screen Size` target and errors as an instruction
  'screen size',
  // editor-internal
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
  // raw machine-code / ROM-library calls (Lib.Call jsr 0(a0,d3), +Lib.s:2938;
  // InCall jsr (a4), +ILib.s:5881) and their register/offset scaffolding
  'call',
  'execall',
  'gfxcall',
  'doscall',
  'intcall',
  'lib open',
  'lib call',
  'lib close',
  'lib base',
  'areg',
  'dreg',
  'lvo',
  // the native AMOS compiler overlay (LoadSeg APCMP + jsr, +CompExt.s:219,349)
  'compile',
  'cmpcall',
  'comp load',
  'comp del',
  // arbitrary exec device I/O — open any .device and fire IORequests
  'dev open',
  'dev send',
  'dev do',
  'dev close',
  'dev abort',
  'dev base',
  'dev check',
  // AmigaDOS shell-out (Execute() a CLI command, +Lib.s:3392) — no web analog
  'exec',
])

/** Known simplifications worth surfacing next to a keyword. */
export const NOTES: Record<string, string> = {
  amal: 'string programs only — Amal n,# bank programs unsupported',
  anim: 'string programs only — bank program numbers unsupported, like amal',
  'move x': 'string programs only — bank program numbers unsupported, like amal',
  'move y': 'string programs only — bank program numbers unsupported, like amal',
  'set bob': 'back modes implemented; planes/mask arguments ignored',
  autoback: 'mode 1 treated like 0',
  rainbow: 'rendered per scanline by the copper-walk compositor; hardware lines above 50 (the top border) are outside the composite window',
  'copper off':
    'the interpreted list renders COLOR/BPLxPT/BPLCON0-hires/DMACON/DIWSTRT; DDF/modulos/BPLCON1-2/sprite pointers are parsed but ignored, and registers reset each frame rather than persisting (the real machine also hides the mouse pointer)',
  'cop logic': 'a mapped chip-RAM address; the system list is regenerated every vbl (the T_Actualise change-gating is not modelled)',
  'set pattern': 'sprite-image patterns only; bank patterns need the system resource bank',
  'input$': 'keyboard form is non-blocking best effort',
  start: 'fake address space: Start()-relative arithmetic works, absolute hardware addresses do not',
  peek: 'addresses inside banks and screen bitplanes (Logbase/Phybase) resolve; other addresses read 0',
  poke: 'writes into banks and screen bitplanes render; writes elsewhere are ignored',
  'shade on': 'dither approximates the original shading',
  'border$': 'returns the text unchanged — border boxes not rendered',
  at: "escape codes 'X'/'Y' assumed, not read from the source",
  match: 'not-found result for closest index 0 returns -1',
  dir: 'plain listing; Set Dir width/filter cosmetic',
  'gr writing': 'JAM1/JAM2 identical for solid draws; XOR implemented',
  'wind size': 'resizes without preserving content',
  border: 'all styles render as the same simple frame',
  vumeter: 'synthesized level, not real amplitude',
  bell: 'modern synthesis, not chip waveform',
  shoot: 'modern synthesis',
  boom: 'modern synthesis',
  'load iff': 'HAM/EHB decode and render correctly; not byte-verified against the 68k IFF loader',
  centre: 'no Border$ handling',
  'mouse zone': 'current-screen coordinate mapping approximated',
  print: 'Print # channels unsupported',
  input: 'line editing keys are host-side, not the AMOS line editor',
  timer: 'writable, drives the frame clock directly',
  rnd: 'Rnd(n) mixes a statement-paced pseudo-beam instead of the free-running raster, so runs stay reproducible; Rnd(-n) is the pure generator exactly as on the Amiga',
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
  sin: 'FFP-precision (24-bit) result; matches mathtrans to ~24 bits, not necessarily the last bit',
  cos: 'FFP-precision result; last-bit mathtrans algorithm differences possible',
  inc: 'integer-only in the original (mangles a float); the port does float arithmetic instead',
  dec: 'integer-only in the original; the port does float arithmetic instead',
  add: 'integer-only cells in the original; the wrap form is faithful',
  using: "the '^' scientific-exponent slot is left literal (mantissa normalisation unverified)",
  locate: 'out-of-range clamps rather than raising error 16',
  pen: 'stored unmasked; out-of-range does not raise error like the original',
  paper: 'stored unmasked; out-of-range does not raise error like the original',
  load: 'the sprite/icon append flag (2nd arg) is treated as overwrite',
  'set text': 'targets console text too; the original soft-style only affects graphic Text',
  'shift up': 'one shift per screen (the original has a single global shift); omitted wrap-flag defaults to wrap',
  'wind move': 'trail behaviour matches; the Wind Save clean-erase path is not wired to Move',
  'key shift': 'CapsLock reflects the physical key, not the latched toggle',
  every: 'fires at each statement rather than only at control points, and after (not during) a Wait — a timing nuance tied to the blocking model',
  bar: 'inverted args are normalised rather than raising a function call error',
  box: 'dash phase restarts per edge (68k PolyDraws one continuous pattern)',
  text: 'single Topaz-8 face; Set Text soft styles are synthesized',
  bload: 'the < 1024 bank form creates a missing bank instead of erroring',
  hunt: 'the bare bank-number (Bnk.OrAdr) form is unsupported; Start() works',
  'mouse screen': 'returns -1 when the pointer is over no screen (68k: EntNul)',
  scanshift: 'reads live shift keys; the shift byte is not captured with Inkey$',
  'change mouse': 'pointer number stored; the host cursor is shown instead',
  'key speed': 'parsed; key-repeat is host-owned',
  'menu called': 'items redraw every frame; (PR name) label procedures are not invoked',
  'menu movable': 'drag applies final positions — no XOR rubber band',
  'menu item movable': 'drag applies final positions — no XOR rubber band',
  'sprite priority': 'per-pair BPLCON2 PF2P z-order; computed sprites (8+) approximate as the last pair, and the value is global rather than per-screen EcCon2',
  'set sprite buffer': 'validated no-op — the multiplexer buffer has no effect in the chunky renderer',
  'dual playfield': 'the pair renders under the system copper walk; a Copper Off user list shows only the front playfield, and one pair at a time is modelled (per-screen EcDual allows several)',
  'screen open': 'width masked to /16; the 1..1023 size bounds of EcCree are not enforced',
  'screen display': 'the visible window w/h clips the composite; hardware scaling is not modelled',
  'screen colour': 'HAM reports 64 — the real EcNbCol is stored as 64 by InScreenOpen, never 4096',
  'screen base': 'a read-only synthesized Ec control block (EcLogic/EcPhysic, geometry, EcNbCol, live EcPal, EcTLigne...); pokes into it are ignored',
  'set font': 'a single Topaz-8 face; the number only selects metrics',
  'font$': 'the ROM list only (no disc fonts in the fixture set)',
  'request on': 'stored — the port never shows system requesters',
  'request off': 'stored — the port never shows system requesters',
  'request wb': 'stored — the port never shows system requesters',
  'prg state': 'single-program runtime — returns the plain running state',
  'prg under': 'single-program runtime — no AMOS program runs beneath this one',
  'comp here': 'no native compiler overlay can load in the web port — always 0',
  squash: "decodes/encodes the exact Squasher format; the encoder uses a greedy longest-match rather than ST Squasher's pre-scan heuristic, so packed size may differ",
  ppload: 'PP20 decoder verified against genuine PowerPacker output (a real crunched AmigaGuide decodes byte-for-byte) and against two independent reference decoders; the real crunch algorithm is a ROM library, not in the AMOS source, so this is a from-format reimplementation of a verified-correct decoder rather than a source port. Bob/icon object banks unsupported.',
  ppsave: 'Writes a valid PP20 file — proven decodable by an independent reference decoder — but NOT bit-identical to real PowerPacker output: powerpacker.library makes different (better) crunch choices, and its encoder is not in the AMOS source, so byte-exact parity is unverifiable. The efficiency argument is validated but the offset table is fixed; bob/icon banks unsupported.',
  // Host-capability gaps — the source is understood (cites below) but the
  // Amiga facility it drives has no equivalent in the port.
  edit: 'InEdit +ILib.s:1858 returns to the AMOS editor (run-error 1000); there is no editor in the port, so the program halts',
  direct: 'InDirect +ILib.s:1866 returns to direct mode (run-error 1001); no direct window exists in the port, so the program halts',
  wait: 'InWait +Lib.s:2075 waits the given VBLs (faithful for the positive case); a negative count should raise a function-call error and Wait 0 should wait for any event — both are currently no-ops',
  free: 'FnFree queries exec AvailMem; the port has no Amiga memory manager, so it returns a nominal free figure',
  'chip free': 'FnChipFree +Lib.s:2510 queries exec AvailMem(MEMF_CHIP); no Amiga memory manager in the port — returns a nominal figure',
  'fast free': 'FnFastFree +Lib.s:2517 queries exec AvailMem(MEMF_FAST); no Amiga memory manager in the port — returns a nominal figure',
  lprint: 'InLPrint +ILib.s:5067 routes Print to the printer device; no printer host, so the arguments are evaluated (for side effects) then discarded',
  'dual priority': 'the EcE27 error message text is a guess — the string is not in the source tree',
  'hrev block': "RevBloc +W.s:12620 mirrors the block; the visible result matches, but the port reverses pixels directly rather than via AMOS's stored orientation flag (bits $C000)",
  'vrev block': "RevBloc +W.s:12620 mirrors the block vertically; visible result matches, but via direct pixel reversal rather than AMOS's orientation-flag mechanism",
}
