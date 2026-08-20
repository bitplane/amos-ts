/**
 * The asl.library file requester, driven a frame at a time.
 *
 * ../amiga/asl.ts holds the widgets and what they are called; this is the
 * controller around them — the directory, the selection, and the loop that
 * turns clicks into a filename. Same shape as ./fsel.ts, which drives AMOS's
 * own selector: the keyword blocks, this steps once per frame, and the
 * keyword reads `result` when `done` goes up.
 *
 * `AslRequest` on the machine does not return until the user is finished, and
 * that is what a blocking statement means here too. There is no second thread
 * to run it on and there does not need to be: the frame loop IS the
 * requester's event loop, exactly as it is the file selector's.
 */
import {
  ASL_FONT_HEIGHT,
  ASL_TEXT,
  aslHit,
  aslLayout,
  aslRender,
  type AslFileSetup,
  type AslLayout,
  type AslRow,
} from '../amiga/asl'
import { IDCMP_CLOSEWINDOW, IDCMP_MOUSEBUTTONS, SELECTDOWN, WB_SLOT, type Window } from '../amiga/intuition'
import { PEN, type DrawInfo } from '../amiga/gadtools'
import { RastPort } from '../amiga/graphics'
import { joinAmigaPath, parentAmigaPath } from '../amiga/vfs'
import { matchesJoker } from './joker'
import type { Runtime } from './runtime'

export interface AslState {
  setup: AslFileSetup
  window: Window
  slot: number
  rp: RastPort
  layout: AslLayout
  rows: AslRow[]
  top: number
  selected: number
  /** the Volumes button swaps the list for the volume names */
  volumes: boolean
  done: boolean
  result: string
  /** frame of the last click on a row, for the double-click that enters one */
  clickFrame: number
  clickRow: number
}

/**
 * A screen's dri_Pens.
 *
 * MODELLED. `GetScreenDrawInfo` answers the array the user's Workbench
 * preferences chose, nothing in the corpus records one, and this port's
 * Workbench is the 1.3 four: `WB_PALETTE` in ../amiga/intuition.ts is
 * `$005a` blue, `$0fff` white, `$0002` almost-black and `$0f80` orange. So
 * the assignment here is the one that reads against THAT --- white text on
 * the blue ground, the dark colour for shadows, orange for a selected line.
 *
 * The pens are INDICES, which is the whole point of a DrawInfo: on a custom
 * screen the requester comes out in whatever colours that screen's palette
 * puts at 0 to 3, and that is true of a real one too.
 */
function screenPens(depth: number): DrawInfo {
  const pens: number[] = []
  pens[PEN.DETAIL] = 2
  pens[PEN.BLOCK] = 0
  pens[PEN.TEXT] = 1
  pens[PEN.SHINE] = 1
  pens[PEN.SHADOW] = 2
  pens[PEN.FILL] = 3
  pens[PEN.FILLTEXT] = 2
  pens[PEN.BACKGROUND] = 0
  pens[PEN.HIGHLIGHTTEXT] = 3
  pens[PEN.BARDETAIL] = 2
  pens[PEN.BARBLOCK] = 1
  pens[PEN.BARTRIM] = 2
  return { numPens: pens.length, pens, depth }
}

/** the names in `dir`, drawers first and then files, each side sorted */
export function aslList(rt: Runtime, setup: AslFileSetup, dir: string): AslRow[] {
  const all = rt.vfs?.listDir(dir) ?? []
  const rows: AslRow[] = []
  for (const e of all) {
    // ASLFR_REJECTICONS is Int's `Wb Asl Info`, and the author's own comment
    // on it is "1= Dont Show Info Files"
    if (setup.rejectIcons && !e.isDir && e.name.toLowerCase().endsWith('.info')) continue
    // a pattern filters FILES only, so a filtered view stays navigable --
    // the same rule ./fsel.ts follows for AMOS's own selector
    if (!e.isDir && setup.pattern !== '' && !matchesJoker(setup.pattern, e.name)) continue
    rows.push({ name: e.name, dir: e.isDir, size: e.size })
  }
  const key = (r: AslRow): string => (r.dir ? '0' : '1') + r.name.toLowerCase()
  rows.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0))
  return rows
}

/** the volume and assign names, which is what the Volumes button shows */
function aslVolumes(rt: Runtime): AslRow[] {
  const names = [...(rt.vfs?.volumeNames() ?? []), ...(rt.vfs?.assignNames() ?? [])]
  return names.map((n) => ({ name: `${n.replace(/:$/, '')}:`, dir: true, size: 0 }))
}

/**
 * Open the requester. Null when there is nothing to open it on, which is what
 * a failed AllocAslRequest amounts to.
 */
export function startAsl(rt: Runtime, setup: AslFileSetup, slot: number | null): AslState | null {
  const on = slot ?? WB_SLOT
  if (!rt.screens.get(on)) rt.intuition.openWorkBench()
  const scr = rt.screens.get(on)
  if (!scr) return null
  const window = rt.intuition.openWindow({
    leftEdge: setup.left,
    topEdge: setup.top,
    width: setup.width,
    height: setup.height,
    detailPen: 0,
    blockPen: 1,
    idcmpFlags: IDCMP_MOUSEBUTTONS | IDCMP_CLOSEWINDOW,
    flags: 0x8 /* WFLG_CLOSEGADGET */ | 0x2 /* WFLG_DRAGBAR */ | 0x1000 /* WFLG_ACTIVATE */,
    title: setup.hail === '' ? ASL_TEXT.fileTitle : setup.hail,
    type: on === WB_SLOT ? 1 : 15,
    ...(on === WB_SLOT ? {} : { screenSlot: on }),
  })
  if (!window) return null
  const rp = new RastPort(scr.rp.bitMap)
  rp.font = rt.systemFont()
  const layout = aslLayout(setup, window.borderLeft, window.borderTop, window.borderRight, window.borderBottom)
  const st: AslState = {
    setup,
    window,
    slot: on,
    rp,
    layout,
    rows: aslList(rt, setup, setup.dir),
    top: 0,
    selected: -1,
    volumes: false,
    done: false,
    result: '',
    clickFrame: -99,
    clickRow: -1,
  }
  return st
}

/** what OK answers: the drawer and the file joined, or "" for neither */
function aslResult(st: AslState): string {
  if (st.setup.file === '') return ''
  return joinAmigaPath(st.setup.dir, st.setup.file)
}

/** enter a drawer: it becomes the directory and the file name is dropped */
function aslEnter(rt: Runtime, st: AslState, name: string): void {
  st.setup.dir = st.volumes ? name : joinAmigaPath(st.setup.dir, name)
  st.setup.file = ''
  st.volumes = false
  st.rows = aslList(rt, st.setup, st.setup.dir)
  st.top = 0
  st.selected = -1
  // forget the double-click that got us here. Without this the SECOND click
  // of entering a drawer stays armed, and the next single click on the row
  // that lands at the same index counts as a double one -- which picks a
  // file the moment you enter the drawer holding it.
  st.clickRow = -1
  st.clickFrame = -99
}

/** one frame of the requester: drain its messages, act, redraw */
export function stepAsl(rt: Runtime, st: AslState, frame: number): void {
  if (st.done) return
  for (;;) {
    const msg = st.window.getMsg()
    if (!msg) break
    if (msg.class === IDCMP_CLOSEWINDOW) {
      st.result = ''
      st.done = true
      return
    }
    // SELECTDOWN only. Intuition posts SELECTUP on the release too, and
    // taking both would make every physical click count as two -- so the
    // press after any click would read as a double one.
    if (msg.class !== IDCMP_MOUSEBUTTONS || msg.code !== SELECTDOWN) continue
    const act = aslHit(st.layout, msg.mouseX, msg.mouseY)
    if (!act) continue
    if (act.kind === 'cancel') {
      st.result = ''
      st.done = true
      return
    }
    if (act.kind === 'ok') {
      st.result = aslResult(st)
      st.done = true
      return
    }
    if (act.kind === 'parent') {
      // a volume list has no parent, and neither has the root of a volume
      const up = st.volumes ? null : parentAmigaPath(st.setup.dir)
      if (up !== null && up !== st.setup.dir) {
        st.setup.dir = up
        st.setup.file = ''
        st.rows = aslList(rt, st.setup, st.setup.dir)
        st.top = 0
        st.selected = -1
        st.clickRow = -1
      }
      continue
    }
    if (act.kind === 'volumes') {
      st.volumes = true
      st.rows = aslVolumes(rt)
      st.top = 0
      st.selected = -1
      st.clickRow = -1
      continue
    }
    if (act.kind === 'scroll') {
      const max = Math.max(0, st.rows.length - st.layout.visible)
      st.top = Math.min(max, Math.max(0, st.top + act.delta))
      continue
    }
    const i = st.top + act.index
    const row = st.rows[i]
    if (!row) continue
    // a second click on the same row within half a second enters a drawer,
    // which is what a double-click is here; a single one only selects
    const dbl = st.clickRow === i && frame - st.clickFrame <= 25
    st.clickRow = i
    st.clickFrame = frame
    st.selected = i
    if (row.dir) {
      if (dbl) aslEnter(rt, st, row.name)
      else st.setup.file = ''
    } else {
      st.setup.file = row.name
      if (dbl) {
        st.result = aslResult(st)
        st.done = true
        return
      }
    }
  }
  const scr = rt.screens.get(st.slot)
  if (!scr) {
    st.done = true
    return
  }
  const w = st.window
  st.rp.clip = { x1: w.leftEdge, y1: w.topEdge, x2: w.leftEdge + w.width - 1, y2: w.topEdge + w.height - 1 }
  aslRender(st.rp, screenPens(scr.depth), st.setup, st.layout, st.rows, st.top, st.selected, w.leftEdge, w.topEdge)
}

/** close the window and let the keyword have its answer */
export function finishAsl(rt: Runtime, st: AslState): void {
  rt.intuition.closeWindow(st.window)
}

export { ASL_FONT_HEIGHT }
