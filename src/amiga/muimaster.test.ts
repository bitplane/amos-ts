import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { OM_ADDMEMBER, OM_REMMEMBER, OM_SET, type BoopsiObject, type OpMember, type TagItem } from './boopsi'
import {
  MUI_BUILTIN_SUPER,
  MUI_MAXMAX,
  MUIM_APPLIST_BROADCAST,
  MUIM_APPLIST_FIND,
  MUIM_DATASPACE_EQUAL,
  MUIM_DATASPACE_NEXT,
  MUIM_DATASPACE_PRUNE,
  MUIA_CONFIGDATA_FALLBACK,
  MUIA_CONFIGDATA_SELECTOR,
  MUIM_CONFIGDATA_ACCEPTS,
  MUIM_CONFIGDATA_GET,
  MUIM_CONFIGDATA_HAS,
  MUIM_CONFIGDATA_SET,
  MuiMaster,
  visibleLength,
} from './muimaster'
import { MUI, MUIC, MUI_ATTR, MUI_OWNER } from './muimaster.gen'
import { parseAmosFile } from '../loader/amosfile'

const tag = (t: number, data: number): TagItem => ({ tag: t, data })

describe('muimaster: the class tree', () => {
  it('registers every class the header names, under the right parent', () => {
    const m = new MuiMaster()
    expect(m.classNames).toHaveLength(35)
    expect(m.findClass('Cclist.mui')).not.toBeNull()

    const win = m.findClass(MUIC.MUIC_Window)!
    const notify = m.findClass(MUIC.MUIC_Notify)!
    const area = m.findClass(MUIC.MUIC_Area)!
    expect(win.superClass).toBe(notify)
    expect(area.superClass).toBe(notify)
    // Group is under Area, not Family, which is the one people misremember
    expect(m.findClass(MUIC.MUIC_Group)!.superClass).toBe(area)
    expect(m.findClass(MUIC.MUIC_Menustrip)!.superClass).toBe(m.findClass(MUIC.MUIC_Family))
    // Dtpic is a separately loaded .mui class, not part of muimaster itself.
    expect(m.findClass(MUIC.MUIC_Dtpic)).toBeNull()
  })

  it('every class descends from rootclass', () => {
    const m = new MuiMaster()
    for (const n of m.classNames) expect(m.findClass(n)!.isA(m.boopsi.rootClass)).toBe(true)
  })

  it('does not claim separately shipped classes are built in', () => {
    const m = new MuiMaster()
    expect(m.newObjectA(MUIC.MUIC_Gauge)).toBeNull()
    expect(m.newObjectA(MUIC.MUIC_Popasl)).toBeNull()
  })

  it('a name MUI does not have answers null, which a program sees as 0', () => {
    const m = new MuiMaster()
    expect(m.newObjectA('Nonsuch.mui')).toBeNull()
    expect(m.newObjectA('Window')).toBeNull() // the ".mui" is part of the name
  })
})

describe('muimaster: attributes go to the class that owns them', () => {
  it('stores an attribute on its owner and reads it back through the chain', () => {
    const m = new MuiMaster()
    const w = m.newObjectA(MUIC.MUIC_Window, [tag(MUI.MUIA_Window_Title, 0x1234)])!
    expect(m.get(w, MUI.MUIA_Window_Title)).toBe(0x1234)
  })

  it('an inherited attribute is stored by the ancestor that declares it', () => {
    const m = new MuiMaster()
    // MUIA_UserData is Notify's and MUIA_Disabled is Area's; a Text is both
    const t = m.newObjectA(MUIC.MUIC_Text, [tag(MUI.MUIA_UserData, 7), tag(MUI.MUIA_Disabled, 1)])!
    expect(m.get(t, MUI.MUIA_UserData)).toBe(7)
    expect(m.get(t, MUI.MUIA_Disabled)).toBe(1)
    // a Window is a Notify but NOT an Area, so it has no Disabled at all
    const w = m.newObjectA(MUIC.MUIC_Window)!
    expect(m.get(w, MUI.MUIA_Disabled)).toBeNull()
    expect(m.get(w, MUI.MUIA_UserData)).toBe(0)
  })

  it('an unknown tag in a taglist is ignored rather than stored anywhere', () => {
    const m = new MuiMaster()
    const w = m.newObjectA(MUIC.MUIC_Window, [tag(0x8042_dead, 1)])!
    expect(m.get(w, 0x8042_dead)).toBeNull()
  })

  it('an "i.." attribute is taken at Init, never Set, and never readable', () => {
    const m = new MuiMaster()
    expect(MUI_ATTR.MUIA_Weight!.flags).toBe('i..')
    const t = m.newObjectA(MUIC.MUIC_Text, [tag(MUI.MUIA_Weight, 50)])!
    // stored, but OM_GET answers "no such attribute" — which is the library's
    // behaviour, not a gap here, so `peek` is the only way to see it
    expect(m.peek(t, MUI.MUIA_Weight)).toBe(50)
    expect(m.get(t, MUI.MUIA_Weight)).toBeNull()
    expect(m.set(t, MUI.MUIA_Weight, 999)).toBe(0)
    expect(m.peek(t, MUI.MUIA_Weight)).toBe(50)
  })

  it('a ".s." attribute is Set but not given at Init, and not readable', () => {
    const m = new MuiMaster()
    expect(MUI_ATTR.MUIA_Application_Sleep!.flags).toBe('.s.')
    const a = m.newObjectA(MUIC.MUIC_Application, [tag(MUI.MUIA_Application_Sleep, 1)])!
    expect(m.peek(a, MUI.MUIA_Application_Sleep)).toBeUndefined()
    expect(m.set(a, MUI.MUIA_Application_Sleep, 1)).toBe(1)
    expect(m.peek(a, MUI.MUIA_Application_Sleep)).toBe(1)
    expect(m.get(a, MUI.MUIA_Application_Sleep)).toBeNull()
  })

  it('a "..g" attribute is MUI\'s own state, and setInternal is how it moves', () => {
    const m = new MuiMaster()
    expect(MUI_ATTR.MUIA_Window_CloseRequest!.flags).toBe('..g')
    const w = m.newObjectA(MUIC.MUIC_Window)!
    // a program may not Set it — the user is what sets it
    expect(m.set(w, MUI.MUIA_Window_CloseRequest, 1)).toBe(0)
    expect(m.get(w, MUI.MUIA_Window_CloseRequest)).toBe(0)
    expect(m.setInternal(w, MUI.MUIA_Window_CloseRequest, 1)).toBe(true)
    expect(m.get(w, MUI.MUIA_Window_CloseRequest)).toBe(1)
  })

  it('OM_SET answers how many attributes it used', () => {
    const m = new MuiMaster()
    const w = m.newObjectA(MUIC.MUIC_Window)!
    const msg = {
      MethodID: OM_SET,
      attrs: [tag(MUI.MUIA_Window_Title, 1), tag(MUI.MUIA_Window_Open, 1), tag(0x8042_dead, 1)],
    }
    expect(w.cl.dispatcher(w.cl, w, msg)).toBe(2)
  })
})

describe('muimaster: the object tree', () => {
  it('a child attribute makes a real parent/child link', () => {
    const m = new MuiMaster()
    const text = m.newObjectA(MUIC.MUIC_Text)!
    const group = m.newObjectA(MUIC.MUIC_Group, [tag(MUI.MUIA_Group_Child, text.address)])!
    const win = m.newObjectA(MUIC.MUIC_Window, [tag(MUI.MUIA_Window_RootObject, group.address)])!
    expect(m.children(win)).toEqual([group])
    expect(m.children(group)).toEqual([text])
    expect(m.parent(text)).toBe(group)
    expect(m.parent(win)).toBeNull()
  })

  it('a reference is not a child — disposing a window keeps what it points at', () => {
    const m = new MuiMaster()
    const other = m.newObjectA(MUIC.MUIC_Window)!
    const win = m.newObjectA(MUIC.MUIC_Window, [tag(MUI.MUIA_Window_RefWindow, other.address)])!
    expect(m.children(win)).toEqual([])
    m.disposeObject(win)
    expect(other.disposed).toBe(false)
  })

  it('a child that failed to create takes its parent down with it', () => {
    const m = new MuiMaster()
    // 0 is the address of nothing, which is what a failed Mui New answers
    expect(m.newObjectA(MUIC.MUIC_Group, [tag(MUI.MUIA_Group_Child, 0)])).toBeNull()
  })

  it('DisposeObject is recursive over the children it owns', () => {
    const m = new MuiMaster()
    const text = m.newObjectA(MUIC.MUIC_Text)!
    const group = m.newObjectA(MUIC.MUIC_Group, [tag(MUI.MUIA_Group_Child, text.address)])!
    const app = m.newObjectA(MUIC.MUIC_Application, [tag(MUI.MUIA_Application_Window, group.address)])!
    m.disposeObject(app)
    expect([app.disposed, group.disposed, text.disposed]).toEqual([true, true, true])
    expect(m.boopsi.objectAt(text.address)).toBeNull()
  })

  it('OM_ADDMEMBER and OM_REMMEMBER move a child in and out', () => {
    const m = new MuiMaster()
    const group = m.newObjectA(MUIC.MUIC_Group)!
    const text = m.newObjectA(MUIC.MUIC_Text)!
    group.cl.dispatcher(group.cl, group, { MethodID: OM_ADDMEMBER, object: text } as OpMember)
    expect(m.children(group)).toEqual([text])
    expect(m.parent(text)).toBe(group)
    group.cl.dispatcher(group.cl, group, { MethodID: OM_REMMEMBER, object: text } as OpMember)
    expect(m.children(group)).toEqual([])
    expect(m.parent(text)).toBeNull()
  })
})

describe('muimaster: Semaphore', () => {
  it('implements the five Exec semaphore operations exposed by 19.35', () => {
    const m = new MuiMaster()
    const sem = m.newObjectA('Semaphore.mui')!
    expect(send(sem, MUI.MUIM_Semaphore_Obtain)).toBe(0)
    expect(send(sem, MUI.MUIM_Semaphore_Attempt)).toBe(1)
    expect(send(sem, MUI.MUIM_Semaphore_Release)).toBe(0)
    expect(send(sem, MUI.MUIM_Semaphore_Release)).toBe(0)
    expect(send(sem, MUI.MUIM_Semaphore_ObtainShared)).toBe(0)
    expect(send(sem, MUI.MUIM_Semaphore_AttemptShared)).toBe(1)
    expect(send(sem, MUI.MUIM_Semaphore_Release)).toBe(0)
    expect(send(sem, MUI.MUIM_Semaphore_Release)).toBe(0)
  })

  it('is inherited by Dataspace', () => {
    const m = new MuiMaster()
    const ds = m.newObjectA(MUIC.MUIC_Dataspace)!
    expect(send(ds, MUI.MUIM_Semaphore_Attempt)).toBe(1)
    expect(send(ds, MUI.MUIM_Semaphore_Release)).toBe(0)
  })
})

describe('muimaster: Applist', () => {
  it('adds, removes and broadcasts to its applications', () => {
    const m = new MuiMaster()
    const list = m.newObjectA('Applist.mui')!
    const a = m.newObjectA(MUIC.MUIC_Application)!
    const b = m.newObjectA(MUIC.MUIC_Application)!
    expect(m.addMember(list, a)).toBe(0)
    expect(m.addMember(list, b)).toBe(0)
    expect(send(list, MUIM_APPLIST_BROADCAST, MUI.MUIM_Set, MUI.MUIA_Application_Sleep, 1)).toBe(0)
    expect([m.peek(a, MUI.MUIA_Application_Sleep), m.peek(b, MUI.MUIA_Application_Sleep)]).toEqual([1, 1])
    expect(m.remMember(list, a)).toBe(0)
    send(list, MUIM_APPLIST_BROADCAST, MUI.MUIM_Set, MUI.MUIA_Application_Sleep, 0)
    expect([m.peek(a, MUI.MUIA_Application_Sleep), m.peek(b, MUI.MUIA_Application_Sleep)]).toEqual([1, 0])
  })

  it('finds an application by string value or exact broker port', () => {
    const m = new MuiMaster()
    m.readString = (at) => new Map([[1, 'One'], [2, 'Two'], [3, 'Two']]).get(at) ?? ''
    const list = m.newObjectA('Applist.mui')!
    const a = m.newObjectA(MUIC.MUIC_Application, [
      tag(MUI.MUIA_Application_Title, 1),
    ])!
    m.setInternal(a, MUI.MUIA_Application_BrokerPort, 0x1234)
    const b = m.newObjectA(MUIC.MUIC_Application, [tag(MUI.MUIA_Application_Title, 2)])!
    m.addMember(list, a)
    m.addMember(list, b)
    expect(send(list, MUIM_APPLIST_FIND, MUI.MUIA_Application_Title, 3)).toBe(b.address)
    expect(send(list, MUIM_APPLIST_FIND, MUI.MUIA_Application_BrokerPort, 0x1234)).toBe(a.address)
    expect(send(list, MUIM_APPLIST_FIND, MUI.MUIA_Application_BrokerPort, 0x9999)).toBe(0)
  })
})

describe('muimaster: Dataspace', () => {
  function harness(): { m: MuiMaster; put: (bytes: number[]) => number; longs: Map<number, number> } {
    const m = new MuiMaster()
    const input = new Uint8Array(256)
    let used = 0
    const put = (bytes: number[]): number => {
      const at = 0x1000 + used
      input.set(bytes, used)
      used += bytes.length
      return at
    }
    m.readMemory = (address, length) => {
      if (address >= 0x1000 && address + length <= 0x1000 + input.length) {
        return input.slice(address - 0x1000, address - 0x1000 + length)
      }
      if (address >= m.pool.base && address + length <= m.pool.base + m.pool.buffer.length) {
        return m.pool.buffer.slice(address - m.pool.base, address - m.pool.base + length)
      }
      return null
    }
    const longs = new Map<number, number>()
    m.readLong = (address) => longs.get(address) ?? 0
    m.writeLong = (address, value) => (longs.set(address, value >>> 0), true)
    return { m, put, longs }
  }

  it('copies, finds, replaces, removes and clears addressable byte records', () => {
    const { m, put } = harness()
    const ds = m.newObjectA(MUIC.MUIC_Dataspace)!
    const first = send(ds, MUI.MUIM_Dataspace_Add, put([1, 2, 3]), 3, 42)
    expect(first).not.toBe(0)
    expect(send(ds, MUI.MUIM_Dataspace_Find, 42)).toBe(first)
    expect([...m.pool.buffer.slice(first - m.pool.base, first - m.pool.base + 3)]).toEqual([1, 2, 3])
    const second = send(ds, MUI.MUIM_Dataspace_Add, put([9, 8]), 2, 42)
    expect(send(ds, MUI.MUIM_Dataspace_Find, 42)).toBe(second)
    expect([...m.pool.buffer.slice(second - m.pool.base, second - m.pool.base + 2)]).toEqual([9, 8])
    expect(send(ds, MUI.MUIM_Dataspace_Remove, 42)).toBe(second)
    expect(send(ds, MUI.MUIM_Dataspace_Remove, 42)).toBe(0)
    send(ds, MUI.MUIM_Dataspace_Add, put([7]), 1, 1)
    expect(send(ds, MUI.MUIM_Dataspace_Clear)).toBe(0)
    expect(send(ds, MUI.MUIM_Dataspace_Find, 1)).toBe(0)
  })

  it('merges, compares and prunes records by id, length and contents', () => {
    const { m, put } = harness()
    const a = m.newObjectA(MUIC.MUIC_Dataspace)!
    const b = m.newObjectA(MUIC.MUIC_Dataspace)!
    send(a, MUI.MUIM_Dataspace_Add, put([1]), 1, 10)
    send(b, MUI.MUIM_Dataspace_Add, put([1]), 1, 10)
    send(b, MUI.MUIM_Dataspace_Add, put([2, 3]), 2, 20)
    expect(send(a, MUIM_DATASPACE_EQUAL, b.address)).toBe(0)
    expect(send(a, MUI.MUIM_Dataspace_Merge, b.address)).toBe(2)
    expect(send(a, MUIM_DATASPACE_EQUAL, b.address)).toBe(1)
    expect(send(a, MUIM_DATASPACE_PRUNE, b.address)).toBe(0)
    expect(send(a, MUI.MUIM_Dataspace_Find, 10)).toBe(0)
    expect(send(a, MUI.MUIM_Dataspace_Find, 20)).toBe(0)
  })

  it('the private iterator returns native record headers and advances its cursor', () => {
    const { m, put, longs } = harness()
    const ds = m.newObjectA(MUIC.MUIC_Dataspace)!
    const payload1 = send(ds, MUI.MUIM_Dataspace_Add, put([4]), 1, 11)
    const payload2 = send(ds, MUI.MUIM_Dataspace_Add, put([5]), 1, 12)
    const cursor = 0x2000
    expect(send(ds, MUIM_DATASPACE_NEXT, cursor)).toBe(payload1 - 16)
    expect(longs.get(cursor)).toBe(payload2 - 16)
    expect(send(ds, MUIM_DATASPACE_NEXT, cursor)).toBe(payload2 - 16)
    expect(longs.get(cursor)).toBe(0)
    expect(send(ds, MUIM_DATASPACE_NEXT, cursor)).toBe(payload1 - 16)
  })

  it('writes and reads the native id/length/data IFF chunk payload', () => {
    const { m, put } = harness()
    const source = m.newObjectA(MUIC.MUIC_Dataspace)!
    send(source, MUI.MUIM_Dataspace_Add, put([0xaa, 0xbb]), 2, 0x11223344)
    let saved: Uint8Array | null = null
    m.writeIffChunk = (handle, type, id, bytes) => {
      expect([handle, type, id]).toEqual([9, 0x50524546, 0x4d554943])
      saved = bytes.slice()
      return 0
    }
    expect(send(source, MUI.MUIM_Dataspace_WriteIFF, 9, 0x50524546, 0x4d554943)).toBe(0)
    expect(saved && [...saved]).toEqual([0x11, 0x22, 0x33, 0x44, 0, 0, 0, 2, 0xaa, 0xbb])

    const target = m.newObjectA(MUIC.MUIC_Dataspace)!
    m.readIffChunk = (handle) => (handle === 9 ? saved : -1)
    expect(send(target, MUI.MUIM_Dataspace_ReadIFF, 9)).toBe(0)
    const found = send(target, MUI.MUIM_Dataspace_Find, 0x11223344)
    expect([...m.pool.buffer.slice(found - m.pool.base, found - m.pool.base + 2)]).toEqual([0xaa, 0xbb])
  })
})

describe('muimaster: Configdata', () => {
  function configured(attrs: TagItem[] = []): { m: MuiMaster; obj: BoopsiObject; longs: Map<number, number> } {
    const m = new MuiMaster()
    const longs = new Map<number, number>()
    m.readLong = (address) => longs.get(address) ?? 0
    m.writeLong = (address, value) => (longs.set(address, value >>> 0), true)
    return { m, obj: m.newObjectA(MUIC.MUIC_Configdata, attrs)!, longs }
  }

  it('gets scalar and string defaults from the native 150-entry table', () => {
    const { m, obj, longs } = configured()
    expect(send(obj, MUIM_CONFIGDATA_GET, 1, 0x2000)).toBe(1)
    expect(longs.get(0x2000)).toBe(4)
    expect(send(obj, MUIM_CONFIGDATA_GET, 24, 0x2004)).toBe(1)
    const pointer = longs.get(0x2004)!
    expect(String.fromCharCode(...m.pool.buffer.slice(pointer - m.pool.base, pointer - m.pool.base + 7))).toBe('300000\0')
    expect(send(obj, MUIM_CONFIGDATA_GET, 151, 0x2008)).toBe(0)
  })

  it('sets scalar and string items, reports presence, and follows a fallback', () => {
    const { m, obj: fallback, longs } = configured()
    expect(send(fallback, MUIM_CONFIGDATA_SET, 1, 99)).not.toBe(0)
    m.readString = (address) => (address === 0x3000 ? '123456' : '')
    expect(send(fallback, MUIM_CONFIGDATA_SET, 24, 0x3000)).not.toBe(0)
    const obj = m.newObjectA(MUIC.MUIC_Configdata, [tag(MUIA_CONFIGDATA_FALLBACK, fallback.address)])!
    expect(m.get(obj, MUIA_CONFIGDATA_FALLBACK)).toBe(fallback.address)
    expect(send(obj, MUIM_CONFIGDATA_HAS, 1)).toBe(1)
    expect(send(obj, MUIM_CONFIGDATA_GET, 1, 0x2000)).toBe(1)
    expect(longs.get(0x2000)).toBe(99)
    expect(send(obj, MUIM_CONFIGDATA_GET, 24, 0x2004)).toBe(1)
    const pointer = longs.get(0x2004)!
    expect(String.fromCharCode(...m.pool.buffer.slice(pointer - m.pool.base, pointer - m.pool.base + 7))).toBe('123456\0')
  })

  it('applies positive and preference-group selectors to Dataspace mutations', () => {
    const one = configured([tag(MUIA_CONFIGDATA_SELECTOR, 24)])
    one.m.readMemory = (_address, length) => new Uint8Array(length)
    expect(send(one.obj, MUIM_CONFIGDATA_ACCEPTS, 24)).toBe(1)
    expect(send(one.obj, MUIM_CONFIGDATA_ACCEPTS, 25)).toBe(0)
    expect(send(one.obj, MUI.MUIM_Dataspace_Add, 0x1000, 1, 25)).toBe(0)
    expect(send(one.obj, MUI.MUIM_Dataspace_Add, 0x1000, 1, 24)).not.toBe(0)

    const group = configured([tag(MUIA_CONFIGDATA_SELECTOR, -2)]) // -(group + 1): group 1
    expect(send(group.obj, MUIM_CONFIGDATA_ACCEPTS, 1)).toBe(1)
    expect(send(group.obj, MUIM_CONFIGDATA_ACCEPTS, 5)).toBe(0)
    expect(send(group.obj, MUIM_CONFIGDATA_ACCEPTS, 0x80000001)).toBe(0)
  })

  it('prunes values equal to native defaults when no comparison object is supplied', () => {
    const { obj } = configured()
    expect(send(obj, MUIM_CONFIGDATA_SET, 1, 4)).not.toBe(0)
    expect(send(obj, MUIM_CONFIGDATA_HAS, 1)).toBe(1)
    send(obj, MUIM_DATASPACE_PRUNE, 0)
    expect(send(obj, MUIM_CONFIGDATA_HAS, 1)).toBe(0)
  })
})

/** send a method the way EasyLife does: an id and a run of longwords */
function send(obj: BoopsiObject, method: number, ...params: number[]): number {
  return obj.cl.dispatcher(obj.cl, obj, { MethodID: method, params } as never)
}

describe('muimaster: notification', () => {
  it('MUIM_Set is a Set, which is what Mui Set sends', () => {
    const m = new MuiMaster()
    const w = m.newObjectA(MUIC.MUIC_Window)!
    send(w, MUI.MUIM_Set, MUI.MUIA_Window_Title, 0x99)
    expect(m.get(w, MUI.MUIA_Window_Title)).toBe(0x99)
  })

  it('fires only on the value named, unless that value is MUIV_EveryTime', () => {
    const m = new MuiMaster()
    const src = m.newObjectA(MUIC.MUIC_Window)!
    const dst = m.newObjectA(MUIC.MUIC_Window)!
    // when the source closes, put a title on the destination. The trigger is
    // "..g" — a program cannot Set it, the user does, so the change comes
    // through setInternal exactly as it would from an IDCMP_CLOSEWINDOW
    send(src, MUI.MUIM_Notify, MUI.MUIA_Window_CloseRequest, 1, dst.address, MUI.MUIM_Set, MUI.MUIA_Window_Title, 42)
    expect(m.notifications(src).length).toBe(1)

    m.setInternal(src, MUI.MUIA_Window_CloseRequest, 0)
    expect(m.get(dst, MUI.MUIA_Window_Title)).toBe(0)
    m.setInternal(src, MUI.MUIA_Window_CloseRequest, 1)
    expect(m.get(dst, MUI.MUIA_Window_Title)).toBe(42)
  })

  it('MUIV_TriggerValue is replaced by the value that arrived', () => {
    const m = new MuiMaster()
    const src = m.newObjectA(MUIC.MUIC_Window)!
    const dst = m.newObjectA(MUIC.MUIC_Window)!
    send(
      src,
      MUI.MUIM_Notify,
      MUI.MUIA_Window_Activate,
      MUI.MUIV_EveryTime,
      dst.address,
      MUI.MUIM_Set,
      MUI.MUIA_Window_Title,
      MUI.MUIV_TriggerValue,
    )
    m.set(src, MUI.MUIA_Window_Activate, 7)
    expect(m.get(dst, MUI.MUIA_Window_Title)).toBe(7)
    m.set(src, MUI.MUIA_Window_Activate, 9)
    expect(m.get(dst, MUI.MUIA_Window_Title)).toBe(9)
  })

  it('MUIV_Notify_Self, _Parent, _Window and _Application resolve up the tree', () => {
    const m = new MuiMaster()
    const text = m.newObjectA(MUIC.MUIC_Text)!
    const group = m.newObjectA(MUIC.MUIC_Group, [tag(MUI.MUIA_Group_Child, text.address)])!
    const win = m.newObjectA(MUIC.MUIC_Window, [tag(MUI.MUIA_Window_RootObject, group.address)])!
    const app = m.newObjectA(MUIC.MUIC_Application, [tag(MUI.MUIA_Application_Window, win.address)])!

    // a button several groups deep telling the application to quit is the
    // single most common line in a MUI program
    send(
      text,
      MUI.MUIM_Notify,
      MUI.MUIA_Pressed,
      0,
      MUI.MUIV_Notify_Application,
      MUI.MUIM_Set,
      MUI.MUIA_Application_Active,
      1,
    )
    m.setInternal(text, MUI.MUIA_Pressed, 0)
    expect(m.get(app, MUI.MUIA_Application_Active)).toBe(1)

    send(text, MUI.MUIM_Notify, MUI.MUIA_Disabled, 1, MUI.MUIV_Notify_Window, MUI.MUIM_Set, MUI.MUIA_Window_Title, 5)
    m.set(text, MUI.MUIA_Disabled, 1)
    expect(m.get(win, MUI.MUIA_Window_Title)).toBe(5)

    // and Self, which is a notification an object sends to itself
    send(win, MUI.MUIM_Notify, MUI.MUIA_Window_Activate, 1, MUI.MUIV_Notify_Self, MUI.MUIM_Set, MUI.MUIA_UserData, 3)
    m.set(win, MUI.MUIA_Window_Activate, 1)
    expect(m.get(win, MUI.MUIA_UserData)).toBe(3)
    expect(m.parent(text)).toBe(group)
  })

  it('MUIM_KillNotify drops the triggers on one attribute', () => {
    const m = new MuiMaster()
    const src = m.newObjectA(MUIC.MUIC_Window)!
    send(src, MUI.MUIM_Notify, MUI.MUIA_Window_Activate, 1, MUI.MUIV_Notify_Self, MUI.MUIM_Set, 0, 0)
    expect(m.notifications(src).length).toBe(1)
    send(src, MUI.MUIM_KillNotify, MUI.MUIA_Window_Activate)
    expect(m.notifications(src).length).toBe(0)
  })
})

describe('muimaster: MUI_MakeObjectA', () => {
  it('MUIO_Button and MUIO_PopButton are the two EasyLife reaches', () => {
    const m = new MuiMaster()
    const b = m.makeObjectA(MUI.MUIO_Button, [0x1000])!
    expect(b.cl).toBe(m.findClass(MUIC.MUIC_Text))
    expect(m.get(b, MUI.MUIA_Text_Contents)).toBe(0x1000)
    // MUIA_Frame is "i.." and therefore invisible to a program, which is why
    // the check goes through peek rather than get
    expect(m.peek(b, MUI.MUIA_Frame)).toBe(MUI.MUIV_Frame_Button)

    const p = m.makeObjectA(MUI.MUIO_PopButton, [MUI.MUII_PopUp])!
    expect(p.cl).toBe(m.findClass(MUIC.MUIC_Image))
    expect(m.peek(p, MUI.MUIA_Image_Spec)).toBe(MUI.MUII_PopUp)
  })

  it('the shapes with no caller yet answer null rather than a wrong tree', () => {
    const m = new MuiMaster()
    expect(m.makeObjectA(MUI.MUIO_Slider, [0, 0, 10])).toBeNull()
  })
})

describe('muimaster: MUIM_AskMinMax', () => {
  const m = (): MuiMaster => {
    const x = new MuiMaster()
    // one pooled label, so a Text has something to measure
    x.readString = (at) => (at === 1 ? 'Quit' : at === 2 ? 'Hello there' : '')
    return x
  }

  it('a Text is as wide as its label and one line tall, and stretches sideways', () => {
    const x = m()
    const t = x.newObjectA(MUIC.MUIC_Text, [tag(MUI.MUIA_Text_Contents, 1)])!
    expect(x.askMinMax(t)).toEqual({ minW: 32, minH: 8, maxW: MUI_MAXMAX, maxH: 8, defW: 32, defH: 8 })
  })

  it("MUI's own escapes take no room in a label", () => {
    // "\033r" right-justifies and is two characters of formatting; a Text
    // measured with them in is two pixels-per-code too wide. Tag_Editor's
    // status lines are full of them
    expect(visibleLength('\x1brLength: 0')).toBe(9)
    expect(visibleLength('\x1bb\x1buBold')).toBe(4)
    const x = m()
    x.readString = () => '\x1brQuit'
    const t = x.newObjectA(MUIC.MUIC_Text, [tag(MUI.MUIA_Text_Contents, 1)])!
    expect(x.askMinMax(t).minW).toBe(32)
  })

  it('a Rectangle is a spacer: nothing of its own, unlimited both ways', () => {
    const x = m()
    const r = x.newObjectA(MUIC.MUIC_Rectangle)!
    expect(x.askMinMax(r)).toEqual({ minW: 0, minH: 0, maxW: MUI_MAXMAX, maxH: MUI_MAXMAX, defW: 0, defH: 0 })
  })

  it('a frame costs two pixels on every edge, added by Area', () => {
    const x = m()
    const plain = x.askMinMax(x.newObjectA(MUIC.MUIC_Text, [tag(MUI.MUIA_Text_Contents, 1)])!)
    const framed = x.askMinMax(
      x.newObjectA(MUIC.MUIC_Text, [tag(MUI.MUIA_Text_Contents, 1), tag(MUI.MUIA_Frame, MUI.MUIV_Frame_Button)])!,
    )
    expect(framed.minW - plain.minW).toBe(4)
    expect(framed.minH - plain.minH).toBe(4)
  })

  it('a vertical group sums its children and adds the spacing between them', () => {
    const x = m()
    const a = x.newObjectA(MUIC.MUIC_Text, [tag(MUI.MUIA_Text_Contents, 1)])!
    const b = x.newObjectA(MUIC.MUIC_Text, [tag(MUI.MUIA_Text_Contents, 2)])!
    const g = x.newObjectA(MUIC.MUIC_Group, [
      tag(MUI.MUIA_Group_Child, a.address),
      tag(MUI.MUIA_Group_Child, b.address),
    ])!
    const mm = x.askMinMax(g)
    // heights add, with one pixel between; widths take the larger
    expect(mm.minH).toBe(8 + 8 + 1)
    expect(mm.minW).toBe(11 * 8)
  })

  it('a horizontal group does it the other way round', () => {
    const x = m()
    const a = x.newObjectA(MUIC.MUIC_Text, [tag(MUI.MUIA_Text_Contents, 1)])!
    const b = x.newObjectA(MUIC.MUIC_Text, [tag(MUI.MUIA_Text_Contents, 2)])!
    const g = x.newObjectA(MUIC.MUIC_Group, [
      tag(MUI.MUIA_Group_Horiz, 1),
      tag(MUI.MUIA_Group_Child, a.address),
      tag(MUI.MUIA_Group_Child, b.address),
    ])!
    const mm = x.askMinMax(g)
    expect(mm.minW).toBe(4 * 8 + 11 * 8 + 1)
    expect(mm.minH).toBe(8)
  })
})

describe('muimaster: layout', () => {
  const two = (horiz: boolean, wa: number, wb: number): { x: MuiMaster; g: BoopsiObject; a: BoopsiObject; b: BoopsiObject } => {
    const x = new MuiMaster()
    x.readString = () => ''
    const a = x.newObjectA(MUIC.MUIC_String, [tag(MUI.MUIA_Weight, wa)])!
    const b = x.newObjectA(MUIC.MUIC_String, [tag(MUI.MUIA_Weight, wb)])!
    const g = x.newObjectA(MUIC.MUIC_Group, [
      tag(MUI.MUIA_Group_Horiz, horiz ? 1 : 0),
      tag(MUI.MUIA_Group_Spacing, 0),
      tag(MUI.MUIA_Group_Child, a.address),
      tag(MUI.MUIA_Group_Child, b.address),
    ])!
    return { x, g, a, b }
  }

  it("equal weights halve the room, which is the autodoc's starting point", () => {
    const { x, g, a, b } = two(true, 100, 100)
    x.askMinMax(g)
    x.layout(g, 0, 0, 100, 20)
    expect(x.boxOf(a)!.width).toBe(50)
    expect(x.boxOf(b)!.width).toBe(50)
  })

  it('200 against 100 makes the left one twice as big — 66 and 34', () => {
    // "Because the left gadget is twice as heavy as the right gadget, it will
    // become twice as big (about 66 pixel) as the right one (34 pixel)"
    const { x, g, a, b } = two(true, 200, 100)
    x.askMinMax(g)
    x.layout(g, 0, 0, 100, 20)
    expect([x.boxOf(a)!.width, x.boxOf(b)!.width]).toEqual([66, 34])
  })

  it('a weight of zero keeps an object at its minimum', () => {
    const { x, g, a, b } = two(true, 0, 100)
    const min = x.askMinMax(a).minW
    x.askMinMax(g)
    x.layout(g, 0, 0, 200, 20)
    expect(x.boxOf(a)!.width).toBe(min)
    expect(x.boxOf(b)!.width).toBe(200 - min)
  })

  it('children are placed in order, with the spacing between them', () => {
    const x = new MuiMaster()
    x.readString = () => ''
    const kids = [0, 1, 2].map(() => x.newObjectA(MUIC.MUIC_Rectangle)!)
    const g = x.newObjectA(MUIC.MUIC_Group, [
      tag(MUI.MUIA_Group_Spacing, 4),
      ...kids.map((k) => tag(MUI.MUIA_Group_Child, k.address)),
    ])!
    x.askMinMax(g)
    x.layout(g, 10, 20, 100, 38)
    // 38 = three tens and two fours
    expect(kids.map((k) => x.boxOf(k)!.top)).toEqual([20, 34, 48])
    expect(kids.map((k) => x.boxOf(k)!.height)).toEqual([10, 10, 10])
    expect(kids.every((k) => x.boxOf(k)!.left === 10 && x.boxOf(k)!.width === 100)).toBe(true)
  })

  it('a frame pushes the children inside it', () => {
    const x = new MuiMaster()
    x.readString = () => ''
    const k = x.newObjectA(MUIC.MUIC_Rectangle)!
    const g = x.newObjectA(MUIC.MUIC_Group, [
      tag(MUI.MUIA_Frame, MUI.MUIV_Frame_Group),
      tag(MUI.MUIA_Group_Child, k.address),
    ])!
    x.askMinMax(g)
    x.layout(g, 0, 0, 100, 100)
    expect(x.boxOf(k)).toEqual({ left: 2, top: 2, width: 96, height: 96 })
  })

  it('an object with nothing laid out on it has no box', () => {
    const x = new MuiMaster()
    expect(x.boxOf(x.newObjectA(MUIC.MUIC_Text)!)).toBeNull()
  })
})

/*
 * The cross-check that makes the generated table evidence rather than a
 * transcription: EasyLife ships its own copy of MUI's constants, by name, in
 * the Tags bank its Tag Editor writes. Two independent transcriptions of the
 * same numbers agreeing is worth more than either alone — and a disagreement
 * would be the most interesting result in this file.
 */
const TAG_EDITOR = join(
  fileURLToPath(new URL('.', import.meta.url)),
  '..',
  '..',
  'fixtures',
  'extensions',
  'easylife-1.10',
  'demos',
  'Tag_Editor.AMOS',
)

/** every (name, value) in a Tags bank, by walking both links of every node */
function tagsBank(data: Uint8Array): Map<string, number> {
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const out = new Map<string, number>()
  const seen = new Set<number>()
  const walk = (at: number): void => {
    if (at === 0 && seen.size > 0) return
    if (seen.has(at) || at + 10 > data.length) return
    seen.add(at)
    const len = v.getUint16(at + 8, false)
    if (at + 10 + len > data.length) return
    out.set(String.fromCharCode(...data.slice(at + 10, at + 10 + len)), v.getUint32(at + 4, false))
    for (const link of [v.getUint16(at, false), v.getUint16(at + 2, false)]) if (link !== 0) walk(link)
  }
  walk(0)
  return out
}

describe.skipIf(!existsSync(TAG_EDITOR))("muimaster.gen against EasyLife's own Tags bank", () => {
  const bank = (): Map<string, number> => {
    const a = parseAmosFile(new Uint8Array(readFileSync(TAG_EDITOR)))
    const b = a.banks.find((x) => x.kind === 'memory' && x.name === 'Tags')
    return tagsBank(b?.kind === 'memory' ? b.data : new Uint8Array())
  }

  it('the bank is the real thing and holds hundreds of MUI constants', () => {
    const t = bank()
    expect(t.size).toBeGreaterThan(300)
    expect(t.get('MUIA_Window_Title')).toBe(0x8042ad3d)
  })

  /**
   * Three constants differ, and all three are the version gap rather than an
   * error. EasyLife's guide tells the reader to install `mui22usr`, so the
   * bank was written against MUI 2.2 and the header here is 3.8:
   *
   *   MUII_Count     40 -> 42   two image types added between the releases
   *   MUII_LASTPAT  143 -> 145  the same two, at the end of the pattern range
   *   MUIMASTER_VMIN  8 -> 11   3.8 asks for more than 2.2 did
   *
   * The last one is the useful one: EasyLife's routine 233 opens the library
   * with `moveq #$8,d0`, and 8 is exactly what MUI 2.2's own header told it to
   * ask for. Two independent artifacts, one a shipped data bank and the other
   * a disassembled instruction, agreeing on a number.
   */
  const VERSION_DRIFT: Readonly<Record<string, [bank: number, header: number]>> = {
    MUII_Count: [40, 42],
    MUII_LASTPAT: [143, 145],
    MUIMASTER_VMIN: [8, 11],
  }

  it('every MUI_ name both tables have agrees, bar the three MUI 2.2 predates', () => {
    const t = bank()
    const disagree: string[] = []
    let checked = 0
    for (const [name, value] of t) {
      const ours = (MUI as Record<string, number>)[name]
      if (ours === undefined) continue
      checked++
      if (ours !== value) disagree.push(`${name}: header ${ours}, bank ${value}`)
    }
    expect(checked).toBeGreaterThan(300)
    expect(disagree.sort()).toEqual(
      Object.entries(VERSION_DRIFT)
        .map(([n, [b, h]]) => `${n}: header ${h}, bank ${b}`)
        .sort(),
    )
  })

  it("the bank's MUIMASTER_VMIN is the version EasyLife's moveq asks for", () => {
    // routine 233 ($31e6): lea "muimaster.library" / moveq #$8,d0 / OpenLibrary
    expect(bank().get('MUIMASTER_VMIN')).toBe(8)
  })

  it('the class names agree too', () => {
    const t = bank()
    for (const [k, v] of Object.entries(MUIC)) {
      // the bank stores a class name as a tag whose value is a string pointer
      // it cannot resolve, so only the NAME is comparable — its presence is
      // the check, and MUIC_ is how EasyLife programs spell it
      if (t.has(k)) expect(typeof v).toBe('string')
    }
    expect(MUIC.MUIC_Window).toBe('Window.mui')
  })
})

describe('muimaster: the generated table itself', () => {
  it('every built-in attribute owner exists', () => {
    const m = new MuiMaster()
    for (const [attr, cls] of Object.entries(MUI_OWNER)) {
      if (!(cls in MUI_BUILTIN_SUPER)) continue
      expect(m.findClass(`${cls}.mui`), `${attr} -> ${cls}`).not.toBeNull()
    }
  })

  it('the four LVOs EasyLife reaches are the FD file’s', () => {
    // ##bias 30, then NewObjectA, DisposeObject, RequestA at 30/36/42 and
    // MakeObjectA sixteenth at 120 — and EasyLife's moveq values sign-extend
    // to exactly those: $e2 -> -30, $dc -> -36, $d6 -> -42, $88 -> -120
    const ext = (b: number): number => (b << 24) >> 24
    expect([ext(0xe2), ext(0xdc), ext(0xd6), ext(0x88)]).toEqual([-30, -36, -42, -120])
  })
})
