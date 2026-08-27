import { describe, expect, it } from 'vitest'
import { mustFinish } from '../testing/run'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/source'
import { Runtime } from './runtime'
import { EXTENSION_TOKENS } from '../ext/registry'

const table = new TokenTable(CORE_TOKENS)
const extensions = new Map([...EXTENSION_TOKENS].map(([slot, defs]) => [slot, new TokenTable(defs, true)]))

function run(src: string): Runtime {
  const rt = new Runtime(tokenize(src, table, extensions), table, { maxSteps: 300_000, extensions })
  const r = rt.runHeadless(1_000)
  mustFinish(r)
  return rt
}

function runOut(src: string): string {
  let out = ''
  const rt = new Runtime(tokenize(src, table, extensions), table, {
    maxSteps: 300_000,
    extensions,
    onText: (t) => (out += t),
  })
  const r = rt.runHeadless(1_000)
  mustFinish(r)
  return out
}

const GRAB = 'Ink 5 : Bar 0,0 To 7,7 : Get Bob 1,0,0 To 8,8 : Cls 0'

describe('STOS-style Anim and Move (their own slot table, not AMAL channels)', () => {
  it('Anim Off stops an animation and Anim Freeze suspends it', () => {
    let rt = run(`${GRAB}\nBob 1,10,10,1\nAnim 1,"(1,5)(1,5)"\nAnim On\nAnim Off 1`)
    expect(rt.stosSlots.get(1)!.anim!.on).toBe(false)
    rt = run(`${GRAB}\nBob 1,10,10,1\nAnim 1,"(1,5)(1,5)"\nAnim On\nAnim Freeze 1`)
    expect(rt.stosSlots.get(1)!.anim!.frozen).toBe(true)
    // Anim On clears a freeze as well as switching the animation on
    rt = run(`${GRAB}\nBob 1,10,10,1\nAnim 1,"(1,5)(1,5)"\nAnim Freeze 1\nAnim On 1`)
    expect(rt.stosSlots.get(1)!.anim!.frozen).toBe(false)
  })

  it('Anim Off with no number reaches every slot', () => {
    const rt = run(
      `${GRAB}\nBob 1,10,10,1\nBob 2,20,20,1\nAnim 1,"(1,5)(1,5)"\nAnim 2,"(1,5)(1,5)"\nAnim On\nAnim Off`,
    )
    expect(rt.stosSlots.get(1)!.anim!.on).toBe(false)
    expect(rt.stosSlots.get(2)!.anim!.on).toBe(false)
  })

  it('Move Y installs a vertical movement that Move Freeze suspends', () => {
    let rt = run(`${GRAB}\nBob 1,10,10,1\nMove Y 1,"(1,2,10)"\nMove On`)
    expect(rt.stosSlots.get(1)!.moveY).toBeDefined()
    expect(rt.stosSlots.get(1)!.moveY!.on).toBe(true)
    rt = run(`${GRAB}\nBob 1,10,10,1\nMove Y 1,"(1,2,10)"\nMove On\nMove Freeze 1`)
    expect(rt.stosSlots.get(1)!.moveY!.frozen).toBe(true)
  })

  it('Move Y rejects a slot number above the multiplexer limit', () => {
    // 16 slots normally; Synchro Off raises it to 64
    expect(() => run(`${GRAB}\nMove Y 16,"(1,2,10)"`)).toThrow(/Illegal function call/)
    expect(() => run(`${GRAB}\nSynchro Off\nMove Y 16,"(1,2,10)"`)).not.toThrow()
    expect(() => run(`${GRAB}\nSynchro Off\nMove Y 64,"(1,2,10)"`)).toThrow(/Illegal function call/)
  })
})

describe('image flip flags (FnRev +Lib.s:12715)', () => {
  it('Hrev, Vrev and Rev set flip bits on an image number', () => {
    // the flags ride in the top bits of the image number the bob keywords take
    expect(runOut('Print Hrev(1);Vrev(1);Rev(1)')).toBe(' 32769 16385 49153\n')
    // and they preserve the image number underneath
    expect(runOut('Print Vrev(3) and $3FFF')).toBe(' 3\n')
  })
})

describe('rainbows', () => {
  it('Rainbow needs Set Rainbow to have allocated the table first', () => {
    // without a definition there is no rainbow table to point at
    expect(() => run('Rainbow 0,1,50,20')).toThrow(/out of memory/)
  })

  it('Rainbow Del removes one rainbow, or all of them (TRDel +W.s:4131)', () => {
    const setup = 'Set Rainbow 0,0,16,"(1,1,15)","",""\nSet Rainbow 1,0,16,"(1,1,15)","",""'
    let rt = run(`${setup}\nRainbow 0,1,50,20\nRainbow 1,1,80,20\nRainbow Del 0`)
    expect(rt.rainbows.has(0)).toBe(false)
    expect(rt.rainbows.has(1)).toBe(true)
    rt = run(`${setup}\nRainbow 0,1,50,20\nRainbow 1,1,80,20\nRainbow Del`)
    expect(rt.rainbows.size).toBe(0)
  })
})

describe('zones and dialogs', () => {
  it('Hzone finds the zone under a hardware coordinate', () => {
    const prog = [
      'Screen Open 0,320,200,16,Lowres : Screen Display 0,128,50,320,200',
      'Reserve Zone 4',
      'Set Zone 1,10,10 To 50,50',
      'Print Hzone(128+20,50+20);Hzone(128+200,50+150)',
    ].join('\n')
    // inside zone 1, then well outside every zone
    expect(runOut(prog)).toBe(' 1 0\n')
  })

  it('Dialog Freeze and Dialog Unfreeze reject a channel that is not open', () => {
    // InDialogFreeze0/1 +Lib.s:14397 — a bad channel number is an error
    expect(() => run('Dialog Freeze 1')).toThrow()
    expect(() => run('Dialog Unfreeze 1')).toThrow()
    expect(() => run('Dialog Freeze 0')).toThrow(/Illegal function call/)
    // with no argument at all they sweep every open channel, so with none
    // open they are simply a no-op rather than an error
    expect(() => run('Dialog Freeze')).not.toThrow()
    expect(() => run('Dialog Unfreeze')).not.toThrow()
  })

  it('Zdialog errors on a channel that was never opened', () => {
    // FnZDialog +Lib.s:14603 resolves the channel before hit-testing
    expect(() => run('A=Zdialog(1,10,10)')).toThrow()
  })
})

describe('compiler extension no-ops', () => {
  it('Comp Test is recognised once the Compiler extension table is loaded', () => {
    // it lives in the Compiler extension, so the core table alone reads it
    // as a variable assignment and fails with "expected ="
    expect(runOut('Comp Test\nPrint "ok"')).toBe('ok\n')
  })
})

describe('Default and the font list', () => {
  it('Default returns the display to its boot state (InDefault +Lib.s:8681)', () => {
    // it is a display reset, not an error-handling keyword: every screen is
    // closed and screen 0 reopened 320x200x16 with the boot palette
    const rt = run(
      [
        'Screen Open 0,640,400,4,Hires',
        'Screen Open 3,320,100,2,Lowres',
        'Default',
      ].join('\n'),
    )
    expect(rt.screens.has(3)).toBe(false)
    const s = rt.screens.get(0)!
    expect([s.width, s.height, s.nColors]).toEqual([320, 200, 16])
    expect(s.palette[1]).toBe(0xa40) // the boot orange
  })

  it('Get Rom Fonts narrows the examined list to the resident fonts', () => {
    // Igf +Lib.s:9772 masks the list: 1 rom only, 2 disc only, 3 both.
    // Font$ reports "Rom " or "Disc" in the last four of its 38 characters.
    expect(runOut('Get Rom Fonts\nPrint Right$(Font$(1),4)')).toBe('Rom \n')
    expect(runOut('Get Rom Fonts\nPrint Left$(Font$(1),5)')).toBe('topaz\n')
    // only the two resident topaz sizes survive the filter
    expect(runOut('Get Rom Fonts\nPrint Len(Font$(2));Len(Font$(3))')).toBe(' 38 0\n')
    // and reading the list before examining it is an error
    expect(() => run('A$=Font$(1)')).toThrow(/fonts not examined/)
  })
})
