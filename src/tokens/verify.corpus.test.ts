/**
 * `PTest` over the corpus rather than over `fixtures/`.
 *
 * The whole sweep is 3,873 programs in under seven seconds, so there is no
 * sampling here: the numbers below are the whole thing. 3,732 walk to the end,
 * and 1,091 come out BYTE FOR BYTE the way the Amiga saved them, which is the
 * only measure that can distinguish a verifier from a plausible one.
 *
 * That count is 28%, not 100%, and the reason is in the artefacts rather than
 * in the walk. The editor retokenises a line when the cursor leaves it, and a
 * program saved after an edit and before a run carries lines the verifier
 * never reached: their variable link reads zero, their array flag has no bit
 * 6, and `Cls 0` is back on $0BAE rather than the $0BB8 the verifier had
 * promoted it to. Measured over fixtures: of the 237 programs whose variable
 * offsets drift from the saved ones, 229 start drifting at exactly such a
 * record. So `verify(saved) === saved` is a test of the file's edit history as
 * much as of this code, and the fixed point in verify.test.ts is the one that
 * is not.
 *
 * The 141 that stop are counted by error, and the shape of that count is what
 * this file guards. Only five are syntax errors in 3,873 programs.
 */
import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { corpusFile, corpusIndex, haveCorpus } from '../cli/corpus'
import { describeIf } from '../testing/fixture'
import { TokenTable, decipheredSource, parseSource } from './stream'
import { CORE_TOKENS } from './tables.gen'
import { parseAmosFile } from '../loader/amosfile'
import { extensionAp20For, extensionTablesFor } from '../ext/identify'
import { VerifyError, verify } from './verify'

const table = new TokenTable(CORE_TOKENS)

/** every AMOS program in the index, once per distinct checksum */
function programs(): string[] {
  const index = corpusIndex()
  const out: string[] = []
  for (const [sha, path] of index) {
    if (!/\.amos$/i.test(path)) continue
    const file = corpusFile(sha, index)
    if (file !== null) out.push(file)
  }
  return out
}

const sweep = { programs: 0, verified: 0, identical: 0, codes: new Map<number, number>() }
for (const path of programs()) {
  let src: Uint8Array
  let lines
  try {
    const file = parseAmosFile(new Uint8Array(readFileSync(path)))
    if (file.source.length === 0) continue
    lines = parseSource(file.source, table)
    src = decipheredSource(file.source, table)
  } catch {
    continue
  }
  sweep.programs++
  try {
    const out = verify(src, {
      extensions: extensionTablesFor(lines),
      ap20: extensionAp20For(lines),
    })
    sweep.verified++
    let same = true
    for (let i = 0; i < src.length; i++) {
      if (src[i] !== out[i]) {
        same = false
        break
      }
    }
    if (same) sweep.identical++
  } catch (e) {
    const code = e instanceof VerifyError ? e.code : -1
    sweep.codes.set(code, (sweep.codes.get(code) ?? 0) + 1)
  }
}
if (process.env.AMOS_VERIFY_REPORT !== undefined) {
  console.log(
    JSON.stringify({
      programs: sweep.programs,
      verified: sweep.verified,
      identical: sweep.identical,
      codes: [...sweep.codes].sort((a, b) => b[1] - a[1]),
    }),
  )
}

describeIf('every program in the corpus, verified', haveCorpus(), () => {
  it('read the whole index, so an empty sweep cannot pass for a clean one', () => {
    expect(sweep.programs).toBeGreaterThan(3500)
  })

  it('walks at least nineteen programs in twenty to the end', () => {
    expect(sweep.verified / sweep.programs).toBeGreaterThan(0.95)
  })

  /**
   * The one that is not a ratio. A saved program is what the verifier left
   * behind, so reproducing it exactly is the claim being made, and a
   * regression anywhere in the walk moves this number first.
   */
  it('reproduces a thousand of them to the byte', () => {
    expect(sweep.identical).toBeGreaterThan(1000)
  })

  /**
   * A syntax error means the walk lost its place, and everything after it in
   * the program is unread. The other codes are the verifier's real judgements:
   * a label nobody defined, an array nobody dimensioned, an extension slot no
   * library on this machine answers for.
   */
  it('loses its place in fewer than one program in five hundred', () => {
    expect((sweep.codes.get(35) ?? 0) / sweep.programs).toBeLessThan(0.002)
  })

  /**
   * Nothing may fail for a reason that is not a VerifyError. A throw from
   * anywhere else is a bug in the walk wearing an exception.
   */
  it('never fails for a reason it cannot name', () => {
    expect(sweep.codes.get(-1) ?? 0).toBe(0)
  })
})
