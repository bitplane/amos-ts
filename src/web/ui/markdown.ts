/**
 * The small slice of Markdown the extension descriptions need.
 *
 * Links, inline code and emphasis, and nothing else. A description says what
 * an extension is and points at its manual; it has no headings and no lists,
 * so a full parser would be a dependency bought for one feature.
 *
 * Builds DOM nodes rather than a string of HTML. Nothing here is ever
 * assigned to `innerHTML`, so a stray angle bracket in a manifest is a
 * character rather than a tag, and the link text cannot smuggle markup.
 * External links get `rel="noreferrer"`, since they go to Aminet and the
 * like.
 */

/** `[text](url)`, `` `code` ``, `*emphasis*` — the three, in one pass. */
const TOKEN = /\[([^\]]+)\]\(([^)\s]+)\)|`([^`]+)`|\*([^*]+)\*/g

/** Only what a description legitimately points at; anything else stays text. */
function safeHref(url: string): string | null {
  return /^https?:\/\//i.test(url) ? url : null
}

/**
 * Render one line of Markdown into `host`.
 *
 * Returns the host, so a caller can build and append in one expression.
 */
export function renderMarkdown(host: HTMLElement, text: string): HTMLElement {
  let at = 0
  for (const m of text.matchAll(TOKEN)) {
    const [whole, linkText, url, code, em] = m
    if (m.index > at) host.appendChild(document.createTextNode(text.slice(at, m.index)))
    at = m.index + whole.length
    if (linkText !== undefined && url !== undefined) {
      const href = safeHref(url)
      if (href === null) {
        // a link this cannot vouch for is shown as it was written, which is
        // more use to a reader than a silently dropped one
        host.appendChild(document.createTextNode(whole))
        continue
      }
      const a = document.createElement('a')
      a.href = href
      a.textContent = linkText
      a.target = '_blank'
      a.rel = 'noreferrer'
      host.appendChild(a)
    } else if (code !== undefined) {
      const c = document.createElement('code')
      c.textContent = code
      host.appendChild(c)
    } else if (em !== undefined) {
      const e = document.createElement('em')
      e.textContent = em
      host.appendChild(e)
    }
  }
  if (at < text.length) host.appendChild(document.createTextNode(text.slice(at)))
  return host
}
