import { describe, expect, it } from 'vitest'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { Runtime } from './runtime'
import { AmigaFS } from './vfs'

const table = new TokenTable(CORE_TOKENS)

function run(src: string): { rt: Runtime; out: string } {
  const fs = new AmigaFS()
  fs.mountMemory('DH0')
  let out = ''
  const rt = new Runtime(tokenize(src, table), table, { maxSteps: 300_000, fs, onText: (t) => (out += t) })
  const r = rt.runHeadless(1_000)
  if (r.status !== 'ended' && r.status !== 'stopped') throw new Error(`program ${r.status}`)
  return { rt, out }
}

describe('language cluster', () => {
  it('sorts arrays and finds entries with Match', () => {
    const prog = [
      'Dim A(4)',
      'A(0)=5 : A(1)=1 : A(2)=9 : A(3)=3 : A(4)=7',
      'Sort A(0)',
      'Print A(0);A(1);A(2);A(3);A(4)',
      'Print Match(A(0),7)',
      'Print Match(A(0),8)<0',
    ].join('\n')
    const { out } = run(prog)
    expect(out).toBe(' 1 3 5 7 9\n 3\n-1\n')
    expect(run('Dim A$(2)\nA$(0)="c" : A$(1)="a" : A$(2)="b"\nSort A$(0)\nPrint A$(0);A$(1);A$(2)').out).toBe('abc\n')
  })

  it('rotates and tests bits (Rol/Ror/Bset/Bclr/Bchg/Btst)', () => {
    expect(run('A=1 : Rol.b 1,A : Print A').out).toBe(' 2\n')
    expect(run('A=1 : Ror.b 1,A : Print A').out).toBe(' 128\n')
    expect(run('A=$80000000 : Rol.l 1,A : Print A').out).toBe(' 1\n')
    expect(run('A=0 : Bset 3,A : Print A;Btst(3,A);Btst(2,A)').out).toBe(' 8-1 0\n')
    expect(run('A=8 : Bchg 3,A : Print A').out).toBe(' 0\n')
  })

  it('converts text and graphic coordinates', () => {
    expect(run('Print X Text(80);Y Text(16);X Text(999)').out).toBe(' 10 2-1\n')
    expect(run('Print X Graphic(10);Y Graphic(2)').out).toBe(' 80 16\n')
  })

  it('interprets escape strings from At/Pen$/Paper$ when printed', () => {
    const { rt } = run('Print At(5,3)+Pen$(7)+"X";')
    expect(rt.screen.curWin.pen).toBe(7)
    // "X" was drawn at text cell (5,3) in pen 7
    let found = false
    for (let y = 24; y < 32; y++) for (let x = 40; x < 48; x++) if (rt.screen.point(x, y) === 7) found = true
    expect(found).toBe(true)
  })

  it('applies text styles: inverse, underline via Set Text', () => {
    const inv = run('Cls 0 : Inverse On : Pen 5 : Paper 0 : Locate 0,0 : Print "A"').rt
    // inverse: background cells get the pen colour
    expect(inv.screen.point(0, 0)).toBe(5)
    const und = run('Cls 0 : Set Text 1 : Pen 5 : Paper 0 : Locate 0,0 : Print "A"').rt
    for (let x = 0; x < 8; x++) expect(und.screen.point(x, 7)).toBe(5) // underline row
  })

  it('Scroll Off wraps printing to the window top', () => {
    const prog = ['Ink 6 : Plot 300,190', 'Scroll Off', 'For I=1 To 30 : Print "L" : Next'].join('\n')
    const { rt } = run(prog)
    expect(rt.screen.point(300, 190)).toBe(6) // nothing scrolled
    expect(rt.screen.curY).toBeLessThan(25)
  })
})

describe('sliders', () => {
  it('draws track and knob rects with the Set Slider colours (SliHor +W.s:5051)', () => {
    const prog = [
      'Cls 0',
      'Set Slider 4,4,4,0,5,5,5,0', // solid frame ink 4, solid knob ink 5
      'Hslider 10,10 To 110,20,100,25,25',
    ].join('\n')
    const { rt } = run(prog)
    const s = rt.screens.get(0)!
    // span 100: knob at off=25 len=25 → knob covers x 35..60, tracks around it
    expect(s.point(20, 15)).toBe(4) // before-track
    expect(s.point(45, 15)).toBe(5) // knob
    expect(s.point(80, 15)).toBe(4) // after-track
  })

  it('snaps the knob to the far end when pos+size >= total (SliPour full flag)', () => {
    const prog = ['Cls 0', 'Set Slider 4,4,4,0,5,5,5,0', 'Vslider 10,10 To 20,110,100,75,25'].join('\n')
    const { rt } = run(prog)
    const s = rt.screens.get(0)!
    expect(s.point(15, 109)).toBe(5) // knob reaches the bottom end
    expect(s.point(15, 30)).toBe(4) // top is track
  })

  it('errors on negative arguments and pos > total (GetSli)', () => {
    expect(() => run('Hslider 10,10 To 5,20,100,0,10')).toThrow() // x2 <= x1
    expect(() => run('Hslider 0,0 To 100,10,50,60,10')).toThrow() // pos > total
    expect(() => run('Vslider 0,0 To 10,100,-1,0,10')).toThrow()
  })

  it('enforces the 4px minimum knob (SliPour SlPo1)', () => {
    const prog = ['Cls 0', 'Set Slider 0,0,0,0,5,5,5,0', 'Hslider 0,0 To 200,10,1000,0,1'].join('\n')
    const { rt } = run(prog)
    const s = rt.screens.get(0)!
    let knob = 0
    for (let x = 0; x <= 200; x++) if (s.point(x, 5) === 5) knob++
    expect(knob).toBeGreaterThanOrEqual(4)
  })
})

describe('blocks, clones, flips', () => {
  it('grabs and puts blocks, remembering the origin', () => {
    const prog = [
      'Ink 5 : Bar 10,10 To 19,19',
      'Get Block 1,10,10,10,10',
      'Cls 0',
      'Put Block 1', // back at origin
      'Put Block 1,100,50',
    ].join('\n')
    const { rt } = run(prog)
    expect(rt.screen.point(15, 15)).toBe(5)
    expect(rt.screen.point(105, 55)).toBe(5)
  })

  it('flips bob images via Hrev/Vrev flags in the image number', () => {
    const prog = [
      'Cls 0 : Ink 5 : Plot 0,0 : Rem a single marked corner',
      'Get Bob 1,0,0 To 8,8',
      'Cls 0',
      'Bob 1,50,50,1',
      'Bob 2,100,50,Hrev(1)',
    ].join('\n')
    const { rt } = run(prog)
    expect(rt.screen.point(50, 50)).toBe(5) // normal: top-left set
    // flipped: the mirrored hot spot keeps the marked pixel at (100,50)
    expect(rt.screen.point(100, 50)).toBe(5)
    expect(rt.screen.point(94, 50)).toBe(0)
  })

  it('clones screens sharing the bitmap', () => {
    const prog = ['Screen Clone 3', 'Ink 5 : Plot 10,10'].join('\n')
    const { rt } = run(prog)
    expect(rt.screens.get(3)!.pixels).toBe(rt.screens.get(0)!.pixels)
    expect(rt.screens.get(3)!.point(10, 10)).toBe(5)
  })
})

describe('memory model', () => {
  it('reserves banks, peeks and pokes through fake addresses', () => {
    const prog = [
      'Reserve As Data 6,100',
      'Poke Start(6),42',
      'Doke Start(6)+2,$1234',
      'Loke Start(6)+4,$DEADBEEF',
      'Print Peek(Start(6));Deek(Start(6)+2)',
      'Print Leek(Start(6)+4)=$DEADBEEF',
      'Print Length(6)',
    ].join('\n')
    expect(run(prog).out).toBe(' 42 4660\n-1\n 100\n')
  })

  it('fills, copies, hunts and Peek$s', () => {
    const prog = [
      'Reserve As Work 6,64',
      'Fill Start(6) To Start(6)+16,$41424344',
      'Print Peek$(Start(6),4)',
      'Poke$ Start(6)+20,"NEEDLE"',
      'Print Hunt(Start(6) To Start(6)+64,"NEEDLE")-Start(6)',
      'Reserve As Data 7,32',
      'Copy Start(6),Start(6)+8 To Start(7)',
      'Print Peek$(Start(7),4)',
    ].join('\n')
    expect(run(prog).out).toBe('ABCD\n 20\nABCD\n')
  })

  it('Bsave/Bload round-trip through the VFS', () => {
    const prog = [
      'Reserve As Data 6,8',
      'Poke$ Start(6),"SAVEDATA"',
      'Bsave "DH0:mem.bin",Start(6) To Start(6)+8',
      'Reserve As Data 7,8',
      'Bload "DH0:mem.bin",Start(7)',
      'Print Peek$(Start(7),8)',
      'Bload "DH0:mem.bin",9',
      'Print Length(9)',
    ].join('\n')
    expect(run(prog).out).toBe('SAVEDATA\n 8\n')
  })

  it('Erase and Bank Swap manage banks', () => {
    const prog = [
      'Reserve As Data 6,10 : Reserve As Work 7,20',
      'Bank Swap 6,7',
      'Print Length(6);Length(7)',
      'Erase 6',
      'Print Length(6)',
    ].join('\n')
    expect(run(prog).out).toBe(' 20 10\n 0\n')
  })
})

describe('display control (Update/View/Default/Dual Playfield)', () => {
  it('Update Off freezes both pipelines; Update runs one manual round', () => {
    const prog = [
      'Update Off',
      'Ink 5 : Bar 0,0 To 15,15',
      'Get Bob 1,0,0 To 16,16',
      'Cls 0',
      'Bob 1,50,50,1',
      'Wait Vbl : Wait Vbl',
      'Rem nothing drew yet',
      'X=Point(50,50)',
      'Update',
      'Y=Point(50,50)',
      'Print X;Y',
    ].join('\n')
    expect(run(prog).out).toBe(' 0 5\n')
  })

  it('Default Palette seeds newly opened screens', () => {
    const prog = ['Default Palette $F00,,$0F0', 'Screen Open 1,320,200,16,0'].join('\n')
    const { rt } = run(prog)
    const s = rt.screens.get(1)!
    expect(s.palette[0]).toBe(0xf00)
    expect(s.palette[2]).toBe(0x0f0)
  })

  it('Auto View Off defers visibility until View', () => {
    const prog = ['Auto View Off', 'Screen Open 1,320,200,4,0'].join('\n')
    const { rt } = run(prog)
    expect(rt.screens.get(1)!.visible).toBe(false)
    const prog2 = ['Auto View Off', 'Screen Open 1,320,200,4,0', 'View'].join('\n')
    expect(run(prog2).rt.screens.get(1)!.visible).toBe(true)
  })

  it('Dual Playfield composites the back screen through front colour 0', () => {
    const prog = [
      'Screen Open 0,320,200,8,0',
      'Cls 0', // front all colour 0
      'Screen Open 1,320,200,8,0',
      'Screen Display 1,128,50,,',
      'Palette $000,$00F : Cls 1', // back all colour 1 = blue
      'Screen 0 : Screen To Front 0',
      'Dual Playfield 0,1',
    ].join('\n')
    const { rt } = run(prog)
    const { data } = rt.composite()
    // front colour 0 is transparent → the blue back screen shows
    expect(data[2]).toBe(255 - 0 ? data[2] : data[2]) // sanity noop
    expect([data[0], data[1], data[2]]).toEqual([0, 0, 255])
  })

  it('reports Screen Mode, Ntsc and Font$ formats', () => {
    const prog = [
      'Screen Open 2,640,200,4,$8000',
      'Print Screen Mode;Ntsc',
      'Get Fonts',
      'Print Font$(1)',
      'F=1 : Set Font F',
    ].join('\n')
    const { out } = run(prog)
    const lines = out.split('\n')
    expect(lines[0]).toBe(' 32768 0')
    expect(lines[1]).toMatch(/^topaz\.font\s+8\s+Rom\s*$/)
  })

  it('Logbase yields distinct plane addresses and errors past the depth', () => {
    const prog = ['Screen Open 0,320,200,16,0', 'Print Logbase(0)<>Logbase(1);Logbase(0)<>Phybase(0)'].join('\n')
    expect(run(prog).out).toBe('-1-1\n')
    expect(() => run('Screen Open 0,320,200,4,0\nPrint Logbase(2)')).toThrow()
  })
})

describe('menus', () => {
  it('defines menus, selects with the right button, fires Choice', () => {
    const fs = new AmigaFS()
    fs.mountMemory('DH0')
    let out = ''
    const src = [
      'Menu$(1)="File" : Menu$(1,1)="Load" : Menu$(1,2)="Save"',
      'Menu$(2)="Edit" : Menu$(2,1)="Copy"',
      'Menu On',
      'Do',
      ' If Choice Then Print Choice(1);Choice(2)',
      ' Wait Vbl',
      'Loop',
    ].join('\n')
    const rt = new Runtime(tokenize(src, table), table, { maxSteps: 300_000, fs, onText: (t) => (out += t) })
    for (let i = 0; i < 5; i++) rt.frame()
    // press RMB over the "File" title (composite x ~8 -> hw 128+4)
    rt.input.mouseK = 2
    rt.input.mouseX = 128 + 4
    rt.input.mouseY = 50 + 2
    rt.frame()
    expect(rt.menus.open).toBe(0)
    // move down to the second item ("Save": rows start at y=10, 10px each)
    rt.input.mouseY = 50 + Math.floor((10 + 15) / 2) // composite y ~25 -> hw 50+12
    rt.input.mouseY = 50 + 12
    rt.frame()
    expect(rt.menus.hoverItem).toBe(1)
    // menu bar renders while held — open title is highlighted blue
    const { data } = rt.composite()
    expect([data[0], data[1], data[2]]).toEqual([68, 68, 170])
    const far = (600 * 4) // beyond the titles: plain white bar
    expect([data[far], data[far + 1], data[far + 2]]).toEqual([255, 255, 255])
    // release
    rt.input.mouseK = 0
    for (let i = 0; i < 4; i++) rt.frame()
    expect(out).toContain(' 1 2')
  })

  it('dispatches On Menu Gosub on selection', () => {
    const fs = new AmigaFS()
    fs.mountMemory('DH0')
    let out = ''
    const src = [
      'Menu$(1)="F" : Menu$(1,1)="X"',
      'Menu On : On Menu Gosub HANDLER : On Menu On',
      'Do : Wait Vbl : Loop',
      'HANDLER: Print "PICKED";Choice(2) : On Menu On : Return',
    ].join('\n')
    const rt = new Runtime(tokenize(src, table), table, { maxSteps: 300_000, fs, onText: (t) => (out += t) })
    for (let i = 0; i < 3; i++) rt.frame()
    rt.input.mouseK = 2
    rt.input.mouseX = 128 + 4
    rt.input.mouseY = 50 + 2
    rt.frame()
    rt.input.mouseY = 50 + 8 // first item row
    rt.frame()
    rt.input.mouseK = 0
    for (let i = 0; i < 5; i++) rt.frame()
    expect(out).toContain('PICKED 1')
  })
})
