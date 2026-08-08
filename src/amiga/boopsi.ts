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
 * ## What this model is, and is not
 *
 * A class is a TypeScript object with a dispatcher function, not a `struct
 * IClass` in a byte array, and a message is a record rather than a longword at
 * a pointer. Nothing in this port jumps through a hook, so the layout above is
 * evidence about the SHAPE — who calls whom, in what order, with what
 * fallthrough — and the shape is what a caller can observe.
 *
 * DEVIATION: objects carry a synthetic address, allocated from a high range in
 * the same spirit as `openLibrary`'s synthetic bases, because an AMOS program
 * receives an object as a number — `OBJ=Mui New("Window.mui",T$)` — puts it in
 * a variable and hands it back later. Addresses are never reused, where a real
 * machine's allocator reuses freed memory constantly. The difference is
 * observable in one direction and it is the safe one: a stale handle answers
 * "no such object" here, where on the machine it might have found whatever was
 * allocated next. Reproducing the machine's answer would mean reproducing an
 * allocator's free-list policy, and nothing in the corpus depends on it.
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
 * `struct IClass`.
 *
 * `cl_InstOffset` and `cl_InstSize` are absent because instance data here is a
 * per-class record rather than a slice of one allocation (see `instData`);
 * there is no offset to compute when there are no bytes to compute it in.
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
  ) {
    this.dispatcher = dispatcher
    if (superClass) superClass.subclassCount++
  }

  /** whether this class is `cl` or descends from it */
  isA(cl: BoopsiClass): boolean {
    if (cl === (this as BoopsiClass)) return true
    return this.superClass !== null && this.superClass.isA(cl)
  }
}

/**
 * Synthetic object addresses.
 *
 * High, obviously not a real allocation, and far from the library bases at
 * `0x7f10_0000` so a number escaping into a program's variable can be told
 * apart from one of those in a bug report. Eight apart because a BOOPSI object
 * pointer is at least longword aligned and consecutive addresses would read as
 * suspiciously dense.
 */
const OBJ_ORIGIN = 0x7e00_0000
const OBJ_STRIDE = 8

/** `struct _Object` and the public object it precedes, as one thing. */
export class BoopsiObject {
  /** the caller-visible handle — see the DEVIATION at the top of this file */
  readonly address: number
  /** per-class instance data: `INST_DATA(cl, obj)` */
  private readonly inst = new Map<BoopsiClass, Record<string, unknown>>()
  /** set by OM_DISPOSE, so a stale handle can be recognised */
  disposed = false

  constructor(
    /** `o_Class` */
    readonly cl: BoopsiClass,
    address: number,
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
  private readonly objects = new Map<number, BoopsiObject>()
  private next = OBJ_ORIGIN

  /** the class every other class descends from */
  readonly rootClass: BoopsiClass

  constructor() {
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
          const o = new BoopsiObject(iclass, this.next)
          this.next += OBJ_STRIDE
          this.objects.set(o.address, o)
          iclass.objectCount++
          return o.address
        }
        case OM_DISPOSE: {
          const o = obj as BoopsiObject
          if (!o.disposed) {
            o.disposed = true
            o.cl.objectCount--
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
   * MakeClass — build a class and make it findable by name.
   *
   * `superId` names the superclass; an unknown name is a failure, as it is on
   * the machine, where MakeClass cannot open a class library it has never
   * heard of. A private class (one with no id) is not registered and can only
   * be reached through the pointer.
   */
  makeClass(id: string, superId: string | BoopsiClass, dispatcher: Dispatcher): BoopsiClass | null {
    const sup = typeof superId === 'string' ? this.classes.get(superId) : superId
    if (sup === undefined) return null
    const cl = new BoopsiClass(id, sup, dispatcher)
    if (id !== '') this.classes.set(id, cl)
    return cl
  }

  /** the public class of this name, or null */
  findClass(id: string): BoopsiClass | null {
    return this.classes.get(id) ?? null
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
   * also fail to create, as one of its children is null".
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
