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
  // The cell the caret is in has rows 5 and 6 rewritten: `CurNor`
  // (+Edit.s:15230) is `%11111111` twice and `AffCur` (+W.s:13575) ORs or
  // ANDs it into every plane. Match the six rows it leaves alone.
  const without = (b: string): string => b.slice(0, 5 * 8) + b.slice(7 * 8)
  for (let code = 32; code < 127; code++) {
    if (without(bits) === without(bitsOf(code))) return String.fromCharCode(code)
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
    // the SECOND cell, because the caret sits in the first and rewrites two
    // of its rows in every plane
    const count = (): [number, number] => {
      const s = amos.display!.screen!
      const t = s.windows.get(8)!
      let two = 0
      let three = 0
      for (let dy = 0; dy < 8; dy++) {
        for (let dx = 8; dx < 16; dx++) {
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

  it('does not refill the edit buffer on a repaint, or a typed line is lost', () => {
    // `Ed_DrawWindows` ends in `Ed_NewBuf`, and `Ed_NewBuf` is `Ed_BufUntok`:
    // it fills `Edt_BufE` from the PROGRAM. A line being typed is not in the
    // program until `Ed_TokCur`, so a full redraw after every key threw the
    // key away. `FlagFonc` (+Edit.s:3347) bit 0 asks for `Ed_AffBuf` and bit
    // 1 for `Ed_ALigne`, and neither refills.
    const amos = boot('Print "A"')
    for (const ch of 'XY') amos.key({ ch, scan: 0, shift: 0 })
    expect(amos.window.buf.text(0)).toBe('XYPrint "A"')
    expect(row(amos, 0)).toBe('XYPrint "A"')
  })

  it('runs what was typed, because Ed_Run tokenises the edit buffer first', () => {
    // `Ed_Run` (+Edit.s:8165) opens with `Ed_TokCur`, which writes the line
    // being edited back into the program. Without it a program would run the
    // text as it was when the window was last drawn.
    const out: string[] = []
    const amos = new Amos('Print "OLD"', { onText: (t) => out.push(t) })
    amos.openDisplay()
    // the cursor starts at column 0, so this goes in front of the line there
    for (const ch of 'Print "NEW" : ') amos.key({ ch, scan: 0, shift: 0 })
    amos.call(ED.RUN)
    expect(out.join('').replace(/\s+/g, ' ').trim()).toBe('NEW OLD')
  })

  it('goes back to the full draw when a command changed the window layout', () => {
    // `Ed_DrawWindows` lays out the windows, and opening one is exactly the
    // case a row-by-row repaint cannot cover.
    const amos = boot('Print "A"')
    expect([...amos.display!.screen!.windows.keys()].sort((a, b) => a - b)).toEqual([0, 8, 9])
    amos.call(ED.OPEN_NEW)
    expect([...amos.display!.screen!.windows.keys()].sort((a, b) => a - b)).toEqual([0, 8, 9, 16, 17])
  })

  it('finds the twelve top buttons where Ed_DrawTop put them', () => {
    // `.Pa1` forces button 1 to x=0 and `.Pa2` pins button 2 to the right
    // edge; 3 to 12 walk from `Ed_BoutonsX`, which is past the DIRECT button
    // and past the 160-pixel logo.
    const d = boot('Print "A"').display!
    expect(d.hitTest(0, 0)).toEqual({ kind: 'button', n: 1 })
    expect(d.hitTest(639, 8)).toEqual({ kind: 'button', n: 2 })
    // the logo, which is not a button
    expect(d.hitTest(100, 8)).toBeNull()
    expect(d.hitTest(192, 8)).toEqual({ kind: 'button', n: 3 })
    expect(d.hitTest(192 + 32 * 9, 8)).toEqual({ kind: 'button', n: 12 })
    // the memory sliders after the last button
    expect(d.hitTest(192 + 32 * 10, 8)).toBeNull()
  })

  it('reads the twelve button commands out of system message 13', () => {
    // `Ed_MBouton` (+Edit.s:1406) indexes the message by `Bt_Number`
    expect(Array.from(ED_SYSTEME[12]!, (c) => c.charCodeAt(0))).toEqual([
      28, 105, 77, 78, 79, 145, 27, 91, 92, 75, 87, 29,
    ])
  })

  it('finds a window s parts the way the zone numbering divides them', () => {
    // `zone & 7`: 0 the text, 1 the status strip, 2 the bar below, 3 the
    // slider, 4 to 6 the three buttons
    const amos = boot('Print "A"')
    const d = amos.display!
    const w = amos.window
    expect(d.hitTest(0, 16)).toEqual({ kind: 'winButton', w, n: 1 })
    expect(d.hitTest(640 - 48, 16)).toEqual({ kind: 'winButton', w, n: 2 })
    expect(d.hitTest(640 - 24, 16)).toEqual({ kind: 'winButton', w, n: 3 })
    expect(d.hitTest(200, 16)).toEqual({ kind: 'status', w })
    expect(d.hitTest(24, 16 + 11)).toEqual({ kind: 'text', w, col: 3, row: 0 })
    // `Ed_SlVDeltaG` is 6 past `Edt_WindSx`, which is `Ed_Sx - 16`
    expect(d.hitTest(630, 16 + 11)).toEqual({ kind: 'slider', w, row: 0 })
    expect(d.hitTest(0, 16 + 11 + 28 * 8)).toEqual({ kind: 'bottom', w })
  })

  it('puts the cursor where the text was clicked', () => {
    const amos = boot(['Print "ONE"', 'Print "TWO"', 'Print "THREE"'].join('\n'))
    expect(amos.mouse(5 * 8, 16 + 11 + 2 * 8)).toBe(0)
    expect([amos.window.xCu, amos.window.yCu]).toEqual([5, 2])
  })

  it('starts a block when the click is on the cell the cursor is already in', () => {
    // `.Noe`'s two `cmp.w`: the same row and the same column, and only on the
    // press, is `Ed_BlocOn` rather than a move
    const amos = boot('Print "ONE"')
    amos.mouse(4 * 8, 16 + 11)
    expect(amos.window.yBloc).toBeLessThan(0)
    amos.mouse(4 * 8, 16 + 11)
    expect([amos.window.xBloc, amos.window.yBloc]).toEqual([4, 0])
  })

  it('ignores a held button for twenty polls, and drags after that', () => {
    // `.Pos` (+Edit.s:1341): `move.w Ed_MkCpt(a5),d0 / beq.s .Pos / cmp.w
    // #20,d0 / bcs Ed_MQuit`. Zero is the press and acts; 1 to 19 do nothing,
    // which is what stops a twitch turning every click into a drag.
    const amos = boot(['Print "ONE"', 'Print "TWO"'].join('\n'))
    amos.mouse(0, 16 + 11, 1, 0)
    amos.mouse(6 * 8, 16 + 11 + 8, 1, 5)
    expect([amos.window.xCu, amos.window.yCu]).toEqual([0, 0])
    amos.mouse(6 * 8, 16 + 11 + 8, 1, 25)
    expect([amos.window.xCu, amos.window.yCu]).toEqual([6, 1])
  })

  it('runs a top button s command: the sixth is the monitor', () => {
    // message 13's sixth byte is 145, `Ed_GoMonitor`, and with no monitor to
    // load it answers 222, "Monitor not found."
    const amos = boot('Print "A"')
    expect(amos.mouse(192 + 32 * 3, 8)).toBe(222)
  })

  it('gives the pointer its colours, which are the SPRITE half of the palette', () => {
    // `Ed_CopyPal` (+Edit.s:13816) copies sixteen words into `EcPal+32`,
    // colours 16 to 31. The mouse pointer is a hardware sprite and takes 17,
    // 18 and 19 from whichever screen owns the scanline, so a screen that
    // never had them written shows a black pointer.
    const amos = boot('Print "A"')
    const rt = amos.runtime!
    const s = amos.display!.screen!
    for (let i = 16; i < 32; i++) expect(s.palette[i]).toBe(rt.defaultPalette[i])
  })

  it('flashes the cursor colour, which is what makes the caret blink', () => {
    // `Dia_RScOpen`'s `.Fl` (+Lib.s:21021) runs `EcCall Flash` with
    // interpreter message 46 on the cursor colour the caller asked for, and
    // `Ed_OpenIt` passes 1 for `EcEdit`. The word "Flash" does not appear in
    // +Edit.s once: the screen library does it on the way in.
    const amos = boot('Print "A"')
    const rt = amos.runtime!
    const fl = rt.flashes.find((f) => f.reg === 1 && f.screen === 9)
    expect(fl).toBeDefined()
    expect(fl!.seq.length).toBeGreaterThan(1)
  })

  it('draws the caret as CurNor, two rows of underline', () => {
    // `Ed_DrawWindows` installs it with `WiCall SCurWi` and `Ed_Loop` turns
    // it on with `ESC "C1"`, because message 20 opened the window with
    // `ESC "C0"`. Rows 5 and 6 of the cursor cell are rewritten in every
    // plane, which is `AffCur`'s per-plane OR and AND-NOT.
    const amos = boot('Print "A"')
    const s = amos.display!.screen!
    const t = s.windows.get(8)!
    expect(Array.from(t.curDraw)).toEqual([0, 0, 0, 0, 0, 0xff, 0xff, 0])
    // the caret is colour 1 on paper 2, so the whole row is one colour
    const row5 = new Set<number>()
    for (let dx = 0; dx < 8; dx++) row5.add(s.point(t.x + dx, t.y + 5))
    expect([...row5]).toEqual([1])
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
