import { describe, expect, it } from 'vitest'
import { mustFinish } from '../testing/run'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/source'
import { Runtime } from './runtime'
import { Screen } from './screen'
import { WB_SLOT } from '../amiga/intuition'

const table = new TokenTable(CORE_TOKENS)

function boot(src: string): Runtime {
  return new Runtime(tokenize(src, table), table, { maxSteps: 3_000_000 })
}

function run(src: string): Runtime {
  const rt = boot(src)
  const r = rt.runHeadless(2_000)
  mustFinish(r)
  return rt
}

/** big-endian word at offset o of buf */
const word = (buf: Uint8Array, o: number): number => (buf[o]! << 8) | buf[o + 1]!

describe('user copper instructions (TCop* +W.s:6815-6935)', () => {
  it('Cop Move/Wait encode real copper words at Cop Logic, reachable by Deek', () => {
    const src = [
      'Copper Off',
      'Cop Move $180,$F00',
      'Cop Wait 7,100',
      'A=Cop Logic',
      'Print Deek(A) : Print Deek(A+2)',
      'Print Deek(A+4) : Print Deek(A+6)',
    ].join('\n')
    let out = ''
    const rt = new Runtime(tokenize(src, table), table, { maxSteps: 300_000, onText: (t) => (out += t) })
    rt.runHeadless(500)
    // MOVE: reg &$1FE then the value; WAIT: (y<<8)|((x>>1)&$FE)|1, mask $FFFE
    expect(out).toBe(' 384\n 3840\n 25603\n 65534\n')
  })

  it('a runaway list faults at the 12KB buffer, like the real machine (CopEr2 +W.s:6876, 12*1024 config)', () => {
    // Multi_Rainbows springs this when its data file is missing: its list
    // walker runs off the end of a zeroed bank writing Cop Move forever
    const src = ['Copper Off', 'Do', ' Cop Move 0,0', 'Loop'].join('\n')
    const rt = new Runtime(tokenize(src, table), table, { maxSteps: 300_000 })
    expect(() => rt.runHeadless(500)).toThrow(/copper list too long/)
  })

  it('Cop Wait past line 255 emits the $FFE1 crossing once (TCopWt 6884)', () => {
    const rt = run(['Copper Off', 'Cop Wait 0,280', 'Cop Wait 0,300'].join('\n'))
    const l = rt.copLogic
    expect(word(l, 0)).toBe(0xffe1)
    expect(word(l, 2)).toBe(0xfffe)
    expect(word(l, 4)).toBe(((280 << 8) & 0xffff) | 1) // y truncates to 8 bits
    expect(word(l, 8)).toBe(((300 << 8) & 0xffff) | 1) // no second crossing
  })

  it('a wait for line 255 is not the crossing marker (WaitD2 vs TCopWt)', () => {
    /*
     * Two routines write the marker and they disagree on the horizontal:
     * WaitD2, behind the band builder, emits $FFDF (+W.s:6722); TCopWt,
     * behind `Cop Wait`, emits $FFE1 (:6843). An ordinary boundary ends
     * `lsl.w #8,d2 / or.w #$03,d2`, so line 255 is $FF03 and line 292 is
     * $2403 after the marker.
     *
     * Reading the marker off VP alone made $FF03 look like one, which threw
     * every band below line 255 into a single band with the bitplane
     * pointers still walking. Dizzy Clone showed sixteen lines of its game
     * screen repeated in the overscan under it.
     */
    const rt = run(['Screen Open 0,320,192,32,Lowres', 'Screen Display 0,,100,,', 'Set Rainbow 0,1,240,"","",""', 'Rainbow 0,0,96,240'].join('\n'))
    rt.buildCopperList()
    const l = rt.copPhysic
    let markers = 0
    let line255 = 0
    let past = 0
    for (let p = 0; p + 4 <= l.length; p += 4) {
      const w1 = word(l, p)
      const w2 = word(l, p + 2)
      if (w1 === 0xffff && w2 === 0xfffe) break
      if ((w1 & 1) === 0) continue
      if (w1 === 0xffdf || w1 === 0xffe1) markers++
      else if (w1 === 0xff03) line255++
      else if ((w1 & 0xff) === 0x03 && markers > 0) past++
    }
    expect(markers).toBe(1) // exactly one crossing
    expect(line255).toBe(1) // and a real boundary on line 255, distinct from it
    expect(past).toBeGreaterThan(30) // the bands below, waiting on truncated VPs
  })

  it('list writes require Copper Off, bounds are checked (CopEr1/CopEr3)', () => {
    // CopErr (+Lib.s:12926) is `add.w #EcEBase+32-2,d0`, so 75 plus the d0
    // the routine failed with: CopEr1 is 76 and CopEr3 is 78
    expect(() => run('Cop Move $180,0')).toThrow(/Copper not disabled/)
    expect(() => run('Cop Swap')).toThrow(/Copper not disabled/)
    expect(() => run('Cop Reset')).toThrow(/Copper not disabled/)
    expect(() => run('Copper Off\nCop Move 512,0')).toThrow(/Illegal copper parameter/)
    expect(() => run('Copper Off\nCop Wait 0,313')).toThrow(/Illegal copper parameter/)
    expect(() => run('Copper Off\nFor I=1 To 4000 : Cop Move 0,0 : Next I')).toThrow(/list too long/)
  })

  it('Cop Movel writes the high word at reg, the low at reg+2 (TCopMl)', () => {
    const rt = run('Copper Off\nCop Movel $E0,$12345678')
    const l = rt.copLogic
    expect(word(l, 0)).toBe(0x00e0)
    expect(word(l, 2)).toBe(0x1234)
    expect(word(l, 4)).toBe(0x00e2)
    expect(word(l, 6)).toBe(0x5678)
  })

  it('Cop Swap terminates, swaps the lists and resets the write pointer (TCopSw)', () => {
    const rt = run(['Copper Off', 'Cop Move $180,$0F0', 'A=Cop Logic', 'Cop Swap', 'B=Cop Logic', 'Print A<>B'].join('\n'))
    expect(rt.copPos).toBe(0)
    const phys = rt.copPhysic
    expect(word(phys, 0)).toBe(0x0180)
    expect(word(phys, 4)).toBe(0xffff) // the terminator follows
    expect(word(phys, 6)).toBe(0xfffe)
  })
})

describe('the system copper list (EcCopper/HsCop +W.s:5701/6786)', () => {
  it('is real readable memory: header, palette block, bitplane pointers, terminator', () => {
    const rt = run('Flash Off : Colour 1,$123\nWait Vbl : Wait Vbl')
    const l = rt.copLogic // the last-built list (swap leaves it readable)
    // HsCop header: the slight wait then sprite pointers $120..$13E
    expect(word(l, 0)).toBe(0x1003)
    expect(word(l, 2)).toBe(0xfffe)
    expect(word(l, 4)).toBe(0x0120)
    // walk: find a COLOR01 move with our value and a BPL1PTH pointing at
    // the screen's chip-RAM planes, then the terminator inside the buffer
    let sawColour = false
    let bplAddr = -1
    let end = -1
    for (let p = 0; p + 4 <= l.length; p += 4) {
      const w1 = word(l, p)
      const w2 = word(l, p + 2)
      if (w1 === 0xffff && w2 === 0xfffe) {
        end = p
        break
      }
      if (w1 === 0x182 && w2 === 0x123) sawColour = true
      if (w1 === 0x0e0) bplAddr = w2 << 16
      if (w1 === 0x0e2 && bplAddr >= 0) bplAddr |= w2
    }
    expect(sawColour).toBe(true)
    expect(end).toBeGreaterThan(0)
    const base = rt.screenChipBase(0)
    expect(bplAddr).toBeGreaterThanOrEqual(base)
    expect(bplAddr).toBeLessThan(base + Runtime.SCREEN_CHIP_SLOT)
  })

  it('Copper Off blanks the display and parks the old list for Cop Logic readers', () => {
    const rt = run(['Ink 2 : Bar 0,0 To 319,199', 'Wait Vbl', 'Copper Off'].join('\n'))
    const { data } = rt.composite()
    let lit = 0
    for (let i = 0; i < data.length; i += 4) if (data[i]! | data[i + 1]! | data[i + 2]!) lit++
    expect(lit).toBe(0) // empty physical list: nothing but black
    // the previous system list is now the logical one
    expect(word(rt.copLogic, 0)).toBe(0x1003)
    expect(word(rt.copPhysic, 0)).toBe(0xffff) // the empty terminated list
  })
})

describe('interpreting a user list (Copper Off display)', () => {
  const pix12 = (rt: Runtime, x: number, y: number): number => {
    const { data } = rt.composite()
    const o = ((y + 48) * 640 + x) * 4 // rows relative to hardware line 50; the window starts at line 26
    return ((Math.round(data[o]! / 17) & 15) << 8) | ((Math.round(data[o + 1]! / 17) & 15) << 4) | (Math.round(data[o + 2]! / 17) & 15)
  }

  it('draws user colour bars through WAIT + COLOR00 moves', () => {
    const rt = run(
      ['Copper Off', 'Cop Wait 1,100', 'Cop Move $180,$F00', 'Cop Wait 1,120', 'Cop Move $180,$00F', 'Cop Swap'].join('\n'),
    )
    expect(pix12(rt, 320, (90 - 50) * 2)).toBe(0x000) // before the first wait
    expect(pix12(rt, 320, (105 - 50) * 2)).toBe(0xf00)
    expect(pix12(rt, 320, (150 - 50) * 2)).toBe(0x00f) // holds to the end
  })

  it('replaying the system list verbatim reproduces the display pixel-perfectly', () => {
    // the Multi_Rainbows.AMOS pattern: copy the system list into a bank,
    // Copper Off, write it back through Cop Move 0,0 + Loke, Cop Swap
    const src = [
      // Hide On because Copper Off really does take the pointer away
      // (TCopOn forces T_MouShow to -1, +W.s:6794) — with it showing, the
      // two displays are legitimately different and the comparison below
      // would be measuring that instead of the list replay
      'Flash Off : Curs Off : Hide On',
      'Ink 2 : Bar 50,20 To 270,180 : Ink 4 : Bar 100,60 To 200,120',
      'Set Rainbow 0,1,64,"(1,1,15)","",""',
      'Rainbow 0,0,70,40',
      'Colour 1,$333',
      'Wait Vbl : Wait Vbl',
      'Reserve As Work 10,12*1024',
      'L=0',
      'Repeat',
      '  C=Leek(Cop Logic+L) : Loke Start(10)+L,C : L=L+4',
      'Until C=%11111111111111111111111111111110',
      'Wait Key',
      'Copper Off : Wait Vbl',
      'ACOP=Cop Logic : ACH=Start(10)',
      'Do',
      '  C=Leek(ACH)',
      '  Exit If C=%11111111111111111111111111111110',
      '  Cop Move 0,0',
      '  Loke ACOP,C',
      '  ACOP=ACOP+4 : ACH=ACH+4',
      'Loop',
      'Cop Swap : Wait Vbl',
      'Wait Key',
      'Copper On',
    ].join('\n')
    const rt = boot(src)
    const untilKeyWait = (): void => {
      for (let i = 0; i < 800 && (rt.interp.blocked as { type?: string } | null)?.type !== 'waitKey'; i++) rt.frame()
    }
    untilKeyWait()
    expect(rt.interp.blocked).toEqual({ type: 'waitKey' })
    const before = new Uint8ClampedArray(rt.composite().data) // system walk
    rt.pressKey(' ')
    rt.frame()
    untilKeyWait()
    expect(rt.interp.blocked).toEqual({ type: 'waitKey' })
    expect(rt.copperOn).toBe(false)
    const after = rt.composite().data // interpreted user list
    expect(Buffer.from(after).equals(Buffer.from(before))).toBe(true)
    // Copper On brings the system display straight back
    rt.pressKey(' ')
    for (let i = 0; i < 50 && !rt.interp.done; i++) rt.frame()
    expect(rt.copperOn).toBe(true)
    const restored = rt.composite().data
    expect(Buffer.from(restored).equals(Buffer.from(before))).toBe(true)
  })
})

describe('copper registers persist across frames, as the hardware\'s do', () => {
  const pix12 = (rt: Runtime, x: number, y: number): number => {
    const { data } = rt.composite()
    const o = ((y + 48) * 640 + x) * 4
    return ((Math.round(data[o]! / 17) & 15) << 8) | ((Math.round(data[o + 1]! / 17) & 15) << 4) | (Math.round(data[o + 2]! / 17) & 15)
  }

  it('a colour set by one frame is still in force on the next', () => {
    // A copper MOVE sticks until something writes the register again. Rebuilding
    // the register file every frame instead made the bar vanish after one frame.
    const rt = run(['Copper Off', 'Cop Wait 1,100', 'Cop Move $180,$F00', 'Cop Swap'].join('\n'))
    const first = pix12(rt, 320, (105 - 50) * 2)
    expect(first).toBe(0xf00)
    // compose several more frames without the program running again
    for (let i = 0; i < 5; i++) rt.composite()
    expect(pix12(rt, 320, (105 - 50) * 2)).toBe(0xf00)
  })

  it('Copper Off itself blanks the display before any list runs', () => {
    // the OFF path swaps in a list that is only an end marker, so the reset
    // is to black — persistence starts from there, not from what was on screen
    const rt = run(['Ink 5 : Bar 0,0 To 319,199', 'Copper Off'].join('\n'))
    const { data } = rt.composite()
    let lit = 0
    for (let i = 0; i < data.length; i += 4) if (data[i]! || data[i + 1]! || data[i + 2]!) lit++
    expect(lit).toBe(0)
  })

})


describe('a window off the top or bottom of the raster is not shown (MkA8 +W.s:5926)', () => {
  /**
   * MkA8 drops a window whose stored start boundary (EcWY-1) is above
   * EcYStrt-1 (+Equ.s:547, EcYBase+26) or at/below T_EcYMax-2 (+W.s:2476,
   * 311+EcYBase on PAL). No band is written and the screen does not appear
   * anywhere, not even the part of it that would have been on the raster.
   *
   * The AMOS Pro Object Editor uses this as a hide idiom: it opens an 8-row
   * status strip and parks it with `Screen Display 4,,20,,` before its main
   * loop, then moves it to 45 or 45+SYWORK each frame.
   */
  const strip = (y: number): Runtime =>
    run(
      [
        'Flash Off : Curs Off : Hide On',
        'Screen Open 1,320,8,2,Lowres',
        'Palette $000,$F00',
        'Cls 1',
        `Screen Display 1,,${y},,`,
        'Wait Vbl',
      ].join('\n'),
    )

  /** lit canvas pixels over the two rows hardware line `line` maps to */
  const litOn = (rt: Runtime, line: number): number => {
    const { data } = rt.composite()
    let lit = 0
    for (let r = (line - 26) * 2; r < (line - 26) * 2 + 2; r++) {
      for (let x = 0; x < 640; x++) {
        const o = (r * 640 + x) * 4
        if (data[o]! || data[o + 1]! || data[o + 2]!) lit++
      }
    }
    return lit
  }
  // a 320-wide lowres screen fills the canvas, and each hardware line is two
  // canvas rows
  const FULL = 640 * 2

  it('a strip parked at line 20 shows nothing, where line 26 shows it', () => {
    // the whole point: at 20 the band is dropped, so the two of its eight
    // rows that WOULD land inside the composite window (26..27) go with it
    expect(litOn(strip(20), 26)).toBe(0)
    expect(litOn(strip(20), 27)).toBe(0)
    expect(litOn(strip(26), 26)).toBe(FULL)
  })

  it('the top edge is exact: 26 displays, 25 does not', () => {
    // bcs on EcYStrt-1 is unsigned less-than, so a boundary OF 25 survives —
    // that is a screen at line 26, and one line higher vanishes entirely
    expect(litOn(strip(26), 27)).toBe(FULL)
    expect(litOn(strip(25), 26)).toBe(0)
    expect(litOn(strip(25), 27)).toBe(0)
  })

  /**
   * Every WAIT line in the list just built, in order.
   *
   * copPhysic, not copLogic: MCopSw makes the freshly built buffer the
   * physical one, so copLogic is the frame before.
   *
   * wait() truncates the line to eight bits and emits the $FFDF crossing
   * once before the first line past 255 (TCopWt +W.s:6855), so reading a
   * line back means putting the high bit on again.
   */
  const waits = (rt: Runtime): number[] => {
    const l = rt.copPhysic
    const out: number[] = []
    let hi = 0
    for (let p = 0; p + 4 <= l.length; p += 4) {
      const w1 = word(l, p)
      const w2 = word(l, p + 2)
      if (w1 === 0xffff && w2 === 0xfffe) break
      if (w2 !== 0xfffe) continue
      if (w1 === 0xffdf) hi = 256
      else if ((w1 & 0xff) === 0x03) out.push(hi + (w1 >> 8))
    }
    return out
  }

  it('the bottom edge is exact: 309 displays, 310 does not', () => {
    // bcc on T_EcYMax-2 = 309: a start boundary of 308 survives, 309 does not.
    // Read from the list rather than the pixels, because both of these run
    // off the bottom and the end-band clamp (MkA11) puts a DMA-off at 310
    // either way — that would hide the difference the test is looking for
    expect(waits(strip(309))).toContain(308)
    expect(litOn(strip(309), 309)).toBe(FULL)
    expect(waits(strip(310))).not.toContain(309)
  })

  it('the end band is still written when the start band was dropped (MkA9 +W.s:5938)', () => {
    // the boundary list is built either way and MkA9 walks it independently
    // of MkA8, so a window above the raster leaves an end marker and no
    // start. Its own top test (MkA9a) only spares a window that ends up
    // there too — this one ends at line 28, so the marker stands.
    const w = waits(strip(20))
    expect(w).not.toContain(19) // the start band's setup line, EcWY-1
    expect(w).toContain(28) // EcWY + height, the end boundary
  })
})

describe('BPLCON0 past HIRES, and BPLCON3', () => {
  /**
   * A list over a 4-plane screen whose row 0 is drawn in pen 3, so the
   * colour that comes back says how many planes the list asked to fetch.
   * Only $100 changes between the tests below.
   */
  const src = (bplcon0: string): string =>
    [
      'Screen Open 0,320,200,16,Lowres',
      'Curs Off : Flash Off : Cls 0',
      'Colour 1,$00F : Colour 2,$0FF : Colour 3,$0F0',
      'Ink 3 : Draw 0,0 To 319,0',
      'A=Logbase(0)',
      'Wait Vbl',
      'Copper Off',
      'Cop Move $180,$000 : Cop Move $182,$00F',
      'Cop Move $184,$0FF : Cop Move $186,$0F0',
      'Cop Move $8E,$2C81 : Cop Move $90,$2CC1',
      'Cop Move $92,$38 : Cop Move $94,$D0',
      'Cop Move $108,0 : Cop Move $10A,0',
      `Cop Move $100,${bplcon0}`,
      'Cop Move $102,0 : Cop Move $104,$24',
      'Cop Wait 0,50',
      'Cop Move $E0,A/65536 : Cop Move $E2,A and $FFFF',
      'Cop Move $96,$8300',
      'Cop Swap',
    ].join('\n')

  const pix = (rt: Runtime, x: number, y: number): number => {
    const { data } = rt.composite()
    const o = ((y + 48) * 640 + x) * 4
    return ((Math.round(data[o]! / 17) & 15) << 8) | ((Math.round(data[o + 1]! / 17) & 15) << 4) | (Math.round(data[o + 2]! / 17) & 15)
  }

  it('BPU bounds the colour index, so fetching fewer planes drops the high bits', () => {
    // pen 3 is %11. Three planes fetch it whole and give colour 3; two give
    // colour 3 as well; one fetches only bit 0 and lands on colour 1. This is
    // what BPU does on the hardware and what Personnal's Create Standard and
    // Create Aga choose when they build a list.
    expect(pix(run(src('$3200')), 0, 0)).toBe(0x0f0) // 3 planes -> pen 3
    expect(pix(run(src('$2200')), 0, 0)).toBe(0x0f0) // 2 planes -> pen 3
    expect(pix(run(src('$1200')), 0, 0)).toBe(0x00f) // 1 plane  -> pen 1
  })

  it('BPU 0 fetches no planes at all, which is not the same as one', () => {
    // %000 in bits 12-14 turns the playfield off; the index is 0, not 1
    expect(pix(run(src('$0200')), 0, 0)).toBe(0x000)
  })

  it('records HAM, dual playfield, interlace and BPLCON3 from the list', () => {
    // Decoded and carried in the register file. Personnal patches exactly
    // these bits — Set Lace is Bset/Bclr #2 on this word, Ham Mode bit 11,
    // Set Dual Mode bit 10 — so the bits have to survive the walk even where
    // the renderer does not yet act on all of them.
    const rt = run(src('$3E04').replace('Cop Move $102,0', 'Cop Move $106,$2000 : Cop Move $102,0'))
    rt.composite() // the register file is what the walk leaves behind
    const R = (rt as unknown as { copRegs: Record<string, unknown> }).copRegs
    expect(R.bpu).toBe(3)
    expect(R.ham).toBe(true) // bit 11
    expect(R.dblpf).toBe(true) // bit 10
    expect(R.lace).toBe(true) // bit 2
    expect(R.bplcon3).toBe(0x2000) // AGA colour bank 1
  })

  it('decodes BPL7PT and BPL8PT, which only AGA fetches', () => {
    // the pointers were always 8 wide; the MOVE range test stopped at $0f6
    const rt = run(src('$1200').replace('Cop Move $96,$8300', 'Cop Move $F8,$1234 : Cop Move $FE,$5678 : Cop Move $96,$8300'))
    rt.composite()
    const R = (rt as unknown as { copRegs: { bplH: Int32Array; bplL: Int32Array } }).copRegs
    expect(R.bplH[6]).toBe(0x1234) // $F8 = BPL7PTH
    expect(R.bplL[7]).toBe(0x5678) // $FE = BPL8PTL
  })
})

describe('the fetch registers really drive the Copper Off display', () => {
  /**
   * A hand-written list of the kind a demo writes: it sets up the whole
   * bitplane fetch itself rather than copying AMOS's. Every register under
   * test is a parameter here, so each test below changes exactly one word
   * and the difference in the pixels is the register's doing.
   */
  const listSrc = (over: Record<string, string> = {}, fill = 'Draw 0,Y To 319,Y'): string => {
    const R = {
      diwstrt: '$2C81',
      diwstop: '$2CC1',
      ddfstrt: '$38',
      ddfstop: '$D0',
      mod1: '0',
      bplcon0: '$1200', // 1 plane, colour burst
      bplcon1: '0',
      bplcon2: '$24',
      ...over,
    }
    return [
      'Screen Open 0,320,200,2,Lowres',
      'Curs Off : Flash Off : Cls 0',
      'Colour 1,$F00',
      // every second row filled, so a modulo that skips rows shows up
      `For Y=0 To 199 Step 2 : Ink 1 : ${fill} : Next Y`,
      'A=Logbase(0)',
      'Wait Vbl',
      'Copper Off',
      'Cop Move $180,$000 : Cop Move $182,$F00',
      `Cop Move $8E,${R.diwstrt} : Cop Move $90,${R.diwstop}`,
      `Cop Move $92,${R.ddfstrt} : Cop Move $94,${R.ddfstop}`,
      `Cop Move $108,${R.mod1} : Cop Move $10A,${R.mod1}`,
      `Cop Move $100,${R.bplcon0}`,
      `Cop Move $102,${R.bplcon1} : Cop Move $104,${R.bplcon2}`,
      'Cop Wait 0,50',
      'Cop Move $E0,A/65536 : Cop Move $E2,A and $FFFF',
      'Cop Move $96,$8300',
      'Cop Swap',
    ].join('\n')
  }

  /** 12-bit colour of the composited pixel at screen (x, row-below-line-50) */
  const pix = (rt: Runtime, x: number, y: number): number => {
    const { data } = rt.composite()
    const o = ((y + 48) * 640 + x) * 4
    return ((Math.round(data[o]! / 17) & 15) << 8) | ((Math.round(data[o + 1]! / 17) & 15) << 4) | (Math.round(data[o + 2]! / 17) & 15)
  }

  it('the baseline list draws the screen where AMOS would put it', () => {
    const rt = run(listSrc())
    expect(pix(rt, 0, 0)).toBe(0xf00) // first fetched pixel, hard left
    expect(pix(rt, 638, 0)).toBe(0xf00) // last one inside the window
    expect(pix(rt, 0, 2)).toBe(0x000) // row 1 of the screen is empty
  })

  it('BPLCON1 PF1H delays the playfield by whole lores pixels', () => {
    // the register that had no test and so was reverted once: 4 lores
    // pixels of delay is 8 output pixels of shift, and the pixels pushed
    // past DIWSTOP are lost rather than wrapping
    const rt = run(listSrc({ bplcon1: '4' }))
    expect(pix(rt, 0, 0)).toBe(0x000)
    expect(pix(rt, 7, 0)).toBe(0x000)
    expect(pix(rt, 8, 0)).toBe(0xf00)
    expect(pix(rt, 638, 0)).toBe(0xf00)
  })

  it('BPL1MOD joins the fetched words, so a wrong one shears the picture', () => {
    // +40 bytes is one extra row per line: the display then shows only the
    // even rows of the screen, which are the filled ones
    const rt = run(listSrc({ mod1: '40' }))
    expect(pix(rt, 0, 0)).toBe(0xf00)
    expect(pix(rt, 0, 2)).toBe(0xf00) // row 2, not the blank row 1
    expect(pix(rt, 0, 4)).toBe(0xf00)
  })

  it('a half-row modulo skews each line sideways', () => {
    // -20 bytes leaves a net advance of half a row per line, so every other
    // line starts 160 pixels into the row it is already showing — the
    // classic copper shear. Only the right half of the even rows is drawn,
    // so the skew is visible as content moving to the left.
    const rt = run(listSrc({ mod1: '-20' }, 'Draw 160,Y To 319,Y'))
    // line 50 fetches row 0 from its start: the filled half stays on the right
    expect(pix(rt, 0, 0)).toBe(0x000)
    expect(pix(rt, 400, 0)).toBe(0xf00)
    // line 51 starts halfway into row 0, so that same half is now hard left
    expect(pix(rt, 0, 2)).toBe(0xf00)
    expect(pix(rt, 400, 2)).toBe(0x000)
    // line 52 has advanced a whole row: row 1 is blank
    expect(pix(rt, 0, 4)).toBe(0x000)
    expect(pix(rt, 400, 4)).toBe(0x000)
    // line 54 reaches row 2, and the pattern repeats
    expect(pix(rt, 400, 8)).toBe(0xf00)
  })

  it('DDFSTOP sets how many words are fetched, hence the width', () => {
    // (0xB0-0x38)/8+1 = 16 words = 256 pixels instead of 320
    const rt = run(listSrc({ ddfstop: '$B0' }))
    expect(pix(rt, 510, 0)).toBe(0xf00)
    expect(pix(rt, 512, 0)).toBe(0x000)
  })

  it('DDFSTRT sets where the data lands as well as the width', () => {
    // 8 colour clocks later: 16 output pixels right, 2 words narrower
    const rt = run(listSrc({ ddfstrt: '$40' }))
    expect(pix(rt, 30, 0)).toBe(0x000)
    expect(pix(rt, 32, 0)).toBe(0xf00)
  })

  it('DIWSTOP clips the right-hand edge', () => {
    const rt = run(listSrc({ diwstop: '$2C21' })) // stop at colour clock 289
    expect(pix(rt, 318, 0)).toBe(0xf00)
    expect(pix(rt, 320, 0)).toBe(0x000)
  })
})

describe('sprites under a user copper list', () => {
  const spriteSrc = (bplcon2: string): string =>
    [
      'Screen Open 0,320,200,4,Lowres',
      'Curs Off : Flash Off : Cls 0',
      'Colour 1,$F00 : Colour 17,$0F0',
      'Ink 1 : Bar 0,0 To 319,199',
      'A=Logbase(0)',
      'Reserve As Work 5,128',
      'S=Start(5)',
      // SPRxPOS: VSTART 60, HSTART bits 8-1 = 129>>1
      'Doke S,60*256+64',
      // SPRxCTL: VSTOP 70, bit 0 = HSTART bit 0
      'Doke S+2,70*256+1',
      'For I=0 To 9',
      '  Doke S+4+I*4,$FFFF : Doke S+6+I*4,0',
      'Next I',
      'Doke S+44,0 : Doke S+46,0',
      'Wait Vbl',
      'Copper Off',
      'Cop Move $180,$000 : Cop Move $182,$F00 : Cop Move $1A2,$0F0',
      'Cop Move $8E,$2C81 : Cop Move $90,$2CC1',
      'Cop Move $92,$38 : Cop Move $94,$D0',
      'Cop Move $108,0 : Cop Move $10A,0',
      'Cop Move $100,$1200 : Cop Move $102,0',
      `Cop Move $104,${bplcon2}`,
      'Cop Move $120,S/65536 : Cop Move $122,S and $FFFF',
      'Cop Wait 0,50',
      'Cop Move $E0,A/65536 : Cop Move $E2,A and $FFFF',
      'Cop Move $96,$8300',
      'Cop Swap',
    ].join('\n')

  const at = (rt: Runtime, hx: number, hy: number): number => {
    const { data } = rt.composite()
    const o = (((hy - 26) * 2) * 640 + (hx - 128) * 2) * 4
    return ((Math.round(data[o]! / 17) & 15) << 8) | ((Math.round(data[o + 1]! / 17) & 15) << 4) | (Math.round(data[o + 2]! / 17) & 15)
  }

  it('SPRxPT is decoded as real sprite structures (POS/CTL + two bitplanes)', () => {
    // the list owns the sprite pointers once Copper Off clears T_HsChange
    // (+W.s:6822), so the display is whatever data they point at
    const rt = run(spriteSrc('$24'))
    expect(at(rt, 129, 60)).toBe(0x0f0) // colour 17: pair 0, pixel value 1
    expect(at(rt, 144, 69)).toBe(0x0f0) // 16 wide, VSTOP-VSTART tall
    expect(at(rt, 129, 70)).toBe(0xf00) // VSTOP is exclusive
    expect(at(rt, 145, 60)).toBe(0xf00) // and 16 pixels is the whole width
  })

  it('BPLCON2 PF1P decides whether the sprite is in front of the playfield', () => {
    // pair 0 with PF1P 0: the playfield wins and covers the sprite
    const rt = run(spriteSrc('$20'))
    expect(at(rt, 129, 60)).toBe(0xf00)
  })
})

describe('the hardware sprite multiplexer (HsAff +W.s:11713)', () => {
  const rt = (): Runtime => new Runtime(tokenize('Screen Open 0,320,200,16,Lowres', table), table, { maxSteps: 100_000 })

  const load = (r: Runtime): void => {
    // four 16x16 images so the allocator has real heights to budget
    r.spriteBank = {
      image: () => ({ width: 16, height: 16, depth: 2, hotX: 0, hotY: 0, pixels: new Uint8Array(256), opaque: false }),
    } as unknown as Runtime['spriteBank']
  }

  it('sprites 0-7 keep their own channel, and the mouse holds channel 0', () => {
    const r = rt()
    r.runHeadless(50)
    load(r)
    const ch = r.spriteChannels([
      { n: 0, x: 100, y: 50, image: 1 },
      { n: 3, x: 100, y: 50, image: 1 },
    ])
    expect(ch.get(0)).toBe(0)
    expect(ch.get(3)).toBe(3)
  })

  it('computed sprites are packed into a free channel from their own top line', () => {
    const r = rt()
    r.runHeadless(50)
    load(r)
    r.mouseShow = -1 // hidden, so channel 0 is available
    // three sprites stacked down the display: one channel can hold them all
    const ch = r.spriteChannels([
      { n: 8, x: 100, y: 50, image: 1 },
      { n: 9, x: 100, y: 80, image: 1 },
      { n: 10, x: 100, y: 110, image: 1 },
    ])
    expect(ch.get(8)).toBe(0)
    expect([...new Set(ch.values())].length).toBeGreaterThan(0)
    // ...but they must not all be crammed onto one channel when they overlap
    const overlap = r.spriteChannels([
      { n: 8, x: 100, y: 50, image: 1 },
      { n: 9, x: 100, y: 52, image: 1 },
      { n: 10, x: 100, y: 54, image: 1 },
    ])
    expect(new Set(overlap.values()).size).toBe(3)
  })

  it('a visible mouse pointer takes channel 0 away from them', () => {
    const r = rt()
    r.runHeadless(50)
    load(r)
    r.mouseShow = 0
    const ch = r.spriteChannels([{ n: 8, x: 100, y: 50, image: 1 }])
    expect(ch.get(8)).not.toBe(0)
  })

  it('Set Sprite Buffer bounds how many share a channel (HsPMax = lines-2)', () => {
    const r = rt()
    r.runHeadless(50)
    load(r)
    r.mouseShow = -1
    r.spriteBufferLines = 20 // Set Sprite Buffer 18: 18 words per column
    // each 16-high sprite books 17 words, so a second one cannot follow it
    // down the same channel even though it starts well below
    const ch = r.spriteChannels([
      { n: 8, x: 100, y: 50, image: 1 },
      { n: 9, x: 100, y: 150, image: 1 },
    ])
    expect(ch.get(8)).toBe(0)
    expect(ch.get(9)).toBe(1)
  })
})

describe('HAM from the copper list, not just from the screen', () => {
  /**
   * A 6-plane screen whose row 0 walks the four HAM control codes, displayed
   * by a list that asks for HAM through BPLCON0 bit 11. The screen itself was
   * opened as an ordinary one, so anything that appears is the list's doing.
   */
  const src = (bplcon0: string): string =>
    [
      'Screen Open 0,320,200,64,Lowres',
      'Curs Off : Flash Off : Cls 0',
      'Colour 1,$F00',
      // set base to colour 1 ($F00), then modify blue, then red, then green
      'Ink 1 : Plot 0,0',
      'Ink 16+15 : Plot 1,0',
      'Ink 32+0 : Plot 2,0',
      'Ink 48+15 : Plot 3,0',
      'A=Logbase(0)',
      'Wait Vbl',
      'Copper Off',
      'Cop Move $180,$000 : Cop Move $182,$F00',
      'Cop Move $8E,$2C81 : Cop Move $90,$2CC1',
      'Cop Move $92,$38 : Cop Move $94,$D0',
      'Cop Move $108,0 : Cop Move $10A,0',
      `Cop Move $100,${bplcon0}`,
      'Cop Move $102,0 : Cop Move $104,$24',
      'Cop Wait 0,50',
      'Cop Move $E0,A/65536 : Cop Move $E2,A and $FFFF',
      'Cop Move $96,$8300',
      'Cop Swap',
    ].join('\n')

  const pix = (rt: Runtime, x: number, y: number): number => {
    const { data } = rt.composite()
    const o = ((y + 48) * 640 + x) * 4
    return ((Math.round(data[o]! / 17) & 15) << 8) | ((Math.round(data[o + 1]! / 17) & 15) << 4) | (Math.round(data[o + 2]! / 17) & 15)
  }

  it('bit 11 makes the list decode HAM over a plain screen', () => {
    // $6A00 = 6 planes, HAM, colour burst
    const rt = run(src('$6A00'))
    expect(pix(rt, 0, 0)).toBe(0xf00) // code 0: set from the palette
    expect(pix(rt, 2, 0)).toBe(0xf0f) // code 1: hold, modify blue
    expect(pix(rt, 4, 0)).toBe(0x00f) // code 2: modify red
    expect(pix(rt, 6, 0)).toBe(0x0ff) // code 3: modify green to 15
  })

  it('without bit 11 the same screen is plain indexed colour', () => {
    // $6200 = 6 planes, no HAM. Pen 1 is red, the rest are unset and black.
    const rt = run(src('$6200'))
    expect(pix(rt, 0, 0)).toBe(0xf00)
    expect(pix(rt, 2, 0)).toBe(0x000)
  })
})

describe('a screen whose window runs off the bottom (MkA9a/MkA11 +W.s:5938)', () => {
  /**
   * DMACON persists across the frame boundary, so the border above the
   * topmost screen shows the fond only because the PREVIOUS frame's last band
   * turned the bitplane DMA off. AMOS therefore records the end of a window
   * that falls below T_EcYMax-1 at EcYMax-1 rather than dropping it.
   *
   * Coingrabber is the program that found this: a 265-line screen at line 50
   * ends at 315, so no end band was emitted, and the frame after left the DMA
   * running through the top of the display — fetching from wherever the
   * pointers had stopped, one plane out of step, which reads as the top of the
   * screen duplicated in the wrong colours.
   */
  const tall = [
    'Flash Off : Curs Off : Hide On',
    'Screen Open 0,320,265,16,Lowres',
    'Palette $000,$0F0,$00F',
    // pen 2 is plane TWO only, so a stale pointer that has walked one plane
    // on reads it as plane one and shows pen 1 — the "same shapes, wrong
    // colours" the game showed. Filling plane one instead would leave the
    // stale read on zeros and prove nothing.
    'Cls 2',
  ].join('\n')

  it('still ends the band, at EcYMax-1', () => {
    const rt = run(tall)
    rt.buildCopperList()
    const l = rt.copPhysic
    let lastWait = -1
    let dmaOffAt = -1
    let cross = 0
    for (let p = 0; p + 4 <= l.length; p += 4) {
      const w1 = word(l, p)
      const w2 = word(l, p + 2)
      if (w1 === 0xffff && w2 === 0xfffe) break
      // the line-255 crossing marker (TCopWt +W.s:6855); waits after it carry
      // only the low byte of the line
      if (w1 === 0xffdf) cross = 256
      else if (w1 & 1) lastWait = ((w1 >> 8) & 0xff) + cross
      else if ((w1 & 0x1fe) === 0x096 && w2 === 0x0100) dmaOffAt = lastWait
    }
    // 310, not 315 (off the end of the list) and not 49 (the screen's own
    // EcCopHo stop, which is followed by $8300 one line later)
    expect(dmaOffAt).toBe(310)
  })

  it('leaves the border above the screen showing the fond on the next frame', () => {
    const rt = run(tall)
    // two frames: the first is what leaves DMACON behind for the second
    rt.frame()
    rt.composite()
    rt.frame()
    const { data } = rt.composite()
    // hardware line 30, well above the screen at 50, must be the fond
    const o = ((30 - Runtime.COMPOSITE_TOP) * 2 * 640 + 320) * 4
    expect([data[o], data[o + 1], data[o + 2]]).toEqual([0, 0, 0])
  })
})

describe('a system screen — above the user range, in the same copper list', () => {
  /**
   * AMOS opens screens the BASIC programmer cannot name: EcFonc 8, EcEdit 9,
   * EcFsel 10 and EcReq 11 (+Equ.s:764). Fsel$ and the text reader both open
   * on EcFsel, so this is not hypothetical.
   *
   * DEFECT: the slot count was 8 in four places while EC_FSEL was 10, so the
   * file selector's screen got a perfectly correct EcCopHo band — palette,
   * DIWSTRT, BPLxPT at $40a00000 — and then the compositor could not resolve
   * those pointers to any bitmap and fetched nothing. It drew into its own
   * pixels, so every dialog test that reads them passed, and the composited
   * display showed empty border where the requester should be.
   *
   * A system screen is an ordinary Screen in every respect that matters to the
   * hardware; the only thing that makes it a system screen is that
   * `Screen Open` rejects the index (openScreen, "illegal screen number").
   * This is also where a non-AMOS screen goes — an Intuition screen is a
   * ViewPort in this same list, at a slot of its own.
   */
  const boot16 = (): Runtime => run('Flash Off : Curs Off : Hide On\nScreen Open 0,320,50,2,Lowres\nPalette $000,$00F')

  it('gets a band, and its planes resolve back through the list', () => {
    const rt = boot16()
    const s = new Screen(Runtime.EC_FSEL, 320, 40, 4, 0x8000)
    s.palette[1] = 0x0f00
    s.displayX = 128
    s.displayY = 150
    rt.screens.set(Runtime.EC_FSEL, s)
    rt.order.push(Runtime.EC_FSEL)
    s.pixelsW().fill(1)
    const { data } = rt.composite()
    // hardware line 160 is inside the system screen's window, and pen 1 there
    // is red — before the fix this was the black border
    const o = ((160 - Runtime.COMPOSITE_TOP) * 2 * 640 + 300) * 4
    expect([data[o], data[o + 1], data[o + 2]]).toEqual([255, 0, 0])
  })

  it('its bitplanes are reachable by address, like any screen', () => {
    const rt = boot16()
    const s = new Screen(Runtime.EC_FSEL, 320, 40, 4, 0x8000)
    rt.screens.set(Runtime.EC_FSEL, s)
    s.pixelsW().fill(1)
    const base = rt.screenChipBase(Runtime.EC_FSEL)
    const m = rt.resolveAddr(base)
    expect(m).not.toBeNull()
    // plane 0 of a solid pen-1 fill is all ones
    expect(m!.data[m!.off]).toBe(0xff)
  })

  it('Screen Open still cannot name one', () => {
    const rt = boot16()
    expect(() => rt.openScreen(Runtime.EC_FSEL, 320, 40, 4, 0x8000)).toThrow(/illegal screen number/)
  })
})

describe('OpenWorkBench puts a real screen in the copper list', () => {
  /**
   * The end of the chain the whole change exists for: intuition.library opens
   * a screen, the machine gives it a slot no keyword can name, and the copper
   * list carries it like any other. Nothing in the display path knows it is
   * not an AMOS screen.
   */
  const boot = (): Runtime => run('Flash Off : Curs Off : Hide On\nScreen Open 0,320,50,2,Lowres\nPalette $000,$00F')

  it('opens 640x256 hires behind everything, and shows the blue desktop', () => {
    const rt = boot()
    const p = rt.intuition.openWorkBench()
    expect(p).not.toBe(0)
    const wb = rt.screens.get(WB_SLOT)!
    expect([wb.width, wb.height, wb.depth, wb.hires]).toEqual([640, 256, 2, true])
    // OpenWorkBench does not bring it to the front (WBenchToFront does)
    expect(rt.order[rt.order.length - 1]).toBe(0)
    // ... so it shows only where the AMOS screen is not. The AMOS screen sits
    // at line 50 and is 50 tall; line 150 is Workbench.
    const { data } = rt.composite()
    const at = (hw: number): number[] => {
      const o = ((hw - Runtime.COMPOSITE_TOP) * 2 * 640 + 320) * 4
      return [data[o]!, data[o + 1]!, data[o + 2]!]
    }
    // $005A expanded to 24 bits: R 0, G $55, B $AA
    expect(at(150)).toEqual([0x00, 0x55, 0xaa])
  })

  it('WBenchToFront covers the AMOS screen; ToBack gives it back', () => {
    const rt = boot()
    rt.intuition.openWorkBench()
    const at60 = (): number[] => {
      const { data } = rt.composite()
      const o = ((60 - Runtime.COMPOSITE_TOP) * 2 * 640 + 320) * 4
      return [data[o]!, data[o + 1]!, data[o + 2]!]
    }
    expect(at60()).toEqual([0, 0, 0]) // AMOS screen 0, pen 0 = $000
    expect(rt.intuition.wBenchToFront()).toBe(true)
    expect(at60()).toEqual([0x00, 0x55, 0xaa]) // Workbench blue
    expect(rt.intuition.wBenchToBack()).toBe(true)
    expect(at60()).toEqual([0, 0, 0])
  })

  it('does not steal the current screen — AMOS keeps drawing where it was', () => {
    const rt = boot()
    const before = rt.currentIndex
    rt.intuition.openWorkBench()
    expect(rt.currentIndex).toBe(before)
  })

  it('CloseWorkBench takes it back out of the list', () => {
    const rt = boot()
    rt.intuition.openWorkBench()
    expect(rt.intuition.closeWorkBench()).toBe(true)
    expect(rt.screens.has(WB_SLOT)).toBe(false)
    expect(rt.order).not.toContain(WB_SLOT)
  })
})

describe('the flash and shift family need a screen open', () => {
  // InFlashOff (+Lib.s:9285), InFlash (+Lib.s:9294), InShiftOff (+Lib.s:9310)
  // and ShD1 (+Lib.s:9329) all open `tst.w ScOn(a5) / Rbeq L_ScNOp`. The port
  // reached currentIndex, which answers 0 whether or not a screen is open.
  it('raises 47 with nothing open', () => {
    for (const stmt of ['Flash Off', 'Flash 1,"(FFF,5)"', 'Shift Off', 'Shift Up 1,2,15,1']) {
      expect(() => run(`Screen Close 0\n${stmt}`)).toThrow(/screen not opened/i)
    }
  })
})
