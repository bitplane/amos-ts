/**
 * Modal requesters, built out of the Interface dialog language.
 *
 * `reqtools.library` is not here, and neither is Intuition's `EasyRequest`.
 * What IS here is AMOS Professional's own dialog engine (`dialog.ts`, the
 * Dia_* interpreter) and the shipped scripts that use it, so a requester is
 * written the way AMOS writes one: a script in the Interface language, run
 * on a temporary channel exactly as `Dialog Box` (Dia_RunQuick, +Lib.s:14655)
 * runs one.
 *
 * The grammar here is program 3 of `AMOSPro_Default_Resource.Abk` — the
 * Path:/Name: dialog — statement for statement. That program was chosen over
 * the editor's own requesters (`AMOSPro_Editor_Resource.Abk` program 0, LA 1
 * / LA 12 / LA 34 / LA 39, which are an alert, a three-gadget alert, a
 * numeric input and a string input respectively) for one reason: the editor
 * draws its frames and buttons with `UN` and `BO`, which are 9-patches out of
 * the EDITOR's bank, and a program calling one of these keywords has the
 * DEFAULT bank loaded, where those image numbers mean something else. Program
 * 3 draws with `IN`/`GB`/`GS`/`PR` only — no bank images — so the same script
 * renders against any resource bank, including a user's own.
 *
 * DEVIATION: on the machine these are reqtools requesters in their own
 * Intuition window, movable, with reqtools' 3D look and its font. Here they
 * are AMOS dialogs drawn on the current screen, saved and restored underneath
 * by `SA`. The chrome differs; the contract does not — modal, blocking, and
 * answering the same numbers, which is what a calling program can observe.
 */
import type { Runtime } from './runtime'
import { DialogChannel, prescanDialog } from './dialog'

/** the system font the dialog engine measures with, for layout arithmetic */
const CHAR_W = 8

/** zone numbers: gadgets count from 1, the input field sits above them */
export const REQ_INPUT_ZONE = 20

export interface AlertSpec {
  kind: 'alert'
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
 * title bar across the top. Program 3's opening statements, which is why the
 * title bar is 20 high and the outline is drawn twice — `GS 0,0,SX1-,SY1-`
 * then `GS 1,0,SX2-,SY1-`, a two-pixel left edge and one everywhere else.
 */
function frame(w: number, h: number, title: string): string {
  return (
    `SI ${w},${h};BA SWSX- 2/,SHSY- 2/ 16-;SA 9;` +
    `IN 1,1,1;GB 0,0,SX,SY;GS 0,0,SX1-,SY1-;GS 1,0,SX2-,SY1-;` +
    (title === '' ? '' : `GB 0,0,SX,20;PR 0VACX,7,0VA,0;`)
  )
}

/**
 * One push button. Program 3's, with the label coming from a variable rather
 * than a message: filled on every redraw and the text nudged a pixel down and
 * right while `BP` is set, which is the whole of AMOS's pressed look.
 */
function button(zone: number, varN: number, x: string, y: string, w: number, quit: string, key?: string): string {
  return (
    `BU ${zone},${x},${y},${w},10,0,0,1;` +
    `[IN 1,1,1;GB 0,0,SX,SY;PR ${varN}VACXBP+,1BP+,${varN}VA,0;][${quit}]` +
    (key === undefined ? '' : `KY ${key},0;`)
  )
}

/**
 * Build the script and the variables it reads. Strings go in variables rather
 * than into the text of the script, so a body containing a quote — which the
 * Interface tokenizer would take as the end of a literal — cannot break it.
 */
export function requesterScript(spec: RequesterSpec): { script: string; vars: Array<number | string> } {
  const vars: Array<number | string> = []
  if (spec.kind === 'alert') {
    const body = lines(spec.body)
    const gadgets = spec.gadgets.length === 0 ? ['OK'] : spec.gadgets
    // variable 0 is the title bar, 1.. the remaining body lines, 10.. labels
    vars[0] = body[0] ?? ''
    for (let i = 1; i < body.length; i++) vars[i] = body[i]!
    gadgets.forEach((g, i) => (vars[10 + i] = g))

    const bw = Math.max(64, widest(gadgets) * CHAR_W + 16)
    const gap = 8
    const strip = gadgets.length * bw + (gadgets.length - 1) * gap
    const w = Math.max(widest(body) * CHAR_W + 32, strip + 32, 208)
    const h = 20 + Math.max(0, body.length - 1) * 10 + 12 + 10 + 12

    let s = frame(w, h, vars[0] as string)
    for (let i = 1; i < body.length; i++) s += `PR ${i}VACX,${20 + (i - 1) * 10 + 4},${i}VA,1;`
    // centred as a strip, so two gadgets straddle the middle like reqtools'
    const x0 = Math.floor((w - strip) / 2)
    gadgets.forEach((_, i) => {
      // Return takes the leftmost, Escape the rightmost — reqtools' bindings
      const key = i === 0 ? '13' : i === gadgets.length - 1 ? '27' : undefined
      s += button(i + 1, 10 + i, String(x0 + i * (bw + gap)), 'SY14-', bw, 'BQ;', key)
    })
    return { script: s + 'RU 0,3;EX;', vars }
  }

  // the two input requesters differ only in their field
  vars[0] = spec.title
  vars[1] = spec.body
  vars[10] = 'Ok'
  vars[11] = 'Cancel'
  const bodyLines = lines(spec.body)
  const fieldChars =
    spec.kind === 'string' ? Math.min(spec.maxLen, 40) : Math.max(String(spec.min).length, String(spec.max).length)
  const w = Math.max(
    widest(bodyLines) * CHAR_W + 32,
    (spec.title.length + 4) * CHAR_W,
    fieldChars * CHAR_W + 32,
    208,
  )
  const h = 20 + bodyLines.length * 10 + 14 + 10 + 12
  let s = frame(w, h, spec.title)
  bodyLines.forEach((_, i) => {
    if (i === 0) s += `PR 1VACX,${24},1VA,1;`
  })
  const fy = 20 + bodyLines.length * 10 + 2
  if (spec.kind === 'string') {
    vars[2] = spec.def
    // ED n,x,y,len,maxlen,init$,pap,pen — program 3's own edit zone
    s += `ED ${REQ_INPUT_ZONE},16,${fy},${fieldChars},${spec.maxLen},2VA,0,1;`
  } else {
    // DI n,x,y,len,value,flag,pap,pen — flag bit 0 seeds the field
    s += `DI ${REQ_INPUT_ZONE},16,${fy},${fieldChars},${spec.def},1,0,1;`
  }
  s += button(1, 10, '16', 'SY14-', 64, 'BQ;', '13')
  s += button(2, 11, 'SX80-', 'SY14-', 64, 'BQ;', '27')
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
  const chan = new DialogChannel(c, 32, rt.resource())
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
