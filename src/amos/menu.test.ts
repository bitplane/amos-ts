import { describe, expect, it } from 'vitest'
import { Amos } from './amos'
import { EditorMenu } from './menu'
import { EDM_DEFINITION, EDM_MESSAGES } from '../runtime/edmessages.gen'
import { readMenuDefs } from '../editor/menus'
import { MF_OFF } from '../runtime/menu'
import { ED } from '../editor/commands'

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
