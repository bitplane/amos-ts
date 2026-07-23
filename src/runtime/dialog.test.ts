import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseAmosFile } from '../loader/amosfile'
import { isResourceBankName, parseResourceBank } from '../loader/resource'
import { Cursor, DialogChannel, DialogError, evalExpr, prescanDialog } from './dialog'
import type { DialogHost } from './dialog'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { Runtime } from './runtime'

const FIXTURES = join(__dirname, '..', '..', 'fixtures')
const DEFAULT_ABK = join(FIXTURES, 'official-amos', 'APSystem', 'AMOSPro_Default_Resource.Abk')

const host: DialogHost = {
  screenWidth: () => 320,
  screenHeight: () => 200,
  textWidth: (s) => s.length * 8,
  textHeight: () => 8,
  resolveArray: () => null,
}

const emptyRes = { graphics: null, messages: ['first', 'second', 'third'], programs: null }

function evl(expr: string, ch?: DialogChannel): number | string {
  const chan = ch ?? new DialogChannel(1, 16, emptyRes)
  return evalExpr(new Cursor(expr + ';'), { ch: chan, host })
}

describe('dialog expression evaluator (Dia_Evalue +Lib.s:22748)', () => {
  it('evaluates postfix arithmetic left to right', () => {
    expect(evl('360')).toBe(360)
    expect(evl('$FF')).toBe(255)
    expect(evl('%101')).toBe(5)
    expect(evl('2 3+')).toBe(5)
    expect(evl('10 3-')).toBe(7)
    expect(evl('6 7*')).toBe(42)
    expect(evl('17 5/')).toBe(3)
    expect(evl('5NE')).toBe(-5)
  })

  it('computes the classic centring idiom (SW SX - 2 /)', () => {
    const ch = new DialogChannel(1, 16, emptyRes)
    ch.sizeX = 100
    // BASWSX-2/,SHSY-2/ — the base-centring expression from the accessories
    expect(evalExpr(new Cursor('SWSX-2/;'), { ch, host })).toBe((320 - 100) / 2)
  })

  it('compares signed with -1/0 results and bitwise and/or', () => {
    expect(evl('3 3=')).toBe(-1)
    expect(evl('3 4=')).toBe(0)
    expect(evl('3 4\\')).toBe(-1)
    expect(evl('3 4<')).toBe(-1)
    expect(evl('4 3>')).toBe(-1)
    expect(evl('3 3= 1 1=&')).toBe(-1)
    expect(evl('12 10&')).toBe(8) // bitwise, not logical
    expect(evl('1 2 MI')).toBe(1)
    expect(evl('1 2 MA')).toBe(2)
  })

  it('handles strings: literals, concat, number conversion, length', () => {
    expect(evl('"HELLO"')).toBe('HELLO')
    expect(evl("'A' 'B'!")).toBe('AB')
    expect(evl('42#')).toBe('42')
    expect(evl('"ABC"TL')).toBe(3)
    expect(evl('"AB" 3#!')).toBe('AB3')
  })

  it('reads messages, variables and text metrics', () => {
    const ch = new DialogChannel(1, 16, emptyRes)
    ch.vars[3] = 7
    ch.sizeX = 100
    expect(evalExpr(new Cursor('2ME;'), { ch, host })).toBe('second')
    expect(evalExpr(new Cursor('3VA;'), { ch, host })).toBe(7)
    expect(evalExpr(new Cursor('"ABCD"TW;'), { ch, host })).toBe(32)
    expect(evalExpr(new Cursor('TH;'), { ch, host })).toBe(8)
    expect(evalExpr(new Cursor('"AB"CX;'), { ch, host })).toBe(42) // (100-16)/2
  })

  it('errors when the stack depth is not 1 at the terminator', () => {
    expect(() => evl('1 2')).toThrow(DialogError)
    expect(() => evl('+')).toThrow(DialogError)
    expect(() => evl('1 0/')).toThrow(DialogError) // division by zero
  })

  it('skips cosmetic characters (space parens dot lowercase)', () => {
    expect(evl('(2).(3)+comment')).toBe(5)
  })
})

describe('dialog prepass (Dia_OpenChannel +Lib.s:19962)', () => {
  it('records labels and validates statements', () => {
    const { labels } = prescanDialog('LA7;SI360,84;BASWSX-2/,SHSY-2/;EX;')
    expect(labels.has(7)).toBe(true)
    // offset points just after "LA7;"
    expect(labels.get(7)).toBe(4)
  })

  it('records user instructions and allows forward calls', () => {
    const src = 'RB0,0,10,10,0;EX;UIRB,5;[GBP1,P2,P3,P4;EX;]'
    const { userInstrs } = prescanDialog(src)
    expect(userInstrs.get('RB')).toEqual({ nParams: 5, off: src.indexOf('[') + 1 })
  })

  it('rejects bad mnemonic pairs, duplicate labels, unterminated strings', () => {
    expect(() => prescanDialog('QQ1;EX;')).not.toThrow() // unknown = UI call, allowed
    expect(() => prescanDialog('LA1;LA1;EX;')).toThrow(/label already defined/)
    expect(() => prescanDialog('PR0,0,"OOPS,3;EX;')).toThrow(/syntax/)
    expect(() => prescanDialog('SI360;EX;')).toThrow(/parameters/) // SI needs 2
    expect(() => prescanDialog('BOZZ,0,1,2,3;EX;')).toThrow(/syntax/) // ZZ not a function
  })

  it('accepts the real accessory script fragments', () => {
    // Resource_Bank_Maker.AMOS embedded dialogs
    prescanDialog('LA7;SI360,84;BASWSX-2/,SHSY-2/;BO0,0,1,SX,SY;BO8,4,1,SX8-,20;PO103MECX,8,103ME,3,0;EX;')
    prescanDialog('IF1VA1=;[BO16,30,79,SX16-,46;HS1,18,31,SX36-,14,0,1,100,1;[]]EX;')
    prescanDialog('IF0VA1=;[BJ1,16,SY24-,64,5ME;KY27,0;BJ2,SX80-,SY24-,64,4ME;KY13,0;RU0,3;]IF0VA2=;[BJ1,SX80-,SY24-,64,5ME;KY$FF,0;RU0,3;]EX;LA1;BA0,0;EX;')
  })
})

describe.skipIf(!existsSync(FIXTURES))('oracle: every resource-bank program prescans clean', () => {
  it('walks all fixture banks', () => {
    const programs: Array<{ file: string; n: number; script: string }> = []
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name)
        const st = statSync(p)
        if (st.isDirectory()) {
          walk(p)
          continue
        }
        if (!/\.(amos|abk)$/i.test(name)) continue
        let banks
        try {
          banks = parseAmosFile(readFileSync(p)).banks
        } catch {
          continue
        }
        for (const bank of banks) {
          if (bank.kind !== 'memory' || !isResourceBankName(bank.name)) continue
          try {
            const res = parseResourceBank(bank.data)
            for (const [i, script] of (res.programs ?? []).entries()) {
              programs.push({ file: p.slice(FIXTURES.length + 1), n: i + 1, script })
            }
          } catch {
            // not actually a resource-format bank
          }
        }
      }
    }
    walk(FIXTURES)
    expect(programs.length).toBeGreaterThan(10)
    const failures: string[] = []
    for (const { file, n, script } of programs) {
      try {
        prescanDialog(script)
      } catch (e) {
        failures.push(`${file} program ${n} @${e instanceof DialogError ? e.position : '?'}: ${String(e)}`)
      }
    }
    expect(failures).toEqual([])
  })
})

describe.skipIf(!existsSync(DEFAULT_ABK))('dialog keywords', () => {
  const table = new TokenTable(CORE_TOKENS)

  function run(src: string): { rt: Runtime; out: string } {
    let out = ''
    const rt = new Runtime(tokenize(src, table), table, { maxSteps: 300_000, onText: (t) => (out += t) })
    rt.loadSystemResource(readFileSync(DEFAULT_ABK))
    const r = rt.runHeadless(1_000)
    if (r.status !== 'ended' && r.status !== 'stopped') throw new Error(`program ${r.status}`)
    return { rt, out }
  }

  it('opens and closes channels, transfers variables both ways', () => {
    const prog = [
      'D$="LA1;SV0,5VA2*;EX;"',
      'Dialog Open 1,D$,8',
      'Vdialog(1,5)=21',
      'Print Vdialog(1,5)',
      'Vdialog$(1,3)="TEXT"',
      'Print Vdialog$(1,3)',
      'Dialog Close 1',
    ].join('\n')
    const { out } = run(prog)
    expect(out).toBe(' 21\nTEXT\n')
  })

  it('errors on double open and unknown channels', () => {
    expect(() => run('Dialog Open 1,"EX;"\nDialog Open 1,"EX;"')).toThrow(/already opened/)
    expect(() => run('Dialog Close 3')).toThrow(/not opened/)
    expect(() => run('Print Vdialog(2,0)')).toThrow(/not opened/)
  })

  it('reports syntax errors via Edialog', () => {
    const prog = [
      'Trap Dialog Open 1,"SI360;EX;"',
      'Print Errtrap<>0',
      'Print Edialog>0',
    ].join('\n')
    const { out } = run(prog)
    expect(out).toBe('-1\n-1\n')
  })

  it('opens a program straight from the resource bank by number', () => {
    const { rt } = run('Dialog Open 2,1,8')
    expect(rt.dialogs.get(2)!.script.length).toBeGreaterThan(0)
  })
})

describe.skipIf(!existsSync(DEFAULT_ABK))('dialog run: draw phase (Dia_RunProgram +Lib.s:20535)', () => {
  const table = new TokenTable(CORE_TOKENS)

  function boot(src: string): { rt: Runtime; out: () => string } {
    let out = ''
    const rt = new Runtime(tokenize(src, table), table, { maxSteps: 300_000, onText: (t) => (out += t) })
    rt.loadSystemResource(readFileSync(DEFAULT_ABK))
    return { rt, out: () => out }
  }

  it('draws graphic boxes and text at the dialog base', () => {
    const src = [
      'D$="SI160,64;BA32,16;IN5,0,0;GB0,0,32,10;PR0,20,\'HI\',6;EX;"',
      'Dialog Open 1,D$',
      'R=Dialog Run(1)',
      'Print R',
    ].join('\n')
    const { rt, out } = boot(src)
    const r = rt.runHeadless(1_000)
    expect(r.status).toBe('ended')
    const s = rt.screens.get(0)!
    expect(s.point(40, 20)).toBe(5) // GB filled with ink 5 at base 32,16
    expect(out()).toBe(' 0\n')
    // text 'HI' in pen 6 at (32, 36)
    let found = false
    for (let y = 36; y < 44; y++) for (let x = 32; x < 48; x++) if (s.point(x, y) === 6) found = true
    expect(found).toBe(true)
  })

  it('draws the 9-patch box from real resource images (BO, Dia_Box)', () => {
    const src = [
      'D$="SI160,64;BA0,0;BO0,0,1,SX,SY;EX;"',
      'Dialog Open 1,D$',
      'R=Dialog Run(1)',
    ].join('\n')
    const { rt } = boot(src)
    expect(rt.runHeadless(1_000).status).toBe('ended')
    const s = rt.screens.get(0)!
    let painted = 0
    for (let y = 0; y < 64; y++) for (let x = 0; x < 160; x++) if (s.point(x, y) !== 0) painted++
    expect(painted).toBeGreaterThan(500) // the panel really rendered
  })

  it('RU blocks the program; the timer exits with 0 and restores the background (SA)', () => {
    const src = [
      'Ink 3 : Bar 10,10 To 60,40', // background to save/restore
      'D$="SI64,32;BA16,8;SA1;IN5,0,0;GB0,0,40,20;RU25,0;EX;"',
      'Dialog Open 1,D$',
      'R=Dialog Run(1)',
      'Print R',
    ].join('\n')
    const { rt, out } = boot(src)
    // run some frames: the dialog must be up (drawn) while waiting
    for (let i = 0; i < 10 && rt.frame().status !== 'ended'; i++);
    expect(rt.dialogs.get(1)!.runState).toBe('waiting')
    expect(rt.screens.get(0)!.point(20, 12)).toBe(5) // dialog box over background
    // let the 25-frame timer expire
    for (let i = 0; i < 40 && rt.frame().status !== 'ended'; i++);
    expect(out()).toBe(' 0\n')
    expect(rt.screens.get(0)!.point(20, 12)).toBe(3) // background restored
  })

  it('a no-RU dialog stays drawn and Dialog(n) reads one-shot', () => {
    const src = [
      'D$="SI32,16;BA0,0;EX;"',
      'Dialog Open 1,D$',
      'R=Dialog Run(1)',
      'Print Dialog(1);Dialog(1)',
    ].join('\n')
    const { rt, out } = boot(src)
    expect(rt.runHeadless(1_000).status).toBe('ended')
    expect(rt.dialogs.get(1)!.drawn).toBe(true)
    expect(out()).toBe(' 0 0\n')
  })

  it('IF true runs the block then skips the rest of the routine (Dia_If)', () => {
    const src = [
      'D$="SI32,16;IF1;[SV0,11;]SV0,99;EX;]LA1;EX;"',
      'Dialog Open 1,D$,4',
      'R=Dialog Run(1)',
      'Print Vdialog(1,0)',
    ].join('\n')
    const { rt, out } = boot(src)
    expect(rt.runHeadless(1_000).status).toBe('ended')
    expect(out()).toBe(' 11\n') // SV0,99 skipped
    void rt
  })

  it('IF false skips only the bracketed block', () => {
    const src = [
      'D$="SI32,16;IF0;[SV0,11;]SV0,99;EX;"',
      'Dialog Open 1,D$,4',
      'R=Dialog Run(1)',
      'Print Vdialog(1,0)',
    ].join('\n')
    const { out, rt } = boot(src)
    expect(rt.runHeadless(1_000).status).toBe('ended')
    expect(out()).toBe(' 99\n')
  })

  it('JS/RT subroutines and user instructions with P1..P9 params', () => {
    const src = [
      'D$="SI32,16;JS5;MY10,32;EX;LA5;SV0,7;RT;UIMY,2;[SV1,P1P2+;]"',
      'Dialog Open 1,D$,4',
      'R=Dialog Run(1)',
      'Print Vdialog(1,0);Vdialog(1,1)',
    ].join('\n')
    const { out, rt } = boot(src)
    expect(rt.runHeadless(1_000).status).toBe('ended')
    expect(out()).toBe(' 7 42\n')
  })

  it('buttons: click cycles the position, BQ exits the wait (Dia_Tests .MBt)', () => {
    // button zone 1 at screen 20,10 size 40x16; draw routine paints it,
    // change routine sets quit so a click ends the run with 5
    const src = [
      'D$="SI160,64;BA0,0;BU5,20,10,40,16,0,0,3;[IN6,0,0;GB0,0,SX,SY;][BQ;]RU0,0;EX;"',
      'Dialog Open 1,D$',
      'R=Dialog Run(1)',
      'Print R;Rdialog(1,5)',
    ].join('\n')
    const { rt, out } = boot(src)
    for (let i = 0; i < 5; i++) rt.frame()
    expect(rt.dialogs.get(1)!.runState).toBe('waiting')
    // button drew itself via its [draw] routine
    expect(rt.screens.get(0)!.point(30, 15)).toBe(6)
    // click inside the button (screen 30,15 → hw 128+30, 50+15 on lowres)
    rt.input.mouseX = 128 + 30
    rt.input.mouseY = 50 + 15
    rt.input.mouseK = 1
    rt.frame()
    rt.input.mouseK = 0
    for (let i = 0; i < 5 && rt.frame().status !== 'ended'; i++);
    expect(out()).toBe(' 5 1\n') // exit zone 5, position cycled 0→1
  })

  it('clicks outside zones do not exit; RU flag bit3 makes any click exit', () => {
    const src = [
      'D$="SI64,32;BA0,0;BU1,0,0,10,10,0,0,1;[][BQ;]RU0,8;EX;"',
      'Dialog Open 1,D$',
      'R=Dialog Run(1)',
      'Print R',
    ].join('\n')
    const { rt, out } = boot(src)
    for (let i = 0; i < 3; i++) rt.frame()
    rt.input.mouseX = 128 + 50 // outside the button
    rt.input.mouseY = 50 + 30
    rt.input.mouseK = 1
    rt.frame()
    rt.input.mouseK = 0
    for (let i = 0; i < 5 && rt.frame().status !== 'ended'; i++);
    expect(out()).toBe(' 0\n') // flag bit3 exit returns Return=0 (no zone)
  })

  it('KY zones simulate a press on their button (Dia_Tests .KLoop)', () => {
    const src = [
      'D$="SI64,32;BA0,0;BU2,0,0,10,10,0,0,1;[][BQ;]KY27,0;RU0,0;EX;"',
      'Dialog Open 1,D$',
      'R=Dialog Run(1)',
      'Print R',
    ].join('\n')
    const { rt, out } = boot(src)
    for (let i = 0; i < 3; i++) rt.frame()
    rt.pressKey('\x1b', 0x45) // Escape, ASCII 27
    for (let i = 0; i < 5 && rt.frame().status !== 'ended'; i++);
    expect(out()).toBe(' 2\n')
  })

  it('live dialogs report via Dialog(n) and erase themselves on quit (Dia_AutoTest)', () => {
    const src = [
      'Ink 3 : Bar 0,0 To 63,31',
      'D$="SI64,32;BA0,0;SA1;BU7,0,0,20,20,0,0,1;[IN5,0,0;GB0,0,SX,SY;][BQ;]EX;"',
      'Dialog Open 1,D$',
      'R=Dialog Run(1)',
      'Do',
      ' D=Dialog(1)',
      ' If D<>0 Then Print D : End',
      ' Wait Vbl',
      'Loop',
    ].join('\n')
    const { rt, out } = boot(src)
    for (let i = 0; i < 5; i++) rt.frame()
    expect(rt.screens.get(0)!.point(5, 5)).toBe(5) // button drawn over background
    rt.input.mouseX = 128 + 5
    rt.input.mouseY = 50 + 5
    rt.input.mouseK = 1
    rt.frame()
    rt.input.mouseK = 0
    for (let i = 0; i < 8 && rt.frame().status !== 'ended'; i++);
    expect(out()).toBe('-1\n') // erased before the poll saw the number
    // (5,18): inside the button area, clear of the printed "-1" text cells
    expect(rt.screens.get(0)!.point(5, 18)).toBe(3) // background restored
  })

  it('Dialog Update pushes a new position through the change routine', () => {
    const src = [
      'D$="SI64,32;BA0,0;BU3,0,0,10,10,1,0,9;[][]RU2,0;EX;"',
      'Dialog Open 1,D$',
      'R=Dialog Run(1)',
      'Print Rdialog(1,3)',
      'Dialog Update 1,3,7',
      'Print Rdialog(1,3)',
    ].join('\n')
    const { rt, out } = boot(src)
    expect(rt.runHeadless(1_000).status).toBe('ended')
    expect(out()).toBe(' 1\n 7\n')
  })

  it('Dialog Clr erases the display, Dialog Run label errors when undefined', () => {
    const src = [
      'Ink 3 : Bar 0,0 To 50,50',
      'D$="SI32,16;BA0,0;SA1;IN5,0,0;GB0,0,30,14;EX;"',
      'Dialog Open 1,D$',
      'R=Dialog Run(1)',
      'Dialog Clr 1',
    ].join('\n')
    const { rt } = boot(src)
    expect(rt.runHeadless(1_000).status).toBe('ended')
    expect(rt.screens.get(0)!.point(5, 5)).toBe(3) // restored
    expect(() => {
      const { rt: rt2 } = boot('Dialog Open 1,"EX;"\nR=Dialog Run(1,9)')
      rt2.runHeadless(500)
    }).toThrow(/label not defined/)
  })
})
