import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { mustFinish } from '../testing/run'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { extensionById } from '../ext/registry'
import { firstCodeHunk } from '../tokens/libtok'
import { Runtime } from './runtime'
import { PERSONNAL_1_1_VERSION } from './plib'

const table = new TokenTable(CORE_TOKENS)
/** slot 17, which the source names itself: `ExtNb Equ 17-1` (:14) */
const plib = extensionById('personnal-extra-1.0a')!
/** slot 13, and only the 1.1 build carries the signature Plib Ver looks for */
const p11 = extensionById('personnal-1.1')!
const p10b = extensionById('personal-1.0b')!

const DIR = join(__dirname, '../../fixtures/extensions')
const LIB_11 = join(DIR, 'personnal-1.1/AmosPro_Personnal.Lib')
const LIB_10B = join(DIR, 'personal-1.0b/AMOSPro_Personnal.Lib')
const SRC = join(DIR, 'personnal-1.1/demos/PersonnalEXTRA/Personnal-EXTRA.Lib.S')

/** `with` names which Personnal build is in slot 13, or none */
function run(src: string, withP: 'none' | '1.1' | '1.0b' = '1.1'): string {
  let out = ''
  const exts = new Map([[17, plib.table]])
  const bind = new Map([[17, plib]])
  if (withP === '1.1') { exts.set(13, p11.table); bind.set(13, p11) }
  if (withP === '1.0b') { exts.set(13, p10b.table); bind.set(13, p10b) }
  const rt = new Runtime(tokenize(src, table, exts), table, {
    extensions: exts,
    extBindings: bind,
    maxSteps: 200_000,
    onText: (t) => (out += t),
  })
  const r = rt.runHeadless(20)
  mustFinish(r)
  return out
}

describe('Personnal EXTRA 1.0a: the two keywords', () => {
  it('=Plib Ver and =Plib Rev report Personnal 1.1 as version 1, revision 1', () => {
    // AP_VERSION returns both at once — d0 the version, d1 the revision — and
    // the two keywords keep one register each (:99, :113)
    expect(run('Print Plib Ver').trim()).toBe('1')
    expect(run('Print Plib Rev').trim()).toBe('1')
  })

  /**
   * Read out of the shipped library rather than trusted.
   *
   * `PsJsr AP_VERSION` is `Jsr -6(a2)`, six bytes before Personnal's data
   * zone. In 1.1 that is a `bra.l` whose target is three instructions, and
   * this follows the branch the way the 68k would.
   */
  it.skipIf(!existsSync(LIB_11))('agrees with the AP_VERSION stub in the 1.1 library', () => {
    const code = firstCodeHunk(new Uint8Array(readFileSync(LIB_11)))!
    const fwc = Buffer.from(code).toString('latin1').indexOf('Fred')
    expect(fwc).toBeGreaterThan(0)
    // FWC-6: `60 ff` is BRA with a 32-bit displacement, taken from PC+2
    expect([code[fwc - 6], code[fwc - 5]]).toEqual([0x60, 0xff])
    const disp = new DataView(code.buffer, code.byteOffset).getInt32(fwc - 4)
    const at = fwc - 6 + 2 + disp
    // move.l #ver,d0 / move.l #rev,d1 / rts
    expect([code[at], code[at + 1]]).toEqual([0x20, 0x3c])
    expect([code[at + 6], code[at + 7]]).toEqual([0x22, 0x3c])
    const dv = new DataView(code.buffer, code.byteOffset)
    expect(dv.getUint32(at + 2)).toBe(PERSONNAL_1_1_VERSION.ver)
    expect(dv.getUint32(at + 8)).toBe(PERSONNAL_1_1_VERSION.rev)
    expect([code[at + 12], code[at + 13]]).toEqual([0x4e, 0x75]) // rts
  })
})

describe('Personnal EXTRA 1.0a: the "Fred" test', () => {
  it('raises the library\'s own message when Personnal is absent', () => {
    // `cmp.l #"Fred",d0 / Bne NOTLOADED` in the DEFAULT routine (:72), then
    // ErrMess at :136
    expect(() => run('Print Plib Ver', 'none')).toThrow(/PERSONNAL\.LIB Not loaded/)
    expect(() => run('Print Plib Rev', 'none')).toThrow(/PERSONNAL\.LIB Not loaded/)
  })

  it('raises it under Personnal 1.0b TOO, because 1.0b has no signature', () => {
    // the interesting half: Personnal IS loaded and the keywords still refuse,
    // because the test is for the "Fred" longword and only 1.1 has one
    expect(() => run('Print Plib Ver', '1.0b')).toThrow(/PERSONNAL\.LIB Not loaded/)
  })

  it.skipIf(!existsSync(LIB_11) || !existsSync(LIB_10B))(
    'and that is a fact about the two libraries, not about this port',
    () => {
      const has = (f: string): boolean => {
        const code = firstCodeHunk(new Uint8Array(readFileSync(f)))!
        const s = Buffer.from(code).toString('latin1')
        // a "Fred" that is NOT part of "Frederic" is the data-zone signature
        for (let i = s.indexOf('Fred'); i >= 0; i = s.indexOf('Fred', i + 1)) {
          if (!s.startsWith('Frederic', i)) return true
        }
        return false
      }
      expect(has(LIB_11)).toBe(true)
      expect(has(LIB_10B)).toBe(false)
    },
  )
})

describe('Personnal EXTRA 1.0a: the source', () => {
  it.skipIf(!existsSync(SRC))('declares slot 17 and exactly these two keywords', () => {
    const text = readFileSync(SRC, 'latin1')
    expect(text).toMatch(/ExtNb\s+Equ\s+17-1/)
    expect(text).toMatch(/"plib ve","r"\+\$80/)
    expect(text).toMatch(/"plib re","v"\+\$80/)
    const named = plib.table.entries.map((e) => e.name.trim().replace(/^!/, '')).filter((n) => n !== '')
    expect(named).toEqual(['plib ver', 'plib rev'])
  })
})
