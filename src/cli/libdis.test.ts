import { describe, expect, it } from 'vitest'
import { loadHunks } from '../amiga/hunk'
import { residents } from './libdis'

const u32 = (n: number): number[] => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]
const u16 = (n: number): number[] => [(n >>> 8) & 0xff, n & 0xff]
const ch = (s: string): number[] => [...s].map((c) => c.charCodeAt(0)).concat(0)

const BASE = 0x0021_0000

/**
 * A minimal AUTOINIT library: a romtag, an init table, and a function table.
 * `relative` builds the $ffff word-displacement form instead of the absolute
 * one, which is the branch a hand-checked binary is least likely to exercise.
 */
function fakeLibrary(entries: number[], relative: boolean, decoy = false): Uint8Array {
  const code: number[] = []
  const at = (): number => BASE + code.length
  // eight bytes of something that is not a romtag, so the scan has to search
  code.push(...u32(0x4e714e71), ...u32(0x4e714e71))
  const romtag = at()
  const nameAt = romtag + 26
  const idAt = nameAt + ch('fake.library').length
  const initAt = idAt + ch('Version 9.9').length
  const tableAt = initAt + 16
  code.push(
    ...u16(0x4afc), // RT_MATCHWORD
    ...u32(romtag), // RT_MATCHTAG, points at itself
    ...u32(0), // RT_ENDSKIP
    0x80, // RT_FLAGS: RTF_AUTOINIT
    7, // RT_VERSION
    9, // RT_TYPE
    (-3 >>> 0) & 0xff, // RT_PRI
    ...u32(nameAt),
    ...u32(idAt),
    ...u32(initAt),
  )
  code.push(...ch('fake.library'), ...ch('Version 9.9'))
  code.push(...u32(0x2a), ...u32(tableAt), ...u32(0), ...u32(0)) // LIB_SIZE, funcTable, dataTable, init
  if (relative) code.push(...u16(0xffff))
  for (const e of entries) code.push(...(relative ? u16(e - tableAt) : u32(e)))
  code.push(...(relative ? u16(0xffff) : u32(0xffffffff)))
  // an ILLEGAL instruction in ordinary code, which is why RT_MATCHTAG exists
  if (decoy) code.push(...u16(0x4afc), ...u32(0xdeadbeef), ...new Array(26).fill(0))
  while (code.length % 4 !== 0) code.push(0)
  return Uint8Array.from([
    ...u32(0x3f3), // HUNK_HEADER
    ...u32(0),
    ...u32(1),
    ...u32(0),
    ...u32(0),
    ...u32(code.length / 4),
    ...u32(0x3e9), // HUNK_CODE
    ...u32(code.length / 4),
    ...code,
    ...u32(0x3f2), // HUNK_END
  ])
}

const read = (bytes: Uint8Array) => {
  const l = loadHunks(bytes)
  return residents({ data: l.image, base: l.base })
}

describe('shared library romtags', () => {
  it('reads the tag and numbers the function table from -6', () => {
    const [r] = read(fakeLibrary([0x210100, 0x210200, 0x210300, 0x210400, 0x210500], false))
    expect(r?.name).toBe('fake.library')
    expect(r?.idString).toBe('Version 9.9')
    expect(r?.version).toBe(7)
    expect(r?.type).toBe(9)
    expect(r?.pri).toBe(-3)
    expect(r?.libSize).toBe(0x2a)
    expect([...r!.vectors]).toEqual([
      [-6, 0x210100],
      [-12, 0x210200],
      [-18, 0x210300],
      [-24, 0x210400],
      // the first vector that belongs to the library rather than to exec
      [-30, 0x210500],
    ])
  })

  it('reads the $ffff word-displacement table the same way', () => {
    const [r] = read(fakeLibrary([0x210100, 0x210200, 0x210300], true))
    expect([...r!.vectors]).toEqual([
      [-6, 0x210100],
      [-12, 0x210200],
      [-18, 0x210300],
    ])
  })

  it('ignores a $4afc that is not followed by its own address', () => {
    expect(read(fakeLibrary([0x210100], false, true))).toHaveLength(1)
  })
})
