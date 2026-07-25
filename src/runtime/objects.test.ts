import { describe, expect, it } from 'vitest'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { Runtime } from './runtime'

const table = new TokenTable(CORE_TOKENS)

function run(src: string): Runtime {
  const rt = new Runtime(tokenize(src, table), table, { maxSteps: 300_000 })
  const r = rt.runHeadless(1_000)
  if (r.status !== 'ended' && r.status !== 'stopped') throw new Error(`program ${r.status}`)
  return rt
}

function runOut(src: string): string {
  let out = ''
  const rt = new Runtime(tokenize(src, table), table, { maxSteps: 300_000, onText: (t) => (out += t) })
  const r = rt.runHeadless(1_000)
  if (r.status !== 'ended' && r.status !== 'stopped') throw new Error(`program ${r.status}`)
  return out
}

/** Paint a solid 8x8 block of colour 5 and grab it as sprite-bank image 1. */
const GRAB = 'Ink 5 : Bar 0,0 To 7,7 : Get Bob 1,0,0 To 8,8 : Cls 0'

describe('bob display list', () => {
  it('Bob Off drops one bob, or every bob when given no number', () => {
    let rt = run(`${GRAB}\nBob 1,10,10,1\nBob 2,20,20,1\nBob Off 1`)
    expect([...rt.bobs.keys()]).toEqual([2])
    rt = run(`${GRAB}\nBob 1,10,10,1\nBob 2,20,20,1\nBob Off`)
    expect(rt.bobs.size).toBe(0)
  })

  it('Bob Off restores the background it was covering', () => {
    // the bob is drawn, then removed; the screen must come back clean
    const rt = run(`${GRAB}\nBob 1,40,40,1\nBob Draw\nBob Off 1`)
    expect(rt.screen.point(42, 42)).toBe(0)
  })

  it('Bob Draw and Bob Clear are the manual double-buffer pair, under Update Off', () => {
    // They only make sense with the automatic pass disabled: with Update On
    // the next VBL redraws whatever Bob Clear just erased, because the bob is
    // still in the display list. That is why Bob Off (which also removes it)
    // leaves a clean screen while Bob Clear on its own does not.
    let rt = run(`Update Off\n${GRAB}\nBob 1,40,40,1\nBob Draw`)
    expect(rt.screen.point(42, 42)).toBe(5)
    rt = run(`Update Off\n${GRAB}\nBob 1,40,40,1\nBob Draw\nBob Clear`)
    expect(rt.screen.point(42, 42)).toBe(0)
    // and with the automatic pass left on, Bob Clear is undone again
    rt = run(`${GRAB}\nBob 1,40,40,1\nBob Draw\nBob Clear`)
    expect(rt.screen.point(42, 42)).toBe(5)
  })

  it('Bob Update runs one manual pass of the same pipeline', () => {
    const rt = run(`Update Off\n${GRAB}\nBob 1,40,40,1\nBob Update`)
    expect(rt.screen.point(42, 42)).toBe(5)
  })

  it('Bob Update On/Off and Update On gate the automatic pass (+Lib.s:11452-11527)', () => {
    expect(run('Bob Update Off').bobUpdateOn).toBe(false)
    expect(run('Bob Update Off : Bob Update On').bobUpdateOn).toBe(true)
    // Update On/Off drive both pipelines at once, bobs and hardware sprites
    const both = run('Update Off : Update On')
    expect([both.bobUpdateOn, both.spriteUpdateOn]).toEqual([true, true])
    const off = run('Update Off')
    expect([off.bobUpdateOn, off.spriteUpdateOn]).toEqual([false, false])
  })

  it('Update Every sets the automatic period and rejects a word overflow', () => {
    expect(run('Update Every 3').updateEvery).toBe(3)
    // InUpdateEvery takes a word, so 65536 is out of range
    expect(() => run('Update Every 65536')).toThrow(/function call error/)
    // 0 would mean never, so it is clamped to every VBL
    expect(run('Update Every 0').updateEvery).toBe(1)
  })

  it('Put Bob stamps a live bob permanently into the background', () => {
    // after Put Bob the pixels survive a Bob Clear, because they are now
    // part of the screen rather than the display list (InPutBob +Lib.s:12723)
    const rt = run(`${GRAB}\nBob 1,40,40,1\nBob Draw\nPut Bob 1\nBob Clear`)
    expect(rt.screen.point(42, 42)).toBe(5)
  })

  it('I Bob reports the image a bob is currently showing', () => {
    expect(runOut(`${GRAB}\nBob 1,10,10,1\nPrint I Bob(1)`)).toBe(' 1\n')
  })
})

describe('bob and sprite priority (PF2P ordering)', () => {
  it('Priority On/Off and the Reverse forms set the ordering flags', () => {
    expect(run('Priority On').priorityOn).toBe(true)
    expect(run('Priority On : Priority Off').priorityOn).toBe(false)
    const rev = run('Priority Reverse On')
    expect([rev.priorityOn, rev.priorityReverse]).toEqual([true, true])
    // Reverse Off leaves priority enabled and only clears the direction
    const back = run('Priority Reverse On : Priority Reverse Off')
    expect([back.priorityOn, back.priorityReverse]).toEqual([true, false])
  })
})

describe('hardware sprites', () => {
  it('Sprite Off removes one sprite, or all of them', () => {
    let rt = run(`${GRAB}\nSprite 8,100,50,1\nSprite 9,120,50,1\nSprite Off 8`)
    expect([...rt.hwSprites.keys()]).toEqual([9])
    rt = run(`${GRAB}\nSprite 8,100,50,1\nSprite 9,120,50,1\nSprite Off`)
    expect(rt.hwSprites.size).toBe(0)
  })

  it('Sprite Update On re-enables the buffered sprite pipeline', () => {
    expect(run('Update Off : Sprite Update On').spriteUpdateOn).toBe(true)
  })

  it('Sprite rejects a number outside 0..63 (InSprite +Lib.s:12315)', () => {
    expect(() => run(`${GRAB}\nSprite 64,0,0,1`)).toThrow(/illegal sprite number/)
  })

  it('Sprite Col and Spritebob Col report no collision when nothing overlaps', () => {
    // with a single object there is nothing to hit, so the mask is zero
    expect(runOut(`${GRAB}\nSprite 8,100,50,1\nPrint Sprite Col(8)`)).toBe(' 0\n')
    expect(runOut(`${GRAB}\nBob 1,10,10,1\nPrint Spritebob Col(1)`)).toBe(' 0\n')
  })
})

describe('image banks and masks', () => {
  it('Get Sprite and Get Icon grab into their own banks', () => {
    const rt = run('Ink 5 : Bar 0,0 To 7,7\nGet Sprite 1,0,0 To 8,8\nGet Icon 1,0,0 To 8,8')
    expect(rt.spriteBank?.image(1)).toBeDefined()
    expect(rt.iconBank?.image(1)).toBeDefined()
  })

  it('Del Sprite and Del Icon remove an image from its bank', () => {
    const rt = run(
      ['Ink 5 : Bar 0,0 To 7,7', 'Get Sprite 1,0,0 To 8,8', 'Get Sprite 2,0,0 To 8,8', 'Del Sprite 2'].join(
        '\n',
      ),
    )
    expect(rt.spriteBank?.images.length).toBe(1)
  })

  it('Ins Sprite and Ins Icon open a gap in the bank', () => {
    const rt = run(
      ['Ink 5 : Bar 0,0 To 7,7', 'Get Sprite 1,0,0 To 8,8', 'Ins Sprite 1'].join('\n'),
    )
    // the inserted blank pushes the grabbed image up to slot 2
    expect(rt.spriteBank!.images.length).toBe(2)
  })

  it('No Mask makes an image opaque, and Make Mask is accepted', () => {
    const rt = run('Ink 5 : Bar 0,0 To 7,7\nGet Sprite 1,0,0 To 8,8\nNo Mask 1')
    expect(rt.spriteBank!.image(1)!.opaque).toBe(true)
    // masks are implicit in this port; the keywords must still parse and run
    expect(() => run('Ink 5 : Bar 0,0 To 7,7\nGet Sprite 1,0,0 To 8,8\nMake Mask 1')).not.toThrow()
    expect(() => run('Ink 5 : Bar 0,0 To 7,7\nGet Icon 1,0,0 To 8,8\nMake Icon Mask 1')).not.toThrow()
    expect(() => run('Ink 5 : Bar 0,0 To 7,7\nGet Icon 1,0,0 To 8,8\nNo Icon Mask 1')).not.toThrow()
  })

  it('Paste Icon stamps an icon into the screen permanently', () => {
    const rt = run('Ink 5 : Bar 0,0 To 7,7 : Get Icon 1,0,0 To 8,8 : Cls 0\nPaste Icon 60,60,1')
    expect(rt.screen.point(62, 62)).toBe(5)
  })

  it('the Get *Palette family leaves colours alone when the bank carries none', () => {
    // A bank grabbed off the screen has no palette of its own — only one
    // loaded from disc or built in the sprite editor does. So these must be
    // a no-op here rather than clearing the screen to black.
    const out = runOut(
      [
        'Screen Open 0,320,200,16,Lowres',
        'Colour 3,$F00 : Ink 3 : Bar 0,0 To 7,7',
        'Get Sprite 1,0,0 To 8,8',
        'Colour 3,$00F',
        'Get Sprite Palette',
        'Print Colour(3)',
      ].join('\n'),
    )
    expect(out).toBe(' 15\n')
    expect(() => run('Ink 5 : Bar 0,0 To 7,7 : Get Bob 1,0,0 To 8,8\nGet Bob Palette')).not.toThrow()
    expect(() => run('Ink 5 : Bar 0,0 To 7,7 : Get Icon 1,0,0 To 8,8\nGet Icon Palette')).not.toThrow()
  })
})

describe('screen blocks', () => {
  it('Get Cblock and Put Cblock copy a rectangle of the screen', () => {
    const rt = run(
      [
        'Screen Open 0,320,200,16,Lowres : Cls 0',
        'Ink 7 : Bar 0,0 To 15,15',
        'Get Cblock 1,0,0,16,16',
        'Cls 0',
        'Put Cblock 1,100,100',
      ].join('\n'),
    )
    expect(rt.screen.point(104, 104)).toBe(7)
    expect(rt.cblocks.has(1)).toBe(true)
  })

  it('Del Cblock and Del Block forget a stored block', () => {
    let rt = run('Ink 7 : Bar 0,0 To 15,15\nGet Cblock 1,0,0,16,16\nDel Cblock 1')
    expect(rt.cblocks.has(1)).toBe(false)
    rt = run('Ink 7 : Bar 0,0 To 15,15\nGet Block 1,0,0,16,16\nDel Block 1')
    expect(rt.blocks.has(1)).toBe(false)
  })
})

describe('display control', () => {
  it('Auto View On restores automatic screen updating', () => {
    expect(run('Auto View Off : Auto View On').autoView).toBe(true)
  })

  it('Multi Wait waits without ending the program', () => {
    // a display-sync wait: it must complete headless rather than block forever
    expect(() => run('Multi Wait')).not.toThrow()
  })
})
