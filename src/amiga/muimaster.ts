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
 * Constants and the class tree are TRANSCRIBED from `libraries/mui.h`, MUI
 * 3.8 — which is a statement about where the numbers were typed from, not
 * about what is available to read. `muimaster.library` 19.35 is held and
 * `../cli/muidis.ts` reads it, so the header says what the author intended,
 * the library is what programs ran against, and where they disagree the
 * library decides. Two independent checks are wired up: EasyLife ships the
 * same constants by name in its Tags bank and `muimaster.test.ts` compares
 * the two tables, and the class tree below has been put against the binary's
 * own class registry with zero parent mismatches.
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
 * exactly, so it is confirmed and not merely transcribed; the 35 hold 507
 * method-table
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
  OM_ADDTAIL,
  OM_DISPOSE,
  OM_GET,
  OM_NEW,
  OM_NOTIFY,
  OM_REMOVE,
  OM_REMMEMBER,
  OM_SET,
  OM_UPDATE,
  doSuperMethodA,
  type BoopsiClass,
  type BoopsiObject,
  type Msg,
  type OpGet,
  type OpMember,
  type OpSet,
  type TagItem,
} from './boopsi'
import { MUI, MUIC, MUI_ATTR, MUI_OWNER } from './muimaster.gen'
import { MemPool } from './exec'
import { rtFormat } from './reqtools'

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

/**
 * The classes physically built into muimaster.library 19.35.
 *
 * This is the registry at $237088, not mui.h's larger class tree. The other
 * classes named by the header are libraries in MUI:Libs/mui and must not be
 * reported as available merely because their constants are known. Cclist is
 * the converse: internal to the binary and absent from mui.h's drawing.
 */
export const MUI_BUILTIN_SUPER: Readonly<Record<string, string>> = {
  Semaphore: 'rootclass',
  Applist: 'Semaphore',
  Cclist: 'Semaphore',
  Dataspace: 'Semaphore',
  Configdata: 'Dataspace',
  Notify: 'rootclass',
  Family: 'Notify',
  Menustrip: 'Family',
  Menu: 'Family',
  Menuitem: 'Family',
  Application: 'Notify',
  Window: 'Notify',
  Area: 'Notify',
  Image: 'Area',
  Bitmap: 'Area',
  Bodychunk: 'Bitmap',
  Text: 'Area',
  Rectangle: 'Area',
  Balance: 'Area',
  Gadget: 'Area',
  String: 'Gadget',
  Prop: 'Gadget',
  List: 'Area',
  Group: 'Area',
  Numeric: 'Area',
  Slider: 'Numeric',
  Cycle: 'Group',
  Scrollbar: 'Group',
  Listview: 'Group',
  Radio: 'Group',
  Popstring: 'Group',
  Popobject: 'Popstring',
  Poplist: 'Popobject',
  Register: 'Group',
  Mccprefs: 'Group',
}

/** Private Applist methods present in 19.35's table but absent from mui.h. */
export const MUIM_APPLIST_BROADCAST = 0x8042615c
export const MUIM_APPLIST_FIND = 0x8042e50f

/** Private Dataspace operations present in 19.35's method table. */
export const MUIM_DATASPACE_EQUAL = 0x8042b393
export const MUIM_DATASPACE_PRUNE = 0x8042032e
export const MUIM_DATASPACE_NEXT = 0x80421873

/** Configdata's private API and attributes, recovered from its 19.35 table. */
export const MUIM_CONFIGDATA_GET = 0x8042539a
export const MUIM_CONFIGDATA_HAS = 0x80421162
export const MUIM_CONFIGDATA_SET = 0x80428b0e
export const MUIM_CONFIGDATA_ACCEPTS = 0x8042e075
export const MUIA_CONFIGDATA_FALLBACK = 0x8042e03a
export const MUIA_CONFIGDATA_SELECTOR = 0x80420444
export const MUIM_NOTIFY_SET_CONTEXT = 0x8042d532
export const MUIM_NOTIFY_IS_SELF = 0x8042038f
export const MUIM_FAMILY_EXCLUSIVE = 0x8042c399
export const MUIM_MENUSTRIP_BUILD = 0x80427efd
export const MUIM_MENUSTRIP_FREE = 0x8042e15f
export const MUIM_MENUSTRIP_UPDATE = 0x8042ed51
export const MUIM_MENU_FILL_NEWMENU = 0x804207c9
export const MUIM_MENU_SYNC = 0x804241d4
/** Private construction tag set by MUIO_Menuitem_CopyStrings. */
export const MUIA_MENUITEM_COPY_STRINGS = 0x8042dc1b
export const MUIM_APPLICATION_FLUSH_PUSHED = 0x80429954
export const MUIM_APPLICATION_FIND_WINDOW = 0x8042f5e1
export const MUIM_APPLICATION_CONFIG_CHANGED = 0x8042fe91
/** Numeric.mui's three private 19.35 method-table entries. */
export const MUIM_NUMERIC_STRINGIFY_CURRENT = 0x8042148f
export const MUIM_NUMERIC_MEASURE = 0x8042a2f2
export const MUIM_NUMERIC_APPLY_DEFAULT = 0x80421ecc
/** Private construction attribute tested by MUIM_NUMERIC_APPLY_DEFAULT. */
export const MUIA_NUMERIC_APPLY_DEFAULT = 0x80426652
export const MUIM_APPLICATION_REFRESH_WINDOW = 0x80426771
export const MUIM_APPLICATION_DEFAULT_NAME = 0x80423a3d
export const MUIM_APPLICATION_NOOP = 0x8042c5b9
export const MUIM_APPLICATION_PREFS_AVAILABLE = 0x80426b99
export const MUIM_APPLICATION_CLOSE_CONFIG = 0x80429d2f
export const MUIM_APPLICATION_APPLY_CONFIG = 0x8042c58b
export const MUIM_APPLICATION_REXX_COMMAND = 0x80426e36
export const MUIM_APPLICATION_WAKE_CONFIG = 0x8042fe91
export const MUIM_APPLICATION_SAVE_NAMED = 0x80420b19
export const MUIM_APPLICATION_LOAD_NAMED = 0x8042c862
export const MUIM_APPLICATION_CONFIG_RESPONSE = 0x8042a08c
export const MUIM_APPLICATION_NEW_PREFS = 0x80424a8b
export const MUIM_APPLICATION_HELP_REQUEST = 0x8042df8a
export const MUIM_APPLICATION_REQUEST = 0x8042ba68
export const MUIM_APPLICATION_BROADCAST = 0x8042ca1f
export const MUIM_APPLICATION_SET_MENU_CHECK_PRIVATE = 0x804233d4
export const MUIM_APPLICATION_GET_MENU_CHECK_PRIVATE = 0x804205b2
export const MUIM_APPLICATION_SET_MENU_STATE_PRIVATE = 0x80426697
export const MUIM_APPLICATION_GET_MENU_STATE_PRIVATE = 0x80421526
/** Window.mui 19.35 private method-table ids, retained because built-ins call them. */
export const MUIM_WINDOW_LAYOUT = 0x80425ebe
export const MUIM_WINDOW_VALIDATE_SIZE = 0x80427c9b
export const MUIM_WINDOW_HANDLE_EVENT = 0x80426a85
export const MUIM_WINDOW_REFRESH = 0x80426771
export const MUIM_WINDOW_CLIP_ON = 0x8042671f
export const MUIM_WINDOW_CLIP_OFF = 0x8042174e
export const MUIM_WINDOW_ICONIFY = 0x80422cc0
export const MUIM_WINDOW_TRUE = 0x8042c34c
export const MUIM_WINDOW_FALSE = 0x8042ab26
export const MUIM_WINDOW_CONTEXT_MENU = 0x8042ca1f
export const MUIM_WINDOW_BROADCAST = 0x8042d532
export const MUIM_WINDOW_ROOT_METHOD = 0x8042867c
export const MUIM_WINDOW_UPDATE_TITLES = 0x8042926f
export const MUIM_WINDOW_REPLACE_ROOT = 0x8042fd4d
export const MUIM_AREA_LAYOUT = 0x8042845b
export const MUIM_AREA_NOOP = 0x80424d50
export const MUIM_AREA_RESET_SETUP = 0x80421407
export const MUIM_AREA_FIND_AT = 0x8042867c
export const MUIM_AREA_REDRAW = 0x8042491a
export const MUIM_AREA_DEACTIVATE = 0x80422c0c
export const MUIM_AREA_ENABLE_NESTED = 0x80428f6c
export const MUIM_AREA_DISABLE_NESTED = 0x8042af9f
export const MUIM_AREA_FALSE = 0x80428d73
export const MUIM_AREA_TRUE = 0x8042f8a4
export const MUIM_AREA_CREATE_DRAG_IMAGE = 0x80424f05
export const MUIM_AREA_DELETE_DRAG_IMAGE = 0x80428daf
export const MUIM_AREA_CREATE_BUBBLE_IMAGE = 0x8042eb6f
export const MUIM_AREA_DELETE_BUBBLE_IMAGE = 0x80423037
export const MUIM_AREA_HIT_TEST = 0x804216bb
export const MUIA_GADGET_ACTIVE = 0x804232d2
export const MUIA_GADGET_WINDOW = 0x804282bc
export const MUIM_STRING_DRAW_BACKGROUND = 0x80428d73
/** List.mui 19.35 private method-table ids used by layout and dragging. */
export const MUIM_LIST_LAYOUT = 0x8042845b
export const MUIM_LIST_SET_DROP_MARK = 0x80429e97
export const MUIM_LIST_CREATE_DRAG_IMAGE = 0x80424534
export const MUIM_LIST_DELETE_DRAG_IMAGE = 0x80425a68
export const MUIM_LIST_COLUMN_OFFSET = 0x8042e09e
export const MUIM_GROUP_TRANSFER_CHILDREN = 0x8042fb67
export const MUIM_GROUP_EXIT_CHANGE2 = 0x8042e541
export const MUIM_GROUP_RUN_LAYOUT_HOOK = 0x80425906
export const MUIM_GROUP_MOVE_TO_TAIL = 0x8042ff4e
export const MUIM_GROUP_COLLECT_CYCLE = 0x8042b22e
export const MUIM_GROUP_CLEAR_CYCLE = 0x8042c520
/** Cclist.mui's private 19.35 catalogue operations. */
export const MUIM_CCLIST_ADD_CLASS = 0x80421bc7
export const MUIM_CCLIST_FILL_LIST = 0x8042f821

const IDCMP_NEWSIZE = 0x2
const IDCMP_REFRESHWINDOW = 0x4
const IDCMP_MOUSEBUTTONS = 0x8
const IDCMP_MOUSEMOVE = 0x10
const IDCMP_MENUPICK = 0x100
const IDCMP_CLOSEWINDOW = 0x200
const IDCMP_RAWKEY = 0x400
const IDCMP_ACTIVEWINDOW = 0x40000
const IDCMP_INACTIVEWINDOW = 0x80000
const MUIV_KILLNOTIFY_ALL = 0xabcd1234
const GROUP_AREA_PASSTHROUGH = new Set<number>([
  OM_ADDTAIL, OM_REMOVE, OM_NOTIFY, OM_UPDATE,
  0x80424d50, 0x80428d73, MUI.MUIM_CallHook, MUI.MUIM_Set,
  MUI.MUIM_DragQuery, MUI.MUIM_DragBegin, MUI.MUIM_DragReport, MUI.MUIM_DragDrop, MUI.MUIM_DragFinish,
  MUI.MUIM_MultiSet, MUI.MUIM_ContextMenuChoice, MUI.MUIM_ContextMenuBuild,
  0x8042491a, 0x80422c0c, 0x8042af9f, 0x80428f6c,
  MUI.MUIM_GetConfigItem, MUI.MUIM_DrawBackground, 0x8042f8a4,
  MUI.MUIM_CreateShortHelp, MUI.MUIM_DeleteShortHelp,
  0x80424f05, 0x80428daf, 0x8042eb6f, 0x80423037, 0x804216bb,
  MUI.MUIM_CreateBubble, MUI.MUIM_DeleteBubble,
])

/** Synthetic address range containing Dataspace's AllocPooled records. */
export const MUI_MEMORY_BASE = 0x2c000000
export const MUI_MEMORY_RESERVED = 0x04000000

/**
 * Configdata's 150 eight-byte descriptors at $236b48. Byte zero is the
 * one-based id, byte one is its preference group, byte three carries the
 * string flag, and the longword is the default. Pointer defaults are replaced
 * below with their pointed-to text, since native code addresses are not guest
 * addresses in this port.
 */
const CONFIG_GROUPS = hexBytes(
  '01010101030302020607070707010202040401000063630904040701010107010702010063636363006303030a080707060a02040205010103070a06040307070706060606030304080808060a0a0a0a0a0a0a020a0a0a0a0a0205050a0a0909090909090909090909090909090909090909090901010101630109000000630300000608080808050909090909090905636363090207',
)
const CONFIG_FLAGS = hexBytes(
  '000000000303030303030203030002020202000000000004020203000004060406060404000000000400070706070707040607060707040407070604060707070707070707070706070707040606060606060607060606060607070706060404040404040404040404040404040404040404040400000000000000000000000700000007070707070000040400000407000000000707',
)
const CONFIG_DEFAULTS: readonly number[] = [
  4,4,3,3,4,1,6,3,0,1,1,0,0,0,0,1,2,0,0,1,0,0,6,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,2165842,2165842,0,2165844,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,1,0,1,0,0,20,3,0,0,0,0,0,0,1,0,0,0,1,3,0,0,0,2166394,2165842,1,0,0,
]
const CONFIG_TEXT: Readonly<Record<number, string>> = {
  24:'300000',30:'',31:'',32:'',33:'',34:'',35:'',36:'',39:'',40:'',41:'',42:'000000',43:'202211',44:'202211',45:'212211',46:'302211',47:'212211',48:'202211',49:'202211',50:'210000',51:'314444',52:'112211',53:'212211',54:'400000',55:'',56:'0:137',57:'',58:'',59:'',60:'',61:'0:130',62:'0:131',63:'0:131',64:'0:135',65:'0:138',66:'1:0',67:'1:1',68:'1:2',69:'1:3',70:'1:4',71:'1:5',72:'1:6',73:'1:7',74:'1:8',75:'1:9',76:'0:129',77:'1:10',78:'1:11',79:'1:12',80:'1:13',81:'1:14',82:'1:15',83:'1:16',84:'',85:'1:17',86:'1:18',87:'1:19',88:'1:20',89:'1:21',90:'',91:'',92:'',93:'1:22',94:'1:23',95:'-upstroke return',96:'-repeat space',97:'-repeat up',98:'-repeat down',99:'-repeat shift up',100:'-repeat shift down',101:'control up',102:'control down',103:'-repeat left',104:'-repeat right',105:'-repeat control left',106:'-repeat control right',107:'shift left',108:'shift right',109:'-repeat tab',110:'-repeat shift tab',111:'control tab',112:'esc',113:'-repeat alt tab',114:'-repeat alt shift tab',115:'help',116:'control p',128:'',132:'m2',133:'m5',134:'m2',135:'m5',136:'',139:'control',140:'',143:'m0',144:'202200',146:'control',147:'',149:'',150:'',
}

/** one notification recorded by MUIM_Notify */
export interface Notification {
  trigAttr: number
  trigVal: number
  dest: BoopsiObject | number
  /** the method longwords: `[MethodID, ...params]` */
  params: readonly number[]
  /** bit 31 of FollowParams: eligible for the private kill-all sentinel */
  killableAll?: boolean
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
  ownedAddresses: number[]
  contextApplication: BoopsiObject | null
  contextConfigdata: BoopsiObject | null
}

/** The SignalSemaphore embedded in Semaphore.mui's instance data. */
interface MuiSemaphoreData extends Record<string, unknown> {
  exclusive: number
  shared: number
}

interface MuiApplistData extends Record<string, unknown> {
  members: BoopsiObject[]
}

interface MuiCclistData extends Record<string, unknown> {
  records: Array<{ address: number, name: string }>
}

interface MuiDataspaceEntry {
  address: number
  id: number
  length: number
}

interface MuiDataspaceData extends Record<string, unknown> {
  entries: MuiDataspaceEntry[]
  filterIds: boolean
  configRecords: boolean
}

interface MuiConfigdataData extends Record<string, unknown> {
  fallback: BoopsiObject | null
  selector: number
}

interface MuiFamilyData extends Record<string, unknown> {
  listAddress: number
  nodesAddress: number
}

interface MuiMenustripData extends Record<string, unknown> {
  handles: Set<number>
}

interface MuiMenuitemData extends Record<string, unknown> {
  copyStrings: boolean
}

interface MuiApplicationData extends Record<string, unknown> {
  bufferedReturnIDs: number[]
  pushed: Array<{ target: BoopsiObject; message: number[] }>
  inputHandlers: number[]
  inputDeadlines: Map<number, number>
  sleepDepth: number
  listAddress: number
  nodesAddress: number
  configdata: BoopsiObject | null
  configDirty: boolean
}

export interface MuiWindowSpec {
  left: number
  top: number
  width: number
  height: number
  title: string
  screenTitle: string
  publicScreen: string
  screenAddress: number
  flags: {
    activate: boolean
    backdrop: boolean
    borderless: boolean
    closeGadget: boolean
    depthGadget: boolean
    dragBar: boolean
    sizeGadget: boolean
  }
}

export interface MuiWindowGeometry {
  left: number
  top: number
  width: number
  height: number
  screenAddress: number
  active: boolean
}

export interface MuiWindowEvent {
  class: number
  code: number
  qualifier: number
  mouseX: number
  mouseY: number
  seconds: number
  micros: number
  iaddress: number
}

export interface MuiWindowHost {
  open(spec: MuiWindowSpec): unknown | null
  close(handle: unknown): void
  geometry(handle: unknown): MuiWindowGeometry
  activate(handle: unknown): void
  toFront(handle: unknown): void
  toBack(handle: unknown): void
  screenToFront(handle: unknown): void
  screenToBack(handle: unknown): void
  setTitles(handle: unknown, title: string, screenTitle: string): void
  poll(handle: unknown): MuiWindowEvent[]
  drawArea?(handle: unknown, spec: MuiAreaRenderSpec): void
  drawImage?(handle: unknown, spec: MuiImageRenderSpec): void
  drawBitmap?(handle: unknown, spec: MuiBitmapRenderSpec): void
  drawText?(handle: unknown, spec: MuiTextRenderSpec): void
  drawRectangle?(handle: unknown, spec: MuiRectangleRenderSpec): void
  drawBalance?(handle: unknown, spec: MuiBalanceRenderSpec): void
  drawList?(handle: unknown, spec: MuiListRenderSpec): void
  drawSlider?(handle: unknown, spec: MuiSliderRenderSpec): void
  showGadget?(handle: unknown, address: number, box: Box, disabled: boolean): void
  hideGadget?(handle: unknown, address: number): void
  refreshGadget?(handle: unknown, address: number): void
  activateGadget?(handle: unknown, address: number): void
  configureStringGadget?(address: number, state: MuiStringGadgetState, activation: number): void
  configurePropGadget?(address: number, state: MuiPropGadgetState, horizontal: boolean): void
  disposeGadget?(address: number): void
}

/** Mutable PropInfo state shared with the Intuition platform adapter. */
export interface MuiPropGadgetState {
  flags: number
  horizPot: number
  vertPot: number
  horizBody: number
  vertBody: number
}

/** Mutable StringInfo state shared with the Intuition platform adapter. */
export interface MuiStringGadgetState {
  buffer: string
  maxChars: number
  bufferPos: number
  displayPos: number
  longInt: number
  accept: string
  reject: string
  secret: boolean
  /** Set by Intuition only when Return committed this edit. */
  accepted: boolean
}

export interface MuiAreaRenderSpec extends Box {
  background: number
  frame: number
  selected: boolean
  disabled: boolean
  fill: boolean
  drawFlags: number
}

export interface MuiListRenderSpec extends Box {
  title: string
  rows: readonly { text: string, active: boolean, selected: boolean }[]
  first: number
  lineHeight: number
  disabled: boolean
}

export interface MuiSliderRenderSpec extends Box {
  horizontal: boolean
  knob: Box
  label: string
  quiet: boolean
  disabled: boolean
}

export interface MuiImageRenderSpec extends Box {
  spec: number
  oldImage: number
  state: number
}

export interface MuiBitmapRenderSpec extends Box {
  bitmap: number
  sourceWidth: number
  sourceHeight: number
  mappingTable: number
  transparent: number
  body: number
  depth: number
  compression: number
  masking: number
}

export interface MuiTextRenderSpec extends Box {
  contents: string
  preparse: string
  disabled: boolean
}

export interface MuiRectangleRenderSpec extends Box {
  hbar: boolean
  vbar: boolean
  title: string
}

export interface MuiBalanceRenderSpec extends Box {
  horizontalGroup: boolean
  dragging: boolean
}

interface MuiWindowData extends Record<string, unknown> {
  handle: unknown | null
  nativeAddress: number
  eventHandlers: number[]
  sleepDepth: number
}

interface MuiAreaData extends Record<string, unknown> {
  setup: boolean
  shown: boolean
  disableDepth: number
  dragging: boolean
  drawFlags: number
  handles: Set<number>
}

interface MuiImageData extends Record<string, unknown> {
  setup: boolean
}

interface MuiBitmapData extends Record<string, unknown> {
  setup: boolean
  remappedBitmap: number
}

interface MuiBodychunkData extends Record<string, unknown> {
  setup: boolean
}

interface MuiBalanceData extends Record<string, unknown> {
  dragging: boolean
  startX: number
  startY: number
}

interface MuiGadgetData extends Record<string, unknown> {
  gadget: number
  handle: unknown | null
  attached: boolean
  active: boolean
}

interface MuiStringData extends Record<string, unknown> {
  state: MuiStringGadgetState
  bufferAddress: number
  gadgetAddress: number
  acknowledgeAddress: number
}

interface MuiPropData extends Record<string, unknown> {
  state: MuiPropGadgetState
  gadgetAddress: number
  entries: number
  visible: number
  first: number
  horizontal: boolean
  slider: boolean
  useWinBorder: number
  deltaFactor: number
}

interface MuiListEntry {
  address: number
  selected: boolean
  owned: boolean
}

interface MuiListData extends Record<string, unknown> {
  entries: MuiListEntry[]
  active: number
  first: number
  visible: number
  insertPosition: number
  dropMark: number
  quiet: boolean
  dirty: boolean
  lineHeight: number
  imageHandles: Map<number, BoopsiObject>
  dragImageHandle: number
}

interface MuiGroupData extends Record<string, unknown> {
  listAddress: number
  nodesAddress: number
  changeDepth: number
}

interface MuiNumericData extends Record<string, unknown> {
  bufferAddress: number
  min: number
  max: number
  value: number
  defaultValue: number
  format: number
  checkAllSizes: boolean
  reverse: boolean
  revLeftRight: boolean
  revUpDown: boolean
  applyDefault: boolean
}

interface MuiSliderData extends Record<string, unknown> {
  horizontal: boolean
  quiet: boolean
  setup: boolean
  dragging: boolean
  dragStart: number
  knobStart: number
}

interface MuiCycleData extends Record<string, unknown> {
  entriesAddress: number
  entries: number[]
  active: number
  label: BoopsiObject
  image: BoopsiObject
  pressed: boolean
}

interface MuiScrollbarData extends Record<string, unknown> {
  prop: BoopsiObject
  decrement: BoopsiObject
  increment: BoopsiObject
  horizontal: boolean
  type: number
}

interface MuiListviewData extends Record<string, unknown> {
  list: BoopsiObject
  scrollbar: BoopsiObject | null
  input: boolean
  dragType: number
  multiSelect: number
  clickColumn: number
  defaultClickColumn: number
}

interface MuiRadioData extends Record<string, unknown> {
  entriesAddress: number
  entries: number[]
  active: number
  images: BoopsiObject[]
  labels: BoopsiObject[]
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
  /** The native class allocates Dataspace records from a pool and returns pointers into it. */
  readonly pool = new MemPool(MUI_MEMORY_BASE, MUI_MEMORY_RESERVED)
  /** Runtime memory bridge used when a method receives or updates a guest pointer. */
  readMemory: ((address: number, length: number) => Uint8Array | null) | null = null
  readLong: ((address: number) => number | null) | null = null
  writeLong: ((address: number, value: number) => boolean) | null = null
  writeMemory: ((address: number, bytes: Uint8Array) => boolean) | null = null
  /** iffparse bridge: one pushed chunk's payload, and the current chunk when reading. */
  writeIffChunk: ((handle: number, type: number, id: number, bytes: Uint8Array) => number) | null = null
  readIffChunk: ((handle: number) => Uint8Array | number | null) | null = null
  /** Window/Application platform bridge for a live Intuition menu strip. */
  menuChanged: ((menustrip: BoopsiObject) => void) | null = null
  windowHost: MuiWindowHost | null = null
  /** Platform boundaries used by Application methods; Runtime supplies these as its subsystems land. */
  applicationRefresh: ((window: BoopsiObject) => void) | null = null
  applicationHelp: ((application: BoopsiObject, object: BoopsiObject | null, flags: number) => number) | null = null
  applicationAbout: ((application: BoopsiObject, reference: BoopsiObject | null) => void) | null = null
  applicationConfig: ((application: BoopsiObject, open: boolean) => number) | null = null
  applicationSave: ((application: BoopsiObject, name: number, bytes: Uint8Array) => boolean) | null = null
  applicationLoad: ((application: BoopsiObject, name: number) => Uint8Array | null) | null = null
  applicationNow: () => number = () => Date.now()
  private readonly configDefaultPointers = new Map<number, number>()
  private suppressNotifications = 0
  private sharedConfigdata: BoopsiObject | null = null
  private readonly literalPointers = new Map<string, number>()
  private readonly applications = new Set<BoopsiObject>()
  /** "Window.mui" -> its class, which is what MUI_NewObjectA is given */
  private readonly byName = new Map<string, BoopsiClass>()
  /** the classes whose behaviour this file specialises, by name */
  readonly notifyClass: BoopsiClass
  readonly semaphoreClass: BoopsiClass
  readonly applistClass: BoopsiClass
  readonly cclistClass: BoopsiClass
  readonly dataspaceClass: BoopsiClass
  readonly configdataClass: BoopsiClass
  readonly familyClass: BoopsiClass
  readonly menustripClass: BoopsiClass
  readonly menuClass: BoopsiClass
  readonly menuitemClass: BoopsiClass
  readonly areaClass: BoopsiClass
  readonly imageClass: BoopsiClass
  readonly bitmapClass: BoopsiClass
  readonly bodychunkClass: BoopsiClass
  readonly textClass: BoopsiClass
  readonly rectangleClass: BoopsiClass
  readonly balanceClass: BoopsiClass
  readonly gadgetClass: BoopsiClass
  readonly stringClass: BoopsiClass
  readonly propClass: BoopsiClass
  readonly listClass: BoopsiClass
  readonly groupClass: BoopsiClass
  readonly numericClass: BoopsiClass
  readonly sliderClass: BoopsiClass
  readonly cycleClass: BoopsiClass
  readonly scrollbarClass: BoopsiClass
  readonly listviewClass: BoopsiClass
  readonly radioClass: BoopsiClass
  readonly windowClass: BoopsiClass
  readonly applicationClass: BoopsiClass

  constructor(boopsi = new Boopsi()) {
    this.boopsi = boopsi
    const internedDefaults = new Map<string, number>()
    for (const [key, value] of Object.entries(CONFIG_TEXT)) {
      let address = internedDefaults.get(value) ?? 0
      if (address === 0) {
        const bytes = Uint8Array.from([...value, '\0'], (c) => c.charCodeAt(0))
        address = this.pool.alloc(bytes.length)
        this.pool.buffer.set(bytes, address - this.pool.base)
        internedDefaults.set(value, address)
      }
      this.configDefaultPointers.set(Number(key), address)
    }

    /*
     * Build in dependency order: a class cannot be made before its superclass.
     * The native registry is a flat map, so walk it and resolve each parent on demand,
     * which terminates because rootclass exists and the tree has no cycles.
     */
    const make = (name: string): BoopsiClass => {
      const have = this.byName.get(`${name}.mui`)
      if (have) return have
      const supName = MUI_BUILTIN_SUPER[name]
      const sup = supName === undefined || supName === 'rootclass' ? boopsi.rootClass : make(supName)
      const cl = boopsi.makeClass(`${name}.mui`, sup, (c, o, m) => this.dispatch(name, c, o, m))
      if (!cl) throw new Error(`muimaster: cannot make ${name} under ${supName}`)
      this.byName.set(`${name}.mui`, cl)
      return cl
    }
    for (const name of Object.keys(MUI_BUILTIN_SUPER)) make(name)

    this.semaphoreClass = this.byName.get('Semaphore.mui')!
    this.applistClass = this.byName.get('Applist.mui')!
    this.cclistClass = this.byName.get('Cclist.mui')!
    this.dataspaceClass = this.byName.get(MUIC.MUIC_Dataspace)!
    this.configdataClass = this.byName.get(MUIC.MUIC_Configdata)!
    this.notifyClass = this.byName.get(MUIC.MUIC_Notify)!
    this.familyClass = this.byName.get(MUIC.MUIC_Family)!
    this.menustripClass = this.byName.get(MUIC.MUIC_Menustrip)!
    this.menuClass = this.byName.get(MUIC.MUIC_Menu)!
    this.menuitemClass = this.byName.get(MUIC.MUIC_Menuitem)!
    this.areaClass = this.byName.get(MUIC.MUIC_Area)!
    this.imageClass = this.byName.get(MUIC.MUIC_Image)!
    this.bitmapClass = this.byName.get(MUIC.MUIC_Bitmap)!
    this.bodychunkClass = this.byName.get(MUIC.MUIC_Bodychunk)!
    this.textClass = this.byName.get(MUIC.MUIC_Text)!
    this.rectangleClass = this.byName.get(MUIC.MUIC_Rectangle)!
    this.balanceClass = this.byName.get(MUIC.MUIC_Balance)!
    this.gadgetClass = this.byName.get(MUIC.MUIC_Gadget)!
    this.stringClass = this.byName.get(MUIC.MUIC_String)!
    this.propClass = this.byName.get(MUIC.MUIC_Prop)!
    this.listClass = this.byName.get(MUIC.MUIC_List)!
    this.groupClass = this.byName.get(MUIC.MUIC_Group)!
    this.numericClass = this.byName.get(MUIC.MUIC_Numeric)!
    this.sliderClass = this.byName.get(MUIC.MUIC_Slider)!
    this.cycleClass = this.byName.get(MUIC.MUIC_Cycle)!
    this.scrollbarClass = this.byName.get(MUIC.MUIC_Scrollbar)!
    this.listviewClass = this.byName.get(MUIC.MUIC_Listview)!
    this.radioClass = this.byName.get(MUIC.MUIC_Radio)!
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
    if (obj.cl.isA(this.areaClass)) this.constrainAreaMinMax(obj, mm)
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
   * Rows and columns use the same bounded weight distribution over their
   * native per-track aggregates; page groups lay out only ActivePage.
   */
  private layoutGroup(obj: BoopsiObject): void {
    const box = this.boxOf(obj)
    if (!box) return
    const kids = data(this, obj).children.filter((c) => c.cl.isA(this.areaClass))
    if (kids.length === 0) return

    if ((this.peek(obj, MUI.MUIA_Group_PageMode) ?? 0) !== 0) {
      const page = Math.max(0, Math.min(kids.length - 1, this.peek(obj, MUI.MUIA_Group_ActivePage) ?? 0))
      const inner = this.innerOf(obj)
      for (let i = 0; i < kids.length; i++) data(this, kids[i]!).attrs.set(MUI.MUIA_ShowMe, i === page ? 1 : 0)
      this.layout(kids[page]!, box.left + inner.left, box.top + inner.top,
        Math.max(0, box.width - inner.left - inner.right), Math.max(0, box.height - inner.top - inner.bottom))
      return
    }

    const shape = this.groupShape(obj, kids.length)
    if (shape.columns > 1 && shape.rows > 1) {
      this.layoutGroupGrid(obj, kids, shape.columns, shape.rows)
      return
    }

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
    const sameAlong = (this.peek(obj, horiz ? MUI.MUIA_Group_SameWidth : MUI.MUIA_Group_SameHeight) ?? 0) !== 0
    if (sameAlong) {
      const each = Math.max(0, Math.floor(room / kids.length))
      let at = horiz ? x0 : y0
      for (let i = 0; i < kids.length; i++) {
        const alongSize = Math.max(min[i]!, Math.min(max[i]!, each))
        const other = Math.min(across, horiz ? mm[i]!.maxH : mm[i]!.maxW)
        if (horiz) this.layout(kids[i]!, at, y0, alongSize, other)
        else this.layout(kids[i]!, x0, at, other, alongSize)
        at += alongSize + spacing
      }
      return
    }
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

  private groupShape(obj: BoopsiObject, count: number): { columns: number, rows: number } {
    const requestedColumns = Math.max(1, this.peek(obj, MUI.MUIA_Group_Columns) ?? 1)
    const requestedRows = Math.max(1, this.peek(obj, MUI.MUIA_Group_Rows) ?? 0x7fff)
    if (requestedColumns === 0x7fff) return { columns: Math.max(1, count), rows: 1 }
    if (requestedRows === 0x7fff) {
      const columns = Math.max(1, Math.min(count, requestedColumns))
      return { columns, rows: Math.max(1, Math.ceil(count / columns)) }
    }
    const columns = Math.max(1, Math.min(count, requestedColumns))
    return { columns, rows: Math.max(1, Math.ceil(count / columns)) }
  }

  private layoutGroupGrid(obj: BoopsiObject, kids: BoopsiObject[], columns: number, rows: number): void {
    const box = this.boxOf(obj)!
    const inner = this.innerOf(obj)
    const x0 = box.left + inner.left
    const y0 = box.top + inner.top
    const width = Math.max(0, box.width - inner.left - inner.right)
    const height = Math.max(0, box.height - inner.top - inner.bottom)
    const hspace = this.spacingOf(obj, true)
    const vspace = this.spacingOf(obj, false)
    const mm = kids.map((child) => this.minMaxOf(child) ?? this.askMinMax(child))
    const columnItems = Array.from({ length: columns }, (_, column) => mm.map((value, i) => ({ value, i })).filter((_, i) => i % columns === column))
    const rowItems = Array.from({ length: rows }, (_, row) => mm.map((value, i) => ({ value, i })).slice(row * columns, (row + 1) * columns))
    const sameW = (this.peek(obj, MUI.MUIA_Group_SameWidth) ?? 0) !== 0
    const sameH = (this.peek(obj, MUI.MUIA_Group_SameHeight) ?? 0) !== 0
    const colMin = columnItems.map((items) => Math.max(0, ...items.map(({ value }) => value.minW)))
    const colMax = columnItems.map((items) => Math.min(MUI_MAXMAX, ...items.map(({ value }) => value.maxW)))
    const rowMin = rowItems.map((items) => Math.max(0, ...items.map(({ value }) => value.minH)))
    const rowMax = rowItems.map((items) => Math.min(MUI_MAXMAX, ...items.map(({ value }) => value.maxH)))
    if (sameW) colMin.fill(Math.max(...colMin))
    if (sameH) rowMin.fill(Math.max(...rowMin))
    const colWeight = columnItems.map((items) => Math.max(1, Math.floor(items.reduce((sum, { i }) =>
      sum + (this.peek(kids[i]!, MUI.MUIA_HorizWeight) ?? 100), 0) / Math.max(1, items.length))))
    const rowWeight = rowItems.map((items) => Math.max(1, Math.floor(items.reduce((sum, { i }) =>
      sum + (this.peek(kids[i]!, MUI.MUIA_VertWeight) ?? 100), 0) / Math.max(1, items.length))))
    const colSize = this.distributeTracks(Math.max(0, width - hspace * (columns - 1)), colMin, colMax, colWeight)
    const rowSize = this.distributeTracks(Math.max(0, height - vspace * (rows - 1)), rowMin, rowMax, rowWeight)
    const colAt: number[] = []
    const rowAt: number[] = []
    for (let i = 0, at = x0; i < columns; at += colSize[i]! + hspace, i++) colAt.push(at)
    for (let i = 0, at = y0; i < rows; at += rowSize[i]! + vspace, i++) rowAt.push(at)
    for (let i = 0; i < kids.length; i++) {
      const column = i % columns
      const row = Math.floor(i / columns)
      const w = Math.min(colSize[column]!, mm[i]!.maxW)
      const h = Math.min(rowSize[row]!, mm[i]!.maxH)
      this.layout(kids[i]!, colAt[column]! + Math.floor((colSize[column]! - w) / 2),
        rowAt[row]! + Math.floor((rowSize[row]! - h) / 2), w, h)
    }
  }

  private distributeTracks(total: number, min: number[], max: number[], weight: number[]): number[] {
    const size = min.slice()
    const settled = min.map((_, i) => weight[i] === 0)
    for (let pass = 0; pass <= min.length; pass++) {
      const open = min.map((_, i) => i).filter((i) => !settled[i])
      if (open.length === 0) break
      const totalWeight = open.reduce((sum, i) => sum + weight[i]!, 0)
      const taken = size.reduce((sum, value, i) => sum + (settled[i] ? value : 0), 0)
      let used = 0
      let clamped = false
      for (const [n, i] of open.entries()) {
        const want = n === open.length - 1 ? total - taken - used : Math.floor(((total - taken) * weight[i]!) / totalWeight)
        used += want
        const fit = Math.max(min[i]!, Math.min(max[i]!, want))
        size[i] = fit
        if (fit !== want) { settled[i] = true; clamped = true }
      }
      if (!clamped) break
    }
    return size
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

  private setGroup(obj: BoopsiObject, cl: BoopsiClass, msg: OpSet): number {
    const active = msg.attrs.find((attr) => TAG(attr.tag) === MUI.MUIA_Group_ActivePage)
    const rest = active ? msg.attrs.filter((attr) => TAG(attr.tag) !== MUI.MUIA_Group_ActivePage) : msg.attrs
    let own = 0
    if (active) {
      const count = data(this, obj).children.length
      const old = this.peek(obj, MUI.MUIA_Group_ActivePage) ?? 0
      let page = active.data | 0
      if (page === (MUI.MUIV_Group_ActivePage_Last | 0)) page = count - 1
      else if (page === (MUI.MUIV_Group_ActivePage_Prev | 0)) page = old - 1
      else if (page === (MUI.MUIV_Group_ActivePage_Next | 0)) page = old + 1
      else if (page === (MUI.MUIV_Group_ActivePage_Advance | 0)) page = count === 0 ? 0 : (old + 1) % count
      page = count === 0 ? 0 : Math.max(0, Math.min(count - 1, page))
      const children = data(this, obj).children
      if (page !== old && obj.instData<MuiAreaData>(this.areaClass).shown) {
        if (children[old]) this.doMui(children[old]!, MUI.MUIM_Hide)
        if (children[page]) this.doMui(children[page]!, MUI.MUIM_Show)
      }
      this.setInternal(obj, MUI.MUIA_Group_ActivePage, page)
      own++
    }
    const ok = this.applyOwn('Group', obj, rest, 's')
    own += ok ? this.setCount : 0
    const answer = own + doSuperMethodA(cl, obj, { ...msg, attrs: rest } as OpSet)
    if (own !== 0 && obj.instData<MuiGroupData>(cl).changeDepth === 0) this.relayoutGroup(obj)
    return answer
  }

  private relayoutGroup(obj: BoopsiObject): void {
    if (this.boxOf(obj)) {
      for (const child of data(this, obj).children) this.askMinMax(child)
      this.layoutGroup(obj)
      this.redrawArea(obj, 1)
    }
  }

  /** Group exposes the same MinList shape as the native embedded child list. */
  private rebuildGroupList(obj: BoopsiObject): void {
    const group = obj.instData<MuiGroupData>(this.groupClass)
    if (!group?.listAddress) return
    if (group.nodesAddress !== 0) {
      this.pool.freeMem(group.nodesAddress)
      const owned = data(this, obj).ownedAddresses
      const i = owned.indexOf(group.nodesAddress)
      if (i >= 0) owned.splice(i, 1)
      group.nodesAddress = 0
    }
    const children = data(this, obj).children
    if (children.length !== 0) {
      group.nodesAddress = this.pool.alloc(children.length * 12, { clear: true })
      if (group.nodesAddress !== 0) data(this, obj).ownedAddresses.push(group.nodesAddress)
    }
    const off = group.listAddress - this.pool.base
    this.putPoolLong(off, group.nodesAddress)
    this.putPoolLong(off + 4, 0)
    this.putPoolLong(off + 8, children.length === 0 ? group.listAddress : group.nodesAddress + (children.length - 1) * 12)
    for (let i = 0; i < children.length && group.nodesAddress !== 0; i++) {
      const at = group.nodesAddress - this.pool.base + i * 12
      this.putPoolLong(at, i + 1 < children.length ? group.nodesAddress + (i + 1) * 12 : 0)
      this.putPoolLong(at + 4, i === 0 ? group.listAddress : group.nodesAddress + (i - 1) * 12)
      this.putPoolLong(at + 8, children[i]!.address)
    }
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
          d.ownedAddresses = []
          d.contextApplication = null
          d.contextConfigdata = null
        }
        if (cl === this.semaphoreClass) {
          const sem = made.instData<MuiSemaphoreData>(cl)
          sem.exclusive = 0
          sem.shared = 0
        }
        if (cl === this.applistClass) made.instData<MuiApplistData>(cl).members = []
        if (cl === this.cclistClass) made.instData<MuiCclistData>(cl).records = []
        if (cl === this.dataspaceClass) {
          const ds = made.instData<MuiDataspaceData>(cl)
          ds.entries = []
          ds.filterIds = false
          ds.configRecords = false
        }
        if (cl === this.configdataClass) {
          const cd = made.instData<MuiConfigdataData>(cl)
          cd.fallback = null
          cd.selector = 0
          made.instData<MuiDataspaceData>(this.dataspaceClass).configRecords = true
          this.applyConfigdataAttrs(made, (msg as OpSet).attrs)
        }
        if (cl === this.familyClass) {
          const family = made.instData<MuiFamilyData>(cl)
          family.listAddress = this.pool.alloc(12, { clear: true })
          family.nodesAddress = 0
          if (family.listAddress === 0) return 0
          data(this, made).ownedAddresses.push(family.listAddress)
          this.rebuildFamilyList(made)
        }
        if (cl === this.menustripClass) {
          made.instData<MuiMenustripData>(cl).handles = new Set()
          data(this, made).attrs.set(MUI.MUIA_Menustrip_Enabled, 1)
        }
        if (cl === this.menuClass) {
          data(this, made).attrs.set(MUI.MUIA_Menu_Title, this.literalAddress('Unnamed'))
          data(this, made).attrs.set(MUI.MUIA_Menu_Enabled, 1)
        }
        if (cl === this.menuitemClass) {
          made.instData<MuiMenuitemData>(cl).copyStrings = false
          const d = data(this, made).attrs
          d.set(MUI.MUIA_Menuitem_Title, this.literalAddress('Unnamed'))
          d.set(MUI.MUIA_Menuitem_Shortcut, 0)
          d.set(MUI.MUIA_Menuitem_Exclude, 0)
          d.set(MUI.MUIA_Menuitem_Toggle, 0)
          d.set(MUI.MUIA_Menuitem_Checked, 0)
          d.set(MUI.MUIA_Menuitem_Checkit, 0)
          d.set(MUI.MUIA_Menuitem_Enabled, 1)
          d.set(MUI.MUIA_Menuitem_CommandString, 0)
        }
        if (cl === this.windowClass) {
          const win = made.instData<MuiWindowData>(cl)
          win.handle = null
          win.nativeAddress = 0
          win.eventHandlers = []
          win.sleepDepth = 0
          const d = data(this, made).attrs
          d.set(MUI.MUIA_Window_Activate, 0)
          d.set(MUI.MUIA_Window_ActiveObject, 0)
          d.set(MUI.MUIA_Window_AltLeftEdge, MUI.MUIV_Window_AltLeftEdge_NoChange)
          d.set(MUI.MUIA_Window_AltTopEdge, MUI.MUIV_Window_AltTopEdge_NoChange)
          d.set(MUI.MUIA_Window_AltWidth, MUI.MUIV_Window_AltWidth_Scaled)
          d.set(MUI.MUIA_Window_AltHeight, MUI.MUIV_Window_AltHeight_Scaled)
          d.set(MUI.MUIA_Window_CloseRequest, 0)
          d.set(MUI.MUIA_Window_DefaultObject, 0)
          d.set(MUI.MUIA_Window_DragBar, 1)
          d.set(MUI.MUIA_Window_DepthGadget, 1)
          d.set(MUI.MUIA_Window_CloseGadget, 1)
          d.set(MUI.MUIA_Window_SizeGadget, 1)
          d.set(MUI.MUIA_Window_LeftEdge, MUI.MUIV_Window_LeftEdge_Centered)
          d.set(MUI.MUIA_Window_TopEdge, MUI.MUIV_Window_TopEdge_Centered)
          d.set(MUI.MUIA_Window_Width, MUI.MUIV_Window_Width_Default)
          d.set(MUI.MUIA_Window_Height, MUI.MUIV_Window_Height_Default)
          d.set(MUI.MUIA_Window_Open, 0)
          d.set(MUI.MUIA_Window_Sleep, 0)
          d.set(MUI.MUIA_Window_Title, 0)
          d.set(MUI.MUIA_Window_ScreenTitle, 0)
        }
        if (cl === this.areaClass) {
          const area = made.instData<MuiAreaData>(cl)
          area.setup = false
          area.shown = true
          area.disableDepth = 0
          area.dragging = false
          area.drawFlags = 0
          area.handles = new Set()
          const d = data(this, made).attrs
          d.set(MUI.MUIA_Weight, 100)
          d.set(MUI.MUIA_HorizWeight, 100)
          d.set(MUI.MUIA_VertWeight, 100)
          d.set(MUI.MUIA_Background, 0)
          d.set(MUI.MUIA_Frame, MUI.MUIV_Frame_None)
          d.set(MUI.MUIA_InputMode, MUI.MUIV_InputMode_None)
          d.set(MUI.MUIA_ShowMe, 1)
          d.set(MUI.MUIA_FillArea, 1)
          d.set(MUI.MUIA_ShowSelState, 1)
          d.set(MUI.MUIA_Disabled, 0)
          d.set(MUI.MUIA_Selected, 0)
          d.set(MUI.MUIA_Pressed, 0)
          d.set(MUI.MUIA_Draggable, 0)
          d.set(MUI.MUIA_Dropable, 0)
          d.set(MUI.MUIA_CycleChain, 0)
          d.set(MUI.MUIA_ControlChar, 0)
          d.set(MUI.MUIA_Timer, 0)
        }
        if (cl === this.imageClass) {
          made.instData<MuiImageData>(cl).setup = false
          const d = data(this, made).attrs
          d.set(MUI.MUIA_Image_Spec, 0)
          d.set(MUI.MUIA_Image_OldImage, 0)
          d.set(MUI.MUIA_Image_State, 0)
          d.set(MUI.MUIA_Image_FontMatch, 0)
          d.set(MUI.MUIA_Image_FontMatchWidth, 0)
          d.set(MUI.MUIA_Image_FontMatchHeight, 0)
          d.set(MUI.MUIA_Image_FreeHoriz, 0)
          d.set(MUI.MUIA_Image_FreeVert, 0)
        }
        if (cl === this.bitmapClass) {
          const bitmap = made.instData<MuiBitmapData>(cl)
          bitmap.setup = false
          bitmap.remappedBitmap = 0
          const d = data(this, made).attrs
          d.set(MUI.MUIA_Bitmap_Bitmap, 0)
          d.set(MUI.MUIA_Bitmap_Width, 0)
          d.set(MUI.MUIA_Bitmap_Height, 0)
          d.set(MUI.MUIA_Bitmap_MappingTable, 0)
          d.set(MUI.MUIA_Bitmap_SourceColors, 0)
          d.set(MUI.MUIA_Bitmap_Transparent, -1)
          d.set(MUI.MUIA_Bitmap_Precision, 0)
          d.set(MUI.MUIA_Bitmap_UseFriend, 0)
          d.set(MUI.MUIA_Bitmap_RemappedBitmap, 0)
        }
        if (cl === this.bodychunkClass) {
          made.instData<MuiBodychunkData>(cl).setup = false
          const d = data(this, made).attrs
          d.set(MUI.MUIA_Bodychunk_Body, 0)
          d.set(MUI.MUIA_Bodychunk_Depth, 0)
          d.set(MUI.MUIA_Bodychunk_Compression, 0)
          d.set(MUI.MUIA_Bodychunk_Masking, 0)
        }
        if (cl === this.textClass) {
          const d = data(this, made).attrs
          d.set(MUI.MUIA_Text_Contents, 0)
          d.set(MUI.MUIA_Text_PreParse, 0)
          d.set(MUI.MUIA_Text_HiChar, 0)
          d.set(MUI.MUIA_Text_SetMax, 0)
          d.set(MUI.MUIA_Text_SetMin, 1)
          d.set(MUI.MUIA_Text_SetVMax, 1)
        }
        if (cl === this.rectangleClass) {
          const d = data(this, made).attrs
          d.set(MUI.MUIA_Rectangle_BarTitle, 0)
          d.set(MUI.MUIA_Rectangle_HBar, 0)
          d.set(MUI.MUIA_Rectangle_VBar, 0)
        }
        if (cl === this.balanceClass) {
          const balance = made.instData<MuiBalanceData>(cl)
          balance.dragging = false
          balance.startX = 0
          balance.startY = 0
        }
        if (cl === this.gadgetClass) {
          const gadget = made.instData<MuiGadgetData>(cl)
          gadget.gadget = 0
          gadget.handle = null
          gadget.attached = false
          gadget.active = false
          const requested = (msg as OpSet).attrs.find((attr) => TAG(attr.tag) === MUI.MUIA_Gadget_Gadget)
          if (requested) gadget.gadget = requested.data
          data(this, made).attrs.set(MUI.MUIA_Gadget_Gadget, gadget.gadget)
        }
        if (cl === this.stringClass) {
          if (!this.initString(made, (msg as OpSet).attrs)) {
            this.boopsi.disposeObject(made)
            return 0
          }
        }
        if (cl === this.propClass) {
          if (!this.initProp(made, (msg as OpSet).attrs)) {
            this.boopsi.disposeObject(made)
            return 0
          }
        }
        if (cl === this.listClass) this.initList(made, (msg as OpSet).attrs)
        if (cl === this.groupClass) {
          const group = made.instData<MuiGroupData>(cl)
          group.listAddress = this.pool.alloc(12, { clear: true })
          group.nodesAddress = 0
          group.changeDepth = 0
          if (group.listAddress === 0) return 0
          data(this, made).ownedAddresses.push(group.listAddress)
          const stored = data(this, made).attrs
          stored.set(MUI.MUIA_Group_ActivePage, 0)
          stored.set(MUI.MUIA_Group_Columns, 1)
          stored.set(MUI.MUIA_Group_Rows, 0x7fff)
          stored.set(MUI.MUIA_Group_HorizSpacing, 1)
          stored.set(MUI.MUIA_Group_VertSpacing, 1)
          stored.set(MUI.MUIA_Group_SameHeight, 0)
          stored.set(MUI.MUIA_Group_SameWidth, 0)
          stored.set(MUI.MUIA_Group_PageMode, 0)
        }
        if (cl === this.numericClass) {
          const numeric = made.instData<MuiNumericData>(cl)
          numeric.bufferAddress = this.pool.alloc(33, { clear: true })
          if (numeric.bufferAddress === 0) return 0
          data(this, made).ownedAddresses.push(numeric.bufferAddress)
          numeric.min = 0
          numeric.max = 100
          numeric.value = 0
          numeric.defaultValue = 0
          numeric.format = this.literalAddress('%ld')
          numeric.checkAllSizes = false
          numeric.reverse = false
          numeric.revLeftRight = false
          numeric.revUpDown = false
          numeric.applyDefault = false
          const stored = data(this, made).attrs
          stored.set(MUI.MUIA_Numeric_Min, 0)
          stored.set(MUI.MUIA_Numeric_Max, 100)
          stored.set(MUI.MUIA_Numeric_Value, 0)
          stored.set(MUI.MUIA_Numeric_Default, 0)
          stored.set(MUI.MUIA_Numeric_Format, numeric.format)
          stored.set(MUI.MUIA_Numeric_CheckAllSizes, 0)
          stored.set(MUI.MUIA_Numeric_Reverse, 0)
          stored.set(MUI.MUIA_Numeric_RevLeftRight, 0)
          stored.set(MUI.MUIA_Numeric_RevUpDown, 0)
        }
        if (cl === this.sliderClass) {
          const slider = made.instData<MuiSliderData>(cl)
          slider.horizontal = false
          slider.quiet = false
          slider.setup = false
          slider.dragging = false
          slider.dragStart = 0
          slider.knobStart = 0
          const attrs = (msg as OpSet).attrs
          const stored = data(this, made).attrs
          if (!attrs.some((attr) => TAG(attr.tag) === MUI.MUIA_Frame)) stored.set(MUI.MUIA_Frame, MUI.MUIV_Frame_Slider)
          if (!attrs.some((attr) => TAG(attr.tag) === MUI.MUIA_Background)) stored.set(MUI.MUIA_Background, MUI.MUII_SliderBack)
          const horiz = attrs.find((attr) => TAG(attr.tag) === MUI.MUIA_Slider_Horiz || TAG(attr.tag) === MUI.MUIA_Group_Horiz)
          slider.horizontal = (horiz?.data ?? 0) !== 0
          slider.quiet = (attrs.find((attr) => TAG(attr.tag) === MUI.MUIA_Slider_Quiet)?.data ?? 0) !== 0
          stored.set(MUI.MUIA_Slider_Horiz, slider.horizontal ? 1 : 0)
          stored.set(MUI.MUIA_Slider_Quiet, slider.quiet ? 1 : 0)
        }
        if (cl === this.cycleClass && !this.initCycle(made, (msg as OpSet).attrs)) {
          this.boopsi.disposeObject(made)
          return 0
        }
        if (cl === this.scrollbarClass && !this.initScrollbar(made, (msg as OpSet).attrs)) {
          this.boopsi.disposeObject(made)
          return 0
        }
        if (cl === this.listviewClass && !this.initListview(made, (msg as OpSet).attrs)) {
          this.boopsi.disposeObject(made)
          return 0
        }
        if (cl === this.radioClass && !this.initRadio(made, (msg as OpSet).attrs)) {
          this.boopsi.disposeObject(made)
          return 0
        }
        if (cl === this.applicationClass) {
          const requested = (msg as OpSet).attrs
          if (requested.some((attr) => TAG(attr.tag) === MUI.MUIA_Application_SingleTask && attr.data !== 0)) {
            const title = requested.find((attr) => TAG(attr.tag) === MUI.MUIA_Application_Title)?.data ?? this.literalAddress('Unnamed')
            const running = [...this.applications].find((candidate) => this.sameText(this.peek(candidate, MUI.MUIA_Application_Title) ?? 0, title))
            if (running) {
              this.setInternal(running, MUI.MUIA_Application_DoubleStart, 1)
              this.boopsi.disposeObject(made)
              return 0
            }
          }
          const app = made.instData<MuiApplicationData>(cl)
          app.bufferedReturnIDs = []
          app.pushed = []
          app.inputHandlers = []
          app.inputDeadlines = new Map()
          app.sleepDepth = 0
          app.listAddress = this.pool.alloc(12, { clear: true })
          app.nodesAddress = 0
          app.configdata = this.newObjectA(MUIC.MUIC_Configdata)
          app.configDirty = false
          if (app.listAddress === 0 || !app.configdata) return 0
          data(this, made).ownedAddresses.push(app.listAddress)
          data(this, made).attrs.set(MUI.MUIA_Application_Active, 1)
          data(this, made).attrs.set(MUI.MUIA_Application_Iconified, 0)
          data(this, made).attrs.set(MUI.MUIA_Application_DoubleStart, 0)
          data(this, made).attrs.set(MUI.MUIA_Application_ForceQuit, 0)
          data(this, made).attrs.set(MUI.MUIA_Application_Title, this.literalAddress('Unnamed'))
          data(this, made).attrs.set(MUI.MUIA_Application_Version, this.literalAddress('$VER: Unnamed 0.0'))
          data(this, made).attrs.set(MUI.MUIA_Application_Copyright, this.literalAddress('?'))
          data(this, made).attrs.set(MUI.MUIA_Application_Author, this.literalAddress('?'))
          data(this, made).attrs.set(MUI.MUIA_Application_Description, this.literalAddress('?'))
          data(this, made).attrs.set(MUI.MUIA_Application_Base, this.literalAddress('UNNAMED'))
          data(this, made).attrs.set(MUI.MUIA_Application_UseCommodities, 1)
          data(this, made).attrs.set(MUI.MUIA_Application_UseRexx, 1)
        }
        const rawAttrs = (msg as OpSet).attrs
        const attrs = cl === this.menuitemClass ? this.normaliseMenuitemAttrs(rawAttrs) : rawAttrs
        if (!this.applyOwn(name, made, attrs, 'i')) return 0
        if (cl === this.numericClass) this.finishNumericNew(made, attrs)
        if (cl === this.cycleClass) {
          const cycle = made.instData<MuiCycleData>(cl)
          data(this, made).attrs.set(MUI.MUIA_Cycle_Entries, cycle.entriesAddress)
          data(this, made).attrs.set(MUI.MUIA_Cycle_Active, cycle.active)
        }
        if (cl === this.groupClass) {
          const stored = data(this, made).attrs
          const hasRows = attrs.some((attr) => TAG(attr.tag) === MUI.MUIA_Group_Rows)
          const hasColumns = attrs.some((attr) => TAG(attr.tag) === MUI.MUIA_Group_Columns)
          if (!hasRows && !hasColumns && (stored.get(MUI.MUIA_Group_Horiz) ?? 0) !== 0) {
            stored.set(MUI.MUIA_Group_Rows, 1)
            stored.set(MUI.MUIA_Group_Columns, 0x7fff)
          }
          const spacing = attrs.find((attr) => TAG(attr.tag) === MUI.MUIA_Group_Spacing)?.data
          if (spacing !== undefined) {
            if (!attrs.some((attr) => TAG(attr.tag) === MUI.MUIA_Group_HorizSpacing)) stored.set(MUI.MUIA_Group_HorizSpacing, spacing)
            if (!attrs.some((attr) => TAG(attr.tag) === MUI.MUIA_Group_VertSpacing)) stored.set(MUI.MUIA_Group_VertSpacing, spacing)
          }
          if ((stored.get(MUI.MUIA_Group_SameSize) ?? 0) !== 0) {
            stored.set(MUI.MUIA_Group_SameWidth, 1)
            stored.set(MUI.MUIA_Group_SameHeight, 1)
          }
        }
        if (cl === this.areaClass) {
          const weight = attrs.find((attr) => TAG(attr.tag) === MUI.MUIA_Weight)?.data
          const d = data(this, made).attrs
          if (weight !== undefined) {
            if (!attrs.some((attr) => TAG(attr.tag) === MUI.MUIA_HorizWeight)) d.set(MUI.MUIA_HorizWeight, Math.max(0, weight))
            if (!attrs.some((attr) => TAG(attr.tag) === MUI.MUIA_VertWeight)) d.set(MUI.MUIA_VertWeight, Math.max(0, weight))
          }
        }
        if (cl === this.textClass) this.copyTextContents(made, this.peek(made, MUI.MUIA_Text_Contents) ?? 0, 0)
        if (cl === this.menuitemClass) {
          const copy = attrs.some((attr) => TAG(attr.tag) === MUIA_MENUITEM_COPY_STRINGS && attr.data !== 0)
          made.instData<MuiMenuitemData>(cl).copyStrings = copy
          if (copy) this.copyMenuitemStrings(made)
        }
        if (cl === this.applicationClass) {
          const app = made.instData<MuiApplicationData>(cl)
          this.copyApplicationStrings(made)
          data(this, made).contextApplication = made
          data(this, made).contextConfigdata = app.configdata
          for (const child of data(this, made).children) this.setObjectContext(child, made, app.configdata)
          this.rebuildApplicationList(made)
          this.applications.add(made)
        }
        if (cl === this.windowClass) {
          this.copyWindowString(made, MUI.MUIA_Window_Title)
          this.copyWindowString(made, MUI.MUIA_Window_ScreenTitle)
        }
        if (cl === this.familyClass) this.rebuildFamilyList(made)
        if (cl === this.groupClass) this.rebuildGroupList(made)
        return made.address
      }

      case OM_DISPOSE: {
        const o = obj as BoopsiObject
        if (cl === this.gadgetClass) {
          const gadget = o.instData<MuiGadgetData>(cl)
          if (gadget.attached && gadget.handle !== null && gadget.gadget !== 0) {
            this.windowHost?.hideGadget?.(gadget.handle, gadget.gadget)
          }
          gadget.attached = false
          gadget.handle = null
          this.windowHost?.disposeGadget?.(gadget.gadget)
        }
        if (cl === this.areaClass) {
          const area = o.instData<MuiAreaData>(cl)
          for (const handle of area.handles) this.releaseAreaHandle(o, handle)
          area.handles.clear()
        }
        if (cl === this.listClass) this.clearList(o, true)
        if (cl === this.cclistClass) {
          for (const record of o.instData<MuiCclistData>(cl).records) this.pool.freeMem(record.address)
        }
        if (cl === this.windowClass) this.closeMuiWindow(o)
        if (cl === this.applicationClass) {
          const app = o.instData<MuiApplicationData>(cl)
          if (app.configdata) this.boopsi.disposeObject(app.configdata)
          app.configdata = null
          this.applications.delete(o)
        }
        if (cl === this.menustripClass) {
          for (const handle of o.instData<MuiMenustripData>(cl).handles) this.pool.freeMem(handle)
          o.instData<MuiMenustripData>(cl).handles.clear()
        }
        if (cl === this.dataspaceClass) this.dataspaceClear(o)
        if (cl === this.notifyClass) {
          // children first, and take a copy: each child's own OM_DISPOSE
          // unlinks it from this list on the way out
          for (const c of [...data(this, o).children]) this.boopsi.disposeObject(c)
          for (const address of data(this, o).ownedAddresses) this.pool.freeMem(address)
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
        if (cl === this.menuitemClass) return this.setMenuitem(obj as BoopsiObject, cl, msg as OpSet)
        if (cl === this.applicationClass) return this.setApplication(obj as BoopsiObject, cl, msg as OpSet)
        if (cl === this.windowClass) return this.setWindow(obj as BoopsiObject, cl, msg as OpSet)
        if (cl === this.stringClass) return this.setString(obj as BoopsiObject, cl, msg as OpSet)
        if (cl === this.propClass) return this.setProp(obj as BoopsiObject, cl, msg as OpSet)
        if (cl === this.listClass) return this.setList(obj as BoopsiObject, cl, msg as OpSet)
        if (cl === this.groupClass) return this.setGroup(obj as BoopsiObject, cl, msg as OpSet)
        if (cl === this.numericClass) return this.setNumeric(obj as BoopsiObject, cl, msg as OpSet)
        if (cl === this.sliderClass) return this.setSlider(obj as BoopsiObject, cl, msg as OpSet)
        if (cl === this.cycleClass) return this.setCycle(obj as BoopsiObject, cl, msg as OpSet)
        if (cl === this.listviewClass) return this.setListview(obj as BoopsiObject, cl, msg as OpSet)
        if (cl === this.radioClass) return this.setRadio(obj as BoopsiObject, cl, msg as OpSet)
        if (cl === this.gadgetClass) return this.setGadget(obj as BoopsiObject, cl, msg as OpSet)
        if (cl === this.imageClass) return this.setImage(obj as BoopsiObject, cl, msg as OpSet)
        if (cl === this.bitmapClass) return this.setBitmap(obj as BoopsiObject, cl, msg as OpSet)
        if (cl === this.bodychunkClass) return this.setBodychunk(obj as BoopsiObject, cl, msg as OpSet)
        if (cl === this.textClass) return this.setText(obj as BoopsiObject, cl, msg as OpSet)
        if (cl === this.areaClass) return this.setArea(obj as BoopsiObject, cl, msg as OpSet)
        if (cl === this.menuClass) {
          const attrs = (msg as OpSet).attrs
          let change = 0
          for (const attr of attrs) {
            if (TAG(attr.tag) === MUI.MUIA_Menuitem_Title) {
              this.setInternal(obj as BoopsiObject, MUI.MUIA_Menu_Title, attr.data)
              change = 2
            } else if (TAG(attr.tag) === MUI.MUIA_Menu_Title) change = 2
            else if (TAG(attr.tag) === MUI.MUIA_Menu_Enabled) change ||= 1
          }
          const own = this.applyOwn(name, obj as BoopsiObject, attrs, 's') ? this.setCount : 0
          const answer = own + doSuperMethodA(cl, obj, msg)
          if (change !== 0) this.menuUpdateParent(obj as BoopsiObject, change)
          return answer
        }
        if (cl === this.familyClass) {
          doSuperMethodA(cl, obj, msg)
          for (const child of [...data(this, obj as BoopsiObject).children]) child.cl.dispatcher(child.cl, child, msg)
          return 0
        }
        const attrs = (msg as OpSet).attrs
        const noNotify = attrs.some((attr) => TAG(attr.tag) === MUI.MUIA_NoNotify && attr.data !== 0)
        if (noNotify) this.suppressNotifications++
        try {
          const configCount = cl === this.configdataClass ? this.applyConfigdataAttrs(obj as BoopsiObject, attrs) : 0
          const ok = this.applyOwn(name, obj as BoopsiObject, attrs, 's')
          return configCount + (ok ? this.setCount : 0) + doSuperMethodA(cl, obj, msg)
        } finally {
          if (noNotify) this.suppressNotifications--
        }
      }

      case OM_GET: {
        const g = msg as OpGet
        const o = obj as BoopsiObject
        if (cl === this.familyClass && TAG(g.attrID) === MUI.MUIA_Family_List) {
          g.storage = o.instData<MuiFamilyData>(cl).listAddress
          return 1
        }
        if (cl === this.groupClass && TAG(g.attrID) === MUI.MUIA_Group_ChildList) {
          g.storage = o.instData<MuiGroupData>(cl).listAddress
          return 1
        }
        if (cl === this.menuitemClass && TAG(g.attrID) === MUI.MUIA_Menuitem_Trigger) {
          g.storage = 0
          return 1
        }
        if (cl === this.applicationClass) {
          const app = o.instData<MuiApplicationData>(cl)
          const computed = TAG(g.attrID) === MUI.MUIA_Application_WindowList
            ? app.listAddress
            : TAG(g.attrID) === MUI.MUIA_Application_Broker || TAG(g.attrID) === MUI.MUIA_Application_BrokerPort || TAG(g.attrID) === MUI.MUIA_Application_RexxMsg
              ? this.peek(o, g.attrID) ?? 0
              : undefined
          if (computed !== undefined) {
            g.storage = computed
            return 1
          }
        }
        if (cl === this.windowClass) {
          const computed = this.getWindow(o, TAG(g.attrID))
          if (computed !== undefined) {
            g.storage = computed
            return 1
          }
        }
        if (cl === this.gadgetClass) {
          const gadget = o.instData<MuiGadgetData>(cl)
          if (TAG(g.attrID) === MUI.MUIA_Gadget_Gadget) {
            g.storage = gadget.gadget
            return 1
          }
          if (TAG(g.attrID) === MUIA_GADGET_ACTIVE) {
            g.storage = gadget.active ? 1 : 0
            return 1
          }
          if (TAG(g.attrID) === MUIA_GADGET_WINDOW) {
            g.storage = gadget.handle === null ? 0 : this.get(o, MUI.MUIA_Window) ?? 0
            return 1
          }
        }
        if (cl === this.stringClass) {
          const answer = this.getString(o, g)
          if (answer) return answer
        }
        if (cl === this.propClass) {
          const answer = this.getProp(o, g)
          if (answer) return answer
        }
        if (cl === this.listClass) {
          const answer = this.getList(o, g)
          if (answer) return answer
        }
        if (cl === this.numericClass) {
          const answer = this.getNumeric(o, g)
          if (answer) return answer
        }
        if (cl === this.sliderClass && (TAG(g.attrID) === MUI.MUIA_Slider_Horiz || TAG(g.attrID) === MUI.MUIA_Group_Horiz)) {
          g.storage = o.instData<MuiSliderData>(cl).horizontal ? 1 : 0
          return 1
        }
        if (cl === this.cycleClass && TAG(g.attrID) === MUI.MUIA_Cycle_Active) {
          g.storage = o.instData<MuiCycleData>(cl).active
          return 1
        }
        if (cl === this.listviewClass) {
          const answer = this.getListview(o, g)
          if (answer) return answer
        }
        if (cl === this.radioClass && TAG(g.attrID) === MUI.MUIA_Radio_Active) {
          g.storage = o.instData<MuiRadioData>(cl).active
          return 1
        }
        if (cl === this.bitmapClass && TAG(g.attrID) === MUI.MUIA_Bitmap_RemappedBitmap) {
          g.storage = o.instData<MuiBitmapData>(cl).remappedBitmap
          return 1
        }
        if (cl === this.areaClass) {
          const computed = this.getArea(o, TAG(g.attrID))
          if (computed !== undefined) {
            g.storage = computed
            return 1
          }
        }
        if (cl === this.familyClass) {
          for (const child of data(this, o).children) {
            if (child.cl.dispatcher(child.cl, child, msg) !== 0) return 1
          }
          return doSuperMethodA(cl, obj, msg)
        }
        if (cl === this.configdataClass && TAG(g.attrID) === MUIA_CONFIGDATA_FALLBACK) {
          g.storage = o.instData<MuiConfigdataData>(cl).fallback?.address ?? 0
          return 1
        }
        if (name === 'Notify') {
          const computed = TAG(g.attrID) === MUI.MUIA_Version
            ? 19
            : TAG(g.attrID) === MUI.MUIA_Revision
              ? 35
              : TAG(g.attrID) === MUI.MUIA_AppMessage
                ? 0
                : TAG(g.attrID) === MUI.MUIA_Parent
                  ? this.parent(o)?.address ?? 0
                  : TAG(g.attrID) === MUI.MUIA_ApplicationObject
                    ? (data(this, o).contextApplication ?? this.ancestorOf(o, this.applicationClass))?.address ?? 0
                    : undefined
          if (computed !== undefined) {
            g.storage = computed
            return 1
          }
        }
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
        if (cl === this.applicationClass) {
          const answer = msg.MethodID === OM_ADDMEMBER ? this.applicationAdd(o, child) : this.applicationRemove(o, child)
          return answer
        }
        if (cl === this.menuClass) {
          doSuperMethodA(cl, obj, msg)
          this.menuUpdateParent(o, 3)
          return 0
        }
        if (cl === this.menuitemClass) {
          doSuperMethodA(cl, obj, msg)
          this.menuitemUpdateParent(o, 3)
          return 0
        }
        if (cl === this.menustripClass) {
          doSuperMethodA(cl, obj, msg)
          this.menustripUpdate(o)
          return 0
        }
        if (cl === this.familyClass) {
          return msg.MethodID === OM_ADDMEMBER
            ? this.familyAdd(o, child, 'tail')
            : this.familyRemove(o, child)
        }
        if (cl === this.applistClass) {
          const members = o.instData<MuiApplistData>(cl).members
          const i = members.indexOf(child)
          if (msg.MethodID === OM_ADDMEMBER && i < 0) members.push(child)
          else if (msg.MethodID === OM_REMMEMBER && i >= 0) members.splice(i, 1)
          // $2350f8 and $23511a both explicitly clear d0.
          return 0
        }
        if (cl === this.groupClass) {
          const d = data(this, o)
          const i = d.children.indexOf(child)
          if (msg.MethodID === OM_ADDMEMBER && i < 0) {
            d.children.push(child)
            data(this, child).parent = o
            data(this, child).contextApplication = d.contextApplication
            data(this, child).contextConfigdata = d.contextConfigdata
          } else if (msg.MethodID === OM_REMMEMBER && i >= 0) {
            d.children.splice(i, 1)
            data(this, child).parent = null
          }
          this.rebuildGroupList(o)
          if (o.instData<MuiGroupData>(cl).changeDepth === 0) this.relayoutGroup(o)
          return 1
        }
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
        if (cl === this.groupClass) return this.groupMethod(obj as BoopsiObject, msg)
        if (cl === this.menuitemClass) {
          const answered = this.menuitemMethod(obj as BoopsiObject, msg)
          if (answered !== null) return answered
        }
        if (cl === this.menuClass) {
          const answered = this.menuMethod(obj as BoopsiObject, msg)
          if (answered !== null) return answered
        }
        if (cl === this.menustripClass) {
          const answered = this.menustripMethod(obj as BoopsiObject, msg)
          if (answered !== null) return answered
        }
        if (cl === this.familyClass) {
          const answered = this.familyMethod(obj as BoopsiObject, msg)
          if (answered !== null) return answered
          for (const child of [...data(this, obj as BoopsiObject).children]) child.cl.dispatcher(child.cl, child, msg)
        }
        if (cl === this.configdataClass) {
          const answered = this.configdataMethod(obj as BoopsiObject, msg)
          if (answered !== null) return answered
        }
        if (cl === this.dataspaceClass) {
          const answered = this.dataspaceMethod(obj as BoopsiObject, msg)
          if (answered !== null) return answered
        }
        if (cl === this.applistClass) {
          const answered = this.applistMethod(obj as BoopsiObject, msg)
          if (answered !== null) return answered
        }
        if (cl === this.cclistClass) {
          const answered = this.cclistMethod(obj as BoopsiObject, msg)
          if (answered !== null) return answered
        }
        if (cl === this.semaphoreClass) {
          const answered = this.semaphoreMethod(obj as BoopsiObject, msg)
          if (answered !== null) return answered
        }
        if (cl === this.applicationClass) {
          const answered = this.applicationMethod(obj as BoopsiObject, msg)
          if (answered !== null) return answered
        }
        if (cl === this.windowClass) {
          const answered = this.windowMethod(obj as BoopsiObject, msg)
          if (answered !== null) return answered
        }
        if (cl === this.imageClass) {
          const answered = this.imageMethod(obj as BoopsiObject, msg)
          if (answered !== null) return answered
        }
        if (cl === this.bitmapClass) {
          const answered = this.bitmapMethod(obj as BoopsiObject, msg)
          if (answered !== null) return answered
        }
        if (cl === this.bodychunkClass) {
          const answered = this.bodychunkMethod(obj as BoopsiObject, msg)
          if (answered !== null) return answered
        }
        if (cl === this.textClass) {
          const answered = this.textMethod(obj as BoopsiObject, msg)
          if (answered !== null) return answered
        }
        if (cl === this.rectangleClass) {
          const answered = this.rectangleMethod(obj as BoopsiObject, msg)
          if (answered !== null) return answered
        }
        if (cl === this.balanceClass) {
          const answered = this.balanceMethod(obj as BoopsiObject, msg)
          if (answered !== null) return answered
        }
        if (cl === this.gadgetClass) {
          const answered = this.gadgetMethod(obj as BoopsiObject, msg)
          if (answered !== null) return answered
        }
        if (cl === this.stringClass) {
          const answered = this.stringMethod(obj as BoopsiObject, msg)
          if (answered !== null) return answered
        }
        if (cl === this.propClass) {
          const answered = this.propMethod(obj as BoopsiObject, msg)
          if (answered !== null) return answered
        }
        if (cl === this.listClass) {
          const answered = this.listMethod(obj as BoopsiObject, msg)
          if (answered !== null) return answered
        }
        if (cl === this.numericClass) {
          const answered = this.numericMethod(obj as BoopsiObject, msg)
          if (answered !== null) return answered
        }
        if (cl === this.sliderClass) {
          const answered = this.sliderMethod(obj as BoopsiObject, msg)
          if (answered !== null) return answered
        }
        if (cl === this.cycleClass) {
          const answered = this.cycleMethod(obj as BoopsiObject, msg)
          if (answered !== null) return answered
        }
        if (cl === this.scrollbarClass) {
          const answered = this.scrollbarMethod(obj as BoopsiObject, msg)
          if (answered !== null) return answered
        }
        if (cl === this.listviewClass) {
          const answered = this.listviewMethod(obj as BoopsiObject, msg)
          if (answered !== null) return answered
        }
        if (cl === this.radioClass) {
          const answered = this.radioMethod(obj as BoopsiObject, msg)
          if (answered !== null) return answered
        }
        if (cl === this.areaClass) {
          const answered = this.areaMethod(obj as BoopsiObject, msg)
          if (answered !== null) return answered
        }
        if (cl === this.notifyClass) return this.notifyMethod(cl, obj as BoopsiObject, msg)
        return doSuperMethodA(cl, obj, msg)
      }
    }
  }

  // -- Numeric ------------------------------------------------------------

  private finishNumericNew(obj: BoopsiObject, attrs: readonly TagItem[]): void {
    const d = obj.instData<MuiNumericData>(this.numericClass)
    const stored = data(this, obj).attrs
    d.min = this.signed(stored.get(MUI.MUIA_Numeric_Min) ?? 0)
    d.max = this.signed(stored.get(MUI.MUIA_Numeric_Max) ?? 100)
    d.defaultValue = this.signed(stored.get(MUI.MUIA_Numeric_Default) ?? 0)
    d.format = stored.get(MUI.MUIA_Numeric_Format) ?? this.literalAddress('%ld')
    d.checkAllSizes = (stored.get(MUI.MUIA_Numeric_CheckAllSizes) ?? 0) !== 0
    d.reverse = (stored.get(MUI.MUIA_Numeric_Reverse) ?? 0) !== 0
    d.revLeftRight = (stored.get(MUI.MUIA_Numeric_RevLeftRight) ?? 0) !== 0
    d.revUpDown = (stored.get(MUI.MUIA_Numeric_RevUpDown) ?? 0) !== 0
    d.applyDefault = attrs.some((attr) => TAG(attr.tag) === MUIA_NUMERIC_APPLY_DEFAULT && attr.data !== 0)
    const explicit = attrs.some((attr) => TAG(attr.tag) === MUI.MUIA_Numeric_Value)
    d.value = this.clipNumeric(d, explicit
      ? this.signed(stored.get(MUI.MUIA_Numeric_Value) ?? 0)
      : d.defaultValue)
    this.syncNumeric(obj)
  }

  private clipNumeric(d: MuiNumericData, value: number): number {
    // $2308a2 clips to Max and then Min, so Min wins for an inverted interval.
    let clipped = this.signed(value)
    if (clipped >= d.max) clipped = d.max
    if (d.min > clipped) clipped = d.min
    return clipped | 0
  }

  private syncNumeric(obj: BoopsiObject): void {
    const d = obj.instData<MuiNumericData>(this.numericClass)
    const stored = data(this, obj).attrs
    stored.set(MUI.MUIA_Numeric_Min, d.min)
    stored.set(MUI.MUIA_Numeric_Max, d.max)
    stored.set(MUI.MUIA_Numeric_Value, d.value)
    stored.set(MUI.MUIA_Numeric_Default, d.defaultValue)
    stored.set(MUI.MUIA_Numeric_Format, d.format)
    stored.set(MUI.MUIA_Numeric_CheckAllSizes, d.checkAllSizes ? 1 : 0)
    stored.set(MUI.MUIA_Numeric_Reverse, d.reverse ? 1 : 0)
    stored.set(MUI.MUIA_Numeric_RevLeftRight, d.revLeftRight ? 1 : 0)
    stored.set(MUI.MUIA_Numeric_RevUpDown, d.revUpDown ? 1 : 0)
  }

  private setNumeric(obj: BoopsiObject, cl: BoopsiClass, msg: OpSet): number {
    const d = obj.instData<MuiNumericData>(cl)
    let min = d.min
    let max = d.max
    let value = d.value
    let privateCount = 0
    const normalised = msg.attrs.map((raw) => {
      const id = TAG(raw.tag)
      if (id === MUIA_NUMERIC_APPLY_DEFAULT) {
        d.applyDefault = raw.data !== 0
        privateCount++
        return raw
      }
      if (id === MUI.MUIA_Numeric_Min) min = this.signed(raw.data)
      else if (id === MUI.MUIA_Numeric_Max) max = this.signed(raw.data)
      else if (id === MUI.MUIA_Numeric_Value) value = this.signed(raw.data)
      else if (id === MUI.MUIA_Numeric_Default) d.defaultValue = this.signed(raw.data)
      else if (id === MUI.MUIA_Numeric_Format) d.format = raw.data
      else if (id === MUI.MUIA_Numeric_CheckAllSizes) d.checkAllSizes = raw.data !== 0
      else if (id === MUI.MUIA_Numeric_Reverse) d.reverse = raw.data !== 0
      else if (id === MUI.MUIA_Numeric_RevLeftRight) d.revLeftRight = raw.data !== 0
      else if (id === MUI.MUIA_Numeric_RevUpDown) d.revUpDown = raw.data !== 0
      const numericLong = id === MUI.MUIA_Numeric_Min || id === MUI.MUIA_Numeric_Max ||
        id === MUI.MUIA_Numeric_Default || id === MUI.MUIA_Numeric_Value
      const numericBool = id === MUI.MUIA_Numeric_CheckAllSizes || id === MUI.MUIA_Numeric_Reverse ||
        id === MUI.MUIA_Numeric_RevLeftRight || id === MUI.MUIA_Numeric_RevUpDown
      return numericLong ? { tag: raw.tag, data: this.signed(raw.data) }
        : numericBool ? { tag: raw.tag, data: raw.data === 0 ? 0 : 1 } : raw
    })
    d.min = min
    d.max = max
    d.value = this.clipNumeric(d, value)
    const before = this.peek(obj, MUI.MUIA_Numeric_Value) ?? 0
    const noNotify = normalised.some((attr) => TAG(attr.tag) === MUI.MUIA_NoNotify && attr.data !== 0)
    if (noNotify) this.suppressNotifications++
    let answer = 0
    try {
      const own = this.applyOwn('Numeric', obj, normalised.map((attr) =>
        TAG(attr.tag) === MUI.MUIA_Numeric_Value ? { ...attr, data: d.value } : attr), 's')
      answer = (own ? this.setCount : 0) + privateCount + doSuperMethodA(cl, obj, { ...msg, attrs: normalised } as OpSet)
      if (before !== d.value) this.setInternal(obj, MUI.MUIA_Numeric_Value, d.value)
      this.syncNumeric(obj)
    } finally {
      if (noNotify) this.suppressNotifications--
    }
    if (before !== d.value) this.redrawArea(obj, 0x804)
    return answer
  }

  private getNumeric(obj: BoopsiObject, msg: OpGet): number {
    const d = obj.instData<MuiNumericData>(this.numericClass)
    const id = TAG(msg.attrID)
    const value = id === MUI.MUIA_Numeric_Min ? d.min
      : id === MUI.MUIA_Numeric_Max ? d.max
        : id === MUI.MUIA_Numeric_Value ? d.value
          : id === MUI.MUIA_Numeric_Default ? d.defaultValue
            : id === MUI.MUIA_Numeric_Format ? d.format
              : id === MUI.MUIA_Numeric_CheckAllSizes ? (d.checkAllSizes ? 1 : 0)
                : id === MUI.MUIA_Numeric_Reverse ? (d.reverse ? 1 : 0)
                  : id === MUI.MUIA_Numeric_RevLeftRight ? (d.revLeftRight ? 1 : 0)
                    : id === MUI.MUIA_Numeric_RevUpDown ? (d.revUpDown ? 1 : 0)
                      : id === MUIA_NUMERIC_APPLY_DEFAULT ? (d.applyDefault ? 1 : 0)
                        : undefined
    if (value === undefined) return 0
    msg.storage = value
    return 1
  }

  private numericMethod(obj: BoopsiObject, msg: Msg): number | null {
    const params = (msg as Msg & { params?: readonly number[] }).params ?? []
    const d = obj.instData<MuiNumericData>(this.numericClass)
    switch (msg.MethodID) {
      case MUI.MUIM_Setup: {
        const answer = doSuperMethodA(this.numericClass, obj, msg)
        return answer === 0 ? 0 : 1
      }
      case MUI.MUIM_Cleanup:
        return doSuperMethodA(this.numericClass, obj, msg)
      case MUI.MUIM_HandleInput:
        this.handleNumericInput(obj, this.signed(params[1] ?? -1))
        return doSuperMethodA(this.numericClass, obj, msg)
      case MUI.MUIM_Export:
        this.numericTransferValue(obj, params[0] ?? 0, true)
        return 0
      case MUI.MUIM_Import:
        this.numericTransferValue(obj, params[0] ?? 0, false)
        return 0
      case MUI.MUIM_Numeric_SetDefault:
        this.set(obj, MUI.MUIA_Numeric_Value, this.clipNumeric(d, d.defaultValue))
        return 0
      case MUI.MUIM_Numeric_Increase:
        this.set(obj, MUI.MUIA_Numeric_Value, this.clipNumeric(d, d.value + this.signed(params[0] ?? 0)))
        return 0
      case MUI.MUIM_Numeric_Decrease:
        this.set(obj, MUI.MUIA_Numeric_Value, this.clipNumeric(d, d.value - this.signed(params[0] ?? 0)))
        return 0
      case MUI.MUIM_Numeric_Stringify:
        return this.stringifyNumeric(obj, this.signed(params[0] ?? 0))
      case MUIM_NUMERIC_STRINGIFY_CURRENT:
        return this.doMui(obj, MUI.MUIM_Numeric_Stringify, [d.value])
      case MUIM_NUMERIC_MEASURE:
        this.measureNumeric(obj, params[0] ?? 0, params[1] ?? 0)
        return 0
      case MUI.MUIM_Numeric_ValueToScale:
        return this.numericValueToScale(d, this.signed(params[0] ?? 0), this.signed(params[1] ?? 0))
      case MUI.MUIM_Numeric_ScaleToValue:
        return this.numericScaleToValue(d, params)
      case MUIM_NUMERIC_APPLY_DEFAULT:
        if (d.applyDefault) this.set(obj, MUI.MUIA_Numeric_Value, d.defaultValue)
        return 0
      default: return null
    }
  }

  private stringifyNumeric(obj: BoopsiObject, value: number): number {
    const d = obj.instData<MuiNumericData>(this.numericClass)
    const text = rtFormat(this.textOfAddress(d.format), value).slice(0, 32)
    const bytes = this.pool.buffer.subarray(d.bufferAddress - this.pool.base, d.bufferAddress - this.pool.base + 33)
    bytes.fill(0)
    for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff
    return d.bufferAddress
  }

  private measureNumeric(obj: BoopsiObject, widthAddress: number, heightAddress: number): void {
    const d = obj.instData<MuiNumericData>(this.numericClass)
    const middle = Math.trunc((d.min + d.max) / 2)
    let width = 0
    const measure = (value: number): void => {
      if (value < d.min || value > d.max) return
      const at = this.doMui(obj, MUI.MUIM_Numeric_Stringify, [value])
      width = Math.max(width, visibleLength(this.textOfAddress(at)) * this.fontX)
    }
    if (d.checkAllSizes) {
      for (let value = d.min; value <= d.max; value++) measure(value)
    } else {
      for (const value of [d.min, d.max, d.min + 1, d.max - 1, middle, middle - 1, middle + 2]) measure(value)
    }
    this.writeLong?.(widthAddress, width)
    this.writeLong?.(heightAddress, this.fontY)
  }

  private numericValueToScale(d: MuiNumericData, scaleMin: number, scaleMax: number): number {
    const scaleSpan = scaleMax - scaleMin
    const valueSpan = d.max - d.min
    const numerator = BigInt(d.value - d.min) * BigInt(scaleSpan + 1) + BigInt(Math.trunc(scaleSpan / 2))
    const denominator = BigInt(valueSpan + 1)
    let scaled = denominator === 0n ? scaleMin : scaleMin + Number(numerator / denominator)
    scaled = Math.max(scaleMin, Math.min(scaleMax, scaled))
    if (d.reverse) scaled = scaleMax - scaled + scaleMin
    return scaled | 0
  }

  private numericScaleToValue(d: MuiNumericData, params: readonly number[]): number {
    const scaleMin = this.signed(params[0] ?? 0)
    const scaleMax = this.signed(params[1] ?? 0)
    const scale = this.signed(params[2] ?? 0)
    const scaleSpan = scaleMax - scaleMin
    const valueSpan = d.max - d.min
    const denominator = BigInt(scaleSpan + 1)
    const map = (position: number): number => denominator === 0n ? d.min
      : d.min + Number(BigInt(position - scaleMin) * BigInt(valueSpan + 1) / denominator)
    let value = this.clipNumeric(d, map(scale))
    const currentScale = scaleMin + (valueSpan === -1 ? 0
      : Number(BigInt(d.value - d.min) * BigInt(scaleSpan + 1) / BigInt(valueSpan + 1)))
    if (Array.isArray(params)) (params as number[])[2] = currentScale | 0
    if (d.reverse) value = d.max - value + d.min
    return value | 0
  }

  private handleNumericInput(obj: BoopsiObject, key: number): void {
    const d = obj.instData<MuiNumericData>(this.numericClass)
    if (d.revUpDown && key >= 2 && key <= 7) key ^= 1
    if (d.revLeftRight && key >= 8 && key <= 13) key ^= 1
    const span = d.max - d.min
    const page = span <= 10 ? 1 : span > 10_000 ? 1000 : span > 1000 ? 100 : 10
    if (key === 1) this.doMui(obj, MUI.MUIM_Numeric_SetDefault)
    else if (key === 2 || key === 9) this.doMui(obj, MUI.MUIM_Numeric_Increase, [d.reverse ? -1 : 1])
    else if (key === 3 || key === 8) this.doMui(obj, MUI.MUIM_Numeric_Decrease, [d.reverse ? -1 : 1])
    else if (key === 4 || key === 11) this.doMui(obj, MUI.MUIM_Numeric_Increase, [page])
    else if (key === 5 || key === 10) this.doMui(obj, MUI.MUIM_Numeric_Decrease, [page])
    else if (key === 6 || key === 12) this.set(obj, MUI.MUIA_Numeric_Value, d.reverse ? d.max : d.min)
    else if (key === 7 || key === 13) this.set(obj, MUI.MUIA_Numeric_Value, d.reverse ? d.min : d.max)
  }

  private numericTransferValue(obj: BoopsiObject, dataspaceAddress: number, exporting: boolean): void {
    const dataspace = this.boopsi.objectAt(dataspaceAddress)
    if (!dataspace?.cl.isA(this.dataspaceClass)) return
    const id = this.peek(obj, MUI.MUIA_ExportID) ?? 0
    if (id === 0) return
    const ds = dataspace.instData<MuiDataspaceData>(this.dataspaceClass)
    if (exporting) {
      const bytes = new Uint8Array(4)
      putLong(bytes, 0, obj.instData<MuiNumericData>(this.numericClass).value)
      this.dataspaceAddBytes(ds, bytes, id)
    } else {
      const entry = ds.entries.find((candidate) => candidate.id === TAG(id) && candidate.length >= 4)
      if (entry) this.set(obj, MUI.MUIA_Numeric_Value, this.poolLong(entry.address - this.pool.base + 16))
    }
  }

  // -- Slider -------------------------------------------------------------

  private setSlider(obj: BoopsiObject, cl: BoopsiClass, msg: OpSet): number {
    const d = obj.instData<MuiSliderData>(cl)
    const before = d.horizontal
    const attrs = msg.attrs.map((raw) => {
      const id = TAG(raw.tag)
      if (id === MUI.MUIA_Slider_Horiz || id === MUI.MUIA_Group_Horiz) {
        d.horizontal = raw.data !== 0
        return { tag: id === MUI.MUIA_Group_Horiz ? MUI.MUIA_Slider_Horiz : raw.tag, data: d.horizontal ? 1 : 0 }
      }
      return raw
    })
    const own = this.applyOwn('Slider', obj, attrs, 's')
    const answer = (own ? this.setCount : 0) + doSuperMethodA(cl, obj, { ...msg, attrs } as OpSet)
    data(this, obj).attrs.set(MUI.MUIA_Slider_Horiz, d.horizontal ? 1 : 0)
    if (before !== d.horizontal) {
      delete data(this, obj).minmax
      this.redrawArea(obj, 0x804)
    }
    return answer
  }

  private sliderMethod(obj: BoopsiObject, msg: Msg): number | null {
    const params = (msg as Msg & { params?: readonly number[] }).params ?? []
    const slider = obj.instData<MuiSliderData>(this.sliderClass)
    switch (msg.MethodID) {
      case MUI.MUIM_Setup: {
        const answer = doSuperMethodA(this.sliderClass, obj, msg)
        slider.setup = answer !== 0
        if (slider.setup) this.redrawArea(obj, 0x408)
        return answer === 0 ? 0 : 1
      }
      case MUI.MUIM_Cleanup:
        slider.setup = false
        slider.dragging = false
        return doSuperMethodA(this.sliderClass, obj, msg)
      case MUI.MUIM_Show:
        return doSuperMethodA(this.sliderClass, obj, msg)
      case MUI.MUIM_Draw:
        doSuperMethodA(this.sliderClass, obj, msg)
        this.drawSlider(obj)
        return 0
      case MUI.MUIM_HandleInput:
        this.handleSliderInput(obj, params)
        return doSuperMethodA(this.sliderClass, obj, msg)
      default: return null
    }
  }

  private sliderLabelSize(obj: BoopsiObject): { width: number; height: number } {
    const numeric = obj.instData<MuiNumericData>(this.numericClass)
    const middle = Math.trunc((numeric.min + numeric.max) / 2)
    let width = 0
    for (const value of [numeric.min, numeric.max, numeric.min + 1, numeric.max - 1, middle, middle - 1, middle + 2]) {
      if (value < numeric.min || value > numeric.max) continue
      const label = this.textOfAddress(this.doMui(obj, MUI.MUIM_Numeric_Stringify, [value]))
      width = Math.max(width, visibleLength(label) * this.fontX)
    }
    return { width, height: this.fontY }
  }

  private sliderGeometry(obj: BoopsiObject): { content: Box; knob: Box } | null {
    const box = this.boxOf(obj)
    if (!box) return null
    const inner = this.innerOf(obj)
    const content = {
      left: box.left + inner.left,
      top: box.top + inner.top,
      width: Math.max(1, box.width - inner.left - inner.right),
      height: Math.max(1, box.height - inner.top - inner.bottom),
    }
    const slider = obj.instData<MuiSliderData>(this.sliderClass)
    const label = this.sliderLabelSize(obj)
    const knobWidth = slider.horizontal ? Math.min(content.width, Math.max(5, label.width + 4)) : content.width
    const knobHeight = slider.horizontal ? content.height : Math.min(content.height, Math.max(5, label.height + 2))
    const scaleMax = slider.horizontal ? content.left + content.width - knobWidth : content.top + content.height - knobHeight
    const numeric = obj.instData<MuiNumericData>(this.numericClass)
    const position = this.numericValueToScale(numeric, slider.horizontal ? content.left : content.top, scaleMax)
    return {
      content,
      knob: slider.horizontal
        ? { left: position, top: content.top, width: knobWidth, height: knobHeight }
        : { left: content.left, top: position, width: knobWidth, height: knobHeight },
    }
  }

  private drawSlider(obj: BoopsiObject): void {
    const slider = obj.instData<MuiSliderData>(this.sliderClass)
    const geometry = this.sliderGeometry(obj)
    if (!slider.setup || !geometry) return
    const window = this.ancestorOf(obj, this.windowClass)
    if (!window) return
    const handle = window.instData<MuiWindowData>(this.windowClass).handle
    if (handle === null) return
    const numeric = obj.instData<MuiNumericData>(this.numericClass)
    this.windowHost?.drawSlider?.(handle, {
      ...geometry.content,
      horizontal: slider.horizontal,
      knob: geometry.knob,
      label: this.textOfAddress(this.doMui(obj, MUI.MUIM_Numeric_Stringify, [numeric.value])),
      quiet: slider.quiet,
      disabled: (this.peek(obj, MUI.MUIA_Disabled) ?? 0) !== 0,
    })
  }

  private handleSliderInput(obj: BoopsiObject, params: readonly number[]): void {
    const slider = obj.instData<MuiSliderData>(this.sliderClass)
    const geometry = this.sliderGeometry(obj)
    if (!geometry || (this.peek(obj, MUI.MUIA_Disabled) ?? 0) !== 0) return
    const cls = params[0] ?? 0
    const code = params[1] ?? 0
    const x = this.signed(params[3] ?? 0)
    const y = this.signed(params[4] ?? 0)
    const coordinate = slider.horizontal ? x : y
    const knobStart = slider.horizontal ? geometry.knob.left : geometry.knob.top
    const knobSize = slider.horizontal ? geometry.knob.width : geometry.knob.height
    if (cls === IDCMP_MOUSEBUTTONS && code === 0x68) {
      const reverse = obj.instData<MuiNumericData>(this.numericClass).reverse
      if (coordinate < knobStart) this.doMui(obj,
        reverse ? MUI.MUIM_Numeric_Increase : MUI.MUIM_Numeric_Decrease, [1])
      else if (coordinate >= knobStart + knobSize) this.doMui(obj,
        reverse ? MUI.MUIM_Numeric_Decrease : MUI.MUIM_Numeric_Increase, [1])
      else {
        slider.dragging = true
        slider.dragStart = coordinate
        slider.knobStart = knobStart
      }
      this.redrawArea(obj, 2)
    } else if (cls === IDCMP_MOUSEMOVE && slider.dragging) {
      const start = slider.horizontal ? geometry.content.left : geometry.content.top
      const end = slider.horizontal
        ? geometry.content.left + geometry.content.width - knobSize
        : geometry.content.top + geometry.content.height - knobSize
      const position = Math.max(start, Math.min(end, slider.knobStart + coordinate - slider.dragStart))
      const mutable = [start, end, position]
      const value = this.numericScaleToValue(obj.instData<MuiNumericData>(this.numericClass), mutable)
      this.set(obj, MUI.MUIA_Numeric_Value, value)
      this.redrawArea(obj, 2)
    } else if ((cls === IDCMP_MOUSEBUTTONS && code === 0xe8) || cls === 0x80000) {
      slider.dragging = false
      this.redrawArea(obj, 2)
    }
  }

  // -- Cycle --------------------------------------------------------------

  private pointerList(address: number): number[] {
    const entries: number[] = []
    if (address === 0) return entries
    for (let i = 0; i < 0x10000; i++) {
      const at = address + i * 4
      const value = at >= this.pool.base && at + 4 <= this.pool.base + this.pool.buffer.length
        ? this.poolLong(at - this.pool.base)
        : this.readLong?.(at) ?? 0
      if (value === 0) break
      entries.push(value)
    }
    return entries
  }

  private initCycle(obj: BoopsiObject, attrs: readonly TagItem[]): boolean {
    const entriesAddress = attrs.find((attr) => TAG(attr.tag) === MUI.MUIA_Cycle_Entries)?.data ?? 0
    const entries = this.pointerList(entriesAddress)
    if (entries.length === 0) return false
    const requested = this.signed(attrs.find((attr) => TAG(attr.tag) === MUI.MUIA_Cycle_Active)?.data ?? 0)
    const active = Math.max(0, Math.min(entries.length - 1, requested))
    const label = this.newObjectA(MUIC.MUIC_Text, [
      { tag: MUI.MUIA_Text_Contents, data: entries[active]! },
      { tag: MUI.MUIA_Text_PreParse, data: this.literalAddress('\x1bc') },
      { tag: MUI.MUIA_Background, data: MUI.MUII_ButtonBack },
      { tag: MUI.MUIA_Text_SetMax, data: 1 },
    ])
    const image = this.newObjectA(MUIC.MUIC_Image, [
      { tag: MUI.MUIA_Image_Spec, data: MUI.MUII_Cycle },
      { tag: MUI.MUIA_Image_FreeHoriz, data: 0 },
      { tag: MUI.MUIA_Image_FreeVert, data: 1 },
      { tag: MUI.MUIA_Background, data: MUI.MUII_ButtonBack },
    ])
    if (!label || !image) {
      if (label) this.disposeObject(label)
      if (image) this.disposeObject(image)
      return false
    }
    const d = obj.instData<MuiCycleData>(this.cycleClass)
    d.entriesAddress = entriesAddress
    d.entries = entries
    d.active = active
    d.label = label
    d.image = image
    d.pressed = false
    const common = data(this, obj)
    common.attrs.set(MUI.MUIA_Cycle_Entries, entriesAddress)
    common.attrs.set(MUI.MUIA_Cycle_Active, active)
    common.attrs.set(MUI.MUIA_Group_Horiz, 1)
    common.attrs.set(MUI.MUIA_Group_Spacing, 0)
    common.attrs.set(MUI.MUIA_Frame, MUI.MUIV_Frame_Button)
    common.attrs.set(MUI.MUIA_Background, MUI.MUII_ButtonBack)
    common.children.push(label, image)
    data(this, label).parent = obj
    data(this, image).parent = obj
    this.setObjectContext(label, common.contextApplication, common.contextConfigdata)
    this.setObjectContext(image, common.contextApplication, common.contextConfigdata)
    this.rebuildGroupList(obj)
    return true
  }

  private normaliseCycleActive(d: MuiCycleData, requested: number): number {
    if (requested === -1) return d.active + 1 < d.entries.length ? d.active + 1 : 0
    if (requested === -2) return d.active > 0 ? d.active - 1 : d.entries.length - 1
    return Math.max(0, Math.min(d.entries.length - 1, requested))
  }

  private setCycle(obj: BoopsiObject, cl: BoopsiClass, msg: OpSet): number {
    const d = obj.instData<MuiCycleData>(cl)
    let extra = 0
    let requestedActive: number | null = null
    for (const attr of msg.attrs) {
      const id = TAG(attr.tag)
      if (id === MUI.MUIA_Cycle_Entries && attr.data !== 0) {
        const entries = this.pointerList(attr.data)
        if (entries.length !== 0) {
          d.entriesAddress = attr.data
          d.entries = entries
          d.active = Math.max(0, Math.min(entries.length - 1, d.active))
          data(this, obj).attrs.set(MUI.MUIA_Cycle_Entries, attr.data)
          this.set(d.label, MUI.MUIA_Text_Contents, entries[d.active]!)
          extra++
        }
      } else if (id === MUI.MUIA_Cycle_Active) requestedActive = this.signed(attr.data)
    }
    const attrs = msg.attrs.map((attr) => TAG(attr.tag) === MUI.MUIA_Cycle_Active
      ? { ...attr, data: this.normaliseCycleActive(d, this.signed(attr.data)) } : attr)
    const own = this.applyOwn('Cycle', obj, attrs, 's')
    const answer = extra + (own ? this.setCount : 0) + doSuperMethodA(cl, obj, { ...msg, attrs } as OpSet)
    if (requestedActive !== null) {
      const active = this.normaliseCycleActive(d, requestedActive)
      if (active !== d.active) {
        d.active = active
        this.setInternal(obj, MUI.MUIA_Cycle_Active, active)
        this.set(d.label, MUI.MUIA_Text_Contents, d.entries[active]!)
      }
    }
    return answer
  }

  private cycleMethod(obj: BoopsiObject, msg: Msg): number | null {
    const params = (msg as Msg & { params?: readonly number[] }).params ?? []
    switch (msg.MethodID) {
      case MUI.MUIM_Setup: {
        const answer = doSuperMethodA(this.cycleClass, obj, msg)
        if (answer !== 0) this.redrawArea(obj, 0x408)
        return answer === 0 ? 0 : 1
      }
      case MUI.MUIM_HandleInput:
        this.handleCycleInput(obj, params)
        return 0
      case MUI.MUIM_Export:
        this.cycleTransferActive(obj, params[0] ?? 0, true)
        return 0
      case MUI.MUIM_Import:
        this.cycleTransferActive(obj, params[0] ?? 0, false)
        return 0
      default: return null
    }
  }

  private handleCycleInput(obj: BoopsiObject, params: readonly number[]): void {
    const d = obj.instData<MuiCycleData>(this.cycleClass)
    const key = this.signed(params[1] ?? -1)
    if (key === 2) this.set(obj, MUI.MUIA_Cycle_Active, -2)
    else if (key === 3) this.set(obj, MUI.MUIA_Cycle_Active, -1)
    else if (key === 4 || key === 6) this.set(obj, MUI.MUIA_Cycle_Active, 0)
    else if (key === 5 || key === 7) this.set(obj, MUI.MUIA_Cycle_Active, d.entries.length - 1)
    const cls = params[0] ?? 0
    const code = params[1] ?? 0
    const qualifier = params[2] ?? 0
    const x = this.signed(params[3] ?? 0)
    const y = this.signed(params[4] ?? 0)
    const box = this.boxOf(obj)
    const inside = !!box && x >= box.left && y >= box.top && x < box.left + box.width && y < box.top + box.height
    if (cls === IDCMP_MOUSEBUTTONS && code === 0x68 && inside) {
      d.pressed = true
      this.setInternal(obj, MUI.MUIA_Selected, 1)
      this.redrawArea(obj, 0x10)
    } else if (cls === IDCMP_MOUSEMOVE && d.pressed) {
      this.setInternal(obj, MUI.MUIA_Selected, inside ? 1 : 0)
    } else if (cls === IDCMP_MOUSEBUTTONS && code === 0xe8 && d.pressed) {
      if (inside) this.set(obj, MUI.MUIA_Cycle_Active, (qualifier & 3) !== 0 ? -2 : -1)
      d.pressed = false
      this.setInternal(obj, MUI.MUIA_Selected, 0)
      this.redrawArea(obj, 0x10)
    }
  }

  private cycleTransferActive(obj: BoopsiObject, dataspaceAddress: number, exporting: boolean): void {
    const dataspace = this.boopsi.objectAt(dataspaceAddress)
    if (!dataspace?.cl.isA(this.dataspaceClass)) return
    const id = this.peek(obj, MUI.MUIA_ExportID) ?? 0
    if (id === 0) return
    const ds = dataspace.instData<MuiDataspaceData>(this.dataspaceClass)
    if (exporting) {
      const bytes = new Uint8Array(4)
      putLong(bytes, 0, obj.instData<MuiCycleData>(this.cycleClass).active)
      this.dataspaceAddBytes(ds, bytes, id)
    } else {
      const entry = ds.entries.find((candidate) => candidate.id === TAG(id) && candidate.length >= 4)
      if (entry) this.set(obj, MUI.MUIA_Cycle_Active, this.poolLong(entry.address - this.pool.base + 16))
    }
  }

  // -- Scrollbar ----------------------------------------------------------

  private initScrollbar(obj: BoopsiObject, attrs: readonly TagItem[]): boolean {
    const horizontal = (attrs.find((attr) => TAG(attr.tag) === MUI.MUIA_Group_Horiz)?.data ?? 0) !== 0
    const type = this.signed(attrs.find((attr) => TAG(attr.tag) === MUI.MUIA_Scrollbar_Type)?.data ??
      MUI.MUIV_Scrollbar_Type_Default)
    const useWinBorder = attrs.find((attr) => TAG(attr.tag) === MUI.MUIA_Prop_UseWinBorder)?.data ??
      MUI.MUIV_Prop_UseWinBorder_None
    const prop = this.newObjectA(MUIC.MUIC_Prop, [
      ...attrs,
      { tag: MUI.MUIA_Prop_Horiz, data: horizontal ? 1 : 0 },
      { tag: MUI.MUIA_Prop_UseWinBorder, data: useWinBorder },
      { tag: MUI.MUIA_Frame, data: MUI.MUIV_Frame_Prop },
    ])
    const image = (spec: number): BoopsiObject | null => this.newObjectA(MUIC.MUIC_Image, [
      { tag: MUI.MUIA_Image_Spec, data: spec },
      { tag: MUI.MUIA_Image_FontMatch, data: 1 },
      { tag: MUI.MUIA_Frame, data: MUI.MUIV_Frame_ImageButton },
      { tag: MUI.MUIA_InputMode, data: MUI.MUIV_InputMode_RelVerify },
      { tag: MUI.MUIA_Background, data: MUI.MUII_ButtonBack },
    ])
    const decrement = image(horizontal ? MUI.MUII_ArrowLeft : MUI.MUII_ArrowUp)
    const increment = image(horizontal ? MUI.MUII_ArrowRight : MUI.MUII_ArrowDown)
    if (!prop || !decrement || !increment) {
      if (prop) this.disposeObject(prop)
      if (decrement) this.disposeObject(decrement)
      if (increment) this.disposeObject(increment)
      return false
    }
    const d = obj.instData<MuiScrollbarData>(this.scrollbarClass)
    d.prop = prop
    d.decrement = decrement
    d.increment = increment
    d.horizontal = horizontal
    d.type = type
    const common = data(this, obj)
    common.attrs.set(MUI.MUIA_Group_Horiz, horizontal ? 1 : 0)
    common.attrs.set(MUI.MUIA_Group_Spacing, 0)
    common.attrs.set(MUI.MUIA_Scrollbar_Type, type)
    const effective = type === MUI.MUIV_Scrollbar_Type_Default ? MUI.MUIV_Scrollbar_Type_Sym : type
    const children = useWinBorder !== MUI.MUIV_Prop_UseWinBorder_None ? [prop]
      : effective === MUI.MUIV_Scrollbar_Type_Top ? [decrement, increment, prop]
        : effective === MUI.MUIV_Scrollbar_Type_Sym ? [decrement, prop, increment]
          : [prop, decrement, increment]
    common.children.push(...children)
    for (const child of children) {
      data(this, child).parent = obj
      this.setObjectContext(child, common.contextApplication, common.contextConfigdata)
    }
    // 19.35 wires each image's repeating Timer to Prop_Increase. Pressed is
    // the one-shot equivalent supplied by this port's Intuition input path.
    this.doMui(decrement, MUI.MUIM_Notify,
      [MUI.MUIA_Pressed, 1, prop.address, 2, MUI.MUIM_Prop_Increase, -1])
    this.doMui(increment, MUI.MUIM_Notify,
      [MUI.MUIA_Pressed, 1, prop.address, 2, MUI.MUIM_Prop_Increase, 1])
    this.rebuildGroupList(obj)
    return true
  }

  private scrollbarMethod(obj: BoopsiObject, msg: Msg): number | null {
    const params = (msg as Msg & { params?: readonly number[] }).params ?? []
    const d = obj.instData<MuiScrollbarData>(this.scrollbarClass)
    switch (msg.MethodID) {
      case MUI.MUIM_Setup: {
        const answer = doSuperMethodA(this.scrollbarClass, obj, msg)
        if (answer !== 0) this.redrawArea(obj, 0x400)
        return answer === 0 ? 0 : 1
      }
      case MUI.MUIM_Cleanup:
        return doSuperMethodA(this.scrollbarClass, obj, msg)
      case MUI.MUIM_HandleInput:
        this.handleScrollbarKey(d, this.signed(params[1] ?? -1))
        return doSuperMethodA(this.scrollbarClass, obj, msg)
      default: return null
    }
  }

  private handleScrollbarKey(d: MuiScrollbarData, key: number): void {
    const firstKey = d.horizontal ? 8 : 2
    const offset = key - firstKey
    if (offset < 0 || offset >= 6) return
    const visible = Math.max(1, this.get(d.prop, MUI.MUIA_Prop_Visible) ?? 1)
    if (offset === 0) this.doMui(d.prop, MUI.MUIM_Prop_Increase, [-1])
    else if (offset === 1) this.doMui(d.prop, MUI.MUIM_Prop_Increase, [1])
    else if (offset === 2) this.set(d.prop, MUI.MUIA_Prop_First, 0)
    else if (offset === 3) this.set(d.prop, MUI.MUIA_Prop_First, 99_999)
    else if (offset === 4) this.doMui(d.prop, MUI.MUIM_Prop_Increase, [1 - visible])
    else this.doMui(d.prop, MUI.MUIM_Prop_Increase, [visible - 1])
  }

  // -- Listview -----------------------------------------------------------

  private initListview(obj: BoopsiObject, attrs: readonly TagItem[]): boolean {
    const value = (id: number, fallback: number): number => attrs.find((a) => TAG(a.tag) === id)?.data ?? fallback
    const list = this.boopsi.objectAt(value(MUI.MUIA_Listview_List, 0))
    if (!list?.cl.isA(this.listClass)) return false
    const pos = this.signed(value(MUI.MUIA_Listview_ScrollerPos, MUI.MUIV_Listview_ScrollerPos_Default))
    const scrollbar = pos === MUI.MUIV_Listview_ScrollerPos_None ? null : this.newObjectA(MUIC.MUIC_Scrollbar, [
      { tag: MUI.MUIA_Prop_Entries, data: this.get(list, MUI.MUIA_List_Entries) ?? 0 },
      { tag: MUI.MUIA_Prop_First, data: Math.max(0, this.get(list, MUI.MUIA_List_First) ?? 0) },
      { tag: MUI.MUIA_Prop_Visible, data: Math.max(0, this.get(list, MUI.MUIA_List_Visible) ?? 0) },
    ])
    if (pos !== MUI.MUIV_Listview_ScrollerPos_None && !scrollbar) return false
    const d = obj.instData<MuiListviewData>(this.listviewClass)
    d.list = list
    d.scrollbar = scrollbar
    d.input = value(MUI.MUIA_Listview_Input, 1) !== 0
    d.dragType = this.signed(value(MUI.MUIA_Listview_DragType, MUI.MUIV_Listview_DragType_None))
    d.multiSelect = this.signed(value(MUI.MUIA_Listview_MultiSelect, MUI.MUIV_Listview_MultiSelect_Default))
    d.clickColumn = -1
    d.defaultClickColumn = this.signed(value(MUI.MUIA_Listview_DefClickColumn, 0))
    const stored = data(this, obj).attrs
    for (const [id, val] of [
      [MUI.MUIA_Group_Horiz, 1], [MUI.MUIA_Group_Spacing, 0], [MUI.MUIA_Listview_List, list.address],
      [MUI.MUIA_Listview_Input, d.input ? 1 : 0], [MUI.MUIA_Listview_DragType, d.dragType],
      [MUI.MUIA_Listview_MultiSelect, d.multiSelect], [MUI.MUIA_Listview_ScrollerPos, pos],
      [MUI.MUIA_Listview_ClickColumn, -1], [MUI.MUIA_Listview_DefClickColumn, d.defaultClickColumn],
      [MUI.MUIA_Listview_DoubleClick, 0], [MUI.MUIA_Listview_SelectChange, 0],
    ] as const) stored.set(id, val)
    const children = scrollbar && pos === MUI.MUIV_Listview_ScrollerPos_Left ? [scrollbar, list]
      : scrollbar ? [list, scrollbar] : [list]
    data(this, obj).children.push(...children)
    for (const child of children) {
      data(this, child).parent = obj
      this.setObjectContext(child, data(this, obj).contextApplication, data(this, obj).contextConfigdata)
    }
    this.rebuildGroupList(obj)
    if (scrollbar) {
      const prop = scrollbar.instData<MuiScrollbarData>(this.scrollbarClass).prop
      const mirror = (source: BoopsiObject, sourceAttr: number, target: BoopsiObject, targetAttr: number): void => {
        this.doMui(source, MUI.MUIM_Notify, [sourceAttr, MUI.MUIV_EveryTime, target.address, 3,
          MUI.MUIM_Set, targetAttr, MUI.MUIV_TriggerValue])
      }
      mirror(list, MUI.MUIA_List_First, prop, MUI.MUIA_Prop_First)
      mirror(prop, MUI.MUIA_Prop_First, list, MUI.MUIA_List_First)
      mirror(list, MUI.MUIA_List_Entries, prop, MUI.MUIA_Prop_Entries)
      mirror(list, MUI.MUIA_List_Visible, prop, MUI.MUIA_Prop_Visible)
    }
    return true
  }

  private setListview(obj: BoopsiObject, cl: BoopsiClass, msg: OpSet): number {
    const d = obj.instData<MuiListviewData>(cl)
    const rest: TagItem[] = []
    let own = 0
    for (const attr of msg.attrs) {
      const id = TAG(attr.tag)
      if (id === MUI.MUIA_Listview_DragType) d.dragType = this.signed(attr.data)
      else if (id === MUI.MUIA_Listview_MultiSelect) d.multiSelect = this.signed(attr.data)
      else if (id === MUI.MUIA_Listview_ClickColumn) d.clickColumn = this.signed(attr.data)
      else if (id === MUI.MUIA_Listview_DefClickColumn) d.defaultClickColumn = this.signed(attr.data)
      else if (id === MUI.MUIA_Listview_Input) d.input = attr.data !== 0
      else if (id === MUI.MUIA_ControlChar) {
        data(this, obj).attrs.set(id, attr.data & 0xff)
        own++
        continue
      } else {
        rest.push(attr)
        continue
      }
      data(this, obj).attrs.set(id, this.signed(attr.data))
      own++
    }
    return own + doSuperMethodA(cl, obj, { ...msg, attrs: rest } as OpSet)
  }

  private getListview(obj: BoopsiObject, msg: OpGet): number {
    const d = obj.instData<MuiListviewData>(this.listviewClass)
    switch (TAG(msg.attrID)) {
      case MUI.MUIA_Listview_List: msg.storage = d.list.address; return 1
      case MUI.MUIA_Listview_ClickColumn: msg.storage = d.clickColumn; return 1
      case MUI.MUIA_Listview_DefClickColumn: msg.storage = d.defaultClickColumn; return 1
      case MUI.MUIA_Listview_DragType: msg.storage = d.dragType; return 1
      case MUI.MUIA_Listview_DoubleClick:
      case MUI.MUIA_Listview_SelectChange: msg.storage = 0; return 1
      default: return 0
    }
  }

  private listviewMethod(obj: BoopsiObject, msg: Msg): number | null {
    const d = obj.instData<MuiListviewData>(this.listviewClass)
    const p = (msg as Msg & { params?: readonly number[] }).params ?? []
    switch (msg.MethodID) {
      case MUI.MUIM_Setup: {
        const answer = doSuperMethodA(this.listviewClass, obj, msg)
        if (answer !== 0) this.setInternal(d.list, MUI.MUIA_ShowSelState, d.input ? 1 : 0)
        return answer === 0 ? 0 : 1
      }
      case MUI.MUIM_HandleInput: {
        if (!d.input) return doSuperMethodA(this.listviewClass, obj, msg)
        const before = this.get(d.list, MUI.MUIA_List_Active) ?? -1
        const key = this.signed(p[1] ?? -1)
        const positions = [-4, -5, -6, -7, -2, -3]
        if (key >= 0 && key < positions.length) this.set(d.list, MUI.MUIA_List_Active, positions[key]!)
        else this.doMui(d.list, MUI.MUIM_HandleInput, p)
        const after = this.get(d.list, MUI.MUIA_List_Active) ?? -1
        if (after !== before) {
          d.clickColumn = d.defaultClickColumn
          this.setInternal(obj, MUI.MUIA_Listview_ClickColumn, d.clickColumn)
          this.setInternal(obj, MUI.MUIA_Listview_SelectChange, 1)
        }
        return doSuperMethodA(this.listviewClass, obj, msg)
      }
      case MUI.MUIM_List_TestPos:
      case MUI.MUIM_List_GetEntry:
      case MUI.MUIM_List_Insert:
      case MUI.MUIM_List_InsertSingle:
      case MUI.MUIM_List_Remove:
      case MUI.MUIM_List_NextSelected:
      case MUI.MUIM_List_Clear:
      case MUI.MUIM_List_Sort:
      case MUI.MUIM_List_Jump:
      case MUI.MUIM_List_Redraw:
      case MUI.MUIM_List_Select:
      case MUI.MUIM_List_Exchange:
        return this.doMui(d.list, msg.MethodID, p)
      default: return null
    }
  }

  // -- Radio --------------------------------------------------------------

  private initRadio(obj: BoopsiObject, attrs: readonly TagItem[]): boolean {
    const entriesAddress = attrs.find((attr) => TAG(attr.tag) === MUI.MUIA_Radio_Entries)?.data ?? 0
    const entries = this.pointerList(entriesAddress)
    if (entries.length === 0) return false
    const d = obj.instData<MuiRadioData>(this.radioClass)
    d.entriesAddress = entriesAddress
    d.entries = entries
    d.active = this.signed(attrs.find((attr) => TAG(attr.tag) === MUI.MUIA_Radio_Active)?.data ?? 0)
    if (d.active < 0 || d.active >= entries.length) d.active = 0
    d.images = []
    d.labels = []
    const rows: BoopsiObject[] = []
    for (let i = 0; i < entries.length; i++) {
      const image = this.newObjectA(MUIC.MUIC_Image, [
        { tag: MUI.MUIA_Image_Spec, data: MUI.MUII_RadioButton },
        { tag: MUI.MUIA_Image_FontMatchHeight, data: 1 },
        { tag: MUI.MUIA_ShowSelState, data: 0 },
        { tag: MUI.MUIA_InputMode, data: MUI.MUIV_InputMode_Immediate },
      ])
      const spacer = this.newObjectA(MUIC.MUIC_Rectangle, [{ tag: MUI.MUIA_HorizWeight, data: 0 }])
      const label = this.newObjectA(MUIC.MUIC_Text, [
        { tag: MUI.MUIA_Text_Contents, data: entries[i]! },
        { tag: MUI.MUIA_Text_SetMax, data: 1 },
        { tag: MUI.MUIA_ShowSelState, data: 0 },
        { tag: MUI.MUIA_InputMode, data: MUI.MUIV_InputMode_Immediate },
      ])
      if (!image || !spacer || !label) {
        for (const made of [image, spacer, label, ...rows]) if (made) this.disposeObject(made)
        return false
      }
      const row = this.newObjectA(MUIC.MUIC_Group, [
        { tag: MUI.MUIA_Group_Horiz, data: 1 }, { tag: MUI.MUIA_Group_Spacing, data: 0 },
        { tag: MUI.MUIA_Group_Child, data: image.address }, { tag: MUI.MUIA_Group_Child, data: spacer.address },
        { tag: MUI.MUIA_Group_Child, data: label.address },
      ])
      if (!row) {
        for (const made of [image, spacer, label, ...rows]) this.disposeObject(made)
        return false
      }
      d.images.push(image)
      d.labels.push(label)
      rows.push(row)
    }
    data(this, obj).children.push(...rows)
    for (const row of rows) data(this, row).parent = obj
    data(this, obj).attrs.set(MUI.MUIA_Radio_Entries, entriesAddress)
    data(this, obj).attrs.set(MUI.MUIA_Radio_Active, d.active)
    this.rebuildGroupList(obj)
    for (let i = 0; i < entries.length; i++) {
      for (const item of [d.images[i]!, d.labels[i]!]) {
        this.doMui(item, MUI.MUIM_Notify,
          [MUI.MUIA_Selected, 1, obj.address, 3, MUI.MUIM_Set, MUI.MUIA_Radio_Active, i])
      }
    }
    this.radioSelect(obj, d.active)
    return true
  }

  private radioSelect(obj: BoopsiObject, requested: number): boolean {
    const d = obj.instData<MuiRadioData>(this.radioClass)
    if (requested < 0 || requested >= d.entries.length || requested === d.active &&
      (this.peek(d.images[requested]!, MUI.MUIA_Selected) ?? 0) !== 0) return false
    const previous = d.active
    d.active = requested
    if (previous >= 0 && previous < d.entries.length) {
      this.setInternal(d.images[previous]!, MUI.MUIA_Selected, 0)
      this.setInternal(d.labels[previous]!, MUI.MUIA_Selected, 0)
    }
    this.setInternal(d.images[requested]!, MUI.MUIA_Selected, 1)
    this.setInternal(d.labels[requested]!, MUI.MUIA_Selected, 1)
    this.setInternal(obj, MUI.MUIA_Radio_Active, requested)
    return true
  }

  private setRadio(obj: BoopsiObject, cl: BoopsiClass, msg: OpSet): number {
    const rest: TagItem[] = []
    let own = 0
    for (const attr of msg.attrs) {
      if (TAG(attr.tag) === MUI.MUIA_Radio_Active) {
        this.radioSelect(obj, this.signed(attr.data))
        own++
      } else if (TAG(attr.tag) === MUI.MUIA_ControlChar) {
        data(this, obj).attrs.set(MUI.MUIA_ControlChar, attr.data & 0xff)
        own++
      } else rest.push(attr)
    }
    return own + doSuperMethodA(cl, obj, { ...msg, attrs: rest } as OpSet)
  }

  private radioMethod(obj: BoopsiObject, msg: Msg): number | null {
    const d = obj.instData<MuiRadioData>(this.radioClass)
    const p = (msg as Msg & { params?: readonly number[] }).params ?? []
    switch (msg.MethodID) {
      case MUI.MUIM_Setup:
        return doSuperMethodA(this.radioClass, obj, msg)
      case MUI.MUIM_HandleInput: {
        const key = this.signed(p[1] ?? -1)
        if (key === 2 || key === 8) this.radioSelect(obj, Math.max(0, d.active - 1))
        else if (key === 3 || key === 9) this.radioSelect(obj, Math.min(d.entries.length - 1, d.active + 1))
        else if (key === 4) this.radioSelect(obj, 0)
        else if (key === 5) this.radioSelect(obj, d.entries.length - 1)
        return doSuperMethodA(this.radioClass, obj, msg)
      }
      case MUI.MUIM_Export:
        this.radioTransfer(obj, p[0] ?? 0, true)
        return 0
      case MUI.MUIM_Import:
        this.radioTransfer(obj, p[0] ?? 0, false)
        return 0
      default: return null
    }
  }

  private radioTransfer(obj: BoopsiObject, dataspaceAddress: number, exporting: boolean): void {
    const dataspace = this.boopsi.objectAt(dataspaceAddress)
    if (!dataspace?.cl.isA(this.dataspaceClass)) return
    const id = this.peek(obj, MUI.MUIA_ExportID) ?? 0
    if (id === 0) return
    const ds = dataspace.instData<MuiDataspaceData>(this.dataspaceClass)
    if (exporting) {
      const bytes = new Uint8Array(4)
      putLong(bytes, 0, obj.instData<MuiRadioData>(this.radioClass).active)
      this.dataspaceAddBytes(ds, bytes, id)
    } else {
      const entry = ds.entries.find((candidate) => candidate.id === TAG(id) && candidate.length >= 4)
      if (entry) this.set(obj, MUI.MUIA_Radio_Active, this.poolLong(entry.address - this.pool.base + 16))
    }
  }

  private groupMethod(obj: BoopsiObject, msg: Msg): number {
    const params = (msg as Msg & { params?: readonly number[] }).params ?? []
    const group = obj.instData<MuiGroupData>(this.groupClass)
    const children = [...data(this, obj).children]
    switch (msg.MethodID) {
      case MUI.MUIM_Setup: {
        const answer = doSuperMethodA(this.groupClass, obj, msg)
        if (answer === 0) return 0
        const setup: BoopsiObject[] = []
        for (const child of children) {
          if (this.doMui(child, MUI.MUIM_Setup) === 0) {
            for (const previous of setup.reverse()) this.doMui(previous, MUI.MUIM_Cleanup)
            doSuperMethodA(this.groupClass, obj, { MethodID: MUI.MUIM_Cleanup })
            return 0
          }
          setup.push(child)
        }
        return 1
      }
      case MUI.MUIM_Cleanup:
        for (const child of children) this.doMui(child, MUI.MUIM_Cleanup)
        return doSuperMethodA(this.groupClass, obj, msg)
      case MUI.MUIM_Show: {
        const answer = doSuperMethodA(this.groupClass, obj, msg)
        if (answer === 0) return 0
        const visible = this.groupVisibleChildren(obj, children)
        for (const child of visible) this.doMui(child, MUI.MUIM_Show)
        return 1
      }
      case MUI.MUIM_Hide:
        for (const child of children) this.doMui(child, MUI.MUIM_Hide)
        return doSuperMethodA(this.groupClass, obj, msg)
      case MUI.MUIM_Draw:
        doSuperMethodA(this.groupClass, obj, msg)
        for (const child of this.groupVisibleChildren(obj, children)) child.cl.dispatcher(child.cl, child, msg)
        return 0
      case MUI.MUIM_HandleInput:
        if ((params[0] ?? 0) !== 0) {
          for (const child of this.groupVisibleChildren(obj, children)) child.cl.dispatcher(child.cl, child, msg)
        }
        doSuperMethodA(this.groupClass, obj, msg)
        return 0
      case MUI.MUIM_Notify: {
        const attr = params[0] ?? 0
        const local = new Set<number>([MUI.MUIA_AppMessage, MUI.MUIA_Group_ActivePage,
          MUI.MUIA_Virtgroup_Top, MUI.MUIA_Virtgroup_Left, MUI.MUIA_ContextMenuTrigger])
        if (!local.has(attr)) for (const child of children) child.cl.dispatcher(child.cl, child, msg)
        doSuperMethodA(this.groupClass, obj, msg)
        return 0
      }
      case MUI.MUIM_Export:
      case MUI.MUIM_Import: {
        for (const child of children) child.cl.dispatcher(child.cl, child, msg)
        const dataspace = this.boopsi.objectAt(params[0] ?? 0)
        const id = this.peek(obj, MUI.MUIA_ExportID) ?? 0
        if (!dataspace?.cl.isA(this.dataspaceClass) || id === 0) return 0
        const ds = dataspace.instData<MuiDataspaceData>(this.dataspaceClass)
        if (msg.MethodID === MUI.MUIM_Export) {
          const value = this.peek(obj, MUI.MUIA_Group_ActivePage) ?? 0
          this.dataspaceAddBytes(ds, Uint8Array.of(value >>> 24, value >>> 16, value >>> 8, value), id)
        } else {
          const entry = ds.entries.find((candidate) => candidate.id === TAG(id))
          if (entry && entry.length >= 4) this.set(obj, MUI.MUIA_Group_ActivePage, this.poolLong(entry.address - this.pool.base + 16))
        }
        return 0
      }
      case MUI.MUIM_FindUData: {
        if ((this.peek(obj, MUI.MUIA_UserData) ?? 0) === (params[0] ?? 0)) return obj.address
        for (const child of children) {
          const found = this.doMui(child, MUI.MUIM_FindUData, [params[0] ?? 0])
          if (found !== 0) return found
        }
        return 0
      }
      case MUI.MUIM_GetUData: {
        const found = this.groupMethod(obj, { MethodID: MUI.MUIM_FindUData, params: [params[0] ?? 0] } as Msg)
        const target = this.boopsi.objectAt(found)
        return target ? this.getToAddress(target, params[1] ?? 0, params[2] ?? 0) : 0
      }
      case MUI.MUIM_SetUData:
      case MUI.MUIM_SetUDataOnce: {
        const setMatching = (target: BoopsiObject): boolean => {
          if ((this.peek(target, MUI.MUIA_UserData) ?? 0) === (params[0] ?? 0)) {
            this.set(target, params[1] ?? 0, params[2] ?? 0)
            if (msg.MethodID === MUI.MUIM_SetUDataOnce) return true
          }
          if (target.cl.isA(this.groupClass)) for (const child of data(this, target).children) if (setMatching(child)) return true
          return false
        }
        setMatching(obj)
        return msg.MethodID === MUI.MUIM_SetUDataOnce && this.groupMethod(obj,
          { MethodID: MUI.MUIM_FindUData, params: [params[0] ?? 0] } as Msg) !== 0 ? 1 : 0
      }
      case MUIM_AREA_LAYOUT:
      case MUIM_AREA_FIND_AT:
        return doSuperMethodA(this.groupClass, obj, msg)
      case MUIM_GROUP_TRANSFER_CHILDREN: {
        const target = this.boopsi.objectAt(params[0] ?? 0)
        if (!target?.cl.isA(this.groupClass)) return 0
        for (const child of children) {
          this.remMember(obj, child)
          this.addMember(target, child)
        }
        return 0
      }
      case MUI.MUIM_Group_InitChange:
        group.changeDepth++
        return 1
      case MUI.MUIM_Group_ExitChange:
        if (group.changeDepth > 0) group.changeDepth--
        if (group.changeDepth === 0) this.relayoutGroup(obj)
        return 0
      case MUIM_GROUP_EXIT_CHANGE2:
        if (group.changeDepth > 0) group.changeDepth--
        if (group.changeDepth === 0) this.relayoutGroup(obj)
        return 0
      case MUIM_GROUP_RUN_LAYOUT_HOOK:
        // Native invokes MUIA_Group_LayoutHook through utility.library.
        // Executing a guest 68k hook is outside this port's agreed scope.
        return 0
      case MUIM_GROUP_MOVE_TO_TAIL: {
        const child = this.boopsi.objectAt(params[0] ?? 0)
        if (!child) return 0
        const at = data(this, obj).children.indexOf(child)
        if (at >= 0) {
          data(this, obj).children.splice(at, 1)
          data(this, obj).children.push(child)
          this.rebuildGroupList(obj)
        }
        return 0
      }
      case MUIM_NOTIFY_IS_SELF: {
        const wanted = this.boopsi.objectAt(params[0] ?? 0)
        if (!wanted) return 0
        const contains = (parent: BoopsiObject): boolean => parent === wanted ||
          (parent.cl.isA(this.groupClass) && data(this, parent).children.some(contains))
        return contains(obj) ? wanted.address : 0
      }
      case MUIM_GROUP_COLLECT_CYCLE: {
        const output = params[0] ?? 0
        let count = (params[1] ?? 0) | 0
        const collect = (parent: BoopsiObject): void => {
          if (count >= 256) return
          if (parent !== obj && (this.peek(parent, MUI.MUIA_CycleChain) ?? 0) !== 0 && (this.peek(parent, MUI.MUIA_Disabled) ?? 0) === 0) {
            this.writeLong?.(output + count * 4, parent.address)
            count++
          }
          if (parent.cl.isA(this.groupClass)) for (const child of data(this, parent).children) collect(child)
        }
        collect(obj)
        return 0
      }
      case MUIM_GROUP_CLEAR_CYCLE:
        return 0
      case MUI.MUIM_Group_Sort: {
        const ordered: BoopsiObject[] = []
        for (const address of params) {
          if (address === 0) break
          const child = this.boopsi.objectAt(address)
          if (!child || !children.includes(child) || ordered.includes(child)) return 0
          ordered.push(child)
        }
        if (ordered.length !== children.length) return 0
        data(this, obj).children = ordered
        this.rebuildGroupList(obj)
        if (group.changeDepth === 0) this.relayoutGroup(obj)
        return 0
      }
      case 0x8042a0d6:
      case 0x8042d2d2:
        // These invoke the custom layout hook. Guest 68k hooks are explicitly
        // outside this port, but the native methods still answer zero.
        return 0
      default:
        if (GROUP_AREA_PASSTHROUGH.has(msg.MethodID)) return doSuperMethodA(this.groupClass, obj, msg)
        for (const child of children) child.cl.dispatcher(child.cl, child, msg)
        return doSuperMethodA(this.groupClass, obj, msg)
    }
  }

  private groupVisibleChildren(obj: BoopsiObject, children = [...data(this, obj).children]): BoopsiObject[] {
    if ((this.peek(obj, MUI.MUIA_Group_PageMode) ?? 0) === 0) {
      return children.filter((child) => (this.peek(child, MUI.MUIA_ShowMe) ?? 1) !== 0)
    }
    const page = Math.max(0, Math.min(children.length - 1, this.peek(obj, MUI.MUIA_Group_ActivePage) ?? 0))
    return children[page] ? [children[page]!] : []
  }

  /**
   * Cclist is MUI's private copyright catalogue. Its add operation follows a
   * MUI_CustomClass to the owning library's embedded `$VER:` string; the fill
   * operation copies the catalogue into a List while redraw is suppressed.
   */
  private cclistMethod(obj: BoopsiObject, msg: Msg): number | null {
    const p = (msg as Msg & { params?: readonly number[] }).params ?? []
    const d = obj.instData<MuiCclistData>(this.cclistClass)
    switch (msg.MethodID) {
      case MUIM_CCLIST_ADD_CLASS: {
        const source = p[0] ?? 0
        const cl = this.readLong?.(source + 0x18) ?? 0
        const library = cl === 0 ? 0 : this.readLong?.(cl + 0x10) ?? 0
        const versionAddress = library === 0 ? source : this.readLong?.(library + 0x18) ?? 0
        const parsed = this.parseVersionRecord(this.textOfAddress(versionAddress))
        if (!parsed) return 0
        this.doMui(obj, MUI.MUIM_Semaphore_Obtain)
        try {
          if (d.records.some((record) => record.name === parsed[0])) return 0
          const strings = parsed.map((value) => Uint8Array.from([...value, '\0'], (c) => c.charCodeAt(0)))
          const size = 24 + strings.reduce((sum, bytes) => sum + bytes.length, 0)
          const address = this.pool.alloc(size, { clear: true })
          if (address === 0) return 0
          const bytes = this.pool.buffer.subarray(address - this.pool.base, address - this.pool.base + size)
          let at = 24
          for (let i = 0; i < strings.length; i++) {
            putLong(bytes, 8 + i * 4, address + at)
            bytes.set(strings[i]!, at)
            at += strings[i]!.length
          }
          d.records.push({ address, name: parsed[0] })
        } finally {
          this.doMui(obj, MUI.MUIM_Semaphore_Release)
        }
        return 0
      }
      case MUIM_CCLIST_FILL_LIST: {
        const list = this.boopsi.objectAt(p[0] ?? 0)
        if (!list?.cl.isA(this.listClass)) return 0
        this.set(list, MUI.MUIA_List_Quiet, 1)
        this.doMui(list, MUI.MUIM_List_Clear)
        this.doMui(obj, MUI.MUIM_Semaphore_Obtain)
        for (const record of d.records) {
          this.doMui(list, MUI.MUIM_List_InsertSingle, [record.address, MUI.MUIV_List_Insert_Bottom])
        }
        this.doMui(obj, MUI.MUIM_Semaphore_Release)
        this.set(list, MUI.MUIA_List_Quiet, 0)
        return 0
      }
      default: return null
    }
  }

  private parseVersionRecord(raw: string): [string, string, string, string] | null {
    if (!raw.startsWith('$VER:')) return null
    const clean = raw.slice(5).replace(/[\x00-\x1f].*$/s, '').trim()
    const match = /^(\S+)\s+(\S+)(?:\s+\(([^)]*)\))?\s*(.*)$/.exec(clean)
    if (!match) return null
    const tail = (match[4] ?? '').replace(/^(?:Copyright|©)\s*/i, '').trim()
    return [match[1]!, match[2]!, match[3] ?? '', tail]
  }

  /** The two private operations Application uses on the global app list. */
  private applistMethod(obj: BoopsiObject, msg: Msg): number | null {
    const members = obj.instData<MuiApplistData>(this.applistClass).members
    const params = (msg as Msg & { params?: readonly number[] }).params ?? []
    switch (msg.MethodID) {
      case MUIM_APPLIST_BROADCAST: {
        const [method = 0, ...rest] = params
        for (const member of members) this.doMui(member, method, rest)
        return 0
      }
      case MUIM_APPLIST_FIND: {
        const [attr = 0, wanted = 0] = params
        for (const member of members) {
          const found = this.get(member, attr) ?? 0
          if (attr === MUI.MUIA_Application_BrokerPort) {
            if (found === wanted) return member.address
          } else if (found !== 0 && this.sameText(found, wanted)) {
            return member.address
          }
        }
        return 0
      }
      default:
        return null
    }
  }

  /**
   * Semaphore.mui is a SignalSemaphore embedded in an object. JavaScript runs
   * this machine on one task, so no other owner can contend; the two Attempt
   * calls consequently succeed exactly as Exec does for the current owner.
   * Counts are retained because ObtainSemaphore is recursive and Dataspace,
   * Configdata and their callers legitimately nest these methods.
   */
  private semaphoreMethod(obj: BoopsiObject, msg: Msg): number | null {
    const sem = obj.instData<MuiSemaphoreData>(this.semaphoreClass)
    switch (msg.MethodID) {
      case MUI.MUIM_Semaphore_Obtain:
        sem.exclusive++
        return 0
      case MUI.MUIM_Semaphore_ObtainShared:
        sem.shared++
        return 0
      case MUI.MUIM_Semaphore_Attempt:
        sem.exclusive++
        return 1
      case MUI.MUIM_Semaphore_AttemptShared:
        sem.shared++
        return 1
      case MUI.MUIM_Semaphore_Release:
        if (sem.exclusive > 0) sem.exclusive--
        else if (sem.shared > 0) sem.shared--
        return 0
      default:
        return null
    }
  }

  // -- Family ------------------------------------------------------------

  /** Menuitem's OM_SET, including the live-menu side effects in 19.35. */
  private setMenuitem(obj: BoopsiObject, cl: BoopsiClass, msg: OpSet): number {
    let change = 0
    let trigger = 0
    let checkedBecameTrue = false
    const oldStrings = new Map<number, number>()
    const attrs = this.normaliseMenuitemAttrs(msg.attrs)
    for (const attr of attrs) {
      switch (TAG(attr.tag)) {
        case MUI.MUIA_Menuitem_Title:
        case MUI.MUIA_Menuitem_Shortcut:
          oldStrings.set(TAG(attr.tag), this.peek(obj, attr.tag) ?? 0)
          change = 2
          break
        case MUI.MUIA_Menuitem_Exclude:
        case MUI.MUIA_Menuitem_Checkit:
          change = 2
          break
        case MUI.MUIA_Menuitem_Checked:
          if ((this.peek(obj, attr.tag) ?? 0) !== attr.data) {
            change ||= 1
            checkedBecameTrue = attr.data !== 0
          }
          break
        case MUI.MUIA_Menuitem_Enabled:
          if ((this.peek(obj, attr.tag) ?? 0) !== attr.data) change ||= 1
          break
        case MUI.MUIA_Menuitem_Trigger:
          trigger = attr.data
          break
      }
    }
    const noNotify = attrs.some((attr) => TAG(attr.tag) === MUI.MUIA_NoNotify && attr.data !== 0)
    if (noNotify) this.suppressNotifications++
    let answer = 0
    try {
      const ownMsg: OpSet = { ...msg, attrs }
      const ok = this.applyOwn('Menuitem', obj, attrs, 's')
      answer = (ok ? this.setCount : 0) + doSuperMethodA(cl, obj, ownMsg)
      if (obj.instData<MuiMenuitemData>(cl).copyStrings) {
        for (const attr of oldStrings.keys()) this.copyMenuitemString(obj, attr, this.peek(obj, attr) ?? 0, oldStrings.get(attr) ?? 0)
      }
      if (trigger !== 0 && (this.peek(obj, MUI.MUIA_Menuitem_Checkit) ?? 0) !== 0) {
        const checked = this.readByte(trigger + 12) & 1
        if ((this.peek(obj, MUI.MUIA_Menuitem_Checked) ?? 0) !== checked) this.set(obj, MUI.MUIA_Menuitem_Checked, checked)
      }
    } finally {
      if (noNotify) this.suppressNotifications--
    }
    if (checkedBecameTrue) {
      const exclude = this.peek(obj, MUI.MUIA_Menuitem_Exclude) ?? 0
      const parent = data(this, obj).parent
      if (exclude !== 0 && parent) this.doMui(parent, MUIM_FAMILY_EXCLUSIVE, [obj.address, exclude])
    }
    if (change !== 0) this.menuitemUpdateParent(obj, change)
    return answer
  }

  private normaliseMenuitemAttrs(attrs: readonly TagItem[]): readonly TagItem[] {
    const booleans = new Set<number>([
      MUI.MUIA_Menuitem_Toggle,
      MUI.MUIA_Menuitem_Checked,
      MUI.MUIA_Menuitem_Checkit,
      MUI.MUIA_Menuitem_Enabled,
      MUI.MUIA_Menuitem_CommandString,
    ])
    return attrs.map((attr) => booleans.has(TAG(attr.tag)) ? { tag: attr.tag, data: attr.data === 0 ? 0 : 1 } : attr)
  }

  /** The two private Menuitem methods plus its persistence specialisation. */
  private menuitemMethod(obj: BoopsiObject, msg: Msg): number | null {
    const params = (msg as Msg & { params?: readonly number[] }).params ?? []
    switch (msg.MethodID) {
      case MUIM_MENU_SYNC: {
        const address = params[0] ?? 0
        let hi = this.readByte(address + 12)
        let lo = this.readByte(address + 13)
        hi = (this.peek(obj, MUI.MUIA_Menuitem_Checked) ?? 0) !== 0 ? hi | 1 : hi & 0xfe
        lo = (this.peek(obj, MUI.MUIA_Menuitem_Enabled) ?? 1) !== 0 ? lo | 0x10 : lo & 0xef
        this.writeBytes(address + 12, Uint8Array.of(hi, lo))
        return 0
      }
      case MUIM_MENU_FILL_NEWMENU: {
        let address = params[0] ?? 0
        const type = params[1] ?? 2
        let title = this.peek(obj, MUI.MUIA_Menuitem_Title) ?? this.literalAddress('Unnamed')
        let shortcut = this.peek(obj, MUI.MUIA_Menuitem_Shortcut) ?? 0
        if (TAG(shortcut) === MUI.MUIV_Menuitem_Shortcut_Check) {
          if (TAG(title) !== 0xffffffff && this.textOfAddress(title).length === 1) {
            shortcut = title
            title = (title + 2) >>> 0
          } else shortcut = 0
        }
        let flags = 0
        if ((this.peek(obj, MUI.MUIA_Menuitem_Enabled) ?? 1) === 0) flags |= 0x10
        if ((this.peek(obj, MUI.MUIA_Menuitem_Checkit) ?? 0) !== 0) flags |= 0x0001
        if ((this.peek(obj, MUI.MUIA_Menuitem_Checked) ?? 0) !== 0) flags |= 0x0100
        if ((this.peek(obj, MUI.MUIA_Menuitem_Toggle) ?? 0) !== 0) flags |= 0x0008
        if ((this.peek(obj, MUI.MUIA_Menuitem_CommandString) ?? 0) !== 0) flags |= 0x0004
        const record = new Uint8Array(20)
        record[0] = type
        putLong(record, 2, title)
        putLong(record, 6, shortcut)
        putWord(record, 10, flags)
        putLong(record, 12, this.peek(obj, MUI.MUIA_Menuitem_Exclude) ?? 0)
        putLong(record, 16, obj.address)
        if (!this.writeBytes(address, record)) return 0
        address += 20
        for (const child of data(this, obj).children) {
          if (this.doMui(child, MUIM_MENU_FILL_NEWMENU, [address, type + 1]) === 0) return 0
          address += this.menuTreeSize(child) * 20
        }
        return 1
      }
      case MUI.MUIM_Export:
        this.menuitemTransferChecked(obj, params[0] ?? 0, true)
        return doSuperMethodA(this.menuitemClass, obj, msg)
      case MUI.MUIM_Import:
        this.menuitemTransferChecked(obj, params[0] ?? 0, false)
        return doSuperMethodA(this.menuitemClass, obj, msg)
      default:
        return null
    }
  }

  private menuitemTransferChecked(obj: BoopsiObject, dataspaceAddress: number, exporting: boolean): void {
    if ((this.peek(obj, MUI.MUIA_Menuitem_Checkit) ?? 0) === 0) return
    const dataspace = this.boopsi.objectAt(dataspaceAddress)
    if (!dataspace?.cl.isA(this.dataspaceClass)) return
    const id = this.peek(obj, MUI.MUIA_ObjectID) ?? this.peek(obj, MUI.MUIA_ExportID) ?? 0
    if (id === 0) return
    const d = dataspace.instData<MuiDataspaceData>(this.dataspaceClass)
    if (exporting) {
      const bytes = new Uint8Array(4)
      putLong(bytes, 0, this.peek(obj, MUI.MUIA_Menuitem_Checked) ?? 0)
      this.dataspaceAddBytes(d, bytes, id)
    } else {
      const entry = d.entries.find((candidate) => candidate.id === TAG(id))
      if (entry && entry.length >= 4) this.set(obj, MUI.MUIA_Menuitem_Checked, this.poolLong(entry.address - this.pool.base + 16))
    }
  }

  private copyMenuitemStrings(obj: BoopsiObject): void {
    for (const attr of [MUI.MUIA_Menuitem_Title, MUI.MUIA_Menuitem_Shortcut]) {
      const source = this.peek(obj, attr) ?? 0
      this.copyMenuitemString(obj, attr, source, 0)
    }
  }

  private copyMenuitemString(obj: BoopsiObject, attr: number, source: number, old: number): void {
    let address = source
    if (source !== 0 && TAG(source) !== 0xffffffff) {
      const bytes = Uint8Array.from([...this.textOfAddress(source), '\0'], (c) => c.charCodeAt(0))
      address = this.pool.alloc(bytes.length)
      if (address !== 0) {
        this.pool.buffer.set(bytes, address - this.pool.base)
        data(this, obj).ownedAddresses.push(address)
      }
    }
    const owned = data(this, obj).ownedAddresses
    const i = owned.indexOf(old)
    if (i >= 0) {
      this.pool.freeMem(old)
      owned.splice(i, 1)
    }
    data(this, obj).attrs.set(attr, address)
  }

  private readByte(address: number): number {
    if (address >= this.pool.base && address < this.pool.base + this.pool.buffer.length) {
      return this.pool.buffer[address - this.pool.base] ?? 0
    }
    return this.readMemory?.(address, 1)?.[0] ?? 0
  }

  private menuitemUpdateParent(obj: BoopsiObject, kind: number): void {
    let parent = data(this, obj).parent
    while (parent && !parent.cl.isA(this.menustripClass)) parent = data(this, parent).parent
    if (parent) this.doMui(parent, MUIM_MENUSTRIP_UPDATE, [obj.address, kind])
  }

  private menuMethod(obj: BoopsiObject, msg: Msg): number | null {
    const params = (msg as Msg & { params?: readonly number[] }).params ?? []
    switch (msg.MethodID) {
      case MUIM_MENU_FILL_NEWMENU: {
        let address = params[0] ?? 0
        const type = params[1] ?? 1
        const record = new Uint8Array(20)
        record[0] = type
        putWord(record, 10, (this.peek(obj, MUI.MUIA_Menu_Enabled) ?? 1) !== 0 ? 0 : 1)
        putLong(record, 2, this.peek(obj, MUI.MUIA_Menu_Title) ?? this.literalAddress('Unnamed'))
        putLong(record, 6, this.literalAddress('a'))
        putLong(record, 16, obj.address)
        if (!this.writeBytes(address, record)) return 0
        address += 20
        for (const child of data(this, obj).children) {
          if (this.doMui(child, MUIM_MENU_FILL_NEWMENU, [address, type + 1]) === 0) return 0
          address += this.menuTreeSize(child) * 20
        }
        return 1
      }
      case MUIM_MENU_SYNC: {
        const address = params[0] ?? 0
        const old = address + 13 >= this.pool.base && address + 13 < this.pool.base + this.pool.buffer.length
          ? this.pool.buffer[address + 13 - this.pool.base]!
          : this.readMemory?.(address + 13, 1)?.[0] ?? 0
        const enabled = (this.peek(obj, MUI.MUIA_Menu_Enabled) ?? 1) !== 0
        this.writeBytes(address + 13, Uint8Array.of(enabled ? old | 1 : old & 0xfe))
        return 0
      }
      case MUI.MUIM_Family_AddTail:
      case MUI.MUIM_Family_AddHead:
      case MUI.MUIM_Family_Insert:
      case MUI.MUIM_Family_Remove:
        doSuperMethodA(this.menuClass, obj, msg)
        this.menuUpdateParent(obj, 3)
        return 0
      default:
        return null
    }
  }

  private menuUpdateParent(obj: BoopsiObject, kind: number): void {
    const parent = data(this, obj).parent
    if (parent?.cl.isA(this.menustripClass)) this.doMui(parent, MUIM_MENUSTRIP_UPDATE, [obj.address, kind])
  }

  private literalAddress(value: string): number {
    const have = this.literalPointers.get(value)
    if (have !== undefined) return have
    const bytes = Uint8Array.from([...value, '\0'], (c) => c.charCodeAt(0))
    const address = this.pool.alloc(bytes.length)
    if (address !== 0) {
      this.pool.buffer.set(bytes, address - this.pool.base)
      this.literalPointers.set(value, address)
    }
    return address
  }

  private writeBytes(address: number, bytes: Uint8Array): boolean {
    if (address >= this.pool.base && address + bytes.length <= this.pool.base + this.pool.buffer.length) {
      this.pool.buffer.set(bytes, address - this.pool.base)
      return true
    }
    return this.writeMemory?.(address, bytes) ?? false
  }

  private menustripMethod(obj: BoopsiObject, msg: Msg): number | null {
    const params = (msg as Msg & { params?: readonly number[] }).params ?? []
    const d = obj.instData<MuiMenustripData>(this.menustripClass)
    switch (msg.MethodID) {
      case MUIM_MENUSTRIP_BUILD: {
        const count = this.menuTreeSize(obj) + 1
        const handle = this.pool.alloc(count * 20, { clear: true })
        if (handle === 0) return 0
        let address = handle
        for (const child of data(this, obj).children) {
          if (this.doMui(child, MUIM_MENU_FILL_NEWMENU, [address, 1]) === 0) {
            this.pool.freeMem(handle)
            return 0
          }
          address += this.menuTreeSize(child) * 20
        }
        d.handles.add(handle)
        return handle
      }
      case MUIM_MENUSTRIP_FREE: {
        const handle = params[0] ?? 0
        if (d.handles.delete(handle)) this.pool.freeMem(handle)
        return 0
      }
      case MUIM_MENUSTRIP_UPDATE:
        this.menustripUpdate(obj)
        return 0
      case MUI.MUIM_Family_AddTail:
      case MUI.MUIM_Family_AddHead:
      case MUI.MUIM_Family_Insert:
      case MUI.MUIM_Family_Remove:
        doSuperMethodA(this.menustripClass, obj, msg)
        this.menustripUpdate(obj)
        return 0
      default:
        return null
    }
  }

  private menuTreeSize(obj: BoopsiObject): number {
    let count = 0
    for (const child of data(this, obj).children) count += 1 + this.menuTreeSize(child)
    return count
  }

  private menustripUpdate(obj: BoopsiObject): void {
    // Native rebuilds the attached Intuition menu only while at least one
    // Build handle is live. The platform attachment lands with Window.
    if (obj.instData<MuiMenustripData>(this.menustripClass).handles.size !== 0) this.menuChanged?.(obj)
  }

  private familyMethod(obj: BoopsiObject, msg: Msg): number | null {
    const params = (msg as Msg & { params?: readonly number[] }).params ?? []
    switch (msg.MethodID) {
      case MUI.MUIM_Family_AddTail:
        return this.familyAdd(obj, this.boopsi.objectAt(params[0] ?? 0), 'tail')
      case MUI.MUIM_Family_AddHead:
        return this.familyAdd(obj, this.boopsi.objectAt(params[0] ?? 0), 'head')
      case MUI.MUIM_Family_Insert:
        return this.familyAdd(obj, this.boopsi.objectAt(params[0] ?? 0), 'after', this.boopsi.objectAt(params[1] ?? 0))
      case MUI.MUIM_Family_Remove:
        return this.familyRemove(obj, this.boopsi.objectAt(params[0] ?? 0))
      case MUI.MUIM_Family_Transfer: {
        const target = this.boopsi.objectAt(params[0] ?? 0)
        if (!target) return 0
        for (const child of [...data(this, obj).children]) {
          this.familyRemove(obj, child)
          this.addMember(target, child)
        }
        return 0
      }
      case MUI.MUIM_Family_Sort: {
        const wanted: BoopsiObject[] = []
        for (const address of params) {
          if (address === 0) break
          const child = this.boopsi.objectAt(address)
          if (child) wanted.push(child)
        }
        const children = data(this, obj).children
        if (wanted.length === children.length && wanted.every((child) => children.includes(child)) && new Set(wanted).size === children.length) {
          children.splice(0, children.length, ...wanted)
          this.rebuildFamilyList(obj)
        }
        return 0
      }
      case MUI.MUIM_FindUData: {
        const own = this.peek(obj, MUI.MUIA_UserData) ?? 0
        if (own === (params[0] ?? 0)) return obj.address
        for (const child of data(this, obj).children) {
          const found = this.doMui(child, MUI.MUIM_FindUData, [params[0] ?? 0])
          if (found !== 0) return found
        }
        return 0
      }
      case MUI.MUIM_GetUData: {
        const found = this.familyMethod(obj, { MethodID: MUI.MUIM_FindUData, params: [params[0] ?? 0] } as Msg) ?? 0
        const target = this.boopsi.objectAt(found)
        return target ? this.getToAddress(target, params[1] ?? 0, params[2] ?? 0) : 0
      }
      case MUIM_FAMILY_EXCLUSIVE: {
        const except = this.boopsi.objectAt(params[0] ?? 0)
        let bit = 1
        for (const child of data(this, obj).children) {
          if (child !== except && ((params[1] ?? 0) & bit) !== 0) this.set(child, MUI.MUIA_Menuitem_Checked, 0)
          bit = (bit * 2) >>> 0
          if (bit === 0x80000000) break
        }
        return 0
      }
      case OM_ADDTAIL:
      case OM_REMOVE:
      case OM_NOTIFY:
      case OM_UPDATE:
        return 0
      default:
        return null
    }
  }

  private familyAdd(obj: BoopsiObject, child: BoopsiObject | null, where: 'head' | 'tail' | 'after', pred: BoopsiObject | null = null): number {
    if (!child) return 0
    const children = data(this, obj).children
    const old = children.indexOf(child)
    if (old >= 0) children.splice(old, 1)
    if (where === 'head') children.unshift(child)
    else if (where === 'after') {
      const i = pred ? children.indexOf(pred) : -1
      children.splice(i < 0 ? children.length : i + 1, 0, child)
    } else children.push(child)
    data(this, child).parent = obj
    data(this, child).contextApplication = data(this, obj).contextApplication
    data(this, child).contextConfigdata = data(this, obj).contextConfigdata
    this.rebuildFamilyList(obj)
    return 1
  }

  private familyRemove(obj: BoopsiObject, child: BoopsiObject | null): number {
    if (!child) return 0
    const children = data(this, obj).children
    const i = children.indexOf(child)
    if (i >= 0) children.splice(i, 1)
    data(this, child).parent = null
    this.rebuildFamilyList(obj)
    return 1
  }

  /** A MinList header and twelve-byte nodes whose +8 longword is the object. */
  private rebuildFamilyList(obj: BoopsiObject): void {
    const family = obj.instData<MuiFamilyData>(this.familyClass)
    if (!family?.listAddress) return
    if (family.nodesAddress !== 0) {
      this.pool.freeMem(family.nodesAddress)
      const owned = data(this, obj).ownedAddresses
      const i = owned.indexOf(family.nodesAddress)
      if (i >= 0) owned.splice(i, 1)
      family.nodesAddress = 0
    }
    const children = data(this, obj).children
    if (children.length !== 0) {
      family.nodesAddress = this.pool.alloc(children.length * 12, { clear: true })
      if (family.nodesAddress !== 0) data(this, obj).ownedAddresses.push(family.nodesAddress)
    }
    const listOff = family.listAddress - this.pool.base
    this.putPoolLong(listOff, family.nodesAddress)
    this.putPoolLong(listOff + 4, 0)
    this.putPoolLong(listOff + 8, children.length === 0 ? family.listAddress : family.nodesAddress + (children.length - 1) * 12)
    for (let i = 0; i < children.length && family.nodesAddress !== 0; i++) {
      const at = family.nodesAddress - this.pool.base + i * 12
      this.putPoolLong(at, i + 1 < children.length ? family.nodesAddress + (i + 1) * 12 : 0)
      this.putPoolLong(at + 4, i === 0 ? family.listAddress : family.nodesAddress + (i - 1) * 12)
      this.putPoolLong(at + 8, children[i]!.address)
    }
  }

  // -- Configdata --------------------------------------------------------

  private applyConfigdataAttrs(obj: BoopsiObject, attrs: readonly TagItem[]): number {
    const d = obj.instData<MuiConfigdataData>(this.configdataClass)
    let used = 0
    for (const attr of attrs) {
      if (TAG(attr.tag) === MUIA_CONFIGDATA_FALLBACK) {
        d.fallback = this.boopsi.objectAt(attr.data)
        used++
      } else if (TAG(attr.tag) === MUIA_CONFIGDATA_SELECTOR) {
        d.selector = attr.data | 0
        obj.instData<MuiDataspaceData>(this.dataspaceClass).filterIds = true
        used++
      }
    }
    return used
  }

  /** The four binary-only operations over Configdata's descriptor table. */
  private configdataMethod(obj: BoopsiObject, msg: Msg): number | null {
    const params = (msg as Msg & { params?: readonly number[] }).params ?? []
    const cd = obj.instData<MuiConfigdataData>(this.configdataClass)
    const ds = obj.instData<MuiDataspaceData>(this.dataspaceClass)
    const id = TAG(params[0] ?? 0)
    switch (msg.MethodID) {
      case MUIM_CONFIGDATA_GET: {
        const storage = params[1] ?? 0
        const own = ds.entries.find((entry) => entry.id === id)
        if (own) {
          const value = (id & 0x80000000) !== 0 || (CONFIG_FLAGS[id - 1]! & 4) !== 0
            ? (own.address + 16) >>> 0
            : this.poolLong(own.address - this.pool.base + 16)
          this.writeLong?.(storage, value)
          return 1
        }
        if (cd.fallback) return this.doMui(cd.fallback, MUIM_CONFIGDATA_GET, [id, storage])
        if (!this.configDescriptor(id)) return 0
        this.writeLong?.(storage, this.configDefault(id))
        return 1
      }
      case MUIM_CONFIGDATA_HAS:
        if (!this.configDescriptor(id)) return 0
        if (ds.entries.some((entry) => entry.id === id)) return 1
        return cd.fallback ? this.doMui(cd.fallback, MUIM_CONFIGDATA_HAS, [id]) : 0
      case MUIM_CONFIGDATA_SET: {
        if (!this.configDescriptor(id)) return 0
        const value = params[1] ?? 0
        if ((CONFIG_FLAGS[id - 1]! & 4) !== 0) {
          const s = value === 0 ? '' : (this.readString?.(value) ?? '')
          return this.dataspaceAddBytes(ds, Uint8Array.from([...s, '\0'], (c) => c.charCodeAt(0)), id)
        }
        const bytes = new Uint8Array(4)
        putLong(bytes, 0, value)
        return this.dataspaceAddBytes(ds, bytes, id)
      }
      case MUIM_CONFIGDATA_ACCEPTS:
        if ((id & 0x80000000) !== 0) return cd.selector === 0 ? 1 : 0
        if (!this.configDescriptor(id)) return 0
        if (cd.selector > 0 && cd.selector !== id) return 0
        if (cd.selector < 0 && CONFIG_GROUPS[id - 1] !== -(cd.selector + 1)) return 0
        return 1
      default:
        return null
    }
  }

  private configDescriptor(id: number): boolean {
    return id >= 1 && id <= CONFIG_DEFAULTS.length
  }

  private configDefault(id: number): number {
    return this.configDefaultPointers.get(id) ?? CONFIG_DEFAULTS[id - 1] ?? 0
  }

  private poolLong(off: number): number {
    return getLong(this.pool.buffer, off)
  }

  // -- Dataspace ---------------------------------------------------------

  /**
   * Dataspace's records are the native sixteen-byte list node followed by
   * the copied bytes: next/prev/id/length/data.  Keeping that exact layout is
   * observable because Find returns `record + 16`, while the private iterator
   * used by Merge returns the record itself.
   */
  private dataspaceMethod(obj: BoopsiObject, msg: Msg): number | null {
    const params = (msg as Msg & { params?: readonly number[] }).params ?? []
    const d = obj.instData<MuiDataspaceData>(this.dataspaceClass)
    switch (msg.MethodID) {
      case MUI.MUIM_Dataspace_Add: {
        const [source = 0, length = 0, id = 0] = params
        if (d.filterIds && this.configdataMethod(obj, { MethodID: MUIM_CONFIGDATA_ACCEPTS, params: [id] } as Msg) === 0) return 0
        if (length < 0) return 0
        const bytes = this.readMemory?.(source, length) ?? null
        if (!bytes || bytes.length < length) return 0
        return this.dataspaceAddBytes(d, bytes.subarray(0, length), id)
      }
      case MUI.MUIM_Dataspace_Remove: {
        const [id = 0] = params
        if (d.filterIds && this.configdataMethod(obj, { MethodID: MUIM_CONFIGDATA_ACCEPTS, params: [id] } as Msg) === 0) return 0
        const i = d.entries.findIndex((entry) => entry.id === TAG(id))
        if (i < 0) return 0
        const [entry] = d.entries.splice(i, 1)
        const answer = (entry!.address + 16) >>> 0
        this.pool.freeMem(entry!.address)
        this.linkDataspace(d)
        return answer
      }
      case MUI.MUIM_Dataspace_Find: {
        const [id = 0] = params
        const entry = d.entries.find((candidate) => candidate.id === TAG(id))
        return entry ? (entry.address + 16) >>> 0 : 0
      }
      case MUI.MUIM_Dataspace_Clear:
        this.dataspaceClear(obj)
        return 0
      case MUI.MUIM_Dataspace_Merge: {
        const source = this.boopsi.objectAt(params[0] ?? 0)
        if (!source?.cl.isA(this.dataspaceClass)) return 0
        let count = 0
        for (const entry of [...source.instData<MuiDataspaceData>(this.dataspaceClass).entries]) {
          if (this.dataspaceMethod(obj, {
            MethodID: MUI.MUIM_Dataspace_Add,
            params: [(entry.address + 16) >>> 0, entry.length, entry.id],
          } as Msg) !== 0) count++
        }
        return count
      }
      case MUI.MUIM_Dataspace_WriteIFF: {
        const [handle = 0, type = 0, id = 0] = params
        if (!this.writeIffChunk) return -4 // IFFERR_NOMEM: native cannot open iffparse context
        const size = d.entries.reduce((sum, entry) => sum + 8 + entry.length, 0)
        const bytes = new Uint8Array(size)
        let at = 0
        for (const entry of d.entries) {
          putLong(bytes, at, entry.id)
          putLong(bytes, at + 4, entry.length)
          bytes.set(this.pool.buffer.subarray(entry.address - this.pool.base + 16, entry.address - this.pool.base + 16 + entry.length), at + 8)
          at += 8 + entry.length
        }
        return this.writeIffChunk(handle, TAG(type), TAG(id), bytes)
      }
      case MUI.MUIM_Dataspace_ReadIFF: {
        const [handle = 0] = params
        if (!this.readIffChunk) return -4
        const chunk = this.readIffChunk(handle)
        if (typeof chunk === 'number') return chunk
        if (chunk === null) return 0
        let at = 0
        while (at + 8 <= chunk.length) {
          const id = getLong(chunk, at)
          const length = getLong(chunk, at + 4)
          at += 8
          if (length > chunk.length - at) return -4
          const address = this.pool.alloc(16 + length)
          if (address === 0) return -4
          const old = d.entries.findIndex((entry) => entry.id === id)
          if (old >= 0) {
            this.pool.freeMem(d.entries[old]!.address)
            d.entries.splice(old, 1)
          }
          d.entries.push({ address, id, length })
          this.pool.buffer.set(chunk.subarray(at, at + length), address - this.pool.base + 16)
          at += length
        }
        if (at !== chunk.length) return -4
        this.linkDataspace(d)
        return 0
      }
      case MUIM_DATASPACE_EQUAL: {
        const other = this.boopsi.objectAt(params[0] ?? 0)
        if (!other?.cl.isA(this.dataspaceClass)) return 0
        return this.dataspaceEqual(d, other.instData<MuiDataspaceData>(this.dataspaceClass)) ? 1 : 0
      }
      case MUIM_DATASPACE_PRUNE: {
        const other = this.boopsi.objectAt(params[0] ?? 0)
        const od = other?.cl.isA(this.dataspaceClass)
          ? other.instData<MuiDataspaceData>(this.dataspaceClass)
          : null
        for (const entry of [...d.entries]) {
          const match = od?.entries.find((candidate) => candidate.id === entry.id)
          if ((match && this.dataspaceEntryEqual(entry, match)) || (!match && this.dataspaceEntryMatchesDefault(entry))) {
            this.dataspaceRemoveEntry(d, entry)
          }
        }
        return 0
      }
      case MUIM_DATASPACE_NEXT: {
        const cursorAddress = params[0] ?? 0
        const cursor = this.readLong?.(cursorAddress) ?? 0
        const i = cursor === 0 ? 0 : d.entries.findIndex((entry) => entry.address === TAG(cursor))
        if (i < 0 || i >= d.entries.length) {
          this.writeLong?.(cursorAddress, 0)
          return 0
        }
        const entry = d.entries[i]!
        this.writeLong?.(cursorAddress, d.entries[i + 1]?.address ?? 0)
        return entry.address
      }
      default:
        return null
    }
  }

  private dataspaceClear(obj: BoopsiObject): void {
    const d = obj.instData<MuiDataspaceData>(this.dataspaceClass)
    for (const entry of d.entries) this.pool.freeMem(entry.address)
    d.entries = []
  }

  private dataspaceAddBytes(d: MuiDataspaceData, bytes: Uint8Array, id: number): number {
    const address = this.pool.alloc(16 + bytes.length)
    if (address === 0) return 0
    const old = d.entries.findIndex((entry) => entry.id === TAG(id))
    if (old >= 0) {
      this.pool.freeMem(d.entries[old]!.address)
      d.entries.splice(old, 1)
    }
    d.entries.push({ address, id: TAG(id), length: bytes.length })
    this.pool.buffer.set(bytes, address - this.pool.base + 16)
    this.linkDataspace(d)
    return (address + 16) >>> 0
  }

  private dataspaceRemoveEntry(d: MuiDataspaceData, entry: MuiDataspaceEntry): void {
    const i = d.entries.indexOf(entry)
    if (i >= 0) d.entries.splice(i, 1)
    this.pool.freeMem(entry.address)
    this.linkDataspace(d)
  }

  private dataspaceEqual(a: MuiDataspaceData, b: MuiDataspaceData): boolean {
    return a.entries.length === b.entries.length && a.entries.every((entry) => {
      const other = b.entries.find((candidate) => candidate.id === entry.id)
      return other !== undefined && this.dataspaceEntryEqual(entry, other)
    })
  }

  private dataspaceEntryEqual(a: MuiDataspaceEntry, b: MuiDataspaceEntry): boolean {
    if (a.length !== b.length) return false
    const ao = a.address - this.pool.base + 16
    const bo = b.address - this.pool.base + 16
    for (let i = 0; i < a.length; i++) if (this.pool.buffer[ao + i] !== this.pool.buffer[bo + i]) return false
    return true
  }

  private dataspaceEntryMatchesDefault(entry: MuiDataspaceEntry): boolean {
    if (!this.configDescriptor(entry.id)) return false
    const text = (CONFIG_FLAGS[entry.id - 1]! & 4) !== 0 ? CONFIG_TEXT[entry.id] : undefined
    const off = entry.address - this.pool.base + 16
    if (text !== undefined) {
      const expected = Uint8Array.from([...text, '\0'], (c) => c.charCodeAt(0))
      if (entry.length !== expected.length) return false
      for (let i = 0; i < expected.length; i++) if (this.pool.buffer[off + i] !== expected[i]) return false
      return true
    }
    return entry.length === 4 && this.poolLong(off) === this.configDefault(entry.id)
  }

  /** Rebuild the native MinList links and the two scalar header fields. */
  private linkDataspace(d: MuiDataspaceData): void {
    for (let i = 0; i < d.entries.length; i++) {
      const entry = d.entries[i]!
      const off = entry.address - this.pool.base
      this.putPoolLong(off, d.entries[i + 1]?.address ?? 0)
      this.putPoolLong(off + 4, d.entries[i - 1]?.address ?? 0)
      this.putPoolLong(off + 8, entry.id)
      this.putPoolLong(off + 12, entry.length)
    }
  }

  private putPoolLong(off: number, value: number): void {
    this.pool.buffer[off] = value >>> 24
    this.pool.buffer[off + 1] = value >>> 16
    this.pool.buffer[off + 2] = value >>> 8
    this.pool.buffer[off + 3] = value
  }

  // -- Gadget -------------------------------------------------------------

  private initString(obj: BoopsiObject, attrs: readonly TagItem[]): boolean {
    const value = (attr: number, fallback: number): number =>
      attrs.find((item) => TAG(item.tag) === attr)?.data ?? fallback
    const maxLen = Math.max(1, this.signed(value(MUI.MUIA_String_MaxLen, 127)))
    const bufferAddress = this.pool.alloc(maxLen + 1, { clear: true })
    const gadgetAddress = this.pool.alloc(44, { clear: true })
    if (bufferAddress === 0 || gadgetAddress === 0) {
      if (bufferAddress !== 0) this.pool.freeMem(bufferAddress)
      if (gadgetAddress !== 0) this.pool.freeMem(gadgetAddress)
      return false
    }
    data(this, obj).ownedAddresses.push(bufferAddress, gadgetAddress)
    const source = value(MUI.MUIA_String_Contents, 0)
    const integer = value(MUI.MUIA_String_Integer, 0)
    const contents = source !== 0 ? this.textOfAddress(source) :
      (attrs.some((item) => TAG(item.tag) === MUI.MUIA_String_Integer) ? String(integer | 0) : '')
    const d = obj.instData<MuiStringData>(this.stringClass)
    d.bufferAddress = bufferAddress
    d.gadgetAddress = gadgetAddress
    d.acknowledgeAddress = bufferAddress
    d.state = {
      buffer: contents.slice(0, maxLen), maxChars: maxLen + 1,
      bufferPos: Math.min(contents.length, maxLen), displayPos: 0,
      longInt: integer | 0,
      accept: this.textOfAddress(value(MUI.MUIA_String_Accept, 0)),
      reject: this.textOfAddress(value(MUI.MUIA_String_Reject, 0)),
      secret: value(MUI.MUIA_String_Secret, 0) !== 0,
      accepted: false,
    }
    const gadget = obj.instData<MuiGadgetData>(this.gadgetClass)
    gadget.gadget = gadgetAddress
    const stored = data(this, obj).attrs
    stored.set(MUI.MUIA_Gadget_Gadget, gadgetAddress)
    stored.set(MUI.MUIA_String_Accept, value(MUI.MUIA_String_Accept, 0))
    stored.set(MUI.MUIA_String_AdvanceOnCR, value(MUI.MUIA_String_AdvanceOnCR, 0) !== 0 ? 1 : 0)
    stored.set(MUI.MUIA_String_AttachedList, value(MUI.MUIA_String_AttachedList, 0))
    stored.set(MUI.MUIA_String_EditHook, value(MUI.MUIA_String_EditHook, 0))
    stored.set(MUI.MUIA_String_Format, value(MUI.MUIA_String_Format, MUI.MUIV_String_Format_Left))
    stored.set(MUI.MUIA_String_LonelyEditHook, value(MUI.MUIA_String_LonelyEditHook, 0) !== 0 ? 1 : 0)
    stored.set(MUI.MUIA_String_MaxLen, maxLen)
    stored.set(MUI.MUIA_String_Reject, value(MUI.MUIA_String_Reject, 0))
    stored.set(MUI.MUIA_String_Secret, value(MUI.MUIA_String_Secret, 0) !== 0 ? 1 : 0)
    this.syncString(obj)
    return true
  }

  private stringActivation(obj: BoopsiObject): number {
    const format = this.peek(obj, MUI.MUIA_String_Format) ?? MUI.MUIV_String_Format_Left
    return 0x0001 | (format === MUI.MUIV_String_Format_Center ? 0x0200 : format === MUI.MUIV_String_Format_Right ? 0x0400 : 0)
  }

  private syncString(obj: BoopsiObject): void {
    const d = obj.instData<MuiStringData>(this.stringClass)
    d.state.buffer = d.state.buffer.slice(0, d.state.maxChars - 1)
    d.state.bufferPos = Math.max(0, Math.min(d.state.buffer.length, d.state.bufferPos))
    const off = d.bufferAddress - this.pool.base
    this.pool.buffer.fill(0, off, off + d.state.maxChars)
    for (let i = 0; i < d.state.buffer.length; i++) this.pool.buffer[off + i] = d.state.buffer.charCodeAt(i)
    this.windowHost?.configureStringGadget?.(d.gadgetAddress, d.state, this.stringActivation(obj))
  }

  private setString(obj: BoopsiObject, cl: BoopsiClass, msg: OpSet): number {
    const d = obj.instData<MuiStringData>(cl)
    const rest: TagItem[] = []
    let own = 0
    for (const attr of msg.attrs) {
      const id = TAG(attr.tag)
      switch (id) {
        case MUI.MUIA_String_Contents: {
          const old = d.state.buffer
          if (attr.data !== 0xff) d.state.buffer = attr.data === 0 ? '' : this.textOfAddress(attr.data)
          d.state.bufferPos = Math.min(d.state.buffer.length, d.state.maxChars - 1)
          d.state.displayPos = 0
          if (d.state.buffer !== old) this.setInternal(obj, id, d.bufferAddress)
          own++
          break
        }
        case MUI.MUIA_String_Integer: {
          const old = d.state.buffer
          d.state.longInt = attr.data | 0
          d.state.buffer = String(attr.data | 0)
          d.state.bufferPos = Math.min(d.state.buffer.length, d.state.maxChars - 1)
          d.state.displayPos = 0
          if (d.state.buffer !== old) this.setInternal(obj, MUI.MUIA_String_Contents, d.bufferAddress)
          own++
          break
        }
        case MUI.MUIA_String_BufferPos:
          d.state.bufferPos = attr.data | 0
          this.setInternal(obj, id, d.state.bufferPos)
          own++
          break
        case MUI.MUIA_String_DisplayPos:
          d.state.displayPos = attr.data | 0
          this.setInternal(obj, id, d.state.displayPos)
          own++
          break
        case MUI.MUIA_String_Accept:
          d.state.accept = this.textOfAddress(attr.data)
          this.setInternal(obj, id, attr.data)
          own++
          break
        case MUI.MUIA_String_Reject:
          d.state.reject = this.textOfAddress(attr.data)
          this.setInternal(obj, id, attr.data)
          own++
          break
        case MUI.MUIA_String_AdvanceOnCR:
        case MUI.MUIA_String_AttachedList:
        case MUI.MUIA_String_EditHook:
        case MUI.MUIA_String_LonelyEditHook:
          this.setInternal(obj, id, attr.data)
          own++
          break
        default: rest.push(attr)
      }
    }
    this.syncString(obj)
    if (own !== 0) this.redrawArea(obj, 1)
    return own + doSuperMethodA(cl, obj, { ...msg, attrs: rest } as OpSet)
  }

  private getString(obj: BoopsiObject, msg: OpGet): number {
    const d = obj.instData<MuiStringData>(this.stringClass)
    this.syncString(obj)
    switch (TAG(msg.attrID)) {
      case MUI.MUIA_String_Contents:
      case MUI.MUIA_String_Acknowledge: msg.storage = d.bufferAddress; return 1
      case MUI.MUIA_String_Integer: {
        const parsed = Number.parseInt(d.state.buffer, 10)
        msg.storage = Number.isNaN(parsed) ? 0 : parsed | 0
        return 1
      }
      case MUI.MUIA_String_BufferPos: msg.storage = d.state.bufferPos; return 1
      case MUI.MUIA_String_DisplayPos: msg.storage = d.state.displayPos; return 1
      case MUI.MUIA_String_Accept: msg.storage = this.peek(obj, MUI.MUIA_String_Accept) ?? 0; return 1
      case MUI.MUIA_String_Reject: msg.storage = this.peek(obj, MUI.MUIA_String_Reject) ?? 0; return 1
      default: return 0
    }
  }

  private stringMethod(obj: BoopsiObject, msg: Msg): number | null {
    const params = (msg as Msg & { params?: readonly number[] }).params ?? []
    const d = obj.instData<MuiStringData>(this.stringClass)
    switch (msg.MethodID) {
      case MUI.MUIM_Setup:
        this.syncString(obj)
        return doSuperMethodA(this.stringClass, obj, msg)
      case MUI.MUIM_Cleanup:
        return doSuperMethodA(this.stringClass, obj, msg)
      case MUI.MUIM_HandleInput:
        if ((params[0] ?? 0) === 0x20 && (params[7] ?? 0) === d.gadgetAddress) {
          const window = this.ancestorOf(obj, this.windowClass)
          if (window) this.setInternal(window, MUI.MUIA_Window_ActiveObject, obj.address)
        } else if ((params[0] ?? 0) === 0x40 && (params[7] ?? 0) === d.gadgetAddress && d.state.accepted) {
          d.state.accepted = false
          this.syncString(obj)
          d.acknowledgeAddress = d.bufferAddress
          this.setInternal(obj, MUI.MUIA_String_Acknowledge, d.bufferAddress)
          if ((this.peek(obj, MUI.MUIA_String_AdvanceOnCR) ?? 0) !== 0) this.advanceString(obj)
        }
        return doSuperMethodA(this.stringClass, obj, msg)
      case MUI.MUIM_Export:
        this.stringTransfer(obj, params[0] ?? 0, true)
        return 0
      case MUI.MUIM_Import:
        this.stringTransfer(obj, params[0] ?? 0, false)
        return 0
      case MUIM_STRING_DRAW_BACKGROUND:
        this.redrawArea(obj, 1)
        return 0
      case MUIM_AREA_REDRAW: {
        const answer = doSuperMethodA(this.stringClass, obj, msg)
        this.syncString(obj)
        return answer
      }
      default: return null
    }
  }

  private advanceString(obj: BoopsiObject): void {
    const window = this.ancestorOf(obj, this.windowClass)
    const root = window ? this.windowRoot(window) : null
    if (!window || !root) return
    const cycle: BoopsiObject[] = []
    const visit = (candidate: BoopsiObject): void => {
      if ((this.peek(candidate, MUI.MUIA_CycleChain) ?? 0) !== 0 &&
          (this.peek(candidate, MUI.MUIA_ShowMe) ?? 1) !== 0 &&
          (this.peek(candidate, MUI.MUIA_Disabled) ?? 0) === 0) cycle.push(candidate)
      for (const child of data(this, candidate).children) visit(child)
    }
    visit(root)
    if (cycle.length === 0) return
    const next = cycle[(cycle.indexOf(obj) + 1 + cycle.length) % cycle.length]!
    this.setInternal(window, MUI.MUIA_Window_ActiveObject, next.address)
    if (next.cl.isA(this.stringClass)) {
      const win = window.instData<MuiWindowData>(this.windowClass)
      const gadget = next.instData<MuiStringData>(this.stringClass).gadgetAddress
      if (win.handle !== null) this.windowHost?.activateGadget?.(win.handle, gadget)
    }
  }

  private stringTransfer(obj: BoopsiObject, dataspaceAddress: number, exporting: boolean): void {
    const dataspace = this.boopsi.objectAt(dataspaceAddress)
    if (!dataspace?.cl.isA(this.dataspaceClass)) return
    const id = this.peek(obj, MUI.MUIA_ExportID) ?? 0
    if (id === 0) return
    const d = dataspace.instData<MuiDataspaceData>(this.dataspaceClass)
    if (exporting) {
      const value = obj.instData<MuiStringData>(this.stringClass).state.buffer
      this.dataspaceAddBytes(d, Uint8Array.from([...value, '\0'], (c) => c.charCodeAt(0)), id)
    } else {
      const entry = d.entries.find((candidate) => candidate.id === TAG(id))
      if (entry) this.set(obj, MUI.MUIA_String_Contents, entry.address + 16)
    }
  }

  // -- Prop ---------------------------------------------------------------

  private initProp(obj: BoopsiObject, attrs: readonly TagItem[]): boolean {
    const value = (attr: number, fallback: number): number =>
      attrs.find((item) => TAG(item.tag) === attr)?.data ?? fallback
    const gadgetAddress = this.pool.alloc(44, { clear: true })
    if (gadgetAddress === 0) return false
    data(this, obj).ownedAddresses.push(gadgetAddress)
    const d = obj.instData<MuiPropData>(this.propClass)
    d.gadgetAddress = gadgetAddress
    d.entries = Math.max(0, value(MUI.MUIA_Prop_Entries, 0) | 0)
    d.visible = Math.max(0, value(MUI.MUIA_Prop_Visible, 0) | 0)
    d.first = value(MUI.MUIA_Prop_First, 0) | 0
    d.horizontal = value(MUI.MUIA_Prop_Horiz, 0) !== 0
    d.slider = value(MUI.MUIA_Prop_Slider, 0) !== 0
    d.useWinBorder = value(MUI.MUIA_Prop_UseWinBorder, MUI.MUIV_Prop_UseWinBorder_None) | 0
    d.deltaFactor = 1
    d.state = { flags: 1, horizPot: 0, vertPot: 0, horizBody: 0xffff, vertBody: 0xffff }
    const stored = data(this, obj).attrs
    stored.set(MUI.MUIA_Gadget_Gadget, gadgetAddress)
    stored.set(MUI.MUIA_Prop_Entries, d.entries)
    stored.set(MUI.MUIA_Prop_Visible, d.visible)
    stored.set(MUI.MUIA_Prop_First, d.first)
    stored.set(MUI.MUIA_Prop_Horiz, d.horizontal ? 1 : 0)
    stored.set(MUI.MUIA_Prop_Slider, d.slider ? 1 : 0)
    stored.set(MUI.MUIA_Prop_UseWinBorder, d.useWinBorder)
    const gadget = obj.instData<MuiGadgetData>(this.gadgetClass)
    gadget.gadget = gadgetAddress
    this.syncProp(obj, false)
    return true
  }

  private syncProp(obj: BoopsiObject, fromGadget: boolean): void {
    const d = obj.instData<MuiPropData>(this.propClass)
    const limit = Math.max(0, d.entries - d.visible)
    if (fromGadget) {
      const pot = d.horizontal ? d.state.horizPot : d.state.vertPot
      d.first = limit === 0 ? 0 : Math.round((pot * limit) / 0xffff)
    }
    d.first = Math.max(0, Math.min(limit, d.first))
    const pot = limit === 0 ? 0 : Math.round((d.first * 0xffff) / limit)
    const body = d.entries <= 0 ? 0xffff : Math.min(0xffff, Math.round((d.visible * 0xffff) / d.entries))
    d.state.flags = 1 | (d.horizontal ? 2 : 4)
    d.state.horizPot = d.horizontal ? pot : 0
    d.state.vertPot = d.horizontal ? 0 : pot
    d.state.horizBody = d.horizontal ? body : 0xffff
    d.state.vertBody = d.horizontal ? 0xffff : body
    this.windowHost?.configurePropGadget?.(d.gadgetAddress, d.state, d.horizontal)
  }

  private setProp(obj: BoopsiObject, cl: BoopsiClass, msg: OpSet): number {
    const d = obj.instData<MuiPropData>(cl)
    const before = { entries: d.entries, visible: d.visible, first: d.first, slider: d.slider }
    const rest: TagItem[] = []
    let own = 0
    for (const attr of msg.attrs) {
      switch (TAG(attr.tag)) {
        case MUI.MUIA_Prop_Entries: d.entries = Math.max(0, attr.data | 0); own++; break
        case MUI.MUIA_Prop_Visible: d.visible = Math.max(0, attr.data | 0); own++; break
        case MUI.MUIA_Prop_First: d.first = attr.data | 0; own++; break
        case MUI.MUIA_Prop_Slider:
          d.slider = attr.data !== 0
          own++
          break
        default: rest.push(attr)
      }
    }
    this.syncProp(obj, false)
    if (d.entries !== before.entries) this.setInternal(obj, MUI.MUIA_Prop_Entries, d.entries)
    if (d.visible !== before.visible) this.setInternal(obj, MUI.MUIA_Prop_Visible, d.visible)
    if (d.first !== before.first) this.setInternal(obj, MUI.MUIA_Prop_First, d.first)
    if (d.slider !== before.slider) this.setInternal(obj, MUI.MUIA_Prop_Slider, d.slider ? 1 : 0)
    if (own !== 0) this.redrawArea(obj, 1)
    return own + doSuperMethodA(cl, obj, { ...msg, attrs: rest } as OpSet)
  }

  private getProp(obj: BoopsiObject, msg: OpGet): number {
    const d = obj.instData<MuiPropData>(this.propClass)
    this.syncProp(obj, true)
    switch (TAG(msg.attrID)) {
      case MUI.MUIA_Prop_Entries: msg.storage = d.entries; return 1
      case MUI.MUIA_Prop_Visible: msg.storage = d.visible; return 1
      case MUI.MUIA_Prop_First: msg.storage = d.first; return 1
      case MUI.MUIA_Prop_Horiz: msg.storage = d.horizontal ? 1 : 0; return 1
      case MUI.MUIA_Prop_Slider: msg.storage = d.slider ? 1 : 0; return 1
      default: return 0
    }
  }

  private propMethod(obj: BoopsiObject, msg: Msg): number | null {
    const params = (msg as Msg & { params?: readonly number[] }).params ?? []
    const d = obj.instData<MuiPropData>(this.propClass)
    switch (msg.MethodID) {
      case MUI.MUIM_Setup:
        this.syncProp(obj, false)
        return doSuperMethodA(this.propClass, obj, msg)
      case MUI.MUIM_Cleanup:
        return doSuperMethodA(this.propClass, obj, msg)
      case MUI.MUIM_HandleInput: {
        const cls = params[0] ?? 0
        if ((cls === 0x20 || cls === 0x40 || cls === 0x200) && (params[7] ?? 0) === d.gadgetAddress) {
          const old = d.first
          this.syncProp(obj, true)
          if (d.first !== old) this.setInternal(obj, MUI.MUIA_Prop_First, d.first)
        }
        return doSuperMethodA(this.propClass, obj, msg)
      }
      case MUI.MUIM_Prop_Increase:
        this.set(obj, MUI.MUIA_Prop_First, d.first + (params[0] ?? 0))
        return 0
      case MUI.MUIM_Prop_Decrease:
        this.set(obj, MUI.MUIA_Prop_First, d.first - (params[0] ?? 0))
        return 0
      default: return null
    }
  }

  // -- List ---------------------------------------------------------------

  private initList(obj: BoopsiObject, attrs: readonly TagItem[]): void {
    const value = (attr: number, fallback: number): number =>
      attrs.find((item) => TAG(item.tag) === attr)?.data ?? fallback
    const d = obj.instData<MuiListData>(this.listClass)
    d.entries = []
    d.active = MUI.MUIV_List_Active_Off | 0
    d.first = 0
    d.visible = -1
    d.insertPosition = -1
    d.dropMark = -1
    d.quiet = false
    d.dirty = true
    d.lineHeight = Math.max(this.fontY, value(MUI.MUIA_List_MinLineHeight, 0) | 0)
    d.imageHandles = new Map()
    d.dragImageHandle = 0
    const stored = data(this, obj).attrs
    stored.set(MUI.MUIA_List_Active, d.active)
    stored.set(MUI.MUIA_List_AutoVisible, value(MUI.MUIA_List_AutoVisible, 0) !== 0 ? 1 : 0)
    stored.set(MUI.MUIA_List_CompareHook, value(MUI.MUIA_List_CompareHook, 0))
    stored.set(MUI.MUIA_List_ConstructHook, value(MUI.MUIA_List_ConstructHook, 0))
    stored.set(MUI.MUIA_List_DestructHook, value(MUI.MUIA_List_DestructHook, 0))
    stored.set(MUI.MUIA_List_DisplayHook, value(MUI.MUIA_List_DisplayHook, 0))
    stored.set(MUI.MUIA_List_DragSortable, value(MUI.MUIA_List_DragSortable, 0) !== 0 ? 1 : 0)
    stored.set(MUI.MUIA_List_DropMark, -1)
    stored.set(MUI.MUIA_List_Entries, 0)
    stored.set(MUI.MUIA_List_First, 0)
    stored.set(MUI.MUIA_List_Format, value(MUI.MUIA_List_Format, 0))
    stored.set(MUI.MUIA_List_InsertPosition, -1)
    stored.set(MUI.MUIA_List_MultiTestHook, value(MUI.MUIA_List_MultiTestHook, 0))
    stored.set(MUI.MUIA_List_ShowDropMarks, value(MUI.MUIA_List_ShowDropMarks, 1) !== 0 ? 1 : 0)
    stored.set(MUI.MUIA_List_Title, value(MUI.MUIA_List_Title, 0))
    stored.set(MUI.MUIA_List_Visible, -1)
    const source = value(MUI.MUIA_List_SourceArray, 0)
    if (source !== 0 && this.readLong) {
      for (let i = 0; ; i++) {
        const address = this.readLong(source + i * 4) ?? 0
        if (address === 0) break
        this.listInsertOne(obj, address, d.entries.length, false)
      }
    }
  }

  private listCopyEntry(obj: BoopsiObject, address: number): MuiListEntry | null {
    const construct = this.peek(obj, MUI.MUIA_List_ConstructHook) ?? 0
    if ((construct >>> 0) !== MUI.MUIV_List_ConstructHook_String) return { address, selected: false, owned: false }
    const text = this.textOfAddress(address)
    const copy = this.pool.alloc(text.length + 1, { clear: true })
    if (copy === 0) return null
    for (let i = 0; i < text.length; i++) this.pool.buffer[copy - this.pool.base + i] = text.charCodeAt(i)
    return { address: copy, selected: false, owned: true }
  }

  private listFreeEntry(entry: MuiListEntry): void {
    if (entry.owned) this.pool.freeMem(entry.address)
  }

  private listInsertOne(obj: BoopsiObject, address: number, position: number, sorted: boolean): number {
    const d = obj.instData<MuiListData>(this.listClass)
    const entry = this.listCopyEntry(obj, address)
    if (!entry) return -1
    let at = Math.max(0, Math.min(d.entries.length, position))
    if (sorted) {
      const key = this.textOfAddress(entry.address).toLocaleLowerCase()
      at = d.entries.findIndex((item) => this.textOfAddress(item.address).toLocaleLowerCase() > key)
      if (at < 0) at = d.entries.length
    }
    d.entries.splice(at, 0, entry)
    if (d.active >= at) d.active++
    d.insertPosition = at
    this.listChanged(obj)
    return at
  }

  private listChanged(obj: BoopsiObject): void {
    const d = obj.instData<MuiListData>(this.listClass)
    d.active = d.entries.length === 0 ? -1 : Math.max(-1, Math.min(d.entries.length - 1, d.active))
    const maxFirst = Math.max(0, d.entries.length - Math.max(0, d.visible))
    d.first = Math.max(0, Math.min(maxFirst, d.first))
    d.dirty = true
    this.setInternal(obj, MUI.MUIA_List_Entries, d.entries.length)
    this.setInternal(obj, MUI.MUIA_List_Active, d.active)
    this.setInternal(obj, MUI.MUIA_List_First, d.first)
    this.setInternal(obj, MUI.MUIA_List_InsertPosition, d.insertPosition)
    if (!d.quiet) this.redrawArea(obj, 1)
  }

  private clearList(obj: BoopsiObject, disposing = false): void {
    const d = obj.instData<MuiListData>(this.listClass)
    for (const entry of d.entries) this.listFreeEntry(entry)
    d.entries = []
    for (const [handle, image] of d.imageHandles) {
      this.doMui(image, MUI.MUIM_Cleanup)
      this.pool.freeMem(handle)
    }
    d.imageHandles.clear()
    if (d.dragImageHandle !== 0) this.pool.freeMem(d.dragImageHandle)
    d.dragImageHandle = 0
    d.active = -1
    d.first = 0
    d.insertPosition = -1
    if (!disposing) this.listChanged(obj)
  }

  private setList(obj: BoopsiObject, cl: BoopsiClass, msg: OpSet): number {
    const d = obj.instData<MuiListData>(cl)
    const rest: TagItem[] = []
    let own = 0
    for (const attr of msg.attrs) {
      const id = TAG(attr.tag)
      switch (id) {
        case MUI.MUIA_List_Active: {
          const old = d.active
          d.active = this.listActivePosition(d, attr.data | 0)
          if (d.active !== old) this.setInternal(obj, id, d.active)
          if ((this.peek(obj, MUI.MUIA_List_AutoVisible) ?? 0) !== 0) this.listJump(obj, d.active)
          own++
          break
        }
        case MUI.MUIA_List_First: {
          const visible = Math.max(0, d.visible)
          d.first = Math.max(0, Math.min(Math.max(0, d.entries.length - visible), this.signed(attr.data)))
          this.setInternal(obj, id, d.first)
          d.dirty = true
          own++
          break
        }
        case MUI.MUIA_List_Quiet:
          d.quiet = attr.data !== 0
          if (!d.quiet && d.dirty) this.redrawArea(obj, 1)
          own++
          break
        case MUI.MUIA_List_Format:
        case MUI.MUIA_List_Title:
        case MUI.MUIA_List_CompareHook:
        case MUI.MUIA_List_ConstructHook:
        case MUI.MUIA_List_DestructHook:
        case MUI.MUIA_List_DisplayHook:
        case MUI.MUIA_List_MultiTestHook:
        case MUI.MUIA_List_AutoVisible:
        case MUI.MUIA_List_DragSortable:
        case MUI.MUIA_List_ShowDropMarks:
          this.setInternal(obj, id, attr.data)
          d.dirty = true
          own++
          break
        default: rest.push(attr)
      }
    }
    return own + doSuperMethodA(cl, obj, { ...msg, attrs: rest } as OpSet)
  }

  private getList(obj: BoopsiObject, msg: OpGet): number {
    const d = obj.instData<MuiListData>(this.listClass)
    switch (TAG(msg.attrID)) {
      case MUI.MUIA_List_Active: msg.storage = d.active; return 1
      case MUI.MUIA_List_Entries: msg.storage = d.entries.length; return 1
      case MUI.MUIA_List_First: msg.storage = d.visible < 0 ? -1 : d.first; return 1
      case MUI.MUIA_List_Visible: msg.storage = d.visible; return 1
      case MUI.MUIA_List_InsertPosition: msg.storage = d.insertPosition; return 1
      case MUI.MUIA_List_DropMark: msg.storage = d.dropMark; return 1
      default: return 0
    }
  }

  private listActivePosition(d: MuiListData, requested: number): number {
    if (d.entries.length === 0 || requested === (MUI.MUIV_List_Active_Off | 0)) return -1
    switch (requested) {
      case -2: return 0
      case -3: return d.entries.length - 1
      case -4: return Math.max(0, d.active - 1)
      case -5: return Math.min(d.entries.length - 1, d.active + 1)
      case -6: return Math.max(0, d.active - Math.max(1, d.visible))
      case -7: return Math.min(d.entries.length - 1, d.active + Math.max(1, d.visible))
      default: return Math.max(0, Math.min(d.entries.length - 1, requested))
    }
  }

  private listIndex(d: MuiListData, requested: number, second = false): number {
    if (requested >= 0) return Math.max(0, Math.min(d.entries.length - 1, requested))
    if (requested === -1) return d.active
    if (requested === -2) return d.entries.length - 1
    if (requested === -3 && second) return Math.min(d.entries.length - 1, d.active + 1)
    if (requested === -4 && second) return Math.max(0, d.active - 1)
    return -1
  }

  private listJump(obj: BoopsiObject, requested: number): void {
    const d = obj.instData<MuiListData>(this.listClass)
    const at = requested === -1 ? d.active : requested === -2 ? d.entries.length - 1 :
      requested === -3 ? d.first + 1 : requested === -4 ? d.first - 1 : requested
    if (at < 0 || d.visible <= 0) return
    if (at < d.first) d.first = at
    else if (at >= d.first + d.visible) d.first = at - d.visible + 1
    d.first = Math.max(0, Math.min(Math.max(0, d.entries.length - d.visible), d.first))
    this.setInternal(obj, MUI.MUIA_List_First, d.first)
    this.redrawArea(obj, 1)
  }

  private listMethod(obj: BoopsiObject, msg: Msg): number | null {
    const p = (msg as Msg & { params?: readonly number[] }).params ?? []
    const d = obj.instData<MuiListData>(this.listClass)
    switch (msg.MethodID) {
      case MUI.MUIM_Setup:
        d.lineHeight = Math.max(this.fontY, this.peek(obj, MUI.MUIA_List_MinLineHeight) ?? 0)
        return doSuperMethodA(this.listClass, obj, msg)
      case MUI.MUIM_Cleanup:
        d.visible = -1
        this.setInternal(obj, MUI.MUIA_List_Visible, -1)
        return doSuperMethodA(this.listClass, obj, msg)
      case MUI.MUIM_Show: {
        const answer = doSuperMethodA(this.listClass, obj, msg)
        this.updateListVisible(obj)
        if ((this.peek(obj, MUI.MUIA_List_AutoVisible) ?? 0) !== 0) this.listJump(obj, d.active)
        return answer
      }
      case MUI.MUIM_Hide:
        d.visible = -1
        this.setInternal(obj, MUI.MUIA_List_Visible, -1)
        return doSuperMethodA(this.listClass, obj, msg)
      case MUI.MUIM_Draw:
        doSuperMethodA(this.listClass, obj, msg)
        this.drawList(obj)
        return 0
      case MUIM_LIST_LAYOUT: {
        const answer = doSuperMethodA(this.listClass, obj, msg)
        this.updateListVisible(obj)
        return answer
      }
      case MUI.MUIM_List_GetEntry: {
        const at = (p[0] ?? 0) === MUI.MUIV_List_GetEntry_Active ? d.active : (p[0] ?? 0) | 0
        this.writeLong?.(p[1] ?? 0, at >= 0 && at < d.entries.length ? d.entries[at]!.address : 0)
        return 0
      }
      case MUI.MUIM_List_Insert: {
        const source = p[0] ?? 0
        const count = (p[1] ?? 0) | 0
        const requested = (p[2] ?? 0) | 0
        const sorted = requested === (MUI.MUIV_List_Insert_Sorted | 0)
        let at = requested === (MUI.MUIV_List_Insert_Active | 0) ? Math.max(0, d.active) :
          requested === (MUI.MUIV_List_Insert_Bottom | 0) || sorted ? d.entries.length : requested
        const limit = count < 0 ? Number.MAX_SAFE_INTEGER : count
        for (let i = 0; i < limit; i++) {
          const entry = this.readLong?.(source + i * 4) ?? 0
          if (entry === 0 && count < 0) break
          if (entry !== 0) {
            const inserted = this.listInsertOne(obj, entry, at, sorted)
            if (!sorted && inserted >= 0) at = inserted + 1
          }
        }
        return 0
      }
      case MUI.MUIM_List_InsertSingle: {
        const requested = (p[1] ?? 0) | 0
        const sorted = requested === (MUI.MUIV_List_Insert_Sorted | 0)
        const at = requested === (MUI.MUIV_List_Insert_Active | 0) ? Math.max(0, d.active) :
          requested === (MUI.MUIV_List_Insert_Bottom | 0) || sorted ? d.entries.length : requested
        this.listInsertOne(obj, p[0] ?? 0, at, sorted)
        return 0
      }
      case MUI.MUIM_List_Remove:
        this.listRemove(obj, (p[0] ?? 0) | 0)
        return 0
      case MUI.MUIM_List_Clear:
        this.clearList(obj)
        return 0
      case MUI.MUIM_List_Sort:
        this.listSort(obj)
        return 0
      case MUI.MUIM_List_Jump:
        this.listJump(obj, (p[0] ?? 0) | 0)
        return 0
      case MUI.MUIM_List_Redraw:
        d.dirty = true
        if (!d.quiet) this.redrawArea(obj, 1)
        return 0
      case MUI.MUIM_List_Select:
        return this.listSelect(obj, (p[0] ?? 0) | 0, (p[1] ?? 0) | 0, p[2] ?? 0)
      case MUI.MUIM_List_Exchange:
        this.listExchange(obj, (p[0] ?? 0) | 0, (p[1] ?? 0) | 0, false)
        return 0
      case MUI.MUIM_List_Move:
        this.listExchange(obj, (p[0] ?? 0) | 0, (p[1] ?? 0) | 0, true)
        return 0
      case MUI.MUIM_List_NextSelected:
        return this.listNextSelected(obj, p[0] ?? 0)
      case MUI.MUIM_List_TestPos:
        this.listTestPos(obj, (p[0] ?? 0) | 0, (p[1] ?? 0) | 0, p[2] ?? 0)
        return 1
      case MUI.MUIM_List_CreateImage: {
        const image = this.boopsi.objectAt(p[0] ?? 0)
        if (!image) return 0
        if (this.doMui(image, MUI.MUIM_Setup) === 0) return 0
        const handle = this.pool.alloc(8, { clear: true })
        if (handle !== 0) d.imageHandles.set(handle, image)
        else this.doMui(image, MUI.MUIM_Cleanup)
        return handle
      }
      case MUI.MUIM_List_DeleteImage: {
        const handle = p[0] ?? 0
        const image = d.imageHandles.get(handle)
        if (image) {
          this.doMui(image, MUI.MUIM_Cleanup)
          d.imageHandles.delete(handle)
          this.pool.freeMem(handle)
        }
        return 0
      }
      case MUIM_LIST_SET_DROP_MARK:
        this.listSetDropMark(obj, (p[0] ?? -1) | 0)
        return 0
      case MUIM_LIST_CREATE_DRAG_IMAGE:
        if (d.dragImageHandle === 0) d.dragImageHandle = this.pool.alloc(8, { clear: true })
        return d.dragImageHandle
      case MUIM_LIST_DELETE_DRAG_IMAGE:
        if (d.dragImageHandle !== 0) this.pool.freeMem(d.dragImageHandle)
        d.dragImageHandle = 0
        return 0
      case MUIM_LIST_COLUMN_OFFSET:
        return (p[0] ?? 0) === 0 ? 0 : -1
      case MUI.MUIM_Export:
        this.listTransfer(obj, p[0] ?? 0, true)
        return 0
      case MUI.MUIM_Import:
        this.listTransfer(obj, p[0] ?? 0, false)
        return 0
      case MUI.MUIM_HandleInput:
        return this.handleListInput(obj, p, msg)
      case MUI.MUIM_DragQuery:
        return (p[0] ?? 0) === obj.address && (this.peek(obj, MUI.MUIA_List_DragSortable) ?? 0) !== 0
          ? MUI.MUIV_DragQuery_Accept : MUI.MUIV_DragQuery_Refuse
      case MUI.MUIM_DragBegin:
        d.dropMark = d.active < 0 ? d.entries.length : d.active
        this.setInternal(obj, MUI.MUIA_List_DropMark, d.dropMark)
        return 1
      case MUI.MUIM_DragReport:
        if ((p[3] ?? 0) === 0) return MUI.MUIV_DragReport_Refresh
        this.listDropMarkAt(obj, (p[1] ?? 0) | 0, (p[2] ?? 0) | 0)
        return MUI.MUIV_DragReport_Lock
      case MUI.MUIM_DragFinish:
        d.dropMark = -1
        this.setInternal(obj, MUI.MUIA_List_DropMark, -1)
        return 0
      case MUI.MUIM_DragDrop:
        return this.listDragDrop(obj, p[0] ?? 0)
      default: return null
    }
  }

  private listSetDropMark(obj: BoopsiObject, requested: number): void {
    const d = obj.instData<MuiListData>(this.listClass)
    const mark = Math.max(-1, Math.min(d.entries.length, requested))
    if (mark === d.dropMark) return
    d.dropMark = mark
    this.setInternal(obj, MUI.MUIA_List_DropMark, mark)
    if (mark >= 0) this.listJump(obj, Math.min(mark, Math.max(0, d.entries.length - 1)))
    this.redrawArea(obj, 1)
  }

  private listDropMarkAt(obj: BoopsiObject, x: number, y: number): void {
    const d = obj.instData<MuiListData>(this.listClass)
    const box = this.boxOf(obj)
    if (!box || x < box.left || x >= box.left + box.width) return
    const titleRows = (this.peek(obj, MUI.MUIA_List_Title) ?? 0) !== 0 ? 1 : 0
    const relative = y - box.top - titleRows * d.lineHeight
    const row = Math.floor(relative / Math.max(1, d.lineHeight))
    const lowerHalf = relative - row * d.lineHeight > d.lineHeight / 2
    this.listSetDropMark(obj, Math.max(0, Math.min(d.entries.length, d.first + row + (lowerHalf ? 1 : 0))))
  }

  private updateListVisible(obj: BoopsiObject): void {
    const d = obj.instData<MuiListData>(this.listClass)
    const box = this.boxOf(obj)
    if (!box) return
    const titleRows = (this.peek(obj, MUI.MUIA_List_Title) ?? 0) !== 0 ? 1 : 0
    d.visible = Math.max(0, Math.floor(box.height / Math.max(1, d.lineHeight)) - titleRows)
    this.setInternal(obj, MUI.MUIA_List_Visible, d.visible)
    d.first = Math.min(d.first, Math.max(0, d.entries.length - d.visible))
    this.setInternal(obj, MUI.MUIA_List_First, d.first)
  }

  private listRemove(obj: BoopsiObject, requested: number): void {
    const d = obj.instData<MuiListData>(this.listClass)
    if (requested === (MUI.MUIV_List_Remove_Selected | 0)) {
      for (let i = d.entries.length - 1; i >= 0; i--) if (d.entries[i]!.selected) {
        this.listFreeEntry(d.entries[i]!)
        d.entries.splice(i, 1)
      }
    } else {
      const at = requested === (MUI.MUIV_List_Remove_Active | 0) ? d.active :
        requested === (MUI.MUIV_List_Remove_Last | 0) ? d.entries.length - 1 : requested
      if (at < 0 || at >= d.entries.length) return
      this.listFreeEntry(d.entries[at]!)
      d.entries.splice(at, 1)
      if (d.active >= d.entries.length) d.active = d.entries.length - 1
    }
    this.listChanged(obj)
  }

  private listSort(obj: BoopsiObject): void {
    const d = obj.instData<MuiListData>(this.listClass)
    const active = d.entries[d.active]
    if ((this.peek(obj, MUI.MUIA_List_CompareHook) ?? 0) === 0) {
      d.entries.sort((a, b) => this.textOfAddress(a.address).localeCompare(this.textOfAddress(b.address), undefined, { sensitivity: 'accent' }))
    }
    d.active = active ? d.entries.indexOf(active) : -1
    this.listChanged(obj)
  }

  private listSelect(obj: BoopsiObject, requested: number, kind: number, stateAddress: number): number {
    const d = obj.instData<MuiListData>(this.listClass)
    const indexes = requested === (MUI.MUIV_List_Select_All | 0)
      ? d.entries.map((_, i) => i)
      : [requested === (MUI.MUIV_List_Select_Active | 0) ? d.active : requested]
    if (kind === MUI.MUIV_List_Select_Ask && requested === (MUI.MUIV_List_Select_All | 0)) {
      this.writeLong?.(stateAddress, d.entries.filter((entry) => entry.selected).length)
      return 1
    }
    for (const at of indexes) if (at >= 0 && at < d.entries.length) {
      const entry = d.entries[at]!
      if (kind === MUI.MUIV_List_Select_On) entry.selected = true
      else if (kind === MUI.MUIV_List_Select_Off) entry.selected = false
      else if (kind === MUI.MUIV_List_Select_Toggle) entry.selected = !entry.selected
      if (stateAddress !== 0) this.writeLong?.(stateAddress, entry.selected ? 1 : 0)
    }
    if (kind !== MUI.MUIV_List_Select_Ask) this.redrawArea(obj, 1)
    return indexes.some((at) => at >= 0 && at < d.entries.length) ? 1 : 0
  }

  private listExchange(obj: BoopsiObject, fromValue: number, toValue: number, move: boolean): void {
    const d = obj.instData<MuiListData>(this.listClass)
    const from = this.listIndex(d, fromValue)
    const to = this.listIndex(d, toValue, true)
    if (from < 0 || to < 0 || from === to) return
    const active = d.entries[d.active]
    if (move) d.entries.splice(to, 0, d.entries.splice(from, 1)[0]!)
    else [d.entries[from], d.entries[to]] = [d.entries[to]!, d.entries[from]!]
    d.active = active ? d.entries.indexOf(active) : -1
    this.listChanged(obj)
  }

  private listNextSelected(obj: BoopsiObject, address: number): number {
    const d = obj.instData<MuiListData>(this.listClass)
    const selected = d.entries.some((entry) => entry.selected)
    const previous = (this.readLong?.(address) ?? -1) | 0
    let found = -1
    for (let i = previous + 1; i < d.entries.length; i++) {
      if (selected ? d.entries[i]!.selected : i === d.active) { found = i; break }
    }
    this.writeLong?.(address, found)
    return found >= 0 ? 1 : 0
  }

  private listTestPos(obj: BoopsiObject, x: number, y: number, address: number): void {
    if (address === 0) return
    const d = obj.instData<MuiListData>(this.listClass)
    const box = this.boxOf(obj)
    let entry = -1
    let flags = 0
    let yoff = 0
    if (box) {
      if (y < box.top) flags |= 1
      else if (y >= box.top + box.height) flags |= 2
      if (x < box.left) flags |= 4
      else if (x >= box.left + box.width) flags |= 8
      const titleRows = (this.peek(obj, MUI.MUIA_List_Title) ?? 0) !== 0 ? 1 : 0
      const row = Math.floor((y - box.top) / Math.max(1, d.lineHeight)) - titleRows
      if (flags === 0 && row >= 0 && row < d.visible && d.first + row < d.entries.length) {
        entry = d.first + row
        yoff = (y - box.top - (row + titleRows) * d.lineHeight) - Math.floor(d.lineHeight / 2)
      }
    }
    const bytes = new Uint8Array(12)
    const view = new DataView(bytes.buffer)
    view.setInt32(0, entry, false)
    view.setInt16(4, entry < 0 ? -1 : 0, false)
    view.setUint16(6, flags, false)
    view.setInt16(8, box ? x - box.left : 0, false)
    view.setInt16(10, yoff, false)
    this.writeMemory?.(address, bytes)
  }

  private drawList(obj: BoopsiObject): void {
    const window = this.ancestorOf(obj, this.windowClass)
    const box = this.boxOf(obj)
    if (!window || !box) return
    const handle = window.instData<MuiWindowData>(this.windowClass).handle
    if (handle === null) return
    const d = obj.instData<MuiListData>(this.listClass)
    this.updateListVisible(obj)
    const end = Math.min(d.entries.length, d.first + Math.max(0, d.visible))
    this.windowHost?.drawList?.(handle, {
      ...box,
      title: this.textOf(obj, MUI.MUIA_List_Title),
      rows: d.entries.slice(d.first, end).map((entry, index) => ({
        text: this.textOfAddress(entry.address),
        active: d.first + index === d.active,
        selected: entry.selected,
      })),
      first: d.first,
      lineHeight: d.lineHeight,
      disabled: (this.peek(obj, MUI.MUIA_Disabled) ?? 0) !== 0,
    })
    d.dirty = false
  }

  private handleListInput(obj: BoopsiObject, params: readonly number[], msg: Msg): number {
    const cls = params[0] ?? 0
    if (cls === 0x8) {
      const d = obj.instData<MuiListData>(this.listClass)
      const box = this.boxOf(obj)
      if (box) {
        const titleRows = (this.peek(obj, MUI.MUIA_List_Title) ?? 0) !== 0 ? 1 : 0
        const row = Math.floor(((params[4] ?? 0) - box.top) / Math.max(1, d.lineHeight)) - titleRows
        const at = d.first + row
        if (row >= 0 && at < d.entries.length) {
          d.active = at
          this.setInternal(obj, MUI.MUIA_List_Active, at)
          this.redrawArea(obj, 1)
        }
      }
    }
    return doSuperMethodA(this.listClass, obj, msg)
  }

  private listTransfer(obj: BoopsiObject, dataspaceAddress: number, exporting: boolean): void {
    const dataspace = this.boopsi.objectAt(dataspaceAddress)
    if (!dataspace?.cl.isA(this.dataspaceClass)) return
    const id = this.peek(obj, MUI.MUIA_ExportID) ?? 0
    if (id === 0) return
    const d = dataspace.instData<MuiDataspaceData>(this.dataspaceClass)
    if (exporting) {
      const value = obj.instData<MuiListData>(this.listClass).active
      const bytes = Uint8Array.of(value >>> 24, value >>> 16, value >>> 8, value)
      this.dataspaceAddBytes(d, bytes, id)
    } else {
      const entry = d.entries.find((candidate) => candidate.id === TAG(id))
      if (entry && entry.length >= 4) this.set(obj, MUI.MUIA_List_Active, this.poolLong(entry.address - this.pool.base + 16))
    }
  }

  private listDragDrop(obj: BoopsiObject, sourceAddress: number): number {
    const source = this.boopsi.objectAt(sourceAddress)
    if (!source?.cl.isA(this.listClass)) return 0
    const target = obj.instData<MuiListData>(this.listClass)
    const from = source.instData<MuiListData>(this.listClass)
    const moving = from.entries.filter((entry) => entry.selected || (!from.entries.some((item) => item.selected) && from.entries.indexOf(entry) === from.active))
    let at = target.dropMark < 0 ? target.entries.length : target.dropMark
    for (const entry of moving) this.listInsertOne(obj, entry.address, at++, false)
    if (source === obj && (this.peek(obj, MUI.MUIA_List_DragSortable) ?? 0) !== 0) {
      for (const entry of moving) {
        const index = from.entries.indexOf(entry)
        if (index >= 0) {
          from.entries.splice(index, 1)
          this.listFreeEntry(entry)
        }
      }
      this.listChanged(source)
    }
    target.dropMark = -1
    this.setInternal(obj, MUI.MUIA_List_DropMark, -1)
    return 1
  }

  private setGadget(obj: BoopsiObject, cl: BoopsiClass, msg: OpSet): number {
    const gadget = obj.instData<MuiGadgetData>(cl)
    const attrs: TagItem[] = []
    let own = 0
    for (const attr of msg.attrs) {
      if (TAG(attr.tag) === MUI.MUIA_Gadget_Gadget) {
        if (gadget.attached && gadget.handle !== null) this.windowHost?.hideGadget?.(gadget.handle, gadget.gadget)
        gadget.gadget = attr.data
        data(this, obj).attrs.set(MUI.MUIA_Gadget_Gadget, attr.data)
        own++
        if (gadget.attached && gadget.handle !== null && gadget.gadget !== 0) {
          const box = this.gadgetBox(obj)
          if (box) this.windowHost?.showGadget?.(gadget.handle, gadget.gadget, box, (this.peek(obj, MUI.MUIA_Disabled) ?? 0) !== 0)
        }
      } else if (TAG(attr.tag) === MUIA_GADGET_ACTIVE) {
        gadget.active = attr.data !== 0
        own++
      } else attrs.push(attr)
    }
    return own + doSuperMethodA(cl, obj, { ...msg, attrs } as OpSet)
  }

  private gadgetMethod(obj: BoopsiObject, msg: Msg): number | null {
    const gadget = obj.instData<MuiGadgetData>(this.gadgetClass)
    switch (msg.MethodID) {
      case MUI.MUIM_Show: {
        const answer = doSuperMethodA(this.gadgetClass, obj, msg)
        if (answer === 0) return 0
        const window = this.ancestorOf(obj, this.windowClass)
        const box = this.gadgetBox(obj)
        const handle = window?.instData<MuiWindowData>(this.windowClass).handle ?? null
        gadget.handle = handle
        if (handle !== null && box && gadget.gadget !== 0) {
          this.windowHost?.showGadget?.(handle, gadget.gadget, box, (this.peek(obj, MUI.MUIA_Disabled) ?? 0) !== 0)
          gadget.attached = true
        }
        return 1
      }
      case MUI.MUIM_Hide:
        if (gadget.attached && gadget.handle !== null && gadget.gadget !== 0) this.windowHost?.hideGadget?.(gadget.handle, gadget.gadget)
        gadget.attached = false
        gadget.handle = null
        return doSuperMethodA(this.gadgetClass, obj, msg)
      case MUI.MUIM_Draw:
        doSuperMethodA(this.gadgetClass, obj, msg)
        if (gadget.attached && gadget.handle !== null && gadget.gadget !== 0) this.windowHost?.refreshGadget?.(gadget.handle, gadget.gadget)
        return 0
      case MUIM_AREA_REDRAW:
        if (!gadget.attached || gadget.handle === null || gadget.gadget === 0) return 0
        this.windowHost?.refreshGadget?.(gadget.handle, gadget.gadget)
        return 1
      case MUIM_AREA_DEACTIVATE:
        if (gadget.attached && gadget.handle !== null && gadget.gadget !== 0) this.windowHost?.refreshGadget?.(gadget.handle, gadget.gadget)
        gadget.active = false
        return 0
      default: return null
    }
  }

  /** `_mleft/_mtop/_mwidth/_mheight`: Area's box after frame/inner padding. */
  private gadgetBox(obj: BoopsiObject): Box | null {
    const box = this.boxOf(obj)
    if (!box) return null
    const inner = this.innerOf(obj)
    return {
      left: box.left + inner.left,
      top: box.top + inner.top,
      width: Math.max(0, box.width - inner.left - inner.right),
      height: Math.max(0, box.height - inner.top - inner.bottom),
    }
  }

  // -- Balance ------------------------------------------------------------

  private balanceMethod(obj: BoopsiObject, msg: Msg): number | null {
    const params = (msg as Msg & { params?: readonly number[] }).params ?? []
    const balance = obj.instData<MuiBalanceData>(this.balanceClass)
    switch (msg.MethodID) {
      case MUI.MUIM_Setup: {
        const answer = doSuperMethodA(this.balanceClass, obj, msg)
        balance.dragging = false
        return answer
      }
      case MUI.MUIM_Cleanup:
        balance.dragging = false
        return doSuperMethodA(this.balanceClass, obj, msg)
      case MUI.MUIM_Draw:
        doSuperMethodA(this.balanceClass, obj, msg)
        this.drawBalance(obj)
        return 0
      case MUI.MUIM_HandleInput:
      case MUI.MUIM_HandleEvent:
        return this.handleBalanceInput(obj, params)
      default: return null
    }
  }

  private balanceHorizontalGroup(obj: BoopsiObject): boolean {
    const parent = data(this, obj).parent
    return !!parent?.cl.isA(this.groupClass) && (this.peek(parent, MUI.MUIA_Group_Horiz) ?? 0) !== 0
  }

  private drawBalance(obj: BoopsiObject): void {
    const window = this.ancestorOf(obj, this.windowClass)
    const box = this.boxOf(obj)
    if (!window || !box) return
    const handle = window.instData<MuiWindowData>(this.windowClass).handle
    if (handle === null) return
    this.windowHost?.drawBalance?.(handle, {
      ...box,
      horizontalGroup: this.balanceHorizontalGroup(obj),
      dragging: obj.instData<MuiBalanceData>(this.balanceClass).dragging,
    })
  }

  private handleBalanceInput(obj: BoopsiObject, params: readonly number[]): number {
    const balance = obj.instData<MuiBalanceData>(this.balanceClass)
    const cls = params[0] ?? 0
    const code = params[1] ?? 0
    const x = this.signed(params[3] ?? 0)
    const y = this.signed(params[4] ?? 0)
    if (cls === IDCMP_MOUSEBUTTONS && code === 0x68 && this.areaAt(obj, x, y) === obj) {
      balance.dragging = true
      balance.startX = x
      balance.startY = y
      this.redrawArea(obj, 0x805)
    } else if (cls === IDCMP_MOUSEBUTTONS && balance.dragging) {
      balance.dragging = false
      this.redrawArea(obj, 0x805)
    } else if (cls === 0x10 && balance.dragging) {
      this.resizeAtBalance(obj, x - balance.startX, y - balance.startY)
      balance.startX = x
      balance.startY = y
    }
    return 0
  }

  private resizeAtBalance(obj: BoopsiObject, dx: number, dy: number): void {
    const parent = data(this, obj).parent
    if (!parent?.cl.isA(this.groupClass)) return
    const children = data(this, parent).children.filter((child) => child.cl.isA(this.areaClass) &&
      (this.peek(child, MUI.MUIA_ShowMe) ?? 1) !== 0)
    const at = children.indexOf(obj)
    if (at <= 0 || at >= children.length - 1) return
    const before = children[at - 1]!
    const after = children[at + 1]!
    const horiz = this.balanceHorizontalGroup(obj)
    const first = this.boxOf(before)
    const second = this.boxOf(after)
    if (!first || !second) return
    const delta = horiz ? dx : dy
    const total = (horiz ? first.width + second.width : first.height + second.height)
    if (total <= 0) return
    const firstMin = this.minMaxOf(before) ?? this.askMinMax(before)
    const secondMin = this.minMaxOf(after) ?? this.askMinMax(after)
    const low = horiz ? firstMin.minW : firstMin.minH
    const high = total - (horiz ? secondMin.minW : secondMin.minH)
    const firstSize = Math.max(low, Math.min(high, (horiz ? first.width : first.height) + delta))
    data(this, before).attrs.set(horiz ? MUI.MUIA_HorizWeight : MUI.MUIA_VertWeight, firstSize)
    data(this, after).attrs.set(horiz ? MUI.MUIA_HorizWeight : MUI.MUIA_VertWeight, total - firstSize)
    const parentBox = this.boxOf(parent)
    if (parentBox) this.layout(parent, parentBox.left, parentBox.top, parentBox.width, parentBox.height)
    this.redrawArea(parent, 0x805)
  }

  // -- Rectangle ----------------------------------------------------------

  private rectangleMethod(obj: BoopsiObject, msg: Msg): number | null {
    if (msg.MethodID !== MUI.MUIM_Draw) return null
    doSuperMethodA(this.rectangleClass, obj, msg)
    const window = this.ancestorOf(obj, this.windowClass)
    const box = this.boxOf(obj)
    if (!window || !box) return 0
    const handle = window.instData<MuiWindowData>(this.windowClass).handle
    if (handle === null) return 0
    this.windowHost?.drawRectangle?.(handle, {
      ...box,
      hbar: (this.peek(obj, MUI.MUIA_Rectangle_HBar) ?? 0) !== 0,
      vbar: (this.peek(obj, MUI.MUIA_Rectangle_VBar) ?? 0) !== 0,
      title: this.textOf(obj, MUI.MUIA_Rectangle_BarTitle),
    })
    return 0
  }

  // -- Text ---------------------------------------------------------------

  private setText(obj: BoopsiObject, cl: BoopsiClass, msg: OpSet): number {
    const oldContents = this.peek(obj, MUI.MUIA_Text_Contents) ?? 0
    const contents = msg.attrs.find((attr) => TAG(attr.tag) === MUI.MUIA_Text_Contents)?.data
    const own = this.applyOwn('Text', obj, msg.attrs, 's')
    const answer = (own ? this.setCount : 0) + doSuperMethodA(cl, obj, msg)
    if (contents !== undefined) this.copyTextContents(obj, contents, oldContents)
    if (msg.attrs.some((attr) => TAG(attr.tag) === MUI.MUIA_Text_Contents || TAG(attr.tag) === MUI.MUIA_Text_PreParse ||
        TAG(attr.tag) === MUI.MUIA_Text_SetVMax)) this.redrawArea(obj, 1)
    return answer
  }

  private copyTextContents(obj: BoopsiObject, source: number, old: number): void {
    let address = 0
    if (source !== 0) {
      const bytes = Uint8Array.from([...this.textOfAddress(source), '\0'], (c) => c.charCodeAt(0))
      address = this.pool.alloc(bytes.length)
      if (address !== 0) {
        this.pool.buffer.set(bytes, address - this.pool.base)
        data(this, obj).ownedAddresses.push(address)
      }
    }
    const owned = data(this, obj).ownedAddresses
    const i = owned.indexOf(old)
    if (i >= 0 && old !== address) {
      this.pool.freeMem(old)
      owned.splice(i, 1)
    }
    data(this, obj).attrs.set(MUI.MUIA_Text_Contents, address)
  }

  private textMethod(obj: BoopsiObject, msg: Msg): number | null {
    const params = (msg as Msg & { params?: readonly number[] }).params ?? []
    switch (msg.MethodID) {
      case MUI.MUIM_Draw:
        doSuperMethodA(this.textClass, obj, msg)
        this.drawText(obj)
        return 0
      case MUI.MUIM_Export:
        this.textTransferContents(obj, params[0] ?? 0, true)
        return 0
      case MUI.MUIM_Import:
        this.textTransferContents(obj, params[0] ?? 0, false)
        return 0
      default: return null
    }
  }

  private drawText(obj: BoopsiObject): void {
    const window = this.ancestorOf(obj, this.windowClass)
    const box = this.boxOf(obj)
    if (!window || !box) return
    const handle = window.instData<MuiWindowData>(this.windowClass).handle
    if (handle === null) return
    this.windowHost?.drawText?.(handle, {
      ...box,
      contents: this.textOf(obj, MUI.MUIA_Text_Contents),
      preparse: this.textOf(obj, MUI.MUIA_Text_PreParse),
      disabled: (this.peek(obj, MUI.MUIA_Disabled) ?? 0) !== 0,
    })
  }

  private textTransferContents(obj: BoopsiObject, dataspaceAddress: number, exporting: boolean): void {
    const dataspace = this.boopsi.objectAt(dataspaceAddress)
    if (!dataspace?.cl.isA(this.dataspaceClass)) return
    const id = this.peek(obj, MUI.MUIA_ExportID) ?? 0
    if (id === 0) return
    const d = dataspace.instData<MuiDataspaceData>(this.dataspaceClass)
    if (exporting) {
      const value = this.textOf(obj, MUI.MUIA_Text_Contents)
      this.dataspaceAddBytes(d, Uint8Array.from([...value, '\0'], (c) => c.charCodeAt(0)), id)
    } else {
      const entry = d.entries.find((candidate) => candidate.id === TAG(id))
      if (entry) this.set(obj, MUI.MUIA_Text_Contents, entry.address + 16)
    }
  }

  private textDimensions(obj: BoopsiObject): { width: number; height: number } {
    const text = this.textOf(obj, MUI.MUIA_Text_Contents)
    if (text === '') return { width: 0, height: this.fontY }
    const lines = text.split('\n')
    return {
      width: Math.max(...lines.map((line) => visibleLength(line))) * this.fontX,
      height: lines.length * this.fontY,
    }
  }

  // -- Bodychunk ----------------------------------------------------------

  private setBodychunk(obj: BoopsiObject, cl: BoopsiClass, msg: OpSet): number {
    const own = this.applyOwn('Bodychunk', obj, msg.attrs, 's')
    return (own ? this.setCount : 0) + doSuperMethodA(cl, obj, msg)
  }

  private bodychunkMethod(obj: BoopsiObject, msg: Msg): number | null {
    const bodychunk = obj.instData<MuiBodychunkData>(this.bodychunkClass)
    switch (msg.MethodID) {
      case MUI.MUIM_Setup: {
        const answer = doSuperMethodA(this.bodychunkClass, obj, msg)
        bodychunk.setup = answer !== 0
        if (bodychunk.setup && (this.peek(obj, MUI.MUIA_Bodychunk_Body) ?? 0) !== 0) {
          const effective = this.peek(obj, MUI.MUIA_Bodychunk_Body) ?? 0
          obj.instData<MuiBitmapData>(this.bitmapClass).remappedBitmap = effective
          data(this, obj).attrs.set(MUI.MUIA_Bitmap_RemappedBitmap, effective)
        }
        return answer
      }
      case MUI.MUIM_Cleanup:
        bodychunk.setup = false
        return doSuperMethodA(this.bodychunkClass, obj, msg)
      default: return null
    }
  }

  // -- Bitmap -------------------------------------------------------------

  private setBitmap(obj: BoopsiObject, cl: BoopsiClass, msg: OpSet): number {
    const own = this.applyOwn('Bitmap', obj, msg.attrs, 's')
    const answer = (own ? this.setCount : 0) + doSuperMethodA(cl, obj, msg)
    if (msg.attrs.some((attr) => MUI_OWNER[TAG(attr.tag)] === 'Bitmap')) this.redrawArea(obj, 1)
    return answer
  }

  private bitmapMethod(obj: BoopsiObject, msg: Msg): number | null {
    const bitmap = obj.instData<MuiBitmapData>(this.bitmapClass)
    switch (msg.MethodID) {
      case MUI.MUIM_Setup: {
        const answer = doSuperMethodA(this.bitmapClass, obj, msg)
        bitmap.setup = answer !== 0
        // The native class exposes the remapped friend bitmap. Rendering in
        // this port applies the mapping directly, so the source pointer is
        // also the effective, addressable bitmap identity.
        bitmap.remappedBitmap = bitmap.setup ? this.peek(obj, MUI.MUIA_Bitmap_Bitmap) ?? 0 : 0
        data(this, obj).attrs.set(MUI.MUIA_Bitmap_RemappedBitmap, bitmap.remappedBitmap)
        return answer
      }
      case MUI.MUIM_Cleanup:
        bitmap.setup = false
        bitmap.remappedBitmap = 0
        data(this, obj).attrs.set(MUI.MUIA_Bitmap_RemappedBitmap, 0)
        return doSuperMethodA(this.bitmapClass, obj, msg)
      case MUI.MUIM_Draw:
        doSuperMethodA(this.bitmapClass, obj, msg)
        this.drawBitmap(obj)
        return 0
      default: return null
    }
  }

  private drawBitmap(obj: BoopsiObject): void {
    if (!obj.instData<MuiBitmapData>(this.bitmapClass).setup) return
    const window = this.ancestorOf(obj, this.windowClass)
    const box = this.boxOf(obj)
    if (!window || !box) return
    const handle = window.instData<MuiWindowData>(this.windowClass).handle
    if (handle === null) return
    this.windowHost?.drawBitmap?.(handle, {
      ...box,
      bitmap: this.peek(obj, MUI.MUIA_Bitmap_Bitmap) ?? 0,
      sourceWidth: Math.max(0, this.peek(obj, MUI.MUIA_Bitmap_Width) ?? 0),
      sourceHeight: Math.max(0, this.peek(obj, MUI.MUIA_Bitmap_Height) ?? 0),
      mappingTable: this.peek(obj, MUI.MUIA_Bitmap_MappingTable) ?? 0,
      transparent: this.peek(obj, MUI.MUIA_Bitmap_Transparent) ?? -1,
      body: obj.cl.isA(this.bodychunkClass) ? this.peek(obj, MUI.MUIA_Bodychunk_Body) ?? 0 : 0,
      depth: obj.cl.isA(this.bodychunkClass) ? this.peek(obj, MUI.MUIA_Bodychunk_Depth) ?? 0 : 0,
      compression: obj.cl.isA(this.bodychunkClass) ? this.peek(obj, MUI.MUIA_Bodychunk_Compression) ?? 0 : 0,
      masking: obj.cl.isA(this.bodychunkClass) ? this.peek(obj, MUI.MUIA_Bodychunk_Masking) ?? 0 : 0,
    })
  }

  // -- Image --------------------------------------------------------------

  private setImage(obj: BoopsiObject, cl: BoopsiClass, msg: OpSet): number {
    const beforeState = this.peek(obj, MUI.MUIA_Image_State) ?? 0
    const beforeSelected = this.peek(obj, MUI.MUIA_Selected) ?? 0
    const own = this.applyOwn('Image', obj, msg.attrs, 's')
    const answer = (own ? this.setCount : 0) + doSuperMethodA(cl, obj, msg)
    if (beforeState !== (this.peek(obj, MUI.MUIA_Image_State) ?? 0) ||
        beforeSelected !== (this.peek(obj, MUI.MUIA_Selected) ?? 0)) this.redrawArea(obj, 4)
    return answer
  }

  private imageMethod(obj: BoopsiObject, msg: Msg): number | null {
    const image = obj.instData<MuiImageData>(this.imageClass)
    switch (msg.MethodID) {
      case MUI.MUIM_Setup: {
        const answer = doSuperMethodA(this.imageClass, obj, msg)
        image.setup = answer !== 0
        return answer
      }
      case MUI.MUIM_Cleanup:
        image.setup = false
        return doSuperMethodA(this.imageClass, obj, msg)
      case MUI.MUIM_Draw:
        doSuperMethodA(this.imageClass, obj, msg)
        this.drawImage(obj)
        return 0
      default: return null
    }
  }

  private drawImage(obj: BoopsiObject): void {
    if (!obj.instData<MuiImageData>(this.imageClass).setup) return
    const window = this.ancestorOf(obj, this.windowClass)
    const box = this.boxOf(obj)
    if (!window || !box) return
    const handle = window.instData<MuiWindowData>(this.windowClass).handle
    if (handle === null) return
    const explicit = this.peek(obj, MUI.MUIA_Image_State) ?? 0
    this.windowHost?.drawImage?.(handle, {
      ...box,
      spec: this.peek(obj, MUI.MUIA_Image_Spec) ?? 0,
      oldImage: this.peek(obj, MUI.MUIA_Image_OldImage) ?? 0,
      state: (this.peek(obj, MUI.MUIA_Selected) ?? 0) !== 0 ? 1 : explicit,
    })
  }

  private imageMetrics(obj: BoopsiObject): { minW: number; minH: number; maxW: number; maxH: number; defW: number; defH: number } {
    const old = this.peek(obj, MUI.MUIA_Image_OldImage) ?? 0
    let width = this.fontX * 2
    let height = this.fontY
    if (old !== 0) {
      const raw = this.readMemory?.(old + 4, 4)
      if (raw?.length === 4) {
        width = (raw[0]! << 8) | raw[1]!
        height = (raw[2]! << 8) | raw[3]!
      }
    }
    if ((this.peek(obj, MUI.MUIA_Image_FontMatch) ?? 0) !== 0 ||
        (this.peek(obj, MUI.MUIA_Image_FontMatchWidth) ?? 0) !== 0) width = Math.max(width, this.fontX * 2)
    if ((this.peek(obj, MUI.MUIA_Image_FontMatch) ?? 0) !== 0 ||
        (this.peek(obj, MUI.MUIA_Image_FontMatchHeight) ?? 0) !== 0) height = Math.max(height, this.fontY)
    return {
      minW: width, minH: height, defW: width, defH: height,
      maxW: old === 0 && (this.peek(obj, MUI.MUIA_Image_FreeHoriz) ?? 0) !== 0 ? MUI_MAXMAX : width,
      maxH: old === 0 && (this.peek(obj, MUI.MUIA_Image_FreeVert) ?? 0) !== 0 ? MUI_MAXMAX : height,
    }
  }

  // -- Area ---------------------------------------------------------------

  private setArea(obj: BoopsiObject, cl: BoopsiClass, msg: OpSet): number {
    const area = obj.instData<MuiAreaData>(cl)
    const attrs = msg.attrs.map((raw) => {
      const tag = TAG(raw.tag)
      if (tag === MUI.MUIA_Disabled || tag === MUI.MUIA_Selected || tag === MUI.MUIA_ShowMe ||
          tag === MUI.MUIA_Draggable || tag === MUI.MUIA_Dropable || tag === MUI.MUIA_ShowSelState) {
        return { tag: raw.tag, data: raw.data === 0 ? 0 : 1 }
      }
      if (tag === MUI.MUIA_Weight || tag === MUI.MUIA_HorizWeight || tag === MUI.MUIA_VertWeight) {
        return { tag: raw.tag, data: Math.max(0, raw.data) }
      }
      return raw
    })
    const beforeDisabled = this.peek(obj, MUI.MUIA_Disabled) ?? 0
    const beforeSelected = this.peek(obj, MUI.MUIA_Selected) ?? 0
    const beforeShow = this.peek(obj, MUI.MUIA_ShowMe) ?? 1
    const noNotify = attrs.some((attr) => TAG(attr.tag) === MUI.MUIA_NoNotify && attr.data !== 0)
    if (noNotify) this.suppressNotifications++
    let answer = 0
    try {
      const own = this.applyOwn('Area', obj, attrs, 's')
      answer = (own ? this.setCount : 0) + doSuperMethodA(cl, obj, { ...msg, attrs } as OpSet)
    } finally {
      if (noNotify) this.suppressNotifications--
    }
    area.shown = (this.peek(obj, MUI.MUIA_ShowMe) ?? 1) !== 0
    if (beforeDisabled !== (this.peek(obj, MUI.MUIA_Disabled) ?? 0) ||
        beforeSelected !== (this.peek(obj, MUI.MUIA_Selected) ?? 0) ||
        beforeShow !== (this.peek(obj, MUI.MUIA_ShowMe) ?? 1)) this.redrawArea(obj, 0x805)
    return answer
  }

  private getArea(obj: BoopsiObject, attr: number): number | undefined {
    const box = this.boxOf(obj)
    switch (attr) {
      case MUI.MUIA_LeftEdge: return box?.left
      case MUI.MUIA_TopEdge: return box?.top
      case MUI.MUIA_Width: return box?.width
      case MUI.MUIA_Height: return box?.height
      case MUI.MUIA_RightEdge: return box ? box.left + box.width - 1 : undefined
      case MUI.MUIA_BottomEdge: return box ? box.top + box.height - 1 : undefined
      case MUI.MUIA_WindowObject: return this.ancestorOf(obj, this.windowClass)?.address ?? 0
      case MUI.MUIA_Window: {
        const window = this.ancestorOf(obj, this.windowClass)
        return window?.instData<MuiWindowData>(this.windowClass).nativeAddress ?? 0
      }
      default: return undefined
    }
  }

  private areaMethod(obj: BoopsiObject, msg: Msg): number | null {
    const params = (msg as Msg & { params?: readonly number[] }).params ?? []
    const area = obj.instData<MuiAreaData>(this.areaClass)
    switch (msg.MethodID) {
      case MUI.MUIM_Setup:
        area.setup = true
        return 1
      case MUIM_AREA_RESET_SETUP:
        area.setup = true
        return 1
      case MUI.MUIM_Cleanup:
        area.setup = false
        area.dragging = false
        return 0
      case MUI.MUIM_Show:
        area.shown = true
        return 1
      case MUI.MUIM_Hide:
        area.shown = false
        return 0
      case MUI.MUIM_Draw:
        this.drawArea(obj, params[0] ?? 0)
        return 0
      case MUI.MUIM_DrawBackground:
        this.drawArea(obj, params[5] ?? 0)
        return 0
      case MUI.MUIM_HandleInput:
      case MUI.MUIM_HandleEvent:
        return this.handleAreaInput(obj, params)
      case MUI.MUIM_Export:
        this.areaTransferSelected(obj, params[0] ?? 0, true)
        return doSuperMethodA(this.areaClass, obj, msg)
      case MUI.MUIM_Import:
        this.areaTransferSelected(obj, params[0] ?? 0, false)
        return doSuperMethodA(this.areaClass, obj, msg)
      case MUI.MUIM_DragQuery: return 0
      case MUI.MUIM_DragReport: return 1
      case MUI.MUIM_DragBegin:
        area.dragging = true
        this.redrawArea(obj, 0x800)
        return 0
      case MUI.MUIM_DragFinish:
        area.dragging = false
        this.redrawArea(obj, 0x805)
        return 0
      case MUI.MUIM_ContextMenuChoice:
        this.setInternal(obj, MUI.MUIA_ContextMenuTrigger, params[0] ?? 0)
        return 0
      case MUI.MUIM_ContextMenuBuild:
        return this.peek(obj, MUI.MUIA_ContextMenu) ?? 0
      case MUIM_AREA_FIND_AT:
        return this.areaAt(obj, this.signed(params[0] ?? 0), this.signed(params[1] ?? 0))?.address ?? 0
      case MUIM_AREA_LAYOUT:
        if (params.length >= 4) {
          this.layout(obj, this.signed(params[0] ?? 0), this.signed(params[1] ?? 0), this.signed(params[2] ?? 0), this.signed(params[3] ?? 0))
          return this.areaFits(obj) ? 1 : 0
        }
        return 0
      case MUIM_AREA_REDRAW:
        this.redrawArea(obj, 4)
        return area.setup ? 1 : 0
      case MUIM_AREA_DEACTIVATE:
        if ((this.peek(obj, MUI.MUIA_Selected) ?? 0) !== 0) this.setInternal(obj, MUI.MUIA_Selected, 0)
        this.setInternal(obj, MUI.MUIA_Pressed, 0)
        this.redrawArea(obj, 0x805)
        return 1
      case MUIM_AREA_ENABLE_NESTED:
        area.disableDepth = Math.max(0, area.disableDepth - 1)
        if (area.disableDepth === 0) this.setInternal(obj, MUI.MUIA_Disabled, 0)
        return area.disableDepth === 0 ? 1 : 0
      case MUIM_AREA_DISABLE_NESTED:
        area.disableDepth = Math.min(63, area.disableDepth + 1)
        if (area.disableDepth === 1) this.setInternal(obj, MUI.MUIA_Disabled, 1)
        return area.disableDepth === 1 ? 1 : 0
      case MUIM_AREA_FALSE:
      case MUIM_AREA_NOOP:
        return 0
      case MUIM_AREA_TRUE:
        return 1
      case MUI.MUIM_CreateShortHelp:
        return this.peek(obj, MUI.MUIA_ShortHelp) ?? 0
      case MUI.MUIM_DeleteShortHelp:
        return 0
      case MUIM_AREA_DELETE_DRAG_IMAGE:
      case MUIM_AREA_DELETE_BUBBLE_IMAGE:
        this.releaseAreaHandle(obj, params[0] ?? 0)
        return 0
      case MUIM_AREA_CREATE_DRAG_IMAGE:
      case MUIM_AREA_CREATE_BUBBLE_IMAGE:
      case MUI.MUIM_CreateBubble:
        return this.createAreaHandle(obj, params)
      case MUI.MUIM_DeleteBubble:
        this.releaseAreaHandle(obj, params[0] ?? 0)
        return 0
      case MUIM_AREA_HIT_TEST:
        return this.areaAt(obj, this.signed(params[0] ?? 0), this.signed(params[1] ?? 0)) ? 1 : 0
      default: return null
    }
  }

  private drawArea(obj: BoopsiObject, drawFlags: number): void {
    const area = obj.instData<MuiAreaData>(this.areaClass)
    area.drawFlags = drawFlags
    if (!area.setup || !area.shown) return
    const window = this.ancestorOf(obj, this.windowClass)
    const box = this.boxOf(obj)
    if (!window || !box) return
    const handle = window.instData<MuiWindowData>(this.windowClass).handle
    if (handle === null) return
    this.windowHost?.drawArea?.(handle, {
      ...box,
      background: this.peek(obj, MUI.MUIA_Background) ?? 0,
      frame: this.peek(obj, MUI.MUIA_Frame) ?? MUI.MUIV_Frame_None,
      selected: (this.peek(obj, MUI.MUIA_ShowSelState) ?? 1) !== 0 &&
        (this.peek(obj, MUI.MUIA_Selected) ?? 0) !== 0,
      disabled: (this.peek(obj, MUI.MUIA_Disabled) ?? 0) !== 0,
      fill: (this.peek(obj, MUI.MUIA_FillArea) ?? 1) !== 0,
      drawFlags,
    })
  }

  private redrawArea(obj: BoopsiObject, flags: number): void {
    const area = obj.instData<MuiAreaData>(this.areaClass)
    area.drawFlags |= flags
    if (area.setup) this.drawArea(obj, area.drawFlags)
  }

  private areaAt(obj: BoopsiObject, x: number, y: number): BoopsiObject | null {
    const area = obj.instData<MuiAreaData>(this.areaClass)
    const box = this.boxOf(obj)
    if (!area.setup || !area.shown || (this.peek(obj, MUI.MUIA_Disabled) ?? 0) !== 0 || !box ||
        x < box.left || y < box.top || x >= box.left + box.width || y >= box.top + box.height) return null
    for (const child of [...data(this, obj).children].reverse()) {
      if (!child.cl.isA(this.areaClass)) continue
      const found = this.areaAt(child, x, y)
      if (found) return found
    }
    return obj
  }

  private areaFits(obj: BoopsiObject): boolean {
    const box = this.boxOf(obj)
    const mm = this.minMaxOf(obj) ?? this.askMinMax(obj)
    return !!box && box.width >= mm.minW && box.height >= mm.minH && box.width <= mm.maxW && box.height <= mm.maxH
  }

  private handleAreaInput(obj: BoopsiObject, params: readonly number[]): number {
    const cls = params[0] ?? 0
    const code = params[1] ?? 0
    const qualifier = params[2] ?? 0
    const x = this.signed(params[3] ?? 0)
    const y = this.signed(params[4] ?? 0)
    if ((this.peek(obj, MUI.MUIA_Disabled) ?? 0) !== 0 || (this.peek(obj, MUI.MUIA_ShowMe) ?? 1) === 0) return 0
    const inside = this.areaAt(obj, x, y) === obj
    const mode = this.peek(obj, MUI.MUIA_InputMode) ?? MUI.MUIV_InputMode_None
    if (cls === IDCMP_RAWKEY) {
      const control = this.peek(obj, MUI.MUIA_ControlChar) ?? 0
      if (control !== 0 && (code & 0xff) === (control & 0xff)) this.pressArea(obj)
      return 0
    }
    if (cls !== IDCMP_MOUSEBUTTONS) return 0
    const down = code === 0x68
    const up = code === 0xe8
    if (down && inside) {
      if (mode === MUI.MUIV_InputMode_Toggle) {
        this.setInternal(obj, MUI.MUIA_Selected, (this.peek(obj, MUI.MUIA_Selected) ?? 0) === 0 ? 1 : 0)
        this.pressArea(obj)
      } else if (mode === MUI.MUIV_InputMode_Immediate || mode === MUI.MUIV_InputMode_RelVerify) {
        this.setInternal(obj, MUI.MUIA_Selected, 1)
        if (mode === MUI.MUIV_InputMode_Immediate) this.pressArea(obj)
      }
      this.redrawArea(obj, 0x805)
    } else if (up && (mode === MUI.MUIV_InputMode_Immediate || mode === MUI.MUIV_InputMode_RelVerify)) {
      if (mode === MUI.MUIV_InputMode_RelVerify && inside && (this.peek(obj, MUI.MUIA_Selected) ?? 0) !== 0) this.pressArea(obj)
      this.setInternal(obj, MUI.MUIA_Selected, 0)
      this.redrawArea(obj, 0x805)
    }
    void qualifier
    return 0
  }

  private pressArea(obj: BoopsiObject): void {
    this.setInternal(obj, MUI.MUIA_Pressed, 1)
    this.setInternal(obj, MUI.MUIA_Pressed, 0)
  }

  private areaTransferSelected(obj: BoopsiObject, dataspaceAddress: number, exporting: boolean): void {
    const dataspace = this.boopsi.objectAt(dataspaceAddress)
    if (!dataspace?.cl.isA(this.dataspaceClass)) return
    const id = this.peek(obj, MUI.MUIA_ExportID) ?? 0
    if (id === 0) return
    const d = dataspace.instData<MuiDataspaceData>(this.dataspaceClass)
    if (exporting) {
      const bytes = new Uint8Array(4)
      putLong(bytes, 0, this.peek(obj, MUI.MUIA_Selected) ?? 0)
      this.dataspaceAddBytes(d, bytes, id)
    } else {
      const entry = d.entries.find((candidate) => candidate.id === TAG(id) && candidate.length >= 4)
      if (entry) this.set(obj, MUI.MUIA_Selected, this.poolLong(entry.address - this.pool.base + 16))
    }
  }

  private createAreaHandle(obj: BoopsiObject, params: readonly number[]): number {
    const address = this.pool.alloc(20, { clear: true })
    if (address === 0) return 0
    const box = this.boxOf(obj)
    const off = address - this.pool.base
    this.putPoolLong(off, obj.address)
    this.putPoolLong(off + 4, params[0] ?? box?.left ?? 0)
    this.putPoolLong(off + 8, params[1] ?? box?.top ?? 0)
    this.putPoolLong(off + 12, box?.width ?? 0)
    this.putPoolLong(off + 16, box?.height ?? 0)
    obj.instData<MuiAreaData>(this.areaClass).handles.add(address)
    return address
  }

  private releaseAreaHandle(obj: BoopsiObject, address: number): void {
    if (address === 0) return
    const handles = obj.instData<MuiAreaData>(this.areaClass).handles
    if (!handles.delete(address)) return
    this.pool.freeMem(address)
  }

  /** Apply Area's absolute constraints after the leaf has added its content. */
  private constrainAreaMinMax(obj: BoopsiObject, mm: MinMax): void {
    const fixedTextWidth = this.peek(obj, MUI.MUIA_FixWidthTxt) ?? 0
    const fixedTextHeight = this.peek(obj, MUI.MUIA_FixHeightTxt) ?? 0
    const fixedW = this.peek(obj, MUI.MUIA_FixWidth) ??
      (fixedTextWidth === 0 ? 0 : visibleLength(this.readString?.(fixedTextWidth) ?? '') * this.fontX)
    const fixedH = this.peek(obj, MUI.MUIA_FixHeight) ??
      (fixedTextHeight === 0 ? 0 : this.fontY)
    if (fixedW > 0) mm.minW = mm.defW = mm.maxW = fixedW
    else {
      const maxW = this.peek(obj, MUI.MUIA_MaxWidth) ?? 0
      if (maxW > 0) mm.maxW = Math.min(mm.maxW, maxW)
    }
    if (fixedH > 0) mm.minH = mm.defH = mm.maxH = fixedH
    else {
      const maxH = this.peek(obj, MUI.MUIA_MaxHeight) ?? 0
      if (maxH > 0) mm.maxH = Math.min(mm.maxH, maxH)
    }
  }

  // -- Window -------------------------------------------------------------

  private copyWindowString(obj: BoopsiObject, attr: number, source = this.peek(obj, attr) ?? 0): void {
    const d = data(this, obj)
    const old = d.attrs.get(attr) ?? 0
    const readable = source >= this.pool.base && source < this.pool.base + this.pool.buffer.length || this.textOfAddress(source) !== ''
    if (source !== 0 && !readable) {
      d.attrs.set(attr, source)
      return
    }
    let address = 0
    if (source !== 0) {
      const bytes = Uint8Array.from([...this.textOfAddress(source), '\0'], (c) => c.charCodeAt(0))
      address = this.pool.alloc(bytes.length)
      if (address !== 0) {
        this.pool.buffer.set(bytes, address - this.pool.base)
        d.ownedAddresses.push(address)
      }
    }
    const i = d.ownedAddresses.indexOf(old)
    if (i >= 0 && old !== address) {
      this.pool.freeMem(old)
      d.ownedAddresses.splice(i, 1)
    }
    d.attrs.set(attr, address)
  }

  private windowRoot(obj: BoopsiObject): BoopsiObject | null {
    return this.boopsi.objectAt(this.peek(obj, MUI.MUIA_Window_RootObject) ?? 0)
  }

  private openMuiWindow(obj: BoopsiObject): boolean {
    const win = obj.instData<MuiWindowData>(this.windowClass)
    if (win.handle !== null) return true
    if (!this.windowHost) return false
    const root = this.windowRoot(obj)
    if (!root) return false
    const mm = this.askMinMax(root)
    const rawWidth = this.peek(obj, MUI.MUIA_Window_Width) ?? MUI.MUIV_Window_Width_Default
    const rawHeight = this.peek(obj, MUI.MUIA_Window_Height) ?? MUI.MUIV_Window_Height_Default
    const width = TAG(rawWidth) === MUI.MUIV_Window_Width_Default ? Math.max(80, mm.defW + 8) : rawWidth
    const height = TAG(rawHeight) === MUI.MUIV_Window_Height_Default ? Math.max(32, mm.defH + 20) : rawHeight
    const handle = this.windowHost.open({
      left: this.signed(this.peek(obj, MUI.MUIA_Window_LeftEdge) ?? -1),
      top: this.signed(this.peek(obj, MUI.MUIA_Window_TopEdge) ?? -1),
      width: this.signed(width),
      height: this.signed(height),
      title: this.textOf(obj, MUI.MUIA_Window_Title),
      screenTitle: this.textOf(obj, MUI.MUIA_Window_ScreenTitle),
      publicScreen: this.textOf(obj, MUI.MUIA_Window_PublicScreen),
      screenAddress: this.peek(obj, MUI.MUIA_Window_Screen) ?? 0,
      flags: {
        activate: (this.peek(obj, MUI.MUIA_Window_Activate) ?? 0) !== 0,
        backdrop: (this.peek(obj, MUI.MUIA_Window_Backdrop) ?? 0) !== 0,
        borderless: (this.peek(obj, MUI.MUIA_Window_Borderless) ?? 0) !== 0,
        closeGadget: (this.peek(obj, MUI.MUIA_Window_CloseGadget) ?? 1) !== 0,
        depthGadget: (this.peek(obj, MUI.MUIA_Window_DepthGadget) ?? 1) !== 0,
        dragBar: (this.peek(obj, MUI.MUIA_Window_DragBar) ?? 1) !== 0,
        sizeGadget: (this.peek(obj, MUI.MUIA_Window_SizeGadget) ?? 1) !== 0,
      },
    })
    if (handle === null) return false
    win.handle = handle
    win.nativeAddress = this.pool.alloc(4, { clear: true })
    const geometry = this.windowHost.geometry(handle)
    this.doMui(root, MUI.MUIM_Setup)
    this.layout(root, 0, 0, Math.max(0, geometry.width), Math.max(0, geometry.height))
    this.doMui(root, MUI.MUIM_Show)
    this.doMui(root, MUI.MUIM_Draw, [0x805])
    this.setInternal(obj, MUI.MUIA_Window_Open, 1)
    this.setInternal(obj, MUI.MUIA_Window_Activate, geometry.active ? 1 : 0)
    return true
  }

  private closeMuiWindow(obj: BoopsiObject): void {
    const win = obj.instData<MuiWindowData>(this.windowClass)
    const root = this.windowRoot(obj)
    if (root && win.handle !== null) {
      this.doMui(root, MUI.MUIM_Hide)
      this.doMui(root, MUI.MUIM_Cleanup)
    }
    if (win.handle !== null) this.windowHost?.close(win.handle)
    win.handle = null
    if (win.nativeAddress !== 0) this.pool.freeMem(win.nativeAddress)
    win.nativeAddress = 0
    this.setInternal(obj, MUI.MUIA_Window_Open, 0)
    this.setInternal(obj, MUI.MUIA_Window_Activate, 0)
  }

  private setWindow(obj: BoopsiObject, cl: BoopsiClass, msg: OpSet): number {
    const win = obj.instData<MuiWindowData>(cl)
    const attrs: TagItem[] = []
    const stringAttrs: TagItem[] = []
    let requestedOpen: boolean | null = null
    let replacedRoot = false
    for (const raw of msg.attrs) {
      const tag = TAG(raw.tag)
      if (tag === MUI.MUIA_Window_Open) {
        requestedOpen = raw.data !== 0
        continue
      }
      if (tag === MUI.MUIA_Window_Sleep) {
        win.sleepDepth = Math.max(0, win.sleepDepth + (raw.data === 0 ? -1 : 1))
        attrs.push({ tag: raw.tag, data: win.sleepDepth === 0 ? 0 : 1 })
      } else if (tag === MUI.MUIA_Window_Activate) {
        attrs.push(raw)
        if (raw.data !== 0 && win.handle !== null) this.windowHost?.activate(win.handle)
      } else if (tag === MUI.MUIA_Window_Title || tag === MUI.MUIA_Window_ScreenTitle) {
        attrs.push(raw)
        stringAttrs.push(raw)
      } else if (tag === MUI.MUIA_Window_RootObject) {
        this.replaceWindowRoot(obj, this.boopsi.objectAt(raw.data))
        replacedRoot = true
      } else attrs.push(raw)
    }
    const noNotify = attrs.some((attr) => TAG(attr.tag) === MUI.MUIA_NoNotify && attr.data !== 0)
    if (noNotify) this.suppressNotifications++
    let answer = 0
    try {
      const own = this.applyOwn('Window', obj, attrs, 's')
      answer = (own ? this.setCount : 0) + doSuperMethodA(cl, obj, { ...msg, attrs } as OpSet)
    } finally {
      if (noNotify) this.suppressNotifications--
    }
    for (const attr of stringAttrs) this.copyWindowString(obj, TAG(attr.tag), attr.data)
    if (stringAttrs.length !== 0 && win.handle !== null) this.windowHost?.setTitles(
      win.handle, this.textOf(obj, MUI.MUIA_Window_Title), this.textOf(obj, MUI.MUIA_Window_ScreenTitle),
    )
    if (replacedRoot) answer++
    if (requestedOpen !== null) {
      if (requestedOpen) this.openMuiWindow(obj)
      else this.closeMuiWindow(obj)
      answer++
    }
    return answer
  }

  private getWindow(obj: BoopsiObject, attr: number): number | undefined {
    const win = obj.instData<MuiWindowData>(this.windowClass)
    const geometry = win.handle === null ? null : this.windowHost?.geometry(win.handle) ?? null
    switch (attr) {
      case MUI.MUIA_Window_Window: return win.nativeAddress
      case MUI.MUIA_Window_Open: return win.handle === null ? 0 : 1
      case MUI.MUIA_Window_Activate: return geometry ? (geometry.active ? 1 : 0) : this.peek(obj, attr) ?? 0
      case MUI.MUIA_Window_LeftEdge: return geometry?.left ?? this.peek(obj, attr) ?? 0
      case MUI.MUIA_Window_TopEdge: return geometry?.top ?? this.peek(obj, attr) ?? 0
      case MUI.MUIA_Window_Width: return geometry?.width ?? this.peek(obj, attr) ?? 0
      case MUI.MUIA_Window_Height: return geometry?.height ?? this.peek(obj, attr) ?? 0
      case MUI.MUIA_Window_Screen: return geometry?.screenAddress ?? this.peek(obj, attr) ?? 0
      case MUI.MUIA_Window_Sleep: return win.sleepDepth === 0 ? 0 : 1
      default: return undefined
    }
  }

  private replaceWindowRoot(obj: BoopsiObject, replacement: BoopsiObject | null): number {
    const old = this.windowRoot(obj)
    if (old === replacement) return old?.address ?? 0
    const d = data(this, obj)
    if (old) {
      const i = d.children.indexOf(old)
      if (i >= 0) d.children.splice(i, 1)
      data(this, old).parent = null
    }
    d.attrs.set(MUI.MUIA_Window_RootObject, replacement?.address ?? 0)
    if (replacement) {
      if (!d.children.includes(replacement)) d.children.push(replacement)
      data(this, replacement).parent = obj
      const win = obj.instData<MuiWindowData>(this.windowClass)
      if (win.handle !== null && this.windowHost) {
        const g = this.windowHost.geometry(win.handle)
        this.askMinMax(replacement)
        this.layout(replacement, 0, 0, g.width, g.height)
      }
    }
    return old?.address ?? 0
  }

  private windowMethod(obj: BoopsiObject, msg: Msg): number | null {
    const params = (msg as Msg & { params?: readonly number[] }).params ?? []
    const win = obj.instData<MuiWindowData>(this.windowClass)
    const host = this.windowHost
    switch (msg.MethodID) {
      case MUI.MUIM_Window_SetCycleChain:
        for (const address of params) {
          if (address === 0) break
          const child = this.boopsi.objectAt(address)
          if (child) this.set(child, MUI.MUIA_CycleChain, 1)
        }
        return 0
      case MUI.MUIM_Window_ToFront:
        if (win.handle !== null) host?.toFront(win.handle)
        return 0
      case MUI.MUIM_Window_ToBack:
        if (win.handle !== null) host?.toBack(win.handle)
        return 0
      case MUI.MUIM_Window_ScreenToFront:
        if (win.handle !== null) host?.screenToFront(win.handle)
        return 0
      case MUI.MUIM_Window_ScreenToBack:
        if (win.handle !== null) host?.screenToBack(win.handle)
        return 0
      case MUI.MUIM_Window_AddEventHandler: {
        const node = params[0] ?? 0
        if (node !== 0 && !win.eventHandlers.includes(node)) {
          win.eventHandlers.push(node)
          win.eventHandlers.sort((a, b) => this.signedByte(this.readByte(b + 9)) - this.signedByte(this.readByte(a + 9)))
        }
        return 0
      }
      case MUI.MUIM_Window_RemEventHandler: {
        const i = win.eventHandlers.indexOf(params[0] ?? 0)
        if (i >= 0) win.eventHandlers.splice(i, 1)
        return 0
      }
      case MUIM_WINDOW_HANDLE_EVENT:
        this.handleWindowEvent(obj, {
          class: params[0] ?? 0, code: params[1] ?? 0, qualifier: params[2] ?? 0,
          mouseX: params[3] ?? 0, mouseY: params[4] ?? 0, seconds: params[5] ?? 0,
          micros: params[6] ?? 0, iaddress: params[7] ?? 0,
        })
        return 0
      case MUIM_WINDOW_LAYOUT:
      case MUIM_WINDOW_REFRESH: {
        const root = this.windowRoot(obj)
        if (root && win.handle !== null && host) {
          const g = host.geometry(win.handle)
          this.askMinMax(root)
          this.layout(root, 0, 0, g.width, g.height)
        }
        return 0
      }
      case MUIM_WINDOW_VALIDATE_SIZE:
        return win.handle === null ? 0 : 1
      case MUI.MUIM_Window_Snapshot:
        return this.windowSnapshot(obj, params[0] ?? 0)
      case MUIM_WINDOW_ICONIFY:
        if (data(this, obj).contextApplication) this.set(data(this, obj).contextApplication!, MUI.MUIA_Application_Iconified, 1)
        return 0
      case MUIM_WINDOW_TRUE: return 1
      case MUIM_WINDOW_FALSE: return 0
      case MUI.MUIM_Window_SetMenuCheck:
      case MUIM_APPLICATION_SET_MENU_CHECK_PRIVATE:
        return this.windowSetMenu(obj, params[0] ?? 0, MUI.MUIA_Menuitem_Checked, params[1] ?? 0)
      case MUI.MUIM_Window_GetMenuCheck:
      case MUIM_APPLICATION_GET_MENU_CHECK_PRIVATE:
        return this.windowGetMenu(obj, params[0] ?? 0, MUI.MUIA_Menuitem_Checked)
      case MUI.MUIM_Window_SetMenuState:
      case MUIM_APPLICATION_SET_MENU_STATE_PRIVATE:
        return this.windowSetMenu(obj, params[0] ?? 0, MUI.MUIA_Menuitem_Enabled, params[1] ?? 0)
      case MUI.MUIM_Window_GetMenuState:
      case MUIM_APPLICATION_GET_MENU_STATE_PRIVATE:
        return this.windowGetMenu(obj, params[0] ?? 0, MUI.MUIA_Menuitem_Enabled)
      case MUI.MUIM_FindUData:
      case MUI.MUIM_GetUData:
      case MUI.MUIM_SetUData:
        return this.windowUserData(obj, msg)
      case MUI.MUIM_Export:
      case MUI.MUIM_Import:
        for (const child of this.windowOwnedObjects(obj)) this.doMui(child, msg.MethodID, params)
        return doSuperMethodA(this.windowClass, obj, msg)
      case MUIM_WINDOW_BROADCAST:
        doSuperMethodA(this.windowClass, obj, msg)
        for (const child of this.windowOwnedObjects(obj)) child.cl.dispatcher(child.cl, child, msg)
        return 0
      case MUIM_WINDOW_ROOT_METHOD: {
        const root = this.windowRoot(obj)
        return root && params.length !== 0 ? this.doMui(root, params[0] ?? 0, params.slice(1)) : 0
      }
      case MUIM_WINDOW_UPDATE_TITLES:
        if (win.handle === null || !host) return 0
        host.setTitles(win.handle, this.textOf(obj, MUI.MUIA_Window_Title), this.textOf(obj, MUI.MUIA_Window_ScreenTitle))
        return 1
      case MUIM_WINDOW_REPLACE_ROOT:
        return this.replaceWindowRoot(obj, this.boopsi.objectAt(params[0] ?? 0))
      case MUIM_WINDOW_CLIP_ON: return win.handle === null ? 0 : 1
      case MUIM_WINDOW_CLIP_OFF:
      case MUIM_WINDOW_CONTEXT_MENU:
        return 0
      default: return null
    }
  }

  private pollWindow(obj: BoopsiObject): void {
    const win = obj.instData<MuiWindowData>(this.windowClass)
    if (win.handle === null || !this.windowHost) return
    for (const event of this.windowHost.poll(win.handle)) this.handleWindowEvent(obj, event)
  }

  private handleWindowEvent(obj: BoopsiObject, event: MuiWindowEvent): void {
    const win = obj.instData<MuiWindowData>(this.windowClass)
    for (const node of [...win.eventHandlers]) {
      const mask = this.readLong?.(node + 20) ?? 0
      if ((mask & event.class) === 0) continue
      const target = this.boopsi.objectAt(this.readLong?.(node + 12) ?? 0)
      if (target && this.doMui(target, MUI.MUIM_HandleEvent, [
        event.class, event.code, event.qualifier, event.mouseX, event.mouseY,
        event.seconds, event.micros, event.iaddress, node,
      ]) & 1) break
    }
    const root = this.windowRoot(obj)
    if (root) this.doMui(root, MUI.MUIM_HandleInput, [
      event.class, event.code, event.qualifier, event.mouseX, event.mouseY,
      event.seconds, event.micros, event.iaddress,
    ])
    if (event.class === IDCMP_CLOSEWINDOW) this.setInternal(obj, MUI.MUIA_Window_CloseRequest, 1)
    else if (event.class === IDCMP_ACTIVEWINDOW) this.setInternal(obj, MUI.MUIA_Window_Activate, 1)
    else if (event.class === IDCMP_INACTIVEWINDOW) this.setInternal(obj, MUI.MUIA_Window_Activate, 0)
    else if (event.class === IDCMP_NEWSIZE || event.class === IDCMP_REFRESHWINDOW) this.windowMethod(obj, { MethodID: MUIM_WINDOW_REFRESH } as Msg)
    else if (event.class === IDCMP_MOUSEMOVE || event.class === IDCMP_MOUSEBUTTONS) {
      this.setInternal(obj, MUI.MUIA_Window_MouseObject, this.windowRoot(obj)?.address ?? 0)
    } else if (event.class === IDCMP_MENUPICK) this.setInternal(obj, MUI.MUIA_Window_MenuAction, event.code)
    else if (event.class === IDCMP_RAWKEY) this.setInternal(obj, MUI.MUIA_Window_InputEvent, event.code)
  }

  private windowOwnedObjects(obj: BoopsiObject): BoopsiObject[] {
    const result: BoopsiObject[] = []
    for (const attr of [MUI.MUIA_Window_RootObject, MUI.MUIA_Window_Menustrip]) {
      const child = this.boopsi.objectAt(this.peek(obj, attr) ?? 0)
      if (child && !result.includes(child)) result.push(child)
    }
    return result
  }

  private windowUserData(obj: BoopsiObject, msg: Msg): number {
    const params = (msg as Msg & { params?: readonly number[] }).params ?? []
    const own = this.notifyMethod(this.notifyClass, obj, msg)
    if ((msg.MethodID === MUI.MUIM_FindUData || msg.MethodID === MUI.MUIM_GetUData) && own !== 0) return own
    for (const child of this.windowOwnedObjects(obj)) {
      const answer = this.doMui(child, msg.MethodID, params)
      if ((msg.MethodID === MUI.MUIM_FindUData || msg.MethodID === MUI.MUIM_GetUData) && answer !== 0) return answer
    }
    return 0
  }

  private windowMenuitem(obj: BoopsiObject, id: number): BoopsiObject | null {
    const strip = this.boopsi.objectAt(this.peek(obj, MUI.MUIA_Window_Menustrip) ?? 0)
    if (!strip) return null
    const item = this.boopsi.objectAt(this.doMui(strip, MUI.MUIM_FindUData, [id]))
    return item?.cl.isA(this.menuitemClass) ? item : null
  }

  private windowSetMenu(obj: BoopsiObject, id: number, attr: number, value: number): number {
    const item = this.windowMenuitem(obj, id)
    return item ? this.set(item, attr, value) : 0
  }

  private windowGetMenu(obj: BoopsiObject, id: number, attr: number): number {
    const item = this.windowMenuitem(obj, id)
    return item ? (this.get(item, attr) ?? 2) : 2
  }

  private windowSnapshot(obj: BoopsiObject, _flags: number): number {
    const win = obj.instData<MuiWindowData>(this.windowClass)
    const app = data(this, obj).contextApplication
    if (win.handle === null || !app || !this.windowHost) return 0
    const g = this.windowHost.geometry(win.handle)
    const ds = app.instData<MuiApplicationData>(this.applicationClass).configdata
    const id = this.peek(obj, MUI.MUIA_Window_ID) ?? 0
    if (!ds || id === 0) return 0
    const bytes = new Uint8Array(16)
    putLong(bytes, 0, g.left); putLong(bytes, 4, g.top); putLong(bytes, 8, g.width); putLong(bytes, 12, g.height)
    return this.dataspaceAddBytes(ds.instData<MuiDataspaceData>(this.dataspaceClass), bytes, id) === 0 ? 0 : 1
  }

  private signed(value: number): number { return value | 0 }
  private signedByte(value: number): number { return value & 0x80 ? value - 0x100 : value }

  // -- Application --------------------------------------------------------

  private setApplication(obj: BoopsiObject, cl: BoopsiClass, msg: OpSet): number {
    const app = obj.instData<MuiApplicationData>(cl)
    const attrs = msg.attrs.map((attr) => {
      const tag = TAG(attr.tag)
      if (tag === MUI.MUIA_Application_Sleep) {
        app.sleepDepth = Math.max(0, app.sleepDepth + (attr.data === 0 ? -1 : 1))
        return { tag: attr.tag, data: app.sleepDepth === 0 ? 0 : 1 }
      }
      if (tag === MUI.MUIA_Application_Active || tag === MUI.MUIA_Application_Iconified) {
        return { tag: attr.tag, data: attr.data === 0 ? 0 : 1 }
      }
      return attr
    })
    const noNotify = attrs.some((attr) => TAG(attr.tag) === MUI.MUIA_NoNotify && attr.data !== 0)
    if (noNotify) this.suppressNotifications++
    try {
      const ownMsg: OpSet = { ...msg, attrs }
      const ok = this.applyOwn('Application', obj, attrs, 's')
      return (ok ? this.setCount : 0) + doSuperMethodA(cl, obj, ownMsg)
    } finally {
      if (noNotify) this.suppressNotifications--
    }
  }

  private copyApplicationStrings(obj: BoopsiObject): void {
    for (const attr of [
      MUI.MUIA_Application_Title,
      MUI.MUIA_Application_Version,
      MUI.MUIA_Application_Copyright,
      MUI.MUIA_Application_Author,
      MUI.MUIA_Application_Description,
      MUI.MUIA_Application_Base,
    ]) {
      const source = this.peek(obj, attr) ?? 0
      let value = this.textOfAddress(source)
      if (attr === MUI.MUIA_Application_Base) value = value.toUpperCase()
      const bytes = Uint8Array.from([...value, '\0'], (c) => c.charCodeAt(0))
      const address = this.pool.alloc(bytes.length)
      if (address === 0) continue
      this.pool.buffer.set(bytes, address - this.pool.base)
      data(this, obj).ownedAddresses.push(address)
      data(this, obj).attrs.set(attr, address)
    }
  }

  private applicationAdd(obj: BoopsiObject, child: BoopsiObject): number {
    const children = data(this, obj).children
    if (!children.includes(child)) children.push(child)
    data(this, child).parent = obj
    const app = obj.instData<MuiApplicationData>(this.applicationClass)
    this.setObjectContext(child, obj, app.configdata)
    this.rebuildApplicationList(obj)
    return 1
  }

  private applicationRemove(obj: BoopsiObject, child: BoopsiObject): number {
    const children = data(this, obj).children
    const i = children.indexOf(child)
    if (i >= 0) children.splice(i, 1)
    data(this, child).parent = null
    this.setObjectContext(child, null, null)
    const app = obj.instData<MuiApplicationData>(this.applicationClass)
    for (const queued of app.pushed) if (queued.target === child) queued.message = []
    this.rebuildApplicationList(obj)
    return 1
  }

  private setObjectContext(obj: BoopsiObject, application: BoopsiObject | null, configdata: BoopsiObject | null): void {
    data(this, obj).contextApplication = application
    data(this, obj).contextConfigdata = configdata
    for (const child of data(this, obj).children) this.setObjectContext(child, application, configdata)
  }

  private rebuildApplicationList(obj: BoopsiObject): void {
    const app = obj.instData<MuiApplicationData>(this.applicationClass)
    if (!app?.listAddress) return
    if (app.nodesAddress !== 0) {
      this.pool.freeMem(app.nodesAddress)
      const i = data(this, obj).ownedAddresses.indexOf(app.nodesAddress)
      if (i >= 0) data(this, obj).ownedAddresses.splice(i, 1)
      app.nodesAddress = 0
    }
    const windows = data(this, obj).children.filter((child) => child.cl.isA(this.windowClass))
    if (windows.length !== 0) {
      app.nodesAddress = this.pool.alloc(windows.length * 12, { clear: true })
      if (app.nodesAddress !== 0) data(this, obj).ownedAddresses.push(app.nodesAddress)
    }
    const off = app.listAddress - this.pool.base
    this.putPoolLong(off, app.nodesAddress)
    this.putPoolLong(off + 4, 0)
    this.putPoolLong(off + 8, windows.length === 0 ? app.listAddress : app.nodesAddress + (windows.length - 1) * 12)
    for (let i = 0; i < windows.length && app.nodesAddress !== 0; i++) {
      const at = app.nodesAddress - this.pool.base + i * 12
      this.putPoolLong(at, i + 1 < windows.length ? app.nodesAddress + (i + 1) * 12 : 0)
      this.putPoolLong(at + 4, i === 0 ? app.listAddress : app.nodesAddress + (i - 1) * 12)
      this.putPoolLong(at + 8, windows[i]!.address)
    }
  }

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
    const params = p.params ?? []
    const app = obj.instData<MuiApplicationData>(this.applicationClass)
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
        for (const child of data(this, obj).children) if (child.cl.isA(this.windowClass)) this.pollWindow(child)
        const signalAddress = params[0] ?? 0
        const received = signalAddress === 0 ? 0 : (this.readLong?.(signalAddress) ?? 0)
        if (signalAddress !== 0) this.writeLong?.(signalAddress, 0)
        const buffered = received !== 0 ? app.bufferedReturnIDs.shift() : undefined
        if (buffered !== undefined) return buffered
        const returned = data(this, obj).returnIDs.shift()
        if (returned !== undefined) return returned
        const pushed = app.pushed.shift()
        if (pushed && pushed.message.length !== 0) {
          const [method = 0, ...rest] = pushed.message
          pushed.target.cl.dispatcher(pushed.target.cl, pushed.target, { MethodID: method, params: rest } as Msg)
        }
        this.runApplicationInputHandlers(app, received)
        return 0
      }
      case MUI.MUIM_Application_InputBuffered: {
        for (const child of data(this, obj).children) if (child.cl.isA(this.windowClass)) this.pollWindow(child)
        const result = app.bufferedReturnIDs.shift() ?? data(this, obj).returnIDs.shift() ?? 0
        if (result === 0) {
          const pushed = app.pushed.shift()
          if (pushed && pushed.message.length !== 0) {
            const [method = 0, ...rest] = pushed.message
            pushed.target.cl.dispatcher(pushed.target.cl, pushed.target, { MethodID: method, params: rest } as Msg)
          }
          this.runApplicationInputHandlers(app, 0)
        }
        if (result !== 0) app.bufferedReturnIDs.push(result)
        return 0
      }
      case MUI.MUIM_Application_PushMethod: {
        const target = this.boopsi.objectAt(params[0] ?? 0)
        const count = params[1] ?? 0
        if (!target || count < 1 || count > 7 || params.length < count + 2) return 0
        app.pushed.push({ target, message: params.slice(2, count + 2) })
        return 1
      }
      case MUIM_APPLICATION_FLUSH_PUSHED: {
        const target = this.boopsi.objectAt(params[0] ?? 0)
        if (target) for (const queued of app.pushed) if (queued.target === target) queued.message = []
        return 0
      }
      case MUI.MUIM_Application_AddInputHandler: {
        const node = params[0] ?? 0
        if (node !== 0 && !app.inputHandlers.includes(node)) {
          app.inputHandlers.push(node)
          if ((this.readByte(node + 19) & 1) !== 0) {
            app.inputDeadlines.set(node, this.applicationNow() + (this.readLong?.(node + 12) ?? 0))
          }
        }
        return 0
      }
      case MUI.MUIM_Application_RemInputHandler: {
        const i = app.inputHandlers.indexOf(params[0] ?? 0)
        if (i >= 0) app.inputHandlers.splice(i, 1)
        app.inputDeadlines.delete(params[0] ?? 0)
        return 0
      }
      case MUI.MUIM_Application_CheckRefresh:
        for (const child of data(this, obj).children) if (child.cl.isA(this.windowClass)) this.applicationRefresh?.(child)
        return 0
      case MUI.MUIM_Application_SetConfigItem:
        if (app.configdata) this.doMui(app.configdata, MUIM_CONFIGDATA_SET, [params[0] ?? 0, params[1] ?? 0])
        app.configDirty = true
        return 0
      case MUI.MUIM_Application_Save:
      case MUIM_APPLICATION_SAVE_NAMED:
        return this.applicationSaveSettings(obj, params[0] ?? 0)
      case MUI.MUIM_Application_Load:
      case MUIM_APPLICATION_LOAD_NAMED:
        return this.applicationLoadSettings(obj, params[0] ?? 0)
      case MUI.MUIM_Application_SetMenuCheck:
      case MUIM_APPLICATION_SET_MENU_CHECK_PRIVATE:
        return this.applicationSetMenu(obj, params[0] ?? 0, MUI.MUIA_Menuitem_Checked, params[1] ?? 0)
      case MUI.MUIM_Application_GetMenuCheck:
      case MUIM_APPLICATION_GET_MENU_CHECK_PRIVATE:
        return this.applicationGetMenu(obj, params[0] ?? 0, MUI.MUIA_Menuitem_Checked)
      case MUI.MUIM_Application_SetMenuState:
      case MUIM_APPLICATION_SET_MENU_STATE_PRIVATE:
        return this.applicationSetMenu(obj, params[0] ?? 0, MUI.MUIA_Menuitem_Enabled, params[1] ?? 0)
      case MUI.MUIM_Application_GetMenuState:
      case MUIM_APPLICATION_GET_MENU_STATE_PRIVATE:
        return this.applicationGetMenu(obj, params[0] ?? 0, MUI.MUIA_Menuitem_Enabled)
      case MUI.MUIM_Application_ShowHelp:
        return this.applicationHelp?.(obj, this.boopsi.objectAt(params[0] ?? 0), params[3] ?? 0) ?? 0
      case MUI.MUIM_Application_AboutMUI:
        this.applicationAbout?.(obj, this.boopsi.objectAt(params[0] ?? 0))
        return 0
      case MUI.MUIM_Application_OpenConfigWindow:
        return this.applicationConfig?.(obj, true) ?? 0
      case MUIM_APPLICATION_CLOSE_CONFIG:
        this.applicationConfig?.(obj, false)
        return 0
      case MUIM_APPLICATION_APPLY_CONFIG:
      case MUIM_APPLICATION_CONFIG_RESPONSE:
        app.configDirty = false
        return 0
      case MUIM_APPLICATION_WAKE_CONFIG:
        app.configDirty = true
        return 0
      case MUIM_APPLICATION_DEFAULT_NAME:
        return params[0] ?? 0
      case MUIM_APPLICATION_PREFS_AVAILABLE:
        return this.applicationLoad === null ? 0 : 1
      case MUIM_APPLICATION_FIND_WINDOW: {
        const wanted = params[0] ?? 0
        for (const child of data(this, obj).children) {
          if (child.cl.isA(this.windowClass) && (this.get(child, MUI.MUIA_Window_Window) ?? 0) === wanted) return child.address
        }
        return 0
      }
      case MUIM_APPLICATION_BROADCAST:
        for (const child of data(this, obj).children) child.cl.dispatcher(child.cl, child, msg)
        return 0
      case MUIM_APPLICATION_REXX_COMMAND:
        // Its only application-specific effect is invoking guest hooks, the
        // explicit boundary of this port; queued MC_TEMPLATE_ID commands
        // already arrive through ReturnID.
        return 0
      case MUIM_APPLICATION_NEW_PREFS:
      case MUIM_APPLICATION_HELP_REQUEST:
      case MUIM_APPLICATION_REQUEST:
      case MUIM_APPLICATION_NOOP:
        // These construct separately shipped helper classes or system
        // requesters. Their user-visible paths are the callbacks above.
        return 0
      case MUI.MUIM_FindUData:
      case MUI.MUIM_GetUData:
      case MUI.MUIM_SetUData:
        return this.applicationUserData(obj, msg)
      default:
        return null
    }
  }

  private runApplicationInputHandlers(app: MuiApplicationData, received: number): void {
    for (const address of [...app.inputHandlers]) {
      const target = this.boopsi.objectAt(this.readLong?.(address + 8) ?? 0)
      const signals = this.readLong?.(address + 12) ?? 0
      const method = this.readLong?.(address + 20) ?? 0
      const flags = this.readByte(address + 19)
      const timer = (flags & 1) !== 0
      const due = !timer || this.applicationNow() >= (app.inputDeadlines.get(address) ?? 0)
      if (target && method !== 0 && due && (timer || received === 0 || (signals & received) !== 0)) {
        this.doMui(target, method, [received, address])
        if (timer) app.inputDeadlines.set(address, this.applicationNow() + Math.max(1, signals))
      }
    }
  }

  private applicationSaveSettings(obj: BoopsiObject, name: number): number {
    if (!this.applicationSave) return 0
    const ds = this.newObjectA(MUIC.MUIC_Dataspace)
    if (!ds) return 0
    try {
      for (const child of data(this, obj).children) this.doMui(child, MUI.MUIM_Export, [ds.address])
      const entries = ds.instData<MuiDataspaceData>(this.dataspaceClass).entries
      const payloadSize = entries.reduce((size, entry) => size + 8 + entry.length, 0)
      const bytes = new Uint8Array(20 + payloadSize + (payloadSize & 1))
      putLong(bytes, 0, 0x464f524d) // FORM
      putLong(bytes, 4, bytes.length - 8)
      putLong(bytes, 8, 0x50524546) // PREF
      putLong(bytes, 12, 0x4d554943) // MUIC
      putLong(bytes, 16, payloadSize)
      let at = 20
      for (const entry of entries) {
        putLong(bytes, at, entry.id)
        putLong(bytes, at + 4, entry.length)
        bytes.set(this.pool.buffer.subarray(entry.address - this.pool.base + 16, entry.address - this.pool.base + 16 + entry.length), at + 8)
        at += 8 + entry.length
      }
      return this.applicationSave(obj, name, bytes) ? 1 : 0
    } finally {
      this.disposeObject(ds)
    }
  }

  private applicationLoadSettings(obj: BoopsiObject, name: number): number {
    const bytes = this.applicationLoad?.(obj, name) ?? null
    if (!bytes || bytes.length < 20 || getLong(bytes, 0) !== 0x464f524d || getLong(bytes, 8) !== 0x50524546 || getLong(bytes, 12) !== 0x4d554943) return 0
    const payloadSize = getLong(bytes, 16)
    if (payloadSize > bytes.length - 20) return 0
    const ds = this.newObjectA(MUIC.MUIC_Dataspace)
    if (!ds) return 0
    try {
      const d = ds.instData<MuiDataspaceData>(this.dataspaceClass)
      let at = 20
      const end = 20 + payloadSize
      while (at + 8 <= end) {
        const id = getLong(bytes, at)
        const length = getLong(bytes, at + 4)
        at += 8
        if (length > end - at) return 0
        this.dataspaceAddBytes(d, bytes.subarray(at, at + length), id)
        at += length
      }
      if (at !== end) return 0
      for (const child of data(this, obj).children) this.doMui(child, MUI.MUIM_Import, [ds.address])
      return 1
    } finally {
      this.disposeObject(ds)
    }
  }

  private applicationUserData(obj: BoopsiObject, msg: Msg): number {
    const params = (msg as Msg & { params?: readonly number[] }).params ?? []
    if (msg.MethodID === MUI.MUIM_FindUData && (this.peek(obj, MUI.MUIA_UserData) ?? 0) === (params[0] ?? 0)) return obj.address
    if (msg.MethodID !== MUI.MUIM_FindUData && (this.peek(obj, MUI.MUIA_UserData) ?? 0) === (params[0] ?? 0)) {
      if (msg.MethodID === MUI.MUIM_GetUData) return this.getToAddress(obj, params[1] ?? 0, params[2] ?? 0)
      this.set(obj, params[1] ?? 0, params[2] ?? 0)
    }
    const app = obj.instData<MuiApplicationData>(this.applicationClass)
    const targets = [...(app.configdata ? [app.configdata] : []), ...data(this, obj).children]
    for (const target of targets) {
      const answer = this.doMui(target, msg.MethodID, params)
      if (msg.MethodID === MUI.MUIM_FindUData || msg.MethodID === MUI.MUIM_GetUData) {
        if (answer !== 0) return answer
      }
    }
    return 0
  }

  private applicationMenuitem(obj: BoopsiObject, id: number): BoopsiObject | null {
    const found = this.doMui(obj, MUI.MUIM_FindUData, [id])
    const item = this.boopsi.objectAt(found)
    return item?.cl.isA(this.menuitemClass) ? item : null
  }

  private applicationSetMenu(obj: BoopsiObject, id: number, attr: number, value: number): number {
    const item = this.applicationMenuitem(obj, id)
    return item ? this.set(item, attr, value) : 0
  }

  private applicationGetMenu(obj: BoopsiObject, id: number, attr: number): number {
    const item = this.applicationMenuitem(obj, id)
    return item ? (this.get(item, attr) ?? 2) : 2
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
      case 'Slider': {
        const slider = obj.instData<MuiSliderData>(this.sliderClass)
        const label = this.sliderLabelSize(obj)
        if (slider.horizontal) {
          add(label.width + 1, label.height, MUI_MAXMAX, label.height, label.width * 4, label.height)
        } else {
          add(label.width, label.height + 1, label.width, MUI_MAXMAX, label.width, label.height * 4)
        }
        return 0
      }
      case 'Rectangle':
        if ((this.peek(obj, MUI.MUIA_Rectangle_HBar) ?? 0) !== 0) {
          const title = this.textOf(obj, MUI.MUIA_Rectangle_BarTitle)
          if (title !== '') add(visibleLength(title) * fx + 12, fy + 1, MUI_MAXMAX, MUI_MAXMAX)
          else add(2, 2, MUI_MAXMAX, MUI_MAXMAX)
        } else if ((this.peek(obj, MUI.MUIA_Rectangle_VBar) ?? 0) !== 0) {
          add(2, 2, MUI_MAXMAX, MUI_MAXMAX)
        } else {
          // a spacer: no content, and unlimited in both directions
          add(0, 0, MUI_MAXMAX, MUI_MAXMAX)
        }
        return 0
      case 'Balance': {
        const parent = data(this, obj).parent
        if (!parent?.cl.isA(this.groupClass)) add(3, 3, 3, 3)
        else if (this.balanceHorizontalGroup(obj)) add(3, 3, 3, MUI_MAXMAX)
        else add(3, 3, MUI_MAXMAX, 3)
        return 0
      }
      case 'Text':
        {
          const text = this.textDimensions(obj)
          add(
            (this.peek(obj, MUI.MUIA_Text_SetMin) ?? 1) !== 0 ? text.width : 0,
            text.height,
            (this.peek(obj, MUI.MUIA_Text_SetMax) ?? 0) !== 0 ? text.width : MUI_MAXMAX,
            (this.peek(obj, MUI.MUIA_Text_SetVMax) ?? 1) !== 0 ? text.height : MUI_MAXMAX,
            text.width,
            text.height,
          )
        }
        return 0
      case 'String': {
        // 19.35 adds these exact values after Gadget/Area's own frame bounds.
        add(20, fy, MUI_MAXMAX, fy, 100, fy)
        return 0
      }
      case 'Prop': {
        const d = obj.instData<MuiPropData>(this.propClass)
        if (d.useWinBorder !== MUI.MUIV_Prop_UseWinBorder_None) {
          add(0, 0, d.horizontal ? MUI_MAXMAX : 0, d.horizontal ? 0 : MUI_MAXMAX)
        } else if (d.horizontal) add(12, 6, MUI_MAXMAX, MUI_MAXMAX, 50, 6)
        else add(6, 12, MUI_MAXMAX, MUI_MAXMAX, 6, 50)
        return 0
      }
      case 'List': {
        const d = obj.instData<MuiListData>(this.listClass)
        const adjustHeight = (this.peek(obj, MUI.MUIA_List_AdjustHeight) ?? 0) !== 0
        const adjustWidth = (this.peek(obj, MUI.MUIA_List_AdjustWidth) ?? 0) !== 0
        const title = this.textOf(obj, MUI.MUIA_List_Title)
        const widest = Math.max(0, title.length, ...d.entries.map((entry) => visibleLength(this.textOfAddress(entry.address)))) * fx
        const rows = Math.max(3, d.entries.length + (title === '' ? 0 : 1))
        const width = adjustWidth ? widest : 40
        const height = adjustHeight ? rows * d.lineHeight : 3 * d.lineHeight
        add(width, height, adjustWidth ? width : MUI_MAXMAX, adjustHeight ? height : MUI_MAXMAX,
          adjustWidth ? width : 100, adjustHeight ? height : 8 * d.lineHeight)
        return 0
      }
      case 'Image':
        // Old Intuition images are fixed at their struct Image dimensions;
        // resolved MUI specs expose one independently stretchable axis for
        // each Free* flag.
        {
          const image = this.imageMetrics(obj)
          add(image.minW, image.minH, image.maxW, image.maxH, image.defW, image.defH)
        }
        return 0
      case 'Bitmap':
        // The class deliberately does not constrain itself to the source
        // bitmap: the shipped handler adds 1/1 and 10000/10000 verbatim.
        add(1, 1, MUI_MAXMAX, MUI_MAXMAX)
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
    const each = kids.map((k) => this.minMaxOf(k) ?? this.askMinMax(k))
    if ((this.peek(obj, MUI.MUIA_Group_PageMode) ?? 0) !== 0) {
      mm.minW += Math.max(...each.map((m) => m.minW))
      mm.minH += Math.max(...each.map((m) => m.minH))
      mm.defW += Math.max(...each.map((m) => m.defW))
      mm.defH += Math.max(...each.map((m) => m.defH))
      mm.maxW += Math.min(...each.map((m) => m.maxW))
      mm.maxH += Math.min(...each.map((m) => m.maxH))
      return
    }
    const shape = this.groupShape(obj, kids.length)
    if (shape.columns > 1 && shape.rows > 1) {
      const hspace = this.spacingOf(obj, true) * (shape.columns - 1)
      const vspace = this.spacingOf(obj, false) * (shape.rows - 1)
      const columns = Array.from({ length: shape.columns }, (_, column) => each.filter((_, i) => i % shape.columns === column))
      const rows = Array.from({ length: shape.rows }, (_, row) => each.slice(row * shape.columns, (row + 1) * shape.columns))
      const sameW = (this.peek(obj, MUI.MUIA_Group_SameWidth) ?? 0) !== 0
      const sameH = (this.peek(obj, MUI.MUIA_Group_SameHeight) ?? 0) !== 0
      const width = (key: keyof MinMax): number => sameW
        ? Math.max(...each.map((m) => m[key])) * shape.columns
        : columns.reduce((sum, column) => sum + Math.max(...column.map((m) => m[key])), 0)
      const height = (key: keyof MinMax): number => sameH
        ? Math.max(...each.map((m) => m[key])) * shape.rows
        : rows.reduce((sum, row) => sum + Math.max(...row.map((m) => m[key])), 0)
      mm.minW += width('minW') + hspace
      mm.defW += width('defW') + hspace
      mm.maxW += width('maxW') + hspace
      mm.minH += height('minH') + vspace
      mm.defH += height('defH') + vspace
      mm.maxH += height('maxH') + vspace
      return
    }
    const horiz = (this.peek(obj, MUI.MUIA_Group_Horiz) ?? 0) !== 0
    const gaps = this.spacingOf(obj, horiz) * (kids.length - 1)

    const sum = (f: (m: MinMax) => number): number => each.reduce((a, m) => a + f(m), 0)
    const most = (f: (m: MinMax) => number): number => each.reduce((a, m) => Math.max(a, f(m)), 0)

    if (horiz) {
      const same = (this.peek(obj, MUI.MUIA_Group_SameWidth) ?? 0) !== 0
      mm.minW += (same ? most((m) => m.minW) * kids.length : sum((m) => m.minW)) + gaps
      mm.defW += (same ? most((m) => m.defW) * kids.length : sum((m) => m.defW)) + gaps
      mm.maxW += (same ? Math.min(...each.map((m) => m.maxW)) * kids.length : sum((m) => m.maxW)) + gaps
      mm.minH += most((m) => m.minH)
      mm.defH += most((m) => m.defH)
      mm.maxH += Math.min(...each.map((m) => m.maxH))
    } else {
      const same = (this.peek(obj, MUI.MUIA_Group_SameHeight) ?? 0) !== 0
      mm.minH += (same ? most((m) => m.minH) * kids.length : sum((m) => m.minH)) + gaps
      mm.defH += (same ? most((m) => m.defH) * kids.length : sum((m) => m.defH)) + gaps
      mm.maxH += (same ? Math.min(...each.map((m) => m.maxH)) * kids.length : sum((m) => m.maxH)) + gaps
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
    return this.textOfAddress(at)
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
      if (t.tag === MUI.MUIA_NoNotify) continue
      const n = nameOf(t.tag)
      if (MUI_OWNER[n] !== name && !(name === 'Family' && t.tag === MUI.MUIA_Group_Child)) continue
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
    const params = p.params ?? []
    switch (msg.MethodID) {
      case MUI.MUIM_Set: {
        // MUIP_Set { MethodID; attr; value } — EasyLife's Mui Set and Mui Set
        // Str both send this rather than OM_SET, which is why routine 206's
        // inline message is three longwords rather than a taglist
        const [attr = 0, value = 0] = params
        return this.set(obj, attr, value)
      }
      case MUI.MUIM_NoNotifySet: {
        const [attr = 0, value = 0] = params
        this.suppressNotifications++
        try {
          return this.set(obj, attr, value)
        } finally {
          this.suppressNotifications--
        }
      }
      case MUI.MUIM_Notify: {
        // MUIP_Notify { MethodID; TrigAttr; TrigVal; DestObj; FollowParams... }
        const [trigAttr = 0, trigVal = 0, dest = 0, countWord = 0, ...follow] = params
        const count = TAG(countWord) & 0x7fffffff
        data(this, obj).notifies.push({
          trigAttr: TAG(trigAttr),
          trigVal,
          dest: this.boopsi.objectAt(dest) ?? dest,
          params: follow.slice(0, count),
          killableAll: (TAG(countWord) & 0x80000000) !== 0,
        })
        return 1
      }
      case MUI.MUIM_KillNotify: {
        return this.killNotify(obj, params[0] ?? 0, 0)
      }
      case MUI.MUIM_KillNotifyObj:
        return this.killNotify(obj, params[0] ?? 0, params[1] ?? 0)
      case MUI.MUIM_CallHook:
        // Guest 68k hook execution is the explicit boundary of this port.
        return 0
      case MUI.MUIM_SetAsString: {
        const [attr = 0, formatAddress = 0, ...args] = params
        const format = this.textOfAddress(formatAddress)
        let ai = 0
        const text = format.replace(/%%|%(-?)(\d*)(ld|lu|s)/g, (spec, _minus: string, _width: string, kind: string) => {
          if (spec === '%%') return '%'
          const value = args[ai++] ?? 0
          return rtFormat(spec, kind === 's' ? this.textOfAddress(value) : value)
        })
        const bytes = Uint8Array.from([...text.slice(0, 1023), '\0'], (c) => c.charCodeAt(0))
        const address = this.pool.alloc(bytes.length)
        if (address === 0) return 0
        this.pool.buffer.set(bytes, address - this.pool.base)
        data(this, obj).ownedAddresses.push(address)
        return this.set(obj, attr, address)
      }
      case MUI.MUIM_MultiSet: {
        const [attr = 0, value = 0, ...objects] = params
        for (const address of objects) {
          if (address === 0) break
          const target = this.boopsi.objectAt(address)
          if (target) this.set(target, attr, value)
        }
        return 0
      }
      case MUI.MUIM_WriteLong:
        this.writeLong?.(params[1] ?? 0, params[0] ?? 0)
        return 0
      case MUI.MUIM_WriteString: {
        const text = params[0] === 0 ? '' : this.textOfAddress(params[0] ?? 0)
        this.writeMemory?.(params[1] ?? 0, Uint8Array.from([...text, '\0'], (c) => c.charCodeAt(0)))
        return 0
      }
      case MUIM_NOTIFY_SET_CONTEXT: {
        const context = this.boopsi.objectAt(params[0] ?? 0)
        if (context?.cl.isA(this.applicationClass)) data(this, obj).contextApplication = context
        if (context?.cl.isA(this.configdataClass)) data(this, obj).contextConfigdata = context
        return 0
      }
      case MUI.MUIM_FindUData:
        return (this.peek(obj, MUI.MUIA_UserData) ?? 0) === (params[0] ?? 0) ? obj.address : 0
      case MUI.MUIM_SetUData:
      case MUI.MUIM_SetUDataOnce:
        if ((this.peek(obj, MUI.MUIA_UserData) ?? 0) !== (params[0] ?? 0)) return 0
        this.set(obj, params[1] ?? 0, params[2] ?? 0)
        return 1
      case MUI.MUIM_GetUData:
        if ((this.peek(obj, MUI.MUIA_UserData) ?? 0) !== (params[0] ?? 0)) return 0
        return this.getToAddress(obj, params[1] ?? 0, params[2] ?? 0)
      case MUI.MUIM_GetConfigItem: {
        this.sharedConfigdata ??= this.newObjectA(MUIC.MUIC_Configdata)
        const config = data(this, obj).contextConfigdata ?? this.sharedConfigdata
        return config
          ? this.doMui(config, MUIM_CONFIGDATA_GET, [params[0] ?? 0, params[1] ?? 0])
          : 0
      }
      case MUIM_NOTIFY_IS_SELF:
        return params[0] === obj.address ? obj.address : 0
      default:
        return doSuperMethodA(cl, obj, msg)
    }
  }

  private killNotify(obj: BoopsiObject, trigAttr: number, destAddress: number): number {
    const d = data(this, obj)
    const i = d.notifies.findIndex((n) => {
      const dest = typeof n.dest === 'number' ? n.dest : n.dest.address
      const attrMatches = TAG(trigAttr) === MUIV_KILLNOTIFY_ALL ? n.killableAll === true : n.trigAttr === TAG(trigAttr)
      return (destAddress === 0 || dest === destAddress) && attrMatches
    })
    if (i >= 0) d.notifies.splice(i, 1)
    return 0
  }

  private getToAddress(obj: BoopsiObject, attr: number, storage: number): number {
    const value = this.get(obj, attr)
    if (value === null) return 0
    this.writeLong?.(storage, value)
    return 1
  }

  private textOfAddress(address: number): string {
    if (address >= this.pool.base && address < this.pool.base + this.pool.buffer.length) {
      let out = ''
      for (let at = address - this.pool.base; at < this.pool.buffer.length && this.pool.buffer[at] !== 0; at++) {
        out += String.fromCharCode(this.pool.buffer[at]!)
      }
      return out
    }
    return address === 0 ? '' : (this.readString?.(address) ?? '')
  }

  private sameText(a: number, b: number): boolean {
    return a === b || this.textOfAddress(a) === this.textOfAddress(b)
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
    if (this.suppressNotifications !== 0) return
    for (const n of [...data(this, obj).notifies]) {
      if (n.trigAttr !== attr) continue
      if (n.trigVal !== value && TAG(n.trigVal) !== MUI.MUIV_EveryTime) continue
      const dest = this.resolveDest(obj, n.dest)
      if (!dest || n.params.length === 0) continue
      let substitutions = 0
      const params = n.params.map((v) => {
        if (substitutions >= 4) return v
        if (TAG(v) === MUI.MUIV_TriggerValue) {
          substitutions++
          return value
        }
        if (TAG(v) === MUI.MUIV_NotTriggerValue) {
          substitutions++
          return value === 0 ? 1 : 0
        }
        return v
      })
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

const getLong = (bytes: Uint8Array, at: number): number =>
  (((bytes[at]! << 24) | (bytes[at + 1]! << 16) | (bytes[at + 2]! << 8) | bytes[at + 3]!) >>> 0)

function putLong(bytes: Uint8Array, at: number, value: number): void {
  bytes[at] = value >>> 24
  bytes[at + 1] = value >>> 16
  bytes[at + 2] = value >>> 8
  bytes[at + 3] = value
}

function putWord(bytes: Uint8Array, at: number, value: number): void {
  bytes[at] = value >>> 8
  bytes[at + 1] = value
}

function hexBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length >> 1)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

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
// Slider's four old spellings share Numeric's numeric values. They are not a
// second set of attributes owned by Slider: Numeric's 19.35 dispatcher reads
// them, and Slider reaches that dispatcher through its superclass.
TAG_NAME.set(MUI.MUIA_Numeric_Min, 'MUIA_Numeric_Min')
TAG_NAME.set(MUI.MUIA_Numeric_Max, 'MUIA_Numeric_Max')
TAG_NAME.set(MUI.MUIA_Numeric_Value, 'MUIA_Numeric_Value')
TAG_NAME.set(MUI.MUIA_Numeric_Reverse, 'MUIA_Numeric_Reverse')

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
