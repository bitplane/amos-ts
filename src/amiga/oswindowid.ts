/** OS DevKit's private high-level Window-ID records and copied event state. */

export interface OsWindowIdRecord {
  /** +0 struct Window pointer */
  base: number
  /** +4/$8 retained title allocations */
  title: number
  screenTitle: number
  /** +$c/$10/$14 private owned allocations */
  owned0: number
  owned1: number
  owned2: number
  /** +$18 caller data, exposed by `_wnd Id Data` */
  data: number
}

const blank = (): OsWindowIdRecord => ({
  base: 0, title: 0, screenTitle: 0, owned0: 0, owned1: 0, owned2: 0, data: 0,
})

/** The dynamically enlarged table built by routine 3042. */
export class OsWindowIds {
  readonly records: OsWindowIdRecord[] = []
  currentId = -1
  currentBase = 0
  currentRastPort = 0

  record(id: number): OsWindowIdRecord | null {
    if (id < 0) return null
    while (this.records.length <= id) this.records.push(blank())
    return this.records[id]!
  }

  attach(id: number, base: number, rastPort: number): OsWindowIdRecord | null {
    const r = this.record(id)
    if (!r) return null
    r.base = base >>> 0
    this.use(id, rastPort)
    return r
  }

  close(id: number): OsWindowIdRecord | null {
    const r = this.record(id)
    if (!r || r.base === 0) return null
    const old = { ...r }
    Object.assign(r, blank())
    if (this.currentId === id) {
      this.currentId = -1
      this.currentBase = 0
      this.currentRastPort = 0
    }
    return old
  }

  base(id: number): number { return this.record(id)?.base ?? 0 }

  use(id: number, rastPort: number): boolean {
    const r = this.record(id)
    if (!r || r.base === 0) return false
    this.currentId = id | 0
    this.currentBase = r.base
    this.currentRastPort = rastPort >>> 0
    return true
  }

  setData(id: number, value: number): boolean {
    const r = this.record(id)
    if (!r) return false
    r.data = value >>> 0
    return true
  }

  data(id: number): number { return this.record(id)?.data ?? 0 }
}

/** The two private eight-word AreaPtrn halves written by routines 3107-3108. */
export class OsWindowPatterns {
  readonly low = new Uint16Array(8)
  readonly high = new Uint16Array(8)

  setLow(values: readonly number[]): void {
    for (let i = 0; i < 8; i++) this.low[i] = values[i] ?? 0
  }

  setHigh(values: readonly number[]): void {
    for (let i = 0; i < 8; i++) this.high[i] = values[i] ?? 0
  }
}

/** The fields OS DevKit retains after copying an IntuiMessage (routine 3056). */
export interface OsWindowEvent {
  class: number
  code: number
  qualifier: number
  gadgetId: number | null
  gadgetUserData: number | null
  windowId: number
  mouseX: number
  mouseY: number
}

export const eventCode = (e: OsWindowEvent): number => e.code & 0xffff
export const eventQualifier = (e: OsWindowEvent): number => e.qualifier & 0xffff
export const eventGadget = (e: OsWindowEvent): number => e.gadgetId === null ? -1 : e.gadgetId & 0xffff
export const eventGadgetBank = (e: OsWindowEvent): number => e.gadgetUserData === null ? -1 : e.gadgetUserData | 0
export const eventWindow = (e: OsWindowEvent): number => e.windowId | 0
export const eventMouseX = (e: OsWindowEvent): number => (e.mouseX << 16) >> 16
export const eventMouseY = (e: OsWindowEvent): number => (e.mouseY << 16) >> 16

/** MENUNUM/ITEMNUM/SUBNUM, including OS DevKit's -1 sentinel policy. */
export function eventMenu(e: OsWindowEvent): number {
  if ((e.class >>> 0) !== 0x100) return -1
  const n = e.code & 0x1f
  return n === 0x1f ? -1 : n
}

export function eventItem(e: OsWindowEvent): number {
  if ((e.class >>> 0) !== 0x100) return -1
  const n = (e.code >>> 5) & 0x3f
  return n === 0x3f ? -1 : n
}

export function eventSub(e: OsWindowEvent): number {
  if ((e.class >>> 0) !== 0x100) return -1
  const n = (e.code >>> 11) & 0x1f
  return n === 0x1f ? -1 : n
}
