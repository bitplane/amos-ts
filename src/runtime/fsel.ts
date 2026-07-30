/**
 * The AMOS Professional file selector — Dsk.FileSelector → End_FSel
 * (+Lib.s:17756-19292), the native half of `Fsel$`.
 *
 * The screen and every widget on it come from dialog program 2 of the system
 * resource bank; this module is the logic AMOS wraps around it. The dialog
 * reports a zone number, `Fs_Loop` (17920) dispatches it through `Fs_Jumps`
 * (17939), and between reports the loop reads the directory one entry at a
 * time so the list fills while the selector stays live.
 *
 * State names follow the 68k's Fs_ block (+Equ.s:2156-2177) and the dialog
 * variables its script shares (FsV_, +Equ.s:2187-2200), because almost every
 * decision here is a read of one of them.
 */
import type { AmosArray } from '../interp/interp'
import type { Runtime } from './runtime'
import type { DialogChannel, DialogZone } from './dialog'
import { drawEditZone, drawListZone, drawSliderZone } from './dialog'
import { amigaPattern, fillSortKey, joinAmigaPath, parentAmigaPath } from './vfs'

/** zone numbers the script gives its widgets (Fs_PathN / Fs_FileN / Fs_ListN) */
export const FS_PATH_ZONE = 14
export const FS_FILE_ZONE = 15
export const FS_LIST_ZONE = 13

/** FsV_ dialog variable slots (+Equ.s:2187) */
export const FSV = {
  titre0: 0,
  titre1: 1,
  sort: 7,
  size: 8,
  pList: 10,
  array: 11,
  tx: 12,
  ty: 13,
  file: 14,
  path: 15,
  store: 16,
  posFirst: 25,
  affFlag: 26,
} as const

export interface FselEntry {
  name: string
  isDir: boolean
  size: number
  /** bit 31 of the size word: an assign or a stored directory, never sized */
  special?: boolean
  /** for a stored-directory row, which cache entry it stands for */
  storeIndex?: number
}

export interface FselState {
  done: boolean
  result: string
  chan: number
  screenNb: number
  prevScreen: number
  /** Name1 — the directory being listed */
  path: string
  /** Name2 — the trailing joker, which filters files only */
  filter: string
  /** Fs_DevFlag: 0 files, 1 devices, 2 assigns, 3 stored directories */
  devFlag: number
  /** Fs_DirOn: a directory read is still in progress */
  dirOn: boolean
  /**
   * FillFSorted — latched from FsV_Sort when the read begins and used for the
   * rest of it, so flipping the toggle mid-listing does not reorder what is
   * already there. Stored and restored with a cached directory.
   */
  sorted: boolean
  /** Fs_Click: the row remembered for the double-click test, -1 for none */
  click: number
  /** what has been read so far — the Fill list */
  entries: FselEntry[]
  /** what Fs_Next has yet to take, one per frame */
  pending: FselEntry[]
  /** AppCentre state while the screen is opening or closing */
  slide: SlideState | null
  /** the result waiting on the closing slide, null while the selector lives */
  closing: string | null
  arr: AmosArray
}

/**
 * Fs_NomDir (+Lib.s:18781): split the path box into the directory to list
 * (Name1) and the joker to filter it with (Name2). Only a trailing component
 * containing a joker counts as a filter — "DH0:Games" lists that drawer,
 * "DH0:Games/*.iff" lists it filtered.
 */
export function nomDir(text: string): { path: string; filter: string } {
  const m = /^(.*?)([^:/]*[#?*][^:/]*)$/.exec(text)
  return m ? { path: m[1]!, filter: m[2]! } : { path: text, filter: '' }
}

const zoneOf = (d: DialogChannel, n: number): DialogZone | undefined =>
  d.zones.find((z) => z.number === n && (z.kind === 'edit' || z.kind === 'digit'))

export const fselZoneText = (d: DialogChannel, n: number): string => zoneOf(d, n)?.text ?? ''

/**
 * Fs_GetName (+Lib.s:19130) — one row of the list, and the whole of the
 * Sizes column. The name carries its marker character ('*' directory, ' '
 * file) because the row is what the user sees and Fs_Name reads that same
 * byte back to decide what was clicked.
 *
 * With sizes off, or for a directory, or for an assign/stored entry (bit 31
 * of the size), the row is just the name. Otherwise the name is padded to
 * FsV_Tx - 8, then a space, then the size — left-aligned in what remains,
 * because LongToDec writes forwards and the padding follows it.
 */
export function fselRowText(d: DialogChannel, e: FselEntry): string {
  const name = (e.isDir ? '*' : ' ') + e.name
  if (!Number(d.vars[FSV.size]) || e.isDir || e.special) return name
  const tx = Number(d.vars[FSV.tx]) || 0
  if (tx < 10) return name // no room for a size column
  return name.padEnd(tx - 8).slice(0, tx - 8) + ' ' + String(e.size).padEnd(7)
}

/** FsI_AffF (+Lib.s:19114): rebuild the visible rows and redraw them */
export function fselAffF(rt: Runtime, f: FselState): void {
  const d = rt.dialogs.get(f.chan)
  if (!d) return
  const rows = f.entries.map((e) => fselRowText(d, e))
  f.arr.data = rows.map((s) => ({ k: 'str' as const, s }))
  f.arr.dims = [rows.length]
  rt.dialogDraw.activate(d.screenNb)
  const list = d.zones.find((z) => z.kind === 'list')
  if (list) {
    list.count = rows.length
    list.scroll = Number(d.vars[FSV.pList]) || 0
    drawListZone(d, list, rt.dialogHost, rt.dialogDraw)
  }
  const slider = d.zones.find((z) => z.kind === 'slider' && z.vertical)
  if (slider) {
    slider.total = rows.length
    drawSliderZone(d, slider, rt.dialogDraw)
  }
  rt.dialogDraw.deactivate()
}

/** put a name in the FILE box (Fs_NewName +Lib.s:18308) */
export function fselNewName(rt: Runtime, f: FselState, name: string): void {
  const d = rt.dialogs.get(f.chan)
  const z = d && zoneOf(d, FS_FILE_ZONE)
  if (!d || !z) return
  z.text = name
  rt.dialogDraw.activate(d.screenNb)
  drawEditZone(d, z, rt.dialogDraw)
  rt.dialogDraw.deactivate()
}

/** show the current path in the PATH box (part of Fs_NewDir, 18858) */
export function fselShowPath(rt: Runtime, f: FselState): void {
  const d = rt.dialogs.get(f.chan)
  const z = d && zoneOf(d, FS_PATH_ZONE)
  if (!d || !z) return
  z.text = f.filter === '' ? f.path : f.path + f.filter
  rt.dialogDraw.activate(d.screenNb)
  drawEditZone(d, z, rt.dialogDraw)
  rt.dialogDraw.deactivate()
}

/**
 * Fs_First (+Lib.s:18731): begin listing. The sort flag is latched from
 * FsV_Sort into FillFSorted for the whole read, the click memory and the
 * first-file position are reset, and Fs_DirOn starts the incremental fill
 * that Fs_Next drains.
 *
 * The Fs_FindStore cache short-circuit belongs to the Store slice; until then
 * every directory is read fresh.
 */
export function fselFirst(rt: Runtime, f: FselState): void {
  const d = rt.dialogs.get(f.chan)
  if (!d || !rt.vfs) return
  f.devFlag = 0
  f.click = -1
  f.sorted = Number(d.vars[FSV.sort]) !== 0
  d.vars[FSV.posFirst] = -1
  d.vars[FSV.pList] = 0
  f.entries = []
  const list = d.zones.find((z) => z.kind === 'list')
  if (list) {
    list.scroll = 0
    list.sel = -1
    list.pos = -1
  }
  // Fs_FindStore (18583): a directory already in the cache is adopted whole
  // rather than read again
  const hit = fselFindStore(rt, f.path, f.filter)
  if (hit >= 0) {
    fselBranch(rt, f, d, hit)
    fselShowPath(rt, f)
    fselAffF(rt, f)
    return
  }
  const all = rt.vfs.listDir(f.path) ?? []
  const rx = f.filter === '' ? null : amigaPattern(f.filter)
  const neg = rt.dirNegFilter === '' ? null : amigaPattern(rt.dirNegFilter)
  // FillNxt (+Lib.s:6213) applies both jokers to files only — directories
  // always list, which is what makes a filtered view still navigable
  f.pending = all
    .filter((e) => e.isDir || ((!rx || rx.test(e.name)) && !(neg && neg.test(e.name))))
    .map((e) => ({ name: e.name, isDir: e.isDir, size: e.size }))
  f.dirOn = true
  fselShowPath(rt, f)
  fselAffF(rt, f)
}

/** list the volumes and assigns instead (Fs_Device / Fs_Assign, 18226) */
export function fselDevices(rt: Runtime, f: FselState, devFlag: number): void {
  if (!rt.vfs) return
  const names = devFlag === 1 ? rt.vfs.volumeNames() : rt.vfs.assignNames()
  f.devFlag = devFlag
  f.click = -1
  f.dirOn = false
  f.pending = []
  // a device row is a name with a colon, never sized (bit 31 in the original)
  f.entries = names.map((n) => ({ name: `${n.replace(/:$/, '')}:`, isDir: false, size: 0, special: true }))
  const d = rt.dialogs.get(f.chan)
  if (d) {
    d.vars[FSV.pList] = 0
    const list = d.zones.find((z) => z.kind === 'list')
    if (list) {
      list.scroll = 0
      list.sel = -1
      list.pos = -1
    }
  }
  fselAffF(rt, f)
}

/**
 * Fs_Next (+Lib.s:18754): take one more name. Sorting inserts it in place,
 * and if it lands at or above the top of the view both FsV_PList and
 * FsV_PosFirst step down so the rows under the pointer do not move — which
 * only bites once Fs_Help has pinned PosFirst, since a plain listing leaves
 * it at -1.
 */
export function fselNext(rt: Runtime, f: FselState): void {
  if (!f.dirOn) return
  const d = rt.dialogs.get(f.chan)
  if (!d) return
  const e = f.pending.shift()
  if (e === undefined) {
    f.dirOn = false
    return
  }
  let at = f.entries.length
  if (f.sorted) {
    const key = fillSortKey((e.isDir ? '*' : ' ') + e.name)
    at = f.entries.findIndex((o) => fillSortKey((o.isDir ? '*' : ' ') + o.name) > key)
    if (at < 0) at = f.entries.length
  }
  f.entries.splice(at, 0, e)
  const posFirst = Number(d.vars[FSV.posFirst])
  if (f.sorted && posFirst >= 0 && posFirst >= at) {
    d.vars[FSV.pList] = Number(d.vars[FSV.pList]) + 1
    d.vars[FSV.posFirst] = posFirst + 1
  }
  fselAffF(rt, f)
}

/**
 * Fs_Jumps (+Lib.s:17939) — the twenty zones the selector's dialog can
 * report, dispatched by number. Zones 9-12 and 18 are Fs_Rien: the script
 * scrolls its own list and moves its own slider, so there is nothing for the
 * native side to do.
 */
export function fselJump(rt: Runtime, f: FselState, d: DialogChannel, zone: number): void {
  switch (zone) {
    case 1: // Fs_Ok (18074)
      fselStore(rt, f, d)
      fselOk(rt, f, d)
      break
    case 2: // Fs_Cancel (18107)
      fselStore(rt, f, d)
      rt.finishFsel('')
      break
    case 3: { // Fs_Parent (18326)
      // the original walks back only when the path ends in '/', so a bare
      // "DH0:Games" leaves the button dead until you have descended
      const cur = fselZoneText(d, FS_PATH_ZONE)
      if (!cur.endsWith('/')) break
      fselStore(rt, f, d)
      f.path = parentAmigaPath(cur)
      f.filter = ''
      fselFirst(rt, f)
      break
    }
    case 4: // Fs_Device (18226)
      fselStore(rt, f, d)
      fselDevices(rt, f, 1)
      break
    case 5: // Fs_Assign (18233)
      fselStore(rt, f, d)
      fselDevices(rt, f, 2)
      break
    case 6: // Fs_GDir (18131) — and Edit Path, which shares it
    case FS_PATH_ZONE: {
      const split = nomDir(fselZoneText(d, FS_PATH_ZONE))
      f.path = split.path
      f.filter = split.filter
      fselFirst(rt, f)
      break
    }
    case 7: // Fs_Sort (18116)
      // one-way: the list is sorted when the toggle goes on, and switching it
      // off leaves the order alone until the next directory read
      if (Number(d.vars[FSV.sort])) {
        f.entries.sort((a, b) => {
          const ka = fillSortKey((a.isDir ? '*' : ' ') + a.name)
          const kb = fillSortKey((b.isDir ? '*' : ' ') + b.name)
          return ka < kb ? -1 : ka > kb ? 1 : 0
        })
        fselAffF(rt, f)
      }
      break
    case 8: // Fs_Size (18126) — nothing but a redraw; Fs_GetName does the work
      fselAffF(rt, f)
      break
    case FS_LIST_ZONE: // Fs_Name (18252)
      fselName(rt, f, d)
      break
    case FS_FILE_ZONE: // Fs_Return (18048)
      fselReturn(rt, f, d)
      break
    case 16: // Fs_BStore (18354): the Store toggle
      // switching it off does not just stop caching, it empties the cache
      rt.pi.FsStore = Number(d.vars[FSV.store]) ? 1 : 0
      if (!rt.pi.FsStore) rt.fselStore.length = 0
      break
    case 17: // Fs_SliDel (18382): "Del" goes to the oldest stored directory,
      // which consumes it — Fs_Branch takes the entry back out of the cache
      if (rt.pi.FsStore && rt.fselStore.length > 0) fselStoDir(rt, f, rt.fselStore.length - 1)
      break
    case 18: // Fs_StoreList (18137): show the cache as the list
      fselStoreList(rt, f, d)
      break
    case 19: // Fs_Help (17963): type-ahead on the name box
      fselHelp(rt, f, d)
      break
    case 20: // Fs_Droite (18197): files -> devices -> assigns -> stored
      if (f.devFlag === 0) {
        fselStore(rt, f, d)
        fselDevices(rt, f, 1)
      } else if (f.devFlag === 1) fselDevices(rt, f, 2)
      else if (f.devFlag === 2 && rt.pi.FsStore) fselStoreList(rt, f, d)
      else fselFirst(rt, f)
      break
    default:
      break
  }
}

/**
 * Fs_Ok (+Lib.s:18074): the chosen path becomes the program's current
 * directory — PathAct on the Amiga — before the name is appended, so a later
 * bare-filename Load resolves against it. An empty name box is a Cancel.
 */
function fselOk(rt: Runtime, _f: FselState, d: DialogChannel): void {
  const split = nomDir(fselZoneText(d, FS_PATH_ZONE))
  const name = fselZoneText(d, FS_FILE_ZONE)
  if (name === '') {
    rt.finishFsel('')
    return
  }
  if (rt.vfs && split.path !== '') rt.vfs.currentDir = split.path
  rt.finishFsel(joinAmigaPath(split.path, name))
}

/**
 * Fs_Return (+Lib.s:18048): Return in the name box. If what was typed has no
 * path part it is simply OK; otherwise the path half becomes the new
 * directory (a ':' in it resets the path entirely) and the name half stays in
 * the box.
 */
function fselReturn(rt: Runtime, f: FselState, d: DialogChannel): void {
  const typed = fselZoneText(d, FS_FILE_ZONE)
  const cut = Math.max(typed.lastIndexOf('/'), typed.lastIndexOf(':'))
  if (cut < 0) {
    fselOk(rt, f, d)
    return
  }
  fselStore(rt, f, d)
  const pathPart = typed.slice(0, cut + 1)
  const namePart = typed.slice(cut + 1)
  fselNewName(rt, f, namePart)
  f.path = pathPart.includes(':') ? pathPart : joinAmigaPath(f.path, pathPart)
  f.filter = ''
  fselFirst(rt, f)
}

/**
 * Fs_Name (+Lib.s:18252): a row of the list was clicked. What it means
 * depends on Fs_DevFlag, and for a plain listing on the marker character the
 * row carries. A file click puts the name in the box; clicking the same row
 * again is the double-click — Fs_Click holds the last index and there is no
 * timer anywhere in the original.
 */
function fselName(rt: Runtime, f: FselState, d: DialogChannel): void {
  const list = d.zones.find((z) => z.kind === 'list')
  const idx = list?.pos ?? -1
  const e = idx >= 0 ? f.entries[idx] : undefined
  if (!e) return
  if (f.devFlag === 3) {
    // .Stored (18299): the row carries the cache entry it stands for
    if (e.storeIndex !== undefined) fselStoDir(rt, f, e.storeIndex)
    return
  }
  if (f.devFlag === 1 || f.devFlag === 2) {
    f.click = -1
    f.devFlag = 0
    f.path = e.name
    f.filter = ''
    fselFirst(rt, f)
    return
  }
  if (e.isDir) {
    fselStore(rt, f, d)
    f.path = joinAmigaPath(f.path, e.name)
    f.filter = ''
    fselFirst(rt, f)
    return
  }
  if (idx === f.click) {
    fselOk(rt, f, d)
    return
  }
  f.click = idx
  fselNewName(rt, f, e.name)
}

// ---------------------------------------------------------------------------
// The Store — a cache of directories already read (+Lib.s:18528-18706)
// ---------------------------------------------------------------------------

/**
 * One remembered directory. This is not a favourites list: it holds the whole
 * listing, so revisiting a drawer costs nothing, and `Fs_Branch` moves the
 * entry back out of the cache rather than copying it — which is what makes
 * the list an LRU, most recent first.
 *
 * It lives on the Runtime, not on the selector state, because Fs_Liste is a
 * global at a5 (+Equ.s:1210) and survives from one Fsel$ to the next.
 */
export interface FselStoreEntry {
  path: string
  filter: string
  entries: FselEntry[]
  /** FsV_PList at the moment it was put away */
  scroll: number
  /** FillFSorted at the moment it was put away */
  sorted: boolean
}

/** Fs_MaxStore (+Equ.s:2201) */
export const FS_MAX_STORE = 10

/** Fs_FindStore (18583): case-insensitive on both the path and the filter */
export function fselFindStore(rt: Runtime, path: string, filter: string): number {
  if (!rt.pi.FsStore) return -1
  const p = path.toUpperCase()
  const f = filter.toUpperCase()
  return rt.fselStore.findIndex((e) => e.path.toUpperCase() === p && e.filter.toUpperCase() === f)
}

/**
 * Fs_Store (18528): put the current listing away. Devices are never stored,
 * nor is an empty list; an entry for the same directory is replaced, and the
 * list is trimmed to Fs_MaxStore before the new head goes on.
 */
export function fselStore(rt: Runtime, f: FselState, d: DialogChannel): void {
  if (!rt.pi.FsStore || f.devFlag !== 0 || f.entries.length === 0) return
  const dup = fselFindStore(rt, f.path, f.filter)
  if (dup >= 0) rt.fselStore.splice(dup, 1)
  rt.fselStore.length = Math.min(rt.fselStore.length, FS_MAX_STORE - 1)
  rt.fselStore.unshift({
    path: f.path,
    filter: f.filter,
    entries: f.entries,
    scroll: Number(d.vars[FSV.pList]) || 0,
    sorted: f.sorted,
  })
  f.entries = []
  f.pending = []
  f.dirOn = false
}

/** Fs_Branch (18564): adopt a cached listing and take it out of the cache */
export function fselBranch(rt: Runtime, f: FselState, d: DialogChannel, i: number): void {
  const e = rt.fselStore[i]
  if (!e) return
  rt.fselStore.splice(i, 1)
  f.entries = e.entries
  f.pending = []
  f.sorted = e.sorted
  f.dirOn = false // the listing is already complete
  d.vars[FSV.pList] = e.scroll
}

/**
 * Fs_StoreList (18137): show the cache itself as the list. Each row is the
 * stored path and filter, and when that is longer than FsV_Tx the original
 * shows its *tail* — the end of a deep path is what tells you which one it is.
 */
export function fselStoreList(rt: Runtime, f: FselState, d: DialogChannel): void {
  if (!rt.pi.FsStore) return
  fselStore(rt, f, d)
  f.devFlag = 3
  f.click = -1
  f.dirOn = false
  f.pending = []
  f.sorted = true
  const tx = Number(d.vars[FSV.tx]) || 0
  f.entries = rt.fselStore.map((e, i) => {
    const full = e.path + e.filter
    return {
      name: tx > 0 && full.length > tx ? full.slice(full.length - tx) : full,
      isDir: false,
      size: 0,
      special: true, // bit 31: never sized
      storeIndex: i,
    }
  })
  d.vars[FSV.pList] = 0
  const list = d.zones.find((z) => z.kind === 'list')
  if (list) {
    list.scroll = 0
    list.sel = -1
    list.pos = -1
  }
  fselAffF(rt, f)
}

/** Fs_StoDir2 (18367): go to a stored directory, which consumes the entry */
export function fselStoDir(rt: Runtime, f: FselState, i: number): void {
  const e = rt.fselStore[i]
  if (!e) return
  f.devFlag = 0
  f.click = -1
  f.path = e.path
  f.filter = e.filter
  fselFirst(rt, f) // Fs_FindStore will match it and Fs_Branch adopt it
}

/**
 * Fs_Help (+Lib.s:17963) — type-ahead. Whatever is in the name box is looked
 * up as a prefix and the list scrolls to it.
 *
 * FillFFind (6433) compares the row *including* its marker character, and
 * Fs_Help prepends a space to the search string, so a directory (marker '*',
 * which FillFFind folds to chr(1)) can never match — type-ahead finds files
 * only. The search is case-insensitive.
 *
 * With sorting off the search starts just below the current top and wraps to
 * the beginning if that finds nothing, so repeated presses walk through the
 * matches; sorted, it always starts from the top. The found row is scrolled
 * to the top of the view unless that would run past the end.
 *
 * This is the only place FsV_PosFirst is ever given a real value, which is
 * what arms the view-stability bump in Fs_Next.
 */
export function fselHelp(rt: Runtime, f: FselState, d: DialogChannel): void {
  const typed = fselZoneText(d, FS_FILE_ZONE)
  const cut = Math.max(typed.lastIndexOf('/'), typed.lastIndexOf(':'))
  const name = cut < 0 ? typed : typed.slice(cut + 1)
  if (name === '') return
  const key = (' ' + name).toUpperCase()
  const hit = (e: FselEntry): boolean => ((e.isDir ? '\x01' : ' ') + e.name).toUpperCase().startsWith(key)
  let found = -1
  if (!f.sorted) {
    const from = (Number(d.vars[FSV.pList]) || 0) + 1
    found = f.entries.findIndex((e, i) => i >= from && hit(e))
  }
  if (found < 0) found = f.entries.findIndex(hit)
  if (found >= 0) {
    const ty = Number(d.vars[FSV.ty]) || 0
    const pos = Math.max(0, Math.min(found + ty, f.entries.length) - ty)
    d.vars[FSV.pList] = pos
    d.vars[FSV.posFirst] = pos
  }
  fselAffF(rt, f)
}

/**
 * AppCentre (+Lib.s:6820) — one step of the centre-out/centre-in slide the
 * selector and the text reader both open with.
 *
 * The screen itself never changes size: what moves is the displayed window.
 * Each step sets the shown height to twice the half-height, offsets into the
 * bitmap so the middle stays put, and lifts the top edge to match — so the
 * picture appears to grow out of its own centre line. The step is
 * PI_FsDVApp, clamped to 1 at the bottom and EcTy/2 at the top, and the loop
 * ends when clamping stops the value moving.
 *
 * Returns true when the slide has finished.
 */
export interface SlideState {
  half: number
  speed: number
  centreY: number
}

export function fselSlideStep(rt: Runtime, screenNb: number, s: SlideState | null): boolean {
  const sc = rt.screens.get(screenNb)
  if (!s || !sc) return true
  const halfMax = sc.height >> 1
  const prev = s.half
  sc.displayH = s.half * 2
  sc.offsetY = halfMax - s.half
  sc.displayY = s.centreY - s.half
  let next = s.half + s.speed
  if (next < 0) next = 1
  if (next > halfMax) next = halfMax
  s.half = next
  return next === prev
}

/** the state an opening slide starts from, for a screen of this height */
export const slideOpen = (sc: { displayY: number; height: number }, speed: number): SlideState => ({
  half: 1,
  speed,
  centreY: sc.displayY + (sc.height >> 1),
})

/** ...and a closing one */
export const slideShut = (sc: { displayY: number; height: number }, speed: number): SlideState => ({
  half: sc.height >> 1,
  speed: -speed,
  centreY: sc.displayY + (sc.height >> 1),
})

/** Fs_Appear (18963): grow from the centre line at PI_FsDVApp a step */
export function fselAppear(rt: Runtime, f: FselState): void {
  const sc = rt.screens.get(f.screenNb)
  if (!sc || rt.pi.FsDVApp <= 0) return
  f.slide = slideOpen(sc, rt.pi.FsDVApp)
}

/** Fs_DisAppear (18977): the same in reverse, from the full height */
export function fselDisAppear(rt: Runtime, f: FselState): void {
  const sc = rt.screens.get(f.screenNb)
  if (!sc || rt.pi.FsDVApp <= 0) return
  f.slide = slideShut(sc, rt.pi.FsDVApp)
}
