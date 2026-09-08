/** AMOS extensions and AmigaOS services, grouped below one page tab. */
import type { ExtensionsTab } from './extensions'
import { createList } from './list'

export interface SupportTab {
  panel: HTMLElement
  refresh(): void
}

export function createSupportTab(
  extensions: ExtensionsTab,
  libraries: HTMLElement,
  datatypes: HTMLElement,
): SupportTab {
  const panel = document.createElement('div')
  createList(panel).render([
    {
      key: 'extensions',
      icon: '🧩',
      label: 'Extensions',
      body: (host) => host.appendChild(extensions.panel),
    },
    {
      key: 'libraries',
      icon: '📚',
      label: 'Libraries',
      body: (host) => host.appendChild(libraries),
    },
    {
      key: 'datatypes',
      icon: '🖼️',
      label: 'Datatypes',
      body: (host) => host.appendChild(datatypes),
    },
  ])
  return { panel, refresh: () => extensions.refresh() }
}
