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
    expect(rtFormat(RT_TEXT.sizeFmt, 12)).toBe('  12')
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
