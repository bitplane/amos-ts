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
  // The two Omega keywords whose routines are short enough to read whole:
  // Starset is 28 bytes and Starstop 46, and both are cited instruction by
  // instruction in musicomega.ts. Starplay is not here on purpose -- its own
  // 200 bytes are read, but the replay behind it is this port's rather than
  // the library's 1.6KB of it, which is the definition of approximated.
  'starset',
  'starstop',
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
  // the Lrexx family, on the arm every one of them shares: rexxhost.library
  // is not modelled, so its base is zero and error 24 is what a machine
  // without the library reports too. Result1 and Result2 do not check it.
  'lrexx make host', 'lrexx remove host', 'lrexx get msg', 'lrexx execute',
  'lrexx reply', 'lrexx result1', 'lrexx result2', 'lrexx send msg',
  // LDos's own device channel -- one IORequest at +$298, not eight slots.
  // Ldevice Open answers ZERO for success, which is OpenDevice's result and
  // the opposite way round from the rest of the library; see NOTES.
  'ldevice open',
  'ldevice close',
  'ldevice',
  'ldevice error',
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
  // locale_ext.doc lists every keyword and the whole Format Date$ directive
  // set, and AMOSPro_locale.lib settles the rest. The extension is
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
  // Every keyword read routine by routine out of the 2.15 binary and citing
  // the routine it was read from; the manual is corroboration, not authority,
  // and loses to the binary wherever they disagree. See src/runtime/turbo.ts.
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
  // are ported from +CompExt.s:686-767. Ppsave's output is decoded by
  // `ancient`, an implementation that read the format independently, which is
  // what caught it writing streams the real library could not open: a
  // match-terminated stream owes one more flag bit than our own decoder asks
  // for. (Ppsave stays approximated — it writes valid PP20 but not
  // bit-identical to real PowerPacker's crunch choices.)
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
  //
  // The core `Dev *` family drives the same layer directly, one channel per
  // slot with its IORequest in mapped memory so `=Dev Base` gives a program
  // an address it can really Doke. Dev Open and Dev Do carry a NOTE each.
  'dev open', 'dev close', 'dev do', 'dev send', 'dev abort', 'dev base', 'dev check',
  // the ARexx port handshake, on amiga/rexx.ts. AMOS's own Arx_* code ships
  // in the source, so this family is real: a program opens a public port and
  // a host outside can send to it. See NOTES on `arexx`.
  'arexx open', 'arexx close', 'arexx exist', 'arexx', 'arexx$', 'arexx wait', 'arexx answer',
  // Open Port is Open In with a different pair of constants -- mode 1005 and
  // channel-type `%111` instead of `%010` -- and bit 2 is the only thing
  // =Port checks before reading one byte. See NOTES for what -1 means.
  'open port', 'port',
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

  // --- GameSupport 1.2 (Alastair M. Robinson), read out of the 11,708-byte
  // hunk with `extdis gamesupport-1.2`, alongside GameSupport.guide and the
  // author's own GameSupport.s. NOTE that the source is the extension SHELL
  // only -- six includes holding the keyword bodies are missing from the
  // archive -- so the shell settles the slot, the error table and the library
  // opens, and every routine below is read off the binary.
  'gsreadport', 'gstimer', 'gsmousedx', 'gsmousedy',
  'gssetmousespeed', 'gscontrollertype', 'gsreadsega',
  'gssqr', 'gspyth', 'gsmulti on', 'gsmulti off',
  'gspasscode', 'gspassdecode',
  'gstrack play', 'gstrack stop', 'gstrack loop', 'gstrack loop on',
  'gstrack loop off', 'gstrack loop defer', 'gstrack gosub',
  'gstrack transpose', 'gstrack volume', 'gscmd8data',
  'gsopenc2plib', 'gsclosec2plib', 'gschunky2planar', 'gssetc2pcolour',
  'gssetc2pregion', 'gsc2pinfo', 'gsc2pdebug',
  'gsloadcodemod', 'gsunloadcodemod', 'gsgetattr', 'gssetattr',
  'gsfindattr', 'gscallmod', 'gsiconify',

  // --- SLN 2.0 (Soren Nielsen), from `sln_extII.s` -- the author's OWN
  // assembler source, and for this extension the whole of it rather than a
  // shell: 4,949 lines carrying every routine, the token table, the data zone
  // and the error strings. `ExtNb equ 24-1` is the slot. The 17,576-byte hunk
  // is disassembled with `extdis sln-2.0` wherever the source says something
  // surprising, which is how the S Mouse Button defect below was confirmed to
  // have shipped rather than to be a stale source file.
  //
  // Batch 1 -- the mouse counter reader and the eight user VBL hooks.
  's mouse on', 's mouse off', 's x mouse', 's y mouse',
  's x mouse=', 's y mouse=', 's mouse button',
  's ibase', 's iadr', 's ierase', 's ifree',
  // Batch 2 -- the eight typed arrays. Eleven routines that do not agree with
  // each other about bounds, widths or which slot they are touching; every
  // disagreement is in the NOTES and every one was confirmed in the binary.
  's ainit', 's aset', 's array', 's aclear', 's aerase', 's aerase all',
  's asize', 's abase', 's axsize', 's aysize', 's azsize', 's atype',
  // Batch 3 -- the four that belong to no group: a character-set scan, the
  // AmigaDOS block checksum, a file delete and the iconify window.
  's compare$', 's checksum', 's delete', 's iconify',
  // Batch 4 -- the sample player: a bank of chained AllocMem'd headers, a
  // one-shot play whose "number of times" is a CIA time-of-day deadline, and
  // a per-voice volume the VBL hook re-asserts.
  's sam bank reserve', 's sam bank=', 's sam bank', 's sam bank erase',
  's sam bank load', 's sam bank save', 's sam base', 's sam load',
  's sam chip load', 's sam del', 's sam play', 's sam stop', 's sam clip',
  's sam freq', 's set freq', 's sam length', 's volume',
  // Batch 5 -- trackdisk.device: raw sector access past AmigaDOS entirely,
  // served from a mounted ADF, which IS the sector image the device wants.
  's disk open', 's disk close', 's motor on', 's motor off',
  's disk read', 's disk send read', 's disk write', 's disk send write',
  's disk state', 's disk prot state', 's disk changes', 's num tracks',
  's disk dev check', 's disk abort', 's disk wait', 's disk update',
  's disk rename',
  // Batch 6 -- the tracker. The player is stock PT2.3A with five additions,
  // and the additions are what is read off it; the replay itself is
  // src/amiga/protracker.ts, as it is for AMCAF, P61, MED and GameSupport.
  's track load', 's track play', 's track stop', 's track volume',
  's track length', 's track tempo=', 's track tempo',

  // --- Make Lib 1.30, slot 17: exec's memory and list routines, a C-shaped
  // stdio, and three graphics keywords. BINARY tier with a complete manual --
  // the 2,344-byte hunk disassembles with `extdis make-1.30` and `Make_lib.doc`
  // documents all thirty-two, so every routine is read against its own
  // description. The slot is confirmed from both sides: `move.l a3,$1f8(a5)`
  // in routine 0, and "The extension number of MakeLib is 17." in the doc.
  // Four places where the two disagree are in the NOTES; see make.ts.
  'ma allocmem', 'ma freemem', 'ma allocvec', 'ma freevec',
  'ma malloc', 'ma free', 'ma free all', 'ma realloc',
  'mem chip', 'mem fast', 'mem clear', 'mem public',
  'ma newlist', 'ma addhead', 'ma addtail', 'ma remove', 'ma remhead',
  'ma next', 'ma prev', 'ma first', 'ma last',
  'ma fopen', 'ma fclose', 'ma fread', 'ma fwrite', 'ma fseek',
  'ma filelen', 'ma extb', 'ma extw',
  'ma paste icon', 'ma point', 'ma plot',

  // --- AMOSPro Tools 1.01 (Tor Erik Ottinsen), slot 23: a byte array in a
  // bank, a memory cursor, Range, an Encode/Decode pair, a checksum, and
  // eleven `Oui` keywords the author declined to document -- "internal
  // commands of no use for anybody except me". BINARY tier with a good
  // AmigaGuide that covers the other twenty-two and gives every argument
  // order; the eleven are read off the 2,164-byte hunk alone. `range` is
  // slot-qualified: Range 2.6/2.9Plus claims the same name and both are
  // ported. See tools.ts.
  'set pos', 'get pos', 'add pos',
  'set byte', 'set word', 'set long', 'set string', 'set crypt',
  'get byte', 'get word', 'get long', 'get string', 'get crypt',
  'set array bank', 'array bank', 'array dim', 'array set', 'array get',
  'encode', 'decode', 'checksum',
  'oui set bank', 'oui bank', 'oui init', 'oui new',
  'oui data', 'oui set data', 'oui edata', 'oui set edata',
  'oui reserve text', 'oui set text', 'oui text',

  // --- Delta 1.4 (Lukasz Zelezny), slot 15: fourteen hardware pokes and
  // twelve constants. DISASSEMBLY tier with an AmigaGuide that covers every
  // keyword briefly. FIVE of the instructions are Misc 1.0's routines
  // instruction for instruction -- the two drive-motor keywords, Mouse Off,
  // Change Disk and Wait Fire -- and Delta Reset is Misc's Reset, so the half
  // of this extension that does anything to the machine arrives with a
  // witness whose own assembler source is published. See delta.ts.
  'delta pal', 'delta ntsc', 'delta no synchro', 'delta decrunch',
  // ---- JD Intuition 1.3, slot 18 -------------------------------------------
  // Every one read from AMOSPro_JDInt.Lib with the LVOs checked against the FD
  // files in GUI 2.10's Tools/FD. `jd intevent` is the one exception and is
  // APPROXIMATED; see its note.
  'jd open intwindow', 'jd close intwindow', 'jd open intscreen', 'jd close intscreen',
  'jd intlocate', 'jd intprint', 'jd intpen', 'jd intpaper', 'jd intdrawmode',
  'jd intbar', 'jd intmouse(x)', 'jd intmouse(y)', 'jd intclass', 'jd intcolour',
  'jd intcurs(x)', 'jd intcurs(y)', 'jd intzone', 'jd rem intzones', 'jd intbox',
  'jd intline', 'jd intellipse', 'jd intfill', 'jd intpoint', 'jd intplot',
  'jd use intscreen', 'jd use intwindow', 'jd show intscreen', 'jd show intwindow',
  'jd intcls', 'jd intmove', 'jd intscreen width', 'jd intscreen height',
  // ---- AMon 1.04 at slot 25 and 1.03 at slot 16 ----------------------------
  // Every one read from AmosPro_Amon.lib, with the argument orders checked
  // against the author's own example programs -- the shipped documents are an
  // install note and a copyright page and describe no keyword at all. The two
  // libraries share eighteen names and seventeen identical routines; the
  // rodent limits 1.03 ships as zeros and Fast Circle's error number are the
  // two a program can tell apart, and both are modelled. Both tables are held
  // to the shipped bytes by amon.corpus.test.ts. See amon.ts.
  'rodent x', 'rodent y', 'set rodent', 'limit rodent', 'lrodent', 'rrodent',
  'rodent key', 'video wait', 'fast angle', 'fast joy0', 'fast joy1',
  'keycode', 'key press', 'mul sin', 'mul cos', 'fast plot', 'fast point',
  'fast circle', 'array plot', 'test add', 'joy3', 'joy4',
  'count colour', 'find colour',
  // ---- Explode 2.01 at slot 7, going in by functional group ---------------
  // SOURCE tier: the author's own commented assembler ships with the library.
  // Batch 1, the `VariableCmd` group -- routines 59 to 73, all pure. The
  // three widths of Lsl/Lsr are not a rounding: `lsl.b` shifts the low byte
  // and leaves the other twenty-four bits, and the routine returns all of it.
  'byte', 'byte$', 'word', 'word$', 'long', 'long$',
  'lsl.b', 'lsl.w', 'lsl.l', 'lsr.b', 'lsr.w', 'lsr.l',
  'even', 'odd', 'align',
  // Batch 2, `TextCmd` -- routines 33 to 40. Six three-byte escape builders
  // over one shared routine, the eight-sequence Pdef$ constant, and Format$,
  // which is exec's RawDoFmt and not the author's own. THREE of the six
  // escapes did not exist in this port's console until this batch: ESC I, S
  // and U are what `Inverse On`, `Shade On` and `Under On` look like inside a
  // string, and screen.ts ignored all three.
  'pinv$', 'psad$', 'pund$', 'pcpn$', 'pjam$', 'pcsr$', 'pdef$', 'format$',
  // Batch 3, `BankCmd` plus `Bank To Chip` -- routines 19 to 32 and 142, over
  // the shared loader 167. Two things a reading could miss and this one did
  // not: `Bank As Work`/`Bank As Data` also RENAME the bank, comparing a
  // longword against an eight-byte field, so an AMOS 1.x "Datas   " bank
  // comes out "Works   " with its fifth character still on it; and
  // `Image Width` answers the stored word times 16, checked against real
  // object banks in the corpus rather than assumed. `Bank Load`'s four
  // arities share one token name and settle the shape themselves. This batch
  // corrected Bnk.OrAdr's threshold in the core: 1024, not 0x10000.
  'bank load', 'bank save', 'bank as work', 'bank as data', 'bank free',
  'bank clone', 'number', 'finish', 'image swap', 'image width',
  'image height', 'bank to chip',
  // Batch 4, `StructureCmd` -- routines 41 to 58 plus L_RsEraseAll at 184.
  // Eight numbered blocks with a write cursor, which is what fills the buffer
  // Format$ reads. They needed the port's first Explode STATE and a MemPool
  // region of its own, because `=Rs Start(n)` is an address a program Pokes
  // through. Three quirks are reproduced and tested: Rs Char and Rs Aptr copy
  // ONE BYTE TOO MANY (`dbeq` counts length+1), Rs Fill with character zero
  // writes exactly one byte (move.b sets Z and the same dbeq reads it), and a
  // count at or above the structure's length fills nothing. Rs Clear's
  // unguarded loop is NOT reproduced -- on an unallocated structure it writes
  // 64K of zeros from address 0.
  'rs structure', 'rs start', 'rs finish', 'rs length', 'rs clear', 'rs fill',
  'rs byte', 'rs word', 'rs long', 'rs aptr', 'rs char', 'rs set', 'rs bset',
  'rs wset', 'rs lset', 'rs erase', 'rs',
  // Batches 5, 6, 8, 9 and 10 -- the waits, the file and Cd keywords, the
  // fonts, the battery clock and drives, and the system group. Four things
  // worth knowing without opening explode.ts: `Stop Loop` tests Inkey with
  // `tst.l` where `Wait Loop` uses `tst.w`, so an Amiga key alone ends one
  // and not the other; the wait FUNCTIONS answer a mouse button NEGATED and
  // a key positive; `Cd Set` builds a path nothing else in the library reads
  // (every file keyword goes through AMOS's own current directory); and
  // `Amcaf Crack On`/`Off` are not implemented as a crack, on the authority
  // of the author's own manual calling them illegal.
  'clear mouse', 'pause', 'stop loop', 'wait loop', 'wait mouse',
  'file path$', 'file blocks', 'file size', 'file type', 'hof',
  'file protection', 'cd path$', 'cd set', 'cd parent',
  'font open', 'font set', 'font close', 'font name$', 'font height',
  'font base',
  'hard time$', 'hard date$', 'set hard time', 'set hard date',
  'drive state', 'dev state', 'drive busy',
  'vectorptr', 'hardreset', 'softreset', 'flush', 'avail free',
  'open workbench', 'workbench', 'amos state', 'amcaf crack on',
  'amcaf crack off', 'explode$', 'explode base', 'extension$',
  'extension base',
  // Batch 7, `GfxCmd` -- routines 97 to 112. Whole-bitplane surgery on the
  // current screen: OR a mask over one, clear it, invert it, copy/merge/swap
  // a pair, take one to a bank and back. `Plane Open`/`Plane Close` are the
  // odd two out -- they move rp_Mask and touch no pixels -- and they carry
  // a reproduced defect: the range loop's `dbeq` reads Z from bclr's
  // OLD bit value, so it stops at the first bit that was already the way it
  // is being set. `Iff Bank` is a whole ILBM reader in the library and the
  // port's own reader here; the checks a program can see are reproduced.
  'rastport', 'plane mask', 'plane clear', 'plane get', 'plane put',
  'plane length', 'plane copy', 'plane swap', 'plane negative',
  'plane merge', 'plane close', 'plane open', 'plane active', 'iff bank',
  // Batch 11, the PowerPacker, XPK and Imploder keywords -- routines 78 to
  // 96 plus 136 and 137. The heart of the group is one data table, routine
  // 183: ten formats by six longwords, transcribed from the source's own
  // `dc.l` block because nothing about it is derivable -- PPEX appears three
  // times with three probe offsets because three versions of the
  // self-extractor put their signature in three places. Seven keywords walk
  // it. The Xpk half records its error where the Ppk half does not, which is
  // what `=Xpk Errn` and `=Xpk Err$` are for.
  'ipk length', 'ppk pack', 'ppk unpack', 'ppk length', 'ppk mode',
  'ppk type', 'ppk name$', 'ppk passkey', 'ppk password', 'ppk data',
  'xpk length', 'xpk name$', 'xpk unpack', 'xpk errn', 'xpk err$',
  'xpk pack', 'xpk crypt',
  // Batch 12a -- the three of the last seven that need no external library.
  // ByteKiller is the reason this is possible: routine 74 does not call out,
  // it carries the whole decruncher inline as `Bk1` to `Bk9`, so the
  // algorithm is in the vendored SOURCE rather than in a binary. See
  // ../amiga/bytekiller.ts. `Bpk Length` is a header sniff with a real hole
  // in it, reproduced. `Lpk Length` reads lh.library's own "LH18" marker
  // without needing the library.
  'bpk unpack', 'bpk length', 'lpk length',
  // Batch 12b -- `Lpk Unpack` and `Lpk Pack`, over a port of BOTH halves of
  // lh.library 1.8 in ../amiga/lh.ts. The library is LZHUF with three of its
  // constants changed: the shortest match is ONE byte where LZHUF's is three
  // (and the encoder does code two-byte matches), there is no `reconst` at
  // all -- the tree stops adapting at MAX_FREQ instead of rebuilding, on both
  // sides -- and the encoder skips LZHUF's F-position tree seeding. All of it
  // is pinned against the shipped binary in lh.corpus.test.ts, including the
  // defect: `LhEncode` WRITES lh_DstSize and reads it nowhere, so `Lpk Pack`'s
  // SrcSize + SrcSize/8 destination is a heap overrun for anything short and
  // incompressible.
  'lpk unpack', 'lpk pack',
  // Batch 12c -- `Dpk Name$`, over decrunch.library (DecrunchLib 35.237,
  // LICENCEWARE, Georg Hoermann). The keyword only ever IDENTIFIES, and
  // identification is the part that can be reproduced whole: 16 data magics,
  // 76 executable signatures and one scan, extracted by ../cli/gendecrunch.ts
  // and held to the binary in ../amiga/decrunchlib.corpus.test.ts. 93 names,
  // none of them derivable. Its sibling `Dpk Unpack` is APPROXIMATED for a
  // reason no reading fixes: the library is about seventy decrunchers and
  // this port has one of the formats, so it identifies everything and unpacks
  // PowerPacker data.
  'dpk name$',
  'delta inter on', 'delta inter off', 'delta mouse off', 'delta reset',
  'delta drive motor on', 'delta drive motor off', 'delta change disk',
  'delta wait left mouse', 'delta wait fire', 'delta wait double mouse',
  'delta brithday', 'delta pi#', 'delta e#', 'delta about$',
  'delta yard$', 'delta feet$', 'delta inch$',
  'delta english mile$', 'delta american mile$',
  'delta radian$', 'delta degree$', 'delta euler$',

  // --- Delta 1.6 adds twenty to the same table without moving one id, which
  // is why one port serves both. Four of the twenty are approximated (the
  // three reqtools calls and the req.library one, all requesters) and `Jsr`
  // is n/a; these fifteen are faithful. Six of them reach AmigaOS through an
  // intuition.library the library opens fresh every call and never closes.
  'delta hard reset', 'delta blit off', 'delta crash', 'delta beep all',
  'delta change bank', 'delta intuition message',
  'delta wb to front', 'delta wb to back',
  'delta lock pub screens', 'delta unlock pub screens',
  'delta find task', 'delta kill task',
  'moveb', 'movew', 'movel',

  // --- LSerial 2.1 (Niklas Sjoberg), slot 11: a serial.device wrapper
  // written because AMOS's own would not reopen a closed device. BINARY tier
  // with a thorough .DOC that gives every argument order, the whole io_Status
  // bit table and the XPR contract, and the two agree everywhere. `Lxpr` is
  // APPROXIMATED and deliberately absent from this list -- see its NOTES.
  // The shareware nag every error path prints is a DEVIATION, in the header.
  'lser open', 'lser close', 'lser send', 'lser read', 'lser query',
  'lser mul send', 'lser mul check', 'lser get', 'lcarrier',
  'lser brk', 'lser baud', 'lser params', 'lser status', 'linkey\$',

  // --- BUtility 1.21 (Mariusz Rycyk), slot 12: a freeware facade over
  // reqtools, asl and xpkmaster. BINARY tier with a .doc that gives every
  // signature and a worked example, and the two agree everywhere. The three
  // XPK keywords are real -- src/amiga/xpkmaster.ts is a port of the stream
  // format, and a method this port has no sub-library for fails exactly as a
  // machine without it would. The six accessors are buffer reads, and two of
  // them share their buffer with the other two (a DEFECT, in the NOTES).
  // The FIVE requesters are APPROXIMATED and deliberately absent from this
  // list: the two file requesters go through AMOS's own selector as `Lfreq`
  // does, and the three text requesters through runtime/requester.ts, which
  // builds them out of the Interface dialog language. See butility.ts.
  'bxpkpack', 'bxpkunpack', 'bxpkerror\$', 'bfilereqchg',
  'breqfile\$', 'breqdir\$', 'baslfile\$', 'basldir\$',
  'bgetlong', 'bgetstr\$',

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
  // slice 12: ProTracker. Pt Data Base is APPROXIMATED (answers 0). The four
  // LIVE-STATE queries -- Pt Cpos, Pt Cpattern, Pt Cnote and Pt Cinstr -- are
  // faithful because the module is stepped rather than merely loaded:
  // `amiga/protracker.ts` steps it, off Player 6.1A's source rather than
  // off AMCAF's own replayer at $9bac, which is the DEVIATION that file
  // records; the values are live and the reading behind them is another
  // library's.
  'pt play', 'pt stop', 'pt continue', 'pt bank', 'pt sam bank',
  'pt volume', 'pt voice', 'pt cia speed', 'pt sam play', 'pt sam stop',
  'pt sam volume', 'pt sam freq', 'pt instr play', 'pt raw play',
  'pt vu', 'pt signal',
  'pt instr address', 'pt instr length', 'pt free voice',
  // AMCAF internals: Amcaf Base/Length, Amos Task,
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
  // the sector-level floppy access, on `AdfVolume.image` -- an ADF IS the
  // sectors trackdisk hands back, which is the path SLN's S Disk Read takes.
  // Read Sector carries a DEFECT and Diskchange a DEVIATION; see NOTES.
  'jd read sector',
  'jd write sector',
  'jd relabel',
  'jd diskchange',
  // the three structure pointers, answered as synthetic identifiers -- see
  // NOTES. Intscreen/Intwindow Base are in 4.6's table only.
  'jd rastport',
  'jd intscreen base',
  'jd intwindow base',
  // the third console animation, beside Jd Spread and Jd Tscroll -- the name
  // is about squashing TEXT, not a disk. Same pacing DEVIATION as those two.
  'jd squash',
  // and the whole-disk writes, on the same image. Install carries a DEFECT
  // and Format a NOTE; see NOTES.
  'jd install',
  'jd format',
  'jd shortformat',
  // Jd Dled Off/On are Misc 1.0's pair constant for constant: the same three
  // writes to CIA-B's port B at $bfd100 and its direction register, sharing
  // `Runtime.driveMotor` with them. Jd Reset is `jmp $fc00d2` -- a reboot the
  // machine models, and the only WARM one in the corpus, because it is the
  // only one that does not wipe ExecBase first.
  'jd dled off',
  'jd dled on',
  'jd reset',
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

  // 1.1's names for the same 58, which are 1.3's minus the `Jd ` prefix it
  // added and nothing else -- same routine, same bytes out. They were absent
  // here, so a port that answers them exactly as faithfully as their
  // counterparts reported 58 approximations it does not have. jdprt.ts derives
  // the pairing from the registered 1.1 token table rather than transcribing
  // it, and jdprt.test.ts pins the rule against that table, so this list and
  // the port cannot drift apart silently.
  'prt reset',
  'prt init',
  'prt italics',
  'prt italics off',
  'prt under',
  'prt under off',
  'prt bold',
  'prt bold off',
  'prt elite',
  'prt elite off',
  'prt fine',
  'prt fine off',
  'prt enlarged',
  'prt enlarged off',
  'prt shadow',
  'prt shadow off',
  'prt double',
  'prt double off',
  'prt nlq',
  'prt nlq off',
  'prt super',
  'prt super off',
  'prt sub',
  'prt sub off',
  'prt set us',
  'prt set french',
  'prt set german',
  'prt set uk',
  'prt set danishi',
  'prt set sweden',
  'prt set italian',
  'prt set spanish',
  'prt set japanese',
  'prt set norge',
  'prt set danishii',
  'prt prop',
  'prt prop off',
  'prt ljustify',
  'prt rjustiy',
  'prt fjustify',
  'prt center',
  'prt lspace eight',
  'prt lspace six',
  'prt justify off',
  'prt pline up',
  'prt pline down',
  'prt set lmargin',
  'prt set rmargin',
  'prt set tmargin',
  'prt set bmargin',
  'prt clr margins',
  'prt set htab',
  'prt set vtab',
  'prt clr htab',
  'prt clr htabs',
  'prt clr vtab',
  'prt clr vtabs',
  'prt set def tabs',

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
  // Jd Mouse reads the Show/Hide nesting counter (`Runtime.mouseShow`); the
  // three path helpers are a backward scan for a separator and a copy
  // (routines 62 and 79). Jd File$ carries a DEFECT of its own, and Jd Rprint,
  // Jd Guru and Jd Setoutput Amiga a NOTE each; see NOTES.
  'jd mouse',
  'jd path$',
  'jd file$',
  'jd drive$',
  'jd rprint',
  'jd guru',
  'jd setoutput amiga',
  'jd setoutput amos',
  // the CON: window, on AMOS's own console. Open Con is APPROXIMATED and is
  // deliberately absent from this list; the other three are the DOS calls
  // around it, each with the guards the routines actually make.
  'jd close con',
  'jd print con',
  'jd input con',
  // the whole-screen group. The six slides and Screen Convert are runs of
  // AMOS's own Screen Copy. Change Colours and Fill Colour share a row-restart
  // defect, the palette files are 'APal' plus 32 words which the source
  // settles exactly, and Wait Raster and the three structure pointers carry a
  // note each -- all of them in NOTES.
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
  // TOME 4.23 / 3.1, the map engine: routines 10, 11, 14-19 and their two
  // shared helpers, 67 (resolve the map bank) and 70 (the icon bank and its
  // count). Read off TOME.Lib, which ships without a manual, so there is no
  // prose either to check them against or to be misled by. The two error
  // arms, routines 81 and 82, are covered by the same tests.
  'tile size',
  'map bank',
  'brik bank',
  'tile typ bank',
  'tile val bank', // 3.1's spelling of the same id and the same routine
  // the query side, routines 2, 3, 4, 21, 22, 31-35, 39, 63, 64, 65. Map Base
  // is APPROXIMATED (it hands back a pointer); the rest are exact, including
  // the 68000 `divu.w` overflow Xtile/Ytile depend on and the Map Fx/Fy mask
  // that is only a remainder for a power-of-two tile.
  'xtile',
  'ytile',
  'map pos x',
  'map pos y',
  'map hx',
  'map hy',
  'map fx',
  'map fy',
  'map x',
  'map y',
  'map tile',
  'map length',
  // the brik family and the tile-type lookup: routines 5, 6, 7, 23, 24, 25,
  // plus 26 and 27, the two strings the library ships. Paste Brik carries a
  // reproduced DEFECT and Map Brik a DEVIATION; both are in NOTES.
  'brik x',
  'brik y',
  'briks',
  'tile val',
  'map brik',
  'paste brik',
  'tme ver$',
  'tme credit$',
  // the update pipeline: routines 20, 36, 37, 38, 40, 41, 46 and 49. Map Plot
  // carries a DEVIATION (in NOTES); List Tile is the one place in the whole
  // extension where running past the icon count is not error 74.
  'map plot',
  'map update on',
  'map update off',
  'map update',
  'map anim bank',
  'map ab length',
  'map paste',
  'list tile',
  // tile tags (routines 57-62) and zones (73-76). $4a turns out to be the
  // TILE TAGS flag, not an animation one; the five map draws all take the
  // tag path through it, and Map Zone is the one place in the extension
  // where a far corner is INCLUSIVE.
  'tile tags on',
  'tile tags off',
  'tile tag set',
  'tile tag',
  'tile tag x',
  'tile tag y',
  'map zone bank',
  'map set zone',
  'map zone',
  'map zb length',
  // Tiny Map's overview draw and the map search: routines 8, 9, 29, 30.
  // Map Scan carries a reproduced DEFECT (in NOTES) -- its map bounds are
  // long reads over word pairs and never fire.
  'tiny bank',
  'tiny map',
  'map scan x',
  'map scan y',
  'tile count',
  'map check',
  'map view',
  'map do',
  'map left',
  'map right',
  'map top',
  'map bottom',
  // the animation family: routines 42-45 and 47-56. Routine 45, the stepper,
  // is not a keyword -- Map Update reaches it through $70. Map Anim, Map An
  // Move and Map Fall carry reproduced DEFECTs and Map Handle and Map An
  // Point DEVIATIONs; all five are in NOTES.
  'map anim on',
  'map anim off',
  'map anim',
  'map handle',
  'map handle init',
  'map fall',
  'map swap tile',
  'map an freeze',
  'map an unfreeze',
  'map an point',
  'map an at',
  'map an move',
  // --- PowerBobs 1.0, slice 1: the structures and the accessors ---
  // The SHAREWARE build. Reserve Pbobs carries the 64 cap the binary states,
  // and Pbob Erase carries the DEVIATION for the startup screen this port
  // does not reproduce; X Pbob carries the one for the missing null check.
  'reserve pbobs',
  'pbob height',
  'pbob erase',
  'pbob dbuf',
  'set pbob',
  'set fastpbob mode',
  'x pbob',
  'y pbob',
  'i pbob',
  // slice 2a: Pbob DEFINES and Pbob Draw draws -- see the note on 'pbob'
  'pbob',
  'pbob off',
  'pdraw 25fps',
  'pswap clear',
  // slice 2b: the blitter draw. See the note on 'pbob draw' -- BLTCON0 says
  // a Pbob is an OPAQUE rectangle, which is the sharpest difference from an
  // AMOS bob and is in no documentation.
  'pbob clear',
  'pbob draw',
  'pbob update',
  // slice 3: the array arithmetic block, routines 58-77
  'pinc',
  'pdec',
  'padd',
  'psum',
  'plsl',
  'plsr',
  'pasl',
  'pasr',
  'pmul',
  'pmul shift',
  'pdiv',
  'same',
  'set psum range',
  'set pinc range',
  'set pdec range',
  'unset psum range',
  'unset pinc range',
  'unset pdec range',
  'unset padd range',
  // slice 4a: the Psprite accessors. The Psprite draw family itself is not
  // here yet -- see the note on 'psprite max'.
  'psprite max',
  'set psprite colours',
  'x psprite',
  'y psprite',
  'xscr mouse',
  'yscr mouse',
  'xscr sprite',
  'yscr sprite',
  // slice 4b: collision -- four pairings, four result tables, four readers
  'pbob fastcol',
  'pbobsprite fastcol',
  'psprite fastcol',
  'pspritebob fastcol',
  'pfast bobcol',
  'pfast bobsprcol',
  'pfast sprcol',
  'pfast sprbobcol',
  // slice 5: the AMAL bridge and the Psprite draw family -- the last of it
  'psync every',
  'psync every pbob',
  'psync every psprite',
  'pchannel to pbob',
  'pchannel to psprite',
  'psync pbob',
  'psync psprite',
  'convert sprites',
  'psprite',
  'psprite off',
  'psprite erase',
  'psprite update',
  // --- Personnal EXTRA 1.0a, slot 17: Frederic Cordier's two-keyword
  // companion, which reports the version of the Personnal library in slot 13
  // and does nothing else. Whole source in the Personnal 1.11 archive; see
  // plib.ts, and note that only Personnal 1.1 answers it.
  'plib ver',
  'plib rev',
  // --- Misc 1.0, slot 23: Frank Otto's twelve odds and ends, whole source in
  // the box. Nine here; Multi Off/On and Pal On are n/a — see the NA block and
  // miscext.ts for why each one is. `Reset` is `Delta Reset` instruction for
  // instruction, and the machine models a pending reset.
  'display off', 'display on', 'mouse off', 'firewait',
  'dled on', 'dled off', 'clear ram', 'disk wait', 'reset',
  // --- AMOSPro Colours 1.0, slot 23: Jan Normann Nielsen's named colour
  // constants. Twenty-seven zero-argument functions returning a 12-bit $RGB
  // value, every one an `equ` in the public-domain source that ships with it.
  // The whole library has no state and no error path; see colours.ts for the
  // two things worth knowing before typing one.
  'red', 'green', 'blue', 'black', 'yellow', 'magenta', 'cyan', 'white',
  'grey', 'brown', 'c orange',
  'dark red', 'dark green', 'dark blue', 'dark yellow', 'dark magenta',
  'dark cyan', 'dark grey', 'dark brown',
  'light red', 'light green', 'light blue', 'light yellow', 'light magenta',
  'light cyan', 'light grey', 'light brown',
  // --- EME 3.0, slot 1: Paul Reece's Enhanced Music Extension, which SHIPS
  // as AMOSPro_Music.Lib and replaces the stock one in place. All 49 stock
  // keywords keep their ids and specs and are served by the core Music
  // implementation; these ten are what it adds. Both builds we hold are
  // demos — see eme.ts, which is also where the two places EME.doc
  // contradicts its own binary are recorded.
  'track tempo',
  'patt loop on',
  'patt loop of',
  'patt loop no',
  'track sample on',
  'track sample off',
  'trpos',
  'trlen',
  'trpat',
  'trstat',
  'med tempo',
  'tr credits',
  // --- P61 1.2, slot 25: the Player 6.1A wrapper. `p61 play` and `p61 stop`
  // are slot-qualified because Personnal 1.1 has the same two names at slot
  // 13; see p61.ts.
  'p61 pause',
  'p61 continue',
  'p61 volume',
  'p61 cia speed',
  'p61 signal',
  'p61 fade',
  'p61 pos',
  // --- MED 7.1, slot 19: Haiko Lemser's shim over OctaMED's three player
  // libraries. `med load`, `med play` and `med stop` are slot-qualified
  // because the stock Music extension spells all three; see medext.ts.
  'med continue',
  'med fast load',
  'med init player',
  'med free player',
  'med unload',
  'med set tempo',
  'med set mod nr',
  'med reset midi',
  'med reloc',
  'med set hq',
  'med fastplay on',
  'med fastplay off',
  'med 14bit mode on',
  'med 14bit mode off',
  'med set mixing freq',
  'med set mixbuffer',
  'med pointer',
  'med mod base',
  'med get player',
  'med get sub songs',
  'med pblock',
  'med pline',
  'med seq num',
  'med counter',
  'med is fastplaying',
  // --- Ercole 1.7, slot 10: Ercole Spiteri's game-port extras. `xfire` is
  // slot-qualified because AMCAF spells it at slot 8; see ercole.ts.
  'cli',
  'library open',
  'library close',
  'paddle',
  'pad fire',
  'ext joy',
  'ext fire',
  'xfire',
  'yfire',
  'prop on',
  'prop off',
  // --- Jotre 1.0, slot 22: Thomas Verduin's shim over an embedded THX Sound
  // System 2.0 replayer. Five instructions, no functions; see jotre.ts.
  'init thx',
  'deinit thx',
  'play thx',
  'stop thx',
  'volume thx',
  // --- First 0.1, slot 22: Pedro Gil's 248-byte extension; see first.ts.
  'change led',
  'wait mouse',
  'wait joy',
  'clear banks',
  // --- FileID 1.0, slot 25: Haiko Lemser's FileID.library wrapper, SOURCE
  // tier (FileID.s ships with it); see fileid.ts.
  'id get high id',
  'id get string',
  'id identify file',
  'id identify adresse',
  'id fileinfo',
  'id error',
  // --- Dump 1.1, slot 20: printer dump and raw trackdisk. `dump` itself is
  // APPROXIMATED and deliberately absent here; see dump.ts.
  // --- CRAFT 1.0, slot 18: Hannu Rummukainen's toolbox for Black Legend.
  // Read off the 13,396-byte hunk with the disk's own 42KB help text and
  // forty example programs beside it, all three unpacked out of the
  // installer by ../amiga/solaris.ts. Batches 1 and 2: strings and memory.
  // `mem type` is APPROXIMATED and absent here. See craft.ts.
  'up case$',
  'lo case$',
  'flip case$',
  'left trim$',
  'right trim$',
  'bw instr',
  'chr conv$',
  'str count',
  'mem str count',
  'str scramble$',
  'str unscramble$',
  'hex dump$',
  'chr dump$',
  'str peek$',
  'str poke',
  'chip max block',
  'fast max block',
  'mem copy',
  'mem scramble',
  'mem unscramble',
  // Batches 3 and 4: the disk queries and the `dr *` directory scanner. The
  // volume geometry behind them is new back-end -- Volume.dosInfo in
  // ../amiga/vfs.ts, read off the bitmap for a disk image -- and `Dr Fib`
  // hands back an address, so ../amiga/dos.ts serialises a FileInfoBlock and
  // Runtime maps it at CRAFT_FIB_BASE.
  'dr file$',
  'dr path$',
  'db free',
  'db used',
  'db size',
  'disc state',
  'disc type$',
  'disc error',
  'file protect',
  'file comment$',
  'file length',
  'file type',
  'set protect',
  'set comment',
  'dr name$',
  'dr next$',
  'dr comment$',
  'dr protect',
  'dr length',
  'dr type',
  'dr fib',
  'dr forget',
  // Batch 5: the palette group. Six colour guns over the current screen and
  // eleven keywords over a palette bank, whose record layout -- "Palettes",
  // then 32 words per palette with $FFFF for an absent colour -- is in no
  // documentation and comes off routines 84 and 94. `pal spread` is
  // slot-qualified: AMCAF spells the name too, over different parameters.
  'set red',
  'set green',
  'set blue',
  'pal red',
  'pal green',
  'pal blue',
  'pal spread',
  'pal swap',
  'pal copy',
  'pal count',
  'reserve as palette',
  'pal to bank',
  'pal from bank',
  'pal swap bank',
  'set bank colour',
  'bank colour',
  'del bank colour',
  // Batches 6 and 7: the LOGO turtle, all 33 of it. The arithmetic is
  // transcribed as a register machine rather than rewritten in floating
  // point -- the position is 16.16 and only the integer half reaches the
  // screen, so the rounding is the behaviour. `Tr Exec` is a whole
  // interpreted language inside one keyword; its grammar came off routines
  // 96 and the table at $1c88.
  'tr reset',
  'tr angle',
  'tr get angle',
  'tr left',
  'tr right',
  'tr towards',
  'tr forward',
  'tr forw',
  'tr back',
  'tr distance',
  'tr pen up',
  'tr pen down',
  'tr pen state',
  'tr move',
  'tr move rel',
  'tr draw',
  'tr draw rel',
  'tr x pos',
  'tr y pos',
  'tr exec',
  'tr error',
  'tr proportions',
  'tr set home',
  'tr home',
  'tr x home',
  'tr y home',
  'tr remember x',
  'tr remember y',
  'tr remember a',
  'tr memorize x',
  'tr memorize y',
  'tr memorize a',
  'tr base',
  // Batch 8: the fractal generator. A complex-plane cursor in 1/8192 fixed
  // point and an escape-time renderer whose iteration is `muls.w` on
  // 26-fraction products, `asl.l #3 / swap` back to thirteen, and
  // `cmp.l #$10000000` for |z| squared over four.
  'fr reset',
  'fr position',
  'fr x position',
  'fr y position',
  'fr step',
  'fr x step',
  'fr y step',
  'fr window',
  'fr colour',
  'fr get colour',
  'fr scan',
  'fr scan all',
  'fr julia',
  'fr mandelbrot',
  // Batch 9: Workbench, the CLI and the machine, and the group that proves
  // the claim above -- not one of these opens a library. IntuitionBase is at
  // -$18a6(a5), DOSBase at $620(a5) and ExecBase at absolute $4, all of them
  // held by AMOS already.
  'open workbench',
  'wb to front',
  'wb to back',
  'cli execute',
  'cli print',
  'cli here',
  'guru meditation',
  'guru alert',
  'set amos pri',
  'amos pri',
  'wb def prefs',
  'wb prefs',
  'set wb prefs',
  'sys request',
  'hard reset',
  'warm reset',
  // Batch 10: the tail. Two hardware registers came into the memory map for
  // `hw mouse key` -- CIA-A port A and POTGOR -- because the keyword's whole
  // point is that it goes to the silicon, and a program that Peeks them
  // itself has to get the same answer.
  'hw mouse key',
  'y beam',
  'beam wait',
  'gr ink',
  'gr back',
  'gr border',
  'gr centre',
  'amos base',
  'craft version',
  'b.swap',
  'w.swap',
  'l.swap',
  'amos pro',
  // --- MusiCRAFT 1.0, slot 19: CRAFT's companion, same author, same disk --
  // its binary was inside the same Data0 blob. A stock PT2.1A replayer with
  // eleven keywords in front of it, so ../amiga/protracker.ts does the replay
  // and musicraft.ts holds only what MusiCRAFT adds to it. `st base` is
  // APPROXIMATED and absent here, and `st load` is already listed above under
  // EasyLife, which spells the same name for a different thing. See musicraft.ts.
  'st play',
  'st stop',
  'st pause on',
  'st pause off',
  'st voice',
  'st channel',
  'st vumeter speed',
  'st volume',
  'st get volume',
  'st version',
  // --- Range 2.6 / 2.9Plus, slot 9: Shadow Software's AMOS Club extension.
  // One port for both builds; five slot-qualified names. Slice 1 --- the
  // self-contained half. See range.ts.
  'range',
  'shuffle',
  'rand',
  'js screen',
  'mkb$',
  'mki$',
  'mkl$',
  'cvb',
  'cvi',
  'cvl',
  'case',
  'case$',
  'of',
  'of$',
  'wrap',
  'analog scan',
  'analog x',
  'analog y',
  'sam speed',
  'busy printer',
  'no paper',
  'b width',
  'b height',
  'b colours',
  'i width',
  'i height',
  'i colours',
  'h spot x',
  'h spot y',
  'bank name',
  'bank name$',
  'game area',
  'in screen',
  'last float bob',
  'float bob reset',
  'float bob',
  'float bob clear',
  'float offset',
  'in screen bob',
  'list bobs',
  'list palette',
  'exchange bob colours',
  'exchange icon colours',
  'change bob colours',
  'change icon colours',
  'make bob colour',
  'make icon colour',
  'bank screen',
  'unbank screen',
  'push',
  'pull',
  'void',
  'fmod',
  'float back',
  'bank string',
  'bank str$',
  'bank str ptr',
  'bank str end',
  'library open',
  'library close',
  'key scan',
  'spoint',
  'splot',
  'first col',
  'nxt col',
  'analyse',
  'ch key scan',
  'ch scan code',
  'ch key state',
  'wipe',
  'set bzone',
  'dump err$',
  'diskin',
  'writeenable',
  'secread',
  'secwrite',
  'trackformat',
  'disk err$',
  // --- EasyLife, slot 16: Paul Hickman's extension, slice 1 — the zone
  // readers and the zone bank. Routines 4-17 and 100-104 for the zone block,
  // 153-157 for the overlap rectangle; see easylife.ts.
  'elznsx',
  'elznsy',
  'elznex',
  'elzney',
  'elzn shift',
  'elzb add',
  'el overlap',
  'el lapsx',
  'el lapsy',
  'el lapex',
  'el lapey',
  // slice 2 — the multi-zones, EasyLife's own zone system laid over the same
  // screen table. Routines 80-96.
  'elmz reserve',
  'elmz  set',
  'elmz erase',
  'elmznsx',
  'elmznsy',
  'elmznex',
  'elmzney',
  'elmzone',
  'elmzonen',
  'elmzoneg',
  // slice 3 — character searching and padding. Routines 18-53 in one
  // contiguous block at $14a2..$17a0, plus 144-146 and 151-152.
  'elf asc',
  'elf char',
  'elf not asc',
  'elf not char',
  'elf last asc',
  'elf last char',
  'elf last not asc',
  'elf last not char',
  'elf control',
  'elf nth asc',
  'elf nth char',
  'elf num asc',
  'elf num char',
  'elf fail start',
  'elf fail end',
  'elpad asc$',
  'elpad char$',
  // slice 6b -- the pattern block, on src/amiga/patternlib.ts
  'elpat case',
  'elpat nocase',
  'elpat def',
  'elpat set case',
  'elpat set nocase',
  'elpat free',
  'elpat test',
  'elpat remove$',
  'elpat escape$',
  // slice 9 -- the tag banks. Named without the El prefix because they are
  // the MUI half of the extension, but the lookup is an ordinary AMOS bank
  // read and nothing here needs muimaster.library.
  'tag',
  'tag$',
  'tag str',
  'tag str$',
  'tag attach$',
  'tag keep',
  // slice 11 -- MUI, on src/amiga/muimaster.ts
  'mui begin',
  'mui new',
  'mui application',
  'mui app',
  'mui dispose',
  'mui make button',
  'mui make popbutton',
  'mui get',
  'mui get$',
  'mui set',
  'mui set str',
  'mui do',
  'mui fn',
  'mui notify',
  'mui flush',
  'mui add',
  'mui remove',
  'mui hook',
  'mui input',
  'mui request',
  'tag block size',
  'tag list$',
  // slice 4 -- integers as strings, memory, banks and message banks
  'ellong',
  'ellong$',
  'elword',
  'elword$',
  'elextb',
  'elextw',
  'elmem',
  'elmem inc',
  'elmem$',
  'elbank name$',
  'els bank name',
  'elbnk here',
  'elmessage$',
  'elmessage exists',
  // slice 5 -- the bitwise block, routines 70-77
  'elwtst',
  'elltst',
  'elwset',
  'ellset',
  'elwclr',
  'ellclr',
  'elwchg',
  'ellchg',
  // slice 6a -- PowerPacker, routines 55-63 over src/amiga/powerpacker.ts
  'elpp load',
  'elpp buf',
  'elpp len',
  'elpp free',
  'elpp crunch',
  'elpp keep on',
  'elpp keep off',
  'elpp allocate',
  // slice 7 -- system, AmigaDOS and fonts
  'el base',
  'elpro',
  'elcompiled',
  'elexists',
  'elprotect',
  'els protect',
  'elexec',
  'elreset',
  'elraster wait',
  'elout',
  'elout exists',
  'elin$',
  'elin exists',
  'elin get$',
  'elopen font',
  'elclose font',
  'elclose fonts',
  'elset font',
  // slice 8 -- the four of thirteen that are not behind a library we do not
  // have: the Workbench three, and the XPK error field
  'elwb open',
  'elwb close',
  'elwb test',
  'elxpk error',
  // slice 8b -- the five XPK keywords, on src/amiga/xpkmaster.ts
  'elxpk lof',
  'elxpk load',
  'elxpk bload',
  'elxpk save',
  'elxpk bsave',
  // slice 8c -- the iconify family, on src/amiga/intuition.ts's OpenWindow
  'eliconify begin',
  'eliconify test',
  'eliconify end',
  'eliconify amos',
  // slice 10 -- structured variables, on src/runtime/elstruct.ts
  'st new',
  'st free',
  'st free all',
  'st dup',
  'st copy',
  'st type',
  'st len',
  'st lookup',
  'st get',
  'st get$',
  'st set',
  'st set str',
  'st cmp',
  'stv',
  'st output$',
  'st input',
  'st save',
  'st load',
  'st erase',
  // slice 12 -- 1.0's own last keyword, and 1.44's two `rts` ones
  'el error',
  // ...and the font pair under the two spellings that predate 1.09's rename
  'lock font',
  'unlock fonts',
  'elzb multi add',
  'zb multi add',
  'zb install',
  'amos data',
  'eltest',
  'ellock font',
  'elunlock fonts',
  'elzqzqzq',
  'elqqzqzqq',
  // ...and 1.0's names for the same routines, reached through `aliases`
  'i open workbench',
  'i close workbench',
  'i test workbench',
  'easy base',
  'protect',
  'set protect',
  'raster wait',
  'output exists',
  'output',
  'pp load',
  'pp buf',
  'pp len',
  'pp free',
  'pp crunch',
  'pp keep on',
  'pp keep off',
  'wtst',
  'ltst',
  'wset',
  'lset',
  'wclr',
  'lclr',
  'wchg',
  'lchg',
  'long',
  'long$',
  'word',
  'word$',
  'extb',
  'extw',
  'mem',
  'mem inc',
  'mem$',
  'set bank name',
  'message$',
  'find asc',
  'find char',
  'find not asc',
  'find not char',
  'find last asc',
  'find last char',
  'find last not asc',
  'find last not char',
  'find control',
  'find nth asc',
  'find nth char',
  'find num asc',
  'find num char',
  'znsx',
  'znsy',
  'znex',
  'zney',
  'zn shift',
  'zb add',
  'reserve multi zone',
  'set multi zone',
  'clear multi group',
  'mznsx',
  'mznsy',
  'mznex',
  'mzney',
  'mzone',
  'mzonen',
  'mzoneg',

  // --- Opal 1.1 (Martin Boyd), from `Opal.s` -- the author's own source, and
  // the whole shim -- and from Opal Technology's `devdocs.lha`, which carries
  // `opal.library`'s AutoDocs, the hardware manual, the include files and the
  // v4.3 library binary. The extension is SOURCE tier; the library behind it is
  // DOCUMENTED with the binary present to settle whatever the AutoDocs leave
  // open, which is how the two-bits-a-plane pixel layout was found.
  //
  // Screens and pixels. `CreateScreen24` fixes Depth and BytesPerLine,
  // `WritePixel24` and `ReadPixel24` fix where a pixel lives, and
  // `../amiga/opalvision.test.ts` disassembles both into assertions.
  'ovopenscreen24', 'ovcreatescreen24', 'ovclosescreen24', 'ovfreescreen24',
  'ovactivescreen24', 'ovclearscreen24', 'ovsetscreen24', 'ovrectfill24',
  'ovwritepixel24', 'ovreadpixel24', 'ovsetpen24',
  'ovgetred24', 'ovgetgreen24', 'ovgetblue24',
  // The two stencils, which are colour bits: the playfield one is the low bit
  // of plane 4 and the priority one the low bit of plane 8.
  'ovwritepfpixel24', 'ovreadpfpixel24', 'ovsetpfstencil24', 'ovclearpfstencil24',
  'ovwriteprpixel24', 'ovreadprpixel24', 'ovsetprstencil24', 'ovclearprstencil24',
  // The six memory-format conversions, each with its own AutoDoc entry.
  'ovilbmtoov', 'ovtoilbm', 'ovbitplanetoov', 'ovtobitplane', 'ovrgbtoov', 'ovtorgb',
  // The CoPro bit setters, all one shape: "clears the OVPRI bit of all CoPro
  // instructions", stopping at LastCoProIns when a display bottom is set.
  'ovamigapriority', 'ovpriority', 'ovdualdisplay24', 'ovsingledisplay24',
  'ovdualplayfield24', 'ovsingleplayfield24', 'ovenableprstencil24',
  'ovdisableprstencil24', 'ovsethires24', 'ovsetlores24', 'ovsetcopro24',
  'ovsetdisplaybottom24', 'ovcleardisplaybottom24',
  // The control line register, whose twenty bits opallib.h names one by one.
  'ovsetcontrolbit24', 'ovlatchdisplay24', 'ovautosync24',
  // The frame buffer. `WriteFrame24` at hunk $3a36 turns a frame number into
  // segments; `DownLoadFrame24` at $53ca reads them back.
  'ovdisplayframe24', 'ovwriteframe24', 'ovrefresh24', 'ovdownloadframe24',
  'ovclearquick24', 'ovupdateall24', 'ovupdatepfstencil24', 'ovstopupdate24',
  'ovlowmemupdate24', 'ovlowmem2update24',
  // The three register copies and the palette.
  'ovupdateregs24', 'ovupdatepalette24', 'ovupdatecopro24', 'ovsetrgb24',
  // Files. The IFF writer at hunk $a39c is reproduced chunk for chunk, the
  // OVTN thumbnail at $ad0c plane for plane.
  'ovsaveiff24', 'ovwritethumbnail24', 'ovdisplaythumbnail24',
  // The two that never enter the library.
  'ovconfig24', 'ovcopperrefresh',

  // --- The Game Extension 0.9 beta (Peter Cahill), from `AMOSPro_Game.Lib`
  // and, for the twelve tracker keywords, from ptreplay.library 6.6 itself --
  // vendored at fixtures/libs/, because these routines are nothing but calls
  // into it. `TGE.guide.beta` is read for intent only: it lags the shipped
  // table, names six keywords the table does not have, and is wrong about the
  // fade units, the channel bit order and the volume a play starts at.
  // Only the tracker batch is ported so far; see src/runtime/thegame.ts.
  'g ptload', 'g ptplay', 'g ptstop', 'g ptfade', 'g ptpause', 'g ptunpause',
  'g ptvolume', 'g ptchan on', 'g ptchan off', 'g ptpos', 'g ptlength',
  // The host and OS batch: five straight at the hardware, four at libraries
  // this port models, and the AppIcon pair, which stops where the machine's
  // own OpenLibrary test stops.
  'g reboot', 'g left click', 'g wait lmb', 'g wait rmb', 'g check vbl',
  'g cd32', 'g cli', 'g file size', 'g getmem', 'g iconify', 'g icon check',
  'g right click', 'g set mouse',
  // The trigonometry table and the four keywords that are not GMS, not
  // encryption and not a requester: a fixed-point cosine series, a task
  // priority, and a reserved variable that answers with a library base.
  'g set table', 'gsin', 'gcos', 'g oddno', 'g handicap', 'g unhandicap',
  // The encryption scheme: a StoneCracker crunch into an AMOS bank with four
  // words shuffled by a one-byte password. src/amiga/stonecracker.ts.
  'g init encyrpt', 'g encrypt', 'g decrypt',
  // and the same library without the password, which is the whole of batch 5
  'g stc pack', 'g stc unpack',
  // The three requesters the guide says were removed and were not.
  'g open reqtools', 'g close reqtools', 'g close req',
  // The GMS display. A TGE screen is a slot in the machine's one screen table
  // like any other -- Runtime.screenRange('game') -- and the GMS structures
  // behind these come from the developer suite at fixtures/gms/dev/, which
  // has screens.h, the .fd signatures and the AutoDocs for the module that
  // has no published source.
  'g screen open', 'g screen close', 'g screen hide', 'g screen show',
  'g screen', 'g screen copy', 'g screen offset', 'g bitmap offset',
  'g update', 'gscreen width', 'gscreen height', 'gscreen colour',
  'glowres', 'ghires', 'gsuperhires',
  // and the five that provably do nothing: two buffer keywords that index the
  // wrong register, the swap with nothing to swap, a screen lookup through a
  // register nobody loads, and a mode function that never sets its result.
  'g double buffer', 'g triple buffer', 'g swap buffers', 'g getscr', 'gham',
  // The palette. `Screen->Bitmap->Palette` is the array everything writes
  // through -- ChangeColours, UpdateColour and CopyPalette all say so -- and
  // Screen.palette is that array, so G Def Palette's pointer sharing is a
  // shared Uint16Array here too.
  'g ink', 'g colour', 'g palette', 'g def palette', 'g get palette',
  // Starting and stopping GMS. dpkernel.library is in ../amiga/exec.ts's
  // modelled set, so `G Init Gms` can fail the way the machine does; the five
  // OpenModule calls after it are bases this port has no use for, a GMS call
  // being a TypeScript call here.
  'g init gms', 'g close gms', 'g reset', 'g exit', 'g amiga', 'g make rp',
  'g own blitter',
  // Drawing. blitter.mod's entry points are named by ../amiga/gms.ts and
  // signed by fixtures/gms/dev/Includes/fd/blitter_lib.fd; where the module's
  // own name strings and the fd disagree the fd wins, and the module's code
  // settles it -- see "Which GMS source wins".
  'g plot', 'g circle', 'g rectangle', 'g cls', 'g copyarea', 'g point',
  'g rgb', 'g blur', 'g agaplasma',
  // Pictures. G Load Iff builds a screen round the loaded Picture rather
  // than round the tag template, which is the other way a GMS screen comes
  // into existence; ../loader/iff.ts is both ends of it.
  'g load iff', 'g save iff', 'g save bitmap', 'g load pcx',
  // Bobs. One of the three bob systems works: G Load Bobs reads an AmBk file
  // whose payload is $305f, builds a GMS Bitmap per image and a Bob per
  // G Set Img, and G Draw Bob and G Spaste Bob draw them. The bank layout and
  // the two tag lists behind it are in thegame.ts under "The bob banks".
  'g load bobs', 'g set img', 'g draw bob', 'g spaste bob', 'g erase',
  // The other two systems never worked, and the reasons are in the routines
  // rather than in this port: an impossible pair of magic tests, a slot table
  // fetched into the wrong register, a blit aimed at the bank it reads from,
  // an entry table read from the wrong block pointer, and a `bra` the author
  // put in front of the whole of G Get Img.
  'g init bobs', 'g setup bobs', 'g set bob', 'g bob',
  'g init mbobs', 'g set mbob', 'g paste bob', 'g get img',
  // The tile mapper, reproduced instruction for instruction because almost
  // none of it is 32-bit arithmetic.
  'g tmap',
])

/** Tokens the interpreter handles structurally (dispatch, literals, glue). */
export const STRUCTURAL = new Set([
  ':', ',', ';', '#', '(', ')', '[', ']', 'to', 'not', 'fn', 'then', 'step', 'rem', "'", 'procedure',
  'using', // parsed inside the Print handler
])

/**
 * Tokens with nothing to implement: editor-internal glue, plus keywords that
 * ARE raw 68k execution, deliberate debugger traps, syntax-only tokens the
 * table points at `L_Syntax`, null vectors their own authors documented, and
 * hardware below the layer this port models. No program's logic depends on
 * them producing a result here.
 *
 * ## What may be classified here, and what may not
 *
 * An n/a entry must name what the keyword IS. It may not name a capability
 * this port lacks — that is a to-do, and it belongs in "missing" where the
 * percentage counts it. "There is no requester", "AmigaFS is not a block
 * device" and "no ARexx system exists outside AmigaOS" were all entries here
 * and all three were work, not verdicts.
 *
 * ## The evidence an entry needs, which is the same an implementation needs
 *
 * n/a is the only classification with no verification obligation: a FAITHFUL
 * keyword must be dispatched by a test or the coverage gate fails, and an n/a
 * keyword has no handler to dispatch. Nothing but the reason itself stands
 * between a wrong classification and permanent invisibility, because an n/a
 * keyword is also out of the denominator.
 *
 * So: read the ROUTINE and read the DOC, and QUOTE from them. A citation is
 * not evidence of having read what it points at. Four entries here cited a
 * real source line and then described the keyword from its NAME — `Jd Squash`
 * was "rewrites a file in place through trackdisk to defragment it
 * (+|jd.s:5013)", and the line directly above the citation is the author's own
 * `SQUASH string,richtung,delay`, which says it is a text effect. `Jd Rprint`
 * was "through the printer path" and never touches a printer. `Jd Request` was
 * "a file requester" and is an intuition AutoRequest. Every sound entry below
 * quotes an instruction, an address or the author; every wrong one glossed.
 *
 * `src/ext/citations.test.ts` enforces the weakest mechanical part of this:
 * an extension with no author source must name the manual it was read
 * against, because prose is then the only thing that can catch a guess.
 */
export const NA = new Set<string>([
  // Range 2.9Plus routine 72 ($134e). `=Library Call(base, offset)` adds the
  // two, loads d1-d7/a0-a2 from ten longs at $9fa(a5), and `jsr (a6)` into
  // whatever is there. It is a general-purpose call into 68k machine code —
  // any library's function, chosen at run time by a program that knows the
  // LVO. Executing 68k is out of scope by policy, and there is nothing to
  // approximate: the whole keyword IS the jump.
  'library call',
  // Delta 1.6 routine 57 ($26a6), two instructions: `movea.l (a3)+,a0 / jsr
  // (a0)`. It calls a 68000 subroutine at an address the program supplies —
  // that is the whole keyword, and the guide's own contents marks it and the
  // three `Move*` beside it "- PRIVATE -". The other three are Poke, Doke and
  // Loke and are implemented; this one is the jump, so executing 68k is not
  // an ingredient of it but the thing itself.
  'jsr',
  // Range 2.9Plus's phantom. The token entry at id 1156 names `t planes` and
  // gives its routine as 26,220 — the ASCII "fl" of the `float planes` its
  // own table swallowed, and 278 times past the end of a 94-entry jump table.
  // A program that calls it jumps into nothing. There is no routine to read,
  // no behaviour to reproduce, and reproducing the crash would be neither
  // useful nor possible. See src/ext/manifests/range-2.0.json.
  't planes',
  // PowerBobs routine 116 ($4212) is fourteen bytes and the last two matter:
  // `jsr $120(a0)` through -$8(a5), then `illegal #$4afc`. It deliberately
  // takes the 68000 ILLEGAL trap to drop into a machine-code debugger. There
  // is no debugger here and no trap to take, and executing 68k is out of
  // scope by policy, so there is nothing to implement rather than something
  // approximated.
  'pdebug',
  // Routine 47 ($3632), 280 bytes, hunts the literal 'Amal' ($416d616c) in a
  // bank and PATCHES the machine code it finds, so 64 AMAL channels can run
  // under interrupts on an 020. It rewrites 68k instructions; there is no 68k
  // here to rewrite and executing it is out of scope by policy. Nothing to
  // approximate -- a program that calls it wants faster AMAL, and AMAL here
  // is already an interpreter running at whatever speed the host gives it.
  'set 68020 amal',
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
  // MISC 1.0: Multi Off and Multi On are the SAME two calls — `jsr -132(a6)`
  // and `-138(a6)` on ExecBase (Misc_Extension.asm:117, :124) — reached from a
  // different library, so they are n/a for the same reason JD's are.
  // CRAFT 1.0: routines 175 and 174 ($2ef4, $2ee6) are the same pair again,
  // `jsr -$84(a6)` and `-$8a(a6)` on the ExecBase at absolute $4. A third
  // product, one reason. Forbid NESTS on the machine, so a count was the one
  // thing that could have been modelled — but nothing in any of the three
  // libraries reads it back, so it would be state no program can observe.
  // `Pal On` (:209) is the one the manual apologises for — the label
  // is followed only by RS.B/EQU/MACRO directives, which emit no code, so it
  // falls straight into `Go60`, a routine whose own comment reads ";put system
  // in NTSC mode" and whose first instruction reads `Flag_FatAgnus(a0)` with
  // a0 never loaded. It does the opposite of its name and then crashes on
  // whatever a0 held. There is no behaviour to be faithful TO.
  'multi off',
  'multi on',
  'pal on',
  'jd multi off',
  'jd multi on',
  // the BUG macro's ILLEGAL instruction, there to drop a debugger in
  // (+|jd.s:835 with macros.s). No debugger, and deliberately crashing the
  // interpreter is not a service to anyone.
  'jd private',
  // TURBO Plus: routine 132 opens graphics.library, points COP1LC at its own
  // copper list (`move.l $26(a0),$dff080`) and clears a flag in the AMOS
  // workspace, handing the display back to the system so a developer can see
  // the machine underneath -- and then takes `illegal #$4afc`, the same
  // debugger trap Pdebug and Jd Private use. There is no system copper list
  // here to hand the display back to and no debugger to drop into.
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
  // SLN 2.0: `S Mask$` is in the token table and there is no routine behind
  // it. The author says so on the line itself --- `dc.w 1,-1` with the comment
  // "This command is non-existent!!! DO NOT USE. / Strictly for maintaining
  // compability / (will be replaced, as soon as I find another command which
  // fit the length)". He was padding the table to keep the token ids of a
  // v1.0 program valid, which is why Sln_ext_Historie counts 71 commands
  // where the table has 70 names. The spec "22,2" parses it as a STRING
  // FUNCTION of two strings and the function routine is -1, so evaluating it
  // jumps through a null vector; the instruction slot it does carry (routine
  // 1, S Mouse On) can never be reached, because the spec never lets it parse
  // as a statement. No handler is registered.
  's mask$',
  // the native AMOS compiler overlay (LoadSeg APCMP + jsr, +CompExt.s:219,349)
  'compile',
  'cmpcall',
  'comp load',
  'comp del',
  // the ARexx host bridge (rexxsyslib.library message ports) — no ARexx
  // system exists outside AmigaOS
])

/**
 * Why each n/a keyword is n/a, as data rather than as prose.
 *
 * An n/a keyword sits outside the coverage denominator, so the reason is the
 * only thing holding it up. Grouping those reasons answers the question the
 * flat set cannot: WHAT WOULD RETIRE THIS. Every entry here is waiting on a
 * capability this port has decided not to have, and if one of those decisions
 * is ever reversed the whole group changes classification together, which is
 * a thing worth being able to see coming.
 *
 * The groups were prose in UNIMPLEMENTED.md, in the section of a document
 * nobody reads, where nothing could check them against the set they describe.
 */
export type NaGroup =
  | 'm68k'
  | 'debugger-trap'
  | 'hardware'
  | 'multitasking'
  | 'syntax'
  | 'dead-vector'
  | 'editor'

/** What each group is waiting on, in the order a reader should meet them. */
export const NA_GROUPS: Record<NaGroup, string> = {
  m68k:
    'Executing 68000 machine code. The whole keyword IS the jump, so there is nothing to approximate. ' +
    'A 68k interpreter would retire this group entire.',
  'debugger-trap':
    'Taking the 68000 ILLEGAL trap on purpose, to drop into a machine-code debugger. There is none, and ' +
    'crashing the interpreter is not a service.',
  hardware:
    'Hardware below the layer this port models: the drive head through CIA-B, a battery clock at $DC0000, ' +
    'AMAL machine code patched in place. Virtual hardware at that depth would retire the group.',
  multitasking:
    "exec's Forbid and Permit. There is one task here and nothing to forbid.",
  syntax:
    'Reserved words that are part of somebody else\'s grammar, or have no construct in the shipped grammar ' +
    'that reaches them. There is no routine behind the token.',
  'dead-vector':
    'The keyword does not work in the original either: a null vector, a jump past the end of the table, or a ' +
    'label that falls into the wrong routine. There is no behaviour to be faithful TO.',
  editor:
    'The AMOS editor and the compiler overlay, neither of which exists here.',
}

/**
 * Every n/a keyword's group. coverage.test.ts requires this to cover NA
 * exactly: no keyword without a group, and no group entry that is not n/a.
 */
export const NA_GROUP_OF: Record<string, NaGroup> = {
  // 68k execution and its register scaffolding
  '@_apml_@': 'm68k',
  areg: 'm68k',
  call: 'm68k',
  cmpcall: 'm68k',
  doscall: 'm68k',
  dreg: 'm68k',
  execall: 'm68k',
  gfxcall: 'm68k',
  intcall: 'm68k',
  jsr: 'm68k',
  'lib base': 'm68k',
  'lib call': 'm68k',
  'lib close': 'm68k',
  'lib open': 'm68k',
  'library call': 'm68k',
  lvo: 'm68k',
  // assembles 68k into a bank, and the only way to reach what it writes is Call
  'trans screen dynamic': 'm68k',
  // deliberate ILLEGAL
  pdebug: 'debugger-trap',
  'jd private': 'debugger-trap',
  debug: 'debugger-trap',
  // below the modelled layer
  'mfm read': 'hardware',
  'mfm luecke': 'hardware',
  'jd setdate': 'hardware',
  'jd setclock': 'hardware',
  'set 68020 amal': 'hardware',
  // Forbid / Permit
  'multi off': 'multitasking',
  'multi on': 'multitasking',
  'jd multi off': 'multitasking',
  'jd multi on': 'multitasking',
  // broken in the original
  's mask$': 'dead-vector',
  't planes': 'dead-vector',
  'pal on': 'dead-vector',
  // reserved words with nothing behind them
  as: 'syntax',
  follow: 'syntax',
  'follow off': 'syntax',
  'screen size': 'syntax',
  // the editor and the compiler overlay
  'ask editor': 'editor',
  'call editor': 'editor',
  'kill editor': 'editor',
  monitor: 'editor',
  include: 'editor',
  equ: 'editor',
  struc: 'editor',
  'struc$': 'editor',
  '||apcmp||': 'editor',
  '\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\/': 'editor',
  ',': 'editor',
  compile: 'editor',
  'comp load': 'editor',
  'comp del': 'editor',
}


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
  "dpk unpack":
    "Routine 76 ($1806) over decrunch.library, and APPROXIMATED because the library is roughly seventy " +
    "decrunchers in 27KB and this port has one of the formats it knows. Identification is complete -- every " +
    "format, in the order the library tries them, answering the name it answers -- so `Dpk Name$` is faithful " +
    "and this keyword recognises everything. What it UNPACKS is PowerPacker data, id $48, through " +
    "../amiga/powerpacker.ts. Anything else is left alone, which is the library's own outcome for a format it " +
    "cannot handle: `dlDecrunch` answers zero and `tst.l d0 / beq .Skip` returns without an error. Widening it " +
    "means porting a decruncher; ../amiga/decrunchlib.ts's DL_DECRUNCHES is the list, so the gap is a value " +
    "rather than a claim. The bank arrangement IS reproduced: no Bnk.GetFree and no head-clone, just " +
    "`Bnk.Reserve` under the source's own number with my_BkNameWork, so an unpacked bank comes back called Work.",
  "dr file$":
    "Routine 41 ($12b0) over the splitter at 43 ($12e2), which walks back for `/` or `:`. DEFECT: with NO " +
    "separator the answer is the string shifted one character left with a byte of whatever follows on the end. " +
    "Routine 43 leaves a1 on the separator and routine 41 does `addq.l #1,a1` to step past it, but a failed scan " +
    "walks a1 all the way down to the first CHARACTER and the same step skips it. The length is right and the " +
    "start is one late. Reproduced with the trailing byte as NUL, which is the most this port can say about " +
    "memory it does not own.",
  "dr path$":
    "Routine 42 ($12cc). Everything up to and INCLUDING the last separator, empty when there is none. It copies " +
    "from the start of the string rather than from where the scan stopped, so it never meets routine 41's defect.",
  "db free":
    "Routine 44 ($1304): id_NumBlocks minus id_NumBlocksUsed off routine 49's Info, -1 when the Lock or the Info " +
    "failed. Routine 49 sets `pr_WindowPtr` to -1 across the Lock so AmigaDOS cannot pop its \"please insert " +
    "volume\" requester -- which is why a bad drive answers -1 instead of stopping the program dead.",
  "db used": "Routine 45 ($131a): id_NumBlocksUsed, -1 on failure.",
  "db size":
    "Routine 46 ($132c): id_BytesPerBlock, -1 on failure. The manual's \"usually 488 bytes\" is the DATA an OFS " +
    "block carries once its 24-byte header is off; id_BytesPerBlock is the block, so this answers 512 -- and the " +
    "same manual gets it right two lines earlier by pointing at the CLI's Info, which prints 512 too.",
  "disc state":
    "Routine 47 ($133e): `id_DiskState - 80`, turning AmigaDOS's 80/81/82 into the manual's 0 write-protected, " +
    "1 not yet validated, 2 validated. -1 is a failed Info, which is \"no disc\".",
  "disc type$":
    "Routine 48 ($1354): id_DiskType written out as four bytes and cut at the first NUL, so OFS is \"DOS\" and FFS " +
    "is \"DOS\"+Chr$(1) exactly as the manual says. ID_NO_DISK_PRESENT is -1 and the routine turns it into a zero " +
    "longword, which cuts to the empty string -- the same answer a failed Info gives.",
  "disc error": "Routine 58. The AmigaDOS IoErr routine 212 recorded before it raised.",
  "file protect": "Routine 50 ($13c8) over routine 54's Lock/Examine/UnLock: fib_Protection at +$74.",
  "file comment$": "Routine 51 ($13d4): fib_Comment at +$90, as a C string.",
  "file length": "Routine 52 ($13e0): fib_Size at +$7c, which is zero for a directory.",
  "file type":
    "Routine 53 ($13ec): fib_DirEntryType at +$4, so positive is a directory and negative a file. NOTE routine " +
    "54 does NOT set `pr_WindowPtr` where routine 49 does, so on a real machine a bad volume here really does " +
    "put a requester up -- the two halves of this extension disagree about that.",
  "set protect":
    "CRAFT routine 55 ($1430): dos.library's SetProtection. The manual tabulates the bits and they are FIBF_*, " +
    "with the low four active low: 0 delete, 1 execute, 2 write, 3 read, 4 archive, 5 pure, 6 script, 7 hide. " +
    "The name is CONTESTED and this note covers both: EasyLife 1.0 spells `Els Protect` this way, and its port " +
    "reaches the same SetProtection through an alias, so the two agree on what the keyword does and differ only " +
    "in which slot answers. See ALLOWED_UNDECLARED in ../runtime/contested.test.ts for why one handler still " +
    "serves both.",
  "set comment":
    "Routine 56: SetComment. The manual's \"the maximum length of the comment is 79 characters\" is the LIBRARY's " +
    "limit rather than the extension's -- an over-long note comes back as ERROR_COMMENT_TOO_BIG and routine 212 " +
    "raises it. An empty string clears the note, as the manual says.",
  "dr name$":
    "Routine 59 ($14d0). Locks the path and Examines it, so the name it answers is the DIRECTORY'S OWN -- the " +
    "manual's \"It is always the name of the directory\". It also opens the scan: routine 67 allocates the block, " +
    "the lock goes at +0 and fib_DirEntryType is copied to +4 for Dr Next$ to check.",
  "dr next$":
    "Routine 60 ($151e), ExNext into the same block. Two things the manual only half says. `tst.l $4(a2) / Rbmi " +
    "routine 212` runs first, so a Dr Next$ after a Dr Name$ that named a FILE is an error and not an empty " +
    "string. And on ERROR_NO_MORE_ENTRIES the routine FREES the scan block before answering \"\" -- which is why " +
    "\"If you continue reading the directory after getting an empty string, an error will be caused\": the block " +
    "is gone and the next call cannot find one.",
  "dr comment$": "Routine 61 ($1568): the open block's fib_Comment, at block+$98.",
  "dr protect": "Routine 62 ($1576): the open block's fib_Protection, at block+$7c.",
  "dr length": "Routine 63 ($1584): the open block's fib_Size, at block+$84.",
  "dr type": "Routine 64 ($1592): the open block's fib_DirEntryType, at block+$c.",
  "dr fib":
    "Routine 65 ($15a0), `move.l a2,d3 / addq.l #8,d3` -- the ADDRESS of the FileInfoBlock, eight bytes into the " +
    "scan block. It is why the block is real mapped memory in this port rather than a record: the manual sends " +
    "the reader to an appendix of offsets and expects them to Peek it. Runtime.CRAFT_FIB_BASE is where it lands, " +
    "and ../amiga/dos.ts's fibBytes lays the 260 bytes out. fib_DiskKey stays zero, being a real filesystem's " +
    "block number and not this one's.",
  "pal red":
    "Routine 68 ($161e) over the shared getter, routine 74 ($1652), then bits 8-11. Routine 74 does two things " +
    "beyond returning a register. A NEGATIVE argument is a colour VALUE rather than a number -- `tst.w (a3) / " +
    "bpl` peeks the stacked high word, and a negative one is popped, negated and handed straight back, which " +
    "is the manual's \"if it's negative, the function returns a value which is calculated by taking the current " +
    "component out of the absolute value of the parameter\". And the bound is SIXTY-FOUR: `cmpi.w #$40,d1`, " +
    "then `andi.w #$1f` with `btst #5,d2` on the original, so colours 32..63 read register n-32 through " +
    "`lsr.w #1 / andi.w #$777`. That is Extra Half Brite, the manual's only trace of it is the parenthesis " +
    "\"(0-63)\", and the test is on the NUMBER and not on the screen -- a 16-colour screen answers the halved " +
    "value just the same.",
  "pal green": "Routine 70 ($1630): routine 74, then bits 4-7. See `pal red` for what routine 74 does.",
  "pal blue": "Routine 72 ($1642): routine 74, then bits 0-3. See `pal red` for what routine 74 does.",
  "set red":
    "Routine 69 ($162a), `moveq #8,d4 / Rbra routine 75` -- d4 is the shift and routine 75 ($1692) is the whole " +
    "setter. It clamps as promised (\"x>15 => x=15 and x<0 => x=0\"), reads the register, replaces one nibble " +
    "and writes it back. DEFECT: its bound is not the getter's. Routine 74 admits 0..63 and reads the upper " +
    "half through the half-brite shift; this one is `moveq #$20,d0 / cmp.l d0,d3 / Rbcc routine 206`, so " +
    "THIRTY-TWO. `Set Red 40,15` is error 23 while `Pal Red(40)` answers happily.",
  "set green": "Routine 71 ($163c), `moveq #4,d4` into routine 75. See `set red` for the bound.",
  "set blue": "Routine 73 ($164c), `moveq #0,d4` into routine 75. See `set red` for the bound.",
  "pal copy":
    "Routine 78 ($1804): read col1, write col2, through AMOS's own colour get and set at $34 and $38 off the " +
    "jump table at $fff8(a5). \"Note that this instruction should not be used with flashing colours\", which is " +
    "true of the whole group -- none of them touch the Flash table, so the next flash step overwrites them.",
  "pal swap": "Routine 77 ($17bc): two gets, then two sets crossed over. Both registers are bounded at 32.",
  "pal spread":
    "The name is CONTESTED and this note covers both. AMCAF 1.40/1.50 has routine 334 ($736a); CRAFT 1.0 has " +
    "routine 76 ($16d4), and they are different keywords that happen to share a spelling -- the parameter " +
    "lists are \"I0,0t0,0\" against \"I0t0\", AMCAF's taking two colour VALUES and CRAFT's two colour " +
    "REGISTERS whose current contents are the ends of the ramp. Both ports qualify it, so a program gets the " +
    "one at the slot it bound. The rest of this note is CRAFT's. Four " +
    "things the prose leaves out. The ends are SORTED (`sub.w d0,d1 / bcc / neg.w d1 / sub.w d1,d0`), so `Pal " +
    "Spread 7 To 2` fills the same registers as `Pal Spread 2 To 7`. Adjacent or equal registers do nothing. " +
    "Each component runs in an accumulator holding the nibble at bits 8-11 over eight fractional bits, with a " +
    "bias of +127 added once where rounding would want +128 -- so an exact halfway value rounds DOWN, and " +
    "$000 to $FFF over four steps is $444, $777, $BBB rather than $444, $888, $BBB. And the loop's last write " +
    "lands on col2 itself; that is harmless, because the accumulated value is `target + 127 - r` for a " +
    "truncated remainder r under the distance, and the distance cannot exceed 31.",
  "reserve as palette":
    "Routine 79 ($1834), `moveq #2,d2 / Rbra routine 94` -- the resolver does the work. It allocates 72 + " +
    "64*(n-1) bytes and stamps \"Palettes\" over the first eight, and `bset #31,d1` on the length is " +
    "Bnk_BitData, so a palette bank survives Erase Temp like a Reserve As Data one. An existing bank is error " +
    "35 and that check comes before the name is looked at, so it never reports on a bank's contents.",
  "pal count":
    "Routine 80 ($183a): stack palette 1, `moveq #3,d2 / Rbsr routine 94`, answer d4. The count is `((length - " +
    "72) >> 6) + 1`. An unreserved bank answers 0 rather than raising -- \"if the bank is empty a value of zero " +
    "is returned\" -- but a bank that is reserved and is NOT a palette bank still raises, because routine 94 " +
    "compares the name before it looks at what the caller asked for.",
  "pal to bank":
    "Routines 81, 82 and 83 ($184a, $1856, $185e) onto the worker at routine 84 ($1870), which is where the " +
    "record layout is: \"Palettes\", then 32 words per palette, and a word of $FFFF meaning ABSENT rather than " +
    "black. It is the same $FFFF core AMOS's PalRout passes over, which is what lets a masked palette be " +
    "installed by handing over all 32 words. So \"the mask limits the colours transferred to the bank\" by " +
    "WRITING an absence, not by leaving the slot alone: a second Pal To Bank over the same palette with a " +
    "narrower mask deletes what the first one put there. QUIRK: routine 83 alone tests the stacked palette " +
    "against $80000000, AMOS's omitted-parameter marker, and sets d2 = 1 when it finds it -- so `Pal To Bank " +
    "5,,-1` reserves a bank where `Pal To Bank 5,` is error 36.",
  "pal from bank":
    "Routines 85, 86 and 87 ($1892, $189a, $18aa). d2 = 0 in all three, so this family never creates a bank: " +
    "\"if there is no bank b or it doesn't have enough palettes, an error will be given\". The two-argument " +
    "form hands the bank's own 64 bytes straight to AMOS, markers and all, which is \"the colour index whose " +
    "representative is deleted from a bank, won't be changed\"; the three-argument one ANDs the caller's mask " +
    "on top by writing $FFFF over what it excludes.",
  "pal swap bank":
    "Routines 88, 89 and 90 ($18d8, $18e0, $18e8). Routine 90 makes two masked copies in the work area at " +
    "$4c6(a5) before it writes anything, which is what makes it a swap rather than two overwrites, and it " +
    "spells its mask walk `ror.l #1,d7` rather than `lsr.l` so d7 survives all three passes. DEFECT: the copy " +
    "going BACK into the bank is masked the same way as the one coming out, so a partial mask does not " +
    "preserve the bank's other colours -- it ERASES them to $FFFF. The manual claims only that the mask " +
    "\"limits the colours transferred from the bank\" and says nothing about the return leg.",
  "set bank colour":
    "Routine 91 ($192c). `moveq #$ff,d0 / cmp.l d0,d7 / beq` -- the value is compared against MINUS ONE as a " +
    "longword before it is masked, and only that exact value skips the `andi.w #$fff`. So -1 writes the " +
    "absence marker and is Del Bank Colour by another name, while -2 is masked to $ffe and is an ordinary " +
    "near-white.",
  "bank colour":
    "Routine 92 ($1950): `ext.l d3` on the stored word, so the $FFFF a deleted colour leaves behind comes back " +
    "as -1 -- \"if there is no colour available, a value of -1 is returned\".",
  "del bank colour": "Routine 93 ($196c): the $FFFF marker, written over one slot.",
  "wb prefs":
    "Routine 179 ($2f58): GetPrefs at -$84 off IntuitionBase, over an address AMOS routine 431 resolves and " +
    "`btst #$0,d3 / Rbne routine 208` refuses if odd -- AMOS error 25, not one of CRAFT's. The size goes " +
    "straight through, so a short one copies the front of the structure and that is Intuition's contract " +
    "rather than this extension's. Wb Def Prefs is the same over GetDefPrefs (-$7e) and Set Wb Prefs over " +
    "SetPrefs (-$144), whose two-argument form pushes -1 for the third and so makes the change permanent.",
  "guru meditation":
    "Routine 167 ($2e18). It does exactly what the name says: the second argument goes into the scratch area " +
    "as the alert's parameter list, `bset #$1f,d7` makes the number a DEADEND alert, and `jmp -$6c(a6)` is " +
    "exec's Alert, which for a deadend one never returns. This port answers that with a cold reset -- see " +
    "../amiga/machine.ts for what a reset means here.",
  "guru alert":
    "Routines 168 to 172 onto the body at routine 173 ($2e5a): one to five lines, each laid into an IntuiText " +
    "chain centred by `asl.w #2 / subi.w #$140 / neg.w` -- 320 less four times the length -- and stepped ten " +
    "pixels a line from a first at 14. A line of 78 characters or more is error 23, an empty one is skipped, " +
    "and a set with nothing in it at all is error 23 as well (`tst.w d5 / Rbeq routine 206`). Then DisplayAlert " +
    "at -$5a, with AMOS's own display taken down and put back around it. \"If the user presses the right mouse " +
    "button, the function returns a zero (False), but if the user presses the left button, the function returns " +
    "a value of -1\". DEVIATION: this port draws it with the dialog machinery every other requester here uses, " +
    "so the geometry is not the machine's; what a program can observe -- which lines are refused, and the " +
    "answer -- is.",
  "sys request":
    "Routines 182 to 187 ($2fa8..$2fc6): AutoRequest at -$15c, through `ThisTask->pr_WindowPtr` at $b8. The " +
    "argument order is the interesting part -- routine 187 pulls the LAST two off the stack as the gadget " +
    "labels before it walks back over one to five body lines, which is how three arguments make a one-line " +
    "requester and seven make a five-line one. \"If you use empty strings\" the labels are Retry and Cancel, " +
    "and both words are in the hunk at $3096 and $308e with their length bytes in front, beside the " +
    "topaz.font the IntuiTexts are drawn in.",
  "cli here":
    "Routine 203 ($325a). `ThisTask->pr_CLI` is a BPTR, which is what the two `adda.l a0,a0` are for, and then " +
    "`cli_Background` at $2c decides: -1 for a FOREGROUND CLI, 0 for a background one, and 0 again for a " +
    "process with no CLI at all. A program under this port was not started from a shell, so it is 0 -- the " +
    "same answer the machine gives a Workbench-launched program.",
  "cli execute":
    "Routine 165 ($2dda): Output() and Input() off DOSBase at `$620(a5)`, then Execute at -$de. Passing both " +
    "handles is what makes the command INHERIT the console, where EasyLife's Elexec passes zero and runs " +
    "detached -- ../amiga/process.ts records the contrast, and this port has no shell behind either, so both " +
    "answer DOSFALSE. Cli Print (routine 166) takes the same Output() and gives up on a zero one, which is " +
    "what a Workbench-launched program has, so on the machine it prints nothing either.",
  "hard reset":
    "Routine 188 ($3106): Disable, Supervisor, `clr.l $4.w`, RESET, and a jump to $2 -- the ROM's entry. " +
    "Clearing ExecBase first is the whole difference from Warm Reset (routine 189, $3122): the ROM finds " +
    "nothing there and builds a new one, which is a cold boot. See ../amiga/machine.ts.",
  "fr mandelbrot":
    "Routine 160 ($2b8a) over the shared setup, routine 161 ($2c8c). Everything is 16-bit fixed point with 8192 " +
    "as one -- the manual says so for the coordinates and the iteration confirms it, because a product of two " +
    "of them carries 26 fractional bits and `asl.l #3 / swap` is a multiply by eight and a shift down sixteen, " +
    "which is a division by 8192. The escape test is `cmp.l #$10000000,d4` on that product, and $10000000 over " +
    "2^26 is four. DEFECT: the iteration guard is not Fr Julia's. Routine 159 uses `subq.w #$1,d0 / Rbcs`, " +
    "which refuses only zero; this uses `Rbls`, which is carry OR zero, so `Fr Mandelbrot 1` is error 23 where " +
    "`Fr Julia 0,0,1` draws. The manual calls the two \"identical\".",
  "fr julia":
    "Routine 159 ($2a4c), and the only difference from Fr Mandelbrot is where c comes from: here the keyword " +
    "and there the pixel, which is why the Mandelbrot arm is sixty bytes shorter. The answer per pixel is the " +
    "iteration at which the orbit escaped counting from ONE, or index zero for a point that never did -- \"as " +
    "the iteration count starts from one, the index number zero has a special meaning\". The colour byte is " +
    "written a bit at a time across as many bitplanes as the screen has, which is \"the colour number may be " +
    "bigger than the screen mode would allow, because in such cases only the lower bits of the number are " +
    "used\".",
  "fr step":
    "Routines 143 and 142 ($2828, $280a). DEFECT, and it takes the whole two-argument form with it: routine 142 " +
    "stores **d0** into the y step where it means d2, and d0 is the X argument. So `Fr Step 4,8` sets both " +
    "steps to 4; and `Fr Step ,8`, where d0 is the -1 that means \"x omitted\", sets the y step to $ffff -- " +
    "65535, sixty-four times the 1024 routine 144 has just finished enforcing. Only the one-argument form, " +
    "which sets both from one number on purpose, does what it says, and that is presumably why the manual " +
    "writes `Fr Step xy` first.",
  "fr window":
    "Routines 151, 152 and 153 ($294a, $295c, $2974) onto routine 154 ($2994). The one-argument form pushes " +
    "four omitted markers and falls into the five-argument one, so `Fr Window 2` is `Fr Window 2,,,,`. An " +
    "omitted x or y is zero and an omitted width or height is the screen's less the corner -- routine 154 " +
    "reaches back down its own argument stack for that corner with `sub.w $6(a3),d0`, reading the low word of " +
    "a value it has not popped yet. \"The x, y, width and height parameters are not checked until a Fr Julia " +
    "or Fr Mandelbrot instruction is issued\", and routine 161 is where that happens: the rectangle is clipped " +
    "against the screen's clip window and the Fr Scan band, and a band left with nothing in it draws nothing " +
    "rather than failing.",
  "fr scan":
    "Routines 156 and 157 ($29f4, $2a08). The ONE-argument form draws a single line, `move.w #$1,$2c(a1)`; the " +
    "two-argument one takes a height of 1..16383 and refuses zero. Routine 161 recomputes the plane coordinate " +
    "from the band's own first line, so scanning the middle of a picture draws the pixels a whole one would " +
    "draw there. \"The scan area is always reset after a fractal drawing instruction\" -- both drawing " +
    "routines end with `clr.w $2a(a1) / move.w #$4000,$2c(a1)`.",
  "fr colour":
    "Routine 147 ($287e) over routine 149 ($28ba), which allocates 1025 bytes on first use and seeds them with " +
    "a byte counter -- index n starts as colour n & 255. Index 0..1024 and colour 0..255. Fr Reset frees the " +
    "table, so the counter comes back.",
  "fr position":
    "Routine 139 ($27a8): the plane coordinate of the window's TOP LEFT corner in units of 1/8192, both halves " +
    "bounded to a signed word. It is also the only thing that sets the flag routine 161 tests -- Fr Reset " +
    "clears that flag and leaves the values where they are.",
  "tr base":
    "Routine 137 ($2784), `moveq #$2e,d3 / add.l $208(a5),d3` -- the workspace address plus $2e. The manual is " +
    "literal (\"returns the address of the internal turtle variable area\") and sends the reader to an appendix " +
    "of offsets, so this port MAPS the block rather than mirroring it and a Peek of it reads what the keywords " +
    "read. The layout is in no documentation: a flags byte, then the heading as a 32-bit binary angle, then the " +
    "two direction words, position, home, proportions, the dash state and the three Tr Remember slots -- 56 " +
    "bytes, and `TR` in ../runtime/craft.ts names every offset.",
  "tr forward":
    "Routine 107 ($20a6). The heading is kept TWICE and never both at once: $30 is a 32-bit binary angle where " +
    "2^32 is a full turn, and $34/$38 are sine and MINUS cosine in SIGN-MAGNITUDE 16.16 -- bit 31 is the sign " +
    "and the rest a magnitude of at most $10000. Bits 0 and 1 of the flags say which of the two is live, and " +
    "routines 106 and 109 convert one into the other on demand. Tr Reset caching `clr.l $34 / move.l " +
    "#$80010000,$38` for a heading of zero is what pins the format: north is (0, -1), so the LOGO convention " +
    "and a screen whose y grows downwards agree with nothing negated later. The multiply itself is `mulu.w` on " +
    "the magnitudes with the sign carried by `eor.l d3,d2` against a distance whose high word was left negative " +
    "on purpose, and `btst #$10` for the magnitude of exactly 1.0, which no word can hold.",
  "tr get angle":
    "Routine 100 ($1dee) over routine 106 ($1f56). Routine 106 is the arcsine half of the conversion: the " +
    "quadrant comes from the two sign bits and the size from one arcsine, which is enough because the pair is " +
    "always a unit vector. The series behind it ($1ffe) has nine terms over a coefficient table at $208e, and " +
    "one of the six tabulated pairs is wrong -- 63/1403 where arcsine wants 63/2816, so the divisor should be " +
    "1408 ($580) and the file has 1403 ($57b). It sits on the eleventh-order term and cannot move a pixel. " +
    "Going back the other way is not the same constant either: routine 101 multiplies by 11930464.7 and this " +
    "divides by 11930624, thirteen parts in a million apart.",
  "tr towards":
    "Routine 104 ($1e7a). DEFECT: the aspect correction it goes through, routine 105 ($1f3a), tests the wrong " +
    "register. The hires half loads the screen mode into d4 and tests d4; the interlace half then tests **d3**, " +
    "which the caller left holding half the turtle's y. So the vertical correction never fires and Tr Towards " +
    "aims at the wrong point on an interlaced screen. The same eight instructions are written correctly inside " +
    "routine 119 at $246e, which is what makes this a slip rather than a decision.",
  "tr distance":
    "Routine 121 ($2580). DEFECT, and it locks the machine up: the normalising loop is `lsl.l #1,d0 / bcs / " +
    "lsl.l #1,d1 / bcc` back on itself and a carry can never appear when both deltas are zero, so " +
    "`Tr Distance(Tr X Pos, Tr Y Pos)` never returns. Tr Towards normalises the same way and tests for the " +
    "zero pair first; this does not. DEVIATION: a port cannot hang, so it answers the 0 the arithmetic would " +
    "have reached. It inherits routine 105's interlace bug as well.",
  "tr draw":
    "Routine 116 ($236c), which turns the absolute target into a delta and hands it to the shared mover with " +
    "the scaling switched off. DEFECT: an omitted y is not handled. Routine 118 answers an omission by zeroing " +
    "d0, and the subtraction that would have made d1 a delta is skipped along with it -- so d1 still holds the " +
    "CURRENT y that routine 113 put there and the mover ADDS it, sending the turtle to twice its own y. An " +
    "omitted x is fine, because there the zero really is the delta that changes nothing. Tr Move next door " +
    "assigns instead of subtracting and gets both right.",
  "tr move":
    "Routine 114 ($2326), the only mover that does not go through routine 119: it writes the position outright, " +
    "so neither the screen aspect nor Tr Proportions touches it. \"Either parameter may be omitted, just " +
    "remember to write the comma\", and both omissions land correctly here.",
  "tr set home":
    "Routine 127 ($268a). DEFECT: the two fallbacks for an omitted parameter are CROSSED. The first value off " +
    "the stack is y and its fallback loads $44, the home X; the second is x and its fallback loads $48, the " +
    "home Y. So `Tr Set Home 10,` copies the old home's x onto its y, and `Tr Set Home ,20` does the mirror.",
  "tr home":
    "Routine 128 ($26b4): the heading back to zero, then Tr Move onto the home. DEFECT: the coordinates are " +
    "handed over as `moveq #0,d0 / move.w $44(a1),d0`, which ZERO-extends the integer half, so a home with a " +
    "negative coordinate arrives at routine 118 as 32768 or more and is thrown out. `Tr Set Home -10,50` " +
    "followed by `Tr Home` is error 23 rather than a move, and every other keyword in the group takes a " +
    "negative coordinate without complaint.",
  "tr remember x":
    "Routine 131 ($26fa), and the one thing it does beyond storing: the FIRST Remember to run also primes the " +
    "OTHER slot from the matching home coordinate, so a Tr Memorize Y after only a Tr Remember X lands on the " +
    "home's y rather than on nothing. One slot each and not a stack. Tr Remember A (routine 133) does not set " +
    "that flag at all -- its slot is simply zeroed by Tr Reset, so a Memorize A with nothing remembered is a " +
    "heading of zero.",
  "tr proportions":
    "Routines 125 and 126 ($2622, $2628). \"The limits of the parameters are -16 to 16 inclusive, and zero is " +
    "not allowed\", which is exactly the pair of unsigned compares. The one-argument form is `move.l " +
    "(a3),-(a3)` -- it duplicates the stacked value rather than passing an omitted marker, which is how one " +
    "number sets both coefficients. The flag that switches the scaling on is RECOMPUTED from the pair " +
    "afterwards, so putting both back to 1 turns it off again.",
  "tr exec":
    "Routines 95 and 96 ($1a48, $1a7c) -- a whole interpreted language inside one keyword, and its grammar is " +
    "only in the binary. The command table at $1c88 is twenty-two entries of [offset][name, last byte with bit " +
    "7 set][argument mask], and every one of them is a `Rbra` onto the routine its AMOS keyword already uses, " +
    "so nothing in TCL is a second implementation. `I`/`P` is the exception and has no keyword: SetBPen then " +
    "SetAPen, bounded 0..31. The mask is read a bit at a time and bit n-1 set means \"stopping after n " +
    "arguments is allowed\". Names are at most TWO capitals with the lower case skipped, which is what \"only " +
    "capital letters are necessary\" means -- and `H` is cut to one letter by an instruction of its own, so " +
    "HOME spelled in full capitals parses as `H` and then chokes on `OM`. The repeat count is bounded by " +
    "`cmpi.l #$7d0,d0 / Rbhi routine 206`, UNSIGNED, so a negative count is error 23 and zero runs nothing.",
  "tr error":
    "Routine 97 ($1d90), `$58 - $56`: the TCL string's length plus one, less what was left when the failing " +
    "command started, which is that command's one-based position. A clean pass zeroes both words with one " +
    "`clr.l`, so \"if there were no errors, a value of zero is given\". Bit 4 of the flags is set for the " +
    "length of a Tr Exec and is how routine 217 chooses between CRAFT's \"Turtle error: illegal function " +
    "call\" and AMOS's error 23 for the same out-of-range argument.",
  "tr pen state":
    "Routine 124 ($260e), `btst #2 / seq / ext.w / ext.l` -- so -1 for a pen that is DOWN. The flag is stored " +
    "the other way up: bit 2 SET is up, which is why Tr Reset's `move.b #$3,$2e(a1)` leaves the pen down.",
  "dr forget":
    "Routine 66 ($15ae): `moveq #-1,d0 / Rbra routine 67`, which frees the whole scan block, FileInfoBlock " +
    "included -- so the accessors stop answering, not just Dr Next$. It runs on Run and on Default too, which " +
    "is the `defaults` hook in instr.ts.",
  "up case$":
    "Routine 3 ($d6e), and `bchg #5` over two ranges rather than a table -- 0x61..0x7a and 0xe0..0xfe -- which " +
    "is how it delivers the manual's \"they can convert all the special characters too. These characters include " +
    "e.g. \u00e6, \u00fc, \u00e4, \u00f6, \u00e1, \u00e7, \u00e9, \u00f1\". DEFECT: 0xf7 is Latin-1's DIVISION SIGN " +
    "and it sits inside the second range at exactly the case offset, so Up Case$ answers the multiplication sign. " +
    "0xff is spared, because the range stops one short of it.",
  "lo case$":
    "Routine 4 ($da4), the mirror of Up Case$ over 0x41..0x5a and 0xc0..0xde, and it inherits the same DEFECT " +
    "from the other side: 0xd7 is the MULTIPLICATION SIGN and comes back as 0xf7. 0xdf, which has no upper case, " +
    "falls outside the range and is left alone.",
  "flip case$":
    "Routine 5 ($dda). Four range tests and two equality tests: 0xdf and 0xff are named explicitly and spared, " +
    "everything from 0xc0 up is flipped, and the two maths signs go round with the letters as they do in the " +
    "other two.",
  "left trim$":
    "Routines 7 ($e30) and 6. The trim argument is a SET, not a character -- the inner `cmp.b (a0)+ / dbeq` scans " +
    "the whole of it -- and the one-argument form is four instructions that push the inline string at $e2c, a " +
    "length word of 1 and a space. An EMPTY trim set is `Rbcs routine 206`, AMOS error 23, rather than a no-op.",
  "right trim$": "Routine 9 ($e78), the same walk from the other end, with routine 8 supplying the same default space.",
  "bw instr":
    "Routine 11 ($ec0). Instr backwards: the last character of f$ is matched first, scanning down from s$+p, then " +
    "the rest is confirmed forwards with `cmpm.b`. The result is 1-based and 0 means no match. `p` defaults to " +
    "the length of s$, is clamped to it when larger, and a negative one is `Rbmi routine 206`. The manual's " +
    "\"the function does not accept an occurrence of f$ if it extends past the position p\" falls out of where the " +
    "scan starts.",
  "chr conv$":
    "Routine 12 ($f20). Both codes are compared against 255 UNSIGNED before anything else -- `moveq #0,d0 / " +
    "not.b d0 / cmp.l d0,d6 / Rbhi routine 206` -- so 256 and -1 are both error 23.",
  "str count":
    "Routines 16 ($f94) and 17 ($fa8). DEFECT: the arguments are the other way round from the manual, which says " +
    "\"=Str Count(search$,string$)\" and \"counts how many times does the search$ occur in the string$\". Routine 16 " +
    "pops the LAST argument into a2 and the first into a0; routine 17 reads a2's length word as the needle and " +
    "scans a0 -- so the FIRST argument is the string being searched. The author's own Dir_Read_Special.AMOS " +
    "writes `Str Count(A$,\"*\")` with A$ the path, which is the binary's order, so the help is what is wrong. " +
    "The rest matches it: a hit steps past the whole occurrence, which is why \"aaaa\" holds two \"aa\" and not three.",
  "mem str count":
    "Routines 13 ($f5a) and 14 ($f6a) onto the same routine 17. The range form passes `end - start`, which " +
    "routine 17 wants as a length minus one, so start and end are both included. DEFECT: the BANK form passes " +
    "routine 15's length unsubtracted and reads one byte past the bank. Mem Scramble and Mem Unscramble resolve " +
    "banks through the same routine 15 and do `subq.l #1,d0` first, which is what makes this an omission rather " +
    "than a convention. In this port every bank sits alone in its own megabyte, so the extra byte reads as zero.",
  "str scramble$":
    "Routines 18, 22, 23 and 19. A real stream cipher, not an XOR: the keystream depends on a running 32-bit d5, " +
    "the plaintext byte, the password position and the number of bytes left, so one repeated plaintext byte comes " +
    "out different every time. An empty password is `Rbeq routine 206`, error 23. The key schedule ends " +
    "`andi.w #30,d0 / add.l (-44,pc,d0.w),d5`, which reaches sixteen overlapping longwords at $1078 -- routine " +
    "23's OWN first instructions. It mixes a longword of its own code into the key.",
  "str unscramble$": "Routines 20, 22, 23 and 21 -- routine 19's inverse, sharing the key schedule exactly.",
  "hex dump$":
    "Routines 25 ($10b2) and 24. Uppercase (`add.b #7` above nine, then `#48`), a space after every `sep` bytes " +
    "but never after the last, so the result is `2*len + (len-1)/sep` characters. `sep` defaults to 4, pushed by " +
    "routine 24. A `sep` of zero, or one at least as big as `len`, takes the no-space path -- the routine sets " +
    "d4 to -1 so the counter cannot reach zero. The range check is `tst.w (a3)` on the argument's HIGH word, so " +
    "65535 is legal and 65536 is error 23.",
  "chr dump$":
    "Routine 26 ($1120). A byte survives when `b AND $60` is non-zero and becomes a full stop otherwise, which " +
    "is exactly the manual's \"All the characters that can't be printed (0-31 and 128-159) are converted to full " +
    "stop\" -- those are precisely the bytes with neither bit 5 nor bit 6.",
  "str peek$":
    "Routines 28 ($114a) and 27. Only the FIRST character of stop$ is used: the routine loads its length word " +
    "into d6 and never reads d6 again. An empty stop$ counts as absent. A length whose high word is non-zero is " +
    "not an error but a silent clamp to 65500. DEFECT: when the stop character is never found the scan still " +
    "walks all `len` bytes, and the `subq.l #1` that exists to drop the stop character eats a real one instead, " +
    "so the answer is one byte short. The two-argument form never reaches that code and returns all `len`.",
  "str poke": "Routine 29 ($119a). No bound of any kind, and an empty string writes nothing -- `subq.w #1,d0 / bcs` guards the loop.",
  "chip max block":
    "Routine 32 ($11fc): `move.l #$20002,d1` into routine 34, which is `jsr -216(ExecBase)` -- " +
    "AvailMem(MEMF_CHIP|MEMF_LARGEST). DEVIATION: the modelled pools track a total rather than a largest free " +
    "block, so this answers what Chip Free does. TURBO Plus's Chip Largest is the same call and carries the same note.",
  "fast max block": "Routine 33 ($1206), the same call with $20004, MEMF_FAST|MEMF_LARGEST. Same DEVIATION as Chip Max Block.",
  "mem copy":
    "Routine 35 ($1222): `sub.l a0,d0 / addq.l #1,d0` then exec's CopyMem (-624), so the range INCLUDES both " +
    "ends and `Mem Copy a,a To b` moves one byte. The manual sells it as \"almost the same instruction as Copy, " +
    "but it allows you to use addresses which are not dividend by four\", which is CopyMem's byte granularity " +
    "against AMOS's longword Copy.",
  "mem type":
    "APPROXIMATED. Routine 36 ($123a) is `btst #0,d3 / Rbne routine 208` -- an odd address is AMOS error 25, " +
    "\"Address error\" -- and then exec's TypeOfMem (-534), whose flags are the manual's bit table: 1 public, " +
    "2 chip, 4 fast. The check and the error are exact. What cannot be is the answer: a real machine decides " +
    "chip against fast by WHERE the address is, and this port models memory type as a flag on the bank, so an " +
    "address inside a bank answers from that flag, any other modelled region answers fast, and an address in no " +
    "region answers 0 -- which is TypeOfMem's own answer for memory outside the system list.",
  "mem scramble":
    "Routines 37 ($125c) and 38. Two forms over the shared cipher: `start To finish` is inclusive and a " +
    "backwards range is `Rbcs routine 206`, error 23; the bank form resolves through routine 15, whose unsigned " +
    "`cmp.l #16` makes bank 0 as illegal as bank 17. Both subtract one from the length before the core, which " +
    "Mem Str Count's bank form does not.",
  "mem unscramble": "Routines 39 ($1286) and 40, the same two forms onto routine 21.",
  "port":
    "`FnPort` (+Lib.s:5050): GetFile first, so a channel that is not open raises; then `btst #2,FhT(a2)` refuses " +
    "one that was not opened by Open Port -- a file-type mismatch, not a quiet zero. Then WaitForChar for 50 " +
    "microseconds, and nothing waiting answers TRUE (-1) through `L_FnTrue`, otherwise ONE byte is Read and " +
    "returned. So -1 is \"no character yet\" and 0 to 255 is the character, which is why a program loops on it " +
    "rather than testing for zero. Open Port itself is Open In with a different pair of constants: mode 1005 as " +
    "Open In uses and channel-type flags `%111` where Open In pushes `%010`.",
  "ldevice open":
    "Routine 31 ($18ca): a channel already open is error 9, \"Device already open\"; otherwise FindTask(NULL) " +
    "fills the port's mp_SigTask, AddPort links it, the name is copied and NUL-terminated, and OpenDevice runs. " +
    "The answer is OpenDevice's own result, so ZERO means success -- the opposite way round from most of this " +
    "library. There is ONE channel, not eight: the IORequest is a fixed block at +$298 of the workspace. " +
    "`=Ldevice(COMMAND,DATA,LENGTH,OFFSET)` (routine 33) writes the four straight into the request at $1c, $28, " +
    "$24 and $2c, DoIOs, and answers io_Actual at $20; `=Ldevice Error` (routine 39) is `move.b $1f(a1),d3` with " +
    "d3 cleared first, so io_Error comes back UNSIGNED and a device error of -1 reads as 255.",

  "arexx":
    "`FnArexx` (+Lib.s:15064) has THREE answers, not two: 0 for no message, 1 for a message, and 2 for one whose " +
    "rm_Action has RXFF_RESULT set, meaning the sender wants a result STRING and not just a return code -- a " +
    "program branches on 2 to decide whether to build one. The family is AMOS's own Arx_* code over exec message " +
    "ports, modelled by amiga/rexx.ts, so a host outside can send to the port a program opened and the whole " +
    "handshake runs. What is NOT here is the ARexx LANGUAGE: rexxmast is a separate resident program, and an " +
    "Amiga without it running answers nothing on the REXX port either -- the absent arm is the machine's, not a " +
    "stub. `Arexx Open` refuses 32 characters or more (`cmp.w #32,d2 / Rbcc L_StooLong`) and any character at or " +
    "below a space (`cmp.b #\" \",-1(a0) / Rble L_FonCall`), so a name with a space in it is a function-call " +
    "error. `Arexx Close` is error 198 while a message is still held, which is what stops a sender waiting for a " +
    "reply that is never coming. `Arexx Answer`'s string is dropped rather than raising when the sender did not " +
    "ask for one.",
  "lrexx make host":
    "Routines 53 to 60 ($2106-$23c4). Every one opens by loading rexxhost.library's base from the workspace at " +
    "+$5a8 and, if it is zero, `moveq #$18,d0 / Rbra routine 91` -- error 24, worded by the library's own message " +
    "table as \"Missing part of ARexx (lib/server)\". rexxhost.library is not modelled here, so that is the arm " +
    "these take, and it is the arm a machine without the library takes. amiga/rexx.ts DOES model public ARexx " +
    "ports and the core Arexx family runs on it, but that family is AMOS's own Arx_* code, which ships in the " +
    "source; wiring LDos's onto the same ports needs rexxhost.library's API, and six LVOs read out of a " +
    "disassembly is not enough to claim it. `=Lrexx Result1` and `=Lrexx Result2` do NOT check the library -- " +
    "four instructions each, a longword read from +$5b0 and +$5b4 -- so they answer the zero those slots hold.",

  // ---- the core Dev * family, +Lib.s:3300-3385 ----------------------------
  "dev open":
    "`Lib_Par InDevOpen` (+Lib.s:3303). An empty name is a function-call error and so is a LENGTH of zero or " +
    "less (`Rble L_FonCall`); a channel already open is error 140. NOTE: the message a failed OpenDevice raises " +
    "is 145, which the error table words as the SERIAL device's -- `move.w #145,d3 / moveq #1,d4` gives the whole " +
    "family one message and AMOS reused serial's rather than adding one, so a trackdisk that will not open " +
    "reports a serial fault. NOTE: `Dev_Max equ 7` with `Dev_List rs.b 12*Dev_Max` disagree by one -- Dev.GetA2 " +
    "admits 0 to 7 and Dev.Close sweeps eight, over a table of seven slots, so channel 7 reads and writes the " +
    "twelve bytes after it. Eight slots are kept here; the arithmetic a program can see is the same and there " +
    "is nothing past the table to corrupt. Which names open is DEV_MODELLED in runtime/device.ts: trackdisk, " +
    "serial, printer and parallel are the four with a back end, and answering yes for anything else would be " +
    "claiming a device that does nothing.",
  "dev do":
    "`InDevDo` (+Lib.s:3352): the command word into io_Command at +28 and the request run to completion, waiting " +
    "first for anything still outstanding. The caller has already Doked io_Length (+36), io_Data (+40) and " +
    "io_Offset (+44) into the channel's slice of the `Dev IORequests` region, which is what makes `=Dev Base` " +
    "worth having. trackdisk CMD_READ, CMD_WRITE and CMD_UPDATE move bytes against the mounted ADF, the same " +
    "path SLN's S Disk Read takes; serial CMD_READ and CMD_WRITE reach the host port. DEVIATION: a command the " +
    "modelled device does not implement completes silently, where exec would set io_Error to IOERR_NOCMD and " +
    "Dev.Error would raise -- reproducing that means claiming to know each device's whole command set, which " +
    "reading four AMOS routines does not establish.",

  // ---- JD 5.3, slot 22 -----------------------------------------------------
  "jd read sector":
    "Routine 50 (+|jd.s:2947): OpenDevice on trackdisk, CMD_READ of 512 bytes at `sector * 512`, close, motor " +
    "off, and the sector as a 512-character string. Any failure answers the EMPTY string, because the error exit " +
    "hands back `trackerr`, which is `dc.l 0` -- a length word of zero and nothing else. DEFECT: the bounds check " +
    "is on the wrong register. `movem.l (a3)+,d0-d1` pops right to left, so d0 is the SECTOR and d1 the DEVICE, " +
    "and the routine then tests `cmp.l #1759,d1` and `cmp.l #0,d1` -- the device against the sector range. A " +
    "drive number is always 0 to 3, so the test never fires and the sector is never checked at all. Write Sector " +
    "was written from the same template and tests d0, which is right.",
  "jd diskchange":
    "Routine 42 (+|jd.s:2479): spins on `$bfe001 & 16`, the disk-change line, then waits out the filesystem's " +
    "Validate task by scanning ExecBase's TaskReady and TaskWait lists with FindName. DEVIATION: it returns " +
    "instead of waiting. There is no drive to swap a disk in and no Validator to outlive, so the alternative is " +
    "to block for ever -- the same decision Delta 1.4's Delta Change Disk and Misc 1.0's Disk Wait take.",

  "jd install":
    "Routine 105 (+|jd.s:4692): the fixed boot block at `bbd` copied into the shared `bb` buffer and handed to " +
    "Write Sector for sector 0, so it answers 0 for success and -1 for failure like that keyword. The table is " +
    "\"DOS\", this block's own checksum, the root block at 880, and a boot routine that opens dos.library. " +
    "DEFECT: `bb` is the SAME 512-byte buffer Read Sector fills, and Install writes only 54 of its 512 bytes " +
    "before writing all of it -- the routine copies fourteen longs starting at the `dc.w 512` that heads the " +
    "table, so two bytes go on AMOS's length word and the last two longs are truncated to one zero word. A " +
    "program that reads a sector first lays that sector's tail down as the tail of its boot block.",
  "jd format":
    "Routine 106 (+|jd.s:4715): all 160 tracks written with TD_FORMAT at `track * $1600`, out of a single " +
    "11-sector buffer that `nulltracks` zeroes once and that is NOT re-zeroed between tracks -- each special " +
    "track edits only the bytes it cares about, so tracks 2 to 79 are whatever track 1 left and 82 upwards " +
    "whatever track 81 left, zeros in both cases. Track 0 gets \"DOS\" and the root block pointer, track 80 the " +
    "root block and bitmap from the `roottrack` template with NAME$ at +432 as a BCPL string and a fresh " +
    "checksum. NOTE: the boot block it lays down has no boot CODE, only the header, so a formatted disk is not " +
    "bootable until Jd Install has been over it -- which is why the two keywords exist separately and why their " +
    "precomputed checksums differ. Jd Shortformat (routine 110) is the same loop bounded to tracks 80 and 81, so " +
    "it writes a fresh root block and bitmap and leaves the rest of the disk alone.",

  "jd rastport":
    "The three structure pointers AMOS keeps for the current screen: `T_Rastport(a5)`, and in 4.6 `T_ScreenAdr` " +
    "and `T_WindowAdr` (+jd-4.6/jd.s:3820, :3826), which 5.3 dropped. NOTE: nothing can dereference these. They " +
    "exist to be handed to Gfxcall or Intcall, which execute 68k against the real structures and are out of " +
    "scope by policy, so the value is only ever tested for being non-zero or passed straight back. What is " +
    "answered is a synthetic identifier per screen, on amiga/exec.ts's convention for library bases: high, " +
    "obviously not a real address, stable for a given screen and distinct between screens, so a program " +
    "comparing two of them gets the right answer.",

  // ---- JD Colour 2.0, slot 20 ----------------------------------------------
  "jd change colours":
    "Routine 39 (+|col.s:1283): every pixel in the rectangle that is COL1 becomes COL2 and every COL2 becomes " +
    "COL1 -- a swap, not a replace -- walked with ReadPixel and WritePixel. DEFECT: when a row ends, " +
    "`Dmove mousek,d0` reloads the X register from the saved Y1 rather than from X1, because `Dsave d1,mousek` " +
    "put y1 there. Only the FIRST row starts at x1; every row after it starts at column y1. Jd Fill Colour is " +
    "the same routine with one test instead of two and carries it too. A region anchored at the origin, where " +
    "x1 and y1 are both 0, hides it completely, which is presumably why it shipped.",
  "jd slide x":
    "Routines 41 to 46 (+|col.s:1380-1638): SOURCE copied onto DEST a column or a row at a time through " +
    "`L_sccopy`, AMOS's own Screen Copy at minterm $CC. Slide X walks a one-pixel column from the right edge " +
    "leftwards, laying each down at its final resting place, and the other five are the same loop over a " +
    "different axis and direction; when the last pass finishes DEST holds SOURCE. DEVIATION: the animation is " +
    "not paced, so what is written is the state the routine ends in -- the choice Jd Spread, Jd Tscroll and " +
    "Jd Squash already make. The early exit goes with it: the machine polls `L_getk` every pass and key 117 " +
    "stops the slide part way, leaving a partial image nothing here can produce.",
  "jd wait raster":
    "Routine 59 (+|col.s:1959): the line is made positive and folded into 0..256 by repeated subtraction, then " +
    "the routine spins on `$dff006`, the high byte of VHPOSR, until the beam's vertical position matches. " +
    "DEVIATION: there is no beam here. A given raster line comes round once per frame, so the wait is a frame -- " +
    "what AMOS's own Wait Vbl does. A program syncing to the display gets frame-rate sync rather than sub-frame; " +
    "the folding arithmetic is reproduced because a program can compute a line number from it.",
  "jd open con":
    "Routine 74 ($28e8): the window string is copied into the data zone at +$218 and `Open` is handed a pointer " +
    "to +$214, where the four literal bytes \"CON:\" already sit -- so the two are one filename and the caller " +
    "writes only the manual's \"x/y/w/h/titel\". MODE_OLDFILE ($3ed). APPROXIMATED: there is no Intuition to put " +
    "a window on, so a CON: window is AMOS's own console -- the substitution Fsel$ makes for a file requester. " +
    "The geometry and title are kept with the handle and nothing draws them, and the text shares the program's " +
    "screen instead of having a window of its own; a non-zero handle, text going out and a line coming back are " +
    "unchanged.",
  "jd input con":
    "Routine 77 ($2972): FGets of up to 256 bytes, then a scan stopping at the first NUL or linefeed for the " +
    "length, so the newline is not part of the answer. NOTE: a zero handle takes `beq.w $2a0e` straight to the " +
    "`rts` without setting d3 or d2, so the machine answers an uninitialised register pair -- a value of whatever " +
    "type the last keyword left behind, for which the empty string is the only safe reading. NOTE: the copy runs " +
    "one byte long for a ONE-character line, because `cmp.w #$1,d0 / beq` jumps into the loop with d0 still 1 and " +
    "`dbra` then runs twice; the length word still says 1, so a program cannot see the extra byte.",
  "jd rprint":
    "Routine 54 (+|col.s:1833) and nothing to do with a printer: `XYCuWi` reads the cursor row, `$4c(a0)` is the " +
    "screen width in pixels and `divu #8` turns it into columns, and `sub.w d1,d0` against the string length gives " +
    "the column to Locate to before Print. An empty string takes `beq leer` and prints nothing. NOTE: there is no " +
    "clamp -- `sub.w d1,d0 / ext.l d0` hands Locate a NEGATIVE column when the string is wider than the screen, " +
    "and a negative column means \"leave it where it is\", so an over-long string prints from wherever the cursor " +
    "already was rather than from the left margin. AMOS's own Centre clamps at zero; this does not.",
  "jd guru":
    "Routine 38 (+|col.s:1164): screen 11 at 640x32, one plane, mode $8000, two colours from `gpal` (`dc.w " +
    "0,$d00`), TEXT1$ centred on row 1 and TEXT2$ on row 2 through AMOS's own Centre with an empty one skipped " +
    "rather than printed blank, a border alternating between the two pens, and a poll of both mouse buttons " +
    "(`btst #6,$bfe001` and `btst #2,$dff016`) answering 1 for the left and 2 for the right. Screen 11 is deleted " +
    "and ScOn/ScOnAd restored on the way out. DEVIATION: the flash is not paced -- the machine alternates once " +
    "per 65,536-iteration poll and this advances once per frame, which is the port-wide timing deviation rather " +
    "than a JD one. The screen, the text, the block and which button ended it are the same.",
  "jd setoutput amiga":
    "Routines 49 and 50 (+|col.s:1656, :1664) guard the toggle at routine 51, so each is idempotent -- asking for " +
    "the convention already in force returns without doing anything. Routine 51 SetFunction-patches dos.library's " +
    "`Write` (offset -48) with a stub that tests the SECOND-TO-LAST byte of the buffer for a carriage return, " +
    "replaces it with a linefeed and shortens the length by one, turning AMOS's CR+LF line ends into AmigaDOS's " +
    "bare LF; Setoutput Amos restores the saved vector. The flag is `Runtime.amigaLineEnds`, because the patch is " +
    "on dos.library and reaches every write AMOS makes. DEVIATION: the patch cannot tell text from anything else, " +
    "so on the machine a binary `Put #` whose data ends in CR and one more byte is rewritten too. Here the switch " +
    "is applied where the line terminator is written, so only line ends change; reproducing the rest would need a " +
    "per-`Write` boundary a buffered channel does not have.",
  "jd request":
    "Routine 66 ($2748, 2.0 only) is `moveq #$4,d2 / Rbra routine 71`, and routine 71 ($2766) builds a chain of " +
    "five IntuiTexts by hand in a 1K buffer at $4f2(a5) -- topaz.font 8, left edge 15, ten pixels apart, laid out " +
    "by `d4 = d2*10+5` counting DOWN as the arguments pop right to left so they read top to bottom -- then calls " +
    "intuition.library's AutoRequest at `jsr -$15c(a6)`, width `60 + widest*8` and height `47 + top`. The manual: " +
    "\"Texte (1-5), Ja-Text und Nein-Text\", \"Bool-Requester\", \"-1/0 = ja/nein\". APPROXIMATED on the " +
    "modelled requester (runtime/requester.ts); the topaz font, the pixel geometry and the Workbench screen are " +
    "the chrome that is lost. NOTE: the defaults are conditional and easy to miss. The scanner at $2846 answers " +
    "a0 = -1 when it used a default and 0 when the argument was non-empty, and JA$ only gets its \"Retry\" " +
    "through `move.l a0,d0 / beq` -- so supplying a NEIN$ and leaving JA$ empty gives a gadget with NO text, " +
    "while leaving both empty gives Retry/Cancel. Empty body lines are dropped rather than drawn blank, and all " +
    "five empty takes `tst.w d6 / Rbeq routine 73`, the same error arm as a 1K buffer overflow.",
  "jd file\$":
    "Routine 60 ($26ca, 2.0 only) over the scanner at routine 62. DEFECT: with NO separator in the path it drops " +
    "the first character and reads one byte past the string. The scanner leaves d0 = 0 when it finds nothing, so " +
    "`sub.l d0,d2` makes the tail the whole string and the `addq.w #$1,a1` that exists to step over the separator " +
    "steps over character zero instead -- a1 having been left pointing at the start rather than at a separator -- " +
    "and the `dbra` then copies the full length from one byte further on. `Jd File$(\"readme\")` is \"eadme\" plus " +
    "whatever follows the string in the AMOS workspace. The dropped character is reproduced; the trailing byte is " +
    "not, because there is no workspace here to read past and inventing one would be worse than being a byte short.",

  // ---- BUtility 1.21, slot 12 ----------------------------------------------
  "bfilereq":
    "Routine 4 ($7f6), 96 bytes: rtFileRequestA with the default copied into the shared buffer at data+$16 first, " +
    "because reqtools edits that buffer in place, and a tag list at data+$398 asking for REQPOS_CENTERSCR and " +
    "RTFI_Flags = $10 = FREQF_PATGAD -- the pattern gadget `Bfilereqchg` exists to fill. APPROXIMATED for the " +
    "substitution, not for the plumbing: there is no reqtools.library here, so AMOS's own selector stands in, the " +
    "precedent `Lfreq` set for req.library. The answer is split the way reqtools splits it, NAME into the buffer " +
    "and DRAWER into the requester, which is what makes the doc's own `KAT$+PLIK$` reassembly work.",
  "baslfilereq":
    "Routine 5 ($856), 104 bytes: four tag values at data+$424/$42c/$434/$43c filled right to left, so they land " +
    "on ASL_File, ASL_Dir, the pattern tag (ASL_TagBase+10) and ASL_Hail in the doc's order, then AslRequest at " +
    "`jsr -$3c(a6)`. The window is asked for 100x220. APPROXIMATED for the same reason as Bfilereq, and it writes " +
    "the ASL requester's fields -- which the readers then share a buffer over, see Baslfile$.",
  "binforeq":
    "Routine 11 ($a02), 72 bytes: rtEZRequestA with the body in a1, the gadget string in a2 and a tag list at " +
    "data+$374 carrying RT_Underscore = '_' (so \"_Yes|_No\" marks shortcuts), RT_ReqPos = REQPOS_CENTERSCR and " +
    "RTEZ_ReqTitle. The answer is `move.l d0,d3` with no massaging, so the numbering is reqtools' own: leftmost " +
    "is 1 counting up, RIGHTMOST is 0, which is why a two-gadget requester reads as a boolean. NOTE: with ONE " +
    "gadget that rule makes it both first and last, so it answers 0; nothing in BUtility decides this and no " +
    "example in the doc reads a one-gadget result. APPROXIMATED: an Interface dialog stands in for the reqtools " +
    "requester, drawn in the grammar of the shipped Path:/Name: dialog. DEVIATION: the shortcut character is " +
    "stripped rather than underlined, and Return and Escape reach the first and last gadgets instead.",
  "bgetlongreq":
    "Routine 12 ($a4a), 88 bytes: the default into the long at data+$26e -- which is both what rtGetLong edits " +
    "and what `Bgetlong` reads -- then Max and Min to the tag values at data+$3d4 and $3cc (base+31 and base+30) " +
    "and the body to data+$3dc. Answers -1 for accepted, 0 for cancelled. Because the long is edited IN PLACE, a " +
    "cancel leaves the default sitting there and `Bgetlong` hands it back; nothing clears it. APPROXIMATED: a " +
    "`DI` digit zone in an Interface dialog stands in.",
  "bgetstrreq":
    "Routine 14 ($aae), 114 bytes. DEFECT: the order of operations. The default is copied into the buffer at " +
    "data+$274 by an UNBOUNDED byte loop and the body pointer is stored BEFORE `tst.l d0 / Rble` and " +
    "`cmp.l #$100,d0 / Rbge` check the length, so an out-of-range Max chars raises error 5 with the copy already " +
    "done and `Bgetstr$` answers the new default afterwards. The buffer runs data+$274..$373, 256 bytes, ending " +
    "exactly where the EZRequest tag list begins, so a default longer than that overwrites the tag list -- " +
    "modelled as far as a string can be (copy first, raise second), but nothing here can be scribbled on. The " +
    "legal range the two checks leave is 1..255, which is what the doc says. APPROXIMATED: an `ED` edit zone in " +
    "an Interface dialog stands in.",
  "baslfile\$":
    "Routine 9 ($978), 56 bytes. DEFECT: it copies the ASL requester's fr_File ($4) into data+$16 -- the SAME " +
    "buffer `Breqfile$` reads -- before answering it, so calling `Baslfile$` changes what `Breqfile$` says. " +
    "`Basldir$` and `Breqdir$` share data+$118 the same way. reqtools and asl are not separate namespaces in this " +
    "extension; whichever ran last wins, and nothing in the doc mentions it.",
  "bxpkpack":
    "Routine 2 ($746), 104 bytes: four tags at data+$444 then XpkPack at `jsr -$2a(a6)`, and `move.l d0,$26a(a0)` " +
    "stores the result whether or not it is zero so `Bxpkerror$` can be read straight after. The argument that " +
    "goes NULL when empty is the PASSWORD -- the `tst.w d0 / bne / suba.l a0,a0` guard is on the last one popped, " +
    "and the tag it fills is the one the unpack list also carries. NOTE: an empty METHOD leaves xpkmaster to pick " +
    "its configured default on the machine; here it is taken as NONE, which is the one method that cannot fail. " +
    "src/amiga/xpkmaster.ts registers seven -- NONE, RLEN, NUKE, CBR0, BLZW, HUFF and IMPL -- and a named method " +
    "outside that set fails with XPKERR_NOMETHOD, which is what a machine missing that sub-library does too.",

  // ---- LSerial 2.1, slot 11 ------------------------------------------------
  "lser open":
    "Routine 1 ($3bc), 800 bytes: two message ports and two IORequests, then OpenDevice. The eight arguments pop " +
    "right to left, so the name is read first and the baud rate last, and only io_SerFlags is written BEFORE the " +
    "open -- which the doc explains, \"it is always best to decide if access shall be shared or exclusive when " +
    "opening the device\". Errors 0, 1 and 2 in order: already open, empty name, OpenDevice failed. NOTE: the " +
    "doc's own \"BUF_SIZE - Internal buffer for device. MUST be >512 bytes\" is not checked anywhere.",
  "lser get":
    "Routine 9 ($938), 226 bytes. DEFECT: `cmp.l #$0,d3 / bhi` is UNSIGNED, so a count of zero is refused (error " +
    "4, \"Invalid read size!\") and a NEGATIVE one passes as a number near four billion. DEVIATION: on the " +
    "machine it blocks inside DoIO, which the doc warns of -- \"This can cause AMOS to hang if you haven't any " +
    "CARRIER\"; here it yields the frame and re-runs, so a program that never receives its characters waits for " +
    "ever, as it would, while everything else keeps running, as it would not.",
  "lser read":
    "Routine 4 ($79c), 260 bytes: SDCMD_QUERY then CMD_READ of everything waiting. NOTE: `cmp.l #$fa00,d4 / bcc` " +
    "raises error 3, \"Overflow in string buffer!\", above 64000 bytes -- a real ceiling rather than a " +
    "formality, since the doc's own warning is \"WARNING If there are VERY many characters to read AMOS may " +
    "crash\". Nothing waiting gives AMOS's shared empty string at $68a(a5).",
  "lser mul send":
    "Routine 7 ($8da), 54 bytes: the same CMD_WRITE as Lser Send through SendIO instead of DoIO, on the SECOND " +
    "request at +$74 so a read can happen while it is outstanding. DEVIATION: the host write here is " +
    "fire-and-forget by design, so Lser Mulcheck (routine 8, CheckIO) answers true on the next statement where a " +
    "real 300-baud line would still be going.",
  "lcarrier":
    "Routine 10 ($a1a), 46 bytes: SDCMD_QUERY then `btst #$5` on io_Status ($50). Bit 5 is Carrier Detect and is " +
    "ACTIVE LOW, so the routine answers -1 on `beq` -- carrier present is the bit CLEAR, which reads backwards " +
    "and is right. Lser Status (routine 16) hands back the same word unsigned; the idle state of a port with " +
    "nothing on it is every active-low line set, $f8.",
  "lser params":
    "Routine 15 ($2776), 60 bytes: six fields into the read request and one SDCMD_SETPARAMS. The pops give the " +
    "doc's order exactly -- FLAGS to io_SerFlags ($4f), EXTFlags to io_ExtFlags ($38), BRKtime to io_BrkTime " +
    "($40), BUF_SIZE to io_RBufLen ($34), STOP to io_StopBits ($4e), and RWlen to BOTH io_ReadLen and " +
    "io_WriteLen ($4c and $4d), which is why the doc calls it one parameter. Lser Baud (routine 12) is io_Baud " +
    "on both requests, and is the only keyword that touches the write one for anything but a write.",
  "linkey\$":
    "Routine 14 ($26d2), 164 bytes. `SyCall Inkey` hands back a longword -- ASCII in bits 0-7, the raw key code " +
    "in 8-15, the QUALIFIER byte in 24-31 -- and `asr.w #$8,d1` shifts the raw code down without disturbing the " +
    "qualifiers, which is what makes `btst #$1b` (bit 3 of the qualifier byte, raw key $63, CTRL) still work " +
    "afterwards. Cursor keys 28-31 become ESC[C, ESC[D, ESC[A and ESC[B. DEFECT: `cmp.b #$5a,d1 / bcc` skips the " +
    "lowercase fold for 'Z' itself as well as everything above it, so CTRL with a SHIFTED Z gives Chr$(250) " +
    "where every other shifted letter gives 1 to 25. NOTE: 'h' with CTRL is singled out and becomes $7f, DEL, " +
    "rather than backspace -- which is what a VT100 host expects.",
  "lxpr":
    "Routine 13 ($a9e), 7,220 bytes -- a whole XPR host in one keyword, which the doc explains: \"the inner " +
    "workings of the AMOS compiler which treats all functions as local, as it datas\", so splitting the " +
    "twenty-two callbacks would have " +
    "linked the XPR block into every program using any other Lserial command. APPROXIMATED. The dispatch on the " +
    "fourth argument is exact and reproduced -- 5 READ, 6 WRITE (checked first, as the doc says), 2 OPEN, 3 " +
    "CLOSE, 4 SETUP, 0 SEND, 1 RECEIVE, 7 CUSTOMIZE, anything else error 8 -- as are the NUL-termination checks " +
    "(error 5) and the empty-argument check (error 6). OPEN is OldOpenLibrary and answers the empty string " +
    "because no xpr*.library is modelled, which is what a machine without one does; CLOSE with nothing open " +
    "returns untouched; READ and WRITE fall through to the plain SDCMD_QUERY/CMD_READ and CMD_WRITE that Lser " +
    "Read and Lser Send run. What cannot happen is a TRANSFER: SEND, RECEIVE, SETUP and CUSTOMIZE all need a " +
    "library that opened, and none can.",
  // ---- Delta 1.4, slot 15 --------------------------------------------------
  // ---- JD Intuition 1.3, slot 18 -------------------------------------------
  "jd open intscreen":
    "Routine 5 ($892). NOTE: the MANUAL IS WRONG about the arguments. It says \"X, Y, Breite und Hoehe\"; the " +
    "routine writes `move.w #$0` into NewScreen.LeftEdge and TopEdge and puts the four arguments in Width, " +
    "Height, DEPTH and VIEWMODES. Type is $10f, CUSTOMSCREEN|SCREENQUIET. A program written from the manual " +
    "opens a screen of its intended size at depth W and view mode H.",
  "jd intcolour":
    "Routine 18 ($d44). NOTE: the manual gives ONE parameter, \"Farb-Nr.\", and calls it \"setzt Zeichenfarbe\" " +
    "-- the drawing colour, which is Jd Intpen. The routine pops TWO, splits the second by `divu #$100` then " +
    "`divu #$10` into a three-nibble $RGB, and calls SetRGB4 on $2c(screen), the ViewPort. It is a palette " +
    "write and it does nothing without a current Intuition screen: this is one of the two drawing keywords " +
    "that never calls routine 30, so the AMOS fallback does not apply.",
  "jd intscreen width":
    "Routine 39 ($1470). DEFECT: `move.w $a(a0),d3` is Screen->TopEdge, not Width -- Width is $c and Height " +
    "$e. The screen is opened with TopEdge 0, so this answers 0 for every screen the extension opens. The " +
    "layout is confirmed by the same binary: routine 18 takes the ViewPort at $2c and routine 30 the RastPort " +
    "at $54, which are 44 and 84, exactly where the standard struct puts them. Reproduced.",
  "jd intscreen height":
    "Routine 40 ($148e). DEFECT: `move.w $c(a0),d3` is Screen->Width, so this answers the WIDTH and the pair " +
    "is off by one field each. Reproduced.",
  "jd intfill":
    "Routine 26 ($115e): Flood (-330) in mode 1, the outline mode, which spreads over every connected pixel " +
    "that is NOT rp_AOlPen. NOTE: nothing in this extension sets AOlPen -- there is no keyword for it -- so " +
    "the boundary is always colour 0 whatever the program drew its outline in, and a region cleared to 0 " +
    "cannot be filled at all. DEFECT: the RastPort comes from $32 of the current window with NO null check, " +
    "where every other drawing keyword goes through routine 30's three-way fallback; with none open the " +
    "machine reads address $32. Reproduced as doing nothing. DEFECT: routine 31 allocates the TmpRas with " +
    "`AllocRaster(width,height)` and then declares it to InitTmpRas as a flat `#$a000`, 40,960 bytes, where a " +
    "640x256 window's raster is 20,480. DEFECT: routine 32 frees it by reading $8 and $a OFF THE RASTER " +
    "POINTER as the width and height -- two words of its own pixels. Neither memory defect is reproduced: " +
    "RastPort.flood keeps its visited set as a Set and allocates nothing.",
  "jd intevent":
    "Routine 10 ($b12) over routine 9 ($ace), which is Wait(1 << UserPort->mp_SigBit) then GetMsg then " +
    "ReplyMsg. It BLOCKS until a class it recognises arrives, and loops back to the Wait on one it does not " +
    "-- GADGETDOWN is in the IDCMP mask and is thrown away. The classes are the manual's: 0 disk removed, 1 " +
    "disk inserted, 2 menu (Code, unless it is MENUNULL), 3 gadget (GadgetID from $26 of IAddress), 4 key " +
    "(Code as a signed byte). Without a current window it does not wait at all and answers -1. APPROXIMATED: " +
    "a keystroke that has not been turned into a VANILLAKEY message is read straight off the key queue and " +
    "reported as class 4, because nothing here runs input.device's path into IDCMP.",
  "jd intlocate":
    "Routine 7 ($a60): `asl.l #$3` on each argument, then `+2` on the x and `+$10` on the y before Move " +
    "(-240). An 8x8 character cell with the origin two pixels in and sixteen down, which clears the window " +
    "border and title bar. Jd Intmove (routine 38) is the same call without the arithmetic.",
  "jd open intwindow":
    "Routine 3 ($662): a NewWindow at zone+$c8, IDCMPFlags $218160 and Flags $21000, then OpenWindow (-204). " +
    "NOTE: an EMPTY title is not merely a missing one -- routine 3 tests the length and, when it is zero, " +
    "nulls the pointer AND rewrites Flags to $21800, adding WFLG_BORDERLESS. On a current Intuition screen " +
    "Type becomes CUSTOMSCREEN and Flags gains $100, WFLG_BACKDROP. DEFECT: the OpenWindow result is never " +
    "checked, so the list node is allocated and linked with a null window in it; the keyword does answer 0, " +
    "which is what a program can test.",
  "jd intzone":
    "Routine 21 ($dfc): X2 and Y2 become a WIDTH and HEIGHT by subtraction, the five values go into a " +
    "48-byte Gadget template at zone+$70 whose GadgetID lands at zone+$96, and the template is CopyMemQuick'd " +
    "into a fresh AllocMem before AddGadget (-42) and RefreshGList (-432). NOTE: the number is the gadget's " +
    "id AND the count given to RefreshGList AND the `cmp.w #$1` that decides whether this one heads the list, " +
    "so the numbers are meant to run 1, 2, 3. Any other numbering still works, because AddGadget appends and " +
    "the id reaches the message either way. Nothing happens without a current window, which it does check.",
  "jd intcls":
    "TWO token ids and TWO routines, which is the author being careful rather than the usual arity accident: " +
    "id 496 is spec `I` and runs routine 27 ($1198), ClearScreen (-48); id 512 is spec `I0` and runs routine " +
    "37 ($1422), SetRast (-234). Neither is in the manual, which documents only \"Jd Intcls [C]\".",
  "delta about$":
    "1.6's routine 19 ($1fdc), 1.4's 19 ($406), the longest of the nine string functions and the one that runs " +
    "off the end of the buffer they share. DEFECT: in 1.4, `movea.w (buffer).L,a1` reads the WORD AT the " +
    "twenty-byte buffer and sign-extends it, where `lea` was wanted -- the buffer is zeros, so a1 is 0 and every " +
    "1.4 string is built at ADDRESS ZERO, over the 68000's exception vectors, and this one is 24 bytes, which " +
    "is vectors 0 to 5. It works anyway, because the pointer handed back is read the same wrong way and is 0 " +
    "too, so the caller finds the string exactly where it was put. The relocation table (38 HUNK_RELOC32 " +
    "entries) is what proves the operands really point at the buffer. 1.6 fixed that in passing, by moving the " +
    "whole library to `movea.l $1d8(a5),a1 / adda.w #offset,a1` so that it works from its slot base. DEFECT: " +
    "in 1.6, with a real buffer to write into, the shortfall shows -- the string is 22 characters, so with its " +
    "length word it is 24 bytes going into the 20 the author reserved, and the last four land on the first " +
    "longword of Delta Decrunch, whose `move.l (a3)+,d0 / tst.w d0` becomes the four characters the string ends " +
    "with, \"Fnz!\", and decodes as `not.w $7a21(a6)`. NOT REPRODUCED, either of them: there is no vector table " +
    "here to overwrite and no code memory for a string to land in, and the strings come back as they do on the " +
    "machine.",
  "delta decrunch":
    "Routine 3 ($280), 40 bytes. DEFECT: `move.l d0,$dff180` is a LONGWORD write to COLOR00, so the high word " +
    "lands in COLOR00 and the low word in COLOR01 -- the argument is a word, so colour 0 goes black and colour 1 " +
    "gets the value, the reverse of the guide's \"This efect using colour 0\". DEFECT: both range checks are WORD " +
    "tests on a longword, and `cmpi.w #$1000` is SIGNED, so a negative number passes both while 65536 is refused " +
    "as if it were 0. NOTE: no loop -- the guide calls it an effect and it is one write, which the copper would " +
    "undo on the next frame. NOTE: 1.4 AND 1.6 DISAGREE HERE, and this port answers for both, choosing by the " +
    "binding. 1.4 raises AMOS's numbered errors, `moveq #$17,d0 / Rjmp L_Error` for 23 and `#$1d` for 29; 1.6's " +
    "routine 3 ($1e78) sends the same two checks to the extension's own table instead -- `Rbeq 34` and `Rbge 35`, " +
    "which are `moveq #0,d0` and `moveq #1,d0` ahead of the shared L_ErrorExt dispatcher at routine 66 -- for " +
    "\"Variable is too small\" and \"Variable is too large\". A program identified by token table alone has no " +
    "binding to read, and answers as 1.4: the release this port was written from.",
  "delta hard reset":
    "Routine 29 ($229a), 1.6, three instructions: `movea.l $4.l,a6 / move.l #$0,$2a.l / jmp $fc0000.l`, and the " +
    "guide's entry for it is two words and two exclamation marks. DEFECT: `$2a` was meant to be `$2a(a6)` -- ExecBase+$2a is ColdCapture, the " +
    "vector the ROM jumps through on a reset, and clearing it before jumping to ROM is exactly why a6 is loaded " +
    "at all. As an absolute address it lands in the 68000's own vector table, on the low word of vector 10 and " +
    "the high word of vector 11, and ColdCapture survives. The relocation table settles it: 24 longwords are " +
    "relocated and neither $2a nor $fc0000 is among them. It also skips everything Delta Reset does -- no " +
    "SuperState, no Disable, no `reset` instruction, ExecBase left alone. Asked of the machine rather than " +
    "performed, as Delta Reset and AMCAF's Reset Computer are.",
  "delta blit off":
    "Routine 30 ($22b2), 1.6. It does NOT turn the blitter off: `btst.b #$e,$dff002 / bne` is DMACONR's BBUSY " +
    "and the loop WAITS for it, which is what the guide says -- \"Wait until blitter is off\" -- and not what " +
    "the name says. The `btst.b` on the even address reads the register's high byte, where a byte operand takes " +
    "the bit number mod 8, so bit 14 of the word is the one tested. A blit finishes inside the keyword that " +
    "starts it here, so BBUSY is never set when anything can look and the wait is satisfied on entry.",
  "delta crash":
    "Routine 31 ($22be), 1.6. `move.l d0,$dff108` and `move.l d0,$dff110` -- two longword writes over four word " +
    "registers, the same doubling Delta Decrunch gets on COLOR00: the high word reaches BPL1MOD and BPL1DAT, the " +
    "low word BPL2MOD and BPL2DAT. Corrupting both bitplane modulos is what shears the display. DEVIATION: " +
    "neither register is modelled -- the modulos here come from the screen's own width and nothing reads $dff110 " +
    "at all -- so the argument is evaluated and the effect is not shown, the same treatment Delta No Synchro gets.",
  "delta beep all":
    "Routine 33 ($2300), 1.6: saves a3-a6 and calls routine 32 ($22ce), which opens intuition.library and calls " +
    "DisplayBeep (-96) with a NULL screen -- beep EVERY screen, which is the name. DEFECT: routine 32 never " +
    "checks what OpenLibrary returned, going straight to `movea.l d0,a6`, and never closes the library, so all " +
    "six keywords that use it leak a reference each call; the base is kept at $1b02 and overwritten. Routine 42 " +
    "exists to say \"Cannot open reqtools.library\" and has no caller anywhere in the file. DEVIATION: no display " +
    "beep is modelled -- AMOS's own screens are the display here and there is no Workbench flash behind them.",
  "delta change bank":
    "Routine 36 ($231a), 1.6. `Delta Change Bank Start(OLDBANK) To NEWBANK` renumbers a bank by poking its " +
    "header: AMOS keeps the number in the longword sixteen bytes before the data Start() answers, and this " +
    "writes a new one over it (`suba.l #$10,a0 / move.l d1,(a0)`). DEFECT: all three checks are WORD tests on a " +
    "LONGWORD argument and the write is a longword, so $10001 has a low word of 1, passes every check and is " +
    "stored whole -- the bank ends up numbered 65537, outside AMOS's own 1..65535. The upper bound is 4095 and " +
    "signed, which is why a second `tst.w / Rbmi` is needed for negatives. DEFECT: nothing checks the address IS " +
    "a bank -- routine 37 exists to say \"Bank is not defined\" and has no caller. DEVIATION: there are no bank " +
    "headers in this address space, a bank's Start() being a synthetic base, so a matching bank is renumbered " +
    "directly and any other address falls through to the write, which lands where Loke would. NOTE: the guide " +
    "says \"NEWBANK can't be number of existing bank\" and nothing enforces it; on the machine two headers then " +
    "claim one number and the first found wins, where the map here cannot hold both.",
  "delta intuition message":
    "Routine 39 ($234c), 1.6, \"some yellow message\": DisplayAlert (-90) through routine 40 ($2362), where the " +
    "WIDTH the guide names reaches d1 and d1 is DisplayAlert's HEIGHT. DEFECT: the string is stored RAW -- " +
    "`move.l (a3)+,$1b06.l`, loaded straight into a0 -- so a0 points at the AMOS string's LENGTH WORD, where " +
    "routines 41, 53 and 55 all step over the length and write a NUL first. DisplayAlert's format is a word of " +
    "x, a byte of y, the text, a NUL and a continuation byte, so the length is read as x and the first character " +
    "as y. That is what the guide's `Chr$(POS)+TXT$` is for: POS is the y the author could control and x is " +
    "however long the string happens to be. No NUL either, so the text runs on until some zero byte turns up in " +
    "AMOS's string area. DEVIATION: no alert is modelled -- DisplayAlert draws on the bare hardware above every " +
    "screen, which this port has no surface for, and routine 38's \"Cannot create intuition alert\" has no caller.",
  "delta wb to front":
    "Routine 44 ($23fa), 1.6: opens intuition.library and calls WBenchToFront (-342). Delta Wb To Back is " +
    "routine 45 ($242e), WBenchToBack (-336). Both keep the base at $1b02 and never close it. The names are " +
    "Delta's own, so they do not contest CRAFT's Wb To Front and Wb To Back -- the same two calls, already here.",
  "delta wb to back": "Routine 45 ($242e), 1.6, WBenchToBack (-336). See delta wb to front.",
  "delta lock pub screens":
    "Routine 46 ($2462), 1.6: LockPubScreenList (-522), guarded by `cmpi.b #$0,$1e62`. Delta Unlock Pub Screens " +
    "is routine 47 ($24ac), UnlockPubScreenList (-528), guarded by `cmpi.b #$1,$1e62`. NOTE: the failure arms " +
    "are not symmetric and routine 49 is the interesting one -- locking twice does not simply complain, it opens " +
    "intuition, calls UnlockPubScreenList, clears the flag and THEN raises \"Public screen already locked\", so " +
    "the error leaves the list unlocked and a program that traps it is back where it started. Routine 48 just " +
    "clears the flag and raises \"already unlocked\". DEVIATION: no public screen list is modelled -- this port " +
    "has AMOS's own screens and no Intuition screen list behind them -- so the flag is kept and the two calls " +
    "are not made. The flag, and which error it produces, is the whole of what a program can see.",
  "delta unlock pub screens": "Routine 47 ($24ac), 1.6, UnlockPubScreenList (-528). See delta lock pub screens.",
  "delta find task":
    "Routine 50 ($2548), 1.6: FindTask (-294), the address straight into d3, and the guide says \"if ADDRESS=0 " +
    "then task not found\". DEFECT: the name is NOT NUL-terminated -- the routine steps over the length word and " +
    "hands FindTask the characters as they lie, where routines 41, 53 and 55 all write a terminator first, so " +
    "the comparison runs on into whatever follows in AMOS's string area. DEVIATION: src/amiga/exec.ts models " +
    "exec with a single task on purpose, so there is no list to search and every name answers 0 -- which is the " +
    "answer the guide tells a program to test for.",
  "delta kill task":
    "Routine 51 ($2568), 1.6: FindTask (-294) then RemTask (-288). DEFECT: the name is not NUL-terminated, as " +
    "Delta Find Task's is not. DEFECT: `tst.w d0` tests the low WORD of a task pointer, so a task at an address " +
    "whose low sixteen bits are zero reports \"Task not found\". DEVIATION: one task here and no address for it, " +
    "so this always raises \"Task not found\" (message 7, routine 52). The guide's own warning is that the name " +
    "\"cannot be ' AMOS', this is AMOS task name and if you will kill AMOS task then AMOS will crash\".",
  "delta reqtools requester":
    "Routine 53 ($2598), 1.6. Both strings are NUL-terminated in place and stored -- GADGET$ at $1b06 and " +
    "TITLE$ at $1c06, that order, because arguments pop right to left. Routine 54 ($25ce) opens " +
    "reqtools.library and calls -66 with a1 = TITLE$, a2 = GADGET$ and a3, a4, a0 zero, which is " +
    "`rtEZRequestA(bodyfmt,gadfmt,reqinfo,argarray,taglist)(A1/A2/A3/A4,A0)` to the register. APPROXIMATED: an " +
    "Interface dialog stands in for the reqtools requester, as it does for BUtility's Binforeq. The numbering is " +
    "reqtools' own and comes back unchanged -- gadget 1 is the leftmost and the RIGHTMOST answers 0, so the " +
    "guide's \"Yes|No\" gives 1 for Yes. DEFECT: routine 54 does not check that the library opened, which is why " +
    "every example in the guide is wrapped in `If Exist(\"LIBS:reqtools.library\")` and says \"Else you will " +
    "have GURU.\"",
  "delta reqtools get number":
    "Routine 55 ($2616), 1.6. DEF_NUMBER pops first into the long at $1d06 and TITLE$ is NUL-terminated at " +
    "$1b06; then reqtools.library and -78 with a1 = &$1d06, a2 = TITLE$, a3 and a0 zero -- " +
    "`rtGetLongA(longptr,title,reqinfo,taglist)(A1/A2/A3,A0)`. The answer is read back out of $1d06, so a " +
    "cancelled requester returns the default it was given. NOTE: `move.l #$64,d0` sits between the two and " +
    "rtGetLongA takes nothing in d0 -- it is rtGetStringA, one entry earlier at -72, that wants a maxchars " +
    "there. Copied from the wrong prototype and harmless. APPROXIMATED: an Interface dialog again, and no bounds " +
    "are passed so the min and max are the widest the dialog will take.",
  "delta reqtools palette":
    "Routine 41 ($239e), 1.6: NUL-terminates the title in place, stores the pointer at $1b06 and calls routine " +
    "43 ($23c8), which opens reqtools.library and calls -102 with the title in a2, reqinfo in a3 and the taglist " +
    "in a0. That is rtPaletteRequestA exactly -- `rtPaletteRequestA(title,reqinfo,taglist)(A2/A3,A0)`, " +
    "thirteenth in the FD and so at bias 30 plus twelve sixes. The FD is reqtools_lib.fd, which ships in GUI " +
    "2.10's own Tools/FD directory in the corpus; the two private password entries and rtFontRequestA are what " +
    "put the palette requester at -102 rather than the -84 a shorter list would give. APPROXIMATED: this port " +
    "has no palette requester, so the keyword is reached, the library is not opened and the palette is left " +
    "alone -- the cancel path of the requester the author called.",
  "delta req palette":
    "Routine 56 ($2678), 1.6, and the odd one out: req.library rather than reqtools, opened from the third name " +
    "at $1d4f, with the colour in d0 and a call to -90. NOTE: no FD for req.library is in the corpus, so -90 is " +
    "recorded as an offset and not named. The guide's example is `Print Delta Req Palette 2`, which cannot parse " +
    "-- the token spec is `I0`, an instruction taking one integer, and there is no value to print. " +
    "APPROXIMATED: as Delta Reqtools Palette, and for the same reason.",
  moveb:
    "Routine 58 ($26ac), 1.6, one of the four the guide's contents marks \"- PRIVATE -\": \"Thats are my " +
    "private commands, but if you want you can use these commands.\" `movea.l (a3)+,a0 / move.l (a3)+,d0 / " +
    "move.b d0,(a0)`. The address pops first, so it is the LAST argument: these read `Moveb DATA,ADDRESS` where " +
    "AMOS's own three read `Poke ADDRESS,DATA`. The guide spells it that way round too and describes them as " +
    "\"like Poke\", \"like Doke\" and \"like Loke\", which is all three exactly.",
  movew: "Routine 59 ($26b4), 1.6 -- Doke with the arguments the other way round. See moveb.",
  movel: "Routine 60 ($26bc), 1.6 -- Loke with the arguments the other way round. See moveb.",
  "delta inter on":
    "Routine 6 ($2da), ten bytes. DEFECT: `move.w #$0,$dff09a` -- INTENA's bit 15 chooses set or clear, and with " +
    "it clear the write clears the bits present in $0000, which is none. The keyword does nothing whatever; it " +
    "needed $c000. Delta Inter Off (routine 11) is $4000 and really does take INTEN down, so interrupts can be " +
    "turned off and not back on. DEVIATION: Inter Off is not reproduced -- interrupts off stops the vertical " +
    "blank and AMOS with it, and reproducing that faithfully means hanging.",
  "delta pal":
    "Routine 7 ($2e4), ten bytes: `move.b #$20,$dff1dc`. NOTE: that is BEAMCON0's HIGH half, and PAL is bit 5 in " +
    "the low one -- the bit only arrives because the 68000 duplicates a byte across both halves of the data bus " +
    "during a byte write, so the register latches $2020, PAL plus VARBEAMEN. Personnal's Set Pal writes the same " +
    "register as a word and gets $0020. DEVIATION: nothing reads beamcon0 in this port, as Personnal's two " +
    "already record.",
  "delta drive motor on":
    "Routine 15 ($3ce), 26 bytes, and Misc 1.0's `Dled On` instruction for instruction -- $7f then $77 to CIA-B " +
    "port B, then the DIRECTION register at $bfd300. DEFECT: the pair is the wrong way round. On writes 0, making " +
    "the port INPUTS so it stops driving the active-low /MTR and the motor stops; Off writes $ff, driving the $77 " +
    "still in the data register and keeping it running. Misc ships the source that proves it; see miscext.ts.",
  "delta change disk":
    "Routine 13 ($348), 120 bytes, and Misc 1.0's `Disk Wait` instruction for instruction: wait for CIA-A port A " +
    "bit 4 (the disk-change line) to fall, a 500-iteration delay, then Disable/FindName over ExecBase's TaskReady " +
    "($196) and TaskWait ($1a4) lists for a task named \"Validator\" until it has gone. DEVIATION: returns at " +
    "once. There is no floppy to insert -- volumes here are mounted -- and one task, so no validator to outlive.",
  "delta wait double mouse":
    "Routine 5 ($2b2), 40 bytes. DEFECT: press, delay, press, with no wait for a RELEASE between them -- so a " +
    "button still held when the delay runs out satisfies the second wait and one click counts as a double. NOTE: " +
    "`subi.w #$1,d0` decrements the LOW WORD of a longword argument, so a delay of 0 burns 65,536 turns rather " +
    "than none. DEVIATION: the delay is a busy loop of about 26 bus cycles a turn and this waits in FRAMES, " +
    "because a frame is the finest grain at which the button can change here.",
  "delta reset":
    "Routine 10 ($306), 30 bytes: SuperState, Disable, `clr.l $4.w`, `lea $fc0000.l,a0`, RESET, `jmp (a0)`. Misc " +
    "1.0's Reset instruction for instruction, and the ExecBase wipe makes it a COLD one. Asks the machine and " +
    "ends the program, as AMCAF's Reset Computer does; ../amiga/machine.ts carries the reading for both.",
  "delta pi#":
    "1.6's routine 17 ($1fc8), 1.4's 17 ($3f2), ten bytes: `move.l #$c90fdb42,d3` with `moveq #$1,d2` for the float " +
    "type. NOTE: Motorola Fast Floating Point has a 24-bit mantissa, so it is 3.1415925 and not 3.14159265, and " +
    "no program can get more out of it than seven digits. Delta E# " +
    "(routine 18) is the same ten bytes with the halves swapped and $adf85442 in them, 2.7182813.",
  "delta brithday":
    "1.6's routine 16 ($1fbe), 1.4's 16 ($3e8), ten bytes: `moveq #$0,d2 / move.l #$15f70ad,d3`. The type byte says " +
    "INTEGER, so it is 22999213, and the guide says only \"Return my birthday\" -- it is not a date in any " +
    "obvious layout, so the number is reported as it stands. The spelling is the author's.",
  "delta yard$":
    "Routines 19 to 27, the nine string constants, all one shape: `move.w #len,(a1)+` then that many `move.b " +
    "#char,(a1)+` into a buffer, d2 set to 2 for the string type, and the buffer's address back in d3. NOTE: the " +
    "characters are immediates, so these values are read and not inferred: 0.9144 metres to a yard, 0.3048 to " +
    "a foot, 0.0254 to an inch, 1852 to an international nautical mile, 1853.25 to a US one, and 0.57722 for " +
    "Euler's gamma. NOTE: the author reserved two ten-byte buffers side by side, loads the second one twice at " +
    "the top of every routine and never uses it, and builds into the first -- see Delta About$ for what twenty " +
    "bytes are not enough for.",
  "delta radian$":
    "1.6's routine 25 ($21ac), 1.4's 25 ($5b2), 70 bytes. NOTE: the string ends in $b0, the degree sign, and Delta " +
    "Degree$ (routine 26) ends in \"rd\" -- so the guide's own `Radian#=Val(Delta Radian$)` depends on Val " +
    "stopping at the first character that is not part of a number. Both values are right, 57.29578 degrees to a " +
    "radian and 0.01745 radians to a degree. The two defects in the shape these share are under Delta About$.",
  // ---- AMOSPro Tools 1.01, slot 23 -----------------------------------------
  "array dim":
    "Routine 16 ($3e6), 70 bytes: `(SX+1)*(SY+1)+4` bytes reserved as a WORK bank named \"Array   \", with `SX+1` " +
    "written into the four -- the stride every later access multiplies by. NOTE: it also records both dimensions " +
    "at data zone +$10 and +$14 and no routine ever reads either. NOTE: the failure arm is `moveq #$18,d0`, AMOS " +
    "error 24 \"Out of memory\" -- not a complaint about the bank. Bnk_Reserve frees an existing bank of that " +
    "number and takes a new one, which is what the guide says happens; this port's Reserve replaces too and has " +
    "no allocation that can fail, so the arm is unreachable.",
  "array set":
    "Routine 17 ($42c), 44 bytes. DEFECT: `mulu.w d3,d0` multiplies X by the stride, and the stride is `SX+1`, " +
    "so the element at (X,Y) is at `X*(SX+1)+Y` and the array is really indexed [0..SY][0..SX] -- the dimensions " +
    "are the other way round from the guide's own `Dim _ARRAY(SX,SY)` and from AMOS's. It stays inside the " +
    "allocation only while SX <= SY. There is no bound check at all, and `(a0,d0.w)` is a WORD displacement, so " +
    "an index of 32768 or more writes BEFORE the bank. Array Get (routine 18) repeats every line of it.",
  "get long":
    "Routine 12 ($38a), 26 bytes. NOTE: unlike Get Byte and Get Word it has no `moveq #$0,d3` to clear the " +
    "register first, and does not need one -- four `move.b` and three shifts fill all thirty-two bits, so the " +
    "stale content is shifted out before the result is complete. It looks like a bug and is not.",
  "set crypt":
    "Routine 35 ($652), 36 bytes: `eori.b #$ff` per character, with the LENGTH WORD copied in clear. So a scan " +
    "still shows how long every string is and where the next one starts. The guide's \"the algorithm used for " +
    "encryption isn't very secure\" is well judged; it is one instruction.",
  "encode":
    "Routine 42 ($732), 78 bytes, and a real stream cipher rather than Set Crypt's NOT: a password byte, a " +
    "15-bit LCG seeded from the sum of the password's bytes (`mulu.w #$24a1 / addi.w #$24df / andi.l #$7fff`), " +
    "and a running total of that LCG that never resets, so the keystream depends on the byte's POSITION too. " +
    "Decode (routine 44) is the same loop subtracting, and is exact. NOTE: the running total starts at 65535, " +
    "not -1, because `subq.w` on a longword leaves the high word clear -- only the low byte reaches memory, so " +
    "the cipher is unaffected, but a reimplementation using -1 would produce different bytes. NOTE: `dbra` counts " +
    "a WORD, so a length of 0 encodes 65,536 bytes.",
  "range":
    "Routine 20 ($484), 26 bytes, and slot-qualified because Range 2.6/2.9Plus claims the name too. NOTE: the " +
    "MAX arm both clamps and RETURNS (`move.l d5,d3 / bra` lands on the rts), so the MIN check is skipped when " +
    "it fires -- with MIN above MAX everything above MAX answers MAX and everything else answers MIN.",
  "checksum":
    "Routine 46 ($7ce), 56 bytes: longwords while four bytes remain and then bytes, into a 32-bit total that " +
    "wraps. NOTE: it sorts its two bounds first, which is the one defensive line in the extension.",
  "oui init":
    "Routine 40 ($6fe), 52 bytes, and the keyword that explains the undocumented half. `(N+1)` records of " +
    "THIRTY-TWO bytes, with the bank's first two bytes -- which are also record zero's -- set to a COUNT of 1 " +
    "and a MAXIMUM of N. A record is fourteen words (Oui Edata's fields 0..13), the word at +$1a that Oui New " +
    "sets to 1, and a pointer to an AMOS string at +$1c.",
  "oui new":
    "Routine 39 ($6bc), 66 bytes: six words written BACKWARDS from record+12 by `move.w d1,-(a0)`, which lands " +
    "the FIRST argument at offset 0 because the pops run right to left, then the word at +$1a set to 1. NOTE: it " +
    "never increments the count, so successive calls all write element 1 unless the program moves the counter " +
    "itself -- `Oui Set Data 0,n` is exactly that byte, so the count reads as a cursor the caller drives. The " +
    "over-count arm raises the extension's only error and the compare is `bhi` on a byte, so element N itself " +
    "is allowed.",
  "oui reserve text":
    "Routine 31 ($57c), 70 bytes: an AMOS string of `(LENGTH & ~1) + 2` bytes from `L_Demande`, with its ADDRESS " +
    "stored in the element's +$1c. DEVIATION: L_Demande hands out AMOS's TEMPORARY string workspace, which the " +
    "next string expression reclaims, so on the machine an element's text survives only until then; strings have " +
    "no addresses in this port, so the buffer comes from a pool of its own and the pointer is stable. The one " +
    "place this port is kinder than the library. NOTE: the reserved size is two short whenever LENGTH is odd, " +
    "and nothing checks it.",
  // ---- Make Lib 1.30, slot 17 ----------------------------------------------
  "ma allocmem":
    "Routine 4 ($3a6), 22 bytes: exec AllocMem with nothing around it, the two arguments popped straight into d1 " +
    "and d0. The doc's requirement bits are exec's own, and Mem Public/Chip/Fast/Clear are those four constants " +
    "spelled as keywords.",
  "ma freemem":
    "Routine 5 ($3bc), 22 bytes. NOTE: the caller supplies the size and exec needs it; the pool here takes the " +
    "length from its own bookkeeping instead, so a caller that hands back the right block with the WRONG size is " +
    "forgiven here and would corrupt the memory list on the machine.",
  "ma allocvec":
    "Routine 11 ($42a), 38 bytes: `addq.l #$4,d0 / move.l d0,d2 / AllocMem / move.l d2,(a0)+`. NOTE: the size " +
    "stored in front of the block is the TOTAL, so a program that reads it back sees four more than it asked for.",
  "ma malloc":
    "Routine 13 ($466), 58 bytes: twelve bytes more than asked for -- an eight-byte MinNode so the block can go " +
    "on the library's own list, and the total size at +8. The header is written AFTER the allocation, so Mem Clear " +
    "clears it and the size still lands.",
  "ma free all":
    "Routine 15 ($4c4), 40 bytes: RemHead on the malloc list until it answers 0, freeing each node with the size " +
    "at +8. The same loop the extension's REMOVE vector at $30e runs when AMOS unloads the library, which is what " +
    "the doc means by memory being freed automatically on exit.",
  "ma realloc":
    "Routine 35 ($854), 130 bytes, and the one routine here that does everything its documentation claims: " +
    "TypeOfMem on the old block plus MEMF_CLEAR is both \"if old memory was CHIP memory --> new memory will be " +
    "CHIP too\" and \"additional bytes will be cleared\", and the old block is freed on BOTH paths because the " +
    "failure arm falls into the same FreeMem. DEFECT: the null arm at $862 branches to the exit without writing " +
    "d3, so `Ma Realloc(0,n)` returns whatever the previous function left in the return register. Answered as 0 " +
    "here, the only stable choice.",
  "ma remove":
    "Routine 8 ($3f4), 16 bytes: exec Remove takes the node alone and never sees the list, which is why the doc's " +
    "parameter list has one entry. A node that was never on a list unlinks whatever its two pointers name.",
  "ma next":
    "Routine 16 ($4ec), 16 bytes: `movea.l (a0),a0 / tst.l (a0) / beq` -- the successor unless ITS successor is " +
    "zero, which is only true of the header's lh_Tail. exec's idiom for walking to the end without the list in " +
    "hand, and Ma Prev (routine 17) is its mirror.",
  "ma first":
    "Routine 18 ($510), 16 bytes: `cmpa.l $8(a0),a0 / beq` -- an empty MinList has tailpred == &head, which is " +
    "exec's emptiness test. Ma Last (routine 19) is the same test and reads the tailpred instead.",
  "ma fopen":
    "Routine 30 ($6fc), 190 bytes. DEFECT: the doc lists three modes and the routine tests TWO -- `cmpi.b #$57` " +
    "for 'W' and `cmpi.b #$52` for 'R', with every other character taking the append arm, including the byte " +
    "after the length word of an empty string. The character is uppercased by `bclr #$5` first. The value handed " +
    "back is the dos.library handle, not the twelve-byte node it also allocates and lists.",
  "ma fclose":
    "Routine 31 ($7ba), 64 bytes: it walks the file list for the node whose +8 holds this handle. NOTE: a handle " +
    "not on the list -- already closed, or never opened -- falls off the end of the walk and closes nothing.",
  "ma fread":
    "Routine 33 ($818), 30 bytes. DEFECT: the null-handle arm at $820 branches PAST `move.l d0,d3`, so d3 is " +
    "still the length popped into it and the call reports having read exactly as many bytes as were asked for. " +
    "Ma Fwrite (routine 32) has the same defect with the same register, and Ma Fseek (routine 34) returns its " +
    "MODE for the same reason.",
  "ma fseek":
    "Routine 34 ($836), 30 bytes: dos.library Seek argument for argument, and the old position comes back -- " +
    "which is why the doc's two-seeks-to-the-end trick gives the length. DEFECT: a null handle answers the MODE, " +
    "the last argument popped. See Ma Fread.",
  "ma filelen":
    "Routine 20 ($532), 88 bytes: Lock, Examine into the extension's own 1,024-byte scratch buffer, UnLock, and " +
    "fib_Size at +124. NOTE: the lock mode is `moveq #$0,d2`, which is neither SHARED_LOCK (-2) nor " +
    "EXCLUSIVE_LOCK (-1); a filesystem takes anything not exclusive as shared. NOTE: Examine's result is " +
    "discarded, and a DIRECTORY examines fine with fib_Size zero, so a directory answers 0 rather than the -1 the " +
    "doc promises for a name that is not a file.",
  "ma paste icon":
    "Routine 23 ($59c), 162 bytes: a raw blitter copy, minterm $f0 with both masks $ffffffff, from the icon bank " +
    "onto the screen. DEFECT: `move.w $50(a2),d4` is the SCREEN's plane count and the icon's own, at +4 of the " +
    "record it has just read, is never looked at -- an icon with fewer planes takes its missing ones from " +
    "whatever follows it in the bank, which is the next record's header. NOTE: `lsr.l #$4,d2` rounds x down to a " +
    "16-pixel boundary, as the doc says, and nothing clips: a negative coordinate becomes an enormous unsigned " +
    "offset. Not reproduced -- the write lands outside the plane buffer and is dropped.",
  "ma point":
    "Routine 24 ($63e), 80 bytes. DEFECT: the doc's \"ma Point works exactly as AMOSPro's Point function\" is " +
    "wrong twice -- it reads the whole bitmap where AMOS's respects the clip window, and it walks EcCurrent " +
    "($30(a2)) where AMOS's walks EcLogic, so on a double-buffered screen the two answer about different " +
    "bitmaps. Both bounds are UNSIGNED word compares, which is the only clipping it has: a negative coordinate " +
    "is a large one and answers -1. Ma Plot (routine 25) shares all of it and returns silently instead.",
  "paste brik":
    "Routine 24 ($1048), 170 bytes. DEFECT: x and y are taken UNSIGNED.",
  "map scan x":
    "Routine 8 (\\$840), 162 bytes, and Map Scan Y is routine 9 (\\$8e2), TEN bytes -- `Rbsr routine 8` then " +
    "`move.l \\$44(a0),d3`, so asking for the y runs the whole search again and reads the other half of the answer " +
    "out of the same scratch pair at \\$40/\\$44. DEFECT: the map's own bounds do not work.",
  "map plot":
    "Routine 20 (\\$f20), 120 bytes, and the argument order is the surprise: the pops are d5, d4, d6, and d5 is " +
    "tested against \\$18 (the map height) and d4 against \\$16, so the FIRST argument is the tile -- `Map Plot " +
    "t,x,y` and not `Map Plot x,y,t`. DEVIATION: only the far edges are checked, `cmp.w \\$18(a0),d5 / Rbge` and " +
    "the same for x, with nothing testing for a negative one; a negative y then goes through an unsigned `mulu.w` " +
    "and the write lands before the map bank. Not reproduced, as in Map Brik. NOTE: the bank is resolved through " +
    "routine 66 BEFORE the capacity at \\$7a is tested, so a program that records without calling Map Anim Bank " +
    "first gets Start()'s \"bank not reserved\" if the shipped default bank 9 does not exist, and silence if it " +
    "does",
  "map brik":
    "Routine 23 ($fbc), 140 bytes, the map-editing counterpart of Paste Brik: the brik's cells are stamped into " +
    "the MAP at (x,y) instead of drawn. DEVIATION: only the FAR edges are checked. Not reproduced: there is no " +
    "memory before a bank here to scribble on, and the cells that would land outside are skipped",
  "map base":
    "Routine 28 ($1158), ten bytes: `movea.l $158(a5),a0 / move.l a0,d3`. NOTE: the block is an object here, not " +
    "bytes at an address, so there is no pointer to give that would mean anything. APPROXIMATED in the value only " +
    "-- the routine itself is fully read, and it does nothing else.",
  "map anim":
    "Routine 44 (\\$163e), 146 bytes, and the only keyword in TOME that takes a string. DEFECT: `neg.w` on a LONG " +
    "register leaves the high word alone, so a negative number reaches `cmp.l \\$76(a0),d3` still looking negative " +
    "and passes the capacity test whatever the capacity is; only the positive arm is bounded. DEFECT: the frame " +
    "count stored at \\$a is the string's own length but the copy loop stops at 44 (`cmp.l #\\$2c,d1 / bge`), so a " +
    "longer string leaves \\$a claiming frames that were never copied and the stepper reads them out of the next " +
    "record. NOTE: \\$e is built with `mulu.w \\$16(a0),d5`, and \\$16 is a CACHE that only the drawing routines and " +
    "Map Scan write; before any of those has run it still holds the shipped 200, so Map Anim called first " +
    "computes an offset for a 200-wide map whatever the bank says.",
  "map handle":
    "Routine 47 (\\$1824), 662 bytes, a fifth of the library and the reason the four edge draws exist. DEVIATION: " +
    "the blit's size arguments start as the view's FAR corner rather than a width, and \\$19c8-\\$1a50 clip and " +
    "clamp them against AMOS's screen structure at \\$4c/\\$4e before the call; our bltBitMap clips against the " +
    "bitmap itself, so that arithmetic is the back-end's rather than transcribed. NOTE: `Rjsr` at \\$1990 is " +
    "printed as `L_GetEc` by extdis and is not that -- it takes a screen NUMBER in d1 and returns that screen's " +
    "plane table in d0 with its structure in a0. NOTE: the block ships \\$7e+\\$4 as ZERO, not -1, so without a Map " +
    "Handle Init first the very first call compares against (0,0) and scrolls rather than redrawing",
  "map fall":
    "Routine 50 (\\$1ae2), 458 bytes: Boulder Dash in one keyword. DEFECT: after a tile falls, `movem.l " +
    "(a7)+,d5-d6` restores the FALLING tile's type and \\$1b38 copies it into the landing type, though that cell " +
    "now holds the argument -- so the scan believes the vacated cell is still solid and the tile above it will " +
    "not fall in the same call. DEFECT: a sideways roll reaches the recorder with d0 still the column loop " +
    "variable, so the update record names the cell the tile came FROM; the vacated cell is recorded twice and the " +
    "arrival never, and under Map Update a rolling tile leaves a trail. NOTE: the recorder at \\$1bb2 never tests " +
    "\\$68, so Map Fall appends to the update list and arms it whether or not Map Update On was ever called, where " +
    "routine 45 and Map Swap Tile both check first",
  "map an move":
    "Routine 56 (\\$1e52), 40 bytes: two word stores into \\$0 and \\$2 of the animation record, and nothing else. " +
    "DEFECT: the map offset at \\$e is NOT recomputed.",
  "map an point":
    "Routine 54 (\\$1dde), 36 bytes: the animation's current frame index, straight out of \\$c. DEVIATION: out of " +
    "range it sets neither d3 nor d2 -- it returns with the result registers holding whatever the last extension " +
    "function left there, so the answer is the previous call's value WITH the previous call's type, and a string " +
    "function ahead of it would make `=Map An Point(999)` evaluate to a string.",
  "reserve pbobs":
    "Routine 6 (\\$10e2), 100 bytes. NOTE: the cap is 64, `cmp.l #\\$40,d0 / Rbhi`, and that is a property of the " +
    "SHAREWARE build we hold; the doc says a registered copy does 256 and that copy is not here to read. NOTE: " +
    "the `tst.w \\$c(a2) / Rbne routine 125` at \\$10ea is dead code --- the Pbob Erase two instructions earlier " +
    "ends with `clr.w \\$c(a2)`, so the field it tests is always zero by the time it is tested.",
  "pbob erase":
    "Routine 10 (\\$15cc), 138 bytes. DEVIATION, and it is the significant one in this extension: routine 0 " +
    "installs a reset hook at \\$6e0 into both \\$1bc(a5) and \\$1c0(a5), and that hook calls Pbob Erase and Psprite " +
    "Erase --- both reproduced --- but FIRST calls \\$7e6, which opens Screen 0 at 320x200x4 Lowres, prints " +
    "\"PowerBobs V1.0\", \"Unregistered version.\", \"(c) PowerSoft\" and \"Press the Enter key to continue.\" (strings " +
    "at \\$900/\\$910/\\$926/\\$932) and then spins `cmp.w #\\$d,d1 / bne \\$8b4` until Return arrives. Not reproduced.",
  "x pbob":
    "Routines 13 (\\$20d0), 14 (\\$20f4) and 5 (\\$10ba) --- X Pbob, Y Pbob and I Pbob, thirty-six to forty bytes " +
    "each and the same shape. DEVIATION: none of the three tests the structure pointer, where Set Pbob does.",
  "pbob":
    "Routine 2 (\\$f64), 246 bytes for `Pbob nr,x,y,image`, and routine 15 (\\$211a) for the array form `Pbob " +
    "ax,ay,ai,start To end`; neither appears in extdis's --list because both are unnamed alternate entries under " +
    "the `!pbob` primary. NOTE: the array form is documented as skipping three tests the single form makes --- " +
    "the width, the height against the maximum, and the array length --- which the doc spells out and advises " +
    "testing with the slow form first",
  "pbob off":
    "Routines 3 (\\$105a), 4 (\\$108a) and 21 (\\$25fe) --- three forms of one keyword, 48 to 80 bytes each, and all " +
    "three do the same single thing: `st.b \\$12(a1)`, the off-screen flag Pbob's own clip test writes. DEVIATION: " +
    "none of the three tests the structure pointer before writing through it, where Set Pbob does, so on the real " +
    "machine Pbob Off over a reserved-but-undefined Pbob writes a byte to address \\$12.",
  "pswap clear":
    "Routine 39 (\\$33fe), TWELVE bytes: `eori.w #\\$4,\\$14(a2)`.",
  "pdraw 25fps":
    "Routine 38 (\\$33da), 36 bytes.",
  "pbob draw":
    "Routine 9 (\\$1318), 692 bytes, the biggest routine in the extension, and it makes TWO passes over the range. " +
    "NOTE: BLTCON0 is \\$09f0 in Pbob Draw, Pbob Clear and Pbob Update alike --- USEA and USED only, minterm \\$f0, " +
    "D = A. That is the sharpest difference from an AMOS bob, it is in no documentation, and only the register " +
    "value says it. NOTE: the blitter fields the routine computes --- \\$20 a destination byte offset, \\$18 a " +
    "BLTSIZE, \\$16 a modulo, \\$1a a plane count --- are kept here as the clipped rectangle they describe, because " +
    "nothing reads them from BASIC and the pixels are what has to match.",
  "pbob clear":
    "Routine 8 (\\$1246), 210 bytes: the save buffers back onto the screen, over the range given, through the " +
    "CLEAR selector at \\$14(a2) that Pswap Clear flips.",
  "pbob update":
    "Routine 22 (\\$264e), 786 bytes: Pbob Clear and Pbob Draw over EVERY Pbob in one call, through a THIRD " +
    "selector at \\$16(a2) --- draw has \\$12 and clear has \\$14.",
  "pinc":
    "Routines 58-77, the array arithmetic block, and the fastest way a program moves a whole table of Pbob " +
    "coordinates. DEVIATION: these reach whatever the address space makes CONTIGUOUS, which is memory banks --- " +
    "the doc's own second option, \"It is also possible to use AMOS/Pro banks for storing the X/Y coordinates and " +
    "the Image of the Pbob's\" --- but NOT a Varptr into a BASIC array.",
  "pmul":
    "Routine 62 (\\$3bd8), with Pmul Shift routine 63 and Pdiv routine 77. NOTE: `adda.l d6,a1` at \\$3efc adds the " +
    "start offset to a1, which Pdiv never loads and never reads --- three pointers adjusted where only two were " +
    "popped.",
  "same":
    "Routine 68 (\\$3cf4), TEN bytes and no arguments: `move.l #\\$80000000,d3 / moveq #\\$0,d2 / rts`.",
  "psprite max":
    "Routine 35 (\\$337a), 28 bytes: `cmp.l #\\$80,d0 / Rbhi` caps it at 128 and `subq.l #\\$1,d0` stores the count " +
    "LESS ONE at \\$24e, which is why the block's shipped 63 means 64 Psprites.",
  "set psprite colours":
    "Routine 43 (\\$3504), 40 bytes, and it accepts 16 or 4 and nothing else --- `Rbne routine 125` for anything " +
    "third.",
  "x psprite":
    "Routines 36 (\\$3396) and 37 (\\$33b8).",
  "xscr mouse":
    "Routines 24 (\\$29ac) and 25 (\\$29c2), 22 bytes each: AMOS's own mouse position out of \\$-1580(a5) and " +
    "\\$-157e(a5), handed to `jsr \\$30(a0)` through -\\$4(a5), which is the hardware-to-screen conversion X Screen " +
    "and Y Screen also use.",
  "pbob fastcol":
    "Routines 16 (\\$22c0) and 17 (\\$2332) for Pbob-vs-Pbob, with the same pair in 20/19 (Pbob vs Psprite), 52/53 " +
    "(Psprite vs Psprite) and 56/55 (Psprite vs Pbob).",
  "pfast bobcol":
    "Routines 18 (\\$2426), 50, 54 and 57 --- one reader a pairing, picking up what the matching Fastcol left in " +
    "its table.",
  "psync every":
    "Routines 42 (\\$34d4), 49 (\\$376a) and 48 (\\$374a).",
  "pchannel to pbob":
    "Routines 40 (\\$340a) and 44 (\\$352c): attach an AMAL channel to a Pbob or Psprite so the channel's movement " +
    "drives it.",
  "psync pbob":
    "Routines 41 (\\$3460) and 45 (\\$3580): run the attached channels over a range of objects, but only when the " +
    "countdown at \\$28 (or \\$24) has expired --- `tst.w \\$28(a2) / bne` skips the whole thing and `move.w " +
    "\\$2a(a2),\\$28(a2)` reloads it. DEVIATION: the channel is stepped through the core AMAL interpreter rather " +
    "than PowerBobs' own copy.",
  "convert sprites":
    "Routine 28 (\\$2a34), 776 bytes: AMOS's sprite bank turned into PowerBobs' own chip-memory copy, one " +
    "`AllocMem(\\$4e20, MEMF_CHIP|MEMF_CLEAR)` carved into sixteen chunks of \\$4e2 whose addresses fill the tables " +
    "at \\$1bc and \\$1fc. NOTE: only the per-sprite HEIGHT survives into anything a program can observe --- it is " +
    "what Psprite Fastcol adds to a collision box.",
  "psprite":
    "Routine 30 (\\$2e20), 66 bytes, with the array form at routine 51 (\\$37da); both are unnamed alternates under " +
    "`!psprite`.",
  "psprite off":
    "Routines 32 (\\$2e80), 31 (\\$2e62) and 33 (\\$2e9e), three forms of one keyword.",
  "psprite update":
    "Routine 34 (\\$2ed0), 1194 bytes and the largest routine in the extension after Pbob Draw. DEVIATION: this " +
    "hands each entry to the runtime's own hardware sprites instead. Which sprite is where, showing which image, " +
    "is the same; the copper list the routine writes is not reproduced, because the display path here is a copper " +
    "interpreter the core sprite system already feeds",
  "serial error":
    "Returns 0.",
  "serial speed":
    "Faithful, and worth a note only because the token table declares it TWICE — `+IO_Ports.s:117` and `:123` " +
    "both emit `dc.b \"serial spee\",\"d\"+$80,\"I0,0\",-1` above the same `dc.w L_InSerialSpeed,L_Nul`, so ids $0048 " +
    "and $0086 are the same keyword pointing at the same routine. Evidence: routine 12 ($440).",
  "serial x":
    "The XON/XOFF characters are stored in IO_CTLCHAR and the enable flag is honoured, but Web Serial has no " +
    "software flow control at all — it offers 'none' or 'hardware' only.",
  "serial parity":
    "The five AMOS settings are all recorded, but Web Serial takes none/even/odd only.",
  "serial status":
    "Returns 0. Source: +IO_Ports.s:598.",
  "serial base":
    "Returns 0.",
  "printer error":
    "Returns 0, for the same reason as Serial Error: nothing is attached, so nothing fails",
  "printer online":
    "Returns 0, meaning not online — and 0 is the DEFAULT in FnPrinterOnline (+IO_Ports.s:780), not its failure " +
    "path as this note used to say.",
  "printer base":
    "Returns 0 -- the PrinterData/IORequest address, which does not exist here.",
  "parallel error":
    "Returns 0.",
  "parallel base":
    "Returns 0.",
  "printer dump":
    "Rasterises the region and hands it to the host as a page (host.printerPage); where it then goes -- a print " +
    "dialog, a download -- is the host's decision, as it is the printer driver's on a real machine.",
  "parallel input$":
    "Returns the empty string.",
  "multi no":
    "SetTaskPri(FindTask(NULL), 20) in the binary, which is exactly what the manual describes. There is no " +
    "scheduler here to apply a priority to, so the value is recorded and nothing else happens — and the " +
    "consequence the manual warns about, that under AMOS 1.3 'the keyboard and mouse are disabled', is " +
    "deliberately not reproduced: it is the reason Left Click and Raw Key exist, and simulating an input blackout " +
    "would break programs rather than emulate one",
  "multi yes":
    "The counterpart, SetTaskPri(..., 0).",
  "amos pri":
    "The name is CONTESTED and this note covers both; each port qualifies its own. TURBO Plus records a task " +
    "priority: routine 125 ($4600) tests both ends of the documented -128..20 range and branches to its own " +
    "rts when either fails, so an out-of-range value is silently IGNORED — neither clamped nor reported — and " +
    "that is reproduced: set 100 and the priority stays where it was. CRAFT's routine 177 ($2f22) reads " +
    "`ThisTask->ln_Pri` at offset 9 off the task ExecBase keeps at $114, sign extended, and its Set Amos Pri " +
    "(routine 176) writes SetTaskPri with a bound spelled as a ROUND TRIP rather than a comparison — `move.b " +
    "d0,d1 / ext.w / ext.l / cmp.l d0,d1 / Rbne routine 206` — so anything that does not survive being cut to " +
    "a signed byte is error 23 where TURBO Plus stays quiet.",
  "vbl wait":
    "Four instructions in the binary: a busy-wait on the low byte of VHPOSR ($dff006) until it equals the " +
    "requested line. That is sub-frame beam racing, and its whole purpose — the manual's example scrolls only the " +
    "top 100 lines and then waits for line 101, so the work happens in scanlines the display is not using — has " +
    "no meaning against a compositor that draws once per frame.",
  "raw key":
    "The manual says 'Does the same thing as the Key State function but works even if multitasking is disabled. " +
    "Evidence: routine 22 ($1150).",
  "is raw key":
    "Routine 171 ($5072) is `not.b` / `ror.b #1` on $bfec01 and nothing else, and the manual's warning — 'Beware!",
  "check":
    "TURBO's own zone system, which the manual is explicit is 'not compatible with the normal Zone commands'. The " +
    "manual's \"Returns 1 is the result is true, 0 if not\" is true of zone 1 and of nothing else: routine 335 " +
    "writes the zone's own number into the entry's leading word and routine 16 returns that word, so a hit on " +
    "zone 7 answers 7.",
  "reserve check":
    "Routine 337 ($6dee) refuses to reserve twice — TURBO error 0, \"Check allready reserved\" — and bounds the " +
    "count at 32000 BEFORE that test. Not reproduced: a negative count passes the signed bound and then goes " +
    "through `mulu.w #$a`, which reads it unsigned and asks AllocMem for six hundred kilobytes; this treats it as " +
    "zero",
  "reset check":
    "Routine 334 ($6d4c) bounds the zone number LESS ONE against the count, where Set Check next door bounds the " +
    "number itself.",
  "set check":
    "`movem.w d0-d4,(a0)` stores the zone number and the four coordinates exactly as they were pushed.",
  "hit bob check":
    "The manual calls dx and dy \"a displacement in opposite to the bob's hot spot\", and routine 136 ($472a) is " +
    "`add.l (a3)+,d2 / add.l (a3)+,d1` — it ADDS them, in the same direction Hit Bob Zone does.",
  "hit spr check":
    "Routine 21 ($10ce) is Hit Bob Check with one extra instruction, `jsr $30(a0)` after the displacement is " +
    "added: Check zones are screen rectangles — 'Define a rectangular screen area' — and a sprite's position is " +
    "in hardware coordinates, so the pair is converted before the scan, the same conversion Hzone makes for Hit " +
    "Spr Zone",
  "x icon":
    "Routines 87-89 ($330e, $334e, $3390) walk the bank list for type 2 themselves rather than asking AMOS, and " +
    "every step of the way out is an error: `Rble routine 62` for a number at or below zero, routine 130 (AMOS " +
    "error 36, Bank not reserved) for no icon bank, routine 131 (error 74, Icon not defined) for a number past " +
    "the count or a hole in the table. Note they ask for the icon bank unconditionally where Icon Check reads its " +
    "bank number out of the Scene Icon Bank setting, so the two disagree about which bank 'the icons' means",
  "workbench open":
    "The counterpart to Close Workbench, which this port already treats as faithful because there is no Workbench " +
    "memory to free.",
  "memory fill":
    "Both fill loops in routine 140 ($4810) decrement the count after writing and continue while it is not yet " +
    "negative, so the region is inclusive of the END address: Memory Fill a To b writes b-a+1 bytes. The manual's " +
    "own example, \"Memory Fill Start(6) to Bank End (6), A$\", therefore writes one byte past the bank, because " +
    "Bank End is already one past the last byte.",
  "byte hunt":
    "Byte Hunt and Word Hunt are the same ninety bytes at two operand sizes, and three things follow that the " +
    "manual does not say.",
  "string hunt":
    "Two deviations, both at the edges. Evidence: Routine 169 ($4f84).",
  "t clip":
    "Routine 149 ($4b0c) is divs.w then muls.w on a longword variable, guarded by a longword test. What is not " +
    "reproduced is the divisor above 65535 whose low word is zero — that passes the guard and then takes the 68k " +
    "divide-by-zero exception, and with no trap to take it raises the same illegal function call the guard would " +
    "have",
  "line 3d":
    "Routine 41 ($155e) projects with `asl.l #$7` then `divs.w` — sixteen bits of quotient for a dividend that " +
    "has just been shifted up seven places.",
  "bank end":
    "Routine 312 ($5dc4) tells a sprite or icon bank from a data bank by comparing the longword at a0-8 — the " +
    "first half of the eight-character bank name — with 'Icon' and 'Spri', and answers the negated image count " +
    "for those.",
  "plane shift up":
    "Routines 79 and 80 ($22ea, $235e) open `cmp.w d6,d7 / Rble routine 62`: the range has to be at least two " +
    "planes wide, so shifting a single plane onto itself is an error rather than a no-op.",
  "plane update":
    "Routine 81 ($23d2) CopyMems the screen's $48-byte header aside, adds the six-long offset table into all " +
    "three plane tables, asks AMOS to rebuild the display, and CopyMems the header back.",
  "build static block":
    "Routine 95 ($35e8) walks AMOS's block list and indexes each entry by its own number with no bounds check — " +
    "\"Be sure that you have reserved enough memory for all entries!\" — and no test that a table was ever reserved " +
    "either, so with none it writes through a null pointer.",
  "f paste icon":
    "",
  "f 16 icon":
    "Routines 83 and 84 ($258a, $2c94) clip at the NEAR edge, which is what really separates them from the rest " +
    "of the family: a negative coordinate is subtracted off the icon's own height or width and the remainder is " +
    "drawn from the screen edge.",
  "f 16proc icon":
    "The five F icon keywords differ in what they refuse to do rather than in what they draw: the " +
    "width-specialised ones skip the 16-pixel chop of X, and the two processor ones drive the CPU instead of the " +
    "blitter and lose the mask with it ('Masking is not supported!'). Both of those survive here — and so does " +
    "the one the manual never mentions, that routines 85 and 86 apply `andi.w #$fff0` to the Y coordinate as well " +
    "as the X, so the icon lands on a sixteen-LINE boundary too. What cannot is the point of them — there is no " +
    "blitter to be faster than, so F 16proc Icon and F 32proc Icon are the same speed as the rest, where on a " +
    "real machine choosing the wrong one for your CPU was the difference the manual spends a page on",
  "icon check":
    "Reports -1 for a defined icon with no mask, 1 with one, 0 for a missing one, and 0 rather than an error when " +
    "there is no bank — 'in AMOSPro you don't get an error'. It can even check BOB/SPRITE banks, as the bank has " +
    "the same format.' It never checks the lookup succeeded, so a missing bank reads address zero on the Amiga; " +
    "here it gives the documented 0",
  "scene 16 view":
    "The whole viewport family carries a regression the 2.15 rewrite introduced, and it is reproduced rather than " +
    "corrected.",
  "scene bank":
    "Holds the bank number and resolves it at each use, where the library holds the pointer GetBank returned. " +
    "Scene Bank also resolves the icon bank, so a missing icon bank is reported here, as the manual says it is",
  "scene icon bank":
    "Bank 1 is the sprite bank and bank 2 the icon bank; any other number can only be a plain memory bank in this " +
    "port's model, so it fails the routine's 'Icon'/'Spri' cookie test with the extension's own error 26. The " +
    "manual's suggestion of appending bobs and sprites to a single bank and switching to it works for 1 and 2, " +
    "which is what programs use",
  "scene 16 change":
    "The manual says \"the change made on screen and in the Scene bank\"; the routine ends at the bank write and " +
    "draws nothing.",
  "scene scan y":
    "Undocumented in either manual.",
  "scene check":
    "The bound is cmp.w/Rbhi, a strictly-greater test, so a coordinate equal to the width or height is accepted " +
    "and indexes one tile past the row or the map.",
  "scene 32 draw":
    "Chops XSCREEN with andi.w #$fff0, the same 16-pixel mask the 16 version uses, despite the manual's " +
    "\"XSCREEN/YSCREEN are chopped to lie on a 16/32 bit boundary\".",
  "scene convert":
    "The source bank is fetched with no check and read immediately, so on the Amiga a missing bank reads address " +
    "zero.",
  "scene 16 def":
    "The 78-byte definition record captures the scene and icon banks as pointers, so a definition outlives the " +
    "Scene Bank setting that made it and Scene 16 Restore keeps drawing from wherever it was pointed.",
  "td keep on":
    "A cache switch: 'Td Keep Off tells 3D not to keep objects in memory, but to load them each time'.",
  "td quit":
    "'Unload the 3D extensions along with all objects and release all 3D memory.' There is no separately loaded " +
    "engine here to unload — c3d.lib is this module — so it is the object clear and the state reset",
  "td angle":
    "Angles are 65536 units to the revolution, which is what the matrix builder at $213df8 works in — it reduces " +
    "by quadrant with btst #6/#7 on the high byte and reflects about $8000.",
  "td position x":
    "The position and attitude readers are one engine routine each plus an axis selector in d2, so Td Position " +
    "X/Y/Z is $2119ec with 0/1/2 and Td Attitude A/B/C is $211bf8 the same way.",
  "td cls":
    "Clears the top Td Screen Height lines to colour 0, after the three checks $2114be makes on the AMOS screen: " +
    "exactly 320 wide, at least 4 bitplanes, and at least as tall as Td Screen Height. What is not reproduced is " +
    "the clear being a blitter fill of the 3D area only — here it is a plot loop over the same rectangle",
  "td move x":
    "The six string forms — Td Move X/Y/Z and Td Angle A/B/C — are $211822 and $211a14 with the axis in d2.",
  "td range":
    "Equal object numbers return zero before either is validated ($211d9c compares first), so Td Range(99,99) is " +
    "0 rather than \"Invalid object number\".",
  "td redraw":
    "The model is the engine's and the rasteriser is ours. The polygons and their pens are right; the bits are " +
    "not guaranteed identical, a long shallow edge can land a column either side of where Bresenham would have " +
    "put it, and the phase of the two-pen dither — which pen falls on the even squares — is a choice, because it " +
    "is decided inside the fill that is not reproduced.",
  "td surface points":
    "The four anchors are recorded where the engine records them, at a4+$486f with the flag at a4+$4873, and " +
    "nothing maps a surface through them: a surface's first four slots are still the face's own four corners, " +
    "which is what $217424 fills them with.",
  "td visible":
    "$211d64 answers 0 when the byte at $f8 of the instance is set and the one at $cb is clear. $f8 is a " +
    "culled-this-frame flag: $219038 clears it at the top of each object's pass and $2190c8 sets it when the " +
    "object fails a distance test, `d6 + a4+$b34 < d7`. An object rejected wholly by the near limit agrees with " +
    "the engine; one the engine culls early for being too far, and this one drops face by face, can disagree at " +
    "the margin.",
  "td advanced":
    "Hands back an address on the Amiga: a4 itself for object zero, otherwise the instance pointer ($212f0c). " +
    "There is no address space here for one to mean anything in, so this answers zero — the same reason peek, " +
    "poke and start are approximated.",
  "td load":
    "The engine gates its \".3DO\" suffix on a flag at a4+$b1a whose setter is not on any path traced so far; every " +
    "shipped demo loads by bare name, so the suffix is always added here and a name that already carries an " +
    "extension keeps it.",
  "multi bload":
    "The only genuinely concurrent keyword in the extension: it CreateProc()s an AmigaDOS process — up to five at " +
    "once — which opens the file, reserves a bank the size of it under the eight characters given, reads it and " +
    "exits, while BASIC carries on. Every program that uses these three waits on Multi Bl Ended before touching " +
    "the bank and cannot tell the difference; what is not reproduced is the overlap itself, so a program " +
    "animating a loading screen sees the load complete in one frame",
  "cpu info":
    "Reports 20, a 68020.",
  "parse$":
    "Undocumented, and it does not return a string despite the name: routine 180 ($5430) leaves an integer in d3 " +
    "— which alternative of a '|' separated list matched word N of the source, counting from one, or the fourth " +
    "argument when none did.",
  "chip largest":
    "AvailMem(MEMF_CHIP|MEMF_LARGEST).",
  "plane offset":
    "The offset table is the routine's own — a byte offset of y*rowBytes+x per plane, accumulating unless the new " +
    "offset works out to zero, and cleared for a whole screen by a negative plane number.",
  "f put static block":
    "The static list is a lookup optimisation over the same blocks, so this draws what F Put Block draws.",
  "f circle":
    "Eight-way symmetry with the column height taken from an integer square root computed in WORDS, which is the " +
    "whole of the documented bug: 'do not use a radius above 180...there will be no crash, but the result is " +
    "definitely not a circle!' — r*r-x*x stops fitting in sixteen bits at 182, and this overflows where the " +
    "routine overflows. Not modelled: the manual's other caveat, that a hires screen turns the circle into an " +
    "ellipse, because that is a property of the pixel aspect of the display rather than of the pixels written",
  "f sqr":
    "Undocumented, and faithful including both of routine 65's ($1f18) defects.",
  "f draw":
    "The token spec is I0,0t0,0 in 1.0, 1.9 and 2.15 alike, so only the To form exists — the manual's shorter 'F " +
    "Draw X,Y' cannot be written and would not parse on the real machine either. Ignores the Set Line pattern, as " +
    "the manual admits ('this will be corrected in a future update'), and the plane mask",
  "blit left":
    "The scroll is modelled as what the blitter does rather than by emulating it: the region's pixels are one " +
    "stream, rows joined end to end, shifted by the barrel-shift amount.",
  "cd year":
    "Routine 322 ($7104 in 1.50, 308/$7398 in 1.40): a subtract-a-year-at-a-time loop from 1978 that leaves the " +
    "remaining days behind for the month splitter, which is why Cd Month is six bytes of `Rbsr` into it and Cd " +
    "Day six more into Cd Month. DEFECT: the leap test is `move.b d3,d4 / andi.b #$3,d4` -- a bare `year AND 3`, " +
    "with no hundred-or-four-hundred correction -- so AMCAF gives 2100 a 29 February and every date it reports " +
    "from 1 March 2100 is a day behind the calendar.",
  "cd month":
    "Routine 323, and then routine 338 ($811e) -- the splitter no token names. February's extra day is added to " +
    "the table entry in place, guarded by the same `year AND 3`, so it inherits Cd Year's defect",
  "cd day":
    "Routine 324: `Rbsr` Cd Month then `move.l d0,d3 / addq.b #$1,d3`.",
  "cd weekday":
    "Routine 325 ($7140): `(days+6) divu 7`, remainder plus one. DEFECT: `divu.w` is a 32-by-16 divide and the " +
    "68000 leaves its operand UNTOUCHED when the quotient will not fit a word.",
  "cd date$":
    "Routine 328 ($71f8), which writes a length word of 13 before any digit and builds the string from two " +
    "OVERLAPPING four-byte tables: `lea $7556(pc,d6.w)` with d6 = month*4 puts month 1 at $755a and month 0 on " +
    "$7556, which is the seventh weekday slot 'Sun '.",
  "ct tick":
    "Routine 332 ($72f4). The manual's 'the number of vertical blanks (=1/50 of a second)' does not say whether " +
    "the count is within the second or the minute.",
  "ct time$":
    "Routine 333 ($7306), a length word of 8 written before any digit. DEFECT: the two-digit printer it shares " +
    "with Cd Date$ ($7638 and $7514, the same code assembled twice) is not a formatter -- it starts each " +
    "character at '0' and counts up, byte-wide, with no upper bound, so an hour count of 100 walks the tens " +
    "character ten past '0' onto ':' rather than widening the string.",
  "cd string":
    "Routine 327 ($71a8) really is dos.library: `movea.l $2b8(a5),a6 / jsr -$2ee(a6)` is StrToDate, guarded by " +
    "`cmp.w #$25,$14(a0)` against ExecBase's LIB_VERSION -- the manual's 'only works on OS2.0 and higher', not " +
    "modelled because the machine this port describes is an A1200 and the check can only pass. DEVIATION: the " +
    "library matches those words with `Strnicmp(table[t], ptr, strlen(table[t]))`, a case-insensitive PREFIX " +
    "test, so 'Todayish' is Today and '12-November-89' matches 'Nov' and then fails on the leftover 'ember'. This " +
    "port matches the whole word and also accepts the full month names the manual promises, which is the union of " +
    "the two -- no string a real machine accepted is refused here",
  "ct string":
    "Routine 326 ($7152), Cd String's twin: the same StrToDate call with dat_StrTime filled in and dat_StrDate " +
    "cleared, then ds_Minute packed over ds_Tick the way Current Time does. NOTE: both String keywords copy the " +
    "AMOS string to the START of the extension's own block with no length check, and the DateTime they fill in " +
    "sits at +$380 of that same block, so an argument of 896 characters or more overwrites the structure it is " +
    "about to be parsed into. Not reproduced -- there is no block here to overrun -- but it is why an over-long " +
    "argument on a real machine misbehaves rather than simply failing",
  "amcaf base":
    "'Gives back the address of the AMCAF data base' and Amcaf Length its size, for the 'Assembler and C freaks' " +
    "the manual addresses. APPROXIMATED",
  "amos task":
    "Routine 339 ($7518), twenty bytes and nothing but the call: `suba.l a1,a1 / movea.l $4.w,a6 / jsr -$126(a6)` " +
    "is FindTask(NULL), and its result is the answer. NOTE: zero is a value FindTask never returns for a running " +
    "task, so `If Amos Task<>0` takes the other branch here; Extbase answers a synthetic non-zero instead " +
    "precisely because that comparison is its documented use, and nothing documents one for this",
  "vec rot y":
    "Routine 8 ($20aa), fourteen bytes: `movea.l $168(a5),a2 / move.w $30e(a2),d3 / ext.l d3`. APPROXIMATED " +
    "refers to the rotation ORDER, which was not recovered; these three readers are exact",
  "vec rot z":
    "Routine 10 ($20c6), fourteen bytes: `move.w $310(a2),d3 / ext.l d3`, the third of the three adjacent cache " +
    "words.",
  "pt cpattern":
    "Routine 240 ($5d0e), eighteen bytes: `movea.l $2cc(a2),a0 / move.b -$c(a0),d3` -- a BYTE taken twelve back " +
    "from the replayer's live pointer, and masked by nothing. DEVIATION: that engine is transcribed from Player " +
    "6.1A's source, not from AMCAF's own replayer at $9bac, which has not been disassembled -- the two are both " +
    "faithful ProTracker replayers and agree on the format and the sixteen effects, but where they differ in a " +
    "corner this follows Paananen.",
  "pt cpos":
    "Routine 241 ($5d20), twenty bytes: `movea.l $2cc(a2),a0 / move.w -$4(a0),d3 / lsr.w #$4,d3` -- a WORD four " +
    "back from the live pointer, shifted down four, so the row is a packed field rather than a plain counter. The " +
    "`& 63` in the port is the manual's stated range ('a number between 0 and 63'), not the routine's, which " +
    "masks nothing. APPROXIMATED for the same reason as Pt Cpattern: nothing steps the patterns here",
  "extpath$":
    "Routine 98 ($35e2), 120 bytes, and it has nothing to do with extensions. DEFECT: this port read the NAME as " +
    "'where an extension was loaded from', answered the empty string for every argument, and never looked at " +
    "routine 98 -- the token spec is `\"22\"`, string in and string out, which the old reading could not have " +
    "explained.",
  "write cli":
    "Writes to the CLI the program was started from.",
  "pt stop":
    "Routine 267 ($6196).",
  "pt cia speed":
    "Routine 259 ($6016) and selector 5 of routine 381. Selector 5 is where the value is sanitised, and it is not " +
    "the clamp the manual implies: `cmp.w #$20,d0 / bge / moveq #$20,d0` puts a FLOOR at 32 bpm and then `andi.w " +
    "#$ff,d0` masks to a byte with no ceiling test at all, so 300 bpm becomes 44 and 256 becomes 0 -- which the " +
    "very next instruction divides by. NOTE: the zero arm never writes 125 anywhere; VBL timing is 50 ticks a " +
    "second whatever the word holds, which at ProTracker's default six ticks a row IS 125 bpm, so the manual " +
    "describes the effect rather than a store",
  "pt vu":
    "Routine 260 ($605e).",
  "pt sam play":
    "Routines 250 ($5eb6), 251 and 252 -- the one-, two- and three-argument forms of `Pt Sam Play " +
    "voice,samnr,freq`. The OPTIONAL argument is the LEADING one: routine 250 supplies `moveq #$f,d2` itself, so " +
    "a bare call plays on all four channels, which is the manual exactly ('if it is ommitted, the sound effect " +
    "will be played on all four sound channels').",
  "pt instr length":
    "Routine 258 ($5fe6).",
  "pt free voice":
    "Routines 238 ($5b80) and 239. A 1.50 addition with no manual entry, so DISASSEMBLY tier by the author's own " +
    "admission that he had no time to document what 1.50 added -- and it is not the simple query the port had. " +
    "DEVIATION: the last arm, when every free voice is one the music holds, minimises two words of the live " +
    "channel structures at -$13e(a1) -- the quietest music channel -- and the shared replay's channel block is " +
    "not AMCAF's, so there is no `-$13e(a1)` to minimise over; it falls back to the lowest free voice",
  "pt play":
    "Routines 264 ($612e) and 265. Which interrupt it ends in is Pt Cia Speed's $296(a2), the two timings " +
    "installing through different code, which is why the manual says to choose the timing BEFORE Pt Play. " +
    "DEVIATION: the `cmpa.l #$200000,a0` chip-RAM check is Pt Bank's and carries the same note",
  "pt bank":
    "DEVIATION: the 2MB test compares a real address and this port models memory type as a flag on the bank, so " +
    "enforcing it would reject every Reserve As Work bank, including on machines where all memory is chip and the " +
    "original is happy Evidence: Routine 263 ($610c).",
  "pt sam bank":
    "Routine 249 ($5ea4), three instructions: pop the bank number, `Rjsr routine 1121` to resolve it, keep the " +
    "ADDRESS at $2c4(a2).",
  "set trans source":
    "Routine 147 ($4142), eighteen bytes: pop, `Rjsr routine 1121` to resolve a bank number to an address, keep " +
    "it at $496(a2). DEVIATION: the machine keeps the ADDRESS, which is why the changelog writes the argument as " +
    "`bank/address` -- a raw pointer works as well as a bank, and a later Erase leaves it dangling.",
  "set trans map":
    "Routine 149 ($4190), the same three pops and the same `addi.w #$1f / andi.w #$ffe0` width rounding as Alloc " +
    "Trans Map, then routine 1121 instead of a Reserve. DEVIATION: bank number rather than address, as Set Trans " +
    "Source",
  "alloc trans map":
    "Routine 148 ($4154). NOTE: a zero width or height asks for a bank of length 0, which the machine reserves " +
    "happily and this port refuses with error 23 -- and the Reserve failing on the machine is the 24 of routine " +
    "389, not 23",
  "alloc code bank":
    "Routine 150 ($41b6). NOTE: the size is stored and NEVER READ.",
  "alloc trans source":
    "Routine 146 ($411a).",
  "trans screen runtime":
    "Routine 152 ($4220) over the shared set-up in routine 151 ($41e0). DEVIATION: routine 151 range-checks the " +
    "bitplane against SIX and not against $50(a0), the screen's depth, where the library's own Blitter Copy " +
    "(routine 63) does `cmp.w $50(a0),d4 / Rbge`; so naming plane 5 of a two-plane screen writes through a plane " +
    "pointer AMOS left null. NOTE: there is no clip of any kind -- nothing compares ox, oy or the map's extent " +
    "against the screen, and the author says so: \"Wrong or stupid parameter values are not checked for validity\". " +
    "NOTE: neither the map nor the source pointer is checked for zero either, so with no Trans Map set the " +
    "machine walks from address zero; that raises error 23 here",
  "trans screen static":
    "Routine 154 ($42fc) is TWO BYTES, `rts`, and the changelog says why: \"Trans Screen Static NOT YET " +
    "IMPLEMENTED\". DEFECT: it does not quite do nothing. NOT REPRODUCED: this port evaluates arguments as it " +
    "parses rather than onto a stack, so there is nothing to leak -- the four arguments are still consumed, " +
    "because the spec is what the parser follows Source: +ILib.s:6862; +Lib.s:18517.",
  "pt volume":
    "Routine 261 ($6084), the MUSIC's volume at $4(a0) -- and NOT the volume a sample plays at, which is Pt Sam " +
    "Volume's $2d0(a2). NOTE: `bpl` tests the whole long and `cmp.w #$40,d0 / bls` only the low word, so `Pt " +
    "Volume 65536` is positive, has a low word of zero and stores silence.",
  "pt sam volume":
    "Routines 244 ($5d98) and 245 -- two forms doing two different things, which the port had the wrong way " +
    "round. Two arguments write AUDxVOL directly, for a channel that is actually playing (`tst.b (a1) / bne " +
    "next`), which is the manual exactly: 'the command only has effect on the currently played sample, but not on " +
    "the following samples'. NOTE: the clamp is `bpl` then a SIGNED `cmp.w #$40,d0 / ble`, where Pt Volume's is " +
    "unsigned, so `Pt Sam Volume 32768` has a low word of $8000 that reads as negative, passes the ceiling test " +
    "and is stored whole",
  "pt instr play":
    "Routines 254 ($5f6c), 255 and 256 -- the same three forms as Pt Sam Play, and the shorter entries are where " +
    "the defaults come from: `moveq #$f,d1 / move.l d1,-(a3)` for the voice and `move.l #$3d09,-(a3)` for the " +
    "frequency, so a bare call is all four channels at a flat 15625 Hz.",
  "pt instr address":
    "Routine 257 ($5fb2), and it does not walk the module: it reads a CACHE of 31 longs at -$92(a5) that selector " +
    "1 of routine 381 fills when Pt Play or Pt Bank installs a module, by summing the sample lengths from `module " +
    "+ 1084 + patterns*1024`.",
  "pt raw play":
    "Routine 248 ($5e90), twenty bytes, and the fourth parameter is a FREQUENCY IN HERTZ -- 'freq holds the " +
    "replaying speed in Hertz' -- which routine 375 clamps to 400..30000 and turns into a period as $369E99/freq. " +
    "DEFECT: the negative-length idiom is broken. NOT reproduced: this port has no address space to run off the " +
    "end of, so a negative length loops the sample as the author meant, and the difference is recorded rather " +
    "than emulated",
  "pt data base":
    "Routine 253 ($5f5a), and selector 4 of routine 381 is the surprise: `lea $9cea(pc),a0 / move.l a0,$2cc(a2) / " +
    "move.l a2,$1e(a0)`. NOTE: answers 0 for the same reason the Scrn pointers do -- there is no byte layout here " +
    "for a program to walk. APPROXIMATED",
  "pjoy":
    "'Corresponds to the AMOS function Joy, with the difference, that one of the parallel port joysticks is " +
    "checked instead of the normal joysticks', with the same JOY_* bit layout. NOTE: there is no adaptor -- this " +
    "is the same CIA-A PRB hardware sticks.ts models, and Sticks already answers 'no adaptor' honestly. The " +
    "manual even ships a wiring diagram for building the cable",
  "xfire":
    "AMCAF: 'If the lowlevel-library is available, all the other buttons can be checked aswell.' lowlevel.library " +
    "is not modelled and a plain gameport has one button, so anything past the first reads as not pressed; the " +
    "first is the ordinary fire the host already supplies.",
  "x smouse":
    "NOTE: nothing drives a second mouse here, exactly as in the Sticks port where the manual is explicit that " +
    "this is 'not ... the AMOS pointer'.",
  "speek":
    "'exactly the AMOS function Peek.",
  "audio lock":
    "'When you start AMOS, the audio.device will be not informed, that AMOS wants to have the audio channels.",
  "hw mouse key":
    "Routine 190 ($313a), and it goes to the silicon rather than to AMOS -- `btst.b #$6,$bfe001.l` for the left " +
    "button on CIA-A's port A, and `#$a` and `#$8` on POTGOR at $dff016 for the right and the middle, all three " +
    "ACTIVE LOW, packed into bits 0, 1 and 2. That is what earns the manual's \"it works whether the AMOS " +
    "screen is displayed or not\". Both registers were ADDED TO THE MEMORY MAP for this rather than " +
    "short-cutting to the host's mouse, because a program can reach them with Peek and has to get the same " +
    "answer the keyword does.",
  "gr ink":
    "Routine 193 ($319a) onto the shared body at routine 196: rp_FgPen at $19 off the RastPort at " +
    "`-$18ca(a5)`, with Gr Back and Gr Border reading $1a and $1b. Worth more than three keywords -- it is the " +
    "confirmation that `-$18ca(a5)` IS a RastPort, which is what makes the turtle's line-pattern slip a slip: " +
    "routine 119 writes its counter to $1f, one short of rp_linpatcnt at $1e.",
  "gr centre":
    "Routine 197 ($31c2): TextLength on graphics.library, `(screenWidth - width) / 2`, then Move and Text. An " +
    "omitted y is not an error -- `cmpi.l #$80000000,d1` falls back to `$26(a1)`, rp_cp_y, so the graphics " +
    "cursor stays where it was.",
  "beam wait":
    "Routine 192 ($3176). The bound comes off AMOS's own jump table at `$128(a0)`, which is why the manual can " +
    "say \"if the y is bigger than the number returned by =Display Height, an Illegal function call error is " +
    "given\" -- it is the same number. DEVIATION: the wait is not waited. The body is a three-instruction spin " +
    "on VPOSR, and a keyword that spins inside one interpreter step cannot advance a beam this port only " +
    "advances between them; AMCAF's Raster Wait carries the same note. The bound IS checked.",
  "amos base":
    "Routine 198 ($3226), and the whole routine is `move.l a5,d3`: \"the address of the internal data zone of " +
    "AMOS\". A CONSTANT here, exported as CRAFT_AMOS_BASE rather than buried in a return. What sits at a5 on " +
    "the machine is kilobytes of interpreter state -- $208 for CRAFT's own workspace, $5fa for the open-screen " +
    "flag, $620 for DOSBase -- and this port keeps all of that as fields, so there is nothing to map and " +
    "mapping a page of zeros would imply there was. The Game's =G Oddno hands back a bare library-base " +
    "constant for the same reason, where Tr Base and Mubase map real blocks because they have real blocks.",
  "amos pro":
    "Routine 204, three instructions and no test at all: `moveq #?,d3 / moveq #$0,d2 / rts`. It is still " +
    "correct, because the CONSTANT DIFFERS BETWEEN THE TWO BUILDS -- `moveq #0,d3` at $3282 in CRAFT.Lib and " +
    "`moveq #-1,d3` at $3276 in AMOSPro_CRAFT.Lib. Every other address cited for this extension is CRAFT.Lib's, " +
    "because that is the build this port read; this is the one keyword the two are known to disagree on. It " +
    "was briefly recorded here as a defect, which was this port reading the 1.3 build out of a file it had " +
    "mislabelled -- the installer's Data0 blob holds FOUR libraries behind a four-word length table, and " +
    "parseAmosLibOld stops at the first code hunk.",

  // ---- Music (Omega) 1.0, slot 1 -------------------------------------------
  // Three keywords appended to APD230's Music.Lib for one PD disc. Addresses
  // are music-omega-1.0's own; everything below `set talk` ($01fa) is the
  // stock 1.3 library and is classified with the rest of Music, above.
  starset:
    "Routine 84 ($28b6), twenty-eight bytes. `movea.l (a3)+,a0 / movea.l (a3)+,a1`, so the LAST argument pops " +
    "first and a1 is the module: it goes to $924(a3) raw, unparsed and unchecked, and nothing looks at it until " +
    "Starplay. The first-popped argument is a bank NODE -- `adda.l #$18,a0` before `move.l a0,$928(a3)` is the " +
    "24-byte header Bnk_Reserve puts in front of a bank's data (+Lib.s:8494) -- and it names a table of " +
    "120-byte entries the row engine indexes at $752 with `mulu.w #$78,d0 / add.l $928(a6),d0`, testing each " +
    "for 'AM' ($414d) and taking a length from the word at +6 shifted down two. So a pattern's sample slot may " +
    "be an AMOS sample instead of one of the module's. That arm is unreached by the only program that calls " +
    "any of this: techno.amos writes `Starset Start(13),` and elides the second argument, which arrives as " +
    "EntNul ($80000000, +Equ.s:67) and makes the base $80000018. resolveAddr answers null for it here, so the " +
    "arm stays shut for a defensible reason rather than by luck.",
  starstop:
    "Routine 85 ($28d2), forty-six bytes, and byte for byte the same eleven instructions as the interrupt's " +
    "own stop arm at $524 -- four `clr.w` over AUD0VOL through AUD3VOL, `move.w #$f,$dff096` with bit 15 clear " +
    "so audio DMA goes off, and `clr.b $920(a3)`. It takes no argument and tests nothing, so stopping a player " +
    "that never started still silences AMOS's own music. techno.amos calls it before Starset for that reason, " +
    "and once more at the end. What it does NOT do is undo Starplay's `ori.b #$2,$bfe001` ($2990), so the " +
    "low-pass filter and the power LED stay off after the music stops.",
  starplay:
    "Routine 86 ($2900), 200 bytes. `Starplay ONEPATTERN,POSITION,ROW,LOOP`, masked rather than checked: " +
    "`andi.b #$1` on the first and last, `andi.b #$7f` on the position, `andi.w #$3f` then four `add.w d0,d0` " +
    "on the row, because the library holds a row as its byte offset into the pattern and recognises the end of " +
    "one by $400. Then the 31-sample MOD layout, read on faith with no signature test: $3b8(a0) is the " +
    "128-byte order table, scanned by a `dbra` that always runs all 128 whatever the song length says; its " +
    "maximum plus one is the pattern count, times 1024 their size, and $43c(a0) plus that the first sample. " +
    "Each of the 31 headers gets `clr.l (a2)` at its sample's head and `clr.b $2(a0)` in the header itself, " +
    "which throws the FINETUNE away -- parseMod reads finetune, so a module that uses it plays in tune here " +
    "and slightly out of tune on the machine. Speed is set to 5, where ProTracker's own default is 6. " +
    "Approximated for one reason: the row engine at $54e..$b62 is not reproduced. This port runs " +
    "../amiga/protracker.ts and imposes the library's position rules on top of it, read off $66c to $6d2, so " +
    "the two agree about notes, samples, volumes and speed and are not known to agree about every command. " +
    "DEVIATION: the library plays a bank that is not a module as noise; parseMod requires \"M.K.\" or \"M!K!\" " +
    "at 1080 and this refuses quietly instead of synthesising what one Amiga made of one piece of memory.",

  // ---- MusiCRAFT 1.0, slot 19 ----------------------------------------------
  // Addresses are AMOSPro_MusiCRAFT.Lib's. Routine 0 is $11e..$13c4 and is the
  // whole player; `$218(a5)` holds $ddc, which sits INSIDE it, so the player's
  // routines are at negative offsets from the base and its data at positive
  // ones. `st load`'s note is up with EasyLife's, which spells the same name.
  "st play":
    "Routines 4 and 5 ($1482, $148a), the one-argument form pushing a zero and falling into the two. \"This " +
    "instruction plays a module installed in bank b_nro. If the optional parameter is included, the instruction " +
    "starts to play the module from the position pos.\" `moveq #$7f,d0 / cmp.l d0,d7 / Rbhi` is the only check " +
    "the position gets -- 0 to 127, unsigned, and never against the song length. The bank must exist (error 36) " +
    "and must be named \"Tracker \" (\"Not a tracker bank\"); unlike SLN's S Track Play there is no address form, " +
    "so a module loaded any other way cannot be played. Then mt_init at $2f4: mt_speed AND mt_counter both 6, " +
    "so the first vertical blank plays a row instead of waiting six for it, and the voice mask back to $f. There " +
    "is NO times-to-play -- mt_NextPosition at $724 wraps to 0 at the song length and the module runs until " +
    "something stops it. DEVIATION: a start position past the song length. The machine indexes the whole " +
    "128-byte order table with it and plays whatever is there, almost always pattern 0, and one pattern later " +
    "the wrap brings it home; Protracker.load keeps only the used positions and starts at 0. The two agree for " +
    "every position the song actually has.",
  "st stop":
    "Routine 6 ($14d0), a jump to base-$be2. \"Stops the music started with the instruction St Play.\" `move.w " +
    "$1de(pc),d0 / beq` first, so with nothing playing it does nothing at all -- not even silence. Otherwise the " +
    "voice mask goes to zero (which silences all four and turns their DMA off), the run flag clears, and " +
    "RemIntServer takes the VERTB server back out. NOTE the last instruction is `bclr #1,$bfe001`, the audio " +
    "filter back on after mt_init's `bset` turned it off; nothing in the modelled machine hears either.",
  "st pause on":
    "Routine 7 ($14d8). \"These instructions pause/unpause the current module.\" `clr.w $5e2(a0)` -- the word at " +
    "$13be the tick tests before it does anything -- and then the silence routine at $38c, which zeroes all four " +
    "AUDxVOL and turns all four DMA channels off whatever the voice mask says.",
  "st pause off":
    "Routine 8 ($14e4). It clears each channel's n_dmabit before setting the flag back, which does nothing a " +
    "program can see: that field is only ever read to turn DMA off ahead of a trigger that is about to set it " +
    "again from the channel's own $2a. What a program CAN see is that St Pause On left the voices dead and " +
    "nothing here brings them back -- each channel is silent until its own next instrument.",
  "st voice":
    "Routine 9 ($14fe), a jump to base-$bb2. \"This instruction works like the normal AMOS voice instruction; it " +
    "switches the audio channels on and off. If a bit is set to -1 in the parameter bit_mask, the channel is " +
    "active and if a bit is set to 0, the channel is not active.\" `andi.w #$f,d0` at $234 is the whole of the " +
    "range checking, so St Voice -1 is all four on and St Voice 16 is all four off. A voice turned off has its " +
    "$2a cleared, and the replay skips a zero $2a everywhere -- the volume write at $5aa, and at $634 the " +
    "trigger, the DMA and the vumeter byte with it. NOTE the mask does not survive an St Play: mt_init writes " +
    "$f over it at $36c, so setting voices before starting the module is set for nobody.",
  "st channel":
    "Routine 10 ($1508). \"Returns a value of -1, if the channel c is used by CRAFT module playing system.\" " +
    "`moveq #$4,d1 / cmp.l d1,d0 / Rbcc` -- unsigned, so 0 to 3 and anything else is error 23. The bit comes " +
    "out of the low byte at $13bd of the same word St Voice writes, which is zero until the first St Play.",
  "st vumeter speed":
    "Routine 11 ($1524). \"Sets the decreasing speed of the vumeters of the current module. If the speed is set " +
    "to zero, the function =Vumeter works normally. When you use a non-zero value, it'll be subtracted from the " +
    "current value.\" `moveq #$40,d1 / cmp.l d1,d0 / Rbhi`, so 0 to 64 unsigned. The pass that spends it is the " +
    "interrupt server at $278, and it BRACKETS the tick: the four bytes at $2ee are decayed (or cleared, when " +
    "the speed is zero) in front of it and copied to `$f8(a5)` -- AMOS's own vumeter bytes, the four =Vumeter " +
    "reads and clears -- behind it. With a speed set MusiCRAFT owns them outright; with it at zero only the " +
    "bytes it has just written are copied out, which is the whole of what \"works normally\" means. The decay " +
    "runs in front of the pause test at $3c8, so a paused module's meters keep falling.",
  "st volume":
    "Routine 12 ($1538), and the help does not document it. DEFECT: the token table gives it the spec `I` -- an " +
    "instruction with no parameters -- and the routine is `move.l (a3)+,d0 / rts`, which pops one anyway. Its " +
    "other half, =St Get Volume, is four bytes of `moveq #$40,d3`, so there is no volume in this extension at " +
    "all: the pair is a stub that shipped. DEVIATION: the phantom pop moves AMOS's arithmetic-stack pointer " +
    "four bytes past whatever the last expression left, and there is no such stack here to move. What the " +
    "machine does next is not known and is not guessed at -- the keyword takes nothing and does nothing.",
  "st get volume":
    "Routine 13 ($153c): `moveq #$40,d3 / moveq #$0,d2 / rts`. A constant, not a reading, and undocumented like " +
    "the instruction it belongs to. See `st volume`.",
  "st base":
    "Routine 14 ($1542): `move.l $218(a5),d3 / addi.l #$496,d3`. \"Returns the address of the internal data zone " +
    "of the player routine\" -- which is base+$496, the first of the four channel structures St Stop walks at a " +
    "stride of $2e. The structure is ProTracker's 42 bytes with two words added, both MusiCRAFT's own: $2a is " +
    "the voice's DMA bit or zero, and $2c is the finetune already multiplied by 72. APPROXIMATED: the layout is " +
    "the machine's and complete, and sixteen fields are live because the engine holds them -- the row cell at " +
    "$0-$3, period, finetune, volume, the DMA bit, the tone-portamento pair, the vibrato and tremolo pairs, the " +
    "sample offset and the two added words. The rest are zero, and they are the ones that are ADDRESSES " +
    "(n_start, n_loopstart, n_wavestart) together with the lengths that only mean anything beside them: there " +
    "is no chip RAM here for a sample to live in, so there is no pointer to give. Reads see the mirror and " +
    "writes do not reach the replay.",
  "st version":
    "Routine 15 ($1550): `moveq #$64,d3`, in both builds. \"Returns the current version number of MusiCRAFT " +
    "multiplied by 100 (1.00=100).\" The same shape as CRAFT's own =Craft Version, and the same answer.",
  "b.swap":
    "Routines 200, 201 and 202 ($3232, $3242, $3252). \"These functions swap the upper and lower parts of a " +
    "specified segment (Byte, Word or Long word). Only the bits which are specified with the first letter of " +
    "the function are swapped\" -- so B.Swap is two nibbles of the low byte and answers a byte, W.Swap is two " +
    "bytes of the low word, and L.Swap is one `swap d3` over the whole longword.",
  "craft version":
    "Routine 199 ($322c), `moveq #$64,d3`. \"Note that the version has to be divided by 100 before it can tell " +
    "the truth, e.g. if this function returns 100, the real version is 1.00.\"",
  "y beam":
    "Routine 191 ($3164): `$dff004` read as a LONGWORD, so VPOSR and VHPOSR at once, masked $1ff00 and shifted " +
    "down eight -- V8 out of VPOSR's bit 0 and V7-0 out of VHPOSR's high byte, which is the nine-bit vertical " +
    "position. The same expression AMCAF's =Y Raster answers.",
  "open workbench":
    "The name is CONTESTED and this note covers both; each port qualifies its own, so a program gets the slot " +
    "it bound. AMCAF's is 'Tries to open the workbench again, if it has been closed previously' with AMOS's " +
    "Close Workbench, and its routine does nothing at all. CRAFT's is routine 162 ($2d9e): OpenWorkBench at " +
    "-$d2 off the IntuitionBase it finds at `-$18a6(a5)`, a base AMOS is already holding -- there is not one " +
    "library-name string in the whole CRAFT hunk. It stashes `seq` on the result in `$3c6(a5)` and nothing in " +
    "the library reads it back.",
  "extbase":
    "Routine 133 ($3c8e), 30 bytes: `lsl.w #$4,d0 / lea $f8(a5),a0 / move.l (a0,d0.w),d3` -- AMOS's extension " +
    "table, 16 bytes a slot, and this reads the base at +$0 where Extdefault reads +$4 and Extremove +$8. " +
    "DEVIATION: the VALUE is synthetic.",
  "extdefault":
    "Routine 134 ($3cac), 44 bytes.",
  "extreinit":
    "Routine 136 ($3d08), 96 bytes. DEVIATION: that entry point has no equivalent here, so what is reproduced is " +
    "what running it DOES: the extension's state as at load, through the port's `init` hook. NOTE: message 14 " +
    "cannot fire; it is the extension reporting its own reinit failed, and rebuilding a state object has no way " +
    "to",
  "extremove":
    "Routine 135 ($3cd8), 48 bytes: `movea.l $8(a0,d0.w),a1 / clr.l $8(a0,d0.w)` and then a call through it if it " +
    "was not null. 'Removes the extension in the slot from memory like when exiting AMOS', with the manual candid " +
    "about the price -- 'Otherwise, you can lose memory or even crash your computer.' NOTE: a no-op past the " +
    "bounds check, and FAITHFUL for the reason Audio Free is.",
  "coords bank":
    "TWO token entries and two routines. Routine 93 ($33d4) is eighteen bytes and reserves NOTHING: `movea.l " +
    "$168(a5),a2 / move.l (a3)+,d0 / Rjsr routine 1121 / move.l d0,$266(a2) / rts`, which resolves the bank to an " +
    "address and stores the pointer -- exactly the manual's 'the existing bank will only be switched to without " +
    "erasing it. NOTE: `move.w d2,d4 / move.l d4,d7` narrows the count to a WORD before storing it while `lsl.l " +
    "#$2,d2` sizes the Reserve from the full long, so above 65535 the two disagree in the binary too; that is " +
    "reproduced Evidence: Routine 94 ($33e6).",
  "coords read":
    "Routine 95 ($3422), 276 bytes. NOTE: because the count is written back, a second Coords Read into the same " +
    "bank is limited by the FIRST one's result rather than by the bank's capacity; reproduced. NOTE: the modelled " +
    "beam does not advance while a keyword runs, so VHPOSR returns the same value every iteration and the shuffle " +
    "is a fixed permutation where the real one is not -- reading VHPOSR is faithful, the standing-still is the " +
    "port's clock. NOTE: nothing bounds-checks the bank against its own length; the routine trusts the limit " +
    "word, and the length test in the port is the port's",
  "c2p fire":
    "NOTE: the routine reads a row either side of the buffer without checking, so the first and last rows sample " +
    "memory outside it; the port reads zero there rather than whatever the heap held. NOTE: the walk is FLAT, so " +
    "'left' and 'right' cross row boundaries. Evidence: Routine 76 ($2fa2); routine 396 ($aa92).",
  "c2p shift":
    "NOTE: `lsr.l #$2,d6` counts LONGWORDS, so a size that is not a multiple of four leaves its last one to three " +
    "bytes untouched. Evidence: Routine 77 ($2ff2).",
  "set sprite priority":
    "Routine 210 ($4f2c) is sixteen bytes and writes the CURRENT SCREEN, not a global: `move.l (a3)+,d0 / movea.l " +
    "$52c(a5),a0 / andi.w #$3f,d0 / move.w d0,$4a(a0)`. $4a is two words before the width at $4c -- BPLCON2's " +
    "PF1P0-2 and PF2P0-2 fields, the sprite-versus-playfield priority the manual means by 'Changes the sprite " +
    "priority in Dual playfield mode'. NOTE: the screen pointer is not tested, so with none open the routine " +
    "writes through null; the port drops the write. NOTE: nothing in the modelled display reads the field yet",
  "raster wait":
    "TWO token entries under the same name rather than a `!` multi-arity pair: id $0346 spec `I0` is routine 206 " +
    "($4eba) and id $0358 spec `I0,0` is routine 207 ($4ed8). Both spin on $dff004 read as a LONG with `lsr.l " +
    "#$8` for the vertical position; the two-argument form then spins on the byte at $dff007 for the horizontal, " +
    "having halved its x argument with `lsr.l #$1,d2` because VHPOSR counts colour clocks where the manual's x is " +
    "lowres pixels. d3 is the LAST argument, so `Raster Wait x,y` waits for line y at column x. DEVIATION: this " +
    "port has no beam to spin on inside a keyword -- the modelled VHPOSR only advances between statements -- so " +
    "both forms wait one frame.",
  "set ntsc":
    "Routines 208 ($4f04) and 209 ($4f18), twenty bytes each, and each does TWO things: `move.w #$0,$dff1dc.l` or " +
    "`#$20` sets BEAMCON0, and `movea.l $4.w,a0 / move.b #$3c,$212(a0)` or `#$32` sets ExecBase->VBlankFrequency " +
    "to 60 or 50. DEVIATION: only the BEAMCON0 half is reproduced. $212(a0) is a field of the real ExecBase, " +
    "which this port does not model as memory, and nothing here reads a frame rate from it -- the interpreter's " +
    "tick is its own clock.",
  "blitter busy":
    "Routine 68 ($2cce), twenty bytes: `btst.b #$6,$dff002.l` is bit 14 of DMACONR, BBUSY, and the answer is " +
    "`moveq #$ff,d3` -- which is -1, not 1 -- when set, zero when clear.",
  "vec rot precalc":
    "Routine 4 ($1f96) is 236 BYTES and it is not a no-op. Evidence: routine 373 ($84e4).",
  "vec rot x":
    "Routines 5 ($2082) and 6 ($208e) -- the three-argument form runs routine 373 ($84e4) and returns d3, the " +
    "bare form reads the cached $30c. DEFECT: the arguments reach the matrix BACKWARDS. NOTE: `divs.w` is " +
    "32-by-16 and a quotient too big for a word leaves the register untouched on the 68000 while setting V, which " +
    "nothing tests -- so a point very close to the eye reports the PREVIOUS x or y. NOTE: a rotated distance of " +
    "zero is error 23, where the port substituted 1",
  "vec rot angles":
    "Routine 3 ($1f6c): each angle is masked with `andi.w #$3ff` and then DOUBLED by `add.w d0,d0`, because it is " +
    "kept as a byte offset into the 1024-entry word sine table rather than as an angle -- a program peeking $306 " +
    "finds twice what it set. NOTE: setting an angle has no effect until the next Vec Rot Precalc; see that " +
    "keyword",
  "vec rot pos":
    "Routine 2 ($1f54), three words at $300.",
  "limit smouse":
    "Routines 168 ($4682) and 169 ($46c4), and they share NOTHING with AMCAF's other two Limit keywords -- the " +
    "port borrowed Splinters' reader for all three, and got two of the three wrong. NOTE: routine 168 loads " +
    "$52c(a5) without testing it, where both particle Limits check; with no screen open it reads through a null " +
    "pointer, and the port answers with the default 128,50 origin instead",
  "splinters fuel":
    "Routine 290 ($69be) narrows the argument to a WORD at $27e, which routine 385 copies into each respawned " +
    "splinter's +$14. NOTE: zero does not mean 'never'. The manual's 'If you set time to 0, the Splinters only " +
    "disappear at the edges of the screen' describes what a zero fuel looks like once the coordinate list is " +
    "spent -- every splinter dies at once and stays dead -- rather than unlimited life, which is how an earlier " +
    "pass read it",
  "splinters init":
    "Routine 295 ($6a60) is THIRTY-SIX BYTES and reads nothing: `movea.l $26a(a2),a0 / Rbeq routine 390 / move.w " +
    "$280(a2),d7 / moveq #$ff,d0 / lea $10(a0),a0` then `move.l d0,(a0) / lea $16(a0),a0 / dbra d7`. The manual's " +
    "'the Splinters are fed with the coordinates and speeds you specified' describes the ENGINE: feeding happens " +
    "one splinter at a time in routine 385, when a Move finds one free, dead or out of bounds.",
  "splinters move":
    "Routine 300 ($6c32) is the loop -- table at $26a, count at $280, coordinate bank at $266 with a missing one " +
    "error 23, the Splinters Max allowance from $282, and VHPOSR into d6 -- calling routine 386 ($a904) once per " +
    "record. 386 shifts the generations first (`move.l $4(a0),$8(a0) / move.b $11(a0),$12(a0)`), ALWAYS, then: a " +
    "free splinter (+$10 = $ff) goes to routine 385 to respawn; a fresh one (+$13 set) sits still for one step; " +
    "an exhausted one (+$14 = 0) respawns; otherwise `add.w $c(a0),d2` moves it and `add.w d2,$c(a0)` adds the " +
    "gravity afterwards. NOTE: the beam retry is bounded at 64 attempts here. NOTE: routine 300 loads $52c(a5) " +
    "and never tests it, so with no screen open routine 386 reads through a null pointer; error 47 stands in for " +
    "the bus error",
  "splinters back":
    "Routine 301 ($6c74) does TWO jobs. That is the engine's premise, 'they don't destroy the background and use " +
    "the colour of the pixel they have removed': the colour is not in the coordinate bank and nothing else " +
    "supplies it, which is why the manual insists Back comes before Draw",
  "splinters draw":
    "Routine 302 ($6ce2) writes +$10 at the flat index +$4, skipping any splinter marked free.",
  "splinters single del":
    "Routines 298 ($6aa4) and 299 ($6b66) are two passes each. The second is the HOLE, which nothing in the " +
    "manual prepares you for -- a splinter lifted its colour off the picture, so where it came from is filled " +
    "with $27b, the byte Splinters Colour stored, once on the first Del after the spawn.",
  "splinters single do":
    "Routines 296 ($6a84) and 297 ($6a94) are sixteen bytes each: `Rbsr routine 298`/`Rbsr routine 299`, then " +
    "`Rbsr routine 300` (move), `Rbsr routine 301` (back) and `Rbra routine 302` (draw). FOUR steps, exactly what " +
    "the manual tells a caller doing it by hand.",
  "splinters active":
    "Routine 303 ($6d4a) counts a splinter unless ALL THREE colour bytes are $ff: `moveq #$ff,d0` leaves d0.w = " +
    "$ffff, `cmp.w $10(a0),d0` covers +$10 and +$11 at once, then `cmp.b $12(a0),d0`.",
  "splinters limit":
    "TWO routines behind one `!` token entry: 291 ($69ca) bare and 292 ($69f4) with four corners. NOTE: the " +
    "private block arrives from `AllocMem #$10001` -- MEMF_CLEAR -- so before any call the box is 0,0 To 0,0, " +
    "which routine 386 treats as nowhere.",
  "splinters max":
    "Routine 289 ($69b2) narrows the argument to a WORD at $282. The manual's -1 for no limit works only because " +
    "-1 narrows to $ffff, which is 65535 spawns rather than infinity",
  "splinters gravity":
    "Routine 293 ($6a26) stores the pair RAW at $276/$278. NOTE: the speeds it is added to are in sixteenths of a " +
    "pixel -- routine 386's `add.w $c(a0),d2` where d2 is the x<<4 position -- so `Splinters Gravity 1,1` is a " +
    "sixteenth of a pixel per step per step, sixteen times gentler than the whole-pixel arithmetic an earlier " +
    "pass used.",
  "td stars bank":
    "'Each star consumes 12 bytes of memory.' Td Stars DO destroy the background, which is why the manual pairs " +
    "Draw with a matching Del rather than saving anything -- the opposite of Splinters",
  "td stars limit":
    "Routines 305 ($6dba) bare and 306 ($6df2) with four corners, the SIXTY-FOURTHS twin of Splinters Limit -- " +
    "`lsl.w #$6` where Splinters uses 4, the same `subq` on the high pair making the far corner exclusive, and " +
    "the same unsigned `cmp.w`/`exg.l` normalising. 'These coordinates must lie WITHIN the screen dimensions, " +
    "otherwise the stars could corrupt your memory': DEVIATION, they cannot here, because tdStarPoke drops an " +
    "offset outside the planes. DEFECT: both forms also overwrite the ORIGIN and nothing documents it -- routine " +
    "305 stores a LONGWORD at $256, exactly where Td Stars Origin (307) puts its pair -- and the explicit form " +
    "computes that centre as `add.w d1,d0 / lsr.w #$1,d0` and `add.w d3,d2 / lsr.w #$1,d2`, which averages x1 " +
    "with y1 and x2 with y2, MIXING THE AXES.",
  "td stars init":
    "Routine 308 ($6e46), and 'the stars are moved by random values to avoid that they all start in the origin' " +
    "is LITERAL: `Rbsr routine 387` spawns the star at the origin, `clr.l $4(a0)` gives it no previous position, " +
    "and `add.w (a1),d5 / andi.w #$1f,d5` then `Rbsr routine 388 / dbra d5` runs it forward 0 to 31 steps with " +
    "the SAME move routine Td Stars Move uses. NOTE: d5 is never initialised before the first star, so `add.w " +
    "(a1),d5` reads whatever the interpreter left; `andi.w #$1f` bounds it to 0..31 either way and every later " +
    "star is deterministic. NOTE: the beam retry in 387 is bounded at 64 attempts here, for the same reason as " +
    "the Splinters spawn -- the modelled beam stands still inside a keyword",
  "td stars move":
    "Routines 317 ($6fd4) for the whole table and 318 ($6ffc) for one, both over routine 388 ($a9be). 388 saves " +
    "the previous position with `move.l (a0),$4(a0)` -- which is all Double Del needs -- then adds the speed, " +
    "clips against $24e..$254 with `bcs`/`bcc`, UNSIGNED where the Splinters engine's clip is signed, and adds " +
    "the gravity AFTER the move. DEFECT: the indexed form's stride is wrong.",
  "td stars draw":
    "Routine 319 ($7026), and a star's BRIGHTNESS is its speed: `move.w $8(a0),d3 / bpl / neg.w d3` and the same " +
    "for $a, `add.w d4,d3 / lsr.w #$6,d3` for whole pixels a step, then `cmp.w #$3,d3 / bge` sets both named " +
    "planes, `cmp.w #$2,d3 / bge` sets plane B alone, and anything slower sets plane A alone. NOTE: the address " +
    "is a BYTE offset built as `(y>>6) * ($4c(a1)>>3) + ((x>>6)>>3)`, so the row stride is the screen WIDTH in " +
    "bytes rather than the BitMap's bytesPerRow; the two agree for every AMOS screen and the port reproduces the " +
    "routine's arithmetic rather than the BitMap's",
  "td stars single del":
    "Routines 315 ($6efe) and 316 ($6f68).",
  "td stars single do":
    "Routines 313 ($6ee6) and 314 ($6ef2), twelve bytes each: `Rbsr routine 315`/`Rbsr routine 316`, then `Rbsr " +
    "routine 317` (move) and `Rbra routine 319` (draw).",
  "td stars planes":
    "Routine 312 ($6ea6) takes TWO plane numbers, not a count -- token spec `I0,0` -- and its opening depth check " +
    "is the clearest use of AMCAF's own message table anywhere in the extension: `cmp.w #$2,d0 / bge` else `moveq " +
    "#$f,d0 / Rbra routine 397`, and message fifteen is 'At least 4 colours required in screen'.",
  "td stars origin":
    "Routine 307 ($6e30) shifts both arguments into SIXTY-FOURTHS (`lsl.w #$6`) and stores them at $256/$258, " +
    "which routine 387 then copies into a new star with a single `move.l`. NOTE: Td Stars Limit overwrites both " +
    "-- see its own entry",
  "td stars gravity":
    "Routine 309 ($6e80) stores the pair RAW at $25a/$25c. NOTE: like Splinters Gravity, the speeds it is added " +
    "to are in the engine's own fixed point, so the unit is a SIXTY-FOURTH of a pixel per step per step",
  "td stars accelerate on":
    "Routines 310 ($6e92) and 311 ($6e9c), 'if the stars are to be accelerated'. NOTE: the pair is asymmetric -- " +
    "On is `st.b $25e(a2)`, which writes $ff to the HIGH byte of the word, and Off is `clr.w $25e(a2)`, which " +
    "clears both.",
  "pix shift up":
    "Routines 226/227 (Shift Up), 228/229 (Shift Down), 230/231 (Brighten) and 232/233 (Darken), each a pair with " +
    "and without the mask bank. Shift WRAPS within that range where Brighten and Darken stop at its ends, and the " +
    "manual introduces the family as the slower, limitable alternative to Shade Bobs, which 'cannot limit the " +
    "colours to a certain range but only the amount of bitplanes'. NOTE: c1 and c2 are stored as BYTES (`move.b " +
    "d1,(a7)`, `move.b d2,$2(a7)`), so a colour above 255 wraps into range. NOTE: the two range comparisons are " +
    "not the same kind, `bmi` against c1 being signed and `bhi` against c2 unsigned, which cannot be told apart " +
    "within the 0..63 of real colours. NOTE: a degenerate box does not error -- the subq underflows to $ffff and " +
    "the dbra runs 65536 times, the same runaway Bzoom has; doing nothing is this port's answer",
  "pptodisk":
    "Routines 235 ($59e4) and 234 ($58d2). *'crunches and saves the bank numbered bank into the file file$ using " +
    "the PowerPacker algorithm'*, and *'Sorry for the name Pptodisk but Ppsave has already been used by AMOS.'* " +
    "235 is three instructions -- `moveq #$4,d0 / move.l d0,-(a3) / Rbra routine 234` -- so the DEFAULT " +
    "EFFICIENCY IS 4, the manual's 'best, but slow', not 0. 234 frees any buffer a previous call left (routine " +
    "354: FreeMem($364(a2), $368(a2))), opens powerpacker.library VERSION 35 (routine 368, failing to message 5 " +
    "'No powerpacker.library'), pops its three arguments and immediately pushes the efficiency back as scratch, " +
    "resolves the bank, and refuses one with either type bit set -- `move.w -$c(a0),d0 / andi.w #$c,d0` -- with " +
    "message 4, 'No icons- or spritesbanks allowed'. NOTE: the efficiency is accepted and does not change the " +
    "output. NOTE: message 5 cannot fire, because the PP20 codec is ours (src/amiga/powerpacker.ts) and so " +
    "powerpacker.library is never absent, where on the machine it is a separate file a program may be running " +
    "without Source: +Equ.s:1867-8.",
  "launch":
    "Routines 209 (1.40) and 221/222 ($512e/$513a): `Launch file$[,stacksize]`, and it starts an AmigaDOS binary " +
    "as its own process. 221 pushes the default stack -- `move.w #$1000,d0`, 4096 -- and 222 does `jsr -$96(a6)` " +
    "LoadSeg, `Rbeq routine 391` on failure, then `jsr -$8a(a6)` CreateProc(name, 0, segList, stackSize), and on " +
    "failure `jsr -$9c(a6)` UnLoadSeg followed by `moveq #$b,d0 / Rbra routine 397`, message 11 'Couldn't launch " +
    "process'. NOTE: nothing in this port can start a process, so a real binary always reaches the second failure " +
    "-- which is the branch the routine itself takes when CreateProc returns NULL, out of memory on the machine, " +
    "rather than a stub. NOTE: on success the routine never UnLoadSegs, leaving the segment to the process it " +
    "started; nothing to reproduce while nothing starts",
  "exec":
    "Exec \"command\" — InExec (+Lib.s:3392), source tier and complete. NOTE: nothing in this port can run a " +
    "command, so Execute always answers DOSFALSE and this always raises error 87 -- which is the branch the " +
    "routine itself takes for a command that does not exist, and on a machine with no shell every command is one. " +
    "Source: +Lib.s:3677.",
  "lexecute":
    "A=Lexecute(\"programname\") — routine 51 ($3630), twelve instructions. The manual: *'A will be True if " +
    "successful, False otherwise'*, and *'The program to be run can not use any CLI-I/O'* -- which is what those " +
    "two zeroes mean. NOTE: the copy is unbounded, so on the machine a long enough name overruns the block; there " +
    "is nothing to reproduce where a string is a string. NOTE: with no host process capability Execute answers " +
    "DOSFALSE, so this returns 0 -- 'False otherwise', the documented answer for a program that would not start",
  "lrun":
    "A=Lrun(\"commands\",\"WINDOW\") — routine 50 ($33ca), and it is a script runner rather than a single command. It " +
    "allocates a signal, finds its task and AddPorts a port named \"ldos\"; builds `\"NewCli \" + window + \" from " +
    "t:ld.t\"` contiguously from $3502; opens `t:ld.t` with mode 1006, writes the commands, then writes the " +
    "twenty-four bytes at $359f -- **\"t:sig_ldos\\nEndCli >NIL:\\n\"**, which is the *'Ldos will automatically " +
    "append this'* the manual promises; writes a second file `t:sig_ldos`; Executes the NewCli line with both " +
    "handles zero; and finally WaitPort/GetMsg/FreeSignal/RemPort. That is why the manual demands c:Run, " +
    "c:NewCli, c:EndCli and an assigned t:. DEFECT: the return value is meaningless -- the last call before `rts` " +
    "is RemPort, which returns nothing, and `move.l d0,d3` hands whatever it left back. The manual knows: *'A " +
    "will contain any number (see Technote below)'*. DEVIATION: `t:sig_ldos` is not written. DEVIATION: it does " +
    "not block. WaitPort waits for that helper, and with no CLI started nothing ever signals, so reproducing it " +
    "would hang the interpreter -- the same hang the manual warns of when a command fails and *'the " +
    "Shell/CLI-window will never be closed'*",
  "reset computer":
    "Routine 203 in 1.40, 215 ($4ff0) in 1.50, and it reboots two different ways: `Rbsr routine 372` reads exec's " +
    "LIB_VERSION and `cmp.w #$25,d0` sends Kickstart 37+ to `jmp -$2d6(a6)`, ColdReboot, while below 37 it goes " +
    "Supervisor (`jmp -$1e(a6)`) and hand-rolls it -- `lea $1000000,a0 / suba.l -$14(a0),a0` backs off by the ROM " +
    "size stored at $FFFFEC, `movea.l $4(a0),a0` takes the ROM's initial PC, then `reset / jmp (a0)`. NOTE: a " +
    "program that resets is counted as having ENDED rather than crashed, which is what it did; the census would " +
    "otherwise report every one as a failure. NOTE: the web player carries the reset out by rebuilding the " +
    "environment and KEEPING the filesystem, because a reset clears memory and not disks -- and cold and warm do " +
    "the same thing there, since this port has no reset-survivable RAM for a warm boot to preserve. Source: " +
    "+ILib.s:1849.",
  "turbo text":
    "Routines 343 ($762a), 344 ($7630) and 345 ($7638), and the Guide does not mention this keyword ANYWHERE -- " +
    "no node, no command list, not even the changelog that at least named the transition family. DEFECT: the " +
    "per-plane decomposition is wrong in two of its four cases. DEFECT: the clip subtracts without checking the " +
    "sign, so an x at or past the right edge makes the count negative and `dbra` counts down from 65535, poking " +
    "tens of thousands of characters past the bitplanes. NOT REPRODUCED -- nothing is drawn. NOTE: the fourth " +
    "argument is dead. NOTE: it walks EcLogic, the plane pointers at offset 0, where COut uses EcCurrent ($30); " +
    "on a double-buffered screen those differ Source: +W.s:15646; +Equ.s:507; +Equ.s:686.",
  "change print font":
    "Routine 141 ($400c), and at 22 bytes the whole keyword is one store: `Rjsr routine 1121` for the bank " +
    "address, then `movea.l $52c(a5),a1 / movea.l $aa(a1),a1 / move.l a0,$8(a1)` -- the current screen, its " +
    "EcWindow (+Equ.s:507), and WiFont (+Equ.s:686), the charset AMOS's console prints with. The manual's " +
    "*'always 8x8 pixels big and contains 256 characters ... a memory bank of exactly 2 KB'* is exactly how COut " +
    "reads it, `lsl.w #3,d1 / move.l WiFont(a5),a2 / add.w d1,a2` (+W.s:15661) -- indexed by the raw byte, no " +
    "LoChar and no control-code exception. NOTE: nothing is checked -- not the 2KB, not the screen pointer. " +
    "Source: +W.s:13702.",
  "make bank font":
    "Routine 139 ($3e78), 246 bytes. *'you can store any amiga font in a memory bank'*, and the font is `movea.l " +
    "$52c(a5),a0 / movea.l $148(a0),a0 / movea.l $34(a0),a2` -- screen, Ec_RastPort, rp_Font. DEVIATION: with no " +
    "Change Font done, rp_Font on the machine is whatever the screen opened with -- topaz in practice -- and this " +
    "port has no copy of topaz unless the program's own disk carries one, so a null rp_Font serialises the " +
    "interpreter's built-in 8x8 face instead: same YSize and XSize, different glyphs. NOTE: the thirty name bytes " +
    "are usually blank, because ln_Name points at dfh_Name in the loadable size file and all eight fonts on the " +
    "original partition leave that field zero -- the name a program asks by lives in the .font DESCRIPTOR. NOTE: " +
    "neither $52c(a5) nor $34(a0) is tested before it is followed, so on the machine a program with no screen " +
    "open dereferences null twice; here that is error 23. NOTE: four copied TextFont fields are not modelled and " +
    "are written as zero -- ln_Type, ln_Pri, mn_ReplyPort and mn_Length -- and routine 140 clears two of them on " +
    "the way back in",
  "change bank font":
    "Routine 140 ($3f6e), 158 bytes. NOTE: unlike Change Font this one never tests $52c(a5), so with no screen " +
    "open the machine follows a null pointer; here it is error 23",
  "change font":
    "Routines 142 ($4022), 143 ($402a) and 144 ($4030) -- two one-line trampolines pushing the defaults, `moveq " +
    "#$8,d0` for the height and `clr.l -(a3)` for the style, then the worker. 144 is graphics.library and " +
    "diskfont.library and nothing else: CloseFont on the RastPort's current face (`jsr -$4e(a6)`), a TextAttr " +
    "built at $422(a2) with ta_YSize, ta_Style and `ta_Flags = FPF_DISKFONT`, OpenLibrary (`jsr -$228(a6)`) " +
    "cached at $374(a2), OpenDiskFont (`jsr -$1e(a6)`) and SetFont (`jsr -$42(a6)`). NOTE: message 9 cannot fire " +
    "here, because diskfont.library is modelled and so never absent, where the real one is a 51,200-byte file on " +
    "the Fonts disk a program could genuinely be running without. NOTE: `style` is stored into ta_Style and then " +
    "weighed inside OpenDiskFont, which will accept a near miss; this port's openDiskFont matches on the SIZE " +
    "alone, so the style is parsed, bounded and ignored",
  "ppfromdisk":
    "Routine 237 ($5a80), 256 bytes, is a universal loader and not a PowerPacker one. It opens the file (routine " +
    "357, failing to 391, error 81), takes its size (359) and reads EIGHT bytes (360, failing to 392 after a " +
    "close), then branches four ways on the signature: 'PP20' takes the AllocMem-and-decrunch path, 'PX20' is " +
    "requester 7, 'IMP!' is `Rbra routine 138`, Imploder Load, and anything else is `Rbra routine 104`, Wload -- " +
    "so the manual's 'a file that is not PowerPacked is taken as it is' is literally a hand-off to another " +
    "keyword, each arm closing the file first with routine 362 and letting the other one reopen it. DEVIATION: " +
    "the 'IMP!' arm cannot be reproduced.",
  "object name$":
    "Routine 114 ($3b20) is sixteen bytes and reads a FIXED offset: `lea $108(a2),a0 / moveq #$2,d2 / Rbsr " +
    "routine 366`, so $108 is fib_FileName eight bytes into the cached FileInfoBlock at $100 -- the accessors " +
    "read whatever Examine Object last described and never take a path of their own",
  "object date":
    "Routine 122 ($3b74) is twelve bytes: `move.l $184(a2),d3`. $184 less the FIB's own $100 is $84, 132, which " +
    "is fib_Date.ds_Days",
  "object time":
    "Routine 124 ($3b88) is twenty bytes and packs TWO fields into one long: `lea $18a(a2),a0 / move.w (a0),d3 / " +
    "swap d3 / move.w $4(a0),d3`. $18a is 138, the LOW WORD of ds_Minute, and $4 past it is 142, the low word of " +
    "ds_Tick -- so both are truncated to words and the high halves are thrown away",
  "rgb to rrggbb":
    "Routine 91 ($3304), 50 bytes, and the pair is asymmetric in the way that matters: it puts each 4-bit gun in " +
    "the HIGH nibble of its byte and leaves the low nibble ZERO.",
  "rrggbb to rgb":
    "Routine 90 ($32e2), 34 bytes.",
  "io error":
    "Routine 172 ($4740) is eighteen bytes around one call, `movea.l $2b8(a5),a6 / jsr -$84(a6)`, which is " +
    "dos.library IoErr().",
  "bcircle":
    "NOTE: the row stride is `$4c(a2) >> 3`, the screen's WIDTH rather than the BitMap's bytesPerRow, and " +
    "`(a1,d1.w)` indexes it with a WORD -- which is what the string '32K-LIMIT!' sitting at $7ea2 immediately " +
    "after the code is about. NOTE: the Newton loop has no bound of its own; the sixty-four-step guard is this " +
    "port's, and it never bites Evidence: Routine 353 ($7dd4).",
  "disk type":
    "Routine 100 ($3694), 114 bytes, walks the real DosList: `$2b8(a5)` is DOSBase, `$22` its dl_Root, `$18` the " +
    "RootNode's rn_Info, `$4` the DosInfo's di_DevInfo, each a BPTR turned into a pointer by `adda.l a1,a1` " +
    "twice, and `move.l $4(a1),d3` off the matching entry is dol_Type verbatim -- 0 a device, 1 an assign, 2 a " +
    "volume.",
  "disk state":
    "Routine 101 ($3706) truncates at the colon exactly as Disk Type does and then does the real three-call " +
    "dance: `Lock(name, -2)` at `-$54` with `moveq #$fe,d2` for SHARED_LOCK, `Info(lock, $168(a5))` at `-$72` " +
    "into the extension block's own first bytes, and `UnLock` at `-$5a`. A failed Lock is routine 391 (error 81) " +
    "and a failed Info routine 392 (error 94). The manual reserves -1 for a drive with no disk -- 'If no disk is in the drive, it " +
    "normally should return -1, but I'm afraid...'. NOTE: nothing modelled here is write protected, " +
    "mid-validation or in use, so a volume that resolves answers 0.",
  "io error$":
    "Routine 173 is a four-byte `Rbra routine 383`, and 383 ($a508) opens with a Kickstart check -- `Rbsr routine " +
    "372` is `movea.l $4.w,a0 / move.w $14(a0),d0`, exec.library's LIB_VERSION, against `cmp.w #$25,d0`. " +
    "DEVIATION: the modelled machine is a Kickstart 3 A1200, so the real routine takes the Fault() arm and " +
    "dos.library's wording would win where the two differ. NOTE: the table omits codes dos.library has, 206 among " +
    "them, and both arms answer the empty string for anything they do not know -- 'If no error number exists, an " +
    "empty string will be returned'",
  "ppunpack":
    "Routine 236 ($59ec), 148 bytes, takes BANK NUMBERS and not addresses: `Rjsr routine 1121` resolves the " +
    "source and `Rjsr routine 1103` RESERVES the destination, with the name 'Work ' sitting at $5a78 immediately " +
    "after the code. NOTE: the kind bits live in the bank header twelve bytes below the data, which this port has " +
    "no equivalent of, so banks 1 and 2 stand in for the sprite and icon banks by AMOS convention",
  "exchange bob":
    "Routines 212 ($4f44) and 213 ($4f8c) are the same 72 bytes apart from the bank they fetch, 1101 against " +
    "1102. NOTE: the bound is `cmp.w d2,d0 / Rbhi routine 390` against the image count, an UNSIGNED compare, so " +
    "image 0 passes it and then `subq.w #$1,d0 / lsl.w #$3,d0` indexes eight bytes BELOW the table -- the count " +
    "word and whatever precedes it.",
  "command name$":
    "Routine 340 ($752c) asks three sources in order. DEVIATION: nothing here records the file a program was " +
    "loaded from under a name the program itself could have used, so all three sources are empty and this answers " +
    "empty -- the same nothing Tool Types$ gives, which keeps the pair consistent",
  "convert grey":
    "Routine 79 is a four-byte `Rbra routine 356`; 356 ($7f10) is 690 bytes. NOTE: the sum can index past the " +
    "ramp's 192 bytes -- a destination deeper than six planes reads whatever follows $21b2 in the extension " +
    "block.",
  "shade bob planes":
    "'amount sets the number of bitplanes, that should be drawn in and must be a value between 1 and 6' -- the " +
    "range is the routine's, and it is how a program protects the graphics in the higher planes from a shade bob. " +
    "NOTE: routine 384 ($a7c6) LOWERS it again at draw time, walking the screen's plane pointers for the first " +
    "NULL and doing `addq.w #$1,d0 / sub.w d0,$286(a2)`, so a setting of six on a three-plane screen shades " +
    "three.",
  "shade bob up":
    "Routines 286 ($6644) and 287 ($67e2), 414 and 410 bytes, sharing routine 384 ($a7c6) for their set-up. " +
    "DEFECT: the hot spot X is truncated to a signed byte and the hot spot Y is not. NOTE: clipping is by whole " +
    "words left and right and whole rows top and bottom, with a barrel shift at $67a0 for an x that is not a " +
    "multiple of 16 -- the net effect is an exact clip to the screen, so `point`/`putPixel` give it without the " +
    "shifter. NOTE: neither the RastPort clip nor Set Planes is consulted, the routine walking the screen's plane " +
    "pointers itself, which is why this is the one drawing keyword here built on `putPixel` rather than `plot`",
  "shade bob mask":
    "Routine 284 ($6610) normalises to 0 or 1 rather than storing the argument, so any non-zero value means the " +
    "same thing. NOTE: the mask arm falls back.",
  "ptile bank":
    "Kept for the manual's own assessment of the feature, which is unusually candid: 'Actually, you should not " +
    "read this command description.",
  "count pixels":
    "Routine 92 ($3336), 158 bytes. Note the sense, which the manual states and the name hides: it 'Counts the " +
    "pixels ... that DON'T have the colour index colour'. NOTE: the routine has no clipping whatever -- it walks " +
    "plane memory from `y1 * ($4c >> 3)` with no test against the screen, so a region off the edge counts " +
    "whatever is next in memory; skipping out-of-range points is the port's, not the routine's. NOTE: a screen " +
    "number that does not resolve fails inside `L_GetEc`, which raises AMOS's own screen error rather than the 23 " +
    "the port raises here; the distinction is unverified and shares the standing question about $52c(a5) error " +
    "numbers",
  "mask copy":
    "THREE token entries and three routines. DEVIATION: a minterm other than $E0 is not reproduced -- which of A, " +
    "B and C carries the mask, the source and the destination is decided inside BltMaskBitMapRastPort, not in " +
    "this binary, and the AROS material available here is a partial checkout with no rom/graphics sources, so " +
    "there is nothing to verify a general minterm against; the $E0 behaviour is implemented for every value. " +
    "NOTE: `maskaddress` is a raw pointer into a caller-built bitplane; where it resolves to memory this port can " +
    "read the mask is honoured, and where it does not the copy is unmasked -- the same picture an all-ones mask " +
    "gives. Evidence: Routine 174 ($4756).",
  "bzoom":
    "Routine 352 ($7b56), 638 bytes. The rounding is the blitter showing through and the manual spells it out: " +
    "'The coordinates x1 and x2 are rounded down to the next multiple of eight, x3 is even rounded to the nearest " +
    "multiple of 16'. DEVIATION: those same `subq`s are why a degenerate box does not error -- a zero extent " +
    "underflows to $ffff and the dbra runs 65536 times, scribbling far past both bitmaps. NOTE: the masks are " +
    "`andi.w`, clearing the low bits of the WORD and leaving the high word, so they are `& 0xff8` and `& 0xff0` " +
    "rather than `& ~7` and `& ~15` -- which differ for a negative coordinate, where -8 becomes 4088. NOTE: the " +
    "plane count is `move.w $50(a0),$334(a2)` off the SOURCE and six plane pointers are loaded for each screen " +
    "regardless, so a destination shallower than the source is written past the end of its planes; the port masks " +
    "to the source's depth instead, which also preserves a deeper destination's upper planes as the routine does.",
  "c2p convert":
    "Routine 78 ($3036) is a 66-byte front-end; routine 382 ($9d0c) is 2044 bytes of converter. NOTE: the 68020 " +
    "gate cannot fire here, because the modelled machine is an A1200 and Cpu answers 68020 for the same reason. " +
    "NOTE: `oy` is never range-checked and `ox` is added to the row offset after the width check, so the real " +
    "routine runs off the end of the bitmap or into the following row; the port's bounds test is the port's, not " +
    "the routine's",
  "blitter fill":
    "Routine 74, and the manual is the specification of the chip's area-fill mode: 'It does only fill the gap " +
    "between two dots of a horizontal line. Evidence: Routine 75 ($2e5c).",
  "x raster":
    "'This function returns the current X position of the raster beam in hardware coordinates.' The manual is " +
    "candid about the value: 'This value is not very accurate because the raster beam is very fast, sigh'",
  "scrn rastport":
    "Routines 279 to 283 are the same eighteen-byte routine five times: the current screen from $52c(a5), `Rbeq " +
    "routine 394` when it is null, then one fixed offset and nothing else -- RastPort $148, BitMap $150, " +
    "LayerInfo $140, Layer $144, Region $14c. NOTE: this port has a RastPort and a BitMap as objects rather than " +
    "bytes at an address, and models no Layer or LayerInfo at all. Returning a plausible pointer would invite " +
    "exactly the poking the manual warns about, into memory whose layout is not the machine's, so these answer 0 " +
    "-- which a program checking before use reads as 'not available'. APPROXIMATED in the value. NOTE: the " +
    "`amcafScreenErr` written for these is therefore unreachable as things stand, and whether the core's " +
    "closed-screen error should become error 47 here is unsettled -- it needs the core's screen accessor looked " +
    "at, since every extension reading $52c(a5) has the same question",
  "ham colour":
    "Routine 161 ($440a), 82 bytes. That is why the manual describes it as 'the colour value that is created, " +
    "when plotting a pixel in colour c directly behind the last point'. NOTE: only the palette arm touches the " +
    "screen, guarded by `Rbeq routine 394` (error 47); that guard is not reachable here because reading the " +
    "current screen raises the core's own error first, the same unsettled question as the Scrn pointers",
  "ham best":
    "Routine 162 ($445c), 318 bytes. NOTE: that shortcut is `move.l d6,d3` narrowed by word operations, so it is " +
    "the one path that leaks the argument's high word into the result; and the routine reads $52c(a5) with no " +
    "guard, so the port's fallback palette is unreachable for the same reason as Ham Colour's",
  "ham point":
    "Routine 160 ($4312), 248 bytes. DEVIATION: the manual says 'If the point x,y is not on the screen, rgb will " +
    "contain -1' and it does not -- both guards land on the same three instructions, `moveq #$0,d3 / move.w " +
    "(a0),d3 / moveq #$0,d2 / rts` with a0 = $62(a1), so an off-screen read answers the RGB of palette entry 0. " +
    "There is no -1 anywhere in the routine; on a screen whose colour 0 is black it reads as 0, which is " +
    "presumably how the manual's claim survived. NOTE: two " +
    "things are deliberately not reproduced.",
  "ham fade out":
    "Routine 163 ($459a), 156 bytes. After calling it 16 times, the Ham screen is completely black.' The manual " +
    "explains the asymmetry: 'Technically, it's not possible to fade in a ham screen without enormous processor " +
    "power, but for fading out, a modified Shade Bobs routine is' enough -- darkening is monotone and needs no " +
    "search. Fading only the palette leaves every modify pixel at its original brightness, so the manual's " +
    "sixteen-calls-to-black would not have held on a picture that uses any. NOTE: the bitmap walk is a flat " +
    "longword count, `(($4c(a0) >> 5) * $4e(a0))`, so on a screen whose width is not a multiple of 32 it covers " +
    "less than the bitmap and drifts out of step with the rows; that is reproduced as-is, since a plane's pixel " +
    "order is the chunky cache's pixel order while the row length is a whole number of bytes",
  "set rain colour":
    "Changes a rainbow's colour index, which 'remove[s] the irretating limit to the first 16 colours'. DEVIATION: " +
    "the manual's other use -- 'A colour index of -63 enables you to alter the hardware scrolling register, so " +
    "you can create fancy water and wobbel effects' -- is a copper poke at a register this port reaches through " +
    "the display list rather than by address, so the index is stored and the scroll case is not reproduced",
  "pt continue":
    "Routine 266 ($616e) is stricter than the port had it: `move.l $2bc(a2),d0 / Rbeq routine 390` makes " +
    "continuing with nothing ever played an ERROR rather than a no-op, which matters because Pt Stop -- its " +
    "counterpart -- deliberately IS a no-op, a fix the changelog records. It then does `cmp.l #$200000,d0 / Rbge " +
    "routine 390`, Pt Bank's chip-RAM check again, carrying the same DEVIATION: this port models memory type as a " +
    "flag on the bank rather than as an address, so that comparison is not reproduced.",
  "pt voice":
    "Routine 262 ($60a2) sets all four per-voice bytes to $FF first (`moveq #$ff,d1 / move.l d1,$a(a0)`) and then " +
    "CLEARS the ones whose mask bit is clear, silencing each with `move.w #bit,$96(a1)` on DMACON and `clr.w` on " +
    "that voice's AUDxVOL at $a8/$b8/$c8/$d8.",
  "jd star joker on":
    "Routines 11 ($2ba) and 12 ($2ca), sixteen bytes each: `movea.l $2b8(a5),a0` for DOSBase, `movea.l " +
    "$22(a0),a0` for dl_Root, then `bset.b #$18,$34(a0)` -- rn_Flags bit 24, RNF_WILDSTAR -- with `bclr` for Off. " +
    "NOTE: this is AmigaDOS's GLOBAL flag and not the extension's own, so it lives on Machine here and LDos's " +
    "Lmatch reads the same field; a program that turns the star on for Jd Match turns it on for every pattern " +
    "parse on the machine, which is what one RootNode means.",
  "scanstr$":
    "Routine 278 (\\$63c8) reads a table of 105 NUL-terminated strings at \\$63f8..\\$65b6 -- the extension's own " +
    "data, now extracted rather than invented. DEFECT: ten codes have an EMPTY entry (12, 14, 28, 44, 59, 71, 72, " +
    "73, 75, 104) and the routine refuses them with `tst.b (a0) / Rbeq routine 390`, AMOS error 23, where the " +
    "manual promises an empty string for a code with no name; the library contradicts its documentation and this " +
    "port follows the library.",
  "rnp":
    "The dead half of the RNC pair -- the author removed the two commands, put them back, and removed them again, " +
    "but the tokens had to stay because deleting one shifts every later token id. 1.50's routine 277 (\\$63c6) is " +
    "a bare `rts`: no prologue, no body, so it hands the caller whatever the result register happened to hold at " +
    "the call. 1.40's routine 263 (\\$64f2) is the same behind the shareware guard, `tst.w -\\$16(a5) / Rbmi " +
    "routine 144`, and that arm is a `moveq #\\$0,d0` -- so an unregistered 1.40 answers 0 and everything else " +
    "answers a stale register. DEVIATION: this port answers 0 always, which is 1.40's demo path exactly and the " +
    "only defined value available for the other case.",
  "amcaf version$":
    "DEVIATION: one body of code serves both releases here and the token tables carry no registry id, so this " +
    "cannot tell which was bound and answers with 1.50's.",
  "smouse speed":
    "Routine 170 ($46e2) is not a plain store. Nothing bounds the value, so the manual's 'higher values than 4 " +
    "are not sensible' is advice rather than a check. NOTE: no test pins the rescale, because nothing in a " +
    "headless run moves a second mouse and zero rescales to zero",
  "splinters bank":
    "Routines 288 ($697c) and 304 ($6d84) are twins.",
  "splinters colour":
    "Routine 294 ($6a38): the plane count is bounded against the CURRENT SCREEN rather than against six.",
  "shade pix":
    "Routine 223 ($5180) is EIGHT BYTES -- `moveq #$6,d0 / move.l d0,-(a3)` and a branch into routine 224 -- so " +
    "the plane count is a hardcoded SIX, not Shade Bob Planes and not an argument. The manual's 'if the highest " +
    "colour is reached, the colour is resetted to be cycled' falls out of that, and so does the early stop -- " +
    "`move.l a0,d0 / beq` bails on a null plane pointer, so a screen with fewer than six planes carries only as " +
    "far as it has",
  "paste ptile":
    "NOTE: the count check is `Rbge`, which is SIGNED, so a negative tile number passes it and indexes backwards " +
    "out of the bank. The manual's own view of the feature is worth keeping: 'Actually, you should not read this " +
    "command description. Evidence: Routine 270 ($61e0).",
  "fcircle":
    "Routine 350 ($7afa) is TEN BYTES: `move.l (a3),-(a3)` to duplicate the radius on the argument stack, then " +
    "straight into Fellipse (351).",
  "turbo plot":
    "Routine 348 ($7a16). NOTE: the row stride is `lsr.w #$3` of the WIDTH, truncating where a real BitMap rounds " +
    "up to a word; every AMOS screen is a multiple of sixteen wide, so nothing reachable disagrees",
  "turbo draw":
    "Routines 346 ($7760) and 347. DEFECT: that table at $7778 is SIX bytes -- `01 03 07 0f 1f 3f` -- indexed by " +
    "`depth - 1`, and `move.b -$1(a0,d1.w),d0` with a depth of 7 or 8 reads the two bytes after it, which are the " +
    "first half of the next routine's `movea.l $168(a5),a2`: $24 and $6d.",
  "font style":
    "Routine 145 ($40fe), seven instructions: the current screen, its RastPort at $148, `rp_Font` at $34, then " +
    "`move.b $17(a1),d3`. The manual says it 'replaces the AMOS function Text Styles, because this one does not " +
    "return the multicoloured font bit (Bit 6)'. DEFECT: it reads the wrong byte, by one. So it never reports a " +
    "style at all and Set Text cannot move it; bit 6 there is FPF_DESIGNED, set on essentially every real font, " +
    "which is presumably why the off-by-one survived three years of releases -- the bit the manual promises " +
    "always looks set. Source: +Lib.s:9896.",
  "amcaf aga notation on":
    "Routines 80 ($307c) and 81 ($3088), twelve bytes each, each a single `move.w #n,$2d2(a2)`. The manual: " +
    "'After calling Amcaf Aga Notation On, all AMCAF commands and functions take 24 bit values... The default " +
    "setting is 12 bit.' DEFECT: the two are the wrong way round. NOTE: 'all AMCAF commands and functions' is " +
    "wrong too -- the flag is read from exactly three addresses in the whole hunk, and they are Red Val, Green " +
    "Val and Blue Val, so the manual's careful exception for the two conversion functions is redundant",
  "red val":
    "Routines 87 ($327a), 88 ($329a) and 89 ($32c0) are the only readers of the notation flag in the hunk, and " +
    "each opens `move.w $2d2(a2),d0 / cmp.w #$4,d0`.",
  "glue colour":
    "Routine 86 ($3260), and it does NOT consult the notation flag: `moveq #$f,d0` then an `and` per gun, so " +
    "every component is masked to four bits and the answer is 12-bit whatever Red Val would have been reading",
  "best pen":
    "Routines 82 ($3094) and 83 ($30aa).",
  "pal set":
    "Routines 337 and 338 ($74b4, $74e6). 'Palnr must be range from 0 to 7' and the routine agrees, but the INDEX " +
    "bound is omitted by the manual: `cmp.w #$20,d1 / Rbge` is THIRTY-TWO, " +
    "not 256, and the address arithmetic confirms it -- `pal*64 + index*2` into a 512-byte block at $4aa(a2), " +
    "eight palettes of 32 words.",
  "rain fade":
    "'Rain Fade works step by step only.",
  "object protection$":
    "Routine 127 ($3bb0), and note the argument: it takes the NUMERIC VALUE, not a path, and unlike its " +
    "neighbours never touches the FileInfoBlock -- 'converts this numeric value into a string in the format " +
    "hsparwed'.",
  "examine dir":
    "Routine 109 ($3a32).",
  "examine object":
    "Routine 112 ($3ad6), Examine Dir's twin with the lock released immediately -- which is why it works on a " +
    "file as happily as on a directory and leaves a walk in progress alone.",
  "examine next$":
    "Routine 110 ($3a80). With no lock held it is error 23, which is the manual's 'you may not make any further " +
    "calls to Examine Next$' made enforceable.",
  "examine stop":
    "Routine 111 ($3ab6): `UnLock` the lock at $37c and clear it, wrapped in a `movem.l` of everything it " +
    "touches.",
  "object type":
    "Routines 114 to 129 are each three or four instructions reading a fixed offset of the FileInfoBlock the last " +
    "Examine filled in: Type $104 (fib+4, fib_DirEntryType raw), Name$ $108, Protection $174, Size $17c, Blocks " +
    "$180, Date $184, Time the low words at $18a and $18e, Comment$ $190. NOTE: none accepts a path or re-queries " +
    "the filesystem; all report the last Examine snapshot. None of " +
    "them contains a library call, so a change made after the Examine stays invisible until the next one",
  "protect object":
    "Routine 130 ($3c02), `SetProtection` (dos.library -$ba).",
  "set object comment":
    "Routine 131 ($3c20), `SetComment` (-$b4). NOTE: the routine copies the AMOS string with a plain `dbra` loop " +
    "and no length check at all, so the 79-character FileNote limit is the LIBRARY's rather than the extension's " +
    "-- an over-long comment reaches SetComment, which refuses it, and the result is error 81 rather than a " +
    "silently truncated note.",
  "set object date":
    "Routine 132 ($3c54), `SetFileDate` (-$18c).",
  "file copy":
    "Routine 108 ($395e), and it shows exactly how 'you can even copy a file of 3 MB in size, even if you only " +
    "got 100 KB of free memory': it asks `AllocMem` for the whole file, HALVES the request on failure and asks " +
    "again, giving up only below $2800 -- ten kilobytes. NOTE: there is no memory pressure here and no chunking, " +
    "so the halving loop is behaviour this port cannot reach; the result is the same file either way",
  "dos hash":
    "Routine 99 ($365a), the AmigaDOS directory hash instruction for instruction: seed with the length, then per " +
    "character `mulu.w #$d,d3 / add.l d2,d3 / andi.l #$7ff,d3`, and finally `divu.w #$48,d3` keeping the " +
    "remainder -- $48 is 72, which is 512/4-56, the bucket count of a standard block. DEFECT in the port rather " +
    "than AMCAF: the case fold (`cmp.b #$61 / bcs / cmp.b #$7a / bhi / subi.b #$20`) was missing, so " +
    "the hash depended on case and a program walking real hash chains was sent to the wrong bucket.",
  "path$":
    "Evidence: Routines 96 and 97 ($3536, $358e).",
  "pattern match":
    "Routine 102 ($377a).",
  "wload":
    "Routines 104 ($384a) and 103 ($37f0) differ in two constants and nothing else: the Reserve type -- `moveq " +
    "#$0,d1` for Wload and `moveq #$1,d1` for Dload -- and an eight-character bank NAME that is a literal in the " +
    "binary, `Work ` and `Datas `. The documented sign check is `bpl " +
    "/ neg.w d0 / addq.w #$2,d1`, so a NEGATIVE bank number reserves in chip -- 'If bank is a negative number, " +
    "the file is loaded into Chip ram instead'.",
  "wsave":
    "Routine 105 ($38a2), shared by Dsave -- 'Dsave is exactly the same as Wsave in every aspect', and the token " +
    "table gives both names the same routine. Source: +Equ.s:1867-8.",
  "tool types$":
    "NOTE: `.info` files are Workbench DiskObjects and this port does not decode them, so a program asking for " +
    "tool types gets the empty string -- the same answer the manual gives for a file with no icon. The manual's " +
    "own note is worth keeping: 'The supplied file must not have a .info appended!'",
  "bank code mix.b":
    "Routine 37 ($25d2), and the only one of the five encoders the manual does not describe.",
  "bank code mix.w":
    "Routine 47 ($2690), the word form of the walking key -- and its constant is $FACE, NOT $AAAA.",
  "bank checksum":
    "Routine 55 ($27a6) and its worker 54 ($2782): a plain LONGWORD SUM of the region, then `eori.l #$faceface`.",
  "bank code rol.b":
    "Rotate, not shift. The manual bounds the count to 1..7 on `.b` and 1..15 on `.w`, and 'To decode a bank " +
    "either use the negative code with the same instruction or the same key code along with the Bank Code Ror " +
    "command' -- so a negative count rotates the other way",
  "bank to chip":
    "Routine 27. The manual's warning belongs to the hardware and not to us: \"Do not try to replay musicis " +
    "or sounds that resist in fast ram\" -- the guide's own spelling of musics.",
  "current time":
    "Routine 321 ($70e0 in 1.50): `DateStamp()` into the extension's own block, then `move.w $6(a2),d3 / swap d3 " +
    "/ move.w $a(a2),d3` -- the LOW WORDS of ds_Minute and ds_Tick, the two high words dropped rather than " +
    "checked. The manual spells the same format out: 'the time is created out of Wordswap(minutes)+ticks', and " +
    "says why: 'This is NOT a value in the standard DOS-format as this one would require two longwords'",
  "insstr$":
    "Routine 187 ($4a44). The manual's example agrees -- 'dear ' at 6 into 'Hello Ben!' keeps 'Hello ' and gives " +
    "'Hello dear Ben!'.",
  "cutstr$":
    "Routine 188 ($4aae), an INCLUSIVE 1-based run: 7 To 11 out of 'Hello dear Ben!' removes the five characters " +
    "'dear '. NOTE: the routine's middle runs into bytes the disassembler cannot separate from code -- the same " +
    "misdecode Vmod hits -- so its bound checks are legible but the exact arithmetic is not, and the manual's " +
    "worked example is what this follows",
  "asc.w":
    "Routine 181. UNSIGNED, 0..65535, where the sibling Asc.l is signed -- the one asymmetry in the group, and " +
    "both the manual and the routine agree on it.",
  "lsstr$":
    "Routine 178 ($488e).",
  "itemstr$":
    "Routines 190 and 191.",
  "lsr":
    "Routine 197 ($4cec). DEVIATION: the keyword is named for a LOGICAL shift and the instruction is `asr.l`, an " +
    "ARITHMETIC shift, so the sign bit is replicated and a negative value stays negative. That also makes the " +
    "manual's 'does the same as a division by 2^n' false for negatives -- ASR rounds toward minus infinity where " +
    "division rounds toward zero, so Lsr(-3,1) is -2 rather than -1.",
  "lsl":
    "Routine 196 ($4ce2) is `asl.l d0,d3`. The manual says 'Rotates the number v to the left', which it does not " +
    "-- bits leaving the top are lost.",
  "binlog":
    "Routine 195 ($4cc2), and the routine is the specification: zero takes the `Rbeq` error branch, then it " +
    "shifts right counting until bit 0 is set, shifts once more and errors if ANYTHING is left (`tst.l d0 / " +
    "Rbne`). So a value that is not exactly a power of two is an error rather than a floor, which is what the " +
    "manual promises",
  "qsqr":
    "Routine 271 ($6286): an integer square root by Newton's method over a scaled start, with no maths library " +
    "involved.",
  "pt signal":
    "Routine 268 ($61bc) CLEARS the byte as it reads it -- `move.b $2(a0),d3 / clr.b $2(a0)` -- so a signal is " +
    "consumed by the first read and a second gives 0. The changelog pins the one documented value: 'When reaching " +
    "the end of a song, Pt Signal now reports $FF'",
  "pt cnote":
    "Routine 243 ($5d5e). Returns a FREQUENCY, not a note number -- the manual says 'the frequency of an " +
    "instrument being played' and the routine divides $369E99 (3,579,545, the NTSC Paula clock, used whatever the " +
    "machine) by the channel's period word at +$10 of a 44-byte per-channel block, answering 0 when the period is " +
    "zero. Same DEVIATION as Pt Cpattern: the engine is Player 6.1A's, not AMCAF's",
  "pt cinstr":
    "Routine 242 ($5d34), the same range check, then `move.b $2(a0,d7.w),d3 / lsr.w #4`. NOTE: a byte shifted " +
    "right by four yields 0..15, so the routine cannot return the 16..31 its own manual promises -- the high bit " +
    "of a ProTracker instrument number lives in the other half of the note word. APPROXIMATED for the same reason " +
    "as Pt Cnote",
  "pt sam freq":
    "Routine 246 ($5df6), and three things the manual's 'channel chan' hides.",
  "qsin":
    "Routine 260 ($643a), and now FAITHFUL rather than APPROXIMATED because the table was found. DEFECT: the " +
    "expansion at $a2d8 copies 255 entries, writes $100 as the 256th and mirrors, which puts the PEAK at index " +
    "255 and 767 rather than 256 and 768 and leaves DOUBLED zeros at 0/1023 and 511/512.",
  "qcos":
    "Routine 259 ($6428), four instructions: `addi.w #$100,$6(a3)` then `Rbra` into Qsin. Inherits the table " +
    "DEFECT recorded under Qsin",
  "qarc":
    "Routine 261 ($646c). DEFECT: the quadrant is chosen by `tst.w`, a WORD test, while the magnitudes were taken " +
    "as longs, so a delta past 65535 whose low word reads positive lands in the wrong quadrant.",
  "qrnd":
    "Routine 272. The manual says it is 'totally identical to the Rnd function, with the only difference, that " +
    "this one is much faster', so it uses AMOS's own generator rather than a second one -- which is also what " +
    "makes a Randomize seed reach it",
  "vmod":
    "Routines 185 ($49e6) and 186 ($4a10), two token forms of one idea. NOTE: the two-bound form's disassembly " +
    "runs into data the disassembler renders as `dc.b \"BCHCNuD\"` and could not be read straight through; the " +
    "single-bound path is legible and the two-bound one follows the manual's worked description",
  "cpu":
    "Routine 216 ($5026) reads ExecBase+$128 (AttnFlags) and maps the bits onto " +
    "68000/68010/68020/68030/68040/68060 -- d3 starts as the longword $109a0, which is 68000 in decimal, and each " +
    "hit overwrites only the low WORD so $9b4 turns it into $109b4 = 68020.",
  "fpu":
    "Routine 217. The manual notes that on 68040/68060 the cpu contains the fpu and those numbers come back " +
    "instead",
  "nop":
    "Routine 21 ($231a) is two bytes: `rts`.",
  "nfn":
    "Routine 22, the function half of the same idea: 'This function returns nothing useful.",
  "aga screen open":
    "Routine 2 ($1050): 0..7 or error 5, must not already exist (error 1), always 320x256x8, brought to the " +
    "front, and the default font selected on the way. DEVIATION: the original builds its OWN copper list outside " +
    "AMOS's screen system, which is why the doc warns that 'Sprites,Bobs and Mouse related commands may react in " +
    "a corrupting way on screen'.",
  "aga get palette":
    "Routine 5 ($11d8) is FOUR BYTES: `move.l (a3)+,d0 / rts`.",
  "aga get bank palette":
    "Routine 38 ($1a94).",
  "aga colour":
    "Routine 24 ($158a) and its function form.",
  "aga ink":
    "Routine 9 ($13a0): `move.b d0,$0(a2)`.",
  "aga bar":
    "Routine 7 ($1236) = RectFill, but only after `cmp.w d0,d2 / ble` and `cmp.w d1,d3 / ble`, so an inverted or " +
    "degenerate bar is error 3.",
  "aga box":
    "Routine 6 ($11dc): Move to (x1,y1), then PolyDraw over four corners -- (x1,y2) (x2,y2) (x2,y1) (x1,y1).",
  "aga text":
    "Routine 8 ($127e): TextExtent to measure, TextFit to clip, then the glyphs through rp_Font. DEVIATION: with " +
    "no face opened this draws nothing, where the machine's RastPort would inherit the screen's default topaz.",
  "aga draw mode":
    "Routine 35 ($19e2) = SetDrMd(rp, n): Jam1 0, Jam2 1, XOR 2, INVERSVID 4, stored with no validation.",
  "aga sprite mode":
    "Routine 36 ($19fe): patches $00, $80 or $c0 into a copper instruction for low, medium and high resolution " +
    "sprites.",
  "aga front screen":
    "Routine 30 ($1868). Whether that is a live defect depends on what the dispatcher leaves in a2, which cannot " +
    "be settled without executing the 68k -- n/a by policy.",
  "aga unpack":
    "Routine 48 ($1fd2), and the format is read off it rather than out of the doc, which describes none of it.",
  "aga spack":
    "Routine 47 ($1dee), the inverse of Aga Unpack's format.",
  "aga load bitplanes":
    "Routine 29 ($1804): eight CopyMem calls of $2800 bytes each, straight into the planes in order -- $2800 is " +
    "320/8 * 256, one whole plane.",
  "aga get block":
    "Routine 18 ($1434): 0..4000 or error 8. DEVIATION: the doc says overwriting a block leaks the old one ('you " +
    "will lose the memory that the previous block was using, so remember to AGA Del Block first'); a Map simply " +
    "replaces it, so the leak is not reproduced",
  "aga use font":
    "Routine 54 ($2324): OpenLibrary('diskfont.library') cached at $ba, CloseFont on the previous face, a " +
    "TextAttr built at $c5 from name/ySize/style/flags, then OpenDiskFont.",
  "stars reset":
    "Routine 4 ($1892), twelve bytes and undocumented: `movea.l $f80000,a0 / movea.l 4(a0),a0 / jmp (a0)` — it " +
    "reads the initial PC out of the Kickstart ROM header and jumps to it, which is a hard machine reset. " +
    "DEVIATION: there is no machine to reboot, so the program ends, the same thing System and Edit do with AMOS's " +
    "own leave-now keywords. Nothing in Stars.doc mentions this keyword at all, so no program can have been " +
    "relying on the reboot in a way the manual sanctioned",
  "stars wibble":
    "Routine 8 ($19f2): `move.l a4,-(a7) / movea.l (a7)+,a4 / rts`.",
  "stars vbl":
    "Routine 5 ($189e). Documented as 'the same as Wait Vbl, but shows idle processor time', and it does that by " +
    "busy-looping on COLOR00 between $000 and $800 until the VBL server flips the flag at +6 of the extension's " +
    "block. DEVIATION: the wait is reproduced and the colour bar is not — the bar's width measures how long the " +
    "68k sat in that loop, which is a property of the host's speed rather than of the program",
  "stars on":
    "Routine 6 ($18d8). The PRNG ($19ca) folds VHPOSR into its state on every call, so on the real machine the " +
    "field depended on where the beam was; we model the beam, so the sequence is reproduced rather than " +
    "approximated and simply becomes repeatable. Speed is not a parameter and is not documented: the movement " +
    "loop counts DOWN while walking the arrays UP and takes ((i AND 7) + 1) pixels a frame from the counter, so a " +
    "field is eight interleaved parallax layers",
  "stars off":
    "Routine 7 ($19e2): clears the count and nothing else, so the stars already drawn stay on the screen until " +
    "something overwrites them.",
  "stars blast":
    "Routine 3 ($181a).",
  "stars dir":
    "Routine 9 ($19f8): 0..4 into the same field Stars On writes.",
  "cop palette":
    "Routine 10 ($1a1c).",
  "cop true palette":
    "Routine 11 ($1aba), the 24-bit form: two passes over the same R,G,B bytes, high nibbles into the colour " +
    "registers and low nibbles behind AGA's LOCT. DEFECT: the first register is computed with `lsl.w #4,d3` where " +
    "Cop Palette has `lsl.w #1,d3` ($1ae8 against $1a40, confirmed byte-for-byte as E94B against E34B).",
  "cop screen":
    "Routine 12 ($1bd8).",
  "cop current":
    "Routine 13 ($1ca4), two instructions: `move.l -$804(a5),d3`, AMOS's own copper build pointer.",
  "multi joy":
    "Routine 3 ($260). The manual contradicts itself and the binary settles it: its diagram reads '76543210 / " +
    "ABCDUDLR', which would order the low nibble U,D,L,R downward from bit 3, but its value table says 1=up " +
    "2=down 4=left 8=right 16=D 32=C 64=B 128=A. A and C are ONE WIRE and B and D the other: the routine reads " +
    "each of the two lines twice with a `move.w #$e000,$34(a6)` POTGO write between them, which is the " +
    "four-button adaptor's multiplex, and with no adaptor a wire carries the same thing both times.",
  "multi fire":
    "Routine 4 ($368). Buttons 1 and 3 are the fire wire and 2 and 4 the pot wire, for the reason Multi Joy " +
    "gives. Note which argument is range-checked: the routine pops button into d4 and jport into d5, and only " +
    "d5 gets the blt/bgt pair, so an out-of-range BUTTON falls through every cmp.w and answers 0.",
  "gsreadport":
    "Routine 2 ($1d96). `jsr -$1e(a6)` on lowlevel.library is ReadJoyPort -- -30 at the fd's bias of 30 -- and " +
    "the bitfield is returned unchanged. NOTE no range check: unlike Gsmousedx there is no cmp/bmi pair, so an " +
    "out-of-range port reaches ReadJoyPort and gets JP_TYPE_NOTAVAIL (zero) rather than raising.",
  "gstimer":
    "Routine 3 ($1dc0). `lea $4a(a2),a0 / jsr -$66(a6)` is ElapsedTime, -102, whose result is in 1/65536 of a " +
    "second. The context at $4a is never initialised, which is why the guide warns the first call returns " +
    "garbage -- it is the uptime. DEVIATION: the clock here is the vertical blank counter, so the granularity " +
    "is 20ms where the guide claims about 200us off the CIA E clock.",
  "gsmousedx":
    "Routine 4 ($1dec). Two ports, two different paths: port 0 reads an accumulator the VBL hook fills and " +
    "clears it, port 1 differences JOY1DAT's low byte live. The delta wraps through 8 bits and is scaled by " +
    "(speed+7)/8 with `muls.w`/`asr.l #$3`. DEVIATION: port 1 holds the host's controller rather than a second " +
    "mouse, so its counters are a digital stick's quadrature bits -- real, moving values of 0 to 3.",
  "gsmousedy":
    "Routine 5 ($1e74), the same shape as Gsmousedx on the HIGH byte (`lsr.w #$8` where routine 4 has " +
    "`andi.w #$ff`), against $46/$36 rather than $42/$32.",
  "gssetmousespeed":
    "Routine 6 ($1efa). `addq.w #$7,d0` is a WORD add on a LONG value, then `tst.w d0 / bmi`, which is exactly " +
    "why the guide's maximum is 32760: 32760+7 is $7fff and 32761+7 is $8000. The error MESSAGE says 'between 0 " +
    "and 32761' and is wrong at both ends -- 0 raises too. A speed of -7 stores a factor of zero and never " +
    "raises, after which every delta scales to nothing.",
  "gscontrollertype":
    "Routine 98 ($2c30), `jsr -$24(a6)` = GSReadCType on GSDrivers/gsjoystick.library. That library does not " +
    "ship in the archive and was never released -- the guide's Modules node describes the whole driver scheme " +
    "in the future tense. The routine answers 0 without raising when the base is zero, which is what every " +
    "machine without the driver returns, so 0 is the faithful answer and not a stub.",
  "gsreadsega":
    "Routine 99 ($2c54), `moveq #$0,d0 / jsr -$42(a6)` = GSReadButtons(0) on the same absent driver library.",
  "gssqr":
    "Routine 9 ($21a0), UNDOCUMENTED --- the guide's command list does not mention it. Newton-Raphson from a " +
    "seed of (x>>8)+7 with five passes, and it fails in three ways as x grows, none of them guarded. Exact for " +
    "perfect squares to 1994^2; drifts above that, by as much as 19 near the top, because five passes cannot " +
    "reach the answer from a seed of x/256; goes to garbage at $800000, where `ext.l` reads the seed word as " +
    "negative; and divides by zero in the $fff900 window, where the seed's low word lands on 0 (a 68000 " +
    "exception on the machine, surfaced here as AMOS error 20). The loop also exits only when a pass repeats " +
    "its own guess, so a two-cycle runs out on whichever side `dbra` leaves it --- Gssqr(99) is 10, not 9.",
  "gspyth":
    "Routine 97 ($2bea). The guide calls it 'equivalent to d=Sqr(x*x+y*y), but nearly 3 times as fast when the " +
    "program is compiled'. The same Newton loop as Gssqr with a far better seed --- (|x|+2|y|)/2+7 --- and " +
    "seven passes instead of five. THE ORDER MATTERS, and the guide's 'though the order doesn't matter!' is " +
    "wrong: y counts double in the seed, so Gspyth(1,19999) settles on 19999 and Gspyth(19999,1) runs away to " +
    "33556598. `muls.w` squares only the low word of each argument, which is the whole of the guide's 'keep the " +
    "values of x & y below about 20000' --- and when both low words are zero the `tst.l/beq` hands back " +
    "|x|+2|y| instead of a distance, so Gspyth(65536,0) is 65536.",
  "gsmulti off":
    "Routine 10 ($21cc), `jsr -$84(a6)` on exec = Forbid. 'Multi' is multitasking. Undocumented. DEVIATION: " +
    "there is one task in this port, so there is nothing to forbid --- see src/amiga/exec.ts's own header. " +
    "Unbalanced nesting is invisible for the same reason.",
  "gsmulti on":
    "Routine 11 ($21e0), `jsr -$8a(a6)` = Permit, the other half.",
  "gspasscode":
    "Routine 36 ($235c). Arguments pop RIGHT TO LEFT. The data's 5-bit checksum seeds the cipher AND is what " +
    "the decoder verifies; each longword splits into 4-bit groups low first with bit 4 marking 'another " +
    "follows' (so -1 needs eight, as the guide says); the length's low byte goes in front and " +
    "(datasum - passsum) & $1f behind, which are its 'two check digits'. The keystream is `rol.l #$1` on the " +
    "key, EOR the digest, then `bchg` one of the digest's low 16 bits --- a register-destination BCHG, so LONG " +
    "and modulo 32, whatever capstone prints. DEFECT: d1 is never cleared between characters and every " +
    "arithmetic step on it is a LONG op while the load is a `move.b`, so a length byte of 230 or more carries " +
    "into bits 8+ and every following character is $100 too high before `move.b` truncates it. Gspassdecode " +
    "clears d1 each iteration ($25fa) and cannot reproduce that, so codes that long do not decode.",
  "gstrack play":
    "Routines 12/16/17 ($21f4/$22bc/$22c6), each pushing a default and falling into the next, so `Gstrack Play " +
    "bank` is `bank, 0 To -1`. The bank must be one Track Load made: `cmpi.l #$54726163,-$8(a2)` and " +
    "`#$6b657220,-$4(a2)` is 'Trac' and 'ker ', and anything else is error 5. The extension ships its own " +
    "ProTracker replayer (SubRoutines/PlayRoutine.s, one of the six missing includes); this drives " +
    "src/amiga/protracker.ts instead and reads off the binary only what GameSupport ADDS to a stock replayer " +
    "--- the position range, the transpose, the 8tb mailbox and the master volume. DEVIATION: the real player " +
    "runs off a CIA timer ($626 opens ciab.resource and installs an ICR vector), so Fxx above $1f sets a true " +
    "tempo; every replayer here ticks once a vertical blank instead.",
  "gstrack stop":
    "Routine 13 ($227a): the flag cleared, `jsr -$1312(a6)` = $908 for the silence and the rewind to position " +
    "0, and `jsr -$14e6(a6)` = $734 to remove the CIA interrupt, which has no counterpart here.",
  "gstrack loop":
    "Routines 20/21 ($22ec/$22f6); the one-argument form pushes -1 for Pos2. NOTE routine 21 opens " +
    "`move.l #$1,$0(a0)` --- setting a range turns looping back ON.",
  "gstrack loop on":
    "Routine 18 ($22d0), one store. With looping OFF the end of the range does not merely stop repeating: " +
    "`tst.l $1c1a / beq` runs `bra $908`, which is Gstrack Stop's own silence.",
  "gstrack loop off":
    "Routine 19 ($22de), the other store.",
  "gstrack loop defer":
    "Routine 24 ($2342): Pos2 goes to the DEFERRED slot ($10) and Pos1 straight into $4. Only the end needs " +
    "deferring --- nothing reads Pos1 until the wrap that would have used the old end anyway --- so the guide's " +
    "'the new limits will not be set until the current cycle has finished' is true of both by two mechanisms. " +
    "It does not touch $0, so Gstrack Loop Off still beats it.",
  "gstrack gosub":
    "Routines 22/23 ($230c/$233a); the one-argument form duplicates the top of the stack so Pos2 = Pos1. There " +
    "is no return stack: Pos1 becomes WHERE WE ARE, the old end goes to the deferred slot, and the wrap at the " +
    "jingle's end does the rest. One level deep --- a second Gstrack Gosub inside a jingle loses the outer " +
    "return.",
  "gstrack transpose":
    "Routine 15 ($22b0), and the store is a `move.b`, so the offset is a signed BYTE and 200 means -56. The " +
    "player finds the note's index in its own period table and adds the offset ($1520); a note pushed out of " +
    "its 36-note row comes back by ONE octave and no more ($152e-$1566), after which a larger transpose walks " +
    "into the neighbouring FINETUNE row. That is the whole of 'many modules sound weird when transposed too " +
    "much'.",
  "gstrack volume":
    "Routine 25 ($2350), a `move.w` into $18. The player applies it with `mulu.w $1c32(pc),d0 / lsr.l #$6,d0` " +
    "($157c), which is Protracker.master's own arithmetic. Nothing range-checks: past 64 it multiplies beyond " +
    "full volume and only the replayer's clamp stops it.",
  "gsiconify":
    "Routines 8 ($207a) and 7 ($1f18), the one- and two-argument forms. AddAppIconA(0, 0, text, port, NULL, " +
    "diskobj, NULL) on a message port, then exec WaitPort, which BLOCKS until the icon is double-clicked, then " +
    "RemoveAppIcon and the teardown. One argument takes GetDefDiskObject(WBTOOL); two copy the path through " +
    "Dsk_PathIt to GetDiskObject and force do_CurrentX/do_CurrentY to $80000000 (NO_ICON_POSITION) so Workbench " +
    "places it. Every failure arm returns 1 and none raise --- which the guide says is why it is a function at " +
    "all. DEFECT: the LABEL is passed as `lea $2(a0),a0` with no terminator, so it runs on past the AMOS " +
    "string; the BugsFixed node records the identical mistake being fixed for the icon PATH, which routine 7 " +
    "now copies and clr.b-terminates, and the text was missed. DEVIATION: workbench.library is not modelled and " +
    "neither is icon.library's AppIcon half (src/amiga/icon.ts is the .info FILE FORMAT), so this takes the " +
    "first arm and answers 1 --- which is what the routine does on any machine without Workbench 2. Reaching " +
    "the other arm needs AddAppIconA/RemoveAppIcon on the Workbench screen intuition.ts already opens, plus a " +
    "blocking WaitPort: this is the one keyword in the extension that suspends the program until the user acts.",
  "gsloadcodemod":
    "Routine 90 ($2854), UNDOCUMENTED, over a loadable-code format of the author's own. A GSMod is an ordinary " +
    "AmigaDOS loadable file whose first hunk carries \"GSMo\" ($47534d6f) somewhere in its first thirty-two " +
    "bytes, followed by a header: +$14 init, +$18 cleanup, +$1c the FUNCTION table, +$20 the ATTRIBUTE table. " +
    "The slot table at $7a holds sixteen. Error 6 when they are all taken, AMOS error 23 for a filename of 129 " +
    "or more and for a LoadSeg that fails. DEFECT: the magic scan has NO failure exit --- `dbra` falls straight " +
    "through into the found path --- so a file that loads but is not a GSMod gets a header pointer thirty-two " +
    "bytes into the segment and the `jsr $14(a1)` goes into whatever is there. DEVIATION: the init routine is " +
    "68k code and is not called here.",
  "gsunloadcodemod":
    "Routine 91 ($2910). NOTE the order: the module's cleanup routine is called BEFORE the emptiness test, so " +
    "unloading a slot that holds nothing dereferences a null header. Nothing range-checks the slot either, and " +
    "the index is `d0.w`, so a number above 8191 wraps rather than running off the table.",
  "gsgetattr":
    "Routine 92 ($295e). The lookup ($29a4, copied verbatim at $2a50/$2af4/$2b90) buckets by INITIAL LETTER: 27 " +
    "longwords where entry i is bucket i's start and i+1 its end, over eight-byte { value, name } entries. Two " +
    "consequences a caller can reach --- `bclr #5` on both sides makes it CASE INSENSITIVE (and makes '0' equal " +
    "'P', since they differ only in bit 5), and the comparison ends when the ENTRY's byte reaches zero, so it " +
    "is a PREFIX match: an entry named SPEED answers a lookup for SPEEDY. Error 7 on a miss.",
  "gssetattr":
    "Routine 93 ($29fe), the same lookup with a LONGWORD store at the entry's own start. Arguments pop right to " +
    "left, so the value reaches d0 first.",
  "gsfindattr":
    "Routine 94 ($2aae), the same lookup again, answering the ENTRY'S ADDRESS rather than its value --- which " +
    "is what a program pokes through to change one without a second lookup. Loaded modules are mapped at " +
    "Runtime.CODEMOD_BASE so that address is real.",
  "gscallmod":
    "Routine 95 ($2b4e). The FUNCTION table at $1c rather than the attribute table at $20, so an attribute name " +
    "is not a function name, and error 8 on a miss. DEVIATION: `movea.l (a0),a0 / jsr (a0)` is a direct call " +
    "into 68k code and there is no interpreter in this port. THE ONE STRUCTURAL DEVIATION in this extension --- " +
    "everything else GameSupport does is data. The lookup and its error are faithful; a function that IS found " +
    "raises rather than silently doing nothing, because a game whose module does the work would otherwise carry " +
    "on with the work undone.",
  "gsopenc2plib":
    "Routine 80 ($2714), and L_OpenC2PLib in the author's own source, which carries the whole C2P block. " +
    "$147 holds exactly sixteen characters, \"GSChunky2Planar/\", and the caller's string is appended at $157, " +
    "so Gsopenc2plib(\"Fast\") opens GSChunky2Planar/Fast. An EMPTY name never reaches OpenLibrary. The LVOs on " +
    "that library are -30 GSInitialiseC2P, -36 GSCleanupC2P, -42 GSGetC2PInfo and -48 GSGoC2P. NOTE the whole " +
    "block is a shim over GSDrivers/ modules that were never released --- the guide's Modules node lists " +
    "ChunkyToPlanar under 'Modules planned so far' and describes the scheme in the future tense --- so the " +
    "library-absent arm is what every real machine ran, and it is complete rather than stubbed. " +
    "src/amiga/planar.ts is deliberately NOT wired in behind these: it is this port's own conversion, not " +
    "Robinson's module, and pointing one at the other would invent a library rather than model one.",
  "gsclosec2plib":
    "Routine 81 ($2780): GSCleanupC2P then CloseLibrary, both behind a `beq .dontbother`.",
  "gschunky2planar":
    "Routine 82 ($27b2): GSGoC2P on the open library, or 0. Takes no argument --- the region and the palette are " +
    "set beforehand and the conversion reads them out of the info block.",
  "gssetc2pcolour":
    "Routine 83 ($27e8). Arguments pop right to left, so the second reaches d0 and is the value. It marks " +
    "GSC2P_ColourMapDirty ($18) before it looks at the map ($14) and one entry is a LONGWORD. Nothing " +
    "range-checks the index, and the displacement is `d1.w`, so an index above 16383 wraps into the low 64K of " +
    "the map rather than running past it.",
  "gssetc2pregion":
    "Routine 84 ($2812). Four pops right to left, so d0 is y2 and d3 is x1, into $c/$10/$a/$e --- Bottom, " +
    "Right, Top and Left. Words, so a coordinate above 65535 wraps.",
  "gsc2pinfo":
    "Routine 85 ($283a), two instructions: the info block pointer as it stands, which is the address a caller " +
    "would peek the structure through. Zero until a library opens.",
  "gsc2pdebug":
    "Routine 86 ($2846). DEFECT: `movea.l $62(a0),a0 / not.w $1a(a0)` with NO zero check, and the source agrees " +
    "--- every other C2P routine guards $62 and this one does not. With no library open the block pointer is " +
    "zero, so on the machine this toggles the low word of absolute $1a, inside exec's exception vector table. " +
    "There is no region there here, so the write lands nowhere.",
  "gscmd8data":
    "Routine 14 ($229c), five instructions, and the read CLEARS the word. The bits come from command 8tb in the " +
    "module ($11f4): t is the tick to fire on and b the bit to set, with t=0 meaning the row tick. ProTracker " +
    "ignores command 8 entirely, which is what makes it free to use for this.",
  "gspassdecode":
    "Routine 37 ($252e), the mirror. It rebuilds the seed from the CODE rather than the data --- last " +
    "character unmapped, plus the checksum of everything before it, masked to five bits --- then checks the " +
    "decrypted first character against the string's own length before decoding a group. DEVIATION: the routine " +
    "writes into PASS$, zeroing the last character and replacing the first, which the guide owns up to ('the " +
    "string which is passed to this function will be corrupted by this call (for no reason other than my " +
    "laziness!)'). Arguments arrive by value here, so the caller's variable survives and a program that " +
    "decodes the same variable twice succeeds where the machine fails. NOTE the integrity check is five bits " +
    "and each keystream call contributes five, so a short code can decode CORRECTLY under a wrong ID.",

  "s mouse on":
    "Routine 1 --- `bset #0,Status`. It arms the reader, not the pointer: AMOS's own mouse runs either way, and " +
    "this only lets InterStart accumulate the counters. The extension's DEFAULT and END routines both call " +
    "S Mouse Off, so Run and quitting disarm it.",
  "s mouse off":
    "Routine 2 --- `bclr #0,Status`, and it leaves CurX/CurY holding whatever they had reached.",
  "s x mouse":
    "Routine 3. InterStart reads $dff00d, sign-extends it, subtracts PrevX and adds the difference to a " +
    "32-bit accumulator. DEFECT: the 'test for overrun' is `cmpi.l #50,d0 / bge` and `cmpi.l #-50,d0 / ble`, " +
    "inclusive at both ends, and there is no modulo step. So the byte counter wrapping 127 to -128 gives -255, " +
    "outside the window, and the sample is DISCARDED rather than wrapped --- 255 counts of travel lost every " +
    "256. Any genuine movement of 50 or more counts in one frame is dropped the same way. Compare " +
    "counterDelta in src/amiga/gameport.ts, which is what the wrap is supposed to look like. PrevX is then " +
    "RE-READ from the register rather than reused, so on the machine a count arriving between the two " +
    "instructions is lost as well.",
  "s y mouse":
    "Routine 4, the same accumulator against $dff00c and PrevY. See S X Mouse for the overrun defect.",
  "s x mouse=":
    "Routine 7 --- `move.l (a3)+,CurX`. No range check of any kind; the accumulator is a plain longword.",
  "s y mouse=":
    "Routine 8, the same for CurY.",
  "s mouse button":
    "Routine 5, six instructions, and the binary at $cf8 agrees with the source byte for byte. DEFECT: it " +
    "tests `btst.b #$2,$bfe001`, and bit 2 of CIA-A PRA is the floppy DISK-CHANGE line. The left button is " +
    "bit 6 (/FIR0) --- what TURBO Plus, Misc, First, JD and AMOS itself all read. /CHNG sits high once the " +
    "drive has stepped after a disk was inserted, so on any machine with a disk in DF0: this answers 0 and " +
    "S Mouse Button cannot report a press at all. Bit 1, the right button, is dead a second way: the code for " +
    "it is present and COMMENTED OUT (`;btst #6,$dff016`), and that register and bit are correct, so the " +
    "author had the answer and did not enable it.",
  "s ifree":
    "Routine 27 --- how many of the eight InterBase slots are still zero. NOT routine 6, which the source also " +
    "calls L_Ifree and which counts free slots in AMOS's own VblRout table; that one is an internal helper the " +
    "cold start uses and no keyword reaches. The token table binds this name to function routine 27.",
  "s ibase":
    "Routine 24. DEFECT: the guard is `bclr.l #31,d1 / cmpi #8,d1 / rbge`, a WORD compare, and the index is " +
    "then used as a LONG through `mulu #4,d1`, which takes only the low word. So -1 becomes $7fffffff, whose " +
    "low word reads as -1 and passes `bge #8`, and the routine reads $3fffc bytes past the table. The guard " +
    "really only rejects 8 through 32767. Anything outside the eight real slots answers 0 here rather than " +
    "inventing a value for memory that is not modelled.",
  "s iadr":
    "Routine 25, the InterVarAdr table, with the same word-guard-long-index defect as S Ibase.",
  "s ierase":
    "Routine 29 --- `REPT 8 / clr.l (a0) / clr.l (a1)`. Both tables at once, no argument, and no way to remove " +
    "a single hook. Called by the extension's own DEFAULT and END routines.",
  "s iinit":
    "Routine 26. Both address arguments go through `cmpi.l #$10000,dn / ble`, so anything up to and INCLUDING " +
    "65536 is a bank number resolved through Bnk.GetAdr and anything above it is an address --- the change " +
    "Sln_ext_Historie lists for v2.0 ('accepterer nu ogsaa bank nummre istedet for adresser'). The slot check " +
    "is `bclr.l #31,d3 / cmpi.l #8,d3 / rbcc`, an UNSIGNED longword compare, so unlike S Ibase it really does " +
    "reject everything outside 0 to 7. DEVIATION: `jsr (a2)` in InterStart enters 68000 machine code and this " +
    "port executes none --- the boundary Call, Dreg and Execall are all n/a for. The two tables are kept " +
    "exactly, so S Ibase, S Iadr, S Ifree and S Ierase all answer correctly and a program can install and read " +
    "back its hooks; the routine simply never runs. It raises nothing, because the failure is once a frame " +
    "rather than once at the call.",

  "s ainit":
    "Routines 11 (allocate) and 31 (use the program's own memory). Each dimension is stored one MORE than the " +
    "argument, and `x + 1 == 0` is the private signal that means erase, which is why S Ainit n,1,-1,0,0 is the " +
    "only way to reach L_ArrayErase. The checks are all WORD-sized: nr >= 8 signed, cell == 3, cell >= 5 " +
    "signed, cell <= 0 UNSIGNED -- so only a cell size of exactly zero is caught and a negative one passes all " +
    "three. THREE DEFECTS, all confirmed in the binary. (1) The free before re-initialising reads " +
    "`movea.l (a2),a1` at $e2c, which is Abase[ZERO], with Asize[nr] as the length: re-initialising array 3 " +
    "hands array 0's block back, and the next allocation is carved out of it, so two slots end up naming one " +
    "address. With array 0 unused it is FreeMem(NULL,n), which gurus. (2) The attributes are stored through one " +
    "lea on Axsize and the last store is `bclr.b d3,$40(a1)` --- Axsize+$40 is AZSIZE, where Atype is at " +
    "Axsize+$60 --- so the 'user supplied this memory' bit is never cleared and every block allocated into a " +
    "slot that once held a user array leaks. Routine 31 sets that bit correctly, which is what makes the " +
    "failure visible. (3) `mulu` is 16x16 and each product feeds the next one's LOW WORD, so x*y*z*cell " +
    "truncates at every step and an array of more than 65535 elements allocates far less than it needs. " +
    "Routine 31 has a defect of its own: `addi.l #$1,d7 / #$2,d6 / #$3,d5` at $14f2-$1502, so an array over " +
    "the program's own buffer reports TWO more rows and THREE more columns than were asked for, and S Array " +
    "will index into them. Both forms take a bank number at or below 65536 in place of an address.",
  "s array":
    "Routines 23 (one index), 22 (two) and 14 (three). The 3D pair is the only one that checks all its bounds " +
    "properly. DEFECT in the 1D reader: `move.l (a1),d4` with NO `subi.l #1` and a `cmp.w`, where the writer " +
    "(routine 21) has both --- so index == Xsize can be READ and not written, one element past the end, and " +
    "only the low 16 bits of the index are checked. DEFECT in the 2D pair: at $1258 the Y index is compared " +
    "with Aysize-1 and NO BRANCH FOLLOWS, then at $126c the same Y is compared with AXSIZE-1 and that is the " +
    "one that raises. X is never bounds-checked at all. The index arithmetic itself is right: y*Xsize+x, and " +
    "z*Ysize*Xsize+y*Xsize+x for three dimensions, with mulu truncating the running product to 16 bits. " +
    "Element widths: a BYTE cell reads back ZERO-extended (`clr.l d3 / move.b`, no ext.b) where a WORD cell " +
    "has an `ext.l` and round-trips.",
  "s aset":
    "Routines 21, 20 and 19, the writing half of S Array and carrying the same 1D/2D bound defects. Two of its " +
    "own. DEFECT: the WORD store does not truncate a negative value, it FORCES the sign bit --- " +
    "`btst.b #$1f,d7 / bne / bset.b #$f,d7` at $d9c, both LONG btst/bset because the operand is a register --- " +
    "so storing -65536 ($ffff0000, low word zero) writes $8000 and reads back -32768. It is invisible unless a " +
    "value's sign and its low word disagree, which is why it survived. DEFECT: every writing routine ends " +
    "`adda d0,a2`, a WORD add sign-extended, where the 1D and 3D readers end `adda.l`. So an array over 32K can " +
    "be read to the end and only written in its first 32K; past that the offset goes negative and the write " +
    "lands BELOW the array's base.",
  "s aclear":
    "Routine 30. DEFECT: the counter is the array's length in BYTES and the loop writes LONGWORDS --- " +
    "`move.l Asize,d1 / subi.l #1,d1` then a dbra over `clr.l (a1) / adda.l #4,a1` at $14d0-$14e2 --- so it " +
    "clears four times the array and runs into whatever is next in the memory list. `dbra` counts on a word, " +
    "so the run is Asize mod 65536 longwords. The heap here is one contiguous buffer, so the overrun lands on " +
    "the neighbouring allocation exactly as it does on the machine. The guard is a SIGNED long compare, so a " +
    "negative slot number passes it and indexes off the table; the routine's own Abase == 0 test ends it.",
  "s aerase":
    "Routine 33, and it does not erase. It pushes cell size 1 and x = y = z = 0 and falls into S Ainit, which " +
    "adds one to each dimension and only treats x + 1 == 0 as the erase signal --- so the slot is freed " +
    "(through routine 11's wrong-block free) and immediately RE-ALLOCATED as a 1 x 1 x 1 array of one-byte " +
    "cells. =S Abase still answers non-zero, =S Asize answers 1, and the slot is still marked initialised.",
  "s aerase all":
    "Routine 34: the same eight times with the slot number counting 0 to 7, inheriting everything S Aerase " +
    "gets wrong. It is called by the extension's DEFAULT and END routines, so a program that runs to the end " +
    "leaves eight one-byte allocations behind.",
  "s asize":
    "Routine 12 --- Asize[nr], the BYTE count that went to AllocMem, so it carries the 16-bit truncation of " +
    "S Ainit's size arithmetic. Shares the word-guard-long-index defect described under =S Ibase.",
  "s abase":
    "Routine 13 --- Abase[nr]. A real address here: the arrays live in the AllocMem pool mapped at " +
    "Runtime.SLN_HEAP_BASE, so Peek, Leek and Loke reach the same bytes S Array and S Aset do.",
  "s axsize":
    "Routine 15 --- Axsize[nr], which is the argument plus one, or plus THREE through the address form of " +
    "S Ainit. Same word guard as =S Asize.",
  "s aysize":
    "Routine 16 --- Aysize[nr], the argument plus one, or plus TWO through the address form.",
  "s azsize":
    "Routine 17 --- Azsize[nr]. The only dimension the address form of S Ainit increments correctly.",
  "s atype":
    "Routine 18, and 'type' means the CELL SIZE. It reads Acell, a byte per slot, with no `mulu #4` and with " +
    "the `adda d1,a0` that would have been needed commented out in the source --- the index is the " +
    "displacement. So it answers 1, 2 or 4, the same number S Ainit's second argument takes, which the " +
    "extension calls the type throughout. Nothing reads the real Atype bitmap back out.",

  "s compare$":
    "Routine 35, and it is not a comparison: it scans SOURCE$ for the first character that appears ANYWHERE in " +
    "MASK$ and returns its 1-based position, or 0. The mask is a SET --- the inner loop walks all of it for " +
    "every source character. The `$` in the name is decoration: the spec is \"02,2,0,0\", whose leading 0 makes " +
    "this an INTEGER function, and the routine ends `clr.l d2`. POS is checked with `cmp.l d2,d0 / rbcs`, " +
    "UNSIGNED, so a negative POS is a huge number and raises; 0 and 1 both mean 'from the start' because " +
    "`subq.l #1,d2 / ble` skips the adjustment for anything not positive. ENDPOS counts from the START and 0 " +
    "means 'to the end'. DEVIATION: an empty mask or an empty source runs off the end of its buffer --- " +
    "`move.w (a1)+,d1 / subi.w #1,d4` gives $ffff for a zero length and the dbra reads 65,536 bytes of " +
    "whatever follows. Nothing here has a byte to give past the end of a string, so both answer 0.",
  "s checksum":
    "Routine 83 --- the AmigaDOS block checksum. 128 longwords subtracted from zero, then the longword at +20 " +
    "added back because that is the field the checksum itself occupies, so the answer is the negated sum of " +
    "the other 127. It reads 512 bytes from any address the port maps. S Disk Rename uses it on the root block " +
    "it has just edited.",
  "s delete":
    "Routine 95. DEFECT: the file-or-directory test is `cmpi.l #$0,$4(a0) / bhi` at $3eb2, and a0 is NOT the " +
    "FileInfoBlock --- Examine takes d1 and d2 and sets nothing in a0, and the last thing to write a0 was the " +
    "filename copy loop at $3e54, which left it just past the AMOS string's characters. So the decision is " +
    "made on four bytes of whatever follows that string in AMOS's string area and the FileInfoBlock the " +
    "routine filled is never read. DEVIATION: those bytes are not modelled, so the FILE arm is taken --- what " +
    "a zeroed string area gives, and the arm the author must have been testing. The consequence is that the " +
    "directory arm, two thirds of the routine and a real recursive CurrentDir/ExNext/Delete walk, is " +
    "unreachable in practice: S Delete on a directory is a plain DeleteFile, which succeeds for an empty one " +
    "and raises 26 for any other. DEFECT: the out-of-memory arm reports the wrong message, because L_error1 " +
    "(routine 98) is `move.l #$1,d1` where every other error routine writes d0, and d0 is what L_ErrorExt " +
    "indexes with --- here it holds the zero AllocMem just returned, so the message is 'Illegal function " +
    "call'.",
  "s iconify":
    "Routine 63. Flips to Workbench if AMOS is in front, freezes every AMAL channel, opens a NewWindow of " +
    "200x12 with the program's x, y and width patched in --- IDCMP $200 is CLOSEWINDOW alone, flags $100e are " +
    "ACTIVATE, CLOSEGADGET, DEPTHGADGET and DRAGBAR, Type 1 is WBENCHSCREEN --- then Wait()s on the port's " +
    "signal bit until the gadget is clicked, closes, unfreezes and flips back. The height and both height " +
    "limits are fixed at 12, so it cannot be resized into anything but a title bar; the width is written to " +
    "nw_Width, nw_MinWidth and nw_MaxWidth alike, and a width of zero is the only argument check there is " +
    "(error 6). NOTE it does NOT open the Workbench: the `IntCall -210` that would have is commented out in " +
    "the source, so on a machine with the Workbench screen closed the OpenWindow fails and the program gets " +
    "error 6. DEVIATION: Wait() suspends the whole task and there is one thread here, so the statement blocks " +
    "and re-runs a frame later --- the same shape Eliconify Amos already uses, and for the same reason. " +
    "src/amiga/intuition.ts opens the Workbench on demand for a WBENCHSCREEN NewWindow, which is AROS's " +
    "behaviour and not this routine's.",

  "s sam bank reserve":
    "Routines 53 and 44, defaulting to bank 6. Bnk.Reserve for EIGHT bytes under the name \"Sln.Sam.\", both " +
    "longwords cleared, SamBankNr adopted; a number already in use is error 2. The bank is a head pointer and " +
    "nothing else --- the samples themselves are AllocMem'd and chained through their own headers, which is " +
    "why =S Sam Base(1) is the bank's `next` field.",
  "s sam bank=":
    "Routine 43 --- a WORD store into SamBankNr with no validation whatever. The bank is not checked until " +
    "something looks a sample up.",
  "s sam bank":
    "Routine 55 --- SamBankNr, straight out of the data zone.",
  "s sam base":
    "Routine 50, and the routine every other sample keyword uses to turn a number into an address. It walks " +
    "`4(a0)` from the bank, so sample 1 is the bank's own next pointer, and answers 0 past the end of the " +
    "chain. NOTE S Sam Base(0): `subq.l #1` makes the counter -1 and `dbra` decrements before testing, so it " +
    "walks the whole chain and answers 0 rather than answering the bank. A SamBankNr of zero, or a bank that " +
    "is not reserved, is error 4.",
  "s sam load":
    "Routines 38 (append) and 39 (splice in BEFORE sample NR), over the shared loader at routine 54. The file " +
    "is sized with two Seeks, AllocMem'd at length + 24 and read in at +24, so the 24 bytes in front of it are " +
    "the header. DEFECT: `subi.l #$24,d5` records the FILE length minus twenty-four where the data is the " +
    "whole file --- the author conflated the size he allocated with the size he read, and the last 24 bytes of " +
    "every raw sample are outside the length and never play. It round-trips through S Sam Bank Save, which " +
    "writes length + 24, so nothing else notices. The 8SVX arm tests \"FORM\" and \"8SVX\" and then assumes a " +
    "FIXED 104-byte IFF header: it moves the sample header to +104, FreeMems the 104 bytes it walked past, " +
    "records `filelen - 128` (so the data stops 24 bytes short as well) and takes the frequency from a WORD at " +
    "file offset 32, which is VHDR's samplesPerSec and correct only if VHDR is the first chunk. Neither number " +
    "is read from the IFF, so an 8SVX with any other header length loads as noise. A failed AllocMem is error " +
    "3, not error 1.",
  "s sam chip load":
    "Routines 61 and 62 --- the same loader with `move.l #$2,d7`, MEMF_CHIP. It matters to S Sam Play, which " +
    "checks TypeOfMem (-534) against $703 and skips making a chip copy when the sample is already there.",
  "s sam del":
    "Routine 42. It looks the sample up THREE times --- NR, NR-1 and NR+1 --- rather than following the links " +
    "it already has, re-pushing the argument onto AMOS's stack each time (`move.l (a3),-(sp)`, with the " +
    "author's own comment 'Not a mistake!', because S Sam Base is what consumes it). Deleting sample 1 has its " +
    "own arm, where the previous sample is the bank.",
  "s sam bank erase":
    "Routines 45 and 59 --- delete sample 1 until S Sam Base(1) answers zero, then Bnk.Eff. NOTE it deletes " +
    "out of whichever bank SamBankNr names and erases whichever bank the ARGUMENT names, and nothing makes " +
    "those the same: S Sam Bank Erase 7 with the sample bank set to 6 empties bank 6 and erases bank 7.",
  "s sam bank load":
    "Routine 47 (46 defaults the bank to 6). The file is \"Sln.Sam.\" and then, per sample, the twelve bytes of " +
    "header up to and including the length, followed by `length + 12` more --- so the record is the whole " +
    "24-byte header plus the data, split across two reads because the loader needs the length before it can " +
    "allocate. The two link pointers are written to the file and thrown away on the way back in. A short read " +
    "of the twelve-byte record ends the file cleanly ('assuming that no more samples were saved'); a wrong " +
    "magic or a failed read is error 3.",
  "s sam bank save":
    "Routine 49 (48 pushes SamBankNr and falls into it). The two-argument form swaps SamBankNr for the " +
    "duration and puts it back on every exit, failure included. Each sample is written as `length + 24` bytes " +
    "straight out of memory, link pointers and all.",
  "s sam clip":
    "Routine 51. An END of ZERO deletes the clip, which is why the header's 'no clip' is a zero END rather " +
    "than a zero length; an END past the sample is clamped to the length, and an END below the START raises. " +
    "START is not checked against anything, so a start past the end is accepted and S Sam Play then computes a " +
    "negative clip length and falls back to the whole sample.",
  "s sam play":
    "Routine 40, and the whole player is in it. It stops the named channels first --- pushing the mask back " +
    "onto AMOS's own argument stack and calling L_StopSam --- then finds the sample, then makes sure the bytes " +
    "are in chip memory: TypeOfMem is -534 and `cmpi.l #$703,d0` is PUBLIC|CHIP|LOCAL|24BITDMA, anything else " +
    "getting an AllocMem(MEMF_CHIP) copy that Status bits 9-12 remember to free. TIMES is NOT a loop counter: " +
    "Amiga audio DMA repeats from AUDxLC forever, and the routine works out WHEN to stop it --- " +
    "`(times * length) / freq`, quotient and remainder each scaled by 50, added to CIA-A's time-of-day " +
    "counter, which ticks at the VERTICAL BLANK, which is where the 50 comes from. TIMES = 0 leaves bits 5-8 " +
    "clear so nothing ever stops it, which is 'infinite' by the same mechanism rather than a special case. The " +
    "period is `3546895 / freq` truncated, so what plays is the period's frequency and not the one asked for. " +
    "DEFECT: S Sam Play undoes an S Volume that came before it on the same voice, because L_StopSam's second " +
    "bclr is the volume-control bit --- the documented order is the order that loses the level. DEVIATION: " +
    "`mulu` is 16x16, so a sample over 65535 bytes gets its stop time from `length mod 65536`; that is the " +
    "routine's and is reproduced. What is not the routine's is that the clock here is the frame counter " +
    "rather than a real TOD, which comes to the same thing at 50Hz.",
  "s sam stop":
    "Routine 58. DMACON off, then the stop-timer bit, the VOLUME CONTROL bit and the Status2 in-use bit, in " +
    "that order --- so stopping a voice also loses whatever level S Volume asked for on it. DEFECT: " +
    "StopSamMemCheck does not count what it says it counts. It is `moveq #3,d6` over the four ISBase entries " +
    "with `cmp.l (a2),d7 / bne` LEAVING the loop, so it counts a RUN of voices sharing this block from ISBase0 " +
    "onward and stops at the first that differs, not the total. Voices 0 and 2 sharing one chip copy with " +
    "voice 1 on something else each count one user, and the block is freed twice.",
  "s sam freq":
    "Routine 56 --- the header's frequency longword. A sample that is not there RAISES here, where " +
    "=S Sam Length on the same number answers 0.",
  "s set freq":
    "Routine 41 --- a plain longword into the header at +12. No range check; S Sam Play divides by it, and a " +
    "frequency of zero would be a divide by zero on the machine.",
  "s sam length":
    "Routine 60, seven instructions, and the missing one is the error: `cmpi.l #0,d3 / beq _end` returns the " +
    "zero S Sam Base left in d3 rather than raising, so a sample that is not there is indistinguishable from " +
    "one of length zero. It carries S Sam Load's 24-byte shortfall.",
  "s volume":
    "Routine 37, and it is not a one-shot: it arms Status bits 1-4 and the VBL hook writes Volume[n] into " +
    "AUDxVOL every frame for as long as they are set, so a level asked for here overrides the sample player " +
    "and the tracker alike, once a frame, until something clears the bit. `and.w #%1111111111100001,d2` is " +
    "the first thing it does, so each call REPLACES the controlled set rather than adding to it: S Volume 1,32 " +
    "after S Volume 2,10 leaves voice 1 uncontrolled. The range check is `cmpi #64,d0 / rbcc`, unsigned, so 64 " +
    "and above raise and so does a negative volume.",

  "s disk open":
    "Routine 64 --- FindTask(NULL), AddPort, OpenDevice(\"trackdisk.device\", unit, 0). A non-zero return is " +
    "error 7; success sets Status bit 13. It never sets TDF_ALLOW_NON_3_5, so this is a floppy unit and " +
    "nothing else. Units 0 to 3 exist on the machine whether or not they hold a disk, and open here for the " +
    "same reason; 4 and above do not. A unit has a DISK in it when an ADF is mounted at the matching DFn:, " +
    "because an ADF is exactly the sector image CMD_READ wants. A unit with nothing mounted is an EMPTY DRIVE, " +
    "which is a real state and the honest one.",
  "s disk close":
    "Routine 65 --- `btst #13,Status` first, so calling it twice is harmless, then RemPort and CloseDevice. " +
    "Called by the extension's own DEFAULT and END routines, so Run and quitting both close the drive.",
  "s motor on":
    "Routine 66 --- TD_MOTOR with io_Length 1. Nothing spins here, but the state is real and S Disk Read turns " +
    "it back off where S Disk Send Read does not.",
  "s motor off":
    "Routine 67 --- TD_MOTOR with io_Length 0. Also the tail of S Disk Read, S Disk Write and every trackdisk " +
    "error path.",
  "s disk read":
    "Routines 68 and 70 --- CMD_READ at a byte offset, DoIO, check io_Error, motor off. Both the length and " +
    "the offset must be whole sectors: `divu.w #512` on each and the REMAINDER in the high word must be zero. " +
    "A read from an empty drive is TDERR_DiskChanged, which the error path reports as message 18.",
  "s disk send read":
    "Routine 69 --- SendIO rather than DoIO, so the routine returns before the transfer has happened and the " +
    "motor stays on. On the machine the buffer is not yet valid and S Disk Wait is what makes it so; the " +
    "transfer is deferred here for the same reason, which is the only way to make 'not yet' observable at all.",
  "s disk write":
    "Routines 71 and 73 --- CMD_WRITE, then CMD_UPDATE to flush trackdisk's track buffer, then motor off. The " +
    "update is what makes the write reach the disk rather than the cache. If the length and offset are ALSO " +
    "whole multiples of 5632 --- eleven sectors, one track --- the command is promoted to TD_FORMAT, which the " +
    "source calls '(faster)'. The difference is real on the machine and invisible here: a format lays down a " +
    "whole track without reading it first, so it works on an unformatted track and skips the " +
    "read-modify-write, but the bytes that reach the disk are the same bytes.",
  "s disk send write":
    "Routine 72, and the source's own closing comment is the whole difference: 'Note: buffer not updated, and " +
    "motor is still on.' No CMD_UPDATE either, so the write can still be in the track buffer when it returns.",
  "s disk state":
    "Routine 74 --- TD_CHANGESTATE, then `move.b 35(a1),d3 / ext.w / ext.l / eori.l #$ffffffff`. 35 is the low " +
    "byte of io_Actual, which is zero with a disk present and non-zero without, and the eori is a NOT. DEFECT: " +
    "the source's own comment says 'return -1 if a disk is in drive, or 0 if it isn't', and the second half is " +
    "wrong --- NOT 1 is -2, so an empty drive answers -2. A program written to the comment and testing `= 0` " +
    "never sees an empty drive at all.",
  "s disk prot state":
    "Routine 75 --- TD_PROTSTATUS and the same io_Actual byte sign-extended, without the NOT. Nothing " +
    "write-protects a mounted image here, so this answers 0, which is the true answer for the drives this port " +
    "has.",
  "s disk changes":
    "Routine 76 --- TD_CHANGENUM, the low byte of io_Actual ZERO-extended, with the source's own note 'Do not " +
    "extend byte'. The comment above it calls the answer 'number of disk changes*2', which is an observation " +
    "about trackdisk rather than anything the routine does: the counter moves on insertion and on removal " +
    "alike. Nothing ejects a disk here, so it does not move.",
  "s num tracks":
    "Routine 77 --- TD_GETNUMTRACKS, the low byte of io_Actual zero-extended. A double-density Amiga floppy is " +
    "80 cylinders of two heads, so 160; the byte is why a high-density disk's 320 would come back as 64.",
  "s disk dev check":
    "Routine 78 --- -1 when the device is open, 0 when it is not, and the ONLY trackdisk keyword with no " +
    "L_TrackCheck in front of it. That is what makes it the one a program can safely ask first.",
  "s disk abort":
    "Routine 79 --- exec AbortIO (-480) on the outstanding SendIO request.",
  "s disk wait":
    "Routine 80 --- exec WaitIO (-474), the other half of S Disk Send Read and S Disk Send Write, and what " +
    "makes their buffer valid.",
  "s disk update":
    "Routines 82 and 81 --- CMD_UPDATE, flushing trackdisk's track buffer. There is no track buffer here, so " +
    "what it does instead is what the flush makes true: the sectors were written past the filesystem, so its " +
    "memoised directory walks are stale, and AdfVolume.invalidate is what says so.",
  "s disk rename":
    "Routine 84 --- it edits the disk's ROOT BLOCK in place rather than going through AmigaDOS Relabel. " +
    "AllocMem(512, MEMF_CHIP), read 450560 (block 880, the root block of a DD floppy), write the name as a " +
    "length byte and characters at +432 with the length clamped to 30, recompute S Checksum into +20, write " +
    "back. It pushes its arguments onto AMOS's own stack and calls its own S Disk Read and S Disk Write " +
    "keywords, so all of their checks apply. DEFECT: the copy loop writes the length byte with " +
    "`move.b d0,(a0)+` and then `dbra d0` over the characters, so it writes LENGTH + 1 of them --- one byte " +
    "past the name into the field's padding, and the byte is whatever followed the AMOS string.",

  "s track load":
    "Routines 88 and 89, defaulting to bank 7. Bnk.Reserve with Bnk_BitData | Bnk_BitChip under the name " +
    "\"Tracker \", the file read straight in, and a short read is error 0 rather than error 3. A filename of " +
    "129 characters or more is error 0 (the check is `cmp.w #128,d0 / Rbcc` AFTER a `subq.w #1`); a bank " +
    "number of 65536 or more is error 0; a failed reserve is error 1. The bank NAME is the whole of the type " +
    "system --- S Track Play checks the eight bytes in front of the data and refuses anything else.",
  "s track play":
    "Routines 96, 86 and 87, each pushing a default and falling into the next, so the bare form is " +
    "`bank, 0, 0`: from the top, for ever. It stops a running player first (`btst #14,Status`), then checks " +
    "the start against `950(a0)`, the song length, with `cmp.b 950(a0),d7 / rbhi` --- an unsigned BYTE " +
    "compare, so a start equal to the length is allowed and one past it is error 25. An ADDRESS above 65536 " +
    "skips the bank-name check entirely, which is how a program plays a module it loaded some other way. NOTE " +
    "mt_init writes `#100` into mt_VolFaktor every time, so an S Track Volume set BEFORE the play is set for " +
    "nobody. The player is stock PT2.3A plus five things: the speed seeded from TrackTempo rather than from 6, " +
    "the volume factor, the Status2 channel mask, times_to_play, and a start position. It has no CIA tempo at " +
    "all --- every Fxx goes to mt_SetSpeed --- so unlike every other replayer in this port it needs no " +
    "deviation note about ticking once a vertical blank: SLN's ticks once a vertical blank too.",
  "s track stop":
    "Routine 90 --- `btst #14,Status` first, so it is safe when nothing is playing, then mt_end, which " +
    "silences only the voices Status2 does NOT claim. A sample playing under the music keeps playing.",
  "s track volume":
    "Routine 91, and it is a PERCENTAGE. NOTE the name: Sln_ext_Historie lists it as 'S Track Volume=' and the " +
    "token table spells it without the equals, so the Historie is stale and the table is what a program has to " +
    "type. The factor is applied at the instrument trigger ONLY --- `mulu.w d5,d0 / divu #100,d0 / cmpi.w " +
    "#64,d0 / bgt` in mt_PlayVoice --- where Cxx and the volume slides write the channel volume straight to " +
    "AUDxVOL with no factor, so a channel that slides escapes the setting until its next instrument. There is " +
    "no range check; anything above 100 makes the module louder up to the clamp at 64. DEVIATION: the machine " +
    "writes the scaled value to the hardware and keeps the UNSCALED one in n_volume, so a slide after a " +
    "trigger resumes from the sample's own volume; Protracker.trigVolPercent puts the scale on the channel " +
    "volume itself, so a slide resumes from the scaled value. The two agree until a channel both triggers an " +
    "instrument and slides its volume while a factor other than 100 is set.",
  "s track length":
    "Routine 92 --- the byte at 950, a MOD's song length in positions. NOTE it uses `blo` where S Track Play " +
    "uses `ble`, so 65536 exactly is an ADDRESS here and a BANK there, and it does not check the bank's name: " +
    "it will read 950 bytes into anything.",
  "s track tempo=":
    "Routine 93 --- it writes TWO things. The extension's own TrackTempo byte, which seeds mt_speed at the " +
    "next S Track Play, and mt_speed itself through mt_SetTempo, which also clears the tick counter so the " +
    "change lands on the next row rather than mid-row. A tempo of 0 stores 0 and the player's `blo` against a " +
    "speed of zero never matches, so the module freezes on its current row.",
  "s track tempo":
    "Routine 94 --- the extension's TrackTempo byte, and NOT the player's live speed. An Fxx in the module " +
    "moves mt_speed and leaves this alone, so the two disagree the moment a module sets its own.",

  "stick joy":
    "Routine 5 ($432), reading CIA-A PRB ($bfe101) bits 0-3. The manual calls this the serial port throughout; " +
    "the register says otherwise — CIA-A PRB is the parallel-port DATA register, and Stick Fire's $bfd000 bits " +
    "0-1 are BUSY and POUT, also parallel.",
  "stick fire":
    "Routine 16 ($8ce), CIA-B PRA bits 0 and 1. The TWO-argument form is a deliberate dead end and the manual " +
    "owns up to it: 'I shouldn't really tell you this ... but if you enter =Stick Fire(Jport,button) it will " +
    "return an error (This command has been provided so it can be easily updated to handle more buttons in later " +
    "version)'.",
  "stick scan":
    "Routine 6 ($4ea), two instructions: a POTGO write starting the paddle conversion that Stick X and Stick Y " +
    "read a frame later.",
  "stick x":
    "Routine 7 ($4f8): POT0DAT or POT1DAT, low byte.",
  "mouse x":
    "Routines 22/23 ($b16/$b46) and their function forms. The manual's BUGS entry corrects an earlier edition's " +
    "syntax: 'instead of Mouse X = value (as stated) use Mouse X Mouse Number,value'. DEVIATION: on the real " +
    "machine each mouse is its own accumulator fed from its own port, so mouse 0 and the AMOS pointer can drift " +
    "apart; there is one pointer here so they cannot, and mouse 1 has nothing driving it and holds wherever it is " +
    "put",
  "mouse clip":
    "Routine 19 ($a66), both arities.",
  "mouse button":
    "Routine 21 ($ab4). The manual's table lists 3 as 'Middle Button Pressed', which the code does not support — " +
    "no third line is read anywhere in the routine",
  "mouse area":
    "Routine 28 ($c96): reads the tracked pair for that mouse and calls AMOS's own zone test at $48 off the " +
    "library base.",
  "ctext":
    "Ctext x,y,text$ — routine 7 ($570). A font is an AMOS ICON BANK plus a 768-byte side table, which is what " +
    "its own documentation describes ('easy to use icon based text displays', CText.FONTS/Please_Read_Me!). " +
    "DEVIATION: the callee is identified by what the surrounding code hands it rather than by name — `jsr " +
    "$11c(a0)` off `-$4(a5)` resolves to no plausible entry under either table indexing, and AMOS's own source " +
    "has no equate for that offset",
  "font size":
    "Font Size w,h — routine 5 ($4c4), five instructions writing the two longs to +$a and +$e.",
  "plen":
    "Plen(text$) — routine 6 ($4d6). Runs the same character walk as Ctext with nothing drawn: both routines " +
    "`Rbsr routine 10` and then step the string identically, so the measurement cannot disagree with what Ctext " +
    "will lay down.",
  "font base":
    "Font Base — routine 8 ($67e), three instructions handing back the block address so a program can poke the " +
    "scalars directly.",
  "font data":
    "Font Data — routine 9 ($688): the block address plus $1e, the first of the three tables.",
  "kern$":
    "Kern$(n) — routine 11 ($6ca).",
  "blit clear":
    "Faithful including the off-by-one, which contradicts the manual. The named-plane guard is then `subq.w #1,d0 " +
    ": cmp.w d7,d0 : bge <error>`, so a named plane has to be strictly below d7 and **the top bitplane cannot be " +
    "cleared by name**: on an 8-colour screen the manual's own wording, 'An 8 colour screen has 3 bitplanes, " +
    "numbered 1 -> 3', fails on 3. The binary wins over the manual, the same rule that settled LDos's crypt " +
    "routines. DEVIATION: where the low word is zero or negative the routine passes its own guard with d0 " +
    "negative and walks 65536 plane pointers into memory; that is unreproducible corruption, so it is reported as " +
    "the same error the in-range failure gives Evidence: Routine 48 ($18b0).",
  "blit speed":
    "Faithful including the defect. The manual's plain description ('you can change the SHIFT (speed) value after " +
    "you have defined a scrolling zone') is true only from 8 up",
  "blit int on":
    "Installs a VBLANK server at priority 9; here the runtime's vertical blank runs it once a frame, before the " +
    "starfield's, which is the order the two priorities give. What cannot follow is the timing — on the real " +
    "machine the server is preempted by anything that owns the blitter, which is why the manual warns against " +
    "running Scene 16/32 Do with the interrupt on",
  "set planes":
    "Writes rp_Mask, so it restricts AMOS's own drawing as well as TURBO's, as the manual says ('All normal " +
    "graphic AMOS commands use this parameter'). The keywords the manual lists as ignoring the mask (F Draw, F " +
    "Plot, F Point, F Circle, Plane Offset) ignore it here too",
  "display stars":
    "The plot is a bset into the first bitplane, the wrap is the routine's own — including the bug the author " +
    "owns up to in the Stars Clip entry ('This instruction works fine now as it is, but is not really finished " +
    "yet...somethimes you don't get what you want!'), where wrapping past the left edge folds the overshoot into " +
    "the register holding the right edge and every later star in the same pass wraps a column further in. What is " +
    "not reproduced is what happens off-screen: the routine computes a byte address from its precomputed row " +
    "table and checks nothing, so a star outside the screen — or a screen other than the one Reserve Stars ran " +
    "on, which the manual warns about in capitals — writes over whatever is there.",
  "stars int on":
    "Installs a VBLANK server at priority -40; here the runtime's own vertical blank calls it, once a frame, " +
    "after AMOS's.",
  "reserve object chip":
    "1.9 splits Reserve Object into Chip and Fast variants, and routines 28 and 29 differ in exactly one " +
    "longword: the AllocMem flags, MEMF_CHIP against MEMF_FAST.",
  "object draw":
    "Faithful for any object that ends in a Stop element, which the manual demands in capitals: 'Make sure that " +
    "the last ELEMENT of an OBJECT definition is a Stop instruction. And nothing unpredictable will happen.' " +
    "Without one the four draw routines fall out of the attribute branch straight into the Move code and read " +
    "four bytes past the vector list — the unpredictable thing the manual is warning about.",
  "object save":
    "Writes the file the routine writes: 'OBJE', a word holding END-START, then a count word and COUNT*6 bytes " +
    "for each defined object, silently skipping the ones that are not — which leaves a file Object Load reads " +
    "short, exactly as the original does. The manual's claim that a name over 80 characters means 'nothing will " +
    "happen' is wrong — the routine raises AMOS error 21, and so does this",
  "lfreq":
    "LDos does not draw this requester — it calls req.library, which the manual gives away when it apologises " +
    "that 'Currently the req.library doesn't support CG-fonts'. Approximated for the substitution, not for the " +
    "plumbing",
  "lpp decrunch":
    "Decrunches PP20 with the decoder Ppload already uses, whose correctness is established in " +
    "powerpacker.test.ts against reference decoders and a genuine crunched file. One deliberate departure: the " +
    "manual is emphatic that 'no test is done to see if the bank really contains a powerpacked file!",
  "lpp mem":
    "Reads the decrunched length out of the PP20 trailer's top 24 bits, which is why the manual insists END be " +
    "the true end of the file rather than of the bank ('AMOS's banks are always rounded off to the nearest " +
    "multiple of 4'). It does no validity checking, exactly as documented — arbitrary data returns whatever its " +
    "last longword happens to say, and routine 40 ($1aec) shows how literally: nine instructions, `andi.l " +
    "#$ffffff00` then `asr.l #$8`.",
  "lansi":
    "Translates ANSI escape sequences into the AMOS console's own control codes — ESC P n for pen, ESC B n for " +
    "paper, ESC X/Y n to locate, ESC O/N with a +128 bias for relative moves (screen.ts, +Lib.s ChXxx) — which is " +
    "what a BBS terminal written in AMOS needs. The manual's table is implemented as given, including its own " +
    "stated limits: only Italics, Inverse and Underline are supported and other styles are ignored, and changing " +
    "style does not clear the previous one. An escape split across calls is carried over, as documented. Routine " +
    "69 ($2682) corrected five arms the manual could not have settled: ESC[K, ESC[M, ESC[J and ESC[L are single " +
    "`move.b`s of 7, 26, 25 and 20, ESC[n@ is 18 repeated, and a bare form feed is 25 -- ClEol, ClLine, Clw, " +
    "ScBas and ScDLine in AMOS's own control table (+W.s:16570).",
  "lopen":
    "Files are read into memory whole on open and written back on Lclose, so the manual's warning that an " +
    "unclosed file can corrupt the disk holds in the sense that the writes are simply lost — it cannot corrupt " +
    "anything else. NOTE: an empty filename is a buffer overrun in routine 1 and is not reproduced — the name " +
    "copy is `move.w (a0)+,d0 / subq.w #$1,d0` followed by a dbra, so a zero length underflows to $FFFF and " +
    "writes 65536 bytes across LDos's own workspace.",
  "lsys stamp":
    "Reads the host clock, which defaults to a fixed date so a headless corpus run stays reproducible; a host " +
    "with a real clock (the browser) supplies one. Nothing about the keyword is approximated — what varies is " +
    "whether the machine it runs on has a clock, which is a property of the host rather than of the port",
  "lsys time":
    "As Lsys Stamp. Formats HHMMSS with no separators, which the manual is explicit about: \"No extra \":\",\".\" or " +
    "\"-\" is added so that you easily can process this string to the format you like\"",
  "lcrypt":
    "LdosV25.DOC documents the calling convention and says nothing whatever about the cipher, so this was read " +
    "out of AMOSPro_Ldos.lib itself — Lcrypt at $4400, disassembled with capstone. The byte-width of the add is " +
    "the part a manual could never have conveyed and the part that matters: widen it and the key diverges after " +
    "one character. The disassembly is short, unambiguous and its two routines are exact inverses, and the tests " +
    "hand-simulate the 68k key loop as an independent check — but this is evidence of a different kind from " +
    "source or a manual, and it is recorded as such",
  "ldecrypt":
    "The inverse of Lcrypt, at $4436, and the only one of the pair that validates its argument: it opens cmp.w " +
    "#4,d0 / bcc, while Lcrypt has no length check at all. So the manual's 'an error will be produced if the " +
    "password is less than 4 characters long' is true of one of the two keywords, which the binary shows and the " +
    "documentation does not.",
  "get high word":
    "Faithful, and it is not what the doc says. Evidence: routine 6 ($7ae).",
  "cpu clear":
    "Faithful, which here means it always fails. Evidence: Routine 26 ($12c8).",
  "init cpu clear":
    "Returns zero. This is a defect in the library rather than a limit of the port: the return register d4 is " +
    "never initialised, and every failed validation branches straight to the exit that returns it, so most inputs " +
    "hand back whatever the caller happened to leave in d4.",
  "tft error$":
    "Returns the empty string, and the reason is the keyword's own premise.",
  "locale active":
    "Non-zero, which is the port choosing to report locale.library as PRESENT.",
  "catalog active":
    "Faithful, including the defect. NOT reproduced is a later Catalog String$ following the dangling pointer " +
    "into freed memory: here the catalog is gone and the caller's default comes back, which is what the routine " +
    "would do if the field had been cleared properly",
  "open catalog":
    "The catalog is read and parsed here, because on the machine that is locale.library's job rather than the " +
    "extension's -- OpenCatalogA is behind the shim.",
  "format date$":
    "Every directive the doc lists, plus %q and %Q which it does not -- and which matter, because the built-in " +
    "locale's own time formats are made of %Q, so without them Time$ would print a literal Q. Two deliberate " +
    "departures from AROS, whose FormatDate this is written against: %j is leap-correct here where AROS computes " +
    "mday+dayspermonth[month] with no adjustment while its own %U/%W apply one (the two disagree from 1 March of " +
    "any leap year, and the source carries a 'TODO: Julian date not tested' beside it), and %Z expands to nothing " +
    "because AROS marks it 'Unimplemented in 3.1'. %I is left as AROS has it -- hour%12, so noon and midnight " +
    "both print 00 -- and flagged as the one directive whose output looks wrong rather than merely different",
  "date$":
    "One of six keywords that are Format Date$ with a locale-supplied format string.",
  "locale string$":
    "The whole table now, from AROS rather than guessed: ids 1-51 with DAY_1..7, ABDAY_1..7, MON_1..12, " +
    "ABMON_1..12, YESSTR, NOSTR, AM_STR, PM_STR, the hyphens and quotes, and the relative day names. " +
    "english.language stops at FUTURESTR (50) even though MAXSTRMSG is 52, because the id above it is LANG_NAME " +
    "which locale.h marks V50 -- an addition the v38 library this extension opens never had.",
  "locale compare":
    "Faithful, and it CORRECTS the documentation.",
  "locale upper$":
    "locale.library's own ISO-8859-1 code table, so Locale Lower$, Upperchar and Lowerchar are all one lookup.",
  "emit catalog description":
    "Opens the file the way the routine does -- `move.l #$3ee,d2` is MODE_NEWFILE and `jsr -$1e(a6)` is " +
    "dos.library Open, after `cmpi.w #$25,$14(a0)` checks for dos.library 37 or better, which is the doc's [2.0] " +
    "marker -- and every Catalog String$ call thereafter appends an entry, emitted BEFORE the lookup ($57a " +
    "precedes $592) so the DEFAULT string is what gets recorded rather than the translation.",
  "jvp bin sort":
    "Faithful, including two defects of the library's that a program can see. What is NOT reproduced is what " +
    "happens after either overruns its buffer: the doc's own warning is 'The memory area is NOT checked in any " +
    "way, so make sure you got it right, or CRASH', and here reads outside a resolved region answer 0 and writes " +
    "outside it are dropped.",
  "jvp str$":
    "Faithful to the intent, and the shipped binary does not quite express the intent.",
  "jvp msg bank":
    "The bank number, recovered differently. Source: +Lib.s:7920.",
  "init bpl scroll":
    "The table is copied, the guard is honoured -- nine longs, error 6 if any is zero -- and the flag Start Int " +
    "waits on is set, so the error behaviour a program can observe is exact.",
  "start int":
    "Faithful.",
  "qsort":
    "Faithful, a Hoare partition over 32-bit values with the pivot from the middle element and a SIGNED " +
    "comparison (`cmp.l`).",
  "jd toggle click":
    "Routine 13 ($2da) is not one flag but FOUR drives: the body runs with d0 = 0, 1, 2, 3 and for each does " +
    "CreateMsgPort (-$29a), CreateIORequest (-$28e, $30 bytes), OpenDevice on 'trackdisk.device' -- the only " +
    "device name in the hunk -- then `movea.l $18(a3),a0 / bchg.b d0,$35(a0)` on the unit, and CloseDevice / " +
    "DeleteIORequest / DeleteMsgPort. DEVIATION: the state is kept and nothing clicks.",
  "jd moff key":
    "Routine 142 ($7c12) reads CIA-A's keyboard serial register, because Jd Multi Off is exec's Forbid and a " +
    "forbidden system stops updating AMOS's own key state. DEFECT: this routine does neither. Not reproduced: the " +
    "`beq` loop meant to debounce it falls straight through in every case but one — the key being released " +
    "between its two reads, where the release byte matches exactly and the routine spins until another key is " +
    "touched.",
  "jd match":
    "Faithful, and worth recording because the library's own manual disagrees with itself. The matcher is the " +
    "AmigaDOS one LDos already needed, shared rather than written twice -- the manual documents the same syntax " +
    "down to `%` matching nothing -- and the `star` flag it takes is precisely what Jd Star Joker On/Off sets",
  "lrol":
    "The manual calls it 'a logical shift left' and the library's own error message agrees -- 'You can only shift " +
    "31 bits a time!' -- but routine 85 ($3af6) is `rol.l`, a rotate: the bits that leave the top come back in at " +
    "the bottom.",
  "lror":
    "The same rotate as Lrol, `ror.l` at $3b1e, and the same note applies to the manual calling it a shift",
  "lstrcmp":
    "Faithful to what the routine does, which is not what the manual sells.",
  "lcompress":
    "The format is read out of routines 83 and 84 rather than documented anywhere -- LZ77 with a run case over a " +
    "16-bit control-word bitstream, distances to 4098, matches to 271.",
  "ldecompress":
    "Faithful, including a wart worth stating plainly. So a stream whose last group is partial is decoded past " +
    "its end, and Ldecompress writes up to fifteen extra bytes and returns a length that counts them -- which is " +
    "what the manual's 'you must keep track of how large this bank need to be yourself' is really warning about. " +
    "DEVIATION: on the Amiga those trailing bytes are whatever memory followed the compressed data and so are " +
    "undefined; the reads past the end give zero here.",
  "lhicol on":
    "The flag itself is a byte in LDos's workspace and does nothing on its own; what it gates is Lansi's handling " +
    "of SGR 2, which raises pens into 8-15 (`add.b $2b22(pc),d0`, $2a32). The offset applies to the PEN only -- " +
    "the paper path at $2a1e has no counterpart -- so backgrounds stay in 0-7 in either mode, and SGR 0 clears " +
    "it. 16-colour mode is the default, as the manual says, which is why the keyword that exists to be called is " +
    "the Off one",
  "lset var":
    "Writes a file into ENV:, which is what a global environment variable actually is — SetVar with " +
    "GVF_GLOBAL_ONLY does exactly this — so the value is visible to Dir, to the browser file panel and to " +
    "anything else that reads the filesystem, and outlives the program the way it does on the real machine. NOTE: " +
    "the manual's 50-character limits on name and value are advice, not a check — routine 64 ($24da) measures the " +
    "value's length only to pass it to SetVar and counts to nothing, so they are no longer enforced here either. " +
    "Evidence: routine 66 ($25dc).",
  "ldisk font":
    "Reports whether the named font exists in the mounted Fonts: drawer and invalidates the disc font list so Get " +
    "Rom Fonts picks it up, which is what the keyword is for. Two documented behaviours are not reproduced: it " +
    "cannot distinguish 'already in memory' from 'not on the disk' (both return false, as the manual allows, but " +
    "for the wrong reason), and the real routine 'is designed to always try to scale the selected font with a " +
    "best match, it may return true even though the requested font wasn't available' — no scaling happens here, " +
    "so a near-miss size fails where the original would succeed",
  "llobuffer":
    "The manual calls this keyword Llowbuffer; the token table in the library says Llobuffer, and the table is " +
    "what a program is actually written against. DEFECT: it does NOT convert A-Z only, whatever the manual says. " +
    "The two also disagree about their far end: routine 45 tests for the end of the range BEFORE its increment " +
    "and routine 44 after it, so Llobuffer includes STOP and Lupbuffer excludes it. One instruction's position, " +
    "and no manual could distinguish them Evidence: Routine 45 ($1c72).",
  "lchk data":
    "The manual gives no algorithm, only 'CHK will contain the checksum itself'. Evidence: routine 67 ($2634).",
  "lchk boot":
    "Likewise undocumented, and a different algorithm — an end-around-carry sum over both boot blocks, holding " +
    "out long index 1, complemented — exactly as the manual warns ('you must not use Lchk Data for the bootblock " +
    "and Lchk Boot for datablocks'). DEFECT: the complement is `neg.l d3 / beq .done / subq.l #$1,d3`, so a block " +
    "whose other 255 longs sum to exactly zero answers 0 where the rule says -1. Evidence: routine 68 ($2658).",
  "llargest free":
    "Reports the largest single allocatable block rather than the total, which is the distinction the manual " +
    "draws against Chip Free/Fast Free: 'This value is NOT the same as the AMOS commands Fast Free and Chip Free, " +
    "they return total unallocated memory-size, not the largest size you can allocate in one bank'. Answering " +
    "that would make this keyword identical to Chip Free and contradict its own manual, so the figure is the " +
    "pool's free total capped at half a megabyte.",
  "lcat type":
    "Returns fib_DirEntryType from a real AmigaDOS FileInfoBlock — 2 for a directory, -3 for a file, not 1 and " +
    "-1. The manual only says \"positive ... or negative\", which several values satisfy; the disassembly is a bare " +
    "move.l $4(a0),d3 over the FileInfoBlock, so the entry type is handed back verbatim. Every sibling accessor " +
    "indexes the same structure at its documented offset",
  "lfile type":
    "Returns the same fib_DirEntryType values as Lcat Type (2 and -3). Its own routine could not be decoded " +
    "cleanly — the success path goes through an AMOS library-call macro capstone does not recognise — so this is " +
    "inferred from the sibling keyword, which is documented in identical words and demonstrably returns the raw " +
    "entry type",
  "lcat first":
    "A lock, not a first entry: it returns the directory and Lcat Next walks the contents, which is AmigaDOS " +
    "Examine()/ExNext() rather than AMOS's Dir First$/Dir Next$. The manual says as much and the author's own " +
    "Lrecursive.AMOS settles it — the result of Lcat First is discarded there and every entry comes from Lcat " +
    "Next. What it RETURNS was the open question, because the manual calls it 'the file- or directoryname' in one " +
    "place and 'the path, requested by you' in another and no example prints it. Evidence: Routine 20 ($1466).",
  "lcat blocks":
    "Disassembly shows the real routine simply returns fib_NumBlocks from the FileInfoBlock — the filesystem's " +
    "own count, including the file header and any extension blocks. There is no block accounting in a virtual " +
    "filesystem to produce that from, so this reports ceil(size / 512), the FFS data-block figure the manual " +
    "quotes: right in magnitude, low by the filesystem's overhead, and approximated for exactly that reason " +
    "rather than from any doubt about what the original does",
  "lcat push":
    "The real Lcat Push writes a lock and a FileInfoBlock into 264 bytes of a bank the caller reserved — 4 plus " +
    "260, which is exactly what routines 70 ($32f4) and 71 ($3336) move. Programs that follow the manual — " +
    "reserve a bank, advance by 264 per level, pull in reverse — behave identically; a program that inspected or " +
    "copied those 264 bytes would not, and the manual's warning that a bank holding something else 'MAY crash if " +
    "you're unlucky' has no counterpart here. Neither routine validates anything, which has two consequences now " +
    "reproduced: pushing with no catalogue open stores a null lock rather than doing nothing, and pulling a bank " +
    "of zeros is SILENT — the documented 'No more entries in this dir' comes from the next Lcat accessor finding " +
    "the null at $294, not from the pull",
  "ldev first":
    "Walks the mounted volumes and then the assigns, returning names without a colon as the manual specifies.",
  "ldev next":
    "Continues the Ldev First walk; see that entry for what is not modelled",
  "lldir$":
    "LDos keeps its own current directory, which is the entire reason the keyword exists: the manual explains " +
    "that Ldos never notices a Dir$ change, so a relative Lopen after one would fail. Routine 82 ($37de) adds two " +
    "error arms the manual does not mention: an empty string is error 18 and anything that will not Lock is error " +
    "22, \"LLdir$ can't find directory!\". NOTE: the routine leaks a lock per call — neither the new one nor the " +
    "one CurrentDir hands back is ever released — and there is nothing to reproduce here, the current directory " +
    "being a string",
  "lset comment":
    "Raises error 5, \"Invalid comment\", above 79 characters rather than truncating — `cmp.l #$4e,d0` against the " +
    "length less one in routine 15 ($11e8).",
  "lset prot":
    "Two error arms, both from routine 17 ($129c): an empty name is error 3 and SetProtection answering zero — " +
    "what a name that does not exist gives — is error 6. DEVIATION: the mask goes to SetProtection as a full " +
    "longword and is kept as a byte here, so the four AmigaDOS-reserved upper bits do not survive; nothing reads " +
    "them, Lget Prot coming back through the same byte",
  "lget prot":
    "Protection bits are stored per path in the virtual filesystem, since most volumes here are read-only (a disk " +
    "image, a zip) and the bits must be settable regardless. Nothing enforces them: the manual notes that even " +
    "real DOS 'doesn't care about some flags when it comes to directories' and that 'if you are running Kickstart " +
    "1.2 or 1.3 DOS neglects most flags', so unenforced flags are within the documented range of behaviour — but " +
    "here no flag is enforced at all",
  "lset file date":
    "Stores the datestamp, minutes and ticks — routine 81 ($3772) writes them into a DateStamp and calls " +
    "dos.library SetFileDate, whose result comes back verbatim, so a name that does not exist answers 0.",
  "ldate":
    "Converts a datestamp to YYMMDD. The manual bounds the range at 2099 ('which should be enough?') and " +
    "specifies that a negative stamp returns 780101, both of which hold here; the two-digit year is ambiguous " +
    "past 2000 in exactly the way the original is",
  "lmatch":
    "The pattern syntax is fully documented — ? # (a|b) ~ [abc] [~abc] a-z % and the optional * — and is " +
    "implemented in full, including negation, which is why it is a backtracking matcher rather than a RegExp. " +
    "Three checks the manual does not describe: both strings are verified NUL-terminated (error 23) rather than " +
    "the terminator being assumed, a pattern of more than 50 bytes including its terminator is error 16, and " +
    "ParsePattern answering 0 — a pattern with no wildcards in it — takes that same error arm, which is what the " +
    "'or no pattern' in the message means Evidence: routine 61 ($23c4).",
  "lwild":
    "Returns ParsePattern's result verbatim — routine 80 ($3724) is `jsr -$348(a6) / move.l d0,d3` — so 0 for no " +
    "wildcards, 1 for wildcards and -1 for a pattern that will not parse. The manual sanctions the middle case " +
    "loosely ('TEST may contain anything (usually 1)') and says nothing about the third. Here the string ends " +
    "where it ends, which is the same answer for any caller who follows the manual and appends Chr$(0)",
  "lword":
    "A quoted word comes back with its quotes still attached, which the manual calls out as deliberate and " +
    "surprising: a NULL word (\"\") returns two quote characters rather than an empty string, so callers can tell a " +
    "quoted phrase from a bare one",
  "lskip":
    "Returns the address after the last skipped character. DEFECT: when every byte matches it answers STOP-1, not " +
    "STOP. Evidence: Routine 48 ($1d84).",
  "lback hunt":
    "Scans backwards over STOP..START-1 — the comparison in routine 74 ($33a8) is `cmp.b -(a0),d0`, a " +
    "PRE-decrement, so START's own byte is never examined — and returns STOP when the character is absent. The " +
    "manual does not say what an unsuccessful search returns, and the routine cannot distinguish it from a hit at " +
    "STOP either; STOP is the boundary the search ended at rather than a documented sentinel.",
  "lold":
    "NOTE: the manual is wrong about this one and the binary settles it. Evidence: Routine 7 ($1014).",
  "lcreate":
    "As Lold, and the same correction: routine 8 ($101a) is `moveq #$1,d3 / moveq #$0,d2 / rts`, integer 1, the " +
    "MODE_NEWFILE argument.",
  "lbstr":
    "The manual warns 'No check is done to see whether the bufferlimit was exceeded or not so make sure there is " +
    "room for the string'.",
  "lsave":
    "Returns the bytes written, and the manual's disk-error cases ('disk full, or write error', dos.library " +
    "returning -1) have no counterpart in a browser filesystem, so a short write can only happen when the source " +
    "address runs out",
  "set tempras":
    "size/address validated and stored; the chunky renderer needs no temporary raster buffer",
  "bstart":
    "the previous-program bank list needs a parent program (editor/Prun) — standalone the faithful failure paths " +
    "apply",
  "blength":
    "the previous-program bank list needs a parent program (editor/Prun) — standalone the faithful failure paths " +
    "apply",
  "bgrab":
    "the previous-program bank list needs a parent program (editor/Prun) — standalone the faithful failure paths " +
    "apply",
  "bsend":
    "the previous-program bank list needs a parent program (editor/Prun) — standalone the faithful failure paths " +
    "apply",
  "disc info$":
    "format is exact (volume name + 10-char left-aligned free bytes); the free count is the Dfree constant — " +
    "browser storage has no real quota",
  "dfree":
    "no real quota in the browser store — a large constant",
  "amal":
    "the Amiga tells a bank program number from an AMAL string by whether the argument is below 1024, too small " +
    "to be a string pointer (InMb1 +Lib.s:11857); our values are typed, so anything numeric takes the bank path " +
    "and a number above 1023 is a program number here rather than a stray pointer dereference",
  "anim":
    "the bank-program/string discrimination is by value type, like amal",
  "move x":
    "the bank-program/string discrimination is by value type, like amal",
  "move y":
    "the bank-program/string discrimination is by value type, like amal",
  "prun":
    "the editor keeps a Prun'd accessory resident and re-enters it in place (Prg_AccAdr/Prg_DejaRunned, " +
    "+ILib.s:1552), so on the Amiga an accessory Prun'd twice can still be holding its variables; with no editor " +
    "to own that residency the port loads a fresh structure each time, which is the same path the Amiga takes for " +
    "a first Prun. Source: +ILib.s:1401.",
  "amplay":
    "SetPlay (+W.s:7937) walks one list holding all four slot kinds per channel (Amal, Anim, Move X, Move Y) and " +
    "so also writes the internal registers of the STOS slots of the channels below the last; only the AMAL slot's " +
    "registers are reachable from BASIC or used by PLay, so the port writes just those",
  "autoback":
    "mode 1 treated like 0",
  "rainbow":
    "rendered per scanline by the copper-walk compositor across the PAL overscan window (hardware lines 26-311)",
  "copper off":
    "the interpreted list now takes its fetch geometry from the registers rather than from the screen the " +
    "pointers happen to hit. Source: +W.s:6293; +W.s:6822.",
  "cop logic":
    "a mapped chip-RAM address; the system list is regenerated every vbl (the T_Actualise change-gating is not " +
    "modelled)",
  "hardcol":
    "FnHardcol +Lib.s:12353 -> HColGet +W.s:115, over a CLXDAT computed from where the sprites and playfields " +
    "actually are. Deviation: the real register accumulates what the beam passed over during the frame and clears " +
    "on read; this samples the current positions, which agrees for the usual move / Wait Vbl / test but not for a " +
    "sprite moved twice within one frame Source: +W.s:159.",
  "set hardcol":
    "InSetHardcol +Lib.s:12346 -> HColSet +W.s:10018: CLXCON gets a fixed $F in the odd-sprite enables (AMOS " +
    "never exposes those), the first argument in ENBP1-6 and the second in MVBP1-6, so a playfield pixel counts " +
    "as solid when every enabled plane carries the matching bit",
  "ldir":
    "InLDir +Lib.s:5842 is InDir with ImpFlg set, and ImpFlg is the one thing ImpChaine (+Lib.s:5413) tests " +
    "before it prints — set, the line goes to PRT_Print instead of the window.",
  "ldir/w":
    "InLDirW +Lib.s:5793: the two-column form of the same, likewise to the printer",
  "read text":
    "InReadText1/3 +Lib.s:14707 -> IRText 14755: the ASCII reader is not native code at all, it is dialog program " +
    "1 of the system default resource bank, run on its own EcFsel screen sized PI_RtSx x PI_RtSy.",
  "set accessory":
    "the token table points this at L_InNull (+Lib.s:1474) and InNull is a single rts (+ILib.s:3748).",
  "set pattern":
    "SPat +W.s:4730: positive numbers index the mouse bank past its first four images, which are the pointer " +
    "shapes. Source: +W.s:16795.",
  "input$":
    "keyboard form is non-blocking best effort",
  "start":
    "fake address space: Start()-relative arithmetic works, absolute hardware addresses do not",
  "peek":
    "addresses inside banks and screen bitplanes (Logbase/Phybase) resolve; other addresses read 0",
  "poke":
    "writes into banks and screen bitplanes render; writes elsewhere are ignored",
  "shade on":
    "dither approximates the original shading",
  "match":
    "not-found result for closest index 0 returns -1",
  "dir":
    "plain listing; Set Dir width/filter cosmetic",
  "gr writing":
    "JAM1/JAM2 identical for solid draws; XOR implemented",
  "wind size":
    "resizes without preserving content",
  "border":
    "all styles render as the same simple frame",
  "sam raw":
    "unmapped addresses play nothing (the real machine plays whatever memory holds)",
  "music":
    "the one-vbl repeat latch is modelled: a trigger enables DMA over the whole sample and the repeat pointers " +
    "are poked at the top of the next interrupt (Tracker +Music.s:1678-1688), so the first pass always plays in " +
    "full. Source: +Music.s:1774.",
  "mubase":
    "only the vumeter bytes (MB+0..3) of the data zone are mapped",
  "track play":
    "the one-vbl repeat latch is modelled (see music); the pattern argument is ignored (\"not supported in this " +
    "version\" in the 68k too)",
  "med play":
    "the replay reimplements the MMD0/MMD1 format (medplayer.library is not in the AMOS source): sampled " +
    "instruments and the common effect subset; synthsounds are silent; CIA timing approximated at vbl granularity",
  "med midi on":
    "flag stored; no MIDI output exists in the port",
  "sam swap":
    "the swap is consumed when a one-shot ends; on a looping voice the Amiga swaps at the loop boundary, here it " +
    "stays pending",
  "sam swapped":
    "chunk-granularity 0 state (Sami_pos == one chunk) is not modelled",
  "noise to":
    "the WebAudio sink snapshots the noise buffer at trigger; the per-vbl random refresh mutates the live buffer " +
    "as on the Amiga but is only re-heard on retrigger there",
  "led on":
    "filter flag reaches the sink; audibility depends on the host audio implementation",
  "led off":
    "filter flag reaches the sink; audibility depends on the host audio implementation",
  "load iff":
    "every ILBM in the corpus (38 files) is decoded and checked structurally — one chunky byte per pixel, indices " +
    "within the declared plane count, RGB4 palette entries — and round-tripped through our own encoder back to " +
    "identical pixels, so the ByteRun1 unpacker cannot drift unnoticed.",
  "centre":
    "Border$ escapes inside the text are printed, not measured, when centring",
  "print":
    "Print # channels unsupported",
  "input":
    "line editing keys are host-side, not the AMOS line editor",
  "timer":
    "writable, drives the frame clock directly",
  "rnd":
    "Rnd(n) mixes a statement-paced pseudo-beam instead of the free-running raster, so runs stay reproducible; " +
    "Rnd(-n) is the pure generator exactly as on the Amiga",
  "jd exval$":
    "The original's own bug, not reproduced. Source: +|jd.s:1810.",
  "jd ror$":
    "An empty string. Source: +|jd.s:2903.",
  "jd rol$":
    "See Jd Ror$: an empty string is a runaway dbra on the machine and comes back empty here",
  "jd get string$":
    "The value is right and the editing is not.",
  "jd get number":
    "See Jd Get String$: the bound and the value are faithful, the field painting and the editing keys are the " +
    "host's",
  "jd find":
    "Answers 0 for a STRING array. Source: +|jd.s:3878.",
  "jd array$ clear":
    "Does nothing to a string array. Source: +|jd.s:6053.",
  "jd time$":
    "Reads the host clock, where the routine reads the hardware. Source: +|jd.s:1205.",
  "jd date$":
    "See Jd Time$: the hardware clock chip at $DC0000, answered from the host clock here",
  "jd spread":
    "The end state, not the animation. What is lost is the motion between those two states, which is the " +
    "port-wide timing deviation (#87) rather than a JD one",
  "jd tscroll":
    "See Jd Spread: the console state a program can observe afterwards is kept, the motion between is not",
  "jd type":
    "Two parts of this do not cross. Source: +|jd.s:3486.",
  "jd reduce dim":
    "The reduced bound is recorded but not enforced.",
  "jd dpath":
    "An empty path.",
  "jd cpu":
    "Answers 68020, and Jd Fpu 0 and Jd Chipset 2, for the machine this port already models rather than for a " +
    "real one.",
  "jd fpu":
    "See Jd Cpu: 0, a stock A1200 having no coprocessor",
  "jd chipset":
    "See Jd Cpu: 2, AA",
  "jd spline":
    "Draws in the current AMOS ink. Source: +|jd.s:4028.",
  "jd textfont":
    "Opens a real .font through diskfont and hangs it on the current screen's rp_Font, so AMOS's own Text draws " +
    "through it too -- which is what the manual means by \"for writing with >>Text<< or >>Jd Print<<\". DEVIATION " +
    "on failure: with no such face the 68k leaves font_font zero and reads those two words through it anyway, " +
    "picking up whatever sits at $14 and $18 and calling SetFont(rp, NULL) with it. Source: +|jd.s:4177.",
  "jd print":
    "Draws through the face Jd Textfont opened, at the TEXT cursor: Move(rp, X*fx, (Y+1)*fy-2) then Text, then " +
    "Locate(X+len, Y) (routine 89, +|jd.s:4215).",
  "jd checkprt":
    "Answers 0, no printer.",
  "jd key to asc":
    "Answers 0, always -- the one keyword in the Colour library whose behaviour is not reproduced. The manual's " +
    "example is `Jd Key To Asc(253) -> 49`, and 253 is not an Amiga rawkey, so those tables are AMOS's own rather " +
    "than the keyboard's. This port does not carry them, and 0 is what the routine itself answers for a code it " +
    "cannot find; inventing a mapping that satisfied the one documented example would be worse",
  "jd fit":
    "Answers 1 and 0, not AMOS's -1 and 0 -- `move.l #1,d3` is routine 55's true path (+|col.s:1862).",
  "jd swap colours":
    "Routines 26 and 27 (+|col.s:657, :679) validate nothing at all -- an index past the palette reads and writes " +
    "through get_colour/set_colour whatever is there.",
  "jd spread palette":
    "Faithful including the guards, which are stricter than they look: routine 7 (+|col.s:261) demands both " +
    "arguments in 1 to 31, so COLOUR 0 IS REJECTED with error 23 rather than clamped, a reversed pair is swapped " +
    "and retried, and a gap under two returns silently.",
  "jd prt center":
    "1.3 and 1.4 disagree, and the port answers per bound version rather than picking one.",
  "jd prt shade":
    "The five numeric Prt keywords call intuition's GetPrefs, poke one field of the Preferences structure and " +
    "call SetPrefs.",
  "dialog open":
    "SM screen-drag is a no-op; CA (machine code) raises a function call error; edit fields use a simplified line " +
    "editor",
  "fsel$":
    "Start_FSel -> End_FSel (+Lib.s:17756-19292) over dialog program 2 of the system resource bank: config-sized " +
    "screen, the FsV_ variable block, Fs_NomDir's path/filter split, the incremental Fs_First/Fs_Next read with " +
    "its sorted-insert view bump, Fs_GetName's Sizes column, all twenty Fs_Jumps zones, the Store directory " +
    "cache, Fs_Help type-ahead and the AppCentre slide.",
  "psel$":
    "FnPSel (+Lib.s:6771) is a bare rts — four token-table variants and no implementation anywhere in AMOS " +
    "Professional, so the keyword returns its last argument untouched. Nothing is approximated: this is what the " +
    "original does",
  "resource$":
    "all six blocks are present. -1..-1000 read the interpreter-config messages (Sys_Messages), still a " +
    "transcription and sparse where the original is; -1001 and deeper read the editor tables generated " +
    "byte-for-byte out of +Editor_Config.s by src/cli/genedmsg.ts (Ed_Systeme, the menu block from " +
    "bin/Editor_Menus.asc, the editor messages, the test-time errors and the run-time errors), and -6001 is a " +
    "function call error as FnResource has it.",
  "set slider":
    "system patterns come from the machine mouse bank (fixtures/machine); without it, dither stand-ins",
  "mouse zone":
    "FnMouseZone (+Lib.s:11077) is `moveq #0,d3 / SyCall ZoHd`, so it asks the CURRENT screen's zone table " +
    "through the same ZoEc/GZone pair Hzone uses -- which means the hardware coordinate is bounds-tested against " +
    "the displayed window before any zone is considered, and a point outside it answers 0 rather than falling " +
    "through to the table. Source: +W.s:11216.",
  "zone":
    "FnZone2/3 (+Lib.s:10974) -> SyZoGr -> GZone. Source: +W.s:10784.",
  "hzone":
    "FnHZone2/3 (+Lib.s:11009) -> SyZoHd -> ZoEc -> GZone, the same path Mouse Zone takes, so it inherits ZoEc's " +
    "bounds test as well as its hardware-to-screen conversion",
  "reserve zone":
    "InReserveZone0 (+Lib.s:10924) is `moveq #0,d3`, so the bare form reserves ZERO zones: SyResZ frees the old " +
    "table and SyRz1's `move.w d1,d0 / beq.s ZoOk` returns without allocating a new one.",
  "set zone":
    "Source: +W.s:11119.",
  "reset zone":
    "SyRazZ (+W.s:11094) on a screen with no zones returns 29, and InResetZone1 alone turns that into error 73 " +
    "rather than 23 (`.Err moveq #73,d0 / Rbra L_GoError`) -- the only place \"No zones defined\" is raised.",
  "set bob":
    "InSetBob +Lib.s:12225 -> ResBOB +W.s:988. Its SIGN chooses what it means, which the manual does not say and " +
    "only BbS1a-BbS1d (+W.s:1425-1439) does: 0 is the default %0000111111001010 = $0FCA, negative is a minterm " +
    "with bit 15 cleared and the channel-enable bits forced on, positive is the whole BLTCON0 used verbatim. " +
    "DEVIATION: the blit evaluates the truth table per pixel per plane rather than per word, so the RESULT is the " +
    "blitter's and the timing is not; and BLTCON1's shift, fill and descending-mode bits are ignored, since Set " +
    "Bob only ever supplies BLTCON0",
  "amos to front":
    "single-display host: the AMOS display is always at the front",
  "amos to back":
    "single-display host: nothing to lower",
  "amos lock":
    "the T_NoFlip flag is stored; no host flipping exists to suppress",
  "close workbench":
    "no Workbench memory to free",
  "close editor":
    "no editor memory to free",
  "dev first$":
    "the device list is the virtual file system volumes and assigns",
  "prg first$":
    "aliases Dev First$ exactly as the 68k does",
  "sprite base":
    "read-only synthesis, rebuilt when the image count changes; pokes are ignored and in-place pixel edits can be " +
    "stale until the count changes",
  "icon base":
    "read-only synthesis like sprite base",
  "hslider":
    "system patterns approximated as dithers",
  "vslider":
    "system patterns approximated as dithers",
  "array":
    "int/float arrays map to live arena blocks; string arrays (pointer tables on the 68k) stay opaque handles",
  "varptr":
    "arena slots: string blocks are snapshots that go stale on reassignment (as on the 68k); pokes flush back " +
    "while the length matches",
  "vdialog":
    "integer reads of string-valued slots return 0 (raw pointers are not carried)",
  "dialog box":
    "v$ seeds var 1 as a string, not an address",
  "sin":
    "FFP-precision (24-bit) result; matches mathtrans to ~24 bits, not necessarily the last bit",
  "cos":
    "FFP-precision result; last-bit mathtrans algorithm differences possible",
  "inc":
    "float targets get numeric arithmetic; the real machine mangles the FFP bit pattern",
  "dec":
    "float targets get numeric arithmetic; the real machine mangles the FFP bit pattern",
  "add":
    "float targets get numeric arithmetic; the real machine adds to the FFP bit pattern",
  "using":
    "the '^' scientific-exponent slot is left literal (mantissa normalisation unverified)",
  "shift up":
    "one shift per screen (the original has a single global shift); omitted wrap-flag defaults to wrap",
  "wind move":
    "trail behaviour matches; the Wind Save clean-erase path is not wired to Move",
  "key shift":
    "CapsLock reflects the physical key, not the latched toggle",
  "every":
    "fires at each statement rather than only at control points, and after (not during) a Wait — a timing nuance " +
    "tied to the blocking model",
  "text":
    "single 8x8 face whatever Set Font selects; soft styles are synthesized approximations",
  "bload":
    "bounded by the destination region; the real machine would overrun into raw memory",
  "mouse screen":
    "returns -1 when the pointer is over no screen (68k: EntNul)",
  "key speed":
    "parsed and discarded.",
  "menu called":
    "items redraw every frame; (PR name) label procedures are not invoked",
  "menu movable":
    "drag applies final positions — no XOR rubber band",
  "menu item movable":
    "drag applies final positions — no XOR rubber band",
  "sprite priority":
    "HsPri +W.s:11374. Source: +W.s:11742.",
  "set sprite buffer":
    "InSetSpriteBuffer +Lib.s:12290 with HsSBuf/HsRBuf (+W.s:11268/11311): the >= 16 check errors, and the size " +
    "is stored as n+2 lines, leaving n words per multiplexer column.",
  "dual playfield":
    "pairing is per-screen (EcDual) as on the hardware, so several pairs coexist down the display, each in its " +
    "own copper band, each with its own Dual Priority, and sprites layer between the two playfields per EcCon2's " +
    "PF1P/PF2P.",
  "screen open":
    "width masked to /16; the 1..1023 size bounds of EcCree are not enforced",
  "screen display":
    "the visible window w/h clips the composite; hardware scaling is not modelled. Source: +W.s:5955.",
  "screen colour":
    "HAM reports 64 — the real EcNbCol is stored as 64 by InScreenOpen, never 4096",
  "screen base":
    "a read-only synthesized Ec control block (EcLogic/EcPhysic, geometry, EcNbCol, live EcPal, EcTLigne...); " +
    "pokes into it are ignored",
  "set font":
    "real Amiga diskfonts render when a Fonts: drawer is mounted (drop one in the browser); without one, the " +
    "synthetic Workbench list with the 8x8 face stands in",
  "border$":
    "FnBorderD +Lib.s:14153 / Encadre +W.s:15169. Source: +W.s:9640.",
  "request on":
    "stored — the port never shows system requesters",
  "request off":
    "stored — the port never shows system requesters",
  "request wb":
    "stored — the port never shows system requesters",
  "prg state":
    "single-program runtime — returns the plain running state",
  "prg under":
    "single-program runtime — no AMOS program runs beneath this one",
  "comp here":
    "no native compiler overlay can load in the web port — always 0",
  "squash":
    "decodes/encodes the exact Squasher format; the encoder uses a greedy longest-match rather than ST Squasher's " +
    "pre-scan heuristic, so packed size may differ",
  "ppload":
    "The bank's NAME is inside the crunched payload, not in the PPbk header: B_Copie2Buffer (+CompExt.s:800-808) " +
    "backs up eight bytes from the bank's data pointer onto the name Bnk.Reserve wrote there, and B_Length sizes " +
    "the copy to match, so a saved memory bank is name-then-data and Ppload takes the name off the front. An " +
    "object bank has none -- B_Length's other branch is commented 'Pas le nom' (+CompExt.s:782) -- and this port " +
    "refuses those anyway. " +
    "PP20 decoder verified against genuine PowerPacker output (a real crunched AmigaGuide decodes byte-for-byte) " +
    "and against two independent reference decoders; the real crunch algorithm is a ROM library, not in the AMOS " +
    "source, so this is a from-format reimplementation of a verified-correct decoder rather than a source port.",
  "ppsave":
    "Writes a valid PP20 file — proven decodable by an independent reference decoder — but NOT bit-identical to " +
    "real PowerPacker output: powerpacker.library makes different (better) crunch choices, and its encoder is not " +
    "in the AMOS source, so byte-exact parity is unverifiable.",
  "edit":
    "InEdit +ILib.s:1858 returns to the AMOS editor (run-error 1000); there is no editor in the port, so the " +
    "program halts",
  "direct":
    "InDirect +ILib.s:1866 returns to direct mode (run-error 1001); no direct window exists in the port, so the " +
    "program halts",
  "free":
    "FnFree +Lib.s:13600 garbage-collects then reports TabBas-HiChaine (free variable space); no variable arena " +
    "exists here — returns a nominal figure",
  "chip free":
    "FnChipFree +Lib.s:2510 queries exec AvailMem(MEMF_CHIP).",
  "fast free":
    "FnFastFree +Lib.s:2517 queries exec AvailMem(MEMF_FAST).",
  "lprint":
    "InLPrint +ILib.s:5067 routes Print to the printer device; no printer host, so the arguments are evaluated " +
    "(for side effects) then discarded",
  "dual priority":
    "the EcE27 error message text is a guess — the string is not in the source tree",
  "hrev block":
    "RevBloc +W.s:12620 mirrors the block; the visible result matches, but the port reverses pixels directly " +
    "rather than via AMOS's stored orientation flag (bits $C000)",
  "vrev block":
    "RevBloc +W.s:12620 mirrors the block vertically; visible result matches, but via direct pixel reversal " +
    "rather than AMOS's orientation-flag mechanism",
  "allow plane col":
    "reaches _BPlanesMask correctly but always sets CLXCON bit 0: the routine shifts the plane left six before " +
    "`Bset d0,d1`, and Bset on a DATA register takes its bit number modulo 32, so n*64 is bit 0 for every n in " +
    "range",
  "forbid plane col":
    "the same modulo-32 Bset as Allow Plane Col — every plane clears the same CLXCON bit",
  "sprite col":
    "Personnal's own, registered under its slot (`ext13:sprite col`) because core owns the plain name and asks a " +
    "different question of different arguments — core's `Sprite Col(n[,first[,last]])` really checks a sprite " +
    "against a range.",
  "right click":
    "Personnal's is registered under its slot too, though TURBO Plus's reads the same button (POTGOR bit 10, " +
    "DATLY, port 0 pin 9) to the same answer — the agreement is a fact about the two libraries rather than " +
    "something to depend on",
  "set color":
    "the FUNCTION form does not read a colour.",
  "create aga":
    "differs from Create Standard in more than the colour block, which is easy to miss because the two routines " +
    "are otherwise line-for-line the same.",
  "change palette":
    "reads _ColorBase without checking it, unlike every keyword that patches the list by name — with no list " +
    "built it writes from address 0 onward, over the exception vectors.",
  "iff8bits to iff4bits":
    "every \"n entries\" keyword in the palette group subtracts one BEFORE the loop and ends on Bpl, so a count of " +
    "zero leaves the counter at -1 with the body already run: this (:3120), Change Palette (:2928), the two " +
    "Palette To Copper forms (:2957), Fade Palette (:3045) and Attribute Palette (:3087).",
  "iff8bits palette to copper":
    "the same unchecked _ColorBase as Change Palette",
  "iff4bits palette to copper":
    "the same unchecked _ColorBase as Change Palette, and no mask on the way in, so a 4-bit CMAP byte above 15 " +
    "bleeds into the channel above it",
  "fade palette":
    "steps each channel with a SIGNED byte compare (`Cmp.b` / `Blt`), so a channel of 128 or more reads as " +
    "negative and moves away from its target rather than towards it.",
  "new color value":
    "packs the channels with ADD where Set Color ORs, so a channel above 15 carries into the one above it instead " +
    "of overlaying it",
  "set second color":
    "Set Color's walk over the block, on _2pal, and error 7 rather than 1 when there is no second screen — but " +
    "New Color Value's ADD packing rather than Set Color's OR.",
  "playfields col":
    "answers -1 when the CLXDAT bit is CLEAR, the opposite of what the name suggests (Btst sets Z on a zero bit " +
    "and the Bne skips the -1); and there is no collision hardware here, so CLXDAT reads 0 and it always answers " +
    "-1",
  "pf sprites col":
    "the same inverted test as Playfields Col, and the same always--1 answer for want of CLXDAT",
  "blit mask":
    "BLTCON0 is $0F98, minterm $98 = (B AND C) OR (A AND NOT B AND NOT C) — NOT the $E2 mask-select the name " +
    "implies.",
  "l blit mask":
    "blits yEnd rows starting at yStart where L Double Mask subtracts properly — the demos hand both 64,128 on a " +
    "192-row screen.",
  "double mask":
    "the CPU form; computed as the source computes it, longword by longword",
  "l double mask":
    "subtracts yStart from yEnd, unlike its blitter twin",
  "blitter clear":
    "TWO extensions own this name and NOTES is keyed by name alone, so both belong here.",
  "blitter copy limit":
    "",
  "make pix mask":
    "Routine 225 ($51ce), 140 bytes, and three things in it were wrong. NOTE: the Reserve is `Rjsr routine 1103` " +
    "guarded by `Rbeq routine 389`, so a failure is error 24 rather than the 23 this port's reserveBank raises " +
    "for a non-positive length; only reachable for a degenerate box. NOTE: the subq pair was invisible until " +
    "src/cli/extdis.ts stopped believing its text heuristic -- those six bytes read as 'SFSG?F'",
  "blitter copy":
    "BLTCON0 $09F0, minterm $F0, computed rather than blitted; the first plane is copied before any null check, " +
    "so only the control block is guarded",
  "low filter.w":
    "filters exactly one element: the loop ends `Cmp.l a0,a1 / Blt`, which asks whether the END pointer is below " +
    "the current one — false on the first pass of any sane range.",
  "low filter.l":
    "the same one-element Blt as Low Filter.w",
  "f sprite":
    "indexes the copper list by n*4 where the eight sprite pointers are two MOVEs and so eight bytes apart — " +
    "`Lsl.l #2` should be `#3`.",
  "get even sprite":
    "writes over the extension's own variables instead of the reserved buffer: `DLea _SpriteBase,a0 / Move.l " +
    "a0,d1 / Move.l d1,a0` takes the ADDRESS of the variable and never dereferences it ($4592 in the binary).",
  "get odd sprite":
    "the same missing dereference as Get Even Sprite",
  "mplot draw":
    "the point range EXCLUDES `last` (:4027), where the guide says inclusive — every shipped demo writes `Mplot " +
    "Draw 1 To NUM` after reserving NUM, so the last point never draws on a real machine either.",
  "mplot modify":
    "the same exclusive range as Mplot Draw (:4136)",
  "mplot start plane":
    "out of 1..8 is a plain rts, not error 14 — routine 120's two range branches both target $6668, which IS the " +
    "rts.",
  "mplot load":
    "reads count*260 bytes into a buffer sized count*6+8 — 260 is the AGA icon stride and Mplot Save writes with " +
    "6.",
  "mplot save":
    "never sees its filename.",
  "set deform value":
    "writes sixteen slots that nothing in the library ever reads — the only instructions touching the 1.1 data " +
    "bank +$70 are this write and its own bounds check",
  "iff convert":
    "never reads BMHD's compression byte, so everything is decoded as ByteRun1 and an uncompressed ILBM comes out " +
    "as noise; and its literal/run split is `Cmp.l #$80,d3 / Bgt`, making a control byte of exactly 128 a " +
    "129-byte literal where the format reserves it as a no-op.",
  "fc cos":
    "a 360-entry table of the function scaled by 1000, included raw at :514 and not recomputable — " +
    "Math.trunc(fn*1000) misses ten entries.",
  "fc sin":
    "the same table lookup and the same broken normalisation for negative angles as Fc Cos",
  "fc tan":
    "the same again; both poles hold $7FFFFFFF, positive in each direction",
  "fire(1,2)":
    "POTGOR bit 14, port 1 pin 9 — a second fire button nothing here models.",
  "fire(1,3)":
    "POTGOR bit 12, port 1 pin 5; the same unmodelled second stick, the same idle 0",
  "vb line wait":
    "spins on VPOSR waiting for a beam position; there is no beam, so it yields the frame",
  "aga reserve icon":
    "writes _Icons BEFORE the allocation, so on a real machine a failed AllocMem leaves a count against a bank " +
    "that does not exist.",
  "aga erase icon":
    "clears _Icons before testing _IcBase, so the error-9 path leaves both zero either way",
  "mplot erase":
    "the same shape as Aga Erase Icon and it was missing here: no bank at all returns in silence, but a count " +
    "with no base is error 11, with the count already cleared before that test (:3740).",
  "mplot define":
    "bounds the point against the count in the bank HEADER (:3916) rather than the _Mplots register, so it bounds " +
    "what was actually allocated.",
  "pic pack":
    "produces the format the library's own Pic Unpack decodes, by the same two passes in the same order; the run " +
    "boundaries are proven by round-tripping through that decoder rather than against a reference file",
  "pic unpack":
    "a control byte of zero fills the rest of the PLANE rather than emitting nothing — its decrement never " +
    "satisfies the test.",
  "anim unpack":
    "Pic Unpack behind a frame table; the same zero-control-byte and end-guard behaviour",
  "plib ver":
    "Routine 3 of Personnal-EXTRA.Lib.S (:99), eight instructions: `DLea _Exist,a0 / Move.l (a0),d0 / Cmp.l #0,d0 " +
    "/ Beq LNOTLOADED / PsJsr AP_VERSION / Move.l d0,d3 / Moveq #0,d2 / Rts`.",
  "plib rev":
    "Routine 4 (:113), the same eight instructions as Plib Ver with `Move.l d1,d3` where it has `Move.l d0,d3` " +
    "--- the second half of the one AP_VERSION answer rather than a second call.",
  "display off":
    "Routine 3 (Misc_Extension.asm:106), two instructions: `move.w #$01a0,$dff096` and `move.w #0,$dff180`.",
  "display on":
    "Routine 4 (:111): `move.w #$81a0,$dff096`, bit 15 SET, the same three bits back.",
  "mouse off":
    "Routine 9 (:141): `move.w #$20,$dff096`, and $20 alone is SPREN. The manual says 'hides mouse and sprite 0'; " +
    "the register says ALL EIGHT sprites, because what goes is the DMA channel rather than a pointer. It also " +
    "cannot be undone — there is no Mouse On in the table, and the manual asks the reader to write one: " +
    "'Suggestion: If you want to expand this extension, why not make a Mouse On command?'",
  "dled on":
    "Routine 7 (:129) and its twin Dled Off (routine 8, :135), which differ in one byte: both write 127 then 119 " +
    "to $bfd100 (CIA-B port B, the disk control lines) and then Dled On writes 0 to $bfd300 while Dled Off writes " +
    "255. $bfd300 is the DIRECTION register. DEFECT: 0 makes the port INPUTS, so it stops driving the lines, they " +
    "float high through their pull-ups, the active-low /MTR goes inactive and the LED goes OUT; 255 makes them " +
    "outputs and drives the 119 still sitting in the data register, asserting /MTR and turning the LED ON. The " +
    "two keywords are the wrong way round, and the manual half-noticed — 'Turns on drive led, don't ask me, where " +
    "this is for, but maybe when the drive led doesn't stop reading, use the next command.' NOTE: the source " +
    "gives the four writes; that a released line reads inactive is 6526 behaviour supplied from the chip rather " +
    "than stated there",
  "dled off":
    "routine 8 (:135), the same four writes as Dled On with 255 where it has 0 — see it for which way round they " +
    "actually leave the LED",
  "firewait":
    "Routine 12 (:171): `btst #07,$bfe001 / bne` back to itself. The manual: 'Nothing else than While Fire(1)=0 : " +
    "Wend but more effective, cause it's in assembler.' A spin blocks the frame rather than the process here, " +
    "re-armed each frame as Vb Line Wait is; a program that never gets a press waits for ever, which is what it " +
    "would do on the machine",
  "clear ram":
    "Routine 11 (:159): `AllocMem(99999999, 0)` on ExecBase (`jsr -198`) and FreeMem (-210) if it returns. The " +
    "hundred megabytes are MEANT to fail — a failed AllocMem is what makes exec expunge unused libraries, devices " +
    "and fonts, so the manual's 'Cleans up Memory by deleting all not-used fonts, libs, etc.' is a side effect of " +
    "an allocation nobody wants to succeed rather than something the routine does. DEVIATION: nothing here is " +
    "expungeable, so this observably does nothing where a real machine would free memory and move Chip Free.",
  "disk wait":
    "Routine 13 (:176), two waits in order. DEVIATION: this returns at once — there is no floppy to insert " +
    "(volumes are mounted, not inserted) and no validator to outlive, and the alternative is to block for ever, " +
    "which would hang every program that uses it rather than reproduce anything. NOTE: the delay loop calls a " +
    "subroutine (:201) that is `movem.l a0-a6/d0-d7,-(sp)` immediately followed by the matching pop and an rts — " +
    "sixteen registers pushed and popped straight back, a deliberate burn that does nothing else",
  "c orange":
    "$A40.",
  "light green":
    "$2F2, and the reason it is worth a note is that the set is NOT computable.",
  "track tempo":
    "Routine 116 ($3e3a), 22 bytes: `move.l (a3)+,d0`, `clr.b $bcf(a0)` — the tick within the row — then `adda.w " +
    "#$bce,a0 / move.b d0,(a0)`.",
  "patt loop on":
    "Routine 113 ($3e16): `move.b #$1,$be9(a0)`, twelve bytes. NOTE: EME.doc says 'if used before Track Play, the " +
    "specified pattern will be repeated', and half of that is wrong.",
  "patt loop of":
    "Routine 114 ($3e22): `clr.b $be9(a0)`.",
  "patt loop no":
    "Routine 120 ($3e9a): `move.b #$2,$be9(a0)`.",
  "track sample on":
    "Routine 122 ($3eb2) is byte for byte routine 121, Track Sample Off: `movea.l $f8(a5),a0 / moveq #$9,d0 / " +
    "Rbra routine 123`, the error raiser, and message 9 is 'Only available in full version!'.",
  "track sample off":
    "routine 121 ($3ea6), the same twelve bytes as Track Sample On — see it",
  "trpos":
    "Routine 117 ($3e50), eighteen bytes: `moveq #0,d3 / moveq #0,d2 / movea.l $f8(a5),a0 / adda.w #$bd0,a0 / " +
    "move.b (a0),d3`.",
  "trlen":
    "Routine 118 ($3e62), the same eighteen bytes over $be7 — the song-length byte at $3b6 of a 31-sample module, " +
    "cached at Track Play and cleared by Track Stop.",
  "trpat":
    "Routine 119 ($3e74), 38 bytes.",
  "trstat":
    "Routine 115 ($3e2c), fourteen bytes: `move.b $be6(a0),d3`.",
  "med tempo":
    "Demo-build only — the AMOS 1.3 table has it and the AMOS Pro one does not. Evidence: Routine 112 ($3a82).",
  "tr credits":
    "Demo-build only. Evidence: Routine 119 ($3ae2).",
  "p61 play":
    "TWO extensions own this name and NOTES is keyed by name alone, so both belong here; they are registered " +
    "slot-qualified and a program gets whichever library it loaded. NOTE, and it bounds what any of that proves: " +
    "there is NO P61 module anywhere in the 6,400-program corpus or in the distribution, so the decoder is " +
    "faithful-to-the-assembly and UNVERIFIED against a file some other tool wrote; making it audible does not " +
    "change that.",
  "p61 stop":
    "Both extensions again.",
  "p61 pause":
    "Routine `L_P61Pause` in AMOSPro_P61A.Lib.s.",
  "p61 volume":
    "`L_P61Volume`.",
  "p61 fade":
    "`L_P61Fade1` and `L_P61Fade2`.",
  "p61 cia speed":
    "`L_P61CiaSpeed`.",
  "p61 signal":
    "`L_P61Signal`.",
  "p61 pos":
    "`L_P61Pos`.",
  "p61 continue":
    "`L_P61Continue`.",
  "p61 mvolume":
    "range-checks 0..63 and then the module, in that order, as routine 126 does; no audio",
  "p61 mpos":
    "routine 127 is routine 126 twice over — the SAME 0..63 range check raising the same error 20, whose message " +
    "is 'Les valeurs de volume vont de 0 a 63.' and is about volume in both, then the same library and module " +
    "checks.",
  "med fast load":
    "routine 17 is routine 5 with three different LVOs and error 8, 'Fast Lade Fehler', in place of error 1. The " +
    "Guide's distinction is chip versus fast ram, which this port has no split for, so the only observable " +
    "difference is what =Med Is Fastplaying then reports. DEVIATION shared with Med Load: routine 37 checks the " +
    "OLD mode's library at $b14 and the new mode is not stored until $b1a, so on the machine `Med Fast Load " +
    "\"x\",1` with no octaplayer jumps through a zero base; this raises error 5 instead",
  "med continue":
    "routine 9, ContModule on the mode's library. The token table spells it `med continue` where the Guide's node " +
    "title says 'Med Continus'; the binary wins.",
  "med init player":
    "routine 7, GetPlayer, with 0 = no MIDI and 1 = MIDI reaching the library in d0.",
  "med free player":
    "routine 8, FreePlayer. The Guide: \"STOPT und entfernt die MED Player Routine\", so the stop is the library's " +
    "own and not a second Med Stop; the module stays loaded",
  "med unload":
    "routine 11, and the only routine that calls two others — `Rbsr routine 4` then `Rbsr routine 8`, Med Stop " +
    "then Med Free Player, before UnLoadModule and `move.l #$0,$3f2.l`. The DEFAULT hook at $312 does the same " +
    "minus the unload, which is the leak the Guide warns about: after a Ctrl+C only a reboot frees the module.",
  "med set tempo":
    "routine 10 calls medplayer's -$42 whatever the mode is — no dispatch at all, unlike its neighbours. The " +
    "Guide's range is 0-240 with 1-10 the ProTracker tempos, and the routine clamps nothing, so nor does this",
  "med set mod nr":
    "routine 13, SetModnum. The Guide: call it BEFORE Med Play, and a Load always resets it to 0 — so the number " +
    "is held for the next Play rather than repositioning a running module",
  "med reset midi":
    "routine 12, medplayer's -$5a with no dispatch.",
  "med reloc":
    "routine 14. NOTE: what the library does is not knowable from this binary, and the Guide's own author wrote " +
    "\"setzt ein geladenes MED Modul in den Uhrsprungs Zustand zurück. ???\" with the question marks.",
  "med set hq":
    "routine 16 is MODE 1 ONLY: one `cmpi.l #$1,$3f6.l / beq` and every other mode returns having done nothing. " +
    "The Guide sends the reader to OctaMED for what HQ means and gives the default as 0",
  "med fastplay on":
    "routines 25 and 26 — two routines for one keyword, 25 loading `move.l #$40,d1` for the omitted buffer and 26 " +
    "popping one. The Guide's buffer rules (divisible by 4, strictly between 4 and 400) are the library's and " +
    "neither routine enforces them, so nor does this",
  "med fastplay off":
    "routines 27 and 28, the same pair with `move.l #$0,d0`",
  "med 14bit mode on":
    "routine 29 is `moveq #$1,d0 / bra` into routine 30's body at $dd0. The Guide: the default is always on, and " +
    "other MED formats ignore it",
  "med 14bit mode off":
    "routine 30, the `moveq #$0,d0` entry to the same body",
  "med set mixing freq":
    "routine 31, MODE 2 ONLY. The Guide's 1000..65535 range and its 15000 default are the library's; the routine " +
    "checks nothing, so the value is stored as given",
  "med set mixbuffer":
    "routine 32, MODE 2 ONLY, unchecked. The Guide's default is 1024",
  "med pointer":
    "routine 6, medplayer's -$54 whatever the mode. DEVIATION: the Guide says this one is unreliable — \"soll " +
    "eigentlich die korrekte Startadresse eines geladenen MED Moduls zurück geben. Aber leider tut er das nicht " +
    "immer korrekt.\" Which is why the same Guide adds `Med Mod Base`: \"Dieser gibt IMMER die korrekte " +
    "Startadresse eines mit Med Load geladenen MED Modules zurück.\"",
  "med mod base":
    "routine 23 is `move.l $3f2.l,d3` and nothing else — no module check, so with none loaded it answers 0. The " +
    "address is real and Peek/Poke reach it (Runtime.MED_MODULE_BASE), which is the Guide's stated point: no AMOS " +
    "bank is used, so this is how a program edits its module",
  "med get player":
    "routine 15 loads the file through medplayer, asks -$6c which player it needs, unloads it again, and touches " +
    "neither $3f2 nor $3f6 — so it is safe to call mid-song. The answer is fixed by the module generation and the " +
    "Guide's own mode table names them: MMD0/MMD1 → 0, MMD2 → 1, MMD3 → 2. NOTE: the routine has NO failure path, " +
    "so a file that is not a module leaves the query running on a null pointer; here it answers 0",
  "med get sub songs":
    "routine 18, `move.b $33(a0),d0` — `extra_songs` in the MMD header, static file data, so this one is exact.",
  "med pblock":
    "routine 19, `move.w $2a(a0),d0` — MMD `pblock`, which medplayer writes back into the header.",
  "med pline":
    "routine 20, `move.w $2c(a0),d0` — MMD `pline`",
  "med seq num":
    "routine 21, `move.w $2e(a0),d0` — MMD `pseqnum`",
  "med counter":
    "routine 22, `move.b $32(a0),d0` — MMD `counter`. The Guide's entry for it, in full: \"Tja keine Ahnung " +
    "wozu der gut sein soll. Gibt aber irgend einen Wert zurück. (Toll nich ???)\" So the port returns the byte " +
    "and knows no more about it than the author did.",
  "med is fastplaying":
    "routine 24: mode 0 asks medplayer -$72 and mode 1 octaplayer -$60, but mode 2 does not ask anyone — `move.l " +
    "#$ffffffff,d0` unconditionally, which is the Guide's complaint (\"funktioniert das nur bei MED Modulen die " +
    "mit dem octamixplayer.library gespielt werden\") explained. NOTE: for modes 0 and 1 the library's answer is " +
    "modelled by the Med Fastplay On/Off flag, since fast-ram replay is what that pair switches and this port has " +
    "no chip/fast split",
  "prop on":
    "routine 1: `lea $10a(pc),a0 / move.l a0,$4(a5)`, which is VblRout[1] (+Equ.s:1177) — one of the eight " +
    "per-frame slots AMOS calls at the vertical blank.",
  "prop off":
    "routine 2: `clr.l $4(a5)`, and nothing else at all",
  "paddle":
    "routine 6. n is 0..3, unsigned-checked, and the pairing is not the obvious one: n<2 reads the POT0DAT " +
    "snapshot and n>=2 the POT1DAT one, with the ODD number taking the low byte and the even one shifting down " +
    "from the high. NOTE: no paddle attached, so the conversion never completes and the snapshot stays 0 — the " +
    "same answer Sticks' Stick X and Stick Y give for the same two registers.",
  "pad fire":
    "routine 7. NOTE: no paddle, so no counter movement and no button",
  "ext joy":
    "routine 8: `move.b $bfe101,d3 / not.b d3`, then the low nibble for n=0 and `lsr.b #$4` for n=1. CIA-A PRB is " +
    "the PARALLEL port's data lines and this is the four-player adaptor, one joystick per nibble — the readme " +
    "says so and the register agrees, where Sticks' manual calls the same hardware the serial port and is wrong. " +
    "NOTE: no adaptor; the lines idle high and `not.b` makes that zero, which is no direction",
  "ext fire":
    "routine 9: CIA-B PRA ($bfd000) bit 2 for joystick 3 and bit 0 for joystick 4 — the parallel port BUSY and " +
    "POUT handshake lines — and -1 when the bit is CLEAR, a button pulling a pulled-up line down. NOTE: no " +
    "adaptor, so both idle high and answer 0",
  "yfire":
    "routine 11, the THIRD button --- routine 10 again on the X pot pins: bit $c (DATRX, right port pin 5) for " +
    "n=1 and bit $8 (DATLX, left) for n=0, re-arming $c/$d and $8/$9",
  "library open":
    "routine 4: `moveq #$0,d0` then OpenLibrary, so ANY version will do, and a zero result is error 1.",
  "library close":
    "routine 5: CloseLibrary with no check of any kind.",
  "cli":
    "routine 3, 468 bytes and the only large one. NOTE: this port has no shell, so execute() answers DOSFALSE, " +
    "the file is created and stays empty, neither text test fires, and the routine lands on its own error 0 — the " +
    "branch it takes on an Amiga where the command could not run",
  "init thx":
    "routine 4. The Guide says what the zeros buy: \"Init Thx initialises the filter data used by the " +
    "replayer. This wil grab 414768 bytes of public memory.\" (\"wil\" is the author's.) NOTE: nothing is " +
    "charged for those bytes here, for the same reason PowerBobs' AllocMems are not: no keyword hands the " +
    "address back, so the only observable would be Fast Free",
  "deinit thx":
    "routine 5. DEFECT: the flag clear is `move.b #$ff,d1 / subi.b #$1,d1 / and.b d1,d0` — $FE, so it clears bit " +
    "0 ONLY and leaves PLAYING set.",
  "play thx":
    "routine 6. The Guide's usage is `Play Thx Start(Bank),SubSong`, so the address really is an AMOS bank's",
  "stop thx":
    "routine 7.",
  "volume thx":
    "routine 8. The Guide gives the range as \"anything between 0 (silent) to 63 (very loud)\" and the routine " +
    "enforces none of it: `move.b d7,(a1)` takes the low byte, so 64 and -1 both land",
  "change led":
    "routine 3: `bchg.b #$1,$bfe001`.",
  "wait mouse":
    "routine 4: `btst.b #$6,$bfe001 / beq (done) / bra (again)`, spinning until the bit reads CLEAR, which is the " +
    "LEFT button held. DEVIATION: the original is a bare busy loop with no vbl wait and no break check, so on the " +
    "machine it burns the CPU and cannot be stopped by Control-C.",
  "wait joy":
    "routine 5, the same loop on bit 7 --- port 1 fire --- with the same deviation",
  "clear banks":
    "routine 6 is one AMOS call and an rts: `Rjsr routine 1107`, which is `L_Bnk_EffAll` --- erase every bank. " +
    "Source: +B.s:2698.",
  "id get high id":
    "L3: FiGetHighID(), the highest type number the installed library knows.",
  "id get string":
    "L4: FiGetIDString(num), the name of a type number. Not marked DEFECT because nothing here reproduces it: the " +
    "bug is pointer arithmetic in a library this port does not have, and the keyword is unreachable while it is " +
    "absent",
  "id identify file":
    "L5: step over the AMOS length word, FiAllocFileInfo (null is message 4), FiIdentifyFromName, then the type " +
    "as a WORD at FileInfo+4.",
  "id identify adresse":
    "L6, byte for byte L5 with FiIdentify in place of FiIdentifyFromName and no length-word step, so the argument " +
    "is an address of data already in memory.",
  "id fileinfo":
    "L7, three instructions with NO library check, so it answers even with nothing installed --- and what it " +
    "answers is the pointer the last identify already freed",
  "id error":
    "L8, the same three instructions over IDerr, also unguarded.",
  "dump err$":
    "routine 12 walks the list at $5d2 by the index at $32, each entry a word length then the text, padded even.",
  "diskin":
    "routine 29 into arm 42: TD_CHANGESTATE, whose io_Actual is 0 when a disk IS present, so this answers -1 for " +
    "a disk in the drive. NOTE: there is no floppy drive here, so routine 35's OpenDevice on trackdisk.device " +
    "fails and this reports it --- the same answer the machine gives for a unit with no drive attached.",
  "writeenable":
    "routine 30 into arm 43: TD_PROTSTATUS, io_Actual 0 when NOT protected, so -1 means writable.",
  "secread":
    "routine 31 into arm 44, the only one returning a string.",
  "secwrite":
    "routine 32 into arm 45, four pops so the source is (unit, offset, length, data$).",
  "trackformat":
    "routine 33 into arm 46.",
  "disk err$":
    "routine 34 returns an INTEGER despite the name: `move.l $b0(a2),d3 / move.l #$0,d2`, and the token spec is " +
    "`0`.",
  "dump":
    "routines 3, 4 and 5 --- one keyword with three arities. APPROXIMATED: the engine itself (routines 9-19, " +
    "printer.device's graphics dump) is not reproduced, so the answer is message 2, \"Not a graphics printer.\" --- " +
    "the machine's own answer when the installed driver has no dump support, and the reason that message exists.",
  "omd load":
    "octaplayer.library is not in the AMOS source; the load is checked and remembered, the module is not decoded",
  "omd play":
    "the OMD state machine only; no audio",
  "omd stop":
    "raises nothing of its own.",
  "omd free":
    "the same: routine 131 returns in silence when the module pointer at +$102 is zero, where this port raised " +
    "error 25.",
  "mosaic x2":
    "gains two termination guards the original lacks, neither of which fires on a real screen: a height under one " +
    "block, and a row byte width that is not a multiple of four, both walk memory forever on the 68k and do " +
    "nothing here",
  "mosaic x4":
    "the same two guards as Mosaic X2",
  "mosaic x8":
    "the same two guards as Mosaic X2",
  "mosaic x16":
    "the same two guards as Mosaic X2",
  "mosaic x32":
    "the same two guards as Mosaic X2",
  "octets fill":
    "an end equal to the start passes the routine's own Bmi and then fills memory until it faults; it writes " +
    "nothing here",
  "word switch":
    "a range ending at or below its start swaps that one word and stops, on the machine as well as here — routine " +
    "119 closes on `cmpa.l a2,a1 / blt`, so a1 already past a2 falls through to the rts.",
  "s32 block to screen":
    "steps rows by longs*4, its own `Lsl.l #2`, not the screen byte width, so a width that is not a whole number " +
    "of longwords drifts — kept.",
  "s32 vertice to screen":
    "the same row-step drift and the same narrow-screen guard as S32 Block To Screen",
  "full view":
    "does not step _CurrentLine after writing, alone among the appending keywords, so the next Copper Wait Line " +
    "lays itself over the tail",
  "say":
    "the AMOS side is exact — the ~ phoneme form, the translator path, the range checks and the asynchronous " +
    "form's mouths — but the VOICE is not the Amiga's. narrator-ts ships a free rebuild of the formant tables " +
    "(voice-free.json) because narrator.device's own are not redistributable, so it speaks and does not sound " +
    "like a real Amiga; supplying the original binary is the library's documented upgrade path.",
  "mouth read":
    "exact, including that every failure path writes ONE WORD over bytes 88 and 89 so Mouth Width and Mouth " +
    "Height both read -1 together — which is what the demos loop on — and that it does nothing unless an " +
    "asynchronous Say is in flight",
  "mouth width":
    "the low nibble of the frame the device packs at hunk+0x30a0, which it splits into byte 88",
  "mouth height":
    "the high nibble, byte 89",
  "set talk":
    "exact: sex and mode masked to a bit, pitch 65..320 and rate 40..400 refused rather than clamped, and any " +
    "parameter omitted (EntNul) leaves its field alone",
  "talk misc":
    "exact, and note the bounds are AMOS's rather than the device's: volume 0..64 and sampfreq 5000..25000 where " +
    "narrator-ts accepts up to 28000.",
  "talk stop":
    "ends an asynchronous say and hands the voices back, as the routine does; there is no CheckIO/AbortIO race to " +
    "model because the synthesis is not concurrent here",
  "elznsx":
    "Routines 7 ($13ce) and 8 ($13da), the one- and two-argument forms, over the shared lookup at routines 4/5/6. " +
    "The guide's C_Elznsx note claims \"These commands return signed integers. (-32768 to 32767)\" and nothing in " +
    "the routine sign-extends; its own C_ElznShift note contradicts it and matches the binary -- \"the new " +
    "co-ordinates will be 65526,10 to 30,20\". Zone 0, or a zone past EcNZones, is AMOS 23; a reserved-but-unset " +
    "zone reads as four zeroes, which the guide does get right",
  "elzn shift":
    "Routines 15 ($142e), 16 ($1436) and the body at 17 ($1458). The four adds are `add.w`, so coordinates wrap " +
    "modulo 65536 and a zone shifted off the left edge reappears near 65535 -- deliberate, and the guide warns " +
    "that AMOS's own =Zone(x,y) is confused by it while these readers are not. DEVIATION: the all-zones form on a " +
    "screen with NO zones reserved hangs on the real machine -- routine 17 takes d4=1, d5=0, shifts both to 8 and " +
    "0, and loops `cmp.l d4,d5 / beq` which can never match, writing four words through a null EcAZones and " +
    "stepping eight bytes at a time for ever. The guide documents an \"Illegal function call\" for this case " +
    "-- \"No zones are reserved on the given screen\" -- so the hang is the library failing to do what its own " +
    "documentation promises.",
  "elzb add":
    "Routines 100 ($1ea6), 101 ($1ec8) and 104 ($1f6a). NOTE: the guide documents a \"Not a Zone Bank\" error, " +
    "\"Zone banks are identified by them having the name 'Zones '\", and routine 101 never looks at the name: it " +
    "calls L_Bnk_GetAdr with the number alone, so any bank whose first longword is a plausible group count is " +
    "accepted.",
  "el overlap":
    "Routine 153 ($26e0).",
  "el lapsx":
    "Routines 154-157 ($2758-$277c), each `movea.l $1e8(a5),a0 / move.l $XX(a0),d3` and nothing else. NOTE: " +
    "nothing initialises those fields -- they belong to an easylife.library base the extension merely opened, and " +
    "the readers do no has-it-been-computed test, so El Lapsx before the first El Overlap reads whatever the " +
    "library left there.",
  "elmz reserve":
    "Routine 80 ($1bd6). NUM is rounded UP to even (`addq.l #$1,d6 / andi.l #$fffffffe,d6`) and the table costs " +
    "one and a half records a zone plus a trailer (`move.l d6,d7 / asr.l #$1,d7 / add.l d6,d7 / addq.l #$1,d7`), " +
    "which is where the guide's \"A maximum of 5460 multi zones can be defined. (There is a good reason for that " +
    "number!)\" comes from -- `cmp.l #$2000,d5 / Rbcc routine 3`, and 5460*3/2+1 = 8191. That is why the guide " +
    "warns \"Normal screen zones will not work with multi zones installed, but will not produce error messages, " +
    "just unreliable results\", and why Reserve Zone and Elzb Add both destroy them: all three go through the one " +
    "allocation. DEVIATION: NUM of zero or less scribbles memory on the machine -- `(0+1) & ~1` is 0, so one " +
    "record is allocated and then `subq.l #$2,d2 / ... dbra d2` runs with d2 = -2, counting the LOW WORD down " +
    "from $fffe for 65535 iterations of a four-byte write. NOTE: our model keeps the rectangles as the screen's " +
    "zone records, so `Zone()` and `Elznsx` see them exactly as they would on the machine, but the index records " +
    "read as unset rather than as the junk zones the 68k's bytes would decode to -- which is the half of the " +
    "aliasing the guide itself calls unreliable",
  "elmz  set":
    "Routine 85 ($1ccc), and the two-argument `ElMz Set GROUP,ID` ERASES that zone through routine 86 ($1d46). " +
    "NOTE: the corners are sorted rather than refused, but `cmp.l d1,d5 / bcc` is an UNSIGNED long compare while " +
    "the stores are `move.w` -- so the guide's \"X1,Y1 and X2,Y2 are automatically sorted so X1 <= X2, and Y1 <= " +
    "Y2\" holds for two coordinates of the same sign and inverts for a rectangle straddling zero, since -10 is " +
    "$fffffff6 and sorts above +10. DEVIATION: the erase form tests `cmp.l #$ffff,d2` where routines 85, 87 and " +
    "92 all test `cmp.w`, and routine 82 signals not-found with `moveq #$ff,d2` -- which is -1, not $0000ffff. " +
    "Source: +Edit.s:14414.",
  "elmz erase":
    "Routine 92 ($1dcc): routine 82 with `moveq #$0,d1`, the wildcard id, looped until it comes up empty.",
  "elmznsx":
    "Routines 88-91 ($1d94-$1dbe) over the shared prologue at routine 87 ($1d6c), which pops ID then GROUP, " +
    "refuses either as zero with AMOS 23, and raises the extension's own \"Multi Zone Not Defined\" when the pair " +
    "is not in the index. Each is `Rbsr routine 87 / move.w $N(a1,d2.w),d3 / ext.l d3`, so unlike the AMOS-zone " +
    "readers these SIGN-extend -- the guide's \"The values returned are signed (-32768 to 32767)\" is right here, " +
    "where the same claim about Elznsx is not.",
  "elmzney":
    "Routine 91 ($1dbe), and DEFECT: its two instructions are in the wrong order.",
  "elmzone":
    "Routine 95 ($1e08) stores X, Y and the group filter in the companion library's struct ($6e/$70/$74), resets " +
    "the scan cursor at $72 and falls straight into Elmzonen; the two-argument form is routine 94, six bytes that " +
    "push a literal zero for the group, so \"no filter\" and \"group 0\" are the same thing.",
  "elmzonen":
    "Routine 96 ($1e28), which is both this keyword and the tail of Elmzone.",
  "elmzoneg":
    "Routine 93 ($1df0), `moveq #$0,d3 / move.w $76(a0),d3` -- the group of whatever the last Elmzone or Elmzonen " +
    "found, zeroed when the scan came up empty.",
  "elf asc":
    "Routines 18 and 19 into 35 ($1560), over the shared setup at routine 34 ($153a). NOTE: the guide says \"Any " +
    "value of P is accepted, but is taken to be unsigned, so negative numbers are treated as very high positive " +
    "numbers\", and `tst.l d3 / Rbmi routine 3` says otherwise -- a negative P is an Illegal Function Call in both " +
    "the forward setup and the backward one. A P past the end does find nothing, as documented",
  "elf char":
    "Routines 26/27 into 40 ($160a), which walks A$ per source character rather than comparing one code -- " +
    "`move.w (a2),d7` then a `dbra` from the LAST character of the set down to the first. NOTE: the guide's " +
    "\"Illegal Function Call\", \"Either A$ is an empty string, or A is not between 0 and 255\" is half right.",
  "elf last asc":
    "Routines 22/23 into 38 ($15da), over the backward setup at routine 37 ($15ac). P of 0, or past the length, " +
    "starts at the end, which the guide gets right.",
  "elf control":
    "Routines 44 and 45 ($16ba, $16c4); routine 44 is ten bytes that push a literal zero for P. The test is " +
    "`cmp.b #$20,d0 / bcc` and UNSIGNED, so only 0..31 count and a byte at 128 or above is not a control " +
    "character -- which is what makes the guide's use of it work: \"This can be used to determine if a string " +
    "is printable.\"",
  "elf nth asc":
    "Routine 53 ($1790) is routine 35 with the Nth counter loaded, `move.l (a3)+,d5 / subq.l #$1,d5 / Rbmi " +
    "routine 3`, and the `dbra d5` after each match is what skips the first N-1. NOTE: routine 52, Elf Nth Char, " +
    "is the same twelve bytes WITHOUT that sign check, so `Elf Nth Asc(s$,a,0)` is an Illegal Function Call and " +
    "`Elf Nth Char(s$,a$,0)` is not: N-1 becomes -1, the dbra decrements the low word to $fffe and branches, and " +
    "the search would need 65536 matches -- which is to say it finds nothing and answers the miss value",
  "elf num asc":
    "Routine 51 ($175e), a plain count with its own loop rather than a call into the search workers, and no fail " +
    "flag.",
  "elf num char":
    "Routine 50 ($174c), and it does not count a SET at all. NOTE: the guide says \"occurances of any character " +
    "from A$ are counted\" and adds a note rationalising it -- \"If the string A$ contains more than one occurance " +
    "of the same character it is still only counted once\" -- and neither sentence describes this routine. The " +
    "empty string IS an error here, which is the one thing the guide has right about it",
  "elf fail start":
    "Routines 151 and 152 ($26c8, $26d4), twelve bytes each: `movea.l $1e8(a5),a0 / move.w #$0,$a0(a0)` and the " +
    "same with $ffff. NOTE: these two are the extension's only undocumented keywords. The guide's index lists " +
    "both and links them to `C_ElfFailStart`, and no such node exists in any of the three guides; what the " +
    "setting means had to come from the readers. Elf Fail Start is the boot state and is what the Default hook " +
    "restores, which the guide's CommandEffects node does say",
  "elpad asc$":
    "Routines 145 and 146 ($25da, $25f0). NOTE: the guide says \"If the length of the string S$ is greater than or " +
    "equal to L, these two functions return S$\".",
  "elpad char$":
    "Routine 144 ($25c6), which takes the first character of A$ and joins routine 146 -- \"If A$ contains more " +
    "than one character, the second and subsequent characters are ignored. In the future I intend to change this " +
    "to repeatedly use the whole of A$ to pad S$.\" The future did not arrive: 1.44 still ignores them.",
  "elwb open":
    "Routines 118, 119 and 120 ($213a, $214e, $217a) on intuition.library (`-$18a6(a5)`): OpenWorkBench (-$d2), " +
    "WBenchToFront (-$156) and CloseWorkBench (-$4e), all three ending at routine 114 ($20c0), which is `moveq " +
    "#$0,d2 / moveq #$0,d3 / tst.l d0 / beq / moveq #-$1,d3` and turns whatever the library returned into an AMOS " +
    "boolean. \"AMOS provides a close workbench command, but it does not tell you whether the workbench did " +
    "actually close or not.\" Close is WBenchToFront first and CloseWorkBench only if that says a screen is there, " +
    "else `moveq #$ff,d0` -- which is the guide's \"Elwb close returns true if the workbench is closed when the " +
    "function has finished executing, even if it didn't close it because it was already closed\". These answered " +
    "the ABSENT case until there was an Intuition; they are on the real one now (src/amiga/intuition.ts), " +
    "including the documented side effect of bringing the Workbench screen to the front, which is not a side " +
    "effect at all but the WBenchToFront that Close and Test both open with",
  "eliconify begin":
    "Routine 124 ($21ee), 182 bytes, and the whole iconify window is in it: `tst.l $88(a2) / Rbne routine 3` " +
    "(already open -> AMOS 23), OpenWorkBench (-$d2) or return 1, WBenchToFront (-$156), then `move.w (a1)+,d0 / " +
    "asl.w #$3,d0 / addi.w #$50,d0` for a width of len(TITLE$) * 8 + 80, patched into the 48-byte `struct " +
    "NewWindow` at $2274 along with the title, TopEdge and LeftEdge, then OpenWindow (-$cc) or return 2. NOTE: no " +
    "WFLG_ACTIVATE, and the guide is explicit about the consequence: \"If you activate the window, then press the " +
    "right mouse button\".",
  "eliconify test":
    "Routine 125 ($22a4), 120 bytes: GetMsg (-$174) on Window->UserPort ($56) in a loop, and the first message " +
    "past four filters ends it -- MouseX in 0..width-1 against the width saved at $8e, MouseY in 0..9, MENUDOWN " +
    "($69) sets the latch and takes another message, and Class ($14) decides the answer: MOUSEBUTTONS ($8) is -1, " +
    "anything else (CLOSEWINDOW) is 1. DEFECT: the latch at $8c is dead. NOTE: no ReplyMsg anywhere, so every " +
    "message is leaked on the machine; the queue merely shortens here and the defect has no observable effect",
  "eliconify end":
    "Routine 126 ($231c), forty bytes: `move.l $88(a2),d0 / movea.l d0,a0 / Rbeq routine 3` -- no window is AMOS " +
    "23 -- then `move.l #$0,$88(a2)` BEFORE CloseWindow (-$48), so a failure inside the close cannot leave a " +
    "stale pointer. It does not close the Workbench; the guide's procedure has the program bring AMOS back to " +
    "front itself",
  "eliconify amos":
    "Routine 123 ($21d4), TWENTY-SIX bytes, and every one of them is the other three: `Rbsr 124 / tst.l d3 / bne` " +
    "(1 or 2 straight back), then `Rbsr 125 / tst.l d3 / beq` round again, `bmi` keeps a -1, otherwise `moveq " +
    "#$0,d3` turns Test's 1 into 0, and `Rbsr 126`. DEVIATION: the loop is AMOS's frame loop rather than a `bra` " +
    "-- the 68k routine spins with the program suspended and there is nothing to spin on here until the frame " +
    "that delivers the click has run. NOTE: the guide's table for THIS keyword has -1 and 0 swapped, saying \"-1 = " +
    "The close window gadget was pressed. 0 = Then right mouse button was pressed\", where the code does the " +
    "opposite.",
  "elxpk error":
    "Routine 177 ($2a74), twelve bytes: the longword at $b6 of the companion struct, where every XPK keyword " +
    "stores its XpkUnpack/XpkPack result.",
  "st new":
    "Routine 263 ($37d0) into the library's `ELST_New` (LVO -48, $25a) with `move.l #$10000,d1`, MEMF_CLEAR. That " +
    "clear IS the guide's initialisation table -- \"\" for strings, 0.0, False, nil, and a ranged integer at its " +
    "MINIMUM, because a ranged integer is stored biased by its minimum and all-bits-zero therefore is the lowest " +
    "legal value. NOTE: the pool is exec's Allocate/Deallocate over a MemHeader the library builds inside each " +
    "block at `block - $e` ($2f6), so it is first-fit on an eight-byte grain with coalescing; modelled that way " +
    "in elstruct.ts because reuse after a free is observable and the guide's warning about dangling pointers " +
    "depends on it. DEVIATION: EXT_DATA_SLOT is 64K, so a block size above it would run into its neighbour and is " +
    "capped; both sizes the guide documents ($2000 and $4000) are far below",
  "st free":
    "Routine 262 ($37b8), `ELST_Free` (LVO -42, $166).",
  "st free all":
    "Routine 266 ($3834), `ELST_FreeBlocks` (LVO -72, $59c) -- the one keyword that gives the memory back, " +
    "FreeMem-ing every block and zeroing `$f8`, `$f4` and `$f0`. NOTE: the mode argument is documented and dead, " +
    "`move.l $f8(a6),d1` overwriting d0 before anything reads it, and `St Free All` passes 0 anyway.",
  "st dup":
    "Routine 267 ($384c): read the type word, `ELST_New` with d1 = 0 so NO clear, then `move.l (a2)+,(a1)+` over " +
    "size/4 longwords -- the whole instance, header included. The guide: \"equivilent to (But faster than): " +
    "S2=St New(St Type(S1)) : St Copy S1 To S2\", and the difference is exactly the four-byte header St Copy skips",
  "st copy":
    "Routine 268 ($387a). NOTE: routine 3 is `moveq #$17,d0 / Rjmp L_Error`, AMOS 23 -- message 39 \"Cannot copy " +
    "between structures of different types\" is in the extension's own table and NOTHING raises it.",
  "st type":
    "Routine 271 ($393a): the instance's own type word, straight out of its first two bytes.",
  "st len":
    "Routine 272 ($395c), TEN BYTES: `Rbsr routine 271` for the validated lookup, then `movea.l d0,a0 / move.l " +
    "(a0),d3`, the definition's first longword. The guide's arithmetic reproduces it: \"adding up the lengths of " +
    "all the elements, adding 4, and rounding up to the next multiple of 8\", where a string counts \"Max Len+3 " +
    "rounded up to even\"",
  "st lookup":
    "Routine 294 ($3a94), `ELST_Lookup` (LVO -30, $1d8) unwrapped. DEVIATION from the guide: `d0 = (a0)+.w / dbra " +
    "d0` runs count+1 times, so the table's count word holds entries MINUS ONE where the guide's own format page " +
    "writes `dc.w 3` for three; all five Structs banks in the archive agree with the binary.",
  "st get":
    "Routines 273-276 ($3966-$397e) into the shared body 260 ($375e), `ELST_GetElement` (LVO -54, $3be) and then " +
    "`move.l d0,d3 / moveq #$0,d2`. NOTE: that `moveq #$0,d2` is why the answer is always an AMOS INTEGER -- a " +
    "Real element gives back its raw longword, and a string element gives back the ADDRESS of its NUL-terminated " +
    "characters, which the guide says is the point (\"it can be used for any system library calls that require a " +
    "pointer to a string, or in MUI taglists\"). DEFECT: the resolver's range test is `bmi` then `cmp.l d3,d2 / " +
    "bcs`, which fails only when a subscript is GREATER than the bound, and both arms raise message 31 \"negative\" " +
    "-- message 30 \"too high\" is never reached.",
  "st get$":
    "Routines 277-280 ($3986-$399e) into routine 261 ($3782), which calls 260 and copies the characters out of " +
    "the instance into fresh AMOS string space.",
  "st set":
    "Routines 282/284/286/288 ($39aa, $39d6, $3a02, $3a2e), `ELST_SetElement` (LVO -60, $46a) and a second " +
    "twelve-arm table at $49a.",
  "st set str":
    "The same four routines, reached through the token entries whose value slot is a string. DEFECT: $522 copies " +
    "`length + 2` bytes with a `dbra` and then writes a NUL, three bytes more than the length, into an element " +
    "whose stride is `maxlen + 2` -- while the compiler's element size is `maxlen + 3` rounded up to even.",
  "st cmp":
    "Routines 290-293 ($3a7c-$3a8e) into routine 289 ($3a56), `ELST_StrCmp` (LVO -66, $548) -- compares in place, " +
    "which is the point (\"much faster than using If St Get$( INSTACE, ELEMENT )= STRING$\"). DEVIATION: the SIGN " +
    "is the guide's backwards.",
  "stv":
    "Undocumented, and new in 1.10: it appears in no guide and 1.09 does not have it. NOTE: the write half is " +
    "where the binary says something that cannot be carried over. 1.10 gives it four instruction slots, " +
    "281/283/285/287, each FOUR BYTES in front of the `St Set` body of the matching arity, which it then falls " +
    "into -- and all four hold `4eac 3e2c`, `jsr $3e2c(a4)`. a4 has no value at a keyword's entry (the only three " +
    "routines in 16KB that load it do so locally) and $3e2c is inside routine 300's inline message block, not " +
    "code. 1.09's set family is 281-284 with no prologue, byte for byte the same forty-byte bodies, so the four " +
    "bytes came in with the keyword.",
  "st output$":
    "Routine 270 ($38f8), and DEFECT twice over -- identically in 1.09 and 1.10, so not a 1.10 regression. $38fc " +
    "is `3012`, `move.w (a2),d0`, reading the type it is about to look up out of a register nothing in the " +
    "routine loads (routine 271 does the same job with `3610`, off the pointer it popped). The pair does not " +
    "round-trip on a real Amiga; the guide's \"returns a copy of the structure instance in a string\" is " +
    "implemented instead",
  "st input":
    "Routine 269 ($38b4), and its two checks ARE right and are the only two places in the whole ST block that " +
    "raise a message the extension owns: the string's first word against the instance's type (message 41) and its " +
    "length against the definition's size (message 40). DEFECT: $38ba is `305b`, `movea.w (a3)+,a0` -- the " +
    "instance address taken as a sign-extended WORD, so the high half of the pushed longword becomes the whole " +
    "pointer and AMOS's parameter stack is left two bytes out of step for the rest of the statement.",
  "st save":
    "Routine 265 ($3814), `ELST_SaveTree` (LVO -96, $6e8). NOTE: the library takes DOSBase from `$2b8(a5)`, " +
    "AMOS's own workspace register, which is still live because the extension calls in with `movea.l $1e8(a5),a6` " +
    "and never touches a5. NOTE: the Open() failure exit sets d0 = $5e and routine 299 hands non-negative d0 to " +
    "L_Error, so the AMOS error raised is 94, \"Next without For in animation string\" -- plainly not the message " +
    "meant, and raised unchanged here because the alternative is inventing one",
  "st load":
    "The name is CONTESTED and this note covers both, though for once the two do not reach each other: " +
    "EasyLife's is a FUNCTION and MusiCRAFT's an INSTRUCTION, so they sit in different dispatch tables. " +
    "MusiCRAFT's is routine 3 ($13c6) -- \"Loads a sound/noise/protracker module f$ to bank b_nro\", with the " +
    "help's warning that \"currently this system supports new commands presented in Protracker 2.1, and the " +
    "modules which are composed with earlier versions of sound/noisetracker may not work\". A bank of 65536 or " +
    "more is error 23 (`tst.w (a3)`, the high word), a bank of zero is error 23, and a bank that already exists " +
    "is error 35 -- it refuses rather than replacing. An empty filename is error 23 and one of 1024 characters " +
    "or more is error 23. The reserve is Bnk_BitData | Bnk_BitChip under the name \"Tracker \", for the file's " +
    "length PLUS FOUR: not slack, but the longword mt_init's sample walk writes past the last sample. A file " +
    "that will not open is error 81, \"File format not recognised\", for a file it never got as far as reading; " +
    "`moveq #$51,d0` at $1476 is the routine's own choice and it is raised unchanged. A short read is error 94, " +
    "which nothing here can produce. The AMOS 1.3 build does the same by hand through the $816(a5) bank table, " +
    "writing \"Trac\"/\"ker \" itself and asking for length plus TWELVE -- the same four bytes with the name in " +
    "front -- and its one visible difference is the range: `subq.l #1 / cmp.l #$10 / Rbcc`, banks 1 to 16. " +
    "EASYLIFE's, from here down: routine 264 ($37f2), `ELST_LoadTree` (LVO -90, $7b4) with " +
    "`ELST_RelocateTable` ($8e4) after it: an instance " +
    "is allocated per record with NO clear, its body read over the top, and then every pointer element's saved " +
    "address is looked up in the old-address list and replaced by the new address at the same position. NOTE: a " +
    "header claiming zero instances makes `subq.w #$1,d4` -1 and the `dbra` under it wrap to 65536 passes; St " +
    "Save cannot write one, since the scan always returns the root, so it is refused rather than modelled. NOTE: " +
    "a bad magic sets d0 = $62, AMOS error 98, the same misdirected-number problem as St Save's 94",
  "st erase":
    "Routine 295 ($3ab2) on LVO -108 ($97a), which the autodoc lists without naming: `ELST_TreeScan`, `ELST_Free` " +
    "over every instance it found, `ELST_TreeScanFree`. DEFECT in the scan it sits on: `move.l d3,(a1)` seeds the " +
    "list with the root and never sets its visited bit, so a pointer back to the root appends it a second time -- " +
    "against EasyLifeSTRUCT.guide's \"If is OK if your graph contains cycles e.g. Instance A contains a pointer " +
    "to B & Instance B a pointer back to A. Each instance is only saved once.\" -- \"If is OK\" is the " +
    "author's. DEFECT: an ARRAY of sub-structures is walked " +
    "as element zero, count+1 times -- `dbra d5,$6bc` loops back onto the `bsr` without advancing a0, and the " +
    "same shape appears in the relocation at $964.",
  "eltest":
    "1.09 ONLY --- 1.0 does not have it, 1.44 does not, and 1.10 dropped it and put `Stv` at the same id \\$e4e. " +
    "DEVIATION: the function half pops three longwords too, one more than its two arguments, and sets d0 where " +
    "every other function here returns in d3 with a type in d2, so `=Eltest(a,b)` answers whatever d3 held from " +
    "the last thing that set it. Evidence: 1.09's routine 255 (\\$372a); 1.09's routine 256 (\\$3732).",
  "elzb multi add":
    "Two forms on one name. NOTE: both walks run the groups DOWNWARD, from the count at bank+0 to 1, and that " +
    "order decides which zone lands in which multi-zone slot, so it is reproduced rather than tidied. Evidence: " +
    "Routine 102 ($1f02); Routine 103 ($1f30).",
  "el error":
    "1.0 only: 1.0's routine 165 ($191a), twenty bytes -- `movea.l $1e8(a5),a2 / adda.w #$44,a2 / move.l (a2),d3 " +
    "/ move.l #$0,(a2)`. The doc: \"The El Error value is cleared to -1 when it is read. This means that if " +
    "other extensions produce an error, El Error will not contain the number of an EasyLife error you've already " +
    "handled.\" DEVIATION: the doc says cleared to -1 and the " +
    "instruction writes zero, which is also what a program sees before any error has been raised -- so the doc's " +
    "value would have been the more useful of the two. NOTE: the field is module state in easylife.ts rather than " +
    "EasyLifeState, because twenty-two call sites raise and only 1.0 can read it back; the doc block there says " +
    "what that costs",
  "elzqzqzq":
    "1.44 only: 1.44's routine 133 ($1bda), TWO BYTES: `rts`. NOTE: `rts` does not pop the parameter stack the " +
    "way every other routine in this extension does, leaving a3 four longwords deep on the machine; nothing here " +
    "has a parameter stack to leak",
  "elqqzqzqq":
    "1.44 only: 1.44's routine 132 ($1bd8), TWO BYTES: `rts`.",
  "elxpk lof":
    "Routine 185 ($2b66): NUL-terminate the filename, allocate a 94-byte XpkFib, build [XPK_InName][TAG_DONE] at " +
    "$2ba4, and call xpkmaster LVO -36 XpkExamineTags.",
  "elxpk load":
    "Routines 170-173 ($2928, $2936, $2944, $295a) into 176 ($2998), one per syntax; each only sets d2/d5 and " +
    "swaps the fourth tag id between $80005874 (XPK_Password) and $8000587e (the blank). DEFECT: the shrink at " +
    "$2a06 frees nothing (d0 still holds XpkUnpackTags' result, so FreeMem(node,0)) and leaks the block AllocMem " +
    "returns, so the bank keeps its whole ULen+232 reservation -- reproduced. DEFECT: $2a2c is `move.l d7,(a1)`, " +
    "writing the LVO offset -48 over the node's NEXT link where the d6 saved at $29f2 was meant ($2287 against " +
    "$2286, and d6 is never read) -- not reproducible, this port has no node",
  "elxpk bload":
    "Routines 174 and 175 ($2970, $2980) into 176 with d2 = d5 = -1, which is what `tst.l d5 / bmi` at $29ce " +
    "skips the bank work on. NOTE: the guide's \"you must still allocate the 256 bytes\" is XPK_MARGIN, workspace " +
    "only the real master decodes through; nothing here writes past the unpacked length",
  "elxpk save":
    "Routines 178 and 179 ($2a80, $2a92) into 180 ($2a9c) and 184 ($2b06). NOTE: only NONE is installed, so any " +
    "other method answers XPKERR_MISSINGLIB (-15) through Elxpk Error, which is what an Amiga with an empty " +
    "LIBS:Compressors/ does; and there is no list node in this port, so the 24 bytes are synthesised on save and " +
    "read back on load rather than copied out of live memory Source: +B.s:1219; +Lib.s:8470.",
  "elxpk bsave":
    "Routines 181 and 182 ($2ad0, $2ae2) into 183 ($2aec) and the same 184: four pops, METHOD$, FILENAME$, " +
    "LENGTH, START, then XpkPackTags at master LVO -42 with " +
    "[XPK_InBuf][XPK_InLen][XPK_OutName][XPK_PackMethod][password or blank].",
  "el base":
    "Routine 117 ($2110). NOTE: `El Base(0)` has no answer here -- a5 is AMOS's own system base and this port has " +
    "no address for it -- so it answers 0, and an unoccupied slot answers 0 as it does on the machine Source: " +
    "+Equ.s:1176-1183.",
  "elpro":
    "Routine 148 ($26aa) is SIX BYTES: `moveq #$ff,d3 / moveq #$0,d2 / rts`, unconditionally true.",
  "elcompiled":
    "Routine 149 ($26b0), and DEFECT: it answers -1 under the interpreter, the opposite of what it is for. The " +
    "guide says \"=ElCompiled returns true if your program is running as a stand-alone program, and false when it " +
    "is being run under AMOS\", so under AMOS it is wrong every time.",
  "elexists":
    "Routines 105 ($1f9c) and 106 ($1fb8).",
  "elprotect":
    "Routine 109 ($206a): routine 106 again, then `$74(a1)`, fib_Protection -- and unlike Elexists a failed Lock " +
    "IS raised (`Rjmp L_Error` on d0). The bit sense is AmigaDOS's own inversion, which the guide sets out in " +
    "full: \"For the lower 4 bits, a value of 0 means on, and 1 off, but for the upper 4 bits, 0 is off, and 1 " +
    "is not.\"",
  "els protect":
    "Routine 110 ($208a): routine 1 to null-terminate the name, `cmp.w #$1,d0 / Rbeq routine 3` on an empty one, " +
    "then dos.library SetProtection.",
  "elexec":
    "Routine 143 ($25a6): `movem.l d0-d7/a0-a7,-(a7)` around a dos.library Execute with both handles zero, then " +
    "routine 114 turns the result into a boolean. NOTE: saving a7 in a movem and restoring it from that same " +
    "movem is what the routine does; it is a no-op, not a stack switch",
  "elreset":
    "Routine 108 ($203e): 1..25, then `$fc + (NUM-1)*16` off a5 -- ExtAdr plus FOUR, the slot's DEFAULT routine " +
    "pointer -- and `jmp (a0)` if it is not null.",
  "elraster wait":
    "Routine 107 ($2016), forty bytes: bound the line to 0..255, spin on VPOSR's low bit until the current line " +
    "ends, then spin on VHPOSR's line byte until it equals LINE. DEVIATION: the modelled beam only advances " +
    "between statements here, so there is nothing to spin on inside a keyword and this waits one frame -- the " +
    "same limit AMCAF's Raster Wait carries",
  "elout":
    "Routines 121 ($218e) and 122 ($219e), over the handle routine 0 stored at $94 from `Output()`. NOTE: this " +
    "port has no CLI attached, so the handle is zero -- which is exactly what it is on the machine when AMOS was " +
    "started from Workbench.",
  "elin$":
    "Routines 127, 128 and 129 ($2344, $2354, $2392) over the shared reader at 130 ($23b8) and the handle at $90 " +
    "from `Input()`.",
  "elopen font":
    "Routine 160 ($27a4), 220 bytes: fill the TextAttr at $80, try graphics.library OpenFont first, and only on a " +
    "miss open diskfont.library (message 14 if that fails) and OpenDiskFont (message 15 if that does).",
  "elset font":
    "Routines 161, 162 and 163 ($2880, $28b8, $28e8): the same chain walk for the FONTID, then respectively " +
    "unlink-and-close, put the TextFont on the current RastPort, and close the lot. A FONTID that is not in the " +
    "chain -- including one already closed -- is AMOS 23, which the guide states for Elset Font.",
  "elpp load":
    "Routine 55 ($17a0), 162 bytes. `cmp.l #$8,d0 / Rbcc routine 3` on the buffer, `Rbsr routine 58` to free " +
    "whatever was there (\"If the chosen buffer already contained data, it is freed first\"), then routine 62 opens " +
    "the library before the file is even looked at -- the guide's \"The Powerpacker Library is required to be in " +
    "LIBS: even if the file your are loading in not crunched\". The PP20 magic decides whether to decrunch, which " +
    "is what makes the guide's \"you don't have to worry about whether the file you are loading is crunched or " +
    "not\" true",
  "elpp buf":
    "Routines 56 and 57 ($1842, $185e), twenty-eight bytes each over the eight-slot table at $2e -- two longwords " +
    "a buffer, address then length. NOTE: the bound is `cmp.w #$8,d0` in these two where Elpp Load and Elpp " +
    "Allocate use `cmp.l`, so a number whose LOW WORD is 0..7 gets through the readers -- 65536 reads buffer 0 -- " +
    "and is refused by the keywords that create one.",
  "elpp crunch":
    "Routine 59 ($18b0), 260 bytes and the only keyword here that compresses. If it grows, \"Crunched File LONGER " +
    "than source - Aborted\", which is the guide's reason for wrapping the call in On Error. DEVIATION: " +
    "\"IMPORTANT: The crunched data overwrites the uncrunched data before it is saved\" -- src/amiga/powerpacker.ts " +
    "crunches to a fresh buffer, so the source survives here. A program relying on that corruption would be " +
    "relying on the thing the guide warns against",
  "elpp allocate":
    "Routine 63 ($1a1c), twenty-four bytes: free the old buffer, AllocMem through routine 116 (or error 24), then " +
    "the address and length into the slot.",
  "elpp free":
    "Routine 58 ($187a). \"Freeing a buffer which is not allocated does not cause an error, it does nothing.\" " +
    "NOTE: the guide's second form, `ElPp Free All`, is not a keyword -- the token table has one entry with one " +
    "argument. What the guide links to is the Default command, whose hook walks all eight slots itself (routine " +
    "0's cleanup at $1222)",
  "elpp keep on":
    "Routines 60 and 61 ($19b4, $19d0): OpenLibrary into $78 and CloseLibrary out of it, each guarded so a second " +
    "call does nothing. \"The library is loaded into memory when you first use either of these commands, but may " +
    "sometimes be removed again by the exec memory manger afterwards.\" NOTE: the codec is built in here and " +
    "cannot fail to open or be flushed out, so the pair is bookkeeping -- the state is kept because the Default " +
    "hook is documented to call Elpp Keep Off",
  "elwtst":
    "Routines 70 and 71 ($1b08, $1b24), twenty-eight bytes each and identical but for the width.",
  "elwset":
    "Routines 72, 74 and 76 ($1b40, $1b6c, $1b98), twenty-two bytes each: pop the address, pop and bound the bit, " +
    "`move.w (a0),d1 / bXXX d0,d1 / move.w d1,(a0)`.",
  "ellclr":
    "Routine 75 ($1b82), and DEVIATION: `20 10` is `move.l (a0),d0` where routine 74's `32 10` is `move.w " +
    "(a0),d1` and `22 10` would have been the long equivalent. There is no defined value for d1 on entry, so the " +
    "defect is not reproducible even in principle; the intent, clearing the bit, is what runs here",
  "ellchg":
    "Routine 77 ($1bae), and DEFECT, reproduced: `01 c1` is `bset` where routine 76's `01 41` is `bchg`.",
  "ellong$":
    "Routines 46-49 ($16f4..$174c), four ten-to-twenty-byte routines that are the pair AMOS lacks. Elword$ pops " +
    "the argument as two words and keeps the LOW one (`move.w (a3)+,d0 / move.w (a3)+,(a0)+`), which is the " +
    "guide's \"ElWord$ does not give error messages if the value is out of range, it simply stores the lower 2 " +
    "bytes\". Reading back, Ellong needs four bytes and Elword two (`cmp.w #$4,d0 / Rbcs routine 3`), and Elword " +
    "sign-extends, so 32768..65535 come back negative -- the guide says so and gives the workaround",
  "elextb":
    "Routines 78 and 79 ($1bc4, $1bce), ten and eight bytes: `ext.w d3 / ext.l d3` from the low BYTE, and `ext.l " +
    "d3` from the low word.",
  "elmem$":
    "Routines 67 ($1a98) and 68 ($1ad4). NOTE: the bound is routine 67's `addq.l #$2,d3 / cmp.l #$10000,d3 / Rbcc " +
    "routine 3`, so it is the length PLUS TWO that must stay under 65536 and the real maximum is 65533, where the " +
    "guide says 65535",
  "elmem":
    "Routine 69 ($1af4) and its wrapper 111 ($20b6), which is `Rbsr routine 69 / move.l a1,d3` -- the write, then " +
    "the address just past it.",
  "elbank name$":
    "Routine 65 ($1a46): L_Bnk_GetAdr, then the eight bytes at `-$8(a2)` and `-$4(a2)` -- the name sits " +
    "immediately before the data. \"The string returned is always 8 characters long, and is padded with trailing " +
    "spaces\", and the guide's own idiom for trimming it uses the keyword slice 3 added: `Left$(NAME$,Elf Last Not " +
    "Asc(NAME$,32))`",
  "els bank name":
    "Routine 66 ($1a72), the write side of the core's Bank Name$.",
  "elbnk here":
    "Routine 158 ($2788). DEVIATION: it pops the parameter stack TWICE for a keyword whose spec declares one " +
    "argument -- `20 1b` move.l (a3)+,d0, then `76 00 74 00` clearing d3 and d2, then `20 1b` again, overwriting " +
    "d0. There is no shared parameter stack here to under-run, so what the routine intended is what runs: the " +
    "argument is looked up and the answer is -1 or 0, which is what the guide describes",
  "elmessage$":
    "Routines 64 ($1a34) and 147 ($262c), and routine 147 is the only description of the message-bank format that " +
    "exists. NOTE: no message bank exists anywhere in the archive. They come from \"the Message Bank Compiler " +
    "PratchED extension program\", which the guide admits was never released -- \"For more information, read the " +
    "message bank compiler documentation. (Which one day, I might even release!)\" So the layout is routine 147's " +
    "alone, and the test that exercises it builds a bank to match, which proves the reader agrees with the " +
    "reading and nothing more",

  // --- Opal 1.1 ----------------------------------------------------------
  "ovopenscreen24":
    "Routine 3 ($962). The AMOS patch goes in FIRST -- `A_CALLOPAL AmosPatch24` with D0=1 -- and the pen is set " +
    "after, and only two thirds of it. DEFECT: `clr.b OS_Pen_R(A0)` and `move.b #$FF,OS_Pen_G(A0)` and no third " +
    "store, so blue is whatever the structure held; OpenScreen24 clears it, so the default pen is pure green in " +
    "practice and nothing in the extension makes it so. DEFECT: `move.l D0,A0` runs whether or not the open " +
    "answered NULL, so a failed open writes both pen bytes through address zero",
  "ovwritepixel24":
    "Routine 5 ($9d2), and the keyword that settles the pixel layout. An OpalVision plane holds TWO bits per " +
    "pixel, four pixels to a byte, most significant pair leftmost: `moveq #$3f,d6 / ror.b d4,d6` is the mask, and " +
    "plane p of a component carries bit p of that component byte as the pair's low half and bit p+4 as its high " +
    "half. So 24-bit colour is twelve planes, not twenty-four, and a hires screen doubles that because its even " +
    "and odd pixels sit in different banks. No document in the developer kit says any of this",
  "ovcopperrefresh":
    "Routine 79 ($1142), which is `AmosPatch24(1)` and nothing else, and is undocumented by the readme. DEFECT: " +
    "the token entry `\"ovcopperrefres\",\"h\"+$80,\"00\"` declares a function of one integer and the routine " +
    "pops nothing, leaving the argument on AMOS's parameter stack. This port consumes it, because the " +
    "interpreter's stack is not the machine's and leaving a value on it would desync the caller rather than " +
    "reproduce the leak",
  "ovsetpen24":
    "Routine 75 ($1108), one of the four keywords that never enters the library -- the readme lists them apart as " +
    "\"AMOS Specific Commands\" and they exist because `opallib.h` does this with macros an AMOS program cannot " +
    "use. Three `move.b` into $390, $391, $392, so only the low byte of each argument survives",
  "ovwritethumbnail24":
    "Routine 37 ($d04). The chunk is \"OVTN\", length $10e0, and 4320 bytes of 48 x 30 x 12 OpalVision pixels -- " +
    "a layout no document in the developer kit describes, read out of hunk $ad0c. DEVIATION: `File` is an " +
    "AmigaDOS handle, and nothing in AMOS produces one here except Make 1.1's `=Ma Fopen`, whose handle IS the " +
    "BPTR `Open()` returned; any other value answers OL_ERR_FILEWRITE, which is what the library answers when the " +
    "write comes up short",
  "ovsaveiff24":
    "Routine 27 ($c00). Hunk $a39c writes the thumbnail BEFORE `BMHD`, which the AutoDoc's chunk list does not " +
    "say and `DisplayThumbnail24` depends on, since that routine gives up at `BODY`. DEVIATION: `ChunkFunction` " +
    "is a 68000 entry point called in C convention with the DOS file handle on the stack, and there is no " +
    "processor here to enter it on, so a non-zero value is treated as the AutoDoc's \"must return 0 or an error " +
    "code\" returning 0",
  "ovloadimage24":
    "Routine 25 ($b9c), shared with Ovloadiff24 -- two token entries, one routine, because the library renamed " +
    "the function and kept the old name \"to maintain backward compatibility\". Both halves are here. The IFF " +
    "one is complete: 24-bit, OpalVision fast format, palette mapped, HAM and Extra Half Brite. The JPEG one " +
    "reads what the AutoDoc says it reads -- \"a baseline loader as specified in the draft standard ISO/IEC Bis " +
    "10918-1 ... 8 bit quantization tables and Huffman entropy compression ... Y Cb Cr, RGB and Grey scale\", " +
    "and not \"non interleaved files, progressive, hierarchical or lossless modes\" -- and a JPEG outside that " +
    "answers OL_ERR_FORMATUNKNOWN, the code the library gives a file it cannot identify at all. APPROXIMATED for " +
    "the JPEG half only: the library is the Independent JPEG Group's code and upsamples chrominance with a " +
    "triangle filter, while src/amiga/jpeg.ts replicates, so a 4:2:0 file lands up to about 10 levels off what " +
    "an Amiga would show. With no CAMG to read a display mode from, hunk 3 $c50 takes one from the picture's " +
    "width -- over 640 hires and overscan, over 370 hires, over 320 overscan -- and over 256 lines interlaced. " +
    "DEFECT: `Opal.s` comments the first pop as \";OpalScreen pointer.\" and it is the FLAGS -- a wrong comment, " +
    "not wrong code",
  "g reboot":
    "Routine 4 ($1682). `movea.l $4.w,a6 / jsr -$2d6(a6) / rts` -- ColdReboot with no version check. " +
    "src/amiga/machine.ts catalogues it beside every other extension's reboot keyword",
  "g left click":
    "Routine 5 ($168c). `btst.b #$6,$bfe001`, CIA-A's PRA, active low -- so -1 when the bit is CLEAR. Unlike " +
    "Right Click it goes nowhere near GMS",
  "g right click":
    "Routine 6 ($169e). Goes through GMS: `movea.l $b2e(a2),a0` then `cmp.w #$1,$14(a0)` on the input structure. " +
    "Read from this port's own mouse instead, which is the same state by a shorter route",
  "g check vbl":
    "Routine 11 ($173e). One compare -- `cmpi.b #$ff,$dff006`, the low eight bits of the beam's vertical position " +
    "-- so it is true on one line in 256, and on a PAL screen that is line 255, well down the visible picture and " +
    "nowhere near the vertical blank the name promises",
  "g cd32":
    "Routine 12 ($1750). Opens lowlevel.library (name at block +$36, base at +$32) and calls ReadJoyPort. The " +
    "guide's \"returns lowlevel bitmap\" is wrong: the routine REPACKS the result into eleven low bits of its own -- " +
    "right/left/down/up from $1/$2/$4/$8 to $8/$4/$2/$1, play $20000 to $400, reverse $40000 to $100, forward " +
    "$80000 to $200, green $100000 to $40, yellow $200000 to $80, red $400000 to $10, blue $800000 to $20",
  "g wait lmb":
    "Routine 13 ($188e). A loop on CIA-A PRA bit 6 with `Rjsr L_Tests` each pass, which is what the guide's \"all " +
    "amal and stuff will still work\" means. The `G Update` inside it is guarded on block +$12c, which is " +
    "dpkernel.library's BASE -- G Init Gms writes it there from OpenLibrary at routine 90 ($2fce) -- so the test " +
    "is whether GMS was ever started, not whether a screen is open",
  "g wait rmb":
    "Routine 14 ($18b2). The same loop on bit 10 of POTINP at $dff016. DEFECT: its `G Update` is NOT guarded on " +
    "dpkernel's base the way Wait Lmb's is, so with GMS never started it refreshes through a library that was " +
    "never opened",
  "g cli":
    "Routine 60 ($24aa). dos.library's Execute(cmd,0,0), with `adda.l #$2,a0` over the AMOS string's length word. " +
    "DEFECT: d3 -- the value register -- is left at the zero it held as an argument, so the function always " +
    "answers 0, and the failure arm writes -1 into d2, which is the TYPE register, not the value",
  "g file size":
    "Routine 64 ($2698). AllocMem($3e8, MEMF_CLEAR), Lock(name, SHARED_LOCK), Examine, UnLock, then `move.l " +
    "$7c(a4),d3` -- fib_Size. A failed lock is `moveq #$51,d0` into G Exit, error 81. DEFECT: the FileInfoBlock is " +
    "never freed, on every call and on every path out",
  "g getmem":
    "Routine 65 ($270e). Three instructions -- `lea $352(a3),a0 / move.l a0,d3` -- so the answer is the ADDRESS of " +
    "a scratch area inside the extension's own data block, 2,148 zero bytes between the last library name and the " +
    "end of it, and not a figure for free memory. Undocumented; the guide has no node for it",
  "g x mouse":
    "Routine 78 ($2b74). An ACCUMULATOR and not a coordinate, whatever the guide's \"Returns the X HARDWARE " +
    "coordinate\" says: GMS's input poll at -$24(a6) is called and the structure's x delta at +$e ADDED to the word " +
    "at block +$b32. The guide marks it \"*GMS REQUIRED*\"; ported against this port's own mouse counters, seeded " +
    "on the first read as GMS's own first poll is",
  "g y mouse":
    "Routine 79 ($2ba6). The same accumulator on +$b34. DEFECT: it loads the same two pointers as X Mouse and does " +
    "NOT call the poll, so the delta it adds is whatever the last x read left behind -- reading y without reading " +
    "x first moves nothing",
  "g set mouse":
    "Routine 80 ($2bce). DEFECT: two overlapping longs -- `move.l d0,$b34(a0)` then `move.l d1,$b32(a0)` into " +
    "fields X Mouse and Y Mouse read back as WORDS at $b32 and $b34. The second store covers $b32..$b35, so its " +
    "low word lands on the first store's field: x ends up holding the high half of the x argument, zero for any " +
    "sane coordinate, y ends up holding its low half, and the y argument reaches nothing. The guide agrees without " +
    "explaining, leaving both argument descriptions blank and saying \"DONT USE\"",
  "g iconify":
    "Routines 61 ($24d8) and 71 ($28c8), the two-argument and three-argument forms. Opens icon.library (name at " +
    "block +$94) and then workbench.library (+$a6), and if the SECOND open fails it closes the first and returns " +
    "having done nothing. That is the arm every call takes here: workbench.library is not modelled, the same wall " +
    "GameSupport's Gsiconify meets, and nothing is faked past it",
  "g icon check":
    "Routine 72 ($2a44). GetMsg on the port at block +$b22, RemoveAppIcon through workbench.library at +$b8, then " +
    "the port drained and deleted. `tst.l a0 / beq` on the port is the first thing it does and there is never one, " +
    "because G Iconify could not open workbench.library",
  "g ptload":
    "Routine 15 ($18ca). `adda.w #2,a0` first, because an AMOS string is its length word and then its bytes. " +
    "THREE DEFECTS in seven instructions, all reproduced: OpenLibrary is called on every invocation and its result " +
    "stored over the last base, so two loads are two opens and at most one close; the open is never tested, and the " +
    "next instruction is `jsr -$1e(a6)` through it, so a machine without LIBS:ptreplay.library jumps through zero; " +
    "and a module already loaded is replaced at +$d0 without being unloaded",
  "g ptplay":
    "Routine 16 ($1918). ptreplay's PlayModule ($3a6) opens `move.w #$39,$e(a5)` -- so a play sets the volume to 57, " +
    "discarding whatever Ptvolume set and not starting at full either. DEFECT: the token spec is `I`, no parameters, " +
    "and the routine opens `move.l (a3)+,d0`, a read off AMOS's parameter stack that nothing pushed; ptreplay ignores " +
    "d0, so the cost is the imbalance and not the value. Not reproduced -- this port hands a keyword its arguments as " +
    "a list, so there is no stack to leave short, the same as Opal's Ovcopperrefresh in the other direction",
  "g ptstop":
    "Routine 17 ($1934). StopModule then UnLoadModule, guarded on both the library base and the handle. DEFECT: the " +
    "handle at +$d0 is not cleared, so the guards still pass afterwards and a second Ptstop frees the same module twice",
  "g ptfade":
    "Routine 18 ($1962). The guide calls the argument a time in seconds and it is a RATE: ptreplay $6c2 writes it to " +
    "both fade bytes and the interrupt at $9b8 counts one down, reloads it from the other and drops the volume word by " +
    "one, so it is interrupt ticks per volume step. From ptreplay's own starting volume of 57 at the default tempo a " +
    "rate of 1 does take about a second, which is presumably how the guide got there. A rate of ZERO is not a fast " +
    "fade -- $6cc jumps to StopModule",
  "g ptvolume":
    "Routine 21 ($19b2). The guide's \"0-63\" is the guide's: ptreplay $59e stores the word with no clamp, and its own " +
    "PlayModule uses 57",
  "g ptpause":
    "Routine 19 ($197e). ptreplay $514 sets the pause word at handle +$0c and silences the voices",
  "g ptunpause":
    "Routine 20 ($1998). ptreplay $528 clears the word and tests nothing, so un-pausing something that was never " +
    "paused is not an error",
  "g ptchan on":
    "Routine 73 ($2ae4). BIT 0 IS THE FIRST CHANNEL -- ptreplay $6ea tests bit 0 and writes $dff0a0, which is AUD0. " +
    "The guide's \"G Ptchan %0101 for chan 2 and 4 to be turned on\" reads the binary literal left to right and is " +
    "wrong. ptreplay ANDs the mask with the channels it can have first ($884 walks four audio nodes for a type word of " +
    "13); there is no audio.device arbitration here and no other task to lose a channel to, so all four are available",
  "g ptchan off":
    "Routine 74 ($2b00). The same mask the other way; see Ptchan On for the bit order",
  "g ptset pos":
    "Routine 75 ($2b1c). The guide gives up on this one -- \"jono not done. Pac, position meaning the pattern to " +
    "continue from?\", the two authors' note to each other left in the shipped file -- and ptreplay $7fe answers it: " +
    "`move.b d0,-$c(a0)`, the song position, the same byte Ptpos reads back. APPROXIMATED: ptreplay writes the byte " +
    "raw with no test against the song's length and lets its interrupt find it, where Protracker.setPosition sends a " +
    "position past the end back to 0, so the two differ for an out-of-range argument",
  "g ptpos":
    "Routine 76 ($2b38). The byte at handle -$0c. Undocumented: the guide has a node for Ptlength and none for this",
  "g ptlength":
    "Routine 77 ($2b56). ptreplay $5c8 follows the handle to the module and reads byte $3b6, which in a 31-sample " +
    "module is the song length -- 20 bytes of title and thirty for each sample. So it is the number of positions, not " +
    "a duration",
  "g set table":
    "Routine 94 ($31bc). Undocumented -- the guide has no node for it, and Gsin and Gcos are useless without it. N " +
    "is the steps in a quarter turn, so `G Set Table 90` is the degrees the Gcos node assumes. AllocMem(10N, " +
    "MEMF_CLEAR), the sin pointer at block +$bce and the cos pointer 2N bytes on at +$bd2, the size at +$bd6; the " +
    "worker at $323c fills 5N words with a cosine Taylor series to x^12/12! in 16.16, `lsr.l #$1` and the low word, " +
    "so a word is cos(x)*32768 -- reproduced as the 68020 arithmetic, because the port's answers are what survives " +
    "an `asr.l #$8`. cos(0) would be $8000 and so negative, and the `tst.w d1 / dbpl d1` pair at $329e turns it into " +
    "$7fff. THREE DEFECTS, all reproduced. The doubling is `asl.w` while the size is a long, so a count of 32768 or " +
    "more wraps to the 180 default and the fill then writes far outside the block (contained here rather than " +
    "reproduced: there is no neighbouring allocation to trash). The default reaches the SIZE and not the count the " +
    "fill is handed, so `G Set Table 0` runs `divu.l d0,d1` on zero -- surfaced as AMOS error 20, as GameSupport's " +
    "zero-divide is. And FreeMem runs before AllocMem, so a failed allocation leaves +$bce and +$bd2 pointing at " +
    "memory just handed back",
  "gsin":
    "Routine 85 ($2e1e). Seven instructions on the table G Set Table built: no test that there is one, no bounds " +
    "test, and the index doubled with a WORD shift then used as a SIGN-EXTENDED displacement, so it wraps every " +
    "32768 entries and reads backwards for half of that. Both cases are memory this port does not model and both " +
    "answer 0. `asr.l #$8` is the guide's \"multiplyed by 128\". DEFECT: the routine writes only the LOW half of d3 " +
    "and then shifts the whole register, so with the high half zero -- the only reading under which GScreen Width " +
    "reports a width -- the shift is logical and the sine of 210 degrees comes back as 192 rather than -64. AMOS " +
    "guarantees nothing about that half: the official example extension sign-extends at every word-sized return " +
    "(`move.b 88(a0),d3 / ext.w d3 / ext.l d3`, |Music.s) and so does AMOSPro.Lib, and this extension's own G Amiga " +
    "clears d3 first, so the author knew. SECOND DEFECT: the token spec is `10` and `1` is AMOS's code for a " +
    "function returning a FLOAT, while the routine sets no type in d2 at all -- answered as an integer here",
  "gcos":
    "Routine 86 ($2e32). The same seven instructions on +$bd2, which is the same table read N entries later. Carries " +
    "both of Gsin's defects, and reads the quarter that has a third: `move.w d1,-(a4)` starts at entry 5N, one past " +
    "the end, so entries 4N..5N-1 hold cos(k+1) where they should hold cos(k). With the usual N of 90 those are " +
    "exactly the entries Gcos reads for 270..359 degrees, and `Gcos(270)` answers 2 -- cos(271) -- instead of 0",
  "g oddno":
    "Routine 30 ($1d14). Two instructions, `move.l -$18ae(a5),d3 / rts`, and that slot is AMOS's graphics.library " +
    "base (src/cli/oscalls.ts names the set), so the answer is a library pointer and has nothing to do with odd " +
    "numbers. The guide's node is the synopsis `A=G Oddno(B#)` and no description, and the synopsis is wrong too: " +
    "the spec is `V0` and `V` is AMOS's code for a RESERVED VARIABLE (|Music.s), so it takes no argument and no " +
    "brackets, which is what the routine popping nothing already said. It sits among eight bare `rts` placeholders " +
    "at routines 29 and 31-38",
  "g handicap":
    "Routine 88 ($2eec). FindTask(NULL) into block +$b36, then SetTaskPri with the old priority saved at +$b3a. " +
    "DEFECT: the priority is `move.l #$80,d0` and SetTaskPri reads a SIGNED byte, so it is -128, the bottom of the " +
    "range -- the guide's \"Gives Amos a priority of 256! Shutting off many system funcions thus speeding up your " +
    "code\" is wrong in both halves and only the name is accurate. There is no scheduler here to apply a priority " +
    "to, so the value is recorded and nothing else happens, as TURBO's Multi No does",
  "g init encyrpt":
    "Routine 28 ($1cee). The table's own misspelling, which has to stay -- it is what a program tokenises against. \
Bnk_Reserve of 100,000 bytes in bank 9 under the name \"TGE   En\", result untested, and pointless: G Encrypt \
reserves the bank it was given whatever this did, and Bnk_Reserve frees an existing bank of that number first. \
DEFECT: `bset.b #$0,d1` on a register nothing initialises, so the bank type is Bnk_BitData ORed with whatever the \
interpreter left. G Encrypt writes the same bset sixteen bytes before a `moveq #$1,d1` that overwrites it, so the \
author had the idiom and used it once by accident. Reserved as a Data bank here",
  "g encrypt":
    "Routine 26 ($19d6). The guide's \"G Encyrpt File$,Bank,Password$\" under a misspelled node name, and the \
argument order is right. Checksum the password to block +$b2a, AllocMem a FileInfoBlock, Lock/Examine/UnLock the \
file for its size, OpenLibrary(\"stc.library\"), take a work buffer and a file buffer from it, read the file, \
crunch it through the tag list at block +$138 (source, length, work buffer, and a hard 12 for the offset width), \
Bnk_Reserve the bank as Data under \"TGE   En\", copy, then add $1131511 to the first longword and swap four words \
at bank+8 with four at bank+16+<a byte of the checksum>. The compression is StoneCracker 4.04, reproduced from \
stc.library 3.322 in src/amiga/stonecracker.ts. THE PASSWORD IS ONE BYTE: `add.b` cannot carry, the doubled sum is \
stored as a longword whose top two bytes are therefore always zero, and the loop that makes it covers offsets \
len..0 of the AMOS string -- so both bytes of the LENGTH are in the sum and the last character is not. \
\"secret\" and \"secreX\" unlock the same bank. DEFECTS: OpenLibrary on every call with the base stored over the \
last, as G Ptload does and as G Decrypt next door does not; the FileInfoBlock never freed; and the swaps reaching \
bank+272 with no length test, which a short crunch writes past -- contained here rather than reproduced, and \
skipped symmetrically by G Decrypt so the pair still round-trips. The error numbers are AMOS's used as the \
author's: 24 \"Out of memory\" is apt, 81 \"File format not recognised\" is for a file that would not lock, and 1 \
\"RETURN without GOSUB\" is for a missing stc.library",
  "g decrypt":
    "Routine 27 ($1bee). Spec `I0t0,2`, so `G Decrypt SOURCE To DEST,PASSWORD$` -- the guide's \"G Decyrpt \
sourcebank to destbank\" is a parameter short. Undoes the swaps and the magic in the SOURCE bank, takes the \
decrunched length out of the StoneCracker header at +$8, reserves the destination for exactly that, and \
decrunches. The magic and the swaps commute, sixteen bytes apart, so doing the subtraction first where the \
inverse wants it last costs nothing. DEFECTS: the source bank is left decrypted, so a second G Decrypt of it \
subtracts the magic from a longword that no longer has it; Bnk_GetAdr is not tested; and the OpenLibrary arm is \
`tst.l d0` at $1c38 with NO branch after it -- the failure test was written and never connected, so a machine \
without stc.library reaches `jsr -$24(a6)` through a zero base",
  "g open reqtools":
    "Routine 9 ($16f0). The guide marks all four requester commands \"Removed\" and this is the one that is still \
here in full: OpenLibrary on the name at block +$20 with any version accepted, base to +$1c, and the base \
returned -- fetched through an ABSOLUTE `move.l $a50.l,d3`, which is the same longword as +$1c(a3) after \
relocation. src/amiga/exec.ts models reqtools.library and src/runtime/requester.ts is its requesters, so the \
failure arm is unreachable here; on a machine without it, routine 151 reports \"(TGE) You don't have the \
required library in LIBS:\"",
  "g close reqtools":
    "Routine 10 ($1722). CloseLibrary on the base at +$1c. DEFECT: +$1c is not cleared, so a second call closes \
the same base again -- on a machine that drives a library's open count below zero and eventually expunges one \
somebody else is using",
  "g close req":
    "Routine 8 ($16d4). CloseLibrary on the base at block +$0c, and NO instruction in the code hunk ever writes \
that longword -- the name \"req.library\" is still at +$10 with nothing referring to it either. So the guide's \
\"Removed\" is half right: the OPENER went and this was left behind closing a library nobody opened. The \
trailing `moveq #$0,d2` sets the TYPE register in an instruction, where nothing reads it",
  "g stc pack":
    "Routine 98 ($35be). Undocumented -- the guide has no node for either packer and mentions stc.library only as \
something the installer will put in LIBS:. The same 392 bytes as G Encrypt with the password and the scramble \
removed, so the bank it leaves is a plain S404 file; see src/amiga/stonecracker.ts. DEFECT: Bnk_Reserve is given \
d4, the CRUNCHED length, and CopyMem is then given d6, the length of the FILE -- G Encrypt has `move.l d4,d0` in \
the same place and is right. So anything that crunches is written past the end of the bank by the difference, and \
anything that does not (nine-bits-a-byte literals make that easy) leaves a SHORT copy and a truncated file that \
will not unpack. The overrun is contained here and the truncation reproduced. DEFECTS besides: the FileInfoBlock \
never freed and stc.library opened on every call, both as in G Encrypt. The error numbers differ from G \
Encrypt's for the same conditions: a failed lock is `Rbeq routine 59` with d0 still zero and G Exit turns zero \
into 16, \"Illegal user function call\", where G Encrypt says 81; a missing stc.library is `moveq #$2,d0`, \
\"POP without GOSUB\", where G Encrypt says 1",
  "g stc unpack":
    "Routine 99 ($3746). Bnk_GetAdr the source, take the decrunched length out of the StoneCracker header at +$8, \
reserve the destination for exactly that under \"TGE   En\", decrunch. G Decrypt without the password. DEFECT: \
it opens with G Decrypt's password checksum -- `move.w (a1),d1 / add.b (a1,d1.w),d4 / dbra d1` -- and has no \
password: its spec is `I0,0`, it pops two integers, and a1 is whatever the interpreter left there, so the loop \
reads a word from a stale pointer as a length and then that many bytes. d4 is never used again. Nothing here can \
reproduce reading through a stale pointer. DEFECTS besides: Bnk_GetAdr untested, and the same disconnected \
`tst.l d0` on the OpenLibrary result that G Decrypt has. A bank that is not reserved raises AMOS's own \"Bank \
not reserved\" here, where the machine writes through a zero a0 -- a DEVIATION, there being no address zero. \
S403 is not implemented: this is the keyword that can be handed one",
  "g word$":
    "Routine 81 ($2be0). APPROXIMATED. The guide says \"Not DONE\" and the routine agrees. Both scans put \
`cmp.w d5,d3` immediately before `cmp.b d7,d0`, so the length compare's flags are gone before anything branches \
on them and neither scan can stop at the end of the string -- on the machine they run into AMOS's string bank \
until a byte happens to match the separator. And `adda.l d3,a0` moves the base to the separator while the second \
scan still indexes from d3, counting the offset twice, so the field is looked for at twice the separator's \
offset and copied from two characters past it. There is no string bank here, so both scans stop at the end of \
the text and the answer is the empty string for any string short enough that the doubled offset is already past \
its end -- which is almost every call. DEFECTS besides: the result is AllocMem'd and never freed, `moveq #$2,d2` \
is missing so the TYPE register is never set, and an AllocMem failure returns with d3 still holding the scan \
OFFSET, a small integer handed back as a string pointer",
  "g unhandicap":
    "Routine 89 ($2f18). SetTaskPri again with the task and the priority read straight back out of +$b36 and +$b3a. " +
    "TWO DEFECTS: neither is tested, so calling it on its own passes SetTaskPri a null task; and a second G Handicap " +
    "saves the -128 the first installed, so the restore restores the handicap",
  "g screen open":
    "Routine 39 ($1d2a), 426 bytes. AMOS_WB to send the AMOS display behind, an Rbsr straight into routine 90 so \
G Init Gms is not a prerequisite, the mode normaliser, then Free/FreeMem on any screen already at N, a 200-byte \
tag list copied out of the template at block +$1f6, four of its values patched, Init and Show. The template is a \
TAGS_SCREEN list and the offsets patched are its value slots, not a structure's fields: +$14 Height, +$1c Width, \
+$24 ScrMode and +$34 the Bitmap's AmtColours through a TSTEPIN. The screen becomes slot \
Runtime.screenRange('game').from + N. DEFECT: `moveq #$0,d1` sets up the AMOS_WB argument over the X argument \
that was just popped into the same register, and nothing puts it back -- so Width is set to zero, which GMS reads \
as \"user default\", which GMSPrefs ships as 320. A program asking for 640 gets 320. DEFECT: nothing bounds N, and \
table entries 9 and 10 are the current Screen and Bitmap pointers; this port raises AMOS's illegal screen number \
instead, the three fields not being adjacent longwords here",
  "g screen close":
    "Routine 40 ($1ed4). Free on the Screen, FreeMem on the 200-byte tag list, table entry cleared. DEFECT: with \
nothing open at N the table entry is zero and `movea.l $4(a4),a0` reads the longword at absolute address 4 -- \
ExecBase -- and hands it to Free; the guard beside it, `cmpa.l #$5120,a0`, tests a constant nothing produces. \
Refused here. DEFECT: it clears neither the +$18c flag byte nor +$1be/+$1c2, so GScreen Width after closing the \
current screen reads the structure just handed back; the port keeps the Screen object for the same reason, which \
is what unreused freed memory reads like",
  "g screen hide":
    "Routine 49 ($217a). Hide(Screen), and the only screen number in the batch that is checked -- `cmp.l \
#$ffffffff,d0` returns on -1. DEFECT: `move.b #$ff,$18c(a3)` has no index, so it marks screen 0 hidden whichever \
screen was hidden, where routine 39 writes the same table as `$18c(a3) + d0`. Costs nothing: the byte is written \
in two places and read in none, so it is not modelled",
  "g screen show":
    "Routine 50 ($21be). Show(Screen), with no -1 guard and no test that the screen exists",
  "g screen":
    "Routine 92 ($30fe), no guide node. AMOS's Screen for the game display: the number to +$195, the Screen and its \
Bitmap to +$1be and +$1c2, which is where every drawing keyword starts. No check that the screen is open",
  "g screen copy":
    "Routine 93 ($3132). CopyStructure, then the Bitmap palette store, UpdatePalette, then Copy on the two Bitmaps. \
The CopyStructure does nothing and the autodoc says why -- it writes \"Only the NULL fields in the Destination \
structure\" and both screens are initialised. DEFECT: `move.l $38(a0),d5 / move.l d5,$38(a1)` copies the Bitmap's \
Palette POINTER, so the destination stops having a palette of its own -- a later G Colour on either changes both, \
and closing the source leaves the other pointing into freed memory. Reproduced by sharing the array. DEVIATION: \
Copy on two Bitmaps \"features automatic clipping and remapping\" and Screen.copyBuf clips but does not remap; \
after the palette store the indices mean the same thing in both, so there is nothing to remap",
  "g screen offset":
    "Routine 103 ($3bec). SetScrOffsets(Screen a0, ScrXOffset d0, ScrYOffset d1) -- where the screen sits on the \
monitor, which is the guide's last sentence (\"The X and Y offsets are HARDWARE, coordinates\") and not its \
description, which belongs to G Bitmap Offset. GMS measures from the display's top left and GMSPrefs puts that at \
TopOfScr (128,44), so the port adds that origin to reach AMOS's displayX/displayY",
  "g bitmap offset":
    "Routine 104 ($3c20), no guide node. SetBmpOffsets(Screen a0, BmpXOffset d0, BmpYOffset d1) -- which part of a \
bitmap larger than its viewport is shown, which is AMOS's own Screen Offset. The same routine as G Screen Offset \
with one LVO changed. DEVIATION: GMS wants SCR_HSCROLL/SCR_VSCROLL in Attrib for this to be legal and TGE's \
template sets neither and has no keyword that would; whether the module refuses is not in the autodoc, and the \
port scrolls",
  "g update":
    "Routine 53 ($224a). WaitAVBL() in screens.mod, and the guide is exactly right about a call it never names: \
\"also checks for an Amiga+M keypress (ie. allows the screen to multitask!)\" is the autodoc's \"This version of \
WaitVBL() will automatically pause your Task if the user moves the focus to a different program\". Plain WaitVBL \
sits two entries along and does not",
  "g double buffer":
    "Routine 123 ($4168), and it does not double buffer. Four instructions: `movea.l $1c8(a5),a0` loads the data \
block and `movea.l $1be(a4),a1` then indexes a4 -- the bytes are `20 6d 01 c8 / 22 6c 01 be`, so it is a4 and not \
a misprint. The offset is wrong too: $101 is SCR_BLKBDR|SCR_DBLBUFFER and belongs in Attrib, and +$0c of a Screen \
is MemPtr1. What it means is the Attrib value slot of the TEMPLATE at block +$1f6, which is at +$0c of it and \
does ship as $100; `lea $1f6(a0),a1` is the missing line. A no-op here because a no-op is what it is",
  "g triple buffer":
    "Routine 125 ($4194). The same four instructions as G Double Buffer with $102 for $101, and broken the same \
two ways",
  "g swap buffers":
    "Routine 124 ($417a). SwapBuffers(Screen) on the current screen, and this one really is the right call in the \
right register -- it just has nothing to do, because the two keywords that would ask for a second buffer cannot. \
The autodoc is conditional: \"If the screen is double buffered, this function swaps Screen->MemPtr1 with \
Screen->MemPtr2\"",
  "g getscr":
    "Routine 54 ($2260), no guide node, and no effect. `move.l #$1,d0 / Rjsr <AMOS routine> / move.l a0,d0 / rts`: \
the routine called takes the screen NUMBER in d1 and returns the screen in a0, TGE sets d0 instead and leaves d1 \
holding whatever the interpreter left, and then moves the result into d0, which for an instruction goes nowhere -- \
the value register is d3. No arguments (spec `I`), no result and nothing changed",
  "glowres":
    "Routine 46 ($215e). `move.l #$8,d3 / moveq #$0,d2` -- SM_LORES, and the shape all four mode functions should \
have had. Undocumented; the guide names Lowres, Hires, SuperHires, Ebh, EHam, Chunky8 and Chunky16 as G Screen \
Open modes and the table has keywords for four of them",
  "ghires":
    "Routine 47 ($2168). SM_HIRES, 1",
  "gsuperhires":
    "Routine 45 ($2158). SM_SHIRES, 2, and the constant is right. DEFECT: G Screen Open cannot use it. Its \
normaliser at $1d6e-$1dbc passes 8 and 1 straight through and subtracts 4 from everything else before comparing \
again, so 2 becomes -2, matches none of the three arms and falls out of the default one as 1+4 -- \
SM_HIRES|SM_LACED. An interlaced hi-res screen is what the keyword opens",
  "gham":
    "Routine 48 ($2172), and it never sets the value register: `move.l #$0,d2 / rts` writes the TYPE register and \
stops. Its three neighbours are `moveq #<mode>,d3 / moveq #$0,d2`, so the missing instruction is visible in the \
shape of the routine, and there was no constant to write -- GMS has no HAM in ScrMode, HAM being BMF_HAM on the \
Bitmap's Flags. DEVIATION: what a program gets is the last thing evaluated, and this port hands keywords their \
arguments as values rather than through a shared register, so there is no last thing; zero, which the normaliser \
turns into SM_LORES",
  "gscreen width":
    "Routine 107 ($3e02). `movea.l $1c2(a1),a0 / move.w $10(a0),d3` -- the BITMAP's Width, so a bitmap larger than \
its screen reports the bitmap. DEFECT: no test on +$1c2, which ships zero, so all three of these read through a \
null pointer before the first screen opens. The word goes into d3 without clearing it, which costs a width \
nothing",
  "gscreen height":
    "Routine 108 ($3e12). The Bitmap's Height at +$14, with the same two defects",
  "gscreen colour":
    "Routine 109 ($3e22). The Bitmap's AmtColours at +$34, and a LONG -- `move.l`, so this is the one of the three \
that writes its whole value register and the only one the uncleared-d3 defect misses",
  "g ink":
    "Routine 7 ($16b8). SetRGBPen(Bitmap a0, RGB d0) in blitter.mod, on the current Bitmap at +$1c2. DEFECT: the \
guide says the argument is \"The number (not $RRGGBB value) of the colour to use\" and it is the $RRGGBB value -- \
blitter.mod has no pen-by-index call for the node to have meant instead, SetRGBPen being the only pen setter in \
it. The node is describing AMOS's Ink",
  "g palette":
    "Routine 67 ($274e). AllocMem(100), the eight colours into it, ChangeColours(Screen a0, Colours a1, \
StartColour d0, AmtColours d1=8), UpdatePalette, FreeMem. The buffer is a bare array of 24-bit longs and not an \
RGBPalette, which is right -- the autodoc's own example is a plain LONG array. DEFECT: the colours go in \
BACKWARDS. It pops into d0 first and stores d0 at the front, and pops run right to left, so the buffer holds \
C8..C1 and ChangeColours reads it forwards from First. The guide's worked example says the opposite: \"will start \
at colour 3 (0,1,2,`3'). Putting 3 as black, 4 as white\" -- the routine puts 3 white and 10 black",
  "g def palette":
    "Routine 69 ($281e), and the guide is exactly right about it: \"you use this one BEFORE you open a screen, \
this way all screens will have this palette when openend\". More literally than that reads -- the RGBPalette is \
hung off the screen TEMPLATE's BMA_Palette, a POINTER tag, so every screen opened afterwards shares one array and \
a G Colour on any of them is a G Colour on all. The block is stamped `move.l #$1c0001,(a1)` = PALETTE_ARRAY = \
(ID_PALETTE<<16)|1, and G Screen Open fills in its AmtColours. This one pops DESCENDING and gets the colour order \
right, next door to the one that does not. DEFECT: AllocMem is asked for $400 and struct RGBPalette is 1,032 \
bytes, so the block holds 254 colours and a First above 246 writes past it",
  "g colour":
    "Routine 70 ($28a2). UpdateColour(Screen a0, Colour d0, Value d1) then UpdatePalette(Screen), both on +$1be. \
Four instructions with nothing wrong in them, which in this extension is worth recording",
  "g get palette":
    "Routine 118 ($4046). CopyPalette(SrcPalette a0, DestPalette a1, ColStart d0, AmtColours d1, DestCol d2) in \
colours.mod, both ends reached through tag list, Screen, Bitmap, Palette. The count is the DESTINATION Bitmap's \
AmtColours, so a shallow destination copies fewer colours than a deep source has. DEFECT: the UpdatePalette that \
follows takes a Screen in a0 and gets whatever CopyPalette left there. Not observable here -- the copy has \
already landed in the array the display reads",
  "g set pen":
    "Routine 112 ($3e70), and it IS G Blur: both token entries name instruction 112. Five pops, `sub.w d0,d2 / \
sub.w d1,d3`, and BlurArea(Bitmap a0, StartX d0, StartY d1, EndX d2, EndY d3, Setting d4) in colours.mod. DEFECT: \
G Set Pen's spec is `I0,0` and pushes two, so three of the five pops read longwords nobody pushed and the \
rectangle blurred is made out of them. What the guide describes -- \"Sets the style and radius of the brush\", \
Type 0-2 -- is SetPenShape(a0l,d1w,d2w) at blitter -$fc, a different module, and even the numbering is somebody's \
memory of it: blitter.h has PSP_CIRCLE 1, PSP_SQUARE 2, PSP_PIXEL 3. APPROXIMATED: the arguments are evaluated \
and nothing else happens, the three stray longwords being whatever is under AMOS's parameter stack pointer -- \
deterministic on the machine and not modellable by a port that hands a keyword its arguments as a list",
  "g init gms":
    "Routine 90 ($2f36), 442 bytes, no guide node. OpenLibrary(\"GMS:libs/dpkernel.library\", 2) into +$12c, +$d4 \
set to remember it was this that opened it, then five OpenModule calls and Get(ID_TASK) for the input structure. \
Idempotent -- the first four instructions test +$12c and return. A failed open is message 4. The module bases are \
not modelled: a GMS call is a TypeScript call here. DEFECT: the check that GMS is installed checks nothing -- \
`Lock(block+$12c, ACCESS_READ)` on the base slot, four zero bytes at that moment, where the name it means is at \
+$112 and is the same string the OpenLibrary two arms later uses; AmigaDOS answers an empty name with a lock on \
the current directory, so the guard passes everywhere. NOTE: the second entry at $2fe2 is for a GMS program \
calling in, found through the PRGM record at $2f88 -- \"PRGM\", a version pair, that address and pointers to \"The \
Game Extension\", \"Peter Cahill\", \"30th Jan\", \"PAC Productions\" and \"The BEST Extension\". No AMOS program \
can reach it, which is what makes G Own Blitter useless",
  "g close gms":
    "Routine 119 ($40a8), no guide node. Free on all five modules and the input structure, CloseDPK, +$12c \
cleared, and the whole of it guarded on +$12c so a second call is safe. DEFECT: no test of +$d4 before CloseDPK, \
which routine 90's own teardown at $30d6 does test, so a TGE that inherited GMS from a host shuts the host's down \
-- unreachable from AMOS, nothing in BASIC being able to take the hosted path",
  "g reset":
    "Routine 44 ($20de). Guarded on +$12c, then eight G Screen Close calls with 0 through 7 -- literally, by \
pointing a3 at block +$bda as a parameter stack, pushing `move.l #N,-(a3)` and Rbsr'ing routine 40 eight times. \
Then `moveq #$1,d1 / EcCall AMOS_WB`, which is what settles the argument: G Screen Open passes 0 and opens a \
screen the guide says goes \"in front of the amigas current display\", and this passes 1 with every game screen \
just closed, so 0 is back and 1 is front. It re-initialises nothing despite the name -- GMS stays open and the \
current Screen and Bitmap pointers are left where the last close left them",
  "g exit":
    "Routine 59 ($248e), no guide node, and not an exit: G Reset and then `Rjsr L_Error` with d0, so the program \
stops with an AMOS error. DEFECT: the code raised is whatever is in d0 -- the spec is `I` and nothing pushes \
anything, and the `tst.l d0 / bne` means the 16 it defaults to is used only when the leftover happens to be zero. \
The shape is an argument the author forgot to declare, the same slip as G Ptplay's the other way up. 16 here, \
that being the only value this port can know about",
  "g amiga":
    "Routine 91 ($30f0), no guide node. Four instructions on ExecBase +$128, AttnFlags, handed back raw -- bit 0 \
68010, 1 68020, 2 68030, 3 68040, 4 68881, 5 68882, 7 68060 -- where AMCAF's =Cpu, TURBO's Cpu Info and JD's =Jd \
Cpu all read the same word and answer a model number. The machine those three answer for is an A1200, bit 1 and \
no FPU, and this answers the same machine unreduced. It is also the one function in the extension that clears d3 \
before writing a word into it, which is how the four that do not can be called oversights",
  "g make rp":
    "Routine 100 ($37d8), no guide node, 192 bytes of which 140 are unreachable. DEFECT: AllocMem(200), `move.l \
#$3,d3`, then a beq and a bra.w to the same exit -- it always returns 3 and never frees the block. The beq could \
not fire anyway, the move.l between it and the tst.l setting the flags. What the dead half does is worth \
recording: it opens graphics.library from the name at block +$6e into +$80, calls InitRastPort (-$c6) and \
InitBitMap (-$186) over the two halves of the block, reads the current GMS Bitmap's Data at +$c and stores it to \
absolute address 8, and returns the RastPort -- the bridge that would let AMOS's own drawing reach a GMS screen, \
left switched off",
  "g own blitter":
    "Routine 120 ($4100), no guide node, and it cannot work. `move.w #$1,$2e(a1)` with a1 out of block +$da, and \
+$2e of dpkernel's base is GVBase.OwnBlitter, \"0 = FALSE, 1 = TRUE\" in globalbase.h -- so the intent is exact \
and the pointer is not there. One instruction in the code hunk writes +$da, at $2ff6 on G Init Gms's hosted entry \
path, which only a GMS program calling in through the PRGM record can reach. Everything AMOS runs leaves +$da \
zero, so the keyword writes a word to address $2e. The base is also at +$12c, four instructions from the store \
that should have set both",
  "g agaplasma":
    "Routine 41 ($1f36), one rts, and the guide's whole node for it is the words \"NOT DONE\"",
  "g plot":
    "Routines 42 ($1f38) and 110 ($3e32), two arities on one name. With a colour it is DrawPixel(Bitmap a0, \
XCoord d1, YCoord d2, Colour d3); without, PenPixel(Bitmap a0, X d0, Y d1), which draws in the pen G Ink set. \
Both correct. The guide's \"If X and Y are bigger than the screen (like x=340) no error will report and no pixel \
will be drawn\" is the blitter's clipping and not the extension's",
  "g line":
    "Routines 66 ($2724) and 68 ($27fa). The five-argument form is right: DrawLine(Bitmap a0, XStart d1, YStart \
d2, XEnd d3, YEnd d4, Colour d5, Mask d6) with `move.l #$ffffffff,d6`, which the autodoc asks for -- \"A 32 bit \
masking value. Use 0xffffffff for an uninterrupted line.\" That `move.l` is also independent proof that the \
module's own name string, which lists five data registers, is a revision behind the six the code reads. DEFECT: \
the three-argument form does not return. Routine 68 has no `movem.l a0-a6,-(a7)` going in and a `movem.l \
(a7)+,a0-a6` coming out, so it lifts 28 bytes off the stack nobody pushed and rts returns above them; it also \
never loads the Bitmap into a0, putting it in d0, and reads it off a3 -- the parameter stack, not the data block. \
APPROXIMATED: three arguments evaluated and nothing drawn, which is the nearest a port gets to a keyword that \
does not come back",
  "g circle":
    "Routine 51 ($21f2). PenCircle(Bitmap a0, X d0, Y d1, RadiusX d2, RadiusY d3) and `moveq #$0,d3`, which is \
right for a reason the author may not have known: blitter.mod $506c tests the saved d3 and branches, so a zero \
vertical radius takes the circle arm and the horizontal radius serves for both. Draws in the pen. NOTE: the \
autodoc gives PenCircle a sixth argument, Fill [d4], and the shipped module has none -- $504a is `moveq #$0,d4` \
and d4 is that routine's own loop counter from there on",
  "g rectangle":
    "Routine 121 ($4110). PenRect(Bitmap a0, X d0, Y d1, Width d2, Height d3, Fill d4), the far corner subtracted \
into a width and a height. DEFECT: it never sets d4, and PenRect really does branch on it -- blitter.mod \
$5a30-$5a5e saves d4 and tests its low word for the fill path. G Circle next door clears d3 before its own call, \
so the habit was there and missed here. DEVIATION: the outline is drawn, there being nothing for a leftover \
register to be. NOTE: a width of X2-X1 reaches X2-1, so the rectangle stops a pixel short of the corner the guide \
names; G Copyarea and G Blur share the arithmetic and the edge",
  "g cls":
    "Routine 52 ($2214). dpkernel's Clear(Object) on the current Screen, which the Screen object's own autodoc \
gives as \"Clear the Screen->Bitmap's current data area\" -- the guide's \"Clears the TGE screen with colour 0\" \
is right. It reaches the Screen through the table and +$195 rather than +$1be like everything else, which comes \
to the same thing",
  "g blur":
    "Routine 112 ($3e70), which is also G Set Pen. BlurArea(Bitmap a0, XStart d0, YStart d1, Width d2, Height d3, \
Setting d4) -- the published colours.c names the third and fourth Width and Height where the .fd and the autodoc \
both say EndX and EndY, which is what makes the `sub.w` correct rather than an off-by-corner. The algorithm is \
that source's, reimplemented: each pixel becomes the average of its four ORTHOGONAL neighbours and not itself, a \
read off the bitmap counts as black, and the write is in place so a pixel's left and upper neighbours are already \
blurred when it is reached. DEFECT: Percent is a flag. `if (Setting < 1) return` is the routine's first line and \
nothing reads it again, so the guide's \"Percentage (1-100) of how much you want it to smudge the area\" is one \
fixed blur across the range -- and its next sentence, \"The Speed is roughly the same for all 1-100\", is the \
symptom. NOTE: the token entry declares func 1 as well as instr 112, where every other instruction-only keyword \
carries $ffff; the spec begins `I`, so it is never consulted",
  "g copyarea":
    "Routine 114 ($3f3e). BlitArea(SrcBitmap a0, DestBitmap a1, XStart d0, YStart d1, Width d2, Height d3, XDest \
d4, YDest d5, Remap d6), both bitmaps fetched the long way through the screen table, the far corner subtracted \
into a width and a height, and `moveq #$0,d6` for no remapping. Correct, and in the argument order the guide \
gives -- which also confirms that a0 is the source",
  "g point":
    "Routine 84 ($2dfc). ReadPixel(Bitmap a0, XCoord d1, YCoord d2), `move.l d0,d3`, `moveq #$0,d2`: a colour \
NUMBER, with both registers set properly, which in this extension is worth recording. The guide's node is headed \
`A=G Pixel(B,C)`, an earlier name, and its text spells the shipped one",
  "g rgb":
    "Routine 111 ($3e50), no guide node. ReadRGBPixel(Bitmap a0, XCoord d1, YCoord d2) -- the pixel's $00RRGGBB \
rather than its index. DEFECT: it sets d3 and never d2, and d2 is where the Y argument was popped, so the TYPE a \
program gets back is its own Y coordinate. Answered as an integer here, which is what the value is",
  "g load iff":
    "Routine 43 ($1f58), no guide node, and the second way a GMS screen comes into existence. It opens like G \
Screen Open -- AMOS_WB(0), Rbsr into routine 90, the same Free/FreeMem/table[N]=0 block -- then builds a \
two-field descriptor at block +$16c, `move.w #$11,(a0)` being ID_FILENAME from register.i and $2(a0) the string, \
and calls Load(Source a0, ObjectID d0) with ID_PICTURE. The screen is then built round the picture and not round \
the template: Get(ID_SCREEN) for a blank one, CopyStructure(Picture, Screen) for its width, height, depth, mode \
and palette -- legal exactly because the destination is uninitialised and CopyStructure writes \"Only the NULL \
fields in the Destination structure\" -- then Init, Copy for the pixels, Show, and Free on the Picture. NOTE: the \
200 bytes it allocates hold one pointer at +$4, and the `lea $1f6(a3),a0` before the register restore is a \
leftover from the routine this was copied out of; the CopyMem that would have used it is not here",
  "g save iff":
    "Routine 102 ($3bb0), no guide node. SaveToFile(Object a0, Filename a1, Type a2) on the current Bitmap with \
the same ID_FILENAME descriptor and a null Type; the Bitmap Size read into d0 first is never used. DEFECT: the \
descriptor is built through a4 -- `move.l a1,$2(a4) / move.w #$11,(a4)` -- where routine 43 builds the identical \
thing at block +$16c. The save works, the same a4 being handed to SaveToFile; the cost is six bytes written over \
whatever a4 pointed at. Same slip as G Double Buffer's, which is not so lucky",
  "g save bitmap":
    "Routine 87 ($2e46), no guide node, and not an IFF: the bitmap's bytes with no header. AllocMem of the \
Bitmap's own Size at +$28, dpkernel Read(Object a0, Buffer a1, Length d0) to pull the pixels out, then \
dos.library directly -- Open with #$3ee (MODE_NEWFILE) in d2, Write, Close. The filename is left on AMOS's \
parameter stack until after the allocation, which is why the failure arm at $2e88 pops it before jumping into G \
Exit with 24 rather than 16. DEVIATION: what comes out is the planar data of this port's own bitmap, row by row \
and plane within row, which is the layout GMS's ILBM bitmaps use. The buffer is not freed on the machine either",
  "g load pcx":
    "Routine 117, no guide node, and it does not call the PCX module. `lea $f2(a3),a6 / jsr -$6(a6)`: lea where \
every other module call in the extension has movea.l, so a6 becomes block+$f2 rather than the base stored there \
and the jsr goes to block+$ec -- into the middle of the extension's own table of module bases, which is data. \
Routine 112 makes the same call correctly with `movea.l $ee(a3),a6`, which is what makes this a typo and not a \
convention. Nothing is reproduced: executing a table of pointers as code is not something this port has an answer \
for, and no answer is right",
  "g load bobs":
    "Routine 101 ($3898), no guide node, and the one bob system in the extension that works. Lock, Examine for \
fib_Size at +$7c, UnLock, Bnk_Reserve of that many bytes under the name at block +$bc2 -- \"TGE  Bob\", two \
spaces -- then Open, `Seek(file, 20, OFFSET_BEGINNING)`, Read and Close. Twenty is an AmBk header, so the file is \
a saved memory bank and the payload is the bank's: WORD $305f, WORD $0900, WORD count, count longword offsets to \
image records, then count Bitmaps it builds itself, then a zeroed tail. A record is AMOS's own Bob record with a \
length longword on the front instead of a hot spot on the back -- LONG size, WORD width in 16-pixel words, WORD \
height, WORD depth, planes -- and the Bitmap comes off the tag list at block +$2f0, `$fffb0005` = \
(ID_SPCTAGS<<16)|ID_BITMAP, with BMA_Type copied off the current screen's. DEFECT: `move.w $4(a0),d0 / mulu.w \
$6(a0),d0 / mulu.w $8(a0),d0` wants a *2 it has not got, so the AllocMem and the CopyMem are both half the \
record and half of every image never arrives. DEFECT: `move.l d3,d2 / ext.l d2` sign-extends the low word of the \
file size, so a bank over 32,767 bytes reaches Bnk_Reserve negative and AMOS refuses it. DEFECT: a Lock or an \
Open that fails raises $51, \"File format not recognised\", where 82 is \"File not found\". It also leaks the \
1,000 bytes it allocated for the FileInfoBlock, a4 being overwritten with the bank address first. DEVIATION: the \
offset array keeps the file's offsets, where the machine overwrites each with the address of an AllocMem'd copy; \
the copies hang off the extension state instead and the bank's other bytes are the file's",
  "g set img":
    "Routine 105 ($3c54), no guide node -- `G Set Img BOB,X,Y,IMAGE`, and what makes a Bob out of a loaded image. \
`cmp.w d3,d7 / bge` on the bank's count raises $44, AMOS 68 \"Bob not defined\", which is the only argument it \
checks. An empty slot gets the tag list at block +$246 filled and Init'ed with the current Bitmap as its \
container: `$fffb0006` is TAGS_BOB, BBA_GfxCoords the two-entry FrameList at block +$27e which is `dc.w 0,0 / \
dc.w -1,-1`, BBA_Width the record's width <<4, BBA_Height, BBA_Attrib $82 which blitter.h names BBF_GENMASKS, \
and BBA_SrcBitmap the Bitmap G Load Bobs made. Either way the coordinates go straight into Bob->XCoord and \
Bob->YCoord at +$20 and +$22. The Bobs live in a third array at bank+$6+8*count+4 at a stride of eight, in the \
region G Load Bobs zeroed",
  "g draw bob":
    "Routine 116 ($3fe8), no guide node. Four instructions of arithmetic round `DrawBob(Bob a1)`, and the \
register is the one the autodoc gives -- \"void DrawBob(APTR Bob [a1])\". A null slot is tested for and returns. \
The Bob's Attrib is BBF_GENMASKS so colour 0 is transparent, and its FrameList is one frame at the source \
Bitmap's top left, so what is drawn is the whole image",
  "g spaste bob":
    "Routine 115 ($3f9a), no guide node -- `G Spaste Bob X,Y,IMAGE`, the one keyword here that draws an image \
without making a Bob of it. `BlitArea(Source a0, Dest a1, XStart d0, YStart d1, Width d2, Height d3, XDest d4, \
YDest d5, Remap d6)` with the image's Bitmap, the current Bitmap, (0,0) and `moveq #$0,d6` for no remapping -- a \
straight copy, so colour 0 is opaque where G Draw Bob's is not. X and Y do arrive: d4 and d5 are the two \
arguments popped after the image number and are exactly XDest and YDest. DEFECT: `move.l #$10,d2 / move.l \
#$15,d3` are the Width and the Height and nothing reads the image's own, so every image is cropped or padded to \
16 by 21",
  "g erase":
    "Routine 106 ($3d22), no guide node, and the counterpart to G Load Bobs. Bnk_GetAdr, the $305f test -- a \
bank that is not one returns quietly rather than raising message 2 the way the load does -- then three sweeps: \
the Bobs of the third array through dpkernel Free at -$150, then per image the chip copy at record +$a through \
FreeMemBlock at -$cc, the second array's Bitmap through Free, and the record itself through exec FreeMem with \
the length it kept at +$0. Bnk_Eff last. DEFECT: the Bob sweep is a fixed 256 iterations, `moveq #$ff,d7` and a \
dbra with nothing in it about the bank's size, so on a small bank it walks off the end and Frees any non-zero \
longword past it. Its two strides are not the fault they look like -- four for an empty slot and eight for a \
full one, and the four-byte step lands on an eight-byte entry's padding longword, which is always zero -- but an \
empty slot spends two of the 256, so a bank with more than 128 Bobs is not fully freed",
  "g init bobs":
    "Routine 55 ($2278), no guide node. Bnk_Reserve under the name at block +$bc2, \"TGE  Bob\" with two spaces, \
then \"TGE Bob \" with ONE over the top and $101 and $100 as the next two longwords. Nothing reads $100 and only \
G Set Bob reads $101, which cannot get that far. DEFECT: the second argument is ignored -- `mulu.w #$4,d2` and \
the gap between two tag lists build count*4+56 in d2 and `move.l #$2710,d2` overwrites it, so every bank it \
makes is 10,000 bytes",
  "g setup bobs":
    "Routine 56 ($22d2), no guide node, and one rts. Two bytes, no parameters, and the jump table's next entry \
is the byte after it, so this is not a routine that was gutted but one that was never written. It sits between \
G Init Bobs and G Set Bob in both the token table and the code, which is where the third step of a three-step \
setup would have gone",
  "g set bob":
    "Routine 57 ($22d4), no guide node. `move.l d0,$1de(a3)` before anything else, then Bnk_GetAdr and, for a \
bank that is not reserved, `moveq #$24,d0` into G Exit -- AMOS 36, \"Bank not reserved\". Then two magic tests \
that cannot both pass: the four bytes at Start(n)-4 must spell \" Bob\" and the word at Start(n)+2 must be \
$0101. If Bnk_Reserve answers the name field and Bnk_GetAdr the data eight bytes past it, the version matches \
and the name does not, G Init Bobs having just overwritten it with \"TGE Bob \"; if both answer the same \
address, the name matches -- the reserve name's last four bytes really are \" Bob\" -- and the version reads \
\"E \". There is no third reading, so the routine always falls out at $239a. The dead code below says what it \
would have done: AllocMem(1024) for 256 Bob slots, into block +$352 indexed by bank number and into the bank's \
+$8. DEFECT: +$1de is where G Load Bobs keeps a POINTER, so a bank number written over it leaves G Draw Bob and \
its neighbours dereferencing a small integer -- which is why this port drops the loaded bank here",
  "g bob":
    "Routine 58 ($23a0), no guide node, and it does not return. DEFECT: the slot table G Set Bob would have \
allocated is fetched with `movea.l (a4),a4` and then indexed through d0 -- bank number times four, an address in \
the vector table. The guard is worse: `tst.l a4 / bne` falls through a `movem.l (a7)+,d0-d7/a3-a6` that is the \
branch-NOT-taken arm, so an absent table pops twelve registers, runs on into the arm that pops them again, and \
returns through whatever is forty-eight bytes up the stack. What survives of the intent: A is a slot, B and C go \
to the Bob tag list's +$3c and +$44 -- past its terminator and inside the list after it -- and D is popped and \
never read. Nothing is reproduced, a routine that returns through a corrupted stack having no behaviour to port",
  "g init mbobs":
    "Routine 82 ($2c6e), no guide node, and it cannot get past its own second test: $2c8a and $2c94 are both \
`cmpi.l #imm,(a0)`, opcode 0c90, asking the same four bytes to spell \"TGE \" and \"MBOB\". The second wants \
0ca8, `cmpi.l #imm,$4(a0)`. So what runs is Bnk_GetAdr, the address recorded at block +$1d8, and the bail; a \
bank that is not reserved does not even record. The dead code is a whole MBob system and the only place in the \
extension that knows what one is: a header of \"TGE MBOB\", $14 and a version at +$8 and +$c, a count at +$10, \
an AllocMem(256) entry table into +$14, then per MBob a 64-byte record from +$18 with an AllocMem(64) list \
terminated by $ffffffff at +$1c and the current screen's Bitmap at +$34",
  "g set mbob":
    "Routine 83 ($2d44), no guide node. DEFECT: `movea.l $1de(a3),a0` reads the BOB bank where G Init Mbobs \
records the MBob bank six bytes along at +$1d8, and then `movea.l $14(a0),a0` for the entry table, which on a \
$305f bank is the fifth longword of the image-offset array. So even with the impossible test at $2c94 fixed this \
reads a bank it was never handed; with it unfixed the table is never allocated at all. What survives of the \
intent: D indexes a four-byte entry, A the record it appends to, and B and C are doubled into the entry's first \
two longwords -- an MBEntry is WORD XCoord, WORD YCoord, WORD Frame, so the entries it writes are twice as wide \
as one. Nothing is reproduced",
  "g paste bob":
    "Routine 96 ($3498), no guide node, and a hand-written blit with three faults. DEFECT: the destination is \
`movea.l $1de(a3),a4 / adda.l #$6,a4`, the bob bank's own pointer array, where every other keyword in the batch \
has the Bitmap from +$1c2. DEFECT: the row stride is `move.l $12.l,d4`, an absolute read of address $12 -- half \
of one exception vector and half of the next. DEFECT: the row loop is re-entered by `dbra d1` without reloading \
d0, which is $ffff by then, so the second row copies 65,536 words. The two coordinate arguments are never read. \
Nothing is reproduced",
  "g get img":
    "Routine 97 ($3504), no guide node, and disabled by its author: $3514 is `bra.w $35b8`, straight to the \
register restore, and all 160 bytes between them are unreachable. They read as a first attempt at grabbing an \
image off a screen -- Bnk_GetAdr, a slot in the first array, FreeMem through a pointer it has just tested for \
NULL, AllocMem of (X2-X1)*(Y2-Y1)*4 bytes, and a ReadPixel loop whose two cmp.w's at $35b2 and $35b6 have no \
branch after them, so it would have copied one pixel. The bra is the fix. The keyword evaluates its six \
arguments and returns",
  "g tmap":
    "Routine 95 ($32bc), no guide node, eight arguments, and a perspective floor-mapper: it walks a rectangle of \
the destination screen, projects each pixel through a rotation and a divide, and copies what `ReadPixel(Bitmap \
a0, XCoord d1, YCoord d2)` finds at the projected point with `DrawPixel(Bitmap a0, XCoord d1, YCoord d2, Colour \
d3)`, skipping colour 0 and $ffff and any projection outside -100..99. The arguments arrive in the order AMOS \
pops them, which is the reverse of the order they are written: YEND, YSTART, XEND, XSTART, ANGLE, SCALE, DEST, \
SRC. ANGLE indexes the tables G Set Table built, with `asl.w #$1,d7` and no bounds test, and SCALE divides the \
whole projection, so zero traps. Reproduced instruction for instruction because almost none of it is 32-bit \
arithmetic -- move.w into a register whose high half is left holding the last thing there, sub.w next to sub.l \
on the same register, and a divs.w whose remainder becomes the high half the next iteration's sub.l uses. \
DEFECT: it scales by two screen POINTERS, reading $10(a0) and $14(a0) off the GScreen where screens.h has \
MemPtr2 and MemPtr3; Width and Height are at $20 and $22, sixteen bytes on. TGE's screens are single-buffered -- \
its own G Double Buffer indexes the wrong register -- so both are zero and every pixel it draws is the source's \
(0,0) whatever the projection said. DEFECT: `muls.w $2e(a4),d2` then `muls.w $32(a4),d2`, where the second wants \
d3, so X is scaled twice and Y not at all. NOTE: its token entry declares a function and no instruction, func \
$5f against instr $ffff, and the routine sets neither d3 nor d2 before its rts; its spec begins I, so it parses \
as the instruction it is -- the mirror image of G Blur's entry",
  "ovsavejpeg24":
    "Routine 73 ($10a0). The library's JPEG code is the Independent JPEG Group's, v4-era, compiled with SAS/C " +
    "into the fourth hunk, and everything it chooses is read off that binary rather than guessed: the Annex K " +
    "quantization tables it carries as zigzag words at $d41a and $d49a, the four Annex K Huffman tables at " +
    "$d27b, jpeg_set_quality's 5000/q and 200-2q at hunk 3 $2668, jpeg_add_quant_table's (base*scale+50)/100 " +
    "clamped to 1..255 at hunk 3 $25da, 4:2:0 sampling from the component array at hunk 3 $2740, and the marker " +
    "order at hunk 3 $1d16. Two of its habits are reproduced: the scan header emits a DHT per component rather " +
    "than per table, so tables 1 and 1 go out three times between them, and the APP0 \"thumbnail\" is the OVTN " +
    "chunk -- tag then planes -- declared to JFIF as 48 x 30 RGB that it is not. APPROXIMATED in one place: the " +
    "forward DCT is this port's own float transform and not IJG's integer one, so the file is a conformant " +
    "baseline JPEG that differs from an Amiga's in the low bits of some coefficients",
  "ovloadiff24":
    "Routine 25 ($b9c). See Ovloadimage24: the same routine under the older name",
  "ovdownloadframe24":
    "Routine 72 ($1082). The AutoDocs have no entry for it at all; the signature comes from " +
    "`devdocs/Basic/opal_lib.fd` -- `DownLoadFrame24(Scrn,x,y,w,h)(A0,D0,D1,D2,D3)` -- and the behaviour from " +
    "hunk $53ca, which takes the display down to SetLores24(0,290) and pulls the rectangle back over CIA-B's " +
    "parallel port under Forbid. It is the only thing in the library that READS the frame buffer, which is why " +
    "the twelve segments have contents here at all",
  "ovdrawline24":
    "Routine 39 ($d38). APPROXIMATED: the AutoDoc fixes the arguments and the clipping -- \"clipped ... per " +
    "pixel\" -- but not which pixels a diagonal lands on, and the library's own line routine has not been read, " +
    "so this is Bresenham and may differ by a pixel on a slope",
  "ovdrawellipse24":
    "Routine 68 ($101e). APPROXIMATED for the same reason as Ovdrawline24: \"a = horizontal radius of ellipse " +
    "(must be >0)\" and \"set a=b for circles\" fix the arguments, and the midpoint ellipse here is not the " +
    "library's algorithm",
  "ovscroll24":
    "Routine 24 ($b84). APPROXIMATED: the routine at hunk $01d8e has not been read, so what is here follows the " +
    "AutoDoc's description of the move and not its edge behaviour",
  "ovpalettemap24":
    "Routine 22 ($b5a). APPROXIMATED: the AutoDoc says what palette mapping is for, not what the routine does to " +
    "a screen that is already mapped",
  "ovappendcopper24":
    "Routine 18 ($af8). APPROXIMATED: the CoPro instruction list is modelled and the append is not read from the " +
    "library",
  "ovsetsprite24":
    "Routine 13 ($a90). APPROXIMATED: the sprite pointer is stored and nothing displays it, because the Amiga " +
    "half of an OpalVision display is not composited here",
  "ovsetloadaddress24":
    "Routine 31 ($c7c). APPROXIMATED: the palette load address register is kept and no update reads it back",
  "ovfadein24":
    "Routine 34 ($cc4). APPROXIMATED: the fade is a timed ramp on the machine and instant here, and the endpoint " +
    "is what is modelled. It does nothing to a 15-bit screen, which is the Depth test the routine opens with",
  "ovfadeout24":
    "Routine 35 ($cda). See Ovfadein24, ending on black",
  "ovfreezeframe24":
    "Routine 63 ($f76). APPROXIMATED: freezing the frame needs the Scan Rate Converter module, which is an " +
    "expansion this port has no reason to model, so the control-line bit is kept and nothing follows from it",
  "ovregwait24":
    "Routine 55 ($ebc). APPROXIMATED: \"waits for register information to be updated to the OpalVision before " +
    "returning, or returns immediately if no updates are pending\", and with no raster to wait for there is never " +
    "anything pending",
  "ovupdatedelay24":
    "Routine 9 ($a3c). APPROXIMATED: the delay counts frames and there are no frames here. The keyword's other " +
    "half is real -- it \"initiates continuous updates ... which will continue until either Refresh24() or " +
    "StopUpdate24() is called\" -- and while that is on, a download refreshes first",
}

/**
 * Keywords whose reading lives under another keyword's name.
 *
 * The value names the keyword holding the shared reading. coverage.test.ts
 * validates both names and requires the target to have a note.
 */
export const SHARED_NOTES: Record<string, string> = {
  // Delta 1.4/1.6 — one shape, one reading: routines 19 to 27 (and 17/18 for the two FFP constants)
  'delta e#': 'delta pi#',
  'delta feet$': 'delta yard$',
  'delta inch$': 'delta yard$',
  'delta english mile$': 'delta yard$',
  'delta american mile$': 'delta yard$',
  'delta euler$': 'delta yard$',
  'delta degree$': 'delta radian$',
  'psync every pbob': 'psync every',
  'psync every psprite': 'psync every',
  'pchannel to psprite': 'pchannel to pbob',
  'psync psprite': 'psync pbob',
  'psprite erase': 'convert sprites',
  'pbobsprite fastcol': 'pbob fastcol',
  'psprite fastcol': 'pbob fastcol',
  'pspritebob fastcol': 'pbob fastcol',
  'pfast bobsprcol': 'pfast bobcol',
  'pfast sprcol': 'pfast bobcol',
  'pfast sprbobcol': 'pfast bobcol',
  'y psprite': 'x psprite',
  'yscr mouse': 'xscr mouse',
  'xscr sprite': 'xscr mouse',
  'yscr sprite': 'xscr mouse',
  // the arithmetic block is one reading over twenty routines
  'pdec': 'pinc',
  'padd': 'pinc',
  'psum': 'pinc',
  'plsl': 'pinc',
  'plsr': 'pinc',
  'pasl': 'pinc',
  'pasr': 'pinc',
  'set psum range': 'pinc',
  'set pinc range': 'pinc',
  'set pdec range': 'pinc',
  'unset psum range': 'pinc',
  'unset pinc range': 'pinc',
  'unset pdec range': 'pinc',
  'unset padd range': 'pinc',
  'pmul shift': 'pmul',
  'pdiv': 'pmul',
  // routines 13, 14 and 5 are the same accessor three times, over three fields
  'y pbob': 'x pbob',
  'i pbob': 'x pbob',
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
  // TURBO routines 87, 88 and 89 are the same sixty bytes, differing only in
  // which word of the image header the last instruction reads
  'y icon': 'x icon',
  'planes icon': 'x icon',
  'td surface points off': 'td surface points',
  'jd star joker off': 'jd star joker on',
  // EasyLife routines 7/9/11/13 are the same twelve bytes, differing only in
  // the displacement of the word they read out of the eight-byte record
  'elznsy': 'elznsx',
  'elznex': 'elznsx',
  'elzney': 'elznsx',
  // and 154-157 differ only in which field of the companion struct they load
  'el lapsy': 'el lapsx',
  'el lapex': 'el lapsx',
  'el lapey': 'el lapsx',
  // EasyLife 1.0 spells the same six routines without the `el` prefix; the
  // reading is the later build's, which is where the citations are numbered
  'znsx': 'elznsx',
  'znsy': 'elznsx',
  'znex': 'elznsx',
  'zney': 'elznsx',
  'zn shift': 'elzn shift',
  'zb add': 'elzb add',
  'reserve multi zone': 'elmz reserve',
  'set multi zone': 'elmz  set',
  'clear multi group': 'elmz erase',
  'mznsx': 'elmznsx',
  'mznsy': 'elmznsx',
  'mznex': 'elmznsx',
  'mzney': 'elmzney',
  'mzone': 'elmzone',
  'mzonen': 'elmzonen',
  'mzoneg': 'elmzoneg',
  // ...and the three siblings that share the reader's reading
  'elmznsy': 'elmznsx',
  'elmznex': 'elmznsx',
  // the search block: one reading per shape, and the `not` and `char`
  // variants are the same worker with one branch inverted
  'elf not asc': 'elf asc',
  'elf not char': 'elf char',
  'elf last char': 'elf last asc',
  'elf last not asc': 'elf last asc',
  'elf last not char': 'elf last asc',
  'elf nth char': 'elf nth asc',
  'elf fail end': 'elf fail start',
  // 1.0 spells the whole search block `find` rather than `elf`
  'find asc': 'elf asc',
  'find char': 'elf char',
  'find not asc': 'elf asc',
  'find not char': 'elf char',
  'find last asc': 'elf last asc',
  'find last char': 'elf last asc',
  'find last not asc': 'elf last asc',
  'find last not char': 'elf last asc',
  'find control': 'elf control',
  'find nth asc': 'elf nth asc',
  'find nth char': 'elf nth asc',
  'find num asc': 'elf num asc',
  'find num char': 'elf num char',
  // the integer/string pair and the two sign extensions are one reading each
  'ellong': 'ellong$',
  'elword': 'ellong$',
  'elword$': 'ellong$',
  'elextw': 'elextb',
  'elmem inc': 'elmem',
  'elmessage exists': 'elmessage$',
  // and 1.0's spellings of the same routines
  'long$': 'ellong$',
  'long': 'ellong$',
  'word$': 'ellong$',
  'word': 'ellong$',
  'extb': 'elextb',
  'extw': 'elextb',
  'mem$': 'elmem$',
  'mem': 'elmem',
  'mem inc': 'elmem',
  'set bank name': 'els bank name',
  'message$': 'elmessage$',
  // the bitwise block: one reading for the test pair, one for the three
  // correct modifiers, and one each for the two that are not
  'elltst': 'elwtst',
  'elwclr': 'elwset',
  'elwchg': 'elwset',
  'ellset': 'elwset',
  'wtst': 'elwtst',
  'ltst': 'elwtst',
  'wset': 'elwset',
  'lset': 'elwset',
  'wclr': 'elwset',
  'wchg': 'elwset',
  'lclr': 'ellclr',
  'lchg': 'ellchg',
  // PowerPacker: the readers are one reading, and so is the keep pair
  'elpp len': 'elpp buf',
  'elpp keep off': 'elpp keep on',
  'pp load': 'elpp load',
  'pp buf': 'elpp buf',
  'pp len': 'elpp buf',
  'pp free': 'elpp free',
  'pp crunch': 'elpp crunch',
  'pp keep on': 'elpp keep on',
  'pp keep off': 'elpp keep on',
  // system and fonts: the stdin/stdout pairs and the font trio are one
  // reading each, and 1.0's six names are the same routines
  'elout exists': 'elout',
  'elin exists': 'elin$',
  'elin get$': 'elin$',
  'elclose font': 'elset font',
  'elclose fonts': 'elset font',
  'easy base': 'el base',
  'protect': 'elprotect',
  'output exists': 'elout',
  'output': 'elout',
  'elwb close': 'elwb open',
  'elwb test': 'elwb open',
  'i open workbench': 'elwb open',
  'i close workbench': 'elwb open',
  'i test workbench': 'elwb open',
}

/** The reading for a keyword, following SHARED_NOTES to whoever holds it. */
export function noteFor(name: string): string | undefined {
  return NOTES[name] ?? NOTES[SHARED_NOTES[name] ?? '']
}
