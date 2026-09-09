/** Shared AmigaGuide document model and process-wide library lifecycle. */

export interface AmigaGuideTarget {
  raw: string
  /** Empty for a node in the current database. */
  document: string
  node: string
}

export type AmigaGuideInline =
  | { type: 'text'; text: string }
  | { type: 'link'; label: AmigaGuideInline[]; target: AmigaGuideTarget; command: 'link' | 'alink' }
  | { type: 'command'; name: string; argument: string }

export interface AmigaGuideNode {
  id: string
  title: string
  toc?: AmigaGuideTarget
  index?: AmigaGuideTarget
  next?: AmigaGuideTarget
  previous?: AmigaGuideTarget
  content: AmigaGuideInline[]
}

export interface AmigaGuideDocument {
  database: string
  title: string
  author: string
  version: string
  master: string
  entryNode: string
  nodes: Map<string, AmigaGuideNode>
}

const quoted = /"((?:[^"\\]|\\.)*)"|([^\s]+)/y

function word(text: string, at: number): { value: string; end: number } | null {
  while (/\s/.test(text[at] ?? '')) at++
  quoted.lastIndex = at
  const match = quoted.exec(text)
  if (!match) return null
  return { value: (match[1] ?? match[2] ?? '').replace(/\\"/g, '"'), end: quoted.lastIndex }
}

export function guideTarget(raw: string): AmigaGuideTarget {
  const slash = raw.search(/\.guide\//i)
  return slash < 0
    ? { raw, document: '', node: raw }
    : { raw, document: raw.slice(0, slash + 6), node: raw.slice(slash + 7) }
}

/** Parse inline escapes without interpreting executable SYSTEM/RX commands. */
export function parseGuideInline(text: string): AmigaGuideInline[] {
  const out: AmigaGuideInline[] = []; let plain = ''; let at = 0
  const flush = (): void => { if (plain) { out.push({ type: 'text', text: plain }); plain = '' } }
  while (at < text.length) {
    if (text[at] === '{') {
      // Some early guides omit every command's @ prefix; amigaguide.library
      // accepts that dialect and it occurs in the shipped AMOS collection.
    } else if (text[at] !== '@') { plain += text[at++]!; continue }
    if (text[at + 1] === '@') { plain += '@'; at += 2; continue }
    const brace = text[at] === '{' ? at : at + 1
    if (text[brace] !== '{') { plain += text[at++]!; continue }
    const end = text.indexOf('}', brace + 1)
    if (end < 0) { plain += text.slice(at); break }
    const body = text.slice(brace + 1, end).trim(); flush()
    const label = word(body, 0)
    if (label) {
      const tail = body.slice(label.end).trim()
      const action = /^(A?LINK)\s+/i.exec(tail)
      if (action) {
        const target = word(tail, action[0].length)
        if (target) {
          out.push({ type: 'link', label: parseGuideInline(label.value), target: guideTarget(target.value),
            command: action[1]!.toLowerCase() as 'link' | 'alink' })
          at = end + 1; continue
        }
      }
    }
    const space = body.search(/\s/); const name = (space < 0 ? body : body.slice(0, space)).toUpperCase()
    out.push({ type: 'command', name, argument: space < 0 ? '' : body.slice(space).trim() })
    at = end + 1
  }
  flush(); return out
}

const navigation = new Set(['TOC', 'INDEX', 'NEXT', 'PREV', 'PREVIOUS'])

/** Parse the textual database. Unknown directives remain inline commands. */
export function parseAmigaGuide(source: string | Uint8Array): AmigaGuideDocument | null {
  let text: string
  if (typeof source === 'string') text = source
  else {
    const chunks: string[] = []
    for (let at = 0; at < source.length; at += 0x8000) chunks.push(String.fromCharCode(...source.subarray(at, at + 0x8000)))
    text = chunks.join('')
  }
  if (!/^\s*@?database\b/im.test(text)) return null
  const document: AmigaGuideDocument = { database: '', title: '', author: '', version: '', master: '', entryNode: '', nodes: new Map() }
  let current: { id: string; title: string; lines: string[]; nav: Map<string, AmigaGuideTarget> } | null = null
  const finish = (): void => {
    if (!current) return
    const node: AmigaGuideNode = { id: current.id, title: current.title, content: parseGuideInline(current.lines.join('\n')) }
    const toc = current.nav.get('TOC'); const index = current.nav.get('INDEX'); const next = current.nav.get('NEXT')
    const previous = current.nav.get('PREV') ?? current.nav.get('PREVIOUS')
    if (toc) node.toc = toc; if (index) node.index = index; if (next) node.next = next; if (previous) node.previous = previous
    document.nodes.set(node.id.toLowerCase(), node); current = null
  }
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    const directive = /^\s*@?([A-Za-z]+)\b\s*(.*)$/.exec(line)
    if (!directive) { if (current) current.lines.push(line); continue }
    const name = directive[1]!.toUpperCase(); const rest = directive[2]!.trim()
    if (name === 'NODE') {
      finish(); const id = word(rest, 0); if (!id) continue
      const title = word(rest, id.end)
      current = { id: id.value, title: title?.value ?? id.value, lines: [], nav: new Map() }; continue
    }
    if (name === 'ENDNODE') { finish(); continue }
    if (current && navigation.has(name)) {
      const target = word(rest, 0); if (target) current.nav.set(name, guideTarget(target.value)); continue
    }
    if (current) { current.lines.push(line); continue }
    const value = word(rest, 0)?.value ?? rest
    if (name === 'DATABASE') document.database = value
    else if (name === 'TITLE') document.title = value
    else if (name === 'AUTHOR') document.author = value
    else if (name === 'VERSION') document.version = value
    else if (name === 'MASTER') document.master = value
  }
  finish()
  document.entryNode = document.nodes.has('main') ? document.nodes.get('main')!.id : (document.nodes.values().next().value?.id ?? '')
  return document.nodes.size ? document : null
}

export interface AmigaGuideLaunch {
  handle: number
  name: string
  screen: number
  baseName: string
  context: number
}

/**
 * OpenAmigaGuideA returns an opaque client handle. Presentation belongs to a
 * host viewer, but retaining the launch and handle lifetime keeps extensions
 * on one library boundary instead of inventing private help systems.
 */
export class AmigaGuide {
  private nextHandle = 0x7900_0000
  readonly active = new Map<number, AmigaGuideLaunch>()
  lastLaunch: AmigaGuideLaunch | null = null

  open(name: string, screen: number, baseName = '', context = 0): number {
    if (name === '') return 0
    const handle = this.nextHandle
    this.nextHandle += 0x100
    const launch = { handle, name, screen: screen >>> 0, baseName, context: context >>> 0 }
    this.active.set(handle, launch)
    this.lastLaunch = launch
    return handle
  }

  close(handle: number): boolean {
    return this.active.delete(handle >>> 0)
  }
}
