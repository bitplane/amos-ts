/**
 * Read an AMOS Professional interpreter config's message table, and with it
 * the extension slot list, out of any file that carries one.
 *
 * The config's text zone is a run of variable-length messages. The `EdT`
 * macro (+Interpreter_Config.s:35-40) emits `dc.b 0`, a length byte, then the
 * characters, and Sys_GetMessage (+B.s:588-605) walks them with
 * `lea 2(a0,d1.w),a0`, stopping when the length byte reads $ff. Nothing is
 * NUL-terminated: the zero that looks like a string's terminator is the next
 * entry's first header byte.
 *
 * Messages are numbered from 1 (`Txt1`, +Interpreter_Config.s:135) and the
 * table holds 47 of them (`EdT 47`, :189). Libraries_Load takes the main
 * library's filename from message 14 (+B.s:2147), then walks d2 = 1..26
 * reading message d2+15 for each extension slot (+B.s:2155-2166). So:
 *
 *   slot n is message 15+n, for n in 1..26.
 *
 * WHY THIS IS WORTH READING. A compiled AMOS program carries its build
 * machine's config verbatim, so it states which extension sat in which slot
 * BY NAME. Nothing else does: a tokenised program refers to an extension as
 * (slot, token id) and no more, which is what src/ext/identify.ts exists to
 * work around. PuzCat (Aminet game/jump/Puzcat.lha) is the case that showed
 * it. Its slot 24 holds `ProTracker.lib`, which is neither p61 nor AMCAF, and
 * the five token ids its source calls had gone unexplained until the name
 * turned up here.
 *
 * FINDING IT. Neither end of the table anchors the read. The compiled copy
 * has no $ff terminator at all -- PuzCat's 47 messages start at $17838 and
 * are then padded with empty entries to fill the zone -- and a run of zero
 * bytes ahead of the table parses as any number of empty messages, so a
 * backward walk cannot find message 1 either. Getting the start wrong by one
 * entry renumbers every slot, which is worse than not reading the table.
 *
 * What does anchor it is message 46, the editor's cursor-flash colour list
 * (+Interpreter_Config.s:186). It is a run of `(rgb,delay)` groups, the
 * colours vary and the shape does not, and nothing else in an AMOS binary
 * looks like it. Walking back exactly 45 entries from it lands on message 1.
 *
 * A config whose message 46 has been emptied is invisible here. That is a
 * missed table rather than a misnumbered one, which is the trade to make.
 */

/** Messages in the config's text zone, `EdT 1` to `EdT 47`. */
export const CONFIG_MESSAGES = 47

/** Message 14 names the main library (+B.s:2147). */
export const MAIN_LIBRARY_MESSAGE = 14

/** Extension slots AMOS Pro loads (+B.s:2166, `cmp.w #27,d2`). */
export const MAX_SLOT = 26

/** The cursor-flash colour list, the one message with a fixed shape. */
const FLASH_MESSAGE = 46

/** How far back from message 46 to look. The stock zone is 578 bytes. */
const BACK_WINDOW = 8192

export interface ConfigTable {
  /** byte offset of message 1's two header bytes */
  offset: number
  /** messages 1..47, so message m is `messages[m - 1]` */
  messages: string[]
}

/** Latin-1 text, which is what an Amiga filename is (see walk.ts). */
const isText = (b: number): boolean => (b >= 0x20 && b < 0x7f) || b >= 0xa0 || b === 9

/** The `EdT` entry at `at`: its text, and where the next entry starts. */
function entryAt(d: Uint8Array, at: number): { text: string; next: number } | null {
  if (at < 0 || at + 2 > d.length || d[at] !== 0) return null
  const len = d[at + 1]!
  if (len === 0xff || at + 2 + len > d.length) return null
  let text = ''
  for (let i = 0; i < len; i++) {
    const b = d[at + 2 + i]!
    if (!isText(b)) return null
    text += String.fromCharCode(b)
  }
  return { text, next: at + 2 + len }
}

const isHex = (b: number | undefined): boolean =>
  b !== undefined &&
  ((b >= 0x30 && b <= 0x39) || (b >= 0x41 && b <= 0x46) || (b >= 0x61 && b <= 0x66))

/** Length of the `(rgb,delay)` group at `at`, or 0. */
function flashGroup(d: Uint8Array, at: number): number {
  if (d[at] !== 0x28) return 0 // '('
  let i = at + 1
  for (let h = 0; h < 3; h++, i++) if (!isHex(d[i])) return 0
  if (d[i++] !== 0x2c) return 0 // ','
  const digits = i
  while (d[i] !== undefined && d[i]! >= 0x30 && d[i]! <= 0x39) i++
  if (i === digits || d[i] !== 0x29) return 0 // ')'
  return i + 1 - at
}

/** Every maximal run of `(rgb,delay)` groups in the file. */
function flashRuns(d: Uint8Array): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = []
  let i = 0
  while (i < d.length) {
    const first = flashGroup(d, i)
    if (first === 0) {
      i++
      continue
    }
    let end = i + first
    for (;;) {
      const next = flashGroup(d, end)
      if (next === 0) break
      end += next
    }
    out.push({ start: i, end })
    i = end
  }
  return out
}

/**
 * Every interpreter config message table in `d`.
 *
 * More than one answer means two chains of 45 entries reach the same message
 * 46, which no config seen so far produces. They are all returned rather than
 * silently picked between, so a real ambiguity shows up at the call site.
 */
export function readConfigTables(d: Uint8Array): ConfigTable[] {
  const out: ConfigTable[] = []
  for (const { start, end } of flashRuns(d)) {
    const anchor = start - 2
    if (anchor < 0 || d[anchor] !== 0 || d[anchor + 1] !== end - start) continue
    // entries between j and message 46, computed backward from the anchor
    const depth = new Map<number, number>([[anchor, 0]])
    const starts: number[] = []
    for (let j = anchor - 2; j >= Math.max(0, anchor - BACK_WINDOW); j--) {
      const e = entryAt(d, j)
      if (!e) continue
      const to = depth.get(e.next)
      if (to === undefined) continue
      depth.set(j, to + 1)
      if (to + 1 === FLASH_MESSAGE - 1) starts.push(j)
    }
    for (const offset of starts) {
      const messages: string[] = []
      let at = offset
      while (messages.length < CONFIG_MESSAGES) {
        const e = entryAt(d, at)
        if (!e) break
        messages.push(e.text)
        at = e.next
      }
      if (messages.length === CONFIG_MESSAGES) out.push({ offset, messages })
    }
  }
  return out
}

/** The main library's filename, message 14. */
export const mainLibrary = (t: ConfigTable): string => t.messages[MAIN_LIBRARY_MESSAGE - 1]!

/** Slot to library filename, for the slots this config fills. */
export function configSlots(t: ConfigTable): Map<number, string> {
  const slots = new Map<number, string>()
  for (let n = 1; n <= MAX_SLOT; n++) {
    const name = t.messages[14 + n]
    if (name !== undefined && name !== '') slots.set(n, name)
  }
  return slots
}
