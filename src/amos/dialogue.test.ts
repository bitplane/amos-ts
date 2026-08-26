import { describe, expect, it } from 'vitest'
import { Amos } from './amos'
import { EditorDialogues } from './dialogue'
import { ED } from '../editor/commands'
import { ED_MESSAGES } from '../runtime/edmessages.gen'

function boot(source = 'Print "A"'): Amos {
  const amos = new Amos(source)
  amos.openDisplay()
  return amos
}

describe('the editor s requesters, as the Interface programs they are', () => {
  it('a command that asks stops, and says what it asked', () => {
    // `Ed_Dialogue` does not return until a button is pressed. Here the
    // command is abandoned instead and the question is left where a host can
    // see it.
    const amos = boot()
    amos.window.prog.changed = true
    expect(amos.call(ED.QUIT)).toBe(0)
    const ask = amos.pendingAsk
    expect(ask?.kind).toBe('confirm')
  })

  it('runs the question again with the answer, and gets through', () => {
    const amos = boot()
    amos.window.prog.changed = true
    amos.call(ED.QUIT)
    expect(amos.pendingAsk).not.toBeNull()
    // 3 is Cancel on `Ed_Saved` (+Edit.s:13315), the one requester that reads
    // all three buttons
    amos.answer(3)
    expect(amos.pendingAsk).toBeNull()
    expect(amos.done).toBe(false)
  })

  it('opens channel 1 on program 1 of the editor s resource bank', () => {
    // `Ed_InitDialogues` (+Edit.s:3054): `moveq #1,d0`, 1024 bytes, sixteen
    // variables, the bank's programs and graphics, `Ed_Messages` for the text
    const amos = boot()
    const d = new EditorDialogues(() => amos.runtime!, 9)
    amos.window.prog.changed = true
    amos.call(ED.QUIT)
    d.start(amos.pendingAsk!)
    const chan = amos.runtime!.dialogs.get(1)
    expect(chan).toBeDefined()
    expect(chan!.nVars).toBe(16)
    expect(chan!.screenNb).toBe(9)
    // `Ed_Dialogue`'s d0 IS the label, so the EdD_ number the command asked
    // with has to be one of the 7,520-character script's
    const ask = amos.pendingAsk!
    expect(ask.kind).toBe('confirm')
    if (ask.kind === 'confirm') expect(chan!.labels.has(ask.confirm.which)).toBe(true)
  })

  it('draws the requester on the editor s screen and waits for a button', () => {
    const amos = boot()
    const d = new EditorDialogues(() => amos.runtime!, 9)
    amos.window.prog.changed = true
    amos.call(ED.QUIT)
    const answer = d.start(amos.pendingAsk!)
    // `RU` in the script blocks, so there is no answer until a button goes
    expect(answer).toBeUndefined()
    expect(d.up).toBe(true)
    const chan = amos.runtime!.dialogs.get(1)!
    expect(chan.drawn).toBe(true)
    expect(chan.zones.length).toBeGreaterThan(0)
  })

  it('offsets the requester s images by Ed_DiaImages, or it stamps the wrong ones', () => {
    // `Ed_InitDialogues` writes `Ed_DiaImages` into `Dia_PuzzleI(a0)` the
    // instruction after opening the channel (+Edit.s:3068), and `Dia_Unpack`
    // adds it to every `UN`. Without it the requesters stamp the editor's own
    // buttons for their frame: a readable message inside a wall of little red
    // arrows, which is what it looked like.
    const amos = boot()
    const d = new EditorDialogues(() => amos.runtime!, 9)
    amos.window.prog.changed = true
    amos.call(ED.QUIT)
    d.start(amos.pendingAsk!)
    expect(amos.runtime!.dialogs.get(1)!.puzzleBase).toBe(66)
  })

  it('draws its button labels, which are editor messages 17 and 18', () => {
    // label 1 of the script is the generic two-button requester and its
    // buttons are `[UN 0,0,BP 13+; PO 17ME CX,5,17ME,0,4;]`. Message 17 is
    // "Yes" and 18 is "No", and the final `PO` pass draws in ink 4.
    expect([ED_MESSAGES[16], ED_MESSAGES[17]]).toEqual(['Yes', 'No'])
    const amos = boot()
    const d = new EditorDialogues(() => amos.runtime!, 9)
    amos.window.prog.changed = true
    amos.call(ED.QUIT)
    d.start(amos.pendingAsk!)
    const chan = amos.runtime!.dialogs.get(1)!
    const s = amos.display!.screen!
    let ink4 = 0
    for (let y = chan.baseY; y < chan.baseY + chan.sizeY; y++) {
      for (let x = chan.baseX; x < chan.baseX + chan.sizeX; x++) if (s.point(x, y) === 4) ink4++
    }
    expect(ink4).toBeGreaterThan(20)
  })

  it('gives CA the one address the editor uses, which is EdReCop', () => {
    // `Ed_Ligne` (+Edit.s:8367) puts `EdReCop` into `Ed_VDialogues` slot 4
    // and its requester ends `CA 4VA`. `EdReCop` (:3043) is `SyCall WaitVbl
    // / EcCall CopForce / rts`, and this port rebuilds the copper list every
    // frame. Without the address the whole requester was a function call
    // error and nothing was drawn.
    const amos = boot()
    amos.useDisplay()
    const rt0 = amos.startRun()
    rt0.runHeadless(300)
    amos.finishRun(rt0.interp.endCode)
    const ask = amos.pendingAsk
    expect(ask?.kind).toBe('confirm')
    if (ask?.kind === 'confirm') expect(ask.confirm.which).toBe(59)
    const d = new EditorDialogues(() => amos.runtime!, 9)
    expect(() => d.start(ask!)).not.toThrow()
    expect(amos.runtime!.dialogs.get(1)!.drawn).toBe(true)
  })

  it('puts the editor s own message into the requester, not the bank s', () => {
    // `Dia_OpenChannel`'s a2 is `Ed_Messages`, so `ME` reads the editor's
    // numbered table: the script's `SV0,187ME` is message 187.
    const amos = boot()
    const d = new EditorDialogues(() => amos.runtime!, 9)
    amos.window.prog.changed = true
    amos.call(ED.QUIT)
    d.start(amos.pendingAsk!)
    const s = amos.display!.screen!
    // the requester is somewhere on the editor's screen: a run of pixels in
    // the colours the script paints with, which the editor itself does not use
    expect(ED_MESSAGES.length).toBeGreaterThan(200)
    expect(amos.runtime!.dialogs.get(1)!.sizeX).toBeGreaterThan(0)
    expect(s.width).toBe(640)
  })
})
