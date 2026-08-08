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
import { libraryPresent } from '../amiga/exec'
import { Protracker, parseMod } from '../amiga/protracker'
import { loadHunks } from '../amiga/hunk'

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

/**
 * `GSC2P_DebugMode`, $1a into the C2P info block — and the ABSOLUTE address
 * `Gsc2pdebug` toggles when no library is open, because it is the one C2P
 * routine with no null check. On the machine that is inside exec's exception
 * vector table.
 */
const C2P_DEBUGMODE = 0x1a

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
  /**
   * $56 and $5a — workbench.library and icon.library, which here it does NOT.
   * Both come from `libraryPresent`, so the flags say what the port models
   * rather than what this file would like. `Gsiconify` is the only reader.
   */
  workbench: boolean
  icon: boolean
  /** the ProTracker half — see `GameSupportMusic` */
  music: GameSupportMusic
  /** $7a — sixteen eight-byte slots, `{ segment, header }` each */
  codemods: Array<CodeModule | null>
}

/**
 * One loaded GSMod, which is one slot of the table at $7a.
 *
 * On the machine a slot is two longwords: the `LoadSeg` BPTR at +0 and a
 * pointer to the module's own header at +4. Here the segment is the relocated
 * image and the header is an offset into it, because the image has to be
 * readable through `Runtime.CODEMOD_BASE` — `Gsfindattr` hands an entry's
 * address straight to the program.
 */
export interface CodeModule {
  /** the relocated hunk image, mapped at `base` */
  image: Uint8Array
  /** where the slot is mapped, so pointers inside the image are real */
  base: number
  /** the offset of the `"GSMo"` header the loader scanned for */
  header: number
}

/**
 * The replayer's own block, at $1b70 and below the data pointer, plus the four
 * loop fields above it.
 *
 * The extension ships a whole ProTracker replayer — `SubRoutines/PlayRoutine.s`
 * in its source, which is one of the six includes the archive does not carry.
 * It is not reimplemented here: `../amiga/protracker.ts` is already a
 * four-channel ProTracker replay ported from Player 6.1A's source and checked
 * byte-exactly against the corpus, and the same engine already serves AMCAF
 * and P61. What IS read off the binary is everything GameSupport adds to a
 * stock replayer, because that is where it differs:
 *
 *     $0    loop on/off               $1c1a, tested at $ce4
 *     $4    loop start, Pos1          $1c1e, the byte at $1c21 seeds the position
 *     $8    loop end, Pos2            $1c22, compared at $cd2
 *     $10   the DEFERRED loop end     $1c2a, swapped in at $d04
 *     $18   master volume, 0..64      $1c32, `mulu.w / lsr.l #$6` at $157c
 *     -$94  transpose, in semitones   $1b86, read at $1520
 *     -$96  the 8tb mailbox           $1b84, set at $1212
 *     -$a4  the song position         $1b76
 *
 * DEVIATION: inherited rather than introduced --- the real player runs off a CIA
 * timer ($626 opens `ciab.resource` and installs an ICR vector, picking
 * $1b0f87 or $1b4f4d as its clock by graphics.library's PAL bit), so `Fxx`
 * above $1f sets a true tempo. Every replayer in this port ticks once a
 * vertical blank instead, so a module written at 125 BPM plays right and one
 * that changes tempo does not change speed. `Protracker.bpm` still tracks what
 * was asked for.
 */
export interface GameSupportMusic {
  /** the engine, shared with every other module player here */
  replay: Protracker
  /** $0 — `Gstrack Loop On`/`Off`; 1 by the cold start, so looping starts on */
  loop: boolean
  /** $4 and $8 — the range, as LONGWORDS; -1 in either means "not set" */
  from: number
  to: number
  /** $10 — the end to swap in at the next wrap, or -1 */
  defer: number
  /** $c — cleared to -1 by `Gstrack Play` and read by nothing else */
  spare: number
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
    workbench: libraryPresent('workbench.library'),
    icon: libraryPresent('icon.library'),
    music: {
      // `move.l #$1,$0(a0)` / `#$ffffffff` into $4 and $8 / `move.w #$40,$18`
      replay: new Protracker(() => rt?.host.audio),
      loop: true,
      from: -1,
      to: -1,
      defer: -1,
      spare: -1,
    },
    codemods: Array.from({ length: CODEMOD_SLOTS }, () => null),
  }
  st.music.replay.master = 0x40
  if (rt) seedCounters(rt, st)
  return st
}

// -- the code modules ----------------------------------------------------
//
// Six keywords, none of them in the guide, over a loadable-code format of the
// author's own. Everything below is read off the binary; `subroutines/
// codemods.s` is another of the missing includes.
//
// A GSMod is an ordinary AmigaDOS loadable file whose first hunk carries the
// four bytes `"GSMo"` somewhere in its first thirty-two, followed by a header:
//
//     +$14  the init routine, called by Gsloadcodemod
//     +$18  the cleanup routine, called by Gsunloadcodemod
//     +$1c  the FUNCTION table, which Gscallmod searches
//     +$20  the ATTRIBUTE table, which Gsgetattr/Gssetattr/Gsfindattr search
//
// and a table is twenty-seven longwords — one bucket per initial letter, plus
// an end marker — over an array of eight-byte entries, `{ value, name }`.

/** `moveq #$f, d7` over eight-byte slots: the table holds sixteen */
const CODEMOD_SLOTS = 16
/**
 * Where the sixteen slots are mapped, matching `Runtime.CODEMOD_BASE` and
 * `CODEMOD_SLOT`. Spelled out rather than imported because `./runtime` is a
 * TYPE-only import here and reaching for the class would make it a cycle.
 * `memmap.test.ts` is what holds the two to agreeing.
 */
const CODEMOD_BASE = 0x5c00_0000
const CODEMOD_SLOT = 0x0010_0000

/**
 * The attribute lookup, at $29a4 and copied verbatim three more times ($2a50,
 * $2af4, $2b90 — the four are identical instruction for instruction):
 *
 *     move.b (a0), d0 / bclr.b #$5, d0     the initial, forced UPPER CASE
 *     subi.l #$41, d0 / bmi -> 0           below 'A'
 *     cmp.l #$19, d0 / bgt -> 0            above 'Z'
 *     lsl.l #$2, d0
 *     movea.l (a1, d0.w), a2               the bucket
 *     move.l $4(a1, d0.w), d7 / sub.l a2, d7   ...and the NEXT one, as its end
 *     beq -> 0                             an empty bucket
 *     lsr.l #$3, d7 / subq.w #$1, d7       eight bytes an entry
 *
 * and then, per entry, a comparison that ends when the ENTRY's byte reaches
 * zero rather than when both do:
 *
 *     move.b (a1)+, d0 / move.b (a3)+, d1
 *     beq -> MATCH                         the entry's name has run out
 *     bclr.b #$5, d0 / bclr.b #$5, d1 / cmp.b d0, d1 / beq -> keep going
 *
 * Two consequences a caller can reach. The match is CASE INSENSITIVE, which
 * `bclr #5` gives for letters and gives nonsense for anything else — '0' and
 * 'P' differ only in bit 5, so they compare equal. And it is a PREFIX match on
 * the entry: an entry named "SPEED" answers a lookup for "SPEEDY".
 */
function findAttr(rt: Runtime, table: number, name: string): number {
  const initial = (name.charCodeAt(0) & ~0x20) - 0x41
  if (Number.isNaN(initial) || initial < 0 || initial > 0x19) return 0
  const bucket = getL(rt, table + initial * 4)
  const end = getL(rt, table + initial * 4 + 4)
  const count = (end - bucket) >>> 3
  if (end === bucket || count === 0) return 0
  for (let i = 0; i < count; i++) {
    const entry = bucket + i * 8
    const at = getL(rt, entry + 4)
    let k = 0
    for (;;) {
      const b = getB(rt, at + k)
      if (b === 0) return entry // the entry's name has run out: a match
      const want = name.charCodeAt(k)
      if (Number.isNaN(want) || (want & ~0x20) !== (b & ~0x20)) break
      k++
    }
  }
  return 0
}

/** `$1c(a1)` — the FUNCTION table Gscallmod searches */
const FUNC_TABLE = 0x1c
/** `$20(a1)` — the ATTRIBUTE table the other three search */
const ATTR_TABLE = 0x20

/**
 * A slot number, a name and a table offset, resolved to an entry address.
 *
 * All four routines share this preamble: `lsl.l #$3, d0` for the slot,
 * `movea.l $4(a2, d0.w), a1` for the module header, then the table pointer.
 * NOTE the `.w` displacement and the absence of any range check --- a slot
 * number is masked to sixteen bits by the addressing mode and nothing tests
 * it against the sixteen the table holds.
 */
function attrEntry(rt: Runtime, slot: number, name: string, table: number): number {
  const n = ((slot << 3) & 0xffff) >> 3
  const m = rt.gamesupport.codemods[n]
  if (!m) return 0
  return findAttr(rt, getL(rt, m.base + m.header + table), name)
}

/** byte at addr, through the synthesized address space */
function getB(rt: Runtime, addr: number): number {
  const m = rt.resolveAddr(addr)
  return m && m.off < m.data.length ? m.data[m.off]! : 0
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
  musicVbl(st)
  const w = joyDat(rt, 0)
  const p = st.prev[0]
  const y = joyDatY(w)
  st.accumY += scale(counterDelta(y, p.y), st)
  p.y = y
  const x = joyDatX(w)
  st.accumX += scale(counterDelta(x, p.x), st)
  p.x = x
}

/**
 * The player's own advance, at $cb8 — the part `Protracker` cannot own,
 * because the range and the wrap belong to the extension and not the module.
 *
 *     addq.b #$1, (a1) / andi.b #$7f, (a1)      positions wrap at 128
 *     tst.l  $1c22 / blt -> length test         a negative Pos2 is "unset"
 *     subq.w #$1, d1 / cmp.b $3(a0), d1 / beq   ...else the one we just LEFT
 *     addq.w #$1, d1
 *     cmp.b $3b6(a0), d1 / bcs -> carry on      $3b6 is the module's length
 *     tst.l $1c1a / beq -> bra $908             loop off: STOP, do not wrap
 *     move.b $1c21(pc), (a1)                    ...else back to Pos1
 *     tst.l $1c2a / bmi -> carry on
 *     move.l (a0), $1c22 / move.l #-1, (a0)     the deferred end takes over
 *
 * Note that both position comparisons are `cmp.b` on longword fields, so only
 * the low byte of Pos1 and Pos2 is ever used, and that `blt`/`bmi` test the
 * whole longword — which is how -1 means "unset" while 255 does not.
 *
 * Only the SEQUENTIAL advance comes here. `Bxx` and `Dxx` have their own paths
 * in the replayer ($1174 and $11aa) and neither consults the range, so a
 * module that jumps out of its own loop range is not brought back.
 */
export function musicVbl(st: GameSupportState): void {
  const m = st.music
  const r = m.replay
  if (!r.playing || !r.song) return

  const len = r.song.positions.length
  const was = r.pos
  r.tick()
  if (r.pos === was) return
  // a Bxx or Dxx jump is not the advance this models
  const stepped = was + 1
  if (r.pos !== (stepped < len ? stepped : 0)) return

  let next = stepped & 0x7f
  const ended = (m.to >= 0 && ((next - 1) & 0xff) === (m.to & 0xff)) || next >= len
  if (ended) {
    if (!m.loop) {
      // `bra $908`: voices off, position 0, and the flag cleared
      gsTrackStop(st)
      return
    }
    next = m.from & 0xff
    if (m.defer >= 0) {
      m.to = m.defer
      m.defer = -1
    }
  }
  if (next !== r.pos) r.seek(next)
}

/**
 * $908, which `Gstrack Stop` reaches through `jsr -$1312(a6)` and which the
 * end of a non-looping song reaches through `bra`:
 *
 *     sf.b $1b7d / sf.b $1b83        both flags
 *     clr.b $1b76                    the position, back to 0
 *     clr.w $a8/$b8/$c8/$d8          all four volumes
 *     move.w #$f, $dff096            and all four DMA channels off
 *
 * `Protracker.stop` is the same pair of ideas — `playing` false and every
 * voice the music holds silenced — so the position is all this adds.
 */
function gsTrackStop(st: GameSupportState): void {
  const r = st.music.replay
  r.stop()
  r.pos = 0
}

export function makeGameSupportInstructions(rt: Runtime): Record<string, Instr> {
  const m = (): GameSupportMusic => rt.gamesupport.music

  /**
   * `Gstrack Play bank, Pos1 To Pos2` — routine 12 ($21f4), with routines 16
   * ($22bc) and 17 ($22c6) as its shorter forms. Each pushes a default and
   * falls into the next: `Gstrack Play bank` becomes `bank, 0 To -1`.
   *
   * The bank must be one `Track Load` made. `cmpi.l #$54726163, -$8(a2)` and
   * `#$6b657220, -$4(a2)` is "Trac" and "ker " — the eight-byte bank name —
   * and anything else is error 5, *"not a tracker bank"*. The guide is blunt
   * about the dependency: *"There is no Gstrack Load command, so you must use
   * the standard Track Load command instead."*
   */
  const play = (bank: number, from: number, to: number): void => {
    const mu = m()
    mu.to = to
    mu.from = from
    mu.defer = -1
    mu.spare = -1
    const b = rt.memBanks.get(bank)
    if (!b || b.name.padEnd(8, ' ') !== 'Tracker ') gsError(5)
    const song = parseMod(b!.data)
    if (!song) gsError(5)
    // `move.b $1c21(pc),(a0)` at $8ba: the position is Pos1's LOW BYTE
    mu.replay.load(song!, from & 0x7f)
    mu.replay.cmd8 = 0
    mu.replay.playing = true
  }

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

    /**
     * Gstrack Play bank | bank,Pos1 | bank,Pos1 To Pos2 — see `play`.
     *
     * The token table gives all three forms one name and three routines, each
     * pushing a default and falling through: 17 pushes 0 for Pos1, 16 pushes
     * -1 for Pos2, 12 does the work. So the bare form loops the whole module
     * from position 0, which is what `Gstrack Play 6` in its example does.
     */
    'gstrack play'(it) {
      const bank = it.evalInt()
      if (!it.accept(',')) return play(bank, 0, -1)
      const from = it.evalInt()
      const to = it.accept('to') ? it.evalInt() : -1
      play(bank, from, to)
    },

    /**
     * Gstrack Stop — routine 13 ($227a):
     *
     *     sf.b -$9d(a6)          the playing flag
     *     jsr  -$1312(a6)        $908: voices silent, position 0
     *     jsr  -$14e6(a6)        $734: the CIA interrupt removed
     *
     * The CIA half has no counterpart here — every replayer in this port is
     * driven from the vertical blank — so what is left is the silence.
     */
    'gstrack stop'() {
      gsTrackStop(rt.gamesupport)
    },

    /**
     * Gstrack Loop On / Off — routines 18 ($22d0) and 19 ($22de), one store
     * each into $0. *"The first two forms of this command work exactly as the
     * regular track loop commands."*
     *
     * With looping OFF the player does not merely stop repeating: reaching the
     * end runs `bra $908`, which is `Gstrack Stop`'s own silence.
     */
    'gstrack loop on'() {
      m().loop = true
    },
    'gstrack loop off'() {
      m().loop = false
    },

    /**
     * Gstrack Loop Pos1 | Pos1 To Pos2 — routines 20 ($22ec) and 21 ($22f6).
     * The one-argument form pushes -1 for Pos2 and falls through.
     *
     * Note what routine 21 does BESIDES storing the range: `move.l #$1,$0(a0)`
     * turns looping back ON. Setting a range is a request to loop it.
     */
    'gstrack loop'(it) {
      const from = it.evalInt()
      const to = it.accept('to') ? it.evalInt() : -1
      const mu = m()
      mu.loop = true
      mu.to = to
      mu.from = from
    },

    /**
     * Gstrack Loop Defer Pos1 To Pos2 — routine 24 ($2342), fourteen bytes:
     *
     *     move.l (a3)+, $10(a0)      Pos2 goes to the DEFERRED slot
     *     move.l (a3)+, $4(a0)       Pos1 goes in straight away
     *
     * so only the end is deferred, and the start does not need to be: nothing
     * reads Pos1 until the wrap that would have used the old end anyway. The
     * guide's *"the new limits will not be set until the current cycle has
     * finished"* is therefore true of both, by two different mechanisms.
     *
     * NOTE it does not touch $0, so `Gstrack Loop Off` still beats it.
     */
    'gstrack loop defer'(it) {
      const from = it.evalInt()
      it.expect('to')
      const to = it.evalInt()
      const mu = m()
      mu.defer = to
      mu.from = from
    },

    /**
     * Gstrack Gosub Pos1 | Pos1 To Pos2 — routines 22 ($230c) and 23 ($233a).
     * The one-argument form duplicates the top of the stack (`move.l (a3),d0 /
     * move.l d0,-(a3)`), so Pos2 becomes Pos1 and *"just this pattern will be
     * played"*.
     *
     * There is no return stack. It builds the return out of the loop fields:
     *
     *     sf.b   -$9d(a0)                 stop, so the next tick sees no song
     *     move.b -$a4(a0), d0
     *     move.l d0, $4(a0)               Pos1 := WHERE WE ARE
     *     move.l $8(a0), $10(a0)          the old end becomes the deferred one
     *     move.l (a3)+, $8(a0)            the jingle's end
     *     move.b d0, -$a4(a0)             jump to the jingle's start
     *     move.w #$0, -$9c(a0)
     *     st.b   -$9d(a0)                 and go
     *
     * So the jingle plays as a loop range, and the wrap at its end sends the
     * position back to where the main tune was and restores the old end from
     * the deferred slot. *"After which the module will return to wherever it
     * was beforehand"* — one level deep, and a second `Gstrack Gosub` inside a
     * jingle loses the outer return.
     */
    'gstrack gosub'(it) {
      const from = it.evalInt()
      const to = it.accept('to') ? it.evalInt() : from
      const mu = m()
      mu.replay.playing = false
      mu.from = mu.replay.pos & 0xff
      mu.defer = mu.to
      mu.to = to
      mu.replay.seek(from & 0x7f)
      mu.replay.playing = true
    },

    /**
     * Gstrack Transpose offset — routine 15 ($22b0), three instructions, and
     * the store is a `move.b`: the offset is kept as a BYTE, so ±127 and
     * anything past that wraps rather than saturating.
     *
     * *"This unique command allows you to change the pitch at which a module
     * replays [...] notes which are transposed beyond the legal range will be
     * put up or down an octave to fit."* The octave fixup is in
     * `../amiga/protracker.ts`'s `transposed`, along with what "to fit" does
     * not cover.
     */
    'gstrack transpose'(it) {
      m().replay.transpose = sw8(it.evalInt())
    },

    /**
     * Gstrack Volume level — routine 25 ($2350), and the store is a `move.w`.
     *
     * The player applies it with `mulu.w $1c32(pc), d0 / lsr.l #$6, d0`
     * ($157c) — a channel volume times this over 64 — which is the same
     * arithmetic `Protracker.master` already does for P61's master volume, so
     * it IS that field.
     *
     * *"Ranging from 0 to 64"*, and nothing checks: a larger level multiplies
     * past full volume and the replayer's own clamp is what stops it.
     */
    /**
     * Gsclosec2plib — routine 81 ($2780), and `L_CloseC2PLib` in the source.
     * `GSCleanupC2P` then `CloseLibrary`, both behind a `beq .dontbother`.
     */
    'gsclosec2plib'() {
      // no library open, so nothing to clean up and nothing to close
    },

    /**
     * Gsunloadcodemod n — routine 91 ($2910):
     *
     *     movea.l $4(a0, d0.w), a1 / movea.l $18(a1), a0 / jsr (a0)
     *     move.l (a0, d0.w), d1 / beq -> nothing
     *     move.l #$0, (a0, d0.w) / move.l #$0, $4(a0, d0.w)
     *     jsr -$9c(a6)                                     UnLoadSeg
     *
     * NOTE the order: the module's cleanup routine is called BEFORE the
     * emptiness test, so unloading a slot that holds nothing reaches
     * `movea.l $18(a1)` through a null header pointer. And nothing
     * range-checks `n`, whose index is `d0.w` — so a slot number above 8191
     * wraps rather than running off the table.
     *
     * DEVIATION: the cleanup routine is 68k code and there is no interpreter
     * here, so it is not called. See `Gscallmod`.
     */
    'gsunloadcodemod'(it) {
      const n = it.evalInt()
      const slot = ((n << 3) & 0xffff) >> 3
      const mods = rt.gamesupport.codemods
      if (slot < 0 || slot >= CODEMOD_SLOTS || !mods[slot]) return
      mods[slot] = null
    },

    /**
     * Gssetattr module, name$, value — routine 93 ($29fe).
     *
     * The arguments pop right to left: the value first, into $2aaa, then the
     * name, then the module. The lookup is `findAttr` over the ATTRIBUTE table
     * at `$20` of the module header, and a miss is error 7, *"attribute not
     * found"*. A hit stores the value as a LONGWORD at the entry's own start.
     */
    'gssetattr'(it) {
      const n = it.evalInt()
      it.expect(',')
      const name = it.evalStr()
      it.expect(',')
      const value = it.evalInt()
      const entry = attrEntry(rt, n, name, ATTR_TABLE)
      if (entry === 0) gsError(7)
      putL(rt, entry, value)
    },

    /**
     * Gscallmod module, name$ — routine 95 ($2b4e). The FUNCTION table at
     * `$1c`, not the attribute table at `$20`, and a miss is error 8,
     * *"function not found"*:
     *
     *     movea.l d0, a0 / movea.l (a0), a0 / jsr (a0)
     *
     * so an entry's first longword is a routine address and the call is
     * direct.
     *
     * DEVIATION: the only structural one in this extension. Everything
     * else GameSupport does is data, and this is 68k code: there is no
     * interpreter in this port, so a function that IS found cannot be run.
     * The lookup and its error are faithful; the call raises rather than
     * silently doing nothing, because a game whose module does the work would
     * otherwise carry on with the work undone.
     *
     * The five keywords around it need no interpreter — a module's tables are
     * read and written as plain memory — so this is the one that waits on a
     * 68k core rather than on anything of GameSupport's.
     */
    'gscallmod'(it) {
      const n = it.evalInt()
      it.expect(',')
      const name = it.evalStr()
      const entry = attrEntry(rt, n, name, FUNC_TABLE)
      if (entry === 0) gsError(8)
      throw new AmosError(`Gscallmod cannot run 68000 code: no interpreter for "${name}"`)
    },

    /**
     * Gssetc2pcolour index, colour — routine 83 ($27e8), `L_GSSetC2PPalette`:
     *
     *     move.l (a3)+, d0 / move.l (a3)+, d1        colour, then index
     *     move.l $62(a1), d2 / beq -> nothing        no info block
     *     move.w #$ffff, $18(a0)                     GSC2P_ColourMapDirty
     *     move.l $14(a0), d2 / beq -> nothing        GSC2P_ColourMap
     *     lsl.l #$2, d1 / move.l d0, (a0, d1.w)      one LONGWORD an entry
     *
     * The arguments pop right to left, which is how the second one reaches d0
     * and is the value. Nothing range-checks the index, and the displacement
     * is `d1.w`, so an index above 16383 wraps into the low 64K of the map
     * rather than running past it.
     */
    'gssetc2pcolour'(it) {
      it.evalInt()
      it.expect(',')
      it.evalInt()
      // no info block: `beq` before the map is even looked at
    },

    /**
     * Gssetc2pregion x1,y1 To x2,y2 — routine 84 ($2812), `L_GSC2PSetRegion`.
     *
     * Four pops, right to left, so d0 is y2 and d3 is x1, and they go to
     * `$c`/`$10`/`$a`/`$e` — Bottom, Right, Top and Left. Words, so a
     * coordinate above 65535 wraps.
     */
    'gssetc2pregion'(it) {
      it.evalInt()
      it.expect(',')
      it.evalInt()
      it.expect('to')
      it.evalInt()
      it.expect(',')
      it.evalInt()
      // `move.l $62(a0), d4 / beq` — no info block, so none of it is stored
    },

    /**
     * Gsc2pdebug — routine 86 ($2846), four instructions:
     *
     *     movea.l $258(a5), a0
     *     movea.l $62(a0), a0        the info block
     *     not.w   $1a(a0)            GSC2P_DebugMode, toggled
     *
     * **There is no zero check**, and `L_GSC2PDebug` in the source has none
     * either — every other C2P routine guards `$62` and this one does not. With
     * no library open the block pointer is zero, so on the machine this is
     * `not.w $1a` against absolute address $1a: the low word of exec's CHK
     * exception vector, flipped. The port has no region there, so the write
     * lands nowhere and the toggle is observably nothing; it is written as a
     * real attempt rather than skipped, because the defect is the point.
     */
    'gsc2pdebug'() {
      const m = rt.resolveWrite(C2P_DEBUGMODE)
      if (!m || m.off + 1 >= m.data.length) return
      m.data[m.off] = ~m.data[m.off]! & 0xff
      m.data[m.off + 1] = ~m.data[m.off + 1]! & 0xff
    },

    'gstrack volume'(it) {
      const v = it.evalInt() & 0xffff
      // `fadeTo` as well as `master`: P61's fade walks one toward the other
      // every tick, and this player has no fade at all --- it reads the field
      // straight. Leaving the target behind would make the level drift back.
      m().replay.master = v
      m().replay.fadeTo = v
    },
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

/** `move.b dn, <ea>` then read back signed — the transpose is kept as a byte */
const sw8 = (v: number): number => (v << 24) >> 24

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
     * =Gscmd8data — routine 14 ($229c), five instructions:
     *
     *     movea.l $258(a5), a2
     *     moveq  #$0, d3
     *     move.w -$96(a2), d3        the mailbox, zero-extended
     *     move.w #$0, -$96(a2)       and cleared BY THE READ
     *
     * *"The word will be cleared only when it is read, so this function should
     * be called fairly frequently."* Read-to-clear is the whole protocol:
     * every bit the module has set since the last call arrives at once, and a
     * program that reads twice in a frame gets the second answer empty.
     *
     * The bits are set by command `8tb` in the module — see `command8` in
     * `../amiga/protracker.ts`. Plain ProTracker ignores command 8 entirely,
     * which is what makes it free to use: *"This command has no effect in
     * ProTracker, and is very useful for synchronising graphical lightshows
     * with music."*
     */
    /**
     * =Gsopenc2plib(name$) — routine 80 ($2714), and `L_OpenC2PLib` in the
     * source, which is one of the few things `GameSupport.s` does carry whole:
     *
     *     move.w (a0)+, d7 / subq.w #$1, d7 / bmi -> 0    an EMPTY name fails
     *     lea $157(a1), a2 / copy the string / terminate
     *     lea $147(a1), a1 / OpenLibrary
     *     move.l d0, $5e(a1) / beq -> 0
     *     jsr -$2a(a6)  -> $62(a1)     GSGetC2PInfo
     *     jsr -$1e(a6)                 GSInitialiseC2P, and its result IS the
     *                                  answer
     *
     * $147 holds `"GSChunky2Planar/"`, exactly sixteen characters, and $157 is
     * where the caller's string is appended — so `Gsopenc2plib("Fast")` opens
     * `GSChunky2Planar/Fast`. The name is a MODULE and not a version.
     *
     * ## Why all seven of these answer "no library"
     *
     * The whole C2P block is a shim over `GSDrivers/` modules that were never
     * released. The guide's Modules node describes the scheme in the future
     * tense — *"Several of GameSupport's major features are (read: will be!)
     * `subcontracted' to a separate module"*, with ChunkyToPlanar listed under
     * "Modules planned so far" — and no such library is in the archive.
     *
     * So this is the same situation as `Gscontrollertype`'s driver, and the
     * same verdict: the not-open arm is what every real machine ran, every
     * routine has one, and none of them raise. The seven are complete, not
     * stubbed. `src/amiga/planar.ts` is NOT wired in behind them: it is this
     * port's own chunky/planar conversion, not Robinson's module, and pointing
     * one at the other would invent a library rather than model one.
     *
     * The one routine with no such arm is `Gsc2pdebug`, and that is a defect
     * rather than a difference — see it below.
     */
    /**
     * =Gsloadcodemod(file$) — routine 90 ($2854), 188 bytes:
     *
     *     lea $7a(a1), a1 / moveq #$f, d7
     *     move.l (a1), d0 / beq -> free slot / lea $8(a1), a1 / dbra
     *     moveq #$6, d0 -> error 6                  every slot taken
     *     move.w (a0)+, d0 / subq.w #$1, d0
     *     cmp.w #$80, d0 / bge -> AMOS error $17    a name of 129 or more
     *     ...copy into $50a(a5), L_Dsk_PathIt, LoadSeg...
     *     move.l d0, (a0, d1.w) / beq -> AMOS error $17
     *     lsl.l #$2, d0 / movea.l d0, a1             BPTR to address
     *     moveq #$f, d7
     *     lea $2(a1), a1 / cmpi.l #$47534d6f, (a1) / beq / dbra
     *     move.l a1, $4(a0, d1.w)
     *     movea.l $14(a1), a0 / jsr (a0)             the module's init
     *
     * $47534d6f is `"GSMo"`. **The scan has no failure exit**: `dbra` falls
     * straight through into the found path, so a file that loads but is not a
     * GSMod has its header pointer set thirty-two bytes into the segment and
     * the `jsr` goes into whatever is there. That is a defect, not a check —
     * only a file that fails to LOAD raises.
     *
     * The AMOS error is 23 for both a name too long and a load that failed;
     * error 6, *"too many code modules"*, is the extension's own.
     *
     * DEVIATION: the init routine is 68k code and is not called. See
     * `Gscallmod` for why that is the one thing here a 68k core would fix.
     */
    'gsloadcodemod'(_, a): Value {
      const name = str(a[0]!)
      const mods = rt.gamesupport.codemods
      const slot = mods.findIndex((s) => s === null)
      if (slot < 0) gsError(6)
      // `move.w (a0)+,d0 / subq.w #$1,d0 / cmp.w #$80,d0 / bge`
      if (name.length - 1 >= 0x80) throw new AmosError('Illegal function call', 23)
      const bytes = rt.fs?.read(name)
      if (!bytes) throw new AmosError('Illegal function call', 23)
      const base = CODEMOD_BASE + slot * CODEMOD_SLOT
      let image: Uint8Array
      try {
        image = loadHunks(bytes, base).image
      } catch {
        throw new AmosError('Illegal function call', 23)
      }
      // the magic scan: sixteen tries, two bytes apart, and no way to fail
      let header = 0
      for (let i = 1; i <= 16; i++) {
        header = i * 2
        if (
          image[header] === 0x47 &&
          image[header + 1] === 0x53 &&
          image[header + 2] === 0x4d &&
          image[header + 3] === 0x6f
        ) {
          break
        }
      }
      mods[slot] = { image, base, header }
      return VI(slot)
    },

    /**
     * =Gsgetattr(module, name$) — routine 92 ($295e), and
     * =Gsfindattr(module, name$) — routine 94 ($2aae).
     *
     * The same lookup and the same error 7; the only difference is what comes
     * back. `Gsgetattr` dereferences the entry (`move.l (a0), d3`) and answers
     * the VALUE; `Gsfindattr` answers the entry's ADDRESS, which is what a
     * program pokes through to change one without a second lookup.
     */
    'gsgetattr'(_, a): Value {
      const entry = attrEntry(rt, int(a[0]!), str(a[1]!), ATTR_TABLE)
      if (entry === 0) gsError(7)
      return VI(getL(rt, entry) | 0)
    },
    'gsfindattr'(_, a): Value {
      const entry = attrEntry(rt, int(a[0]!), str(a[1]!), ATTR_TABLE)
      if (entry === 0) gsError(7)
      return VI(entry | 0)
    },

    /**
     * =Gsiconify(IconText$) and =Gsiconify(IconText$, IconPath$) — routines 8
     * ($207a) and 7 ($1f18), 294 and 354 bytes and the same shape. *"This
     * routine will create a workbench AppIcon. This function needs at least
     * workbench 2 to work."*
     *
     *     tst.l $56(a2) / beq -> 1          workbench.library
     *     tst.l $5a(a2) / beq -> 1          icon.library
     *     jsr -$29a(a6)                     exec CreateMsgPort -> $2a
     *     tst.l d0 / beq -> 1
     *     ...the icon...
     *     jsr -$3c(a6)                      AddAppIconA(0, 0, text, port,
     *                                         NULL, diskobj, NULL) -> $22
     *     jsr -$180(a6)                     exec WaitPort — IT BLOCKS HERE
     *     Forbid / GetMsg / ReplyMsg / Permit
     *     jsr -$42(a6)                      RemoveAppIcon
     *     DeleteMsgPort / FreeDiskObject
     *     moveq #$0, d3
     *
     * The icon is where the two forms differ. One argument takes
     * `GetDefDiskObject(WBTOOL)` — `move.l #$3, d0`, and 3 is WBTOOL, so the
     * default TOOL icon and not the project one. Two arguments copy the path
     * into AMOS's buffer at `$50a(a5)`, run it through `Dsk_PathIt`, and call
     * `GetDiskObject`, then force `do_CurrentX` and `do_CurrentY` ($3a/$3e) to
     * $80000000 — NO_ICON_POSITION, so Workbench places it rather than putting
     * it wherever the .info happened to say.
     *
     * The guide explains why it is a function rather than an instruction:
     * *"This function will not handle errors in the normal way, since this
     * could leave the workbench screen at the front, and the user with no idea
     * why. That's why Gsiconify is implemented as a function; the returned
     * value will be 0 if the icon is double-clicked on, and 1 if an error
     * occurred."* Every failure arm returns 1 and none of them raise.
     *
     * DEFECT: it survived the fix that was made for its sibling. The label
     * is passed as `movea.l $1e(a2), a0 / lea $2(a0), a0` — an AMOS string's
     * characters, with NO terminator — straight to `AddAppIconA`. The guide's
     * BugsFixed node records the same mistake being fixed for the icon PATH
     * (*"I forgot that AMOS strings aren't null terminated!"*), and the path is
     * indeed copied and `clr.b`-terminated in routine 7. The text is not, so
     * the icon's label runs on past the string into whatever the AMOS string
     * heap holds next.
     *
     * ## Why this port answers 1
     *
     * `workbench.library` is not modelled and neither is `icon.library`'s
     * AppIcon half — `../amiga/icon.ts` is the `.info` FILE FORMAT, which is a
     * different thing. `../amiga/exec.ts`'s own list makes the argument for
     * leaving them out: *"Listing them would be claiming a back-end that does
     * not exist; leaving them out makes OpenLibrary answer 0, which is the
     * case [the extension] already handles and reports in its own words."*
     *
     * So this takes the first arm, which is a real machine without Workbench
     * 2, and is exactly what the routine does there. What would make the other
     * arm reachable is `AddAppIconA`/`RemoveAppIcon` on the Workbench screen
     * `../amiga/intuition.ts` already opens, plus a blocking `WaitPort` — this
     * is the one keyword in the extension that suspends the program until the
     * user acts, which EasyLife's `Eliconify Test` deliberately does not
     * (it polls). Neither is GameSupport's to provide.
     */
    'gsiconify'(_, a): Value {
      void str(a[0]!)
      // the second form's path is never reached: the library test comes first
      if (a.length > 1) void str(a[1]!)
      const st2 = rt.gamesupport
      if (!st2.workbench || !st2.icon) return VI(1)
      // unreachable while neither library is modelled, and deliberately not
      // faked: there is no AppIcon to add and no port to wait on
      return VI(1)
    },

    'gsopenc2plib'(_, a): Value {
      // the name is copied and the library opened whatever it says; with none
      // installed the `beq` after OpenLibrary is the arm every call takes
      void str(a[0]!)
      return VI(0)
    },

    /**
     * =Gschunky2planar — routine 82 ($27b2), `L_C2PGo`: `GSGoC2P` on the open
     * library, or 0. It takes no argument; the region and the palette are set
     * beforehand and the conversion reads them out of the info block.
     */
    'gschunky2planar'(): Value {
      return VI(0)
    },

    /**
     * =Gsc2pinfo — routine 85 ($283a), two instructions: the info block
     * pointer as it stands. Zero until a library opens, which is the address a
     * caller would then peek the structure through.
     */
    'gsc2pinfo'(): Value {
      return VI(0)
    },

    'gscmd8data'(): Value {
      const r = st().music.replay
      const v = r.cmd8 & 0xffff
      r.cmd8 = 0
      return VI(v)
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
