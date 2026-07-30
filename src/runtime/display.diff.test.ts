/**
 * The display differential sweep: the two renderers, compared pixel-exact.
 *
 * `composite()` (runtime.ts) forks. Normally it composites AMOS's *screens* —
 * frontAt() banding, displayX/Y, the rainbow machine, dual playfield by
 * dualPartner. Under `Copper Off` it instead interprets the physical copper
 * list through compositeFromList(), a real hardware walk: BPLCON0/1/2/3,
 * DDF/DIW, modulos, DMACON, palette and sprite pointers.
 *
 * Two renderers means every display feature is built twice and has to stay
 * agreeing, and only one of the two is exercised by most programs. This file
 * is the oracle for that: for each scene, draw it, copy the system list,
 * `Copper Off`, replay the list, and require the frames to be identical.
 *
 * It exists to be the regression net for collapsing the two paths into one —
 * but it earns its place before that, because a scene that disagrees is a bug
 * in one of them today.
 *
 * The replay technique is the Multi_Rainbows.AMOS pattern, and it is the same
 * one copper.test.ts:144 already proves works for a single scene; this
 * generalises it into a table rather than inventing a new mechanism.
 */
import { describe, expect, it } from 'vitest'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { Runtime } from './runtime'

const table = new TokenTable(CORE_TOKENS)

/**
 * The boilerplate around a scene: copy the live system list into a bank,
 * stop at a Wait Key so the caller can grab the system-rendered frame, then
 * Copper Off and write the list back word for word through the user list.
 *
 * `Hide On` because Copper Off really does take the mouse pointer away
 * (TCopOn forces T_MouShow to -1, +W.s:6823). With it showing, the two
 * displays are legitimately different and every scene would "fail" on the
 * pointer rather than on what it is meant to isolate.
 */
function program(scene: string[]): string {
  return [
    'Flash Off : Curs Off : Hide On',
    ...scene,
    'Wait Vbl : Wait Vbl',
    'Reserve As Work 10,12*1024',
    'L=0',
    'Repeat',
    '  C=Leek(Cop Logic+L) : Loke Start(10)+L,C : L=L+4',
    'Until C=%11111111111111111111111111111110',
    'Wait Key',
    'Copper Off : Wait Vbl',
    'ACOP=Cop Logic : ACH=Start(10)',
    'Do',
    '  C=Leek(ACH)',
    '  Exit If C=%11111111111111111111111111111110',
    '  Cop Move 0,0',
    '  Loke ACOP,C',
    '  ACOP=ACOP+4 : ACH=ACH+4',
    'Loop',
    'Cop Swap : Wait Vbl',
    'Wait Key',
  ].join('\n')
}

interface Diff {
  /** how many of the 640x~270 pixels differ */
  differing: number
  total: number
  /** the first few disagreements, for a diagnostic failure message */
  samples: string[]
}

function sweep(scene: string[]): Diff {
  const rt = new Runtime(tokenize(program(scene), table), table, { maxSteps: 8_000_000 })
  const untilKeyWait = (): void => {
    for (let i = 0; i < 2000 && (rt.interp.blocked as { type?: string } | null)?.type !== 'waitKey'; i++) rt.frame()
  }

  untilKeyWait()
  if ((rt.interp.blocked as { type?: string } | null)?.type !== 'waitKey') {
    throw new Error('scene never reached the first Wait Key — it did not finish drawing')
  }
  const before = new Uint8ClampedArray(rt.composite().data)

  rt.pressKey(' ')
  rt.frame()
  untilKeyWait()
  if ((rt.interp.blocked as { type?: string } | null)?.type !== 'waitKey') {
    throw new Error('scene never reached the second Wait Key — the list replay did not finish')
  }
  if (rt.copperOn) throw new Error('Copper Off did not take effect')
  const after = rt.composite().data

  let differing = 0
  const samples: string[] = []
  const W = 640
  for (let i = 0; i < before.length; i += 4) {
    if (
      before[i] !== after[i] ||
      before[i + 1] !== after[i + 1] ||
      before[i + 2] !== after[i + 2]
    ) {
      differing++
      if (samples.length < 6) {
        const p = i / 4
        const rgb = (b: Uint8ClampedArray): string =>
          `#${[b[i]!, b[i + 1]!, b[i + 2]!].map((v) => v.toString(16).padStart(2, '0')).join('')}`
        samples.push(`(${p % W},${Math.floor(p / W)}) modelled ${rgb(before)} vs list ${rgb(after)}`)
      }
    }
  }
  return { differing, total: before.length / 4, samples }
}

/** assert the two renderers agree, with a diagnostic message when they do not */
function expectIdentical(scene: string[]): void {
  const d = sweep(scene)
  if (d.differing !== 0) {
    throw new Error(
      `the two display paths disagree on ${d.differing} of ${d.total} pixels ` +
        `(${((d.differing / d.total) * 100).toFixed(2)}%)\n  ` +
        d.samples.join('\n  '),
    )
  }
  expect(d.differing).toBe(0)
}

describe('display differential sweep: modelled path vs copper interpreter', () => {
  it('baseline: bars and a palette change', () => {
    // the scene copper.test.ts:144 already covers, kept here so the harness
    // itself is validated against a known-good case
    expectIdentical([
      'Ink 2 : Bar 50,20 To 270,180',
      'Ink 4 : Bar 100,60 To 200,120',
      'Colour 1,$333',
    ])
  })

  it('a rainbow over a band', () => {
    // the modelled path runs a "single-rainbow copper machine"; the
    // interpreter just sees COLORxx writes in the list
    expectIdentical([
      'Ink 2 : Bar 20,20 To 300,180',
      'Set Rainbow 0,1,64,"(1,1,15)","",""',
      'Rainbow 0,0,70,40',
    ])
  })

  it('two screens at different vertical positions', () => {
    // frontAt() banding and EcCopHo palette blocks vs BPL1PT + DIWSTRT
    expectIdentical([
      'Screen Open 0,320,80,16,Lowres : Curs Off : Cls 0',
      'Ink 3 : Bar 10,10 To 300,70',
      'Screen Display 0,128,50,320,80',
      'Screen Open 1,320,80,16,Lowres : Curs Off : Cls 0',
      'Ink 5 : Bar 10,10 To 300,70',
      'Screen Display 1,128,150,320,80',
    ])
  })

  // The last divergence, and the modelled path is the wrong one: it clips at
  // the screen edge (`sx >= s.width`) where the interpreter lets the pointer
  // walk into the next row, as the hardware does. It therefore disappears
  // exactly when the collapse is on and both sides are the interpreter — so
  // the expectation follows the mode, and neither state can rot unnoticed.
  const collapsed = process.env.AMOS_LIST_DISPLAY === '1'
  ;(collapsed ? it : it.fails)('Screen Offset scrolling', () => {
    expectIdentical([
      'Screen Open 0,640,400,16,Lowres : Curs Off : Cls 0',
      'For I=0 To 15 : Ink I : Bar I*40,I*24 To I*40+38,I*24+22 : Next I',
      'Screen Offset 0,48,32',
    ])
  })

  it('hires', () => {
    expectIdentical([
      'Screen Open 0,640,200,16,Hires : Curs Off : Cls 0',
      'Ink 7 : Bar 40,20 To 600,180',
      'Ink 2 : Bar 100,60 To 300,120',
    ])
  })

  it('interlaced', () => {
    expectIdentical([
      'Screen Open 0,320,400,16,Lowres+Laced : Curs Off : Cls 0',
      'Ink 6 : Bar 20,20 To 300,380',
      'Ink 1 : Bar 60,100 To 260,300',
    ])
  })

  it('HAM6', () => {
    // rowColours is shared by both paths, so this should pass — it guards
    // against the shared decoder being forked during the collapse
    expectIdentical([
      'Screen Open 0,320,200,4096,Lowres : Curs Off : Cls 0',
      'For I=0 To 60 : Ink I : Bar I*5,20 To I*5+4,180 : Next I',
    ])
  })

  it('extra-half-brite', () => {
    // EHB is derived (!ham && depth===6), not stored — the hardware decides
    // it the same way, so both paths must derive it identically
    expectIdentical([
      'Screen Open 0,320,200,64,Lowres : Curs Off : Cls 0',
      'For I=0 To 63 : Ink I : Bar I*5,20 To I*5+4,180 : Next I',
    ])
  })

  it('double buffered, after a swap', () => {
    // displayBuffer (logical vs back) against the interpreter's usePhy,
    // which it derives from where BPL1PT lands inside the screen's slot
    expectIdentical([
      'Screen Open 0,320,200,16,Lowres : Curs Off : Cls 0',
      'Double Buffer',
      'Ink 3 : Bar 20,20 To 300,180',
      'Screen Swap : Wait Vbl',
      'Ink 5 : Bar 60,60 To 260,140',
      'Screen Swap : Wait Vbl',
    ])
  })

  it('the text cursor', () => {
    // drawn by both paths from the same CURSOR_SHAPE; a regression here
    // during the collapse would be easy to miss
    expectIdentical(['Curs On', 'Locate 10,10', "Print \"AB\";"])
  })

  // WAS the Phase 4 checkpoint, and it is green. Three things had to be true
  // together and none of them worked alone:
  //   - the list has to EMIT both bitmaps, interleaved as the hardware wants
  //     them (PF1 in bitplanes 1,3,5 and PF2 in 2,4,6). It used to emit only
  //     the front screen's planes, so the second playfield was not in the
  //     list at all.
  //   - BPLCON0 has to carry the PAIR's combined depth and the DBLPF bit, or
  //     a replay fetches one playfield's worth of planes and cannot know to
  //     split them.
  //   - the fetch must not cap the plane count at the BPL1PT screen's depth,
  //     because PF2's planes live in the partner bitmap.
  it('dual playfield', () => {
    expectIdentical([
      'Screen Open 0,320,200,8,Lowres : Curs Off : Cls 0',
      'Screen Open 1,320,200,8,Lowres : Curs Off : Cls 0',
      'Dual Playfield 0,1',
      'Screen 0 : Ink 3 : Bar 20,20 To 200,120',
      'Screen 1 : Ink 5 : Bar 100,80 To 300,180',
    ])
  })
})
