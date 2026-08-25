/**
 * `EdM_Init` (+Edit.s:12579) and `EdM_BranchAMOS` (:12758): the menu bar as
 * data.
 *
 * The menus are not written in the editor. They are two blocks of the
 * configuration file: `EdM_Definition`, one eight-byte record per entry, and
 * `EdM_Messages`, one label per record. `EdM_Init` walks the two in step and
 * hands each pair to the Interface menu engine. Change the file and the menu
 * changes, which is what the four menu-editing commands do.
 *
 * ## The record
 *
 * ```
 *  0  command + 48       32 (a space) is a title, 48 is a separator
 *  1  ink B + 48         the colours EdM_ObCree writes into MnInkA1/B1/C1
 *  2  ink A + 48
 *  3  unread by EdM_CreObjet or EdM_ObCree
 *  4  path level 1 + 48  four levels, and the first zero ends the path
 *  5  path level 2 + 48
 *  6  path level 3 + 48
 *  7  path level 4 + 48
 * ```
 *
 * Every field is stored plus 48 and taken back with `sub.b #"0"`, so a level
 * of 12 is the character `<` and a command of 145 is `\xc1`. Nothing here is
 * decimal.
 *
 * Byte 0 does two jobs. `EdM_CreObjet` (:13005) passes it to `EdM_ObCree` as
 * the "actif / inactif" flag as well as reading it as the command, so a
 * separator, whose command is 0, is the same thing as an entry that cannot be
 * chosen. A byte below `"0"` is a title, and `.NoKey` refuses to print a key
 * beside one.
 *
 * ## The messages run in step, and a star breaks the run
 *
 * `EdM_Init`'s loop calls `EdM_CreObjet`, steps the record by 8 and the
 * message by its own length, and only then tests for `"*"`. So a star record
 * is never given to `CreObjet` and never consumes a message: the shipped block
 * has 199 records, three of them stars, and 196 labels.
 *
 * The stars are section breaks. Everything before the first is the fixed menu;
 * what follows is the AMOS branch, which `EdM_BranchAMOS` rebuilds every time
 * the hidden programs change, and its own sections are separated the same way.
 *
 * An empty label is not an empty entry. `tst.b (a4) / beq .Skip` skips the
 * object and steps on, so a record with nothing to show simply is not there.
 */
import type { Edit } from './edit'
import type { Editor } from './windows'

/** the definition record, eight bytes with everything in it offset by 48 */
export const MENU_RECORD = 8

/** what every field is stored as: `sub.b #"0"` on the way in */
const BIAS = 48

/** `EdM_HiddenMax equ 12` (+Edit.s:114): how many programs the AMOS menu shows */
export const EDM_HIDDEN_MAX = 12

/** `EdM_UserCommands equ 115` (:3268): the first `JFonc` slot a user entry uses */
export const EDM_USER_COMMANDS = 115

/** `EdM_UserLong equ 16` (:3269): the longest a user entry's label may be */
export const EDM_USER_LONG = 16

/** `EdM_UserMax equ 20` (:3270): how many of them there are */
export const EDM_USER_MAX = 20

export interface MenuEntry {
  /** byte 0 less 48: 0 is a separator and anything below it is a title */
  command: number
  /** `MnInkA1`, from byte 2 */
  inkA: number
  /** `MnInkB1`, from byte 1 */
  inkB: number
  /** bytes 4 to 7, cut at the first zero, so the length is the depth */
  path: number[]
  /** the label from `EdM_Messages`, in step with the record */
  label: string
  /** `tst.w (sp)+ / bne .Act`, which is byte 0 again */
  active: boolean
  /** `cmp.b #"0",(a6) / bcs .NoKey`: a title, which never shows a key */
  title: boolean
}

/**
 * `EdM_Init`'s walk, and `EdM_BranchAMOS`'s after it: the records split into
 * the sections the star records divide them into.
 *
 * The first section is the fixed menu. The rest belong to the AMOS branch,
 * which is rebuilt from the window list rather than shown as it stands.
 */
export function readMenuDefs(defs: Uint8Array, labels: readonly string[]): MenuEntry[][] {
  const out: MenuEntry[][] = [[]]
  let at = 0
  for (let p = 0; p + MENU_RECORD <= defs.length; p += MENU_RECORD) {
    const b0 = defs[p]!
    if (b0 === 0x2a) {
      // "*": a section break, which never reaches `EdM_CreObjet` and so never
      // takes a label with it
      out.push([])
      continue
    }
    const path: number[] = []
    for (let i = 4; i < 8; i++) {
      const level = defs[p + i]! - BIAS
      if (level === 0) break
      path.push(level)
    }
    const command = b0 - BIAS
    out[out.length - 1]!.push({
      command,
      inkA: defs[p + 2]! - BIAS,
      inkB: defs[p + 1]! - BIAS,
      path,
      label: labels[at] ?? '',
      active: command > 0,
      title: b0 < BIAS,
    })
    at++
  }
  return out
}

/** what the AMOS menu's programs branch shows, once `EdM_PosHidden` is settled */
export interface HiddenPage {
  /** `EdM_PosHidden` after the clamp */
  from: number
  /** bit 31 of d7: there is a page before this one */
  previous: boolean
  /** bit 30: there is a page after it */
  next: boolean
  /** the windows on it, at most `EdM_HiddenMax` */
  programs: Edit[]
}

/**
 * `EdM_BranchAMOS` (:12793) as far as the data goes: which hidden programs the
 * menu lists, and the two arrows.
 *
 * The clamp is here and not in the two commands that move `EdM_PosHidden`.
 * `.Plus` (:12801) takes the count less twelve and pulls the position down to
 * it, so `EdM_NextHidden` can add its eleven without a bound of its own and
 * the menu still ends on a full page. With twelve or fewer programs the
 * position is cleared outright.
 */
export function hiddenPage(editor: Editor): HiddenPage {
  const hidden = editor.list.filter((w) => w.hidden !== 0)
  const count = hidden.length
  if (count === 0) return { from: 0, previous: false, next: false, programs: [] }
  const last = count - EDM_HIDDEN_MAX
  if (last < 0) editor.posHidden = 0
  else if (last < editor.posHidden) editor.posHidden = last
  const from = editor.posHidden
  return {
    from,
    previous: from !== 0,
    // `add.w #EdM_HiddenMax,d0 / cmp.w d0,d1 / ble.s .S2`, so the arrow is
    // there when the count is strictly past the end of this page
    next: count > from + EDM_HIDDEN_MAX,
    programs: hidden.slice(from, from + EDM_HIDDEN_MAX),
  }
}
