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
  type FileReqSetup,
  type FontReqSetup,
  type ReqMetrics,
  type ReqSetup,
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
