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
 * DEVIATION: everything the editor draws is missing --- the logo, the thirteen
 * buttons, the memory sliders and the slide. Those are `Ed_Unpack` against the
 * editor's resource bank, the `Bt_*` button list and `Ed_MemoryDraw`, and they
 * arrive with the editor. `Es_Y1` and `Es_Y2` are the position the user last
 * dragged it to, remembered by an editor that does not exist here, so the
 * height is fixed at ten rows and it sits on the bottom of whatever the
 * program is displaying.
 */
import { Screen } from './screen'
import { AmosError } from '../interp/values'
import { AmosRuntimeError } from '../interp/interp'
import { ED_MESSAGES } from './edmessages.gen'
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

/** 'Direct mode [ESC]', the editor's own label for this (ED_MESSAGES) */
const BANNER = ED_MESSAGES[210] ?? 'Direct mode [ESC]'

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

  /** Esc_Appear (+Edit.s:9356), less everything the resource bank draws */
  open(): void {
    if (this.up) return
    const height = Math.max(MINI_HEIGHT, ROWS * 8)
    const s = new Screen(DirectScreen.EC_DIRECT, WIDTH, height, 16, 0x8000)
    s.bobBracket = this.rt.bobBracket
    s.displayX = 128
    // on the bottom of whatever is being displayed, which is the nearest this
    // port has to the Es_Y2 the editor remembers
    s.displayY = Math.max(50, this.bottomLine() - height)
    s.cls(0)
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
    s.writeText(`${BANNER}\n`)
    this.prompt()
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
