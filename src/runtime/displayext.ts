/**
 * Display 0.01 — "JB"'s six-keyword copper-list helper, at slot 24.
 *
 * February 2011, which makes it the youngest extension registered here by
 * fifteen years, and the only one written after AMOS stopped being anybody's
 * day job. What it does is build a **dual-playfield copper list of its own**
 * over two AMOS screens, hand the display to it, and then let a program
 * scroll each playfield independently and flip between two lists.
 *
 * ## Evidence
 *
 * DISASSEMBLY tier: a 1,740-byte code hunk, nine routines, six of them
 * keywords. Beside it in the archive is `Display_commands.txt`, Andrew D
 * Burton's Extension Examiner export, which is a SECOND transcription of the
 * token table and of every header offset — so the reader that produced our
 * table can be checked against something that is not us. It also derives the
 * slot twice, "By Scanning Default Routine Code: 24" and "By Scanning Error
 * Routine Code: 24".
 *
 * The binary makes that three ways: every routine reaches its data through
 * `$268(a5)`, `ExtAdr` is $f8 with sixteen bytes a slot (+Equ.s:1157), and
 * ($268-$f8)/16+1 = 24. Routine 0 ends `moveq #$17,d0`, the slot zero-based.
 *
 * ## Where the offsets come from
 *
 * The Examiner's numbers are FILE offsets and this port's are CODE HUNK
 * offsets, thirty-two apart — "First 32 bytes not used by AMOS". Its L0 at
 * 202 is our $aa, its L9 at 1606 is our $626. Every `$nnn` below is a hunk
 * offset, so `npm run cli -- src/cli/extdis.ts display-0.01 <keyword>` prints
 * the code being cited.
 *
 * ## The data block
 *
 * Routine 0 allocates $800 chip bytes (`L_RamChip`), splits them at $400 into
 * two copper buffers, opens graphics.library v39, and points `$268(a5)` at a
 * 140-byte block that lives in the library's own hunk at $162. Its fields,
 * every one of them reached by an `adda.w` this port cites:
 *
 *     +$00  the live BPLCON1, low nibble PF1H and high nibble PF2H
 *     +$02  which of the two lists Dlcopswap shows next
 *     +$04  the plane ceiling: 6, or 8 when AA Alice is present
 *     +$06  GfxBase
 *     +$0a  "graphics.library"
 *     +$1c  playfield 1: screen pointer, bytes per line, planes
 *     +$24  playfield 2: the same three
 *     +$2c  list A: chip address, then three back-pointers INTO the list,
 *           then up to eight plane pointers
 *     +$5c  list B, the same 48 bytes
 *
 * The AGA test is `cmpi.w #$27,$14(a0)` on lib_Version and then
 * `btst.b #$2,$ec(a0)` on gb_ChipRevBits0 — version 39 or later AND AA Alice,
 * which is the same pair AMCAF's `Aga Detect` asks (see amcaf.ts). The
 * modelled machine is an A1200, so the ceiling here is 8 and each playfield
 * gets at most four planes.
 *
 * ## What is NOT in the library, and matters
 *
 * Nothing here turns AMOS's own copper off. On the machine AMOS's vertical
 * blank rebuilds its list and re-points COP1LC every frame, so a program that
 * calls `Dlmergedisplay` without `Copper Off` first gets its display taken
 * straight back. That is reproduced rather than papered over: this sets
 * `rt.copList1Addr`, which `composite()` honours only while AMOS's copper is
 * off, exactly as Personnal's `Active Copper` does.
 *
 * ## The one error message
 *
 * Routine 7 is the error half of the AMOS skeleton — `moveq #$0,d1 / moveq
 * #$17,d2 / move.w #$0,d3 / Rjmp L_ErrorExt` — and routine 8 is the silent
 * half. The table it points at holds "Error in dl screenbase" and then the
 * skeleton's own "Error Message 1" and "Error Message 2", never renamed.
 * NOTHING RAISES IT: none of the six keywords branches to routine 7, and the
 * only failure any of them can have is `L_GetEc` refusing a screen number,
 * which is AMOS's error 47 and not this extension's.
 *
 * `lea $63a(pc),a0` is the citation for the message text, and it points two
 * bytes past the `dc.b` a disassembler shows — $638 holds `4e 75`, an `rts`.
 * Reading the string from there instead is where "NuError in dl screenbase"
 * comes from, and the Extension Examiner's export prints it that way too.
 */
import type { Func, Instr } from '../interp/builtins'
import { Runtime } from './runtime'
import { AmosError, VI, int } from '../interp/values'
import type { Screen } from './screen'

/** `L_RamChip #$800` (routine 0, $ae), split at +$400 into two lists */
const CHIP_BYTES = 0x800
const LIST_SLOT = 0x400

/** block+$1c and block+$24 — one merged playfield */
interface DlPlayfield {
  /** the screen `L_GetEc` returned, or null before the first merge */
  screen: number
  /** block+$4: `move.w $4c(a0),d1 / asr.w #$3,d1` — EcTx, not EcTLigne */
  rowBytes: number
  /** block+$6: EcNPlan, clamped to half the plane ceiling */
  planes: number
}

/** block+$2c and block+$5c — one built copper list */
interface DlList {
  /** +$00: where the list starts, as a byte offset into the chip allocation */
  at: number
  /** +$04: the BPLCON1 value word */
  bplcon1At: number
  /** +$08: the first BPL1PT value word */
  pf1At: number
  /** +$0c: the first BPL2PT value word */
  pf2At: number
  /** +$10..: the unscrolled plane pointers, playfield 1's then playfield 2's */
  planes: number[]
}

export interface DisplayExtState {
  /** block+$00 */
  bplcon1: number
  /** block+$02 */
  bank: number
  /** block+$04 */
  maxDepth: number
  playfields: [DlPlayfield, DlPlayfield]
  lists: [DlList, DlList]
  /** the $800 chip bytes, mapped so the copper walk can read them */
  chip: Uint8Array
  /** where `chip` is mapped; list N starts at `base + N * $400` */
  base: number
}

export function newDisplayExtState(rt: Runtime): DisplayExtState {
  const chip = new Uint8Array(CHIP_BYTES)
  const pf = (): DlPlayfield => ({ screen: -1, rowBytes: 0, planes: 0 })
  const list = (at: number): DlList => ({ at, bplcon1At: 0, pf1At: 0, pf2At: 0, planes: [] })
  return {
    bplcon1: 0,
    bank: 0,
    // block+$04 reads $0006 in the shipped hunk and routine 0 overwrites it
    // with 8 only when AA Alice answers; this machine is an A1200, so 8
    maxDepth: 8,
    playfields: [pf(), pf()],
    lists: [list(0), list(LIST_SLOT)],
    chip,
    base: rt.extBlockBase('display-0.01', chip),
  }
}

/** `Rjsr L_GetEc` — the screen or AMOS's error 47 */
function getEc(rt: Runtime, n: number): Screen {
  const s = rt.screens.get(n)
  if (!s) throw new AmosError(`screen not opened: ${n}`, 47)
  return s
}

export function makeDisplayExtInstructions(rt: Runtime): Record<string, Instr> {
  const st = (): DisplayExtState => rt.displayExt

  /** write one copper word at a byte offset in the chip allocation */
  const putw = (off: number, w: number): void => {
    const c = st().chip
    c[off] = (w >> 8) & 0xff
    c[off + 1] = w & 0xff
  }

  return {
    /**
     * Dlcopswap — routine 1 ($1ee), eleven instructions and the whole point
     * of building two lists:
     *
     *     movea.l $268(a5),a0 / adda.w #$2c,a0     list A
     *     movea.l $268(a5),a1 / adda.w #$2,a1      the bank word
     *     tst.w   (a1) / beq $210
     *     adda.w  #$30,a0 / move.w #$0,(a1)        ...B, and back to 0
     *     bra     $214
     *     move.w  #$1,(a1)                         ...A, and on to 1
     *     move.l  (a0),$ddf080                     COP1LC
     *
     * The bank word says which list to show NEXT, not which is showing, so
     * `Dlmergedisplay` leaves it at 1 having just shown A and the first swap
     * shows B.
     *
     * NOTE THE ADDRESS. Every custom-register access in this library is
     * $DDFxxx, not $DFFxxx — $ddf080 here and $ddf096 twice in
     * `Dlmergedisplay` — and there is no $DFF anywhere in the hunk. Bits 8
     * down to 1 are what select the register, so COP1LC is what an Amiga
     * decodes it as, and the author never had cause to notice. It is
     * reproduced as COP1LC because that is what the machine did with it.
     */
    dlcopswap() {
      const s = st()
      const which = s.bank !== 0 ? 1 : 0
      s.bank = s.bank !== 0 ? 0 : 1
      rt.copList1Addr = (s.base + s.lists[which]!.at) >>> 0
    },

    /**
     * Dlmergedisplay x, y, width, height, screen1, screen2, single —
     * routine 5 ($258), 760 bytes and five sixths of the library.
     *
     * The argument order is the pop order read backwards, since `(a3)+`
     * takes the LAST argument first: `move.l (a3)+,d0` at $25c is the
     * seventh, and `move.l (a3)+,d4` at $270 is the first. What settles it is
     * the arithmetic. `d4` becomes DIWSTRT's horizontal and `d5` its
     * vertical, and a 320x256 PAL screen at x=$80, y=$2c comes out $2c81 /
     * $2cc1 / DDF $30..$d0, which are the standard values to the digit.
     *
     * Both screens' planes are woven into ONE pointer set — playfield 1 on
     * BPL1/3/5/7 and playfield 2 on BPL2/4/6/8, `move.w #$e0,d6` at $478 and
     * `addi.w #$4,d6` at $4be with `addi.w #$8,d6` stepping both. Each is
     * clamped to half the plane ceiling ($2aa, `asr.w #$1`), so four planes
     * each here.
     *
     * THE TWO LISTS DIFFER IN ONE THING: A is built from EcPhysic and B from
     * EcLogic (`move.l $18(a0),$10(a1)` and `move.l $0(a0),$10(a1,d2.w)` at
     * $2dc), so swapping them swaps the buffer being shown.
     *
     * Every plane pointer is biased by two ($480, `subi.l #$2,d5`) and DDFSTRT
     * is eight colour clocks early ($374), which is one extra word fetched at
     * the left for `Dlscreenoffset` to scroll into. BPL1MOD and BPL2MOD make
     * up for it: `rowBytes - width/8 - 2`.
     *
     * APPROXIMATED, in one respect. The list writes BPLCON3 = $1000 for four
     * planes a playfield and $c00 for three ($328/$336), which is PF2OF —
     * where playfield 2's pens start. Personnal's own source writes the same
     * two values and calls $1000 "pour 2nd pf palette"
     * (+AMOSPro_Personnal.Lib.s:643). This port's renderer takes playfield 2
     * from pen 8 upward whatever BPLCON3 says, which is right for the
     * three-plane case and wrong for the four-plane one, where the machine
     * would use pens 16-31. No AGA register reference is vendored here, so
     * the field is recorded rather than guessed at.
     */
    dlmergedisplay(it) {
      const x = it.evalInt()
      it.expect(',')
      const y = it.evalInt()
      it.expect(',')
      const width = it.evalInt()
      it.expect(',')
      const height = it.evalInt()
      it.expect(',')
      const n1 = it.evalInt()
      it.expect(',')
      const n2 = it.evalInt()
      it.expect(',')
      const single = it.evalInt()

      const s = st()
      // $27a and $284: the SIXTH argument is resolved first and lands in
      // playfield 2, the fifth in playfield 1
      const pf2Screen = getEc(rt, n2)
      const pf1Screen = getEc(rt, n1)

      // $26a/$272: the width and the left edge are rounded down to sixteen,
      // and the left edge then gets its one back
      const w16 = width & 0xfff0
      const hx = (x & 0xfff0) + 1
      const ceiling = s.maxDepth >> 1

      const screens = [pf1Screen, pf2Screen]
      for (let i = 0; i < 2; i++) {
        const sc = screens[i]!
        s.playfields[i] = {
          screen: sc.index,
          rowBytes: sc.width >> 3,
          planes: Math.min(sc.depth, ceiling),
        }
      }
      // $2dc: list A takes the physical bitmap, list B the logical one
      const chipBase = (i: number): number =>
        rt.screenChipBase(i) + (rt.screens.get(i)!.doubleBuffered ? Runtime.SCREEN_PHY_OFFSET : 0)
      for (let l = 0; l < 2; l++) {
        const planes: number[] = []
        for (let i = 0; i < 2; i++) {
          const p = s.playfields[i]!
          const sc = rt.screens.get(p.screen)!
          const base = l === 0 ? chipBase(p.screen) : rt.screenChipBase(p.screen)
          for (let n = 0; n < p.planes; n++) planes.push((base + n * sc.planeSize) >>> 0)
        }
        s.lists[l]!.planes = planes
      }

      const total = s.playfields[0]!.planes + s.playfields[1]!.planes
      // $31c: eight planes ask for BPU3 rather than the BPU field, and take
      // the other PF2OF
      const bpu = total === 8 ? 0x0010 : (total << 12) & 0xffff
      const bplcon3 = total === 8 ? 0x1000 : 0x0c00
      // $33c: the seventh argument, zero for dual playfield
      const bplcon0 = (bpu + (single === 0 ? 0x0600 : 0x0200)) & 0xffff
      const ddfstrt = (((hx - 0x11) >> 1) - 8) & 0xffff
      const ddfstop = ((((w16 >> 4) - 1) << 3) + ((hx - 0x11) >> 1)) & 0xffff
      const diwstrt = ((y << 8) + hx) & 0xffff
      const diwstop = ((((y + height) << 8) + hx + w16 - 0x100) & 0xffff) >>> 0
      const bytes = w16 >> 3
      const mod = [
        (s.playfields[0]!.rowBytes - bytes - 2) & 0xffff,
        (s.playfields[1]!.rowBytes - bytes - 2) & 0xffff,
      ]

      for (let l = 0; l < 2; l++) {
        const list = s.lists[l]!
        let p = list.at
        const emit = (reg: number, val: number): void => {
          putw(p, reg)
          putw(p + 2, val)
          p += 4
        }
        // $3c4: a wait past line 255 needs the $ff01 crossing first. The test
        // is `cmpi.w #$ff,d1 / ble`, and it is SIGNED — so `Dlmergedisplay`
        // at y=0 waits on -1 rather than emitting a crossing, which is the
        // behaviour and not a rounding of it
        let line = ((y - 1) << 16) >> 16
        if (line > 0xff) {
          emit(0xff01, 0xfffe)
          line -= 0xff
        }
        emit(((line << 8) | 1) & 0xffff, 0xfffe)
        // $3fa: thirty-two colours out of playfield 1's EcPal
        for (let i = 0; i < 32; i++) emit(0x180 + i * 2, pf1Screen.palette[i]! & 0xfff)
        list.bplcon1At = p + 2
        emit(0x102, 0)
        emit(0x104, 0)
        emit(0x106, bplcon3)
        emit(0x108, mod[0]!)
        emit(0x10a, mod[1]!)
        emit(0x08e, diwstrt)
        emit(0x090, diwstop)
        emit(0x092, ddfstrt)
        emit(0x094, ddfstop)
        let seen = 0
        for (let i = 0; i < 2; i++) {
          const at = p + 2
          if (i === 0) list.pf1At = at
          else list.pf2At = at
          for (let n = 0; n < s.playfields[i]!.planes; n++) {
            const reg = 0xe0 + i * 4 + n * 8
            const ad = (list.planes[seen++]! - 2) >>> 0
            emit(reg, (ad >>> 16) & 0xffff)
            emit(reg + 2, ad & 0xffff)
          }
        }
        emit(0x100, bplcon0)
        emit(0xffff, 0xfffe)
      }

      // $50c: DMACON clears BPLEN|COPEN, COP1LC takes list A, DMACON sets
      // them again. The clear and the set bracket one CPU instruction and
      // nothing can be displayed between them, so what is left is the state
      // they arrive at
      rt.copRegs.dmaOn = true
      rt.copList1Addr = (s.base + s.lists[0]!.at) >>> 0
      s.bank = 1
      s.bplcon1 = 0
    },

    /**
     * Dlscreenoffset playfield, x, y — routine 6 ($550), which patches a list
     * already built rather than rebuilding one.
     *
     * The first argument picks the playfield (`tst.w d5` at $56c), and the
     * list it patches is the one the bank word says is NEXT ($5a2) — so the
     * sequence a program writes is offset, then `Dlcopswap`, and the list
     * being scrolled is always the hidden one.
     *
     * The scroll splits at sixteen pixels. Whole words go into the plane
     * pointers, `y * rowBytes + (x and $fff0)/8`, and the remainder goes into
     * BPLCON1 as `16 - (x and 15)` — in the low nibble for playfield 1 and
     * the high one for playfield 2 ($5ca), so the two scroll independently.
     * The two halves join up at the boundary because x and 15 = 0 takes the
     * pointer back two bytes instead ($600), which is the same displacement
     * a delay of sixteen would be if the field went that far.
     *
     * DEVIATION: this port's renderer adds BPLCON1's low nibble to where the
     * fetch lands and ignores the high one (`dataStart`, display.ts), so
     * playfield 2 scrolls in whole words here and smoothly on the machine.
     * The bytes written are the machine's either way, and `Dlscreenoffset 0`
     * — the playfield most programs move — is exact.
     */
    dlscreenoffset(it) {
      const which = it.evalInt()
      it.expect(',')
      const x = it.evalInt()
      it.expect(',')
      const y = it.evalInt()

      const s = st()
      const i = which !== 0 ? 1 : 0
      const pf = s.playfields[i]!
      const list = s.lists[s.bank !== 0 ? 1 : 0]!
      // $556: the low nibble is the pixel remainder, the rest is bytes
      const pixels = x & 0x0f
      const off = ((y * pf.rowBytes + ((x & 0xfff0) >> 3)) | 0) >> 0

      // $5ae: no remainder means no delay, and a delay of sixteen is not
      // representable, so the pointer takes it instead
      const delay = pixels === 0 ? 0 : 0x10 - pixels
      s.bplcon1 =
        i === 1 ? ((delay << 4) & 0xf0) | (s.bplcon1 & 0x0f) : (delay & 0x0f) | (s.bplcon1 & 0xf0)
      const c = s.chip
      c[list.bplcon1At] = (s.bplcon1 >> 8) & 0xff
      c[list.bplcon1At + 1] = s.bplcon1 & 0xff

      let at = i === 1 ? list.pf2At : list.pf1At
      const first = i === 1 ? s.playfields[0]!.planes : 0
      for (let n = 0; n < pf.planes; n++) {
        let ad = (list.planes[first + n]! + off) | 0
        if (pixels === 0) ad -= 2
        c[at] = (ad >>> 24) & 0xff
        c[at + 1] = (ad >>> 16) & 0xff
        c[at + 4] = (ad >>> 8) & 0xff
        c[at + 5] = ad & 0xff
        at += 8
      }
    },
  }
}

export function makeDisplayExtFunctions(rt: Runtime): Record<string, Func> {
  return {
    /**
     * =Dlscreenbase(n) — routine 2 ($21c), five instructions:
     * `move.l (a3)+,d1 / Rjsr L_GetEc / move.l a0,d3 / moveq #$0,d2`.
     *
     * The screen's control block, which is what `Screen Base` answers for the
     * current screen (ScOnAd, FnScreenBase +Lib.s:8769). This one takes a
     * number, so it reaches a screen that is not current.
     */
    dlscreenbase: (_, a) => {
      const n = int(a[0]!)
      getEc(rt, n)
      return VI(rt.screenCtrlAddr(n) | 0)
    },

    /** =Dldepth(n) — routine 3 ($22a), the same call and `move.w $50(a0),d3`: EcNPlan */
    dldepth: (_, a) => VI(getEc(rt, int(a[0]!)).depth),

    /**
     * =Dlcheckaga — routine 4 ($23a), which does not ask graphics.library at
     * all. Routine 0 asked once at load time and left 6 or 8 at block+$04,
     * and this compares that word with 8: `cmpi.w #$8,(a0) / bne $254`, then
     * `move.l #$ffffffff,d3` or `moveq #$0,d3`.
     *
     * The modelled machine is an A1200 and answers -1, for the reason AMCAF's
     * `Aga Detect` does: the 256-colour screens and the LOCT palette are what
     * make the claim true here rather than asserted.
     */
    dlcheckaga: () => VI(-1),
  }
}
