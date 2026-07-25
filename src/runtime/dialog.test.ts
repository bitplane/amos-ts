import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseAmosFile } from '../loader/amosfile'
import { isResourceBankName, parseResourceBank } from '../loader/resource'
import { Cursor, DialogChannel, DialogError, evalExpr, prescanDialog, splitHyperLines, updateZone } from './dialog'
import type { DialogDraw, DialogHost, DialogZone } from './dialog'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { Runtime } from './runtime'
import { FS_MAX_STORE, fselAffF, fselFirst, fselJump, fselNext, fselStore, fselStoreList } from './fsel'
import { AmigaFS } from './vfs'

const FIXTURES = join(__dirname, '..', '..', 'fixtures')
const DEFAULT_ABK = join(FIXTURES, 'official-amos', 'APSystem', 'AMOSPro_Default_Resource.Abk')

const host: DialogHost = {
  screenWidth: () => 320,
  screenHeight: () => 200,
  textWidth: (s) => s.length * 8,
  textHeight: () => 8,
  resolveArray: () => null,
  readMem: () => null,
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

describe.skipIf(!existsSync(DEFAULT_ABK))('Fsel$ (the native selector over bank program 2)', () => {
  const table = new TokenTable(CORE_TOKENS)

  function bootFs(src: string): { rt: Runtime; out: () => string } {
    const fs = new AmigaFS()
    const dh0 = fs.mountMemory('DH0')
    const enc = (s: string): Uint8Array => Uint8Array.from([...s].map((c) => c.charCodeAt(0)))
    dh0.write(['Games', 'alpha.iff'], enc('A'))
    dh0.write(['Games', 'beta.iff'], enc('BB'))
    dh0.write(['Games', 'Deep', 'gamma.abk'], enc('CCC'))
    fs.currentDir = 'DH0:'
    let out = ''
    const rt = new Runtime(tokenize(src, table), table, { maxSteps: 300_000, fs, onText: (t) => (out += t) })
    rt.loadSystemResource(readFileSync(DEFAULT_ABK))
    return { rt, out: () => out }
  }

  function clickZone(rt: Runtime, number: number, kind?: string): void {
    const d = [...rt.dialogs.values()][0]!
    const z = d.zones.find((zz) => zz.number === number && (!kind || zz.kind === kind))!
    const s = rt.screens.get(d.screenNb)!
    rt.input.mouseX = s.displayX + ((z.x + 4) >> (s.hires ? 1 : 0))
    rt.input.mouseY = s.displayY + z.y + 4
    rt.input.mouseK = 1
    rt.frame()
    rt.input.mouseK = 0
    rt.frame()
  }

  it('opens the selector screen from the bank layout and cancels to ""', () => {
    const { rt, out } = bootFs('F$=Fsel$("DH0:Games")\nPrint "R=";F$;"."')
    for (let i = 0; i < 5; i++) rt.frame()
    expect(rt.fsel).not.toBeNull()
    const d = [...rt.dialogs.values()][0]!
    // EcFsel (+Equ.s:792) — the system slot Fs_ScOpen uses, above 0-7
    expect(d.screenNb).toBe(10)
    expect(rt.screens.has(Runtime.EC_FSEL)).toBe(true)
    // the real bank layout produced the zones: OK 1, Cancel 2, list 13, edits 14/15
    for (const n of [1, 2, 3, 4, 6]) expect(d.zones.some((z) => z.number === n && z.kind === 'button')).toBe(true)
    expect(d.zones.some((z) => z.kind === 'list')).toBe(true)
    // the file list was filled from the VFS (2 files + 1 dir)
    const list = d.zones.find((z) => z.kind === 'list')!
    expect(list.count).toBe(3)
    clickZone(rt, 2, 'button') // Cancel
    for (let i = 0; i < 6 && rt.frame().status !== 'ended'; i++);
    expect(out()).toBe('R=.\n')
    expect(rt.screens.has(Runtime.EC_FSEL)).toBe(false) // selector screen closed
  })

  it('opens at the size and position the interpreter config holds', () => {
    // Fs_ScOpen (+Lib.s:17825) takes PI_FsDSx/FsDSy, and the window position
    // is whatever Fs_Close last stored in PI_FsDWx/FsDWy
    const { rt } = bootFs('F$=Fsel$("DH0:Games")')
    for (let i = 0; i < 5; i++) rt.frame()
    const s = rt.screens.get(Runtime.EC_FSEL)!
    expect([s.width, s.height]).toEqual([448, 158])
    expect([s.displayX, s.displayY]).toEqual([129 + 48, 50 + 20])
  })

  it('follows the config when it has been changed', () => {
    const { rt } = bootFs('F$=Fsel$("DH0:Games")')
    rt.pi.FsDSx = 320
    rt.pi.FsDSy = 128
    rt.pi.FsDWx = 200
    rt.pi.FsDWy = 90
    for (let i = 0; i < 5; i++) rt.frame()
    const s = rt.screens.get(Runtime.EC_FSEL)!
    expect([s.width, s.height, s.displayX, s.displayY]).toEqual([320, 128, 200, 90])
  })

  it('seeds the Sort/Size/Store toggles from the config', () => {
    const { rt } = bootFs('F$=Fsel$("DH0:Games")')
    rt.pi.FsSort = 1
    rt.pi.FsSize = 0
    rt.pi.FsStore = 1
    for (let i = 0; i < 5; i++) rt.frame()
    const d = [...rt.dialogs.values()][0]!
    // FsV_Sort 7, FsV_Size 8, FsV_Store 16 (+Equ.s:2189), and FsV_PosFirst
    // starts at -1 until Fs_First finds the first file (18737)
    expect([d.vars[7], d.vars[8], d.vars[16]]).toEqual([1, 0, 1])
    expect(d.vars[25]).toBe(-1)
    expect(d.vars[10]).toBe(0) // FsV_PList
  })

  it('leaves a blank title to the dialog program', () => {
    // Fs_GetInputs (18923) tests the length word before assigning, so an
    // empty title line is not the same as a title of ""
    const { rt } = bootFs('F$=Fsel$("DH0:Games","","Pick one")')
    for (let i = 0; i < 5; i++) rt.frame()
    const d = [...rt.dialogs.values()][0]!
    expect(d.vars[0]).toBe('Pick one') // FsV_Titre0 given
    expect(d.vars[1]).toBe(0) // FsV_Titre1 left unset, so the script fills it
  })

  it('sets the Return-does-not-advance flag on its channel', () => {
    const { rt } = bootFs('F$=Fsel$("DH0:Games")')
    for (let i = 0; i < 5; i++) rt.frame()
    // Dia_Flags bit 4 (17858): Return in the name box reports the zone but
    // must not jump the cursor to the path box. Only the wiring is checked
    // here — the keystroke itself goes through Fs_Return, which is slice 6.
    const d = [...rt.dialogs.values()][0]!
    expect(d.noEditAdvance).toBe(true)
  })

  it('parses a blocking Fsel$ nested in procedure-call arguments', () => {
    // block(rewind) resets the pc so the statement re-runs on resume. It used
    // to return normally, leaving parseProcArgs reading from the start of the
    // statement — `expected "]"`. Real corpus programs call the selector
    // exactly this way: _INFO_LOAD_[Fsel$(""),5]
    const { rt, out } = bootFs(
      [
        'Procedure _LOAD_[F$,N]',
        '  Shared R$',
        '  R$=F$+"|"+Str$(N)',
        'End Proc',
        '_LOAD_[Fsel$("DH0:Games"),5]',
        'Print R$',
      ].join('\n'),
    )
    for (let i = 0; i < 5; i++) rt.frame()
    expect(rt.fsel).not.toBeNull() // it really did block mid-argument
    clickZone(rt, 2, 'button') // Cancel
    for (let i = 0; i < 8 && rt.frame().status !== 'ended'; i++);
    expect(out()).toBe('| 5\n')
  })

  it('formats the Sizes column the way Fs_GetName does', () => {
    const { rt } = bootFs('F$=Fsel$("DH0:Games")')
    for (let i = 0; i < 8; i++) rt.frame()
    const d = [...rt.dialogs.values()][0]!
    d.vars[8] = 1 // FsV_Size on
    d.vars[12] = 30 // FsV_Tx — the script owns this; pin it for the test
    rt.fsel!.entries = [
      { name: 'Deep', isDir: true, size: 0 },
      { name: 'alpha.iff', isDir: false, size: 1 },
      { name: 'RAM:', isDir: false, size: 0, special: true },
    ]
    fselAffF(rt, rt.fsel!)
    const rows = rt.fsel!.arr.data.map((v) => (v as { s: string }).s)
    // a file: name padded to Tx-8, a space, then the size left-aligned in
    // what is left, the whole row exactly Tx wide
    expect(rows[1]).toBe(' alpha.iff'.padEnd(22) + ' ' + '1'.padEnd(7))
    expect(rows[1]!.length).toBe(30)
    // directories and assigns never get a size, just the marker + name
    expect(rows[0]).toBe('*Deep')
    expect(rows[2]).toBe(' RAM:')
  })

  it('leaves the size off entirely when the Sizes toggle is off', () => {
    const { rt } = bootFs('F$=Fsel$("DH0:Games")')
    for (let i = 0; i < 8; i++) rt.frame()
    const d = [...rt.dialogs.values()][0]!
    d.vars[8] = 0
    d.vars[12] = 30
    rt.fsel!.entries = [{ name: 'alpha.iff', isDir: false, size: 1 }]
    fselAffF(rt, rt.fsel!)
    expect((rt.fsel!.arr.data[0] as { s: string }).s).toBe(' alpha.iff')
  })

  it('fills the list one entry per frame', () => {
    // Fs_Loop (+Lib.s:17920) takes a single name per pass while Fs_DirOn is
    // set, so the selector stays live while a slow drawer lists
    const { rt } = bootFs('F$=Fsel$("DH0:Games")')
    const seen: number[] = []
    for (let i = 0; i < 6; i++) {
      rt.frame()
      seen.push(rt.fsel!.entries.length)
    }
    // the drawer holds 1 directory + 2 files, and they arrive one per frame
    // rather than all at once when the selector opens
    expect(seen[0]!).toBeLessThan(3)
    expect(seen).toEqual([...seen].sort((a, b) => a - b)) // never goes backwards
    expect(seen[seen.length - 1]!).toBe(3)
    expect(rt.fsel!.dirOn).toBe(false)
  })

  it('keeps the view steady when a sorted insert lands above the top', () => {
    // Fs_Next (18765): with PosFirst pinned, an entry inserted at or above it
    // steps FsV_PList and FsV_PosFirst together. A plain listing leaves
    // PosFirst at -1, so this only bites after a type-ahead search.
    const { rt } = bootFs('F$=Fsel$("DH0:Games")')
    for (let i = 0; i < 8; i++) rt.frame()
    const d = [...rt.dialogs.values()][0]!
    const f = rt.fsel!
    d.vars[7] = 1 // sorted
    f.entries = [{ name: 'zeta', isDir: false, size: 0 }]
    f.pending = [{ name: 'alpha', isDir: false, size: 0 }]
    f.dirOn = true
    d.vars[10] = 4 // FsV_PList
    d.vars[25] = 0 // FsV_PosFirst pinned at the top
    fselNext(rt, f)
    expect(f.entries.map((e) => e.name)).toEqual(['alpha', 'zeta'])
    expect([d.vars[10], d.vars[25]]).toEqual([5, 1])
  })

  it('takes a second click on the same row as the double-click', () => {
    // Fs_Name (18280) compares the row index against Fs_Click — there is no
    // timer anywhere in the original, and any other row resets it
    const { rt, out } = bootFs('F$=Fsel$("DH0:Games")\nPrint F$')
    for (let i = 0; i < 8; i++) rt.frame()
    const d = [...rt.dialogs.values()][0]!
    const list = d.zones.find((z) => z.kind === 'list')!
    const s = rt.screens.get(Runtime.EC_FSEL)!
    const clickRow = (row: number): void => {
      rt.input.mouseX = s.displayX + ((list.x + 8) >> 1)
      rt.input.mouseY = s.displayY + list.y + row * 8 + 4
      rt.input.mouseK = 1
      rt.frame()
      rt.input.mouseK = 0
      rt.frame()
    }
    clickRow(1) // a file: name goes in the box, click remembered
    expect(rt.fsel!.click).toBe(1)
    for (let i = 0; i < 40; i++) rt.frame() // no timer to expire
    clickRow(1)
    for (let i = 0; i < 8 && rt.frame().status !== 'ended'; i++);
    expect(out()).toBe('DH0:Games/alpha.iff\n')
  })

  it('caches a directory and adopts it whole on the way back', () => {
    // Fs_Store (18528) puts the listing away; Fs_FindStore/Fs_Branch (18583/
    // 18564) take it back rather than reading the drawer again — and Branch
    // MOVES it out of the cache, which is what makes the list an LRU
    const { rt } = bootFs('F$=Fsel$("DH0:Games")')
    for (let i = 0; i < 8; i++) rt.frame()
    const f = rt.fsel!
    const d = [...rt.dialogs.values()][0]!
    expect(f.entries.length).toBe(3)
    // leaving DH0:Games stores it under the path it still has
    fselStore(rt, f, d)
    expect(rt.fselStore.map((e) => e.path)).toEqual(['DH0:Games'])
    // going back finds it cached: complete immediately, nothing left to read
    f.path = 'DH0:Games'
    fselFirst(rt, f)
    expect(f.dirOn).toBe(false)
    expect(f.pending.length).toBe(0)
    expect(f.entries.length).toBe(3)
    expect(rt.fselStore.length).toBe(0) // taken back out
  })

  it('keeps at most Fs_MaxStore directories', () => {
    const { rt } = bootFs('F$=Fsel$("DH0:Games")')
    for (let i = 0; i < 8; i++) rt.frame()
    const f = rt.fsel!
    const d = [...rt.dialogs.values()][0]!
    for (let i = 0; i < 14; i++) {
      f.path = `DH0:d${i}`
      f.entries = [{ name: 'x', isDir: false, size: 0 }]
      f.devFlag = 0
      fselStore(rt, f, d)
    }
    expect(rt.fselStore.length).toBe(FS_MAX_STORE)
    expect(rt.fselStore[0]!.path).toBe('DH0:d13') // most recent at the head
  })

  it('shows the cache as a list, tail-first when the path is long', () => {
    const { rt } = bootFs('F$=Fsel$("DH0:Games")')
    for (let i = 0; i < 8; i++) rt.frame()
    const f = rt.fsel!
    const d = [...rt.dialogs.values()][0]!
    d.vars[12] = 10 // FsV_Tx
    f.entries = [] // nothing live to put away first
    rt.fselStore = [
      { path: 'DH0:a/very/deep/drawer', filter: '', entries: [], scroll: 0, sorted: true },
      { path: 'DH0:s', filter: '', entries: [], scroll: 0, sorted: true },
    ]
    fselStoreList(rt, f, d)
    expect(f.devFlag).toBe(3)
    // Fs_StoreList (18169) shows the END of an over-long path
    expect(f.entries.map((e) => e.name)).toEqual(['eep/drawer', 'DH0:s'])
    expect(f.entries.every((e) => e.special)).toBe(true)
  })

  it('turning the Store toggle off empties the cache', () => {
    // Fs_BStore (18354) does not merely stop caching
    const { rt } = bootFs('F$=Fsel$("DH0:Games")')
    for (let i = 0; i < 8; i++) rt.frame()
    const d = [...rt.dialogs.values()][0]!
    rt.fselStore = [{ path: 'DH0:x', filter: '', entries: [], scroll: 0, sorted: true }]
    d.vars[16] = 0 // FsV_Store off
    fselJump(rt, rt.fsel!, d, 16)
    expect(rt.pi.FsStore).toBe(0)
    expect(rt.fselStore.length).toBe(0)
  })

  it('Del goes to the oldest stored directory and consumes it', () => {
    // Fs_SliDel (18382) -> Fs_StoDir (18364): NumStore(126) is the last
    // element, and visiting it takes it out of the cache
    const { rt } = bootFs('F$=Fsel$("DH0:Games")')
    for (let i = 0; i < 8; i++) rt.frame()
    const f = rt.fsel!
    const d = [...rt.dialogs.values()][0]!
    rt.fselStore = [
      { path: 'DH0:new', filter: '', entries: [{ name: 'n', isDir: false, size: 0 }], scroll: 0, sorted: true },
      { path: 'DH0:old', filter: '', entries: [{ name: 'o', isDir: false, size: 0 }], scroll: 0, sorted: true },
    ]
    fselJump(rt, f, d, 17)
    expect(f.path).toBe('DH0:old')
    expect(rt.fselStore.map((e) => e.path)).toEqual(['DH0:new'])
  })

  it('type-ahead jumps the list to the first matching file', () => {
    const { rt } = bootFs('F$=Fsel$("DH0:Games")')
    for (let i = 0; i < 8; i++) rt.frame()
    const f = rt.fsel!
    const d = [...rt.dialogs.values()][0]!
    d.vars[13] = 2 // FsV_Ty — two visible rows
    f.sorted = true
    f.entries = [
      { name: 'Deep', isDir: true, size: 0 },
      { name: 'alpha.iff', isDir: false, size: 0 },
      { name: 'beta.iff', isDir: false, size: 0 },
      { name: 'gamma.iff', isDir: false, size: 0 },
    ]
    const nameZone = d.zones.find((z) => z.number === 15 && z.kind === 'edit')!
    nameZone.text = 'be'
    fselJump(rt, f, d, 19)
    // row 2 scrolls to the top, and PosFirst is pinned with it — the only
    // place the original ever sets it
    expect([d.vars[10], d.vars[25]]).toEqual([2, 2])
  })

  it('type-ahead never matches a directory', () => {
    // Fs_Help prepends a space to the search and FillFFind folds the '*'
    // marker to chr(1), so a drawer can never be found by typing its name
    const { rt } = bootFs('F$=Fsel$("DH0:Games")')
    for (let i = 0; i < 8; i++) rt.frame()
    const f = rt.fsel!
    const d = [...rt.dialogs.values()][0]!
    f.sorted = true
    f.entries = [
      { name: 'alpha.iff', isDir: false, size: 0 },
      { name: 'Deep', isDir: true, size: 0 },
    ]
    d.vars[10] = 0
    d.vars[25] = -1
    const nameZone = d.zones.find((z) => z.number === 15 && z.kind === 'edit')!
    nameZone.text = 'Deep'
    fselJump(rt, f, d, 19)
    expect(d.vars[25]).toBe(-1) // nothing found, so nothing pinned
  })

  it('unsorted type-ahead searches on from the current position', () => {
    // ...and wraps to the top when that finds nothing, so pressing again
    // walks through the matches (17970)
    const { rt } = bootFs('F$=Fsel$("DH0:Games")')
    for (let i = 0; i < 8; i++) rt.frame()
    const f = rt.fsel!
    const d = [...rt.dialogs.values()][0]!
    d.vars[13] = 1
    f.sorted = false
    f.entries = [
      { name: 'a1', isDir: false, size: 0 },
      { name: 'b', isDir: false, size: 0 },
      { name: 'a2', isDir: false, size: 0 },
    ]
    const nameZone = d.zones.find((z) => z.number === 15 && z.kind === 'edit')!
    nameZone.text = 'a'
    d.vars[10] = 0
    fselJump(rt, f, d, 19) // from row 1 -> finds a2 at 2
    expect(d.vars[10]).toBe(2)
    fselJump(rt, f, d, 19) // from row 3 -> nothing below, wraps to a1 at 0
    expect(d.vars[10]).toBe(0)
  })

  it('double-clicking a file returns its full path', () => {
    const { rt, out } = bootFs('F$=Fsel$("DH0:Games")\nPrint F$')
    for (let i = 0; i < 5; i++) rt.frame()
    const d = [...rt.dialogs.values()][0]!
    const list = d.zones.find((z) => z.kind === 'list')!
    const s = rt.screens.get(Runtime.EC_FSEL)!
    // rows: dir "Deep" first, then alpha.iff, beta.iff — click row 1 twice
    rt.input.mouseX = s.displayX + ((list.x + 8) >> 1)
    rt.input.mouseY = s.displayY + list.y + 8 + 4
    rt.input.mouseK = 1
    rt.frame()
    rt.input.mouseK = 0
    rt.frame()
    const nameZone = d.zones.find((z) => z.number === 15 && z.kind === 'edit')!
    expect(nameZone.text).toBe('alpha.iff')
    rt.input.mouseK = 1
    rt.frame()
    rt.input.mouseK = 0
    for (let i = 0; i < 6 && rt.frame().status !== 'ended'; i++);
    expect(out()).toBe('DH0:Games/alpha.iff\n')
  })

  it('clicking a directory descends into it', () => {
    const { rt } = bootFs('F$=Fsel$("DH0:Games")\nPrint F$')
    for (let i = 0; i < 5; i++) rt.frame()
    const d = [...rt.dialogs.values()][0]!
    const list = d.zones.find((z) => z.kind === 'list')!
    const s = rt.screens.get(Runtime.EC_FSEL)!
    rt.input.mouseX = s.displayX + ((list.x + 8) >> 1)
    rt.input.mouseY = s.displayY + list.y + 4 // row 0 = the "Deep" dir
    rt.input.mouseK = 1
    rt.frame()
    rt.input.mouseK = 0
    rt.frame()
    expect(rt.fsel!.path).toBe('DH0:Games/Deep')
    expect(list.count).toBe(1) // gamma.abk
  })

  it('headless runs cancel the selector', () => {
    const { rt, out } = bootFs('F$=Fsel$("DH0:Games")\nPrint "got[";F$;"]"')
    const r = rt.runHeadless(500)
    expect(r.status).toBe('ended')
    expect(out()).toBe('got[]\n')
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

  it('IF runs (or skips) exactly its block, then continues (Dia_If)', () => {
    // true: the block runs, then execution continues after it
    const t = boot(['D$="SI32,16;IF1;[SV0,11;]SV1,99;EX;"', 'Dialog Open 1,D$,4', 'R=Dialog Run(1)', 'Print Vdialog(1,0);Vdialog(1,1)'].join('\n'))
    expect(t.rt.runHeadless(1_000).status).toBe('ended')
    expect(t.out()).toBe(' 11 99\n')
    // false: only the block is skipped
    const f = boot(['D$="SI32,16;IF0;[SV0,11;]SV1,99;EX;"', 'Dialog Open 1,D$,4', 'R=Dialog Run(1)', 'Print Vdialog(1,0);Vdialog(1,1)'].join('\n'))
    expect(f.rt.runHeadless(1_000).status).toBe('ended')
    expect(f.out()).toBe(' 0 99\n')
    // nested brackets inside the block are balanced during the skip
    const n = boot(['D$="SI32,16;IF0;[IF1;[SV0,5;]SV0,6;]SV1,7;EX;"', 'Dialog Open 1,D$,4', 'R=Dialog Run(1)', 'Print Vdialog(1,0);Vdialog(1,1)'].join('\n'))
    expect(n.rt.runHeadless(1_000).status).toBe('ended')
    expect(n.out()).toBe(' 0 7\n')
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

  it('edit zones: typing, Return reporting, Tab cycling (ED/LEd)', () => {
    const src = [
      'D$="SI160,32;BA0,0;ED1,0,0,10,20,\'AB\',1,2;ED2,0,10,10,20,\'\',1,2;RU0,0;EX;"',
      'Dialog Open 1,D$',
      'R=Dialog Run(1)',
      'Print R;Rdialog$(1,1);"/";Rdialog$(1,2)',
    ].join('\n')
    const { rt, out } = boot(src)
    for (let i = 0; i < 3; i++) rt.frame()
    const d = rt.dialogs.get(1)!
    expect(d.edited).toBe(d.zones[0]) // first edit active (Dia_EdFirst)
    rt.pressKey('C', 0x33)
    rt.frame()
    expect(d.zones[0]!.text).toBe('ABC')
    rt.pressKey('\t', 0x42) // Tab → next edit
    rt.frame()
    expect(d.edited).toBe(d.zones[1])
    rt.pressKey('X', 0x32)
    rt.frame()
    // exit via KY-free route: quit with a Return + a quit key is not set up,
    // so use the headless force-exit and read the collected texts
    const r = rt.runHeadless(200)
    expect(r.status).toBe('ended')
    expect(out()).toBe(' 0ABC/X\n')
  })

  it('digit zones accept only digits and parse via Rdialog (DI)', () => {
    const src = [
      'D$="SI160,16;BA0,0;DI4,0,0,8,37,1,1,2;RU0,0;EX;"',
      'Dialog Open 1,D$',
      'R=Dialog Run(1)',
      'Print Rdialog(1,4)',
    ].join('\n')
    const { rt, out } = boot(src)
    for (let i = 0; i < 3; i++) rt.frame()
    const d = rt.dialogs.get(1)!
    expect(d.zones[0]!.text).toBe('37') // flag bit0: initial value shown
    rt.pressKey('Z', 0x11) // filtered out
    rt.frame()
    rt.pressKey('5', 0x05)
    rt.frame()
    expect(d.zones[0]!.text).toBe('375')
    rt.runHeadless(200)
    expect(out()).toBe(' 375\n')
  })

  it('slider zones: track click steps, knob drag repositions (HS/Sl_Clic)', () => {
    const src = [
      'D$="SI160,32;BA0,0;HS9,10,10,100,10,40,10,100,5;[]RU0,0;EX;"',
      'Dialog Open 1,D$',
      'R=Dialog Run(1)',
      'Print Rdialog(1,9)',
    ].join('\n')
    const { rt, out } = boot(src)
    for (let i = 0; i < 3; i++) rt.frame()
    const d = rt.dialogs.get(1)!
    const z = d.zones[0]!
    expect(z.pos).toBe(40)
    // knob for pos=40/100 window 10 on span 99 sits around x 49..59
    // click the track LEFT of the knob: steps down by 5 while held
    rt.input.mouseX = 128 + 15 // screen x=15 → rel 5, well before the knob
    rt.input.mouseY = 50 + 15
    rt.input.mouseK = 1
    rt.frame()
    expect(z.pos).toBe(35)
    rt.frame()
    expect(z.pos).toBe(30) // repeats while held
    rt.input.mouseK = 0
    rt.frame()
    // drag the knob to the far right
    const m = { off: 0, len: 0 }
    void m
    rt.input.mouseX = 128 + 10 + 35 // on the knob (pos 30 → off ~29)
    rt.input.mouseK = 1
    rt.frame()
    expect(d.drag?.mode).toBe('drag')
    rt.input.mouseX = 128 + 10 + 99 // drag to the end
    rt.frame()
    expect(z.pos).toBe(90) // clamped to total-window
    rt.input.mouseK = 0
    rt.frame()
    rt.runHeadless(200)
    expect(out()).toBe(' 90\n')
  })

  it('list zones show Array() values, hover selects, click commits (AL/Dia_List)', () => {
    const src = [
      'Dim A(4)',
      'A(0)=11 : A(1)=22 : A(2)=33 : A(3)=44 : A(4)=55',
      'D$="SI160,64;BA0,0;AL6,0,0,8,4,0VA,0,0,1,2;[]RU0,0;EX;"',
      'Dialog Open 1,D$',
      'Vdialog(1,0)=Array(A(0))',
      'R=Dialog Run(1)',
      'Print R;Rdialog(1,6)',
    ].join('\n')
    const { rt, out } = boot(src)
    for (let i = 0; i < 5; i++) rt.frame()
    const d = rt.dialogs.get(1)!
    const z = d.zones[0]!
    expect(z.count).toBe(5)
    // hover row 2 → selection follows
    rt.input.mouseX = 128 + 10
    rt.input.mouseY = 50 + 17
    rt.frame()
    expect(z.sel).toBe(2)
    // click commits index 2
    rt.input.mouseK = 1
    rt.frame()
    rt.input.mouseK = 0
    expect(z.pos).toBe(2)
    rt.runHeadless(200)
    expect(out()).toBe(' 0 2\n')
  })

  it('hypertext zones render {[key]text} links and clicks fill the buffer (HT)', () => {
    const src = [
      'D$="SI320,32;BA0,0;HT8,0,0,38,2,0VA,0,4,1,2;[]RU0,0;EX;"',
      'Dialog Open 1,D$,4',
      'Vdialog$(1,0)="pick {[LOAD]Load} or {[9]Quit} now"+Chr$(10)+"second line"',
      'R=Dialog Run(1)',
      'Print Rdialog$(1,8);Rdialog(1,8)',
    ].join('\n')
    const { rt, out } = boot(src)
    for (let i = 0; i < 5; i++) rt.frame()
    const d = rt.dialogs.get(1)!
    const z = d.zones[0]!
    expect(z.htLines).toHaveLength(2)
    expect(z.htZones!.length).toBe(2)
    // "pick " = cells 0-4, then "Load" at cells 5-8
    const link = z.htZones![0]!
    expect(link.key).toBe('LOAD')
    rt.input.mouseX = 128 + link.x0 * 8 + 4
    rt.input.mouseY = 50 + 3
    rt.input.mouseK = 1
    rt.frame()
    rt.input.mouseK = 0
    expect(z.text).toBe('LOAD')
    rt.runHeadless(200)
    expect(out()).toBe('LOAD 0\n')
  })

  it('Dialog Box runs a quick channel synchronously and returns the exit', () => {
    const src = [
      'R=Dialog Box("SI64,32;BA0,0;BU1,0,0,20,20,0VA,0,1;[][BQ;]RU30,0;EX;",7)',
      'Print R',
    ].join('\n')
    const { rt, out } = boot(src)
    for (let i = 0; i < 5; i++) rt.frame()
    // the quick channel is live and waiting; v seeded var 0 → pos 7
    const d = [...rt.dialogs.values()][0]!
    expect(d.channel).toBeGreaterThanOrEqual(65536)
    expect(d.zones[0]!.pos).toBe(7)
    // click the quit button
    rt.input.mouseX = 128 + 5
    rt.input.mouseY = 50 + 5
    rt.input.mouseK = 1
    rt.frame()
    rt.input.mouseK = 0
    for (let i = 0; i < 6 && rt.frame().status !== 'ended'; i++);
    expect(out()).toBe(' 1\n')
    expect(rt.dialogs.size).toBe(0) // quick channel closed
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

// ---- fix-up pass: divergences found auditing the engine against +Lib.s ----

describe('audit fix-ups (verified against +Lib.s)', () => {
  it('divides with the dividend truncated to its sign-extended low word (Dia_FDiv 22990)', () => {
    expect(evl('17 5/')).toBe(3)
    // ext.l d1 happens BEFORE divs: 70000 & $FFFF = 4464, then / 2
    expect(evl('70000 2/')).toBe(2232)
    expect(evl('65536 2/')).toBe(0) // low word is 0
    // divs overflow (-32768 / -1) leaves the register unchanged
    expect(evl('32768NE 1NE/')).toBe(-32768)
  })

  it('AR/AS stack underflow is the parameter-count error, not a syntax error (22869/22891)', () => {
    expect(() => evl('AR')).toThrow(/number of parameters/)
    expect(() => evl('AS')).toThrow(/number of parameters/)
  })

  it('splits hypertext lines like the 68k scan — the CR-LF pairing at .C13 is dead code (22245)', () => {
    expect(splitHyperLines('A\nB')).toEqual(['A', 'B'])
    expect(splitHyperLines('A\n\rB')).toEqual(['A', 'B']) // a FOLLOWING CR merges
    expect(splitHyperLines('A\r\rB')).toEqual(['A', 'B'])
    expect(splitHyperLines('A\r\nB')).toEqual(['A', '', 'B']) // CRLF = two breaks
    expect(splitHyperLines('A\n')).toEqual(['A', '']) // .CFini always closes the last line
    expect(splitHyperLines('')).toEqual([''])
    expect(splitHyperLines('A\x1bxyB')).toEqual(['AB']) // ESC skips TWO chars (.CEsc)
  })

  it('prescan wants a true terminator after LA n and the UI param count (20104/20137)', () => {
    expect(() => prescanDialog('LA5;EX;')).not.toThrow()
    expect(() => prescanDialog('LA5-2;EX;')).toThrow(/syntax/)
    expect(() => prescanDialog('UIAB,2-;[]EX;')).toThrow(/syntax/)
  })

  it('prescan UI names take sign first chars and digit second chars (CCR classes, 20065-20071)', () => {
    expect(prescanDialog('UIU1,0;[]EX;').userInstrs.has('U1')).toBe(true)
    expect(prescanDialog('UI+A,0;[]EX;').userInstrs.has('+A')).toBe(true)
    expect(() => prescanDialog('UI1A,0;[]EX;')).toThrow(/syntax/) // digit first char: bmi .Synt
  })

  const nop = (): void => {}
  function mkDraw(log: string[]): DialogDraw {
    return {
      activate: nop, deactivate: nop, stamp: nop, copyRect: nop,
      setPen: nop, setBPen: nop, setOutlinePen: nop,
      rectFill: nop, outlineRect: nop, line: nop, ellipse: nop, plot: nop,
      text: nop, setWriting: nop, setLinePattern: nop, setFillPattern: nop,
      setFont: nop, grabBlock: () => null, putBlock: nop,
      clearKeys: nop, clearClicks: nop,
      editField: () => { log.push('edit') },
      textCells: () => { log.push('cells') },
      dialogSlider: () => { log.push('slider') },
    }
  }
  function mkZone(kind: DialogZone['kind'], number: number, over: Partial<DialogZone> = {}): DialogZone {
    return {
      kind, number, x: 0, y: 0, sx: 32, sy: 8, pos: 0, min: 0, max: 0,
      rdraw: 0, rchange: 0, zvar: 0, nowait: false, quit: false,
      changing: false, value: null, ...over,
    }
  }

  it('Dialog Update on a slider always redraws AND fires its change routine (ZUpdate .Sl 23966)', () => {
    const ch = new DialogChannel(1, 8, emptyRes)
    ch.script = 'XSV0,9;]' // change routine at offset 1
    const log: string[] = []
    const z = mkZone('slider', 3, { rchange: 1, quit: true })
    ch.zones.push(z)
    updateZone(ch, 3, null, null, null, host, mkDraw(log)) // fully elided
    expect(log).toContain('slider')
    expect(ch.vars[0]).toBe(9) // the change routine really ran
    expect(z.quit).toBe(false) // "Pas de sortie!"
  })

  it('Dialog Update reaches string edit fields; an int there is a bad pointer (.Ed 24002)', () => {
    const ch = new DialogChannel(1, 8, emptyRes)
    const log: string[] = []
    const z = mkZone('edit', 2, { maxLen: 8, text: 'OLD' })
    ch.zones.push(z)
    updateZone(ch, 2, 'NEW TEXT LONGER', null, null, host, mkDraw(log))
    expect(z.text).toBe('NEW TEXT')
    expect(log).toContain('edit')
    expect(() => updateZone(ch, 2, 42, null, null, host, mkDraw(log))).toThrow(/function call/)
  })

  it('Dialog Update skips hypertext entirely when the value is elided (.Tx 23993)', () => {
    const ch = new DialogChannel(1, 8, emptyRes)
    const log: string[] = []
    const z = mkZone('hyper', 4, { htLines: ['A', 'B'], rows: 2, quit: true })
    ch.zones.push(z)
    updateZone(ch, 4, null, null, null, host, mkDraw(log))
    expect(log).toEqual([]) // nothing drawn, quit untouched
    expect(z.quit).toBe(true)
    updateZone(ch, 4, 1, null, null, host, mkDraw(log))
    expect(z.scroll).toBe(1)
    expect(z.quit).toBe(false)
    expect(log.length).toBeGreaterThan(0)
  })
})

describe.skipIf(!existsSync(DEFAULT_ABK))('audit fix-ups: run semantics (Dia_Run/Dia_Tests)', () => {
  const table = new TokenTable(CORE_TOKENS)
  function boot(src: string): { rt: Runtime; out: () => string } {
    let out = ''
    const rt = new Runtime(tokenize(src, table), table, { maxSteps: 300_000, onText: (t) => (out += t) })
    rt.loadSystemResource(readFileSync(DEFAULT_ABK))
    return { rt, out: () => out }
  }

  it('digit fields edit window-width - 1 chars, and only RU activates an edit zone (22052/22699)', () => {
    const src = ['D$="SI160,32;BA0,0;DI1,8,8,9,42,1,0,1;EX;"', 'Dialog Open 1,D$', 'R=Dialog Run(1)'].join('\n')
    const { rt } = boot(src)
    expect(rt.runHeadless(1_000).status).toBe('ended')
    const d = rt.dialogs.get(1)!
    const z = d.zones[0]!
    expect(z.maxLen).toBe(9) // (9+1 rounded even) - 1
    expect(z.text).toBe('42')
    expect(d.edited).toBeNull() // no RU ran, so Dia_EdFirst never did either
  })

  it('HT leaves its line count in Dia_NextZone, readable via ZV (22276)', () => {
    const src = [
      'D$="BA0,0;HT1,0,0,10,3,0VA,0,0,0,1;[]SV1,ZV;EX;"',
      'Dialog Open 1,D$,8',
      'Vdialog$(1,0)="A"+Chr$(10)+"B"+Chr$(10)+"C"',
      'R=Dialog Run(1)',
      'Print Vdialog(1,1)',
    ].join('\n')
    const { rt, out } = boot(src)
    expect(rt.runHeadless(1_000).status).toBe('ended')
    expect(out()).toBe(' 3\n')
  })

  it('under RU flag bit 3 ANY press exits, even one that hit a zone (24346)', () => {
    const src = [
      'D$="SI64,32;BA0,0;BU1,0,0,64,16,0,0,3;[][]RU0,8;EX;"',
      'Dialog Open 1,D$',
      'R=Dialog Run(1)',
      'Print R',
    ].join('\n')
    const { rt, out } = boot(src)
    for (let i = 0; i < 5; i++) rt.frame()
    const d = rt.dialogs.get(1)!
    expect(d.runState).toBe('waiting')
    const s = rt.screens.get(0)!
    const z = d.zones[0]!
    rt.input.mouseX = s.displayX + ((z.x + 4) >> (s.hires ? 1 : 0))
    rt.input.mouseY = s.displayY + z.y + 4
    rt.input.mouseK = 1 // press ON the button — bit 3 must still exit
    rt.frame()
    rt.input.mouseK = 0
    for (let i = 0; i < 10 && rt.frame().status !== 'ended'; i++);
    expect(out()).toBe(' 1\n') // the button set the return before the exit
  })

  it('any press resets the RU timer (.Timer via bsr — the (sp) guard is always nonzero, 24360)', () => {
    const src = ['D$="SI64,32;BA0,0;RU25,0;EX;"', 'Dialog Open 1,D$', 'R=Dialog Run(1)', 'Print R'].join('\n')
    const { rt, out } = boot(src)
    for (let i = 0; i < 20; i++) rt.frame()
    expect(rt.dialogs.get(1)!.runState).toBe('waiting')
    rt.input.mouseK = 1 // a press at ~tick 20 restarts the 25-frame timer
    rt.frame()
    rt.input.mouseK = 0
    for (let i = 0; i < 12; i++) rt.frame()
    // tick ~33: the original deadline (25) has passed but the reset one has not
    expect(rt.dialogs.get(1)!.runState).toBe('waiting')
    for (let i = 0; i < 60 && rt.frame().status !== 'ended'; i++);
    expect(out()).toBe(' 0\n')
  })

  it('HT takes a raw ADDRESS of a NUL-terminated buffer (Dia_HyperText 22182, the AMOSProHelp path)', () => {
    const src = [
      'Reserve As Work 10,256',
      'Poke$ Start(10),"one"+Chr$(10)+"two"+Chr$(10)+"three"+Chr$(0)',
      'D$="BA0,0;HT1,0,0,10,3,0VA,0,0,0,1;[]SV1,ZV;EX;"',
      'Dialog Open 1,D$,8',
      'Vdialog(1,0)=Start(10)',
      'R=Dialog Run(1)',
      'Print Vdialog(1,1)',
    ].join('\n')
    const { rt, out } = boot(src)
    expect(rt.runHeadless(1_000).status).toBe('ended')
    expect(out()).toBe(' 3\n')
    // an address <= 1024 is `cmp.l #1*1024,d0 / Rble L_Dia_Fonc`
    const bad = ['D$="BA0,0;HT1,0,0,10,3,0VA,0,0,0,1;[]EX;"', 'Dialog Open 1,D$,8', 'Vdialog(1,0)=100', 'R=Dialog Run(1)'].join('\n')
    const { rt: rt2 } = boot(bad)
    expect(() => rt2.runHeadless(1_000)).toThrow(/dialog function call error/)
  })

  it('MZ copies raw memory until a below-space byte, capped at maxlen (Dia_FStZero 23171)', () => {
    const mk = (maxlen: number): string =>
      [
        'Reserve As Work 10,64',
        'Poke$ Start(10),"HELLO"+Chr$(10)+"XX"',
        `D$="BA0,0;SV1,0VA ${maxlen}MZ;EX;"`, // pushes addr, maxlen -> MZ
        'Dialog Open 1,D$,8',
        'Vdialog(1,0)=Start(10)',
        'R=Dialog Run(1)',
        'Print Vdialog$(1,1)',
      ].join('\n')
    const { rt, out } = boot(mk(20))
    expect(rt.runHeadless(1_000).status).toBe('ended')
    expect(out()).toBe('HELLO\n') // the LF stopped the copy
    const { rt: rt2, out: out2 } = boot(mk(3))
    expect(rt2.runHeadless(1_000).status).toBe('ended')
    expect(out2()).toBe('HEL\n') // maxlen cap
  })
})

describe.skipIf(!existsSync(DEFAULT_ABK))('Read Text (the ASCII reader over bank program 1)', () => {
  const table = new TokenTable(CORE_TOKENS)

  function boot(src: string, files: Record<string, string> = {}): { rt: Runtime; out: () => string } {
    const fs = new AmigaFS()
    const dh0 = fs.mountMemory('DH0')
    for (const [name, text] of Object.entries(files)) {
      dh0.write([name], Uint8Array.from([...text].map((c) => c.charCodeAt(0))))
    }
    fs.currentDir = 'DH0:'
    let out = ''
    const rt = new Runtime(tokenize(src, table), table, { maxSteps: 300_000, fs, onText: (t) => (out += t) })
    rt.loadSystemResource(readFileSync(DEFAULT_ABK))
    return { rt, out: () => out }
  }

  const reader = (rt: Runtime): DialogChannel => rt.dialogs.get(rt.readText!.chan)!

  /** click a hypertext segment by its keyword */
  function clickKeyword(rt: Runtime, key: string): void {
    const d = reader(rt)
    const z = d.zones.find((zz) => zz.kind === 'hyper')!
    const hz = z.htZones!.find((h) => h.key === key)!
    const s = rt.screens.get(d.screenNb)!
    rt.input.mouseX = s.displayX + ((z.x + hz.x0 * 8 + 2) >> (s.hires ? 1 : 0))
    rt.input.mouseY = s.displayY + z.y + hz.row * 8 + 2
    rt.input.mouseK = 1
    rt.frame()
    rt.input.mouseK = 0
    rt.frame()
  }

  it('opens bank program 1 on the EcFsel screen with the text, title and #HYP flag in vars 0-2', () => {
    const { rt } = boot('Read Text "DH0:doc.txt"\nPrint "R=";Param$;"."', { 'doc.txt': 'Alpha\nBeta\n' })
    for (let i = 0; i < 3; i++) rt.frame()
    expect(rt.readText).not.toBeNull()
    const d = reader(rt)
    // IRText +Lib.s:14790: Dia_RScOpen on EcFsel, then program 1 with 8 vars
    expect(d.screenNb).toBe(Runtime.EC_FSEL)
    expect(d.vars.length).toBe(8)
    expect(d.vars[0]).toBe(Runtime.TEMP_BUFFER_BASE) // var 0 = text base
    // var 1 = the title, default resource message 20 (Def_GetMessage)
    expect(d.vars[1]).toBe('AMOS Professional Text Reader')
    expect(d.vars[2]).toBe(0) // var 2 = no hypertext header
    // the script's HT zone split the file into lines
    const z = d.zones.find((zz) => zz.kind === 'hyper')!
    expect(z.number).toBe(5)
    expect(z.htLines!.slice(0, 2)).toEqual(['Alpha', 'Beta'])
  })

  it('a "#HYPn" header sets the mode in var 2 and moves the text base 8 bytes on (14771)', () => {
    // the real files carry exactly 8 header bytes: "#HYP2000" then the LF
    // (fixtures/official-amos/Productivity1/Equates/Equates.Doc)
    const { rt } = boot('Read Text "DH0:h.txt"', { 'h.txt': '#HYP2000\nOne\n' })
    for (let i = 0; i < 3; i++) rt.frame()
    const d = reader(rt)
    expect(d.vars[2]).toBe(2)
    expect(d.vars[0]).toBe(Runtime.TEMP_BUFFER_BASE + 8)
    const z = d.zones.find((zz) => zz.kind === 'hyper')!
    expect(z.htLines![1]).toBe('One')
  })

  it('clicking a hypertext keyword ends Read Text with it in Param$ (Dia_GetValue zone 5, .Copy 14875)', () => {
    const { rt, out } = boot('Read Text "DH0:h.txt"\nPrint "R=";Param$;"."', {
      'h.txt': '#HYP1000\nSee {[TOPIC,4,7]this bit} now\n',
    })
    for (let i = 0; i < 3; i++) rt.frame()
    const prev = rt.readText!.prevScreen
    clickKeyword(rt, 'TOPIC')
    expect(rt.runHeadless(200).status).toBe('ended')
    expect(out()).toBe('R=TOPIC.\n')
    // the reader screen closed and the old one came back (14895-14903)
    expect(rt.screens.has(Runtime.EC_FSEL)).toBe(false)
    expect(rt.currentIndex).toBe(prev)
    expect(rt.tempBuffer).toBeNull() // ResTempBuffer 0
  })

  it('quitting the reader leaves Param$ empty (Dia_GetReturn -1 once it stops being drawn)', () => {
    const { rt, out } = boot('Read Text "DH0:doc.txt"\nPrint "R=";Param$;"."', { 'doc.txt': 'Alpha\n' })
    for (let i = 0; i < 3; i++) rt.frame()
    const d = reader(rt)
    // zone 1 is the script's exit button: [BR0;BQ;]
    const z = d.zones.find((zz) => zz.number === 1 && zz.kind === 'button')!
    const s = rt.screens.get(d.screenNb)!
    rt.input.mouseX = s.displayX + ((z.x + 4) >> (s.hires ? 1 : 0))
    rt.input.mouseY = s.displayY + z.y + 4
    rt.input.mouseK = 1
    rt.frame()
    rt.input.mouseK = 0
    expect(rt.runHeadless(200).status).toBe('ended')
    expect(out()).toBe('R=.\n')
    expect(rt.dialogs.size).toBe(0)
  })

  it('with no screen open there is nothing to come back to (TRd_OldEc -1, 14783/14903)', () => {
    // the shape Editor_Commands.AMOS uses: Screen Close 0, then Read Text
    const { rt } = boot('Screen Close 0\nRead Text "DH0:doc.txt"\nA=1', { 'doc.txt': 'Alpha\n' })
    for (let i = 0; i < 3; i++) rt.frame()
    // no current screen, so nothing is stored to reactivate on the way out
    expect(rt.readText!.prevScreen).toBe(-1)
    expect(rt.screens.has(Runtime.EC_FSEL)).toBe(true)
    expect(() => rt.finishReadText('')).not.toThrow()
    expect(rt.screens.size).toBe(0)
    expect(rt.runHeadless(200).status).toBe('ended')
  })

  it('the three-parameter form reads text already in memory (InReadText3 14744)', () => {
    const src = [
      'Reserve As Work 10,64',
      'Poke$ Start(10),"Line one"+Chr$(10)+"Line two"',
      'Read Text "My Title",Start(10),40',
    ].join('\n')
    const { rt } = boot(src)
    for (let i = 0; i < 3; i++) rt.frame()
    const d = reader(rt)
    expect(d.vars[1]).toBe('My Title')
    expect(d.vars[0]).toBe(rt.bankBase(10))
    const z = d.zones.find((zz) => zz.kind === 'hyper')!
    expect(z.htLines!.slice(0, 2)).toEqual(['Line one', 'Line two'])
  })
})
