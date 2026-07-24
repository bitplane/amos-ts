import { describe, expect, it } from 'vitest'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { Runtime } from './runtime'
import { AmigaFS } from './vfs'
import { VI, int } from '../interp/values'

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

describe('objects: collision and bank editing (vs +W.s ColRout / Bnk.*)', () => {
  it('Bob Col is rectangle-gated pixel-perfect and fills the Col set', () => {
    const prog = [
      'Cls 0 : Ink 5 : Bar 0,0 To 7,7', // an 8x8 solid image
      'Get Bob 1,0,0 To 8,8',
      'Bob 1,50,50,1 : Bob 2,54,54,1 : Bob 3,100,100,1', // 1 & 2 overlap, 3 far
      'Wait Vbl',
      'C=Bob Col(1)',
      'Print C;Col(2);Col(3)',
    ].join('\n')
    expect(run(prog).out).toBe('-1-1 0\n') // hits 2, not 3
  })

  it('non-overlapping solid pixels do not collide (exclusive edges + mask AND)', () => {
    const prog = [
      'Cls 0 : Ink 5 : Bar 0,0 To 7,7',
      'Get Bob 1,0,0 To 8,8',
      'Bob 1,50,50,1 : Bob 2,58,50,1', // touching at x=58 (50+8), exclusive → no hit
      'Wait Vbl',
      'Print Bob Col(1)',
    ].join('\n')
    expect(run(prog).out).toBe(' 0\n')
  })

  it('Col(negative) returns the first colliding object number', () => {
    const prog = [
      'Cls 0 : Ink 5 : Bar 0,0 To 7,7',
      'Get Bob 1,0,0 To 8,8',
      'Bob 1,50,50,1 : Bob 5,52,52,1',
      'Wait Vbl',
      'C=Bob Col(1) : Print Col(-1)',
    ].join('\n')
    expect(run(prog).out).toBe(' 5\n')
  })

  it('Del Bob compacts the bank (splice); Ins Bob shifts images up', () => {
    const prog = [
      'Cls 0',
      'Ink 5 : Bar 0,0 To 7,7 : Get Bob 1,0,0 To 8,8',
      'Ink 6 : Bar 0,0 To 7,7 : Get Bob 2,0,0 To 8,8',
      'Ink 7 : Bar 0,0 To 7,7 : Get Bob 3,0,0 To 8,8',
      'Del Bob 2', // 3 renumbers down to 2
      'Print Length(1)', // image count via the bank
      'Ins Bob 1', // blank slot at 1, others shift up
      'Print Length(1)',
    ].join('\n')
    // sprite bank Length = image count: 3 images -> del -> 2 -> ins -> 3
    expect(run(prog).out).toBe(' 2\n 3\n')
  })

  it('Put Key appends to the keyboard buffer (InPutKey)', () => {
    const prog = ['Put Key "AB"', 'Print Inkey$;Inkey$'].join('\n')
    expect(run(prog).out).toBe('AB\n')
  })

  it('collision ignores the flip flags (ColRout strips them, +W.s:179)', () => {
    // an asymmetric image with the hot spot to one side; two bobs overlap.
    // whether bob 2 is flipped or not, the collision result is identical
    // because collision uses the raw un-flipped box.
    const base = [
      'Cls 0 : Ink 5 : Bar 0,0 To 3,7', // left half of a 16-wide image
      'Get Bob 1,0,0 To 16,8',
      'Hot Spot 1,12,4', // hot spot off-centre
    ]
    const unflipped = run([...base, 'Bob 1,60,60,1 : Bob 2,64,60,1', 'Wait Vbl', 'Print Bob Col(1)'].join('\n')).out
    const flipped = run([...base, 'Bob 1,60,60,1 : Bob 2,64,60,Hrev(1)', 'Wait Vbl', 'Print Bob Col(1)'].join('\n')).out
    expect(flipped).toBe(unflipped) // flip must not shift the collision box
  })

  it('Hot Spot code form uses the full width/height, not width-1 (SpotH +W.s:600)', () => {
    const prog = [
      'Cls 0 : Ink 5 : Bar 0,0 To 15,9',
      'Get Bob 1,0,0 To 16,10', // 16x10
      'Hot Spot 1,$22', // bottom-right = full width/height
      'Bob 1,100,100,1', // drawn top-left at 100-16, 100-10 = 84,90
    ].join('\n')
    const { rt } = run(prog)
    expect(rt.screen.point(84, 90)).toBe(5) // top-left corner of the image
    expect(rt.screen.point(99, 99)).toBe(5) // bottom-right at the hot spot
  })

  it('Bobsprite Col maps the bob into hardware space and hits the sprite', () => {
    // lowres bob at screen 50,50 maps to hw x=50+128=178, y=50+50=100
    // (CXyS: X halved only in hires, so lowres X is unchanged)
    const prog = [
      'Cls 0 : Ink 5 : Bar 0,0 To 7,7 : Get Bob 1,0,0 To 8,8',
      'Bob 1,50,50,1',
      'Sprite 8,178,100,1',
      'Wait Vbl',
      'Print Bobsprite Col(1)',
    ].join('\n')
    expect(run(prog).out).toBe('-1\n')
  })

  it('X/Y/I Sprite read back the raw stored hardware coords (HsXY)', () => {
    expect(run('Sprite 5,200,120,3 : Print X Sprite(5);Y Sprite(5);I Sprite(5)').out).toBe(' 200 120 3\n')
    // omitted args keep the previous value
    expect(run('Sprite 5,200,120,3 : Sprite 5,,140, : Print X Sprite(5);Y Sprite(5)').out).toBe(' 200 140\n')
  })

  it('Sprite number is limited to 0..63; Sprite Priority to 0..4', () => {
    expect(() => run('Sprite 64,100,100,1')).toThrow(/sprite number/)
    expect(() => run('Sprite Priority 5')).toThrow()
  })

  it('Sprite Priority 4 draws sprites behind the playfield', () => {
    const prog = [
      'Cls 5', // opaque colour-5 playfield everywhere
      'Ink 7 : Bar 0,0 To 15,15 : Get Bob 1,0,0 To 16,16',
      'Sprite 8,160,100,1',
      'Sprite Priority 4',
      'Wait Vbl',
    ].join('\n')
    const { rt } = run(prog)
    const { data } = rt.composite()
    // at the sprite's device position the playfield (colour 5) wins, not the sprite
    const px = (160 - 128) * 2
    const py = (100 - 50) * 2
    const o = (py * 640 + px) * 4
    const c5 = rt.screens.get(0)!.palette[5]!
    expect([data[o], data[o + 1], data[o + 2]]).toEqual([((c5 >> 8) & 15) * 17, ((c5 >> 4) & 15) * 17, (c5 & 15) * 17])
  })

  it('manual Sprite Update applies buffered moves while frozen', () => {
    const prog = [
      'Cls 0 : Ink 5 : Bar 0,0 To 7,7 : Get Bob 1,0,0 To 8,8',
      'Sprite 8,200,100,1',
      'Wait Vbl',
      'Sprite Update Off',
      'Sprite 8,240,100,1', // buffered, not yet shown
      'Print X Sprite(8)', // the table still reflects the write
      'Sprite Update', // apply now
    ].join('\n')
    const { rt, out } = run(prog)
    expect(out).toBe(' 240\n')
    expect(rt.frozenSprites!.find((s) => s.n === 8)!.x).toBe(240) // snapshot updated
  })
})

describe('stragglers (palette shift, wind size, key shift)', () => {
  const shiftAfterOneStep = (setup: string): number[] => {
    const rt = new Runtime(tokenize(setup + '\nDo : Wait Vbl : Loop', table), table, { maxSteps: 300_000 })
    rt.frame() // frame 1: interp sets up the shift (applyShifts already ran)
    rt.frame() // frame 2: exactly one shift applied
    const p = rt.screens.get(0)!.palette
    return [p[1]!, p[2]!, p[3]!]
  }

  // Flash Off first: colour 3 carries the system flash out of the box
  // (Screen Open runs Flash 3, +Lib.s:8989), which would fight the shifted
  // value here exactly as it does on a real Amiga
  it('Shift Up cycles a palette range with the exact rotation (Shifter +W.s:5464)', () => {
    // start [1,2,3]=$100,$200,$300; one up-shift → pal[1]<-pal[3] wrap
    expect(shiftAfterOneStep('Flash Off : Colour 1,$100 : Colour 2,$200 : Colour 3,$300\nShift Up 1,1,3')).toEqual([0x300, 0x100, 0x200])
  })

  it('Shift with flag 0 smears instead of wrapping (Shf8a)', () => {
    // no wrap: pal[1] stays, pal[2]<-pal[1], pal[3]<-pal[2]
    expect(shiftAfterOneStep('Flash Off : Colour 1,$100 : Colour 2,$200 : Colour 3,$300\nShift Up 1,1,3,0')).toEqual([0x100, 0x100, 0x200])
  })

  it('Wind Size clears the window interior (Clw)', () => {
    const prog = [
      'Cls 0',
      'Wind Open 1,0,0,20,10',
      'Ink 5 : Bar 0,0 To 100,60', // draw ink 5 into the window area
      'Wind Size 8,4', // resize → the interior is blanked to the window paper
    ].join('\n')
    const { rt } = run(prog)
    expect(rt.screen.point(20, 20)).not.toBe(5) // the ink-5 fill was cleared
  })

  it('Key Shift includes the Amiga-key bits (6/7)', () => {
    let out = ''
    const ks = new Runtime(tokenize('Print Key Shift', table), table, { maxSteps: 1000, onText: (t) => (out += t) })
    ks.input.keys.add(0x66) // Left Amiga → bit 6 = 64
    ks.runHeadless(50)
    expect(out).toBe(' 64\n')
  })
})

describe('text/console (vs +W.s / +ILib.s)', () => {
  it('Cls with no arg clears the current window; Cls c does not home the cursor', () => {
    // colour-form Cls must leave the cursor where it was
    const prog = ['Locate 5,3', 'Cls 2', 'Print "X";', 'X=X Curs : Y=Y Curs'].join('\n')
    const { rt } = run(prog)
    // the "X" printed at the un-homed cursor (col 5,6 after the print)
    expect(rt.screen.curX).toBe(6)
    expect(rt.screen.curY).toBe(3)
  })

  it('Print Using: overflow drops high digits, bare # loses the sign', () => {
    expect(run('Print Using "###";-12').out).toBe(' 12\n') // sign consumed as space
    expect(run('Print Using "##";123').out).toBe('23\n') // overflow digit dropped
    expect(run('Print Using "+##";5').out).toBe('+ 5\n') // sign slot
    expect(run('Print Using "##.##";3.5').out).toBe(' 3.50\n')
  })

  it('Zone$ wraps text in the ESC-Z text-zone codes (FnZoneD)', () => {
    expect(run('A$=Zone$("HI",1) : Print Len(A$)').out).toBe(' 8\n') // ESC Z 1 + HI + ESC Z 1
    expect(() => run('A$=Zone$("x",0)')).toThrow()
  })

  it('Display Height reflects the screen (laced doubles)', () => {
    expect(run('Screen Open 1,320,400,4,$4\nPrint Display Height').out).toBe(' 400\n')
  })
})

describe('procedures: Param typed slots (FnEProc +ILib.s:2701)', () => {
  it('End Proc[x] writes only the slot matching x type; others stay stale', () => {
    const prog = [
      '_A[0] : _B[0]',
      'Print Param;Param#;Param$',
      'Procedure _A[N]',
      '  Pop Proc[7]', // sets the int slot
      'End Proc',
      'Procedure _B[N]',
      '  Pop Proc[2.5]', // sets the float slot only
      'End Proc',
    ].join('\n')
    // int slot = 7 (from _A, never overwritten by _B's float), float = 2.5, str = ""
    // (Print gives each positive number a leading space)
    expect(run(prog).out).toBe(' 7 2.5\n')
  })
})

describe('screens (vs the 68k Ec* routines)', () => {
  it('Screen Open masks the width down to a multiple of 16 (EcCree +W.s:2910)', () => {
    expect(run('Screen Open 1,330,200,16,0 : Print Screen Width(1)').out).toBe(' 320\n')
    expect(run('Screen Open 1,336,200,16,0 : Print Screen Width(1);Screen Height(1)').out).toBe(' 336 200\n')
  })

  it('Screen Width/Height error on an explicit unopened screen (FnScreenWidth1)', () => {
    expect(() => run('Print Screen Width(5)')).toThrow(/not opened/)
    expect(run('Print Screen Width;Screen Height').out).toBe(' 320 200\n') // no-arg = current
  })

  it('Screen To Front reorders without changing the current screen (EcFirst)', () => {
    const prog = ['Screen Open 1,320,200,4,0', 'Screen 0', 'Screen To Front 1', 'Print Screen'].join('\n')
    const { rt, out } = run(prog)
    expect(out).toBe(' 0\n') // current is still 0
    expect(rt.order[rt.order.length - 1]).toBe(1) // but 1 composites on top
  })

  it('Screen Display sets the visible-window size and does not un-hide (EcView)', () => {
    const prog = [
      'Screen Open 0,320,200,4,0 : Cls 1', // fill with colour 1
      'Screen Display 0,,,160,100', // window shrunk to 160x100
    ].join('\n')
    const { rt } = run(prog)
    const s = rt.screens.get(0)!
    expect([s.displayW, s.displayH]).toEqual([160, 100])
    const { data } = rt.composite()
    // inside the window (device 100,100) is drawn; beyond it (device 400,300) is not
    const inside = data[(100 * 640 + 100) * 4] || data[(100 * 640 + 100) * 4 + 2]
    const outside = data[(300 * 640 + 400) * 4] || data[(300 * 640 + 400) * 4 + 2]
    expect(inside).toBeGreaterThan(0)
    expect(outside).toBe(0)
    // Screen Display does not re-show a hidden screen
    const hidden = run('Screen Open 0,320,200,4,0 : Screen Hide 0 : Screen Display 0,200,60').rt
    expect(hidden.screens.get(0)!.visible).toBe(false)
  })

  it('Dual Priority raises PF2 without reassigning the pair (DualP +W.s:2870)', () => {
    const prog = [
      'Screen Open 0,320,200,8,0 : Screen Open 1,320,200,8,0',
      'Dual Playfield 0,1',
      'Dual Priority 1,0', // back screen named first: PFBA set, PF2 in front
    ].join('\n')
    const { rt } = run(prog)
    expect(rt.dualPlayfield).toEqual({ front: 0, back: 1, pf2Front: true })
    // Dual Priority on a non-dual pair errors (EcE27)
    expect(() => run('Screen Open 0,320,200,8,0 : Screen Open 2,320,200,8,0 : Dual Priority 0,2')).toThrow(/dual playfield/)
  })

  it('Dual Playfield validates like SetDual (+W.s:2810)', () => {
    // resolution mismatch, too many planes, and bad plane combos all error
    expect(() => run('Screen Open 0,320,200,8,0 : Screen Open 1,640,200,8,$8000 : Dual Playfield 0,1')).toThrow(/impossible/)
    expect(() => run('Screen Open 0,320,200,16,0 : Screen Open 1,320,200,16,0 : Dual Playfield 0,1')).toThrow(/impossible/)
    expect(() => run('Screen Open 0,320,200,4,0 : Screen Open 1,320,200,8,0 : Dual Playfield 0,1')).toThrow(/impossible/)
    // (n, n-1) is legal, and the back screen hides (BitHide)
    const { rt } = run('Screen Open 0,320,200,8,0 : Screen Open 1,320,200,4,0 : Dual Playfield 0,1')
    expect(rt.screens.get(1)!.visible).toBe(false)
  })
})

describe('input subsystem (vs the 68k read routines)', () => {
  const table2 = new TokenTable(CORE_TOKENS)
  const boot = (src: string): { rt: Runtime; out: () => string } => {
    let out = ''
    const rt = new Runtime(tokenize(src, table2), table2, { maxSteps: 300_000, onText: (t) => (out += t) })
    return { rt, out: () => out }
  }

  it('Mouse Click is an edge-detected bitmask, not a count (MRout +W.s:10627)', () => {
    const { rt, out } = boot(['Do', ' C=Mouse Click', ' If C>0 Then Print C;Mouse Click : End', ' Wait Vbl', 'Loop'].join('\n'))
    for (let i = 0; i < 2; i++) rt.frame() // no buttons: reads 0
    rt.input.mouseK = 1 | 2 // both pressed together
    for (let i = 0; i < 4 && rt.frame().status !== 'ended'; i++);
    // first read = 3 (both newly pressed), the second (same statement) = 0
    expect(out()).toBe(' 3 0\n')
  })

  it('Scancode clears after a read (FnScancode +Lib.s:13631)', () => {
    const { rt, out } = boot(['A$=Inkey$', 'Do', ' A$=Inkey$', ' If A$<>"" Then Print Scancode;Scancode : End', ' Wait Vbl', 'Loop'].join('\n'))
    for (let i = 0; i < 2; i++) rt.frame()
    rt.pressKey('a', 0x20)
    for (let i = 0; i < 4 && rt.frame().status !== 'ended'; i++);
    expect(out()).toBe(' 32 0\n') // first read = $20, second = 0 (cleared)
  })

  it('Key$(n) is the function-key definition, set by Key$(n)= (FnKeyD)', () => {
    const { rt, out } = boot('Key$(3)="HELLO"\nPrint Key$(3)\nPrint Key$(1)=""')
    rt.runHeadless(100)
    expect(out()).toBe('HELLO\n-1\n') // slot 3 = HELLO, slot 1 = empty ("" = "" is true)
  })

  it('Key State masks to $7F and errors past 128 (FnKeyState +Lib.s:13649)', () => {
    const { rt, out } = boot(['Do', ' If Key State($40) Then Print "hit" : End', ' Wait Vbl', 'Loop'].join('\n'))
    for (let i = 0; i < 2; i++) rt.frame()
    rt.input.keys.add(0x40)
    for (let i = 0; i < 3 && rt.frame().status !== 'ended'; i++);
    expect(out()).toBe('hit\n')
    const bad = new Runtime(tokenize('Print Key State(200)', table2), table2, { maxSteps: 1000 })
    expect(() => bad.runHeadless(50)).toThrow()
  })
})

describe('drawing primitives (graphics cursor + shapes)', () => {
  const countPixels = (s: { height: number; width: number; point(x: number, y: number): number }, c: number): number => {
    let n = 0
    for (let y = 0; y < s.height; y++) for (let x = 0; x < s.width; x++) if (s.point(x, y) === c) n++
    return n
  }

  it('every primitive leaves the graphics cursor where the 68k does', () => {
    const cur = (src: string): [number, number] => {
      const s = run(src).rt.screen
      return [s.grX, s.grY]
    }
    expect(cur('Plot 10,20')).toEqual([10, 20]) // Plot -> x,y
    expect(cur('Draw 0,0 To 30,15')).toEqual([30, 15]) // Draw -> end
    expect(cur('Gr Locate 0,0 : Draw To 25,5')).toEqual([25, 5])
    expect(cur('Bar 5,5 To 40,40')).toEqual([5, 5]) // Bar -> top-left
    expect(cur('Circle 100,60,20')).toEqual([100, 60]) // Circle -> centre
    expect(cur('Ellipse 80,40,30,10')).toEqual([80, 40])
    expect(cur('A=Point(50,25)')).toEqual([50, 25]) // Point() moves the cursor
    expect(cur('Text 16,50,"AB"')).toEqual([32, 50]) // advanced by the width
  })

  it('Polygon fills its interior (InitArea/AreaEnd), Polyline strokes', () => {
    const filled = run('Ink 5 : Polygon 10,10 To 50,10 To 30,40').rt.screens.get(0)!
    const stroked = run('Ink 5 : Polyline 10,10 To 50,10 To 30,40').rt.screens.get(0)!
    expect(countPixels(filled, 5)).toBeGreaterThan(400) // interior filled
    expect(countPixels(stroked, 5)).toBeLessThan(120) // just the two edges
    expect(stroked.point(30, 10)).toBe(5) // the top edge is drawn
  })

  it('Circle doubles the x-radius on a hires screen (round on 2:1 pixels)', () => {
    const prog = ['Screen Open 1,640,200,16,$8000', 'Cls 0 : Ink 5', 'Circle 100,50,20'].join('\n')
    const s = run(prog).rt.screens.get(1)!
    // x-radius doubled to 40 → the horizontal extent is ~80, not ~40
    let leftmost = 999
    let rightmost = 0
    for (let y = 48; y <= 52; y++) for (let x = 0; x < 640; x++) if (s.point(x, y) === 5) { leftmost = Math.min(leftmost, x); rightmost = Math.max(rightmost, x) }
    expect(rightmost - leftmost).toBeGreaterThan(60)
  })

  it('Circle/Ellipse error on a non-positive radius (FonCall)', () => {
    expect(() => run('Circle 10,10,0')).toThrow()
    expect(() => run('Ellipse 10,10,5,0')).toThrow()
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

  it('flips bob images with the faithful width-hotX hot spot (BobCalc +W.s:1408)', () => {
    const prog = [
      'Cls 0 : Ink 5 : Plot 0,0 : Rem a single marked corner',
      'Get Bob 1,0,0 To 8,8', // 8x8, hot spot 0,0
      'Cls 0',
      'Bob 1,50,50,1',
      'Bob 2,100,50,Hrev(1)',
    ].join('\n')
    const { rt } = run(prog)
    expect(rt.screen.point(50, 50)).toBe(5) // normal: marked pixel at the hot spot
    // flipped: effective hotX = width-0 = 8, drawn top-left at 92; the marked
    // pixel (image column 0) mirrors to column 7 → screen 99 (not 100)
    expect(rt.screen.point(99, 50)).toBe(5)
    expect(rt.screen.point(100, 50)).toBe(0)
  })

  it('Hrev/Vrev Block mirror the stored block (RevBloc +W.s:12620)', () => {
    // a 4x4 block with a single marked pixel at its top-left corner
    const base = ['Cls 0', 'Ink 5 : Plot 10,10', 'Get Block 1,10,10,4,4']
    // horizontal mirror moves column 0 to the last column
    let rt = run([...base, 'Hrev Block 1', 'Cls 0', 'Put Block 1,0,0'].join('\n')).rt
    expect(rt.screen.point(3, 0)).toBe(5)
    expect(rt.screen.point(0, 0)).toBe(0)
    // vertical mirror moves row 0 to the last row
    rt = run([...base, 'Vrev Block 1', 'Cls 0', 'Put Block 1,0,0'].join('\n')).rt
    expect(rt.screen.point(0, 3)).toBe(5)
    expect(rt.screen.point(0, 0)).toBe(0)
    // a missing block raises the FindBloc "Block not defined" error
    expect(() => run('Hrev Block 9')).toThrow(/block not defined/)
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

  it('Deek/Doke/Leek/Loke are big-endian at any alignment (FnDeek +Lib.s:2805)', () => {
    const prog = [
      'Reserve As Data 6,32',
      'Doke Start(6),$1234 : Doke Start(6)+3,$5678', // even and odd
      'Print Peek(Start(6));Peek(Start(6)+1);Deek(Start(6)+3)',
      'Loke Start(6)+8,$DEADBEEF',
      'Print Leek(Start(6)+8)=$DEADBEEF',
    ].join('\n')
    expect(run(prog).out).toBe(' 18 52 22136\n-1\n') // $12,$34; $5678
  })

  it('Fill writes the whole range including the trailing bytes (FillBis +Lib.s:2648)', () => {
    const prog = [
      'Reserve As Data 6,16',
      'Fill Start(6) To Start(6)+6,$41424344',
      'Print Peek(Start(6)+4);Peek(Start(6)+5)', // the tail continues the pattern
    ].join('\n')
    expect(run(prog).out).toBe(' 65 66\n') // $41,$42 — not left as 0
  })

  it('Copy handles overlapping moves within a bank (TransMem +Lib.s:2535)', () => {
    const prog = [
      'Reserve As Data 6,32',
      'Poke$ Start(6),"ABCDEF"',
      'Copy Start(6),Start(6)+6 To Start(6)+2', // forward overlap
      'Print Peek$(Start(6),8)',
    ].join('\n')
    expect(run(prog).out).toBe('ABABCDEF\n')
  })

  it('Length is 0 for a missing bank; Bank Swap renumbers a lone bank (no error)', () => {
    expect(run('Print Length(99)').out).toBe(' 0\n')
    const prog = [
      'Reserve As Work 5,40',
      'Bank Swap 5,7', // 7 unreserved: 5 renumbers to 7, no error
      'Print Length(5);Length(7)',
    ].join('\n')
    expect(run(prog).out).toBe(' 0 40\n')
  })

  it('Bank Shrink only shrinks — a larger length errors (Bnk.Schrink +Lib.s:8265)', () => {
    expect(run('Reserve As Data 6,100 : Bank Shrink 6 To 40 : Print Length(6)').out).toBe(' 40\n')
    expect(() => run('Reserve As Data 6,100 : Bank Shrink 6 To 999')).toThrow()
  })

  it('Erase Temp removes Work banks by the Data flag, keeps Data banks', () => {
    const prog = [
      'Reserve As Data 6,10 : Reserve As Work 7,20 : Reserve As Work 8,30',
      'Erase Temp',
      'Print Length(6);Length(7);Length(8)',
    ].join('\n')
    expect(run(prog).out).toBe(' 10 0 0\n')
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

  it('Dual Playfield: PF2 shows through front colour 0 via FRONT palette 8-15', () => {
    const prog = [
      'Screen Open 0,320,200,8,0',
      'Cls 0', // front all colour 0
      'Screen Open 1,320,200,8,0',
      'Screen Display 1,128,50,,',
      'Cls 1', // back all colour 1
      'Screen 0 : Screen To Front 0',
      'Colour 9,$00F', // PF2 pixel value 1 resolves through FRONT colour 9
      'Dual Playfield 0,1',
    ].join('\n')
    const { rt } = run(prog)
    const { data } = rt.composite()
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

  it('Logbase/Phybase are faithful plane pointers (FnLogBase +Lib.s:8851)', () => {
    // planes are planeSize apart; single-buffered Logbase == Phybase (EcLogic ==
    // EcPhysic at open, +W.s:3001); Double Buffer splits them
    const prog = [
      'Screen Open 0,320,200,16,0', // 320 wide, 16 col => 4 planes, rowBytes 40
      'Print Logbase(1)-Logbase(0)', // one plane = 40*200 = 8000 bytes
      'Print Logbase(0)=Phybase(0)', // single-buffered: identical
      'Double Buffer',
      'Print Logbase(0)<>Phybase(0)', // now distinct
    ].join('\n')
    expect(run(prog).out).toBe(' 8000\n-1\n-1\n')
    // a plane index past the depth is a function-call error (4 col => 2 planes)
    expect(() => run('Screen Open 0,320,200,4,0\nPrint Logbase(2)')).toThrow()
  })

  it('plane pokes and chunky drawing round-trip through the same bitmap', () => {
    // row 50 is well below the console text area, so Print does not disturb it.
    // chunky -> planar: Plot then read the plane bit back via Peek
    const a = run(
      [
        'Screen Open 0,320,200,4,0', // 2 planes, rowBytes 40
        'Cls 0 : Plot 8,50,3', // colour 3 = planes 0 and 1 set at x=8,y=50
        'Print Peek(Logbase(0)+50*40+1);Peek(Logbase(1)+50*40+1)',
      ].join('\n'),
    ).out
    expect(a).toBe(' 128 128\n') // x=8 => bit 7 set in both planes
    // planar -> chunky: Poke a plane then read it as a pixel
    const b = run(
      [
        'Screen Open 0,320,200,4,0',
        'Cls 0',
        'Poke Logbase(0)+50*40+0,64', // plane0 row50 byte0 bit6 => x=1
        'Poke Logbase(1)+50*40+0,64', // plane1 same => colour 3
        'Print Point(1,50);Point(0,50)',
      ].join('\n'),
    ).out
    expect(b).toBe(' 3 0\n')
  })
})

describe('menus', () => {
  it('defines a tree, selects with the right button, fires Choice', () => {
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
    // press RMB over the "File" title (title bar at the top of screen 0)
    rt.input.mouseK = 2
    rt.input.mouseX = 128 + 4
    rt.input.mouseY = 50 + 3
    rt.frame()
    expect(rt.menuOpen).not.toBeNull()
    expect(rt.menuOpen!.levels).toHaveLength(2) // the dropdown opened below
    // move onto the second item ("Save") using its computed geometry
    const save = rt.menuOpen!.levels[1]!.lvl.list[1]!
    rt.input.mouseX = 128 + save.xx + 2
    rt.input.mouseY = 50 + save.yy + 2
    rt.frame()
    expect(rt.menuOpen!.active).toBe(save)
    // release commits the selection and restores the screen
    rt.input.mouseK = 0
    for (let i = 0; i < 4; i++) rt.frame()
    expect(out).toContain(' 1 2')
    expect(rt.menuOpen).toBeNull()
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
    rt.input.mouseX = 128 + 3
    rt.input.mouseY = 50 + 3
    rt.frame()
    const item = rt.menuOpen!.levels[1]!.lvl.list[0]!
    rt.input.mouseX = 128 + item.xx + 2
    rt.input.mouseY = 50 + item.yy + 2
    rt.frame()
    rt.input.mouseK = 0
    for (let i = 0; i < 5; i++) rt.frame()
    expect(out).toContain('PICKED 1')
  })
})

describe('Hscroll/Vscroll: window escape codes (InHScroll/InVScroll +Lib.s:13544)', () => {
  // the keywords print control chars 16-19/20-23; the scrolls are the
  // window escape handlers ScG*/ScD*/ScBas*/ScHaut* (+W.s:14539-14760)
  it('Hscroll 1 shifts only the cursor line one character left, paper-filling the edge', () => {
    const prog = [
      'Flash Off',
      'Plot 8,2,5', // text line 0 (cell rows 0-7)
      'Plot 8,10,6', // text line 1
      'Locate 0,0 : Hscroll 1',
    ].join('\n')
    const { rt } = run(prog)
    expect(rt.screen.point(0, 2)).toBe(5) // moved 8px left
    expect(rt.screen.point(8, 2)).toBe(1) // old spot now background
    expect(rt.screen.point(8, 10)).toBe(6) // other lines untouched
    expect(rt.screen.point(312, 2)).toBe(1) // vacated right column = paper
  })

  it('Hscroll 4 shifts the whole window right; Print Chr$(19) is identical', () => {
    const a = run('Flash Off\nPlot 8,2,5 : Plot 8,50,6\nHscroll 4').rt
    const b = run('Flash Off\nPlot 8,2,5 : Plot 8,50,6\nPrint Chr$(19);').rt
    for (const rt of [a, b]) {
      expect(rt.screen.point(16, 2)).toBe(5)
      expect(rt.screen.point(16, 50)).toBe(6)
      expect(rt.screen.point(0, 2)).toBe(1) // vacated left column = paper
    }
  })

  it('Vscroll 1 moves the cursor line and below DOWN, clearing the cursor line (ScBas)', () => {
    const prog = ['Flash Off', 'Plot 4,4,5 : Plot 4,12,6 : Plot 4,20,7', 'Locate 0,1 : Vscroll 1'].join('\n')
    const { rt } = run(prog)
    expect(rt.screen.point(4, 4)).toBe(5) // line 0 untouched
    expect(rt.screen.point(4, 12)).toBe(1) // cursor line cleared to paper
    expect(rt.screen.point(4, 20)).toBe(6) // old line 1 moved down to line 2
  })

  it('Vscroll 4 moves the lines below the cursor UP, clearing the bottom (ScHautBas)', () => {
    const prog = ['Flash Off', 'Plot 4,12,6 : Plot 4,20,7', 'Locate 0,0 : Vscroll 4'].join('\n')
    const { rt } = run(prog)
    expect(rt.screen.point(4, 4)).toBe(6) // old line 1 now at line 0 (cursor)
    expect(rt.screen.point(4, 12)).toBe(7) // old line 2 at line 1
    expect(rt.screen.point(4, 192)).toBe(1) // bottom line cleared
  })

  it('rejects arguments outside 1..4 (HVSc +Lib.s:13560)', () => {
    expect(() => run('Hscroll 0')).toThrow(/function call/)
    expect(() => run('Vscroll 5')).toThrow(/function call/)
  })
})
