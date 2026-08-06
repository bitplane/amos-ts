import { describe, expect, it } from 'vitest'
import { mustFinish } from '../testing/run'
import { mintermBit } from '../amiga/blitter'
import { bobBltcon0 } from './objects'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { Runtime } from './runtime'
import { BNK } from './banks'

const table = new TokenTable(CORE_TOKENS)

function run(src: string): Runtime {
  const rt = new Runtime(tokenize(src, table), table, { maxSteps: 300_000 })
  const r = rt.runHeadless(1_000)
  mustFinish(r)
  return rt
}

function runOut(src: string): string {
  let out = ''
  const rt = new Runtime(tokenize(src, table), table, { maxSteps: 300_000, onText: (t) => (out += t) })
  const r = rt.runHeadless(1_000)
  mustFinish(r)
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

  it('a bank grabbed off the screen carries the palette that was live when it was created', () => {
    // Bnk.Ric2 (+Lib.s:8168) creates and grows every sprite and icon bank,
    // and always ends at the `.CPal` loop — thirty-two words written after
    // the image table. On creation (`.PaCopy`) they come from DefPal,
    // overridden by EcPal off ScOnAd whenever a screen is open. So a bank
    // built by Get Bob does have a palette of its own, and Get Bob Palette
    // hands it back.
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
    expect(out).toBe(' 3840\n')
    expect(runOut('Colour 5,$0F0 : Get Icon 1,0,0 To 8,8 : Colour 5,0 : Get Icon Palette : Print Colour(5)')).toBe(' 240\n')
    expect(() => run('Ink 5 : Bar 0,0 To 7,7 : Get Bob 1,0,0 To 8,8\nGet Bob Palette')).not.toThrow()
  })

  it('the snapshot is taken once, when the bank is created, and never refreshed', () => {
    // Growing a bank takes the `.ECop` path, which copies the palette
    // forward out of the old bank rather than re-reading the screen — so
    // twenty Get Bobs all report the colours that were up at the first one.
    const out = runOut(
      [
        'Colour 3,$F00',
        'Get Sprite 1,0,0 To 8,8',
        'Colour 3,$0F0',
        'Get Sprite 2,0,0 To 8,8',
        'Colour 3,$00F',
        'Get Sprite Palette',
        'Print Colour(3)',
      ].join('\n'),
    )
    expect(out).toBe(' 3840\n')
  })

  it('the snapshot comes from the current screen, not the one being grabbed from', () => {
    // `.PaCopy` reads EcPal off ScOnAd — the current screen — where the
    // four-argument Get Bob grabs its pixels from the screen named in the
    // first argument.
    const out = runOut(
      [
        'Screen Open 1,320,200,16,Lowres',
        'Colour 3,$F00',
        'Screen Open 0,320,200,16,Lowres',
        'Colour 3,$0F0',
        'Get Sprite 1,1,0,0 To 8,8',
        'Colour 3,0',
        'Get Sprite Palette',
        'Print Colour(3)',
      ].join('\n'),
    )
    expect(out).toBe(' 240\n')
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

describe('hardware collisions (HColSet/HColGet +W.s:10018/115)', () => {
  const setup = [
    'Screen Open 0,320,200,16,Lowres : Curs Off : Flash Off : Hide On : Cls 0',
    'Reserve As Chip Work 9,16*16',
    'Ink 1 : Bar 0,0 To 15,15 : Get Sprite 1,0,0 To 16,16 : Cls 0',
  ]

  it('Set Hardcol builds CLXCON: $F odd-sprite enables, ENBP1-6, MVBP1-6', () => {
    const rt = run([...setup, 'Set Hardcol 3,1'].join('\n'))
    expect(rt.collide.clxcon).toBe((0xf << 12) | (3 << 6) | 1)
  })

  it('two sprite pairs overlapping set their pair-against-pair bit', () => {
    // sprites 0 and 2 are pairs 0 and 1, so HColT says bit 9
    const apart = run([...setup, 'Set Hardcol 0,0', 'Sprite 0,100,100,1', 'Sprite 2,200,100,1'].join('\n'))
    expect(apart.hardcolData() & (1 << 9)).toBe(0)
    expect(apart.hardcol(0)).toBe(0)
    const over = run([...setup, 'Set Hardcol 0,0', 'Sprite 0,100,100,1', 'Sprite 2,104,100,1'].join('\n'))
    expect(over.hardcolData() & (1 << 9)).not.toBe(0)
    expect(over.hardcol(0)).toBe(-1)
    expect(over.hardcol(2)).toBe(-1)
    // pair 2 saw nothing
    expect(over.hardcol(4)).toBe(0)
  })

  it('Col() reads the pair bits the same call leaves behind', () => {
    const rt = run([...setup, 'Set Hardcol 0,0', 'Sprite 0,100,100,1', 'Sprite 2,104,100,1'].join('\n'))
    rt.hardcol(0)
    // entry 1 of pair 0's row is pair 1, so Col objects 2 and 3
    expect(rt.colGet(2)).toBe(-1)
    expect(rt.colGet(3)).toBe(-1)
    expect(rt.colGet(4)).toBe(0)
  })

  it('a sprite over a matching playfield pixel sets its playfield bit, and that alone is not a sprite hit', () => {
    // ENBP = %0001, MVBP = %0001: a pixel counts when plane 1 is set
    const prog = [...setup, 'Set Hardcol 1,1', 'Ink 1 : Bar 0,0 To 319,199', 'Sprite 0,200,100,1']
    const rt = run(prog.join('\n'))
    expect(rt.hardcolData() & (1 << 1)).not.toBe(0) // pair 0 vs playfield 1
    expect(rt.hardcol(0)).toBe(0) // playfield-only: the function stays false
    expect(rt.colGet(8)).toBe(-1) // but Col() records it
  })

  it('the plane match really discriminates — a wrong colour does not collide', () => {
    // the bar is colour 2 (plane 2), the match asks for plane 1
    const prog = [...setup, 'Set Hardcol 1,1', 'Ink 2 : Bar 0,0 To 319,199', 'Sprite 0,200,100,1']
    expect(run(prog.join('\n')).hardcolData() & (1 << 1)).toBe(0)
  })

  it('Hardcol(8) and above is a function call error (cmp.l #8 +Lib.s:12356)', () => {
    expect(() => run([...setup, 'Print Hardcol(8)'].join('\n'))).toThrow(/function call/)
    expect(() => run([...setup, 'Print Hardcol(-1)'].join('\n'))).not.toThrow()
  })
})

describe("Set Bob's minterm (BbS1a-BbS1d +W.s:1425-1439)", () => {
  it('resolves the control word by the SIGN of the argument', () => {
    // 0 = the default cookie-cut with every channel on
    expect(bobBltcon0(0, true)).toBe(0x0fca)
    // an image with no mask clears USEA (bit 11), which is how No Mask works
    expect(bobBltcon0(0, false)).toBe(0x07ca)
    // negative = a minterm, with the channel bits forced on for you
    expect(bobBltcon0(-0x7f36, true) & 0xff).toBe(0xca) // low byte survives
    expect(bobBltcon0(-1, true) & 0x0f00).toBe(0x0f00)
    expect(bobBltcon0(-1, true) & 0x8000).toBe(0) // bit 15 cleared
    expect(bobBltcon0(-1, false) & 0x0800).toBe(0) // USEA off without a mask
    // positive = the whole word verbatim, fixing-up skipped entirely
    expect(bobBltcon0(0x0123, true)).toBe(0x0123)
    expect(bobBltcon0(0x0030, true)).toBe(0x0030) // channels left OFF as asked
  })

  it('the default minterm is cookie-cut: D = A ? B : C', () => {
    for (const b of [0, 1]) {
      for (const c of [0, 1]) {
        expect(mintermBit(0x0fca, 1, b, c), `A=1 B=${b} C=${c}`).toBe(b)
        expect(mintermBit(0x0fca, 0, b, c), `A=0 B=${b} C=${c}`).toBe(c)
      }
    }
  })

  it('a channel switched off reads as all ones', () => {
    // $07CA is what AMOS builds for a maskless image, and it has to behave as
    // "colour 0 draws" — which it only does if the unloaded A register is 1
    for (const b of [0, 1]) {
      for (const c of [0, 1]) {
        expect(mintermBit(0x07ca, 0, b, c), `B=${b} C=${c}`).toBe(b)
      }
    }
  })

  it('$00 clears and $FF sets, whatever the inputs', () => {
    for (const a of [0, 1]) {
      for (const b of [0, 1]) {
        for (const c of [0, 1]) {
          expect(mintermBit(0x0f00, a, b, c)).toBe(0)
          expect(mintermBit(0x0fff, a, b, c)).toBe(1)
        }
      }
    }
  })

  it('source XOR destination is $66, not the $3C people reach for', () => {
    // worth pinning because the index order catches everyone out. The table
    // is indexed (A<<2)|(B<<1)|C, so B xor C means bits 1,2,5,6 -> $66.
    for (const a of [0, 1]) {
      expect(mintermBit(0x0f66, a, 0, 0), 'B=0 C=0').toBe(0)
      expect(mintermBit(0x0f66, a, 1, 0), 'B=1 C=0').toBe(1)
      expect(mintermBit(0x0f66, a, 0, 1), 'B=0 C=1').toBe(1)
      expect(mintermBit(0x0f66, a, 1, 1), 'B=1 C=1').toBe(0)
    }
    // $3C is A xor B — the destination does not appear in it at all
    for (const c of [0, 1]) {
      expect(mintermBit(0x0f3c, 0, 0, c)).toBe(0)
      expect(mintermBit(0x0f3c, 0, 1, c)).toBe(1)
      expect(mintermBit(0x0f3c, 1, 0, c)).toBe(1)
      expect(mintermBit(0x0f3c, 1, 1, c)).toBe(0)
    }
  })
})

describe('the minterm reaches the screen', () => {
  /** a 16x16 bob of solid pen 3, over a background of pen 5 */
  const scene = (setBob: string): Runtime =>
    run(
      [
        'Screen Open 0,320,200,16,Lowres : Curs Off : Flash Off : Cls 0',
        'Ink 3 : Bar 0,0 To 15,15',
        'Get Bob 1,0,0 To 16,16',
        'Ink 5 : Bar 0,0 To 319,199',
        setBob,
        'Bob 1,100,100,1',
        'Wait Vbl',
      ].join('\n'),
    )

  it('the default replaces the destination where the bob is solid', () => {
    const rt = scene('')
    expect(rt.screen.point(104, 104)).toBe(3)
  })

  it('$00 writes zeroes — the bob punches a hole', () => {
    // negative, so it is a minterm and AMOS forces the channels on
    const rt = scene('Set Bob 1,0,-1,-32768') // $8000 -> minterm $00
    expect(rt.screen.point(104, 104)).toBe(0)
  })

  it('$FF sets every plane — the bob writes solid white', () => {
    const rt = scene('Set Bob 1,0,-1,' + String(-(0x8000 - 0xff)))
    expect(rt.screen.point(104, 104)).toBe(15)
  })

  it('source XOR destination combines the bob with what is under it', () => {
    // pen 3 over pen 5 -> 3 xor 5 = 6
    const rt = scene('Set Bob 1,0,-1,' + String(-(0x8000 - 0x66)))
    expect(rt.screen.point(104, 104)).toBe(3 ^ 5)
  })

  it('the plane write mask still applies on top of the minterm', () => {
    // $FF would set all four planes; the mask lets only plane 0 through
    const rt = scene('Set Bob 1,0,1,' + String(-(0x8000 - 0xff)))
    expect(rt.screen.point(104, 104)).toBe((5 & ~1) | 1)
  })

  it('a positive argument is the whole control word, channels and all', () => {
    // $0FCA is the default spelled out; it must behave as the default does
    const rt = scene('Set Bob 1,0,-1,' + String(0x0fca))
    expect(rt.screen.point(104, 104)).toBe(3)
  })
})

/**
 * The bank list is ONE list.
 *
 * AMOS keeps every bank in a single chain and says what each one is in a flags
 * word (+Equ.s:1864-8); `L_Bnk.GetAdr` finds a Bob bank the same way it finds
 * a Reserve'd block. This port used to keep object banks beside `memBanks`,
 * so each keyword special-cased 1 and 2 by hand and they disagreed. See
 * src/runtime/banks.ts.
 */
describe('object banks are in the bank list (banks.ts)', () => {
  const GRAB1 = 'Screen Open 0,320,200,16,Lowres : Ink 5 : Bar 0,0 To 7,7\nGet Sprite 1,0,0 To 8,8'

  it('Start() answers for a Bob bank, where it used to say "bank not reserved"', () => {
    // FnStart +Lib.s:2481 is `Rbsr L_Bnk.GetAdr / Rbeq L_BkNoRes / move.l
    // a1,d3` -- one list, so a Bob bank answers like any other
    const rt = run(GRAB1)
    expect(rt.bankRef(1)?.address).toBe(rt.bankBase(1))
    expect(runOut(`${GRAB1}\nPrint Start(1)`).trim()).toBe(String(rt.bankBase(1)))
  })

  it('and Start() still refuses a bank that really is not there', () => {
    expect(() => run(`${GRAB1}\nPrint Start(9)`)).toThrow(/bank not reserved/)
  })

  it('Length() is the IMAGE COUNT for an object bank, as FnLength says', () => {
    // +Lib.s:2499-2503 computes the byte length, then for a Bob or Icon bank
    // replaces it with `move.w (a1),d3`
    expect(runOut(`${GRAB1}\nGet Sprite 2,0,0 To 8,8\nPrint Length(1)`).trim()).toBe('2')
  })

  it('the flags are the ones Bnk.ResBob and Bnk.ResIco build', () => {
    // `moveq #(1<<Bnk_BitBob)+(1<<Bnk_BitData),d2` (+Lib.s:8153) and the
    // Icon twin at :8145 -- both carry Data
    const rt = run(`${GRAB1}\nGet Icon 1,0,0 To 8,8`)
    expect(rt.bankRef(1)?.flags).toBe(BNK.BOB | BNK.DATA)
    expect(rt.bankRef(2)?.flags).toBe(BNK.ICON | BNK.DATA)
  })

  it('Erase Temp keeps them BECAUSE they are Data banks, not by special case', () => {
    // Bnk.EffTemp +Lib.s:8059 tests `btst #Bnk_BitData,d0` and nothing else
    const rt = run(`${GRAB1}\nReserve As Work 5,64\nReserve As Data 6,64\nErase Temp`)
    expect(rt.bankRef(1)).not.toBeNull() // the Bob bank carries Data
    expect(rt.bankRef(5)).toBeNull() // Work: gone
    expect(rt.bankRef(6)).not.toBeNull()
  })

  it('List Bank prints all of them from the one list, in number order', () => {
    const out = runOut(`${GRAB1}\nReserve As Work 5,64\nList Bank`)
    const lines = out.split('\n')
    // "numbers under 10 get a leading space"
    expect(lines[0]).toMatch(/^ 1 - Sprites /)
    expect(lines[1]).toMatch(/^ 5 - /)
    // and the image count, not the byte length
    expect(lines[0]!.endsWith('L: 1')).toBe(true)
  })

  it('Bank Shrink refuses an object bank with error 23, not "not reserved"', () => {
    // Bnk.Schrink +Lib.s:8271: `btst #Bnk_BitBob,d0  Pas une banque de bobs!`
    expect(() => run(`${GRAB1}\nBank Shrink 1 To 4`)).toThrow(/function call error/)
  })

  it('Start(1) resolves to bytes, and the first word is the image count', () => {
    // that word is what FnLength reads, so the payload has to begin with it
    const rt = run(`${GRAB1}\nGet Sprite 2,0,0 To 8,8`)
    const bytes = rt.bankPayload(1)!
    expect((bytes[0]! << 8) | bytes[1]!).toBe(2)
    expect(rt.resolveAddr(rt.bankBase(1))?.data[0]).toBe(0)
  })

  it('DEVIATION: writes into an object bank are refused rather than lost', () => {
    // the bytes are generated from the parsed images and nothing reads them
    // back, so accepting a Poke would silently drop it
    const rt = run(GRAB1)
    expect(rt.resolveAddr(rt.bankBase(1))).not.toBeNull()
    expect(rt.resolveWrite(rt.bankBase(1))).toBeNull()
  })
})
