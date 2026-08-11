/**
 * The Game Extension 0.9 beta — Peter Cahill, 103 keywords at slot 14.
 *
 * *"Finally a AMOSPro Extension which adds AGA and RTG !! along with heaps of
 * new and MUCH FASTER functions"*. It is a shim over other people's libraries
 * rather than an engine of its own: the binary opens `req`, `reqtools`,
 * `lowlevel`, `ptreplay`, `stc`, `amos`, `graphics`, `dos`, `icon` and
 * `workbench`, plus GMS's `dpkernel.library`, which the guide confirms — *"TGE
 * uses GMS, and so you must pay all according gms lisences, and your program
 * will require gms(if you use TGE gfx)"*.
 *
 * ## Evidence
 *
 * DISASSEMBLY tier, and the guide is not usable as a second source. It lags
 * the shipped table badly: six of its nodes name keywords the table does not
 * have (`G Getbob` and `A=G Pixel` are earlier names for `g get img` and `g
 * point`, `G Encyrpt`/`G Decyrpt` misspell what the table spells right, `G Set
 * Raster` says *"NOT done yet."*, and `A=G Open Req` says *"Removed"*), and
 * where it does describe behaviour it is wrong often enough that nothing here
 * is implemented from it. It is read for what the author MEANT and the routine
 * is read for what happens; see `src/ext/manifests/the-game-0.9.json`.
 *
 * ## The data block
 *
 * Every routine opens `movea.l $1c8(a5),a3` — the extension's block, which
 * lives inside its own code hunk at $a34 and begins with the four bytes `TGE`.
 * The offsets this file needs:
 *
 *     +$0c  req.library base        NEVER WRITTEN, see below
 *     +$10  "req.library"           never referenced
 *     +$1c  reqtools.library base
 *     +$20  "reqtools.library"
 *     +$47  "ptreplay.library"
 *     +$58  ptreplay.library base
 *     +$d0  the module ptreplay handed back
 *
 * ## ptreplay.library
 *
 * Version 6.6 (1996-03-20), vendored at `fixtures/libs/ptreplay.library`
 * because the twelve tracker keywords are nothing but calls into it and none
 * of them can be read without it. The offsets in a module handle, all read off
 * that binary:
 *
 *     -$0c  the song position, a BYTE
 *     +$00  a pointer to the module data
 *     +$08  non-zero while playing
 *     +$0c  paused, a word
 *     +$0e  the volume, a word
 *     +$10  the fade countdown, a byte
 *     +$11  the fade rate, a byte
 *     +$12  which channels are enabled, bits 0..3 for AUD0..AUD3
 *
 * and the entry points TGE reaches, named for what they do rather than for
 * what any header calls them:
 *
 *     -$1e  LoadModule    a0 = filename            -> d0 = handle
 *     -$24  UnLoadModule  a0 = handle
 *     -$2a  PlayModule    a0 = handle
 *     -$30  StopModule    a0 = handle
 *     -$36  Pause         a0 = handle
 *     -$3c  Unpause       a0 = handle
 *     -$48  SetVolume     a0 = handle, d0 = volume word
 *     -$4e  GetPos        a0 = handle              -> d0 = the byte at -$0c
 *     -$54  GetLength     a0 = handle              -> d0 = module byte $3b6
 *     -$7e  Fade          a0 = handle, d0 = rate
 *     -$84  ChannelOn     a0 = handle, d0 = mask
 *     -$8a  ChannelOff    a0 = handle, d0 = mask
 *     -$90  SetPos        a0 = handle, d0 = position
 *
 * Three of those settle a guide claim against it.
 *
 * **PlayModule sets the volume to 57.** `move.w #$39,$e(a5)` at ptreplay $3a6,
 * every time, so a `G Ptvolume` before a `G Ptplay` is thrown away and full
 * volume is not what a module starts at.
 *
 * **Fade takes a rate, not seconds.** The guide says *"Fades the protracker
 * module's volume to 0 over the specified ... Time -> Amount of time in
 * seconds."* ptreplay $6c2 stores the argument in BOTH fade bytes and
 * the interrupt at $9b8 counts one down, reloads it from the other, and drops
 * the volume word by one — so the argument is interrupt ticks per volume step.
 * It is easy to see how the guide got there: from ptreplay's own starting
 * volume of 57 at the default tempo, a rate of 1 does take about a second.
 * And a rate of ZERO is not a fast fade — $6cc jumps straight to StopModule.
 *
 * **Channel bit 0 is the first channel.** The guide says *"G Ptchan %0101 for
 * chan 2 and 4 to be turned on"*, which is the binary literal read left to
 * right. ptreplay $6ea tests bit 0 and writes `$dff0a0`, which is AUD0.
 *
 * ## What batch 2's fifteen keywords reach
 *
 * Five go straight at the hardware or at AmigaOS and owe GMS nothing:
 * `G Reboot` is `ColdReboot` with no version check, `=G Left Click` and
 * `G Wait Lmb` are `btst.b #$6,$bfe001` on CIA-A's PRA, `G Wait Rmb` is bit 10
 * of POTINP at `$dff016`, and `=G Check Vbl` is one compare against `$dff006`.
 * Four more are library calls this port already models: `=G Cd32` opens
 * `lowlevel.library` and calls `ReadJoyPort`, `=G Cli` is `dos.library`'s
 * `Execute`, `=G File Size` is `Lock`/`Examine`/`UnLock` for `fib_Size`, and
 * `G Iconify`/`=G Icon Check` are `workbench.library`'s AppIcon pair.
 *
 * The last four are GMS after all, whatever the batch assumed: `=G Right
 * Click`, `=G X Mouse`, `=G Y Mouse` and `G Set Mouse` all go through the
 * input structure at block +$b2e, and the guide says so for two of them —
 * *"*GMS REQUIRED*"*. They are ported against this port's own mouse instead,
 * which is the same state by a shorter route; nothing about the values a
 * program sees depends on the structure they came out of.
 *
 * ## The trigonometry tables
 *
 * `G Set Table` (routine 94, $31bc) builds them and `=Gsin`/`=Gcos` (85, 86)
 * read them; nothing else in the extension does, and the guide has no node for
 * the builder at all, so a program that calls either function without calling
 * it first is reading through a null pointer.
 *
 * The layout, from the routine: `AllocMem(10n, MEMF_CLEAR)`, the sin pointer
 * to the start at block +$bce and the cos pointer 2n bytes in at +$bd2, the
 * byte size kept at +$bd6 so the next call can free it. So the table is 5n
 * words long, entry `i` is the sine of `i` steps of a quarter-circle split n
 * ways, and cos is the same table read n entries later — the standard trick,
 * and it needs 5n rather than 4n+1 entries so that `Gcos(359)` still lands
 * inside it.
 *
 * The values come from the worker at $323c: a cosine Taylor series to
 * x^12/12! in 16.16 fixed point, then `lsr.l #$1` and the low word, which
 * makes the stored word cos(x)*32768. `cos(0)` would be exactly $8000 and
 * therefore negative, and the `tst.w d1 / dbpl d1` pair at $329e is what deals
 * with it: DBcc decrements the low word when the condition is false, so a
 * negative word is quietly turned into $7fff. Six values are written per pass
 * — the eighth-circle symmetries — and entries 0 and 2n are never written at
 * all, which is correct only because MEMF_CLEAR already left them zero and
 * sin(0) and sin(pi) are zero.
 *
 * ## The encryption scheme
 *
 * `G Encrypt` and `G Decrypt` are a StoneCracker crunch with four words
 * shuffled by a password, and `G Init Encyrpt` is a bank reserve that nothing
 * needs. The compression is `stc.library`, StoneCracker 3.322, found in three
 * partitions of the corpus machine and vendored at
 * `fixtures/libs/stc.library` — and the format is reproduced in
 * `../amiga/stonecracker.ts`, which also answers for `G Stc Pack` and `G Stc
 * Unpack`. The entry points, their arguments and the file layout are all
 * documented there.
 *
 * The password is worth its own sentence, because "encryption" is a strong
 * word for it. The key is one byte: the routine sums the password's bytes
 * with `add.b`, which cannot carry, doubles the result, and stores it as a
 * longword whose top two bytes are therefore always zero. Those four bytes
 * are the four swap indices. So two of the four swaps are always the same
 * swap, the third has two possible values, and the whole password space is
 * 256 wide — and the sum leaves out the last character, so `"secret"` and
 * `"secreX"` unlock the same bank.
 *
 * ## GMS
 *
 * Every keyword still missing is a GMS one. GMS is the Games Master System,
 * Paul Manias / DreamWorld Productions, and `dpkernel.library` is its core.
 *
 * It is VENDORED, at `fixtures/gms/`: Aminet `dev/misc/gms_user.lha`, the
 * V2.1 user package of October 1998, which carries `dpkernel.library` V2.1
 * (July 1998) — the version 2 that `G Init Gms` demands — the fifteen system
 * modules, and a `System/References/` registry. Seven of the modules also
 * have their C source published separately on Aminet as `dev/misc/gms_*.lha`,
 * and those are vendored under `fixtures/gms/src/`.
 *
 * And the DEVELOPER SUITE, `dev/misc/gms_dev.lha`, at `fixtures/gms/dev/`.
 * That is the one that matters, because it covers the two modules with no
 * published source — `screens.mod` and `blitter.mod` — which are the two this
 * extension leans on hardest. It carries:
 *
 *     Includes/graphics/screens.h    struct GScreen, field by field
 *     Includes/graphics/blitter.h    struct Bitmap, and the tag names
 *     Includes/dpkernel/dpkernel.h   struct Head, the tag type bits
 *     Includes/dpkernel/prefs.h      struct ScreenPrefs
 *     Includes/system/register.i     the ClassID numbers
 *     Includes/fd/*.fd               every entry point, its arguments AND
 *                                    the register each one arrives in
 *     AutoDocs/*.guide               what each of them does, in prose
 *
 * So the GMS half of this file is no longer a reading of TGE's call sites. A
 * `.fd` states the signature and an autodoc states the behaviour, and the
 * fifteen `screens.mod` entries the port reaches are named by the module
 * itself — `../amiga/gms.ts` records those tables and re-derives them from
 * the binaries. Where the two could disagree they do not: `screens_lib.fd`
 * lists the same 27 names in the same order that the module's own function
 * list carries, marking three of them private with a `prv` prefix.
 *
 * None of DreamWorld's source or headers are copied — the material is read
 * for semantics and offsets only, as ../amiga/stonecracker.ts treats the
 * StoneCracker format and ../amiga/intuition.ts treats AROS.
 *
 * ## Which GMS source wins
 *
 * There are four accounts of what an entry point takes, and they disagree,
 * so the order matters. In increasing authority:
 *
 * 1. The name string in the module's own jump table — types only, and it can
 *    be a revision behind. `DrawLine(a0l,d0w,d1w,d2w,d3w,d4l)` names five
 *    data registers where the routine at blitter.mod $3250 plainly reads six,
 *    `moveal %d5,%a2 / moveal %d6,%a3` being its colour and its mask.
 * 2. The `.fd`, which adds argument NAMES and the actual registers. Right
 *    about registers everywhere it has been checked; wrong about a name at
 *    least once, calling BlurArea's third and fourth EndX and EndY.
 * 3. The autodoc, which is the fullest and describes behaviour — but of a
 *    later revision than the shipped modules in places. It gives PenCircle a
 *    `Fill [d4]` the shipped blitter.mod does not have: $504a is
 *    `moveq #$0,d4` and d4 is that routine's own loop counter.
 * 4. The module's code, and the published C where there is any. `colours.c`
 *    settles BlurArea as `(Bitmap, XStart, YStart, Width, Height, Setting)`,
 *    which is what makes TGE's `sub.w` correct rather than an off-by-corner.
 *
 * TGE itself is a fifth source and a good one, being a program that was made
 * to work against the shipped modules: its `move.l #$ffffffff,d6` before
 * DrawLine is independent confirmation of the mask argument the module's own
 * name string leaves out.
 *
 * ## The two structures, and the tag list that builds one
 *
 * `struct Head` is twelve bytes on the front of every GMS object — `WORD ID,
 * WORD Version, SysObject *Class, Stats *Stats` — which is why every field
 * offset below starts at 12.
 *
 *     struct GScreen                     struct Bitmap
 *     +$0c MemPtr1  the displayed buffer  +$0c Data       the pixels
 *     +$10 MemPtr2  double buffer         +$10 Width
 *     +$14 MemPtr3  triple buffer         +$12 ByteWidth
 *     +$1c Raster   a Raster object       +$14 Height
 *     +$20 Width    the viewport          +$16 Type       ILBM/planar/chunky
 *     +$22 Height                         +$18 LineMod
 *     +$24 XOffset  where it sits on the  +$1c PlaneMod
 *     +$26 YOffset  monitor               +$20 Parent
 *     +$28 BmpXOffset  which part of the  +$30 Planes
 *     +$2a BmpYOffset  bitmap shows       +$34 AmtColours
 *     +$2c ScrMode  SM_HIRES and friends  +$38 Palette    $00RRGGBB longs
 *     +$30 Attrib   SCR_DBLBUFFER etc     +$3c Flags      BMF_HAM, BMF_EXTRAHB
 *     +$38 Bitmap
 *     +$3c Switch
 *
 * An object is not built by filling that in. `Init(Object a0, Container a1)`
 * takes *"an Object, TagList, ListV1, ListV2 or an ObjectList"*, and what TGE
 * hands it is a TagList: 200 bytes copied out of the data block at +$1f6 and
 * patched. A tag is two longwords, `{ type|offset, value }`, and the header
 * pair names the class — `$fffb0009` is `(ID_SPCTAGS<<16)|ID_SCREEN`, since
 * `register.i` gives ID_SPCTAGS as -5 and ID_SCREEN as 9. The type bits are
 * `dpkernel.h`'s: TLONG `1<<31`, TWORD `1<<30`, TAPTR `TLONG|1<<29`, TSTEPIN
 * `1<<28`. The template, as shipped:
 *
 *     +$00  $fffb0009           TAGS_SCREEN — and Init writes the finished
 *                               object back into THIS pair's value slot,
 *                               which is why +$04 is where TGE reads it from
 *     +$08  $80000030  $100     Attrib   = SCR_BLKBDR
 *     +$10  $40000022  256      Height
 *     +$18  $40000020  320      Width
 *     +$20  $4000002c  1        ScrMode  = SM_HIRES
 *     +$28  $10000038  0        TSTEPIN on Screen+$38 — everything after this
 *                               tag addresses the BITMAP
 *     +$30  $80000034  2        AmtColours
 *     +$38  $a0000038  0        Palette
 *     +$40  0                   end of list
 *
 * The block holds eight of those tag lists, one per screen, in a table at
 * +$19a; +$195 is the current screen NUMBER; +$1be and +$1c2 are the current
 * Screen and its Bitmap, which is where `=GScreen Width` and every drawing
 * keyword start. Two more lists follow the first in the template, headed
 * `$fffb0006` and `$fffb0007` — ID_BOB and the class after it — and belong to
 * the bob batch rather than here.
 *
 * A tag whose value is left at zero takes the user's default. The Screen
 * autodoc marks Width, Height and ScrMode *"Inheritance: User default."* and
 * says of the last one *"If you do not fill in this field, you will get the
 * user's default resolution."* — and it is `GMSPrefs` that holds those, in
 * `Prefs/Default/screens.prefs`: the file is the
 * `struct ScreenPrefs` of `prefs.h` XORed with $3d, and it decodes to
 * ScrWidth 320, ScrHeight 256, Planes 5, ScrMode SM_LORES, ChipSet AGA and a
 * top-of-screen corner of (128, 44). That last pair is what a GMS screen
 * offset of (0,0) means — the autodoc says *"An offset of (0X,0Y) positions
 * the Screen at the top left of the display"* — and AMOS's own hardware
 * origin is (128, 50), near enough that the two coordinate systems are the
 * same one with a different zero.
 *
 * ## How TGE starts GMS
 *
 * `G Init Gms` (routine 90, $2f36) opens
 * `OpenLibrary("GMS:libs/dpkernel.library", 2)` — the name at block +$112 —
 * into block +$12c, and sets the word at +$d4 to 1 to remember that it was
 * this that opened it. There is a second way in at $2fe2 for a TGE running
 * inside a GMS program already: `cmpi.w #$12,(a0)` on a structure the caller
 * left in a0, and the base is taken from its +$60 instead, leaving +$d4 zero.
 * A failure is `moveq #$4,d0` into routine 151, message 4.
 *
 * Then dpkernel's `-$54` five times. `dpkernel_lib.fd` is `##bias 30`, so an
 * LVO names an entry outright and no inference is needed for any of them:
 * `-$54` is `OpenModule(ID d0, Name a0)`, `-$5a` is `Init(Object, Container)`,
 * `-$114` `Show(Object)`, `-$126` `Hide(Object)`, `-$14a` `Get(ID)`, `-$150`
 * `Free(Object)`, `-$168` `CopyStructure(Source, Destination)`, `-$19e`
 * `Copy(Source, Dest)` and `-$30` `CloseDPK()`. TGE keeps both the handle
 * OpenModule returns and, from the handle's +$e, that module's function base:
 *
 *     d0 = 3            handle +$fe    base +$ea    screens.mod
 *     d0 = 1            handle +$fa    base +$e6    blitter.mod
 *     d0 = 2            handle +$f6    base +$e2    sound.mod, never called
 *     d0 = $11          handle +$102   base +$ee    colours.mod
 *     d0 = 0, "pcx.mod" handle +$106   base +$f2    by name, not by number
 *
 * The numbering is dpkernel's own: twenty module names sit in its data hunk
 * in one run, and a module's number is its 1-based position in it — blitter,
 * sound, screens, vectors, cactus, anim, cards, text, objects, network, test,
 * joyports, files, keyboard, pictures, music, colours, collision, strings,
 * config. Ten of those are confirmed independently by the `.ref` files in
 * `System/References/`, each of which states its own `ModNumber`, and all ten
 * agree. So `$11` is colours.mod, and `=G Blur`'s call to its `-$6` is
 * `BlurArea(Bitmap a0, XStart d0, YStart d1, Width d2, Height d3, Setting
 * d4)`, which is why routine 112 subtracts the corners into d2 and d3.
 *
 * `-$150` and `-$5a` are object methods rather than plain functions: both
 * fetch a class table and jump through it, `$54(a0)` for `Free` and `$74(a0)`
 * for `Init`. `G Close Gms` (routine 119) calls `Free` on all five modules
 * and on the input structure at +$b2e before `CloseDPK`. `Get(1)` is what
 * answers that input structure, and 1 is `JoyData`'s ClassID in
 * `joydata.ref` — the second source for what batch 2 read off the call sites
 * alone.
 *
 * Two defects to carry into those batches. `G Close Gms` calls `-$30` — the
 * shutdown — without testing +$d4, which routine 90's own teardown at $30d6
 * does test, so a TGE that inherited GMS from its host shuts the host's GMS
 * down. And `G Load Pcx` (routine 117) is `lea $f2(a3),a6 / jsr -$6(a6)`:
 * `lea`, not `movea.l`, so it does not call the PCX module at all — it
 * computes `block + $f2 - 6` and JUMPS THERE, into the middle of its own base
 * table. Routine 112 does the same call correctly with `movea.l $ee(a3),a6`,
 * which is what makes it a typo rather than a convention.
 *
 * ## Where a GMS screen lives here
 *
 * On a slot of its own, in the same table as every other screen. The machine
 * has ONE copper list, so a display anything opens is a band in it, and
 * `Runtime.SCREEN_SLOTS` partitions the table by owner: 0-7 the user's, 8-11
 * AMOS's own system screens, 12-19 a game system's, 20-31 the OS's. TGE
 * numbers its screens 0-7 and has exactly eight, so screen N is slot
 * `Runtime.screenRange('game').from + N` and the arithmetic is the whole of
 * the mapping.
 *
 * Nothing else is needed, because the two models agree about almost
 * everything a keyword can see. GMS's `Screen->Width/Height` is the port's
 * `Screen.width/height`; its `XOffset/YOffset` — where the display sits on
 * the monitor — is `displayX/displayY`; its `BmpXOffset/BmpYOffset` — which
 * part of a bitmap larger than the viewport shows — is `offsetX/offsetY`,
 * which is what AMOS's own `Screen Offset` sets. TGE's two keywords are named
 * the other way round from AMOS's, and that is the only confusion in it.
 *
 * `Show()` and `Hide()` are `visible`, and the AMOS_WB call every screen open
 * opens with is `Runtime.amosToBack()`: one call moves the whole AMOS display
 * behind the game's, which is the guide's *"Opens a screen in front of the
 * amigas current display"*.
 *
 * What AMOS_WB's argument means is settled by the extension's own two calls.
 * `G Screen Open` passes `moveq #$0,d1` and then opens a screen in front;
 * `G Reset` passes `moveq #$1,d1` with every game screen just closed. So 0 is
 * to-back and 1 is to-front, and -1 is the query `=Amos Here` makes — three
 * values and three arms. AMOS's own source is not on this machine and is not
 * needed for it.
 *
 * ## The extension's own error table
 *
 * Routine 151 ($41a6) is the error reporter, and it ends `Rjmp L_ErrorExt` on
 * a table of NUL-terminated strings at $4214 with d0 as the index. Written
 * down here once because half a dozen batches reach it:
 *
 *     0  "(TGE) You don't have the required library in LIBS:"
 *     1  "(TGE) You NEED to do a: G Init Gms before using this command!"
 *     2  "(TGE) This is NOT a TGE Bob Bank, please refer to 'TGE.Guide'"
 *     3  "(TGE) Your TGE is out of date, This Bob bank requires TGE2222"
 *     4  "(TGE) GMS2.0+ is not installed!! Read The Manual->Requirements"
 *     5  "Music bank not found"
 *     6  "Bob bank doesn't exist"
 *     7  "Screen"
 *     8  "Error in Encyrption ! "
 *
 * Message 3's `2222` is not a typo left in: the routine's first arm patches
 * four digits over it, `divu.w #$10` and `addi.b #$30` twice per byte, so a
 * bob bank carries the TGE version it wants and the message names it.
 *
 * ## The value register
 *
 * `=Gsin`, `=Gcos`, `=GScreen Width` and `=GScreen Height` all end with
 * `move.w <something>,d3` and no `moveq #$0,d3` in front of it, which writes
 * the low half of the value register and leaves the high half holding whatever
 * was there, and AMOS guarantees nothing about it. All the extension docs say
 * is *"To send a function ... parameter back to AMOS, you load it in D3, ...
 * and put its type in D2"* — the worked example vendored at
 * `fixtures/official-amos/Tutorial/Extensions`, which is careful at every
 * word-sized return of its own: `move.b 88(a0),d3 / ext.w d3 / ext.l d3` for
 * `=Mouth Width`. So is AMOSPro.Lib itself, which writes either `moveq #$0,d3
 * / move.w $9ea(a5),d3` or `move.w -$16(a5),d3 / ext.l d3`. This extension's
 * own `=G Amiga` (routine 91) clears d3 first, so the author knew; the four
 * above are oversights.
 *
 * This port takes the high half as zero, which is the only reading under which
 * `=GScreen Width` reports a width. It costs `=Gsin` and `=Gcos` their sign;
 * see the catalogue.
 *
 * ## Defects
 *
 * - **DEFECT: `=Gsin` and `=Gcos` cannot return a negative number.** Routines
 *   85 and 86 read a table word into the low half of d3 and then `asr.l #$8`
 *   the whole register. With the high half zero the shift is a logical one, so
 *   the sine of 210 degrees comes back as 192 rather than -64: the word $C000
 *   read as $0000C000. The guide says *"returns sin of angle B multiplyed by
 *   128"*, and the magnitudes are right — it is only the top half of the
 *   circle that is wrong, which is the half a program is least likely to test
 *   first.
 * - **DEFECT: `=Gsin` and `=Gcos` are declared to return a float.** Their
 *   token spec is `10`, and the extension docs give `1` as
 *   *"1--> function that returns a float"*. The routines set
 *   the value register and never touch d2, the type register, so what a
 *   program gets is whatever type the last thing evaluated left behind — an
 *   integer, for the argument they were just given. Answered as an integer
 *   here.
 * - **DEFECT: `G Set Table 0` divides by zero.** The default is applied to the
 *   wrong register. `asl.w #$1,d7` doubles the count, `tst.l d0 / bne` falls
 *   through to `move.l #$b4,d0` when it is zero — so the SIZE defaults to a
 *   180-word quarter — but the fill at $3232 is handed d6, which still holds
 *   the original zero, and `divu.l d0,d1` at $3246 traps. There is no
 *   exception vector in this port, so it surfaces as AMOS error 20, which is
 *   what ../runtime/gamesupport.ts does with GameSupport's zero-divide.
 * - **DEFECT: the last quarter of the table is one step out.** Four of the
 *   five stores per pass walk outward from the quarter marks, and the fifth,
 *   `move.w d1,-(a4)`, starts at entry 5n — one PAST the end — so entry
 *   `5n-1-k` receives cos(k) where it should hold cos(k+1). With the usual
 *   n of 90 that is entries 360..449, which is exactly what `=Gcos` reads for
 *   270..359 degrees: `Gcos(270)` answers 2 instead of 0, being cos(271).
 * - **DEFECT: `G Set Table` frees the old table before it knows it can build a
 *   new one.** `FreeMem` runs first, and if the `AllocMem` then fails the two
 *   pointers at +$bce and +$bd2 are left pointing at the memory just handed
 *   back. `=Gsin` reads through them regardless.
 * - **DEFECT: `G Handicap` gives AMOS the LOWEST priority.** The guide says
 *   *"Gives Amos a priority of 256! Shutting off many system funcions thus
 *   speeding up your code."* and routine 88 is `move.l #$80,d0` into
 *   `SetTaskPri`, which takes a signed byte: $80 is -128, the bottom of the
 *   range. So the keyword does the exact opposite of what its own
 *   documentation promises, and the name is the accurate part.
 * - **DEFECT: `G Unhandicap` on its own calls SetTaskPri with a null task.**
 *   Routine 89 reads the task pointer from block +$b36 and the saved priority
 *   from +$b3a without testing either, and nothing but `G Handicap` ever
 *   writes them.
 * - **DEFECT: `G Handicap` twice loses the original priority.** The second
 *   call saves the -128 the first one installed, so `G Unhandicap` restores
 *   the handicap.
 * - **DEFECT: `G Encrypt` opens stc.library every time it is called.** Routine
 *   26 ($19d6) stores the base over the last one with no test, the same
 *   defect as `G Ptload` — and `G Decrypt` next door tests it first, so the
 *   author knew the pattern.
 * - **DEFECT: `G Decrypt` leaves the source bank decrypted.** It undoes the
 *   magic and the swaps in place and never puts them back, so a second
 *   `G Decrypt` of the same bank subtracts the magic from a longword that no
 *   longer has it.
 * - **DEFECT: `G Decrypt`'s library check tests and then ignores its own
 *   result.** `tst.l d0` at $1c38 with no branch after it: the failure arm was
 *   written and then not connected.
 * - **DEFECT: `=G Word$` has two dead length tests.** Both scans put
 *   `cmp.w d5,d3` immediately before `cmp.b d7,d0`, so the flags from the
 *   length compare are gone before anything branches on them and neither scan
 *   can stop at the end of the string. And `adda.l d3,a0` before a second
 *   scan that indexes from `d3` counts the offset twice. The guide says
 *   *"Not DONE"* and means it.
 * - **DEFECT: `G Ptload` opens ptreplay.library every time it is called.**
 *   Routine 15 ($18ca) calls `OpenLibrary` unconditionally and stores the base
 *   over the previous one, so a program that loads two modules has opened the
 *   library twice and can close it at most once. See `ptOpens`.
 * - **DEFECT: `G Ptload` never checks that the open worked.** The base goes
 *   straight into the block and the very next instruction is `jsr -$1e(a6)`
 *   through it, so a machine without `LIBS:ptreplay.library` jumps through
 *   zero rather than reporting anything.
 * - **DEFECT: `G Ptload` overwrites the previous module without unloading
 *   it.** The old handle is simply replaced at +$d0.
 * - **DEFECT: `G Ptstop` frees the module and keeps the pointer.** Routine 17
 *   ($1934) guards on both the base and the handle, calls StopModule and then
 *   UnLoadModule, and never clears +$d0 — so the guards still pass afterwards
 *   and a second `G Ptstop` frees the same handle twice.
 * - **DEFECT: `G Ptplay` pops an argument it does not declare.** Its token
 *   spec is `I`, no parameters, and routine 16 ($1918) opens `move.l (a3)+,d0`
 *   — a read off AMOS's parameter stack that nothing pushed. ptreplay ignores
 *   d0 entirely, so the damage is the stack imbalance and not the value.
 *   Nothing is reproduced here: this port hands a keyword its arguments as a
 *   list, so there is no stack to leave short. Same shape as Opal's
 *   `Ovcopperrefresh`, which declares one and never pops it.
 * - **DEFECT: `G Set Mouse` writes two overlapping longs.** Routine 80
 *   ($2bce) is `move.l d0,$b34(a0)` and then `move.l d1,$b32(a0)`, into two
 *   fields that `=G X Mouse` and `=G Y Mouse` read back as WORDS at $b32 and
 *   $b34. The second store covers $b32..$b35, so it lands its low word on top
 *   of the first store's high word: x ends up holding the high half of the x
 *   argument, which is zero for any sane coordinate, and y ends up holding the
 *   low half of the same argument. The y argument never reaches anything. The
 *   guide agrees without explaining, leaving both argument descriptions blank
 *   and saying *"DONT USE"*.
 * - **DEFECT: `=G Y Mouse` does not poll.** Routine 78 ($2b74) calls GMS's
 *   input poll at `-$24(a6)` before accumulating the x delta; routine 79
 *   ($2ba6) loads the same two pointers and skips the call, so a y read
 *   accumulates whatever delta the last x read left behind. Reading y without
 *   reading x first returns a stale figure.
 * - **DEFECT: `=G Cli` never sets its result.** Routine 60 ($24aa) leaves d3 —
 *   the value register — at the zero it used as an argument to `Execute`, and
 *   on failure writes -1 into d2, which is the TYPE register. So the function
 *   always answers 0 and a failed command corrupts the type instead.
 * - **DEFECT: `=G File Size` leaks its FileInfoBlock.** Routine 64 ($2698)
 *   allocates 1,000 bytes with `AllocMem` and never frees them, on every call
 *   and on every path out.
 * - **DEFECT: `G Wait Lmb` and `G Wait Rmb` disagree about GMS.** Routine 13
 *   ($188e) tests block +$12c — `dpkernel.library`'s base — before calling
 *   `G Update` in the wait loop; routine 14 ($18b2) calls it unconditionally.
 *   With GMS never started the right-button wait refreshes a display through
 *   a library that was never opened.
 * - **DEFECT: `G Close Req` closes a library nothing opens.** Routine 8
 *   ($16d4) calls `CloseLibrary` on the base at +$0c, and no instruction in
 *   the code hunk ever writes that longword. The guide marks all four
 *   requester commands *"Removed"* and three of them are still in the table;
 *   the opener is the one that really went. Batch 4 territory, recorded here
 *   because the catalogue belongs in one place.
 * - **DEFECT: `G Screen Open` throws its width argument away.** The five
 *   arguments pop into d0-d4 and the very next instructions are `moveq #$0,d1
 *   / movea.l -$8(a5),a0 / jsr $120(a0)` — d1 is the AMOS_WB argument and it
 *   is also X, which nothing saves and nothing puts back. So `move.l d1,$1c(a0)`
 *   at $1e80 sets GSA_Width to zero, and a zeroed tag is the one GMS takes
 *   the user's default for. Every TGE screen is `screens.prefs`'s ScrWidth
 *   wide whatever
 *   the program asked for, which on a stock GMS is 320 — so the bug is
 *   invisible until somebody asks for 640.
 * - **DEFECT: `=Gsuperhires` cannot open a super-hires screen.** It answers 2,
 *   which is `SM_SHIRES`, and then $1d6e-$1dbc normalises the mode: 8 and 1
 *   pass through, and everything else has 4 subtracted and is compared again,
 *   so 2 becomes -2, matches none of the three arms, and falls out of the
 *   default one as `1 + 4` — `SM_HIRES|SM_LACED`. `G Screen Open
 *   0,320,256,16,Gsuperhires` opens an interlaced hi-res screen. The arm the
 *   author wanted is not in the chain at all.
 * - **DEFECT: `=Gham` returns whatever the last expression left behind.**
 *   Routine 48 is `move.l #$0,d2 / rts`: it sets the TYPE register and never
 *   touches d3. Its three neighbours are `moveq #<mode>,d3 / moveq #$0,d2`,
 *   so the missing instruction is visible in the shape of the routine. There
 *   is no HAM in GMS's ScrMode to have returned — HAM is `BMF_HAM` on the
 *   Bitmap's Flags — which is presumably why it was never written.
 * - **DEFECT: `G Double Buffer` and `G Triple Buffer` write into a register
 *   nobody set.** Both are four instructions: `movea.l $1c8(a5),a0` loads the
 *   data block into a0, and then `movea.l $1be(a4),a1` indexes **a4**. The
 *   bytes are `20 6d 01 c8 / 22 6c 01 be`, so it is a4 and not a misprint.
 *   The offset is wrong as well: the constants stored are $101 and $102,
 *   which are `SCR_BLKBDR|SCR_DBLBUFFER` and `SCR_BLKBDR|SCR_TPLBUFFER`, and
 *   +$0c of a Screen is MemPtr1. What they mean is the Attrib value slot of
 *   the TEMPLATE at block +$1f6, which really is at +$0c of it and really
 *   does ship as $100 — `lea $1f6(a0),a1` is the missing line. So neither
 *   keyword can do what the guide says it does, and `G Swap Buffers` has
 *   nothing to swap: `SwapBuffers()` on a screen with no second buffer
 *   returns without doing anything.
 * - **DEFECT: `G Screen Close` on a screen that was never opened frees
 *   ExecBase.** Routine 40 fetches `table[N]`, which is zero, and then
 *   `movea.l $4(a4),a0` — the longword at absolute address 4, which is
 *   ExecBase — and hands that to `Free()`. The guard next to it,
 *   `cmpa.l #$5120,a0`, tests for a constant that nothing can produce and
 *   catches nothing. It also never clears the +$18c flag byte or the current
 *   Screen and Bitmap at +$1be/+$1c2, so `=GScreen Width` after closing the
 *   current screen reads the structure it just handed back.
 * - **DEFECT: `G Screen Hide` clears screen 0's flag byte whichever screen it
 *   hides.** `move.b #$ff,$18c(a3)`, with no index — routine 39 writes the
 *   same table as `$18c(a3) + d0`. It costs nothing, because the byte is
 *   written in two places and read in none.
 * - **DEFECT: `G Screen Copy` gives both screens the same palette.** After
 *   the image copy it does `move.l $38(a0),d5 / move.l d5,$38(a1)` on the two
 *   Bitmaps, which is `Palette`, a POINTER. So the destination stops having a
 *   palette of its own: a later `G Colour` on either screen changes both, and
 *   closing the source leaves the destination pointing into freed memory.
 *   Copying the 8 + 4*colours bytes is what was meant, and `CopyPalette()` in
 *   colours.mod is the call that does it.
 * - **DEFECT: `=GScreen Width`, `=GScreen Height` and `=GScreen Colour` read
 *   through a null pointer before the first screen opens.** All three are
 *   `movea.l $1c2(a1),a0` and then a load off it, with no test; +$1c2 ships
 *   as zero.
 * - **DEFECT: `G Getscr` resolves a screen number it never set and discards
 *   the answer.** Routine 54 takes no arguments — its spec is `I` — and is
 *   `move.l #$1,d0 / Rjsr <AMOS routine> / move.l a0,d0 / rts`. The routine
 *   called takes the screen NUMBER in d1, not d0, and returns the screen in
 *   a0; TGE sets d0, leaves d1 holding whatever the interpreter left there,
 *   and then moves the result into d0, which for an instruction goes nowhere
 *   — the value register is d3. So the keyword has no arguments, no result
 *   and no effect, except that an unresolvable d1 raises AMOS's own
 *   screen error.
 * - **DEFECT: nothing bounds a TGE screen number.** The table at +$19a is
 *   eight entries and no routine checks; entry 8 is the unused longword at
 *   +$1ba, entry 9 is the current Screen pointer at +$1be and entry 10 is the
 *   current Bitmap at +$1c2, so `G Screen Open 9,...` files a tag list where
 *   the current screen belongs. DEVIATION: this port raises AMOS's illegal
 *   screen number instead. The three fields are separate here rather than
 *   adjacent longwords, so the aliasing has nothing to alias.
 * - **DEFECT: `G Palette` puts its eight colours in backwards.** Routine 67
 *   pops into d0 first and stores d0 at the front of the buffer, and pops run
 *   right to left — so the buffer holds C8, C7 … C1, and `ChangeColours`
 *   reads it forwards from `First`. The guide's own worked example is the
 *   thing this contradicts: *"G Palette 3,$000000,$FFFFFF, ... will start at
 *   colour 3 (0,1,2,`3'). Putting 3 as black, 4 as white"* — the routine puts
 *   colour 3 white and colour 10 black. `G Def Palette`, the next routine
 *   along, pops descending and gets it right.
 * - **DEFECT: `G Ink` takes an RGB and its guide node says otherwise.** *"The
 *   number (not $RRGGBB value) of the colour to use."* — and routine 7 calls
 *   `SetRGBPen`, whose autodoc is *"LONG SetRGBPen(*Bitmap [a0], LONG RGB
 *   [d0])"*. There is no pen-by-index call in blitter.mod for the node to
 *   have been describing; it is describing AMOS's `Ink`.
 * - **DEFECT: `G Set Pen` IS `G Blur`, and cannot work.** Both token entries
 *   name instruction 112. The routine pops FIVE longwords, subtracts the near
 *   corner from the far one and calls `BlurArea` in colours.mod; `G Set Pen`'s
 *   spec is `I0,0` and pushes two. So it reads three longwords nobody pushed
 *   and blurs a rectangle made out of them. What the guide describes —
 *   *"Sets the style and radius of the brush"*, with *"Type -> values 0-2,
 *   0-> Pixel 1-> Square 2-> Circle"* — is `SetPenShape(a0l,d1w,d2w)` at
 *   blitter -$fc, a different module, and even the numbering is somebody's
 *   memory of it: blitter.h has PSP_CIRCLE 1, PSP_SQUARE 2, PSP_PIXEL 3.
 * - **DEFECT: `G Def Palette`'s block is eight bytes short.**
 *   `AllocMem #$400` for a `struct RGBPalette`, which is two longwords and
 *   256 `RGB`s — 1,032. So the block holds 254 colours, and a `First` above
 *   246 writes past the end of it.
 * - **DEFECT: `G Get Palette` hands `UpdatePalette` a palette.** Routine 118
 *   ends `jsr -$1e(a6)` into `CopyPalette` and then `jsr -$90(a6)` into
 *   `UpdatePalette`, which takes a Screen in a0 — and a0 is whatever
 *   CopyPalette left there, the source palette pointer at best. Not
 *   reproducible and not observable here: the copy has already landed in the
 *   array the display reads.
 * - **DEFECT: `G Init Gms`'s check that GMS is installed checks nothing.**
 *   Before the open it locks `block + $12c` — the slot dpkernel's base is
 *   about to go in, four zero bytes at that moment, so an empty filename.
 *   The name it means is at +$112, and is the string the `OpenLibrary` two
 *   arms later uses. AmigaDOS answers an empty name with a lock on the
 *   current directory, so the guard passes everywhere; the failure it was
 *   written for is caught by the open instead, which reports the same
 *   message.
 * - **DEFECT: `G Own Blitter` writes to address $2e.** `move.w #$1,$2e(a1)`
 *   with a1 out of block +$da, and +$2e of dpkernel's base really is
 *   `GVBase.OwnBlitter` — so the intent is exact and the pointer is not
 *   there. One instruction in the whole code hunk writes +$da, on
 *   `G Init Gms`'s hosted entry path, which only a GMS program calling in
 *   through the PRGM record at $2f88 can reach. Nothing AMOS runs can. The
 *   base is also at +$12c, four instructions from the store that should have
 *   set both.
 * - **DEFECT: `=G Make Rp` returns 3 and leaks 200 bytes.** `AllocMem`,
 *   `move.l #$3,d3`, and then a `beq` and a `bra.w` to the same exit, so 140
 *   of the routine's 192 bytes are unreachable and the block is never freed.
 *   The `beq` could not fire in any case: the `move.l` between it and the
 *   `tst.l` sets the flags. What the dead half does is worth recording — it
 *   opens `graphics.library`, builds a RastPort and a BitMap over the block
 *   and points them at the current GMS bitmap's pixels, which is the bridge
 *   that would let AMOS's own drawing reach a GMS screen.
 * - **DEFECT: `G Exit` raises whatever error number is lying in d0.** Its
 *   spec is `I` and nothing pushes anything, and the `tst.l d0 / bne` means
 *   the 16 it would default to is used only when the leftover happens to be
 *   zero. An argument the author forgot to declare, the same slip as
 *   `G Ptplay`'s in the other direction.
 * - **DEFECT: `G Close Gms` shuts down a GMS it may not have started.** It
 *   calls `CloseDPK` without testing +$d4, which routine 90's own teardown at
 *   $30d6 does test. Unreachable from AMOS for the same reason as
 *   `G Own Blitter`.
 * - **NOTE: `G Init Gms`'s failure teardown ends in `ReplyMsg`.** `move.l
 *   $d6(a3),d0 / beq / jsr -$17a(a6)` on ExecBase, and ReplyMsg takes its
 *   message in a1. Nothing in the code hunk ever writes +$d6, so the branch
 *   is never taken and the register is never wrong in practice.
 * - **DEFECT: `G Line`'s three-argument form does not return.** Routine 68 is
 *   routine 66 with two arguments taken off and three faults added. It has no
 *   `movem.l a0-a6,-(a7)` on the way in and a `movem.l (a7)+,a0-a6` on the
 *   way out, so it lifts twenty-eight bytes off the stack that nobody put
 *   there and `rts` returns into whatever is above them. It never loads the
 *   Bitmap into a0 either — `move.l $1c2(a3),d0` puts it in the wrong
 *   register, and reads it off a3, which at that point is AMOS's parameter
 *   stack and not the data block. APPROXIMATED as a no-op: three arguments
 *   evaluated and nothing drawn, which is the nearest a port can get to a
 *   keyword that does not come back.
 * - **DEFECT: `G Rectangle` fills or does not fill at random.** `PenRect`'s
 *   sixth argument is `Fill [d4]` — blitter.mod $5a30-$5a5e saves d4 and
 *   branches on its low word — and routine 121 pops four arguments into
 *   d0-d3 and never touches d4. `G Circle` next door clears d3 before its
 *   call, so the author had the habit and missed it here. DEVIATION: this
 *   port draws the outline, there being nothing for a leftover register to
 *   be.
 * - **DEFECT: `G Blur`'s Percent argument is a flag.** `colours.c` opens
 *   `if (Setting < 1) return` and never reads it again, so the guide's
 *   *"Percentage (1-100) of how much you want it to smudge the area"* is one
 *   fixed blur for the whole range — which its own next sentence, *"The Speed
 *   is roughly the same for all 1-100"*, is the symptom of.
 * - **DEFECT: `=G Rgb` leaves the type register holding its Y argument.**
 *   Routine 111 sets d3 and never d2, and d2 is where Y was popped. The same
 *   class as `=Gsin`'s missing type, and worse, because the value there is a
 *   coordinate rather than a leftover.
 * - **NOTE: `G Blur`'s token entry declares a function as well as an
 *   instruction**, `instr` 112 and `func` 1 where every other
 *   instruction-only keyword in the table carries `$ffff`. Its spec begins
 *   `I`, so the field is never consulted.
 * - **NOTE: `G Rectangle` stops a pixel short.** `sub.w d0,d2` makes the
 *   width `X2-X1`, and a rectangle of that width at X1 reaches X2-1, where
 *   the guide says *"corners at the specified points"*. `G Copyarea` and
 *   `G Blur` share the arithmetic and the same one-pixel edge.
 */
import type { Func, Instr } from '../interp/builtins'
import { AmosError, VI, VS, str } from '../interp/values'
import { ED_RUN_MESSAGES } from '../interp/errors.gen'
import { stcCrunch, stcDecrunch } from '../amiga/stonecracker'
import { counterDelta, joyDatX, joyDatY, mouseDat } from '../amiga/gameport'
import { execute } from '../amiga/process'
import {
  JPF_BUTTON_BLUE,
  JPF_BUTTON_FORWARD,
  JPF_BUTTON_GREEN,
  JPF_BUTTON_PLAY,
  JPF_BUTTON_RED,
  JPF_BUTTON_REVERSE,
  JPF_BUTTON_YELLOW,
  JPF_JOY_DOWN,
  JPF_JOY_LEFT,
  JPF_JOY_RIGHT,
  JPF_JOY_UP,
  readJoyPort,
} from '../amiga/lowlevel'
import { closeLibrary, openLibrary } from '../amiga/exec'
import { Protracker, parseMod, type PtSong } from '../amiga/protracker'
import { Runtime } from './runtime'
import { Screen } from './screen'

/** an argument that arrived as a Value */
const int = (v: unknown): number => Number((v as { n?: number } | undefined)?.n ?? 0) | 0

/** ptreplay $3a6: `move.w #$39,$e(a5)` — what PlayModule sets the volume to */
export const PT_PLAY_VOLUME = 57

/** the handle this port hands out; ptreplay's is an address and its value never shows */
const PT_HANDLE = 1

/**
 * What `-$18ae(a5)` holds, and therefore what `=G Oddno` answers.
 *
 * AMOS keeps `graphics.library`'s base in its own workspace and every
 * extension reaches it there; this one hands it to the program. It has to be a
 * number, and it has to be one nothing mistakes for a real allocation:
 * `../amiga/exec.ts` puts the bases its `OpenLibrary` hands out at
 * `0x7f10_0000`, and this sits just below them, being a base too — one AMOS
 * opened long before any of those.
 */
export const TGE_GFX_BASE = 0x7f0f_0000

/**
 * The zero run at block +$352, which is what `=G Getmem` points at: 2,148
 * bytes between the last library-name string and the end of the data block.
 */
export const TGE_SCRATCH_SIZE = 2148

export interface TheGameState {
  /** block +$58 — ptreplay.library's base, or 0 for "never opened" */
  ptBase: number
  /** how many times `G Ptload` has opened it; the leak is the point */
  ptOpens: number
  /** block +$d0 — the handle, which `G Ptstop` frees and leaves behind */
  module: number
  /** the song behind the handle, absent once `G Ptstop` has unloaded it */
  song: PtSong | null
  /** handle +$0c */
  paused: boolean
  /** handle +$10 and +$11 — the fade countdown and the rate it reloads from */
  fadeCount: number
  fadeRate: number
  replay: Protracker

  /** block +$352 — the 2,148 zero bytes `=G Getmem` hands out the address of */
  scratch: Uint8Array
  /** block +$b32 and +$b34, the two mouse accumulators, as WORDS */
  mouseX: number
  mouseY: number
  /** the quadrature counters the last `=G X Mouse` poll saw */
  prevX: number
  prevY: number
  /** whether those two hold a real reading yet */
  seeded: boolean
  /** whether an AppIcon is on the Workbench, and whether it has been clicked */
  iconUp: boolean
  iconClicked: boolean
  /** bytes `=G File Size` has allocated and never freed */
  fibLeak: number

  /** block +$bce, the sin table — and, n entries in, the cos table at +$bd2 */
  trig: Int16Array | null
  /** (+$bd2 - +$bce) / 2: how far into it `=Gcos` starts */
  cosAt: number
  /** block +$bd6 — the byte size the next `G Set Table` hands to `FreeMem` */
  trigBytes: number

  /** block +$1c — reqtools.library's base, or 0 for "never opened" */
  reqtoolsBase: number
  /** how many times `G Close Reqtools` has closed it; it never clears +$1c */
  reqtoolsCloses: number
  /** block +$c8 — stc.library's base, or 0 for "never opened" */
  stcBase: number
  /** how many times `G Encrypt` has opened it; it never tests, so it leaks */
  stcOpens: number
  /** block +$b2a — the password checksum, and the four bytes of the key */
  keySum: number
  /** bytes `=G Word$` has allocated and never freed */
  wordLeak: number

  /** block +$195 — the current screen NUMBER, which ships as zero */
  gmsCurrent: number
  /**
   * block +$1be and +$1c2 — the current Screen and its Bitmap.
   *
   * One field for two pointers, because a `Screen` here is both: GMS splits
   * the viewport from the pixels and this port does not. It holds the object
   * rather than a slot number so that `G Screen Close`, which never clears
   * either pointer, still reads the width it had — a freed structure nothing
   * has reused yet reads exactly like this.
   */
  gmsScreen: Screen | null
  /**
   * The `RGBPalette` `G Def Palette` allocates and hangs off the screen
   * TEMPLATE, so every screen opened afterwards SHARES it — the tag is
   * `BMA_Palette`, a TAPTR, and GMS takes the pointer rather than the
   * colours. Held as the port's `$0RGB` words rather than GMS's `$00RRGGBB`
   * longs, because `Screen.palette` is what it ends up being.
   */
  gmsDefPalette: Uint16Array | null
  /**
   * `Bitmap->prvPen` — what `G Ink` sets and what the shape keywords draw
   * with. Per bitmap on the machine and per screen here, which is the same
   * thing; kept out of `Screen` because it is a 24-bit RGB and AMOS's own
   * `Ink` is a pen number.
   */
  gmsPen: WeakMap<Screen, number>
  /** block +$12c — dpkernel's base, and the "is GMS up" test every keyword makes */
  gmsBase: number
  /** block +$d4 — set when it was `G Init Gms` that opened dpkernel */
  gmsOwned: boolean
  /** bytes `=G Make Rp` has allocated and never freed */
  rpLeak: number

  /** whether `G Handicap` has run, so block +$b36 holds a task pointer */
  handicapped: boolean
  /** the task priority, which nothing here schedules on; see `G Handicap` */
  priority: number
  /** block +$b3a — the priority `G Unhandicap` puts back */
  savedPriority: number
}

export function newTheGameState(rt: Runtime): TheGameState {
  return {
    ptBase: 0,
    ptOpens: 0,
    module: 0,
    song: null,
    paused: false,
    fadeCount: 0,
    fadeRate: 0,
    replay: new Protracker(() => rt.host.audio),
    scratch: new Uint8Array(TGE_SCRATCH_SIZE),
    mouseX: 0,
    mouseY: 0,
    prevX: 0,
    prevY: 0,
    seeded: false,
    iconUp: false,
    iconClicked: false,
    fibLeak: 0,
    trig: null,
    cosAt: 0,
    trigBytes: 0,
    reqtoolsBase: 0,
    reqtoolsCloses: 0,
    stcBase: 0,
    stcOpens: 0,
    keySum: 0,
    wordLeak: 0,
    gmsCurrent: 0,
    gmsScreen: null,
    gmsDefPalette: null,
    gmsPen: new WeakMap(),
    gmsBase: 0,
    gmsOwned: false,
    rpLeak: 0,
    handicapped: false,
    priority: 0,
    savedPriority: 0,
  }
}

/**
 * What a tag left at zero takes, out of GMSPrefs's shipped defaults.
 *
 * `fixtures/gms/Prefs/Default/screens.prefs` is a `struct ScreenPrefs`
 * (`dev/Includes/dpkernel/prefs.h`) XORed with $3d — the key falls out of the
 * padding, since the file is mostly zeroes and mostly $3d. It decodes to
 * ChipSet AGA, ScrWidth 320, ScrHeight 256, Planes 5, ScrMode SM_LORES,
 * ScrType ILBM, TopOfScr (128, 44), and a 256-entry palette starting white —
 * every field plausible and the palette self-evidently right, which is what
 * makes the key right.
 */
export const GMS_DEFAULT_WIDTH = 320
export const GMS_DEFAULT_HEIGHT = 256
/** Planes 5 in the prefs; the Bitmap's AmtColours is what TGE actually sets */
export const GMS_DEFAULT_COLOURS = 32
/** ScreenPrefs TopOfScrX/Y: where a GMS screen offset of (0,0) puts a screen */
export const GMS_TOP_OF_SCREEN_X = 128
export const GMS_TOP_OF_SCREEN_Y = 44

/**
 * Routine 151's table at $4214, delivered through `Rjmp L_ErrorExt` with the
 * index in d0. Read out in full in the header; here to be thrown.
 *
 * Message 3 carries a version the reporter patches four digits over before it
 * shows the string, which is why it reads `TGE2222` in the binary.
 */
export const TGE_ERRORS = [
  "(TGE) You don't have the required library in LIBS:",
  '(TGE) You NEED to do a: G Init Gms before using this command!',
  "(TGE) This is NOT a TGE Bob Bank, please refer to 'TGE.Guide'",
  '(TGE) Your TGE is out of date, This Bob bank requires TGE2222',
  '(TGE) GMS2.0+ is not installed!! Read The Manual->Requirements',
  'Music bank not found',
  "Bob bank doesn't exist",
  'Screen',
  'Error in Encyrption ! ',
]

const tgeError = (n: number): never => {
  throw new AmosError(TGE_ERRORS[n] ?? `TGE error ${n}`)
}

/** block +$112 — what `G Init Gms` hands `OpenLibrary`, path and all */
export const GMS_DPKERNEL = 'GMS:libs/dpkernel.library'

/**
 * ExecBase +$128, `AttnFlags`, as the machine this port models has it.
 *
 * AFB_68020 and nothing else. The identity is settled elsewhere and has to
 * stay consistent with it: AMCAF's `=Cpu` answers 68020, TURBO's `Cpu Info`
 * answers 20, JD's `=Jd Cpu` agrees, and all three read this word and test
 * bit 3 down to bit 0. `=G Amiga` is the only keyword in the port that hands
 * the word back raw.
 */
export const TGE_ATTN_FLAGS = 1 << 1

/**
 * Routine 90 ($2f36) minus its arguments — the body `G Init Gms` and
 * `G Screen Open` share, the latter by `Rbsr`ing straight into it.
 *
 * Idempotent, because the routine's first four instructions test +$12c and
 * return if it is already set. Everything after the OpenLibrary is the five
 * `OpenModule` calls and the `Get(ID_TASK)` for the input structure, which
 * are bases and handles this port has no use for: a GMS call is a TypeScript
 * call here, so there is nothing for a module base to be.
 */
function gmsInit(st: TheGameState): void {
  if (st.gmsBase !== 0) return
  const base = openLibrary(GMS_DPKERNEL, 2)
  if (base === 0) tgeError(4)
  st.gmsBase = base
  st.gmsOwned = true
}

/**
 * A GMS `$00RRGGBB` as the port's `$0RGB` palette word.
 *
 * Straight truncation, which is what the Amiga's colour registers do with a
 * 24-bit value on ECS, and what `../loader/iff.ts` does in the same
 * direction. GMS is 24-bit throughout — `Screen->prvColBits` picks 12 or 24
 * at the hardware — and this port's palette is twelve, so the low nibble of
 * each component is where the difference goes.
 */
const rgb12 = (v: number): number => (((v >>> 20) & 15) << 8) | (((v >>> 12) & 15) << 4) | ((v >>> 4) & 15)

/** a coordinate as the blitter takes it: `d1w`, a sign-extended word */
const coord = (v: number): number => (v << 16) >> 16

/** the port's `$0RGB` back out as GMS's `$00RRGGBB`, each nibble replicated */
const rgb24 = (v: number): number =>
  ((((v >> 8) & 15) * 17) << 16) | ((((v >> 4) & 15) * 17) << 8) | ((v & 15) * 17)

/**
 * `ClosestColour(RGB d0, Palette a0)` — *"Returns the colour number in the
 * palette that best matches the given RGB colour"*, and the answer every pen
 * and every `DrawRGBPixel` on a planar bitmap needs.
 *
 * DEVIATION: colours.mod's published source weights the three components
 * against a `HIQUALITY` switch it says *"should be in GMSPrefs"*; this is a
 * plain squared distance over the port's twelve bits. Reimplemented rather
 * than transcribed, as everything else here is.
 */
function closestColour(sc: Screen, rgb: number): number {
  let best = 0
  let bestAt = Infinity
  for (let i = 0; i < sc.nColors && i < sc.palette.length; i++) {
    const p = rgb24(sc.palette[i]!)
    const dr = ((p >> 16) & 255) - ((rgb >> 16) & 255)
    const dg = ((p >> 8) & 255) - ((rgb >> 8) & 255)
    const db = (p & 255) - (rgb & 255)
    const d = dr * dr + dg * dg + db * db
    if (d < bestAt) {
      bestAt = d
      best = i
    }
  }
  return best
}

/** the index `SetRGBPen`'s colour comes out as on this screen */
const penIndex = (st: TheGameState, sc: Screen): number => closestColour(sc, st.gmsPen.get(sc) ?? 0)

/**
 * How many colours fit in the block `G Def Palette` allocates.
 *
 * `struct RGBPalette` is `LONG ID, LONG AmtColours, struct RGB Col[256]`,
 * which is 1,032 bytes, and routine 69 asks `AllocMem` for $400 — 1,024. So
 * the block holds 254 colours and the last two are somebody else's memory.
 */
export const GMS_DEF_PALETTE_COLOURS = (0x400 - 8) / 4

/**
 * TGE screen number to slot in the machine's one screen table. See "Where a
 * GMS screen lives here".
 *
 * The range is asked for per call rather than once at load: runtime.ts imports
 * this file and this file imports it back, so a `Runtime.` at module scope
 * runs before the class exists.
 *
 * DEVIATION: the extension bounds nothing, and its table's neighbours are the
 * current Screen and Bitmap pointers; see the catalogue. Refusing is the only
 * thing this port can do with a number that would file a screen into a field
 * that is not adjacent to anything here.
 */
function gmsSlot(n: number): number {
  const range = Runtime.screenRange('game')
  if (n < 0 || n >= range.count) throw new AmosError(`illegal screen number: ${n}`)
  return range.from + n
}

/**
 * $1d50..$1dbc — what `G Screen Open` makes of its mode argument.
 *
 * Two AMOS constants come in first: 0 is AMOS's Lowres and $8000 its Hires,
 * both tested as WORDS, so the extension takes `Screen Open`'s own mode
 * argument as well as its four `=G` functions. After that, `SM_LORES` (8) and
 * `SM_HIRES` (1) pass straight through and everything else has 4 taken off it
 * — a WORD subtract on a long register, so no borrow reaches the high half —
 * and is compared again. That second round is how interlace gets in: 12 is
 * `SM_LORES|SM_LACED` and 5 is `SM_HIRES|SM_LACED`, and 4 on its own means
 * "laced, at the default resolution".
 *
 * Nothing reaches `SM_SHIRES`; see the catalogue.
 */
export function gmsScreenMode(mode: number): number {
  let d4 = mode | 0
  if ((d4 & 0xffff) === 0) d4 = 8
  else if ((d4 & 0xffff) === 0x8000) d4 = 1
  if (d4 === 8 || d4 === 1) return d4
  // subq.w #$4,d4 on a longword register: the low half only
  d4 = (d4 & ~0xffff) | (((d4 & 0xffff) - 4) & 0xffff)
  if (d4 === 8 || d4 === 0) return 12
  return 5
}

/**
 * A GMS `ScrMode` as the mode word `Screen` takes, which is AMOS's.
 *
 * `SM_HIRES` is AMOS's $8000 and `SM_LACED` its $4. `SM_SHIRES` has no AMOS
 * bit and never arrives, and `SM_SLACED` is not reachable either — the
 * normaliser above emits only 1, 5, 8 and 12.
 */
const amosMode = (scrMode: number): number => ((scrMode & 1) !== 0 ? 0x8000 : 0) | (scrMode & 4)

/** $3240: `move.l #$1921fb5,d1` — a quarter turn in 8.24 fixed point */
const QUARTER_TURN_8_24 = 0x1921fb5

/**
 * One pass of the series at $3264..$329c: cos(x) as a 16.15 word, x in 16.16.
 *
 * Written as the 68020 arithmetic rather than as `Math.cos`, because the
 * rounding is observable — a program reads these words through `=Gsin` and the
 * shift throws all but the top eight bits away, so which side of a boundary a
 * truncation lands on decides the answer. Both 64-bit products are taken apart
 * the same way the routine does it: `move.w d4,d5 / swap d5` keeps bits 47..16
 * of the product, which is the 16.16 result.
 */
function cosFixed(x16: number): number {
  // mulu.l d5,d4:d5 — an UNSIGNED square, then neg.l
  const sq = BigInt(x16 >>> 0) * BigInt(x16 >>> 0)
  const minusX2 = -Number(BigInt.asIntN(32, sq >> 16n)) | 0

  let sum = 0x00010000 // d1, and the series starts at 1.0
  let term = 0x00010000 // d3
  let k = 0 // d2
  let fact = 1 // d6
  do {
    // muls.l d5,d4:d3 — signed this time, same middle 32 bits
    term = Number(BigInt.asIntN(32, BigInt.asUintN(64, BigInt(term) * BigInt(minusX2)) >> 16n)) | 0
    k += 1
    fact = Math.imul(fact, k)
    k += 1
    fact = Math.imul(fact, k)
    // divs.l truncates toward zero, which is what `|0` does to a negative
    sum = (sum + ((term / fact) | 0)) | 0
  } while (k >>> 0 < 12)

  sum = sum >>> 1 // lsr.l #$1,d1
  // tst.w d1 / dbpl d1: DBcc decrements the WORD when the condition fails, so
  // the only value this can reach -- cos(0)'s $8000 -- becomes $7fff
  if ((sum & 0x8000) !== 0) sum = (sum & ~0xffff) | ((sum - 1) & 0xffff)
  return sum & 0xffff
}

/**
 * The filler at $323c: `n` passes, six stores each, over a 5n-word table.
 *
 * `a0` walks up from entry n and `a1` down from it, `a3` up from 3n and `a2`
 * down from it with the sign flipped, and `a4` down from 5n — which is one
 * past the last entry rather than on it, and is the off-by-one in the
 * catalogue. Entries 0 and 2n are left as `AllocMem(MEMF_CLEAR)` left them.
 *
 * A `G Set Table` past 32767 writes far outside the block it allocated,
 * because the size came from a word shift and the fill did not: the count
 * wraps to zero for the size, defaults to 180 words, and then n passes write
 * over whatever follows. Nothing is corrupted here — the writes fall off the
 * end of an `Int16Array` and are dropped — and that is a DEVIATION rather than
 * a reproduction, there being no neighbouring allocation to trash.
 */
function fillTrig(table: Int16Array, n: number): void {
  // divu.l d0,d1 with a zero divisor is a 68020 zero-divide exception, and
  // there is no vector for one here; ../runtime/gamesupport.ts settled on AMOS
  // error 20 as the nearest true thing to say
  if ((n >>> 0) === 0) throw new AmosError('Division by zero', 20)
  const step = Math.floor(QUARTER_TURN_8_24 / (n >>> 0))

  let angle = 0 // d0, 8.24
  for (let k = 0; k < n; k++) {
    const v = cosFixed(angle >>> 8)
    const neg = -v & 0xffff // neg.w on the same word
    if (n + k < table.length) table[n + k] = v
    if (n - k < table.length) table[n - k] = v
    if (5 * n - 1 - k < table.length) table[5 * n - 1 - k] = v
    if (3 * n - k < table.length) table[3 * n - k] = neg
    if (3 * n + k < table.length) table[3 * n + k] = neg
    angle = (angle + step) >>> 0
  }
}

/**
 * ptreplay's interrupt, once a frame.
 *
 * The library drives itself off a CIA timer at the module's own tempo; every
 * replayer in this port ticks once a frame instead, which is the same
 * approximation `../runtime/gamesupport.ts` and `../runtime/p61.ts` make.
 *
 * The fade is ptreplay's own and not `Protracker`'s, because the end of it
 * differs: $9d4 falls through to a teardown when the volume word reaches
 * zero, where `Protracker` would sit at zero and keep playing.
 */
export function thegameVbl(rt: Runtime): void {
  const st = rt.thegame as TheGameState | undefined
  if (!st) return
  const r = st.replay
  if (!r.playing || st.paused) return
  r.tick()
  st.fadeCount = r.fadeCount
  if (st.fadeRate !== 0 && r.master === 0) {
    // ptreplay $9d8: the volume word ran out, so the module stops
    r.stop()
    st.fadeRate = 0
  }
}

/** every tracker keyword after `G Ptload` reaches through both of these */
const live = (st: TheGameState): boolean => st.ptBase !== 0 && st.module !== 0

/** the bank name both encryption keywords reserve under, block +$bb6 */
export const TGE_ENCRYPT_BANK_NAME = 'TGE   En'

/**
 * The password checksum at $19e0 and $1bfa, which is the whole of the key.
 *
 *     moveq #$0,d0 / move.w (a1),d1
 *     .loop add.b (a1,d1.w),d0 / dbra d1,.loop
 *     asl.l #$1,d0
 *
 * `a1` is the AMOS string, so offset 0 and 1 are its LENGTH word and the
 * characters start at 2 — and the loop counts DOWN from the length, covering
 * offsets `len` to 0. So the two bytes of the length are part of the sum and
 * the last character of the password is NOT: `"secret"` and `"secreX"` have
 * the same key. `add.b` also means the sum is taken modulo 256 with no carry
 * out, so the doubling leaves 0..510 and the key is really nine bits.
 */
export function keyChecksum(key: string): number {
  const len = key.length & 0xffff
  let sum = 0
  for (let off = 0; off <= len; off++) {
    const b = off === 0 ? len >>> 8 : off === 1 ? len & 0xff : key.charCodeAt(off - 2) & 0xff
    sum = (sum + b) & 0xff
  }
  return sum << 1
}

/**
 * The four word swaps at $1b8a and $1c50, which are the obfuscation.
 *
 * The checksum is stored as a LONGWORD at block +$b2a and then read back a
 * byte at a time, so the four indices are the four bytes of a number that
 * never exceeds 510: the first two are always zero, the third is 0 or 1, and
 * only the fourth carries the password. Each index picks a word at
 * `bank + 16 + index` and swaps it with one of the four words at `bank + 8`.
 *
 * `G Encrypt` walks the indices 0,1,2,3 against +$8,+$a,+$c,+$e and `G
 * Decrypt` walks 3,2,1,0 against +$e,+$c,+$a,+$8, which is the inverse. The
 * magic longword the two add and subtract at the very front commutes with all
 * of it, being sixteen bytes away, so the order they do THAT in — first in
 * both routines, where the inverse would want it last — costs nothing.
 *
 * DEFECT: `bank + 16 + index` reaches `bank + 272` and nothing tests the
 * bank's length, so a short crunch and a heavy password write past the end.
 * That one is contained here rather than reproduced: a swap that would leave
 * the bank is skipped — there is no next allocation to corrupt — and because
 * `G Decrypt` skips exactly the same ones, a bank encrypted and decrypted in
 * this port still round-trips. `move.w` at an ODD address is also an address
 * error on a 68000, which this extension is not for: it uses `mulu.l` and
 * `divu.l` in `G Set Table` and so needs an 020 anyway.
 */
function swapKeyWords(bank: Uint8Array, sum: number, forward: boolean): void {
  const order = forward ? [0, 1, 2, 3] : [3, 2, 1, 0]
  for (const i of order) {
    const index = (sum >>> (24 - 8 * i)) & 0xff
    const a = 16 + index
    const b = 8 + 2 * i
    if (a + 1 >= bank.length || b + 1 >= bank.length) continue
    const t0 = bank[a]!
    const t1 = bank[a + 1]!
    bank[a] = bank[b]!
    bank[a + 1] = bank[b + 1]!
    bank[b] = t0
    bank[b + 1] = t1
  }
}

/**
 * `Rjsr L_Bnk_GetAdr` and no test of the result, which both `G Decrypt` and
 * `G Stc Unpack` do.
 *
 * DEVIATION: on the machine a0 comes back zero and the routine goes on to
 * read and write through it, which is a scribble on the bottom of memory and
 * then a guru. There is no address zero here, so a bank that is not reserved
 * raises AMOS's own error for that instead — the one every extension that
 * DOES check the result raises, EasyLife's zone keywords among them.
 */
function missingBank(rt: Runtime, n: number): { data: Uint8Array } {
  const b = rt.memBanks.get(n)
  if (!b) throw new AmosError('Bank not reserved', 36)
  return b
}

/** `addi.l #$1131511,(a0)` at $1b80, and the `subi.l` that undoes it */
const ENCRYPT_MAGIC = 0x01131511

function addMagic(bank: Uint8Array, delta: number): void {
  if (bank.length < 4) return
  const v = (((bank[0]! << 24) | (bank[1]! << 16) | (bank[2]! << 8) | bank[3]!) + delta) >>> 0
  bank[0] = (v >>> 24) & 0xff
  bank[1] = (v >>> 16) & 0xff
  bank[2] = (v >>> 8) & 0xff
  bank[3] = v & 0xff
}

/**
 * `move.w (a1,d0.w),d3 / asr.l #$8,d3` — the tail `=Gsin` and `=Gcos` share.
 *
 * `from` is the pointer they start at, as a word index: 0 for +$bce and
 * `cosAt` for +$bd2. The displacement is a SIGN-EXTENDED word, so an index
 * from 16384 up reads below the table rather than above it, and neither
 * routine tests for that or for the table being there at all — both cases are
 * memory this port does not model, and both answer 0.
 *
 * The shift is arithmetic on a register whose high half the routine never
 * wrote. Taken as zero here, which makes it a logical shift and costs the
 * result its sign.
 */
function trigWord(st: TheGameState, index: number, from: number): number {
  const disp = ((index << 1) & 0xffff) << 16 >> 16
  const at = from + (disp >> 1)
  const word = st.trig && at >= 0 && at < st.trig.length ? st.trig[at]! : 0
  return (word & 0xffff) >> 8
}

export function makeTheGameInstructions(rt: Runtime): Record<string, Instr> {
  const st = (): TheGameState => rt.thegame

  return {
    /**
     * Routine 4 ($1682) — `G Reboot`. *"Reboot the system"*.
     *
     * `movea.l $4.w,a6 / jsr -$2d6(a6) / rts`: `ColdReboot`, with no check
     * that the machine has one. `../amiga/machine.ts` catalogues it beside
     * every other extension's reboot keyword and answers for what a cold
     * reboot means here.
     */
    'g reboot': () => {
      rt.machine.requestReset('cold', 'g reboot')
    },

    /**
     * Routine 13 ($188e) — `G Wait Lmb`. *"Waits for lmb press, all amal and
     * stuff will still work."*
     *
     *     Rjsr L_Tests / movea.l $1c8(a5),a0 / movea.l $12c(a3),a0
     *     tst.l a0 / beq / Rbsr routine 53 (g update)
     *     btst.b #$6,$bfe001 / bne -> loop
     *
     * `L_Tests` is what the guide's *"all amal and stuff"* means — AMOS's own
     * per-pass work, which is why the loop does not freeze the interpreter.
     * The `G Update` is guarded on block +$12c, which is `dpkernel.library`'s
     * BASE — `G Init Gms` writes it there from `OpenLibrary`, routine 90
     * ($2fce) — so the test is whether GMS was ever started, not whether a
     * screen is open. `G Wait Rmb` has no such test.
     */
    'g wait lmb': (it) => {
      if ((rt.input.mouseK & 1) !== 0) return
      // rewind, so the statement re-runs and tests bit 6 again -- the loop is
      // the keyword's, exactly as it is on the machine
      it.block({ type: 'waitInput', mouse: true, key: false }, true)
    },

    /**
     * Routine 14 ($18b2) — `G Wait Rmb`, and the guide's *"Nopes:"* for
     * "Notes:".
     *
     * Bit 10 of POTINP at `$dff016` is the right button, and the `G Update` in
     * this loop is NOT guarded on a screen the way `G Wait Lmb`'s is.
     */
    'g wait rmb': (it) => {
      if ((rt.input.mouseK & 2) !== 0) return
      it.block({ type: 'waitInput', mouse: true, key: false }, true)
    },

    /**
     * Routine 80 ($2bce) — `G Set Mouse X,Y`, and the guide leaves both
     * argument descriptions blank and says *"DONT USE"*.
     *
     * The two overlapping longs are reproduced exactly; see the catalogue.
     * Arguments pop right to left, so d0 is Y and d1 is X, and the stores go
     * `d0 -> $b34` then `d1 -> $b32` over four bytes each.
     */
    'g set mouse': (it) => {
      const s = st()
      const x = it.evalInt()
      it.expect(',')
      const y = it.evalInt()
      // $b32..$b35 as the machine leaves them: the y store first, then the x
      // store landing its low word on top of the y field
      const bytes = new Uint8Array(6)
      const put32 = (at: number, v: number): void => {
        bytes[at] = (v >>> 24) & 0xff
        bytes[at + 1] = (v >>> 16) & 0xff
        bytes[at + 2] = (v >>> 8) & 0xff
        bytes[at + 3] = v & 0xff
      }
      put32(2, y) // move.l d0,$b34(a0)
      put32(0, x) // move.l d1,$b32(a0)
      s.mouseX = ((bytes[0]! << 8) | bytes[1]!) & 0xffff
      s.mouseY = ((bytes[2]! << 8) | bytes[3]!) & 0xffff
    },

    /**
     * Routine 28 ($1cee) — `G Init Encyrpt`, the table's own misspelling and
     * the one that has to stay, being what a program tokenises against. The
     * guide has no node for it.
     *
     *     moveq #$9,d0 / bset.b #$0,d1 / move.l #$186a0,d2
     *     lea $bb6(a3),a0 / Rjsr L_Bnk_Reserve
     *
     * A hundred thousand bytes in bank 9, named `TGE   En`, and the result is
     * never tested. It is also pointless: `G Encrypt` reserves the bank it
     * was given whatever this did, and `Bnk_Reserve` frees an existing bank of
     * that number first — so the only lasting effect of calling this is a
     * 100,000-byte bank 9 that stays until something else takes it.
     *
     * DEFECT: `bset.b #$0,d1` on a register nothing here initialises. Bit 0 is
     * `Bnk_BitData`, so the bank is at least a Data one, but every other flag
     * bit is whatever the interpreter last left in d1. `G Encrypt` does the
     * same `bset` sixteen bytes before a `moveq #$1,d1` that overwrites it, so
     * the author had the idiom and used it once by accident and once for
     * real. Reserved as a Data bank here, which is the reading with bit 0 set
     * and nothing else.
     */
    'g init encyrpt': () => {
      rt.reserveBank(9, 100_000, TGE_ENCRYPT_BANK_NAME)
    },

    /**
     * Routine 26 ($19d6) — `G Encrypt FILE$,BANK,PASSWORD$`, which is exactly
     * the guide's *"G Encyrpt File$,Bank,Password$"* under a misspelled node
     * name. It crunches a file with StoneCracker, puts it in a bank, and
     * scrambles four words of the result with the password.
     *
     * The steps, and every failure arm, from the routine:
     *
     *     checksum the password           -> block +$b2a
     *     AllocMem($3e8, MEMF_CLEAR)      a FileInfoBlock; error 24 if it fails
     *     Lock(file, SHARED) / Examine / UnLock          error 81 if it fails
     *     OpenLibrary("stc.library", 0)   -> +$c8; error 1 if it fails
     *     stc -$2a                        a work buffer; silent exit if none
     *     stc -$6c(file, fib_Size + $100) the file buffer, error 81 if none
     *     stc -$48                        read it; silent exit on zero
     *     stc -$60(the tag list at +$138) crunch; silent exit on zero
     *     Bnk_Reserve(BANK, Data, len, "TGE   En")       silent exit on zero
     *     CopyMem / stc -$30 / stc -$42   and then the scramble
     *
     * The tag list is a static one in the data block and only three of its
     * five values are ever written: the source at +$13c, the length at +$144
     * and the work buffer at +$15c. The other two are `$80000004 = 0` and
     * `$80000009 = 12`, and the twelve is the offset width — a 4,640-byte
     * window. See ../amiga/stonecracker.ts.
     *
     * The errors are AMOS's numbers used as if they were the author's: 24 is
     * *"Out of memory"* and apt, 81 is *"File format not recognised"* for a
     * file that could not be locked, and 1 is *"RETURN without GOSUB"* for a
     * missing `stc.library`. All three go through `G Exit`, which does a
     * `G Reset` on the way.
     *
     * DEFECT: `OpenLibrary` is called on every invocation and the base stored
     * over the last one, so `stc.library` is opened as many times as this is
     * called and closed at most once — the same defect as `G Ptload`, and
     * `G Decrypt` next door tests the base first.
     * DEFECT: the FileInfoBlock is never freed, on any path.
     * DEFECT: the scramble writes at `bank + 16 + <a byte of the checksum>`,
     * up to `bank + 272`, with no test that the bank is that long. A password
     * whose checksum's low byte is large, over a file that crunches to less
     * than 272 bytes, writes past the bank.
     */
    'g encrypt': (it) => {
      const s = st()
      const file = it.evalStr()
      it.expect(',')
      const bank = it.evalInt()
      it.expect(',')
      s.keySum = keyChecksum(it.evalStr())

      s.fibLeak += 1000
      const data = rt.vfs?.readFile(file) ?? rt.fs?.read(file) ?? null
      if (!data) throw new AmosError(ED_RUN_MESSAGES[81]!, 81)
      s.stcOpens++
      s.stcBase = 1
      const packed = stcCrunch(data)
      rt.reserveBank(bank, packed.length, TGE_ENCRYPT_BANK_NAME)
      const bytes = rt.memBanks.get(bank)!.data
      bytes.set(packed)
      addMagic(bytes, ENCRYPT_MAGIC)
      swapKeyWords(bytes, s.keySum, true)
      // `move.l #$0,(a1)` — the checksum is wiped once it has been used
      s.keySum = 0
    },

    /**
     * Routine 27 ($1bee) — `G Decrypt SOURCE To DEST,PASSWORD$`.
     *
     * The guide's synopsis is *"G Decyrpt sourcebank to destbank"*, with no
     * password at all; the token spec is `I0t0,2` and the routine pops a
     * string, so the guide is a parameter short.
     *
     * It undoes the scramble IN THE SOURCE BANK, reads the decrunched length
     * out of the StoneCracker header at +$8, reserves the destination for
     * exactly that, and calls stc's decruncher.
     *
     * DEFECT: the source bank is left decrypted. Nothing puts the magic or
     * the words back, so a second `G Decrypt` of the same bank subtracts the
     * magic from a longword that no longer has it and hands the decruncher a
     * header it will not recognise.
     * DEFECT: `Bnk_GetAdr` is not tested, so decrypting a bank that does not
     * exist scrambles whatever is at address zero.
     * DEFECT: the `OpenLibrary` arm is `tst.l d0` with NO branch after it —
     * the compare is written and the result thrown away — so a machine
     * without `stc.library` reaches `jsr -$24(a6)` through a zero base.
     */
    'g decrypt': (it) => {
      const s = st()
      const from = it.evalInt()
      it.expect('to')
      const to = it.evalInt()
      it.expect(',')
      s.keySum = keyChecksum(it.evalStr())
      if (s.stcBase === 0) {
        s.stcOpens++
        s.stcBase = 1
      }
      const src = missingBank(rt, from)
      addMagic(src.data, -ENCRYPT_MAGIC)
      swapKeyWords(src.data, s.keySum, false)
      const out = stcDecrunch(src.data)
      // `move.l $8(a1),d2` is the reserve size, and it is the crunched
      // header's own decrunched length -- so a wrong password reserves a
      // bank of whatever the scrambled bytes happen to say
      const size = ((src.data[8]! << 24) | (src.data[9]! << 16) | (src.data[10]! << 8) | src.data[11]!) >>> 0
      // a zero or negative length is AMOS's own "Illegal function call" from
      // inside Bnk_Reserve, which is where a wrong password usually lands
      rt.reserveBank(to, size, TGE_ENCRYPT_BANK_NAME)
      if (out) rt.memBanks.get(to)!.data.set(out.subarray(0, size))
    },

    /**
     * Routine 8 ($16d4) — `G Close Req`. The guide says *"Removed"*, and it is
     * half right: the OPENER went and this was left behind.
     *
     *     movea.l $c(a3),a1 / jsr -$19e(a6) / moveq #$0,d2 / rts
     *
     * `CloseLibrary` on the base at block +$0c, and no instruction anywhere in
     * the code hunk writes that longword — the name `"req.library"` is still
     * at +$10 with nothing referring to it either. So this closes a library
     * nobody opened, every time, and the base it passes is always zero.
     *
     * The trailing `moveq #$0,d2` sets the TYPE register in an INSTRUCTION,
     * where nothing reads it; the two reqtools keywords do the same.
     */
    'g close req': () => {
      // exec tolerates a null base and there is nothing here to release
      closeLibrary(0)
    },

    /**
     * Routine 10 ($1722) — `G Close Reqtools`. *"Removed"* in the guide and
     * not removed at all.
     *
     * `CloseLibrary` on the base at +$1c, which `=G Open Reqtools` really does
     * write.
     *
     * DEFECT: +$1c is not cleared, so a second `G Close Reqtools` closes the
     * same base again — and a third, and a fourth. On a machine that is a
     * library's open count driven below zero and eventually an expunge of a
     * library somebody else is using.
     */
    'g close reqtools': () => {
      const s = st()
      if (s.reqtoolsBase !== 0) s.reqtoolsCloses++
      closeLibrary(s.reqtoolsBase)
    },

    /**
     * Routine 98 ($35be) — `G Stc Pack FILE$,BANK`. Undocumented: the guide
     * has no node for either packer, and mentions `stc.library` only as
     * something the installer will put in `LIBS:`.
     *
     * The same 392 bytes as `G Encrypt` with the password and the scramble
     * taken out — the FileInfoBlock, the lock, the library, the work buffer,
     * the file buffer, the crunch through the tag list at +$138, the reserve
     * and the copy — so the bank it leaves is a plain `S404` file that
     * `G Stc Unpack` and stc.library both read. See ../amiga/stonecracker.ts.
     *
     * DEFECT: the copy length is wrong. `Bnk_Reserve` is given d4, the
     * CRUNCHED length, and `CopyMem` is then given d6, the length of the file
     * that was read:
     *
     *     move.l d4,d2 / Rjsr L_Bnk_Reserve      the crunched length
     *     movea.l $4(a0),a0 / move.l d6,d0
     *     movea.l $4.w,a6 / jsr -$270(a6)        the file's length
     *
     * `G Encrypt` has `move.l d4,d0` in the same place and is right. So for
     * anything that actually crunches, this writes past the end of the bank
     * by the difference — and for anything that does NOT crunch, which the
     * format's nine-bits-a-byte literals make easy, the copy is SHORT and the
     * bank keeps a truncated file that will not unpack. The overrun is
     * contained here and the truncation is reproduced, both being what this
     * port can honestly do with a write past an allocation.
     *
     * DEFECT: the FileInfoBlock is never freed, and `stc.library` is opened
     * on every call, both as in `G Encrypt`.
     *
     * The error numbers differ from `G Encrypt`'s for the same conditions: a
     * lock that fails is `Rbeq routine 59` with d0 still zero, and `G Exit`
     * turns a zero into 16 — *"Illegal user function call"* — where
     * `G Encrypt` says 81; and a missing `stc.library` is `moveq #$2,d0`,
     * *"POP without GOSUB"*, where `G Encrypt` says 1.
     */
    'g stc pack': (it) => {
      const s = st()
      const file = it.evalStr()
      it.expect(',')
      const bank = it.evalInt()
      s.fibLeak += 1000
      const data = rt.vfs?.readFile(file) ?? rt.fs?.read(file) ?? null
      if (!data) throw new AmosError(ED_RUN_MESSAGES[16]!, 16)
      s.stcOpens++
      s.stcBase = 1
      const packed = stcCrunch(data)
      rt.reserveBank(bank, packed.length, TGE_ENCRYPT_BANK_NAME)
      // the copy takes the FILE's length, not the crunched one
      rt.memBanks.get(bank)!.data.set(packed.subarray(0, Math.min(data.length, packed.length)))
    },

    /**
     * Routine 99 ($3746) — `G Stc Unpack SOURCE,DEST`. Undocumented as well.
     *
     * `Bnk_GetAdr` the source, take the decrunched length out of the
     * StoneCracker header at +$8, reserve the destination for exactly that
     * under `TGE   En`, and decrunch. It is `G Decrypt` without the password,
     * and where `G Decrypt`'s source has to be scrambled this one's is a
     * plain `S404` file.
     *
     * DEFECT: the routine opens with `G Decrypt`'s password checksum —
     * `move.w (a1),d1 / add.b (a1,d1.w),d4 / dbra d1` — and it has no
     * password. Its spec is `I0,0` and it pops two integers, so `a1` is
     * whatever the interpreter last left there; the loop reads a word from it
     * as a length and then that many bytes. The result goes into d4 and d4 is
     * never used again. A copy-and-paste left running over a stale pointer,
     * and nothing here can reproduce reading through one.
     *
     * DEFECT: `Bnk_GetAdr` is not tested, and the `OpenLibrary` arm is the
     * same `tst.l d0` with no branch that `G Decrypt` has.
     */
    'g stc unpack': (it) => {
      const s = st()
      const from = it.evalInt()
      it.expect(',')
      const to = it.evalInt()
      if (s.stcBase === 0) {
        s.stcOpens++
        s.stcBase = 1
      }
      const src = missingBank(rt, from)
      const d = src.data
      const size = ((d[8]! << 24) | (d[9]! << 16) | (d[10]! << 8) | d[11]!) >>> 0
      rt.reserveBank(to, size, TGE_ENCRYPT_BANK_NAME)
      const out = stcDecrunch(d)
      if (out) rt.memBanks.get(to)!.data.set(out.subarray(0, size))
    },

    /**
     * Routine 94 ($31bc) — `G Set Table N`. Undocumented: the guide has no
     * node for it, and `=Gsin` and `=Gcos` are useless without it.
     *
     * N is the number of steps in a quarter turn, so `G Set Table 90` is the
     * degrees the `=Gcos` node means by *"The angle to use in degrees."* The
     * routine frees the last table, allocates 10N bytes, points +$bce at the
     * start and +$bd2 2N bytes in, and fills it.
     *
     *     move.l $bd6(a3),d0 / tst.l d0 / beq / movea.l $bce(a3),a1 / FreeMem
     *     move.l d7,d6 / asl.w #$1,d7 / move.l d7,d0
     *     tst.l d0 / bne / move.l #$b4,d0
     *     move.l d0,d7 / mulu.l #$4,d1 / add.l d1,d0 / move.l d0,$bd6(a3)
     *     AllocMem(d0, MEMF_CLEAR) / tst.l d0 / beq
     *     move.l d0,$bce(a3) / add.l d7,d0 / move.l d0,$bd2(a3)
     *
     * Three things fall out of that and all three are reproduced: the doubling
     * is a WORD shift while the size is a long, so a count of 32768 or more
     * wraps; the default of 180 reaches the size and not the fill, so a count
     * of zero divides by zero; and the free happens before the allocation, so
     * a failed allocation leaves both pointers dangling.
     */
    'g set table': (it) => {
      const s = st()
      const n = it.evalInt()
      // asl.w #$1,d7 on a long register: the high half is untouched
      const doubled = (n & ~0xffff) | ((n << 1) & 0xffff)
      const size = Math.imul(doubled === 0 ? 180 : doubled, 5)
      const cosBytes = doubled === 0 ? 180 : doubled
      s.trigBytes = size
      // AllocMem answers zero for a size the machine has not got, and a
      // negative count arrives here as one
      if (size <= 0 || size > rt.chipFree() + rt.fastFree()) return
      const table = new Int16Array(size >> 1)
      fillTrig(table, n)
      s.trig = table
      s.cosAt = cosBytes >> 1
    },

    /**
     * Routine 88 ($2eec) — `G Handicap`.
     *
     * `FindTask(NULL)` into block +$b36, then `SetTaskPri` with `move.l
     * #$80,d0` and the old priority into +$b3a. SetTaskPri takes a SIGNED
     * byte, so $80 is -128 and the guide's *"Gives Amos a priority of 256!
     * ... thus speeding up your code"* is backwards in both halves — see the
     * catalogue.
     *
     * There is no scheduler here to apply a priority to, so the value is
     * recorded and nothing else happens, which is what ../runtime/turbo.ts
     * does with `Multi No`.
     */
    'g handicap': () => {
      const s = st()
      s.savedPriority = s.priority
      s.priority = -128
      s.handicapped = true
    },

    /**
     * Routine 89 ($2f18) — `G Unhandicap`. *"Removes the system restrictions
     * brought abut by the G Handicap command."*
     *
     * `SetTaskPri` again, with the task and the priority read straight back
     * out of +$b36 and +$b3a and neither of them tested. Called on its own
     * that is a null task pointer, which is the catalogue's; called after two
     * `G Handicap`s it restores the handicap, because the second one saved it.
     */
    'g unhandicap': () => {
      const s = st()
      if (!s.handicapped) {
        // SetTaskPri(NULL, 0) writes through a null pointer on the machine;
        // there is nothing to write through here
        return
      }
      s.priority = s.savedPriority
    },

    /**
     * Routine 61 ($24d8) and its three-argument variant routine 71 ($28c8) —
     * `G Iconify TITLE$,ICON$` and `G Iconify TITLE$,ICON$,MULTI`. *"puts a
     * icon on WB, and waits for the user to Double-Click before returning"*,
     * against *"Puts a Icon on WB, and returns straight away"* for the second.
     *
     * The routine opens `icon.library` (name at block +$94, base at +$a2) and
     * then `workbench.library` (name at +$a6, base at +$b8), and if the SECOND
     * open fails it closes the first and returns having done nothing:
     *
     *     lea $a6(a3),a1 / OpenLibrary -> $b8(a3)
     *     tst.l d0 / bne -> the work
     *     movea.l $a2(a3),a1 / CloseLibrary / bra exit
     *
     * That is the arm every call takes here. This port has no
     * `workbench.library` — the same wall GameSupport's `Gsiconify` meets —
     * and nothing is faked past it: there is no AppIcon to add, no message
     * port to wait on, and `=G Icon Check` therefore answers 0 for ever.
     *
     * Both arguments are still evaluated, because the machine pops them before
     * it reaches the failure test.
     */
    'g iconify': (it) => {
      it.evalStr()
      it.expect(',')
      it.evalStr()
      if (it.accept(',')) it.evalInt()
      // workbench.library is not modelled, so the open fails and the routine
      // closes icon.library and leaves
      st().iconUp = false
    },

    /**
     * Routine 15 ($18ca) — `G Ptload NAME$`. *"Loads a protracker module."*
     *
     * `adda.w #2,a0` first, because an AMOS string is its length word and then
     * its bytes, and ptreplay wants a plain filename.
     *
     * Three defects live in these seven instructions and all three are
     * reproduced: the library is opened again on every call, the open is not
     * checked, and any module already loaded is dropped without being
     * unloaded. See the catalogue above.
     */
    'g ptload': (it) => {
      const s = st()
      const name = it.evalStr()
      s.ptOpens++
      s.ptBase = 1
      const data = rt.vfs?.readFile(name) ?? rt.fs?.read(name) ?? null
      const song = data ? parseMod(data) : null
      // LoadModule answers zero for a file it cannot read, and the handle is
      // stored either way -- there is no test on it here
      s.module = song ? PT_HANDLE : 0
      s.song = song
      s.paused = false
      s.fadeRate = 0
      s.fadeCount = 0
    },

    /**
     * Routine 16 ($1918) — `G Ptplay`. *"Plays the mod that you've loaded"*.
     *
     * No guard on either the base or the handle, unlike `G Ptstop`. ptreplay
     * $3a6 null-checks the handle itself, so a play with nothing loaded is
     * quiet rather than fatal — but the base is not checked by anybody.
     *
     * The volume goes to 57 here, not to full and not to whatever `G Ptvolume`
     * last set.
     */
    'g ptplay': () => {
      const s = st()
      if (!s.song) return
      s.replay.load(s.song)
      s.replay.master = PT_PLAY_VOLUME
      s.replay.fadeTo = PT_PLAY_VOLUME
      s.replay.playing = true
      s.paused = false
      s.fadeRate = 0
      s.fadeCount = 0
    },

    /**
     * Routine 17 ($1934) — `G Ptstop`. *"Stops the playing protracker module
     * playing."*
     *
     * StopModule and then UnLoadModule, guarded on the base and the handle
     * both. The handle is not cleared afterwards, which is the defect: the
     * guards below still pass and the module is gone.
     */
    'g ptstop': () => {
      const s = st()
      if (!live(s)) return
      s.replay.stop()
      s.replay.song = null
      s.song = null
      s.paused = false
      s.fadeRate = 0
    },

    /**
     * Routine 18 ($1962) — `G Ptfade RATE`.
     *
     * The guide calls the argument a time in seconds and it is a rate; a rate
     * of zero is StopModule. See the header.
     */
    'g ptfade': (it) => {
      const s = st()
      const rate = it.evalInt() & 0xff
      if (!live(s)) return
      if (rate === 0) {
        s.replay.stop()
        s.replay.song = null
        s.song = null
        s.paused = false
        s.fadeRate = 0
        return
      }
      s.fadeRate = rate
      s.fadeCount = rate
      // ptreplay's fade IS Protracker's, step for step -- master toward the
      // target by one every `rate` ticks -- so the shared machinery runs it
      s.replay.fadeTo = 0
      s.replay.fadeSpeed = rate
      s.replay.fadeCount = rate
    },

    /** Routine 19 ($197e) — `G Ptpause`. *"Pauses at current position"*, handle +$0c */
    'g ptpause': () => {
      const s = st()
      if (!live(s)) return
      s.paused = true
      s.replay.forget()
      for (let v = 0; v < 4; v++) rt.host.audio?.stop(v)
    },

    /**
     * Routine 20 ($1998) — `G Ptunpause`.
     *
     * ptreplay $528 clears the pause word and does nothing else — it does not
     * check that anything is playing, so this un-pauses a module that was
     * never paused just as happily.
     */
    'g ptunpause': () => {
      const s = st()
      if (!live(s)) return
      s.paused = false
    },

    /**
     * Routine 21 ($19b2) — `G Ptvolume LEVEL`. *"Sound volume/level from
     * 0-63"*, which is the guide's range and not the library's: ptreplay $59e
     * stores the word with no clamp at all, and its own PlayModule uses 57.
     */
    'g ptvolume': (it) => {
      const s = st()
      const v = it.evalInt()
      if (!live(s)) return
      s.replay.master = v < 0 ? 0 : v > 64 ? 64 : v
      // ptreplay writes the volume word and leaves the fade bytes counting, so
      // a fade in flight carries on from the new level; with no fade running
      // the target has to follow, or Protracker's own pass drifts it back
      if (s.fadeRate === 0) s.replay.fadeTo = s.replay.master
    },

    /**
     * Routine 73 ($2ae4) — `G Ptchan On MASK`. *"Turns on the channels
     * specified ... Channel numbers in bitmap form"*, bit 0 first.
     *
     * ptreplay $6ea ANDs the mask with the channels it can have — $884 walks
     * four audio nodes and takes the ones whose type word is 13 — before
     * touching anything. There is no `audio.device` arbitration here and no
     * other task to lose a channel to, so all four are always available.
     */
    'g ptchan on': (it) => {
      const s = st()
      const mask = it.evalInt() & 0xf
      if (!live(s)) return
      s.replay.voices |= mask
    },

    /** Routine 74 ($2b00) — `G Ptchan Off MASK`, the same mask the other way */
    'g ptchan off': (it) => {
      const s = st()
      const mask = it.evalInt() & 0xf
      if (!live(s)) return
      s.replay.voices &= ~mask & 0xf
      for (let v = 0; v < 4; v++) if (mask & (1 << v)) rt.host.audio?.stop(v)
    },

    /**
     * Routine 75 ($2b1c) — `G Ptset Pos POSITION`.
     *
     * The guide gives up on this one — *"set the position of the player"* and
     * then *"jono not done. Pac, position meaning the pattern to continue
     * from?"*, the two authors' note to each other left in the shipped file.
     * ptreplay $7fe answers it: `move.b d0,-$c(a0)`, the song position, the
     * same byte `G Ptpos` reads back.
     *
     * DEVIATION: ptreplay writes the byte raw, with no test against the song's
     * length, and lets the interrupt find it. `Protracker.setPosition` sends a
     * position past the end back to 0, so the two differ for an out-of-range
     * argument.
     */
    'g ptset pos': (it) => {
      const s = st()
      const pos = it.evalInt() & 0xff
      if (!live(s)) return
      s.replay.setPosition(pos)
    },

    // ---- the GMS display ----
    /**
     * Routine 39 ($1d2a) — `G Screen Open N,X,Y,C,M`. *"Opens a screen in
     * front of the amigas current display. Virtually identical to the normal
     * AMOS command except it works in ECS,AGA and RTG."*
     *
     * The longest routine in the batch and the one everything else needs. In
     * order: send AMOS's display to the back, start GMS if it is not already
     * up (`Rbsr` straight into routine 90, so `G Init Gms` is not a
     * prerequisite for this one), normalise the mode, throw away any screen
     * already at N, copy the tag template, patch four of its values, `Init`
     * it and `Show` the result. The X argument never survives to be patched
     * in; see the catalogue.
     *
     * The `C` argument is the Bitmap's `AmtColours`, reached through the
     * template's TSTEPIN tag, and the extra store next to it — `movea.l
     * $3c(a0),a1 / move.l d3,$4(a1)` — writes the same count into the second
     * longword of a palette, which is `RGBPalette`'s own colour count. The
     * template ships that pointer null, so it only fires for a screen whose
     * palette a previous keyword installed.
     */
    'g screen open'(it) {
      const s = st()
      const n = it.evalInt()
      it.expect(',')
      it.evalInt() // X: popped into d1 and overwritten before it is used
      it.expect(',')
      const y = it.evalInt()
      it.expect(',')
      const colours = it.evalInt()
      it.expect(',')
      const mode = gmsScreenMode(it.evalInt())

      // AMOS_WB(0) then `Rbsr` into routine 90, in that order
      rt.amosToBack()
      gmsInit(s)
      const slot = gmsSlot(n)
      // Free() + FreeMem() + table[N] = 0 before anything is allocated
      if (rt.screens.has(slot)) rt.closeScreen(slot)

      // a zeroed tag takes the user default, which is what makes the lost X
      // look like it works: GMSPrefs ships 320
      const sc = new Screen(
        slot,
        GMS_DEFAULT_WIDTH,
        (y & 0xffff) || GMS_DEFAULT_HEIGHT,
        colours || GMS_DEFAULT_COLOURS,
        amosMode(mode),
      )
      sc.displayX = GMS_TOP_OF_SCREEN_X
      sc.displayY = GMS_TOP_OF_SCREEN_Y
      // BMA_Palette is a POINTER tag, so a G Def Palette before this shares
      // one array with every screen opened after it. The store the routine
      // makes through it -- `movea.l $3c(a0),a1 / move.l d3,$4(a1)` -- is
      // RGBPalette's AmtColours, and there is no header on this side to hold
      if (s.gmsDefPalette) sc.palette = s.gmsDefPalette
      rt.screens.set(slot, sc)
      // Show(): in front, and AMOS is already behind
      rt.order = rt.order.filter((i) => i !== slot)
      rt.order.push(slot)
      s.gmsCurrent = n
      s.gmsScreen = sc
    },

    /**
     * Routine 40 ($1ed4) — `G Screen Close N`. *"Closes the specified TGE
     * screen."*
     *
     * `Free()` on the Screen, `FreeMem()` on the 200-byte tag list, and the
     * table entry cleared. What it does with a screen that is not open, and
     * what it leaves behind afterwards, are both in the catalogue.
     */
    'g screen close'(it) {
      const slot = gmsSlot(it.evalInt())
      if (!rt.screens.has(slot)) return
      rt.closeScreen(slot)
    },

    /**
     * Routine 49 ($217a) — `G Screen Hide N`. *"Hides the specified TGE
     * screen (As with the amos command)."*
     *
     * `Hide(Screen)`, guarded by `cmp.l #$ffffffff,d0` — the only screen
     * number any of these twenty tests, and the sentinel `Screen Hide`'s own
     * optional argument uses.
     */
    'g screen hide'(it) {
      const n = it.evalInt()
      if (n === -1) return
      const sc = rt.screens.get(gmsSlot(n))
      if (sc) sc.visible = false
    },

    /**
     * Routine 50 ($21be) — `G Screen Show N`. *"Shows the specified
     * (previously hidden) TGE screen (As with the amos command)."*
     *
     * `Show(Screen)`, and no -1 guard this time.
     */
    'g screen show'(it) {
      const sc = rt.screens.get(gmsSlot(it.evalInt()))
      if (sc) sc.visible = true
    },

    /**
     * Routine 92 ($30fe) — `G Screen N`, which the guide has no node for.
     *
     * AMOS's `Screen` for the game display: it writes the number to +$195 and
     * the Screen and its Bitmap to +$1be and +$1c2, which is where every
     * drawing keyword in the extension starts. Nothing else, and no check
     * that the screen exists.
     */
    'g screen'(it) {
      const s = st()
      const n = it.evalInt()
      s.gmsCurrent = n
      s.gmsScreen = rt.screens.get(gmsSlot(n)) ?? null
    },

    /**
     * Routine 93 ($3132) — `G Screen Copy SRC,DST`. *"Copies the Source
     * screen to the Detination screen."*
     *
     * Three calls, of which the first does nothing. `CopyStructure()` is
     * documented as writing *"Only the NULL fields in the Destination
     * structure"* and warns that on an initialised destination *"you may find
     * that CopyStructure() has no effect due to this condition"* — both
     * screens here are initialised, so it is the palette store and the image
     * copy that do the work. The palette store is a pointer assignment and is
     * in the catalogue; `UpdatePalette()` then pushes the shared palette at
     * the destination's copper list.
     *
     * DEVIATION: `Copy()` on two Bitmaps *"features automatic clipping and
     * remapping"*, and `Screen.copyBuf` clips but does not remap. After the
     * palette store the two screens have the same palette, so the indices
     * mean the same thing in both and there is nothing to remap; a copy
     * between different depths still loses the indices the destination cannot
     * hold, which is what the planar encode does with them anyway.
     */
    'g screen copy'(it) {
      const src = rt.screens.get(gmsSlot(it.evalInt()))
      it.expect(',')
      const dst = rt.screens.get(gmsSlot(it.evalInt()))
      if (!src || !dst) return
      Screen.copyBuf(
        src,
        src.bufferFor('logic'),
        0,
        0,
        src.width,
        src.height,
        dst,
        dst.bufferFor('logic', true),
        0,
        0,
      )
      // move.l $38(a0),d5 / move.l d5,$38(a1): the Bitmap's Palette POINTER
      dst.palette = src.palette
    },

    /**
     * Routine 103 ($3bec) — `G Screen Offset N,X,Y`. *"Used to change the
     * position of the first pixel displayed on the screen ... The X and Y
     * offsets are HARDWARE, coordinates."*
     *
     * `SetScrOffsets(Screen a0, ScrXOffset d0, ScrYOffset d1)`, which moves
     * the whole screen on the monitor rather than the bitmap inside it — so
     * the guide's description belongs to the keyword below and its last
     * sentence belongs to this one. GMS measures from the display's top left,
     * *"An offset of (0X,0Y) positions the Screen at the top left"*, and
     * TopOfScr is where that is.
     */
    'g screen offset'(it) {
      const sc = rt.screens.get(gmsSlot(it.evalInt()))
      it.expect(',')
      const x = it.evalInt()
      it.expect(',')
      const y = it.evalInt()
      if (!sc) return
      sc.displayX = GMS_TOP_OF_SCREEN_X + ((x << 16) >> 16)
      sc.displayY = GMS_TOP_OF_SCREEN_Y + ((y << 16) >> 16)
    },

    /**
     * Routine 104 ($3c20) — `G Bitmap Offset N,X,Y`, which the guide has no
     * node for.
     *
     * `SetBmpOffsets(Screen a0, BmpXOffset d0, BmpYOffset d1)`: *"Moving the
     * Bitmap to any position on the display, and for Hardware Scrolling."*
     * This is AMOS's `Screen Offset` — which part of a bitmap bigger than the
     * viewport is shown — and the routine is `G Screen Offset` with one LVO
     * changed.
     *
     * DEVIATION: GMS requires `SCR_HSCROLL`/`SCR_VSCROLL` in the screen's
     * Attrib for this to be legal, and TGE's template sets neither and has no
     * keyword that would. Whether the shipped module refuses or scrolls
     * anyway is not readable from the autodoc, and the port scrolls.
     */
    'g bitmap offset'(it) {
      const sc = rt.screens.get(gmsSlot(it.evalInt()))
      it.expect(',')
      const x = it.evalInt()
      it.expect(',')
      const y = it.evalInt()
      if (!sc) return
      sc.offsetX = (x << 16) >> 16
      sc.offsetY = (y << 16) >> 16
    },

    /**
     * Routine 123 ($4168) — `G Double Buffer`. *"Used before G Screen Open,
     * causes a double buffer to be set up."*
     *
     * It does not. Four instructions, two of them wrong; see the catalogue.
     * A no-op here because a no-op is what it is — the address it computes is
     * not one this port has, and the constant it stores is not one GMS reads
     * at that offset.
     */
    'g double buffer': () => {},

    /** Routine 125 ($4194) — `G Triple Buffer`, the same four instructions */
    'g triple buffer': () => {},

    /**
     * Routine 124 ($417a) — `G Swap Buffers`. *"Cycles between the buffers in
     * a Double or Triple buffered screen."*
     *
     * `SwapBuffers(Screen)` on the current screen, and that one really is the
     * right call in the right register. It has nothing to do, because the two
     * keywords that would have asked for a second buffer cannot: *"If the
     * screen is double buffered, this function swaps Screen->MemPtr1 with
     * Screen->MemPtr2"*, and no TGE screen ever is.
     */
    'g swap buffers': () => {},

    /**
     * Routine 53 ($224a) — `G Update`. *"Waits for a vbl, and also checks for
     * an Amiga+M keypress (ie. allows the screen to multitask!)."*
     *
     * `WaitAVBL()`, and for once the guide is exactly right about a GMS call
     * it never names: *"This version of WaitVBL() will automatically pause
     * your Task if the user moves the focus to a different program."* The
     * plain `WaitVBL()` sits two entries along and does not.
     */
    'g update': (it) => {
      it.block({ type: 'wait', until: Math.floor(it.tick) + 1 })
    },

    /**
     * Routine 54 ($2260) — `G Getscr`, which the guide has no node for.
     *
     * Nothing. It is in the catalogue for why: no arguments, no result, and a
     * screen lookup through a register it never loads.
     */
    'g getscr': () => {},

    // ---- the palette ----
    /**
     * Routine 7 ($16b8) — `G Ink C`. *"Changes the current ink colour for use
     * with the G Circle and G Rectangle commands."*
     *
     * `SetRGBPen(Bitmap a0, RGB d0)` in blitter.mod, on the current Bitmap.
     *
     * DEFECT: the guide says the argument is *"The number (not $RRGGBB value)
     * of the colour to use."* and it is the $RRGGBB value. GMS has no
     * pen-by-index call to have meant instead — `SetRGBPen` is the only pen
     * setter in the module, and its autodoc is *"LONG SetRGBPen(*Bitmap [a0],
     * LONG RGB [d0])"*. Whoever wrote the node was describing AMOS's `Ink`.
     */
    'g ink'(it) {
      const s = st()
      const rgb = it.evalInt() >>> 0
      if (s.gmsScreen) s.gmsPen.set(s.gmsScreen, rgb)
    },

    /**
     * Routine 67 ($274e) — `G Palette First,C1..C8`. *"Sets the palette in
     * the format of: First -> The first colour of the palette to change.
     * Colour1 -> The $RRGGBB value that the `first' colour is set to."*
     *
     * `AllocMem(100)`, the eight colours written into it, then
     * `ChangeColours(Screen a0, Colours a1, StartColour d0, AmtColours d1)`
     * with d1 = 8, `UpdatePalette` and `FreeMem`. The buffer is a bare array
     * of 24-bit longs and not an `RGBPalette` — the autodoc's own example is
     * `Palette = { 0xffffff, 0xff0000, 0x00ff00, 0x0000ff }` — so the
     * headerless 100 bytes are right.
     *
     * DEFECT: the eight colours go in backwards; see the catalogue.
     */
    'g palette'(it) {
      const s = st()
      const first = it.evalInt()
      const cols: number[] = []
      for (let i = 0; i < 8; i++) {
        it.expect(',')
        cols.push(it.evalInt())
      }
      const sc = s.gmsScreen
      if (!sc) return
      // the buffer is filled from d0 up with pops that run right to left, so
      // it holds C8..C1, and ChangeColours reads it forwards
      cols.reverse()
      for (let i = 0; i < 8; i++) {
        const c = first + i
        if (c >= 0 && c < sc.palette.length) sc.palette[c] = rgb12(cols[i]!)
      }
    },

    /**
     * Routine 69 ($281e) — `G Def Palette First,C1..C8`. *"As with G Palette,
     * but you use this one BEFORE you open a screen, this way all screens
     * will have this palette when openend."*
     *
     * Exactly that, and more literally than the sentence suggests: it hangs
     * an `RGBPalette` off the screen TEMPLATE's `BMA_Palette` tag, which is a
     * pointer tag, so every screen opened afterwards shares one palette
     * array. A `G Colour` on any of them is a `G Colour` on all of them.
     *
     * The block is allocated once, `MEMF_CLEAR`, and stamped
     * `move.l #$1c0001,(a1)` — `PALETTE_ARRAY`, being `(ID_PALETTE<<16)|1`
     * with ID_PALETTE 28 in `register.i`. `G Screen Open` fills in the second
     * longword, `AmtColours`, which is why it carries that odd store through
     * `$3c(a0)`; there is no header here to fill in.
     *
     * This one pops its colours DESCENDING and gets the order right, which is
     * the routine next door to the one that does not.
     */
    'g def palette'(it) {
      const s = st()
      const first = it.evalInt()
      const cols: number[] = []
      for (let i = 0; i < 8; i++) {
        it.expect(',')
        cols.push(it.evalInt())
      }
      const pal = s.gmsDefPalette ?? (s.gmsDefPalette = new Uint16Array(256))
      for (let i = 0; i < 8; i++) {
        const c = first + i
        if (c >= 0 && c < pal.length) pal[c] = rgb12(cols[i]!)
      }
    },

    /**
     * Routine 70 ($28a2) — `G Colour N,$RGB`. *"Changes the specified colour
     * to the RRGGBB values given."*
     *
     * `UpdateColour(Screen a0, Colour d0, Value d1)` then
     * `UpdatePalette(Screen)`, both on +$1be, and both correct. Four
     * instructions with nothing wrong in them, which in this extension is
     * worth saying.
     */
    'g colour'(it) {
      const s = st()
      const n = it.evalInt()
      it.expect(',')
      const rgb = it.evalInt()
      const sc = s.gmsScreen
      if (sc && n >= 0 && n < sc.palette.length) sc.palette[n] = rgb12(rgb)
    },

    /**
     * Routine 118 ($4046) — `G Get Palette SRC,DST`. *"Changes the palette in
     * DstScreen to the SrcScreen's Palette."*
     *
     * `CopyPalette(SrcPalette a0, DestPalette a1, ColStart d0, AmtColours d1,
     * DestCol d2)` in colours.mod, with both ends reached the long way — tag
     * list, Screen, Bitmap, Palette — and the count taken from the
     * DESTINATION Bitmap's `AmtColours`, so a shallow destination copies
     * fewer colours than a deep source has.
     */
    'g get palette'(it) {
      const src = rt.screens.get(gmsSlot(it.evalInt()))
      it.expect(',')
      const dst = rt.screens.get(gmsSlot(it.evalInt()))
      if (!src || !dst) return
      const n = Math.min(dst.nColors, src.palette.length, dst.palette.length)
      for (let i = 0; i < n; i++) dst.palette[i] = src.palette[i]!
    },

    /**
     * Routine 112 ($3e70) — `G Set Pen TYPE,RADIUS`, and it is `G Blur`.
     *
     * Both token entries name instruction 112, and the routine is `G Blur`'s:
     * five pops, two subtractions and `BlurArea` in colours.mod. `G Set Pen`
     * declares two arguments. See the catalogue.
     *
     * APPROXIMATED: the arguments are evaluated and nothing else happens.
     * What the machine blurs depends on three longwords this keyword never
     * pushed, which are whatever is still under AMOS's parameter stack
     * pointer — deterministic for a given program and not modellable by a
     * port that hands a keyword its arguments as a list.
     */
    'g set pen'(it) {
      it.evalInt()
      it.expect(',')
      it.evalInt()
    },

    // ---- starting and stopping GMS ----
    /**
     * Routine 90 ($2f36) — `G Init Gms`, the one keyword of the seven the
     * guide has no node for either.
     *
     * `OpenLibrary("GMS:libs/dpkernel.library", 2)` into +$12c, +$d4 set to
     * remember that it was this that opened it, then five `OpenModule` calls
     * and a `Get(ID_TASK)` for the input structure. Idempotent: the first
     * four instructions test +$12c and return. A failed open is message 4,
     * *"(TGE) GMS2.0+ is not installed!! Read The Manual->Requirements"*.
     *
     * There is a second way in at $2fe2, and the PRGM record at $2f88 is what
     * it is for: `"PRGM"`, a version pair, that address, and five pointers to
     * `The Game Extension`, `Peter Cahill`, `30th Jan`, `PAC Productions` and
     * `The BEST Extension`. A GMS program that has TGE's segment can find the
     * entry through that block and call in with its own `DPKTask` in a0 —
     * `cmpi.w #$12,(a0)` is `Head.ID == ID_TASK` — and TGE then takes the
     * base from the task's +$60, which `tasks.h` gives as `DPKBase`. No AMOS
     * program can reach it, which is what makes `G Own Blitter` useless.
     *
     * DEFECT: the check that GMS is installed checks nothing. Before the open
     * it calls `Lock(d1, ACCESS_READ)` on `block + $12c` — the base slot,
     * four zero bytes at that moment, so an empty filename — where the name
     * it means to look for is at +$112, thirteen words along and the very
     * string the OpenLibrary two arms later uses. AmigaDOS answers an empty
     * name with a lock on the current directory, so the guard passes on every
     * machine and catches nothing; the failure it exists for is caught by the
     * OpenLibrary instead, which reports the same message.
     */
    'g init gms'() {
      gmsInit(st())
    },

    /**
     * Routine 119 ($40a8) — `G Close Gms`, undocumented.
     *
     * `Free()` on all five modules and on the input structure, `CloseDPK()`,
     * and +$12c cleared. Guarded on +$12c, so calling it twice is safe.
     *
     * DEFECT: it does not test +$d4 before `CloseDPK`, which routine 90's own
     * teardown at $30d6 does — so a TGE that inherited GMS from a host shuts
     * the host's GMS down. Not reachable from AMOS, for the same reason
     * `G Own Blitter` is not: nothing in BASIC can take the hosted path.
     */
    'g close gms'() {
      const s = st()
      if (s.gmsBase === 0) return
      closeLibrary(s.gmsBase)
      s.gmsBase = 0
      s.gmsOwned = false
    },

    /**
     * Routine 44 ($20de) — `G Reset`. *"Closes all opened TGE screens. Use
     * this just before Amos To Back : Break On, when exiting the program."*
     *
     * Guarded on +$12c, then eight `G Screen Close` calls with 0 through 7 —
     * literally: it points a3 at block +$bda as a parameter stack, pushes the
     * number with `move.l #N,-(a3)` and `Rbsr`s routine 40, eight times over.
     * Then `moveq #$1,d1 / EcCall AMOS_WB`.
     *
     * That last instruction is what settles what the AMOS_WB argument means.
     * `G Screen Open` passes 0 and opens a screen the guide says goes *"in
     * front of the amigas current display"*; this passes 1 with every game
     * screen just closed. Back and front, in that order, and -1 is the query
     * `=Amos Here` makes.
     *
     * It does NOT re-initialise anything, whatever the name suggests: GMS
     * stays open and the current Screen and Bitmap pointers are left where
     * the last close left them.
     */
    'g reset'() {
      const s = st()
      if (s.gmsBase === 0) return
      const range = Runtime.screenRange('game')
      for (let n = 0; n < range.count; n++) {
        if (rt.screens.has(range.from + n)) rt.closeScreen(range.from + n)
      }
      rt.amosToFront()
    },

    /**
     * Routine 59 ($248e) — `G Exit`, undocumented, and not an exit.
     *
     * `G Reset` and then `Rjsr L_Error` with d0 — AMOS's own error raiser,
     * the one every extension reaches with `moveq #$17,d0` for Illegal
     * function call. So the program stops with an error rather than ending.
     *
     * DEFECT: the code raised is whatever is in d0. Its spec is `I`, no
     * parameters, so nothing put anything there, and the `tst.l d0 / bne`
     * that guards the default means the 16 is used only when the leftover
     * happens to be zero. The shape is an argument the author forgot to
     * declare — `G Exit ERRORCODE` — and the same slip as `G Ptplay`'s,
     * which pops one it never declared. Sixteen here, that being the only
     * value this port can know about.
     */
    'g exit'() {
      const s = st()
      if (s.gmsBase !== 0) {
        const range = Runtime.screenRange('game')
        for (let n = 0; n < range.count; n++) {
          if (rt.screens.has(range.from + n)) rt.closeScreen(range.from + n)
        }
        rt.amosToFront()
      }
      throw new AmosError(ED_RUN_MESSAGES[16]!, 16)
    },

    /**
     * Routine 120 ($4100) — `G Own Blitter`, undocumented, and it cannot
     * work.
     *
     * `move.w #$1,$2e(a1)` with a1 from block +$da, and +$2e of dpkernel's
     * base is `GVBase.OwnBlitter`, *"0 = FALSE, 1 = TRUE"* in
     * `globalbase.h` — so the intent is exact and the pointer is not there.
     * Block +$da is written by ONE instruction in the code hunk, at $2ff6,
     * on `G Init Gms`'s hosted entry path, and that path is reachable only by
     * a GMS program calling in through the PRGM record. Everything AMOS can
     * run leaves +$da zero, so the keyword writes a word to address $2e.
     *
     * +$12c holds the same base and is four instructions away in the routine
     * that should have written both.
     */
    'g own blitter': () => {},

    // ---- drawing ----
    /** Routine 41 ($1f36) — `G Agaplasma`, one `rts`, and the guide agrees:
     *  its whole node is the words *"NOT DONE"* */
    'g agaplasma': () => {},

    /**
     * Routines 42 ($1f38) and 110 ($3e32) — `G Plot X,Y[,C]`, two arities on
     * one name. *"Places a pixel, in the specified colour, at the specified
     * point. If X and Y are bigger than the screen (like x=340) no error will
     * report and no pixel will be drawn."*
     *
     * With a colour it is `DrawPixel(Bitmap a0, XCoord d1, YCoord d2, Colour
     * d3)`; without, `PenPixel(Bitmap a0, X d0, Y d1)`, which draws in the
     * pen `G Ink` set. Both correct, and the guide's note about coordinates
     * off the screen is the blitter's clipping rather than the extension's.
     */
    'g plot'(it) {
      const s = st()
      const x = coord(it.evalInt())
      it.expect(',')
      const y = coord(it.evalInt())
      const sc = s.gmsScreen
      const c = it.accept(',') ? it.evalInt() : null
      if (!sc) return
      sc.plot(x, y, c ?? penIndex(s, sc))
    },

    /**
     * Routines 66 ($2724) and 68 ($27fa) — `G Line X1,Y1 To X2,Y2,C`, and a
     * three-argument form that cannot run.
     *
     * Routine 66 is right: `DrawLine(Bitmap a0, XStart d1, YStart d2, XEnd
     * d3, YEnd d4, Colour d5, Mask d6)` with `move.l #$ffffffff,d6`, which
     * the autodoc calls for — *"A 32 bit masking value. Use 0xffffffff for an
     * uninterrupted line."*
     *
     * Routine 68 is the same call with three arguments and three faults; see
     * the catalogue. This port takes the short form as the no-op it has to
     * be.
     */
    'g line'(it) {
      const s = st()
      const a = coord(it.evalInt())
      it.expect(',')
      const b = coord(it.evalInt())
      if (!it.accept('to')) {
        // routine 68: three arguments, and it does not return
        it.expect(',')
        it.evalInt()
        return
      }
      const x2 = coord(it.evalInt())
      it.expect(',')
      const y2 = coord(it.evalInt())
      it.expect(',')
      const c = it.evalInt()
      s.gmsScreen?.line(a, b, x2, y2, c)
    },

    /**
     * Routine 51 ($21f2) — `G Circle X,Y,R`. *"Draws a circle with a centre
     * at the specified coordinates, with the specified radius."*
     *
     * `PenCircle(Bitmap a0, X d0, Y d1, RadiusX d2, RadiusY d3)` and
     * `moveq #$0,d3`, which is right for a reason the extension's author may
     * not have known: blitter.mod $506c is `tst.w` on the saved d3 and a
     * branch, so a zero vertical radius takes the circle arm and the
     * horizontal radius is used for both. The keyword draws in the pen.
     *
     * The autodoc gives PenCircle a sixth argument, `Fill [d4]`, and the
     * shipped module has no such thing — $504a is `moveq #$0,d4` and d4 is
     * the routine's own loop variable from there on.
     */
    'g circle'(it) {
      const s = st()
      const x = coord(it.evalInt())
      it.expect(',')
      const y = coord(it.evalInt())
      it.expect(',')
      const r = coord(it.evalInt())
      const sc = s.gmsScreen
      if (sc) sc.ellipse(x, y, r, r, penIndex(s, sc), false)
    },

    /**
     * Routine 121 ($4110) — `G Rectangle X1,Y1,X2,Y2`. *"Draws a rectangle
     * with corners at the specified points."*
     *
     * `PenRect(Bitmap a0, X d0, Y d1, Width d2, Height d3, Fill d4)`, with
     * the far corner turned into a width and a height by `sub.w`. The fill
     * flag is the defect; see the catalogue. A width of `X2-X1` reaches
     * `X2-1`, so the rectangle stops one pixel short of the corner named.
     */
    'g rectangle'(it) {
      const s = st()
      const x1 = coord(it.evalInt())
      it.expect(',')
      const y1 = coord(it.evalInt())
      it.expect(',')
      const x2 = coord(it.evalInt())
      it.expect(',')
      const y2 = coord(it.evalInt())
      const sc = s.gmsScreen
      if (!sc) return
      const w = coord(x2 - x1)
      const h = coord(y2 - y1)
      if (w < 1 || h < 1) return
      sc.box(x1, y1, x1 + w - 1, y1 + h - 1, penIndex(s, sc))
    },

    /**
     * Routine 52 ($2214) — `G Cls`. *"Clears the TGE screen with colour 0"*,
     * and it does: dpkernel's `Clear(Object)` on the current Screen, which
     * the object's own autodoc gives as *"Clear the Screen->Bitmap's current
     * data area"*.
     *
     * It reaches the Screen through the table and +$195 rather than through
     * +$1be like everything else, which comes to the same thing.
     */
    'g cls'() {
      st().gmsScreen?.cls(0)
    },

    /**
     * Routine 112 ($3e70) — `G Blur P,X1,Y1 To X2,Y2`. *"This command Blur's
     * a area of the current screen with the roughness of Percent."*
     *
     * `BlurArea(Bitmap a0, XStart d0, YStart d1, Width d2, Height d3, Setting
     * d4)`, the far corner subtracted into a width and a height, which is
     * right — the published `colours.c` names those two Width and Height
     * where the `.fd` and the autodoc both call them EndX and EndY.
     *
     * The algorithm is that source's, reimplemented: each pixel becomes the
     * average of its four ORTHOGONAL neighbours and not itself, a read off
     * the bitmap counts as black, and the write is in place so a pixel's left
     * and upper neighbours are already blurred when it is reached.
     *
     * DEFECT: `Percent` is a flag. The routine's first line is
     * `if (Setting < 1) return` and nothing reads it again, so the guide's
     * *"Percentage (1-100) of how much you want it to smudge the area"* is
     * one blur for every value in the range. Its next sentence, *"The Speed
     * is roughly the same for all 1-100"*, is exactly why.
     */
    'g blur'(it) {
      const s = st()
      const setting = it.evalInt()
      it.expect(',')
      const x1 = coord(it.evalInt())
      it.expect(',')
      const y1 = coord(it.evalInt())
      it.expect('to')
      const x2 = coord(it.evalInt())
      it.expect(',')
      const y2 = coord(it.evalInt())
      const sc = s.gmsScreen
      if (!sc) return
      const w = coord(x2 - x1)
      const h = coord(y2 - y1)
      if (setting < 1 || w < 1 || h < 1) return
      const at = (x: number, y: number): number =>
        x < 0 || y < 0 || x >= sc.width || y >= sc.height ? 0 : rgb24(sc.palette[sc.point(x, y)]!)
      for (let y = y1; y < y1 + h; y++) {
        for (let x = x1; x < x1 + w; x++) {
          const n = [at(x, y - 1), at(x, y + 1), at(x - 1, y), at(x + 1, y)]
          const avg = (sh: number): number => (n.reduce((t, v) => t + ((v >> sh) & 255), 0) / 4) | 0
          sc.plot(x, y, closestColour(sc, (avg(16) << 16) | (avg(8) << 8) | avg(0)))
        }
      }
      it.charge((w * h) >> 4)
    },

    /**
     * Routine 114 ($3f3e) — `G Copyarea SRC,DST,X1,Y1 To X2,Y2,DX,DY`.
     * *"This command copys a rectangular area from one screen to another
     * screen at any position ... It is OK and faster to have the src and dest
     * screen the same."*
     *
     * `BlitArea(SrcBitmap a0, DestBitmap a1, XStart d0, YStart d1, Width d2,
     * Height d3, XDest d4, YDest d5, Remap d6)`, the two bitmaps fetched the
     * long way through the screen table, the far corner subtracted into a
     * width and a height, and `moveq #$0,d6` — no remapping. Correct, and
     * with the arguments in the order the guide gives them.
     */
    'g copyarea'(it) {
      const src = rt.screens.get(gmsSlot(it.evalInt()))
      it.expect(',')
      const dst = rt.screens.get(gmsSlot(it.evalInt()))
      it.expect(',')
      const x1 = coord(it.evalInt())
      it.expect(',')
      const y1 = coord(it.evalInt())
      it.expect('to')
      const x2 = coord(it.evalInt())
      it.expect(',')
      const y2 = coord(it.evalInt())
      it.expect(',')
      const dx = coord(it.evalInt())
      it.expect(',')
      const dy = coord(it.evalInt())
      if (!src || !dst) return
      const w = coord(x2 - x1)
      const h = coord(y2 - y1)
      if (w < 1 || h < 1) return
      Screen.copyBuf(
        src,
        src.bufferFor('logic'),
        x1,
        y1,
        x1 + w,
        y1 + h,
        dst,
        dst.bufferFor('logic', true),
        dx,
        dy,
      )
      it.charge((w * h) >> 4)
    },
  }
}

export function makeTheGameFunctions(rt: Runtime): Record<string, Func> {
  const st = (): TheGameState => rt.thegame

  return {
    /**
     * Routine 5 ($168c) — `=G Left Click`. *"Checks for lmb press."*
     *
     * `btst.b #$6,$bfe001` — CIA-A's PRA, where the left button is active low,
     * so the answer is -1 when the bit is CLEAR. It does not go near
     * `lowlevel.library` or GMS.
     */
    'g left click': () => VI((rt.input.mouseK & 1) !== 0 ? -1 : 0),

    /**
     * Routine 6 ($169e) — `=G Right Click`. *"Checks for rmb press."*
     *
     * Unlike the left one this goes through GMS: `movea.l $b2e(a2),a0` and
     * then `cmp.w #$1,$14(a0)` on the input structure. Same answer, read from
     * this port's own mouse.
     */
    'g right click': () => VI((rt.input.mouseK & 2) !== 0 ? -1 : 0),

    /**
     * Routine 11 ($173e) — `=G Check Vbl`. *"Check if it is time for a vbl
     * (PPC)."*
     *
     * One compare and two branches: `cmpi.b #$ff,$dff006`, which is the low
     * eight bits of the beam's vertical position. So it answers true on
     * exactly one line out of every 256, and on a PAL screen that is line 255
     * — well down the visible picture and nowhere near the vertical blank the
     * name promises.
     */
    'g check vbl': () => VI((rt.interp.beamLine() & 0xff) === 0xff ? -1 : 0),

    /**
     * Routine 12 ($1750) — `=G Cd32(PORT)`. *"B=port 0-3, returns lowlevel
     * bitmap"*, which it does not: the routine opens `lowlevel.library` (name
     * at block +$36, base at +$32), calls `ReadJoyPort`, and then REPACKS the
     * result into eleven low bits of its own —
     *
     *     ReadJoyPort  ->  G Cd32        ReadJoyPort  ->  G Cd32
     *     right   $1       $008          play    $20000   $400
     *     left    $2       $004          rev     $40000   $100
     *     down    $4       $002          fwd     $80000   $200
     *     up      $8       $001          green  $100000   $040
     *                                    yellow $200000   $080
     *                                    red    $400000   $010
     *                                    blue   $800000   $020
     *
     * The four directions are read through an `ext.l d7` that has already
     * thrown the top sixteen bits away; `move.l d6,d7` puts them back before
     * the buttons are tested, so the truncation costs nothing.
     */
    'g cd32': (_it, a) => {
      const raw = readJoyPort(rt.input.ports, int(a[0]) & 3)
      let out = 0
      if (raw & JPF_JOY_RIGHT) out |= 0x008
      if (raw & JPF_JOY_LEFT) out |= 0x004
      if (raw & JPF_JOY_DOWN) out |= 0x002
      if (raw & JPF_JOY_UP) out |= 0x001
      if (raw & JPF_BUTTON_PLAY) out |= 0x400
      if (raw & JPF_BUTTON_GREEN) out |= 0x040
      if (raw & JPF_BUTTON_YELLOW) out |= 0x080
      if (raw & JPF_BUTTON_RED) out |= 0x010
      if (raw & JPF_BUTTON_BLUE) out |= 0x020
      if (raw & JPF_BUTTON_REVERSE) out |= 0x100
      if (raw & JPF_BUTTON_FORWARD) out |= 0x200
      return VI(out)
    },

    /**
     * Routine 60 ($24aa) — `=G Cli(COMMAND$)`. *"similar to exec but allows
     * expressions in the structure"*.
     *
     * `dos.library`'s `Execute(cmd, 0, 0)`, with `adda.l #$2,a0` to step over
     * the AMOS string's length word.
     *
     * DEFECT: d3 — the value register — is left at the zero it held as an
     * argument, so the function always answers 0; and the failure arm writes
     * -1 into d2, the TYPE register, rather than into the value. Reproduced as
     * the constant zero, which is what a program sees on the success path and
     * on the failure path both.
     */
    'g cli': (_it, a) => {
      execute(rt.host.process, { command: str(a[0]!), io: { input: null, output: null } })
      return VI(0)
    },

    /**
     * Routine 64 ($2698) — `=G File Size(NAME$)`. *"Returns the length of the
     * specified file."*
     *
     * `AllocMem($3e8, MEMF_CLEAR)`, `Lock(name, SHARED_LOCK)`, `Examine`,
     * `UnLock`, and then `move.l $7c(a4),d3` — `fib_Size`. A lock that fails
     * is `moveq #$51,d0` into `G Exit`, error 81.
     *
     * DEFECT: the FileInfoBlock is never freed. A thousand bytes go on every
     * call, on the failure path as well as the success one.
     */
    'g file size': (_it, a) => {
      const s = st()
      s.fibLeak += 1000
      const name = str(a[0]!)
      const data = rt.vfs?.readFile(name) ?? rt.fs?.read(name) ?? null
      return VI(data ? data.length : 0)
    },

    /**
     * Routine 65 ($270e) — `=G Getmem`.
     *
     * Three instructions: `lea $352(a3),a0 / move.l a0,d3`. The answer is the
     * ADDRESS of a scratch area inside the extension's own data block — 2,148
     * zero bytes between the last library name and the end of it — and not a
     * figure for free memory, which is what the name suggests and what the
     * guide, having no node for this at all, does not say.
     */
    'g getmem': () => VI(Runtime.TGE_SCRATCH_BASE),

    /**
     * Routine 78 ($2b74) — `=G X Mouse`. *"Returns the X HARDWARE coordinate
     * of the mouse pointer."*, with the guide's own *"*GMS REQUIRED*"*.
     *
     * It is an ACCUMULATOR, not a coordinate: GMS's input poll at `-$24(a6)`
     * is called, and then the structure's x delta at +$e is ADDED to the word
     * at block +$b32 and the sum both stored and returned. So the value walks
     * with the mouse from wherever `G Set Mouse` left it.
     */
    'g x mouse': () => {
      const s = st()
      const w = mouseDat(rt.input.mouseX, rt.input.mouseY)
      // the first poll establishes the baseline rather than reporting the
      // whole free-running counter as one movement, which is what GMS's own
      // first read does and what ../runtime/gamesupport.ts calls seeding
      if (!s.seeded) {
        s.prevX = joyDatX(w)
        s.prevY = joyDatY(w)
        s.seeded = true
      }
      const x = joyDatX(w)
      s.mouseX = (s.mouseX + counterDelta(x, s.prevX)) & 0xffff
      s.prevX = x
      const y = joyDatY(w)
      s.prevY = y
      return VI(s.mouseX)
    },

    /**
     * Routine 79 ($2ba6) — `=G Y Mouse`, the same accumulator on +$b34.
     *
     * DEFECT: it loads the same two pointers as `=G X Mouse` and then does NOT
     * call the poll, so the delta it adds is whatever the last x read left
     * behind. Reading y without reading x first moves nothing.
     */
    'g y mouse': () => {
      const s = st()
      const w = mouseDat(rt.input.mouseX, rt.input.mouseY)
      if (!s.seeded) {
        s.prevX = joyDatX(w)
        s.prevY = joyDatY(w)
        s.seeded = true
      }
      s.mouseY = (s.mouseY + counterDelta(joyDatY(w), s.prevY)) & 0xffff
      return VI(s.mouseY)
    },

    /**
     * Routine 72 ($2a44) — `=G Icon Check`. *"This command checks to see if
     * the icon which was put on wb by G Iconify has been double clicked on. If
     * it has been double clicked on it automagically removes it, and returns
     * True(-1)."*
     *
     * `GetMsg` on the port at block +$b22, `RemoveAppIcon` through
     * `workbench.library` at +$b8, then the port is drained and deleted. The
     * first instruction after loading the port is `tst.l a0 / beq` — and there
     * is never a port here, because `G Iconify` could not open
     * `workbench.library`.
     */
    'g icon check': () => VI(st().iconClicked ? -1 : 0),

    /**
     * Routine 81 ($2be0) — `=G Word$(TEXT$,N,SEP)`. The guide's node is the
     * synopsis and the words *"Not DONE"*, and the routine is why.
     *
     * It is meant to be the Nth separated field of a string. What it does:
     *
     *     move.w (a0),d5             the length, for a test that never runs
     *     moveq #$1,d3
     *     .find addq.w #$1,d3 / move.b (a0,d3.w),d0
     *           cmp.w d5,d3 / cmp.b d7,d0 / bne .find
     *           subq.w #$1,d6 / tst.l d6 / bne .find
     *     adda.l d3,a0
     *     move.l d3,d4
     *     .next addq.w #$1,d4 / move.b (a0,d4.w),d0
     *           cmp.w d5,d4 / cmp.b d7,d0 / bne .next
     *
     * DEFECT: both length tests are dead. `cmp.w d5,d3` sets the flags and
     * `cmp.b d7,d0` immediately overwrites them, so neither scan ever stops
     * at the end of the string — they run into whatever follows it in AMOS's
     * string bank until a byte happens to equal the separator.
     *
     * DEFECT: `adda.l d3,a0` moves the base to the separator and the second
     * scan then indexes from `d3 + 1` off that base, counting `d3` twice. So
     * the field is looked for at twice the offset of the separator, and the
     * copy runs from `TEXT$ + d3` — two characters past the separator,
     * because `d3` is an offset into the string INCLUDING its length word.
     *
     * Neither is reproducible here, and reproducing them is not the point:
     * there is no string bank behind an AMOS string in this port, so both
     * scans stop at the end of the text. APPROXIMATED, and what a program
     * gets is the empty string for almost every call — which is also what the
     * two defects add up to on the machine for any string short enough that
     * the second scan's doubled offset is already past the end of it.
     *
     * DEFECT: the AllocMem is never freed, so every call leaks its result.
     * DEFECT: `moveq #$2,d2` is missing — the routine sets the value register
     * and never the TYPE register, exactly as `=Gsin` does.
     * DEFECT: on an AllocMem failure the routine returns without touching d3,
     * which still holds the SCAN OFFSET — a small integer handed back as a
     * string pointer.
     */
    'g word$': (_it, a) => {
      const s = st()
      const text = str(a[0]!)
      const which = int(a[1])
      const sep = int(a[2]) & 0xff
      // byte at raw offset k: 0 and 1 are the length word, then the text
      const at = (k: number): number =>
        k === 0 ? (text.length >>> 8) & 0xff : k === 1 ? text.length & 0xff : (text.charCodeAt(k - 2) ?? -1) & 0xff
      const end = text.length + 2

      // the first scan: the Nth separator, counting down d6
      let d3 = 1
      let left = which
      for (;;) {
        d3 += 1
        if (d3 >= end) return VS('')
        if (at(d3) === sep && --left === 0) break
      }
      // the second scan, from a base the routine has already advanced by d3
      let d4 = d3
      for (;;) {
        d4 += 1
        if (d3 + d4 >= end) return VS('')
        if (at(d3 + d4) === sep) break
      }
      const len = d4 - d3
      s.wordLeak += len + 2
      return VS(text.slice(d3, d3 + len))
    },

    /**
     * Routine 9 ($16f0) — `=G Open Reqtools`. The guide marks this one
     * *"Removed"* as well and it is the one that is still here in full.
     *
     *     lea $20(a3),a1 / OpenLibrary(name, 0) -> $1c(a3)
     *     tst.l d0 / beq -> Rbra routine 151 with d0 = 0
     *     moveq #$0,d2 / move.l $a50.l,d3
     *
     * Any version will do. The answer is the base, and it is fetched through
     * an ABSOLUTE address rather than through a3 — `$a50` is the data block's
     * own +$1c, relocated at load time, so the two spellings mean the same
     * longword.
     *
     * A failed open goes to routine 151, the extension's error reporter,
     * which ends `Rjmp L_ErrorExt` on a message table at $4214; message 0 is
     * *"(TGE) You don't have the required library in LIBS:"*. That arm is
     * unreachable here — `../amiga/exec.ts` models `reqtools.library` and its
     * requesters are `../runtime/requester.ts` — and the error table is
     * written down in the header for the batches that will need the rest of
     * it.
     */
    'g open reqtools': () => {
      const s = st()
      s.reqtoolsBase = openLibrary('reqtools.library')
      return VI(s.reqtoolsBase)
    },

    /**
     * Routine 30 ($1d14) — `=G Oddno`. The guide's node is one line, the
     * synopsis `A=G Oddno(B#)`, and no description at all.
     *
     * Two instructions: `move.l -$18ae(a5),d3 / rts`. That slot is AMOS's
     * `graphics.library` base — see `src/cli/oscalls.ts`, which names the
     * whole set — so the answer is a library pointer and has nothing to do
     * with odd numbers.
     *
     * The synopsis is wrong as well: the token spec is `V0`, and the extension
     * docs give `V` as *"V--> reserved variable. In that case, you must ...
     * state the type"*, the `0` being that type. So it takes no argument and no
     * brackets, the way `Timer` does,
     * and `G Oddno(B#)` will not tokenise. The routine agrees: it pops
     * nothing.
     *
     * It sits between eight bare `rts` placeholders at routines 29 and 31-38,
     * which is what an abandoned block of the jump table looks like.
     */
    'g oddno': () => VI(TGE_GFX_BASE),

    /**
     * Routine 85 ($2e1e) — `=Gsin(ANGLE)`. *"returns sin of angle B
     * multiplyed by 128"*.
     *
     *     movea.l $1c8(a5),a0 / movea.l $bce(a0),a1
     *     move.l (a3)+,d0 / asl.w #$1,d0
     *     move.w (a1,d0.w),d3 / asr.l #$8,d3 / rts
     *
     * No bounds test and no table test. The index is doubled with a WORD
     * shift and then used as a sign-extended word displacement, so it wraps
     * every 32768 entries and reads backwards from the table for the second
     * half of that; and with no `G Set Table` the base is zero and the read
     * comes out of the bottom of memory. Neither is memory this port has, so
     * both answer 0.
     *
     * `asr.l #$8` turns the stored cos(x)*32768 into the promised *128 — and
     * loses the sign, because only the low half of d3 was written. See the
     * catalogue.
     */
    'gsin': (_it, a) => VI(trigWord(st(), int(a[0]), 0)),

    /**
     * Routine 86 ($2e32) — `=Gcos(ANGLE)`. *"Returns the cosine of the angle
     * multiplied by 128."*, with *"Angle -> The angle to use in degrees."*,
     * which is only true after `G Set Table 90`.
     *
     * The same seven instructions on the pointer at +$bd2 instead of +$bce,
     * which is the same table read n entries later. The last quarter of it is
     * one step out and this is the function that reads it; see the catalogue.
     */
    'gcos': (_it, a) => {
      const s = st()
      return VI(trigWord(s, int(a[0]), s.cosAt))
    },

    /**
     * Routine 76 ($2b38) — `=G Ptpos`, the byte at handle -$0c. Undocumented:
     * the guide has a node for `G Ptlength` and none for this.
     */
    'g ptpos': () => {
      const s = st()
      return VI(live(s) ? s.replay.pos & 0xff : 0)
    },

    /**
     * Routine 77 ($2b56) — `=G Ptlength`. *"Returns the length of the mod."*
     *
     * ptreplay $5c8 follows the handle to the module and reads byte $3b6,
     * which in a 31-sample module is the song length — 20 bytes of title and
     * then thirty bytes for each of the samples. So it is the number of
     * positions, not a duration.
     */
    'g ptlength': () => {
      const s = st()
      return VI(live(s) && s.song ? s.song.positions.length & 0xff : 0)
    },

    // ---- the four mode constants, none of them documented ----
    /**
     * Routine 46 ($215e) — `=Glowres`, `SM_LORES`. `move.l #$8,d3 / moveq
     * #$0,d2`, which is the shape all four should have had.
     */
    'glowres': () => VI(8),

    /** Routine 47 ($2168) — `=Ghires`, `SM_HIRES` */
    'ghires': () => VI(1),

    /**
     * Routine 45 ($2158) — `=Gsuperhires`, `SM_SHIRES`. The constant is
     * right and `G Screen Open` cannot use it; see the catalogue.
     */
    'gsuperhires': () => VI(2),

    /**
     * Routine 48 ($2172) — `=Gham`, which never sets the value register.
     *
     * DEVIATION: what a program gets on the machine is the last thing
     * evaluated, and this port hands keywords their arguments as values
     * rather than through a shared register, so there is no last thing to
     * hand back. Zero, which is at least a mode `G Screen Open` accepts —
     * it is AMOS's Lowres, and the normaliser turns it into `SM_LORES`.
     */
    'gham': () => VI(0),

    /**
     * Routine 107 ($3e02) — `=GScreen Width`, undocumented. `movea.l
     * $1c2(a1),a0 / move.w $10(a0),d3`: the BITMAP's Width, not the Screen's
     * viewport, so a bitmap larger than its screen reports the bitmap.
     *
     * The word goes into d3 without clearing it first; see "The value
     * register". A width is positive, so taking the high half as zero costs
     * this one nothing.
     */
    'gscreen width': () => VI(st().gmsScreen?.width ?? 0),

    /** Routine 108 ($3e12) — `=GScreen Height`, the Bitmap's +$14 */
    'gscreen height': () => VI(st().gmsScreen?.height ?? 0),

    /**
     * Routine 109 ($3e22) — `=GScreen Colour`, the Bitmap's `AmtColours` at
     * +$34. A LONG, and `move.l` — so this is the one of the three that
     * reads its whole register, and the value register defect misses it.
     */
    'gscreen colour': () => VI(st().gmsScreen?.nColors ?? 0),

    /**
     * Routine 91 ($30f0) — `=G Amiga`, undocumented. Four instructions:
     * `movea.l $4.w,a0 / moveq #$0,d3 / move.w $128(a0),d3 / moveq #$0,d2`.
     *
     * ExecBase +$128 is `AttnFlags`, so the answer is the raw processor
     * flags word and not a model number — bit 0 68010, bit 1 68020, bit 2
     * 68030, bit 3 68040, bit 4 68881, bit 5 68882, bit 7 68060. The machine
     * this port models is an A1200, which AMCAF's `=Cpu`, TURBO's `Cpu Info`
     * and JD's `=Jd Cpu` all answer for as bit 1 with no FPU; this answers
     * the same machine in the raw form.
     *
     * It is also the one function in the extension that clears d3 before
     * writing a word into it, which is how the four that do not can be called
     * oversights rather than a convention.
     */
    'g amiga': () => VI(TGE_ATTN_FLAGS),

    /**
     * Routine 100 ($37d8) — `=G Make Rp`, undocumented, and 192 bytes of
     * which 140 are unreachable.
     *
     * `AllocMem(200, MEMF_CLEAR)`, `move.l #$3,d3`, and then `beq` followed
     * by `bra.w` to the same exit — so it always returns 3 and never frees
     * the 200 bytes. The `beq` cannot fire either: `move.l #$3,d3` sets the
     * flags between the `tst.l d0` and the branch.
     *
     * The dead half says what it was for. It opens the name at block +$6e —
     * `graphics.library` — into +$80, calls `InitRastPort` (-$c6) and
     * `InitBitMap` (-$186) over the two halves of that 200-byte block, reads
     * the current GMS Bitmap's `Data` at +$c and stores it to absolute
     * address 8, and returns the RastPort. A graphics.library RastPort over a
     * GMS screen is exactly what AMOS's own drawing would need to reach one,
     * so this is the bridge between the two halves of the extension, left
     * switched off.
     */
    'g make rp': () => {
      st().rpLeak += 200
      return VI(3)
    },

    /**
     * Routine 84 ($2dfc) — `=G Point(X,Y)`, whose guide node is headed
     * `A=G Pixel(B,C)` and whose text spells it right. *"Returns the number
     * of the on-screen colour at the specified coordinates."*
     *
     * `ReadPixel(Bitmap a0, XCoord d1, YCoord d2)`, `move.l d0,d3` and
     * `moveq #$0,d2`. A colour NUMBER, and both registers set properly.
     */
    'g point': (_it, a) => {
      const sc = st().gmsScreen
      return VI(sc ? sc.point(coord(int(a[0])), coord(int(a[1]))) : 0)
    },

    /**
     * Routine 111 ($3e50) — `=G Rgb(X,Y)`, undocumented, and the RGB half of
     * the function above: `ReadRGBPixel(Bitmap a0, XCoord d1, YCoord d2)`,
     * which answers the pixel's $00RRGGBB rather than its index.
     *
     * DEFECT: it never sets d2, the TYPE register, and d2 is where the Y
     * argument was left. So the type a program gets back is its own Y
     * coordinate. Answered as an integer here, which is what the value is.
     */
    'g rgb': (_it, a) => {
      const sc = st().gmsScreen
      if (!sc) return VI(0)
      return VI(rgb24(sc.palette[sc.point(coord(int(a[0])), coord(int(a[1])))]!))
    },
  }
}
