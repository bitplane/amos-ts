import type { TokenEntry } from '../tokens/libtok'
import { scanOsCalls, type OsCall } from './oscalls'
import { libLayout, routineAddresses } from './routines'

export type OsBackendStatus = 'faithful' | 'partial' | 'missing' | 'review'

export interface OsBackendRow {
  name: string
  tokenId: number
  routines: number[]
  namespace: string
  status: OsBackendStatus
  family: string
  reason: string
  /** Entry routines after following the extension's Rbra forwarding chain. */
  workers: number[]
  eightByteRoutines: number[]
  /** Calls made by the resolved worker routine, deduplicated by library/LVO. */
  osCalls: OsCall[]
}

/** Families whose absence is already established, kept as executable data. */
const MISSING: Array<{ family: string; names: (name: string, namespace: string) => boolean }> = [
]

/** Backends with concrete machine-layer modules; operation coverage still needs review. */
const MODELLED = new Map<string, string>([
  ['_mem', 'exec'], ['_nod', 'exec'], ['_lnod', 'exec'], ['_port', 'exec'], ['_msg', 'exec'],
  ['_sig', 'exec'], ['_int', 'exec'], ['_task', 'exec'], ['_scr', 'intuition'], ['_wnd', 'intuition'],
  ['_gad', 'intuition'], ['_it', 'intuition'], ['_req', 'intuition'], ['_disp', 'intuition'],
  ['_mouse', 'intuition'], ['_ibase', 'intuition'], ['_rp', 'graphics'], ['_area', 'graphics'],
  ['_rast', 'graphics'], ['_blt', 'graphics'], ['_cop', 'graphics'], ['_font', 'graphics'],
  ['_spr', 'graphics'], ['_cm', 'graphics'], ['_rgb4', 'graphics'], ['_rgb32', 'graphics'],
  ['_bm', 'graphics'], ['_vp', 'graphics'], ['_view', 'graphics'], ['_ri', 'graphics'],
  ['_tr', 'graphics'], ['_tmpras', 'graphics'], ['_scale', 'graphics'], ['_ggad', 'gadtools'],
  ['_gt', 'gadtools'], ['_gmn', 'gadtools'], ['_menu', 'gadtools'], ['_dos', 'dos'],
  ['_cli', 'dos'], ['_lock', 'dos'], ['_file', 'dos'], ['_fh', 'dos'], ['_asl', 'asl'],
  ['_icon', 'icon'], ['_dt', 'datatypes'], ['_loc', 'locale'], ['_cat', 'locale'],
  ['_joy', 'lowlevel'], ['_layer', 'layers'], ['_li', 'layers'], ['_iff', 'iffparse'],
  ['_chunk', 'iffparse'], ['_cx', 'commodities'], ['_event', 'commodities'],
  ['_wb', 'workbench'], ['_app', 'workbench'],
])

const AUDITED = new Map<string, { status: OsBackendStatus; reason: string }>([
  ['_help ctrl', { status: 'faithful', reason: 'V39 HelpControl flags are retained on the shared native Window exactly' }],
  ['_ag display', { status: 'partial', reason: 'the process-wide parser, client navigation lifecycle and returned closed handle are shared; this synchronous wrapper does not open the host file-viewer UI' }],
  ['_ag show', { status: 'partial', reason: 'the AMOS-string wrapper shares parsed AmigaGuide clients and navigation; this synchronous wrapper does not open the host file-viewer UI' }],
  ['_prfs get def', { status: 'faithful', reason: 'the obsolete shipped worker discards its argument and clears both integer result registers' }],
  ['_prfs get', { status: 'faithful', reason: 'the obsolete shipped worker aliases _prfs get def and returns zero without reading Preferences' }],
  ['_prfs set', { status: 'faithful', reason: 'the obsolete shipped worker discards both arguments and clears both integer result registers' }],
  ['_dt init', { status: 'faithful', reason: 'OpenLibrary(datypes.library, 39) succeeds against the V40 registry entry' }],
  ['_dt obtain', { status: 'partial', reason: 'memory descriptor matching exists, but tie ordering is not yet binary-faithful' }],
  ['_dt release', { status: 'faithful', reason: 'shared immutable descriptors make ReleaseDataType observably a no-op' }],
  ['_dt create', { status: 'partial', reason: 'shared objects decode installed picture and sound classes, FTXT, and parsed AmigaGuide documents; remaining class methods are incomplete' }],
  ['_dt delete', { status: 'faithful', reason: 'shared datatype object allocation and disposal have one native-address lifecycle' }],
  ['_dt set attrs', { status: 'partial', reason: 'native TagItem attributes persist on shared objects; arbitrary datatype-class side effects remain incomplete' }],
  ['_dt what attrs', { status: 'partial', reason: 'generic, picture, sound, FTXT and AmigaGuide attributes include native planar BitMap and FrameInfo records; remaining class attributes are incomplete' }],
  ['_dt add', { status: 'partial', reason: 'object/window/requester attachment and position are retained without full class rendering' }],
  ['_dt remove', { status: 'partial', reason: 'shared attachment state is removed and returns its prior position; class rendering cleanup remains incomplete' }],
  ['_dt refresh', { status: 'partial', reason: 'attachment and attributes refresh on the shared object; datatype-class layout/rendering remains incomplete' }],
  ['_dt what methods', { status: 'partial', reason: 'stable class-specific native method lists include picture drawing and AmigaGuide DTM_GOTO; remaining methods are incomplete' }],
  ['_dt what triggers', { status: 'partial', reason: 'the sound.datatype 39.5 Play/PLAY DTMethod is exposed exactly; other installed classes have no modelled triggers' }],
  ['_dt do', { status: 'partial', reason: 'dispatches native frame-box, layout, removal, copy, write, picture-draw, sound STM_PLAY and AmigaGuide DTM_GOTO messages; remaining class-specific methods are incomplete' }],
  ['_dt str$', { status: 'partial', reason: 'the built-in DataTypes strings are exposed; locale/catalog selection remains incomplete' }],
  ['_sys own', { status: 'partial', reason: 'shared SystemControlA takeover state is retained; no scheduler or interrupt suppression exists for ownership to affect yet' }],
  ['_sys disown', { status: 'partial', reason: 'shared SystemControlA takeover state is released; no scheduler or interrupt suppression exists for ownership to affect yet' }],
  ['_joy set', { status: 'partial', reason: 'port type forcing exists, but hardware autosense is represented by host state' }],
  ['_joy init', { status: 'partial', reason: 'port autosense exists, but hardware polling is represented by host state' }],
  ['_joy read', { status: 'partial', reason: 'joyport bits are modelled; mouse motion and hardware polling are not' }],
  ['_joy type', { status: 'partial', reason: 'joyport type is modelled; hardware autosense is represented by host state' }],
  ['_time elapsed', { status: 'partial', reason: 'elapsed-time state is modelled at frame rather than E-clock granularity' }],
  ['_key pressed', { status: 'partial', reason: 'the managed backend deterministically returns the lowest held raw key; the shipped no-argument worker leaves QueryKeys a0/d1 uninitialized, so its accidental native result cannot be reproduced' }],
  ['_loc init', { status: 'faithful', reason: 'OpenLibrary(locale.library, 38) succeeds at the requested version' }],
  ['_loc open', { status: 'partial', reason: 'OpenLocale is represented by the fixed built-in English locale, not user preferences' }],
  ['_loc close', { status: 'faithful', reason: 'the immutable built-in Locale has no observable close lifecycle' }],
  ['_loc str', { status: 'partial', reason: 'GetLocaleStr is modelled, but the open locale is fixed rather than preference-selected' }],
  ['_cat open', { status: 'partial', reason: 'catalog decoding is faithful, but locale path selection and OpenCatalog tags are not modelled' }],
  ['_cat close', { status: 'faithful', reason: 'parsed catalogs need no observable close lifecycle' }],
  ['_cat str', { status: 'faithful', reason: 'GetCatalogStr returns the catalog value or caller default exactly' }],
  ['_asl alloc', { status: 'partial', reason: 'all three requester types allocate caller-visible native prefixes and retain allocation TagItems; unsupported ASL flags do not yet affect presentation' }],
  ['_asl do', { status: 'partial', reason: 'allocation and request TagItems configure the shared file, font and screen-mode dialogs; specialized filtering and every presentation flag remain incomplete' }],
  ['_asl free', { status: 'faithful', reason: 'requester state has no observable resources after the modal request ends' }],
  ['_asl what file', { status: 'faithful', reason: 'the file requester preserves its selected file field' }],
  ['_asl what drawer', { status: 'faithful', reason: 'the file requester preserves its selected drawer field' }],
  ['_asl what nb args', { status: 'faithful', reason: 'the worker reads the exact fr_NumArgs long at offset 32 of caller-visible requester memory' }],
  ['_asl what font', { status: 'faithful', reason: 'the worker returns the address of the embedded TextAttr at requester offset eight exactly' }],
  ['_asl file$', { status: 'faithful', reason: 'the modal file requester and joined selected path are modelled' }],
  ['_icon kill', { status: 'faithful', reason: 'DeleteDiskObject removes the shared VFS .info file with icon.library suffix rules' }],
  ['_icon free', { status: 'faithful', reason: 'shared DiskObjects have one native-address allocation and free lifecycle' }],
  ['_icon def', { status: 'partial', reason: 'default DiskObjects cover every icon type and owned field; ROM artwork and full DrawerData defaults are not reproduced' }],
  ['_icon load', { status: 'partial', reason: 'DiskObject files retain images, strings, coordinates and exact DrawerData; unused raw Gadget flags and pointer identities are normalized' }],
  ['_icon save', { status: 'partial', reason: 'PutDiskObject round-trips all retained public fields; unused raw Gadget flags and allocation pointer identities are normalized' }],
  ['_icon info', { status: 'partial', reason: 'the icon is resolved and validated, but the Workbench information window is not rendered' }],
  ['_icon get', { status: 'partial', reason: 'machine code aliases _icon load after AMOS path conversion' }],
  ['_icon del', { status: 'faithful', reason: 'machine code aliases the shared DeleteDiskObject path after AMOS path conversion' }],
  ['_icon put', { status: 'partial', reason: 'machine code aliases the shared public-field PutDiskObject serializer after AMOS path conversion' }],
  ['_li new', { status: 'partial', reason: 'dimensionless native ownership now wraps LayerInfo, with bitmap dimensions bound by the first created layer; the raw Layer_Info layout is not exposed' }],
  ['_li free', { status: 'partial', reason: 'owned native Layer wrappers are invalidated and freed with LayerInfo, but the raw Layer_Info layout is not exposed' }],
  ['_layer create behind', { status: 'partial', reason: 'native identity, bitmap binding, geometry, refresh type, backdrop and ordering are integrated; RastPort and executable backfill hooks are not' }],
  ['_layer create upfront', { status: 'partial', reason: 'native identity, bitmap binding, geometry, refresh type, backdrop and ordering are integrated; RastPort and executable backfill hooks are not' }],
  ['_layer delete', { status: 'partial', reason: 'native ownership, chain deletion and exposure are integrated; bitmap restoration and executable backfill hooks are not' }],
])

/**
 * The operation-level OS DevKit verdict used by both the binary audit and the
 * generated keyword manifest. It deliberately needs no fixture: the held
 * binary is evidence checked by auditOsBackend, not a runtime dependency of
 * coverage generation.
 */
export function osBackendVerdict(name: string): Readonly<{ status: OsBackendStatus; reason: string }> | undefined {
  return AUDITED.get(name.replace(/^!/, '').trim().toLowerCase())
}

const auditMany = (status: OsBackendStatus, reason: string, names: readonly string[]): void => {
  for (const name of names) {
    if (AUDITED.has(name)) throw new Error(`duplicate OS backend audit verdict for ${name}`)
    AUDITED.set(name, { status, reason })
  }
}

auditMany('faithful', 'the shared iffparse.library base and exact public ContextNode hierarchy and fields are exposed directly', [
  '_iff init', '_base iff', '_chunk current', '_chunk parent',
  '_chunk what size', '_chunk what scan', '_chunk what type', '_chunk what id',
])
auditMany('partial', 'shared iffparse handles implement SCAN/STEP/RAWSTEP, nested scopes and streamed I/O; native DOS stream-handle identity and installed callback handlers remain outside the backend', [
  '_iff parse', '_iff open in', '_iff open out', '_iff close',
  '_chunk read', '_chunk write', '_chunk child', '_chunk end',
])
auditMany('faithful', 'the shared commodities.library base, broker lifecycle, Cx object graph, activation and error state are represented exactly', [
  '_cx init', '_base cx', '_cx uninstall', '_cx broker', '_cx enable', '_cx disable',
  '_cx id base', '_cx id create', '_cx id delete', '_cx msg port', '_cx id type', '_cx id error',
  '_cx id clear error', '_cx id activate', '_cx id inactivate', '_cx id attach', '_cx id remove',
])
auditMany('partial', 'broker installation cannot detect commodities owned by other host processes, and the runtime input stream does not yet synthesize every commodity event', [
  '_cx install',
  '_cx id wait event', '_cx id next event', '_cx id event type', '_cx id event id', '_cx id event data',
])
auditMany('faithful', 'the shared Intuition Workbench screen owns open/close and front/back ordering with visitor and public-lock refusal', [
  '_wb open', '_wb close', '_wb to back', '_wb to front',
])
auditMany('partial', 'one workbench.library AppItem registry supplies native addresses, Exec ports, the complete public AppMessage and owned automatic icon-drop WBArg/name payloads; desktop AppIcon/menu/window rendering remains incomplete', [
  '_app add icon', '_app add menu', '_app add wnd', '_app rem icon', '_app rem menu', '_app rem wnd', '_wb msg',
])

auditMany('faithful', 'the GadTools structure field or managed-object lifecycle is represented exactly', [
  '_ggad def body', '_ggad def text', '_ggad def id', '_ggad def flags', '_ggad def user', '_ggad def vinf',
  '_ggad def font', '_ggad context', '_ggad free', '_ggad vinf free', '_ggad vinf get', '_ggad wdef left',
  '_ggad wdef top', '_ggad wdef width', '_ggad wdef height', '_ggad wdef text', '_ggad wdef font', '_ggad wdef id',
  '_ggad wdef flags', '_ggad wdef user', '_ggad wdef vinf', '_ggad define', '_ggad add',
])
auditMany('partial', 'the GadTools operation exists but arbitrary native tags or rendering side effects are not all modelled', [
  '_ggad set attrs', '_ggad create', '_ggad draw box', '_ggad what attrs', '_ggad refresh',
])
auditMany('faithful', 'the NewMenu list and GadTools menu-tree operation are represented exactly', [
  '_gmn set', '_gmn list alloc', '_gmn list free', '_gmn end', '_gmn create', '_gmn free', '_gmn layout',
  '_menu off', '_menu on', '_menu what address', '_menu what menu nb', '_menu what item nb',
  '_menu what sub nb', '_menu what flags', '_menu what user', '_menu what next sel',
  '_menu set', '_menu clear', '_menu share',
])
auditMany('partial', 'shared GadTools owns high-level gadget/menu banks, BOOPSI and image objects, attachment, refresh and events; native rendering, TextAttr use and every tag edge remain incomplete', [
  '_gt refresh wnd', '_gt begin refresh', '_gt end refresh', '_gt create',
  '_gt gadgets bank', '_gt gadgets erase', '_gt gadgets attach', '_gt gadgets remove', '_gt set mode',
  '_gt button', '_gt checkbox', '_gt set checkbox', '_gt cycle', '_gt set cycle', '_gt set integer mode',
  '_gt integer', '_gt set integer', '_gt what integer', '_gt set listview mode', '_gt listview', '_gt set listview',
  '_gt mx', '_gt set mx', '_gt number', '_gt set number', '_gt palette', '_gt set palette', '_gt h scroller',
  '_gt v scroller', '_gt set scroller', '_gt h slider', '_gt v slider', '_gt set slider', '_gt set string mode',
  '_gt string', '_gt set string', '_gt what string', '_gt text', '_gt set text', '_gt image', '_gt set image',
  '_gt make image', '_gt make bitmap', '_gt bob', '_gt set bob', '_gt boopsi', '_gt base', '_gt disable',
  '_gt enable', '_gt bevel box', '_gt make array', '_gt free array', '_gt make list', '_gt free list',
  '_gt what attr', '_gt set attrs', '_gt activate', '_gt refresh', '_gt menus bank', '_gt menus erase',
  '_gt menus attach', '_gt add menu', '_gt add item', '_gt add sub', '_gt add image item', '_gt add image sub',
  '_gt add bob item', '_gt add bob sub', '_gt menu on', '_gt menu off', '_gt menu set check',
  '_gt menu clear check', '_gt menu what check',
])
auditMany('faithful', 'TagItem list construction and utility.library lookup semantics are modelled', [
  '_tag list alloc', '_tag set', '_tag done', '_tag list free', '_tag find', '_tag data',
])
auditMany('faithful', 'Amiga2Date and the ClockData field conversion are modelled from the 1978 epoch', [
  '_ut sec', '_ut min', '_ut hour', '_ut day', '_ut month', '_ut year',
])
auditMany('faithful', 'icon.library ToolType lookup and pre-V44 pipe-value matching are modelled', [
  '_tool find', '_tool match', '_tool get$', '_tool exist', '_tool val match$',
])
auditMany('faithful', 'GetUniqueID is owned by the machine-wide utility service and returns non-zero, non-repeating unsigned IDs', [
  '_id unique',
])
auditMany('partial', 'the binary-derived StonePlayer install, playback-control, validation and conversion state is shared; sample decoding cannot be audited or implemented without any held stoneplayer.library binary', [
  '_sp install', '_sp play', '_sp stop', '_sp remove', '_sp volume', '_sp balance', '_sp speed', '_sp mix',
  '_sp check', '_fx balance',
])
auditMany('faithful', 'worker 1911 selects the same positive unsigned-word AMOS Samples bank used by the shared sample backend', [
  '_fx bank',
])
auditMany('partial', 'Samples-bank overloads retain all eight StonePlayer channels and render the four Paula channels; the raw callback overload and software mixing of channels 5-8 require native callback execution', [
  '_fx play',
])
auditMany('faithful', 'the workers are direct big-endian memory reads/writes, including signed and unsigned word results, which the machine memory backend models', [
  '_cpu word', '_cpu uword', '_cpu long',
])
auditMany('faithful', 'the worker calls exec ColdReboot and the machine backend records the same cold-reset request', [
  '_cold reboot',
])
auditMany('faithful', 'CacheClearU is an exact no-op over the backend coherent memory model', [
  '_cache clr',
])
auditMany('partial', 'CacheControl masked state and its previous-value result are modelled, but there is no 68k execution cache for the flags to affect', [
  '_cache ctrl',
])
auditMany('partial', 'SetChipRev request state is modelled, but the emulated graphics chipset remains fixed as AGA', [
  '_chip set rev',
])
auditMany('faithful', 'the private seven-byte-header C-string allocation, metadata, bounded copy and conversion operations are modelled', [
  '_str len', '_str get', '_str alloc', '_str free', '_str pos', '_str put',
])
auditMany('faithful', 'the signed and unsigned offset memory fields and cleared AllocVec lifecycle are modelled', [
  '_struct alloc', '_struct free', '_struct byte', '_struct ubyte', '_struct word', '_struct uword', '_struct long',
])
auditMany('faithful', 'AllocVec flag handling, size header and FreeVec lifecycle are modelled by the shared Exec memory backend', [
  '_vec alloc', '_vec free',
])
auditMany('partial', 'V39 pool creation, requirements, allocation/free and deletion are modelled; native puddle/threshold placement is not', [
  '_pool create', '_pool delete', '_pool alloc', '_pool free',
])
auditMany('faithful', 'the exact 68k word join and three distinct sign-extension operations are modelled', [
  '_join.w', '_ext.b', '_ext.w', '_ext.l',
])
auditMany('faithful', 'fixed-width big-endian AMOS binary-string packing and unpacking are modelled', [
  '_chr$.l', '_chr$.w', '_val.l', '_val.w',
])
auditMany('faithful', 'AMOS-to-C allocation/copy and the static empty AMOS string are modelled', [
  '_to str', '_0$',
])
auditMany('faithful', 'guarded one-based WBArg name and lock field access is modelled', [
  '_arg what str', '_arg what lock',
])
auditMany('faithful', 'the AMOS-string wrappers share the same AddPart, FilePart and PathPart boundary rules as their caller-memory forms', [
  '_path add', '_path part', '_file part',
])
auditMany('faithful', 'shared DOS lock identities retain paths across ParentDir, NameFromLock, CurrentDir and explicit release', [
  '_dos unlock', '_dos l open', '_dos l name', '_dos dir', '_dos rd lock', '_lock name$',
])
auditMany('faithful', 'native lock identities and shared/exclusive access modes are enforced across every emulated DOS path', [
  '_dos lock', '_dos wr lock',
])
auditMany('faithful', 'the native path operations mutate caller-owned C buffers or return the exact pointer boundary within them', [
  '_dos add part', '_dos file part', '_dos path part',
])
auditMany('faithful', 'the VFS current directory is stored in the canonical name a lock would return', [
  '_dos what dir$',
])
auditMany('faithful', 'directory validation and lock-derived current-directory replacement are modelled', [
  '_dos set dir$',
])
auditMany('faithful', 'the no-requester existence probe returns the same AMOS boolean for files and directories', [
  '_dos exist',
])
auditMany('faithful', 'shared native-style DOS handles provide raw and buffered I/O, seek state, names, append and the AMOS-string convenience wrappers', [
  '_dos open', '_dos close', '_dos seek', '_dos read', '_dos write', '_dos f getc', '_dos f gets',
  '_dos f putc', '_dos f puts', '_dos f ungetc', '_dos f name',
  '_dos opin', '_dos opout', '_dos append', '_dos print', '_dos input', '_dos eof', '_dos lof', '_fh name$',
])
auditMany('faithful', 'shared/exclusive ownership and ChangeMode upgrades are enforced across process DOS handles and locks', [
  '_dos mode',
])
auditMany('faithful', 'one process-wide dos.library state returns IoErr and atomically replaces it through SetIoErr', [
  '_dos err', '_dos set err',
])
auditMany('partial', 'Fault writes its prefix, complete English system error catalogue or numeric fallback and NUL into caller memory with native truncation; locale.library translation remains host-fixed', [
  '_dos fault',
])
auditMany('partial', 'ReportEvent retains the exact error, type, argument and device in shared DOS state; native requester presentation remains a host boundary', [
  '_dos report',
])
auditMany('partial', 'Amiga hunks are relocated into mapped memory, unloaded, and NP_Seglist processes use the host launch seam; multi-hunk BPTR link headers and NP_Entry native execution await the 68k engine', [
  '_dos seg load', '_dos seg unload', '_dos new proc',
])
auditMany('faithful', 'native NotifyRequest records subscribe to the shared VFS and deliver through the shared Exec task signals or MsgPort messages', [
  '_dos sig notify', '_dos msg notify', '_dos end notify',
])
auditMany('faithful', 'the NotifyRequest user-data longword at offset 8 is represented exactly', [
  '_nr what user',
])
auditMany('faithful', 'the immutable CLI/Workbench launch drawer and filename are retained independently of later CurrentDir changes', [
  '_prg dir$', '_prg name$',
])
auditMany('faithful', 'the four-long list header, private 24-byte node header and exact one-based list algorithms are represented', [
  '_chn set number', '_chn set default', '_chn set first', '_chn set last',
  '_chn set list', '_chn set length', '_chn set next', '_chn set previous',
  '_chn what number', '_chn what default', '_chn what first', '_chn what last',
  '_chn what list', '_chn what length', '_chn what next', '_chn what previous',
  '_chn list alloc', '_chn add', '_chn location', '_chn find', '_chn free', '_chn list free', '_chn ins', '_chn swap',
])
auditMany('partial', 'node replacement and prefix preservation are modelled, but the shipped max(old,new) copy overflow cannot corrupt adjacent managed allocations', [
  '_chn new length',
])
auditMany('faithful', 'allocation, lifetime and signed-word coordinate pairs at four-byte strides are represented exactly', [
  '_dots set', '_dots alloc', '_dots free', '_dots what x', '_dots what y',
])
auditMany('faithful', 'the packed six-byte BooleanInfo word/unaligned-long layout is represented at exact widths', [
  '_bi set flags', '_bi set mask', '_bi set', '_bi what flags', '_bi what mask',
])
auditMany('partial', 'managed palettes support nearest colours and allocation state, but arbitrary native ColorMaps, precision/tag policy and shared-pen ownership are not exposed', [
  '_pen find', '_pen obtain best', '_pen obtain', '_pen release', '_pen set max',
])
auditMany('partial', 'the PAL display-mode database provides compatible IDs and geometry, but BestModeIDA/CoerceMode tag and monitor-driver selection are incomplete', [
  '_mode best id', '_mode coerce',
])
auditMany('partial', 'View/ViewPort geometry exists, but CalcIVG requires arbitrary native structures and graphics-driver state', [
  '_calc ivg',
])
auditMany('faithful', 'the 32 independent pointer classes, deduplicating Set, direct Add, lookup and gap-closing removal are represented exactly', [
  'track set', 'track unset', 'track add', 'track exist',
])
auditMany('partial', 'the complete eight-data/eight-address longword register frame is represented, but out-of-range indices cannot corrupt adjacent extension state', [
  '_dreg', '_areg',
])
auditMany('missing', 'the worker jumps to arbitrary native code with the saved register frame, and no 68k execution backend exists', [
  '_call',
])
auditMany('faithful', 'the tilde prefix, 31-byte payload limit and editor refresh request are retained exactly', [
  '_amos name',
])
auditMany('faithful', 'the token is encoded with the extension null function and has no worker or side effect', [
  '_low init',
])
auditMany('missing', 'the native AMOS evaluation-stack pointer has no stable address in the TypeScript interpreter', [
  'a3 pointer',
])
auditMany('missing', 'the worker returns an internal AMOS channel-table pointer whose raw layout is not exposed', [
  'give me',
])
auditMany('partial', 'shared Exec alert state, recoverable return, dead-end reset and Workbench ordering are modelled; native Guru presentation is not rendered', [
  '_alert',
])
auditMany('partial', 'managed windows have refresh state and redraw paths, but arbitrary native BeginRefresh/EndRefresh layer damage is not exposed', [
  '_rfsh begin', '_rfsh end',
])
auditMany('partial', 'nominal PAL mode geometry exists, but QueryOverscan against arbitrary monitor-driver rectangles is incomplete', [
  '_query overscan',
])
auditMany('partial', 'registered managed BOOPSI classes can construct objects, but arbitrary public class names and native tag pointers are not exposed', [
  '_obj new',
])
auditMany('faithful', 'managed BOOPSI objects implement DisposeObject and nullable GetAttr success/value semantics exactly', [
  '_obj free', '_obj what attr',
])
auditMany('partial', 'BOOPSI attribute/method dispatch exists, but arbitrary native tag lists and message structures cannot be dispatched', [
  '_obj set attrs', '_obj do',
])
auditMany('partial', 'the cached private imageclass subclass and native class-handle path are shared with BOOPSI; its custom datatype-backed IM_DRAW rendering remains incomplete', [
  '_class get file',
])
auditMany('partial', 'console output exists, but dos.library VPrintf formatting through a native argument stream is not exposed', [
  '_print',
])
auditMany('partial', 'choice requesters exist through the host UI, but the native EasyStruct formatting/return lifecycle is not exposed', [
  '_request choice',
])
auditMany('partial', 'the high-level GadTools bank workflows are partial; these two tokens are exact aliases into those same reservations', [
  'reserve as gt gadgets', 'reserve as gt menus',
])
auditMany('partial', 'planar Bob rendering exists, but this worker directly mutates arbitrary Bob/Image and RastPort memory plus blitter registers', [
  '_bob blit',
])
auditMany('faithful', 'the complete exposed 44-byte Gadget record and exact pointer/unsigned-word setters and readers are represented', [
  '_gad set next', '_gad set body', '_gad set fat', '_gad set render', '_gad set text',
  '_gad set spec info', '_gad set user', '_gad what next', '_gad what left', '_gad what top',
  '_gad what width', '_gad what height', '_gad what flags', '_gad what activation', '_gad what type',
  '_gad what render', '_gad what h render', '_gad what text', '_gad what spec info',
  '_gad what user id', '_gad what user data',
])
auditMany('partial', 'managed gadget lifecycle and property state exist, but arbitrary native Gadget/Window chains and refresh rendering are not integrated', [
  '_gad activate', '_gad add', '_gad modif prop', '_gad off', '_gad on', '_gad refresh', '_gad remove',
])
auditMany('faithful', 'the retained NewScreen definition and directly exposed public Screen fields use the exact pointer, byte and word widths', [
  '_scr def body', '_scr def pens', '_scr def title', '_scr def font', '_scr def bmap',
  '_scr def vmodes', '_scr def type', '_scr set title', '_scr set def title',
  '_scr what next', '_scr what title', '_scr what def title', '_scr what bmap', '_scr what first wnd',
  '_scr what font', '_scr what layer', '_scr what width', '_scr what height', '_scr what depth',
  '_scr what d pen', '_scr what b pen', '_scr what x mouse', '_scr what y mouse', '_scr what barh',
  '_scr what vmodes', '_scr what type',
  '_scr wdef title', '_scr wdef bmap', '_scr wdef vmodes', '_scr wdef type', '_scr wdef font',
])
auditMany('partial', 'screen ordering/active state and embedded ViewPort/RastPort/LayerInfo exist, but their native interior addresses are not stable', [
  '_scr what front', '_scr what active', '_scr what vport', '_scr what rport', '_scr what layer info',
])
auditMany('partial', 'managed screen lifecycle, ordering and relative positioning exist, but OS DevKit accepts arbitrary native NewScreen, Screen and TagItem pointers', [
  '_scr open', '_scr tag open', '_scr close', '_scr move', '_scr position', '_scr to back', '_scr to front',
])
auditMany('partial', 'the corresponding screen presentation state exists, but Intuition title-bar rendering and DisplayBeep colour inversion are not modelled', [
  '_scr beep', '_scr show title', '_scr hide title',
])
auditMany('partial', 'GetScreenDrawInfo owns a tracked native record, pen array and font tied to managed Screen pointers; system checkmark/key imagery and arbitrary external Screen structures remain incomplete', [
  '_scr dinf get', '_scr dinf free',
])
auditMany('partial', 'Workbench and GUI-owned custom screens now share process-wide Intuition publication, locking and ordering; arbitrary external Screen pointers and native list locks remain outside it', [
  '_scr def pub', '_scr pub lock', '_scr pub unlock', '_scr pub modes', '_scr pub status',
])
auditMany('faithful', 'the private V1 and V2 DrawInfo default arrays preserve all twelve pen words in their exact order', [
  '_scr id def dri pens v1', '_scr id def dri pens v2',
])
auditMany('partial', 'numbered screens own shared Intuition screens and stable mapped Screen/RastPort/ViewPort records; arbitrary external structures and TagItem screen opens remain incomplete', [
  '_scr id open', '_scr id close', '_scr id tag open',
  '_scr id from wb', '_scr id from pub', '_scr id from pointer',
  '_scr id beep', '_scr id move', '_scr id offset',
])
auditMany('faithful', 'workers 2990 and 3009 plus the native Screen field workers return the extension-owned current ID and stable mapped Screen, RastPort, ViewPort, width, height, depth and mode values exactly', [
  '_scr id base', '_scr id rport', '_scr id vport', '_scr id in use',
  '_scr id height', '_scr id width', '_scr id depth', '_scr id mode',
])
auditMany('faithful', 'workers 2993, 2994 and 3008 select the extension-owned screen and delegate Show/Hide to ScreenToFront/ScreenToBack exactly', [
  '_scr id show', '_scr id hide', '_scr id use',
])
auditMany('partial', 'the selected Screen-ID shares ECS/AGA palette state and captures system, private or caller-memory DrawInfo pens for native screens and GadTools; invalid external-pointer behavior is managed safely', [
  '_scr id get pal', '_scr id set pal', '_scr id get aga pal', '_scr id set aga pal',
  '_scr id colour', '_scr id aga colour', '_scr id fix dri pens',
])
auditMany('partial', 'Screen-ID mouse reads and positioning share display offsets and resolution conversion; positioning updates host input directly rather than delivering an input.device event', [
  '_scr id x mouse', '_scr id y mouse', '_scr id set mouse pos',
])
auditMany('partial', 'the selected Screen-ID routes drawing, text, scrolling, patterned area-fill, flood and AMOS Bob images through the shared RastPort; scratch raster allocation follows the worker, while raw temporary AreaInfo/TmpRas pointers are intentionally not exposed', [
  '_scr id clip', '_scr id ink', '_scr id gr writing', '_scr id cls', '_scr id plot', '_scr id set line',
  '_scr id rect', '_scr id line to', '_scr id line', '_scr id ellipse', '_scr id gr locate',
  '_scr id set paint', '_scr id pattern on', '_scr id pattern off', '_scr id set low pattern',
  '_scr id set high pattern', '_scr id paint', '_scr id bar', '_scr id fill ellipse', '_scr id text',
  '_scr id point', '_scr id scroll', '_scr id put bob',
])
auditMany('faithful', 'the retained 48-byte NewWindow definition preserves the exact byte, word and pointer fields', [
  '_wnd def body', '_wnd def limits', '_wnd def pens', '_wnd def idcmp', '_wnd def flags', '_wnd def gad',
  '_wnd def image', '_wnd def title', '_wnd def scr', '_wnd def type', '_wnd def bmap',
  '_wnd wdef left', '_wnd wdef top', '_wnd wdef width', '_wnd wdef height', '_wnd wdef d pen',
  '_wnd wdef b pen', '_wnd wdef idcmp', '_wnd wdef flags', '_wnd wdef gad', '_wnd wdef image',
  '_wnd wdef title', '_wnd wdef scr', '_wnd wdef min width', '_wnd wdef min height',
  '_wnd wdef max width', '_wnd wdef max height', '_wnd wdef type', '_wnd wdef bmap',
])
auditMany('faithful', 'the public Window field is represented with the exact pointer, unsigned byte/word or signed mouse-coordinate width', [
  '_wnd what front', '_wnd what next', '_wnd what title', '_wnd what scr title', '_wnd what scr',
  '_wnd what rport', '_wnd what left', '_wnd what top', '_wnd what width', '_wnd what height',
  '_wnd what x mouse', '_wnd what y mouse', '_wnd what min width', '_wnd what min height',
  '_wnd what max width', '_wnd what max height', '_wnd what flags', '_wnd what menu',
  '_wnd what first req', '_wnd what dm req', '_wnd what count req', '_wnd what bdr left',
  '_wnd what bdr top', '_wnd what bdr right', '_wnd what bdr bottom', '_wnd what first gad',
  '_wnd what parent', '_wnd what descendant', '_wnd what pointer height', '_wnd what pointer width',
  '_wnd what pointer xoff', '_wnd what pointer yoff', '_wnd what idcmp', '_wnd what user port',
  '_wnd what port', '_wnd what int msg', '_wnd what d pen', '_wnd what b pen', '_wnd what image',
  '_wnd what user data', '_wnd what ext data', '_wnd what layer', '_wnd what font',
])
auditMany('partial', 'managed window lifecycle, geometry, ordering and titles exist, but these workers accept arbitrary native Window/NewWindow/tag pointers and rendering ownership', [
  '_wnd set titles', '_wnd set pointera', '_wnd set limits', '_wnd set idcmp', '_wnd open', '_wnd tag open',
  '_wnd close', '_wnd activate', '_wnd move', '_wnd box', '_wnd size', '_wnd refresh frame', '_wnd to back',
  '_wnd to front', '_wnd in front of', '_wnd scroll raster', '_wnd zip',
])
auditMany('partial', 'the window state exists, but global native active/ViewPort identity is unavailable; _wnd what pointer also tests stale a0 before loading its argument', [
  '_wnd what active', '_wnd what vport', '_wnd what pointer',
])
auditMany('partial', 'managed windows share mapped Exec UserPorts, native IntuiMessages, GT_GetIMsg filtering, immediate reply ownership and scheduler-backed waits; arbitrary external Window pointers remain outside the adapter', [
  '_wnd wait port', '_wnd clear port', '_wnd share port', '_wnd unshare port',
])
auditMany('faithful', 'the dynamically grown 28-byte Window-ID record, current selection and caller Data long are represented exactly', [
  '_wnd id base', '_wnd id use', '_wnd id in use', '_wnd id data',
])
auditMany('faithful', 'the copied IntuiMessage, Gadget fields and MENUNUM/ITEMNUM/SUBNUM bitfields use the exact widths and -1 sentinels', [
  '_wnd id event wnd', '_wnd id event code', '_wnd id event qualifier', '_wnd id event gadget',
  '_wnd id event gt bank', '_wnd id event menu', '_wnd id event item', '_wnd id event sub',
  '_wnd id event x mouse', '_wnd id event y mouse',
])
auditMany('faithful', 'the selected Window/RastPort query delegates to the exact public field operation', [
  '_wnd id x mouse', '_wnd id y mouse', '_wnd id xgr', '_wnd id ygr', '_wnd id x', '_wnd id y',
  '_wnd id width', '_wnd id height', '_wnd id top bdr', '_wnd id bottom bdr', '_wnd id left bdr',
  '_wnd id right bdr', '_wnd id inner width', '_wnd id inner height', '_wnd id inner x mouse',
  '_wnd id inner y mouse',
])
auditMany('faithful', 'one Window-ID adapter synchronizes native state, coordinates and clipping around the shared RastPort primitive; both private eight-word pattern arrays are retained', [
  '_wnd id plot', '_wnd id rect', '_wnd id line to', '_wnd id line', '_wnd id ellipse', '_wnd id cls',
  '_wnd id ink', '_wnd id gr writing', '_wnd id text', '_wnd id gr locate', '_wnd id set paint',
  '_wnd id pattern on', '_wnd id pattern off', '_wnd id set low pattern', '_wnd id set high pattern',
  '_wnd id set line', '_wnd id point',
])
auditMany('partial', 'Window-ID open/close owns shared Intuition windows, native RastPort records and the private Requester; tag opening handles the core V39 geometry, pen, IDCMP, title, screen and limit tags rather than the entire WA_* surface', [
  '_wnd id open', '_wnd id close', '_wnd id tag open',
])
auditMany('partial', 'WindowLimits, MoveWindow, SizeWindow and ChangeWindowBox share Intuition geometry and public fields; off-screen movement remains safely clamped by the host window policy', [
  '_wnd id limits', '_wnd id move', '_wnd id size', '_wnd id box',
])
auditMany('faithful', 'the selected or explicitly activated shared Window owns both retained title strings and active-window ordering', [
  '_wnd id titles', '_wnd id activate',
])
auditMany('partial', 'the private 112-byte Requester and Request/EndRequest active lifecycle are owned; arbitrary native requester gadget and border chains are not rendered', [
  '_wnd id lock', '_wnd id unlock',
])
auditMany('faithful', 'the one shared Window-ID UserPort, nonblocking GetMsg/GT_GetIMsg filtering, 52-byte copy and immediate reply semantics are represented exactly', [
  '_wnd id wait event', '_wnd id next event', '_wnd id mask event',
])
auditMany('faithful', 'ItemAddress walks the attached shared GadTools MenuStrip and copies its unsigned NextSelect word into the retained event code', [
  '_wnd id event next menu',
])
auditMany('partial', 'pointer-bank conversion exists, but native SetPointer ownership is not exposed end to end', [
  '_wnd id mouse',
])
auditMany('faithful', 'the input.device pixel-position event is folded into the shared input pointer with Window-relative coordinates', [
  '_wnd id set mouse pos',
])
auditMany('partial', 'bar, patterned area-fill, flood, scrolling and AMOS Bob images use the same Window-ID shared-RastPort adapter; fill operations use worker-sized transient scratch raster ownership, while raw temporary AreaInfo/TmpRas pointers are intentionally not exposed', [
  '_wnd id bar', '_wnd id paint', '_wnd id fill ellipse', '_wnd id scroll', '_wnd id put bob',
])
auditMany('partial', 'the Runtime-owned Exec registry shares stable bases, version checks and open counts across live modules; arbitrary resident loading and real build revisions remain unavailable', [
  '_lib version', '_lib revision', '_lib open', '_lib close',
])
auditMany('missing', 'the worker invokes an arbitrary negative LVO with a complete 68k register frame, and no 68k execution backend exists', [
  '_lib call',
])
auditMany('faithful', 'the worker returns a stable base for a library with a concrete registered backend', [
  '_base dos', '_base gfx', '_base int', '_base gad', '_base asl', '_base icon', '_base loc', '_base dt',
  '_base layers', '_base wb',
])
auditMany('faithful', 'the embedded Topaz TextAttr and default TagItem list are exposed through mapped native records', [
  '_base topaz', '_base tag',
])
auditMany('faithful', 'the four timestamps use Intuition shared double-click policy, including ordering and the configured interval', [
  '_dbl click',
])
auditMany('faithful', 'the complete native Border layout and its byte/word/long field mutations and reads are modelled', [
  '_bd set draw', '_bd set corner', '_bd set dots', '_bd set next', '_bd set', '_bd what front pen',
  '_bd what back pen', '_bd what draw mode', '_bd what left', '_bd what top', '_bd what dots nb',
  '_bd what dots', '_bd what next',
])
auditMany('partial', 'Border polyline rendering exists, but native address-chain traversal and every draw-mode side effect are not modelled', [
  '_bd draw',
])
auditMany('faithful', 'all eleven native PropInfo words, including calculated geometry and increments, are represented', [
  '_pi set', '_pi what flags', '_pi what % horiz', '_pi what % vert', '_pi what % width',
  '_pi what % height', '_pi what width', '_pi what height', '_pi what hinc', '_pi what vinc',
  '_pi what left', '_pi what top',
])
auditMany('faithful', 'all 36 bytes of StringInfo and the exact partial/full setters are represented', [
  '_si set buf', '_si set ext', '_si set integer', '_si set keymap', '_si set', '_si what buf',
  '_si what undo buf', '_si what pos buf', '_si what max chars', '_si what disp chars', '_si what undo pos',
  '_si what nb chars', '_si what disp count', '_si what cleft', '_si what ctop', '_si what ext',
  '_si what integer', '_si what keymap',
])
auditMany('faithful', 'the complete native Image record, its exact setters/readers and PointInImage geometry are represented', [
  '_img set body', '_img set planes', '_img set next', '_img point in', '_img what left', '_img what top',
  '_img what width', '_img what height', '_img what depth', '_img what body', '_img what pick',
  '_img what onoff', '_img what next',
])
auditMany('partial', 'image rendering exists, but native planar pointer chains, EraseImage restoration and DrawImageState state imagery are incomplete', [
  '_img erase', '_img draw state', '_img draw',
])
auditMany('faithful', 'all nine IntuiMessage fields and their exact long, unsigned-word and signed-word reads are represented', [
  '_imsg what class', '_imsg what code', '_imsg what qualifier', '_imsg what item',
  '_imsg what x mouse', '_imsg what y mouse', '_imsg what seconds', '_imsg what micros', '_imsg what wnd',
])
auditMany('partial', 'native message filtering, cooked-field writes and reply ownership use the shared GadTools/Exec backends; only the MEMF_KICK rejection sentinel has no representable memory region', [
  '_gmsg get', '_gmsg reply',
])
auditMany('faithful', 'the NotifyMessage request pointer at offset $1a is represented exactly', [
  '_nmsg what nreq',
])
auditMany('faithful', 'the exact 14-byte Exec List/Node layouts, sentinels, field widths, allocation and list algorithms are modelled', [
  '_lnod set head', '_lnod set tail', '_lnod set type', '_lnod alloc', '_lnod free',
  '_lnod what head', '_lnod what tail', '_lnod what type',
  '_nod set succ', '_nod set pred', '_nod set type', '_nod set name', '_nod set pri', '_nod alloc', '_nod free',
  '_nod ins', '_nod rem', '_nod h add', '_nod h rem', '_nod t add', '_nod t rem', '_nod enqueue',
  '_nod find name', '_nod what succ', '_nod what pred', '_nod what type', '_nod what pri', '_nod what name',
  '_nod what start',
])
auditMany('faithful', 'native MsgPort creation, deletion, naming, signal fields and public-port registry behavior are modelled', [
  '_port add', '_port rem', '_port find', '_port create', '_port delete',
  '_port what sig nb', '_port what sig task',
])
auditMany('faithful', 'native Message FIFO delivery, reply routing and exact reply-port/length fields are modelled', [
  '_msg put', '_msg reply', '_msg what length', '_msg what reply port',
])
auditMany('faithful', 'signal-bit allocation/free, masked SetSignal state and task Signal delivery are modelled', [
  '_sig alloc', '_sig free', '_sig set', '_sig put',
])
auditMany('faithful', 'empty signal and port waits yield and re-enter the worker until shared Exec delivery wakes them', [
  '_port wait', '_sig wait',
])
auditMany('partial', 'GetMsg FIFO removal and its null-port error are exact; only the native MEMF_KICK rejection path has no representable memory region', [
  '_msg get',
])
auditMany('faithful', 'AllocMem/FreeMem and arbitrary-alignment CopyMem behavior are modelled; the abs spelling aliases the same AllocMem worker', [
  '_mem alloc', '_mem abs alloc', '_mem free', '_mem copy',
])
auditMany('partial', 'the result is modelled, but separately owned runtime regions do not form one fragmenting global Exec memory arena', [
  '_mem avail', '_mem type',
])
auditMany('faithful', 'the exact 22-byte Interrupt allocation, data/code fields, removal and FreeVec lifetime are modelled', [
  '_int alloc', '_int free', '_int set', '_int rem',
])
auditMany('partial', 'priority-ordered AddIntServer registration exists, but arbitrary native 68k handler code cannot execute', [
  '_int add',
])
auditMany('partial', 'current/named task lookup and signed priority state are modelled, but there is no multitasking scheduler for priority to affect', [
  '_task find', '_task set pri',
])
auditMany('faithful', 'CurrentTime uses the 1978 epoch and the Exec/AttnFlags worker transformations are modelled exactly', [
  '_sys time', '_sys version', '_sys revision', '_sys cpu', '_sys fpu',
])
auditMany('partial', 'the display View exists semantically, but has no stable native raw View pointer or structure layout', [
  '_sys view',
])
auditMany('faithful', 'FindDisplayInfo resolves the installed PAL monitor database by exact DisplayID', [
  '_disp info find',
])
auditMany('partial', 'the operation exists, but ROM alert presentation or staged native View/copper rebuild state is not represented', [
  '_disp alert', '_disp remake', '_disp rethink',
])
auditMany('partial', 'mode names and nominal geometry exist, but the full monitor-driver DisplayInfo data records do not', [
  '_disp info get',
])
auditMany('partial', 'caller-owned Requester initialization and activation share the Intuition Window lifecycle; raw gadget, border and IntuiText chains are not rendered', [
  '_req init', '_req do', '_req end',
])
auditMany('partial', 'host-backed alert requesters exist, but arbitrary native EasyStruct formatting and raw argument arrays do not', [
  '_req easy',
])
auditMany('partial', 'SetPointer arguments and clearing are retained per window, but the custom sprite image is not rendered', [
  '_ptr set', '_ptr clear',
])
auditMany('faithful', 'ReportMouse toggles the exact WFLG_REPORTMOUSE window flag', [
  '_mouse report', '_mouse unreport',
])
auditMany('faithful', 'LockIBase/UnlockIBase token pairing is represented exactly in the single-threaded backend', [
  '_ibase lock', '_ibase unlock',
])
auditMany('faithful', 'the complete 20-byte IntuiText layout and every byte, word and pointer setter/reader are represented', [
  '_it set draw', '_it set corner', '_it set font', '_it set str', '_it set next', '_it set',
  '_it what front pen', '_it what back pen', '_it what draw mode', '_it what left', '_it what top',
  '_it what font', '_it what str', '_it what next',
])
auditMany('partial', 'text drawing and metrics exist, but arbitrary native TextAttr, C-string and next-pointer chains are not traversed', [
  '_it print', '_it what len',
])
auditMany('faithful', 'the complete eight-byte TextAttr layout and exact pointer, word and byte reads/writes are represented', [
  '_ta set', '_ta what name', '_ta what height', '_ta what style', '_ta what flags',
])
auditMany('faithful', 'the complete 12-byte RasInfo layout and exact pointer and signed-word reads/writes are represented', [
  '_ri set', '_ri what next', '_ri what bmap', '_ri what x', '_ri what y',
])
auditMany('faithful', 'the complete View fields and signed readers are represented, including the shipped setter overwriting Y/X at $c instead of modes at $10', [
  '_view set', '_view what vport', '_view what x', '_view what y', '_view what modes',
])
auditMany('faithful', 'the complete ViewPort fields are represented, including the shipped word-sized sprite-priority write, absolute-$18 width read and stale-d0 Y read defects', [
  '_vp set next', '_vp set body', '_vp set cmap', '_vp set ras info', '_vp what next', '_vp what cmap',
  '_vp what ras info', '_vp what width', '_vp what height', '_vp what x', '_vp what y', '_vp what modes',
  '_vp what spr pri',
])
auditMany('partial', 'mode IDs exist for managed screens, but arbitrary native ViewPort extended-mode metadata is not represented', [
  '_vp get mode',
])
auditMany('faithful', 'the complete 40-byte BitMap structure and exact word, byte and bounded plane reads are represented', [
  '_bm set datas', '_bm what modulo', '_bm what height', '_bm what depth', '_bm what flags', '_bm what plane',
])
auditMany('partial', 'valid plane assignment exists, but the shipped signed comparison also permits negative native-memory writes before bm_Planes', [
  '_bm set plane',
])
auditMany('partial', 'managed planar BitMaps and their attributes exist, but friend-bitmap and BMF_INTERLEAVED allocation layouts do not', [
  '_bm alloc', '_bm free', '_bm what attr',
])
auditMany('faithful', 'managed ColorMaps implement allocation, lifetime and exact RGB4/RGB32 component conversion and range reads', [
  '_cm alloc', '_cm free', '_rgb4 get', '_rgb4 cm set', '_rgb32 get', '_rgb32 cm set',
])
auditMany('partial', 'screen palettes exist, but these workers take arbitrary native ViewPort and raw colour-table pointers', [
  '_rgb4 load', '_rgb4 set', '_rgb32 load', '_rgb32 set',
])
auditMany('faithful', 'complete public View and ViewPort records can be initialized exactly', [
  '_cop init view', '_cop init vport',
])
auditMany('partial', 'the copper interpreter and VBL/display operations exist, but arbitrary native View graphs and tag-list control are not integrated', [
  '_cop load view', '_cop make vport', '_cop mrg', '_cop scroll vport', '_cop vbeam pos', '_cop wait tof',
  '_cop control', '_cop wait bottom',
])
auditMany('faithful', 'the SimpleSprite public prefix and exact word-sized height, number and position writes are represented', [
  '_spr set height', '_spr set nb', '_spr set pos',
])
auditMany('partial', 'hardware sprite rendering exists, but arbitrary native SimpleSprite/ExtSprite, ViewPort and tag-list ownership is not integrated', [
  '_spr change', '_spr free', '_spr get', '_spr move', '_spr a data alloc', '_spr a data free', '_spr a change',
  '_spr a get',
])
auditMany('faithful', 'blits are synchronous and non-contending, so OwnBlitter, DisownBlitter and WaitBlit have their exact observable effect', [
  '_blt own', '_blt disown', '_blt wait',
])
auditMany('partial', 'planar blitting and clipping exist, but raw-memory clears, arbitrary masks/patterns/RastPorts and every graphics.library minterm are not exposed', [
  '_blt clr', '_blt msk bm to rp', '_blt pattern', '_blt clip',
])
auditMany('faithful', 'the complete eight-byte TmpRas record and the identical library/direct initialization plus both long reads are represented', [
  '_tmpras init', '_tr set', '_tr what raster', '_tr what size',
])
auditMany('faithful', 'RastPort font assignment and masked algorithmic-style reads/writes are represented exactly', [
  '_font style', '_font set', '_font soft style',
])
auditMany('partial', 'TextAttr/TextFont pointers, resident membership, open counts and disk-font parsing now share RastPort rendering ownership; arbitrary external TextFont memory and full WeighTAMatch scoring remain incomplete', [
  '_font add', '_font ask', '_font close', '_font open', '_font rem', '_font load',
])
auditMany('faithful', 'caller-owned AreaInfo/TmpRas records, RASSIZE chip allocation and direct RastPort fill primitives are integrated', [
  '_rp flood', '_area init', '_rp bar', '_rast alloc', '_rast free',
])
auditMany('partial', 'AreaInfo vector queues and native RastPort filling are integrated, but AreaEnd edge, outline and mixed ellipse/polygon rules remain approximated', [
  '_area draw', '_area ellipse', '_area end', '_area move',
])
auditMany('faithful', 'the native RastPort fields, exact pointer/byte/word setters, outline-pen sentinel and signed cursor readers are represented', [
  '_rp set layer', '_rp set bmap', '_rp set tmpras', '_rp set area info', '_rp set o pen', '_rp set line',
  '_rp set wr msk', '_rp what layer', '_rp what bmap', '_rp what tmpras', '_rp what area info',
  '_rp what text base', '_rp what xgr', '_rp what ygr',
])
auditMany('faithful', 'managed RastPorts implement the exact state changes and planar drawing/read/text operations used by these calls', [
  '_rp move', '_rp a pen', '_rp b pen', '_rp dr md', '_rp rast', '_rp draw', '_rp ellipse',
  '_rp point', '_rp plot', '_rp text', '_rp len text',
])
auditMany('partial', 'related rendering exists, but native layer/font clear geometry, raw PolyDraw coordinate arrays and ScrollRaster exposure behavior are not complete', [
  '_rp clr eol', '_rp clr scr', '_rp poly draw', '_rp scroll',
])
auditMany('faithful', 'the V39 setters map exactly to the managed RastPort write-mask and outline-pen fields', [
  '_rp wr msk', '_rp o pen',
])
auditMany('partial', 'scaling, scrolling and RastPort attributes exist in narrower forms, but native BitScaleArgs/DDA rounding, layer backfill and raw tag get-pointers are incomplete', [
  '_scale bm', '_scale div', '_rp bf scroll', '_rp what attrs', '_rp set attrs',
])
auditMany('partial', 'the exact DateStamp calendar exists, but dos.library DateToStr localization, Preferences-driven FORMAT_DEF and native DateTime buffers do not', [
  '_dos day$', '_dos date$', '_dos time$',
])
auditMany('faithful', 'DeleteVar and FindVar use shared local/global storage, type selection and exact public LocalVar records', [
  '_dos var del', '_dos var find',
])
auditMany('partial', 'local precedence, hierarchical names, text/binary reads, ENV:/ENVARC: storage, the wrapper buffer limit and IoErr are shared; binary-string termination and remaining dos.library version edges are incomplete', [
  '_dos var value$',
])
auditMany('partial', 'the shared ReadArgs backend handles aliases, quoting/escapes, required, switch/toggle, keyword, numeric, multi redistribution and rest fields; native RDArgs allocation, prompting/default arrays and remaining parser limits are incomplete', [
  '_cli read args', '_cli what arg$', '_cli what arg',
])
auditMany('partial', 'the event queue shares native Exec messages, GadTools filtering, immediate reply ownership and scheduler-backed blocking; arbitrary external port memory remains outside the adapter', [
  '_event wait port',
])

const namespaceOf = (name: string): string => name.replace(/^!/, '').split(' ')[0]!

/** Lazy OpenLibrary paths whose inline names were verified in their workers. */
const openedByWorker = (name: string): string | undefined => {
  if (name === '_font load') return 'diskfont.library'
  if (name === '_ag display') return 'amigaguide.library'
  if (name === '_sp install') return 'stoneplayer.library'
  return undefined
}

export function auditOsBackend(entries: TokenEntry[], code: Uint8Array): OsBackendRow[] {
  const addresses = routineAddresses(code)
  const layout = libLayout(code)
  const worker = (routine: number): number => {
    let current = routine
    const seen = new Set<number>()
    while (!seen.has(current)) {
      seen.add(current)
      const at = addresses[current]
      if (at === undefined || code[at] !== 0xfe || code[at + 1] !== 0x21) break
      // A plain C_Code call stores this library's zero-based routine index.
      current = ((code[at + 2] ?? 0) << 8) | (code[at + 3] ?? 0)
    }
    return current
  }
  return entries.flatMap((entry, index) => {
    if (!entry.name) return []
    const name = entry.name!.replace(/^!/, '')
    const namespace = namespaceOf(name)
    const missing = MISSING.find((f) => f.names(name, namespace))
    const modelled = MODELLED.get(namespace)
    const audited = osBackendVerdict(name)
    // A leading `!` means this named token owns the following empty-name
    // entries: overload continuations in the binary token table. Keep one
    // keyword row, but cite and scan every implementation routine it exposes.
    const variants = [entry]
    if (entry.name.startsWith('!')) {
      for (let i = index + 1; i < entries.length && !entries[i]!.name; i++) variants.push(entries[i]!)
    }
    const routines = [...new Set(variants.flatMap((variant) => [variant.instr, variant.func])
      .filter((n) => n !== undefined && n !== 1 && n !== 0xffff))]
    // Invalid routine references are review items, never silently "covered".
    const valid = routines.every((n) => addresses[n!] !== undefined)
    const workers = routines.map(worker)
    const calls = new Map<string, OsCall>()
    for (const routine of workers) {
      const from = addresses[routine]
      const to = addresses[routine + 1] ?? layout?.end
      if (from === undefined || to === undefined) continue
      for (const call of scanOsCalls(code, from, to)) {
        const library = call.library ?? openedByWorker(name)
        const resolved = library ? { ...call, library } : call
        calls.set(`${library ?? call.chain}:${call.lvo}`, resolved)
      }
    }
    return {
      name,
      tokenId: entry.id,
      routines: routines as number[],
      namespace,
      status: audited?.status ?? (missing ? 'missing' : 'review'),
      family: missing?.family ?? modelled ?? namespace,
      reason: audited?.reason ?? (missing
        ? `${missing.family}.library has no backend`
        : modelled && valid
          ? `${modelled} family exists; exact operation not audited yet`
          : valid ? 'local or indirect operation not audited yet' : 'invalid routine reference'),
      workers,
      eightByteRoutines: routines.filter((routine) => {
        const at = addresses[routine]
        return at !== undefined && addresses[routine + 1] === at + 8
      }),
      osCalls: [...calls.values()],
    }
  })
}

export function osBackendSummary(rows: OsBackendRow[]): {
  total: number
  byStatus: Record<OsBackendStatus, number>
  byFamily: Array<{ family: string; status: OsBackendStatus; keywords: number }>
  referencedRoutines: number
  workers: number
  eightByteRoutines: number
  keywordsWithOsCalls: number
  untracedOsCalls: number
  byLibrary: Array<{ library: string; keywords: number; lvos: number }>
} {
  const byStatus: Record<OsBackendStatus, number> = { faithful: 0, partial: 0, missing: 0, review: 0 }
  const groups = new Map<string, { family: string; status: OsBackendStatus; keywords: number }>()
  for (const row of rows) {
    byStatus[row.status]++
    const key = `${row.status}:${row.family}`
    const group = groups.get(key) ?? { family: row.family, status: row.status, keywords: 0 }
    group.keywords++
    groups.set(key, group)
  }
  const routines = new Set(rows.flatMap((row) => row.routines))
  const workers = new Set(rows.flatMap((row) => row.workers))
  const eightByteRoutines = new Set<number>()
  for (const row of rows) for (const routine of row.eightByteRoutines) eightByteRoutines.add(routine)
  const libraries = new Map<string, { keywords: Set<number>; lvos: Set<number> }>()
  let untracedOsCalls = 0
  for (const row of rows) for (const call of row.osCalls) {
    if (!call.library) {
      untracedOsCalls++
      continue
    }
    const group = libraries.get(call.library) ?? { keywords: new Set<number>(), lvos: new Set<number>() }
    group.keywords.add(row.tokenId)
    group.lvos.add(call.lvo)
    libraries.set(call.library, group)
  }
  return {
    total: rows.length,
    byStatus,
    byFamily: [...groups.values()].sort((a, b) => b.keywords - a.keywords),
    referencedRoutines: routines.size,
    workers: workers.size,
    eightByteRoutines: eightByteRoutines.size,
    keywordsWithOsCalls: rows.filter((row) => row.osCalls.length > 0).length,
    untracedOsCalls,
    byLibrary: [...libraries].map(([library, group]) => ({
      library,
      keywords: group.keywords.size,
      lvos: group.lvos.size,
    })).sort((a, b) => b.keywords - a.keywords),
  }
}
