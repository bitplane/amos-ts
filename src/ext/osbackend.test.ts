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
      status: 'faithful',
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

  it('classifies all Utility-adjacent tag, date, ToolType and ID helpers', () => {
    const names = ['_tag', '_ut', '_tool', '_id']
    const utility = rows.filter((row) => names.includes(row.namespace))
    expect(utility).toHaveLength(18)
    expect(utility.filter((row) => row.status === 'faithful')).toHaveLength(17)
    expect(utility.find((row) => row.name === '_id unique')?.status).toBe('partial')
    expect(utility.some((row) => row.status === 'review')).toBe(false)
  })

  it('classifies all StonePlayer and sample-effect helpers from their resolved workers', () => {
    const stone = rows.filter((row) => row.namespace === '_sp' || row.namespace === '_fx')
    expect(stone).toHaveLength(12)
    expect(stone.filter((row) => row.status === 'missing')).toHaveLength(10)
    expect(stone.filter((row) => row.status === 'partial').map((row) => row.name).sort()).toEqual([
      '_fx bank', '_fx play',
    ])
    expect(stone.some((row) => row.status === 'review')).toBe(false)
    expect(stone.find((row) => row.name === '_sp play')).toMatchObject({
      workers: [1899],
      osCalls: expect.arrayContaining([
        expect.objectContaining({ library: 'stoneplayer.library', lvo: -42 }),
        expect.objectContaining({ library: 'stoneplayer.library', lvo: -54 }),
      ]),
    })
    expect(stone.find((row) => row.name === '_fx balance')).toMatchObject({
      workers: [1907],
      osCalls: [expect.objectContaining({ library: 'stoneplayer.library', lvo: -156 })],
    })
  })

  it('classifies the direct CPU memory accessors and cold reboot', () => {
    const names = ['_cpu word', '_cpu uword', '_cpu long', '_cold reboot']
    const direct = rows.filter((row) => names.includes(row.name))
    expect(direct).toHaveLength(4)
    expect(direct.every((row) => row.status === 'faithful')).toBe(true)
    expect(direct.find((row) => row.name === '_cpu word')).toMatchObject({
      routines: [10, 11], workers: [10, 11],
    })
    expect(direct.find((row) => row.name === '_cpu uword')).toMatchObject({
      routines: [12, 13], workers: [12, 13],
    })
    expect(direct.find((row) => row.name === '_cpu long')).toMatchObject({
      routines: [14, 15], workers: [14, 15],
    })
    expect(direct.find((row) => row.name === '_cold reboot')).toMatchObject({
      workers: [1570],
      osCalls: [expect.objectContaining({ library: 'exec.library', lvo: -726 })],
    })
  })

  it('classifies both Exec cache operations from their exact LVOs', () => {
    expect(rows.find((row) => row.name === '_cache clr')).toMatchObject({
      status: 'faithful', workers: [1755],
      osCalls: [expect.objectContaining({ library: 'exec.library', lvo: -636 })],
    })
    expect(rows.find((row) => row.name === '_cache ctrl')).toMatchObject({
      status: 'partial', workers: [1756],
      osCalls: [expect.objectContaining({ library: 'exec.library', lvo: -648 })],
    })
  })

  it('classifies the graphics SetChipRev wrapper against the shared chipset state', () => {
    expect(rows.find((row) => row.name === '_chip set rev')).toMatchObject({
      status: 'partial', workers: [1688],
      osCalls: [expect.objectContaining({ library: 'graphics.library', lvo: -888 })],
    })
  })

  it('classifies every local string, structure and vector operation', () => {
    const namespaces = ['_str', '_struct', '_vec']
    const memory = rows.filter((row) => namespaces.includes(row.namespace))
    expect(memory).toHaveLength(15)
    expect(memory.every((row) => row.status === 'faithful')).toBe(true)
    expect(memory.find((row) => row.name === '_str alloc')?.workers).toEqual([1470])
    expect(memory.find((row) => row.name === '_str put')?.workers).toEqual([1473])
    expect(memory.find((row) => row.name === '_struct byte')).toMatchObject({
      routines: [16, 17], workers: [16, 17],
    })
    expect(memory.find((row) => row.name === '_struct free')).toMatchObject({
      workers: [1783],
      osCalls: [expect.objectContaining({ library: 'exec.library', lvo: -690 })],
    })
    expect(memory.find((row) => row.name === '_vec alloc')).toMatchObject({
      workers: [1782],
      osCalls: [expect.objectContaining({ library: 'exec.library', lvo: -684 })],
    })
  })

  it('classifies all four V39 pooled-allocation calls', () => {
    const pool = rows.filter((row) => row.namespace === '_pool')
    expect(pool).toHaveLength(4)
    expect(pool.every((row) => row.status === 'partial')).toBe(true)
    expect(pool.map((row) => row.osCalls[0]?.lvo)).toEqual([-696, -702, -708, -714])
    expect(pool.map((row) => row.workers[0])).toEqual([1784, 1785, 1786, 1787])
  })

  it('classifies all local scalar and binary-string conversions', () => {
    const names = [
      '_join.w', '_ext.b', '_ext.w', '_ext.l', '_chr$.l', '_chr$.w', '_val.l', '_val.w', '_to str', '_0$',
    ]
    const scalar = rows.filter((row) => names.includes(row.name))
    expect(scalar).toHaveLength(10)
    expect(scalar.every((row) => row.status === 'faithful')).toBe(true)
    expect(scalar.find((row) => row.name === '_join.w')?.workers).toEqual([1752])
    expect(scalar.find((row) => row.name === '_ext.w')?.workers).toEqual([1758])
    expect(scalar.find((row) => row.name === '_chr$.l')?.workers).toEqual([26])
    expect(scalar.find((row) => row.name === '_val.w')?.workers).toEqual([29])
    expect(scalar.find((row) => row.name === '_to str')).toMatchObject({
      workers: [1475],
      osCalls: [expect.objectContaining({ library: 'exec.library', lvo: -624 })],
    })
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
