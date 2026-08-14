/**
 * Locate — and disassemble — the routine behind an Amiga shared library's LVO.
 *
 * `extdis.ts` finds an AMOS extension keyword by routine number, which works
 * because an extension carries a jump table indexed exactly that way. A shared
 * library carries nothing of the sort. `medplayer.library` was read with a
 * throwaway script, and the next one would have been too, so this is that
 * script with the guesswork taken out.
 *
 * ## The path
 *
 * A library is an ordinary hunk binary, so `../amiga/hunk` relocates it and
 * everything is addressable. Somewhere in it is a Resident tag: the word
 * `$4afc` followed by a pointer to itself (`RTC_MATCHWORD` and `RT_MATCHTAG`,
 * `exec/resident.i`, held in the corpus under `AMOSPro Sources/includes/`).
 * That self-pointer is what makes the scan reliable — an `$4afc` in the middle
 * of code is an ILLEGAL instruction and will not be followed by its own
 * address.
 *
 * With `RTF_AUTOINIT` set (bit 7 of `RT_FLAGS`), `RT_INIT` points at four
 * longs rather than at code, and the second is the function table. That table
 * is either absolute pointers terminated by `-1`, or, when it opens with
 * `$ffff`, 16-bit displacements from the table's own address. The nth entry is
 * LVO `-6 * (n + 1)`, so `-6` is Open, `-12` Close, `-18` Expunge, `-24` the
 * reserved slot, and everything from `-30` belongs to the library.
 *
 * Nothing here needs an `.fd` file, which matters: the corpus holds 54 of them
 * and not one is for a music player. The names come from whoever calls the
 * library. AMOS declares medplayer's whole table itself, in `+Music.s:2281-2293`.
 *
 * Run: npm run cli -- src/cli/libdis.ts <library> [--lvo -66] [--to $addr] [--names +Music.s]
 */
import { readFileSync } from 'node:fs'
import { loadHunks } from '../amiga/hunk'
import { disasm } from './m68k'

/** RT_MATCHWORD, an ILLEGAL instruction (exec/resident.i). */
const RTC_MATCHWORD = 0x4afc
/** RT_FLAGS bit 7: RT_INIT points at data, not code. */
const RTF_AUTOINIT = 0x80

export interface Resident {
  at: number
  version: number
  type: number
  pri: number
  name: string
  idString: string
  /** LVO (negative, a multiple of 6) -> address, empty when not RTF_AUTOINIT */
  vectors: Map<number, number>
  libSize: number
}

interface Image {
  data: Uint8Array
  base: number
}

const rd16 = (m: Image, a: number): number => (m.data[a - m.base]! << 8) | m.data[a - m.base + 1]!
const rd32 = (m: Image, a: number): number =>
  (((m.data[a - m.base]! << 24) | (m.data[a - m.base + 1]! << 16) | (m.data[a - m.base + 2]! << 8) | m.data[a - m.base + 3]!) >>>
    0) >>>
  0

function cstring(m: Image, a: number): string {
  let s = ''
  for (let i = a - m.base; i < m.data.length && m.data[i]; i++) s += String.fromCharCode(m.data[i]!)
  return s
}

/** Every Resident tag in a loaded image, with its function table resolved. */
export function residents(m: Image): Resident[] {
  const out: Resident[] = []
  for (let a = m.base; a + 26 <= m.base + m.data.length; a += 2) {
    if (rd16(m, a) !== RTC_MATCHWORD || rd32(m, a + 2) !== a) continue
    const flags = m.data[a - m.base + 10]!
    const init = rd32(m, a + 22)
    const vectors = new Map<number, number>()
    let libSize = 0
    if ((flags & RTF_AUTOINIT) !== 0 && init >= m.base && init + 16 <= m.base + m.data.length) {
      libSize = rd32(m, init)
      const table = rd32(m, init + 4)
      // $ffff opens a table of word displacements from the table itself;
      // otherwise the entries are absolute and -1 ends them
      const relative = rd16(m, table) === 0xffff
      let p = table + (relative ? 2 : 0)
      for (let n = 0; n < 1024; n++) {
        if (relative) {
          const w = rd16(m, p)
          if (w === 0xffff) break
          vectors.set(-6 * (n + 1), (table + ((w << 16) >> 16)) >>> 0)
          p += 2
        } else {
          const v = rd32(m, p)
          if (v === 0xffffffff) break
          vectors.set(-6 * (n + 1), v)
          p += 4
        }
      }
    }
    out.push({
      at: a,
      version: m.data[a - m.base + 11]!,
      type: m.data[a - m.base + 12]!,
      pri: (m.data[a - m.base + 13]! << 24) >> 24,
      name: cstring(m, rd32(m, a + 14)),
      idString: cstring(m, rd32(m, a + 18)),
      vectors,
      libSize,
    })
  }
  return out
}

if (process.argv[1]?.endsWith('libdis.ts')) {
  const args = process.argv.slice(2)
  const opt = (name: string): string | undefined => {
    const i = args.indexOf(name)
    return i >= 0 ? args[i + 1] : undefined
  }
  const file = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'))
  if (file === undefined) {
    console.error('usage: libdis <library> [--lvo -66] [--to $addr]')
    process.exit(1)
  }
  const num = (s: string): number => (s.startsWith('$') ? parseInt(s.slice(1), 16) : parseInt(s, 10))
  const loaded = loadHunks(readFileSync(file))
  const m: Image = { data: loaded.image, base: loaded.base }
  console.log(
    `${file}: ${loaded.image.length} bytes at $${loaded.base.toString(16)}, ` +
      loaded.hunks.map((h) => `${h.index}:${h.kind}@$${h.base.toString(16)}+${h.length}`).join(' '),
  )
  const lvo = opt('--lvo')
  for (const r of residents(m)) {
    console.log(
      `\nromtag $${r.at.toString(16)}  "${r.name}"  ${r.idString}  ` +
        `version ${r.version} type ${r.type} pri ${r.pri}  LIB_SIZE ${r.libSize}`,
    )
    if (lvo === undefined) {
      for (const [v, addr] of r.vectors) console.log(`  ${String(v).padStart(5)}  $${addr.toString(16)}`)
      continue
    }
    const addr = r.vectors.get(num(lvo))
    if (addr === undefined) {
      console.error(`  no vector ${lvo}`)
      continue
    }
    const to = opt('--to')
    const end = to === undefined ? addr + 0x100 : num(to)
    console.log(`  ${lvo} = $${addr.toString(16)}`)
    console.log((disasm(m.data, m.base, addr, end) ?? ['  (capstone unavailable)']).join('\n'))
  }
}
