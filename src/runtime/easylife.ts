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
 * `EasyLifeMUI.guide`. Where the two disagree the binary wins, and on zones
 * they disagree three times — see the notes on `elznsx`, `elzn shift` and
 * `elzb add`.
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
 * / Rjmp L_ErrorExt` over the block below. Routine 3 ($138c) is the shared
 * catch-all, `moveq #$17,d0 / Rjmp L_Error` — AMOS 23. Routine 2 ($1384) is
 * `moveq #$2f,d0`, error 47, and routine 159 ($279c) `moveq #$24,d0`, error
 * 36; both are AMOS's own numbers, so the zone block below raises nothing
 * from the private table at all.
 */
import { AmosError, VI, funcCall, int, type Value } from '../interp/values'
import type { Func, Instr } from '../interp/builtins'
import type { Runtime } from './runtime'
import type { Screen } from './screen'
import type { Zone } from './objects'

/**
 * The extension's own error messages, in block order — the index is the
 * NEGATED code routine 299 was handed, so -1 is the first.
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
}

export const newEasyLifeState = (): EasyLifeState => ({ lapsx: 0, lapsy: 0, lapex: 0, lapey: 0 })

/** the unsigned view of an AMOS 32-bit integer, which is how routine 153 compares */
const u32 = (n: number): number => n >>> 0

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
const elCoord = (z: Zone | null, k: 'x1' | 'y1' | 'x2' | 'y2'): Value => VI((z?.[k] ?? 0) & 0xffff)

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
  }
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
      s.zones = zoneBankGroup(rt, bank, group)
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
