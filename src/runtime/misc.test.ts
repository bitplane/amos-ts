import { describe, expect, it } from 'vitest'
import { mustFinish } from '../testing/run'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/source'
import { Runtime } from './runtime'
import { EXTENSION_TOKENS } from '../ext/registry'
import { AmigaFS } from '../amiga/vfs'
import { ED_RUN_MESSAGES } from '../interp/errors.gen'
import { amosErrorCode, type AmosError } from '../interp/values'
import { amosSource } from '../cli/corpus'

const table = new TokenTable(CORE_TOKENS)
// Boom, Sam Loop Off, Mubase, Track Loop Of and Med * are Music-extension
// keywords and Unpack is a Compact one, so the tokenizer needs the stock
// extension tables to recognise them at all.
const extensions = new Map([...EXTENSION_TOKENS].map(([slot, defs]) => [slot, new TokenTable(defs, true)]))

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
  it('Amal Off DELETES a channel, one or all (OnOfFrz +W.s:8302)', () => {
    // `tst.w d3 / bmi.s DAMAL` unlinks the channel and gives its memory back
    // with FreeMm, so Off is not a flag and the program is gone
    let rt = run(`${GRAB}\nChannel 1 To Bob 1\nAmal 1,"Loop: Let X=X+1; Pause; Jump Loop"\nAmal On\nAmal Off 1`)
    expect(rt.channels.get(1)).toBeUndefined()
    rt = run(`${GRAB}\nChannel 1 To Bob 1\nAmal 1,"Loop: Pause; Jump Loop"\nAmal On\nAmal Off`)
    expect(rt.channels.size).toBe(0)
    expect(rt.amalDefaultOn).toBe(false)
    // and On afterwards has nothing left to unfreeze
    rt = run(`${GRAB}\nChannel 1 To Bob 1\nAmal 1,"Loop: Pause; Jump Loop"\nAmal On\nAmal Off 1\nAmal On 1`)
    expect(rt.channels.get(1)).toBeUndefined()
  })

  it('Channel bounds the channel at 64 and the target by its kind (InChannel +ILib.s:5569)', () => {
    expect(() => run(`${GRAB}\nChannel 63 To Bob 63`)).not.toThrow()
    expect(() => run(`${GRAB}\nChannel 64 To Bob 1`)).toThrow(/function call/)
    expect(() => run(`${GRAB}\nChannel -1 To Bob 1`)).toThrow(/function call/)
    // d5 is set by the type ladder: 64 for Sprite and Bob...
    expect(() => run(`${GRAB}\nChannel 1 To Bob 64`)).toThrow(/function call/)
    // ...8 for the Screen forms...
    expect(() => run(`${GRAB}\nChannel 1 To Screen Display 7`)).not.toThrow()
    expect(() => run(`${GRAB}\nChannel 1 To Screen Display 8`)).toThrow(/function call/)
    // ...and 4 for Rainbow
    expect(() => run(`${GRAB}\nChannel 1 To Rainbow 3`)).not.toThrow()
    expect(() => run(`${GRAB}\nChannel 1 To Rainbow 4`)).toThrow(/function call/)
  })

  it('Sprite Off takes the sprite\'s animation with it (DAdAMAL +W.s:8160)', () => {
    // HsXOff calls DAdAMAL, which walks the list and DAMALs every stream
    // whose AmAct matches the object
    const prog = `${GRAB}\nSprite 1,100,100,1\nChannel 1 To Sprite 1\nAmal 1,"Loop: Pause; Jump Loop"\nAmal On\n`
    expect(run(prog).channels.get(1)).toBeDefined()
    expect(run(prog + 'Sprite Off 1').channels.get(1)).toBeUndefined()
    // and the no-argument form is HsOff, the same sweep over every sprite
    expect(run(prog + 'Sprite Off').channels.size).toBe(0)
    // a different sprite's channel is left alone
    const two = `${GRAB}\nSprite 2,50,50,1\nChannel 2 To Sprite 2\nAmal 2,"Loop: Pause; Jump Loop"\nAmal On\n`
    expect(run(two + 'Sprite Off 1').channels.get(2)).toBeDefined()
  })

  it('Amreg measures its arguments and its registers are words (AmRR +Lib.s:11968)', () => {
    const base = `${GRAB}\nChannel 1 To Bob 1\nAmal 1,"Loop: Pause; Jump Loop"\n`
    // the global form is `cmp.l #26,d3 / Rbcc L_FonCall`, unsigned
    expect(runOut(`Amreg(0)=7 : Print Amreg(0)`)).toBe(' 7\n')
    expect(() => run(`Amreg(26)=1`)).toThrow(/function call/)
    expect(() => run(`Amreg(-1)=1`)).toThrow(/function call/)
    // the channel form is `cmp.l #64,d1` and `cmp.l #10,d3`
    expect(runOut(`${base}Amreg(1,9)=5 : Print Amreg(1,9)`)).toBe(' 5\n')
    expect(() => run(`${base}Amreg(1,10)=1`)).toThrow(/function call/)
    expect(() => run(`${base}Amreg(64,0)=1`)).toThrow(/function call/)
    // RegAMAL answers -1 for a channel with no AMAL program, and AmRR turns
    // that into the same error rather than a zero
    expect(() => run(`${GRAB}\nPrint Amreg(3,0)`)).toThrow(/function call/)
    // IAmR stores a word and FAmR sign-extends it back
    expect(runOut(`Amreg(0)=65535 : Print Amreg(0)`)).toBe('-1\n')
    expect(runOut(`Amreg(0)=32768 : Print Amreg(0)`)).toBe('-32768\n')
  })

  it('Amal Freeze is the one bit that On clears (AmBit $8000)', () => {
    const rt = run(`${GRAB}\nChannel 1 To Bob 1\nAmal 1,"Loop: Pause; Jump Loop"\nAmal On\nAmal Freeze 1`)
    expect(rt.channels.get(1)!.frozen).toBe(true)
    expect(rt.channels.get(1)!.on).toBe(true)
    // unlike Off, a frozen channel is still there and On resumes it
    const back = run(`${GRAB}\nChannel 1 To Bob 1\nAmal 1,"Loop: Pause; Jump Loop"\nAmal On\nAmal Freeze 1\nAmal On 1`)
    expect(back.channels.get(1)!.frozen).toBe(false)
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
    // FnMusicBase +Music.s:3881 — the vumeter bytes live at +0..3, so the
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

  it('Dual Playfield and Dual Priority check both screen numbers, error 50', () => {
    // InDualPlayfield +Lib.s:8881 and InDualPriority +Lib.s:8894 each call
    // CheckScreenNumber twice, and it is `cmp.l #8,d1 / Rbcc L_IllScN`
    // (+Lib.s:9169). IllScN is `moveq #6,d0 / Rbra L_EcWiErr` (+Lib.s:12983),
    // so 6 + 44 = 50, "Valid screen numbers range 0 to 7" — the message names
    // the very range the constant sets. A raw 6 is "Resume label not defined".
    const code = (src: string): number => {
      try {
        run(`Screen Open 0,320,200,4,Lowres\nScreen Open 1,320,200,4,Lowres\n${src}`)
        return 0
      } catch (e) {
        return amosErrorCode(e as AmosError)
      }
    }
    expect(code('Dual Playfield 0,8')).toBe(50)
    expect(code('Dual Playfield 8,1')).toBe(50)
    expect(code('Dual Playfield 0,-1')).toBe(50)
    expect(code('Dual Priority 0,8')).toBe(50)
    // in range but never made dual is EcE27, 27 + 44 = 71
    expect(code('Dual Priority 0,1')).toBe(71)
    expect(code('Dual Playfield 0,1')).toBe(0)
  })

  it('every screen keyword that names a number checks it, error 50', () => {
    // sixteen Rbsr L_CheckScreenNumber sites sit between +Lib.s:8739 and
    // +Lib.s:9128, and the check runs BEFORE the screen is looked up. The
    // port reached the lookup first, so an out-of-range number came back as
    // 47 "screen not opened" — a number that can never name a screen at all.
    const code = (src: string): number => {
      try {
        run(`Screen Open 0,320,200,4,Lowres
${src}`)
        return 0
      } catch (e) {
        return amosErrorCode(e as AmosError)
      }
    }
    for (const src of [
      'Screen 8', // InScreen +Lib.s:9128
      'Screen Open 8,320,200,4,Lowres', // ScOo2 +Lib.s:8949
      'Screen Close 8', // InScreenClose +Lib.s:8977
      'Screen Display 8,,,,', // InScreenDisplay +Lib.s:9002
      'Screen Offset 8,0,0', // InScreenOffset +Lib.s:9016
      'Screen Hide 8', // ScShHi +Lib.s:9057
      'Screen Show 8',
      'Screen To Front 8', // +Lib.s:9098
      'Screen To Back 8', // +Lib.s:9117
      'Screen Swap 8', // InScreenSwap1 +Lib.s:8871
      'Screen Clone 8', // InScreenClone +Lib.s:8912
      'A=Screen Width(8)', // FnScreenWidth1 +Lib.s:8759
      'A=Screen Height(8)', // FnScreenHeight1 +Lib.s:8739
    ]) {
      expect([src, code(src)]).toEqual([src, 50])
    }
    // the compare is unsigned, so a negative fails the same test
    expect(code('Screen -1')).toBe(50)
    expect(code('A=Screen Width(-1)')).toBe(50)
    // 7 is in range but not open: that IS "screen not opened"
    expect(code('Screen 7')).toBe(47)
    // an empty slot still means the current screen, and is not a number
    expect(code('A=Screen Width')).toBe(0)
    expect(code('Screen Hide')).toBe(0)
  })

  it('Wind Move and Wind Size refuse window 0 and a negative pair', () => {
    const code = (src: string): number => {
      try {
        run(`Screen Open 0,320,200,16,Lowres : Cls 0\n${src}`)
        return 0
      } catch (e) {
        return amosErrorCode(e as AmosError)
      }
    }
    // WiMove +W.s:13874 and WiSize +W.s:13944 both open `tst.w WiNumber(a5) /
    // bne.s / moveq #18,d0 / bra WOut`, and 18 + EcWiErr's 44 is 62. The
    // message table has nothing at 18 and "Text window 0 can't be closed" at 62
    expect(code('Wind Move 16,10')).toBe(62)
    expect(code('Wind Size 10,5')).toBe(62)
    // InWindmove +Lib.s:13081 and InWindsize +Lib.s:13095 read the pair
    // through two `Rbmi L_FonCall`
    expect(code('Wind Open 1,0,0,20,10\nWind Move -1,10')).toBe(23)
    expect(code('Wind Open 1,0,0,20,10\nWind Move 16,-1')).toBe(23)
    expect(code('Wind Open 1,0,0,20,10\nWind Size -1,5')).toBe(23)
    expect(code('Wind Open 1,0,0,20,10\nWind Move 16,10')).toBe(0)
  })

  it('Movon, Chanan and Chanmv share one channel range, 0 to 63', () => {
    // each opens `Rbsr L_FnAm1` (+Lib.s:11895, 11904, 11913) and FnAm1
    // (+Lib.s:11920) is `move.l d3,d1 / Rbmi L_FonCall / cmp.l #64,d1 / Rbcc`
    const bad = (src: string): boolean => {
      try {
        runOut(`${GRAB}\nPrint ${src}`)
        return false
      } catch (e) {
        return amosErrorCode(e as AmosError) === 23
      }
    }
    for (const f of ['Movon', 'Chanan', 'Chanmv']) {
      expect([f, bad(`${f}(-1)`)]).toEqual([f, true])
      expect([f, bad(`${f}(64)`)]).toEqual([f, true])
      expect([f, bad(`${f}(63)`)]).toEqual([f, false])
      expect([f, bad(`${f}(0)`)]).toEqual([f, false])
    }
  })

  it('X Sprite, Y Sprite and I Sprite take 0 to 63 and refuse the rest', () => {
    // FnXSprite +Lib.s:12037 `move.l d3,d1 / Rbmi L_FonCall / SyCall XYSp /
    // Rbne L_FonCall`. HsXY itself always reports success, so the refusal
    // comes from HsActAd's `cmp.w #HsNb,d1 / bcc.s HsAdE` (+W.s:11399) with
    // `HsNb equ 64` (+WEqu.s:177), HsAdE returning 1 past its own caller.
    const bad = (src: string): boolean => {
      try {
        runOut(`Screen Open 0,320,200,16,Lowres\nPrint ${src}`)
        return false
      } catch (e) {
        return amosErrorCode(e as AmosError) === 23
      }
    }
    for (const f of ['X Sprite', 'Y Sprite', 'I Sprite']) {
      expect([f, bad(`${f}(-1)`)]).toEqual([f, true])
      expect([f, bad(`${f}(64)`)]).toEqual([f, true])
      // in range and never used still reads the table, which is zero
      expect([f, bad(`${f}(63)`)]).toEqual([f, false])
      expect([f, bad(`${f}(0)`)]).toEqual([f, false])
    }
    expect(runOut('Screen Open 0,320,200,16,Lowres\nPrint X Sprite(5)')).toBe(' 0\n')
  })

  it('X Bob of a bob that was never made is an error, not zero', () => {
    // FnXBob +Lib.s:12012 is the same four instructions, but XYBob is BobXY
    // (+W.s:801) and it opens `bsr BobAd / bne.s BobxyE`. BobAd (+W.s:1163)
    // walks T_BbDeb's list for a matching BbNb and leaves at AdBb1 with
    // `moveq #1,d0` when there is none. The bobs are a list of what exists,
    // where the hardware sprites are a fixed table of 64 — so an unmade bob
    // fails where an unused sprite reads back zero.
    const bad = (src: string): boolean => {
      try {
        runOut(`Screen Open 0,320,200,16,Lowres\nPrint ${src}`)
        return false
      } catch (e) {
        return amosErrorCode(e as AmosError) === 23
      }
    }
    for (const f of ['X Bob', 'Y Bob', 'I Bob']) {
      expect([f, bad(`${f}(-1)`)]).toEqual([f, true])
      expect([f, bad(`${f}(3)`)]).toEqual([f, true])
    }
    // once the bob exists, all three read it back
    const made = 'Screen Open 0,320,200,16,Lowres\nGet Bob 1,0,0 To 16,16\nBob 3,40,50,1\n'
    expect(runOut(`${made}Print X Bob(3);Y Bob(3);I Bob(3)`)).toBe(' 40 50 1\n')
  })

  it('there are ten scrolling zones, and an undefined one is error 72', () => {
    const open = 'Screen Open 0,320,200,16,Lowres : Cls 0'
    const code = (src: string): number => {
      try {
        run(`${open}\n${src}`)
        return 0
      } catch (e) {
        return amosErrorCode(e as AmosError)
      }
    }
    // `NDScrolls equ 10` (+Equ.s:1430). InDefScroll +Lib.s:10179 is `tst.l d7 /
    // Rbeq L_FonCall / cmp.l #NDScrolls,d7 / Rbhi L_FonCall`, InScroll
    // +Lib.s:10194 the same range as `subq.l #1,d3 / cmp.l #NDScrolls,d3 / Rbcc`
    expect(code('Def Scroll 0,0,0 To 10,10,1,0')).toBe(23)
    expect(code('Def Scroll 11,0,0 To 10,10,1,0')).toBe(23)
    expect(code('Def Scroll 10,0,0 To 10,10,1,0')).toBe(0)
    expect(code('Scroll 0')).toBe(23)
    expect(code('Scroll 11')).toBe(23)
    // in range but never defined: ScNoDef +Lib.s:10225 `moveq #28,d0 / Rbra
    // L_EcWiErr`, and 28 + 44 is 72, "Scrolling zone not defined"
    expect(code('Scroll 5')).toBe(72)
    expect(code('Def Scroll 5,0,0 To 10,10,1,0\nScroll 5')).toBe(0)
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

  it('Set Sprite Buffer demands at least 16 scanlines (InSetSpriteBuffer +Lib.s:12261)', () => {
    expect(() => run('Set Sprite Buffer 16')).not.toThrow()
    expect(() => run('Set Sprite Buffer 15')).toThrow(/Illegal function call/)
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
    expect(() => run('Unpack 9 To 0')).toThrow(/bank not reserved/)
  })

  it('Prg Next$ walks the loaded-program list and ends with an empty string', () => {
    // standalone there is no parent editor, so the walk terminates at once
    expect(runOut('A$=Prg First$("")\nPrint Len(Prg Next$)')).toBe(' 0\n')
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
    // MLimA (+W.s:10977) caps any rectangle at 458x312, so nothing wider
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
    // FnMouseScreen (+Lib.s:11035) is `tst.w ScOn(a5) / Rbeq L_ScNOp` before
    // it asks XyMou anything, so with nothing open the answer is error 47 and
    // not the EntNul that means "over no screen"
    expect(() => run('Screen Close 0\nA=Mouse Screen')).toThrow(/screen not opened/i)
  })

  it('Jdown and Jright read the joystick without a stick attached', () => {
    // no hardware, so both directions read false rather than erroring
    expect(runOut('Print Jdown(1);Jright(1)')).toBe(' 0 0\n')
    // port 2 does not exist: only 0 and 1 are real (FJ +Lib.s:13684)
    expect(() => run('A=Jdown(2)')).toThrow(/Illegal function call/)
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
    // FnFree +Lib.s:13571 reports TabBas-HiChaine — the BASIC variable and
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

describe('Resource$ reaches all six message tables (FnResource +ILib.s:6670)', () => {
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
    // bytes in for Spack (PsLong, +Equ.s:912)
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

  it('the Y offset is a word, so 65536 lines down is no lines down', () => {
    // PacPar keeps everything in words -- the offset it stores is
    // `move.w d3,Pkdy(a1)` (+Compact.s:461) and the height test is the word
    // subtract `sub.w d3,d5 / Rble` (:290). 65536 has nothing in its low
    // word, so the whole screen is packed and Unpack puts it back at 0.
    const rt = run(
      [
        'Screen Open 0,320,100,16,Lowres',
        'Cls 0 : Ink 6 : Bar 0,0 To 319,99',
        'Spack 0 To 14,0,65536,10000,10000',
        'Cls 0',
        'Unpack 14',
      ].join('\n'),
    )
    const s = rt.screens.get(0)!
    expect([s.point(0, 0), s.point(319, 99)]).toEqual([6, 6])
  })

  it('Unpack writes both buffers when autoback is enabled', () => {
    const rt = run(
      [
        'Screen Open 0,320,100,16,Lowres',
        'Cls 0 : Ink 6 : Bar 0,0 To 31,31',
        'Spack 0 To 14',
        'Double Buffer : Autoback 1',
        'Cls 0',
        'Unpack 14',
      ].join('\n'),
    )
    const s = rt.screens.get(0)!
    expect(s.point(0, 0)).toBe(6)
    s.swap()
    expect(s.point(0, 0)).toBe(6)
  })
})

/**
 * The Compact extension's routine numbers, read out of BOTH sources.
 *
 * `Lib_Ini 0` (+Compact.s:75) starts the count and every `Lib_Def`,
 * `Lib_Par` and `Lib_Empty` after it takes the next number, so the assembler
 * source fixes the numbering on its own --- and the table below came out of
 * the shipped binary. Unpack's three forms are where this is worth checking:
 * they are 6, 9 and 7, because `Lib_Def UPack` sits between InUnpack3 and
 * InUnpack2 and takes 8.
 */
const COMPACT_SRC = amosSource('+Compact.s')

describe.skipIf(!COMPACT_SRC)('AMOSPro Compact 2.0: source against binary', () => {
  it('gives every keyword the routine number its Lib_Par sits at', () => {
    const slots: string[] = []
    for (const line of COMPACT_SRC!) {
      const m = /^\s+Lib_(Def|Par|Empty|Ini)\s*(\S*)/.exec(line)
      if (!m) continue
      if (m[1] === 'Ini') continue
      slots.push(m[2] === '' ? 'Empty' : m[2]!)
    }
    // Cold is 0, so the index in this list IS the routine number
    expect(slots.slice(0, 10)).toEqual([
      'Compact_Cold',
      'Empty',
      'InPack2',
      'InPack6',
      'InSPack2',
      'InSPack6',
      'InUnpack1',
      'InUnpack3',
      'UPack',
      'InUnpack2',
    ])
    const table = EXTENSION_TOKENS.get(2)!
    const named = (n: string): number => table.find((e) => e.name.replace(/^!/, '') === n)!.instr
    expect([named('pack'), named('spack'), named('unpack')]).toEqual([
      slots.indexOf('InPack2'),
      slots.indexOf('InSPack2'),
      slots.indexOf('InUnpack1'),
    ])
    // the three unnamed continuation entries, in table order
    expect(table.filter((e) => e.name === '' && e.spec !== '').map((e) => e.instr)).toEqual([
      slots.indexOf('InPack6'),
      slots.indexOf('InSPack6'),
      slots.indexOf('InUnpack2'),
      slots.indexOf('InUnpack3'),
    ])
  })

  it('defines three routines it never calls', () => {
    // JScnop is AMOS error 47 (:581) and nothing in the file reaches it, so
    // every screen complaint the extension makes is 23 instead. NoScr (:597)
    // is the "Not a packed screen" message, and Custom2 (:619) is a second
    // error entry point. The `L_` references are the call sites; a routine
    // with none is dead in its own library.
    const body = COMPACT_SRC!.join('\n')
    for (const dead of ['JScnop', 'NoScr', 'Custom2']) {
      expect([dead, (body.match(new RegExp(`L_${dead}\\b`, 'g')) ?? []).length]).toEqual([dead, 0])
    }
    // and the ones that are alive, for contrast
    expect((body.match(/L_NoPac\b/g) ?? []).length).toBe(3)
    expect((body.match(/L_JFoncall\b/g) ?? []).length).toBe(5)
  })
})

const REQUEST_SRC = amosSource('+Request.s')

describe.skipIf(!REQUEST_SRC)('AMOSPro Request 2.0: source against binary', () => {
  it('gives every keyword the routine number its Lib_Par sits at', () => {
    // the table's order is on, off, wb and the source's is wb, on, off, so
    // the numbers cross over --- which is the point of checking them
    const slots: string[] = []
    for (const line of REQUEST_SRC!) {
      const m = /^\s+Lib_(Def|Par|Empty|Ini)\s*(\S*)/.exec(line)
      if (!m || m[1] === 'Ini') continue
      slots.push(m[2] === '' ? 'Empty' : m[2]!)
    }
    expect(slots).toEqual([
      'Cold',
      'Empty',
      'InRequestWb',
      'InRequestOn',
      'InRequestOff',
      'Empty',
      'Empty',
    ])
    const table = EXTENSION_TOKENS.get(3)!
    const named = (n: string): number => table.find((e) => e.name === n)!.instr
    expect([named('request on'), named('request off'), named('request wb')]).toEqual([
      slots.indexOf('InRequestOn'),
      slots.indexOf('InRequestOff'),
      slots.indexOf('InRequestWb'),
    ])
  })

  it('is three constants handed to one SyCall, and nothing else', () => {
    // 159 lines, and every instruction between the Lib_Par lines is one of
    // these three. `Request_OnOff equ 100` (+Equ.s:364) reaches
    // WRequest_OnOff, which is `move.w d0,T_ReqFlag(a5) / rts` (+W.s:15871).
    const body = REQUEST_SRC!.join('\n')
    expect((body.match(/SyCall\tRequest_OnOff/g) ?? []).length).toBe(3)
    for (const [kw, val] of [
      ['InRequestWb', '#1'],
      ['InRequestOn', '#-1'],
      ['InRequestOff', '#0'],
    ] as const) {
      const at = REQUEST_SRC!.findIndex((l) => l.includes(`Lib_Par\t${kw}`))
      expect([kw, REQUEST_SRC![at + 2]!.trim()]).toEqual([kw, `moveq\t${val},d0`])
    }
  })
})

describe('Unpack (InUnpack1/2/3, +Compact.s:173/231/186)', () => {
  const SPACKED = ['Screen Open 0,320,100,16,Lowres', 'Cls 0 : Ink 4 : Bar 8,8 To 100,60', 'Spack 0 To 10']

  it('a bank that is not a packed picture is the extension error, not AMOS 23', () => {
    // `Rbeq L_NoPac` (:206) is `moveq #0,d0 / Rbra L_Custom` (:592), and
    // Custom hands L_ErrorExt the table at :613. This port used to raise 23,
    // which is what the source it could not read would have made obvious.
    expect(() => run('Screen Open 0,320,100,16,Lowres : Reserve As Work 9,64 : Unpack 9')).toThrow(
      /Not a packed bitmap/,
    )
    expect(() => run('Reserve As Work 9,64 : Unpack 9 To 3')).toThrow(/Not a packed bitmap/)
  })

  it('a bitmap-only bank To a screen reports the BITMAP message', () => {
    // the message that fits is "Not a packed screen", ErrMes+20, and
    // nothing raises it: `Lib_Def NoScr` (:597) is the label's only mention
    // in the file. UnPack_Screen's `bne .NoPac` (+Lib.s:25474) answers
    // d0=0 with d1=0, and :243's `tst.w d1 / Rbeq L_NoPac` sends that to the
    // bitmap wording.
    expect(() =>
      run(['Screen Open 0,320,100,16,Lowres', 'Pack 0 To 11', 'Unpack 11 To 4'].join('\n')),
    ).toThrow(/Not a packed bitmap/)
  })

  it('needs a current screen, before it looks at the bank at all', () => {
    // `move.l ScOnAd(a5),d0 / Rbeq L_JFoncall` opens InUnpack1 (:175) and
    // InUnpack3 (:188), and JFoncall is `moveq #23,d0` (:576). Bank 9 is
    // never reserved here and never reached.
    expect(() => run('Screen Close 0 : Unpack 9')).toThrow(/function call/)
    expect(() => run('Screen Close 0 : Unpack 9,0,0')).toThrow(/function call/)
    // InUnpack2 has no such test: it makes the screen itself
    const rt = run([...SPACKED, 'Screen Close 0', 'Unpack 10 To 2'].join('\n'))
    expect(rt.screens.get(2)!.point(50, 30)).toBe(4)
  })

  it('refuses a picture that would not fit, rather than clipping it', () => {
    // UnPack_Bitmap's `add.w d1,d0 / cmp.w d7,d0 / bhi NoPac0`
    // (+Lib.s:25570) is X plus the width in BYTES against EcTLigne, and
    // :25576 is the same for Y. The
    // picture here is 40 bytes wide and 100 lines, so one byte across or one
    // line down is already off the edge.
    expect(() => run([...SPACKED, 'Unpack 10,8,0'].join('\n'))).toThrow(/Not a packed bitmap/)
    expect(() => run([...SPACKED, 'Unpack 10,0,1'].join('\n'))).toThrow(/Not a packed bitmap/)
    // and it goes on at 0,0
    const rt = run([...SPACKED, 'Cls 0', 'Unpack 10,0,0'].join('\n'))
    expect(rt.screens.get(0)!.point(50, 30)).toBe(4)
  })

  it('refuses a screen whose plane count is not the picture\'s', () => {
    // UnPack_Bitmap's `cmp.w Pknplan(a0),d0 / bne NoPac0` (+Lib.s:25555)
    expect(() =>
      run([...SPACKED, 'Screen Open 1,320,100,32,Lowres', 'Unpack 10'].join('\n')),
    ).toThrow(/Not a packed bitmap/)
  })

  it('a negative coordinate is the picture\'s own, and Unpack ignores Clip', () => {
    // `lsr.w #3,d1 / tst.l d1 / bpl.s dec1 / move.w Pkdx(a0),d1`
    // in UnPack_Bitmap (+Lib.s:25560) tests the LONG after shifting the
    // WORD, so -1 is still
    // negative and reaches Pkdx. UnPack_Bitmap then writes the bitplanes
    // with `move.b d3,(a0)` and consults no clip window on the way.
    const rt = run(
      [...SPACKED, 'Cls 0', 'Clip 0,0 To 8,8', 'Unpack 10,-1,-1'].join('\n'),
    )
    expect(rt.screens.get(0)!.point(50, 30)).toBe(4)
  })

  it('under 1024 is a bank number and the rest is an address (Bnk.OrAdr)', () => {
    // `cmp.l #1024,d0 / bge.s .Skip` (+Lib.s:8053), reached from :200 and
    // :234. Bank 9 unreserved is the bank error and not a wild address.
    expect(() => run('Screen Open 0,320,100,16,Lowres : Unpack 9')).toThrow(/bank not reserved/)
    // and `bge` is signed, so a negative is a bank number too, not an address
    expect(() => run('Screen Open 0,320,100,16,Lowres : Unpack -1')).toThrow(/bank not reserved/)
    // and an address inside the bank works, which is how a program keeps
    // several pictures in one bank behind an offset table
    const rt = run([...SPACKED, 'Cls 0', 'Unpack Start(10)'].join('\n'))
    expect(rt.screens.get(0)!.point(50, 30)).toBe(4)
  })
})

describe('Psel$ (FnPSel +Lib.s:6742)', () => {
  it('hands back its last argument, because the original is a bare rts', () => {
    // FnPSel has no body at all — the token table carries the keyword and
    // the routine is a single `rts`, so d3 (the last argument evaluated) is
    // still sitting in the result register when it returns
    expect(runOut('Print Psel$("DH0:","name.abk")')).toBe('name.abk\n')
  })
})
