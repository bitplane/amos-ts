import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { firstCodeHunk } from '../tokens/libtok'
import { extensionById } from './registry'
import { routineAddresses } from './routines'
import {
  CITED_BY,
  checkCitations,
  checkSelfCitation,
  citedRoutines,
  findAmbiguous,
  findAnchors,
  parseCitations,
  type Library,
  type Mismatch,
} from './citations'
import { NOTES } from '../coverage/status'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const src = join(root, 'src')
const extFixtures = join(root, 'fixtures', 'extensions')

/** every .ts under src/, so a new port cannot escape the sweep by being new */
function sources(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) sources(p, out)
    else if (e.name.endsWith('.ts')) out.push(p)
  }
  return out
}

/** the id's library, or null if that fixture is not present */
function library(id: string): Library | null {
  const dir = join(extFixtures, id)
  if (!existsSync(dir)) return null
  const lib = readdirSync(dir).find((f) => /\.lib$/i.test(f))
  if (!lib) return null
  const code = firstCodeHunk(new Uint8Array(readFileSync(join(dir, lib))))
  const addr = routineAddresses(code)
  if (addr.length === 0) return null
  // the version is the id's trailing number: "jd-colour-2.0" -> "2.0"
  const version = /-([0-9]+\.[0-9]+[a-z0-9]*)$/.exec(id)?.[1] ?? id
  return { id, version, addr, hunkLen: code.length }
}

const libs = new Map<string, Library | null>()
function libsFor(ids: string[]): Library[] {
  const out: Library[] = []
  for (const id of ids) {
    if (!libs.has(id)) libs.set(id, library(id))
    const l = libs.get(id)
    if (l) out.push(l)
  }
  return out
}

function report(where: string, bad: Mismatch[]): string[] {
  return bad.map((m) => `${where}:${m.line}  "${m.text}" — ${m.real}`)
}

/**
 * The whole check needs the .Lib files, and fixtures/ is gitignored: the AMOS
 * libraries and the commercial extensions are not ours to redistribute. So
 * this skips where they are absent, exactly as the ADF, diskfont and corpus
 * tests do. It is a real limitation — the check does not run in CI, only for
 * whoever has the material — and the alternative, committing a generated
 * table of routine addresses, would put derived data in the repo to test a
 * property of data that is not there. Not worth it for a check that runs on
 * every machine that could act on a failure anyway.
 */
describe.skipIf(!existsSync(extFixtures))('extension citations name the code they claim to', () => {
  /**
   * Check (a): every "routine N ($ADDR)" in a port agrees with that library's
   * jump table. This is the one that fails the build, because a citation that
   * disagrees is either a wrong number or a wrong address and there is no
   * third possibility.
   */
  it('every cited address is inside the routine it names', () => {
    const problems: string[] = []
    for (const [file, ids] of Object.entries(CITED_BY)) {
      const path = join(root, file)
      if (!existsSync(path)) {
        problems.push(`${file} — listed in CITED_BY but not in the tree`)
        continue
      }
      const found = libsFor(ids)
      if (found.length === 0) continue // none of its fixtures are present
      const text = readFileSync(path, 'utf8')
      problems.push(...report(file, checkCitations(parseCitations(text), found)))
      problems.push(...findAmbiguous(text).map((a) => `${file}:${a.line}  "${a.text}" — which routine is the address for?`))
    }
    expect(problems).toEqual([])
  })

  /**
   * status.ts is the awkward one: a single flat NOTES map holding every
   * extension's entries plus the core's, keyed by keyword name alone. The
   * extension a note belongs to therefore has to be resolved through the
   * registry, per keyword — and a contested name resolves to several, in
   * which case any of them agreeing is enough. That is weaker than the
   * per-file check above and is the price of the map's shape.
   */
  it('every citation in a coverage note agrees with the extension that owns the keyword', () => {
    const owners = new Map<string, string[]>()
    for (const ids of Object.values(CITED_BY)) {
      for (const id of ids) {
        const ext = extensionById(id)
        if (!ext) continue
        for (const t of ext.tokens) {
          const name = t.name.trim().replace(/^!/, '').toLowerCase()
          if (name === '') continue
          const list = owners.get(name) ?? []
          if (!list.includes(id)) list.push(id)
          owners.set(name, list)
        }
      }
    }

    const problems: string[] = []
    for (const [keyword, note] of Object.entries(NOTES)) {
      const cites = parseCitations(note)
      const vague = findAmbiguous(note)
      if (cites.length === 0 && vague.length === 0) continue
      const ids = owners.get(keyword.toLowerCase())
      if (!ids) {
        // a core keyword's note cites +Lib.s line numbers, not routines, so
        // reaching here means a citation was written for a keyword no ported
        // extension claims -- worth knowing about either way
        problems.push(`NOTES['${keyword}'] cites a routine but no ported extension owns that name`)
        continue
      }
      const found = libsFor(ids)
      if (found.length === 0) continue
      problems.push(...report(`NOTES['${keyword}']`, checkCitations(cites, found)))
      problems.push(
        ...findAmbiguous(note).map((a) => `NOTES['${keyword}']  "${a.text}" — which routine is the address for?`),
      )
    }
    expect(problems).toEqual([])
  })

  /**
   * The registration guard. Without it the sweep quietly shrinks: a new port
   * lands, nobody adds it to CITED_BY, and its citations are never checked
   * while the suite stays green -- which is the failure mode the shell recipe
   * already had and the reason this is a test at all.
   */
  it('every file in the tree that cites a routine is registered in CITED_BY', () => {
    const unregistered: string[] = []
    for (const path of sources(src)) {
      const rel = relative(root, path).replaceAll('\\', '/')
      if (rel in CITED_BY) continue
      // the checker and the disassembler discuss citations in their own prose
      if (rel === 'src/ext/citations.ts' || rel === 'src/ext/citations.test.ts') continue
      if (rel === 'src/cli/extdis.ts' || rel === 'src/ext/routines.ts') continue
      if (rel === 'src/cli/citecheck.ts') continue
      // status.ts is checked by keyword above, not by file
      if (rel === 'src/coverage/status.ts') continue
      const text = readFileSync(path, 'utf8')
      const n = parseCitations(text).length + findAmbiguous(text).length
      if (n > 0) unregistered.push(`${rel} — ${n} citations, no CITED_BY entry`)
    }
    expect(unregistered).toEqual([])
  })
})

describe('the citation parser', () => {
  it('reads the plain form, and the continuation the shell recipe missed', () => {
    // "Routines 212 ($4f44) and 213 ($4f8c) are the same 72 bytes apart"
    const c = parseCitations('Routines 212 ($4f44) and 213 ($4f8c) are the same')
    expect(c.map((x) => [x.routine, x.addr])).toEqual([
      [212, 0x4f44],
      [213, 0x4f8c],
    ])
  })

  it('reads a version prefix, with or without the word routine', () => {
    const c = parseCitations("routine 325 ($7140) / 1.40's 311 ($73ec) and 1.40's routine 338 ($811e)")
    expect(c.map((x) => [x.routine, x.version])).toEqual([
      [325, undefined],
      [311, '1.40'],
      [338, '1.40'],
    ])
  })

  it('reads the escaped dollar status.ts holds its notes in', () => {
    expect(parseCitations('Routine 353 (\\$6f2a) is a toggling circle')[0]?.addr).toBe(0x6f2a)
  })

  it('does not match the prose that looks like a citation and is not', () => {
    expect(parseCitations('the 32 (thirty-two) entries')).toEqual([])
    // a register name ending in a digit, which is why a lead-in is required
    expect(parseCitations('BEAMCON0 ($DFF1DC) is written directly')).toEqual([])
    expect(parseCitations('BPLCON3 ($DFF106) outside a list')).toEqual([])
    expect(parseCitations('mantissa $800000, exponent 65 ($41)')).toEqual([])
    expect(parseCitations('set base to colour 1 ($F00)')).toEqual([])
    // a list with one address is ambiguous, not a citation of the last
    expect(parseCitations('Routines 178 and 177 ($488e)')).toEqual([])
    expect(parseCitations('Routines 87, 88 and 89 ($327a)')).toEqual([])
  })

  it('reports a list with one address rather than guessing which it names', () => {
    // $488e is 178's; $2782 is 54's, the worker 55 tails into. Same shape.
    expect(findAmbiguous('Routines 178 and 177 ($488e) pad a number').map((a) => a.text)).toEqual([
      'Routines 178 and 177 ($488e)',
    ])
    expect(findAmbiguous('Routines 55 and 54 (\\$2782): a plain sum').map((a) => a.text)).toEqual([
      'Routines 55 and 54 (\\$2782)',
    ])
    // one address per number is not ambiguous
    expect(findAmbiguous('Routines 212 ($4f44) and 213 ($4f8c)')).toEqual([])
  })

  it('reports the line a citation sits on', () => {
    expect(parseCitations('one\ntwo\nroutine 7 ($abc)')[0]?.line).toBe(3)
  })
})

describe('the address map', () => {
  it('refuses a file whose header does not describe a library', () => {
    expect(routineAddresses(new Uint8Array(4))).toEqual([])
    // a jump table claiming to run past the hunk
    const bogus = new Uint8Array(64)
    new DataView(bogus.buffer).setUint32(0, 0x10000, false)
    expect(routineAddresses(bogus)).toEqual([])
  })

  it('walks the delta-encoded table, in words', () => {
    // jumpSize 6 (three routines), tokenSize 0, then deltas 0, 4, 8
    const code = new Uint8Array(64)
    const v = new DataView(code.buffer)
    v.setUint32(0, 6, false)
    v.setUint32(4, 0, false)
    v.setUint16(18, 4, false)
    v.setUint16(20, 8, false)
    // routine 0 at 18+6 = 24, then +4 words, then +8 words
    expect(routineAddresses(code)).toEqual([24, 32, 48])
  })
})

describe('routine numbers a passage mentions', () => {
  it('expands a range, because a family is documented in one breath', () => {
    // "THE SEPARATIONS — routines 17 to 23" covers seven keywords, and reading
    // it as a citation of 17 alone was the self-citation check's first and
    // only false positive
    expect(citedRoutines('THE SEPARATIONS — routines 17 to 23 (+|col.s:512-630)')).toEqual([
      17, 18, 19, 20, 21, 22, 23,
    ])
    expect(citedRoutines('routines 313-319, the Do/Del/Move family')).toEqual([313, 314, 315, 316, 317, 318, 319])
  })

  it('does not expand what is not a range', () => {
    expect(citedRoutines('routine 381 - 3 bytes in')).toEqual([381])
    expect(citedRoutines('routine 12')).toEqual([12])
  })

  it("ignores another version's numbering", () => {
    // 1.50 renumbered X Raster from 192 to 204, so "1.40's routine 192" says
    // nothing about which keyword owns 192 in the version being checked
    expect(citedRoutines("routine 204 ($4e9a; 1.40's routine 192, $4f68)")).toEqual([204])
  })
})

describe('self-citation', () => {
  const own = new Map([
    ['x raster', new Set([204])],
    ['odd', new Set([192])],
  ])
  const named = new Map([
    [204, ['x raster']],
    [192, ['odd']],
  ])

  it('flags a keyword whose prose names another keyword and never its own', () => {
    const src = ["    'x raster': () => VI(0),", "    'odd': () => VI(0),"].join('\n')
    const text = `/**\n * =X Raster — routine 192 reads $dff007.\n */\n${src}`
    const anchors = findAnchors(text, (n) => own.has(n))
    expect(anchors.map((a) => a.name)).toEqual(['x raster', 'odd'])
    expect(checkSelfCitation(text, anchors, own, named).map((q) => [q.name, q.cited])).toEqual([['x raster', [192]]])
  })

  it('says nothing when the keyword cites itself', () => {
    const text = `/**\n * =X Raster — routine 204 reads $dff007.\n */\n    'x raster': () => VI(0),`
    expect(checkSelfCitation(text, findAnchors(text, (n) => own.has(n)), own, named)).toEqual([])
  })

  it('attributes a block to what FOLLOWS it, not to whatever is nearest', () => {
    // the trap the first attempt fell into: a twenty-line block above a
    // three-line handler is nearer the handler BEFORE it
    const text = [
      "    'odd': () => VI(0),",
      '    /**',
      ...Array.from({ length: 12 }, () => '     * padding'),
      '     * =X Raster — routine 204 reads $dff007.',
      '     */',
      "    'x raster': () => VI(0),",
    ].join('\n')
    expect(checkSelfCitation(text, findAnchors(text, (n) => own.has(n)), own, named)).toEqual([])
  })
})

/**
 * A manual is evidence, and an unopened one is a silent hazard.
 *
 * The failure this catches is specific and has happened: a classification that
 * cites a real source LINE and then describes the keyword from its NAME.
 * `Jd Squash` was recorded as "rewrites a file in place through trackdisk to
 * defragment it (+|jd.s:5013)" -- the line is right, and the line directly
 * above it is the author's own `SQUASH string,richtung,delay`, which says it
 * is a text effect. `Jd Rprint` was "through the printer path" and never
 * touches a printer; `Jd Request` was "a file requester" and is an intuition
 * AutoRequest. All three would have been caught by opening the manual, which
 * gives every keyword a one-line Funktion.
 *
 * A citation cannot be checked against prose mechanically. What CAN be checked
 * is that the manual a manifest declares was opened at all, so this asserts
 * every ported extension names one of its own docs somewhere in the port.
 */
/** every extension id some port file already cites, i.e. every ported one */
const CITED_BY_IDS = new Set(Object.values(CITED_BY).flat())

describe('declared documentation is cited', () => {
  it('every ported extension names one of its own docs', () => {
    const all = readdirSync(join(src, 'runtime'))
      .filter((f) => f.endsWith('.ts'))
      .map((f) => readFileSync(join(src, 'runtime', f), 'latin1'))
      .join('\n')
      .concat(readFileSync(join(src, 'coverage', 'status.ts'), 'latin1'))
    const missing: string[] = []
    for (const f of readdirSync(join(src, 'ext', 'manifests'))) {
      const m = JSON.parse(readFileSync(join(src, 'ext', 'manifests', f), 'utf8')) as {
        id: string
        evidence?: string
        docs?: string[]
      }
      // only extensions with a handler registered: an unported one has
      // nothing to cite from yet
      if (!CITED_BY_IDS.has(m.id)) continue
      // and only the ones with no author source. Where the source ships, it
      // outranks the prose and the manual is a cross-check rather than the
      // evidence; where it does not, the manual is the ONLY thing that can
      // catch a keyword described from its name
      if (m.evidence !== 'disassembly') continue
      // a trailing slash is a directory of documentation, not a file to name
      const docs = (m.docs ?? []).filter((d) => !d.endsWith('/'))
      if (docs.length === 0) continue
      if (!docs.some((d) => all.includes(d))) missing.push(`${m.id} declares ${docs.join(', ')} and cites none`)
    }
    expect(missing).toEqual([])
  })
})

/**
 * A quote attributed to a document must be in that document.
 *
 * This is the check the n/a audit wanted and could not have: prose cannot be
 * verified against a routine mechanically, but a QUOTE can be verified against
 * a file. It only works when the file is vendored and the quote is verbatim,
 * which is why both are required.
 *
 * AmigaGuide needs unpicking first. `@{"Mui Begin" link C_MuiNew}` renders as
 * the words "Mui Begin", so the markup has to be replaced by its TEXT rather
 * than deleted -- deleting it removes the keyword names and makes honest
 * quotes look invented. `@{i}`/`@{ui}` carry no text and go. `[4\2\Powerpacker
 * Library]` is the older link form, brackets and all. Double quotes become
 * single because a JSDoc quote cannot nest them, and case is ignored because a
 * quote spliced into a sentence gets its first letter lowered.
 *
 * Quotes containing a backtick are skipped: those are renderings of code with
 * the port's own formatting, not passages lifted from prose.
 */
const guideText = (dir: string): string => {
  const files = readdirSync(dir).filter((f) => f.endsWith('.guide'))
  return files
    .map((f) => readFileSync(join(dir, f), 'latin1'))
    .join('\n')
    .replace(/@\{\s*"([^"]*)"[^}]*\}/g, '$1')
    .replace(/@\{[^}]*\}/g, '')
    .replace(/\[[0-9]+\\[0-9]+\\([^\]]*)\]/g, '$1')
    .replace(/"/g, "'")
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

describe('quotes attributed to a guide are verbatim', () => {
  it('every guide-attributed quote in easylife.ts is in a vendored guide', () => {
    const guides = join(root, 'fixtures', 'extensions', 'easylife-1.10', 'Docs', 'extensions')
    const all = guideText(guides)
    const text = readFileSync(join(src, 'runtime', 'easylife.ts'), 'latin1')
    const lines = text.split('\n')
    const bad: string[] = []
    for (const m of text.matchAll(/"([^"]{15,400})"/g)) {
      const ln = text.slice(0, m.index).split('\n').length
      if (!lines[ln - 1]!.trimStart().startsWith('*')) continue
      // only quotes the surrounding comment attributes to the guide
      if (!lines.slice(Math.max(0, ln - 5), ln).join(' ').toLowerCase().includes('guide')) continue
      if (m[1]!.includes('`')) continue
      const q = m[1]!
        .replace(/\n\s*\*/g, ' ')
        .replace(/"/g, "'")
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase()
      // an ellipsis is a deliberate elision: each side must still be verbatim
      const parts = q.split('...').map((x) => x.trim()).filter((x) => x.length >= 12)
      const probes = parts.length > 0 ? parts : [q]
      if (!probes.every((probe) => all.includes(probe))) bad.push(`easylife.ts:${ln} ${q.slice(0, 90)}`)
    }
    expect(bad).toEqual([])
  })
})
