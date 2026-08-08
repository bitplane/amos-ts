/**
 * GameSupport 1.2 — Alastair M. Robinson's game-writer's toolkit, at slot 23.
 *
 * Thirty-seven keywords in five unrelated groups: controller and mouse input,
 * a ProTracker replayer with loop and gosub control, level-code encryption, a
 * chunky-to-planar converter, and a loader for the author's own "code module"
 * format. The name is a description, not a product line — it is the handful of
 * routines one game (his Wolfenstein clone, AMRWolf) needed.
 *
 * ## Evidence
 *
 * DISASSEMBLY tier, plus two things most extensions do not have.
 *
 * `AMOSPro_GameSupport.Lib`, an 11,708-byte code hunk, read with
 * `extdis gamesupport-1.2`. Beside it in the archive sit `GameSupport.guide`,
 * an AmigaGuide manual covering sixteen of the thirty-seven, and
 * `GameSupport.s` — the author's own assembler source.
 *
 * **The source is PARTIAL and the manifest used to claim otherwise.**
 * `GameSupport.s` is the extension shell: the token table, the cold start, the
 * C2P wrappers and the error-message table. It `include`s six files the
 * archive does not carry — `Labels1-9.s` (every controller and mouse routine),
 * `MusicRoutines.s`, `SubRoutines/PlayRoutine.s`, `SubRoutines/Encode.s`,
 * `SubRoutines/Decode.s` and `subroutines/codemods.s` — and those hold the
 * bodies of most of the keywords. So the shell is read as source and the
 * keywords are read off the binary, and this file says which is which.
 *
 * What the shell settles outright: `ExtNb equ 23-1`, which is the slot; the
 * nine error messages, quoted verbatim in `GAMESUPPORT_ERRORS` below; and
 * which libraries the cold start opens.
 *
 * The binary agrees on the slot from the other direction. Routine 0 stores its
 * data-block pointer with `move.l a3, $258(a5)`, and `ExtAdr` is $f8 with
 * sixteen bytes a slot (+Equ.s:1176-1183), so ($258 - $f8) / 16 + 1 = 23. It
 * then returns `moveq #$16, d0`, the slot less one.
 *
 * ## The four libraries the cold start opens
 *
 *     lea $fa(a3), a1  / OpenLibrary -> $52(a3)    "lowlevel.library"
 *     lea $10b(a3), a1 / OpenLibrary -> $56(a3)    "workbench.library"
 *     lea $11d(a3), a1 / OpenLibrary -> $5a(a3)    "icon.library"
 *     lea $12a(a3), a1 / OpenLibrary -> $66(a3)    "GSDrivers/gsjoystick.library"
 *
 * all with `moveq #$0, d0` — any version will do. NOTE that the cold start
 * does NOT fail when one is missing; it stores zero and every keyword that
 * needs that library checks for itself. The guide's *"the lowlevel.library is
 * currently required for this function's operation"* is per-function, and the
 * extension's own BugsFixed node confirms it was once wrong about this:
 * *"Extension used to crash when used on Kickstart 1.3. This was due to faulty
 * library handling code trying to close lowlevel.library even if it wasn't
 * open!"*
 *
 * Two of those four have a settled answer here:
 *
 *  - **lowlevel.library is present**, because `../amiga/lowlevel.ts` models it.
 *    `GameSupportState.lowlevel` is the base pointer as a flag, so the
 *    not-available arm is still real code with a test behind it — that arm is
 *    what a 1.3 machine gets, and 1.3 machines ran AMOS.
 *  - **gsjoystick.library is absent**, and that is not a gap. It is one of the
 *    author's own `GSDrivers/` modules, described in the guide's Modules node
 *    as a plan rather than a product ("read: will be!"), and it does not ship
 *    in the archive. `Gscontrollertype` and `Gsreadsega` answer 0 without
 *    raising when it is missing, which is exactly what a machine without the
 *    driver installed answers.
 *
 * ## The VBL hook
 *
 * Routine 0 puts $1b8c into `$0(a5)` — `VblRout[0]`, the first of AMOS's eight
 * per-frame slots (+Equ.s:1177). It is installed at cold start and never
 * removed, so it runs for the whole session. Three things, in order:
 *
 *     lea $1c16(pc), a0 / move.l $dff004.l, (a0)   VPOSR:VHPOSR, snapshotted
 *     move.l $1c90(pc), d0 / beq / jsr (a0)        the module player, if any
 *     ...                                          port 0's mouse counters
 *
 * `gamesupportVbl` below is the third of those. The other two arrive with
 * their own batches.
 *
 * ## The data block, at $1c1a
 *
 * Static, inside the code hunk, so it starts as the file's bytes — zeros for
 * everything the cold start does not write. Offsets used below:
 *
 *     $2e   mouse speed factor, (speed + 7); cold start writes 8
 *     $32   port 0's accumulated dx        $36   its dy
 *     $3a   port 0's previous X counter    $3e   its previous Y
 *     $42   port 1's previous X counter    $46   its previous Y
 *     $4a   the EClockVal Gstimer measures from — NOT initialised
 *     $52   lowlevel.library     $56 workbench.library    $5a icon.library
 *     $66   gsjoystick.library
 *     $7a   sixteen code-module slots, eight bytes each
 */
import type { Runtime } from './runtime'
import type { Func, Instr } from '../interp/builtins'
import { AmosError, VI, VS, int, str, type Value } from '../interp/values'
import { sw16 } from './word'
import { counterDelta, joyDatOf, joyDatX, joyDatY, mouseDat } from '../amiga/gameport'
import { elapsedTime, readJoyPort } from '../amiga/lowlevel'

/**
 * The nine messages, verbatim from `GameSupport.s`'s `ErrMess` table.
 *
 * All trappable: routine 100 sets `moveq #0, d1` before `L_ErrorExt`, and the
 * source's own comment on that line is `* Can be trapped`.
 */
export const GAMESUPPORT_ERRORS = [
  'lowlevel.library not available',
  'mouse speed must be between 0 and 32761',
  'unknown GamePort (must be 0 or 1)',
  'workbench libraries not available',
  "can't iconify",
  'not a tracker bank',
  'too many code modules',
  'attribute not found',
  'function not found',
]

const gsError = (n: number): never => {
  throw new AmosError(GAMESUPPORT_ERRORS[n] ?? `GameSupport error ${n}`)
}

/** the two ports GameSupport reads, which are the two the hardware has */
const MAX_GAMEPORT = 1

export interface GameSupportState {
  /**
   * $2e — the factor `Gsmousedx`/`Gsmousedy` scale by, which is `speed + 7`.
   * The cold start writes 8, so the default is speed 1 and `dx*8/8` = dx.
   */
  speed: number
  /** $32 and $36 — port 0's deltas, accumulated at the VBL and read to zero */
  accumX: number
  accumY: number
  /** $3a/$3e and $42/$46 — the previous counter byte per port per axis */
  prev: [{ x: number; y: number }, { x: number; y: number }]
  /** $4a — Gstimer's context. Zero, because the cold start never writes it. */
  clock: { last: number }
  /** $52 — non-zero when lowlevel.library opened, which here it does */
  lowlevel: boolean
}

/**
 * Routine 0's initialisation, in the order it writes it.
 *
 * The counter seeds matter: the cold start reads all four halves of both
 * registers so the first `Gsmousedx` measures from installation rather than
 * from zero. Reproduced with the same registers, which for port 0 is the
 * pointer and for port 1 is whatever digital device is in the port.
 */
export function newGameSupportState(rt?: Runtime): GameSupportState {
  const st: GameSupportState = {
    speed: 8,
    accumX: 0,
    accumY: 0,
    prev: [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ],
    clock: { last: 0 },
    lowlevel: true,
  }
  if (rt) seedCounters(rt, st)
  return st
}

/**
 * JOY0DAT and JOY1DAT, as this port can supply them.
 *
 * Port 0 carries the host's mouse, because that is where AMOS's pointer comes
 * from, so its counters are the pointer position through 8 bits. Port 1
 * carries the host's controller, so its register is the quadrature encoding a
 * digital stick puts on those lines. Both are in `../amiga/gameport.ts`.
 *
 * DEVIATION: on the machine one connector carries one device, and a program
 * could put a mouse in the joystick port (which is what `Gsmousedx(1)` is
 * FOR — the guide offers both ports for both calls) or a stick in the mouse
 * port. Here port 0 is always the pointer and port 1 always the controller,
 * because those are the two things a browser supplies. A stick in port 1 does
 * produce real, moving counter values through the quadrature encoding — small
 * ones, 0 to 3, exactly as the hardware would — so `Gsmousedx(1)` is not
 * silently dead; it just cannot see a second mouse there.
 */
const joyDat = (rt: Runtime, port: number): number =>
  port === 0 ? mouseDat(rt.input.mouseX, rt.input.mouseY) : joyDatOf(rt.input.ports[1])

function seedCounters(rt: Runtime, st: GameSupportState): void {
  for (const p of [0, 1]) {
    const w = joyDat(rt, p)
    st.prev[p as 0 | 1] = { x: joyDatX(w), y: joyDatY(w) }
  }
}

/**
 * The scale, spelled out three times in the binary ($1e3a, $1ec0, $1be2) and
 * once in the guide: *"the dx and dy values are calculated like this:
 * dx=(dx*(speed+7))/8"*.
 *
 * `muls.w` takes only the LOW WORD of the stored factor, which is why `sw16`
 * is here and not decoration — see `Gssetmousespeed` for how a factor with a
 * high word gets stored in the first place. `asr.l #$3` is an arithmetic
 * shift, so a negative delta rounds toward minus infinity rather than toward
 * zero; `Math.floor` would agree but `>> 3` is the same instruction.
 */
const scale = (delta: number, st: GameSupportState): number => (delta * sw16(st.speed)) >> 3

/**
 * The third part of the VBL hook, at $1ba2 — port 0's counters.
 *
 * Port 0 has no read-time path: `Gsmousedx(0)` hands back an accumulator and
 * clears it, and this is what fills it. Port 1 is differenced at read time
 * instead, which is why fast movement on port 1 is misreported if a program
 * calls less often than once a frame and movement on port 0 never is.
 *
 * Note the order — Y first, from the high byte, then X from the low. Both
 * deltas are scaled BEFORE accumulating, so changing `Gssetmousespeed`
 * mid-stream rescales only what arrives after it.
 */
export function gamesupportVbl(rt: Runtime): void {
  const st = rt.gamesupport
  if (!st) return
  const w = joyDat(rt, 0)
  const p = st.prev[0]
  const y = joyDatY(w)
  st.accumY += scale(counterDelta(y, p.y), st)
  p.y = y
  const x = joyDatX(w)
  st.accumX += scale(counterDelta(x, p.x), st)
  p.x = x
}

export function makeGameSupportInstructions(rt: Runtime): Record<string, Instr> {
  return {
    /**
     * Gssetmousespeed speed — routine 6 ($1efa), thirty bytes:
     *
     *     move.l (a3)+, d0
     *     beq    -> error 1          a speed of exactly 0
     *     addq.w #$7, d0             the LOW WORD only
     *     tst.w  d0
     *     bmi    -> error 1          ...which must not have gone negative
     *     move.l d0, $2e(a2)
     *
     * The guide's *"the maximum value is 32760(!)"* falls straight out of
     * that: 32760 + 7 is 32767, and 32761 + 7 is $8000, which `tst.w` reads as
     * negative. The message is off by one about it — "between 0 and 32761" —
     * and 0 raises as well, so the true range is 1 to 32760.
     *
     * Two quirks, both from `addq.w` being a WORD add on a LONG value:
     * a negative speed keeps its high word and is used as its low word plus
     * seven, and a speed of -7 stores a factor of zero, after which every
     * delta scales to nothing. Neither raises.
     */
    'gssetmousespeed'(it) {
      const speed = it.evalInt()
      if (speed === 0) gsError(1)
      const low = (speed + 7) & 0xffff
      if (sw16(low) < 0) gsError(1)
      rt.gamesupport.speed = (speed & ~0xffff) | low
    },

    /**
     * Gsmulti Off and Gsmulti On — routines 10 ($21cc) and 11 ($21e0), twenty
     * bytes each and one call apiece:
     *
     *     movea.l $4.l, a6 / jsr -$84(a6)      Forbid
     *     movea.l $4.l, a6 / jsr -$8a(a6)      Permit
     *
     * so "multi" is multitasking, and the pair are exec's `Forbid`/`Permit`
     * under a game-writer's name. Neither is in the guide.
     *
     * Observably nothing here, and `../amiga/exec.ts` says why in its own
     * header: *"There is one task here, so Forbid and Permit have nothing to
     * forbid"*. These are the first callers it has ever had and they do not
     * change that — exec's nesting count (`TDNestCnt`) has no reader, because
     * neither keyword returns anything and nothing else in the port asks.
     *
     * DEVIATION: on the machine Forbid stops every other task until the
     * matching Permit, which is what makes the pair worth having — a game
     * brackets a tight loop with them to keep the disk and the mouse from
     * stealing cycles. Nothing here competes for cycles, so the bracket has no
     * effect. Unbalanced nesting is likewise invisible: `Gsmulti Off` twice
     * and `Gsmulti On` once leaves a real Amiga forbidden, and leaves this
     * exactly as it was.
     */
    'gsmulti off'() {},
    'gsmulti on'() {},
  }
}

/**
 * The Newton-Raphson integer square root that `Gssqr` and `Gspyth` share.
 *
 * Byte for byte the same loop in both ($21b0 and $2c14); only the seed and the
 * iteration count differ. Every step is a 68000 instruction with its exact
 * width, because the widths are where the behaviour is:
 *
 *     move.l d2, d1        the guess
 *     move.l d0, d2
 *     divu.w d1, d2        UNSIGNED 32/16 — quotient low word, remainder high
 *     ext.l  d2            sign-extend the QUOTIENT WORD
 *     add.l  d1, d2
 *     lsr.l  #$1, d2       LOGICAL, so a negative sum comes back huge
 *     cmp.l  d1, d2 / beq  settled
 *     dbra   d3
 *
 * Three consequences a caller can reach, none of them guarded:
 *
 *  - `divu.w` reads the dividend UNSIGNED, so a negative argument is a value
 *    near 2^32 rather than an error.
 *  - a quotient wider than 16 bits overflows: the 68000 sets V and leaves the
 *    destination ALONE, so `d2` stays the dividend and `ext.l` then takes its
 *    low word. That is why both routines want a seed in the right ballpark.
 *  - a zero divisor is a 68000 zero-divide EXCEPTION. The routines never check
 *    for one and `Gssqr` can be handed an argument that produces one — see
 *    below. There is no exception vector in this port, so it surfaces as AMOS
 *    error 20, which is the nearest true thing to say.
 */
function newtonSqrt(x: number, seed: number, rounds: number): number {
  const dividend = x >>> 0
  let d2 = seed | 0
  for (let i = 0; i <= rounds; i++) {
    const d1 = d2 | 0
    const divisor = d1 & 0xffff
    if (divisor === 0) throw new AmosError('Division by zero', 20)
    const q = Math.floor(dividend / divisor)
    // overflow leaves the register untouched, so ext.l takes the DIVIDEND's
    // low word rather than a quotient that would not fit
    d2 = sw16(q > 0xffff ? dividend : q)
    d2 = (d2 + d1) | 0
    d2 = d2 >>> 1
    if (d2 === d1) break
  }
  return d2 | 0
}

/** `addq.w #$7, dn` — seven onto the low word, the high word untouched */
const addq7w = (v: number): number => (v & ~0xffff) | ((v + 7) & 0xffff)

// -- the passcodes -------------------------------------------------------
//
// `Gspasscode` and `Gspassdecode` are one cipher read from both ends, and the
// two routines ($235c and $252e) are close to mirror images. Everything below
// is shared between them, which is the only way to be sure they agree.
//
// The guide is clear about the ambition and the limits: *"This function is NOT
// designed to be a high security password system, but it is ideal for
// generating level codes for games."*

/**
 * The 5-bit fold both checksums end with — `$248c`, `$24bc`, `$268c`, `$26ba`,
 * identical in all four:
 *
 *     move.l d0, d1
 *     lsr.l #$8, d1 / add.l d1, d0        three times, on the SAME d1
 *     andi.l #$1f, d0
 *
 * Note the shifts compound: d1 is 8, then 16, then 24 bits down. So this adds
 * all four bytes of the sum together, plus carries, and keeps five bits.
 */
function fold5(sum: number): number {
  let d0 = sum >>> 0
  let d1 = d0 >>> 8
  d0 = (d0 + d1) >>> 0
  d1 = d1 >>> 8
  d0 = (d0 + d1) >>> 0
  d1 = d1 >>> 8
  d0 = (d0 + d1) >>> 0
  return d0 & 0x1f
}

/**
 * The ID digest, `$24d8` and `$26d6` — the seed the guide describes as
 * *"a string which will be digested into a seed for the encryption process"*
 * and warns is *"case sensitive"*.
 *
 *     move.w (a0)+, d7 / subq.w #$1, d7
 *     add.b (a0)+, d0                     the LOW BYTE only
 *     rol.l #$7, d0                       the WHOLE register
 *     dbra d7
 *
 * The byte-wide add against a long-wide rotate is what spreads a short string
 * over 32 bits: each character lands in the low byte and is then carried up
 * seven places before the next one arrives.
 */
function idDigest(id: string): number {
  let d0 = 0
  for (let i = 0; i < id.length; i++) {
    const b = id.charCodeAt(i) & 0xff
    d0 = (d0 & ~0xff) | ((d0 + b) & 0xff)
    d0 = ((d0 << 7) | (d0 >>> 25)) >>> 0
  }
  return d0
}

/** the cipher's two words of state: `$24fa`/`$24fe` and `$26f8`/`$26fc` */
interface Keystream {
  /** the ID digest, which the step MUTATES — one bit flipped per character */
  a: number
  /** the running key, seeded with the data checksum */
  b: number
}

/**
 * One keystream byte — `$244e` and `$2648`, identical:
 *
 *     move.l (a1), d0 / move.l (a0), d1
 *     rol.l  #$1, d0
 *     eor.l  d1, d0
 *     move.b d0, d2 / andi.l #$f, d2
 *     bchg   d2, d1                       LONG: destination is a data register
 *     move.l d1, (a0) / move.l d0, (a1)
 *     and.l  d3, d0                       d3 is the caller's mask, always $1f
 *
 * `bchg` printed as `.b` by capstone is a display artefact: the opcode is
 * $0541, whose EA mode is 000 (data register direct), and a register
 * destination makes BCHG a 32-bit operation modulo 32. The bit number is
 * masked to four bits first, so only bits 0 to 15 of the digest are ever
 * touched — the top half of it never changes after the first call.
 */
function keyStep(k: Keystream, mask: number): number {
  let d0 = k.b >>> 0
  let d1 = k.a >>> 0
  d0 = ((d0 << 1) | (d0 >>> 31)) >>> 0
  d0 = (d0 ^ d1) >>> 0
  const bit = d0 & 0xf
  d1 = (d1 ^ (1 << bit)) >>> 0
  k.a = d1
  k.b = d0
  return d0 & mask
}

/**
 * Five bits to a character and back — `$23d6`/`$2418` and `$258c`/`$2602`.
 *
 *     addi.l #$41, d1 / cmp.l #$5a, d1 / ble / subi.l #$27, d1
 *
 * 0 to 25 become 'A' to 'Z' and 26 to 31 become '4' to '9', which is exactly
 * the guide's *"the returned passcode can contain the upper case letters (A-Z)
 * and the digits 4 to 9"*. Both are LONG operations on a register the routine
 * never fully clears, which is why they are written on `d1` rather than on a
 * value — see `encode` for what leaks through.
 */
const toChar = (d1: number): number => {
  const v = (d1 + 0x41) | 0
  return v > 0x5a ? (v - 0x27) | 0 : v
}
const fromChar = (c: number): number => {
  const v = (c - 0x41) | 0
  return v < 0 ? (v + 0x27) | 0 : v
}

/** longword at addr, unsigned, through the synthesized address space */
function getL(rt: Runtime, addr: number): number {
  const m = rt.resolveAddr(addr)
  if (!m || m.off + 3 >= m.data.length) return 0
  return ((m.data[m.off]! << 24) | (m.data[m.off + 1]! << 16) | (m.data[m.off + 2]! << 8) | m.data[m.off + 3]!) >>> 0
}

function putL(rt: Runtime, addr: number, v: number): void {
  const m = rt.resolveWrite(addr)
  if (!m || m.off + 3 >= m.data.length) return
  m.data[m.off] = (v >>> 24) & 0xff
  m.data[m.off + 1] = (v >>> 16) & 0xff
  m.data[m.off + 2] = (v >>> 8) & 0xff
  m.data[m.off + 3] = v & 0xff
}

/**
 * `subq.w #$1, d7` then `dbra d7` — how many times the body runs.
 *
 * A count of zero does NOT skip the loop: `subq.w` makes the word $ffff and
 * `dbra` then runs 65536 times. Neither passcode routine checks, so
 * `Gspasscode(id$, ptr, 0)` reads 65536 longwords and builds a 65538-character
 * code out of them. That is the routine, not an approximation of it.
 */
const dbraCount = (n: number): number => ((n - 1) & 0xffff) + 1

export function makeGameSupportFunctions(rt: Runtime): Record<string, Func> {
  const st = (): GameSupportState => rt.gamesupport

  /** `cmp.l #$1, d0` after `bmi`/`beq`, so 0 and 1 pass and error 2 otherwise */
  const gameport = (n: number): number => {
    if (n < 0 || n > MAX_GAMEPORT) gsError(2)
    return n
  }

  /**
   * The read-time half of the mouse counters, for port 1 only ($1dec/$1e74).
   *
   * Difference against the remembered byte, sign-extend through 8 bits, scale,
   * and remember the new one. Port 0 never comes here — it reads the
   * accumulator `gamesupportVbl` fills.
   */
  const readDelta = (axis: 'x' | 'y'): number => {
    const w = joyDat(rt, 1)
    const now = axis === 'x' ? joyDatX(w) : joyDatY(w)
    const p = st().prev[1]
    const d = scale(counterDelta(now, p[axis]), st())
    p[axis] = now
    return d
  }

  return {
    /**
     * =Gsreadport(gameport) — routine 2 ($1d96), forty-two bytes and almost
     * all of them prologue:
     *
     *     move.l  (a3)+, d0
     *     movea.l $258(a5), a2
     *     move.l  $52(a2), d3
     *     beq     -> error 0
     *     movea.l d3, a6
     *     jsr     -$1e(a6)           ReadJoyPort(d0)
     *
     * -$1e is -30, the first entry in `lowlevel_lib.fd` at its bias of 30, so
     * this is `ReadJoyPort` and the return value is its bitfield unchanged —
     * type in the top nibble, directions in the low nibble, seven buttons at
     * bits 17 to 23. `../amiga/lowlevel.ts` owns the encoding.
     *
     * NOTE what is NOT here: no range check. `Gsmousedx` guards its port and
     * this does not, so an out-of-range port reaches `ReadJoyPort`, which
     * answers `JP_TYPE_NOTAVAIL` — zero — rather than raising. The guide's
     * *"gameport will be 0 for the mouse port, or 1 for the joystick port"* is
     * advice, not a rule the routine enforces.
     */
    'gsreadport'(_, a): Value {
      if (!st().lowlevel) gsError(0)
      return VI(readJoyPort(rt.input.ports, int(a[0]!)) | 0)
    },

    /**
     * =Gstimer — routine 3 ($1dc0):
     *
     *     move.l $52(a2), d0
     *     beq    -> error 0
     *     movea.l d0, a6
     *     lea    $4a(a2), a0
     *     jsr    -$66(a6)            ElapsedTime(a0)
     *
     * -102 is `ElapsedTime`, whose result is in 1/65536 of a second. The
     * context at $4a is never initialised, which is why the guide warns *"the
     * first time this call is used, the result will be garbage"* — it is the
     * uptime, measured from a zero the extension never wrote.
     *
     * The clock here is the vertical blank counter at PAL 50 Hz, so a tick is
     * 65536/50 units. See `elapsedTime` in `../amiga/lowlevel.ts` for what
     * that costs against a real E clock.
     */
    'gstimer'(): Value {
      if (!st().lowlevel) gsError(0)
      return VI(elapsedTime(st().clock, Math.floor((rt.interp.tick * 65536) / 50)))
    },

    /**
     * =Gsmousedx(gameport) and =Gsmousedy(gameport) — routines 4 and 5 ($1dec
     * and $1e74), 136 and 134 bytes of the same shape:
     *
     *     move.l (a3)+, d0
     *     bmi    -> error 2
     *     beq    -> port 0: return $32(a2) and clear it
     *     cmp.l  #$1, d0 / bne -> error 2
     *     move.l $42(a2), d0                 the remembered byte
     *     move.w $dff00c.l, d1 / andi.w #$ff  JOY1DAT, low byte  (dy: lsr.w #$8)
     *     move.l d1, $42(a2)
     *     sub.l  d0, d1
     *     bsr    -> wrap through 8 bits, then muls.w/asr.l #$3
     *
     * Two ports, two completely different paths, and the difference is
     * visible: port 0 accumulates every frame and port 1 is sampled when
     * asked. The guide's warning — *"This routine should be called as often as
     * possible, preferably once every vblank, otherwise very fast mouse
     * movements will be misinterpreted"* — is only true of port 1.
     *
     * Note the error argument order. `bmi` fires before anything else, so a
     * negative port raises without the routine ever looking at the block.
     */
    'gsmousedx'(_, a): Value {
      const n = gameport(int(a[0]!))
      if (n === 1) return VI(readDelta('x'))
      const v = st().accumX
      st().accumX = 0
      return VI(v)
    },
    'gsmousedy'(_, a): Value {
      const n = gameport(int(a[0]!))
      if (n === 1) return VI(readDelta('y'))
      const v = st().accumY
      st().accumY = 0
      return VI(v)
    },

    /**
     * =Gscontrollertype and =Gsreadsega — routines 98 ($2c30) and 99 ($2c54),
     * both reading `$66(a2)` and both answering 0 when it is zero:
     *
     *     move.l $66(a2), d0
     *     beq    -> moveq #$0, d3 / rts        no raise, just zero
     *     movea.l d0, a6
     *     jsr    -$24(a6)                      GSReadCType     (type)
     *     moveq  #$0, d0 / jsr -$42(a6)        GSReadButtons(0) (sega)
     *
     * $66 is `GSDrivers/gsjoystick.library`, one of the author's own driver
     * modules. The guide's Modules node describes the whole scheme in the
     * future tense — *"Several of GameSupport's major features are (read: will
     * be!) subcontracted to a separate module"* — and no such library ships
     * with the extension or was ever released.
     *
     * So these answer 0, and that is the FAITHFUL answer rather than a stub:
     * it is what the routine returns on any machine without the driver
     * installed, which is every machine. There is nothing to disassemble and
     * no behaviour to recover; if the library ever surfaces, the two `jsr`s
     * above say precisely where it plugs in.
     *
     * Neither takes an argument and neither can raise.
     */
    'gscontrollertype'(): Value {
      return VI(0)
    },
    'gsreadsega'(): Value {
      return VI(0)
    },

    /**
     * =Gssqr(x) — routine 9 ($21a0), forty-four bytes and undocumented; the
     * guide's command list does not mention it at all.
     *
     *     move.l (a3)+, d0 / move.l d0, d2
     *     beq    -> return d2, which is the zero it just tested
     *     lsr.l  #$8, d2 / ext.l d2 / addq.w #$7, d2      the seed
     *     moveq  #$4, d3                                  five passes
     *     ...the shared Newton loop...
     *
     * The seed is `(x >> 8) + 7`, which for anything under a megabyte is
     * within a factor of two of the answer, and five passes settle it. `lsr.l`
     * is logical and `ext.l` sign-extends the WORD, so an argument at or above
     * $800000 seeds NEGATIVE and the loop runs on a divisor `divu.w` reads as
     * a large unsigned number instead.
     *
     * The one argument that breaks it: the seed's low word is zero when
     * `x >> 8` ends in $fff9, so `Gssqr(16775936)` — $fff900 — divides by
     * zero. The routine has no guard for it. On the machine that is a 68000
     * exception, not an AMOS error.
     */
    'gssqr'(_, a): Value {
      const x = int(a[0]!)
      if (x === 0) return VI(0)
      return VI(newtonSqrt(x, addq7w(sw16(x >>> 8)), 4))
    },

    /**
     * =Gspyth(x,y) — routine 97 ($2bea), seventy bytes. The guide calls it
     * *"a highly optimised (at the expense of accuracy) function to apply
     * Pythagoras' theorem [...] equivalent to d=Sqr(x*x+y*y), but is nearly 3
     * times as fast when the program is compiled"*.
     *
     *     move.l (a3)+, d0 / bpl / neg.l d0        |x|
     *     move.l (a3)+, d1 / bpl / neg.l d1        |y|
     *     move.l d0, d2 / add.l d1, d2 / add.l d1, d2      |x| + 2|y|
     *     muls.w d1, d1 / muls.w d0, d0 / add.l d1, d0     x*x + y*y
     *     tst.l  d0 / beq -> return d2, which is 0 when both were
     *     lsr.l  #$1, d2 / ext.l d2 / addq.w #$7, d2       the seed
     *     moveq  #$6, d3                                   seven passes
     *
     * The seed is asymmetric — `(|x| + 2|y|) / 2 + 7`, so y counts double —
     * even though the guide says *"though the order doesn't matter!"*. Seven
     * passes is two more than `Gssqr` gets and is enough to converge from
     * either seed, so the guide is right about the ANSWER and wrong about the
     * arithmetic. Swap the arguments and the same number comes out by a
     * different route.
     *
     * `muls.w` is a SIGNED 16x16 multiply, so only the low word of each
     * argument is squared. That is the whole of the guide's *"please keep the
     * values of x & y below about 20000, since results become unpredictable if
     * larger numbers are used"* — past 32767 the low word is a different
     * number, and past 46340 the sum overflows 32 bits as well.
     */
    'gspyth'(_, a): Value {
      // `bpl / neg.l`, which for $80000000 is a no-op — Math.abs would leave
      // the 32-bit range there, and `| 0` puts it back where `neg.l` does
      const abs = (v: number): number => (v < 0 ? -v | 0 : v)
      const x = abs(int(a[0]!))
      const y = abs(int(a[1]!))
      const seed = (x + y + y) | 0
      const sq = (sw16(y) * sw16(y) + sw16(x) * sw16(x)) | 0
      if (sq === 0) return VI(seed)
      return VI(newtonSqrt(sq, addq7w(sw16(seed >>> 1)), 6))
    },

    /**
     * =Gspasscode(ID$, Pointer, Length) — routine 36 ($235c), 466 bytes.
     *
     * The arguments are popped RIGHT TO LEFT: `(a3)+` goes to $2506 (Length),
     * then $2502 (Pointer), then $250a (ID$), and each is used as its name
     * says — $2506 bounds a `dbra`, $2502 is dereferenced with `move.l (a0)+`,
     * $250a is read as a length-prefixed AMOS string.
     *
     * Four passes, in this order:
     *
     *  1. `$247a` sums the `Length` longwords at `Pointer` and folds them to
     *     five bits. That checksum is the cipher's SEED as well as the thing
     *     the decoder verifies, which is what ties a code to its payload.
     *  2. `$2372` splits each longword into 4-bit groups, low group first,
     *     with bit 4 set on every group but the last. `lsr.l` is logical, so a
     *     negative value needs all eight — the guide says so: *"the number 1
     *     will encode to a single character within the final code whereas the
     *     number -1 will require eight"*.
     *  3. The length's LOW BYTE goes in front of the groups (`move.b $250f(pc)`
     *     — $250f is the second byte of the length word at $250e), and the
     *     whole lot is XORed with the keystream and mapped to characters.
     *  4. `$24a8` checksums the characters just produced and appends
     *     `(datasum - passsum) & $1f` as one more. Those are the guide's *"two
     *     check digits"*: the length in front and this one behind.
     *
     * `d1` is never cleared between characters, and every arithmetic step on
     * it is a LONG operation while the load is a `move.b`. So bits 8 and up
     * survive from one character to the next, and a length byte of 230 or more
     * carries into them — after which every following character is 0x100 too
     * high before the `move.b` truncates it. `Gspassdecode` clears `d1` every
     * iteration ($25fa) and cannot reproduce that, so codes long enough to
     * trigger it do not decode. Both sides are modelled as written.
     */
    'gspasscode'(_, a): Value {
      const id = str(a[0]!)
      const ptr = int(a[1]!)
      const count = int(a[2]!)

      const rounds = dbraCount(count)
      let sum = 0
      for (let i = 0; i < rounds; i++) sum = (sum + getL(rt, ptr + i * 4)) >>> 0
      const datasum = fold5(sum)

      // the nibble split: low group first, bit 4 marking "another follows"
      const groups: number[] = []
      for (let i = 0; i < rounds; i++) {
        let v = getL(rt, ptr + i * 4)
        for (;;) {
          let g = v & 0xf
          v = v >>> 4
          if (v !== 0) g |= 0x10
          groups.push(g)
          if ((g & 0x10) === 0) break
        }
      }

      // `$250e = d6 + 1` where d6 counted from 1: the length is groups + 2
      const len = groups.length + 2
      const buf = [len & 0xff, ...groups]

      // `$23b2` seeds the key with the data checksum BEFORE `$23ba` computes
      // the digest; the decoder does the same two in the same order
      const key: Keystream = { b: datasum, a: 0 }
      key.a = idDigest(id)

      // d1 carried across iterations, exactly as the register is
      let d1 = 0
      for (let i = 0; i < buf.length; i++) {
        d1 = (d1 & ~0xff) | buf[i]!
        d1 = (d1 & ~0xffff) | ((d1 ^ keyStep(key, 0x1f)) & 0xffff)
        d1 = toChar(d1)
        buf[i] = d1 & 0xff
      }

      let psum = 0
      for (const c of buf) psum = (psum + c) >>> 0
      buf.push(toChar((datasum - fold5(psum)) & 0x1f) & 0xff)

      return VS(buf.map((c) => String.fromCharCode(c)).join(''))
    },

    /**
     * =Gspassdecode(ID$, PASS$, POINTER) — routine 37 ($252e), 486 bytes, the
     * mirror. Popped right to left again: $270c (POINTER), $2708 (PASS$),
     * $2710 (ID$).
     *
     * It rebuilds the seed from the code rather than from the data, which is
     * the trick that makes the pair work: `$2576` takes the LAST character,
     * unmaps it, adds the checksum of everything before it and masks to five
     * bits, and that is the encoder's `datasum` again. Then it decrypts the
     * first character and compares it with the string's own length. Three ways
     * to answer zero, in order:
     *
     *  - the length character does not match `PASS$`'s length low byte
     *  - ...and after decoding, the checksum of the recovered longwords does
     *    not match the seed
     *
     * (the third is any code so mangled that the groups run out mid-value,
     * which falls out of the loop rather than being tested for).
     *
     * The result is *"the number of values which have been placed in the
     * array — a 6 character passcode could contain 1, 2, 3 or 4 values, so
     * this number should be checked"*.
     *
     * DEVIATION: the one thing here a program can see. The routine
     * writes into `PASS$`: `move.b #$0,-$1(a0)` zeroes the last character and
     * `move.b d1,(a0)+` replaces the first with its decrypted value. The guide
     * owns up to it — *"the string which is passed to this function will be
     * corrupted by this call (for no reason other than my laziness!)"* — and
     * advises `Upper$()` partly to dodge it, since that passes a temporary.
     * Arguments arrive here by value, so the caller's variable survives. A
     * program that decodes the same variable twice fails on the machine and
     * succeeds here.
     */
    'gspassdecode'(_, a): Value {
      const id = str(a[0]!)
      const pass = str(a[1]!)
      const ptr = int(a[2]!)

      // `move.b -$1(a0), d0` on a string with no characters reads the length
      // word instead. Nothing here to read, and nothing decodes either way.
      if (pass.length < 2) return VI(0)

      const chars = [...pass].map((c) => c.charCodeAt(0) & 0xff)
      // the last character is consumed as the key seed and then zeroed, which
      // is what terminates both of the loops below
      const last = chars.pop()!
      let psum = 0
      for (const c of chars) psum = (psum + c) >>> 0
      const datasum = (fromChar(last) + fold5(psum)) & 0x1f

      const key: Keystream = { b: datasum, a: 0 }
      key.a = idDigest(id)

      // the length character, decrypted and checked against the real length
      const lenChar = (fromChar(chars[0]!) ^ keyStep(key, 0x1f)) & 0xff
      if (lenChar !== (pass.length & 0xff)) return VI(0)

      // the groups, low first, reassembled until one arrives without bit 4
      let acc = 0
      let shift = 0
      let count = 0
      for (let i = 1; i < chars.length; i++) {
        const d1 = fromChar(chars[i]!) ^ keyStep(key, 0x1f)
        acc = (acc | ((d1 & 0xf) << shift)) >>> 0
        if ((d1 & 0x10) !== 0) {
          shift += 4
          continue
        }
        putL(rt, ptr + count * 4, acc)
        count += 1
        acc = 0
        shift = 0
      }

      let dsum = 0
      for (let i = 0; i < count; i++) dsum = (dsum + getL(rt, ptr + i * 4)) >>> 0
      if (fold5(dsum) !== datasum) return VI(0)
      return VI(count)
    },
  }
}
