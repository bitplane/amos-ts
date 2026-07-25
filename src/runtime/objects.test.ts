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

describe('Set Bob (InSetBob +Lib.s:12225 -> ResBOB +W.s:988)', () => {
  it('back < 0 leaves a trail, back = 0 saves and restores the background', () => {
    // a negative back clears BbDecor, so nothing is kept to put back
    let rt = run(`Update Off\n${GRAB}\nSet Bob 1,-1,,\nBob 1,40,40,1\nBob Draw\nBob Clear`)
    expect(rt.screen.point(42, 42)).toBe(5)
    rt = run(`Update Off\n${GRAB}\nSet Bob 1,0,,\nBob 1,40,40,1\nBob Draw\nBob Clear`)
    expect(rt.screen.point(42, 42)).toBe(0)
  })

  it('back > 0 restores with the solid colour back-1 instead of the background', () => {
    const rt = run(`Update Off\n${GRAB}\nSet Bob 1,4,,\nBob 1,40,40,1\nBob Draw\nBob Clear`)
    expect(rt.screen.point(42, 42)).toBe(3)
  })

  it('the planes argument masks which bitplanes the bob writes (BbAPlan)', () => {
    // colour 5 is %0101. Restricted to plane 0 (mask 1) only bit 0 is written,
    // so over a background of colour 2 (%0010) the result is %0011 = 3.
    const paint = 'Screen Open 0,320,200,16,Lowres : Cls 2 : Ink 5 : Bar 0,0 To 7,7'
    const grab = `${paint} : Get Bob 1,0,0 To 8,8 : Cls 2`
    let rt = run(`Update Off\n${grab}\nSet Bob 1,0,1,\nBob 1,40,40,1\nBob Draw`)
    expect(rt.screen.point(42, 42)).toBe(3)
    // masking to plane 2 (mask 4) writes only bit 2: %0010 -> %0110 = 6
    rt = run(`Update Off\n${grab}\nSet Bob 1,0,4,\nBob 1,40,40,1\nBob Draw`)
    expect(rt.screen.point(42, 42)).toBe(6)
    // omitted means every plane, so the bob's own colour lands intact
    rt = run(`Update Off\n${grab}\nSet Bob 1,0,,\nBob 1,40,40,1\nBob Draw`)
    expect(rt.screen.point(42, 42)).toBe(5)
  })

  it('a plane mask still respects transparency', () => {
    // pixel (0,0) of the grab is colour 0, which stays transparent whatever
    // the plane mask says, so the background shows through untouched
    const grab = 'Screen Open 0,320,200,16,Lowres : Cls 0 : Ink 5 : Bar 1,1 To 7,7 : Get Bob 1,0,0 To 8,8 : Cls 2'
    const rt = run(`Update Off\n${grab}\nSet Bob 1,0,1,\nBob 1,40,40,1\nBob Draw`)
    expect(rt.screen.point(40, 40)).toBe(2)
    expect(rt.screen.point(42, 42)).toBe(3)
  })
})

describe('Sprite Priority is per-screen (EcCon2, HsPri +W.s:11374)', () => {
  it('stores the value on the current screen, not on the machine', () => {
    const rt = run(
      [
        'Screen Open 0,320,100,4,Lowres : Screen Display 0,128,50,320,100',
        'Screen Open 1,320,100,4,Lowres : Screen Display 1,128,160,320,100',
        'Screen 0 : Sprite Priority 0',
        'Screen 1 : Sprite Priority 4',
      ].join('\n'),
    )
    // two screens on the same display, ordering sprites differently
    expect(rt.screens.get(0)!.pf1p).toBe(0)
    expect(rt.screens.get(1)!.pf1p).toBe(4)
  })

  it('starts at 4 — EcCree puts every sprite pair in front', () => {
    const rt = run('Screen Open 2,320,100,4,Lowres')
    expect(rt.screens.get(2)!.pf1p).toBe(4)
    expect(rt.screens.get(2)!.pf2p).toBe(4)
  })

  it('rejects a value above 4 (InSpritePriority checks before HsPri)', () => {
    // the keyword's own cmp.l #4 / Rbhi L_FonCall rejects it; HsPri's
    // internal clamp to 0 guards its other callers and is never reached here
    expect(() => run('Sprite Priority 5')).toThrow(/function call error/)
    expect(() => run('Sprite Priority -1')).toThrow(/function call error/)
    expect(() => run('Sprite Priority 4')).not.toThrow()
    expect(() => run('Sprite Priority 0')).not.toThrow()
  })

  it('on the second playfield of a dual pair it pokes the first screen PF2P', () => {
    const rt = run(
      [
        'Screen Open 0,320,200,4,Lowres',
        'Screen Open 1,320,200,4,Lowres',
        'Dual Playfield 0,1',
        'Screen 1 : Sprite Priority 2',
      ].join('\n'),
    )
    // the back playfield has no EcCon2 of its own for this: the value lands
    // in the front screen's PF2P field, and its own PF1P is untouched
    expect(rt.screens.get(0)!.pf2p).toBe(2)
    expect(rt.screens.get(1)!.pf1p).toBe(4)
  })
})

describe('dual playfield pairs are per-screen (EcDual)', () => {
  const pair = (a: number, b: number, y: number): string[] => [
    `Screen Open ${a},320,80,4,Lowres : Screen Display ${a},128,${y},320,80`,
    `Screen Open ${b},320,80,4,Lowres : Screen Display ${b},128,${y},320,80`,
    `Dual Playfield ${a},${b}`,
  ]

  it('two independent pairs can exist at once, down the display', () => {
    // each screen gets its own copper band, so the machine is not limited to
    // a single dual pair — that was an artefact of storing it once globally
    const rt = run([...pair(0, 1, 50), ...pair(2, 3, 140)].join('\n'))
    expect(rt.screens.get(0)!.dualPartner).toBe(1)
    expect(rt.screens.get(1)!.dualIsBack).toBe(true)
    expect(rt.screens.get(2)!.dualPartner).toBe(3)
    expect(rt.screens.get(3)!.dualIsBack).toBe(true)
  })

  it('each pair keeps its own PF2 priority', () => {
    const rt = run([...pair(0, 1, 50), ...pair(2, 3, 140), 'Dual Priority 3,2'].join('\n'))
    expect(rt.screens.get(0)!.pf2Front).toBe(false)
    expect(rt.screens.get(2)!.pf2Front).toBe(true)
  })

  it('closing one half dissolves only that pair', () => {
    const rt = run([...pair(0, 1, 50), ...pair(2, 3, 140), 'Screen Close 1'].join('\n'))
    expect(rt.screens.get(0)!.dualPartner).toBeNull()
    // the other pair is untouched
    expect(rt.screens.get(2)!.dualPartner).toBe(3)
    expect(rt.screens.get(3)!.dualIsBack).toBe(true)
  })

  it('the hidden back half becomes visible again when the pair dissolves', () => {
    // Dual Playfield hides the back screen (BitHide); closing the front one
    // must not leave it hidden and unreachable
    const rt = run([...pair(0, 1, 50), 'Screen Close 0'].join('\n'))
    expect(rt.screens.get(1)!.visible).toBe(true)
    expect(rt.screens.get(1)!.dualPartner).toBeNull()
  })

  it('a screen already in a pair cannot join another', () => {
    expect(() =>
      run([...pair(0, 1, 50), 'Screen Open 4,320,80,4,Lowres', 'Dual Playfield 1,4'].join('\n')),
    ).toThrow(/dual playfield impossible/)
  })

  it('both pairs render, each blending its back half through palette 8-15', () => {
    const rt = run(
      [
        ...pair(0, 1, 50),
        ...pair(2, 3, 140),
        'Screen 1 : Cls 3',
        'Screen 3 : Cls 5',
        'Screen 0 : Cls 0',
        'Screen 2 : Cls 0',
      ].join('\n'),
    )
    const img = rt.composite()
    const at = (hx: number, hy: number): string => {
      const o = ((hy - Runtime.COMPOSITE_TOP) * img.width + hx) * 4
      return `${img.data[o]},${img.data[o + 1]},${img.data[o + 2]}`
    }
    // both bands show their back playfield's colour, not the empty front
    expect(at(200, 80)).not.toBe(at(200, 30))
    expect(at(200, 170)).not.toBe(at(200, 30))
  })
})

describe('sprite layers against the playfields (EcCon2 PF1P/PF2P)', () => {
  // a 16x16 solid sprite in colour 1 of the sprite palette
  const SPR = [
    'Screen Open 0,320,200,16,Lowres : Curs Off : Flash Off : Hide On',
    'Colour 1,$F00 : Colour 17,$0F0',
    'Reserve As Chip Work 9,16*16',
    'Ink 1 : Bar 0,0 To 15,15 : Get Sprite 1,0,0 To 16,16 : Cls 0',
  ]

  const at = (rt: Runtime, hx: number, hy: number): string => {
    const img = rt.composite()
    const o = ((hy - Runtime.COMPOSITE_TOP) * 2 * img.width + (hx - 128) * 2) * 4
    return `${img.data[o]},${img.data[o + 1]},${img.data[o + 2]}`
  }

  it('a sprite behind the playfield shows through where the playfield is colour 0', () => {
    // the playfield is transparent at colour 0 for priority purposes, so
    // "behind" does not mean "invisible" — it means covered only where
    // something is actually drawn
    const rt = run(
      [...SPR, 'Sprite Priority 0', 'Ink 2 : Bar 0,100 To 319,199', 'Sprite 8,200,80,1', 'Wait Vbl'].join('\n'),
    )
    const spriteColour = at(rt, 200, 80)
    // over blank screen: visible even though pair 0 is not in front of PF1P 0
    expect(spriteColour).not.toBe(at(rt, 100, 80))
    // and the drawn bar does cover it
    const rt2 = run(
      [...SPR, 'Sprite Priority 0', 'Ink 2 : Bar 0,0 To 319,199', 'Sprite 8,200,80,1', 'Wait Vbl'].join('\n'),
    )
    expect(at(rt2, 200, 80)).toBe(at(rt2, 100, 80))
  })

  it('PF2P puts a sprite between the two playfields of a dual pair', () => {
    // pair 0, PF1P 4 (in front of playfield 1) but PF2P 0 (behind
    // playfield 2): the sprite sits between them, so the back playfield's
    // drawn pixels cover it while the front one's do not
    const src = (dualPri: string): string =>
      [
        'Screen Open 0,320,100,4,Lowres : Screen Display 0,128,50,320,100',
        'Screen Open 1,320,100,4,Lowres : Screen Display 1,128,50,320,100',
        'Dual Playfield 0,1',
        'Curs Off : Flash Off : Hide On',
        'Screen 1 : Cls 3',
        'Screen 0 : Cls 0 : Colour 17,$0F0',
        'Reserve As Chip Work 9,16*16',
        'Ink 1 : Bar 0,0 To 15,15 : Get Sprite 1,0,0 To 16,16 : Cls 0',
        dualPri,
        'Sprite 8,200,70,1',
        'Wait Vbl',
      ].join('\n')
    // PF1P 4 / PF2P 0: behind the back playfield, which is filled, so hidden
    const behind = run(src('Screen 0 : Sprite Priority 4 : Screen 1 : Sprite Priority 0 : Screen 0'))
    // PF1P 4 / PF2P 4: in front of both, so visible
    const inFront = run(src('Screen 0 : Sprite Priority 4 : Screen 1 : Sprite Priority 4 : Screen 0'))
    expect(behind.screens.get(0)!.pf1p).toBe(4)
    expect(behind.screens.get(0)!.pf2p).toBe(0)
    expect(at(behind, 200, 70)).not.toBe(at(inFront, 200, 70))
  })
})
