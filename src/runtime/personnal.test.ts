import { describe, expect, it } from 'vitest'
import { mustFinish } from '../testing/run'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { extensionById } from '../ext/registry'
// AUDIT: some of this library's keywords are called here with an argument
// list its own token table does not accept, so the Test pass is run for what
// it writes and not for what it refuses. See tokenizeUnchecked.
import { tokenizeUnchecked as tokenize } from '../tokens/source'
import { Runtime } from './runtime'
import { AmigaFS } from '../amiga/vfs'

const table = new TokenTable(CORE_TOKENS)
// Personnal is third-party, so no stock slot map binds it: the source puts
// it at 13 (ExtNb Equ 13-1) and 68 of its 69 demos agree. The 1.1a table is
// the superset, so it detokenises both versions' programs.
const exts = new Map([[13, extensionById('personnal-1.1')!.table]])

/**
 * The same table with every name folded to lower case.
 *
 * Personnal spells `Anim Unpack` with two capitals, and `MinD0`
 * (+Edit.s:14711) folds the INPUT and never the stored name, so nothing
 * anyone types can match it: routine 116 is code no AMOS line can reach.
 * Retyping the name is the only way to exercise what it does, and
 * src/tokens/roundtrip.ts calls the same rule `untypeable`.
 */
const typeable = new Map([
  [
    13,
    new TokenTable(
      extensionById('personnal-1.1')!.table.entries.map((e) => ({ ...e, name: e.name.toLowerCase() })),
      true,
    ),
  ],
])

/** a machine with a writable RAM:, as every real one has */
function withRam(): AmigaFS {
  const fs = new AmigaFS()
  fs.mountMemory('RAM')
  return fs
}

function run(src: string, fs?: AmigaFS): Runtime {
  const rt = new Runtime(tokenize(src, table, typeable), table, {
    extensions: exts,
    maxSteps: 2_000_000,
    ...(fs ? { fs } : {}),
  })
  const r = rt.runHeadless(500)
  mustFinish(r)
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

  it('Create Aga starts at eight planes where Create Standard starts at one', () => {
    // The two builders differ in more than the colour block, and the rest is
    // easy to miss because they are otherwise line-for-line the same:
    // BPLCON0 $0010 (BPU3) against $1000 (BPU=1), BPLCON2 $0224 (KILLEHB)
    // against $0024, BPLCON3 $1000 against $0c00 (:640 against :1065).
    const rt = run(withBank(['Create Aga A']))
    const s = rt.personnal
    expect(leek(rt, s.bplConBase)).toBe(0x01000010)
    expect(leek(rt, s.bplConBase + 4)).toBe(0x01020000)
    expect(leek(rt, s.bplConBase + 8)).toBe(0x01040224)
    expect(leek(rt, s.bplConBase + 12)).toBe(0x01061000)
    // and the tail: after WAIT $32 / DMACON on comes one more WAIT, for line
    // $31 — BEHIND the $32 just waited for (:647) — and the list ends without
    // the BPLCON3 = 0 Create Standard writes back "for AMOS" (:1077)
    expect(leek(rt, s.bplConBase + 16)).toBe(0x3203fffe)
    expect(leek(rt, s.bplConBase + 20)).toBe(0x00968300)
    expect(leek(rt, s.bplConBase + 24)).toBe(0x3103fffe)
    expect(s.currentLine).toBe(s.bplConBase + 28)
    expect(leek(rt, s.currentLine + 12)).toBe(0xfffffffe)
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
    // defaults. Active Copper owns that readback.
  })

  it('above six planes needs an Aga list; a Standard one ignores the ask', () => {
    const rt = run(withBank(['Create Standard A', 'Set View Planes 4', 'Set View Planes 7']))
    expect(leek(rt, rt.personnal.bplConBase) & 0x7010).toBe(0x4000) // still four
  })

  it('Mplot Planes refuses a bad count out loud (ErrMess 14)', () => {
    expect(run('Mplot Planes 8').personnal.mpP).toBe(8)
    expect(() => run('Mplot Planes 0')).toThrow(/Valeurs permises de 1 a 8 seulement/)
    expect(() => run('Mplot Planes 9')).toThrow(/Valeurs permises de 1 a 8 seulement/)
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
    // so this is the round trip screen.ts's planar mirror promises
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

describe('Personnal: the Mplot range is exclusive and related commands', () => {
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

  it('Mplot Save never writes the file it was given — Mplot Load reads one', () => {
    // Routine 97 loads the name pointer into a0 and then overwrites a0 with
    // the address of _MpBase, so its "name length" is the high word of that
    // pointer and the name is the pointer's own bytes. Both binaries do it
    // ($4b64 in 1.0b, $59e6 in 1.1); Aga Icon Save, which it is copied from,
    // uses a2 for the base and gets it right. So a save-then-load round trip
    // cannot work on a real machine either.
    const fs = withRam()
    expect(() =>
      run(
        ['Mplot Reserve 3', 'Mplot Define 1,11,22,3', 'Mplot Save "RAM:pts.mp"', 'Mplot Erase', 'Mplot Load "RAM:pts.mp"'].join('\n'),
        fs,
      ),
    ).toThrow(/Fichier d'un format inconnu/) // nothing was written, so the load fails
    expect(fs.readFile('RAM:pts.mp')).toBeNull()

    // and an unreserved bank is still error 11, which is the routine's own
    expect(() => run('Mplot Save "RAM:x.mp"', withRam())).toThrow(/Multi Plot bank non reservee/)

    // Mplot Load itself is fine, against a bank this port writes by hand
    const fs2 = withRam()
    const bytes = new Uint8Array(3 * 6 + 8)
    bytes.set([0x46, 0x2e, 0x43, 0x32, 0, 0, 0, 3])
    bytes[8] = 0
    bytes[9] = 11
    const rt = run(['Mplot Load "RAM:hand.mp"'].join('\n'), (fs2.writeFile('RAM:hand.mp', bytes), fs2))
    expect(rt.personnal.mplots).toBe(3)
    expect(leek(rt, rt.personnal.mpBase)).toBe(0x462e4332)
    expect(leek(rt, rt.personnal.mpBase + 8) >>> 16).toBe(11)
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

  it('Set Color() is dispatched to Set Ntsc, not to the palette reader', () => {
    // The token table's function field is 1 (both binaries), and routine 1 is
    // L1 falling through into L3 — `Move.w #$0000,$DFF1DC`. So the register
    // number is ignored, the answer is not a colour, and BEAMCON0 goes to 0.
    // L18, the reader the author meant, is unreachable.
    let out = ''
    const src = [...bank, 'Create Standard A', 'Set Pal', 'Set Color 3,15,8,1', 'Print Set Color(3);Set Color(99)'].join('\n')
    const rt = new Runtime(tokenize(src, table, exts), table, { extensions: exts, maxSteps: 500_000, onText: (t) => (out += t) })
    rt.runHeadless(200)
    expect(out).toBe(' 0 0\n')
    expect(rt.beamcon0).toBe(0x0000) // Set Pal undone by reading a "colour"
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

  it('a count of zero still moves one entry — the loops are do-whiles', () => {
    // Every "n entries" keyword in this group subtracts one BEFORE the loop
    // and ends on Bpl, so n=0 leaves the counter at -1 and the body has
    // already run: Change Palette :2928, the two Palette To Copper forms
    // :2957, Fade Palette :3045, Attribute Palette :3087, Iff8bits To
    // Iff4bits :3120. A count of zero is one entry, not none.
    const rt = run(
      [
        ...bank,
        'Reserve As Work 11,64 : B=Start(11)',
        'Doke B,$ABC',
        'Poke B+8,$30 : Poke B+9,$40 : Poke B+10,$50',
        'Create Standard A',
        'Change Palette 0,B',
        'Iff8bits To Iff4bits B+8,0 To B+16',
      ].join('\n'),
    )
    expect(getWord(rt, rt.personnal.colorBase + 2)).toBe(0xabc)

    let out = ''
    const src = [
      ...bank,
      'Reserve As Work 11,64 : B=Start(11)',
      'Poke B+8,$30 : Poke B+9,$40 : Poke B+10,$50',
      'Iff8bits To Iff4bits B+8,0 To B+16',
      'Print Peek(B+16);Peek(B+17);Peek(B+18)',
    ].join('\n')
    const rt2 = new Runtime(tokenize(src, table, exts), table, { extensions: exts, maxSteps: 500_000, onText: (t) => (out += t) })
    rt2.runHeadless(200)
    expect(out).toBe(' 3 4 5\n') // one RGB triple converted, where a count of zero reads as none
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

describe('Personnal: HAM, EHB and collision control (L8/L9/L38/L40/L41/L44-46)', () => {
  const bank = ['Reserve As Work 10,24000', 'A=Start(10)', 'Create Standard A']

  it('Ham and Ehb are named constants, not tests', () => {
    let out = ''
    const rt = new Runtime(tokenize('Print Ham;Ehb', table, exts), table, {
      extensions: exts,
      maxSteps: 200_000,
      onText: (t) => (out += t),
    })
    rt.runHeadless(100)
    expect(out).toBe(' 4096 64\n') // the Screen Open mode flags
  })

  it('Ham Mode is BPLCON0 bit 11, and the list interpreter acts on it', () => {
    const on = run([...bank, 'Ham Mode 1'].join('\n'))
    expect(getWord(on, on.personnal.bplConBase + 2) & 0x0800).toBe(0x0800)
    const off = run([...bank, 'Ham Mode 1', 'Ham Mode 0'].join('\n'))
    expect(getWord(off, off.personnal.bplConBase + 2) & 0x0800).toBe(0)
  })

  it('Allow Plane Col records the plane but always writes CLXCON bit 0', () => {
    // Bset d0,d1 on a DATA register takes its bit number modulo 32, and the
    // routine shifts the plane left six first — so n*64 is bit 0 for every n
    // in range. The mask gets the right bit; CLXCON does not. Library bug,
    // kept, tested so it reads as deliberate.
    const rt = run([...bank, 'Allow Plane Col 3'].join('\n'))
    expect(rt.personnal.bplanesMask).toBe(1 << 3)
    expect(getWord(rt, rt.personnal.others + 26) & 1).toBe(1)
    const other = run([...bank, 'Allow Plane Col 5'].join('\n'))
    expect(other.personnal.bplanesMask).toBe(1 << 5)
    expect(getWord(other, other.personnal.others + 26) & 1).toBe(1) // the same bit
  })

  it('Forbid Plane Col undoes both halves, and the range is 1..6', () => {
    const rt = run([...bank, 'Allow Plane Col 2', 'Forbid Plane Col 2'].join('\n'))
    expect(rt.personnal.bplanesMask).toBe(0)
    expect(getWord(rt, rt.personnal.others + 26) & 1).toBe(0)
    const out = run([...bank, 'Allow Plane Col 7', 'Allow Plane Col 0'].join('\n'))
    expect(out.personnal.bplanesMask).toBe(0) // both ignored in silence
  })

  it('the collision readers answer from a CLXDAT we do not have', () => {
    // Both end the same way: -1 when the CLXDAT bit is CLEAR, which is the
    // opposite of what their names suggest and is kept as found. There is no
    // collision hardware here, so CLXDAT reads 0 and they both say -1.
    let out = ''
    const rt = new Runtime(tokenize('Print Playfields Col;Pf Sprites Col(1,0)', table, exts), table, {
      extensions: exts,
      maxSteps: 200_000,
      onText: (t) => (out += t),
    })
    rt.runHeadless(100)
    expect(out).toBe('-1-1\n')
  })

  it('Sprite Col stays core\'s, because this table is keyed by name', () => {
    // Personnal has its own Sprite Col(s1,s2). Core has one too
    // (the core's `sprite col` in instr.ts) with different arguments, and an extension handler
    // spread after it silently replaces it — which broke two core sprite
    // tests and cost the census two programs when it was first added. Core
    // wins; the deviation is recorded rather than the collision repeated.
    let out = ''
    const rt = new Runtime(tokenize('Print Sprite Col(0)', table, exts), table, {
      extensions: exts,
      maxSteps: 200_000,
      onText: (t) => (out += t),
    })
    rt.runHeadless(100)
    expect(out).toBe(' 0\n') // core's arity, core's answer
  })
})

describe('Personnal: the five mosaics (L32-L36, :1316/:1373/:1444/:1517/:1591)', () => {
  /** the logical screen the mosaics work on, read back through the mirror */
  const px = (rt: Runtime, x: number, y: number): number => rt.screens.get(0)!.point(x, y)

  /** a 320x64 four-colour screen, some pixels lit, then one mosaic over it */
  const shot = (plots: string[], call: string): Runtime =>
    run(['Screen Open 0,320,64,4,Lowres', 'Cls 0', 'Ink 1', ...plots, 'B=Screen Base', call].join('\n'))

  it('X2 gives every pair of pixels the value of its left-hand one', () => {
    // mask $AAAAAAAA keeps pixel 0 of each pair — bit 31 is the leftmost
    // pixel of a longword — and Lsr/Or smears it one place right
    const rt = shot(['Plot 0,0', 'Plot 2,0', 'Plot 5,0'], 'Mosaic X2 B')
    expect([0, 1, 2, 3, 4, 5].map((x) => px(rt, x, 0))).toEqual([1, 1, 1, 1, 0, 0])
  })

  it('X2 gives every pair of rows the content of its upper one', () => {
    const rt = shot(['Plot 0,0', 'Plot 8,1', 'Plot 0,2'], 'Mosaic X2 B')
    // row 1 is overwritten by row 0, so the pixel plotted on it is gone
    expect([px(rt, 0, 0), px(rt, 0, 1)]).toEqual([1, 1])
    expect([px(rt, 8, 0), px(rt, 8, 1)]).toEqual([0, 0])
    expect([px(rt, 0, 2), px(rt, 0, 3)]).toEqual([1, 1])
  })

  it('the scale is the group width and the block height together', () => {
    for (const [n, call] of [
      [4, 'Mosaic X4 B'],
      [8, 'Mosaic X8 B'],
      [16, 'Mosaic X16 B'],
      [32, 'Mosaic X32 B'],
    ] as Array<[number, string]>) {
      const rt = shot(['Plot 0,0'], call)
      expect([px(rt, n - 1, 0), px(rt, n, 0)]).toEqual([1, 0])
      expect([px(rt, 0, n - 1), px(rt, 0, n)]).toEqual([1, 0])
    }
  })

  it('X32 takes a whole longword from its leftmost pixel', () => {
    // pixel 32 is bit 31 of the second longword, so it fills 32..63 and
    // leaves 0..31 to be filled from pixel 0, which is clear
    const rt = shot(['Plot 32,0'], 'Mosaic X32 B')
    expect([px(rt, 0, 0), px(rt, 31, 0), px(rt, 32, 0), px(rt, 63, 0)]).toEqual([0, 0, 1, 1])
  })

  it('every plane is smeared, so the colour survives', () => {
    const rt = run(
      ['Screen Open 0,320,64,4,Lowres', 'Cls 0', 'Ink 3', 'Plot 0,0', 'B=Screen Base', 'Mosaic X4 B'].join('\n'),
    )
    expect([px(rt, 0, 0), px(rt, 3, 0), px(rt, 3, 3)]).toEqual([3, 3, 3])
  })

  it('the last block is the last whole one — a height of 64 is two X32 blocks', () => {
    const rt = shot(['Plot 0,32'], 'Mosaic X32 B')
    expect([px(rt, 0, 31), px(rt, 0, 32), px(rt, 0, 63)]).toEqual([0, 1, 1])
  })

  it('it works on the LOGICAL screen, which is why the demos follow with Screen Copy', () => {
    // _MosaicPlanes is filled from EcLogic, the first six longwords of the
    // control block — so under Double Buffer the mosaic lands on the back
    // buffer and Simple_Mosaique.AMOS has to copy it forward itself.
    const rt = run(
      ['Screen Open 0,320,64,4,Lowres', 'Double Buffer', 'Cls 0', 'Ink 1', 'Plot 0,0', 'B=Screen Base', 'Mosaic X4 B'].join(
        '\n',
      ),
    )
    const s = rt.screens.get(0)!
    expect([s.point(0, 0), s.point(3, 0), s.point(3, 3), s.point(4, 0)]).toEqual([1, 1, 1, 0])
  })

  it('a zero plane pointer abandons the whole keyword, not just that plane', () => {
    // _m2's `Cmp.l #0,a1 / Beq _mend` leaves everything after the gap alone.
    // Built by hand rather than from a screen, because a screen's control
    // block only ever zeroes the tail of the list.
    const rt = run(
      [
        'Reserve As Work 10,24000',
        'A=Start(10)',
        'Loke A,A+256 : Loke A+4,0 : Loke A+8,A+512',
        'Doke A+76,32 : Doke A+78,4',
        'Loke A+256,$80000000 : Loke A+512,$80000000',
        'Mosaic X2 A',
      ].join('\n'),
    )
    const a = rt.bankBase(10) // = Start(10)
    expect(leek(rt, a + 256)).toBe(0xc0000000) // plane 0 smeared
    expect(leek(rt, a + 512)).toBe(0x80000000) // plane 2 never reached
  })

  it('a screen too small for one block does nothing, where the 68k runs away', () => {
    // Two guards the original lacks: the row loop is a do-while against a
    // height rounded down to a multiple of n, so a height under n never
    // matches and walks memory forever; and the column loop steps four bytes
    // against an end marker at width/8, so an odd byte width steps past it.
    const narrow = run(
      [
        'Reserve As Work 10,24000',
        'A=Start(10)',
        'Loke A,A+256',
        'Doke A+76,16 : Doke A+78,4', // 2 bytes a row: no whole longword
        'Loke A+256,$80000000',
        'Mosaic X2 A',
      ].join('\n'),
    )
    expect(leek(narrow, narrow.bankBase(10) + 256)).toBe(0x80000000)
    const short = run(
      [
        'Reserve As Work 10,24000',
        'A=Start(10)',
        'Loke A,A+256',
        'Doke A+76,32 : Doke A+78,1', // one row, and X2 wants two
        'Loke A+256,$80000000',
        'Mosaic X2 A',
      ].join('\n'),
    )
    expect(leek(short, short.bankBase(10) + 256)).toBe(0x80000000)
  })
})

describe('Personnal: Sprite Col resolves by slot, not by name', () => {
  it("a Personnal program gets Personnal's answer, a core program gets core's", () => {
    // Core owns the plain name and asks a different question of different
    // arguments: `Sprite Col(n[,first[,last]])` really checks sprite n
    // against a range and answers with a colliding sprite number. Personnal's
    // `Sprite Col(s1,s2)` maps the PAIR onto one CLXDAT bit and answers -1
    // when it is clear — always, since nothing writes CLXDAT here.
    //
    // Both now coexist, as they do on the machine: the token carries its slot
    // and the dispatch tries `ext13:sprite col` before the bare name.
    // Typed text cannot express the difference: `Sprite Col` matches core's
    // name and the text tokeniser takes it. A SAVED program records whichever
    // token the editor chose, and a program written with Personnal loaded
    // holds ext13:$0304 — so that is what this builds, as parseSource would
    // read out of the file.
    const lines = tokenize('Print Sprite Col(0,1)', table, exts)
    for (const line of lines) {
      for (let i = 0; i < line.tokens.length; i++) {
        const t = line.tokens[i]!
        if (t.kind !== 'core') continue
        if (table.name(t.id)?.trim().toLowerCase() === 'sprite col') {
          line.tokens[i] = { kind: 'ext', ext: 13, id: 0x0304, nparams: 2 }
        }
      }
    }
    let out = ''
    const rt = new Runtime(lines, table, { extensions: exts, maxSteps: 200_000, onText: (t) => (out += t) })
    rt.runHeadless(100)
    expect(out).toBe('-1\n') // Personnal's, through slot 13

    // the same source with no extension bound is core's keyword, unchanged
    let core = ''
    const plain = new Runtime(tokenize('Print Sprite Col(0)', table), table, {
      maxSteps: 200_000,
      onText: (t) => (core += t),
    })
    plain.runHeadless(100)
    expect(core).toBe(' 0\n')
  })
})

describe('Personnal: the six the other blocks never reach', () => {
  // every keyword promoted to FAITHFUL has to be dispatched by the suite or
  // the coverage gate fails the run; these are the ones the behavioural
  // tests above happen not to touch
  const bank = ['Reserve As Work 10,24000', 'A=Start(10)', 'Create Standard A']

  it('Vb Line Wait yields rather than spinning on a beam we do not have', () => {
    expect(() => run([...bank, 'Vb Line Wait 100'].join('\n'))).not.toThrow()
  })

  it('Iff Convert gives up in silence when a chunk is missing', () => {
    // no BMHD anywhere in the bank, so it returns rather than raising -- only
    // the three header readers raise error 3
    expect(() => run([...bank, 'Iff Convert A+8192'].join('\n'))).not.toThrow()
  })

  it('Get Odd Sprite cuts planes 2 and 3 where Get Even cuts 0 and 1', () => {
    const rt = run(
      [
        'Screen Open 0,320,64,16,Lowres',
        'Cls 0 : Ink 12 : Bar 0,0 To 15,15', // 12 = planes 2 and 3
        ...bank,
        'F Set Sprite Buffer A+16384,8192',
        'B=Screen Base',
        'Get Odd Sprite B,0,0,0 To 8',
      ].join('\n'),
    )
    // the same clobber as Get Even: the header lands on _SpriteBase and the
    // first plane-2 longword on _SpriteLength
    expect(rt.personnal.spriteBase).toBe(8 << 8)
    expect(rt.personnal.spriteLength).toBe(0xffff0000)
  })

  it('P61 Mpos, Omd Stop and Omd Free complete their state machine', () => {
    // Mpos is routine 126 twice over: the 0..63 check AND the module check,
    // neither of which this port had. Stop and Free raise nothing of their
    // own — with no module they return, where error 25 was raised here.
    expect(() => run([...bank, 'P61 Mpos 4'].join('\n'))).toThrow(/ne joue pas de module/)
    expect(() => run([...bank, 'P61 Play A', 'P61 Mpos 4'].join('\n'))).not.toThrow()
    expect(() => run([...bank, 'Omd Stop'].join('\n'))).not.toThrow()
    expect(() => run([...bank, 'Omd Free'].join('\n'))).not.toThrow()
  })
})

describe('Personnal: the cruncher, nibble peeks and replayers', () => {
  const bank = ['Reserve As Work 10,24000', 'A=Start(10)', 'Create Standard A']

  it('Fpeek and Speek are the two nibbles of a byte', () => {
    let out = ''
    const rt = new Runtime(
      tokenize(['Reserve As Work 10,64', 'A=Start(10)', 'Poke A,$C7', 'F=Fpeek(A) : S=Speek(A)', 'Print F;S'].join('\n'), table, exts),
      table,
      { extensions: exts, maxSteps: 200_000, onText: (t) => (out += t) },
    )
    rt.runHeadless(100)
    expect(out).toBe(' 12 7\n')
  })

  it('Set Deform Value holds sixteen slots and nothing reads them', () => {
    const rt = run([...bank, 'Set Deform Value 1,111', 'Set Deform Value 16,222'].join('\n'))
    expect([rt.personnal.deform[0], rt.personnal.deform[15]]).toEqual([111, 222])
    for (const n of [0, 17]) {
      expect(() => run([...bank, `Set Deform Value ${n},1`].join('\n'))).toThrow(/1 a 16 seulement/)
    }
  })

  it('Pic Pack and Pic Unpack round-trip a screen through the plane list', () => {
    const rt = run(
      [
        'Screen Open 0,320,64,4,Lowres',
        'Cls 0 : Ink 1 : Bar 0,0 To 63,31 : Plot 200,40',
        ...bank,
        'B=Screen Base',
        'For P=1 To 8 : Set Plane P,Leek(B+(P-1)*4) : Next P',
        'L=Pic Pack(B To A+8192)',
        'Cls 0',
        'Pic Unpack A+8192 To B',
      ].join('\n'),
    )
    const s = rt.screens.get(0)!
    // the Cls between them means only the unpack can have put these back
    expect([s.point(0, 0), s.point(63, 31), s.point(64, 0), s.point(200, 40)]).toEqual([1, 1, 0, 1])
    // and it compressed: a 320x64x2 screen is 5120 bytes of plane
    expect(leek(rt, rt.bankBase(10) + 8192 + 4)).toBeLessThan(5120)
    expect(leek(rt, rt.bankBase(10) + 8192 + 8)).toBe(2560) // bytes in one plane
    // the cookie routine 114 stamps last, at $6412 — Pic Unpack never checks
    // it, but the block carries it
    expect(leek(rt, rt.bankBase(10) + 8192)).toBe(0x462e4333) // "F.C3"
  })

  it('Anim Unpack indexes a frame table in front of the same format', () => {
    const rt = run(
      [
        'Screen Open 0,320,64,4,Lowres',
        'Cls 0 : Ink 1 : Bar 0,0 To 31,31',
        ...bank,
        'B=Screen Base',
        'For P=1 To 8 : Set Plane P,Leek(B+(P-1)*4) : Next P',
        'L=Pic Pack(B To A+8192)',
        // a one-entry frame table at +8, holding the offset FROM THE BANK
        'Loke A+4096+8,16',
        'For I=0 To L-1 : Poke A+4096+16+I,Peek(A+8192+I) : Next I',
        'Cls 0',
        'Anim Unpack A+4096,0 To B',
      ].join('\n'),
    )
    const s = rt.screens.get(0)!
    expect([s.point(0, 0), s.point(31, 31), s.point(32, 0)]).toEqual([1, 1, 0])
  })

  it('the replayers keep their state machine even though nothing sounds', () => {
    // P61 and OMD are LVO calls into player61.library and octaplayer.library,
    // neither of which is in the AMOS source. The checks the extension makes
    // BEFORE calling them are its own, and those are reproduced.
    expect(() => run([...bank, 'P61 Stop'].join('\n'))).toThrow(/ne joue pas de module/)
    expect(() => run([...bank, 'P61 Play A', 'P61 Stop'].join('\n'))).not.toThrow()
    expect(() => run([...bank, 'P61 Mvolume 64'].join('\n'))).toThrow(/volume vont de 0 a 63/)
    // the range is checked before the module is, and both Mvolume and Mpos
    // check both — routines 126 and 127 are the same code twice, down to
    // reusing the volume message for the position range
    expect(() => run([...bank, 'P61 Mvolume 63'].join('\n'))).toThrow(/ne joue pas de module/)
    expect(() => run([...bank, 'P61 Mpos 64'].join('\n'))).toThrow(/volume vont de 0 a 63/)
    expect(() => run([...bank, 'P61 Play A', 'P61 Mvolume 63', 'P61 Mpos 8'].join('\n'))).not.toThrow()
    expect(() => run([...bank, 'Omd Play'].join('\n'))).toThrow(/Aucun module MMDx/)
    expect(() => run([...bank, 'Omd Load "RAM:nope.med"'].join('\n'), withRam())).toThrow(/Impossible de charger/)
    // Omd Stop and Omd Free raise nothing of their own: with no module they
    // simply return (routines 130 and 131, $69e8 and $6a30)
    expect(() => run([...bank, 'Omd Stop', 'Omd Free'].join('\n'))).not.toThrow()
  })
})

describe('Personnal: trig, IFF headers and input reads', () => {
  const bank = ['Reserve As Work 10,24000', 'A=Start(10)']

  /** print a list of integer expressions without drawing between reads */
  const printed = (exprs: string[]): string => {
    let out = ''
    const src = exprs.map((e, i) => `V${i}=${e}`).join('\n') + '\nPrint ' + exprs.map((_, i) => `V${i}`).join(';')
    const rt = new Runtime(tokenize(src, table, exts), table, { extensions: exts, maxSteps: 200_000, onText: (t) => (out += t) })
    rt.runHeadless(100)
    return out
  }

  it('Fc Cos/Sin/Tan are the tables, not the formula', () => {
    expect(printed(['Fc Cos(0)', 'Fc Cos(45)', 'Fc Cos(90)', 'Fc Cos(180)'])).toBe(' 1000 707 0-1000\n')
    expect(printed(['Fc Sin(90)', 'Fc Sin(270)'])).toBe(' 1000-1000\n')
    // both tan poles are $7FFFFFFF, positive in each direction
    expect(printed(['Fc Tan(90)', 'Fc Tan(270)'])).toBe(' 2147483647 2147483647\n')
    // and the ten entries that Math.trunc(fn*1000) would get wrong
    expect(printed(['Fc Sin(150)', 'Fc Cos(300)', 'Fc Tan(45)'])).toBe(' 500 499 999\n')
  })

  it('angles above 359 wrap; negative ones fall off the table', () => {
    expect(printed(['Fc Cos(360)', 'Fc Cos(405)', 'Fc Cos(725)'])).toBe(' 1000 707 996\n') // 725 mod 360 = 5
    // the Divu that normalises is unsigned, so a negative angle overflows it
    // and indexes far outside the table. Zero is this port's stand-in for
    // whatever memory follows it on the Amiga.
    expect(printed(['Fc Cos(-30)', 'Fc Sin(-90)'])).toBe(' 0 0\n')
  })

  it('the IFF header readers find BMHD and pull one field each', () => {
    // BMHD tag, length, then w,h,x,y,planes — the scan steps two bytes at a
    // time from the address it is given, so a tag anywhere word-aligned works
    const src = [
      ...bank,
      'Loke A,0 : Loke A+4,0',
      'Loke A+8,$424D4844', // "BMHD"
      'Loke A+12,20',
      'Doke A+16,320 : Doke A+18,200', // w,h
      'Doke A+20,0 : Doke A+22,0', // x,y
      'Poke A+24,5', // planes
    ]
    let out = ''
    const rt = new Runtime(
      tokenize([...src, 'X=Iff X Size(A) : Y=Iff Y Size(A) : D=Iff Planes(A)', 'Print X;Y;D'].join('\n'), table, exts),
      table,
      { extensions: exts, maxSteps: 200_000, onText: (t) => (out += t) },
    )
    rt.runHeadless(100)
    expect(out).toBe(' 320 200 5\n')
  })

  it('no BMHD is error 3', () => {
    expect(() => run([...bank, 'X=Iff X Size(A)'].join('\n'))).toThrow(/BMHD non trouve/)
  })

  it('Iff8bits To Iff4bits shifts every RGB byte down four', () => {
    const rt = run([...bank, 'Loke A,$F0A05000 : Loke A+4,$00000000', 'Iff8bits To Iff4bits A,2 To A+8'].join('\n'))
    const at = rt.bankBase(10)
    // two triples: F0 A0 50 -> F A 5, then 00 00 00 -> 0 0 0
    expect(leek(rt, at + 8) >>> 8).toBe(0x0f0a05)
  })

  it('Test returns the Mplot plane count, and the fire buttons read idle', () => {
    expect(printed(['Test'])).toBe(' 8\n') // _MpP defaults to 8
    expect(printed(['Fire(1,2)', 'Fire(1,3)'])).toBe(' 0 0\n')
  })

  it("Right Click stays TURBO's, because that table is keyed by name too", () => {
    // Personnal's reads POTGOR bit 10 (DATLY, port 0 pin 9) and answers -1
    // when clear; TURBO's reads the same button through the same abstraction
    // here. Same name, same arity, same answer -- so the existing one stands
    // rather than being replaced. See the Sprite Col note.
    expect(printed(['Right Click'])).toBe(' 0\n')
  })
})

describe('Personnal: the AGA icon bank (L87-L93, :3369-:3598)', () => {
  const bank = ['Reserve As Work 10,24000', 'A=Start(10)', 'Create Standard A']

  /** a 320x64 screen whose eight plane slots all point at real memory */
  const withPlanes = (body: string[]): string[] => [
    'Screen Open 0,320,64,32,Lowres',
    'Cls 0',
    ...bank,
    'B=Screen Base',
    'For P=1 To 8 : Set Plane P,Leek(B+(P-1)*4) : Next P',
    ...body,
  ]

  it('Aga Reserve Icon stamps F.C1 and the count, and refuses to do it twice', () => {
    const rt = run([...bank, 'Aga Reserve Icon 4'].join('\n'))
    const s = rt.personnal
    expect(s.icons).toBe(4)
    expect(s.icBase).toBe(0x74000000)
    expect(leek(rt, s.icBase)).toBe(0x462e4331) // "F.C1"
    expect(leek(rt, s.icBase + 4)).toBe(4)
    expect(rt.personnalIcons!.length).toBe(4 * 260 + 8) // 260 is the slot stride
    expect(() => run([...bank, 'Aga Reserve Icon 4', 'Aga Reserve Icon 2'].join('\n'))).toThrow(
      /Aga Icon bank deja reservee/,
    )
  })

  it('Aga Icon Base reads the bank address back, and Aga Erase Icon drops it', () => {
    const rt = run([...bank, 'Aga Reserve Icon 2', 'C=Aga Icon Base', 'Aga Erase Icon', 'D=Aga Icon Base'].join('\n'))
    expect(rt.personnal.icBase).toBe(0)
    expect(rt.personnalIcons).toBe(null)
    // erasing nothing is silent, not an error
    expect(() => run([...bank, 'Aga Erase Icon'].join('\n'))).not.toThrow()
  })

  it('Get then Paste moves a 16x16 block, eight planes at 260 bytes a slot', () => {
    const rt = run(
      withPlanes([
        'Aga Reserve Icon 2',
        'Ink 5 : Bar 0,0 To 15,15',
        'Aga Get Icon 1,0,0',
        'Aga Paste Icon 1,64,32',
      ]).join('\n'),
    )
    const s = rt.screens.get(0)!
    expect([s.point(64, 32), s.point(79, 47), s.point(80, 32), s.point(64, 48)]).toEqual([5, 5, 0, 0])
    // it went through the bank, not straight across: slot 1 holds the plane 0
    // words, sixteen of them, before plane 1's start
    expect(getWord(rt, rt.personnal.icBase + 8)).toBe(0xffff)
  })

  it('an icon number outside 1..IconMax is ignored in silence', () => {
    for (const n of [0, 3]) {
      const rt = run(withPlanes(['Aga Reserve Icon 2', 'Ink 5 : Bar 0,0 To 15,15', `Aga Get Icon ${n},0,0`]).join('\n'))
      expect(leek(rt, rt.personnal.icBase + 8)).toBe(0) // nothing was written
    }
  })

  it('using the bank before reserving it is error 9', () => {
    expect(() => run(withPlanes(['Aga Get Icon 1,0,0']).join('\n'))).not.toThrow() // icons==0 fails the range test first
    expect(() => run([...bank, 'Aga Icon Save "RAM:x.icn"'].join('\n'))).toThrow(/Aga Icon bank non reservee/)
  })

  it('Save writes the whole bank and Load reads it back', () => {
    const rt = run(
      withPlanes([
        'Aga Reserve Icon 2',
        'Ink 5 : Bar 0,0 To 15,15',
        'Aga Get Icon 1,0,0',
        'Aga Icon Save "RAM:icons.dat"',
        'Aga Erase Icon',
        'Aga Icon Load "RAM:icons.dat"',
        'Cls 0',
        'Aga Paste Icon 1,32,16',
      ]).join('\n'),
      withRam(),
    )
    expect(rt.personnal.icons).toBe(2)
    const s = rt.screens.get(0)!
    expect([s.point(32, 16), s.point(47, 31), s.point(48, 16)]).toEqual([5, 5, 0])
  })

  it('a file that is not an icon bank is error 10, and it discards the live bank', () => {
    const fs = withRam()
    expect(() =>
      run(
        [...bank, 'Open Out 1,"RAM:junk.dat"', 'Print #1,"nope"', 'Close 1', 'Aga Reserve Icon 2', 'Aga Icon Load "RAM:junk.dat"'].join(
          '\n',
        ),
        fs,
      ),
    ).toThrow(/format inconnu/)
  })
})

describe('Personnal: the two 1.1-only keywords (routines 120 and 122)', () => {
  const bank = ['Reserve As Work 10,24000', 'A=Start(10)', 'Create Standard A']

  it('Mplot Start Plane moves where Mplot Draw begins, and IGNORES a bad plane', () => {
    const rt = run([...bank, 'Mplot Start Plane 3'].join('\n'))
    expect(rt.personnal.mpStartPlane).toBe(3)
    // routine 120's two range branches both target $6668, which IS the rts —
    // out of 1..8 is a silent no-op, not error 14. Mplot Planes raises 14 for
    // the same range, which is presumably where the error came from here.
    for (const n of [0, 9]) {
      const r = run([...bank, 'Mplot Start Plane 3', `Mplot Start Plane ${n}`].join('\n'))
      expect(r.personnal.mpStartPlane).toBe(3) // unchanged, and nothing raised
    }
  })

  it('it defaults to 1 here, where the shipped 1.1 leaves it at 0', () => {
    // The 1.1 build reads (_MpStartPlane-1)*4 off _BitsPlanes at $5bfc, and
    // only two instructions in the library touch the variable: that read and
    // the keyword's write. Nothing initialises it and its declared default is
    // 0, so a plain Mplot Draw indexes _BitsPlanes[-1] -- the longword at the
    // base of the data bank, which is the ASCII "Fred". No shipped demo calls
    // the keyword, so all of them take that path on 1.1.
    //
    // One handler serves both versions here and 1.0b, which every demo is
    // written against, always starts at plane 0. So this defaults to 1.
    expect(run(bank.join('\n')).personnal.mpStartPlane).toBe(1)
  })

  it('Full View appends the past-line-255 tail, and leaves _CurrentLine alone', () => {
    const rt = run([...bank, 'Copper Wait Line 100', 'Full View'].join('\n'))
    const at = rt.personnal.currentLine
    expect([0, 1, 2, 3, 4].map((i) => leek(rt, at + i * 4))).toEqual([
      0xffbcfffe, 0x0003fffe, 0x3103fffe, 0x00960100, 0xfffffffe,
    ])
    // every other appending keyword steps _CurrentLine past what it wrote;
    // this one does not, so the next Copper Wait Line lands back on top of it
    const before = run([...bank, 'Copper Wait Line 100'].join('\n'))
    expect(at).toBe(before.personnal.currentLine)
  })

  it('Full View without a list is error 1', () => {
    expect(() => run('Full View')).toThrow(/Copper list non reservee/)
  })
})

describe('Personnal: the mask blits (L53/L54/L59/L60) and the two whole-screen blits', () => {
  const px = (rt: Runtime, n: number, x: number, y: number): number => rt.screens.get(n)!.point(x, y)

  /** four 320-wide screens: 0 all ink 1, 1 empty, 2 a 16-wide mask, 3 empty */
  const stage = (h: number, body: string[]): Runtime =>
    run(
      [
        `Screen Open 0,320,${h},4,Lowres`,
        'Cls 0 : Ink 1 : Bar 0,0 To 319,' + (h - 1),
        `Screen Open 1,320,${h},4,Lowres`,
        'Cls 0',
        `Screen Open 2,320,${h},4,Lowres`,
        'Cls 0 : Ink 1 : Bar 0,0 To 15,' + (h - 1),
        `Screen Open 3,320,${h},4,Lowres`,
        'Cls 0',
        'Screen 0 : A0=Screen Base',
        'Screen 1 : A1=Screen Base',
        'Screen 2 : A2=Screen Base',
        'Screen 3 : A3=Screen Base',
        ...body,
      ].join('\n'),
    )

  it('Double Mask writes (mask AND s1) OR (NOT mask AND s2) back over s2', () => {
    // plane 0 of the MASK screen alone, against every plane of the other two
    const rt = stage(32, ['Double Mask A2 To A0,A1'])
    expect([px(rt, 1, 0, 0), px(rt, 1, 15, 0), px(rt, 1, 16, 0)]).toEqual([1, 1, 0])
    expect(px(rt, 1, 0, 31)).toBe(1) // the whole screen, not just the first row
    expect(px(rt, 0, 16, 0)).toBe(1) // s1 is read, never written
  })

  it('Blit Mask uses minterm $98, which is not the mask-select you would expect', () => {
    // $98 is (B AND C) OR (A AND NOT B AND NOT C), so with A all ones and C
    // empty the target lights up where the mask is CLEAR. A mask-select
    // ($E2, B ? A : C) would have lit it where the mask is set.
    const rt = stage(32, ['Blit Mask A0,A2,A1 To A3'])
    expect([px(rt, 3, 0, 0), px(rt, 3, 15, 0), px(rt, 3, 16, 0), px(rt, 3, 319, 31)]).toEqual([0, 0, 1, 1])
  })

  it('L Double Mask takes yEnd-yStart rows and L Blit Mask takes yEnd of them', () => {
    // Both are handed 16,32 on a 64-row screen. The CPU form subtracts and
    // covers rows 16..31; the blitter form does not and covers 16..47. The
    // demos pass the same numbers to both, so the divergence is real code,
    // not a reading of it.
    const cpu = stage(64, ['L Double Mask A2,16,32 To A0,A1'])
    expect([px(cpu, 1, 0, 15), px(cpu, 1, 0, 16), px(cpu, 1, 0, 31), px(cpu, 1, 0, 32)]).toEqual([0, 1, 1, 0])
    const blt = stage(64, ['L Blit Mask A0,A2,A1 To A3,16,32'])
    expect([px(blt, 3, 16, 15), px(blt, 3, 16, 16), px(blt, 3, 16, 47), px(blt, 3, 16, 48)]).toEqual([0, 1, 1, 0])
  })

  it('a null screen base is error 4 for all four of them', () => {
    for (const call of [
      'Double Mask 0 To 1,1',
      'L Double Mask 0,0,1 To 1,1',
      'Blit Mask 1,1,1 To 0',
      'L Blit Mask 1,1,0 To 1,0,1',
      'Blitter Copy 0 To 1',
    ]) {
      expect(() => run(call)).toThrow(/bases ecran INVALIDE/)
    }
  })

  it('Blitter Clear zeroes every plane of the screen it is given', () => {
    const rt = run(
      ['Screen Open 0,320,64,16,Lowres', 'Cls 0 : Ink 5 : Bar 0,0 To 319,63', 'B=Screen Base', 'Blitter Clear B'].join(
        '\n',
      ),
    )
    expect([px(rt, 0, 0, 0), px(rt, 0, 319, 63), px(rt, 0, 160, 32)]).toEqual([0, 0, 0])
  })

  it('Blitter Copy moves the planes across, sized from the source', () => {
    const rt = run(
      [
        'Screen Open 0,320,64,16,Lowres',
        'Cls 0 : Ink 5 : Bar 0,0 To 15,15',
        'Screen Open 1,320,64,16,Lowres',
        'Cls 0',
        'Screen 0 : A0=Screen Base',
        'Screen 1 : A1=Screen Base',
        'Blitter Copy A0 To A1',
      ].join('\n'),
    )
    expect([px(rt, 1, 0, 0), px(rt, 1, 15, 15), px(rt, 1, 16, 0)]).toEqual([5, 5, 0])
  })
})

describe('Personnal: the S32 expansions (L83/L84, :3237/:3281)', () => {
  const px = (rt: Runtime, x: number, y: number): number => rt.screens.get(0)!.point(x, y)

  /** one pixel on row 0 and one on row 33, then one of the two expansions */
  const shot = (call: string): Runtime =>
    run(['Screen Open 0,320,64,4,Lowres', 'Cls 0', 'Ink 1', 'Plot 0,0', 'Plot 0,33', 'B=Screen Base', call].join('\n'))

  it('both stretch a row leftmost longword across the whole row', () => {
    for (const call of ['S32 Block To Screen B', 'S32 Vertice To Screen B']) {
      const rt = shot(call)
      expect([px(rt, 0, 0), px(rt, 32, 0), px(rt, 288, 0), px(rt, 1, 0)]).toEqual([1, 1, 1, 0])
    }
  })

  it('Block tiles the top 32 rows down the screen; Vertice keeps every row its own', () => {
    // Block resets the source to the plane base each 32-row band, so output
    // row 32 comes from source row 0 and the pixel that was on row 33 is
    // overwritten from the empty source row 1. Vertice never resets.
    const block = shot('S32 Block To Screen B')
    expect([px(block, 0, 32), px(block, 0, 33)]).toEqual([1, 0])
    const vertice = shot('S32 Vertice To Screen B')
    expect([px(vertice, 0, 32), px(vertice, 0, 33), px(vertice, 32, 33)]).toEqual([0, 1, 1])
  })
})

describe('Personnal: the memory utilities (L62/L63/L64/L81, and routine 119)', () => {
  const bank = ['Reserve As Work 10,4096', 'A=Start(10)']
  const at = (rt: Runtime): number => rt.bankBase(10)

  it('Octets Fill writes bytes over [start,end)', () => {
    const rt = run([...bank, 'Loke A,0 : Loke A+4,0', 'Octets Fill $AB,A To A+6'].join('\n'))
    expect(leek(rt, at(rt))).toBe(0xababab_ab)
    expect(leek(rt, at(rt) + 4)).toBe(0xabab0000)
    // end below start is the routine's own Bmi guard
    const none = run([...bank, 'Loke A,0', 'Octets Fill $AB,A+4 To A'].join('\n'))
    expect(leek(none, at(none))).toBe(0)
  })

  it('Word Switch byte-swaps every word in the range', () => {
    const rt = run([...bank, 'Loke A,$11223344 : Loke A+4,$55667788', 'Word Switch A To A+8'].join('\n'))
    expect([leek(rt, at(rt)), leek(rt, at(rt) + 4)]).toEqual([0x22114433, 0x66558877])
    // the loop is a do-while, so one word always goes even when the range
    // does not reach it
    const one = run([...bank, 'Loke A,$11223344', 'Word Switch A To A'].join('\n'))
    expect(leek(one, at(one))).toBe(0x22113344)
  })

  it('Low Filter.b caps a whole range; .w and .l cap exactly one element', () => {
    // .b ends its loop with Bne and walks the range. .w and .l end theirs
    // with `Cmp.l a0,a1 / Blt`, which asks whether the END pointer is below
    // the current one — false on the first pass of any sane range. Both the
    // source and the shipped binary say so.
    const b = run([...bank, 'Loke A,$10203040', 'Low Filter.b $20 To A,A+4'].join('\n'))
    expect(leek(b, at(b))).toBe(0x10202020)
    const w = run([...bank, 'Loke A,$10203040 : Loke A+4,$50607080', 'Low Filter.w $2000 To A,A+8'].join('\n'))
    expect([leek(w, at(w)), leek(w, at(w) + 4)]).toEqual([0x10203040, 0x50607080]) // $1020 < $2000, and it stops
    const w2 = run([...bank, 'Loke A,$30204040', 'Low Filter.w $2000 To A,A+4'].join('\n'))
    expect(leek(w2, at(w2))).toBe(0x20004040) // the first word only
    const l = run([...bank, 'Loke A,$30000000 : Loke A+4,$30000000', 'Low Filter.l $20000000 To A,A+8'].join('\n'))
    expect([leek(l, at(l)), leek(l, at(l) + 4)]).toEqual([0x20000000, 0x30000000])
  })
})

describe('Personnal: the sprite quartet, which does not work (L55-L58)', () => {
  const bank = ['Reserve As Work 10,24000', 'A=Start(10)', 'Create Standard A']

  it('F Set Sprite Buffer records the buffer and insists on 8K', () => {
    const rt = run([...bank, 'F Set Sprite Buffer A+16384,8192'].join('\n'))
    expect(rt.personnal.spriteBase).toBe(rt.bankBase(10) + 16384)
    expect(rt.personnal.spriteLength).toBe(8192)
    expect(() => run([...bank, 'F Set Sprite Buffer A,8191'].join('\n'))).toThrow(/Banque memoire trop petite/)
  })

  it('Get Even Sprite writes over _SpriteBase instead of into the buffer', () => {
    // `DLea _SpriteBase,a0 / Move.l a0,d1 / Move.l d1,a0` takes the ADDRESS of
    // the variable and never dereferences it, so the sprite lands on the
    // extension's own variables. The buffer stays empty and F Sprite, which
    // does dereference, finds nothing. Confirmed at $4592 in the binary.
    const rt = run(
      [
        'Screen Open 0,320,64,4,Lowres',
        'Cls 0 : Ink 1 : Bar 0,0 To 15,15',
        ...bank,
        'F Set Sprite Buffer A+16384,8192',
        'B=Screen Base',
        'Get Even Sprite B,0,0,0 To 8',
      ].join('\n'),
    )
    // the four-byte header, $0000 then the line count, landed on _SpriteBase
    expect(rt.personnal.spriteBase).toBe(8 << 8)
    // and the first plane-0 longword of the cut landed on _SpriteLength
    expect(rt.personnal.spriteLength).toBe(0xffff0000)
    // nothing at all reached the buffer the program reserved
    expect(leek(rt, rt.bankBase(10) + 16384)).toBe(0)
  })

  it('F Sprite patches the copper list four bytes a sprite, where it needs eight', () => {
    // _SprPtBase holds two MOVEs per sprite, so sprite n starts at n*8. The
    // routine does `Lsl.l #2,d2`. Sprite 0 is right; sprite 1 writes its high
    // word into SPR0PTL's value.
    const rt = run([...bank, 'F Set Sprite Buffer A+16384,8192', 'F Sprite 0 To 128,50,16,0'].join('\n'))
    const s = rt.personnal
    const sprite = s.spriteBase
    expect(getWord(rt, s.sprPtBase + 2)).toBe(sprite >>> 16)
    expect(getWord(rt, s.sprPtBase + 6)).toBe(sprite & 0xffff)
    // VSTART, HSTART as x/2, VSTOP as y+ysize, then the control byte
    expect(leek(rt, sprite)).toBe(((50 << 24) | (64 << 16) | (66 << 8)) >>> 0)

    const one = run([...bank, 'F Set Sprite Buffer A+16384,8192', 'F Sprite 1 To 128,50,16,0'].join('\n'))
    expect(getWord(one, one.personnal.sprPtBase + 6)).toBe(one.personnal.spriteBase >>> 16) // SPR0PTL's slot
    expect(getWord(one, one.personnal.sprPtBase + 10)).toBe(one.personnal.spriteBase & 0xffff)
  })
})

describe('Omd: octaplayer behind four keywords', () => {
  /** the smallest MMD0 octaplayer will take: one block, one looping instrument */
  const mmd0 = (): Uint8Array => {
    const d = new Uint8Array(0x600)
    const w = (a: number, v: number): void => {
      d[a] = (v >> 8) & 0xff
      d[a + 1] = v & 0xff
    }
    const l = (a: number, v: number): void => {
      w(a, (v >>> 16) & 0xffff)
      w(a + 2, v & 0xffff)
    }
    for (const [i2, c] of [...'MMD0'].entries()) d[i2] = c.charCodeAt(0)
    l(4, d.length)
    l(8, 0x100)
    l(0x10, 0x480)
    l(0x18, 0x4a0)
    w(0x100 + 2, 16)
    d[0x100 + 6] = 64
    w(0x100 + 504, 1)
    w(0x100 + 506, 1)
    w(0x100 + 0x2fc, 6)
    d[0x100 + 0x301] = 6
    for (let t = 0; t < 16; t++) d[0x100 + 0x302 + t] = 64
    d[0x100 + 0x312] = 64
    l(0x480, 0x490)
    d[0x490] = 1
    d[0x491] = 0
    d[0x492] = 49
    d[0x493] = 0x10
    l(0x4a0, 0x4b0)
    l(0x4b0, 0x40)
    for (let i2 = 0; i2 < 0x40; i2++) d[0x4b6 + i2] = 50
    return d
  }

  const withMod = (bytes = mmd0()): AmigaFS => {
    const fs = new AmigaFS()
    const vol = fs.mountMemory('Work')
    vol.write(['a.med'], bytes)
    fs.currentDir = 'Work:'
    return fs
  }

  it('loads a module and refuses one that is not an MMD', () => {
    // routine 128's error 22 is a zero from LoadModule, and a file octaplayer
    // will not take answers zero as surely as one that is not there
    const rt = run('Omd Load "Work:a.med"', withMod())
    expect(rt.personnal.omdModule).toBe(1)
    expect(() => run('Omd Load "Work:a.med"', withMod(new Uint8Array(64)))).toThrow()
    expect(() => run('Omd Load "Work:nope.med"', withMod())).toThrow()
  })

  it('raises 23 for a second load and 25 for a play with no module', () => {
    expect(() => run('Omd Load "Work:a.med"\nOmd Load "Work:a.med"', withMod())).toThrow()
    expect(() => run('Omd Play', withMod())).toThrow()
  })

  it('actually plays, where it used to keep a flag and go quiet', () => {
    const rt = run('Omd Load "Work:a.med"\nOmd Play\nWait Vbl\nWait Vbl', withMod())
    expect(rt.personnal.omdPlaying).toBe(true)
    // the default sink is a NullAudio, which records what the replayer asked
    // for -- and before this it asked for nothing at all
    const audio = rt.audio as unknown as { events: { kind: string }[] }
    expect(audio.events.filter((e) => e.kind === 'play').length).toBeGreaterThan(0)
  })

  it('Omd Free drops the module and leaves the flag, as routine 131 does', () => {
    const rt = run('Omd Load "Work:a.med"\nOmd Play\nOmd Free', withMod())
    expect(rt.personnal.omdModule).toBe(0)
    // routine 131 never touches the playing flag
    expect(rt.personnal.omdPlaying).toBe(true)
  })
})
