import { describe, expect, it } from 'vitest'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { EXTENSION_TOKENS, extensionById } from '../ext/registry'
import { Runtime } from './runtime'
import { AmigaFS } from '../amiga/vfs'
import { getPixel } from '../amiga/planar'

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

function run(src: string, files: Record<string, number[]> = {}): { out: string; rt: Runtime; fs: AmigaFS } {
  let out = ''
  const fs = new AmigaFS()
  fs.mountMemory('DH0')
  fs.currentDir = 'DH0:'
  for (const [name, bytes] of Object.entries(files)) fs.writeFile(`DH0:${name}`, Uint8Array.from(bytes))
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

  it('Amos Pri IGNORES a value outside the documented range', () => {
    // "Value ranges from -128 to 20" — and routine 125 ($4600) branches to
    // its own rts when either bound fails, so an out-of-range value neither
    // clamps nor raises. It simply does not happen.
    expect(run('Amos Pri 5').rt.turbo.priority).toBe(5)
    expect(run('Amos Pri 5 : Amos Pri 100').rt.turbo.priority).toBe(5)
    expect(run('Amos Pri 5 : Amos Pri -200').rt.turbo.priority).toBe(5)
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
  //
  // Zones are numbered from ONE, not zero. The docs do not say so outright,
  // but Set Check "does the same thing as the Set Zone command" and core
  // AMOS numbers zones 1..n. The extension author's own Hit_SprZone demo
  // settles it: `Reserve Check 650` followed by Set Check for zones 1 to 650
  // inclusive, which only fits if n zones are numbered 1..n.
  const setup = ['Reserve Check 4', 'Set Check 1,10,10 To 50,50', 'Set Check 2,100,100 To 120,120']

  it('Check reports 1 inside a zone and 0 outside — not AMOS truth', () => {
    // "Returns 1 is the result is true, 0 if not" — note 1, not -1
    const { out } = run(
      [...setup, 'Print Check(1 To 4,20,20)', 'Print Check(1 To 4,200,200)', 'Print Check(1 To 4,110,110)'].join('\n'),
    )
    expect(out).toBe(' 1\n 0\n 1\n')
  })

  it('the start/end range excludes zones outside it', () => {
    // "The START and END parameters indicate which zones you want to check.
    // Ideal if there are many zones and you want to exclude some zones."
    const { out } = run([...setup, 'Print Check(1 To 1,110,110)', 'Print Check(2 To 2,110,110)'].join('\n'))
    expect(out).toBe(' 0\n 1\n')
  })

  it('the last reserved zone is usable — Reserve Check 4 gives 1..4', () => {
    // the off-by-one this file used to encode: zone 4 of 4 read past the end
    // and answered "Illegal function call"
    const { out } = run(['Reserve Check 4', 'Set Check 4,10,10 To 50,50', 'Print Check(1 To 4,20,20)'].join('\n'))
    expect(out).toBe(' 1\n')
  })

  it('Reset Check erases one definition, Check Erase all of them', () => {
    const { out } = run(
      [...setup, 'Reset Check 1', 'Print Check(1 To 4,20,20)', 'Check Erase', 'Print Check(1 To 4,110,110)'].join('\n'),
    )
    expect(out).toBe(' 0\n 0\n')
  })

  it('Set Check without reserving first is an error', () => {
    // "Execute this command before Setting any Check zones."
    expect(() => run('Set Check 1,0,0 To 10,10')).toThrow(/Illegal function call/)
  })

  it('Hit Bob Check and Hit Spr Check test an object against the zones', () => {
    // "x=Hit Bob Check(START To END,DX,DY,BOB)" — dx and dy "give a
    // displacement in opposite to the bob's hot spot", so they are
    // subtracted from the bob's position and added to the sprite's
    const src = [
      'Ink 5 : Bar 0,0 To 7,7 : Get Bob 1,0,0 To 8,8 : Cls 0', // a bob image to place
      'Reserve Check 2',
      'Set Check 1,10,10 To 50,50',
      'Bob 1,30,30,1',
      'Sprite 8,30,30,1',
      'Print Hit Bob Check(1 To 2,0,0,1);Hit Bob Check(1 To 2,100,100,1)',
      'Print Hit Spr Check(1 To 2,0,0,8);Hit Spr Check(1 To 2,100,100,8)',
    ]
    expect(run(src.join('\n')).out).toBe(' 1 0\n 1 0\n')
  })

  it('Set Check normalises a rectangle given the other way round', () => {
    const { out } = run(['Reserve Check 1', 'Set Check 1,50,50 To 10,10', 'Print Check(1 To 1,20,20)'].join('\n'))
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

/**
 * Scrolling zones, from the 2.15 manual and routines 313, 317, 324, 325,
 * 43-48 and 141-146. A horizontal scroll is a barrel-shift of the region
 * through blitter channels A and D; a vertical one is a plain copy.
 */
describe('TURBO blitter scrolling (TURBO_DocsV2.15.Asc + disassembly)', () => {
  // a column of pixels to watch the scroll move
  const mark = ['Cls 0', 'Ink 1', 'Bar 32,10 To 47,20']

  it('Blit Left shifts the region right, blanking what it leaves behind', () => {
    // "If SHIFT is positive the zone will be shifted to the right."
    const { rt } = run([...mark, 'Blit Left 0,0,0 To 320,200,4'].join('\n'))
    expect(rt.screen.point(36, 15)).toBe(1) // 32+4
    expect(rt.screen.point(51, 15)).toBe(1) // 47+4
    expect(rt.screen.point(35, 15)).toBe(0) // vacated
    expect(rt.screen.point(52, 15)).toBe(0)
  })

  it('a negative shift scrolls left', () => {
    const { rt } = run([...mark, 'Blit Left 0,0,0 To 320,200,-4'].join('\n'))
    expect(rt.screen.point(28, 15)).toBe(1)
    expect(rt.screen.point(43, 15)).toBe(1)
    expect(rt.screen.point(44, 15)).toBe(0)
  })

  it('x and x1 are chopped to a 16-pixel boundary', () => {
    // "The routine automatically chops the X and X1 values so that they
    // always lie on a 16 bit boundary. Ex.: 198 will become 196" — which is
    // to say the low four bits are cleared, so 198 becomes 192
    const { rt } = run(['Cls 0', 'Blit Store Left 0,1,198,0 To 307,100,2'].join('\n'))
    const d = rt.turbo.blits[0]!
    expect([d.x0, d.x1]).toEqual([192, 304])
  })

  it('the region is refused when it is empty or off the screen', () => {
    expect(() => run('Blit Left 0,10,10 To 10,50,2')).toThrow(/Illegal function call/)
    expect(() => run('Blit Left 0,0,50 To 100,50,2')).toThrow(/Illegal function call/)
    expect(() => run('Blit Left 0,0,0 To 100,500,2')).toThrow(/Illegal function call/)
    expect(() => run('Blit Left 0,0,0 To 100,100,0')).toThrow(/Illegal function call/)
  })

  it('Multi Blit runs the stored zones and skips the empty slots', () => {
    const { rt } = run(
      [...mark, 'Blit Store Left 0,1,0,0 To 320,200,4', 'Blit Store Left 0,3,0,0 To 320,200,4', 'Multi Blit 1 To 3'].join(
        '\n',
      ),
    )
    // zones 1 and 3 both scroll the same region, so the mark moves twice
    expect(rt.screen.point(40, 15)).toBe(1) // 32 + 4 + 4
    expect(rt.screen.point(39, 15)).toBe(0)
    expect(() => run('Multi Blit 2 To 1')).toThrow(/Illegal function call/)
    expect(() => run('Multi Blit 1 To 97')).toThrow(/Illegal function call/)
  })

  it('a zone number is 1 to 96 and can only be defined once', () => {
    expect(() => run('Blit Store Left 0,97,0,0 To 100,100,1')).toThrow(/Illegal function call/)
    expect(() =>
      run('Blit Store Left 0,1,0,0 To 100,100,1 : Blit Store Left 0,1,0,0 To 100,100,1'),
    ).toThrow(/Blit store allready defined/)
    // erased, and then definable again
    const { rt } = run(
      ['Blit Store Left 0,1,0,0 To 100,100,1', 'Blit Erase 1', 'Blit Store Left 0,1,0,0 To 100,100,2'].join('\n'),
    )
    expect(rt.turbo.blits[0]?.shift).toBe(2)
    // "If blitnr is negative, ALL blit definitions are erased"
    const all = run(['Blit Store Left 0,1,0,0 To 100,100,1', 'Blit Store Left 0,2,0,0 To 100,100,1', 'Blit Erase -1'].join('\n'))
    expect(all.rt.turbo.blits.every((b) => b === null)).toBe(true)
  })

  it('Blit Speed changes the shift only when its own test happens to pass', () => {
    // The routine picks its branch with `btst #0` then `btst #15` on the
    // stored word masks, which are $ff<<shift for a right scroll. A shift
    // below 8 sets neither bit, so nothing at all happens — the documented
    // behaviour ("you can change the SHIFT value after you have defined a
    // scrolling zone") only works from 8 up.
    const low = run(['Blit Store Left 0,1,0,0 To 100,100,2', 'Blit Speed 1,5'].join('\n'))
    expect(low.rt.turbo.blits[0]?.shift).toBe(2) // unchanged
    const high = run(['Blit Store Left 0,1,0,0 To 100,100,8', 'Blit Speed 1,5'].join('\n'))
    expect(high.rt.turbo.blits[0]?.shift).toBe(5)
    // a Blit Store Up zone keeps its mask at $ff, so bit 0 is set and the
    // change goes through — as a horizontal shift on a vertical scroll
    const up = run(['Blit Store Up 0,1,0,0 To 100,100,5', 'Blit Speed 1,3'].join('\n'))
    expect(up.rt.turbo.blits[0]?.shift).toBe(3)
    expect(() => run('Blit Speed 1,2')).toThrow(/Blit store not defined/)
  })

  it('Blit Store Up moves the region, clamping the destination to the screen', () => {
    // The manual writes the clamp out in BASIC and warns: "Blit Store Up
    // 0,1,0,5 To 320,100,-50 ... Huh??? The screen isn't scrolling 50 pixels
    // up! Nope...it's only scrolling 5 pixels up."
    const { rt } = run(
      ['Cls 0', 'Ink 1', 'Bar 32,10 To 47,20', 'Blit Store Up 0,1,0,5 To 320,100,-50', 'Multi Blit 1 To 1'].join('\n'),
    )
    expect(rt.turbo.blits[0]?.dy).toBe(-5)
    expect(rt.screen.point(40, 5)).toBe(1) // the bar moved up five, not fifty
    expect(rt.screen.point(40, 16)).toBe(0)
  })

  it('Blit Up does the same thing at once, without a definition', () => {
    // routine 145, the immediate vertical scroll — present in the token
    // table and absent from the manual, which never describes it
    const { rt } = run(['Cls 0', 'Ink 1', 'Bar 32,10 To 47,20', 'Blit Up 0,0,0 To 320,100,20'].join('\n'))
    expect(rt.screen.point(40, 35)).toBe(1) // the bar arrived twenty rows down
    // A→D with no C channel is a copy, so what it came from is still there:
    // a vertical scroll leaves a trail unless the program clears behind it
    expect(rt.screen.point(40, 15)).toBe(1)
  })
})

describe('TURBO Set Planes and Blit Clear (TURBO_DocsV2.15.Asc + disassembly)', () => {
  it('Set Planes restricts what a write may touch', () => {
    // "Ex.: Set Planes %101, enables planes 1 and 3." rp_Mask, so it applies
    // to AMOS's own drawing as well as TURBO's
    const { rt } = run(['Cls 0', 'Set Planes %101', 'Ink 7', 'Bar 0,0 To 10,10', 'Set Planes 255'].join('\n'))
    expect(rt.screen.point(5, 5)).toBe(5) // 7 masked to %101
  })

  it('Multi Blit scrolls only the planes the mask allows', () => {
    const { rt } = run(
      [
        'Cls 0',
        'Ink 3 : Bar 32,10 To 47,20', // planes 1 and 2
        'Set Planes %1',
        'Blit Left 0,0,0 To 320,200,4',
        'Set Planes 255',
      ].join('\n'),
    )
    // plane 1 moved, plane 2 stayed: the bar splits into a 2 and a 1
    expect(rt.screen.point(34, 15)).toBe(2)
    expect(rt.screen.point(50, 15)).toBe(1)
  })

  it('Blit Clear takes one bitplane, or all of them with a negative', () => {
    // "If x <0, all bitplanes of a screen will be erased. If x >0, clear
    // bitplane x. An 8 colour screen has 3 bitplanes, numbered 1 -> 3."
    const one = run(['Cls 0', 'Ink 3 : Bar 0,0 To 10,10', 'Blit Clear 1'].join('\n'))
    expect(one.rt.screen.point(5, 5)).toBe(2)
    const all = run(['Cls 0', 'Ink 3 : Bar 0,0 To 10,10', 'Blit Clear -1'].join('\n'))
    expect(all.rt.screen.point(5, 5)).toBe(0)
    expect(() => run('Blit Clear 0')).toThrow(/Illegal function call/)
  })
})

describe('TURBO the blitter interrupt (TURBO_DocsV2.15.Asc + disassembly)', () => {
  it('nothing scrolls until Blit Int Wait is set False', () => {
    // "The scrolling does not begin until Blit Int Wait is set False!"
    const waiting = run(
      ['Cls 0', 'Ink 1 : Bar 32,10 To 47,20', 'Blit Store Left 0,1,0,0 To 320,200,4', 'Blit Int On 1 To 1', 'Wait 5'].join(
        '\n',
      ),
    )
    expect(waiting.rt.screen.point(32, 15)).toBe(1) // never moved
    const going = run(
      [
        'Cls 0',
        'Ink 1 : Bar 32,10 To 47,20',
        'Blit Store Left 0,1,0,0 To 320,200,4',
        'Blit Int On 1 To 1',
        'Blit Int Wait False',
        'Wait 5',
      ].join('\n'),
    )
    expect(going.rt.screen.point(32, 15)).toBe(0) // scrolled away, frame by frame
    expect(going.rt.turbo.blitGo).toBe(1)
  })

  it('Blit Int On installs once; Blit Int Change needs it installed', () => {
    expect(() => run('Blit Int On 1 To 1 : Blit Int On 1 To 1')).toThrow(/Blit int allready on/)
    expect(() => run('Blit Int Change 1 To 2')).toThrow(/Blit int not on/)
    // "This command does not change the Blit Int Wait status."
    const { rt } = run('Blit Int Wait False : Blit Int On 1 To 2 : Blit Int Change 2 To 3 : Blit Int Off')
    expect(rt.turbo.blitInt).toBe(null)
    expect(rt.turbo.blitGo).toBe(1)
  })
})

/**
 * The relative and fast drawing keywords, and 3D — routines 23-27, 41, 42,
 * 49, 51, 61, 65 and 70, documented in both manuals.
 */
describe('TURBO relative drawing (Turbo_Graph_doc.asc + disassembly)', () => {
  it('R Move and R Home put the graphics cursor where they say', () => {
    // "Gr Locate 10,10 : R Move 5,-5 : Rem graphics cursor is now at 15,5"
    const { rt } = run('Gr Locate 10,10 : R Move 5,-5')
    expect([rt.screen.grX, rt.screen.grY]).toEqual([15, 5])
    // R Home is undocumented and, despite the R, absolute: routine 26
    // writes both cursor words outright
    const home = run('Gr Locate 10,10 : R Home 40,50')
    expect([home.rt.screen.grX, home.rt.screen.grY]).toEqual([40, 50])
  })

  it('R Draw leaves the cursor at the end of the line, R Box and R Bar do not', () => {
    const d = run('Cls 0 : Gr Locate 10,10 : R Draw 20,0')
    expect(d.rt.screen.point(20, 10)).toBe(d.rt.screen.ink)
    expect([d.rt.screen.grX, d.rt.screen.grY]).toEqual([30, 10])
    const b = run('Cls 0 : Gr Locate 10,10 : R Box 20,10')
    expect(b.rt.screen.point(30, 15)).toBe(b.rt.screen.ink) // the right side
    expect(b.rt.screen.point(20, 10)).toBe(b.rt.screen.ink) // the top
    expect(b.rt.screen.point(20, 12)).toBe(0) // hollow
    expect([b.rt.screen.grX, b.rt.screen.grY]).toEqual([10, 10])
    const f = run('Cls 0 : Gr Locate 10,10 : R Bar 20,10')
    expect(f.rt.screen.point(20, 12)).toBe(f.rt.screen.ink) // filled
    expect([f.rt.screen.grX, f.rt.screen.grY]).toEqual([10, 10])
    // two Rbmi: neither delta may be negative
    expect(() => run('R Bar -1,10')).toThrow(/Illegal function call/)
  })
})

describe('TURBO fast drawing (Turbo_Graph_doc.asc + disassembly)', () => {
  it('F Plot takes its colour as an argument and drops what is off screen', () => {
    // "you must give the COLOUR parameter"
    const { rt } = run('Cls 0 : F Plot 10,10,5 : F Plot -1,10,5 : F Plot 10,999,5')
    expect(rt.screen.point(10, 10)).toBe(5)
    expect(rt.screen.point(10, 199)).toBe(0)
  })

  it('F Point reads a pixel back, and -1 from off the screen', () => {
    const { out } = run('Cls 0 : F Plot 10,10,7 : Print F Point(10,10);F Point(11,10);F Point(-5,0)')
    expect(out).toBe(' 7 0-1\n')
  })

  it('the fast keywords ignore the plane mask and the line pattern', () => {
    // "TURBO commands where the mask is not recognized: F Draw, F Plot,
    // F point, F Circle" — and "The Set Line MASK command has no effect
    // when using F Draw"
    const { rt } = run(
      ['Cls 0', 'Set Planes %1', 'F Plot 10,10,6', 'Set Line %1010101010101010', 'Ink 3', 'F Draw 20,20 To 40,20', 'Set Planes 255'].join(
        '\n',
      ),
    )
    expect(rt.screen.point(10, 10)).toBe(6) // written whole, mask or no mask
    for (let x = 20; x <= 40; x++) expect(rt.screen.point(x, 20)).toBe(3) // solid
  })

  it('F Draw only has the To form, whatever the manual says', () => {
    // The token spec is I0,0t0,0 in 1.0, 1.9 and 2.15 alike, so the "F Draw
    // X,Y" the manual describes cannot be written
    expect(() => run('F Draw 10,10')).toThrow()
  })

  it('F Sqr rounds up one step early, at every n*n+n', () => {
    // routine 65 ends `cmp.l d1,d0 : blt : addq.l #1,d1` — it rounds up when
    // what is left over REACHES the root, where rounding to nearest wants
    // it to exceed it. So F Sqr(0) is 1, F Sqr(2) is 2, F Sqr(6) is 3.
    const { out } = run('For I=0 To 9 : Print F Sqr(I); : Next I')
    expect(out).toBe(' 1 1 2 2 2 2 3 3 3 3') // trailing ; so no newline
    // away from that boundary it is an ordinary integer square root
    expect(run('Print F Sqr(1000000);F Sqr(123456789)').out).toBe(' 1000 11111\n')
  })

  it('F Circle draws a circle, and stops being one above radius 180', () => {
    // "There is a known bug in this command, do not use a radius above
    // 180...there will be no crash, but the result is definitely not a
    // circle!" — the y for each column comes from a WORD square root, and
    // r*r stops fitting in sixteen bits at 182.
    const ok = run('Cls 0 : F Circle 160,100,50,4')
    for (const [x, y] of [
      [210, 100],
      [110, 100],
      [160, 50],
      [160, 150],
    ]) {
      expect(ok.rt.screen.point(x!, y!)).toBe(4)
    }
    expect(ok.rt.screen.point(160, 100)).toBe(0) // hollow
    const broken = run('Cls 0 : F Circle 160,100,190,4')
    expect(broken.rt.screen.point(160, 100 - 190)).not.toBe(4) // nowhere near
    expect(() => run('F Circle 10,10,0,1')).toThrow(/Illegal function call/)
  })
})

describe('TURBO 3D (Turbo_Graph_doc.asc + disassembly)', () => {
  it('Line 3d divides by Z with D=128 and offsets by the eye', () => {
    // "our perspective calculations can be simplified to : X=X*D/Z and
    // Y=Y*D/Z... The value I use for D=128" — and the eye starts at 160,100
    const { rt } = run('Cls 0 : Line 3d 10,10,128 To 20,20,128')
    // 10*128/128 + 160 = 170, and the far end at 180,120
    expect(rt.screen.point(170, 110)).toBe(rt.screen.ink)
    expect([rt.screen.grX, rt.screen.grY]).toEqual([180, 120])
  })

  it('a greater Z draws it smaller, and Eye 3d moves the vanishing point', () => {
    // "So the greater the value of 'Z' the further away the object"
    const far = run('Cls 0 : Line 3d 100,0,256 To 100,0,256')
    expect(far.rt.screen.grX).toBe(210) // 100*128/256 + 160
    const moved = run('Cls 0 : Eye 3d 0,0 : Line 3d 100,0,256 To 100,0,256')
    expect([moved.rt.screen.grX, moved.rt.screen.grY]).toEqual([50, 0])
  })

  it('a Z of zero is a division by zero, as the routine says', () => {
    expect(() => run('Line 3d 1,1,0 To 2,2,1')).toThrow(/Division by zero/)
    expect(() => run('Line 3d 1,1,1 To 2,2,0')).toThrow(/Division by zero/)
  })
})

/**
 * Bitplanes and blocks, from Turbo_Plane_doc.asc / Turbo_Block_doc.asc and
 * routines 77-81 and 92-96.
 */
describe('TURBO bitplane rearranging (Turbo_Plane_doc.asc + disassembly)', () => {
  it('Plane Swap exchanges two planes, so every pixel swaps those bits', () => {
    // The routine swaps the pointers in all three tables of the screen
    // structure, which means each plane now reads and writes the other's
    // memory — colour 1 becomes colour 2 and back
    const { rt } = run(['Cls 0', 'Ink 1 : Bar 0,0 To 5,5', 'Ink 2 : Bar 10,0 To 15,5', 'Plane Swap 0,1,2'].join('\n'))
    expect(rt.screen.point(2, 2)).toBe(2)
    expect(rt.screen.point(12, 2)).toBe(1)
    expect(() => run('Plane Swap 0,1,99')).toThrow(/Illegal function call/)
  })

  it('Plane Shift Up rotates a range of planes, Down the other way', () => {
    // "PLANE1 = 50000 ... Plane Shift Up 1 To 3 ... PLANE1 = 70000,
    // PLANE2 = 50000, PLANE3 = 60000" — plane 1 takes plane 3's data
    const up = run(['Cls 0', 'Ink 1 : Plot 0,0', 'Ink 2 : Plot 1,0', 'Ink 4 : Plot 2,0', 'Plane Shift Up 0,1 To 3'].join('\n'))
    expect([up.rt.screen.point(0, 0), up.rt.screen.point(1, 0), up.rt.screen.point(2, 0)]).toEqual([2, 4, 1])
    const down = run(
      ['Cls 0', 'Ink 1 : Plot 0,0', 'Ink 2 : Plot 1,0', 'Ink 4 : Plot 2,0', 'Plane Shift Down 0,1 To 3'].join('\n'),
    )
    expect([down.rt.screen.point(0, 0), down.rt.screen.point(1, 0), down.rt.screen.point(2, 0)]).toEqual([4, 1, 2])
  })
})

describe('TURBO Plane Offset (Turbo_Plane_doc.asc + disassembly)', () => {
  it('the offsets accumulate, and a zero one resets that plane', () => {
    // The routine adds to the stored offset unless the new one works out to
    // zero: "To reset the offset of a particular plane, set the X and
    // YOFFSET parameters to zero."
    const { rt } = run(['Plane Offset 0,1,4,0', 'Plane Offset 0,1,4,0', 'Plane Offset 0,2,0,1'].join('\n'))
    const t = rt.turbo.planeOffsets.get(0)!
    expect([t[0], t[1]]).toEqual([8, 40]) // 4+4 bytes, and one row of 40
    const reset = run(['Plane Offset 0,1,4,0', 'Plane Offset 0,1,0,0'].join('\n'))
    expect(reset.rt.turbo.planeOffsets.get(0)![0]).toBe(0)
    // "To set all offsets for all planes to zero... a negative PLANENR"
    const all = run(['Plane Offset 0,1,4,0', 'Plane Offset 0,2,4,0', 'Plane Offset 0,-1,0,0'].join('\n'))
    expect([...all.rt.turbo.planeOffsets.get(0)!]).toEqual([0, 0, 0, 0, 0, 0])
    expect(() => run('Plane Offset 0,0,0,0')).toThrow(/Illegal function call/)
  })

  it('nothing moves until Plane Update, and then only on screen', () => {
    // "This command is used to reflect the changes made with the Plane
    // commands" — the routine biases the pointers the copper reads and puts
    // them straight back, so the buffer itself never moves
    const mark = ['Cls 0', 'Ink 1 : Bar 16,0 To 23,7', 'Plane Offset 0,1,2,0']
    const { rt } = run(mark.join('\n'))
    expect(rt.screen.planeOffsets).toBe(null) // not applied yet
    const shown = run([...mark, 'Plane Update 0'].join('\n'))
    const s = shown.rt.screen
    expect([...s.planeOffsets!].slice(0, 1)).toEqual([2])
    // Point still reads the buffer, which has not moved
    expect(s.point(16, 0)).toBe(1)
    expect(s.point(0, 0)).toBe(0)
    // what the compositor draws has: two bytes of offset is sixteen pixels
    expect(s.offsetPixel(s.pixels, 0, 0)).toBe(1)
    expect(s.offsetPixel(s.pixels, 0, 16)).toBe(0)
  })
})

describe('TURBO blocks (Turbo_Block_doc.asc + disassembly)', () => {
  const grab = ['Cls 0', 'Ink 3 : Bar 0,0 To 15,7', 'Get Block 1,0,0,16,8', 'Cls 0']

  it('F Put Block chops X to a 16-pixel boundary and drops what is off screen', () => {
    // "The X coordinate is chopped to ly on a 16 bit boundary... If X < 0 no
    // Block is displayed"
    const { rt } = run([...grab, 'F Put Block 1,100,50'].join('\n'))
    expect(rt.screen.point(96, 50)).toBe(3) // 100 chopped to 96
    expect(rt.screen.point(111, 57)).toBe(3)
    const off = run([...grab, 'F Put Block 1,-16,50', 'F Put Block 1,10,999'].join('\n'))
    let lit = 0
    for (let y = 0; y < 200; y++) for (let x = 0; x < 320; x++) if (off.rt.screen.point(x, y) !== 0) lit++
    expect(lit).toBe(0)
  })

  it('the static block list has to be reserved, built, and only once', () => {
    expect(() => run('Reserve Static Block 10 : Reserve Static Block 10')).toThrow(/Illegal function call/)
    expect(() => run('Static Block Erase')).toThrow(/Illegal function call/)
    expect(() => run('Reserve Static Block 0')).toThrow(/Illegal function call/)
    const { rt } = run('Reserve Static Block 10 : Static Block Erase')
    expect(rt.turbo.staticBlocks).toBe(null)
  })

  it('F Put Static Block draws what Build Static Block found, and nothing else', () => {
    // the table is allocated without MEMF_CLEAR, so a block that was not in
    // AMOS's list when it was built is an uninitialised pointer
    const { rt } = run([...grab, 'Reserve Static Block 4', 'Build Static Block', 'F Put Static Block 1,32,20'].join('\n'))
    expect(rt.screen.point(32, 20)).toBe(3)
    const late = run(
      [...grab, 'Reserve Static Block 4', 'Build Static Block', 'Get Block 2,0,0,16,8', 'F Put Static Block 2,32,20'].join('\n'),
    )
    expect(late.rt.screen.point(32, 20)).toBe(0) // block 2 was grabbed too late
  })
})

/**
 * The machine-level tail: shifts and tests, the memory hunts, the small
 * numeric helpers, and the two hardware questions.
 */
describe('TURBO shifts and tests (TURBO_DocsV2.15.Asc + disassembly)', () => {
  it('a byte or word shift leaves the rest of the longword alone', () => {
    // one 68k instruction each: lsl.b touches eight bits and no more
    expect(run('Print Lsl.b(5,1);Lsl.w(5,1);Lsl.l(5,1)').out).toBe(' 10 10 10\n')
    expect(run('Print Lsl.b($1234,4);Lsl.w($1234,4)').out).toBe(' 4672 9024\n') // $1240 and $2340
    expect(run('Print Lsr.b($1234,4);Lsr.w($1234,4);Lsr.l($1234,4)').out).toBe(' 4611 291 291\n')
    // the count is a register shift, so it goes mod 64 and clears the field
    expect(run('Print Lsl.b(255,8)').out).toBe(' 0\n')
  })

  it('L Swap exchanges the halves of the longword', () => {
    // "A=$FFFF1111 : B=L Swap(A) returns B=$1111FFFF"
    expect(run('Print Hex$(L Swap($FFFF1111))').out).toBe('$1111FFFF\n')
  })

  it('Test.b and Test.w compare only the low bits', () => {
    // "Test.b(x,y) is equivalent to: If (X And $FF) = (Y AND $FF)"
    expect(run('Print Test.b($1234,$FF34);Test.b($1234,$1235)').out).toBe('-1 0\n')
    expect(run('Print Test.w($11234,$21234);Test.w($1234,$1235)').out).toBe('-1 0\n')
  })

  it('Bit Field Ext and Ins move a field of bits', () => {
    // "STARTBIT is the bit where to the start the extraction from and WIDTH
    // indicates how many bits are to be extracted"
    expect(run('Print Bit Field Ext($F0,4,4)').out).toBe(' 15\n')
    expect(run('Print Bit Field Ext($F0,4,2)').out).toBe(' 3\n')
    expect(run('Print Hex$(Bit Field Ins($F0,0,4,5))').out).toBe('$F5\n')
    // a field that would run off the end of the longword is refused
    expect(() => run('Print Bit Field Ins(0,30,4,1)')).toThrow(/Illegal function call/)
  })
})

describe('TURBO numeric helpers (TURBO_DocsV2.15.Asc + disassembly)', () => {
  it('Range clamps, T Clip truncates, Texp chooses, Between is strict', () => {
    // "x=Range(3, 5 to 100) — x now equals 5"
    expect(run('Print Range(3,5 To 100);Range(105,5 To 100);Range(40,5 To 100)').out).toBe(' 5 100 40\n')
    // "Print T Clip (50,15) returns 45"
    expect(run('Print T Clip(50,15);T Clip(64,32)').out).toBe(' 45 64\n')
    // divs.w truncates towards zero rather than flooring
    expect(run('Print T Clip(-50,15)').out).toBe('-45\n')
    expect(() => run('Print T Clip(50,0)')).toThrow(/Illegal function call/)
    // "x=Texp (4=3,1,2) — since 4=3 is false, x now equals 2"
    expect(run('Print Texp(4=3,1,2);Texp(4=4,1,2)').out).toBe(' 2 1\n')
    // "x=((low<value) and (value<high))", and the ends are exchanged if need be
    expect(run('Print Between(1,5,10);Between(1,1,10);Between(10,5,1)').out).toBe('-1 0-1\n')
  })

  it('T Clip is a WORD divide, and overflows into nonsense', () => {
    // routine 149 ($4b0c) is `divs.w d0,d3 / muls.w d0,d3` on a longword
    // variable. A quotient too big for sixteen bits overflows the divide,
    // which leaves d3 alone, and the multiply then squares up the variable's
    // own low word instead: 100000 is $186a0, low word -31072, times 2.
    expect(run('Print T Clip(100000,2)').out).toBe('-62144\n')
    // just under the overflow it is the plain answer
    expect(run('Print T Clip(65534,2)').out).toBe(' 65534\n')
  })

  it('F Sqr sign-extends its own answer and wraps negative', () => {
    // routine 65 ($1f18) ends `ext.l d1` on a root that can reach 46341
    expect(run('Print F Sqr(144);F Sqr(1073676289)').out).toBe(' 12 32767\n')
    expect(run('Print F Sqr(1073741824)').out).toBe('-32768\n')
  })

  it('Bit Field Ext and Ins do not look at the start bit when the width is zero', () => {
    // width is popped and Rbmi-checked first; a width masking to zero takes
    // the early exit at $4722/$46e4 having never seen the start bit
    expect(run('Print Bit Field Ext($1234,-5,0)').out).toBe(' 4660\n')
    expect(run('Print Bit Field Ins($1234,-5,0,$ff)').out).toBe(' 4660\n')
    // with a width it is an error again
    expect(() => run('Print Bit Field Ext($1234,-5,4)')).toThrow(/Illegal function call/)
    // "Both the STARTBIT and the WIDTH are interpreted mod 31"
    expect(run('Print Bit Field Ext($ff00,8,8);Bit Field Ins(0,4,4,$f)').out).toBe(' 255 240\n')
    // Ins refuses a field running off the top; Ext has no such test
    expect(() => run('Print Bit Field Ins(0,30,8,1)')).toThrow(/Illegal function call/)
    expect(run('Print Bit Field Ext(-1,30,8)').out).toBe(' 3\n')
  })

  it('Cpu Info and Math Info answer for the machine this port models', () => {
    // 2MB chip and a fast board is an A1200, so a 68020 and no FPU
    expect(run('Print Cpu Info;Math Info').out).toBe(' 20 0\n')
  })

  it('Chip Largest and Fast Largest report the free memory', () => {
    // AvailMem with MEMF_LARGEST, which without a fragmenting allocator is
    // the same answer Chip Free and Fast Free give
    expect(run('Print Chip Largest=Chip Free;Fast Largest=Fast Free').out).toBe('-1-1\n')
  })

  it('Bank End is the end address, or minus the count for sprites and icons', () => {
    // "If you ask for the Bank End of a Sprite or Icon bank the result will
    // be NEGATIVE. It gives the negative amount of Sprite/Icon definitions"
    expect(run('Reserve As Work 6,100 : Print Bank End(6)=Start(6)+100').out).toBe('-1\n')
    expect(run('Print Bank End(9)').out).toBe(' 0\n') // not reserved: no error
    const sprites = run(
      ['Ink 5 : Bar 0,0 To 7,7', 'Get Sprite 1,0,0 To 8,8', 'Get Sprite 2,0,0 To 8,8', 'Print Bank End(1)'].join('\n'),
    )
    expect(sprites.out).toBe('-2\n')
  })

  it('Parse$ matches a word against a list of alternatives', () => {
    // Undocumented: routine 180 returns an integer despite the name — which
    // alternative of a "|" list word N matched, or the fourth argument
    expect(run('Print Parse$("go north",2,"south|north|east",0)').out).toBe(' 2\n')
    expect(run('Print Parse$("go north",2,"south|east",-1)').out).toBe('-1\n')
    expect(run('Print Parse$("take the lamp, now",4,"now|then",7)').out).toBe(' 1\n')
    expect(run('Print Parse$("",1,"a|b",5)').out).toBe(' 5\n')
  })

  it('Parse$ can never return the LAST alternative', () => {
    // Having matched every byte, $54be demands a "|" after the alternative
    // and falls through to the not-found tail without one — so the final
    // entry of the list is unreachable unless the list ends with a bar.
    expect(run('Print Parse$("go east",2,"south|north|east",0)').out).toBe(' 0\n')
    expect(run('Print Parse$("go east",2,"south|north|east|",0)').out).toBe(' 3\n')
    // one alternative and no bar at all matches nothing
    expect(run('Print Parse$("east",1,"east",0)').out).toBe(' 0\n')
  })
})

describe('TURBO memory keywords (TURBO_DocsV2.15.Asc + disassembly)', () => {
  const bank = 'Reserve As Work 7,64'

  it('Memory Fill repeats a string, and writes the END address too', () => {
    // the manual's own example fills a bank with 0123401234...
    //
    // Both loops in routine 140 ($4810) decrement the count after writing and
    // carry on while it is not yet negative, so the span is inclusive: nine
    // bytes for Start(7) To Start(7)+8. That is why the manual's own
    // `Memory Fill Start(6) to Bank End (6),A$` puts one byte past the bank.
    const { rt } = run([bank, 'Memory Fill Start(7) To Start(7)+8,"AB"'].join('\n'))
    const m = rt.resolveAddr(rt.bankBase(7))!
    expect([...m.data.subarray(m.off, m.off + 10)]).toEqual([65, 66, 65, 66, 65, 66, 65, 66, 65, 0])
  })

  it('Memory Fill raises on an empty string rather than doing nothing', () => {
    // `move.w (a2)+,d7 / Rbeq routine 62` — the length is checked before
    // either address is looked at
    expect(() => run([bank, 'Memory Fill Start(7) To Start(7)+8,""'].join('\n'))).toThrow(/Illegal function call/)
  })

  it('Byte Hunt finds a value, a range, or nothing', () => {
    const setup = [bank, 'Memory Fill Start(7) To Start(7)+7,"ABCD"']
    // "If ACTION=0 the Byte Hunt command behaves just like the normal Hunt
    // command. Only VAL1 is checked for."
    expect(run([...setup, 'Print Byte Hunt(Start(7) To Start(7)+7,0,67,0)-Start(7)'].join('\n')).out).toBe(' 2\n')
    // "If ACTION=1 ... any value lying inside the values VAL1 to VAL2"
    expect(run([...setup, 'Print Byte Hunt(Start(7) To Start(7)+7,1,66 To 67,0)-Start(7)'].join('\n')).out).toBe(' 1\n')
    // "If ACTION=-1 ... any value lying outside"
    expect(run([...setup, 'Print Byte Hunt(Start(7) To Start(7)+7,-1,65 To 66,0)-Start(7)'].join('\n')).out).toBe(' 2\n')
    expect(run([...setup, 'Print Byte Hunt(Start(7) To Start(7)+7,0,90,0)'].join('\n')).out).toBe(' 0\n')
  })

  it('Word Hunt works in words, String Hunt in strings and either direction', () => {
    const setup = [bank, 'Memory Fill Start(7) To Start(7)+16,"ABCD"']
    expect(run([...setup, 'Print Word Hunt(Start(7) To Start(7)+16,0,$4142,0)-Start(7)'].join('\n')).out).toBe(' 0\n')
    expect(run([...setup, 'Print String Hunt(Start(7) To Start(7)+16,0,1,"CD")-Start(7)'].join('\n')).out).toBe(' 2\n')
    // "When step is negative, this routine will search from end to start!"
    expect(run([...setup, 'Print String Hunt(Start(7) To Start(7)+16,0,-1,"CD")-Start(7)'].join('\n')).out).toBe(' 14\n')
  })

  it('Byte Hunt covers the end byte and Word Hunt stops one word short', () => {
    // `subq.l #$1,d1 / bge` against `subq.l #$2,d1 / bgt` — the same loop
    // with one branch changed, so the two disagree about their far corner
    const setup = [bank, 'Memory Fill Start(7) To Start(7)+7,"AAAAAAAZ"']
    expect(run([...setup, 'Print Byte Hunt(Start(7) To Start(7)+7,0,90,0)-Start(7)'].join('\n')).out).toBe(' 7\n')
    // the Z is in the last word of the span, which Word Hunt never reads
    expect(run([...setup, 'Print Word Hunt(Start(7) To Start(7)+7,0,$415a,0)'].join('\n')).out).toBe(' 0\n')
    expect(run([...setup, 'Print Word Hunt(Start(7) To Start(7)+9,0,$415a,0)-Start(7)'].join('\n')).out).toBe(' 6\n')
  })

  it('Byte Hunt compares SIGNED bytes, and never orders VAL1 against VAL2', () => {
    // `cmp.b` with `blt`/`bgt`: as signed bytes 200 is -56, so the "inside"
    // range 100 To 200 runs from 100 down to -56 — empty — and matches
    // nothing. A raw 0 here is the not-found answer, not an address.
    const setup = [bank, 'Memory Fill Start(7) To Start(7)+3,Chr$(150)']
    expect(run([...setup, 'Print Byte Hunt(Start(7) To Start(7)+3,1,100 To 200,0)'].join('\n')).out).toBe(' 0\n')
    // the byte itself is 150, which signed is -106, and that IS inside
    // -128 To 0 — found at the first byte of the span
    expect(run([...setup, 'Print Byte Hunt(Start(7) To Start(7)+3,1,-128 To 0,0)-Start(7)'].join('\n')).out).toBe(' 0\n')
  })

  it('String Hunt with a non-zero action wants NO byte to match', () => {
    // any non-zero action takes the `beq`-out compare at $5010, which is not
    // "the string is absent here" but "not one byte of it matches here"
    const setup = [bank, 'Memory Fill Start(7) To Start(7)+7,"ABCDABCD"']
    // "AB" differs from "CD" in both bytes; "AD" shares its second byte with
    // "CD" at offset 2, so that position is rejected
    expect(run([...setup, 'Print String Hunt(Start(7) To Start(7)+7,1,1,"CX")-Start(7)'].join('\n')).out).toBe(' 0\n')
    expect(run([...setup, 'Print String Hunt(Start(7) To Start(7)+7,1,1,"AB")-Start(7)'].join('\n')).out).toBe(' 1\n')
    // a step of zero, and an end at or below the start, are both errors
    expect(() => run([...setup, 'Print String Hunt(Start(7) To Start(7)+7,0,0,"AB")'].join('\n'))).toThrow(
      /Illegal function call/,
    )
    expect(() => run([...setup, 'Print String Hunt(Start(7) To Start(7),0,1,"AB")'].join('\n'))).toThrow(
      /Illegal function call/,
    )
  })

  it('Move Mem copies a region and refuses an empty one', () => {
    const { rt } = run([bank, 'Memory Fill Start(7) To Start(7)+4,"AB"', 'Move Mem Start(7),Start(7)+4 To Start(7)+8'].join('\n'))
    const m = rt.resolveAddr(rt.bankBase(7))!
    expect([...m.data.subarray(m.off + 8, m.off + 12)]).toEqual([65, 66, 65, 66])
    expect(() => run([bank, 'Move Mem Start(7),Start(7) To Start(7)+8'].join('\n'))).toThrow(/Illegal function call/)
  })
})

describe('TURBO Hit Zone (TURBO_DocsV2.15.Asc)', () => {
  it('Hit Bob Zone asks AMOS which zone the bob is in', () => {
    // "the same as: A=Zone(X Bob(n)+dx,Y Bob(n)+dy)"
    const { out } = run(
      [
        'Ink 5 : Bar 0,0 To 7,7 : Get Bob 1,0,0 To 8,8 : Cls 0',
        'Set Zone 1,10,10 To 50,50',
        'Bob 1,30,30,1',
        'Print Hit Bob Zone(0,0,1);Hit Bob Zone(100,100,1)',
      ].join('\n'),
    )
    expect(out).toBe(' 1 0\n')
  })

  it('Hit Spr Zone uses hardware coordinates, as Hzone does', () => {
    // "A=Hzone(X Sprite(n)+dx,Y Sprite(n)+dy)"
    const { out } = run(
      [
        'Ink 5 : Bar 0,0 To 7,7 : Get Sprite 1,0,0 To 8,8 : Cls 0',
        'Set Zone 1,10,10 To 50,50',
        'Sprite 8,128+30,50+30,1',
        'Print Hit Spr Zone(0,0,8)',
      ].join('\n'),
    )
    expect(out).toBe(' 1\n')
  })
})

/**
 * Icons — routines 82-89 and 147, documented in Turbo_Icon_doc.asc and the
 * 2.15 manual.
 */
describe('TURBO icons (Turbo_Icon_doc.asc + disassembly)', () => {
  const grab = ['Cls 0', 'Ink 3 : Bar 0,0 To 15,7', 'Get Icon 1,0,0 To 16,8', 'Cls 0']

  it('F Paste Icon chops X to a 16-pixel boundary and drops what is off screen', () => {
    const { rt } = run([...grab, 'F Paste Icon 100,50,1'].join('\n'))
    expect(rt.screen.point(96, 50)).toBe(3)
    const off = run([...grab, 'F Paste Icon -16,50,1', 'F Paste Icon 10,999,1'].join('\n'))
    let lit = 0
    for (let y = 0; y < 200; y++) for (let x = 0; x < 320; x++) if (off.rt.screen.point(x, y) !== 0) lit++
    expect(lit).toBe(0)
  })

  it('the width-specialised routines do not chop X', () => {
    // "The X and Y coordinates are no longer chopped to ly on a 16 bit
    // boundary. So you can put the allmost anywhere onto the screen"
    const { rt } = run([...grab, 'F 16 Icon 100,50,1'].join('\n'))
    expect(rt.screen.point(100, 50)).toBe(3)
    expect(rt.screen.point(96, 50)).toBe(0)
    const wide = run([...grab, 'F 32 Icon 100,50,1'].join('\n'))
    expect(wide.rt.screen.point(100, 50)).toBe(3)
  })

  it('the processor versions chop X again and draw without a mask', () => {
    // "Masking is not supported!" — the CPU versions paste the whole
    // rectangle, colour 0 and all
    const masked = ['Cls 0', 'Ink 3 : Bar 0,0 To 7,7', 'Get Icon 1,0,0 To 16,8', 'Cls 0', 'Ink 5 : Bar 0,0 To 319,199']
    const proc = run([...masked, 'F 16proc Icon 100,50,1'].join('\n'))
    expect(proc.rt.screen.point(96, 50)).toBe(3)
    expect(proc.rt.screen.point(110, 50)).toBe(0) // the icon's blank half painted over
    const blit = run([...masked, 'F Paste Icon 100,50,1'].join('\n'))
    expect(blit.rt.screen.point(110, 50)).toBe(5) // masked: the background shows
    const proc32 = run([...masked, 'F 32proc Icon 100,50,1'].join('\n'))
    expect(proc32.rt.screen.point(96, 50)).toBe(3)
  })

  it('X Icon is in words, Y Icon in lines, Planes Icon in bitplanes', () => {
    // "Ex.: Screen Open 0,320,200,8,Lowres : Get Icon 1,0,0 To 64,100 :
    // DEPTH=Planes Icon(1) — DEPTH will contain 3"
    const { out } = run(['Screen Open 0,320,200,8,Lowres', 'Get Icon 1,0,0 To 64,100', 'Print X Icon(1);Y Icon(1);Planes Icon(1)'].join('\n'))
    expect(out).toBe(' 4 100 3\n')
  })

  it('Icon Check tells a defined icon from a missing one', () => {
    // "-1 indicates that the Icon is defined, and it has NO MASK... 0
    // indicates that the Icon is NOT defined"
    const { out } = run([...grab, 'Print Icon Check(1);Icon Check(2)'].join('\n'))
    expect(out).toBe(' 1 0\n')
    // with no bank at all: "in AMOSPro you don't get an error, 0 is returned"
    expect(run('Print Icon Check(1)').out).toBe(' 0\n')
    expect(() => run('Print Icon Check(0)')).toThrow(/Illegal function call/)
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

describe('TURBO scenes: banks (TURBO_DocsV2.15.Asc + disassembly)', () => {
  it('Reserve Scene lays out the header the manual documents', () => {
    // "Start+0 WORD X_WIDTH / Start+2 WORD Y_HEIGHT / Repeat X_WIDTH*YHEIGHT
    // / Start+4,6,8,... WORD ICONIMAGE_TO_DISPLAY-1". "All tiles are set to
    // zero (0)", and the bank is named so "the Listbank command will display
    // the type of the bank as Scenery".
    const { rt } = run('Reserve Scene 5,4,3')
    const b = rt.memBanks.get(5)!
    expect(b.name).toBe('Scenery ')
    expect(b.data.length).toBe(4 + 4 * 3 * 2)
    expect([...b.data.subarray(0, 4)]).toEqual([0, 4, 0, 3])
    expect([...b.data.subarray(4)].every((v) => v === 0)).toBe(true)
  })

  it('Reserve Scene refuses a zero dimension and a bank number over 65535', () => {
    // three `Rble routine 62` and a `cmp.l #$10000,d0 : Rbge`
    expect(() => run('Reserve Scene 5,0,3')).toThrow(/Illegal function call/)
    expect(() => run('Reserve Scene 5,4,0')).toThrow(/Illegal function call/)
    expect(() => run('Reserve Scene 65536,4,3')).toThrow(/Illegal function call/)
  })

  it('Scene X and Scene Y read the header back', () => {
    expect(run('Get Icon 1,0,0 To 16,16 : Reserve Scene 5,7,9 : Scene Bank 5 : Print Scene X;Scene Y').out).toBe(' 7 9\n')
  })

  it('Scene Bank resolves the icon bank too, so a missing one fails here', () => {
    // "Make sure you have both a scene bank and icon bank in memory or this
    // command will return a Bank Not Reserved error": routine 97 looks the
    // icon bank up as well and both misses land on AMOS error 36.
    expect(() => run('Reserve Scene 5,4,4 : Scene Bank 5')).toThrow(/bank not reserved/)
    expect(() => run('Scene Bank 5')).toThrow(/bank not reserved/)
    // with an icon bank present it goes through
    const ok = run(['Get Icon 1,0,0 To 16,16', 'Reserve Scene 5,4,4', 'Scene Bank 5'].join('\n'))
    expect(ok.rt.turbo.scene.bank).toBe(5)
  })

  it('Scene Icon Bank stores the number before it validates it', () => {
    // `move.w d0,$3b8(a2)` comes before the GetBank, so a rejected bank
    // still replaces the setting
    let rt: Runtime | null = null
    try {
      rt = run('Get Icon 1,0,0 To 16,16 : Scene Icon Bank 7').rt
    } catch {
      /* expected */
    }
    expect(rt).toBeNull()
    // and 2 is the default, "for compatibility with the 'older' TURBO_PLUS libs"
    expect(run('Get Icon 1,0,0 To 16,16').rt.turbo.scene.iconBank).toBe(2)
  })

  it('Default puts Scene Icon Bank and Scene Mask Palette back', () => {
    // "Scene Icon Bank is set to 2 ... when you call Default"; the mask is
    // "set to -1 (all bits set) if you do a RUN or a DEFAULT"
    const { rt } = run(['Get Icon 1,0,0 To 16,16', 'Get Sprite 1,0,0 To 16,16', 'Scene Icon Bank 1', 'Scene Mask Palette 7', 'Default'].join('\n'))
    expect(rt.turbo.scene.iconBank).toBe(2)
    expect(rt.turbo.scene.maskPalette).toBe(-1)
  })

  it('Scene Load reads the whole file into a bank and leaves Scene Bank alone', () => {
    // routine 314 seeks to the end for the length, reserves that many bytes
    // and reads the lot. "The Scene Bank is not set by this command."
    const file = [0, 2, 0, 1, 0, 9, 0, 4]
    const { rt } = run('Scene Load "map.scn",6', { 'map.scn': file })
    expect([...rt.memBanks.get(6)!.data]).toEqual(file)
    expect(rt.memBanks.get(6)!.name).toBe('Scenery ')
    expect(rt.turbo.scene.bank).toBe(0)
  })

  it('Scene Convert widens the V1.0 byte format to words', () => {
    // "This command is used to convert the V1.0 'BYTE' Sceneformat to V2.0
    // 'WORD' Sceneformat, so you don't have to throw away your 'old' work."
    const old = [0, 3, 0, 2, 1, 2, 3, 4, 5, 6]
    const { out } = run(
      [
        'Scene Load "old.scn",6',
        'Scene Convert 6 To 7',
        'Get Icon 1,0,0 To 16,16',
        'Scene Bank 7',
        'Print Scene X;Scene Y;Scene Check(0,0);Scene Check(2,1)',
      ].join('\n'),
      { 'old.scn': old },
    )
    expect(out).toBe(' 3 2 1 6\n')
  })
})

describe('TURBO scenes: reading and writing tiles (TURBO_DocsV2.15.Asc)', () => {
  const map = ['Get Icon 1,0,0 To 16,16', 'Reserve Scene 5,4,3', 'Scene Bank 5']

  it('Scene Check and Scene Change work in scene coordinates', () => {
    // "Changes tile at X,Y scene coordinates to V" / "Returns Icon number in
    // the scene at scene coordinates X,Y, minus 1"
    expect(run([...map, 'Scene Change 2,1,42', 'Print Scene Check(2,1);Scene Check(0,0)'].join('\n')).out).toBe(' 42 0\n')
  })

  it('a coordinate equal to the width or height is accepted, one beyond is not', () => {
    // The bound is `cmp.w d2,d0 : Rbhi` — strictly greater — so x = width
    // passes and indexes the first tile of the next row.
    expect(run([...map, 'Scene Change 0,1,77', 'Print Scene Check(4,0)'].join('\n')).out).toBe(' 77\n')
    expect(() => run([...map, 'Print Scene Check(5,0)'].join('\n'))).toThrow(/Illegal function call/)
    expect(() => run([...map, 'Print Scene Check(-1,0)'].join('\n'))).toThrow(/Illegal function call/)
  })

  it('Scene 16/32 Check and Change divide screen coordinates by the tile size', () => {
    // "Returns Icon number is in the scene according to the X and Y screen
    // coordinates" — a bare shift, with no viewport offset applied
    const sixteen = run([...map, 'Scene 16 Change 33,17,9', 'Print Scene Check(2,1);Scene 16 Check(47,31)'].join('\n'))
    expect(sixteen.out).toBe(' 9 9\n')
    const thirtytwo = run([...map, 'Scene 32 Change 65,33,8', 'Print Scene Check(2,1)'].join('\n'))
    expect(thirtytwo.out).toBe(' 8\n')
  })

  it('Scene 16 Change writes the bank and does not redraw', () => {
    // "The change made on screen and in the Scene bank" — the routine ends
    // at `move.w d3,(a0,d0.l)`. Nothing reaches the screen.
    const { rt } = run([...map, 'Cls 0', 'Scene 16 Change 0,0,1'].join('\n'))
    expect(rt.screen.point(0, 0)).toBe(0)
  })
})

describe('TURBO scenes: the bulk operations (TURBO_DocsV2.15.Asc)', () => {
  const two = ['Get Icon 1,0,0 To 16,16', 'Reserve Scene 5,4,3', 'Reserve Scene 6,2,2']

  it('Scene Fill fills a rectangle and clips it to the bank', () => {
    // "Fills a rectangular area of a scene bank with VALUE"
    const { out } = run([...two, 'Scene Fill 5,2,1,9,9,7', 'Scene Bank 5', 'Print Scene Check(2,1);Scene Check(3,2);Scene Check(1,1)'].join('\n'))
    expect(out).toBe(' 7 7 0\n')
  })

  it('Scene Replace swaps one tile value for another inside a rectangle', () => {
    // "Ex.: to replace all icons 2 in the scene to 5. Scene Replace
    // 1,0,0,Scene X,Scene Y,2,5"
    const { out } = run(
      [...two, 'Scene Fill 5,0,0,4,3,2', 'Scene Replace 5,0,0,2,2,2,5', 'Scene Bank 5', 'Print Scene Check(0,0);Scene Check(2,0);Scene Check(3,2)'].join('\n'),
    )
    expect(out).toBe(' 5 2 2\n')
  })

  it('Scene Copy clips against both banks', () => {
    // "The Scene Banks may have different width and height, everything is
    // checked for" — the source clip runs first, the destination clip second
    const { out } = run(
      [...two, 'Scene Fill 5,0,0,4,3,3', 'Scene Copy 5,0,0,4,3 To 6,1,1', 'Scene Bank 6', 'Print Scene Check(1,1);Scene Check(0,0)'].join('\n'),
    )
    expect(out).toBe(' 3 0\n')
  })

  it('the bulk operations refuse a start outside the bank', () => {
    // `sub.w d2,d0 : Rble` — nothing left to work on is an error, not a no-op
    expect(() => run([...two, 'Scene Fill 5,4,0,1,1,7'].join('\n'))).toThrow(/Illegal function call/)
    expect(() => run([...two, 'Scene Fill 5,0,0,0,1,7'].join('\n'))).toThrow(/Illegal function call/)
  })
})

describe('TURBO scenes: drawing (TURBO_DocsV2.15.Asc + disassembly)', () => {
  // icon 1 solid colour 3, icon 2 solid colour 5, both 16x16
  const icons = [
    'Cls 0',
    'Ink 3 : Bar 0,0 To 15,15',
    'Get Icon 1,0,0 To 16,16',
    'Ink 5 : Bar 0,0 To 15,15',
    'Get Icon 2,0,0 To 16,16',
    'Cls 0',
  ]
  const map = [...icons, 'Reserve Scene 5,4,3', 'Scene Bank 5', 'Scene Change 1,0,1']

  it('Scene 16 Draw paints a rectangle of tiles, icon = tile + 1', () => {
    // "SCENEX and SCENEY are the start scene-coordinates. XAMT and YAMT
    // define how many Icons are to be drawn onto the screen. XSCREEN and
    // YSCREEN are the screen coordinates where the to begin drawing."
    const { rt } = run([...map, 'Scene 16 Draw 0,0,2,1,0,0'].join('\n'))
    expect(rt.screen.point(0, 0)).toBe(3)
    expect(rt.screen.point(16, 0)).toBe(5)
    expect(rt.screen.point(0, 16)).toBe(0)
  })

  it('Scene 16 Draw chops XSCREEN to a 16-pixel boundary and clips both ways', () => {
    // "XSCREEN/YSCREEN are chopped to lie on a 16/32 bit boundary" — only
    // XSCREEN actually is
    expect(run([...map, 'Scene 16 Draw 0,0,1,1,40,7'].join('\n')).rt.screen.point(32, 7)).toBe(3)
    // asking for more tiles than the scene has draws what there is
    const wide = run([...map, 'Scene 16 Draw 0,0,99,99,0,0'].join('\n'))
    expect(wide.rt.screen.point(48, 32)).toBe(3)
    expect(wide.rt.screen.point(64, 0)).toBe(0)
    // and a destination past the right edge of the bitplane is an error
    expect(() => run([...map, 'Scene 16 Draw 0,0,1,1,320,0'].join('\n'))).toThrow(/Illegal function call/)
  })

  it('Scene 32 Draw chops XSCREEN to 16 as well, not 32', () => {
    // "Do not try to use one of the '16' commands with 32 * 32 pixels icons
    // and vice versa" — but the mask is `andi.w #$fff0` in both routines,
    // so a 32-pixel scene can start on a 16-pixel boundary
    expect(run([...map, 'Scene 32 Draw 0,0,1,1,16,0'].join('\n')).rt.screen.point(16, 0)).toBe(3)
  })

  it('Scene 16 View and Scene 16 Do fill the viewport', () => {
    // "Used to fill up a screen, in the viewport set with the last Scene
    // 16/32 view command, with a scene starting from scene-coordinates
    // XSCENE/YSCENE"
    const { rt } = run([...map, 'Scene 16 View 0,0,0 To 64,32', 'Scene 16 Do 0,0'].join('\n'))
    expect(rt.screen.point(0, 0)).toBe(3)
    expect(rt.screen.point(16, 0)).toBe(5)
    expect(rt.screen.point(0, 16)).toBe(3)
    expect(rt.screen.point(64, 0)).toBe(0)
  })

  it('the viewport wraps the scene coordinates in both directions', () => {
    // Undocumented, and the reason the view commands exist: a tile that runs
    // off the right of a row comes back at the left, and one that runs off
    // the end of the map restarts at the top.
    const wrapped = run([...map, 'Scene 16 View 0,0,0 To 64,32', 'Scene 16 Do 3,0'].join('\n'))
    expect(wrapped.rt.screen.point(0, 0)).toBe(3) // tile 3,0
    expect(wrapped.rt.screen.point(16, 0)).toBe(3) // wrapped to 0,0
    expect(wrapped.rt.screen.point(32, 0)).toBe(5) // wrapped to 1,0
    // a negative coordinate is folded in by repeated addition, not clamped
    const back = run([...map, 'Scene 16 View 0,0,0 To 64,32', 'Scene 16 Do -3,0'].join('\n'))
    expect(back.rt.screen.point(0, 0)).toBe(5) // -3 + 4 = tile 1,0, which is icon 2
    // and so is a coordinate a whole map past the end
    const far = run([...map, 'Scene 16 View 0,0,0 To 64,32', 'Scene 16 Do 5,0'].join('\n'))
    expect(far.rt.screen.point(0, 0)).toBe(5)
  })

  it("Scene View's y1 is used as a byte offset, not a line — the 2.15 regression", () => {
    // V1.0's Scene 16 Do multiplied y1 by the screen's bytes-per-row itself
    // (`mulu.w d4,d2` at $5178). 2.15 moved the arithmetic into Scene 16/32
    // View for speed, converted x1 with `lsr.w #3` and left y1 alone, so the
    // drawing core adds a pixel count to a byte offset. Scene Draw and Scene
    // 16 Def, which compute their own destination, both still multiply.
    //
    // On a 320-wide screen rowBytes is 40, so y1 = 40 lands one whole line
    // down and y1 = 16 lands on line 0, 128 pixels in.
    const { rt } = run([...map, 'Scene 16 View 0,0,16 To 64,48', 'Scene 16 Do 0,0'].join('\n'))
    expect(rt.screen.point(128, 0)).toBe(3)
    expect(rt.screen.point(0, 16)).toBe(0)
    const line = run([...map, 'Scene 16 View 0,0,40 To 64,72', 'Scene 16 Do 0,0'].join('\n'))
    expect(line.rt.screen.point(0, 1)).toBe(3)
  })

  it('Top, Left and Right redraw one edge of the viewport', () => {
    // "Does the same thing as the Scene 16/32 Do command, but is used to
    // redraw only the Left edge of the area defined by the Scene 16/32 View
    // command" — with y1 = 0 these three land where they should
    const view = [...map, 'Scene Fill 5,0,1,4,2,1', 'Scene 16 View 0,0,0 To 64,32']
    const top = run([...view, 'Scene 16 Top 0,0'].join('\n'))
    expect(top.rt.screen.point(0, 0)).toBe(3)
    expect(top.rt.screen.point(0, 16)).toBe(0)
    const left = run([...view, 'Scene 16 Left 0,0'].join('\n'))
    expect(left.rt.screen.point(0, 0)).toBe(3)
    expect(left.rt.screen.point(0, 16)).toBe(5) // scene row 1 was filled with tile 1
    expect(left.rt.screen.point(16, 0)).toBe(0)
    const right = run([...view, 'Scene 16 Right 0,0'].join('\n'))
    expect(right.rt.screen.point(48, 0)).toBe(3)
    expect(right.rt.screen.point(0, 0)).toBe(0)
  })

  it('Bottom carries the same regression, through y2-16', () => {
    // `$3a2 = y2-16` is stored raw for the same reason y1 is, so the bottom
    // edge lands at byte y2-16 rather than line y2-16. Only a viewport
    // exactly one tile tall (y2 = 16) puts it where it belongs.
    const view = [...map, 'Scene Fill 5,0,1,4,2,1', 'Scene 16 View 0,0,0 To 64,32']
    const { rt } = run([...view, 'Scene 16 Bottom 0,0'].join('\n'))
    expect(rt.screen.point(128, 0)).toBe(5) // scene row 1, at byte 16
    expect(rt.screen.point(0, 16)).toBe(0)
  })

  it('drawing a viewport on the wrong screen is "View not defined for this screen"', () => {
    // routine 121 compares the current screen's EcNumber with the view's
    const src = [...map, 'Screen Open 1,320,200,16,Lowres', 'Screen 0', 'Scene 16 View 0,0,0 To 64,32', 'Screen 1', 'Scene 16 Do 0,0']
    expect(() => run(src.join('\n'))).toThrow(/View not defined for this screen/)
    expect(() => run([...icons, 'Reserve Scene 5,4,3', 'Scene Bank 5', 'Scene 16 Do 0,0'].join('\n'))).toThrow(/View not defined for this screen/)
  })

  it('a viewport smaller than one tile is refused', () => {
    // `lsr.w #4,d2 : Rbeq routine 62` on both axes
    expect(() => run([...map, 'Scene 16 View 0,0,0 To 8,32'].join('\n'))).toThrow(/Illegal function call/)
    expect(() => run([...map, 'Scene 16 View 0,0,0 To 64,8'].join('\n'))).toThrow(/Illegal function call/)
    expect(() => run([...map, 'Scene 16 View 0,64,0 To 32,32'].join('\n'))).toThrow(/Illegal function call/)
  })

  it('Scene 16 View needs a Scene Bank before it will look at its arguments', () => {
    // `move.l $35c(a2),d3 : Rbeq routine 126`
    expect(() => run([...icons, 'Scene 16 View 0,0,0 To 64,32'].join('\n'))).toThrow(/Scene Bank not defined/)
  })
})

describe('TURBO scenes: definitions (TURBO_DocsV2.15.Asc)', () => {
  const icons = ['Cls 0', 'Ink 3 : Bar 0,0 To 15,15', 'Get Icon 1,0,0 To 16,16', 'Cls 0']
  const map = [...icons, 'Reserve Scene 5,4,3', 'Scene Bank 5']

  it('Scene 16 Limit allocates and frees, and says so when it is asked twice', () => {
    // "X is the amount of definitions. When X is set to zero, the memory is
    // given back to the system."
    expect(run([...map, 'Scene 16 Limit 4'].join('\n')).rt.turbo.scene.defs.length).toBe(4)
    expect(run([...map, 'Scene 16 Limit 4', 'Scene 16 Limit 0'].join('\n')).rt.turbo.scene.defs.length).toBe(0)
    expect(() => run([...map, 'Scene 16 Limit 4', 'Scene 16 Limit 4'].join('\n'))).toThrow(/Limit allready set/)
    expect(() => run([...map, 'Scene 16 Limit 0'].join('\n'))).toThrow(/Limit allready cleared/)
    expect(() => run([...map, 'Scene 16 Limit 32001'].join('\n'))).toThrow(/Limit should be max : 32000/)
  })

  it('Scene 16 Def stores a drawing and Scene 16 Restore replays it', () => {
    // "Does basically the same as Scene 16 Draw but the information is
    // stored in a scene definition for use by Scene 16 Restore command."
    const { rt } = run([...map, 'Scene 16 Limit 2', 'Scene 16 Def 0,1,0,0,2,1,32,16', 'Scene 16 Restore 1'].join('\n'))
    expect(rt.screen.point(32, 16)).toBe(3)
    expect(rt.screen.point(48, 16)).toBe(3)
    expect(rt.screen.point(0, 0)).toBe(0)
    // Def itself draws nothing
    const defOnly = run([...map, 'Scene 16 Limit 2', 'Scene 16 Def 0,1,0,0,2,1,32,16'].join('\n'))
    expect(defOnly.rt.screen.point(32, 16)).toBe(0)
  })

  it('Restore reports an unused slot and a definition made for another screen', () => {
    const limit = [...map, 'Scene 16 Limit 2']
    expect(() => run([...limit, 'Scene 16 Restore 2'].join('\n'))).toThrow(/Scene Area is not defined/)
    expect(() => run([...limit, 'Scene 16 Restore 3'].join('\n'))).toThrow(/Illegal function call/)
    const other = [...limit, 'Screen Open 1,320,200,16,Lowres', 'Screen 0', 'Scene 16 Def 1,1,0,0,1,1,0,0', 'Scene 16 Restore 1']
    expect(() => run(other.join('\n'))).toThrow(/Scene definition not defined for this screen/)
  })

  it('a definition keeps the banks it was made with', () => {
    // The record stores the icon bank at $42 and the scene data at $46 as
    // pointers, so changing Scene Bank afterwards does not follow.
    const src = [
      ...icons,
      'Reserve Scene 5,4,3',
      'Reserve Scene 6,4,3',
      'Scene Fill 6,0,0,4,3,1',
      'Scene Bank 5',
      'Scene 16 Limit 1',
      'Scene 16 Def 0,1,0,0,1,1,0,0',
      'Scene Bank 6',
      'Scene 16 Restore 1',
    ]
    // bank 6 is all tile 1 = icon 2, which does not exist; bank 5 is tile 0
    // = icon 1, which is the solid colour 3 the definition captured
    expect(run(src.join('\n')).rt.screen.point(0, 0)).toBe(3)
  })
})

describe('TURBO scenes: the palette and the scanners (TURBO_DocsV2.15.Asc + disassembly)', () => {
  it('Scene Palette brings in only the colours Scene Mask Palette allows', () => {
    // "If a bit is set, the screen color will be replaced by the Scene Icon
    // Bank color upon execution of the Scene Palette command." The routine
    // builds all 32 entries, writing $FFFF — AMOS's "leave this one alone" —
    // wherever the bit is clear, and hands the lot to the palette setter.
    // Get Icon snapshots the live palette into the bank it creates, so the
    // bank here holds the colours that were up when it was grabbed.
    const src = [
      'Palette $F00,$0F0,$00F',
      'Get Icon 1,0,0 To 16,16',
      'Palette $111,$222,$333',
      'Scene Mask Palette %101',
      'Scene Palette 2',
      'Print Hex$(Colour(0));" ";Hex$(Colour(1));" ";Hex$(Colour(2))',
    ]
    // Hex$ strips leading zeros, so colour 2's $00F prints as $F
    expect(run(src.join('\n')).out).toBe('$F00 $222 $F\n')
  })

  it('Scene Palette refuses a bank that is not a sprite or icon bank', () => {
    // "Icon/Bob banks are legal, but any other type of bank gives an illegal
    // function call" — two different errors in the binary
    expect(() => run('Get Icon 1,0,0 To 16,16 : Scene Palette 9')).toThrow(/bank not reserved/)
    expect(() => run('Get Icon 1,0,0 To 16,16 : Reserve As Data 9,10 : Scene Palette 9')).toThrow(/Only Sprite or Icon banks/)
    expect(() => run('Get Icon 1,0,0 To 16,16 : Scene Palette 0')).toThrow(/Illegal function call/)
  })

  it('Scene Scan X counts the steps to a tile', () => {
    // Undocumented in either manual: routines 154 and 155 walk from x,y in
    // steps of STEP tiles, returning how many steps it took or -1 off the map
    const map = ['Get Icon 1,0,0 To 16,16', 'Reserve Scene 5,6,4', 'Scene Bank 5', 'Scene Change 4,1,9']
    expect(run([...map, 'Print Scene Scan X(0,1,1,9)'].join('\n')).out).toBe(' 4\n')
    expect(run([...map, 'Print Scene Scan X(0,1,2,9)'].join('\n')).out).toBe(' 2\n')
    expect(run([...map, 'Print Scene Scan X(0,0,1,9)'].join('\n')).out).toBe('-1\n')
    expect(run([...map, 'Print Scene Scan X(5,1,-1,9)'].join('\n')).out).toBe(' 1\n')
    expect(() => run([...map, 'Print Scene Scan X(0,1,0,9)'].join('\n'))).toThrow(/Illegal function call/)
  })

  it('Scene Scan Y counts down a column, and its negative form is broken', () => {
    // Scene Scan X's negative form scans for the first tile that is *not*
    // the value (`neg.l d5` then a `beq` loop at $4c30). Scene Scan Y has
    // the same branch but closes it with `bne` at $4cb0, so its negative
    // form searches for the positive value and behaves exactly like the
    // positive one. Its mode test reads d3 rather than d5, too — a register
    // that happens to hold the last argument evaluated, so that half of the
    // slip never shows.
    const map = ['Get Icon 1,0,0 To 16,16', 'Reserve Scene 5,6,4', 'Scene Bank 5', 'Scene Change 2,3,9']
    expect(run([...map, 'Print Scene Scan Y(2,0,1,9)'].join('\n')).out).toBe(' 3\n')
    expect(run([...map, 'Print Scene Scan Y(1,0,1,9)'].join('\n')).out).toBe('-1\n')
    // X: -1 means "the first tile that is not 1"; the map is all zeroes
    expect(run([...map, 'Print Scene Scan X(0,0,1,-1)'].join('\n')).out).toBe(' 0\n')
    // Y: -9 finds 9, exactly as +9 does
    expect(run([...map, 'Print Scene Scan Y(2,0,1,-9)'].join('\n')).out).toBe(' 3\n')
  })
})

describe('TURBO Multi Bload (disassembly)', () => {
  it('Multi Bload loads a file into a bank with the name it is given', () => {
    // Undocumented. The real routine CreateProc()s an AmigaDOS process which
    // opens the file, reserves a bank the size of it under the eight
    // characters given, reads it and exits; up to five run at once. There is
    // no second thread here, so the load happens now — which every program
    // that waits on Multi Bl Ended cannot tell apart.
    const { rt } = run('Multi Bload "data.bin","Level1",4', { 'data.bin': [1, 2, 3, 4, 5] })
    expect([...rt.memBanks.get(4)!.data]).toEqual([1, 2, 3, 4, 5])
    expect(rt.memBanks.get(4)!.name).toBe('Level1  ')
  })

  it('Multi Bl Ended is true once nothing is pending, and Multi Bl Error reports the failure', () => {
    // routine 174 returns -1 while the count at $6d4 is zero; routine 173
    // clears the error word whether or not it raises
    expect(run('Print Multi Bl Ended').out).toBe('-1\n')
    expect(() => run('Multi Bload "gone.bin","X",4 : Multi Bl Error')).toThrow(/file not found/)
    expect(() => run('Multi Bl Error')).not.toThrow()
    // reading it clears it, so a second read is silent
    expect(() => run('Multi Bload "gone.bin","X",4 : Multi Bl Error')).toThrow()
  })
})

describe('TURBO scenes: the 32-pixel family (TURBO_DocsV2.15.Asc + routine 122)', () => {
  // "'16/32' in the commands below means there are acutally 2 commands" —
  // routine 122 is routine 121 with the destination advancing four bytes a
  // column and thirty-two scanlines a row, and the viewport measured in
  // 32-pixel tiles. The icons here are still 16 wide, which changes nothing
  // about the arithmetic being checked.
  const icons = [
    'Cls 0',
    'Ink 3 : Bar 0,0 To 15,15',
    'Get Icon 1,0,0 To 16,16',
    'Ink 5 : Bar 0,0 To 15,15',
    'Get Icon 2,0,0 To 16,16',
    'Cls 0',
  ]
  const map = [...icons, 'Reserve Scene 5,4,3', 'Scene Bank 5', 'Scene Change 1,0,1', 'Scene Fill 5,0,1,4,2,1']
  const view = [...map, 'Scene 32 View 0,0,0 To 128,64']

  it('Scene 32 View measures the viewport in 32-pixel tiles and Scene 32 Do fills it', () => {
    const { rt } = run([...view, 'Scene 32 Do 0,0'].join('\n'))
    expect(rt.turbo.scene.view32).toMatchObject({ cols: 4, rows: 2, xb: 0, yb: 0, right: 12, bottom: 32 })
    expect(rt.screen.point(0, 0)).toBe(3)
    expect(rt.screen.point(32, 0)).toBe(5) // tile 1,0 four bytes along
    expect(rt.screen.point(0, 32)).toBe(5) // scene row 1, thirty-two lines down
  })

  it('Scene 32 Top, Bottom, Left and Right each redraw one edge', () => {
    expect(run([...view, 'Scene 32 Top 0,0'].join('\n')).rt.screen.point(0, 32)).toBe(0)
    expect(run([...view, 'Scene 32 Left 0,0'].join('\n')).rt.screen.point(32, 0)).toBe(0)
    expect(run([...view, 'Scene 32 Right 0,0'].join('\n')).rt.screen.point(96, 0)).toBe(3)
    // Bottom carries the same y2-32-as-a-byte-offset regression the 16 set has
    expect(run([...view, 'Scene 32 Bottom 0,0'].join('\n')).rt.screen.point(256, 0)).toBe(5)
  })

  it('Scene 32 Check shifts screen coordinates by 5', () => {
    expect(run([...map, 'Print Scene 32 Check(33,0)'].join('\n')).out).toBe(' 1\n')
    expect(run([...map, 'Print Scene 32 Check(31,0)'].join('\n')).out).toBe(' 0\n')
  })
})

describe('TURBO drawing reaches the bitplanes, not just the chunky cache', () => {
  /**
   * The screen's chunky buffer is a CACHE of the bitplanes, and the display
   * fetches planes and nothing else. So a keyword that writes `screen.pixels`
   * — read-only by contract — draws nothing at all, while every test that
   * reads back through `point()` or `pixels` still passes, because those read
   * the same cache.
   *
   * Five TURBO routines were doing exactly that: the star plotter, the blit
   * engine, the Stars-interrupt plane clear, F Circle and Blit Clear. Each
   * test here reads the PLANES directly, which is the only way to tell.
   */
  const fromPlanes = (rt: Runtime, x: number, y: number): number => {
    const s = rt.screen
    return getPixel(s.planarView('log', false), s.planeSize, s.rowBytes, s.depth, x, y)
  }

  it('Display Stars sets the star in plane 0', () => {
    const { rt } = run('Cls 0 : Reserve Stars 1 : Define Star 1,50,60,1,2 : Display Stars')
    expect(fromPlanes(rt, 50, 60) & 1).toBe(1)
  })

  it('F Circle draws into the planes', () => {
    const { rt } = run('Cls 0 : F Circle 60,60,20,5')
    expect(fromPlanes(rt, 60, 40)).toBe(5)
  })

  it('Blit Left moves the planes it shifts', () => {
    const { rt } = run(['Cls 0', 'Ink 3', 'Bar 0,0 To 40,40', 'Blit Left 0,0,0 To 320,200,4'].join('\n'))
    // whatever the shift lands on, the planes and the cache must agree — a
    // stranded blit leaves the planes holding the unshifted picture
    for (const [x, y] of [
      [0, 0],
      [20, 20],
      [44, 20],
    ] as const) {
      expect(fromPlanes(rt, x, y), `${x},${y}`).toBe(rt.screen.point(x, y))
    }
  })

  it('Blit Clear clears a named plane in the planes', () => {
    const { rt } = run(['Cls 0', 'Ink 3', 'Bar 0,0 To 40,40', 'Blit Clear 1'].join('\n'))
    // plane 0 gone, plane 1 still standing: pen 3 becomes pen 2
    expect(fromPlanes(rt, 20, 20)).toBe(2)
  })

  it('the top bitplane cannot be cleared by name, whatever the manual says', () => {
    // routine 48: the guard is `cmp.w d7,d0 : bge <error>` where d7 is the
    // screen's depth MINUS ONE, so a named plane must be strictly below it.
    // The manual's own example — "An 8 colour screen has 3 bitplanes,
    // numbered 1 -> 3" — therefore fails on 3.
    const three = 'Screen Open 1,320,200,8,Lowres : Cls 0 : '
    expect(() => run(three + 'Blit Clear 2')).not.toThrow()
    expect(() => run(three + 'Blit Clear 3')).toThrow(/Illegal function call/)
    expect(() => run(three + 'Blit Clear 0')).toThrow(/Illegal function call/)
  })

  it('only the low word of the argument chooses the plane', () => {
    // the sign test is on the long (`move.l (a3)+,d0 : bmi`) but the range
    // check and the index are word-width, so 65537 names plane 1
    const { rt } = run(['Cls 0', 'Ink 3', 'Bar 0,0 To 40,40', 'Blit Clear 65537'].join('\n'))
    expect(fromPlanes(rt, 20, 20)).toBe(2)
  })

  it('Blit Clear -1 clears every plane in the planes', () => {
    const { rt } = run(['Cls 0', 'Ink 3', 'Bar 0,0 To 40,40', 'Blit Clear -1'].join('\n'))
    expect(fromPlanes(rt, 20, 20)).toBe(0)
  })
})
