import { describe, expect, it } from 'vitest'
import { mustFinish } from '../testing/run'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { Runtime } from './runtime'
import { EXTENSION_TOKENS } from '../ext/registry'
import { AmigaFS } from '../amiga/vfs'
import { ED_RUN_MESSAGES } from '../interp/errors.gen'

const table = new TokenTable(CORE_TOKENS)
// Boom, Sam Loop Off, Mubase, Track Loop Of and Med * are Music-extension
// keywords and Unpack is a Compact one, so the tokenizer needs the stock
// extension tables to recognise them at all.
const extensions = new Map([...EXTENSION_TOKENS].map(([slot, defs]) => [slot, new TokenTable(defs)]))

function run(src: string): Runtime {
  const rt = new Runtime(tokenize(src, table, extensions), table, { maxSteps: 300_000, extensions })
  const r = rt.runHeadless(1_000)
  mustFinish(r)
  return rt
}

function runOut(src: string): string {
  let out = ''
  const rt = new Runtime(tokenize(src, table, extensions), table, { maxSteps: 300_000, extensions, onText: (t) => (out += t) })
  const r = rt.runHeadless(1_000)
  mustFinish(r)
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
    expect(rt.screen.zones[0]).toBeFalsy()
    expect(rt.screen.zones[1]).toBeDefined()
    rt = run('Reserve Zone 4\nSet Zone 1,0,0 To 10,10\nReset Zone')
    expect(rt.screen.zones.filter(Boolean).length).toBe(0)
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

  it('X Mouse = and Y Mouse = move the pointer (InXMouse/InYMouse -> MSetAb)', () => {
    // each sets one axis; MSetAb leaves the other alone (EntNul in the
    // register it does not receive)
    const rt = run('X Mouse=200\nY Mouse=120')
    expect(rt.input.mouseX).toBe(200)
    expect(rt.input.mouseY).toBe(120)
    expect(runOut('X Mouse=200 : Print X Mouse;Y Mouse=Y Mouse')).toBe(' 200-1\n')
  })

  it('X Mouse = clamps inside Limit Mouse (MSetAb, unsigned)', () => {
    const rt = run('Limit Mouse 200,100 To 260,140\nX Mouse=400 : Y Mouse=0')
    expect(rt.input.mouseX).toBe(260)
    expect(rt.input.mouseY).toBe(100)
  })

  it('a negative X Mouse = lands on the far limit, not the near one', () => {
    // MSetAb compares with bcc/bcs where the vbl clamp (MousInt +W.s:10556)
    // uses bge/ble: doubled, -1 is $FFFE, which is above every limit
    // unsigned, so it fails "below max" and clamps up
    const rt = run('Limit Mouse 200,100 To 260,140\nX Mouse=-1')
    expect(rt.input.mouseX).toBe(260)
  })

  it('with no Limit Mouse the hardware cap MLimA enforces stands in', () => {
    // MLimA (+W.s:11006) caps any rectangle at 458x312, so nothing wider
    // can ever be in force
    const rt = run('X Mouse=1000 : Y Mouse=1000')
    expect(rt.input.mouseX).toBe(458)
    expect(rt.input.mouseY).toBe(312)
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

describe('Load Iff with a palette-only picture', () => {
  it('takes the colours and leaves the bitmap alone', () => {
    // The Plasma procedures ship IFFs whose BMHD is 0x0 with 0 planes and
    // nothing but a CMAP. Load Iff must apply the palette without trying to
    // resize or blank the screen.
    const fs = new AmigaFS()
    const dh0 = fs.mountMemory('DH0')
    const pal = new Uint8Array(48 + 96)
    const dv = new DataView(pal.buffer)
    const tag = (o: number, s: string): void => {
      for (let i = 0; i < 4; i++) pal[o + i] = s.charCodeAt(i)
    }
    tag(0, 'FORM')
    dv.setUint32(4, pal.length - 8)
    tag(8, 'ILBM')
    tag(12, 'BMHD')
    dv.setUint32(16, 20) // BMHD stays all zero: 0x0, 0 planes
    tag(40, 'CMAP')
    dv.setUint32(44, 96)
    pal[48 + 3 * 3] = 0xff // colour 3 = red
    dh0.write(['pal.iff'], pal)
    fs.currentDir = 'DH0:'

    let out = ''
    const rt = new Runtime(
      tokenize(
        'Screen Open 0,320,200,32,Lowres\nLoad Iff "pal.iff",0\nPrint Colour(3);Screen Width',
        table,
        extensions,
      ),
      table,
      { maxSteps: 300_000, extensions, fs, onText: (t) => (out += t) },
    )
    const r = rt.runHeadless(1_000)
    expect(r.status === 'ended' || r.status === 'stopped').toBe(true)
    expect(out).toBe(' 3840 320\n')
  })
})

describe('Resource$ reaches all six message tables (FnResource +ILib.s:6699)', () => {
  it('0 is the system path and -1.. the interpreter-config messages', () => {
    expect(runOut('Print Resource$(0)')).toBe('AMOSPro:\n')
    expect(runOut('Print Resource$(-8)')).toBe('AMOSPro_Default_Resource.Abk\n')
  })

  it('-1001 and deeper walk the editor tables a thousand apart', () => {
    // Ed_Systeme, then the menu block, the editor messages, the test-time
    // errors and the run-time errors — each 1-based within its own block
    expect(runOut('Print Resource$(-1003)')).toBe(' Edit\n')
    expect(runOut('Print Resource$(-1043)')).toBe('System\n')
    expect(runOut('Print Resource$(-3001)')).toBe('Link cursor movement: please click on the window to link...\n')
    expect(runOut('Print Resource$(-4001)')).toBe('Bad structure\n')
    expect(runOut('Print Resource$(-4005)')).toBe('Extension not loaded\n')
  })

  it('the run-time block is the error table, one record ahead of the code', () => {
    // .Error1 starts its numbering at 0 with an empty record, so error 1
    // is record 2 — and Err$ of the same code agrees
    expect(runOut('Print Resource$(-5001)')).toBe('\n')
    expect(runOut('Print Resource$(-5002)')).toBe('RETURN without GOSUB\n')
    expect(runOut('Print Resource$(-5027)')).toBe(runOut('Print Err$(26)'))
  })

  it('an index past the end of a block reads empty, but -6001 is an error', () => {
    expect(runOut('Print Resource$(-1999)')).toBe('\n')
    expect(() => run('Print Resource$(-6001)')).toThrow(/Illegal function call/)
  })

  it('Err$ answers for the whole table, not just the transcribed part', () => {
    // 'Instruction not implemented' (code 12) is one of the 101 messages the
    // hand-written table never carried. Core codes index the block directly.
    expect(runOut('Print Err$(12)')).toBe(ED_RUN_MESSAGES[12] + '\n')
  })

  it('device codes read at their own row, like every other code', () => {
    // +IO_Ports.s anchors the device range twice -- `move.w #145,d3` for
    // serial and `#171` for parallel -- and Dev.GetIO's 140/141 land the same
    // way. This test used to assert the block ran 14 rows below these numbers
    // and had to be shifted; the block was simply fourteen records short.
    expect(runOut('Print Err$(140)')).toBe('Device already opened\n')
    expect(runOut('Print Err$(145)')).toBe('Serial device already in use\n')
    expect(runOut('Print Err$(171)')).toBe('Parallel device already used\n')
    expect(runOut('Print Err$(188)')).toBe(ED_RUN_MESSAGES[188] + '\n')
  })
})

describe('Pack / Spack', () => {
  it('round-trips a drawn screen through a bank and back', () => {
    const rt = run(
      [
        'Screen Open 0,320,100,16,Lowres',
        'Cls 0 : Ink 5 : Bar 10,10 To 100,60 : Ink 3 : Draw 0,0 To 319,99',
        'Spack 0 To 10',
        'Cls 0',
        'Unpack 10',
      ].join('\n'),
    )
    const bank = rt.memBanks.get(10)!
    expect(bank.name).toBe('Pac.Pic.')
    const s = rt.screens.get(0)!
    // the picture came back: the bar and the diagonal are where they were
    expect(s.point(50, 30)).toBe(5)
    expect(s.point(0, 0)).toBe(3)
    expect(s.point(200, 90)).toBe(0)
  })

  it('Pack writes the bitmap alone, Spack prefixes the screen definition', () => {
    const rt = run(
      ['Screen Open 0,320,100,16,Lowres', 'Cls 3', 'Pack 0 To 11', 'Spack 0 To 12'].join('\n'),
    )
    const packed = rt.memBanks.get(11)!.data
    const spacked = rt.memBanks.get(12)!.data
    // $06071963 straight away for Pack; $12031990 then the same bitmap 90
    // bytes in for Spack (PsLong, +Equ.s:940)
    expect([...packed.subarray(0, 4)]).toEqual([0x06, 0x07, 0x19, 0x63])
    expect([...spacked.subarray(0, 4)]).toEqual([0x12, 0x03, 0x19, 0x90])
    expect([...spacked.subarray(90, 94)]).toEqual([0x06, 0x07, 0x19, 0x63])
    expect(spacked.length).toBe(packed.length + 90)
  })

  it('packs only the requested rectangle, x forced to byte boundaries', () => {
    const rt = run(
      [
        'Screen Open 0,320,100,16,Lowres',
        'Cls 0 : Ink 7 : Bar 0,0 To 319,99',
        'Spack 0 To 13,60,20,140,60',
        'Cls 0',
        'Unpack 13',
      ].join('\n'),
    )
    const s = rt.screens.get(0)!
    // Unpack puts it back at the packed origin: 60 rounds down to 56
    expect(s.point(56, 20)).toBe(7)
    expect(s.point(55, 20)).toBe(0)
    expect(s.point(56, 19)).toBe(0)
    // 140 rounds down to 17 bytes, so the last packed column is pixel 135
    expect(s.point(135, 59)).toBe(7)
    expect(s.point(136, 59)).toBe(0)
    expect(s.point(135, 60)).toBe(0)
  })

  it('rejects an empty rectangle and an out-of-range bank', () => {
    expect(() => run('Screen Open 0,320,100,16,Lowres : Spack 0 To 10,100,10,100,50')).toThrow(/function call/)
    expect(() => run('Screen Open 0,320,100,16,Lowres : Spack 0 To 70000')).toThrow(/function call/)
  })
})

describe('Psel$ (FnPSel +Lib.s:6771)', () => {
  it('hands back its last argument, because the original is a bare rts', () => {
    // FnPSel has no body at all — the token table carries the keyword and
    // the routine is a single `rts`, so d3 (the last argument evaluated) is
    // still sitting in the result register when it returns
    expect(runOut('Print Psel$("DH0:","name.abk")')).toBe('name.abk\n')
  })
})
