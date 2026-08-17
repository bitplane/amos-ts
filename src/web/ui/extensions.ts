/**
 * The extensions tab: every AMOS extension this port knows about.
 *
 * Not the same list as Libs and not a longer version of it. Libs is what
 * `OpenLibrary` answers, which is AmigaOS. This is AMOS's own plug-in
 * mechanism: a `.Lib` in a slot, contributing keywords to the language, and it
 * is the unit this project measures itself in.
 *
 * ## Where a row comes from
 *
 * The registry, for everything printed, so nothing here is written twice. That
 * includes the prose: `ExtensionInfo.notes` is already the field the project
 * keeps its findings in, quotes and all, and it is what a reader wants.
 *
 * `statedSlot` is worth knowing is different from the other two slot fields:
 * it is read out of the binary by `src/cli/genext.ts` rather than transcribed,
 * because extension call 1025 puts a library's own number in `d2` at the call
 * site. A manual recommending a slot and a person happening to install it
 * somewhere are the weaker `defaultSlot` and `observedSlots`.
 *
 * ## What "ported" means here
 *
 * That an `ExtensionImpl` declares this registry identity. That is the
 * project's own attribution rule and not a guess: coverage used to be counted
 * by keyword NAME, which credited a port for names another extension happened
 * to share, and porting Personnal once moved two unrelated rows off zero.
 *
 * It is a coarser answer than the percentage `KEYWORDS.md` carries, and the
 * one honest exception is DME 2.0, which declares its identity and is not
 * finished. Every other row is all or nothing, which is the rule the project
 * holds itself to: partial coverage is a state to leave, not one to record.
 */
import { allExtensions, type Extension } from '../../ext/registry'
import { extensionImpls } from '../../runtime/instr'
import { createList, facts, type RowSpec } from './list'

/** the registry ids some `ExtensionImpl` answers for */
function portedIds(): Set<string> {
  const out = new Set<string>()
  for (const impl of extensionImpls()) for (const id of impl.ids) out.add(id)
  return out
}

/**
 * How many keywords the extension's own table NAMES.
 *
 * Not `tokens.length`. A table carries entries for ids it reserves and never
 * spells, and those are not keywords anybody can type. The `!` prefix marks
 * one whose name the table hides from a listing, which is a keyword all the
 * same, so it counts once the marker is off.
 */
const keywordCount = (e: Extension): number =>
  e.tokens.filter((t) => t.name.replace(/^!/, '').trim() !== '').length

function rowFor(e: Extension, tokens: number, ported: boolean): RowSpec {
  const slot = e.statedSlot ?? e.defaultSlot
  return {
    key: e.id,
    label: `${e.name} ${e.version}`,
    detail: e.author,
    // the EXCEPTION is chipped, not the rule. 74 of 88 are ported, so marking
    // those would put a badge on almost every row and say nothing; marking the
    // fourteen that are not makes the tail of the list readable at a glance.
    ...(ported ? {} : { chip: { text: 'not ported', tone: 'warn' as const } }),
    body: (host) => {
      const about = document.createElement('p')
      about.className = 'about'
      about.textContent = e.notes
      host.appendChild(about)
      host.appendChild(
        facts([
          ['id', e.id],
          ['keywords', String(tokens)],
          // stated by the library itself where it has one, and that outranks
          // both a manual's recommendation and where somebody installed it
          ['slot', slot === undefined ? 'none stated' : `${slot}${e.statedSlot === undefined ? ' (recommended)' : ' (stated by the library)'}`],
          ['evidence', e.evidence],
          ['origin', e.origin],
          ['format', e.format],
        ]),
      )
    },
  }
}

export interface ExtensionsTab {
  panel: HTMLElement
}

export function createExtensionsTab(): ExtensionsTab {
  const panel = document.createElement('div')

  const ported = portedIds()
  const rows = allExtensions()
    // ported first, because which are done is the question the list is asked;
    // alphabetical inside each half, because which one is THIS is the other
    .sort((a, b) => {
      const done = Number(ported.has(b.id)) - Number(ported.has(a.id))
      return done !== 0 ? done : a.name.localeCompare(b.name) || a.version.localeCompare(b.version)
    })

  const intro = document.createElement('p')
  intro.className = 'panel-intro'
  intro.textContent =
    `${rows.length} extensions are registered and detokenise, so a program using one lists ` +
    `with real keyword names. ${ported.size} of those identities are answered by a port. ` +
    `"Ported" means this port declares the extension's own identity, which is stricter than ` +
    `sharing a keyword name with something already done.`
  panel.appendChild(intro)

  const listHost = document.createElement('div')
  panel.appendChild(listHost)
  createList(listHost).render(
    rows.map((e) => rowFor(e, keywordCount(e), ported.has(e.id))),
  )

  return { panel }
}
