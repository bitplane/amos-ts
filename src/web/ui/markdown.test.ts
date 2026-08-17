import { describe, expect, it } from 'vitest'
import { renderMarkdown } from './markdown'

/**
 * The renderer touches two DOM calls and nothing else, so the suite can run it
 * without a browser or a jsdom dependency. What comes back is what a caller
 * would see in the tree: tag, text and attributes.
 */
interface Node {
  tag: string
  text: string
  attrs: Record<string, string>
  kids: Node[]
}
const el = (tag: string): Node => ({ tag, text: '', attrs: {}, kids: [] })

function render(md: string): Node[] {
  const doc = {
    createTextNode: (t: string) => ({ ...el('#text'), text: t }),
    createElement: (tag: string) => {
      const n = el(tag)
      return new Proxy(n, {
        set(t, k, v) {
          if (k === 'textContent') t.text = String(v)
          else t.attrs[String(k)] = String(v)
          return true
        },
      })
    },
  }
  const host = el('p')
  ;(host as unknown as { appendChild: (n: Node) => void }).appendChild = (n) => host.kids.push(n)
  const g = globalThis as unknown as { document: unknown }
  const had = g.document
  g.document = doc
  try {
    renderMarkdown(host as unknown as HTMLElement, md)
  } finally {
    g.document = had
  }
  return host.kids
}

describe('the descriptions renderer', () => {
  it('links, so a description can point at the manual it describes', () => {
    const out = render('See the [manual](https://aminet.net/package/dev/amos/Amcaf-HTML) for details.')
    expect(out.map((n) => n.tag)).toEqual(['#text', 'a', '#text'])
    expect(out[1]!.text).toBe('manual')
    expect(out[1]!.attrs.href).toBe('https://aminet.net/package/dev/amos/Amcaf-HTML')
    // external, so it opens away from the running machine and leaks no referrer
    expect(out[1]!.attrs.rel).toBe('noreferrer')
  })

  it('sets code and emphasis', () => {
    expect(render('`Colour 1,Red` works').map((n) => [n.tag, n.text])).toEqual([
      ['code', 'Colour 1,Red'],
      ['#text', ' works'],
    ])
    expect(render('the *whole* thing')[1]).toMatchObject({ tag: 'em', text: 'whole' })
  })

  it('never lets a manifest write markup or smuggle a scheme', () => {
    // every branch builds a text node or sets textContent, so an angle bracket
    // in a description stays a character
    expect(render('a <b>x</b> c')).toEqual([{ tag: '#text', text: 'a <b>x</b> c', attrs: {}, kids: [] }])
    // a link this cannot vouch for is shown as written rather than dropped
    expect(render('[x](javascript:alert(1))').map((n) => n.text).join('')).toBe('[x](javascript:alert(1))')
  })

  it('leaves plain prose alone', () => {
    expect(render('Packs and unpacks memory banks in place.')).toEqual([
      { tag: '#text', text: 'Packs and unpacks memory banks in place.', attrs: {}, kids: [] },
    ])
  })
})
