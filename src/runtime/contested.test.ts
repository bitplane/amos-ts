import { describe, expect, it } from 'vitest'
import { answeredForUnported, contestedReport, undeclaredLive } from './contested'

/**
 * Live contested names that are knowingly left on first-wins.
 *
 * This exists so the list is a DECISION rather than an oversight, and it should
 * stay empty. A name belongs here only when both products mean the same thing
 * by it and one handler genuinely serves both — not when nobody has got round
 * to the other side.
 *
 * `set protect` used to head this list, on the reasoning that EasyLife reaches
 * SetProtection through an ALIAS rather than an entry of its own and so
 * "cannot be qualified". That was wrong about the mechanism: `aliases` bind to
 * slots exactly as `qualified` does, so EasyLife's has been `ext16:set
 * protect` all along while CRAFT holds the bare name — which is the correct
 * arrangement and not an exception to it. The entry survived because the
 * report asked `impl.qualified` whether a name was declared, and an alias is
 * not in `impl.qualified`. It asks the dispatch table now, and the entry
 * cleared itself exactly as its own note promised it would.
 */
const ALLOWED_UNDECLARED = new Set<string>([
  /**
   * AMCAF 1.50 added these deliberately as the Music extension's, and said so:
   *
   *   V1.43 02-Nov-96
   *   - Added Sload/Ssave. Just the same commands like in the music
   *     extension. Now you can really remove it!
   *
   * So one handler answering for both is the author's intent rather than an
   * accident, and a slot-qualified pair would give AMCAF programs a second
   * implementation of something he wrote to BE the first one. 1.40 does not
   * have them at all.
   *
   * The handler that answers is the CORE one, ../runtime/instr.ts `sload` and
   * `ssave`, ported from Music's own source (+Music.s:3213 and :4400). Its
   * doc block records the three places AMCAF's routines 106/107 differ --
   * channel 1..9 against 1..10, no mode check, and no zero-length refusal --
   * and why Music's contract is the one kept.
   */
  'sload',
  'ssave',

  /**
   * EME 3.0 IS the Music extension.
   *
   * It ships AS `AMOSPro_Music.Lib` and is copied over the stock one — its own
   * doc says "copy the file AMOSPro_Music.lib over the existing file in your
   * APSystem folder" — so it occupies slot 1 and a program written for stock
   * Music has to tokenise and run against it unchanged. All 49 stock keywords
   * are present with IDENTICAL token ids AND identical parameter specs;
   * nothing is dropped, renamed or re-specced.
   *
   * That is the opposite of the case this guard exists for. `Blitter Copy` was
   * two libraries meaning different things by one name; this is one library
   * deliberately being the other. The core Music handlers are the right answer
   * for both, and qualifying these to a slot would give an EME program a
   * SECOND implementation of code EME copied in order to be compatible with.
   *
   * The ten EME adds are not here — nothing else claims them, so nothing is
   * contested about them. `med load`, `med play` and `med stop` are not here
   * either: MED 7.1 already qualifies those three against slot 19.
   */
  'mubase', 'vumeter', 'voice', 'music off', 'music stop', 'tempo', 'music',
  'noise to', 'boom', 'shoot', 'sam bank', 'sam loop on', 'sam loop off',
  'sample', 'sam play', 'sam raw', 'bell', 'play off', 'play', 'set wave',
  'del wave', 'set envel', 'mvolume', 'volume', 'wave', 'led on', 'led off',
  'say', 'set talk', 'sam swapped', 'sam swap', 'sam stop', 'track stop',
  'track loop on', 'track loop of', 'track play', 'track load', 'mouth width',
  'mouth height', 'mouth read', 'talk stop', 'talk misc', 'med cont',
  'med midi on',
])

describe('contested keyword names', () => {
  /**
   * The guard that was missing.
   *
   * `keywordLayerCollisions` compares HANDLER tables, so it only fires when two
   * ports both define a name. It is blind to the commoner and quieter case:
   * one port implements a name, another product's token table also has it, and
   * that product's programs silently get the first port's handler.
   *
   * AMCAF's `Blitter Copy` was exactly that for the whole of its port —
   * `srcscreen,srcplane To dstscreen,dstplane[,minterm]` dispatching into
   * Personnal's address form. The report knew; nothing made anyone read it.
   */
  it('every live contested name has been qualified by some port', () => {
    const undeclared = undeclaredLive().filter((r) => !ALLOWED_UNDECLARED.has(r.name))
    const detail = undeclared.map((r) => `  ${r.name} — claimed by ${r.products.join(', ')}`).join('\n')
    expect(
      undeclared.map((r) => r.name),
      undeclared.length === 0
        ? ''
        : `these names are claimed by two PORTED products and something implements them, ` +
            `so one handler is answering for both:\n${detail}\n` +
            `Declare the name in \`qualified\` on the owning ExtensionImpl in instr.ts, ` +
            `which binds it to the slot the program actually loaded.`,
    ).toEqual([])
  })

  /**
   * The half `undeclaredLive` cannot see, because it needs both sides ported.
   *
   * Registering a token table without porting it hands that product's keyword
   * NAMES to whoever already answers them. Two ported products settle a shared
   * name between them — one keeps the bare key and the other qualifies — but an
   * unported claimant has no `ExtensionImpl` to declare anything on, so its
   * programs get the other product's handler under the other product's
   * contract and nothing anywhere records it.
   *
   * Twenty names were in that state: seventeen of Explode 2.01's reaching
   * AMCAF, CRAFT, CText, TURBO Plus and First, DME 2.0's `Nop` and four P61
   * names, and Intuition 1.3b's `Ehb` and `Ham` reaching Personnal. Four are
   * demonstrably different keywords rather than the same one twice — `Nop` is
   * a function in DME and an instruction in AMCAF, `Plane Swap` takes two
   * arguments in Explode and three in TURBO Plus, `Font Base` is `00` in
   * Explode and `0` in CText, so the handler would read the wrong number of
   * arguments off the stack.
   */
  it('no bare-name handler answers for an unported product that claims the name', () => {
    const bad = answeredForUnported()
    const detail = bad.map((r) => `  ${r.name} — claimed by ${r.products.join(', ')}`).join('\n')
    expect(
      bad.map((r) => r.name),
      bad.length === 0
        ? ''
        : `a registered product nobody has ported claims these names, and a ported ` +
            `product answers them under the BARE key — so the unported product's programs ` +
            `silently get the other one's handler:\n${detail}\n` +
            `Declare the name in \`qualified\` on the PORTED side in instr.ts. The bare key ` +
            `goes away, each product answers on its own slots, and the unported one's ` +
            `programs get an unimplemented keyword, which is what they have.`,
    ).toEqual([])
  })

  it('ALLOWED_UNDECLARED does not name something already fixed', () => {
    const live = new Set(contestedReport().rows.filter((r) => r.tier === 'live' && !r.declared).map((r) => r.name))
    for (const n of ALLOWED_UNDECLARED) expect(live, `${n} is no longer undeclared — drop it`).toContain(n)
  })

  it('the report can still describe itself', () => {
    const { rows, distinct, ported } = contestedReport()
    expect(distinct).toBeGreaterThan(1000)
    expect(rows.length).toBeGreaterThan(0)
    expect(ported.has('AMOS core')).toBe(true)
    // every row really is contested, and the tiers are exhaustive
    for (const r of rows) {
      expect(r.products.length).toBeGreaterThan(1)
      expect(['live', 'armed', 'latent']).toContain(r.tier)
    }
  })
})
