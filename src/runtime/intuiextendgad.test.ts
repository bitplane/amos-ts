import { describe, expect, it } from 'vitest'
import { mustFinish } from '../testing/run'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/source'
import { extensionById } from '../ext/registry'
import { Runtime } from './runtime'
import {
  IE_BEVEL_SIZE,
  IE_GADGET_BOOL_SIZE,
  IE_GADGET_PROP_SIZE,
  IE_GADGET_STR_SIZE,
} from './intuiextendgad'

const table = new TokenTable(CORE_TOKENS)
const ie = extensionById('intuiextend-2.01b')!

function run(src: string): { rt: Runtime; out: () => string } {
  const exts = new Map([[23, ie.table]])
  let printed = ''
  const rt = new Runtime(tokenize(src, table, exts), table, {
    extensions: exts,
    extBindings: new Map([[23, ie]]),
    maxSteps: 500_000,
    onText: (t) => (printed += t),
  })
  mustFinish(rt.runHeadless(5000))
  return { rt, out: () => printed }
}

const lines = (src: string): string[] =>
  run(src)
    .out()
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '')

/** a window on a custom screen, which most of these need before a gadget matters */
const OPEN = 'Wb Screen Open 0,0,320,200,3,0\nS=Wb Screen Base\nWb Wind Open S To 10,20,200,100,0\nW=Wb Wind Base\n'

/** read a word out of the gadget block the way the library would */
const word = (rt: Runtime, addr: number): number => {
  const m = rt.resolveAddr(addr >>> 0)!
  return ((m.data[m.off]! << 8) | m.data[m.off + 1]!) & 0xffff
}
const long = (rt: Runtime, addr: number): number => rt.longsAt(addr >>> 0, false)!.get(0)

/** screen 0's RastPort, which is its Screen address plus $54 */
const RP = (Runtime.SCREEN_CTRL_BASE + 0x54) >>> 0

describe('IntuiExtend 2.01b — the gadget blocks', () => {
  /**
   *     $3194  move.l  #$74,-(a3)      ; bool and toggle
   *     $3202  move.l  #$56,-(a3)      ; the three sliders
   *     $3284  move.l  #$50,-(a3)      ; str, and $34c4 num
   */
  it('allocates the three sizes the routines name', () => {
    expect([IE_GADGET_BOOL_SIZE, IE_GADGET_PROP_SIZE, IE_GADGET_STR_SIZE]).toEqual([0x74, 0x56, 0x50])
    expect(IE_BEVEL_SIZE).toBe(0x90)
  })

  /** $56 is Gadget 44 + PropInfo 22 + Image 20 with nothing left over */
  it('the slider block is its three structures added up', () => {
    expect(IE_GADGET_PROP_SIZE).toBe(44 + 22 + 20)
    expect(IE_GADGET_STR_SIZE).toBe(44 + 36)
  })

  it('writes LeftEdge, TopEdge, Width, Height, Flags, Type, Id and Activation', () => {
    const b = run('G=Wb Init Bool Gadget(7,10,20,80,15,3)\nPrint G')
    const g = Number(b.out().trim())
    expect(word(b.rt, g + 4)).toBe(10) // gg_LeftEdge
    expect(word(b.rt, g + 6)).toBe(20) // gg_TopEdge
    expect(word(b.rt, g + 8)).toBe(80) // gg_Width
    expect(word(b.rt, g + 0x0a)).toBe(15) // gg_Height
    expect(word(b.rt, g + 0x0c)).toBe(3) // gg_Flags, the guide's FLAG
    expect(word(b.rt, g + 0x10)).toBe(1) // GTYP_BOOLGADGET
    expect(word(b.rt, g + 0x26)).toBe(7) // gg_GadgetID
    // $31d4 move.w #$b,$e(a0) — RELVERIFY|GADGIMMEDIATE|FOLLOWMOUSE
    expect(word(b.rt, g + 0x0e)).toBe(0x0b)
  })

  /** $31fa move.w #$10b,$e(a0): the one bit that separates the two keywords */
  it('Wb Init Toggle Gadget differs only by GACT_TOGGLESELECT', () => {
    const b = run('G=Wb Init Toggle Gadget(7,10,20,80,15,0)\nPrint G')
    const g = Number(b.out().trim())
    expect(word(b.rt, g + 0x0e)).toBe(0x010b)
    expect(word(b.rt, g + 0x10)).toBe(1)
  })

  /**
   *     $3226  addi.w  #$2c,d0
   *     $322a  move.l  d0,$22(a0)     ; gg_SpecialInfo
   *     $322e  addi.w  #$16,d0
   *     $3232  move.l  d0,$12(a0)     ; gg_GadgetRender
   */
  it('a slider points SpecialInfo and GadgetRender inside its own block', () => {
    const b = run('G=Wb Init Hslide Gadget(3,0,0,100,10,0)\nPrint G')
    const g = Number(b.out().trim())
    expect(long(b.rt, g + 0x22)).toBe(g + 0x2c)
    expect(long(b.rt, g + 0x12)).toBe(g + 0x2c + 0x16)
    expect(word(b.rt, g + 0x10)).toBe(3) // GTYP_PROPGADGET
  })

  /** $323a and $3242 write both pot words and both body words as two longs */
  it('starts a slider at MAXPOT and MAXBODY on both axes', () => {
    const b = run('G=Wb Init Vslide Gadget(3,0,0,10,100,0)\nPrint G')
    const g = Number(b.out().trim())
    const pi = g + 0x2c
    expect(word(b.rt, pi + 2)).toBe(0xffff)
    expect(word(b.rt, pi + 4)).toBe(0xffff)
    expect(word(b.rt, pi + 6)).toBe(0xffff)
    expect(word(b.rt, pi + 8)).toBe(0xffff)
  })

  /**
   * $325a, $327c and $32f2: the three sliders differ in pi_Flags alone, and
   * every one of them carries KNOBHIT.
   */
  it('ships every slider with KNOBHIT already set', () => {
    const h = run('G=Wb Init Hslide Gadget(1,0,0,50,10,0)\nPrint G')
    const v = run('G=Wb Init Vslide Gadget(1,0,0,10,50,0)\nPrint G')
    const mm = run('G=Wb Init Mslide Gadget(1,0,0,50,50,0)\nPrint G')
    expect(word(h.rt, Number(h.out().trim()) + 0x2c)).toBe(0x113)
    expect(word(v.rt, Number(v.out().trim()) + 0x2c)).toBe(0x115)
    expect(word(mm.rt, Number(mm.out().trim()) + 0x2c)).toBe(0x117)
    // KNOBHIT is $0100, intuition.i:426 — "set when this Knob is hit"
    for (const f of [0x113, 0x115, 0x117]) expect(f & 0x100).toBe(0x100)
  })
})

describe('IntuiExtend 2.01b — the string and number gadgets', () => {
  /**
   * DEFECT: $32ae puts VIS in si_NumChars at StringInfo+$10, where the guide
   * describes si_DispCount at +$12.
   */
  it('Wb Init Str Gadget puts VIS in si_NumChars, not si_DispCount', () => {
    const b = run('B=0\nG=Wb Init Str Gadget(2,0,0,90,10,B,32,8,0)\nPrint G')
    const g = Number(b.out().trim())
    const si = g + 0x2c
    expect(word(b.rt, si + 0x10)).toBe(8) // si_NumChars got VIS
    expect(word(b.rt, si + 0x12)).toBe(0) // si_DispCount never written
    expect(word(b.rt, si + 0x0a)).toBe(32) // si_MaxChars got MAX, raw
    expect(word(b.rt, g + 0x10)).toBe(4) // GTYP_STRGADGET
  })

  /**
   * The guide's Gad3 gives Wb Init Num Gadget six arguments. The token table
   * spec has eight and the routine pops eight.
   */
  it('Wb Init Num Gadget takes eight arguments and adds one to MAX', () => {
    const b = run('B=0\nG=Wb Init Num Gadget(4,0,0,60,10,B,10,0)\nPrint G')
    const g = Number(b.out().trim())
    expect(word(b.rt, g + 0x2c + 0x0a)).toBe(11) // $34ee addq.w #$1,d0
    // $351c move.w #$a0b,$e(a0) — LONGINT|STRINGCENTER on top of the usual $b
    expect(word(b.rt, g + 0x0e)).toBe(0x0a0b)
    expect(word(b.rt, g + 0x26)).toBe(4)
  })

  it('the spec really is eight arguments, so the guide would misfeed it', () => {
    const t = ie.tokens.find((e) => e.name === 'wb init num gadget')!
    expect(t.spec.split(',').length).toBe(8)
  })
})

describe('IntuiExtend 2.01b — justification and the slider look', () => {
  /**
   *     $3794  bclr.b #$1,$e(a0) / bclr.b #$2,$e(a0)   left
   *     $37ea  bset.b #$1 / bclr.b #$2                 centre
   *     $37fa  bclr.b #$1 / bset.b #$2                 right
   *
   * $e is the HIGH byte of the gg_Activation word, so the bits are $0200 and
   * $0400: GACT_STRINGCENTER and GACT_STRINGRIGHT.
   */
  it('Wb Set Str Centre and Right are exclusive, and Left clears both', () => {
    const mk = 'B=0\nG=Wb Init Str Gadget(1,0,0,80,10,B,16,4,0)\n'
    const c = run(`${mk}Wb Set Str Centre G\nPrint G`)
    const g1 = Number(c.out().trim())
    expect(word(c.rt, g1 + 0x0e) & 0x0600).toBe(0x0200)

    const r = run(`${mk}Wb Set Str Centre G\nWb Set Str Right G\nPrint G`)
    const g2 = Number(r.out().trim())
    expect(word(r.rt, g2 + 0x0e) & 0x0600).toBe(0x0400)

    const l = run(`${mk}Wb Set Str Right G\nWb Set Str Left G\nPrint G`)
    const g3 = Number(l.out().trim())
    expect(word(l.rt, g3 + 0x0e) & 0x0600).toBe(0)
  })

  it('leaves the rest of gg_Activation alone', () => {
    const b = run('B=0\nG=Wb Init Num Gadget(1,0,0,60,10,B,8,0)\nWb Set Str Right G\nPrint G')
    const g = Number(b.out().trim())
    // $a0b started centred; right must clear only $0200 and set only $0400
    expect(word(b.rt, g + 0x0e)).toBe(0x0c0b)
  })

  /** $37e2 bchg.b #$4,$2d(a0): PROPNEWLOOK, in the low byte of pi_Flags */
  it('Wb Slide Swap Look toggles PROPNEWLOOK and nothing else', () => {
    const b = run('G=Wb Init Hslide Gadget(1,0,0,50,10,0)\nWb Slide Swap Look G\nPrint G')
    const g = Number(b.out().trim())
    expect(word(b.rt, g + 0x2c)).toBe(0x113 ^ 0x10)
    const t = run('G=Wb Init Hslide Gadget(1,0,0,50,10,0)\nWb Slide Swap Look G\nWb Slide Swap Look G\nPrint G')
    expect(word(t.rt, Number(t.out().trim()) + 0x2c)).toBe(0x113)
  })
})

describe('IntuiExtend 2.01b — gadgets in a window', () => {
  it('Wb Insert Gadget puts the gadget in the window list', () => {
    const b = run(`${OPEN}G=Wb Init Bool Gadget(5,10,10,60,12,0)\nWb Insert Gadget W To G`)
    const w = b.rt.intuiextend.windowState.windows.get(b.rt.intuiextend.windBase)!
    expect(w.win.gadgets.length).toBe(1)
    expect(w.win.gadgets[0]!.id).toBe(5)
    expect([w.win.gadgets[0]!.leftEdge, w.win.gadgets[0]!.width]).toEqual([10, 60])
  })

  it('Wb Remove Gadget takes it out again without freeing the block', () => {
    const src = `${OPEN}G=Wb Init Bool Gadget(5,10,10,60,12,0)\nWb Insert Gadget W To G\nWb Remove Gadget W,G\nPrint G`
    const b = run(src)
    const w = b.rt.intuiextend.windowState.windows.get(b.rt.intuiextend.windBase)!
    expect(w.win.gadgets.length).toBe(0)
    // the block is still there: gg_GadgetID reads back
    expect(word(b.rt, Number(b.out().trim()) + 0x26)).toBe(5)
  })

  /** GFLG_GADGDISABLED is $0100, intuition.i:277 */
  it('Wb Off Gadget and Wb On Gadget move GADGDISABLED', () => {
    const mk = `${OPEN}G=Wb Init Bool Gadget(5,10,10,60,12,0)\nWb Insert Gadget W To G\n`
    const off = run(`${mk}Wb Off Gadget W,G\nPrint G`)
    expect(word(off.rt, Number(off.out().trim()) + 0x0c) & 0x100).toBe(0x100)
    const on = run(`${mk}Wb Off Gadget W,G\nWb On Gadget W,G\nPrint G`)
    expect(word(on.rt, Number(on.out().trim()) + 0x0c) & 0x100).toBe(0)
  })

  it('Wb Gadget Id answers gg_GadgetID and not a list position', () => {
    const src = `${OPEN}G=Wb Init Bool Gadget(200,0,0,10,10,0)\nH=Wb Init Bool Gadget(9,0,20,10,10,0)
Wb Insert Gadget W To G
Wb Insert Gadget W To H
Print Wb Gadget Id(G);" ";Wb Gadget Id(H)`
    // G went in first, so a position would be 0 and 1; the ids are what come back
    expect(lines(src)).toEqual(['200  9'])
  })

  /**
   *     $32fc  move.w  #$13,d0
   *     $3302  moveq   #-1,d4        ; vertBody
   *
   * $13 has no KNOBHIT, so the first New Hslide is also what clears the bit
   * the init routine set.
   */
  it('Wb New Hslide Gadget writes the pot and clears KNOBHIT', () => {
    const src = `${OPEN}G=Wb Init Hslide Gadget(1,5,5,100,12,0)\nWb Insert Gadget W To G\nWb New Hslide Gadget W To G,16384,8192\nPrint G`
    const b = run(src)
    const g = Number(b.out().trim())
    const pi = g + 0x2c
    expect(word(b.rt, pi)).toBe(0x13)
    expect(word(b.rt, pi + 2)).toBe(16384) // pi_HorizPot
    expect(word(b.rt, pi + 4)).toBe(0xffff) // pi_VertPot, moveq #-1
    expect(word(b.rt, pi + 6)).toBe(8192) // pi_HorizBody
    expect(word(b.rt, pi + 8)).toBe(0xffff)
  })

  it('Wb New Vslide Gadget puts its two arguments on the vertical axis', () => {
    const src = `${OPEN}G=Wb Init Vslide Gadget(1,5,5,12,100,0)\nWb Insert Gadget W To G\nWb New Vslide Gadget W To G,4096,2048\nPrint G`
    const b = run(src)
    const pi = Number(b.out().trim()) + 0x2c
    expect(word(b.rt, pi)).toBe(0x15)
    expect(word(b.rt, pi + 2)).toBe(0xffff)
    expect(word(b.rt, pi + 4)).toBe(4096)
    expect(word(b.rt, pi + 8)).toBe(2048)
  })

  it('Wb New Mslide Gadget is the only one where all four words are arguments', () => {
    const src = `${OPEN}G=Wb Init Mslide Gadget(1,5,5,80,80,0)\nWb Insert Gadget W To G\nWb New Mslide Gadget W To G,111,222,333,444\nPrint G`
    const b = run(src)
    const pi = Number(b.out().trim()) + 0x2c
    expect(word(b.rt, pi)).toBe(0x17)
    expect([word(b.rt, pi + 2), word(b.rt, pi + 4)]).toEqual([111, 222])
    expect([word(b.rt, pi + 6), word(b.rt, pi + 8)]).toEqual([333, 444])
  })

  /** $3620 move.w $2(a0),d3 into a cleared d3: unsigned, so 0..65535 */
  it('Wb Hpos and Wb Vpos read the pot words unsigned', () => {
    const src = `${OPEN}G=Wb Init Mslide Gadget(1,5,5,80,80,0)\nWb Insert Gadget W To G
Wb New Mslide Gadget W To G,65535,40000,100,100
Print Wb Hpos(G);" ";Wb Vpos(G)`
    expect(lines(src)).toEqual(['65535  40000'])
  })
})

describe('IntuiExtend 2.01b — the two keywords that do nothing', () => {
  /**
   * DEFECT: routine 166 loads a0/a1/d0 for RefreshGList and jumps to -$1bc,
   * which is RemoveGList. RefreshGList is -$1b0.
   */
  it('Wb Refresh All Gadget leaves the list exactly as it was', () => {
    const src = `${OPEN}G=Wb Init Bool Gadget(1,0,0,10,10,0)\nH=Wb Init Bool Gadget(2,0,20,10,10,0)
Wb Insert Gadget W To G
Wb Insert Gadget W To H
Wb Refresh All Gadget W`
    const b = run(src)
    const w = b.rt.intuiextend.windowState.windows.get(b.rt.intuiextend.windBase)!
    expect(w.win.gadgets.map((g) => g.id)).toEqual([1, 2])
  })

  /** DEFECT: routine 182's RemoveGList is correct but numGad is zero */
  it('Wb Remove All Gadget removes none of them', () => {
    const src = `${OPEN}G=Wb Init Bool Gadget(1,0,0,10,10,0)\nH=Wb Init Bool Gadget(2,0,20,10,10,0)
Wb Insert Gadget W To G
Wb Insert Gadget W To H
Wb Remove All Gadget W`
    const b = run(src)
    const w = b.rt.intuiextend.windowState.windows.get(b.rt.intuiextend.windBase)!
    expect(w.win.gadgets.map((g) => g.id)).toEqual([1, 2])
  })
})

describe('IntuiExtend 2.01b — bevels and images', () => {
  /**
   * $90 in two 72-byte halves. The first border of the first half is
   * (W-1,0) (0,0) (0,H) (1,H-1) (1,0) in pen 2.
   */
  it('Wb Bevel Gadget builds two Border chains of five points each', () => {
    const b = run('G=Wb Init Bool Gadget(1,0,0,40,20,0)\nWb Bevel Gadget G\nPrint G')
    const g = Number(b.out().trim())
    const render = long(b.rt, g + 0x12)
    const select = long(b.rt, g + 0x16)
    expect(select - render).toBe(0x48)
    // bd_Count and bd_FrontPen of the shine border
    const byteAt = (a: number): number => {
      const m = b.rt.resolveAddr(a >>> 0)!
      return m.data[m.off]!
    }
    expect(byteAt(render + 7)).toBe(5)
    expect(byteAt(render + 4)).toBe(2)
    // and the shadow border it chains to, at +$24, in pen 1
    expect(long(b.rt, render + 0x0c)).toBe(render + 0x24)
    expect(byteAt(render + 0x24 + 4)).toBe(1)
    expect(long(b.rt, render + 0x24 + 0x0c)).toBe(0)
    // the SelectRender half swaps the two pens, which is the pressed look
    expect(byteAt(select + 4)).toBe(1)
    expect(byteAt(select + 0x24 + 4)).toBe(2)
  })

  it('the shine polyline is the top and left edges', () => {
    const b = run('G=Wb Init Bool Gadget(1,0,0,40,20,0)\nWb Bevel Gadget G\nPrint G')
    const g = Number(b.out().trim())
    const render = long(b.rt, g + 0x12)
    const xy = long(b.rt, render + 8)
    const pts: number[] = []
    for (let i = 0; i < 10; i++) pts.push(word(b.rt, xy + i * 2))
    expect(pts).toEqual([39, 0, 0, 0, 0, 20, 1, 19, 1, 0])
  })

  /**
   *     $3998  move.l  d1,$16(a0) / bset.b #$1,d0   IM2, GADGHIMAGE
   *     $39a6  move.l  d1,$12(a0) / bset.b #$2,d0   IM1, GADGIMAGE
   */
  it('Wb Gadget Image sets GADGIMAGE, and GADGHIMAGE only when IM2 is given', () => {
    const one = run('G=Wb Init Bool Gadget(1,0,0,16,16,0)\nWb Gadget Image 12345,0 To G\nPrint G')
    const g1 = Number(one.out().trim())
    expect(long(one.rt, g1 + 0x12)).toBe(12345)
    expect(word(one.rt, g1 + 0x0c)).toBe(0x0004)

    const two = run('G=Wb Init Bool Gadget(1,0,0,16,16,0)\nWb Gadget Image 111,222 To G\nPrint G')
    const g2 = Number(two.out().trim())
    expect(long(two.rt, g2 + 0x12)).toBe(111)
    expect(long(two.rt, g2 + 0x16)).toBe(222)
    expect(word(two.rt, g2 + 0x0c)).toBe(0x0006)
  })

  it('Wb Icon Image answers zero without an Icon bank', () => {
    expect(lines('Print Wb Icon Image(1)')).toEqual(['0'])
  })

  it('Wb Draw Image with no image and no RastPort does nothing', () => {
    expect(lines('Wb Draw Image 0 To 0,0,0\nPrint "ok"')).toEqual(['ok'])
  })

  /**
   * A `struct Image` built by hand: 16 wide, 2 high, one plane, with the
   * leftmost pixel of row 0 and the rightmost of row 1 set. PlanePick of 1
   * sends that plane to destination plane 0 and PlaneOnOff of 0 leaves the
   * rest clear, so a set bit is colour 1.
   */
  const IMAGE = `Screen Open 0,320,256,16,Lowres
Cls 0
D=Alloc Mem(4,$10001)
I=Alloc Mem(20,$10001)
Doke I+4,16 : Doke I+6,2 : Doke I+8,1
Loke I+10,D
Poke I+14,1
Doke D,$8000 : Doke D+2,$0001
`

  it('Wb Draw Image blits the planes at the offset it is given', () => {
    const b = run(`${IMAGE}Wb Draw Image I To ${RP},5,7`)
    const rp = b.rt.screen!.rp
    expect(rp.point(5, 7)).toBe(1) // row 0, bit 15
    expect(rp.point(6, 7)).toBe(0)
    expect(rp.point(20, 8)).toBe(1) // row 1, bit 0, so 5 + 15
    expect(rp.point(19, 8)).toBe(0)
  })

  /** DrawImage adds ig_LeftEdge and ig_TopEdge to the caller's offsets */
  it('adds the Image own LeftEdge and TopEdge to the offsets', () => {
    const b = run(`${IMAGE}Doke I,3 : Doke I+2,4\nWb Draw Image I To ${RP},5,7`)
    expect(b.rt.screen!.rp.point(8, 11)).toBe(1)
    expect(b.rt.screen!.rp.point(5, 7)).toBe(0)
  })

  /**
   * The same image reached through a gadget: GADGIMAGE means gg_GadgetRender
   * is a `struct Image`, and inserting the gadget is what resolves it.
   */
  it('Wb Insert Gadget decodes a GADGIMAGE gadget into the model', () => {
    const src = `${IMAGE}Wb Wind Open 0 To 10,20,200,100,0
W=Wb Wind Base
G=Wb Init Bool Gadget(1,4,4,16,2,0)
Wb Gadget Image I,0 To G
Wb Insert Gadget W To G`
    const b = run(src)
    const w = b.rt.intuiextend.windowState.windows.get(b.rt.intuiextend.windBase)!
    const img = w.win.gadgets[0]!.image!
    expect([img.width, img.height]).toEqual([16, 2])
    expect(img.pixels[0]).toBe(1)
    expect(img.pixels[1]).toBe(0)
    expect(img.pixels[31]).toBe(1)
    expect(w.win.gadgets[0]!.borders).toBeUndefined()
  })
})

describe('IntuiExtend 2.01b — activating a gadget', () => {
  /** ActivateGadget (-$1ce) takes a STRGADGET and refuses anything else */
  it('Wb Activate Gadget puts the cursor in a string gadget', () => {
    const src = `${OPEN}B=Alloc Mem(32,$10001)
G=Wb Init Str Gadget(1,5,5,80,10,B,16,4,0)
Wb Insert Gadget W To G
Wb Activate Gadget W,G`
    const b = run(src)
    expect(b.rt.intuition.stringActive()).toBe(true)
  })

  it('refuses a boolean gadget, which is what Intuition does', () => {
    const src = `${OPEN}G=Wb Init Bool Gadget(1,5,5,80,10,0)\nWb Insert Gadget W To G\nWb Activate Gadget W,G`
    expect(run(src).rt.intuition.stringActive()).toBe(false)
  })

  it('refuses a gadget that was never inserted', () => {
    const src = `${OPEN}B=Alloc Mem(32,$10001)\nG=Wb Init Str Gadget(1,5,5,80,10,B,16,4,0)\nWb Activate Gadget W,G`
    expect(run(src).rt.intuition.stringActive()).toBe(false)
  })
})

describe('IntuiExtend 2.01b — freeing', () => {
  it('the four free keywords take the block out of the live map', () => {
    const src = `${OPEN}G=Wb Init Bool Gadget(1,0,0,10,10,0)\nWb Insert Gadget W To G\nWb Free Bool Gadget G`
    const b = run(src)
    expect(b.rt.intuiextend.gadgets.live.size).toBe(0)
  })

  it('a zero address is answered before FreeMem is reached', () => {
    expect(lines('Wb Free Str Gadget 0\nWb Free Slide Gadget 0\nPrint "ok"')).toEqual(['ok'])
  })
})
