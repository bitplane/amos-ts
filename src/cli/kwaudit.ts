/**
 * Run the keyword audit over core AMOS keywords, one Haiku call per keyword.
 *
 * `auditctx.ts` assembles the evidence — the original 68k routine found from
 * the binary's own routine number, and the port's handler. This hands one
 * bundle at a time to a model with `kwaudit.prompt.md` and records the verdict.
 * Nothing here reads a keyword itself; the whole point is that the reading is
 * cheap enough to do 620 times.
 *
 * The bundle is the whole context. The model is given no tools and one turn,
 * so it cannot wander off into the tree and cannot spend an unbounded amount
 * of time on one keyword. What it cannot see, it is told to report as
 * `unreadable` rather than guess at, and those are the rows worth widening the
 * bundle for on the next pass.
 *
 * Run:  npx tsx src/cli/kwaudit.ts --all
 *       npx tsx src/cli/kwaudit.ts --list audit/priority.txt --dry
 *       npx tsx src/cli/kwaudit.ts circle bar plot
 *       npx tsx src/cli/kwaudit.ts --all --jobs 8 --out audit/core.jsonl
 *
 * Resumable: a keyword already in the output file is skipped, so a killed run
 * continues where it stopped. Delete the file to start over.
 */
import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bundleFor, coreKeywords } from './auditctx'
import { NA, STRUCTURAL } from '../coverage/status'

/**
 * Run the CLI once and hand back stdout.
 *
 * `execFile` is the obvious call and it will not close stdin: the promisified
 * form drops the `stdio` option, so every run waited three seconds for piped
 * input that never came and said so on stderr. Across the core keyword set
 * that is half an hour of waiting, and the warning was still appearing after
 * the option was added. `spawn` takes it.
 */
function run(args: string[], cwd: string, timeoutMs: number): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let killed = false
    const timer = setTimeout(() => {
      killed = true
      child.kill('SIGTERM')
    }, timeoutMs)
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()))
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()))
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (killed) reject(new Error(`timed out after ${timeoutMs / 1000}s`))
      else resolve({ stdout, stderr, code: code ?? 0 })
    })
  })
}
const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')
const PROMPT = readFileSync(join(HERE, 'kwaudit.prompt.md'), 'utf8')

export interface Finding {
  kind: string
  severity: string
  claim: string
  original: string
  port: string
}

export interface Verdict {
  keyword: string
  verdict: 'clean' | 'question' | 'defect' | 'error'
  findings: Finding[]
  /** set when the run itself failed rather than the keyword being clean */
  error?: string
  /** the first reply was unusable and this is the second */
  retried?: boolean
  ms: number
}

/** the bundle as the model sees it: the same text `auditctx <kw>` prints */
function render(name: string): string | null {
  const b = bundleFor(name)
  if (!b) return null
  const out: string[] = []
  out.push(`# ${b.keyword}   [${b.classification}]`)
  out.push(`\n## the forms the shipped token table gives this keyword`)
  for (const f of b.forms) {
    out.push(`- spec ${JSON.stringify(f.spec)} — instruction routine ${f.instr}, function routine ${f.func}`)
  }
  if (b.note) out.push(`\n## the port's own note in status.ts\n${b.note}`)
  for (const o of b.original) {
    if ('unresolved' in o) {
      out.push(`\n## original (${o.side}, routine ${o.routine}) — UNRESOLVED: ${o.unresolved}`)
    } else {
      out.push(`\n## original (${o.side}, routine ${o.routine}) — ${o.label}, ${o.file}:${o.from}`)
      out.push('```\n' + o.code + '\n```')
    }
  }
  for (const r of b.alsoReads) {
    out.push(`\n## the original branches into ${r.label} (${r.file}:${r.from})`)
    out.push('```\n' + r.code + '\n```')
  }
  if (b.handler) {
    out.push(`\n## the port — ${b.handler.file}:${b.handler.from}`)
    if (b.handler.doc) out.push('```\n' + b.handler.doc + '\n```')
    out.push('```\n' + b.handler.code + '\n```')
  } else {
    out.push('\n## the port — NO HANDLER FOUND for this keyword')
  }
  for (const hp of b.helpers) {
    out.push(`\n## the port's handler calls ${hp.name} (${hp.file}:${hp.from})`)
    out.push('```\n' + hp.code + '\n```')
  }
  for (const t of b.tests) out.push(`\n## a test that runs it — ${t.file}\n${t.lines.join('\n')}`)
  return out.join('\n')
}

/** pull the JSON object out of whatever the model wrapped it in */
/**
 * Pull the verdict out of whatever the model wrapped it in.
 *
 * Three shapes went wrong across the first two hundred keywords and all three
 * are recoverable, so none of them should cost the keyword:
 *
 *   - `mid$` put a raw newline inside a JSON string, which is a parse error
 *     however clearly the prompt asks for one line per field. Control
 *     characters have no business in this JSON, so they become spaces.
 *   - `freeze` answered `"verdict": "unreadable"` -- a finding KIND in the
 *     verdict slot. It means "I could not tell", which is `question`.
 *   - `next` came back empty, which only a retry can fix.
 */
function parse(text: string, keyword: string): Verdict {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)
  const raw = (fenced?.[1] ?? text).trim()
  const at = raw.indexOf('{')
  const to = raw.lastIndexOf('}')
  if (at < 0 || to < at) throw new Error(`no JSON object in reply: ${text.slice(0, 200)}`)
  // eslint-disable-next-line no-control-regex
  const body = raw.slice(at, to + 1).replace(/[\u0000-\u0008\u000a-\u001f]/g, ' ')
  const v = JSON.parse(body) as Partial<Verdict>
  const known = ['clean', 'question', 'defect']
  const verdict = typeof v.verdict === 'string' && known.includes(v.verdict) ? v.verdict : 'question'
  return {
    keyword,
    verdict: verdict as Verdict['verdict'],
    findings: Array.isArray(v.findings) ? v.findings : [],
    ms: 0,
  }
}

async function auditOne(name: string, model: string): Promise<Verdict> {
  const t0 = Date.now()
  const b = bundleFor(name)
  if (b === null) {
    return { keyword: name, verdict: 'error', findings: [], error: 'not a core keyword', ms: 0 }
  }

  /**
   * A missing handler is a finding the tool can make on its own, and a model
   * call cannot improve on it. `follow`, `follow off`, `as` and `screen size`
   * are in the shipped token table with a routine each and nothing in this
   * tree answers them.
   */
  if (b.handler === null) {
    return {
      keyword: name,
      verdict: 'question',
      findings: [
        {
          kind: 'no-handler',
          severity: 'major',
          claim: `no handler found for \`${name}\`, which the token table lists with instruction routine ${b.instrRoutine} and function routine ${b.funcRoutine}`,
          original: b.original.map((o) => ('label' in o ? `${o.label} ${o.file}:${o.from}` : o.unresolved)).join('; '),
          port: '(none)',
        },
      ],
      ms: Date.now() - t0,
    }
  }

  const bundle = render(name)
  if (bundle === null) {
    return { keyword: name, verdict: 'error', findings: [], error: 'render failed', ms: 0 }
  }
  const args = [
    '-p',
    `${PROMPT}\n\n---\n\n${bundle}`,
    '--model',
    model,
    // 1 turn killed every run where the model reached for a tool before
    // answering ("Reached max turns (1)"); the tools are denied instead,
    // so a stray reach costs a turn rather than the whole keyword
    '--max-turns',
    '4',
    // variadic, so it must come LAST and the prompt must come before it —
    // given the flag first it ate the prompt and reported every word of it
    // as an unknown tool
    '--disallowedTools',
    ...['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'Task', 'TodoWrite'],
  ]

  /** one call, and whatever it said */
  const once = async (): Promise<Verdict> => {
    const { stdout, stderr, code } = await run(args, ROOT, 480_000)
    if (code !== 0) throw new Error(`exit ${code}: ${stderr.trim().slice(0, 300)}`)
    return parse(stdout, name)
  }

  try {
    let v: Verdict
    try {
      v = await once()
    } catch (first) {
      // `next` came back with an empty reply. One retry, because losing a
      // keyword to a blank answer costs more than the two minutes.
      try {
        v = await once()
        v.retried = true
      } catch {
        throw first
      }
    }
    v.ms = Date.now() - t0
    return v
  } catch (e) {
    // execFile's message is the whole command line, which for this tool is the
    // whole prompt — useless. What went wrong is on stderr and in stdout.
    const x = e as { stderr?: string; stdout?: string; code?: number; signal?: string }
    const why =
      [x.stderr?.trim(), x.stdout?.trim()].filter(Boolean).join(' | ').slice(0, 500) ||
      (e instanceof Error ? e.message.slice(0, 200) : String(e))
    return {
      keyword: name,
      verdict: 'error',
      findings: [],
      error: `exit ${x.code ?? '?'}${x.signal ? ` (${x.signal})` : ''}: ${why}`,
      ms: Date.now() - t0,
    }
  }
}

// ---------------------------------------------------------------- cli

const argv = process.argv.slice(2)
const flag = (n: string, d: string): string => {
  const i = argv.indexOf(n)
  return i >= 0 ? (argv[i + 1] ?? d) : d
}
const out = flag('--out', join(ROOT, 'audit', 'core.jsonl'))
const model = flag('--model', 'haiku')
const jobs = Math.max(1, Number(flag('--jobs', '6')))

let names = argv.filter(
  (a, i) => !a.startsWith('--') && !['--out', '--model', '--jobs', '--list'].includes(argv[i - 1] ?? ''),
)
/**
 * `--list f` reads one keyword per LINE, which is the only safe way to name
 * them. Two thirds of the core set are two words — `double buffer`, `set
 * rainbow`, `reserve as chip work` — and passed on the command line the shell
 * splits every one of them. A run given `spritebob col frame load` audited
 * `spritebob`, `col`, `frame` and `load` as four separate keywords, three of
 * which are not keywords at all.
 */
const listFile = flag('--list', '')
if (listFile !== '') {
  names = names.concat(
    readFileSync(listFile, 'utf8')
      .split('\n')
      .map((l) => l.trim().toLowerCase())
      .filter((l) => l !== '' && !l.startsWith('#')),
  )
}
if (argv.includes('--all')) {
  const known = new Set(names)
  // structural tokens and n/a keywords carry no port obligation, and their
  // names are punctuation and grammar words that match anything: `to` found a
  // handler in craft.ts, `step` one in amal.ts, `'` one in thegame.ts
  names = coreKeywords()
    .map((t) => t.name.replace(/^!/, '').trim().toLowerCase())
    .filter((n) => !known.has(n) && !STRUCTURAL.has(n) && !NA.has(n))
}
if (names.length === 0) {
  console.error('usage: kwaudit [--all] [--list f] [--jobs N] [--model haiku] [--out f.jsonl] <keyword...>')
  process.exit(1)
}

/**
 * `--dry` resolves every name and prints what a real run would do, spending
 * nothing. A name the token table does not hold is the failure worth catching
 * here: it costs a model call to discover otherwise, and a shell that split a
 * two-word keyword produces a whole list of them.
 */
if (argv.includes('--dry')) {
  let bad = 0
  for (const n of names) {
    const b = bundleFor(n)
    const why =
      b === null ? 'NOT A CORE KEYWORD' : b.handler === null ? 'no handler' : `${b.forms.length} form(s), ${b.original.length} routine(s)`
    if (b === null) bad++
    console.log(`${b === null ? '!' : ' '} ${n.padEnd(24)} ${why}`)
  }
  console.error(`\n${names.length} names, ${bad} not in the token table`)
  process.exit(bad === 0 ? 0 : 1)
}

mkdirSync(dirname(out), { recursive: true })
const done = new Set<string>()
if (existsSync(out)) {
  for (const line of readFileSync(out, 'utf8').split('\n')) {
    if (line.trim() === '') continue
    try {
      const v = JSON.parse(line) as Verdict
      if (v.verdict !== 'error') done.add(v.keyword)
    } catch {
      /* a truncated last line from a killed run */
    }
  }
} else {
  writeFileSync(out, '')
}

const todo = names.filter((n) => !done.has(n))
console.error(`${todo.length} keywords to audit (${done.size} already done), ${jobs} at a time, model ${model}`)

let next = 0
let clean = 0
let flagged = 0
let failed = 0

async function worker(): Promise<void> {
  for (;;) {
    const i = next++
    if (i >= todo.length) return
    const name = todo[i]
    if (name === undefined) return
    const v = await auditOne(name, model)
    appendFileSync(out, JSON.stringify(v) + '\n')
    if (v.verdict === 'error') failed++
    else if (v.verdict === 'clean') clean++
    else flagged++
    const mark = v.verdict === 'clean' ? '.' : v.verdict === 'error' ? '!' : v.verdict === 'defect' ? 'D' : '?'
    console.error(
      `[${clean + flagged + failed}/${todo.length}] ${mark} ${v.keyword} ` +
        `(${v.findings.length} finding${v.findings.length === 1 ? '' : 's'}, ${(v.ms / 1000).toFixed(1)}s)`,
    )
  }
}

await Promise.all(Array.from({ length: Math.min(jobs, todo.length) }, () => worker()))
console.error(`\ndone: ${clean} clean, ${flagged} flagged, ${failed} failed -> ${out}`)
