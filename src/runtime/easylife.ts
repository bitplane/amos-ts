/**
 * EasyLife — Paul Hickman's "Computer Programmers" extension, at slot 16.
 *
 * The largest third-party extension in the registry after IntuiExtend: 160
 * table entries in the reference build, spread over zones, string searching,
 * bit twiddling, PowerPacker, XPK, pattern matching, Workbench, taglists,
 * structured variables and MUI. Slice 0 (see the manifests) settled the four
 * builds; this file is what implements them.
 *
 * ## Evidence
 *
 * DISASSEMBLY tier, with an unusually good manual beside it.
 * `AMOSPro_EasyLife.Lib` (a 16,436-byte code hunk, 302 routines) plus
 * `Docs/extensions/EasyLife.guide`, `EasyLifeSTRUCT.guide` and
 * `EasyLifeMUI.guide`. Where the two disagree the binary wins, and over the
 * zone block alone they disagree five times — see the notes on `elznsx`,
 * `elzn shift`, `elzb add`, `elmz set` and `elmzney`.
 *
 * ## Four identities, one port
 *
 * `easylife-1.0` renamed nothing in common with the later three (`znsx`
 * became `elznsx`), so it is served through `aliases` rather than by a second
 * implementation. 1.09 and 1.10 differ by one keyword each way. 1.44 dropped
 * everything that needed `easylife.library` or `muimaster.library` and is
 * therefore the subset that stands alone.
 *
 * ## The companion library
 *
 * `$1e8(a5)` is `easylife.library`'s own base, opened by routine 0 (`lea
 * $11a2(pc),a1 / moveq #$1,d0 / jsr -$228(a6)`), and the extension keeps its
 * per-slot data in the library's struct rather than in a block of its own.
 * `El Overlap`'s result rectangle lives there at $a2..$ae, which is why the
 * four `El Lap*` readers are `movea.l $1e8(a5),a0 / move.l $XX(a0),d3` and
 * nothing else. Modelled here as ordinary port state.
 *
 * ## Errors
 *
 * Two tables, and routine 299 ($3aca) is the fork:
 *
 *     tst.l d0 / bmi.b .own / Rjmp L_Error      non-negative: AMOS's number
 *     .own: neg.l d0 / Rbra routine 300         negative: this table, negated
 *
 * Routine 300 is `lea $3aea(pc),a0 / moveq #0,d1 / moveq #$f,d2 / moveq #0,d3
 * / Rjmp L_ErrorExt` over the block below, and its d0 is a ZERO-BASED index
 * into it — pinned by three call sites that name their message: routine 81
 * passes 12 for "No Multi Zones Reserved" (the thirteenth), routine 87 passes
 * 11 for "Multi Zone Not Defined" and routine 83 passes 10 for "Multi Zone
 * Table Full". Routine 3 ($138c) is the shared catch-all, `moveq #$17,d0 /
 * Rjmp L_Error` — AMOS 23. Routine 2 ($1384) is `moveq #$2f,d0`, error 47,
 * and routine 159 ($279c) `moveq #$24,d0`, error 36; those are AMOS's own
 * numbers, so the AMOS-zone block raises nothing from the private table.
 */
import { AmosError, ERR, VI, VS, funcCall, int, str, type Value } from '../interp/values'
import type { Func, Instr } from '../interp/builtins'
import type { Runtime } from './runtime'
import type { Screen } from './screen'
import type { MultiZoneTable, Zone } from './objects'

/**
 * The extension's own error messages, in block order, and the index is
 * literally the d0 routine 300 is handed — zero-based, see `elError`.
 *
 * Four slots are empty, and the block partitions exactly as the guide's
 * sections do: nine PowerPacker, one message bank, three multi-zone, one
 * protection, two diskfont, two standard handles, two pattern.library, two
 * XPK, one unmatched tag, three MUI, then twelve for structured variables.
 * Two of the PowerPacker entries carry the same text, so there are 42 slots
 * and 37 distinct messages.
 */
export const EASYLIFE_ERRORS = [
  'Unable To Open Powerpacker Library V35+',
  "You can't PPLoad an empty file",
  'Illegal powerpacker header',
  "File encrypted - Can't decrunch",
  "File encrypted - Can't decrunch",
  'Out of memory while loading / decrunching file',
  'Error reading file',
  'Unable to open file',
  'Crunched File LONGER than source - Aborted',
  'Not a message bank',
  'Multi Zone Table Full - No space to set new zone',
  'Multi Zone Not Defined',
  'No Multi Zones Reserved',
  'Set Protection bits failed',
  "Can't open diskfont.library",
  'Unable to lock font',
  'No STDOUT file handle exists',
  'No STDIN file handle exists',
  "Can't open pattern.library",
  'No Default Pattern Defined',
  'An Xpk Error Has Occured',
  'Could Not Open XPK Master Library',
  'Unmatched tag',
  'Could Not Open MUI Master Library V8+ (MUI V2.1+)',
  'Illegal MUI Object Address',
  'Missing Elmui Begin Instruction',
  '',
  '',
  '',
  '',
  'Array index value is too high',
  'Array index value is negative',
  'Value assigned is beyond lower limit of ranged integer',
  'Value assigned is beyond upper limit of ranged integer',
  'Value assigned points to wrong type of strucuture/no structure',
  'String assigned is longer than maximum length of this element',
  'Substructure addresses cannot be changed',
  'No structures are allocated',
  'Element/Structure not recognised',
  'Cannot copy between structures of different types',
  'Input string is of wrong length',
  'Input string is of wrong type',
]

export interface EasyLifeState {
  /**
   * `El Overlap`'s result rectangle — $a2/$a6/$aa/$ae of the companion
   * library's struct, in that order sx/sy/ex/ey.
   *
   * NOTE: nothing initialises these. They are fields of an `easylife.library`
   * base the extension merely opened, and the four readers do no
   * has-it-been-computed test at all, so `El Lapsx` before the first `El
   * Overlap` reads whatever the library left there. Zero here.
   */
  lapsx: number
  lapsy: number
  lapex: number
  lapey: number
  /**
   * `Elmzone`'s saved query — $6e/$70/$74/$72/$76 of the same struct, in the
   * order x, y, group filter, scan cursor, last group found.
   *
   * They live in the LIBRARY and not on the screen, which is what lets
   * `Elmzonen` carry on where `Elmzone` left off across anything that does
   * not touch the zone table. The cursor is a record offset on the machine
   * and always a multiple of eight; it is a slot index here.
   */
  mzX: number
  mzY: number
  mzFilter: number
  mzCursor: number
  mzGroup: number
  /**
   * $a0 of the same struct — what a FAILED forward search answers.
   *
   * `Elf Fail Start` (routine 151) writes 0 and `Elf Fail End` (routine 152)
   * writes $ffff, and the five forward searches read it with `tst.w $a0(a1)`
   * on their not-found path: zero means 0, anything else means the string's
   * length plus one. Boot state is `Elf Fail Start`, which is also what the
   * Default hook puts back.
   */
  elfFailEnd: boolean
}

export const newEasyLifeState = (): EasyLifeState => ({
  lapsx: 0,
  lapsy: 0,
  lapex: 0,
  lapey: 0,
  mzX: 0,
  mzY: 0,
  mzFilter: 0,
  mzCursor: 0,
  mzGroup: 0,
  elfFailEnd: false,
})

/** the unsigned view of an AMOS 32-bit integer, which is how routine 153 compares */
const u32 = (n: number): number => n >>> 0

/** `move.w` into a cleared register: the low word, unsigned */
const w = (n: number): number => n & 0xffff
/** `move.w` then `ext.l`: the low word, signed */
const sw = (n: number): number => ((n & 0xffff) << 16) >> 16

/**
 * Routine 300 ($3ada) — raise one of the extension's own messages.
 *
 * `lea $3aea(pc),a0 / moveq #0,d1 / moveq #$f,d2 / moveq #0,d3 / Rjmp
 * L_ErrorExt`, and d0 arrives as a ZERO-BASED index into the block: routine
 * 81 passes 12 for "No Multi Zones Reserved", which is the thirteenth
 * message, routine 87 passes 11 for "Multi Zone Not Defined" and routine 83
 * passes 10 for "Multi Zone Table Full". Routine 299 is the other way in and
 * merely negates, so an AMOS-style code of -12 lands on the same message.
 */
const elError: (n: number) => never = (n) => {
  throw new AmosError(EASYLIFE_ERRORS[n] ?? `EasyLife error ${n}`)
}

/**
 * Routines 4 and 5 ($1394, $13a4) — which screen the zone readers ask.
 *
 * Routine 4 is the one-argument form and takes the CURRENT screen straight
 * out of `$52c(a5)` (T_EcCourant), raising routine 2 (error 47) when there is
 * none rather than going through L_GetEc. Routine 5 is the two-argument form
 * and does `move.l (a3)+,d1 / Rjsr L_GetEc`, so the screen number is checked
 * by AMOS itself.
 */
function elScreen(rt: Runtime, a: Value[], full: number): Screen {
  if (a.length < full) return rt.screen
  const n = int(a[0]!)
  const s = rt.screens.get(n)
  if (!s) throw new AmosError(`screen not opened: ${n}`, 47)
  return s
}

/**
 * Routine 6 ($13b2) — the zone the readers index, shared by all eight forms.
 *
 *     movea.l $d2(a0),a1        EcAZones
 *     moveq   #$0,d2 / move.w $d6(a0),d2    EcNZones
 *     tst.l   d5 / Rbeq routine 3           zone 0 is AMOS 23
 *     cmp.l   d5,d2 / Rbcs routine 3        past the count is AMOS 23
 *     asl.w   #$3,d5 / moveq #$0,d3
 *
 * There is NO null check on EcAZones: a screen with no zones reserved has
 * count 0, so `cmp.l d5,d2` catches every zone number and the table is never
 * reached. `null` here is a reserved-but-unset zone, which reads as four
 * zeroes exactly as the guide says.
 */
function elZone(s: Screen, n: number): Zone | null {
  if (n === 0) funcCall()
  if (u32(n) > s.zones.length) funcCall()
  return s.zones[n - 1] ?? null
}

/**
 * The reader's own two instructions: `move.w -$N(a1,d5.w),d3` into a d3 that
 * routine 6 cleared, so the answer is the stored word ZERO-EXTENDED.
 *
 * NOTE: the guide's C_Elznsx says "These commands return signed integers.
 * (-32768 to 32767)" and it is wrong — nothing sign-extends. Its own
 * C_ElznShift note contradicts it and agrees with the binary: "if you shift a
 * zone with co-ordinates 10,10 to 50,20 by 20 pixels to the left, the new
 * co-ordinates will be 65526,10 to 30,20". 65526, not -10.
 */
const elCoord = (z: Zone | null, k: 'x1' | 'y1' | 'x2' | 'y2'): Value => VI(w(z?.[k] ?? 0))

// ---- character searching ---------------------------------------------------

/**
 * Routine 34 ($153a) — the setup every FORWARD search shares.
 *
 *     movea.l (a3)+,a0 / move.w (a0)+,d1        the string, then its length
 *     move.l d1,d6 / add.l a0,d1                d6 keeps it, d1 becomes the end
 *     movea.l a0,a1 / tst.l d3 / Rbmi routine 3     a negative start is AMOS 23
 *     adda.l d3,a0                              start scanning at index d3
 *     move.l d0,d4 / andi.l #$ffffff00,d4 / Rbne routine 3
 *
 * NOTE: the guide says of the start argument "Any value of P is accepted, but
 * is taken to be unsigned, so negative numbers are treated as very high
 * positive numbers". `tst.l d3 / Rbmi` says otherwise — a negative P is an
 * Illegal Function Call, in both this and the backward setup. What IS accepted
 * is a P past the end, which simply finds nothing.
 *
 * Returns the search window as indices into `s`, or raises.
 */
function fwdStart(start: number, ch: number): number {
  if (start < 0) funcCall()
  if ((ch & ~0xff) !== 0) funcCall()
  return start
}

/** routine 37 ($15ac) — the same for the BACKWARD searches, where P is 1-based */
function backStart(s: string, start: number, ch: number): number {
  if (start < 0) funcCall()
  // `beq.s` on zero and `cmp.l d3,d1 / bcs` on a start past the length both
  // land on `adda.l d1,a0`, the end of the string; otherwise `subq.l #$1,d3`
  if ((ch & ~0xff) !== 0) funcCall()
  return start === 0 || u32(s.length) < u32(start) ? s.length : start - 1
}

/**
 * The not-found answer of the five FORWARD searches — routines 35, 36, 40, 41
 * and 45 all end with the same six instructions:
 *
 *     moveq #$0,d3 / movea.l $1e8(a5),a1
 *     tst.w $a0(a1) / beq.s .out / move.l d6,d3 / addq.l #$1,d3
 *
 * The four BACKWARD ones (routines 38, 39, 42, 43) do not consult it and
 * always answer 0, and neither does `Elf Num`. That asymmetry is the
 * routines' and is kept.
 */
const elfMiss = (rt: Runtime, len: number): number => (rt.easylife.elfFailEnd ? len + 1 : 0)

/** true when `c` is one of the characters of `set` — routines 40-43's inner dbra */
const inSet = (set: string, c: string): boolean => set.includes(c)

// ---- memory and message banks ----------------------------------------------

/** one byte of AMOS's address space, 0 where nothing is mapped */
function peekByte(rt: Runtime, addr: number): number {
  const m = rt.resolveAddr(addr)
  return m ? (m.data[m.off] ?? 0) : 0
}

/**
 * Routine 69 ($1af4): the string's own bytes, nothing before and nothing
 * after. Through `resolveWrite`, not `resolveAddr` — a screen's chunky cache
 * has to be invalidated when its bitplanes are written to, and
 * screen.planar.test.ts is the guard that says so.
 */
function writeBytes(rt: Runtime, addr: number, s: string): void {
  for (let i = 0; i < s.length; i++) {
    const m = rt.resolveWrite(addr + i)
    if (m) m.data[m.off] = s.charCodeAt(i) & 0xff
  }
}

/**
 * Routine 147 ($262c) — locate a message, and the only description of the
 * message-bank format that exists.
 *
 * The bank is identified by its NAME, the eight bytes before the data
 * compared against the inline `"Message "` at $26a2 with two `cmpm.l`; a
 * mismatch is message 9, "Not a message bank". Then, with `base` the data
 * start:
 *
 *     (base)          a longword; `move.l (a0),d7 / subi.l #$10,d7` is
 *                     compared against GROUP*4, so the group table runs out
 *                     at (base)-16
 *     base+8+g*4      the group's entry-table offset, and +$c its end, so a
 *                     group's entries are the gap between consecutive slots
 *     a1 = base + (base)
 *     a1+off+n*6      the entry: a longword offset then a word length
 *                     (`asl.l #$1,d0 / asl.l #$2,d7 / add.l d7,d0` is n*6)
 *     base + (base+4) + that offset      the text
 *
 * Out of range in either direction answers 0 rather than raising, which is
 * what makes `Elmessage Exists` a test rather than a trap.
 *
 * NOTE: no message bank exists anywhere in the archive. They come from "the
 * Message Bank Compiler PratchED extension program", which the guide admits
 * was never released — "For more information, read the message bank compiler
 * documentation. (Which one day, I might even release!)". So this layout is
 * routine 147's alone, and the test that exercises it builds a bank to match,
 * which proves the reader agrees with the reading and nothing more.
 */
function message(rt: Runtime, a: Value[]): { data: Uint8Array; at: number; len: number } | null {
  const n = int(a[0] ?? VI(0))
  const group = int(a[1] ?? VI(0))
  const num = int(a[2] ?? VI(0))
  // `move.l (a3)+,d7 / Rbmi routine 3` twice, on NUMBER then GROUP
  if (num < 0) funcCall()
  if (group < 0) funcCall()
  // L_Bnk_OrAdr: a legal bank number is a bank, anything else an address
  const b = rt.memBanks.get(n)
  const data = b?.data ?? rt.resolveAddr(n)?.data
  const base = b ? 0 : (rt.resolveAddr(n)?.off ?? 0)
  if (!data) throw new AmosError('Bank not reserved', 36)
  if ((b?.name ?? '') !== 'Message ') elError(9)
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const rd = (o: number): number => (o + 4 <= data.length ? v.getUint32(base + o, false) : 0)
  if (u32(rd(0) - 0x10) < u32(group * 4)) return null
  const from = rd(8 + group * 4)
  const span = rd(0xc + group * 4) - from
  const at = num * 6
  if (u32(at) >= u32(span)) return null
  const entry = base + rd(0) + from + at
  const off = v.getUint32(entry, false)
  const len = v.getUint16(entry + 4, false)
  return { data, at: base + rd(4) + off, len }
}

// ---- multi-zones -----------------------------------------------------------

/**
 * Routine 81 ($1c38) — reach the multi-zone table of the current screen.
 *
 *     move.l $52c(a5),d5 / Rbeq routine 2        no screen open is error 47
 *     movea.l d5,a0 / move.l $d2(a0),d5 / beq .no
 *     movea.l d5,a1 / move.w $d6(a0),d7 / asl.l #$3,d7
 *     move.l -$4(a1,d7.w),d5 / cmp.l #$fefd,d5 / bne .no
 *     move.w -$8(a1,d7.w),d6                    n, out of the trailer
 *     ... a2 = a1 + n*8, d5 = n*4
 *  .no: moveq #$c,d0 / Rbra routine 300          "No Multi Zones Reserved"
 *
 * The magic longword in the LAST record is the whole test, which is why
 * anything that reallocates EcAZones takes the multi-zones with it — see
 * Screen.reserveZones.
 */
function multiZones(rt: Runtime): { s: Screen; m: MultiZoneTable } {
  const s = rt.screen
  const m = s.multiZones
  if (!m) elError(12)
  return { s, m }
}

/**
 * Routine 82 ($1c76) — the linear search every multi-zone keyword starts
 * with, from slot `from`.
 *
 *     cmp.l d5,d2 / bcc .none      past n*4 bytes of index and it is done
 *     move.w (a2,d2.w),d4 / cmp.w d0,d4 / bne .next        the GROUP
 *     move.w $2(a2,d2.w),d4 / beq .next                    id 0 = free slot
 *     tst.w d1 / beq .hit          a zero ID argument matches ANY
 *     cmp.w d1,d4 / beq .hit
 *  .none: moveq #$ff,d2           and note that is -1, not $ffff
 */
function findSlot(m: MultiZoneTable, group: number, id: number, from = 0): number {
  for (let i = from; i < m.slots.length; i++) {
    const sl = m.slots[i]!
    if (sl.group !== group) continue
    if (sl.id === 0) continue
    if (id === 0 || sl.id === id) return i
  }
  return -1
}

/**
 * Routine 83 ($1c9e) — take the head off the free list.
 *
 *     move.w -$6(a1,d7.w),d0            the head, in the trailer
 *     cmp.w #$ffff,d0 / beq -> message 10, "Multi Zone Table Full"
 *     move.w (a2,d0.w),d1               the free entry's own link
 *     move.w d1,-$6(a1,d7.w)
 */
function allocSlot(m: MultiZoneTable): number {
  if (m.free < 0) elError(10)
  const i = m.free
  m.free = m.slots[i]!.next
  return i
}

/**
 * Routine 84 ($1cb8) — push a slot back, LIFO.
 *
 *     move.w -$6(a1,d7.w),d1 / move.w d1,(a2,d0)      link to the old head
 *     move.w #$0,$2(a2,d0)                            id 0 marks it free
 *     move.w d0,-$6(a1,d7.w)                          and it becomes the head
 *
 * The RECTANGLE is left alone, so a freed zone's coordinates survive in the
 * screen's zone table — `Elmzonen` steps over it on the id test, not on the
 * geometry, and AMOS's own `Zone()` has no id test to make.
 */
function freeSlot(m: MultiZoneTable, i: number): void {
  const sl = m.slots[i]!
  sl.next = m.free
  sl.id = 0
  m.free = i
}

export function makeEasyLifeFunctions(rt: Runtime): Record<string, Func> {
  const st = (): EasyLifeState => rt.easylife
  const corner =
    (k: 'x1' | 'y1' | 'x2' | 'y2'): Func =>
    (_, a): Value =>
      elCoord(elZone(elScreen(rt, a, 2), int(a[a.length - 1]!)), k)

  return {
    /**
     * =Elznsx(ZONE) / =Elznsx(SCREEN,ZONE) — routines 7 ($13ce) and 8 ($13da).
     * Four words a zone at EcAZones + (n-1)*8, and these read the first of
     * them: `Rbsr routine 4 / move.w -$8(a1,d5.w),d3 / moveq #$0,d2 / rts`.
     *
     * The whole point of the extension's name: `Set Zone` writes the corners
     * and AMOS gives a program no way to read them back.
     */
    elznsx: corner('x1'),
    /** =Elznsy — routines 9 ($13e6) and 10, `-$6(a1,d5.w)` */
    elznsy: corner('y1'),
    /** =Elznex — routines 11 ($13fe) and 12, `-$4(a1,d5.w)` */
    elznex: corner('x2'),
    /** =Elzney — routines 13 ($1416) and 14, `-$2(a1,d5.w)` */
    elzney: corner('y2'),

    /**
     * =El Overlap(x1,y1,x2,y2 To x3,y3,x4,y4) — routine 153 ($26e0).
     *
     * Computes the intersection rectangle into the companion library's
     * struct and answers -1 when it is non-empty. The four corners are
     * stored, not returned, which is what `El Lapsx` and its three siblings
     * are for.
     *
     * Every comparison is UNSIGNED (`bcc`/`bcs` on `cmp.l`), so a negative
     * coordinate is a very large one and the min/max come out the other way
     * round. That is the routine's own arithmetic and it is kept; nothing in
     * the guide says the arguments may be negative.
     *
     * The emptiness test is `lapex >= lapsx` and `lapey >= lapsy`, both
     * inclusive, so two rectangles that share a single edge pixel overlap.
     */
    'el overlap'(_, a): Value {
      const p = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => int(a[i] ?? VI(0)))
      const maxU = (x: number, y: number): number => (u32(x) >= u32(y) ? x : y)
      const minU = (x: number, y: number): number => (u32(x) <= u32(y) ? x : y)
      const s = st()
      s.lapsx = maxU(p[0]!, p[4]!)
      s.lapsy = maxU(p[1]!, p[5]!)
      s.lapex = minU(p[2]!, p[6]!)
      s.lapey = minU(p[3]!, p[7]!)
      return VI(u32(s.lapex) >= u32(s.lapsx) && u32(s.lapey) >= u32(s.lapsy) ? -1 : 0)
    },
    /** =El Lapsx — routine 154 ($2758), `movea.l $1e8(a5),a0 / move.l $a2(a0),d3` */
    'el lapsx': (): Value => VI(st().lapsx),
    /** =El Lapsy — routine 155 ($2764), $a6 */
    'el lapsy': (): Value => VI(st().lapsy),
    /** =El Lapex — routine 156 ($2770), $aa */
    'el lapex': (): Value => VI(st().lapex),
    /** =El Lapey — routine 157 ($277c), $ae */
    'el lapey': (): Value => VI(st().lapey),

    /**
     * =Elmznsx(GROUP,ID) — routines 88-91 ($1d94-$1dbe) over the shared
     * prologue at routine 87 ($1d6c), which pops ID then GROUP, refuses
     * either as zero with AMOS 23, and raises message 11, "Multi Zone Not
     * Defined", when the pair is not in the index.
     *
     * Each reader is `Rbsr routine 87 / move.w $N(a1,d2.w),d3 / ext.l d3`,
     * so unlike the AMOS-zone readers these are SIGNED — the guide says so
     * and here it is right: "The values returned are signed (-32768 to
     * 32767)".
     */
    elmznsx: mzCorner(rt, 'x1'),
    /** =Elmznsy — routine 89 ($1da2), `$2(a1,d2.w)` */
    elmznsy: mzCorner(rt, 'y1'),
    /** =Elmznex — routine 90 ($1db0), `$4(a1,d2.w)` */
    elmznex: mzCorner(rt, 'x2'),
    /**
     * =Elmzney — routine 91 ($1dbe), and the odd one out.
     *
     * DEFECT: its two instructions are in the wrong order.
     *
     *     routine 90:  move.w $4(a1,d2.w),d3 / ext.l d3
     *     routine 91:  ext.l d3 / move.w $6(a1,d2.w),d3
     *
     * so the sign-extension runs on the d3 routine 87 has just cleared and
     * the load lands afterwards, leaving the high word zero. `Elmzney`
     * therefore answers 0..65535 where its three siblings answer -32768..32767
     * — a zone whose y2 is negative reads back as 65536 plus it. The guide's
     * "The values returned are signed" covers all four and is right about
     * three. Reproduced.
     */
    elmzney: (_, a): Value => VI(w(mzZone(rt, a)?.y2 ?? 0)),

    /**
     * =Elmzone(X,Y) / =Elmzone(X,Y,GROUP) — routines 95 ($1e08) and 94.
     *
     * Stores the query in the companion library's struct ($6e/$70/$74),
     * resets the scan cursor at $72 and falls straight into `Elmzonen`. The
     * two-argument form is routine 94, six bytes that push a literal zero for
     * the group and branch in — so "no filter" and "group 0" are the same
     * thing, which is why group 0 cannot be a real group.
     *
     * The coordinates are stored with `move.w`, so they truncate to sixteen
     * bits, and the scan compares them SIGNED.
     */
    elmzone: mzone(rt),

    /**
     * =Elmzonen — routine 96 ($1e28), which is both the keyword and the tail
     * of `Elmzone`.
     *
     * Walks the rectangles from the cursor, taking the FIRST that contains
     * the point, and the four tests are `x1 > x`, `y1 > y`, `x2 < x`, `y2 < y`
     * as signed words — so the far corner is inclusive, unlike `Set Zone`'s.
     * The cursor is advanced past a geometric hit BEFORE the group filter and
     * the id are checked, so a rejected zone is never revisited. Out of
     * zones, it parks the cursor at the end, clears the saved group and
     * answers 0 — which is also what "no more" looks like, exactly as the
     * guide says: "All of these commands return 0 if there is no remaining
     * zone which contains the point specified."
     */
    elmzonen: (): Value => VI(mzNext(rt)),

    /**
     * =Elmzoneg — routine 93 ($1df0), `moveq #$0,d3 / move.w $76(a0),d3`.
     *
     * The group of whatever the last `Elmzone`/`Elmzonen` found, zeroed when
     * the scan came up empty. It does NOT go through routine 81, so it
     * answers even with no multi zones reserved — the only keyword in the
     * block that does not raise.
     */
    elmzoneg: (): Value => VI(w(st().mzGroup)),

    // ---- character searching, routines 18-53 and 144-146 ----
    //
    // "If you want to find the first occurance of a character in a string,
    // you can use the AMOS functinon =instr$, but as this is designed to find
    // substrings, it is in-efficient for single characters." Sixteen entry
    // points over ten workers, and the asc/char pairs differ only in whether
    // the thing being looked for arrives as a code or as a set of characters.

    /**
     * =Elf Asc(S$,A) / =Elf Asc(S$,A,P) — routines 18 and 19 into 35 ($1560).
     *
     *     cmpa.l d1,a0 / bcc .miss / cmp.b (a0)+,d0 / bne .loop
     *     dbra d5,.loop            d5 is the Nth counter, 0 here
     *     move.l a0,d3 / sub.l a1,d3
     *
     * so the answer is 1-based, and the three-argument form "begins searching
     * a position P+1" because routine 34 does `adda.l d3,a0` with P as a plain
     * index — "to find the next occurance, you simply put the position of the
     * last occurance as the P parameter of the next search".
     */
    'elf asc': elfFwd(rt, (s, from, ch) => s.indexOf(String.fromCharCode(ch), from)),
    /**
     * =Elf Char(S$,A$[,P]) — routines 26/27 into 40 ($160a), which walks A$
     * per source character instead of comparing one code.
     *
     * NOTE: the guide's "Illegal Function Call: Either A$ is an empty string,
     * or A is not between 0 and 255" is half right. The empty set is NOT an
     * error here: `move.w (a2),d7` loads 0 and the `dbra d7` falls straight
     * through to the next source character, so the search simply never
     * matches and returns the miss value. Only `Elf Num Char` and `Elpad
     * Char$` actually test the length (`Rbeq routine 3`).
     */
    'elf char': elfFwdSet(rt, (set, c) => inSet(set, c)),
    /** =Elf Not Asc — routines 20/21 into 36 ($1588), `beq` where 35 has `bne` */
    'elf not asc': elfFwd(rt, (s, from, ch) => {
      for (let i = from; i < s.length; i++) if (s.charCodeAt(i) !== ch) return i
      return -1
    }),
    /** =Elf Not Char — routines 28/29 into 41 ($1640) */
    'elf not char': elfFwdSet(rt, (set, c) => !inSet(set, c)),

    /**
     * =Elf Last Asc(S$,A[,P]) — routines 22/23 into 38 ($15da).
     *
     *     cmpa.l a0,a1 / bcc .miss / cmp.b -(a0),d0 / bne .loop
     *     move.l a0,d3 / sub.l a1,d3 / addq.l #$1,d3
     *
     * The predecrement is why "the search begins at position P-1": routine 37
     * puts a0 at index P-1, so the first character examined is P-1 in 1-based
     * terms. P of 0, or past the length, starts at the end. Unlike the forward
     * searches these never consult the fail flag: a miss is always 0.
     */
    'elf last asc': elfBack(rt, (s, from, ch) => {
      for (let i = from - 1; i >= 0; i--) if (s.charCodeAt(i) === ch) return i
      return -1
    }),
    /** =Elf Last Char — routines 30/31 into 42 ($1670) */
    'elf last char': elfBackSet(rt, (set, c) => inSet(set, c)),
    /**
     * =Elf Last Not Asc — routines 24/25 into 39 ($15f2). "very useful for
     * removing the padding from padded strings, or for removing trailing
     * spaces", which is what pairs it with `Elpad Asc$`.
     */
    'elf last not asc': elfBack(rt, (s, from, ch) => {
      for (let i = from - 1; i >= 0; i--) if (s.charCodeAt(i) !== ch) return i
      return -1
    }),
    /** =Elf Last Not Char — routines 32/33 into 43 ($1696) */
    'elf last not char': elfBackSet(rt, (set, c) => !inSet(set, c)),

    /**
     * =Elf Control(S$[,P]) — routines 44 and 45 ($16ba, $16c4).
     *
     * Routine 44 is ten bytes that push a literal zero for P. The test is
     * `cmp.b #$20,d0 / bcc` and UNSIGNED, so only 0..31 count — a byte at 128
     * or above is 'not a control character', which is what makes the guide's
     * use of it work: "This can be used to determine if a string is
     * printable. A string which contains control characters may invoke any of
     * the AMOS text formatting functions ... such as At(X,Y), Pen$(C)".
     */
    'elf control'(_, a): Value {
      const s = str(a[0] ?? VS(''))
      const from = fwdStart(int(a[1] ?? VI(0)), 0)
      for (let i = from; i < s.length; i++) if (s.charCodeAt(i) < 0x20) return VI(i + 1)
      return VI(elfMiss(rt, s.length))
    },

    /**
     * =Elf Nth Asc(S$,A,N) — routine 53 ($1790), which is routine 35 with the
     * Nth counter loaded: `move.l (a3)+,d5 / subq.l #$1,d5 / Rbmi routine 3`.
     */
    'elf nth asc'(_, a): Value {
      const s = str(a[0] ?? VS(''))
      const ch = int(a[1] ?? VI(0))
      const n = int(a[2] ?? VI(0))
      if (n - 1 < 0) funcCall()
      fwdStart(0, ch)
      return VI(nth(s, (c) => c.charCodeAt(0) === ch, n, rt))
    },
    /**
     * =Elf Nth Char(S$,A$,N) — routine 52 ($1782), the same twelve bytes into
     * routine 40 but WITHOUT the sign check: `move.l (a3)+,d5 / movea.l
     * (a3)+,a2 / moveq #$0,d0 / subq.l #$1,d5`.
     *
     * NOTE: so `Elf Nth Asc(s$,a,0)` is AMOS 23 and `Elf Nth Char(s$,a$,0)` is
     * not. N-1 becomes -1, the `dbra d5` after a match decrements the low word
     * to $fffe and branches, and the search needs 65536 matches — which is to
     * say it finds nothing and answers the miss value.
     */
    'elf nth char'(_, a): Value {
      const s = str(a[0] ?? VS(''))
      const set = str(a[1] ?? VS(''))
      const n = int(a[2] ?? VI(0))
      if (n <= 0) return VI(elfMiss(rt, s.length))
      return VI(nth(s, (c) => inSet(set, c), n, rt))
    },

    /**
     * =Elf Num Asc(S$,A) — routine 51 ($175e), a plain count with its own
     * loop rather than a call into the search workers, and no fail flag.
     * `cmp.l #$100,d0 / Rbcc routine 3` is unsigned, so a negative code is a
     * very large one and refused.
     */
    'elf num asc'(_, a): Value {
      const s = str(a[0] ?? VS(''))
      const ch = int(a[1] ?? VI(0))
      if (u32(ch) >= 0x100) funcCall()
      let n = 0
      for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === ch) n++
      return VI(n)
    },
    /**
     * =Elf Num Char(S$,A$) — routine 50 ($174c), and DEVIATION-worthy in the
     * other direction: it does not count a SET at all.
     *
     *     movea.l (a3)+,a0 / move.w (a0)+,d0 / Rbeq routine 3
     *     moveq #$0,d0 / move.b (a0),d0 / move.l d0,-(a3)
     *     Rbra routine 51
     *
     * Eighteen bytes that take the FIRST character of A$, push its code and
     * fall into `Elf Num Asc`. The guide says "occurances of any character
     * from A$ are counted" and adds a note rationalising it — "If the string
     * A$ contains more than one occurance of the same character it is still
     * only counted once" — and neither describes this routine. The empty
     * string IS an error here, which is the one thing the guide gets right
     * about it.
     */
    'elf num char'(_, a): Value {
      const s = str(a[0] ?? VS(''))
      const set = str(a[1] ?? VS(''))
      if (set.length === 0) funcCall()
      const ch = set.charCodeAt(0)
      let n = 0
      for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === ch) n++
      return VI(n)
    },

    // ---- integers as strings, memory, banks and messages ----

    /**
     * =Ellong$(NUM) — routine 46 ($16f4): `moveq #$6,d3 / Rjsr L_Demande /
     * move.w #$4,(a0)+ / move.l (a3)+,(a0)+`. Four raw bytes, most
     * significant first, "so that it may be output to a file compactly with a
     * fixed length" — the pair AMOS lacks.
     */
    'ellong$': (_, a): Value => {
      const n = int(a[0] ?? VI(0)) | 0
      return VS(String.fromCharCode((n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff))
    },
    /** =Ellong(NUM$) — routine 47 ($170c), `cmp.w #$4,d0 / Rbcs routine 3` */
    ellong: (_, a): Value => {
      const s = str(a[0] ?? VS(''))
      if (s.length < 4) funcCall()
      return VI(((s.charCodeAt(0) << 24) | (s.charCodeAt(1) << 16) | (s.charCodeAt(2) << 8) | s.charCodeAt(3)) | 0)
    },
    /**
     * =Elword$(NUM) — routine 48 ($171e), which pops the argument as two
     * words and keeps the LOW one: `move.w (a3)+,d0 / move.w (a3)+,(a0)+`.
     * "ElWord$ does not give error messages if the value is out of range, it
     * simply stores the lower 2 bytes."
     */
    'elword$': (_, a): Value => {
      const n = int(a[0] ?? VI(0))
      return VS(String.fromCharCode((n >>> 8) & 0xff, n & 0xff))
    },
    /** =Elword(NUM$) — routine 49 ($1738), `cmp.w #$2,d0 / Rbcs` then `ext.l` */
    elword: (_, a): Value => {
      const s = str(a[0] ?? VS(''))
      if (s.length < 2) funcCall()
      return VI(sw((s.charCodeAt(0) << 8) | s.charCodeAt(1)))
    },

    /** =Elextb(N) — routine 78 ($1bc4), `ext.w d3 / ext.l d3` from the low BYTE */
    elextb: (_, a): Value => VI(((int(a[0] ?? VI(0)) & 0xff) << 24) >> 24),
    /** =Elextw(N) — routine 79 ($1bce), `ext.l d3` from the low word */
    elextw: (_, a): Value => VI(sw(int(a[0] ?? VI(0)))),

    /**
     * =Elmem$(ADDR,SLENGTH) / =Elmem$(ADDR,SLENGTH,DELIMITER) — routines 67
     * ($1a98) and 68 ($1ad4). "AMOS already has peek,deek & leek - thing of
     * this as 'Seek' (!)"
     *
     * Routine 68 scans up to SLENGTH+1 bytes for DELIMITER, works out how far
     * it got and falls into routine 67 with that as the length, so "if the
     * memory reading is terminated by reading a DELIMETER character, that
     * character is not returned". SLENGTH of 0 is `Rbeq routine 3`.
     *
     * NOTE: the length bound is routine 67's `addq.l #$2,d3 / cmp.l
     * #$10000,d3 / Rbcc routine 3`, so it is the length PLUS TWO that must
     * stay under 65536 and the real maximum is 65533, not the guide's 65535.
     */
    'elmem$': (_, a): Value => {
      const addr = int(a[0] ?? VI(0))
      let len = int(a[1] ?? VI(0))
      if (a.length >= 3) {
        if (len === 0) funcCall()
        const delim = int(a[2] ?? VI(0)) & 0xff
        let k = 0
        while (k <= len && peekByte(rt, addr + k) !== delim) k++
        len = Math.min(k, len)
      }
      if (u32(len + 2) >= 0x10000) funcCall()
      let out = ''
      for (let i = 0; i < len; i++) out += String.fromCharCode(peekByte(rt, addr + i))
      return VS(out)
    },
    /**
     * =Elmem Inc(ADDR,S$) — routine 111 ($20b6), `Rbsr routine 69 / move.l
     * a1,d3`: the write, then the address just past it, "allowing many
     * strings to be copied into consecutive memory addresses easily".
     */
    'elmem inc': (_, a): Value => {
      const addr = int(a[0] ?? VI(0))
      const s = str(a[1] ?? VS(''))
      writeBytes(rt, addr, s)
      return VI(addr + s.length)
    },

    /**
     * =Elbank Name$(BANK) — routine 65 ($1a46). `L_Bnk_GetAdr`, then the
     * eight bytes at `-$8(a2)` and `-$4(a2)` — the name sits immediately
     * before the data. "The string returned is always 8 characters long, and
     * is padded with trailing spaces".
     */
    'elbank name$': (_, a): Value => {
      const b = rt.memBanks.get(int(a[0] ?? VI(0)))
      if (!b) throw new AmosError('Bank not reserved', 36)
      return VS((b.name + '        ').slice(0, 8))
    },
    /**
     * =Elbnk Here(BNKNO) — routine 158 ($2788). "This function will return
     * True (-1) if the specified bank has been reserved for the current
     * program, or False (0) if it has not."
     *
     * DEVIATION: the routine pops the parameter stack TWICE for a keyword
     * whose spec declares one argument —
     *
     *     20 1b   move.l (a3)+,d0        the argument, into d0
     *     76 00   moveq  #$0,d3
     *     74 00   moveq  #$0,d2
     *     20 1b   move.l (a3)+,d0        ...and again, overwriting it
     *     Rjsr    L_Bnk_GetAdr
     *
     * so the number it actually looks up is the long BELOW the argument on
     * AMOS's expression stack, and a3 is left four bytes high afterwards.
     * Every one-argument sibling (`Elextb`, `Elbank Name$`) pops once, so this
     * is not a convention. There is no shared parameter stack here to
     * under-run, so what the routine INTENDED is what runs: the argument is
     * looked up and the answer is -1 or 0.
     */
    'elbnk here': (_, a): Value => VI(rt.memBanks.has(int(a[0] ?? VI(0))) ? -1 : 0),

    /**
     * =Elmessage$(BANK,GROUP,NUMBER) — routine 64 ($1a34), which is routine
     * 147 followed by `tst.l d3 / Rbeq routine 3` and a fall into Elmem$ with
     * the address and length routine 147 left behind.
     */
    'elmessage$': (_, a): Value => {
      const m = message(rt, a)
      if (!m) funcCall()
      let out = ''
      for (let i = 0; i < m.len; i++) out += String.fromCharCode(m.data[m.at + i] ?? 0)
      return VS(out)
    },
    /**
     * =Elmessage Exists(BANK,GROUP,NUMBER) — routine 147 ($262c), and the
     * guide's own argument names for it (NAME, START) do not match its
     * siblings' or the routine's; the spec is three integers and the routine
     * is shared with Elmessage$.
     */
    'elmessage exists': (_, a): Value => VI(message(rt, a) ? -1 : 0),

    /**
     * =Elpad Asc$(S$,A,L) — routines 145 and 146 ($25da, $25f0).
     *
     *     move.w (a2)+,d6 / cmp.l d4,d6 / Rbhi routine 3
     *     ... move.w d4,(a1)+ / sub.l d6,d4
     *     copy d6 bytes, then write d4 copies of d5
     *
     * NOTE: the guide says "If the length of the string S$ is greater than or
     * equal to L, these two functions return S$". Equal does return S$; longer
     * is `Rbhi routine 3`, an Illegal Function Call. Only half the sentence is
     * true, and it is the half a program would rely on that is not.
     */
    'elpad asc$'(_, a): Value {
      const s = str(a[0] ?? VS(''))
      const ch = int(a[1] ?? VI(0))
      if (ch < 0 || u32(ch) >= 0x100) funcCall()
      return VS(pad(s, ch, int(a[2] ?? VI(0))))
    },
    /**
     * =Elpad Char$(S$,A$,L) — routine 144 ($25c6), which takes the first
     * character of A$ and joins routine 146. "If A$ contains more than one
     * character, the second and subsequent characters are ignored. In the
     * future I intend to change this to repeatedly use the whole of A$ to pad
     * S$" — 1.44 still does not.
     */
    'elpad char$'(_, a): Value {
      const s = str(a[0] ?? VS(''))
      const set = str(a[1] ?? VS(''))
      if (set.length === 0) funcCall()
      return VS(pad(s, set.charCodeAt(0), int(a[2] ?? VI(0))))
    },
  }
}

/** routine 146's tail: copy, then pad to `len`, refusing a string already longer */
function pad(s: string, ch: number, len: number): string {
  if (u32(s.length) > u32(len)) funcCall()
  return s + String.fromCharCode(ch).repeat(len - s.length)
}

/** the `dbra d5` in routines 35 and 40: skip N-1 matches, then take the next */
function nth(s: string, hit: (c: string) => boolean, n: number, rt: Runtime): number {
  let left = n
  for (let i = 0; i < s.length; i++) {
    if (hit(s[i]!) && --left === 0) return i + 1
  }
  return elfMiss(rt, s.length)
}

/** the four `asc` forward searches: (S$, A[, P]) */
function elfFwd(rt: Runtime, find: (s: string, from: number, ch: number) => number): Func {
  return (_, a): Value => {
    const s = str(a[0] ?? VS(''))
    const ch = int(a[1] ?? VI(0))
    const from = fwdStart(int(a[2] ?? VI(0)), ch)
    const at = from >= s.length ? -1 : find(s, from, ch)
    return VI(at < 0 ? elfMiss(rt, s.length) : at + 1)
  }
}

/** the four `char` forward searches: (S$, A$[, P]) */
function elfFwdSet(rt: Runtime, hit: (set: string, c: string) => boolean): Func {
  return (_, a): Value => {
    const s = str(a[0] ?? VS(''))
    const set = str(a[1] ?? VS(''))
    const from = fwdStart(int(a[2] ?? VI(0)), 0)
    for (let i = from; i < s.length; i++) if (hit(set, s[i]!)) return VI(i + 1)
    return VI(elfMiss(rt, s.length))
  }
}

/** the two `asc` backward searches: (S$, A[, P]) */
function elfBack(rt: Runtime, find: (s: string, from: number, ch: number) => number): Func {
  void rt
  return (_, a): Value => {
    const s = str(a[0] ?? VS(''))
    const ch = int(a[1] ?? VI(0))
    const at = find(s, backStart(s, int(a[2] ?? VI(0)), ch), ch)
    return VI(at + 1)
  }
}

/** the two `char` backward searches: (S$, A$[, P]) */
function elfBackSet(rt: Runtime, hit: (set: string, c: string) => boolean): Func {
  void rt
  return (_, a): Value => {
    const s = str(a[0] ?? VS(''))
    const set = str(a[1] ?? VS(''))
    for (let i = backStart(s, int(a[2] ?? VI(0)), 0) - 1; i >= 0; i--) {
      if (hit(set, s[i]!)) return VI(i + 1)
    }
    return VI(0)
  }
}

/** the four `Elmzn*` readers, which differ only in the field they load */
function mzCorner(rt: Runtime, k: 'x1' | 'y1' | 'x2' | 'y2'): Func {
  return (_, a): Value => VI(sw(mzZone(rt, a)?.[k] ?? 0))
}

/** routine 87 ($1d6c): (GROUP, ID) to the rectangle, or message 11 */
function mzZone(rt: Runtime, a: Value[]): Zone | null {
  // routine 87 calls routine 81 BEFORE it looks at either argument, so a
  // screen with no multi zones says so even when the pair is (0,0); then
  // `move.l (a3)+,d1 / Rbeq routine 3` pops the LAST argument first, so the
  // id is the one refused before the group is even read
  const { s, m } = multiZones(rt)
  const id = int(a[1] ?? VI(0))
  if (id === 0) funcCall()
  const group = int(a[0] ?? VI(0))
  if (group === 0) funcCall()
  const i = findSlot(m, w(group), w(id))
  if (i < 0) elError(11)
  return s.zones[i] ?? null
}

function mzone(rt: Runtime): Func {
  return (_, a): Value => {
    const st = rt.easylife
    st.mzX = sw(int(a[0] ?? VI(0)))
    st.mzY = sw(int(a[1] ?? VI(0)))
    st.mzFilter = w(int(a[2] ?? VI(0)))
    st.mzCursor = 0
    return VI(mzNext(rt))
  }
}

/** routine 96's scan, shared by `Elmzone` and `Elmzonen` */
function mzNext(rt: Runtime): number {
  const st = rt.easylife
  const { s, m } = multiZones(rt)
  for (let i = st.mzCursor; i < m.slots.length; i++) {
    const z = s.zones[i]
    // an untouched record is eight zero bytes here; on the machine it is
    // whatever AllocMem handed back, but no slot referring to it is in use
    const x1 = sw(z?.x1 ?? 0)
    const y1 = sw(z?.y1 ?? 0)
    const x2 = sw(z?.x2 ?? 0)
    const y2 = sw(z?.y2 ?? 0)
    if (x1 > st.mzX || y1 > st.mzY || x2 < st.mzX || y2 < st.mzY) continue
    st.mzCursor = i + 1
    const sl = m.slots[i]!
    if (st.mzFilter !== 0 && sl.group !== st.mzFilter) continue
    if (sl.id === 0) continue
    st.mzGroup = sl.group
    return sl.id
  }
  st.mzCursor = m.slots.length
  st.mzGroup = 0
  return 0
}

export function makeEasyLifeInstructions(rt: Runtime): Record<string, Instr> {
  return {
    /**
     * Elzn Shift SCREEN,DX,DY [,START To FINISH] — routines 15 ($142e), 16
     * ($1436) and the shared body 17 ($1458).
     *
     * Routine 15 is `moveq #$ff,d4 / moveq #$ff,d5 / Rbra routine 17`: -1 in
     * both is the flag routine 17 tests with `tst.l d4 / bpl`, and the
     * negative arm rewrites the pair as 1..EcNZones. Routine 16 is the range
     * form and checks the two bounds BEFORE handing over — `cmp.l #$10000,d4
     * / Rbcc` and the same for d5, so a bound of 65536 or more is AMOS 23,
     * and `tst.l d4 / Rbeq` makes START zero one too. Then routine 17 adds
     * `cmp.w d4,d5 / Rbcs` (FINISH below START) and `cmp.w d5,d2 / Rbcs`
     * (FINISH past the count).
     *
     * The four adds are `add.w`, so the arithmetic is modulo 65536 and a zone
     * shifted off the left edge comes back as a coordinate near 65535. The
     * guide says so and warns that AMOS's own `=Zone(x,y)` is confused by it
     * while these readers are not.
     *
     * DEVIATION: the all-zones form on a screen with NO zones reserved is a
     * hang on the real machine. Routine 17 takes `d4 = 1, d5 = 0`, shifts
     * both left three to 8 and 0, and then loops `cmp.l d4,d5 / beq` — which
     * can never be equal — writing four words through a null EcAZones and
     * stepping eight bytes at a time forever. The guide documents "Illegal
     * function call ... No zones are reserved on the given screen" for this
     * case and no such check exists; that error is raised here instead, since
     * reproducing an unbounded write over the whole address space is not a
     * behaviour a caller can observe as anything but a crash.
     */
    'elzn shift'(it) {
      const scr = it.evalInt()
      it.expect(',')
      const dx = it.evalInt()
      it.expect(',')
      const dy = it.evalInt()
      let start = -1
      let finish = -1
      if (it.accept(',')) {
        start = it.evalInt()
        it.expect('to')
        finish = it.evalInt()
        // routine 16's three guards, in its order
        if (u32(start) >= 0x10000) funcCall()
        if (start === 0) funcCall()
        if (u32(finish) >= 0x10000) funcCall()
      }
      const s = rt.screens.get(scr)
      if (!s) throw new AmosError(`screen not opened: ${scr}`, 47)
      const count = s.zones.length
      if (start < 0) {
        if (count === 0) funcCall() // DEVIATION: see above
        start = 1
        finish = count
      } else {
        if ((finish & 0xffff) < (start & 0xffff)) funcCall()
        if (count < (finish & 0xffff)) funcCall()
      }
      for (let n = start; n <= finish; n++) {
        const z = s.zones[n - 1]
        if (!z) {
          // the 68k adds into the record whether or not it was ever set, and
          // an all-zero record shifted by (dx,dy) stops being all-zero — so
          // an unset zone BECOMES set, at (dx,dy) to (dx,dy)
          s.zones[n - 1] = { x1: dx & 0xffff, y1: dy & 0xffff, x2: dx & 0xffff, y2: dy & 0xffff }
          continue
        }
        z.x1 = (z.x1 + dx) & 0xffff
        z.y1 = (z.y1 + dy) & 0xffff
        z.x2 = (z.x2 + dx) & 0xffff
        z.y2 = (z.y2 + dy) & 0xffff
      }
    },

    /**
     * Elzb Add SCREEN,BANK,GROUP — routines 100 ($1ea6), 101 ($1ec8) and 104
     * ($1f6a).
     *
     * Installs one group of a zone bank as that screen's AMOS zones. Routine
     * 101 locates the group and routine 104 replaces the table:
     *
     *     d0 = d5<<3 / Rbsr routine 116        AllocMem, or error 24
     *     movea.l $d2(a0),a1 / Rbsr routine 115    free the old table
     *     move.l d7,$d2(a0) / move.w d5,$d6(a0)
     *
     * so `Reserve Zone` is implied and whatever was there is gone, which is
     * the guide's "Any previously reserved zones or multi zones are removed".
     * The copy itself is `asl.l #$2,d5 / move.w (a2)+,(a1)+` — four words a
     * zone, straight out of the bank.
     */
    'elzb add'(it) {
      const scr = it.evalInt()
      it.expect(',')
      const bank = it.evalInt()
      it.expect(',')
      const group = it.evalInt()
      const s = rt.screens.get(scr)
      if (!s) throw new AmosError(`screen not opened: ${scr}`, 47)
      const zones = zoneBankGroup(rt, bank, group)
      s.reserveZones(zones.length)
      for (let i = 0; i < zones.length; i++) s.zones[i] = zones[i]!
    },

    /**
     * ElMz Reserve NUM — routine 80 ($1bd6).
     *
     *     move.l (a3)+,d6 / addq.l #$1,d6 / andi.l #$fffffffe,d6   round UP
     *     move.l d6,d7 / asr.l #$1,d7 / add.l d6,d7 / addq.l #$1,d7
     *     cmp.l #$2000,d5 / Rbcc routine 3        n*3/2+1 must stay under 8192
     *     Rbsr routine 104                        replace EcAZones outright
     *
     * so `NUM` is rounded up to even and the table costs one and a half
     * records a zone plus a trailer, which is where the guide's "A maximum of
     * 5460 multi zones can be defined. (There is a good reason for that
     * number!)" comes from: 5460*3/2+1 = 8191, and 5462 would be 8194.
     *
     * The rest of the routine builds the free list — entry i links to i+1,
     * the last to $ffff, the head is 0 — and writes n, that head and the
     * $0000fefd magic into the trailer record.
     *
     * DEVIATION: `NUM` of zero or less scribbles memory on the machine.
     * `(0+1) & ~1` is 0, so it allocates one record and then runs
     * `moveq #$4,d1 / subq.l #$2,d2 / ... dbra d2` with d2 = -2, and dbra
     * counts the LOW WORD down from $fffe — 65535 iterations writing four
     * bytes each, a quarter of a megabyte past an eight-byte allocation. The
     * guide documents no error for it; AMOS 23 is raised here.
     */
    'elmz reserve'(it) {
      const n = it.evalInt()
      if (n <= 0) funcCall() // DEVIATION: see above
      const count = (n + 1) & ~1
      const total = (count * 3) / 2 + 1
      if (u32(total) >= 0x2000) funcCall()
      const s = rt.screen
      s.reserveZones(0)
      if (total * 8 > rt.fastFree()) throw new AmosError('Out of memory', ERR.OUT_OF_MEMORY)
      s.reserveZones(total)
      s.multiZones = {
        slots: Array.from({ length: count }, (_, i) => ({ group: 0, id: 0, next: i === count - 1 ? -1 : i + 1 })),
        free: 0,
      }
    },

    /**
     * ElMz Set GROUP,ID,X1,Y1 To X2,Y2 — routine 85 ($1ccc); the two-argument
     * `ElMz Set GROUP,ID` ERASES that zone and is routine 86 ($1d46).
     *
     * The handler key carries a DOUBLE SPACE because the table entry does:
     * the raw bytes at $60f are `21 65 6c 6d 7a 20 20 73 65 f4`, `!elmz  se`
     * plus a high-bit `t`, where its neighbours `elmz reserve` and `elmz
     * erase` have one space each and not one of AMOS's own 778 core names has
     * an internal double space. So it is a typo in the author's source — and
     * a harmless one, because the editor's tokeniser throws spaces away
     * before it matches (`TkOtre: cmp.b #" ",d0 / beq TokLoop`, +Edit.s:14414,
     * "Saute les 32"). A table name's spacing is for DISPLAY, and `ElmzSet`,
     * `Elmz Set` and `Elmz  Set` all reach this same token. Dispatch here is
     * by the table's name, so the key has to match it exactly.
     *
     * Both refuse a zero GROUP or ID with AMOS 23 — zero is what marks a slot
     * free, so neither can be a real number, and the guide agrees: "Neither
     * GROUP or ID can be 0". A pair already in the index is overwritten in
     * place; otherwise routine 83 takes a slot off the free list.
     *
     * The corners are sorted rather than refused, which is the opposite of
     * `Set Zone`:
     *
     *     cmp.l d1,d5 / bcc.b .keep / move.w d1,$6(a1,d2.w) / move.w d5,d1
     *
     * NOTE: those compares are `cmp.l` and UNSIGNED, while the stores are
     * `move.w` and the readers sign-extend. So the guide's "X1,Y1 and X2,Y2
     * are automatically sorted so X1 <= X2, and Y1 <= Y2" holds for the
     * 0..32767 half of the range it also promises (-32768 to 32767) and
     * inverts for the other: a negative coordinate is $ffffxxxx, above every
     * positive one, so it sorts to the far corner and `Elmznsx` comes back
     * larger than `Elmznex`.
     */
    'elmz  set'(it) {
      const group = it.evalInt()
      it.expect(',')
      const id = it.evalInt()
      if (it.atStmtEnd()) {
        // routine 86 reaches routine 81 first, then pops the ID and refuses
        // it before the GROUP
        const { m } = multiZones(rt)
        if (id === 0) funcCall()
        if (group === 0) funcCall()
        const i = findSlot(m, w(group), w(id))
        // DEVIATION: routine 86 tests `cmp.l #$ffff,d2` where routines 85, 87
        // and 92 all test `cmp.w`. Routine 82 signals "not found" with
        // `moveq #$ff,d2`, which is -1 and NOT $0000ffff, so the long compare
        // never matches and the routine goes on to free slot -1 — an odd
        // address two bytes before the index. Erasing a zone that is not
        // there is a no-op here, which is plainly what was meant.
        if (i >= 0) freeSlot(m, i)
        return
      }
      it.expect(',')
      const x1 = it.evalInt()
      it.expect(',')
      const y1 = it.evalInt()
      it.expect('to')
      const x2 = it.evalInt()
      it.expect(',')
      const y2 = it.evalInt()
      // routine 85 is the other way round from routine 86: `move.l $40(a3),d0
      // / Rbeq routine 3` reads the GROUP first, and both come after routine 81
      const { s, m } = multiZones(rt)
      if (group === 0) funcCall()
      if (id === 0) funcCall()
      let i = findSlot(m, w(group), w(id))
      if (i < 0) {
        i = allocSlot(m)
        m.slots[i] = { group: w(group), id: w(id), next: 0 }
      }
      const lo = (a: number, b: number): number => (u32(a) <= u32(b) ? a : b)
      const hi = (a: number, b: number): number => (u32(a) <= u32(b) ? b : a)
      s.zones[i] = { x1: w(lo(x1, x2)), y1: w(lo(y1, y2)), x2: w(hi(x1, x2)), y2: w(hi(y1, y2)) }
    },

    /**
     * ElMz Erase GROUP — routine 92 ($1dcc).
     *
     * Calls routine 82 with `moveq #$0,d1`, the wildcard id, and loops:
     * every slot in the group is freed, walking forward from the last hit.
     * "This command does not deallocated any memory" — only the index entries
     * go back on the free list, and the rectangles they pointed at are left
     * in the zone table untouched.
     *
     * There is no check that GROUP is non-zero, and none is needed: routine
     * 82 skips any slot whose id is 0, and every slot in a real group has a
     * real id, so `ElMz Erase 0` matches nothing.
     */
    /**
     * Elf Fail Start / Elf Fail End — routines 151 ($26c8) and 152 ($26d4),
     * twelve bytes each: `movea.l $1e8(a5),a0 / move.w #$0,$a0(a0)` and the
     * same with $ffff.
     *
     * NOTE: these two are the extension's only UNDOCUMENTED keywords. The
     * guide's index lists both and links them to `C_ElfFailStart`, and no such
     * node exists in any of the three guides — a broken link, so what the
     * setting means has to come from the readers. It is the not-found answer
     * of the five forward searches, 0 or the string's length plus one, and
     * `Elf Fail Start` is both the boot state and what the Default hook
     * restores (the guide's CommandEffects node says so).
     */
    'elf fail start': () => {
      rt.easylife.elfFailEnd = false
    },
    'elf fail end': () => {
      rt.easylife.elfFailEnd = true
    },

    /**
     * Elmem ADDR,S$ — routine 69 ($1af4). "Only the actual characters in the
     * string are copied - the length does not preceed it as with AMOS strings
     * within the variable buffer, and it is not automatically null terminated
     * like C strings." An empty string writes nothing (`beq.b` on the length).
     */
    'elmem'(it) {
      const addr = it.evalInt()
      it.expect(',')
      writeBytes(rt, addr, it.evalStr())
    },

    /**
     * Els Bank Name BANK,NAME$ — routine 66 ($1a72), the write side of the
     * core's `Bank Name$`. `move.w (a2)+,d0 / cmp.w #$8,d0 / Rbne routine 3`,
     * so the name must be EXACTLY eight characters — "shorter strings should
     * be padded with spaces E.g. Els Bank Name BANK,ElPad Asc(NAME$,32,8)",
     * which is the guide pointing at the keyword slice 3 added. The string is
     * checked BEFORE the bank is looked up, so a bad length beats a missing
     * bank. "Some AMOS commands / programs use the bank name to detect the
     * bank type, so you should be careful"; EasyLife itself does, for message
     * banks and for the Tags bank.
     */
    'els bank name'(it) {
      const n = it.evalInt()
      it.expect(',')
      const name = it.evalStr()
      if (name.length !== 8) funcCall()
      const b = rt.memBanks.get(n)
      if (!b) throw new AmosError('Bank not reserved', 36)
      b.name = name
    },

    'elmz erase'(it) {
      const group = it.evalInt()
      const { m } = multiZones(rt)
      // freed in ascending slot order, which is the order the 68k finds them
      // — and it decides the free list, so it decides which slot the next
      // `ElMz Set` takes and therefore where `Elmzonen` meets it
      for (let i = 0; i < m.slots.length; i++) {
        const sl = m.slots[i]!
        if (sl.id !== 0 && sl.group === w(group)) freeSlot(m, i)
      }
    },
  }
}

/**
 * Routine 101 ($1ec8) — find a group inside a zone bank.
 *
 *     move.l d7,d4 / Rbeq routine 3            group 0 is AMOS 23
 *     move.l d6,d0 / Rjsr L_Bnk_GetAdr
 *     Rbeq routine 159                         no such bank is error 36
 *     cmp.l (a0),d4 / beq / Rbcc routine 3     group past the count is 23
 *     asl.w #$2,d4 / adda.l (a0,d4.l),a0
 *     move.w (a0)+,d5                          the group's zone count
 *
 * so the bank is a longword group count, a longword offset per group, and at
 * each offset a word count followed by that many eight-byte records.
 *
 * NOTE: the guide documents a "Not a Zone Bank" error — "Zone banks are
 * identified by them having the name 'Zones   '" — and the routine never
 * looks at the name. `L_Bnk_GetAdr` is called with the bank number alone and
 * nothing else is checked, so any bank whose first longword is a plausible
 * group count is accepted. The message is not in the extension's own error
 * table either. Compare routine 203, which DOES check a bank name ("Tags    ")
 * for the taglist keywords, so the omission here is not the author's habit.
 */
function zoneBankGroup(rt: Runtime, bank: number, group: number): Array<Zone | null> {
  if (group === 0) funcCall()
  const b = rt.memBanks.get(bank)
  if (!b) throw new AmosError('Bank not reserved', 36)
  const v = new DataView(b.data.buffer, b.data.byteOffset, b.data.byteLength)
  const groups = v.getUint32(0, false)
  if (u32(group) > groups) funcCall()
  const off = v.getUint32(group * 4, false)
  const count = v.getUint16(off, false)
  const zones: Array<Zone | null> = []
  for (let i = 0; i < count; i++) {
    const at = off + 2 + i * 8
    zones.push({
      x1: v.getUint16(at, false),
      y1: v.getUint16(at + 2, false),
      x2: v.getUint16(at + 4, false),
      y2: v.getUint16(at + 6, false),
    })
  }
  return zones
}
