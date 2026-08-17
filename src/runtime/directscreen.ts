/**
 * The direct-mode screen: AMOS's escape screen, without the editor around it.
 *
 * `Esc_Appear` (+Edit.s:9356) sets `Direct`, activates `EcFonc` and `EcEdit`,
 * unpacks the AMOS logo, builds thirteen 32x16 buttons out of the editor's
 * resource bank, draws the memory sliders, opens a window `Ed_Sx/8-2` columns
 * wide, and then slides the whole thing down from `Es_Y1` to `Es_Y2` a
 * `Ed_VScrol` step at a time. `Esc_Hide` (:9528) runs it back up.
 *
 * What is here is the part that does not need the editor: a system screen at
 * the bottom of the display, made CURRENT while it is up, with a one-line
 * editor on it. Making it current is the whole trick and it is the machine's
 * own --- `EcCalD Active,EcEdit` is why a typed `Print` lands on the escape
 * screen without anything redirecting it.
 *
 * The logo and the buttons are the editor's own, out of the resource bank in
 * ./edres.gen.ts, drawn where `Esc_Appear` puts them: the 128x16 title at
 * `Es_BoutonsSx`, then thirteen 32x16 buttons from `Es_BoutonsX` with the
 * DIRECT one forced to x=0 and the WB one to the right edge.
 *
 * DEVIATION: the buttons are drawn and do nothing. Their routines are
 * `Bt_RoutIn` (+Edit.s:13895) --- close, hide and shrink the editor's window,
 * jump to the output position --- and they need the editor to act on. The
 * memory sliders want `Ed_MemoryDraw`'s live figures, and the slide from
 * `Es_Y1` to `Es_Y2` wants the position an editor remembers, so the height is
 * fixed and it sits on the bottom of whatever the program is displaying.
 */
import { Screen } from './screen'
import { AmosError } from '../interp/values'
import { AmosRuntimeError } from '../interp/interp'
import { ED_MESSAGES } from './edmessages.gen'
import { EDITOR_RESOURCE_BANK, ED_PICS } from './edres.gen'
import { parseAmosFile } from '../loader/amosfile'
import { parseResourceBank, type ResourceGraphics } from '../loader/resource'
import type { Runtime } from './runtime'

/**
 * `Es_MiniSy` (+Edit.s:137) is `Es_TitleSy+8` --- the title bar and one text
 * row, which is as small as the escape screen is allowed to get while it is
 * being dragged (`Esc_MEcran` clamps to it, :9038).
 */
const MINI_HEIGHT = 24

/** ten rows of the 8-pixel font, which is a slice and not a takeover */
const ROWS = 10

/** the editor's display is 640x256 hires (.Ed_Sx / .Ed_Sy, +Editor_Config.s:58) */
const WIDTH = 640

/** Es_TitleSy (+Edit.s:134): the bar the logo and the buttons sit in */
const TITLE_H = 16

/** Es_BoutonsSx (+Edit.s:128); Es_BoutonsSy is 16, the height of the bar */
const BUTTON_W = 32

/** Es_Pics+2, the 480x8 bar Ed_Unpack lays under the text (+Edit.s:9463) */
const BOTTOM_H = 8

/** Esc_Appear builds `cmp.w #13,d6 / bls` worth of them (+Edit.s:9414) */
const BUTTONS = 13

/**
 * The editor's pictures, decoded once.
 *
 * `Ed_ResourceLoad` does this on the editor's cold start and keeps the bank
 * in `Ed_Resource(a5)` for the rest of the session, so decoding per open
 * would be the port doing more work than the machine, not less.
 */
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

/** 'Direct mode [ESC]', the editor's own label for this (ED_MESSAGES) */
const BANNER = ED_MESSAGES[210] ?? 'Direct mode [ESC]'

/**
 * The three lines AMOS puts on its own boot screen (ED_MESSAGES 20-22), which
 * are also the notice the resource bank's licence asks to see there. Printed
 * from the editor's message table rather than restated, so they say what
 * AMOS says --- accents and copyright sign included, which took reading them
 * out of the assembled binary because the vendored source had lost the bytes.
 */
const NOTICE = [`${ED_MESSAGES[20] ?? 'AMOS Professional'}  ${ED_MESSAGES[21] ?? ''}`.trim(), ED_MESSAGES[22] ?? '']

export class DirectScreen {
  /** the editor's slot in the 8-11 band Runtime.SCREEN_SLOTS reserves for AMOS */
  static readonly EC_DIRECT = 9

  private prevScreen = -1
  private line = ''
  /** a line has been handed to the interpreter and has not come back */
  private running = false
  private up = false

  constructor(private readonly rt: Runtime) {}

  get isOpen(): boolean {
    return this.up
  }

  /** Esc_Appear (+Edit.s:9356) */
  open(): void {
    if (this.up) return
    const g = graphics()
    // the bank is 8 colours hires (its own mode word), and taking its palette
    // is what makes the buttons the colours the editor drew them in
    // the title bar, the text rows, then the bar that closes the bottom
    const height = Math.max(MINI_HEIGHT, TITLE_H + ROWS * 8 + BOTTOM_H)
    const s = new Screen(DirectScreen.EC_DIRECT, WIDTH, height, g?.nColors ?? 8, g?.mode ?? 0x8000)
    s.bobBracket = this.rt.bobBracket
    s.displayX = 128
    // on the bottom of whatever is being displayed, which is the nearest this
    // port has to the Es_Y2 the editor remembers
    s.displayY = Math.max(50, this.bottomLine() - height)
    s.cls(0)
    if (g) for (let i = 0; i < 32; i++) s.palette[i] = g.palette[i]!
    s.cursorOn = true
    this.rt.screens.set(DirectScreen.EC_DIRECT, s)
    this.rt.order = this.rt.order.filter((i) => i !== DirectScreen.EC_DIRECT)
    this.rt.order.push(DirectScreen.EC_DIRECT)
    // Fs_OldEc's rule (+Lib.s:17800): -1 when nothing was current, and the
    // put-back at the end is skipped for it
    this.prevScreen = this.rt.screens.has(this.rt.currentIndex) ? this.rt.currentIndex : -1
    this.rt.currentIndex = DirectScreen.EC_DIRECT
    this.up = true
    this.line = ''
    this.running = false
    this.drawChrome(s, g)
    // Esc_Appear opens the text window two columns narrower than the screen
    // (`lsr.w #3,d4 / subq.w #2,d4`), which is the 16 pixels the right border
    // runs down
    // x and y are PIXELS here, columns and rows are characters
    const w = s.windOpen(1, 0, TITLE_H, WIDTH / 8 - 2, ROWS, 0)
    // windOpen paints its area in the paper it opened with, so the editor's
    // colours have to go on before the clear, not after
    w.paper = 0
    w.pen = 3
    s.clw()
    for (const l of NOTICE) if (l !== '') s.writeText(`${l}\n`)
    s.writeText(`${BANNER}\n`)
    this.prompt()
  }

  /**
   * Everything the resource bank draws (Esc_Appear +Edit.s:9367-9470).
   *
   * On the machine this is two screens. `Es_Unpack` puts the logo and the
   * buttons on `EcFonc`, the title strip; `Ed_Unpack` puts the right border
   * and the bottom bar on `EcEdit`, the text screen under it. One screen here,
   * so the title occupies its top `Es_TitleSy` rows.
   *
   * The logo goes at `Es_BoutonsSx`, 32 pixels in, because `.Pa1` forces the
   * DIRECT button to x=0. `.Pa2` walks the rest along from `Es_BoutonsX` a
   * button at a time, except the WB one, pinned to `Ed_Sx - Ed_BoutonsSx`.
   */
  private drawChrome(s: Screen, g: ResourceGraphics | null): void {
    if (!g) return
    const put = (n: number, x: number, y: number): void => {
      const p = g.image(n)
      if (p) this.rt.blit(s, p, x, y, true)
    }
    put(ED_PICS.escape, BUTTON_W, 0)
    // Es_BoutonsX is Es_BoutonsSx + Es_TitleSx: past the DIRECT button and
    // past the logo, which is where the run of the others starts
    let x = BUTTON_W + 4 * BUTTON_W
    for (let i = 1; i <= BUTTONS; i++) {
      // two pictures per button, up then down; a button nobody has pressed
      // shows the up one, because Bt_Pos is 0 until Bt_EsCDraw adds to it
      const image = ED_PICS.escapeButtons + (i - 1) * 2
      if (i === 1) put(image, 0, 0)
      else if (i === 2) put(image, WIDTH - BUTTON_W, 0)
      else {
        if (x + BUTTON_W > WIDTH - BUTTON_W) break
        put(image, x, 0)
        x += BUTTON_W
      }
    }
    // the right border, one 16x8 tile every 8 lines down the text area, and
    // the bar that closes the bottom off under it
    const edge = g.image(ED_PICS.escape + 1)
    if (edge) for (let y = TITLE_H; y < s.height - BOTTOM_H; y += edge.height) put(ED_PICS.escape + 1, WIDTH - 16, y)
    const bottom = g.image(ED_PICS.escape + 2)
    if (bottom) for (let bx = 0; bx < WIDTH; bx += bottom.width) put(ED_PICS.escape + 2, bx, s.height - BOTTOM_H)
  }

  /** Esc_Hide (+Edit.s:9528) */
  close(): void {
    if (!this.up) return
    this.up = false
    if (this.running) {
      this.rt.exitDirect()
      this.running = false
    }
    this.rt.closeScreen(DirectScreen.EC_DIRECT)
    if (this.prevScreen >= 0 && this.rt.screens.has(this.prevScreen)) this.rt.currentIndex = this.prevScreen
    this.prevScreen = -1
  }

  /**
   * One keystroke at the escape screen.
   *
   * Return runs the line, Escape puts the screen away, backspace rubs a
   * character out and anything from space up is echoed. Nothing is accepted
   * while a line is still running: AMOS types into one buffer (`Ed_BufT`) and
   * the line that is in it owns the interpreter until it ends.
   */
  key(ch: string, scan = 0): void {
    if (!this.up || this.running) return
    const s = this.rt.screens.get(DirectScreen.EC_DIRECT)
    if (!s) return
    if (ch === '\r' || ch === '\n' || scan === 0x44) {
      s.writeText('\n')
      this.submit()
      return
    }
    if (ch === '\x1b' || scan === 0x45) {
      this.close()
      return
    }
    if (ch === '\b' || ch === '\x7f' || scan === 0x41) {
      if (this.line === '') return
      this.line = this.line.slice(0, -1)
      this.redraw(s)
      return
    }
    if (ch.length !== 1 || ch < ' ') return
    this.line += ch
    s.writeText(ch)
  }

  /**
   * Called once a frame, to notice that the line has finished.
   *
   * The interpreter runs a typed line over as many frames as it takes --- a
   * typed `Wait Vbl` really waits --- so the prompt cannot be printed by
   * whatever submitted it.
   */
  frame(): void {
    if (!this.up || !this.running || this.rt.inDirect) return
    this.running = false
    this.prompt()
  }

  /**
   * Report an error the typed line threw, and put the program back.
   *
   * `Runtime.frame` hands it here rather than letting it out, because an
   * error in a typed line is not the program's: `tst.w Direct(a5) / bne
   * rErr1` (+ILib.s:1330) refuses to trap it, and the editor prints it on the
   * escape screen and waits for the next line.
   */
  reportError(e: unknown): boolean {
    if (!this.up || !this.running) return false
    this.running = false
    this.rt.exitDirect()
    const s = this.rt.screens.get(DirectScreen.EC_DIRECT)
    // the bare message: a typed line has no line number to report it against,
    // and the listing in the wrapper is the line that was just typed
    const text = e instanceof AmosRuntimeError ? e.text : e instanceof Error ? e.message : String(e)
    s?.writeText(`${text}\n`)
    this.prompt()
    return true
  }

  private submit(): void {
    const text = this.line
    this.line = ''
    if (text.trim() === '') {
      this.prompt()
      return
    }
    const s = this.rt.screens.get(DirectScreen.EC_DIRECT)
    try {
      this.rt.enterDirect(text)
      this.running = true
    } catch (e) {
      s?.writeText(`${e instanceof AmosError ? e.message : String(e)}\n`)
      this.prompt()
    }
  }

  private prompt(): void {
    this.rt.screens.get(DirectScreen.EC_DIRECT)?.writeText('> ')
  }

  /** rub out and reprint the line, which is all a one-line editor needs */
  private redraw(s: Screen): void {
    s.clLine()
    s.locate(0, s.curWin.curY)
    s.writeText(`> ${this.line}`)
  }

  /**
   * The bottom of the display in hardware lines: the lowest edge any screen
   * that is being shown reaches, or a standard 200-line display's 250.
   */
  private bottomLine(): number {
    let bottom = 0
    for (const [n, s] of this.rt.screens) {
      if (n === DirectScreen.EC_DIRECT || !s.visible) continue
      bottom = Math.max(bottom, s.displayY + s.height)
    }
    return bottom > 0 ? bottom : 250
  }
}
