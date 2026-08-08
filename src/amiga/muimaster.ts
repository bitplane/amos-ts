/**
 * muimaster.library — MagicUserInterface's class factory.
 *
 * MUI is a GUI toolkit, and `muimaster.library` is a thin thing on top of a
 * thick one: four public entry points that make and destroy objects, and
 * sixty-five BOOPSI classes behind them that do all the work. This file is the
 * factory and the class tree. What each class DOES — layout, drawing, input —
 * arrives a slice at a time on top of the structure set up here.
 *
 * ## The shape of the port, and why it is this shape
 *
 * `src/amiga/boopsi.ts` already has the object system; MUI adds no mechanism
 * to it, only classes. So a MUI class here is a `BoopsiClass` whose dispatcher
 * knows its own attributes, and the tree is 65 of those hung off `rootclass`.
 *
 * Three things are read out of the header rather than typed, and each is a
 * whole category of mistake avoided (see `../cli/genmui.ts`):
 *
 *  - `MUI_SUPER` — who descends from whom, off the ASCII drawing in mui.h's
 *    own opening comment. One transposed line would put a class under the
 *    wrong parent and every inherited attribute would go wrong at once.
 *  - `MUI_OWNER` — which class each of the 714 constants belongs to, off the
 *    section it is declared under. `MUIA_Window_Title` is guessable from its
 *    name; `MUIA_Weight`, `MUIA_Disabled` and `MUIA_UserData` are not, and
 *    those are exactly the ones a naming rule puts on the wrong class.
 *  - `MUI_ATTR` — the `isg` flags, which decide whether OM_SET may change an
 *    attribute and whether OM_GET may answer it at all.
 *
 * That means every class exists with the right parent and the right attribute
 * set from the first commit, and a later slice adds behaviour to a class
 * rather than discovering it was never there.
 *
 * ## Evidence
 *
 * LVOs from `MUI/Developer/FD/muimaster_lib.fd`: `##bias 30`, then
 * MUI_NewObjectA, MUI_DisposeObject, MUI_RequestA, ... MUI_MakeObjectA
 * sixteenth, so -30, -36, -42 and -120. EasyLife agrees from the other side —
 * routine 233 ($31e6) is its one-line library trampoline and the four `moveq`
 * values that reach it are $e2, $dc, $d6 and $88, which sign-extend to exactly
 * those four.
 *
 * Constants and the class tree from `libraries/mui.h`, MUI 3.8,
 * muimaster.library 19.35. THIS IS THE MANUAL TIER: the header says what the
 * author intended, the library is what programs ran against, and where they
 * disagree the library decides. One independent check is already wired up —
 * EasyLife ships the same constants by name in its Tags bank, and
 * `muimaster.test.ts` compares the two tables.
 *
 * The notification message shape is confirmed against a binary rather than the
 * header. EasyLife's routine 215 ($2f04) builds `Mui Notify` by hand:
 *
 *     move.l  d4, $10(a1)        the follow-parameter count
 *     move.l  d0, $c(a1)         DestObj
 *     move.l  d0, $8(a1)         TrigVal
 *     move.l  d0, $4(a1)         TrigAttr
 *     move.l  #$8042c9cb, (a1)   MUIM_Notify
 *
 * which is `struct MUIP_Notify { MethodID; TrigAttr; TrigVal; DestObj;
 * FollowParams; ... }` field for field.
 *
 * ## Licensing
 *
 * MUI is shareware, (c) Stefan Stuntz. No MUI code is copied: the constants
 * are data extracted from a header published for interoperability, and the
 * behaviour is written against the autodocs. See the archive write-up at
 * `amos-files/sources/aminet-mui-3.8/SOURCE.md`.
 */
import {
  Boopsi,
  OM_ADDMEMBER,
  OM_DISPOSE,
  OM_GET,
  OM_NEW,
  OM_REMMEMBER,
  OM_SET,
  doSuperMethodA,
  type BoopsiClass,
  type BoopsiObject,
  type Msg,
  type OpGet,
  type OpMember,
  type OpSet,
  type TagItem,
} from './boopsi'
import { MUI, MUIC, MUI_ATTR, MUI_OWNER, MUI_SUPER } from './muimaster.gen'

/** muimaster_lib.fd, `##bias 30` — the four entry points EasyLife reaches */
export const LVO_MUI_NewObjectA = -30
export const LVO_MUI_DisposeObject = -36
export const LVO_MUI_RequestA = -42
export const LVO_MUI_MakeObjectA = -120

/** the version EasyLife's `moveq #$8,d0` asks OpenLibrary for */
export const MUIMASTER_MIN_FOR_EASYLIFE = 8

/**
 * Attributes that hold a child the parent OWNS.
 *
 * The candidates are mechanical — an attribute whose declared type is
 * `Object *` and whose flags allow it at Init — and there are eighteen of
 * those. Six of them are references rather than children and are excluded by
 * name, because getting this wrong would make DisposeObject take down an
 * object that was merely pointed at:
 *
 *   MUIA_Aboutmui_Application    the app an About window belongs to
 *   MUIA_Application_DropObject  where AppMessages are delivered
 *   MUIA_Pendisplay_Reference    another pendisplay to mirror
 *   MUIA_String_AttachedList     a list that shares the string's keystrokes
 *   MUIA_Window_DefaultObject    which child has the focus
 *   MUIA_Window_RefWindow        the window to open relative to
 *
 * The rest are ownership, and the guide describes the consequence from the
 * AMOS side: "all of its children are recursively deallocated, along with
 * their strings".
 */
const NOT_A_CHILD: ReadonlySet<number> = new Set<number>([
  MUI.MUIA_Aboutmui_Application,
  MUI.MUIA_Application_DropObject,
  MUI.MUIA_Pendisplay_Reference,
  MUI.MUIA_String_AttachedList,
  MUI.MUIA_Window_DefaultObject,
  MUI.MUIA_Window_RefWindow,
])

const CHILD_ATTRS: ReadonlySet<number> = new Set(
  Object.entries(MUI_ATTR)
    .filter(([n, a]) => a.type === 'Object *' && a.flags.includes('i') && n in MUI)
    .map(([n]) => MUI[n as keyof typeof MUI] as number)
    .filter((v) => !NOT_A_CHILD.has(v)),
)

/** one notification recorded by MUIM_Notify */
export interface Notification {
  trigAttr: number
  trigVal: number
  dest: BoopsiObject | number
  /** the method longwords: `[MethodID, ...params]` */
  params: readonly number[]
}

/** what every MUI object carries, whatever its class */
interface MuiData extends Record<string, unknown> {
  /** attribute values, keyed by tag, for the attributes this class owns */
  attrs: Map<number, number>
  /** objects this one owns and will dispose with itself */
  children: BoopsiObject[]
  parent: BoopsiObject | null
  notifies: Notification[]
  /** MUIM_Application_Input's queue of MUIA_Application_ReturnID values */
  returnIDs: number[]
}

/** the per-object record, which lives on the Notify slice of every object */
function data(mui: MuiMaster, obj: BoopsiObject): MuiData {
  return obj.instData<MuiData>(mui.notifyClass)
}

/**
 * The library.
 *
 * One per machine, holding its own `Boopsi` unless handed one — two Runtimes
 * in a process must not see each other's objects, and the class tree is per
 * object space because a class is registered in it by name.
 */
export class MuiMaster {
  readonly boopsi: Boopsi
  /** "Window.mui" -> its class, which is what MUI_NewObjectA is given */
  private readonly byName = new Map<string, BoopsiClass>()
  /** the classes whose behaviour this file specialises, by name */
  readonly notifyClass: BoopsiClass
  readonly familyClass: BoopsiClass
  readonly areaClass: BoopsiClass
  readonly groupClass: BoopsiClass
  readonly windowClass: BoopsiClass
  readonly applicationClass: BoopsiClass

  constructor(boopsi = new Boopsi()) {
    this.boopsi = boopsi

    /*
     * Build in dependency order: a class cannot be made before its superclass.
     * MUI_SUPER is a flat map, so walk it and resolve each parent on demand,
     * which terminates because rootclass exists and the tree has no cycles.
     */
    const make = (name: string): BoopsiClass => {
      const have = this.byName.get(`${name}.mui`)
      if (have) return have
      const supName = MUI_SUPER[name]
      const sup = supName === undefined || supName === 'rootclass' ? boopsi.rootClass : make(supName)
      const cl = boopsi.makeClass(`${name}.mui`, sup, (c, o, m) => this.dispatch(name, c, o, m))
      if (!cl) throw new Error(`muimaster: cannot make ${name} under ${supName}`)
      this.byName.set(`${name}.mui`, cl)
      return cl
    }
    for (const name of Object.keys(MUI_SUPER)) make(name)

    this.notifyClass = this.byName.get(MUIC.MUIC_Notify)!
    this.familyClass = this.byName.get(MUIC.MUIC_Family)!
    this.areaClass = this.byName.get(MUIC.MUIC_Area)!
    this.groupClass = this.byName.get(MUIC.MUIC_Group)!
    this.windowClass = this.byName.get(MUIC.MUIC_Window)!
    this.applicationClass = this.byName.get(MUIC.MUIC_Application)!
  }

  /** every class name the factory knows, e.g. "Window.mui" */
  get classNames(): string[] {
    return [...this.byName.keys()].sort()
  }

  /** the class behind a name, or null — a private class has none */
  findClass(name: string): BoopsiClass | null {
    return this.byName.get(name) ?? null
  }

  // -- the library's four entry points ------------------------------------

  /**
   * MUI_NewObjectA(class, tags) — LVO -30.
   *
   * Answers null for a class MUI does not have, which is what a program sees
   * as 0. EasyLife's `Mui New` passes the class name straight through from
   * AMOS, so a typo in a program's string lands here rather than anywhere
   * more helpful — and that is the behaviour, not a shortcoming.
   */
  newObjectA(className: string, attrs: readonly TagItem[] = []): BoopsiObject | null {
    const cl = this.byName.get(className)
    return cl ? this.boopsi.newObjectA(cl, attrs) : null
  }

  /**
   * MUI_DisposeObject(obj) — LVO -36.
   *
   * Recursive over the children the object owns, which is what makes
   * disposing an Application enough to take a whole interface down.
   */
  disposeObject(obj: BoopsiObject): void {
    this.boopsi.disposeObject(obj)
  }

  /**
   * MUI_MakeObjectA(type, params) — LVO -120.
   *
   * A convenience factory for the shapes everyone builds by hand: a labelled
   * button, a checkmark, a popup button. EasyLife reaches it twice, with
   * MUIO_Button (2) and MUIO_PopButton (8) — `Mui Make Button` and
   * `Mui Make Popbutton`.
   *
   * NOTE: only those two are built here, and the rest answer null. The
   * remaining fifteen MUIO_ shapes have no caller in this port yet, and each
   * is a specific tree of objects with specific attributes — inventing them
   * unread would be guessing at layout, which is the part of MUI this port
   * has least evidence for.
   */
  makeObjectA(type: number, params: readonly number[]): BoopsiObject | null {
    switch (type) {
      case MUI.MUIO_Button:
        // "STRPTR label" — a Text with a button frame, its key from the label
        return this.newObjectA(MUIC.MUIC_Text, [
          { tag: MUI.MUIA_Text_Contents, data: params[0] ?? 0 },
          { tag: MUI.MUIA_Frame, data: MUI.MUIV_Frame_Button },
          { tag: MUI.MUIA_InputMode, data: MUI.MUIV_InputMode_RelVerify },
        ])
      case MUI.MUIO_PopButton:
        // "STRPTR imagespec" — an Image in a button frame
        return this.newObjectA(MUIC.MUIC_Image, [
          { tag: MUI.MUIA_Image_Spec, data: params[0] ?? 0 },
          { tag: MUI.MUIA_Frame, data: MUI.MUIV_Frame_ImageButton },
          { tag: MUI.MUIA_InputMode, data: MUI.MUIV_InputMode_RelVerify },
        ])
      default:
        return null
    }
  }

  // -- attributes ---------------------------------------------------------

  /** read an attribute the way OM_GET does, or null if nobody owns it */
  get(obj: BoopsiObject, attr: number): number | null {
    const msg: OpGet = { MethodID: OM_GET, attrID: attr, storage: 0 }
    return obj.cl.dispatcher(obj.cl, obj, msg) === 0 ? null : msg.storage
  }

  /** OM_SET one attribute, firing whatever notifications it triggers */
  set(obj: BoopsiObject, attr: number, value: number): number {
    const msg: OpSet = { MethodID: OM_SET, attrs: [{ tag: attr, data: value }] }
    return obj.cl.dispatcher(obj.cl, obj, msg)
  }

  /**
   * What MUI does to its OWN state, which OM_SET's rules do not govern.
   *
   * The attributes programs notify on most are precisely the ones they may
   * not Set: `MUIA_Pressed` and `MUIA_Window_CloseRequest` are both `..g`,
   * gettable and nothing else, because they report what the USER did. MUI
   * still changes them, and a notification on one still fires — that is the
   * whole mechanism. The `isg` flags are a rule about the OM_SET a program
   * sends in, not about the library moving its own state.
   *
   * So this is the entry point a class uses on itself, and the input and
   * layout slices to come are its callers. Answers whether anything changed.
   */
  setInternal(obj: BoopsiObject, attr: number, value: number): boolean {
    const d = data(this, obj)
    if (d.attrs.get(attr) === value) return false
    d.attrs.set(attr, value)
    this.fire(obj, attr, value)
    return true
  }

  /**
   * Read an attribute regardless of whether it is gettable.
   *
   * `get` is OM_GET and obeys the header: an `i..` attribute like
   * `MUIA_Frame` can be given at creation and never read back, and answering
   * null for it is the library's behaviour rather than a gap here. This is
   * the back door, for a class reading its own state and for tests that need
   * to see a value a program could not.
   */
  peek(obj: BoopsiObject, attr: number): number | undefined {
    return data(this, obj).attrs.get(attr)
  }

  /** the objects this one owns, in the order they were added */
  children(obj: BoopsiObject): readonly BoopsiObject[] {
    return data(this, obj).children
  }

  /** the object that owns this one, or null */
  parent(obj: BoopsiObject): BoopsiObject | null {
    return data(this, obj).parent
  }

  /** the notifications recorded on this object */
  notifications(obj: BoopsiObject): readonly Notification[] {
    return data(this, obj).notifies
  }

  // -- the dispatcher every class shares ----------------------------------

  /**
   * One dispatcher, parameterised by class name.
   *
   * MUI's classes differ in what they OWN and what they DO. What they own is
   * data — `MUI_OWNER` says which attributes are whose — so one function can
   * serve every class for the storing part, and the specialised behaviour is
   * the handful of `if`s below it. That is what makes 65 classes tractable in
   * one file and what lets a later slice add drawing to Area without touching
   * the other sixty-four.
   */
  private dispatch(name: string, cl: BoopsiClass, obj: BoopsiObject | BoopsiClass, msg: Msg): number {
    switch (msg.MethodID) {
      case OM_NEW: {
        const made = this.boopsi.objectAt(doSuperMethodA(cl, obj, msg))
        if (!made) return 0
        if (cl === this.notifyClass) {
          // the record every object carries, created once at the root of the
          // MUI chain so every class can reach it
          const d = made.instData<MuiData>(cl)
          d.attrs = new Map()
          d.children = []
          d.parent = null
          d.notifies = []
          d.returnIDs = []
        }
        const attrs = (msg as OpSet).attrs
        if (!this.applyOwn(name, made, attrs, 'i')) return 0
        return made.address
      }

      case OM_DISPOSE: {
        const o = obj as BoopsiObject
        if (cl === this.notifyClass) {
          // children first, and take a copy: each child's own OM_DISPOSE
          // unlinks it from this list on the way out
          for (const c of [...data(this, o).children]) this.boopsi.disposeObject(c)
        }
        return doSuperMethodA(cl, obj, msg)
      }

      case OM_SET: {
        /*
         * Own attributes first, then hand the SAME taglist up. Every class in
         * the chain sees it and takes only what it owns, which is how one
         * `Set` on a Text reaches MUIA_Disabled (Area's) and MUIA_UserData
         * (Notify's) without Text knowing either exists. The answer is the
         * total, because OM_SET's contract is how many attributes were used.
         */
        const ok = this.applyOwn(name, obj as BoopsiObject, (msg as OpSet).attrs, 's')
        return (ok ? this.setCount : 0) + doSuperMethodA(cl, obj, msg)
      }

      case OM_GET: {
        const g = msg as OpGet
        const o = obj as BoopsiObject
        if (MUI_OWNER[nameOf(g.attrID)] === name && (MUI_ATTR[nameOf(g.attrID)]?.flags ?? 'g').includes('g')) {
          g.storage = data(this, o).attrs.get(g.attrID) ?? 0
          return 1
        }
        return doSuperMethodA(cl, obj, msg)
      }

      case OM_ADDMEMBER:
      case OM_REMMEMBER: {
        const o = obj as BoopsiObject
        const child = (msg as OpMember).object
        const d = data(this, o)
        if (msg.MethodID === OM_ADDMEMBER) {
          if (!d.children.includes(child)) d.children.push(child)
          data(this, child).parent = o
        } else {
          const i = d.children.indexOf(child)
          if (i >= 0) d.children.splice(i, 1)
          data(this, child).parent = null
        }
        return 1
      }

      default:
        if (cl === this.notifyClass) return this.notifyMethod(cl, obj as BoopsiObject, msg)
        return doSuperMethodA(cl, obj, msg)
    }
  }

  /** how many attributes the last applyOwn consumed — OM_SET's answer */
  private setCount = 0

  /**
   * Store the attributes of this taglist that belong to THIS class.
   *
   * `need` is 'i' at OM_NEW and 's' at OM_SET: an attribute the header marks
   * init-only cannot be Set afterwards, and one marked set-only is not
   * accepted at Init. Attributes belonging to another class fall through to
   * it, because every class in the chain sees the same taglist.
   *
   * Answers false only when a child object in the list failed to create,
   * which is how a broken grandchild takes its whole ancestry down — the
   * behaviour EasyLife's guide describes from the AMOS side.
   */
  private applyOwn(
    name: string,
    obj: BoopsiObject,
    attrs: readonly TagItem[],
    need: 'i' | 's',
  ): boolean {
    let used = 0
    for (const t of attrs) {
      const n = nameOf(t.tag)
      if (MUI_OWNER[n] !== name) continue
      const flags = MUI_ATTR[n]?.flags
      if (flags !== undefined && !flags.includes(need)) continue
      used++
      if (CHILD_ATTRS.has(t.tag)) {
        const child = this.boopsi.objectAt(t.data)
        // a null child is a child that failed to create; MUI's own idiom is
        // that its parent then fails too
        if (!child) return false
        const d = data(this, obj)
        if (!d.children.includes(child)) d.children.push(child)
        data(this, child).parent = obj
      }
      const prev = data(this, obj).attrs.get(t.tag)
      data(this, obj).attrs.set(t.tag, t.data)
      if (need === 's' && prev !== t.data) this.fire(obj, t.tag, t.data)
    }
    this.setCount = used
    return true
  }

  // -- Notify -------------------------------------------------------------

  /** the methods Notify itself implements, for every object in MUI */
  private notifyMethod(cl: BoopsiClass, obj: BoopsiObject, msg: Msg): number {
    const p = msg as Msg & { params?: readonly number[] }
    switch (msg.MethodID) {
      case MUI.MUIM_Set: {
        // MUIP_Set { MethodID; attr; value } — EasyLife's Mui Set and Mui Set
        // Str both send this rather than OM_SET, which is why routine 206's
        // inline message is three longwords rather than a taglist
        const [attr = 0, value = 0] = p.params ?? []
        return this.set(obj, attr, value)
      }
      case MUI.MUIM_Notify: {
        // MUIP_Notify { MethodID; TrigAttr; TrigVal; DestObj; FollowParams... }
        const [trigAttr = 0, trigVal = 0, dest = 0, ...rest] = p.params ?? []
        data(this, obj).notifies.push({
          trigAttr,
          trigVal,
          dest: this.boopsi.objectAt(dest) ?? dest,
          params: rest,
        })
        return 1
      }
      case MUI.MUIM_KillNotify: {
        const [trigAttr = 0] = p.params ?? []
        const d = data(this, obj)
        d.notifies = d.notifies.filter((n) => n.trigAttr !== trigAttr)
        return 1
      }
      default:
        return doSuperMethodA(cl, obj, msg)
    }
  }

  /**
   * Fire whatever this attribute change triggers.
   *
   * `MUIV_EveryTime` matches any new value — it is the same number as
   * `MUIV_TriggerValue`, $49893131, which is also the placeholder a follow
   * parameter uses to mean "the value that just arrived". MUI overloading one
   * magic number for both jobs is not a mistake: a notification's trigger and
   * its substitution never occupy the same slot.
   */
  private fire(obj: BoopsiObject, attr: number, value: number): void {
    for (const n of [...data(this, obj).notifies]) {
      if (n.trigAttr !== attr) continue
      if (n.trigVal !== value && n.trigVal !== MUI.MUIV_EveryTime) continue
      const dest = this.resolveDest(obj, n.dest)
      if (!dest || n.params.length === 0) continue
      const params = n.params.map((v) =>
        v === MUI.MUIV_TriggerValue ? value : v === MUI.MUIV_NotTriggerValue ? (value === 0 ? 1 : 0) : v,
      )
      const [method = 0, ...rest] = params
      dest.cl.dispatcher(dest.cl, dest, { MethodID: method, params: rest } as Msg)
    }
  }

  /**
   * A notification's destination.
   *
   * Four of them are pseudo-objects rather than pointers — MUIV_Notify_Self,
   * _Window, _Application and _Parent (1 to 4) — resolved against the tree the
   * child attributes built. Walking up for Window and Application is what
   * makes `MUIV_Notify_Application, 2, MUIM_Application_ReturnID, MUIV_...`
   * work from a button buried several groups deep, which is the single most
   * common line in a MUI program.
   */
  private resolveDest(from: BoopsiObject, dest: BoopsiObject | number): BoopsiObject | null {
    if (typeof dest !== 'number') return dest
    switch (dest) {
      case MUI.MUIV_Notify_Self:
        return from
      case MUI.MUIV_Notify_Parent:
        return this.parent(from)
      case MUI.MUIV_Notify_Window:
        return this.ancestorOf(from, this.windowClass)
      case MUI.MUIV_Notify_Application:
        return this.ancestorOf(from, this.applicationClass)
      default:
        return this.boopsi.objectAt(dest)
    }
  }

  /** the nearest ancestor of this class, itself included */
  private ancestorOf(from: BoopsiObject, cl: BoopsiClass): BoopsiObject | null {
    for (let o: BoopsiObject | null = from; o; o = this.parent(o)) if (o.cl.isA(cl)) return o
    return null
  }
}

/** every tag's name, so MUI_OWNER and MUI_ATTR can be asked about a number */
const TAG_NAME = new Map<number, string>(
  Object.entries(MUI).map(([k, v]) => [v as number, k] as [number, string]),
)

/**
 * The constant name behind a tag value, or "" for one MUI never defined.
 *
 * Reverse lookup rather than a per-class attribute set, because the same tag
 * can be reached through any class in the chain and only its owner should
 * store it. An unknown tag owns nothing and is ignored by every class, which
 * is what MUI does with a taglist entry it does not recognise.
 */
function nameOf(tag: number): string {
  return TAG_NAME.get(tag) ?? ''
}
