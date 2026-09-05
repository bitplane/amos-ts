import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { firstCodeHunk } from '../amiga/hunk'
import { EXT_TABLES } from './tables.gen'
import { auditOsBackend, osBackendSummary } from './osbackend'

const path = join('fixtures', 'extensions', 'os-devkit-1.61', 'AMOSPro_OS_DevKit.Lib')
const present = existsSync(path)

describe.skipIf(!present)('OS DevKit backend inventory', () => {
  const rows = auditOsBackend(EXT_TABLES['os-devkit-1.61']!, firstCodeHunk(new Uint8Array(readFileSync(path))))

  it('accounts for every named token-table entry', () => {
    const summary = osBackendSummary(rows)
    expect(summary.total).toBe(1047)
    expect(summary.referencedRoutines).toBe(1053)
    expect(summary.eightByteRoutines).toBe(1009)
    expect(rows.filter((row) => row.status === 'faithful' || row.status === 'partial' || row.status === 'missing' || row.status === 'review'))
      .toHaveLength(1047)
  })

  it('does not confuse a machine-layer module with completed operation coverage', () => {
    expect(rows.find((row) => row.name === '_cold reboot')).toMatchObject({
      status: 'review',
      workers: [1570],
      osCalls: [{ library: 'exec.library', lvo: -726 }],
    })
    expect(rows.find((row) => row.name === '_rp draw')).toMatchObject({ status: 'review', family: 'graphics' })
    expect(rows.find((row) => row.name === '_dt obtain')).toMatchObject({
      status: 'partial',
      osCalls: [{ library: 'datatypes.library', lvo: -36 }],
    })
    expect(rows.find((row) => row.name === '_ggad create')).toMatchObject({
      osCalls: [{ library: 'gadtools.library', lvo: -30 }],
    })
    expect(rows.find((row) => row.name === '_font load')?.osCalls).toContainEqual({
      chain: '?', library: 'diskfont.library', lvo: -30,
    })
    expect(rows.find((row) => row.name === '_ag display')?.osCalls).toContainEqual({
      chain: '?', library: 'amigaguide.library', lvo: -54,
    })
  })

  it('classifies every DataTypes keyword at operation level', () => {
    const dt = rows.filter((row) => row.namespace === '_dt')
    expect(dt).toHaveLength(14)
    expect(dt.filter((row) => row.status === 'faithful').map((row) => row.name).sort())
      .toEqual(['_dt init', '_dt release'])
    expect(dt.filter((row) => row.status === 'partial').map((row) => row.name)).toEqual(['_dt obtain'])
    expect(dt.filter((row) => row.status === 'missing')).toHaveLength(11)
    expect(dt.some((row) => row.status === 'review')).toBe(false)
  })

  it('classifies every direct LowLevel keyword at operation level', () => {
    const lowlevel = rows.filter((row) => row.osCalls.some((call) => call.library === 'lowlevel.library'))
    expect(lowlevel).toHaveLength(8)
    expect(lowlevel.find((row) => row.name === '_key pressed')?.status).toBe('faithful')
    expect(lowlevel.filter((row) => row.status === 'partial')).toHaveLength(5)
    expect(lowlevel.filter((row) => row.status === 'missing').map((row) => row.name).sort())
      .toEqual(['_sys disown', '_sys own'])
    expect(lowlevel.some((row) => row.status === 'review')).toBe(false)
  })

  it('classifies every Locale and Catalog keyword at operation level', () => {
    const locale = rows.filter((row) => row.namespace === '_loc' || row.namespace === '_cat')
    expect(locale).toHaveLength(7)
    expect(locale.filter((row) => row.status === 'faithful').map((row) => row.name).sort())
      .toEqual(['_cat close', '_cat str', '_loc close', '_loc init'])
    expect(locale.filter((row) => row.status === 'partial').map((row) => row.name).sort())
      .toEqual(['_cat open', '_loc open', '_loc str'])
    expect(locale.some((row) => row.status === 'review')).toBe(false)
  })

  it('classifies every ASL keyword at operation level', () => {
    const asl = rows.filter((row) => row.namespace === '_asl')
    expect(asl).toHaveLength(8)
    expect(asl.filter((row) => row.status === 'faithful')).toHaveLength(5)
    expect(asl.filter((row) => row.status === 'partial').map((row) => row.name).sort())
      .toEqual(['_asl alloc', '_asl do'])
    expect(asl.filter((row) => row.status === 'missing').map((row) => row.name))
      .toEqual(['_asl what nb args'])
    expect(asl.some((row) => row.status === 'review')).toBe(false)
  })

  it('classifies every Icon keyword and its three aliases at operation level', () => {
    const icon = rows.filter((row) => row.namespace === '_icon')
    expect(icon).toHaveLength(9)
    expect(icon.filter((row) => row.status === 'faithful').map((row) => row.name)).toEqual(['_icon free'])
    expect(icon.filter((row) => row.status === 'partial').map((row) => row.name).sort())
      .toEqual(['_icon get', '_icon load'])
    expect(icon.filter((row) => row.status === 'missing')).toHaveLength(6)
    expect(icon.find((row) => row.name === '_icon get')?.workers).toEqual([1777])
    expect(icon.find((row) => row.name === '_icon del')?.workers).toEqual([1778])
    expect(icon.find((row) => row.name === '_icon put')?.workers).toEqual([1779])
    expect(icon.some((row) => row.status === 'review')).toBe(false)
  })

  it('classifies every Layers keyword at operation level', () => {
    const layers = rows.filter((row) => row.namespace === '_layer' || row.namespace === '_li')
    expect(layers).toHaveLength(5)
    expect(layers.every((row) => row.status === 'partial')).toBe(true)
    expect(layers.map((row) => row.osCalls[0]?.lvo).sort((a, b) => a! - b!))
      .toEqual([-150, -144, -90, -42, -36])
  })

  it('classifies all 47 low-level GadTools and menu keywords', () => {
    const low = rows.filter((row) => row.namespace === '_ggad' || row.namespace === '_gmn' || row.namespace === '_menu')
    expect(low).toHaveLength(47)
    expect(low.filter((row) => row.status === 'faithful')).toHaveLength(39)
    expect(low.filter((row) => row.status === 'partial')).toHaveLength(5)
    expect(low.filter((row) => row.status === 'missing').map((row) => row.name).sort())
      .toEqual(['_menu clear', '_menu set', '_menu share'])
    expect(low.some((row) => row.status === 'review')).toBe(false)
  })

  it('classifies all 73 high-level GadTools bank commands individually', () => {
    const high = rows.filter((row) => row.namespace === '_gt')
    expect(high).toHaveLength(73)
    expect(high.every((row) => row.status === 'partial')).toBe(true)
    expect(high.find((row) => row.name === '_gt button')?.workers).toEqual([3121])
    expect(high.find((row) => row.name === '_gt boopsi')?.workers).toEqual([3158])
    expect(high.find((row) => row.name === '_gt menu what check')?.workers).toEqual([3189])
  })

  it('makes every previously stated missing family explicit', () => {
    expect(rows.find((row) => row.name === '_iff parse')).toMatchObject({ status: 'missing', family: 'iffparse' })
    expect(rows.find((row) => row.name === '_iff parse')?.osCalls).toContainEqual({
      chain: 'a5+552>+728', library: 'iffparse.library', lvo: -42,
    })
    expect(rows.find((row) => row.name === '_cx broker')).toMatchObject({ status: 'missing', family: 'commodities' })
    expect(rows.find((row) => row.name === '_app add icon')).toMatchObject({ status: 'missing', family: 'workbench' })
    expect(rows.find((row) => row.name === '_prfs set')).toMatchObject({ status: 'missing', family: 'preferences' })
    expect(rows.find((row) => row.name === '_help ctrl')).toMatchObject({ status: 'missing', family: 'amigaguide' })
  })
})
