import { describe, expect, it } from 'vitest'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { Runtime } from './runtime'
import { compileAmal } from './amal'

const table = new TokenTable(CORE_TOKENS)

/** run the program to completion, then keep stepping frames */
function boot(src: string, extraFrames = 0): Runtime {
  const rt = new Runtime(tokenize(src, table), table, { maxSteps: 200_000 })
  rt.runHeadless(1_000)
  for (let i = 0; i < extraFrames; i++) rt.frame()
  return rt
}

describe('AMAL compiler', () => {
  it('skips lowercase comments and separators', () => {
    const p = compileAmal('Let RA=1 ; then jump to the end J E ; E: Let RB=2')
    // "Let"→L + lowercase "et" ignored; ';' ignored; label E:
    expect(p.main.length).toBeGreaterThan(2)
  })

  it('reports syntax errors with a position', () => {
    expect(() => compileAmal('M 10,')).toThrow(/operand/)
  })

  it('rejects cross-scope jumps', () => {
    expect(() => compileAmal('AU(I RA>0 J B) B: L RA=1 E')).toThrow(/autotest/)
  })
})

describe('AMAL execution', () => {
  it('moves a bob with fixed-point interpolation', () => {
    const rt = boot(
      [
        'Ink 5 : Bar 0,0 To 7,7 : Get Bob 1,0,0 To 8,8 : Cls 0',
        'Bob 1,10,20,1',
        'Channel 1 To Bob 1',
        'Amal 1,"M 30,15,10"',
        'Amal On',
      ].join('\n'),
      12,
    )
    const bob = rt.bobs.get(1)!
    expect([bob.x, bob.y]).toEqual([40, 35])
  })

  it('animates images in the background', () => {
    const rt = boot(
      ['Channel 2 To Sprite 2', 'Sprite 2,200,100,1', 'Amal 2,"A 0,(1,3)(2,3)"', 'Amal On'].join('\n'),
      3,
    )
    const first = rt.hwSprites.get(2)!.image
    for (let i = 0; i < 3; i++) rt.frame()
    const second = rt.hwSprites.get(2)!.image
    expect(first).not.toBe(second)
    expect([first, second].sort()).toEqual([1, 2])
  })

  it('evaluates expressions strictly left-to-right', () => {
    const rt = boot(['Amal 3,"L RA=2+3*4"', 'Amal On'].join('\n'), 2)
    expect(rt.amalGlobals[0]).toBe(20) // (2+3)*4, not 14
  })

  it('runs For/Next loops', () => {
    const rt = boot(['Amal 3,"L RB=0 F R0=1 T 5 L RB=RB+R0 N R0"', 'Amal On'].join('\n'), 3)
    expect(rt.amalGlobals[1]).toBe(15)
  })

  it('survives infinite jump loops via the per-frame budget', () => {
    const rt = boot(['Amal 3,"L: L RA=RA+1 J L"', 'Amal On'].join('\n'), 0)
    rt.frame() // must return, not hang
    rt.frame()
    expect(rt.amalGlobals[0]!).toBeGreaterThan(0)
  })

  it('redirects the main sequence from an autotest', () => {
    const prog = 'AU(I RA>0 D G X) W ; G: L RB=99 E'
    const rt = boot([`Amal 4,"${prog}"`, 'Amal On'].join('\n'), 3)
    expect(rt.amalGlobals[1]).toBe(0) // waiting
    rt.amalGlobals[0] = 1
    for (let i = 0; i < 3; i++) rt.frame()
    expect(rt.amalGlobals[1]).toBe(99)
  })

  it('drives Screen Offset for hardware scrolling', () => {
    const rt = boot(['Channel 9 To Screen Offset 0', 'Amal 9,"M 64,0,8"', 'Amal On'].join('\n'), 10)
    expect(rt.screens.get(0)!.offsetX).toBe(64)
  })

  it('exposes Amreg, Chanmv and X Bob to BASIC', () => {
    const out: string[] = []
    const rt = new Runtime(
      tokenize(
        [
          'Ink 5 : Bar 0,0 To 7,7 : Get Bob 1,0,0 To 8,8',
          'Bob 1,0,0,1',
          'Channel 1 To Bob 1',
          'Amreg(3)=7',
          'Amal 1,"M 100,0,50 ; L RD=RD+1"',
          'Amal On',
          'Wait 5',
          'Print Amreg(3);Chanmv(1)',
        ].join('\n'),
        table,
      ),
      table,
      { maxSteps: 100_000, onText: (t) => out.push(t) },
    )
    rt.runHeadless(100)
    expect(out.join('')).toContain(' 7-1')
  })

  it('freezes and resumes channels', () => {
    const rt = boot(['Channel 5 To Sprite 5', 'Sprite 5,100,100,1', 'Amal 5,"M 100,0,100"', 'Amal On'].join('\n'), 5)
    const x1 = rt.hwSprites.get(5)!.x
    rt.channels.get(5)!.frozen = true
    for (let i = 0; i < 5; i++) rt.frame()
    expect(rt.hwSprites.get(5)!.x).toBe(x1)
    rt.channels.get(5)!.frozen = false
    for (let i = 0; i < 5; i++) rt.frame()
    expect(rt.hwSprites.get(5)!.x).toBeGreaterThan(x1)
  })
})
