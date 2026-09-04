import { describe, expect, it } from 'vitest'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/source'
import { Runtime } from '../runtime/runtime'
import { findRegion, regionOverlaps, type MemRegion } from './memmap'
import { MUI, MUIC } from './muimaster.gen'

const table = new TokenTable(CORE_TOKENS)

function boot(): Runtime {
  return new Runtime(tokenize('Rem', table), table, { maxSteps: 200_000 })
}

/** the registry is private; these tests are the only reason to reach it */
function regions(rt: Runtime): readonly MemRegion[] {
  return (rt as unknown as { memRegions: readonly MemRegion[] }).memRegions
}

describe('address space map', () => {
  it('no two regions claim the same address', () => {
    // the EXT_DATA_BASE bug in the flesh: first based at 0x50000000, the
    // copper's address, where every read answered from the copper buffer
    expect(regionOverlaps(regions(boot()))).toEqual([])
  })

  it('every region is named and claims at least what it maps', () => {
    for (const r of regions(boot())) {
      expect(r.name).not.toBe('')
      expect(r.live()).toBeLessThanOrEqual(r.reserved)
    }
  })

  it('regions are ordered by base, so the map reads as a map', () => {
    const bases = regions(boot()).map((r) => r.base)
    expect(bases).toEqual([...bases].sort((a, b) => a - b))
  })

  it('an unallocated buffer region maps nothing and does not shadow the bank scan', () => {
    const rt = boot()
    expect(rt.tempBuffer).toBeNull()
    expect(findRegion(regions(rt), Runtime.TEMP_BUFFER_BASE)).toBeNull()
    expect(rt.resolveAddr(Runtime.TEMP_BUFFER_BASE)).toBeNull()

    rt.tempBuffer = new Uint8Array(16)
    rt.tempBuffer[3] = 0x5a
    expect(findRegion(regions(rt), Runtime.TEMP_BUFFER_BASE)?.name).toBe('temp buffer')
    const m = rt.resolveAddr(Runtime.TEMP_BUFFER_BASE + 3)
    expect(m?.data[m.off]).toBe(0x5a)
    // past the buffer it stops mapping again, rather than reading off the end
    expect(rt.resolveAddr(Runtime.TEMP_BUFFER_BASE + 16)).toBeNull()
  })

  it('maps bytes returned by Dataspace Find into the shared address space', () => {
    const rt = boot()
    rt.tempBuffer = Uint8Array.of(0x12, 0x34, 0x56)
    const ds = rt.mui.newObjectA(MUIC.MUIC_Dataspace)!
    const pointer = rt.mui.doMui(ds, MUI.MUIM_Dataspace_Add, [Runtime.TEMP_BUFFER_BASE, 3, 7])
    expect(pointer).not.toBe(0)
    const mapped = rt.resolveAddr(pointer)
    expect(mapped && [...mapped.data.slice(mapped.off, mapped.off + 3)]).toEqual([0x12, 0x34, 0x56])
    expect(findRegion(regions(rt), pointer)?.name).toBe('MUI dataspace')
  })

  it('a slotted region claims its whole span, so an empty slot is null not fall-through', () => {
    const rt = boot()
    // screen 7 does not exist, but the address is unambiguously the screen
    // region's: it must not go on to be interpreted as a bank
    const addr = Runtime.SCREEN_CHIP_BASE + 7 * Runtime.SCREEN_CHIP_SLOT
    expect(findRegion(regions(rt), addr)?.name).toBe('screen bitplanes')
    expect(rt.resolveAddr(addr)).toBeNull()
  })

  it('the beam counters synthesize a fresh value per read (VPOSR/VHPOSR)', () => {
    const rt = boot()
    const first = rt.resolveAddr(0xdff006)
    expect(first).not.toBeNull()
    // a synthesized region hands back its own buffer, not a shared one
    const second = rt.resolveAddr(0xdff006)
    expect(second?.data).not.toBe(first?.data)
  })
})
