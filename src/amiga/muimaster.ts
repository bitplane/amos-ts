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
 * ## Where this stopped, and why
 *
 * PARKED, deliberately, behind `intuition.library`. What is here is structure
 * and geometry: a tree can be built, attributes set and read, notifications
 * registered and fired, and the Application input loop drained. Nothing draws
 * and nothing responds to a mouse, because both of those are Intuition's
 * before they are MUI's, and Intuition is the prerequisite for some 550
 * keywords elsewhere as well. Building MUI's render path first would mean
 * building it twice.
 *
 * `../cli/muidis.ts` is the way back in: it opens muimaster.library 19.35 and
 * resolves any built-in class to its dispatcher and any method to its
 * routine. Four things it established, none of which mui.h could have said:
 * only 35 of the 65 classes are built into the library (the rest are separate
 * `MUI/Libs/mui/*.mui` binaries); the class tree above agrees with the binary
 * exactly, which promotes it off the manual tier; the 35 hold 507 method-table
 * entries of which 113 have NO NAME in mui.h; and `Group` and `Family` both
 * broadcast to their children before deferring to the superclass.
 *
 * `UNIMPLEMENTED.md` carries the ordered plan and the three deviations that
 * cannot be closed. One deviation is live right now and is worth fixing early
 * when this resumes: nothing raises EasyLife's message 23, so the port claims
 * MUI is installed and then shows nothing, which is a state no Amiga was in.
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
 * AMOS side: "all of its children are recursively deallocated, allong with
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

/**
 * `struct MUI_MinMax` — what MUIM_AskMinMax fills in.
 *
 * The field ORDER in the header is MinWidth, MinHeight, MaxWidth, MaxHeight,
 * DefWidth, DefHeight: max before def, which is not the order anyone writes
 * it in prose and is worth naming rather than positional.
 */
export interface MinMax {
  minW: number
  minH: number
  maxW: number
  maxH: number
  defW: number
  defH: number
}

/** `#define MUI_MAXMAX 10000`, "use this if a dimension is not limited" */
export const MUI_MAXMAX = 10000

/**
 * How much a frame costs on each edge.
 *
 * NOTE: two pixels. A real MUI frame is an image spec out of the user's
 * preferences and can be any thickness — the built-ins run from a single line
 * to a bevelled group border — so this is the smallest frame that has an
 * inside and an outside rather than a measured value.
 */
const FRAME_EDGE = 2

/** `struct IBox` — where the layout put an object */
export interface Box {
  left: number
  top: number
  width: number
  height: number
}

/** what every MUI object carries, whatever its class */
interface MuiData extends Record<string, unknown> {
  /** `mad_MinMax`, once MUIM_AskMinMax has run */
  minmax?: MinMax
  /** `mad_Box` — position and dimension, once MUIM_Layout has run */
  box?: Box
  /** attribute values, keyed by tag, for the attributes this class owns */
  attrs: Map<number, number>
  /** objects this one owns and will dispose with itself */
  children: BoopsiObject[]
  parent: BoopsiObject | null
  notifies: Notification[]
  /** MUIM_Application_Input's queue of MUIA_Application_ReturnID values */
  returnIDs: number[]
  /**
   * Application's `$47c` bit 0, set when a Quit id has been posted.
   *
   * Kept because the library keeps it: `MUIM_Application_ReturnID` sets the
   * bit as well as queueing the id, and the bit is what the iconify path
   * tests. Nothing here reads it yet — the return value a program sees comes
   * off the queue, exactly as it does in the library.
   */
  quitting?: boolean
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
    const msg: OpGet = { MethodID: OM_GET, attrID: TAG(attr), storage: 0 }
    return obj.cl.dispatcher(obj.cl, obj, msg) === 0 ? null : msg.storage
  }

  /** OM_SET one attribute, firing whatever notifications it triggers */
  set(obj: BoopsiObject, attr: number, value: number): number {
    const msg: OpSet = { MethodID: OM_SET, attrs: [{ tag: TAG(attr), data: value }] }
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
    const t = TAG(attr)
    if (d.attrs.get(t) === value) return false
    d.attrs.set(t, value)
    this.fire(obj, t, value)
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
    return data(this, obj).attrs.get(TAG(attr))
  }

  /**
   * Send a MUI method: an id and a run of longword parameters.
   *
   * The shape every caller that is not C uses, because MUI's messages are
   * fixed-layout structs rather than taglists — EasyLife's `Mui Do` hands the
   * whole thing over as the body of an AMOS string, and `Mui Notify` builds
   * five longwords by hand.
   */
  doMui(obj: BoopsiObject, method: number, params: readonly number[] = []): number {
    return obj.cl.dispatcher(obj.cl, obj, { MethodID: TAG(method), params } as Msg)
  }

  /** OM_ADDMEMBER / OM_REMMEMBER, the dynamic half of the object tree */
  addMember(parent: BoopsiObject, child: BoopsiObject): number {
    const msg: OpMember = { MethodID: OM_ADDMEMBER, object: child }
    return parent.cl.dispatcher(parent.cl, parent, msg)
  }

  remMember(parent: BoopsiObject, child: BoopsiObject): number {
    const msg: OpMember = { MethodID: OM_REMMEMBER, object: child }
    return parent.cl.dispatcher(parent.cl, parent, msg)
  }

  /**
   * MUI_RequestA(app, win, flags, title, gadgets, format, params) — LVO -42.
   *
   * The button numbering is the whole observable contract and it is odd on
   * purpose: left to right from 1, except that the RIGHTMOST is 0. EasyLife's
   * guide blames Commodore, and it is right to — MUI is matching
   * `EZRequestArgs`, whose "negative" gadget has always been 0.
   *
   * A requester is a modal MUI window and this port has no input to give it,
   * so it answers 0 — the rightmost button, which is the one every requester
   * makes its cancel. That is the safe answer rather than the true one; see
   * the NOTE, and it becomes real when the input slice lands.
   *
   * NOTE: `flags` and `params` are accepted and ignored. MUI 3.8 defines no
   * flags at all (the autodoc says "must be 0"), and `params` is the argument
   * array for the format string's `%ld`/`%s` codes, which needs the text
   * engine that is not here yet.
   */
  requestA(
    _app: BoopsiObject | null,
    _win: BoopsiObject | null,
    _title: string,
    gadgets: string,
    _format: string,
  ): number {
    // the count is still worth deriving: it is what a caller checks against
    return gadgets === '' ? 0 : 0
  }

  // -- layout -------------------------------------------------------------

  /**
   * The font MUI measures with.
   *
   * NOTE: topaz 8 metrics, 8 pixels each way. On the machine this is the
   * screen font a MUI object inherits through `_font(obj)`, and MUI's
   * preferences can give a different one per object type — a list, a button
   * and a window title can all differ. Nothing here reads MUI's prefs file,
   * so every object measures in the system font, and that is the one number
   * every reported size is proportional to.
   */
  fontX = 8
  fontY = 8

  /**
   * MUIM_AskMinMax — what an object can be, before anything is placed.
   *
   * The protocol is additive and the developer guide is explicit about it:
   * "let our superclass first fill in what it thinks about sizes ... now add
   * the values specific to our object. note that we indeed need to *add*
   * these values, not just set them!". So Area contributes frame and inner
   * spacing, and the leaf class adds its own content on top.
   *
   * Answers the object's own `mad_MinMax` and remembers it, since MUIM_Layout
   * is a second pass over the same numbers.
   */
  askMinMax(obj: BoopsiObject): MinMax {
    const mm: MinMax = { minW: 0, minH: 0, maxW: 0, maxH: 0, defW: 0, defH: 0 }
    obj.cl.dispatcher(obj.cl, obj, { MethodID: MUI.MUIM_AskMinMax, mm } as Msg)
    // MUI_MAXMAX is a ceiling rather than a sum: a group of three unlimited
    // children is unlimited, not three times unlimited
    mm.maxW = Math.min(mm.maxW, MUI_MAXMAX)
    mm.maxH = Math.min(mm.maxH, MUI_MAXMAX)
    mm.maxW = Math.max(mm.maxW, mm.minW)
    mm.maxH = Math.max(mm.maxH, mm.minH)
    mm.defW = Math.min(Math.max(mm.defW, mm.minW), mm.maxW)
    mm.defH = Math.min(Math.max(mm.defH, mm.minH), mm.maxH)
    data(this, obj).minmax = mm
    return mm
  }

  /** the last MUIM_AskMinMax answer, or undefined if it has not been asked */
  minMaxOf(obj: BoopsiObject): MinMax | undefined {
    return data(this, obj).minmax
  }

  /**
   * Give an object a rectangle, and let a group divide it among its children.
   *
   * Top down, after `askMinMax` has been bottom up. NOT a method: MUI's
   * layout is internal and `mui.h` publishes no `MUIM_Layout` for it. What it
   * does publish is `MUILM_MINMAX` and `MUILM_LAYOUT`, the two message types
   * of `MUIA_Group_LayoutHook` — the escape hatch a custom group installs to
   * lay itself out — so a class cannot intercept the pass at all, only
   * replace its own group's half of it. Sending a method here would be
   * inventing an entry point MUI does not have.
   */
  layout(obj: BoopsiObject, left: number, top: number, width: number, height: number): void {
    data(this, obj).box = { left, top, width, height }
    if (obj.cl.isA(this.groupClass)) this.layoutGroup(obj)
  }

  /** `_left(obj)` and friends — where the layout put it, or null */
  boxOf(obj: BoopsiObject): Box | null {
    return data(this, obj).box ?? null
  }

  /**
   * Divide a group's box among its children.
   *
   * One dimension at a time: along the layout axis each child gets its
   * minimum, then the slack is shared out by weight and clamped at each
   * child's maximum; across the axis every child gets the full extent,
   * clamped to its own maximum. The autodoc's worked example is the
   * definition — "a 100 pixel wide horizontal group with two string gadgets
   * ... give it a weight of 200 (and 100 for the right gadget) ... it will
   * become twice as big (about 66 pixel) as the right one (34 pixel)".
   *
   * NOTE: this is the one-dimensional case. `MUIA_Group_Columns` and
   * `MUIA_Group_Rows` make a group a grid, and neither is laid out here —
   * a grid group falls back to its `MUIA_Group_Horiz` axis, which puts the
   * right children in the right order and the wrong ones on the wrong row.
   * Nothing in the corpus uses one yet.
   */
  private layoutGroup(obj: BoopsiObject): void {
    const box = this.boxOf(obj)
    if (!box) return
    const kids = data(this, obj).children.filter((c) => c.cl.isA(this.areaClass))
    if (kids.length === 0) return

    const horiz = (this.peek(obj, MUI.MUIA_Group_Horiz) ?? 0) !== 0
    const spacing = this.spacingOf(obj, horiz)
    const inner = this.innerOf(obj)
    const x0 = box.left + inner.left
    const y0 = box.top + inner.top
    const w = Math.max(0, box.width - inner.left - inner.right)
    const h = Math.max(0, box.height - inner.top - inner.bottom)

    const mm = kids.map((k) => this.minMaxOf(k) ?? this.askMinMax(k))
    const along = horiz ? w : h
    const across = horiz ? h : w
    const room = along - spacing * (kids.length - 1)

    const min = mm.map((m) => (horiz ? m.minW : m.minH))
    const max = mm.map((m) => (horiz ? m.maxW : m.maxH))
    /*
     * A child with no weight of its own is weightless if it cannot grow and
     * weighs 100 if it can, which is what makes two plain string gadgets
     * share a group evenly without either of them saying so.
     */
    const weight = kids.map((k, i) => {
      const own = this.peek(k, horiz ? MUI.MUIA_HorizWeight : MUI.MUIA_VertWeight) ?? this.peek(k, MUI.MUIA_Weight)
      return Math.max(0, own ?? (max[i]! > min[i]! ? 100 : 0))
    })

    /*
     * The WHOLE room is shared by weight, not the slack above the minimums.
     * That is what the autodoc's worked example says, and the difference is
     * visible in it: two string gadgets in a 100-pixel group weighted 200 and
     * 100 come out "about 66" and "34", where sharing only the slack would
     * give 58 and 41 for the same gadgets.
     *
     * A weight of zero is settled at its minimum before anything is shared —
     * "an object with a weight of 0 will always stay" its own size — and a
     * child that a clamp catches settles too, giving its room back to the
     * rest on the next pass.
     */
    const size = kids.map(() => 0)
    const settled = kids.map((_, i) => weight[i] === 0)
    for (let i = 0; i < kids.length; i++) if (settled[i]) size[i] = min[i]!

    for (let pass = 0; pass <= kids.length; pass++) {
      const open = kids.map((_, i) => i).filter((i) => !settled[i])
      if (open.length === 0) break
      const total = open.reduce((a, i) => a + weight[i]!, 0)
      if (total === 0) break
      const taken = kids.reduce((a, _, i) => a + (settled[i] ? size[i]! : 0), 0)
      const share = room - taken
      let used = 0
      let clamped = false
      for (const [n, i] of open.entries()) {
        // the last open child takes what the floors left behind, so the row
        // fills exactly: 66 and 33 of 100 becomes 66 and 34
        const want = n === open.length - 1 ? share - used : Math.floor((share * weight[i]!) / total)
        used += want
        const fit = Math.max(min[i]!, Math.min(max[i]!, want))
        size[i] = fit
        if (fit !== want) {
          settled[i] = true
          clamped = true
        }
      }
      if (!clamped) break
    }

    let at = horiz ? x0 : y0
    for (let i = 0; i < kids.length; i++) {
      const other = Math.min(across, horiz ? mm[i]!.maxH : mm[i]!.maxW)
      if (horiz) this.layout(kids[i]!, at, y0, size[i]!, other)
      else this.layout(kids[i]!, x0, at, other, size[i]!)
      at += size[i]! + spacing
    }
  }

  /**
   * `MUIA_Group_Spacing` and its two axis-specific forms.
   *
   * NOTE: the default is 1 pixel. The autodoc says "setting a spacing value
   * for a group overrides the user's default settings", so the real default
   * is a MUI preference and there is no prefs file here; 1 is the smallest
   * value that keeps two adjacent objects visibly apart.
   */
  private spacingOf(obj: BoopsiObject, horiz: boolean): number {
    const own = this.peek(obj, horiz ? MUI.MUIA_Group_HorizSpacing : MUI.MUIA_Group_VertSpacing)
    return own ?? this.peek(obj, MUI.MUIA_Group_Spacing) ?? 1
  }

  /** `MUIA_InnerLeft` and friends, which a frame's own padding adds to */
  private innerOf(obj: BoopsiObject): { left: number; top: number; right: number; bottom: number } {
    const frame = (this.peek(obj, MUI.MUIA_Frame) ?? MUI.MUIV_Frame_None) !== MUI.MUIV_Frame_None ? FRAME_EDGE : 0
    return {
      left: frame + (this.peek(obj, MUI.MUIA_InnerLeft) ?? 0),
      top: frame + (this.peek(obj, MUI.MUIA_InnerTop) ?? 0),
      right: frame + (this.peek(obj, MUI.MUIA_InnerRight) ?? 0),
      bottom: frame + (this.peek(obj, MUI.MUIA_InnerBottom) ?? 0),
    }
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
        /*
         * The four geometry attributes are `..g` and MUI fills them in
         * itself: they read the box the layout put the object in rather than
         * anything a program ever Set. A program asks for them after the
         * window is open, which is why they answer null before it.
         */
        if (name === 'Area') {
          const box = this.boxOf(o)
          const edge =
            TAG(g.attrID) === MUI.MUIA_LeftEdge
              ? box?.left
              : TAG(g.attrID) === MUI.MUIA_TopEdge
                ? box?.top
                : TAG(g.attrID) === MUI.MUIA_Width
                  ? box?.width
                  : TAG(g.attrID) === MUI.MUIA_Height
                    ? box?.height
                    : undefined
          if (edge !== undefined) {
            g.storage = edge
            return 1
          }
        }
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

      case MUI.MUIM_AskMinMax:
        return this.askMinMaxOf(name, cl, obj as BoopsiObject, msg)

      default: {
        if (cl === this.applicationClass) {
          const answered = this.applicationMethod(obj as BoopsiObject, msg)
          if (answered !== null) return answered
        }
        if (cl === this.notifyClass) return this.notifyMethod(cl, obj as BoopsiObject, msg)
        return doSuperMethodA(cl, obj, msg)
      }
    }
  }

  // -- Application --------------------------------------------------------

  /**
   * The event loop, as far as one exists without a Wait().
   *
   * Read out of muimaster.library 19.35 with `../cli/muidis.ts`; Application's
   * dispatcher is at $2148f0 and answers 47 methods, of which these two are
   * the pair a program's main loop is built from.
   *
   * `MUIM_Application_ReturnID` ($220812) is sixteen instructions: append the
   * id to the list at `$80(a2)`, and if it is $ff — `moveq #$ff,d0`, which
   * sign-extends to MUIV_Application_ReturnID_Quit — also `bset #0,$47c(a2)`.
   *
   * `MUIM_Application_Input` ($220066) only clears the caller's signal
   * longword and falls into `MUIM_Application_NewInput` ($21f924). NewInput
   * drains the buffered queue at `$84(a2)` when signals were passed, then the
   * ReturnID queue at `$80(a2)`, and answers the first node's first longword.
   * That is why the documented idiom — loop until Input answers Quit — works
   * without Quit being special-cased on the way out: `ReturnID` queued it like
   * any other id.
   *
   * NOT MODELLED: the `$47c` bit 2 branch at $21f980, which sends the
   * undocumented method $8042c58b to the application before exiting. It is
   * the iconify path, it has no name in mui.h, and nothing here can reach it
   * until windows open. The bit-0 flag it tests is set, so the state is right
   * when that slice arrives; only the branch is missing.
   *
   * The signal mask NewInput assembles from every port's `mp_SigBit` (the
   * whole tail from $21ffc0) has no counterpart here and cannot have one:
   * there is one thread, it never blocks, and `Mui Input`'s own comment in
   * ../runtime/easylife.ts sets that deviation out.
   */
  private applicationMethod(obj: BoopsiObject, msg: Msg): number | null {
    const p = msg as Msg & { params?: readonly number[] }
    switch (msg.MethodID) {
      case MUI.MUIM_Application_ReturnID: {
        const [id = 0] = p.params ?? []
        const d = data(this, obj)
        d.returnIDs.push(id)
        if (TAG(id) === MUI.MUIV_Application_ReturnID_Quit) d.quitting = true
        return 0
      }
      case MUI.MUIM_Application_Input:
      case MUI.MUIM_Application_NewInput: {
        // "answer the first node's first longword", and 0 for an empty queue
        return data(this, obj).returnIDs.shift() ?? 0
      }
      default:
        return null
    }
  }

  /**
   * One class's contribution to MUIM_AskMinMax.
   *
   * Additive, so each class hands the message up first and then adds its own
   * content — that is the developer guide's own example and it is the reason
   * a framed button is bigger than an unframed one without Text knowing that
   * frames exist.
   *
   * NOTE: the leaf sizes below Area are the ones with no independent source.
   * MUI's own are computed from the object's font AND its preferences — a
   * string gadget's height is its font plus the frame the user chose, a
   * cycle's width includes an image whose size is a prefs image spec. What is
   * here is the font arithmetic with MUI's structure and without its prefs:
   * every size is a multiple of the system font, which is the part that can
   * be derived, and none of it is pixel-exact against a real MUI.
   */
  private askMinMaxOf(name: string, cl: BoopsiClass, obj: BoopsiObject, msg: Msg): number {
    doSuperMethodA(cl, obj, msg)
    const mm = (msg as Msg & { mm: MinMax }).mm
    const fx = this.fontX
    const fy = this.fontY

    const add = (minW: number, minH: number, maxW: number, maxH: number, defW = minW, defH = minH): void => {
      mm.minW += minW
      mm.minH += minH
      mm.maxW += maxW
      mm.maxH += maxH
      mm.defW += defW
      mm.defH += defH
    }
    /** how many characters WIDE a label is: its escapes take no room */
    const chars = (tag: number): number => visibleLength(this.textOf(obj, tag))

    switch (name) {
      case 'Area': {
        // the frame and the inner spacing, which is what a superclass "thinks
        // about sizes" means in the guide's example
        const i = this.innerOf(obj)
        add(i.left + i.right, i.top + i.bottom, i.left + i.right, i.top + i.bottom)
        return 0
      }
      case 'Group':
        this.groupMinMax(obj, mm)
        return 0
      case 'Rectangle':
        // a spacer: no content, and unlimited in both directions
        add(0, 0, MUI_MAXMAX, MUI_MAXMAX)
        return 0
      case 'Text':
        // as wide as its text and one line tall; text stretches, it does not
        // grow taller
        add(chars(MUI.MUIA_Text_Contents) * fx, fy, MUI_MAXMAX, 0)
        return 0
      case 'String': {
        // a fixed-height edit box: three characters at minimum, the declared
        // MUIA_String_MaxLen as the default where there is one
        const max = this.peek(obj, MUI.MUIA_String_MaxLen) ?? 0
        add(3 * fx, fy, MUI_MAXMAX, 0, Math.max(3, Math.min(max, 40)) * fx, 0)
        return 0
      }
      case 'Image':
        // MUI's built-in images are drawn to the font's box
        add(fx * 2, fy, 0, 0)
        return 0
      case 'Gauge':
        // a bar: unlimited along its axis, one line across
        if ((this.peek(obj, MUI.MUIA_Gauge_Horiz) ?? 0) !== 0) add(fx * 4, fy, MUI_MAXMAX, 0)
        else add(fx, fy * 4, 0, MUI_MAXMAX)
        return 0
      case 'Cycle':
      case 'Popasl':
      case 'Popstring':
      case 'Popobject':
      case 'Poplist':
      case 'Popscreen':
        // a text box with something on the right to click
        add(fx * 6, fy, MUI_MAXMAX, 0)
        return 0
      case 'List':
      case 'Listview':
      case 'Floattext':
      case 'Dirlist':
      case 'Volumelist':
      case 'Scrmodelist':
        // scrollable content: a few lines at minimum, unlimited either way
        add(fx * 8, fy * 3, MUI_MAXMAX, MUI_MAXMAX, fx * 20, fy * 8)
        return 0
      default:
        // every other Area subclass contributes nothing of its own yet, which
        // leaves it exactly its frame and inner spacing
        return 0
    }
  }

  /**
   * A group's own min/max: its children's, combined along its axis.
   *
   * Sums along, maxima across, plus the spacing between each pair. Area has
   * already added the frame and inner spacing by the time this runs, since
   * Group hands the message up first.
   */
  private groupMinMax(obj: BoopsiObject, mm: MinMax): void {
    const kids = data(this, obj).children.filter((c) => c.cl.isA(this.areaClass))
    if (kids.length === 0) return
    const horiz = (this.peek(obj, MUI.MUIA_Group_Horiz) ?? 0) !== 0
    const gaps = this.spacingOf(obj, horiz) * (kids.length - 1)
    const each = kids.map((k) => this.minMaxOf(k) ?? this.askMinMax(k))

    const sum = (f: (m: MinMax) => number): number => each.reduce((a, m) => a + f(m), 0)
    const most = (f: (m: MinMax) => number): number => each.reduce((a, m) => Math.max(a, f(m)), 0)

    if (horiz) {
      mm.minW += sum((m) => m.minW) + gaps
      mm.defW += sum((m) => m.defW) + gaps
      mm.maxW += sum((m) => m.maxW) + gaps
      mm.minH += most((m) => m.minH)
      mm.defH += most((m) => m.defH)
      mm.maxH += Math.min(...each.map((m) => m.maxH))
    } else {
      mm.minH += sum((m) => m.minH) + gaps
      mm.defH += sum((m) => m.defH) + gaps
      mm.maxH += sum((m) => m.maxH) + gaps
      mm.minW += most((m) => m.minW)
      mm.defW += most((m) => m.defW)
      mm.maxW += Math.min(...each.map((m) => m.maxW))
    }
  }

  /**
   * How to read a STRPTR, which this layer cannot do for itself.
   *
   * A MUI object holds its labels as addresses, and an address means nothing
   * here — there is no flat memory. The caller supplies the reader because
   * the caller is the one that knows where a string can be: EasyLife's are in
   * its tag pool for the ones `Tag Str` stored, and in bank 14 for the ones a
   * `Tag List$` template appended after its body and patched a pointer to.
   * Both are addresses in the same synthesized space, and only the runtime
   * can resolve either.
   *
   * Without a reader every label measures as empty, which leaves a Text
   * object as wide as its frame and nothing more.
   */
  readString: ((at: number) => string) | null = null

  textOf(obj: BoopsiObject, tag: number): string {
    const at = this.peek(obj, tag) ?? 0
    return at === 0 ? '' : (this.readString?.(at) ?? '')
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
    for (const raw of attrs) {
      const t = { tag: TAG(raw.tag), data: raw.data }
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
          trigAttr: TAG(trigAttr),
          trigVal,
          dest: this.boopsi.objectAt(dest) ?? dest,
          params: rest,
        })
        return 1
      }
      case MUI.MUIM_KillNotify: {
        const [trigAttr = 0] = p.params ?? []
        const d = data(this, obj)
        d.notifies = d.notifies.filter((n) => n.trigAttr !== TAG(trigAttr))
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
      if (n.trigVal !== value && TAG(n.trigVal) !== MUI.MUIV_EveryTime) continue
      const dest = this.resolveDest(obj, n.dest)
      if (!dest || n.params.length === 0) continue
      const params = n.params.map((v) =>
        TAG(v) === MUI.MUIV_TriggerValue ? value : TAG(v) === MUI.MUIV_NotTriggerValue ? (value === 0 ? 1 : 0) : v,
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

/**
 * Tag values are ULONG, and a caller may hold one as a signed 32-bit integer.
 *
 * Every MUIA_ and MUIM_ id has bit 31 set — they are all `0x8042....` — so a
 * language with signed integers hands them over negative. AMOS is such a
 * language: `Tag("MUIA_Window_Title")` answers -2143360195 for $8042AD3D, and
 * a lookup keyed on the unsigned value misses every attribute in MUI.
 */
const TAG = (t: number): number => t >>> 0

/**
 * A label's length in characters, with MUI's own escapes taken out.
 *
 * `mui.h` defines nine, all two characters beginning with ESC: `\033r`,
 * `\033c`, `\033l` for justification, `\033n`, `\033b`, `\033i`, `\033u` for
 * style, and `\0332`, `\0338` for the two text pens. They are formatting
 * rather than text and take no room, so a Text object measured with them
 * included is two characters too wide per code. Tag_Editor's own labels are
 * full of them — "\033rLength: 0" is one of its status lines.
 *
 * NOTE: the styles are measured but not APPLIED. Bold and italic are wider
 * than plain in a proportional face; the system font here is topaz 8, which
 * is fixed-pitch, so every style is the same width and the distinction has
 * nothing to show for itself yet.
 */
export function visibleLength(s: string): number {
  let n = 0
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) === 27) {
      i++
      continue
    }
    n++
  }
  return n
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
  return TAG_NAME.get(TAG(tag)) ?? ''
}
