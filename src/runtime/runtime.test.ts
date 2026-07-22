import { describe, expect, it } from 'vitest'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
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
  if (r.status !== 'ended' && r.status !== 'stopped') throw new Error(`program ${r.status}`)
  return rt
}

/** run and capture the text transcript */
function runOut(src: string): string {
  let out = ''
  const rt = new Runtime(tokenize(src, table), table, { maxSteps: 200_000, onText: (t) => (out += t) })
  const r = rt.runHeadless(1_000)
  if (r.status !== 'ended' && r.status !== 'stopped') throw new Error(`program ${r.status}`)
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

  it('honours Clip', () => {
    const rt = run('Clip 100,100 To 200,200\nInk 5 : Bar 0,0 To 319,199')
    expect(rt.screen.point(150, 150)).toBe(5)
    expect(rt.screen.point(50, 50)).toBe(1)
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
    const o = (y * 2 * 640 + x * 2) * 4
    return [data[o]!, data[o + 1]!, data[o + 2]!]
  }
  const GREEN = [0, 255, 0] // default palette colour 5 = $0F0

  it('grabs an image with Get Bob and shows it as a bob overlay', () => {
    const rt = run('Ink 5 : Bar 0,0 To 7,7\nGet Bob 1,0,0 To 8,8\nCls 0\nBob 1,100,50,1')
    expect(rt.screen.point(100, 50)).toBe(0) // framebuffer untouched (overlay)
    expect(at(rt, 100, 50)).toEqual(GREEN) // but composited
    expect(at(rt, 90, 50)).toEqual([0, 0, 0])
  })

  it('moves bobs with elided arguments and reads X Bob back', () => {
    const rt = run('Ink 5 : Bar 0,0 To 7,7 : Get Bob 1,0,0 To 8,8 : Cls 0\nBob 1,10,20,1\nBob 1,30,,\nIf X Bob(1)<>30 Then Error 1\nIf Y Bob(1)<>20 Then Error 2')
    expect(at(rt, 30, 20)).toEqual(GREEN)
  })

  it('stamps the framebuffer with Paste Bob', () => {
    const rt = run('Ink 5 : Bar 0,0 To 7,7 : Get Bob 1,0,0 To 8,8 : Cls 0\nPaste Bob 60,60,1')
    expect(rt.screen.point(60, 60)).toBe(5)
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

describe('composite', () => {
  it('produces a 640x400 RGBA frame with doubled lowres pixels', () => {
    const rt = run('Plot 10,20,2') // colour 2 = white
    const { width, height, data } = rt.composite()
    expect([width, height]).toEqual([640, 400])
    const at = (x: number, y: number): number[] => {
      const o = (y * 640 + x) * 4
      return [data[o]!, data[o + 1]!, data[o + 2]!]
    }
    expect(at(20, 40)).toEqual([255, 255, 255])
    expect(at(21, 41)).toEqual([255, 255, 255]) // 2x2 doubling
    expect(at(24, 40)).toEqual([170, 68, 0]) // orange background ($A40)
  })

  it('layers screens by z-order', () => {
    const rt = run('Screen Open 1,320,200,16,Lowres\nCls 0\nScreen To Back 1')
    const { data } = rt.composite()
    // screen 0 (orange) should be in front
    expect([data[0], data[1], data[2]]).toEqual([170, 68, 0])
  })
})
