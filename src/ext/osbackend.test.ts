import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { firstCodeHunk } from '../amiga/hunk'
import { EXT_TABLES } from './tables.gen'
import { auditOsBackend, osBackendSummary } from './osbackend'

const path = join('fixtures', 'extensions', 'os-devkit-1.61', 'AMOSPro_OS_DevKit.Lib')
const present = existsSync(path)
// Vitest invokes a describe callback while collecting even when skipIf is
// true. Keep the fixture read outside that callback and guard it explicitly,
// otherwise a clean CI checkout fails before the skipped suite is registered.
const rows = present
  ? auditOsBackend(EXT_TABLES['os-devkit-1.61']!, firstCodeHunk(new Uint8Array(readFileSync(path))))
  : []

describe.skipIf(!present)('OS DevKit backend inventory', () => {
  it('accounts for every named token-table entry', () => {
    const summary = osBackendSummary(rows)
    expect(summary.total).toBe(1047)
    expect(summary.referencedRoutines).toBe(1075)
    expect(summary.eightByteRoutines).toBe(1031)
    expect(rows.filter((row) => row.status === 'faithful' || row.status === 'partial' || row.status === 'missing' || row.status === 'review'))
      .toHaveLength(1047)
  })

  it('does not confuse a machine-layer module with completed operation coverage', () => {
    expect(rows.find((row) => row.name === '_cold reboot')).toMatchObject({
      status: 'faithful',
      workers: [1570],
      osCalls: [{ library: 'exec.library', lvo: -726 }],
    })
    expect(rows.find((row) => row.name === '_dos open')).toMatchObject({ status: 'partial', family: 'dos' })
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
      .toEqual(['_dt delete', '_dt init', '_dt release'])
    expect(dt.filter((row) => row.status === 'partial')).toHaveLength(11)
    expect(dt.filter((row) => row.status === 'missing')).toHaveLength(0)
    expect(dt.some((row) => row.status === 'review')).toBe(false)
  })

  it('classifies every direct LowLevel keyword at operation level', () => {
    const lowlevel = rows.filter((row) => row.osCalls.some((call) => call.library === 'lowlevel.library'))
    expect(lowlevel).toHaveLength(8)
    expect(lowlevel.find((row) => row.name === '_key pressed')?.status).toBe('missing')
    expect(lowlevel.filter((row) => row.status === 'partial')).toHaveLength(5)
    expect(lowlevel.filter((row) => row.status === 'missing').map((row) => row.name).sort())
      .toEqual(['_key pressed', '_sys disown', '_sys own'])
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
    expect(low.filter((row) => row.status === 'faithful')).toHaveLength(42)
    expect(low.filter((row) => row.status === 'partial')).toHaveLength(5)
    expect(low.filter((row) => row.status === 'missing')).toHaveLength(0)
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
    expect(memory.find((row) => row.name === '_str put')?.workers).toEqual([1473, 1474])
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

  it('classifies WBArg field readers and DOS path helpers', () => {
    const args = rows.filter((row) => row.namespace === '_arg')
    expect(args).toHaveLength(2)
    expect(args.every((row) => row.status === 'faithful')).toBe(true)
    expect(args.map((row) => row.workers[0])).toEqual([1866, 1867])

    const paths = rows.filter((row) => row.namespace === '_path')
    expect(paths).toHaveLength(2)
    expect(paths.every((row) => row.status === 'partial')).toBe(true)
    expect(paths.find((row) => row.name === '_path add')).toMatchObject({
      workers: [1839],
      osCalls: [expect.objectContaining({ library: 'dos.library', lvo: -882 })],
    })
    expect(paths.find((row) => row.name === '_path part')?.workers).toEqual([1841])
  })

  it('classifies all five generic library operations', () => {
    const library = rows.filter((row) => row.namespace === '_lib')
    expect(library).toHaveLength(5)
    expect(library.filter((row) => row.status === 'partial')).toHaveLength(4)
    expect(library.find((row) => row.name === '_lib call')).toMatchObject({
      status: 'missing', routines: [42], workers: [42],
    })
    expect(library.find((row) => row.name === '_lib version')?.workers).toEqual([1480])
    expect(library.find((row) => row.name === '_lib revision')?.workers).toEqual([1481])
    expect(library.find((row) => row.name === '_lib open')).toMatchObject({
      workers: [3190],
      osCalls: [expect.objectContaining({ library: 'exec.library', lvo: -552 })],
    })
    expect(library.find((row) => row.name === '_lib close')).toMatchObject({
      workers: [3191],
      osCalls: [expect.objectContaining({ library: 'exec.library', lvo: -414 })],
    })
  })

  it('classifies every native base getter individually', () => {
    const bases = rows.filter((row) => row.namespace === '_base')
    expect(bases).toHaveLength(14)
    expect(bases.filter((row) => row.status === 'faithful')).toHaveLength(9)
    expect(bases.filter((row) => row.status === 'partial').map((row) => row.name).sort()).toEqual([
      '_base cx', '_base iff', '_base tag', '_base topaz',
    ])
    expect(bases.filter((row) => row.status === 'missing').map((row) => row.name).sort()).toEqual([
      '_base wb',
    ])
    expect(bases.some((row) => row.status === 'review')).toBe(false)
    expect(bases.find((row) => row.name === '_base gfx')?.workers).toEqual([1748])
    expect(bases.find((row) => row.name === '_base layers')?.workers).toEqual([1152])
    expect(bases.find((row) => row.name === '_base tag')?.workers).toEqual([1323])
  })

  it('classifies Intuition DoubleClick with its four timestamp arguments', () => {
    expect(rows.find((row) => row.name === '_dbl click')).toMatchObject({
      status: 'partial', workers: [1584],
      osCalls: [expect.objectContaining({ library: 'intuition.library', lvo: -102 })],
    })
  })

  it('classifies all 44 Border, PropInfo and StringInfo operations', () => {
    const native = rows.filter((row) => ['_bd', '_pi', '_si'].includes(row.namespace))
    expect(native).toHaveLength(44)
    expect(native.filter((row) => row.status === 'faithful')).toHaveLength(43)
    expect(native.filter((row) => row.status === 'partial').map((row) => row.name)).toEqual(['_bd draw'])
    expect(native.some((row) => row.status === 'review')).toBe(false)
    expect(native.find((row) => row.name === '_bd set draw')?.workers).toEqual([1370])
    expect(native.find((row) => row.name === '_bd draw')).toMatchObject({
      workers: [1375],
      osCalls: [expect.objectContaining({ library: 'intuition.library', lvo: -108 })],
    })
    expect(native.find((row) => row.name === '_pi set')?.workers).toEqual([1409])
    expect(native.find((row) => row.name === '_pi what top')?.workers).toEqual([1420])
    expect(native.find((row) => row.name === '_si set')?.workers).toEqual([1425])
    expect(native.find((row) => row.name === '_si what keymap')?.workers).toEqual([1438])
  })

  it('classifies all sixteen native Image operations', () => {
    const images = rows.filter((row) => row.namespace === '_img')
    expect(images).toHaveLength(16)
    expect(images.filter((row) => row.status === 'faithful')).toHaveLength(13)
    expect(images.filter((row) => row.status === 'partial').map((row) => row.name).sort()).toEqual([
      '_img draw', '_img draw state', '_img erase',
    ])
    expect(images.some((row) => row.status === 'review')).toBe(false)
    expect(images.find((row) => row.name === '_img set body')?.workers).toEqual([1388])
    expect(images.find((row) => row.name === '_img point in')).toMatchObject({
      workers: [1394],
      osCalls: [expect.objectContaining({ library: 'intuition.library', lvo: -624 })],
    })
    expect(images.find((row) => row.name === '_img what next')?.workers).toEqual([1403])
  })

  it('classifies every IntuiMessage, GadTools message and NotifyMessage operation', () => {
    const messages = rows.filter((row) => ['_imsg', '_gmsg', '_nmsg'].includes(row.namespace))
    expect(messages).toHaveLength(12)
    expect(messages.filter((row) => row.status === 'faithful')).toHaveLength(10)
    expect(messages.filter((row) => row.status === 'partial').map((row) => row.name).sort()).toEqual([
      '_gmsg get', '_gmsg reply',
    ])
    expect(messages.some((row) => row.status === 'review')).toBe(false)
    expect(messages.find((row) => row.name === '_gmsg get')).toMatchObject({
      workers: [1543],
      osCalls: expect.arrayContaining([
        expect.objectContaining({ library: 'exec.library', lvo: -306 }),
        expect.objectContaining({ library: 'gadtools.library', lvo: -72 }),
      ]),
    })
    expect(messages.find((row) => row.name === '_gmsg reply')).toMatchObject({
      workers: [1544],
      osCalls: [expect.objectContaining({ library: 'gadtools.library', lvo: -78 })],
    })
    expect(messages.find((row) => row.name === '_imsg what class')?.workers).toEqual([1547])
    expect(messages.find((row) => row.name === '_imsg what wnd')?.workers).toEqual([1555])
    expect(messages.find((row) => row.name === '_nmsg what nreq')?.workers).toEqual([1857])
  })

  it('classifies every Exec List and Node operation', () => {
    const nodes = rows.filter((row) => row.namespace === '_lnod' || row.namespace === '_nod')
    expect(nodes).toHaveLength(29)
    expect(nodes.every((row) => row.status === 'faithful')).toBe(true)
    expect(nodes.find((row) => row.name === '_lnod set head')?.workers).toEqual([1439])
    expect(nodes.find((row) => row.name === '_nod what start')?.workers).toEqual([1465])
    expect(nodes.find((row) => row.name === '_lnod free')).toMatchObject({
      workers: [1783],
      osCalls: [expect.objectContaining({ library: 'exec.library', lvo: -690 })],
    })
    expect(nodes.find((row) => row.name === '_nod ins')?.osCalls)
      .toEqual([expect.objectContaining({ library: 'exec.library', lvo: -234 })])
    expect(nodes.find((row) => row.name === '_nod find name')?.osCalls)
      .toEqual([expect.objectContaining({ library: 'exec.library', lvo: -276 })])
  })

  it('classifies every Exec port, message and signal operation', () => {
    const ipc = rows.filter((row) => ['_port', '_msg', '_sig'].includes(row.namespace))
    expect(ipc).toHaveLength(18)
    expect(ipc.filter((row) => row.status === 'faithful')).toHaveLength(15)
    expect(ipc.filter((row) => row.status === 'partial').map((row) => row.name).sort()).toEqual([
      '_msg get', '_port wait', '_sig wait',
    ])
    expect(ipc.some((row) => row.status === 'review')).toBe(false)
    expect(ipc.find((row) => row.name === '_port create')).toMatchObject({
      workers: [1538], osCalls: [expect.objectContaining({ library: 'exec.library', lvo: -666 })],
    })
    expect(ipc.find((row) => row.name === '_msg get')).toMatchObject({
      workers: [1540],
      osCalls: expect.arrayContaining([
        expect.objectContaining({ library: 'exec.library', lvo: -306 }),
        expect.objectContaining({ library: 'exec.library', lvo: -372 }),
      ]),
    })
    expect(ipc.find((row) => row.name === '_msg what reply port')?.workers).toEqual([1546])
    expect(ipc.find((row) => row.name === '_port what sig task')?.workers).toEqual([1556])
    expect(ipc.find((row) => row.name === '_sig wait')).toMatchObject({
      workers: [1562], osCalls: [expect.objectContaining({ library: 'exec.library', lvo: -318 })],
    })
  })

  it('classifies every direct Exec memory operation and its misleading alias', () => {
    const memory = rows.filter((row) => row.namespace === '_mem')
    expect(memory).toHaveLength(6)
    expect(memory.filter((row) => row.status === 'faithful').map((row) => row.name).sort()).toEqual([
      '_mem abs alloc', '_mem alloc', '_mem copy', '_mem free',
    ])
    expect(memory.filter((row) => row.status === 'partial').map((row) => row.name).sort()).toEqual([
      '_mem avail', '_mem type',
    ])
    expect(memory.some((row) => row.status === 'review')).toBe(false)
    expect(memory.find((row) => row.name === '_mem alloc')?.workers).toEqual([1117])
    expect(memory.find((row) => row.name === '_mem abs alloc')?.workers).toEqual([1117])
    expect(memory.find((row) => row.name === '_mem copy')).toMatchObject({
      workers: [1120], osCalls: [expect.objectContaining({ library: 'exec.library', lvo: -624 })],
    })
    expect(memory.find((row) => row.name === '_mem type')).toMatchObject({
      workers: [1121], osCalls: [expect.objectContaining({ library: 'exec.library', lvo: -534 })],
    })
  })

  it('classifies every Exec Interrupt operation', () => {
    const interrupts = rows.filter((row) => row.namespace === '_int')
    expect(interrupts).toHaveLength(5)
    expect(interrupts.filter((row) => row.status === 'faithful')).toHaveLength(4)
    expect(interrupts.filter((row) => row.status === 'partial').map((row) => row.name)).toEqual(['_int add'])
    expect(interrupts.some((row) => row.status === 'review')).toBe(false)
    expect(interrupts.find((row) => row.name === '_int alloc')?.workers).toEqual([1563])
    expect(interrupts.find((row) => row.name === '_int free')?.workers).toEqual([1783])
    expect(interrupts.find((row) => row.name === '_int set')?.workers).toEqual([1564])
    expect(interrupts.find((row) => row.name === '_int add')).toMatchObject({
      workers: [1565], osCalls: [expect.objectContaining({ library: 'exec.library', lvo: -168 })],
    })
    expect(interrupts.find((row) => row.name === '_int rem')).toMatchObject({
      workers: [1566], osCalls: [expect.objectContaining({ library: 'exec.library', lvo: -174 })],
    })
  })

  it('classifies both Exec task operations against the single-task scheduler model', () => {
    const tasks = rows.filter((row) => row.namespace === '_task')
    expect(tasks).toHaveLength(2)
    expect(tasks.every((row) => row.status === 'partial')).toBe(true)
    expect(tasks.find((row) => row.name === '_task find')).toMatchObject({
      workers: [1567], osCalls: [expect.objectContaining({ library: 'exec.library', lvo: -294 })],
    })
    expect(tasks.find((row) => row.name === '_task set pri')).toMatchObject({
      workers: [1568], osCalls: [expect.objectContaining({ library: 'exec.library', lvo: -300 })],
    })
  })

  it('classifies all six system time, display and identity queries', () => {
    const system = rows.filter((row) => row.namespace === '_sys' && !['_sys own', '_sys disown'].includes(row.name))
    expect(system).toHaveLength(6)
    expect(system.filter((row) => row.status === 'faithful')).toHaveLength(5)
    expect(system.filter((row) => row.status === 'partial').map((row) => row.name)).toEqual(['_sys view'])
    expect(system.some((row) => row.status === 'review')).toBe(false)
    expect(system.find((row) => row.name === '_sys time')).toMatchObject({
      workers: [1583], osCalls: [expect.objectContaining({ library: 'intuition.library', lvo: -84 })],
    })
    expect(system.find((row) => row.name === '_sys view')).toMatchObject({
      workers: [1592], osCalls: [expect.objectContaining({ library: 'intuition.library', lvo: -294 })],
    })
    expect(system.find((row) => row.name === '_sys version')?.workers).toEqual([1744])
    expect(system.find((row) => row.name === '_sys revision')?.workers).toEqual([1745])
    expect(system.find((row) => row.name === '_sys cpu')?.workers).toEqual([1753])
    expect(system.find((row) => row.name === '_sys fpu')?.workers).toEqual([1754])
  })

  it('classifies all five display-control and display-database operations', () => {
    const display = rows.filter((row) => row.namespace === '_disp')
    expect(display).toHaveLength(5)
    expect(display.filter((row) => row.status === 'faithful').map((row) => row.name)).toEqual(['_disp info find'])
    expect(display.filter((row) => row.status === 'partial').map((row) => row.name).sort()).toEqual([
      '_disp alert', '_disp info get', '_disp remake', '_disp rethink',
    ])
    expect(display.some((row) => row.status === 'review')).toBe(false)
    expect(display.find((row) => row.name === '_disp alert')).toMatchObject({
      workers: [1571], osCalls: [expect.objectContaining({ library: 'intuition.library', lvo: -90 })],
    })
    expect(display.find((row) => row.name === '_disp remake')).toMatchObject({
      workers: [1579], osCalls: [expect.objectContaining({ library: 'intuition.library', lvo: -384 })],
    })
    expect(display.find((row) => row.name === '_disp rethink')).toMatchObject({
      workers: [1580], osCalls: [expect.objectContaining({ library: 'intuition.library', lvo: -390 })],
    })
    expect(display.find((row) => row.name === '_disp info find')).toMatchObject({
      workers: [1790], osCalls: [expect.objectContaining({ library: 'graphics.library', lvo: -726 })],
    })
    expect(display.find((row) => row.name === '_disp info get')).toMatchObject({
      workers: [1791], osCalls: [expect.objectContaining({ library: 'graphics.library', lvo: -756 })],
    })
  })

  it('separates old-style Requester records from the host-backed EasyRequest path', () => {
    const requesters = rows.filter((row) => row.namespace === '_req')
    expect(requesters).toHaveLength(4)
    expect(requesters.filter((row) => row.status === 'missing').map((row) => row.name).sort()).toEqual([
      '_req do', '_req end', '_req init',
    ])
    expect(requesters.filter((row) => row.status === 'partial').map((row) => row.name)).toEqual(['_req easy'])
    expect(requesters.some((row) => row.status === 'review')).toBe(false)
    expect(requesters.find((row) => row.name === '_req init')).toMatchObject({
      workers: [1572], osCalls: [expect.objectContaining({ library: 'intuition.library', lvo: -138 })],
    })
    expect(requesters.find((row) => row.name === '_req do')).toMatchObject({
      workers: [1573], osCalls: [expect.objectContaining({ library: 'intuition.library', lvo: -240 })],
    })
    expect(requesters.find((row) => row.name === '_req end')).toMatchObject({
      workers: [1574], osCalls: [expect.objectContaining({ library: 'intuition.library', lvo: -120 })],
    })
    expect(requesters.find((row) => row.name === '_req easy')).toMatchObject({
      workers: [1575], osCalls: [expect.objectContaining({ library: 'intuition.library', lvo: -588 })],
    })
  })

  it('classifies pointer, mouse-report and IntuitionBase lock helpers', () => {
    const helpers = rows.filter((row) => ['_ptr', '_mouse', '_ibase'].includes(row.namespace))
    expect(helpers).toHaveLength(6)
    expect(helpers.filter((row) => row.status === 'faithful').map((row) => row.name).sort()).toEqual([
      '_ibase lock', '_ibase unlock', '_mouse report', '_mouse unreport',
    ])
    expect(helpers.filter((row) => row.status === 'partial').map((row) => row.name).sort()).toEqual([
      '_ptr clear', '_ptr set',
    ])
    expect(helpers.some((row) => row.status === 'review')).toBe(false)
    expect(helpers.find((row) => row.name === '_ptr clear')).toMatchObject({
      workers: [1581], osCalls: [expect.objectContaining({ library: 'intuition.library', lvo: -60 })],
    })
    expect(helpers.find((row) => row.name === '_ptr set')).toMatchObject({
      workers: [1582], osCalls: [expect.objectContaining({ library: 'intuition.library', lvo: -270 })],
    })
    expect(helpers.find((row) => row.name === '_mouse report')).toMatchObject({
      workers: [1587], osCalls: [expect.objectContaining({ library: 'intuition.library', lvo: -234 })],
    })
    expect(helpers.find((row) => row.name === '_ibase lock')).toMatchObject({
      workers: [1589], osCalls: [expect.objectContaining({ library: 'intuition.library', lvo: -414 })],
    })
    expect(helpers.find((row) => row.name === '_ibase unlock')).toMatchObject({
      workers: [1590], osCalls: [expect.objectContaining({ library: 'intuition.library', lvo: -420 })],
    })
  })

  it('classifies every IntuiText field, drawing and measurement operation', () => {
    const text = rows.filter((row) => row.namespace === '_it')
    expect(text).toHaveLength(16)
    expect(text.filter((row) => row.status === 'faithful')).toHaveLength(14)
    expect(text.filter((row) => row.status === 'partial').map((row) => row.name).sort()).toEqual([
      '_it print', '_it what len',
    ])
    expect(text.some((row) => row.status === 'review')).toBe(false)
    expect(text.find((row) => row.name === '_it set draw')?.workers).toEqual([1354])
    expect(text.find((row) => row.name === '_it set')?.workers).toEqual([1359])
    expect(text.find((row) => row.name === '_it print')).toMatchObject({
      workers: [1360], osCalls: [expect.objectContaining({ library: 'intuition.library', lvo: -216 })],
    })
    expect(text.find((row) => row.name === '_it what next')?.workers).toEqual([1368])
    expect(text.find((row) => row.name === '_it what len')).toMatchObject({
      workers: [1369], osCalls: [expect.objectContaining({ library: 'intuition.library', lvo: -330 })],
    })
  })

  it('classifies all five TextAttr operations', () => {
    const attrs = rows.filter((row) => row.namespace === '_ta')
    expect(attrs).toHaveLength(5)
    expect(attrs.every((row) => row.status === 'faithful')).toBe(true)
    expect(attrs.map((row) => row.workers[0])).toEqual([1736, 1737, 1738, 1739, 1740])
    expect(attrs.every((row) => row.osCalls.length === 0)).toBe(true)
  })

  it('classifies all five RasInfo operations', () => {
    const rasInfo = rows.filter((row) => row.namespace === '_ri')
    expect(rasInfo).toHaveLength(5)
    expect(rasInfo.every((row) => row.status === 'faithful')).toBe(true)
    expect(rasInfo.map((row) => row.workers[0])).toEqual([1731, 1732, 1733, 1734, 1735])
    expect(rasInfo.every((row) => row.osCalls.length === 0)).toBe(true)
  })

  it('classifies all five View operations including the shipped setter defect', () => {
    const view = rows.filter((row) => row.namespace === '_view')
    expect(view).toHaveLength(5)
    expect(view.every((row) => row.status === 'faithful')).toBe(true)
    expect(view.map((row) => row.workers[0])).toEqual([1713, 1714, 1715, 1716, 1717])
    expect(view.every((row) => row.osCalls.length === 0)).toBe(true)
  })

  it('classifies all fourteen ViewPort operations including both shipped reader defects', () => {
    const viewPort = rows.filter((row) => row.namespace === '_vp')
    expect(viewPort).toHaveLength(14)
    expect(viewPort.filter((row) => row.status === 'faithful')).toHaveLength(13)
    expect(viewPort.filter((row) => row.status === 'partial').map((row) => row.name)).toEqual(['_vp get mode'])
    expect(viewPort.some((row) => row.status === 'review')).toBe(false)
    expect(viewPort.find((row) => row.name === '_vp set next')?.workers).toEqual([1718])
    expect(viewPort.find((row) => row.name === '_vp what width')?.workers).toEqual([1725])
    expect(viewPort.find((row) => row.name === '_vp what y')?.workers).toEqual([1728])
    expect(viewPort.find((row) => row.name === '_vp get mode')).toMatchObject({
      workers: [1792], osCalls: [expect.objectContaining({ library: 'graphics.library', lvo: -792 })],
    })
  })

  it('classifies all ten BitMap operations and the negative plane-index defect', () => {
    const bitMap = rows.filter((row) => row.namespace === '_bm')
    expect(bitMap).toHaveLength(10)
    expect(bitMap.filter((row) => row.status === 'faithful').map((row) => row.name).sort()).toEqual([
      '_bm set datas', '_bm what depth', '_bm what flags', '_bm what height', '_bm what modulo', '_bm what plane',
    ])
    expect(bitMap.filter((row) => row.status === 'partial').map((row) => row.name).sort()).toEqual([
      '_bm alloc', '_bm free', '_bm set plane', '_bm what attr',
    ])
    expect(bitMap.some((row) => row.status === 'review')).toBe(false)
    expect(bitMap.find((row) => row.name === '_bm alloc')).toMatchObject({
      workers: [1673], osCalls: [expect.objectContaining({ library: 'graphics.library', lvo: -918 })],
    })
    expect(bitMap.find((row) => row.name === '_bm free')).toMatchObject({
      workers: [1674], osCalls: [expect.objectContaining({ library: 'graphics.library', lvo: -924 })],
    })
    expect(bitMap.find((row) => row.name === '_bm what attr')).toMatchObject({
      workers: [1675], osCalls: [expect.objectContaining({ library: 'graphics.library', lvo: -960 })],
    })
    expect(bitMap.find((row) => row.name === '_bm set datas')?.workers).toEqual([1689])
    expect(bitMap.find((row) => row.name === '_bm set plane')?.workers).toEqual([1690])
    expect(bitMap.find((row) => row.name === '_bm what plane')?.workers).toEqual([1694])
  })

  it('classifies the complete ColorMap and RGB4/RGB32 family', () => {
    const names = (prefix: string): string[] => rows.filter((row) => row.namespace === prefix).map((row) => row.name)
    expect(names('_cm')).toHaveLength(2)
    expect(names('_rgb4')).toHaveLength(4)
    expect(names('_rgb32')).toHaveLength(4)
    const colour = rows.filter((row) => ['_cm', '_rgb4', '_rgb32'].includes(row.namespace))
    expect(colour.filter((row) => row.status === 'faithful').map((row) => row.name).sort()).toEqual([
      '_cm alloc', '_cm free', '_rgb32 cm set', '_rgb32 get', '_rgb4 cm set', '_rgb4 get',
    ])
    expect(colour.filter((row) => row.status === 'partial').map((row) => row.name).sort()).toEqual([
      '_rgb32 load', '_rgb32 set', '_rgb4 load', '_rgb4 set',
    ])
    expect(colour.some((row) => row.status === 'review')).toBe(false)
    expect(colour.find((row) => row.name === '_cm alloc')).toMatchObject({
      workers: [1664], osCalls: [expect.objectContaining({ library: 'graphics.library', lvo: -570 })],
    })
    expect(colour.find((row) => row.name === '_rgb4 get')).toMatchObject({
      workers: [1618], osCalls: [expect.objectContaining({ library: 'graphics.library', lvo: -582 })],
    })
    expect(colour.find((row) => row.name === '_rgb32 get')).toMatchObject({
      workers: [1669], osCalls: [expect.objectContaining({ library: 'graphics.library', lvo: -900 })],
    })
    expect(colour.find((row) => row.name === '_rgb32 cm set')).toMatchObject({
      workers: [1672], osCalls: [expect.objectContaining({ library: 'graphics.library', lvo: -996 })],
    })
  })

  it('classifies all ten Copper lifecycle and beam operations', () => {
    const copper = rows.filter((row) => row.namespace === '_cop')
    expect(copper).toHaveLength(10)
    expect(copper.filter((row) => row.status === 'faithful').map((row) => row.name).sort()).toEqual([
      '_cop init view', '_cop init vport',
    ])
    expect(copper.filter((row) => row.status === 'partial')).toHaveLength(8)
    expect(copper.some((row) => row.status === 'review')).toBe(false)
    const expected = new Map<string, [number, number]>([
      ['_cop init view', [1641, -360]], ['_cop init vport', [1642, -204]],
      ['_cop load view', [1643, -222]], ['_cop make vport', [1644, -216]],
      ['_cop mrg', [1645, -210]], ['_cop scroll vport', [1646, -588]],
      ['_cop vbeam pos', [1647, -384]], ['_cop wait tof', [1648, -270]],
      ['_cop control', [1649, -708]], ['_cop wait bottom', [1650, -402]],
    ])
    for (const row of copper) {
      const evidence = expected.get(row.name)!
      expect(row.workers).toEqual([evidence[0]])
      expect(row.osCalls).toContainEqual(expect.objectContaining({ library: 'graphics.library', lvo: evidence[1] }))
    }
  })

  it('classifies all eleven classic and V39 sprite operations', () => {
    const sprite = rows.filter((row) => row.namespace === '_spr')
    expect(sprite).toHaveLength(11)
    expect(sprite.filter((row) => row.status === 'faithful').map((row) => row.name).sort()).toEqual([
      '_spr set height', '_spr set nb', '_spr set pos',
    ])
    expect(sprite.filter((row) => row.status === 'partial')).toHaveLength(8)
    expect(sprite.some((row) => row.status === 'review')).toBe(false)
    expect(sprite.find((row) => row.name === '_spr get')).toMatchObject({
      workers: [1662], osCalls: [expect.objectContaining({ library: 'graphics.library', lvo: -408 })],
    })
    expect(sprite.find((row) => row.name === '_spr a data alloc')).toMatchObject({
      workers: [1678], osCalls: [expect.objectContaining({ library: 'graphics.library', lvo: -1020 })],
    })
    expect(sprite.find((row) => row.name === '_spr a change')).toMatchObject({
      workers: [1680], osCalls: [expect.objectContaining({ library: 'graphics.library', lvo: -1026 })],
    })
    expect(sprite.find((row) => row.name === '_spr set height')?.workers).toEqual([1741])
    expect(sprite.find((row) => row.name === '_spr set nb')?.workers).toEqual([1742])
    expect(sprite.find((row) => row.name === '_spr set pos')?.workers).toEqual([1743])
  })

  it('classifies all seven blitter operations against the synchronous planar backend', () => {
    const blitter = rows.filter((row) => row.namespace === '_blt')
    expect(blitter).toHaveLength(7)
    expect(blitter.filter((row) => row.status === 'faithful').map((row) => row.name).sort()).toEqual([
      '_blt disown', '_blt own', '_blt wait',
    ])
    expect(blitter.filter((row) => row.status === 'partial').map((row) => row.name).sort()).toEqual([
      '_blt clip', '_blt clr', '_blt msk bm to rp', '_blt pattern',
    ])
    expect(blitter.some((row) => row.status === 'review')).toBe(false)
    const expected = new Map<string, [number, number]>([
      ['_blt clr', [1632, -300]], ['_blt msk bm to rp', [1633, -636]],
      ['_blt pattern', [1634, -312]], ['_blt clip', [1635, -552]],
      ['_blt disown', [1636, -462]], ['_blt own', [1637, -456]], ['_blt wait', [1638, -228]],
    ])
    for (const row of blitter) {
      const evidence = expected.get(row.name)!
      expect(row.workers).toEqual([evidence[0]])
      expect(row.osCalls).toContainEqual(expect.objectContaining({ library: 'graphics.library', lvo: evidence[1] }))
    }
  })

  it('classifies both TmpRas initialization paths and both field reads', () => {
    const names = ['_tmpras init', '_tr set', '_tr what raster', '_tr what size']
    const tmpRas = rows.filter((row) => names.includes(row.name))
    expect(tmpRas).toHaveLength(4)
    expect(tmpRas.every((row) => row.status === 'faithful')).toBe(true)
    expect(tmpRas.find((row) => row.name === '_tmpras init')).toMatchObject({
      workers: [1631], osCalls: [expect.objectContaining({ library: 'graphics.library', lvo: -468 })],
    })
    expect(tmpRas.find((row) => row.name === '_tr set')?.workers).toEqual([1710])
    expect(tmpRas.find((row) => row.name === '_tr what raster')?.workers).toEqual([1711])
    expect(tmpRas.find((row) => row.name === '_tr what size')?.workers).toEqual([1712])
  })

  it('classifies all nine resident and disk-font operations', () => {
    const font = rows.filter((row) => row.namespace === '_font')
    expect(font).toHaveLength(9)
    expect(font.filter((row) => row.status === 'faithful').map((row) => row.name).sort()).toEqual([
      '_font set', '_font soft style', '_font style',
    ])
    expect(font.filter((row) => row.status === 'partial')).toHaveLength(6)
    expect(font.some((row) => row.status === 'review')).toBe(false)
    const expected = new Map<string, [number, string, number]>([
      ['_font add', [1651, 'graphics.library', -480]], ['_font ask', [1652, 'graphics.library', -474]],
      ['_font style', [1653, 'graphics.library', -84]], ['_font close', [1654, 'graphics.library', -78]],
      ['_font open', [1655, 'graphics.library', -72]], ['_font rem', [1656, 'graphics.library', -486]],
      ['_font set', [1657, 'graphics.library', -66]], ['_font soft style', [1658, 'graphics.library', -90]],
      ['_font load', [1659, 'diskfont.library', -30]],
    ])
    for (const row of font) {
      const evidence = expected.get(row.name)!
      expect(row.workers).toEqual([evidence[0]])
      expect(row.osCalls).toContainEqual(expect.objectContaining({ library: evidence[1], lvo: evidence[2] }))
    }
  })

  it('classifies all nine area-fill and raster-allocation operations', () => {
    const names = [
      '_area draw', '_area ellipse', '_area end', '_area move', '_rp flood', '_area init', '_rp bar',
      '_rast alloc', '_rast free',
    ]
    const area = rows.filter((row) => names.includes(row.name))
    expect(area).toHaveLength(9)
    expect(area.filter((row) => row.status === 'faithful').map((row) => row.name).sort()).toEqual([
      '_area init', '_rast alloc', '_rast free', '_rp bar', '_rp flood',
    ])
    expect(area.filter((row) => row.status === 'partial').map((row) => row.name).sort()).toEqual([
      '_area draw', '_area ellipse', '_area end', '_area move',
    ])
    const expected = new Map<string, [number, number]>([
      ['_area draw', [1622, -258]], ['_area ellipse', [1623, -186]], ['_area end', [1624, -264]],
      ['_area move', [1625, -252]], ['_rp flood', [1626, -330]], ['_area init', [1627, -282]],
      ['_rp bar', [1628, -306]], ['_rast alloc', [1629, -492]], ['_rast free', [1630, -498]],
    ])
    for (const row of area) {
      const evidence = expected.get(row.name)!
      expect(row.workers).toEqual([evidence[0]])
      expect(row.osCalls).toContainEqual(expect.objectContaining({ library: 'graphics.library', lvo: evidence[1] }))
    }
  })

  it('classifies all fourteen direct RastPort structure operations', () => {
    const names = [
      '_rp set layer', '_rp set bmap', '_rp set tmpras', '_rp set area info', '_rp set o pen', '_rp set line',
      '_rp set wr msk', '_rp what layer', '_rp what bmap', '_rp what tmpras', '_rp what area info',
      '_rp what text base', '_rp what xgr', '_rp what ygr',
    ]
    const fields = rows.filter((row) => names.includes(row.name))
    expect(fields).toHaveLength(14)
    expect(fields.every((row) => row.status === 'faithful')).toBe(true)
    expect(fields.map((row) => row.workers[0])).toEqual([
      1696, 1697, 1698, 1699, 1700, 1701, 1702, 1703, 1704, 1705, 1706, 1707, 1708, 1709,
    ])
    expect(fields.every((row) => row.osCalls.length === 0)).toBe(true)
  })

  it('classifies all fifteen classic RastPort drawing operations', () => {
    const names = [
      '_rp move', '_rp a pen', '_rp b pen', '_rp dr md', '_rp rast', '_rp clr eol', '_rp clr scr',
      '_rp draw', '_rp poly draw', '_rp ellipse', '_rp point', '_rp plot', '_rp scroll', '_rp text', '_rp len text',
    ]
    const drawing = rows.filter((row) => names.includes(row.name))
    expect(drawing).toHaveLength(15)
    expect(drawing.filter((row) => row.status === 'faithful').map((row) => row.name).sort()).toEqual([
      '_rp a pen', '_rp b pen', '_rp dr md', '_rp draw', '_rp ellipse', '_rp len text', '_rp move',
      '_rp plot', '_rp point', '_rp rast', '_rp text',
    ])
    expect(drawing.filter((row) => row.status === 'partial').map((row) => row.name).sort()).toEqual([
      '_rp clr eol', '_rp clr scr', '_rp poly draw', '_rp scroll',
    ])
    const expected = new Map<string, [number, number]>([
      ['_rp move', [1603, -240]], ['_rp a pen', [1604, -342]], ['_rp b pen', [1605, -348]],
      ['_rp dr md', [1606, -354]], ['_rp rast', [1607, -234]], ['_rp clr eol', [1608, -42]],
      ['_rp clr scr', [1609, -48]], ['_rp draw', [1610, -246]], ['_rp poly draw', [1611, -336]],
      ['_rp ellipse', [1612, -180]], ['_rp point', [1613, -318]], ['_rp plot', [1614, -324]],
      ['_rp scroll', [1615, -396]], ['_rp text', [1616, -60]], ['_rp len text', [1617, -54]],
    ])
    for (const row of drawing) {
      const evidence = expected.get(row.name)!
      expect(row.workers).toEqual([evidence[0]])
      expect(row.osCalls).toContainEqual(expect.objectContaining({ library: 'graphics.library', lvo: evidence[1] }))
    }
  })

  it('finishes the graphics audit with scaling and V39 RastPort operations', () => {
    const names = ['_scale bm', '_scale div', '_rp wr msk', '_rp bf scroll', '_rp o pen', '_rp what attrs', '_rp set attrs']
    const finalGraphics = rows.filter((row) => names.includes(row.name))
    expect(finalGraphics).toHaveLength(7)
    expect(finalGraphics.filter((row) => row.status === 'faithful').map((row) => row.name).sort()).toEqual([
      '_rp o pen', '_rp wr msk',
    ])
    expect(finalGraphics.filter((row) => row.status === 'partial')).toHaveLength(5)
    const expected = new Map<string, [number, number]>([
      ['_scale bm', [1639, -678]], ['_scale div', [1640, -684]], ['_rp wr msk', [1666, -984]],
      ['_rp bf scroll', [1667, -1002]], ['_rp o pen', [1668, -978]],
      ['_rp what attrs', [1676, -1044]], ['_rp set attrs', [1677, -1038]],
    ])
    for (const row of finalGraphics) {
      const evidence = expected.get(row.name)!
      expect(row.workers).toEqual([evidence[0]])
      expect(row.osCalls).toContainEqual(expect.objectContaining({ library: 'graphics.library', lvo: evidence[1] }))
    }
    expect(rows.some((row) => row.status === 'review' && row.family === 'graphics')).toBe(false)
  })

  it('classifies all three DateStamp-to-string wrappers', () => {
    const names = ['_dos day$', '_dos date$', '_dos time$']
    const dates = rows.filter((row) => names.includes(row.name))
    expect(dates).toHaveLength(3)
    expect(dates.every((row) => row.status === 'partial')).toBe(true)
    expect(dates.map((row) => row.workers[0])).toEqual([1845, 1846, 1847])
    for (const row of dates) {
      expect(row.osCalls).toContainEqual(expect.objectContaining({ library: 'dos.library', lvo: -192 }))
      expect(row.osCalls).toContainEqual(expect.objectContaining({ library: 'dos.library', lvo: -744 }))
    }
  })

  it('classifies DOS locks, path parts, current directory and existence', () => {
    const names = [
      '_dos lock', '_dos unlock', '_dos l open', '_dos l name', '_dos dir',
      '_dos add part', '_dos file part', '_dos path part', '_file part', '_lock name$',
      '_dos what dir$', '_dos rd lock', '_dos wr lock', '_dos set dir$', '_dos exist',
    ]
    const paths = rows.filter((row) => names.includes(row.name))
    expect(paths).toHaveLength(15)
    expect(paths.filter((row) => row.status === 'faithful').map((row) => row.name).sort()).toEqual([
      '_dos exist', '_dos set dir$', '_dos what dir$', '_file part',
    ])
    expect(paths.filter((row) => row.status === 'partial')).toHaveLength(11)

    const expected = new Map<string, [number, number]>([
      ['_dos lock', [1826, -84]], ['_dos unlock', [1827, -90]],
      // Despite its guide saying "Lock Handle in File Handle", this worker
      // calls ParentDir. The binary, not that stale sentence, is authoritative.
      ['_dos l open', [1828, -378]], ['_dos l name', [1829, -402]],
      ['_dos dir', [1830, -126]], ['_dos add part', [1836, -882]],
      ['_dos file part', [1837, -870]], ['_dos path part', [1838, -876]],
    ])
    for (const [name, [worker, lvo]] of expected) {
      expect(paths.find((row) => row.name === name)).toMatchObject({
        workers: [worker], osCalls: [expect.objectContaining({ library: 'dos.library', lvo })],
      })
    }
    expect(paths.find((row) => row.name === '_dos rd lock')?.workers).toEqual([1831])
    expect(paths.find((row) => row.name === '_dos wr lock')?.workers).toEqual([1832])
    expect(paths.find((row) => row.name === '_lock name$')?.workers).toEqual([1833])
    expect(paths.find((row) => row.name === '_dos what dir$')?.workers).toEqual([1834])
    expect(paths.find((row) => row.name === '_dos set dir$')?.workers).toEqual([1835])
    expect(paths.find((row) => row.name === '_file part')?.workers).toEqual([1840])
    expect(paths.find((row) => row.name === '_dos exist')?.workers).toEqual([1816])
  })

  it('classifies DOS file handles, buffered I/O and error state', () => {
    const ioNames = [
      '_dos open', '_dos close', '_dos seek', '_dos read', '_dos write', '_dos f getc', '_dos f gets',
      '_dos f putc', '_dos f puts', '_dos f ungetc', '_dos mode', '_dos f name', '_dos opin', '_dos opout',
      '_dos append', '_dos print', '_dos input', '_dos eof', '_dos lof', '_fh name$',
    ]
    const io = rows.filter((row) => ioNames.includes(row.name))
    expect(io).toHaveLength(20)
    expect(io.every((row) => row.status === 'partial')).toBe(true)

    const direct = new Map<string, [number, number]>([
      ['_dos open', [1801, -30]], ['_dos close', [1802, -36]], ['_dos seek', [1806, -66]],
      ['_dos read', [1811, -42]], ['_dos write', [1812, -48]], ['_dos f getc', [1818, -306]],
      ['_dos f gets', [1819, -336]], ['_dos f putc', [1820, -312]], ['_dos f puts', [1821, -342]],
      ['_dos f ungetc', [1822, -318]], ['_dos mode', [1823, -450]], ['_dos f name', [1824, -408]],
    ])
    for (const [name, [worker, lvo]] of direct) {
      expect(io.find((row) => row.name === name)).toMatchObject({
        workers: [worker], osCalls: [expect.objectContaining({ library: 'dos.library', lvo })],
      })
    }
    const local = new Map<string, number>([
      ['_dos opin', 1803], ['_dos opout', 1804], ['_dos append', 1805], ['_dos print', 1813],
      ['_dos input', 1814], ['_dos eof', 1815], ['_dos lof', 1817], ['_fh name$', 1825],
    ])
    for (const [name, worker] of local) expect(io.find((row) => row.name === name)?.workers).toEqual([worker])

    const errors = rows.filter((row) => ['_dos err', '_dos report', '_dos fault', '_dos set err'].includes(row.name))
    expect(errors).toHaveLength(4)
    expect(errors.find((row) => row.name === '_dos err')).toMatchObject({
      status: 'missing', workers: [1807], osCalls: [expect.objectContaining({ library: 'dos.library', lvo: -132 })],
    })
    expect(errors.find((row) => row.name === '_dos report')).toMatchObject({
      status: 'missing', workers: [1808], osCalls: [expect.objectContaining({ library: 'dos.library', lvo: -480 })],
    })
    expect(errors.find((row) => row.name === '_dos fault')).toMatchObject({
      status: 'partial', workers: [1809], osCalls: [expect.objectContaining({ library: 'dos.library', lvo: -468 })],
    })
    expect(errors.find((row) => row.name === '_dos set err')).toMatchObject({
      status: 'missing', workers: [1810], osCalls: [expect.objectContaining({ library: 'dos.library', lvo: -462 })],
    })
  })

  it('finishes the DOS audit with segments, processes and notifications', () => {
    const names = [
      '_dos seg load', '_dos seg unload', '_dos new proc',
      '_dos sig notify', '_dos msg notify', '_dos end notify',
    ]
    const finalDos = rows.filter((row) => names.includes(row.name))
    expect(finalDos).toHaveLength(6)
    expect(finalDos.every((row) => row.status === 'partial')).toBe(true)

    const process = new Map<string, [number, number]>([
      ['_dos seg load', [1842, -768]], ['_dos seg unload', [1843, -156]], ['_dos new proc', [1844, -498]],
    ])
    for (const [name, [worker, lvo]] of process) {
      expect(finalDos.find((row) => row.name === name)).toMatchObject({
        workers: [worker], osCalls: [expect.objectContaining({ library: 'dos.library', lvo })],
      })
    }

    expect(finalDos.find((row) => row.name === '_dos sig notify')).toMatchObject({
      workers: [1854],
      osCalls: [
        expect.objectContaining({ library: 'exec.library', lvo: -684 }),
        expect.objectContaining({ library: 'dos.library', lvo: -888 }),
        expect.objectContaining({ library: 'exec.library', lvo: -690 }),
      ],
    })
    expect(finalDos.find((row) => row.name === '_dos msg notify')).toMatchObject({
      workers: [1855],
      osCalls: [
        expect.objectContaining({ library: 'exec.library', lvo: -684 }),
        expect.objectContaining({ library: 'dos.library', lvo: -888 }),
        expect.objectContaining({ library: 'exec.library', lvo: -690 }),
      ],
    })
    expect(finalDos.find((row) => row.name === '_dos end notify')).toMatchObject({
      workers: [1856],
      osCalls: [
        expect.objectContaining({ library: 'dos.library', lvo: -894 }),
        expect.objectContaining({ library: 'exec.library', lvo: -690 }),
      ],
    })
    expect(rows.some((row) => row.status === 'review' && row.family === 'dos')).toBe(false)
  })

  it('classifies NotifyRequest user data and Workbench program identity', () => {
    expect(rows.find((row) => row.name === '_nr what user')).toMatchObject({
      status: 'faithful', workers: [1858], osCalls: [],
    })
    expect(rows.find((row) => row.name === '_prg dir$')).toMatchObject({
      // 1859 reaches NameFromLock indirectly through local worker 1829;
      // osCalls deliberately records only calls in the resolved worker.
      status: 'partial', workers: [1859], osCalls: [],
    })
    expect(rows.find((row) => row.name === '_prg name$')).toMatchObject({
      status: 'partial', workers: [1860], osCalls: [],
    })
  })

  it('classifies all channel-list fields and algorithms', () => {
    const channel = rows.filter((row) => row.namespace === '_chn')
    expect(channel).toHaveLength(25)
    expect(channel.filter((row) => row.status === 'faithful')).toHaveLength(24)
    expect(channel.find((row) => row.name === '_chn new length')).toMatchObject({
      status: 'partial', workers: [1142], osCalls: [],
    })
    const singleWorkers = new Map<string, number>([
      ['_chn set number', 1122], ['_chn set default', 1123], ['_chn set first', 1124],
      ['_chn set last', 1125], ['_chn set list', 1126], ['_chn set length', 1127],
      ['_chn set next', 1128], ['_chn set previous', 1129], ['_chn what number', 1130],
      ['_chn what default', 1131], ['_chn what first', 1132], ['_chn what last', 1133],
      ['_chn what list', 1134], ['_chn what length', 1135], ['_chn what next', 1136],
      ['_chn what previous', 1137], ['_chn list alloc', 1138], ['_chn location', 1140],
      ['_chn find', 1141], ['_chn list free', 1145], ['_chn swap', 1151],
    ])
    for (const [name, worker] of singleWorkers) {
      expect(channel.find((row) => row.name === name)).toMatchObject({ workers: [worker], osCalls: [] })
    }
    expect(channel.find((row) => row.name === '_chn add')?.workers).toEqual([1139, 1146])
    expect(channel.find((row) => row.name === '_chn free')?.workers).toEqual([1143, 1144])
    expect(channel.find((row) => row.name === '_chn ins')?.workers).toEqual([1147, 1148, 1149, 1150])
    expect(channel.some((row) => row.status === 'review')).toBe(false)
  })

  it('classifies Dots arrays and the packed BooleanInfo record', () => {
    const dots = rows.filter((row) => row.namespace === '_dots')
    expect(dots).toHaveLength(5)
    expect(dots.every((row) => row.status === 'faithful')).toBe(true)
    expect(dots.map((row) => row.workers[0])).toEqual([1384, 1385, 1783, 1386, 1387])
    expect(dots.find((row) => row.name === '_dots free')?.osCalls).toContainEqual(
      expect.objectContaining({ library: 'exec.library', lvo: -690 }),
    )

    const boolean = rows.filter((row) => row.namespace === '_bi')
    expect(boolean).toHaveLength(5)
    expect(boolean.every((row) => row.status === 'faithful')).toBe(true)
    expect(boolean.map((row) => row.workers[0])).toEqual([1404, 1405, 1406, 1407, 1408])
    expect(boolean.every((row) => row.osCalls.length === 0)).toBe(true)
  })

  it('classifies V39 pen, mode-selection and IVG operations', () => {
    const expected = new Map<string, [number, number]>([
      ['_pen find', [1682, -1008]], ['_pen obtain best', [1683, -840]],
      ['_pen obtain', [1684, -954]], ['_pen release', [1685, -948]],
      ['_pen set max', [1686, -990]], ['_calc ivg', [1687, -828]],
      ['_mode best id', [1788, -1050]], ['_mode coerce', [1789, -936]],
    ])
    const operations = rows.filter((row) => expected.has(row.name))
    expect(operations).toHaveLength(8)
    expect(operations.every((row) => row.status === 'partial')).toBe(true)
    for (const row of operations) {
      const [worker, lvo] = expected.get(row.name)!
      expect(row).toMatchObject({
        workers: [worker], osCalls: [expect.objectContaining({ library: 'graphics.library', lvo })],
      })
    }
  })

  it('classifies all four internal resource-tracker workers', () => {
    const tracker = rows.filter((row) => row.namespace === 'track')
    expect(tracker).toHaveLength(4)
    expect(tracker.every((row) => row.status === 'faithful')).toBe(true)
    expect(tracker.find((row) => row.name === 'track set')?.workers).toEqual([1883])
    expect(tracker.find((row) => row.name === 'track unset')?.workers).toEqual([1884])
    expect(tracker.find((row) => row.name === 'track exist')?.workers).toEqual([1885])
    expect(tracker.find((row) => row.name === 'track add')).toMatchObject({
      workers: [1886],
      osCalls: [
        expect.objectContaining({ library: 'exec.library', lvo: -684 }),
        expect.objectContaining({ library: 'exec.library', lvo: -690 }),
      ],
    })
  })

  it('classifies bootstrap names, register frames and native call hooks', () => {
    expect(rows.find((row) => row.name === '_dreg')).toMatchObject({
      status: 'partial', routines: [38, 39], workers: [38, 39], osCalls: [],
    })
    expect(rows.find((row) => row.name === '_areg')).toMatchObject({
      status: 'partial', routines: [40, 41], workers: [40, 41], osCalls: [],
    })
    expect(rows.find((row) => row.name === '_call')).toMatchObject({ status: 'missing', workers: [43] })
    expect(rows.find((row) => row.name === '_amos name')).toMatchObject({ status: 'partial', workers: [1478] })
    expect(rows.find((row) => row.name === '_low init')).toMatchObject({
      status: 'faithful', routines: [], workers: [], osCalls: [],
    })
    expect(rows.find((row) => row.name === 'a3 pointer')).toMatchObject({ status: 'missing', workers: [3232] })
    expect(rows.find((row) => row.name === 'give me')).toMatchObject({ status: 'missing', workers: [45] })
  })

  it('finishes every non-Intuition family with BOOPSI and miscellaneous calls', () => {
    const statuses = new Map<string, 'faithful' | 'partial' | 'missing'>([
      ['_alert', 'missing'], ['_rfsh begin', 'partial'], ['_rfsh end', 'partial'],
      ['_query overscan', 'partial'], ['_obj new', 'partial'], ['_obj free', 'faithful'],
      ['_obj what attr', 'faithful'], ['_obj set attrs', 'partial'], ['_obj do', 'partial'],
      ['_class get file', 'missing'], ['_print', 'partial'], ['_request choice', 'partial'],
      ['reserve as gt gadgets', 'partial'], ['reserve as gt menus', 'partial'], ['_bob blit', 'partial'],
    ])
    const operations = rows.filter((row) => statuses.has(row.name))
    expect(operations).toHaveLength(15)
    for (const row of operations) expect(row.status, row.name).toBe(statuses.get(row.name))

    const direct = new Map<string, [number, string, number]>([
      ['_alert', [1569, 'exec.library', -108]], ['_rfsh begin', [1577, 'intuition.library', -354]],
      ['_rfsh end', [1578, 'intuition.library', -366]], ['_query overscan', [1593, 'intuition.library', -474]],
      ['_obj new', [1887, 'intuition.library', -636]], ['_obj free', [1888, 'intuition.library', -642]],
      ['_obj what attr', [1889, 'intuition.library', -654]],
      ['_obj set attrs', [1890, 'intuition.library', -660]], ['_obj do', [1891, 'intuition.library', -810]],
      ['_print', [1897, 'dos.library', -948]], ['_bob blit', [44, 'graphics.library', -456]],
    ])
    for (const [name, [worker, library, lvo]] of direct) {
      expect(rows.find((row) => row.name === name)).toMatchObject({
        workers: [worker], osCalls: expect.arrayContaining([expect.objectContaining({ library, lvo })]),
      })
    }
    expect(rows.find((row) => row.name === '_class get file')).toMatchObject({
      workers: [1892], osCalls: expect.arrayContaining([
        expect.objectContaining({ library: 'intuition.library', lvo: -678 }),
        expect.objectContaining({ library: 'intuition.library', lvo: -36 }),
        expect.objectContaining({ library: 'intuition.library', lvo: -120 }),
        expect.objectContaining({ library: 'intuition.library', lvo: -108 }),
      ]),
    })
    expect(rows.find((row) => row.name === '_request choice')?.workers).toEqual([1576])
    expect(rows.find((row) => row.name === 'reserve as gt gadgets')?.workers).toEqual([3115])
    expect(rows.find((row) => row.name === 'reserve as gt menus')?.workers).toEqual([3172])
    expect(rows.filter((row) => row.status === 'review' && row.family !== 'intuition')).toEqual([])
  })

  it('classifies all 28 native Gadget operations', () => {
    const gadgets = rows.filter((row) => row.namespace === '_gad')
    expect(gadgets).toHaveLength(28)
    expect(gadgets.filter((row) => row.status === 'faithful')).toHaveLength(21)
    expect(gadgets.filter((row) => row.status === 'partial')).toHaveLength(7)
    const calls = new Map<string, [number, number]>([
      ['_gad activate', [1333, -462]], ['_gad add', [1334, -438]],
      ['_gad modif prop', [1335, -468]], ['_gad off', [1336, -174]],
      ['_gad on', [1337, -186]], ['_gad refresh', [1338, -432]],
      ['_gad remove', [1339, -444]],
    ])
    for (const [name, [worker, lvo]] of calls) {
      expect(gadgets.find((row) => row.name === name)).toMatchObject({
        status: 'partial', workers: [worker],
        osCalls: [expect.objectContaining({ library: 'intuition.library', lvo })],
      })
    }
    const fieldWorkers = gadgets.filter((row) => row.status === 'faithful').map((row) => row.workers[0])
    expect(fieldWorkers).toEqual([
      1326, 1327, 1328, 1329, 1330, 1331, 1332,
      1340, 1341, 1342, 1343, 1344, 1345, 1346, 1347, 1348, 1349, 1350, 1351, 1352, 1353,
    ])
    expect(gadgets.some((row) => row.status === 'review')).toBe(false)
  })

  it('classifies retained screen definitions and direct public Screen fields', () => {
    const faithful = [
      '_scr def body', '_scr def pens', '_scr def title', '_scr def font', '_scr def bmap',
      '_scr def vmodes', '_scr def type', '_scr set title', '_scr set def title',
      '_scr what next', '_scr what title', '_scr what def title', '_scr what bmap', '_scr what first wnd',
      '_scr what font', '_scr what layer', '_scr what width', '_scr what height', '_scr what depth',
      '_scr what d pen', '_scr what b pen', '_scr what x mouse', '_scr what y mouse', '_scr what barh',
      '_scr what vmodes', '_scr what type', '_scr wdef title', '_scr wdef bmap', '_scr wdef vmodes',
      '_scr wdef type', '_scr wdef font',
    ]
    const interior = ['_scr what front', '_scr what active', '_scr what vport', '_scr what rport', '_scr what layer info']
    expect(rows.filter((row) => faithful.includes(row.name)).every((row) => row.status === 'faithful')).toBe(true)
    expect(rows.filter((row) => interior.includes(row.name)).every((row) => row.status === 'partial')).toBe(true)
    expect(rows.filter((row) => faithful.includes(row.name))).toHaveLength(31)
    expect(rows.filter((row) => interior.includes(row.name))).toHaveLength(5)
    const expected = new Map<string, number>([
      ['_scr def body', 1158], ['_scr def pens', 1159], ['_scr def font', 1160],
      ['_scr def bmap', 1161], ['_scr def vmodes', 1162], ['_scr def type', 1163],
      ['_scr def title', 1164], ['_scr set title', 1165], ['_scr set def title', 1166],
      ['_scr what front', 1192], ['_scr what next', 1193], ['_scr what active', 1194],
      ['_scr what vport', 1197], ['_scr what rport', 1198], ['_scr what layer info', 1202],
      ['_scr wdef font', 1218],
    ])
    for (const [name, worker] of expected) expect(rows.find((row) => row.name === name)?.workers).toEqual([worker])
  })

  it('classifies all 17 low-level screen lifecycle and public-screen operations', () => {
    const calls = new Map<string, [number[], number]>([
      ['_scr def pub', [[1167], -540]], ['_scr open', [[1168, 1169, 1170, 1171], -198]],
      ['_scr tag open', [[1172, 1173], -612]], ['_scr close', [[1174], -66]],
      ['_scr beep', [[1175], -96]], ['_scr move', [[1176], -162]],
      ['_scr to back', [[1177], -246]], ['_scr to front', [[1178], -252]],
      ['_scr position', [[1179], -792]], ['_scr show title', [[1180], -282]],
      ['_scr hide title', [[1181], -282]], ['_scr dinf get', [[1182], -690]],
      ['_scr dinf free', [[1183], -696]], ['_scr pub lock', [[1184], -510]],
      ['_scr pub unlock', [[1185], -516]], ['_scr pub modes', [[1186], -546]],
      ['_scr pub status', [[1187], -552]],
    ])
    for (const [name, [workers, lvo]] of calls) {
      expect(rows.find((row) => row.name === name)).toMatchObject({
        status: 'partial', workers,
        osCalls: [expect.objectContaining({ library: 'intuition.library', lvo })],
      })
    }
  })

  it('classifies every high-level screen-ID wrapper and its indirect worker', () => {
    const workers = new Map<string, number>([
      ['_scr id open', 2987], ['_scr id close', 2988], ['_scr id tag open', 2989],
      ['_scr id base', 2990], ['_scr id rport', 2991], ['_scr id vport', 2992],
      ['_scr id show', 2993], ['_scr id hide', 2994], ['_scr id from wb', 2995],
      ['_scr id from pub', 2996], ['_scr id from pointer', 2997], ['_scr id beep', 2998],
      ['_scr id move', 2999], ['_scr id offset', 3000], ['_scr id get pal', 3001],
      ['_scr id set pal', 3002], ['_scr id get aga pal', 3003], ['_scr id set aga pal', 3004],
      ['_scr id def dri pens v1', 3005], ['_scr id def dri pens v2', 3006],
      ['_scr id fix dri pens', 3007], ['_scr id use', 3008], ['_scr id in use', 3009],
      ['_scr id x mouse', 3010], ['_scr id y mouse', 3011], ['_scr id set mouse pos', 3012],
      ['_scr id height', 3013], ['_scr id width', 3014], ['_scr id mode', 3015],
      ['_scr id depth', 3016], ['_scr id clip', 3017], ['_scr id cls', 3020],
      ['_scr id ink', 3021], ['_scr id gr writing', 3022], ['_scr id plot', 3023],
      ['_scr id set line', 3024], ['_scr id rect', 3025], ['_scr id line to', 3026],
      ['_scr id line', 3027], ['_scr id ellipse', 3028], ['_scr id gr locate', 3029],
      ['_scr id set paint', 3030], ['_scr id pattern on', 3031], ['_scr id pattern off', 3032],
      ['_scr id set low pattern', 3033], ['_scr id set high pattern', 3034],
      ['_scr id paint', 3035], ['_scr id bar', 3036], ['_scr id fill ellipse', 3037],
      ['_scr id text', 3038], ['_scr id point', 3039], ['_scr id scroll', 3040],
      ['_scr id put bob', 3041],
    ])
    const idRows = rows.filter((row) => row.name.startsWith('_scr id '))
    expect(idRows).toHaveLength(55)
    expect(workers.size).toBe(53)
    for (const [name, worker] of workers) expect(rows.find((row) => row.name === name)?.workers).toEqual([worker])
    expect(rows.find((row) => row.name === '_scr id colour')).toMatchObject({ workers: [3002, 3001] })
    expect(rows.find((row) => row.name === '_scr id aga colour')).toMatchObject({ workers: [3004, 3003] })
    expect(idRows.filter((row) => row.status === 'faithful').map((row) => row.name).sort()).toEqual([
      '_scr id def dri pens v1', '_scr id def dri pens v2',
    ])
    expect(idRows.filter((row) => row.status === 'partial')).toHaveLength(53)
    expect(idRows.some((row) => row.status === 'review')).toBe(false)
    expect(rows.find((row) => row.name === '_scr id set mouse pos')?.osCalls).toEqual([
      expect.objectContaining({ library: 'exec.library', lvo: -456 }),
    ])
  })

  it('classifies every low-level Window definition, field and operation', () => {
    const low = rows.filter((row) => row.namespace === '_wnd' && !row.name.startsWith('_wnd id '))
    expect(low).toHaveLength(96)
    expect(low.filter((row) => row.status === 'faithful')).toHaveLength(72)
    expect(low.filter((row) => row.status === 'partial')).toHaveLength(24)
    expect(low.some((row) => row.status === 'review')).toBe(false)

    const definitions = [
      '_wnd def body', '_wnd def limits', '_wnd def pens', '_wnd def idcmp', '_wnd def flags', '_wnd def gad',
      '_wnd def image', '_wnd def title', '_wnd def scr', '_wnd def type', '_wnd def bmap',
    ]
    definitions.forEach((name, i) => expect(rows.find((row) => row.name === name)?.workers).toEqual([1219 + i]))
    const wdefs = [
      '_wnd wdef left', '_wnd wdef top', '_wnd wdef width', '_wnd wdef height', '_wnd wdef d pen',
      '_wnd wdef b pen', '_wnd wdef idcmp', '_wnd wdef flags', '_wnd wdef gad', '_wnd wdef image',
      '_wnd wdef title', '_wnd wdef scr', '_wnd wdef min width', '_wnd wdef min height',
      '_wnd wdef max width', '_wnd wdef max height', '_wnd wdef type', '_wnd wdef bmap',
    ]
    wdefs.forEach((name, i) => expect(rows.find((row) => row.name === name)?.workers).toEqual([1301 + i]))

    const fieldWorkers = new Map<string, number>([
      ['_wnd what front', 1257], ['_wnd what scr', 1258], ['_wnd what next', 1259],
      ['_wnd what title', 1260], ['_wnd what rport', 1261], ['_wnd what left', 1262],
      ['_wnd what top', 1263], ['_wnd what width', 1264], ['_wnd what height', 1265],
      ['_wnd what x mouse', 1266], ['_wnd what y mouse', 1267], ['_wnd what min width', 1268],
      ['_wnd what min height', 1269], ['_wnd what max width', 1270], ['_wnd what max height', 1271],
      ['_wnd what flags', 1272], ['_wnd what menu', 1273], ['_wnd what first req', 1274],
      ['_wnd what dm req', 1275], ['_wnd what count req', 1276], ['_wnd what bdr left', 1277],
      ['_wnd what bdr top', 1278], ['_wnd what bdr right', 1279], ['_wnd what bdr bottom', 1280],
      ['_wnd what first gad', 1281], ['_wnd what parent', 1282], ['_wnd what descendant', 1283],
      ['_wnd what pointer height', 1285], ['_wnd what pointer width', 1286],
      ['_wnd what pointer xoff', 1287], ['_wnd what pointer yoff', 1288], ['_wnd what idcmp', 1289],
      ['_wnd what user port', 1290], ['_wnd what port', 1291], ['_wnd what int msg', 1292],
      ['_wnd what d pen', 1293], ['_wnd what b pen', 1294], ['_wnd what image', 1295],
      ['_wnd what user data', 1296], ['_wnd what ext data', 1297], ['_wnd what layer', 1298],
      ['_wnd what font', 1299], ['_wnd what scr title', 1300],
    ])
    for (const [name, worker] of fieldWorkers) expect(rows.find((row) => row.name === name)).toMatchObject({
      status: 'faithful', workers: [worker],
    })
    expect(rows.find((row) => row.name === '_wnd what pointer')).toMatchObject({ status: 'partial', workers: [1284] })
    expect(rows.find((row) => row.name === '_wnd what active')).toMatchObject({ status: 'partial', workers: [1256] })
    expect(rows.find((row) => row.name === '_wnd what vport')).toMatchObject({
      status: 'partial', workers: [1591],
      osCalls: [expect.objectContaining({ library: 'intuition.library', lvo: -300 })],
    })

    const calls = new Map<string, [number[], string, number]>([
      ['_wnd set titles', [[1230], 'intuition.library', -276]],
      ['_wnd set pointera', [[1231], 'intuition.library', -816]],
      ['_wnd set limits', [[1232], 'intuition.library', -318]],
      ['_wnd set idcmp', [[1233], 'intuition.library', -150]],
      ['_wnd open', [[1234, 1235, 1236, 1237], 'intuition.library', -204]],
      ['_wnd tag open', [[1238, 1239], 'intuition.library', -606]],
      ['_wnd close', [[1240], 'intuition.library', -54]],
      ['_wnd activate', [[1241], 'intuition.library', -450]],
      ['_wnd move', [[1247], 'intuition.library', -168]],
      ['_wnd box', [[1248], 'intuition.library', -486]],
      ['_wnd size', [[1249], 'intuition.library', -288]],
      ['_wnd refresh frame', [[1250], 'intuition.library', -456]],
      ['_wnd to back', [[1251], 'intuition.library', -306]],
      ['_wnd to front', [[1252], 'intuition.library', -312]],
      ['_wnd in front of', [[1253], 'intuition.library', -480]],
      ['_wnd scroll raster', [[1254], 'intuition.library', -798]],
      ['_wnd zip', [[1255], 'intuition.library', -504]],
      ['_wnd wait port', [[1244], 'gadtools.library', -72]],
      ['_wnd clear port', [[1243], 'exec.library', -252]],
      ['_wnd share port', [[1245], 'intuition.library', -150]],
      ['_wnd unshare port', [[1242], 'intuition.library', -150]],
    ])
    for (const [name, [workers, library, lvo]] of calls) expect(rows.find((row) => row.name === name)).toMatchObject({
      status: 'partial', workers, osCalls: expect.arrayContaining([expect.objectContaining({ library, lvo })]),
    })
  })

  it('classifies all 69 high-level Window-ID records, events and delegates', () => {
    const expected = new Map<string, number[]>([
      ['_wnd id open', [3043]], ['_wnd id close', [3045]], ['_wnd id tag open', [3044]],
      ['_wnd id base', [3048]], ['_wnd id use', [3049]], ['_wnd id in use', [3050]],
      ['_wnd id wait event', [3055]], ['_wnd id event wnd', [3057]], ['_wnd id event code', [3058]],
      ['_wnd id event qualifier', [3059]], ['_wnd id event gadget', [3060]],
      ['_wnd id event menu', [3062]], ['_wnd id event item', [3063]], ['_wnd id event sub', [3064]],
      ['_wnd id event next menu', [3065]], ['_wnd id event x mouse', [3066]],
      ['_wnd id event y mouse', [3067]], ['_wnd id limits', [3068]], ['_wnd id move', [3069]],
      ['_wnd id size', [3070]], ['_wnd id box', [3071]], ['_wnd id titles', [3072]],
      ['_wnd id activate', [3073]], ['_wnd id x mouse', [3074]], ['_wnd id y mouse', [3075]],
      ['_wnd id xgr', [3077]], ['_wnd id ygr', [3078]], ['_wnd id x', [3079]], ['_wnd id y', [3080]],
      ['_wnd id width', [3081]], ['_wnd id height', [3082]], ['_wnd id top bdr', [3083]],
      ['_wnd id bottom bdr', [3084]], ['_wnd id left bdr', [3085]], ['_wnd id right bdr', [3086]],
      ['_wnd id inner width', [3087]], ['_wnd id inner height', [3088]],
      ['_wnd id inner x mouse', [3089]], ['_wnd id inner y mouse', [3090]],
      ['_wnd id plot', [3091]], ['_wnd id rect', [3092]], ['_wnd id line to', [3093]],
      ['_wnd id line', [3094]], ['_wnd id ellipse', [3095]], ['_wnd id cls', [3096]],
      ['_wnd id ink', [3097]], ['_wnd id gr writing', [3098]], ['_wnd id text', [3099]],
      ['_wnd id bar', [3100]], ['_wnd id gr locate', [3101]], ['_wnd id paint', [3102]],
      ['_wnd id fill ellipse', [3103]], ['_wnd id set paint', [3104]],
      ['_wnd id pattern on', [3105]], ['_wnd id pattern off', [3106]],
      ['_wnd id set low pattern', [3107]], ['_wnd id set high pattern', [3108]],
      ['_wnd id set line', [3109]], ['_wnd id point', [3110]], ['_wnd id scroll', [3111]],
      ['_wnd id put bob', [3112]], ['_wnd id lock', [3052]], ['_wnd id unlock', [3051]],
      ['_wnd id next event', [3056]], ['_wnd id mouse', [3053]], ['_wnd id data', [3046, 3047]],
      ['_wnd id event gt bank', [3061]], ['_wnd id mask event', [3054]],
      ['_wnd id set mouse pos', [3076]],
    ])
    const idRows = rows.filter((row) => row.name.startsWith('_wnd id '))
    expect(expected.size).toBe(69)
    expect(idRows).toHaveLength(69)
    for (const [name, workers] of expected) expect(rows.find((row) => row.name === name)?.workers).toEqual(workers)
    expect(idRows.filter((row) => row.status === 'faithful')).toHaveLength(54)
    expect(idRows.filter((row) => row.status === 'partial')).toHaveLength(15)
    expect(idRows.some((row) => row.status === 'review')).toBe(false)
    expect(rows.find((row) => row.name === '_wnd id set mouse pos')?.osCalls).toEqual([
      expect.objectContaining({ library: 'exec.library', lvo: -456 }),
    ])
  })

  it('classifies DOS variables and includes both unnamed CLI reader overloads', () => {
    const variables = rows.filter((row) => row.name.startsWith('_dos var '))
    expect(variables).toHaveLength(3)
    expect(variables.every((row) => row.status === 'partial')).toBe(true)
    expect(variables.find((row) => row.name === '_dos var del')).toMatchObject({
      workers: [34], osCalls: [expect.objectContaining({ library: 'dos.library', lvo: -912 })],
    })
    expect(variables.find((row) => row.name === '_dos var find')).toMatchObject({
      workers: [35], osCalls: [expect.objectContaining({ library: 'dos.library', lvo: -918 })],
    })
    expect(variables.find((row) => row.name === '_dos var value$')).toMatchObject({ workers: [36, 37] })

    const cli = rows.filter((row) => row.namespace === '_cli')
    expect(cli).toHaveLength(3)
    expect(cli.every((row) => row.status === 'partial')).toBe(true)
    expect(cli.find((row) => row.name === '_cli read args')).toMatchObject({
      routines: [791], workers: [1861],
      osCalls: [
        expect.objectContaining({ library: 'dos.library', lvo: -858 }),
        expect.objectContaining({ library: 'dos.library', lvo: -798 }),
      ],
    })
    expect(cli.find((row) => row.name === '_cli what arg$')).toMatchObject({
      routines: [792, 794], workers: [1862, 1864],
    })
    expect(cli.find((row) => row.name === '_cli what arg')).toMatchObject({
      routines: [793, 795], workers: [1863, 1865],
    })
  })

  it('makes every previously stated missing family explicit', () => {
    expect(rows.find((row) => row.name === '_iff parse')).toMatchObject({ status: 'partial', family: 'iffparse' })
    expect(rows.find((row) => row.name === '_iff parse')?.osCalls).toContainEqual({
      chain: 'a5+552>+728', library: 'iffparse.library', lvo: -42,
    })
    expect(rows.find((row) => row.name === '_cx broker')).toMatchObject({ status: 'partial', family: 'commodities' })
    expect(rows.find((row) => row.name === '_app add icon')).toMatchObject({ status: 'missing', family: 'workbench' })
    expect(rows.find((row) => row.name === '_prfs set')).toMatchObject({ status: 'missing', family: 'preferences' })
    expect(rows.find((row) => row.name === '_help ctrl')).toMatchObject({ status: 'missing', family: 'amigaguide' })
  })
})
