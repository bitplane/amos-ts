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

/** Public gadgetclass placement tags (`intuition/gadgetclass.h`). */
export const GA = {
  Left: 0x80030001, RelRight: 0x80030002, Top: 0x80030003, RelBottom: 0x80030004,
  Width: 0x80030005, RelWidth: 0x80030006, Height: 0x80030007, RelHeight: 0x80030008,
  Text: 0x80030009, Image: 0x8003000a, Border: 0x8003000b, SelectRender: 0x8003000c,
  Highlight: 0x8003000d, Disabled: 0x8003000e, GZZGadget: 0x8003000f, ID: 0x80030010,
  UserData: 0x80030011, SpecialInfo: 0x80030012, Selected: 0x80030013, EndGadget: 0x80030014,
  Immediate: 0x80030015, RelVerify: 0x80030016, FollowMouse: 0x80030017,
  RightBorder: 0x80030018, LeftBorder: 0x80030019, TopBorder: 0x8003001a, BottomBorder: 0x8003001b,
  ToggleSelect: 0x8003001c, SysGadget: 0x8003001d, SysGType: 0x8003001e,
  Previous: 0x8003001f, Next: 0x80030020, DrawInfo: 0x80030021,
  IntuiText: 0x80030022, LabelImage: 0x80030023, TabCycle: 0x80030024,
  GadgetHelp: 0x80030025, Bounds: 0x80030026, RelSpecial: 0x80030027,
  TextAttr: 0x80030028, ReadOnly: 0x80030029, Underscore: 0x8003002a,
  ActivateKey: 0x8003002b, BackFill: 0x8003002c, GadgetHelpText: 0x8003002d, UserInput: 0x8003002e,
} as const
/** Public imageclass fields (`intuition/imageclass.h`). */
export const IA = {
  Left: 0x80020001, Top: 0x80020002, Width: 0x80020003, Height: 0x80020004,
  FGPen: 0x80020005, BGPen: 0x80020006, Data: 0x80020007, LineWidth: 0x80020008,
} as const
/** Public gadgetclass methods (`intuition/gadgetclass.h`). */
export const GM = {
  HitTest: 0x200, Render: 0x201, GoActive: 0x202, HandleInput: 0x203,
  GoInactive: 0x204, HelpTest: 0x205, Layout: 0x206,
} as const

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
    const make = (id: string, superId: string, instSize = 0): void => {
      this.makeClass(id, superId, (cl, obj, msg) => {
        if (msg.MethodID === OM_NEW) {
          const made = this.objectAt(doSuperMethodA(cl, obj, msg))
          if (!made) return 0
          const attrs = made.instData<{ attrs: Map<number, number> }>(cl)
          attrs.attrs = new Map()
          for (const tag of (msg as OpSet).attrs) if (tag.tag !== TAG_DONE && this.classAcceptsTag(cl, tag.tag)) {
            attrs.attrs.set(tag.tag >>> 0, tag.data | 0)
          }
          this.initGadget(made)
          this.initImage(made)
          this.syncGadget(made, (msg as OpSet).attrs, true)
          this.syncImage(made, (msg as OpSet).attrs)
          return made.address
        }
        if (msg.MethodID === OM_SET || msg.MethodID === OM_UPDATE) {
          const attrs = (obj as BoopsiObject).instData<{ attrs?: Map<number, number> }>(cl)
          attrs.attrs ??= new Map()
          let used = 0
          for (const tag of (msg as OpSet).attrs) if (tag.tag !== TAG_DONE && this.classAcceptsTag(cl, tag.tag)) {
            attrs.attrs.set(tag.tag >>> 0, tag.data | 0); used++
          }
          this.syncGadget(obj as BoopsiObject, (msg as OpSet).attrs, false)
          this.syncImage(obj as BoopsiObject, (msg as OpSet).attrs)
          const inherited = cl.id === 'gadgetclass' ? 0 : doSuperMethodA(cl, obj, {
            ...msg, attrs: (msg as OpSet).attrs.filter(tag => {
              const family = (tag.tag & 0xffff0000) >>> 0
              return family === 0x80030000 || family === 0x80020000
            }),
          } as OpSet)
          return inherited + used
        }
        if (msg.MethodID === OM_GET) {
          const get = msg as OpGet
          const native = this.readGadget(obj as BoopsiObject, cl, get.attrID)
          if (native !== null) { get.storage = native; return 1 }
          const image = this.readImage(obj as BoopsiObject, cl, get.attrID)
          if (image !== null) { get.storage = image; return 1 }
          const value = (obj as BoopsiObject).instData<{ attrs?: Map<number, number> }>(cl).attrs?.get(get.attrID >>> 0)
          if (value === undefined) return doSuperMethodA(cl, obj, msg)
          get.storage = value
          return 1
        }
        return doSuperMethodA(cl, obj, msg)
      }, instSize)
    }

    make('imageclass', 'rootclass', 20)
    make('frameiclass', 'imageclass')
    make('sysiclass', 'imageclass')
    make('fillrectclass', 'imageclass')
    make('gadgetclass', 'rootclass', 56)
    make('buttongclass', 'gadgetclass')
    make('frbuttonclass', 'buttongclass')
    make('propgclass', 'gadgetclass')
    make('strgclass', 'gadgetclass')
    make('groupgclass', 'gadgetclass')
    make('modelclass', 'rootclass')
    make('icclass', 'rootclass')
  }

  private initGadget(obj: BoopsiObject): void {
    if (!this.memory || !obj.cl.isA(this.classes.get('gadgetclass')!)) return
    const at = obj.address + this.classes.get('gadgetclass')!.instOffset
    this.write16(at + 12, 0x8000) // GFLG_EXTENDED
    this.write16(at + 16, 5) // GTYP_CUSTOMGADGET
    this.write32(at + 44, 8) // GMORE_BOOPSIGADGET
  }

  private syncGadget(obj: BoopsiObject, attrs: readonly TagItem[], creating: boolean): void {
    if (!this.memory || !obj.cl.isA(this.classes.get('gadgetclass')!)) return
    const gadget = this.classes.get('gadgetclass')!; const at = obj.address + gadget.instOffset
    const word = (off: number): number => {
      const p = at + off - this.memory!.base
      return (this.memory!.buffer[p]! << 8) | this.memory!.buffer[p + 1]!
    }
    const flag = (off: number, mask: number, on: boolean): void => this.write16(at + off, on ? word(off) | mask : word(off) & ~mask)
    for (const tag of attrs) {
      if (tag.tag === GA.Left) this.write16(at + 4, tag.data)
      else if (tag.tag === GA.RelRight) { this.write16(at + 4, tag.data); flag(12, 0x10, true) }
      else if (tag.tag === GA.Top) this.write16(at + 6, tag.data)
      else if (tag.tag === GA.RelBottom) { this.write16(at + 6, tag.data); flag(12, 0x08, true) }
      else if (tag.tag === GA.Width) this.write16(at + 8, tag.data)
      else if (tag.tag === GA.RelWidth) { this.write16(at + 8, tag.data); flag(12, 0x20, true) }
      else if (tag.tag === GA.Height) this.write16(at + 10, tag.data)
      else if (tag.tag === GA.RelHeight) { this.write16(at + 10, tag.data); flag(12, 0x40, true) }
      else if (tag.tag === GA.Image) { this.write32(at + 18, tag.data); flag(12, 0x04, true) }
      else if (tag.tag === GA.Border) { this.write32(at + 18, tag.data); flag(12, 0x04, false) }
      else if (tag.tag === GA.SelectRender) this.write32(at + 22, tag.data)
      else if (tag.tag === GA.Highlight) this.write16(at + 12, (word(12) & ~3) | (tag.data & 3))
      else if (tag.tag === GA.Disabled) flag(12, 0x100, tag.data !== 0)
      else if (tag.tag === GA.Selected) flag(12, 0x80, tag.data !== 0)
      else if (tag.tag === GA.TabCycle) flag(12, 0x200, tag.data !== 0)
      else if (tag.tag === GA.Text) { this.write32(at + 26, tag.data); this.write16(at + 12, (word(12) & ~0x3000) | 0x1000) }
      else if (tag.tag === GA.IntuiText) { this.write32(at + 26, tag.data); this.write16(at + 12, word(12) & ~0x3000) }
      else if (tag.tag === GA.LabelImage) { this.write32(at + 26, tag.data); this.write16(at + 12, (word(12) & ~0x3000) | 0x2000) }
      else if (tag.tag === GA.ID) this.write16(at + 38, tag.data)
      else if (tag.tag === GA.UserData) this.write32(at + 40, tag.data)
      else if (tag.tag === GA.SpecialInfo) this.write32(at + 34, tag.data)
      else if (tag.tag === GA.Next) this.write32(at, tag.data)
      else if (tag.tag === GA.Previous && creating && tag.data !== 0) {
        const previous = this.objectAt(tag.data)
        if (previous?.cl.isA(gadget)) {
          const previousAt = previous.address + gadget.instOffset
          const p = previousAt - this.memory.base; const b = this.memory.buffer
          const next = (((b[p]! << 24) | (b[p + 1]! << 16) | (b[p + 2]! << 8) | b[p + 3]!) >>> 0)
          this.write32(at, next); this.write32(previousAt, obj.address)
        }
      }
      else if (tag.tag === GA.RelSpecial) flag(12, 0x4000, tag.data !== 0)
      else if (tag.tag === GA.GadgetHelp) {
        const moreAt = at + 44; const p = moreAt - this.memory.base; const b = this.memory.buffer
        const more = (((b[p]! << 24) | (b[p + 1]! << 16) | (b[p + 2]! << 8) | b[p + 3]!) >>> 0)
        this.write32(moreAt, tag.data !== 0 ? more | 2 : more & ~2)
      }
      else if (tag.tag === GA.Bounds && tag.data !== 0) {
        const p = tag.data - this.memory.base; const b = this.memory.buffer
        if (p < 0 || p + 8 > b.length) continue
        for (let i = 0; i < 8; i++) b[at + 48 - this.memory.base + i] = b[p + i]!
        const m = at + 44 - this.memory.base
        this.write32(at + 44, ((((b[m]! << 24) | (b[m + 1]! << 16) | (b[m + 2]! << 8) | b[m + 3]!) >>> 0) | 1) >>> 0)
      }
      else {
        const activation = new Map<number, number>([[GA.EndGadget, 0x04], [GA.Immediate, 0x02], [GA.RelVerify, 0x01],
          [GA.FollowMouse, 0x08], [GA.RightBorder, 0x10], [GA.LeftBorder, 0x20], [GA.TopBorder, 0x40],
          [GA.BottomBorder, 0x80], [GA.ToggleSelect, 0x100]])
        const mask = activation.get(tag.tag); if (mask) flag(14, mask, tag.data !== 0)
      }
    }
  }

  private readGadget(obj: BoopsiObject, cl: BoopsiClass, tag: number): number | null {
    if (!this.memory || cl.id !== 'gadgetclass') return null
    const at = obj.address + cl.instOffset; const b = this.memory.buffer; const off = at - this.memory.base
    const u16 = (n: number): number => (b[off + n]! << 8) | b[off + n + 1]!
    const s16 = (n: number): number => (u16(n) << 16) >> 16
    const u32 = (n: number): number => ((u16(n) << 16) | u16(n + 2)) >>> 0
    const flags = u16(12); const activation = u16(14)
    if (tag === GA.Left || tag === GA.RelRight) return s16(4)
    if (tag === GA.Top || tag === GA.RelBottom) return s16(6)
    if (tag === GA.Width || tag === GA.RelWidth) return s16(8)
    if (tag === GA.Height || tag === GA.RelHeight) return s16(10)
    if (tag === GA.Image || tag === GA.Border) return u32(18)
    if (tag === GA.SelectRender) return u32(22)
    if (tag === GA.Text || tag === GA.IntuiText || tag === GA.LabelImage) return u32(26)
    if (tag === GA.SpecialInfo) return u32(34)
    if (tag === GA.ID) return u16(38)
    if (tag === GA.UserData) return u32(40)
    if (tag === GA.Next) return u32(0)
    if (tag === GA.Highlight) return flags & 3
    if (tag === GA.Disabled) return flags & 0x100 ? 1 : 0
    if (tag === GA.Selected) return flags & 0x80 ? 1 : 0
    if (tag === GA.TabCycle) return flags & 0x200 ? 1 : 0
    if (tag === GA.RelSpecial) return flags & 0x4000 ? 1 : 0
    if (tag === GA.GadgetHelp) return u32(44) & 2 ? 1 : 0
    const act = new Map<number, number>([[GA.EndGadget, 0x04], [GA.Immediate, 0x02], [GA.RelVerify, 0x01],
      [GA.FollowMouse, 0x08], [GA.RightBorder, 0x10], [GA.LeftBorder, 0x20], [GA.TopBorder, 0x40],
      [GA.BottomBorder, 0x80], [GA.ToggleSelect, 0x100]])
    const mask = act.get(tag); return mask ? (activation & mask ? 1 : 0) : null
  }

  private syncImage(obj: BoopsiObject, attrs: readonly TagItem[]): void {
    const image = this.classes.get('imageclass')
    if (!this.memory || !image || !obj.cl.isA(image)) return
    const at = obj.address + image.instOffset
    for (const tag of attrs) {
      if (tag.tag === IA.Left) this.write16(at, tag.data)
      else if (tag.tag === IA.Top) this.write16(at + 2, tag.data)
      else if (tag.tag === IA.Width) this.write16(at + 4, tag.data)
      else if (tag.tag === IA.Height) this.write16(at + 6, tag.data)
      else if (tag.tag === IA.Data) this.write32(at + 10, tag.data)
      else if (tag.tag === IA.FGPen) this.memory.buffer[at + 14 - this.memory.base] = tag.data & 0xff
      else if (tag.tag === IA.BGPen) this.memory.buffer[at + 15 - this.memory.base] = tag.data & 0xff
    }
  }

  private initImage(obj: BoopsiObject): void {
    const image = this.classes.get('imageclass')
    if (!this.memory || !image || !obj.cl.isA(image)) return
    const at = obj.address + image.instOffset
    this.write16(at + 4, 80); this.write16(at + 6, 40); this.write16(at + 8, 0xffff)
  }

  private readImage(obj: BoopsiObject, cl: BoopsiClass, tag: number): number | null {
    if (!this.memory || cl.id !== 'imageclass') return null
    const off = obj.address + cl.instOffset - this.memory.base; const b = this.memory.buffer
    const u16 = (n: number): number => (b[off + n]! << 8) | b[off + n + 1]!
    const s16 = (n: number): number => (u16(n) << 16) >> 16
    if (tag === IA.Left) return s16(0)
    if (tag === IA.Top) return s16(2)
    if (tag === IA.Width) return s16(4)
    if (tag === IA.Height) return s16(6)
    if (tag === IA.Data) return ((u16(10) << 16) | u16(12)) >>> 0
    if (tag === IA.FGPen) return b[off + 14]!
    if (tag === IA.BGPen) return b[off + 15]!
    return null
  }

  private classAcceptsTag(cl: BoopsiClass, tag: number): boolean {
    const gadgetTag = ((tag & 0xffff0000) >>> 0) === 0x80030000
    const imageTag = ((tag & 0xffff0000) >>> 0) === 0x80020000
    if (gadgetTag) return cl.id === 'gadgetclass'
    if (imageTag) return cl.id === 'imageclass'
    if (cl.id === 'gadgetclass') return false
    if (cl.id === 'imageclass') return false
    return true
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
