import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { AmigaGuide, parseAmigaGuide, parseGuideInline } from './amigaguide'
import { describeIf } from '../testing/fixture'
import { walkMatching } from '../cli/walk'

describe('AmigaGuide database parser', () => {
  it('models nodes, navigation, formatting and local or external links', () => {
    const guide = parseAmigaGuide(`@DATABASE "Manual.guide"
@TITLE "A manual"
@NODE MAIN "Contents"
@TOC contents
Read @{B}this@{UB}, @{
"locally" LINK "topic"} and @{"elsewhere" ALINK "Docs/Other.guide/start"}.
@ENDNODE
@NODE topic Topic
Text with an @@ sign.
@ENDNODE`)
    expect(guide).not.toBeNull()
    expect(guide!.database).toBe('Manual.guide')
    expect(guide!.entryNode).toBe('MAIN')
    expect(guide!.nodes.get('main')).toMatchObject({ title: 'Contents', toc: { document: '', node: 'contents' } })
    const content = guide!.nodes.get('main')!.content
    expect(content.filter(item => item.type === 'link')).toEqual([
      { type: 'link', label: [{ type: 'text', text: 'locally' }], target: { raw: 'topic', document: '', node: 'topic' }, command: 'link' },
      { type: 'link', label: [{ type: 'text', text: 'elsewhere' }], target: { raw: 'Docs/Other.guide/start', document: 'Docs/Other.guide', node: 'start' }, command: 'alink' },
    ])
    expect(parseGuideInline('a@@b @{SYSTEM "delete all"}')).toEqual([
      { type: 'text', text: 'a@b ' }, { type: 'command', name: 'SYSTEM', argument: '"delete all"' },
    ])
  })

  it('rejects ordinary text and incomplete databases', () => {
    expect(parseAmigaGuide('ordinary text')).toBeNull()
    expect(parseAmigaGuide('@database empty.guide')).toBeNull()
  })
})

describe('amigaguide.library clients', () => {
  it('loads, navigates and keeps cross-database history', () => {
    const files = new Map<string, Uint8Array>([
      ['RAM:main.guide', Buffer.from('@database main.guide\n@node MAIN Main\n@{"Topic" link topic}\n@endnode\n@node topic Topic\n@next last\nBody\n@endnode\n@node last Last\n@endnode', 'latin1')],
      ['RAM:other.guide', Buffer.from('@database other.guide\n@node start Other\n@endnode', 'latin1')],
    ])
    const library = new AmigaGuide(path => files.get(path) ?? null)
    const handle = library.open('RAM:main.guide', 7)
    expect(library.current(handle)?.title).toBe('Main')
    expect(library.command(handle, 'LINK topic')).toBe(true)
    expect(library.current(handle)?.title).toBe('Topic')
    expect(library.command(handle, 'NEXT')).toBe(true)
    expect(library.navigate(handle, { raw: 'other.guide/start', document: 'other.guide', node: 'start' },
      (_from, relative) => `RAM:${relative}`)).toBe(true)
    expect(library.current(handle)?.title).toBe('Other')
    expect(library.back(handle)).toBe(true)
    expect(library.current(handle)?.title).toBe('Last')
    expect(library.forward(handle)).toBe(true)
    expect(library.current(handle)?.title).toBe('Other')
    expect(library.close(handle)).toBe(true)
  })

  it('retains an opaque client when presentation cannot load the document', () => {
    const library = new AmigaGuide(); const handle = library.open('RAM:missing.guide', 0)
    expect(handle).not.toBe(0); expect(library.current(handle)).toBeNull()
  })
})

const CORPUS = '../amos-files'
describeIf('AmigaGuide corpus', (() => { try { return readFileSync(`${CORPUS}/README.md`).length > 0 } catch { return false } })(), () => {
  it('finds nodes in every guide database', () => {
    let count = 0
    for (const { file, path } of walkMatching(CORPUS, /\.guide$/i)) {
      const guide = parseAmigaGuide(new Uint8Array(readFileSync(file)))
      expect(guide, path).not.toBeNull()
      count++
    }
    expect(count).toBeGreaterThan(100)
  })
})
