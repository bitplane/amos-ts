import { describe, expect, it } from 'vitest'
import { mustFinish } from '../testing/run'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/source'
import { extensionById } from '../ext/registry'
import { Runtime } from './runtime'
import { IE_RASTPORT_OFFSET, rolL3, rolW3, rorW3 } from './intuiextendgfx'

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

/**
 * A screen's RastPort address, the way `Wb Screen Rastport` computes it:
 * the Screen address plus $54. Screens sit at SCREEN_CTRL_BASE + slot * SLOT.
 */
const rpAddr = (slot: number): number =>
  (Runtime.SCREEN_CTRL_BASE + slot * Runtime.SCREEN_CTRL_SLOT + IE_RASTPORT_OFFSET) >>> 0

const SCREEN = 'Screen Open 0,320,256,16,Lowres\nCls 0\n'
const RP = rpAddr(0)

describe('IntuiExtend 2.01b — the RastPort argument', () => {
  it('is a Screen address plus $54, which is what Wb Screen Rastport adds', () => {
    expect(IE_RASTPORT_OFFSET).toBe(0x54)
    expect(rpAddr(0) - Runtime.SCREEN_CTRL_BASE).toBe(0x54)
  })

  it('draws nothing for an address that is not a screen RastPort', () => {
    const b = run(`${SCREEN}Wb Plot 12345 To 10,10`)
    expect(b.rt.screen!.rp.point(10, 10)).toBe(0)
  })
})

describe('IntuiExtend 2.01b — the drawing primitives', () => {
  it('Wb Plot writes one pixel in the RastPort pen', () => {
    const b = run(`${SCREEN}Wb Gfx Ink ${RP} To 5,0\nWb Plot ${RP} To 10,20`)
    expect(b.rt.screen!.rp.point(10, 20)).toBe(5)
  })

  it('Wb Bar fills to the far corner, not to a width and height', () => {
    // the guide calls the last two W,H; they go into RectFill as xMax,yMax
    const b = run(`${SCREEN}Wb Gfx Ink ${RP} To 3,0\nWb Bar ${RP} To 10,10,20,20`)
    const rp = b.rt.screen!.rp
    expect(rp.point(10, 10)).toBe(3)
    expect(rp.point(20, 20)).toBe(3)
    // a width-and-height reading would have stopped at 30,30
    expect(rp.point(25, 25)).toBe(0)
  })

  it('Wb Box outlines and closes back on its start', () => {
    const b = run(`${SCREEN}Wb Gfx Ink ${RP} To 7,0\nWb Box ${RP} To 10,10,30,20`)
    const rp = b.rt.screen!.rp
    expect(rp.point(10, 10)).toBe(7)
    expect(rp.point(30, 10)).toBe(7)
    expect(rp.point(30, 20)).toBe(7)
    expect(rp.point(10, 20)).toBe(7)
    expect(rp.point(20, 15)).toBe(0) // hollow
  })

  it('Wb Curs moves the cursor and draws nothing', () => {
    const b = run(`${SCREEN}Wb Curs ${RP},40,50`)
    const rp = b.rt.screen!.rp
    expect([rp.cpX, rp.cpY]).toEqual([40, 50])
    expect(rp.point(40, 50)).toBe(0)
  })

  it('Wb Turtle Curs moves relatively', () => {
    const b = run(`${SCREEN}Wb Curs ${RP},40,50\nWb Turtle Curs ${RP} To 5,-10`)
    const rp = b.rt.screen!.rp
    expect([rp.cpX, rp.cpY]).toEqual([45, 40])
  })

  it('Wb Turtle Plot does not move the cursor, where Wb Turtle Draw does', () => {
    const plot = run(`${SCREEN}Wb Curs ${RP},40,50\nWb Turtle Plot ${RP} To 5,5`)
    expect([plot.rt.screen!.rp.cpX, plot.rt.screen!.rp.cpY]).toEqual([40, 50])
    const draw = run(`${SCREEN}Wb Curs ${RP},40,50\nWb Turtle Draw ${RP} To 5,5`)
    expect([draw.rt.screen!.rp.cpX, draw.rt.screen!.rp.cpY]).toEqual([45, 55])
  })

  it('Wb Gfx Ink sets both pens on the RastPort', () => {
    const b = run(`${SCREEN}Wb Gfx Ink ${RP} To 6,2`)
    expect([b.rt.screen!.rp.fgPen, b.rt.screen!.rp.bgPen]).toEqual([6, 2])
  })

  it('Wb Set Line writes the line pattern straight into rp_LinePtrn', () => {
    const b = run(`${SCREEN}Wb Set Line ${RP},$F0F0`)
    expect(b.rt.screen!.rp.linePtrn).toBe(0xf0f0)
  })

  it('Wb Gfx Mode writes rp_DrawMode', () => {
    expect(run(`${SCREEN}Wb Gfx Mode ${RP},2`).rt.screen!.rp.drawMode).toBe(2)
  })
})

describe('IntuiExtend 2.01b — Wb Draw transposes its start', () => {
  /**
   * `movem.w d2-d3,$24(a1)` at $50f6 writes d2 to rp_cp_x and d3 to rp_cp_y,
   * and the pops leave Y0 in d2 and X0 in d3. The guide says
   * "Wb Draw X0,Y0 To X1,Y1".
   */
  it('starts the line at (Y0, X0) rather than (X0, Y0)', () => {
    const b = run(`${SCREEN}Ink 4\nWb Draw 10,60 To 10,60`)
    const rp = b.rt.screen!.rp
    // a correct Wb Draw would have drawn a dot at (10,60); this draws a line
    // from (60,10) to (10,60), so the far end is lit and the near one is not
    expect(rp.point(10, 60)).toBe(4)
    expect(rp.point(60, 10)).toBe(4)
  })

  it('leaves the cursor at the END point, which is not transposed', () => {
    const b = run(`${SCREEN}Wb Draw 10,20 To 30,40`)
    expect([b.rt.screen!.rp.cpX, b.rt.screen!.rp.cpY]).toEqual([30, 40])
  })
})

describe('IntuiExtend 2.01b — Wb Screen redirects AMOS itself', () => {
  it('points AMOS at another screen, as the guide says it does', () => {
    // "Une alternative a la commande 'Screen ECRAN' d'amos"
    const src = `Screen Open 0,320,256,16,Lowres\nScreen Open 1,320,256,16,Lowres\nScreen 0\nWb Screen ${Runtime.SCREEN_CTRL_BASE + Runtime.SCREEN_CTRL_SLOT}\nPrint Screen`
    expect(lines(src)).toEqual(['1'])
  })
})

describe('IntuiExtend 2.01b — the print family', () => {
  it('Wb Print Locate stores pixels and Wb X Locate reads columns back', () => {
    const src = `Wb Print Locate 5,7\nPrint Wb X Print\nPrint Wb Y Print\nPrint Wb X Locate\nPrint Wb Y Locate`
    expect(lines(src)).toEqual(['40', '56', '5', '7'])
  })

  it('is a rotate rather than a shift, so a big column wraps back in', () => {
    // rol.w #$3 of 8192 is 1, where a shift would have given 0
    expect(rolW3(8192)).toBe(1)
    expect(rorW3(rolW3(5))).toBe(5)
  })

  /**
   * DEFECT: Xmove rotates a WORD ($3a14) and Ymove a LONG ($3a02), so the two
   * halves of what the guide presents as a pair do not agree.
   */
  it('Wb Print Xmove and Ymove use different shifts', () => {
    expect(rolW3(0x2000)).toBe(1) // the word rotate brings the top bit back
    expect(rolL3(0x2000)).toBe(0x10000) // the long one carries it up instead
    const src = `Wb Print Locate 0,0\nWb Print Xmove 8192\nWb Print Ymove 8192\nPrint Wb X Print\nPrint Wb Y Print`
    // x wraps to 1; y shifts to $10000 and the add.w keeps only its low word
    expect(lines(src)).toEqual(['1', '0'])
  })

  it('Wb Print Ink puts PEN in BackPen and PAPER in FrontPen', () => {
    // the first argument popped is the LAST, and it goes to $1(a0)
    const b = run(`${SCREEN}Wb Print Ink 3,5\nWb Print "x" To ${RP}`)
    // FrontPen took PAPER, so that is what the text is drawn in
    expect(b.rt.intuiextend.print.frontPen).toBe(5)
    expect(b.rt.intuiextend.print.backPen).toBe(3)
  })

  it('Wb Gfx Len is eight pixels a character, whatever the font is', () => {
    expect(lines('Print Wb Gfx Len("hello")')).toEqual(['40'])
    expect(lines('Print Wb Gfx Len("")')).toEqual(['0'])
  })
})

describe('IntuiExtend 2.01b — reading back', () => {
  it('Wb Point reads a pixel from AMOS own RastPort', () => {
    const src = `${SCREEN}Ink 6\nPlot 20,30\nPrint Wb Point(20,30)`
    expect(lines(src)).toEqual(['6'])
  })

  it('Wb Point answers -1 outside the bitmap rather than reading on', () => {
    expect(lines(`${SCREEN}Print Wb Point(-1,0)`)).toEqual(['-1'])
    expect(lines(`${SCREEN}Print Wb Point(0,-1)`)).toEqual(['-1'])
    expect(lines(`${SCREEN}Print Wb Point(0,256)`)).toEqual(['-1'])
    expect(lines(`${SCREEN}Print Wb Point(320,0)`)).toEqual(['-1'])
  })

  it('Wb Get Colour reads one entry of the screen palette', () => {
    const src = `${SCREEN}Colour 3,$F80\nPrint Wb Get Colour(${Runtime.SCREEN_CTRL_BASE},3)`
    expect(lines(src)).toEqual([`${0xf80}`])
  })
})

describe('IntuiExtend 2.01b — Wb Paint', () => {
  it('floods from a point in the RastPort pen', () => {
    // mode 0 is the one that spreads over the seed's own colour; the mode is
    // passed straight through to graphics Flood, whichever way round it means
    const src = `${SCREEN}Wb Gfx Ink ${RP} To 2,0\nWb Box ${RP} To 10,10,40,40\nWb Gfx Ink ${RP} To 5,0\nWb Paint Mode 0\nWb Paint ${RP} To 20,20`
    const b = run(src)
    expect(b.rt.screen!.rp.point(20, 20)).toBe(5)
    expect(b.rt.screen!.rp.point(50, 50)).toBe(0) // did not escape the box
  })

  it('Wb Paint Mode is remembered between calls', () => {
    expect(run('Wb Paint Mode 1').rt.intuiextend.paintMode).toBe(1)
  })
})

describe('IntuiExtend 2.01b — the drawing stragglers', () => {
  /**
   * DEFECT: routine 55 loads a0/d0/d1/d2/d3 --- SetRGB4's arguments --- and
   * calls -$c0, which `graphics_lib.fd` gives as LoadRGB4(vp,colors,count).
   * a1 is never set, so nothing the caller asked for reaches the palette.
   */
  it('Wb Set Colour leaves the palette alone', () => {
    const b = run(`${SCREEN}S=Wb Screen Base\nWb Set Colour S To 3,15,0,0\nPrint Colour(3)`)
    // whatever the palette held before, the keyword did not put $F00 there
    expect(b.out().trim()).not.toBe('3840')
  })

  /** and it still takes its five arguments */
  it('Wb Set Colour parses SCREEN To CNB,R,G,B', () => {
    expect(ie.tokens.find((t) => t.name === 'wb set colour')!.spec).toBe('I0t0,0,0,0')
    expect(() => run(`${SCREEN}S=Wb Screen Base\nWb Set Colour S To 3,15,0`)).toThrow()
  })

  /** the shared plotter at routine 200 takes the colour from the caller */
  it('Wb Pset plots in the colour it is given', () => {
    const b = run(`${SCREEN}Wb Pset 40,50,7`)
    expect(b.rt.screen!.rp.point(40, 50)).toBe(7)
  })

  /**
   * DEFECT: Gfxi says "Cette commande ne modifie pas la position du curseur
   * graphique", and `movem.w d6-d7,$24(a2)` is the first instruction of the
   * routine it branches into. X Graphic and Y Graphic read that cursor.
   */
  it('Wb Pset moves the graphics cursor the guide says it leaves alone', () => {
    // rp_cp_x and rp_cp_y are the RastPort's own pair, which is not the
    // cursor `X Graphic` reads: AMOS keeps that one itself
    const b = run(`${SCREEN}Wb Pset 40,50,7`)
    expect([b.rt.screen!.rp.cpX, b.rt.screen!.rp.cpY]).toEqual([40, 50])
  })

  /** the clip is an unsigned compare, so a negative coordinate falls out */
  it('Wb Pset clips instead of wrapping', () => {
    // no Print: the glyph would land on the pixel under test
    const b = run(`${SCREEN}Wb Pset -1,-1,7\nWb Pset 5000,5000,7`)
    expect(b.rt.screen!.rp.point(0, 0)).toBe(0)
    expect(b.rt.screen!.rp.point(319, 255)).toBe(0)
  })

  /**
   * `asl.l #$8,d3 / divu.w #$16a,d3` is radius / root two, one octant, and
   * each step takes an integer square root of `r*r - x*x`.
   */
  it('Wb Circle draws a ring and leaves the middle empty', () => {
    const b = run(`${SCREEN}Ink 5\nWb Circle 100,100,20`)
    const rp = b.rt.screen!.rp
    expect(rp.point(120, 100)).toBe(5)
    expect(rp.point(80, 100)).toBe(5)
    expect(rp.point(100, 120)).toBe(5)
    expect(rp.point(100, 80)).toBe(5)
    expect(rp.point(100, 100)).toBe(0)
    expect(rp.point(110, 100)).toBe(0)
  })

  /** the pen is rp_FgPen, read as `move.b $19(a2),d7` */
  it('Wb Circle draws in the current ink', () => {
    const b = run(`${SCREEN}Ink 9\nWb Circle 60,60,10`)
    expect(b.rt.screen!.rp.point(70, 60)).toBe(9)
  })

  /**
   * The last `Draw` is outside the loop and goes back to (X0,Y0), so the
   * curve closes on its own start and the cursor ends there.
   */
  it('Wb Spline closes back on its starting point', () => {
    const b = run(`${SCREEN}Ink 4\nWb Spline 20,20 To 60,80 To 100,20,8`)
    expect([b.rt.screen!.rp.cpX, b.rt.screen!.rp.cpY]).toEqual([20, 20])
  })

  /** and it puts ink down between the ends */
  it('Wb Spline draws a curve', () => {
    const b = run(`${SCREEN}Ink 4\nWb Spline 20,20 To 60,80 To 100,20,8`)
    const rp = b.rt.screen!.rp
    let lit = 0
    for (let y = 0; y < 100; y++) for (let x = 0; x < 120; x++) if (rp.point(x, y) === 4) lit++
    expect(lit).toBeGreaterThan(40)
  })

  /** `move.w $0(a2),d5 / beq` skips the divide, so NB of 0 draws one line */
  it('Wb Spline with NB of zero still closes the curve', () => {
    const b = run(`${SCREEN}Ink 4\nWb Spline 20,20 To 60,80 To 100,20,0`)
    expect([b.rt.screen!.rp.cpX, b.rt.screen!.rp.cpY]).toEqual([20, 20])
  })

  /**
   * Both arguments are RastPorts and every copy is one full-width row, so a
   * roll between two screens moves pixels across.
   */
  it('Wb Roll Screen copies rows from one screen to the other', () => {
    const b = run(
      'Screen Open 0,320,256,16,Lowres\nCls 0\nInk 6\nBar 0,0 To 319,255\n' +
        'Screen Open 1,320,256,16,Lowres\nCls 0\n' +
        `Wb Roll Screen ${rpAddr(0)} To ${rpAddr(1)},2`,
    )
    const dst = b.rt.screens.get(1)!.rp
    let lit = 0
    for (let y = 0; y < 256; y++) if (dst.point(10, y) === 6) lit++
    expect(lit).toBeGreaterThan(0)
  })

  /** an address that is not a screen RastPort does nothing at all */
  it('Wb Roll Screen refuses a RastPort it does not know', () => {
    const b = run(`${SCREEN}Wb Roll Screen 12345 To 67890,2\nPrint 1`)
    expect(b.out().trim()).toBe('1')
  })
})
