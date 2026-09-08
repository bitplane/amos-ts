/** The installed Workbench datatype descriptors and what this port can read. */
import { SHIPPED_DATATYPES } from '../../amiga/datatypes.gen'
import { createList, facts, type RowSpec } from './list'

type Support = { level: 'decode' | 'identify'; detail: string }

const SUPPORT: Readonly<Record<string, Support>> = {
  '8svx': { level: 'decode', detail: 'sample data and Fibonacci compression' },
  amigaguide: { level: 'decode', detail: 'AmigaGuide source and node text' },
  ascii: { level: 'decode', detail: 'IFF FTXT character chunks' },
  gif: { level: 'decode', detail: 'GIF87a/GIF89a indexed pictures, interlace and transparency' },
  ilbm: { level: 'decode', detail: 'planar, HAM and extra-half-brite pictures' },
  jpeg: { level: 'decode', detail: 'baseline JPEG pictures' },
  macpaint: { level: 'decode', detail: 'PackBits monochrome pictures' },
  pcx: { level: 'decode', detail: 'packed and planar indexed PCX plus 24-bit RGB' },
  bmp: { level: 'decode', detail: 'indexed and true-colour BMP, including RLE4/RLE8' },
  ico: { level: 'decode', detail: 'Windows ICO bitmaps and transparency masks' },
}

const rowFor = (baseName: string): RowSpec => {
  const dt = SHIPPED_DATATYPES.find((candidate) => candidate.baseName === baseName)!
  const support = SUPPORT[baseName] ?? { level: 'identify' as const, detail: 'identified only' }
  const label = baseName === 'ico' ? 'Windows ICO' : dt.name
  return {
    key: baseName,
    label,
    detail: `${dt.groupID.trim()} · ${baseName}.datatype`,
    chips: support.level === 'decode' ? [] : [{ text: 'identify only', tone: 'warn' }],
    body: (host) => host.appendChild(facts([
      ['class', `${baseName}.datatype`],
      ...(label === dt.name ? [] : [['descriptor', dt.name] as const]),
      ['support', support.detail],
      ['pattern', dt.pattern],
    ])),
  }
}

export function createDataTypesPanel(): HTMLElement {
  const panel = document.createElement('div')
  createList(panel).render(
    SHIPPED_DATATYPES.map((dt) => dt.baseName)
      .sort((a, b) => a.localeCompare(b))
      .map(rowFor),
  )
  return panel
}
