import { describe, expect, it } from 'vitest'
import { ED } from '../editor/commands'
import { ED_RUN_MESSAGES } from '../interp/errors.gen'
import { ED_TST_MESSAGES } from '../runtime/edmessages.gen'
import { Amos } from './amos'
import type { Confirm, DialogueAnswer, EditorDialogues, SearchDialogue } from '../editor/search'
import { parseAmosFile } from '../loader/amosfile'
import { Runtime } from '../runtime/runtime'
import { tokenize } from '../tokens/source'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { AmigaFS } from '../amiga/vfs'
import { Edit } from '../editor/edit'
import { ProgramBuffer } from '../editor/buffer'
import { EditBuffer } from '../editor/editbuf'
import { UndoBuffer } from '../editor/undo'
import { tokeniseSource } from '../tokens/edtok'
import { verify } from '../tokens/verify'

/** a program, and somewhere for what it prints to go */
function boot(src: string): { amos: Amos; out: () => string } {
  const text: string[] = []
  const amos = new Amos(src, { onText: (t) => text.push(t), rows: 12 })
  return { amos, out: () => text.join('').replace(/\s+/g, ' ').trim() }
}

/** a requester that answers `button`, since `Ed_Ligne` asks before every error */
const asks = (button: number): EditorDialogues => ({
  ask: (d: SearchDialogue): DialogueAnswer => ({ ...d, ok: true }),
  confirm: (_c: Confirm) => button,
  select: (_w, name) => name,
  pressKey: () => 0,
  pickWindow: () => 0,
  pickMenu: () => 0,
  text: () => '',
  flags: () => 0,
  value: () => 0,
})

describe('Run, from the editor all the way through the interpreter', () => {
  it('runs the program the window holds and comes back quietly', () => {
    const { amos, out } = boot('Print "one"\nPrint "two"')
    expect(amos.call(ED.RUN)).toBe(0)
    expect(out()).toBe('one two')
    // the walk ran off the end, which is `End`: `Ed_Errr` sends 10 to Ed_Loop
    expect(amos.editor.runned).toBe(null)
    expect(amos.editor.running).toEqual([])
  })

  it('can run the same program twice, because Prg_Pull happened', () => {
    const { amos, out } = boot('Print "again"')
    expect(amos.call(ED.RUN)).toBe(0)
    expect(amos.call(ED.RUN)).toBe(0)
    expect(out()).toBe('again again')
  })

  it('treats Edit as a quiet return and System as the end of the session', () => {
    const a = boot('Print "x"\nEdit')
    expect(a.amos.call(ED.RUN)).toBe(0)
    expect(a.amos.done).toBe(false)

    const b = boot('Print "x"\nSystem')
    expect(b.amos.call(ED.RUN)).toBe(0)
    expect(b.amos.done).toBe(true)
  })

  it('shows a run-time error on the status line, with a full stop', () => {
    const { amos } = boot('Print "before"\nOpen In 1,"nothing:here"\nPrint "after"')
    amos.editor.dialogues = asks(2) // Ed_Ligne: anything but 1 is the editor
    const alert = amos.call(ED.RUN)
    expect(alert).toBeGreaterThan(0)
    expect(amos.alert.text).toBe(`${ED_RUN_MESSAGES[alert]!}.`)
  })

  it('puts the cursor on the line the program stopped at', () => {
    const { amos } = boot('Print "a"\nPrint "b"\nOpen In 1,"nothing:here"')
    amos.editor.dialogues = asks(2)
    amos.call(ED.RUN)
    expect(amos.window.line).toBe(2)
  })

  it('puts it on the token, because VerPos is an address and not a line', () => {
    // `rErr1` (+ILib.s:1370) is `move.l d7,a0 / subq.l #2,a0 / ... / move.l
    // a0,VerPos(a5)`: d7 is the next word to read, so this is the last one
    // read, which for a disc error is the name that would not open.
    // `Ed_Ligne` (+Edit.s:8344) then cuts 13 characters BEFORE it
    let head = ''
    const { amos } = boot('Open In 1,"nothing:here"')
    amos.editor.dialogues = {
      ...asks(2),
      confirm: (c) => {
        if (c.which === 59) head = c.strings?.[2] ?? ''
        return 2
      },
    }
    amos.call(ED.RUN)
    // column 10 is the string, and 10-13 clamps to 0, so the head is all of it
    expect(head).toBe('Open In 1,')
    expect(amos.window.xCu).toBe(10)
  })

  it('asks Direct or Edit first, and says nothing when the answer is Direct', () => {
    const { amos } = boot('Open In 1,"nothing:here"')
    amos.editor.dialogues = asks(1) // `cmp.w #1,d1 / beq Ed_ErrDirect`
    expect(amos.call(ED.RUN)).toBe(0)
    expect(amos.alert.text).toBe('')
  })

  it('leaves the program tested, so the editor can save it as one', () => {
    const { amos } = boot('Print "x"')
    amos.window.prog.modified = true // as an edit would leave it
    amos.call(ED.RUN)
    // `clr.b Prg_StModif(a6)` after PTest, inside Prg_RunIt
    expect(amos.window.prog.modified).toBe(false)
  })
})

describe('Escape, which is the same shape as Run', () => {
  it('hides the editor and puts the escape screen in front', () => {
    const { amos } = boot('Print "x"')
    expect(amos.call(ED.ESCAPE)).toBe(0)
    expect(amos.inEscape).toBe(true)
    expect(amos.editor.esFlag).toBe(true)
    expect(amos.runtime!.directScreen.isOpen).toBe(true)
  })

  it('comes back through Esc_Esc and nowhere else', () => {
    const { amos } = boot('Print "x"')
    amos.call(ED.ESCAPE)
    expect(amos.escapeBack()).toBe(0)
    expect(amos.inEscape).toBe(false)
    expect(amos.editor.esFlag).toBe(false)
    expect(amos.runtime!.directScreen.isOpen).toBe(false)
  })

  it('is idempotent both ways, because both flags are guarded', () => {
    const { amos } = boot('Print "x"')
    amos.call(ED.ESCAPE)
    amos.call(ED.ESCAPE)
    expect(amos.inEscape).toBe(true)
    amos.escapeBack()
    amos.escapeBack()
    expect(amos.inEscape).toBe(false)
  })

  it('keeps what the program left, which is what direct mode is for', () => {
    const { amos } = boot('A=42')
    amos.call(ED.RUN)
    const after = amos.runtime
    amos.call(ED.ESCAPE)
    // `Prg_RunIt` clears the variables before a run, not after one
    expect(amos.runtime).toBe(after)
    expect(amos.runtime!.interp.getVar('a', 0)).toEqual({ k: 'int', n: 42 })
  })

  it('takes every warning box down on the way out, as Ed_Hide does', () => {
    const { amos } = boot('Print "x"')
    amos.editor.avert.push(198)
    amos.call(ED.ESCAPE)
    expect(amos.editor.avert).toEqual([])
  })

  it('plays the E sample, unless the sounds are off', () => {
    const { amos } = boot('Print "x"')
    const heard: string[] = []
    amos.editor.playSample = (c) => heard.push(c)
    amos.editor.config.sounds = true
    amos.call(ED.ESCAPE)
    amos.escapeBack()
    expect(heard).toEqual(['E', 'E'])

    heard.length = 0
    amos.editor.config.sounds = false
    amos.call(ED.ESCAPE)
    expect(heard).toEqual([])
  })
})

describe('the banks are one list, not two', () => {
  /**
   * `Prg_SetBanks` (+Verif.s:4714) is five instructions and the first two are
   * `move.l a0,Cur_Banks(a5)` and `move.l a0,Cur_Dialogs(a5)` with a0 at
   * `Prg_Banks(a6)`. The interpreter's banks ARE the editor's, so what a
   * `Reserve` leaves is still there when the program has stopped.
   */
  const str = (b: Uint8Array): string => new TextDecoder('latin1').decode(b)

  it('starts with the six bytes every program carries', () => {
    const { amos } = boot('Print "x"')
    expect(str(amos.window.prog.banks)).toBe('AmBs\0\0')
  })

  it('leaves the bank a run reserved in the editor buffer', () => {
    const { amos } = boot('Reserve As Work 10,100\nPrint "x"')
    expect(amos.call(ED.RUN)).toBe(0)
    const banks = parseAmosFile(amos.window.prog.banks).banks
    expect(banks.map((b) => (b.kind === 'memory' ? b.number : b.kind))).toEqual([10])
    expect(banks[0]!.kind === 'memory' && banks[0]!.data.length).toBe(100)
  })

  it('carries it into the next run, because only Prg_New erases banks', () => {
    // `Prg_RunIt` clears the variables (`bsr ClearVar`, +Verif.s:4356) and
    // nothing else. `Bnk.EffAll` is in `Prg_New` (:4742), which Run is not
    const { amos, out } = boot('If Length(10)=0 Then Reserve As Work 10,100\nPrint Length(10)')
    amos.call(ED.RUN)
    amos.call(ED.RUN)
    expect(out()).toBe('100 100')
    expect(parseAmosFile(amos.window.prog.banks).banks.length).toBe(1)
  })

  it('drops the pointer when New empties the program', () => {
    const { amos } = boot('Reserve As Work 10,100')
    amos.call(ED.RUN)
    amos.window.prog.newProgram()
    expect(amos.window.prog.liveBanks).toBe(null)
    expect(str(amos.window.prog.banks)).toBe('AmBs\0\0')
  })

  it('saves the program WITH the bank, which is the point of the shared list', () => {
    const fs = new AmigaFS()
    fs.mountMemory('RAM')
    const amos = new Amos('Reserve As Work 10,100', { fs })
    amos.editor.dialogues = asks(2)
    amos.call(ED.RUN)
    amos.window.name1 = 'RAM:X.AMOS'
    expect(amos.call(ED.SAVE)).toBe(0)
    const file = fs.readFile('RAM:X.AMOS')!
    const banks = parseAmosFile(file).banks
    expect(banks.map((b) => (b.kind === 'memory' ? b.number : b.kind))).toEqual([10])
  })

  it('counts the reserved bytes in Ed_Infos, which used to read a stale block', () => {
    const { amos } = boot('Reserve As Work 10,100')
    let values: (number | undefined)[] = []
    amos.editor.dialogues = { ...asks(2), confirm: (c) => { values = c.values ?? []; return 2 } }
    amos.call(ED.RUN)
    amos.call(ED.INFOS) // EdD_Infos is 54, and the run's EdD_Ligne is 59
    // `Bnk.GetLength` (+Lib.s:8484) adds up what each bank OCCUPIES; here it
    // is the AmBs block less the six bytes an empty one still has
    expect(values[3]).toBe(120)
  })
})

describe('the monitor, which the editor loads off disc', () => {
  it('reports it missing and leaves the editor standing', () => {
    const { amos } = boot('Print "x"')
    expect(amos.call(ED.MONITOR)).toBe(222)
    expect(amos.alert.text).toBe('Monitor not found.')
    expect(amos.editor.opened).toBe(true)
  })

  it('drops the machine on the way, because Edt_ClearVar frees the variables', () => {
    const { amos } = boot('A=42')
    amos.call(ED.RUN)
    expect(amos.runtime!.interp.getVar('a', 0)).toEqual({ k: 'int', n: 42 })
    amos.call(ED.MONITOR)
    expect(amos.runtime).toBe(null)
  })

  it('keeps the banks, because ClearVar is variables and not Bnk.EffAll', () => {
    const { amos } = boot('Reserve As Work 10,100')
    amos.editor.dialogues = asks(2)
    amos.call(ED.RUN)
    amos.call(ED.MONITOR)
    expect(parseAmosFile(amos.window.prog.banks).banks.length).toBe(1)
  })
})

describe('the remote control, which is an accessory driving the editor', () => {
  /**
   * `Call Editor` and `Ask Editor` are `Ed_ZapIn` and `Ed_ZapFonction` with
   * `Ed_Par` (+ILib.s:1745) in front of them, and the answer comes back in
   * `Param` and `Param$` -- d0 and a0 out of `Ed_ZapX` (+Edit.s:2737).
   *
   * The accessory has to BE one. `Ed_ZapIn` opens by comparing `Edt_Runned`
   * with `Edt_Current` and testing `Prg_Accessory(a5)`, and failing either is
   * -6. A program run with `Ed_Run` fails both: it IS the current window.
   */
  it('answers -6 with the message when the program is not an accessory', () => {
    const { amos, out } = boot('Call Editor 4\nPrint Param;" ";Param$')
    amos.editor.dialogues = asks(2)
    amos.call(ED.RUN)
    expect(out()).toBe('-6 Program is not an accessory.')
    // and the command did not run
    expect(amos.window.line).toBe(0)
  })

  it('asks a question the same way, and -6 comes back in both halves', () => {
    // `Ed_ZapFonction`'s error arms set d2 to 2 as well as d0 (+Edit.s:2814),
    // so the text reaches Param$ even though the value is not zero
    const { amos, out } = boot('Ask Editor 5\nPrint Param;" ";Param$')
    amos.editor.dialogues = asks(2)
    amos.call(ED.RUN)
    expect(out()).toBe('-6 Program is not an accessory.')
  })

  it('is an Illegal function call with no editor at all, which is a CLI run', () => {
    // `tst.l Edit_Segment(a5) / beq FonCall` (+ILib.s:1674) is the first test
    // either keyword makes, and `Runtime.editorZap` null is that
    const t = new TokenTable(CORE_TOKENS)
    const rt = new Runtime(tokenize('Call Editor 4', t), t, { maxSteps: 10_000 })
    expect(() => rt.runHeadless(50)).toThrow(/Illegal function call/)
  })
})

/** another window on this editor, holding `src` (`Ed_OpenWindow` +Edit.s:11228) */
function win(amos: Amos, src: string): Edit {
  return new Edit(
    ProgramBuffer.load(verify(tokeniseSource(src, amos.table), {}).slice(0, -2), 65536),
    new EditBuffer(4),
    new UndoBuffer(50),
    amos.table,
    {},
    amos.editor,
  )
}

describe('the Test pass knows which extension is in which slot', () => {
  /**
   * `Ver_Extension` refuses a keyword whose slot holds no library. On the
   * machine the slots are MACHINE state -- the libraries were loaded before
   * the editor started and `T_ExtAdr` is what the walk looks at -- and
   * nothing in this port loads one, so what fills them is the program's own
   * extension table.
   *
   * Without it `Ed_Run` refused every program that uses an extension, and
   * `Ed_FCall` reports a failed test and a successful one with the same 0, so
   * what a host saw was "Ed_Run answered 0" and no program.
   */
  it('runs a program that calls one, rather than refusing it', () => {
    // `Music` is slot 1, the stock AMOSPro_Music library
    const text: string[] = []
    const amos = new Amos('Print "A"\nTrack Loop On\nPrint "B"', {
      onText: (t) => text.push(t),
      requesters: false,
    })
    expect(amos.call(ED.RUN)).toBe(0)
    expect(amos.testError.code).toBe(-1)
    expect(text.join('').replace(/\s+/g, ' ').trim()).toBe('A B')
  })

  it('says which test refused it, since Ed_FCall answers 0 either way', () => {
    // `Ed_TstMessages` is a `GetMessage` table and so 1-based: code 5 is
    // "Extension not loaded" at index 4, not "Too many direct mode variables"
    const amos = new Amos('Print "A"', { requesters: false })
    expect(amos.testError).toEqual({ code: -1, text: '' })
    amos.window.testError = 5
    expect(amos.testError).toEqual({ code: 5, text: ED_TST_MESSAGES[4] })
  })
})

describe('the window that runs is the one Ed_Run named', () => {
  it('runs a hidden window s program and not the current window s', () => {
    // `Edt_Runned(a5)` is the window whose program runs. `Ed_RunHidden`
    // (+Edit.s:8105) is the reason it is not always the current one: a window
    // with no screen area still has a program in it.
    //
    // This used to be impossible here. `Amos.machine` built the interpreter
    // from `this.window` whatever `Ed_Run` had asked for, so a hidden
    // window's program could not run at all.
    const text: string[] = []
    const amos = new Amos('Print "MAIN"', { onText: (t) => text.push(t), rows: 12, requesters: false })
    const w = win(amos, 'Print "HIDDEN"')
    w.hidden = 1
    expect(amos.call(ED.RUN_HIDDEN, 0)).toBe(0)
    expect(text.join('').replace(/\s+/g, ' ').trim()).toBe('HIDDEN')
  })

  it('lets a hidden accessory drive the editor, which is what Call Editor is for', () => {
    // `Ed_ZapX` (+Edit.s:2737) opens by comparing `Edt_Runned` with
    // `Edt_Current`, and refuses -6 when they are the same: an accessory may
    // not drive its own window. With one window there was nothing else for
    // them to be, so `Call Editor` was always -6.
    //
    // `.PRun` (+Verif.s:4366) is the other half. Asking for an accessory run
    // only lets a program that IS one take the accessory path, and what makes
    // it one is `Set Accessory`, which the Test pass counts (`VerSetA`, :825).
    const text: string[] = []
    const amos = new Amos('Print "MAIN"', { onText: (t) => text.push(t), rows: 12, requesters: false })
    const w = win(amos, 'Set Accessory\nCall Editor 2\nPrint "ACC ";Param')
    w.hidden = 1
    expect(amos.call(ED.RUN_HIDDEN, 0)).toBe(0)
    // command 2 is `Ed_CBas`, cursor down, and 0 is "it ran"
    expect(text.join('').replace(/\s+/g, ' ').trim()).toBe('ACC 0')
  })

  it('refuses -6 when the accessory IS the current window', () => {
    // `.Nor` (+Verif.s:4380) clears `Prg_Accessory` for a normal run, so a
    // program full of `Set Accessory` that was simply Run is not one
    const text: string[] = []
    const amos = new Amos('Set Accessory\nCall Editor 75\nPrint Param', {
      onText: (t) => text.push(t),
      rows: 12,
      requesters: false,
    })
    expect(amos.call(ED.RUN)).toBe(0)
    expect(text.join('').replace(/\s+/g, ' ').trim()).toBe('-6')
  })

  it('runs the current window s program when nothing hid one', () => {
    const { amos, out } = boot('Print "MAIN"')
    amos.editor.dialogues = null
    expect(amos.call(ED.RUN)).toBe(0)
    expect(out()).toBe('MAIN')
  })
})
