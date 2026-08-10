/**
 * Opal 1.1 — Martin Boyd, seventy-eight keywords at slot 21.
 *
 * *"The AMOS extensions adds over 70 commands to the AMOS command set to allow
 * direct access to the OpalVision framebuffer."* It is a shim and nothing else:
 * *"The commands have the same names as the Library functions described in the
 * programmers manual with the prefix 'ov' added (unless the function name
 * already starts with 'ov). For example the function OpenScreen24 becomes
 * OvOpenScreen24 in AMOS."* The card and the library it wraps are modelled in
 * `../amiga/opalvision.ts`; this file is the AMOS side.
 *
 * ## Evidence
 *
 * SOURCE tier. `Opal.s` ships with the extension, and it is the whole thing —
 * 1,003 lines for 78 keywords, short because every routine pops its arguments
 * off `(a3)` and tails into `opal.library` through one macro:
 *
 *     A_CALLOPAL	MACRO
 *     		move.l	A6,-(SP)
 *     		move.l	ExtAdr+ExtNb*16(a5),A6
 *     		move.l	(A6),A6
 *     		jsr	_LVO\1(a6)
 *     		move.l	(SP)+,A6
 *     		move.l	D0,D3
 *     		moveq	#0,D2
 *     		ENDM
 *
 * `Opal.lib` assembles to exactly that, so the source and the binary agree
 * line for line, and the LVOs the binary carries run `-$1e` to `-$1c8` in
 * steps of six with no gaps — the first 72 vectors of `opal.library`, in
 * declaration order — plus `-$1d4`, which `opallib.i` names `AmosPatch24`.
 *
 * The library's own documentation was published by Opal Technology as
 * `devdocs.lha` and is vendored beside the extension; see
 * `../amiga/opalvision.ts` for what it contains.
 *
 * **Four keywords never call the library at all.** `Ovsetpen24` writes the pen
 * into the screen structure and `Ovgetred24`/`Ovgetgreen24`/`Ovgetblue24` read
 * back what `Ovreadpixel24` left there — the readme lists them apart from the
 * rest as *"AMOS Specific Commands"*, and they exist because the C header does
 * this with macros an AMOS program cannot use.
 *
 * ## Three defects, all in the extension rather than the library
 *
 * - **The cold start never checks whether `opal.library` opened.** Routine 0
 *   calls `OpenLibrary`, stores the result, and returns `moveq #ExtNb,D0` with
 *   the comment `;NO ERRORS` whatever it was. Every keyword then does
 *   `movea.l (a6),a6 / jsr _LVOxxx(a6)` through that pointer, so on a machine
 *   with no OpalVision card the first keyword jumps through zero. The
 *   extension HAS the error for it — `ErrMess dc.b "Can't Open Opal.Library"`
 *   — and nothing reaches it. See `libraryAbsent`.
 * - **`Ovcopperrefresh` declares an argument it never pops.** Its token entry
 *   is `"ovcopperrefres","h"+$80,"00"` — a function of one integer — and
 *   routine 79 ($1142) is four instructions that call `AmosPatch24` and return without
 *   touching `(a3)`. The argument is left on AMOS's parameter stack.
 * - **`Ovopenscreen24` leaves the pen's blue component uninitialised.** After
 *   `OpenScreen24` returns it does `clr.b OS_Pen_R(A0)` and `move.b #$FF,
 *   OS_Pen_G(A0)` and stops, so a screen's default pen is red 0, green 255 and
 *   whatever byte was at `Pen_B`. The library clears the structure, so in
 *   practice that is 0 — a pure green pen — but nothing in the extension makes
 *   it so.
 *
 * ## Two names, one routine
 *
 * `Ovloadimage24` and `Ovloadiff24` are separate token entries pointing at the
 * same routine 25 ($b9c), which is the extension keeping up with the library: *"the
 * name of this function has been renamed to LoadImage24(), which is used as a
 * synonym for the previous function name LoadIFF24() to maintain backward
 * compatibility"*.
 *
 * ## Five more in `opal.library`, reproduced by `../amiga/opalvision.ts`
 *
 * The card and its driver are modelled next door, and `src/amiga/README.md`
 * keeps `DEFECT:` out of that directory, so the catalogue is here. Each of
 * these is what the shipped v4.3 binary does; none is fixed on the way through.
 *
 * - **DEFECT: `MaxFrames` over-reports in 15-bit mode.** The field is
 *   `(12 >> hires+lace) / components`, which offers six frames for a lores
 *   non-interlaced 15-bit screen, but `WriteFrame24` uses only the low two bits
 *   of the frame number, so frames 4 and 5 write the same segments as 0 and 1.
 *   See `frameTarget`.
 * - **DEFECT: the thumbnail scaler bounds its rows against the wrong axis.**
 *   The vertical loop tests the destination row against 48 — `cmpi.l
 *   #$30,$b0b2`, which is the horizontal limit — where the thumbnail is 30 rows
 *   tall, and only `WritePixel24`'s clipping keeps the surplus out. See
 *   `OpalVision.thumbnail`.
 * - **DEFECT: a thumbnail of an 8-bit screen has no red in it.** Hunk $aff0
 *   unpacks the pen byte as 3-3-2, rotates the red field into `d1`, and then
 *   accumulates `d0` — still holding green. So red comes out a copy of green.
 * - **DEFECT: taking a thumbnail zeroes the source screen's `RelX` and
 *   `RelY`.** Hunk $ae34 saves them, clears them for the scale, and restores
 *   them into `a3`, the scratch thumbnail structure, instead of `a4`. So
 *   `Ovwritethumbnail24` and `Ovsaveiff24` both lose a screen's draw offsets.
 * - **DEFECT: fast format plus a mask writes a short `BODY` length.** The
 *   length goes out before the planes and counts only the colour ones, then the
 *   mask is appended after them. The short-write check on the mask is dead too:
 *   `cmp.l d0,d0` where `cmp.l d3,d0` was meant. See `OpalVision.saveIff`.
 */
import type { Runtime } from './runtime'
import type { Func, Instr } from '../interp/builtins'
import { VI, str } from '../interp/values'
import type { Bus } from '../amiga/opalvision'
import {
  ADDLOAD,
  CL_AUTO,
  CL_DISPLAYLATCH,
  CL_DUALPLAYFIELD,
  CL_FREEZEFRAME,
  CL_VALID,
  DUALDISPLAY,
  HIRESDISP,
  MAXCOPROINS,
  NUM_CONTROL_LINES,
  NUM_SEGMENTS,
  OL_ERR_FILEWRITE,
  OL_ERR_MAXERR,
  OL_ERR_NOTHUMBNAIL,
  OL_ERR_NOTIFF,
  OL_ERR_NOTILBM,
  OL_ERR_OPENFILE,
  OL_ERR_OPENSCREEN,
  OS,
  OVCF_OPALVISION,
  OVPRI,
  OVTN_SIZE,
  OpalVision,
  PLANES8,
  PRISTENCIL,
  VIRTUALSCREEN24,
  frameTarget,
  screenSize,
} from '../amiga/opalvision'

/**
 * The extension's one error message, and it is dead code.
 *
 * `L_Custom` loads `ErrMess` and jumps to `L_ErrorExt` in the ordinary way,
 * but nothing branches to `L_Custom`: the cold start returns success whether
 * `OpenLibrary` worked or not. Declared here because the table is what the
 * extension carries, not what it reaches.
 */
export const OPAL_ERRORS = ["Can't Open Opal.Library"]

export interface OpalState {
  /** the card, its screens and the pool they live in */
  ov: OpalVision
}

export const newOpalState = (base: number, reserved: number): OpalState => ({
  ov: new OpalVision(base, reserved),
})

/**
 * Whether this machine has an OpalVision card.
 *
 * There is no card here and there is no `opal.library` to open, so the honest
 * answer would be the one the extension's dead error message describes. It is
 * not the answer this port gives, and the reason is what the defect above
 * says: the extension does not take that path. `OpenLibrary` failing leads to
 * `jsr -$1e(a6)` with `a6` zero, which is a guru and not a behaviour — so
 * there is nothing to reproduce on the absent-card arm, and the modelled card
 * is present instead. `Ovconfig24` reports it as an OpalVision rather than a
 * ColorBurst, which is the difference `OS_Modulo` turns on.
 */
export const libraryAbsent = false

export function makeOpalInstructions(rt: Runtime): Record<string, Instr> {
  const card = (): OpalVision => rt.opal.ov

  /** the rest of the machine's memory, for the conversion routines */
  const bus: Bus = {
    peek8: (a) => {
      const m = rt.resolveAddr(a >>> 0)
      return m ? (m.data[m.off] ?? 0) : 0
    },
    poke8: (a, v) => {
      const m = rt.resolveWrite(a >>> 0)
      if (m) m.data[m.off] = v & 0xff
    },
  }

  /** N comma-separated integers, which is every argument list here */
  const args = (it: Parameters<Instr>[0], n: number): number[] => {
    const out: number[] = []
    for (let i = 0; i < n; i++) {
      if (i > 0) it.expect(',')
      out.push(it.evalInt())
    }
    return out
  }

  /**
   * Change a bit in every CoPro instruction — the shape `AmigaPriority`,
   * `OVPriority`, `DualDisplay24`, `SingleDisplay24`, `DualPlayField24`,
   * `SinglePlayField24`, `EnablePRStencil24` and `DisablePRStencil24` all
   * share: *"This function clears the OVPRI bit of all CoPro instructions"*.
   *
   * *"If an Opal display bottom has been set, the coprocessor instructions
   * will not be modified for that region of the display"*, and the screen's
   * `LastCoProIns` is where that stops: *"Normally this is MAXCOPROINS,
   * however it will be less than this if a display bottom has been set."*
   */
  const copro = (bit: number, on: boolean): void => {
    const ov = card()
    const last = ov.active === 0 ? MAXCOPROINS : ov.peek16(ov.active + OS.LastCoProIns)
    for (let i = 0; i < Math.min(last, MAXCOPROINS); i++) {
      ov.copro[i] = on ? ov.copro[i]! | bit : ov.copro[i]! & ~bit
    }
  }

  /** the same over a range of lines, which is what `SetHires24` and `SetLores24` take */
  const coproLines = (top: number, lines: number, bit: number, on: boolean): void => {
    const ov = card()
    for (let i = top; i < top + lines; i++) {
      if (i < 0 || i >= MAXCOPROINS) continue
      ov.copro[i] = on ? ov.copro[i]! | bit : ov.copro[i]! & ~bit
    }
  }

  return {
    /**
     * Routine 4 ($99e) — `Ovclosescreen24`, and the one keyword whose order matters:
     * `CloseScreen24` first, `AmosPatch24 0` after, with `movem.l d0-d3` round
     * the second call so the first one's return survives it.
     *
     * *"This function closes the current displayed screen if it was opened by
     * the current task"*, and a latched display outlives it: *"If
     * CloseScreen24() is called after the latch bit is set, all memory and
     * resources will be freed but the display will still be active."*
     */
    ovclosescreen24() {
      const ov = card()
      if (ov.active !== 0) ov.freeScreen(ov.active)
      ov.patched = false
    },

    /** Routine 5 ($9d2) — `Ovwritepixel24 SCREEN,X,Y`; the library's -1 is discarded here */
    ovwritepixel24(it) {
      const [s, x, y] = args(it, 3)
      card().writePixel(s!, x!, y!)
    },

    /**
     * Routine 6 ($9ec) — `Ovreadpixel24 SCREEN,X,Y`.
     *
     * An INSTRUCTION in the token table, so `ReadPixel24`'s *"-1 if pixel was
     * out of the clipping region"* never reaches the program. The colour is
     * the point: it lands in `Red`, `Green` and `Blue` for the three `Ovget`
     * functions to fetch.
     */
    ovreadpixel24(it) {
      const [s, x, y] = args(it, 3)
      card().readPixel(s!, x!, y!)
    },

    /** Routine 7 ($a06) — `Ovclearscreen24 SCREEN`, all bitplanes, no clip, no update */
    ovclearscreen24(it) {
      card().clearScreen(it.evalInt())
    },

    /** Routine 8 ($a1c) — `Ovilbmtoov SCREEN,DATA,SRCWIDTH,LINES,TOPLINE,SRCPLANES` */
    ovilbmtoov(it) {
      const [s, data, w, lines, top, planes] = args(it, 6)
      card().ilbmToOv(bus, s!, data!, w!, lines!, top!, planes!)
    },

    /**
     * Routine 9 ($a3c) — `Ovupdatedelay24 FRAMES`. *"Setting a frame delay of zero
     * enables continuous full speed updates"*, and the call *"also initiates
     * continuous updates ... which will continue until either Refresh24() or
     * StopUpdate24() is called"*.
     */
    ovupdatedelay24(it) {
      const ov = card()
      ov.updateDelay = it.evalInt() & 0xff
      ov.updating = true
      if (ov.active !== 0) {
        ov.poke8(ov.active + OS.UpdateRate, ov.updateDelay)
        ov.refresh(ov.active)
      }
    },

    /**
     * Routine 10 ($a52) — `Ovrefresh24`. *"This function will update the framebuffer
     * in the minimum number of frames required, stop DMA (updates) and
     * return"*, so the state it leaves behind is updates off.
     */
    ovrefresh24() {
      const ov = card()
      if (ov.active !== 0) ov.refresh(ov.active)
      ov.updating = false
    },

    /**
     * Routine 11 ($a66) — `Ovsetdisplaybottom24 LINE`. *"Below this point Amiga only
     * graphics will be displayed"*, and the CoPro calls stop there afterwards,
     * which is what `LastCoProIns` records.
     */
    ovsetdisplaybottom24(it) {
      const ov = card()
      const line = it.evalInt()
      ov.displayBottom = line
      if (ov.active !== 0) {
        ov.poke16(ov.active + OS.LastCoProIns, Math.max(0, Math.min(line, MAXCOPROINS)))
      }
    },

    /** Routine 12 ($a7c) — `Ovcleardisplaybottom24`, and `LastCoProIns` goes back to the maximum */
    ovcleardisplaybottom24() {
      const ov = card()
      ov.displayBottom = -1
      if (ov.active !== 0) ov.poke16(ov.active + OS.LastCoProIns, MAXCOPROINS)
    },

    /**
     * Routine 13 ($a90) — `Ovsetsprite24 DATA,NUMBER`. *"Passing -1 for the SpriteData
     * will use the currently active Amiga Sprite in the system"*, and passing 0
     * removes it: *"the sprite may be removed before starting updates ... by
     * calling SetSprite24() with SpriteData = NULL"*.
     */
    ovsetsprite24(it) {
      const [data, n] = args(it, 2)
      if (n! >= 0 && n! < 8) card().sprites[n!] = data! | 0
    },

    /** Routine 14 ($aa8) — `Ovamigapriority`: *"clears the OVPRI bit of all CoPro instructions"* */
    ovamigapriority() {
      copro(OVPRI, false)
    },

    /** Routine 15 ($abc) — `Ovpriority`: *"sets the OVPRI bit of all coprocessor instructions"* */
    ovpriority() {
      copro(OVPRI, true)
    },

    /** Routine 16 ($ad0) — `Ovdualdisplay24`: *"clears the DUALDISPLAY bit"*, which is active low */
    ovdualdisplay24() {
      copro(DUALDISPLAY, false)
    },

    /** Routine 17 ($ae4) — `Ovsingledisplay24`: *"sets the DUALDISPLAY bit of all CoPro instructions"* */
    ovsingledisplay24() {
      copro(DUALDISPLAY, true)
    },

    /**
     * Routine 18 ($af8) — `Ovappendcopper24 LISTS`. *"Pointer to an array of 12 copper
     * list pointers to be joined to the current display copper lists"*, and
     * *"All copper lists must reside in chip ram"*.
     *
     * The twelve pointers are kept in the screen's `CopList_Cycle` array, which
     * is where `opallib.i` puts twelve longwords and where the copper lists the
     * library cycles through belong. Attaching them is the library's own
     * business with the Amiga copper, which the AMOS program never sees; what
     * it does see is the array, and the manual's follow-up instruction that
     * *"the LastWait field in the OpalScreen structure must be initialised with
     * the last vertical position wait in the attached copper lists"* — the
     * program's job, not the library's.
     */
    ovappendcopper24(it) {
      const ov = card()
      const list = it.evalInt() >>> 0
      if (ov.active === 0) return
      for (let i = 0; i < 12; i++) {
        ov.poke32(ov.active + OS.CopList_Cycle + i * 4, bus32(bus, list + i * 4))
      }
    },

    /** Routine 19 ($b0e) — `Ovrectfill24 SCREEN,X1,Y1,X2,Y2`, filled with the screen's pen */
    ovrectfill24(it) {
      const [s, x1, y1, x2, y2] = args(it, 5)
      card().rectFill(s!, x1!, y1!, x2!, y2!)
    },

    /**
     * Routine 20 ($b2c) — `Ovupdatecopro24`: *"Encodes the entire CoPro instruction
     * list from the displayed screen structure and initiates a coprocessor
     * update. ... This function also updates the Load Address Register."*
     */
    ovupdatecopro24() {
      const ov = card()
      if (ov.active === 0) return
      for (let i = 0; i < MAXCOPROINS; i++) ov.copro[i] = ov.peek8(ov.active + OS.CoProData + i)
      ov.addressReg = ov.peek32(ov.active + OS.AddressReg)
    },

    /**
     * Routine 21 ($b40) — `Ovsetcontrolbit24 FRAME,BIT,STATE`. *"BitNumber = Bit
     * number within control line to modify (4...19)"*, over the fourteen
     * registers `SetControlBit24`'s own table numbers 0 to 13.
     */
    ovsetcontrolbit24(it) {
      const [frame, bit, state] = args(it, 3)
      const ov = card()
      if (frame! < 0 || frame! >= NUM_CONTROL_LINES) return
      const mask = 1 << (bit! & 31)
      ov.controlLines[frame!] = state!
        ? ov.controlLines[frame!]! | mask
        : ov.controlLines[frame!]! & ~mask
    },

    /**
     * Routine 22 ($b5a) — `Ovpalettemap24 ON`. *"This function always operates on the
     * active display screen"*, and *"cannot be used in 15bit mode"*.
     *
     * The mode lives in the CoPro's S1/S0 pair and the command register's
     * CR7/CR6, per section 7.4's table: palette-mapped 24-bit is S1=0, S0=0 and
     * by-pass is S1=0, S0=1. So turning palette mapping on CLEARS VIDMODE0 and
     * turning it off sets it, for a 24-bit screen.
     */
    ovpalettemap24(it) {
      const ov = card()
      const on = it.evalInt() !== 0
      if (ov.active === 0) return
      if (ov.peek16(ov.active + OS.Depth) === 15) return
      copro(1 /* VIDMODE0 */, !on)
    },

    /**
     * Routine 23 ($b70) — `Ovupdatepalette24`: *"Loads all 256 entries of Red, Green
     * and Blue values in the OpalScreen structure onto the OpalVision palette
     * registers"*, and *"also updates the Pixel Read mask and the Command
     * Register and uses the Palette Load Address as an offset for the palette
     * update"*.
     */
    ovupdatepalette24() {
      const ov = card()
      if (ov.active === 0) return
      const off = ov.peek8(ov.active + OS.PalLoadAddress)
      for (let i = 0; i < 256; i++) {
        const to = ((i + off) & 0xff) * 3
        for (let c = 0; c < 3; c++)
          ov.palette[to + c] = ov.peek8(ov.active + OS.Palette + i * 3 + c)
      }
      ov.pixelReadMask = ov.peek8(ov.active + OS.PixelReadMask)
      ov.commandReg = ov.peek8(ov.active + OS.CommandReg)
      ov.palLoadAddress = off
    },

    /**
     * Routine 24 ($b84) — `Ovscroll24 DX,DY`, *"by modifying the video load address
     * register"*. A line is `Modulo` address counts, so `DY` lines are
     * `DY * Modulo`. *"This function also clears the ADDLOAD bit on the first
     * CoPro instruction if it is not already cleared."*
     */
    ovscroll24(it) {
      const [dx, dy] = args(it, 2)
      const ov = card()
      const modulo = ov.active === 0 ? 371 : ov.peek16(ov.active + OS.Modulo)
      ov.addressReg = (ov.addressReg + dx! + dy! * modulo) >>> 0
      if (ov.active !== 0) ov.poke32(ov.active + OS.AddressReg, ov.addressReg)
      ov.copro[0] = ov.copro[0]! & ~ADDLOAD
    },

    /** Routine 26 ($bea) — `Ovsetscreen24 SCREEN`, the whole screen filled with its pen */
    ovsetscreen24(it) {
      card().setScreen(it.evalInt())
    },

    /** Routine 29 ($c52) — `Ovfreescreen24 SCREEN`, the virtual-screen counterpart of close */
    ovfreescreen24(it) {
      card().freeScreen(it.evalInt() >>> 0)
    },

    /**
     * Routine 30 ($c68) — `Ovupdateregs24`: *"Updates the Pixel Read mask, Command
     * register and Palette Load Address registers in the OpalVision with the
     * values from the current display screen structure"*.
     */
    ovupdateregs24() {
      const ov = card()
      if (ov.active === 0) return
      ov.pixelReadMask = ov.peek8(ov.active + OS.PixelReadMask)
      ov.commandReg = ov.peek8(ov.active + OS.CommandReg)
      ov.palLoadAddress = ov.peek8(ov.active + OS.PalLoadAddress)
    },

    /**
     * Routine 31 ($c7c) — `Ovsetloadaddress24`, which takes no arguments because the
     * value is a field: *"uses the Load Address value in the displayed
     * OpalScreen structure to update the load address register"*.
     */
    ovsetloadaddress24() {
      const ov = card()
      if (ov.active !== 0) ov.addressReg = ov.peek32(ov.active + OS.AddressReg)
    },

    /** Routine 32 ($c90) — `Ovrgbtoov SCREEN,PLANES,X,Y,WIDTH,HEIGHT`, clipped */
    ovrgbtoov(it) {
      const [s, planes, x, y, w, h] = args(it, 6)
      card().rgbToOv(bus, s!, planes!, x!, y!, w!, h!)
    },

    /**
     * Routine 34 ($cc4) — `Ovfadein24 TIME`. *"Fade the current display from black to
     * true colour"*, with *"Time = Time in 1/100 seconds to complete fade"*,
     * and it *"cannot be used in 15bit mode"*.
     *
     * The fade runs in the card's palette registers, so what it leaves behind
     * is the screen's palette fully loaded. There is no OpalVision display to
     * watch it happen on, and the time is the library's own busy wait.
     */
    ovfadein24(it) {
      const ov = card()
      it.evalInt()
      if (ov.active === 0 || ov.peek16(ov.active + OS.Depth) === 15) return
      for (let i = 0; i < ov.palette.length; i++)
        ov.palette[i] = ov.peek8(ov.active + OS.Palette + i)
    },

    /** Routine 35 ($cda) — `Ovfadeout24 TIME`, and black is what it ends on */
    ovfadeout24(it) {
      const ov = card()
      it.evalInt()
      if (ov.active === 0 || ov.peek16(ov.active + OS.Depth) === 15) return
      ov.palette.fill(0)
    },

    /**
     * Routine 36 ($cf0) — `Ovclearquick24`. *"clears the frame buffer memory as
     * quickly as possible by enabling a write to all banks of memory. This
     * function will also zero all bitplanes in memory"*, and *"acts on the
     * current display screen and cannot be used for virtual screens"*.
     */
    ovclearquick24() {
      const ov = card()
      // "enabling a write to all banks of memory" is all twelve segments at
      // once, which is why it is the quick one
      for (let i = 0; i < NUM_SEGMENTS; i++) ov.segmentIfWritten(i)?.fill(0)
      if (ov.active !== 0) ov.clearScreen(ov.active)
    },

    /**
     * Routine 38 ($d1c) — `Ovsetrgb24 ENTRY,RED,GREEN,BLUE`: *"updates a single
     * palette entry in the OpalVision palette registers"*, straight to the
     * card rather than through the screen's copy.
     */
    ovsetrgb24(it) {
      const [entry, r, g, b] = args(it, 4)
      const ov = card()
      const i = (entry! & 0xff) * 3
      ov.palette[i] = r! & 0xff
      ov.palette[i + 1] = g! & 0xff
      ov.palette[i + 2] = b! & 0xff
    },

    /** Routine 39 ($d38) — `Ovdrawline24 SCREEN,X1,Y1,X2,Y2` */
    ovdrawline24(it) {
      const [s, x1, y1, x2, y2] = args(it, 5)
      card().drawLine(s!, x1!, y1!, x2!, y2!)
    },

    /** Routine 40 ($d56) — `Ovstopupdate24`: *"stops updates to the OpalVision frame buffer memory"* */
    ovstopupdate24() {
      card().updating = false
    },

    /** Routine 41 ($d6a) — `Ovwritepfpixel24 SCREEN,X,Y`, set or cleared by `Pen_R` */
    ovwritepfpixel24(it) {
      const [s, x, y] = args(it, 3)
      card().writeStencil(s!, x!, y!, false)
    },

    /** Routine 42 ($d84) — `Ovwriteprpixel24 SCREEN,X,Y` */
    ovwriteprpixel24(it) {
      const [s, x, y] = args(it, 3)
      card().writeStencil(s!, x!, y!, true)
    },

    /** Routine 43 ($d9e) — `Ovtorgb SCREEN,PLANES,X,Y,WIDTH,HEIGHT` */
    ovtorgb(it) {
      const [s, planes, x, y, w, h] = args(it, 6)
      card().ovToRgb(bus, s!, planes!, x!, y!, w!, h!)
    },

    /** Routine 44 ($dbe) — `Ovtoilbm SCREEN,DATA,DESTWIDTH,LINES,TOPLINE` */
    ovtoilbm(it) {
      const [s, data, w, lines, top] = args(it, 5)
      card().ovToIlbm(bus, s!, data!, w!, lines!, top!)
    },

    /**
     * Routine 45 ($ddc) — `Ovupdateall24`: *"Resets the internal update structure so
     * that all required banks are updated"*, which undoes `Ovupdatepfstencil24`.
     */
    ovupdateall24() {
      card().pfStencilOnly = false
    },

    /**
     * Routine 46 ($df0) — `Ovupdatepfstencil24`: *"Enables updates to only the
     * segments containing the playfield stencil (green segments)."* It does
     * not touch the stencil — *"This function does not update the playfield
     * stencil as such, but modifies the internal state of the library"* — and
     * *"will call WriteFrame24(1) when in 8bit mode to switch to the green
     * segment."*
     */
    ovupdatepfstencil24() {
      const ov = card()
      ov.pfStencilOnly = true
      if (ov.active !== 0 && (ov.peek16(ov.active + OS.Flags) & PLANES8) !== 0) ov.writeFrame = 1
    },

    /** Routine 47 ($e04) — `Ovenableprstencil24`: *"set the PRISTENCIL bit of all CoPro instructions"* */
    ovenableprstencil24() {
      copro(PRISTENCIL, true)
    },

    /** Routine 48 ($e18) — `Ovdisableprstencil24`: *"clears the PRISTENCIL bit"* */
    ovdisableprstencil24() {
      copro(PRISTENCIL, false)
    },

    /** Routine 49 ($e2c) — `Ovclearprstencil24 SCREEN`, every pixel of plane 16 */
    ovclearprstencil24(it) {
      card().fillStencil(it.evalInt(), true, false)
    },

    /** Routine 50 ($e42) — `Ovsetprstencil24 SCREEN` */
    ovsetprstencil24(it) {
      card().fillStencil(it.evalInt(), true, true)
    },

    /**
     * Routine 51 ($e58) — `Ovdisplayframe24 FRAME`. *"The display frame and the write
     * frame, must reside in the same field area in the frame buffer memory ...
     * Due to this DisplayFrame24() has the side effect of changing the write
     * frame if the new display frame is in a different field."*
     *
     * Which field a frame is in comes from `WriteFrame24` itself — see
     * `frameTarget` — so the side effect fires when the two disagree, and never
     * on an interlaced screen, where every frame uses both fields.
     */
    ovdisplayframe24(it) {
      const ov = card()
      ov.displayFrame = it.evalInt()
      if (fieldOf(ov, ov.writeFrame) !== fieldOf(ov, ov.displayFrame))
        ov.writeFrame = ov.displayFrame
    },

    /** Routine 52 ($e6e) — `Ovwriteframe24 FRAME`, with the same coupling the other way */
    ovwriteframe24(it) {
      const ov = card()
      ov.writeFrame = it.evalInt()
      if (fieldOf(ov, ov.writeFrame) !== fieldOf(ov, ov.displayFrame))
        ov.displayFrame = ov.writeFrame
    },

    /** Routine 53 ($e84) — `Ovbitplanetoov SCREEN,PLANES,SRCWIDTH,LINES,TOPLINE,SRCDEPTH` */
    ovbitplanetoov(it) {
      const [s, planes, w, lines, top, depth] = args(it, 6)
      card().bitPlaneToOv(bus, s!, planes!, w!, lines!, top!, depth!)
    },

    /**
     * Routine 54 ($ea4) — `Ovsetcopro24 N,INSTRUCTION`: *"modifies a single CoPro
     * instruction and initiates an update to the OpalVision CoPro"*, and
     * *"InstructionNumber should be less than LastCoProIns"* — should, not
     * must, so the bound is the array's.
     */
    ovsetcopro24(it) {
      const [n, ins] = args(it, 2)
      const ov = card()
      if (n! < 0 || n! >= MAXCOPROINS) return
      ov.copro[n!] = ins! & 0xff
      if (ov.active !== 0) ov.poke8(ov.active + OS.CoProData + n!, ins! & 0xff)
    },

    /**
     * Routine 55 ($ebc) — `Ovregwait24`: *"waits for register information to be
     * updated to the OpalVision before returning, or returns immediately if no
     * updates are pending"*.
     *
     * Every register write here lands at once, so there is never an update
     * pending and this always takes the immediate arm. The example program
     * calls it four times around its mask changes and gets the behaviour it
     * asked for.
     */
    ovregwait24() {},

    /**
     * Routine 56 ($ed0) — `Ovdualplayfield24`, *"allowing a dual 24 bit overlay
     * mode"*.
     *
     * The AutoDoc says it *"sets the DUALPLAYFIELD bit of all CoPro
     * instructions"* and the library does not touch the CoPro. It is fourteen
     * calls to `SetControlBit24` — `moveq #$1,d2 / moveq #$d,d3 / moveq #$7,d1
     * / move.l d3,d0 / bsr SetControlBit24 / dbra d3` — setting bit 7 of every
     * control line register, and `DUALPLAYFIELD` is bit 7 of THAT register.
     * There is no such bit among the CoPro's eight, which `opallib.h` names one
     * by one, so the AutoDoc has named the wrong register.
     */
    ovdualplayfield24() {
      const ov = card()
      for (let i = 0; i < NUM_CONTROL_LINES; i++)
        ov.controlLines[i] = ov.controlLines[i]! | CL_DUALPLAYFIELD
    },

    /** Routine 57 ($ee4) — `Ovsingleplayfield24`, the same bit cleared */
    ovsingleplayfield24() {
      const ov = card()
      for (let i = 0; i < NUM_CONTROL_LINES; i++)
        ov.controlLines[i] = ov.controlLines[i]! & ~CL_DUALPLAYFIELD
    },

    /** Routine 58 ($ef8) — `Ovclearpfstencil24 SCREEN`, every pixel of the stencil plane */
    ovclearpfstencil24(it) {
      card().fillStencil(it.evalInt(), false, false)
    },

    /** Routine 59 ($f0e) — `Ovsetpfstencil24 SCREEN` */
    ovsetpfstencil24(it) {
      card().fillStencil(it.evalInt(), false, true)
    },

    /** Routine 60 ($f24) — `Ovreadprpixel24 SCREEN,X,Y`; an instruction, so the 0/1/-1 is dropped */
    ovreadprpixel24(it) {
      const [s, x, y] = args(it, 3)
      card().readStencil(s!, x!, y!, true)
    },

    /** Routine 61 ($f3e) — `Ovreadpfpixel24 SCREEN,X,Y`, likewise */
    ovreadpfpixel24(it) {
      const [s, x, y] = args(it, 3)
      card().readStencil(s!, x!, y!, false)
    },

    /** Routine 62 ($f58) — `Ovtobitplane SCREEN,PLANES,DESTWIDTH,LINES,TOPLINE` */
    ovtobitplane(it) {
      const [s, planes, w, lines, top] = args(it, 5)
      card().ovToBitPlane(bus, s!, planes!, w!, lines!, top!)
    },

    /**
     * Routine 63 ($f76) — `Ovfreezeframe24 FREEZE`. *"Freeze freezes everything on the
     * display including Amiga graphics"*, and *"This functions is available
     * only while a Scan Rate Converter is present"* — the bit exists whether
     * the module does or not, and the manual marks it *"Available only when the
     * Scan Rate Converter module is present"* in the control-line table too.
     */
    ovfreezeframe24(it) {
      const ov = card()
      ov.frozen = it.evalInt() !== 0
      for (let i = 0; i < NUM_CONTROL_LINES; i++) {
        ov.controlLines[i] = ov.frozen
          ? ov.controlLines[i]! | CL_FREEZEFRAME
          : ov.controlLines[i]! & ~CL_FREEZEFRAME
      }
    },

    /**
     * Routine 67 ($1008) — `Ovautosync24 SYNC`. AUTO is active LOW in the control-line
     * table — *"AUTO Enable | Auto Line Start Sync | 0"* — so enabling auto
     * syncing clears the bit.
     */
    ovautosync24(it) {
      const ov = card()
      ov.autoSync = it.evalInt() !== 0
      for (let i = 0; i < NUM_CONTROL_LINES; i++) {
        ov.controlLines[i] = ov.autoSync
          ? ov.controlLines[i]! & ~CL_AUTO
          : ov.controlLines[i]! | CL_AUTO
      }
    },

    /** Routine 68 ($101e) — `Ovdrawellipse24 SCREEN,CX,CY,A,B`, and *"set a=b for circles"* */
    ovdrawellipse24(it) {
      const [s, cx, cy, a, b] = args(it, 5)
      card().drawEllipse(s!, cx!, cy!, a!, b!)
    },

    /**
     * Routine 69 ($103c) — `Ovlatchdisplay24 LATCH`: *"If this bit is set, the
     * OpalVision display will remain active regardless of whether there is a
     * valid control line in the Amigas' output."*
     */
    ovlatchdisplay24(it) {
      const ov = card()
      ov.latched = it.evalInt() !== 0
      for (let i = 0; i < NUM_CONTROL_LINES; i++) {
        ov.controlLines[i] = ov.latched
          ? ov.controlLines[i]! | CL_DISPLAYLATCH
          : ov.controlLines[i]! & ~CL_DISPLAYLATCH
      }
    },

    /**
     * Routine 70 ($1052) — `Ovsethires24 TOPLINE,LINES`: *"Sets the HIRESDISP bits on
     * CoPro instructions starting at TopLine for 'Lines' number of lines"*, and
     * *"Both TopLine and Lines must be specified as a non-interlaced scan
     * line"*.
     */
    ovsethires24(it) {
      const [top, lines] = args(it, 2)
      coproLines(top!, lines!, HIRESDISP, true)
    },

    /** Routine 71 ($106a) — `Ovsetlores24 TOPLINE,LINES`, the same bits cleared */
    ovsetlores24(it) {
      const [top, lines] = args(it, 2)
      coproLines(top!, lines!, HIRESDISP, false)
    },

    /**
     * Routine 75 ($1108) — `Ovsetpen24 SCREEN,R,G,B`, and one of the four keywords that
     * never enters the library. Three `move.b` into `$390`, `$391`, `$392`, so
     * only the low byte of each argument survives.
     *
     * The readme documents it as *"Set The current Pen color. OvSetPen24
     * (OScrn,R,G,B)"*, which is `SetPen24` from `opallib.h` — a macro there,
     * and macros are no use from AMOS.
     */
    ovsetpen24(it) {
      const [s, r, g, b] = args(it, 4)
      const ov = card()
      ov.poke8(s! + OS.Pen_R, r!)
      ov.poke8(s! + OS.Pen_G, g!)
      ov.poke8(s! + OS.Pen_B, b!)
    },
  }
}

/**
 * Which field of the frame buffer a frame lives in, or -1 when the mode puts it
 * in both — which is what interlace does, and why the display/write coupling
 * cannot fire on an interlaced screen. The rule is `WriteFrame24`'s own; see
 * `frameTarget` in `../amiga/opalvision.ts`.
 */
function fieldOf(ov: OpalVision, frame: number): number {
  const flags = ov.active === 0 ? 0 : ov.peek16(ov.active + OS.Flags)
  const t = frameTarget(flags, frame)
  return t.fields.length > 1 ? -1 : t.fields[0]!
}

/** a longword from the machine, for the pointer arrays the conversions take */
const bus32 = (bus: Bus, a: number): number =>
  ((bus.peek8(a) << 24) | (bus.peek8(a + 1) << 16) | (bus.peek8(a + 2) << 8) | bus.peek8(a + 3)) >>>
  0

export function makeOpalFunctions(rt: Runtime): Record<string, Func> {
  const card = (): OpalVision => rt.opal.ov

  return {
    /**
     * Routine 3 ($962) — `=Ovopenscreen24(MODES)`.
     *
     *     move.l	(A3)+,D5
     *     lea	-$7fa(a5),A0 / moveq #1,D0 / A_CALLOPAL AmosPatch24
     *     move.l	D5,D0 / A_CALLOPAL OpenScreen24
     *     move.l	D0,A0
     *     clr.b	OS_Pen_R(A0) / move.b #$FF,OS_Pen_G(A0)
     *
     * So the AMOS patch goes in FIRST and the pen is set after — and only two
     * thirds of it. See the module note on the uninitialised blue.
     *
     * DEFECT: `move.l D0,A0` runs whether or not `OpenScreen24` answered NULL,
     * so a failed open writes the two pen bytes through address zero. On the
     * machine that is a write to the ROM's exception vectors; here the write
     * lands nowhere and the keyword answers 0, which is what the AutoDoc
     * promises: *"A pointer to an OpalScreen structure or NULL if
     * unsuccessful"*.
     */
    ovopenscreen24: (_it, a) => {
      const ov = card()
      const flags = int(a[0])
      ov.patched = true
      // "This function closes the current displayed screen if it was opened by
      // the current task" is CloseScreen24's; opening a second display screen
      // is what the CLOSEABLE24 protocol exists to arbitrate, and with one task
      // the old one simply goes
      if (ov.active !== 0) ov.freeScreen(ov.active)
      const { width, height } = screenSize(flags, false)
      const addr = ov.newScreen(flags, width, height, true)
      if (addr === 0) return VI(0)
      ov.active = addr
      // "The screen will be opened as single playfield, single display mode
      // with OVPriority", and the frame buffer is cleared: "The Frame buffer
      // memory is cleared and updates are disabled"
      ov.copro.fill(DUALDISPLAY | OVPRI)
      ov.controlLines.fill(CL_VALID)
      ov.updating = false
      ov.poke8(addr + OS.Pen_R, 0)
      ov.poke8(addr + OS.Pen_G, 0xff)
      return VI(addr | 0)
    },

    /**
     * Routine 28 ($c38) — `=Ovcreatescreen24(MODES,WIDTH,HEIGHT)`, *"the virtual
     * screen equivalent of OpenScreen24()"*: any size, in fast memory, never
     * displayed.
     */
    ovcreatescreen24: (_it, a) => {
      const ov = card()
      const addr = ov.newScreen(int(a[0]), int(a[1]), int(a[2]), false)
      return VI(addr | 0)
    },

    /**
     * Routine 33 ($cb0) — `=Ovactivescreen24`: *"a pointer to the currently displayed
     * OpalVision screen. If there is no OpalVision display active then a null
     * value is returned."*
     */
    ovactivescreen24: () => VI(card().active | 0),

    /**
     * Routine 66 ($ff4) — `=Ovconfig24`: *"Returns flags indicating the hardware
     * configuration of the 24bit display card"*. The modelled card is an
     * OpalVision rather than a ColorBurst, which is what `OS_Modulo` differs
     * on.
     */
    ovconfig24: () => VI(OVCF_OPALVISION),

    /**
     * Routines 76, 77 and 78 — `=Ovgetred24(SCREEN)` and its two siblings, the
     * only way an AMOS program can see what `Ovreadpixel24` read. Three
     * instructions each: `moveq #0,d3` then `move.b $393(a0),d3`, so unsigned
     * 0..255.
     */
    ovgetred24: (_it, a) => VI(card().peek8(int(a[0]) + OS.Red)),
    ovgetgreen24: (_it, a) => VI(card().peek8(int(a[0]) + OS.Green)),
    ovgetblue24: (_it, a) => VI(card().peek8(int(a[0]) + OS.Blue)),

    /**
     * Routine 79 ($1142) — `=Ovcopperrefresh(N)`, which is `AmosPatch24(1)` and
     * nothing else. Undocumented by the readme, which lists the other three
     * AMOS-specific keywords and not this one.
     *
     * DEFECT: the token entry declares one integer parameter and the routine
     * pops nothing, so the argument stays on AMOS's parameter stack. This port
     * consumes it, because the interpreter's stack is not the machine's and
     * leaving a value on it would desync the caller rather than reproduce the
     * leak.
     */
    ovcopperrefresh: (_it, a) => {
      void a
      card().patched = true
      return VI(0)
    },

    /**
     * Routine 64 ($f8c) — `=Ovlowmemupdate24(SCREEN,FRAME)`. *"Updates the frame
     * buffer from a virtual screen ... This routine uses an 8bit screen to
     * update each memory segment separately ... The 8bit plane display screen
     * opened to perform the update is returned, and should be subsequently
     * closed."*
     *
     * So it opens a display screen as a side effect, and the manual is firm
     * about whose job closing it is: *"after calling LowMemUpdate() ... you
     * will actually have 2 screens open, one display and one virtual, the
     * display screen opened by LowMemUpdate() MUST be closed by calling
     * CloseScreen24()."*
     */
    ovlowmemupdate24: (_it, a) => VI(lowMemUpdate(card(), int(a[0]), int(a[1]), true)),

    /**
     * Routine 74 ($10d8) — `=Ovlowmem2update24(SCREEN,FRAME)`, the same *"although it
     * only updates the frame buffer memory, it does not modify the display
     * modes, CoPro bits or palette information"*.
     */
    ovlowmem2update24: (_it, a) => VI(lowMemUpdate(card(), int(a[0]), int(a[1]), false)),

    /**
     * Routine 25 ($b9c) — `=Ovloadimage24(SCREEN,NAME$,FLAGS)`, and `=Ovloadiff24`
     * with it: two token entries, one routine, because the library renamed the
     * function and kept the old name *"to maintain backward compatibility"*.
     *
     * DEFECT: `Opal.s` comments the first pop as `;OpalScreen pointer.` and it
     * is the FLAGS — a wrong comment and not wrong code. Arguments are popped right to
     * left, and the screen is the third pop, into `A0`, which is where the
     * AutoDoc wants it.
     *
     * JPEG is not loaded. The AutoDoc's own restriction list is precise about
     * what the loader accepts — *"a baseline loader as specified in the draft
     * standard ISO/IEC Bis 10918-1 ... 8 bit quantization tables and Huffman
     * entropy compression ... Y Cb Cr, RGB and Grey scale"* — and a decoder for
     * it is not written yet, so a file whose first two bytes are the JPEG start
     * marker gets `OL_ERR_FORMATUNKNOWN`, which is what the library answers for
     * a file it cannot identify at all.
     */
    ovloadimage24: (_it, a) => VI(loadImage(rt, int(a[0]), str(a[1]!), int(a[2]))),
    ovloadiff24: (_it, a) => VI(loadImage(rt, int(a[0]), str(a[1]!), int(a[2]))),

    /**
     * Routine 27 ($c00) — `=Ovsaveiff24(SCREEN,NAME$,CHUNKFUNC,FLAGS)`. *"Error = 0 if
     * no error code, >0 if error occurred."*
     *
     * `CHUNKFUNC` is a 68000 entry point and this port has no processor to
     * enter it on; see `OpalVision.saveIff` for what that costs. Everything
     * else about the file is reproduced, including the two defects in it.
     */
    ovsaveiff24: (_it, a) => {
      const ov = card()
      const scrn = int(a[0])
      const name = str(a[1]!)
      const flags = int(a[3])
      if (!ov.screens.get(scrn >>> 0)) return VI(OL_ERR_OPENFILE)
      const bytes = ov.saveIff(scrn, flags)
      return VI(rt.vfs?.writeFile(name, bytes) === true ? 0 : OL_ERR_FILEWRITE)
    },

    /**
     * Routine 37 ($d04) — `=Ovwritethumbnail24(SCREEN,FILE)`, where `FILE` is an
     * AmigaDOS file handle and not a name: *"File = File Handle of the file to
     * write thumb-nail to"*.
     *
     * Nothing in AMOS makes one of those except `Doscall`, which this port
     * classes n/a, and Make 1.1's `=Ma Fopen`, whose handle IS the BPTR
     * `Open()` returned — so that is the one this resolves, and any other value
     * gets `OL_ERR_FILEWRITE`, which is what the library answers when the
     * `Write()` comes up short.
     *
     * The write is *"OVTN"*, the length `$10e0`, and 4320 bytes of thumbnail.
     */
    ovwritethumbnail24: (_it, a) => {
      const ov = card()
      const scrn = int(a[0])
      if (!ov.screens.get(scrn >>> 0)) return VI(OL_ERR_FILEWRITE)
      const file = rt.make?.files.get(int(a[1]) >>> 0)
      if (!file) return VI(OL_ERR_FILEWRITE)
      const chunk = new Uint8Array(8 + OVTN_SIZE)
      chunk.set([0x4f, 0x56, 0x54, 0x4e, 0, 0, 0x10, 0xe0])
      chunk.set(ov.thumbnail(scrn), 8)
      const grown = new Uint8Array(Math.max(file.data.length, file.pos + chunk.length))
      grown.set(file.data)
      grown.set(chunk, file.pos)
      file.data = grown
      file.pos += chunk.length
      rt.vfs?.writeFile(file.path, file.data)
      return VI(0)
    },

    /**
     * Routine 65 ($fbc) — `=Ovdisplaythumbnail24(SCREEN,NAME$,X,Y)`: *"displays the
     * imbedded thumbnail in the file described by FileName if it exists"*, and
     * `OL_ERR_NOTHUMBNAIL` when it does not.
     *
     * Hunk $a01e reads the file forward chunk by chunk and stops at the first
     * of `OVTN` — which it takes — or `BODY`, which means there was none. The
     * JPEG arm looks for a thumbnail in an APP0 segment instead and is not
     * modelled; a JPEG gets `OL_ERR_NOTHUMBNAIL`, which is also what the
     * library answers for a JPEG that carries no thumbnail.
     */
    ovdisplaythumbnail24: (_it, a) => {
      const ov = card()
      const scrn = int(a[0])
      const data = readFile(rt, str(a[1]!))
      if (data === null) return VI(OL_ERR_OPENFILE)
      const found = findThumbnail(data)
      if (typeof found === 'number') return VI(found)
      ov.displayThumbnail(scrn, found, int(a[2]), int(a[3]))
      return VI(0)
    },

    /**
     * Routine 72 ($1082) — `=Ovdownloadframe24(SCREEN,X,Y,W,H)`, the frame buffer read
     * back into a screen. Undocumented by the AutoDocs; the signature is
     * `devdocs/Basic/opal_lib.fd`'s and the behaviour hunk $53ca's.
     *
     * The extension's token entry declares a function, so it has a value, and
     * routine 72 ($1082) does not set one — `A_CALLOPAL` puts whatever `D0` the library
     * left into `D3`, and the library's own last instruction before `rts` is a
     * `movem.l` restore, so the answer is unspecified. Zero is the value this
     * port gives.
     *
     * A download while continuous updates are running reads what the screen
     * holds now, since that is what the update DMA has been putting there.
     */
    ovdownloadframe24: (_it, a) => {
      const ov = card()
      const scrn = int(a[0])
      if (ov.updating && ov.active !== 0) ov.refresh(ov.active)
      ov.downloadFrame(scrn, int(a[1]), int(a[2]), int(a[3]), int(a[4]))
      return VI(0)
    },
  }
}

/** the file behind an AMOS name, written disc first so a saved file reads back */
function readFile(rt: Runtime, name: string): Uint8Array | null {
  return rt.vfs?.readFile(name) ?? rt.fs?.read(name) ?? null
}

/** the two bytes an image file starts with when it is a JPEG: `cmpi.w #$ffd8` */
const isJpeg = (data: Uint8Array): boolean => data[0] === 0xff && data[1] === 0xd8

/**
 * The shared body of `Ovloadimage24` and `Ovloadiff24`.
 *
 * *"To determine which of these messages has been returned, the value can be
 * compared to OL_ERR_MAXERR"*, so everything below 40 is an error and anything
 * above it is a screen. `OpenFile` failing is `OL_ERR_OPENFILE` and an
 * unrecognised format is `OL_ERR_FORMATUNKNOWN`, which shares its number with
 * `OL_ERR_NOTIFF`.
 */
function loadImage(rt: Runtime, scrn: number, name: string, flags: number): number {
  const data = readFile(rt, name)
  if (data === null) return OL_ERR_OPENFILE
  if (isJpeg(data)) return OL_ERR_NOTIFF
  const addr = rt.opal.ov.loadIff(data, scrn, flags, false)
  if (addr >= OL_ERR_MAXERR) rt.opal.ov.patched = true
  return addr
}

/**
 * The `OVTN` chunk in an IFF file, or the error the scan ends on.
 *
 * The library gives up at `BODY` — `cmpi.l #$424f4459 / beq / moveq #$a,d0` —
 * so a thumbnail written after the image data is one that cannot be found,
 * which is why `SaveIFF24` puts it first of all the chunks.
 */
function findThumbnail(data: Uint8Array): Uint8Array | number {
  if (isJpeg(data)) return OL_ERR_NOTHUMBNAIL
  const tag = (i: number): string =>
    String.fromCharCode(data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0, data[i + 3] ?? 0)
  const u32 = (i: number): number =>
    (((data[i] ?? 0) << 24) |
      ((data[i + 1] ?? 0) << 16) |
      ((data[i + 2] ?? 0) << 8) |
      (data[i + 3] ?? 0)) >>>
    0
  if (data.length < 12 || tag(0) !== 'FORM') return OL_ERR_NOTIFF
  const form = tag(8)
  if (form !== 'ILBM' && form !== 'OVFT') return OL_ERR_NOTILBM
  for (let p = 12; p + 8 <= data.length;) {
    const id = tag(p)
    const len = u32(p + 4)
    if (id === 'BODY') return OL_ERR_NOTHUMBNAIL
    if (id === 'OVTN') {
      const out = new Uint8Array(OVTN_SIZE)
      out.set(data.subarray(p + 8, Math.min(p + 8 + Math.min(len, OVTN_SIZE), data.length)))
      return out
    }
    p += 8 + len + (len & 1)
  }
  return OL_ERR_NOTHUMBNAIL
}

/** an argument that arrived as a Value */
const int = (v: unknown): number => Number((v as { n?: number } | undefined)?.n ?? 0) | 0

/**
 * The shared body of `LowMemUpdate24` and `LowMem2Update24`.
 *
 * Both take a virtual screen and open an 8-bit DISPLAY screen of the same
 * resolution to push the segments through, and both answer that screen —
 * *"RetScrn >= OL_ERR_MAXERR Return code is a pointer to an Opal screen
 * structure. RetScrn < OL_ERR_MAXERR, Return code indicates error."*
 *
 * `NOTE: OScrn must be a pointer to a virtual screen`, and a display screen
 * passed instead is not covered by the AutoDoc at all.
 */
function lowMemUpdate(ov: OpalVision, scrn: number, frame: number, modes: boolean): number {
  const src = ov.screens.get(scrn >>> 0)
  if (!src) return OL_ERR_OPENSCREEN
  ov.patched = true
  const flags = (ov.peek16(scrn + OS.Flags) & ~0x40) | PLANES8
  const { width, height } = screenSize(flags, false)
  const addr = ov.newScreen(flags, width, height, true)
  if (addr === 0) return OL_ERR_OPENSCREEN
  if (ov.active !== 0) ov.freeScreen(ov.active)
  ov.active = addr
  ov.writeFrame = frame
  if (modes) {
    ov.copro.fill(DUALDISPLAY | OVPRI)
    for (let i = 0; i < 256 * 3; i++) ov.palette[i] = ov.peek8(scrn + OS.Palette + i)
  }
  // the segments reached are the virtual screen's own, whatever the eight-bit
  // screen this opened to push them through: "this function updates the buffer
  // one segment at a time and therefore only requires one segment of data to be
  // in chip memory"
  ov.refresh(scrn)
  ov.updating = false
  return addr < OL_ERR_MAXERR ? OL_ERR_OPENSCREEN : addr | 0
}

/** the flag `LoadImage24` reads to decide between a display and a virtual screen */
export const LOAD_VIRTUAL = VIRTUALSCREEN24
