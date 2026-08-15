/**
 * Display 0.01 — the six keywords, and the copper list they build.
 *
 * WHAT THESE CHECK, AND WHY IT IS THE LIST. Four of the six are readings of
 * an AMOS screen and are checkable by their answer. The other two only ever
 * write copper words, so the only thing worth asserting about them is the
 * words: the standard PAL DIWSTRT/DIWSTOP/DDF quartet for a 320x256 screen,
 * the two-byte pointer bias, and the BPLCON1 nibbles. A test that asserted
 * "the display changed" would pass on any list at all.
 *
 * The numbers below are not this port's arithmetic read back. $2c81, $2cc1,
 * $30 and $d0 are the values every Amiga display program sets by hand, so if
 * the seven arguments were being read in the wrong order — which is the one
 * thing a disassembly of a seven-argument keyword can get wrong — they would
 * come out as something else entirely.
 */
import { describe, expect, it } from 'vitest'
import { mustFinish } from '../testing/run'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { extensionById } from '../ext/registry'
import { Runtime } from './runtime'

const table = new TokenTable(CORE_TOKENS)
/**
 * Slot 24, three ways: the Extension Examiner export derives it twice, from
 * the default routine and from the error routine, and routine 0's
 * `move.l a3,$268(a5)` is ($268-$f8)/16+1 on the ExtAdr layout (+Equ.s:1185).
 */
const display = extensionById('display-0.01')!

let printed = ''

function boot(src: string): Runtime {
  const exts = new Map([[24, display.table]])
  printed = ''
  return new Runtime(tokenize(src, table, exts), table, {
    extensions: exts,
    extBindings: new Map([[24, display]]),
    maxSteps: 400_000,
    onText: (t) => (printed += t),
  })
}

function run(src: string): Runtime {
  const rt = boot(src)
  mustFinish(rt.runHeadless(4000))
  return rt
}

/** what the program printed, trimmed */
const out = (): string => printed.trim()

/** every (register, value) pair in one of the two built lists, in order */
function words(rt: Runtime, which: 0 | 1): Array<[number, number]> {
  const c = rt.displayExt.chip
  const at = rt.displayExt.lists[which]!.at
  const out: Array<[number, number]> = []
  for (let p = at; p + 4 <= at + 0x400; p += 4) {
    const w1 = (c[p]! << 8) | c[p + 1]!
    const w2 = (c[p + 2]! << 8) | c[p + 3]!
    out.push([w1, w2])
    if (w1 === 0xffff && w2 === 0xfffe) break
  }
  return out
}

/** the value the list moves into one register, or undefined */
const reg = (rt: Runtime, which: 0 | 1, r: number): number | undefined =>
  words(rt, which).find(([w1]) => w1 === r)?.[1]

/** a 32-bit pointer out of the BPLxPTH/BPLxPTL pair */
function ptr(rt: Runtime, which: 0 | 1, r: number): number {
  const hi = reg(rt, which, r)!
  const lo = reg(rt, which, r + 2)!
  return ((hi << 16) | lo) >>> 0
}

/** open two screens and merge them at the standard PAL position */
const MERGE = [
  'Screen Open 0,320,256,16,Lowres',
  'Screen Open 1,320,256,16,Lowres',
  'Copper Off',
  'Dlmergedisplay $80,$2C,320,256,0,1,0',
].join('\n')

describe('Display 0.01 — the readings', () => {
  it('=Dlscreenbase(n) is the screen control block, not the bitmap (routine 2, $21c)', () => {
    const rt = run('Screen Open 3,320,200,8,Lowres\nPrint Dlscreenbase(3)')
    expect(out()).toBe(String(rt.screenCtrlAddr(3) | 0))
    // and it is a control block: EcTx sits at +76 and reads the width back
    const m = rt.resolveAddr(rt.screenCtrlAddr(3) + 76)!
    expect((m.data[m.off]! << 8) | m.data[m.off + 1]!).toBe(320)
  })

  it('=Dldepth(n) is EcNPlan, the screen structure at $50 (routine 3, $22a)', () => {
    run('Screen Open 2,320,200,32,Lowres\nPrint Dldepth(2)')
    expect(out()).toBe('5')
  })

  it('both go through L_GetEc, so an unopened screen is AMOS error 47', () => {
    expect(() => run('Print Dldepth(9)')).toThrow(/screen not opened/)
    expect(() => run('Print Dlscreenbase(9)')).toThrow(/screen not opened/)
  })

  it('=Dlcheckaga answers -1 on the modelled A1200 (routine 4, $23a)', () => {
    // block+$04 is 8 rather than 6 because routine 0 found AA Alice, and the
    // keyword only compares that word with 8
    const rt = run('Print Dlcheckaga')
    expect(out()).toBe('-1')
    expect(rt.displayExt.maxDepth).toBe(8)
  })
})

describe('Display 0.01 — Dlmergedisplay builds the list', () => {
  it('sets the standard PAL display window and fetch for 320x256 at $80,$2C', () => {
    const rt = run(MERGE)
    // DIWSTRT/DIWSTOP: ($2c << 8) | $81, then ($2c+$100 << 8) | $81 + $140 -
    // $100, both truncated to a word
    expect(reg(rt, 0, 0x08e)).toBe(0x2c81)
    expect(reg(rt, 0, 0x090)).toBe(0x2cc1)
    // DDFSTRT is eight colour clocks EARLY --- $30 where a non-scrolling
    // display uses $38 --- which is the extra word Dlscreenoffset scrolls into
    expect(reg(rt, 0, 0x092)).toBe(0x30)
    expect(reg(rt, 0, 0x094)).toBe(0xd0)
  })

  it('the modulos pay for that extra word, one per playfield', () => {
    // BPL1MOD is playfield 1's `rowBytes - width/8 - 2` and BPL2MOD is
    // playfield 2's, so a wider second screen shows which is which. Both
    // rowBytes come from EcTx, not EcTLigne (`move.w $4c(a0),d1`, $2be)
    const rt = run(MERGE.replace('1,320,256,16', '1,640,256,16'))
    expect(reg(rt, 0, 0x108)).toBe(0xfffe) // 40 - 40 - 2
    expect(reg(rt, 0, 0x10a)).toBe(80 - 40 - 2)
  })

  it('four planes a playfield on this machine, interleaved on the odd and even pointers', () => {
    const rt = run(MERGE)
    // the ceiling at block+$04 is 8 and each playfield takes half ($2aa,
    // `asr.w #$1`), so a 16-colour screen keeps all four of its planes
    expect(rt.displayExt.playfields[0]!.planes).toBe(4)
    expect(rt.displayExt.playfields[1]!.planes).toBe(4)
    // BPL1/3/5/7 are playfield 1 and BPL2/4/6/8 playfield 2
    const s0 = rt.screenChipBase(0)
    const s1 = rt.screenChipBase(1)
    const size = rt.screens.get(0)!.planeSize
    for (let n = 0; n < 4; n++) {
      expect(ptr(rt, 1, 0xe0 + n * 8)).toBe((s0 + n * size - 2) >>> 0)
      expect(ptr(rt, 1, 0xe4 + n * 8)).toBe((s1 + n * size - 2) >>> 0)
    }
  })

  it('BPLCON0 asks for eight planes with BPU3, plus DBLPF and COLOR', () => {
    const rt = run(MERGE)
    // $31c: eight planes take `moveq #$10` rather than the BPU field, and the
    // seventh argument being zero adds $600 --- DBLPF and COLOR together
    expect(reg(rt, 0, 0x100)).toBe(0x0610)
    expect(reg(rt, 0, 0x106)).toBe(0x1000)
  })

  it('a non-zero seventh argument drops DBLPF and leaves COLOR ($33c)', () => {
    const rt = run(MERGE.replace(',0,1,0', ',0,1,1'))
    expect(reg(rt, 0, 0x100)).toBe(0x0210)
  })

  it('three planes a playfield take the BPU field and the other PF2OF', () => {
    const rt = run(
      MERGE.replace('0,320,256,16,Lowres', '0,320,256,8,Lowres').replace(
        '1,320,256,16,Lowres',
        '1,320,256,8,Lowres',
      ),
    )
    expect(reg(rt, 0, 0x100)).toBe(0x6600)
    expect(reg(rt, 0, 0x106)).toBe(0x0c00)
  })

  it('the list starts with a WAIT on the line before the display ($3c4)', () => {
    const rt = run(MERGE)
    const [first] = words(rt, 0)
    expect(first).toEqual([((0x2c - 1) << 8) | 1, 0xfffe])
  })

  it('past line 255 the $ff01 crossing goes in first, and the wait is rebased', () => {
    const rt = run(MERGE.replace('$80,$2C', '$80,300'))
    const w = words(rt, 0)
    expect(w[0]).toEqual([0xff01, 0xfffe])
    expect(w[1]).toEqual([((300 - 1 - 0xff) << 8) | 1, 0xfffe])
  })

  it('list A is built off EcPhysic and list B off EcLogic ($2dc)', () => {
    const rt = run(
      MERGE.replace('Copper Off', 'Screen 0\nDouble Buffer\nAutoback 0\nScreen 1\nDouble Buffer\nAutoback 0\nCopper Off'),
    )
    const phy = rt.screenChipBase(0) + Runtime.SCREEN_PHY_OFFSET
    expect(ptr(rt, 0, 0xe0)).toBe((phy - 2) >>> 0)
    expect(ptr(rt, 1, 0xe0)).toBe((rt.screenChipBase(0) - 2) >>> 0)
  })

  it('thirty-two colours come out of playfield 1 and nothing reads playfield 2', () => {
    const rt = run(`${MERGE}\nScreen 0\nColour 5,$F00\nScreen 1\nColour 5,$0F0\nDlmergedisplay $80,$2C,320,256,0,1,0`)
    expect(reg(rt, 0, 0x180 + 5 * 2)).toBe(0xf00)
  })

  it('the display is handed over the way Personnal Active Copper hands it over', () => {
    const rt = run(MERGE)
    // $50c writes DMACON, COP1LC then DMACON again, so what is left standing
    // is bitplane and copper DMA on with COP1LC pointing at list A
    expect(rt.copRegs.dmaOn).toBe(true)
    expect(rt.copList1Addr).toBe((rt.displayExt.base + 0) >>> 0)
    // and the bank word says list B is NEXT
    expect(rt.displayExt.bank).toBe(1)
  })

  it('the pointers are two bytes short of the bitmap and the renderer still finds it', () => {
    // the pre-fetch bias used to put BPL1PT in the PREVIOUS screen slot, so
    // no screen resolved and the frame came out blank. This is the assertion
    // that fails if display.ts stops tolerating it.
    const rt = run(`${MERGE}\nScreen 0\nCls 3\nBar 0,0 To 319,255`)
    const f = rt.display.composite()
    let lit = 0
    for (let o = 3; o < f.data.length; o += 4) if (f.data[o - 3]! !== 0 || f.data[o - 2]! !== 0 || f.data[o - 1]! !== 0) lit++
    expect(lit).toBeGreaterThan(1000)
  })
})

describe('Display 0.01 — Dlcopswap and Dlscreenoffset', () => {
  it('Dlcopswap alternates the two lists (routine 1, $1ee)', () => {
    const rt = run(`${MERGE}\nDlcopswap`)
    expect(rt.copList1Addr).toBe((rt.displayExt.base + 0x400) >>> 0)
    expect(rt.displayExt.bank).toBe(0)
    const back = run(`${MERGE}\nDlcopswap\nDlcopswap`)
    expect(back.copList1Addr).toBe((back.displayExt.base + 0) >>> 0)
    expect(back.displayExt.bank).toBe(1)
  })

  it('a whole-word offset moves the pointers and leaves BPLCON1 at zero', () => {
    // x = 32 is two words, y = 3 is three rows of 40 bytes: 128 bytes on
    // 320-wide screens. `x and 15` is zero, so the two-byte bias stays ($600)
    const rt = run(`${MERGE}\nDlscreenoffset 0,32,3`)
    const s0 = rt.screenChipBase(0)
    expect(ptr(rt, 1, 0xe0)).toBe((s0 + 3 * 40 + 4 - 2) >>> 0)
    expect(reg(rt, 1, 0x102)).toBe(0)
  })

  it('a part-word offset drops the bias and takes the delay instead ($5ae)', () => {
    const rt = run(`${MERGE}\nDlscreenoffset 0,1,0`)
    // 16 - 1 = 15 in the low nibble, and the pointer is NOT biased --- the
    // two together are one pixel of scroll either side of the boundary
    expect(reg(rt, 1, 0x102)).toBe(0x0f)
    expect(ptr(rt, 1, 0xe0)).toBe(rt.screenChipBase(0) >>> 0)
  })

  it('playfield 2 takes the high nibble and leaves playfield 1 alone ($5ca)', () => {
    const rt = run(`${MERGE}\nDlscreenoffset 0,3,0\nDlscreenoffset 1,5,0`)
    // 16-3 = 13 low, 16-5 = 11 high
    expect(reg(rt, 1, 0x102)).toBe(0xb0 | 0x0d)
  })

  it('it patches the HIDDEN list, so offset-then-swap shows what was just written', () => {
    // the bank word picks the list ($5a2), and Dlmergedisplay leaves it at 1
    const rt = run(`${MERGE}\nDlscreenoffset 0,0,1`)
    const s0 = rt.screenChipBase(0)
    expect(ptr(rt, 1, 0xe0)).toBe((s0 + 40 - 2) >>> 0)
    // list A, which is the one on screen, is untouched
    expect(ptr(rt, 0, 0xe0)).toBe((s0 - 2) >>> 0)
  })

  it('playfield 2 scrolls out of its own plane pointers, not playfield 1"s', () => {
    const rt = run(`${MERGE}\nDlscreenoffset 1,0,2`)
    const s0 = rt.screenChipBase(0)
    const s1 = rt.screenChipBase(1)
    expect(ptr(rt, 1, 0xe4)).toBe((s1 + 2 * 40 - 2) >>> 0)
    expect(ptr(rt, 1, 0xe0)).toBe((s0 - 2) >>> 0)
  })
})
