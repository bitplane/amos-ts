/**
 * Run the suite the way CI sees it: no corpus, no `fixtures/`.
 *
 * Both are on this machine and neither is in the repository, so a test that
 * dereferences one at collection time passes here and takes its whole file
 * down there. That is how `v0.9.1` went out broken: twelve files lost, ten of
 * them to `describe.skipIf` running its factory anyway. See
 * ../testing/fixture.ts.
 *
 * A detached worktree IS that machine. It has no `fixtures/` because they are
 * gitignored, and `../amos-files` resolves next to the worktree rather than
 * next to this checkout, so `haveCorpus()` is false without anything being
 * moved or renamed. `node_modules` is symlinked rather than installed, which
 * is the only reason this takes a minute instead of five.
 *
 * It runs COMMITTED code, deliberately. What CI will build is what is pushed,
 * and a check that read the working tree would pass on a fix still sitting
 * unstaged.
 *
 *   npm run test:ci            the current HEAD
 *   npm run test:ci -- v0.9.1  any commit-ish
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const ref = process.argv[2] ?? 'HEAD'
const repo = resolve(join(import.meta.dirname, '..', '..'))
const tree = mkdtempSync(join(tmpdir(), 'amos-ci-'))

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()
}

let added = false
try {
  console.log(`checking ${ref} (${git('rev-parse', '--short', ref)}) with no corpus and no fixtures`)
  git('worktree', 'add', '--detach', tree, ref)
  added = true
  symlinkSync(join(repo, 'node_modules'), join(tree, 'node_modules'))

  // proof rather than assumption: if either of these is reachable the run
  // below is not the check it claims to be
  for (const path of [join(tree, 'fixtures'), resolve(tree, '..', 'amos-files')]) {
    if (existsSync(path)) throw new Error(`${path} is visible from the worktree; this is not a CI-like run`)
  }

  execFileSync('npx', ['vitest', 'run'], {
    cwd: tree,
    stdio: 'inherit',
    env: { ...process.env, AMOS_COVERAGE_GATE: '1' },
  })
  console.log('\nthe suite is green without the corpus, which is what CI runs')
} catch (e) {
  console.error(`\nfailed as CI would: ${e instanceof Error ? e.message : String(e)}`)
  process.exitCode = 1
} finally {
  if (added) git('worktree', 'remove', '--force', tree)
  rmSync(tree, { recursive: true, force: true })
}
