import { describe, expect, it } from 'vitest'
import { mustFinish } from '../testing/run'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { Machine } from '../amiga/machine'
import { Runtime } from './runtime'
import { FONT8 } from './font.gen'

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

  it('flood-fills with Paint', () => {
    const rt = run('Ink 4 : Box 50,50 To 70,70\nInk 7 : Paint 60,60')
    expect(rt.screen.point(60, 60)).toBe(7)
    expect(rt.screen.point(51, 51)).toBe(7)
    expect(rt.screen.point(40, 60)).toBe(1) // outside stays paper
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

  it('Paint terminates under Gr Writing 2 when the fill changes nothing', () => {
    // TPaint fills over a mask, not the screen (PMask, +W.s:4657; tested at
    // Pnt3/Pnt5, marked at Pnt7). Testing the pixels instead only terminates
    // while a filled pixel stops matching the seed colour — and xor with
    // pen 0 writes `old ^ 0`, so every pixel stays exactly as fillable as it
    // was and the fill never ends.
    //
    // Not a contrived pen: _rndcircles2.amos on the AMOS PD Library CD
    // (APD503) cycles `C=C+1 : If C=64 Then C=0 : Ink C` around a Circle /
    // Paint loop under Gr Writing 2, so it reaches Ink 0 every 64 tiles. It
    // took 2 GB of heap in ten seconds.
    const prog = [
      'Ink 4 : Box 50,50 To 70,70',
      'Gr Writing 2',
      'Ink 0 : Paint 60,60',
    ].join('\n')
    const rt = run(prog)
    // xor with 0 leaves the screen alone; the point is that it came back
    expect(rt.screen.point(60, 60)).toBe(1)
    expect(rt.screen.point(51, 51)).toBe(1)
  })

  it('Paint xors a region to zero when the pen matches what is there', () => {
    // TPaint has no "seed is already the fill colour, skip it" exit — its only
    // early outs are the four clip comparisons and a null tempras. Treating
    // that as a no-op is a replace-mode assumption: under Gr Writing 2,
    // painting c over c writes c ^ c = 0, which is how you blank a region.
    const prog = ['Ink 4 : Bar 50,50 To 70,70', 'Gr Writing 2', 'Ink 4 : Paint 60,60'].join('\n')
    const rt = run(prog)
    expect(rt.screen.point(60, 60)).toBe(0)
    expect(rt.screen.point(80, 60)).toBe(1) // outside the bar, still paper
  })

  it('Paint xors its fill under Gr Writing 2', () => {
    const prog = ['Ink 4 : Box 50,50 To 70,70', 'Gr Writing 2', 'Ink 7 : Paint 60,60'].join('\n')
    const rt = run(prog)
    expect(rt.screen.point(60, 60)).toBe(1 ^ 7) // paper xor ink, not ink
    expect(rt.screen.point(40, 60)).toBe(1) // the box still contained it
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
    const rt = run('Colour Back $F00\nScreen Display 0,140,60') // shift screen to expose border
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
    // ClEol's count is `WiX`, which AdCurs (+W.s:15601) shows is the cells
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

  it('Set Bob negative leaves a trail; Limit Bob confines movement', () => {
    const base = ['Ink 5 : Bar 0,0 To 7,7 : Get Bob 1,0,0 To 8,8 : Cls 0']
    const trail = run([...base, 'Set Bob 1,-1,,', 'Bob 1,50,50,1'].join('\n'))
    trail.bobs.get(1)!.x = 100
    trail.frame()
    expect(trail.screen.point(50, 50)).toBe(5) // old image not restored
    expect(trail.screen.point(100, 50)).toBe(5)
    const lim = run([...base, 'Limit Bob 40,40 To 80,80', 'Bob 1,300,190,1'].join('\n'))
    const b = lim.bobs.get(1)!
    expect(b.x).toBeLessThanOrEqual(80)
    expect(b.y).toBeLessThanOrEqual(80)
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
    const rt = new Runtime(tokenize(src, table), table, { maxSteps: 5_000_000, frameBudget: 20_000 })
    rt.frame() // one displayed frame
    const gf = (rt.interp as any).frames[0].vars
    const n = Number(gf.get('n').n)
    // 320x256 = 81920 px, charged >>4 ≈ 5120/copy → ~3-4 iterations, not 1000s
    expect(n).toBeGreaterThan(0)
    expect(n).toBeLessThan(20)
  })

  it('a cheap loop still runs its full statement budget (no over-charging)', () => {
    const rt = new Runtime(tokenize('N=0\nDo : Inc N : Loop', table), table, { maxSteps: 5_000_000, frameBudget: 20_000 })
    rt.frame()
    const n = Number((rt.interp as any).frames[0].vars.get('n').n)
    expect(n).toBeGreaterThan(1000) // uncharged loop runs thousands per frame
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
    rt.machine.mouse.buttons = 3
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
    m.mouse.buttons = 2
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
