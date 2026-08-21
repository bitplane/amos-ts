/**
 * The arithmetic in `./reqtools.ts`, pinned.
 *
 * Every number here was worked out by hand from `req.c`'s `GetString` for a
 * topaz-8 Workbench screen, 640 by 256, where `rtGetVScreenSize` answers a
 * spacing of 2. The point of writing them out rather than calling the code
 * twice is that a change to the layout has to be argued for against the
 * source it came from.
 */
import { describe, expect, it } from 'vitest'
import {
  EZREQF,
  FREQF,
  RT_FILEREQ_PREFS,
  RT_FONTREQ_PREFS,
  REQ_MODE,
  RT_LVO,
  RT_MAXINT,
  RT_MININT,
  RT_TAG,
  RT_TEXT,
  reqLayout,
  rtFormat,
  rtLabelKey,
  rtLabelWidth,
  rtSpacing,
  rtSpread,
  rtSplitBars,
  rtStrWidth,
  fileReqLayout,
  fontReqLayout,
  RT_PALETTE_INDICATOR,
  RT_SCREENMODEREQ_PREFS,
  SCREQF,
  paletteReqLayout,
  rtBuildColStr,
  rtMakeColVal,
  screenReqLayout,
  type FileReqSetup,
  type FontReqSetup,
  type ReqMetrics,
  type ReqSetup,
  type PaletteReqSetup,
  type ScreenReqSetup,
} from './reqtools'

/** topaz 8 on this port's Workbench, which is where every AMOS caller lands */
const WB: ReqMetrics = {
  screenFontHeight: 8,
  fontHeight: 8,
  wBorTop: 2,
  wBorLeft: 4,
  wBorRight: 4,
  wBorBottom: 2,
  visibleWidth: 640,
  visibleHeight: 256,
  measure: (s) => s.length * 8,
}

const setup = (over: Partial<ReqSetup>): ReqSetup => ({
  mode: REQ_MODE.EZREQUEST,
  body: '',
  gadgets: '',
  title: null,
  flags: 0,
  width: 0,
  underscore: '',
  defaultResponse: 1,
  min: RT_MININT,
  max: RT_MAXINT,
  minmax: false,
  ...over,
})

describe('reqtools: the numbers off the FD and the includes', () => {
  it('puts rtEZRequestA at -66 and rtPaletteRequestA at -102', () => {
    // bias 30 and six a function, so rtEZRequestA is the seventh entry and
    // rtPaletteRequestA the thirteenth
    expect(RT_LVO.rtEZRequestA).toBe(-(30 + 6 * 6))
    expect(RT_LVO.rtPaletteRequestA).toBe(-(30 + 12 * 6))
    expect(RT_LVO.rtGetLongA).toBe(-78)
  })

  it('bases every tag on TAG_USER', () => {
    expect(RT_TAG.Window).toBe(0x8000_0001)
    expect(RT_TAG.EZ_ReqTitle).toBe(0x8000_0014)
    expect(RT_TAG.FI_MatchPat).toBe(0x8000_0033)
  })

  it('answers a spacing of 4 only once the screen is 400 rows', () => {
    expect(rtSpacing(256)).toBe(2)
    expect(rtSpacing(399)).toBe(2)
    expect(rtSpacing(400)).toBe(4)
    expect(rtSpacing(512)).toBe(4)
  })
})

describe('reqtools: labels and formats', () => {
  it('takes back every underscore, not just the first', () => {
    const measure = (s: string): number => s.length * 8
    expect(rtLabelWidth('_Ok', measure, '_')).toBe(16)
    expect(rtLabelWidth('C_lea_r', measure, '_')).toBe(40)
    // no RT_Underscore means no shortcut and no subtraction
    expect(rtLabelWidth('_Ok', measure, '')).toBe(24)
  })

  it('gives the key to the LAST underscore', () => {
    expect(rtLabelKey('C_lear', '_')).toBe('l')
    expect(rtLabelKey('C_lea_r', '_')).toBe('r')
    expect(rtLabelKey('Ok', '_')).toBe('')
    // an underscore at the end marks nothing
    expect(rtLabelKey('Ok_', '_')).toBe('')
  })

  it('splits gadgets on bars, and an empty format is no gadgets at all', () => {
    expect(rtSplitBars('Yes|No|Cancel')).toEqual(['Yes', 'No', 'Cancel'])
    expect(rtSplitBars('Ok')).toEqual(['Ok'])
    expect(rtSplitBars('')).toEqual([])
  })

  it('fills the formats the binary carries', () => {
    expect(rtFormat(RT_TEXT.minMaxFmt, 1, 10)).toBe(' Min: 1, Max: 10 ')
    expect(rtFormat(RT_TEXT.maxFmt, 99)).toBe(' Max: 99 ')
    expect(rtFormat(RT_TEXT.full, 40)).toBe('40% full')
    expect(rtFormat(RT_TEXT.nameFmt, 'work')).toBe('work'.padEnd(40, ' ') + ' ')
    expect(rtFormat(RT_TEXT.selectedFmt, 12)).toBe('  12')
    expect(rtFormat(RT_TEXT.entrySizeFmt, 1024)).toBe(' 1024')
  })
})

describe('reqtools: rtSpread', () => {
  it('pins the first at min and the last against max', () => {
    expect(rtSpread([48, 40], 88, 8, 166)).toEqual([8, 126])
  })

  it('walks the middle out in 16.16, so three buttons do not drift', () => {
    // gap = ((300 - 0 - 150) << 16) / 2 = 75 exactly
    expect(rtSpread([50, 50, 50], 150, 0, 300)).toEqual([0, 125, 250])
    // and a gap that does not divide: (200 - 0 - 90) / 2 = 55
    expect(rtSpread([30, 30, 30], 90, 0, 200)).toEqual([0, 85, 170])
  })

  it('leaves a lone box at min, which is why req.c never calls it with one', () => {
    expect(rtSpread([40], 40, 8, 166)).toEqual([8])
  })
})

describe('reqtools: the EZRequest layout', () => {
  const l = reqLayout(setup({ body: 'Are you sure?', gadgets: 'Yes|No' }), WB)

  it('is 174 by 57', () => {
    // 13 characters is 104 pixels, and a body sets the width to len + 70
    expect(l.width).toBe(174)
    // spacing*2 + scrfont + textht + 1 + WBorTop + WBorBottom, then a
    // gadget row of spacing + fontht + 6
    expect(l.height).toBe(41 + 16)
  })

  it('is titled Request, because it has two gadgets', () => {
    expect(l.title).toBe(RT_TEXT.request)
    expect(reqLayout(setup({ body: 'Done', gadgets: 'Ok' }), WB).title).toBe(RT_TEXT.information)
    expect(reqLayout(setup({ body: 'Done' }), WB).title).toBe(RT_TEXT.information)
  })

  it('takes an EMPTY RTEZ_ReqTitle as a title, because req.c tests the pointer', () => {
    expect(reqLayout(setup({ body: 'Done', gadgets: 'Ok', title: '' }), WB).title).toBe('')
    expect(reqLayout(setup({ body: 'Done', gadgets: 'Ok', title: 'Mine' }), WB).title).toBe('Mine')
  })

  it('numbers the gadgets left to right and gives the RIGHTMOST zero', () => {
    expect(l.buttons.map((b) => b.ret)).toEqual([1, 0])
    expect(l.buttons.map((b) => b.text)).toEqual(['Yes', 'No'])
  })

  it('spreads them between the two borders', () => {
    expect(l.buttons[0]?.box).toEqual({ x: 8, y: 39, w: 48, h: 14 })
    expect(l.buttons[1]?.box).toEqual({ x: 126, y: 39, w: 40, h: 14 })
  })

  it('prints the RETURN gadget in bold, and RTEZ_DefaultResponse moves it', () => {
    expect(l.buttons.map((b) => b.bold)).toEqual([true, false])
    const zero = reqLayout(setup({ body: 'x', gadgets: 'Yes|No', defaultResponse: 0 }), WB)
    expect(zero.buttons.map((b) => b.bold)).toEqual([false, true])
    const none = reqLayout(
      setup({ body: 'x', gadgets: 'Yes|No', flags: EZREQF.NORETURNKEY }),
      WB,
    )
    expect(none.buttons.map((b) => b.bold)).toEqual([false, false])
  })

  it('centres a lone gadget and makes RETURN press it', () => {
    const one = reqLayout(setup({ body: 'Are you sure?', gadgets: 'Ok' }), WB)
    // (174 - (16 + 24)) / 2
    expect(one.buttons[0]?.box.x).toBe(67)
    expect(one.buttons[0]?.ret).toBe(0)
    expect(one.buttons[0]?.bold).toBe(true)
  })

  it('holds the body 35 pixels in, however narrow the box gets', () => {
    expect(l.lines).toEqual([{ text: 'Are you sure?', x: 35, y: 21 }])
    // a one-character body would centre at 33, and 35 is the floor
    expect(reqLayout(setup({ body: 'x', gadgets: 'Ok' }), WB).lines[0]?.x).toBe(35)
  })

  it('ragged-lefts the lines together unless EZREQF_CENTERTEXT is set', () => {
    const wide = setup({ body: 'a long enough line\nshort', gadgets: 'Ok' })
    const ragged = reqLayout(wide, WB)
    expect(ragged.lines.map((n) => n.x)).toEqual([35, 35])
    const centred = reqLayout({ ...wide, flags: EZREQF.CENTERTEXT }, WB)
    // width is 18*8 + 70 = 214, so the short line centres at (214 - 40) / 2
    expect(centred.lines.map((n) => n.x)).toEqual([35, 87])
    expect(centred.lines.map((n) => n.y)).toEqual([21, 30])
  })

  it('sinks the body into a box and leaves the face around it', () => {
    expect(l.textBox).toEqual({ x: 8, y: 13, w: 158, h: 24 })
    expect(l.backFill).toEqual({ x: 4, y: 11, w: 166, h: 44 })
    expect(l.stringBox).toBeNull()
    expect(l.minmaxBox).toBeNull()
  })

  it('hangs REQPOS_POINTER off the last gadget', () => {
    expect(l.pointerLeft).toBe(-126 - 20)
    expect(l.pointerTop).toBe(-57 + 4 + 5 + 2)
  })
})

describe('reqtools: rtGetLongA', () => {
  const l = reqLayout(setup({ mode: REQ_MODE.ENTER_NUMBER, min: 1, max: 10, minmax: true }), WB)

  it('takes the default gadgets, and the underscore back with them', () => {
    expect(l.buttons.map((b) => b.text)).toEqual([' Ok ', 'Cancel'])
    expect(l.buttons.map((b) => b.key)).toEqual(['O', 'C'])
    expect(l.buttons.map((b) => b.ret)).toEqual([1, 0])
    expect(l.buttons[0]?.box).toEqual({ x: 8, y: 43, w: 56, h: 14 })
    expect(l.buttons[1]?.box).toEqual({ x: 100, y: 43, w: 72, h: 14 })
  })

  it('never prints one in bold, because the mode forces NORETURNKEY', () => {
    expect(l.buttons.every((b) => !b.bold)).toBe(true)
  })

  it('is 180 wide and 61 high, with the Min/Max readout in the middle', () => {
    expect(l.width).toBe(180)
    expect(l.height).toBe(61)
    expect(l.minmaxText).toBe(' Min: 1, Max: 10 ')
    expect(l.minmaxBox).toEqual({ x: 18, y: 29, w: 144, h: 12 })
    expect(l.stringBox).toEqual({ x: 8, y: 13, w: 164, h: 14 })
  })

  it('says only the end it was given', () => {
    const lo = reqLayout(setup({ mode: REQ_MODE.ENTER_NUMBER, min: 5, minmax: true }), WB)
    expect(lo.minmaxText).toBe(' Min: 5 ')
    const hi = reqLayout(setup({ mode: REQ_MODE.ENTER_NUMBER, max: 5, minmax: true }), WB)
    expect(hi.minmaxText).toBe(' Max: 5 ')
  })

  it('widens for a readout that will not fit', () => {
    const l2 = reqLayout(
      setup({ mode: REQ_MODE.ENTER_NUMBER, min: -100000, max: 100000, minmax: true }),
      WB,
    )
    // ' Min: -100000, Max: 100000 ' is 27 characters, so 216 + 8 + 16
    expect(l2.width).toBe(240)
  })
})

describe('reqtools: rtGetStringA', () => {
  it('opens at 350 and takes RTGS_Width', () => {
    expect(reqLayout(setup({ mode: REQ_MODE.ENTER_STRING }), WB).width).toBe(350)
    expect(reqLayout(setup({ mode: REQ_MODE.ENTER_STRING, width: 250 }), WB).width).toBe(250)
  })

  it('lets a body text overrule the width the caller asked for', () => {
    // req.c assigns `glob->width = glob->len + 70` after the tag loop, so
    // RTGS_Width and RTGS_TextFmt together mean the tag is thrown away
    const body = 'what shall I call it?'
    const l = reqLayout(setup({ mode: REQ_MODE.ENTER_STRING, width: 600, body }), WB)
    expect(l.width).toBe(body.length * 8 + 70)
    // and 180 is the floor under that, applied after, so a short body puts
    // the width UP again rather than leaving it at 78
    const tiny = reqLayout(setup({ mode: REQ_MODE.ENTER_STRING, width: 600, body: 'x' }), WB)
    expect(tiny.width).toBe(180)
  })

  it('never gets narrower than its buttons', () => {
    const l = reqLayout(
      setup({ mode: REQ_MODE.ENTER_STRING, width: 100, gadgets: 'Save|Save As|Discard|Cancel' }),
      WB,
    )
    // four labels at measure + 24, plus 16 a gadget
    const gads = [4, 7, 7, 6].map((n) => n * 8 + 24).reduce((a, b) => a + b, 0)
    expect(l.width).toBe(gads + 4 * 16)
  })
})

describe('reqtools: an interlaced screen', () => {
  it('doubles every gap without touching the widths', () => {
    const hires: ReqMetrics = { ...WB, visibleHeight: 512 }
    const flat = reqLayout(setup({ body: 'Are you sure?', gadgets: 'Yes|No' }), WB)
    const lace = reqLayout(setup({ body: 'Are you sure?', gadgets: 'Yes|No' }), hires)
    expect(lace.width).toBe(flat.width)
    // spacing goes 2 to 4, and an EZRequest counts it three times
    expect(lace.height).toBe(flat.height + 6)
  })
})

describe('reqtools: the file requester layout', () => {
  const fileSetup = (over: Partial<FileReqSetup> = {}): FileReqSetup => ({
    title: 'Load',
    okText: RT_TEXT.ok,
    underscore: '_',
    dir: 'DH0:',
    pattern: '',
    file: '',
    flags: FREQF.PATGAD,
    height: 0,
    hideInfo: false,
    reqPos: RT_FILEREQ_PREFS.reqPos,
    ...over,
  })

  const l = fileReqLayout(fileSetup(), WB)

  it('is as wide as four `_Volumes`-sized buttons, over a floor of 300', () => {
    // width2 is the WIDEST of the four labels plus 16, given to all four:
    // `_Volumes` measures 56 with its underscore taken out, so 72 each. Then
    // 72*4 + 3*8 + (9 + 9) is 330, which clears the `winwidth < 300` floor
    expect(l.width).toBe(330)
    expect(l.buttons.every((g) => g.box.w === 72)).toBe(true)
  })

  it('takes 75 per cent of the visible height and rounds the list to fit', () => {
    // reqheight = 75 * 256 / 100 = 192, and `below` for a pattern gadget and
    // no multiselect is (14+2)*3 + 4 + 14 + 1 = 67
    expect(l.entryHeight).toBe(9)
    // start_top is 2 + 8 + 1 + 2 = 13, and BottomBorderHeight is 10
    expect(l.entries).toBe(Math.trunc((192 - 67 - 13 - 10) / 9))
  })

  it('never shows fewer than the ten entries the prefs ask for', () => {
    // a 200-row screen leaves room for six, and MinEntries puts it back to 10
    const small = fileReqLayout(fileSetup(), { ...WB, visibleHeight: 200 })
    expect(small.entries).toBe(RT_FILEREQ_PREFS.minEntries)
  })

  it('puts the scroller 18 wide against the right border', () => {
    expect(l.scroller.w).toBe(18)
    expect(l.scroller.x + l.scroller.w).toBe(l.width - (WB.wBorRight + 5))
    expect(l.boxRight).toBe(l.width - 21 - (WB.wBorRight + 5))
    expect(l.listFrame.h).toBe(l.entries * l.entryHeight + 4)
  })

  it('has four buttons, spread, with the caller\'s Ok text on the left', () => {
    expect(l.buttons.map((g) => g.text)).toEqual([' Ok ', 'Volumes', 'Parent', 'Cancel'])
    expect(l.buttons.map((g) => g.key)).toEqual(['O', 'V', 'P', 'C'])
    expect(l.buttons[0]?.box.x).toBe(WB.wBorLeft + 5)
    expect(l.buttons[3]!.box.x + l.buttons[3]!.box.w).toBe(l.width - (WB.wBorRight + 5))
    // all four are the same width, `for (i) gadlen[i+4] = width2`
    const w = l.buttons.map((g) => g.box.w)
    expect(new Set(w).size).toBe(1)
  })

  it('has no top row without FREQF_MULTISELECT, and four with it', () => {
    expect(l.top).toEqual([])
    const multi = fileReqLayout(fileSetup({ flags: FREQF.PATGAD | FREQF.MULTISELECT }), WB)
    expect(multi.top.map((g) => g.text)).toEqual(['Selected:', 'All', 'Match..', 'Clear'])
    expect(multi.top.map((g) => g.key)).toEqual(['', 'A', 'M', 'l'])
    // the extra row costs `buttonheight + spacing`, and it comes out of the
    // list: `val` grows by one gadget row before the entries are counted, so
    // eleven rows become ten and the window is only 7 pixels taller
    expect(l.entries).toBe(11)
    expect(multi.entries).toBe(10)
    expect(multi.height).toBe(l.height + 16 - l.entryHeight)
  })

  it('drops the Pattern field without FREQF_PATGAD, and the window with it', () => {
    const plain = fileReqLayout(fileSetup({ flags: 0 }), WB)
    expect(plain.pattern).toBeNull()
    expect(l.pattern).not.toBeNull()
    // the same list height, one row fewer of gadgets
    expect(plain.entries).toBeGreaterThan(l.entries)
  })

  it('sizes the LED off the font and hangs the Drawer field beside it', () => {
    // led_h = max(fontheight - 4, 7) = 7, led_w = 15
    expect(l.led.w).toBe(15)
    expect(l.led.h).toBe(7)
    expect(l.drawer.x).toBe(WB.wBorLeft + 5 + 15 + 6)
    // the File field starts back at the border, `ng.ng_LeftEdge -= led_off`
    expect(l.file?.x).toBe(WB.wBorLeft + 5)
    expect(l.file?.w).toBe(l.drawer.w + 15 + 6)
  })

  it('gives Get and ._info the same width, the wider of the two labels', () => {
    expect(l.get.box.w).toBe(l.info?.box.w)
    expect(l.get.box.x).toBe(l.info?.box.x)
    // `._info` is six characters and `_Get` is four, and both lose one
    // underscore to StrWidth_noloc
    expect(l.get.box.w).toBe(5 * 8 + 8)
  })

  it('measures a label the file requester way, not the EZRequest way', () => {
    const m = (s: string): number => s.length * 8
    // StrWidth_noloc drops the first underscore only; myTextLength drops all
    expect(rtStrWidth('C_lea_r', m)).toBe(48)
    expect(rtLabelWidth('C_lea_r', m, '_')).toBe(40)
  })
})

describe('reqtools: the font requester layout', () => {
  const fontSetup = (over: Partial<FontReqSetup> = {}): FontReqSetup => ({
    title: 'Pick a font',
    okText: RT_TEXT.ok,
    underscore: '_',
    flags: FREQF.SCALE,
    height: 0,
    sampleHeight: 24,
    minSize: 0,
    maxSize: RT_MAXINT,
    ...over,
  })

  const l = fontReqLayout(fontSetup(), WB)

  it('lands on 300 by its own arithmetic and by the floor at once', () => {
    // gadlen[i] = checkw + 8 - 16 + StrWidth + 16, so 18 + 32 + 16, 18 + 48 +
    // 16 and 18 + 72 + 16 for `_Bold`, `_Italic` and `_Underline`. That is
    // 254, and 254 + (3-1)*8 + 18 + 12 is exactly 300 --- which is also the
    // floor, so the two agree to the pixel
    expect(l.width).toBe(300)
  })

  it('measures its width off three gadgets it is not going to draw', () => {
    // `gadtxt[0..2]` and `width1` are filled before FREQF_STYLE is tested,
    // and this requester never sets it. Widening `_Underline` widens the
    // window even though no checkbox appears
    const wide = fontReqLayout(fontSetup(), { ...WB, measure: (s) => s.length * 12 })
    // 18*3 + (48 + 72 + 108) + 48 = 330, + 16 + 18 + 12
    expect(wide.width).toBe(330 + 46)
  })

  it('takes 65 per cent of the height and never lists more than ten faces', () => {
    // reqheight = 65 * 256 / 100 = 166, and `below` is 14*2 + 2*3 + 1 + 8 +
    // 24 = 67 for the name row, the sample and the buttons
    expect(l.entries).toBe(Math.trunc((166 - 67 - 13 - 10) / 9))
    expect(l.entries).toBe(8)
    const tall = fontReqLayout(fontSetup(), { ...WB, visibleHeight: 512 })
    expect(tall.entries).toBe(RT_FONTREQ_PREFS.maxEntries)
    const small = fontReqLayout(fontSetup(), { ...WB, visibleHeight: 200 })
    expect(small.entries).toBe(RT_FONTREQ_PREFS.minEntries)
  })

  it('has two buttons, Ok at the left border and Cancel at the right', () => {
    expect(l.buttons.map((g) => g.text)).toEqual([' Ok ', 'Cancel'])
    expect(l.buttons.map((g) => g.key)).toEqual(['O', 'C'])
    // `gadtxt[5] = gadtxt[7]` before the row is measured, so both take the
    // width of the wider label: `Cancel` is 48 and ` Ok ` is 32
    expect(l.buttons.every((g) => g.box.w === 64)).toBe(true)
    expect(l.buttons[0]?.box.x).toBe(WB.wBorLeft + 5)
    expect(l.buttons[1]!.box.x + l.buttons[1]!.box.w).toBe(l.width - (WB.wBorRight + 5))
  })

  it('leaves 65 pixels for the size gadget and puts 57 of them in it', () => {
    expect(l.name.x).toBe(WB.wBorLeft + 5)
    expect(l.name.w).toBe(l.width - 65 - 18)
    expect(l.size.w).toBe(57)
    expect(l.size.x).toBe(l.width - 57 - (WB.wBorRight + 5))
    // the 65 is the gadget plus the eight between it and the name field
    expect(l.size.x - (l.name.x + l.name.w)).toBe(8)
    expect(l.name.h).toBe(l.size.h)
  })

  it('gives the sample box four pixels of border round the 24 it draws in', () => {
    expect(l.sample.h).toBe(24 + 4)
    expect(l.sampleHeight).toBe(24)
    expect(l.sample.w).toBe(l.width - 18)
    expect(l.sampleLeft).toBe(WB.wBorLeft + 5 + 4)
    expect(l.sampleRight).toBe(l.width - (WB.wBorRight + 5) - 5)
    expect(l.sampleTop).toBe(l.sample.y + 2)
  })

  it('gives the sample its own height back out of the list', () => {
    const tall = fontReqLayout(fontSetup({ sampleHeight: 48 }), WB)
    // 24 more pixels below the list is two fewer rows of nine, and the window
    // grows by what is left over
    expect(tall.entries).toBe(l.entries - 2)
    expect(tall.height).toBe(l.height + 24 - 2 * l.entryHeight)
  })

  it('stacks the list, the name row, the sample and the buttons in that order', () => {
    expect(l.listFrame.y).toBe(13)
    expect(l.listFrame.h).toBe(l.entries * l.entryHeight + 4)
    expect(l.name.y).toBe(l.listFrame.y + l.listFrame.h + 1)
    expect(l.sample.y).toBe(l.name.y + l.name.h + 2)
    expect(l.buttons[0]?.box.y).toBe(l.sample.y + l.sample.h + 2)
    expect(l.height).toBe(l.buttons[0]!.box.y + 14 + 2 + 10)
    expect(l.height).toBe(162)
  })

  it('adds a checkbox row under FREQF_STYLE, which the extension never asks for', () => {
    const styled = fontReqLayout(fontSetup({ flags: FREQF.SCALE | FREQF.STYLE }), WB)
    // `val` grows by checkskip + 4 + spacing, 17, before the entries are
    // counted, so two rows of nine come out of the list and the button row
    // ends up one pixel HIGHER than it was without the checkboxes
    expect(styled.entries).toBe(l.entries - 2)
    expect(styled.buttons[0]!.box.y).toBe(l.buttons[0]!.box.y + 17 - 2 * l.entryHeight)
  })
})

describe('reqtools: the screenmode requester layout', () => {
  const scrSetup = (over: Partial<ScreenReqSetup> = {}): ScreenReqSetup => ({
    title: 'Pick a screen',
    okText: RT_TEXT.ok,
    underscore: '_',
    // what `request.s`:537 asks for, and what the tag list at $5bfa holds
    flags: SCREQF.SIZEGADS | SCREQF.DEPTHGAD,
    height: 0,
    ...over,
  })

  const l = screenReqLayout(scrSetup(), WB)

  it('is 276 wide, the flat number, because the rows ask for less', () => {
    // `$7578 move.l #$114,$11c(a7)`. The SIZEGADS row asks for
    // 72 + 56 + 60 + 8 + 8 + 26 + 8 + 4 + 18 = 260, so the flat number wins
    expect(l.width).toBe(276)
  })

  it('lets the SIZEGADS row widen it once the font is big enough', () => {
    const wide = screenReqLayout(scrSetup(), { ...WB, measure: (s) => s.length * 12 })
    // 108 + 84 + (72 + 12) + 8 + 8 + 26 + 8 + 4 + 18
    expect(wide.width).toBe(348)
  })

  it('never lets the button row widen it, however long the Ok text is', () => {
    // `val` belongs to the screenmode block; the `width2 + (num2-1) * 8 +
    // totaloff` that widens a file or font requester is in the branch this
    // arm skips. CheckGadgetsSize shrinks the buttons instead
    const long = screenReqLayout(scrSetup({ okText: 'x'.repeat(40) }), WB)
    expect(long.width).toBe(276)
    // CheckGadgetsSize rounds the overlap UP in 16.16, so 672 down to 258
    // takes 207 off each of the two rather than 208
    expect(long.buttons[0]!.box.w).toBe(129)
  })

  it('takes 65 per cent of the height and never lists more than ten modes', () => {
    // reqheight = 166, and `below` is 34 for the name box and the buttons,
    // + 31 for the two size rows, + 13 for the colour row
    expect(l.entries).toBe(Math.trunc((166 - 78 - 13 - 10) / 9))
    expect(l.entries).toBe(7)
    const tall = screenReqLayout(scrSetup(), { ...WB, visibleHeight: 512 })
    expect(tall.entries).toBe(RT_SCREENMODEREQ_PREFS.maxEntries)
    const small = screenReqLayout(scrSetup(), { ...WB, visibleHeight: 200 })
    expect(small.entries).toBe(RT_SCREENMODEREQ_PREFS.minEntries)
  })

  it('puts the mode name straight under the list, half a gap up', () => {
    // the shared code adds `spacing / 2` after the scroller and the
    // screenmode arm takes it straight back off
    expect(l.listFrame).toEqual({ x: 9, y: 13, w: 240, h: 67 })
    expect(l.scroller).toEqual({ x: 249, y: 13, w: 18, h: 67 })
    expect(l.modeName).toEqual({ x: 9, y: 80, w: 258, h: 12 })
  })

  it('lines the Width and Height fields up in a column with their labels', () => {
    // val = widthheightlen + 8 + leftoff + 2 = 72 + 8 + 9 + 2
    expect(l.widthGad).toEqual({ x: 91, y: 94, w: 60, h: 14 })
    expect(l.heightGad).toEqual({ x: 91, y: 109, w: 60, h: 14 })
    // 38.1092 pads both labels to ten characters, so the two land together
    expect(l.widthLabel!.x).toBe(11)
    expect(l.heightLabel!.x).toBe(11)
  })

  it('hangs a Default checkbox off each field with its label to the right', () => {
    expect(l.defWidth).toEqual({ x: 159, y: 95, w: 26, h: 11 })
    expect(l.defHeight).toEqual({ x: 159, y: 110, w: 26, h: 11 })
    expect(l.defWidthLabel).toEqual({ text: 'Default', x: 189, y: 96 })
  })

  it('puts the slider between the two colour readouts', () => {
    expect(l.colors).toEqual({ x: 75, y: 125, w: 40, h: 11 })
    // winwidth - 22 - rightoff - LeftEdge - StrWidth("0000 ") - StrWidth("Max:")
    expect(l.depth).toEqual({ x: 123, y: 125, w: 50, h: 11 })
    expect(l.maxColors).toEqual({ x: 225, y: 125, w: 40, h: 11 })
    expect(l.maxColors!.x + l.maxColors!.w).toBeLessThanOrEqual(l.width - 9)
  })

  it('leaves out the gadgets the flags did not ask for', () => {
    const bare = screenReqLayout(scrSetup({ flags: 0 }), WB)
    expect(bare.widthGad).toBeNull()
    expect(bare.depth).toBeNull()
    expect(bare.overscan).toBeNull()
    expect(bare.autoScroll).toBeNull()
    // 44 pixels of gadget gone is five more rows of list, and the ten-row
    // ceiling in the prefs takes two of them straight back
    expect(bare.entries).toBe(RT_SCREENMODEREQ_PREFS.maxEntries)
  })

  it('has two buttons under the last row, Ok at the left and Cancel at the right', () => {
    expect(l.buttons.map((g) => g.text)).toEqual([' Ok ', 'Cancel'])
    expect(l.buttons.map((g) => g.box.x)).toEqual([9, 203])
    expect(l.buttons[0]!.box.y).toBe(138)
    expect(l.height).toBe(164)
  })

  it('measures the overscan row off the widest of its four labels', () => {
    const over = screenReqLayout(scrSetup({ flags: SCREQF.OVERSCANGAD }), WB)
    // `Graphics Size` is the longest at 104, + 72 + 36 + 8 + 18 + 2 = 240,
    // which the flat 276 still beats
    expect(over.width).toBe(276)
    expect(over.overscan).toEqual({ x: 91, y: 121, w: 176, h: 14 })
    // it beats it once the font is big enough: 156 + 108 + 36 + 8 + 18 + 2
    const wide = screenReqLayout(scrSetup({ flags: SCREQF.OVERSCANGAD }), { ...WB, measure: (s) => s.length * 12 })
    expect(wide.width).toBe(328)
  })

  it('counts colours the library way, which is not 1 << depth', () => {
    expect(rtBuildColStr(1, 0)).toBe('2')
    expect(rtBuildColStr(8, 0)).toBe('256')
    // over four digits it divides down and suffixes
    expect(rtBuildColStr(13, 0)).toBe('8192')
    expect(rtBuildColStr(14, 0)).toBe('16K')
    expect(rtBuildColStr(24, 0)).toBe('16M')
    // a HAM mode reads 4096 at depth 7 and 16M at anything else
    expect(rtBuildColStr(7, 0x0800)).toBe('4096')
    expect(rtBuildColStr(8, 0x0800)).toBe('16M')
    // and an EHB mode reads 64 whatever its depth
    expect(rtBuildColStr(3, 0x0080)).toBe('64')
  })
})

describe('reqtools: the palette requester layout', () => {
  const palSetup = (over: Partial<PaletteReqSetup> = {}): PaletteReqSetup => ({
    title: 'Colours',
    // `glob->color = 1` before the tag list is read
    color: 1,
    // the Workbench screen, four colours
    depth: 2,
    bits: [4, 4, 4],
    ...over,
  })

  const l = paletteReqLayout(palSetup(), WB)

  it('is 256 wide, which is the floor and not the arithmetic', () => {
    // width1 is 3 * (StrWidth(Spread) + 16) = 192, so the sum asks for
    // 18 + 25 + 192 + 16 = 251 and the floor takes over
    expect(l.width).toBe(256)
  })

  it('indents the palette and the mode row by 25, the wheel\'s old seat', () => {
    // `wheeloff` is ADDED to the 25 when a colour wheel is built, and 38.1092
    // has no wheel; the 25 stands on its own with nothing in it
    expect(l.palette).toEqual({ x: 34, y: 23, w: 213, h: 20 })
    expect(l.modes.map((g) => g.box.x)).toEqual([34, 108, 183])
    // the buttons below start at the border proper
    expect(l.buttons.map((g) => g.box.x)).toEqual([9, 96, 183])
  })

  it('splits the palette gadget into an indicator and a grid', () => {
    expect(l.indicator).toEqual({ x: 34, y: 23, w: RT_PALETTE_INDICATOR, h: 20 })
    expect(l.grid).toEqual({ x: 72, y: 23, w: 175, h: 20 })
    expect([l.rows, l.cols]).toEqual([1, 4])
  })

  it('grows the palette gadget a row at a time, which is what doubles its height', () => {
    // `if (colcount >= 64) val *= 2; if (colcount >= 128) val *= 2`
    const c64 = paletteReqLayout(palSetup({ depth: 6 }), WB)
    expect([c64.rows, c64.cols]).toEqual([2, 32])
    expect(c64.palette.h).toBe(40)
    const c256 = paletteReqLayout(palSetup({ depth: 8 }), WB)
    expect([c256.rows, c256.cols]).toEqual([4, 64])
    expect(c256.palette.h).toBe(80)
  })

  it('centres Palette Colors: over the gadget, not over the window', () => {
    // leftoff + 25 + (winwidth - (leftoff + rightoff + 25) - StrWidth) / 2
    expect(l.colorsLabel).toEqual({ text: 'Palette Colors:', x: 80, y: 13 })
  })

  it('puts each gun label, its readout and its slider in one row', () => {
    // maxwidth is the widest of Red:/Green:/Blue: plus StrWidth("000 "),
    // so 48 + 32, and the slider starts 8 past it
    expect(l.sliders.map((b) => b.x)).toEqual([99, 99, 99])
    expect(l.sliders.map((b) => b.y)).toEqual([61, 76, 91])
    expect(l.sliders[0]!.w).toBe(148)
    expect(l.sliderLabels.map((t) => t.text)).toEqual(['Red:', 'Green:', 'Blue:'])
    expect(l.levels[0]).toEqual({ x: 67, y: 61, w: 32, h: 14 })
  })

  it('names its six buttons the way 38.1092 spells them', () => {
    expect(l.modes.map((g) => g.text)).toEqual(['Copy', 'Swap', 'Spread'])
    expect(l.modes.map((g) => g.key)).toEqual(['y', 'S', 'e'])
    expect(l.buttons.map((g) => g.text)).toEqual([' Ok ', 'Undo', 'Cancel'])
    expect(l.height).toBe(125)
  })

  it('MakeColVal repeats the gun up the longword rather than shifting it', () => {
    // `$f` at four bits has to reach `$ffffffff`; `$f0000000` would come out
    // nearly black on a machine that reads all 32
    expect(rtMakeColVal(0xf, 4) >>> 0).toBe(0xffff_ffff)
    expect(rtMakeColVal(0, 4) >>> 0).toBe(0)
    expect(rtMakeColVal(0x8, 4) >>> 0).toBe(0x8888_8888)
    expect(rtMakeColVal(0xff, 8) >>> 0).toBe(0xffff_ffff)
    expect(rtMakeColVal(0x12, 8) >>> 0).toBe(0x1212_1212)
    // and the top nibble is always the value that went in, which is what a
    // 12-bit colour register keeps
    expect(rtMakeColVal(0xa, 4) >>> 28).toBe(0xa)
  })
})
