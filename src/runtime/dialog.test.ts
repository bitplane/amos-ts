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
