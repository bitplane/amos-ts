import { describe, expect, it } from 'vitest'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { EXTENSION_TOKENS, extensionById } from '../ext/registry'
import { Runtime } from './runtime'
import { AmigaFS } from './vfs'

/**
 * TURBO Plus, verified against TURBO_DocsV2.15.Asc — the extension's own
 * manual — and, where the manual is thin, against the disassembled routine.
 * Each test names which.
 *
 * Slot 12 is where the corpus and Andrew Burton's extensions list both put
 * TURBO, so that is where the tokenizer is given its table.
 */
const table = new TokenTable(CORE_TOKENS)
const TURBO_SLOT = 12
const extensions = new Map([
  ...[...EXTENSION_TOKENS].map(([slot, defs]) => [slot, new TokenTable(defs)] as const),
  [TURBO_SLOT, extensionById('turbo-plus-2.15')!.table] as const,
])

function run(src: string): { out: string; rt: Runtime; fs: AmigaFS } {
  let out = ''
  const fs = new AmigaFS()
  fs.mountMemory('DH0')
  fs.currentDir = 'DH0:'
  const rt = new Runtime(tokenize(src, table, extensions), table, {
    maxSteps: 200_000,
    extensions,
    fs,
    onText: (t) => (out += t),
  })
  const r = rt.runHeadless(2_000)
  if (r.status !== 'ended' && r.status !== 'stopped') throw new Error(`program ${r.status}`)
  return { out, rt, fs }
}

describe('TURBO task priority (TURBO_DocsV2.15.Asc + disassembly)', () => {
  it('Multi No sets priority 20 and Multi Yes puts it back to 0', () => {
    // The routine is SetTaskPri(FindTask(NULL), 20) — exec FindTask (-$126)
    // then SetTaskPri (-$12c) with 20 in d0 — matching the manual: "Under
    // AMOS Pro, Multi No sets the priority of AMOS Pro to 20".
    expect(run('Multi No').rt.turbo.priority).toBe(20)
    expect(run('Multi No : Multi Yes').rt.turbo.priority).toBe(0)
  })

  it('Amos Pri clamps to the documented range', () => {
    // "Value ranges from -128 to 20"
    expect(run('Amos Pri 5').rt.turbo.priority).toBe(5)
    expect(run('Amos Pri 100').rt.turbo.priority).toBe(20)
    expect(run('Amos Pri -200').rt.turbo.priority).toBe(-128)
  })
})

describe('TURBO input (TURBO_DocsV2.15.Asc + disassembly)', () => {
  it('Left Click and Right Click report the mouse buttons as AMOS truth', () => {
    // Left Click disassembles to eight instructions: btst.b #6,$bfe001 —
    // CIA-A port A bit 6 — returning -1 when clear (pressed), 0 when set.
    const held = (mask: number): string => {
      let out = ''
      const rt = new Runtime(tokenize('Print Left Click;Right Click', table, extensions), table, {
        extensions,
        maxSteps: 10_000,
        onText: (t) => (out += t),
      })
      rt.input.mouseK = mask
      rt.runHeadless(10)
      return out
    }
    expect(held(0)).toBe(' 0 0\n')
    expect(held(1)).toBe('-1 0\n')
    expect(held(2)).toBe(' 0-1\n')
    expect(held(3)).toBe('-1-1\n')
  })

  it('Is Raw Key returns the last scancode seen', () => {
    // "Returns the last key press in raw format. Beware! It gives different
    // values if the key is pressed or released." — see the NOTES entry: the
    // release bit is not modelled here
    let out = ''
    const rt = new Runtime(tokenize('Print Is Raw Key', table, extensions), table, {
      extensions,
      maxSteps: 10_000,
      onText: (t) => (out += t),
    })
    rt.input.lastScan = 69
    rt.runHeadless(10)
    expect(out).toBe(' 69\n')
  })

  it('Workbench Open is the counterpart to Close Workbench, and does nothing here', () => {
    expect(() => run('Close Workbench : Workbench Open')).not.toThrow()
  })

  it('Raw Key reads the same key state Key State does', () => {
    // "Does the same thing as the Key State function but works even if
    // multitasking is disabled. Returns true (-1) if key N is being
    // pressed." The manual's own example notes Raw Key(69) is ESC.
    let out = ''
    const rt = new Runtime(tokenize('Print Raw Key(69);Raw Key(70)', table, extensions), table, {
      extensions,
      maxSteps: 10_000,
      onText: (t) => (out += t),
    })
    rt.input.keys.add(69)
    rt.runHeadless(10)
    expect(out).toBe('-1 0\n')
  })
})

describe('TURBO Check zones (TURBO_DocsV2.15.Asc)', () => {
  // "CHECK commands are the TURBO version of AMOS Zone commands. These
  // commands are not compatible with the normal Zone commands!"
  const setup = ['Reserve Check 4', 'Set Check 0,10,10 To 50,50', 'Set Check 1,100,100 To 120,120']

  it('Check reports 1 inside a zone and 0 outside — not AMOS truth', () => {
    // "Returns 1 is the result is true, 0 if not" — note 1, not -1
    const { out } = run(
      [...setup, 'Print Check(0 To 3,20,20)', 'Print Check(0 To 3,200,200)', 'Print Check(0 To 3,110,110)'].join('\n'),
    )
    expect(out).toBe(' 1\n 0\n 1\n')
  })

  it('the start/end range excludes zones outside it', () => {
    // "The START and END parameters indicate which zones you want to check.
    // Ideal if there are many zones and you want to exclude some zones."
    const { out } = run([...setup, 'Print Check(0 To 0,110,110)', 'Print Check(1 To 1,110,110)'].join('\n'))
    expect(out).toBe(' 0\n 1\n')
  })

  it('Reset Check erases one definition, Check Erase all of them', () => {
    const { out } = run(
      [...setup, 'Reset Check 0', 'Print Check(0 To 3,20,20)', 'Check Erase', 'Print Check(0 To 3,110,110)'].join('\n'),
    )
    expect(out).toBe(' 0\n 0\n')
  })

  it('Set Check without reserving first is an error', () => {
    // "Execute this command before Setting any Check zones."
    expect(() => run('Set Check 0,0,0 To 10,10')).toThrow(/Illegal function call/)
  })

  it('Hit Bob Check and Hit Spr Check test an object against the zones', () => {
    // "x=Hit Bob Check(START To END,DX,DY,BOB)" — dx and dy "give a
    // displacement in opposite to the bob's hot spot", so they are
    // subtracted from the bob's position and added to the sprite's
    const src = [
      'Ink 5 : Bar 0,0 To 7,7 : Get Bob 1,0,0 To 8,8 : Cls 0', // a bob image to place
      'Reserve Check 2',
      'Set Check 0,10,10 To 50,50',
      'Bob 1,30,30,1',
      'Sprite 8,30,30,1',
      'Print Hit Bob Check(0 To 1,0,0,1);Hit Bob Check(0 To 1,100,100,1)',
      'Print Hit Spr Check(0 To 1,0,0,8);Hit Spr Check(0 To 1,100,100,8)',
    ]
    expect(run(src.join('\n')).out).toBe(' 1 0\n 1 0\n')
  })

  it('Set Check normalises a rectangle given the other way round', () => {
    const { out } = run(['Reserve Check 1', 'Set Check 0,50,50 To 10,10', 'Print Check(0 To 0,20,20)'].join('\n'))
    expect(out).toBe(' 1\n')
  })
})

/**
 * Vector objects, from Turbo_Object_doc.asc — the 1.9 release documents this
 * area properly where the 2.15 manual does not mention it at all — and from
 * routines 315, 326-333 and 34-40 of the 2.15 binary. The error messages are
 * the library's own table at $6e44.
 */
describe('TURBO objects: the limit (Turbo_Object_doc.asc + disassembly)', () => {
  it('nothing can be reserved before the limit is set', () => {
    // "You MUST set the limit before you can reserve and define the
    // objects." The routine compares against a limit of 0, so every object
    // number is over it.
    expect(() => run('Reserve Object 1,4')).toThrow(/Object count exceeds object limit/)
    expect(() => run('Object Limit 8 : Reserve Object 9,4')).toThrow(/Object count exceeds object limit/)
  })

  it('the limit is set once, capped at 32000, and cleared with zero', () => {
    // "You can define upto 32.000 objects" — cmp.l #$7d00
    expect(() => run('Object Limit 8 : Object Limit 8')).toThrow(/Limit allready set/)
    expect(() => run('Object Limit 32001')).toThrow(/Limit should be max : 32000/)
    expect(() => run('Object Limit 0')).toThrow(/Limit allready cleared/)
    // cleared, then settable again
    const { rt } = run('Object Limit 8 : Object Limit 0 : Object Limit 3')
    expect(rt.turbo.objects.limit).toBe(3)
  })

  it('the limit will not clear while an object is still defined', () => {
    expect(() => run('Object Limit 4 : Reserve Object 1,2 : Object Limit 0')).toThrow(/Some objects still defined/)
    const { rt } = run('Object Limit 4 : Reserve Object 1,2 : Object Erase 1 : Object Limit 0')
    expect(rt.turbo.objects.limit).toBe(0)
  })

  it('Reserve Object takes COUNT*6 bytes and refuses to do it twice', () => {
    // "reserves COUNT*6 bytes CHIP memory for object OBJECT"
    const { rt } = run('Object Limit 4 : Reserve Object 2,10')
    expect(rt.turbo.objects.els[1]?.length).toBe(30) // 10 elements, 3 words each
    expect(rt.turbo.objects.counts[1]).toBe(10)
    expect(() => run('Object Limit 4 : Reserve Object 2,10 : Reserve Object 2,4')).toThrow(/Object is allready defined/)
    expect(() => run('Object Limit 4 : Reserve Object 2,0')).toThrow(/Illegal function call/)
  })
})

describe('TURBO objects: defining (Turbo_Object_doc.asc + disassembly)', () => {
  const shape = [
    'Object Limit 4',
    'Reserve Object 1,4',
    'Define Move 1,1 To 10,10',
    'Define Draw 1,2 To 20,10',
    'Define Draw 1,3 To 20,20',
    'Define Stop 1,4',
  ]

  it('a vector list is three words an element: type, then the pair', () => {
    const { rt } = run(shape.join('\n'))
    // Move is -1, Draw 0, Stop 1, Attr 2 — the type words the four Define
    // routines write (routines 331, 332, 330, 329)
    expect([...rt.turbo.objects.els[0]!]).toEqual([-1, 10, 10, 0, 20, 10, 0, 20, 20, 1, 0, 0])
  })

  it('Object Draw walks it as Move then Draw, leaving the graphics cursor at the end', () => {
    const { rt } = run([...shape, 'Object Draw 1'].join('\n'))
    const s = rt.screen
    expect(s.point(15, 10)).toBe(s.ink) // along the first Draw
    expect(s.point(20, 15)).toBe(s.ink) // along the second
    expect(s.point(15, 15)).toBe(1) // the Move left no trail: still paper
    expect([s.grX, s.grY]).toEqual([20, 20])
  })

  it('an element past the reserved count names the keyword that overran', () => {
    // three routines, three messages, and Define Stop borrows Define Move's
    const base = 'Object Limit 4 : Reserve Object 1,2 : '
    expect(() => run(`${base}Define Draw 1,3 To 0,0`)).toThrow(/Too many draws in object/)
    expect(() => run(`${base}Define Move 1,3 To 0,0`)).toThrow(/Too many moves in object/)
    expect(() => run(`${base}Define Attr 1,3 To 0,0`)).toThrow(/Too many attributes in object/)
    expect(() => run(`${base}Define Stop 1,3`)).toThrow(/Too many moves in object/)
  })

  it('Define Attr sets colour and drawing mode, and they outlive the draw', () => {
    // SetAPen then SetDrMd on the screen's own RastPort
    const { rt } = run(
      [
        'Object Limit 1',
        'Reserve Object 1,4',
        'Define Move 1,1 To 5,5',
        'Define Attr 1,2 To 3,2',
        'Define Draw 1,3 To 15,5',
        'Define Stop 1,4',
        'Ink 1',
        'Object Draw 1',
      ].join('\n'),
    )
    // colour 3 in mode 2 is COMPLEMENT, so the line is drawn as an xor
    // against the default paper of 1 — which is what proves the drawing
    // mode took effect during the walk and not merely after it
    expect(rt.screen.point(10, 5)).toBe(1 ^ 3)
    expect(rt.screen.ink).toBe(3)
    expect(rt.screen.grMode).toBe(2)
  })

  it('Object Erase frees the object but leaves its count behind', () => {
    // routine 328 clears the pointer and never touches the count array, so
    // the count check still fires first on the next Define
    const base = 'Object Limit 4 : Reserve Object 1,2 : Object Erase 1 : '
    expect(() => run(`${base}Define Draw 1,3 To 0,0`)).toThrow(/Too many draws in object/)
    expect(() => run(`${base}Define Draw 1,2 To 0,0`)).toThrow(/Object is not defined/)
    expect(() => run('Object Limit 4 : Object Erase 1')).toThrow(/Object is not defined/)
  })

  it('Object Erase with a negative number erases everything, quietly', () => {
    // "If OBJECT is negative, ALL object definitions are erased!"
    const { rt } = run('Object Limit 4 : Reserve Object 1,2 : Reserve Object 3,2 : Object Erase -1')
    expect(rt.turbo.objects.els.every((p) => p === null)).toBe(true)
    // and with nothing defined at all it is still not an error
    expect(() => run('Object Limit 4 : Object Erase -1')).not.toThrow()
  })
})

describe('TURBO objects: the drawing variants (Turbo_Object_doc.asc + disassembly)', () => {
  const box = [
    'Object Limit 2',
    'Reserve Object 1,4',
    'Define Move 1,1 To 0,0',
    'Define Draw 1,2 To 10,0',
    'Define Draw 1,3 To 10,10',
    'Define Stop 1,4',
  ]

  it('R Object Draw offsets every coordinate', () => {
    // "Draws object OBJECT as defined in the vector table but relative to
    // the X and Y coordinates."
    const { rt } = run([...box, 'R Object Draw 1,100,50'].join('\n'))
    expect(rt.screen.point(105, 50)).toBe(rt.screen.ink)
    expect([rt.screen.grX, rt.screen.grY]).toEqual([110, 60])
  })

  it('Object Mag Draw multiplies, and a negative factor divides', () => {
    // "If you give a negative MUL factor the OBJECT coordinates are divided
    // by factor MUL."
    const big = run([...box, 'Object Mag Draw 1,3'].join('\n'))
    expect([big.rt.screen.grX, big.rt.screen.grY]).toEqual([30, 30])
    const small = run([...box, 'Object Mag Draw 1,-2'].join('\n'))
    expect([small.rt.screen.grX, small.rt.screen.grY]).toEqual([5, 5])
    // muls.w by zero is still the multiply path: the object collapses
    const flat = run([...box, 'Object Mag Draw 1,0'].join('\n'))
    expect([flat.rt.screen.grX, flat.rt.screen.grY]).toEqual([0, 0])
  })

  it('R Object Mag Draw scales first and offsets second', () => {
    // muls.w then add.w, in that order (routine 37, $14be)
    const { rt } = run([...box, 'R Object Mag Draw 1,100,50,2'].join('\n'))
    expect([rt.screen.grX, rt.screen.grY]).toEqual([120, 70])
  })

  it('drawing an object that is not there says so', () => {
    expect(() => run('Object Limit 2 : Object Draw 1')).toThrow(/Object is not defined/)
    expect(() => run('Object Limit 2 : Object Draw 3')).toThrow(/Object count exceeds object limit/)
    expect(() => run('Object Limit 2 : Object Draw 0')).toThrow(/Illegal function call/)
  })
})

describe('TURBO objects: files (Turbo_Object_doc.asc + disassembly)', () => {
  const two = [
    'Object Limit 8',
    'Reserve Object 1,2',
    'Define Draw 1,1 To 7,8',
    'Define Stop 1,2',
    'Reserve Object 2,2',
    'Define Move 2,1 To 1,2',
    'Define Stop 2,2',
  ]

  it('Object Save writes the OBJE header and a count word per object', () => {
    // "It also writes the header "OBJE" at the beginning of the file."
    const { fs } = run([...two, 'Object Save "DH0:o.obj",1 To 2'].join('\n'))
    const bytes = fs.read('DH0:o.obj')!
    expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe('OBJE')
    expect(bytes[5]).toBe(1) // END-START, one less than the object count
    expect(bytes.length).toBe(6 + 2 * (2 + 2 * 6))
  })

  it('Object Load defines the objects it finds from START onwards', () => {
    // "Object Load "DF1:OBJECT1_TO_4",5 — This will define and load object
    // 5 to 8."
    const { rt } = run([...two, 'Object Save "DH0:o.obj",1 To 2', 'Object Load "DH0:o.obj",5'].join('\n'))
    const t = rt.turbo.objects
    expect([...t.els[4]!]).toEqual([0, 7, 8, 1, 0, 0])
    expect([...t.els[5]!]).toEqual([-1, 1, 2, 1, 0, 0])
    expect(t.counts[4]).toBe(2)
  })

  it('loading onto a defined object stops without a word, as documented', () => {
    // "Object Load "DF1:OBJECT1_TO_4",2 will not work. First you must
    // discard objects 2 to 5 !!!!!"
    const { rt } = run([...two, 'Object Save "DH0:o.obj",1 To 2', 'Object Load "DH0:o.obj",2'].join('\n'))
    // object 2 was already defined, so nothing is loaded and nothing said
    expect([...rt.turbo.objects.els[1]!]).toEqual([-1, 1, 2, 1, 0, 0])
    expect(rt.turbo.objects.els[2]).toBe(null)
  })

  it('a file that is not an object file is refused, and the limit is checked', () => {
    expect(() =>
      run(['Object Limit 8', 'Open Out 1,"DH0:junk"', 'Print #1,"not an object file"', 'Close 1', 'Object Load "DH0:junk",1'].join('\n')),
    ).toThrow(/This is not an object file/)
    expect(() => run([...two, 'Object Save "DH0:o.obj",1 To 2', 'Object Load "DH0:o.obj",8'].join('\n'))).toThrow(
      /Object count exceeds object limit/,
    )
  })

  it('a name over 80 characters is a string error, whatever the manual says', () => {
    // "If "NAME" > 80 chars nothing will happen..." — but the routine ends
    // in moveq #$15 (AMOS error 21)
    expect(() => run(`Object Limit 2 : Object Load "${'x'.repeat(81)}",1`)).toThrow(/String too long/)
  })
})

describe('TURBO 1.9 chip and fast objects (Turbo_Object_doc.asc)', () => {
  // 1.9 splits Reserve Object by memory type and renames Object Load; the
  // routines are otherwise the ones 2.15 keeps under the shorter names
  const t19 = new Map([
    ...[...EXTENSION_TOKENS].map(([slot, defs]) => [slot, new TokenTable(defs)] as const),
    [TURBO_SLOT, extensionById('turbo-plus-1.9')!.table] as const,
  ])

  function run19(src: string): Runtime {
    const fs = new AmigaFS()
    fs.mountMemory('DH0')
    fs.currentDir = 'DH0:'
    const rt = new Runtime(tokenize(src, table, t19), table, { maxSteps: 200_000, extensions: t19, fs })
    rt.runHeadless(2_000)
    return rt
  }

  it('Reserve Object Chip and Fast share one object table', () => {
    const rt = run19('Object Limit 4 : Reserve Object Chip 1,2 : Reserve Object Fast 2,3')
    expect(rt.turbo.objects.els[0]?.length).toBe(6)
    expect(rt.turbo.objects.els[1]?.length).toBe(9)
  })

  it('F Stars is 2.15 Stars Draw under its older name', () => {
    // routine 57 either way: plot without advancing
    const rt = run19('Cls 0 : Reserve Stars 1 : Define Star 1,20,30,5,5 : F Stars')
    expect(rt.screen.point(20, 30) & 1).toBe(1)
    expect([...rt.turbo.stars.data.slice(0, 2)]).toEqual([20, 30])
  })

  it('Object Load Chip reads what 2.15 wrote', () => {
    const rt = run19(
      [
        'Object Limit 4',
        'Reserve Object Chip 1,2',
        'Define Draw 1,1 To 3,4',
        'Define Stop 1,2',
        'Object Save "DH0:c.obj",1 To 1',
        'Object Load Chip "DH0:c.obj",2',
      ].join('\n'),
    )
    expect([...rt.turbo.objects.els[1]!]).toEqual([0, 3, 4, 1, 0, 0])
  })
})

/**
 * Starfields, from Turbo_Stars_doc.asc and routines 318-323 and 52-59. The
 * star record is four words — X, Y, X SPEED, Y SPEED — which is the manual's
 * "COUNT*8" bytes.
 */
describe('TURBO stars: reserving and defining (Turbo_Stars_doc.asc + disassembly)', () => {
  it('Reserve Stars takes up to 4000 and only once', () => {
    // "At this point you can reserve memory for 4000 'STARS'" — cmp.w #$fa1
    const { rt } = run('Reserve Stars 4000')
    expect(rt.turbo.stars.count).toBe(4000)
    expect(rt.turbo.stars.data.length).toBe(4000 * 4)
    expect(() => run('Reserve Stars 4001')).toThrow(/Illegal function call/)
    expect(() => run('Reserve Stars 0')).toThrow(/Illegal function call/)
    expect(() => run('Reserve Stars 10 : Reserve Stars 10')).toThrow(/Stars allready reserved/)
  })

  it('the clip rectangle starts as the whole screen it was reserved on', () => {
    const { rt } = run('Reserve Stars 4')
    expect(rt.turbo.stars.clip).toEqual({ x1: 0, y1: 0, x2: 319, y2: 199 })
  })

  it('Define Star stores four words and refuses negative coordinates', () => {
    // "X and Y are the initial coordinates... X SPEED and Y SPEED define the
    // speed of the 'STAR'. So your 'STARS' can fly in any direction!"
    const { rt } = run('Reserve Stars 2 : Define Star 2,10,20,-1,3')
    expect([...rt.turbo.stars.data.slice(4, 8)]).toEqual([10, 20, -1, 3])
    expect(() => run('Reserve Stars 2 : Define Star 1,-1,0,0,0')).toThrow(/Illegal function call/)
    expect(() => run('Reserve Stars 2 : Define Star 3,0,0,0,0')).toThrow(/Illegal function call/)
    expect(() => run('Define Star 1,0,0,0,0')).toThrow(/Stars not reserved/)
  })

  it('Stars Erase gives the memory back, quietly even if there is none', () => {
    expect(() => run('Stars Erase')).not.toThrow()
    const { rt } = run('Reserve Stars 4 : Stars Erase')
    expect(rt.turbo.stars.count).toBe(0)
    // and the display keywords go through Rbeq routine 62, not error 9
    expect(() => run('Reserve Stars 4 : Stars Erase : Display Stars')).toThrow(/Illegal function call/)
  })
})

describe('TURBO stars: display (Turbo_Stars_doc.asc + disassembly)', () => {
  it('Display Stars plots where the star is, then moves it', () => {
    // Cls 0 first: the default paper is colour 1, which has bit 0 set
    const { rt } = run('Cls 0 : Reserve Stars 1 : Define Star 1,50,60,1,2 : Display Stars')
    expect(rt.screen.point(50, 60) & 1).toBe(1)
    expect([...rt.turbo.stars.data.slice(0, 2)]).toEqual([51, 62])
    expect(rt.screen.point(51, 62) & 1).toBe(0) // not yet drawn there
  })

  it('a star only ever sets the first bitplane', () => {
    // "I use only 1 bitplane (the first one), so only 1 coloured 'STARS' are
    // possible" — a bset, so colour 2 underneath becomes 3, not 1
    const { rt } = run(
      ['Ink 2', 'Bar 40,40 To 60,60', 'Reserve Stars 1', 'Define Star 1,50,50,0,0', 'Display Stars'].join('\n'),
    )
    expect(rt.screen.point(50, 50)).toBe(3)
  })

  it('Stars Draw plots without moving anything', () => {
    // "Displays the 'STARS' onto the screen without computing the next 'STAR'
    // position. So your 'STARS' can be freezed"
    const { rt } = run('Reserve Stars 1 : Define Star 1,50,60,1,2 : Stars Draw : Stars Draw')
    expect(rt.screen.point(50, 60) & 1).toBe(1)
    expect([...rt.turbo.stars.data.slice(0, 2)]).toEqual([50, 60])
  })

  it('Stars Compute moves the range it is given and draws nothing', () => {
    const { rt } = run(
      [
        'Cls 0',
        'Reserve Stars 3',
        'Define Star 1,10,10,1,0',
        'Define Star 2,20,20,1,0',
        'Define Star 3,30,30,1,0',
        'Stars Compute 1 To 2',
      ].join('\n'),
    )
    const d = rt.turbo.stars.data
    expect([d[0], d[4], d[8]]).toEqual([11, 21, 30])
    expect(rt.screen.point(10, 10) & 1).toBe(0)
    expect(() => run('Reserve Stars 2 : Stars Compute 1 To 3')).toThrow(/Illegal function call/)
  })

  it('Stars Speed changes a range, and will not take a range of one', () => {
    // `cmp.w d1,d2 : Rble routine 62` — END must be strictly above START
    const { rt } = run(
      ['Reserve Stars 3', 'Define Star 1,0,0,9,9', 'Define Star 2,0,0,9,9', 'Stars Speed 1 To 2,4,5'].join('\n'),
    )
    expect([...rt.turbo.stars.data.slice(2, 4)]).toEqual([4, 5])
    expect([...rt.turbo.stars.data.slice(6, 8)]).toEqual([4, 5])
    expect(() => run('Reserve Stars 3 : Stars Speed 2 To 2,1,1')).toThrow(/Illegal function call/)
  })
})

describe('TURBO stars: clipping (Turbo_Stars_doc.asc + disassembly)', () => {
  it('Stars Clip clamps the far corner and refuses a backwards rectangle', () => {
    const { rt } = run('Reserve Stars 1 : Stars Clip 10,20,999,999')
    expect(rt.turbo.stars.clip).toEqual({ x1: 10, y1: 20, x2: 319, y2: 199 })
    expect(() => run('Reserve Stars 1 : Stars Clip 10,10,10,50')).toThrow(/Illegal function call/)
    expect(() => run('Reserve Stars 1 : Stars Clip -1,0,10,10')).toThrow(/Illegal function call/)
  })

  it('a star past the right edge wraps by the width of the region', () => {
    const { rt } = run('Reserve Stars 1 : Stars Clip 0,0,100,100 : Define Star 1,99,0,2,0 : Display Stars')
    expect(rt.turbo.stars.data[0]).toBe(1) // 101 - 100
  })

  it('two stars wrapping left in one pass land in different columns', () => {
    // The wrap-left path is `adda.w d5,a3`: it folds the overshoot into the
    // register holding the right edge and leaves it there, so the second
    // star to wrap in a pass goes one column further left than the first.
    // "somethimes you don't get what you want!", as the manual has it.
    const { rt } = run(
      [
        'Reserve Stars 2',
        'Stars Clip 0,0,100,100',
        'Define Star 1,0,50,-1,0',
        'Define Star 2,0,50,-1,0',
        'Display Stars',
      ].join('\n'),
    )
    expect([rt.turbo.stars.data[0], rt.turbo.stars.data[4]]).toEqual([99, 98])
    // and the damage lasts one pass only: the edge is reloaded each call
    const again = run(
      ['Reserve Stars 1', 'Stars Clip 0,0,100,100', 'Define Star 1,0,50,-1,0', 'Display Stars', 'Display Stars'].join(
        '\n',
      ),
    )
    expect(again.rt.turbo.stars.data[0]).toBe(98) // 99 the first pass, 98 the next
  })
})

describe('TURBO stars: the interrupt (Turbo_Stars_doc.asc + disassembly)', () => {
  it('Stars Int On installs once and needs stars to install', () => {
    expect(() => run('Stars Int On 0')).toThrow(/Stars not reserved/)
    expect(() => run('Reserve Stars 2 : Stars Int On 0 : Stars Int On 0')).toThrow(/Stars int allready on/)
    const { rt } = run('Reserve Stars 2 : Stars Int On 1 : Stars Int Off')
    expect(rt.turbo.stars.int).toBe(false)
    expect(() => run('Stars Int Off')).not.toThrow()
  })

  it('the server runs every frame and moves the stars in X only', () => {
    // "Only the X-speed is changed (for more speed)."
    const { rt } = run('Reserve Stars 1 : Define Star 1,10,10,1,1 : Stars Int On 0 : Wait 5')
    const d = rt.turbo.stars.data
    expect(d[0]).toBeGreaterThan(10)
    expect(d[1]).toBe(10) // the Y speed is ignored by the server
    expect(rt.screen.point(10, 10) & 1).toBe(1)
  })

  it('the automatic clear mode wipes the starfield plane and nothing else', () => {
    // "Only the 'STARFIELD PLANE' is cleared, this is the first bitplane."
    const { rt } = run(
      [
        'Ink 2 : Bar 0,0 To 100,100', // colour 2 lives in the second plane
        'Reserve Stars 1',
        'Define Star 1,50,50,1,0',
        'Stars Int On 1',
        'Wait 5',
      ].join('\n'),
    )
    expect(rt.screen.point(10, 10)).toBe(2) // the bar survives
    // the star's earlier positions were cleared, only the newest one is lit
    const lit = []
    for (let x = 50; x < 60; x++) if (rt.screen.point(x, 50) & 1) lit.push(x)
    expect(lit.length).toBe(1)
  })
})

describe('TURBO timing (TURBO_DocsV2.15.Asc + disassembly)', () => {
  it('Vbl Wait waits, and does not hang on any line value', () => {
    // The routine busy-waits on the low byte of VHPOSR ($dff006), which is
    // sub-frame beam racing; against a compositor that draws once a frame
    // there is no beam to race, so this waits a frame. See the NOTES entry.
    const { rt } = run('Vbl Wait 101 : Vbl Wait 0 : Vbl Wait 255')
    expect(rt.interp.done).toBe(true)
  })
})
