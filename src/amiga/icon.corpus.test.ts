/**
 * Every `.info` on this machine, walked.
 *
 * `./icon.test.ts` is a handful of icons built byte by byte, which can only
 * confirm the reading that produced them. This one runs the walk over 4,483
 * real files from six sources and is what actually decides whether the
 * structure is right.
 *
 * It has already earned its place. `do_Type` was being read as a WORD, and
 * the three commonest icons in the corpus came back as 1024, 512 and 768:
 * those are 4, 2 and 3 shifted up a byte, because the field is
 * `UBYTE do_Type; UBYTE do_Pad;` and the pad is uninitialised in real files.
 * 167 of them carry $fe in it. No hand-built fixture would have caught that,
 * because a fixture written from the same misreading agrees with it.
 *
 * Skipped on every machine without the corpus.
 */
import { expect, it } from 'vitest'
import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { readIcon, WB_TYPE } from './icon'
import { describeIf } from '../testing/fixture'

const ROOT = '../amos-files'

/** every `*.info`, which `find` is quicker at than a walk in Node */
function icons(): string[] {
  if (!existsSync(ROOT)) return []
  try {
    // -L, because a corpus reached through a symlink is a normal way to have
    // one and `find` will not descend into an unfollowed link: it treats it
    // as one file and reports nothing
    return execSync(`find -L ${ROOT} -name '*.info'`, { maxBuffer: 1 << 28 })
      .toString()
      .split('\n')
      .filter((f) => f !== '')
  } catch {
    return []
  }
}

const FILES = icons()

describeIf('every .info in the corpus', FILES.length > 0, () => {
  /** read once: 4,483 files is a second, and four tests want the same answers */
  const named: { path: string; bytes: Uint8Array }[] = []
  const bare: { path: string; bytes: Uint8Array }[] = []
  for (const path of FILES) {
    let bytes: Uint8Array
    try {
      bytes = new Uint8Array(readFileSync(path))
    } catch {
      continue
    }
    ;(basename(path) === '.info' ? bare : named).push({ path, bytes })
  }

  it('reads every icon that is not empty and not an AROS one', () => {
    const refused = named.filter((f) => readIcon(f.bytes) === null)
    // Five AROS and MorphOS icons, which are PNG files with the icon data
    // appended and are a different format rather than a broken one, and two
    // files of zero bytes.
    const notEmpty = refused.filter((f) => f.bytes.length > 0)
    expect(notEmpty.every((f) => /aros|morphos/i.test(f.path))).toBe(true)
    expect(named.length - refused.length).toBeGreaterThan(4000)
  })

  it('gives every icon a type in icon.h own range', () => {
    // The `do_Type` byte, and the check that caught it being read as a word:
    // every value has to be one of the eight `WB*` constants, and 1024 is not
    const types = new Set<number>()
    for (const f of named) {
      const icon = readIcon(f.bytes)
      if (icon !== null) types.add(icon.type)
    }
    expect(types.size).toBeGreaterThan(3)
    for (const t of types) expect(WB_TYPE[t], `type ${t}`).toBeDefined()
  })

  it('gives every icon that has an image a plausible one', () => {
    for (const f of named) {
      const icon = readIcon(f.bytes)
      const img = icon?.normal
      if (!img) continue
      // A Workbench icon is small and shallow. The bound is loose on purpose:
      // it is here to catch a walk that has lost its place and is reading a
      // width out of the middle of a string, not to describe good taste.
      expect(img.width, f.path).toBeGreaterThan(0)
      expect(img.width, f.path).toBeLessThanOrEqual(640)
      expect(img.height, f.path).toBeLessThanOrEqual(512)
      expect(img.depth, f.path).toBeGreaterThan(0)
      expect(img.depth, f.path).toBeLessThanOrEqual(8)
      // and the bitplanes are the size the header says they are
      expect(img.data.length, f.path).toBe(((img.width + 15) >> 4) * 2 * img.height * img.depth)
    }
  })

  it('a file called `.info` with no stem is not an icon at all', () => {
    // 406 of them, all starting $f34c, each holding a newline-separated list
    // of the names in the directory it sits in. An index left behind by
    // whatever made these dumps, sharing a name with the icon format and
    // otherwise unrelated to it. Refusing them is the right answer and this
    // records WHY, so the next person to see 400 failures does not go looking
    // for a bug in the walk.
    const odd = bare.filter((f) => f.bytes.length >= 2 && f.bytes[0] === 0xf3 && f.bytes[1] === 0x4c)
    expect(odd.length).toBeGreaterThan(100)
    for (const f of odd) expect(readIcon(f.bytes), f.path).toBeNull()
  })
})
