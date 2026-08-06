import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseAmosFile } from '../loader/amosfile'
import { parseSource, TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { assembleTokenSource, tokensFromSource, SYMBOLIC } from './tokensrc'
import { REGISTRY, allExtensions, extensionById, defaultSlotBindings } from './registry'
import { collectUsage, identifyProgram, identifySlot, specArity, type SlotUsage } from './identify'

type SlotUsageAcc = SlotUsage

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const extFixtures = join(root, 'fixtures', 'extensions')
const core = new TokenTable(CORE_TOKENS)

function parseProgram(path: string) {
  const amos = parseAmosFile(readFileSync(path))
  return parseSource(amos.source, core)
}

/** Every .AMOS shipped alongside an extension fixture. */
function extensionPrograms(): string[] {
  const out: string[] = []
  if (!existsSync(extFixtures)) return out
  for (const dir of readdirSync(extFixtures)) {
    const progs = join(extFixtures, dir, 'progs')
    if (!existsSync(progs)) continue
    for (const f of readdirSync(progs)) if (/\.amos$/i.test(f)) out.push(join(progs, f))
  }
  return out
}

describe('token-table source assembler (src/ext/tokensrc.ts)', () => {
  it('lays out an entry exactly as parseTokenTable reads it back', () => {
    const src = `
	dc.w -1,L_Something
	dc.b "ha",$80+'m',"0",-1
	dc.w L_Other,-1
	dc.b "iscreen clos",$80+'e',"I0",-1
`
    const toks = tokensFromSource(src)
    expect(toks).toHaveLength(2)
    expect(toks[0]).toMatchObject({ id: 0, name: 'ham', spec: '0' })
    // -1 in the instruction word marks "function only", and vice versa
    expect(toks[0]!.instr).toBe(0xffff)
    expect(toks[0]!.func).toBe(SYMBOLIC)
    expect(toks[1]).toMatchObject({ name: 'iscreen close', spec: 'I0' })
    expect(toks[1]!.func).toBe(0xffff)
    // entry 0 is 4 bytes of routine words + "ham" + spec "0" + $FF = 9, padded to 10
    expect(toks[1]!.id).toBe(10)
  })

  it('honours ifd/else/endc so the right build is assembled', () => {
    const src = `
      ifd CREATOR
	dc.w -1,L_A
	dc.b "creator onl",$80+'y',"0",-1
      else
	dc.w -1,L_B
	dc.b "pro onl",$80+'y',"0",-1
      endc
`
    expect(tokensFromSource(src).map((t) => t.name)).toEqual(['pro only'])
    expect(tokensFromSource(src, { defines: ['CREATOR'] }).map((t) => t.name)).toEqual(['creator only'])
  })

  it('skips ifne 0 blocks and comments, and word-aligns after odd byte runs', () => {
    const src = `
;	dc.w -1,L_CommentedOut
;	dc.b "gon",$80+'e',"0",-1
    ifne 0
	dc.w -1,L_Disabled
	dc.b "disable",$80+'d',"0",-1
    endc
	dc.w -1,L_Odd
	dc.b "od",$80+'d',"0",-1
	dc.w -1,L_Next
	dc.b "nex",$80+'t',"0",-1
`
    const toks = tokensFromSource(src)
    expect(toks.map((t) => t.name)).toEqual(['odd', 'next'])
    expect(assembleTokenSource(src).length % 2).toBe(0)
    for (const t of toks) expect(t.id % 2).toBe(0)
  })
})

describe('extension registry (src/ext/registry.ts)', () => {
  it('resolves a token table for every registered extension', () => {
    expect(REGISTRY.length).toBeGreaterThan(0)
    for (const info of REGISTRY) {
      const ext = extensionById(info.id)
      expect(ext, info.id).toBeDefined()
      expect(ext!.tokens.length, info.id).toBeGreaterThan(0)
      // token ids are byte offsets, so they must be unique and even
      const ids = ext!.tokens.map((t) => t.id)
      expect(new Set(ids).size, info.id).toBe(ids.length)
      for (const id of ids) expect(id % 2, `${info.id} id ${id}`).toBe(0)
    }
  })

  it('records provenance and an evidence tier for every extension', () => {
    for (const info of REGISTRY) {
      expect(info.provenance.length, info.id).toBeGreaterThan(10)
      // four tiers, as docs/extensions/README.md documents them. `disassembly`
      // was missing here until CText became the first entry to claim it.
      expect(['source', 'disassembly', 'manual', 'table'], info.id).toContain(info.evidence)
      expect(['calibrated', 'assumed'], info.id).toContain(info.idBaseEvidence)
    }
  })

  it('never claims manual or table evidence for an extension we hold a binary for', () => {
    // The governing rule, stated in ./registry.ts and docs/extensions/README.md:
    // the tier records the strongest evidence AVAILABLE, and a shipped library
    // can always be disassembled. So `manual` and `table` belong to the case
    // where there is no binary and a port would be guessing — which is why
    // they are the two tiers that forbid a faithful classification.
    //
    // This is not hypothetical rot. 53 of 68 manifests declared `manual` or
    // `table` with the `.Lib` in the same fixture directory, TURBO Plus 2.15
    // among them, right after a session spent reading its 182 routines. The
    // cause was a heuristic those manifests recorded in their own provenance:
    // the tier had been set by counting how many keyword names appeared in the
    // documentation shipped beside the library. That measures the docs, not
    // the evidence, and the `docs` field is where it belongs.
    //
    // Read from the manifests rather than from REGISTRY because `library` is a
    // manifest field: it is the presence of the binary that the rule turns on,
    // and the manifest is where that is declared.
    const manifests = join(root, 'src', 'ext', 'manifests')
    const offenders: string[] = []
    for (const f of readdirSync(manifests).filter((n) => n.endsWith('.json'))) {
      const m = JSON.parse(readFileSync(join(manifests, f), 'utf8')) as {
        id: string
        library?: string
        evidence: string
      }
      if (m.library && (m.evidence === 'manual' || m.evidence === 'table')) {
        offenders.push(`${m.id} says ${m.evidence} but ships ${m.library}`)
      }
    }
    expect(
      offenders,
      'a held binary outranks any manual — raise these to `disassembly`, or ' +
        'to `source` if the assembler source is available too',
    ).toEqual([])
  })

  /**
   * An id is a KEY, not a version claim.
   *
   * Seven ids carry a version suffix their own `version` field contradicts —
   * `ctext-1.0` is version 1.32, `range-2.0` is 2.9Plus — and that is
   * deliberate every time: the id was assigned before the binary was read, and
   * renaming it would break the citations, the coverage manifest and every
   * test that names it. The `version` field is what the library says about
   * itself; the id is the spelling everything else refers to it by.
   *
   * Deliberate is not the same as safe, though. `personnal-extra-1.0a` was
   * RENAMED when its source settled the version at 1.0a, and the `version`
   * field was left reading 1.3 — the exact value the rename existed to
   * correct. So the rule is checked: where the two disagree, the manifest's
   * own prose must state the authoritative version, which is the thing that
   * makes the disagreement readable rather than a discrepancy.
   */
  it('explains every id whose version suffix disagrees with its version field', () => {
    const manifests = join(root, 'src', 'ext', 'manifests')
    const offenders: string[] = []
    for (const f of readdirSync(manifests).filter((n) => n.endsWith('.json'))) {
      const m = JSON.parse(readFileSync(join(manifests, f), 'utf8')) as {
        id: string
        version?: string
        notes?: string
        provenance?: { note?: string }
      }
      const suffix = /-([0-9][0-9a-z.]*)$/.exec(m.id)?.[1]
      if (!suffix || !m.version) continue
      // "Beta 1.5" against a `1.5b` suffix is the same release spelled two
      // ways — compare the dotted numbers, which is the part an id encodes
      const dotted = (s: string) => /[0-9]+(\.[0-9]+)*/.exec(s)?.[0] ?? ''
      if (dotted(suffix) === dotted(m.version)) continue
      const prose = `${m.notes ?? ''} ${m.provenance?.note ?? ''}`
      if (!prose.includes(m.version)) {
        offenders.push(`${m.id} is version ${m.version} and neither note says so`)
      }
    }
    expect(
      offenders,
      'the id is a stable key and the version field is authoritative — say so ' +
        'in the notes, quoting what the binary or its documentation states',
    ).toEqual([])
  })

  it('binds the stock extensions to the slots +Interpreter_Config.s gives them', () => {
    // message 15+n holds the filename for slot n (+B.s:2149-2166)
    const bound = defaultSlotBindings()
    expect([...bound.keys()].sort((a, b) => a - b)).toEqual([1, 2, 3, 5, 6])
    expect(bound.get(1)!.name).toBe('Music')
    expect(bound.get(6)!.name).toBe('IOPorts')
    // slot 4 is empty in the stock config, and nothing may invent a binding
    expect(bound.get(4)).toBeUndefined()
  })

  it('keys the registry by identity, never by slot', () => {
    const ids = REGISTRY.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
    // several third-party extensions have no slot of their own at all
    const slotless = REGISTRY.filter((e) => e.defaultSlot === undefined)
    expect(slotless.length).toBeGreaterThan(0)
  })
})

const ITOKENS = join(extFixtures, 'intuition-1.3b', 'itokens.s')

describe.skipIf(!existsSync(ITOKENS))('Intuition 1.3b token table, assembled from its own source', () => {
  // read lazily: vitest still runs a skipped describe's body, so an eager
  // readFileSync here would break collection in a fixture-less checkout
  const toks = existsSync(ITOKENS) ? tokensFromSource(readFileSync(ITOKENS, 'latin1')) : []

  it('reproduces keywords listed in the extension’s own cmdlist', () => {
    const cmdlist = readFileSync(join(extFixtures, 'intuition-1.3b', 'cmdlist'), 'latin1')
    const names = new Set(toks.filter((t) => t.name).map((t) => t.name.replace(/^!/, '')))
    // cmdlist lines are real syntax lines: "=Ifont$", "Igadget Active All", ...
    const listed = cmdlist
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l !== '')
      .map((l) => l.replace(/^=/, '').toLowerCase())
    let matched = 0
    for (const l of listed) if ([...names].some((n) => l.startsWith(n))) matched++
    expect(matched / listed.length).toBeGreaterThan(0.9)
  })

  it('is pinned by exactly one id base across every program that uses it', () => {
    // A token id is the byte offset of its entry, measured from a fixed base
    // just before the table. We do not know that base a priori, so we search
    // for it: if the table is the right one, exactly one offset will map every
    // observed id onto a real entry start. Any other table, or a wrong base,
    // leaves ids unexplained.
    const observed = new Set<number>()
    for (const f of extensionPrograms()) {
      for (const ln of parseProgram(f)) {
        for (const t of ln.tokens) if (t.kind === 'ext' && t.ext === 14) observed.add(t.id)
      }
    }
    expect(observed.size).toBeGreaterThan(100)

    const offsets = new Set(toks.map((t) => t.id))
    const fits: number[] = []
    for (let k = -2048; k <= 2048; k += 2) {
      if ([...observed].every((id) => offsets.has(id - k))) fits.push(k)
    }
    expect(fits).toEqual([6])
    // and that is the base the registry ships
    const ext = extensionById('intuition-1.3b')!
    for (const id of observed) expect(ext.tokens.some((t) => t.id === id), `id $${id.toString(16)}`).toBe(true)
  })
})

describe.skipIf(!existsSync(extFixtures))('slot identification (src/ext/identify.ts)', () => {
  it('counts arguments from a parameter spec', () => {
    expect(specArity('I')).toBe(0) // instruction, no arguments
    expect(specArity('I0')).toBe(1)
    expect(specArity('I0,0,2')).toBe(3)
    expect(specArity('I0,0t0,0')).toBe(4) // "t" is the To separator
    expect(specArity('0')).toBe(0) // function returning an int, no arguments
    expect(specArity('00')).toBe(1)
    expect(specArity('2')).toBe(0) // function returning a string
  })

  it('identifies Intuition from a program that uses it, with no slot hint', () => {
    const prog = join(extFixtures, 'intuition-1.3b', 'progs', 'inttest.amos')
    const ids = identifyProgram(parseProgram(prog))
    const slot14 = ids.get(14)
    expect(slot14).toBeDefined()
    expect(slot14!.best?.id).toBe('intuition-1.3b')
    expect(slot14!.confidence).toBe('exact')
    expect(slot14!.unresolvedIds).toEqual([])
  })

  it('rejects every other registered extension for that slot', () => {
    const prog = join(extFixtures, 'intuition-1.3b', 'progs', 'inttest.amos')
    const usage = collectUsage(parseProgram(prog)).get(14)!
    const { candidates } = identifySlot(usage)
    const survivors = candidates.filter((c) => !c.rejected)
    expect(survivors.map((c) => c.ext.id)).toEqual(['intuition-1.3b'])
    // and the rejections are reasoned, not silent
    for (const c of candidates) {
      if (c.rejected) expect(c.rejected.length).toBeGreaterThan(10)
    }
  })

  it('does not care which slot the extension was installed in', () => {
    // The same fingerprint moved to a different slot must still identify: the
    // slot is a property of the machine it was saved on, not of the program.
    const prog = join(extFixtures, 'intuition-1.3b', 'progs', 'inttest.amos')
    const usage = collectUsage(parseProgram(prog)).get(14)!
    const moved = { ...usage, slot: 22 }
    expect(identifySlot(moved).best?.id).toBe('intuition-1.3b')
  })

  /**
   * The trap that sweep phase 2 was chasing. A slot number belongs to the
   * machine, so two programs can hold different extensions at the same one;
   * merging their ids asks a question nothing has to answer. Slot 12 of the
   * local archive read as a missing fourth TURBO build merged, and is 105
   * programs on 1.9 plus 48 on 1.0 per program.
   */
  it('merging two programs that held different extensions in one slot identifies neither', () => {
    const a = collectUsage(parseProgram(join(extFixtures, 'intuition-1.3b', 'progs', 'inttest.amos'))).get(14)!
    // a second program in the same slot, using ids Intuition does not have
    const b: SlotUsage = { slot: 14, uses: new Map([[0x1234, new Set([1])]]), count: 1 }
    expect(identifySlot(a).best?.id).toBe('intuition-1.3b')
    expect(identifySlot(b).best).toBeUndefined()

    const mergedUses = new Map(a.uses)
    for (const [id, n] of b.uses) mergedUses.set(id, n)
    const merged: SlotUsage = { slot: 14, uses: mergedUses, count: a.count + b.count }
    // merged, the program that WAS identified stops being: one stray id from
    // its neighbour disqualifies the extension it actually used
    const id = identifySlot(merged)
    expect(id.best).toBeUndefined()
    // and the damage is not one id but all of them. With nothing identified
    // there is no table to subtract, so every id the slot ever used is
    // reported as unexplained — which is how one stray id turned into a
    // wanted list of 119. Across the local archive it was 758 ids; asking per
    // program instead leaves 53.
    expect(id.unresolvedIds).toContain(0x1234)
    expect(id.unresolvedIds).toHaveLength(a.uses.size + 1)
  })

  it('reports unknown rather than guessing when nothing explains the ids', () => {
    const usage = {
      slot: 9,
      uses: new Map([[0x1234, new Set([2])], [0x5678, new Set([1])]]),
      count: 2,
    }
    const id = identifySlot(usage)
    expect(id.confidence).toBe('unknown')
    expect(id.best).toBeUndefined()
    expect(id.unresolvedIds).toEqual([0x1234, 0x5678])
  })

  it('honours an explicit override without consulting the evidence', () => {
    const prog = join(extFixtures, 'intuition-1.3b', 'progs', 'inttest.amos')
    const ids = identifyProgram(parseProgram(prog), { overrides: new Map([[14, 'misc-1.0']]) })
    expect(ids.get(14)!.best?.id).toBe('misc-1.0')
    // the override is honoured, but the mismatch is still visible
    expect(ids.get(14)!.unresolvedIds.length).toBeGreaterThan(0)
  })

  it('identifies the stock extensions used by the official corpus', () => {
    // Music sits in slot 1 on a stock machine; identification must agree with
    // the config rather than contradict it.
    const usage = {
      slot: 1,
      uses: new Map<number, Set<number>>(),
      count: 0,
    }
    const music = extensionById('amospro-music-2.0')!
    for (const t of music.tokens.slice(1, 12)) usage.uses.set(t.id, new Set([0xff]))
    usage.count = usage.uses.size
    const id = identifySlot(usage)
    expect(id.best?.id).toBe('amospro-music-2.0')
  })

  it('uses the recorded argument count to separate legacy libraries', () => {
    // +Verif.s:456-460 records $FF for an AP20 library and the real argument
    // count for an older one, so an arity that contradicts a candidate's spec
    // rules it out even when every id resolves.
    const ext = extensionById('misc-1.0')!
    const entry = ext.tokens.find((t) => t.name !== '')!
    const wrongArity = (specArity(entry.spec) ?? 0) + 3
    const usage = { slot: 23, uses: new Map([[entry.id, new Set([wrongArity])]]), count: 1 }
    const scored = identifySlot(usage).candidates.find((c) => c.ext.id === 'misc-1.0')!
    expect(scored.idCoverage).toBe(1)
    expect(scored.arityAgreement).toBeLessThan(1)
    expect(scored.rejected).toBeTruthy()
  })
})

describe.skipIf(!existsSync(extFixtures))('the whole corpus identifies without a slot map', () => {
  function* walk(p: string): Generator<string> {
    for (const e of readdirSync(p)) {
      const f = join(p, e)
      if (statSync(f).isDirectory()) yield* walk(f)
      else if (/\.amos$/i.test(f)) yield f
    }
  }

  it('resolves every slot used anywhere in the fixture corpus, exactly', () => {
    // The regression oracle for identification: throw away the notion of a
    // configured slot map entirely and let the evidence in each program decide.
    // Every slot the corpus uses must land on exactly one extension with no
    // token id left over. A wrong table, a wrong id base, or a broken arity
    // rule all show up here as an unknown or ambiguous slot.
    const merged = new Map<number, SlotUsageAcc>()
    let scanned = 0
    for (const dir of ['official-amos', 'aga-releases', 'extensions']) {
      const p = join(root, 'fixtures', dir)
      if (!existsSync(p)) continue
      for (const f of walk(p)) {
        let lines
        try {
          const amos = parseAmosFile(readFileSync(f))
          if (amos.source.length === 0) continue
          lines = parseSource(amos.source, core)
        } catch {
          continue
        }
        scanned++
        for (const [slot, usage] of collectUsage(lines)) {
          let m = merged.get(slot)
          if (!m) merged.set(slot, (m = { slot, uses: new Map(), count: 0 }))
          m.count += usage.count
          for (const [id, npars] of usage.uses) {
            let s = m.uses.get(id)
            if (!s) m.uses.set(id, (s = new Set()))
            for (const n of npars) s.add(n)
          }
        }
      }
    }
    expect(scanned).toBeGreaterThan(300)
    expect(merged.size).toBeGreaterThan(3)

    // Slots the corpus genuinely cannot settle, and must not pretend to. Both
    // TOME games that bind slot 9 use ONE id there, $16, twice each, and an
    // id that low is carried by most tables in the registry — so this is not a
    // fingerprint at all. Listing it beats loosening the assertion for every
    // slot: a slot that stops identifying has to be added here deliberately.
    const unidentifiable = new Set([9])

    const resolved: Record<number, string> = {}
    for (const [slot, usage] of merged) {
      const id = identifySlot(usage)
      if (unidentifiable.has(slot)) {
        expect(['ambiguous', 'unknown'], `slot ${slot}`).toContain(id.confidence)
        continue
      }
      // 'exact' everywhere except slot 3. Request uses three keywords, at ids
      // $06/$16/$28, and those three offsets also carry named entries in both
      // CText (ctext / font size / plen) and Range — so once the registry grew
      // past a handful of extensions the id set stopped being a fingerprint at
      // all, and only the observed-slot tiebreak separates them ('probable').
      // That is the slot-collision problem in miniature, and the honest result:
      // three ids are not evidence, however confident a small registry looked.
      expect(['exact', 'probable'], `slot ${slot}`).toContain(id.confidence)
      expect(id.unresolvedIds, `slot ${slot}`).toEqual([])
      resolved[slot] = id.best!.id
    }
    expect(resolved).toEqual({
      1: 'amospro-music-2.0',
      2: 'amospro-compact-2.0',
      3: 'amospro-request-2.0',
      // AMOS 3D's own demo disc, added with the extension's fixtures. Nothing
      // told the identifier where 3D lives; it landed on 4, which is where
      // AMOS 3D has always been installed.
      4: 'amos3d-1.0',
      5: 'amospro-compiler-2.0',
      6: 'amospro-ioports-2.0',
      // seven TOME games, kept as the acceptance corpus for the map engine.
      // Both TOME tables explain every id they use — 3.1 is a strict prefix of
      // 4.23 — so this is the observed-slot tiebreak again rather than a
      // fingerprint, and the corpus cannot tell the two versions apart.
      7: 'tome-4.23',
      // Personnal's own two release archives, added with its fixtures: 69 demo
      // programs, 68 of which drive slot 13 — where the source puts it
      // (ExtNb Equ 13-1). 61 distinct ids, all inside the 1.1a table, so the
      // later version wins outright rather than on a tiebreak.
      13: 'personnal-1.1',
      // and 32 of those same demos also use TURBO Plus, at the slot a stock
      // AMOS Pro install gives it
      12: 'turbo-plus-1.9',
      14: 'intuition-1.3b',
      // OS-DevKit's own documentation ships an example program, which came in
      // with the extension. Every id it uses lands in OS-DevKit's table, which
      // is what turns that entry's id base from assumed into calibrated.
      20: 'os-devkit-1.61',
    })
  })
})

describe('every extension fixture is accounted for', () => {
  it('registers every tracked manifest whose fixture is present', () => {
    // Manifests are tracked; the libraries they describe are not (fixtures/ is
    // gitignored). Anything with both a manifest and a fixture must be live.
    const manifests = readdirSync(join(root, 'src', 'ext', 'manifests'))
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, ''))
    expect(manifests.length).toBeGreaterThan(0)
    const registered = new Set(allExtensions().map((e) => e.id))
    for (const id of manifests) {
      if (!existsSync(join(extFixtures, id))) continue
      expect(registered.has(id), `${id} is not registered`).toBe(true)
    }
  })
})

describe('the documented registry table matches the registry', () => {
  it('lists every registered extension', () => {
    // This table was maintained by hand and drifted to listing 19 of 53
    // extensions — the failure mode of any hand-copied index. It is generated
    // now (src/cli/genextdoc.ts), so the only way it can go stale is somebody
    // adding a manifest and not re-running the generator. That is what this
    // catches; the fix is to run it.
    const doc = readFileSync(join(root, 'docs', 'extensions', 'README.md'), 'utf8')
    const table = doc.slice(doc.indexOf('<!-- BEGIN registry'), doc.indexOf('<!-- END registry'))
    expect(table.length).toBeGreaterThan(0)
    const missing = allExtensions()
      .map((e) => e.id)
      .filter((id) => !table.includes(`\`${id}\``))
    expect(missing, 'run: npm run cli -- src/cli/genextdoc.ts').toEqual([])
  })
})
