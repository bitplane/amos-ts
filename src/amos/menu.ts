/**
 * `EdM_Init` (+Edit.s:12579) and `Ed_MnGere` (:1639): the editor's menu bar.
 *
 * The menus are not written in the editor and they are not drawn by it
 * either. They are two blocks of the configuration -- `EdM_Definition`, one
 * eight-byte record per entry, and `EdM_Messages`, one label per record --
 * and `EdM_Init` walks the two in step handing each pair to `EdM_ObCree`,
 * which builds an ordinary AMOS MENU object with `L_MnFind` and `L_MnIns`.
 *
 * So the editor's menu bar is the same menu system `Menu$` gives a program,
 * and `src/runtime/menu.ts` is that system. What is here is the walk, the
 * ink pairs `EdM_ObCree` writes, and the table that turns a chosen path back
 * into a command number for `Ed_FCall`.
 *
 * The right mouse button is how it comes up, and that is `Ed_Mouse`'s first
 * test (:1249):
 *
 *     btst    #1,d7
 *     beq.s   .NoMenu
 *     bsr     Ed_MnGere
 *     beq     Ed_MEnd
 *     bmi.s   .Err
 *     moveq   #0,d1
 *     bsr     Ed_FCall
 *
 * A menu pick ends the routine, so bit 1 never reaches the window zones.
 */
import { MF_OFF, MenuTree, compileMenuObject } from '../runtime/menu'
import { EDM_DEFINITION, EDM_MESSAGES } from '../runtime/edmessages.gen'
import { EDM_HIDDEN_MAX, readMenuDefs, hiddenPage, type MenuEntry } from '../editor/menus'
import { PORT_MENU_LABELS } from '../editor/branding'
import type { Editor } from '../editor/windows'

/** `HiddenCommands` (+Edit.s:3262): where the per-program entries start */
const HIDDEN_COMMANDS = 184

/**
 * The four sections `EdM_Init`'s star records divide the block into.
 *
 * The first is the fixed menu. The other three are the AMOS branch, and
 * `EdM_BranchAMOS` (:12758) rebuilds it from the window list every time the
 * hidden programs change: the head, then one entry per program cut from the
 * template in the middle section, then the tail.
 */
const SECTIONS = readMenuDefs(EDM_DEFINITION, EDM_MESSAGES)

/** the path of the AMOS branch itself, which is the middle section's root */
const AMOS_BRANCH = SECTIONS[1]?.[0]?.path[0] ?? 10

/**
 * `EdM_BranchAMOS`'s template: the entry a hidden program gets and the three
 * under it.
 *
 * `Ed_FCall` (:2595) decodes a command at or above `HiddenCommands` as
 * `HiddenCall + n % 3` with the program index in `n / 3`, so the three are
 * Run, Edit and New in that order and the separator between them is not one
 * of them. The template's own path is `10.6`, which is where the run of
 * programs starts.
 */
const TEMPLATE = SECTIONS[2] ?? []

export class EditorMenu {
  /** a chosen path back to a `JFonc` number, which is `EdM_Table` */
  private commands = new Map<string, number>()

  constructor(private readonly editor: Editor) {}

  /**
   * `EdM_Init`: the fixed menu, then `EdM_BranchAMOS` over it.
   *
   * Called whenever the window list changes, because the AMOS branch is a
   * view of it. `MenuTree.insert` is `MnIns` and creates the path as it
   * walks, so the order the records come in is the order the menu reads.
   */
  build(tree: MenuTree, screenNb: number): void {
    tree.reset()
    this.commands.clear()
    for (const e of SECTIONS[0] ?? []) this.object(tree, e, e.path)
    this.branchAmos(tree)
    tree.screenNb = screenNb
    tree.on = true
  }

  /**
   * `EdM_ObCree` (+Edit.s:13043) for one record.
   *
   * The two ink bytes go in six times over, three for the normal object and
   * three for the highlighted one:
   *
   *     move.b d0,MnInkA1 / move.b d1,MnInkB1 / move.b d0,MnInkC1
   *     move.b d1,MnInkA2 / move.b d0,MnInkB2 / move.b d0,MnInkC2
   *
   * so A and B swap and C is `inkA` either way. `MnOff` is byte 0 again: a
   * separator's command is 0 and `EdM_CreObjet` passes the same byte as the
   * "actif / inactif" flag, so an entry that cannot be chosen and a rule
   * across the menu are the same thing.
   */
  private object(tree: MenuTree, e: MenuEntry, path: number[], label = e.label): void {
    // one entry names the program: `Ed_About` is 150 and the shipped label is
    // " About AMOS Professionnal ", the author's spelling and all
    label = PORT_MENU_LABELS.get(e.command) ?? label
    if (label === '') return // `tst.b (a4) / beq .Skip`
    const node = tree.insert(path)
    node.inks1 = [e.inkA, e.inkB, e.inkA]
    node.inks2 = [e.inkB, e.inkA, e.inkA]
    node.ob1 = compileMenuObject(label)
    if (e.active) node.flags &= ~MF_OFF
    else node.flags |= MF_OFF
    if (e.command > 0) this.commands.set(path.join('.'), e.command)
  }

  /**
   * `EdM_BranchAMOS` (:12793): the AMOS branch, rebuilt.
   *
   * The head and the tail go down as they are. Between them the template is
   * stamped once per program on the page `hiddenPage` settles, with the
   * program's own name in place of the template's label and the three
   * commands numbered off `HiddenCommands`.
   *
   * DEVIATION: `EdM_MarkAll` puts a tick beside the program the editor is
   * showing. Nothing here does, so the entries are told apart by name alone.
   */
  private branchAmos(tree: MenuTree): void {
    for (const e of SECTIONS[1] ?? []) this.object(tree, e, e.path)
    const page = hiddenPage(this.editor)
    const root = TEMPLATE[2]
    if (root !== undefined) {
      page.programs.forEach((w, i) => {
        const at = [...root.path.slice(0, -1), root.path[root.path.length - 1]! + i]
        this.object(tree, root, at, ` ${w.prog.name || root.label.trim()} `)
        // Run, Edit and New, which `Ed_FCall` reads back out of one number
        TEMPLATE.slice(3).forEach((sub, k) => {
          const n = HIDDEN_COMMANDS + (page.from + i) * 3 + k
          this.object(tree, { ...sub, command: sub.command > 0 ? n : 0 }, [...at, ...sub.path.slice(-1)])
        })
      })
    }
    // the two arrows and everything under them, pushed past the programs
    const shift = Math.max(0, page.programs.length - 1)
    for (const e of SECTIONS[2]?.slice(0, 2) ?? []) {
      this.object(tree, { ...e, active: e.label.includes('Previous') ? page.previous : e.active }, e.path)
    }
    for (const e of SECTIONS[3] ?? []) {
      const at = [...e.path.slice(0, -1), e.path[e.path.length - 1]! + shift]
      this.object(tree, { ...e, active: e.label.includes('Next') ? page.next : e.active }, at)
    }
  }

  /**
   * `Ed_MnGere`'s tail (:1657): the chosen path, as a command number.
   *
   * `MnChoix` is the path one byte per level and the routine walks
   * `EdM_Table` for the record that matches it. -1 when the pick has no
   * command, which is `.NoChoix` and means the menu was let go on a title or
   * a separator.
   */
  chosen(path: readonly number[]): number {
    const cut: number[] = []
    for (const n of path) {
      if (n === 0) break
      cut.push(n)
    }
    return this.commands.get(cut.join('.')) ?? -1
  }

  /** how many programs the AMOS branch is showing, for a caller that redraws on a change */
  get shownPrograms(): number {
    return Math.min(EDM_HIDDEN_MAX, this.editor.list.filter((w) => w.hidden !== 0).length)
  }

  /** the branch the programs hang off, for tests that want to walk it */
  static readonly AMOS_BRANCH = AMOS_BRANCH
}
