/**
 * `.language` files — the per-language half of locale.library.
 *
 * locale.library holds the RULES (how a date is composed, how strings collate)
 * and a `.language` library holds the WORDS. `OpenLanguage("deutsch")` loads
 * `LOCALE:Languages/deutsch.language` and every `GetLocaleStr` afterwards comes
 * out of it. localelib.gen.ts already carries english's words, extracted from
 * AROS; this reads anybody else's out of the real 1992 binaries.
 *
 * A `.language` file is an ordinary AmigaOS shared library in hunk format --
 * a RomTag, a little code, and a table of string pointers -- so hunk.ts opens
 * it and the only question is where the table is.
 *
 * It is found by RELOCATION rather than by scanning for plausible text. Every
 * entry in that table is an absolute pointer, so every one of them has a
 * RELOC32 entry, and the table is therefore the longest run of relocation
 * offsets four bytes apart. That is structure the linker guarantees, where a
 * scan for "runs of printable bytes" would be a guess that happens to work --
 * and this codebase has been burned twice by readers that looked right on the
 * files they were built against.
 *
 * `loadHunks(bytes, 0)` places the image at zero deliberately, exactly as
 * firstCodeHunk does for extension token tables: at base zero a relocated
 * pointer reads back as a plain offset into the image, so no address
 * arithmetic is needed to follow one.
 *
 * The table is indexed BY ID, with an unused entry at 0 -- entry 1 is Sunday.
 * All nine Workbench 2.1 languages carry exactly 51 entries, covering ids
 * 1..50, which ends at FUTURESTR. That is independent corroboration of what
 * localelib.gen.ts says from the other direction: id 51 is LANG_NAME, which
 * locale.h marks V50, and a v38 library has no string for it.
 */
import { loadHunks } from './hunk'

/** ids 1..50 plus the unused entry at 0 — what a v38 `.language` carries. */
export const LANGUAGE_ENTRIES = 51

/** below this, a run of relocations is some other pointer array, not the table */
const MIN_TABLE = 40

export interface Language {
  /** the strings, indexed by GetLocaleStr id; [0] is unused */
  readonly strings: readonly string[]
}

/**
 * Read a `.language` library's string table.
 *
 * Answers `null` for anything that is not one -- not a hunk file, no code
 * hunk, no plausible pointer table, or a pointer that leaves the image. A file
 * this cannot read is not a language with no words in it, and the caller has
 * to be able to tell those apart.
 */
export function parseLanguage(bytes: Uint8Array): Language | null {
  let loaded
  try {
    loaded = loadHunks(bytes, 0)
  } catch {
    return null
  }
  const hunk = loaded.hunks[0]
  if (!hunk) return null

  // relocations pointing into hunk 0, in address order
  const offsets = hunk.relocs
    .filter((r) => r.target === 0)
    .map((r) => r.offset)
    .sort((a, b) => a - b)

  // the longest run four bytes apart is the array of string pointers
  let best: number[] = []
  let run: number[] = []
  for (const o of offsets) {
    if (run.length > 0 && o - (run[run.length - 1] ?? 0) === 4) run.push(o)
    else run = [o]
    if (run.length > best.length) best = [...run]
  }
  if (best.length < MIN_TABLE) return null

  const image = loaded.image
  const dv = new DataView(image.buffer, image.byteOffset, image.length)
  const strings: string[] = []
  for (const at of best) {
    let p = dv.getUint32(at)
    if (p >= image.length) return null
    let s = ''
    // latin-1, one byte one character: these are 1992 files and "M\xe4rz" is
    // März, not a broken UTF-8 sequence
    while (p < image.length && image[p] !== 0) s += String.fromCharCode(image[p++]!)
    if (p >= image.length) return null // unterminated: the walk left the image
    strings.push(s)
  }
  return { strings }
}

/**
 * One string by GetLocaleStr id, or `undefined` where the language has none.
 *
 * Out of range is not an error here for the same reason it is not in
 * `getLocaleStr`: GetLangString's own `if (id < MAXSTRMSG) ... else return
 * NULL` leaves the caller to decide, and AMOS's answer to a null string is the
 * empty one.
 */
export function languageStr(lang: Language | null, id: number): string | undefined {
  return lang?.strings[id]
}
