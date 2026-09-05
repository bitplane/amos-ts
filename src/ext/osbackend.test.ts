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
    expect(rows.filter((row) => row.status === 'modelled' || row.status === 'missing' || row.status === 'review'))
      .toHaveLength(1047)
  })

  it('does not confuse a machine-layer module with completed operation coverage', () => {
    expect(rows.find((row) => row.name === '_cold reboot')).toMatchObject({ status: 'review' })
    expect(rows.find((row) => row.name === '_rp draw')).toMatchObject({ status: 'modelled', family: 'graphics' })
  })

  it('makes every previously stated missing family explicit', () => {
    expect(rows.find((row) => row.name === '_iff parse')).toMatchObject({ status: 'missing', family: 'iffparse' })
    expect(rows.find((row) => row.name === '_cx broker')).toMatchObject({ status: 'missing', family: 'commodities' })
    expect(rows.find((row) => row.name === '_app add icon')).toMatchObject({ status: 'missing', family: 'workbench' })
    expect(rows.find((row) => row.name === '_prfs set')).toMatchObject({ status: 'missing', family: 'preferences' })
    expect(rows.find((row) => row.name === '_help ctrl')).toMatchObject({ status: 'missing', family: 'amigaguide' })
  })
})
