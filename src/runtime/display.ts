/**
 * Video out: the copper list, the compositor, bobs and hardware sprites.
 *
 * This was the last 1,254 lines of runtime.ts. Splitting it out is not
 * cosmetic: the display is the part of this port that has been rewritten most
 * (the planar conversion and the collapse onto one renderer were six phases),
 * it owns the only differential oracle in the suite
 * (`display.diff.test.ts`), and it was the part hardest to review while it sat
 * at the bottom of a 5,000-line file.
 *
 * WHAT IT NEEDS FROM THE RUNTIME, exactly — screens and their order, the copper
 * register file and buffers, bob and sprite state, the palette background, the
 * rainbow table, host input and the mouse pointer, plus resolveAddr and
 * screenChipBase for following a plane pointer. Thirty members, all reached
 * through `this.rt`, which is what makes them countable: narrowing that to a
 * declared interface is the obvious next step and is now a mechanical one.
 *
 * The import of Runtime is a value import, so runtime.ts <-> display.ts is a
 * module cycle. It resolves because every use is inside a method body rather
 * than at module evaluation, and it is the same shape personnal.ts already has.
 * Homing the address-space constants somewhere neutral would remove it; that is
 * a separate change from moving the code, and doing both at once is how a
 * refactor this size goes wrong.
 */
import { EMPTY_PLANE, Runtime } from './runtime'
import type { Rainbow } from './runtime'
import { AmosError } from '../interp/values'
import type { Screen } from './screen'
import { BankImage } from './objects'
import type { HwSprite } from './objects'
import { COOKIE_CUT, mintermBit } from '../amiga/blitter'
import { bobBltcon0 } from './objects'

export class Display {
  constructor(private readonly rt: Runtime) {}

  /** The composite window: a full-overscan PAL monitor. Hardware lines
   * COMPOSITE_TOP .. COMPOSITE_TOP+COMPOSITE_LINES-1 (26..311 — vertical
   * blank ends ~25, bottom overscan ~311) each map to two canvas rows.
   * The AMOS default screen sits at line 50; accessories place screens
   * from ~line 20 (Object_Editor) to ~291 and Limit Mouse 25..310. */
  static readonly COMPOSITE_TOP = 26
  static readonly COMPOSITE_LINES = 286

  /**
   * T_EcYMax (+W.s:2476): the last line the list may address, 311 on PAL —
   * NTSC sets 261 there instead, which this does not model. The list builder
   * clamps a window that runs off the bottom to EcYMax-1 rather than dropping
   * its end band; see endBand in buildCopperList.
   */
  static readonly EC_Y_MAX = 311

  /**
   * EcYStrt (+Equ.s:575, EcYBase+26): the first line a window may START on.
   *
   * Both off-raster tests in the band writer are expressed against this and
   * EC_Y_MAX rather than written out as 26/309/310, because on NTSC only
   * T_EcYMax moves (261, +W.s:2480) and the two must move with it.
   */
  static readonly EC_Y_STRT = 26

  /** Compose all visible screens into a 640x572 RGBA frame (the PAL
   * overscan window, doubled). */
  /**
   * Fold Rainbow-instruction changes into the display fields, exactly like
   * the copper build's activation pass (RainA1-A5 +W.s:6079): a height
   * change re-latches RnTY and forces the Y pass; the Y pass clamps the
   * start to hardware line 28; a base change is IGNORED when out of range
   * (RainA4 keeps the old base). Nothing happens while h < 0.
   */
  activateRainbows(): void {
    for (const rb of this.rt.rainbows.values()) {
      if (rb.table.length === 0 || rb.h < 0 || rb.act === 0) continue
      let act = rb.act
      rb.act = 0
      if (act & 1) {
        rb.ty = rb.h
        act |= 4
      }
      if (act & 4) {
        rb.dy = Math.max(28, rb.y)
        rb.fy = rb.dy + rb.ty
      }
      if (act & 2 && ((rb.x << 1) & 0xffff) < rb.table.length * 2) rb.base = rb.x
    }
  }

  /**
   * Per-row colour resolver: plain indexed, EHB half-bright (values 32-63
   * show colours 0-31 with each component halved), or HAM6 (control bits
   * 5-4: 0 = set from the 16-colour palette, 1/2/3 = modify blue/red/green
   * of a running colour that restarts from colour 0 each scanline).
   */
  /**
   * `forceHam` lets a copper list ask for HAM over a screen that was not
   * opened as one. BPLCON0 bit 11 is a property of the display, not of the
   * bitmap, and a list that sets it means it however the screen was made —
   * the same reasoning as LACE. Personnal's Ham Mode is exactly that bit.
   */
  private rowColours(
    s: Screen,
    pal: Uint16Array | null,
    palLo: Uint16Array | null = null,
    forceHam = false,
  ): (pix: number) => number {
    /*
     * Returns a 24-BIT colour, not the 12-bit one this used to hand back.
     * An AGA entry is two 12-bit halves — the high nibbles in COLORxx and
     * the low nibbles behind LOCT — and there is no index left to look the
     * second half up with by the time the renderer expands a pixel, so the
     * join happens here.
     *
     * The index is no longer masked to 31. It was, which is why a bank-1
     * pixel used to read back as its bank-0 twin.
     */
    const n = pal ? pal.length : s.palette.length
    const hi = (i: number): number => (pal ? pal[i % n]! : s.palette[i % n]! & 0xfff)
    const lo = (i: number): number => (palLo ? palLo[i % n]! : hi(i))
    /** two 12-bit halves into 24 bits: high nibble then low, per component */
    const join = (h: number, l: number): number =>
      ((((h >> 8) & 15) << 4) | ((l >> 8) & 15)) * 65536 +
      ((((h >> 4) & 15) << 4) | ((l >> 4) & 15)) * 256 +
      (((h & 15) << 4) | (l & 15))
    const get24 = (i: number): number => join(hi(i), lo(i))
    /** HAM and EHB are ECS-only, and both do their arithmetic 12-bit */
    const get = hi
    if (s.ham || forceHam) {
      let c = get(0)
      return (pix) => {
        const dat = pix & 15
        switch (pix >> 4) {
          case 0:
            c = get(dat)
            break
          case 1:
            c = (c & 0xff0) | dat
            break
          case 2:
            c = (c & 0x0ff) | (dat << 8)
            break
          default:
            c = (c & 0xf0f) | (dat << 4)
        }
        return join(c, c)
      }
    }
    if (s.ehb) {
      return (pix) => (pix >= 32 ? join((get(pix - 32) >> 1) & 0x777, (get(pix - 32) >> 1) & 0x777) : get24(pix))
    }
    return (pix) => get24(pix)
  }

  private winWOf(s: Screen): number {
    return s.displayW >= 0 ? Math.min(s.displayW, s.width) : s.width
  }
  private winHOf(s: Screen): number {
    return s.displayH >= 0 ? Math.min(s.displayH, s.height) : s.height
  }
  private coversLine(s: Screen, L: number): boolean {
    const hwH = s.laced ? Math.ceil(this.winHOf(s) / 2) : this.winHOf(s)
    return L >= s.displayY && L < s.displayY + hwH
  }
  /** the front screen band owning hardware line L (priority slices) */
  frontAt(L: number): Screen | null {
    let f: Screen | null = null
    for (let i = this.rt.order.length - 1; i >= 0; i--) {
      const s = this.rt.screens.get(this.rt.order[i]!)
      if (!s || !s.visible || !this.coversLine(s, L)) continue
      f = s
      break
    }
    // the hidden back half of a pair defers to its front screen
    if (f?.dualIsBack && f.dualPartner !== null) {
      const df = this.rt.screens.get(f.dualPartner)
      if (df?.visible && this.coversLine(df, L)) f = df
    }
    return f
  }

  /**
   * Build the system copper list into the logical buffer and swap — the
   * word-for-word equivalent of EcCopper (+W.s:5730/6030-6500) run at each
   * vbl. The list is real memory behind Cop Logic: the header wait
   * $1003FFFE + sprite pointers $120-$13E (HsCop +W.s:6786), then per
   * screen band an EcCopHo block (WAIT, DMACON stop, the 16-colour
   * palette, BPLxPTH/L pointing into the screen's chip-RAM planes,
   * DIWSTRT/STOP, DDFSTRT/STOP, modulos, BPLCON0-2, then a WAIT for the
   * next line + DMACON $8300 + colours 16-31, FiniCop), per rainbow line
   * a WAIT + COLOR move (CopBow), EcCopBa (DMA stop + fond) at band ends,
   * and the $FFFFFFFE terminator. Deviation: the rainbow-restore move is
   * emitted after a WAIT for its own line (the 68k emits it unwaited,
   * which lands it a beam-race early — idealized here).
   */
  buildCopperList(): void {
    this.activateRainbows()
    const l = this.rt.copLogic
    let p = 0
    const put = (w: number): void => {
      if (p + 2 <= l.length) {
        l[p] = (w >> 8) & 0xff
        l[p + 1] = w & 0xff
        p += 2
      }
    }
    let cross = false
    const wait = (line: number): void => {
      if (line >= 256 && !cross) {
        put(0xffdf)
        put(0xfffe)
        cross = true
      }
      put(((line << 8) & 0xff00) | 0x03)
      put(0xfffe)
    }
    put(0x1003)
    put(0xfffe)
    for (let r = 0x120; r <= 0x13e; r += 2) {
      put(r)
      put(0)
    }
    // The fond, right after the HsCop header.
    //
    // AMOS parks it at the BOTTOM of the list (MCopX) and relies on a copper
    // MOVE sticking across the frame boundary — the register is still the
    // fond when the beam comes round again. That works on the hardware and it
    // works here between frames, but it leaves the border undefined on the
    // very first walk, and the modelled renderer papered over that by seeding
    // hwPal[0] from colourBack before it started. Now that the list IS the
    // display, it has to say so itself.
    put(0x180)
    put(this.rt.colourBack & 0xfff)
    const rbs = [...this.rt.rainbows.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, r]) => r)
      .filter((r) => r.table.length > 0 && r.h >= 0 && r.ty > 0)
    /**
     * EcCopBa (+W.s:6741): stop the DMA and put the fond back in colour 0.
     *
     * Clamped to T_EcYMax-1, which is what MkA9a/MkA11 (+W.s:5967-5985) do
     * with a window whose end falls below the bottom of the display: the end
     * is recorded at EcYMax-1 rather than dropped. It has to be, because
     * DMACON persists across the frame boundary — the region above the
     * topmost screen shows the fond only because the PREVIOUS frame's last
     * band turned the bitplane DMA off and nothing turns it back on until the
     * screen's own EcCopHo. Leave a screen running off the bottom with the DMA
     * still on and the next frame fetches from wherever the pointers stopped,
     * through the top 24 lines of the display.
     *
     * Found in Coingrabber, whose 265-line screen sits at line 50 and so ends
     * at 315: a band above the picture showing the plane data one plane out of
     * step, which reads as the top of the screen duplicated in the wrong
     * colours.
     */
    const endBand = (line: number): void => {
      wait(Math.min(line, Display.EC_Y_MAX - 1))
      put(0x096)
      put(0x0100)
      put(0x180)
      put(this.rt.colourBack & 0xfff)
    }
    let front: Screen | null = null
    let curRb: Rainbow | null = null
    let emitted = false
    for (let L = 0; L < 313; L++) {
      const f = this.frontAt(L)
      const bandStart = f !== front && f !== null
      const bandEnd = f !== front && f === null
      /**
       * OFF THE RASTER: THE WINDOW IS NOT SHOWN AT ALL.
       *
       * MkA8 (+W.s:5955-5961) reads the boundary the band splitter stored
       * (EcWY-1, MkD2 +W.s:5830) and branches straight to MkA10 — the next
       * boundary — when it is above EcYStrt-1 or at/below T_EcYMax-2. No
       * band is written, so the screen simply does not appear. MkA9a
       * (+W.s:5973) applies the same top test to the END boundary, which is
       * why a window entirely above the raster leaves no trace in the list
       * at all rather than an orphaned DMA-off.
       *
       * This is not the end-band clamp above. That one moves a window whose
       * END runs off the bottom (MkA11); this one drops a window whose START
       * is out of range, and the two are separate branches of the same walk.
       *
       * Programs use it deliberately. Object_Editor.AMOS opens an 8-row
       * status strip and parks it with `Screen Display 4,,20,,` before the
       * main loop, then moves it to 45 or 45+SYWORK every frame — Y=20 is
       * how it hides the thing. Without this test the builder emitted a band
       * from line 20, and since the compositor paints from COMPOSITE_TOP the
       * strip showed as two rows of the wrong screen across the top of the
       * editor for its whole life.
       *
       * The end band is still written when its own boundary is in range: the
       * boundary list is built either way and MkA9 walks it independently, so
       * a dropped start followed by a live end is exactly what AMOS produces.
       */
      const startDropped =
        bandStart && (L - 1 < Display.EC_Y_STRT - 1 || L - 1 >= Display.EC_Y_MAX - 2)
      const endDropped = bandEnd && L < Display.EC_Y_STRT - 1
      // did the band writer emit a wait() for this line? the rainbow machine
      // below has to know, and a dropped band emits nothing
      const didStart = bandStart && !startDropped
      const didEnd = bandEnd && !endDropped
      if (didStart && f) {
        emitted = true
        // EcCopHo head (+W.s:6293) — the band splitter stores boundaries
        // at EcWY-1 (MkD2 +W.s:5830), so the setup runs on the line BEFORE
        // the band and the DMA restart lands exactly on its first line
        wait(Math.max(0, L - 1))
        put(0x096)
        put(0x0100)
        for (let i = 0; i < 16; i++) {
          put(0x180 + i * 2)
          put(f.palette[i]! & 0xfff)
        }
        // bitplane pointers: the +1 window offset relative to the setup
        // line cancels the -1, pointing at the band's first row
        const rowOff = (L - f.displayY + f.offsetY) * f.rowBytes + ((f.offsetX >> 4) << 1)
        const base = this.rt.screenChipBase(f.index) + (f.doubleBuffered ? Runtime.SCREEN_PHY_OFFSET : 0)
        /**
         * Bitplane pointers.
         *
         * DUAL PLAYFIELD INTERLEAVES TWO BITMAPS. The hardware takes PF1 from
         * bitplanes 1,3,5 (indices 0,2,4) and PF2 from 2,4,6, so a pair of
         * AMOS screens has to be woven into one pointer set — the list used
         * to emit only the front screen's planes, which is why nothing that
         * replayed it could show the second playfield at all.
         */
        const pf2 = f.dualPartner !== null && !f.dualIsBack ? (this.rt.screens.get(f.dualPartner) ?? null) : null
        const emit = (pl: number, ad: number): void => {
          put(0x0e0 + pl * 4)
          put((ad >>> 16) & 0xffff)
          put(0x0e2 + pl * 4)
          put(ad & 0xffff)
        }
        if (pf2 !== null) {
          const base2 = this.rt.screenChipBase(pf2.index) + (pf2.doubleBuffered ? Runtime.SCREEN_PHY_OFFSET : 0)
          const rowOff2 = (L - pf2.displayY + pf2.offsetY) * pf2.rowBytes + ((pf2.offsetX >> 4) << 1)
          const n = Math.max(f.depth, pf2.depth)
          for (let i = 0; i < n; i++) {
            if (i < f.depth) emit(i * 2, (base + i * f.planeSize + rowOff) >>> 0)
            if (i < pf2.depth) emit(i * 2 + 1, (base2 + i * pf2.planeSize + rowOff2) >>> 0)
          }
        } else {
          for (let pl = 0; pl < f.depth; pl++) emit(pl, (base + pl * f.planeSize + rowOff) >>> 0)
        }
        const hwx = f.displayX + 1
        put(0x08e) // DIWSTRT
        put(((hwx & 0xff) | 0x0100) & 0xffff)
        put(0x090) // DIWSTOP
        put((((hwx + (this.winWOf(f) >> (f.hires ? 1 : 0))) & 0xff) | 0x3700) & 0xffff)
        const ds = f.hires ? ((hwx - 9) >> 1) & 0xfffc : ((hwx - 17) >> 1) & 0xfff8
        const de = ds + (this.winWOf(f) >> (f.hires ? 2 : 1)) - 8
        put(0x092)
        put(ds & 0xffff)
        put(0x094)
        put(de & 0xffff)
        // BPL1MOD is added to the pointer at the end of every display line,
        // so it has to make up the difference between what the DMA fetched
        // and one screen row: rowBytes - fetch.
        //
        // `fetch` is already a BYTE count and is right in both modes — a
        // 640-pixel hires line and a 320-pixel lores line both fetch
        // width/8 bytes per plane; hires differs in how fast it fetches
        // them, not how many. Halving it for hires (which this did) left
        // mod=40 on an 80-byte row, so the pointer advanced 120 bytes per
        // line and the picture walked one and a half rows per scanline.
        // Invisible until something replays the list, because the modelled
        // path ignores the modulo entirely — display.diff.test.ts is what
        // caught it.
        const fetch = (this.winWOf(f) >> 4) << 1
        let mod = Math.max(0, f.rowBytes - fetch)
        // interlace shows every other row, so a field advances two
        if (f.laced) mod += f.rowBytes
        put(0x108)
        put(mod)
        put(0x10a)
        put(mod)
        put(0x100) // BPLCON0
        // Dual playfield fetches BOTH bitmaps, so BPU is the pair's combined
        // depth and DBLPF (bit 10) is set — without either, a list replay
        // sees one playfield's worth of planes and cannot know to split them.
        const bpuTotal = pf2 !== null ? f.depth + pf2.depth : f.depth
        put(
          (((f.hires ? 0x8000 : 0) |
            (Math.min(bpuTotal, 7) << 12) |
            (pf2 !== null ? 0x0400 : 0) |
            (f.ham ? 0x0800 : 0) |
            0x0200 |
            (f.laced ? 4 : 0)) &
            0xffff) >>> 0,
        )
        put(0x102)
        put(0)
        put(0x104)
        // BPLCON2 is the screen's own EcCon2 (+W.s:6470), so a list copied
        // out of Cop Logic carries that screen's sprite priority with it
        put(((f.pf1p & 7) | ((f.pf2p & 7) << 3) | (f.pf2Front ? 0x40 : 0)) & 0xffff)
        // FiniCop: restart the DMA on the band's first line + the upper
        // palette half
        wait(L)
        put(0x096)
        put(0x8300)
        for (let i = 16; i < 32; i++) {
          put(0x180 + i * 2)
          put(f.palette[i]! & 0xfff)
        }
      } else if (didEnd) {
        endBand(L)
      }
      front = f
      // the single-rainbow machine (CopBow), interleaved with the bands
      if (curRb && L >= curRb.fy) {
        if (!didStart && !didEnd) {
          if (front) {
            wait(L)
            put(0x180 + curRb.colour * 2)
            put(front.palette[curRb.colour]! & 0xfff)
          } else if (curRb.colour === 0) {
            // RainNX: with no screen above, colour 0 goes back to the fond
            // rather than to a screen palette there is none of. Only the list
            // ever needed telling — the modelled renderer read colourBack
            // directly, so a rainbow ending over the border left the register
            // holding its last colour once the list became the display.
            wait(L)
            put(0x180)
            put(this.rt.colourBack & 0xfff)
          }
        }
        curRb = null
      }
      if (!curRb) curRb = rbs.find((r) => L >= r.dy && L < r.fy) ?? null
      if (curRb) {
        // at a band start the beam already sits at L after FiniCop — but only
        // if the band was actually written
        if (!didStart) wait(L)
        const t = curRb.table
        put(0x180 + curRb.colour * 2)
        put(t[(L - curRb.dy + curRb.base) % t.length]!)
      }
    }
    if (!emitted) {
      // no screens: the fond is still parked at the bottom (MCopX)
      wait(312)
      put(0x096)
      put(0x0100)
      put(0x180)
      put(this.rt.colourBack & 0xfff)
    } else if (front !== null) {
      // a screen still in front on the last line — its window runs off the
      // bottom, so the end band is the clamped one (MkA11)
      endBand(Display.EC_Y_MAX - 1)
    }
    put(0xffff)
    put(0xfffe)
    // MCopSw: swap the lists; the freshly built one becomes physical
    this.rt.copLogIsA = !this.rt.copLogIsA
  }

  /**
   * The scanline compositor: a faithful walk of the copper list the real
   * AMOS builds each vbl (EcCopper/CopBow +W.s:6030-6260). Per hardware
   * line: exactly ONE front screen is fetched (the screens are cut into
   * vertical slices by priority — "Decoupe les ecrans en tranches",
   * +W.s:5808); a band start reloads the hardware palette (EcCopHo); ONE
   * rainbow at a time writes its colour register per line (lowest-numbered
   * rainbow covering the line wins, RainN0), and on leaving its span the
   * register is restored from the screen palette — or colour 0 from the
   * fond when no screen is above (RainNX). The border shows hardware
   * colour 0, so a screen's palette bleeds into the border beside it and
   * a rainbow on colour 0 recolours the border itself.
   *
   * The current window's cursor is overlaid in its cursor pen (AffCur
   * +W.s:13604 forces the masked pixels to WiCuCol), so Flash and rainbows
   * show straight through it — the classic fading AMOS cursor.
   */
  composite(out?: Uint8ClampedArray): { width: number; height: number; data: Uint8ClampedArray } {
    const W = 640
    const H = Display.COMPOSITE_LINES * 2
    const data = out ?? new Uint8ClampedArray(W * H * 4)
    // Jd Video Off and Misc's Display Off both cleared sprite, copper and
    // bitplane DMA and blacked COLOR00. With the copper stopped there is no
    // list left to walk, so the display stays black until the matching On.
    if (this.rt.videoOff) {
      data.fill(0)
      for (let o = 3; o < data.length; o += 4) data[o] = 255
      return { width: W, height: H, data }
    }
    this.activateRainbows()
    // Something has pointed COP1LC at a list of its own (Personnal's Active
    // Copper). The hardware re-reads from that address every frame, so copy
    // it in every frame too — a program that patches its list after
    // activating it expects the change to show, and several do exactly that
    // inside their main loop.
    if (this.rt.copList1Addr !== null) this.rt.loadCopperFrom(this.rt.copList1Addr)
    // The list IS the display now, so it has to be current before it is
    // walked. frame() builds it each tick, but composite() is also called
    // directly — a driver grabbing a frame, or a test — and those used to get
    // the modelled renderer, which needed no list at all.
    if (this.rt.copperOn) this.buildCopperList()
    /**
     * ONE RENDERER. The display is produced by interpreting the copper list,
     * whether the list is AMOS's own or a user's under Copper Off.
     *
     * There used to be two: this walk, and a compositor that worked in terms
     * of Screen objects — frontAt() banding, displayX/Y, its own rainbow
     * machine, dual playfield by dualPartner. Every display feature had to be
     * built twice and kept agreeing, and only one of the two was exercised by
     * most programs. display.diff.test.ts compared them scene by scene until
     * they matched everywhere, and then the second one went.
     *
     * What that cost, and what it bought: the modelled renderer was wrong
     * about Screen Offset (it clipped at the screen edge where the hardware
     * walks the pointer into the next row) and it could not be pointed at
     * anything but a Screen. What it knew implicitly had to be moved into the
     * list, which is where the hardware keeps it — the fond after the HsCop
     * header, a rainbow's colour 0 restored to the fond over the border, and
     * dual playfield's two bitmaps interleaved into one pointer set.
     *
     * Layers are painted back to front: background, then the four sprite
     * pairs and the playfields sorted by PF1P/PF2P. EcCon2 does not say
     * "sprites in front" or "behind" — each playfield names the pair it slots
     * in behind, so a sprite can land between the two playfields of a dual
     * pair, and only a sorted stack can express that.
     */
    // no system list patches SPRxPT now, so the sprite side of the display
    // is whatever the user's list points at (TCopOn clears T_HsChange,
    // +W.s:6822). Until a list writes a sprite pointer the registers still
    // hold what the last system list left there, so AMOS's own sprites
    // carry on showing — at the priority the list's BPLCON2 asks for.
    const R = this.rt.copRegs
    const pf1p = R.bplcon2 & 7
    const pf2Front = (R.bplcon2 & 0x40) !== 0
    const spr = (frontPass: boolean): void => {
      // Whose sprites are these? Under Copper Off a user list has taken the
      // pointers over and drawListSprites follows them. With the copper ON
      // the SPRxPT writes in the list are AMOS's OWN — the system list put
      // them there — so the sprites are the machine's sprite objects, and
      // drawHwSprites is the renderer that knows their priority
      // (Sprite Priority / HsPri, PF1P and PF2P), which the list layer has
      // no way to recover from a bare pointer.
      if (R.sprSet && !this.rt.copperOn) this.drawListSprites(data, W, H, frontPass)
      else this.drawHwSprites(data, W, H, frontPass, this.rt.copperOn ? undefined : pf1p)
    }
    // Background first — the walk also settles the register file, so the
    // priorities below are the ones this frame's list actually asked for.
    this.compositeFromList(data, W, H, 'bg')
    if (!R.dblpf) {
      spr(false)
      this.compositeFromList(data, W, H, 'playfield')
      spr(true)
    } else {
      /**
       * Dual playfield: one interleaved stack, not two passes.
       *
       * EcCon2 does not say "sprites in front" or "sprites behind" — PF1P
       * and PF2P each name the sprite pair a playfield slots in BEHIND, so
       * a sprite can land between the two playfields. Three passes cannot
       * express that; this sorts the four sprite pairs and the two
       * playfields into one back-to-front order, which is the same stack
       * the modelled renderer builds and the reason it got this right.
       */
      const p1 = R.bplcon2 & 7
      const p2 = (R.bplcon2 >> 3) & 7
      const stack: Array<{ key: number; layer: 'pf1' | 'pf2' | number }> = [0, 1, 2, 3].map((p) => ({
        key: p,
        layer: p,
      }))
      // the half-step puts a playfield just behind the pair it names, and
      // the tenth breaks a tie the way PFBA does
      stack.push({ key: p1 - 0.5 + (pf2Front ? 0.1 : 0), layer: 'pf1' })
      stack.push({ key: p2 - 0.5 + (pf2Front ? 0 : 0.1), layer: 'pf2' })
      for (const e of stack.sort((a, b) => b.key - a.key)) {
        if (e.layer === 'pf1') this.compositeFromList(data, W, H, 'pf1')
        else if (e.layer === 'pf2') this.compositeFromList(data, W, H, 'pf2')
        else this.drawHwSprites(data, W, H, false, undefined, e.layer)
      }
    }
    return { width: W, height: H, data }
  }

  /**
   * Interpret the physical copper list (Copper Off mode): a beam walk over
   * the real word stream. WAITs advance the line (a $FFxx vpos is the
   * 255-crossing; $FFFF/$FFFE ends the list); MOVEs apply at the current
   * line.
   *
   * The fetch geometry comes from the registers, not from the screen the
   * pointers happen to resolve to:
   *
   * - BPL1PTH/L is a byte pointer walked down memory. Its row inside the
   *   screen is `ptr / rowBytes` and any remainder is a horizontal skew of
   *   8 pixels a byte, so a list that aims mid-row shears the picture just
   *   as the hardware does.
   * - BPL1MOD is added to that pointer at the end of every line (odd planes
   *   take MOD1; plane 0 is bitplane *one*). AMOS's own bands set it to
   *   `rowBytes - fetch`, which is what makes the pointer step exactly one
   *   row — a list choosing anything else legitimately repeats or shears
   *   the display, and interlace falls out of MOD1 += rowBytes.
   * - DDFSTRT/DDFSTOP set how many words are fetched per line, hence the
   *   width, and where the data lands: the first fetched pixel appears at
   *   colour clock `DDFSTRT*2 + 17` (lores) or `+9` (hires), the constants
   *   AMOS itself inverts when it derives DDF from DIWSTRT (+W.s:6293).
   * - BPLCON1's PF1H delays the playfield by up to 15 lores pixels.
   * - DIWSTRT/DIWSTOP window the result horizontally.
   * - BPLCON2's PF1P decides which sprite pairs are in front (see
   *   composite), and SPRxPT feed drawListSprites.
   *
   * Registers persist across frames, as the hardware's do — see copRegs.
   */
  /**
   * Walk the list and paint one LAYER of the display.
   *
   * Two passes rather than one, because the sprites go between them: the
   * hardware interleaves background, sprite pairs and playfields by
   * PF1P/PF2P, so a single pass that painted background and playfield
   * together would bury any sprite meant to sit behind the picture — and a
   * playfield pen of 0 would paint over it instead of letting it through.
   *
   * 'bg' fills each line from COLOR00 as the list leaves it; 'playfield'
   * draws the fetched pixels with pen 0 transparent. Walking twice costs a
   * second register pass (~1.2ms worst case, measured) and buys the correct
   * layering with no second renderer.
   */
  private compositeFromList(data: Uint8ClampedArray, W: number, H: number, layer: 'bg' | 'playfield' | 'pf1' | 'pf2' = 'bg'): void {
    void H
    const phys = this.rt.copPhysic
    const R = this.rt.copRegs
    const hwPal = new Uint16Array(256)
    const hwPalLo = new Uint16Array(256)
    hwPal.set(R.pal)
    hwPalLo.set(R.palLo)
    let p = 0
    let line = 0
    let cross = false
    let dmaOn = R.dmaOn
    let hires = R.hires
    let bpu = R.bpu
    let ham = R.ham
    let dblpf = R.dblpf
    let lace = R.lace
    let bplcon3 = R.bplcon3
    let hstart = R.hstart
    let hstop = R.hstop
    let ddfstrt = R.ddfstrt
    let ddfstop = R.ddfstop
    let mod1 = R.mod1
    let mod2 = R.mod2
    let bplcon1 = R.bplcon1
    let bplcon2 = R.bplcon2
    let sprSet = R.sprSet
    let screen: Screen | null = R.screenIdx >= 0 ? (this.rt.screens.get(R.screenIdx) ?? null) : null
    let usePhy = R.usePhy
    let ptr = R.ptr
    /**
     * Byte offset of each plane's fetch inside its own plane of the resolved
     * screen. The system list points every plane at base + p*planeSize +
     * rowOff, so these normally all equal `ptr` — but they are tracked
     * separately because BPL2PT..BPL8PT are real registers and a list is
     * entitled to aim them independently.
     */
    const planeOff = new Int32Array(8).fill(R.ptr)
    /**
     * Which SCREEN each plane is fetched from. Normally all the same one, but
     * dual playfield weaves two bitmaps into one pointer set, so a plane can
     * legitimately come from somewhere else. null = follow BPL1PT's screen.
     */
    const planeScr: Array<Screen | null> = new Array(8).fill(null)
    /** per-plane: did its own pointer land in the physical half? */
    const planePhy: boolean[] = new Array(8).fill(false)
    // per-row scratch for the fetch: which buffer each plane reads, where its
    // row starts in it, and the byte currently covering these eight pixels
    const pBuf: Array<Uint8Array> = new Array(8).fill(EMPTY_PLANE)
    const pBase = new Int32Array(8)
    const pByte = new Int32Array(8)
    // BPLCON2 PFBA: which playfield is in front when both are on
    let pf2Front = (R.bplcon2 & 0x40) !== 0
    const bplH = Int32Array.from(R.bplH)
    const bplL = Int32Array.from(R.bplL)
    const sprH = Int32Array.from(R.sprH)
    const sprL = Int32Array.from(R.sprL)

    const renderLines = (to: number): void => {
      const end = Math.min(to, 313)
      for (; line < end; line++) {
        const fetching = dmaOn && screen !== null
        // words fetched per line: (stop-start)/8+1 lores, /4+2 hires — the
        // standard $38/$D0 and $3C/$D4 pairs give 20 and 40 words
        let words = 0
        if (fetching) {
          const span = ddfstop - ddfstrt
          words = span < 0 ? 0 : hires ? (span >> 2) + 2 : (span >> 3) + 1
          if (words > 128) words = 128
        }
        if (line >= Display.COMPOSITE_TOP && line < Display.COMPOSITE_TOP + Display.COMPOSITE_LINES) {
          // COLOR00 is a palette entry like any other, so it carries a LOCT
          // half too — a background set through Cop True Palette is 24-bit
          const bg = hwPal[0]!
          const bgLo = hwPalLo[0]!
          const bgR = (((bg >> 8) & 15) << 4) | ((bgLo >> 8) & 15)
          const bgG = (((bg >> 4) & 15) << 4) | ((bgLo >> 4) & 15)
          const bgB = ((bg & 15) << 4) | (bgLo & 15)
          const r0 = (line - Display.COMPOSITE_TOP) * 2
          for (let ri = 0; ri < 2; ri++) {
            const r = r0 + ri
            const bgPass = layer === 'bg'
            if (bgPass) {
              for (let o = r * W * 4; o < (r + 1) * W * 4; o += 4) {
                data[o] = bgR
                data[o + 1] = bgG
                data[o + 2] = bgB
                data[o + 3] = 255
              }
              continue
            }
            if (!fetching || words === 0) continue
            const s = screen!
            // the pointer is a byte address: whole rows plus a byte skew
            // BPLCON0's LACE means the same thing the screen's own flag does:
            // a field shows every other row, so the pointer advances a whole
            // row per displayed line. Either source turns it on — the screen
            // was opened laced, or the list asked for it (Personnal's Set Lace
            // is Bset/Bclr #2 on this word and nothing else).
            const laced = s.laced || lace
            // The DMA reads BITPLANES. Each plane is fetched from its own
            // pointer, and composing the index from those bits is what makes
            // dual playfield, a list pointing planes at different rows, and
            // any other pointer arrangement work — none of which the old
            // chunky read could express.
            // `usePhy` says the pointer landed in the physical half of the
            // screen's slot. That only means a DIFFERENT bitmap when Autoback
            // has actually split them — with the default Autoback 2 the two
            // are kept identical and the logical one is what displayBuffer
            // returned before, so following the pointer blindly here would
            // show an empty back buffer.
            const wantPhy = usePhy && s.doubleBuffered && s.autoback === 0
            const planes = s.planarView(wantPhy ? 'phy' : 'log', false)
            const rowSkew = laced ? ri * s.rowBytes : 0
            const pw = hires ? 1 : 2
            // where the first fetched pixel lands, in colour clocks
            const dataStart = ddfstrt * 2 + (hires ? 9 : 17) + (bplcon1 & 15)
            const originX = (dataStart - 1 - 128) * 2
            const colour = this.rowColours(s, hwPal, hwPalLo, ham)
            /** one pen straight out of the register file, as 24 bits */
            const pen24 = (i: number): number => {
              const h = hwPal[i]!
              const l = hwPalLo[i]!
              return (
                ((((h >> 8) & 15) << 4) | ((l >> 8) & 15)) * 65536 +
                ((((h >> 4) & 15) << 4) | ((l >> 4) & 15)) * 256 +
                (((h & 15) << 4) | (l & 15))
              )
            }
            // BPU alone decides how many planes are fetched. Capping this at
            // the BPL1PT screen's depth was safe while every plane came from
            // that one screen, and is wrong now: dual playfield's PF2 planes
            // live in the partner bitmap and would all be skipped. Each
            // plane's read bounds-checks its own buffer instead.
            const nPlanes = Math.min(bpu, 8)
            // resolve each plane's buffer and row base ONCE for the row. A
            // plane with its own pointer reads from its own bitmap and out of
            // plane 0 of it, because the pointer already named the plane; the
            // rest index this screen's plane p.
            for (let p = 0; p < nPlanes; p++) {
              const ps = planeScr[p] ?? null
              // same Autoback rule as BPL1PT above: the physical half is only a
              // different bitmap once Autoback 0 has stopped keeping them equal
              const psPhy = ps !== null && planePhy[p]! && ps.doubleBuffered && ps.autoback === 0
              pBuf[p] = ps === null ? planes : ps.planarView(psPhy ? 'phy' : 'log', false)
              // TURBO's Plane Offset shifts one plane against the others. It
              // used to be simulated by skewing a chunky lookup because there
              // were no planes to offset; now it is what it always was on the
              // hardware — a byte added to that plane's pointer.
              const po = (ps ?? s).planeOffsets
              pBase[p] = (ps === null ? p * s.planeSize : 0) + planeOff[p]! + rowSkew + (po ? po[p]! : 0)
            }
            // PF1 takes bitplanes 1,3,5 (indices 0,2,4) and PF2 takes 2,4,6.
            // Each is a 3-bit index of its own; PF2's pens live at 8-15, and
            // colour 0 in either playfield shows what is behind it.
            const n = words * 16
            for (let i = 0; i < n; i++) {
              // DIW clips in colour clocks, so a hires pair shares one
              const hx = dataStart + (hires ? i >> 1 : i)
              if (hx < hstart || hx >= hstop) continue
              let pf1 = 0
              let pf2 = 0
              // one byte per plane covers eight pixels, so the fetch happens
              // on the byte boundary and the seven pixels after it read out of
              // locals. Resolving the buffers per pixel per plane — which is
              // what this did when it was written — cost 13-18ms a frame.
              if ((i & 7) === 0) {
                for (let p = 0; p < nPlanes; p++) {
                  const at = pBase[p]! + (i >> 3)
                  const buf = pBuf[p]!
                  pByte[p] = at >= 0 && at < buf.length ? buf[at]! : 0
                }
              }
              const bit = 0x80 >> (i & 7)
              for (let p = 0; p < nPlanes; p++) {
                if ((pByte[p]! & bit) === 0) continue
                if (!dblpf) pf1 |= 1 << p
                else if ((p & 1) === 0) pf1 |= 1 << (p >> 1)
                else pf2 |= 1 << (p >> 1)
              }
              // back to front: PF2 behind PF1 unless PFBA says otherwise, and
              // a zero pen in the front playfield lets the back one through
              // 24-bit: the high nibbles from COLORxx and the low ones from
              // the LOCT pass, already joined by `colour` / `pen24`
              let rgb4: number
              if (!dblpf) {
                // colour 0 shows whatever is behind the playfield — the
                // background, or a sprite the back pass already drew
                if (pf1 === 0) continue
                rgb4 = colour(pf1)
              } else {
                const front = pf2Front ? pf2 : pf1
                const frontPal = pf2Front ? 8 : 0
                const back = pf2Front ? pf1 : pf2
                const backPal = pf2Front ? 0 : 8
                // a single-playfield pass draws only its own pixels, so the
                // sprite layers sorted between the two can survive
                if (layer === 'pf1') {
                  if (pf1 === 0) continue
                  rgb4 = pen24(pf1)
                } else if (layer === 'pf2') {
                  if (pf2 === 0) continue
                  rgb4 = pen24(8 + pf2)
                } else if (front !== 0) rgb4 = pen24(frontPal + front)
                else if (back !== 0) rgb4 = pen24(backPal + back)
                else continue // both playfields transparent here
              }
              const cr = (rgb4 >> 16) & 0xff
              const cg = (rgb4 >> 8) & 0xff
              const cb = rgb4 & 0xff
              const px = originX + i * pw
              for (let dx = 0; dx < pw; dx++) {
                const tx = px + dx
                if (tx < 0 || tx >= W) continue
                const o = (r * W + tx) * 4
                data[o] = cr
                data[o + 1] = cg
                data[o + 2] = cb
                data[o + 3] = 255
              }
            }
          }
        }
        // end of line: the modulo joins the fetched words (BPL1MOD, odd planes)
        if (fetching) {
          const step = words * 2
          ptr += step + mod1
          // bitplane ONE is index 0, and the odd bitplanes take BPL1MOD
          for (let p = 0; p < 8; p++) planeOff[p] = planeOff[p]! + step + ((p & 1) === 0 ? mod1 : mod2)
        }
      }
      if (to > line) line = end
    }

    while (p + 4 <= phys.length) {
      const w1 = (phys[p]! << 8) | phys[p + 1]!
      const w2 = (phys[p + 2]! << 8) | phys[p + 3]!
      p += 4
      if (w1 & 1) {
        if (w1 === 0xffff && w2 === 0xfffe) break
        const vp = (w1 >> 8) & 0xff
        if (vp === 0xff && !cross) {
          renderLines(256)
          cross = true
          continue
        }
        renderLines(vp + (cross ? 256 : 0))
      } else {
        const reg = w1 & 0x1fe
        if (reg >= 0x180 && reg < 0x1c0) {
          /*
           * AGA colour banking. There are only 32 colour registers; the
           * other 224 entries are reached by putting a bank number in
           * BPLCON3 bits 13-15 and writing the same registers again, and
           * the LOCT bit ($200) redirects a write to the LOW nibbles of
           * each component instead of the high ones.
           *
           * Both halves of that are what `Cop Palette` and `Cop True
           * Palette` emit (runtime/stars.ts) — this is the reader for
           * exactly the instructions that writer already produces.
           *
           * With LOCT clear the high nibble is replicated into the low
           * one. That keeps every ECS list bit-identical, because
           * `hi << 4 | hi` is the `hi * 17` this renderer expanded with
           * before there was a low nibble.
           */
          const idx = (((bplcon3 >> 13) & 7) << 5) | ((reg - 0x180) >> 1)
          if (bplcon3 & 0x200) hwPalLo[idx] = w2 & 0xfff
          else {
            hwPal[idx] = w2 & 0xfff
            hwPalLo[idx] = w2 & 0xfff
          }
          // through $0fe: $0f8-$0fe are BPL7/BPL8, which only AGA fetches.
          // bplH/bplL were already 8 wide; only this range test excluded them.
        } else if (reg >= 0x0e0 && reg <= 0x0fe) {
          const idx = (reg - 0xe0) >> 2
          if (reg & 2) bplL[idx] = w2
          else bplH[idx] = w2
          if (idx > 0 && bplH[idx]! >= 0 && bplL[idx]! >= 0) {
            // a plane aimed on its own, which dual playfield always does and
            // which a hand-written list is entitled to do for shear effects
            const ad = (((bplH[idx]! << 16) | bplL[idx]!) >>> 0)
            const hit = this.resolvePlanePtr(ad)
            if (hit) {
              planeScr[idx] = hit.s
              planeOff[idx] = hit.off
              planePhy[idx] = hit.phy
            }
          }
          if (idx === 0 && bplH[0]! >= 0 && bplL[0]! >= 0) {
            const ad = (((bplH[0]! << 16) | bplL[0]!) >>> 0)
            const hit = this.screenSlot(ad)
            screen = null
            if (hit) {
              usePhy = hit.phy
              screen = hit.s
              ptr = hit.within
              planeOff.fill(hit.within)
              planeScr.fill(null)
              planePhy.fill(false)
            }
          }
        } else if (reg >= 0x120 && reg <= 0x13e) {
          const idx = (reg - 0x120) >> 2
          if (reg & 2) sprL[idx] = w2
          else sprH[idx] = w2
          sprSet = true
        } else if (reg === 0x100) {
          hires = (w2 & 0x8000) !== 0
          // BPU is 12-14 plus BPU3 at bit 4, which is how AGA says eight
          // planes — Personnal's _PlanesMask (:399) ends $7000,$10 for
          // exactly that reason, and Set View Planes clears bit 4 alongside
          // 12-14 before it ORs the new count in. Reading only 12-14 makes an
          // 8-plane list look like no planes at all.
          bpu = ((w2 >> 12) & 7) | ((w2 >> 1) & 8)
          ham = (w2 & 0x0800) !== 0
          dblpf = (w2 & 0x0400) !== 0
          lace = (w2 & 0x0004) !== 0
        } else if (reg === 0x106) {
          bplcon3 = w2 & 0xffff
        } else if (reg === 0x102) {
          bplcon1 = w2 & 0xff
        } else if (reg === 0x104) {
          bplcon2 = w2 & 0x7f
          pf2Front = (w2 & 0x40) !== 0
        } else if (reg === 0x108) {
          mod1 = (w2 << 16) >> 16 // signed word
        } else if (reg === 0x10a) {
          mod2 = (w2 << 16) >> 16
        } else if (reg === 0x092) {
          ddfstrt = w2 & 0xfe
        } else if (reg === 0x094) {
          ddfstop = w2 & 0xfe
        } else if (reg === 0x096) {
          if (w2 & 0x8000) {
            if (w2 & 0x0100) dmaOn = true
          } else if (w2 & 0x0100) {
            dmaOn = false
          }
        } else if (reg === 0x08e) {
          hstart = w2 & 0xff
        } else if (reg === 0x090) {
          // DIWSTOP's H8 is inverted on the hardware, so a stop right of
          // colour clock 255 is written with the bit clear
          hstop = (w2 & 0xff) | 0x100
        }
      }
    }
    renderLines(313)
    // carry the register file into the next frame
    R.pal.set(hwPal)
    R.palLo.set(hwPalLo)
    R.dmaOn = dmaOn
    R.hires = hires
    R.bpu = bpu
    R.ham = ham
    R.dblpf = dblpf
    R.lace = lace
    R.bplcon3 = bplcon3
    R.hstart = hstart
    R.hstop = hstop
    R.ddfstrt = ddfstrt
    R.ddfstop = ddfstop
    R.mod1 = mod1
    R.mod2 = mod2
    R.bplcon1 = bplcon1
    R.bplcon2 = bplcon2
    R.bplH.set(bplH)
    R.bplL.set(bplL)
    R.sprH.set(sprH)
    R.sprL.set(sprL)
    R.sprSet = sprSet
    R.screenIdx = screen ? screen.index : -1
    R.usePhy = usePhy
    // the pointer keeps whatever the walk left it at: nothing reloads
    // BPLxPT at the vertical blank, the copper list does it, so a list that
    // sets the pointers once and never again really does march off the
    // bitmap on its second frame
    R.ptr = ptr
  }

  /**
   * Hardware sprites straight out of SPRxPT (Copper Off).
   *
   * The system list leaves eight patch slots at $120-$13E for HsAff to fill
   * in (HsCop +W.s:6783); once the program owns the list they are its to
   * write, and the data behind them is the plain Amiga sprite structure:
   * SPRxPOS/SPRxCTL, then VSTOP-VSTART rows of two bitplane words, then a
   * zero long to end. Pair n draws in colours 17+4n..19+4n; CTL bit 7
   * attaches the odd sprite to the even one for a single 16-colour sprite
   * out of colours 16-31.
   */
  private drawListSprites(data: Uint8ClampedArray, W: number, H: number, frontPass: boolean): void {
    const R = this.rt.copRegs
    const pf1p = R.bplcon2 & 7
    const pal = R.pal
    /** decoded pixels of one channel: y*1024+hx -> 2-bit colour */
    const decode = (n: number): Map<number, number> => {
      const out = new Map<number, number>()
      if (R.sprH[n]! < 0 || R.sprL[n]! < 0) return out
      const m = this.rt.resolveAddr((((R.sprH[n]! << 16) | R.sprL[n]!) >>> 0))
      if (!m) return out
      const mem = m.data
      let o = m.off
      const w = (i: number): number => (i + 1 < mem.length ? (mem[i]! << 8) | mem[i + 1]! : 0)
      // one pointer can chain several sprites down the display
      for (let guard = 0; guard < 32; guard++) {
        if (o + 4 > mem.length) break
        const pos = w(o)
        const ctl = w(o + 2)
        if (pos === 0 && ctl === 0) break
        const vstart = ((pos >> 8) & 0xff) | (ctl & 4 ? 0x100 : 0)
        let vstop = ((ctl >> 8) & 0xff) | (ctl & 2 ? 0x100 : 0)
        const hx = ((pos & 0xff) << 1) | (ctl & 1)
        if (vstop < vstart) vstop = vstart
        if (vstop - vstart > 313) vstop = vstart + 313
        o += 4
        for (let y = vstart; y < vstop && o + 4 <= mem.length; y++) {
          const a = w(o)
          const b = w(o + 2)
          o += 4
          for (let x = 0; x < 16; x++) {
            const bit = 15 - x
            const v = ((a >> bit) & 1) | (((b >> bit) & 1) << 1)
            if (v !== 0) out.set(y * 1024 + ((hx + x) & 1023), v)
          }
        }
      }
      return out
    }
    /** ATTACH lives in the odd sprite's control word */
    const attached = (n: number): boolean => {
      if (R.sprH[n]! < 0 || R.sprL[n]! < 0) return false
      const m = this.rt.resolveAddr((((R.sprH[n]! << 16) | R.sprL[n]!) >>> 0))
      if (!m || m.off + 4 > m.data.length) return false
      return (((m.data[m.off + 2]! << 8) | m.data[m.off + 3]!) & 0x80) !== 0
    }
    const put = (hx: number, hy: number, rgb4: number): void => {
      const bx = (hx - 128) * 2
      const by = (hy - Display.COMPOSITE_TOP) * 2
      const cr = ((rgb4 >> 8) & 15) * 17
      const cg = ((rgb4 >> 4) & 15) * 17
      const cb = (rgb4 & 15) * 17
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const tx = bx + dx
          const ty = by + dy
          if (tx < 0 || ty < 0 || tx >= W || ty >= H) continue
          const o = (ty * W + tx) * 4
          data[o] = cr
          data[o + 1] = cg
          data[o + 2] = cb
        }
      }
    }
    // pairs draw back-to-front: 3, 2, 1, 0 — sprite 0 tops the display
    for (let pair = 3; pair >= 0; pair--) {
      if (frontPass ? !(pair < pf1p) : pair < pf1p) continue
      const even = decode(pair * 2)
      const odd = decode(pair * 2 + 1)
      if (attached(pair * 2 + 1)) {
        for (const k of new Set([...even.keys(), ...odd.keys()])) {
          const v = (even.get(k) ?? 0) | ((odd.get(k) ?? 0) << 2)
          if (v !== 0) put(k & 1023, Math.floor(k / 1024), pal[16 + v]! & 0xfff)
        }
        continue
      }
      for (const [k, v] of odd) put(k & 1023, Math.floor(k / 1024), pal[16 + pair * 4 + v]! & 0xfff)
      for (const [k, v] of even) put(k & 1023, Math.floor(k / 1024), pal[16 + pair * 4 + v]! & 0xfff)
    }
  }

  /** Workbench-style menu bar while the right button is held */

  /**
   * The real bob pipeline (the vbl Actualise): restore the saved
   * backgrounds of the previous frame in reverse order, then draw every
   * bob into the LOGICAL buffer, saving what was underneath. Point,
   * Screen Copy and Get Bob therefore see bobs, exactly as with a
   * single-buffered real AMOS.
   */
  updateBobs(): void {
    // restore, newest first
    const saved = [...this.rt.bobSaved.entries()].reverse()
    for (const [key, bg] of saved) {
      const s = this.rt.screens.get(bg.screen)
      // a background belongs to the buffer it was taken from. After a swap the
      // other buffer's saves are still wanted, and putting them back HERE
      // would paint two-frame-old pixels into the wrong one.
      if (s && s.bufferId !== bg.buffer) continue
      if (s) {
        const px = s.pixelsW()
        for (let y = 0; y < bg.h; y++) {
          px.set(bg.data.subarray(y * bg.w, (y + 1) * bg.w), (bg.y + y) * s.width + bg.x)
        }
      }
      this.rt.bobSaved.delete(key)
    }
    // draw in priority order
    const bobs = [...this.rt.bobs.values()]
    bobs.sort((a, b) => {
      if (!this.rt.priorityOn) return a.n - b.n
      return this.rt.priorityReverse ? b.y - a.y : a.y - b.y
    })
    for (const bob of bobs) {
      const s = this.rt.screens.get(bob.screen)
      const img = this.rt.spriteBank?.image(bob.image)
      if (!s || !img) continue
      const mode = this.rt.bobModes.get(bob.n) ?? 0
      const limit = this.rt.bobLimits.get(bob.n) ?? this.rt.bobLimits.get(-1)
      let bx = bob.x
      let by = bob.y
      if (limit) {
        bx = Math.max(limit.x1 + img.hotX, Math.min(limit.x2 - (img.width - img.hotX), bx))
        by = Math.max(limit.y1 + img.hotY, Math.min(limit.y2 - (img.height - img.hotY), by))
        bob.x = bx
        bob.y = by
      }
      const dx = bx - img.hotX
      const dy = by - img.hotY
      // clip the rect to the screen
      const x1 = Math.max(0, dx)
      const y1 = Math.max(0, dy)
      const x2 = Math.min(s.width, dx + img.width)
      const y2 = Math.min(s.height, dy + img.height)
      if (x1 >= x2 || y1 >= y2) continue
      /**
       * What `Bob Clear` will put back here, for all three `Set Bob` modes.
       *
       *   back = 0   the pixels underneath, saved and restored (the default)
       *   back > 0   a solid fill of colour back-1
       *   back < 0   ZEROES, so the rectangle is blanked
       *
       * DEVIATION: the negative case is inferred, not read. `ResBOB`
       * (+W.s:975) sets `BbDecor` --- the COUNT of background buffers --- to 1,
       * to 2 when the screen is double buffered, and to 0 for a negative back;
       * the routine that consumes it at draw time lives in AMOS.library and is
       * not in the vendored sources, so what a zero-buffer bob does on erase
       * is not directly readable here.
       *
       * Blanking is what the callers say it must be. `TargetSystem.AMOS` sets
       * fifty-four bobs to -1 over a black background and then calls
       * `Bob Clear` every frame, which is only a sensible thing to write if
       * `Bob Clear` clears them; treated as "no background, so leave a trail"
       * it smeared 19,292 pixels of the screen by frame 120 and nothing in the
       * loop could ever have removed them. Zero rather than a restore is also
       * what costs no memory, which is the point of asking for no buffer.
       */
      {
        const w = x2 - x1
        const h = y2 - y1
        const data = new Uint8Array(w * h)
        if (mode === 0) {
          for (let y = 0; y < h; y++) {
            data.set(s.pixels.subarray((y1 + y) * s.width + x1, (y1 + y) * s.width + x2), y * w)
          }
        } else if (mode > 0) {
          data.fill((mode - 1) & 63)
        }
        this.rt.bobSaved.set(`${bob.n}|${s.bufferId}`, {
          bob: bob.n,
          screen: bob.screen,
          buffer: s.bufferId,
          x: x1,
          y: y1,
          w,
          h,
          data,
        })
      }
      // Set Bob's plane mask restricts which bitplanes the bob writes, so a
      // bob can be confined to (say) the low two planes of a 16-colour screen
      // and leave the rest of the background showing through (BbAPlan).
      const planes = this.rt.bobPlanes.get(bob.n) ?? -1
      /**
       * The blitter, per pixel.
       *
       * A is the mask (set where the bob is not colour 0, or everywhere for a
       * No Mask image), B the source plane bit, C the destination. The
       * default $0FCA reduces to "D = A ? B : C", which is the cookie-cut
       * path below and stays a straight copy — a custom control word takes
       * the general route and evaluates the truth table a plane at a time.
       */
      const con0 = bobBltcon0(this.rt.bobMinterms.get(bob.n) ?? 0, !img.opaque)
      const plain = con0 === COOKIE_CUT || con0 === 0x07ca
      for (let y = y1; y < y2; y++) {
        const iy = y - dy
        for (let x = x1; x < x2; x++) {
          const v = img.pixels[iy * img.width + (x - dx)]!
          const old = s.point(x, y)
          let out: number
          if (plain) {
            if (v === 0 && !img.opaque) continue
            out = v
          } else {
            const a = v !== 0 || img.opaque ? 1 : 0
            out = 0
            for (let p = 0; p < s.depth; p++) {
              const bit = 1 << p
              if (mintermBit(con0, a, (v & bit) !== 0 ? 1 : 0, (old & bit) !== 0 ? 1 : 0)) out |= bit
            }
          }
          s.putPixel(x, y, planes === -1 ? out : (old & ~planes) | (out & planes))
        }
      }
    }
  }

  /** restore all bob backgrounds now (Bob Clear) */
  clearBobs(): void {
    const saved = [...this.rt.bobSaved.entries()].reverse()
    for (const [key, bg] of saved) {
      const s = this.rt.screens.get(bg.screen)
      // a background belongs to the buffer it was taken from. After a swap the
      // other buffer's saves are still wanted, and putting them back HERE
      // would paint two-frame-old pixels into the wrong one.
      if (s && s.bufferId !== bg.buffer) continue
      if (s) {
        const px = s.pixelsW()
        for (let y = 0; y < bg.h; y++) {
          px.set(bg.data.subarray(y * bg.w, (y + 1) * bg.w), (bg.y + y) * s.width + bg.x)
        }
      }
      this.rt.bobSaved.delete(key)
    }
  }

  /** decode a screen id from Logic()/Physic() (bit 31 set, bit 30 = physic) */
  /**
   * Resolve a BPLxPT address to the screen and the byte offset WITHIN the
   * plane it names.
   *
   * The address already picks out a plane, so the offset returned is relative
   * to that plane's start — the caller reads it out of plane 0 of the buffer
   * it gets back and does not add p*planeSize again.
   */
  /**
   * Decode a BPLxPT value to a screen, an offset and WHICH BITMAP.
   *
   * The `phy` flag used to be computed and thrown away, so BPL2PT-BPL8PT all
   * read the logical bitmap however the list pointed them, while BPL1PT's own
   * inline decode honoured it. A list that points one plane at the logical
   * buffer and another at the physical one — which is what a program does to
   * show a composite of both — rendered entirely from one of them.
   */
  /**
   * How far BEFORE a bitmap a plane pointer may legitimately sit.
   *
   * A list that scrolls horizontally fetches one extra word at the left, aims
   * the plane a word short of the bitmap, and makes the difference up in
   * BPLCON1's pixel delay. Display 0.01 does exactly that — `subi.l #$2,d5`
   * at $480 biases every plane, and $5b4 sets the delay to `16 - (x and 15)`
   * — and it is the pointer for `x and 15 = 0`, which is where a scroll
   * starts. Resolving it strictly put it in the PREVIOUS screen slot, so the
   * screen was not found at all and the display stayed blank.
   *
   * Two bytes is the whole tolerance: one word is what one extra fetch is.
   * The slot is 1MB and the physical half starts 512KB in, so shifting every
   * pointer by two before the slot arithmetic cannot reach a real bitmap —
   * the largest one this port opens is 320KB.
   */
  private static readonly PRE_FETCH = 2

  /**
   * Which screen slot an address names, and where in that screen's bitmap.
   *
   * `within` may be as low as -PRE_FETCH; every reader bounds-checks its own
   * byte, so a negative offset reads as zero rather than as somebody else's
   * memory. That is the right answer here: on the machine those two bytes
   * hold whatever precedes the bitmap and the delay hides them behind the
   * display window.
   */
  private screenSlot(ad: number): { s: Screen; within: number; phy: boolean } | null {
    const a = ad + Display.PRE_FETCH
    if (a < Runtime.SCREEN_CHIP_BASE || a >= Runtime.SCREEN_CHIP_BASE + Runtime.SCREEN_SLOTS * Runtime.SCREEN_CHIP_SLOT)
      return null
    const rel = a - Runtime.SCREEN_CHIP_BASE
    const s = this.rt.screens.get(Math.floor(rel / Runtime.SCREEN_CHIP_SLOT))
    if (!s) return null
    let within = rel % Runtime.SCREEN_CHIP_SLOT
    const phy = within >= Runtime.SCREEN_PHY_OFFSET
    if (phy) within -= Runtime.SCREEN_PHY_OFFSET
    return { s, within: within - Display.PRE_FETCH, phy }
  }

  private resolvePlanePtr(ad: number): { s: Screen; off: number; phy: boolean } | null {
    const hit = this.screenSlot(ad)
    if (!hit) return null
    if (hit.within < -Display.PRE_FETCH || hit.within >= hit.s.depth * hit.s.planeSize) return null
    return { s: hit.s, off: hit.within, phy: hit.phy }
  }

  resolveScreenId(id: number, write = false): { s: Screen; buf: Uint8Array } {
    if (id < 0) {
      const physic = (id & 0x40000000) !== 0
      const n = id & 0xff
      const useCurrent = (id & 0x3fffff00) === 0x3fffff00 // bare Logic/Physic (-1 based)
      const s = this.rt.screens.get(useCurrent ? this.rt.currentIndex : n)
      if (!s) throw new AmosError(`screen not opened: ${useCurrent ? this.rt.currentIndex : n}`)
      return { s, buf: s.bufferFor(physic ? 'physic' : 'logic', write) }
    }
    const s = this.rt.screens.get(id)
    if (!s) throw new AmosError(`screen not opened: ${id}`)
    return { s, buf: write ? s.pixelsW() : s.pixels }
  }

  /**
   * The PF1P in force at a hardware scanline: the topmost visible screen
   * covering it, else the frontmost screen (EcCon2, HsPri +W.s:11374).
   */
  private priorityUnder(hy: number): number {
    for (let i = this.rt.order.length - 1; i >= 0; i--) {
      const s = this.rt.screens.get(this.rt.order[i]!)
      if (!s || !s.visible) continue
      if (hy >= s.displayY && hy < s.displayY + s.height) return s.pf1p
    }
    return this.rt.screens.get(this.rt.order[this.rt.order.length - 1] ?? 0)?.pf1p ?? 4
  }

  /**
   * Which hardware channel each sprite ends up on (HsAff +W.s:11742-11960).
   *
   * Sprites 0-7 are "direct": they own the channel of the same number, and
   * a visible mouse pointer holds channel 0 (HsAff's T_MouShow test). Every
   * higher sprite is "computed" and shares what is left, which is the whole
   * point of the multiplexer: the channels are re-used down the display, so
   * a sprite only needs a channel free from its own top line onward.
   *
   * The 68k sorts them by top edge (HsYr, ties by sprite number — Hss20-23)
   * and packs them round-robin: try channels from where the last one landed,
   * take the first whose previous occupant has already finished above this
   * sprite's top (`HsYr >= HsYAct`) and which still has room in its column
   * buffer (`HsPAct + height+1 <= HsPMax`), and give up after eight misses.
   * A sprite wider than 16 pixels takes that many channels side by side, and
   * a 16-colour one must start on an even channel (HsMAff).
   *
   * This decides the sprite's *pair*, so it decides whether it is in front
   * of the playfield: exactly the thing that used to be guessed by calling
   * every computed sprite pair 3.
   */
  spriteChannels(sprites: HwSprite[]): Map<number, number> {
    const out = new Map<number, number>()
    const free = [true, true, true, true, true, true, true, true]
    const yAct = new Int32Array(8)
    const pAct = new Int32Array(8)
    const computed: { sp: HwSprite; yr: number; h: number; w: number; multi: boolean }[] = []
    for (const sp of sprites) {
      if (sp.n < 8) {
        out.set(sp.n, sp.n)
        free[sp.n] = false
        continue
      }
      const img = this.rt.spriteBank?.image(sp.image)
      if (!img) continue
      computed.push({
        sp,
        yr: Math.max(0, sp.y - img.hotY),
        h: img.height + 1,
        w: Math.max(1, Math.ceil(img.width / 16)),
        multi: img.depth > 2,
      })
    }
    if (this.rt.mouseShow >= 0) free[0] = false
    // HsPMax = lines - 2 words per column (HsRBuf +W.s:11311)
    const pMax = Math.max(0, this.rt.spriteBufferLines - 2)
    computed.sort((a, b) => a.yr - b.yr || a.sp.n - b.sp.n)
    let cur = 0
    for (const c of computed) {
      for (let tries = 0; tries < 8; tries++) {
        const col = (cur + tries) % 8
        if (!free[col]) continue
        if (c.multi && col % 2 !== 0) continue
        if (c.yr < yAct[col]! || pAct[col]! + c.h > pMax) continue
        out.set(c.sp.n, col)
        // a wide sprite occupies consecutive channels, 16 pixels apart
        for (let k = 0; k < c.w && col + k < 8; k++) {
          yAct[col + k] = c.yr + c.h
          pAct[col + k] = pAct[col + k]! + c.h
        }
        cur = (col + c.w) % 8
        break
      }
    }
    return out
  }

  /** Hardware sprites draw over everything, colours 16-31, hw coords. */
  private drawHwSprites(
    data: Uint8ClampedArray,
    W: number,
    H: number,
    frontPass: boolean,
    pf1pOverride?: number,
    /** draw ONLY this channel pair, for walking a sorted layer stack */
    onlyPair?: number,
  ): void {
    const list = this.spriteList()
    for (let r = 0; r < H; r++) {
      this.blitSpriteRow(data, W, r, list, null, (pair) => {
        if (onlyPair !== undefined) return pair === onlyPair
        const p = pf1pOverride ?? this.priorityUnder(Display.COMPOSITE_TOP + (r >> 1))
        return frontPass ? pair < p : pair >= p
      })
    }
  }

  /**
   * The visible hardware sprites, each with the channel pair it landed on.
   *
   * The mouse pointer is hardware sprite 0 — HiSho1 sets it up through the
   * same HsSet channel 0 — so it is pair 0, and it goes last so it tops
   * whatever else shares its layer.
   */
  private spriteList(): { img: BankImage; hx: number; hy: number; pair: number }[] {
    // SPREN off takes the pointer with everything else — Misc's `Mouse Off`
    // clears the DMA bit rather than the pointer, so all eight go
    if (!this.rt.spriteDma) return []
    const sprites = this.rt.spriteUpdateOn ? [...this.rt.hwSprites.values()] : (this.rt.frozenSprites ?? [])
    const channels = this.spriteChannels(sprites)
    const out: { img: BankImage; hx: number; hy: number; pair: number }[] = []
    for (const sp of sprites) {
      const img = this.rt.spriteBank?.image(sp.image)
      if (img) out.push({ img, hx: sp.x, hy: sp.y, pair: (channels.get(sp.n) ?? 6) >> 1 })
    }
    if (this.rt.copperOn && this.rt.mouseShow >= 0 && this.rt.mouseShape !== null) {
      out.push({ img: this.rt.mouseShape, hx: this.rt.input.mouseX, hy: this.rt.input.mouseY, pair: 0 })
    }
    return out
  }

  /**
   * Blit one output row's worth of the sprites whose pair `keep` accepts.
   *
   * Row at a time because that is the only way the playfield can be drawn
   * between two sprite layers, which is what PF1P and PF2P describe: a
   * sprite pair can be in front of one playfield and behind the other.
   */
  private blitSpriteRow(
    data: Uint8ClampedArray,
    W: number,
    r: number,
    list: { img: BankImage; hx: number; hy: number; pair: number }[],
    pal: Uint16Array | null,
    keep: (pair: number) => boolean,
  ): void {
    const fallback = this.rt.screens.get(this.rt.order[this.rt.order.length - 1] ?? 0)?.palette
    for (const { img, hx, hy, pair } of list) {
      if (!keep(pair)) continue
      const by = (hy - img.hotY - Display.COMPOSITE_TOP) * 2
      const iy = (r - by) >> 1
      if (iy < 0 || iy >= img.height) continue
      const bx = (hx - img.hotX - 128) * 2
      for (let x = 0; x < img.width; x++) {
        const v = img.pixels[iy * img.width + x]!
        if (v === 0) continue
        const rgb4 = (pal ? pal[16 + (v & 15)] : fallback?.[16 + (v & 15)]) ?? 0
        const cr = ((rgb4 >> 8) & 15) * 17
        const cg = ((rgb4 >> 4) & 15) * 17
        const cb = (rgb4 & 15) * 17
        for (let dx = 0; dx < 2; dx++) {
          const tx = bx + x * 2 + dx
          if (tx < 0 || tx >= W) continue
          const o = (r * W + tx) * 4
          data[o] = cr
          data[o + 1] = cg
          data[o + 2] = cb
        }
      }
    }
  }
}
