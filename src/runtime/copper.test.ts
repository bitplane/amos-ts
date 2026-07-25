import { describe, expect, it } from 'vitest'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { Runtime } from './runtime'

const table = new TokenTable(CORE_TOKENS)

function boot(src: string): Runtime {
  return new Runtime(tokenize(src, table), table, { maxSteps: 3_000_000 })
}

function run(src: string): Runtime {
  const rt = boot(src)
  const r = rt.runHeadless(2_000)
  if (r.status !== 'ended' && r.status !== 'stopped') throw new Error(`program ${r.status}`)
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

  it('a runaway list faults at the 12KB buffer, like the real machine (CopEr2 +W.s:6905, 12*1024 config)', () => {
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

  it('list writes require Copper Off, bounds are checked (CopEr1/CopEr3)', () => {
    expect(() => run('Cop Move $180,0')).toThrow(/copper not deactivated/)
    expect(() => run('Cop Swap')).toThrow(/copper not deactivated/)
    expect(() => run('Cop Reset')).toThrow(/copper not deactivated/)
    expect(() => run('Copper Off\nCop Move 512,0')).toThrow(/out of range/)
    expect(() => run('Copper Off\nCop Wait 0,313')).toThrow(/out of range/)
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

describe('the system copper list (EcCopper/HsCop +W.s:5730/6786)', () => {
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
      'Flash Off : Curs Off',
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


