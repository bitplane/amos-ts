/**
 * The editor on an AMOS screen: `Ed_DrawTop` and `Ed_DrawWindows`.
 *
 * The editor is not drawn by anything special. `Ed_OpenIt` (+Edit.s:305)
 * opens `EcEdit`, screen 9, through `L_Dia_RScOpen` like any other AMOS
 * screen, `Ed_Appear` (:9646) makes it current with `EcCalD Active,EcEdit`,
 * and everything after that is `WiCall Print` of a string with console
 * escapes in it. So this module owns no pixels of its own: it opens screen 9,
 * unpacks the resource bank's furniture onto it, opens one AMOS text window
 * per editor window, and prints.
 *
 * It lives in `src/amos` for the reason this directory exists. The painting
 * needs `Screen` from `src/runtime` and `Edit` from `src/editor`, and
 * neither of those layers may import the other.
 *
 * `src/runtime/directscreen.ts` builds its own screen 9 because it runs with
 * no editor at all. `EcEdit` IS 9 (+Equ.s:763) and `Esc_Appear` prints into
 * the editor's screen rather than one of its own, so the two agree about
 * which slot the escape screen lands in.
 */
import { Screen } from '../runtime/screen'
import { EDITOR_RESOURCE_BANK, ED_PICS } from '../runtime/edres.gen'
import { ED_SYSTEME } from '../runtime/edmessages.gen'
import { parseAmosFile } from '../loader/amosfile'
import { parseResourceBank, type ResourceGraphics } from '../loader/resource'
import { renderWindow, statusLine } from '../editor/display'
import { ED_ETAT_SY, ED_ROW_SY, type Editor } from '../editor/windows'
import type { Edit } from '../editor/edit'
import { Runtime } from '../runtime/runtime'

/** `Ed_BoutonsSx` (+Edit.s:96): one editor button, and `Ed_TitreSy` is its height */
const BUTTON_W = 32

/** `Ed_LogoSx` (:88), which is also `Ed_TitleSx`, 32*5 */
const LOGO_W = 160

/** `Ed_BoutonsX` (:99): past the DIRECT button and past the logo */
const BUTTONS_X = BUTTON_W + LOGO_W

/** `Ed_MemoryY1` and `Ed_MemoryY2` (:90), and `Ed_MemorySy` above them */
const MEMORY_Y1 = 3
const MEMORY_Y2 = 10
const MEMORY_H = 2

/** `Edt_BtSx` (:77): the three buttons in a window's own status strip */
const EDT_BT_W = 24

/**
 * The width `Ed_Enlarge` (+Edit.s:13793) copies from and to.
 *
 * The window furniture is 480 pixels wide and the screen is `Ed_Sx`. The
 * routine is one `ScCopy` of the source rect (160,y0)-(480,y1) to (Ed_Sx-320,
 * y0), so the picture's own right two thirds are laid down again past its
 * end. On a 640 screen that is 320..639 filled from 160..479.
 */
const ENLARGE_FROM = 160
const ENLARGE_TO = 480

/** the pictures, decoded once and kept, as `Ed_Resource(a5)` keeps them */
let pics: ResourceGraphics | null | undefined
function graphics(): ResourceGraphics | null {
  if (pics === undefined) {
    try {
      const parsed = parseAmosFile(EDITOR_RESOURCE_BANK)
      const mem = parsed.banks.find((b) => 'data' in b) as { data: Uint8Array } | undefined
      pics = mem ? parseResourceBank(mem.data).graphics : null
    } catch {
      pics = null
    }
  }
  return pics
}

/**
 * One system message, ready to print.
 *
 * `Ed_GetSysteme` is 1-based (GetMessage +B.s:562) and hands back a pointer;
 * `WiCall Print` stops at the NUL. Several of these messages carry one and
 * two of them (19 and 23) are slider colour tables that are all NULs and
 * bytes, so the cut belongs here and not in the generated table.
 */
function sys(n: number): string {
  const raw = ED_SYSTEME[n - 1] ?? ''
  const end = raw.indexOf('\x00')
  return end < 0 ? raw : raw.slice(0, end)
}

export class EditorScreen {
  /** `EcEdit` (+Equ.s:763) */
  static readonly EC_EDIT = 9

  /** the screen that was current when the editor came up (Fs_OldEc's -1 rule) */
  private prevScreen = -1

  /**
   * The machine is asked for rather than held, because `Edt_ClearVar` throws
   * this port's Runtime away and builds another. On the Amiga the screens are
   * `T_EcAdr(a5)` and outlive every program; here the nearest thing is to
   * paint on whichever machine is current and let `Ed_Appear` put the screen
   * back, which is what it does on the way back from an accessory anyway
   * (`Ed_Redraw`, +Edit.s:9718).
   */
  constructor(
    private readonly machine: () => Runtime,
    private readonly editor: Editor,
  ) {}

  private get rt(): Runtime {
    return this.machine()
  }

  /** `Ed_Opened(a5)`, read off the screen rather than kept beside it */
  get isOpen(): boolean {
    return this.screen !== null
  }

  get screen(): Screen | null {
    return this.rt.screens.get(EditorScreen.EC_EDIT) ?? null
  }

  /**
   * The screen half of `Ed_OpenIt` (+Edit.s:305) and of `Ed_Appear` (:9646).
   *
   * `EcFonc`, screen 8, is not opened. It is 640 by `Es_TitleSy` and
   * `Ed_OpenIt` sets `BitHide` on it the instruction after opening it; it
   * carries the function-key strip, which nothing calls up yet.
   */
  open(): void {
    if (this.isOpen) return
    const cfg = this.editor.config
    const g = graphics()
    const s = new Screen(EditorScreen.EC_EDIT, cfg.sx, this.screenHeight(), 8, g?.mode ?? 0x8000)
    s.bobBracket = this.rt.bobBracket
    // `Ed_Wx` and `Ed_Wy` (+Editor_Config.s), 129 and 50 as shipped
    s.displayX = cfg.wx
    s.displayY = cfg.wy
    // `EdC_SetPalette` runs before either screen opens, so the config's eight
    // words win over the resource bank's own
    const pal = cfg.palette
    for (let i = 0; i < 8; i++) s.palette[i] = pal[i]!
    s.cls(0)
    s.cursorOn = true
    this.rt.screens.set(EditorScreen.EC_EDIT, s)
    this.rt.order = this.rt.order.filter((i) => i !== EditorScreen.EC_EDIT)
    this.rt.order.push(EditorScreen.EC_EDIT)
    this.prevScreen = this.rt.screens.has(this.rt.currentIndex) ? this.rt.currentIndex : -1
    this.rt.currentIndex = EditorScreen.EC_EDIT
    this.fitWindows()
    this.draw()
  }

  /**
   * `Ed_OpenIt`'s `.Mod` block (+Edit.s:310): the current window takes the
   * screen.
   *
   * A window whose height came from somewhere other than this screen has to
   * be made to fit it, and the routine does that in two passes: ask
   * `Edt_WMaxSize` with -1 what the window could have without touching the
   * others, and if that is not what it has, `Edt_WSchrinkAll` rolls every
   * other window up and it asks again. One window on the shipped 256-line
   * screen comes out at 28 rows.
   */
  private fitWindows(): void {
    const w = this.editor.current
    if (w === null) return
    const room = this.editor.maxSize(w, -1)
    if (room === w.windTy) return
    this.editor.schrinkAll(0)
    w.windTy = this.editor.maxSize(w, -1)
  }

  /**
   * `Ed_Sy` rounded the way `Ed_OpenIt` rounds it: `addq.w #7,d2 / and.w
   * #$FFF8,d2`, so a height that is not a multiple of eight opens the screen
   * at the next one up and `Ed_Ty` counts rows off that.
   */
  private screenHeight(): number {
    return (this.editor.config.sy + 7) & 0xfff8
  }

  /** `EcCalD Del,EcEdit` (+Edit.s:459), which `Ed_CloseEditor` does to both screens */
  close(): void {
    if (!this.isOpen) return
    this.rt.closeScreen(EditorScreen.EC_EDIT)
    if (this.prevScreen >= 0 && this.rt.screens.has(this.prevScreen)) this.rt.currentIndex = this.prevScreen
    this.prevScreen = -1
  }

  /** `Ed_DrawTop` then `Ed_DrawWindows`, which is what `Ed_Appear` draws */
  draw(): void {
    const s = this.screen
    if (s === null) return
    this.drawTop(s)
    this.drawWindows(s)
  }

  /** one resource picture, at pixel coordinates (`Ed_Unpack` +Edit.s:13852) */
  private put(s: Screen, n: number, x: number, y: number): void {
    const g = graphics()
    const p = g?.image(n)
    if (p) this.rt.blit(s, p, x, y, true)
  }

  /**
   * `Ed_DrawTop` (+Edit.s:726): the logo, the twelve buttons and the two
   * memory sliders, all on `EcEdit` because `Ed_Appear` made it current
   * first.
   *
   * The button run is `.Pa1` and `.Pa2`: number 1 is forced to x=0, number 2
   * is pinned to the right edge, and 3 to 12 walk along from `Ed_BoutonsX`.
   */
  private drawTop(s: Screen): void {
    const width = this.editor.config.sx
    this.put(s, ED_PICS.logo, BUTTON_W, 0)
    let x = BUTTONS_X
    for (let i = 1; i <= 12; i++) {
      // two pictures per button, up then down. `Bt_Pos` is 0 for every button
      // but INSERT, which `.PaI` puts in its down image while insert mode is
      // off -- the only editor button that remembers a state.
      const down = i === 10 && !this.editor.insert ? 1 : 0
      const image = ED_PICS.editorButtons + (i - 1) * 2 + down
      if (i === 1) this.put(s, image, 0, 0)
      else if (i === 2) this.put(s, image, width - BUTTON_W, 0)
      else {
        this.put(s, image, x, 0)
        x += BUTTON_W
      }
    }
    this.drawMemory(s, x, width - LOGO_W - 12 * BUTTON_W)
  }

  /**
   * `Ed_MemoryDraw` (+Edit.s:812) and `Ed_MemoryAff` (:836).
   *
   * The furniture is three 32-pixel pictures: a left cap, as many middles as
   * fit, and a right cap. `Ed_MemorySx` is the drawable width, `d3 - 39`, and
   * the bars start `Ed_BoutonsSx` past the left cap.
   *
   * DEVIATION: the bars themselves are `L_Sl_Init`, the dialogue library's
   * slider, drawn through the sixteen colours of system message 23. That
   * routine is not ported, so what goes down here is the proportion in
   * colour 4 and the rest in colour 0, which is the two colours message 23
   * repeats. The figures are real: `AvailMem` against the pool totals is
   * what `rt.chipFree()` answers.
   */
  private drawMemory(s: Screen, x: number, width: number): void {
    this.put(s, ED_PICS.memory, x, 0)
    const barX = x + BUTTON_W
    const middles = Math.floor(width / BUTTON_W) - 2
    let mx = barX
    for (let i = 0; i <= middles; i++, mx += BUTTON_W) this.put(s, ED_PICS.memory + 1, mx, 0)
    this.put(s, ED_PICS.memory + 2, mx, 0)
    const barW = width - BUTTON_W - 7
    const chip = this.rt.chipFree()
    const fast = this.rt.fastFree()
    this.bar(s, barX, MEMORY_Y1, barW, Runtime.CHIP_TOTAL - chip, Runtime.CHIP_TOTAL)
    this.bar(s, barX, MEMORY_Y2, barW, Runtime.FAST_TOTAL - fast, Runtime.FAST_TOTAL)
  }

  private bar(s: Screen, x: number, y: number, width: number, used: number, total: number): void {
    const on = total <= 0 ? 0 : Math.min(width, Math.round((used / total) * width))
    for (let dy = 0; dy < MEMORY_H; dy++) {
      for (let dx = 0; dx < width; dx++) s.putPixel(x + dx, y + dy, dx < on ? 4 : 0)
    }
  }

  /**
   * `Ed_DrawWindows` (+Edit.s:11594): the furniture and the two AMOS windows
   * for every visible editor window, top to bottom.
   *
   * The vertical walk is the routine's own `move.w #16+Ed_YTop,-(sp)` and the
   * `add.w #8,d7` per row under it. `Editor.topY` adds the same sum up, so
   * this reads the answer off the list rather than keeping a running total.
   *
   * Window numbers are `Edt_Order * 8` for the text and one more for the
   * status strip, which is why the first editor window is AMOS windows 8 and
   * 9 and never window 0.
   */
  private drawWindows(s: Screen): void {
    this.editor.orderWindows()
    const width = this.editor.config.sx
    this.effWindows(s)
    for (const w of this.editor.list) {
      if (w.hidden !== 0) continue
      const y = this.editor.topY(w)
      const rows = w.windTy
      // the top bar, then a right-edge tile per text row, then the bottom bar
      this.put(s, ED_PICS.logo + 1, 0, y)
      this.enlarge(s, y, y + ED_ETAT_SY)
      for (let r = 0; r < rows; r++) this.put(s, ED_PICS.logo + 2, width - 16, y + ED_ETAT_SY + r * ED_ROW_SY)
      const bas = y + ED_ETAT_SY + rows * ED_ROW_SY
      this.put(s, ED_PICS.logo + 3, 0, bas)
      this.enlarge(s, bas, bas + 5)
      // the three window buttons, `.BLoop`: close at the left, hide and
      // shrink pinned to the right edge a button apart
      this.put(s, ED_PICS.windowButtons, 0, y)
      this.put(s, ED_PICS.windowButtons + 2, width - 2 * EDT_BT_W, y)
      this.put(s, ED_PICS.windowButtons + 4, width - EDT_BT_W, y)
      // `Edt_WindEX` is 32 and `Edt_WindESx` is `Ed_Sx - 32 - 64`, so the
      // status strip is 68 characters on a 640 screen and `Edt_WindEY` is one
      // pixel down from the window's top
      const statusCols = (width - BUTTON_W - 64) >> 3
      s.windOpen(this.statusWindow(w), BUTTON_W, y + 1, statusCols, 1, 0)
      this.etPrint(w)
      if (rows === 0) continue
      // `Edt_WindSx` is `Ed_Sx - 16`, which is the right border's width
      s.windOpen(this.textWindow(w), 0, y + ED_ETAT_SY, (width - 16) >> 3, rows, 0)
      s.selectWindow(this.textWindow(w))
      s.writeText(sys(20))
      // `Ed_NewBuf` (+Edit.s:10302): `Ed_BufUntok` fills `Edt_BufE` from the
      // program before `Ed_AffBuf` prints it. `Ed_DrawWindows` has just
      // handed the window its share of the one allocation, so what is in the
      // edit buffer belongs to whatever height the window had before.
      w.fill()
      this.affBuf(w)
    }
    const cur = this.editor.current
    if (cur !== null && cur.hidden === 0 && cur.windTy > 0) {
      s.selectWindow(this.textWindow(cur))
      this.loca(cur)
    }
  }

  /**
   * `Edt_EffWindows` (+Edit.s:11648): take down the AMOS windows before
   * laying them out again.
   *
   * The routine walks the editor's list and `WinDel`s the pair each window
   * owns, because `Ed_DrawWindows` is called for a fresh layout and not only
   * for a fresh screen. Every editor window here rather than only the ones
   * still in the list: a window closed since the last paint has left its
   * AMOS pair behind and nothing else will collect it.
   */
  private effWindows(s: Screen): void {
    for (const n of [...s.windows.keys()]) {
      if (n === 0) continue
      s.selectWindow(n)
      s.windClose()
    }
    s.selectWindow(0)
  }

  /** `Ed_Enlarge` (+Edit.s:13793): the 480-wide furniture stretched to `Ed_Sx` */
  private enlarge(s: Screen, y0: number, y1: number): void {
    const to = this.editor.config.sx - (ENLARGE_TO - ENLARGE_FROM)
    if (to <= ENLARGE_FROM) return
    Screen.copy(s, ENLARGE_FROM, y0, ENLARGE_TO, y1, s, to, y0)
  }

  /** `Edt_Window(a4)`, which is `Edt_Order` times eight */
  private textWindow(w: Edit): number {
    return w.order * 8
  }

  /** `Edt_WindEtat(a4)`, one past it */
  private statusWindow(w: Edit): number {
    return w.order * 8 + 1
  }

  /**
   * `Ed_EtPrintD0` (+Edit.s:7733) with every `Edt_EtatAff` bit set, which is
   * what `Ed_EtPrint` above it asks for.
   *
   * Message 10 clears the strip for the current window and 11 for any other,
   * and the two differ by `ESC S1`: an inactive window's status line is
   * printed through the shade dither. Then message 2 is the background of
   * labels and message 12 the colours the figures go in. `statusLine` in
   * ../editor/display.ts already lays the fields into message 2, so what is
   * left here is the colours and one Print.
   */
  etPrint(w: Edit): void {
    const s = this.screen
    if (s === null || w.hidden !== 0) return
    s.selectWindow(this.statusWindow(w))
    s.writeText(sys(w === this.editor.current ? 10 : 11))
    s.writeText(sys(12))
    const cols = s.curWin.cols
    const line = statusLine(w, {
      order: w.order,
      name: w.prog.name,
      split: w.linkPrev !== null || w.linkNext !== null,
      width: cols,
    })
    // trailing spaces are not printed, because the machine never prints them:
    // message 2 is 46 characters and `Ed_EtNom` (+Edit.s:7520) writes the name
    // over it at `Ed_EtXX`. Printing the last column of a one-row window would
    // wrap the cursor and scroll the line away.
    s.writeText(line.replace(/ +$/, ''))
  }

  /**
   * `Ed_AffBuf` (+Edit.s:10308): `Ed_EALigne` for every row of the window.
   *
   * `Ed_EALigne` enters with `moveq #-1,d6`, so it erases to the end of the
   * line, and `Ed_ALigne` with 0, so it does not. The `Row.erase` flag
   * ../editor/display.ts answers is that bit, and `WiCalD ChrOut,7` is the
   * clear-to-end-of-line it turns into.
   *
   * `.Inverse` and `.Normal` are system messages 17 and 18, which are paper
   * and pen the other way round and `ESC J1` again, so a block highlight is
   * two more Prints and not a drawing mode.
   */
  affBuf(w: Edit): void {
    const s = this.screen
    if (s === null || w.hidden !== 0 || w.windTy === 0) return
    s.selectWindow(this.textWindow(w))
    const { rows } = renderWindow(w)
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r]!
      s.locate(0, r)
      let at = 0
      for (const run of row.inverse) {
        if (run.from > at) s.writeText(row.text.slice(at, run.from))
        s.writeText(sys(17))
        s.writeText(row.text.slice(run.from, run.to))
        s.writeText(sys(18))
        at = run.to
      }
      if (at < row.text.length) s.writeText(row.text.slice(at))
      if (row.erase) s.writeText('\x07')
    }
    this.loca(w)
  }

  /** `Ed_Loca` (+Edit.s:10202): the column is relative to the scroll, the row is not */
  loca(w: Edit): void {
    const s = this.screen
    if (s === null || w.hidden !== 0 || w.windTy === 0) return
    s.selectWindow(this.textWindow(w))
    s.locate(w.xCu - w.xPos, w.yCu)
  }
}
