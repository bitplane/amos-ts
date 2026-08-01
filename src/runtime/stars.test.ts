import { describe, expect, it } from 'vitest'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { EXTENSION_TOKENS, extensionById } from '../ext/registry'
import { Runtime } from './runtime'

/**
 * Stars 2.33 (Jason G. Doig), against `Stars.doc` and every routine in
 * `stars.lib` disassembled with `extdis stars-2.33`. Addresses in the
 * assertions are offsets into that code hunk.
 */
const table = new TokenTable(CORE_TOKENS)
/** "Type the path of the of the stars library into location #20" */
const STARS_SLOT = 20
const extensions = new Map([
  ...[...EXTENSION_TOKENS].map(([slot, defs]) => [slot, new TokenTable(defs)] as const),
  [STARS_SLOT, extensionById('stars-2.33')!.table] as const,
])

function run(src: string | string[], frames = 200): { out: string; rt: Runtime; status: string } {
  let out = ''
  const rt = new Runtime(tokenize(Array.isArray(src) ? src.join('\n') : src, table, extensions), table, {
    maxSteps: 2_000_000,
    extensions,
    onText: (t) => (out += t),
  })
  const r = rt.runHeadless(frames)
  return { out, rt, status: r.status }
}

/** the bytes of the last bitplane of screen 0 */
function lastPlane(rt: Runtime): Uint8Array {
  const s = rt.screens.get(0)!
  const bm = s.rp.bitMap
  const planes = bm.planeBytes()
  const base = ((bm.depth - 1) & 7) * bm.planeSize
  return planes.subarray(base, base + bm.planeSize)
}

const setBits = (a: Uint8Array): number => {
  let n = 0
  for (const b of a) n += (b & 0xff).toString(2).replace(/0/g, '').length
  return n
}

describe('Stars 2.33 — the starfield', () => {
  it('plots into the LAST bitplane and nowhere else ($21c)', () => {
    // "these plot not in a specific colour, but straight onto the last
    // bitplane of a screen" -- Stars.doc
    const { rt } = run(['Screen Open 0,320,200,8,Lowres', 'Cls 0', 'Stars On 0,4,16', 'Wait Vbl', 'Wait Vbl'], 6)
    const s = rt.screens.get(0)!
    const bm = s.rp.bitMap
    const planes = bm.planeBytes()
    expect(setBits(lastPlane(rt))).toBeGreaterThan(0)
    // planes 0..depth-2 stay clear
    expect(setBits(planes.subarray(0, (bm.depth - 1) * bm.planeSize))).toBe(0)
  })

  it('plots at most `number` stars, and Stars Off leaves them on screen', () => {
    // Stars Off (routine 7, $19e2) clears the count and NOTHING else, so the
    // stars already drawn stay where they are
    const { rt } = run(
      ['Screen Open 0,320,200,2,Lowres', 'Cls 0', 'Stars On 0,4,8', 'Wait Vbl', 'Wait Vbl', 'Stars Off'],
      8,
    )
    const before = setBits(lastPlane(rt))
    expect(before).toBeGreaterThan(0)
    expect(before).toBeLessThanOrEqual(8)
    expect(rt.stars.count).toBe(0)
    // and nothing erases them afterwards
    rt.frame()
    rt.frame()
    expect(setBits(lastPlane(rt))).toBe(before)
  })

  it('Stars Blast empties every bitplane in eight passes ($181a)', () => {
    const filled = run(['Screen Open 0,320,200,4,Lowres', 'Cls 15'], 3)
    expect(setBits(filled.rt.screens.get(0)!.rp.bitMap.planeBytes())).toBeGreaterThan(0)
    // eight per-byte shifts empty an eight-bit byte whichever way it goes
    const blasted = run(['Screen Open 0,320,200,4,Lowres', 'Cls 15', 'Stars Blast'], 3)
    expect(setBits(blasted.rt.screens.get(0)!.rp.bitMap.planeBytes())).toBe(0)
  })

  it('Stars Vbl waits a frame, like the Wait Vbl it is documented against', () => {
    expect(run(['A=Timer', 'Stars Vbl', 'Print Timer-A'], 8).out.trim()).toBe('1')
  })

  it('the count is bounded 1..128 and the screen 0..7 ($18ec, $192c)', () => {
    const bad = (line: string): string =>
      run(['Screen Open 0,320,200,2,Lowres', `Trap ${line}`, 'Print Errtrap']).out.trim()
    expect(bad('Stars On 0,0,0')).not.toBe('0') // count must be >= 1
    expect(bad('Stars On 0,0,129')).not.toBe('0') // and <= 128
    expect(bad('Stars On 8,0,4')).not.toBe('0') // screen 0..7
    expect(bad('Stars On 3,0,4')).not.toBe('0') // and it must be OPEN
    expect(bad('Stars On 0,5,4')).not.toBe('0') // direction 0..4
    expect(bad('Stars Dir 5')).not.toBe('0')
    expect(bad('Stars Dir -1')).not.toBe('0')
  })

  it('speed comes from the star INDEX, giving eight parallax layers ($306)', () => {
    // the mover counts down from count-1 while walking the arrays up, so the
    // star at index k moves ((count-1-k) AND 7) + 1 pixels a frame. Nothing
    // in the manual says this; it is the whole visual effect.
    const { rt } = run(['Screen Open 0,320,200,2,Lowres', 'Stars On 0,4,16'], 3)
    const st = rt.stars
    const before = Array.from(st.x)
    st.dir = 1 // right
    const s = rt.screens.get(0)!
    st.width = s.width
    rt.frame()
    const moved = Array.from(st.x).map((v, k) => ((v - before[k]!) & 0xffff) >> 6)
    // sixteen stars, so k=0 gets (15 & 7)+1 = 8 and k=15 gets (0 & 7)+1 = 1
    expect(moved.slice(0, 16)).toEqual([8, 7, 6, 5, 4, 3, 2, 1, 8, 7, 6, 5, 4, 3, 2, 1])
  })

  it('direction 4 is stationary — it matches none of the four tests ($2ea)', () => {
    const { rt } = run(['Screen Open 0,320,200,2,Lowres', 'Stars On 0,4,8'], 3)
    const before = [Array.from(rt.stars.x), Array.from(rt.stars.y)]
    rt.frame()
    rt.frame()
    expect([Array.from(rt.stars.x), Array.from(rt.stars.y)]).toEqual(before)
  })

  it('the field switches itself off when the screen closes ($20c)', () => {
    const { rt } = run(['Screen Open 0,320,200,2,Lowres', 'Stars On 0,0,8'], 3)
    expect(rt.stars.count).toBe(8)
    rt.screens.delete(0)
    rt.frame()
    expect(rt.stars.count).toBe(0)
    expect(rt.stars.plotted).toBe(0)
  })

  it('the erase clears a whole WORD, which is the doc\'s warning ($24a)', () => {
    // "please try to keep this clear or it will get corrupted" -- the erase
    // does not clear the star's bit, it zeroes the 16 pixels around it
    const { rt } = run(['Screen Open 0,320,200,2,Lowres', 'Cls 0', 'Stars On 0,1,1'], 3)
    const plane = lastPlane(rt)
    // fill the whole plane, then let one frame of stars run over it
    plane.fill(0xff)
    rt.screens.get(0)!.rp.bitMap.invalidate()
    rt.frame() // plots, remembering one address
    rt.frame() // erases that word
    let zeroWords = 0
    for (let i = 0; i + 1 < plane.length; i += 2) if (plane[i] === 0 || plane[i + 1] === 0) zeroWords++
    expect(zeroWords).toBeGreaterThan(0)
  })
})

describe('Stars 2.33 — the keywords the manual does not describe', () => {
  it('Stars Reset ends the program (DEVIATION: the original reboots)', () => {
    // routine 4 ($1892) jumps through the Kickstart reset vector at $F80000+4
    const r = run(['Print "before"', 'Stars Reset', 'Print "after"'])
    expect(r.out).toContain('before')
    expect(r.out).not.toContain('after')
    expect(r.status).toBe('ended')
  })

  it('Stars Wibble does nothing, and must still exist ($19f2)', () => {
    // six bytes: a prologue and an epilogue with the body gone
    const r = run(['Print "a"', 'Stars Wibble', 'Print "b"'])
    expect(r.out.trim().split('\n').map((s) => s.trim())).toEqual(['a', 'b'])
  })

  it('Cop Screen validates its eight parameters and emits nothing ($1bd8)', () => {
    // the doc calls it a full-version extra and the shareware build agrees:
    // 204 bytes that pop, check, store and return
    const ok = run(['Copper Off', 'Cop Reset', 'Cop Screen 0,0,0,0,0,0,0,0', 'Print Cop Current-Cop Logic'])
    expect(ok.out.trim()).toBe('0')
    const bad = run(['Trap Cop Screen 0,4,0,0,0,0,0,0', 'Print Errtrap']).out.trim()
    expect(bad).not.toBe('0')
  })
})

describe('Stars 2.33 — the copper keywords', () => {
  it('Cop Current is where the next Cop Move would write ($1ca4)', () => {
    const out = run([
      'Copper Off',
      'Cop Reset',
      'A=Cop Current',
      'Cop Move $180,$F00',
      'Print Cop Current-A',
    ]).out.trim()
    // one MOVE is two words
    expect(out).toBe('4')
  })

  it('Cop Palette builds one MOVE per colour, plus the bank restore ($1a1c)', () => {
    const { rt } = run([
      'Copper Off',
      'Cop Reset',
      'Reserve As Work 10,8',
      'Doke Start(10),$F00 : Doke Start(10)+2,$0F0',
      'Cop Palette 0 To 1,Start(10)',
    ])
    // The bank select comes FIRST even for colour 0: $1a4a skips the
    // pre-loop select when the register is already $180, and $1a8a then
    // emits it from inside the loop instead. One either way, never two.
    const l = rt.copLogic
    const words: number[] = []
    for (let i = 0; i < rt.copPos; i += 2) words.push((l[i]! << 8) | l[i + 1]!)
    expect(words).toEqual([0x106, 0xc00, 0x180, 0xf00, 0x182, 0x0f0, 0x106, 0xc40])
  })

  it('Cop True Palette starts at the wrong register unless a is 0 (DEFECT $1ae8)', () => {
    // `lsl.w #4,d3` where Cop Palette has `lsl.w #1,d3` -- E94B against E34B
    const first = (from: number): number => {
      const { rt } = run([
        'Copper Off',
        'Cop Reset',
        'Reserve As Work 10,32',
        `Cop True Palette ${from} To ${from},Start(10)`,
      ])
      const l = rt.copLogic
      // MOVEs are register/value PAIRS, so registers are every fourth byte;
      // the first one that is not a BPLCON3 bank select is the colour
      for (let i = 0; i + 3 < rt.copPos; i += 4) {
        const reg = (l[i]! << 8) | l[i + 1]!
        if (reg !== 0x106) return reg
      }
      return -1
    }
    expect(first(0)).toBe(0x180) // correct, because 0 << anything is 0
    expect(first(1)).toBe(0x190) // should be $182 — sixteen registers along
    expect(first(2)).toBe(0x1a0) // should be $184
    expect(first(4)).toBe(0x180) // should be $188; ($40 AND $3f) is 0
  })

  it('Cop True Palette writes both nibble passes for AGA LOCT ($1b50)', () => {
    const { rt } = run([
      'Copper Off',
      'Cop Reset',
      'Reserve As Work 10,8',
      'Poke Start(10),$12 : Poke Start(10)+1,$34 : Poke Start(10)+2,$56',
      'Cop True Palette 0 To 0,Start(10)',
    ])
    const l = rt.copLogic
    const words: number[] = []
    for (let i = 0; i < rt.copPos; i += 2) words.push((l[i]! << 8) | l[i + 1]!)
    // high nibbles behind the plain bank select ($1bac, ORs $c00), then the
    // low nibbles behind LOCT ($1bc2, ORs $e00), then bank 0 back
    expect(words).toEqual([0x106, 0xc00, 0x180, 0x135, 0x106, 0x0e00, 0x180, 0x246, 0x106, 0xc40])
  })
})
