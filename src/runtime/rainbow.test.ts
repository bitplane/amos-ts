import { describe, expect, it } from 'vitest'
import { mustFinish } from '../testing/run'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/source'
import { Runtime } from './runtime'

const table = new TokenTable(CORE_TOKENS)

function boot(src: string): { rt: Runtime; out: string } {
  let out = ''
  const rt = new Runtime(tokenize(src, table), table, { maxSteps: 300_000, onText: (t) => (out += t) })
  const r = rt.runHeadless(1_000)
  mustFinish(r)
  return { rt, out }
}

/** the composited RGBA pixel at output coords (x, y) as a 12-bit value */
function pix12(rt: Runtime, x: number, y: number): number {
  const { data } = rt.composite()
  const o = ((y + 48) * 640 + x) * 4 // helper rows start at line 50 (the classic top); 48 rows of overscan sit above
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

  it('bounds: rainbow number < 4, 16 <= length < 32700 (InSetRainbow7 +Lib.s:9356)', () => {
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

describe('rainbow rendering: the scanline copper walk (CopBow +W.s:6050-6231)', () => {
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

describe('the out-of-the-box cursor (AffCur +W.s:13575 + Flash 3 +Lib.s:8989)', () => {
  it('Screen Open installs the system flash on colour 3, bound to that screen', () => {
    const { rt } = boot('Screen Open 0,320,200,16,Lowres')
    const fl = rt.flashes.find((f) => f.reg === 3)
    expect(fl).toBeDefined()
    expect(fl!.screen).toBe(0)
    expect(fl!.seq.length).toBe(16) // config message 46: 16 steps of 2
    // ... but not on a 2-colour screen (one plane, +Lib.s:8990)
    const { rt: rt2 } = boot('Flash Off\nScreen Open 1,320,200,2,Lowres')
    expect(rt2.flashes.some((f) => f.reg === 3)).toBe(false)
  })

  it('only the Screen Open INSTRUCTION flashes — Unpack/clone screens do not (+Lib.s:25517, EcCall Cree)', () => {
    // Spack needs the compact extension; use Screen Clone, which also goes
    // through the low-level create rather than InScreenOpen
    const { rt } = boot('Flash Off\nScreen Clone 4')
    expect(rt.flashes.length).toBe(0)
  })

  it('each screen keeps its own entry; Flash Off stops the current screen only (FlStop +W.s:5256)', () => {
    const src = [
      'Screen Open 0,320,200,16,Lowres', // flash col 3 @ screen 0
      'Screen Open 1,320,200,16,Lowres', // flash col 3 @ screen 1
      'Screen 1 : Flash Off', // clears screen 1's entry only
    ].join('\n')
    const { rt } = boot(src)
    expect(rt.flashes.map((f) => f.screen)).toEqual([0])
    // Flash n,"" silently stops one colour (flspoke +W.s:5304)
    const { rt: rt2 } = boot('Screen Open 0,320,200,16,Lowres\nFlash 3,""')
    expect(rt2.flashes.length).toBe(0)
  })

  it('a malformed spec raises Flash declaration error (flsynt → message 52)', () => {
    expect(() => boot('Flash 3,"(ff,2)"')).toThrow(/flash declaration error/)
    expect(() => boot('Flash 3,"(ff0,0)"')).toThrow(/flash declaration error/)
  })

  it('the flash animates the bound screen palette each vbl (FlInt +W.s:5649)', () => {
    const src = 'For I=1 To 4 : Wait Vbl : Next I'
    const { rt } = boot(src)
    // after 4 vbls the default (000,2)(440,2)(880,2)... has advanced
    const p3 = rt.screens.get(0)!.palette[3]! & 0xfff
    expect([0x440, 0x880, 0xbb0]).toContain(p3)
  })

  it('draws the current window cursor as an underline in the cursor pen', () => {
    const { rt } = boot('Flash Off : Colour 3,$F0F : Locate 0,0')
    // DefCurs (+W.s:16707): rows 6-7 of the cell; window 0 starts at 0,0
    expect(pix12(rt, 0, 6 * 2)).toBe(0xf0f) // underline row, cursor pen 3
    expect(pix12(rt, 0, 2 * 2)).not.toBe(0xf0f) // upper cell rows untouched
  })

  /**
   * The cursor is IN the bitmap (AffCur +W.s:13575), not an overlay on the
   * finished frame. It matters because an overlay cannot be painted over:
   * eggit printed a message box, dismissed it, repainted the room, and the
   * cursor went on floating over the artwork for the rest of the game.
   */
  it('graphics drawn over the cursor cell cover it, and it stays covered', () => {
    const printed = 'Flash Off : Colour 3,$F0F : Colour 5,$0F0 : Locate 0,0 : Print "HI";'
    // the cursor sits in the cell after "HI": screen x 16..23, underline rows
    // 6-7 — and the composite is doubled, so screen x 16 is output x 32
    expect(pix12(boot(printed).rt, 16 * 2, 6 * 2)).toBe(0xf0f)
    // now a program draws over that cell, exactly as ROOMSET does
    const { rt } = boot(`${printed} : Ink 5 : Bar 0,0 To 100,20`)
    expect(pix12(rt, 16 * 2, 6 * 2)).toBe(0x0f0)
    // and it must still be covered a frame later — the overlay came back
    // every frame, which is what made it look like a shadow
    rt.frame()
    expect(pix12(rt, 16 * 2, 6 * 2)).toBe(0x0f0)
  })

  /**
   * WiSys bit 1 is a property of the WINDOW (+W.s:13605), not of the screen:
   * WOpen sets it on every window it creates (bset #1,WiSys +W.s:13778, right
   * before its AffCur), so Curs Off does not carry into the next window.
   */
  it('a new window comes up with the cursor on, whatever the last one had', () => {
    const src = 'Flash Off : Colour 3,$F0F : Curs Off : '
    // window 0, cursor off: nothing in the cell
    expect(pix12(boot(`${src}Locate 0,0`).rt, 0, 6 * 2)).not.toBe(0xf0f)
    // a window opened after Curs Off has its own cursor, and shows it
    const { rt } = boot(`${src}Wind Open 1,0,0,10,5`)
    expect(rt.screen.curWin.n).toBe(1)
    expect(pix12(rt, 0, 6 * 2)).toBe(0xf0f)
    // and window 0's flag was not disturbed by the one next door
    expect(rt.screen.windows.get(0)!.cursor).toBe(false)
    expect(rt.screen.windows.get(1)!.cursor).toBe(true)
  })

  /**
   * WiCuDraw is per window too (Set Curs -> WiSCur +W.s:14069), and WOpen
   * resets it to DefCurs rather than inheriting it (+W.s:13772).
   */
  it('Set Curs changes the shape of the cursor that is on screen', () => {
    const src = 'Flash Off : Colour 3,$F0F : Locate 0,0 : '
    // DefCurs is rows 6-7 only, so row 0 of the cell is clear
    expect(pix12(boot(`${src}Rem`).rt, 0, 0)).not.toBe(0xf0f)
    // a full block: every row of the cell is the cursor pen, and the shape
    // takes effect on the cursor already drawn
    const { rt } = boot(`${src}Set Curs 255,255,255,255,255,255,255,255`)
    expect(pix12(rt, 0, 0)).toBe(0xf0f)
    expect(pix12(rt, 0, 7 * 2)).toBe(0xf0f)
    // truncated to a byte, as the 68k's move.b does
    expect([...rt.screen.curWin.curDraw]).toEqual([255, 255, 255, 255, 255, 255, 255, 255])
    // a new window starts from DefCurs again rather than inheriting it
    const { rt: rt2 } = boot(`${src}Set Curs 255,255,255,255,255,255,255,255 : Wind Open 1,0,0,10,5`)
    expect([...rt2.screen.curWin.curDraw]).toEqual([0, 0, 0, 0, 0, 0, 0xff, 0xff])
  })

  it('a cursor move takes the drawn cursor with it, leaving nothing behind', () => {
    // Cright is the character chr(28) through the window writer (+Lib.s:13390),
    // so it runs inside the EffCur/AffCur bracket. Poking curX instead left
    // the cursor drawn in the cell it started in.
    const { rt } = boot('Flash Off : Colour 3,$F0F : Locate 0,0 : Cright : Cright')
    expect(pix12(rt, 2 * 8 * 2, 6 * 2)).toBe(0xf0f) // at the new cell
    expect(pix12(rt, 0, 6 * 2)).not.toBe(0xf0f) // and gone from the old one
    // Remember X is ESC "M1" and behaves the same way
    const { rt: rt2 } = boot('Flash Off : Colour 3,$F0F : Locate 0,0 : Memorize X : Cright : Remember X')
    expect(pix12(rt2, 0, 6 * 2)).toBe(0xf0f)
    expect(pix12(rt2, 1 * 8 * 2, 6 * 2)).not.toBe(0xf0f)
  })

  it('Curs Pen recolours the cursor that is already drawn, and checks its range', () => {
    // InCursPen sends ESC "D" + colour (+Lib.s:13301), inside the bracket
    const { rt } = boot('Flash Off : Colour 7,$00F : Locate 0,0 : Curs Pen 7')
    expect(pix12(rt, 0, 6 * 2)).toBe(0x00f)
    // CurCol (+W.s:14778) refuses a colour the screen has not got
    expect(() => boot('Curs Pen 99')).toThrow(/illegal text window parameter/)
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
