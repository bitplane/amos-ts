import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadHunks } from './hunk'
import { residents } from '../cli/libdis'
import {
  OPALREQ_LVO,
  OPALREQ_NAME,
  OPALREQ_REVISION,
  OPALREQ_VERSION,
  OR,
  OR_ERR_INUSE,
  OR_FLAG,
  OpalRequester,
  type OpalReq,
} from './opalreq'

const LIB = join(
  __dirname,
  '..',
  '..',
  'fixtures',
  'extensions',
  'opal-1.1',
  'devdocs',
  'Libs',
  'OpalReq.Library',
)

const request = (): OpalReq => ({
  topEdge: 0,
  hail: 'Pick an Image',
  file: 'old.iff',
  dir: 'Images:',
  extension: '.iff',
  window: 1,
  opalScreen: 2,
  pointer: 3,
  okHit: true,
  needRefresh: false,
  flags: OR_FLAG.NO_INFO,
  backPen: 1,
  primaryPen: 3,
  secondaryPen: 2,
})

describe('opalreq.library 1.10', () => {
  it.skipIf(!existsSync(LIB))('has the resident identity and sole custom vector held by the model', () => {
    const image = loadHunks(new Uint8Array(readFileSync(LIB)), 0x21_0000)
    const [resident] = residents({ data: image.image, base: image.base })
    expect(resident).toMatchObject({
      name: OPALREQ_NAME,
      version: OPALREQ_VERSION,
    })
    expect(resident!.idString).toContain(`opalreq ${OPALREQ_VERSION}.${OPALREQ_REVISION}`)
    expect([...resident!.vectors.keys()]).toEqual([-6, -12, -18, -24, -30])
    expect(OPALREQ_LVO.OpalRequester).toBe(-30)
    expect(OR.Sizeof).toBe(44)
  })

  it('copies an accepted synchronous selection into the public fields', () => {
    const lib = new OpalRequester()
    const req = request()
    expect(
      lib.request(req, (p) => {
        expect(p).toEqual({
          hail: 'Pick an Image',
          file: 'old.iff',
          dir: 'Images:',
          extension: '.iff',
          excludeInfo: true,
        })
        return { kind: 'ok', dir: 'Pictures:', file: 'new.iff', needRefresh: true }
      }),
    ).toBe(0)
    expect(req).toMatchObject({ dir: 'Pictures:', file: 'new.iff', okHit: true, needRefresh: true })
  })

  it('clears OKHit on cancel and LASTPATH starts at the remembered directory', () => {
    const lib = new OpalRequester()
    const first = request()
    lib.request(first, () => ({ kind: 'cancel', dir: 'Work:' }))
    expect(first.okHit).toBe(false)
    const second = request()
    second.flags = OR_FLAG.LASTPATH
    lib.request(second, (p) => {
      expect(p.dir).toBe('Work:')
      return { kind: 'cancel' }
    })
  })

  it('returns OR_ERR_INUSE from a re-entrant call', () => {
    const lib = new OpalRequester()
    expect(
      lib.request(request(), () => {
        expect(lib.request(request(), () => ({ kind: 'cancel' }))).toBe(OR_ERR_INUSE)
        return { kind: 'cancel' }
      }),
    ).toBe(0)
  })
})
