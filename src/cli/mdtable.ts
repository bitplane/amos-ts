/**
 * Markdown tables that are readable as plain text.
 *
 * Markdown's promise is that the source reads like the rendered page. A
 * generated table breaks that promise the moment it stops padding: every row
 * is a different length, the columns do not line up, and a reader in an editor
 * or a `git diff` — where most of this tree's documentation is actually read —
 * is left counting pipes to work out which number belongs to which heading.
 * `KEYWORDS.md`'s summary was 130 rows of that.
 *
 * So: every column is padded to its widest member, header included, and
 * numbers are right-justified so their digits line up as a column of figures
 * should. The separator row carries the alignment markers too (`---:`), which
 * costs nothing and makes a renderer agree with the plain text.
 *
 * ## Alignment is inferred, and deliberately conservative
 *
 * A column is numeric when EVERY cell in it that says anything is a number —
 * optionally signed, optionally with thousands commas, optionally a decimal,
 * optionally a trailing `%`. Placeholders for "nothing here" (`—`, `-`, an
 * empty cell) are ignored rather than counted against it, because a coverage
 * column of percentages with one em-dash in it is still a column of numbers.
 *
 * One cell of prose makes the whole column left-aligned, which is the right
 * default: a column mixing `47` and `see note` reads worse right-justified
 * than left, and guessing per-cell would stagger the alignment down the
 * column. Pass `align` explicitly where the inference is wrong.
 *
 * ## Width is measured in characters, not in rendered width
 *
 * `\`amcaf-1.40\`` is twelve characters and renders as ten. Padding to the
 * character count is what lines the SOURCE up, which is the point; a renderer
 * lays the table out from the alignment markers and ignores the padding
 * entirely. Trying to be clever about markup here would trade the readable
 * thing for the already-solved one.
 */

export type Align = 'left' | 'right'

/** signed, thousands-separated, decimal, percentage — all one column's worth */
const NUMERIC = /^-?\d[\d,]*(?:\.\d+)?%?$/

/** cells that mean "nothing here" and so vote neither way */
const BLANK = new Set(['', '—', '-', 'n/a'])

/**
 * True when every cell that says anything is a number.
 *
 * The header is NOT consulted: "keywords" and "coverage" are words heading
 * columns of figures, and letting them vote would left-align every numeric
 * column in this tree.
 */
export function isNumericColumn(cells: readonly string[]): boolean {
  const said = cells.filter((c) => !BLANK.has(c.trim()))
  return said.length > 0 && said.every((c) => NUMERIC.test(c.trim()))
}

const padTo = (s: string, w: number, align: Align): string =>
  align === 'right' ? s.padStart(w) : s.padEnd(w)

/**
 * A padded, aligned markdown table.
 *
 * `head` and every row must be the same length; a ragged row is a bug in the
 * caller and throws rather than producing a table that renders wrong in a way
 * nobody notices.
 */
export function mdTable(head: readonly string[], rows: readonly (readonly string[])[], align?: readonly Align[]): string {
  const n = head.length
  for (const [i, r] of rows.entries()) {
    if (r.length !== n) throw new Error(`mdTable: row ${i} has ${r.length} cells, header has ${n}`)
  }
  const cols = Array.from({ length: n }, (_, c) => rows.map((r) => r[c] ?? ''))
  const how: Align[] = Array.from({ length: n }, (_, c) => align?.[c] ?? (isNumericColumn(cols[c]!) ? 'right' : 'left'))
  // a separator needs three dashes plus the colon, so no column is narrower
  const width = Array.from({ length: n }, (_, c) => Math.max(head[c]!.length, ...cols[c]!.map((s) => s.length), 3))

  const line = (cells: readonly string[]): string =>
    `| ${cells.map((s, c) => padTo(s, width[c]!, how[c]!)).join(' | ')} |`
  const rule = `| ${width.map((w, c) => (how[c] === 'right' ? `${'-'.repeat(w - 1)}:` : '-'.repeat(w))).join(' | ')} |`

  return [line(head), rule, ...rows.map(line)].join('\n')
}
