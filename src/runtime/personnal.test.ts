import { describe, expect, it } from 'vitest'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { extensionById } from '../ext/registry'
import { tokenize } from '../tokens/tokenizer'
import { Runtime } from './runtime'
import { AmigaFS } from './vfs'

const table = new TokenTable(CORE_TOKENS)
// Personnal is third-party, so no stock slot map binds it: the source puts
// it at 13 (ExtNb Equ 13-1) and 68 of its 69 demos agree. The 1.1a table is
// the superset, so it detokenises both versions' programs.
const exts = new Map([[13, extensionById('personnal-1.1')!.table]])

/** a machine with a writable RAM:, as every real one has */
function withRam(): AmigaFS {
  const fs = new AmigaFS()
  fs.mountMemory('RAM')
  return fs
}

function run(src: string, fs?: AmigaFS): Runtime {
  const rt = new Runtime(tokenize(src, table, exts), table, {
    extensions: exts,
    maxSteps: 2_000_000,
    ...(fs ? { fs } : {}),
  })
  const r = rt.runHeadless(500)
  if (r.status !== 'ended' && r.status !== 'stopped') throw new Error(`program ${r.status}`)
  return rt
}

/** longword the program can see, through the same address space Leek uses */
function leek(rt: Runtime, addr: number): number {
  const m = rt.resolveAddr(addr)!
  return (((m.data[m.off]! << 24) | (m.data[m.off + 1]! << 16) | (m.data[m.off + 2]! << 8) | m.data[m.off + 3]!) >>> 0)
}

/** big-endian word the program can see */
function getWord(rt: Runtime, addr: number): number {
  const m = rt.resolveAddr(addr)!
  return ((m.data[m.off]! << 8) | m.data[m.off + 1]!) & 0xffff
}

/** 24 KB of work bank, then the list built into it */
const withBank = (body: string[]): string => ['Reserve As Work 10,24000', 'A=Start(10)', ...body].join('\n')

describe('Personnal: building the copper list (L26/L10, +AMOSPro_Personnal.Lib.s:1008/566)', () => {
  it('Create Standard lays down the list the source lays down, longword for longword', () => {
    const rt = run(withBank(['Create Standard A']))
    const s = rt.personnal
    expect(s.copperBase).toBeGreaterThan(0)
    const base = s.copperBase
    // the header: WAIT $10, then FMODE 0 against double scanning
    expect(leek(rt, base)).toBe(0x1003fffe)
    expect(leek(rt, base + 4)).toBe(0x01fc0000)
    // eight sprite pointer pairs, $0120 stepping by 2 a move
    expect(s.sprPtBase).toBe(base + 8)
    expect(leek(rt, s.sprPtBase)).toBe(0x01200000)
    expect(leek(rt, s.sprPtBase + 60)).toBe(0x013e0000)
    // one bank of 32 colours after a WAIT $18 — Create Aga is where 8 banks live
    expect(leek(rt, s.sprPtBase + 64)).toBe(0x1803fffe)
    expect(s.colorBase).toBe(s.sprPtBase + 68)
    expect(leek(rt, s.colorBase)).toBe(0x01800000)
    expect(leek(rt, s.colorBase + 124)).toBe(0x01be0000)
    // BPL1PTH..BPL8PTL, sixteen moves
    expect(leek(rt, s.bplPtBase)).toBe(0x00e00000)
    expect(leek(rt, s.bplPtBase + 60)).toBe(0x00fe0000)
    // the register block the geometry keywords patch
    expect(leek(rt, s.others)).toBe(0x008e0181) // DIWSTRT
    expect(leek(rt, s.others + 4)).toBe(0x009037c1) // DIWSTOP
    expect(leek(rt, s.others + 8)).toBe(0x00920038) // DDFSTRT
    expect(leek(rt, s.others + 12)).toBe(0x009400d0) // DDFSTOP
    expect(leek(rt, s.others + 16)).toBe(0x01080000) // BPL1MOD
    expect(leek(rt, s.others + 20)).toBe(0x010a0000) // BPL2MOD
    expect(leek(rt, s.others + 24)).toBe(0x0098ffc0) // CLXCON
    expect(leek(rt, s.bplConBase)).toBe(0x01001000) // BPLCON0, one plane
    expect(leek(rt, s.bplConBase + 12)).toBe(0x01060c00) // BPLCON3, PAL 2nd field
    // _CurrentLine points at the WAIT $F2, so the tail is that, DMACON off,
    // WAIT $F3, BPLCON3 back to AMOS's default, then the terminator
    expect(leek(rt, s.currentLine)).toBe(0xf203fffe)
    expect(leek(rt, s.currentLine + 4)).toBe(0x00960100)
    expect(leek(rt, s.currentLine + 8)).toBe(0xf303fffe)
    expect(leek(rt, s.currentLine + 12)).toBe(0x01060000)
    expect(leek(rt, s.currentLine + 16)).toBe(0xfffffffe)
    expect(s.line).toBe(0x32)
    expect(s.aga).toBe(0)
  })

  it('Create Aga writes eight colour banks, then eight more behind LOCT', () => {
    const rt = run(withBank(['Create Aga A']))
    const s = rt.personnal
    expect(s.aga).toBe(1)
    // bank 0 select, then 32 colours, then bank 1 select at +$2000
    expect(leek(rt, s.colorBase)).toBe(0x01060000)
    expect(leek(rt, s.colorBase + 4)).toBe(0x01800000)
    expect(leek(rt, s.colorBase + 132)).toBe(0x01062000)
    expect(leek(rt, s.colorBase + 136)).toBe(0x01800000)
    // after eight banks of (1 + 32) comes the complement set, the same eight
    // again but with BPLCON3 bit 9 set — $0200, LOCT (_cd2, :606). That is
    // how AGA carries 24 bits through 12-bit registers: each COLOR is written
    // twice and LOCT says which half.
    expect(s.colorBase2).toBe(s.colorBase + 8 * 33 * 4)
    expect(leek(rt, s.colorBase2)).toBe(0x01060200)
    expect(leek(rt, s.colorBase2 + 132)).toBe(0x01062200)
    // and the bitplane pointers follow both sets
    expect(s.bplPtBase - s.colorBase).toBe(16 * 33 * 4 + 8)
  })

  it('Create Standard has no complement block at all', () => {
    const rt = run(withBank(['Create Standard A']))
    expect(rt.personnal.colorBase2).toBe(0)
  })

  it('a zero address is the error the extension raises, in its own words', () => {
    // ErrMess entry 0 (:4485), reached through routine 122
    expect(() => run('Create Standard 0')).toThrow(/Adresse pour copper list INVALIDE/)
    expect(() => run('Create Aga 0')).toThrow(/Adresse pour copper list INVALIDE/)
  })
})

describe('Personnal: screen geometry (L23/L24/L25/L29/L30)', () => {
  it('Set Screen Sizes floors at 320x192 and writes both modulos', () => {
    // L23 :961 — Cmp/Bgt substitutes the minimum rather than clamping up,
    // then (X-320)>>3 goes in at _Others+18 and again at +22
    const rt = run(withBank(['Create Standard A', 'Set Screen Sizes 640,400']))
    const s = rt.personnal
    expect(s.xy).toEqual([640, 400])
    const mod = (640 - 320) >> 3
    expect(leek(rt, s.others + 16) & 0xffff).toBe(mod) // BPL1MOD word
    expect(leek(rt, s.others + 20) & 0xffff).toBe(mod) // BPL2MOD word
  })

  it('a request under the minimum becomes the minimum', () => {
    const rt = run(withBank(['Create Standard A', 'Set Screen Sizes 100,50']))
    expect(rt.personnal.xy).toEqual([320, 192])
    expect(leek(rt, rt.personnal.others + 16) & 0xffff).toBe(0)
  })

  it('Screen X/Y Size re-apply the floor when they read', () => {
    // L24 :989 and L25 :998 both compare against the minimum on the way out,
    // so they answer 320/192 even before a list exists
    let out = ''
    const rt = new Runtime(tokenize('Print Screen X Size : Print Screen Y Size', table, exts), table, {
      extensions: exts,
      maxSteps: 200_000,
      onText: (t) => (out += t),
    })
    rt.runHeadless(100)
    expect(out).toBe(' 320\n 192\n')
    void rt
  })

  it('Set Resolution and Set Lace are single bits of BPLCON0', () => {
    // L29 :1246 is Bset/Bclr #15, L30 :1264 is #2, both on _BplConBase+2
    const base = 0x01001000 & 0xffff
    const rt = run(withBank(['Create Standard A', 'Set Resolution 1', 'Set Lace 1']))
    const w = leek(rt, rt.personnal.bplConBase) & 0xffff
    expect(w).toBe((base | 0x8000 | 0x0004) & 0xffff)
    const off = run(withBank(['Create Standard A', 'Set Resolution 1', 'Set Lace 1', 'Set Resolution 0', 'Set Lace 0']))
    expect(leek(off, off.personnal.bplConBase) & 0xffff).toBe(base)
  })

  it('patching geometry before a list exists raises "Copper list non reservee."', () => {
    // ErrMess entry 1: _Others and _BplConBase are still null
    expect(() => run('Set Screen Sizes 640,400')).toThrow(/Copper list non reservee/)
    expect(() => run('Set Resolution 1')).toThrow(/Copper list non reservee/)
    expect(() => run('Set Lace 1')).toThrow(/Copper list non reservee/)
  })
})

describe('Personnal: the registers written outside a list', () => {
  it('Set Pal and Set Ntsc write BEAMCON0 (L4/L3, :528/:524)', () => {
    expect(run('Set Ntsc').beamcon0).toBe(0x0000)
    expect(run('Set Pal').beamcon0).toBe(0x0020)
  })

  it('Aga Off clears FMODE and BPLCON3 (L61, :2672)', () => {
    const rt = run('Aga Off')
    expect(rt.fmode).toBe(0)
    expect(rt.bplcon3Direct).toBe(0)
  })
})

describe('Personnal: bitplanes (L16/L17/L21/L85/L86/L109)', () => {
  it('Set Plane records the address and rewrites every pointer in the list', () => {
    // _spb (:779) copies WORDS out of _BitsPlanes, so a longword address
    // becomes its own PTH then PTL. Twelve words for six planes.
    const rt = run(withBank(['Create Standard A', 'Set Plane 1,$12345678', 'Set Plane 2,$AABBCCDD']))
    const s = rt.personnal
    expect(leek(rt, s.bplPtBase)).toBe(0x00e01234) // BPL1PTH
    expect(leek(rt, s.bplPtBase + 4)).toBe(0x00e25678) // BPL1PTL
    expect(leek(rt, s.bplPtBase + 8)).toBe(0x00e4aabb) // BPL2PTH
    expect(leek(rt, s.bplPtBase + 12)).toBe(0x00e6ccdd) // BPL2PTL
  })

  it('Create Aga writes sixteen words, Create Standard only twelve', () => {
    // the loop counts are 15 and 11 with a Bpl, so one more than they look:
    // plane 7 reaches the list under Aga and does not under Standard
    const aga = run(withBank(['Create Aga A', 'Set Plane 7,$11112222']))
    expect(leek(aga, aga.personnal.bplPtBase + 48)).toBe(0x00f81111) // BPL7PTH
    const std = run(withBank(['Create Standard A', 'Set Plane 7,$11112222']))
    expect(leek(std, std.personnal.bplPtBase + 48)).toBe(0x00f80000) // untouched
  })

  it('an out-of-range plane is ignored, a missing list is not', () => {
    // L16 branches to its RTS for 0 or 9 and says nothing
    const rt = run(withBank(['Create Standard A', 'Set Plane 0,$1234', 'Set Plane 9,$5678']))
    expect(rt.personnal.planes.every((p) => p === 0)).toBe(true)
    expect(() => run('Set Plane 1,$1234')).toThrow(/Copper list non reservee/)
  })

  it('Plane Base answers what Set Plane recorded, and 0 off the ends', () => {
    let out = ''
    const src = withBank(['Create Standard A', 'Set Plane 3,$DEAD', 'Print Plane Base(3) : Print Plane Base(9)'])
    const rt = new Runtime(tokenize(src, table, exts), table, { extensions: exts, maxSteps: 500_000, onText: (t) => (out += t) })
    rt.runHeadless(200)
    expect(out).toBe(` ${0xdead}\n 0\n`)
  })

  it('Swap Planes exchanges the two sets and rewrites the pointers', () => {
    const rt = run(
      withBank(['Create Standard A', 'Set Plane 1,$1000', 'Set D Plane 1,$2000', 'Swap Planes']),
    )
    const s = rt.personnal
    expect(s.planes[0]).toBe(0x2000)
    expect(s.planesD[0]).toBe(0x1000)
    expect(leek(rt, s.bplPtBase + 4) & 0xffff).toBe(0x2000) // the list followed
    // and back again
    const twice = run(
      withBank(['Create Standard A', 'Set Plane 1,$1000', 'Set D Plane 1,$2000', 'Swap Planes', 'Swap Planes']),
    )
    expect(twice.personnal.planes[0]).toBe(0x1000)
  })

  it('Swap Planes before any Set Plane is the error, list or no list', () => {
    // guarded on _BitsPlanes[0], not on _CopperBase (sppx, :3362)
    expect(() => run(withBank(['Create Standard A', 'Swap Planes']))).toThrow(/Copper list non reservee/)
  })

  it('Set View Planes writes BPU, with eight planes at bit 4', () => {
    // _PlanesMask (:399) is $0,$1000..$7000,$10 — the eighth count is BPU3
    const four = run(withBank(['Create Standard A', 'Set View Planes 4']))
    expect(leek(four, four.personnal.bplConBase) & 0x7010).toBe(0x4000)
    const eight = run(withBank(['Create Aga A', 'Set View Planes 8']))
    expect(leek(eight, eight.personnal.bplConBase) & 0x7010).toBe(0x0010)
    // What the interpreter makes of that cannot be asserted here: nothing has
    // pointed the hardware at this list yet, so copRegs still holds its seeded
    // defaults. Active Copper is batch 4, and the readback belongs with it.
  })

  it('above six planes needs an Aga list; a Standard one ignores the ask', () => {
    const rt = run(withBank(['Create Standard A', 'Set View Planes 4', 'Set View Planes 7']))
    expect(leek(rt, rt.personnal.bplConBase) & 0x7010).toBe(0x4000) // still four
  })

  it('Mplot Planes refuses a bad count out loud (ErrMess 14)', () => {
    expect(run('Mplot Planes 8').personnal.mpP).toBe(8)
    expect(() => run('Mplot Planes 0')).toThrow(/Valeur permise de 1 a 8 seulement/)
    expect(() => run('Mplot Planes 9')).toThrow(/Valeur permise de 1 a 8 seulement/)
  })
})

describe('Personnal: Screen Position (L27, :1097)', () => {
  const base = ['Create Standard A', 'Set Screen Sizes 640,192', 'Set Plane 1,$00100000', 'Set Plane 2,$00200000']

  it('a whole-word X and a Y both move the pointer, by row and by word', () => {
    // rowBytes is _XY[0]>>3 = 80; X 32 is two whole words, no scroll left over
    const rt = run(withBank([...base, 'Screen Position 0,32,2']))
    const s = rt.personnal
    const want = (0x00100000 + 2 * 80 + (32 >> 4) * 2) >>> 0
    expect(leek(rt, s.bplPtBase) & 0xffff).toBe((want >>> 16) & 0xffff)
    expect(leek(rt, s.bplPtBase + 4) & 0xffff).toBe(want & 0xffff)
    // no sub-word remainder, so BPLCON1 stays clear
    expect(leek(rt, s.bplConBase + 4) & 0xffff).toBe(0)
  })

  it('the leftover pixels become BPLCON1 delay, as 16 minus the remainder', () => {
    // X 5: (5>>4)*2 = 0 bytes, and 16-5 = 11 of scroll in both nibbles
    const rt = run(withBank([...base, 'Screen Position 0,5,0']))
    expect(leek(rt, rt.personnal.bplConBase + 4) & 0xffff).toBe((11 << 4) | 11)
  })

  it('the two playfields scroll independently, packed high nibble first', () => {
    const rt = run(withBank([...base, 'Screen Position 1,5,0', 'Screen Position 2,3,0']))
    // playfield 1 keeps 16-5, playfield 2 takes 16-3
    expect(leek(rt, rt.personnal.bplConBase + 4) & 0xffff).toBe((13 << 4) | 11)
  })

  it('scrolling pulls DDFSTRT a word earlier and takes 2 off both modulos', () => {
    const s0 = run(withBank([...base, 'Screen Position 0,0,0'])).personnal
    const rt0 = run(withBank([...base, 'Screen Position 0,0,0']))
    expect(leek(rt0, s0.others + 8) & 0xffff).toBe(0x38)
    const mod = (640 - 320) >> 3
    expect(leek(rt0, s0.others + 16) & 0xffff).toBe(mod)

    const rt1 = run(withBank([...base, 'Screen Position 0,5,0']))
    const s1 = rt1.personnal
    expect(leek(rt1, s1.others + 8) & 0xffff).toBe(0x30)
    expect(leek(rt1, s1.others + 16) & 0xffff).toBe(mod - 2)
    expect(leek(rt1, s1.others + 20) & 0xffff).toBe(mod - 2)
  })

  it('even planes take the first offset and odd planes the second', () => {
    // the dual-playfield split: _S3c adds d2 to one and d3 to the other
    const rt = run(withBank([...base, 'Screen Position 1,0,1', 'Screen Position 2,0,3']))
    const s = rt.personnal
    // type 2 leaves _D4 = 2, so the no-scroll correction takes a word off each
    const p1 = (0x00100000 + 1 * 80 - 2) >>> 0
    const p2 = (0x00200000 + 3 * 80 - 2) >>> 0
    expect(leek(rt, s.bplPtBase + 4) & 0xffff).toBe(p1 & 0xffff)
    expect(leek(rt, s.bplPtBase + 12) & 0xffff).toBe(p2 & 0xffff)
  })

  it('positioning before any Set Plane is the error', () => {
    expect(() => run(withBank(['Create Standard A', 'Screen Position 0,0,0']))).toThrow(/Copper list non reservee/)
  })
})

describe('Personnal: the Mplot point bank (L94/L95/L98/L99/L101-103/L108)', () => {
  it('Mplot Reserve allocates n*6+8 bytes headed by "F.C2" and the count', () => {
    const rt = run('Mplot Reserve 100')
    const s = rt.personnal
    expect(s.mplots).toBe(100)
    expect(s.mpBase).toBe(Runtime.PERSONNAL_BASE)
    expect(rt.personnalMem!.length).toBe(100 * 6 + 8)
    expect(leek(rt, s.mpBase)).toBe(0x462e4332) // "F.C2"
    expect(leek(rt, s.mpBase + 4)).toBe(100)
  })

  it('reserving twice is an error, erasing lets you start again', () => {
    expect(() => run(['Mplot Reserve 10', 'Mplot Reserve 10'].join('\n'))).toThrow(/deja reservee/)
    const rt = run(['Mplot Reserve 10', 'Mplot Erase', 'Mplot Reserve 20'].join('\n'))
    expect(rt.personnal.mplots).toBe(20)
    // erasing an unreserved bank says nothing at all
    expect(run('Mplot Erase').personnal.mplots).toBe(0)
  })

  it('a point is six bytes: X, Y, ink', () => {
    const rt = run(['Mplot Reserve 4', 'Mplot Define 2,100,50,7'].join('\n'))
    const at = rt.personnal.mpBase + 8 + 6
    expect(leek(rt, at) >>> 16).toBe(100)
    expect(leek(rt, at) & 0xffff).toBe(50)
    expect(leek(rt, at + 4) >>> 16).toBe(7)
  })

  it('X/Y/C Mplot read the point back, sign-extended', () => {
    // Btst #15 / Or #$ffff0000 (:4045): a point left of the origin is negative
    let out = ''
    const src = ['Mplot Reserve 4', 'Mplot Define 1,-5,-9,3', 'Print X Mplot(1);Y Mplot(1);C Mplot(1)'].join('\n')
    const rt = new Runtime(tokenize(src, table, exts), table, { extensions: exts, maxSteps: 500_000, onText: (t) => (out += t) })
    rt.runHeadless(200)
    expect(out).toBe('-5-9 3\n')
  })

  it('the bank errors are its own, and different from each other', () => {
    // 11 for no bank at all, 13 for a point outside what was reserved
    expect(() => run('Mplot Define 1,0,0,0')).toThrow(/Multi Plot bank non reservee/)
    expect(() => run(['Mplot Reserve 4', 'Mplot Define 5,0,0,0'].join('\n'))).toThrow(/HORS limite/)
    expect(() => run(['Mplot Reserve 4', 'Mplot Define 0,0,0,0'].join('\n'))).toThrow(/HORS limite/)
    expect(() => run('Print X Mplot(1)')).toThrow(/Multi Plot bank non reservee/)
  })

  it('Mplot Base answers the address, and Mplot Origin records the axes', () => {
    let out = ''
    const src = ['Mplot Reserve 2', 'Mplot Origin 160,100', 'Print Mplot Base>0'].join('\n')
    const rt = new Runtime(tokenize(src, table, exts), table, { extensions: exts, maxSteps: 500_000, onText: (t) => (out += t) })
    rt.runHeadless(200)
    expect(out).toBe('-1\n')
    expect(rt.personnal.origin).toEqual([160, 100])
  })

  it('Mplot Planes defaults to eight, as _MpP does', () => {
    // _MpP Dc.l 8 (:397) — the engine draws into all eight until told otherwise
    expect(run('Mplot Reserve 1').personnal.mpP).toBe(8)
  })
})

describe('Personnal: Mplot Draw and the field defines (L100/L105-107)', () => {
  // a real screen so the plane addresses resolve to its planar mirror
  // Set Plane needs a list to write pointers into, so build one; _XY keeps
  // its 320x192 default, which is what the bounds below are measured against
  const scene = (body: string[]): string =>
    [
      'Screen Open 0,320,200,4,Lowres',
      'Curs Off : Flash Off : Cls 0',
      'P=Logbase(0)',
      'Reserve As Work 10,24000',
      'A=Start(10)',
      'Create Standard A',
      ...body,
    ].join('\n')

  it('plots into the plane bits, MSB leftmost, and the chunky side sees it', () => {
    // the write goes through the planar mirror; Point reads the chunky one,
    // so this is the round trip screen.ts:127-392 promises
    let out = ''
    const src = scene([
      'Set Plane 1,P : Set Plane 2,P+8000',
      'Mplot Planes 2',
      'Mplot Reserve 2',
      'Mplot Define 1,10,20,3',
      'Mplot Draw 1 To 2',
      'R1=Point(10,20) : R2=Point(11,20)',
      'Print R1;R2',
    ])
    const rt = new Runtime(tokenize(src, table, exts), table, { extensions: exts, maxSteps: 1_000_000, onText: (t) => (out += t) })
    rt.runHeadless(300)
    // ink 3 into two planes lights both bits of the index; its neighbour stays 0
    expect(out).toBe(' 3 0\n')
  })

  it('clears a plane whose colour bit is 0, rather than leaving it', () => {
    // the loop Bclr's as readily as it Bset's (_MpClear, :4014)
    let out = ''
    const src = scene([
      'Set Plane 1,P : Set Plane 2,P+8000',
      'Mplot Planes 2 : Mplot Reserve 1',
      'Ink 3 : Plot 10,20',
      'Mplot Define 1,10,20,1',
      'Mplot Draw 1 To 2',
      'Print Point(10,20)',
    ])
    const rt = new Runtime(tokenize(src, table, exts), table, { extensions: exts, maxSteps: 1_000_000, onText: (t) => (out += t) })
    rt.runHeadless(300)
    expect(out).toBe(' 1\n') // plane 2's bit was cleared back down
  })

  it('the origin shifts the coordinates, and off-screen points are dropped', () => {
    let out = ''
    const src = scene([
      'Set Plane 1,P',
      'Mplot Planes 1 : Mplot Reserve 2',
      'Mplot Origin 100,50',
      'Mplot Define 1,5,5,1',
      'Mplot Define 2,-500,0,1',
      'Mplot Draw 1 To 3',
      'R1=Point(105,55) : R2=Point(5,5)',
      'Print R1;R2',
    ])
    const rt = new Runtime(tokenize(src, table, exts), table, { extensions: exts, maxSteps: 1_000_000, onText: (t) => (out += t) })
    rt.runHeadless(300)
    expect(out).toBe(' 1 0\n') // drawn at the origin, and the wild one vanished
  })

  it('a zero plane address abandons the whole point, not just that plane', () => {
    // _Mpp1's Beq goes to _xxl (:4006) — plane 3 unset truncates the pixel
    let out = ''
    const src = scene([
      'Set Plane 1,P : Set Plane 2,P+8000',
      'Mplot Planes 4 : Mplot Reserve 1',
      'Mplot Define 1,10,20,15',
      'Mplot Draw 1 To 2',
      'Print Point(10,20)',
    ])
    const rt = new Runtime(tokenize(src, table, exts), table, { extensions: exts, maxSteps: 1_000_000, onText: (t) => (out += t) })
    rt.runHeadless(300)
    expect(out).toBe(' 3\n') // planes 1 and 2 only; 3 and 4 were never reached
  })

  it('the field defines step and wrap: X on width, Y on height, C on 256', () => {
    const rt = run(
      [
        'Mplot Reserve 1',
        'Mplot Define 1,318,198,254',
        'Mplot X Define 1,5', // 318+5 = 323 >= 320 -> 0
        'Mplot Y Define 1,5', // 198+5 = 203 >= 192 -> 0  (the floor, not 200)
        'Mplot C Define 1,5', // 254+5 = 259 >= 256 -> 0
      ].join('\n'),
    )
    const at = rt.personnal.mpBase + 8
    expect(leek(rt, at) >>> 16).toBe(0)
    expect(leek(rt, at) & 0xffff).toBe(0)
    expect(leek(rt, at + 4) >>> 16).toBe(0)
  })

  it('stepping below zero wraps to the far end', () => {
    const rt = run(['Mplot Reserve 1', 'Mplot Define 1,2,2,2', 'Mplot X Define 1,-5'].join('\n'))
    // 2-5 = -3, so it lands on width-1
    expect(leek(rt, rt.personnal.mpBase + 8) >>> 16).toBe(319)
  })

  it('drawing or stepping without a bank is ErrMess 11', () => {
    expect(() => run('Mplot Draw 1 To 2')).toThrow(/Multi Plot bank non reservee/)
    expect(() => run('Mplot X Define 1,1')).toThrow(/Multi Plot bank non reservee/)
  })
})

describe('Personnal: the Mplot range is exclusive, and the rest of batch 3', () => {
  it('Mplot Draw stops short of the last point, as the source does', () => {
    // Cmp.l a0,a1 / Bgt at _xxl (:4027) tests after the pointer has stepped a
    // whole point, so the range ends before `last`. The guide says the
    // opposite — "jusqu'au point LAST" — and every demo writes
    // `Mplot Draw 1 To NUM` after reserving NUM, so the last point never
    // draws on a real machine either. Source beats manual.
    let out = ''
    const src = [
      'Screen Open 0,320,200,4,Lowres',
      'Curs Off : Flash Off : Cls 0',
      'P=Logbase(0)',
      'Reserve As Work 10,24000 : A=Start(10)',
      'Create Standard A',
      'Set Plane 1,P : Mplot Planes 1',
      'Mplot Reserve 2',
      'Mplot Define 1,10,10,1',
      'Mplot Define 2,20,10,1',
      'Mplot Draw 1 To 2',
      'R1=Point(10,10) : R2=Point(20,10)',
      'Print R1;R2',
    ].join('\n')
    const rt = new Runtime(tokenize(src, table, exts), table, { extensions: exts, maxSteps: 1_000_000, onText: (t) => (out += t) })
    rt.runHeadless(300)
    expect(out).toBe(' 1 0\n') // point 2 was named as the bound, so it is not drawn
  })

  it('Mplot Modify steps a whole range, wrapping each field on its own axis', () => {
    const rt = run(
      [
        'Mplot Reserve 4',
        'Mplot Define 1,10,10,1',
        'Mplot Define 2,318,190,1',
        'Mplot Define 3,50,50,1',
        'Mplot Modify 1 To 3,5,5',
      ].join('\n'),
    )
    const at = (n: number): number => rt.personnal.mpBase + 8 + (n - 1) * 6
    expect(leek(rt, at(1)) >>> 16).toBe(15) // stepped
    expect(leek(rt, at(1)) & 0xffff).toBe(15)
    expect(leek(rt, at(2)) >>> 16).toBe(0) // 318+5 wrapped on the width
    expect(leek(rt, at(2)) & 0xffff).toBe(0) // 190+5 wrapped on the height
    expect(leek(rt, at(3)) >>> 16).toBe(50) // the bound itself is untouched
  })

  it('Mplot Save then Load round-trips the bank through the filesystem', () => {
    const rt = run(
      [
        'Mplot Reserve 3',
        'Mplot Define 1,11,22,3',
        'Mplot Define 3,44,55,6',
        'Mplot Save "RAM:pts.mp"',
        'Mplot Erase',
        'Mplot Load "RAM:pts.mp"',
      ].join('\n'),
      withRam(),
    )
    const s = rt.personnal
    expect(s.mplots).toBe(3)
    expect(leek(rt, s.mpBase)).toBe(0x462e4332) // the cookie came back
    expect(leek(rt, s.mpBase + 8) >>> 16).toBe(11)
    expect(leek(rt, s.mpBase + 8 + 12) >>> 16).toBe(44)
  })

  it('loading something that is not an Mplot file is ErrMess 10', () => {
    const fs = withRam()
    fs.writeFile('RAM:junk.bin', new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]))
    expect(() => run('Mplot Load "RAM:junk.bin"', fs)).toThrow(/Fichier d'un format inconnu/)
    // and a file too short to hold even the header
    fs.writeFile('RAM:tiny.bin', new Uint8Array([1, 2]))
    expect(() => run('Mplot Load "RAM:tiny.bin"', fs)).toThrow(/Fichier d'un format inconnu/)
  })

  it('Lsr Zone moves a block four bytes forward, backwards so it does not eat itself', () => {
    // the assertions run inside AMOS so the test needs no bank internals
    let out = ''
    const src = [
      'Reserve As Work 11,64 : B=Start(11)',
      'Loke B,$11111111 : Loke B+4,$22222222 : Loke B+8,$33333333',
      'Lsr Zone B To B+8',
      'R1=Leek(B+8) : R2=Leek(B+4) : R3=Leek(B)',
      'Print R1=$22222222;R2=$22222222;R3=$11111111',
    ].join('\n')
    const rt = new Runtime(tokenize(src, table, exts), table, { extensions: exts, maxSteps: 500_000, onText: (t) => (out += t) })
    rt.runHeadless(200)
    // +4 moved up to +8; the walk then reaches the source and stops, so the
    // longword at +4 keeps its own value and the one at the source never
    // moves at all (Cmp.l a0,a1 / Bgt, :4260). One longword, not the block.
    expect(out).toBe('-1-1-1\n')
  })
})

describe('Personnal: the copper list keywords (L14/L15/L19/L20/L31/L37/L74)', () => {
  const bank = ['Reserve As Work 10,24000', 'A=Start(10)', 'Create Standard A']

  it('Copper Base reads back what was built, and can be pointed elsewhere', () => {
    let out = ''
    const src = [...bank, 'C=Copper Base', 'Copper Base $1234', 'D=Copper Base', 'Print C=A;D=$1234'].join('\n')
    const rt = new Runtime(tokenize(src, table, exts), table, { extensions: exts, maxSteps: 500_000, onText: (t) => (out += t) })
    rt.runHeadless(200)
    expect(out).toBe('-1-1\n')
  })

  it('Copper Wait Line appends a WAIT and re-terminates after it', () => {
    const rt = run([...bank, 'Copper Wait Line $50'].join('\n'))
    const s = rt.personnal
    // the wait overwrote the tail the builder left at _CurrentLine
    const at = s.currentLine - 4
    expect(leek(rt, at)).toBe(0x5003fffe) // line $50, hpos byte $03
    expect(s.line).toBe(0x50)
    // and a fresh tail follows, ending in the terminator
    expect(leek(rt, s.currentLine)).toBe(0xf201fffe)
    expect(leek(rt, s.currentLine + 16)).toBe(0xfffffffe)
  })

  it('Copper Next Line steps on from the last one, wrapping past $100', () => {
    // the builder leaves _Line at $32
    const rt = run([...bank, 'Copper Next Line'].join('\n'))
    expect(rt.personnal.line).toBe(0x33)
    expect(leek(rt, rt.personnal.currentLine - 4)).toBe(0x3301fffe) // hpos byte $01
    const wrapped = run([...bank, 'Copper Wait Line $FF', 'Copper Next Line'].join('\n'))
    expect(wrapped.personnal.line).toBe(0)
  })

  it('Copper Line reports where the list has got to', () => {
    let out = ''
    const src = [...bank, 'Copper Wait Line 100', 'Print Copper Line'].join('\n')
    const rt = new Runtime(tokenize(src, table, exts), table, { extensions: exts, maxSteps: 500_000, onText: (t) => (out += t) })
    rt.runHeadless(200)
    expect(out).toBe(' 100\n')
  })

  it('Active Copper points COP1LC at the list, and the display follows it', () => {
    // the whole point of batches 1-4: a list built by hand now drives the
    // screen, through the same interpreter Cop Move feeds
    const src = [
      'Screen Open 0,320,200,4,Lowres',
      'Curs Off : Flash Off : Cls 0',
      'Reserve As Chip Data 8,16384',
      'Create Standard Start(8)',
      'Set Screen Sizes 320,200',
      'Set View Planes 2',
      'AX=Screen Base',
      'Set Plane 1,Leek(AX) : Set Plane 2,Leek(AX+4)',
      'Copper Off',
      'Active Copper',
    ].join('\n')
    const rt = run(src)
    expect(rt.copList1Addr).toBeGreaterThan(0)
    expect(rt.copList1Addr).toBe(rt.personnal.copperBase)
    // and the walk picks it up: the list sets BPU 2 through _PlanesMask
    rt.composite()
    expect((rt as unknown as { copRegs: { bpu: number } }).copRegs.bpu).toBe(2)
  })

  it('activating without a list is the extension error, not a crash', () => {
    expect(() => run('Active Copper')).toThrow(/Copper list non reservee/)
  })

  it('the list is re-read every frame, so a later patch shows', () => {
    // the copper fetches from COP1LC afresh each frame; several demos patch
    // their list inside the main loop and expect that
    const rt = run(
      [
        'Screen Open 0,320,200,4,Lowres',
        'Curs Off : Flash Off : Cls 0',
        'Reserve As Chip Data 8,16384',
        'Create Standard Start(8)',
        'Copper Off',
        'Active Copper',
        'Set View Planes 4',
      ].join('\n'),
    )
    rt.composite()
    expect((rt as unknown as { copRegs: { bpu: number } }).copRegs.bpu).toBe(4)
  })
})

describe('Personnal: colour (L12/L18/L13/L22)', () => {
  const bank = ['Reserve As Work 10,24000', 'A=Start(10)']

  it('Set Color writes RGB4 into the block, indexing past bank selects', () => {
    // on a Standard list the entries are contiguous
    const std = run([...bank, 'Create Standard A', 'Set Color 3,15,8,1'].join('\n'))
    expect(leek(std, std.personnal.colorBase + 3 * 4) & 0xffff).toBe(0xf81)
    // on an Aga list a BPLCON3 select sits before each bank of 32, and the
    // walk steps over it (_sc2, :690) so register 32 is the first of bank 1
    const aga = run([...bank, 'Create Aga A', 'Set Color 32,1,2,3'].join('\n'))
    const b1 = aga.personnal.colorBase + 33 * 4 // bank 0's select + its 32
    expect(leek(aga, b1)).toBe(0x01062000) // the select itself
    expect(leek(aga, b1 + 4) & 0xffff).toBe(0x123)
  })

  it('Set Color() reads the shadow, which Set Color does not fill', () => {
    // L18 (:810) reads _AgaPalette; L12 writes only the list. So a colour set
    // through Set Color reads back as 0, and a bad register as -1. The
    // library's own asymmetry, kept.
    let out = ''
    const src = [...bank, 'Create Standard A', 'Set Color 3,15,8,1', 'Print Set Color(3);Set Color(99)'].join('\n')
    const rt = new Runtime(tokenize(src, table, exts), table, { extensions: exts, maxSteps: 500_000, onText: (t) => (out += t) })
    rt.runHeadless(200)
    expect(out).toBe(' 0-1\n') // 0 from the empty shadow, -1 for 99 on a non-Aga list
  })

  it('New Color Value appends a COLOR move at the current line', () => {
    const rt = run([...bank, 'Create Standard A', 'Copper Wait Line $60', 'New Color Value 1,15,0,0'].join('\n'))
    const s = rt.personnal
    const at = s.currentLine - 4
    expect(getWord(rt, at)).toBe(0x0182) // COLOR01
    expect(getWord(rt, at + 2)).toBe(0xf00)
  })

  it('a colour in another bank emits a BPLCON3 select first, once', () => {
    const rt = run(
      [...bank, 'Create Aga A', 'Copper Wait Line $60', 'New Color Value 33,1,1,1', 'New Color Value 34,2,2,2'].join('\n'),
    )
    const s = rt.personnal
    // bank 1 selected once, then both colours; register 33 is COLOR01 of it
    expect(leek(rt, s.currentLine - 12)).toBe(0x01062000)
    expect(getWord(rt, s.currentLine - 8)).toBe(0x0182)
    expect(getWord(rt, s.currentLine - 4)).toBe(0x0184) // no second select
  })

  it('a register outside 0..255 is ErrMess 2, not a silent miss', () => {
    expect(() => run([...bank, 'Create Standard A', 'New Color Value 300,0,0,0'].join('\n'))).toThrow(
      /Registre de couleur invalide/,
    )
  })

  it('X Fade takes one step off every colour in the whole list', () => {
    const rt = run([...bank, 'Create Standard A', 'Set Color 1,15,8,0', 'X Fade'].join('\n'))
    // each non-zero nibble drops by one; the zero one stays put
    expect(leek(rt, rt.personnal.colorBase + 4) & 0xffff).toBe(0xe70)
    const twice = run([...bank, 'Create Standard A', 'Set Color 1,15,8,0', 'X Fade', 'X Fade'].join('\n'))
    expect(leek(twice, twice.personnal.colorBase + 4) & 0xffff).toBe(0xd60)
  })

  it('X Fade reaches the colours New Color Value appended too', () => {
    const rt = run(
      [...bank, 'Create Standard A', 'Copper Wait Line $60', 'New Color Value 1,4,4,4', 'X Fade'].join('\n'),
    )
    expect(getWord(rt, rt.personnal.currentLine - 2)).toBe(0x333)
  })
})

describe('Personnal: the AGA and CMAP half of colour (L71/L72/L73/L75/L80)', () => {
  const bank = ['Reserve As Work 10,24000', 'A=Start(10)']

  it('Set Aga Color splits a 24-bit colour into the LOCT pair, 1-based', () => {
    // d7 keeps the high nibbles, d4 the remainders (:3132). Register 1 writes
    // the entry Set Color 0 writes — the two keywords disagree by one.
    const rt = run([...bank, 'Create Standard A', 'Set Aga Color 1,$FF,$8C,$03'].join('\n'))
    const s = rt.personnal
    expect(getWord(rt, s.colorBase + 2)).toBe(0xf80) // high nibbles
    // the low half has nowhere to go until a second block exists
    expect(s.colorBase2).toBe(0)
  })

  it('register 0 stops instead of spinning, which the source would', () => {
    // _80a decrements before testing for zero, so 0 counts down past it
    const rt = run([...bank, 'Create Standard A', 'Set Aga Color 0,$FF,$FF,$FF'].join('\n'))
    expect(getWord(rt, rt.personnal.colorBase + 2)).toBe(0)
  })

  it('Change Palette copies ready-made RGB4 words in, past bank selects', () => {
    const rt = run(
      [
        ...bank,
        'Reserve As Work 11,64 : B=Start(11)',
        'Doke B,$F00 : Doke B+2,$0F0 : Doke B+4,$00F',
        'Create Aga A',
        'Change Palette 3,B',
      ].join('\n'),
    )
    const s = rt.personnal
    expect(leek(rt, s.colorBase)).toBe(0x01060000) // the bank select is still there
    expect(getWord(rt, s.colorBase + 6)).toBe(0xf00) // and the colours went after it
    expect(getWord(rt, s.colorBase + 10)).toBe(0x0f0)
    expect(getWord(rt, s.colorBase + 14)).toBe(0x00f)
  })

  it('an 8-bit CMAP is shifted down four bits a channel, a 4-bit one is not', () => {
    const src = [
      ...bank,
      'Reserve As Work 11,64 : B=Start(11)',
      'Poke B,$FF : Poke B+1,$80 : Poke B+2,$11',
      'Create Standard A',
    ]
    const eight = run([...src, 'Iff8bits Palette To Copper 1,B'].join('\n'))
    expect(getWord(eight, eight.personnal.colorBase + 2)).toBe(0xf81)
    const four = run([...src, 'Poke B,$0F : Poke B+1,$08 : Poke B+2,$01', 'Iff4bits Palette To Copper 1,B'].join('\n'))
    expect(getWord(four, four.personnal.colorBase + 2)).toBe(0xf81)
  })

  it('Cmap Base finds the chunk and answers just past the tag', () => {
    let out = ''
    const src = [
      'Reserve As Work 11,64 : B=Start(11)',
      'Loke B,$464F524D : Loke B+4,$434D4150', // "FORM" then "CMAP"
      'Print Cmap Base(B)-B',
    ].join('\n')
    const rt = new Runtime(tokenize(src, table, exts), table, { extensions: exts, maxSteps: 500_000, onText: (t) => (out += t) })
    rt.runHeadless(200)
    expect(out).toBe(' 8\n') // the tag is at +4, so the length field is at +8
  })

  it('no CMAP anywhere is ErrMess 6', () => {
    expect(() => run(['Reserve As Work 11,64 : B=Start(11)', 'C=Cmap Base(B)'].join('\n'))).toThrow(
      /CMAP non trouve/,
    )
  })
})

describe('Personnal: the palette utilities (L66/L76/L77)', () => {
  const pal = ['Reserve As Work 11,64 : B=Start(11)', 'Reserve As Work 12,64 : C=Start(12)']

  it('Fade Palette steps each channel one towards the target, and stops there', () => {
    let out = ''
    const src = [
      ...pal,
      'Poke B,5 : Poke B+1,10 : Poke B+2,7',
      'Poke C,8 : Poke C+1,10 : Poke C+2,0',
      'Fade Palette 1,B,C',
      'R1=Peek(B) : R2=Peek(B+1) : R3=Peek(B+2)',
      'Print R1;R2;R3',
    ].join('\n')
    const rt = new Runtime(tokenize(src, table, exts), table, { extensions: exts, maxSteps: 500_000, onText: (t) => (out += t) })
    rt.runHeadless(200)
    // 5 rose towards 8, 10 had already arrived, 7 fell towards 0
    expect(out).toBe(' 6 10 6\n')
  })

  it('Attribute Palette adds per channel and clamps to 0..15', () => {
    let out = ''
    const src = [
      ...pal,
      'Poke B,2 : Poke B+1,14 : Poke B+2,8',
      'Attribute Palette 1,-5,4,1,B To C',
      'R1=Peek(C) : R2=Peek(C+1) : R3=Peek(C+2)',
      'Print R1;R2;R3',
    ].join('\n')
    const rt = new Runtime(tokenize(src, table, exts), table, { extensions: exts, maxSteps: 500_000, onText: (t) => (out += t) })
    rt.runHeadless(200)
    expect(out).toBe(' 0 15 9\n') // floored, ceilinged, and one that just moved
    // and the source is untouched — it writes somewhere else
    let out2 = ''
    const rt2 = new Runtime(
      tokenize([...pal, 'Poke B,2', 'Attribute Palette 1,5,0,0,B To C', 'R=Peek(B)', 'Print R'].join('\n'), table, exts),
      table,
      { extensions: exts, maxSteps: 500_000, onText: (t) => (out2 += t) },
    )
    rt2.runHeadless(200)
    expect(out2).toBe(' 2\n')
  })

  it('Iff Color reads a CMAP entry, and scans differently from Cmap Base', () => {
    // Iff Color steps +8 to the data; Cmap Base steps +4 to the length. Both
    // kept, because a program using one then the other depends on the gap.
    let out = ''
    const src = [
      'Reserve As Work 11,64 : B=Start(11)',
      'Loke B,$434D4150 : Loke B+4,$0000000C', // "CMAP", length 12
      'Poke B+8,$FF : Poke B+9,$80 : Poke B+10,$11',
      'Poke B+11,$00 : Poke B+12,$F0 : Poke B+13,$0F',
      'R1=Iff Color(B,0) : R2=Iff Color(B,1) : R3=Cmap Base(B)-B',
      'Print R1;R2;R3',
    ].join('\n')
    const rt = new Runtime(tokenize(src, table, exts), table, { extensions: exts, maxSteps: 500_000, onText: (t) => (out += t) })
    rt.runHeadless(200)
    expect(out).toBe(` ${0xf81} ${0x0f0} 4\n`)
  })

  it('Iff Color without a CMAP is ErrMess 6', () => {
    expect(() => run(['Reserve As Work 11,64 : B=Start(11)', 'R=Iff Color(B,0)'].join('\n'))).toThrow(
      /CMAP non trouve/,
    )
  })
})

describe('Personnal: dual playfield (L28/L42/L43/L65/L111/L112)', () => {
  const bank = ['Reserve As Work 10,24000', 'A=Start(10)', 'Create Standard A']

  it('Set Dual Mode is BPLCON0 bit 10, and it toggles', () => {
    const on = run([...bank, 'Set Dual Mode 1'].join('\n'))
    expect(getWord(on, on.personnal.bplConBase + 2) & 0x0400).toBe(0x0400)
    const off = run([...bank, 'Set Dual Mode 1', 'Set Dual Mode 0'].join('\n'))
    expect(getWord(off, off.personnal.bplConBase + 2) & 0x0400).toBe(0)
  })

  it('Inverse and Normal Playfields are BPLCON2 bit 6, PF2PRI', () => {
    const inv = run([...bank, 'Inverse Playfields'].join('\n'))
    expect(getWord(inv, inv.personnal.bplConBase + 10) & 0x40).toBe(0x40)
    const norm = run([...bank, 'Inverse Playfields', 'Normal Playfields'].join('\n'))
    expect(getWord(norm, norm.personnal.bplConBase + 10) & 0x40).toBe(0)
  })

  it('Set Dual Palette writes n<<10 into BPLCON3, clobbering the rest of it', () => {
    // the builder leaves $0c00 there for the PAL second field; a plain Move.w
    // takes the whole register, so that goes with it
    const rt = run([...bank, 'Set Dual Palette 2'].join('\n'))
    expect(getWord(rt, rt.personnal.bplConBase + 14)).toBe(2 << 10)
  })

  it('Dpf1 and Dpf2 Draw take alternate planes from the list', () => {
    // Dpf1 walks _BitsPlanes from the start, Dpf2 from its second entry, both
    // striding two (a_Mpp :4330, b_Mpp :4426)
    const scene = (draw: string): string =>
      [
        'Screen Open 0,320,200,4,Lowres',
        'Curs Off : Flash Off : Cls 0',
        'P=Logbase(0)',
        'Reserve As Work 10,24000 : A=Start(10)',
        'Create Standard A',
        // planes 1 and 3 are the real screen, 2 and 4 point elsewhere
        'Set Plane 1,P : Set Plane 2,P+16000',
        'Set Plane 3,P+8000 : Set Plane 4,P+24000',
        'Mplot Planes 1 : Mplot Reserve 2',
        'Mplot Define 1,10,20,1',
        draw,
        'R=Point(10,20)',
        'Print R',
      ].join('\n')
    let a = ''
    const rt1 = new Runtime(tokenize(scene('Mplot Dpf1 Draw 1 To 2'), table, exts), table, {
      extensions: exts,
      maxSteps: 1_000_000,
      onText: (t) => (a += t),
    })
    rt1.runHeadless(300)
    expect(a).toBe(' 1\n') // Dpf1 starts at plane 1, which is the screen
    let b = ''
    const rt2 = new Runtime(tokenize(scene('Mplot Dpf2 Draw 1 To 2'), table, exts), table, {
      extensions: exts,
      maxSteps: 1_000_000,
      onText: (t) => (b += t),
    })
    rt2.runHeadless(300)
    expect(b).toBe(' 0\n') // Dpf2 starts at plane 2, which points away
  })

  it('the dual-playfield draws need a bank like the ordinary one', () => {
    expect(() => run('Mplot Dpf1 Draw 1 To 2')).toThrow(/Multi Plot bank non reservee/)
    expect(() => run('Mplot Dpf2 Draw 1 To 2')).toThrow(/Multi Plot bank non reservee/)
  })
})

describe('Personnal: the second screen (L67/L68/L69/L70/L78)', () => {
  const bank = ['Reserve As Work 10,32000', 'A=Start(10)', 'Create Standard A']

  it('Active Second Screen appends a whole second display and re-aims the line keywords', () => {
    const rt = run([...bank, 'Active Second Screen'].join('\n'))
    const s = rt.personnal
    expect(s.second).toBe(1)
    expect(s.pal2).toBeGreaterThan(0)
    expect(s.bpl2).toBe(s.pal2 + 32 * 4)
    expect(s.bplcon2nd).toBeGreaterThan(s.bpl2)
    // its own colours and pointers
    expect(leek(rt, s.pal2)).toBe(0x01800000)
    expect(leek(rt, s.bpl2)).toBe(0x00e00000)
    expect(leek(rt, s.bplcon2nd)).toBe(0x01000000)
    // and it runs into the next field: the $FFD9 crossing then a wait for line 1
    expect(leek(rt, s.bplcon2nd + 12)).toBe(0xffd9fffe)
    expect(leek(rt, s.bplcon2nd + 16)).toBe(0x0103fffe)
    // _Line moves to $14 and _CurrentLine sits on the second screen's tail
    expect(s.line).toBe(0x14)
    expect(leek(rt, s.currentLine)).toBe(0x1403fffe)
  })

  it('once a second screen exists the line keywords use its shorter tail', () => {
    // appendWait branches on _2nd — a path that could not be reached until now
    const rt = run([...bank, 'Active Second Screen', 'Copper Wait Line $80'].join('\n'))
    const s = rt.personnal
    expect(leek(rt, s.currentLine)).toBe(0x1403fffe)
    expect(leek(rt, s.currentLine + 12)).toBe(0xfffffffe) // four longwords, not five
  })

  it('Set Second Planes writes one of five pointers, high word then low', () => {
    const rt = run([...bank, 'Active Second Screen', 'Set Second Planes 2,$12345678'].join('\n'))
    const s = rt.personnal
    expect(getWord(rt, s.bpl2 + 8 + 2)).toBe(0x1234)
    expect(getWord(rt, s.bpl2 + 12 + 2)).toBe(0x5678)
  })

  it('Set Second View and Set Second Color reach the second screen only', () => {
    const rt = run(
      [...bank, 'Set View Planes 2', 'Set Color 1,15,0,0', 'Active Second Screen', 'Set Second View 4', 'Set Second Color 1,0,15,0'].join('\n'),
    )
    const s = rt.personnal
    expect(getWord(rt, s.bplcon2nd + 2) & 0x7010).toBe(0x4000) // four planes there
    expect(getWord(rt, s.bplConBase + 2) & 0x7010).toBe(0x2000) // two here, untouched
    expect(getWord(rt, s.pal2 + 6)).toBe(0x0f0)
    expect(getWord(rt, s.colorBase + 6)).toBe(0xf00) // the first screen kept its red
  })

  it('the second-screen keywords raise ErrMess 7 before there is one', () => {
    expect(() => run([...bank, 'Set Second Planes 1,$1000'].join('\n'))).toThrow(/2e Ecran copper non cree/)
    expect(() => run([...bank, 'Set Second View 2'].join('\n'))).toThrow(/2e Ecran copper non cree/)
    expect(() => run([...bank, 'Set Second Color 0,1,1,1'].join('\n'))).toThrow(/2e Ecran copper non cree/)
  })

  it('Second Y Size rewrites the tail wait, guarded on it being the second screen\'s', () => {
    const rt = run([...bank, 'Active Second Screen', 'Second Y Size $30'].join('\n'))
    expect(getWord(rt, rt.personnal.currentLine) >> 8).toBe(0x30 - 0xd)
    // appending does not stop it: every append re-terminates, and a second
    // screen's tail always begins $14 again, so it still applies
    const after = run([...bank, 'Active Second Screen', 'Copper Wait Line $90', 'Second Y Size $30'].join('\n'))
    expect(getWord(after, after.personnal.currentLine) >> 8).toBe(0x30 - 0xd)
    // the guard bites on a first-screen list, whose tail begins $F2
    const first = run([...bank, 'Second Y Size $30'].join('\n'))
    expect(getWord(first, first.personnal.currentLine) >> 8).toBe(0xf2)
  })

  it('a size below $d is dropped rather than wrapped', () => {
    const rt = run([...bank, 'Active Second Screen', 'Second Y Size 5'].join('\n'))
    expect(getWord(rt, rt.personnal.currentLine) >> 8).toBe(0x14)
  })
})
