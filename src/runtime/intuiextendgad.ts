/**
 * IntuiExtend 2.01b, the gadget group.
 *
 * Thirty-four keywords, and unlike the screen and window group these are not
 * handles. A gadget here is a REAL BLOCK OF MEMORY with the Intuition layout
 * in it, because the guide hands its address to the program and the library
 * itself then reads it back by fixed offset: `Wb Hpos` is
 *
 *     $3618  movea.l (a3)+,a0
 *     $361a  movea.l $22(a0),a0     ; gg_SpecialInfo
 *     $3620  move.w  $2(a0),d3      ; pi_HorizPot
 *
 * and `Wb Slide Swap Look` does not even follow the pointer, it reaches
 * straight into `$2d(a0)`. So the blocks are laid out here exactly as the
 * library lays them out, and nothing about them is a convention this port
 * invented.
 *
 * ## The three block sizes
 *
 * Each `Wb Init * Gadget` is one AllocMem of a size that says what the block
 * holds, and the sizes are exact:
 *
 *     bool, toggle      $74  116   Gadget 44, and 72 bytes nothing fills in
 *     hslide/vslide/mslide  $56   86   Gadget 44 + PropInfo 22 + Image 20
 *     str, num          $50   80   Gadget 44 + StringInfo 36
 *
 * `$56` and `$50` are their structures added up with nothing left over, which
 * is how the layout is known rather than guessed: routine 83 writes
 * `gg_SpecialInfo = base + $2c` and `gg_GadgetRender = base + $2c + $16`, so
 * the PropInfo follows the Gadget and the Image follows the PropInfo.
 *
 * The bool block's spare 72 bytes are never touched by anything in the
 * library. `Wb Bevel Gadget` needs 144 and allocates its own.
 *
 * ## Evidence
 *
 * BINARY tier. Every struct offset below was computed from AMOS
 * Professional's own `includes/intuition/intuition.i` in the corpus --- the
 * include these binaries were assembled against --- and every LVO read out of
 * `intuition_lib.fd` under the GUI 2.10 sources. Documented against
 * `IntuiExtend_2.0.Guide`'s Gadget.guide and Graphic.guide, @Author CIERP
 * Philippe.
 *
 * ## Six things the binary does that the guide does not say
 *
 * `Wb Refresh All Gadget` and `Wb Remove All Gadget` both call RemoveGList
 * (-$1bc) with numGad of zero, so both do nothing at all. Each is marked
 * where it is defined, and the first of them calls the wrong function
 * outright.
 *
 * `Wb Insert Gadget` calls AddGadget without setting d0, and the three
 * `Wb New * Slide Gadget` call NewModifyProp without setting d5. Both of
 * those registers are arguments.
 *
 * `Wb Init Num Gadget` takes EIGHT arguments and the guide documents six.
 *
 * `Wb Init Str Gadget`'s VIS lands in si_NumChars, two bytes below the
 * si_DispCount the guide describes.
 *
 * ## Where the model meets the memory
 *
 * DEVIATION: on a real Amiga the Gadget struct IS the shared state --- the
 * program pokes it, Intuition reads it, Intuition writes the pot back into
 * the same words. Here ../amiga/intuition.ts holds a `UserGadget` object and
 * the block is separate memory, so the two are joined by `ieGadgetPull` and
 * `ieGadgetPush` and every keyword in this file that takes a gadget address
 * calls one of them. The seam shows in one place only: a program that
 * `Peek`s the block directly, rather than going through a keyword, sees the
 * pot as of the last keyword call.
 */
import type { Runtime } from './runtime'
import type { Func, Instr } from '../interp/builtins'
import { VI, int, type Value } from '../interp/values'
import type { RastPort } from '../amiga/graphics'
import {
  GFLG_GADGDISABLED,
  GTYP_BOOLGADGET,
  GTYP_PROPGADGET,
  GTYP_STRGADGET,
  type Border,
  type GadgetImage,
  type UserGadget,
} from '../amiga/intuition'
import type { IntuiextendState } from './intuiextend'
import { ieMem as mem, ieWindowAt, type IeMem as Mem, type IeWindow } from './intuiextendwin'
import { ieRastPortAt } from './intuiextendgfx'
import { ICON_BANK } from './banks'
import { IE_IMAGE_SIZEOF } from './intuiextendsys'

/** the AllocMem sizes at $3194, $3202 and $3284, and $33b8's bevel block */
export const IE_GADGET_BOOL_SIZE = 0x74
export const IE_GADGET_PROP_SIZE = 0x56
export const IE_GADGET_STR_SIZE = 0x50
export const IE_BEVEL_SIZE = 0x90

/** `struct Gadget`, `intuition.i`:200 */
const GG = {
  LEFT: 4,
  TOP: 6,
  WIDTH: 8,
  HEIGHT: 0x0a,
  FLAGS: 0x0c,
  ACTIVATION: 0x0e,
  TYPE: 0x10,
  RENDER: 0x12,
  SELECT: 0x16,
  SPECIAL: 0x22,
  ID: 0x26,
  SIZEOF: 0x2c,
} as const

/** `struct PropInfo`, `intuition.i`:379 */
const PI = { FLAGS: 0, HPOT: 2, VPOT: 4, HBODY: 6, VBODY: 8, SIZEOF: 0x16 } as const

/** `struct StringInfo`, `intuition.i`:440 */
const SI = { BUFFER: 0, MAXCHARS: 0x0a, BUFPOS: 8, NUMCHARS: 0x10, DISPCOUNT: 0x12 } as const

/** `struct Image`, `intuition.i`:534 */
const IG = { LEFT: 0, TOP: 2, WIDTH: 4, HEIGHT: 6, DEPTH: 8, DATA: 0x0a, PICK: 0x0e, ONOFF: 0x0f } as const

/** `struct Border`, `intuition.i`:515 */
const BD = { LEFT: 0, TOP: 2, FRONTPEN: 4, DRAWMODE: 6, COUNT: 7, XY: 8, NEXT: 0x0c } as const

/**
 * `GADGIMAGE`, `intuition.i`:256. Set means GadgetRender and SelectRender
 * are Images; clear means they are Borders.
 */
const GFLG_GADGIMAGE = 0x0004
/** `GADGHIMAGE`, `intuition.i`:251, the two-bit highlight field's value 2 */
const GFLG_GADGHIMAGE = 0x0002

/**
 * The gadget blocks this extension has handed out and where they ended up.
 *
 * Keyed by the block address, which is what every keyword in the group takes.
 * A block that has never been through `Wb Insert Gadget` is not in here, and
 * the keywords that only read or poke memory work on it just the same.
 */
export interface IeGadgetState {
  live: Map<number, { win: IeWindow; g: UserGadget }>
}

export function newIeGadgetState(): IeGadgetState {
  return { live: new Map() }
}

/** the low word, signed: every gadget field goes through a `move.w` */
const lo = (v: number): number => (v << 16) >> 16

export function makeIntuiextendGadInstructions(rt: Runtime): Record<string, Instr> {
  const st = (): IntuiextendState => rt.intuiextend
  const m = mem(rt)

  /** `GADGET To ...` and `A,B To GADGET`, the two shapes this group has */
  const toArgs = (it: Parameters<Instr>[0], before: number, after: number): number[] => {
    const out: number[] = []
    for (let i = 0; i < before; i++) {
      if (i > 0) it.expect(',')
      out.push(it.evalInt())
    }
    it.expect('to')
    for (let i = 0; i < after; i++) {
      if (i > 0) it.expect(',')
      out.push(it.evalInt())
    }
    return out
  }

  /** `WIND,GADGET`, which six of these take */
  const pair = (it: Parameters<Instr>[0]): [number, number] => {
    const a = it.evalInt()
    it.expect(',')
    return [a, it.evalInt()]
  }

  /**
   * NewModifyProp (-$1d4) as routines 87, 88 and 89 call it: the four pot and
   * body words go into the PropInfo, pi_Flags is replaced outright, and the
   * gadget is redrawn.
   *
   * DEFECT: d5 is NewModifyProp's `numGad` and none of the three sets it, so
   * the count of gadgets to refresh is whatever the interpreter left in the
   * register. The port refreshes the one gadget named, which is what the
   * author plainly meant and what a d5 of 1 would have done.
   */
  const newModifyProp = (
    win: number,
    gad: number,
    flags: number,
    hpot: number,
    vpot: number,
    hbody: number,
    vbody: number,
  ): void => {
    if (!ieWindowAt(rt, win) || gad === 0) return
    const sp = m.long(gad + GG.SPECIAL)
    if (sp === 0) return
    m.setWord(sp + PI.FLAGS, flags)
    m.setWord(sp + PI.HPOT, hpot)
    m.setWord(sp + PI.VPOT, vpot)
    m.setWord(sp + PI.HBODY, hbody)
    m.setWord(sp + PI.VBODY, vbody)
    ieGadgetPull(rt, gad)
    rt.intuition.invalidate()
  }

  /** free a gadget block of a FIXED size, which is what routines 121-126 do */
  const freeBlock = (it: Parameters<Instr>[0]): number => {
    const addr = it.evalInt() >>> 0
    if (addr === 0) return 0
    st().gadgets.live.delete(addr)
    return addr
  }

  return {
    /**
     * Wb Insert Gadget WIND To GADGET --- routine 74 ($311e), AddGadget at
     * -$2a.
     *
     *     $3120  movea.l (a3)+,a1     ; GADGET
     *     $3122  movea.l (a3)+,a0     ; WIND
     *     $3124  suba.l  a2,a2
     *     $312a  jsr     -$2a(a6)
     *
     * DEFECT: `AddGadget(window,gadget,position)(a0/a1,d0)` and d0 is never
     * loaded, so the position the gadget lands at in the window's list is
     * whatever the interpreter left behind. The list order decides which of
     * two overlapping gadgets takes a click, so this is visible and not
     * merely untidy. The port appends, which is AddGadget's documented
     * behaviour for a position past the end and the only reading under which
     * the guide's "insert le gadget GADGET dans la gadget-liste" comes true.
     */
    'wb insert gadget'(it) {
      const [wind, gad] = toArgs(it, 1, 1) as [number, number]
      const w = ieWindowAt(rt, wind)
      if (!w || gad === 0) return
      const g = ieGadgetPull(rt, gad)
      if (!g) return
      st().gadgets.live.set(gad >>> 0, { win: w, g })
      if (!w.win.gadgets.includes(g)) w.win.gadgets.push(g)
      rt.intuition.invalidate()
    },

    /**
     * Wb Off Gadget WIND,GADGET --- routine 76 ($3144), OffGadget at -$ae,
     * and
     * Wb On Gadget WIND,GADGET --- routine 77 ($3158), OnGadget at -$ba.
     *
     * Both pop GADGET into a0 and WIND into a1, which is
     * `OffGadget(gadget,window,requester)(a0/a1/a2)` in order, and both clear
     * a2 so no requester is named. GFLG_GADGDISABLED is `intuition.i`:277.
     */
    'wb off gadget'(it) {
      const [wind, gad] = pair(it)
      disable(rt, wind, gad, true)
    },
    'wb on gadget'(it) {
      const [wind, gad] = pair(it)
      disable(rt, wind, gad, false)
    },

    /**
     * Wb Refresh Gadget WIND,GADGET --- routine 78 ($316c), RefreshGadgets at
     * -$de, a0 the gadget and a1 the window.
     *
     * RefreshGadgets redraws from the named gadget to the END of the list, so
     * this is not one gadget however the guide's "redessinner le gadget
     * GADGET" reads. The port re-reads the block first, because a program is
     * entitled to have poked the struct and this is the call it makes to say
     * so.
     */
    'wb refresh gadget'(it) {
      const [wind, gad] = pair(it)
      if (!ieWindowAt(rt, wind)) return
      ieGadgetPull(rt, gad)
      rt.intuition.invalidate()
    },

    /**
     * Wb Remove Gadget WIND,GADGET --- routine 79 ($3180), RemoveGadget at
     * -$e4, a0 the window and a1 the gadget.
     *
     * The block is NOT freed: RemoveGadget only unlinks, and the guide gives
     * `Wb Free * Gadget` separately for the memory.
     */
    'wb remove gadget'(it) {
      const [wind, gad] = pair(it)
      const w = ieWindowAt(rt, wind)
      const live = st().gadgets.live.get(gad >>> 0)
      st().gadgets.live.delete(gad >>> 0)
      if (!w || !live) return
      const i = w.win.gadgets.indexOf(live.g)
      if (i >= 0) w.win.gadgets.splice(i, 1)
      rt.intuition.invalidate()
    },

    /**
     * Wb Activate Gadget WIND,GADGET --- routine 81 ($31de), ActivateGadget
     * at -$1ce, a0 the gadget and a1 the window.
     *
     * Intuition activates a STRGADGET and nothing else, so this is the
     * keyword that puts the cursor in a string gadget without the user having
     * clicked it.
     */
    'wb activate gadget'(it) {
      const [wind, gad] = pair(it)
      const w = ieWindowAt(rt, wind)
      const live = st().gadgets.live.get(gad >>> 0)
      if (!w || !live) return
      ieGadgetPush(rt, gad, live.g)
      rt.intuition.activateGadget(w.win, live.g)
    },

    /**
     * Wb New Hslide Gadget WINDOW To GADGET,XPOS,XLEN --- routine 87 ($32fa).
     *
     *     $32fc  move.w  #$13,d0      ; AUTOKNOB|FREEHORIZ|PROPNEWLOOK
     *     $3300  move.l  (a3)+,d3     ; XLEN  -> horizBody
     *     $3302  moveq   #-1,d4       ; vertBody = MAXBODY
     *     $3304  move.l  (a3)+,d1     ; XPOS   -> horizPot
     *     $3306  moveq   #-1,d2       ; vertPot = MAXPOT
     *
     * The flags word is $13 and not the $113 the init routine wrote, so the
     * first call to this is also what clears the KNOBHIT the init routine set.
     */
    'wb new hslide gadget'(it) {
      const [win, gad, xpos, xlen] = toArgs(it, 1, 3) as [number, number, number, number]
      newModifyProp(win, gad, 0x13, xpos, 0xffff, xlen, 0xffff)
    },

    /** Wb New Vslide Gadget WINDOW To GADGET,YPOS,YLEN --- routine 88 ($331a), flags $15 */
    'wb new vslide gadget'(it) {
      const [win, gad, ypos, ylen] = toArgs(it, 1, 3) as [number, number, number, number]
      newModifyProp(win, gad, 0x15, 0xffff, ypos, 0xffff, ylen)
    },

    /**
     * Wb New Mslide Gadget WINDOW To GADGET,XPOS,YPOS,XLEN,YLEN --- routine
     * 89 ($333a), flags $17. The only one of the three where all four words
     * are arguments.
     */
    'wb new mslide gadget'(it) {
      const a = toArgs(it, 1, 5)
      newModifyProp(a[0]!, a[1]!, 0x17, a[2]!, a[3]!, a[4]!, a[5]!)
    },

    /**
     * Wb Bevel Gadget GADGET --- routine 97 ($33b8).
     *
     * One AllocMem of $90 laid out as two 72-byte halves, GadgetRender and
     * SelectRender, each holding two Borders and their point lists:
     *
     *     +$00  Border, bd_XY -> +$10, bd_NextBorder -> +$24
     *     +$10  five (x,y) pairs
     *     +$24  Border, bd_XY -> +$34, bd_NextBorder = 0
     *     +$34  five (x,y) pairs
     *
     * With W and H the gadget's own and the block cleared by AllocMem, the
     * first polyline is (W-1,0) (0,0) (0,H) (1,H-1) (1,0) and the second is
     * (1,H) (W,H) (W,0) (W-1,1) (W-1,H): the top-left highlight and the
     * bottom-right shadow. The pens are 2 and 1 unselected and swapped in the
     * SelectRender half, which is the whole of the 2.0 look.
     *
     * `move.l #$2000105,$4(a0)` sets FrontPen, BackPen, DrawMode and Count in
     * one instruction because bd_FrontPen through bd_Count are four adjacent
     * bytes.
     *
     * The old GadgetRender and SelectRender are overwritten without being
     * freed, so bevelling a gadget twice leaks 144 bytes and bevelling one
     * that `Wb Gadget Image` had already dressed loses the images.
     */
    'wb bevel gadget'(it) {
      const gad = it.evalInt() >>> 0
      if (gad === 0) return
      const blk = st().heap.alloc(IE_BEVEL_SIZE, { clear: true })
      if (blk === 0) return
      const w = lo(m.word(gad + GG.WIDTH))
      const h = lo(m.word(gad + GG.HEIGHT))
      const shine: number[] = [w - 1, 0, 0, 0, 0, h, 1, h - 1, 1, 0]
      const shadow: number[] = [1, h, w, h, w, 0, w - 1, 1, w - 1, h]
      // the two halves differ only in which border gets pen 2 and which pen 1
      for (const [half, first, second] of [
        [0, 2, 1],
        [0x48, 1, 2],
      ] as const) {
        const a = blk + half
        writeBorder(m, a, first, shine, a + 0x24)
        writeBorder(m, a + 0x24, second, shadow, 0)
      }
      m.setLong(gad + GG.RENDER, blk)
      m.setLong(gad + GG.SELECT, blk + 0x48)
      refresh(rt, gad)
    },

    /**
     * Wb Draw Image IMAG To RPORT,TOPX,TOPY --- routine 103 ($3602),
     * intuition DrawImage at -$72.
     *
     *     $3608  move.l  (a3)+,d1     ; TOPY
     *     $360a  move.l  (a3)+,d0     ; TOPX
     *     $360c  movea.l (a3)+,a0     ; RPORT
     *     $360e  movea.l (a3)+,a1     ; IMAG
     *
     * DrawImage adds the Image's own LeftEdge and TopEdge to the two offsets,
     * and it is opaque: colour 0 is drawn rather than skipped.
     */
    'wb draw image'(it) {
      const [img, rport, x, y] = toArgs(it, 1, 3) as [number, number, number, number]
      const rp = ieRastPortAt(rt, rport)
      const im = ieReadImage(rt, img)
      if (!rp || !im) return
      drawImage(rp, im, lo(x), lo(y))
    },

    /**
     * Wb Free Bool Gadget GADGET --- routine 121 ($377a), and
     * Wb Free Toggle Gadget GADGET --- routine 122 ($378e), which is one
     * `Rbra` to it.
     *
     * `FreeMem(GADGET,$74)`, with a zero address answering early.
     *
     * The size is a CONSTANT rather than anything read back from the block,
     * so freeing a slider with this hands exec 116 bytes back for an 86-byte
     * allocation and corrupts the free list.
     *
     * DEVIATION: ../amiga/exec.ts's pool records what each block was given
     * and frees that, so the mismatch cannot be reproduced here. The port
     * frees the block; a program that crossed the two keywords over survives
     * where the Amiga would not.
     *
     * A bevel block is not freed with it: nothing in the library ever frees
     * one.
     */
    'wb free bool gadget'(it) {
      const a = freeBlock(it)
      if (a !== 0) st().heap.freeMem(a)
    },
    'wb free toggle gadget'(it) {
      const a = freeBlock(it)
      if (a !== 0) st().heap.freeMem(a)
    },
    /** Wb Free Slide Gadget GADGET --- routine 124 ($37a4), `FreeMem(GADGET,$56)` */
    'wb free slide gadget'(it) {
      const a = freeBlock(it)
      if (a !== 0) st().heap.freeMem(a)
    },
    /** Wb Free Num Gadget GADGET --- routine 125 ($37b8), `FreeMem(GADGET,$50)` */
    'wb free num gadget'(it) {
      const a = freeBlock(it)
      if (a !== 0) st().heap.freeMem(a)
    },
    /** Wb Free Str Gadget GADGET --- routine 126 ($37cc), the same $50 */
    'wb free str gadget'(it) {
      const a = freeBlock(it)
      if (a !== 0) st().heap.freeMem(a)
    },

    /**
     * Wb Set Str Left STRGAD --- routine 123 ($3794),
     * Wb Set Str Centre STRGAD --- routine 128 ($37ea), and
     * Wb Set Str Right STRGAD --- routine 129 ($37fa).
     *
     * Three pairs of bit instructions on `$e(a0)`, which is the HIGH byte of
     * the gg_Activation word, so `bclr.b #$1` is bit 9 of the word and
     * `bclr.b #$2` is bit 10 --- GACT_STRINGCENTER $0200 and
     * GACT_STRINGRIGHT $0400, `intuition.i`:315. Left clears both, and the
     * other two set one and clear the other, so the three are exclusive.
     */
    'wb set str left'(it) {
      justify(rt, it.evalInt(), 0)
    },
    'wb set str centre'(it) {
      justify(rt, it.evalInt(), 0x0200)
    },
    'wb set str right'(it) {
      justify(rt, it.evalInt(), 0x0400)
    },

    /**
     * Wb Slide Swap Look SLIDER --- routine 127 ($37e0).
     *
     *     $37e2  bchg.b  #$4,$2d(a0)
     *
     * $2d is the low byte of pi_Flags, so bit 4 is $0010: PROPNEWLOOK, which
     * the 1.3 include this was assembled against does not define. That is why
     * the guide can call the alternative "le look du 1.2".
     *
     * It reaches into `gad + $2d` rather than following gg_SpecialInfo, so it
     * only works on a block this extension laid out --- a gadget whose
     * PropInfo is anywhere else gets its 45th byte flipped instead.
     */
    'wb slide swap look'(it) {
      const gad = it.evalInt() >>> 0
      if (gad === 0) return
      const at = gad + GG.SIZEOF + 1
      m.setByte(at, m.byte(at) ^ 0x10)
      refresh(rt, gad)
    },

    /**
     * Wb Gadget Image IM1,IM2 To GADGET --- routine 145 ($398c).
     *
     *     $398e  move.w  $c(a0),d0    ; gg_Flags
     *     $3992  move.l  (a3)+,d1     ; IM2 -> gg_SelectRender, then bset #1
     *     $39a0  move.l  (a3)+,d1     ; IM1 -> gg_GadgetRender, then bset #2
     *
     * Bit 1 is GADGHIMAGE and bit 2 is GADGIMAGE, `intuition.i`:251 and 256.
     * A zero argument leaves that pointer and that flag alone, so passing
     * only IM1 keeps whatever highlight mode the gadget already had.
     */
    'wb gadget image'(it) {
      const [im1, im2, gad] = toArgs(it, 2, 1) as [number, number, number]
      if (gad === 0) return
      let flags = m.word(gad + GG.FLAGS)
      if (im2 !== 0) {
        m.setLong(gad + GG.SELECT, im2)
        flags |= GFLG_GADGHIMAGE
      }
      if (im1 !== 0) {
        m.setLong(gad + GG.RENDER, im1)
        flags |= GFLG_GADGIMAGE
      }
      m.setWord(gad + GG.FLAGS, flags)
      refresh(rt, gad)
    },

    /**
     * Wb Refresh All Gadget WINDOW --- routine 166 ($3c84).
     *
     *     $3c88  movea.l $3e(a1),a0   ; wd_FirstGadget
     *     $3c8c  moveq   #$0,d0
     *     $3c92  jsr     -$1bc(a6)
     *
     * DEFECT: -$1bc is RemoveGList, not RefreshGList. The registers are a
     * correct RefreshGList call --- `(gadgets,window,requester,numGad)` in
     * a0/a1/a2 and d0, which is exactly what is loaded --- aimed at the vector
     * two entries below it, RefreshGList being -$1b0. The keyword redraws
     * nothing, and only the numGad of zero stops it unlinking the window's
     * whole gadget list instead.
     *
     * The port reproduces the no-op. A window whose gadgets need redrawing
     * has `Wb Refresh Gadget` for it, which calls the right function.
     */
    'wb refresh all gadget'(it) {
      it.evalInt()
    },

    /**
     * Wb Remove All Gadget WINDOW --- routine 182 ($40f2), the same
     * RemoveGList with a0 and a1 the right way round this time.
     *
     * DEFECT: d0 is RemoveGList's numGad and it is zero, so zero gadgets are
     * removed. Intuition's "remove them all" is a numGad of -1. The guide
     * promises "Elimine TOUS les gadgets d'une fenêtre." and the call removes
     * none, so the port removes none.
     */
    'wb remove all gadget'(it) {
      it.evalInt()
    },
  }
}

export function makeIntuiextendGadFunctions(rt: Runtime): Record<string, Func> {
  const st = (): IntuiextendState => rt.intuiextend
  const m = mem(rt)
  const i0 = (a: Value[], n: number): number => int(a[n] ?? VI(0)) | 0

  /**
   * The body routines 80, 83, 85 and 98 share: allocate, then fill the same
   * five box words, the type and the id.
   *
   * All four allocate with `#$10001` --- MEMF_PUBLIC|MEMF_CLEAR --- so every
   * field not written below is zero, and several of them matter: gg_NextGadget,
   * gg_GadgetText and gg_MutualExclude are all left at zero on purpose.
   */
  const initGadget = (size: number, a: Value[], kind: number, activation: number, flagArg: number): number => {
    const addr = st().heap.alloc(size, { clear: true })
    if (addr === 0) return 0
    m.setWord(addr + GG.LEFT, i0(a, 1))
    m.setWord(addr + GG.TOP, i0(a, 2))
    m.setWord(addr + GG.WIDTH, i0(a, 3))
    m.setWord(addr + GG.HEIGHT, i0(a, 4))
    m.setWord(addr + GG.FLAGS, i0(a, flagArg))
    m.setWord(addr + GG.TYPE, kind)
    m.setWord(addr + GG.ID, i0(a, 0))
    m.setWord(addr + GG.ACTIVATION, activation)
    return addr
  }

  return {
    /**
     * =Wb Init Bool Gadget(NUM,X,Y,W,H,FLAG) --- routine 80 ($3194).
     *
     *     $3194  move.l  #$74,-(a3)
     *     $319a  move.l  #$10001,-(a3)
     *     $31a0  Rbsr    routine 35 (alloc mem)
     *     ...
     *     $31ca  move.w  #$1,$10(a0)   ; GTYP_BOOLGADGET
     *     $31d4  move.w  #$b,$e(a0)    ; RELVERIFY|GADGIMMEDIATE|FOLLOWMOUSE
     *
     * FLAG is gg_Flags and the guide lists its four values as 0 to 3, which
     * are GADGHCOMP, GADGHBOX, GADGHIMAGE and GADGHNONE --- the two-bit
     * highlight field of `intuition.i`:249. The guide's names for them
     * ("Inversion (not)", "Inversion du cadre exterieur du gadget", "Active un
     * gadget graphique", "Pas de changement visible") describe those four in
     * order.
     *
     * gg_Activation is $b for every gadget this extension makes, FOLLOWMOUSE
     * included, so a program that never asked for one still gets MOUSEMOVE
     * reports while the button is down on any of them.
     *
     * The $74 is 116 bytes for a 44-byte structure. Nothing uses the other 72.
     */
    'wb init bool gadget': (_, a) => VI(initGadget(IE_GADGET_BOOL_SIZE, a, GTYP_BOOLGADGET, 0x0b, 5) | 0),

    /**
     * =Wb Init Toggle Gadget(NUM,X,Y,W,H,FLAG) --- routine 82 ($31f2), which
     * is `Rbsr routine 80` and then `move.w #$10b,$e(a0)`.
     *
     * $10b is $b plus GACT_TOGGLESELECT ($0100, `intuition.i`:313), and that
     * one bit is the entire difference between the two keywords.
     */
    'wb init toggle gadget': (_, a) => VI(initGadget(IE_GADGET_BOOL_SIZE, a, GTYP_BOOLGADGET, 0x010b, 5) | 0),

    /**
     * =Wb Init Hslide Gadget(NUM,X,Y,W,H,FLAG) --- routine 83 ($3202).
     *
     * $56 bytes, and the two structures inside it are placed by arithmetic
     * that is worth reading straight:
     *
     *     $3226  addi.w  #$2c,d0
     *     $322a  move.l  d0,$22(a0)    ; gg_SpecialInfo = base + $2c
     *     $322e  addi.w  #$16,d0
     *     $3232  move.l  d0,$12(a0)    ; gg_GadgetRender = base + $42
     *
     * so PropInfo follows Gadget and Image follows PropInfo, exactly filling
     * the block. The Image is left entirely zero and nothing ever fills it in
     * --- an AUTOKNOB draws its own imagery, so GadgetRender is only there to
     * be non-NULL.
     *
     * Both pot words and both body words start at $ffff, MAXPOT and MAXBODY.
     *
     * pi_Flags is $113: AUTOKNOB|FREEHORIZ|PROPNEWLOOK and KNOBHIT ($0100,
     * `intuition.i`:426). KNOBHIT means "set when this Knob is hit" and
     * Intuition sets it, so a fresh slider claims to be mid-drag until the
     * first `Wb New Hslide Gadget` writes $13 over it.
     */
    'wb init hslide gadget': (_, a) => VI(initProp(m, st, a, 0x113) | 0),
    /** =Wb Init Vslide Gadget(...) --- routine 84 ($3274), routine 83 then pi_Flags $115 */
    'wb init vslide gadget': (_, a) => VI(initProp(m, st, a, 0x115) | 0),
    /** =Wb Init Mslide Gadget(...) --- routine 86 ($32ea), routine 83 then pi_Flags $117 */
    'wb init mslide gadget': (_, a) => VI(initProp(m, st, a, 0x117) | 0),

    /**
     * =Wb Init Str Gadget(NUM,X,Y,W,H,STRADR,MAX,VIS,FLAG) --- routine 85
     * ($3284). $50 bytes: Gadget 44 plus StringInfo 36, exactly.
     *
     *     $32ae  move.w  d0,$3c(a0)    ; VIS
     *     $32b4  move.w  d0,$36(a0)    ; MAX
     *     $32b8  move.l  (a3)+,$2c(a0) ; STRADR
     *
     * $2c is the StringInfo base, so $36 is si_MaxChars and $3c is
     * si_NumChars.
     *
     * DEFECT: VIS is si_DispCount's job. The guide calls it "Nombre max. de
     * caractère visible." and si_DispCount at StringInfo+$12 is "number of
     * whole characters visible in Container" (`intuition.i`:452); si_NumChars
     * at +$10 is "number of characters currently in Buffer". Two bytes low,
     * and the effect is that a gadget opened over an empty buffer tells
     * Intuition the buffer already holds VIS characters.
     *
     * MAX goes in raw. si_MaxChars counts the terminating NUL, so a string
     * gadget made this way holds MAX-1 characters --- one fewer than
     * `Wb Init Num Gadget`, which adds 1 first.
     */
    'wb init str gadget': (_, a) => {
      const addr = initGadget(IE_GADGET_STR_SIZE, a, GTYP_STRGADGET, 0x0b, 8)
      if (addr === 0) return VI(0)
      m.setLong(addr + GG.SPECIAL, addr + GG.SIZEOF)
      m.setLong(addr + GG.SIZEOF + SI.BUFFER, i0(a, 5))
      m.setWord(addr + GG.SIZEOF + SI.MAXCHARS, i0(a, 6))
      m.setWord(addr + GG.SIZEOF + SI.NUMCHARS, i0(a, 7))
      return VI(addr | 0)
    },

    /**
     * =Wb Init Num Gadget(NUM,X,Y,W,H,STRADR,MAX,FLAG) --- routine 98
     * ($34c4). The same $50 block as the string gadget.
     *
     * The guide's Gad3 gives it SIX arguments, `(NUM,X,Y,W,H,FLAG)`. The
     * token table's spec has EIGHT and the routine pops eight, at $34e6,
     * $34ec, $34f4, $34f8, $34fe, $3504, $350a and $3516. STRADR and MAX are
     * undocumented and mandatory: a program written from the guide gets its
     * FLAG read as STRADR.
     *
     *     $34ee  addq.w  #$1,d0
     *     $34f0  move.w  d0,$36(a0)    ; si_MaxChars = MAX + 1
     *     $351c  move.w  #$a0b,$e(a0)
     *
     * $a0b is $b plus GACT_LONGINT ($0800) and GACT_STRINGCENTER ($0200), so
     * a number gadget is a centred string gadget that parses its buffer into
     * si_LongInt.
     */
    'wb init num gadget': (_, a) => {
      const addr = initGadget(IE_GADGET_STR_SIZE, a, GTYP_STRGADGET, 0x0a0b, 7)
      if (addr === 0) return VI(0)
      m.setLong(addr + GG.SPECIAL, addr + GG.SIZEOF)
      m.setLong(addr + GG.SIZEOF + SI.BUFFER, i0(a, 5))
      m.setWord(addr + GG.SIZEOF + SI.MAXCHARS, i0(a, 6) + 1)
      return VI(addr | 0)
    },

    /**
     * =Wb Icon Image(ICON) --- routine 100 ($352e).
     *
     * The same twenty bytes `Wb Bob Image` builds, over the Icon bank instead
     * of the Bob bank: `Rjsr L_Bnk_GetIcons`, skip the count word, index the
     * pointer table by 8, and point ImageData at the block's data.
     *
     *     $3562  move.w  (a2),d0
     *     $3564  mulu.w  #$10,d0       ; width words -> pixels
     *     $356c  move.w  $2(a2),$6(a1) ; height
     *     $3572  move.w  $4(a2),$8(a1) ; depth
     *     $3578  adda.l  #$a,a2        ; past the five header words
     *
     * PlanePick is 3 and PlaneOnOff is left at zero, so however deep the icon
     * really is, two planes of it are drawn.
     *
     * Routine 101 is the same code with `addq.w #$2,d7` where this has
     * `addq.l #$2,d7`, and an `asl.l` where this has `rol.l`. The word form
     * in `Wb Bob Image` cannot carry into the high word of the bank address.
     */
    'wb icon image': (_, a) => {
      const n = i0(a, 0)
      const bank = rt.iconBank
      if (!bank || n === 0) return VI(0)
      const img = bank.images[n - 1]
      if (!img) return VI(0)
      const addr = st().heap.alloc(IE_IMAGE_SIZEOF, { clear: true })
      if (addr === 0) return VI(0)
      m.setWord(addr + IG.WIDTH, img.width)
      m.setWord(addr + IG.HEIGHT, img.height)
      m.setWord(addr + IG.DEPTH, img.depth)
      let off = 2
      for (let i = 0; i < n - 1; i++) {
        const p = bank.images[i]
        if (!p) break
        off += 10 + (p.width >> 4) * 2 * p.height * p.depth
      }
      m.setLong(addr + IG.DATA, (rt.bankBase(ICON_BANK) + off + 10) | 0)
      m.setByte(addr + IG.PICK, 3)
      return VI(addr | 0)
    },

    /**
     * =Wb Hpos(SLID) --- routine 104 ($3618), and
     * =Wb Vpos(SLID) --- routine 105 ($3628).
     *
     * `gg_SpecialInfo` then `pi_HorizPot` or `pi_VertPot`, read as an
     * unsigned word into a cleared d3. So the answer is 0..65535 and not the
     * 0..100 the guide's "compteur" suggests: it is MAXPOT scaled, which is
     * what Intuition writes there when the knob is dragged.
     */
    'wb hpos': (_, a) => VI(potAt(rt, m, i0(a, 0), PI.HPOT)),
    'wb vpos': (_, a) => VI(potAt(rt, m, i0(a, 0), PI.VPOT)),

    /**
     * =Wb Gadget Id(GADADR) --- routine 223 ($4836).
     *
     *     $4838  move.w  $26(a0),d3
     *     $483c  andi.l  #$ffff,d3
     *
     * The `move.w` leaves d3's high word alone, so the mask is what makes the
     * answer unsigned rather than sign-extended.
     *
     * The guide calls the result a "Position du gadget dans la liste des
     * gadgets". It is not a position: it is gg_GadgetID, the NUM
     * the program itself passed to `Wb Init * Gadget`. The two agree only for
     * a program that numbered its gadgets in list order.
     */
    'wb gadget id': (_, a) => {
      const gad = i0(a, 0) >>> 0
      if (gad === 0) return VI(0)
      return VI(m.word(gad + GG.ID) & 0xffff)
    },
  }
}

/* ------------------------------------------------------------------ */

/** routine 83's block, with only pi_Flags differing between the three sizes */
function initProp(m: Mem, st: () => IntuiextendState, a: Value[], flags: number): number {
  const i = (n: number): number => int(a[n] ?? VI(0)) | 0
  const addr = st().heap.alloc(IE_GADGET_PROP_SIZE, { clear: true })
  if (addr === 0) return 0
  const pi = addr + GG.SIZEOF
  m.setLong(addr + GG.SPECIAL, pi)
  m.setLong(addr + GG.RENDER, pi + PI.SIZEOF)
  m.setWord(addr + GG.FLAGS, i(5))
  m.setLong(pi + PI.HPOT, -1)
  m.setLong(pi + PI.HBODY, -1)
  m.setWord(addr + GG.HEIGHT, i(4))
  m.setWord(addr + GG.WIDTH, i(3))
  m.setWord(addr + GG.TOP, i(2))
  m.setWord(addr + GG.LEFT, i(1))
  m.setWord(addr + GG.TYPE, GTYP_PROPGADGET)
  m.setWord(addr + GG.ID, i(0))
  m.setWord(addr + GG.ACTIVATION, 0x0b)
  m.setWord(pi + PI.FLAGS, flags)
  return addr
}

/** one `struct Border` and its point list, as `Wb Bevel Gadget` writes them */
function writeBorder(m: Mem, at: number, pen: number, xy: readonly number[], next: number): void {
  m.setByte(at + BD.FRONTPEN, pen)
  m.setByte(at + BD.DRAWMODE, 1)
  m.setByte(at + BD.COUNT, xy.length >> 1)
  m.setLong(at + BD.XY, at + 0x10)
  m.setLong(at + BD.NEXT, next)
  for (let i = 0; i < xy.length; i++) m.setWord(at + 0x10 + i * 2, xy[i]!)
}

/** OffGadget and OnGadget, which differ only in the bit's direction */
function disable(rt: Runtime, wind: number, gad: number, off: boolean): void {
  const m = mem(rt)
  if (!ieWindowAt(rt, wind) || gad === 0) return
  const f = m.word(gad + GG.FLAGS)
  m.setWord(gad + GG.FLAGS, off ? f | GFLG_GADGDISABLED : f & ~GFLG_GADGDISABLED)
  refresh(rt, gad)
}

/** the three justification keywords: set one of the two bits, clear the other */
function justify(rt: Runtime, gad: number, bit: number): void {
  if (gad === 0) return
  const m = mem(rt)
  const f = (m.word(gad + GG.ACTIVATION) & ~0x0600) | bit
  m.setWord(gad + GG.ACTIVATION, f)
  refresh(rt, gad)
}

/** pi_HorizPot or pi_VertPot of a gadget, with the model's own value first */
function potAt(rt: Runtime, m: Mem, gad: number, field: number): number {
  if (gad === 0) return 0
  const live = rt.intuiextend.gadgets.live.get(gad >>> 0)
  if (live) ieGadgetPush(rt, gad, live.g)
  const sp = m.long(gad + GG.SPECIAL)
  if (sp === 0) return 0
  return m.word(sp + field) & 0xffff
}

/** re-read a block that a keyword has just written, and redraw if it is live */
function refresh(rt: Runtime, gad: number): void {
  if (!rt.intuiextend.gadgets.live.has(gad >>> 0)) return
  ieGadgetPull(rt, gad)
  rt.intuition.invalidate()
}

/**
 * Read a gadget block into the `UserGadget` ../amiga/intuition.ts renders and
 * hit-tests, reusing the one already linked into a window if there is one.
 *
 * Reusing it matters: the window's gadget list holds the OBJECT, so replacing
 * it would leave the list pointing at the old one.
 */
export function ieGadgetPull(rt: Runtime, gad: number): UserGadget | null {
  if (gad === 0) return null
  const m = mem(rt)
  const live = rt.intuiextend.gadgets.live.get(gad >>> 0)
  const g: UserGadget = live?.g ?? { leftEdge: 0, topEdge: 0, width: 0, height: 0, id: 0 }
  g.leftEdge = lo(m.word(gad + GG.LEFT))
  g.topEdge = lo(m.word(gad + GG.TOP))
  g.width = lo(m.word(gad + GG.WIDTH))
  g.height = lo(m.word(gad + GG.HEIGHT))
  g.id = m.word(gad + GG.ID) & 0xffff
  g.kind = m.word(gad + GG.TYPE) & 0xffff
  g.flags = m.word(gad + GG.FLAGS) & 0xffff
  g.activation = m.word(gad + GG.ACTIVATION) & 0xffff

  const render = m.long(gad + GG.RENDER)
  const select = m.long(gad + GG.SELECT)
  delete g.borders
  delete g.selectBorders
  delete g.image
  delete g.selectImage
  if ((g.flags & GFLG_GADGIMAGE) !== 0) {
    const im = ieReadImage(rt, render)
    const sel = ieReadImage(rt, select)
    if (im) g.image = im
    if (sel) g.selectImage = sel
  } else {
    const bs = readBorders(m, render)
    const sel = select === 0 ? undefined : readBorders(m, select)
    if (bs) g.borders = bs
    if (sel) g.selectBorders = sel
  }

  const sp = m.long(gad + GG.SPECIAL)
  delete g.prop
  delete g.strInfo
  if (g.kind === GTYP_PROPGADGET && sp !== 0) {
    g.prop = {
      flags: m.word(sp + PI.FLAGS) & 0xffff,
      horizPot: m.word(sp + PI.HPOT) & 0xffff,
      vertPot: m.word(sp + PI.VPOT) & 0xffff,
      horizBody: m.word(sp + PI.HBODY) & 0xffff,
      vertBody: m.word(sp + PI.VBODY) & 0xffff,
    }
  }
  if (g.kind === GTYP_STRGADGET && sp !== 0) {
    const buf = m.long(sp + SI.BUFFER)
    const max = m.word(sp + SI.MAXCHARS) & 0xffff
    g.strInfo = {
      buffer: buf === 0 ? '' : readString(m, buf, Math.max(0, max - 1)),
      maxChars: max,
      bufferPos: m.word(sp + SI.BUFPOS) & 0xffff,
      longInt: 0,
    }
  }
  return g
}

/**
 * Write back the fields Intuition owns, which is the other half of the seam.
 *
 * Only three things change behind the program's back: the pot words when a
 * knob is dragged, the SELECTED and DISABLED bits, and a string gadget's
 * buffer. Everything else in the block is the program's and is left alone.
 */
export function ieGadgetPush(rt: Runtime, gad: number, g: UserGadget): void {
  if (gad === 0) return
  const m = mem(rt)
  m.setWord(gad + GG.FLAGS, g.flags ?? 0)
  const sp = m.long(gad + GG.SPECIAL)
  if (sp === 0) return
  if (g.prop !== undefined) {
    m.setWord(sp + PI.HPOT, g.prop.horizPot)
    m.setWord(sp + PI.VPOT, g.prop.vertPot)
  }
  const si = g.strInfo
  if (si !== undefined) {
    const buf = m.long(sp + SI.BUFFER)
    if (buf !== 0) {
      const n = Math.min(si.buffer.length, Math.max(0, si.maxChars - 1))
      for (let i = 0; i < n; i++) m.setByte(buf + i, si.buffer.charCodeAt(i) & 0xff)
      m.setByte(buf + n, 0)
      m.setWord(sp + SI.NUMCHARS, n)
      m.setWord(sp + SI.BUFPOS, si.bufferPos)
    }
  }
}

/** a NUL-terminated string of at most `max` bytes */
function readString(m: Mem, at: number, max: number): string {
  let s = ''
  for (let i = 0; i < max; i++) {
    const b = m.byte(at + i)
    if (b === 0) break
    s += String.fromCharCode(b)
  }
  return s
}

/**
 * A `bd_NextBorder` chain walked out into an array.
 *
 * The cap is 16 because a chain here is built by `Wb Bevel Gadget` and is two
 * long; a program that hands in a circular one gets the walk stopped rather
 * than the interpreter hung, which is more than the 68k did.
 */
function readBorders(m: Mem, at: number): readonly Border[] | undefined {
  const out: Border[] = []
  let p = at >>> 0
  for (let n = 0; p !== 0 && n < 16; n++) {
    const count = m.byte(p + BD.COUNT)
    const xyAt = m.long(p + BD.XY)
    const xy: number[] = []
    for (let i = 0; i < count * 2; i++) xy.push(lo(m.word(xyAt + i * 2)))
    out.push({
      leftEdge: lo(m.word(p + BD.LEFT)),
      topEdge: lo(m.word(p + BD.TOP)),
      pen: m.byte(p + BD.FRONTPEN),
      xy,
    })
    p = m.long(p + BD.NEXT) >>> 0
  }
  return out.length === 0 ? undefined : out
}

/**
 * Resolve a `struct Image` and its bitplanes into one byte per pixel.
 *
 * PlanePick names which of the destination's planes each source plane feeds,
 * lowest set bit first, and PlaneOnOff supplies a constant bit for every
 * destination plane PlanePick left out --- `intuition.i`:534 and DrawImage's
 * own definition. `Wb Icon Image` and `Wb Bob Image` both write a PlanePick
 * of 3, so two source planes reach planes 0 and 1 and the rest come out of a
 * PlaneOnOff of zero.
 */
export function ieReadImage(rt: Runtime, addr: number): GadgetImage | null {
  if (addr === 0) return null
  const m = mem(rt)
  const width = m.word(addr + IG.WIDTH) & 0xffff
  const height = m.word(addr + IG.HEIGHT) & 0xffff
  const depth = m.word(addr + IG.DEPTH) & 0xffff
  const data = m.long(addr + IG.DATA) >>> 0
  if (width === 0 || height === 0 || data === 0) return null
  const pick = m.byte(addr + IG.PICK)
  const onOff = m.byte(addr + IG.ONOFF)
  const rowBytes = ((width + 15) >> 4) * 2
  const planeBytes = rowBytes * height
  const pixels = new Uint8Array(width * height)
  let src = 0
  for (let bit = 0; bit < 8; bit++) {
    if ((pick & (1 << bit)) === 0) {
      if ((onOff & (1 << bit)) !== 0) for (let i = 0; i < pixels.length; i++) pixels[i]! |= 1 << bit
      continue
    }
    const plane = src++
    if (plane >= depth) continue
    for (let y = 0; y < height; y++) {
      const row = data + plane * planeBytes + y * rowBytes
      for (let x = 0; x < width; x++) {
        const b = m.byte(row + (x >> 3))
        if ((b & (0x80 >> (x & 7))) !== 0) pixels[y * width + x]! |= 1 << bit
      }
    }
  }
  return {
    leftEdge: lo(m.word(addr + IG.LEFT)),
    topEdge: lo(m.word(addr + IG.TOP)),
    width,
    height,
    pixels,
  }
}

/** DrawImage (-$72): an opaque blit at the image's own offset plus the caller's */
function drawImage(rp: RastPort, img: GadgetImage, x: number, y: number): void {
  const mode = rp.drawMode
  const mask = rp.mask
  rp.drawMode = 0
  rp.mask = 0xff
  for (let iy = 0; iy < img.height; iy++) {
    for (let ix = 0; ix < img.width; ix++) {
      rp.plot(x + img.leftEdge + ix, y + img.topEdge + iy, img.pixels[iy * img.width + ix]!)
    }
  }
  rp.drawMode = mode
  rp.mask = mask
}
