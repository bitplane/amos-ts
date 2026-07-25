import { describe, expect, it } from 'vitest'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { Runtime } from './runtime'
import { EXTENSION_TOKENS } from '../ext/registry'

const table = new TokenTable(CORE_TOKENS)
// Boom, Sam Loop Off, Mubase, Track Loop Of and Med * are Music-extension
// keywords and Unpack is a Compact one, so the tokenizer needs the stock
// extension tables to recognise them at all.
const extensions = new Map([...EXTENSION_TOKENS].map(([slot, defs]) => [slot, new TokenTable(defs)]))

function run(src: string): Runtime {
  const rt = new Runtime(tokenize(src, table, extensions), table, { maxSteps: 300_000, extensions })
  const r = rt.runHeadless(1_000)
  if (r.status !== 'ended' && r.status !== 'stopped') throw new Error(`program ${r.status}`)
  return rt
}

function runOut(src: string): string {
  let out = ''
  const rt = new Runtime(tokenize(src, table, extensions), table, { maxSteps: 300_000, extensions, onText: (t) => (out += t) })
  const r = rt.runHeadless(1_000)
  if (r.status !== 'ended' && r.status !== 'stopped') throw new Error(`program ${r.status}`)
  return out
}

const GRAB = 'Ink 5 : Bar 0,0 To 7,7 : Get Bob 1,0,0 To 8,8 : Cls 0'

describe('AMAL channels', () => {
  it('Amal Off stops one channel, or every channel with no argument', () => {
    let rt = run(`${GRAB}\nChannel 1 To Bob 1\nAmal 1,"Loop: Let X=X+1; Pause; Jump Loop"\nAmal On\nAmal Off 1`)
    expect(rt.channels.get(1)!.on).toBe(false)
    rt = run(`${GRAB}\nChannel 1 To Bob 1\nAmal 1,"Loop: Pause; Jump Loop"\nAmal On\nAmal Off`)
    expect(rt.channels.get(1)!.on).toBe(false)
    expect(rt.amalDefaultOn).toBe(false)
  })

  it('Amal Freeze suspends a channel without switching it off', () => {
    const rt = run(`${GRAB}\nChannel 1 To Bob 1\nAmal 1,"Loop: Pause; Jump Loop"\nAmal On\nAmal Freeze 1`)
    expect(rt.channels.get(1)!.frozen).toBe(true)
    expect(rt.channels.get(1)!.on).toBe(true)
  })

  it('Chanan reports whether a channel is running an animation', () => {
    // a channel with no Anim instruction is not animating
    expect(runOut(`${GRAB}\nChannel 1 To Bob 1\nAmal 1,"Loop: Pause; Jump Loop"\nPrint Chanan(1)`)).toBe(
      ' 0\n',
    )
  })

  it('Amalerr is 0 while no AMAL program has failed to compile', () => {
    expect(runOut(`${GRAB}\nChannel 1 To Bob 1\nAmal 1,"Loop: Pause; Jump Loop"\nPrint Amalerr`)).toBe(
      ' 0\n',
    )
  })

  it('Synchro Off hands stepping to the program, Synchro On gives it back', () => {
    expect(run('Synchro Off').synchroManual).toBe(true)
    expect(run('Synchro Off : Synchro On').synchroManual).toBe(false)
  })

  it('Synchro steps the interpreter once when stepping is manual', () => {
    // with Synchro Off nothing advances until Synchro is called, so the
    // statement must run cleanly and leave manual mode in force
    const rt = run(`${GRAB}\nChannel 1 To Bob 1\nAmal 1,"Loop: Pause; Jump Loop"\nAmal On\nSynchro Off\nSynchro`)
    expect(rt.synchroManual).toBe(true)
  })
})

describe('music and sample odds and ends', () => {
  it('Boom plays the built-in explosion without disturbing the program', () => {
    expect(() => run('Boom')).not.toThrow()
  })

  it('Mubase reports the music extension data zone address', () => {
    // FnMusicBase +Music.s:3907 — the vumeter bytes live at +0..3, so the
    // address must be non-zero for Peek to reach them
    expect(runOut('Print Mubase<>0')).toBe('-1\n')
  })

  it('Sam Loop Off clears sample looping', () => {
    expect(() => run('Sam Loop Off')).not.toThrow()
  })

  it('Track Loop Of and Med Cont/Med Midi On are accepted', () => {
    expect(() => run('Track Loop Of')).not.toThrow()
    expect(() => run('Med Cont')).not.toThrow()
    expect(() => run('Med Midi On')).not.toThrow()
  })
})

describe('screen and window odds and ends', () => {
  it('Def Scroll stores a zone that Scroll then moves', () => {
    const rt = run(
      [
        'Screen Open 0,320,200,16,Lowres : Cls 0',
        'Ink 7 : Bar 10,10 To 40,40',
        'Def Scroll 1,0,0 To 100,100,8,0',
        'Scroll 1',
      ].join('\n'),
    )
    expect(rt.scrollZones.get(1)).toMatchObject({ x1: 0, y1: 0, x2: 100, y2: 100, dx: 8, dy: 0 })
    // the block moved right by 8 pixels
    expect(rt.screen.point(20 + 8, 20)).toBe(7)
  })

  it('Scroll On and Scroll Off control whether the window scrolls at its foot', () => {
    expect(run('Scroll Off').screen.curWin.scrollOff).toBe(true)
    expect(run('Scroll Off : Scroll On').screen.curWin.scrollOff).toBe(false)
  })

  it('Shift Down installs a palette rotation and Shift Off removes it', () => {
    const rt = run('Screen Open 0,320,200,16,Lowres\nShift Down 1,1,4,2')
    expect(rt.shifts.get(rt.currentIndex)!.dir).toBe(-1)
    expect(run('Screen Open 0,320,200,16,Lowres\nShift Down 1,1,4,2\nShift Off').shifts.size).toBe(0)
  })

  it('Wind Move places the window on a 16-pixel horizontal grid', () => {
    // WiMove rounds x down to a multiple of 16, then adds the border inset
    const rt = run('Screen Open 0,320,200,16,Lowres\nWind Open 1,0,0,20,10\nWind Move 30,40')
    expect(rt.screen.curWin.x).toBe(16)
    expect(rt.screen.curWin.y).toBe(40)
  })

})

describe('zones, banks and system state', () => {
  it('Reset Zone clears one zone, or every zone', () => {
    let rt = run('Reserve Zone 4\nSet Zone 1,0,0 To 10,10\nSet Zone 2,20,20 To 30,30\nReset Zone 1')
    expect(rt.zones[0]).toBeFalsy()
    expect(rt.zones[1]).toBeDefined()
    rt = run('Reserve Zone 4\nSet Zone 1,0,0 To 10,10\nReset Zone')
    expect(rt.zones.filter(Boolean).length).toBe(0)
  })

  it('Set Sprite Buffer demands at least 16 scanlines (InSetSpriteBuffer +Lib.s:12290)', () => {
    expect(() => run('Set Sprite Buffer 16')).not.toThrow()
    expect(() => run('Set Sprite Buffer 15')).toThrow(/function call error/)
  })

  it('Icon Base reports the address of an icon in the bank', () => {
    expect(runOut('Ink 5 : Bar 0,0 To 7,7 : Get Icon 1,0,0 To 8,8\nPrint Icon Base(1)<>0')).toBe('-1\n')
  })

  it('Ins Icon and Del Icon reshape the icon bank', () => {
    let rt = run('Ink 5 : Bar 0,0 To 7,7\nGet Icon 1,0,0 To 8,8\nGet Icon 2,0,0 To 8,8\nDel Icon 2')
    expect(rt.iconBank!.images.length).toBe(1)
    rt = run('Ink 5 : Bar 0,0 To 7,7\nGet Icon 1,0,0 To 8,8\nIns Icon 1')
    expect(rt.iconBank!.images.length).toBe(2)
  })

  it('Unpack refuses a bank that was never reserved', () => {
    expect(() => run('Unpack 9,0')).toThrow(/bank not reserved/)
  })

  it('Prg Next$ walks the loaded-program list and ends with an empty string', () => {
    // standalone there is no parent editor, so the walk terminates at once
    expect(runOut('A$=Prg First$\nPrint Len(Prg Next$)')).toBe(' 0\n')
  })
})

describe('mouse and joystick reads', () => {
  it('X Mouse and Y Mouse report the pointer in hardware coordinates', () => {
    // the pointer starts inside the display window, so both are past the
    // (128,50) origin rather than at zero
    expect(runOut('Print X Mouse>=0;Y Mouse>=0')).toBe('-1-1\n')
  })

  it('Y Hard converts a screen row back to a hardware line', () => {
    expect(runOut('Screen Open 0,320,200,16,Lowres : Screen Display 0,128,50,320,200\nPrint Y Hard(0)')).toBe(
      ' 50\n',
    )
  })

  it('Mouse Screen reports which screen the pointer is over', () => {
    expect(() => run('Screen Open 0,320,200,16,Lowres\nA=Mouse Screen')).not.toThrow()
  })

  it('Jdown and Jright read the joystick without a stick attached', () => {
    // no hardware, so both directions read false rather than erroring
    expect(runOut('Print Jdown(1);Jright(1)')).toBe(' 0 0\n')
    // port 2 does not exist: only 0 and 1 are real (FJ +Lib.s:13716)
    expect(() => run('A=Jdown(2)')).toThrow(/function call error/)
  })
})

describe('machine memory reporting (AvailMem)', () => {
  it('Chip Free counts the screen bitplanes and chip banks against the pool', () => {
    // a constant would be worse than useless: a program reserving banks until
    // Chip Free runs out would never stop. Screen 0 is 320x200x4 planes, so
    // 40 bytes a row x 200 rows x 4 = 32000 bytes of the chip pool at boot.
    expect(runOut('Print Chip Free')).toBe(` ${2 * 1024 * 1024 - 32000}\n`)
    expect(runOut('Reserve As Chip Data 5,100000\nPrint Chip Free')).toBe(
      ` ${2 * 1024 * 1024 - 32000 - 100000}\n`,
    )
    // and Erase hands it back
    expect(runOut('Reserve As Chip Data 5,100000\nErase 5\nPrint Chip Free')).toBe(
      ` ${2 * 1024 * 1024 - 32000}\n`,
    )
  })

  it('a bigger screen costs more chip memory', () => {
    const before = Number(runOut('Print Chip Free'))
    const after = Number(runOut('Screen Open 1,640,400,16,Hires\nPrint Chip Free'))
    // 640x400x4 planes = 80 bytes a row x 400 x 4 = 128000
    expect(before - after).toBe(128000)
  })

  it('Fast Free tracks non-chip banks and leaves the chip pool alone', () => {
    const chip = runOut('Print Chip Free')
    const out = runOut('Reserve As Data 5,100000\nPrint Fast Free;Chip Free')
    expect(out).toBe(` ${8 * 1024 * 1024 - 100000}${chip.replace(/\n$/, '')}\n`)
  })

  it('Free reports variable space, not machine memory', () => {
    // FnFree +Lib.s:13600 reports TabBas-HiChaine — the BASIC variable and
    // string region, whose default buffer is 32K
    expect(runOut('Print Free')).toBe(` ${32 * 1024}\n`)
  })
})
