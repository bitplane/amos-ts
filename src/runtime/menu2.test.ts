import { describe, expect, it } from 'vitest'
import { mustFinish } from '../testing/run'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/source'
import { Runtime } from './runtime'
import { MF_BAR, MF_BOUGE, MF_FIXED, MF_OFF, MF_SEP, MF_TBOUGE, MF_TOTAL } from './menu'
import { amosErrorCode, type AmosError } from '../interp/values'

const table = new TokenTable(CORE_TOKENS)

function run(src: string): Runtime {
  const rt = new Runtime(tokenize(src, table), table, { maxSteps: 300_000 })
  const r = rt.runHeadless(1_000)
  mustFinish(r)
  return rt
}

function runOut(src: string): string {
  let out = ''
  const rt = new Runtime(tokenize(src, table), table, { maxSteps: 300_000, onText: (t) => (out += t) })
  const r = rt.runHeadless(1_000)
  mustFinish(r)
  return out
}

/** A two-level menu: two titles, each with two items. */
const MENU = [
  'Menu$(1)="File" : Menu$(1,1)="Load" : Menu$(1,2)="Save"',
  'Menu$(2)="Edit" : Menu$(2,1)="Cut" : Menu$(2,2)="Copy"',
].join('\n')

describe('menu level layout flags (+Lib.s:15682)', () => {
  it('Menu Bar, Menu Line and Menu Tline are mutually exclusive styles', () => {
    // Bar sets MF_BAR; Line clears both BAR and TOTAL; Tline sets TOTAL and
    // clears BAR — so a level is never left claiming two layouts at once.
    // setLevelFlag indexes dFlags by level-1 and touches nothing else.
    let rt = run(`${MENU}\nMenu Bar 2`)
    expect(rt.menu.dFlags[1]! & MF_BAR).toBe(MF_BAR)
    rt = run(`${MENU}\nMenu Bar 2 : Menu Line 2`)
    expect(rt.menu.dFlags[1]! & (MF_BAR | MF_TOTAL)).toBe(0)
    rt = run(`${MENU}\nMenu Bar 2 : Menu Tline 2`)
    expect(rt.menu.dFlags[1]! & MF_TOTAL).toBe(MF_TOTAL)
    expect(rt.menu.dFlags[1]! & MF_BAR).toBe(0)
  })

  it('Menu Movable and Menu Static toggle the level drag flag', () => {
    expect(run(`${MENU}\nMenu Movable 1`).menu.dFlags[0]! & MF_TBOUGE).toBe(MF_TBOUGE)
    expect(run(`${MENU}\nMenu Movable 1 : Menu Static 1`).menu.dFlags[0]! & MF_TBOUGE).toBe(0)
  })

  it('Menu Item Static clears the per-item drag flag', () => {
    const rt = run(`${MENU}\nMenu Item Movable 1 : Menu Item Static 1`)
    expect(rt.menu.dFlags[0]! & MF_BOUGE).toBe(0)
    expect(run(`${MENU}\nMenu Item Movable 1`).menu.dFlags[0]! & MF_BOUGE).toBe(MF_BOUGE)
  })

  it('a level flag is a template for later menus, not a sweep over this one', () => {
    /*
     * MnDFlags is read in exactly two places: MnIF (+Lib.s:17260) ORs the
     * level's byte into a node it is creating, and MenuReset (+Lib.s:17282)
     * writes the defaults. Nothing reads it when drawing. So the order the
     * program writes its lines in decides what happens, and the port had
     * been walking the tree to make the order stop mattering.
     */
    const after = run(`${MENU}\nMenu Item Movable 2`)
    expect(after.menu.find([1, 1])!.flags & MF_BOUGE).toBe(0)
    const before = run(`Menu Item Movable 2\n${MENU}`)
    expect(before.menu.find([1, 1])!.flags & MF_BOUGE).toBe(MF_BOUGE)
    // the path form reaches one node and leaves the level default alone
    const one = run(`${MENU}\nMenu Item Movable(1,1)`)
    expect(one.menu.find([1, 1])!.flags & MF_BOUGE).toBe(MF_BOUGE)
    expect(one.menu.find([1, 2])!.flags & MF_BOUGE).toBe(0)
    expect(one.menu.dFlags[1]! & MF_BOUGE).toBe(0)
  })

  it('a level outside 1 to MnNDim is error 23, and a missing path is 39', () => {
    // MnDim +ILib.s:6974: `tst.l d3 / beq FonCall / cmp.l #MnNDim,d3 / bhi
    // FonCall`, with MnNDim equ 8 (+Equ.s:1400)
    const code = (src: string): number => {
      try {
        run(`${MENU}\n${src}`)
        return 0
      } catch (e) {
        return amosErrorCode(e as AmosError)
      }
    }
    for (const kw of ['Menu Bar', 'Menu Line', 'Menu Tline', 'Menu Movable', 'Menu Static', 'Menu Item Movable', 'Menu Item Static', 'Menu Active', 'Menu Inactive', 'Menu Separate']) {
      expect([kw, code(`${kw} 0`)]).toEqual([kw, 23])
      expect([kw, code(`${kw} 9`)]).toEqual([kw, 23])
      expect([kw, code(`${kw} -1`)]).toEqual([kw, 23])
      expect([kw, code(`${kw} 8`)]).toEqual([kw, 0])
    }
    expect(code('Menu Bar(9,9)')).toBe(39)
    expect(code('Menu Bar(1,1)')).toBe(0)
  })

  it('every level but the first starts out title-movable', () => {
    // MenuReset (+Lib.s:17282) sets MnTBouge on level 1 and again in the
    // "Autres dimensions" loop for the other seven
    const rt = run(MENU)
    expect(rt.menu.dFlags[0]! & MF_TBOUGE).toBe(MF_TBOUGE)
    for (let i = 1; i < 8; i++) expect([i, rt.menu.dFlags[i]! & MF_TBOUGE]).toEqual([i, MF_TBOUGE])
  })
})

describe('menu node flags', () => {
  it('Menu Inactive greys an entry and Menu Active restores it', () => {
    let rt = run(`${MENU}\nMenu Inactive(1,1)`)
    expect(rt.menu.find([1, 1])!.flags & MF_OFF).toBe(MF_OFF)
    rt = run(`${MENU}\nMenu Inactive(1,1) : Menu Active(1,1)`)
    expect(rt.menu.find([1, 1])!.flags & MF_OFF).toBe(0)
  })

  it('Menu Separate draws a dividing line above an entry, Menu Link removes it', () => {
    let rt = run(`${MENU}\nMenu Separate(1,2)`)
    expect(rt.menu.find([1, 2])!.flags & MF_SEP).toBe(MF_SEP)
    rt = run(`${MENU}\nMenu Separate(1,2) : Menu Link(1,2)`)
    expect(rt.menu.find([1, 2])!.flags & MF_SEP).toBe(0)
  })

  it('Menu Called latches an entry as already reported; Menu Once clears it', () => {
    expect(run(`${MENU}\nMenu Called(1,1)`).menu.find([1, 1])!.called).toBe(true)
    expect(run(`${MENU}\nMenu Called(1,1) : Menu Once(1,1)`).menu.find([1, 1])!.called).toBe(false)
  })
})

describe('menu structure', () => {
  it('Menu Del removes one branch, and the whole tree when given no path', () => {
    // InMenuDel +ILib.s:6925
    let rt = run(`${MENU}\nMenu Del(2)`)
    expect(rt.menu.find([2])).toBeNull()
    expect(rt.menu.find([1])).toBeDefined()
    rt = run(`${MENU}\nMenu Del`)
    expect(rt.menu.find([1])).toBeNull()
    expect(rt.menu.find([2])).toBeNull()
  })

  it('Set Menu pins an entry to a fixed position (InSetMenu +ILib.s:6944)', () => {
    const rt = run(`${MENU}\nSet Menu(1,1) To 40,90`)
    const node = rt.menu.find([1, 1])!
    expect([node.x, node.y]).toEqual([40, 90])
    expect(node.flags & MF_FIXED).toBe(MF_FIXED)
  })

  it('X Menu and Y Menu read back an entry position', () => {
    expect(runOut(`${MENU}\nSet Menu(1,2) To 12,34\nPrint X Menu(1,2);Y Menu(1,2)`)).toBe(' 12 34\n')
    // FnYMenu (+Lib.s:15627) opens `Rjsr L_MnDim`, whose path form ends at
    // MnINDef when MnFind comes back empty — `moveq #39,d0 / bra.s RunErr`
    // (+ILib.s:1147), so "Menu item not defined" and not a zero
    expect(() => runOut(`${MENU}\nPrint Y Menu(9,9)`)).toThrow(/Menu item not defined/)
  })
})

describe('menu banks', () => {
  it('Menu To Bank and Bank To Menu round-trip the tree (+Lib.s:15401/15494)', () => {
    const rt = run(
      [MENU, 'Set Menu(1,1) To 7,8', 'Menu To Bank 4', 'Menu Del', 'Bank To Menu 4'].join('\n'),
    )
    expect(rt.menu.find([1])).toBeDefined()
    expect(rt.menu.find([2, 2])).toBeDefined()
    const node = rt.menu.find([1, 1])!
    expect([node.x, node.y]).toEqual([7, 8])
  })

  it('Menu To Bank writes a bank named "Menu"', () => {
    const rt = run(`${MENU}\nMenu To Bank 4`)
    expect(rt.memBanks.get(4)!.name.trim()).toBe('Menu')
  })

  it('Bank To Menu refuses a bank that is not a menu bank', () => {
    expect(() => run('Reserve As Work 4,100\nBank To Menu 4')).toThrow(/bank not reserved/)
    expect(() => run('Bank To Menu 9')).toThrow(/bank not reserved/)
  })
})

describe('menu event control', () => {
  it('Menu Off disables the menu without destroying it', () => {
    const rt = run(`${MENU}\nMenu On\nMenu Off`)
    expect(rt.menu.on).toBe(false)
    expect(rt.menu.find([1])).toBeDefined()
  })

  it('Menu Mouse On/Off gate mouse activation', () => {
    expect(run(`${MENU}\nMenu Mouse Off`).menu.mouse).toBe(false)
    expect(run(`${MENU}\nMenu Mouse Off : Menu Mouse On`).menu.mouse).toBe(true)
  })

  it('On Menu Off suspends the handler and On Menu Del forgets it', () => {
    // both must run cleanly with a handler installed, leaving the tree intact
    const prog = [MENU, 'On Menu Gosub H,H', 'On Menu Off', 'On Menu Del', 'End', 'H:', 'Return'].join(
      '\n',
    )
    const rt = run(prog)
    expect(rt.menu.find([1])).toBeDefined()
  })

  it('On Menu needs a Goto, Gosub or Proc target', () => {
    // V1_OnMenu (+Verif.s:1061) tests for _TkGto, _TkGsb and _TkPrc and
    // falls through to VerSynt for anything else
    expect(() => run(`${MENU}\nOn Menu Print "x"`)).toThrow(/Syntax error/)
  })
})
