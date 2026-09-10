/**
 * BOOPSI — intuition.library's object system.
 *
 * "Basic Object Oriented Programming System for Intuition": single
 * inheritance, one dispatcher function per class, and messages identified by
 * a longword MethodID. It is intuition.library's, not MUI's — `imageclass`,
 * `gadgetclass` and `icclass` shipped in Kickstart 2.0 — but MUI is what makes
 * this port need it, because every MUI class is a BOOPSI subclass and
 * `muimaster.library` is a factory for them plus a layout engine.
 *
 * ## Why this is a separate file from intuition.ts
 *
 * Because two callers need it and neither owns it, which is this directory's
 * rule (see README.md). Intuition's own `imageclass`/`gadgetclass` and the
 * whole of MUI are both BOOPSI; jd-int's gadget keywords will want the first
 * and EasyLife's twenty `Mui *` keywords want the second.
 *
 * ## Evidence
 *
 * `struct IClass` and `struct _Object` from AROS
 * `compiler/include/intuition/classes.h`; the `OM_*` ids and message structs
 * from `intuition/classusr.h`; rootclass's behaviour from
 * `rom/intuition/rootclass.c` and object creation from
 * `rom/intuition/newobjecta.c` (data and semantics only — AROS is APL/LGPL and
 * none of its code is copied).
 *
 * The two offsets that matter are confirmed independently, by a third party
 * that never saw those headers. EasyLife dispatches by hand rather than
 * through amiga.lib's DoMethod — routine 213 ($2eca), and the same four
 * instructions in 206, 212, 215, 225, 236 and 237:
 *
 *     movea.l  d0, a2            the object
 *     movea.l  -$4(a2), a0       its class
 *     movea.l  $8(a0), a3        the class's dispatcher entry
 *     jsr      (a3)              a0 = class, a2 = object, a1 = message
 *
 * `-4` is `OCLASS(obj)`: `struct _Object` is `{ MinNode o_Node; IClass
 * *o_Class; }` and o_Class is deliberately its LAST field, so it always sits
 * one pointer below the public object pointer — classes.h says so in a comment
 * and promises it will stay true. `+8` into the class is
 * `cl_Dispatcher.h_Entry`, `struct Hook` being `{ MinNode h_MinNode; ULONG
 * (*h_Entry)(); ... }`. And a0/a2/a1 is exactly AROS's `BOOPSI_DISPATCHER`
 * macro, which declares `cl` in A0, `obj` in A2 and `msg` in A1.
 *
 * ## Representation boundary
 *
 * Classes have mapped 52-byte `IClass` records and objects are allocator-backed
 * `_Object` records followed by their instance bytes. Public class/object
 * pointers, `OCLASS(obj)`, counts, superclass links and instance geometry are
 * therefore ordinary machine memory and follow the shared allocator's reuse
 * policy. Dispatchers remain host functions until a 68k execution engine can
 * call `Hook.h_Entry`; messages are decoded at the native API boundary into
 * records before those functions receive them.
 */

/** `struct TagItem` — the pair every BOOPSI attribute list is made of. */
export interface TagItem {
  tag: number
  data: number
}

/** TAG_DONE, which ends a list. TAG_END is the same value. */
export const TAG_DONE = 0

/*
 * The OM_ methods, `intuition/classusr.h`. OM_Dummy is $100 and every method
 * is an offset from it, so the family lives in $101..$10a. EasyLife's `Mui
 * Add` and `Mui Remove` carry $00000109 and $0000010a in the inline messages
 * at $32d8 and $3356 — read as bytes, because the disassembler prints the
 * longword $109 as `ori.b #$9,d0` and $9 is a different method's id.
 */
export const OM_DUMMY = 0x100
export const OM_NEW = OM_DUMMY + 1
export const OM_DISPOSE = OM_DUMMY + 2
export const OM_SET = OM_DUMMY + 3
export const OM_GET = OM_DUMMY + 4
export const OM_ADDTAIL = OM_DUMMY + 5
export const OM_REMOVE = OM_DUMMY + 6
export const OM_NOTIFY = OM_DUMMY + 7
export const OM_UPDATE = OM_DUMMY + 8
export const OM_ADDMEMBER = OM_DUMMY + 9
export const OM_REMMEMBER = OM_DUMMY + 10

/** `opu_Flags`: this update is one of a run and more are coming. */
export const OPUF_INTERIM = 1

/** The base of every message: `struct _struct_Msg { ULONG MethodID; }`. */
export interface Msg {
  readonly MethodID: number
}

/** `struct opSet` — OM_NEW, OM_SET. `ops_GInfo` is not modelled. */
export interface OpSet extends Msg {
  readonly attrs: readonly TagItem[]
}

/**
 * `struct opGet`.
 *
 * On the machine `opg_Storage` is a pointer the dispatcher writes the answer
 * through, and the dispatcher's RETURN value says whether it recognised the
 * attribute at all. Both halves are load-bearing — a class that does not know
 * an attribute must leave the storage alone and answer FALSE, so the caller
 * can tell "the value is zero" from "there is no such value" — so the storage
 * is a mutable field here and the boolean stays in the return.
 */
export interface OpGet extends Msg {
  readonly attrID: number
  storage: number
}

/** `struct opUpdate` — OM_UPDATE, an OM_SET carrying interim state. */
export interface OpUpdate extends OpSet {
  readonly flags: number
}

/** `struct opMember` — OM_ADDMEMBER, OM_REMMEMBER, OM_ADDTAIL, OM_REMOVE. */
export interface OpMember extends Msg {
  readonly object: BoopsiObject
}

/**
 * A class dispatcher.
 *
 * `cl` is the class the method was ENTERED at, which is not always the
 * object's own class: `doSuperMethodA` re-enters at the superclass so a
 * subclass can hand a message up, and `cl` is how the dispatcher knows which
 * instance-data slice is its own.
 *
 * `obj` is a `BoopsiClass` on OM_NEW and only on OM_NEW, because there is no
 * object yet — `NewObjectA` calls `CoerceMethodA(classPtr, (Object *)classPtr,
 * msg)`, and rootclass.c's own comment on reading it back is "NOTE: The object
 * argument is actually the class!". Nothing but rootclass has any business
 * looking: a subclass hands OM_NEW up, takes the address it gets back and
 * initialises that.
 */
export type Dispatcher = (cl: BoopsiClass, obj: BoopsiObject | BoopsiClass, msg: Msg) => number

/**
 * Host companion for the mapped `struct IClass`. Dispatcher-owned semantic
 * state uses `instData`; declared fixed-size instance bytes occupy their real
 * `cl_InstOffset`/`cl_InstSize` slice in the object allocation.
 */
export class BoopsiClass {
  /** `cl_SubclassCount` — classes naming this one as their superclass */
  subclassCount = 0
  /** `cl_ObjectCount` — live objects; FreeClass refuses while it is non-zero */
  objectCount = 0
  /** `cl_Dispatcher.h_Entry` */
  dispatcher: Dispatcher

  constructor(
    readonly id: string,
    readonly superClass: BoopsiClass | null,
    dispatcher: Dispatcher,
    /** bytes this class adds after its superclass's instance data */
    readonly instSize = 0,
  ) {
    this.dispatcher = dispatcher
    if (superClass) superClass.subclassCount++
  }

  /** `cl_InstOffset`: superclass bytes precede this class's slice. */
  get instOffset(): number {
    return this.superClass ? this.superClass.instOffset + this.superClass.instSize : 0
  }

  /** whether this class is `cl` or descends from it */
  isA(cl: BoopsiClass): boolean {
    if (cl === (this as BoopsiClass)) return true
    return this.superClass !== null && this.superClass.isA(cl)
  }
}

/**
 * Fallback addresses used only by isolated BOOPSI instances without a MemPool.
 *
 * Runtime machines always supply a MemPool; the fallback keeps unit-level
 * embedders usable without pretending those handles are native memory.
 */
const OBJ_ORIGIN = 0x7e00_0000
const OBJ_STRIDE = 8
const CLASS_ORIGIN = 0x7d00_0000
const CLASS_STRIDE = 0x100

/** `struct _Object` and the public object it precedes, as one thing. */
export class BoopsiObject {
  /** caller-visible pointer, twelve bytes after the allocation's `_Object` prefix */
  readonly address: number
  /** per-class instance data: `INST_DATA(cl, obj)` */
  private readonly inst = new Map<BoopsiClass, Record<string, unknown>>()
  /** set by OM_DISPOSE, so a stale handle can be recognised */
  disposed = false

  constructor(
    /** `o_Class` */
    readonly cl: BoopsiClass,
    address: number,
    /** start of the allocator block containing `_Object` and instance data */
    readonly allocation = address,
  ) {
    this.address = address
  }

  /**
   * `INST_DATA(cl, obj)` — this class's own slice of the instance.
   *
   * Created on demand, so a dispatcher that never stores anything never gets a
   * record. That is the same as a class with `cl_InstSize` of zero.
   */
  instData<T extends Record<string, unknown>>(cl: BoopsiClass): T {
    let d = this.inst.get(cl)
    if (d === undefined) {
      d = {}
      this.inst.set(cl, d)
    }
    return d as T
  }
}

/**
 * The object space: name-to-class and address-to-object.
 *
 * One instance per machine rather than module state, because two Runtimes in
 * one process must not see each other's objects — the same reason `Intuition`
 * is a class.
 */
export class Boopsi {
  private readonly classes = new Map<string, BoopsiClass>()
  private readonly classHandles = new Map<number, BoopsiClass>()
  private readonly handlesByClass = new Map<BoopsiClass, number>()
  private readonly objects = new Map<number, BoopsiObject>()
  private next = OBJ_ORIGIN
  private nextClass = CLASS_ORIGIN
  private readonly classNames = new Map<BoopsiClass, number>()
  private intuitionClassesReady = false

  /** the class every other class descends from */
  readonly rootClass: BoopsiClass

  constructor(private readonly memory: {
    readonly base: number
    buffer: Uint8Array
    alloc(length: number, opts?: { clear?: boolean }): number
    freeMem(address: number): void
  } | null = null) {
    /*
     * rootclass, from `rom/intuition/rootclass.c`. OM_NEW allocates and
     * answers the object, OM_DISPOSE frees it, OM_ADDTAIL and OM_REMOVE answer
     * TRUE, and OM_SET, OM_GET, OM_UPDATE, OM_NOTIFY, OM_ADDMEMBER and
     * OM_REMMEMBER all fall through to zero.
     *
     * The fallthrough is the contract, not an omission: a subclass hands an
     * attribute it does not know all the way up, and zero from the root is how
     * the caller learns that nobody claimed it.
     */
    this.rootClass = new BoopsiClass('rootclass', null, (_cl, obj, msg) => {
      switch (msg.MethodID) {
        case OM_NEW: {
          // "NOTE: The object argument is actually the class!"
          const iclass = obj as BoopsiClass
          const bytes = iclass.instOffset + iclass.instSize
          const allocation = this.memory?.alloc(12 + bytes, { clear: true }) ?? this.next
          if (allocation === 0) return 0
          const address = this.memory ? allocation + 12 : allocation
          if (!this.memory) this.next += OBJ_STRIDE
          const o = new BoopsiObject(iclass, address, allocation)
          this.objects.set(o.address, o)
          iclass.objectCount++
          if (this.memory) this.write32(address - 4, this.classHandle(iclass))
          this.syncClass(iclass)
          return o.address
        }
        case OM_DISPOSE: {
          const o = obj as BoopsiObject
          if (!o.disposed) {
            o.disposed = true
            o.cl.objectCount--
            this.syncClass(o.cl)
            if (this.memory) this.memory.freeMem(o.allocation)
          }
          return 0
        }
        case OM_ADDTAIL:
        case OM_REMOVE:
          return 1
        default:
          return 0
      }
    })
    this.classes.set('rootclass', this.rootClass)
  }

  /**
   * Register Intuition's public BOOPSI classes in this same object space.
   *
   * They are lazy because most programs never open the object API, and MUI
   * must still share them rather than growing a second registry. The generic
   * classes retain arbitrary tags: their concrete drawing/input behavior is
   * supplied by consumers such as GadTools, while BOOPSI owns identity,
   * inheritance and OM_NEW/OM_SET/OM_GET semantics.
   */
  ensureIntuitionClasses(): void {
    if (this.intuitionClassesReady) return
    this.intuitionClassesReady = true
    const make = (id: string, superId: string): void => {
      this.makeClass(id, superId, (cl, obj, msg) => {
        if (msg.MethodID === OM_NEW) {
          const made = this.objectAt(doSuperMethodA(cl, obj, msg))
          if (!made) return 0
          const attrs = made.instData<{ attrs: Map<number, number> }>(cl)
          attrs.attrs = new Map()
          for (const tag of (msg as OpSet).attrs) if (tag.tag !== TAG_DONE) attrs.attrs.set(tag.tag >>> 0, tag.data | 0)
          return made.address
        }
        if (msg.MethodID === OM_SET || msg.MethodID === OM_UPDATE) {
          const attrs = (obj as BoopsiObject).instData<{ attrs?: Map<number, number> }>(cl)
          attrs.attrs ??= new Map()
          let used = 0
          for (const tag of (msg as OpSet).attrs) if (tag.tag !== TAG_DONE) {
            attrs.attrs.set(tag.tag >>> 0, tag.data | 0); used++
          }
          return used
        }
        if (msg.MethodID === OM_GET) {
          const get = msg as OpGet
          const value = (obj as BoopsiObject).instData<{ attrs?: Map<number, number> }>(cl).attrs?.get(get.attrID >>> 0)
          if (value === undefined) return doSuperMethodA(cl, obj, msg)
          get.storage = value
          return 1
        }
        return doSuperMethodA(cl, obj, msg)
      })
    }

    make('imageclass', 'rootclass')
    make('frameiclass', 'imageclass')
    make('sysiclass', 'imageclass')
    make('fillrectclass', 'imageclass')
    make('gadgetclass', 'rootclass')
    make('buttongclass', 'gadgetclass')
    make('frbuttonclass', 'buttongclass')
    make('propgclass', 'gadgetclass')
    make('strgclass', 'gadgetclass')
    make('groupgclass', 'gadgetclass')
    make('modelclass', 'rootclass')
    make('icclass', 'rootclass')
  }

  /**
   * MakeClass — build a class and make it findable by name.
   *
   * `superId` names the superclass; an unknown name is a failure, as it is on
   * the machine, where MakeClass cannot open a class library it has never
   * heard of. A private class (one with no id) is not registered and can only
   * be reached through the pointer.
   */
  makeClass(id: string, superId: string | BoopsiClass, dispatcher: Dispatcher, instSize = 0): BoopsiClass | null {
    const sup = typeof superId === 'string' ? this.classes.get(superId) : superId
    if (sup === undefined) return null
    const cl = new BoopsiClass(id, sup, dispatcher, instSize)
    if (id !== '') this.classes.set(id, cl)
    this.syncClass(sup)
    return cl
  }

  /** the public class of this name, or null */
  findClass(id: string): BoopsiClass | null {
    return this.classes.get(id) ?? null
  }

  /** Stable caller-visible IClass pointer for native-facing extensions. */
  classHandle(cl: BoopsiClass): number {
    const old = this.handlesByClass.get(cl)
    if (old !== undefined) return old
    const handle = this.memory?.alloc(52, { clear: true }) ?? this.nextClass
    if (handle === 0) return 0
    if (!this.memory) this.nextClass += CLASS_STRIDE
    this.classHandles.set(handle, cl)
    this.handlesByClass.set(cl, handle)
    if (this.memory && cl.id !== '') {
      const bytes = new Uint8Array(cl.id.length + 1)
      for (let i = 0; i < cl.id.length; i++) bytes[i] = cl.id.charCodeAt(i) & 0xff
      const name = this.memory.alloc(bytes.length, { clear: true })
      if (name) {
        this.memory.buffer.set(bytes, name - this.memory.base)
        this.classNames.set(cl, name)
      }
    }
    this.syncClass(cl)
    return handle
  }

  private write16(address: number, value: number): void {
    if (!this.memory) return
    const at = address - this.memory.base
    this.memory.buffer[at] = (value >>> 8) & 0xff
    this.memory.buffer[at + 1] = value & 0xff
  }

  private write32(address: number, value: number): void {
    this.write16(address, value >>> 16)
    this.write16(address + 2, value)
  }

  /** Keep the public 52-byte `IClass` counters and layout fields live. */
  private syncClass(cl: BoopsiClass): void {
    if (!this.memory) return
    const handle = this.handlesByClass.get(cl)
    if (handle === undefined) return
    this.write32(handle + 24, cl.superClass ? this.classHandle(cl.superClass) : 0)
    this.write32(handle + 28, this.classNames.get(cl) ?? 0)
    this.write16(handle + 32, cl.instOffset)
    this.write16(handle + 34, cl.instSize)
    this.write32(handle + 40, cl.subclassCount)
    this.write32(handle + 44, cl.objectCount)
  }

  classAt(handle: number): BoopsiClass | null {
    return this.classHandles.get(handle >>> 0) ?? null
  }

  /**
   * FreeClass — refuses while objects or subclasses are outstanding.
   *
   * Answers FALSE rather than freeing, which is the documented contract and
   * the reason `cl_ObjectCount` exists at all.
   */
  freeClass(cl: BoopsiClass): boolean {
    if (cl.objectCount > 0 || cl.subclassCount > 0) return false
    if (cl.superClass) cl.superClass.subclassCount--
    if (this.classes.get(cl.id) === cl) this.classes.delete(cl.id)
    const handle = this.handlesByClass.get(cl)
    if (handle !== undefined) {
      this.handlesByClass.delete(cl); this.classHandles.delete(handle)
      if (this.memory) this.memory.freeMem(handle)
    }
    const name = this.classNames.get(cl)
    if (name !== undefined) { this.classNames.delete(cl); this.memory?.freeMem(name) }
    if (cl.superClass) this.syncClass(cl.superClass)
    return true
  }

  /** the object a handle names, or null once it has been disposed */
  objectAt(address: number): BoopsiObject | null {
    const o = this.objects.get(address)
    return o === undefined || o.disposed ? null : o
  }

  /**
   * NewObjectA — `CoerceMethodA(cl, (Object *)cl, OM_NEW)`.
   *
   * The allocation really is the dispatcher's: rootclass's OM_NEW makes the
   * object, and every subclass gets there by handing OM_NEW up before
   * initialising its own slice. So a subclass that refuses — a bad taglist, a
   * child that failed to create — simply never calls up, and the answer is
   * null with nothing allocated. That is the behaviour EasyLife's guide
   * describes from the other side: "if they fail to create, they will return
   * 0 ... when you make them the child of another object, that object will
   * also fail to create, as one of it's children is null".
   */
  newObjectA(cl: BoopsiClass | string, attrs: readonly TagItem[] = []): BoopsiObject | null {
    const c = typeof cl === 'string' ? this.classes.get(cl) : cl
    if (c === undefined) return null
    const msg: OpSet = { MethodID: OM_NEW, attrs }
    return this.objectAt(c.dispatcher(c, c, msg))
  }

  /** DisposeObject — the object's own OM_DISPOSE, which reaches rootclass's */
  disposeObject(obj: BoopsiObject): void {
    if (obj.disposed) return
    obj.cl.dispatcher(obj.cl, obj, { MethodID: OM_DISPOSE })
  }
}

/**
 * DoMethodA — dispatch at the object's own class.
 *
 * This is amiga.lib's, not the library's, and it is four instructions: read
 * OCLASS, read its dispatcher, call it. EasyLife inlines exactly those four
 * rather than linking amiga.lib, which is why its object protocol is visible
 * in the disassembly at all.
 */
export function doMethodA(obj: BoopsiObject, msg: Msg): number {
  return obj.cl.dispatcher(obj.cl, obj, msg)
}

/**
 * DoSuperMethodA — dispatch at the superclass of `cl`.
 *
 * `cl` is the class currently handling the message, NOT the object's class, so
 * a three-deep chain hands the message up one step at a time.
 */
export function doSuperMethodA(cl: BoopsiClass, obj: BoopsiObject | BoopsiClass, msg: Msg): number {
  const sup = cl.superClass
  return sup ? sup.dispatcher(sup, obj, msg) : 0
}

/**
 * CoerceMethodA — dispatch at a named class regardless of the object's.
 *
 * How a class calls an ancestor's behaviour without being it.
 */
export function coerceMethodA(cl: BoopsiClass, obj: BoopsiObject | BoopsiClass, msg: Msg): number {
  return cl.dispatcher(cl, obj, msg)
}

/** SetAttrsA — OM_SET, answering however many attributes were used. */
export function setAttrsA(obj: BoopsiObject, attrs: readonly TagItem[]): number {
  const msg: OpSet = { MethodID: OM_SET, attrs }
  return doMethodA(obj, msg)
}

/**
 * GetAttr — OM_GET, answering the value or null when nobody claimed it.
 *
 * intuition.library's own signature is `GetAttr(attrID, obj, storagePtr)`
 * answering TRUE or FALSE; folding the two into one nullable answer says the
 * same thing without an out-parameter that has nowhere to point. The
 * distinction survives, which is the part that matters: null is "no such
 * attribute", 0 is "the attribute is zero".
 */
export function getAttr(attrID: number, obj: BoopsiObject): number | null {
  const msg: OpGet = { MethodID: OM_GET, attrID, storage: 0 }
  return doMethodA(obj, msg) === 0 ? null : msg.storage
}

/** FindTagItem — the value of `tag` in the list, or `def`. */
export function findTagItem(tag: number, attrs: readonly TagItem[], def = 0): number {
  for (const t of attrs) if (t.tag === tag) return t.data
  return def
}
