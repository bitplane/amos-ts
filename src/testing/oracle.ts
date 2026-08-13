/**
 * Test-only helpers. Not part of the package — tsconfig.build.json excludes
 * this directory, the way it excludes the coverage gate and the CLI.
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Teemu Suutari's `ancient` as an outside reader of the codecs in ../amiga.
 *
 * Those codecs are written from a disassembly or from the format, and their
 * own tests can only ask whether this port agrees with itself. An encoder
 * written from the same reading as its decoder will agree with it all the way
 * to a wrong answer, and that is not a hypothetical: `pp20Crunch` wrote
 * streams `pp20Decrunch` was happy with and real powerpacker.library was not,
 * for as long as nothing outside this repo had looked at them.
 *
 * `ancient` implements ByteKiller, StoneCracker, PowerPacker, the Imploder
 * and the XPK container from its own reading of each. Running the binary and
 * comparing bytes is the whole of the arrangement. Its source is never read,
 * the same rule every other third-party implementation here is held to.
 */

/**
 * `ancient --version` prints to stderr and exits 255, as does a bare
 * `ancient`, so the build is scraped rather than asked for. ENOENT is the
 * only answer that means the binary is absent.
 */
const probe = spawnSync('ancient', ['--version'], { encoding: 'utf8' })

/** whether the binary is on PATH at all */
export const HAS_ANCIENT = (probe.error as NodeJS.ErrnoException | undefined)?.code !== 'ENOENT'

/** the build, as `2.1.0`, or null if it did not say */
export const ORACLE = (/Ancient v([\d.]+)/.exec(probe.stderr ?? '') ?? [])[1] ?? null

/**
 * Builds these expectations have actually been run against.
 *
 * What the tests pin is observed output, not documented output, and upstream
 * moves it: 2.2.0 changed the ids of clone formats and 2.3.0 lowered the
 * decompression-bomb limits. An unlisted build fails by name, so version
 * drift reads as version drift rather than as a codec mismatch.
 *
 * 2.1.0 is what ubuntu-latest carries on noble and 2.3.0 is Ubuntu 26.04's.
 * They agree on every check in this repo.
 */
export const CHECKED = ['2.1.0', '2.3.0']

/**
 * Whether a machine without the oracle is a skip or a failure.
 *
 * A skip and a pass are the same colour. CI installs `ancient` and sets this,
 * so deleting that step turns the run red rather than quietly removing the
 * only external check these codecs have. Locally it is unset and the oracle
 * tests skip, because a contributor without the binary should not be blocked.
 */
export const ORACLE_REQUIRED = process.env.AMOS_ORACLE === '1'

/** compare two dotted versions, `-1` / `0` / `1` */
const cmp = (a: string, b: string): number => {
  const x = a.split('.').map(Number)
  const y = b.split('.').map(Number)
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0)
    if (d !== 0) return d < 0 ? -1 : 1
  }
  return 0
}

/**
 * Whether the installed build is at least `want`.
 *
 * ByteKiller arrived in 2.3.0, so a test that needs it cannot run on the
 * 2.1.0 that CI installs. Gating on the version rather than on the binary
 * keeps that a skip on the older build instead of a failure.
 */
export const oracleAtLeast = (want: string): boolean => HAS_ANCIENT && ORACLE !== null && cmp(ORACLE, want) >= 0

let dir: string | null = null
const scratch = (): string => (dir ??= mkdtempSync(join(tmpdir(), 'amos-oracle-')))

/** what `ancient identify` says about a buffer, stdout or the refusal on stderr */
export function ancientIdentify(packed: Uint8Array, name = 'packed'): string {
  const p = join(scratch(), name)
  writeFileSync(p, packed)
  const r = spawnSync('ancient', ['identify', p], { encoding: 'utf8' })
  return (r.stdout || '') + (r.stderr || '')
}

/**
 * Decode `packed` with `ancient` and insist it comes back as `raw`.
 *
 * Returns the verdict line so a caller can assert on it. `Files match!` is
 * the only success `ancient verify` prints.
 */
export function ancientVerify(packed: Uint8Array, raw: Uint8Array, name = 'packed'): string {
  const p = join(scratch(), name)
  const r = join(scratch(), `${name}.raw`)
  writeFileSync(p, packed)
  writeFileSync(r, raw)
  const out = spawnSync('ancient', ['verify', p, r], { encoding: 'utf8' })
  return (out.stdout || '') + (out.stderr || '')
}
