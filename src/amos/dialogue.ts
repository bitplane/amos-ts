/**
 * The editor's requesters, run as what they are: Interface programs.
 *
 * `Ed_InitDialogues` (+Edit.s:3054) opens dialogue channel 1 on program 1 of
 * `AMOSPro_Editor_Resource.Abk`, with that bank's graphics and the EDITOR's
 * message table, sixteen variables and a 1KB buffer. `Ed_DoDialog` (:3128)
 * then runs `L_Dia_RunProgram` with the EdD_ number as the LABEL, so every
 * requester the editor has is a label in one 7,520-character script.
 *
 * All of which this port already has. `src/runtime/dialog.ts` is the Interface
 * language, `Runtime.runDialog` starts a run and `stepDialogs` advances it a
 * frame at a time, and the bank is baked into `src/runtime/edres.gen.ts`. So
 * the requesters here are the real ones, drawn by the real engine, and not a
 * drawing of them.
 *
 * What does not come free is the waiting. `Ed_DoDialog` does not return until
 * a button is pressed and the editor command that asked is sitting in the
 * middle of itself; a browser cannot do that. `./requester.ts` is the answer
 * and says what it costs.
 */
import { DialogChannel, dialogZoneByNumber, dialogZoneValue, eraseDialog, prescanDialog } from '../runtime/dialog'
import { EDITOR_RESOURCE_BANK } from '../runtime/edres.gen'
import { ED_MESSAGES } from '../runtime/edmessages.gen'
import { parseAmosFile } from '../loader/amosfile'
import { parseResourceBank } from '../loader/resource'
import type { ResourceBank } from '../loader/resource'
import type { Runtime } from '../runtime/runtime'
import type { EditorAnswer, EditorAsk } from './requester'

/** the channel `Ed_InitDialogues` opens, and the only one the editor uses */
const CHANNEL = 1

/** `moveq #16,d2`, the sixteen `Ed_VDialogues` variables */
const N_VARS = 16

/**
 * `Ed_DiaImages` (+Edit.s:126): "Debut des images dialogue dans la banque".
 *
 * `Ed_InitDialogues` writes it into `Dia_PuzzleI(a0)` the instruction after
 * opening the channel, and `Dia_Unpack` adds it to every `UN` image number.
 * Without it the requesters stamp the editor's own buttons for their frame,
 * which is a readable message inside a wall of little red arrows.
 */
const ED_DIA_IMAGES = 66

/**
 * The address `Ed_Ligne` puts in `Ed_VDialogues` slot 4 for its `CA 4VA`.
 *
 * `lea EdReCop(pc),a0 / move.l a0,4*4(a2)` (+Edit.s:8367). The routine
 * (:3043) is `SyCall WaitVbl / EcCall CopForce / rts` -- force the copper
 * list to be rebuilt -- and this port rebuilds it every frame, so what is
 * registered under this number does nothing. The number itself is made up:
 * the machine's is wherever the editor was loaded.
 */
const ED_RECOP = 0x00ed_0001

/**
 * The bank the editor draws its requesters out of.
 *
 * `Dia_OpenChannel` takes the programs and the graphics from `Ed_Resource`
 * and the messages from `Ed_Messages`, which is a DIFFERENT table: the
 * requester script's `ME` reads the editor's own numbered messages, so 187 is
 * "Delete this line?" and not the seventh string in the resource bank.
 */
let bank: ResourceBank | null | undefined
function resource(): ResourceBank | null {
  if (bank === undefined) {
    try {
      const parsed = parseAmosFile(EDITOR_RESOURCE_BANK)
      const mem = parsed.banks.find((b) => 'data' in b) as { data: Uint8Array } | undefined
      const r = mem ? parseResourceBank(mem.data) : null
      bank = r === null ? null : { graphics: r.graphics, programs: r.programs, messages: [...ED_MESSAGES] }
    } catch {
      bank = null
    }
  }
  return bank
}

/**
 * Which label in program 1 a question runs.
 *
 * `Ed_Dialogue`'s d0 IS the label, and the EdD_ numbers at +Edit.s:15333 are
 * what the callers pass. The three questions that are not a requester at all
 * answer -1: `Ed_File_Selector` (:14059) is its own routine, `Ed_LinkCursor`
 * (:2342) waits for a mouse click and `Mn_GetOption` (:5733) for a menu pick.
 *
 * `value`, `text` and `flags` are not questions either. They read the fields
 * of the requester that has just been answered, which is still on the channel
 * because `finishDialogRun` leaves its zones there.
 */
function labelFor(ask: EditorAsk): number {
  switch (ask.kind) {
    case 'confirm':
      return ask.confirm.which
    case 'ask':
      return ask.dialogue.which
    case 'pressKey':
      return ask.which
    default:
      return -1
  }
}

export class EditorDialogues {
  private chan: DialogChannel | null = null

  constructor(
    private readonly machine: () => Runtime,
    private readonly screenNb: number,
  ) {}

  /** whether a requester is on the screen and waiting for a button */
  get up(): boolean {
    return this.chan !== null && this.chan.runState !== 'idle'
  }

  /** `Ed_InitDialogues`: channel 1 on program 1 of the editor's resource bank */
  private channel(): DialogChannel | null {
    const rt = this.machine()
    const standing = rt.dialogs.get(CHANNEL)
    if (standing !== undefined && standing === this.chan) return this.chan
    const res = resource()
    const script = res?.programs?.[0]
    if (res === null || script === undefined) return null
    const chan = new DialogChannel(CHANNEL, N_VARS, res)
    chan.script = script
    chan.screenNb = this.screenNb
    const scan = prescanDialog(script)
    chan.labels = scan.labels
    chan.userInstrs = scan.userInstrs
    chan.puzzleBase = ED_DIA_IMAGES
    chan.machineCalls.set(ED_RECOP, () => {
      // `EdReCop`: the copper list, rebuilt. `buildCopperList` runs every
      // frame here, so the wait and the force are both already done.
    })
    rt.dialogs.set(CHANNEL, chan)
    this.chan = chan
    return chan
  }

  /**
   * `Ed_Dialogue` (:3107): fill `Ed_VDialogues` and run the label.
   *
   * Answers straight away for a question that reads a finished requester's
   * fields rather than putting a new one up, and `undefined` for one this
   * port cannot draw, which the caller has to answer some other way.
   */
  start(ask: EditorAsk): EditorAnswer | undefined {
    const chan = this.channel()
    if (chan === null) return undefined
    const read = this.readField(chan, ask)
    if (read !== undefined) return read
    const label = labelFor(ask)
    if (label < 0) return undefined
    this.fill(chan, ask)
    // `Ed_Ligne` (+Edit.s:8397) is `SyCalD Show,-1` and `Esc_MaxMouse` before
    // it positions the pointer on the requester. Every requester needs the
    // same thing for the same reason: the program that just stopped may have
    // hidden the pointer, and a button nobody can point at is not a button.
    this.machine().mouseShow = 0
    const r = this.machine().runDialog(CHANNEL, label, null, null)
    return r === 'blocked' ? undefined : this.answerFrom(chan, ask, r)
  }

  /**
   * `Dia_GetValue` (+Lib.s:20813) and `Dia_GetVFlags` (:20926).
   *
   * These do not put anything up. Every caller asks them AFTER the requester
   * came back, and the zones are still on the channel because
   * `finishDialogRun` leaves them there.
   */
  private readField(chan: DialogChannel, ask: EditorAsk): EditorAnswer | undefined {
    if (ask.kind === 'value' || ask.kind === 'text') {
      const z = dialogZoneByNumber(chan, ask.zone, 1)
      if (z === null) return ask.kind === 'text' ? '' : 0
      const v = dialogZoneValue(z)
      return ask.kind === 'text' ? (v.s ?? '') : v.n
    }
    if (ask.kind === 'flags') {
      // the checkbox variables, one bit each, from `from` upward
      let bits = 0
      for (let i = 0; i < ask.count; i++) if (Number(chan.getVar(ask.from + i)) !== 0) bits |= 1 << i
      return bits
    }
    return undefined
  }

  /** the `Ed_VDialogues` slots the caller filled before `Ed_Dialogue` */
  private fill(chan: DialogChannel, ask: EditorAsk): void {
    for (let i = 0; i < N_VARS; i++) chan.setVar(i, 0)
    if (ask.kind === 'confirm') {
      const c = ask.confirm
      if (c.name !== undefined) chan.setVar(0, c.name)
      if (c.count !== undefined) chan.setVar(0, c.count)
      c.values?.forEach((v, i) => {
        if (v !== undefined && v !== null) chan.setVar(i, v)
      })
      c.strings?.forEach((v, i) => {
        if (v !== undefined && v !== null) chan.setVar(i, v)
      })
      // `Ed_Ligne` fills slot 4 with `EdReCop` for its own `CA 4VA`
      if (c.which === 59) chan.setVar(4, ED_RECOP)
      return
    }
    if (ask.kind === 'ask') {
      // `Ed_Search` (:6949) copies `Ed_SchBuf` and `Ed_SchMode` in, and a
      // copy loop reads both back whatever button was pressed
      chan.setVar(0, ask.dialogue.search)
      chan.setVar(1, ask.dialogue.replace)
      chan.setVar(2, ask.dialogue.mode)
    }
  }

  /** one frame of `Dia_Tests`; the answer once a button has been pressed */
  step(ask: EditorAsk): EditorAnswer | undefined {
    const chan = this.chan
    if (chan === null) return undefined
    if (chan.runState !== 'done') return undefined
    chan.runState = 'idle'
    return this.answerFrom(chan, ask, chan.ret)
  }

  /** `Ed_Dialogue`'s d0, in whatever shape the question wanted */
  private answerFrom(chan: DialogChannel, ask: EditorAsk, ret: number): EditorAnswer {
    if (ask.kind !== 'ask') return ret
    const str = (n: number): string => {
      const v = chan.getVar(n)
      return typeof v === 'string' ? v : String(v)
    }
    return {
      which: ask.dialogue.which,
      search: str(0),
      replace: str(1),
      mode: Number(chan.getVar(2)) | 0,
      ok: ret === 1,
    }
  }

  /** take the requester off the screen, which `Ed_Dialogue` does on the way out */
  hide(): void {
    const chan = this.chan
    if (chan === null || !chan.drawn) return
    eraseDialog(chan, this.machine().dialogDraw)
    chan.runState = 'idle'
  }
}
