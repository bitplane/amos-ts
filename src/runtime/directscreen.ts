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
 * The buttons work. `Esc_Bouton` (+Edit.s:8955) counts `Bt_Number` down: 1
 * closes, 2 is `Ed_Wb`, 3 stores the OUT toggle and 4 upward are the ten
 * function keys, plus ten more on the right mouse button.
 *
 * DEVIATION: the memory sliders want `Ed_MemoryDraw`'s live figures, and the
 * slide from `Es_Y1` to `Es_Y2` wants the position an editor remembers, so
 * the height is fixed and it sits on the bottom of whatever the program is
 * displaying.
 */
import { Screen } from './screen'
import { AmosError } from '../interp/values'
import { AmosRuntimeError } from '../interp/interp'
import { ED_MESSAGES, ED_SYSTEME } from './edmessages.gen'
import { EDITOR_RESOURCE_BANK, ED_PICS } from './edres.gen'
import { parseAmosFile } from '../loader/amosfile'
import { parseResourceBank, type ResourceGraphics } from '../loader/resource'
import type { Runtime } from './runtime'


/** the editor's display: .Ed_Sx x .Ed_Sy, 640x256 hires (+Editor_Config.s:58) */
const WIDTH = 640
const HEIGHT = 256

/** what is left for text between the title strip and the bar at its foot */
const ROWS = (HEIGHT - 16 - 8) / 8

/** Es_TitleSy (+Edit.s:107): the bar the logo and the buttons sit in */
const TITLE_H = 16

/** Es_BoutonsSx (+Edit.s:101); Es_BoutonsSy is 16, the height of the bar */
const BUTTON_W = 32

/** Es_Pics+2, the 480x8 bar Ed_Unpack lays under the text (+Edit.s:9463) */
const BOTTOM_H = 8

/** Esc_Appear builds `cmp.w #13,d6 / bls` worth of them (+Edit.s:9414) */
const BUTTONS = 13

/**
 * What the ten function keys type, and whether they press Return after it.
 *
 * `Esc_BtFonc` (+Edit.s:9152) reads system message `24 + n` and copies it into
 * the line editor, stopping at a backtick, which it strips. A message that HAD
 * one falls through to `Esc_R` --- the Return path --- and one that did not
 * goes back to the loop with the text sitting in the line, waiting to be
 * finished. That is why half of them end in an open quote.
 *
 * `Ed_GetSysteme` is 1-based (GetMessage +B.s:562), so message 24 is
 * ED_SYSTEME[23]: F1 is ListBank and Shift-F10 is System.
 */
const FKEY_BASE = 23

function fkeyMacro(n: number): { text: string; run: boolean } | null {
  const raw = ED_SYSTEME[FKEY_BASE + n - 1]
  if (raw === undefined || raw === '') return null
  const tick = raw.indexOf('`')
  return tick < 0 ? { text: raw, run: false } : { text: raw.slice(0, tick), run: true }
}

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
  /** what Ed_Appear took away, for Ed_Hide to give back */
  private saved: {
    rainbows: boolean
    colourBack: number
    mouseLimit: Runtime['mouseLimit']
    spriteUpdate: boolean
  } | null = null
  private line = ''
  /**
   * `Esc_Output` (+Equ.s:1812), the OUT button's remembered position.
   *
   * DEFECT: the machine's own. The only two instructions that touch it are the
   * button writing its own state into it (+Edit.s:8994) and `Esc_BtGetOutput`
   * reading it back out to redraw itself (:9313). Nothing else in the editor
   * reads it, so the button remembers which way up it is and that is all it
   * does. Reproduced rather than given a meaning it never had.
   */
  private output = 0
  /** mouse buttons last frame, for the press edge Bt_Gere fires on */
  private lastKeys = 0
  /** the button under a held mouse, drawn in its down image */
  private held = -1
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
    const s = new Screen(DirectScreen.EC_DIRECT, WIDTH, HEIGHT, g?.nColors ?? 8, g?.mode ?? 0x8000)
    s.bobBracket = this.rt.bobBracket
    // the standard display position. This COVERS the program rather than
    // overlapping it, which is the whole difference: EcEdit is the full
    // 640x256 and Ed_Appear puts it first, so the program's screens are
    // simply behind it and its rainbows have nothing of the editor to colour.
    s.displayX = 128
    s.displayY = 50
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
    this.edAppear()
    this.drawChrome(s, g)
    // Esc_Appear opens the text window two columns narrower than the screen
    // (`lsr.w #3,d4 / subq.w #2,d4`), which is the 16 pixels the right border
    // runs down
    // x and y are PIXELS here, columns and rows are characters
    const w = s.windOpen(1, 0, TITLE_H, WIDTH / 8 - 2, ROWS, 0)
    // Wo3a (+W.s:13706) gives a fresh window paper 1, pen 2 and cursor colour
    // 3; the ground here is the black Ed_ColB sets rather than paper 1.
    //
    // The cursor does NOT flash, and that is the machine's answer rather than
    // an omission. `Screen Open` flashes colour 3 on any screen deeper than a
    // plane (+Lib.s:8989) and the window cursor is drawn in that register, so
    // a PROGRAM's cursor fades --- but the editor opens its screens through
    // the screen library rather than through the instruction, and the word
    // Flash does not appear in +Edit.s once. `LEd_CuMarche` (+Lib.s:19781)
    // prints ESC "C1", the ordinary Curs On, so direct mode gets an ordinary
    // solid block while the program behind it keeps its fading one.
    w.paper = 0
    w.pen = 2
    w.cuCol = 3
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
      // Bt_Pos picks between a button's two pictures: 1 while it is held, and
      // for the OUT button the position it was left in (Esc_BtGetOutput)
      const pos = this.held === i ? 1 : i === 3 ? this.output : 0
      const image = ED_PICS.escapeButtons + (i - 1) * 2 + pos
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

  /** Esc_Hide (+Edit.s:9528), then Ed_Hide (:9606) */
  close(): void {
    if (!this.up) return
    this.up = false
    if (this.running) {
      this.rt.exitDirect()
      this.running = false
    }
    this.edHide()
    this.rt.closeScreen(DirectScreen.EC_DIRECT)
    if (this.prevScreen >= 0 && this.rt.screens.has(this.prevScreen)) this.rt.currentIndex = this.prevScreen
    this.prevScreen = -1
  }

  /**
   * The rest of `Ed_Appear` (+Edit.s:9673), which `edHide` reverses by name.
   *
   * `SyCall AMALFrz` freezes AMAL, `StActHs` stops the hardware sprites,
   * `StoreM` saves the mouse limits, `EcCalD RainHide,-1` masks every rainbow
   * and `EcCall SColB` sets the ground to `Ed_ColB`, which the editor's own
   * config gives as $000 (+Editor_Config.s:66).
   *
   * Each is something the program would otherwise go on doing to a display it
   * no longer owns. The rainbows are the one that showed: a demo cycling
   * colour 3 down the raster repainted the editor's text with it, and
   * RainHide is the machine's answer rather than anything invented here.
   */
  private edAppear(): void {
    this.saved = {
      rainbows: this.rt.rainbowsOn,
      colourBack: this.rt.colourBack,
      mouseLimit: this.rt.mouseLimit,
      spriteUpdate: this.rt.spriteUpdateOn,
    }
    this.rt.rainbowsOn = false
    this.rt.colourBack = 0x000
    this.rt.mouseLimit = null
    this.rt.spriteUpdateOn = false
    this.rt.freezeAll()
  }

  /** Ed_Hide (+Edit.s:9606): RainHide,0, the ground back to ColBack, the
   *  mouse limits out of LimSave, then RecallM / ReActHs / AMALUFrz */
  private edHide(): void {
    const was = this.saved
    if (!was) return
    this.saved = null
    this.rt.rainbowsOn = was.rainbows
    this.rt.colourBack = was.colourBack
    this.rt.mouseLimit = was.mouseLimit
    this.rt.spriteUpdateOn = was.spriteUpdate
    this.rt.unfreezeAll()
  }

  /**
   * One keystroke at the escape screen.
   *
   * Return runs the line, Escape puts the screen away, backspace rubs a
   * character out and anything from space up is echoed.
   *
   * DEVIATION: `Esc_Esc` (+Edit.s:9124) is `Esc_Hide` and then `Ed_Appear`, so
   * Escape here goes BACK TO THE EDITOR on the machine. This port has the
   * first half and `src/editor` has nowhere to appear yet, so the screen just
   * goes away and the stopped program's screens come back. Nothing is accepted
   * while a line is still running: AMOS types into one buffer (`Ed_BufT`) and
   * the line that is in it owns the interpreter until it ends.
   */
  key(ch: string, scan = 0, shift = false): void {
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
    // F1-F10 are $50-$59, and Shift takes them to F11-F20 (`Esc_Fonc`
    // +Edit.s:9173: `and.b #Shf,d0 / add.w #10,d1`)
    if (scan >= 0x50 && scan <= 0x59) {
      this.fkey(scan - 0x50 + 1 + (shift ? 10 : 0))
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
   * A function key, or the button that stands for one (Esc_BtFonc
   * +Edit.s:9179). 1-20; the message goes into the line, and a message that
   * ended in a backtick is run as if Return had been pressed after it.
   */
  fkey(n: number): void {
    if (!this.up || this.running) return
    const macro = fkeyMacro(n)
    if (!macro) return
    const s = this.rt.screens.get(DirectScreen.EC_DIRECT)
    if (!s) return
    // LEd_New replaces the line rather than appending to it
    this.line = macro.text
    this.redraw(s)
    if (!macro.run) return
    s.writeText('\n')
    this.submit()
  }

  /**
   * One of the thirteen buttons (Esc_Bouton +Edit.s:8955).
   *
   * `Bt_Number` counts from 1, and the routine walks it down: 1 is
   * `Esc_Esc`, 2 is `Ed_Wb`, 3 stores the OUT toggle, and everything from 4
   * on is a function key --- `.Pa3` leaves `d1` at n-4 and falls into
   * `Esc_BtFonc`, with the RIGHT mouse button adding 10.
   */
  press(n: number, right = false): void {
    if (!this.up) return
    if (n === 1) {
      this.close()
      return
    }
    if (n === 2) {
      // Ed_Wb (+Edit.s:11201) is `EcCalD AMOS_WB,0`, which is the same call
      // InAmosToBack makes (+Lib.s:11338)
      this.rt.amosToBack()
      return
    }
    if (n === 3) {
      this.output ^= 1
      const s = this.rt.screens.get(DirectScreen.EC_DIRECT)
      if (s) this.drawChrome(s, graphics())
      return
    }
    this.fkey(n - 3 + (right ? 10 : 0))
  }

  /**
   * Called once a frame, to notice that the line has finished.
   *
   * The interpreter runs a typed line over as many frames as it takes --- a
   * typed `Wait Vbl` really waits --- so the prompt cannot be printed by
   * whatever submitted it.
   */
  frame(): void {
    if (!this.up) return
    this.mouse()
    if (!this.running || this.rt.inDirect) return
    this.running = false
    this.prompt()
  }

  /**
   * The button strip under the mouse (Esc_MKey / Esc_MBoutons +Edit.s:8969).
   *
   * `Bt_Gere` fires on the press, and the button shows its down image while
   * it is held, which is what `Bt_Pos` selects between the two pictures every
   * button has.
   */
  private mouse(): void {
    const s = this.rt.screens.get(DirectScreen.EC_DIRECT)
    if (!s) return
    const keys = this.rt.input.mouseK
    const m = this.rt.mouseOnScreen(s)
    const over = m.y >= 0 && m.y < TITLE_H ? this.buttonAt(m.x) : -1
    const down = (keys & 3) !== 0 && over > 0 ? over : -1
    if (down !== this.held) {
      this.held = down
      this.drawChrome(s, graphics())
    }
    // the press edge, not the release: Esc_MKey acts as soon as LEd_Loop
    // reports the click
    if ((keys & 3) !== 0 && (this.lastKeys & 3) === 0 && over > 0) this.press(over, (keys & 2) !== 0)
    this.lastKeys = keys
  }

  /** which button covers this x, or -1 — the layout Esc_Appear lays out */
  private buttonAt(x: number): number {
    if (x < BUTTON_W) return 1
    if (x >= WIDTH - BUTTON_W) return 2
    const run = BUTTON_W + 4 * BUTTON_W
    if (x < run) return -1
    const i = Math.floor((x - run) / BUTTON_W) + 3
    return i <= BUTTONS ? i : -1
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

}
