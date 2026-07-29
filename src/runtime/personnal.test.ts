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

  it('Create Aga writes eight colour banks, each behind a BPLCON3 select', () => {
    const rt = run(withBank(['Create Aga A']))
    const s = rt.personnal
    expect(s.aga).toBe(1)
    // bank 0 select, then 32 colours, then bank 1 select at +$2000
    expect(leek(rt, s.colorBase)).toBe(0x01060000)
    expect(leek(rt, s.colorBase + 4)).toBe(0x01800000)
    expect(leek(rt, s.colorBase + 132)).toBe(0x01062000)
    expect(leek(rt, s.colorBase + 136)).toBe(0x01800000)
    // eight banks of (1 + 32) moves
    expect(s.bplPtBase - s.colorBase).toBe(8 * 33 * 4 + 8)
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
