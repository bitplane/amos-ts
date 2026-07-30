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
  // JD: both write the battery-backed clock chip at $DC0000 directly, nibble
  // by nibble into an MSM6242B that may not even be fitted (+|jd.s:1070,
  // :1146) — not a request to the operating system to change the date. There
  // is no host equivalent, and setting the machine's clock is not something a
  // page should be able to do. Reading it (Jd Date$, Jd Time$) is unaffected.
  // No handler is registered for either: an n/a keyword with a handler would
  // count as implemented, which coverage.test.ts checks.
  'jd setdate',
  'jd setclock',
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
  // Lrun opens a Shell/CLI to run AmigaDOS commands and Lexecute starts a
  // separate executable; both need a host operating system to run something
  // in, which is the same boundary `exec` and `call` are n/a for above.
  'lrun',
  'lexecute',

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

/** Known simplifications worth surfacing next to a keyword. */
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
    'Returns 0. Reads the modem control lines (CD, CTS, DSR, RI, DTR, RTS) from the serial request. Nothing is connected, so every line reads low. A real port with a real cable would report the handshake state and a program watching for carrier would see it here',
  'serial base':
    'Returns 0. Hands back the address of the IOExtSer request so a program can poke the structure directly. There is no such structure in this port -- the parameters live in a SerialParams object, not in emulated memory -- so there is no address to give. A program that only calls Serial Base to pass it on is unaffected; one that peeks the request is not',
  'printer error': 'Returns 0, for the same reason as Serial Error: nothing is attached, so nothing fails',
  'printer online':
    "Returns 0, meaning not online. The source's failure path is `moveq #-1,d3`, so the two states are distinguishable, and this reports the one that is true of a machine with no printer plugged in. A program that waits for the printer to come online will wait, exactly as it would on such a machine",
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
    "Reads the decrunched length out of the PP20 trailer's top 24 bits, which is why the manual insists END be the true end of the file rather than of the bank ('AMOS's banks are always rounded off to the nearest multiple of 4'). It does no validity checking, exactly as documented — arbitrary data returns whatever its last longword happens to say",
  'lansi':
    "Translates ANSI escape sequences into the AMOS console's own control codes — ESC P n for pen, ESC B n for paper, ESC X/Y n to locate, ESC O/N with a +128 bias for relative moves (screen.ts, +Lib.s ChXxx) — which is what a BBS terminal written in AMOS needs. The manual's table is implemented as given, including its own stated limits: only Italics, Inverse and Underline are supported and other styles are ignored, changing style does not clear the previous one, and clearing at the cursor is not distinguishable from clearing the window ('even if only ESC[J is printed the whole window is cleared'). An escape split across calls is carried over, as documented",
  'lopen':
    'Files are read into memory whole on open and written back on Lclose, so the manual\'s warning that an unclosed file can corrupt the disk holds in the sense that the writes are simply lost — it cannot corrupt anything else. Error messages are the library\'s own, read out of its string table rather than invented: "Invalid Lchannel", "LFile not open", "Invalid filename", with the author\'s English preserved as he wrote it',
  'lsys stamp':
    'Reads the host clock, which defaults to a fixed date so a headless corpus run stays reproducible; a host with a real clock (the browser) supplies one. Nothing about the keyword is approximated — what varies is whether the machine it runs on has a clock, which is a property of the host rather than of the port',
  'lsys time':
    'As Lsys Stamp. Formats HHMMSS with no separators, which the manual is explicit about: "No extra \":\",\".\" or \"-\" is added so that you easily can process this string to the format you like"',
  'lcrypt':
    "LdosV25.DOC documents the calling convention and says nothing whatever about the cipher, so this was read out of AMOSPro_Ldos.lib itself — Lcrypt at \$4400, disassembled with capstone. The key is built by add.b (low byte of d7 only), eori.l #3 and rol.l #1 per password character, then each longword is (value + \$20) XOR key. The byte-width of the add is the part a manual could never have conveyed and the part that matters: widen it and the key diverges after one character. The disassembly is short, unambiguous and its two routines are exact inverses, and the tests hand-simulate the 68k key loop as an independent check — but this is evidence of a different kind from source or a manual, and it is recorded as such",
  'ldecrypt':
    "The inverse of Lcrypt, at \$4436, and the only one of the pair that validates its argument: it opens cmp.w #4,d0 / bcc, while Lcrypt has no length check at all. So the manual's 'an error will be produced if the password is less than 4 characters long' is true of one of the two keywords, which the binary shows and the documentation does not. A short password given to Lcrypt on the real machine runs its dbra 65536 times off the end of the string",
  'lset var':
    'Writes a file into ENV:, which is what a global environment variable actually is — SetVar with GVF_GLOBAL_ONLY does exactly this — so the value is visible to Dir, to the browser file panel and to anything else that reads the filesystem, and outlives the program the way it does on the real machine. The documented 50-character limits on name and value are enforced. Case-insensitivity comes free from the filesystem, which is case-insensitive for the same reason AmigaDOS is',
  'ldisk font':
    "Reports whether the named font exists in the mounted Fonts: drawer and invalidates the disc font list so Get Rom Fonts picks it up, which is what the keyword is for. Two documented behaviours are not reproduced: it cannot distinguish 'already in memory' from 'not on the disk' (both return false, as the manual allows, but for the wrong reason), and the real routine 'is designed to always try to scale the selected font with a best match, it may return true even though the requested font wasn't available' — no scaling happens here, so a near-miss size fails where the original would succeed",
  'llobuffer':
    "The manual calls this keyword Llowbuffer; the token table in the library says Llobuffer, and the table is what a program is actually written against. Like AMOS's own Upper\$/Lower\$ it converts A-Z and a-z only — the manual notes this is 'due to AMOS isn't using a standard keymap'",
  'lchk data':
    "The manual gives no algorithm, only 'CHK will contain the checksum itself'. This is the standard AmigaDOS block checksum — the 128 longs of a 512-byte block sum to zero — and it is verified against real disk images from the corpus rather than inferred: the value it computes over a genuine root block equals the one already stored there. Byte-exact artifact evidence, which is why this is faithful despite the documentation gap",
  'lchk boot':
    "Likewise undocumented, and a different algorithm — an end-around-carry sum over both boot blocks, complemented — exactly as the manual warns ('you must not use Lchk Data for the bootblock and Lchk Boot for datablocks'). Verified the same way, against the stored boot checksum of real disks",
  'llargest free':
    'Reports the largest single allocatable block rather than the total, which is the distinction the manual draws against Chip Free/Fast Free. There is no real allocator here, so the figure is derived from the same synthetic memory budget those keywords use and cannot reflect genuine fragmentation — approximated for that reason',
  'lcat type':
    'Returns fib_DirEntryType from a real AmigaDOS FileInfoBlock — 2 for a directory, -3 for a file, not 1 and -1. The manual only says "positive ... or negative", which several values satisfy; the disassembly is a bare move.l $4(a0),d3 over the FileInfoBlock, so the entry type is handed back verbatim. Every sibling accessor indexes the same structure at its documented offset',
  'lfile type':
    'Returns the same fib_DirEntryType values as Lcat Type (2 and -3). Its own routine could not be decoded cleanly — the success path goes through an AMOS library-call macro capstone does not recognise — so this is inferred from the sibling keyword, which is documented in identical words and demonstrably returns the raw entry type',
  'lcat first':
    "A lock, not a first entry: it returns the directory and Lcat Next walks the contents, which is AmigaDOS Examine()/ExNext() rather than AMOS's Dir First\$/Dir Next\$. The manual says as much and the author's own Lrecursive.AMOS settles it — the result of Lcat First is discarded there and every entry comes from Lcat Next. What it returns is the path as requested; the manual describes it once as 'the file- or directoryname' and once as 'the path, requested by you', and no example prints it, so the ambiguity is unresolved",
  'lcat blocks':
    "Disassembly shows the real routine simply returns fib_NumBlocks from the FileInfoBlock — the filesystem's own count, including the file header and any extension blocks. There is no block accounting in a virtual filesystem to produce that from, so this reports ceil(size / 512), the FFS data-block figure the manual quotes: right in magnitude, low by the filesystem's overhead, and approximated for exactly that reason rather than from any doubt about what the original does",
  'lcat push':
    "The real Lcat Push writes a lock and a FileInfoBlock into 264 bytes of a bank the caller reserved — 4 plus 260, which is exactly what the disassembly shows those 264 bytes to be. Here the scan is parked beside the bank, keyed by the address, and only a marker byte is written into it. Programs that follow the manual — reserve a bank, advance by 264 per level, pull in reverse — behave identically; a program that inspected or copied those 264 bytes would not, and the manual's warning that a bank holding something else 'MAY crash if you're unlucky' has no counterpart here",
  'ldev first':
    'Walks the mounted volumes and then the assigns, returning names without a colon as the manual specifies. The block of device information the real call writes to ADR — device type, unit number, handler name — is not modelled, so the address argument is accepted and ignored',
  'ldev next':
    'Continues the Ldev First walk; see that entry for what is not modelled',
  'lldir$':
    "LDos keeps its own current directory, which is the entire reason the keyword exists: the manual explains that Ldos never notices a Dir\$ change, so a relative Lopen after one would fail. That separation is reproduced, including the trap — set Dir\$ without calling Lldir\$ and LDos keeps using its own path",
  'lget prot':
    "Protection bits are stored per path in the virtual filesystem, since most volumes here are read-only (a disk image, a zip) and the bits must be settable regardless. Nothing enforces them: the manual notes that even real DOS 'doesn't care about some flags when it comes to directories' and that 'if you are running Kickstart 1.2 or 1.3 DOS neglects most flags', so unenforced flags are within the documented range of behaviour — but here no flag is enforced at all",
  'lset file date':
    'Stores the datestamp, minutes and ticks. The virtual filesystem does not otherwise track modification times, so a file that has never been stamped reads back as 1 Jan 1978 rather than when it was written — deliberate, because a real clock would make the corpus census non-reproducible',
  'ldate':
    "Converts a datestamp to YYMMDD. The manual bounds the range at 2099 ('which should be enough?') and specifies that a negative stamp returns 780101, both of which hold here; the two-digit year is ambiguous past 2000 in exactly the way the original is",
  'lmatch':
    "The pattern syntax is fully documented — ? # (a|b) ~ [abc] [~abc] a-z % and the optional * — and is implemented in full, including negation, which is why it is a backtracking matcher rather than a RegExp. What LdosV25.DOC never states is what a *successful* match returns: it gives the form 'L=Lmatch(SOURCE$,S$)' and describes only the wildcard grammar. AMOS's own true is -1 and that is what this returns, but a program comparing the result against a specific positive number could differ. The author's own example programs do not call it, so there is no artifact to settle it either — hence approximated, not faithful",
  'lwild':
    "Returns 1, which the manual sanctions loosely: 'TEST will be false (zero) if A$ contains no wildcard(s), otherwise TEST may contain anything (usually 1)'. Any non-zero is documented as acceptable",
  'lword':
    'A quoted word comes back with its quotes still attached, which the manual calls out as deliberate and surprising: a NULL word ("") returns two quote characters rather than an empty string, so callers can tell a quoted phrase from a bare one',
  'lskip':
    "Returns the address after the last skipped character, stopping at STOP when every byte matches. Clipped to the memory region the start address lands in, where the real machine would scan on into whatever followed",
  'lback hunt':
    'Scans backwards from START down to STOP and returns STOP when the character is absent. The manual does not say what an unsuccessful search returns, so STOP is the boundary the search ended at rather than a documented sentinel',
  'lold':
    "LdosV25.DOC documents this as 'Lold - MAY CURRENTLY NOT BE USED!!', kept back for a future version the author never shipped: 'These are here for future versions, currently the compiler seems to mess up values of reserved variables'. Doing nothing is what the manual describes, but the manual says what the keyword is *for*, not what the released library does when called — that is unknown, and the binary is the only place it is written down",
  'lcreate':
    'As Lold: LdosV25.DOC marks it MAY CURRENTLY NOT BE USED, so it is implemented as a no-op and what the shipped library actually does when called is unknown',
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
  'screen display': 'the visible window w/h clips the composite; hardware scaling is not modelled',
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
  'playfields col':
    'answers -1 when the CLXDAT bit is CLEAR, the opposite of what the name suggests (Btst sets Z on a zero bit and the Bne skips the -1); and there is no collision hardware here, so CLXDAT reads 0 and it always answers -1',
  'pf sprites col': 'the same inverted test as Playfields Col, and the same always--1 answer for want of CLXDAT',
  'blit mask':
    "BLTCON0 is \$0F98, minterm \$98 = (B AND C) OR (A AND NOT B AND NOT C) — NOT the \$E2 mask-select the name implies. Source and binary agree. There is no blitter, so the minterm is applied directly over a word loop; every one of these keywords uses zero modulos and full word masks, which is what makes that equivalent",
  'l blit mask':
    'blits yEnd rows starting at yStart where L Double Mask subtracts properly — the demos hand both 64,128 on a 192-row screen. Same \$98 minterm, computed rather than blitted',
  'double mask': 'the CPU form; computed as the source computes it, longword by longword',
  'l double mask': 'subtracts yStart from yEnd, unlike its blitter twin',
  'blitter clear': 'BLTCON0 \$0100, minterm 0, computed rather than blitted; read off the 1.1 binary at routine 113, which the published source leaves as an empty label',
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
  'pic pack':
    "produces the format the library's own Pic Unpack decodes, by the same two passes in the same order; the run boundaries are proven by round-tripping through that decoder rather than against a reference file",
  'pic unpack':
    'a control byte of zero fills the rest of the PLANE rather than emitting nothing — its decrement never satisfies the test. The end guard is >= where the 68k tests exact equality, so a header pointing behind its data stops rather than hanging',
  'anim unpack': 'Pic Unpack behind a frame table; the same zero-control-byte and end-guard behaviour',
  'p61 play':
    'an LVO call into player61.library, which is not part of AMOS and not in the source tree. The state machine around it is reproduced because the extension checks it before calling out, but NOTHING SOUNDS. It deliberately does not raise the library-not-found error: the gap here is a decoder, not a missing library. Closable by a real P61 decoder, as med play already is for MMD0/MMD1. It also has TWO table entries, `I0` and an unnamed `I0,0` arity variant that TokenTable.name resolves back to it — routine 124 is byte for byte routine 123 with an extra pop at the front, so the second argument is read and ignored; both forms parse here',
  'p61 stop': 'the P61 state machine only — error 19 when nothing is playing; no audio',
  'p61 mvolume': 'range-checks 0..63 as the library does; no audio',
  'p61 mpos': 'accepted and recorded; no audio',
  'omd load': 'octaplayer.library is not in the AMOS source; the load is checked and remembered, the module is not decoded',
  'omd play': 'the OMD state machine only; no audio',
  'omd stop': 'the OMD state machine only; no audio',
  'omd free': 'the OMD state machine only; no audio',
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
