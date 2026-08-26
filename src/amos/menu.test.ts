import { describe, expect, it } from 'vitest'
import { Amos } from './amos'
import { EditorMenu } from './menu'
import { EDM_DEFINITION, EDM_MESSAGES } from '../runtime/edmessages.gen'
import { readMenuDefs } from '../editor/menus'
import { MF_OFF } from '../runtime/menu'
import { ED } from '../editor/commands'
import { messages as configMessages } from '../editor/config'

function boot(source = 'Print "A"'): Amos {
  const amos = new Amos(source, { requesters: false })
  amos.openDisplay()
  return amos
}

/** what a node's label reads, out of the compiled display object */
function label(n: { ob1: unknown }): string {
  const ops = (n.ob1 ?? []) as Array<{ op: string; s?: string }>
  return ops.filter((o) => o.op === 'text').map((o) => o.s ?? '').join('')
}

describe('the editor s menu bar, which is EdM_Definition walked', () => {
  it('is 199 records in step with 196 labels, three of them stars', () => {
    // `bin/Editor_Menus.bin` beside `bin/Editor_Menus.asc`. `EdM_Init`
    // (+Edit.s:12579) steps the record by 8 and the message by its own length
    // and only then tests for "*", so a star takes no label with it.
    expect(EDM_DEFINITION.length).toBe(199 * 8 + 1)
    const sections = readMenuDefs(EDM_DEFINITION, EDM_MESSAGES)
    expect(sections.length).toBe(4)
    expect(sections.reduce((n, m) => n + m.length, 0)).toBe(196)
    expect(EDM_MESSAGES.length).toBe(196)
  })

  it('builds the Project menu, with Run under it where the records say', () => {
    const amos = boot()
    const t = amos.runtime!.menu
    expect(t.on).toBe(true)
    expect(t.screenNb).toBe(9)
    const project = t.find([2])!
    expect(project).toBeDefined()
    expect(label(project)).toBe(' Project ')
    expect(label(t.find([2, 1])!)).toBe(' Run         ')
    expect(label(t.find([2, 2])!)).toBe(' Test        ')
  })

  /**
   * Help is nineteen entries and every one of them runs `AMOSPro_Help.AMOS`,
   * which needs `AMOSPro_Help.Map` and `.Txt` beside it -- 318KB of Europress
   * material this port does not ship. See `PORT_MENU_HIDDEN` in
   * ../editor/branding.ts.
   */
  it('does not build the Help branch, title and all', () => {
    const amos = boot()
    const t = amos.runtime!.menu
    // the records are still there, so what is skipped is the building of them
    const defs = readMenuDefs(EDM_DEFINITION, EDM_MESSAGES)[0]!
    expect(defs.some((r) => r.path.join('.') === '8')).toBe(true)
    expect(defs.filter((r) => r.path[0] === 8).length).toBe(20)
    // and nothing under 8 reached the tree, including the node itself: `MnIns`
    // creates every node on a path, so a skipped title with its entries built
    // anyway would leave an unlabelled menu on the bar
    expect(t.find([8])).toBeNull()
    expect(t.find([8, 1])).toBeNull()
    expect(amos.menu.chosen([8, 1, 0, 0])).toBe(-1)
    // the neighbours on either side are untouched
    expect(label(t.find([7])!)).toBe(' User ')
    expect(label(t.find([10])!)).toBe(' AMOS ')
  })

  /**
   * The User branch is stamped by `EdM_Init` (+Edit.s:12645) and has no
   * records in `EdM_Definition` at all, which is why the accessories were
   * nowhere: nothing in the editor names the Object Editor, `EdM_User` does.
   */
  it('stamps the User branch out of EdM_User, where the accessories are', () => {
    const amos = boot()
    const t = amos.runtime!.menu
    expect(label(t.find([7, 1])!)).toBe(' Edit Objects   ')
    expect(label(t.find([7, 2])!)).toBe(' Edit Icons     ')
    expect(label(t.find([7, 7])!)).toBe(' Object Ed.     ')
    expect(label(t.find([7, 13])!)).toBe(' Compile        ')
    // `move.b d7,(a1) / add.b #"0"+EdM_UserCommands-1,(a1)+`
    expect(amos.menu.chosen([7, 1, 0, 0])).toBe(115)
    expect(amos.menu.chosen([7, 7, 0, 0])).toBe(121)
    // an empty message builds nothing: `clr.b (a1)` leaves the label empty and
    // `EdM_CreObjet` opens `tst.b (a4) / beq .Skip`
    expect(t.find([7, 5])).toBeNull()
    expect(t.find([7, 10])).toBeNull()
    expect(t.find([7, 14])).toBeNull()
    // and the shipped records further down the same menu still land
    expect(label(t.find([7, 26])!)).toBe(' Add Option     ')
  })

  it('binds each of them to a program, which is what makes one do anything', () => {
    // `.Ed_AutoLoad` (+Editor_Config.s:67) is the other half: the label is in
    // `EdM_User` and the program is here, indexed by the same command number
    const amos = boot()
    const table = amos.editor.config.autoLoad
    const progs = configMessages(amos.editor.config.texts.programs)
    const bound = (cmd: number): [string, string] => [
      progs[table[(cmd - 1) * 3 + 1]! - 1] ?? '',
      progs[table[(cmd - 1) * 3 + 2]! - 1] ?? '',
    ]
    expect(bound(115)).toEqual(['AMOSPro_Accessories:Object_Editor.AMOS', 'GRABO'])
    expect(bound(116)).toEqual(['AMOSPro_Accessories:Object_Editor.AMOS', 'GRABI'])
    expect(bound(121)).toEqual(['AMOSPro_Accessories:Object_Editor.AMOS', ''])
    expect(bound(126)).toEqual(['AMOSPro_Compiler:Compiler_Shell.AMOS', ''])
  })

  it('turns a chosen path back into a JFonc number', () => {
    // `Ed_MnGere`'s tail (:1657) walks `EdM_Table` for the record whose path
    // matches `MnChoix`, and hands the command to `Ed_FCall`
    const amos = boot()
    expect(amos.menu.chosen([2, 1, 0, 0])).toBe(ED.RUN)
    expect(amos.menu.chosen([2, 2, 0, 0])).toBe(ED.TEST)
    // a title and a separator have no command: `.NoChoix`
    expect(amos.menu.chosen([2, 0, 0, 0])).toBe(-1)
    expect(amos.menu.chosen([2, 5, 0, 0])).toBe(-1)
  })

  it('marks a separator inactive, because byte 0 is the flag as well', () => {
    // `EdM_CreObjet` passes byte 0 to `EdM_ObCree` as "actif / inactif" and
    // reads it as the command, so a rule across the menu and an entry that
    // cannot be chosen are the same record
    const amos = boot()
    const t = amos.runtime!.menu
    expect(t.find([2, 5])!.flags & MF_OFF).toBeTruthy()
    expect(t.find([2, 1])!.flags & MF_OFF).toBeFalsy()
  })

  it('gives an entry the ink pair EdM_ObCree writes, A and B swapped', () => {
    //     move.b d0,MnInkA1 / move.b d1,MnInkB1 / move.b d0,MnInkC1
    //     move.b d1,MnInkA2 / move.b d0,MnInkB2 / move.b d0,MnInkC2
    const amos = boot()
    const e = readMenuDefs(EDM_DEFINITION, EDM_MESSAGES)[0]!.find((r) => r.path.join('.') === '2.1')!
    const n = amos.runtime!.menu.find([2, 1])!
    expect(n.inks1).toEqual([e.inkA, e.inkB, e.inkA])
    expect(n.inks2).toEqual([e.inkB, e.inkA, e.inkA])
  })

  it('runs the command the pick names, which is Ed_FCall with d1 zero', () => {
    const amos = boot()
    const t = amos.runtime!.menu
    // the monitor, which answers 222 with nothing to load
    t.choice = -1
    t.choix = [2, 4, 0, 0, 0, 0, 0, 0]
    expect(amos.pollMenu()).toBe(222)
    expect(t.choice).toBe(0)
  })

  it('leaves the right button to the menu, so it never reaches a window zone', () => {
    // `Ed_Mouse`'s `btst #1,d7 / beq.s .NoMenu` is its FIRST test and the
    // menu path ends the routine
    const amos = boot('Print "ONE"')
    amos.mouse(6 * 8, 16 + 11, 2)
    expect([amos.window.xCu, amos.window.yCu]).toEqual([0, 0])
    amos.mouse(6 * 8, 16 + 11, 1)
    expect([amos.window.xCu, amos.window.yCu]).toEqual([6, 0])
  })

  it('exposes the AMOS branch, and its About entries', () => {
    const amos = boot()
    const t = amos.runtime!.menu
    expect(EditorMenu.AMOS_BRANCH).toBe(10)
    expect(label(t.find([10])!)).toBe(' AMOS ')
    expect(amos.menu.chosen([10, 1, 0, 0])).toBe(150) // About AMOS Professionnal
  })
})
