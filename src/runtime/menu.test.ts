import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseAmosFile } from '../loader/amosfile'
import { MenuTree, bankToMenu, compileMenuObject, menuToBank } from './menu'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { Runtime } from './runtime'
import { AmigaFS } from './vfs'

const FIXTURES = join(__dirname, '..', '..', 'fixtures')
const DATA_MENU = join(FIXTURES, 'official-amos', 'Tutorial', 'Tutorials', 'Menus', 'Data.Menu')

describe('menu label object compiler (MnObjet +Lib.s:17464)', () => {
  it('compiles plain text and embedded commands', () => {
    expect(compileMenuObject('Load')).toEqual([{ op: 'text', s: 'Load' }])
    expect(compileMenuObject('(IN 1,5)Hi(LO 0,8)there')).toEqual([
      { op: 'ink', sel: 1, c: 5 },
      { op: 'text', s: 'Hi' },
      { op: 'locate', x: 0, y: 8 },
      { op: 'text', s: 'there' },
    ])
  })

  it('takes only the first two letters and splits commands on ":"', () => {
    expect(compileMenuObject('(INk 1,3 : BAr 40,10)X')).toEqual([
      { op: 'ink', sel: 1, c: 3 },
      { op: 'bar', x: 40, y: 10 },
      { op: 'text', s: 'X' },
    ])
  })

  it('parses procedure names and set-style', () => {
    expect(compileMenuObject('(PR DRAWCLOCK)(SS 3)T')).toEqual([
      { op: 'proc', name: 'DRAWCLOCK' },
      { op: 'style', n: 3 },
      { op: 'text', s: 'T' },
    ])
  })
})

describe('menu bank codec (Menu To Bank +Lib.s:15401)', () => {
  it.skipIf(!existsSync(DATA_MENU))('loads the real tutorial Data.Menu bank', () => {
    const file = parseAmosFile(readFileSync(DATA_MENU))
    const bank = file.banks.find((b) => b.kind === 'memory' && /^menu/i.test(b.name))!
    expect(bank.kind).toBe('memory')
    const tree = new MenuTree()
    bankToMenu(tree, (bank as { data: Uint8Array }).data)
    expect(tree.roots.length).toBeGreaterThan(0)
    // the tutorial menu's first title label is "PICTURE  "
    const first = tree.roots[0]!
    const text = first.ob1?.find((o) => o.op === 'text')
    expect(text && 'PICTURE  '.startsWith((text as { s: string }).s.slice(0, 7))).toBe(true)
    // items exist below the titles
    expect(tree.roots.some((n) => n.children.length > 0)).toBe(true)
  })

  it('round-trips a tree through the bank format', () => {
    const tree = new MenuTree()
    const t = tree.insert([1])
    t.ob1 = compileMenuObject('(IN 1,3)File')
    const i = tree.insert([1, 1])
    i.ob1 = compileMenuObject('Load')
    i.key = { kind: 1, asc: 76, scan: 0, shift: 0 }
    const sub = tree.insert([1, 1, 2])
    sub.ob1 = compileMenuObject('(BA 20,8)')
    const data = menuToBank(tree)
    const back = new MenuTree()
    bankToMenu(back, data)
    expect(back.roots).toHaveLength(1)
    expect(back.roots[0]!.ob1).toEqual(t.ob1)
    expect(back.roots[0]!.children[0]!.ob1).toEqual([{ op: 'text', s: 'Load' }])
    expect(back.roots[0]!.children[0]!.key.asc).toBe(76)
    expect(back.roots[0]!.children[0]!.children[0]!.ob1).toEqual([{ op: 'bar', x: 20, y: 8 }])
  })
})

describe('menu interaction', () => {
  const table = new TokenTable(CORE_TOKENS)

  function boot(src: string): { rt: Runtime; out: () => string } {
    const fs = new AmigaFS()
    fs.mountMemory('DH0')
    let out = ''
    const rt = new Runtime(tokenize(src, table), table, { maxSteps: 300_000, fs, onText: (t) => (out += t) })
    return { rt, out: () => out }
  }

  it('cascades into third-level submenus opening to the right', () => {
    const src = [
      'Menu$(1)="A" : Menu$(1,1)="B" : Menu$(1,1,1)="C1" : Menu$(1,1,2)="C2"',
      'Menu On',
      'Do : If Choice Then Print Choice(1);Choice(2);Choice(3)',
      ' Wait Vbl : Loop',
    ].join('\n')
    const { rt, out } = boot(src)
    for (let i = 0; i < 3; i++) rt.frame()
    rt.input.mouseK = 2
    rt.input.mouseX = 128 + 3
    rt.input.mouseY = 50 + 3
    rt.frame()
    const item = rt.menuOpen!.levels[1]!.lvl.list[0]!
    rt.input.mouseX = 128 + item.xx + 2
    rt.input.mouseY = 50 + item.yy + 2
    rt.frame()
    expect(rt.menuOpen!.levels).toHaveLength(3) // sub-list opened to the right
    const c2 = rt.menuOpen!.levels[2]!.lvl.list[1]!
    expect(c2.xx).toBeGreaterThan(item.xx) // opens rightward (MnBar parent)
    rt.input.mouseX = 128 + c2.xx + 2
    rt.input.mouseY = 50 + c2.yy + 2
    rt.frame()
    rt.input.mouseK = 0
    for (let i = 0; i < 4; i++) rt.frame()
    expect(out()).toContain(' 1 1 2')
  })

  it('release outside every cell aborts with Choice 0', () => {
    const src = ['Menu$(1)="A" : Menu$(1,1)="B"', 'Menu On', 'Do : If Choice Then Print "HIT"', ' Wait Vbl : Loop'].join('\n')
    const { rt, out } = boot(src)
    for (let i = 0; i < 3; i++) rt.frame()
    rt.input.mouseK = 2
    rt.input.mouseX = 128 + 3
    rt.input.mouseY = 50 + 3
    rt.frame()
    rt.input.mouseX = 128 + 200 // far away
    rt.input.mouseY = 50 + 150
    rt.frame()
    rt.input.mouseK = 0
    for (let i = 0; i < 4; i++) rt.frame()
    expect(out()).toBe('')
    expect(rt.menu.choix[0]).toBe(0)
  })

  it('inactive items cannot be selected; the background restores on close', () => {
    const src = [
      'Ink 6 : Bar 0,0 To 100,40',
      'Menu$(1)="A" : Menu$(1,1)="B"',
      'Menu Inactive(1,1)',
      'Menu On',
      'Do : Wait Vbl : Loop',
    ].join('\n')
    const { rt } = boot(src)
    for (let i = 0; i < 3; i++) rt.frame()
    rt.input.mouseK = 2
    rt.input.mouseX = 128 + 3
    rt.input.mouseY = 50 + 3
    rt.frame()
    const item = rt.menuOpen!.levels[1]!.lvl.list[0]!
    rt.input.mouseX = 128 + item.xx + 2
    rt.input.mouseY = 50 + item.yy + 2
    rt.frame()
    expect(rt.menuOpen!.active).not.toBe(item) // inactive cells refuse the mouse
    rt.input.mouseK = 0
    for (let i = 0; i < 3; i++) rt.frame()
    expect(rt.screens.get(0)!.point(50, 20)).toBe(6) // background restored
  })

  it('Menu Key fires a selection without opening (MenuKeyExplore)', () => {
    const src = [
      'Menu$(1)="A" : Menu$(1,1)="Load" : Menu$(1,2)="Save"',
      'Menu Key(1,2) To "S"',
      'Menu On',
      'Do : If Choice Then Print Choice(1);Choice(2)',
      ' Wait Vbl : Loop',
    ].join('\n')
    const { rt, out } = boot(src)
    for (let i = 0; i < 3; i++) rt.frame()
    rt.pressKey('s', 0x21)
    for (let i = 0; i < 4; i++) rt.frame()
    expect(out()).toContain(' 1 2')
  })

  it('Menu Item Movable items drag with the left button (MnBGoch)', () => {
    const src = [
      'Menu$(1)="A" : Menu$(1,1)="Long item"',
      'Menu Item Movable 2',
      'Menu On',
      'Do : Wait Vbl : Loop',
    ].join('\n')
    const { rt } = boot(src)
    for (let i = 0; i < 3; i++) rt.frame()
    rt.input.mouseK = 2
    rt.input.mouseX = 128 + 3
    rt.input.mouseY = 50 + 3
    rt.frame()
    const item = rt.menuOpen!.levels[1]!.lvl.list[0]!
    const beforeX = item.x
    rt.input.mouseX = 128 + item.xx + 2
    rt.input.mouseY = 50 + item.yy + 2
    rt.frame()
    rt.input.mouseK = 3 // LMB grabs while RMB stays held
    rt.frame()
    rt.input.mouseX += 10
    rt.frame()
    expect(item.x).toBe(beforeX + 10)
    expect(item.flags & 2).toBe(2) // MnFixed set by the drag
    rt.input.mouseK = 0
    rt.frame()
  })

  it('Menu Base moves the bar; X/Y Menu read positions', () => {
    const src = [
      'Menu$(1)="AB" : Menu$(2)="CD"',
      'Menu Base 40,20',
      'Menu Calc',
      'Print X Menu(2)>0',
      'Menu On',
      'Do : Wait Vbl : Loop',
    ].join('\n')
    const { rt, out } = boot(src)
    for (let i = 0; i < 3; i++) rt.frame()
    expect(out()).toBe('-1\n')
    rt.input.mouseK = 2
    rt.input.mouseX = 128 + 45
    rt.input.mouseY = 50 + 23
    rt.frame()
    expect(rt.menuOpen).not.toBeNull()
    const title = rt.menuOpen!.levels[0]!.lvl.list[0]!
    expect(title.yy).toBeGreaterThanOrEqual(20) // bar moved to Menu Base
  })
})
