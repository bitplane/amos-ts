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
      '_base tag', '_base topaz',
    ])
    expect(bases.filter((row) => row.status === 'missing').map((row) => row.name).sort()).toEqual([
      '_base cx', '_base iff', '_base wb',
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
