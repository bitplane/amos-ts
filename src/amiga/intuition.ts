/**
 * intuition.library — the Workbench screen, and who owns the display.
 *
 * ## Why this starts with a screen and not a window
 *
 * The first Intuition call anything in this port reaches is OpenWorkBench.
 * EasyLife's `Eliconify Begin` opens with OpenWorkBench / WBenchToFront /
 * OpenWindow, and jd-int wants the same screen. A window cannot exist before
 * the screen it is on, and the screen is the harder of the two here, because
 * the display is a single copper-list interpreter: anything that wants to
 * appear has to express itself as copper registers plus BPLxPT. There is no
 * second renderer to hang an Intuition screen off.
 *
 * That question turned out to be already answered, by AMOS. AMOS opens
 * screens BASIC cannot name — EcFonc 8, EcEdit 9, EcFsel 10, EcReq 11
 * (+Equ.s:792) — and they are ordinary screens in every respect the hardware
 * cares about: a slot in `screens`, a place in `order`, a band in the copper
 * list, a slot in the chip address space. The only thing that makes them
 * system screens is that `Screen Open` rejects the index.
 *
 * So a Workbench screen is one of those, at a slot of its own. This module
 * does not build it — that is `ScreenHost`, below, implemented on the AMOS
 * side, because the layer rule (src/amiga/layer.test.ts) is that nothing here
 * imports from src/runtime. What this module owns is everything that is
 * intuition.library's rather than the machine's: the geometry and palette the
 * Workbench screen opens with, whether it is open, and the four calls'
 * success and failure conditions.
 *
 * ## Evidence
 *
 * LVOs from `fixtures/amigaos/FD1.3/intuition_lib.fd` (Commodore's own
 * function definitions, off the Workbench 1.3.3 Extras disk): OpenWorkBench
 * -210, CloseWorkBench -78, WBenchToFront -342, WBenchToBack -336. AROS
 * confirms the numbering from the other direction — `AROS_LH0(IPTR,
 * OpenWorkBench, ..., 35, Intuition)` is 35 * 6 = -210.
 *
 * Behaviour from AROS's rom/intuition/openworkbench.c and closeworkbench.c
 * (data and semantics only; AROS is APL/LGPL and none of its code is copied):
 * OpenWorkBench returns the EXISTING screen if there is one rather than
 * opening a second, and CloseWorkBench returns FALSE both when there is no
 * Workbench screen at all and when something is still visiting it.
 *
 * The screen itself is read off the disk rather than remembered. Workbench
 * 1.3 rev 34.20 (GB), `devs/system-configuration`, is a `struct Preferences`,
 * and the four screen colours sit at offsets 110-116. The decode is confirmed
 * end to end by PrinterFilename: "generic" lands at offset 128, exactly where
 * the struct puts it.
 */

/** the Workbench screen's colours, from Preferences on the 1.3 disk */
export const WB_PALETTE: readonly number[] = [
  0x005a, // color0 — the blue desktop
  0x0fff, // color1 — white, the text pen
  0x0002, // color2 — "black" (a very dark blue, not $000)
  0x0f80, // color3 — orange, the highlight pen
]

/**
 * The Workbench screen's geometry.
 *
 * NOTE: 640x256 hires, depth 2. AROS takes width and height from
 * GfxBase->NormalDisplayColumns/Rows when Preferences asks for
 * STDSCREENWIDTH/HEIGHT, which on PAL is 640x256, and depth from
 * ScreenModePrefs — a V39 file that a 1.3 machine does not have, where the
 * Workbench screen is four colours. `system-configuration` carries no screen
 * size or depth field at all, so this is the machine's answer rather than the
 * disk's, and a 1.3 Workbench is 640x256x2 on every PAL Amiga.
 */
export const WB_WIDTH = 640
export const WB_HEIGHT = 256
export const WB_DEPTH = 2

/**
 * What the machine has to be able to do for a screen to exist. Implemented on
 * the AMOS side (Runtime), because building a bitmap and putting it in the
 * copper list is the machine's job, not intuition.library's.
 *
 * `slot` is a screen index above the range any keyword can name.
 */
export interface ScreenHost {
  /** open a screen at this slot; a no-op if one is already there */
  openScreen(slot: number, spec: ScreenSpec): void
  /** close it; returns false if it could not be closed */
  closeScreen(slot: number): boolean
  screenToFront(slot: number): void
  screenToBack(slot: number): void
  isOpen(slot: number): boolean
  /**
   * The address a program would see as `struct Screen *`. Intuition hands
   * these out and programs pass them straight back, so what matters is only
   * that it is stable, non-zero and distinct per screen.
   */
  screenAddr(slot: number): number
}

export interface ScreenSpec {
  width: number
  height: number
  depth: number
  hires: boolean
  laced: boolean
  palette: readonly number[]
  /** hardware line the screen's top edge sits on */
  displayY: number
  title: string
}

/**
 * The slot the Workbench screen takes. Above AMOS's own system screens
 * (8-11), in the range reserved for screens the machine's OWNER opens.
 */
export const WB_SLOT = 12

/**
 * NOTE: the Workbench screen opens at hardware line 44, not at the top of the
 * raster. AMOS's default screen sits at line 50 (EcYBase+24) and a real
 * Workbench sits a little above it; the exact figure is a Preferences
 * ViewInitY on the real machine and this file's copy reads 0, which means
 * "wherever the ROM puts it". 44 is the standard PAL Workbench top edge.
 */
export const WB_DISPLAY_Y = 44

export class Intuition {
  constructor(private readonly host: ScreenHost) {}

  /**
   * Visitors — anything that has claimed the Workbench screen and would be
   * left dangling if it closed. On a real machine these are windows opened
   * with a `NewWindow.Screen` pointing at it and LockPubScreen holders.
   *
   * NOTE: nothing increments this yet, because OpenWindow is not implemented
   * (it needs layers.library, which is the next piece). So CloseWorkBench
   * currently succeeds whenever the screen is open, which is right for a
   * Workbench with no windows on it and will become wrong the moment there
   * are — hence the counter existing now rather than the test being written
   * against "always TRUE".
   */
  private visitors = 0

  /** intuition.library -210. The existing screen if there is one, else a new
   * one; 0 if it could not be opened. */
  openWorkBench(): number {
    if (!this.host.isOpen(WB_SLOT)) {
      this.host.openScreen(WB_SLOT, {
        width: WB_WIDTH,
        height: WB_HEIGHT,
        depth: WB_DEPTH,
        hires: true,
        laced: false,
        palette: WB_PALETTE,
        displayY: WB_DISPLAY_Y,
        title: 'Workbench Screen',
      })
      if (!this.host.isOpen(WB_SLOT)) return 0
    }
    return this.host.screenAddr(WB_SLOT)
  }

  /**
   * intuition.library -78. FALSE when there is no Workbench screen to close
   * and when something is still visiting it — both of those are ordinary
   * outcomes rather than errors, and a program that iconifies is expected to
   * cope with the Workbench refusing to go away.
   */
  closeWorkBench(): boolean {
    if (!this.host.isOpen(WB_SLOT)) return false
    if (this.visitors !== 0) return false
    return this.host.closeScreen(WB_SLOT)
  }

  /** intuition.library -342 */
  wBenchToFront(): boolean {
    if (!this.host.isOpen(WB_SLOT)) return false
    this.host.screenToFront(WB_SLOT)
    return true
  }

  /** intuition.library -336 */
  wBenchToBack(): boolean {
    if (!this.host.isOpen(WB_SLOT)) return false
    this.host.screenToBack(WB_SLOT)
    return true
  }

  /** is the Workbench screen open? (IntuitionBase->WorkBench != NULL) */
  workBenchOpen(): boolean {
    return this.host.isOpen(WB_SLOT)
  }

  /** a visitor claims the Workbench screen, and CloseWorkBench starts failing */
  addVisitor(): void {
    this.visitors++
  }

  removeVisitor(): void {
    if (this.visitors > 0) this.visitors--
  }
}
