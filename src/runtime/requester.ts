/**
 * Modal requesters, built out of the Interface dialog language.
 *
 * The callers here do not go to reqtools. ../amiga/reqtools.ts models the
 * library and ./rtreq.ts drives its EZRequest, which is what the Intuition
 * Extension's `Irequest Warning` and its neighbours now open; BUtility's
 * `Binforeq` and Delta's three have not been moved onto it yet. What they use
 * instead is AMOS Professional's own dialog engine (`dialog.ts`, the Dia_*
 * interpreter) and the shipped scripts that use it, so a requester is written
 * the way AMOS writes one: a script in the Interface language, run on a
 * temporary channel exactly as `Dialog Box` (Dia_RunQuick, +Lib.s:14655) runs
 * one.
 *
 * The grammar here is program 4 of `AMOSPro_Default_Resource.Abk` — the
 * Path:/Name: dialog, `PR 16,26,23ME,1` and `PR 16,36,24ME,1` being messages
 * 22 and 23, "Path:" and "Name:" — statement for statement. That program was
 * chosen over the editor's own requesters (`AMOSPro_Editor_Resource.Abk`
 * program 0, LA 1 / LA 12 / LA 34 / LA 39, which are an alert, a three-gadget
 * alert, a numeric input and a string input respectively) for one reason: the
 * editor draws its frames and buttons with `UN` and `BO`, which are 9-patches
 * out of the EDITOR's bank, and a program calling one of these keywords has
 * the DEFAULT bank loaded, where those image numbers mean something else.
 * Program 4 draws with `IN`/`GB`/`GS`/`PR` only — no bank images — so the same
 * script renders against any resource bank, including a user's own.
 *
 * DEVIATION: on the machine these are reqtools requesters in their own
 * Intuition window, movable, with reqtools' 3D look and its font. Here they
 * are AMOS dialogs drawn on the current screen, saved and restored underneath
 * by `SA`. The chrome differs; the contract does not — modal, blocking, and
 * answering the same numbers, which is what a calling program can observe.
 *
 * TWO PENS, 0 and 1, and every element is one on the other. Program 4 sits on
 * a screen it opened itself, so it can fill its title bar and buttons with
 * pen 1 and leave the body as the background; these requesters land on a
 * screen a game already owns, where the background is whatever that game left
 * behind. So the box fills, and everything drawn on the fill inverts:
 * pen-0 outline where program 4 outlines in pen 1, pen-0 body text where it
 * prints in pen 1, and a pen-0 title bar carrying pen-1 text where it does the
 * reverse. Every part of it is then legible on any palette where the two
 * colours differ, which is every palette. Drawn program 4's way on a screen
 * whose paper is already pen 1 — which is AMOS's own default — the box, its
 * outline and its text are all the same colour as what is behind them.
 *
 * The outline pen is `IN`'s FIRST value and not its third. `GS` reaches
 * `Screen.box`, which draws in the ink and never reads `gBorder`, so the
 * colour has to be set as the ink before the `GS` and put back for the next
 * fill.
 */
import type { Runtime } from './runtime'
import { DialogChannel, prescanDialog } from './dialog'
import type { ResourceBank } from '../loader/resource'

/** the system font the dialog engine measures with, for layout arithmetic */
const CHAR_W = 8

/** zone numbers: gadgets count from 1, the input field sits above them */
export const REQ_INPUT_ZONE = 20

export interface AlertSpec {
  kind: 'alert'
  /**
   * The title bar. reqtools' RTEZ_ReqTitle and intuition's es_Title, both of
   * which BUtility and GUI pass straight through, so both callers have one.
   */
  title: string
  /** the body, `\n`-separated as reqtools takes it */
  body: string
  /** gadget labels, left to right, from reqtools' "Yes|No|Cancel" */
  gadgets: string[]
}

export interface StringSpec {
  kind: 'string'
  title: string
  body: string
  def: string
  maxLen: number
}

export interface LongSpec {
  kind: 'long'
  title: string
  body: string
  def: number
  min: number
  max: number
}

export type RequesterSpec = AlertSpec | StringSpec | LongSpec

/** what a finished requester answers */
export interface RequesterResult {
  /**
   * reqtools' own numbering: gadget 1 is the leftmost and the RIGHTMOST
   * answers 0, which is why `rtEZRequest`'s "Yes|No" gives 1 for Yes and 0
   * for No. An input requester answers 1 for OK and 0 for Cancel.
   */
  ret: number
  /** the edit or digit zone's contents, empty for an alert */
  text: string
}

const lines = (s: string): string[] => s.split('\n')

/** widest line in characters, for `SI` */
const widest = (ls: string[]): number => ls.reduce((w, l) => Math.max(w, l.length), 0)

/**
 * The shared frame: a box the size of the dialog, outlined, with a filled
 * title bar across the top. Program 4's opening statements, which is why the
 * title bar is 20 high and the outline is drawn twice — `GS 0,0,SX1-,SY1-`
 * then `GS 1,0,SX2-,SY1-`, a two-pixel left edge and one everywhere else.
 *
 * `SI` clamps to the screen with `MI`. A reqtools requester opens on
 * Workbench, which is 640 wide, and BUtility's own demo draws a 40-character
 * rule across the top of its first one; asked for 352 pixels on a 320-wide
 * screen, `BA SWSX- 2/` centres it at -16 and the left edge of the box, both
 * outlines and the whole first column of text fall off the screen. Clamped,
 * the box is the screen and the text overhangs instead of the frame.
 */
function frame(w: number, h: number, title: string): string {
  return (
    `SI ${w}SWMI,${h}SHMI;BA SWSX- 2/,SHSY- 2/ 16- 0MA;SA 9;` +
    `IN 1,1,1;GB 0,0,SX,SY;IN 0,1,1;GS 0,0,SX1-,SY1-;GS 1,0,SX2-,SY1-;` +
    (title === '' ? '' : `GB 0,0,SX,20;PR 0VACX,7,0VA,1;`)
  )
}

/**
 * One push button. Program 4's, with the label coming from a variable rather
 * than a message: filled on every redraw and the text nudged a pixel down and
 * right while `BP` is set, which is the whole of AMOS's pressed look.
 */
function button(zone: number, varN: number, x: string, y: string, w: number, quit: string, key?: string): string {
  return (
    `BU ${zone},${x},${y},${w},10,0,0,1;` +
    `[IN 1,1,1;GB 0,0,SX,SY;IN 0,1,1;GS 0,0,SX1-,SY1-;PR ${varN}VACXBP+,1BP+,${varN}VA,0;]` +
    `[${quit}]` +
    (key === undefined ? '' : `KY ${key},0;`)
  )
}

/**
 * Build the script and the variables it reads. Strings go in variables rather
 * than into the text of the script, so a body containing a quote — which the
 * Interface tokenizer would take as the end of a literal — cannot break it.
 *
 * Variable 0 is the title, 1.. the body one line per variable, and the gadget
 * labels follow the last body line. `PR` prints a whole string including any
 * newlines in it as one run, so a five-line body given to one `PR` is drawn
 * as one line and the other four are lost; the lines are split here instead.
 *
 * EVERY `PR` prints in pen 0, because `frame` fills the whole box with pen 1
 * and program 4 prints in pen 0 wherever it has filled: its title bar and
 * both its buttons. Its body labels use pen 1 and sit on the UNFILLED part of
 * a full-screen dialog. Following that rule for the labels and not for the
 * fill is what made this requester's body text pen 1 on pen 1, invisible on
 * every palette rather than merely wrong on some.
 */
export function requesterScript(spec: RequesterSpec): { script: string; vars: Array<number | string> } {
  const vars: Array<number | string> = []
  const body = lines(spec.body)
  // the title bar's 20 rows, or a 4-pixel margin when there is no title
  const top = spec.title === '' ? 4 : 20
  vars[0] = spec.title
  body.forEach((line, i) => (vars[1 + i] = line))
  /** the first label variable: after the last body line, so neither is capped */
  const labelVar = 1 + body.length
  const bodyText = (): string =>
    body.map((_, i) => `PR ${1 + i}VACX,${top + 4 + i * 10},${1 + i}VA,0;`).join('')
  const titleW = (spec.title.length + 4) * CHAR_W
  const bodyW = widest(body) * CHAR_W + 32

  if (spec.kind === 'alert') {
    const gadgets = spec.gadgets.length === 0 ? ['OK'] : spec.gadgets
    gadgets.forEach((g, i) => (vars[labelVar + i] = g))

    const bw = Math.max(64, widest(gadgets) * CHAR_W + 16)
    const gap = 8
    const strip = gadgets.length * bw + (gadgets.length - 1) * gap
    const w = Math.max(bodyW, titleW, strip + 32, 208)
    const h = top + body.length * 10 + 30

    let s = frame(w, h, spec.title) + bodyText()
    // centred as a strip, so two gadgets straddle the middle like reqtools'
    const x0 = Math.floor((w - strip) / 2)
    gadgets.forEach((_, i) => {
      // Return takes the leftmost, Escape the rightmost — reqtools' bindings
      const key = i === 0 ? '13' : i === gadgets.length - 1 ? '27' : undefined
      s += button(i + 1, labelVar + i, String(x0 + i * (bw + gap)), 'SY14-', bw, 'BQ;', key)
    })
    return { script: s + 'RU 0,3;EX;', vars }
  }

  // the two input requesters differ only in their field
  vars[labelVar] = 'Ok'
  vars[labelVar + 1] = 'Cancel'
  const defVar = labelVar + 2
  const fieldChars =
    spec.kind === 'string' ? Math.min(spec.maxLen, 40) : Math.max(String(spec.min).length, String(spec.max).length)
  const w = Math.max(bodyW, titleW, fieldChars * CHAR_W + 32, 208)
  const h = top + body.length * 10 + 36
  let s = frame(w, h, spec.title) + bodyText()
  const fy = top + body.length * 10 + 6
  if (spec.kind === 'string') {
    vars[defVar] = spec.def
    // ED n,x,y,len,maxlen,init$,pap,pen — program 4's own edit zone, paper 0
    // and pen 1, which is the fill's colours the other way up
    s += `ED ${REQ_INPUT_ZONE},16,${fy},${fieldChars},${spec.maxLen},${defVar}VA,0,1;`
  } else {
    // DI n,x,y,len,value,flag,pap,pen — flag bit 0 seeds the field
    s += `DI ${REQ_INPUT_ZONE},16,${fy},${fieldChars},${spec.def},1,0,1;`
  }
  s += button(1, labelVar, '16', 'SY14-', 64, 'BQ;', '13')
  s += button(2, labelVar + 1, 'SX80-', 'SY14-', 64, 'BQ;', '27')
  return { script: s + 'RU 0,3;EX;', vars }
}

/**
 * Stand the requester up on a temporary channel and start it. Returns the
 * channel number to block on, or null if the script would not prescan --- a
 * bug here rather than anything a program did, so the caller treats it as a
 * cancel rather than raising into the program.
 */
export function startRequester(rt: Runtime, spec: RequesterSpec): number | null {
  const { script, vars } = requesterScript(spec)
  let c = 65536
  while (rt.dialogs.has(c)) c++
  // A channel is constructed against a resource bank, but these scripts name
  // nothing in one: no `ME` message, no `UN` or `BO` 9-patch. So a program
  // that never loaded a bank still gets its requester rather than "resource
  // bank not present", which is not an error the keyword can raise.
  let res: ResourceBank
  try {
    res = rt.resource()
  } catch {
    res = { graphics: null, messages: [], programs: null }
  }
  // sized to the script: the body is one variable per line and the labels
  // follow it, so a long requester needs more than a fixed 32
  const chan = new DialogChannel(c, Math.max(32, vars.length), res)
  chan.script = script
  chan.screenNb = rt.currentIndex
  try {
    const scan = prescanDialog(script)
    chan.labels = scan.labels
    chan.userInstrs = scan.userInstrs
  } catch {
    return null
  }
  for (let i = 0; i < vars.length; i++) if (vars[i] !== undefined) chan.setVar(i, vars[i]!)
  rt.dialogs.set(c, chan)
  const r = rt.runDialog(c, -1, null, null)
  if (r === 'blocked') return c
  return c
}

/**
 * Read a finished requester and drop its channel. Answers null while it is
 * still up, so the keyword blocks and re-runs.
 */
export function finishRequester(rt: Runtime, chan: number, spec: RequesterSpec): RequesterResult | null {
  const d = rt.dialogs.get(chan)
  if (!d) return { ret: 0, text: '' }
  if (d.runState !== 'done') return null
  const zone = d.ret
  const field = d.zones.find((z) => z.number === REQ_INPUT_ZONE)
  const text = field?.text ?? ''
  rt.dialogs.delete(chan)
  if (spec.kind === 'alert') {
    // reqtools numbers the rightmost gadget 0 and the rest left to right
    const n = spec.gadgets.length === 0 ? 1 : spec.gadgets.length
    if (zone <= 0) return { ret: 0, text: '' }
    return { ret: zone === n ? 0 : zone, text: '' }
  }
  // Ok is zone 1, Cancel zone 2; anything else (Escape without a zone) cancels
  return { ret: zone === 1 ? 1 : 0, text: zone === 1 ? text : '' }
}
