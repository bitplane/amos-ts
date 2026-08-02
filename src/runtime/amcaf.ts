/**
 * AMCAF — Chris Hodges' extension, 281 keywords at slot 8. Freeware.
 *
 * The largest third-party extension in the archive and the best documented:
 * a 235KB AmigaGuide with a real manual entry for 234 of the 280 distinct
 * keywords, and 279 of the 281 names appearing somewhere in it.
 *
 * ## Identity: one port, two releases
 *
 * `amcaf-1.40` (26-Dec-95) and `amcaf-1.50` share **268 keyword names**.
 * 1.50 adds twelve and removes none, so it is 1.40 plus additions rather than
 * a reworking — which is exactly why the 1.50 manual documents 1.40. One port
 * serves both, the way the two Personnal releases and the three TURBOs do.
 *
 * ## Evidence tier: manual for 1.40, disassembly for what 1.50 added
 *
 * The author says so himself: *"AMCAF V1.50beta4 is the FINAL RELEASE!
 * FREEWARE!"* and, of the manual, *"Sorry, but I didn't have time to update
 * the manual. You'll have to find out the new commands since V1.40
 * yourself."*
 *
 * So the honest split is **manual tier for the 1.40 subset** and
 * **disassembly tier for the twelve 1.50 additions** — the transparency
 * group (`Trans Screen Static/Dynamic/Runtime`, `Alloc`/`Set Trans
 * Map`/`Source`), `Alloc Code Bank`, `Turbo Text`, `Pt Free Voice`, `Sload`
 * and `Ssave`. C2P is undocumented too: it appears only in the history node,
 * crediting Mikael Kalms' routine.
 *
 * Where the two disagree the binary wins. `extdis amcaf-1.50` decodes a
 * 45,532-byte code hunk, jump table at +18, 354 routines from $1c28.
 *
 * ## The Guide's history node is a primary source
 *
 * Unusually, the manual carries a dated changelog going back to 1993, and it
 * documents behaviour nothing else records — including bugs the author found
 * and fixed. Two examples worth having on file before the graphics slice:
 *
 * - *"Found and removed an error in the Blitter Fill commands. Blitter Fill
 *   filled the screen one line to deep -> memory got corrupted."*
 * - *"Error in the tokenlist caused a wrong syntax of Blitter Fill to be
 *   converted into Pt Play. Funny :)"*
 *
 * Both are FIXED by the releases we hold, so neither is reproduced; they are
 * recorded because a program written against an older AMCAF may have been
 * built around them.
 *
 * ## There is no error message table
 *
 * Unlike Personnal, JVP, TURBO and AMOS 3D, this extension ships **no error
 * strings at all** — the whole 45KB hunk contains no printable message text.
 * Failures go through AMOS's own error numbers, which the manual confirms
 * when it blames one on the host: *"this is a problem of AMOS"*.
 *
 * The one exception points the other way: `Io Error` and `Io Error$` return
 * **AmigaDOS** error codes and strings, not AMOS ones — *"Returns the last
 * dos error code"*, *"Returns a dos errorstring"*. Those belong to
 * `dos.library` and are slice 5's problem, not an extension error table.
 *
 * ## Contested names
 *
 * Thirteen of the 281 names are also spelled by something else, and seven of
 * those are ARMED — the other side is already ported, so a plain-name
 * registration would silently replace a working implementation:
 *
 *   Blitter Clear, Blitter Copy, Blitter Copy Limit,
 *   Set Ntsc, Set Pal, Speek              -> Personnal
 *   Sload, Ssave                          -> the Music extension, EME
 *
 * The decision is to declare all eight `qualified` in EXT_IMPLS, so they
 * register as `ext8:<name>` and dispatch resolves them by the slot the
 * program actually bound — which is what the machine does, where the two are
 * different tokens at different slots and coexist. Personnal keeps the plain
 * names.
 *
 * They cannot be declared ahead of the keywords: `extimpl.test.ts` requires
 * every qualified name to be one the port actually defines, which is what
 * stops the list rotting into a wish. So the declarations arrive with their
 * slices — Sload/Ssave in slice 5, the six Personnal names in slice 7.
 *
 * The remaining six are latent (neither side ported): `Bank Name`,
 * `Bank Name$`, `Open Workbench`, `Pal Spread`, `Raster Wait`, `Xfire`.
 *
 * ## State
 *
 * The extension keeps one data block, which `Amcaf Base` and `Amcaf Length`
 * hand a program the address and size of. Nothing is in it yet; each slice
 * adds the fields its keywords need.
 */

import type { Runtime } from './runtime'
import type { Func, Instr } from '../interp/builtins'
import type { Interp } from '../interp/interp'
import { AmosError, VI, VS, int, str, type Value } from '../interp/values'
import { DAY_MS, STAMP_EPOCH, TICKS_PER_SECOND, stampToYmd } from '../amiga/datestamp'
import { MAX_COMMENT, blocksFor, entryType, protectionString } from '../amiga/dos'
import { fillRow } from '../amiga/blitter'
import { AMIGA_PERIODS, clampVolume, periodToHz } from '../amiga/paula'
import { parseSampleBank } from './audio'
import { pp20Decrunch } from '../amiga/powerpacker'
import { JOY_DIRECTIONS, JOY_DOWN, JOY_FIRE, JOY_LEFT, JOY_RIGHT, JOY_UP, MAX_PORT, PORT_MOUSE, joyFire } from '../interp/gameport'
import { BitMap } from '../amiga/graphics'
import { amigaMatch } from '../amiga/dospattern'
import { joinAmigaPath } from '../amiga/vfs'

/**
 * The FileInfoBlock the Examine family fills in.
 *
 * `Examine Dir` "loads all information about the drawer into the
 * FileInfoBlock", `Examine Next$` steps it to each entry in turn, and
 * `Examine Object` fills it for one named object. The `Object *` accessors
 * then read whichever object it currently describes — which is why they all
 * have a no-argument form as well as a path one.
 */
export interface AmcafExamine {
  /** the directory being walked, or '' after Examine Stop */
  dir: string
  entries: string[]
  index: number
  /** the path the accessors currently answer for */
  current: string
}


/**
 * Splinters: pixels lifted off a picture that keep the colour they took.
 *
 * "Splinters are similar to Td Stars, but they don't destroy the background
 * and use the colour of the pixel they have removed and Splinters require a
 * list of coordinates. Each coordinate requires four bytes, i.e already a
 * field of 16x16 coordinates consumes 16 KB of memory."
 *
 * "Each Splinter requires 22 bytes of memory" in the bank, which is what
 * `Splinters Bank bank,splinum` reserves.
 */
export interface SplinterState {
  bank: number
  max: number
  coordsBank: number
  /** the (x,y) pairs Coords Read gathered, which Init feeds the engine from */
  coords: Array<[number, number]>
  next: number
  p: Array<{ x: number; y: number; vx: number; vy: number; c: number; life: number }>
  gx: number
  gy: number
  /** "the number of steps the splinters are moved before they vanish"; 0 = never */
  fuel: number
  /** "the max. amount of new Splinters to appear on each step"; -1 = no limit */
  maxNew: number
  bkColour: number
  planes: number
  limit: { x1: number; y1: number; x2: number; y2: number } | null
  saved: { x: number; y: number; c: number }[] | null
}

/**
 * Td Stars: a 3D starfield, "Each star consumes 12 bytes of memory".
 *
 * Unlike Splinters these DO destroy the background, which is why the manual
 * pairs Draw with a matching Del rather than saving anything.
 */
export interface TdStarState {
  bank: number
  max: number
  s: Array<{ x: number; y: number; z: number; vx: number; vy: number }>
  gx: number
  gy: number
  accelerate: boolean
  ox: number
  oy: number
  planes: number
  limit: { x1: number; y1: number; x2: number; y2: number } | null
}


/**
 * The ProTracker replayer's state — the third module player in this port,
 * after AMOS's own tracker and MED.
 *
 * The module itself stays in its AMOS bank; this holds only what the keywords
 * report and control. `cia` is the timing source the manual makes a point of:
 * "if you specify a value of zero, the timing will be switched from
 * CIA-Timing to Vertical Blank Timing. Then the bpm rate is automatically set
 * to exactly 125."
 */
export interface PtState {
  bank: number
  samBank: number
  playing: boolean
  pos: number
  row: number
  tick: number
  speed: number
  bpm: number
  cia: boolean
  volume: number
  /** which of the four voices the music may use */
  voices: number
  signal: number
  vu: number[]
  note: number[]
  instr: number[]
  /** Pt Free Voice: which voices are not claimed by the music */
  free: boolean[]
}

export interface AmcafState {
  /** the single Examine context; the extension keeps exactly one */
  examine: AmcafExamine
  /** the last AmigaDOS error, which Io Error reports */
  ioError: number
  /** BPLCON2's dual-playfield sprite priority, as Set Sprite Priority left it */
  spritePriority: number
  /** whether colours are read as 24-bit $RRGGBB rather than 12-bit $RGB */
  agaNotation: boolean
  /**
   * Shade Bob state.
   *
   * `shadePlanes` is how many bitplanes a shade bob cycles through --
   * "protect the graphics in higher bitplanes from the influences of Shade
   * Bobs ... must be a value between 1 and 6" -- and `shadeMask` chooses
   * whether the bob's mask or its first bitplane says where it touches.
   */
  shadePlanes: number
  shadeMask: boolean
  /** the bank Ptile blocks come from */
  ptileBank: number
  /** the two particle engines, which share a command shape but not a model */
  splinters: SplinterState
  stars: TdStarState
  /**
   * The second mouse's own position, speed and limits.
   *
   * A distinct pointer from AMOS's, exactly as Sticks' Mouse family is: the
   * hardware is a second mouse in the joystick port, and nothing here drives
   * one, so the position is wherever a program last put it.
   */
  smouse: { x: number; y: number; speed: number; limit: { x1: number; y1: number; x2: number; y2: number } | null }
  /** the ProTracker replayer's state */
  pt: PtState
  /** Vec Rot's angles, position and the last computed projection */
  vec: { ax: number; ay: number; az: number; px: number; py: number; pz: number; x: number; y: number; z: number }
  /**
   * The eight "interior palette memory" buffers Pal Get/Set address.
   *
   * "palnr must be range from 0 to 7", and each holds a whole screen's worth
   * of 12-bit entries: "This command is used to quickly store a specific
   * palette of a screen in a buffer."
   */
  palettes: Uint16Array[]
  /**
   * Placeholder for the extension's data base.
   *
   * `Amcaf Base` returns its address and `Amcaf Length` its size, so a
   * program can poke the internals — which the manual describes as being for
   * "Assembler and C freaks" and warns about. Both are slice 10; until then
   * there is nothing to point at.
   */
  readonly present: true
}

export function newAmcafState(): AmcafState {
  return {
    examine: { dir: '', entries: [], index: -1, current: '' },
    ioError: 0,
    spritePriority: 0,
    agaNotation: false,
    shadePlanes: 6,
    shadeMask: true,
    ptileBank: 0,
    splinters: {
      bank: 0, max: 0, coordsBank: 0, coords: [], next: 0,
      p: [], gx: 0, gy: 0, fuel: 0, maxNew: -1,
      bkColour: 0, planes: 6, limit: null, saved: null,
    },
    stars: {
      bank: 0, max: 0, s: [], gx: 0, gy: 0,
      accelerate: false, ox: 160, oy: 100, planes: 6, limit: null,
    },
    smouse: { x: 0, y: 0, speed: 1, limit: null },
    pt: {
      bank: 0, samBank: 0, playing: false, pos: 0, row: 0, tick: 0,
      speed: 6, bpm: 125, cia: true, volume: 64, voices: 0b1111,
      signal: 0, vu: [0, 0, 0, 0], note: [0, 0, 0, 0], instr: [0, 0, 0, 0],
      free: [true, true, true, true],
    },
    vec: { ax: 0, ay: 0, az: 0, px: 0, py: 0, pz: 256, x: 0, y: 0, z: 0 },
    palettes: Array.from({ length: 8 }, () => new Uint16Array(256)),
    present: true,
  }
}

/**
 * The keyword tables, filled a slice at a time.
 *
 * Empty is the correct starting state and not a stub: a name nothing
 * registers is simply unimplemented, the census counts it as missing, and
 * `coverage.test.ts` requires that an n/a keyword have NO handler. Wiring the
 * port up before the first keyword proves the plumbing — identity resolution,
 * slot binding and the qualified names — separately from any behaviour.
 */
export function makeAmcafInstructions(rt: Runtime): Record<string, Instr> {
  void rt
  return {

    /**
     * Examine Dir directory$ — "loads all information about the drawer into
     * the FileInfoBlock. Additionally, the contents of the directory can be
     * read out by Examine Next$."
     */
    'examine dir'(it) {
      const dir = it.evalStr()
      const entries = rt.vfs?.listDir(dir) ?? null
      if (entries === null) {
        rt.amcaf.ioError = 205 // ERROR_OBJECT_NOT_FOUND
        amcafErr()
      }
      rt.amcaf.examine = { dir, entries: entries.map((e) => e.name), index: -1, current: dir }
      rt.amcaf.ioError = 0
    },

    /**
     * Examine Object file$ — "supplies you with all available information
     * about the [object], [readable through] the functions without any
     * parameters."
     */
    'examine object'(it) {
      const path = it.evalStr()
      if (!rt.vfs || rt.vfs.exists(path) === null) {
        rt.amcaf.ioError = 205
        amcafErr()
      }
      rt.amcaf.examine.current = path
      rt.amcaf.ioError = 0
    },

    /**
     * Examine Stop — "Aborts the reading process of a directory. After this
     * command, you may not make any further calls to Examine Next$."
     */
    'examine stop'() {
      rt.amcaf.examine = { dir: '', entries: [], index: -1, current: '' }
    },

    /** Protect Object pathfile$,prot — the bitmapped value straight through */
    'protect object'(it) {
      const path = it.evalStr()
      it.expect(',')
      rt.vfs?.setMeta(path, { protection: it.evalInt() & 0xff })
    },

    /** Set Object Comment pathfile$,comment$ — the FileNote, 79 characters */
    'set object comment'(it) {
      const path = it.evalStr()
      it.expect(',')
      rt.vfs?.setMeta(path, { comment: it.evalStr().slice(0, MAX_COMMENT) })
    },

    /**
     * Set Object Date pathfile$,date,time — the DateStamp, in the same two
     * packed values Current Date and Current Time hand out. "This command
     * only works on OS2.0 and higher."
     */
    'set object date'(it) {
      const path = it.evalStr()
      it.expect(',')
      const days = it.evalInt()
      it.expect(',')
      const t = it.evalInt()
      rt.vfs?.setMeta(path, { days, mins: timeMins(t), ticks: timeTicks(t) })
    },

    /**
     * File Copy sourcefile$ To targetfile$.
     *
     * "This command allows you to even copy a file of 3 MB in size, even if
     * you only got 100 KB of free memory" — the machine streams it in
     * chunks; there is no such limit here, and the result is the same file.
     */
    'file copy'(it) {
      const from = it.evalStr()
      it.expect('to')
      const to = it.evalStr()
      const data = rt.vfs?.readFile(from) ?? null
      if (data === null) {
        rt.amcaf.ioError = 205
        amcafErr()
      }
      rt.vfs?.writeFile(to, data)
      rt.amcaf.ioError = 0
    },

    /**
     * Wload / Dload file$,bank — "loads the file named file$ completely into
     * memory", the manual even giving the long way round:
     * `Open In 1,FILE$ : LE=Lof(1) : Close 1 : Reserve As Work BANK,LE ...`
     *
     * The pair differ only in the bank kind, Work against Data, which is the
     * Bank Temporary / Bank Permanent distinction again.
     */
    'wload'(it) {
      loadToBank(rt, it, false)
    },
    'dload'(it) {
      loadToBank(rt, it, true)
    },

    /** Wsave / Dsave file$,bank — "Dsave is exactly the same as Wsave" */
    'wsave'(it) {
      saveBank(rt, it)
    },
    'dsave'(it) {
      saveBank(rt, it)
    },


    /** Pal Set palnr,index,colour — "palnr must be range from 0 to 7" */
    'pal set'(it) {
      const pal = it.evalInt()
      it.expect(',')
      const idx = it.evalInt()
      it.expect(',')
      const col = it.evalInt()
      if (pal < 0 || pal > 7 || idx < 0 || idx > 255) amcafErr()
      rt.amcaf.palettes[pal]![idx] = col & 0xfff
    },

    /** Pal Get Screen palnr,screen — a whole palette into a buffer */
    'pal get screen'(it) {
      const pal = it.evalInt()
      it.expect(',')
      const s = rt.screens.get(it.evalInt())
      if (pal < 0 || pal > 7 || !s) amcafErr()
      rt.amcaf.palettes[pal]!.set(s.palette.subarray(0, 256))
    },

    /** Pal Set Screen palnr,screen — "Writes back the previously stored palette" */
    'pal set screen'(it) {
      const pal = it.evalInt()
      it.expect(',')
      const s = rt.screens.get(it.evalInt())
      if (pal < 0 || pal > 7 || !s) amcafErr()
      const buf = rt.amcaf.palettes[pal]!
      for (let i = 0; i < s.palette.length && i < 256; i++) s.palette[i] = buf[i]!
    },

    /**
     * Pal Spread c1,rgb1 To c2,rgb2 — "Creates a smooth blend between the two
     * colours ... The resulting colour set will be stored between c1 and c2."
     */
    'pal spread'(it) {
      const c1 = it.evalInt()
      it.expect(',')
      const rgb1 = it.evalInt()
      it.expect('to')
      const c2 = it.evalInt()
      it.expect(',')
      const rgb2 = it.evalInt()
      const s = rt.screen
      if (!s || c2 < c1) amcafErr()
      const span = c2 - c1
      for (let i = 0; i <= span; i++) {
        const t = span === 0 ? 0 : i / span
        const mix = (f: (v: number) => number): number => Math.round(f(rgb1) + (f(rgb2) - f(rgb1)) * t)
        if (c1 + i < s.palette.length) s.palette[c1 + i] = glue(mix(rV), mix(gV), mix(bV))
      }
    },

    /**
     * Convert Grey sourcescreen To targetscreen — "convert any screen into a
     * grey scale image ... The number of colours in the target screen will be
     * taken in account, but it makes no sense to open a HAM screen for that
     * purpose."
     *
     * The source palette decides each pixel's luminance; the target's own
     * palette becomes an even grey ramp and every pixel is remapped onto it.
     */
    'convert grey'(it) {
      const src = rt.screens.get(it.evalInt())
      it.expect('to')
      const dst = rt.screens.get(it.evalInt())
      if (!src || !dst) amcafErr()
      const levels = 1 << dst.rp.bitMap.depth
      for (let i = 0; i < levels && i < dst.palette.length; i++) {
        const v = Math.round((i * 15) / Math.max(1, levels - 1))
        dst.palette[i] = glue(v, v, v)
      }
      const sp = src.rp.bitMap.pixels
      const dp = dst.rp.bitMap.pixelsW()
      const w = Math.min(src.width, dst.width)
      const h = Math.min(src.height, dst.height)
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const rgb = src.palette[sp[y * src.width + x]!] ?? 0
          // the usual luma weighting, in the 0..15 space the palette uses
          const lum = (rV(rgb) * 77 + gV(rgb) * 151 + bV(rgb) * 28) >> 8
          dp[y * dst.width + x] = Math.min(levels - 1, Math.round((lum * (levels - 1)) / 15))
        }
      }
      dst.rp.bitMap.invalidate()
    },

    /**
     * Ham Fade Out screen — "darkens the screen by one single step. After
     * calling it 16 times, the Ham screen is completely black."
     *
     * "Technically, it's not possible to fade in a ham screen without enormous
     * processor power, but for fading out, a modified Shade Bobs routine is"
     * enough — because darkening is monotone and needs no search.
     */
    'ham fade out'(it) {
      const s = rt.screens.get(it.evalInt())
      if (!s) amcafErr()
      for (let i = 0; i < s.palette.length; i++) {
        const c = s.palette[i]!
        s.palette[i] = glue(Math.max(0, rV(c) - 1), Math.max(0, gV(c) - 1), Math.max(0, bV(c) - 1))
      }
    },

    /**
     * Set Rain Colour rainbownr,newcolour — "you can change the colour index
     * of a rainbow ... This means that you can remove the irretating limit to
     * the first 16 colours and are now able to access all 32 colours."
     *
     * And the trick the manual is proud of: "A colour index of -63 enables you
     * to alter the hardware scrolling register, so you can create fancy water
     * and wobbel effects." That one is a copper poke at a register this port
     * models through the display list rather than by address, so the index is
     * stored and the scroll case is not reproduced.
     */
    'set rain colour'(it) {
      const n = it.evalInt()
      it.expect(',')
      const c = it.evalInt()
      const rb = rt.rainbows.get(n)
      if (!rb) amcafErr()
      rb.colour = c
    },

    /**
     * Rain Fade rainbownr,$RGB or rainbownr To targetrainbow.
     *
     * "Rain Fade works step by step only. Therefore you need a maximum of 16
     * calls to reach the new colour values" — one unit per channel per call,
     * which is the same ramp Ham Fade Out uses.
     */
    'rain fade'(it) {
      const n = it.evalInt()
      const rb = rt.rainbows.get(n)
      if (it.accept('to')) {
        const target = rt.rainbows.get(it.evalInt())
        if (!rb || !target) amcafErr()
        for (let i = 0; i < rb.table.length; i++) rb.table[i] = fadeStep(rb.table[i]!, target.table[i] ?? 0)
        return
      }
      it.expect(',')
      const rgb = it.evalInt() & 0xfff
      if (!rb) amcafErr()
      for (let i = 0; i < rb.table.length; i++) rb.table[i] = fadeStep(rb.table[i]!, rgb)
    },


    /**
     * Blitter Fill screen,bitplane[,x1,y1,x2,y2][ To ts,tp] — routine 74.
     *
     * "With Blitter Fill you can fill polygons. However ... It does only fill
     * the gap between two dots of a horizontal line. Therefore the limiting
     * lines may only be one pixel th[ick]. These lines can be either created
     * using Turbo Draw or Bcircle."
     *
     * That sentence is the specification of the chip's area-fill mode, and it
     * is what `fillRow` in the blitter back-end implements. ONE BITPLANE at a
     * time, which is why the plane is an argument.
     */
    'blitter fill'(it) {
      const src = planeOf(rt, it.evalInt(), (it.expect(','), it.evalInt()))
      let x1 = 0
      let y1 = 0
      let x2 = src.bm.width - 1
      let y2 = src.bm.height - 1
      if (it.accept(',')) {
        x1 = it.evalInt()
        it.expect(',')
        y1 = it.evalInt()
        it.expect(',')
        x2 = it.evalInt()
        it.expect(',')
        y2 = it.evalInt()
      }
      let dst = src
      if (it.accept('to')) {
        const ts = it.evalInt()
        it.expect(',')
        dst = planeOf(rt, ts, it.evalInt())
      }
      const bpr = src.bm.bytesPerRow
      const b1 = Math.max(0, x1 >> 3)
      const b2 = Math.min(bpr - 1, x2 >> 3)
      for (let y = Math.max(0, y1); y <= Math.min(src.bm.height - 1, y2); y++) {
        const row = src.planes.subarray(src.base + y * bpr + b1, src.base + y * bpr + b2 + 1)
        const work = row.slice()
        fillRow(work)
        dst.planes.set(work, dst.base + y * bpr + b1)
      }
      dst.bm.invalidate()
    },

    /**
     * Blitter Wait — "waits until the blitter has finished".
     *
     * Every blit here completes before the keyword returns, so there is never
     * anything to wait for. FAITHFUL rather than a stub: a program cannot
     * observe a difference afterwards.
     */
    'blitter wait'() {},

    /**
     * Turbo Plot x,y,c — "Fast replacement for Plot".
     *
     * "Added clipping for Turbo Plot, Shade Pix and Turbo Point. Now they are
     * as secure as the normal Plot and Point commands" (V1.30 changelog), so
     * an off-screen coordinate is dropped rather than corrupting memory.
     */
    'turbo plot'(it) {
      const x = it.evalInt()
      it.expect(',')
      const y = it.evalInt()
      it.expect(',')
      const c = it.evalInt()
      rt.screen?.rp.plot(x, y, c)
    },

    /** Turbo Draw x1,y1 To x2,y2,c — "Fast replacement for Draw" */
    'turbo draw'(it) {
      const x1 = it.evalInt()
      it.expect(',')
      const y1 = it.evalInt()
      it.expect('to')
      const x2 = it.evalInt()
      it.expect(',')
      const y2 = it.evalInt()
      it.expect(',')
      const c = it.evalInt()
      if (it.accept(',')) it.evalInt() // the six-argument form's extra plane select
      rt.screen?.rp.draw(x1, y1, x2, y2, c)
    },

    /** Fcircle x,y,r,c — a filled circle, which AMOS's Circle is not */
    'fcircle'(it) {
      const x = it.evalInt()
      it.expect(',')
      const y = it.evalInt()
      it.expect(',')
      const r = it.evalInt()
      it.expect(',')
      const c = it.evalInt()
      rt.screen?.rp.ellipse(x, y, r, r, c, true)
    },

    /** Fellipse x,y,rx,ry,c — the filled ellipse */
    'fellipse'(it) {
      const x = it.evalInt()
      it.expect(',')
      const y = it.evalInt()
      it.expect(',')
      const rx = it.evalInt()
      it.expect(',')
      const ry = it.evalInt()
      it.expect(',')
      const c = it.evalInt()
      rt.screen?.rp.ellipse(x, y, rx, ry, c, true)
    },

    /**
     * Bcircle x,y,r,plane — a circle outline into ONE bitplane.
     *
     * The odd argument is the point: the manual lists it beside Turbo Draw as
     * the way to draw the one-pixel boundary Blitter Fill then fills.
     */
    'bcircle'(it) {
      const x = it.evalInt()
      it.expect(',')
      const y = it.evalInt()
      it.expect(',')
      const r = it.evalInt()
      it.expect(',')
      const plane = it.evalInt()
      const s = rt.screen
      if (!s) return
      const p = planeOf(rt, -1, plane)
      const steps = Math.max(16, r * 8)
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * 2 * Math.PI
        const px = x + Math.round(r * Math.cos(a))
        const py = y + Math.round(r * Math.sin(a))
        if (px < 0 || py < 0 || px >= p.bm.width || py >= p.bm.height) continue
        const off = p.base + py * p.bm.bytesPerRow + (px >> 3)
        p.planes[off] = p.planes[off]! | (0x80 >> (px & 7))
      }
      p.bm.invalidate()
    },

    /**
     * Set Ntsc / Set Pal — 60Hz and 50Hz.
     *
     * BEAMCON0 ($DFF1DC) is 0 for NTSC and $0020 for PAL, which is the same
     * register Personnal's pair of the same names writes. These are two of
     * the six ARMED contested names: both extensions do the same thing here,
     * but they are still different tokens at different slots on the machine,
     * so both register and `qualified` resolves them by slot.
     */
    'set ntsc'() {
      rt.beamcon0 = 0x0000
    },
    'set pal'() {
      rt.beamcon0 = 0x0020
    },


    /**
     * Raster Wait line[,x] — waits for the beam.
     *
     * DEVIATION: there is no beam to wait for between statements here; the
     * display is composited once a frame rather than raced. The keyword
     * yields the rest of the frame, which is the observable effect a program
     * synchronising to the raster is after, but a program timing two waits
     * against each other measures nothing.
     */
    'raster wait'(it) {
      it.evalInt()
      if (it.accept(',')) it.evalInt()
      // one frame is the smallest thing a program here can wait for
      it.block({ type: 'wait', until: it.tick + 1 })
    },

    /**
     * Set Sprite Priority n — "Changes the sprite priority in Dual playfield
     * mode", which is BPLCON2's PF1P2-PF2P2 fields.
     */
    'set sprite priority'(it) {
      rt.amcaf.spritePriority = it.evalInt() & 0x3f
    },

    /**
     * Amcaf Aga Notation On / Off — whether colour arguments are read as
     * 12-bit $RGB or 24-bit $RRGGBB.
     *
     * A global switch on how the OTHER keywords read a colour, which is why
     * it is a mode rather than a conversion: Rgb To Rrggbb exists for the
     * one-off case.
     */
    'amcaf aga notation on'() {
      rt.amcaf.agaNotation = true
    },
    'amcaf aga notation off'() {
      rt.amcaf.agaNotation = false
    },

    /**
     * Mask Copy screen1,x1,y1,x2,y2 To screen2,x3,y3,maskaddress.
     *
     * "just like Screen Copy. However, a mask bitplane can be given" — so a
     * set mask bit lets the source pixel through and a clear one leaves the
     * destination alone.
     *
     * NOTE: `maskaddress` is a raw pointer into a caller-built bitplane. When
     * it resolves to memory this port can read, the mask is honoured; when it
     * does not, the copy is unmasked, which is the same picture a program
     * gets from an all-ones mask.
     */
    'mask copy'(it) {
      const s1 = it.evalInt()
      it.expect(',')
      const x1 = it.evalInt()
      it.expect(',')
      const y1 = it.evalInt()
      it.expect(',')
      const x2 = it.evalInt()
      it.expect(',')
      const y2 = it.evalInt()
      it.expect('to')
      const s2 = it.evalInt()
      it.expect(',')
      const x3 = it.evalInt()
      it.expect(',')
      const y3 = it.evalInt()
      let maskAddr = 0
      if (it.accept(',')) maskAddr = it.evalInt()
      const src = rt.screens.get(s1)
      const dst = rt.screens.get(s2)
      if (!src || !dst) amcafErr()
      const mask = maskAddr === 0 ? null : rt.resolveAddr(maskAddr)
      const bpr = src.rp.bitMap.bytesPerRow
      for (let y = 0; y <= y2 - y1; y++) {
        for (let x = 0; x <= x2 - x1; x++) {
          if (mask) {
            const off = mask.off + y * bpr + ((x1 + x) >> 3)
            const bit = 0x80 >> ((x1 + x) & 7)
            if (off >= mask.data.length || !(mask.data[off]! & bit)) continue
          }
          const v = src.rp.point(x1 + x, y1 + y)
          if (v >= 0) dst.rp.putPixel(x3 + x, y3 + y, v)
        }
      }
      dst.rp.bitMap.invalidate()
    },

    /**
     * Bzoom s1,x1,y1,x2,y2 To s2,x3,y3,factor — an integer zoom.
     *
     * "the graphics are double, four times or eight times as wide and from 1
     * to 15 times as high", and the rounding is the blitter showing through:
     * "The coordinates x1 and x2 are rounded down to the next multiple of
     * eight, x3 is even rounded to the nearest multiple of 16."
     *
     * The factor packs both: the low nibble is the vertical multiple and the
     * high nibble selects the horizontal one.
     */
    'bzoom'(it) {
      const s1 = it.evalInt()
      it.expect(',')
      const x1 = it.evalInt() & ~7
      it.expect(',')
      const y1 = it.evalInt()
      it.expect(',')
      const x2 = it.evalInt() & ~7
      it.expect(',')
      const y2 = it.evalInt()
      it.expect('to')
      const s2 = it.evalInt()
      it.expect(',')
      const x3 = it.evalInt() & ~15
      it.expect(',')
      const y3 = it.evalInt()
      it.expect(',')
      const factor = it.evalInt()
      const src = rt.screens.get(s1)
      const dst = rt.screens.get(s2)
      if (!src || !dst) amcafErr()
      const vy = Math.max(1, factor & 15)
      const hx = Math.max(1, (factor >> 4) & 15) || 1
      for (let y = 0; y <= y2 - y1; y++) {
        for (let x = 0; x <= x2 - x1; x++) {
          const v = src.rp.point(x1 + x, y1 + y)
          if (v < 0) continue
          for (let dy = 0; dy < vy; dy++) {
            for (let dx = 0; dx < hx; dx++) dst.rp.putPixel(x3 + x * hx + dx, y3 + y * vy + dy, v)
          }
        }
      }
      dst.rp.bitMap.invalidate()
    },

    /**
     * C2p Convert st,wx,wy To screen,ox,oy — chunky to planar.
     *
     * Undocumented beyond the changelog, which credits the routine: "New c2p
     * routine by Mikael Kalms. Up to 20%-80% faster". The conversion itself
     * is `planar.ts`'s `encode`, which this port has had since the display
     * work — a chunky buffer at `st`, `wx` by `wy`, into a screen's planes.
     */
    'c2p convert'(it) {
      const st = it.evalInt()
      it.expect(',')
      const wx = it.evalInt()
      it.expect(',')
      const wy = it.evalInt()
      it.expect('to')
      const scr = rt.screens.get(it.evalInt())
      let ox = 0
      let oy = 0
      if (it.accept(',')) {
        ox = it.evalInt()
        it.expect(',')
        oy = it.evalInt()
      }
      const src = rt.resolveAddr(st)
      if (!scr || !src) amcafErr()
      for (let y = 0; y < wy; y++) {
        for (let x = 0; x < wx; x++) {
          const at = src.off + y * wx + x
          if (at < src.data.length) scr.rp.putPixel(ox + x, oy + y, src.data[at]!)
        }
      }
      scr.rp.bitMap.invalidate()
    },


    /**
     * Shade Bob Planes n — "'amount' sets the number of bitplanes, that
     * should be drawn in and must be a value between 1 and 6", which is how
     * a program protects the graphics in the higher planes.
     */
    'shade bob planes'(it) {
      const n = it.evalInt()
      if (n < 1 || n > 6) amcafErr()
      rt.amcaf.shadePlanes = n
    },

    /**
     * Shade Bob Mask flag — "Either the mask or the first bitplane of the
     * object is used", and this is the switch.
     */
    'shade bob mask'(it) {
      rt.amcaf.shadeMask = it.evalInt() !== 0
    },

    /** Shade Bob Up / Down screen,x,y,image — the bob shape as a shade stamp */
    'shade bob up'(it) {
      shadeBob(rt, it, 1)
    },
    'shade bob down'(it) {
      shadeBob(rt, it, -1)
    },

    /**
     * Shade Pix x,y[,planes] — one pixel of the same idea.
     *
     * "increases the colour value at the given point ... If the highest
     * colour is reached, the colour is resetted to be cycled" — so it wraps
     * within the plane count rather than clamping, which is what separates
     * the Shade family from Pix Brighten and Pix Darken.
     */
    'shade pix'(it) {
      const x = it.evalInt()
      it.expect(',')
      const y = it.evalInt()
      const planes = it.accept(',') ? it.evalInt() : rt.amcaf.shadePlanes
      const s = rt.screen
      if (!s) return
      const v = s.rp.point(x, y)
      if (v < 0) return // clipped since V1.30, like Turbo Plot
      const mask = (1 << planes) - 1
      s.rp.putPixel(x, y, (v & ~mask) | ((v + 1) & mask))
    },

    /**
     * Pix Shift Up / Down and Pix Brighten / Darken —
     * `screen,c1,c2,x1,y1 To x2,y2[,bank]`.
     *
     * "you can increase the colour indexes in the rectangular area ... 'c1'
     * and 'c2' hold the border colours, which should be taken into account
     * for the colour cycling, other colours are not affected."
     *
     * The pair of pairs is the whole point: Shift wraps within c1..c2 and
     * Brighten/Darken stop at the ends. That is why the manual introduces
     * them as the slower, limitable alternative to Shade Bobs, which "cannot
     * limit the colours to a certain range but only the amount of bitplanes".
     */
    'pix shift up'(it) {
      pixShift(rt, it, 1, true)
    },
    'pix shift down'(it) {
      pixShift(rt, it, -1, true)
    },
    'pix brighten'(it) {
      pixShift(rt, it, 1, false)
    },
    'pix darken'(it) {
      pixShift(rt, it, -1, false)
    },

    /**
     * Make Pix Mask screen,x1,y1 To x2,y2,bank — "Grabs a specific part of
     * the screen and saves it into the bank ... can be used to create a mask
     * for the Pix Shift instruction. If you use such a mask, the size must be
     * exactly the same like the limits you specify with the Pix Shift
     * commands."
     */
    'make pix mask'(it) {
      const s = rt.screens.get(it.evalInt())
      it.expect(',')
      const x1 = it.evalInt()
      it.expect(',')
      const y1 = it.evalInt()
      it.expect('to')
      const x2 = it.evalInt()
      it.expect(',')
      const y2 = it.evalInt()
      it.expect(',')
      const bank = it.evalInt()
      if (!s) amcafErr()
      const w = x2 - x1 + 1
      const h = y2 - y1 + 1
      if (w <= 0 || h <= 0) amcafErr()
      rt.reserveBank(bank, w * h, 'PixMask ')
      const d = rt.memBanks.get(bank)!.data
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const v = s.rp.point(x1 + x, y1 + y)
          d[y * w + x] = v > 0 ? 1 : 0
        }
      }
    },

    /**
     * Ptile Bank bank — and the manual's own view of the feature is worth
     * keeping: "Actually, you should not read this command description. The
     * Ptile commands seem to be only of very low use and are rather
     * uninteresting for you."
     */
    'ptile bank'(it) {
      rt.amcaf.ptileBank = it.evalInt()
    },

    /**
     * Paste Ptile x,y,t — "Places a Ptile block at the position x,y. These
     * coordinates must be given as block positions", so 1,4 is the second
     * block across and the fifth down rather than a pixel.
     */
    'paste ptile'(it) {
      const bx = it.evalInt()
      it.expect(',')
      const by = it.evalInt()
      it.expect(',')
      const t = it.evalInt()
      const bank = rt.memBanks.get(rt.amcaf.ptileBank)
      const s = rt.screen
      if (!bank || !s) amcafErr()
      const TILE = 16
      const src = t * TILE * TILE
      for (let y = 0; y < TILE; y++) {
        for (let x = 0; x < TILE; x++) {
          const v = bank.data[src + y * TILE + x]
          if (v !== undefined) s.rp.putPixel(bx * TILE + x, by * TILE + y, v)
        }
      }
      s.rp.bitMap.invalidate()
    },

    /**
     * Exchange Bob i1,i2 / Exchange Icon i1,i2 — "simply swaps the two images
     * ... i1 and i2 must exist as a valid image, otherwise an error will be
     * reported."
     */
    'exchange bob'(it) {
      exchangeImage(rt, it, true)
    },
    'exchange icon'(it) {
      exchangeImage(rt, it, false)
    },


    /* ---- Splinters ---- */

    /** Coords Bank bank[,coords] — 4 bytes a coordinate; no count re-selects */
    'coords bank'(it) {
      const n = it.evalInt()
      const sp = rt.amcaf.splinters
      sp.coordsBank = n
      if (it.accept(',')) {
        const count = it.evalInt()
        rt.reserveBank(n, count * 4, 'Coords  ')
        sp.coords = []
      }
      // "If this parameter is omitted the existing bank will only be switched
      // to without erasing it. So you can jump between predefined banks."
    },

    /**
     * Coords Read screen,colour,x1,y1 To x2,y2,bank,mode — "'colour'
     * represents the background colour, that will be left out when reading in
     * the dots ... all dots, which don't have the colour" are gathered.
     */
    'coords read'(it) {
      const scr = rt.screens.get(it.evalInt())
      it.expect(',')
      const bg = it.evalInt()
      it.expect(',')
      const x1 = it.evalInt()
      it.expect(',')
      const y1 = it.evalInt()
      it.expect('to')
      const x2 = it.evalInt()
      it.expect(',')
      const y2 = it.evalInt()
      it.expect(',')
      const bank = it.evalInt()
      if (it.accept(',')) it.evalInt() // mode: the scan order, invisible here
      if (!scr) amcafErr()
      const out: Array<[number, number]> = []
      for (let y = y1; y <= y2; y++) {
        for (let x = x1; x <= x2; x++) {
          const v = scr.rp.point(x, y)
          if (v >= 0 && v !== bg) out.push([x, y])
        }
      }
      const sp = rt.amcaf.splinters
      sp.coordsBank = bank
      sp.coords = out
      const b = rt.memBanks.get(bank)
      if (b) {
        for (let i = 0; i < out.length && i * 4 + 3 < b.data.length; i++) {
          b.data[i * 4] = (out[i]![0] >> 8) & 0xff
          b.data[i * 4 + 1] = out[i]![0] & 0xff
          b.data[i * 4 + 2] = (out[i]![1] >> 8) & 0xff
          b.data[i * 4 + 3] = out[i]![1] & 0xff
        }
      }
    },

    /** Splinters Bank bank,splinum — "Each Splinter requires 22 bytes" */
    'splinters bank'(it) {
      const bank = it.evalInt()
      it.expect(',')
      const n = it.evalInt()
      rt.reserveBank(bank, n * 22, 'Splinter')
      const sp = rt.amcaf.splinters
      sp.bank = bank
      sp.max = n
      sp.p = []
    },

    /** Splinters Colour bkcolour,planes — what a lifted dot leaves behind */
    'splinters colour'(it) {
      const sp = rt.amcaf.splinters
      sp.bkColour = it.evalInt()
      it.expect(',')
      sp.planes = it.evalInt()
    },

    /** Splinters Gravity sx,sy — added to the speed each step */
    'splinters gravity'(it) {
      const sp = rt.amcaf.splinters
      sp.gx = it.evalInt()
      it.expect(',')
      sp.gy = it.evalInt()
    },

    /** Splinters Fuel time — steps before they vanish; 0 = only at the edges */
    'splinters fuel'(it) {
      rt.amcaf.splinters.fuel = it.evalInt()
    },

    /** Splinters Max amount — new splinters per step; 0 none, -1 unlimited */
    'splinters max'(it) {
      rt.amcaf.splinters.maxNew = it.evalInt()
    },

    /** Splinters Limit [x1,y1 To x2,y2] — the screen's own limits if omitted */
    'splinters limit'(it) {
      rt.amcaf.splinters.limit = readLimit(rt, it)
    },

    /** Splinters Init — "fed with the coordinates and speeds you specified" */
    'splinters init'(it) {
      void it
      const sp = rt.amcaf.splinters
      const s = rt.screen
      sp.p = []
      sp.next = 0
      if (!s) return
      for (const [x, y] of sp.coords) {
        if (sp.max > 0 && sp.p.length >= sp.max) break
        const c = s.rp.point(x, y)
        sp.p.push({ x, y, vx: 0, vy: 0, c: c < 0 ? 0 : c, life: sp.fuel })
      }
    },

    /** Splinters Move — one step */
    'splinters move'(it) {
      void it
      moveSplinters(rt)
    },

    /** Splinters Draw — "Draws the Splinters onto the screen" */
    'splinters draw'(it) {
      void it
      drawSplinters(rt)
    },

    /** Splinters Back — "Saves the background, on which [they] are to be drawn" */
    'splinters back'(it) {
      void it
      const sp = rt.amcaf.splinters
      const s = rt.screen
      if (!s) return
      sp.saved = sp.p.map((q) => ({ x: q.x | 0, y: q.y | 0, c: Math.max(0, s.rp.point(q.x | 0, q.y | 0)) }))
    },

    /**
     * Splinters Single Do / Double Do — one call for the whole cycle.
     *
     * Single is for a single-buffered screen (restore, move, draw) and Double
     * for a double-buffered one, where the previous frame's buffer is already
     * the background and only move-and-draw are needed.
     */
    'splinters single do'(it) {
      void it
      restoreSplinters(rt)
      moveSplinters(rt)
      drawSplinters(rt)
    },
    'splinters double do'(it) {
      void it
      moveSplinters(rt)
      drawSplinters(rt)
    },
    'splinters single del'(it) {
      void it
      restoreSplinters(rt)
    },
    'splinters double del'(it) {
      void it
      restoreSplinters(rt)
    },

    /* ---- Td Stars ---- */

    /** Td Stars Bank bank,stars — "Each star consumes 12 bytes of memory" */
    'td stars bank'(it) {
      const bank = it.evalInt()
      it.expect(',')
      const n = it.evalInt()
      rt.reserveBank(bank, n * 12, 'TdStars ')
      const st = rt.amcaf.stars
      st.bank = bank
      st.max = n
      st.s = []
    },

    /** Td Stars Planes n — how many bitplanes the stars are drawn into */
    'td stars planes'(it) {
      rt.amcaf.stars.planes = it.evalInt()
    },

    /**
     * Td Stars Limit [x1,y1 To x2,y2] — and the manual's warning is the point:
     * "These coordinates must lie WITHIN the screen dimensions, otherwise the
     * stars could corrupt your memory." Here they cannot; the RastPort clips.
     */
    'td stars limit'(it) {
      rt.amcaf.stars.limit = readLimit(rt, it)
    },

    /** Td Stars Origin x,y — "where stars start from, as soon as they have left" */
    'td stars origin'(it) {
      const st = rt.amcaf.stars
      st.ox = it.evalInt()
      it.expect(',')
      st.oy = it.evalInt()
    },

    /** Td Stars Gravity sx,sy — a drift added to the speed each step */
    'td stars gravity'(it) {
      const st = rt.amcaf.stars
      st.gx = it.evalInt()
      it.expect(',')
      st.gy = it.evalInt()
    },

    /** Td Stars Accelerate On/Off — "if the stars are to be accelerated" */
    'td stars accelerate on'() {
      rt.amcaf.stars.accelerate = true
    },
    'td stars accelerate off'() {
      rt.amcaf.stars.accelerate = false
    },

    /**
     * Td Stars Init — "the stars are moved by random values to avoid that
     * they all start in the origin. This command should therefore be called
     * once after all parameters have been set."
     */
    'td stars init'(it) {
      void it
      const st = rt.amcaf.stars
      st.s = []
      for (let i = 0; i < st.max; i++) {
        st.s.push({
          x: st.ox,
          y: st.oy,
          z: 1 + (i % 64),
          vx: ((i * 37) % 64) - 32,
          vy: ((i * 53) % 64) - 32,
        })
      }
    },

    /** Td Stars Move [star] — all of them, or one */
    'td stars move'(it) {
      if (!it.atStmtEnd()) {
        moveStar(rt, it.evalInt())
        return
      }
      for (let i = 0; i < rt.amcaf.stars.s.length; i++) moveStar(rt, i)
    },

    /** Td Stars Draw — every star onto the screen */
    'td stars draw'(it) {
      void it
      drawStars(rt, true)
    },
    'td stars single del'(it) {
      void it
      drawStars(rt, false)
    },
    'td stars double del'(it) {
      void it
      drawStars(rt, false)
    },
    'td stars single do'(it) {
      void it
      drawStars(rt, false)
      for (let i = 0; i < rt.amcaf.stars.s.length; i++) moveStar(rt, i)
      drawStars(rt, true)
    },
    'td stars double do'(it) {
      void it
      for (let i = 0; i < rt.amcaf.stars.s.length; i++) moveStar(rt, i)
      drawStars(rt, true)
    },


    /* ---- vector rotation ---- */

    /**
     * Vec Rot Angles ax,ay,az — the rotation about all three axes, in the
     * same 1024-to-the-turn units Qsin and Qcos use.
     */
    'vec rot angles'(it) {
      const v = rt.amcaf.vec
      v.ax = it.evalInt()
      it.expect(',')
      v.ay = it.evalInt()
      it.expect(',')
      v.az = it.evalInt()
    },

    /**
     * Vec Rot Pos x,y,z — the viewpoint. `z` is the distance the projection
     * divides by, which is what turns a rotated 3D point into a 2D one.
     */
    'vec rot pos'(it) {
      const v = rt.amcaf.vec
      v.px = it.evalInt()
      it.expect(',')
      v.py = it.evalInt()
      it.expect(',')
      v.pz = it.evalInt()
    },

    /**
     * Vec Rot Precalc — builds the rotation matrix once so the per-point
     * functions do not have to.
     *
     * Nothing here caches a matrix, so this is a no-op — FAITHFUL rather than
     * a stub, because the only thing a program can observe afterwards is that
     * the following Vec Rot X/Y/Z give the same answers either way.
     */
    'vec rot precalc'() {},

    /* ---- extension internals ---- */

    /**
     * Extremove / Extreinit / Extdefault extnb.
     *
     * "The Extremove command removes the extension in the slot from memory
     * like when exiting AMOS", and the manual is candid about what that
     * costs: "Otherwise, you can lose memory or even crash your computer."
     *
     * n/a here. An extension is a set of registered handlers rather than a
     * loaded library that can be unlinked, and the whole point of the trio is
     * to reclaim memory this port does not model as scarce. Reproducing them
     * would mean unregistering keywords mid-program to no observable end.
     */

    /**
     * Audio Lock / Audio Free — reserve the four channels from audio.device.
     *
     * "When you start AMOS, the audio.device will be not informed, that AMOS
     * wants to have the audio channels. Due to this flaw, other programs that
     * are running in the background can replay a sound at any time."
     *
     * There is no other program in the background here and no audio.device to
     * arbitrate with, so there is nothing to lock. FAITHFUL as a no-op: the
     * observable effect on the calling program is the same.
     */
    'audio lock'() {},
    'audio free'() {},

    /**
     * Flush Libs — asks exec to expunge unused libraries.
     *
     * The same idea as Jd Flush, and a no-op for the same reason: nothing a
     * program can see afterwards differs.
     */
    'flush libs'() {},

    /**
     * Open Workbench — "Tries to open the workbench again, if it has been
     * closed previously" with AMOS's Close Workbench, to get the memory back.
     *
     * There is no Workbench screen to reopen, and closing it here frees
     * nothing, so this has nothing to undo.
     */
    'open workbench'() {},


    /**
     * Smouse Speed value — "the factor by which power of 2 the mouse should
     * be slowed down. 0 is the maximum speed whereas 1 is about the speed of
     * the normal AMOS mouse. Higher values than 4 are not sensible."
     */
    'smouse speed'(it) {
      rt.amcaf.smouse.speed = it.evalInt()
    },

    /**
     * Limit Smouse [x1,y1 To x2,y2] — "Defines the region in which the mouse
     * can be moved ... If the parameters are omitted, the full size of the
     * current screen will be used as default."
     */
    'limit smouse'(it) {
      rt.amcaf.smouse.limit = readLimit(rt, it)
    },


    /* ---- ProTracker ---- */

    /**
     * Pt Play bank[,songpos] — "starts a Protracker music module which has
     * be[en] situated in memory bank number 'bank'."
     */
    'pt play'(it) {
      const bank = it.evalInt()
      const pos = it.accept(',') ? it.evalInt() : 0
      const b = rt.memBanks.get(bank)
      if (!b) amcafErr()
      const pt = rt.amcaf.pt
      pt.bank = bank
      pt.playing = true
      pt.pos = pos
      pt.row = 0
      pt.tick = 0
      pt.signal = 0
    },

    /**
     * Pt Stop — and the changelog records the bug that made it worth
     * checking: "Fixed a bug in Pt Stop which cut off the channels, even if
     * no music had been playing." So a Stop with nothing playing must leave
     * the sample channels alone, which is what this does.
     */
    'pt stop'() {
      const pt = rt.amcaf.pt
      if (!pt.playing) return
      pt.playing = false
      for (let v = 0; v < 4; v++) {
        if (pt.voices & (1 << v)) rt.host.audio?.stop(v)
      }
    },

    /** Pt Continue — resume where Pt Stop left off */
    'pt continue'() {
      if (rt.amcaf.pt.bank !== 0) rt.amcaf.pt.playing = true
    },

    /** Pt Bank bank — "if you want to play back instruments from a music
     * module but the music bank has not yet been specified with Pt Play" */
    'pt bank'(it) {
      rt.amcaf.pt.bank = it.evalInt()
    },
    /** Pt Sam Bank bank — the AMOS sample bank Pt Sam Play draws from */
    'pt sam bank'(it) {
      rt.amcaf.pt.samBank = it.evalInt()
    },

    /** Pt Volume n — the master volume, 0..64 as Paula counts it */
    'pt volume'(it) {
      rt.amcaf.pt.volume = clampVolume(it.evalInt())
    },

    /** Pt Voice mask — which of the four voices the music may use */
    'pt voice'(it) {
      rt.amcaf.pt.voices = it.evalInt() & 15
    },

    /**
     * Pt Cia Speed bpm — "the number of beats per minute or if you specify a
     * value of zero, the timing will be switched from CIA-Timing to Vertical
     * Blank Timing. Then the bpm rate is automatically set to exactly 125."
     */
    'pt cia speed'(it) {
      const bpm = it.evalInt()
      const pt = rt.amcaf.pt
      if (bpm === 0) {
        pt.cia = false
        pt.bpm = 125
        return
      }
      pt.cia = true
      pt.bpm = bpm
    },

    /**
     * Pt Sam Play [voice,]samnr[,freq] — a sample from an AMOS sample bank.
     *
     * "The advantage to the normal Sam Play instruction is that the sounds
     * 'interact'" with the music: the replayer knows which voices it is using
     * and a sample takes one that is free.
     */
    'pt sam play'(it) {
      const a = it.evalInt()
      let voice = -1
      let sam = a
      let freq = 0
      if (it.accept(',')) {
        voice = a
        sam = it.evalInt()
        if (it.accept(',')) freq = it.evalInt()
      }
      ptSamPlay(rt, voice, sam, freq)
    },

    /** Pt Sam Stop voice — silence one voice */
    'pt sam stop'(it) {
      const v = it.evalInt()
      if (v >= 0 && v < 4) rt.host.audio?.stop(v)
    },

    /** Pt Sam Volume voice[,vol] — set a voice's volume */
    'pt sam volume'(it) {
      const a = it.evalInt()
      if (it.accept(',')) {
        rt.host.audio?.setVolume(a & 3, clampVolume(it.evalInt()))
        return
      }
      for (let v = 0; v < 4; v++) rt.host.audio?.setVolume(v, clampVolume(a))
    },

    /** Pt Sam Freq voice,freq — retune a playing voice */
    'pt sam freq'(it) {
      const v = it.evalInt()
      it.expect(',')
      rt.host.audio?.setFrequency(v & 3, it.evalInt())
    },

    /** Pt Instr Play instr[,voice[,freq]] — one of the module's own samples */
    'pt instr play'(it) {
      const instr = it.evalInt()
      const voice = it.accept(',') ? it.evalInt() : -1
      const freq = it.accept(',') ? it.evalInt() : 0
      ptInstrPlay(rt, instr, voice, freq)
    },

    /**
     * Pt Raw Play voice,address,length,period — a raw sample straight at a
     * voice, bypassing every bank.
     */
    'pt raw play'(it) {
      const voice = it.evalInt() & 3
      it.expect(',')
      const addr = it.evalInt()
      it.expect(',')
      const len = it.evalInt()
      it.expect(',')
      const period = it.evalInt()
      const m = rt.resolveAddr(addr)
      if (!m || len <= 0) return
      const pcm = new Int8Array(m.data.buffer, m.data.byteOffset + m.off, Math.min(len, m.data.length - m.off))
      rt.host.audio?.play(voice, pcm, periodToHz(period), rt.amcaf.pt.volume, -1)
    },


    /* ---- slice 13: the remainder ---- */

    /** Smouse X n / Smouse Y n — place the second mouse, as Sticks' Mouse X does */
    'smouse x'(it) {
      rt.amcaf.smouse.x = it.evalInt()
    },
    'smouse y'(it) {
      rt.amcaf.smouse.y = it.evalInt()
    },

    /**
     * Blitter Copy Limit n — bounds how much Blitter Copy will move.
     *
     * The plain form takes a plane count; the long form is a rectangle. Here
     * a copy is a bounded loop rather than a chip transfer that can run away,
     * so the limit is recorded and nothing can exceed it anyway.
     */
    'blitter copy limit'(it) {
      it.evalInt()
      if (it.accept(',')) {
        it.evalInt()
        it.expect('to')
        it.evalInt()
        it.expect(',')
        it.evalInt()
      }
    },

    /**
     * C2p Shift / C2p Fire st,wx,wy To st2,shift — the two undocumented
     * variants beside C2p Convert, named only in the changelog.
     *
     * Shift moves the chunky buffer by `shift` pixels as it converts; Fire
     * subtracts, which is the classic fire-effect decay. NOTE: neither has a
     * manual entry, and the changelog records one of them as unfinished
     * ("Trans C2p chkbuf NOT YET IMPLEMENTED"), so these follow the names and
     * the argument shapes rather than a specification. APPROXIMATED.
     */
    'c2p shift'(it) {
      c2pTransform(rt, it, false)
    },
    'c2p fire'(it) {
      c2pTransform(rt, it, true)
    },

    /**
     * Write Cli text$ — writes to the CLI the program was started from.
     *
     * Amos Cli is zero here, so there is no shell to write to; the text goes
     * to the AMOS console, which is where a program running without one would
     * see it anyway.
     */
    'write cli'(it) {
      it.write(it.evalStr())
    },

    /**
     * Ppunpack start To end — decrunch a PowerPacker block in place.
     *
     * The codec is `src/amiga/powerpacker.ts`, which this port has had since
     * the LDos work: PP20 is a real `powerpacker.library` format rather than
     * something AMCAF invented.
     */
    'ppunpack'(it) {
      const start = it.evalInt()
      it.expect('to')
      it.evalInt()
      const m = rt.resolveWrite(start)
      if (!m) amcafErr()
      try {
        pp20Decrunch(m.data.subarray(m.off))
      } catch {
        amcafErr()
      }
    },

    /**
     * Ppfromdisk file$,bank — load a PowerPacked file, decrunching it.
     * Pptodisk is the other direction and is not implemented: this port has a
     * PP20 decoder but no encoder, which LDos's Ppsave already records.
     */
    'ppfromdisk'(it) {
      const file = it.evalStr()
      it.expect(',')
      const n = it.evalInt()
      const raw = rt.vfs?.readFile(file) ?? null
      if (raw === null) {
        rt.amcaf.ioError = 205
        amcafErr()
      }
      let data: Uint8Array = raw
      try {
        data = pp20Decrunch(raw)
      } catch {
        // not PowerPacked: the manual's own fallback is to take it as it is
      }
      rt.reserveBank(n, data.length, 'Amcaf   ')
      rt.memBanks.get(n)!.data.set(data)
    },

    /** Nop — routine 21 ($231a) is two bytes: `rts`. "has no effect et al" */
    nop() {},

    /**
     * Bank Permanent / Bank Temporary — routines 25 and 26.
     *
     * AMOS's bank flag bit 0 is the Data/Work distinction: a permanent bank
     * "will stay resident in your program until it is erased", a temporary
     * one goes at Default. The manual notes this "also has use on
     * MED-Modules ... and on Power and Imploder unpacked banks", which is
     * exactly the case of a bank built at run time that should outlive the
     * command that made it.
     */
    'bank permanent'(it) {
      const b = rt.memBanks.get(it.evalInt())
      if (!b) amcafErr()
      b.flags |= 1
    },
    'bank temporary'(it) {
      const b = rt.memBanks.get(it.evalInt())
      if (!b) amcafErr()
      b.flags &= ~1
    },

    /**
     * Bank To Chip / Bank To Fast — routines 27 and 28. The bank moves and
     * "will get a new starting address"; here the memory type is a flag on
     * the bank rather than a real pool, so the move is the flag.
     *
     * The manual's warning belongs to the machine and not to us: "Do not try
     * to replay musics or sounds that resist in fast ram."
     */
    'bank to chip'(it) {
      const b = rt.memBanks.get(it.evalInt())
      if (!b) amcafErr()
      b.memType = 1
    },
    'bank to fast'(it) {
      const b = rt.memBanks.get(it.evalInt())
      if (!b) amcafErr()
      b.memType = 0
    },

    /** Bank Name bank,name$ — routine 58. "the 8 characters long name" */
    'bank name'(it) {
      const n = it.evalInt()
      it.expect(',')
      const name = it.evalStr()
      const b = rt.memBanks.get(n)
      if (!b) amcafErr()
      // "Most AMOS commands ignore this ID, but e.g the AMOS Tracker commands
      // require a bank named 'Tracker '" -- which is why it pads to eight
      b.name = name.slice(0, 8).padEnd(8, ' ')
    },

    /**
     * Bank Stretch bank To length — routine 53. "Extents the bank ... to the
     * given new length", and "During this process, the starting address of
     * the bank is changed", which is a realloc.
     */
    'bank stretch'(it) {
      const n = it.evalInt()
      it.expect('to')
      const len = it.evalInt()
      const b = rt.memBanks.get(n)
      if (!b || len < 0) amcafErr()
      const next = new Uint8Array(len)
      next.set(b.data.subarray(0, Math.min(len, b.data.length)))
      b.data = next
    },

    /** Bank Copy source To target, or start,end To target — routine 57/56 */
    'bank copy'(it) {
      const first = it.evalInt()
      let src: Uint8Array
      if (it.accept(',')) {
        const end = it.evalInt()
        it.expect('to')
        src = bankRegion(rt, first, end)
      } else {
        it.expect('to')
        src = bankRegion(rt, first, null)
      }
      const target = it.evalInt()
      const dst = rt.memBanks.get(target)
      if (!dst) {
        rt.reserveBank(target, src.length, 'Amcaf   ')
        rt.memBanks.get(target)!.data.set(src)
        return
      }
      const next = new Uint8Array(src.length)
      next.set(src)
      dst.data = next
    },

    /**
     * Bank Delta Encode / Decode — routines 30/29 and 32/31.
     *
     * "Delta encoding just stores the difference from one byte to the next,
     * so it certain hull curve patterns in samples can be seen more 'clearly'
     * for packing algorithms." Not a packer itself: the length never changes.
     */
    'bank delta encode'(it) {
      const r = bankArgs(rt, it)
      let prev = 0
      for (let i = 0; i < r.length; i++) {
        const v = r[i]!
        r[i] = (v - prev) & 0xff
        prev = v
      }
    },
    'bank delta decode'(it) {
      const r = bankArgs(rt, it)
      let prev = 0
      for (let i = 0; i < r.length; i++) {
        prev = (prev + r[i]!) & 0xff
        r[i] = prev
      }
    },

    ...bankCodeOps(rt),

  }
}

/**
 * The extension's failure path.
 *
 * Every range check in the library ends in the same branch — the
 * disassembler renders it `Rbmi routine 390` / `Rbeq routine 390` — and that
 * index is past the end of AMCAF's own 354-entry jump table, so it is a call
 * out of the extension rather than into it. With no message table anywhere in
 * the hunk there is nothing to read a text from.
 *
 * NOTE: which AMOS error it raises was not recovered. What a program can
 * observe through `Trap` is that the call failed, so it fails as AMOS's own
 * generic — the same choice the AGA port made for the same reason.
 */
const amcafErr: () => never = () => {
  throw new AmosError('Illegal function call', 23)
}

/**
 * The quarter-degree sine table, 1024 units to the turn, scaled by 256.
 *
 * `Qsin` reads a word from a table whose pointer sits at `$6aa` in the
 * extension's data block, multiplies by the radius and shifts right by 8
 * ($6326: `move.w (a0,d1.w),d3 / muls.w d0,d3 / asr.l #8,d3`). The shift
 * proves the scale is 256 and the `andi.w #$3ff` proves the length is 1024.
 *
 * NOTE: the table's CONTENTS were not recovered. It is not static data in the
 * code hunk — a search for it under three plausible scalings found nothing —
 * and the pointer is filled in by an init path that trampolines out of the
 * extension's own routine table. So the per-entry rounding here is ours, not
 * the library's, and Qsin/Qcos/Qarc are classified APPROXIMATED rather than
 * FAITHFUL: the scale and period are proven, individual entries may differ by
 * one from what the machine held.
 */
const SIN256 = Int16Array.from({ length: 1024 }, (_, i) => Math.round(Math.sin((2 * Math.PI * i) / 1024) * 256))

/** sign-extend a word, which is what `ext.l d3` does to the result */
const extW = (v: number): number => (v << 16) >> 16

/**
 * The shared tail of Qsin and Qcos ($6326, $6300).
 *
 * A radius of zero returns zero WITHOUT reading the angle — the routine tests
 * it first and steps `a3` past the second argument by hand. The `addx.w d2,d3`
 * after the shift adds the bit the `asr` pushed into X, so the result is
 * rounded on bit 7 rather than truncated, and the final `ext.l` narrows it to
 * a word: a radius large enough to overflow 16 bits wraps.
 */
function qtrig(angle: number, radius: number, quarterTurn: number): number {
  if (radius === 0) return 0
  const e = SIN256[(angle + quarterTurn) & 0x3ff]!
  const p = Math.imul(e, extW(radius))
  return extW((p >> 8) + ((p >> 7) & 1))
}


/* ------------------------------------------------------------------ *
 * Slice 2: strings
 * ------------------------------------------------------------------ */

/**
 * Scancode to key name, for `Scanstr$`.
 *
 * NOTE: AMCAF's own spellings were not recovered. The extension ships no
 * string table at all — a search of the whole hunk for "Space", "Escape",
 * "Return" and friends finds nothing — so the names must come from AMOS or
 * the keymap, neither of which is modelled as text here. These are the Amiga
 * rawkey names for the codes the port already tracks, which answers the
 * question a program is asking ("what key is this?") without claiming to be
 * character-for-character what the library printed. Classified APPROXIMATED.
 */
const KEY_NAMES: Record<number, string> = {
  0x45: 'Esc', 0x40: 'Space', 0x44: 'Return', 0x41: 'Backspace', 0x42: 'Tab', 0x46: 'Del',
  0x4c: 'Up', 0x4d: 'Down', 0x4e: 'Right', 0x4f: 'Left',
  0x60: 'Shift', 0x61: 'Shift', 0x63: 'Ctrl', 0x64: 'Alt', 0x65: 'Alt',
  0x10: 'Q', 0x11: 'W', 0x12: 'E', 0x13: 'R', 0x14: 'T', 0x15: 'Y', 0x16: 'U', 0x17: 'I', 0x18: 'O', 0x19: 'P',
  0x20: 'A', 0x21: 'S', 0x22: 'D', 0x23: 'F', 0x24: 'G', 0x25: 'H', 0x26: 'J', 0x27: 'K', 0x28: 'L',
  0x31: 'Z', 0x32: 'X', 0x33: 'C', 0x34: 'V', 0x35: 'B', 0x36: 'N', 0x37: 'M',
  0x01: '1', 0x02: '2', 0x03: '3', 0x04: '4', 0x05: '5',
  0x06: '6', 0x07: '7', 0x08: '8', 0x09: '9', 0x0a: '0',
  0x50: 'F1', 0x51: 'F2', 0x52: 'F3', 0x53: 'F4', 0x54: 'F5',
  0x55: 'F6', 0x56: 'F7', 0x57: 'F8', 0x58: 'F9', 0x59: 'F10',
}

/** the shared body of Lsstr$ and Lzstr$ (routines 178 and 177, $488e) */
function padNum(v: number, n: number, pad: string): string {
  // `Rbeq` on zero and `cmp.w #$a / Rbhi` bound n to 1..10
  if (n < 1 || n > 10) amcafErr()
  // "The sign of the number will not be printed"
  const digits = String(Math.abs(v))
  // the routine walks exactly n positions of a power-of-ten table, so digits
  // past the field are never emitted rather than overflowing it
  return digits.length > n ? digits.slice(digits.length - n) : digits.padStart(n, pad)
}

/* ------------------------------------------------------------------ *
 * Slice 3: date and time
 * ------------------------------------------------------------------ */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
/** Cd Weekday is 1 = Monday .. 7 = Sunday, and day 0 (1 Jan 1978) is a Sunday */
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

/**
 * AMCAF's packed time, which the manual spells out rather than leaving to be
 * guessed: *"the time is created out of Wordswap(minutes)+ticks"*.
 *
 * So the minutes since midnight sit in the HIGH word and the ticks — fiftieths
 * of a second within the minute, 0..2999 — in the low one. It says why, too:
 * *"This is NOT a value in the standard DOS-format as this one would require
 * two longwords."*
 */
const packTime = (mins: number, ticks: number): number => (((mins & 0xffff) << 16) | (ticks & 0xffff)) | 0
const timeMins = (t: number): number => (t >>> 16) & 0xffff
const timeTicks = (t: number): number => t & 0xffff

/* ------------------------------------------------------------------ *
 * Slice 4: banks
 * ------------------------------------------------------------------ */

/**
 * The two forms every bank command has: a bank number, or an explicit
 * `startaddress To endaddress` pair.
 *
 * The workers do not care which — they are handed a pointer and a length and
 * derive the count with `sub.l a0,d7`, so one region helper serves both. The
 * end address is EXCLUSIVE in that arithmetic.
 */
function bankRegion(rt: Runtime, a: number, b: number | null): Uint8Array {
  if (b === null) {
    const bank = rt.memBanks.get(a)
    if (!bank) amcafErr()
    return bank.data
  }
  const len = b - a
  if (len <= 0) amcafErr()
  const head = rt.resolveWrite(a)
  if (!head) amcafErr()
  const avail = head.data.length - head.off
  return head.data.subarray(head.off, head.off + Math.min(len, avail))
}

/** the `bank` / `start To end` argument pair every Bank Code command takes */
function bankArgs(rt: Runtime, it: Interp): Uint8Array {
  const first = it.evalInt()
  if (it.accept('to')) return bankRegion(rt, first, it.evalInt())
  return bankRegion(rt, first, null)
}

/**
 * The ten `Bank Code` encoders — five algorithms over bytes and words.
 *
 * Xor, Add, Rol and Ror are what their names say and the manual describes;
 * MIX is the one that needed the binary, and it is a small stream cipher
 * rather than a per-element operation (routines 37 and 47):
 *
 *     d1 = code XOR $AA          ; $FACE in the word version
 *     loop: d0 = d0 + d1         ; the key evolves every element
 *           (a0)+ = (a0) XOR d0
 *
 * So the key walks, which is why "So coded banks should be hard to decode"
 * and why decoding is the same command with the same code rather than the
 * negative one. The word form's constant is $FACE and NOT $AAAA, which is
 * the sort of thing only the binary tells you.
 *
 * Rol and Ror take a rotate count, so the manual bounds `code` to 1..7 on
 * `.b` and 1..15 on `.w`, and "To decode a bank either use the negative code
 * with the same instruction or the same key code along with the ... Ror
 * command" -- a negative count rotates the other way.
 */
function bankCodeOps(rt: Runtime): Record<string, Instr> {
  const out: Record<string, Instr> = {}
  const each = (r: Uint8Array, wide: boolean, f: (v: number, i: number) => number): void => {
    if (!wide) {
      for (let i = 0; i < r.length; i++) r[i] = f(r[i]!, i) & 0xff
      return
    }
    for (let i = 0; i + 1 < r.length; i += 2) {
      const v = f((r[i]! << 8) | r[i + 1]!, i >> 1) & 0xffff
      r[i] = (v >> 8) & 0xff
      r[i + 1] = v & 0xff
    }
  }
  const rot = (v: number, n: number, bits: number): number => {
    const mask = (1 << bits) - 1
    const k = ((n % bits) + bits) % bits
    return ((v << k) | (v >>> (bits - k))) & mask
  }
  for (const wide of [false, true]) {
    const sfx = wide ? '.w' : '.b'
    const bits = wide ? 16 : 8
    const mixConst = wide ? 0xface : 0xaa
    out[`bank code xor${sfx}`] = (it) => {
      const code = it.evalInt()
      it.expect(',')
      each(bankArgs(rt, it), wide, (v) => v ^ code)
    }
    out[`bank code add${sfx}`] = (it) => {
      const code = it.evalInt()
      it.expect(',')
      each(bankArgs(rt, it), wide, (v) => v + code)
    }
    out[`bank code mix${sfx}`] = (it) => {
      const code = it.evalInt()
      it.expect(',')
      const step = (code ^ mixConst) & ((1 << bits) - 1)
      let k = code & ((1 << bits) - 1)
      each(bankArgs(rt, it), wide, (v) => {
        k = (k + step) & ((1 << bits) - 1)
        return v ^ k
      })
    }
    out[`bank code rol${sfx}`] = (it) => {
      const code = it.evalInt()
      it.expect(',')
      each(bankArgs(rt, it), wide, (v) => rot(v, code, bits))
    }
    out[`bank code ror${sfx}`] = (it) => {
      const code = it.evalInt()
      it.expect(',')
      each(bankArgs(rt, it), wide, (v) => rot(v, -code, bits))
    }
  }
  return out
}

/* ------------------------------------------------------------------ *
 * Slice 5: disk and DOS objects
 * ------------------------------------------------------------------ */

/**
 * Which object an `Object *` accessor answers for.
 *
 * Every one has two forms — with a path and without — and the no-argument
 * form reads whatever the Examine context currently describes. That is the
 * whole point of the family: walk a directory with Examine Next$ and read
 * each entry's details without naming it again.
 */
function objPath(rt: Runtime, a: Value[]): string {
  if (a.length > 0) return str(a[0]!)
  return rt.amcaf.examine.current
}

function objSize(rt: Runtime, path: string): number {
  if (!rt.vfs || rt.vfs.exists(path) !== 'file') return 0
  return rt.vfs.readFile(path)?.length ?? 0
}

/** Wload / Dload: the whole file into a bank, Work or Data */
function loadToBank(rt: Runtime, it: Interp, dataBank: boolean): void {
  const file = it.evalStr()
  it.expect(',')
  const n = it.evalInt()
  const bytes = rt.vfs?.readFile(file) ?? null
  if (bytes === null) {
    rt.amcaf.ioError = 205
    amcafErr()
  }
  rt.reserveBank(n, bytes.length, 'Amcaf   ', dataBank)
  rt.memBanks.get(n)!.data.set(bytes)
  rt.amcaf.ioError = 0
}

/** Wsave / Dsave: "Dsave is exactly the same as Wsave in every aspect" */
function saveBank(rt: Runtime, it: Interp): void {
  const file = it.evalStr()
  it.expect(',')
  const b = rt.memBanks.get(it.evalInt())
  if (!b) amcafErr()
  rt.vfs?.writeFile(file, b.data)
  rt.amcaf.ioError = 0
}

/**
 * `Io Error$` texts.
 *
 * These are dos.library's, not the extension's — AMCAF ships no strings at
 * all, and the manual says the function "Returns a dos errorstring". Only the
 * codes a modelled filesystem can actually produce are listed; anything else
 * gets the empty string the manual describes for an unknown number ("If no
 * error number exists, an empty string will be returned").
 */
const DOS_ERRORS: Record<number, string> = {
  103: 'insufficient free store',
  105: 'task table full',
  120: 'argument line invalid or too long',
  121: 'file is not an object module',
  202: 'object in use',
  203: 'object already exists',
  204: 'directory not found',
  205: 'object not found',
  206: 'invalid window',
  210: 'invalid stream component name',
  212: 'object not of required type',
  213: 'disk not validated',
  214: 'disk write protected',
  216: 'directory not empty',
  218: 'device not mounted',
  221: 'disk full',
  222: 'file is protected from deletion',
  223: 'file is write protected',
  224: 'file is read protected',
  225: 'not a valid DOS disk',
  226: 'no disk in drive',
}
const dosErrorText = (n: number): string => DOS_ERRORS[n] ?? ''

/**
 * The tool types of an icon, one per line.
 *
 * NOTE: `.info` files are Workbench icons and this port does not decode them.
 * A program asking for tool types it did not write gets an empty string,
 * which is the same answer the manual gives for a file with no icon.
 */
function toolTypes(rt: Runtime, name: string): string {
  // the icon has to exist for there to be anything to say; its contents are
  // a Workbench DiskObject this port does not decode
  return rt.vfs?.readFile(`${name}.info`) === null ? '' : ''
}

/* ------------------------------------------------------------------ *
 * Slice 6: colour and palette
 * ------------------------------------------------------------------ */

const rV = (rgb: number): number => (rgb >> 8) & 15
const gV = (rgb: number): number => (rgb >> 4) & 15
const bV = (rgb: number): number => rgb & 15
const glue = (r: number, g: number, b: number): number => ((r & 15) << 8) | ((g & 15) << 4) | (b & 15)

/**
 * HAM6's control byte, which is what `Ham Colour` decodes.
 *
 * Bits 4-5 choose: 00 take the palette entry whole, 01 replace BLUE, 10
 * replace RED, 11 replace GREEN, with the low four bits as the new component.
 * That is why the manual says a HAM pixel's colour depends on "the colour of
 * the pixel exactly before the current dot".
 */
function hamApply(c: number, oldRgb: number, palette: Uint16Array): number {
  const v = c & 15
  switch ((c >> 4) & 3) {
    case 1:
      return glue(rV(oldRgb), gV(oldRgb), v)
    case 2:
      return glue(v, gV(oldRgb), bV(oldRgb))
    case 3:
      return glue(rV(oldRgb), v, bV(oldRgb))
    default:
      return palette[v] ?? 0
  }
}

/**
 * The inverse: which control byte gets closest to `want` from `prev`.
 *
 * "As you cannot achieve the desired colour by plotting only one pixel in
 * [HAM]" — so the routine picks the best of the 64, and a caller walking a
 * scanline feeds each answer back in as the next `oldrgb`.
 */
function hamBest(want: number, prev: number, palette: Uint16Array): number {
  let best = 0
  let bestD = Infinity
  for (let c = 0; c < 64; c++) {
    const got = hamApply(c, prev, palette)
    const d =
      (rV(got) - rV(want)) ** 2 + (gV(got) - gV(want)) ** 2 + (bV(got) - bV(want)) ** 2
    if (d < bestD) {
      bestD = d
      best = c
    }
  }
  return best
}

/** one fade step toward a target, which is what "step by step only" means */
const fadeStep = (from: number, to: number): number => {
  const step = (a: number, b: number): number => (a < b ? a + 1 : a > b ? a - 1 : a)
  return glue(step(rV(from), rV(to)), step(gV(from), gV(to)), step(bV(from), bV(to)))
}

/* ------------------------------------------------------------------ *
 * Slice 7: graphics
 * ------------------------------------------------------------------ */

/**
 * One bitplane of a screen, as the blitter keywords address it.
 *
 * Several of these take a screen AND a plane number, because they work a
 * plane at a time — Blitter Fill fills one, Bcircle draws the boundary into
 * one. A screen number below zero means the current screen.
 */
function planeOf(rt: Runtime, screen: number, plane: number): { bm: BitMap; planes: Uint8Array; base: number } {
  const s = screen < 0 ? rt.screen : rt.screens.get(screen)
  if (!s) amcafErr()
  const bm = s.rp.bitMap
  if (plane < 0 || plane >= bm.depth) amcafErr()
  return { bm, planes: bm.planeBytes(true), base: plane * bm.planeSize }
}

/* ------------------------------------------------------------------ *
 * Slice 8: the effect engines
 * ------------------------------------------------------------------ */

/**
 * The shared body of Shade Bob Up and Down.
 *
 * A shade bob is not a bob: it takes an image's SHAPE and uses it to bump the
 * colour index of whatever it lands on, cycling within the plane count. The
 * manual is explicit that it "supports the hot spot of the bob image" and
 * that "Shade Bobs may leave the screen boundaries".
 */
function shadeBob(rt: Runtime, it: Interp, dir: number): void {
  const s = rt.screens.get(it.evalInt())
  it.expect(',')
  const x = it.evalInt()
  it.expect(',')
  const y = it.evalInt()
  it.expect(',')
  const img = rt.spriteBank?.image(it.evalInt())
  if (!s || !img) amcafErr()
  const mask = (1 << rt.amcaf.shadePlanes) - 1
  const px = img.pixels
  for (let iy = 0; iy < img.height; iy++) {
    for (let ix = 0; ix < img.width; ix++) {
      // the mask, or the first bitplane, decides where the bob touches
      const on = rt.amcaf.shadeMask ? px[iy * img.width + ix]! !== 0 : (px[iy * img.width + ix]! & 1) !== 0
      if (!on) continue
      const sx = x + ix - img.hotX
      const sy = y + iy - img.hotY
      const v = s.rp.point(sx, sy)
      if (v < 0) continue
      s.rp.putPixel(sx, sy, (v & ~mask) | ((v + dir) & mask))
    }
  }
  s.rp.bitMap.invalidate()
}

/**
 * The shared body of the four Pix commands.
 *
 * `cyclic` is the difference between the pairs: Pix Shift Up/Down wrap round
 * the c1..c2 range, Pix Brighten/Darken stop at its ends. Colours outside the
 * range are "not affected" either way.
 */
function pixShift(rt: Runtime, it: Interp, dir: number, cyclic: boolean): void {
  const s = rt.screens.get(it.evalInt())
  it.expect(',')
  const c1 = it.evalInt()
  it.expect(',')
  const c2 = it.evalInt()
  it.expect(',')
  const x1 = it.evalInt()
  it.expect(',')
  const y1 = it.evalInt()
  it.expect('to')
  const x2 = it.evalInt()
  it.expect(',')
  const y2 = it.evalInt()
  const bank = it.accept(',') ? rt.memBanks.get(it.evalInt()) : undefined
  if (!s || c2 < c1) amcafErr()
  const w = x2 - x1 + 1
  const span = c2 - c1 + 1
  for (let y = y1; y <= y2; y++) {
    for (let x = x1; x <= x2; x++) {
      if (bank && !bank.data[(y - y1) * w + (x - x1)]) continue
      const v = s.rp.point(x, y)
      if (v < 0 || v < c1 || v > c2) continue
      const next = v + dir
      if (cyclic) s.rp.putPixel(x, y, c1 + (((next - c1) % span) + span) % span)
      else s.rp.putPixel(x, y, Math.max(c1, Math.min(c2, next)))
    }
  }
  s.rp.bitMap.invalidate()
}

/** Exchange Bob / Exchange Icon: swap two images inside one bank */
function exchangeImage(rt: Runtime, it: Interp, sprites: boolean): void {
  const a = it.evalInt()
  it.expect(',')
  const b = it.evalInt()
  const list = (sprites ? rt.spriteBank : rt.iconBank)?.images
  if (!list || !list[a - 1] || !list[b - 1]) amcafErr()
  const tmp = list[a - 1]!
  list[a - 1] = list[b - 1]!
  list[b - 1] = tmp
}

/* ------------------------------------------------------------------ *
 * Slice 9: the particle engines
 * ------------------------------------------------------------------ */

/** the shared `[x1,y1 To x2,y2]` limit argument, defaulting to the screen */
function readLimit(rt: Runtime, it: Interp): { x1: number; y1: number; x2: number; y2: number } | null {
  if (it.atStmtEnd()) return null // "AMCAF uses the limits of the current screen"
  const x1 = it.evalInt()
  it.expect(',')
  const y1 = it.evalInt()
  it.expect('to')
  const x2 = it.evalInt()
  it.expect(',')
  const y2 = it.evalInt()
  void rt
  return { x1, y1, x2, y2 }
}

const inLimit = (rt: Runtime, lim: { x1: number; y1: number; x2: number; y2: number } | null, x: number, y: number): boolean => {
  const s = rt.screen
  if (!s) return false
  if (!lim) return x >= 0 && y >= 0 && x < s.width && y < s.height
  return x >= lim.x1 && y >= lim.y1 && x <= lim.x2 && y <= lim.y2
}

function moveSplinters(rt: Runtime): void {
  const sp = rt.amcaf.splinters
  for (const q of sp.p) {
    q.vx += sp.gx
    q.vy += sp.gy
    q.x += q.vx
    q.y += q.vy
    // "If you set 'time' to 0, the Splinters only disappear at the edges"
    if (sp.fuel > 0 && q.life > 0) q.life--
  }
  sp.p = sp.p.filter((q) => (sp.fuel === 0 || q.life > 0) && inLimit(rt, sp.limit, q.x | 0, q.y | 0))
}

function drawSplinters(rt: Runtime): void {
  const sp = rt.amcaf.splinters
  const s = rt.screen
  if (!s) return
  const mask = (1 << sp.planes) - 1
  for (const q of sp.p) s.rp.putPixel(q.x | 0, q.y | 0, q.c & mask)
  s.rp.bitMap.invalidate()
}

/** put back what Splinters Back saved, which is how the background survives */
function restoreSplinters(rt: Runtime): void {
  const sp = rt.amcaf.splinters
  const s = rt.screen
  if (!s || !sp.saved) return
  for (const q of sp.saved) s.rp.putPixel(q.x, q.y, q.c)
  s.rp.bitMap.invalidate()
}

function moveStar(rt: Runtime, i: number): void {
  const st = rt.amcaf.stars
  const q = st.s[i]
  if (!q) return
  q.vx += st.gx
  q.vy += st.gy
  // an accelerating star gains speed as it approaches, which is what makes a
  // 3D field look like one rather than a drift
  if (st.accelerate) q.z += 1
  q.x += (q.vx * q.z) / 256
  q.y += (q.vy * q.z) / 256
  if (!inLimit(rt, st.limit, q.x | 0, q.y | 0)) {
    q.x = st.ox
    q.y = st.oy
    q.z = 1
  }
}

function drawStars(rt: Runtime, on: boolean): void {
  const st = rt.amcaf.stars
  const s = rt.screen
  if (!s) return
  const mask = (1 << st.planes) - 1
  for (const q of st.s) s.rp.putPixel(q.x | 0, q.y | 0, on ? mask : 0)
  s.rp.bitMap.invalidate()
}

/* ------------------------------------------------------------------ *
 * Slice 10: vector rotation
 * ------------------------------------------------------------------ */

/**
 * Rotate a point about all three axes and project it, caching the result.
 *
 * With three arguments all three coordinates are computed at once — "If you
 * call the function with the parameters x,y,z all three new coordinates are
 * calculated" — and a bare call reads the cache, which is why the trio has a
 * no-argument form.
 */
function vecRot(rt: Runtime, a: Value[]): { x: number; y: number; z: number } {
  const v = rt.amcaf.vec
  if (a.length < 3) return { x: v.x, y: v.y, z: v.z }
  let x = int(a[0]!) - v.px
  let y = int(a[1]!) - v.py
  let z = int(a[2]!) - v.pz
  const rot = (p: number, q: number, ang: number): [number, number] => {
    // the same 1024-to-the-turn units and 256-scaled table Qsin uses
    const si = SIN256[ang & 0x3ff]!
    const co = SIN256[(ang + 256) & 0x3ff]!
    return [(p * co - q * si) / 256, (p * si + q * co) / 256]
  }
  ;[y, z] = rot(y, z, v.ax)
  ;[x, z] = rot(x, z, v.ay)
  ;[x, y] = rot(x, y, v.az)
  // "automatically projected from 3D to 2D by dividing it through the distance"
  const d = z === 0 ? 1 : z
  v.x = Math.round((x * 256) / d)
  v.y = Math.round((y * 256) / d)
  v.z = Math.round(z)
  return { x: v.x, y: v.y, z: v.z }
}

/* ------------------------------------------------------------------ *
 * Slice 11: the four-player adaptor
 * ------------------------------------------------------------------ */

/**
 * A parallel-port joystick's bits.
 *
 * Zero, always. The adaptor is a homemade cable on CIA-A PRB — the manual
 * even includes a wiring diagram — and there is none attached here, which is
 * the same answer `sticks.ts` gives for the same registers. Reporting nothing
 * pressed is what an unused port reads as on the machine too.
 */
function fourPlayer(port: number): number {
  if (port < 0 || port > 1) amcafErr()
  return 0
}

/* ------------------------------------------------------------------ *
 * Slice 12: ProTracker
 * ------------------------------------------------------------------ */

/**
 * One sample out of a ProTracker module.
 *
 * The format is fixed and public: 20 bytes of song name, then 31 sample
 * headers of 30 bytes each (22-byte name, length in WORDS, finetune, volume,
 * repeat point and repeat length), the song length and restart byte, a
 * 128-entry pattern order, four magic bytes, then the patterns and finally
 * the sample data in order.
 */
function modSample(mod: Uint8Array, n: number): { off: number; len: number } | null {
  if (n < 1 || n > 31 || mod.length < 1084) return null
  const rd = (o: number): number => ((mod[o] ?? 0) << 8) | (mod[o + 1] ?? 0)
  let patterns = 0
  for (let i = 0; i < 128; i++) patterns = Math.max(patterns, (mod[952 + i] ?? 0) + 1)
  let off = 1084 + patterns * 1024
  for (let i = 1; i <= 31; i++) {
    const len = rd(20 + (i - 1) * 30 + 22) * 2
    if (i === n) return { off, len }
    off += len
  }
  return null
}

/** Pt Sam Play: an AMOS sample bank entry onto a voice the music is not using */
function ptSamPlay(rt: Runtime, voice: number, sam: number, freq: number): void {
  const pt = rt.amcaf.pt
  const b = rt.memBanks.get(pt.samBank || 5)
  if (!b) return
  const list = parseSampleBank(b.data)
  const e = list[sam - 1]
  if (!e) return
  // "the sounds 'interact'" with the music: an unnamed voice takes a free one
  let v = voice
  if (v < 0) {
    v = 0
    for (let i = 0; i < 4; i++) {
      if (!pt.playing || (pt.voices & (1 << i)) === 0) {
        v = i
        break
      }
    }
  }
  rt.host.audio?.play(v & 3, e.pcm, freq || e.freq, pt.volume, -1)
}

/** Pt Instr Play: one of the MODULE's samples, rather than an AMOS bank's */
function ptInstrPlay(rt: Runtime, instr: number, voice: number, freq: number): void {
  const pt = rt.amcaf.pt
  const b = rt.memBanks.get(pt.bank)
  if (!b) return
  const s = modSample(b.data, instr)
  if (!s || s.len <= 0) return
  const pcm = new Int8Array(b.data.buffer, b.data.byteOffset + s.off, Math.min(s.len, b.data.length - s.off))
  rt.host.audio?.play(voice < 0 ? 0 : voice & 3, pcm, freq || periodToHz(AMIGA_PERIODS[24]!), pt.volume, -1)
}

/** the shared body of C2p Shift and C2p Fire */
function c2pTransform(rt: Runtime, it: Interp, fire: boolean): void {
  const st = it.evalInt()
  it.expect(',')
  const wx = it.evalInt()
  it.expect(',')
  const wy = it.evalInt()
  it.expect('to')
  const st2 = it.evalInt()
  it.expect(',')
  const arg = it.evalInt()
  const src = rt.resolveAddr(st)
  const dst = rt.resolveWrite(st2)
  if (!src || !dst) amcafErr()
  for (let i = 0; i < wx * wy; i++) {
    const v = src.data[src.off + i] ?? 0
    const out = fire ? Math.max(0, v - arg) : v + arg
    if (dst.off + i < dst.data.length) dst.data[dst.off + i] = out & 0xff
  }
}

export function makeAmcafFunctions(rt: Runtime): Record<string, Func> {
  void rt
  const i0 = (a: Value[], n: number): number => int(a[n] ?? VI(0))
  const s0 = (a: Value[], n: number): string => str(a[n] ?? VS(''))
  return {

    /**
     * =Chr.w$(v) / =Chr.l$(v) — routines 179 and 180. A number as its raw
     * bytes, big-endian, "Using this technique, you can save numbers as
     * normal strings". Chr.w$ ignores the upper 16 bits.
     */
    'chr.w$': (_, a) => {
      const v = i0(a, 0) & 0xffff
      return VS(String.fromCharCode((v >> 8) & 0xff, v & 0xff))
    },
    'chr.l$': (_, a) => {
      const v = i0(a, 0)
      return VS(String.fromCharCode((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff))
    },

    /**
     * =Asc.w(s$) / =Asc.l(s$) — routines 181 and 182, the way back.
     *
     * Asc.w is UNSIGNED ("the result will be between 0 and 65535") and Asc.l
     * is SIGNED ("can range between -2147483648 and +2147483647"), which is
     * the only asymmetry in the group. A string too short to hold the value
     * is an error in both.
     */
    'asc.w': (_, a) => {
      const t = s0(a, 0)
      if (t.length < 2) amcafErr()
      return VI(((t.charCodeAt(0) & 0xff) << 8) | (t.charCodeAt(1) & 0xff))
    },
    'asc.l': (_, a) => {
      const t = s0(a, 0)
      if (t.length < 4) amcafErr()
      let v = 0
      for (let i = 0; i < 4; i++) v = ((v << 8) | (t.charCodeAt(i) & 0xff)) >>> 0
      return VI(v | 0)
    },

    /**
     * =Lsstr$(v,n) / =Lzstr$(v,n) — routines 178 and 177 ($488e).
     *
     * A number right-justified in exactly n characters. Lsstr$ pads with
     * spaces and Lzstr$ with zeros, and NEITHER prints the sign — the
     * manual says so and the routine never emits one.
     */
    'lsstr$': (_, a) => VS(padNum(i0(a, 0), i0(a, 1), ' ')),
    'lzstr$': (_, a) => VS(padNum(i0(a, 0), i0(a, 1), '0')),

    /**
     * =Insstr$(a$,b$,pos) — routine 187 ($4a44).
     *
     * `pos` is a COUNT OF LEADING CHARACTERS KEPT, not a 1-based index: the
     * routine errors on a negative one (`Rbmi`) and on `pos > len(a$)`
     * (`cmp.w d5,d7 / Rbhi`), so the legal range is 0..len inclusive. The
     * manual's example agrees — inserting "dear " at 6 into "Hello Ben!"
     * keeps the six characters "Hello " and gives "Hello dear Ben!".
     *
     * An empty b$ returns a$ untouched, which the routine takes as a special
     * case before allocating anything.
     */
    'insstr$': (_, a) => {
      const base = s0(a, 0)
      const ins = s0(a, 1)
      const pos = i0(a, 2)
      if (pos < 0 || pos > base.length) amcafErr()
      if (ins === '') return VS(base)
      return VS(base.slice(0, pos) + ins + base.slice(pos))
    },

    /**
     * =Cutstr$(s$,pos1 To pos2) — routine 188 ($4aae). Removes the run from
     * pos1 to pos2 INCLUSIVE, counting from 1: the manual's example cuts
     * 7 To 11 out of "Hello dear Ben!" and gets "Hello Ben!", which is the
     * five characters "dear ".
     *
     * NOTE: the routine's middle runs into bytes the disassembler cannot
     * separate from code — the same misdecode `Vmod` hits — so the bound
     * checks it makes (`Rbmi` on a negative position, on pos2 < pos1, and on
     * pos1 past the end) are legible but the exact arithmetic is not. The
     * worked example is unambiguous and is what this follows.
     */
    'cutstr$': (_, a) => {
      const t = s0(a, 0)
      const p1 = i0(a, 1)
      const p2 = i0(a, 2)
      if (p1 < 0 || p2 < p1 || p1 > t.length) amcafErr()
      return VS(t.slice(0, Math.max(0, p1 - 1)) + t.slice(p2))
    },

    /** =Replacestr$(s$,search$ To replace$) — routine 189, every occurrence */
    'replacestr$': (_, a) => {
      const t = s0(a, 0)
      const find = s0(a, 1)
      if (find === '') return VS(t)
      return VS(t.split(find).join(s0(a, 2)))
    },

    /**
     * =Itemstr$(s$,n) and =Itemstr$(s$,n,sep$) — routines 190 and 191.
     *
     * Items are numbered FROM ZERO and separated by '|' unless a single
     * character is given. "Empty strings for s$ are not allowed and will
     * create an error message, however, empty items can be used without
     * hesitation. Trying to access a item, that does not exist, will create
     * an error aswell."
     */
    'itemstr$': (_, a) => {
      const t = s0(a, 0)
      const n = i0(a, 1)
      const sep = a.length > 2 ? s0(a, 2) : '|'
      if (t === '' || n < 0 || sep === '') amcafErr()
      const parts = t.split(sep[0]!)
      if (n >= parts.length) amcafErr()
      return VS(parts[n]!)
    },

    /**
     * =Scanstr$(scancode) — routine 278. "returns the name of a key
     * according to the parameter 'scancode' ... If there is no key for the
     * scancode, an empty string will be returned."
     */
    'scanstr$': (_, a) => VS(KEY_NAMES[i0(a, 0)] ?? ''),


    /**
     * =Current Date — "counts the days passed since 1st January 1978", which
     * is the AmigaDOS DateStamp day count exactly.
     */
    'current date': () => VI(rt.host.clock.now().days),

    /** =Current Time — the packed minutes/ticks pair described above */
    'current time': () => {
      const st = rt.host.clock.now()
      return VI(packTime(st.mins, st.ticks))
    },

    /** =Cd Day(date) — "a value between 1 and 31" */
    'cd day': (_, a) => VI(stampToYmd(i0(a, 0))[2]),
    /** =Cd Month(date) — "lies between 1 and 12" */
    'cd month': (_, a) => VI(stampToYmd(i0(a, 0))[1]),
    /** =Cd Year(date) — the year out of the stamp */
    'cd year': (_, a) => VI(stampToYmd(i0(a, 0))[0]),

    /**
     * =Cd Weekday(date) — "can range between 1 (monday) and 7 (sunday)".
     *
     * Day zero is 1 January 1978, which was a Sunday, so the count starts at
     * 7 and not at 1.
     */
    'cd weekday': (_, a) => VI((((i0(a, 0) % 7) + 7) % 7 === 0 ? 7 : ((i0(a, 0) % 7) + 6) % 7 + 1)),

    /** =Cd Date$(date) — "the format 'WWW DD-MMM-YY'" */
    'cd date$': (_, a) => {
      const d = i0(a, 0)
      const [y, m, day] = stampToYmd(d)
      const wd = WEEKDAYS[(((d % 7) + 7) % 7 + 6) % 7]!.slice(0, 3)
      const yy = String(y % 100).padStart(2, '0')
      return VS(`${wd} ${String(day).padStart(2, '0')}-${MONTHS[m - 1]}-${yy}`)
    },

    /**
     * =Cd String(date$) — dos.library's StrToDate, which is why the manual
     * says "This command only works on OS2.0 and higher".
     *
     * "DD-MMM-YY" or "DD-month-YY", plus the relative words the library
     * accepts: Today, Tomorrow, Yesterday and a weekday name, where
     * "weekday strings refer to the last occurence of the week, i.e 'Monday'
     * represents last monday and not next monday". -1 when it will not parse.
     */
    'cd string': (_, a) => {
      const t = s0(a, 0).trim().toLowerCase()
      const today = rt.host.clock.now().days
      if (t === 'today') return VI(today)
      if (t === 'tomorrow') return VI(today + 1)
      if (t === 'yesterday') return VI(today - 1)
      const wd = WEEKDAYS.findIndex((w) => w.toLowerCase() === t)
      if (wd >= 0) {
        // the LAST occurrence, so step back until the weekday matches
        for (let i = 1; i <= 7; i++) {
          const d = today - i
          if ((((d % 7) + 7) % 7 + 6) % 7 === wd) return VI(d)
        }
      }
      const m = /^(\d{1,2})-([a-z]+)-(\d{2,4})$/.exec(t)
      if (!m) return VI(-1)
      const mon = MONTHS.findIndex((x) => x.toLowerCase() === m[2])
      const monFull = MONTHS_FULL.findIndex((x) => x.toLowerCase() === m[2])
      const mi = mon >= 0 ? mon : monFull
      if (mi < 0) return VI(-1)
      const day = Number(m[1])
      let year = Number(m[3])
      // a two-digit year is 1978..2077, the range a DateStamp can hold
      if (year < 100) year += year < 78 ? 2000 : 1900
      const days = Math.floor((Date.UTC(year, mi, day) - STAMP_EPOCH) / DAY_MS)
      if (!Number.isFinite(days) || days < 0) return VI(-1)
      const [cy, cm, cd] = stampToYmd(days)
      if (cy !== year || cm !== mi + 1 || cd !== day) return VI(-1) // 31-Feb and friends
      return VI(days)
    },

    /** =Ct Hour(time) — "Separates the hour from the packed time" */
    'ct hour': (_, a) => VI(Math.floor(timeMins(i0(a, 0)) / 60)),
    /** =Ct Minute(time) — the minutes within the hour */
    'ct minute': (_, a) => VI(timeMins(i0(a, 0)) % 60),
    /** =Ct Second(time) — the ticks resolved to whole seconds */
    'ct second': (_, a) => VI(Math.floor(timeTicks(i0(a, 0)) / TICKS_PER_SECOND)),

    /**
     * =Ct Tick(time) — "Calculates the number of vertical blanks (=1/50 of a
     * second) from the parameter 'time'".
     *
     * NOTE: that sentence does not say whether the count is within the second
     * or within the minute, and the field itself is the whole low word. The
     * low word is what this returns, so Ct Tick and Ct Second read the same
     * field at two resolutions rather than partitioning it.
     */
    'ct tick': (_, a) => VI(timeTicks(i0(a, 0))),

    /** =Ct Time$(time) — "a string in the format 'HH:MM:SS'" */
    'ct time$': (_, a) => {
      const t = i0(a, 0)
      const mins = timeMins(t)
      const two = (n: number): string => String(n).padStart(2, '0')
      return VS(`${two(Math.floor(mins / 60))}:${two(mins % 60)}:${two(Math.floor(timeTicks(t) / TICKS_PER_SECOND))}`)
    },

    /**
     * =Ct String(time$) — dos.library's StrToTime, "HH:MM" or "HH:MM:SS",
     * and -1 when it will not parse. OS2.0 and higher, like Cd String.
     */
    'ct string': (_, a) => {
      const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s0(a, 0).trim())
      if (!m) return VI(-1)
      const h = Number(m[1])
      const mi = Number(m[2])
      const sec = m[3] === undefined ? 0 : Number(m[3])
      if (h > 23 || mi > 59 || sec > 59) return VI(-1)
      return VI(packTime(h * 60 + mi, sec * TICKS_PER_SECOND))
    },


    /**
     * =Bank Checksum(bank) or (start To end) — routines 55 and 54 ($2782).
     *
     * A plain LONGWORD SUM of the region, then `eori.l #$faceface`. The
     * author liked that constant: the word-wide Bank Code Mix uses $FACE and
     * the byte-wide one $AA.
     *
     * The region is measured in longwords (`lsr.l #2`), so a trailing byte,
     * word or three bytes are not counted.
     */
    'bank checksum': (_, a) => {
      const r = bankRegion(rt, i0(a, 0), a.length > 1 ? i0(a, 1) : null)
      let sum = 0
      const longs = r.length >>> 2
      for (let i = 0; i < longs; i++) {
        const o = i * 4
        sum = (sum + (((r[o]! << 24) | (r[o + 1]! << 16) | (r[o + 2]! << 8) | r[o + 3]!) | 0)) | 0
      }
      return VI((sum ^ 0xfaceface) | 0)
    },

    /** =Bank Name$(bank) — routine 59 */
    'bank name$': (_, a) => {
      const b = rt.memBanks.get(i0(a, 0))
      if (!b) amcafErr()
      return VS(b.name)
    },


    /**
     * =Examine Next$ — the next entry's name, and "If the end of the
     * directory list is reached, file$ will contain an empty string and the
     * drawer will be closed."
     */
    'examine next$': () => {
      const e = rt.amcaf.examine
      e.index++
      const name = e.entries[e.index]
      if (name === undefined) {
        rt.amcaf.examine = { dir: '', entries: [], index: -1, current: '' }
        return VS('')
      }
      e.current = joinAmigaPath(e.dir, name)
      return VS(name)
    },

    /** =Object Type — positive for a directory, negative for a file */
    'object type': (_, a) => {
      const p = objPath(rt, a)
      const k = rt.vfs?.exists(p) ?? null
      return VI(k === null ? 0 : entryType(k === 'dir'))
    },
    /** =Object Size — zero for a directory, which has no byte size */
    'object size': (_, a) => VI(objSize(rt, objPath(rt, a))),
    /** =Object Blocks — "the number of blocks the object uses on a volume" */
    'object blocks': (_, a) => VI(blocksFor(objSize(rt, objPath(rt, a)))),
    /** =Object Name$ — the object's own name, without its path */
    'object name$': (_, a) => {
      const p = objPath(rt, a)
      const cut = Math.max(p.lastIndexOf('/'), p.lastIndexOf(':'))
      return VS(cut >= 0 ? p.slice(cut + 1) : p)
    },
    /** =Object Date — the DateStamp day count */
    'object date': (_, a) => VI(rt.vfs?.meta(objPath(rt, a)).days ?? 0),
    /** =Object Time — the same packed minutes/ticks Current Time uses */
    'object time': (_, a) => {
      const m = rt.vfs?.meta(objPath(rt, a))
      return VI(packTime(m?.mins ?? 0, m?.ticks ?? 0))
    },
    /** =Object Protection — the raw bitmap */
    'object protection': (_, a) => VI(rt.vfs?.meta(objPath(rt, a)).protection ?? 0),
    /** =Object Comment$ — the FileNote */
    'object comment$': (_, a) => VS(rt.vfs?.meta(objPath(rt, a)).comment ?? ''),

    /**
     * =Object Protection$(prot) — note the argument: this takes the NUMERIC
     * VALUE, not a path. "Object Protection$ function converts this numeric
     * value into a string in the format 'hsparwed'."
     */
    'object protection$': (_, a) => VS(protectionString(i0(a, 0) & 0xff)),

    /** =Filename$("DH2:AMOS/AMOSPro") is "AMOSPro" */
    'filename$': (_, a) => {
      const p = s0(a, 0)
      const cut = Math.max(p.lastIndexOf('/'), p.lastIndexOf(':'))
      return VS(cut >= 0 ? p.slice(cut + 1) : p)
    },
    /** =Path$("DH2:AMOS/AMOSPro") is "DH2:AMOS" — "a kind of Parent$" */
    'path$': (_, a) => {
      const p = s0(a, 0)
      const slash = p.lastIndexOf('/')
      if (slash >= 0) return VS(p.slice(0, slash))
      const colon = p.lastIndexOf(':')
      return VS(colon >= 0 ? p.slice(0, colon + 1) : '')
    },

    /**
     * =Pattern Match(source$,pattern$) — dos.library's ParsePattern and
     * MatchPattern, which is why "This command only works on OS2.0 and
     * higher". "The pattern may contain any regular DOS jokers[;] a asterik
     * (*) will be converted into '#?' automatically."
     */
    'pattern match': (_, a) => VI(amigaMatch(s0(a, 0), s0(a, 1).replace(/\*/g, '#?')) ? -1 : 0),

    /**
     * =Disk Type(directory$) — 0 a real device, 1 an assign, 2 a volume name.
     * "Using this function you can filter specific disk types out of a
     * device list."
     */
    'disk type': (_, a) => {
      // NOTE: an assign and a volume are not told apart here. The distinction
      // is a dos.library device-list walk, and this port's AmigaFS keeps its
      // assign map private, so a name that is not a floppy device answers 2.
      // APPROXIMATED for that reason.
      const name = s0(a, 0).replace(/:.*$/, '')
      return VI(/^df\d$/i.test(name) ? 0 : 2)
    },

    /**
     * =Disk State(directory$) — bit 0 write-protected or validating, bit 1
     * in use. The manual is candid about the third case: "If no disk is in
     * the drive, it normally should return -1, but I'm afraid..."
     *
     * Nothing here is write protected, being read from a mounted volume, and
     * nothing is mid-write when a keyword can observe it.
     */
    'disk state': (_, a) => VI(rt.vfs?.exists(s0(a, 0)) === null ? -1 : 0),

    /** =Io Error / =Io Error$ — the last AmigaDOS error, not an AMOS one */
    'io error': () => VI(rt.amcaf.ioError),
    'io error$': (_, a) => VS(dosErrorText(i0(a, 0))),

    /**
     * =Command Name$ — "the file name of the program under which AMOS or the
     * compiled program has been started. This is required for example to
     * read the own Tool Types."
     */
    'command name$': () => {
      // NOTE: nothing records the file a program was loaded from under a name
      // the program itself could have used, so this answers empty. A program
      // using it to find its own Tool Types gets the same nothing Tool Types$
      // gives, which at least keeps the pair consistent. APPROXIMATED.
      return VS('')
    },

    /**
     * =Tool Types$(filename$) — an icon's tool types, one per line.
     *
     * "The supplied file must not have a '.info' appended!" and "The various
     * Tool Types are seperated by a line feed character (Chr$(10)). So they
     * can be printed out easily using Print."
     */
    'tool types$': (_, a) => VS(toolTypes(rt, s0(a, 0))),

    /**
     * =Dos Hash(file$) — "Returns the hash value of a file. Only for
     * advanced users who want to read directly from dos disks."
     *
     * The AmigaDOS directory hash: fold the name, case-insensitively, into
     * a bucket. Its one caller is somebody walking a real disk's hash chains.
     */
    'dos hash': (_, a) => {
      const name = s0(a, 0)
      let h = name.length
      for (let i = 0; i < name.length; i++) {
        h = (h * 13 + (name.charCodeAt(i) & 0xff)) & 0x7ff
      }
      return VI(h % 72)
    },


    /** =Red Val / =Green Val / =Blue Val — "separate the colour into its three contents" */
    'red val': (_, a) => VI(rV(i0(a, 0))),
    'green val': (_, a) => VI(gV(i0(a, 0))),
    'blue val': (_, a) => VI(bV(i0(a, 0))),
    /** =Glue Colour(r,g,b) — the way back */
    'glue colour': (_, a) => VI(glue(i0(a, 0), i0(a, 1), i0(a, 2))),

    /**
     * =Rgb To Rrggbb(rgb) — 12 bits to 24, and "The missing bits are set to
     * zeros", so $FFF becomes $F0F0F0 rather than $FFFFFF.
     */
    'rgb to rrggbb': (_, a) => {
      const c = i0(a, 0)
      return VI((rV(c) << 20) | (gV(c) << 12) | (bV(c) << 4))
    },
    /** =Rrggbb To Rgb(rrggbb) — 24 to 12, "the other 12 bits will be discarded" */
    'rrggbb to rgb': (_, a) => {
      const c = i0(a, 0)
      return VI(glue((c >> 20) & 15, (c >> 12) & 15, (c >> 4) & 15))
    },

    /**
     * =Mix Colour(rgb1,rgb2) mixes two colours; the three-argument form
     * "added to the colour value 'oldrgb', if 'addrgb' is a positive value or
     * subtracted, if the value is negative", clamped between lrgb and urgb.
     */
    'mix colour': (_, a) => {
      if (a.length < 3) {
        const x = i0(a, 0)
        const y = i0(a, 1)
        return VI(glue((rV(x) + rV(y)) >> 1, (gV(x) + gV(y)) >> 1, (bV(x) + bV(y)) >> 1))
      }
      const old = i0(a, 0)
      const add = i0(a, 1)
      const lo = i0(a, 2)
      const up = i0(a, 3)
      const ch = (f: (v: number) => number): number =>
        Math.max(f(lo), Math.min(f(up), f(old) + (add < 0 ? -f(-add) : f(add))))
      return VI(glue(ch(rV), ch(gV), ch(bV)))
    },

    /**
     * =Best Pen($RGB) or ($RGB,c1 To c2) — "acquires the pen which is nearest
     * to the colour ... can be used to recolour pictures with limited
     * palette."
     */
    'best pen': (_, a) => {
      const want = i0(a, 0)
      const s = rt.screen
      if (!s) return VI(0)
      const lo = a.length > 1 ? i0(a, 1) : 0
      const hi = a.length > 2 ? i0(a, 2) : (1 << s.rp.bitMap.depth) - 1
      let best = lo
      let bestD = Infinity
      for (let i = lo; i <= hi && i < s.palette.length; i++) {
        const c = s.palette[i]!
        const d = (rV(c) - rV(want)) ** 2 + (gV(c) - gV(want)) ** 2 + (bV(c) - bV(want)) ** 2
        if (d < bestD) {
          bestD = d
          best = i
        }
      }
      return VI(best)
    },

    /** =Pal Get(palnr,index) — read one entry back out of a buffer */
    'pal get': (_, a) => {
      const pal = i0(a, 0)
      const idx = i0(a, 1)
      if (pal < 0 || pal > 7 || idx < 0 || idx > 255) amcafErr()
      return VI(rt.amcaf.palettes[pal]![idx]!)
    },

    /** =Ham Colour(c,oldrgb) — the colour a HAM pixel becomes */
    'ham colour': (_, a) => {
      const s = rt.screen
      return VI(hamApply(i0(a, 0) & 63, i0(a, 1), s ? s.palette : new Uint16Array(16)))
    },
    /** =Ham Best(newrgb,oldrgb) — the control byte that gets closest */
    'ham best': (_, a) => {
      const s = rt.screen
      return VI(hamBest(i0(a, 0), i0(a, 1), s ? s.palette : new Uint16Array(16)))
    },

    /**
     * =Ham Point(x,y) — the real colour at a point, which in HAM needs the
     * whole line before it. "Ham Point can access any point on the screen
     * indiviually without preprocessing", and "If the point x,y is not on the
     * screen, rgb will contain -1".
     */
    'ham point': (_, a) => {
      const x = i0(a, 0)
      const y = i0(a, 1)
      const s = rt.screen
      if (!s || x < 0 || y < 0 || x >= s.width || y >= s.height) return VI(-1)
      const px = s.rp.bitMap.pixels
      let rgb = s.palette[0] ?? 0
      for (let i = 0; i <= x; i++) rgb = hamApply(px[y * s.width + i]! & 63, rgb, s.palette)
      return VI(rgb)
    },


    /**
     * =Blitter Busy — "returns -1 (True), if the Blitter chip is currently
     * busy". Nothing here overlaps a blit with the program, so it never is.
     */
    'blitter busy': () => VI(0),

    /** =Turbo Point(x,y) — "Fast replacement for Point", clipped since V1.30 */
    'turbo point': (_, a) => {
      const v = rt.screen?.rp.point(i0(a, 0), i0(a, 1)) ?? -1
      return VI(v < 0 ? 0 : v)
    },

    /**
     * =X Raster / =Y Raster — the beam position in hardware coordinates.
     *
     * The manual is refreshingly honest about the value: "This value is not
     * very accurate because the raster beam is very fast, sigh."
     */
    'x raster': () => VI((rt.interp.beamWord() & 0xff) << 1),
    'y raster': () => VI((rt.interp.beamWord() >> 8) & 0x1ff),

    /**
     * =Vclip(val,lower To upper) — the CLAMPING sibling of Vmod, which wraps.
     * The manual pairs them deliberately.
     */
    vclip: (_, a) => VI(Math.max(i0(a, 1), Math.min(i0(a, 2), i0(a, 0)))),

    /**
     * =Aga Detect — whether the machine has AGA.
     *
     * The modelled machine is an A1200, which does; the 256-colour screens
     * and the LOCT palette the AGA port added are what make that true here
     * rather than a claim.
     */
    'aga detect': () => VI(-1),

    /**
     * =Scrn Rastport / Bitmap / Layer / Layerinfo / Region.
     *
     * "Here are some more commands for Assembler and C freaks" — a program
     * gets the address of the current screen's structure to poke directly.
     *
     * NOTE: this port has a RastPort and a BitMap as objects, not as bytes at
     * an address a program could walk, and it models no Layer or LayerInfo at
     * all. Returning a plausible pointer would invite exactly the poking the
     * manual warns about, into memory whose layout is not the machine's, so
     * these answer 0 — which is also what a program checking before using one
     * would treat as "not available". APPROXIMATED.
     */
    'scrn rastport': () => VI(0),
    'scrn bitmap': () => VI(0),
    'scrn layer': () => VI(0),
    'scrn layerinfo': () => VI(0),
    'scrn region': () => VI(0),


    /**
     * =Count Pixels(screen,colour,x1,y1 To x2,y2) — note the sense, which the
     * manual states and the name does not: it "Counts the pixels ... that
     * DON'T have the colour index colour".
     */
    'count pixels': (_, a) => {
      const s = rt.screens.get(i0(a, 0))
      if (!s) return VI(0)
      const c = i0(a, 1)
      let n = 0
      for (let y = i0(a, 3); y <= i0(a, 5); y++) {
        for (let x = i0(a, 2); x <= i0(a, 4); x++) {
          const v = s.rp.point(x, y)
          if (v >= 0 && v !== c) n++
        }
      }
      return VI(n)
    },

    /**
     * =Font Style — "replaces the AMOS function Text Styles, because this one
     * does not return the multicoloured font bit (Bit 6). Apart from this,
     * Font Style is totally identical with the AMOS function."
     */
    'font style': () => VI(rt.screen?.textStyle ?? 0),

    /**
     * =Cop Pos — "If you create your own copperlist, you can use this
     * function to remember the position of the next copper instruction."
     */
    'cop pos': () => VI(rt.copLogicAddr() + rt.copPos),

    /** =Splinters Active — how many splinters are still alive */
    'splinters active': () => VI(rt.amcaf.splinters.p.length),


    /**
     * =Vec Rot X/Y/Z — with three arguments they rotate a point and cache all
     * three results; with none they return the cached one.
     *
     * "This coordinate is automatically projected from 3D to 2D by dividing
     * it through the distance", which is the `Vec Rot Pos` z.
     *
     * NOTE: the rotation order was not recovered from the binary, and the
     * changelog records the author fixing it once ("There was a bug in the
     * vector rotation calculation with negative positions"), so the sign
     * conventions had at least one life before this one. X then Y then Z is
     * what this applies. APPROXIMATED.
     */
    'vec rot x': (_, a) => VI(vecRot(rt, a).x),
    'vec rot y': (_, a) => VI(vecRot(rt, a).y),
    'vec rot z': (_, a) => VI(vecRot(rt, a).z),

    /**
     * =Speek(address) — "exactly the AMOS function Peek. However, Bit 7 is
     * used as sign bit so the result will be a value between -128 and 127."
     *
     * One of the six armed contested names: Personnal has a Speek too.
     */
    speek: (_, a) => {
      const m = rt.resolveAddr(i0(a, 0))
      return VI(m ? ((m.data[m.off] ?? 0) << 24) >> 24 : 0)
    },
    /** =Sdeek(address) — the same idea a word wide, -32768..32767 */
    sdeek: (_, a) => {
      const m = rt.resolveAddr(i0(a, 0))
      if (!m) return VI(0)
      return VI(((((m.data[m.off] ?? 0) << 8) | (m.data[m.off + 1] ?? 0)) << 16) >> 16)
    },

    /**
     * =Amos Cli — "the number of the cli process out of which the program has
     * been started off or zero, if AMOS has been started from Workbench."
     *
     * Nothing started this from a CLI, so zero — which the manual gives a use
     * for: "This gives you the choice to either interprete options from the
     * command line or from the tool types of the appropriate icon."
     */
    'amos cli': () => VI(0),

    /**
     * =Amcaf Version$ — the extension's own version string.
     *
     * NOTE: the binary holds no printable text at all, so the string the
     * library returned was not recovered. This answers the identity the
     * registry holds, which is the question a program asking is really
     * asking. APPROXIMATED.
     */
    'amcaf version$': () => VS('AMCAF 1.50'),


    /**
     * The four-player adaptor: =Pjoy(j), =Pfire(j), =Pjup/Pjdown/Pjleft/Pjright.
     *
     * "Corresponds to the AMOS function Joy, with the difference, that one of
     * the parallel port joysticks is checked instead of the normal
     * joysticks", and the bit layout is the same JOY_* packing.
     *
     * NOTE: there is no adaptor. This is the same hardware Sticks models --
     * CIA-A PRB, the parallel port's data register -- and Sticks already
     * answers "no adaptor" honestly rather than pretending. These agree with
     * it: an unused port reads as nothing pressed. `j` must be 0 or 1.
     */
    pjoy: (_, a) => VI(fourPlayer(i0(a, 0)) & JOY_DIRECTIONS),
    pjup: (_, a) => VI(fourPlayer(i0(a, 0)) & JOY_UP ? -1 : 0),
    pjdown: (_, a) => VI(fourPlayer(i0(a, 0)) & JOY_DOWN ? -1 : 0),
    pjleft: (_, a) => VI(fourPlayer(i0(a, 0)) & JOY_LEFT ? -1 : 0),
    pjright: (_, a) => VI(fourPlayer(i0(a, 0)) & JOY_RIGHT ? -1 : 0),
    pfire: (_, a) => VI(fourPlayer(i0(a, 0)) & JOY_FIRE ? -1 : 0),

    /**
     * =Xfire(port,button) — a second or later fire button.
     *
     * "If the lowlevel-library is available, all the other buttons can be
     * checked aswell." lowlevel.library is not modelled, and a plain gameport
     * has one button, so anything past the first reads as not pressed. The
     * first is the ordinary fire the host already supplies.
     */
    xfire: (_, a) => {
      const port = i0(a, 0)
      if (port < 0 || port > MAX_PORT) amcafErr()
      const bits = port === PORT_MOUSE ? rt.input.joy0 : rt.input.joy
      return VI(i0(a, 1) <= 1 && joyFire(bits) ? -1 : 0)
    },

    /**
     * =X Smouse / =Y Smouse / =Smouse Key — the second mouse.
     *
     * NOTE: nothing drives a second mouse here, exactly as in the Sticks
     * port, where the manual is explicit that this is "not ... the AMOS
     * pointer". The position holds wherever a program last put it and the
     * buttons read as up.
     */
    'x smouse': () => VI(rt.amcaf.smouse.x),
    'y smouse': () => VI(rt.amcaf.smouse.y),
    'smouse key': () => VI(0),


    /** =Pt Cpos — "the current 'row' ... a number between 0 and 63" */
    'pt cpos': () => VI(rt.amcaf.pt.row & 63),
    /** =Pt Cpattern — the song position being played */
    'pt cpattern': () => VI(rt.amcaf.pt.pos),
    /** =Pt Cnote(channel) — the note last triggered on a channel */
    'pt cnote': (_, a) => VI(rt.amcaf.pt.note[i0(a, 0) & 3] ?? 0),
    /** =Pt Cinstr(channel) — the instrument last triggered on a channel */
    'pt cinstr': (_, a) => VI(rt.amcaf.pt.instr[i0(a, 0) & 3] ?? 0),

    /**
     * =Pt Vu(channel) — "the current volume of channel number 'channel'. If a
     * new note is played, 'vol' contains the volume level else 0."
     *
     * So it is a note-on latch rather than a live meter, the same shape as
     * AMOS's own Vumeter.
     */
    'pt vu': (_, a) => {
      const c = i0(a, 0) & 3
      const v = rt.amcaf.pt.vu[c] ?? 0
      rt.amcaf.pt.vu[c] = 0
      return VI(v)
    },

    /**
     * =Pt Signal — the module's own effect commands surfacing to the program.
     *
     * The changelog pins one value: "When reaching the end of a song, Pt
     * Signal now reports $FF."
     */
    'pt signal': () => VI(rt.amcaf.pt.signal),

    /** =Pt Data Base — the replayer's data block, for the assembler crowd */
    'pt data base': () => VI(0),

    /** =Pt Instr Address(n) / =Pt Instr Length(n) — a module sample in memory */
    'pt instr address': (_, a) => {
      const b = rt.memBanks.get(rt.amcaf.pt.bank)
      if (!b) return VI(0)
      const inst = modSample(b.data, i0(a, 0))
      return VI(inst ? rt.bankBase(rt.amcaf.pt.bank) + inst.off : 0)
    },
    'pt instr length': (_, a) => {
      const b = rt.memBanks.get(rt.amcaf.pt.bank)
      if (!b) return VI(0)
      return VI(modSample(b.data, i0(a, 0))?.len ?? 0)
    },

    /**
     * =Pt Free Voice[(n)] — which voices the music is not using.
     *
     * A 1.50 addition with no manual entry: DISASSEMBLY tier by the author's
     * own "You'll have to find out the new commands since V1.40 yourself".
     * With an argument it answers for one voice, without it returns the first
     * free one or -1.
     */
    'pt free voice': (_, a) => {
      const pt = rt.amcaf.pt
      const isFree = (v: number): boolean => !pt.playing || (pt.voices & (1 << v)) === 0
      if (a.length > 0) return VI(isFree(i0(a, 0) & 3) ? -1 : 0)
      for (let v = 0; v < 4; v++) if (isFree(v)) return VI(v)
      return VI(-1)
    },


    /**
     * =Amcaf Base / =Amcaf Length — the extension's data block.
     *
     * "Gives back the address of the AMCAF data base" and its size, for the
     * "Assembler and C freaks" the manual addresses. NOTE: the state here is
     * TypeScript objects rather than a $23b6-byte block at an address — the
     * init routine allocates exactly that much — so the length is real and
     * the address is 0, the same choice the Scrn pointers made. APPROXIMATED.
     */
    'amcaf base': () => VI(0),
    'amcaf length': () => VI(0x23b6),

    /**
     * =Amos Task — "Returns the address of the AMOS task structure".
     *
     * There is one task and no exec task structure to point at. 0, like the
     * other pointer-into-the-machine functions.
     */
    'amos task': () => VI(0),

    /**
     * =Extpath$(name$) — where an extension was loaded from.
     *
     * Extensions here are compiled-in ports rather than files loaded off a
     * disk, so there is no path. The empty string is what the machine returns
     * for a slot that holds nothing, which is the nearest true answer.
     */
    'extpath$': () => VS(''),

    /** =Nfn — routine 22. "returns nothing useful ... used in speed testing" */
    nfn: () => VI(0),

    /**
     * =Cpu — routine 216 ($5026). Reads ExecBase+$128 (AttnFlags) and maps
     * the bits onto 68000/68010/68020/68030/68040/68060, cleverly: d3 starts
     * as the LONGWORD $109a0 (68000 decimal) and each hit overwrites only the
     * low WORD, so $9b4 turns it into $109b4 = 68020.
     *
     * The modelled machine is an A1200, which is AttnFlags bit 1 — the same
     * identity Jd Cpu reports and the same one the 2MB chip / fast-board
     * memory pools answer for.
     */
    cpu: () => VI(68020),

    /**
     * =Fpu — routine 217. Zero when nothing is fitted, which is the A1200 as
     * modelled; Jd Fpu agrees.
     */
    fpu: () => VI(0),

    /** =Even(v) — routine 193 ($4c9a): `btst #0` and -1 when the bit is clear */
    even: (_, a) => VI((i0(a, 0) & 1) === 0 ? -1 : 0),
    /** =Odd(v) — routine 192, the same test the other way up */
    odd: (_, a) => VI((i0(a, 0) & 1) !== 0 ? -1 : 0),

    /** =Wordswap(v) — routine 198 ($4cf6): one `swap d3` */
    wordswap: (_, a) => {
      const v = i0(a, 0)
      return VI(((v >>> 16) | (v << 16)) | 0)
    },

    /**
     * =Lsl(v,n) — routine 196 ($4ce2): `asl.l d0,d3`.
     *
     * The manual says "Rotates the number 'v' to the left", which it does not;
     * it shifts, and bits leaving the top are lost. Its own worked
     * description ("v*2 ... v*4 ... v*8") is the shift, so the word "rotates"
     * is loose writing rather than a second behaviour.
     */
    lsl: (_, a) => VI((i0(a, 0) << (i0(a, 1) & 63)) | 0),

    /**
     * =Lsr(v,n) — routine 197 ($4cec).
     *
     * DEVIATION: the keyword is named for a LOGICAL shift and the instruction
     * is `asr.l`, an arithmetic one, so the sign bit is replicated and a
     * negative value stays negative. That is the library's choice, and
     * it also makes the manual's claim — "does the same as a division by 2^n"
     * — false for negatives, because ASR rounds toward minus infinity where
     * division rounds toward zero. Lsr(-3,1) is -2, not -1. Reproduced.
     */
    lsr: (_, a) => VI(i0(a, 0) >> (i0(a, 1) & 63)),

    /**
     * =Binexp(a) — routine 194. 2^a, and the manual bounds a to 0..31.
     * A shift of 32 or more is undefined on the 68000 and meaningless here,
     * so the documented range is enforced.
     */
    binexp: (_, a) => {
      const n = i0(a, 0)
      if (n < 0 || n > 31) amcafErr()
      return VI((1 << n) | 0)
    },

    /**
     * =Binlog(v) — routine 195 ($4cc2), and the routine is the specification.
     *
     * Zero errors immediately (`Rbeq`). Otherwise it shifts right counting
     * until bit 0 is set, shifts once more, and errors if ANYTHING is left
     * (`tst.l d0 / Rbne`) — so a value that is not exactly a power of two is
     * an error rather than a floor, which is what the manual promises.
     */
    binlog: (_, a) => {
      const v = i0(a, 0) >>> 0
      if (v === 0 || (v & (v - 1)) !== 0) amcafErr()
      return VI(31 - Math.clz32(v))
    },

    /**
     * =Qsqr(v) — routine 271 ($6286): integer square root by Newton's method
     * over a scaled start, no maths library involved.
     *
     * Zero returns zero before anything else; a negative value takes the
     * `Rbmi` error branch.
     */
    qsqr: (_, a) => {
      const v = i0(a, 0)
      if (v === 0) return VI(0)
      if (v < 0) amcafErr()
      return VI(Math.floor(Math.sqrt(v)))
    },

    /**
     * =Qrnd(max) — routine 272. "totally identical to the Rnd function, with
     * the only difference, that this one is much faster", so it is the same
     * generator AMOS's own Rnd uses rather than a second one.
     */
    qrnd: (it, a) => VI(it.rndInt(i0(a, 0))),

    /** =Qsin(angle,radius) — routine 274 ($6326); 1024 units to the turn */
    qsin: (_, a) => VI(qtrig(i0(a, 0), i0(a, 1), 0)),
    /** =Qcos(angle,radius) — routine 273, a quarter turn ahead of Qsin */
    qcos: (_, a) => VI(qtrig(i0(a, 0), i0(a, 1), 256)),

    /**
     * =Qarc(deltax,deltay) — routine 275. The inverse of the pair: the angle
     * to a relative point, in the same 1024-to-the-turn units, "normally used
     * for all kinds of 'aiming-at' routines".
     */
    qarc: (_, a) => {
      const dx = i0(a, 0)
      const dy = i0(a, 1)
      const t = Math.round((Math.atan2(dy, dx) / (2 * Math.PI)) * 1024)
      return VI(t & 0x3ff)
    },

    /**
     * =Vin(val,lower To upper) — routine 184. True when the value lies
     * within the bounds, which the manual introduces with a joke about wine.
     */
    vin: (_, a) => {
      const v = i0(a, 0)
      return VI(v >= i0(a, 1) && v <= i0(a, 2) ? -1 : 0)
    },

    /**
     * =Vmod(val,upper) and =Vmod(val,lower To upper) — routines 185 and 186
     * ($49e6), two token forms of one idea.
     *
     * It WRAPS rather than clamping, which is what separates it from Vclip:
     * "If val exceeds upper by 1, it will be set to lower, if it exceeds
     * upper by 2, it will be set to lower+1. If it goes deeper than lower by
     * 1, it will be set to upper and so on." The routine divides by
     * `upper+1`, so the span is inclusive of both ends, and it takes the
     * `Rbmi` error branch on a negative upper bound.
     *
     * NOTE: the disassembly of the two-bound form runs into data the
     * disassembler renders as `dc.b "BCHCNuD"` and could not be read
     * straight through. The single-bound path is legible and the two-bound
     * one is implemented from the manual's worked description above.
     */
    vmod: (_, a) => {
      const v = i0(a, 0)
      const lower = a.length > 2 ? i0(a, 1) : 0
      const upper = a.length > 2 ? i0(a, 2) : i0(a, 1)
      if (upper < lower) amcafErr()
      const span = upper - lower + 1
      return VI(lower + (((v - lower) % span) + span) % span)
    },
  }
}
