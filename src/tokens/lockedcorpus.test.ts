/**
 * The locked-procedure cipher against real ciphertext.
 *
 * A synthetic round trip can only show the routine is self-consistent. What
 * shows it is AMOS's own is a program locked by AMOS in 1992 coming back as
 * the source its author wrote, and these two are the ones worth pinning:
 *
 *   Lock.AMOS    APD076 of the AMOS PD Library CD — the AMOS Procedure Locker
 *                itself, by Francois Lionet, whose LOCKIT procedure is locked
 *                by itself and offers champagne to whoever unlocks it. Its
 *                own listing is the specification of the flags word.
 *   TUSTMC.AMOS  APD553 — locked procedures nested inside locked ones, the
 *                case that needs the walk to go INTO each body as it opens.
 *
 * Both live under `fixtures/`, which is gitignored: they are not ours to
 * redistribute. Copy them from the archive to run these.
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MACHINE_CODE_PROC, TokenTable, parseSource } from './stream'
import { detokSource } from './detok'
import { CORE_TOKENS } from './tables.gen'
import { parseAmosFile } from '../loader/amosfile'

const locked = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'locked')
const table = new TokenTable(CORE_TOKENS)

const listing = (name: string): string => {
  const amos = parseAmosFile(readFileSync(join(locked, name)))
  const lines = parseSource(amos.source, table)
  for (const line of lines) {
    for (const tok of line.tokens) {
      if (tok.kind === 'proc' && tok.protectedBody && !(tok.flags & MACHINE_CODE_PROC)) {
        throw new Error(`${name}: a locked procedure did not decipher`)
      }
    }
  }
  return detokSource(lines, table)
}

describe.skipIf(!existsSync(join(locked, 'Lock.AMOS')))('Lock.AMOS deciphers', () => {
  it('LOCKIT, the locked procedure that does the locking, lists', () => {
    const src = listing('Lock.AMOS')
    expect(src).toContain('Procedure LOCKIT')
    // the flags word, in the author's own code: bit 15 is "closed", bit 14 is
    // what he sets to lock it, and the low byte is a fresh random per
    // procedure — which is the key material this port reads back
    expect(src).toContain('If Btst(15,P)')
    expect(src).toContain('Bset 14,P')
    expect(src).toContain('P=(P and $FF00)+Rnd(254)+1')
    // and this line is why $1E and $36 were swapped back: the author wrote
    // the Procedure token's own id, which +Equ.s:2051 gives as $00000376
    expect(src).toContain('TKPROC=$376')
    expect(src).toContain('Doke AD+10,P')
    // and it walks the program the same way the port does, by line length
    expect(src).toContain('L=Peek(AD)*2')
    expect(src).toContain('If Deek(AD+2)=TKPROC')
  })

  it('the champagne offer is in the clear, and the procedure it guards is not', () => {
    const src = listing('Lock.AMOS')
    expect(src).toContain('I offer a bottle of good French champagne')
    // the comment is outside the procedure; the body was the part enciphered
    expect(src.indexOf('champagne')).toBeLessThan(src.indexOf('Procedure LOCKIT'))
  })
})

describe.skipIf(!existsSync(join(locked, 'TUSTMC.AMOS')))('TUSTMC.AMOS deciphers', () => {
  it('locked procedures nested inside locked ones come out too', () => {
    const src = listing('TUSTMC.AMOS')
    expect(src).toContain('Procedure _C1')
    expect(src).toContain('Procedure _C2')
    expect(src.match(/^Procedure /gm)?.length ?? 0).toBeGreaterThan(2)
  })
})
