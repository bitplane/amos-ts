/**
 * The libs tab: what `OpenLibrary` answers for.
 *
 * The rows come out of `modelledLibraries()` in ../../amiga/exec.ts, which is
 * the same map the gate itself reads. A page keeping its own list would drift
 * from the one that decides, and the interesting answer here is increasingly
 * *no*: an extension that asks for something absent gets zero and takes its
 * fallback, which is behaviour worth being able to see.
 *
 * This is not every Amiga library the port models. `intuition.library`,
 * `decrunch.library`, `powerpacker.library` and `muimaster.library` are all
 * ported and none of them is in the map, because nothing reaches them through
 * `OpenLibrary` yet. Listing them here would mean claiming an answer the gate
 * does not give.
 */
import { modelledLibraries, type ModelledLibrary } from '../../amiga/exec'
import { createList, facts, type RowSpec } from './list'

const hex = (n: number): string => `$${n.toString(16)}`

function rowFor(lib: ModelledLibrary): RowSpec {
  return {
    key: lib.name,
    label: lib.name,
    detail: `version ${lib.version} or lower`,
    body: (host) => {
      const about = document.createElement('p')
      about.className = 'about'
      about.textContent = lib.about
      host.appendChild(about)
      // the name is the row's own label and the version is its detail column,
      // so the base is the only thing here a reader cannot already see
      host.appendChild(facts([['base', hex(lib.base)]]))
    },
  }
}

export interface LibsTab {
  panel: HTMLElement
}

export function createLibsTab(): LibsTab {
  const panel = document.createElement('div')

  const intro = document.createElement('p')
  intro.className = 'panel-intro'
  intro.textContent =
    'The libraries OpenLibrary answers for, and the newest version each will admit to. Anything not listed answers zero, which is the case a well-written extension checks for and reports.'
  panel.appendChild(intro)

  const listHost = document.createElement('div')
  panel.appendChild(listHost)

  // the map is fixed at build time, so this list is drawn once and never again
  createList(listHost).render(modelledLibraries().map(rowFor))

  return { panel }
}
