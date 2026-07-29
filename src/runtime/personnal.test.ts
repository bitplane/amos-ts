import { describe, expect, it } from 'vitest'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { extensionById } from '../ext/registry'
import { tokenize } from '../tokens/tokenizer'
import { Runtime } from './runtime'

const table = new TokenTable(CORE_TOKENS)
// Personnal is third-party, so no stock slot map binds it: the source puts
// it at 13 (ExtNb Equ 13-1) and 68 of its 69 demos agree. The 1.1a table is
// the superset, so it detokenises both versions' programs.
const exts = new Map([[13, extensionById('personnal-1.1')!.table]])

function run(src: string): Runtime {
  const rt = new Runtime(tokenize(src, table, exts), table, { extensions: exts, maxSteps: 2_000_000 })
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
