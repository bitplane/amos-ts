/**
 * The AMOS Professional editor, in a terminal.
 *
 *   npx tsx src/cli/amosedit.ts [file.AMOS | listing.amos]
 *
 * DEVIATION: the editor's screen is 640x256 hires with its own font, its own
 * colours, a mouse and eleven requesters (+Editor_Config.s:31), and a terminal
 * has none of that, which is the whole of this file. What it does have is
 * exactly what `src/editor/display.ts` answers -- rows of characters, the
 * runs of them the block covers, and a status line -- so this draws those and
 * nothing else, and every requester answers its first button.
 *
 * The point is not the look. It is that `Ed_Ky2Fonc`, `Ed_FCall`, the command
 * table, the Test pass and `Prg_RunIt` are all real here, so a key that ought
 * to fold a procedure folds one, and F1 runs the program through the actual
 * interpreter.
 *
 * ## What a terminal cannot reach
 *
 * The key map is `.Ed_KFonc` in +Editor_Config.s, 184 three-byte records of
 * scancode and qualifiers. A terminal delivers characters, not scancodes, and
 * it folds Ctrl-A and SOH into the same byte. So Shift and Amiga combinations
 * are unreachable here and Ctrl combinations arrive without their scancode,
 * which is enough for the map because `Ed_Ky2Fonc` matches on the ASCII when
 * the record has one.
 */
import { readFileSync } from 'node:fs'
import { Amos } from '../amos/amos'
import { renderWindow, statusLine } from '../editor/display'
import { decode } from './termkeys'
import { fsForFile } from './nodefs'
import type { Edit } from '../editor/edit'

const args = process.argv.slice(2)
const file = args.find((a) => !a.startsWith('--'))

const amos = new Amos(file === undefined ? '' : readFileSync(file), {
  // this front end draws rows of characters and cannot put a requester up, so
  // every question takes its first button, which is `Ed_Zappeuse`'s answer
  requesters: false,
  rows: Math.max(4, (process.stdout.rows ?? 24) - 4),
  onText: (t) => out.push(t),
  fs: file === undefined ? null : (fsForFile(file) as never),
})
if (file !== undefined) amos.window.prog.name = file

/** what a running program printed, shown under the editor until the next key */
const out: string[] = []

/* ---- the terminal ------------------------------------------------------- */

const ESC = '\x1b'
const write = (s: string): void => void process.stdout.write(s)

/** `Ed_Systeme` messages 17 and 18 are the machine's inverse-video pair */
const INVERSE = `${ESC}[7m`
const NORMAL = `${ESC}[0m`

function draw(w: Edit): void {
  // `Ed_Sx/8` is 80 on the editor's own screen and the status line is 68 of
  // them (+Editor_Config.s), so 68 is the narrowest that shows every field
  const width = Math.max(68, Math.min(process.stdout.columns || 80, 80))
  const { rows, cursor } = renderWindow(w)
  const lines: string[] = []
  lines.push(INVERSE + pad(statusLine(w, { name: w.prog.name, width }), width) + NORMAL)
  for (const row of rows) lines.push(paint(row.text, row.inverse, width))
  const tail = out.join('')
  write(`${ESC}[H${ESC}[2J` + lines.join('\r\n'))
  if (tail !== '') write(`\r\n${ESC}[2m--- ${tail.replace(/\n/g, '\r\n')}${NORMAL}`)
  // the cursor is one row down, because the status line took row 1
  write(`${ESC}[${cursor.y + 2};${cursor.x + 1}H`)
}

const pad = (s: string, width: number): string => (s + ' '.repeat(width)).slice(0, width)

/** one row, with the block's runs in inverse video */
function paint(text: string, inverse: { from: number; to: number }[], width: number): string {
  if (inverse.length === 0) return pad(text, width)
  let at = 0
  let s = ''
  for (const run of inverse) {
    s += text.slice(at, run.from) + INVERSE + text.slice(run.from, run.to) + NORMAL
    at = run.to
  }
  return s + pad(text.slice(at), Math.max(0, width - at))
}

/* ---- the loop ----------------------------------------------------------- */

const stdin = process.stdin
if (!stdin.isTTY) {
  console.error('amosedit needs a terminal')
  process.exit(1)
}
stdin.setRawMode(true)
stdin.resume()
stdin.setEncoding('latin1')
write(`${ESC}[?1049h`)

const finish = (): never => {
  write(`${ESC}[?1049l`)
  process.exit(0)
}

let buffered = ''
stdin.on('data', (chunk: string) => {
  buffered += chunk
  for (;;) {
    const got = decode(buffered)
    if (got === null) break
    buffered = buffered.slice(got.used)
    // Ctrl-Q is not the editor's: it is this harness's way out, because a
    // terminal cannot deliver the Amiga-Q the key map wants for Quit
    if (got.key.ch === 'q' && got.key.shift === 0b0000_1000) finish()
    // a NUL with no scancode is not a key: Del is the only one that carries
    // ASCII 0 and it brings scancode $46 with it
    if (got.key.ch === '\x00' && got.key.scan === undefined) continue
    out.length = 0
    amos.key(got.key)
    if (amos.done) finish()
  }
  draw(amos.window)
})

draw(amos.window)
