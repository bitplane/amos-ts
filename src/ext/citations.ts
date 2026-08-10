/**
 * Checking that the port's citations still name the code they claim to.
 *
 * Every extension keyword this port implements carries a note saying which
 * 68k routine it was read from — "routine 353 ($6f2a)". The number and the
 * address are redundant, deliberately: the number is what a reader types into
 * extdis, and the address is what proves the number was right when it was
 * written down.
 *
 * That redundancy earned its keep. #176 fixed a disassembler bug that had
 * desynchronised the jump table, which moved every routine number in AMCAF by
 * fourteen; #188 then found twenty-four citations across that one extension
 * still on the old numbering, and one of them — Limit Smouse — had led the
 * port to copy the behaviour of a routine that was not the keyword's at all.
 * A stale citation is not a cosmetic problem. It is how a reading gets
 * attributed to code that never said it, and the reading then looks sourced.
 *
 * The check was a shell recipe living in a comment. This is that recipe made
 * a test, with the three things the recipe could not do:
 *
 *   - an address INSIDE the cited routine passes, because a citation
 *     legitimately names an instruction rather than an entry point
 *   - a version-qualified citation is checked against THAT version's library
 *   - the bare `and 213 ($4f8c)` continuation form is recognised, which the
 *     recipe's regex silently skipped along with every `1.40's 311 ($73ec)`
 */

/** One "routine N ($ADDR)" claim, wherever it was written. */
export interface Citation {
  /** the routine number claimed */
  routine: number
  /** the address claimed, as an offset into the code hunk */
  addr: number
  /** a version prefix if the citation carried one: "1.40" from "1.40's 311" */
  version?: string
  /** 1-based line in the file the text came from */
  line: number
  /** the matched text, for the failure message */
  text: string
}

/** the three ways a citation may be introduced; see parseCitations */
const LEAD = String.raw`(?:([0-9]+\.[0-9]+[a-z0-9]*)'s\s+(?:[Rr]outines?\s+)?|[Rr]outines?\s+|(?<=\))\s+and\s+)`

/**
 * Every citation in a block of text.
 *
 * Three lead-ins are accepted, and they are required rather than optional:
 * the word "routine(s)", a version possessive, or an "and" continuing a
 * citation already made — "Routines 212 ($4f44) and 213 ($4f8c)", which has a
 * second citation the shell recipe never saw, and "routine 325 ($7140) /
 * 1.40's 311 ($73ec)", which it also missed.
 *
 * Demanding a lead-in is what keeps the prose out. `number ($hex)` on its own
 * looks specific but is not: "BEAMCON0 ($DFF1DC)" ends in a digit and reads
 * as routine 0, "BPLCON3 ($DFF106)" as routine 3, and "exponent 65 ($41)" as
 * routine 65. All three are in this tree and all three matched the looser
 * pattern this started as.
 *
 * The "and" lead-in demands a closing paren before it, by lookbehind, since
 * that paren belongs to the citation already matched. What it must NOT do is
 * reach across a list of numbers to an address at the end, and the reason is
 * that this tree writes such lists both ways round. In "Routines 178 and 177
 * ($488e)" and "routines 87, 88 and 89 ($327a)" the address belongs to the
 * FIRST number; in "Routines 55 and 54 ($2782)" it belongs to the SECOND,
 * because 55 is the keyword and 54 is the worker it tails into. Nothing in
 * the text distinguishes them.
 *
 * So the parser requires one address per number and `findAmbiguous` reports
 * the list form instead of guessing at it. Guessing would attribute half of
 * them to the wrong routine while looking checked, which is the precise
 * failure this file exists to prevent.
 *
 * The PARALLEL list is the exception, and it is not a guess. "Routines 114,
 * 118, 120, 122 and 124 ($3b20, $3b4c, $3b60, $3b74, $3b88)" gives as many
 * addresses as numbers, so position pins each pair with nothing left over to
 * decide. Only an equal-length list is read this way; anything else still
 * falls to `findAmbiguous`. This shape was invisible to both checks until the
 * re-verification in #195 went looking for it — five real citations that
 * nothing had ever confirmed.
 *
 * `\$` as well as `$` because status.ts holds its text in TypeScript string
 * literals, where the dollar is escaped.
 */
export function parseCitations(text: string): Citation[] {
  const re = new RegExp(String.raw`${LEAD}([0-9]{1,4})\s*\(\\?\$([0-9a-fA-F]{1,6})\)`, 'g')
  const out: Citation[] = []
  for (const m of text.matchAll(re)) {
    out.push({
      routine: Number(m[2]),
      addr: parseInt(m[3]!, 16),
      ...(m[1] === undefined ? {} : { version: m[1] }),
      line: countLines(text, m.index),
      text: m[0],
    })
  }
  const par = new RegExp(
    String.raw`[Rr]outines\s+([0-9]{1,4}(?:\s*,\s*[0-9]{1,4})*\s*(?:,|and|&)\s*[0-9]{1,4})\s*\(((?:\\?\$[0-9a-fA-F]{1,6}\s*,\s*)+\\?\$[0-9a-fA-F]{1,6})\)`,
    'g',
  )
  for (const m of text.matchAll(par)) {
    const nums = m[1]!.split(/\s*(?:,|and|&)\s*/).filter(Boolean).map(Number)
    const addrs = m[2]!.split(/\s*,\s*/).map((a) => parseInt(a.replace(/\\?\$/, ''), 16))
    // unequal is exactly the ambiguity this refuses to resolve; leave it
    if (nums.length !== addrs.length) continue
    for (let i = 0; i < nums.length; i++) {
      out.push({ routine: nums[i]!, addr: addrs[i]!, line: countLines(text, m.index), text: m[0] })
    }
  }
  return out
}

/**
 * Prose that lists several routines and then gives ONE address.
 *
 * "Routines 178 and 177 ($488e)" — the address is 178's. "Routines 55 and 54
 * ($2782)" — the address is 54's, because 55 is the keyword and 54 the worker
 * it tails into. Both shapes read identically and both are in this tree, so
 * neither the checker nor a human can tell which routine is being cited.
 *
 * Reported rather than parsed, and the sweep treats it as a failure: the
 * remedy is to give each number its own address, which costs six characters
 * and makes the note say what it means. An unparseable citation that is
 * silently skipped is worse than a wrong one, because nothing ever revisits
 * it.
 */
export function findAmbiguous(text: string): Array<{ line: number; text: string }> {
  const re = /[Rr]outines\s+[0-9]{1,4}(?:\s*,\s*[0-9]{1,4})*\s+and\s+[0-9]{1,4}\s*\(\\?\$[0-9a-fA-F]{1,6}\)/g
  return [...text.matchAll(re)].map((m) => ({ line: countLines(text, m.index), text: m[0] }))
}

/** nothing between a comment and a handler but more comment */
function onlyCommentary(gap: string): boolean {
  return gap
    .split('\n')
    .every((l) => l.trim() === '' || l.trim().startsWith('//') || l.trim().startsWith('*') || l.trim().startsWith('/*'))
}

function countLines(text: string, upto: number): number {
  let n = 1
  for (let i = 0; i < upto; i++) if (text[i] === '\n') n++
  return n
}

/** One extension's jump table, as the checker needs it. */
export interface Library {
  /** registry id, e.g. "amcaf-1.50" */
  id: string
  /** version part of the id, e.g. "1.50" — what a citation prefix names */
  version: string
  /** routine offsets, from routineAddresses() */
  addr: number[]
  /** so the last routine's extent is known */
  hunkLen: number
}

export interface Mismatch extends Citation {
  /** where the routine really starts, in the library that was checked */
  real: string
}

/**
 * Check every citation against the libraries a file is allowed to name.
 *
 * A citation passes if ANY candidate library puts routine N somewhere that
 * contains the cited address. Several ports legitimately cite two versions in
 * one breath — "routine 324 ($7136) / 1.40's 310 ($73da)" — and when the
 * citation says which version it means, only that one is consulted, so a
 * 1.40 number cannot be waved through by 1.50 agreeing with it by chance.
 *
 * Passing the whole candidate list for unqualified citations is the deliberate
 * looseness. It could in principle accept a 1.40 address written without its
 * prefix; what it cannot do is accept an address that no version ever had,
 * which is the failure this exists to catch and was every one of #188's.
 */
export function checkCitations(cites: Citation[], libs: Library[]): Mismatch[] {
  const out: Mismatch[] = []
  for (const c of cites) {
    const candidates = c.version === undefined ? libs : libs.filter((l) => l.version === c.version)
    // a citation naming a version this file was not given is unresolvable
    // rather than wrong; report it as such rather than guessing
    if (candidates.length === 0) {
      out.push({ ...c, real: `no library for version ${c.version}` })
      continue
    }
    const hit = candidates.some((l) => {
      const from = l.addr[c.routine]
      if (from === undefined) return false
      const to = l.addr[c.routine + 1] ?? l.hunkLen
      return c.addr >= from && c.addr < to
    })
    if (hit) continue
    out.push({
      ...c,
      real: candidates
        .map((l) => {
          const from = l.addr[c.routine]
          return `${l.id} routine ${c.routine} is ${from === undefined ? 'absent' : `$${from.toString(16)}`}`
        })
        .join(', '),
    })
  }
  return out
}

/**
 * Every routine number a passage mentions, however it mentions it.
 *
 * Looser than `parseCitations` on purpose: this one wants the numbers, not
 * the provenance, so it takes bare "routine 68" as well as "routine 68
 * ($xyz)", and it expands the range forms. "Routines 17 to 23" covers seven
 * keywords in one breath and reading it as a citation of 17 alone was the
 * only thing the self-citation check flagged on its first run — a false
 * positive that would have taught its reader to ignore it.
 */
export function citedRoutines(text: string): number[] {
  return citedRoutinesAt(text).flatMap((c) => c.routines)
}

/** the same, keeping where each mention was, which the attribution needs */
export function citedRoutinesAt(text: string): Array<{ at: number; routines: number[] }> {
  const out: Array<{ at: number; routines: number[] }> = []
  const re =
    /([0-9]+\.[0-9]+[a-z0-9]*'s\s+)?[Rr]outines?\s+([0-9]{1,4})(?:\s*(?:to|through|-|–)\s*([0-9]{1,4}))?((?:\s*,\s*[0-9]{1,4})*(?:\s*(?:and|&)\s*[0-9]{1,4})?)/g
  for (const m of text.matchAll(re)) {
    // "1.40's routine 192" is a number in ANOTHER version's table, so it says
    // nothing about which keyword owns 192 here
    if (m[1] !== undefined) continue
    const from = Number(m[2])
    const to = m[3] === undefined ? from : Number(m[3])
    // a descending or absurd span is prose that happens to have two numbers
    const routines = to < from || to - from > 64 ? [from] : Array.from({ length: to - from + 1 }, (_, i) => from + i)
    // "Routines 114, 118, 120, 122 and 124" — a list, not a span. The comma
    // must sit against the digits, so "routine 1121, the bank" does not read
    // "the bank" as a number and prose cannot wander in.
    for (const n of m[4]?.match(/[0-9]{1,4}/g) ?? []) routines.push(Number(n))
    out.push({ at: m.index, routines })
  }
  return out
}

/** where a keyword handler is defined, and which keyword it is */
export interface Anchor {
  name: string
  /** character index of the definition */
  at: number
}

/**
 * The keyword handlers a port file defines, in order.
 *
 * The shapes are `'pt play'(it) {`, `'pt cpos': () =>` and `pjoy: (_, a) =>`
 * — quoted or bare, method or property — all at one indent inside the table
 * object. `known` filters out the helpers and the ordinary object literals
 * that would otherwise look identical.
 */
export function findAnchors(text: string, known: (name: string) => boolean): Anchor[] {
  const out: Anchor[] = []
  for (const m of text.matchAll(/^ {2,6}(?:'([^']+)'|([a-z][a-z0-9$ ]*))\s*[:(]/gm)) {
    const name = (m[1] ?? m[2] ?? '').trim().toLowerCase()
    if (name !== '' && known(name)) out.push({ name, at: m.index })
  }
  return out
}

/**
 * Check (b): a keyword's own prose should not cite ANOTHER keyword's routine
 * while never citing its own.
 *
 * This is the check that caught `splinters single do` and four others, where
 * the port had read a neighbouring keyword's routine and written up the
 * wrong behaviour under a name that then looked sourced. Check (a) cannot see
 * it: those citations were internally consistent, number and address both
 * naming a real routine. Just not that keyword's.
 *
 * Attribution is STRUCTURAL, and the first attempt at it — nearest anchor on
 * either side — was wrong in a way worth recording, because it looked
 * plausible and flagged thirty-odd keywords. A doc block above a handler can
 * be twenty lines long while the handler before it is three, so "nearest"
 * picks the previous keyword essentially every time. What is actually true is
 * simpler: a `/** ... *\/` block documents the handler AFTER it, and a line
 * comment documents the handler it sits INSIDE.
 *
 * A citation too far from any handler is a section or file header and is
 * skipped rather than blamed on whichever keyword happens to be adjacent.
 *
 * Silence is the expected result and a flag is a question, not a verdict: a
 * keyword may legitimately be explained through a sibling's routine. What it
 * may not do is explain itself ONLY through one.
 *
 * "Never its own" is a claim about the KEYWORD, so the verdict is reached per
 * keyword and not per citation. The first version decided it per citation site
 * and so contradicted its own sentence: a doc block that opens by citing its
 * own routine and then explains a sibling's was flagged once for every later
 * mention. `make bank font` cites routine 139 on its first line and was
 * flagged three times for citing 140 below it, which is exactly the shape of a
 * block that is doing the right thing. A keyword is now flagged only if NO
 * citation anywhere in its prose names a routine of its own, and the report
 * then names the first place it went looking elsewhere.
 */
export function checkSelfCitation(
  text: string,
  anchors: Anchor[],
  own: Map<string, Set<number>>,
  named: Map<number, string[]>,
): Array<{ name: string; line: number; cited: number[] }> {
  if (anchors.length === 0) return []
  const blocks = [...text.matchAll(/\/\*[\s\S]*?\*\//g)].map((m) => ({ from: m.index, to: m.index + m[0].length }))
  // keyed by the anchor's position, which is unique within one file where a
  // keyword NAME need not be — an extension may implement the same name twice
  const found = new Map<number, { name: string; line: number | null; cited: number[]; self: boolean }>()
  for (const m of citedRoutinesAt(text)) {
    const cited = m.routines
    if (cited.length === 0) continue
    const block = blocks.find((b) => m.at >= b.from && m.at < b.to)
    // whichever kind of comment it is, if only comment and blank lines stand
    // between it and the next handler then it documents that handler
    const from = block ? block.to : text.indexOf('\n', m.at) + 1
    const anchor =
      anchors.find((a) => a.at >= from && onlyCommentary(text.slice(from, a.at))) ??
      (block ? undefined : [...anchors].reverse().find((a) => a.at <= m.at))
    if (!anchor) continue
    // a citation a long way from its handler is a section header, not a claim
    // about a keyword
    const gap = Math.abs(countLines(text, Math.max(anchor.at, m.at)) - countLines(text, Math.min(anchor.at, m.at)))
    if (gap > 60) continue
    const mine = own.get(anchor.name) ?? new Set<number>()
    const q = found.get(anchor.at) ?? { name: anchor.name, line: null, cited: [], self: false }
    found.set(anchor.at, q)
    if (cited.some((c) => mine.has(c))) {
      q.self = true
      continue
    }
    for (const c of cited) {
      if (!named.has(c) || mine.has(c)) continue
      // the line reported is where it FIRST went looking elsewhere, so a
      // mention of some unnamed helper does not claim the report's one line
      q.line ??= countLines(text, m.at)
      if (!q.cited.includes(c)) q.cited.push(c)
    }
  }
  const out: Array<{ name: string; line: number; cited: number[] }> = []
  for (const q of found.values()) {
    if (q.self || q.line === null || q.cited.length === 0) continue
    out.push({ name: q.name, line: q.line, cited: q.cited })
  }
  return out
}

/**
 * Which extension a citation in a given file may name.
 *
 * There is no deriving this. `turbo.ts` is turbo-plus, `jdcolour.ts` is
 * jd-colour, `amcaf.ts` cites two versions of AMCAF in the same doc blocks,
 * and a port file's name matching a registry id is a coincidence rather than
 * a rule. So it is written down — and `citations.test.ts` asserts that every
 * file in the tree carrying a citation appears here, which is what stops a
 * new port from being silently unchecked.
 *
 * The order matters only for the failure message; a citation passes on any.
 */
export const CITED_BY: Record<string, string[]> = {
  'src/runtime/amcaf.ts': ['amcaf-1.50', 'amcaf-1.40'],
  // the core's Sload/Ssave answer for AMCAF's too, and their doc block cites
  // AMCAF's routines 106 and 107 to record where the two diverge -- so the
  // core file is checked against AMCAF's binary for those two citations
  // amcaf for the contested-name notes; easylife-1.0 because the alias map
  // that lives here cites the 1.0 routines it is mapping away from
  // easylife-1.10 for the guide node that names the keyword 1.0's Zb Install
  // became; easylife-1.0 for the routines the alias map points away from
  'src/runtime/instr.ts': ['amcaf-1.50', 'easylife-1.0', 'easylife-1.10'],
  // ldos because Pattern Match's case handling is contrasted with LDos's,
  // which the block quotes from LDos's own manual
  'src/runtime/amcaf.test.ts': ['amcaf-1.50', 'amcaf-1.40', 'ldos-2.6'],
  'src/runtime/aga.ts': ['aga-1.0'],
  'src/runtime/aga.test.ts': ['aga-1.0'],
  'src/runtime/tft.ts': ['tft-0.6'],
  'src/runtime/sticks.ts': ['sticks-1.01b'],
  'src/runtime/gamesupport.ts': ['gamesupport-1.2'],
  'src/runtime/gamesupport.test.ts': ['gamesupport-1.2'],
  'src/runtime/sln.ts': ['sln-2.0'],
  'src/runtime/sln.test.ts': ['sln-2.0'],
  'src/runtime/make.ts': ['make-1.30'],
  'src/runtime/make.test.ts': ['make-1.30'],
  'src/runtime/tools.ts': ['tools-1.01'],
  'src/runtime/tools.test.ts': ['tools-1.01'],
  'src/runtime/delta.ts': ['delta-1.4'],
  'src/runtime/delta.test.ts': ['delta-1.4'],
  'src/runtime/lserial.ts': ['lserial-2.1'],
  'src/runtime/lserial.test.ts': ['lserial-2.1'],
  'src/runtime/butility.ts': ['butility-1.21'],
  'src/runtime/butility.test.ts': ['butility-1.21'],
  'src/runtime/stars.ts': ['stars-2.33'],
  'src/runtime/stars.test.ts': ['stars-2.33'],
  'src/runtime/opal.ts': ['opal-1.1'],
  'src/runtime/opal.test.ts': ['opal-1.1'],
  'src/runtime/locale.ts': ['locale-0.26'],
  'src/runtime/locale.test.ts': ['locale-0.26'],
  'src/runtime/ldos.ts': ['ldos-2.6', 'ldos-2.5'],
  'src/runtime/ldos.test.ts': ['ldos-2.6', 'ldos-2.5'],
  'src/runtime/ldoslz.ts': ['ldos-2.6', 'ldos-2.5'],
  'src/runtime/ctext.ts': ['ctext-1.0'],
  'src/runtime/ctext.test.ts': ['ctext-1.0'],
  'src/runtime/turbo.ts': ['turbo-plus-2.15', 'turbo-plus-1.9', 'turbo-plus-1.0'],
  'src/runtime/turbo.test.ts': ['turbo-plus-2.15', 'turbo-plus-1.9', 'turbo-plus-1.0'],
  // 5.3 FIRST: the first id is the release the port was read from, and the
  // source in fixtures (`|jd.s`, header "V4.8") numbers its routines the way
  // 5.3's table does. Listing 5.9 first made `Jd Draw Segment`'s correct
  // citation of routine 160 look like it named a sibling, because 5.9 moved
  // that keyword to 165 and put Jd Dpath at 160.
  // jd-k3 because the JD state block carries JD-K3's settings, cited to K3's
  // own manual
  'src/runtime/jd.ts': ['jd-5.3', 'jd-5.9', 'jd-4.6', 'jd-k3-1.1'],
  'src/runtime/jd.test.ts': ['jd-5.3', 'jd-5.9', 'jd-4.6'],
  'src/runtime/jdcolour.ts': ['jd-colour-2.0', 'jd-colour-1.4'],
  'src/runtime/jdcolour.test.ts': ['jd-colour-2.0', 'jd-colour-1.4'],
  'src/runtime/jdk3.ts': ['jd-k3-1.1'],
  'src/runtime/jdk3.test.ts': ['jd-k3-1.1'],
  'src/runtime/jdprt.ts': ['jd-prt-1.4', 'jd-prt-1.3', 'jd-prt-1.1'],
  'src/runtime/jvp.ts': ['jvp-1.01'],
  'src/runtime/personnal.ts': ['personnal-1.1', 'personal-1.0b', 'personnal-extra-1.0a'],
  'src/runtime/personnal.test.ts': ['personnal-1.1', 'personal-1.0b', 'personnal-extra-1.0a'],
  'src/runtime/td.ts': ['amos3d-1.0'],
  'src/runtime/ioports.ts': ['serial-1.2'],
  // 4.23 FIRST: 3.1 is a strict PREFIX of it -- same ids, specs and routine
  // numbers for its 35 entries -- so every citation holds for either, and the
  // longer table is the one that can resolve all of them
  'src/amiga/p61.ts': ['p61-1.2'],
  'src/runtime/p61.ts': ['p61-1.2'],
  'src/runtime/p61.test.ts': ['p61-1.2'],
  'src/runtime/powerbobs.ts': ['powerbobs-1.0'],
  'src/runtime/powerbobs.test.ts': ['powerbobs-1.0'],
  'src/runtime/tome.ts': ['tome-4.23', 'tome-3.1'],
  'src/runtime/tome.test.ts': ['tome-4.23', 'tome-3.1'],
  'src/runtime/medext.ts': ['med-7.1'],
  'src/runtime/colours.ts': ['amospro-colours-1.0'],
  'src/runtime/colours.test.ts': ['amospro-colours-1.0'],
  'src/runtime/miscext.ts': ['misc-1.0'],
  'src/runtime/miscext.test.ts': ['misc-1.0'],
  'src/runtime/plib.ts': ['personnal-extra-1.0a'],
  'src/runtime/plib.test.ts': ['personnal-extra-1.0a'],
  // the AMOS Pro build FIRST: it is the one the ten shared keywords were read
  // from. `med tempo` and `tr credits` exist only in the AMOS 1.3 build and
  // their citations are numbered against it, which is why both are listed
  'src/runtime/eme.ts': ['eme-3.0', 'eme-3.0-demo'],
  'src/runtime/eme.test.ts': ['eme-3.0', 'eme-3.0-demo'],
  'src/runtime/medext.test.ts': ['med-7.1'],
  'src/runtime/ercole.ts': ['ercole-1.7'],
  'src/runtime/ercole.test.ts': ['ercole-1.7'],
  // 1.10 FIRST: it is the build every citation is numbered against, and 1.09
  // shares its jump table entry for entry over this range. 1.44 rebuilt the
  // table, so its numbers differ and nothing here cites them
  // 1.44 is here for the two keywords only it has; the port is numbered
  // against 1.10, so that stays first -- see the comment on the loop below
  'src/runtime/easylife.ts': ['easylife-1.10', 'easylife-1.09', 'easylife-1.44', 'easylife-1.0'],
  // the companion library's own routines are cited by ADDRESS, since it has
  // no jump table to number them against; what this catches is the handful of
  // EXTENSION routines its header names -- 269, 270, 300
  'src/runtime/elstruct.ts': ['easylife-1.10', 'easylife-1.09'],
  'src/runtime/easylife.test.ts': ['easylife-1.10', 'easylife-1.09', 'easylife-1.44'],
  // not an EasyLife port: boopsi.ts models intuition.library's object system,
  // and cites EasyLife's routines because its hand-rolled dispatch is the
  // independent confirmation of the two struct offsets the whole file rests on
  'src/amiga/boopsi.ts': ['easylife-1.10', 'easylife-1.09'],
  // same reason: muimaster.ts and its test cite EasyLife's routines because
  // its hand-rolled dispatch and its Tags bank are what the header is checked
  // against -- 233 for the library open, 215 for the MUIP_Notify layout
  'src/amiga/muimaster.ts': ['easylife-1.10', 'easylife-1.09'],
  'src/amiga/muimaster.test.ts': ['easylife-1.10', 'easylife-1.09'],
  'src/runtime/elmui.ts': ['easylife-1.10', 'easylife-1.09'],
  'src/runtime/range.ts': ['range-1.0', 'range-2.0'],
  'src/runtime/range.test.ts': ['range-1.0', 'range-2.0'],
  'src/runtime/first.ts': ['first-0.1'],
  'src/runtime/first.test.ts': ['first-0.1'],
  'src/runtime/fileid.ts': ['fileid-1.0'],
  'src/runtime/fileid.test.ts': ['fileid-1.0'],
  'src/runtime/dump.ts': ['dump-1.0'],
  'src/runtime/dump.test.ts': ['dump-1.0'],
  'src/runtime/jotre.ts': ['jotre-1.0'],
  'src/runtime/jotre.test.ts': ['jotre-1.0'],
}
