/**
 * The libs tab: what `OpenLibrary` answers for.
 *
 * The rows come out of `modelledLibraries()` in ../../amiga/exec.ts, which is
 * the same map the gate itself reads. A page keeping its own list would drift
 * from the one that decides, and the interesting answer here is increasingly
 * *no*: an extension that asks for something absent gets zero and takes its
 * fallback, which is behaviour worth being able to see.
 *
 * This is specifically the resident set exposed through `OpenLibrary`.
 * Format backends which no current native caller opens are separate from that
 * set and do not appear here.
 */
import { modelledLibraries, type ModelledLibrary } from '../../amiga/exec'
import { createList, facts, type RowSpec } from './list'
import { createSpeechBox } from './speechbox'

const hex = (n: number): string => `$${n.toString(16)}`

/**
 * The one row with something to try.
 *
 * Only translator.library, and only because it is the one modelled library
 * whose whole output a person can judge in a second. A row per library with a
 * box in it would be a page of controls; this is a box where it earns its
 * place. See ./speechbox.ts for why it exists at all.
 */
const TRY = new Map<string, () => HTMLElement>([['translator.library', createSpeechBox]])

function rowFor(lib: ModelledLibrary): RowSpec {
  const box = TRY.get(lib.name)
  return {
    key: lib.name,
    label: lib.name,
    detail: `version ${lib.version} or lower`,
    ...(box === undefined ? {} : { chip: { text: 'try it', tone: 'on' as const, title: 'type something and hear it' } }),
    body: (host) => {
      const about = document.createElement('p')
      about.className = 'about'
      about.textContent = lib.about
      host.appendChild(about)
      // the name is the row's own label and the version is its detail column,
      // so the base is the only thing here a reader cannot already see
      host.appendChild(facts([['base', hex(lib.base)]]))
      // built when the row is first drawn rather than when it is opened: the
      // list keeps every panel, and the box fetches nothing until Speak
      if (box !== undefined) host.appendChild(box())
    },
  }
}

export interface LibsTab {
  panel: HTMLElement
}

export function createLibsTab(): LibsTab {
  const panel = document.createElement('div')

  const listHost = document.createElement('div')
  panel.appendChild(listHost)

  // the map is fixed at build time, so this list is drawn once and never again
  createList(listHost).render(modelledLibraries().sort((a, b) => a.name.localeCompare(b.name)).map(rowFor))

  return { panel }
}
