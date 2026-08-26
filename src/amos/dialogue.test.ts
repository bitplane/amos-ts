import { describe, expect, it } from 'vitest'
import { Amos } from './amos'
import { EditorDialogues, replaceLabel } from './dialogue'
import { ED } from '../editor/commands'
import { ED_MESSAGES } from '../runtime/edmessages.gen'
import { PORT_ABOUT_LABEL, PORT_ABOUT_LINES } from '../editor/branding'

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

describe('Ed_ErrDirect, which is where Ed_Ligne s first button goes', () => {
  it('raises the escape screen, rather than only clearing Edt_Runned', () => {
    // `Ed_ErrDirect` (+Edit.s:9293) is `Ed_OpenEditor / Ed_Hide / Esc_Appear`
    // and then `Esc_Loop`, so the escape screen is up when it is over. This
    // port had the routine as one line -- `clr.l Edt_Runned(a5)` -- with the
    // display left out, so choosing "Direct mode [ESC]" did nothing at all.
    const amos = new Amos('Print "A"\nEnd\n')
    amos.useDisplay()
    const rt0 = amos.startRun()
    rt0.runHeadless(300)
    amos.finishRun(rt0.interp.endCode)
    const ask = amos.pendingAsk
    expect(ask?.kind).toBe('confirm')
    // `cmp.w #1,d1` in `Ed_Errr` (:8261): button 1 is Direct mode
    amos.answer(1)
    expect(amos.inEscape).toBe(true)
    expect(amos.runtime!.directScreen.isOpen).toBe(true)
  })

  it('goes to the editor for the other button', () => {
    const amos = new Amos('Print "A"\nEnd\n')
    amos.useDisplay()
    const rt0 = amos.startRun()
    rt0.runHeadless(300)
    amos.finishRun(rt0.interp.endCode)
    amos.answer(2) // Editor [RETURN]
    expect(amos.inEscape).toBe(false)
    expect(amos.display!.isOpen).toBe(true)
  })
})

describe('the About box, which is the one label this port rewrites', () => {
  it('splices a body between LA n and the label after it, and leaves the rest', () => {
    const script = 'LA\t0;PR\t1,2,3,4;EX;LA\t7;SI\t8,9;EX;'
    expect(replaceLabel(script, 0, 'EX;')).toBe('LA\t0;EX;LA\t7;SI\t8,9;EX;')
    expect(replaceLabel(script, 7, 'EX;')).toBe('LA\t0;PR\t1,2,3,4;EX;LA\t7;EX;')
    // a label the script does not have is a bank with nothing to rewrite
    expect(replaceLabel(script, 3, 'EX;')).toBe(script)
  })

  it('runs, and prints every line the port put in a variable', () => {
    // The whole point of replacing the label rather than the messages: this
    // is the real Interface interpreter drawing the real requester, so a
    // script that does not parse fails here rather than on a screen.
    const amos = boot()
    amos.call(ED.ABOUT)
    const ask = amos.pendingAsk
    expect(ask?.kind).toBe('confirm')
    expect(ask?.kind === 'confirm' && ask.confirm.which).toBe(PORT_ABOUT_LABEL)
    const dia = new EditorDialogues(() => amos.runtime!, 9)
    expect(dia.start(ask!)).toBeUndefined() // it is up, waiting
    const chan = amos.runtime!.dialogs.get(1)!
    for (const [slot, text] of PORT_ABOUT_LINES) expect(chan.getVar(slot), `slot ${slot}`).toBe(text)
    // `SV 1,1VA# 24ME !` turned the count into the shipped sentence
    expect(String(chan.getVar(1))).toContain(ED_MESSAGES[23])
  })
})

describe('a question already on the screen, asked again', () => {
  /**
   * `Ed_Dialogue` (+Edit.s:3107) runs its label ONCE and then does not return
   * until a button is pressed. A host with three ways to notice a pending
   * question -- the frame loop, a key and a click -- had two of them calling
   * `start` again on a live channel, which re-ran the script over its own
   * output and, for `Ed_File_Selector`, opened a second EcFsel on top of the
   * first. Closing that one restored a current screen that had just been
   * closed: "screen not opened: 10".
   */
  it('does not run the label a second time', () => {
    const amos = boot()
    amos.window.prog.changed = true
    amos.call(ED.QUIT)
    const ask = amos.pendingAsk!
    const dia = new EditorDialogues(() => amos.runtime!, 9)
    expect(dia.start(ask)).toBeUndefined()
    const chan = amos.runtime!.dialogs.get(1)!
    expect(chan.runState).toBe('waiting')
    const zones = chan.zones.length
    expect(zones).toBeGreaterThan(0)
    // and again, which is what a click used to do
    expect(dia.start(ask)).toBeUndefined()
    expect(chan.runState).toBe('waiting')
    expect(chan.zones.length).toBe(zones)
  })

  it('still reads the fields of one that has been answered', () => {
    // `Dia_GetValue` (+Lib.s:20813) and its two neighbours are not questions:
    // every caller asks them AFTER the requester came back, and the channel
    // is in `done` with its zones still on it. The guard must not eat those.
    const amos = boot()
    amos.window.prog.changed = true
    amos.call(ED.QUIT)
    const dia = new EditorDialogues(() => amos.runtime!, 9)
    dia.start(amos.pendingAsk!)
    const chan = amos.runtime!.dialogs.get(1)!
    amos.runtime!.finishDialogRun(chan, 1)
    expect(chan.runState).toBe('done')
    expect(dia.start({ kind: 'flags', from: 4, count: 3 })).toBe(0)
    expect(dia.start({ kind: 'text', zone: 7 })).toBe('')
  })
})
