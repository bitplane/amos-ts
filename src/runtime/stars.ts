/**
 * Stars 2.33 (shareware) — an interrupt-driven starfield and three copper-list
 * keywords, by Jason G. Doig, 1993. Eleven keywords at slot 20.
 *
 * Evidence: `Stars.doc` (the archive's own manual) plus every routine in the
 * 7,492-byte code hunk disassembled with `extdis stars-2.33`. Where the two
 * disagree the binary wins, and all three disagreements are recorded below.
 *
 * `stars.lib` (AMOS 1.3) and `starspro.lib` (AMOS Pro) are different binaries
 * — different sizes, different hashes — carrying a byte-identical token table,
 * so one port serves both and there is no version fork to settle.
 *
 * ## What the extension is
 *
 * A VBL server ($1ca) that erases last frame's stars, plots this frame's, and
 * then moves them. Everything lives in the extension's own data block at
 * $228(a5); the fields this port reproduces are, at their original offsets:
 *
 *   $08   the PRNG state          $1a   direction 0-4
 *   $0a   width  * 64             $1c   star count, 0 = off
 *   $0c   height * 64             $1e   how many were plotted last frame
 *   $0e   -> the screen's slot    $220  x, 128 words of 10.6 fixed point
 *   $12   width, $14 height       $320  y, the same
 *   $16   last frame's plane      $20   the addresses plotted, for the erase
 *
 * Three details of the plotting are what the doc's warning is about — "these
 * plot not in a specific colour, but straight onto the last bitplane of a
 * screen, so please try to keep this clear or it will get corrupted":
 *
 *  1. **The last bitplane only**, index `(depth - 1) & 7` ($21c-$226).
 *  2. **OR, never a replace** (`or.w d3,(a2)` at $29e), so a star can only
 *     ever set bits.
 *  3. **The erase writes a WORD of zero** (`move.w #$0,(a1)` at $24a) at each
 *     address it remembered. It does not clear the star's bit — it clears the
 *     whole 16-pixel word around it. That is the corruption the doc warns of,
 *     and it is faithfully reproduced.
 *
 * The erase is skipped when the plane address has changed since last frame
 * ($230), which is what stops a `Screen Swap` from having last frame's star
 * positions punched out of the buffer that just came forward.
 *
 * ## Speed is derived from the star's index
 *
 * The movement loop counts DOWN from `count - 1` while walking the arrays UP,
 * and takes the speed from the counter: `((i & 7) + 1) * 64`, i.e. one to
 * eight pixels a frame ($306-$310, and identically in all four directions).
 * So the star at array index k moves at `((count - 1 - k) & 7) + 1` pixels,
 * and a field of 128 stars is eight interleaved parallax layers. Nothing in
 * the manual mentions this; it is the whole visual effect.
 *
 * ## The starfield switches itself off
 *
 * Every frame the server re-reads the screen through the slot pointer it saved
 * ($1fc-$218). If the screen has been closed, or if its width/height long no
 * longer matches the one `Stars On` recorded, it sets count and plotted to
 * zero and stops. So closing or resizing the screen under a live starfield is
 * defined behaviour, not a crash.
 *
 * ## Where this port departs from the binary
 *
 * DEVIATION: `Stars Reset` is a hard machine reset in the original — twelve
 * bytes that read the initial PC out of the Kickstart header at $F80000+4 and
 * jump to it ($1892). There is no machine to reboot here and no way to be
 * faithful to one, so it ends the program, which is what `System` and `Edit`
 * do with AMOS's own "leave now" keywords. It is undocumented, so no program
 * can have been relying on the reboot in a way the manual sanctioned.
 *
 * DEVIATION: `Stars Vbl` is documented as "the same as Wait Vbl, but shows
 * idle processor time", and does it by busy-looping on COLOR00 between $000
 * and $800 until the VBL server clears its flag ($18b6-$18c6). The colour bar
 * measures how long the 68k spends inside that loop, which is a property of
 * the host's speed rather than of the program; this port waits for the vertical
 * blank and draws no bar.
 *
 * DEFECT: `Cop True Palette` computes its FIRST colour register with
 * `lsl.w #4,d3` where `Cop Palette` uses `lsl.w #1,d3` ($1ae8 against $1a40;
 * confirmed byte-for-byte as `E94B` against `E34B`). A register offset is the
 * index doubled, so the 24-bit form is right only when `a` is 0 and otherwise
 * starts sixteen registers per index along, wrapping inside the bank. Every
 * colour after the first is still consecutive, because the loop advances by 2.
 * Reproduced, because a program written against the extension was written
 * against this.
 *
 * ## What the shareware build left out
 *
 * The doc says the full version adds `Cop Screen` and `Stars Rain`. `Stars
 * Rain` is genuinely absent from the token table. `Cop Screen` is NOT — it has
 * a token, and 204 bytes at $1bd8 that pop all eight parameters, range-check
 * every one of them, store them into a static block at $1c92, and then return
 * having emitted nothing at all. So it validates and does nothing, and this
 * port does the same. `Stars Wibble` got the same treatment with less left
 * over: six bytes, `move.l a4,-(a7) / movea.l (a7)+,a4 / rts`, a prologue and
 * an epilogue with the body gone. It is a no-op that must still exist, because
 * the keyword dispatches and the original raises no error.
 *
 * Every bounds failure in the extension reaches one error, routine 15, whose
 * message is inline at $1cc2: "Duff Programmer Error - Don't Give Up The Day
 * Job." AMOS has no error number for that, so this port raises its own
 * illegal-function-call, and the joke is recorded here rather than lost.
 */
import type { Runtime } from './runtime'
import type { Func, Instr } from '../interp/builtins'
import { funcCall, type Value, VI } from '../interp/values'

/** the 68k raises one error for every bad argument; see the module note */
const duff: () => never = () => {
  funcCall()
}

/** $220/$320 are 128 words each — the count is checked against this */
const MAX_STARS = 128

/** the fixed-point shift: `lsl.w #$6` on every coordinate ($1a4/$310) */
const FIX = 6

export interface StarsState {
  /** $1c: how many stars are running; 0 is off */
  count: number
  /** $1e: how many were plotted last frame, so the erase knows what to undo */
  plotted: number
  /** $1a: 0 left, 1 right, 2 up, 3 down, 4 stationary */
  dir: number
  /** the screen `Stars On` was given; -1 when nothing is running */
  screen: number
  /** $12/$14: the geometry recorded at Stars On, re-checked every frame */
  width: number
  height: number
  /** $220/$320: 10.6 fixed point, and genuinely 16-bit — the 68k stores words */
  x: Uint16Array
  y: Uint16Array
  /**
   * $20: the byte offsets plotted last frame. The original stores absolute
   * addresses; an offset into the plane is the same thing without an address
   * space, and it is what the erase needs.
   */
  spots: Int32Array
  /**
   * $16: the plane the stars went into last frame. The original compares the
   * plane POINTER; the equivalent here is the identity of the BitMap, which
   * `Screen Swap` exchanges (screen.ts: `swap` assigns `rp.bitMap`).
   */
  lastPlanes: Uint8Array | null
  /** $8: the PRNG state, which survives between calls */
  seed: number
}

export function newStarsState(): StarsState {
  return {
    count: 0,
    plotted: 0,
    dir: 0,
    screen: -1,
    width: 0,
    height: 0,
    x: new Uint16Array(MAX_STARS),
    y: new Uint16Array(MAX_STARS),
    spots: new Int32Array(MAX_STARS),
    lastPlanes: null,
    seed: 0,
  }
}

/**
 * The PRNG at $19ca:
 *
 *     move.w  $8(a4),d0 / addi.w #$3571,d0 / eori.w #$7612,d0
 *     add.w   $dff006,d0 / move.w d0,$8(a4)
 *
 * $dff006 is VHPOSR, the raster beam position, so on the real machine the
 * placement of a starfield depended on exactly when in the frame `Stars On`
 * ran. We model the beam, so the same input is available and the sequence is
 * reproduced rather than approximated — it simply becomes repeatable, which
 * the hardware's was not.
 */
function nextRandom(rt: Runtime, st: StarsState): number {
  let d0 = st.seed & 0xffff
  d0 = (d0 + 0x3571) & 0xffff
  d0 ^= 0x7612
  d0 = (d0 + rt.interp.beamWord()) & 0xffff
  st.seed = d0
  return d0
}

/**
 * `while (v >= limit) v -= limit` — the original's modulo, done by repeated
 * subtraction ($1998 and $19b0). Written the same way because `limit` can be
 * zero for a degenerate screen and the 68k would loop forever there too; the
 * guard is ours, and it is the only way to return at all.
 */
function reduce(v: number, limit: number): number {
  if (limit <= 0) return 0
  return v % limit
}

/** one byte through the AMOS address space, as `Peek` reads it */
function peek(rt: Runtime, a: number): number {
  const m = rt.resolveAddr(a)
  return m && m.off < m.data.length ? m.data[m.off]! : 0
}

/** one big-endian word, as `Deek` reads it */
function deek(rt: Runtime, a: number): number {
  const m = rt.resolveAddr(a)
  return m && m.off + 1 < m.data.length ? (m.data[m.off]! << 8) | m.data[m.off + 1]! : 0
}

/** the last bitplane's byte offset within the contiguous plane block */
function lastPlaneOffset(depth: number, planeSize: number): number {
  // `(depth-1)*4 & $1c` at $220-$226 — a plane index capped to 0..7
  return (((depth - 1) & 7) >>> 0) * planeSize
}

/**
 * The VBL server ($1ca), minus the AGA register housekeeping it does first
 * (BPLCON3 = $c00, BPLCON4 = $11, FMODE = 0, all of which the display owns
 * here) and minus the `Stars Vbl` handshake, which is a blocked wait rather
 * than a pair of flags.
 *
 * Order matters and is the original's: erase, plot, then move. A frame's
 * stars are therefore visible where they were computed on the PREVIOUS frame.
 */
export function starfieldVbl(rt: Runtime): void {
  const st = rt.stars
  if (st.count <= 0) return

  // $1fc: re-read the screen through the saved slot; a closed screen or a
  // changed size stops the field ($3c6)
  const s = rt.screens.get(st.screen)
  if (!s || s.width !== st.width || s.height !== st.height) {
    st.count = 0
    st.plotted = 0
    st.lastPlanes = null
    return
  }

  const bm = s.rp.bitMap
  const planes = bm.planeBytes(true)
  const base = lastPlaneOffset(bm.depth, bm.planeSize)
  const limit = base + bm.planeSize

  // $230: only erase into the plane we actually plotted into
  if (st.lastPlanes === planes) {
    for (let i = 0; i < st.plotted; i++) {
      const off = st.spots[i]!
      // the word, not the bit — see the module note
      if (off >= base && off + 1 < limit) {
        planes[off] = 0
        planes[off + 1] = 0
      }
    }
  }
  st.lastPlanes = planes

  // $252: plot
  for (let k = 0; k < st.count; k++) {
    const px = (st.x[k]! >>> FIX) & 0x7ff
    const py = (st.y[k]! >>> FIX) & 0x7ff
    const off = base + py * bm.bytesPerRow + (px >> 4) * 2
    st.spots[k] = off
    if (off + 1 < limit) {
      const mask = 0x8000 >>> (px & 15)
      planes[off] = planes[off]! | ((mask >> 8) & 0xff)
      planes[off + 1] = planes[off + 1]! | (mask & 0xff)
    }
  }
  st.plotted = st.count

  // $2ba: move
  moveStars(st)
}

/**
 * $2ba's four branches. Direction 4 matches none of the four `cmpi.w`s and
 * falls through to the `rts` at $2b8, which is how "stationary" is spelled.
 */
function moveStars(st: StarsState): void {
  const wFix = (st.width << FIX) & 0xffff
  const hFix = (st.height << FIX) & 0xffff
  for (let k = 0; k < st.count; k++) {
    // the descending loop counter, which is where the speed comes from
    const speed = (((st.count - 1 - k) & 7) + 1) << FIX
    switch (st.dir) {
      case 0: {
        // sub.l then bpl: a word value goes negative as a long, so the wrap
        // is a plain signed test ($312-$318)
        const v = st.x[k]! - speed
        st.x[k] = v >= 0 ? v : v + wFix
        break
      }
      case 1: {
        const v = (st.x[k]! + speed) & 0xffff
        st.x[k] = v >= wFix ? v - wFix : v
        break
      }
      case 2: {
        const v = st.y[k]! - speed
        st.y[k] = v >= 0 ? v : v + hFix
        break
      }
      case 3: {
        const v = (st.y[k]! + speed) & 0xffff
        st.y[k] = v >= hFix ? v - hFix : v
        break
      }
      default:
        break // 4 = stationary
    }
  }
}

export function makeStarsInstructions(rt: Runtime): Record<string, Instr> {
  /**
   * The copper-register address for colour `n`, and the AGA bank select that
   * has to precede it. `Cop Palette` and `Cop True Palette` both address
   * $180..$1BE — one bank of 32 — and reach the other 224 registers by
   * writing the bank into BPLCON3 ($106) whenever the address wraps back to
   * $180 ($1aa4, $1bac).
   */
  const bankSelect = (index: number): void => {
    rt.copMove(0x106, ((index << 8) | 0xc00) & 0xffff)
  }

  /** the shared body of the two palette builders */
  const palette = (from: number, to: number, first: number, colour: (i: number) => number, loct: boolean): void => {
    let reg = first
    let index = from
    if (loct) {
      // pass two writes the low nibbles, which AGA reaches through LOCT
      if (reg !== 0x180) rt.copMove(0x106, ((index << 8) | 0xe00) & 0xffff)
    } else if (reg !== 0x180) bankSelect(index)
    for (let i = 0; i <= to - from; i++) {
      if (reg === 0x180) {
        if (loct) rt.copMove(0x106, ((index << 8) | 0xe00) & 0xffff)
        else bankSelect(index)
      }
      rt.copMove(reg, colour(i))
      reg += 2
      if (reg === 0x1c0) reg = 0x180
      index++
    }
  }

  return {
    'stars blast'() {
      // routine 3 ($181a). Eight passes; each pass shifts every EVEN row's
      // bytes left by one and every ODD row's right by one, with the masks
      // $fefefefe / $7f7f7f7f stopping a bit crossing into the next byte.
      // After eight the plane holds nothing, which is the "fancy fade".
      const s = rt.screen
      const bm = s.rp.bitMap
      const planes = bm.planeBytes(true)
      const rowLongs = bm.bytesPerRow >> 2
      for (let pass = 0; pass < 8; pass++) {
        for (let p = 0; p < bm.depth; p++) {
          const plane = p * bm.planeSize
          for (let row = 0; row < bm.height; row++) {
            const at = plane + row * bm.bytesPerRow
            const left = (row & 1) === 0
            for (let l = 0; l < rowLongs; l++) {
              const o = at + l * 4
              for (let b = 0; b < 4; b++) {
                const v = planes[o + b]!
                planes[o + b] = left ? (v << 1) & 0xfe : (v >> 1) & 0x7f
              }
            }
          }
        }
      }
      bm.invalidate()
    },
    'stars reset'(it) {
      // routine 4 ($1892) — see the DEVIATION in the module note. The
      // original jumps through the Kickstart reset vector; the program ends.
      it.halt('ended')
      return 'jumped'
    },
    'stars vbl'(it) {
      // routine 5 ($189e): a Wait Vbl that draws a CPU-load bar in COLOR00.
      // The wait is reproduced, the bar is not — see the DEVIATION above.
      it.block({ type: 'wait', until: Math.floor(it.tick) + 1 })
    },
    'stars on'(it) {
      // routine 6 ($18d8). Stars On screen,direction,number
      const screen = it.evalInt()
      it.expect(',')
      const dir = it.evalInt()
      it.expect(',')
      const num = it.evalInt()
      const st = rt.stars

      // the field stops before anything is validated ($18e6)
      st.count = 0

      // screen 0..7, and it must be open ($18ec-$1906)
      if (screen < 0 || screen >= 8) duff()
      const s = rt.screens.get(screen)
      if (!s) duff()
      // direction 0..4 ($1918-$1924), stored before the count is checked
      if (dir < 0 || dir >= 5) duff()
      st.dir = dir
      // 1..128 ($192c-$193c)
      if (num <= 0 || num > MAX_STARS) duff()

      st.screen = screen
      st.width = s.width
      st.height = s.height
      st.plotted = 0
      st.lastPlanes = null

      // $1980: place all 128, not just `num` of them
      for (let k = 0; k < MAX_STARS; k++) {
        st.x[k] = reduce(nextRandom(rt, st) & 0x3ff, s.width) << FIX
        st.y[k] = reduce(nextRandom(rt, st) & 0x1ff, s.height) << FIX
      }
      st.count = num
    },
    'stars off'() {
      // routine 7 ($19e2): clears the count and nothing else, so the stars
      // already on the screen stay there until something overwrites them
      rt.stars.count = 0
    },
    'stars wibble'() {
      // routine 8 ($19f2): a prologue and an epilogue with no body. See the
      // module note — it exists, it dispatches, it does nothing.
    },
    'stars dir'(it) {
      // routine 9 ($19f8): 0..4, the same field Stars On writes
      const d = it.evalInt()
      if (d < 0 || d >= 5) duff()
      rt.stars.dir = d
    },
    'cop palette'(it) {
      // routine 10 ($1a1c). Cop Palette a To b,address — 12-bit colours, one
      // word each, straight out of memory.
      const from = it.evalInt()
      it.expect('to')
      const to = it.evalInt()
      it.expect(',')
      const addr = it.evalInt() & ~1
      if (to < from) duff() // $1a28
      if (to >= 0x100) duff() // $1a36, a word compare here
      palette(from, to, ((from << 1) & 0x3f) + 0x180, (i) => deek(rt, addr + i * 2), false)
      // $1a74: hand the bank back to 0 on the way out
      rt.copMove(0x106, 0xc40)
    },
    'cop true palette'(it) {
      // routine 11 ($1aba). The 24-bit form: two passes over the same bytes,
      // high nibbles into the colour registers and low nibbles behind LOCT.
      const from = it.evalInt()
      it.expect('to')
      const to = it.evalInt()
      it.expect(',')
      const addr = it.evalInt() & ~1
      if (from < 0) duff() // $1acc
      if (to >= 0x100) duff() // $1ad4, a long compare against d4 here
      if (to < from) duff() // $1adc
      const rgb = (i: number): [number, number, number] => [
        peek(rt, addr + i * 3),
        peek(rt, addr + i * 3 + 1),
        peek(rt, addr + i * 3 + 2),
      ]
      // the DEFECT: `lsl.w #4` where Cop Palette has `lsl.w #1`
      const first = ((from << 4) & 0x3f) + 0x180
      palette(
        from,
        to,
        first,
        (i) => {
          const [r, g, b] = rgb(i)
          return (((r >> 4) & 0xf) << 8) | (((g >> 4) & 0xf) << 4) | ((b >> 4) & 0xf)
        },
        false,
      )
      palette(
        from,
        to,
        first,
        (i) => {
          const [r, g, b] = rgb(i)
          return ((r & 0xf) << 8) | ((g & 0xf) << 4) | (b & 0xf)
        },
        true,
      )
      rt.copMove(0x106, 0xc40) // $1b88
    },
    'cop screen'(it) {
      // routine 12 ($1bd8): eight parameters, validated and then dropped on
      // the floor. See the module note — the body is a full-version feature
      // the shareware build does not have.
      const p: number[] = []
      for (let i = 0; i < 8; i++) {
        if (i > 0) it.expect(',')
        p.push(it.evalInt())
      }
      // $1c16-$1c42: all eight must be positive
      for (const v of p) if (v < 0) duff()
      // $1c50-$1c88, in the order the 68k pops them (the last parameter first)
      if (p[6]! >= 0x801) duff()
      if (p[5]! >= 0x201) duff()
      if (p[4]! >= 0x201) duff()
      if (p[3]! >= 9) duff()
      if (p[2]! >= 3) duff()
      if (p[1]! >= 4) duff()
    },
  }
}

export function makeStarsFunctions(rt: Runtime): Record<string, Func> {
  return {
    'cop current'(): Value {
      // routine 13 ($1ca4): `move.l -$804(a5),d3` — AMOS's copper build
      // pointer, exactly where Cop Move would put its next word
      return VI((rt.copLogicAddr() + rt.copPos) | 0)
    },
  }
}
