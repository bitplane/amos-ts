import { describe, expect, it } from 'vitest'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { Runtime } from './runtime'

const table = new TokenTable(CORE_TOKENS)

function boot(src: string): { rt: Runtime; out: string } {
  let out = ''
  const rt = new Runtime(tokenize(src, table), table, { maxSteps: 300_000, onText: (t) => (out += t) })
  const r = rt.runHeadless(1_000)
  if (r.status !== 'ended' && r.status !== 'stopped') throw new Error(`program ${r.status}`)
  return { rt, out }
}

/** the composited RGBA pixel at output coords (x, y) as a 12-bit value */
function pix12(rt: Runtime, x: number, y: number): number {
  const { data } = rt.composite()
  const o = (y * 640 + x) * 4
  return ((Math.round(data[o]! / 17) & 15) << 8) | ((Math.round(data[o + 1]! / 17) & 15) << 4) | (Math.round(data[o + 2]! / 17) & 15)
}

describe('Set Rainbow: the TRSet table build (+W.s:3990-4110)', () => {
  it('runs the channel wave machine: seed first, then (interval,step,count) groups', () => {
    // R channel "(1,1,15)": every line +1, 15 times, then the group repeats
    const { rt } = boot('Set Rainbow 0,0,17,"(1,1,15)","",""')
    const t = rt.rainbows.get(0)!.table
    expect(t.length).toBe(17)
    for (let i = 0; i <= 15; i++) expect(t[i]).toBe(i << 8) // entry 0 = seed 0
    expect(t[16]).toBe(0) // 15 + 1 wraps the 4-bit component
  })

  it('honours interval and the repeat-forever count 0 (Trs2)', () => {
    const { rt } = boot('Set Rainbow 0,0,16,"","","(2,1,0)"')
    const t = rt.rainbows.get(0)!.table
    // B channel steps every 2 lines forever: 0,0,1,1,2,2...
    for (let i = 0; i < 16; i++) expect(t[i]).toBe((i >> 1) & 15)
  })

  it('seeds the three nibbles from the optional 7th value (InSetRainbow7 d7)', () => {
    const { rt } = boot('Set Rainbow 0,0,16,"","","",$123')
    const t = rt.rainbows.get(0)!.table
    for (let i = 0; i < 16; i++) expect(t[i]).toBe(0x123) // all channels frozen at the seed
  })

  it('masks the colour &31 then requires < PalMax=16 — colour 33 wraps to 1 (TRSet +W.s:3999)', () => {
    const { rt } = boot('Set Rainbow 0,33,16,"","",""')
    expect(rt.rainbows.get(0)!.colour).toBe(1)
    expect(() => boot('Set Rainbow 0,17,16,"","",""')).toThrow(/function call/)
  })

  it('bounds: rainbow number < 4, 16 <= length < 32700 (InSetRainbow7 +Lib.s:9385)', () => {
    expect(() => boot('Set Rainbow 4,0,16,"","",""')).toThrow(/function call/)
    expect(() => boot('Set Rainbow 0,0,15,"","",""')).toThrow(/function call/)
    expect(() => boot('Set Rainbow 0,0,32700,"","",""')).toThrow(/function call/)
  })

  it('rejects a comma BETWEEN groups and deletes the half-made rainbow (RainTok/TrSynt)', () => {
    expect(() => boot('Set Rainbow 0,0,16,"(1,1,5),(1,-1,5)","",""')).toThrow(/function call/)
    // lowercase noise is skipped by AniChr — this one is legal
    const { rt } = boot('Set Rainbow 0,0,16,"(1,1,5)up then(1,-1,5)down","",""')
    expect(rt.rainbows.get(0)!.table[6]).toBe(4 << 8) // 0..5 up, then back down
  })
})

describe('Rainbow / Rain: TRDo and TRVar (+W.s:3940-3985)', () => {
  it('errors on an undefined rainbow as OUT OF MEMORY (RainEr -> EcWiErr code 1)', () => {
    expect(() => boot('Rainbow 0,0,60,40')).toThrow(/out of memory/)
    expect(() => boot('Set Rainbow 0,0,16,"","",""\nRainbow 1,0,60,40')).toThrow(/out of memory/)
  })

  it('Rain()/Rain= read and write 12-bit table entries with bounds (TRVar)', () => {
    const src = ['Set Rainbow 2,0,16,"","",""', 'Rain(2,5)=$7FFF', 'Print Rain(2,5)'].join('\n')
    expect(boot(src).out).toBe(' 4095\n') // masked to 12 bits on write
    expect(() => boot('Set Rainbow 2,0,16,"","",""\nPrint Rain(2,16)')).toThrow(/out of memory/)
    expect(() => boot('Set Rainbow 2,0,16,"","",""\nRain(2,-1)=0')).toThrow(/out of memory/)
  })

  it('elided Rainbow parameters keep current values, like the tutorial `Rainbow N,Y,,`', () => {
    const src = ['Set Rainbow 0,0,16,"","",""', 'Rainbow 0,3,60,40', 'Rainbow 0,7,,'].join('\n')
    const { rt } = boot(src)
    const rb = rt.rainbows.get(0)!
    rt.composite() // fold RnAct like the copper build
    expect(rb.base).toBe(7)
    expect(rb.dy).toBe(60)
    expect(rb.ty).toBe(40)
  })

  it('activation quirks: y clamps to 28, an out-of-range base is ignored (RainA3/RainA4)', () => {
    // the Wait Vbl matters: activation happens at the vbl copper build, so
    // the first call must latch before the second overwrites RnX
    const src = ['Set Rainbow 0,0,16,"","",""', 'Rainbow 0,3,10,40', 'Wait Vbl', 'Rainbow 0,20,,'].join('\n')
    const { rt } = boot(src)
    rt.composite()
    const rb = rt.rainbows.get(0)!
    expect(rb.dy).toBe(28) // moveq #28 clamp
    expect(rb.base).toBe(3) // 20 >= len 16: RainA4 keeps the old base
  })
})

describe('rainbow rendering: the scanline copper walk (CopBow +W.s:6079-6260)', () => {
  it('writes the colour register per line and restores the palette after the span', () => {
    // the default screen clears to PAPER 1 (the out-of-box orange), so the
    // visible background is colour 1 — rainbow that register
    const src = [
      'Flash Off : Colour 1,$050',
      'Set Rainbow 0,1,64,"(1,1,15)","",""',
      'Rain(0,0)=$111 : Rain(0,10)=$999',
      'Rainbow 0,0,60,20', // hardware lines 60-79
    ].join('\n')
    const { rt } = boot(src)
    // hardware line L maps to output row (L-50)*2; probe inside the screen
    // but clear of the mouse-pointer sprite at top-left
    expect(pix12(rt, 100, (60 - 50) * 2)).toBe(0x111) // table[0] at dy
    expect(pix12(rt, 100, (70 - 50) * 2)).toBe(0x999) // table[10]
    expect(pix12(rt, 100, (59 - 50) * 2)).toBe(0x050) // above: screen palette
    expect(pix12(rt, 100, (85 - 50) * 2)).toBe(0x050) // below: restored, not held
  })

  it('a rainbow on colour 0 recolours the border of gap lines below the screen', () => {
    const src = [
      'Screen Open 0,320,64,16,Lowres', // screen covers hardware lines 50-113
      'Flash Off : Colour 0,$000 : Colour Back $00F',
      'Set Rainbow 0,0,64,"","","",$F00', // constant $F00 table
      'Rainbow 0,0,150,20', // lines 150-169: below the screen, in the gap
    ].join('\n')
    const { rt } = boot(src)
    expect(pix12(rt, 320, (140 - 50) * 2)).toBe(0x00f) // gap: Colour Back fond
    expect(pix12(rt, 320, (155 - 50) * 2)).toBe(0xf00) // gap + rainbow on colour 0
    expect(pix12(rt, 320, (175 - 50) * 2)).toBe(0x00f) // after: fond restored
  })

  it('only the lowest-numbered covering rainbow runs — one rainbow at a time (RainN0)', () => {
    const src = [
      'Flash Off : Colour 5,$000',
      'Set Rainbow 0,5,16,"","","",$111',
      'Set Rainbow 1,5,16,"","","",$222',
      'Rainbow 0,0,60,20', // lines 60-79
      'Rainbow 1,0,70,40', // lines 70-109: overlaps 0
      'Ink 5 : Bar 0,0 To 319,199', // fill the screen with colour 5
    ].join('\n')
    const { rt } = boot(src)
    expect(pix12(rt, 10, (75 - 50) * 2)).toBe(0x111) // rainbow 0 owns the overlap
    expect(pix12(rt, 10, (90 - 50) * 2)).toBe(0x222) // rainbow 1 takes over at 80
  })

  it('screen banding: one front screen per line, its palette 0 as the border beside it', () => {
    const src = [
      'Flash Off : Colour 0,$040', // back screen colour 0
      'Ink 6 : Bar 0,0 To 319,199', // fill back screen with colour 6
      'Screen Open 1,160,40,16,Lowres', // front: half width, lines 50-89
      'Flash Off : Colour 0,$00A',
      'Screen Display 1,128,50,160,40',
    ].join('\n')
    const { rt } = boot(src)
    // shared band: the front screen owns the WHOLE line — the back screen
    // does not show beside it; the border is the front's colour 0
    expect(pix12(rt, 500, 20)).toBe(0x00a)
    // below the front screen the back band resumes
    const backInk = pix12(rt, 500, (100 - 50) * 2)
    expect(backInk).toBe(rt.screens.get(0)!.palette[6]! & 0xfff)
  })
})

describe('the out-of-the-box cursor (AffCur +W.s:13604 + Flash 3 +Lib.s:8989)', () => {
  it('Screen Open installs the system flash on colour 3, bound to that screen', () => {
    const { rt } = boot('Screen Open 0,320,200,16,Lowres')
    const fl = rt.flashes.get(3)
    expect(fl).toBeDefined()
    expect(fl!.screen).toBe(0)
    expect(fl!.seq.length).toBe(16) // config message 46: 16 steps of 2
    // ... but not on a 2-colour screen (one plane)
    const { rt: rt2 } = boot('Flash Off\nScreen Open 1,320,200,2,Lowres')
    expect(rt2.flashes.has(3)).toBe(false)
  })

  it('the flash animates the bound screen palette each vbl (FlInt +W.s:5678)', () => {
    const src = 'For I=1 To 4 : Wait Vbl : Next I'
    const { rt } = boot(src)
    // after 4 vbls the default (000,2)(440,2)(880,2)... has advanced
    const p3 = rt.screens.get(0)!.palette[3]! & 0xfff
    expect([0x440, 0x880, 0xbb0]).toContain(p3)
  })

  it('draws the current window cursor as an underline in the cursor pen', () => {
    const { rt } = boot('Flash Off : Colour 3,$F0F : Locate 0,0')
    // DefCurs (+W.s:16736): rows 6-7 of the cell; window 0 starts at 0,0
    expect(pix12(rt, 0, 6 * 2)).toBe(0xf0f) // underline row, cursor pen 3
    expect(pix12(rt, 0, 2 * 2)).not.toBe(0xf0f) // upper cell rows untouched
  })

  it('the cursor fades with a rainbow on its colour — the signature AMOS look', () => {
    const src = [
      'Flash Off : Colour 3,$000',
      'Set Rainbow 0,3,64,"","","",$0F0', // constant green on colour 3
      'Rainbow 0,0,50,64', // covering the top of the screen
      'Locate 0,0',
    ].join('\n')
    const { rt } = boot(src)
    // the cursor underline (screen row 6 = hardware line 56) shows the
    // rainbow colour, not palette 3
    expect(pix12(rt, 0, 6 * 2)).toBe(0x0f0)
    // Curs Off removes it
    const { rt: rt2 } = boot(src + '\nCurs Off')
    expect(pix12(rt2, 0, 6 * 2)).not.toBe(0x0f0)
  })
})
