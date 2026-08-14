/**
 * TFT 0.6 — a small third-party extension by Turgut Temucin ("TFT", G.O.D
 * Section Berlin), dated 4.7.1997. Twenty-two keywords in 5,480 bytes of code.
 *
 * ## Evidence
 *
 * `AMOSPro_tft.Lib`, disassembled end to end — it is small enough to read
 * whole rather than routine by routine. `TFT_Extension.doc` is a syntax list
 * and nothing more: the author says so himself ("Da ich schriftlich nicht so
 * besonders fit bin. Liegt momentan nur der anfang des Doc Files vor"), and
 * everything after the command overview is empty separator blocks he never
 * filled in. What the prose omits, the eight demos in `demo/` supply — their
 * comments are where the semantics actually live, and they are cited below
 * the way the manual would be for a documented library.
 *
 * The doc does fix the slot: "In der Interpreter Config muss dann auf Platz
 * 25 `AMOSPro_tft.lib` eingetragen werden."
 *
 * ## The workspace
 *
 * Every routine reaches its state through `$278(a5)`, which is this
 * extension's own data pointer rather than anything of AMOS's — LDos at slot
 * 10 uses `$188(a5)`, and (25-10)*16 = $F0 = $278-$188, so it is the per-slot
 * extension data pointer with 16 bytes per slot. The fields, from the
 * routines that touch them:
 *
 *   +$00          the interrupt-enabled flag (Start Int / Stop Int)
 *   +$04, +$0c..  the bitplane-scroll table Init Bpl Scroll copies in
 *   +$08, +$0a    mouse X and Y, sampled by the interrupt
 *   +$2c          non-zero once Init Bpl Scroll has run; Start Int needs it
 *   +$34          a busy flag; routine 16 raises error 3 while it is set
 *   +$38+(n-1)*8  timer n's counter
 *   +$3c+(n-1)*8  timer n's running flag
 *   +$60, +$106, +$10a  the message table Tft Error$ reads
 *   +$132, +$13a  the Cpu Clear routine pointer and its table
 *
 * Two helpers have no keyword, so they have no name in the map and were
 * decoded by hand from $8c0: routine 15 bounds-checks a timer number to 1..5
 * (error 4), and routine 16 raises error 3 if +$34 is set.
 *
 * ## The errors, and why their wording is this port's
 *
 * The library raises 3, 4, 5, 6, 10, 11 and 12 — and contains no message text
 * for any of them. The only strings in the whole binary are its own token
 * table. `Tft Error$` exists precisely because of that gap: its demo explains
 * that "die Error$ Funktion giebt leider keine Text meldungen aus, wenn der
 * fehler von einer Extension verursacht wird" — AMOS's own Error$ says
 * nothing for an extension's errors — and it reads a per-extension message
 * table that TFT never shipped. So there is no authentic wording to use, and
 * the messages below are descriptive text of this port's own. NOTE'd rather
 * than passed off as the library's.
 */
import { AmosError, VI, VS, int } from '../interp/values'
import type { Func, Instr } from '../interp/builtins'
import { elapsedTime } from '../amiga/lowlevel'
import { libraryPresent } from '../amiga/exec'
import { sw16 } from './word'
import type { Runtime } from './runtime'

/**
 * The E clock reading `elapsedTime` measures against, in 1/65536 of a second.
 *
 * The vertical blank counter at PAL 50 Hz, which is the same source
 * GameSupport's `Gstimer` uses. See ../amiga/lowlevel.ts for what it costs.
 */
const tftTicks = (rt: Runtime): number => Math.floor((rt.interp.tick * 65536) / 50)

/** one bitplane of a 320-pixel screen, 200 lines — `adda.w #$1f40` at $b2a */
const NTSC_BYTES = 0x1f40
/** and 256 lines — `adda.w #$2800` at $e8a */
const PAL_BYTES = 0x2800
/**
 * Both clear routines refuse an END address at or below this, "um das
 * versehentliche loeschen des Boot bereichs zu verhindern" — to stop the boot
 * area being wiped by accident (cpu_clear.amos).
 */
const LOW_LIMIT = 0x1000

export interface TftState {
  /** +$00 — armed by Start Int, cleared by Stop Int */
  intOn: boolean
  /** +$2c — Init Bpl Scroll has installed its table */
  scrollReady: boolean
  /** +$34 — the flag routine 16 tests; nothing in the keyword set sets it */
  busy: boolean
  /** +$38 and +$3c, five of them, counting VBLs upward while running */
  timers: { count: number; running: boolean }[]
  /**
   * 0.7 only: what `Init Cpu Clear Long` left at +$132, +$136, +$13a and
   * +$13e. Null while +$132 is zero, which is what `Cpu Clear` tests.
   */
  cpuClear: { size: number; total: number; modulo: number } | null
  /** 0.7 only: +$19c, lowlevel.library's base, and +$188, the EClockVal */
  lowlevel: boolean
  clock: { last: number }
}

export const newTftState = (): TftState => ({
  intOn: false,
  scrollReady: false,
  busy: false,
  timers: Array.from({ length: 5 }, () => ({ count: 0, running: false })),
  cpuClear: null,
  lowlevel: false,
  clock: { last: 0 },
})

/**
 * Which build is bound.
 *
 * 0.7 shares 0.6's first 23 table entries exactly, ids and routine numbers
 * alike, and then diverges: id 408 is a FUNCTION called `init cpu clear` in
 * 0.6 and an INSTRUCTION called `init cpu clear long` in 0.7, both on routine
 * 27. Seven names are 0.7's alone, so most of the split falls out of the token
 * table. `Cpu Clear` is the one keyword both tables name whose behaviour moved.
 */
function isTft07(rt: Runtime): boolean {
  for (const def of rt.extBindings?.values() ?? []) if (def.id === 'tft-0.7') return true
  return false
}

/**
 * One VBL. "Bis zu 5 zusaetzliche VBL gesteuerte Timer" (timer.amos), and its
 * loop `Init Timer 1,100 ... Until Get Timer(1)=500` settles the direction:
 * they count UP from the value Init Timer gave them.
 *
 * The timers do NOT depend on Start Int, which was the first guess and is
 * wrong: timer.amos never calls it, and neither does timer1.amos. So the
 * interrupt is installed when the library loads and always runs; the flag at
 * +$00 that Start Int sets gates the bitplane scrolling alone, which is why
 * that keyword is "(Privat)" and why it refuses until Init Bpl Scroll has
 * given it a table.
 */
export function tftVbl(state: TftState): void {
  for (const t of state.timers) if (t.running) t.count = (t.count + 1) | 0
}

/** routine 15 ($8c0): `tst.w d0 / beq / cmp.w #5,d0 / bhi` */
function timerIndex(n: number): number {
  if ((n & 0xffff) === 0 || (n & 0xffff) > 5) {
    throw new AmosError('TFT error 4: timer number must be 1 to 5')
  }
  return (n & 0xffff) - 1
}

/** routine 16 ($8d6): the busy flag at +$34 */
function notBusy(state: TftState): void {
  if (state.busy) throw new AmosError('TFT error 3: the TFT interrupt is busy')
}

export function makeTftInstructions(rt: Runtime): Record<string, Instr> {
  const st = (): TftState => rt.tft

  /** the shared body of Cpu Clear Pal and Cpu Clear Ntsc */
  const clear = (it: Parameters<Instr>[0], size: number): void => {
    const adr = it.evalInt()
    // `adda.w #size,a0` THEN `cmpa.l #$1000,a0`: the check is on the END
    const end = (adr + size) | 0
    if (end <= LOW_LIMIT) throw new AmosError('TFT error 10: address must be above $1000')
    const m = rt.resolveWrite(adr)
    if (!m) throw new AmosError('TFT error 10: address must be above $1000')
    const n = Math.max(0, Math.min(size, m.data.length - m.off))
    m.data.fill(0, m.off, m.off + n)
  }

  return {
    /**
     * Cpu Clear Ntsc adr — routine 24 ($b28). 200 unrolled
     * `movem.l d0-d7/a1-a2,-(a0)`, forty bytes at a time, descending: 8,000
     * bytes, one bitplane of 320x200. "Cpu clear arbeitet rueckwerts", says
     * the demo, because the CPU hits chip RAM and the bus timing is the
     * limit. Direction is invisible from outside, so this fills forward.
     */
    'cpu clear ntsc'(it) {
      clear(it, NTSC_BYTES)
    },
    /** Cpu Clear Pal adr — routine 25 ($e88), 256 of them: 10,240 bytes */
    'cpu clear pal'(it) {
      clear(it, PAL_BYTES)
    },
    /**
     * Cpu Clear adr — routine 26 ($12c8). Not a clear of its own: it calls
     * whatever routine address sits at workspace+$132, and raises error 12
     * when that is zero.
     *
     * NOTE. Nothing in this library's twenty-two keywords ever writes +$132.
     * Init Cpu Clear reads a table at +$13a and returns a value; it does not
     * install one, and no other routine touches the field. So unless the
     * library's own init fills it — which this port has not established
     * either way — Cpu Clear can only ever raise error 12, which is what it
     * does here. None of the demos calls it; they use Cpu Clear Ntsc.
     */
    'cpu clear'(it) {
      const adr = it.evalInt()
      if (adr <= LOW_LIMIT) throw new AmosError('TFT error 10: address must be above $1000')
      // 0.6 has nothing that can ever fill +$132, so error 12 is the only
      // outcome. 0.7 added `Init Cpu Clear Long`, which fills it, and then
      // this calls the routine that was generated there. See that keyword for
      // why calling it changes no memory.
      if (!isTft07(rt) || !st().cpuClear) {
        throw new AmosError('TFT error 12: no Cpu Clear routine has been installed')
      }
    },

    /**
     * Init Cpu Clear Long lines,length,modulo — routine 27 ($146c), 0.7's
     * replacement for 0.6's broken `Init Cpu Clear` function.
     *
     * It GENERATES a routine and installs it at +$132, which is the field
     * `Cpu Clear` reads and raised error 12 on for the whole of 0.6. `Rbsr
     * routine 29` ($15c2) frees the previous one first: `FreeMem` at -210 with
     * the size kept at +$136, then both fields zeroed.
     *
     * The names are the author's, and the code disagrees with them. Popping
     * `(a3)+` three times gives d0, d1, d2, and what the routine does with
     * them is: d2 is the REPEAT COUNT, d1 is the number of longwords written
     * per repeat, and d0 is a further count of longwords skipped per repeat.
     * `mulu.w #$4,d7 / mulu.w d2,d7` puts `(d1 + d0) * 4 * d2` at +$13a as the
     * byte total and `d0 * 4` at +$13e. So the doc's `_lines,_length,_modulo`
     * has the ends the wrong way round.
     *
     * The checks: d1 and d2 must be above zero, d0 must not be negative, and
     * d1 is capped at 14 with no modulo (`cmp.w #$e,d1`) or 13 with one
     * (`cmp.w #$d,d1`). A failed check leaves everything alone and reports
     * nothing. A failed AllocMem is error 14.
     *
     * DEFECT: the generated routine clears nothing, and 0.7 did not fix 0.6's
     * bug so much as hide its symptom. The instruction it repeats is a
     * longword read out of a table at data+$142 indexed by d1, and NOTHING IN
     * THE LIBRARY EVER WRITES THAT TABLE. Routine 0 clears +$0 to +$34, +$38
     * to +$60 and +$132 to +$13e, and stops. So the template is zero, and the
     * routine that gets built is `suba.l a1,a1` ($93c9), then d2 copies of
     * `ori.b #$0,d0` (a zero longword), then `rts` ($4e75). It runs, it
     * touches no memory, and `Cpu Clear` stops raising error 12.
     */
    'init cpu clear long'(it) {
      const lines = it.evalInt()
      it.expect(',')
      const length = it.evalInt()
      it.expect(',')
      const modulo = it.evalInt()
      // routine 29 first, whatever happens next
      st().cpuClear = null
      // the guards are all `cmp.w`, so they see the low word
      const [d0, d1, d2] = [sw16(lines), sw16(length), sw16(modulo)]
      if (d1 <= 0 || d2 <= 0 || d0 < 0) return
      if (d0 === 0 ? d1 > 14 : d1 > 13) return
      // the routine it builds is two bytes of prologue, six per repeat with a
      // modulo and four without, then two for the `rts`
      st().cpuClear = {
        size: d2 * (d0 > 0 ? 6 : 4) + 4,
        total: (d1 + d0) * 4 * d2,
        modulo: d0 * 4,
      }
    },

    /**
     * Init Cpu Clear Word lines,length,modulo — routine 28 ($15ba), and it is
     * eight bytes:
     *
     *     move.l (a3)+, d0
     *     move.l (a3)+, d1
     *     move.l (a3)+, d2
     *     rts
     *
     * Three arguments popped and nothing done with them. The word-sized
     * generator was never written, and unlike the tangens pair the author's
     * own doc does not admit it.
     */
    'init cpu clear word'(it) {
      it.evalInt()
      it.expect(',')
      it.evalInt()
      it.expect(',')
      it.evalInt()
    },

    /**
     * Clear Cache — routine 30 ($15fc). `move.w $22(a6),d7` is ExecBase's
     * LIB_VERSION and `cmp.w #$24,d7 / blt` refuses below Kickstart 36 with
     * error 13; at 36 and above it is `jsr -$27c(a6)`, exec's `CacheClearU` at
     * -636. The author's doc writes the name the other way round, "Cache Clear
     * !!!! OS V36>", and the token table is what the tokeniser reads.
     *
     * Nothing to flush, and error 13 never fires. This port executes no 68k,
     * so there is no instruction cache to make coherent, and the machine it
     * models is an A1200, whose LIB_VERSION is well past 36 — the same
     * reasoning `Aga Detect` in ./amcaf.ts turns into an unconditional answer.
     * The keyword is a working no-op rather than an unimplemented one.
     */
    'clear cache'() {
      /* CacheClearU on a machine with no instruction cache to clear */
    },

    /**
     * Make Tangens List shift,entries — routine 31 ($1632), and it is six
     * bytes: two `move.l (a3)+` and an `rts`. The author's own doc marks it
     * "(Not yet)", which the table contradicts by carrying an entry for it,
     * and the routine settles the disagreement: the entry exists and does
     * nothing.
     */
    'make tangens list'(it) {
      it.evalInt()
      it.expect(',')
      it.evalInt()
    },

    /**
     * Init Tick Timer — routine 35 ($16aa).
     *
     * `OldOpenLibrary` at -408 on the name at +$1a0, which is the only library
     * name in the binary: `lowlevel.library`. The base goes to +$19c and a
     * failure is error 15. Then the EClockVal at +$188 is zeroed and
     * `jsr -$66(a6)` primes it: -102 is `ElapsedTime`, the same call
     * GameSupport's `Gstimer` makes, so both keywords share
     * ../amiga/lowlevel.ts and its deviation about granularity.
     *
     * Routine 0's tear-down closes the library again, `jsr -$19e(a6)` at $372,
     * which is `CloseLibrary` at -414.
     */
    'init tick timer'() {
      if (!libraryPresent('lowlevel.library')) {
        throw new AmosError('TFT error 15: lowlevel.library could not be opened')
      }
      st().lowlevel = true
      st().clock.last = 0
      elapsedTime(st().clock, tftTicks(rt))
    },

    /**
     * Qsort adr,first,last — routine 20 ($998). Hoare partition over an array
     * of 32-bit values, the pivot taken from the middle element and the
     * comparison signed (`cmp.l`). `first` and `last` are ELEMENT indices,
     * which the routine turns into byte offsets with `asl.l #2`, so the call
     * in qsort_1_array reads `Qsort Varptr(TEST(0)),0,20`.
     *
     * The author credits Thomas Nokjelski with the algorithm.
     *
     * The array goes through `rt.longsAt`, and it has to: this sorted into a
     * DataView over `resolveWrite`'s buffer, which for the Varptr arena is a
     * throwaway copy behind a write-through Proxy. `Qsort Varptr(A(0)),0,4`
     * left the array in its original order — the sort ran, on bytes nothing
     * read again — and that is the ONLY way the keyword is ever called.
     */
    qsort(it) {
      const adr = it.evalInt()
      it.expect(',')
      const first = it.evalInt()
      it.expect(',')
      const last = it.evalInt()
      // `cmpa.w #0,a0 / beq` — CMPA.W sign-extends its immediate to a full
      // longword before comparing, so this rejects a zero ADDRESS, not an
      // address whose low word happens to be zero
      if (adr === 0) throw new AmosError('TFT error 11: Qsort needs an array address')
      if (last <= first) return
      const v = rt.longsAt(adr)
      if (!v) throw new AmosError('TFT error 11: Qsort needs an array address')
      if (last >= v.length) throw new AmosError('TFT error 11: Qsort needs an array address')
      const { get, set } = v
      const sort = (lo: number, hi: number): void => {
        let i = lo
        let j = hi
        const pivot = get((lo + hi) >> 1)
        for (;;) {
          while (get(i) < pivot) i++
          while (pivot < get(j)) j--
          if (i > j) break
          const t = get(i)
          set(i, get(j))
          set(j, t)
          i++
          j--
          if (i > j) break
        }
        if (lo < j) sort(lo, j)
        if (i < hi) sort(i, hi)
      }
      sort(first, last)
    },
    /**
     * Init Timer n,start — routine 12 ($860). Bounds-checks n, refuses while
     * busy, then sets the counter. It does NOT start the timer.
     */
    'init timer'(it) {
      const n = it.evalInt()
      it.expect(',')
      const start = it.evalInt()
      const i = timerIndex(n)
      notBusy(st())
      st().timers[i]!.count = start | 0
    },
    /** Start Timer n — routine 13 ($880), running = 1 */
    'start timer'(it) {
      const i = timerIndex(it.evalInt())
      notBusy(st())
      st().timers[i]!.running = true
    },
    /** Stop Timer n — routine 14 ($8a2), running = 0. No busy check */
    'stop timer'(it) {
      st().timers[timerIndex(it.evalInt())]!.running = false
    },
    /**
     * Start Int — routine 11 ($840), marked "(Privat)" by the author and
     * demonstrated only by tft_error.amos, which traps it to show an error
     * message. It refuses with error 5 until Init Bpl Scroll has installed
     * its table, which is exactly what that demo relies on.
     */
    'start int'() {
      notBusy(st())
      if (!st().scrollReady) throw new AmosError('TFT error 5: Init Bpl Scroll has not been called')
      st().intOn = true
    },
    /** Stop Int — routine 10 ($832). Clears the flag, checking nothing */
    'stop int'() {
      st().intOn = false
    },
    /**
     * Init Bpl Scroll list — routine 8 ($7c8), "(Privat)". Copies one long
     * to +$04 and eight more to +$0c, then walks the pairs it just wrote and
     * raises error 6 if any is zero, and finally marks +$2c so Start Int will
     * arm. The table is a set of bitplane addresses for the interrupt to
     * scroll.
     *
     * NOTE. The addresses are recorded and the guard is honoured, but nothing
     * scrolls: the interrupt this arms is 68k code inside the library that
     * rewrites copper bitplane pointers, and there is no interrupt here for
     * it to run in. A program calling this gets the error behaviour right and
     * no motion.
     */
    'init bpl scroll'(it) {
      const adr = it.evalInt()
      const v = rt.longsAt(adr, false)
      if (!v) throw new AmosError('TFT error 6: the bitplane list holds a zero entry')
      for (let i = 0; i < Math.min(9, v.length); i++) {
        if (v.getU(i) === 0) {
          throw new AmosError('TFT error 6: the bitplane list holds a zero entry')
        }
      }
      notBusy(st())
      st().scrollReady = true
    },
  }
}

export function makeTftFunctions(rt: Runtime): Record<string, Func> {
  const st = (): TftState => rt.tft
  return {
    /**
     * =Get Tangens(angle,multi) — routine 32 ($1638), ten bytes:
     *
     *     move.l (a3)+, d0
     *     move.l (a3)+, d1
     *     moveq  #$0, d2
     *     move.l d0, d3
     *     rts
     *
     * Both arguments popped, `d2`/`d3` set to the integer return pair, and
     * `d3` is the FIRST argument straight back out. The author's doc marks it
     * "(Not yet)" and spells the name "Get Tanges"; the routine agrees about
     * the state of the thing and the table disagrees about the spelling.
     */
    'get tangens'(_, a) {
      return VI(int(a[0] ?? VI(0)))
    },

    /**
     * =Get Tick Timer — routine 36 ($1716). `Rbsr routine 34`, then error 16
     * if +$19c is zero, then `ElapsedTime` at -102 on the context at +$188.
     *
     * The call returns the time since the LAST call, in 1/65536 of a second,
     * and overwrites the context. So `Init Tick Timer` then a first
     * `Get Tick Timer` measures the gap between the two, which is what the
     * demo uses it for: "Diese beiden Befehle dienen zur ermitlung von
     * zeitabstaenden."
     *
     * DEVIATION: ../amiga/lowlevel.ts measures against the vertical blank at
     * 50 Hz where the machine reads the CIA E clock at about 709 kHz, so
     * anything shorter than a frame answers 0. Totals over a real interval are
     * right. GameSupport's `Gstimer` shares both the call and the deviation.
     */
    'get tick timer'() {
      if (!st().lowlevel) throw new AmosError('TFT error 16: Init Tick Timer has not been called')
      return VI(elapsedTime(st().clock, tftTicks(rt)))
    },

    /**
     * Get High Word(v) — routine 6 ($7ae). NOT a memory read, despite the
     * doc writing it `Get High Word(_adr)`: `and.l #$ffff0000,d3 / swap d3`
     * takes the high word of the VALUE. Its demo says the same thing —
     * "Entspricht - High=Wert/$10000" — and adds that the plain division is
     * faster once compiled.
     */
    'get high word'(_, a) {
      return VI((int(a[0] ?? VI(0)) >>> 16) & 0xffff)
    },
    /** Get Low Word(v) — routine 7 ($7bc), `and.l #$ffff` */
    'get low word'(_, a) {
      return VI(int(a[0] ?? VI(0)) & 0xffff)
    },
    /** Var Mask(a,b) — routine 22 ($b18), a plain 32-bit `and.l` of the two */
    'var mask'(_, a) {
      return VI((int(a[0] ?? VI(0)) & int(a[1] ?? VI(0))) | 0)
    },
    /** Tft Version — routine 23 ($b22), `moveq #$6,d3`: the constant 6 */
    'tft version'() {
      return VI(6)
    },
    /** Get Timer(n) — routine 9 ($816). Bounds-checked, no busy check */
    'get timer'(_, a) {
      return VI(rt.tft.timers[timerIndex(int(a[0] ?? VI(0)))]!.count)
    },
    /**
     * Get Xmouse — routine 17 ($8ec), the word the interrupt left at +$08.
     * "(Privat)", and it is the hardware mouse position rather than AMOS's
     * screen-relative X Mouse, so it is answered from the same place the
     * port's own hardware reads come from.
     */
    'get xmouse'() {
      return VI(rt.input.mouseX & 0xffff)
    },
    /** Get Ymouse — routine 18 ($8f8), the word at +$0a */
    'get ymouse'() {
      return VI(rt.input.mouseY & 0xffff)
    },
    /**
     * Tft Error$(n) — routine 19 ($904). Splits the argument: the high byte
     * must be the extension's slot (`subq.w #1,d7 / cmp.b #$18,d7`, so 25)
     * and the low byte is the error number, which indexes a table of
     * NUL-terminated strings at workspace+$60 ending in $ff.
     *
     * NOTE. That table is AMOS's per-extension message list, and TFT ships no
     * message file — there is not one byte of message text in the library.
     * The keyword exists *because* of the gap it cannot fill: its own demo
     * explains that Error$ gives nothing for an extension's errors. With no
     * table loaded, `tst.l (a1)` finds nothing and the routine falls to its
     * empty fallback, which is what this returns. An error number from
     * another slot returns the fallback at +$10a for the same reason.
     */
    'tft error$'() {
      return VS('')
    },
    /**
     * Set Bpl(cop_adr, offset, list, n) — routine 5 ($768). Writes 2n copper
     * MOVE longwords at `cop_adr`, pointing BPL1PT upward at each address in
     * `list` plus `offset`, and returns the address just past what it wrote.
     *
     * The register walk is the giveaway: it starts at $00e00000 — a copper
     * MOVE to $e0, BPL1PTH — adds the address's high word, then bumps the
     * register by $20000 (two bytes) for BPL1PTL, and again for the next
     * plane.
     */
    'set bpl'(_, a) {
      const copAdr = int(a[0] ?? VI(0))
      const offset = int(a[1] ?? VI(0))
      const list = int(a[2] ?? VI(0))
      const n = int(a[3] ?? VI(0)) & 0xffff
      const src = rt.resolveAddr(list)
      const dst = rt.resolveWrite(copAdr)
      if (!src || !dst || n === 0) return VI(copAdr)
      const sv = new DataView(src.data.buffer, src.data.byteOffset + src.off)
      const dv = new DataView(dst.data.buffer, dst.data.byteOffset + dst.off)
      const room = (dst.data.length - dst.off) >> 2
      let reg = 0xe0
      let o = 0
      for (let i = 0; i < n; i++) {
        if ((i + 1) * 2 > room || (i + 1) * 4 > src.data.length - src.off) break
        const plane = (sv.getUint32(i * 4, false) + offset) >>> 0
        dv.setUint32(o * 4, ((reg << 16) | ((plane >>> 16) & 0xffff)) >>> 0, false)
        o++
        reg += 2
        dv.setUint32(o * 4, ((reg << 16) | (plane & 0xffff)) >>> 0, false)
        o++
        reg += 2
      }
      return VI((copAdr + o * 4) | 0)
    },
    /**
     * Init Cpu Clear(a,b,c) — routine 27 ($1306). Validates, then reads one
     * long from a table at workspace+$13a indexed by its second argument.
     *
     * The library's own defect is that the return register d4 is never
     * initialised, and every failed check branches straight to the exit that
     * returns it. Only one path — third argument zero, second in 1..14 — ever
     * loads it, and the path for a positive third argument falls through its
     * own bounds check without loading anything. Nor does any keyword fill
     * the table it reads. So in this build the routine returns a stale
     * register on most inputs and a zero from the cleared table otherwise.
     *
     * DEVIATION: zero is what this answers on every input, because a stale
     * register is not a value the port has. The defect is the library's and
     * this is the one place it cannot be reproduced.
     */
    'init cpu clear'() {
      return VI(0)
    },
  }
}
