/**
 * Generate src/amiga/muimaster.gen.ts from MUI 3.8's own header.
 *
 * ## Why the header
 *
 * MUI is a taglist API and its whole vocabulary is numbers: an attribute is a
 * longword like `0x8042ad3d`, a method is a longword like `0x8042549a`, and a
 * class is a name like `"Window.mui"`. None of those are derivable — they were
 * chosen by hand in 1993 — so a reimplementation has to have the table, and
 * `libraries/mui.h` is the table, published by the author for exactly the
 * purpose of writing programs against MUI.
 *
 * The header also carries two things worth keeping beside each value: the
 * version an attribute first appeared in (`V4`, `V11`), and its `isg` flags —
 * whether it can be given at Init, Set later, or Got. Those decide real
 * behaviour: OM_SET must refuse an init-only attribute, and OM_GET must answer
 * FALSE rather than zero for one that is not gettable.
 *
 * ## Evidence order, and what this is NOT
 *
 * These values are TRANSCRIBED, not read off the code. The header says what
 * the author intended; the library is what programs ran against, and where
 * they disagree the library wins — see ../amiga/README.md and the archive's
 * SOURCE.md for `aminet-mui-3.8`. `muimaster.library` 19.35 is held, so that
 * comparison can actually be made and ./muidis.ts is what makes it; the
 * values here are a starting point to be checked, not an authority. One
 * check already exists besides: EasyLife's Tags bank ships the
 * same constants by name, resolved at run time out of bank 13, and
 * ../amiga/muimaster.test.ts compares the two tables entry by entry. Two
 * independent transcriptions agreeing is worth more than either alone.
 *
 * ## Licensing
 *
 * MUI is shareware, (c) Stefan Stuntz, and its licence permits verbatim
 * redistribution of the archives. This generator extracts DATA — the numeric
 * value of a named constant, and the class names — from a header published so
 * that third-party code could interoperate. It copies no MUI code; the
 * behaviour in ../amiga/muimaster.ts is written against the documented API.
 *
 * Run: npm run cli -- src/cli/genmui.ts [path-to-mui38dev]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const dev =
  process.argv[2] ??
  join(homedir(), 'src', 'tmp', 'amos', 'amos-files', 'sources', 'aminet-mui-3.8', 'files', 'mui38dev')
const header = join(dev, 'MUI', 'Developer', 'C', 'Include', 'libraries', 'mui.h')

/*
 * The header is ISO-8859-1, not UTF-8. Reading it as UTF-8 would mangle the
 * few high bytes in its comments; latin1 round-trips every byte, and nothing
 * extracted here is outside ASCII anyway.
 */
const src = readFileSync(header, 'latin1')

/** the prefixes whose values are plain numbers */
const NUMERIC = ['MUIA_', 'MUIM_', 'MUIV_', 'MUII_', 'MUIO_', 'MUIE_', 'MUIMASTER_']

interface Attr {
  ver: number
  flags: string
  type: string
}

const nums = new Map<string, number>()
const classes = new Map<string, string>()
const attrs = new Map<string, Attr>()
const owner = new Map<string, string>()
const tree = new Map<string, string>()

/*
 * The class tree, from the ASCII drawing in the header's own opening comment:
 *
 *   ** rootclass                    (BOOPSI's base class)
 *   ** +--Notify                   (implements notification mechanism)
 *   ** !  +--Family                (handles multiple children)
 *   ** !  !  +--Menustrip          (describes a complete menu strip)
 *
 * Three columns per level, `!` continuing a parent's line and `+`/`\` marking
 * a child. Parsing it beats typing it: 65 classes and one transposed line
 * would put a class under the wrong parent, where every inherited attribute
 * then goes wrong at once.
 */
const stack: string[] = []
for (const raw of src.split('\n')) {
  const t = /^\*\*\s([!\s]*)[+\\]--(\w+)/.exec(raw)
  if (!t) continue
  const depth = t[1]!.length / 3
  stack.length = depth
  tree.set(t[2]!, stack[depth - 1] ?? 'rootclass')
  stack.push(t[2]!)
}

/*
 * The drawing is INCOMPLETE. Two classes have a section of their own further
 * down and no place in it: Dtpic and Cclist.
 *
 * Dtpic is placed from a second source. Zune's `classes/dtpic.conf` declares
 * `superclass MUIC_Area`, which is also the only thing it could be — a Dtpic
 * displays a picture, and Area is where displaying happens.
 *
 * Cclist is left out. Its autodoc is three lines and one of them is "This is a
 * private class"; it has no attributes, no methods and nothing anywhere says
 * what it descends from. An absent class means `MUI_NewObjectA("Cclist.mui")`
 * answers 0, which is the right answer for a private class asked for by name.
 */
const DRAWN_OMITS: ReadonlyMap<string, string | null> = new Map([
  ['Dtpic', 'Area'],
  ['Cclist', null],
])
for (const [c, sup] of DRAWN_OMITS) {
  if (tree.has(c)) throw new Error(`${c} is in the drawn tree after all — drop it from DRAWN_OMITS`)
  if (sup !== null) tree.set(c, sup)
}

let section = ''
for (const raw of src.split('\n')) {
  // /** Area                                                              **/
  const banner = /^\/\*\*\s+([A-Za-z]\w*)\s+\*\*\/$/.exec(raw.trimEnd())
  if (banner) {
    section = banner[1]!
    continue
  }
  const m = /^#define\s+(MUI[A-Z]*_[A-Za-z0-9_]+)\s+(.*)$/.exec(raw)
  if (!m) continue
  const [, name, rest] = m as unknown as [string, string, string]
  /*
   * Only a class's own vocabulary is attributed to it. MUIKEYF_, MUILM_,
   * MUIMRI_ and MPEN_ are global — they are declared after the last class
   * section, so the banner still in effect is Dtpic's and they would all be
   * filed under it. MUI_OWNER exists to route an ATTRIBUTE to the class that
   * stores it, and only the three prefixes below are ever that.
   */
  if (section !== '' && tree.has(section) && /^MUI[AMV]_/.test(name)) owner.set(name, section)
  const comment = /\/\*(.*?)\*\//.exec(rest)?.[1] ?? ''
  const value = rest.replace(/\/\*.*/, '').trim()

  if (name.startsWith('MUIC_')) {
    // #define MUIC_Window "Window.mui"
    const s = /^"([^"]*)"$/.exec(value)
    if (s) classes.set(name, s[1]!)
    continue
  }
  if (!NUMERIC.some((p) => name.startsWith(p))) continue

  // 0x8042ad3d, 145, -1, or (1<<3) — the shift form is only used for flag
  // words, and only ever shifts a literal in the prefixes taken here
  let n: number | null = null
  if (/^0x[0-9a-fA-F]+$/.test(value)) n = Number.parseInt(value, 16)
  else if (/^-?[0-9]+$/.test(value)) n = Number.parseInt(value, 10)
  else {
    const sh = /^\(1<<\s*([0-9]+)\)$/.exec(value)
    if (sh) n = 1 << Number.parseInt(sh[1]!, 10)
  }
  if (n === null) continue
  nums.set(name, n >>> 0)

  // /* V8  isg STRPTR            */ — version, then i/s/g with "." for absent
  const a = /^\s*V([0-9]+)\s+([isg.]{3})\s+(.*?)\s*$/.exec(comment)
  if (a) attrs.set(name, { ver: Number.parseInt(a[1]!, 10), flags: a[2]!, type: a[3]! })
}

if (nums.size < 700 || classes.size < 60 || tree.size < 60 || owner.size < 550) {
  throw new Error(
    `mui.h parsed suspiciously thin: ${nums.size} constants, ${classes.size} classes, ` +
      `${tree.size} in the tree, ${owner.size} attributed to a class`,
  )
}
/* every class the tree names must have a MUIC_ string, and the reverse */
for (const c of tree.keys()) if (!classes.has(`MUIC_${c}`)) throw new Error(`tree names ${c}, MUIC_ does not`)
for (const c of classes.keys())
  if (!tree.has(c.slice(5)) && !DRAWN_OMITS.has(c.slice(5))) throw new Error(`${c} has no place in the tree`)

const hex = (n: number): string => (n > 0xffff ? `0x${n.toString(16)}` : String(n))
const q = (s: string): string => JSON.stringify(s)

const out: string[] = []
out.push(`/**
 * GENERATED by src/cli/genmui.ts — do not edit.
 *
 * MUI 3.8's constant vocabulary, extracted from its own developer header
 * (\`MUI/Developer/C/Include/libraries/mui.h\`, muimaster.library 19.35,
 * 12-Feb-97). ${nums.size} named numbers and ${classes.size} class names.
 *
 * MUI is shareware, (c) Stefan Stuntz. What is reproduced here is data — the
 * numeric value of a named constant — from a header published so that
 * third-party code could interoperate with the library. See the generator's
 * own comment for the evidence and licensing position, and the archive at
 * amos-files/sources/aminet-mui-3.8/ for the full write-up.
 *
 * THESE VALUES ARE TRANSCRIBED, not read off the code. The header says what
 * the author intended; muimaster.library is what programs actually ran
 * against, and where they disagree the library decides.
 */

/** every named MUI constant that resolves to a number */
export const MUI = {`)
for (const [k, v] of [...nums].sort((a, b) => (a[0] < b[0] ? -1 : 1))) out.push(`  ${k}: ${hex(v)},`)
out.push(`} as const

/** the class names MUI_NewObjectA takes, e.g. MUIC_Window is "Window.mui" */
export const MUIC = {`)
for (const [k, v] of [...classes].sort((a, b) => (a[0] < b[0] ? -1 : 1))) out.push(`  ${k}: ${q(v)},`)
out.push(`} as const

/**
 * Per-attribute metadata from the header's own comments.
 *
 * \`ver\` is the muimaster version the attribute first appeared in. \`flags\` is
 * the header's \`isg\` triple with "." for absent: whether the attribute can be
 * given at Init, Set afterwards, and Got. \`type\` is its C declaration, kept
 * because it is the only statement of what a value MEANS — a BOOL, a STRPTR,
 * an \`Object *\`, a \`struct Hook *\`.
 */
export const MUI_ATTR: Readonly<Record<string, { ver: number; flags: string; type: string }>> = {`)
for (const [k, a] of [...attrs].sort((x, y) => (x[0] < y[0] ? -1 : 1))) {
  out.push(`  ${k}: { ver: ${a.ver}, flags: ${q(a.flags)}, type: ${q(a.type)} },`)
}
out.push(`}

/**
 * The class tree: class name to the name of its superclass.
 *
 * Read off the ASCII drawing in the header's opening comment, which is the
 * only statement of it anywhere. Every entry's parent is another entry or
 * "rootclass", so the whole of MUI hangs under BOOPSI.
 */
export const MUI_SUPER: Readonly<Record<string, string>> = {`)
for (const [k, v] of [...tree].sort((a, b) => (a[0] < b[0] ? -1 : 1))) out.push(`  ${q(k)}: ${q(v)},`)
out.push(`}

/**
 * Which class each constant belongs to, from the section it is declared under.
 *
 * This is what routes an attribute to a dispatcher. \`MUIA_Window_Title\` would
 * be guessable from its name, but \`MUIA_Weight\`, \`MUIA_Disabled\` and
 * \`MUIA_UserData\` would not, and those are exactly the ones a naming rule
 * would silently put on the wrong class.
 */
export const MUI_OWNER: Readonly<Record<string, string>> = {`)
for (const [k, v] of [...owner].sort((a, b) => (a[0] < b[0] ? -1 : 1))) out.push(`  ${k}: ${q(v)},`)
out.push('}')

const path = join(root, 'src', 'amiga', 'muimaster.gen.ts')
writeFileSync(path, out.join('\n') + '\n')
console.log(`wrote ${path}: ${nums.size} constants, ${classes.size} classes, ${attrs.size} attribute descriptions`)
