/**
 * `Ed_Ky2Fonc` (+Edit.s:1689) and `Ed_Fonc2Ky` (:1773): which command a
 * keystroke runs, and which key runs a command.
 *
 * The editor reads a key as `Inkey`'s longword -- qualifiers in bits 24-31,
 * scancode in 16-23, ASCII in 0-7 -- which is `{ shift, scan, ch }` in this
 * port's key queue (`InputState.keyQueue`, ../interp/interp.ts). The table it
 * looks that up in is `.Ed_KFonc` in ./keymap.gen.ts.
 *
 * A record's first byte says which half of the keystroke it wants. Bit 7 set
 * is a SCANCODE, compared as `d0 & $7f` against the scancode. Zero closes the
 * command's list. Anything else is an ASCII code compared against the
 * keystroke's letter after `.EdL5` has upper-cased it, which is why Ctrl-u
 * and Ctrl-U are one shortcut. The unassigned rows hold 1: an ASCII code no
 * key produces on its own, so they never end the list and never match. Not
 * quite never: Ctrl-A produces ASCII 1, and it only misses because the record
 * asks for no qualifiers and Ctrl-A carries one. A bare SOH out of `Put Key`
 * reaches the first command holding a 1, which is Set Mark 0.
 *
 * ## The two numbering schemes
 *
 * `Ed_Ky2Fonc` counts commands from 0 in d2 and `Ed_FCall` (:2565) indexes
 * `FlagFonc` and `JFonc` with that same 0. `Ed_Fonc2Ky` two lines below takes
 * the number from 1 (`subq.b #1,d0 / bne .Loop4`), and so does every comment
 * in +Edit.s. This port takes the source's 1-based numbers everywhere, since
 * those are the ones the assembler's comments and the shipped manual use, and
 * the tables in ./keymap.gen.ts subtract on the way in.
 */
import { ED_KFONC, ED_ROUTINES } from './keymap.gen'

/**
 * The keyboard qualifier bits (+Equ.s:775-778), as the CIA delivers them.
 *
 * `CAPS` is here to be thrown away: `.EdL5` masks it out with
 * `and.b #%11111011,d1` before the search, so Caps Lock cannot be part of a
 * shortcut. Each of the other four is a GROUP of bits, and the comparison
 * below treats a group as a boolean.
 */
export const QUAL = {
  SHIFT: 0b0000_0011,
  CAPS: 0b0000_0100,
  CTRL: 0b0000_1000,
  ALT: 0b0011_0000,
  AMIGA: 0b1100_0000,
} as const

/** the qualifier groups, in the order `.EdL8a` through `.EdL8d` test them */
const GROUPS = [QUAL.SHIFT, QUAL.CTRL, QUAL.ALT, QUAL.AMIGA]

/** one keystroke, which is what `InputState.keyQueue` already holds */
export interface EdKey {
  /** the character, or '' for a key with no ASCII */
  ch?: string
  /** the Amiga scancode */
  scan?: number
  /** the qualifiers held when the key arrived */
  shift?: number
}

/** how many commands the tables hold */
export const COMMAND_COUNT = ED_ROUTINES.length

/** `.EdL5`: 'a'-'z' fold up, and nothing else changes */
function upper(ch: string): number {
  const c = ch.charCodeAt(0)
  if (Number.isNaN(c)) return 0
  return c >= 0x61 && c <= 0x7a ? c - 0x20 : c
}

/**
 * `.EdL8` through `.EdLG`: do the record's qualifiers describe these?
 *
 * The machine tests one group at a time, and for each group it wants the
 * record's bits to OVERLAP the pressed ones rather than to equal them, so a
 * record asking for `Ami` (both Amiga keys) is happy with either. It then
 * clears the group from both and falls out at `.EdLG` if anything is left
 * over on either side. That comes to the same thing as comparing each group
 * as a boolean, which is what the dialogue reader's `.KShf` does
 * (+Lib.s:24260, ../runtime/runtime.ts) by a different route.
 *
 * A record with no qualifiers at all takes the short path and needs the
 * keystroke to have none either, so plain Up and Shift-Up are two shortcuts.
 */
function qualifiersMatch(want: number, held: number): boolean {
  if (want === 0) return held === 0
  for (const g of GROUPS) {
    if (((want & g) !== 0) !== ((held & g) !== 0)) return false
    if ((want & g) !== 0 && (want & held & g) === 0) return false
  }
  return true
}

/**
 * `Ed_Ky2Fonc`: the 1-based command this keystroke runs, or 0 for none.
 *
 * Zero is the machine's answer too (`.EdL10 moveq #0,d0`), and the caller at
 * :1618 reads it as "not a function, so give it to `Ed_PKey`". The search is
 * first match wins, in table order, so a key put on two commands runs the
 * lower-numbered one and nothing warns about it.
 */
export function keyToFunc(key: EdKey, table: Uint8Array = ED_KFONC): number {
  const ascii = upper(key.ch ?? '')
  const scan = key.scan ?? 0
  const held = (key.shift ?? 0) & ~QUAL.CAPS
  let fn = 0
  for (let at = 0; at < table.length; ) {
    const id = table[at]!
    if (id === 0xff) return 0
    if (id === 0) {
      fn++
      at++
      continue
    }
    const hit = (id & 0x80) !== 0 ? (id & 0x7f) === scan : id === ascii
    if (hit && qualifiersMatch(table[at + 1]!, held)) return fn + 1
    at += 2
  }
  return 0
}

/**
 * `.Loop4`, the skip both of the by-number walks share: `fn - 1` lists.
 *
 * It advances two bytes BEFORE testing for the terminator, so a command with
 * an empty list would be stepped straight over and every command after it
 * misreported. Nothing writes one: Set Key Shortcut clears a shortcut by
 * poking `1,0` over the record (:5665) rather than removing it. That is what
 * the unassigned rows are, and why the format has no way to say "no keys".
 *
 * Answers -1 when the table ends first.
 */
function skipLists(fn: number, table: Uint8Array): number {
  let at = 0
  for (let left = fn - 1; left > 0; left--) {
    do at += 2
    while (table[at] !== 0)
    at++
    if (table[at] === 0xff) return -1
  }
  return at
}

/**
 * `Ed_Fonc2Ky`: the first key on 1-based command `fn`, or null.
 *
 * It stops at the first record, so a command carrying two keys reports only
 * the one the table holds first. The editor uses this to print a shortcut
 * beside a menu entry, where one is all there is room for.
 */
export function funcToKey(fn: number, table: Uint8Array = ED_KFONC): { key: number; shift: number } | null {
  const at = skipLists(fn, table)
  if (at < 0) return null
  const id = table[at]!
  return id === undefined || id === 0 || id === 0xff ? null : { key: id, shift: table[at + 1]! }
}

/** every key on 1-based command `fn`, which is what the list actually holds */
export function keysFor(fn: number, table: Uint8Array = ED_KFONC): Array<{ key: number; shift: number }> {
  let at = skipLists(fn, table)
  if (at < 0) return []
  const out: Array<{ key: number; shift: number }> = []
  while (table[at] !== 0 && table[at] !== 0xff && at < table.length) {
    out.push({ key: table[at]!, shift: table[at + 1]! })
    at += 2
  }
  return out
}
