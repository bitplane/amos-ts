/**
 * `AMOSPro_Editor_LastSession`: the open windows, written as the structures
 * themselves.
 *
 * `Ed_DoQuit` (+Edit.s:4480) saves every program that has a name, then writes
 * `Prg_List` and `Edt_List` to disc as raw memory, one record per structure.
 * `Ed_WarmStart` (:487) reads them back at boot, allocates a structure per
 * record, reloads each program by name and puts the windows back where they
 * were. It is the only file in the editor that is a memory dump rather than a
 * format, and the only one whose loader has to relocate what it reads.
 *
 * ## A record carries the address it used to live at
 *
 * `.StructureSave` (:4531) writes `[address:4][length:4][0:4]` and then the
 * structure. The address is where the block sat in the machine that wrote it,
 * which is useless as an address and is the whole point: `Edt_Prg` and the
 * three window links are pointers into the same two lists, so the loader finds
 * each one's record by comparing against those saved addresses and writes the
 * NEW address into the third long of the record as it goes (`.PCree` :541).
 * `.Linke` (:658) then rewrites every pointer through it. A four-byte zero
 * address ends each list.
 *
 * This port has no addresses to write, so a key is `PRG_BASE`/`EDT_BASE` plus
 * the record's index times the structure length. Any distinct non-zero long
 * does the job, and stepping by the length makes a listing read like the
 * allocations it stands for.
 *
 * An `Edt_Prg` the walk cannot find is not handled. `.PoL` runs to the list's
 * zero terminator, falls into `.PoF` and takes `8(a1)` from it, which is eight
 * bytes past a four-byte record and reads the first `Edt_Long` of the next
 * list. Nothing can reach it, because every pointer written came out of the
 * list it is looked up in, so this port resolves to null and does not
 * reproduce the read.
 *
 * ## The header is written last
 *
 * The file opens with eight zero bytes and closes by seeking back over them
 * (:4497) to write `"ApLC"` and the byte count after them. `Ed_WarmStart`
 * reads those eight, refuses anything but `"ApLC"`, and asks for exactly that
 * many bytes: a file that was cut short fails the read rather than the magic.
 *
 * ## What a structure holds that this port does not
 *
 * The pixel geometry, all of it. `Edt_X`, `Edt_Y`, `Edt_Sy`, the six `Edt_Wind`
 * coordinates, the four zone numbers, `Edt_BasY`, `Edt_ASlY`, one 68-byte
 * slider and three 24-byte buttons are written as zeros here, and `Prg_Banks`,
 * `Prg_Dialogs`, `Prg_Undo` and the four other pointers are cleared by the
 * loader itself (:551) whatever they held. `Ed_DrawWindows` builds the
 * geometry again from `Edt_WindTy` and the window order, which is why the
 * machine can throw the same fields away on a screen-size change.
 */
import type { ProgramBuffer } from './buffer'
import type { Edit } from './edit'
import type { Editor } from './windows'
import { ED_SYSTEME } from '../runtime/edmessages.gen'

/** `Ed_QuitHead equ "ApLC"` (+Equ.s:1668), at `$291c` in `AMOSPro_Editor` */
export const SESSION_HEAD = 'ApLC'

/** system message 47, `AMOSPro_Editor_LastSession` (+Editor_Config.s:513) */
export const SESSION_NAME = ED_SYSTEME[46]!

/** system message 49, the name an unnamed program is saved under */
export const NEW_PROJECT = ED_SYSTEME[48]!

/** system message 22, the extension that goes after the number */
export const AMOS_EXT = ED_SYSTEME[21]!

/** `Prg_Long` (+Equ.s:1882), and `move.l #$f0,d0` at `$28be` */
export const PRG_LONG = 240

/** `Edt_Long` (+Equ.s:1958), and `move.l #$f6,d0` at `$28f4` */
export const EDT_LONG = 246

/** what a fake address counts from, so a program key never reads as a window's */
const PRG_BASE = 0x0001_0000
const EDT_BASE = 0x0002_0000

/** `Prg_` (+Equ.s:1836), the offsets this port has a field for */
const PRG = {
  NEXT: 0,
  NLIGNE: 4,
  ST_MINI: 6,
  ST_TTEXTE: 10,
  ST_HAUT: 14,
  ST_BAS: 18,
  ST_MODIF: 30,
  CHANGE: 31,
  EDITED: 32,
  NO_NAMED: 33,
  NOT13: 34,
  MATH_FLAGS: 36,
  X_EPROC: 54,
  MARKS: 72,
  NAME_PRG: 112,
} as const

/** `Edt_` (+Equ.s:1888). `Edt_Prg` at 4 and `Edt_LinkPrev` at $52 read off `$280c` */
const EDT = {
  NEXT: 0,
  PRG: 4,
  ORDER: 12,
  WINDOW: 14,
  WIND_TX: 38,
  WIND_TY: 40,
  WIND_OLD_TY: 42,
  ET_MESS: 52,
  ET_ALERT: 54,
  X_POS: 58,
  Y_POS: 60,
  X_CU: 62,
  Y_CU: 64,
  L_EDITED: 74,
  X_BLOC: 76,
  Y_BLOC: 78,
  Y_OLD_BLOC: 80,
  LINK_PREV: 82,
  LINK_NEXT: 86,
  LINK_SCROLL: 90,
  LINK_Y_OLD: 94,
  HIDDEN: 96,
  LINK_FLAG: 97,
  FIRST: 98,
  LAST: 99,
  ETAT_AFF: 100,
  PRG_DELETE: 101,
} as const

/** `Prg_NamePrg`, 128 bytes with a zero on the end */
const NAME_MAX = 128

/** one `.StructureSave` record's header: the old address, the length, the new one */
const RECORD_HEAD = 12

/** a `Prg_Long` structure, in the fields this port keeps */
export interface SessionProgram {
  /** `Prg_StTTexte`, which the loader moves to `Prg_StBas` and asks for again */
  size: number
  /** `Prg_NLigne` */
  lineCount: number
  /** `Prg_StModif` */
  modified: boolean
  /** `Prg_Change` */
  changed: boolean
  /** `Prg_Edited`, how many windows are on it */
  edited: number
  /** `Prg_NoNamed`, non-zero when the name is one Quit invented */
  noNamed: number
  /** `Prg_Not1.3` */
  pro: boolean
  /** `Prg_MathFlags` */
  mathFlags: number
  /** `Prg_XEProc` */
  xEProc: number
  /** `Prg_Marks`, ten longs */
  marks: number[]
  /** `Prg_NamePrg` */
  name: string
}

/** an `Edt_Long` structure. Every pointer is an index, and -1 is a null one */
export interface SessionWindow {
  prog: number
  order: number
  window: number
  windTx: number
  windTy: number
  windOldTy: number
  alert: number
  alertTime: number
  xPos: number
  yPos: number
  xCu: number
  yCu: number
  edited: number
  xBloc: number
  yBloc: number
  yOldBloc: number
  linkPrev: number
  linkNext: number
  linkScroll: number
  linkYOld: number
  hidden: 0 | 1 | 2
  linkFlag: boolean
  first: boolean
  last: boolean
  etatAff: number
  prgDelete: boolean
}

export interface Session {
  programs: SessionProgram[]
  windows: SessionWindow[]
  /** the window whose `Edt_Order` was not zero, or -1 when the file names none */
  current: number
}

/**
 * `Ed_DoQuit`'s file (:4480), built in one pass because the size is known.
 *
 * The machine cannot know it: it writes eight bytes of nothing, writes the two
 * lists, and seeks back. What comes out is the same bytes either way.
 */
export function writeSession(editor: Editor): Uint8Array {
  const programs = editor.programs
  const windows = editor.list
  const size =
    8 +
    programs.length * (RECORD_HEAD + PRG_LONG) +
    4 +
    windows.length * (RECORD_HEAD + EDT_LONG) +
    4
  const out = new Uint8Array(size)
  const v = new DataView(out.buffer)
  let p = 8
  programs.forEach((prog, i) => {
    p = record(v, p, PRG_BASE + i * PRG_LONG, PRG_LONG)
    const at = p - PRG_LONG
    const next = i + 1 < programs.length ? PRG_BASE + (i + 1) * PRG_LONG : 0
    v.setUint32(at + PRG.NEXT, next)
    v.setUint16(at + PRG.NLIGNE, prog.lineCount)
    v.setUint32(at + PRG.ST_MINI, prog.stMini)
    v.setUint32(at + PRG.ST_TTEXTE, prog.bytes.length)
    v.setUint32(at + PRG.ST_HAUT, prog.stHaut)
    v.setUint32(at + PRG.ST_BAS, prog.stBas)
    out[at + PRG.ST_MODIF] = prog.modified ? 1 : 0
    out[at + PRG.CHANGE] = prog.changed ? 1 : 0
    out[at + PRG.EDITED] = prog.edited
    out[at + PRG.NO_NAMED] = prog.noNamed
    out[at + PRG.NOT13] = prog.pro ? 1 : 0
    out[at + PRG.MATH_FLAGS] = prog.mathFlags
    v.setUint16(at + PRG.X_EPROC, prog.xEProc)
    prog.marks.forEach((m, n) => v.setUint32(at + PRG.MARKS + n * 4, m >>> 0))
    putName(out, at + PRG.NAME_PRG, prog.name)
  })
  v.setUint32(p, 0)
  p += 4
  windows.forEach((w, i) => {
    p = record(v, p, EDT_BASE + i * EDT_LONG, EDT_LONG)
    const at = p - EDT_LONG
    const next = i + 1 < windows.length ? EDT_BASE + (i + 1) * EDT_LONG : 0
    v.setUint32(at + EDT.NEXT, next)
    v.setUint32(at + EDT.PRG, prgKey(programs, w.prog))
    // `.ELoop` (:4491) rewrites Edt_Order as it writes: zero for every window
    // and 1 for the current one, so the file names the current window in the
    // field the display order lives in
    v.setUint16(at + EDT.ORDER, w === editor.current ? 1 : 0)
    v.setUint16(at + EDT.WINDOW, w.window)
    v.setUint16(at + EDT.WIND_TX, w.windTx)
    v.setUint16(at + EDT.WIND_TY, w.windTy)
    v.setUint16(at + EDT.WIND_OLD_TY, w.windOldTy)
    v.setUint16(at + EDT.ET_MESS, w.alertTime)
    v.setUint32(at + EDT.ET_ALERT, w.alert)
    v.setUint16(at + EDT.X_POS, w.xPos)
    v.setUint16(at + EDT.Y_POS, w.yPos)
    v.setUint16(at + EDT.X_CU, w.xCu)
    v.setUint16(at + EDT.Y_CU, w.yCu)
    v.setUint16(at + EDT.L_EDITED, w.edited)
    v.setInt16(at + EDT.X_BLOC, w.xBloc)
    v.setInt16(at + EDT.Y_BLOC, w.yBloc)
    v.setInt16(at + EDT.Y_OLD_BLOC, w.yOldBloc)
    v.setUint32(at + EDT.LINK_PREV, edtKey(windows, w.linkPrev))
    v.setUint32(at + EDT.LINK_NEXT, edtKey(windows, w.linkNext))
    v.setUint32(at + EDT.LINK_SCROLL, edtKey(windows, w.linkScroll))
    v.setUint16(at + EDT.LINK_Y_OLD, w.linkYOld)
    out[at + EDT.HIDDEN] = w.hidden
    out[at + EDT.LINK_FLAG] = w.linkFlag ? 1 : 0
    out[at + EDT.FIRST] = w.first ? 1 : 0
    out[at + EDT.LAST] = w.last ? 1 : 0
    out[at + EDT.ETAT_AFF] = w.etatAff
    out[at + EDT.PRG_DELETE] = w.prgDelete ? 1 : 0
  })
  v.setUint32(p, 0)
  p += 4
  for (let i = 0; i < 4; i++) out[i] = SESSION_HEAD.charCodeAt(i)
  v.setUint32(4, size - 8)
  return out
}

/**
 * `Ed_WarmStart`'s first two phases (:507 to :583), stopping short of the
 * reload.
 *
 * Null is every way the machine gives up before it has changed anything: a
 * file that is not `"ApLC"`, and a length the file cannot supply. Both are
 * `.Err0` there, which closes the file and puts EdD_NoWarm up.
 */
export function readSession(file: Uint8Array): Session | null {
  if (file.length < 8) return null
  const v = new DataView(file.buffer, file.byteOffset, file.byteLength)
  for (let i = 0; i < 4; i++) if (file[i] !== SESSION_HEAD.charCodeAt(i)) return null
  const length = v.getUint32(4)
  if (8 + length > file.length) return null
  // `.GLoop` (:530) walks the first list to find where the second begins
  const prgAt: number[] = []
  const edtAt: number[] = []
  let p = 8
  for (const found of [prgAt, edtAt]) {
    for (;;) {
      if (p + 4 > file.length) return null
      const key = v.getUint32(p)
      if (key === 0) {
        p += 4
        break
      }
      if (p + RECORD_HEAD > file.length) return null
      const len = v.getUint32(p + 4)
      if (p + RECORD_HEAD + len > file.length) return null
      found.push(p)
      p += RECORD_HEAD + len
    }
  }
  const prgKeys = prgAt.map((at) => v.getUint32(at))
  const edtKeys = edtAt.map((at) => v.getUint32(at))
  const programs = prgAt.map((rec) => {
    const at = rec + RECORD_HEAD
    return {
      size: v.getUint32(at + PRG.ST_TTEXTE),
      lineCount: v.getUint16(at + PRG.NLIGNE),
      modified: file[at + PRG.ST_MODIF] !== 0,
      changed: file[at + PRG.CHANGE] !== 0,
      edited: file[at + PRG.EDITED]!,
      noNamed: file[at + PRG.NO_NAMED]!,
      pro: file[at + PRG.NOT13] !== 0,
      mathFlags: file[at + PRG.MATH_FLAGS]!,
      xEProc: v.getUint16(at + PRG.X_EPROC),
      marks: Array.from({ length: 10 }, (_, n) => v.getUint32(at + PRG.MARKS + n * 4)),
      name: getName(file, at + PRG.NAME_PRG),
    }
  })
  let current = -1
  const windows = edtAt.map((rec, i) => {
    const at = rec + RECORD_HEAD
    const order = v.getUint16(at + EDT.ORDER)
    if (order !== 0 && current === -1) current = i
    const hidden = file[at + EDT.HIDDEN]!
    return {
      prog: prgKeys.indexOf(v.getUint32(at + EDT.PRG)),
      order,
      window: v.getUint16(at + EDT.WINDOW),
      windTx: v.getUint16(at + EDT.WIND_TX),
      windTy: v.getUint16(at + EDT.WIND_TY),
      windOldTy: v.getUint16(at + EDT.WIND_OLD_TY),
      alert: v.getUint32(at + EDT.ET_ALERT),
      alertTime: v.getUint16(at + EDT.ET_MESS),
      xPos: v.getUint16(at + EDT.X_POS),
      yPos: v.getUint16(at + EDT.Y_POS),
      xCu: v.getUint16(at + EDT.X_CU),
      yCu: v.getUint16(at + EDT.Y_CU),
      edited: v.getUint16(at + EDT.L_EDITED),
      xBloc: v.getInt16(at + EDT.X_BLOC),
      yBloc: v.getInt16(at + EDT.Y_BLOC),
      yOldBloc: v.getInt16(at + EDT.Y_OLD_BLOC),
      linkPrev: edtKeys.indexOf(v.getUint32(at + EDT.LINK_PREV)),
      linkNext: edtKeys.indexOf(v.getUint32(at + EDT.LINK_NEXT)),
      linkScroll: edtKeys.indexOf(v.getUint32(at + EDT.LINK_SCROLL)),
      linkYOld: v.getUint16(at + EDT.LINK_Y_OLD),
      hidden: (hidden > 2 ? 2 : hidden) as 0 | 1 | 2,
      linkFlag: file[at + EDT.LINK_FLAG] !== 0,
      first: file[at + EDT.FIRST] !== 0,
      last: file[at + EDT.LAST] !== 0,
      etatAff: file[at + EDT.ETAT_AFF]!,
      prgDelete: file[at + EDT.PRG_DELETE] !== 0,
    }
  })
  return { programs, windows, current }
}

/** the twelve bytes in front of a structure, and the space for the structure */
function record(v: DataView, p: number, key: number, len: number): number {
  v.setUint32(p, key)
  v.setUint32(p + 4, len)
  v.setUint32(p + 8, 0)
  return p + RECORD_HEAD + len
}

function prgKey(programs: readonly ProgramBuffer[], prog: ProgramBuffer): number {
  const at = programs.indexOf(prog)
  return at < 0 ? 0 : PRG_BASE + at * PRG_LONG
}

function edtKey(windows: readonly Edit[], w: Edit | null): number {
  if (w === null) return 0
  const at = windows.indexOf(w)
  return at < 0 ? 0 : EDT_BASE + at * EDT_LONG
}

/** `EdCocop` into a 128-byte field: the bytes, a zero, and nothing after it */
function putName(out: Uint8Array, at: number, name: string): void {
  const n = Math.min(name.length, NAME_MAX - 1)
  for (let i = 0; i < n; i++) out[at + i] = name.charCodeAt(i) & 0xff
}

function getName(file: Uint8Array, at: number): string {
  let end = at
  while (end < at + NAME_MAX && file[end] !== 0) end++
  return String.fromCharCode(...file.subarray(at, end))
}
