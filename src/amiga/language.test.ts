import { describe, expect, it } from 'vitest'
import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { LANGUAGE_ENTRIES, parseLanguage, languageStr } from './language'
import { LANGUAGE_STRINGS, MAXSTRMSG, STR_ID } from './localelib.gen'

describe('parseLanguage: what is not a language library', () => {
  it('rejects anything that is not a hunk file', () => {
    expect(parseLanguage(new Uint8Array(0))).toBeNull()
    expect(parseLanguage(new Uint8Array(2000))).toBeNull()
    expect(parseLanguage(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]))).toBeNull()
  })

  it('rejects a hunk file with no string table in it', () => {
    // a minimal, valid, relocation-free code hunk: HUNK_HEADER, one hunk of
    // one long, HUNK_CODE, HUNK_END
    const w = [0x3f3, 0, 1, 0, 0, 1, 0x3e9, 1, 0x4e750000, 0x3f2]
    const b = new Uint8Array(w.length * 4)
    const dv = new DataView(b.buffer)
    w.forEach((v, i) => dv.setUint32(i * 4, v >>> 0))
    expect(parseLanguage(b)).toBeNull()
  })
})

/**
 * The real proof: the nine Workbench 2.1 language libraries, built by Commodore
 * in October 1992. A hand-built .language would only show that this reader
 * agrees with whatever wrote it — which is exactly how the CTLG reader was once
 * green and wrong.
 */
const files: Array<[string, Uint8Array]> = (() => {
  const out: Array<[string, Uint8Array]> = []
  const seen = new Set<string>()
  let paths: string[] = []
  try {
    // paths are raw BYTES and not all UTF-8: "français.language" is latin-1,
    // and decoding it as UTF-8 gives a path that will not open
    paths = execSync(`find /home/gaz/src/tmp/amos -iname '*.language' 2>/dev/null`, { maxBuffer: 1 << 26 })
      .toString('latin1')
      .trim()
      .split('\n')
      .filter(Boolean)
  } catch {
    return out
  }
  for (const p of paths) {
    const name = (p.split('/').pop() ?? '').toLowerCase()
    if (seen.has(name)) continue
    seen.add(name)
    if (!existsSync(Buffer.from(p, 'latin1'))) continue
    out.push([name.replace(/\.language$/, ''), new Uint8Array(readFileSync(Buffer.from(p, 'latin1')))])
  }
  return out
})()

describe.skipIf(files.length < 5)('against the real Workbench 2.1 languages', () => {
  it('reads every one, and they all carry the same number of ids', () => {
    for (const [name, bytes] of files) {
      const lang = parseLanguage(bytes)
      expect(`${name}:${lang === null ? 'REJECTED' : lang.strings.length}`).toBe(`${name}:${LANGUAGE_ENTRIES}`)
    }
  })

  /**
   * The table is indexed by id with an unused entry at 0, so DAY_1 lands on
   * Sunday. Getting this off by one would shift every string by a day and
   * still look entirely plausible, which is why it is checked against words
   * rather than against a count.
   */
  it('id 1 is Sunday, in the language the file is named for', () => {
    const sunday: Record<string, string> = {
      deutsch: 'Sonntag',
      svenska: 'Söndag',
      dansk: 'Søndag',
      norsk: 'Søndag',
      français: 'Dimanche',
      español: 'domingo',
      italiano: 'Domenica',
      nederlands: 'zondag',
      português: 'Domingo',
    }
    for (const [name, bytes] of files) {
      const want = sunday[name]
      if (want === undefined) continue
      expect(`${name}:${languageStr(parseLanguage(bytes), STR_ID.DAY_1)}`).toBe(`${name}:${want}`)
    }
  })

  it('the seven days and twelve months are distinct and non-empty everywhere', () => {
    for (const [name, bytes] of files) {
      const lang = parseLanguage(bytes)!
      const days = [1, 2, 3, 4, 5, 6, 7].map((i) => lang.strings[STR_ID.DAY_1 - 1 + i]!)
      const months = Array.from({ length: 12 }, (_, i) => lang.strings[STR_ID.MON_1 + i]!)
      expect(`${name}:${new Set(days).size}`).toBe(`${name}:7`)
      expect(`${name}:${new Set(months).size}`).toBe(`${name}:12`)
      for (const s of [...days, ...months]) expect(`${name}:${s.length > 0}`).toBe(`${name}:true`)
    }
  })

  /**
   * These are 1992 binaries and the high bytes are latin-1, not UTF-8. Reading
   * them as UTF-8 would corrupt exactly the characters that make a language
   * anything other than English — and `strings(1)` skips right past them, which
   * is how "März" went missing from the first look at this file.
   */
  it('decodes the high bytes as latin-1, so the accents survive', () => {
    const german = parseLanguage(files.find(([n]) => n === 'deutsch')![1])!
    expect(german.strings[STR_ID.MON_3]).toBe('März')
    expect(german.strings[STR_ID.ABMON_3]).toBe('Mär')
    const swedish = parseLanguage(files.find(([n]) => n === 'svenska')![1])!
    expect(swedish.strings[STR_ID.DAY_2]).toBe('Måndag')
  })

  /**
   * Independent corroboration of the id range, from the other direction:
   * localelib.gen.ts says english stops at FUTURESTR because id 51 is
   * LANG_NAME, which locale.h marks V50. These v38 files were built in 1992 and
   * they stop in exactly the same place.
   */
  it('covers the same ids the AROS-derived english table does, and stops where it stops', () => {
    expect(LANGUAGE_ENTRIES).toBe(MAXSTRMSG - 1)
    for (const [name, bytes] of files) {
      const lang = parseLanguage(bytes)!
      // the last id a v38 library has a word for
      expect(`${name}:${(lang.strings[50] ?? '').length > 0}`).toBe(`${name}:true`)
      expect(`${name}:${lang.strings[51]}`).toBe(`${name}:undefined`)
    }
    // and english, which we have from AROS rather than from a file, agrees
    expect(LANGUAGE_STRINGS[STR_ID.DAY_1]).toBe('Sunday')
  })
})
