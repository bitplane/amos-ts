/**
 * vitest setupFiles hook: install the keyword-dispatch probe.
 *
 * Runs in each test worker. Each test file flushes what has been dispatched so
 * far; ./gate.ts aggregates across workers on teardown.
 */
import { afterAll } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PROBE_DIR, setKeywordProbe } from './probe'

const seen = new Set<string>()
setKeywordProbe(seen)

let flush = 0
afterAll(() => {
  if (seen.size === 0) return
  mkdirSync(PROBE_DIR, { recursive: true })
  writeFileSync(join(PROBE_DIR, `${process.pid}-${flush++}.json`), JSON.stringify([...seen]))
})
