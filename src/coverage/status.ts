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
  // Pack/Spack are ported from the Compact extension's own source
  // (+Compact.s:343/478) and re-pack every corpus picture byte for byte.
  // Syntax comes from the extension's token table (+Compact.s:74) rather
  // than the manual: "I0t0" and "I0t0,0,0,0,0", so `Pack screen To bank`
  // with ONE To and the rectangle comma-separated after it. The manual's
  // ",x1,y1 TO x2,y2" and the comment above InSPack6 both disagree with
  // the table and with the corpus (`Pack 1 To 7,104,13,250,60`).
  'pack',
  'spack',
  // AMAL: compiler+VM ported from TokAMAL/Animeur, including the bank
  // program table (InAmal2 +Lib.s:11857) and PLay's recorded movements
  // (AmPli +W.s:8661), both verified against Tutorial PLay_Data.Abk
  'amal',
  'amplay',
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
  // sample commands: audited against +Music.s — GetSam errors (3207),
  // GoSam/SPl0 period quantization min 124 (3316), SL0 live loop
  // re-point (3073), InSamStop DMA/IntEna clear (4103), InSamRaw
  // freq/length validation (3157), Vol unsigned range check + MVol on
  // the 1-arg form (2739), FnVuMeter read-and-clear (3893), InLedOn/Of
  // filter bit (3917); audio.test.ts cites each
  'sam bank',
  'sam play',
  'sam stop',
  'sam loop on',
  'sam loop off',
  'sam raw',
  'volume',
  'vumeter',
  'led on',
  'led off',
  // the music bank player: MusInt/MuStep/MuEvery/DoEffects ported from
  // +Music.s:1091-1665 (pattern streams, the MuJumps command set, tempo
  // counter, arpeggio/portamento/vibrato/slides, note-on vumeter bytes,
  // music stack, voice steal/reclaim); music.test.ts cites each routine
  // and replays the shipped Music.abk
  'music',
  'music off',
  'music stop',
  'tempo',
  'mvolume',
  'voice',
  'mubase',
  // the MOD tracker: Tracker/mt_* replay ported from +Music.s:1673-2103
  // (row fetch, effect subset 0-6/A-F, song advance/loop, TrackCheck,
  // one-f "track loop of" token spelling per the original table);
  // music.test.ts replays a synthetic module and the shipped Mod.Tracker
  'track load',
  'track play',
  'track stop',
  'track loop on',
  'track loop of',
  // the wavetable synth: VPlay/MuIntE/EnvOff/NeWave ported from
  // +Music.s:2676-3563 — square/noise defaults, mip chains, per-octave
  // TFreq/TNotes pitch, (duration,volume) envelope segments with the
  // end-stops-voice/music-reclaim semantics, Bell=square+EnvBell at
  // note 70, Shoot/Boom=detuned noise via Shout; music.test.ts and
  // audio.test.ts cite the routines
  'play',
  'play off',
  'set wave',
  'del wave',
  'set envel',
  'wave',
  'noise to',
  'sample',
  'bell',
  'shoot',
  'boom',
  // MED: the AMOS-side plumbing (+Music.s:4456-4745) — bank handling,
  // magic check + erase on failure (error 189), stop/cont/midi flag,
  // MedCheck — is ported; the replay reimplements the public MMD0/MMD1
  // format (medplayer.library is not in the AMOS source) — see NOTES
  'med load',
  'med stop',
  'med cont',
  'med midi on',
  // Sam Swap double-buffering (InSamSwap 4080 + the Sami .swap handler
  // 1085), =Sam Swapped states (FnSamSwapped 4055), Sload/Ssave raw
  // channel I/O (3239/4426); music.test.ts cites each
  'sam swap',
  'sam swapped',
  'sload',
  'ssave',
  // faithfulness pass: Inc/Dec/Add operate on the variable long with
  // 32-bit wrap (InInc/InDec/InAdd +ILib.s:4382-4423, base-To-top wrap
  // both directions); Wait errors on negatives and Wait 0 is the
  // endless Wait_Event loop (+Lib.s:2073/2115); Hunt takes Bnk.OrAdr
  // starts and allows matches overhanging the end (+Lib.s:2672);
  // cluster.test.ts cites each
  'add',
  'inc',
  'dec',
  'wait',
  'hunt',
  // memory & banks: Bload/Bsave via Bnk.OrAdr with the range checks
  // (+Lib.s:4307/4336), List Bank in the exact Bnk.List line format
  // incl. image counts for object banks (8616), Load's AmBs erase-all
  // and the sprite/icon append-vs-overwrite rule (Bnk.Load), Reserve
  // number/length validation + the chip flag (RsBqX); cluster.test.ts
  'bload',
  'bsave',
  'list bank',
  'load',
  'reserve as chip data',
  'reserve as chip work',
  // text & fonts: At escapes + 207 limit (FnAt +Lib.s:14046), Locate/
  // Pen/Paper window errors (Loca/Pen +W.s:15364/14893 -> error 60),
  // Border$'s Encadre escapes and box drawing (FnBorderD 14153 /
  // Encadre +W.s:15169, glyph bitmaps approximated — see NOTES),
  // Set Text as the rastport SoftStyle distinct from the console's
  // Under flag (InSetText 9908), Font$'s exact 38-char format and
  // fonts-not-examined error (FnFont 9786), Set Font 0 no-op + font
  // not available (TSFont +W.s:4922); cluster.test.ts cites each
  'at',
  'locate',
  'pen',
  'paper',
  'set text',
  'text',
  'border$',
  'font$',
  'set font',
  'get fonts',
  'get rom fonts',
  'text styles',
  // graphics odds: Bar's strict x2>x1/y2>y1 error (InBar +Lib.s:9975),
  // Box as one continuous-dash PolyDraw from below the start corner
  // (InBox 9702), Scanshift captured with Inkey$ and read-cleared
  // (FnScanshift 13640), Hrev/Vrev Block via RevBloc (+W.s:12620),
  // Mouse Zone through the SyZoHd hard->screen mapping with the
  // outside-screen 0 (+W.s:11150), Set Sprite Buffer's >=16 check
  // (InSetSpriteBuffer +Lib.s:12290); cluster.test.ts cites each
  'bar',
  'box',
  'scanshift',
  'hrev block',
  'vrev block',
  'mouse zone',
  'set sprite buffer',
  // integration: Varptr maps variables into the fake address space
  // (FnVarPtr +ILib.s:4087 — number cells at the address, string chars
  // with the length word at -2, floats in Motorola FFP); =Array maps
  // int/float array blocks (FnArray 4103); cluster.test.ts round-trips
  // Peek/Poke/Leek/Loke through both
  'varptr',
  'array',
  // Sprite Base / Icon Base: the synthesized bank layout (count,
  // 8-byte pointer entries, palette, TX/TY/planes/hot-spot records
  // with planar data — Bnk.Load LB_Sprites), |n|&$3FFF with 0 error,
  // the shared AdBErr "Icon not defined" quirk, mask pointers 0
  // (Sb/AdBob +Lib.s:12792); cluster.test.ts walks a real record
  'sprite base',
  'icon base',
  // Run/System and the environment cluster: Run's chain semantics
  // (InRun0/1 +ILib.s:1465 — bare Run errors in a program, screens
  // survive, banks replaced), System = run-error 1002 (1849), Set
  // Buffer is rts in the interpreter (1828), AMOS_WB no-ops on a
  // single display (+Lib.s:11361), Prg/Dev First$/Next$ share FillDev
  // (+Lib.s:5539); cluster.test.ts cites each
  'run',
  'prun',
  // Start_FSel ported in full (+Lib.s:17756-19292); psel$ is a stub in the
  // original too, so matching it is the faithful behaviour
  'fsel$',
  'psel$',
  'system',
  // Exec: InExec +Lib.s:3392, Execute(cmd, NIL:, NIL:) on the process seam
  // in src/amiga/process.ts. ChVerBuf truncates the line at 510 (+Lib.s:3683)
  // and DOSFALSE is error 87, "Disc error"
  'exec',
  'set buffer',
  'amos to front',
  'amos to back',
  'amos here',
  'amos lock',
  'amos unlock',
  'close workbench',
  'close editor',
  'dev first$',
  'dev next$',
  'prg first$',
  'prg next$',
  // long-tail: Rev both flip bits (FnRev 12744), Scan$ injection strings
  // (FnScan 13799), Parent path strip (InParent 4878), Dir/W two-column
  // (DirW2 5798), the previous-program bank exchange standalone failure
  // paths (FnBStart 2271/FnBLength 2284/InBGrab 2303/InBSend 2333)
  'rev',
  'scan$',
  'parent',
  'dir/w',
  'ldir',
  'ldir/w',
  'set accessory',
  'read text',
  'hardcol',
  'set hardcol',
  'bstart',
  'blength',
  'bgrab',
  'bsend',
  // Freeze/Unfreeze chain parking (FrzAMAL/UFrzAMAL +W.s:9999 with the
  // discard-on-nonempty quirk), On Break Proc (InOnBreak +ILib.s:1890),
  // Set Tempras validation (+Lib.s:9997), Drive (FnDrive +Lib.s:4951),
  // Set Stack / Set Equate Bank -> InSetBuffer rts (+Lib.s:1683/1689)
  'freeze',
  'unfreeze',
  'on break proc',
  'set tempras',
  'drive',
  'set stack',
  'set equate bank',
  // IFF/bank I/O: Save Iff (ILBM encoder, ByteRun1, round-trips parseIlbm,
  // InSaveIff2 +Lib.s:4630), Save/Save n (bank serializers, AmBs/AmBk),
  // Mask Iff plane mask (InMaskIff 4365), =Picture legacy constant 127
  // (FnPicture 4372), Pload code-hunk loader into a bank (InPLoad 4254)
  'save iff',
  'save',
  'mask iff',
  'picture',
  'pload',
  // random-access records: Open Random (RanApp $80 +Lib.s:5249), Field
  // record layout with the file-size snapshot (InField +ILib.s:4769),
  // Get/Put via GetPut's record/type checks with the exact EOF rules
  // and Put's space padding + size growth (+Lib.s:5291/5324/5382);
  // cluster.test.ts round-trips records through the VFS
  'open random',
  'field',
  'get',
  'put',
  // IFF ANIM frames: IffFormLoad/Size/Play ported (+Lib.s:6861-7500) —
  // FORM ANIM unwrapping + AenD terminator, the exact size formula,
  // BMHD/CMAP/CAMG/ANHD chunk registry, BODY row-interleaved ByteRun1
  // into the screen planes, ANIM5 (op 5 only) vertical-column DLTAs,
  // Iff Anim's double-buffer/swap frame loop with ANHD timing
  // (InIffAnim 4538); cluster.test.ts replays the shipped AMOS.Anim
  'frame load',
  'frame length',
  'frame play',
  'frame skip',
  'frame param',
  'iff anim',
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
  'set bob',
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

  // --- LDos (third-party extension, by Niklas Sjoberg) ---
  // Verified against LdosV25.DOC, the extension's own manual, which documents
  // every keyword with syntax, parameter meanings and error results. Manual
  // evidence, so these can be faithful; see src/runtime/ldos.ts.
  'lopen',
  'lclose',
  'lload',
  'lsave',
  'lseek',
  'lsize',
  'lfile type',
  'lstr',
  'lbstr',
  'lset eoln',
  'lold',
  'lcreate',
  'lwords',
  'lword',
  'lwild',
  'lreplace',
  'lfilter',
  'lskip',
  'lback hunt',
  'lget comment',
  'lset comment',
  'lget prot',
  'lset prot',
  'ldate',
  'lstamp',
  'lset file date',
  'lcat first',
  'lcat next',
  'lcat type',
  'lcat size',
  'lcat prot',
  'lcat comment',
  'lcat stamp',
  'lcat push',
  'lcat pull',
  'lldir$',
  'lupbuffer',
  'llobuffer',
  'lchk data',
  'lchk boot',
  'lset var',
  'lget var',
  // Lrun and Lexecute, routines 50 ($33ca) and 51 ($3630) — dos.library
  // Execute on the process seam. Lrun's script file and command line are
  // built for real; only the Execute needs a host. See src/amiga/process.ts
  'lrun',
  'lexecute',
  'ldelete var',
  // Evidenced by disassembly of the library binary rather than by the manual
  // — see NOTES. The manual documents no algorithm for these at all.
  'lcrypt',
  'ldecrypt',
  'lmatch',
  'lsys stamp',
  'lsys time',
  'lansi',
  'lset freq dir',
  'lget freq file',
  'lget freq dir',
  'lpos freq',
  'lcust freq',
  'lfontsize freq',
  'lpp mem',
  // 2.6's eight, from routines 83-90 of its own binary with the manual
  // entries beside them in Documentation/ldos.text
  'lcompress',
  'ldecompress',
  'lrol',
  'lror',
  'lhicol on',
  'lhicol off',
  'lstrcmp',
  'lprot conv',

  // --- TFT 0.6 (third-party extension, by Turgut Temucin) ---
  // Its doc is a syntax list the author never finished, so these are verified
  // against the 5,480-byte binary read end to end, with the demos' own
  // comments for the semantics; see src/runtime/tft.ts.
  'get high word',
  'get low word',
  'var mask',
  'tft version',
  'qsort',
  'get timer',
  'init timer',
  'start timer',
  'stop timer',
  'start int',
  'stop int',
  'init bpl scroll',
  'get xmouse',
  'get ymouse',
  'set bpl',
  'cpu clear',
  'cpu clear pal',
  'cpu clear ntsc',
  'init cpu clear',
  'tft error$',

  // --- JVP-NoKids 1.01 (third-party extension, by Jens Vang Petersen) ---
  // Source tier: the author shipped 26KB of commented assembler beside the
  // binary, and a 21KB doc that covers every keyword and the message-bank
  // format. See src/runtime/jvp.ts.
  'jvp bin sort',
  'jvp bin sort type',
  'jvp set str len',
  'jvp set str sep',
  'jvp str$',
  'jvp cstr$',
  'jvp set msg bank',
  'jvp msg bank',
  'jvp msg exists',
  'jvp msg$',
  'jvp version',

  // --- Locale 0.26 (third-party extension, by Johan Ostling) ---
  // Manual tier: locale_ext.doc lists every keyword and the whole Format
  // Date$ directive set, with the binary settling the rest. The extension is
  // a shim over locale.library v38, so the port implements the slice of that
  // library it calls; see src/runtime/locale.ts.
  'open catalog',
  'close catalog',
  'catalog string$',
  'catalog active',
  'emit catalog description',
  'emit close',
  'locale string$',
  'locale active',
  'locale compare',
  'locale lower$',
  'locale upper$',
  'lowerchar',
  'upperchar',
  'format date$',
  'date$',
  'time$',
  'datetime$',
  'short date$',
  'short time$',
  'short datetime$',

  // --- TURBO Plus (third-party extension, by Manuel Andre) ---
  // Verified against TURBO_DocsV2.15.Asc, the extension's own manual, and
  // where it is thin against the disassembled routine; see src/runtime/turbo.ts.
  'left click',
  'right click',
  'raw key',
  'is raw key',
  'check',
  'reserve check',
  'check erase',
  'reset check',
  'set check',
  'hit bob check',
  'hit spr check',
  'workbench open',
  // vector objects: routines 315 and 326-333 read out of the 2.15 binary,
  // documented in 1.9's Turbo_Object_doc.asc. The error messages are the
  // library's own table at $6e44.
  'object limit',
  'reserve object',
  'reserve object chip',
  'reserve object fast',
  'define draw',
  'define move',
  'define stop',
  'define attr',
  'object draw',
  'r object draw',
  'object mag draw',
  'r object mag draw',
  'object erase',
  'object save',
  'object load',
  'object load chip',
  // starfields: routines 318-323 and 52-59, documented in 1.9's
  // Turbo_Stars_doc.asc
  'reserve stars',
  'define star',
  'display stars',
  'stars draw',
  'f stars',
  'stars compute',
  'stars speed',
  'stars clip',
  'stars erase',
  'stars int on',
  'stars int off',
  // scrolling zones: routines 313, 317, 324, 325, 43-48 and 141-146,
  // documented in the 2.15 manual. Set Planes comes with them because the
  // blit keywords read the mask it writes.
  'blit store left',
  'blit store up',
  'blit left',
  'blit up',
  'multi blit',
  'blit speed',
  'blit erase',
  'blit clear',
  'blit int on',
  'blit int off',
  'blit int change',
  'blit int wait',
  'set planes',
  // the relative and fast drawing keywords, and 3D: routines 23-27, 41, 42,
  // 49, 51, 61, 65 and 70
  'r move',
  'r home',
  'r draw',
  'r box',
  'r bar',
  'f draw',
  'f plot',
  'f point',
  'f circle',
  'f sqr',
  'line 3d',
  'eye 3d',
  // bitplanes and blocks: routines 77-81 and 92-96
  'plane offset',
  'plane swap',
  'plane shift up',
  'plane shift down',
  'plane update',
  'f put block',
  'reserve static block',
  'static block erase',
  'build static block',
  'f put static block',
  // the machine-level tail: routines 4-12, 19, 20, 90, 91, 134, 135, 137,
  // 140, 143, 144, 149, 150, 153, 159, 167-169, 180, 181
  'lsl.b',
  'lsl.w',
  'lsl.l',
  'lsr.b',
  'lsr.w',
  'lsr.l',
  'l swap',
  'test.b',
  'test.w',
  'bit field ext',
  'bit field ins',
  'byte hunt',
  'word hunt',
  'string hunt',
  'memory fill',
  'move mem',
  'range',
  'texp',
  't clip',
  'between',
  'bank end',
  'chip largest',
  'fast largest',
  'parse$',
  'hit spr zone',
  'hit bob zone',
  'cpu info',
  'math info',
  // icons: routines 82-89 and 147
  'f paste icon',
  'f 16 icon',
  'f 32 icon',
  'f 16proc icon',
  'f 32proc icon',
  'x icon',
  'y icon',
  'planes icon',
  'icon check',
  // scenes: routines 97-124, 139, 148, 151-161 and the shared cores 121/122
  'reserve scene',
  'scene bank',
  'scene icon bank',
  'scene load',
  'scene convert',
  'scene x',
  'scene y',
  'scene check',
  'scene change',
  'scene 16 check',
  'scene 32 check',
  'scene 16 change',
  'scene 32 change',
  'scene 16 draw',
  'scene 32 draw',
  'scene 16 view',
  'scene 32 view',
  'scene 16 do',
  'scene 32 do',
  'scene 16 top',
  'scene 32 top',
  'scene 16 bottom',
  'scene 32 bottom',
  'scene 16 left',
  'scene 32 left',
  'scene 16 right',
  'scene 32 right',
  'scene 16 limit',
  'scene 16 def',
  'scene 16 restore',
  'scene fill',
  'scene copy',
  'scene replace',
  'scene palette',
  'scene mask palette',
  'scene scan x',
  'scene scan y',
  // the background loader: routines 172-174
  'multi bload',
  'multi bl error',
  'multi bl ended',
  // AMOS 3D, phase 2: getting objects off disc. Verified against the engine
  // binary c3d.lib via src/cli/tddis.ts; see src/runtime/td.ts.
  'td dir',
  'td load',
  'td clear all',
  'td keep on',
  'td keep off',
  'td screen height',
  'td quit',
  // phase 3: instances and the transform state
  'td object',
  'td kill',
  'td move',
  'td move rel',
  'td angle',
  'td angle rel',
  'td position x',
  'td position y',
  'td position z',
  'td attitude a',
  'td attitude b',
  'td attitude c',
  'td cls',
  'td range',
  'td move x',
  'td move y',
  'td move z',
  'td angle a',
  'td angle b',
  'td angle c',
  'td set colour',
  // Td Priority's draw order, from the bubble sort at $218cc4: zero-priority
  // pairs sort on the depth key at +$1c ascending, any pair with a priority
  // between them sorts on priority descending. Corroborated by the manual
  // update on the Object Modeller coverdisk (Voodoo/Europress, 31/10/1992),
  // which documents the keyword the printed manual leaves out.
  'td priority',
  'td redraw',
  'td bearing a',
  'td bearing b',
  'td bearing r',
  'td face',
  'td world x',
  'td world y',
  'td world z',
  'td view x',
  'td view y',
  'td view z',
  'td screen x',
  'td screen y',
  'td set zone',
  'td delete zone',
  'td zone x',
  'td zone y',
  'td zone z',
  'td zone r',
  'td collide',
  'td forward',
  'td debug',
  'td pragma',
  'td pragma status',
  'td anim',
  'td anim rel',
  'td anim point x',
  'td anim point y',
  'td anim point z',
  'td surface',
  'td background',
  // NB: 'lcat blocks', 'ldev first' and 'ldev next' are implemented but
  // approximated — see NOTES.
  'assign',
  'dir$',
  'dir',
  'dir first$',
  'dir next$',
  'exist',
  'dfree',
  'disc info$',
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
  // both forms: InCommandLine (+Lib.s:7867) stashes the string under a "CmdL"
  // cookie below TBuffer and errors at 256 characters, FnCommandLine (7886)
  // reads it back or "" without the cookie. Living outside the variable table
  // is what carries it across a Run, which the port reproduces by hanging it
  // off the Runtime rather than the program.
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
  'change mouse',
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
  // clears on read 13631; Key$ = function-key definition 13757).
  // X/Y Mouse also have assignment forms (InXMouse 12108 / InYMouse 12122):
  // MSetAb (+W.s:10950) doubles the value into the fine counter, clamps it
  // there against the Limit Mouse rectangle with UNSIGNED compares and halves
  // it back, so a negative lands on the far limit. With no Limit Mouse in
  // force the port clamps to 458x312 — the cap MLimA (+W.s:11006) puts on any
  // rectangle, so no wider one can exist — rather than to a boot default,
  // which the source only ever sets from the editor.
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

  // --- Music extension: speech (+Music.s) ---
  // The AMOS side ported against the extension's own source; the synthesis is
  // narrator-ts, which reimplements narrator.device and translator.library.
  'say',
  'set talk',
  'talk misc',
  'talk stop',
  'mouth read',
  'mouth width',
  'mouth height',

  // --- IOPorts extension (+IO_Ports.s, slot 6) ---
  // Source tier: extensions/+IO_Ports.s ships in the official release. The
  // shared device layer these drive (Dev.Open/GetIO/DoIO/SendIO/CheckIO) is
  // in the main library at +Lib.s:3068-3260 and is modelled with them, since
  // it is what decides that a closed port raises error 141 rather than
  // reporting "not ready". No hardware is attached, which is a state a real
  // Amiga has too -- the devices open and the status reads bare.
  'serial open',
  'serial close',
  'serial send',
  'serial out',
  'serial speed',
  'serial bits',
  'serial parity',
  'serial x',
  'serial buf',
  'serial fast',
  'serial slow',
  'serial abort',
  'serial check',
  'serial get',
  'serial input$',
  'printer open',
  'printer close',
  'printer send',
  'printer out',
  'printer abort',
  'printer check',
  'printer dump',
  'parallel open',
  'parallel close',
  'parallel send',
  'parallel out',
  'parallel abort',
  'parallel check',
  'parallel status',

  // --- Personnal (third-party extension, by Frederic Cordier / FireWorks) ---
  // Ported against the 1.1a source (+AMOSPro_Personnal.Lib.s) where it has
  // one, and against the disassembled 1.1 binary where it does not -- the
  // published source compiles to the SMALLER build, so blitter clear, word
  // switch, mplot start plane, full view, set deform value, the cruncher and
  // the replayers exist only in the binary. Every routine cited in the tests.
  // NOTES below record the two dozen places the library's own behaviour is
  // surprising and has been kept, and the handful this port cannot reach.
  'set ntsc', 'set pal', 'fire(1,2)', 'fire(1,3)',
  'ham', 'ehb', 'create aga', 'test',
  'set color', 'x fade', 'copper base', 'set plane',
  'plane base', 'copper next line', 'copper line', 'set view planes',
  'new color value', 'set screen sizes', 'screen x size', 'screen y size',
  'create standard', 'screen position', 'set dual mode', 'set resolution',
  'set lace', 'copper wait line', 'mosaic x2', 'mosaic x4',
  'mosaic x8', 'mosaic x16', 'mosaic x32', 'active copper',
  'ham mode', 'iff convert', 'allow plane col', 'forbid plane col',
  'inverse playfields', 'normal playfields', 'playfields col', 'pf sprites col',
  'fc cos', 'fc sin', 'fc tan', 'iff x size',
  'iff y size', 'iff planes', 'double mask', 'l double mask',
  'f set sprite buffer', 'get even sprite', 'get odd sprite', 'f sprite',
  'blit mask', 'l blit mask', 'aga off', 'low filter.b',
  'low filter.w', 'low filter.l', 'set dual palette', 'iff color',
  'active second screen', 'set second planes', 'set second view', 'set second color',
  'cmap base', 'change palette', 'iff8bits palette to copper', 'vb line wait',
  'iff4bits palette to copper', 'fade palette', 'attribute palette', 'second y size',
  'iff8bits to iff4bits', 'set aga color', 'octets fill', 'blitter copy',
  's32 block to screen', 's32 vertice to screen', 'set d plane', 'swap planes',
  'aga reserve icon', 'aga erase icon', 'aga get icon', 'aga paste icon',
  'aga icon base', 'aga icon save', 'aga icon load', 'mplot reserve',
  'mplot erase', 'mplot load', 'mplot save', 'mplot define',
  'mplot base', 'mplot draw', 'x mplot', 'y mplot',
  'c mplot', 'mplot modify', 'mplot x define', 'mplot y define',
  'mplot c define', 'mplot origin', 'mplot planes', 'lsr zone',
  'mplot dpf1 draw', 'mplot dpf2 draw', 'blitter clear', 'pic pack',
  'pic unpack', 'anim unpack', 'fpeek', 'speek',
  'word switch', 'mplot start plane', 'set deform value', 'full view',
  'p61 play', 'p61 stop', 'p61 mvolume', 'p61 mpos',
  'omd load', 'omd play', 'omd stop', 'omd free',

  // --- CText 1.32 (Aaron Fothergill / Shadow Software), read out of
  // CTEXT.Lib: 1,816 bytes, twelve routines, every one disassembled. The
  // three 256-byte tables are corroborated byte-exactly by the 254 .Cfnt
  // font files on the AMOS PD CD, all of them 768 bytes.
  'ctext', 'font size', 'plen', 'font base',
  'font data', 'kern$',

  // --- Sticks 1.01b (Nigel Critten): its own AutoDoc manual plus every
  // routine in the 3,856-byte hunk. Raw custom-chip and CIA reads throughout,
  // so what is faithful is the state, validation and encodings; what is
  // reported is the true state of a machine with no adaptor plugged in.
  'multi joy', 'multi fire', 'stick joy', 'stick up',
  'stick down', 'stick left', 'stick right', 'stick fire',
  'stick scan', 'stick x', 'stick y', 'mouse x',
  'mouse y', 'mouse clip', 'mouse button', 'mouse area',

  // --- Stars 2.33 (Jason G. Doig): Stars.doc plus every routine in the
  // 7,492-byte hunk. stars.lib and starspro.lib are different binaries with
  // an identical token table, so this covers AMOS 1.3 and AMOS Pro alike.
  // Three keywords carry a NOTES entry; the rest are the routine's own
  // arithmetic, including the index-derived parallax speed nothing documents.
  'stars blast', 'stars reset', 'stars vbl', 'stars on',
  'stars off', 'stars wibble', 'stars dir', 'cop palette',
  'cop true palette', 'cop screen', 'cop current',

  // --- AMCAF slice 1 (Chris Hodges): maths and bit operations, read off
  // AMCAF.Guide plus the routines in the 45,532-byte hunk. The three trig
  // functions were APPROXIMATED until both their tables were found: the
  // sine one is a QUARTER table at $a3a8 (1.40) / $ab82 (1.50) and the
  // arctangent a 513-byte one at $a5a8, and both are reproduced exactly.
  'even', 'odd', 'wordswap', 'lsl', 'lsr', 'binexp', 'binlog',
  'qsqr', 'qrnd', 'vin', 'vmod', 'nop', 'nfn', 'cpu', 'fpu',
  'qsin', 'qcos', 'qarc',
  // slice 2: strings. Scanstr$ is APPROXIMATED (no name table in the hunk).
  'chr.w$', 'chr.l$', 'asc.w', 'asc.l', 'lsstr$', 'lzstr$',
  'insstr$', 'cutstr$', 'replacestr$', 'itemstr$',
  // slice 3: date and time
  'current date', 'current time', 'cd day', 'cd month', 'cd year',
  'cd weekday', 'cd date$', 'cd string', 'ct hour', 'ct minute',
  'ct second', 'ct tick', 'ct time$', 'ct string',
  // slice 4: banks
  'bank permanent', 'bank temporary', 'bank to chip', 'bank to fast',
  'bank name', 'bank name$', 'bank stretch', 'bank copy',
  'bank delta encode', 'bank delta decode', 'bank checksum',
  'bank code xor.b', 'bank code add.b', 'bank code mix.b',
  'bank code rol.b', 'bank code ror.b',
  'bank code xor.w', 'bank code add.w', 'bank code mix.w',
  'bank code rol.w', 'bank code ror.w',
  // slice 5: disk and DOS objects. Disk Type and Command Name$ are
  // APPROXIMATED (assigns are not distinguished; no program name is kept).
  'examine dir', 'examine object', 'examine stop', 'examine next$',
  'object type', 'object size', 'object blocks', 'object name$',
  'object date', 'object time', 'object protection', 'object protection$',
  'object comment$', 'protect object', 'set object comment', 'set object date',
  'file copy', 'filename$', 'path$', 'pattern match', 'dos hash',
  'io error', 'io error$', 'disk state', 'tool types$',
  'wload', 'dload', 'wsave', 'dsave',
  // slice 6: colour and palette
  'red val', 'green val', 'blue val', 'glue colour',
  'rgb to rrggbb', 'rrggbb to rgb', 'mix colour', 'best pen',
  'pal get', 'pal set', 'pal get screen', 'pal set screen', 'pal spread',
  'ham colour', 'ham best', 'ham point', 'ham fade out',
  'convert grey', 'rain fade', 'set rain colour',
  // slice 7: graphics. The Scrn structure pointers are APPROXIMATED.
  'blitter fill', 'blitter wait', 'blitter busy',
  'turbo plot', 'turbo point', 'turbo draw',
  'fcircle', 'fellipse', 'bcircle', 'vclip', 'aga detect',
  'x raster', 'y raster',
  // slice 7b. Raster Wait carries a DEVIATION; Mask Copy a NOTE.
  'count pixels', 'font style', 'cop pos', 'mask copy', 'bzoom',
  'c2p convert', 'raster wait', 'set sprite priority',
  'amcaf aga notation on', 'amcaf aga notation off',
  // slice 8: the effect engines
  'shade bob planes', 'shade bob mask', 'shade bob up', 'shade bob down',
  'shade pix', 'pix shift up', 'pix shift down', 'pix brighten', 'pix darken',
  'make pix mask', 'ptile bank', 'paste ptile', 'exchange bob', 'exchange icon',
  // slice 9: the particle engines
  'coords bank', 'coords read', 'splinters bank', 'splinters colour',
  'splinters gravity', 'splinters fuel', 'splinters max', 'splinters limit',
  'splinters init', 'splinters move', 'splinters draw', 'splinters back',
  'splinters active', 'splinters single do', 'splinters double do',
  'splinters single del', 'splinters double del',
  'td stars bank', 'td stars planes', 'td stars limit', 'td stars origin',
  'td stars gravity', 'td stars accelerate on', 'td stars accelerate off',
  'td stars init', 'td stars move', 'td stars draw',
  'td stars single do', 'td stars double do',
  'td stars single del', 'td stars double del',
  // slice 10: vectors and internals. Vec Rot X/Y/Z and Amcaf Version$ are
  // APPROXIMATED, and so is Extbase -- it answers the right PREDICATE (an
  // empty slot reads 0) off a synthetic address. The other three
  // extension-table keywords are faithful; none of the four is n/a.
  'extdefault', 'extremove', 'extreinit',
  // Extpath$ was APPROXIMATED on a misreading of its name; routine 98 is a
  // string function and is now reproduced exactly
  'extpath$',
  // slice 14: the Imploder pair, on ../amiga/imploder.ts
  'imploder load', 'imploder unpack',
  // Rnc Unpack is routine 276, six bytes that pop both arguments and return.
  // The port pops both arguments and returns. A stub reproduced as the stub
  // it is, is faithful; =Rnp is not, and keeps its NOTE.
  'rnc unpack',
  // Scanstr$ was APPROXIMATED on the belief that AMCAF shipped no name table.
  // It ships one, at $63f8, and routine 278 is now reproduced from it.
  'scanstr$',
  'vec rot angles', 'vec rot pos', 'vec rot precalc',
  'speek', 'sdeek', 'amos cli', 'audio lock', 'audio free',
  'flush libs', 'open workbench',
  // slice 11: input. All of the parallel-port ones answer "no adaptor".
  'pjoy', 'pjup', 'pjdown', 'pjleft', 'pjright', 'pfire', 'xfire',
  'x smouse', 'y smouse', 'smouse key', 'smouse speed', 'limit smouse',
  // slice 12: ProTracker. Pt Data Base is APPROXIMATED (answers 0), and so
  // are the four LIVE-STATE queries -- Pt Cpos, Pt Cpattern, Pt Cnote and
  // Pt Cinstr. This port starts a module but does not step its patterns, so
  // there is no current row to report; their range checks and error
  // behaviour are reproduced, the values are not.
  'pt play', 'pt stop', 'pt continue', 'pt bank', 'pt sam bank',
  'pt volume', 'pt voice', 'pt cia speed', 'pt sam play', 'pt sam stop',
  'pt sam volume', 'pt sam freq', 'pt instr play', 'pt raw play',
  'pt vu', 'pt signal',
  'pt instr address', 'pt instr length', 'pt free voice',
  // slice 13: the closeout remainder. Amcaf Base/Length, Amos Task,
  // Extpath$ and the two C2P variants are APPROXIMATED.
  'smouse x', 'smouse y', 'blitter copy limit', 'write cli',
  'ppunpack', 'ppfromdisk', 'c2p shift', 'c2p fire',
  // 1.50's transition engine, routines 146-154. The Guide gives these nine
  // lines of changelog and no manual entry at all, so all of it is read from
  // the library. Trans Screen Dynamic is the one that stays missing: it
  // generates 68000 code for `Call`, which is n/a.
  'alloc trans source', 'set trans source', 'alloc trans map', 'set trans map',
  'alloc code bank', 'trans screen runtime', 'trans screen static',
  // The font group, routines 139-144 and 343-345. Four of them are
  // graphics.library and diskfont.library reached through AMOS's own
  // structures -- OpenDiskFont, SetFont, CloseFont, and `$aa(screen)` /
  // `$8(window)`, which +Equ.s:507 and :686 name EcWindow and WiFont. The
  // fifth, Turbo Text, is AMOS's COut (+W.s:15646) unrolled and gets no
  // mention in the Guide at all -- not a node, not even a changelog line.
  'change font', 'make bank font', 'change bank font', 'change print font',
  'turbo text',
  // Reset Computer, routine 203/215. Both its arms are a cold boot, and it
  // lands on src/amiga/machine.ts -- power state and a pending reset, the
  // layer underneath the interpreter. Four other extensions ship one of these
  // and none of them is ported; their readings are recorded in that file.
  'reset computer',
  // Launch, routine 209/221. LoadSeg then CreateProc, on the process seam in
  // src/amiga/process.ts -- where the core's Exec, LDos's Lrun/Lexecute and
  // Craft's and EasyLife's Execute pair will land when those are ported.
  'launch',
  // Pptodisk, routines 234/235 — the PP20 cruncher, on our own codec in
  // src/amiga/powerpacker.ts rather than powerpacker.library
  'pptodisk',

  // --- AGA 1.0 (Nigel Critten, F1 Licenceware): AGA_Doc plus every routine
  // in the 9,904-byte hunk. A thin veneer over graphics.library, so what is
  // faithful is the state, the validation and the packed-picture format;
  // the drawing is our RastPort primitives standing in for the library's.
  'aga screen open', 'aga screen close', 'aga screen', 'aga front screen',
  'aga ink', 'aga clip', 'aga draw mode', 'aga sprite mode',
  'aga cls', 'aga box', 'aga bar', 'aga text',
  'aga use font', 'aga get block', 'aga put block', 'aga del block',
  'aga screen copy', 'aga load bitplanes', 'aga spack', 'aga unpack',
  'aga get palette', 'aga get bank palette', 'aga colour', 'aga point',

  // --- JD 5.3/5.9 (Joerg Dommermuth), ported line by line from the author's
  // own source: APD599/SOURCES/|jd.s, PowerPacked, 122 KB unpacked, public
  // domain by his statement. Every keyword cites its routine at the handler
  // and jd.test.ts cites them again. The five 5.9 added postdate that source
  // and are read out of the 5.9 binary instead (AMOSPro_JD.Lib, routines
  // 160-164) -- disassembled, not guessed. NOTES record where the answer has
  // to come from the machine this port models rather than from a real one.
  'jd compare',
  'jd time$',
  'jd date$',
  'jd count',
  'jd paste$',
  'jd limit',
  'jd screen planes',
  'jd screen resolution',
  'jd change$',
  'jd firstup$',
  'jd skip$',
  'jd crypt$',
  'jd encrypt$',
  'jd extend$',
  'jd exval$',
  'jd get area',
  'jd reset area',
  'jd draw angle',
  'jd area first',
  'jd area last',
  'jd mwait',
  'jd keywait',
  'jd get number',
  'jd cut$',
  'jd insert$',
  'jd wait amiga',
  'jd get string$',
  'jd wait event',
  'jd spread',
  'jd tscroll',
  'jd ror$',
  'jd rol$',
  'jd dump$',
  'jd checksum',
  'jd bootchecksum',
  'jd odd',
  'jd oct$',
  'jd percent',
  'jd deoct',
  'jd hexdump',
  'jd type',
  'jd actual date$',
  'jd actual time$',
  'jd keypress',
  'jd rol',
  'jd ror',
  'jd roxl',
  'jd roxr',
  'jd lsl',
  'jd lsr',
  'jd asl',
  'jd asr',
  'jd hardware$',
  'jd volume$',
  'jd logical$',
  'jd char x',
  'jd char y',
  'jd leap year',
  'jd day of year',
  'jd day',
  'jd day$',
  'jd dayval',
  'jd monthval',
  'jd yearval',
  'jd copy',
  'jd video on',
  'jd video off',
  'jd largest chip free',
  'jd largest fast free',
  'jd file size',
  'jd file type',
  'jd ppfind mem',
  'jd ppdecrunch',
  'jd exdatazone',
  'jd file protection',
  'jd file comment$',
  'jd set protection',
  'jd set comment',
  'jd draw segment',
  'jd checkprt',
  'jd spline',
  'jd linstr',
  'jd e#',
  'jd imp',
  'jd eqv',
  'jd find',
  'jd textfont',
  'jd print',
  'jd distance',
  'jd pi#',
  'jd arcus',
  'jd timesecs',
  'jd secstime$',
  'jd x pos',
  'jd y pos',
  'jd flush',
  'jd count dirs',
  'jd count files',
  'jd detab',
  'jd get tab',
  'jd moff click',
  'jd moff key',
  'jd double click',
  'jd reduce dim',
  'jd reset dim',
  'jd array swap',
  'jd array$ clear',
  'jd array clear',
  'jd get dim',
  'jd ninstr',
  'jd grid',
  'jd xoffset',
  'jd yoffset',
  'jd pattern',
  'jd dpath',
  'jd cpu',
  'jd chipset',
  'jd fpu',
  // 4.6 only, dropped by 5.3 (+jd-4.6/jd.s:5293)
  'jd stream$',

  // --- JD-K3 1.1, the smallest of the five at slot 19. Its own manual, in
  // the same form as the rest of the JD set; see src/runtime/jdk3.ts.
  // `jd relabel` is NOT here: the plain name belongs to the main JD library,
  // whose version is n/a below, and K3's is registered slot-qualified.
  'jd match',
  'jd match nocase',
  'jd star joker on',
  'jd star joker off',
  'jd toggle click',

  // --- JD Prt 1.3/1.4, from the author's own prt.s (PowerPacked, 14.5 KB
  // unpacked, public domain by its header) for the 63 in 1.3, and from the
  // 1.4 binary for the six it adds. Every sequence is the byte string in the
  // library's data area rather than a reading of printer.device's manual, and
  // the two places 1.3 and 1.4 disagree are answered per bound version.
  'jd prt reset',
  'jd prt init',
  'jd prt italics',
  'jd prt italics off',
  'jd prt under',
  'jd prt under off',
  'jd prt bold',
  'jd prt bold off',
  'jd prt elite',
  'jd prt elite off',
  'jd prt fine',
  'jd prt fine off',
  'jd prt enlarged',
  'jd prt enlarged off',
  'jd prt shadow',
  'jd prt shadow off',
  'jd prt double',
  'jd prt double off',
  'jd prt nlq',
  'jd prt nlq off',
  'jd prt super',
  'jd prt super off',
  'jd prt sub',
  'jd prt sub off',
  'jd prt set us',
  'jd prt set french',
  'jd prt set german',
  'jd prt set uk',
  'jd prt set danishi',
  'jd prt set sweden',
  'jd prt set italian',
  'jd prt set spanish',
  'jd prt set japanese',
  'jd prt set norge',
  'jd prt set danishii',
  'jd prt prop',
  'jd prt prop off',
  'jd prt ljustify',
  'jd prt rjustiy',
  'jd prt fjustify',
  'jd prt center',
  'jd prt lspace eight',
  'jd prt lspace six',
  'jd prt justify off',
  'jd prt pline up',
  'jd prt pline down',
  'jd prt set lmargin',
  'jd prt set rmargin',
  'jd prt set tmargin',
  'jd prt set bmargin',
  'jd prt clr margins',
  'jd prt set htab',
  'jd prt set vtab',
  'jd prt clr htab',
  'jd prt clr htabs',
  'jd prt clr vtab',
  'jd prt clr vtabs',
  'jd prt set def tabs',
  'jd prt shade',
  'jd prt aspect',
  'jd prt image',
  'jd prt threshold',
  'jd prt density',
  'jd prt lf',
  'jd prt reverse lf',
  'jd prt doubleunder',
  'jd prt doubleunder off',
  'jd prt borders off',
  'jd prt ff',

  // --- JD Colour 1.4/2.0, the same author and the same treatment, from
  // APD599/SOURCES/|col.s (34 KB unpacked). The whole library is arithmetic
  // on the three nibbles of a 12-bit colour, which makes it exactly testable;
  // jdcolour.test.ts does. 2.0's own additions have no source and come out of
  // the 2.0 binary. 2.0's CON: window and file requester are n/a.
  'jd spread palette',
  'jd grey colour',
  'jd antique colour',
  'jd false colour',
  'jd mix colours',
  'jd negative colour',
  'jd complement colour',
  'jd red value',
  'jd green value',
  'jd blue value',
  'jd separate black',
  'jd separate yellow',
  'jd separate red',
  'jd separate green',
  'jd separate blue',
  'jd separate magenta',
  'jd separate cyan',
  'jd rgb value',
  'jd pseudo palette',
  'jd swap colours',
  'jd copy colour',
  'jd tone colour',
  'jd lightest colour',
  'jd darkest colour',
  'jd fit',
  'jd cut off$',
  'jd bswap',
  'jd wswap',
  'jd lswap',
  'jd key to asc',
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
 * program's logic depends on them producing a result here.
 *
 * The line is whether a HOST could supply it. Things that are meaningful but
 * unrendered stay "missing", because they are portable to a host capability
 * and merely unbuilt: the copper list, serial, the printer, and — since the
 * process seam went in — running another program, which a browser tab cannot
 * do and Node does every day (`Exec`, `Lrun`, `Lexecute`; see
 * ../amiga/process.ts). ARexx is n/a and not an example of that, whatever an
 * earlier version of this paragraph claimed: it needs a language runtime and a
 * resident rexxmast, which is a subsystem to write rather than a capability to
 * plug in.
 */
export const NA = new Set<string>([
  // TFT: both bit-bang the floppy drive. Mfm Read sets up INTENA at $9a(a5)
  // on the custom chips and drives CIA-B's PRB at $bfd100 for motor, select,
  // side, direction and step; Mfm Track Luecke picks the gap out of the raw
  // track it read. Not even trackdisk.device -- the hardware itself.
  'mfm read',
  'mfm luecke',
  // JD: both write the battery-backed clock chip at $DC0000 directly, nibble
  // by nibble into an MSM6242B that may not even be fitted (+|jd.s:1070,
  // :1146) — not a request to the operating system to change the date. There
  // is no host equivalent, and setting the machine's clock is not something a
  // page should be able to do. Reading it (Jd Date$, Jd Time$) is unaffected.
  // No handler is registered for either: an n/a keyword with a handler would
  // count as implemented, which coverage.test.ts checks.
  'jd setdate',
  'jd setclock',
  // JD: Multi Off and Multi On are exec's Forbid and Permit (`jsr -132(a6)`
  // and `-138`, +|jd.s:5925, :5933) — the OS multitasking switch, not an AMOS
  // setting. There is one task here and nothing to forbid, so there is no
  // state to change and no way to change it. Jd Moff Click / Moff Key /
  // Double Click, which exist BECAUSE Forbid stops input.device from running,
  // are implemented: they read the same host input the ordinary keywords do.
  'jd multi off',
  'jd multi on',
  // and the drive LED: CIA-A PRA bit 1 (:5970, :5977). No LED.
  'jd dled off',
  'jd dled on',
  // JD: `jmp $fc00d2` — a jump into Kickstart that reboots the machine
  // (+|jd.s:3623). A page cannot reset the computer and should not be able to.
  'jd reset',
  // the BUG macro's ILLEGAL instruction, there to drop a debugger in
  // (+|jd.s:835 with macros.s). No debugger, and deliberately crashing the
  // interpreter is not a service to anyone.
  'jd private',
  // JD's raw floppy access. Read Sector / Write Sector open trackdisk.device
  // and move 512-byte blocks by sector number, bounded 0..1759 — one
  // double-density floppy (+|jd.s:2948, :3002). Install writes a boot block,
  // Format and Shortformat write a whole disk, Relabel renames a volume by
  // rewriting its root block, and Diskchange waits for the drive's change
  // line. AmigaFS is a filesystem, not a block device: there is no track
  // buffer under it and no medium to format. A disk image the census can hold
  // would answer Read Sector, but nothing here can answer the five that WRITE
  // one, and implementing the reader alone would be a half-truth a program
  // could not test for.
  'jd read sector',
  'jd write sector',
  'jd install',
  'jd format',
  'jd shortformat',
  'jd relabel',
  'jd diskchange',
  // Squash rewrites a file in place through trackdisk to defragment it
  // (+|jd.s:5013) — the same missing block device.
  'jd squash',
  // JD Colour: the keywords that need a window, a requester or a device of
  // their own rather than a palette. Open/Close/Print/Input Con drive a CON:
  // console window through DOS; Jd Request is a file requester; File$, Path$
  // and Drive$ split an AmigaDOS path the way its own requester returns one;
  // Jd Guru paints a fake guru meditation alert; Setoutput Amiga/Amos switch
  // the output format between the two conventions; Jd Mouse counts Show/Hide
  // nesting; Jd Rprint right-justifies through the printer path; Screen
  // Border, Wait Raster, Screen Convert and the six Slide keywords animate or
  // rewrite a whole screen through the RastPort; Load/Save Palette read and
  // write a palette file whose format the source does not settle.
  'jd open con',
  'jd close con',
  'jd print con',
  'jd input con',
  'jd request',
  'jd file$',
  'jd path$',
  'jd drive$',
  'jd guru',
  'jd setoutput amiga',
  'jd setoutput amos',
  'jd mouse',
  'jd rprint',
  'jd screen border',
  'jd wait raster',
  'jd screen convert',
  'jd slide x',
  'jd slide y',
  'jd slide left',
  'jd slide right',
  'jd slide up',
  'jd slide down',
  'jd load palette',
  'jd save palette',
  'jd change colours',
  'jd fill colour',
  // graphics.library's RastPort pointer (T_RastPort, +|jd.s:2340). The value
  // is only useful to something that then calls graphics.library, which this
  // port does not have; handing out a number that addresses nothing would be
  // worse than saying so.
  'jd rastport',
  // the same answer for the two 4.6 dropped by 5.3: T_ScreenAdr and
  // T_WindowAdr (+jd-4.6/jd.s:3820, :3826), intuition's Screen and Window
  // structures. Nothing here has either, and a number that addresses nothing
  // is worse than saying so.
  'jd intscreen base',
  'jd intwindow base',
  // TURBO Plus: routine 132 points COP1LC at graphics.library's own copper
  // list and clears a flag in the AMOS workspace, handing the display back
  // to the system so a developer can see the machine underneath. There is
  // no system copper list here to hand it back to, and nothing underneath.
  'debug',
  // syntax-only phrases: the token table points these at L_Syntax, which
  // is not an implementation — it is the routine that says "this token
  // cannot start a statement". They exist so the tokenizer has a symbol
  // for a word that only ever appears inside somebody else's grammar.
  // `screen size` (+Lib.s:513) is the AMAL `Channel ... To Screen Size`
  // target; `as` (+Lib.s:179) joins `Reserve ... As` and `Open ... As`;
  // `follow` and `follow off` (+Lib.s:138/140) have no routine at all and
  // no construct in the shipped grammar that reaches them — they are
  // reserved words with a token id and nothing behind it.
  'screen size',
  'as',
  'follow',
  'follow off',
  // editor-internal
  'ask editor',
  'call editor',
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
  // InCall jsr (a4), +ILib.s:5881) and their register/offset scaffolding.
  // `@_apml_@` (In_apml_ +ILib.s:5842) is the AMOS Professional Machine
  // Language call: it pushes the argument list and does jsr (a6).
  '@_apml_@',
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
  // AMCAF 1.50: Trans Screen Dynamic is a JIT, and the code it writes is only
  // ever reached through `Call`, which is n/a immediately above. Routine 153
  // ($4272) does not paint anything -- it walks the Trans Map exactly as Trans
  // Screen Runtime does, and instead of storing each longword it ASSEMBLES a
  // 68000 subroutine into the Code Bank: `movea.l #dest,a0` (`move.w #$207c`
  // then the address), one `move.l #imm32,d16(a0)` per non-zero longword
  // (`#$217c`, the data, the displacement -- all-zero longs are skipped, which
  // is the whole point of the technique), a closing `rts` (`#$4e75`), and then
  // exec.library CacheClearU at `movea.l $4.w,a6 / jsr -$27c(a6)` so the 68020+
  // instruction cache sees the freshly written code. The single 16-bit
  // displacement off one base register is why it is limited to +/-32K of plane.
  // Its whole output is machine code for a machine this is not, and running it
  // is the boundary `call` already draws. No handler is registered.
  'trans screen dynamic',
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
  // the ARexx host bridge (rexxsyslib.library message ports) — no ARexx
  // system exists outside AmigaOS
  // --- LDos (third-party) ---
  // The same two boundaries the core port already draws, reached through a
  // different extension. Lrexx * is ARexx, which is n/a above for the core
  // Arexx keywords: it needs an ARexx host, a message port and a resident
  // rexxmast, none of which exist outside AmigaOS. Ldevice * is raw
  // exec device I/O — OpenDevice/DoIO against trackdisk.device and the
  // like — which is n/a above as `dev open`. Both are classified here rather
  // than left as "missing" because no amount of work makes them possible;
  // reporting them as unimplemented would overstate what is left to do.
  // Lrun and Lexecute used to sit here too and no longer do: they are
  // dos.library Execute and LoadSeg+CreateProc, which ../amiga/process.ts
  // models and a host CAN supply, so they are missing rather than n/a.
  'lrexx make host',
  'lrexx remove host',
  'lrexx get msg',
  'lrexx execute',
  'lrexx reply',
  'lrexx result1',
  'lrexx result2',
  'lrexx send msg',
  'ldevice open',
  'ldevice close',
  'ldevice',
  'ldevice error',

  'arexx open',
  'arexx close',
  'arexx exist',
  'arexx',
  'arexx$',
  'arexx wait',
  'arexx answer',
  // serial/parallel device channels ("SER:"/"PAR:" file ports)
  'open port',
  'port',
])

/**
 * Known simplifications worth surfacing next to a keyword.
 *
 * One entry per READING, not per keyword. Where a single routine serves
 * several names -- `Scrn Rastport` and its four siblings are literally the
 * same eighteen bytes five times -- the reading is written once and the
 * others point at it through SHARED_NOTES below. Read through `noteFor`,
 * never by indexing this directly, or the siblings look undocumented.
 */
export const NOTES: Record<string, string> = {
  // --- IOPorts: implemented, but reporting a port with nothing on it ---
  'serial error':
    "Returns 0. The real call reads io_Error from the request and maps it through the device's error table (base 145, 16 messages, from the Dev.Open call). With no hardware behind the port there is no transfer to fail, so no error is ever raised and the keyword can only report success. The mapping itself is modelled -- ioError() resolves those exact messages -- it just has nothing to map",
  'serial speed':
    "Faithful, and worth a note only because the token table declares it TWICE — `+IO_Ports.s:117` and `:123` both emit `dc.b \"serial spee\",\"d\"+$80,\"I0,0\",-1` above the same `dc.w L_InSerialSpeed,L_Nul`, so ids $0048 and $0086 are the same keyword pointing at the same routine. That is Europress's own duplication, not a parse artefact, and it is why the library has 39 named table entries for 38 distinct keywords. Either id tokenises and detokenises identically, so nothing depends on which one a program was saved with",
  'serial x':
    "The XON/XOFF characters are stored in IO_CTLCHAR and the enable flag is honoured, but Web Serial has no software flow control at all — it offers 'none' or 'hardware' only. So on a real port the setting is recorded and not applied, and a program relying on XON/XOFF to pace a slow device will not get it. SERB_7WIRE does map, to flowControl 'hardware'",
  'serial parity':
    "The five AMOS settings are all recorded, but Web Serial takes none/even/odd only. Space and mark (SEXTB_MSPON / SEXTB_MARK) degrade to no parity on a real port rather than refusing to open — the alternative is a program that works on the Amiga and dies here over a setting almost nothing uses. On the modelled port all five are kept exactly",
  'serial status':
    "Returns 0. FnSerialStatus (+IO_Ports.s:598) issues SDCMD_QUERY and reads the WORD at IO_STATUS -- the modem control lines (CD, CTS, DSR, RI, DTR, RTS) as serial.device reports them, where Parallel Status reads a single byte. Nothing is connected, so every line reads low. A real port with a real cable would report the handshake state and a program watching for carrier would see it here",
  'serial base':
    'Returns 0. Hands back the address of the IOExtSer request so a program can poke the structure directly. There is no such structure in this port -- the parameters live in a SerialParams object, not in emulated memory -- so there is no address to give. A program that only calls Serial Base to pass it on is unaffected; one that peeks the request is not',
  'printer error': 'Returns 0, for the same reason as Serial Error: nothing is attached, so nothing fails',
  'printer online':
    "Returns 0, meaning not online — and 0 is the DEFAULT in FnPrinterOnline (+IO_Ports.s:780), not its failure path as this note used to say. `moveq #\$0,d3` is loaded first and `moveq #-1,d3` is reached only when BOTH tests pass: PRD_QUERY must have answered exactly one byte (`cmp.l #\$1,IO_ACTUAL(a1) / bne`) and bit 0 of that byte must be CLEAR (`btst #\$0,(a0) / bne`). So the keyword means \"one byte of status came back and it does not say offline\", and 0 is what a machine with nothing plugged in reports. A program that waits for the printer to come online will wait, exactly as it would on such a machine",
  'printer base':
    'Returns 0 -- the PrinterData/IORequest address, which does not exist here. See Serial Base',
  'parallel error': 'Returns 0. See Serial Error; the parallel error table is base 171 with 7 messages',
  'parallel base': 'Returns 0. See Serial Base',
  'printer dump':
    "Rasterises the region and hands it to the host as a page (host.printerPage); where it then goes -- a print dialog, a download -- is the host's decision, as it is the printer driver's on a real machine. The geometry is reported exactly as the source computes it, including destCols/destRows as 16.16 fractions when FRACCOLS/FRACROWS are set, because turning a fraction of the page into inches needs a driver that knows the paper. What is NOT modelled is the printer driver itself: density, dithering, the aspect correction SPECIAL_ASPECT asks for, and the colour reduction a real driver would apply are all left to whatever renders the page",
  'parallel input$':
    'Returns the empty string. Reads up to LEN bytes with an optional timeout; with nothing attached nothing ever arrives, so the read finds no data and the timeout is the only outcome. The two arities are both accepted',
  'multi no':
    "SetTaskPri(FindTask(NULL), 20) in the binary, which is exactly what the manual describes. There is no scheduler here to apply a priority to, so the value is recorded and nothing else happens — and the consequence the manual warns about, that under AMOS 1.3 'the keyboard and mouse are disabled', is deliberately not reproduced: it is the reason Left Click and Raw Key exist, and simulating an input blackout would break programs rather than emulate one",
  'multi yes':
    'The counterpart, SetTaskPri(..., 0). Inert here for the same reason as Multi No',
  'amos pri':
    'Records a task priority clamped to the documented -128..20. Nothing schedules against it',
  'vbl wait':
    "Four instructions in the binary: a busy-wait on the low byte of VHPOSR (\$dff006) until it equals the requested line. That is sub-frame beam racing, and its whole purpose — the manual's example scrolls only the top 100 lines and then waits for line 101, so the work happens in scanlines the display is not using — has no meaning against a compositor that draws once per frame. This waits one frame, like Wait Vbl. Programs still run correctly; what they lose is the smoothness the keyword existed to buy",
  'raw key':
    "Reads the same key state Key State does, which is what the manual says it is for ('Does the same thing as the Key State function but works even if multitasking is disabled'). The real routine gets there differently — it reads CIA-A's keyboard serial register directly, which is how it survives Multi No — but there is no multitasking here to survive",
  'is raw key':
    "Returns the last scancode seen. The manual warns 'it gives different values if the key is pressed or released', the difference being the release bit; this port records the press code, so a program distinguishing the two would differ",
  'check':
    "TURBO's own zone system, which the manual is explicit is 'not compatible with the normal Zone commands'. Note it returns 1 and 0 rather than AMOS's -1 and 0, as documented",
  'workbench open':
    'The counterpart to Close Workbench, which this port already treats as faithful because there is no Workbench memory to free. Reopening it is the same nothing in reverse',
  'f 16proc icon':
    "The five F icon keywords differ in what they refuse to do rather than in what they draw: the width-specialised ones skip the 16-pixel chop of X, and the two processor ones drive the CPU instead of the blitter and lose the mask with it ('Masking is not supported!'). Both of those survive here. What cannot is the point of them — there is no blitter to be faster than, so F 16proc Icon and F 32proc Icon are the same speed as the rest, where on a real machine choosing the wrong one for your CPU was the difference the manual spends a page on",
  'icon check':
    "Reports -1 for a defined icon with no mask, 1 with one, 0 for a missing one, and 0 rather than an error when there is no bank — 'in AMOSPro you don't get an error'. Routine 147 reads the bank number from $3b8, the Scene Icon Bank setting, rather than always asking the icon bank: 'It is also possible to check other Icon banks with it... It can even check BOB/SPRITE banks, as the bank has the same format.' It never checks the lookup succeeded, so a missing bank reads address zero on the Amiga; here it gives the documented 0",
  'scene 16 view':
    "The whole viewport family carries a regression the 2.15 rewrite introduced, and it is reproduced rather than corrected. V1.0's Scene 16 Do multiplied the viewport's y1 by the screen's bytes-per-row itself (mulu.w d4,d2 at $5178) before handing a byte offset to the drawing core. 2.15 moved that arithmetic into Scene 16/32 View for speed, converted x1 to bytes with lsr.w #3 — and left y1 in pixels, so the core adds a line count to a byte offset. Scene Draw and Scene 16 Def, which compute their own destination, both still multiply, which is what makes it a slip rather than a convention. In practice a viewport declared at y1 = 0 draws correctly through Do, Top, Left and Right, and only Bottom is always wrong, because its edge is stored as y2-16 in the same units. That is very likely why it shipped: the demos scroll horizontally",
  'scene bank':
    'Holds the bank number and resolves it at each use, where the library holds the pointer GetBank returned. Erasing the scene bank and then drawing therefore reports "Scene Bank not defined" instead of reading freed memory. Scene Bank also resolves the icon bank, so a missing icon bank is reported here, as the manual says it is',
  'scene icon bank':
    "Bank 1 is the sprite bank and bank 2 the icon bank; any other number can only be a plain memory bank in this port's model, so it fails the routine's 'Icon'/'Spri' cookie test with the extension's own error 26. The manual's suggestion of appending bobs and sprites to a single bank and switching to it works for 1 and 2, which is what programs use",
  'scene 16 change':
    'The manual says "the change made on screen and in the Scene bank"; the routine ends at the bank write and draws nothing. The bank is what happens',
  'scene scan y':
    "Undocumented in either manual. Scene Scan X's negative form scans for the first tile that is not the value; Scene Scan Y has the same branch but closes it with bne rather than beq, so its negative form searches for the positive value and is indistinguishable from the positive form. Its mode test also reads d3 instead of d5 — a register that happens to hold the last argument evaluated, which is the value, so that half of the slip is invisible. Both are reproduced",
  'scene check':
    "The bound is cmp.w/Rbhi, a strictly-greater test, so a coordinate equal to the width or height is accepted and indexes one tile past the row or the map. On the Amiga that reads whatever follows the bank; here it reads zero once it is past the end of the array. Scene 16/32 Check convert screen coordinates with a bare shift and never apply the viewport offset, so they only answer for the screen while the view starts at 0,0",
  'scene 32 draw':
    'Chops XSCREEN with andi.w #$fff0, the same 16-pixel mask the 16 version uses, despite the manual\'s "XSCREEN/YSCREEN are chopped to lie on a 16/32 bit boundary". YSCREEN is not chopped by either',
  'scene convert':
    'The source bank is fetched with no check and read immediately, so on the Amiga a missing bank reads address zero. Here it is "bank not reserved"',
  'scene 16 def':
    'The 78-byte definition record captures the scene and icon banks as pointers, so a definition outlives the Scene Bank setting that made it and Scene 16 Restore keeps drawing from wherever it was pointed. That is kept, by holding the arrays rather than the numbers',
  'td keep on':
    "A cache switch: 'Td Keep Off tells 3D not to keep objects in memory, but to load them each time'. The setting is recorded and Td Load consults it, but with objects held as parsed structures rather than AllocMem'd blocks there is no memory pressure for it to relieve, so turning it off costs nothing here where on the Amiga it traded speed for space",
  'td quit':
    "'Unload the 3D extensions along with all objects and release all 3D memory.' There is no separately loaded engine here to unload — c3d.lib is this module — so it is the object clear and the state reset",
  'td angle':
    'Angles are 65536 units to the revolution, which is what the matrix builder at $213df8 works in — it reduces by quadrant with btst #6/#7 on the high byte and reflects about $8000. The relative forms wrap at 32 bits rather than clamping, as the engine\'s add.l does, and nothing normalises: Dice_Spin drives its angles negative every frame for two thousand frames and relies on exactly that',
  'td position x':
    'The position and attitude readers are one engine routine each plus an axis selector in d2, so Td Position X/Y/Z is $2119ec with 0/1/2 and Td Attitude A/B/C is $211bf8 the same way. Reading an object that does not exist is "Object does not exist" rather than zero',
  'td cls':
    'Clears the top Td Screen Height lines to colour 0, after the three checks $2114be makes on the AMOS screen: exactly 320 wide, at least 4 bitplanes, and at least as tall as Td Screen Height. Anything else is "Amos screen not compatible with 3d", which is why every demo opens Screen Open n,320,200,16,Lowres. What is not reproduced is the clear being a blitter fill of the 3D area only — here it is a plot loop over the same rectangle',
  'td move x':
    'The six string forms — Td Move X/Y/Z and Td Angle A/B/C — are $211822 and $211a14 with the axis in d2. "The movement string follows the same rules as those for sprites", so the parser is shared with Move X rather than written twice: (speed,step,count) groups, an optional leading start position, L to loop and E to stop. The engine\'s shape agrees — $211822 takes the axis as 1<<d7, gets the frame through $21301c so the viewpoint can be animated too, and hands $21303e the list at $1e(frame) for a position or $22(frame) for an attitude; $21303e looks for a node with a matching mask before linking a new one, which is why setting the same axis twice replaces rather than stacks. Two things differ from a sprite: the step happens once per Td Redraw, not once per vertical blank, because that is where the engine does it ($211394 walks both lists per instance and calls $21321a) — so a program that redraws every other frame sees its animations run at half pace; and the accumulator is 32 bits rather than 16, since a 3D coordinate is a long and an angle relies on wrapping at 32',
  'td range':
    'Equal object numbers return zero before either is validated ($211d9c compares first), so Td Range(99,99) is 0 rather than "Invalid object number". Object zero counts, because the frames come through $21301c. The prescale at $21235a is reproduced rather than replaced by an exact distance: it ORs the absolute deltas together and, once that passes $4000, normalises to a shift of p-13 where p is the highest set bit, shifts all three down by it and the root back up at the end. That keeps the sum of squares inside a long and costs precision — two objects 100000 apart are measured in units of 8. The integer square root at $213184 is taken to be the floor',
  'td redraw':
    'The model is the engine\'s and the rasteriser is ours. Everything before a pixel is reproduced and tested: the three screen checks at $211418, the frame stamp at a4+$1902 that never wraps to zero, the walk of the live instance list, the attitude matrix from $213df8, the vertex transform from $2108a2, the view transform and perspective divide from $2101c8, the near and far limits, the .3DS surfaces with their midpoint constructions and pens, and the dither pair each block is drawn in — the two bytes per block at the object\'s +$3a section. The screen mapping is the engine\'s own, the arithmetic Td Screen X and Td Screen Y do: x/16 + 160, and the centre row (h-1)>>1 minus y/16, with row zero outside the bounds. What is not the engine\'s is the fill. It hands the blitter one EOR line per edge in line mode ($210456 picks the octant and shortens the run by one) and then area-fills the mask; there is no blitter here, so the same shape is computed directly by a scanline fill, even-odd, with edges half-open at the bottom. The polygons and their pens are right; the bits are not guaranteed identical, a long shallow edge can land a column either side of where Bresenham would have put it, and the phase of the two-pen dither — which pen falls on the even squares — is a choice, because it is decided inside the fill that is not reproduced. A pen only ever touches the bottom two bitplanes, as $21042a and $210438 do, so a Td Background in the upper planes shows through',
  'td surface points':
    "The four anchors are recorded where the engine records them, at a4+$486f with the flag at a4+$4873, and nothing maps a surface through them: a surface's first four slots are still the face's own four corners, which is what $217424 fills them with. The only use of the anchors traced so far is Td Surface validating them against the block's point count ($212d42), and what actually consumes them has not been found. Td Surface Points Off clears the flag, which is faithful, and setting them changes no output",
  'td visible':
    "$211d64 answers 0 when the byte at $f8 of the instance is set and the one at $cb is clear. $f8 is a culled-this-frame flag: $219038 clears it at the top of each object's pass and $2190c8 sets it when the object fails a distance test, `d6 + a4+$b34 < d7`. That test is a bounding-sphere check made before any face is looked at, and the pass it lives in has not been read, so this answers the same question a different way — whether the last Td Redraw put any of the object on the screen. An object rejected wholly by the near limit agrees with the engine; one the engine culls early for being too far, and this one drops face by face, can disagree at the margin. An object that has never been redrawn reads as visible, which is what the cleared byte gives",
  'td advanced':
    "Hands back an address on the Amiga: a4 itself for object zero, otherwise the instance pointer ($212f0c). There is no address space here for one to mean anything in, so this answers zero — the same reason peek, poke and start are approximated. A program that only tests it against zero will see 'no object'; one that pokes through it could not have worked here whatever the answer",
  'td load':
    'The engine gates its ".3DO" suffix on a flag at a4+$b1a whose setter is not on any path traced so far; every shipped demo loads by bare name, so the suffix is always added here and a name that already carries an extension keeps it. Worth revisiting if a program turns up that loads by full filename',
  'multi bload':
    "The only genuinely concurrent keyword in the extension: it CreateProc()s an AmigaDOS process — up to five at once — which opens the file, reserves a bank the size of it under the eight characters given, reads it and exits, while BASIC carries on. There is no second thread here, so the load happens synchronously and Multi Bl Ended, which reports whether the pending count has reached zero, is always true. Every program that uses these three waits on Multi Bl Ended before touching the bank and cannot tell the difference; what is not reproduced is the overlap itself, so a program animating a loading screen sees the load complete in one frame",
  'cpu info':
    "Reports 20, a 68020. There is no 68000 here to ask, so the answer has to come from the machine this port models — and that is settled elsewhere already: Chip Free and Fast Free answer for 2MB of chip and a fast board, which is an A1200. Math Info answers 0 to match, a stock A1200 having no FPU. A program that branches on the CPU will take its 020 path",
  'parse$':
    "Undocumented, and it does not return a string despite the name: routine 180 leaves an integer in d3 — which alternative of a '|' separated list matched word N of the source, counting from one, or the fourth argument when none did. One departure: an empty source or an empty list jumps to the routine's common tail, which pops a long nothing pushed and returns into it. That is a crash; here it is the not-found value",
  'chip largest':
    "AvailMem(MEMF_CHIP|MEMF_LARGEST). With no fragmenting allocator behind it, the largest contiguous block is the whole of what is free, so this equals Chip Free; the same goes for Fast Largest",
  'plane offset':
    "The offset table is the routine's own — a byte offset of y*rowBytes+x per plane, accumulating unless the new offset works out to zero, and cleared for a whole screen by a negative plane number. Plane Update applies it to the display and not to the buffer, which is faithful to how it works ('In fact I don't change the bitplane addresses at all' — it biases the pointers the copper reads, rebuilds, and puts them back), so Point and every drawing keyword go on seeing the buffer unmoved. What does not follow is the fragility: on the real machine the biased pointers last only until AMOS next rebuilds its copper list, and here they last until the next Plane Update",
  'f put static block':
    "The static list is a lookup optimisation over the same blocks, so this draws what F Put Block draws. The one observable difference is kept: the table is allocated without MEMF_CLEAR, so a block grabbed after Build Static Block ran is an uninitialised pointer — a crash there, and nothing drawn here",
  'f circle':
    "Eight-way symmetry with the column height taken from an integer square root computed in WORDS, which is the whole of the documented bug: 'do not use a radius above 180...there will be no crash, but the result is definitely not a circle!' — r*r-x*x stops fitting in sixteen bits at 182, and this overflows where the routine overflows. Not modelled: the manual's other caveat, that a hires screen turns the circle into an ellipse, because that is a property of the pixel aspect of the display rather than of the pixels written",
  'f sqr':
    "Undocumented, and faithful including its off-by-one: the routine rounds up when the remainder REACHES the root rather than exceeds it, so F Sqr(0) is 1 and every n*n+n comes out a step high. Away from that boundary it is an ordinary integer square root",
  'f draw':
    "The token spec is I0,0t0,0 in 1.0, 1.9 and 2.15 alike, so only the To form exists — the manual's shorter 'F Draw X,Y' cannot be written and would not parse on the real machine either. Ignores the Set Line pattern, as the manual admits ('this will be corrected in a future update'), and the plane mask",
  'blit left':
    "The scroll is modelled as what the blitter does rather than by emulating it: the region's pixels are one stream, rows joined end to end, shifted by the barrel-shift amount. That reproduces the part everyone notices — the pixels shifted off the end of a row reappear at the start of the next, because the shifter carries across the modulo — and leaves out BLTAFWM/BLTALWM, the first and last word masks, which the routine sets to \$ff<<shift and which affect at most sixteen pixels at the very start and end of the whole blit. Off-screen destination rows are skipped where the real one would write into whatever follows the bitmap",
  // --- AGA 1.0: doc plus disassembly; the doc loses three times ---
  // --- AMCAF slices 1-13 ---
  'cd year':
    "Routine 322 (\$7104 in 1.50, 308/\$7398 in 1.40): a subtract-a-year-at-a-time loop from 1978 that leaves the remaining days behind for the month splitter, which is why Cd Month is six bytes of `Rbsr` into it and Cd Day six more into Cd Month. DEFECT: the leap test is `move.b d3,d4 / andi.b #\$3,d4` -- a bare `year AND 3`, with no hundred-or-four-hundred correction -- so AMCAF gives 2100 a 29 February and every date it reports from 1 March 2100 is a day behind the calendar. Reproduced. The year is a WORD and wraps at 65536, and a day count below zero exits before the first iteration and reports 1978 with the negative remainder intact, so Cd Day(-1) is 0",
  'cd month':
    "Routine 323, and then routine 338 (\$811e) -- the splitter no token names. Its month-length table at \$814a was dumped rather than assumed: `63 1c 1f 1e 1f 1e 1f 1f 1e 1f 1e 1f`, where entry 0 is a byte of the preceding `rts` that is never read because the loop increments its index before the first load, having already subtracted January's 31 from a `moveq`. February's extra day is added to the table entry in place, guarded by the same `year AND 3`, so it inherits Cd Year's defect",
  'cd day':
    "Routine 324: `Rbsr` Cd Month then `move.l d0,d3 / addq.b #\$1,d3`. The day is whatever the splitter left over, made 1-based, with nothing bounding it either way",
  'cd weekday':
    "Routine 325 (\$7140): `(days+6) divu 7`, remainder plus one. Day 0 is 1 January 1978, a Sunday, so the +6 rotates the count onto a Monday-first week and the epoch answers 7 rather than 1. DEFECT: `divu.w` is a 32-by-16 divide and the 68000 leaves its operand UNTOUCHED when the quotient will not fit a word. Past day 458745 the routine takes no notice of the overflow, clears the low word, swaps and increments a byte -- so the answer becomes the top half of the day count. Reproduced, and it catches any day below -6 as well, where the value read unsigned is enormous",
  'cd date$':
    "Routine 328 (\$71f8), which writes a length word of 13 before any digit and builds the string from two OVERLAPPING four-byte tables: `lea \$7556(pc,d6.w)` with d6 = month*4 puts month 1 at \$755a and month 0 on \$7556, which is the seventh weekday slot 'Sun '. One run of bytes read two ways, which is why the month entries start with a hyphen and the weekday entries end with a space. It works the weekday out inline rather than calling Cd Weekday, and uses the `divu` remainder directly with no +1",
  'ct tick':
    "Routine 332 (\$72f4). The manual's 'the number of vertical blanks (=1/50 of a second)' does not say whether the count is within the second or the minute, and an earlier pass read it as the whole low word -- which made Ct Tick and Ct Second two resolutions of one field. The routine settles it: `divu.w #\$32,d3` then `move.w d2,d3 / swap d3` keeps the REMAINDER, the same shape as Ct Minute keeping the remainder of its divide by sixty. So the pair partition the field and Ct Tick is 0..49",
  'ct time$':
    "Routine 333 (\$7306), a length word of 8 written before any digit. DEFECT: the two-digit printer it shares with Cd Date$ (\$7638 and \$7514, the same code assembled twice) is not a formatter -- it starts each character at '0' and counts up, byte-wide, with no upper bound, so an hour count of 100 walks the tens character ten past '0' onto ':' rather than widening the string. Its tens test is `cmp.b #\$a,d0` with a SIGNED branch, so a byte of \$80..\$FF skips the tens loop and is counted out one unit at a time instead. Both reproduced",
  'cd string':
    "Routine 327 (\$71a8) really is dos.library: `movea.l \$2b8(a5),a6 / jsr -\$2ee(a6)` is StrToDate, guarded by `cmp.w #\$25,\$14(a0)` against ExecBase's LIB_VERSION -- the manual's 'only works on OS2.0 and higher', not modelled because the machine this port describes is an A1200 and the check can only pass. The DateTime is built with `clr.w \$c(a1)`, so dat_Format 0 (FORMAT_DOS) and dat_Flags 0, which AROS's StrToDate confirms is enough for Today/Tomorrow/Yesterday and a weekday name: DTF_SUBST governs DateToStr, and only DTF_FUTURE would move a weekday forwards. DEVIATION: the library matches those words with `Strnicmp(table[t], ptr, strlen(table[t]))`, a case-insensitive PREFIX test, so 'Todayish' is Today and '12-November-89' matches 'Nov' and then fails on the leftover 'ember'. This port matches the whole word and also accepts the full month names the manual promises, which is the union of the two -- no string a real machine accepted is refused here",
  'ct string':
    "Routine 326 (\$7152), Cd String's twin: the same StrToDate call with dat_StrTime filled in and dat_StrDate cleared, then ds_Minute packed over ds_Tick the way Current Time does. NOTE: both String keywords copy the AMOS string to the START of the extension's own block with no length check, and the DateTime they fill in sits at +\$380 of that same block, so an argument of 896 characters or more overwrites the structure it is about to be parsed into. Not reproduced -- there is no block here to overrun -- but it is why an over-long argument on a real machine misbehaves rather than simply failing",
  'amcaf base':
    "'Gives back the address of the AMCAF data base' and Amcaf Length its size, for the 'Assembler and C freaks' the manual addresses. The init routine allocates \$23b6 bytes, so the LENGTH is real and read off the binary; the ADDRESS is 0, because the state here is objects rather than a block at an address -- the same choice the Scrn pointers made. APPROXIMATED",
  'amos task':
    "Routine 339 (\$7518), twenty bytes and nothing but the call: `suba.l a1,a1 / movea.l \$4.w,a6 / jsr -\$126(a6)` is FindTask(NULL), and its result is the answer. There is one task here and no exec Task structure to point at, so this answers 0 as the other pointer-into-the-machine functions do -- scrnPtr, Amcaf Base and Pt Data Base all take the same line. NOTE: zero is a value FindTask never returns for a running task, so `If Amos Task<>0` takes the other branch here; Extbase answers a synthetic non-zero instead precisely because that comparison is its documented use, and nothing documents one for this",
  'vec rot y':
    "Routine 8 (\$20aa), fourteen bytes: `movea.l \$168(a5),a2 / move.w \$30e(a2),d3 / ext.l d3`. One of three readers that differ only in which word of the extension block they take -- \$30c for X (routine 6), \$30e for Y, \$310 for Z (routine 10) -- with routines 5, 7 and 9 the three-argument forms that fill them. The `ext.l` is why a rotated coordinate comes back signed from a sixteen-bit cache. APPROXIMATED refers to the rotation ORDER, which was not recovered; these three readers are exact",
  'vec rot z':
    "Routine 10 (\$20c6), fourteen bytes: `move.w \$310(a2),d3 / ext.l d3`, the third of the three adjacent cache words. See Vec Rot Y for the group",
  'pt cpattern':
    "Routine 240 (\$5d0e), eighteen bytes: `movea.l \$2cc(a2),a0 / move.b -\$c(a0),d3` -- a BYTE taken twelve back from the replayer's live pointer, and masked by nothing. APPROXIMATED unavoidably: \$2cc(a2) points into a module this port loads but does not step, so there is no live song position to report. The routine is exact and the value is not",
  'pt cpos':
    "Routine 241 (\$5d20), twenty bytes: `movea.l \$2cc(a2),a0 / move.w -\$4(a0),d3 / lsr.w #\$4,d3` -- a WORD four back from the live pointer, shifted down four, so the row is a packed field rather than a plain counter. The `& 63` in the port is the manual's stated range ('a number between 0 and 63'), not the routine's, which masks nothing. APPROXIMATED for the same reason as Pt Cpattern: nothing steps the patterns here",
  'extpath$':
    "Routine 98 (\$35e2), 120 bytes, and it has nothing to do with extensions. It appends a path separator: `move.w (a2)+,d3 / beq` leaves an empty string alone, `cmpi.b #\$2f,-\$1(a2,d3.w)` and `cmpi.b #\$3a,-\$1(a2,d3.w)` leave one already ending '/' or ':', and anything else is copied with `move.b #\$2f,(a0)+` on the end. So Extpath\$(\"Data\") is \"Data/\" and Extpath\$(\"DF0:\") is \"DF0:\". DEFECT: this port read the NAME as 'where an extension was loaded from', answered the empty string for every argument, and never looked at routine 98 -- the token spec is `\"22\"`, string in and string out, which the old reading could not have explained. The same shape as Limit Smouse in #188, and now reproduced exactly",
  'write cli':
    "Writes to the CLI the program was started from. Amos Cli is zero here, so there is no shell to write to and the text goes to the AMOS console -- which is where a program running without one would see it anyway",
  'pt stop':
    "Routine 267 (\$6196). The changelog records the bug that makes the guard worth stating: 'Fixed a bug in Pt Stop which cut off the channels, even if no music had been playing.' The fix is `tst.w \$2ba(a2)` then `tst.w \$2b8(a2)` -- is EITHER interrupt installed -- and a plain `rts` when neither is. But when it does stop it is not selective: selector 3 of routine 381 is four `clr.w` on the AUDxVOLs and `move.w #\$f,\$96(a5)` on DMACON, so all four channels go, including a sound effect on a channel Pt Voice never gave the music. The port stopped only the music's own voices",
  'pt cia speed':
    "Routine 259 (\$6016) and selector 5 of routine 381. 'the number of beats per minute or if you specify a value of zero, the timing will be switched from CIA-Timing to Vertical Blank Timing' -- so zero is a MODE SWITCH rather than a speed of nothing, and the routine is a swap between two interrupt sources, \$296(a2) recording which is wanted. Selector 5 is where the value is sanitised, and it is not the clamp the manual implies: `cmp.w #\$20,d0 / bge / moveq #\$20,d0` puts a FLOOR at 32 bpm and then `andi.w #\$ff,d0` masks to a byte with no ceiling test at all, so 300 bpm becomes 44 and 256 becomes 0 -- which the very next instruction divides by. NOTE: the zero arm never writes 125 anywhere; VBL timing is 50 ticks a second whatever the word holds, which at ProTracker's default six ticks a row IS 125 bpm, so the manual describes the effect rather than a store",
  'pt vu':
    "Routine 260 (\$605e). 'the current volume of channel number channel. If a new note is played, vol contains the volume level else 0' -- a note-on latch rather than a live meter, the same shape as AMOS's own Vumeter, and `move.b \$1a(a0,d7.w),d3 / clr.b` means it clears when read. The channel is range-checked like Pt Cnote's and Pt Cinstr's, `Rbmi routine 390` and `cmp.b #\$4,d7 / Rbge routine 390`, where the port masked with `& 3` and answered for channel 0",
  'pt sam play':
    "Routines 250 (\$5eb6), 251 and 252 -- the one-, two- and three-argument forms of `Pt Sam Play voice,samnr,freq`. The OPTIONAL argument is the LEADING one: routine 250 supplies `moveq #\$f,d2` itself, so a bare call plays on all four channels, which is the manual exactly ('if it is ommitted, the sound effect will be played on all four sound channels'). The 'interaction' with the music is what a NEGATIVE mask buys, which routes through routine 239. All three forms open `move.l \$2c4(a2),d0 / Rbeq routine 390`, so playing with no Pt Sam Bank is error 23, as are sample 0 and a number past the bank's count word (`cmp.w (a0),d7 / Rbhi`); the port returned silently on all three. A NEGATIVE sample number loops",
  'pt instr length':
    "Routine 258 (\$5fe6). Reads the module's own sample table -- 20 bytes of song name, then 31 headers of 30 bytes each with the length in WORDS, so `move.w \$c(a0,d0.w),d3 / add.l d3,d3` doubles it. `move.l \$2bc(a2),d0 / Rbeq routine 390` for no module bank and `Rbmi / Rbeq / cmp.w #\$1f,d0 / Rbhi` for an instrument outside 1..31 are all error 23, where the port answered 0",
  'pt free voice':
    "Routines 238 (\$5b80) and 239. A 1.50 addition with no manual entry, so DISASSEMBLY tier by the author's own admission that he had no time to document what 1.50 added -- and it is not the simple query the port had. It answers with a BITMASK (`moveq #\$1,d3` through `moveq #\$8,d3`, zero for none), not an index with -1, which matters because the only reason to ask is to feed the answer back to Pt Sam Play's voice argument. The cascade: mask 0 is 0; a mask naming exactly one voice is handed straight back UNEXAMINED; otherwise count the free voices, and one free answers with it. None free steals, and `move.w #\$ffff,d4` with a signed `cmp.w d0,d4 / bpl` over the four countdown words keeps the LARGEST, so a looping sample's -2 always loses to a one-shot and four loops answer 0 -- routine 375 then drops the sample rather than interrupting anything. More than one free prefers a voice the music is not using, lowest first. DEVIATION: the last arm, when every free voice is one the music holds, minimises two words of the live channel structures at -\$13e(a1) -- the quietest music channel -- and this port does not step patterns, so it falls back to the lowest free voice",
  'pt play':
    "Routines 264 (\$612e) and 265. The bare form pushes song position 0 (`clr.l -(a3)`) and then both forms `Rbsr routine 267` -- a Pt STOP is the first thing Pt Play does. The d1 it hands the replayer is the SONG POSITION, not a playing flag; an earlier reading of the selector-1 arm had that back to front. Selector 1 checks \$438(a0) against `M.K.` and `M!K!` and errors 23 on anything else, so naming a bank that is not a module stops the program rather than playing silence. Which interrupt it ends in is Pt Cia Speed's \$296(a2), the two timings installing through different code, which is why the manual says to choose the timing BEFORE Pt Play. DEVIATION: the `cmpa.l #\$200000,a0` chip-RAM check is Pt Bank's and carries the same note",
  'pt bank':
    "Routine 263 (\$610c) does no such thing as the `Rbsr` into Pt Stop an earlier pass credited it with -- there is no `Rbsr` in it at all. Thirty-four bytes: resolve the bank, keep the address at \$2bc, range-check it against 2MB and tail into selector 1 of routine 381 with d1 = 0. That selector is the module SET-UP -- signature check, then cache the base at -\$12(a5), scan the 128-byte order for its maximum to learn the pattern count, and fill the 31 sample pointers Pt Instr Address reads. It finishes `move.b #\$6,-\$e(a5)` (speed 6), `move.w #\$7d,(a5)` (125 bpm), position and row cleared, all four voices freed -- and `ori.b #\$2,\$bfe001`, the power LED off, which DISENGAGES the low-pass filter. Loading a module changes how the whole machine sounds. DEVIATION: the 2MB test compares a real address and this port models memory type as a flag on the bank, so enforcing it would reject every Reserve As Work bank, including on machines where all memory is chip and the original is happy",
  'pt sam bank':
    "Routine 249 (\$5ea4), three instructions: pop the bank number, `Rjsr routine 1121` to resolve it, keep the ADDRESS at \$2c4(a2). Keeping the address rather than the number means a later Erase leaves Pt Sam Play pointing at freed memory; this port keeps the number, which is the closest thing it has to a stable handle",
  'set trans source':
    "Routine 147 (\$4142), eighteen bytes: pop, `Rjsr routine 1121` to resolve a bank number to an address, keep it at \$496(a2). DEVIATION: the machine keeps the ADDRESS, which is why the changelog writes the argument as `bank/address` -- a raw pointer works as well as a bank, and a later Erase leaves it dangling. This port has no address space to hand one, so it keeps the bank NUMBER, exactly the trade Pt Sam Bank already records against the same routine 1121",
  'set trans map':
    "Routine 149 (\$4190), the same three pops and the same `addi.w #\$1f / andi.w #\$ffe0` width rounding as Alloc Trans Map, then routine 1121 instead of a Reserve. DEVIATION: bank number rather than address, as Set Trans Source",
  'alloc trans map':
    "Routine 148 (\$4154). The pops are last-argument-first, so height lands first at \$4a0(a2); the width is rounded UP to a multiple of 32 into \$49e(a2) because routine 152 emits a longword -- 32 pixels -- at a time; and the Reserve is `mulu.w d3,d2 / add.l d2,d2`, so TWO BYTES A PIXEL. The rounding is a word operation, so a width within 31 of 65536 wraps. NOTE: a zero width or height asks for a bank of length 0, which the machine reserves happily and this port refuses with error 23 -- and the Reserve failing on the machine is the 24 of routine 389, not 23",
  'alloc code bank':
    "Routine 150 (\$41b6). Size pops first into \$4a6(a2), then the bank, then a Reserve named \"CodeBank\" with `moveq #\$0,d1` -- a Work bank. NOTE: the size is stored and NEVER READ. Nothing in the hunk compares against \$4a6, which is exactly what the author warns about: \"Allocating the Code bank to small will cause memory overwrites\". It exists for one caller, Trans Screen Dynamic, which is the one keyword of the eight this port cannot close",
  'alloc trans source':
    "Routine 146 (\$411a). `moveq #\$1,d2 / swap d2` is the size and it is not a parameter: \$10000 exactly. It cannot be anything else, because the map indexes this table with a sign-extended word off a pointer biased by \$8000, so all 65,536 entries are reachable. `moveq #\$0,d1` makes it a WORK bank -- the same d1 Wload passes with \"Work    \" where Dload passes 1 with \"Datas   \" (routines 103/104, \$3806 and \$3860)",
  'trans screen runtime':
    "Routine 152 (\$4220) over the shared set-up in routine 151 (\$41e0). The engine is one expression -- `pixel(x,y) = Source[Map[y][x] ^ \$8000] & 1` -- built by `move.b (a0,d4.w),d3 / lsr.w #\$1,d3 / addx.l d0,d0` sixteen times per longword, the map's high word first so it lands leftmost. Ox is snapped down to 16 by `andi.w #\$fff0`, and the row stride is the screen's WIDTH over eight from \$4c(a0), not the bitmap's own bytesPerRow -- the same distinction Splinters' index already records, and it agrees for every screen AMOS opens because it rounds widths to sixteen. DEVIATION: routine 151 range-checks the bitplane against SIX and not against \$50(a0), the screen's depth, where the library's own Blitter Copy (routine 63) does `cmp.w \$50(a0),d4 / Rbge`; so naming plane 5 of a two-plane screen writes through a plane pointer AMOS left null. This port raises error 23 instead. NOTE: there is no clip of any kind -- nothing compares ox, oy or the map's extent against the screen, and the author says so: \"Wrong or stupid parameter values are not checked for validity\". NOTE: neither the map nor the source pointer is checked for zero either, so with no Trans Map set the machine walks from address zero; that raises error 23 here",
  'trans screen static':
    "Routine 154 (\$42fc) is TWO BYTES, `rts`, and the changelog says why: \"Trans Screen Static NOT YET IMPLEMENTED\". Doing nothing is the behaviour. DEFECT: it does not quite do nothing. Its token declares four parameters (`I0,0,0,0`, the same as Runtime and Dynamic) and the interpreter pushes all four before jumping -- `move.l d3,-(a3)`, +ILib.s:6862 -- leaving the routine to pop them, as +Lib.s:18517 spells out: `lea 4*4(a3),a3   Depile les parametres`. Every other routine in the library pops exactly as many longs as its spec declares (146 one, 148 and 149 three, 150 two, 151 four); 154 pops none, so each call leaks sixteen bytes of AMOS parameter stack. NOT REPRODUCED: this port evaluates arguments as it parses rather than onto a stack, so there is nothing to leak -- the four arguments are still consumed, because the spec is what the parser follows",
  'pt volume':
    "Routine 261 (\$6084), the MUSIC's volume at \$4(a0) -- and NOT the volume a sample plays at, which is Pt Sam Volume's \$2d0(a2). NOTE: `bpl` tests the whole long and `cmp.w #\$40,d0 / bls` only the low word, so `Pt Volume 65536` is positive, has a low word of zero and stores silence. Reproduced; it is one mask",
  'pt sam volume':
    "Routines 244 (\$5d98) and 245 -- two forms doing two different things, which the port had the wrong way round. One argument touches no hardware at all: it clamps and stores to \$2d0(a2), the volume routine 375 gives every LATER sample launch, and the .Lib ships it at 64. Two arguments write AUDxVOL directly, for a channel that is actually playing (`tst.b (a1) / bne next`), which is the manual exactly: 'the command only has effect on the currently played sample, but not on the following samples'. `voice` is a MASK like everywhere else here. NOTE: the clamp is `bpl` then a SIGNED `cmp.w #\$40,d0 / ble`, where Pt Volume's is unsigned, so `Pt Sam Volume 32768` has a low word of \$8000 that reads as negative, passes the ceiling test and is stored whole",
  'pt instr play':
    "Routines 254 (\$5f6c), 255 and 256 -- the same three forms as Pt Sam Play, and the shorter entries are where the defaults come from: `moveq #\$f,d1 / move.l d1,-(a3)` for the voice and `move.l #\$3d09,-(a3)` for the frequency, so a bare call is all four channels at a flat 15625 Hz. The port used the period table's C-3, which is a different rate, and read the two-argument form as (instrument, mask) rather than (mask, instrument). Routine 256 calls Pt Instr Address and Pt Instr Length in turn, so their range checks and their 'no module bank' error are what guards it, and a NEGATIVE instrument number loops",
  'pt instr address':
    "Routine 257 (\$5fb2), and it does not walk the module: it reads a CACHE of 31 longs at -\$92(a5) that selector 1 of routine 381 fills when Pt Play or Pt Bank installs a module, by summing the sample lengths from `module + 1084 + patterns*1024`. So the address only exists once a module has been set up, and `move.l \$2bc(a2),d0 / Rbeq routine 390` is exactly that test. The instrument range check is Pt Instr Length's, and all of them are error 23 where the port answered 0",
  'pt raw play':
    "Routine 248 (\$5e90), twenty bytes, and the fourth parameter is a FREQUENCY IN HERTZ -- 'freq holds the replaying speed in Hertz' -- which routine 375 clamps to 400..30000 and turns into a period as \$369E99/freq. The port ran the conversion the other way, as if it were a period, so a program asking for 8363 Hz got 428. DEFECT: the negative-length idiom is broken. Every other launcher here spells it `bpl / neg.l d7 / moveq #\$1,d6` because d7 is where they hold the number; this one holds the length in d0 and negates d7 anyway, so the loop flag is set as intended but the length stays NEGATIVE, `lsr.l #\$1,d0` turns it into a length near 2GB and Paula is handed a two-gigabyte loop. NOT reproduced: this port has no address space to run off the end of, so a negative length loops the sample as the author meant, and the difference is recorded rather than emulated",
  'pt data base':
    "Routine 253 (\$5f5a), and selector 4 of routine 381 is the surprise: `lea \$9cea(pc),a0 / move.l a0,\$2cc(a2) / move.l a2,\$1e(a0)`. The replayer's state is NOT in the extension's AllocMem'd \$23b6 block like every other engine here -- it is a fixed area inside the LIBRARY'S OWN CODE HUNK, which is why dumping the .Lib at \$9cea gives its initial values directly: 125 bpm, volume 64, twelve \$ff for the voice flags. The block runs from \$9bac (four channel structures of \$2c) through 31 sample pointers at \$9c5c to the header at \$9cea. NOTE: answers 0 for the same reason the Scrn pointers do -- there is no byte layout here for a program to walk. APPROXIMATED",
  'pjoy':
    "'Corresponds to the AMOS function Joy, with the difference, that one of the parallel port joysticks is checked instead of the normal joysticks', with the same JOY_* bit layout. NOTE: there is no adaptor -- this is the same CIA-A PRB hardware sticks.ts models, and Sticks already answers 'no adaptor' honestly. An unused port reads as nothing pressed on the machine too, so these agree with it rather than pretending. The manual even ships a wiring diagram for building the cable",
  'xfire':
    "'If the lowlevel-library is available, all the other buttons can be checked aswell.' lowlevel.library is not modelled and a plain gameport has one button, so anything past the first reads as not pressed; the first is the ordinary fire the host already supplies",
  'x smouse':
    "NOTE: nothing drives a second mouse here, exactly as in the Sticks port where the manual is explicit that this is 'not ... the AMOS pointer'. The position holds wherever a program last put it and the buttons read as up",
  'speek':
    "'exactly the AMOS function Peek. However, Bit 7 is used as sign bit so the result will be a value between -128 and 127.' One of the armed contested names -- Personnal has a Speek too, and until this one was declared `qualified` Personnal's answered for it, which a test caught",
  'audio lock':
    "'When you start AMOS, the audio.device will be not informed, that AMOS wants to have the audio channels. Due to this flaw, other programs that are running in the background can replay a sound at any time.' There is no other program in the background here and no audio.device to arbitrate with, so a no-op is FAITHFUL: the observable effect on the calling program is the same",
  'open workbench':
    "'Tries to open the workbench again, if it has been closed previously' with AMOS's Close Workbench. There is no Workbench screen to reopen and closing it here frees nothing, so there is nothing to undo",
  'extbase':
    "Routine 133 (\$3c8e), 30 bytes: `lsl.w #\$4,d0 / lea \$f8(a5),a0 / move.l (a0,d0.w),d3` -- AMOS's extension table, 16 bytes a slot, and this reads the base at +\$0 where Extdefault reads +\$4 and Extremove +\$8. The bounds are the same in all three and are the only check any of them makes: `subq.l #\$1,d0 / Rbmi` and `moveq #\$1a,d1 / cmp.l d1,d0 / Rbge`, so slots are 1..26 and anything else is error 23. Twenty-six is the same 26 the registry describes. An EMPTY slot reads the zero the table starts as, which is the keyword's real use -- `If Extbase(8)=0` asks whether AMCAF is loaded -- and that answer is exact here. DEVIATION: the VALUE is synthetic. Extension code in this port is TypeScript, so there is no hunk to point at; the address is distinct per slot, obviously synthetic, and deliberately mapped by nothing, so a program that Peeks through it fails rather than reading plausible rubbish",
  'extdefault':
    "Routine 134 (\$3cac), 44 bytes. 'Calls the default routine of the extension, like the AMOS command Default does', and the bytes agree exactly: it indexes the same table `Default` walks (`movea.l \$4(a0,d0.w),a1`) and calls the same pointer, one slot instead of every one. That hook is now declared on the port (../runtime/extimpl.ts) rather than called by name from the core, which is what made this implementable -- `Default` had `turboDefault(rt)` and `personnalDefault(rt)` hard-coded, so there was no way to ask for one slot's. A slot whose extension has no default routine is `beq` past the call on the machine and a port with no hook here, not an error either way",
  'extreinit':
    "Routine 136 (\$3d08), 96 bytes. 'Reinitialises the extension, like when starting AMOS.' The other three extension-table keywords read a pointer out of the slot's sixteen bytes; this one has none to read, so it walks the slot's TOKEN table at \$24(a5) to its end -- `move.w (a1)+,d0 / beq` for the length, skip the routine word, scan name bytes until one is `>= \$f6`, round up to even -- and calls the first non-zero word after it with `d1 = 'APex'`, raising message 14 if it answers \$ff. DEVIATION: that entry point has no equivalent here, so what is reproduced is what running it DOES: the extension's state as at load, through the port's `init` hook. This was recorded as n/a on the grounds that it ends in a `jsr` into extension code -- a claim about the MECHANISM, where every other keyword in the group is modelled by its effect, Extdefault's `jsr` through a pointer included. NOTE: message 14 cannot fire; it is the extension reporting its own reinit failed, and rebuilding a state object has no way to",
  'extremove':
    "Routine 135 (\$3cd8), 48 bytes: `movea.l \$8(a0,d0.w),a1 / clr.l \$8(a0,d0.w)` and then a call through it if it was not null. 'Removes the extension in the slot from memory like when exiting AMOS', with the manual candid about the price -- 'Otherwise, you can lose memory or even crash your computer.' NOTE: a no-op past the bounds check, and FAITHFUL for the reason Audio Free is. What the remove routine does is hand memory back and nothing here models memory as scarce; what the `clr.l` does is make a SECOND Extremove do nothing, which is already true of the first. The observable effect on the calling program is the same. Note what it does not touch: +\$0 is left alone, so Extbase still answers after a remove, and this port matches",
  'coords bank':
    "TWO token entries and two routines. The table carries `!coords bank` (id \$0d10, spec `I0`, routine 93) followed by an empty-named continuation (id \$0d24, spec `I0,0`, routine 94), which is how AMOS spells one keyword with two arities -- `!track play` and its two blank followers are the same shape. Routine 93 (\$33d4) is eighteen bytes and reserves NOTHING: `movea.l \$168(a5),a2 / move.l (a3)+,d0 / Rjsr routine 1121 / move.l d0,\$266(a2) / rts`, which resolves the bank to an address and stores the pointer -- exactly the manual's 'the existing bank will only be switched to without erasing it. So you can jump between predefined banks.' Routine 94 (\$33e6) is the one that allocates: `move.l (a3)+,d2 / Rbeq routine 390` makes a count of zero an error, `lsl.l #\$2,d2 / addq.l #\$8,d2` sizes it at four bytes each plus an EIGHT-BYTE HEADER, `lea \$341a(pc),a0 / Rjsr routine 1103` Reserves it under the name 'Coords  ' with `Rbeq routine 389` for out of memory, and `move.w d7,(a0)+ / clr.w (a0)+ / moveq #\$8,d0 / move.l d0,(a0)` writes the header: +0 the COUNT, +2 the CURSOR of how many have been handed out, +4 the byte offset of the next entry, starting at 8. An earlier pass reserved `count * 4` with no header at all, eight bytes short and leaving every reader without a count. NOTE: `move.w d2,d4 / move.l d4,d7` narrows the count to a WORD before storing it while `lsl.l #\$2,d2` sizes the Reserve from the full long, so above 65535 the two disagree in the binary too; that is reproduced",
  'coords read':
    "Routine 95 (\$3422), 276 bytes. 'colour represents the background colour, that will be left out when reading in the dots ... all dots, which don't have the colour' are gathered. Splinters need this list because, unlike Td Stars, 'they don't destroy the background and use the colour of the pixel they have removed'. The scanner from \$3486 to \$34f0 is Count Pixels' scanner instruction for instruction, so it carries the same findings: the far corner is EXCLUSIVE, an empty or reversed box is an error before any work (here through routine 157, a four-byte `Rbra routine 390`), and the colour is compared as a byte. All EIGHT arguments are required -- routine 95 pops eight longs and the spec is `I0,0,0,0t0,0,0,0` -- where an earlier pass had `mode` optional. Each hit is written as x<<4 then y<<4: `move.w d3,d2 / addq.l #\$2,d2 / lsl.l #\$2,d2 / adda.l d2,a0` puts entry n at the eight-byte header plus 4n, and `move.w d1,d2 / lsl.w #\$4,d2 / move.w d2,(a0)` with `move.w \$a(a7),d2 / sub.w d7,d2 / add.w \$6(a7),d2 / lsl.w #\$4,d2 / move.w d2,\$2(a0)` recovers the row from the countdown register. The port wrote raw pixel coordinates at offset zero. The <<4 is load-bearing rather than decorative: routine 386 moves a splinter in the same units (`move.w (a0),d2 / add.w \$c(a0),d2` then `lsr.w #\$4,d2` to reach a pixel) and routine 385 copies a bank entry straight into a splinter's x,y with one `move.l`, so a bank coordinate IS a splinter coordinate in sixteenths of a pixel. `cmp.w (a0),d3 / beq \$34fa` stops the scan when the count reaches the LIMIT in the bank's first word and `move.w d3,(a0)` then replaces it with what was found. And `mode` is not 'the scan order': `move.w (a7),d0 / bne \$3504` makes a non-zero value SHUFFLE the finished list, `lea \$dff006.l,a1 / add.w (a1),d6 / move.w d6,d5 / mulu.w d7,d5 / swap d5` taking the raster beam as its entropy and the high word of accumulator*count as the index to swap with. NOTE: because the count is written back, a second Coords Read into the same bank is limited by the FIRST one's result rather than by the bank's capacity; reproduced. NOTE: the modelled beam does not advance while a keyword runs, so VHPOSR returns the same value every iteration and the shuffle is a fixed permutation where the real one is not -- reading VHPOSR is faithful, the standing-still is the port's clock. NOTE: nothing bounds-checks the bank against its own length; the routine trusts the limit word, and the length test in the port is the port's",
  'c2p fire':
    "Routine 76 (\$2fa2) is a FLAME filter, not the plain decrement an earlier pass had. It sums FIVE neighbours -- `move.b (a0,d5.w),d0` one row below, `move.b (a0,d4.w),d1` one row above with d4 = -wx, `move.b -\$1(a0),d2` left, `move.b (a0)+,d3` itself and `move.b (a0),d1` right -- then `move.b (a2,d0.w),d0` puts the sum through a table, `sub.w d7,d0` takes the decay off and `bpl` else `clr.b (a1)+` clamps at zero. That is what makes a chunky buffer look like fire when it is seeded along one edge; subtracting the decay from each byte on its own is a fade. The table is at \$1cb2 of the runtime block and routine 396 (\$aa92) builds it from the init: five `move.b d0,(a1)+` a pass over 256 passes, with `addq.w #\$1,d0` between the THIRD and fourth, so entry i is i/5 ROUNDED TO NEAREST rather than floored -- 2/5 rounds down, 3/5 up -- capped by `cmp.b #\$ff,d0`. 1280 entries, ending exactly where the string buffer at \$21b2 begins. NOTE: the routine reads a row either side of the buffer without checking, so the first and last rows sample memory outside it; the port reads zero there rather than whatever the heap held. NOTE: the walk is FLAT, so 'left' and 'right' cross row boundaries. Reproduced",
  'c2p shift':
    "Routine 77 (\$2ff2) shifts every BYTE right, four at a time, where an earlier pass ADDED its last argument to each. The mask is what makes it per-byte: `moveq #\$ff,d0 / lsr.b d7,d0` is what survives one byte's shift, replicated into all four with three `lsl`/`move.b` pairs, and the loop is `move.l (a0)+,d1 / lsr.l d7,d1 / and.l d0,d1 / move.l d1,(a2)+` -- `lsr.l` alone would drag each byte's low bits into the byte above, and the mask clears exactly those. A shift of zero takes its own arm at \$3022, a plain `move.l (a0)+,(a2)+` copy. NOTE: `lsr.l #\$2,d6` counts LONGWORDS, so a size that is not a multiple of four leaves its last one to three bytes untouched. Reproduced",
  'set sprite priority':
    "Routine 210 (\$4f2c) is sixteen bytes and writes the CURRENT SCREEN, not a global: `move.l (a3)+,d0 / movea.l \$52c(a5),a0 / andi.w #\$3f,d0 / move.w d0,\$4a(a0)`. \$4a is two words before the width at \$4c -- BPLCON2's PF1P0-2 and PF2P0-2 fields, the sprite-versus-playfield priority the manual means by 'Changes the sprite priority in Dual playfield mode'. The port held one value for every screen. NOTE: the screen pointer is not tested, so with none open the routine writes through null; the port drops the write. NOTE: nothing in the modelled display reads the field yet",
  'raster wait':
    "TWO token entries under the same name rather than a `!` multi-arity pair: id \$0346 spec `I0` is routine 206 (\$4eba) and id \$0358 spec `I0,0` is routine 207 (\$4ed8). Both spin on \$dff004 read as a LONG with `lsr.l #\$8` for the vertical position; the two-argument form then spins on the byte at \$dff007 for the horizontal, having halved its x argument with `lsr.l #\$1,d2` because VHPOSR counts colour clocks where the manual's x is lowres pixels. d3 is the LAST argument, so `Raster Wait x,y` waits for line y at column x. DEVIATION: this port has no beam to spin on inside a keyword -- the modelled VHPOSR only advances between statements -- so both forms wait one frame. A program splitting a copper effect mid-frame gets frame granularity here",
  'set ntsc':
    "Routines 208 (\$4f04) and 209 (\$4f18), twenty bytes each, and each does TWO things: `move.w #\$0,\$dff1dc.l` or `#\$20` sets BEAMCON0, and `movea.l \$4.w,a0 / move.b #\$3c,\$212(a0)` or `#\$32` sets ExecBase->VBlankFrequency to 60 or 50. DEVIATION: only the BEAMCON0 half is reproduced. \$212(a0) is a field of the real ExecBase, which this port does not model as memory, and nothing here reads a frame rate from it -- the interpreter's tick is its own clock. A program that pokes ExecBase to find out would see the machine's value change and this one's not",
  'blitter busy':
    "Routine 68 (\$2cce), twenty bytes: `btst.b #\$6,\$dff002.l` is bit 14 of DMACONR, BBUSY, and the answer is `moveq #\$ff,d3` -- which is -1, not 1 -- when set, zero when clear. Always zero here, and FAITHFUL rather than a stub: every blitter operation in this port completes inside the keyword that started it, so there is never a moment when a program could observe one running, and the -1 arm is unreachable for the same reason",
  'vec rot precalc':
    "Routine 4 (\$1f96) is 236 BYTES and it is not a no-op. An earlier pass wrote 'Nothing here caches a matrix, so this is a no-op -- FAITHFUL rather than a stub, because the only thing a program can observe afterwards is that the following Vec Rot X/Y/Z give the same answers either way', which is exactly backwards: routine 373 (\$84e4), which is every Vec Rot X/Y/Z WITH arguments, reads ONLY the nine-word matrix at \$31e and never looks at an angle, and this routine is the only thing that writes that matrix. So on the machine Vec Rot Angles followed by Vec Rot X gives the OLD rotation, and Vec Rot X with no Precalc ever called projects through the zeros the MEMF_CLEAR block starts with -- which makes the rotated distance zero and stops the program on routine 373's `tst.w d5 / Rbeq routine 390`. The build looks up six table entries into \$312..\$31c (the sine at each angle and the cosine a quarter turn on, `addi.w #\$200 / andi.w #\$7fe`) and composes them with `muls.w` and `asr.l #\$8` throughout. Transcribed instruction for instruction rather than re-derived as an Euler composition, because `asr` FLOORS rather than truncating toward zero and every intermediate is narrowed to a word before the next multiply sees it",
  'vec rot x':
    "Routines 5 (\$2082) and 6 (\$208e) -- the three-argument form runs routine 373 (\$84e4) and returns d3, the bare form reads the cached \$30c. Routine 373 multiplies the point through the matrix Vec Rot Precalc built, ADDS Vec Rot Pos afterwards (x and y shifted left 8 to match the matrix's scale, z at face value into the divisor) and then divides: `divs.w d5,d3` into \$30c and `divs.w d5,d4` into \$30e, with \$310 taking the distance. The port used to subtract the position BEFORE rotating and multiply by 256 for the projection; there is no separate multiply, the 256x scale is the matrix's own. DEFECT: the arguments reach the matrix BACKWARDS. `(a3)+` pops the last argument first -- the order Qcos depends on when it adds a quarter turn to \$6(a3) -- so the first pop is z, and the first pop multiplies \$31e/\$324/\$32a, the first COLUMN, which routine 4 builds as `[c1*c2, ...]` where the third column is `[s2, ..., c3*c2]`. That is the standard shape for a first column pairing with x, so `Vec Rot X(x,y,z)` rotates the vector (z,y,x). Identical in 1.40 and 1.50, and a caller feeding a symmetric point would never see it. Reproduced. NOTE: `divs.w` is 32-by-16 and a quotient too big for a word leaves the register untouched on the 68000 while setting V, which nothing tests -- so a point very close to the eye reports the PREVIOUS x or y. Reproduced. NOTE: a rotated distance of zero is error 23, where the port substituted 1",
  'vec rot angles':
    "Routine 3 (\$1f6c): each angle is masked with `andi.w #\$3ff` and then DOUBLED by `add.w d0,d0`, because it is kept as a byte offset into the 1024-entry word sine table rather than as an angle -- a program peeking \$306 finds twice what it set. The pop order puts the LAST argument at \$306, which routine 4 then uses as the FIRST of the three angles it composes. NOTE: setting an angle has no effect until the next Vec Rot Precalc; see that keyword",
  'vec rot pos':
    "Routine 2 (\$1f54), three words at \$300. NOT subtracted from the point before the rotation, which is how the port had it -- routine 373 ADDS it afterwards, x and y scaled up by 256 to match the matrix products and z at face value into the divisor. So it translates the camera in ROTATED space, and its z is what pushes the scene away from the eye",
  'limit smouse':
    "Routines 168 (\$4682) and 169 (\$46c4), and they share NOTHING with AMCAF's other two Limit keywords -- the port borrowed Splinters' reader for all three, and got two of the three wrong. Routine 169 is thirty bytes of plain store: `move.l (a3)+,d3 / ... / move.w d0,\$2f8(a2)` and three more. No `lsl.w #\$4`, so the second mouse's box is in WHOLE PIXELS rather than the particle engines' sixteenths; no `subq`, so the far corner is INCLUSIVE; and no `cmp.w`/`exg.l`, so a reversed rectangle stays reversed rather than being normalised into a usable one. Routine 168, the bare form, does not start at 0,0 either: `move.w \$52(a0),d0 / move.w \$54(a0),d1 / andi.w #\$3ff,d0 / andi.w #\$3ff,d1` reads the screen's DISPLAY POSITION -- the copper's ten-bit field -- and adds the size to it, so the box is where the screen sits on the hardware display and a Screen Display moves it. That is consistent with the rest of the family: X Smouse and Smouse X are in the same hardware coordinates AMOS's own X Mouse uses, not in screen pixels. NOTE: routine 168 loads \$52c(a5) without testing it, where both particle Limits check; with no screen open it reads through a null pointer, and the port answers with the default 128,50 origin instead",
  'splinters fuel':
    "Routine 290 (\$69be) narrows the argument to a WORD at \$27e, which routine 385 copies into each respawned splinter's +\$14. NOTE: zero does not mean 'never'. Routine 386 does `tst.w \$14(a0) / Rbeq routine 385` BEFORE it decrements, so a life of zero respawns the splinter on its first Move. The manual's 'If you set time to 0, the Splinters only disappear at the edges of the screen' describes what a zero fuel looks like once the coordinate list is spent -- every splinter dies at once and stays dead -- rather than unlimited life, which is how an earlier pass read it",
  'splinters init':
    "Routine 295 (\$6a60) is THIRTY-SIX BYTES and reads nothing: `movea.l \$26a(a2),a0 / Rbeq routine 390 / move.w \$280(a2),d7 / moveq #\$ff,d0 / lea \$10(a0),a0` then `move.l d0,(a0) / lea \$16(a0),a0 / dbra d7`. `moveq #\$ff` is moveq #-1, so it writes \$ffffffff over +\$10..+\$13 of every record -- mark every splinter FREE, with no saved background and no pending spawn. It never looks at the screen, the coordinate list, the fuel or the speeds. The manual's 'the Splinters are fed with the coordinates and speeds you specified' describes the ENGINE: feeding happens one splinter at a time in routine 385, when a Move finds one free, dead or out of bounds. An earlier pass read that sentence as this call and seeded a JS particle array from the coordinate bank here, which took every coordinate at once, ignored Splinters Max and never advanced the bank's cursor -- so the engine could not run out, which is the one thing the real one does. The whole engine now lives in the bank: 22 bytes a splinter, +\$00 x and +\$02 y in sixteenths of a pixel, +\$04 the flat bit index (y>>4)*width + (x>>4), +\$08 the previous +\$04, +\$0c/+\$0e the speeds, +\$10 the splinter's colour with \$ff meaning free, +\$11 the background under +\$04, +\$12 the background under +\$08, +\$13 the spawn marker (\$ff fresh, 1 half-cleared, 0 settled) and +\$14 the life",
  'splinters move':
    "Routine 300 (\$6c32) is the loop -- table at \$26a, count at \$280, coordinate bank at \$266 with a missing one error 23, the Splinters Max allowance from \$282, and VHPOSR into d6 -- calling routine 386 (\$a904) once per record. 386 shifts the generations first (`move.l \$4(a0),\$8(a0) / move.b \$11(a0),\$12(a0)`), ALWAYS, then: a free splinter (+\$10 = \$ff) goes to routine 385 to respawn; a fresh one (+\$13 set) sits still for one step; an exhausted one (+\$14 = 0) respawns; otherwise `add.w \$c(a0),d2` moves it and `add.w d2,\$c(a0)` adds the gravity afterwards. The clip is `cmp.w \$26e(a2),d2 / bmi` and `cmp.w \$272(a2),d2 / bpl`, so the far corner is EXCLUSIVE, and all four failures `Rbra routine 385` -- leaving the limit RESPAWNS a splinter rather than deleting it, which is what makes an endless field endless. Routine 385 hands out the next four bytes of the coordinate bank with a single `move.l`, advances the bank's own cursor and offset, and rolls two speeds off the beam as `andi.w #\$3f` retried while zero, less \$1f. Both ways of failing -- the allowance spent or the list exhausted -- mark the splinter free rather than raising. NOTE: the beam retry is bounded at 64 attempts here. On the machine the beam has moved by the time the loop comes round so a zero is transient; the modelled beam stands still inside a keyword, so an unguarded retry would never end. NOTE: routine 300 loads \$52c(a5) and never tests it, so with no screen open routine 386 reads through a null pointer; error 47 stands in for the bus error",
  'splinters back':
    "Routine 301 (\$6c74) does TWO jobs. It reads the screen at +\$4 across \$27c+1 planes into +\$11, the background the next Del will put back -- and then `cmpi.b #\$ff,\$13(a0) / bne / move.b d5,\$10(a0)` gives a FRESH splinter that same pixel as its own colour. That is the engine's premise, 'they don't destroy the background and use the colour of the pixel they have removed': the colour is not in the coordinate bank and nothing else supplies it, which is why the manual insists Back comes before Draw",
  'splinters draw':
    "Routine 302 (\$6ce2) writes +\$10 at the flat index +\$4, skipping any splinter marked free. Like all four drawing loops it addresses the screen as a bit index -- `move.b d1,d2 / not.b d2 / lsr.l #\$3,d1` then `bclr.b`/`bset.b` per plane -- over \$27c(a2)+1 planes only, so anything above the depth Splinters Colour named survives untouched",
  'splinters single del':
    "Routines 298 (\$6aa4) and 299 (\$6b66) are two passes each. The first puts the background back: Single reads +\$11 at +\$4, Double reads +\$12 at +\$8, and \$ff means there is nothing saved. The second is the HOLE, which nothing in the manual prepares you for -- a splinter lifted its colour off the picture, so where it came from is filled with \$27b, the byte Splinters Colour stored, once on the first Del after the spawn. Single clears the +\$13 marker outright; Double steps it \$ff -> 1 -> 0 so the hole is punched into BOTH buffers of a double-buffered screen. That staging is the only difference between the two second passes and the reason +\$13 holds \$ff rather than a plain flag",
  'splinters single do':
    "Routines 296 (\$6a84) and 297 (\$6a94) are sixteen bytes each: `Rbsr routine 298`/`Rbsr routine 299`, then `Rbsr routine 300` (move), `Rbsr routine 301` (back) and `Rbra routine 302` (draw). FOUR steps, exactly what the manual tells a caller doing it by hand. An earlier pass had Single Do as restore-move-draw and Double Do as move-draw, on the reasoning that a double-buffered screen already carries the last frame as its background; both routines disagree",
  'splinters active':
    "Routine 303 (\$6d4a) counts a splinter unless ALL THREE colour bytes are \$ff: `moveq #\$ff,d0` leaves d0.w = \$ffff, `cmp.w \$10(a0),d0` covers +\$10 and +\$11 at once, then `cmp.b \$12(a0),d0`. So one routine 385 has just given up on -- it sets +\$10 and +\$11 but leaves +\$12 from the frame before -- still counts for one more Move, which is exactly how long its pixels are still on the screen. The length of a particle array, which is what an earlier pass returned, cannot express that",
  'splinters limit':
    "TWO routines behind one `!` token entry: 291 (\$69ca) bare and 292 (\$69f4) with four corners. Both store SIXTEENTHS, because that is what routine 386 compares against. The bare form takes the current screen -- `clr.l \$26e(a2)` then `lsl.w #\$4` and `subq.w #\$1` on the width and height -- so the far corner is width*16 - 1, one sixteenth short of the pixel past the edge, and with no screen open it is error 47. The explicit form shifts all four the same way, takes one off the high pair, and orders each axis with an UNSIGNED compare (`cmp.w d0,d2 / bhi / exg.l d0,d2`), so a reversed rectangle is swapped rather than rejected and a negative x1 sorts as a very large one. NOTE: the private block arrives from `AllocMem #\$10001` -- MEMF_CLEAR -- so before any call the box is 0,0 To 0,0, which routine 386 treats as nowhere. A program that forgets Splinters Limit gets nothing on the machine too",
  'splinters max':
    "Routine 289 (\$69b2) narrows the argument to a WORD at \$282. Routine 300 loads that word into d5 once per Move and routine 385 decrements it, `tst.w d5 / beq` refusing to spawn at zero -- so it is an allowance shared by the whole table for one step, not a per-splinter test. The manual's -1 for no limit works only because -1 narrows to \$ffff, which is 65535 spawns rather than infinity",
  'splinters gravity':
    "Routine 293 (\$6a26) stores the pair RAW at \$276/\$278. NOTE: the speeds it is added to are in sixteenths of a pixel -- routine 386's `add.w \$c(a0),d2` where d2 is the x<<4 position -- so `Splinters Gravity 1,1` is a sixteenth of a pixel per step per step, sixteen times gentler than the whole-pixel arithmetic an earlier pass used. Nothing scales it; only Limit and the coordinates get the `lsl.w #\$4`",
  'td stars bank':
    "'Each star consumes 12 bytes of memory.' Td Stars DO destroy the background, which is why the manual pairs Draw with a matching Del rather than saving anything -- the opposite of Splinters",
  'td stars limit':
    "Routines 305 (\$6dba) bare and 306 (\$6df2) with four corners, the SIXTY-FOURTHS twin of Splinters Limit -- `lsl.w #\$6` where Splinters uses 4, the same `subq` on the high pair making the far corner exclusive, and the same unsigned `cmp.w`/`exg.l` normalising. 'These coordinates must lie WITHIN the screen dimensions, otherwise the stars could corrupt your memory': DEVIATION, they cannot here, because tdStarPoke drops an offset outside the planes. DEFECT: both forms also overwrite the ORIGIN and nothing documents it -- routine 305 stores a LONGWORD at \$256, exactly where Td Stars Origin (307) puts its pair -- and the explicit form computes that centre as `add.w d1,d0 / lsr.w #\$1,d0` and `add.w d3,d2 / lsr.w #\$1,d2`, which averages x1 with y1 and x2 with y2, MIXING THE AXES. The bare form takes the true middle instead, `move.w d0,d1` before the subtract. Both reproduced",
  'td stars init':
    "Routine 308 (\$6e46), and 'the stars are moved by random values to avoid that they all start in the origin' is LITERAL: `Rbsr routine 387` spawns the star at the origin, `clr.l \$4(a0)` gives it no previous position, and `add.w (a1),d5 / andi.w #\$1f,d5` then `Rbsr routine 388 / dbra d5` runs it forward 0 to 31 steps with the SAME move routine Td Stars Move uses. That is what strings the field out along its own tracks rather than scattering it. Routine 387 spawns with `move.l \$256(a2),(a0)` -- the origin pair in one instruction -- and rolls two speeds off VHPOSR as `andi.w #\$7f` less \$3f, REJECTING and re-rolling any pair whose magnitudes add to less than sixteen sixty-fourths, so no star ever crawls. An earlier pass invented `z: 1 + (i % 64)` and two multiplicative velocities here; there is no z in a twelve-byte star. NOTE: d5 is never initialised before the first star, so `add.w (a1),d5` reads whatever the interpreter left; `andi.w #\$1f` bounds it to 0..31 either way and every later star is deterministic. Modelled as zero. NOTE: the beam retry in 387 is bounded at 64 attempts here, for the same reason as the Splinters spawn -- the modelled beam stands still inside a keyword",
  'td stars move':
    "Routines 317 (\$6fd4) for the whole table and 318 (\$6ffc) for one, both over routine 388 (\$a9be). 388 saves the previous position with `move.l (a0),\$4(a0)` -- which is all Double Del needs -- then adds the speed, clips against \$24e..\$254 with `bcs`/`bcc`, UNSIGNED where the Splinters engine's clip is signed, and adds the gravity AFTER the move. All four clip failures `Rbra routine 387`, so leaving the box RESPAWNS the star at the origin. With Accelerate on it then multiplies each speed by 17/16 -- `move.w d2,d0 / lsr.w #\$4,d0 / add.w d0,d2`, with the negative arm mirrored through `not.w` -- and that compounding is the whole depth illusion: a star that has run longer is faster, so it moves further and draws brighter. DEFECT: the indexed form's stride is wrong. Routine 318 bounds the index correctly against \$264(a2) and then does `lsl.w #\$4,d0 / adda.w d0,a0`, multiplying by SIXTEEN where a star is TWELVE bytes -- routine 304 sizes the bank with `mulu.w #\$c` and every other loop steps `lea \$c(a0),a0`. Only index 0 addresses a whole star; index 1 lands four bytes in and moves a record made of one star's speeds and the next one's position. Reproduced",
  'td stars draw':
    "Routine 319 (\$7026), and a star's BRIGHTNESS is its speed: `move.w \$8(a0),d3 / bpl / neg.w d3` and the same for \$a, `add.w d4,d3 / lsr.w #\$6,d3` for whole pixels a step, then `cmp.w #\$3,d3 / bge` sets both named planes, `cmp.w #\$2,d3 / bge` sets plane B alone, and anything slower sets plane A alone. Three levels across two planes, which is why Td Stars Planes takes two plane NUMBERS and why routine 312 refuses a screen with fewer than four colours. An earlier pass drew every star as a solid `(1 << planes) - 1` and had no brightness at all. NOTE: the address is a BYTE offset built as `(y>>6) * (\$4c(a1)>>3) + ((x>>6)>>3)`, so the row stride is the screen WIDTH in bytes rather than the BitMap's bytesPerRow; the two agree for every AMOS screen and the port reproduces the routine's arithmetic rather than the BitMap's",
  'td stars single del':
    "Routines 315 (\$6efe) and 316 (\$6f68). Both clear the bit in BOTH named planes and differ only in WHERE -- Single reads the position at `(a0)`, Double the one at `+\$4` that routine 388 saved before it moved. The same double-buffer reasoning as the Splinters pair, done in four bytes rather than a second table, and much simpler because a star destroys what it lands on and has nothing to put back",
  'td stars single do':
    "Routines 313 (\$6ee6) and 314 (\$6ef2), twelve bytes each: `Rbsr routine 315`/`Rbsr routine 316`, then `Rbsr routine 317` (move) and `Rbra routine 319` (draw). THREE calls where the Splinters pair has four, because there is no Back step -- a star keeps nothing. An earlier pass had Double Do skip the del entirely, which is the one thing neither routine does",
  'td stars planes':
    "Routine 312 (\$6ea6) takes TWO plane numbers, not a count -- token spec `I0,0` -- and its opening depth check is the clearest use of AMCAF's own message table anywhere in the extension: `cmp.w #\$2,d0 / bge` else `moveq #\$f,d0 / Rbra routine 397`, and message fifteen is 'At least 4 colours required in screen'. Each plane number is then bounded against that same depth (`cmp.w dN,d0 / Rble routine 390`) and stored MULTIPLIED BY FOUR (`add.w d1,d1` twice), because that is the offset of a plane pointer in the screen structure and routine 319 indexes with it directly. The pop order puts the FIRST argument at \$260 and the second at \$262, and the order matters: the dim end of the brightness scale lights \$260's plane alone and the middle lights \$262's",
  'td stars origin':
    "Routine 307 (\$6e30) shifts both arguments into SIXTY-FOURTHS (`lsl.w #\$6`) and stores them at \$256/\$258, which routine 387 then copies into a new star with a single `move.l`. NOTE: Td Stars Limit overwrites both -- see its own entry",
  'td stars gravity':
    "Routine 309 (\$6e80) stores the pair RAW at \$25a/\$25c. NOTE: like Splinters Gravity, the speeds it is added to are in the engine's own fixed point, so the unit is a SIXTY-FOURTH of a pixel per step per step",
  'td stars accelerate on':
    "Routines 310 (\$6e92) and 311 (\$6e9c), 'if the stars are to be accelerated'. NOTE: the pair is asymmetric -- On is `st.b \$25e(a2)`, which writes \$ff to the HIGH byte of the word, and Off is `clr.w \$25e(a2)`, which clears both. Routine 388 tests `tst.w` so the two still pair up correctly, \$ff00 being non-zero, but a program peeking \$25f would find On had left it alone. Reproduced",
  'pix shift up':
    "Routines 226/227 (Shift Up), 228/229 (Shift Down), 230/231 (Brighten) and 232/233 (Darken), each a pair with and without the mask bank. 'c1 and c2 hold the border colours, which should be taken into account for the colour cycling, other colours are not affected'. Shift WRAPS within that range where Brighten and Darken stop at its ends, and the manual introduces the family as the slower, limitable alternative to Shade Bobs, which 'cannot limit the colours to a certain range but only the amount of bitplanes'. The skip and the wrap are `cmp.b \$10(a7),d4 / bmi` against c1, `cmp.b \$12(a7),d4 / bhi` against c2, and then `addq.b #\$1,d4 / cmp.b \$12(a7),d4 / ble` falling through to `move.b \$10(a7),d4`. The far corner is EXCLUSIVE -- `sub.w d4,d6 / sub.w d5,d7 / subq.w #\$1,d6 / subq.w #\$1,d7` then dbra -- which an earlier pass had inclusive, the subq pair having been invisible while src/cli/extdis.ts rendered those six bytes as the text run 'SFSG?F'. NOTE: c1 and c2 are stored as BYTES (`move.b d1,(a7)`, `move.b d2,\$2(a7)`), so a colour above 255 wraps into range. NOTE: the two range comparisons are not the same kind, `bmi` against c1 being signed and `bhi` against c2 unsigned, which cannot be told apart within the 0..63 of real colours. NOTE: a degenerate box does not error -- the subq underflows to \$ffff and the dbra runs 65536 times, the same runaway Bzoom has; doing nothing is this port's answer",
  'pptodisk':
    "Routines 235 (\$59e4) and 234 (\$58d2). *'crunches and saves the bank numbered bank into the file file\$ using the PowerPacker algorithm'*, and *'Sorry for the name Pptodisk but Ppsave has already been used by AMOS.'* 235 is three instructions -- `moveq #\$4,d0 / move.l d0,-(a3) / Rbra routine 234` -- so the DEFAULT EFFICIENCY IS 4, the manual's 'best, but slow', not 0. 234 frees any buffer a previous call left (routine 354: FreeMem(\$364(a2), \$368(a2))), opens powerpacker.library VERSION 35 (routine 368, failing to message 5 'No powerpacker.library'), pops its three arguments and immediately pushes the efficiency back as scratch, resolves the bank, and refuses one with either type bit set -- `move.w -\$c(a0),d0 / andi.w #\$c,d0` -- with message 4, 'No icons- or spritesbanks allowed'. Those are Bnk_BitBob and Bnk_BitIcon (+Equ.s:1867-8) and the check is real here, through the one bank list in src/runtime/banks.ts. It opens the file with MODE_NEWFILE (routine 358, `move.l #\$3ee,d2`), takes the length as `-\$14(a0)` LESS SIXTEEN for the bank's own header, AllocMems a copy, and makes four library calls at -\$72, -\$60, -\$6c and -\$66; a non-positive answer from the third is message 6, 'Crunching error'. Routine 361 writes and compares the returned count, so a SHORT WRITE is error 94 -- as is a file it could not open. NOTE: the efficiency is accepted and does not change the output. It goes straight to powerpacker.library, which turns 0..4 into the four-byte table a PP20 file carries at offset 4, and that mapping lives in that library rather than in this binary -- there is nothing here to read it from. This port crunches at [9,10,12,13], which is the table every PP20 file in the corpus actually carries. There is no range check either: whatever the program passes is handed over. NOTE: message 5 cannot fire, because the PP20 codec is ours (src/amiga/powerpacker.ts) and so powerpacker.library is never absent, where on the machine it is a separate file a program may be running without",
  'launch':
    "Routines 209 (1.40) and 221/222 (\$512e/\$513a): `Launch file\$[,stacksize]`, and it starts an AmigaDOS binary as its own process. 221 pushes the default stack -- `move.w #\$1000,d0`, 4096 -- and 222 does `jsr -\$96(a6)` LoadSeg, `Rbeq routine 391` on failure, then `jsr -\$8a(a6)` CreateProc(name, 0, segList, stackSize), and on failure `jsr -\$9c(a6)` UnLoadSeg followed by `moveq #\$b,d0 / Rbra routine 397`, message 11 'Couldn't launch process'. The priority is always 0. The two failures are DIFFERENT and both are reproduced: a file that will not LoadSeg -- absent, or not an AmigaDOS binary -- is an AmigaDOS error reported as AMOS error 81, while a file that loads and will not start is the requester. Telling them apart needs the load actually attempted, so it is, through the same hunk.ts reader every extension library goes through. NOTE: nothing in this port can start a process, so a real binary always reaches the second failure -- which is the branch the routine itself takes when CreateProc returns NULL, out of memory on the machine, rather than a stub. The seam is `host.process` (src/amiga/process.ts), and it is absent rather than impossible: a browser tab has no subprocesses, the CLI and census run under Node where it is ordinary. NOTE: on success the routine never UnLoadSegs, leaving the segment to the process it started; nothing to reproduce while nothing starts",
  'exec':
    "Exec \"command\" — InExec (+Lib.s:3392), source tier and complete. It opens NIL: with mode 1005 and passes THAT HANDLE as both input and output (`move.l d5,d2 / move.l d5,d3`), so the command runs detached and nothing it prints is ever seen -- the same choice LDos's Lexecute and EasyLife's Elexec make with a literal 0, and the opposite of Craft's Cli Execute, which passes Input() and Output(). An empty string is `Rbeq L_FonCall`, error 23, before anything opens. The command line is copied by ChVerBuf (+Lib.s:3677), which TRUNCATES AT 510 characters -- `cmp.w #510,d0 / bcs.s Chv1 / move.w #509,d0` copies at most 510 bytes and then a NUL. A DOSFALSE from Execute is `Rbeq L_DiskError`, AMOS error 87 \"Disc error\". NOTE: nothing in this port can run a command, so Execute always answers DOSFALSE and this always raises error 87 -- which is the branch the routine itself takes for a command that does not exist, and on a machine with no shell every command is one. The seam is `host.process`, absent rather than impossible (src/amiga/process.ts)",
  'lexecute':
    "A=Lexecute(\"programname\") — routine 51 (\$3630), twelve instructions. It copies the name NUL-terminated into a buffer at \$c off LDos's own block, sets `moveq #\$0,d2 / moveq #\$0,d3` and calls `jsr -\$de(a6)`, dos.library Execute, handing d0 straight back to AMOS. The manual: *'A will be True if successful, False otherwise'*, and *'The program to be run can not use any CLI-I/O'* -- which is what those two zeroes mean. NOTE: the copy is unbounded, so on the machine a long enough name overruns the block; there is nothing to reproduce where a string is a string. NOTE: with no host process capability Execute answers DOSFALSE, so this returns 0 -- 'False otherwise', the documented answer for a program that would not start",
  'lrun':
    "A=Lrun(\"commands\",\"WINDOW\") — routine 50 (\$33ca), and it is a script runner rather than a single command. It allocates a signal, finds its task and AddPorts a port named \"ldos\"; builds `\"NewCli \" + window + \" from t:ld.t\"` contiguously from \$3502; opens `t:ld.t` with mode 1006, writes the commands, then writes the twenty-four bytes at \$359f -- **\"t:sig_ldos\\nEndCli >NIL:\\n\"**, which is the *'Ldos will automatically append this'* the manual promises; writes a second file `t:sig_ldos`; Executes the NewCli line with both handles zero; and finally WaitPort/GetMsg/FreeSignal/RemPort. That is why the manual demands c:Run, c:NewCli, c:EndCli and an assigned t:. The script file and the command line are built here for real and are byte-testable; only the Execute needs a host. DEFECT: the return value is meaningless -- the last call before `rts` is RemPort, which returns nothing, and `move.l d0,d3` hands whatever it left back. The manual knows: *'A will contain any number (see Technote below)'*. Reproduced as 0. DEVIATION: `t:sig_ldos` is not written. It is 109 bytes of AmigaDOS executable embedded at \$35c2 -- the helper that signals the port when the script ends -- and this port neither redistributes the library's code nor executes 68k. DEVIATION: it does not block. WaitPort waits for that helper, and with no CLI started nothing ever signals, so reproducing it would hang the interpreter -- the same hang the manual warns of when a command fails and *'the Shell/CLI-window will never be closed'*",
  'reset computer':
    "Routine 203 in 1.40, 215 (\$4ff0) in 1.50, and it reboots two different ways: `Rbsr routine 372` reads exec's LIB_VERSION and `cmp.w #\$25,d0` sends Kickstart 37+ to `jmp -\$2d6(a6)`, ColdReboot, while below 37 it goes Supervisor (`jmp -\$1e(a6)`) and hand-rolls it -- `lea \$1000000,a0 / suba.l -\$14(a0),a0` backs off by the ROM size stored at \$FFFFEC, `movea.l \$4(a0),a0` takes the ROM's initial PC, then `reset / jmp (a0)`. Both arms are a COLD boot. It asks the machine rather than doing it: on the Amiga the keyword never returns, and performing a reset here means building a Runtime, which is the thing being torn down -- so the request is recorded on src/amiga/machine.ts and the program ends exactly as System does (InSystem +ILib.s:1849), leaving the frame loop to bring the machine back. NOTE: a program that resets is counted as having ENDED rather than crashed, which is what it did; the census would otherwise report every one as a failure. NOTE: the web player carries the reset out by rebuilding the environment and KEEPING the filesystem, because a reset clears memory and not disks -- and cold and warm do the same thing there, since this port has no reset-survivable RAM for a warm boot to preserve. The distinction is carried rather than synthesised: Craft ships both and its two routines differ by one instruction, `clr.l \$4.w`",
  'turbo text':
    "Routines 343 (\$762a), 344 (\$7630) and 345 (\$7638), and the Guide does not mention this keyword ANYWHERE -- no node, no command list, not even the changelog that at least named the transition family. It is AMOS's own character blitter, `COut` (+W.s:15646), inlined and unrolled: same charset via `movea.l \$aa(a0),a2 / movea.l \$8(a2),a2` (EcWindow +Equ.s:507, then WiFont +Equ.s:686), same eight byte-stores down the rows, and it skips the console -- no cursor, no scrolling, no control codes, no window clip. y is a PIXEL row (`mulu.w d1,d4` against EcTx>>3) bounded to EcTy-8; x must be a MULTIPLE OF 8 and anything else reaches two `rts` in a row and does nothing; a string running off the right is clipped by `move.w d1,d5 / sub.w d3,d5 / subq.w #\$1,d5`. DEFECT: the per-plane decomposition is wrong in two of its four cases. COut has four arms behind the WiColor jump table -- CNorm, CInv (`not.b`), CUn (`st.b`) and CZero (`clr.b`) -- and AMCAF has three, dispatching on the PAPER bit first: `asr.w #\$1,d0 / bcs` sends a plane whose BgPen bit is set to st.b or clr.b by its FgPen bit, and every other plane jams the glyph in, with `lsr.w #\$1,d6` at \$76f8 discarding that plane's pen bit unread. There is no `not.b` in the routine at all. So it agrees with Print only when every pen bit inside the plane mask is set -- Ink 3 on four colours, Ink 15 on sixteen -- and Ink 1 on a four-colour screen paints colour 3. Reproduced. DEFECT: the clip subtracts without checking the sign, so an x at or past the right edge makes the count negative and `dbra` counts down from 65535, poking tens of thousands of characters past the bitplanes. NOT REPRODUCED -- nothing is drawn. NOTE: the fourth argument is dead. Routine 343 pushes 0 for it and 345 pops it into d6, which \$76c4 overwrites with rp_FgPen before anything reads it. NOTE: it walks EcLogic, the plane pointers at offset 0, where COut uses EcCurrent (\$30); on a double-buffered screen those differ",
  'change print font':
    "Routine 141 (\$400c), and at 22 bytes the whole keyword is one store: `Rjsr routine 1121` for the bank address, then `movea.l \$52c(a5),a1 / movea.l \$aa(a1),a1 / move.l a0,\$8(a1)` -- the current screen, its EcWindow (+Equ.s:507), and WiFont (+Equ.s:686), the charset AMOS's console prints with. The manual's *'always 8x8 pixels big and contains 256 characters ... a memory bank of exactly 2 KB'* is exactly how COut reads it, `lsl.w #3,d1 / move.l WiFont(a5),a2 / add.w d1,a2` (+W.s:15661) -- indexed by the raw byte, no LoChar and no control-code exception. The default is `T_JeuDefo`, which WOpen installs on every window it creates (+W.s:13702), so a window opened afterwards goes back to the interpreter's own set rather than inheriting the replacement. It stores the ADDRESS, so poking the bank later changes the printed glyphs; that is reproduced by keeping the bank's own array rather than a copy. NOTE: nothing is checked -- not the 2KB, not the screen pointer. A short bank leaves the console reading past its end on the machine, where here a character past the end prints blank",
  'make bank font':
    "Routine 139 (\$3e78), 246 bytes. *'you can store any amiga font in a memory bank'*, and the font is `movea.l \$52c(a5),a0 / movea.l \$148(a0),a0 / movea.l \$34(a0),a2` -- screen, Ec_RastPort, rp_Font. The container is pinned from both ends, since this routine writes it and routine 140 reads it back: 'FONT' at +0, zero at +4, then the glyph-data, CharLoc, CharSpace and CharKern OFFSETS at +8, +\$c, +\$10 and +\$14, the TextFont itself as \$34 bytes at +\$18, thirty bytes of ln_Name at +\$4c, and the tables from +\$6a. Size is `\$6a + YSize*Modulo + 2*d6` plus another d6 for each of CharSpace and CharKern, where `d6 = (HiChar - LoChar + 2) * 2` -- twice the character count, because CharLoc entries are longs and the other two are words, and the +2 is the extra 'no such glyph' entry every Amiga font carries. The last instruction is `move.w #\$270f,\$36(a0)`: tf_Accessors = 9999, so nothing may ever close it. `moveq #\$3,d1` makes it the only Reserve in the extension that asks for Data AND Chip. DEVIATION: with no Change Font done, rp_Font on the machine is whatever the screen opened with -- topaz in practice -- and this port has no copy of topaz unless the program's own disk carries one, so a null rp_Font serialises the interpreter's built-in 8x8 face instead: same YSize and XSize, different glyphs. NOTE: the thirty name bytes are usually blank, because ln_Name points at dfh_Name in the loadable size file and all eight fonts on the original partition leave that field zero -- the name a program asks by lives in the .font DESCRIPTOR. Reproduced. NOTE: neither \$52c(a5) nor \$34(a0) is tested before it is followed, so on the machine a program with no screen open dereferences null twice; here that is error 23. NOTE: four copied TextFont fields are not modelled and are written as zero -- ln_Type, ln_Pri, mn_ReplyPort and mn_Length -- and routine 140 clears two of them on the way back in",
  'change bank font':
    "Routine 140 (\$3f6e), 158 bytes. It resolves the bank, checks `cmpi.l #\$464f4e54,(a0)` and refuses anything else with error 23, then turns Make Bank Font's stored offsets back into pointers -- which is the entire reason the container exists, because a bank sits at a different address every time it is loaded. It unlinks the embedded Node (`clr.l \$18(a0) / clr.l \$1c(a0) / clr.l \$26(a0)`), re-flags the font `andi.b #\$7d,\$2f(a0) / ori.b #\$1,\$2f(a0)` -- FPF_DISKFONT and FPF_REMOVED off, FPF_ROMFONT on, so nothing tries to free it -- and ends in graphics.library SetFont, `movea.l -\$18ae(a5),a6 / jsr -\$42(a6)`. The CharKern arm reads as broken and is not: `clr.l \$48(a0)` at \$3fd2 runs unconditionally, because the branch above it has no `bra` over it the way the CharSpace arm at \$3fc0 does, so the store four instructions earlier is dead -- but after SetFont the routine goes back for it with `move.l \$14(a0),d0 / adda.l d0,a0 / move.l a0,\$30(a1)`, which is the same address off the live rp_Font. Kerning survives. NOTE: unlike Change Font this one never tests \$52c(a5), so with no screen open the machine follows a null pointer; here it is error 23",
  'change font':
    "Routines 142 (\$4022), 143 (\$402a) and 144 (\$4030) -- two one-line trampolines pushing the defaults, `moveq #\$8,d0` for the height and `clr.l -(a3)` for the style, then the worker. 144 is graphics.library and diskfont.library and nothing else: CloseFont on the RastPort's current face (`jsr -\$4e(a6)`), a TextAttr built at \$422(a2) with ta_YSize, ta_Style and `ta_Flags = FPF_DISKFONT`, OpenLibrary (`jsr -\$228(a6)`) cached at \$374(a2), OpenDiskFont (`jsr -\$1e(a6)`) and SetFont (`jsr -\$42(a6)`). It appends '.font' when the name lacks it, `cmpi.b #\$2e,-\$5(a1) / beq` then five literal bytes -- which the changelog dates: *'Change Font now adds .font automatically, if needed. (Thx Markus)'*. This port's openDiskFont had worked that rule out from other callers and the binary agrees exactly. The two failures are AMCAF's own requester rather than AMOS errors: message 9 for a missing diskfont.library and 10 for a font that will not open. NOTE: message 9 cannot fire here, because diskfont.library is modelled and so never absent, where the real one is a 51,200-byte file on the Fonts disk a program could genuinely be running without. NOTE: `style` is stored into ta_Style and then weighed inside OpenDiskFont, which will accept a near miss; this port's openDiskFont matches on the SIZE alone, so the style is parsed, bounded and ignored",
  'ppfromdisk':
    "Routine 237 (\$5a80), 256 bytes, is a universal loader and not a PowerPacker one. It opens the file (routine 357, failing to 391, error 81), takes its size (359) and reads EIGHT bytes (360, failing to 392 after a close), then branches four ways on the signature: 'PP20' takes the AllocMem-and-decrunch path, 'PX20' is requester 7, 'IMP!' is `Rbra routine 138`, Imploder Load, and anything else is `Rbra routine 104`, Wload -- so the manual's 'a file that is not PowerPacked is taken as it is' is literally a hand-off to another keyword, each arm closing the file first with routine 362 and letting the other one reopen it. DEVIATION: the 'IMP!' arm cannot be reproduced. Imploder Load and Imploder Unpack are AMCAF keywords this port has not implemented and there is no Imploder decoder here to route to, so an imploded file falls through to the raw load Wload would give. The PP20 arm's own Reserve is `moveq #\$0,d1 / move.l (a3)+,d0 / bpl / neg.l d0 / moveq #\$2,d1` at \$5b38 against the literal \"Work    \" at \$5b78 -- a WORK bank, and a negative bank number means the same bank in chip, exactly as Ppunpack does it at \$5a46. An earlier pass reserved a Data bank called \"Amcaf   \" and ignored the sign",
  'object name$':
    "Routine 114 (\$3b20) is sixteen bytes and reads a FIXED offset: `lea \$108(a2),a0 / moveq #\$2,d2 / Rbsr routine 366`, so \$108 is fib_FileName eight bytes into the cached FileInfoBlock at \$100 -- the accessors read whatever Examine Object last described and never take a path of their own",
  'object date':
    "Routine 122 (\$3b74) is twelve bytes: `move.l \$184(a2),d3`. \$184 less the FIB's own \$100 is \$84, 132, which is fib_Date.ds_Days",
  'object time':
    "Routine 124 (\$3b88) is twenty bytes and packs TWO fields into one long: `lea \$18a(a2),a0 / move.w (a0),d3 / swap d3 / move.w \$4(a0),d3`. \$18a is 138, the LOW WORD of ds_Minute, and \$4 past it is 142, the low word of ds_Tick -- so both are truncated to words and the high halves are thrown away",
  'rgb to rrggbb':
    "Routine 91 (\$3304), 50 bytes, and the pair is asymmetric in the way that matters: it puts each 4-bit gun in the HIGH nibble of its byte and leaves the low nibble ZERO. `andi.w #\$f00,d2 / lsl.l #\$4,d2 / lsl.l #\$8,d2` for red, `andi.w #\$f0,d2 / lsl.l #\$8,d2` for green, `andi.w #\$f,d2 / lsl.l #\$4,d2` for blue -- so \$FFF becomes \$F0F0F0 rather than \$FFFFFF, and a round trip through Rrggbb To Rgb is exact only because that one takes the high nibble back out",
  'rrggbb to rgb':
    "Routine 90 (\$32e2), 34 bytes. 'the other 12 bits will be discarded', and the twelve it keeps are the HIGH nibble of each byte: `lsr.l #\$4,d3` then masking \$f, \$f0 and \$f00 out of the successively shifted value",
  'io error':
    "Routine 172 (\$4740) is eighteen bytes around one call, `movea.l \$2b8(a5),a6 / jsr -\$84(a6)`, which is dos.library IoErr(). 'Returns the last dos error code' -- an AmigaDOS number and not an AMOS one, which is what separates this pair from both the AMOS error table and AMCAF's own requester list",
  'bcircle':
    "Routine 353 (\$7dd4), 216 bytes, and an earlier pass had it as a trigonometric sweep that OR-ed pixels in. Three things it is not. It is a PER-SCANLINE circle: `move.l d7,d4 / mulu.w d4,d4` takes r squared once, then for each dy from r down to 0 `move.l d7,d2 / mulu.w d2,d2 / neg.l d2 / add.l d4,d2` gives the remainder and \$7e2a takes its square root by Newton -- a root that does not floor, because `lsr.l #\$1,d2 / addx.l d0,d2` folds the dropped bit back in, so it answers 5 for 24 and 2 for 2 where a floor would answer 4 and 1. It TOGGLES: `bchg.b d0,(a1,d1.w)` is the only write in the routine, so the same circle drawn twice erases itself -- which is what a blitter area fill wants, since it fills between PAIRS of set bits, and it explains the two plots before the loop, which survive the cancellation the four plots produce at dy = 0. At dy = r the same cancellation runs with nothing to undo it, so the very top and bottom pixels of the circle are never drawn. And x is CLAMPED, not clipped -- `cmp.w d3,d0 / blt / move.w d3,d0 / subq.w #\$1,d0` pins anything at or past the width to width-1, leaving a stripe down the last column for a circle off the right edge; y is clipped properly at both ends and a negative x is dropped. A radius of zero is a quiet `addq.l #\$8,a3 / rts`, a negative one is error 23, and so is a plane outside 0..5 or past the screen's depth. NOTE: the row stride is `\$4c(a2) >> 3`, the screen's WIDTH rather than the BitMap's bytesPerRow, and `(a1,d1.w)` indexes it with a WORD -- which is what the string '32K-LIMIT!' sitting at \$7ea2 immediately after the code is about. NOTE: the Newton loop has no bound of its own; the sixty-four-step guard is this port's, and it never bites",
  'disk type':
    "Routine 100 (\$3694), 114 bytes, walks the real DosList: `\$2b8(a5)` is DOSBase, `\$22` its dl_Root, `\$18` the RootNode's rn_Info, `\$4` the DosInfo's di_DevInfo, each a BPTR turned into a pointer by `adda.l a1,a1` twice, and `move.l \$4(a1),d3` off the matching entry is dol_Type verbatim -- 0 a device, 1 an assign, 2 a volume. Names are BSTRs at `\$28` compared with `bclr.b #\$5` on both sides, so the match is case-insensitive. Two checks an earlier pass did not have, which answered 0 for anything matching /^df\\d\$/ and 2 for everything else: the string is truncated to the first colon (`clr.b (a1)` one past it) and the compare then requires `cmpi.b #\$3a,(a0)+` right after the name, so a string with NO colon runs off its end into routine 390, AMOS error 23; and running off the end of the DosList is routine 391, error 81, rather than a guess",
  'disk state':
    "Routine 101 (\$3706) truncates at the colon exactly as Disk Type does and then does the real three-call dance: `Lock(name, -2)` at `-\$54` with `moveq #\$fe,d2` for SHARED_LOCK, `Info(lock, \$168(a5))` at `-\$72` into the extension block's own first bytes, and `UnLock` at `-\$5a`. A failed Lock is routine 391 (error 81) and a failed Info routine 392 (error 94); an earlier pass answered -1 for a name that does not resolve, which is the one case the manual reserves for a drive with no disk in it -- 'If no disk is in the drive, it normally should return -1, but I'm afraid...'. The three answers come off the InfoData: `move.l \$18(a2),d0` against `moveq #\$ff,d1` is id_DiskType against ID_NO_DISK_PRESENT, -1 because moveq sign-extends the byte; `move.l \$8(a2),d0 / cmp.b #\$52,d0` is id_DiskState against ID_VALIDATED, so bit 0 means write-protected OR mid-validation; and `tst.l \$20(a2)` is id_InUse for bit 1. NOTE: nothing modelled here is write protected, mid-validation or in use, so a volume that resolves answers 0. The shape of the test is the routine's; the state it reads has nowhere to come from yet",
  'io error$':
    "Routine 173 is a four-byte `Rbra routine 383`, and 383 (\$a508) opens with a Kickstart check -- `Rbsr routine 372` is `movea.l \$4.w,a0 / move.w \$14(a0),d0`, exec.library's LIB_VERSION, against `cmp.w #\$25,d0`. At 37 or above it calls dos.library Fault() at `jsr -\$1d4(a6)` with an EMPTY header (four zero bytes at \$a562), a 128-byte buffer at \$21b2, and takes the result from \$21b4, two bytes in, because Fault writes ': ' in front of the text even when the header is empty. Below 37 it walks a table of its own at \$a56a: a code byte, a NUL-terminated string, a zero code to end, running to \$a7c6, which is exactly where routine 384 begins. An earlier pass said 'AMCAF ships no strings at all' and listed dos.library codes from memory; it ships twenty-six, and they are now transcribed character for character. DEVIATION: the modelled machine is a Kickstart 3 A1200, so the real routine takes the Fault() arm and dos.library's wording would win where the two differ. There is no Fault() here to call. NOTE: the table omits codes dos.library has, 206 among them, and both arms answer the empty string for anything they do not know -- 'If no error number exists, an empty string will be returned'",
  'ppunpack':
    "Routine 236 (\$59ec), 148 bytes, takes BANK NUMBERS and not addresses: `Rjsr routine 1121` resolves the source and `Rjsr routine 1103` RESERVES the destination, with the name 'Work    ' sitting at \$5a78 immediately after the code. An earlier pass read both arguments as addresses and decrunched in place. The reserved size is PP20's decrunched length, which it keeps in the top three bytes of its last long -- `move.l -\$4(a0,d6.l),d2 / lsr.l #\$8,d2`, d6 being the source bank's own length less sixteen. A NEGATIVE destination is chip memory, the same `bpl.b / neg.l d0` convention Wload uses, here choosing the type it hands Reserve with `moveq #\$2,d1`. The decrunch is powerpacker.library's, `movea.l \$36c(a2),a6 / jsr -\$24(a6)`, which is ppDecrunchBuffer. Four failures, none of which existed: the same bank twice is `cmp.l d0,d7 / Rbeq routine 390`, AMOS error 23; `move.w -\$c(a0),d0 / andi.w #\$c,d0` rejects an icon or sprite bank with requester 4; 'PX20' is requester 7, 'File/bank is encrypted'; and anything else requester 8. NOTE: the kind bits live in the bank header twelve bytes below the data, which this port has no equivalent of, so banks 1 and 2 stand in for the sprite and icon banks by AMOS convention",
  'exchange bob':
    "Routines 212 (\$4f44) and 213 (\$4f8c) are the same 72 bytes apart from the bank they fetch, 1101 against 1102. They swap the whole EIGHT-byte bank entry, image pointer and mask pointer together, and `cmp.l d0,d1 / beq / rts` makes exchanging an image with itself a quiet no-op rather than an error. NOTE: the bound is `cmp.w d2,d0 / Rbhi routine 390` against the image count, an UNSIGNED compare, so image 0 passes it and then `subq.w #\$1,d0 / lsl.w #\$3,d0` indexes eight bytes BELOW the table -- the count word and whatever precedes it. This port raises error 23 for image 0 instead, which is the sane answer and not the routine's",
  'command name$':
    "Routine 340 (\$752c) asks three sources in order. `suba.l a1,a1 / movea.l \$4.w,a6 / jsr -\$126(a6)` is FindTask(NULL); `tst.l \$8c(a0)` is pr_TaskNum, non-zero for a CLI process, and then `\$ac` is pr_CLI and `\$10` of that cli_CommandName, a BSTR. Failing that, `\$2d8(a5)` is AMOS's stored WBStartup, `\$24` its sm_ArgList and `\$4` the first WBArg's wa_Name, a C string. Failing that, `\$424(a5)` plus twelve. The three tails differ only in routine 367 for a BSTR against 366 for a C string. DEVIATION: nothing here records the file a program was loaded from under a name the program itself could have used, so all three sources are empty and this answers empty -- the same nothing Tool Types\$ gives, which keeps the pair consistent",
  'convert grey':
    "Routine 79 is a four-byte `Rbra routine 356`; 356 (\$7f10) is 690 bytes. It sums the three nibbles of the source colour and divides by THREE -- a flat average of R, G and B, not a weighted luma -- through a 192-byte ramp it builds on entry, `moveq #\$3f,d1` passes of `move.b d0,(a0)+ / move.b d0,(a0)+ / addq.b #\$1,d0 / move.b d0,(a0)+`, so entry i is i/3 rounded to NEAREST, the same round-not-floor idiom C2p Fire's table uses. The index is `lsl.w d4,d3` by the DESTINATION's depth less one and then `lsr.w #\$3,d3`, so sixteen colours put white at 15 and thirty-two put it at 30 rather than 31. An earlier pass used the 77/151/28 luma weights, also overwrote the destination's palette with an even grey ramp, which this routine never touches, and wrote the chunky cache before calling `invalidate()` -- which discards pending chunky writes, so the conversion never reached the bitmap at all. Three source paths, chosen once by `move.w \$50(a1),d5 / subq.w #\$1,d5 / cmp.w #\$5,d5` and then `move.w \$48(a1),d0 / btst #\$b,d0`: a six-plane HAM source decodes hold-and-modify inline at \$811c with `move.w \$62(a1),d5` restarting the hold from palette entry 0 on every row, a six-plane non-HAM source is EHB and its colours 32..63 read `\$22(a1,d3.w)` with d3 = colour*2, which is palette[colour-32], then divide by SIXTEEN (`lsr.w #\$4,d3`) for the half brightness, and anything else is a plain lookup at `\$62(a1,d3.w)`. None of the three was modelled. NOTE: the sum can index past the ramp's 192 bytes -- a destination deeper than six planes reads whatever follows \$21b2 in the extension block. The port clamps to the table, which is the port's answer and not the routine's",
  'shade bob planes':
    "'amount sets the number of bitplanes, that should be drawn in and must be a value between 1 and 6' -- the range is the routine's, and it is how a program protects the graphics in the higher planes from a shade bob. NOTE: routine 384 (\$a7c6) LOWERS it again at draw time, walking the screen's plane pointers for the first NULL and doing `addq.w #\$1,d0 / sub.w d0,\$286(a2)`, so a setting of six on a three-plane screen shades three. The port needs no code for that clamp: a value wider than the screen loses its high bits on the way into the bitmap, to the same effect",
  'shade bob up':
    "Routines 286 (\$6644) and 287 (\$67e2), 414 and 410 bytes, sharing routine 384 (\$a7c6) for their set-up. The bump is a bit-serial ripple carry across the planes and it is the ONE place the pair differs: both do `eor.w d1,d0 / move.w d0,(a1)` for the sum bit, then Up propagates `and.w d2,d1` against the OLD word and Down `and.w d0,d1` against the NEW one -- a carry and a borrow, an add and a subtract of one. `dbra d5` over Shade Bob Planes planes, so it WRAPS within them rather than saturating. DEFECT: the hot spot X is truncated to a signed byte and the hot spot Y is not. Routine 384 reads the two adjacent header words alike and sign-extends only one, `move.w \$6(a1),d0 / ext.w d0` against a plain `move.w \$8(a1),d0` (\$a80c really is 48 80). Bob images are usually under 128 wide so a hot spot inside the shape never shows it; on a wider one a hot spot X of 160 reads as -96 and the shade lands 256 pixels right of where every other AMOS command puts the same bob. Reproduced. NOTE: clipping is by whole words left and right and whole rows top and bottom, with a barrel shift at \$67a0 for an x that is not a multiple of 16 -- the net effect is an exact clip to the screen, so `point`/`putPixel` give it without the shifter. NOTE: neither the RastPort clip nor Set Planes is consulted, the routine walking the screen's plane pointers itself, which is why this is the one drawing keyword here built on `putPixel` rather than `plot`",
  'shade bob mask':
    "Routine 284 (\$6610) normalises to 0 or 1 rather than storing the argument, so any non-zero value means the same thing. 'Either the mask or the first bitplane of the object is used' -- the first bitplane is literal, routine 384 setting a5 to the image record plus ten (past the five-word header) and the draw reading it a word at a time, which lands on plane 0 of every row because bank images are stored plane by plane and not line-interleaved. NOTE: the mask arm falls back. `tst.w \$284(a2) / beq` then `move.l \$23e(a2),d0 / beq` reads the mask pointer out of the image's eight-byte bank entry, and a zero one drops through to the first bitplane -- AMOS builds masks lazily, so a program that sets the flag before the bob has ever been drawn gets the other behaviour. This port has no lazy mask to be missing and reads any non-zero pixel, which is what a built mask holds",
  'ptile bank':
    "Kept for the manual's own assessment of the feature, which is unusually candid: 'Actually, you should not read this command description. The Ptile commands seem to be only of very low use and are rather uninteresting for you'",
  'count pixels':
    "Routine 92 (\$3336), 158 bytes. Note the sense, which the manual states and the name hides: it 'Counts the pixels ... that DON'T have the colour index colour'. A caller measuring how much of a region is painted passes the background colour. The far corner is EXCLUSIVE, which an earlier pass had inclusive: `sub.w d4,d6 / subq.w #\$1,d6` and then `dbra d6` runs x2-x1 times from x1, covering x1..x2-1, and the same for y. And because `sub.w d4,d6 / Rbeq routine 390 / Rbmi routine 390` runs before any of that, an EMPTY box is AMOS error 23 rather than a count of nothing, and a reversed one is an error too -- the port returned 0 for both. The colour is compared as a BYTE (`move.b d2,\$2(a7)` on the way in, `cmp.b \$a(a7),d0` in the loop, the offset differing because `movem.w d0-d1/d4-d5,-(a7)` has pushed eight bytes by then), so anything above 255 wraps into range. NOTE: the routine has no clipping whatever -- it walks plane memory from `y1 * (\$4c >> 3)` with no test against the screen, so a region off the edge counts whatever is next in memory; skipping out-of-range points is the port's, not the routine's. NOTE: a screen number that does not resolve fails inside `L_SaveBMHD`, which raises AMOS's own screen error rather than the 23 the port raises here; the distinction is unverified and shares the standing question about \$52c(a5) error numbers",
  'mask copy':
    "THREE token entries and three routines. The table carries `!mask copy` (id \$086c, spec `I0t0,0`, routine 174) and two empty-named continuations, `I0,0,0,0,0t0,0,0,0` (routine 175) and `I0,0,0,0,0t0,0,0,0,0` (routine 176) -- an earlier pass implemented only the middle one, made its mask optional and never parsed the minterm. All three end in the same OS call, `movea.l -\$18ae(a5),a6 / jsr -\$27c(a6)`, which is graphics.library's BltMaskBitMapRastPort, with a0 = the source's BitMap (\$150), a1 = the destination's RastPort (\$148), a2 = the mask, d0/d1 = xSrc/ySrc, d2/d3 = xDest/yDest, d4/d5 = xSize/ySize and d6 = the minterm. 'just like Screen Copy. However, a mask bitplane can be given', so a set mask bit lets the source pixel through and a clear one leaves the destination alone. Routine 174 (\$4756) is the whole-screen form: it zeroes all four coordinates and takes the sizes from the source with `move.w \$4c(a0),d4 / move.w \$4e(a0),d5`. Routine 175 is twelve bytes -- `moveq #\$0,d0 / move.b #\$e0,d0 / move.l d0,-(a3) / Rbra routine 176` -- pushing the DEFAULT MINTERM \$E0 and falling into the ten-argument form, so the nine- and ten-argument spellings are one routine with one optional trailing minterm. Routine 176 sizes the blit with `sub.l d0,d4 / sub.l d1,d5`, so the far corner is EXCLUSIVE as it is in Count Pixels, Coords Read and Bzoom. DEVIATION: a minterm other than \$E0 is not reproduced -- which of A, B and C carries the mask, the source and the destination is decided inside BltMaskBitMapRastPort, not in this binary, and the AROS material available here is a partial checkout with no rom/graphics sources, so there is nothing to verify a general minterm against; the \$E0 behaviour is implemented for every value. NOTE: `maskaddress` is a raw pointer into a caller-built bitplane; where it resolves to memory this port can read the mask is honoured, and where it does not the copy is unmasked -- the same picture an all-ones mask gives. Its stride is the SOURCE bitmap's and it is indexed by the source coordinates, which follows from the autodoc's 'mask plane of same dimensions as the source bitmap' rather than from the AMCAF binary, which only passes the pointer through; an earlier pass indexed the mask's rows from zero while indexing its columns from x1, registering the mask with the source only when y1 is 0",
  'bzoom':
    "Routine 352 (\$7b56), 638 bytes. 'the graphics are double, four times or eight times as wide and from 1 to 15 times as high'. The rounding is the blitter showing through and the manual spells it out: 'The coordinates x1 and x2 are rounded down to the next multiple of eight, x3 is even rounded to the nearest multiple of 16'. An earlier pass had the two nibbles of the factor THE WRONG WAY ROUND. The routine validates the mode before it touches any other argument, which is what settles it: `move.l (a3)+,d0 / Rbmi routine 390` rejects a negative one, `andi.w #\$f0,d0 / tst.w d0 / Rbeq routine 390` then `lsr.w #\$4,d0 / subq.w #\$1,d0 / move.w d0,\$342(a2)` stores the HIGH nibble minus one -- read back as `move.w \$342(a2),d1` for the count of extra times each finished destination ROW is copied, so the high nibble is the VERTICAL multiplier, 1 to 15 -- and `andi.w #\$f,d1` with four `cmp.w`s and an `Rbne routine 390` stores the LOW nibble at \$340(a2), which selects between four whole code paths: 1 is `move.b (a4)+,(a5)+`, 2 indexes a 256-word table at \$eb2(a2), 4 a 256-long table at \$10b2(a2), 8 a table of long pairs at \$14b2(a2). So the low nibble is the HORIZONTAL one, and only 1, 2, 4 and 8 exist because each needs its own bit-stretching table -- the three tables being contiguous (\$eb2 + 256*2 = \$10b2, + 256*4 = \$14b2) is what confirms the reading rather than merely fitting it. None of the three validations was reproduced before. Both far corners are EXCLUSIVE: `sub.l d3,d5 / subq.l #\$1,d5` and `sub.l d2,d4 / lsr.w #\$3,d4 / subq.w #\$1,d4` are dbra counts, so the copy is (y2-y1) rows of (x2-x1)/8 bytes from x1,y1. DEVIATION: those same `subq`s are why a degenerate box does not error -- a zero extent underflows to \$ffff and the dbra runs 65536 times, scribbling far past both bitmaps. The port does nothing instead; that is not what the routine does and it is not something this port can reproduce. NOTE: the masks are `andi.w`, clearing the low bits of the WORD and leaving the high word, so they are `& 0xff8` and `& 0xff0` rather than `& ~7` and `& ~15` -- which differ for a negative coordinate, where -8 becomes 4088. Reproduced. NOTE: the plane count is `move.w \$50(a0),\$334(a2)` off the SOURCE and six plane pointers are loaded for each screen regardless, so a destination shallower than the source is written past the end of its planes; the port masks to the source's depth instead, which also preserves a deeper destination's upper planes as the routine does. There is no clipping at either end",
  'c2p convert':
    "Routine 78 (\$3036) is a 66-byte front-end; routine 382 (\$9d0c) is 2044 bytes of converter. Undocumented beyond the changelog, which credits it: 'New c2p routine by Mikael Kalms. Up to 20%-80% faster'. All SIX arguments are required -- the spec is `I0,0,0t0,0,0` and routine 78 pops six longs with no short-form entry pushing defaults, so the offsets an earlier pass made optional cannot be omitted. Two gates run before any work: `movea.l \$4.w,a0 / move.w \$128(a0),d0 / btst #\$1,d0` is AFB_68020, failing to requester message 19 ('MC68020 or higher required!'), and `move.w \$50(a0),d4 / cmp.w #\$4,d4 / bge` is the screen DEPTH, failing to message 18 ('At least 4 planes required!'); neither was checked. Then routine 382's own entry tests, every one of which branches to \$a0ba -- `movem.l (a7)+,d2-d7/a2-a6 / rts`, a plain return, so bad arguments do NOTHING and are not an error: `andi.w #\$1f,d4` requires a width that is a multiple of 32, `andi.w #\$7,d5` an x offset that is a multiple of 8, `move.w d0,\$0(a2) / beq` and `move.w d1,\$2(a2) / beq` reject a zero width or height, and `lsl.w #\$3,d4 / sub.w d0,d4 / bmi` rejects a width wider than the bitmap. And the part that was simply wrong: `movem.l \$8(a1),a3-a6` loads FOUR plane pointers out of the BitMap, so the converter writes planes 0-3 and only the low nibble of each source byte -- which is what the depth gate guards, and it means a deeper screen keeps whatever planes 4 and up already held. The port wrote whole pixel values through every plane. NOTE: the 68020 gate cannot fire here, because the modelled machine is an A1200 and Cpu answers 68020 for the same reason. NOTE: `oy` is never range-checked and `ox` is added to the row offset after the width check, so the real routine runs off the end of the bitmap or into the following row; the port's bounds test is the port's, not the routine's",
  'blitter fill':
    "Routine 74, and the manual is the specification of the chip's area-fill mode: 'It does only fill the gap between two dots of a horizontal line. Therefore the limiting lines may only be one pixel th[ick]. These lines can be either created using Turbo Draw or Bcircle.' That sentence is what `fillRow` in ../amiga/blitter.ts implements, and it is the oracle that module was waiting for -- the seam was left open there precisely because which boundary bit a fill keeps cannot be written from memory. ONE BITPLANE at a time, which is why the plane is an argument. Routine 75 (\$2e5c) is the form with a region, and it shares its decode with Blitter Clear and Blitter Copy Limit -- see 'blitter clear' for it: x word-granular in both directions, y2 EXCLUSIVE, and a quiet `addq.l #\$8,a3 / rts` on an empty one. An earlier pass worked in whole pixels with both corners inclusive",
  'x raster':
    "'This function returns the current X position of the raster beam in hardware coordinates.' The manual is candid about the value: 'This value is not very accurate because the raster beam is very fast, sigh'",
  'scrn rastport':
    "Routines 279 to 283 are the same eighteen-byte routine five times: the current screen from \$52c(a5), `Rbeq routine 394` when it is null, then one fixed offset and nothing else -- RastPort \$148, BitMap \$150, LayerInfo \$140, Layer \$144, Region \$14c. 'Here are some more commands for Assembler and C freaks' -- a program gets the address of the current screen's structure to poke directly. NOTE: this port has a RastPort and a BitMap as objects rather than bytes at an address, and models no Layer or LayerInfo at all. Returning a plausible pointer would invite exactly the poking the manual warns about, into memory whose layout is not the machine's, so these answer 0 -- which a program checking before use reads as 'not available'. APPROXIMATED in the value. The guard is a separate matter: routine 394 is AMOS error 47 'Screen not opened', and with no screen open a program does get an error rather than a 0 -- but it is the CORE's, raised when the current screen is read, not the extension's. NOTE: the `amcafScreenErr` written for these is therefore unreachable as things stand, and whether the core's closed-screen error should become error 47 here is unsettled -- it needs the core's screen accessor looked at, since every extension reading \$52c(a5) has the same question",
  'ham colour':
    "Routine 161 (\$440a), 82 bytes. HAM6's control byte decoded against the previous pixel: 00 take the palette entry whole, 01 replace BLUE, 10 replace RED, 11 replace GREEN, with the low four bits as the new component. That is why the manual describes it as 'the colour value that is created, when plotting a pixel in colour c directly behind the last point'. The routine does NOT decode it as two bits and a nibble, though: it is a chain of unsigned WORD compares (`cmp.w #\$f` / `#\$1f` / `#\$2f`) whose last arm is an open `else` rather than a fourth range, so the control is not confined to 0..63. An earlier pass masked with `& 63` and diverged above that -- the green arm's shift is `lsl.b #\$4`, a BYTE, so a control of 64 becomes 64-48 = \$10 and shifts clean out of the byte for a green of 0, where the mask turned 64 into 0 and read palette entry 0 instead. The pops also settle the argument order: `move.l (a3)+,d3` takes the second argument and `move.l (a3)+,d0` the first. NOTE: only the palette arm touches the screen, guarded by `Rbeq routine 394` (error 47); that guard is not reachable here because reading the current screen raises the core's own error first, the same unsettled question as the Scrn pointers",
  'ham best':
    "Routine 162 (\$445c), 318 bytes. The inverse search: 'As you cannot achieve the desired colour by plotting only one pixel in [HAM]' it picks the closest control byte, and a caller walking a scanline feeds each answer back as the next oldrgb. An earlier pass had the search itself wrong in two ways. It does NOT try all 64 controls -- there are nineteen candidates, the sixteen palette entries plus one per modify arm, because a modify arm has only one sensible nibble and the routine builds each candidate directly (`move.w d6,d4 / andi.w #\$f00,d4 / move.w d7,d0 / andi.w #\$ff,d0 / or.w d4,d0` is the RED arm, the wanted red over the previous green and blue). And it does not measure with a sum of squares: `lea \$458a(pc),a2` then three `move.b (a2,dn.w)` on the absolute per-gun differences is Best Pen's weight table, whose sixteen bytes are identical to the copy routine 83 carries at \$3170. Order decides ties, which go to whoever is measured LAST since every comparison is `cmp.w d0,d5 / blt`: palette 15 DOWN to 0 (`lea \$82(a1),a0`, `move.w -(a0),d0`, `dbra d4` from \$f), then RED (\$20), GREEN (\$30), BLUE (\$10) -- so a palette tie goes to the lower index and a palette-versus-modify tie goes to the modify. An exact match returns at once. `cmp.w d6,d7 / beq` short-circuits before the palette is read, so asking for the colour already shown gives control 1 with the blue already in place rather than a palette index that matches. NOTE: that shortcut is `move.l d6,d3` narrowed by word operations, so it is the one path that leaks the argument's high word into the result; and the routine reads \$52c(a5) with no guard, so the port's fallback palette is unreachable for the same reason as Ham Colour's",
  'ham point':
    "Routine 160 (\$4312), 248 bytes. The colour a HAM pixel actually shows, which needs the line before it: 'Ham Point can access any point on the screen indiviually without preprocessing'. `move.l (a3)+,d7` takes the last argument and is then multiplied by the row length, so d7 is y and the d6 popped after it is x. DEVIATION: the manual says 'If the point x,y is not on the screen, rgb will contain -1' and it does not -- both guards land on the same three instructions, `moveq #\$0,d3 / move.w (a0),d3 / moveq #\$0,d2 / rts` with a0 = \$62(a1), so an off-screen read answers the RGB of palette entry 0. There is no -1 anywhere in the routine; on a screen whose colour 0 is black it reads as 0, which is presumably how the manual's claim survived, and an earlier pass took the manual's word for it. The routine scans BACKWARDS from x carrying a mask in d0 of which nibbles are settled, stopping once `cmp.w #\$fff,d0` says all three are, and takes any nibble still unset at the left edge from palette entry 0 -- scanning forwards reaches the same colour, since each nibble is set by the last pixel at or before x that writes it, so the direction is a cost difference only. NOTE: two things are deliberately not reproduced. The routine reads six plane pointers (\$0/\$4/\$8/\$c/\$10/\$14 of the screen) unconditionally, so on a shallower screen it btsts through whatever those slots hold, where the chunky read here yields a control of 0. And both bounds are `cmp.w` against \$4c/\$4e after only the LONG's sign has been tested, so a coordinate of 65536 passes as 0 and one of 32768 passes as negative and then indexes far outside the bitmap; the full-width check is kept rather than reproducing an out-of-bounds read",
  'ham fade out':
    "Routine 163 (\$459a), 156 bytes. 'darkens the screen by one single step. After calling it 16 times, the Ham screen is completely black.' The manual explains the asymmetry: 'Technically, it's not possible to fade in a ham screen without enormous processor power, but for fading out, a modified Shade Bobs routine is' enough -- darkening is monotone and needs no search. An earlier pass implemented only half of it. `move.w \$48(a0),d0 / btst #\$b,d0 / Rbeq routine 390` makes a screen that is not HAM an ERROR rather than a no-op, and there was no check at all. The palette loop is `moveq #\$f,d7`, sixteen entries and not the whole palette, each gun decremented only if non-zero. And then the missing half, which is what 'a modified Shade Bobs routine' actually refers to: the MODIFY NIBBLES in the bitmap darken too. `move.l (a5)+,d0 / or.l (a6)+,d0` asks whether the pixel is a modify (planes 4 or 5), `move.l (a1),d1` or-ed with planes 1-3 asks whether its nibble is non-zero, `and.l d1,d0` keeps only pixels where both hold, and then `eor.l d0,d2 / move.l d2,(a1)+ / and.l d2,d0 / eor.l d0,d3 ...` is a bitwise 4-bit decrement with borrow across planes 0-3. Fading only the palette leaves every modify pixel at its original brightness, so the manual's sixteen-calls-to-black would not have held on a picture that uses any. NOTE: the bitmap walk is a flat longword count, `((\$4c(a0) >> 5) * \$4e(a0))`, so on a screen whose width is not a multiple of 32 it covers less than the bitmap and drifts out of step with the rows; that is reproduced as-is, since a plane's pixel order is the chunky cache's pixel order while the row length is a whole number of bytes",
  'set rain colour':
    "Changes a rainbow's colour index, which 'remove[s] the irretating limit to the first 16 colours'. DEVIATION: the manual's other use -- 'A colour index of -63 enables you to alter the hardware scrolling register, so you can create fancy water and wobbel effects' -- is a copper poke at a register this port reaches through the display list rather than by address, so the index is stored and the scroll case is not reproduced",
  'pt continue':
    "Routine 266 (\$616e) is stricter than the port had it: `move.l \$2bc(a2),d0 / Rbeq routine 390` makes continuing with nothing ever played an ERROR rather than a no-op, which matters because Pt Stop -- its counterpart -- deliberately IS a no-op, a fix the changelog records. The two are not symmetric. It then does `cmp.l #\$200000,d0 / Rbge routine 390`, Pt Bank's chip-RAM check again, carrying the same DEVIATION: this port models memory type as a flag on the bank rather than as an address, so that comparison is not reproduced. Which of routines 376 and 377 it ends in depends on \$296(a2), the CIA-versus-VBL flag, so the two timings resume through different code",
  'pt voice':
    "Routine 262 (\$60a2) sets all four per-voice bytes to \$FF first (`moveq #\$ff,d1 / move.l d1,\$a(a0)`) and then CLEARS the ones whose mask bit is clear, silencing each with `move.w #bit,\$96(a1)` on DMACON and `clr.w` on that voice's AUDxVOL at \$a8/\$b8/\$c8/\$d8. So a set bit means the music may use the voice, and a clear bit both silences it THERE AND THEN and releases it -- the port recorded the mask and left the audio running, which is the difference between `Pt Voice %0011` freeing two channels mid-tune and doing nothing audible at all. Pt Free Voice reads the same four bytes back",
  'jd star joker on':
    "Routines 11 (\$2ba) and 12 (\$2ca), sixteen bytes each: `movea.l \$2b8(a5),a0` for DOSBase, `movea.l \$22(a0),a0` for dl_Root, then `bset.b #\$18,\$34(a0)` -- rn_Flags bit 24, RNF_WILDSTAR -- with `bclr` for Off. NOTE: this is AmigaDOS's GLOBAL flag and not the extension's own, so it lives on Machine here and LDos's Lmatch reads the same field; a program that turns the star on for Jd Match turns it on for every pattern parse on the machine, which is what one RootNode means. `bset` on memory is byte-sized and takes its bit modulo 8, so bit 24 of the longword is bit 0 of the byte at +\$34",
  'scanstr$':
    "Routine 278 (\\$63c8) reads a table of 105 NUL-terminated strings at \\$63f8..\\$65b6 -- the extension's own data, now extracted rather than invented. An earlier pass here concluded AMCAF shipped no table, having searched the hunk for 'Space', 'Escape' and 'Return': the names are German and lower case ('space', 'F 1', 'l-amiga', 'caps lock', '\\u00df'), so the search was looking for the wrong strings and its silence was read as absence. DEFECT: ten codes have an EMPTY entry (12, 14, 28, 44, 59, 71, 72, 73, 75, 104) and the routine refuses them with `tst.b (a0) / Rbeq routine 390`, AMOS error 23, where the manual promises an empty string for a code with no name; the library contradicts its documentation and this port follows the library. The range check is unsigned -- `cmp.w #\\$67,d0 / Rbhi routine 390` -- so a negative code errors on the same arm rather than indexing backwards",
  rnp: "The dead half of the RNC pair -- the author removed the two commands, put them back, and removed them again, but the tokens had to stay because deleting one shifts every later token id. 1.50's routine 277 (\\$63c6) is a bare `rts`: no prologue, no body, so it hands the caller whatever the result register happened to hold at the call. 1.40's routine 263 (\\$64f2) is the same behind the shareware guard, `tst.w -\\$16(a5) / Rbmi routine 144`, and that arm is a `moveq #\\$0,d0` -- so an unregistered 1.40 answers 0 and everything else answers a stale register. DEVIATION: this port answers 0 always, which is 1.40's demo path exactly and the only defined value available for the other case. Rnc Unpack is the same story and needs no note: it pops both its arguments and returns, and so does the port, which makes a stub reproduced as a stub",
  'amcaf version$':
    "Routine 19, and the string IS in the binary -- an earlier pass reported the hunk held no printable text at all and was looking in the wrong place. Four instructions and then the literal with its length word: 1.40 at \$2176 answers **'AMCAF Erweiterung V1.40 26-Dec-95 von Chris Hodges.'** and 1.50 at \$22d8 **'AMCAF extension V1.50beta4 11-Jan-98 by Chris Hodges.'** -- the shareware build in GERMAN and the freeware final in English, the same split the demo guards showed. DEVIATION: one body of code serves both releases here and the token tables carry no registry id, so this cannot tell which was bound and answers with 1.50's. The port's own 'AMCAF 1.50' was never on any machine",
  'smouse speed':
    "Routine 170 (\$46e2) is not a plain store. The pointer's position is held pre-shifted, so changing the factor RESCALES it -- `asr.w d3,d0` by the old shift and `asl.w d4,d0` by the new, on both axes -- which keeps the pointer where it is rather than jumping it. Nothing bounds the value, so the manual's 'higher values than 4 are not sensible' is advice rather than a check. NOTE: no test pins the rescale, because nothing in a headless run moves a second mouse and zero rescales to zero",
  'splinters bank':
    "Routines 288 (\$697c) and 304 (\$6d84) are twins. Both check the COUNT and not the bank number -- `move.l (a3)+,d2 / Rbeq routine 390` refuses a zero amount before anything else -- and both take the per-entry size from a `mulu.w`: \$16 for a splinter, \$c for a star. The eight-character bank NAMES are literals in the binary, `Splinter` and `Stars   `, where the port had invented `TdStars `. A Reserve that comes back empty is error 24, and each stores `amount - 1` as the loop bound, which is why every walk of the table is a `dbra`",
  'splinters colour':
    "Routine 294 (\$6a38): the plane count is bounded against the CURRENT SCREEN rather than against six. `move.w \$50(a1),d0` is the depth and `subq.w #\$1,d2 / cmp.w d2,d0 / Rble routine 390` refuses anything above it, with no screen open at all giving error 47 first. Nothing bounds it below, and `planes - 1` is what gets stored",
  'shade pix':
    "Routine 223 (\$5180) is EIGHT BYTES -- `moveq #\$6,d0 / move.l d0,-(a3)` and a branch into routine 224 -- so the plane count is a hardcoded SIX, not Shade Bob Planes and not an argument. The token table agrees at `I0,0`; an earlier pass gave it an optional third parameter and read the Shade Bob setting when it was absent, which made Shade Bob Planes look as if it applied here. The worker is a ripple adder rather than an arithmetic increment: per plane, `btst` the bit, `bclr` and carry on if set, `bset` and stop if not. The manual's 'if the highest colour is reached, the colour is resetted to be cycled' falls out of that, and so does the early stop -- `move.l a0,d0 / beq` bails on a null plane pointer, so a screen with fewer than six planes carries only as far as it has",
  'paste ptile':
    "Routine 270 (\$61e0), and the bank format is PLANAR where an earlier pass read it as chunky. The opening reads two header words -- `cmp.w (a0)+,d7` against the tile COUNT, then `move.w (a0)+,d0` as planes-1 -- and `lsl.l #\$5,d7` with a `dbra` accumulation makes a tile 32 bytes per plane, sixteen rows of one word, with its planes contiguous. The paste is an unrolled `movem.w (a1)+` into `movea.l (a0)+,a2` down the screen's own plane pointers: opaque, no mask, no write mode. NOTE: the count check is `Rbge`, which is SIGNED, so a negative tile number passes it and indexes backwards out of the bank. The manual's own view of the feature is worth keeping: 'Actually, you should not read this command description. The Ptile commands seem to be only of very low use and are rather uninteresting for you'",
  'fcircle':
    "Routine 350 (\$7afa) is TEN BYTES: `move.l (a3),-(a3)` to duplicate the radius on the argument stack, then straight into Fellipse (351). Neither takes a COLOUR -- routine 351 pops exactly four longs into d0-d3 and hands them to `jsr -\$ba(a6)` on GfxBase, `AreaEllipse(rp,xc,yc,a,b)`, followed by AreaEnd at -\$108, so the fill uses the RastPort's FgPen and AreaPtrn, which is AMOS's Ink and Set Pattern. The token table agrees: `I0,0,0` and `I0,0,0,0`. An earlier pass read the last argument of each as a colour, which is one too many for Fcircle and made Fellipse's `b` the colour",
  'turbo plot':
    "Routine 348 (\$7a16). 'Added clipping for Turbo Plot, Shade Pix and Turbo Point. Now they are as secure as the normal Plot and Point commands' (V1.30 changelog) -- and the clipping is only that: `bmi` on each coordinate and a compare against the screen's own \$4c and \$4e. An out-of-range point is a SILENT no-op. 'Fast' means it bypasses the RastPort: the loop is `movea.l (a0)+,a1` down the plane pointers with `bset.b`/`bclr.b` chosen by `btst.l d1,d0` on the colour, so it honours neither Gr Writing, nor the plane mask, nor the Clip -- all of which the port's rp.plot obeys. NOTE: the row stride is `lsr.w #\$3` of the WIDTH, truncating where a real BitMap rounds up to a word; every AMOS screen is a multiple of sixteen wide, so nothing reachable disagrees",
  'turbo draw':
    "Routines 346 (\$7760) and 347. The five-argument form is thirty bytes that look the default plane mask up and fall into the six-argument one. DEFECT: that table at \$7778 is SIX bytes -- `01 03 07 0f 1f 3f` -- indexed by `depth - 1`, and `move.b -\$1(a0,d1.w),d0` with a depth of 7 or 8 reads the two bytes after it, which are the first half of the next routine's `movea.l \$168(a5),a2`: \$24 and \$6d. So on an AGA screen the default mask is 36 or 109 rather than 127 or 255 and the line comes out in the wrong colour. Reproduced. A plane mask of ZERO draws nothing: routine 347 opens `move.l (a3)+,d6 / bne` and the fall-through skips the five remaining arguments",
  'font style':
    "Routine 145 (\$40fe), seven instructions: the current screen, its RastPort at \$148, `rp_Font` at \$34, then `move.b \$17(a1),d3`. The manual says it 'replaces the AMOS function Text Styles, because this one does not return the multicoloured font bit (Bit 6)'. DEFECT: it reads the wrong byte, by one. AMOS's Text Styles is `move.b 56(a1),d3` off the RASTPORT (FnTextStyle, +Lib.s:9896) -- rp_AlgoStyle -- and the colour-font bit is FSF_COLORFONT, bit 6 of **tf_Style** at TextFont+\$16. \$17 is **tf_Flags**: ROMFONT/DISKFONT/REVPATH/TALLDOT/WIDEDOT/PROPORTIONAL/DESIGNED/REMOVED. So it never reports a style at all and Set Text cannot move it; bit 6 there is FPF_DESIGNED, set on essentially every real font, which is presumably why the off-by-one survived three years of releases -- the bit the manual promises always looks set. Reproduced",
  'amcaf aga notation on':
    "Routines 80 (\$307c) and 81 (\$3088), twelve bytes each, each a single `move.w #n,\$2d2(a2)`. The manual: 'After calling Amcaf Aga Notation On, all AMCAF commands and functions take 24 bit values... The default setting is 12 bit.' DEFECT: the two are the wrong way round. `On` writes 4 and `Off` writes 8; the readers (`cmp.w #\$4,d0`) take 4 as the 12-bit path; and the extension's own init routine writes 4 as well -- the sequence at \$1eba. So `On` sets the mode it was already in and does nothing, and `Off` is the only way to reach 24-bit. Reproduced. NOTE: 'all AMCAF commands and functions' is wrong too -- the flag is read from exactly three addresses in the whole hunk, and they are Red Val, Green Val and Blue Val, so the manual's careful exception for the two conversion functions is redundant",
  'red val':
    "Routines 87 (\$327a), 88 (\$329a) and 89 (\$32c0) are the only readers of the notation flag in the hunk, and each opens `move.w \$2d2(a2),d0 / cmp.w #\$4,d0`. At 4 they take a nibble each -- Red is `lsl.l #\$8` then a clear-and-swap, which is a shift right by eight -- and at anything else a byte each. Nothing checks that the argument fits",
  'glue colour':
    "Routine 86 (\$3260), and it does NOT consult the notation flag: `moveq #\$f,d0` then an `and` per gun, so every component is masked to four bits and the answer is 12-bit whatever Red Val would have been reading",
  'best pen':
    "Routines 82 (\$3094) and 83 (\$30aa). The short form is six instructions that push 0 and `(1 << depth) - 1` and fall into the ranged one, so the two are the same search; both bounds are checked against 63 and the high one against the low. Two things the port was guessing. The METRIC is a sixteen-byte lookup table at \$3170 -- `0 1 3 5 8 12 16 20 30 40 50 60 70 80 90 100` -- indexed by one gun's absolute difference and summed over three, not a squared distance: shallower than a square below 4 and much steeper above 7, so it forgives being a little wrong everywhere and punishes being badly wrong in one gun. And pens 32-63 are EXTRA HALF-BRITE: `cmp.w #\$1f,d6 / bls` sends a higher index to `move.w -\$42(a0),d0 / andi.w #\$eee / lsr.w #\$1`, the entry 32 lower halved, so a full-range search weighs 32 colours that are not in the palette. A tie takes the LAST pen (`cmp.w d0,d4 / blt` skips only on a strictly better incumbent) and an exact match returns without finishing",
  'pal set':
    "Routines 337 and 338 (\$74b4, \$74e6). 'Palnr must be range from 0 to 7' and the routine agrees, but the INDEX bound is the one the manual leaves out and an earlier pass got wrong: `cmp.w #\$20,d1 / Rbge` is THIRTY-TWO, not 256, and the address arithmetic confirms it -- `pal*64 + index*2` into a 512-byte block at \$4aa(a2), eight palettes of 32 words. Pal Get Screen and Pal Set Screen (335, 336) copy `moveq #\$f,d7` LONGWORDS, which is the same 32 colours, so on a 64- or 256-colour screen they save and restore only the bottom of the palette. Pal Set Screen ends with a View; Pal Get Screen does not",
  'pal spread':
    "Routine 334 (\$736a). `cmp.w d6,d7 / bgt` with an `exg` pair behind it SWAPS the two ends when they arrive the wrong way round -- and the test is `bgt`, so EQUAL pens swap too and the single entry a zero span writes is the SECOND colour. Each gun is worked at double scale and halved with the carry added back (`lsr.w #\$1,d1 / addx.w d2,d1`), so both halves round to nearest before being summed, and the sum is clamped to 15 because two separately rounded halves can add to 16. Both pen numbers are bounded at 32, and it ends with a View",
  'rain fade':
    "'Rain Fade works step by step only. Therefore you need a maximum of 16 calls to reach the new colour values' -- one unit per channel per call, the same ramp Ham Fade Out uses",
  'object protection$':
    "Routine 127 (\$3bb0), and note the argument: it takes the NUMERIC VALUE, not a path, and unlike its neighbours never touches the FileInfoBlock -- 'converts this numeric value into a string in the format hsparwed'. The table is twelve bytes at \$3be0, `dewr----apsh`, read with `move.b (a1,d0.w)` when the bit is CLEAR and `move.b \$4(a1,d0.w)` when it is SET, d0 counting 7 down to 0. The two halves overlap on the four hyphens, which is how one table serves both the inverted low four bits and the plain high four",
  'examine dir':
    "Routine 109 (\$3a32). It opens `Rbsr` into Examine Stop, so a second walk closes the first rather than leaking its lock, then `Lock(name,-2)` -- SHARED -- and `Examine()` into the FileInfoBlock at +\$100 of its own block. It ends with a check nothing documents: `tst.l \$4(a2) / bmi` on fib_DirEntryType, so a plain FILE is locked, examined and then thrown away as error 94 rather than read as an empty drawer",
  'examine object':
    "Routine 112 (\$3ad6), Examine Dir's twin with the lock released immediately -- which is why it works on a file as happily as on a directory and leaves a walk in progress alone. Lock failing is error 81 and Examine failing error 94",
  'examine next$':
    "Routine 110 (\$3a80). 'If the end of the directory list is reached, file\$ will contain an empty string and the drawer will be closed', so the walk cleans up after itself. With no lock held it is error 23, which is the manual's 'you may not make any further calls to Examine Next\$' made enforceable. `ExNext` succeeding tail-calls straight into Object Name\$ (`Rbne routine 114`), so the name it returns and the accessor's are the same instruction, and the whole FileInfoBlock is left describing the entry",
  'examine stop':
    "Routine 111 (\$3ab6): `UnLock` the lock at \$37c and clear it, wrapped in a `movem.l` of everything it touches. It is written to be called as a subroutine, which Examine Dir and Examine Next\$ both do, and it is idempotent -- a `beq` takes it past the UnLock when nothing is held",
  'object type':
    "Routines 114 to 129 are each three or four instructions reading a fixed offset of the FileInfoBlock the last Examine filled in: Type \$104 (fib+4, fib_DirEntryType raw), Name\$ \$108, Protection \$174, Size \$17c, Blocks \$180, Date \$184, Time the low words at \$18a and \$18e, Comment\$ \$190. Not one takes an argument or checks anything, and the token table agrees -- every spec is `0` or `2` -- so they answer for whatever the block holds, including before any Examine at all. NOTE: an earlier pass gave all eight an optional path argument and re-queried the filesystem on every call, which accepted a syntax AMOS has no way to produce and made the values track the live filesystem where the routines report a snapshot -- none of them contains a library call, so a change made after the Examine stays invisible until the next one",
  'protect object':
    "Routine 130 (\$3c02), `SetProtection` (dos.library -\$ba). `move.l (a3)+,d2` takes the whole LONGWORD, so bits above the eight AmigaDOS names reach the library untouched; an earlier pass masked to a byte. Failure is error 81",
  'set object comment':
    "Routine 131 (\$3c20), `SetComment` (-\$b4). NOTE: the routine copies the AMOS string with a plain `dbra` loop and no length check at all, so the 79-character FileNote limit is the LIBRARY's rather than the extension's -- an over-long comment reaches SetComment, which refuses it, and the result is error 81 rather than a silently truncated note. An earlier pass truncated and reported success",
  'set object date':
    "Routine 132 (\$3c54), `SetFileDate` (-\$18c). The arguments unwind time-first, and only the LOW WORDS of ds_Minute and ds_Tick are written (`move.w d0,\$38a(a2)`, `swap`, `move.w d0,\$386`) -- the high words of both keep whatever the last DateStamp call left there",
  'file copy':
    "Routine 108 (\$395e), and it shows exactly how 'you can even copy a file of 3 MB in size, even if you only got 100 KB of free memory': it asks `AllocMem` for the whole file, HALVES the request on failure and asks again, giving up only below \$2800 -- ten kilobytes. A source or destination it cannot open is error 81, a Read or Write that fails part way is error 94, and a file of length zero takes a short path that opens and closes the destination without allocating anything. NOTE: there is no memory pressure here and no chunking, so the halving loop is behaviour this port cannot reach; the result is the same file either way",
  'dos hash':
    "Routine 99 (\$365a), the AmigaDOS directory hash instruction for instruction: seed with the length, then per character `mulu.w #\$d,d3 / add.l d2,d3 / andi.l #\$7ff,d3`, and finally `divu.w #\$48,d3` keeping the remainder -- \$48 is 72, which is 512/4-56, the bucket count of a standard block. DEFECT of the earlier port rather than of AMCAF: the case fold (`cmp.b #\$61 / bcs / cmp.b #\$7a / bhi / subi.b #\$20`) was missing, so the hash depended on case and a program walking real hash chains was sent to the wrong bucket. Only ASCII a..z is raised, so an accented character keeps its own byte",
  'path$':
    "Routines 96 and 97 (\$3536, \$358e) are one left-to-right scan each, recording the position of the last ':' or '/' -- a separator of EITHER kind, so the last one wins and 'DH2:a/b:c' cuts at the second colon rather than the slash, which an earlier pass got wrong by checking for a slash first. The one asymmetry is what makes a device name work: ':' records the position AFTER itself and '/' the position before (`subq.w #\$1,d2`), so a colon is kept and a slash dropped. Neither goes through the path converter, so neither has the 1..128 limit and an empty argument gives an empty answer rather than an error",
  'pattern match':
    "Routine 102 (\$377a). 'The pattern may contain any regular DOS jokers[;] a asterik (*) will be converted into #? automatically', and the conversion does happen before the matcher sees it. The library calls are `jsr -\$3c6(a6)` and `-\$3cc(a6)` -- ParsePattern**NoCase** and MatchPattern**NoCase**, not the plain pair an earlier pass assumed -- so this match is case-INSENSITIVE where LDos's, on the same matcher here, is not. The conversion loop also treats an EMPTY pattern as `#?` rather than as a pattern matching only the empty string: `move.w (a0)+,d0 / bne` falls through to `move.w #\$233f,(a1)+`. A pattern ParsePattern refuses is error 23, and the buffer it parses into is 512 bytes",
  'wload':
    "Routines 104 (\$384a) and 103 (\$37f0) differ in two constants and nothing else: the Reserve type -- `moveq #\$0,d1` for Wload and `moveq #\$1,d1` for Dload -- and an eight-character bank NAME that is a literal in the binary, `Work    ` and `Datas   `. The port had invented `Amcaf   `, which was never on a real bank. Then the sign check the manual does document and the earlier pass missed: `bpl / neg.w d0 / addq.w #\$2,d1`, so a NEGATIVE bank number reserves in chip -- 'If bank is a negative number, the file is loaded into Chip ram instead'. A Reserve that comes back empty is error 24 and a Read that fails part way error 94",
  'wsave':
    "Routine 105 (\$38a2), shared by Dsave -- 'Dsave is exactly the same as Wsave in every aspect', and the token table gives both names the same routine. It checks the bank before it opens anything: `move.w -\$c(a0),d0 / andi.w #\$c,d0 / bne`, and a bank carrying either of those type bits goes to AMCAF's own requester with message 4, 'No icons- or spritesbanks allowed' -- which names exactly what the bits mark: Bnk_BitBob and Bnk_BitIcon (+Equ.s:1867-8). That check used to be unreachable here -- it tested `kind !== 'memory'` on a Map that cannot hold anything else -- so saving the sprite bank raised error 23 from the missing-bank path instead of the requester. It goes through the one bank list now (src/runtime/banks.ts) and fires. The length written is `move.l -\$14(a0),d0` less SIXTEEN, the bank's own header, which is not part of what a program put there",
  'tool types$':
    "NOTE: `.info` files are Workbench DiskObjects and this port does not decode them, so a program asking for tool types gets the empty string -- the same answer the manual gives for a file with no icon. The manual's own note is worth keeping: 'The supplied file must not have a .info appended!'",
  'bank code mix.b':
    "Routine 37 (\$25d2), and the only one of the five encoders the manual does not describe. It is a small STREAM CIPHER rather than a per-element operation: `d1 = code XOR \$AA` once, then every element does `d0 = d0 + d1` before `eor`ing into the data, so the key walks. That is why 'So coded banks should be hard to decode' and why decoding is the same command with the SAME code rather than the negative one",
  'bank code mix.w':
    "Routine 47 (\$2690), the word form of the walking key -- and its constant is \$FACE, NOT \$AAAA. Only the binary says so; the byte form's \$AA makes \$AAAA the obvious guess and it is wrong. The same constant turns up again as Bank Checksum's \$FACEFACE",
  'bank checksum':
    "Routine 55 (\$27a6) and its worker 54 (\$2782): a plain LONGWORD SUM of the region, then `eori.l #\$faceface`. The region is measured in longwords (`lsr.l #2`), so a trailing byte, word or three bytes are not counted",
  'bank code rol.b':
    "Rotate, not shift. The manual bounds the count to 1..7 on `.b` and 1..15 on `.w`, and 'To decode a bank either use the negative code with the same instruction or the same key code along with the Bank Code Ror command' -- so a negative count rotates the other way",
  'bank to chip':
    'Routine 27. On the machine the bank is reallocated and "will get a new starting address"; here the memory type is a flag on the bank rather than a real pool, so the move is the flag. The manual\'s warning belongs to the hardware and not to us: "Do not try to replay musics or sounds that resist in fast ram"',
  'current time':
    "Routine 321 (\$70e0 in 1.50): `DateStamp()` into the extension's own block, then `move.w \$6(a2),d3 / swap d3 / move.w \$a(a2),d3` -- the LOW WORDS of ds_Minute and ds_Tick, the two high words dropped rather than checked. The manual spells the same format out: 'the time is created out of Wordswap(minutes)+ticks', and says why: 'This is NOT a value in the standard DOS-format as this one would require two longwords'",
  'insstr$':
    "Routine 187 (\$4a44). `pos` is a COUNT OF LEADING CHARACTERS KEPT rather than a 1-based index: the routine errors on a negative one and on `pos > len` (`cmp.w d5,d7 / Rbhi`), so 0..len is the legal range and 0 inserts at the front. The manual's example agrees -- 'dear ' at 6 into 'Hello Ben!' keeps 'Hello ' and gives 'Hello dear Ben!'. An empty insert returns the original untouched, which the routine takes before allocating",
  'cutstr$':
    "Routine 188 (\$4aae), an INCLUSIVE 1-based run: 7 To 11 out of 'Hello dear Ben!' removes the five characters 'dear '. NOTE: the routine's middle runs into bytes the disassembler cannot separate from code -- the same misdecode Vmod hits -- so its bound checks are legible but the exact arithmetic is not, and the manual's worked example is what this follows",
  'asc.w':
    "Routine 181. UNSIGNED, 0..65535, where the sibling Asc.l is signed -- the one asymmetry in the group, and both the manual and the routine agree on it. A string shorter than two characters is an error",
  'lsstr$':
    "Routine 178 (\$488e). Right-justified in exactly n characters with n bounded to 1..10 by `Rbeq` and `cmp.w #\$a / Rbhi`, and the SIGN IS NEVER PRINTED. The routine walks n positions of a power-of-ten table, so a number too big for the field loses its leading digits rather than overflowing it",
  'itemstr$':
    "Routines 190 and 191. Items are numbered FROM ZERO and separated by '|' unless a single character is given. 'Empty strings for s\$ are not allowed and will create an error message, however, empty items can be used without hesitation. Trying to access a item, that does not exist, will create an error aswell'",
  'lsr':
    "Routine 197 (\$4cec). DEVIATION: the keyword is named for a LOGICAL shift and the instruction is `asr.l`, an ARITHMETIC shift, so the sign bit is replicated and a negative value stays negative. That also makes the manual's 'does the same as a division by 2^n' false for negatives -- ASR rounds toward minus infinity where division rounds toward zero, so Lsr(-3,1) is -2 rather than -1. Reproduced as the library has it",
  'lsl':
    "Routine 196 (\$4ce2) is `asl.l d0,d3`. The manual says 'Rotates the number v to the left', which it does not -- bits leaving the top are lost. Its own worked description (v*2, v*4, v*8) is the shift, so the word is loose writing rather than a second behaviour",
  'binlog':
    "Routine 195 (\$4cc2), and the routine is the specification: zero takes the `Rbeq` error branch, then it shifts right counting until bit 0 is set, shifts once more and errors if ANYTHING is left (`tst.l d0 / Rbne`). So a value that is not exactly a power of two is an error rather than a floor, which is what the manual promises",
  'qsqr':
    'Routine 271 (\$6286): an integer square root by Newton\'s method over a scaled start, with no maths library involved. Zero returns zero before anything else and a negative value takes the `Rbmi` error branch',
  'pt signal':
    "Routine 268 (\$61bc) CLEARS the byte as it reads it -- `move.b \$2(a0),d3 / clr.b \$2(a0)` -- so a signal is consumed by the first read and a second gives 0. The port had Pt Vu (255), which is the identical shape, clearing already and this one not, so a program polling Pt Signal saw the same value for ever. The changelog pins the one documented value: 'When reaching the end of a song, Pt Signal now reports \$FF'",
  'pt cnote':
    "Routine 243 (\$5d5e). Returns a FREQUENCY, not a note number -- the manual says 'the frequency of an instrument being played' and the routine divides \$369E99 (3,579,545, the NTSC Paula clock, used whatever the machine) by the channel's period word at +\$10 of a 44-byte per-channel block, answering 0 when the period is zero. The channel is range-checked and a bad one is an ERROR: `Rbmi routine 390` on negative, `cmp.b #4 / Rbge routine 390` past three, where the port had `& 3` and silently answered for channel 0. APPROXIMATED: the range check and the error are reproduced, but this port does not step patterns, so there is no live period to divide",
  'pt cinstr':
    "Routine 242 (\$5d34), the same range check, then `move.b \$2(a0,d7.w),d3 / lsr.w #4`. NOTE: a byte shifted right by four yields 0..15, so the routine cannot return the 16..31 its own manual promises -- the high bit of a ProTracker instrument number lives in the other half of the note word. APPROXIMATED for the same reason as Pt Cnote",
  'pt sam freq':
    "Routine 246 (\$5df6), and three things the manual's 'channel chan' hides. The channel is a BITMASK: the routine loops four times with `btst.b #0,d0` and `lsr.w #1,d0`, stepping `lea \$10(a0),a0` through the AUDxPER registers from \$dff0a0, so 3 retunes channels 0 AND 1. And the frequency is CLAMPED to \$190..\$7530 -- 400..30000 Hz -- before the period is taken as \$369E99/freq; a negative is floored to zero first and then pulled up to 400. The port took the argument as an index and did not clamp. The third, missed until the routine-375 pass: `tst.b (a1) / bne` guards every write, so only a channel that IS playing an AMCAF sample is retuned and retuning silence does nothing",
  'qsin':
    "Routine 260 (\$643a), and now FAITHFUL rather than APPROXIMATED because the table was found. An earlier pass concluded it was not in the hunk and generated `round(256*sin)` over a symmetric 1024 entries, which disagreed with the shipped table at 770 of 1024 -- by up to 3. The changelog is what located it: 'Sine-Table moved and shortened, so I save about 1536 Bytes', and 2048-512 is exactly 1536, so a QUARTER table of 256 words ships at \$a3a8 (1.40) / \$ab82 (1.50). It is byte-identical to `floor(256*sin(pi*i/512))` at all 256 entries -- floor, not round -- so the port derives it rather than embedding someone else's data. DEFECT: the expansion at \$a2d8 copies 255 entries, writes \$100 as the 256th and mirrors, which puts the PEAK at index 255 and 767 rather than 256 and 768 and leaves DOUBLED zeros at 0/1023 and 511/512. So a quarter turn is one step short of the maximum and `Qcos(0,r)` returns 996 for r=1000 rather than r. Reproduced, because a program that plots a circle with these gets AMCAF's circle",
  'qcos':
    'Routine 259 (\$6428), four instructions: `addi.w #\$100,\$6(a3)` then `Rbra` into Qsin. The quarter turn is applied to the ANGLE on the parameter stack rather than to the result, and \$6(a3) is the low word of the second longword because Qsin pops the radius first. Inherits the table DEFECT recorded under Qsin',
  'qarc':
    "Routine 261 (\$646c). A table lookup, NOT an arctangent: it divides the smaller magnitude by the larger for a ratio in \$0..\$200, indexes a 513-BYTE table at \$a5a8 (pointer \$69a), and mirrors about 256 for the steep half. The table is `floor(atan(i/512)*1024/2pi)` at all 513 entries. An earlier pass used `Math.atan2` with `Math.round`, which differs at 3808 of the 6561 points in an 81x81 grid -- the four axis cases both agree on, which is why the original test could not tell them apart. DEFECT: the quadrant is chosen by `tst.w`, a WORD test, while the magnitudes were taken as longs, so a delta past 65535 whose low word reads positive lands in the wrong quadrant. Reproduced",
  'qrnd':
    "Routine 272. The manual says it is 'totally identical to the Rnd function, with the only difference, that this one is much faster', so it uses AMOS's own generator rather than a second one -- which is also what makes a Randomize seed reach it",
  'vmod':
    "Routines 185 (\$49e6) and 186 (\$4a10), two token forms of one idea. It WRAPS where Vclip clamps: 'If val exceeds upper by 1, it will be set to lower ... If it goes deeper than lower by 1, it will be set to upper'. The routine divides by upper+1, so the span includes both ends. NOTE: the two-bound form's disassembly runs into data the disassembler renders as `dc.b \"BCHCNuD\"` and could not be read straight through; the single-bound path is legible and the two-bound one follows the manual's worked description",
  'cpu':
    "Routine 216 (\$5026) reads ExecBase+\$128 (AttnFlags) and maps the bits onto 68000/68010/68020/68030/68040/68060 -- d3 starts as the longword \$109a0, which is 68000 in decimal, and each hit overwrites only the low WORD so \$9b4 turns it into \$109b4 = 68020. The modelled machine is an A1200, so bit 1: the same identity Jd Cpu reports and the same one the 2MB chip / fast-board pools answer for",
  'fpu':
    'Routine 217. Zero when nothing is fitted, which is the A1200 as modelled; Jd Fpu agrees. The manual notes that on 68040/68060 the cpu contains the fpu and those numbers come back instead',
  'nop':
    "Routine 21 (\$231a) is two bytes: `rts`. 'This command has no effect et al. It's only use is for speed testing routines' -- so a no-op here is FAITHFUL rather than a stub, because there is nothing for a program to observe afterwards that differs",
  'nfn':
    "Routine 22, the function half of the same idea: 'This function returns nothing useful. It's only used, like Nop, in speed testing routines'",
  'aga screen open':
    "Routine 2 (\$1050): 0..7 or error 5, must not already exist (error 1), always 320x256x8, brought to the front, and the default font selected on the way. DEVIATION: the original builds its OWN copper list outside AMOS's screen system, which is why the doc warns that 'Sprites,Bobs and Mouse related commands may react in a corrupting way on screen'. Here an AGA screen is an ordinary Screen of 256 colours, so it composes with sprites, bobs and the pointer instead of fighting them -- programs written around that warning look better than they did, and nothing they can do depends on the corruption",
  'aga get palette':
    "Routine 5 (\$11d8) is FOUR BYTES: `move.l (a3)+,d0 / rts`. It pops its argument and returns, and it is undocumented. It is NOT the keyword the doc's 'AGA Get Palette Bank' entry describes -- that entry is Aga Get Bank Palette, a different routine at \$1a94. Reproduced as the no-op it is",
  'aga get bank palette':
    "Routine 38 (\$1a94). The doc's synopsis is wrong three ways: it calls the keyword 'AGA Get Palette Bank', gives it a `To screen` argument, and implies the palette is per-screen. The token spec is `I0` -- one bank, no To, no screen -- and the routine reads 256 four-byte entries, DISCARDING the first byte of each (two `move.b (a0)+,d0` into the same register), so the bank is 0RGB longwords. The missing screen argument is the doc's own 'each screen has to share a common palette' showing through",
  'aga colour':
    "Routine 24 (\$158a) and its function form. Each 8-bit channel splits into a high-nibble word and a low-nibble word, poked into the copper list four bytes apart at +0 and +\$420 -- the AGA LOCT pair, the same technique Stars' Cop True Palette uses. `cmp.w #\$ff,d0 / bgt` skips a colour above 255 SILENTLY, with no error and no wrap. The function returns the 24-bit value the doc gives examples for: 'Red = \$00FF0000'",
  'aga ink':
    "Routine 9 (\$13a0): `move.b d0,\$0(a2)`. A byte, which is exactly why the doc says a value 'over 255 will wrap around again' -- it is truncation, not a range check",
  'aga bar':
    "Routine 7 (\$1236) = RectFill, but only after `cmp.w d0,d2 / ble` and `cmp.w d1,d3 / ble`, so an inverted or degenerate bar is error 3. AMOS's own Bar swaps the corners and draws; this one refuses",
  'aga box':
    'Routine 6 (\$11dc): Move to (x1,y1), then PolyDraw over four corners -- (x1,y2) (x2,y2) (x2,y1) (x1,y1). An outline, and unlike Aga Bar it does not check the corner order',
  'aga text':
    "Routine 8 (\$127e): TextExtent to measure, TextFit to clip, then the glyphs through rp_Font. The metrics are graphics.library's -- the glyph top is y - tf_Baseline and each character advances by its own width, so a proportional face sets correctly instead of on an 8-pixel grid. DEVIATION: with no face opened this draws nothing, where the machine's RastPort would inherit the screen's default topaz. The built-in 8x8 belongs to AMOS's console rather than to graphics.library, and the extension has no console to borrow it from",
  'aga draw mode':
    "Routine 35 (\$19e2) = SetDrMd(rp, n): Jam1 0, Jam2 1, XOR 2, INVERSVID 4, stored with no validation. The RastPort it sets is the EXTENSION's, not the focused AMOS screen's -- the state block at \$228(a5) holds one set of pens for the whole extension and \$8a says which screen's bitmap they act on, so AMOS's own Ink, Gr Writing and Set Planes cannot reach an AGA drawing operation and it cannot reach theirs",
  'aga sprite mode':
    'Routine 36 (\$19fe): patches \$00, \$80 or \$c0 into a copper instruction for low, medium and high resolution sprites. The three cmp.w tests simply do not match anything else, leaving d3 at 0, so an out-of-range value is low res rather than an error',
  'aga front screen':
    "Routine 30 (\$1868). NOTE, unresolved: this routine indexes the screen table through a2 without ever loading a2, where every sibling does `movea.l \$228(a5),a2 / adda.w #\$96,a2` first. Whether that is a live defect depends on what the dispatcher leaves in a2, which cannot be settled without executing the 68k -- n/a by policy. Implemented as the doc and the routine's evident intent say, with the discrepancy recorded rather than guessed at",
  'aga unpack':
    "Routine 48 (\$1fd2), and the format is read off it rather than out of the doc, which describes none of it. A bank headed 'Aga.Pic' is 1024 bytes of palette -- 256 entries of a high-nibble word then a low-nibble word, poked into the copper \$420 apart -- followed by (count,value) byte pairs decoded into a 320x256 CHUNKY buffer, one byte a pixel, converted to bitplanes in one pass at the end. That last step is why the doc can say Akiko helps. A run never crosses a row: at x=320 the routine zeroes x and steps y, stopping at y=256. A count of zero still writes one pixel, because the store precedes the dbra, but advances x by nothing -- so a stream of zeroes never terminates, and the packer never emits one. Opens the destination screen if it is not already open",
  'aga spack':
    "Routine 47 (\$1dee), the inverse of Aga Unpack's format. The doc's warning is the RLE showing through: 'it is quite possible for the packed picture to be larger than the original RAW data'",
  'aga load bitplanes':
    'Routine 29 (\$1804): eight CopyMem calls of \$2800 bytes each, straight into the planes in order -- \$2800 is 320/8 * 256, one whole plane. Opens the destination screen if it is not open. The doc notes the bank no longer has to be in Chip RAM, "speeding up the screen display on 020+ machines as 020+ machines are faster than the Blitter for these operations"',
  'aga get block':
    "Routine 18 (\$1434): 0..4000 or error 8. The mask flag is the six-parameter form and is fixed at grab time -- 'You cannot allocate a mask afterwards'. DEVIATION: the doc says overwriting a block leaks the old one ('you will lose the memory that the previous block was using, so remember to AGA Del Block first'); a Map simply replaces it, so the leak is not reproduced",
  'aga use font':
    "Routine 54 (\$2324): OpenLibrary('diskfont.library') cached at \$ba, CloseFont on the previous face, a TextAttr built at \$c5 from name/ySize/style/flags, then OpenDiskFont. `adda.l #\$2,a0` steps over the AMOS string's length word. The style argument is accepted and not applied, which the doc owns up to for one case: 'You can't use the style parameter with scalable fonts yet'",
  // --- Stars 2.33: manual plus disassembly; three places they disagree ---
  'stars reset':
    "Routine 4 (\$1892), twelve bytes and undocumented: `movea.l \$f80000,a0 / movea.l 4(a0),a0 / jmp (a0)` — it reads the initial PC out of the Kickstart ROM header and jumps to it, which is a hard machine reset. DEVIATION: there is no machine to reboot, so the program ends, the same thing System and Edit do with AMOS's own leave-now keywords. Nothing in Stars.doc mentions this keyword at all, so no program can have been relying on the reboot in a way the manual sanctioned",
  'stars wibble':
    "Routine 8 (\$19f2): `move.l a4,-(a7) / movea.l (a7)+,a4 / rts`. A prologue and an epilogue with the body gone — it does not even load the extension's data pointer, which every other routine does first. Identical in starspro.lib at the identical offset, so it survived a rebuild for a different host. Undocumented, and the doc's list of full-version extras (Cop Screen, Stars Rain) does not include it. Reproduced as a no-op that must still EXIST, because the keyword dispatches and the original raises no error",
  'stars vbl':
    "Routine 5 (\$189e). Documented as 'the same as Wait Vbl, but shows idle processor time', and it does that by busy-looping on COLOR00 between \$000 and \$800 until the VBL server flips the flag at +6 of the extension's block. DEVIATION: the wait is reproduced and the colour bar is not — the bar's width measures how long the 68k sat in that loop, which is a property of the host's speed rather than of the program",
  'stars on':
    "Routine 6 (\$18d8). Parameters pop off a3 in REVERSE declaration order, confirmed three ways by the bounds checks that follow: screen 0..7 and open, direction 0..4 (stored into the same field Stars Dir writes), count 1..128. Places all 128 stars whatever the count, then activates. The PRNG (\$19ca) folds VHPOSR into its state on every call, so on the real machine the field depended on where the beam was; we model the beam, so the sequence is reproduced rather than approximated and simply becomes repeatable. Speed is not a parameter and is not documented: the movement loop counts DOWN while walking the arrays UP and takes ((i AND 7) + 1) pixels a frame from the counter, so a field is eight interleaved parallax layers",
  'stars off':
    'Routine 7 (\$19e2): clears the count and nothing else, so the stars already drawn stay on the screen until something overwrites them. It does NOT erase them',
  'stars blast':
    "Routine 3 (\$181a). Eight passes over every bitplane; each pass shifts every even row's bytes left by one and every odd row's right by one, with the masks \$fefefefe and \$7f7f7f7f stopping a bit crossing into the next byte. Per byte, not per row, which is why it shreds rather than slides. After eight passes the planes hold nothing, which is the doc's 'fancy fade effect'",
  'stars dir':
    'Routine 9 (\$19f8): 0..4 into the same field Stars On writes. Direction 4 is Stationary, and it is spelled by matching none of the four cmpi.w tests in the mover and falling through to its rts',
  'cop palette':
    "Routine 10 (\$1a1c). Builds copper MOVEs for 12-bit colours read a word at a time, through AMOS's own Cop Move. AGA-aware: the register address lives in one bank of 32 (\$180..\$1be) and the other 224 registers are reached by writing the bank into BPLCON3 (\$106) whenever the address wraps, with \$c40 restoring bank 0 on the way out. The doc says a and b 'can be in the range 0-255, but a < b'; the routine checks b < 256 and b >= a, so a == b is accepted and a single colour can be written",
  'cop true palette':
    "Routine 11 (\$1aba), the 24-bit form: two passes over the same R,G,B bytes, high nibbles into the colour registers and low nibbles behind AGA's LOCT. DEFECT: the first register is computed with `lsl.w #4,d3` where Cop Palette has `lsl.w #1,d3` (\$1ae8 against \$1a40, confirmed byte-for-byte as E94B against E34B). A register offset is the index doubled, so this is right only when a is 0 and otherwise starts sixteen registers per index along, wrapping inside the bank; every colour after the first is still consecutive because the loop advances by 2. Reproduced, because a program written against this extension was written against this",
  'cop screen':
    "Routine 12 (\$1bd8). Stars.doc lists this among the extras 'found in the full version', and the shareware build does carry 204 bytes for it — but they pop all eight parameters, range-check every one, store them into a static block at \$1c92 and return having emitted nothing. So the doc is right about the feature and the token table is misleading about it. Validates and does nothing, faithfully. Stars Rain, the doc's other full-version extra, is genuinely absent from the token table",
  'cop current':
    "Routine 13 (\$1ca4), two instructions: `move.l -\$804(a5),d3`, AMOS's own copper build pointer. Exactly where the next Cop Move would put its word, which is what the doc means by 'makes poking straight into it easier'",
  // --- Sticks 1.01b: manual plus disassembly; two places they disagree ---
  'multi joy':
    "Routine 3 (\$260). Directions decode from JOYxDAT through a table at \$2e6(pc); the buttons OR in above them, \$80 from CIA-A PRA bit 7 then \$40/\$20/\$10 from POTINP. The manual contradicts itself and the binary settles it: its diagram reads '76543210 / ABCDUDLR', which would order the low nibble U,D,L,R downward from bit 3, but its value table says 1=up 2=down 4=left 8=right 16=D 32=C 64=B 128=A. The code's \$80/\$40/\$20/\$10 proves the value table right and the diagram written backwards. Port 0 and port 1 are separate players and map to the host's two joystick states. DEVIATION: buttons B, C and D need a two- or four-button adaptor wired to the POT pins, and nothing is attached, so only button A can ever report pressed",
  'multi fire':
    'Routine 4 (\$368). Note which argument is range-checked: the routine pops the BUTTON into d4 and the PORT into d5, and only d5 gets the blt/bgt pair, so an out-of-range button falls through every cmp.w and answers 0 rather than raising. Button 1 is the ordinary fire; 2, 3 and 4 need the adaptor and answer 0',
  'stick joy':
    "Routine 5 (\$432), reading CIA-A PRB (\$bfe101) bits 0-3. The manual calls this the serial port throughout; the register says otherwise — CIA-A PRB is the parallel-port DATA register, and Stick Fire's \$bfd000 bits 0-1 are BUSY and POUT, also parallel. This is the four-player parallel adaptor. Nothing is attached here, so it reports an unused port, the same answer IOPorts gives for a serial port with no cable in it. The port argument is still range-checked exactly as the routine does",
  'stick fire':
    "Routine 16 (\$8ce), CIA-B PRA bits 0 and 1. The TWO-argument form is a deliberate dead end and the manual owns up to it: 'I shouldn't really tell you this ... but if you enter =Stick Fire(Jport,button) it will return an error (This command has been provided so it can be easily updated to handle more buttons in later version)'. The binary carries the matching string, 'Command not available in this version'. So the error is shipped behaviour, faithfully reproduced, not a gap",
  'stick scan':
    'Routine 6 (\$4ea), two instructions: a POTGO write starting the paddle conversion that Stick X and Stick Y read a frame later. With no paddle attached there is no conversion to start, so it is observably nothing',
  'stick x':
    'Routine 7 (\$4f8): POT0DAT or POT1DAT, low byte. The register is computed as \$12 + (jport AND 1) * 2, so this keyword MASKS its port argument where every other one range-checks it. Stick Y (routine 8, \$520) reads the same register and takes the high byte with asr.l #\$8 — one paddle register holds both axes. Nothing is attached, so both answer 0',
  'mouse x':
    "Routines 22/23 (\$b16/\$b46) and their function forms. A second, independent mouse position per port, held in the extension's block at \$1f8(a5): +\$c/+\$e for mouse 0 and +\$14/+\$16 for mouse 1. Explicitly not AMOS's pointer — 'This function does not alter or read the AMOS pointer position'. The coordinates are AMOS HARDWARE coordinates, settled by the author's own Sticks-Demos/Mouse.AMOS, which passes the pair straight to `Sprite 1,X,Y,1` and clamps it to 142..434 by 64..236. The manual's BUGS entry corrects an earlier edition's syntax: 'instead of Mouse X = value (as stated) use Mouse X Mouse Number,value'. DEVIATION: on the real machine each mouse is its own accumulator fed from its own port, so mouse 0 and the AMOS pointer can drift apart; there is one pointer here so they cannot, and mouse 1 has nothing driving it and holds wherever it is put",
  'mouse clip':
    "Routine 19 (\$a66), both arities. The box may sit outside the screen — 'or even beyond the screen if you want' — so it is not clamped, only the position within it is. The one-argument form means 'the current screen size', which is also the default, so it clears the stored box rather than storing one; in hardware coordinates that default is where the screen is DISPLAYED, not 0,0",
  'mouse button':
    "Routine 21 (\$ab4). A bitmask, not a button number: the routine only ever does `ori.b #\$1` and `ori.b #\$2`, so 3 means both are down. The manual's table lists 3 as 'Middle Button Pressed', which the code does not support — no third line is read anywhere in the routine",
  'mouse area':
    "Routine 28 (\$c96): reads the tracked pair for that mouse and calls AMOS's own zone test at \$48 off the library base. 'The same as Mouse Zone in AMOS except Mouse Zone can only read one mouse', so it goes through the same zone lookup and the same hardware-to-screen mapping",
  // --- CText 1.32: disassembly plus byte-exact font tables ---
  ctext:
    "Ctext x,y,text\$ — routine 7 (\$570). A font is an AMOS ICON BANK plus a 768-byte side table, which is what its own documentation describes ('easy to use icon based text displays', CText.FONTS/Please_Read_Me!). The block at \$168(a5) holds a fixed width at +\$a and fixed height at +\$e, each meaning 'use the per-character table instead' when zero, then three 256-byte tables from +\$1e: character to icon number, to advance width, and to Y offset. That the tables are 256 bytes each is not read from the code alone — all 254 .Cfnt files on the AMOS PD CD are exactly 768 bytes, and one dumped shows icons 1..96 for '!'..'z', widths 3..13, and Y offsets where ',' is 2 and '-' is 1. An unmapped character advances without drawing (`cmp.l #\$0,d1 : ble`). The per-character draw is AMOS's own icon paste, reached with the icon entry in a2 and a \$ff plane mask in d5, so Paste Icon is reused for it. DEVIATION: the callee is identified by what the surrounding code hands it rather than by name — `jsr \$11c(a0)` off `-\$4(a5)` resolves to no plausible entry under either table indexing, and AMOS's own source has no equate for that offset",
  'font size':
    'Font Size w,h — routine 5 (\$4c4), five instructions writing the two longs to +\$a and +\$e. Zero in either restores the per-character table, which is how a program switches between fixed and proportional spacing mid-program',
  plen:
    'Plen(text\$) — routine 6 (\$4d6). Runs the same character walk as Ctext with nothing drawn: both routines `Rbsr routine 10` and then step the string identically, so the measurement cannot disagree with what Ctext will lay down. Shares one implementation here for the same reason',
  'font base':
    "Font Base — routine 8 (\$67e), three instructions handing back the block address so a program can poke the scalars directly. The block is mapped into the fake address space at Runtime.EXT_DATA_BASE rather than kept as private fields, because programs genuinely address it: the corpus writes `Bload Dir\$+\"FONTS/....ABK.CFNT\",Font Data`",
  'font data':
    'Font Data — routine 9 (\$688): the block address plus \$1e, the first of the three tables. This is the Bload target every CText program in the corpus uses to install a font',
  'kern$':
    "Kern\$(n) — routine 11 (\$6ca). Returns a two-character string, ESC then '0'+n, by writing the digit into a fixed buffer at +\$1a. So kerning travels INSIDE the text rather than as an argument, which is why both Ctext and Plen watch for \$1b: the escape sets a pending offset that is added to the pen at the next join and immediately cleared",
  'blit clear':
    "Faithful including the off-by-one, which contradicts the manual. Routine 48 (\$18b0) takes its plane count from `move.w \$50(a0),d7` on the screen structure at \$52c(a5), and that field is depth MINUS ONE — established by two routines using it as a `dbra` bound, this one's own all-planes loop and Blit Left's at \$1726, both of which must cover exactly the planes. The named-plane guard is then `subq.w #1,d0 : cmp.w d7,d0 : bge <error>`, so a named plane has to be strictly below d7 and **the top bitplane cannot be cleared by name**: on an 8-colour screen the manual's own wording, 'An 8 colour screen has 3 bitplanes, numbered 1 -> 3', fails on 3. The binary wins over the manual, the same rule that settled LDos's crypt routines. The argument's SIGN is tested on the long (`move.l (a3)+,d0 : bmi`) but the range check and the index are word-width, so only the low sixteen bits choose the plane, and the negative form is the one that honours the Set Planes mask. DEVIATION: where the low word is zero or negative the routine passes its own guard with d0 negative and walks 65536 plane pointers into memory; that is unreproducible corruption, so it is reported as the same error the in-range failure gives",
  'blit speed':
    "Faithful including the defect. The routine decides which way a zone scrolls by testing bit 0 and then bit 15 of the stored word masks, and for a Blit Store Left zone those masks are \$ff<<shift — so a shift below 8 matches neither test and the routine returns having changed nothing, silently. A Blit Store Up zone leaves the mask at \$ff, bit 0 set, so the change goes through there — and writes a horizontal barrel shift into a vertical scroll, because BLTCON0 carries the shift for both. The manual's plain description ('you can change the SHIFT (speed) value after you have defined a scrolling zone') is true only from 8 up",
  'blit int on':
    "Installs a VBLANK server at priority 9; here the runtime's vertical blank runs it once a frame, before the starfield's, which is the order the two priorities give. The wait flag is faithful in both senses: Blit Int Wait writes the opposite of its argument, so False stores 1 and starts the scrolling. What cannot follow is the timing — on the real machine the server is preempted by anything that owns the blitter, which is why the manual warns against running Scene 16/32 Do with the interrupt on",
  'set planes':
    "Writes rp_Mask, so it restricts AMOS's own drawing as well as TURBO's, as the manual says ('All normal graphic AMOS commands use this parameter'). Applied here at the two points every write funnels through — plot and the text writing modes — which covers the drawing keywords but not the wholesale fills: Cls and screen clears write every plane whatever the mask says. The keywords the manual lists as ignoring the mask (F Draw, F Plot, F Point, F Circle, Plane Offset) ignore it here too",
  'display stars':
    "The plot is a bset into the first bitplane, the wrap is the routine's own — including the bug the author owns up to in the Stars Clip entry ('This instruction works fine now as it is, but is not really finished yet...somethimes you don't get what you want!'), where wrapping past the left edge folds the overshoot into the register holding the right edge and every later star in the same pass wraps a column further in. What is not reproduced is what happens off-screen: the routine computes a byte address from its precomputed row table and checks nothing, so a star outside the screen — or a screen other than the one Reserve Stars ran on, which the manual warns about in capitals — writes over whatever is there. Those stars are skipped",
  'stars int on':
    "Installs a VBLANK server at priority -40; here the runtime's own vertical blank calls it, once a frame, after AMOS's. The X-only movement is faithful ('Only the X-speed is changed (for more speed)'), as is drawing on the screen Reserve Stars ran on rather than the current one. Two things cannot follow: the server keeps running while AMOS is busy on the real machine, where this is bounded by the frame; and closing that screen with the interrupt on is 'a crash will be certain' there, and nothing here",
  'reserve object chip':
    "1.9 splits Reserve Object into Chip and Fast variants, and routines 28 and 29 differ in exactly one longword: the AllocMem flags, MEMF_CHIP against MEMF_FAST. They share one object table and one set of errors. There is no chip/fast memory here, so both names run the same handler — and the out-of-memory exit both routines carry (routine 64, AMOS error 24) cannot be reached",
  'object draw':
    "Faithful for any object that ends in a Stop element, which the manual demands in capitals: 'Make sure that the last ELEMENT of an OBJECT definition is a Stop instruction. And nothing unpredictable will happen.' Without one the four draw routines fall out of the attribute branch straight into the Move code and read four bytes past the vector list — the unpredictable thing the manual is warning about. This stops at the reserved count instead of reading whatever follows the allocation",
  'object save':
    "Writes the file the routine writes: 'OBJE', a word holding END-START, then a count word and COUNT*6 bytes for each defined object, silently skipping the ones that are not — which leaves a file Object Load reads short, exactly as the original does. Two departures follow from having no AmigaDOS: a failed Open is silent here as there (the routine branches to its close-and-return tail), and START/END are not validated against the limit, where the original reads outside its pointer array. The manual's claim that a name over 80 characters means 'nothing will happen' is wrong — the routine raises AMOS error 21, and so does this",
  'lfreq':
    "LDos does not draw this requester — it calls req.library, which the manual gives away when it apologises that 'Currently the req.library doesn't support CG-fonts'. There is no req.library here, so AMOS's own Fsel\$ stands in: a working file requester that returns the same thing (full path and name, empty on cancel) and remembers the same state, but which looks and behaves like AMOS's rather than ReqTools'. The FLAGS argument is accepted and largely cannot be honoured — .info filtering, the dir cache, the hide gadgets and font mode all belong to the requester that is not here — and \$2 was never supported by LDos itself either ('Extended select. Not supported by Ldos.'). Approximated for the substitution, not for the plumbing",
  'lpp decrunch':
    "Decrunches PP20 with the decoder Ppload already uses, whose correctness is established in powerpacker.test.ts against reference decoders and a genuine crunched file. One deliberate departure: the manual is emphatic that 'no test is done to see if the bank really contains a powerpacked file! Be careful!', and on the real machine that means memory gets scribbled over. Here a bank that is not PP20 writes nothing, because faithfully corrupting memory would be of no use to anyone",
  'lpp mem':
    "Reads the decrunched length out of the PP20 trailer's top 24 bits, which is why the manual insists END be the true end of the file rather than of the bank ('AMOS's banks are always rounded off to the nearest multiple of 4'). It does no validity checking, exactly as documented — arbitrary data returns whatever its last longword happens to say, and routine 40 ($1aec) shows how literally: nine instructions, `andi.l #$ffffff00` then `asr.l #$8`. The shift is ARITHMETIC, so a trailer with its top bit set answers a NEGATIVE size. No real PP20 file can reach that, its length fitting in 24 bits; arbitrary data can, and now does here too",
  'lansi':
    "Translates ANSI escape sequences into the AMOS console's own control codes — ESC P n for pen, ESC B n for paper, ESC X/Y n to locate, ESC O/N with a +128 bias for relative moves (screen.ts, +Lib.s ChXxx) — which is what a BBS terminal written in AMOS needs. The manual's table is implemented as given, including its own stated limits: only Italics, Inverse and Underline are supported and other styles are ignored, and changing style does not clear the previous one. An escape split across calls is carried over, as documented. Routine 69 (\$2682) corrected five arms the manual could not have settled: ESC[K, ESC[M, ESC[J and ESC[L are single `move.b`s of 7, 26, 25 and 20, ESC[n@ is 18 repeated, and a bare form feed is 25 -- ClEol, ClLine, Clw, ScBas and ScDLine in AMOS's own control table (+W.s:16570). This port dropped four of the five and rendered the other two as a locate. Codes 7, 24 and 26 had no counterpart in src/runtime/screen.ts at all until this was read; they are ClEol, a second Home and ClLine, and they printed a glyph where the real machine cleared something",
  'lopen':
    'Files are read into memory whole on open and written back on Lclose, so the manual\'s warning that an unclosed file can corrupt the disk holds in the sense that the writes are simply lost — it cannot corrupt anything else. Error messages are the library\'s own, read out of its string table at $3d14 rather than invented: "Invalid Lchannel" (0), "LFile already assigned to channel" (1), "LFile not open" (2), with the author\'s English preserved as he wrote it. NOTE: an empty filename is a buffer overrun in routine 1 and is not reproduced — the name copy is `move.w (a0)+,d0 / subq.w #$1,d0` followed by a dbra, so a zero length underflows to $FFFF and writes 65536 bytes across LDos\'s own workspace. Here it copies nothing and the Open proceeds with an empty name',
  'lsys stamp':
    'Reads the host clock, which defaults to a fixed date so a headless corpus run stays reproducible; a host with a real clock (the browser) supplies one. Nothing about the keyword is approximated — what varies is whether the machine it runs on has a clock, which is a property of the host rather than of the port',
  'lsys time':
    'As Lsys Stamp. Formats HHMMSS with no separators, which the manual is explicit about: "No extra \":\",\".\" or \"-\" is added so that you easily can process this string to the format you like"',
  'lcrypt':
    "LdosV25.DOC documents the calling convention and says nothing whatever about the cipher, so this was read out of AMOSPro_Ldos.lib itself — Lcrypt at \$4400, disassembled with capstone. The key is built by add.b (low byte of d7 only), eori.l #3 and rol.l #1 per password character, then each longword is (value + \$20) XOR key. The byte-width of the add is the part a manual could never have conveyed and the part that matters: widen it and the key diverges after one character. The disassembly is short, unambiguous and its two routines are exact inverses, and the tests hand-simulate the 68k key loop as an independent check — but this is evidence of a different kind from source or a manual, and it is recorded as such",
  'ldecrypt':
    "The inverse of Lcrypt, at \$4436, and the only one of the pair that validates its argument: it opens cmp.w #4,d0 / bcc, while Lcrypt has no length check at all. So the manual's 'an error will be produced if the password is less than 4 characters long' is true of one of the two keywords, which the binary shows and the documentation does not. A short password given to Lcrypt on the real machine runs its dbra 65536 times off the end of the string",
  'get high word':
    "Faithful, and it is not what the doc says. `a=Get High Word(_adr)` reads like a memory fetch; routine 6 (\$7ae) is `and.l #\$ffff0000,d3 / swap d3`, which takes the high word of the VALUE and touches no memory. The demo settles it in the author's own words -- 'Entspricht - High=Wert/\$10000' -- and adds that once compiled the plain division is faster, which only makes sense if no memory is involved. Get Low Word is the same story with `and.l #\$ffff`",
  'cpu clear':
    "Faithful, which here means it always fails. Routine 26 (\$12c8) is not a clear of its own: it range-checks the address and then calls whatever routine pointer sits at the extension workspace+\$132, raising error 12 when that is zero. Nothing in this library's twenty-two keywords ever writes \$132 -- Init Cpu Clear reads a table at +\$13a and returns a value without installing anything, and no other routine touches the field -- so unless the library's own init fills it, which this port has not established either way, error 12 is the only outcome. None of the eight demos calls it; they all use Cpu Clear Ntsc",
  'init cpu clear':
    "Returns zero. This is a defect in the library rather than a limit of the port: the return register d4 is never initialised, and every failed validation branches straight to the exit that returns it, so most inputs hand back whatever the caller happened to leave in d4. Only one path -- third argument zero, second in 1..14 -- loads it at all, from a table at workspace+\$13a that no keyword ever fills, and the path for a positive third argument falls through its own bounds check without loading anything. Zero is what a cleared table gives, and there is no stale register here to hand back instead",
  'tft error$':
    "Returns the empty string, and the reason is the keyword's own premise. It splits its argument into a slot (the high byte, which must be 25) and an error number, then indexes a table of NUL-terminated strings at workspace+\$60 that AMOS supplies per extension. TFT ships no message file and the binary contains no message text at all -- the only strings in it are its own token table. The keyword exists precisely because of that gap: its demo explains that AMOS's own Error\$ 'giebt leider keine Text meldungen aus, wenn der fehler von einer Extension verursacht wird'. With no table loaded the routine falls to its empty fallback, which is what this answers. The same absence is why the wording of every TFT error raised by this port is the port's own descriptive text rather than the library's",
  'locale active':
    "Non-zero, which is the port choosing to report locale.library as PRESENT. The extension is built to survive its absence -- 'This extension does NOT require locale.library to load', and Catalog String\$ tests LocaleBase with `move.l \$0(a2),d1 / beq` and hands back the caller's default when it is zero -- so answering 0 would have been a defensible reading of the binary. It is the wrong one: it would leave fourteen of the twenty keywords answering nothing, when the library behind them is now modelled in src/runtime/amigalocale.ts from data extracted out of AROS. The value itself is only ever used as a yes/no ('If Locale Active=0'), and on the machine it is the Locale structure OpenLocale(NULL) returned",
  'catalog active':
    "Faithful, including the defect. Close Catalog (routine 11, \$618) is `move.l \$0(a2),d0 / beq / movea.l \$4(a2),a0 / jsr -\$24(a6)` and nothing more -- it calls CloseCatalog and never clears the pointer at +\$04. Catalog Active reads that field directly (\$63e), so once a catalog has been closed it goes on reporting one, and the doc's 'returns 0 if no catalog is loaded' stops being true. Reproduced. NOT reproduced is a later Catalog String\$ following the dangling pointer into freed memory: here the catalog is gone and the caller's default comes back, which is what the routine would do if the field had been cleared properly",
  'open catalog':
    "The catalog is read and parsed here, because on the machine that is locale.library's job rather than the extension's -- OpenCatalogA is behind the shim. FORM CTLG with FVER/LANG/CSET/STRS, each STRS entry a ULONG id, a ULONG length and NUL-terminated bytes, the ENTRY then padded on to the next longword. That padding was got wrong at first and it is worth recording how: the length field is the string's own length and the padding is NOT counted in it, but the reader advanced by the raw length and the hand-built test fixture encoded the padded one, so the two agreed with each other and disagreed with every catalog ever shipped. Against 8,283 real ones it was recovering 11,251 strings where the right answer is 1,246,298. The reader is now verified against that corpus (locale.corpus.test.ts): all but two parse, and those two are MacBinary-wrapped so they do not begin FORM at all; malformed files -- WBPerplexity's declare a FORM size of 33924 inside 2448 bytes -- degrade to an empty catalog rather than throwing. The corpus also settles that ids are arbitrary longs: 99 of the files use values above a million or below zero. The search path is the plain name then CATALOGS:<language>/<name>, omitting the PROGDIR: and LOCALE: entries that need a program directory this port does not model",
  'format date$':
    "Every directive the doc lists, plus %q and %Q which it does not -- and which matter, because the built-in locale's own time formats are made of %Q, so without them Time\$ would print a literal Q. The compound directives expand by recursion, which is what the doc's 'same as ...' means. Two deliberate departures from AROS, whose FormatDate this is written against: %j is leap-correct here where AROS computes mday+dayspermonth[month] with no adjustment while its own %U/%W apply one (the two disagree from 1 March of any leap year, and the source carries a 'TODO: Julian date not tested' beside it), and %Z expands to nothing because AROS marks it 'Unimplemented in 3.1'. %I is left as AROS has it -- hour%12, so noon and midnight both print 00 -- and flagged as the one directive whose output looks wrong rather than merely different",
  'date$':
    "One of six keywords that are Format Date\$ with a locale-supplied format string. Date\$ is `move.l \$4c(a0),d3` on the Locale followed by the same formatter (\$782), and \$4c is loc_DateFormat; its neighbours at +\$48, +\$50, +\$54, +\$58 and +\$5c are DateTimeFormat, TimeFormat and the three Short ones, matching Datetime\$, Time\$, Short Datetime\$, Short Date\$ and Short Time\$ exactly. The six templates are the built-in locale's own, extracted from AROS's defLocale rather than invented. Worth recording that the extension's binary and AROS corroborate each other here without either knowing about the other: the field order AROS declares in struct Locale is the order the 68k reads",
  'locale string$':
    "The whole table now, from AROS rather than guessed: ids 1-51 with DAY_1..7, ABDAY_1..7, MON_1..12, ABMON_1..12, YESSTR, NOSTR, AM_STR, PM_STR, the hyphens and quotes, and the relative day names. english.language stops at FUTURESTR (50) even though MAXSTRMSG is 52, because the id above it is LANG_NAME which locale.h marks V50 -- an addition the v38 library this extension opens never had. That boundary is exactly what the doc was circling when it said 'try this command out with a FOR loop... This will probably fail when I reach about 50, but then you'll know'",
  'locale compare':
    "Faithful, and it CORRECTS the documentation. The structure is exact -- the routine runs over the SHORTER of the two lengths (\$73e-\$756 picks it with `cmp.w d2,d3 / bcc`), passes that to StrnCmp, and falls back to comparing lengths only when StrnCmp calls the stretch equal, returning 1 or -1 (`moveq #\$ff,d0`, sign-extended). StrnCmp's own answer passes through unclamped, which is why the doc promises '<0' and '>0' rather than -1 and 1. The correction is level 0: the doc calls it 'ordinary compare. You could skip this function and use a straight If STRING1\$=STRING2\$ instead', but SC_ASCII resolves through __code_table_to_upper, so it is case-INSENSITIVE and it collates. Levels 1 and 2 are the real __language_short_order_tab and __language_long_order_tab, which reproduce the author's own complaint about Swedish precisely -- a-ring and a-umlaut both fold onto a, and o-umlaut onto o",
  'locale upper$':
    "locale.library's own ISO-8859-1 code table, so Locale Lower\$, Upperchar and Lowerchar are all one lookup. What has no counterpart -- the German sharp s, the division and multiplication signs sitting inside the accented runs -- comes back unchanged because the table maps it to itself, not because of a special case in the port. NOTE that a real .language file can override the mapping and none is modelled: the built-in English locale is what answers, deliberately, so that a census run stays reproducible",
  'emit catalog description':
    "Opens the file the way the routine does -- `move.l #\$3ee,d2` is MODE_NEWFILE and `jsr -\$1e(a6)` is dos.library Open, after `cmpi.w #\$25,\$14(a0)` checks for dos.library 37 or better, which is the doc's [2.0] marker -- and every Catalog String\$ call thereafter appends an entry, emitted BEFORE the lookup (\$57a precedes \$592) so the DEFAULT string is what gets recorded rather than the translation. NOTE that the entry LAYOUT is this port's own: routine 16 writes it, the disassembler loses that routine to AMOS's own call markers (the \$feXX words are macros, not 68k), and the binary holds no template string to read instead. What is written is the catcomp description shape the file exists to feed. A program that only hands the file to a translator will not notice; one that parses it byte for byte might",
  'jvp bin sort':
    "Faithful, including two defects of the library's that a program can see. The first LOSES A RESULT: the read-out ends by climbing to the parent and, on finding itself back at the root, testing only foer[0] and efter[0] -- never skrevet[0] (source:312, binary \$3e2). The root is therefore emitted only by the branch that descends into a right child, so when element 0 is the list's MAXIMUM it has none and its index is never written to DEST. The gap is always the last entry, because a maximum sorts last, and it hides on a real machine because DEST is normally a fresh bank or an integer array -- both zero -- and the value missing is index 0, so the last row of a sorted listing quietly shows the first record. The second is the insert loop running once before its bound is tested (SO_LE1 adds 4 to d6 and only then compares), so ANT of 0 or 1 sorts a phantom element read four bytes past the address list and writes two longwords into a DEST the doc sizes at 4*ANT. Both are reproduced. What is NOT reproduced is what happens after either overruns its buffer: the doc's own warning is 'The memory area is NOT checked in any way, so make sure you got it right, or CRASH', and here reads outside a resolved region answer 0 and writes outside it are dropped. The two index-chasing loops also carry an iteration cap the library has no equivalent of, because a corrupted workspace that would crash a real Amiga would otherwise hang this",
  'jvp str$':
    "Faithful to the intent, and the shipped binary does not quite express the intent. The length pass reaches the StrLen table through `adda.l \$0.l,a0` at \$558 -- absolute address zero, not the extension workspace. The source line it came from is `add.l StrLen-MB,a0` (source:451), where StrLen-MB is 0, and the assembler took that as an absolute read of location \$0 rather than the intended add of a1. It works on the machine it shipped for only because location 0 on a booted Amiga holds 0: ExecBase lives at 4 and the reset vectors below it are dead once the ROM overlay is off, so a0 lands on the workspace after all. The second pass reads the same table through a1 correctly. This port does what the routine means; a program cannot tell the difference on real hardware, and there is no location 0 here to read",
  'jvp msg bank':
    "The bank number, recovered differently. The library reads `move.l -\$10(a0),d3` -- the longword sixteen bytes before the bank's data, which in AMOS's bank list is the number field (+Lib.s:7920 matches on `cmp.l 8(a1),d0` against a data address of node+24). Banks here have no list node in front of them, so the number comes from finding which reserved bank the stored address falls inside. Identical for a bank number, which is what the keyword is for; for a program that gave Set Msg Bank a raw address instead, this answers 0 where the library would hand back whatever sat in the sixteen bytes below it",
  'init bpl scroll':
    "The table is copied, the guard is honoured -- nine longs, error 6 if any is zero -- and the flag Start Int waits on is set, so the error behaviour a program can observe is exact. What does not happen is any scrolling: the interrupt this arms is 68k inside the library that rewrites copper bitplane pointers every frame, and there is no interrupt here to run it in. Marked '(Privat)' by the author, and reached in the demos only through Start Int's error path",
  'start int':
    "Faithful. Worth recording because the first reading was wrong: it looked as though this gated the whole interrupt including the five timers, and it does not -- timer.amos and timer1.amos never call it, and their timers run. So the interrupt is installed when the library loads and always maintains the timers and the mouse words; the flag at workspace+\$00 that Start Int sets gates the bitplane scrolling alone, which is why it refuses with error 5 until Init Bpl Scroll has given it a table",
  qsort:
    "Faithful, a Hoare partition over 32-bit values with the pivot from the middle element and a SIGNED comparison (`cmp.l`). `first` and `last` are element indices, which the routine shifts into byte offsets itself. The only argument check is `cmpa.w #0,a0` -- and CMPA.W sign-extends its immediate to a longword before comparing, so what it rejects is a zero ADDRESS, not an address whose low word happens to be zero, which is a distinction the port has to get right because bank addresses here are page-aligned",
  'jd toggle click':
    "Routine 13 (\$2da) is not one flag but FOUR drives: the body runs with d0 = 0, 1, 2, 3 and for each does CreateMsgPort (-\$29a), CreateIORequest (-\$28e, \$30 bytes), OpenDevice on 'trackdisk.device' -- the only device name in the hunk -- then `movea.l \$18(a3),a0 / bchg.b d0,\$35(a0)` on the unit, and CloseDevice / DeleteIORequest / DeleteMsgPort. A unit that fails to open is skipped silently, so a one-drive machine toggles one bit and a four-drive machine four, independently. DEVIATION: the state is kept and nothing clicks. It toggles the noise a floppy drive makes while polling for a disk -- 'wechselt Status des Laufwerk-Klickens' -- and there is no drive here to make it, so every OpenDevice would fail and doing nothing is the faithful answer; one boolean stands in for the four so a program toggling and re-toggling sees a consistent state. Recorded rather than dropped, the same treatment the printer and serial settings get: a program can set it, and it applies to hardware that is not attached",
  'jd match':
    "Faithful, and worth recording because the library's own manual disagrees with itself. Two entries are HEADED 'Jd Compare' and 'Jd Compare Nocase', but their Syntax lines read `X=Jd Match(A\$,B\$)` and the token table names them `jd match` and `jd match nocase`. The headings are stale; the table is what a program tokenises against. The matcher is the AmigaDOS one LDos already needed, shared rather than written twice -- the manual documents the same syntax down to `%` matching nothing -- and the `star` flag it takes is precisely what Jd Star Joker On/Off sets",
  lrol: "The manual calls it 'a logical shift left' and the library's own error message agrees -- 'You can only shift 31 bits a time!' -- but routine 85 (\$3af6) is `rol.l`, a rotate: the bits that leave the top come back in at the bottom. `Lrol(8,\$FF000000)` is \$FF here and would be 0 under the prose. The binary wins, the same rule that settled LDos's crypt routines. The 8-at-a-time loop above it is only the 68k's immediate-shift limit, not part of the meaning, and the bound `cmp.l #\$1f,d0` is UNSIGNED so a negative count fails it exactly as 32 does",
  lror: 'The same rotate as Lrol, `ror.l` at \$3b1e, and the same note applies to the manual calling it a shift',
  lstrcmp:
    "Faithful to what the routine does, which is not what the manual sells. The prose promises national characters -- 'much better results than AMOS' built in routine, which doesn't know ANY national characters!' -- and the routine really does carry the table to do it with: 256 bytes at \$3bea holding the accented letters folded onto A, E, I, N, O, U and Y. It loads that table's address into a0 at \$3b6a and then never indexes it; the comparison at \$3ba6 reads the string bytes straight. So this build sorts by byte value, Chr\$(196) lands after 'Z' rather than beside 'A', and the feature is present in the file and absent from the behaviour. A second wrinkle, latent: taking the shorter length uses `move.b d1,d0` into a word register, so a string of 256 characters or more compares over the wrong length",
  lcompress:
    "The format is read out of routines 83 and 84 rather than documented anywhere -- LZ77 with a run case over a 16-bit control-word bitstream, distances to 4098, matches to 271. Faithful including the matcher, which is one candidate per position from a 4,096-slot hash of the next three bytes, so the packed bytes a program gets should be the packed bytes it got on the Amiga. NOT verified against a sample of real output, because none is to hand: the claim rests on the disassembly, not on a diff. The \$4000-byte table the original allocates is an implementation detail and is allocated inside the packer here; its failure error, 'Not enough memory to compress!', is kept because a program can see it",
  ldecompress:
    "Faithful, including a wart worth stating plainly. The decoder tests for end-of-input only when it refills a control word (`cmpa.l a5,a3`, \$3a20) and otherwise runs all sixteen items of the word; Lcompress does not pad its final group. So a stream whose last group is partial is decoded past its end, and Ldecompress writes up to fifteen extra bytes and returns a length that counts them -- which is what the manual's 'you must keep track of how large this bank need to be yourself' is really warning about. DEVIATION: on the Amiga those trailing bytes are whatever memory followed the compressed data and so are undefined; the reads past the end give zero here. The count matches, the contents cannot, and a program that trusted them was reading uninitialised memory on the real machine as well",
  'lhicol on':
    "The flag itself is a byte in LDos's workspace and does nothing on its own; what it gates is Lansi's handling of SGR 2, which raises pens into 8-15 (`add.b \$2b22(pc),d0`, \$2a32). The offset applies to the PEN only -- the paper path at \$2a1e has no counterpart -- so backgrounds stay in 0-7 in either mode, and SGR 0 clears it. 16-colour mode is the default, as the manual says, which is why the keyword that exists to be called is the Off one",
  'lset var':
    "Writes a file into ENV:, which is what a global environment variable actually is — SetVar with GVF_GLOBAL_ONLY does exactly this — so the value is visible to Dir, to the browser file panel and to anything else that reads the filesystem, and outlives the program the way it does on the real machine. NOTE: the manual's 50-character limits on name and value are advice, not a check — routine 64 ($24da) measures the value's length only to pass it to SetVar and counts to nothing, so they are no longer enforced here either. Ldelete Var is not symmetrical with it: routine 66 ($25dc) raises error 18 on an empty name where this one hands the empty name straight to SetVar. Case-insensitivity comes free from the filesystem, which is case-insensitive for the same reason AmigaDOS is",
  'ldisk font':
    "Reports whether the named font exists in the mounted Fonts: drawer and invalidates the disc font list so Get Rom Fonts picks it up, which is what the keyword is for. Two documented behaviours are not reproduced: it cannot distinguish 'already in memory' from 'not on the disk' (both return false, as the manual allows, but for the wrong reason), and the real routine 'is designed to always try to scale the selected font with a best match, it may return true even though the requested font wasn't available' — no scaling happens here, so a near-miss size fails where the original would succeed",
  'llobuffer':
    "The manual calls this keyword Llowbuffer; the token table in the library says Llobuffer, and the table is what a program is actually written against. DEFECT: it does NOT convert A-Z only, whatever the manual says. Routine 45 (\$1c72) tests `cmpi.b #\$3f / bls` and `cmpi.b #\$5c / bcc`, which pass \$40..\$5b — so `@` becomes a backtick and `[` becomes `{`, one out at both ends. Lupbuffer's equivalents (\$60 and \$7b) are exactly a-z, which is what makes this a slip rather than a convention. Reproduced. The two also disagree about their far end: routine 45 tests for the end of the range BEFORE its increment and routine 44 after it, so Llobuffer includes STOP and Lupbuffer excludes it. One instruction's position, and no manual could distinguish them",
  'lchk data':
    "The manual gives no algorithm, only 'CHK will contain the checksum itself'. This is the standard AmigaDOS block checksum — the 128 longs of a 512-byte block sum to zero — and it is verified two ways: against real disk images from the corpus, where the value computed over a genuine root block equals the one already stored there, and now against routine 67 (\$2634), which is 36 bytes and holds out long index 5 (offset 20) before a plain `neg.l` with no end-around carry",
  'lchk boot':
    "Likewise undocumented, and a different algorithm — an end-around-carry sum over both boot blocks, holding out long index 1, complemented — exactly as the manual warns ('you must not use Lchk Data for the bootblock and Lchk Boot for datablocks'). Verified against the stored boot checksum of real disks, and against routine 68 (\$2658). DEFECT: the complement is `neg.l d3 / beq .done / subq.l #\$1,d3`, so a block whose other 255 longs sum to exactly zero answers 0 where the rule says -1. A special case with nothing behind it — the negation happens to be zero, not the checksum. Reproduced",
  'llargest free':
    "Reports the largest single allocatable block rather than the total, which is the distinction the manual draws against Chip Free/Fast Free: 'This value is NOT the same as the AMOS commands Fast Free and Chip Free, they return total unallocated memory-size, not the largest size you can allocate in one bank'. Nothing here fragments, so the largest free block genuinely IS the total free -- which is what exec answers and what TURBO's Chip Largest returns. Answering that would make this keyword identical to Chip Free and contradict its own manual, so the figure is the pool's free total capped at half a megabyte. That ceiling is this port's invention rather than the library's: LDos got its number by walking a real free list, and there is no free list here to walk",
  'lcat type':
    'Returns fib_DirEntryType from a real AmigaDOS FileInfoBlock — 2 for a directory, -3 for a file, not 1 and -1. The manual only says "positive ... or negative", which several values satisfy; the disassembly is a bare move.l $4(a0),d3 over the FileInfoBlock, so the entry type is handed back verbatim. Every sibling accessor indexes the same structure at its documented offset',
  'lfile type':
    'Returns the same fib_DirEntryType values as Lcat Type (2 and -3). Its own routine could not be decoded cleanly — the success path goes through an AMOS library-call macro capstone does not recognise — so this is inferred from the sibling keyword, which is documented in identical words and demonstrably returns the raw entry type',
  'lcat first':
    "A lock, not a first entry: it returns the directory and Lcat Next walks the contents, which is AmigaDOS Examine()/ExNext() rather than AMOS's Dir First\$/Dir Next\$. The manual says as much and the author's own Lrecursive.AMOS settles it — the result of Lcat First is discarded there and every entry comes from Lcat Next. What it RETURNS was the open question, because the manual calls it 'the file- or directoryname' in one place and 'the path, requested by you' in another and no example prints it. Routine 20 (\$1466) settles it: `lea \$8(a0),a0` on the Examined FileInfoBlock is fib_FileName, so the answer is the NAME of the locked object and not the path — \"DH0:top\" answers \"top\", and a volume root answers the volume name without its colon. The port returned its argument until this was read",
  'lcat blocks':
    "Disassembly shows the real routine simply returns fib_NumBlocks from the FileInfoBlock — the filesystem's own count, including the file header and any extension blocks. There is no block accounting in a virtual filesystem to produce that from, so this reports ceil(size / 512), the FFS data-block figure the manual quotes: right in magnitude, low by the filesystem's overhead, and approximated for exactly that reason rather than from any doubt about what the original does",
  'lcat push':
    "The real Lcat Push writes a lock and a FileInfoBlock into 264 bytes of a bank the caller reserved — 4 plus 260, which is exactly what routines 70 (\$32f4) and 71 (\$3336) move. Here the scan is parked beside the bank, keyed by the address, and only a marker byte is written into it. Programs that follow the manual — reserve a bank, advance by 264 per level, pull in reverse — behave identically; a program that inspected or copied those 264 bytes would not, and the manual's warning that a bank holding something else 'MAY crash if you're unlucky' has no counterpart here. Neither routine validates anything, which has two consequences now reproduced: pushing with no catalogue open stores a null lock rather than doing nothing, and pulling a bank of zeros is SILENT — the documented 'No more entries in this dir' comes from the next Lcat accessor finding the null at \$294, not from the pull",
  'ldev first':
    'Walks the mounted volumes and then the assigns, returning names without a colon as the manual specifies. The block of device information the real call writes to ADR — device type, unit number, handler name — is not modelled, so the address argument is accepted and ignored',
  'ldev next':
    'Continues the Ldev First walk; see that entry for what is not modelled',
  'lldir$':
    "LDos keeps its own current directory, which is the entire reason the keyword exists: the manual explains that Ldos never notices a Dir\$ change, so a relative Lopen after one would fail. That separation is reproduced, including the trap — set Dir\$ without calling Lldir\$ and LDos keeps using its own path. Routine 82 ($37de) adds two error arms the manual does not mention: an empty string is error 18 and anything that will not Lock is error 22, \"LLdir\$ can't find directory!\". Lock does not care whether its target is a directory, so the message is broader than the test. NOTE: the routine leaks a lock per call — neither the new one nor the one CurrentDir hands back is ever released — and there is nothing to reproduce here, the current directory being a string",
  'lset comment':
    "Raises error 5, \"Invalid comment\", above 79 characters rather than truncating — `cmp.l #$4e,d0` against the length less one in routine 15 ($11e8). The comment is staged in the shared FileInfoBlock's own +$90 field before SetComment is called, so a running Lcat scan loses its comment; that is invisible here because a scan holds its entries rather than a struct",
  'lset prot':
    "Two error arms, both from routine 17 ($129c): an empty name is error 3 and SetProtection answering zero — what a name that does not exist gives — is error 6. Unlike Lset Comment it does not lock or Examine, it hands the name straight to dos.library. DEVIATION: the mask goes to SetProtection as a full longword and is kept as a byte here, so the four AmigaDOS-reserved upper bits do not survive; nothing reads them, Lget Prot coming back through the same byte",
  'lget prot':
    "Protection bits are stored per path in the virtual filesystem, since most volumes here are read-only (a disk image, a zip) and the bits must be settable regardless. Nothing enforces them: the manual notes that even real DOS 'doesn't care about some flags when it comes to directories' and that 'if you are running Kickstart 1.2 or 1.3 DOS neglects most flags', so unenforced flags are within the documented range of behaviour — but here no flag is enforced at all",
  'lset file date':
    "Stores the datestamp, minutes and ticks — routine 81 (\$3772) writes them into a DateStamp and calls dos.library SetFileDate, whose result comes back verbatim, so a name that does not exist answers 0. The virtual filesystem does not otherwise track modification times, so a file that has never been stamped reads back as 1 Jan 1978 rather than when it was written — deliberate, because a real clock would make the corpus census non-reproducible. Two things in the routine cannot be reached or reproduced. Its `tst.w` on the workspace word at +\$2fa raises error 15, 'You need dos.library 37+', and the modelled machine is a 2.0+ one so the flag is set; Lwild and Lmatch share the same guard. And its empty-name check is dead code: `cmp.w #\$0,d0 / bcc` is always taken, because nothing is unsigned-below zero, so what an empty name really does is the same 65536-byte dbra overrun Lopen has",
  'ldate':
    "Converts a datestamp to YYMMDD. The manual bounds the range at 2099 ('which should be enough?') and specifies that a negative stamp returns 780101, both of which hold here; the two-digit year is ambiguous past 2000 in exactly the way the original is",
  'lmatch':
    "The pattern syntax is fully documented — ? # (a|b) ~ [abc] [~abc] a-z % and the optional * — and is implemented in full, including negation, which is why it is a backtracking matcher rather than a RegExp. What LdosV25.DOC never states is what a *successful* match returns, and routine 61 (\$23c4) settles it: `jsr -\$34e(a6)` is MatchPattern and its result is returned verbatim, so the answer is DOSTRUE (-1) or DOSFALSE (0). The LVO also settles that the match is CASE SENSITIVE — LDos calls ParsePattern/MatchPattern at -\$348/-\$34e and never the NoCase pair at -\$3cc/-\$3d2, unlike AMCAF and jd-k3. Three checks the manual does not describe: both strings are verified NUL-terminated (error 23) rather than the terminator being assumed, a pattern of more than 50 bytes including its terminator is error 16, and ParsePattern answering 0 — a pattern with no wildcards in it — takes that same error arm, which is what the 'or no pattern' in the message means",
  'lwild':
    "Returns ParsePattern's result verbatim — routine 80 (\$3724) is `jsr -\$348(a6) / move.l d0,d3` — so 0 for no wildcards, 1 for wildcards and -1 for a pattern that will not parse. The manual sanctions the middle case loosely ('TEST may contain anything (usually 1)') and says nothing about the third. It shares Lmatch's 50-byte limit (error 16) and the dos.library 37+ guard (error 15), but NOT its NUL-termination check: routine 80 hands ParsePattern a pointer into AMOS's string space and lets it read on until it finds a zero byte. Here the string ends where it ends, which is the same answer for any caller who follows the manual and appends Chr\$(0)",
  'lword':
    'A quoted word comes back with its quotes still attached, which the manual calls out as deliberate and surprising: a NULL word ("") returns two quote characters rather than an empty string, so callers can tell a quoted phrase from a bare one',
  'lskip':
    "Returns the address after the last skipped character. DEFECT: when every byte matches it answers STOP-1, not STOP. Routine 48 (\$1d84) puts `move.b -(a0),d5` on the shared exit, where it correctly undoes the post-increment of a byte that did not match but also fires on the path that simply ran out of range and had no increment to undo — so `Lskip(c, X To X)` answers X-1. Reproduced. A STOP below START is error 8. Clipped to the memory region the start address lands in, where the real machine would scan on into whatever followed",
  'lback hunt':
    "Scans backwards over STOP..START-1 — the comparison in routine 74 (\$33a8) is `cmp.b -(a0),d0`, a PRE-decrement, so START's own byte is never examined — and returns STOP when the character is absent. The manual does not say what an unsuccessful search returns, and the routine cannot distinguish it from a hit at STOP either; STOP is the boundary the search ended at rather than a documented sentinel. The reversed argument order gets its own error: STOP above START is 18, where the three forward-running range keywords use 8",
  'lold':
    "NOTE: the manual is wrong about this one and the binary settles it. LdosV25.DOC says 'Lold - MAY CURRENTLY NOT BE USED!!  These are here for future versions, currently the compiler seems to mess up values of reserved variables', and this port read that as a no-op instruction. Routine 7 (\$1014) is `moveq #\$0,d2 / moveq #\$0,d3 / rts` — a FUNCTION returning integer 0, which is the MODE_OLDFILE argument Lopen takes. The token table agrees it is a function. The author's warning is about his compiler, not about the library, and `Lopen 1,\"x\",Lold` is a working line",
  'lcreate':
    "As Lold, and the same correction: routine 8 (\$101a) is `moveq #\$1,d3 / moveq #\$0,d2 / rts`, integer 1, the MODE_NEWFILE argument. Lopen tests the mode with `tst.w`, so any non-zero word creates — which is why a constant of 1 is all this needs to be",
  'lbstr':
    "The manual warns 'No check is done to see whether the bufferlimit was exceeded or not so make sure there is room for the string'. That overrun is precisely what a port cannot reproduce: the write is bounded by the memory region it lands in, where the real machine would run on into whatever followed the bank",
  'lsave':
    "Returns the bytes written, and the manual's disk-error cases ('disk full, or write error', dos.library returning -1) have no counterpart in a browser filesystem, so a short write can only happen when the source address runs out",
  'set tempras': 'size/address validated and stored; the chunky renderer needs no temporary raster buffer',
  bstart: 'the previous-program bank list needs a parent program (editor/Prun) — standalone the faithful failure paths apply',
  blength: 'the previous-program bank list needs a parent program (editor/Prun) — standalone the faithful failure paths apply',
  bgrab: 'the previous-program bank list needs a parent program (editor/Prun) — standalone the faithful failure paths apply',
  bsend: 'the previous-program bank list needs a parent program (editor/Prun) — standalone the faithful failure paths apply',
  'disc info$': 'format is exact (volume name + 10-char left-aligned free bytes); the free count is the Dfree constant — browser storage has no real quota',
  dfree: 'no real quota in the browser store — a large constant',
  amal: "the Amiga tells a bank program number from an AMAL string by whether the argument is below 1024, too small to be a string pointer (InMb1 +Lib.s:11857); our values are typed, so anything numeric takes the bank path and a number above 1023 is a program number here rather than a stray pointer dereference",
  anim: 'the bank-program/string discrimination is by value type, like amal',
  'move x': 'the bank-program/string discrimination is by value type, like amal',
  'move y': 'the bank-program/string discrimination is by value type, like amal',
  prun: "the editor keeps a Prun'd accessory resident and re-enters it in place (Prg_AccAdr/Prg_DejaRunned, +ILib.s:1552), so on the Amiga an accessory Prun'd twice can still be holding its variables; with no editor to own that residency the port loads a fresh structure each time, which is the same path the Amiga takes for a first Prun. Prg_Edited, the Direct-mode ban and the Mon_Base monitor check have no counterpart here either. End, Edit and Direct all return to the caller, as they do on the Amiga where they share the editor-return path that pulls the stack (rErr1 +ILib.s:1401); Stop instead halts the machine, since our 'stopped' is what the census reads",
  amplay: "SetPlay (+W.s:7937) walks one list holding all four slot kinds per channel (Amal, Anim, Move X, Move Y) and so also writes the internal registers of the STOS slots of the channels below the last; only the AMAL slot's registers are reachable from BASIC or used by PLay, so the port writes just those",
  autoback: 'mode 1 treated like 0',
  rainbow: 'rendered per scanline by the copper-walk compositor across the PAL overscan window (hardware lines 26-311)',
  'copper off':
    'the interpreted list now takes its fetch geometry from the registers rather than from the screen the pointers happen to hit. BPL1PT is walked as a byte pointer, so its remainder inside a row is a horizontal skew of 8 pixels a byte; BPL1MOD is added at the end of every line, which is what makes a wrong modulo shear or repeat the picture and what interlace falls out of; DDFSTRT/DDFSTOP set the fetched width and where the data lands (first pixel at DDFSTRT*2+17 lores, +9 hires — the constants AMOS inverts at +W.s:6293); BPLCON1 PF1H delays the playfield; DIWSTRT/DIWSTOP window it; BPLCON2 PF1P decides which sprite pairs are in front; and SPRxPT are decoded as real Amiga sprite structures (POS/CTL, two bitplanes, ATTACH), which is what Copper Off hands the program when it clears T_HsChange (+W.s:6822). The register file persists across frames as the hardware\'s does, and the pointer is not reloaded at the vertical blank either — a list that sets it once really does march off the bitmap on its second frame. The handover resets to black, which is faithful: the OFF path swaps in a list that is nothing but an end marker. Remaining: BPL2MOD is tracked but a chunky screen has no independent even-plane pointer for it to move, so it only matters for a dual playfield, which this path does not render; and the real machine also hides the mouse pointer',
  'cop logic': 'a mapped chip-RAM address; the system list is regenerated every vbl (the T_Actualise change-gating is not modelled)',
  hardcol:
    'FnHardcol +Lib.s:12353 -> HColGet +W.s:115, over a CLXDAT computed from where the sprites and playfields actually are. HColT (+W.s:159) is transcribed, so the bit layout is the hardware\'s: bit 0 playfield against playfield, 1-4 and 5-8 each sprite pair against playfield 1 and 2, 9-14 the six pair combinations. The two-bits-per-entry word the 68k byte-swaps into T_TColl is reproduced as the Col() set, and the function itself is true only for a sprite-against-sprite hit — a playfield hit fills the Col() bits without making it true, which is what the cmp.w #$0100 in HCol1 is doing. Deviation: the real register accumulates what the beam passed over during the frame and clears on read; this samples the current positions, which agrees for the usual move / Wait Vbl / test but not for a sprite moved twice within one frame',
  'set hardcol':
    'InSetHardcol +Lib.s:12346 -> HColSet +W.s:10018: CLXCON gets a fixed $F in the odd-sprite enables (AMOS never exposes those), the first argument in ENBP1-6 and the second in MVBP1-6, so a playfield pixel counts as solid when every enabled plane carries the matching bit',
  ldir: 'InLDir +Lib.s:5842 is InDir with ImpFlg set, and ImpFlg is the one thing ImpChaine (+Lib.s:5413) tests before it prints — set, the line goes to PRT_Print instead of the window. Same listing, printer sink, and there is no printer host here, so it is discarded exactly as Lprint is',
  'ldir/w': 'InLDirW +Lib.s:5793: the two-column form of the same, likewise to the printer',
  'read text':
    "InReadText1/3 +Lib.s:14707 -> IRText 14755: the ASCII reader is not native code at all, it is dialog program 1 of the system default resource bank, run on its own EcFsel screen sized PI_RtSx x PI_RtSy. The port opens the same channel with the same eight variables (0 = text address, 1 = title, 2 = the #HYP digit) and then sits in the reader's own loop, reading zone 5 the way Dia_GetValue does: a hypertext zone with no numeric position hands back its keyword buffer, which is what lands in Param$, and the dialog going undrawn (Dia_GetReturn -1) ends it empty. The file form loads into TempBuffer, which is mapped into the fake address space, so HT walks real memory as the 68k does. Deviations: the buffer length the 68k computes from the text size only ever sized its string heap, which this does not have",
  'set accessory':
    'the token table points this at L_InNull (+Lib.s:1474) and InNull is a single rts (+ILib.s:3748). The accessory flag is the editor\'s, not the interpreter\'s — which is why the Prg_Accessory test inside InPRun is commented out in the source. Running one directly does nothing, and that is the faithful behaviour, not a stub',
  'set pattern':
    'SPat +W.s:4730: positive numbers index the mouse bank past its first four images, which are the pointer shapes. That bank is baked in (bin/+AMOSPro_Mouse.abk, linked into the interpreter binary at +W.s:16795), so the system patterns are the machine\'s without anything having to be mounted; a loaded bank overrides it. A number past the end of the bank still falls back to a dither stand-in',
  'input$': 'keyboard form is non-blocking best effort',
  start: 'fake address space: Start()-relative arithmetic works, absolute hardware addresses do not',
  peek: 'addresses inside banks and screen bitplanes (Logbase/Phybase) resolve; other addresses read 0',
  poke: 'writes into banks and screen bitplanes render; writes elsewhere are ignored',
  'shade on': 'dither approximates the original shading',
  match: 'not-found result for closest index 0 returns -1',
  dir: 'plain listing; Set Dir width/filter cosmetic',
  'gr writing': 'JAM1/JAM2 identical for solid draws; XOR implemented',
  'wind size': 'resizes without preserving content',
  border: 'all styles render as the same simple frame',
  'sam raw': 'unmapped addresses play nothing (the real machine plays whatever memory holds)',
  music:
    'the one-vbl repeat latch is modelled: a trigger enables DMA over the whole sample and the repeat pointers are poked at the top of the next interrupt (Tracker +Music.s:1678-1688), so the first pass always plays in full. Remaining: the ~5-scanline wait between DMA-off and DMA-on inside a single frame (mt_music +Music.s:1774) is sub-frame timing this vbl-granular player cannot express',
  mubase: 'only the vumeter bytes (MB+0..3) of the data zone are mapped',
  'track play':
    'the one-vbl repeat latch is modelled (see music); the pattern argument is ignored ("not supported in this version" in the 68k too)',
  'med play': 'the replay reimplements the MMD0/MMD1 format (medplayer.library is not in the AMOS source): sampled instruments and the common effect subset; synthsounds are silent; CIA timing approximated at vbl granularity',
  'med midi on': 'flag stored; no MIDI output exists in the port',
  'sam swap': 'the swap is consumed when a one-shot ends; on a looping voice the Amiga swaps at the loop boundary, here it stays pending',
  'sam swapped': 'chunk-granularity 0 state (Sami_pos == one chunk) is not modelled',
  'noise to': 'the WebAudio sink snapshots the noise buffer at trigger; the per-vbl random refresh mutates the live buffer as on the Amiga but is only re-heard on retrigger there',
  'led on': 'filter flag reaches the sink; audibility depends on the host audio implementation',
  'led off': 'filter flag reaches the sink; audibility depends on the host audio implementation',
  'load iff':
    'every ILBM in the corpus (38 files) is decoded and checked structurally — one chunky byte per pixel, indices within the declared plane count, RGB4 palette entries — and round-tripped through our own encoder back to identical pixels, so the ByteRun1 unpacker cannot drift unnoticed. Palette-only pictures (BMHD 0x0 with only a CMAP, as the Plasma procedures ship) load their colours without disturbing the bitmap. HAM/EHB decode and render correctly. What is still not possible is a byte-for-byte comparison against the 68k loader itself, since running it is out of scope',
  centre: 'Border$ escapes inside the text are printed, not measured, when centring',
  print: 'Print # channels unsupported',
  input: 'line editing keys are host-side, not the AMOS line editor',
  timer: 'writable, drives the frame clock directly',
  rnd: 'Rnd(n) mixes a statement-paced pseudo-beam instead of the free-running raster, so runs stay reproducible; Rnd(-n) is the pure generator exactly as on the Amiga',

  // --- JD 5.3/5.9, JD Prt and JD Colour: where the port answers differently ---
  'jd exval$':
    "The original's own bug, not reproduced. The two-argument form does not set the pad character at all (+|jd.s:1810) -- it branches straight into the shared routine and inherits whatever the last three-argument call left in the library's data zone, which on a fresh library is '0'. Reproducing a stale global across calls would be faithful to something no program can be relying on deliberately, so the two-argument form pads with '0' every time. A program that has already asked for spaces once sees the difference",
  'jd ror$':
    "An empty string. The routines do not check for one (+|jd.s:2903): Ror$ reads `(a0,d0.w)` with d0 = -1, which lands on the high byte of the length word, and then runs a dbra from -2 -- 65,535 iterations over whatever follows in the string bank. That is a crash rather than a behaviour, so an empty string comes back empty here. Jd Rol$ is the same routine one label up",
  'jd rol$': 'See Jd Ror$: an empty string is a runaway dbra on the machine and comes back empty here',
  'jd get string$':
    "The value is right and the editing is not. The routine paints a field of exactly maxlen characters and runs its own editor inside it, with its own keys; this reads a line through the host's input path and bounds the length the same way. What a program gets back is the same string within the same bound; what a person sees while typing it is the host's line editing, not JD's. Jd Get Number is the same routine with a numeric conversion on the end",
  'jd get number':
    "See Jd Get String$: the bound and the value are faithful, the field painting and the editing keys are the host's",
  'jd find':
    "Answers 0 for a STRING array. The routine (+|jd.s:3878) walks the array block element by element and hands each to the same pattern matcher Jd Compare uses; a string array's elements are POINTERS on the machine, and this port's arena maps the numeric cells rather than the string blocks behind them, so there are no pointers to follow. Numeric arrays are unaffected and match the routine",
  'jd array$ clear':
    "Does nothing to a string array. The routine (+|jd.s:6053) points every element at one freshly allocated empty string, so a program reads the array back empty; here a string array is not in the mapped address space at all -- Array(A\$(0)) does not answer an arena address the way it does for a numeric array -- so there are no element pointers to repoint, and the contents survive. The same missing pointers are why Jd Find answers 0 on a string array. The numeric Jd Array Clear is unaffected and zeroes every element including the last",
  'jd time$':
    "Reads the host clock, where the routine reads the hardware. Jd Time$ and Jd Date$ poke the battery-backed clock chip at $DC0000 nibble by nibble (+|jd.s:1205) -- an MSM6242B, which only exists on a machine that has one fitted, and on an A500 without one the routine returns whatever unmapped address space answers. Here it is always the real time, which is the useful reading of a clock chip that IS present. Jd Setdate and Jd Setclock, which WRITE that chip, are n/a for the same reason from the other direction",
  'jd date$': 'See Jd Time$: the hardware clock chip at $DC0000, answered from the host clock here',
  'jd spread':
    "The end state, not the animation. Spread writes its finished line -- which is where the effect ends up -- and Tscroll writes the text once and then blocks for the input that would have stopped it, so a program moves on at the same point in its own logic. What is lost is the motion between those two states, which is the port-wide timing deviation (#87) rather than a JD one",
  'jd tscroll':
    'See Jd Spread: the console state a program can observe afterwards is kept, the motion between is not',
  'jd type':
    "Two parts of this do not cross. The sound argument: the routine's first act is to ask AMOS for eight bytes of chip RAM and copy a two-longword square wave into it (+|jd.s:3486), which it plays as a keyclick per character -- a raw audio-channel poke of a sample this port has no way to route, so the argument is accepted and ignored rather than refused, because a program passing 1 still wants its text. And the per-character delay: the whole string reaches the console in one statement where the real thing spreads it over delay*length vertical blanks, which is #87 again",
  'jd reduce dim':
    "The reduced bound is recorded but not enforced. Our arrays are JS values and the interpreter does not index through the header word, so shrinking a dimension changes what Jd Get Dim reports and what Jd Array Clear wipes -- but an out-of-range subscript is still caught by the interpreter's own bound rather than by the reduced one. Recorded rather than papered over: making every array access in the port go through the arena would be a large change for one keyword",
  'jd dpath':
    "An empty path. Routine 160 in the 5.9 binary ($804e) starts its counter at the string length and leaves the loop on `subq.w #1,d3 / beq`, so a zero length never fires it and the routine walks backwards through memory until it chances on a ':' or a '/'. That is a runaway read, not an answer; here an empty string gives 1, the position it would report for a bare filename. The routine's other oddity IS reproduced: character 0 is never examined, so \":file\" answers 1 rather than 2",
  'jd cpu':
    "Answers 68020, and Jd Fpu 0 and Jd Chipset 2, for the machine this port already models rather than for a real one. The routines read exec's AttnFlags and GfxBase's ChipRevBits0 (routines 162-164 in the 5.9 binary, $8084/$80c2/$80ee), which nothing here has. Chip Free and Fast Free answer for 2MB of chip plus a fast board and TURBO's Cpu Info answers 20 -- that machine is an A1200, so: an 020, no FPU, AA. A program branching on any of the three takes the path an A1200 would",
  'jd fpu': 'See Jd Cpu: 0, a stock A1200 having no coprocessor',
  'jd chipset': 'See Jd Cpu: 2, AA',
  'jd spline':
    "Draws in the current AMOS ink. Routine 84 (+|jd.s:4028) goes through graphics.library's Move and Draw on the AMOS RastPort, so on the machine it uses the RastPort's FgPen rather than Ink -- the same route Jd Draw Angle and Jd Grid take, and the same note applies to all three. The curve itself is exact, including the 16-bit truncation at every stage of the de Casteljau",
  'jd textfont':
    "Opens a real .font through diskfont and hangs it on the current screen's rp_Font, so AMOS's own Text draws through it too -- which is what the manual means by \"for writing with >>Text<< or >>Jd Print<<\". Jd Char X and Jd Char Y report the OPENED face's tf_XSize and tf_YSize, as set_font does (+|jd.s:4177, `move.w 20(a0),d0 / move.w 24(a0),d1`). DEVIATION on failure: with no such face the 68k leaves font_font zero and reads those two words through it anyway, picking up whatever sits at $14 and $18 and calling SetFont(rp, NULL) with it. Here the face is cleared and the metrics are left as they were, because every value this port could invent for a null dereference would be a fiction",
  'jd print':
    "Draws through the face Jd Textfont opened, at the TEXT cursor: Move(rp, X*fx, (Y+1)*fy-2) then Text, then Locate(X+len, Y) (routine 89, +|jd.s:4215). Two of the routine's own approximations are kept: the baseline is (Y+1)*fy-2 rather than the font's tf_Baseline, which is right for the eight-pixel faces JD was written against and off by a little for anything else; and the cursor position is window-relative while the RastPort is the screen's, so text printed in a moved window lands at the screen coordinates that cell would have had at the origin. With no face open it branches to nojdf and prints through the console, unchanged",
  'jd checkprt': 'Answers 0, no printer. See Printer Online: nothing is attached unless the host says so',
  'jd key to asc':
    "Answers 0, always -- the one keyword in the Colour library whose behaviour is not reproduced. Routine 78 ($2a32 in the 2.0 binary) walks a 44-byte key table at $1bc of the structure a5+$228 points at and answers with the byte at the matching position of a second table at $1e8. The manual's example is `Jd Key To Asc(253) -> 49`, and 253 is not an Amiga rawkey, so those tables are AMOS's own rather than the keyboard's. This port does not carry them, and 0 is what the routine itself answers for a code it cannot find; inventing a mapping that satisfied the one documented example would be worse",
  'jd fit':
    "Answers 1 and 0, not AMOS's -1 and 0 -- `move.l #1,d3` is routine 55's true path (+|col.s:1862). Faithful, and worth the note because a program writing `If Jd Fit(n,3)` cannot tell while one comparing against True gets the wrong answer. A zero divisor is `divs #0`, a trap on the machine; here it answers 0",
  'jd swap colours':
    "Routines 26 and 27 (+|col.s:657, :679) validate nothing at all -- an index past the palette reads and writes through get_colour/set_colour whatever is there. Here an out-of-range index is ignored instead. Jd Copy Colour is the same",
  'jd spread palette':
    "Faithful including the guards, which are stricter than they look: routine 7 (+|col.s:261) demands both arguments in 1 to 31, so COLOUR 0 IS REJECTED with error 23 rather than clamped, a reversed pair is swapped and retried, and a gap under two returns silently. The ramp runs through the FFP library accumulating one step per component with SPFix at each entry, so it truncates rather than rounds and the drift is part of what it looks like; that is reproduced. What is not is FFP's own precision -- the steps are computed in doubles here, which can differ in the last nibble on a long ramp",
  'jd prt center':
    "1.3 and 1.4 disagree, and the port answers per bound version rather than picking one. Center is `ESC [2 F` in the 1.3 source and `ESC [3 F` in the 1.4 binary -- 3 is the ANSI code for centring, so 1.4 fixed a bug. Jd Prt Pline Up is the other one: `ESC L` in 1.3, `ESC I` in 1.4. The remaining 56 shared sequences are byte-identical, and a test asserts that",
  'jd prt shade':
    "The five numeric Prt keywords call intuition's GetPrefs, poke one field of the Preferences structure and call SetPrefs. There is no system Preferences here, so they write rt.ioports.printerPrefs instead and nothing reads it yet -- Printer Dump does not consult the shade, aspect, image, threshold or density a program set. The bounds, the error 23 on each, and Shade 3's odd storage (grey scale 2 as a bit, with 1 in PrintShade) are the routines' own and are kept",

  // Interface language caveats
  'dialog open': 'SM screen-drag is a no-op; CA (machine code) raises a function call error; edit fields use a simplified line editor',
  'fsel$': "Start_FSel -> End_FSel (+Lib.s:17756-19292) over dialog program 2 of the system resource bank: config-sized screen, the FsV_ variable block, Fs_NomDir's path/filter split, the incremental Fs_First/Fs_Next read with its sorted-insert view bump, Fs_GetName's Sizes column, all twenty Fs_Jumps zones, the Store directory cache, Fs_Help type-ahead and the AppCentre slide. Deviations: the listing is read one entry per frame on the one thread rather than by the CreateTask background task the 68k starts, so nothing else runs during a read the way it would there; Fs_LowMemory's cut-down selector is unreachable because there is no 32K/12K AvailMem cliff to fall off, and neither is Fs_ScOpen's 320x128 retry; LimitM's mouse clamping is not applied, the port having no pointer limits to save and restore; and the Help key that reaches the type-ahead is bound by the bank's script as KY $DF, so it depends on the host mapping a Help press to that scancode",
  'psel$': 'FnPSel (+Lib.s:6771) is a bare rts — four token-table variants and no implementation anywhere in AMOS Professional, so the keyword returns its last argument untouched. Nothing is approximated: this is what the original does',
  'resource$':
    'all six blocks are present. -1..-1000 read the interpreter-config messages (Sys_Messages), still a transcription and sparse where the original is; -1001 and deeper read the editor tables generated byte-for-byte out of +Editor_Config.s by src/cli/genedmsg.ts (Ed_Systeme, the menu block from bin/Editor_Menus.asc, the editor messages, the test-time errors and the run-time errors), and -6001 is a function call error as FnResource has it. Positive n needs a resource bank mounted',
  'set slider': 'system patterns come from the machine mouse bank (fixtures/machine); without it, dither stand-ins',
  'mouse zone': 'zones are a single global table, not per-screen (EcAZones)',
  'set bob':
    "InSetBob +Lib.s:12225 -> ResBOB +W.s:988. All four arguments are honoured now, including mask (BbACon), the blitter control word. Its SIGN chooses what it means, which the manual does not say and only BbS1a-BbS1d (+W.s:1425-1439) does: 0 is the default %0000111111001010 = $0FCA, negative is a minterm with bit 15 cleared and the channel-enable bits forced on, positive is the whole BLTCON0 used verbatim. An image with no mask clears USEA, giving $07CA, and that is how No Mask works — channel A is never loaded so it reads as all ones and $CA collapses from 'D = A ? B : C' to 'D = B'. DEVIATION: the blit evaluates the truth table per pixel per plane rather than per word, so the RESULT is the blitter's and the timing is not; and BLTCON1's shift, fill and descending-mode bits are ignored, since Set Bob only ever supplies BLTCON0",
  'amos to front': 'single-display host: the AMOS display is always at the front',
  'amos to back': 'single-display host: nothing to lower',
  'amos lock': 'the T_NoFlip flag is stored; no host flipping exists to suppress',
  'close workbench': 'no Workbench memory to free',
  'close editor': 'no editor memory to free',
  'dev first$': 'the device list is the virtual file system volumes and assigns',
  'prg first$': 'aliases Dev First$ exactly as the 68k does',
  'sprite base': 'read-only synthesis, rebuilt when the image count changes; pokes are ignored and in-place pixel edits can be stale until the count changes',
  'icon base': 'read-only synthesis like sprite base',
  hslider: 'system patterns approximated as dithers',
  vslider: 'system patterns approximated as dithers',
  array: 'int/float arrays map to live arena blocks; string arrays (pointer tables on the 68k) stay opaque handles',
  varptr: 'arena slots: string blocks are snapshots that go stale on reassignment (as on the 68k); pokes flush back while the length matches',
  vdialog: 'integer reads of string-valued slots return 0 (raw pointers are not carried)',
  'dialog box': 'v$ seeds var 1 as a string, not an address',
  sin: 'FFP-precision (24-bit) result; matches mathtrans to ~24 bits, not necessarily the last bit',
  cos: 'FFP-precision result; last-bit mathtrans algorithm differences possible',
  inc: 'float targets get numeric arithmetic; the real machine mangles the FFP bit pattern',
  dec: 'float targets get numeric arithmetic; the real machine mangles the FFP bit pattern',
  add: 'float targets get numeric arithmetic; the real machine adds to the FFP bit pattern',
  using: "the '^' scientific-exponent slot is left literal (mantissa normalisation unverified)",
  'shift up': 'one shift per screen (the original has a single global shift); omitted wrap-flag defaults to wrap',
  'wind move': 'trail behaviour matches; the Wind Save clean-erase path is not wired to Move',
  'key shift': 'CapsLock reflects the physical key, not the latched toggle',
  every: 'fires at each statement rather than only at control points, and after (not during) a Wait — a timing nuance tied to the blocking model',
  text: 'single 8x8 face whatever Set Font selects; soft styles are synthesized approximations',
  bload: 'bounded by the destination region; the real machine would overrun into raw memory',
  'mouse screen': 'returns -1 when the pointer is over no screen (68k: EntNul)',
  'key speed':
    'parsed and discarded. Key repeat is generated by the host (the browser or terminal), not by us, so there is no delay/rate for this to set. Closing it would mean discarding host autorepeat events and synthesising our own repeats from the two arguments — real work in the input layer, not a missing line here',
  'menu called': 'items redraw every frame; (PR name) label procedures are not invoked',
  'menu movable': 'drag applies final positions — no XOR rubber band',
  'menu item movable': 'drag applies final positions — no XOR rubber band',
  'sprite priority':
    'HsPri +W.s:11374. Per-screen: the value is stored in the current screen\'s EcCon2 (PF1P), and on the second playfield of a dual pair it is redirected to the first screen\'s PF2P, so screens can order sprites against their playfields differently. The compositor picks the PF1P of whichever screen covers a sprite\'s scanline, and computed sprites (8+) now run through the real multiplexer (HsAff +W.s:11742): sorted by top edge, packed round-robin into the first channel whose previous occupant finished above them and which still has column-buffer room, with the mouse holding channel 0 and 16-colour sprites forced onto an even channel. That decides the pair, so it decides the priority. PF1P and PF2P are both live: they are not "sprites in front or behind" flags but the positions two playfields take in one interleaved stack with the four sprite pairs, so a dual pair can have a sprite between its playfields, and priority numbers alone can put playfield 2 in front of playfield 1 with PFBA clear. The compositor draws that stack a scanline at a time. Remaining approximation: a sprite wide enough to span several channels is drawn at the priority of the first, and hardware sprites ignore the 4-per-scanline DMA limit (a superset)',
  'set sprite buffer':
    'InSetSpriteBuffer +Lib.s:12290 with HsSBuf/HsRBuf (+W.s:11268/11311): the >= 16 check errors, and the size is stored as n+2 lines, leaving n words per multiplexer column. That budget is live — it bounds how many computed sprites can share a hardware channel. What it does not do here is allocate the chip-RAM column buffers themselves, so running out of them cannot fail the way it can on a real machine',
  'dual playfield':
    'pairing is per-screen (EcDual) as on the hardware, so several pairs coexist down the display, each in its own copper band, each with its own Dual Priority, and sprites layer between the two playfields per EcCon2\'s PF1P/PF2P. Remaining approximation: the pair renders under the system copper walk, so a Copper Off user list shows only the front playfield',
  'screen open': 'width masked to /16; the 1..1023 size bounds of EcCree are not enforced',
  'screen display':
    'the visible window w/h clips the composite; hardware scaling is not modelled. A Y below 26 or at/above 310 hides the screen COMPLETELY rather than clipping it, which is the original\'s own rule and not a bug here: MkA8 (+W.s:5955) drops the whole band when its start boundary falls outside EcYStrt-1..T_EcYMax-2. Programs use it as a hide idiom -- the Object Editor parks an 8-row strip with Screen Display 4,,20,, before positioning it each frame',
  'screen colour': 'HAM reports 64 — the real EcNbCol is stored as 64 by InScreenOpen, never 4096',
  'screen base': 'a read-only synthesized Ec control block (EcLogic/EcPhysic, geometry, EcNbCol, live EcPal, EcTLigne...); pokes into it are ignored',
  'set font': 'real Amiga diskfonts render when a Fonts: drawer is mounted (drop one in the browser); without one, the synthetic Workbench list with the 8x8 face stands in',
  'border$':
    'FnBorderD +Lib.s:14153 / Encadre +W.s:15169. The box characters are AMOS\'s own charset glyphs, not the ROM font\'s: bin/+WFont.bin is poked over codes 0-31 and 128-159 (+W.s:9640), and genfont.ts bakes that binary in, so the drawn cells are the original bitmaps byte for byte',
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
  free: 'FnFree +Lib.s:13600 garbage-collects then reports TabBas-HiChaine (free variable space); no variable arena exists here — returns a nominal figure',
  'chip free':
    'FnChipFree +Lib.s:2510 queries exec AvailMem(MEMF_CHIP). There is no Amiga allocator here, so the figure is modelled: an A1200-sized 2MB chip pool less what the program has actually allocated (chip banks, open screens\' bitplanes, sprite/icon banks). It responds to Reserve and Erase, which a constant did not — a program looping until chip memory ran out never terminated. The pool size is our choice, not the original\'s',
  'fast free':
    'FnFastFree +Lib.s:2517 queries exec AvailMem(MEMF_FAST). Modelled like chip free: a nominal 8MB fast pool less the non-chip banks in use. The pool size is our choice',
  lprint: 'InLPrint +ILib.s:5067 routes Print to the printer device; no printer host, so the arguments are evaluated (for side effects) then discarded',
  'dual priority': 'the EcE27 error message text is a guess — the string is not in the source tree',
  'hrev block': "RevBloc +W.s:12620 mirrors the block; the visible result matches, but the port reverses pixels directly rather than via AMOS's stored orientation flag (bits $C000)",
  'vrev block': "RevBloc +W.s:12620 mirrors the block vertically; visible result matches, but via direct pixel reversal rather than AMOS's orientation-flag mechanism",

  // --- Personnal ---------------------------------------------------------
  // Library bugs reproduced rather than fixed. Each is what the shipped
  // binary does; the tests pin them so they read as deliberate.
  'allow plane col':
    "reaches _BPlanesMask correctly but always sets CLXCON bit 0: the routine shifts the plane left six before `Bset d0,d1`, and Bset on a DATA register takes its bit number modulo 32, so n*64 is bit 0 for every n in range",
  'forbid plane col': 'the same modulo-32 Bset as Allow Plane Col — every plane clears the same CLXCON bit',
  'sprite col':
    "Personnal's own, registered under its slot (`ext13:sprite col`) because core owns the plain name and asks a different question of different arguments — core's `Sprite Col(n[,first[,last]])` really checks a sprite against a range. Personnal's maps the PAIR onto one CLXDAT bit and answers -1 when it is clear, which is always, since nothing writes CLXDAT here. A program that bound Personnal at any other slot falls back to core's",
  'right click':
    "Personnal's is registered under its slot too, though TURBO Plus's reads the same button (POTGOR bit 10, DATLY, port 0 pin 9) to the same answer — the agreement is a fact about the two libraries rather than something to depend on",
  'set color':
    "the FUNCTION form does not read a colour. Its label is `L_COLORREAD Equ 1` where every other label in the file names the routine below it, so the token table's function field is 1, not the 18 the palette reader sits at — and routine 1 is a bare `L1` falling through `L2` into L3, `Move.w #\$0000,\$DFF1DC / Rts`, which is Set Ntsc's body. Both shipped binaries agree, 1.0b and 1.1. So reading a colour back switches the display to NTSC and answers whatever d3 held; 0 stands in for that here, because an emulator has to answer something. The routine never pops its parameter either, which on the Amiga leaves AMOS's expression stack four bytes high — no analogue here. _AgaPalette, the 256-longword shadow the dead reader indexes, is written by nothing in the library, so this port no longer keeps it. The INSTRUCTION form, `Set Color reg,r,g,b`, is routine 12 and is fine",
  'create aga':
    'differs from Create Standard in more than the colour block, which is easy to miss because the two routines are otherwise line-for-line the same. BPLCON0 starts at \$0010 — BPU3, eight planes — against Standard\'s \$1000, BPLCON2 at \$0224 (KILLEHB) against \$0024, BPLCON3 at \$1000 against \$0c00. Its tail emits one more WAIT after the WAIT \$32 / DMACON pair, for line \$31, which is BEHIND the line just waited for; and it ends without the `BPLCON3 = 0` Standard writes back "for AMOS". An earlier pass gave both builders Standard\'s registers',
  'change palette':
    'reads _ColorBase without checking it, unlike every keyword that patches the list by name — with no list built it writes from address 0 onward, over the exception vectors. Those addresses are outside any mapped region here and the writes are dropped; nothing is raised, because the library raises nothing',
  'iff8bits palette to copper': 'the same unchecked _ColorBase as Change Palette',
  'iff4bits palette to copper': 'the same unchecked _ColorBase as Change Palette, and no mask on the way in, so a 4-bit CMAP byte above 15 bleeds into the channel above it',
  'fade palette':
    'steps each channel with a SIGNED byte compare (`Cmp.b` / `Blt`), so a channel of 128 or more reads as negative and moves away from its target rather than towards it. Invisible on the 0..15 palettes the neighbouring keywords produce, which is presumably why it survived',
  'new color value':
    'packs the channels with ADD where Set Color ORs, so a channel above 15 carries into the one above it instead of overlaying it',
  'set second color':
    'Set Color\'s walk over the block, on _2pal, and error 7 rather than 1 when there is no second screen — but New Color Value\'s ADD packing rather than Set Color\'s OR. Three of the five colour keywords add and two or; nothing distinguishes them but the instruction',
  'playfields col':
    'answers -1 when the CLXDAT bit is CLEAR, the opposite of what the name suggests (Btst sets Z on a zero bit and the Bne skips the -1); and there is no collision hardware here, so CLXDAT reads 0 and it always answers -1',
  'pf sprites col': 'the same inverted test as Playfields Col, and the same always--1 answer for want of CLXDAT',
  'blit mask':
    "BLTCON0 is \$0F98, minterm \$98 = (B AND C) OR (A AND NOT B AND NOT C) — NOT the \$E2 mask-select the name implies. Source and binary agree. There is no blitter, so the minterm is applied directly over a word loop; every one of these keywords uses zero modulos and full word masks, which is what makes that equivalent",
  'l blit mask':
    'blits yEnd rows starting at yStart where L Double Mask subtracts properly — the demos hand both 64,128 on a 192-row screen. Same \$98 minterm, computed rather than blitted',
  'double mask': 'the CPU form; computed as the source computes it, longword by longword',
  'l double mask': 'subtracts yStart from yEnd, unlike its blitter twin',
  'blitter clear':
    "TWO extensions own this name and NOTES is keyed by name alone, so both belong here. PERSONNAL: BLTCON0 \$0100, minterm 0, computed rather than blitted; read off the 1.1 binary at routine 113, which the published source leaves as an empty label. AMCAF: routines 70 (whole screen) and 71 (\$2d1e, with a region), 'In comparison to the AMOS command Cls, Blitter Clear allows you to wipe single bitplane instead of all'. Routine 71 shares its region decode with Blitter Fill (75) and Blitter Copy Limit (61) instruction for instruction: `move.l (a3)+,d4 / lsr.w #\$4,d4` rounds x1 DOWN to a 16-pixel boundary, `addi.w #\$f,d6 / lsr.w #\$4,d6` rounds x2 UP to one, `sub.w d4,d6` is the WORD count and `sub.w d5,d7` the ROW count -- so x is word-granular in both directions and y2 is EXCLUSIVE, where an earlier pass worked in whole pixels with both corners inclusive. A zero or reversed extent bails, and the three do not agree on what that means: Blitter Clear and Blitter Fill do `addq.l #\$8,a3 / rts`, popping their remaining arguments and doing nothing, while Blitter Copy Limit does `Rbra routine 157`, an error. `move.w \$50(a0),d4 / cmp.w d4,d7 / Rbge routine 157` makes a plane outside the screen's depth an error",
  'blitter copy limit':
    "Routines 60 (\$287c, whole screen) and 61 (\$289e, with a region) -- an earlier pass cited routine 305, which is Splinters territory. It stores the rectangle Blitter Copy works within, at \$358 x1 in words, \$35a y1, \$35c the word count and \$35e the row count. Routine 60 is `clr.l \$358(a2)` then `move.w \$4c(a0),d0 / lsr.w #\$4,d0` and `move.w \$4e(a0),\$35e(a2)`, so the short form is the whole screen with the width truncated to whole words. Routine 61 uses the shared region decode described under 'blitter clear': x word-granular in both directions, y2 EXCLUSIVE. The one thing it does differently from its two siblings is the bail -- `Rbra routine 157` rather than a quiet return, so an empty or reversed rectangle is AMOS error 23 here and a no-op there. The port keeps the limit as an inclusive box because that is what every reader of bltLimit expects; the conversion from the routine's word-and-count form is exact",
  'make pix mask':
    "Routine 225 (\$51ce), 140 bytes, and three things in it were wrong. The far corner is EXCLUSIVE, and the bank is sized from the extents BEFORE they become loop counts: `sub.w d4,d6 / sub.w d5,d7 / move.w d6,d2 / mulu.w d7,d2` reserves (x2-x1)*(y2-y1) bytes and only then does `subq.w #\$1,d6 / subq.w #\$1,d7` adjust for the dbra. The bank's name is the literal at \$5252, which is 'Pix Mask' with a space in the middle and not the 'PixMask ' an earlier pass guessed. And the mask is built from BITPLANE 0 alone -- `movea.l (a2),a2` takes the first plane pointer and `btst.l d4,(a2,d3.l)` tests that one bit, writing `move.b #\$1,(a1)+` or `clr.b (a1)+` -- where the port tested the whole pixel value, so on any screen deeper than one plane a colour of 2 masked in when the routine masks it out. NOTE: the Reserve is `Rjsr routine 1103` guarded by `Rbeq routine 389`, so a failure is error 24 rather than the 23 this port's reserveBank raises for a non-positive length; only reachable for a degenerate box. NOTE: the subq pair was invisible until src/cli/extdis.ts stopped believing its text heuristic -- those six bytes read as 'SFSG?F'",
  'blitter copy': 'BLTCON0 \$09F0, minterm \$F0, computed rather than blitted; the first plane is copied before any null check, so only the control block is guarded',
  'low filter.w':
    'filters exactly one element: the loop ends `Cmp.l a0,a1 / Blt`, which asks whether the END pointer is below the current one — false on the first pass of any sane range. Only the .b form loops',
  'low filter.l': 'the same one-element Blt as Low Filter.w',
  'f sprite':
    'indexes the copper list by n*4 where the eight sprite pointers are two MOVEs and so eight bytes apart — `Lsl.l #2` should be `#3`. Sprite 0 lands right; sprite 1 writes its high word into SPR0PTL',
  'get even sprite':
    "writes over the extension's own variables instead of the reserved buffer: `DLea _SpriteBase,a0 / Move.l a0,d1 / Move.l d1,a0` takes the ADDRESS of the variable and never dereferences it (\$4592 in the binary). The buffer F Set Sprite Buffer was given is never touched, so F Sprite finds nothing. Modelled by clobbering _SpriteBase and _SpriteLength as the library does; the writes past those two land on variables this port does not keep as memory",
  'get odd sprite': 'the same missing dereference as Get Even Sprite',
  'mplot draw':
    'the point range EXCLUDES `last` (:4027), where the guide says inclusive — every shipped demo writes `Mplot Draw 1 To NUM` after reserving NUM, so the last point never draws on a real machine either. Starts at plane _MpStartPlane-1 in the 1.1 build',
  'mplot modify': 'the same exclusive range as Mplot Draw (:4136)',
  'mplot start plane':
    "1.1 defaults the variable to 0, which makes a plain Mplot Draw index _BitsPlanes[-1] — the longword at the base of the data bank, the ASCII \"Fred\". No shipped demo calls the keyword, so all of them take that path on 1.1. This port defaults it to 1 instead, because one handler serves both versions and 1.0b always starts at plane 0",
  'mplot load':
    'reads count*260 bytes into a buffer sized count*6+8 — 260 is the AGA icon stride and Mplot Save writes with 6. A copy-paste from the icon loader that only escapes overrunning because the file ends first',
  'set deform value':
    'writes sixteen slots that nothing in the library ever reads — the only instructions touching the 1.1 data bank +\$70 are this write and its own bounds check',
  'iff convert':
    "never reads BMHD's compression byte, so everything is decoded as ByteRun1 and an uncompressed ILBM comes out as noise; and its literal/run split is `Cmp.l #\$80,d3 / Bgt`, making a control byte of exactly 128 a 129-byte literal where the format reserves it as a no-op. Gives up in silence when BMHD, CMAP or BODY is missing",
  'fc cos':
    'a 360-entry table of the function scaled by 1000, included raw at :514 and not recomputable — Math.trunc(fn*1000) misses ten entries. Negative angles index far outside it: the Divu that normalises is unsigned, so a negative dividend overflows and the following Mulu multiplies the low word of the original angle by 360. They answer 0 here rather than whatever memory follows the table',
  'fc sin': 'the same table lookup and the same broken normalisation for negative angles as Fc Cos',
  'fc tan': 'the same again; both poles hold \$7FFFFFFF, positive in each direction',
  'fire(1,2)':
    "POTGOR bit 14, port 1 pin 9 — a second fire button nothing here models. Answers 0, which is what an idle port reads on hardware (the line is pulled high and the routine answers -1 only when clear)",
  'fire(1,3)': 'POTGOR bit 12, port 1 pin 5; the same unmodelled second stick, the same idle 0',
  'vb line wait': 'spins on VPOSR waiting for a beam position; there is no beam, so it yields the frame',
  'aga reserve icon':
    'writes _Icons BEFORE the allocation, so on a real machine a failed AllocMem leaves a count against a bank that does not exist. The allocation is a Uint8Array here and cannot fail, so error 8 is unreachable',
  'aga erase icon': 'clears _Icons before testing _IcBase, so the error-9 path leaves both zero either way',
  'mplot erase':
    'the same shape as Aga Erase Icon and it was missing here: no bank at all returns in silence, but a count with no base is error 11, with the count already cleared before that test (:3740). Reachable only after an AllocMem this port cannot fail',
  'mplot define':
    'bounds the point against the count in the bank HEADER (:3916) rather than the _Mplots register, so it bounds what was actually allocated. The doc block had said so while the code read the register; they agree now',
  'pic pack':
    "produces the format the library's own Pic Unpack decodes, by the same two passes in the same order; the run boundaries are proven by round-tripping through that decoder rather than against a reference file",
  'pic unpack':
    'a control byte of zero fills the rest of the PLANE rather than emitting nothing — its decrement never satisfies the test. The end guard is >= where the 68k tests exact equality, so a header pointing behind its data stops rather than hanging',
  'anim unpack': 'Pic Unpack behind a frame table; the same zero-control-byte and end-guard behaviour',
  'p61 play':
    'an LVO call into player61.library, which is not part of AMOS and not in the source tree. The state machine around it is reproduced because the extension checks it before calling out, but NOTHING SOUNDS. It deliberately does not raise the library-not-found error: the gap here is a decoder, not a missing library. Closable by a real P61 decoder, as med play already is for MMD0/MMD1. It also has TWO table entries, `I0` and an unnamed `I0,0` arity variant that TokenTable.name resolves back to it — routine 124 is byte for byte routine 123 with an extra pop at the front, so the second argument is read and ignored; both forms parse here',
  'p61 stop': 'the P61 state machine only — error 19 when nothing is playing; no audio',
  'p61 mvolume': 'range-checks 0..63 and then the module, in that order, as routine 126 does; no audio',
  'p61 mpos':
    "routine 127 is routine 126 twice over — the SAME 0..63 range check raising the same error 20, whose message is 'Les valeurs de volume vont de 0 a 63.' and is about volume in both, then the same library and module checks. This port had neither check on Mpos; a position of 64 was accepted and one with no module loaded was too",
  'omd load': 'octaplayer.library is not in the AMOS source; the load is checked and remembered, the module is not decoded',
  'omd play': 'the OMD state machine only; no audio',
  'omd stop':
    'raises nothing of its own. Routine 130 checks the library (error 21) and then simply returns when the playing flag at +$fe is not -1; this port raised error 25, which only Omd Play raises',
  'omd free':
    'the same: routine 131 returns in silence when the module pointer at +$102 is zero, where this port raised error 25. It also does not touch the playing flag, so a module freed while playing leaves it set and a later Omd Stop still calls the library',
  'mosaic x2':
    'gains two termination guards the original lacks, neither of which fires on a real screen: a height under one block, and a row byte width that is not a multiple of four, both walk memory forever on the 68k and do nothing here',
  'mosaic x4': 'the same two guards as Mosaic X2',
  'mosaic x8': 'the same two guards as Mosaic X2',
  'mosaic x16': 'the same two guards as Mosaic X2',
  'mosaic x32': 'the same two guards as Mosaic X2',
  'octets fill': 'an end equal to the start passes the routine\'s own Bmi and then fills memory until it faults; it writes nothing here',
  'word switch': 'a range ending at or below its start swaps one word and stops; the 68k keeps stepping until the pointer wraps',
  's32 block to screen':
    'steps rows by longs*4, its own `Lsl.l #2`, not the screen byte width, so a width that is not a whole number of longwords drifts — kept. A screen under 32 pixels wide gives the innermost do-while a count of zero and the 68k never leaves it; that case does nothing here',
  's32 vertice to screen': 'the same row-step drift and the same narrow-screen guard as S32 Block To Screen',
  'full view': 'does not step _CurrentLine after writing, alone among the appending keywords, so the next Copper Wait Line lays itself over the tail',


  // --- Music extension speech ---
  say: "the AMOS side is exact — the ~ phoneme form, the translator path, the range checks and the asynchronous form's mouths — but the VOICE is not the Amiga's. narrator-ts ships a free rebuild of the formant tables (voice-free.json) because narrator.device's own are not redistributable, so it speaks and does not sound like a real Amiga; supplying the original binary is the library's documented upgrade path. Two smaller deviations: the whole utterance plays on voice 0 where the device allocates its own channels through audio.device, and the synchronous form does not hold the interpreter for the length of the audio",
  'mouth read':
    'exact, including that every failure path writes ONE WORD over bytes 88 and 89 so Mouth Width and Mouth Height both read -1 together — which is what the demos loop on — and that it does nothing unless an asynchronous Say is in flight',
  'mouth width': 'the low nibble of the frame the device packs at hunk+0x30a0, which it splits into byte 88',
  'mouth height': 'the high nibble, byte 89',
  'set talk': 'exact: sex and mode masked to a bit, pitch 65..320 and rate 40..400 refused rather than clamped, and any parameter omitted (EntNul) leaves its field alone',
  'talk misc':
    "exact, and note the bounds are AMOS's rather than the device's: volume 0..64 and sampfreq 5000..25000 where narrator-ts accepts up to 28000. Volume is recorded but not yet applied to the mix",
  'talk stop':
    'ends an asynchronous say and hands the voices back, as the routine does; there is no CheckIO/AbortIO race to model because the synthesis is not concurrent here',

}

/**
 * Keywords whose reading lives under another keyword's name.
 *
 * The flat NOTES map could not say "these five share one routine", so a
 * reading that covered a group appeared to document only whichever member
 * happened to hold it. That is not cosmetic: it made a third of AMCAF's
 * approximated set read as unexplained in KEYWORDS.md and in the #199 audit,
 * and sent a pass looking for readings that had already been done.
 *
 * The value is the keyword that HOLDS the reading. coverage.test.ts checks
 * both ends -- that the name is real and that the target actually has a NOTE
 * -- so a group cannot rot into pointing at nothing.
 */
export const SHARED_NOTES: Record<string, string> = {
  // routines 279 to 283 are the same eighteen bytes five times, each handing
  // back a different field of the current screen
  'scrn bitmap': 'scrn rastport',
  'scrn layerinfo': 'scrn rastport',
  'scrn layer': 'scrn rastport',
  'scrn region': 'scrn rastport',
  // "Gives back the address of the AMCAF data base" and its size -- one
  // reading covering the pair
  'amcaf length': 'amcaf base',
  'exchange icon': 'exchange bob',
  'td surface points off': 'td surface points',
  'jd star joker off': 'jd star joker on',
}

/** The reading for a keyword, following SHARED_NOTES to whoever holds it. */
export function noteFor(name: string): string | undefined {
  return NOTES[name] ?? NOTES[SHARED_NOTES[name] ?? '']
}
