/**
 * Generate src/amiga/decrunchlib.gen.ts from `decrunch.library` itself.
 *
 * ## Why a generator
 *
 * Explode's `Dpk Name$` answers WHICH cruncher packed a bank, and the answer
 * is a string chosen by hand in 1992 — "StoneCracker 2.99d", "PP 4.0
 * Overlay/Lib", "CrunchMania D/H/S". None of that is derivable. A
 * reimplementation either has the identification tables or it invents
 * answers, and inventing an answer to "what packed this" is worse than
 * refusing to answer.
 *
 * So the tables are extracted here rather than retyped: 16 data magics, 76
 * executable signatures, and the one format found by scanning instead of by
 * signature. Retyping 228 offset/value pairs by hand would put a typo
 * somewhere in the middle where nothing would ever notice it.
 *
 * ## Where the tables are
 *
 * Both are reached from `dlInitItem` (LVO -42, body at $182), which is a
 * three-stage identification and worth stating in order because the ORDER is
 * part of the answer — every stage stops at its first match:
 *
 *   1. `bsr.w $274` compares the source's first longword against a chain of
 *      sixteen magics. These are the DATA crunchers, and they are the ones
 *      that matter for an AMOS bank: subid 2 throughout, which is the value
 *      `dlDecrunch` tests at $1066 to take the data path instead of the
 *      executable one.
 *   2. `bsr.w $240` skips an AmigaDOS hunk header if there is one, then walks
 *      the signature table at $4b2 — 76 records, each three (offset, longword)
 *      probes that must ALL match. These are executable crunchers.
 *   3. If the table runs out (`bmi` on the terminating $ffff), $202 scans the
 *      code for `lea d16(pc),a2` / `move.l (a2)+,d1` / `move.l (a2)+,d2` and
 *      calls that CrunchMania A.
 *
 * ## Licensing
 *
 * DecrunchLib 35.237 is LICENCEWARE, © 1992,1993 Georg Hörmann. The library
 * is NOT redistributed — fixtures/ is gitignored and this generator needs a
 * copy the user already has. What is extracted is DATA: the byte patterns a
 * file format is recognised by, and the name the library prints for it. No
 * decompression code is copied; ../amiga/decrunchlib.ts implements only
 * identification, and hands the one format both this port and the library
 * know (PowerPacker data) to ../amiga/powerpacker.ts, which was written
 * against PowerPacker's own published format.
 *
 * Run: npm run cli -- src/cli/gendecrunch.ts
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const libPath = join(root, 'fixtures', 'libs', 'decrunch.library')
if (!existsSync(libPath)) {
  console.error('fixtures/libs/decrunch.library is not present (fixtures/ is gitignored)')
  process.exit(1)
}

/**
 * One code hunk, at file offset 32.
 *
 * Read from the header rather than assumed: HUNK_HEADER, an empty resident
 * list, one hunk, first = last = 0, then the size long. 0x1a2f longwords.
 */
const raw = new Uint8Array(readFileSync(libPath))
const hdr = new DataView(raw.buffer, raw.byteOffset, raw.byteLength)
if (hdr.getUint32(0) !== 0x3f3) throw new Error('not a hunk file')
const code = raw.subarray(32, 32 + hdr.getUint32(20) * 4)
const dv = new DataView(code.buffer, code.byteOffset, code.byteLength)

const u8 = (o: number): number => code[o] ?? 0
const u16 = (o: number): number => dv.getUint16(o)
const i16 = (o: number): number => dv.getInt16(o)
const u32 = (o: number): number => dv.getUint32(o)

/** a NUL-terminated latin-1 string, which is how every name is stored */
function cstr(at: number): string {
  let s = ''
  for (let o = at; u8(o) !== 0; o++) s += String.fromCharCode(u8(o))
  return s
}

/** assert the bytes at `at` are what the reading says, so a wrong copy fails loudly */
function expect(at: number, bytes: number[], what: string): void {
  for (let i = 0; i < bytes.length; i++) {
    if (u8(at + i) !== bytes[i]) throw new Error(`${what}: $${(at + i).toString(16)} is not the expected byte`)
  }
}

const idString = cstr(u32(22))
if (!idString.startsWith('DecrunchLib 35.237')) throw new Error(`unexpected library: ${idString}`)

// ---- stage 1: the data magics, $274 -------------------------------------

interface DataMagic {
  magic: number
  width: 2 | 4
  also?: { at: number; value: number }
  id: number
  subId: number
  name: string
}

/**
 * The record a `beq` lands on: `lea <record>(pc),a1`, then the shared tail at
 * $360 reads an id byte, a subid byte and a NUL-terminated name. No length
 * byte here — that belongs to the OTHER table, and the two layouts differing
 * is the kind of thing a hand transcription gets wrong once.
 */
function magicRecord(leaAt: number): { id: number; subId: number; name: string } {
  expect(leaAt, [0x43, 0xfa], 'magic record is not lea d16(pc),a1')
  const rec = leaAt + 2 + i16(leaAt + 2)
  return { id: u8(rec), subId: u8(rec + 1), name: cstr(rec + 2) }
}

const magics: DataMagic[] = []

// TurtleSmasher is the one two-longword test, and it is first
expect(0x274, [0x20, 0x10], '$274 is not move.l (a0),d0')
expect(0x276, [0xb0, 0xbc], '$276 is not cmp.l #imm,d0')
expect(0x27e, [0x0c, 0xa8], '$27e is not cmpi.l #imm,d16(a0)')
expect(0x286, [0x67], '$286 is not beq.b')
magics.push({
  magic: u32(0x278),
  width: 4,
  also: { at: i16(0x284), value: u32(0x280) },
  ...magicRecord(0x288 + ((u8(0x287) << 24) >> 24)),
})

// then a plain chain of `cmpi.l #imm,d0 / beq.b` until the word test
let at = 0x288
while (u8(at) === 0xb0 && u8(at + 1) === 0xbc) {
  const magic = u32(at + 2)
  if (u8(at + 6) !== 0x67) throw new Error(`$${(at + 6).toString(16)} is not beq.b`)
  const target = at + 8 + ((u8(at + 7) << 24) >> 24)
  magics.push({ magic, width: 4, ...magicRecord(target) })
  at += 8
}

// and the tail is a WORD compare against memory, not a longword against d0
expect(at, [0x0c, 0x50], 'the chain does not end in cmpi.w #imm,(a0)')
{
  const magic = u16(at + 2)
  if (u8(at + 4) !== 0x67) throw new Error('the word test is not followed by beq.b')
  const target = at + 6 + ((u8(at + 5) << 24) >> 24)
  magics.push({ magic, width: 2, ...magicRecord(target) })
  at += 6
}
expect(at, [0x70, 0x00, 0x4e, 0x75], 'the chain does not end in moveq #0,d0 / rts')

// ---- stage 2: the executable signature table, $4b2 ----------------------

interface Signature {
  probes: Array<[number, number]>
  id: number
  subId: number
  name: string
}

expect(0x1ac, [0x43, 0xfa], '$1ac is not lea d16(pc),a1')
const tableAt = 0x1ae + i16(0x1ae)

const signatures: Signature[] = []
for (let rec = tableAt; ; ) {
  if (i16(rec) < 0) {
    // `bmi` on the first offset is what ends the table
    if (u16(rec) !== 0xffff) throw new Error(`table terminator at $${rec.toString(16)} is not $ffff`)
    break
  }
  const probes: Array<[number, number]> = [
    [i16(rec), u32(rec + 2)],
    [i16(rec + 6), u32(rec + 8)],
    [i16(rec + 12), u32(rec + 14)],
  ]
  const nameLen = u8(rec + 20)
  const name = cstr(rec + 21)
  if (name.length !== nameLen) throw new Error(`$${rec.toString(16)}: length byte ${nameLen} but name is ${name.length}`)
  signatures.push({ probes, id: u8(rec + 18), subId: u8(rec + 19), name })
  // `move.b (a1),d0 / addq.w #3,d0 / bclr #0,d0` from the length byte
  rec += 20 + ((nameLen + 3) & ~1)
}

// ---- stage 3: the scan, $202 --------------------------------------------

expect(0x228, [0x15, 0x7c], '$228 is not move.b #imm,$14(a2)')
expect(0x22e, [0x15, 0x7c], '$22e is not move.b #imm,$15(a2)')
expect(0x234, [0x41, 0xfa], '$234 is not lea d16(pc),a0')
const scan = {
  lead: u16(0x20a), // the opcode scanned for
  leadTries: u8(0x207) + 1, // `moveq #$64,d0` then dbra
  then: u16(0x218),
  thenTries: u8(0x215) + 1,
  third: u16(0x224),
  id: u8(0x22b),
  subId: u8(0x231),
  name: cstr(0x236 + i16(0x236)),
}

// ---- emit ---------------------------------------------------------------

const hex = (n: number, w: number): string => `0x${n.toString(16).padStart(w, '0')}`
/** single-quoted, because this repo is not prettier-formatted and does not use double quotes */
const str = (s: string): string => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r/g, '\\r').replace(/\n/g, '\\n')}'`

const out: string[] = []
out.push(`/**
 * GENERATED by src/cli/gendecrunch.ts — do not edit.
 *
 * ${idString.replace(/[\r\n]+$/, '')}
 *
 * The identification tables behind Explode's \`Dpk Name$\` and \`Dpk Unpack\`,
 * extracted from the library's own code hunk. ${magics.length} data magics, ${signatures.length} executable
 * signatures, and one format found by scanning. See the generator for what
 * each stage is and why the order matters, and ./decrunchlib.ts for the walk.
 *
 * LICENCEWARE. The library is not redistributed; this is the DATA a format is
 * recognised by, and the name the library gives it.
 */
`)

out.push(`/** the library's own version string, checked by ./decrunchlib.corpus.test.ts */
export const DL_ID_STRING = ${str(idString)}
`)

out.push(`/**
 * Stage one: the first longword of a DATA file, tested in this order.
 *
 * Every one of these carries subid 2, which is what \`dlDecrunch\` tests at
 * $1066 to take the data path. \`width: 2\` is the one WORD test, and \`also\`
 * the one entry that needs a second longword to match.
 */
export interface DlDataMagic {
  /** the value compared — a longword unless \`width\` says otherwise */
  readonly magic: number
  readonly width: 2 | 4
  /** a second longword that must also match, at this offset */
  readonly also?: { readonly at: number; readonly value: number }
  readonly id: number
  readonly subId: number
  readonly name: string
}

export const DL_DATA_MAGICS: readonly DlDataMagic[] = [`)
for (const m of magics) {
  const also = m.also ? ` also: { at: ${m.also.at}, value: ${hex(m.also.value, 8)} },` : ''
  out.push(
    `  { magic: ${hex(m.magic, m.width * 2)}, width: ${m.width},${also} id: ${hex(m.id, 2)}, subId: ${m.subId}, name: ${str(m.name)} },`,
  )
}
out.push(']\n')

out.push(`/**
 * Stage two: three (offset, longword) probes that must ALL match, applied
 * after any hunk header has been stepped over. Tried in table order.
 */
export interface DlSignature {
  readonly probes: readonly (readonly [number, number])[]
  readonly id: number
  readonly subId: number
  readonly name: string
}

export const DL_SIGNATURES: readonly DlSignature[] = [`)
for (const s of signatures) {
  const p = s.probes.map(([o, v]) => `[${o}, ${hex(v, 8)}]`).join(', ')
  out.push(`  { probes: [${p}], id: ${hex(s.id, 2)}, subId: ${s.subId}, name: ${str(s.name)} },`)
}
out.push(']\n')

out.push(`/**
 * Stage three: the format with no signature, found by looking for three
 * instructions in sequence — \`lead\` within the first \`leadTries\` words of the
 * code, then \`then\` within the next \`thenTries\`, then \`third\` immediately.
 */
export const DL_SCAN = {
  lead: ${hex(scan.lead, 4)},
  leadTries: ${scan.leadTries},
  then: ${hex(scan.then, 4)},
  thenTries: ${scan.thenTries},
  third: ${hex(scan.third, 4)},
  id: ${hex(scan.id, 2)},
  subId: ${scan.subId},
  name: ${str(scan.name)},
} as const
`)

const target = join(root, 'src', 'amiga', 'decrunchlib.gen.ts')
writeFileSync(target, out.join('\n'))
console.log(`${target}: ${magics.length} data magics, ${signatures.length} signatures, scan ${str(scan.name)}`)
