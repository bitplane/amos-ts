/**
 * `opalreq.library` 1.10, Opal Technology's synchronous file requester.
 *
 * The developer kit contains both the public include and the 24,800-byte
 * library. Its only custom vector is `OpalRequester` at -30. The machine code
 * at `$2d2` serialises calls with a library-global flag, clears `OR_OKHit`,
 * chooses either `OR_Dir` or the library's remembered path, and does not
 * return until the requester has been accepted, cancelled, or failed.
 *
 * Browser UI is deliberately supplied by the caller. This class owns the
 * library behaviour around that UI: re-entry, remembered paths, result fields
 * and return codes. That keeps the subsystem usable without inventing an AMOS
 * keyword—the Opal extension never opens this companion library.
 */

export const OPALREQ_NAME = 'opalreq.library'
export const OPALREQ_VERSION = 1
export const OPALREQ_REVISION = 10
export const OPALREQ_LVO = { OpalRequester: -30 } as const
export const OPALREQ_HEIGHT = 345

export const OR_FLAG = { NO_INFO: 1, LASTPATH: 2 } as const
export const OR_ERR_OUTOFMEM = 1
export const OR_ERR_INUSE = 2

/** Byte offsets fixed by `Assembler/opalreqlib.i`; `OR_SIZEOF` is 44. */
export const OR = {
  TopEdge: 0,
  Hail: 2,
  File: 6,
  Dir: 10,
  Extension: 14,
  Window: 18,
  OScrn: 22,
  Pointer: 26,
  OKHit: 30,
  NeedRefresh: 32,
  Flags: 34,
  BackPen: 38,
  PrimaryPen: 40,
  SecondaryPen: 42,
  Sizeof: 44,
} as const

export interface OpalReq {
  topEdge: number
  hail: string
  file: string
  dir: string
  extension: string
  window: number
  opalScreen: number
  pointer: number
  okHit: boolean
  needRefresh: boolean
  flags: number
  backPen: number
  primaryPen: number
  secondaryPen: number
}

export interface OpalReqPrompt {
  hail: string
  file: string
  dir: string
  extension: string
  excludeInfo: boolean
}

export type OpalReqChoice =
  | { kind: 'ok'; file: string; dir: string; needRefresh?: boolean }
  | { kind: 'cancel'; dir?: string; needRefresh?: boolean }
  | { kind: 'out-of-memory' }

export type OpalReqChooser = (prompt: OpalReqPrompt) => OpalReqChoice

export class OpalRequester {
  private active = false
  private lastPath = ''

  request(req: OpalReq, choose: OpalReqChooser): number {
    if (this.active) return OR_ERR_INUSE
    this.active = true
    req.okHit = false
    try {
      const choice = choose({
        hail: req.hail,
        file: req.file,
        dir: req.flags & OR_FLAG.LASTPATH ? this.lastPath : req.dir,
        extension: req.extension,
        excludeInfo: (req.flags & OR_FLAG.NO_INFO) !== 0,
      })
      if (choice.kind === 'out-of-memory') return OR_ERR_OUTOFMEM
      req.needRefresh = choice.needRefresh ?? false
      if (choice.dir !== undefined) {
        req.dir = choice.dir
        this.lastPath = choice.dir
      }
      if (choice.kind === 'ok') {
        req.file = choice.file
        req.okHit = true
      }
      return 0
    } finally {
      this.active = false
    }
  }
}
