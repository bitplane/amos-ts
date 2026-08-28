import { describe, expect, it } from 'vitest'
import { mustFinish } from '../testing/run'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/source'
import { extensionById } from '../ext/registry'
import { Runtime } from './runtime'
import { IE_NO_BASE, IE_WINDOW_BASE, IE_WINDOW_RP, newIeNewWindow } from './intuiextendwin'

const table = new TokenTable(CORE_TOKENS)
const ie = extensionById('intuiextend-2.01b')!

function run(src: string): { rt: Runtime; out: () => string } {
  const exts = new Map([[23, ie.table]])
  let printed = ''
  const rt = new Runtime(tokenize(src, table, exts), table, {
    extensions: exts,
    extBindings: new Map([[23, ie]]),
    maxSteps: 500_000,
    onText: (t) => (printed += t),
  })
  mustFinish(rt.runHeadless(5000))
  return { rt, out: () => printed }
}

const lines = (src: string): string[] =>
  run(src)
    .out()
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '')

describe('IntuiExtend 2.01b — the shipped NewWindow and NewScreen', () => {
  /**
   * The workspace is static data at $1d28 and the two structures are readable
   * straight out of the file: +$1c is the NewWindow and +$90 the NewScreen.
   */
  it('carries the maxima the guide rounds', () => {
    // Wind6: "MaxX = 640   MaxY = 256". The bytes at +$1c+42 are `027f 00ff`.
    const nw = newIeNewWindow()
    expect([nw.maxWidth, nw.maxHeight]).toEqual([639, 255])
    expect([nw.minWidth, nw.minHeight]).toEqual([50, 50])
  })

  it('asks for the IDCMP classes the file ships, not none', () => {
    // $004C0678, every bit named in includes/intuition/intuition.i:629-648
    expect(newIeNewWindow().idcmpFlags).toBe(0x004c_0678)
    expect(newIeNewWindow().flags).toBe(0x0000_320f)
  })
})

describe('IntuiExtend 2.01b — screens', () => {
  it('Wb Screen Base is -1 until something opens a screen', () => {
    expect(lines('Print Wb Screen Base')).toEqual([`${IE_NO_BASE}`])
  })

  it('Wb Screen Open hands its address to Wb Screen Base', () => {
    const src = `Wb Screen Open 0,0,320,256,3,0\nS=Wb Screen Base\nPrint S>0`
    expect(lines(src)).toEqual(['-1'])
  })

  it('opens the screen the arguments ask for, in the order the guide gives', () => {
    // "Wb Screen Open X,Y,W,H,PLAN,VMODE"
    const b = run('Wb Screen Open 0,0,320,200,3,0')
    const addr = b.rt.intuiextend.screenBase
    const slot = b.rt.intuition.slotOf(addr)!
    const s = b.rt.screens.get(slot)!
    expect([s.width, s.height, s.depth]).toEqual([320, 200, 3])
    expect(s.hires).toBe(false)
  })

  it('reads bit 15 of VMODE as HIRES and bit 2 as LACE', () => {
    const b = run('Wb Screen Open 0,0,640,256,2,$8004')
    const s = b.rt.screens.get(b.rt.intuition.slotOf(b.rt.intuiextend.screenBase)!)!
    expect([s.hires, s.laced]).toEqual([true, true])
  })

  it('Wb Screen Close writes -1 back over the base', () => {
    const src = `Wb Screen Open 0,0,320,200,2,0\nS=Wb Screen Base\nWb Screen Close S\nPrint Wb Screen Base`
    expect(lines(src)).toEqual([`${IE_NO_BASE}`])
  })

  it('Wb Screen Close writes -1 even for an address that closed nothing', () => {
    // `move.l #$ffffffff,(a0)` at $2572 is not behind any test
    const src = `Wb Screen Open 0,0,320,200,2,0\nWb Screen Close 12345\nPrint Wb Screen Base`
    expect(lines(src)).toEqual([`${IE_NO_BASE}`])
  })

  it('Wb Screen Rastport adds $54 and checks nothing', () => {
    expect(lines('Print Wb Screen Rastport(0)')).toEqual(['84'])
    expect(lines('Print Wb Screen Rastport(1000)')).toEqual([`${1000 + 0x54}`])
  })

  /**
   * DEFECT: `addi.w #$54,d3` at $259e, so the carry stops at the word
   * boundary and a screen near the top of a 64K page answers below itself.
   */
  it('Wb Screen Rastport carries only within the low word', () => {
    expect(lines('Print Wb Screen Rastport($1FFD0)')).toEqual([`${0x10024}`])
  })

  it('Wb Screen Move shifts the display by a delta', () => {
    const b = run('Wb Screen Open 0,40,320,200,2,0\nS=Wb Screen Base\nWb Screen Move S To 8,-10')
    const s = b.rt.screens.get(b.rt.intuition.slotOf(b.rt.intuiextend.screenBase)!)!
    expect(s.displayY).toBe(30)
  })

  it('Wb Screen Colour takes the VALUE first and the INDEX second', () => {
    // "Wb Screen Colour COUL,CNB To SCR", the reverse of AMOS's own Colour
    const b = run('Wb Screen Open 0,0,320,200,3,0\nS=Wb Screen Base\nWb Screen Colour $F80,3 To S')
    const s = b.rt.screens.get(b.rt.intuition.slotOf(b.rt.intuiextend.screenBase)!)!
    expect(s.palette[3]).toBe(0xf80)
  })

  it('Wb Screen Palette copies CNB words from an address', () => {
    const src = `Wb Screen Open 0,0,320,200,3,0
S=Wb Screen Base
Reserve As Work 10,8
Doke Start(10),$F00
Doke Start(10)+2,$0F0
Doke Start(10)+4,$00F
Wb Screen Palette Start(10),3 To S`
    const b = run(src)
    const s = b.rt.screens.get(b.rt.intuition.slotOf(b.rt.intuiextend.screenBase)!)!
    expect([s.palette[0], s.palette[1], s.palette[2]]).toEqual([0xf00, 0x0f0, 0x00f])
  })

  it('First Screen is 0 with no Intuition screen open', () => {
    // AMOS's own screens are on this display and are not Intuition screens
    expect(lines('Screen Open 0,320,256,16,Lowres\nPrint First Screen')).toEqual(['0'])
  })

  it('First Screen names a screen once one is opened', () => {
    const src = `Wb Screen Open 0,0,320,200,2,0\nPrint First Screen=Wb Screen Base`
    expect(lines(src)).toEqual(['-1'])
  })
})

describe('IntuiExtend 2.01b — windows', () => {
  const OPEN = 'Wb Screen Open 0,0,320,200,3,0\nS=Wb Screen Base\n'

  it('Wb Wind Base is -1 until something opens a window', () => {
    expect(lines('Print Wb Wind Base')).toEqual([`${IE_NO_BASE}`])
  })

  it('Wb Wind Open puts a window on the screen it is given', () => {
    const b = run(`${OPEN}Wb Wind Open S To 10,20,100,60,0`)
    const addr = b.rt.intuiextend.windBase
    expect(addr).toBe(IE_WINDOW_BASE)
    const w = b.rt.intuiextend.windowState.windows.get(addr)!
    expect([w.win.leftEdge, w.win.topEdge, w.win.width, w.win.height]).toEqual([10, 20, 100, 60])
  })

  /**
   *     $2608  move.w  #$f,$2e(a0)     ; CUSTOMSCREEN
   *     $260e  tst.l   $1e(a0)         ; nw_Screen
   *     $2612  bne.b   $261a
   *     $2614  move.w  #$1,$2e(a0)     ; WBENCHSCREEN
   */
  it('opens on the Workbench when SCREEN is 0', () => {
    const b = run('Wb Wind Open 0 To 10,20,100,60,0')
    expect(b.rt.intuition.workBenchOpen()).toBe(true)
    const w = b.rt.intuiextend.windowState.windows.get(b.rt.intuiextend.windBase)!
    expect(w.win.screenSlot).toBe(12) // WB_SLOT
  })

  it('Wb Wind Close clears the base and takes the window away', () => {
    const src = `${OPEN}Wb Wind Open S To 10,20,100,60,0\nW=Wb Wind Base\nWb Wind Close W\nPrint Wb Wind Base`
    expect(lines(src)).toEqual([`${IE_NO_BASE}`])
  })

  it('Wb Wind Move is relative, and Wb Change Window Box is absolute', () => {
    const rel = run(`${OPEN}Wb Wind Open S To 10,20,100,60,0\nW=Wb Wind Base\nWb Wind Move W To 5,5`)
    const rw = rel.rt.intuiextend.windowState.windows.get(rel.rt.intuiextend.windBase)!
    expect([rw.win.leftEdge, rw.win.topEdge]).toEqual([15, 25])

    const abs = run(`${OPEN}Wb Wind Open S To 10,20,100,60,0\nW=Wb Wind Base\nWb Change Window Box W To 5,5,80,40`)
    const aw = abs.rt.intuiextend.windowState.windows.get(abs.rt.intuiextend.windBase)!
    expect([aw.win.leftEdge, aw.win.topEdge, aw.win.width, aw.win.height]).toEqual([5, 5, 80, 40])
  })

  it('Wb Wind Size is a delta, held to the limits Wb Wind Limit set', () => {
    const src = `${OPEN}Wb Wind Open S To 10,20,100,60,0\nW=Wb Wind Base\nWb Wind Limit W To 20,20,120,80\nWb Wind Size W To 500,500`
    const b = run(src)
    const w = b.rt.intuiextend.windowState.windows.get(b.rt.intuiextend.windBase)!
    expect([w.win.width, w.win.height]).toEqual([120, 80])
  })

  it('Wb Wind Rastport is a handle the drawing keywords accept', () => {
    const src = `${OPEN}Wb Wind Open S To 10,20,100,60,0\nW=Wb Wind Base\nR=Wb Wind Rastport(W)\nWb Gfx Ink R To 2,0\nWb Plot R To 40,40`
    const b = run(src)
    const w = b.rt.intuiextend.windowState.windows.get(b.rt.intuiextend.windBase)!
    expect(w.rp!.fgPen).toBe(2)
    const s = b.rt.screens.get(w.win.screenSlot)!
    expect(s.rp.point(40, 40)).toBe(2)
  })

  it('Wb Wind Rastport is the window handle plus $20, and 0 for a stranger', () => {
    const src = `${OPEN}Wb Wind Open S To 10,20,100,60,0\nW=Wb Wind Base\nPrint Wb Wind Rastport(W)-W\nPrint Wb Wind Rastport(999)`
    expect(lines(src)).toEqual([`${IE_WINDOW_RP}`, '0'])
  })

  it('Wb Wind Title takes ADDRESSES, which is what Str Store gives', () => {
    // the guide: `Wb Wind Title WIND To Varptr(A$),Varptr(B$)`
    const src = `${OPEN}Wb Wind Open S To 10,20,100,60,0
W=Wb Wind Base
A=Str Store("Hello")
B=Str Store("Bar")
Wb Wind Title W To A,B`
    const b = run(src)
    const w = b.rt.intuiextend.windowState.windows.get(b.rt.intuiextend.windBase)!
    expect([w.win.title, w.win.screenTitle]).toEqual(['Hello', 'Bar'])
  })

  it('Wb Wind Title leaves a title alone for -1 and clears it for 0', () => {
    const src = `${OPEN}Wb Wind Open S To 10,20,100,60,0
W=Wb Wind Base
A=Str Store("Kept")
Wb Wind Title W To A,0
Wb Wind Title W To -1,0`
    const b = run(src)
    const w = b.rt.intuiextend.windowState.windows.get(b.rt.intuiextend.windBase)!
    expect(w.win.title).toBe('Kept')
  })

  it('X Wind and Y Wind read the pointer inside the window', () => {
    const src = `${OPEN}Wb Wind Open S To 10,20,100,60,0\nW=Wb Wind Base\nPrint X Wind(W)\nPrint Y Wind(W)`
    expect(lines(src)).toEqual(['0', '0'])
  })

  it('Wb Current Window names the window Intuition activated', () => {
    // the shipped NewWindow.Flags carry ACTIVATE ($1000)
    const src = `${OPEN}Wb Wind Open S To 10,20,100,60,$1000\nPrint Wb Current Window=Wb Wind Base`
    expect(lines(src)).toEqual(['-1'])
  })

  it('Wb Easy Wind Open needs no screen argument', () => {
    const src = `${OPEN}Wb Wind Open S To 0,0,50,50,$1000\nWb Easy Wind Open 10,20,100,60`
    const b = run(src)
    const w = b.rt.intuiextend.windowState.windows.get(b.rt.intuiextend.windBase)!
    expect([w.win.leftEdge, w.win.topEdge, w.win.width, w.win.height]).toEqual([10, 20, 100, 60])
  })

  /**
   * The NewWindow at +$1c is ONE structure and `Wb Wind Open` writes six of
   * its fields, so the limits a previous `Wb Wind Limit` left do not carry --
   * they are the window's, not the NewWindow's -- but the geometry does.
   */
  it('reuses the one NewWindow, so a second open starts from the first', () => {
    const b = run(`${OPEN}Wb Wind Open S To 10,20,100,60,$400`)
    expect(b.rt.intuiextend.newWindow.flags).toBe(0x400)
    expect(b.rt.intuiextend.newWindow.idcmpFlags).toBe(0x004c_0678)
  })
})

describe('IntuiExtend 2.01b — Wb Window redirects AMOS', () => {
  it('points Amos Rastport at the window and AMOS at its screen', () => {
    const src = `Wb Screen Open 0,0,320,200,3,0
S=Wb Screen Base
Wb Wind Open S To 10,20,100,60,0
W=Wb Wind Base
Wb Window W
Print Amos Rastport=Wb Wind Rastport(W)`
    expect(lines(src)).toEqual(['-1'])
  })

  it('Amos Rastport is the current screen plus $54 before anything redirects it', () => {
    const src = 'Screen Open 1,320,256,16,Lowres\nPrint Amos Rastport'
    const want = Runtime.SCREEN_CTRL_BASE + Runtime.SCREEN_CTRL_SLOT + 0x54
    expect(lines(src)).toEqual([`${want}`])
  })
})

describe('IntuiExtend 2.01b — the AGA pair that cannot fire', () => {
  /**
   * DEFECT: workspace+$701 is read at $4d92 and $4dae and written nowhere in
   * the 23,084-byte file, and the byte the library ships at $2429 is zero.
   * The guide promises "True(-1) ou False(0) si le chipset AGA existe".
   */
  it('Wb Check Aga answers 0 whatever the machine is', () => {
    expect(lines('Print Wb Check Aga')).toEqual(['0'])
  })

  it('Wb Kill Aga runs and changes nothing', () => {
    const b = run('Wb Kill Aga\nPrint Wb Check Aga')
    expect(b.out().trim()).toBe('0')
  })
})

describe('IntuiExtend 2.01b — the mouse pair', () => {
  it('Wb Mouse Off clears sprite DMA and Wb Mouse On puts it back', () => {
    // `move.w #$20,$dff096` then `move.w #$8020,$dff096`: bit 5 is SPREN
    expect(run('Wb Mouse Off').rt.spriteDma).toBe(false)
    expect(run('Wb Mouse Off\nWb Mouse On').rt.spriteDma).toBe(true)
  })
})

describe('IntuiExtend 2.01b — public screens', () => {
  it('Wb Lock Pubscreen locks the Workbench by name or by default', () => {
    expect(lines('Print Wb Lock Pubscreen("")>0')).toEqual(['-1'])
    expect(lines('Print Wb Lock Pubscreen("Workbench")>0')).toEqual(['-1'])
    expect(lines('Print Wb Lock Pubscreen("Nowhere")')).toEqual(['0'])
  })

  it('Wb Next Pubscreen fills the buffer Wb Pubscreen Name reads', () => {
    const src = `A=Wb Lock Pubscreen("")\nB=Wb Next Pubscreen(0)\nPrint Wb Pubscreen Name$`
    expect(lines(src)).toEqual(['Workbench'])
  })

  it('Wb Set Pubscreen Mode answers the PREVIOUS modes', () => {
    // SetPubScreenModes really does return the old value, unlike its neighbours
    expect(lines('Print Wb Set Pubscreen Mode(1)\nPrint Wb Set Pubscreen Mode(2)')).toEqual(['0', '1'])
  })

  it('Wb Pubscreen Statut answers the previous status', () => {
    expect(lines('Print Wb Pubscreen Statut(0,3)\nPrint Wb Pubscreen Statut(0,0)')).toEqual(['0', '3'])
  })
})

describe('IntuiExtend 2.01b — Wb Bitplane', () => {
  it('is the plane address Logbase gives, reached through a RastPort', () => {
    const src = `Screen Open 0,320,256,16,Lowres
R=Wb Screen Rastport(${Runtime.SCREEN_CTRL_BASE})
Print Wb Bitplane(R,0)=Logbase(0)
Print Wb Bitplane(R,2)=Logbase(2)`
    expect(lines(src)).toEqual(['-1', '-1'])
  })

  it('answers 0 for an address that is not a screen RastPort', () => {
    expect(lines('Print Wb Bitplane(12345,0)')).toEqual(['0'])
  })
})
