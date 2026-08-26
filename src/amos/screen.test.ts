import { describe, expect, it } from 'vitest'
import { Amos } from './amos'
import { EditorScreen } from './screen'
import { ED_SYSTEME } from '../runtime/edmessages.gen'
import { ED } from '../editor/commands'
import { FONT8 } from '../runtime/font.gen'

/** the characters of one text row of the editor's window, read off the screen */
function row(amos: Amos, n: number): string {
  const s = amos.display!.screen!
  const w = s.windows.get(8)!
  let out = ''
  for (let c = 0; c < w.cols; c++) out += glyph(amos, w.x + c * 8, w.y + n * 8)
  return out.replace(/\s+$/, '')
}

/**
 * Which character is drawn at a pixel position, by matching the eight rows of
 * every glyph in the font against what is on the screen.
 *
 * The screen holds pixels and nothing else once a Print has landed, which is
 * the whole point of drawing through the console rather than around it. So a
 * test that wants to know what it says has to read it back the same way a
 * person would.
 */
function glyph(amos: Amos, x: number, y: number): string {
  const s = amos.display!.screen!
  let bits = ''
  for (let dy = 0; dy < 8; dy++) {
    for (let dx = 0; dx < 8; dx++) bits += (s.point(x + dx, y + dy) ?? 0) & 1 ? '1' : '0'
  }
  if (!bits.includes('1')) return ' '
  for (let code = 32; code < 127; code++) {
    if (bits === bitsOf(code)) return String.fromCharCode(code)
  }
  return '?'
}

let font: Map<number, string> | null = null
function bitsOf(code: number): string {
  if (font === null) {
    font = new Map()
    // the same 8x8 face the console draws with
    for (let c = 0; c < 256; c++) {
      let bits = ''
      const g = FONT8[c]
      for (let dy = 0; dy < 8; dy++) {
        const b = g?.[dy] ?? 0
        for (let dx = 0; dx < 8; dx++) bits += (b >> (7 - dx)) & 1 ? '1' : '0'
      }
      font.set(c, bits)
    }
  }
  return font.get(code) ?? ''
}

function boot(source: string): Amos {
  const amos = new Amos(source)
  amos.openDisplay()
  return amos
}

describe('the editor on an AMOS screen', () => {
  it('opens EcEdit, which is screen 9 and 640x256', () => {
    // `EcEdit: equ 9` (+Equ.s:763), and `Ed_OpenIt` (+Edit.s:305) opens it at
    // `Ed_Sx` by `Ed_Sy` rounded up to a multiple of eight
    const amos = boot('Print "A"')
    const s = amos.display!.screen!
    expect(EditorScreen.EC_EDIT).toBe(9)
    expect([s.width, s.height, s.depth]).toEqual([640, 256, 3])
    // `Ed_Wx` and `Ed_Wy` out of the config block
    expect([s.displayX, s.displayY]).toEqual([129, 50])
  })

  it('takes its palette from the config and not from the resource bank', () => {
    // `EdC_SetPalette` runs in `Ed_OpenIt` before either screen opens. The
    // bank's own words differ in two places: colour 1 is $0f2 there and $06f
    // in the config, colour 3 is $fff there and $eee here.
    const amos = boot('')
    const pal = amos.display!.screen!.palette
    expect([pal[0], pal[1], pal[3], pal[7]]).toEqual([0x000, 0x06f, 0xeee, 0xff3])
  })

  it('opens one AMOS window pair per editor window, numbered Edt_Order times eight', () => {
    // `Edt_Window(a4)` is `Edt_Order` shifted left three and `Edt_WindEtat`
    // is one past it (+Edit.s:11637), so the first editor window never lands
    // on window 0 and a second one gets 16 and 17.
    const amos = boot('Print "A"')
    const s = amos.display!.screen!
    expect([...s.windows.keys()].sort((a, b) => a - b)).toEqual([0, 8, 9])
    const text = s.windows.get(8)!
    // `Edt_WindSx` is `Ed_Sx - 16`, the right border's width, and `Edt_WindY`
    // is the window top plus `Edt_EtatSy`
    expect([text.x, text.y, text.cols]).toEqual([0, 16 + 11, 78])
    // `Edt_WindEX` is 32 and `Edt_WindESx` is `Ed_Sx - 32 - 64`
    const status = s.windows.get(9)!
    expect([status.x, status.y, status.cols, status.rows]).toEqual([32, 17, 68, 1])
  })

  it('prints the program into the text window, where it can be read back', () => {
    const amos = boot('Print "HELLO"\nPrint "WORLD"')
    expect(row(amos, 0)).toBe('Print "HELLO"')
    expect(row(amos, 1)).toBe('Print "WORLD"')
    expect(row(amos, 2)).toBe('')
  })

  it('prints the text through ESC J1, so the window furniture survives it', () => {
    // System message 20 ends in `ESC J1`, so a program line goes into plane 0
    // and the bar `Ed_Unpack` laid down in planes 1 and 2 shows through. The
    // test is that a character cell still has colour outside plane 0.
    expect(ED_SYSTEME[19]!.endsWith('\x1bJ1\x00')).toBe(true)
    const amos = boot('Print "A"')
    const s = amos.display!.screen!
    const text = s.windows.get(8)!
    let upper = 0
    for (let dy = 0; dy < 8; dy++) {
      for (let dx = 0; dx < 8; dx++) upper |= s.point(text.x + dx, text.y + dy) & ~1
    }
    expect(upper).not.toBe(0)
  })

  it('puts the status line in its own window, with the fields message 1 marks', () => {
    const amos = boot('Print "A"')
    const s = amos.display!.screen!
    const w = s.windows.get(9)!
    let line = ''
    for (let c = 0; c < w.cols; c++) line += glyph(amos, w.x + c * 8, w.y)
    // message 2 is the background of labels and the figures are written over
    // it: window 1, line 1, column 1
    expect(line).toContain('Window')
    expect(line).toContain('Free')
    // message 7 is the name a program that was never saved shows
    expect(line.trimEnd()).toBe('Window-1  I L-1     C-1   Free-32766    Edit-New project')
  })

  it('draws the block highlight by printing messages 17 and 18 round it', () => {
    // `.Inverse` and `.Normal` in `Ed_ALigne` (+Edit.s:10469) are system
    // messages 17 and 18: paper 3 pen 2, and paper 2 pen 3 back again. So a
    // highlighted run is the same glyphs with the two colours swapped, and
    // counting the pixels of each is what proves it rather than reading one.
    const count = (): [number, number] => {
      const s = amos.display!.screen!
      const t = s.windows.get(8)!
      let two = 0
      let three = 0
      for (let dy = 0; dy < 8; dy++) {
        for (let dx = 0; dx < 8; dx++) {
          const c = s.point(t.x + dx, t.y + dy)
          if (c === 2) two++
          if (c === 3) three++
        }
      }
      return [two, three]
    }
    const amos = boot('Print "AB"')
    const [two, three] = count()
    expect(two + three).toBe(64)
    amos.window.yBloc = 0
    amos.window.xBloc = 0
    amos.window.xCu = 2
    amos.display!.affBuf(amos.window)
    expect(count()).toEqual([three, two])
  })

  it('sizes the window to the screen on the way in, which is 28 rows', () => {
    // `Ed_OpenIt`'s `.Mod` block (+Edit.s:310) asks `Edt_WMaxSize` with -1
    // what the current window could have without touching the others. The
    // sum is `Ed_Sy` less the title strip, less the window's own two bars,
    // over eight: (256 - 16 - 16) / 8.
    const amos = boot('Print "A"')
    expect(amos.window.windTy).toBe(28)
    const s = amos.display!.screen!
    expect(s.windows.get(8)!.rows).toBe(28)
  })

  it('refills the edit buffer before printing it, because the window resized', () => {
    // `Ed_NewBuf` (+Edit.s:10302) is `Ed_BufUntok` and then `Ed_AffBuf`, and
    // `Ed_DrawWindows` calls it after handing the window its share of the one
    // `Ed_BufE` allocation. Without the refill the buffer still holds
    // whatever the window's old height had in it, which is nothing at all
    // when `.Mod` has just resized it.
    const amos = boot(['Print "ONE"', 'Print "TWO"', 'Print "THREE"'].join('\n'))
    expect([row(amos, 0), row(amos, 1), row(amos, 2)]).toEqual([
      'Print "ONE"',
      'Print "TWO"',
      'Print "THREE"',
    ])
  })

  it('lets the escape screen borrow screen 9 rather than opening another', () => {
    // `Esc_Appear` (+Edit.s:9356) is `EcCalD Active,EcEdit` and then drawing:
    // the escape screen IS the editor's screen with the editor's window taken
    // down and its own put up. One slot, one screen, and `Ed_Appear` is what
    // puts the editor back on it.
    const amos = boot('Print "A"')
    const s = amos.display!.screen!
    const rt = amos.runtime!
    rt.directScreen.open()
    expect(rt.screens.get(9)).toBe(s)
    expect(s.windows.has(1)).toBe(true)
    rt.directScreen.close()
    // the editor's screen is still there afterwards, and the escape screen's
    // window is not
    expect(rt.screens.get(9)).toBe(s)
    expect(s.windows.has(1)).toBe(false)
    amos.display!.draw()
    expect(row(amos, 0)).toBe('Print "A"')
  })

  it('lays a second window out under the first, at the sum topY adds up', () => {
    // `Ed_DrawWindows` walks the list with `move.w #16+Ed_YTop,-(sp)` and
    // adds `Edt_EtatSy + Edt_BasSy` plus the rows for each window it passes.
    const amos = boot('Print "A"')
    amos.call(ED.OPEN_NEW)
    const s = amos.display!.screen!
    expect([...s.windows.keys()].sort((a, b) => a - b)).toEqual([0, 8, 9, 16, 17])
    const first = amos.editor.list[0]!
    const second = s.windows.get(16)!
    expect(second.y).toBe(16 + 11 + first.windTy * 8 + 5 + 11)
  })
})
