/**
 * Generate src/runtime/edmessages.gen.ts — the editor's five message
 * tables, straight out of +Editor_Config.s.
 *
 * `Resource$(n)` reaches these for n below -1000 (FnResource +ILib.s:6699):
 * -1001.. Ed_Systeme, -2001.. EdM_Messages, -3001.. Ed_Messages,
 * -4001.. Ed_TstMessages, -5001.. Ed_RunMessages, and -6001 and beyond is
 * a function call error.
 *
 * Each block is a run of records {pad byte, length byte, bytes}, walked
 * 1-based by GetMessage (+B.s:590) which skips the leading pad and stops
 * at a length of $FF. The EdT/EdD macros (+Editor_Config.s:37-47) emit
 * exactly that, so parsing the macro calls IN ORDER reproduces the block —
 * and the order is the whole contract. The number in the macro call is a
 * comment; position is what GetMessage counts. In .Error1 the two agree,
 * record 0 being the empty one the block opens with, so an index into the
 * generated table is an AMOS run-time error number.
 *
 * WHICH IS WHY A DROPPED LINE IS NOT A MISSING STRING. It shortens the block
 * and moves every record after it, and nothing downstream can tell. Read
 * `block` below before touching its line pattern.
 *
 * The menu block is `IncBin "bin/Editor_Menus.asc"`, a prebuilt file in
 * the same record format, so it is read as bytes rather than parsed.
 *
 *   npx tsx src/cli/genedmsg.ts [path-to-AMOS-Professional-Official]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.argv[2] ?? '../AMOS-Professional-Official'
const src = readFileSync(join(root, '+Editor_Config.s'), 'latin1').split('\n')

/** the byte list of an EdD body: `dc.b 27,"B4",25` */
function assembleBytes(body: string): number[] {
  const out: number[] = []
  const text = body.replace(/^\s*dc\.b\s*/i, '')
  let i = 0
  while (i < text.length) {
    const c = text[i]!
    if (c === ',' || c === ' ' || c === '\t') {
      i++
      continue
    }
    if (c === '"') {
      i++
      while (i < text.length && text[i] !== '"') out.push(text.charCodeAt(i++))
      i++
      continue
    }
    let tok = ''
    while (i < text.length && text[i] !== ',') tok += text[i++]
    tok = tok.trim()
    if (tok === '') continue
    out.push(tok.startsWith('$') ? parseInt(tok.slice(1), 16) : Number(tok) & 0xff)
  }
  return out
}

/** every message between two labels, in order */
function block(from: string, to: string): string[] {
  const start = src.findIndex((l) => l.startsWith(from))
  const end = src.findIndex((l, i) => i > start && l.startsWith(to))
  if (start < 0 || end < 0) throw new Error(`block ${from}..${to} not found`)
  const out: string[] = []
  for (let i = start; i < end; i++) {
    const line = src[i]!
    // The trailing group is NOT decoration. Twenty-nine records carry a
    // comment after the closing `>` with nothing to mark it as one — the
    // AmigaDOS code a disc error maps from (`EdT 80,<Directory not
    // found>  204`), the music error's own index, or a `v1.1`. Anchoring on
    // `>\s*$` skipped every one of them, and a SKIPPED RECORD IS NOT A
    // MISSING STRING: it shortens the block, so every message after it
    // reports under the wrong number. Fourteen went missing from the
    // run-time error table alone, which is why 94 "I/O error" through 139
    // used to answer as 80..125. `(.*)` is greedy and so takes the LAST `>`
    // on the line, which is what closes the record.
    const m = /\b(EdT|EdD)\s+-?\d+\s*,\s*<(.*)>(?:[ \t]+\S.*)?[ \t]*$/.exec(line)
    if (!m) {
      // a bare `dc.b 0,$FF` terminates the block early (Ed_Systeme, Ed_Messages)
      if (/dc\.b\s+0\s*,\s*\$[fF][fF]/.test(line)) break
      continue
    }
    out.push(
      m[1] === 'EdT'
        ? m[2]!
        : assembleBytes(m[2]!)
            .map((b) => String.fromCharCode(b))
            .join(''),
    )
  }
  return out
}

/** the prebuilt menu block: {pad, len, bytes} records, $FF ends it */
function fromBinary(path: string): string[] {
  const b = readFileSync(join(root, path))
  const out: string[] = []
  let p = 1 // GetMessage skips the leading pad byte
  while (p < b.length) {
    const len = b[p]!
    if (len === 0xff) break
    out.push(Buffer.from(b.subarray(p + 1, p + 1 + len)).toString('latin1'))
    p += 2 + len
  }
  return out
}

const tables = {
  ED_SYSTEME: block('.Sys1', '.Sys2'),
  EDM_MESSAGES: fromBinary('bin/Editor_Menus.asc'),
  ED_MESSAGES: block('Ed1', 'Ed2'),
  ED_TST_MESSAGES: block('.Test1', '.Test2'),
  ED_RUN_MESSAGES: block('.Error1', '.Error2'),
}

const lit = (s: string): string =>
  `'${[...s]
    .map((c) => {
      const n = c.charCodeAt(0)
      if (c === "'" || c === '\\') return '\\' + c
      if (n < 32 || n > 126) return '\\x' + n.toString(16).padStart(2, '0')
      return c
    })
    .join('')}'`

const provenance = ` * Records are 1-based in the order the block declares them (GetMessage
 * +B.s:590); the numbers in the assembler macro calls are comments and do not
 * all start at 1. Resource\$ reaches all five below -1000 (FnResource
 * +ILib.s:6699), which is why FnResource has to name both files.`

const heads: Record<string, string> = {
  'src/runtime/edmessages.gen.ts': `/**
 * GENERATED by src/cli/genedmsg.ts from +Editor_Config.s — do not edit.
 *
 * Four of the editor's five message tables. The fifth, .Error1, is the AMOS
 * RUN-TIME error table and lives in src/interp/errors.gen.ts beside the code
 * that raises those errors: interp is the lower layer, and values.ts reaching
 * up into runtime/ for the messages was the one import that went backwards.
 *
${provenance}
 */
`,
  'src/interp/errors.gen.ts': `/**
 * GENERATED by src/cli/genedmsg.ts from +Editor_Config.s — do not edit.
 *
 * .Error1: the AMOS run-time error table, which \`Errn\` numbers and \`Err\$\`
 * prints. Split out of the editor's other four message blocks (which are in
 * src/runtime/edmessages.gen.ts) because this one belongs to the error system
 * in ./values.ts, and that module sits BELOW runtime.
 *
${provenance}
 */
`,
}

const emit = (path: string, names: string[]): void => {
  const body = names
    .map((name) => {
      const msgs = tables[name as keyof typeof tables]
      return `\n/** ${msgs.length} messages */\nexport const ${name}: readonly string[] = [\n${msgs.map((m) => `  ${lit(m)},`).join('\n')}\n]\n`
    })
    .join('')
  writeFileSync(path, heads[path] + body)
}

emit('src/runtime/edmessages.gen.ts', ['ED_SYSTEME', 'EDM_MESSAGES', 'ED_MESSAGES', 'ED_TST_MESSAGES'])
emit('src/interp/errors.gen.ts', ['ED_RUN_MESSAGES'])
for (const [name, msgs] of Object.entries(tables)) console.log(`${name}: ${msgs.length}`)
