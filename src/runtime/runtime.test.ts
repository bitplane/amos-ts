import { describe, expect, it } from 'vitest'
import { mustFinish } from '../testing/run'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/source'
import { Machine } from '../amiga/machine'
import { Runtime } from './runtime'
import { FONT8 } from './font.gen'
import { CYCLES_PER_DISPATCH, VBL_HZ } from '../amiga/paula'
import { M68020 } from '../amiga/cpu'

const table = new TokenTable(CORE_TOKENS)

function boot(src: string): Runtime {
  return new Runtime(tokenize(src, table), table, { maxSteps: 200_000 })
}

/** run headless to completion and return the runtime for inspection */
function run(src: string): Runtime {
  const rt = boot(src)
  const r = rt.runHeadless(1_000)
  mustFinish(r)
  return rt
}

/** run and capture the text transcript */
function runOut(src: string): string {
  let out = ''
  const rt = new Runtime(tokenize(src, table), table, { maxSteps: 200_000, onText: (t) => (out += t) })
  const r = rt.runHeadless(1_000)
  mustFinish(r)
  return out
}

describe('screens', () => {
  it('boots with the default orange screen 0', () => {
    const rt = boot('')
    const s = rt.screen
    expect([s.width, s.height, s.nColors]).toEqual([320, 200, 16])
    expect(s.palette[1]).toBe(0xa40)
    expect(s.point(10, 10)).toBe(1) // cleared to paper 1
    expect(s.pen).toBe(2)
  })

  it('opens, selects and closes screens', () => {
    const rt = run('Screen Open 1,640,200,4,Hires\nPlot 5,5,3')
    const s = rt.screens.get(1)!
    expect(s.hires).toBe(true)
    expect(s.point(5, 5)).toBe(3)
    const rt2 = run('Screen Open 1,320,100,16,Lowres\nScreen 0\nPlot 7,7,4')
    expect(rt2.screens.get(0)!.point(7, 7)).toBe(4)
    expect(rt2.screens.get(1)!.point(7, 7)).not.toBe(4)
  })

  it('copies rectangles between screens', () => {
    const rt = run('Ink 5 : Bar 0,0 To 9,9\nScreen Open 1,320,200,16,Lowres\nScreen Copy 0,0,0,10,10 To 1,50,60')
    expect(rt.screens.get(1)!.point(55, 65)).toBe(5)
    expect(rt.screens.get(1)!.point(45, 65)).toBe(1)
  })
})

describe('drawing', () => {
  it('plots, draws lines and reads back with Point', () => {
    // Print would render text over the top-left pixels — verify Point in-program
    const rt = run('Ink 6 : Plot 10,10\nDraw 0,0 To 20,20\nIf Point(10,10)<>6 Then Error 1')
    expect(rt.screen.point(10, 10)).toBe(6)
    expect(rt.screen.point(0, 0)).toBe(6)
    expect(rt.screen.point(20, 20)).toBe(6)
  })

  it('draws boxes, bars, circles', () => {
    const rt = run('Ink 4 : Box 10,10 To 20,20\nInk 5 : Bar 30,10 To 40,20\nInk 6 : Circle 100,100,10')
    const s = rt.screen
    expect(s.point(10, 15)).toBe(4) // box edge
    expect(s.point(15, 15)).toBe(1) // box inside untouched (paper)
    expect(s.point(35, 15)).toBe(5) // bar filled
    expect(s.point(110, 100)).toBe(6) // circle rightmost point
    expect(s.point(100, 100)).toBe(1) // circle centre untouched
  })

  /**
   * `Cls` is not a drawing operation and does not go through a RastPort.
   *
   * `InCls5` (+Lib.s:8709) hands the rectangle to `EcCls` (+W.s:3631), which
   * clamps it against `EcTx`/`EcTy` — the screen's own width and height — and
   * calls `ClsR` (:3676). `ClsR` takes the blitter with `OwnBlit` and writes
   * `EcNPlan` planes through `BltMaskG`/`BltMaskD` and the modulos from
   * `EcTLigne`. It fetches no RastPort at all, so rp_ClipRect at offset 20 and
   * rp_DrawMode at offset 28 are never read.
   *
   * The Object Editor is what depends on it. `_XYSIZE` clears the strips
   * beside and below the resized box while `_CLIP` still has the clipping
   * window set to the box interior, so a `Cls` that obeyed the clip erased
   * nothing outside it and left one stale corner handle per 16-pixel step.
   */
  it('Cls ignores the clipping window', () => {
    const rt = run('Ink 5 : Bar 0,0 To 200,100\nClip 20,20 To 60,60\nCls 0,0,0 To 200,100\nClip')
    expect(rt.screen.point(40, 40)).toBe(0) // inside the clip
    expect(rt.screen.point(120, 80)).toBe(0) // outside it, and cleared all the same
  })

  it('Cls replaces under Gr Writing 2 rather than complementing', () => {
    // BltCon0 is %0000001111001010 — USEC|USED, minterm $CA, BltDatA held at
    // -1. With A all ones that reduces to "take B", B being the per-plane
    // colour bit. Complementing would give ~5 & 15 = 10.
    const rt = run('Ink 5 : Bar 0,0 To 200,100\nGr Writing 2\nCls 3,0,0 To 200,100\nGr Writing 1')
    expect(rt.screen.point(100, 50)).toBe(3)
  })

  it('Cls ignores Set Pattern, which belongs to Bar', () => {
    // rp_AreaPtrn is an AreaFill field and `ClsR` writes whole words per
    // plane from one colour, so there is nothing for a pattern to modulate
    const rt = run('Set Pattern 2 : Cls 7,0,0 To 100,50\nSet Pattern 0')
    expect(rt.screen.point(10, 10)).toBe(7)
    expect(rt.screen.point(11, 10)).toBe(7)
    expect(rt.screen.point(10, 11)).toBe(7)
  })

  it('flood-fills with Paint', () => {
    const rt = run('Ink 4 : Box 50,50 To 70,70\nInk 7 : Paint 60,60')
    expect(rt.screen.point(60, 60)).toBe(7)
    expect(rt.screen.point(51, 51)).toBe(7)
    expect(rt.screen.point(40, 60)).toBe(1) // outside stays paper
  })

  /**
   * `Paint` fills through `Set Pattern`, in both pens.
   *
   * `TPaint` reads rp_AreaPtrn (RastPort offset 8) and rp_AreaPtSz (29) and
   * builds one blit word per row (+W.s:4540): `and.w d1,d0` takes FgPen where
   * the pattern bit is set, `not.w d1 / and.w d2,d1 / or.w d1,d0` takes BgPen
   * where it is clear. `d7` and `d6`, rotated a bit per plane, are offsets 25
   * and 26 — FgPen and BgPen.
   *
   * Mouse-bank pattern 2 is `aaaa,5555` repeating, so row 0 is pen on the even
   * columns and row 1 is pen on the odd ones. AMOS Pro's Hardware_Sprites
   * tutorial is what a solid fill spoiled: `BIGX3` builds its max-width sprite
   * by pattern-filling a box and grabbing it, so an unpatterned Paint made the
   * "one max. width 3 coloured sprite" a featureless block.
   */
  it('Paint fills with Set Pattern, pen on the set bits and paper on the clear', () => {
    const rt = run('Set Pattern 2 : Ink 4,2 : Paint 100,100\nSet Pattern 0')
    const s = rt.screen
    expect(s.point(0, 0)).toBe(4) // $aaaa bit 15
    expect(s.point(1, 0)).toBe(2) // clear — the PAPER, not what was there
    expect(s.point(2, 0)).toBe(4)
    expect(s.point(0, 1)).toBe(2) // $5555
    expect(s.point(1, 1)).toBe(4)
  })

  it('Paint replaces under Gr Writing 2, because TPaint never reads rp_DrawMode', () => {
    // TPaint reads offsets 8, 25, 26 and 29 and never 28, so COMPLEMENT does
    // not reach it. Complementing pen 4 over paper 1 would give 14.
    const rt = run('Gr Writing 2 : Ink 4 : Paint 100,100\nGr Writing 1')
    expect(rt.screen.point(100, 100)).toBe(4)
  })

  it('applies Set Line patterns to lines and boxes', () => {
    const rt = run('Set Line %1010101010101010\nInk 6 : Draw 0,10 To 15,10')
    expect(rt.screen.point(0, 10)).toBe(6) // bit 15 set
    expect(rt.screen.point(1, 10)).toBe(1) // bit 14 clear — paper survives
    expect(rt.screen.point(2, 10)).toBe(6)
  })

  it('outlines bars with the border pen under Set Paint (AOlPen)', () => {
    const rt = run('Ink 5,,9 : Set Paint 1\nBar 20,20 To 40,40')
    expect(rt.screen.point(30, 30)).toBe(5) // fill
    expect(rt.screen.point(20, 30)).toBe(9) // outline uses Ink border arg
    const rt2 = run('Ink 5,,9 : Set Paint 0\nBar 20,20 To 40,40')
    expect(rt2.screen.point(20, 30)).toBe(5)
  })

  it('fills area patterns with ink/paper (Set Pattern via sprite image)', () => {
    const prog = [
      'Cls 0',
      'Ink 2 : Draw 0,0 To 15,0 : Rem row 0 solid, row 1 empty (Bar needs y2>y1)',
      'Get Bob 1,0,0 To 16,2',
      'Cls 0',
      'Set Pattern -1 : Ink 6,3 : Bar 100,100 To 131,103',
    ].join('\n')
    const rt = run(prog)
    expect(rt.screen.point(100, 100)).toBe(6) // pattern 1-row -> ink
    expect(rt.screen.point(100, 101)).toBe(3) // pattern 0-row -> gPaper
    expect(rt.screen.point(100, 102)).toBe(6)
  })

  it('Paint mode 0 stops at the outline colour', () => {
    const prog = ['Ink 4,,4 : Box 50,50 To 70,70', 'Ink 7 : Paint 60,60,0'].join('\n')
    const rt = run(prog)
    expect(rt.screen.point(60, 60)).toBe(7)
    expect(rt.screen.point(40, 60)).toBe(1) // border colour 4 contained it
  })

  it('Paint terminates when the fill colour is the colour it is filling', () => {
    // TPaint fills over a mask, not the screen (PMask, +W.s:4628; tested at
    // Pnt3/Pnt5, marked at Pnt7). Testing the pixels instead only terminates
    // while a filled pixel stops matching the seed colour — and painting the
    // paper colour onto the paper leaves every pixel exactly as fillable as
    // it was, so the fill never ends.
    //
    // Not a contrived pen: _rndcircles2.amos on the AMOS PD Library CD
    // (APD503) cycles `C=C+1 : If C=64 Then C=0 : Ink C` around a Circle /
    // Paint loop, so it lands on the paper colour once a cycle. It took 2 GB
    // of heap in ten seconds.
    const prog = ['Ink 4 : Box 50,50 To 70,70', 'Ink 1 : Paint 60,60'].join('\n')
    const rt = run(prog)
    // the point is that it came back at all
    expect(rt.screen.point(60, 60)).toBe(1)
    expect(rt.screen.point(51, 51)).toBe(1)
  })

  it('Paint replaces under Gr Writing 2, because TPaint hardcodes its minterm', () => {
    // The fill blit is configured once, `move.w #%0000101111001010,BltCon0`
    // (+W.s:4568) = USEA|USEC|USED minterm $CA, "inside the mask take the pen,
    // outside keep the destination". rp_DrawMode is offset 28 and TPaint reads
    // 8, 25, 26 and 29 — never 28. So Gr Writing steers Plot, Draw and Bar and
    // does not reach Paint at all.
    const prog = ['Ink 4 : Box 50,50 To 70,70', 'Gr Writing 2', 'Ink 7 : Paint 60,60'].join('\n')
    const rt = run(prog)
    expect(rt.screen.point(60, 60)).toBe(7) // the ink, not ~paper and not paper^ink
    expect(rt.screen.point(40, 60)).toBe(1) // the box still contained it
  })

  it('Paint over its own colour still writes that colour', () => {
    // TPaint has no "seed is already the fill colour, skip it" exit — its only
    // early outs are the four clip comparisons and a null tempras. The flood
    // runs in full and repaints what was already there.
    const prog = ['Ink 4 : Bar 50,50 To 70,70', 'Gr Writing 2', 'Ink 4 : Paint 60,60'].join('\n')
    const rt = run(prog)
    expect(rt.screen.point(60, 60)).toBe(4)
    expect(rt.screen.point(80, 60)).toBe(1) // outside the bar, still paper
  })

  it('Paint seeds one entry per run, so a large fill stays bounded', () => {
    // The original pushes only on the transition into an available pixel (the
    // bclr/bset #15,d5 edge flag at Pnt5/Pnt6). Pushing one per column made a
    // whole-screen fill cost hundreds of megabytes.
    const rt = run('Ink 7 : Paint 100,100')
    // the seed colour was paper, so the fill covers everything unclipped
    expect(rt.screen.point(0, 0)).toBe(7)
    expect(rt.screen.point(319, 199)).toBe(7)
  })

  it('Paint honours Clip as a boundary and ignores a seed outside it', () => {
    // TPaint compares the seed against all four clip edges and bails before
    // allocating anything (+W.s:4341-4348)
    const inside = run('Clip 40,40 To 80,80\nInk 7 : Paint 60,60')
    expect(inside.screen.point(60, 60)).toBe(7)
    expect(inside.screen.point(90, 60)).toBe(1) // clip contained the fill
    const outside = run('Clip 40,40 To 80,80\nInk 7 : Paint 10,10')
    expect(outside.screen.point(10, 10)).toBe(1) // nothing painted at all
    expect(outside.screen.point(60, 60)).toBe(1)
  })

  it('Fade steps nibbles once per delay toward targets (FadeI)', () => {
    const rt = boot('Fade 2,,$421')
    rt.runHeadless(3)
    const before = rt.screens.get(0)!.palette[1]!
    expect(before).toBe(0xa40) // untouched until the delay elapses...
    for (let i = 0; i < 2; i++) rt.frame()
    expect(rt.screens.get(0)!.palette[1]).toBe(0x931) // a40 -> 931 (each nibble ±1)
    for (let i = 0; i < 20; i++) rt.frame()
    expect(rt.screens.get(0)!.palette[1]).toBe(0x421) // reached target
    expect(rt.screens.get(0)!.palette[0]).toBe(0x000) // elided colour 0 untouched
  })

  it('Fade n To s fades toward screen s’s palette, not to black (InFade IFaTo)', () => {
    // CoinGrabber's fade-in intro: blank the current palette, then
    // Fade N To <other screen> reveals it by fading up to that palette
    const rt = boot(
      [
        'Screen Open 1,16,16,16,Lowres : Colour 1,$F00 : Colour 2,$0F0',
        'Screen 0 : Palette 0,0,0', // colours 0,1,2 black on screen 0
        'Fade 1 To 1',
      ].join('\n'),
    )
    for (let i = 0; i < 40; i++) rt.frame()
    // screen 0's palette has faded up to screen 1's colours, not stayed black
    expect(rt.screens.get(0)!.palette[1]).toBe(0xf00)
    expect(rt.screens.get(0)!.palette[2]).toBe(0x0f0)
  })

  it('Flash animates a palette register from its pattern string', () => {
    const rt = boot('Flash 2,"(F00,3)(0F0,3)"')
    rt.runHeadless(2)
    for (let i = 0; i < 3; i++) rt.frame()
    const a = rt.screens.get(0)!.palette[2]!
    for (let i = 0; i < 3; i++) rt.frame()
    const b = rt.screens.get(0)!.palette[2]!
    expect([a, b].sort()).toEqual([0x0f0, 0xf00])
  })

  it('Get Palette honours the colour mask (PalRout)', () => {
    const prog = ['Screen Open 1,320,200,16,Lowres', 'Palette $111,$222,$333', 'Screen 0', 'Get Palette 1,%101'].join(
      '\n',
    )
    const rt = run(prog)
    expect(rt.screens.get(0)!.palette[0]).toBe(0x111)
    expect(rt.screens.get(0)!.palette[1]).toBe(0xa40) // masked out
    expect(rt.screens.get(0)!.palette[2]).toBe(0x333)
  })

  it('Get Palette with the screen left out reads screen 0 (InGetPalette2 +Lib.s:9250)', () => {
    // it pops the slot straight into d1 and calls GetEc without testing it,
    // so the blank is a screen number like any other and resolves to 0
    const prog = [
      'Palette $111,$222,$333',
      'Screen Open 1,320,200,16,Lowres',
      'Palette $444,$555,$666',
      'Get Palette ,%101',
    ].join('\n')
    const rt = run(prog)
    expect(rt.screens.get(1)!.palette[0]).toBe(0x111)
    expect(rt.screens.get(1)!.palette[1]).toBe(0x555) // masked out
    expect(rt.screens.get(1)!.palette[2]).toBe(0x333)
  })

  it('Get Palette with the screen omitted copies nothing, whatever it picked', () => {
    // `Get Palette,0` is in the PD corpus (APD470/HomeRun2) and used to reach
    // keyword dispatch as a bare ",". An omitted slot yields EntNul
    // ($80000000) from the comma's FnNull routine; Get Palette does not test
    // for it, so it reaches GetEc as a screen number. It does not matter —
    // mask 0 means PalRout's `btst d0,d3` never fires and every entry stays
    // the $FFFF "unchanged" marker.
    const rt = run(['Screen Open 1,320,200,16,Lowres', 'Palette $111,$222', 'Screen 0', 'Get Palette,0'].join('\n'))
    expect(rt.screens.get(0)!.palette[0]).not.toBe(0x111)
    expect(rt.screens.get(0)!.palette[1]).not.toBe(0x222)
  })

  it('Colour Back paints the composite border', () => {
    const rt = run('Colour Back $F00\nScreen Display 0,140,60,,') // shift screen to expose border
    const { data } = rt.composite()
    expect([data[0], data[1], data[2]]).toEqual([255, 0, 0])
  })

  it('honours Clip', () => {
    const rt = run('Clip 100,100 To 200,200\nInk 5 : Bar 0,0 To 319,199')
    expect(rt.screen.point(150, 150)).toBe(5)
    expect(rt.screen.point(50, 50)).toBe(1)
  })

  it('the text console ignores Clip — Print writes to bitplanes past the clip (Ec_SetClip +W.s:4259)', () => {
    // Clip bounds rastport graphics (Bar) but the AMOS console blits
    // straight to the bitplanes; eggit2 prints its status line outside
    // the play-area Clip and relied on this
    const rt = run('Clip 100,100 To 200,200\nPen 2 : Paper 0 : Locate 0,0 : Print "A"')
    let lit = 0
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if (rt.screen.point(x, y) === 2) lit++
    expect(lit).toBeGreaterThan(4) // the 'A' rendered at 0,0, well outside the clip
    // but graphics Text() DOES clip (it's a rastport op)
    const rt2 = run('Clip 100,100 To 200,200\nInk 2 : Text 0,20,"A"')
    let g = 0
    for (let y = 0; y < 32; y++) for (let x = 0; x < 16; x++) if (rt2.screen.point(x, y) === 2) g++
    expect(g).toBe(0) // clipped away
  })

  it('sets palette entries via Colour and Palette', () => {
    const rt = run('Colour 3,$F0F\nPalette $111,,$222')
    expect(rt.screen.palette[3]).toBe(0xf0f)
    expect(rt.screen.palette[0]).toBe(0x111)
    expect(rt.screen.palette[1]).toBe(0xa40) // elided — unchanged
    expect(rt.screen.palette[2]).toBe(0x222)
  })
})

describe('text', () => {
  it('renders Print through the font onto the screen', () => {
    const rt = run('Locate 0,0 : Print "A"')
    const glyph = FONT8['A'.charCodeAt(0)]!
    const s = rt.screen
    let matches = 0
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const expected = (glyph[row]! >> (7 - col)) & 1 ? s.pen : s.paper
        if (s.point(col, row) === expected) matches++
      }
    }
    expect(matches).toBe(64)
  })

  it('respects Pen, Paper and Locate', () => {
    const rt = run('Pen 5 : Paper 9 : Locate 10,5 : Print "!"')
    const s = rt.screen
    // '!' has its dot column around x=3 of the cell at (80,40)
    let sawPen = false
    let sawPaper = false
    for (let y = 40; y < 48; y++) {
      for (let x = 80; x < 88; x++) {
        if (s.point(x, y) === 5) sawPen = true
        if (s.point(x, y) === 9) sawPaper = true
      }
    }
    expect(sawPen).toBe(true)
    expect(sawPaper).toBe(true)
  })

  it('scrolls when printing past the bottom', () => {
    const rt = run('For I=1 To 30 : Print "LINE";I : Next')
    expect(rt.screen.curY).toBe(24) // stuck on last row
  })

  /**
   * The console control table is +W.s:16570 (CCont). Three of its entries had
   * no counterpart here and fell through to putChar, printing a glyph where
   * the real machine cleared something: 7 ClEol, 24 Home and 26 ClLine.
   * LDos's Lansi is what found them — routine 69 emits all three.
   */
  it('control code 7 clears to the end of the cursor line, and no further', () => {
    // ClEol's count is `WiX`, which AdCurs (+W.s:15572) shows is the cells
    // REMAINING — `WiTx - WiX` is the column — so it runs to the right edge
    const rt = run('Pen 5 : Locate 0,0 : Print "ABCD"; : Locate 2,0 : Print Chr$(7);')
    const s = rt.screen
    const litIn = (cx: number): number => {
      let n = 0
      for (let y = 0; y < 8; y++) for (let x = cx * 8; x < cx * 8 + 8; x++) if (s.point(x, y) === 5) n++
      return n
    }
    expect(litIn(0) > 0).toBe(true) // A and B survive
    expect(litIn(1) > 0).toBe(true)
    expect(litIn(2)).toBe(0) // C and D are gone
    expect(litIn(3)).toBe(0)
  })

  it('control code 26 clears the whole cursor line and leaves the rest', () => {
    const rt = run('Pen 5 : Locate 0,0 : Print "AA" : Print "BB"; : Locate 0,1 : Print Chr$(26);')
    const s = rt.screen
    const litInRow = (row: number): number => {
      let n = 0
      for (let y = row * 8; y < row * 8 + 8; y++) for (let x = 0; x < 16; x++) if (s.point(x, y) === 5) n++
      return n
    }
    expect(litInRow(0) > 0).toBe(true) // row 0 untouched
    expect(litInRow(1)).toBe(0) // the cursor line is cleared
    expect(rt.screen.curX).toBe(0) // ...and the cursor does not move
  })

  it('control code 24 is a second Home, like 12', () => {
    const rt = run('Locate 10,5 : Print Chr$(24);')
    expect([rt.screen.curX, rt.screen.curY]).toEqual([0, 0])
  })

  it('draws graphics text with Text at a baseline', () => {
    const rt = run('Ink 6 : Text 100,50,"HI"')
    let found = 0
    for (let y = 40; y < 52; y++) for (let x = 100; x < 116; x++) if (rt.screen.point(x, y) === 6) found++
    expect(found).toBeGreaterThan(10)
  })

  it('Home homes without clearing; Clw clears (ChHom/ChClw)', () => {
    const rt = run('Print "X"\nHome')
    expect(rt.screen.point(0, 0)).not.toBe(rt.screen.paper) // X still there
    expect([rt.screen.curX, rt.screen.curY]).toEqual([0, 0])
    const rt2 = run('Print "X"\nClw')
    expect(rt2.screen.point(0, 0)).toBe(rt2.screen.paper)
  })

  it('Cmove moves relatively, Memorize/Remember save the cursor', () => {
    const rt = run('Locate 10,5 : Cmove 3,-2\nIf X Curs<>13 Then Error 1\nIf Y Curs<>3 Then Error 2')
    expect([rt.screen.curX, rt.screen.curY]).toEqual([13, 3])
    const rt2 = run('Locate 7,9 : Memorize X : Memorize Y : Locate 0,0 : Remember X : Remember Y')
    expect([rt2.screen.curX, rt2.screen.curY]).toEqual([7, 9])
  })

  it('centres text', () => {
    const rt = run('Centre "AB"')
    expect(rt.screen.curX).toBeGreaterThan(15) // wrote at ~col 19
  })
})

describe('frame clock and blocking', () => {
  it('Wait blocks until the clock advances', () => {
    const rt = boot('Wait 10\nPrint "GO"')
    for (let i = 0; i < 9; i++) rt.frame()
    expect(rt.interp.blocked).not.toBeNull()
    expect(rt.screen.curY).toBe(0)
    for (let i = 0; i < 3; i++) rt.frame()
    expect(rt.interp.done).toBe(true)
  })

  it('Wait Key blocks until a key arrives', () => {
    const rt = boot('Wait Key\nPrint "K"')
    rt.frame()
    rt.frame()
    expect(rt.interp.blocked).toEqual({ type: 'waitKey' })
    rt.pressKey(' ')
    rt.frame()
    expect(rt.interp.done).toBe(true)
  })

  it('Input blocks, echoes the submitted line and resumes', () => {
    const rt = boot('Input "NAME? ";A$\nPrint "HI ";A$')
    rt.frame()
    expect(rt.interp.blocked).toEqual({ type: 'input', prompt: 'NAME? ' })
    rt.submitLine('GAZ')
    rt.frame()
    expect(rt.interp.done).toBe(true)
    // find "HI GAZ" rendered on row 1
    const s = rt.screen
    const glyph = FONT8['H'.charCodeAt(0)]!
    let ok = true
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const expected = (glyph[row]! >> (7 - col)) & 1 ? s.pen : s.paper
        if (s.point(col, 8 + row) !== expected) ok = false
      }
    }
    expect(ok).toBe(true)
  })

  it('Inkey$ consumes typed keys and Timer follows the clock', () => {
    const rt = boot('Do\n K$=Inkey$\n Exit If K$<>""\n Wait Vbl\nLoop\nPrint K$;Timer')
    rt.frame()
    rt.pressKey('Z', 0x31)
    for (let i = 0; i < 5 && !rt.interp.done; i++) rt.frame()
    expect(rt.interp.done).toBe(true)
  })

  it('Key State reflects held keys', () => {
    const rt = boot('If Key State(69) Then Print "ESC"')
    rt.input.keys.add(69)
    rt.runHeadless(10)
    expect(rt.screen.curY).toBe(1) // one line printed
  })
})

describe('objects', () => {
  /** composite pixel at lowres screen coords */
  const at = (rt: Runtime, x: number, y: number): number[] => {
    const { data } = rt.composite()
    const o = ((y * 2 + 48) * 640 + x * 2) * 4 // +48: overscan rows above line 50
    return [data[o]!, data[o + 1]!, data[o + 2]!]
  }
  const GREEN = [0, 255, 0] // default palette colour 5 = $0F0

  it('blits bobs into the framebuffer with background save (Actualise)', () => {
    const rt = run('Ink 5 : Bar 0,0 To 7,7\nGet Bob 1,0,0 To 8,8\nCls 0\nBob 1,100,50,1')
    expect(rt.screen.point(100, 50)).toBe(5) // Point sees the bob now
    expect(at(rt, 100, 50)).toEqual(GREEN)
    expect(at(rt, 90, 50)).toEqual([0, 0, 0])
    // moving the bob restores the background underneath
    rt.bobs.get(1)!.x = 200
    rt.frame()
    expect(rt.screen.point(100, 50)).toBe(0)
    expect(rt.screen.point(200, 50)).toBe(5)
  })

  it('moves bobs with elided arguments and reads X Bob back', () => {
    const rt = run('Ink 5 : Bar 0,0 To 7,7 : Get Bob 1,0,0 To 8,8 : Cls 0\nBob 1,10,20,1\nBob 1,30,,\nIf X Bob(1)<>30 Then Error 1\nIf Y Bob(1)<>20 Then Error 2')
    expect(at(rt, 30, 20)).toEqual(GREEN)
  })

  it('stamps the framebuffer with Paste Bob', () => {
    const rt = run('Ink 5 : Bar 0,0 To 7,7 : Get Bob 1,0,0 To 8,8 : Cls 0\nPaste Bob 60,60,1')
    expect(rt.screen.point(60, 60)).toBe(5)
  })

  it('Paste Bob ignores the hot spot — pastes at raw top-left (Patch bset #31, +W.s:1387)', () => {
    // Bob/Sprite subtract the hot spot; Paste Bob does not (PAS POINT
    // CHAUD). A hot spot at the image centre must NOT shift the paste.
    const rt = run(
      ['Ink 5 : Bar 0,0 To 15,15 : Get Bob 1,0,0 To 16,16', 'Hot Spot 1,8,8', 'Cls 0', 'Paste Bob 100,100,1'].join('\n'),
    )
    // top-left corner of the image lands exactly at 100,100
    expect(rt.screen.point(100, 100)).toBe(5)
    expect(rt.screen.point(115, 115)).toBe(5)
    // nothing drawn hot-spot-shifted up-left at 92,92
    expect(rt.screen.point(92, 92)).toBe(0)
  })

  it('detects pixel-precise collisions with Bob Col and Col()', () => {
    const prog = (x: number) =>
      [
        'Ink 5 : Bar 0,0 To 7,7 : Get Bob 1,0,0 To 8,8 : Cls 0',
        'Bob 1,100,100,1',
        `Bob 2,${x},100,1`,
        'If Bob Col(1)',
        '   If Col(2) : Print "HIT" : End If',
        'Else',
        '   Print "MISS"',
        'End If',
      ].join('\n')
    const hit = run(prog(105))
    expect(hit.screen.curY).toBe(1)
    const miss = run(prog(120))
    expect(miss.screen.curY).toBe(1)
    // verify via the collision function results themselves
    expect(runOut(prog(105))).toContain('HIT')
    expect(runOut(prog(120))).toContain('MISS')
  })

  it('answers zone queries', () => {
    const out = runOut('Reserve Zone 4\nSet Zone 2,10,10 To 20,20\nPrint Zone(15,15);Zone(5,5)')
    expect(out).toBe(' 2 0\n')
  })
})

describe('windows (WOpen)', () => {
  it('opens a window with its own console state and prints inside it', () => {
    const rt = run(['Wind Open 1,32,16,10,5', 'Pen 6 : Paper 9', 'Print "HI"'].join('\n'))
    const s = rt.screen
    expect(s.curWin.n).toBe(1)
    expect([s.cols, s.rows]).toEqual([10, 5]) // window-sized console
    // "HI" rendered at the window origin (x aligned to 16)
    let sawPen = false
    for (let y = 16; y < 24; y++) for (let x = 32; x < 48; x++) if (s.point(x, y) === 6) sawPen = true
    expect(sawPen).toBe(true)
  })

  it('keeps per-window cursors and pens across Window switches (WOpen copies)', () => {
    const prog = [
      'Wind Open 1,16,8,10,5 : Pen 6 : Locate 3,2',
      'Wind Open 2,160,8,10,5 : Pen 7',
      'Window 1',
    ].join('\n')
    const rt = run(prog)
    const s = rt.screen
    expect(s.curWin.pen).toBe(6)
    expect([s.curX, s.curY]).toEqual([3, 2])
    expect(rt.screens.get(0)!.windows.get(2)!.pen).toBe(7)
  })

  it('scrolls only the window region', () => {
    const prog = [
      'Ink 5 : Plot 300,190', // marker outside the window
      'Wind Open 1,16,16,10,3',
      'For I=1 To 6 : Print "L";I : Next', // forces window scroll
    ].join('\n')
    const rt = run(prog)
    expect(rt.screen.point(300, 190)).toBe(5) // untouched by scrolling
  })

  it('draws borders with titles and restores background under Wind Save', () => {
    const prog = [
      'Ink 5 : Bar 0,0 To 319,199', // colour 5 background
      'Wind Save',
      'Wind Open 1,64,64,10,5,1',
      'Title Top "T"',
      'Wind Close',
    ].join('\n')
    const rt = run(prog)
    // everything restored: still colour 5 where the window was
    expect(rt.screen.point(80, 80)).toBe(5)
    expect(rt.screen.point(64, 60)).toBe(5) // border area restored too
  })

  it('Windon reports the current window; Clw clears only the window', () => {
    const out = runOut('Wind Open 3,16,8,10,5\nPrint Windon')
    expect(out).toContain(' 3')
    const rt = run(['Ink 5 : Bar 0,0 To 319,199', 'Wind Open 1,64,64,10,2', 'Clw'].join('\n'))
    expect(rt.screen.point(66, 66)).toBe(rt.screen.curWin.paper)
    expect(rt.screen.point(10, 10)).toBe(5) // outside untouched
  })

  it('applies Writing modes to text (escape W)', () => {
    // XOR mode: printing twice restores the background
    const prog = ['Cls 0', 'Writing 2', 'Locate 0,0 : Print "A"', 'Locate 0,0 : Print "A"'].join('\n')
    const rt = run(prog)
    let nonZero = 0
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if (rt.screen.point(x, y) !== 0) nonZero++
    expect(nonZero).toBe(0)
    // ignore mode prints nothing
    const rt2 = run(['Cls 0', 'Writing 4', 'Print "A"'].join('\n'))
    let any = 0
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if (rt2.screen.point(x, y) !== 0) any++
    expect(any).toBe(0)
  })

  it('Gr Writing 2 XORs drawing operations', () => {
    const rt = run(['Cls 0', 'Gr Writing 2', 'Ink 5 : Bar 10,10 To 20,20', 'Bar 10,10 To 20,20'].join('\n'))
    expect(rt.screen.point(15, 15)).toBe(0) // drawn twice = erased
  })
})

describe('double buffering and screens', () => {
  it('page-flips under Autoback 0 with Screen Swap', () => {
    const rt = run(['Double Buffer : Autoback 0', 'Ink 5 : Bar 0,0 To 9,9'].join('\n'))
    const s = rt.screen
    expect(s.point(5, 5)).toBe(5) // logical has the bar
    expect(s.displayBuffer[5 * s.width + 5]).not.toBe(5) // physical does not
    rt.screens.get(0)!.swap()
    expect(s.displayBuffer[5 * s.width + 5]).toBe(5) // now it shows
  })

  it('a bare Screen Swap swaps every double buffered screen too', () => {
    // The keyword takes two different routines. `InScreenSwap1`
    // (+Lib.s:8869) calls ScSwap, which is one named screen; `InScreenSwap0`
    // (+Lib.s:8859) calls ScSwapS (+W.s:2646), the same all-eight walk
    // Update uses. So `Screen Swap` and `Screen Swap 0` are not the same
    // instruction with a default, and the port had been treating them as one.
    const both = [
      'Screen Open 0,320,200,2,0 : Double Buffer : Autoback 0 : Ink 1 : Plot 0,0',
      'Screen Open 1,320,200,2,0 : Double Buffer : Autoback 0 : Ink 1 : Plot 0,0',
      'Screen 0 : Screen Swap',
    ].join('\n')
    const rt = run(both)
    expect(rt.screens.get(0)!.point(0, 0)).toBe(0) // logical is the blank one
    expect(rt.screens.get(1)!.point(0, 0)).toBe(0)
    // the numbered form leaves the screen it was not given alone
    const one = both.replace('Screen 0 : Screen Swap', 'Screen 0 : Screen Swap 0')
    const rt2 = run(one)
    expect(rt2.screens.get(0)!.point(0, 0)).toBe(0)
    expect(rt2.screens.get(1)!.point(0, 0)).toBe(1)
  })

  it('Screen Swap, To Front and To Back all refuse a screen that is not open', () => {
    // EcGet fails and EcE3 (+W.s:3130) is `moveq #3,d0`, which EcWiErr
    // (+Lib.s:12917) turns into 45+3-1 = 47. The port returned quietly.
    for (const kw of ['Screen Swap 3', 'Screen To Front 3', 'Screen To Back 3']) {
      expect(() => run(`Screen Open 0,320,200,2,0\n${kw}`)).toThrow(/screen not opened/i)
    }
  })

  it('=Screen is -1 once the last screen closes', () => {
    // FnScreen (+Lib.s:9137) reads the 1-based ScOn and subtracts one, so
    // zero screens reads as -1 rather than as screen 0.
    const rt = run('Screen Open 0,320,200,2,0 : Screen Close 0 : A=Screen')
    expect(rt.interp.getVar('a', 0)).toEqual({ k: 'int', n: -1 })
  })

  it('Screen Open checks the colour count before the screen number', () => {
    // IlNCo (+Lib.s:8944) sits above ScOo2's `Rbsr L_CheckScreenNumber`
    // (+Lib.s:8949), so a call that is wrong in both ways reports the
    // colours. The hires cap at +Lib.s:8952 is the one test that follows it.
    expect(() => run('Screen Open 9,320,200,3,Lowres')).toThrow(/illegal number of colours/i)
    expect(() => run('Screen Open 9,320,200,4,Lowres')).toThrow(/screen number/i)
  })

  it('Update swaps every double buffered screen, Bob Draw swaps none', () => {
    // InUpdate (+Lib.s:11435) is EffBob, ActBob, AffBob then `EcCall
    // SwapScS`, and ScSwapS (+W.s:2526) walks all eight screens exchanging
    // logical with physical on each one carrying BitDble. InBobDraw
    // (+Lib.s:11505) stops after AffBob. Renegades blits its map into
    // Logic(0) under Autoback 0 and calls Update, so with no swap the beam
    // read a black buffer all game.
    const rt = run(['Double Buffer : Autoback 0 : Update Off', 'Ink 5 : Bar 0,0 To 9,9', 'Update'].join('\n'))
    const s = rt.screen
    expect(s.displayBuffer[5 * s.width + 5]).toBe(5)
    const rt2 = run(['Double Buffer : Autoback 0 : Update Off', 'Ink 5 : Bar 0,0 To 9,9', 'Bob Draw'].join('\n'))
    const s2 = rt2.screen
    expect(s2.displayBuffer[5 * s2.width + 5]).not.toBe(5)
  })

  it('Screen Copy Physic To Logic works via buffer ids (FnLogic/FnPhysic)', () => {
    const prog = [
      'Double Buffer : Autoback 0',
      'Ink 5 : Bar 0,0 To 9,9',
      'Screen Swap', // bar now physical
      'Cls 0', // logical cleared
      'Screen Copy Physic(0) To Logic(0)', // pull it back
    ].join('\n')
    const rt = run(prog)
    expect(rt.screen.point(5, 5)).toBe(5)
  })

  it('Zoom scales between screen regions', () => {
    const rt = run('Ink 5 : Bar 0,0 To 9,9\nZoom 0,0,0,10,10 To 0,100,100,140,140')
    expect(rt.screen.point(120, 120)).toBe(5) // 4x scaled bar
    expect(rt.screen.point(139, 139)).toBe(5)
    expect(rt.screen.point(142, 142)).toBe(1)
  })

  it('a blank screen number reads the same as an explicit 0 (GetEc +Lib.s:11289)', () => {
    // EntNul is negative as a long, so `tst.l d1 / bmi.s GtE1` branches, but
    // its low word is zero, so `GtE1 tst.w d1 / bpl.s GtE2` skips the ScOnAd
    // path and GtE2 reads that zero as the screen number
    const bar = 'Ink 5 : Bar 0,0 To 9,9\n'
    const same = (blank: string, zero: string): void => {
      expect(run(bar + blank).screens.get(0)!.pixels).toEqual(run(bar + zero).screens.get(0)!.pixels)
    }
    same('Zoom ,0,0,10,10 To ,100,100,140,140', 'Zoom 0,0,0,10,10 To 0,100,100,140,140')
    same('Screen Copy ,0,0,10,10 To ,50,60', 'Screen Copy 0,0,0,10,10 To 0,50,60')
  })

  it('and it is screen 0, not whichever screen is current', () => {
    // -1 is what reaches ScOnAd, because its low word is negative too
    const rt = run('Ink 5 : Bar 0,0 To 9,9\nScreen Open 1,320,200,16,Lowres\nZoom ,0,0,10,10 To ,100,100,140,140')
    expect(rt.screens.get(0)!.point(120, 120)).toBe(5)
    expect(rt.screens.get(1)!.point(120, 120)).not.toBe(5)
    // Appear's destination is the same slot, and screen 1 is current here, so
    // a blank meaning "current" would leave screen 0 at colour 0
    const ap = run(
      [
        'Screen Open 0,320,32,16,Lowres : Flash Off : Cls 0',
        'Screen Open 1,320,32,16,Lowres : Flash Off : Cls 6',
        'Appear 1 To ,7', // 7 is coprime with the pixel total, so all of it
      ].join('\n'),
    )
    expect(ap.screens.get(0)!.pixels.every((v) => v === 6)).toBe(true)
  })

  it('but a slot with no comma beside it cannot be left blank', () => {
    // the comma is what emits the sentinel: FnNull (+ILib.s:3725) is the
    // comma's own function routine, so a slot that ends on `To` has nothing
    // to produce one and the verifier refuses the line before it runs
    expect(() => run('Appear To 1,1')).toThrow(/Syntax error/)
    expect(() => run('Screen Copy , To 1')).toThrow(/Syntax error/)
  })

  it('Set Pattern clears the old one before it looks at the argument (SPat +W.s:4695)', () => {
    // a 6-row grab: SPat3 rounds DOWN to a power of two, so four rows
    const base = 'Ink 5 : Bar 0,0 To 15,5 : Get Bob 1,0,0 To 16,6 : Cls 0\n'
    expect(run(base + 'Set Pattern -1').screen.pattern).toHaveLength(4)
    // `bsr EffPat` runs first, so a sprite that is not there still drops the
    // pattern that was — the port used to leave it in place
    expect(run(base + 'Set Pattern -1 : Set Pattern -99').screen.pattern).toBe(null)
    expect(run(base + 'Set Pattern -1 : Set Pattern 0').screen.pattern).toBe(null)
    // and the power-of-two search gives up at 128 rows, which is SPatE
    const tall = 'Ink 5 : Bar 0,0 To 15,199 : Get Bob 1,0,0 To 16,200 : Cls 0\n'
    expect(() => run(tall + 'Set Pattern -1')).toThrow(/function call/)
  })

  it('Hot Spot\'s predefined codes reach the far edge on 2 AND 3 (SpotH +W.s:580)', () => {
    // a 12-wide grab: word 0 of a bob image is its WORD count, so the right
    // edge is 16, not 12
    const base = 'Ink 5 : Bar 0,0 To 11,9 : Get Bob 1,0,0 To 12,10 : Cls 0\n'
    const spot = (code: string): { x: number; y: number } => {
      const im = run(base + 'Hot Spot 1,' + code).spriteBank!.image(1)!
      return { x: im.hotX, y: im.hotY }
    }
    expect(spot('$00')).toEqual({ x: 0, y: 0 })
    expect(spot('$11')).toEqual({ x: 8, y: 5 })
    expect(spot('$22')).toEqual({ x: 16, y: 10 })
    // `subq.w #1,d0 / bhi` is >=, so 3 lands on the far edge too
    expect(spot('$33')).toEqual({ x: 16, y: 10 })
    // and `and.w #%01110111` drops bit 3 of each nibble before any of that
    expect(spot('$88')).toEqual({ x: 0, y: 0 })
  })

  it('Draw moves the graphics cursor first, and that move takes elision (InDraw +Lib.s:9588)', () => {
    // the four-argument form puts its START through GrXY, so an omitted axis
    // keeps the cursor's own and the line begins there
    const rt = run('Ink 6 : Gr Locate 40,40\nDraw ,80 To 40,90')
    // x stayed 40, y moved to 80, so the line runs down column 40
    expect(rt.screen.point(40, 85)).toBe(6)
    expect(rt.screen.point(40, 70)).not.toBe(6) // above the start, untouched
    // Draw To then continues from where that line ended, not from the start
    const on = run('Ink 6 : Gr Locate 40,40\nDraw ,80 To 40,90\nDraw To 60,90')
    expect(on.screen.point(50, 90)).toBe(6)
  })

  it('Scin\'s three-argument form starts the search below a screen (GetSIn +W.s:10879)', () => {
    // two overlapping screens, 1 in front of 0
    const prog = [
      'Screen Open 0,320,200,16,Lowres : Screen Display 0,128,50,,',
      'Screen Open 1,320,200,16,Lowres : Screen Display 1,128,50,,',
      'Screen To Front 1',
    ].join('\n')
    const v = (expr: string): number => Number(runOut(prog + '\nPrint ' + expr).trim())
    const x = v('X Hard(1,10)')
    const y = v('Y Hard(1,10)')
    // two arguments: the frontmost screen over that point
    expect(v(`Scin(${x},${y})`)).toBe(1)
    // three: start at screen 1 and look no further forward, so still 1
    expect(v(`Scin(1,${x},${y})`)).toBe(1)
    // start at screen 0 and the one in front of it is not considered
    expect(v(`Scin(0,${x},${y})`)).toBe(0)
    // and the +1 bias makes -1 the whole list again
    expect(v(`Scin(-1,${x},${y})`)).toBe(1)
  })

  it('X Hard converts against the screen it is given (EcToD1 +W.s:10755)', () => {
    // two screens at different display positions, so "which screen" shows
    const prog = [
      'Screen Open 0,320,200,16,Lowres : Screen Display 0,128,50,,',
      'Screen Open 1,320,200,16,Lowres : Screen Display 1,160,80,,',
      'Screen 0',
    ].join('\n')
    const v = (expr: string): number => Number(runOut(prog + '\nPrint ' + expr).trim())
    // one argument is the current screen, screen 0
    const cur = v('X Hard(0)')
    expect(v('X Hard(0,0)')).toBe(cur)
    // naming screen 1 must NOT answer with screen 0's origin
    expect(v('X Hard(1,0)')).not.toBe(cur)
    expect(v('Y Hard(1,0)')).not.toBe(v('Y Hard(0)'))
    // `addq.w #1,d3` biases the selector, so -1 arrives as 0: the current
    // screen, not an error and not EntNul
    expect(v('X Hard(-1,0)')).toBe(cur)
    // only -2 and below reach EcToD4, which gives up and answers EntNul
    expect(v('X Hard(-2,0)')).toBe(-2147483648)
    // and a slot with no screen in it is EcToD3's `moveq #3,d0`, so 47
    expect(() => run(prog + '\nPrint X Hard(5,0)')).toThrow(/creen not opened/)
  })

  it('Get Bob Palette wants a bank to read (BkNoRes +Lib.s:12934)', () => {
    // `Rbsr L_Bnk.GetBobs / Rbeq L_BkNoRes`, and BkNoRes goes straight to
    // GoError with 36, so there is no +44 on this one
    expect(() => run('Get Bob Palette')).toThrow(/Bank not reserved/)
    expect(() => run('Get Icon Palette')).toThrow(/Bank not reserved/)
    const made = 'Ink 5 : Bar 0,0 To 7,7 : Get Bob 1,0,0 To 8,8\nGet Bob Palette'
    expect(() => run(made)).not.toThrow()
  })

  it('Put Bob refuses a negative and a bob that is not there (InPutBob +Lib.s:12694)', () => {
    // `move.l d3,d1 / Rbmi L_FonCall` then `SyCall PutBob / Rbne L_FonCall`
    expect(() => run('Put Bob -1')).toThrow(/function call/)
    expect(() => run('Put Bob 3')).toThrow(/function call/)
    const ok = 'Ink 5 : Bar 0,0 To 7,7 : Get Bob 1,0,0 To 8,8\nBob 3,10,10,1\nPut Bob 3'
    expect(() => run(ok)).not.toThrow()
  })

  it('Del Block on a block that is not there is error 65 (BlDel +W.s:12463)', () => {
    // `bsr FindBloc / bne.s FrBloc / moveq #BlE+2,d0` with BlE 19, so 19+2+44
    expect(() => run('Del Block 7')).toThrow(/Block not found/)
    expect(() => run('Del Cblock 7')).toThrow(/Block not found/)
    // the bare form is a plain BlRaz and reports nothing
    expect(() => run('Del Block')).not.toThrow()
    const made = 'Ink 5 : Bar 0,0 To 9,9 : Get Block 7,0,0,10,10\nDel Block 7'
    expect(() => run(made)).not.toThrow()
  })

  it('Zoom measures the rectangle before it draws (ZooF +Lib.s:10692)', () => {
    // every check falls into L_FonCall, so a rectangle off the edge is an
    // error rather than a partly drawn picture
    const base = 'Ink 5 : Bar 0,0 To 9,9\n'
    expect(() => run(base + 'Zoom 0,0,0,10,10 To 0,100,100,400,140')).toThrow(/function call/)
    expect(() => run(base + 'Zoom 0,0,0,400,10 To 0,100,100,140,140')).toThrow(/function call/)
    // `cmp.l d5,d4 / bcc` is unsigned, so a negative low coordinate fails
    // the pair test without needing a branch of its own
    expect(() => run(base + 'Zoom 0,0,0,10,10 To 0,-1,100,140,140')).toThrow(/function call/)
    // and an inverted pair is the same test
    expect(() => run(base + 'Zoom 0,0,0,10,10 To 0,140,100,100,140')).toThrow(/function call/)
    // `bhi` allows a coordinate exactly on the edge
    expect(() => run(base + 'Zoom 0,0,0,10,10 To 0,100,100,320,140')).not.toThrow()
  })

  it('Set Bob negative blanks where it was; Limit Bob confines movement', () => {
    // `back < 0` keeps no background buffer, so the erase writes zeroes over
    // where the bob was rather than restoring or leaving it. See display.ts
    // for why that is the reading and what TargetSystem.AMOS settled.
    const base = ['Ink 5 : Bar 0,0 To 7,7 : Get Bob 1,0,0 To 8,8 : Cls 0']
    const trail = run([...base, 'Set Bob 1,-1,,', 'Bob 1,50,50,1'].join('\n'))
    trail.bobs.get(1)!.x = 100
    trail.frame()
    expect(trail.screen.point(50, 50)).toBe(0) // blanked, not left behind
    expect(trail.screen.point(100, 50)).toBe(5)
    // the bob comes FIRST: BobLim walks T_BbDeb and writes the edges onto
    // the bobs it finds, so a limit set before anything is drawn is dropped
    const lim = run([...base, 'Bob 1,300,190,1', 'Limit Bob 40,40 To 80,80'].join('\n'))
    const b = lim.bobs.get(1)!
    expect(b.x).toBeLessThanOrEqual(80)
    expect(b.y).toBeLessThanOrEqual(80)
  })

  it('Limit Bob needs a bob, snaps x to 16, and measures the bottom against the LEFT (BobLim +W.s:1026)', () => {
    const base = ['Ink 5 : Bar 0,0 To 7,7 : Get Bob 1,0,0 To 8,8 : Cls 0']
    // `move.l T_BbDeb(a5),d0 / beq LBbX` returns before any check, so with
    // nothing drawn even a nonsense rectangle is accepted in silence
    expect(() => run([...base, 'Limit Bob 200,200 To 10,10'].join('\n'))).not.toThrow()
    const withBob = [...base, 'Bob 1,50,50,1']
    // `and.w #$FFF0,d2` and `and.w #$FFF0,d4` round both x edges down
    const snapped = run([...withBob, 'Limit Bob 47,0 To 95,95'].join('\n'))
    expect(snapped.bobLimits.get(-1)).toMatchObject({ x1: 32, x2: 80 })
    // `cmp.w d2,d4 / bls.s LbbE` — an inverted or empty x span
    expect(() => run([...withBob, 'Limit Bob 80,0 To 80,90'].join('\n'))).toThrow(/function call/)
    // and `cmp.w d2,d5 / bls.s LbbE`, the bottom edge against x1 rather than
    // y1, so a tall strip on the right cannot be asked for
    expect(() => run([...withBob, 'Limit Bob 100,0 To 200,50'].join('\n'))).toThrow(/function call/)
    // the same rectangle moved left is accepted, which is the giveaway
    expect(() => run([...withBob, 'Limit Bob 16,0 To 200,50'].join('\n'))).not.toThrow()
  })

  it('Bob Update Off freezes the pipeline until Bob Draw', () => {
    const rt = run(
      ['Ink 5 : Bar 0,0 To 7,7 : Get Bob 1,0,0 To 8,8 : Cls 0', 'Bob Update Off', 'Bob 1,60,60,1'].join('\n'),
    )
    expect(rt.screen.point(60, 60)).toBe(0) // nothing drawn
    rt.updateBobs()
    expect(rt.screen.point(60, 60)).toBe(5)
  })
})

describe('composite', () => {
  it('produces a 640x572 PAL-overscan RGBA frame with doubled lowres pixels', () => {
    const rt = run('Plot 10,20,2') // colour 2 = white
    const { width, height, data } = rt.composite()
    expect([width, height]).toEqual([640, 572])
    const at = (x: number, y: number): number[] => {
      const o = ((y + 48) * 640 + x) * 4 // rows relative to hardware line 50
      return [data[o]!, data[o + 1]!, data[o + 2]!]
    }
    expect(at(20, 40)).toEqual([255, 255, 255])
    expect(at(21, 41)).toEqual([255, 255, 255]) // 2x2 doubling
    expect(at(24, 40)).toEqual([170, 68, 0]) // orange background ($A40)
  })

  it('layers screens by z-order', () => {
    const rt = run('Screen Open 1,320,200,16,Lowres\nCls 0\nScreen To Back 1')
    const { data } = rt.composite()
    // screen 0 (orange) should be in front; sample its top row (line 50)
    const o = 48 * 640 * 4
    expect([data[o], data[o + 1], data[o + 2]]).toEqual([170, 68, 0])
  })
})

describe('frame-budget pacing (blitter cost)', () => {
  // The budget is CPU cycles now, not statements. These two were written
  // against a 20,000-STATEMENT budget, and 88 is the conversion between the
  // two units (141,876 cycles a frame over 1,612 dispatches), so this is the
  // same budget they always had.
  const OLD_UNITS = 20_000 * CYCLES_PER_DISPATCH

  it('Screen Copy charges the frame budget so a no-Wait-Vbl loop paces like the blitter', () => {
    // a busy loop that Screen Copies a big region every iteration should run
    // only a handful of iterations per frame, not thousands
    const src = [
      'Screen Open 0,320,256,16,Lowres : Cls 0',
      'Screen Open 1,320,256,16,Lowres : Cls 0',
      'N=0',
      'Do',
      ' Screen Copy 1,0,0,320,256 To 0,0,0',
      ' Inc N',
      'Loop',
    ].join('\n')
    const rt = new Runtime(tokenize(src, table), table, { maxSteps: 5_000_000, frameBudget: OLD_UNITS })
    rt.frame() // one displayed frame
    const gf = (rt.interp as any).frames[0].vars
    const n = Number(gf.get('n').n)
    // 320x256 = 81920 px, pixelGuessCycles ≈ 450k/copy → a handful, not 1000s
    expect(n).toBeGreaterThan(0)
    expect(n).toBeLessThan(20)
  })

  it('a cheap loop still runs its full statement budget (no over-charging)', () => {
    const rt = new Runtime(tokenize('N=0\nDo : Inc N : Loop', table), table, {
      maxSteps: 5_000_000,
      frameBudget: OLD_UNITS,
    })
    rt.frame()
    const n = Number((rt.interp as any).frames[0].vars.get('n').n)
    expect(n).toBeGreaterThan(1000) // uncharged loop runs thousands per frame
  })
})

/**
 * The base statement cost, against the one loop we can check exactly.
 *
 * `Speed_Tests.AMOS` timed `For A=1 To 10000: Next A` at 48 ticks, which is
 * 681 cycles an iteration, and 18th Hole's power bar is paced by
 * `For J=0 To 280 : Next J` between each of its eleven steps. That is the
 * same construct measured and used, with no modelling in between, so it is
 * the one number in the timing work that can be checked rather than argued
 * about.
 */
describe('the statement cost reproduces the 18th Hole power bar', () => {
  const framesPer = (body: string, frames: number): number => {
    const rt = new Runtime(tokenize(['N=0', 'Do', `  ${body}`, '  Inc N', 'Loop'].join('\n'), table), table, {
      maxSteps: 200_000_000,
    })
    for (let i = 0; i < frames; i++) rt.frame()
    return frames / Number((rt.interp as any).frames[0].vars.get('n').n)
  }

  it('one bar step is a frame and a third, and the sweep is 0.3 seconds', () => {
    // 281 iterations x 681 cycles = 191,361, against 141,876 cycles a frame
    const step = framesPer('For J=0 To 280 : Next J', 400)
    expect(step).toBeGreaterThan(1.25)
    expect(step).toBeLessThan(1.45)
    // eleven steps, `For I=29 To 39` in _ENTERPOWER
    expect((step * 11) / VBL_HZ).toBeCloseTo(0.3, 1)
  })

  it('a plain statement is 206 cycles, so a frame holds about 689 of them', () => {
    // three statements an iteration: the body, Inc N, and Loop
    const perStatement = framesPer('A=1', 200) / 3
    expect(1 / perStatement).toBeGreaterThan(650)
    expect(1 / perStatement).toBeLessThan(720)
  })

  it('a colon costs a dispatch, not a statement', () => {
    // AMOS's inner loop reads a word and jumps through the token table
    // whatever the word is (+ILib.s:505), so a separator costs those seven
    // instructions and an immediate rts. Two assignments on one line are
    // therefore 2 x 206 + 88, not 3 x 206 --- and colons are everywhere in
    // real AMOS source, so charging them as statements taxed whole programs.
    // Both run the same two assignments, so the colon is the only difference:
    // 206+88+206+206+206 = 912 against 206x4 = 824, a ratio of 1.107. Charged
    // as a statement it was 1030 over 824, which is 1.25.
    const ratio = framesPer('A=1 : B=2', 200) / framesPer('A=1\n  B=2', 200)
    expect(ratio).toBeGreaterThan(1.08)
    expect(ratio).toBeLessThan(1.14)
  })

  it('the processor sets the budget, so a faster one runs more BASIC', () => {
    // The budget is read off machine.cpu.hz every frame rather than frozen at
    // construction, so switching the processor in Config takes effect live.
    // It was a constant before and the setting did nothing at all.
    const rt = new Runtime(tokenize('N=0\nDo : Inc N : Loop', table), table, { maxSteps: 200_000_000 })
    rt.frame()
    const a500 = Number((rt.interp as any).frames[0].vars.get('n').n)
    rt.machine.cpu = new M68020()
    rt.frame()
    const after = Number((rt.interp as any).frames[0].vars.get('n').n) - a500
    // 68020 at 14.18 MHz against the 68000's 7.09: twice the cycles a frame
    expect(after / a500).toBeCloseTo(2, 1)
  })

  it('Next costs 681 cycles, not 206', () => {
    // 1,000 iterations of nothing but Next, so the answer is the Next cost
    // and almost nothing else: 1000 x 681 plus the three statements around
    // the loop is 681,618 cycles, which is 4.80 frames. Charged as an
    // ordinary statement it would be 1.45, and that factor of 3.3 is why
    // every hand-rolled AMOS delay ran fast.
    expect(framesPer('For J=0 To 999 : Next J', 400)).toBeCloseTo(4.8, 1)
  })
})

describe('two joystick ports (FJ +Lib.s:13716)', () => {
  it('Joy(1)/Jup(0) read separate ports — arrows and WASD are independent', () => {
    const rt = new Runtime(tokenize('Do : A=Jup(1) : B=Jup(0) : C=Jleft(0) : D=Fire(1) : Wait Vbl : Loop', table), table, {
      maxSteps: 1_000_000,
    })
    rt.input.joy = 1 | 16 // port 1: up + fire
    rt.input.joy0 = 4 // port 0: left
    rt.frame()
    const gf = (rt.interp as any).frames[0].vars
    expect(Number(gf.get('a').n)).toBe(-1) // Jup(1) port-1 up
    expect(Number(gf.get('b').n)).toBe(0) //  Jup(0) port-0 not up
    expect(Number(gf.get('c').n)).toBe(-1) // Jleft(0) port-0 left
    expect(Number(gf.get('d').n)).toBe(-1) // Fire(1) port-1 fire
  })

  it('a port above 1 is a function call error', () => {
    const rt = new Runtime(tokenize('X=Joy(2)', table), table, { maxSteps: 1000 })
    expect(() => rt.runHeadless(10)).toThrow(/function call/)
  })
})

describe('the gameport registers a program can reach', () => {
  const peek = (src: string): Runtime => {
    const rt = new Runtime(tokenize(src, table), table, { maxSteps: 200_000 })
    mustFinish(rt.runHeadless(1_000))
    return rt
  }

  it('JOY0DAT carries the mouse counters, which are its position mod 256', () => {
    // ../amiga/gameport.ts has modelled these since GameSupport needed them
    // and nothing could reach them by address: `Deek($DFF00A)` fell through
    // to the bank scan and answered whatever was there
    const rt = new Runtime(tokenize('A=Deek($DFF00A)', table), table, { maxSteps: 200_000 })
    rt.input.mouseX = 0x1234
    rt.input.mouseY = 0x5678
    mustFinish(rt.runHeadless(1_000))
    // the counters are eight bits each, Y in the high byte
    expect(Number((rt.interp as unknown as { frames: { vars: Map<string, { n: number }> }[] }).frames[0]!.vars.get('a')!.n)).toBe(
      0x7834,
    )
  })

  it('JOY1DAT carries the stick, and a stick reads small because it is quadrature', () => {
    const rt = new Runtime(tokenize('A=Deek($DFF00C)', table), table, { maxSteps: 200_000 })
    rt.input.joy = 8 // right
    mustFinish(rt.runHeadless(1_000))
    const a = Number((rt.interp as unknown as { frames: { vars: Map<string, { n: number }> }[] }).frames[0]!.vars.get('a')!.n)
    // right is bit 1, and bit 0 is right XOR down, so a bare right is 3
    expect(a).toBe(3)
  })

  it('POTGOR answers for both ports now, not only the mouse', () => {
    const rt = peek('Rem')
    rt.machine.ports[1].buttons = 2 // BTN_BLUE, port 1 pin 9
    expect(rt.machine.potgor() & (1 << 14)).toBe(0)
    expect(rt.machine.potgor() & (1 << 10)).toBe(1 << 10)
  })
})

describe('input is a view of the machine, not a copy of it', () => {
  const boot = (machine?: Machine): Runtime =>
    new Runtime(tokenize('Rem', table), table, machine ? { machine } : {})

  it('reads the four device fields off ../amiga/machine.ts', () => {
    const rt = boot()
    rt.machine.mouse!.buttons = 3
    expect(rt.input.mouseK).toBe(3)
    rt.machine.keyboard!.press(0x40)
    expect(rt.input.keys.has(0x40)).toBe(true)
    expect(rt.input.sdr).toBe(rt.machine.cia.sdr)
    expect(rt.input.ports).toBe(rt.machine.ports)
  })

  it('writes through, so a keyword and a Peek see one byte', () => {
    const rt = boot()
    rt.input.mouseK = 1
    // CIA-A PRA bit 6, active low
    expect(rt.machine.cia.pra() & 0x40).toBe(0)
  })

  it('binds to the machine the caller SUPPLIED, not the one it replaced', () => {
    // `input` is a field initialiser and `opts.machine` lands in the
    // constructor, so a captured object would read a machine nobody has
    const m = new Machine()
    const rt = boot(m)
    m.mouse!.buttons = 2
    expect(rt.input.mouseK).toBe(2)
    expect(rt.machine).toBe(m)
  })

  it('shares devices across two Runtimes on one machine, and queues separately', () => {
    // one keyboard, two programs. This is what `Multi On` needs and what the
    // fields being plain data could not express.
    const m = new Machine()
    const a = boot(m)
    const b = boot(m)
    m.keyboard!.press(0x20)
    expect(a.input.keys.has(0x20)).toBe(true)
    expect(b.input.keys.has(0x20)).toBe(true)
    a.input.keyQueue.push({ ch: 'x', scan: 0x20 })
    expect(b.input.keyQueue).toHaveLength(0)
  })
})

describe('the fake address space regions do not overlap', () => {
  it('every region base is distinct and ordered', () => {
    // EXT_DATA_BASE was first written as 0x50000000, which is COPPER_BASE. The
    // copper branch runs earlier in the resolver, so it silently answered every
    // read of the new region and only a pixel-level test noticed. A region map
    // is cheap to assert and this is the assertion that would have caught it.
    const regions: Array<[string, number, number]> = [
      ['SCREEN_CHIP', Runtime.SCREEN_CHIP_BASE, 8 * Runtime.SCREEN_CHIP_SLOT],
      ['SCREEN_CTRL', Runtime.SCREEN_CTRL_BASE, 8 * Runtime.SCREEN_CTRL_SLOT],
      ['COPPER', Runtime.COPPER_BASE, 2 * Runtime.COPPER_SLOT],
      ['EXT_DATA', Runtime.EXT_DATA_BASE, 256 * Runtime.EXT_DATA_SLOT],
    ]
    const sorted = [...regions].sort((a, b) => a[1] - b[1])
    for (let i = 1; i < sorted.length; i++) {
      const [pn, pb, pl] = sorted[i - 1]!
      const [n, b] = sorted[i]!
      expect(b, `${n} (0x${b.toString(16)}) overlaps ${pn} (0x${pb.toString(16)}+0x${pl.toString(16)})`).toBeGreaterThanOrEqual(pb + pl)
    }
  })
})

/**
 * A bank's name is held with its trailing spaces off, everywhere.
 *
 * The field on the machine is eight bytes and `Bnk.Reserve` copies exactly
 * eight (`moveq #7,d0` +Lib.s:8501), so a library's literal really is
 * 'Work    ' or 'Datas   ' and the source at each call site should keep
 * saying so. What is HELD is the trimmed name, because the loader holds one
 * that way (`parseMemoryBank`) and a reserved bank and a loaded one have to
 * compare equal.
 *
 * Before this was settled the tree did both. Five paths padded and three
 * trimmed, and nothing noticed because `Bank As Work` and `Bank As Data`
 * rewrite only the first four characters and `List Bank` pads to nine either
 * way. A test asserting `.name === 'Work'` passed or failed depending on
 * which keyword had made the bank.
 *
 * Two rules keep it settled, and both are checked below rather than trusted:
 * padding goes back on at the boundary (`Bank Name$`, routines 59 and 60,
 * and anything that writes a file), and a whole-name comparison pads before
 * comparing, because the machine is comparing eight bytes.
 */
describe('bank names are held trimmed', () => {
  it('reserveBank takes the padding off whatever a caller passes', () => {
    const rt = new Runtime(tokenize('Rem\n', new TokenTable(CORE_TOKENS)), new TokenTable(CORE_TOKENS))
    // the literals AMCAF and EasyLife really do hold, eight characters each
    rt.reserveBank(5, 64, 'Work    ')
    rt.reserveBank(6, 64, 'Datas   ')
    rt.reserveBank(7, 64, 'Pac.Pic.') // eight already, with nothing to take off
    expect(rt.memBanks.get(5)!.name).toBe('Work')
    expect(rt.memBanks.get(6)!.name).toBe('Datas')
    expect(rt.memBanks.get(7)!.name).toBe('Pac.Pic.')
  })

  it("and a reserved bank compares equal to the loader's idea of the same name", () => {
    const rt = new Runtime(tokenize('Rem\n', new TokenTable(CORE_TOKENS)), new TokenTable(CORE_TOKENS))
    rt.reserveBank(5, 64, 'Work    ')
    // what parseMemoryBank would have produced for the same eight bytes
    expect(rt.memBanks.get(5)!.name).toBe('Work    '.replace(/\s+$/, ''))
  })

  /**
   * No source file may store a padded bank name.
   *
   * A behavioural test only covers the paths it happens to run. This covers
   * the ones nobody has written yet, which is where the split came from: a
   * new keyword copies the pattern next to it, and the pattern next to it was
   * whichever convention that file already used.
   */
  it('and no source file pads one back on the way in', async () => {
    const { readFileSync, readdirSync, statSync } = await import('node:fs')
    const { join } = await import('node:path')
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((e) => {
        const f = join(dir, e)
        return statSync(f).isDirectory() ? walk(f) : f.endsWith('.ts') && !f.endsWith('.test.ts') ? [f] : []
      })
    const bad: string[] = []
    for (const f of walk('src')) {
      readFileSync(f, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          // `x.name = ...padEnd(8...)` stores the padded form; the boundary
          // spellings are `VS(...padEnd(8` for a reader and `padEnd(8` inside
          // a header writer, neither of which assigns to a name
          if (/\.name\s*=[^=].*padEnd\(\s*8/.test(line)) bad.push(`${f}:${i + 1}`)
        })
    }
    expect(bad, 'store the trimmed name and pad at the boundary instead').toEqual([])
  })
})

/**
 * The autoback bracket's vertical blanks.
 *
 * `Cls`, `Paste Bob` and the `Print` family (through `AutoPrt`, +W.s:15496,
 * which `WLocate` +W.s:15319 also goes through) run inside
 * `TAbk1 / op / TAbk2 / op / TAbk3`. Under `Autoback 2` all three of those
 * wait: `bsr WVbl` at +W.s:3554, +W.s:3581 and +W.s:3609, the last two after
 * a `ScSwapS`. One bracketed keyword costs three frames.
 *
 * TAbk1 gates on `move.w EcAuto(a0),d0 / subq.w #1,d0 / ble.s TAbk1X`
 * (+W.s:3551), so 0 and 1 skip it and only 2 pays --- and 2 is the value
 * `Double Buffer` writes for you (+W.s:2770).
 *
 * This is most of why Battlements' menu was unusable. Its loop is five
 * `Locate` and five `Print` on a double-buffered screen, so on an A500 the
 * cursor stepped under twice a second, and the port was running it about
 * four and a half thousand times a second.
 */
describe('the autoback bracket stalls BASIC (TAbk1/TAbk2B/TAbk3B)', () => {
  const spin = (setup: string[], frames = 30): number => {
    const src = [
      'Screen Open 0,320,200,16,Lowres : Curs Off : Flash Off',
      ...setup,
      'N=0',
      'Do',
      '  Locate 0,5 : Print "x"',
      '  Inc N',
      'Loop',
    ].join('\n')
    const rt = new Runtime(tokenize(src, table), table, { maxSteps: 50_000_000 })
    for (let i = 0; i < frames; i++) rt.frame()
    return Number((rt.interp as any).frames[0].vars.get('n').n)
  }

  it('a Locate and a Print cost six frames on a double-buffered screen', () => {
    // two bracketed keywords, three vertical blanks each
    const n = spin(['Double Buffer'], 30)
    expect(n).toBeGreaterThan(2)
    expect(n).toBeLessThan(8)
  })

  it('Autoback 0 buys the speed back, which is what Chopper II does', () => {
    // `tst.w EcAuto(a5) / beq` skips the bracket outright, so the loop goes
    // back to being paced by the ordinary statement budget
    expect(spin(['Double Buffer', 'Autoback 0'], 30)).toBeGreaterThan(1000)
  })

  it('Autoback 1 doubles the drawing but does not wait (+W.s:3551)', () => {
    // `subq.w #1,d0 / ble` is taken at 1, so TAbk1 returns before its WVbl
    // and TAbk2A only re-points the rastport
    expect(spin(['Double Buffer', 'Autoback 1'], 30)).toBeGreaterThan(1000)
  })

  it('a single-buffered screen never pays it', () => {
    // Print takes WPrt5 (+W.s:15530): TAbk1, then TAbk4, and TAbk4
    // (+W.s:3613) is BobAct/BobAff with no wait in it at all
    expect(spin([], 30)).toBeGreaterThan(1000)
  })
})
