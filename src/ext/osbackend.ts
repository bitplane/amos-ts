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
  { family: 'iffparse', names: (n, ns) => ns === '_iff' || ns === '_chunk' || n === '_base iff' },
  { family: 'commodities', names: (n, ns) => ns === '_cx' || ns === '_event' || n === '_base cx' },
  { family: 'workbench', names: (_n, ns) => ns === '_wb' || ns === '_app' },
  { family: 'preferences', names: (_n, ns) => ns === '_prfs' },
  { family: 'amigaguide', names: (_n, ns) => ns === '_ag' || ns === '_help' },
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
  ['_joy', 'lowlevel'], ['_layer', 'layers'], ['_li', 'layers'],
])

const AUDITED = new Map<string, { status: OsBackendStatus; reason: string }>([
  ['_dt init', { status: 'faithful', reason: 'OpenLibrary(datypes.library, 39) succeeds against the V40 registry entry' }],
  ['_dt obtain', { status: 'partial', reason: 'memory descriptor matching exists, but tie ordering is not yet binary-faithful' }],
  ['_dt release', { status: 'faithful', reason: 'shared immutable descriptors make ReleaseDataType observably a no-op' }],
  ['_dt create', { status: 'missing', reason: 'datatype objects are not modelled' }],
  ['_dt delete', { status: 'missing', reason: 'datatype objects are not modelled' }],
  ['_dt set attrs', { status: 'missing', reason: 'datatype object attributes are not modelled' }],
  ['_dt what attrs', { status: 'missing', reason: 'datatype object attributes are not modelled' }],
  ['_dt add', { status: 'missing', reason: 'datatype objects cannot be attached to windows' }],
  ['_dt remove', { status: 'missing', reason: 'datatype objects cannot be detached from windows' }],
  ['_dt refresh', { status: 'missing', reason: 'datatype object layout and rendering are not modelled' }],
  ['_dt what methods', { status: 'missing', reason: 'datatype class method tables are not modelled' }],
  ['_dt what triggers', { status: 'missing', reason: 'datatype trigger method tables are not modelled' }],
  ['_dt do', { status: 'missing', reason: 'datatype object methods are not modelled' }],
  ['_dt str$', { status: 'missing', reason: 'GetDTString is not modelled' }],
  ['_sys own', { status: 'missing', reason: 'lowlevel SystemControlA ownership is not modelled' }],
  ['_sys disown', { status: 'missing', reason: 'lowlevel SystemControlA ownership is not modelled' }],
  ['_joy set', { status: 'partial', reason: 'port type forcing exists, but hardware autosense is represented by host state' }],
  ['_joy init', { status: 'partial', reason: 'port autosense exists, but hardware polling is represented by host state' }],
  ['_joy read', { status: 'partial', reason: 'joyport bits are modelled; mouse motion and hardware polling are not' }],
  ['_joy type', { status: 'partial', reason: 'joyport type is modelled; hardware autosense is represented by host state' }],
  ['_time elapsed', { status: 'partial', reason: 'elapsed-time state is modelled at frame rather than E-clock granularity' }],
  ['_key pressed', { status: 'faithful', reason: 'KeyQuery reads the machine keyboard held-key set by raw keycode' }],
  ['_loc init', { status: 'faithful', reason: 'OpenLibrary(locale.library, 38) succeeds at the requested version' }],
  ['_loc open', { status: 'partial', reason: 'OpenLocale is represented by the fixed built-in English locale, not user preferences' }],
  ['_loc close', { status: 'faithful', reason: 'the immutable built-in Locale has no observable close lifecycle' }],
  ['_loc str', { status: 'partial', reason: 'GetLocaleStr is modelled, but the open locale is fixed rather than preference-selected' }],
  ['_cat open', { status: 'partial', reason: 'catalog decoding is faithful, but locale path selection and OpenCatalog tags are not modelled' }],
  ['_cat close', { status: 'faithful', reason: 'parsed catalogs need no observable close lifecycle' }],
  ['_cat str', { status: 'faithful', reason: 'GetCatalogStr returns the catalog value or caller default exactly' }],
  ['_asl alloc', { status: 'partial', reason: 'all three requester types allocate, but only the tag subset used by existing ports is modelled' }],
  ['_asl do', { status: 'partial', reason: 'file, font and screen-mode dialogs run, but arbitrary native requester tags are not modelled' }],
  ['_asl free', { status: 'faithful', reason: 'requester state has no observable resources after the modal request ends' }],
  ['_asl what file', { status: 'faithful', reason: 'the file requester preserves its selected file field' }],
  ['_asl what drawer', { status: 'faithful', reason: 'the file requester preserves its selected drawer field' }],
  ['_asl what nb args', { status: 'missing', reason: 'ASL multi-selection and its WBArg array are not modelled' }],
  ['_asl what font', { status: 'faithful', reason: 'the font requester preserves its selected font name' }],
  ['_asl file$', { status: 'faithful', reason: 'the modal file requester and joined selected path are modelled' }],
  ['_icon kill', { status: 'missing', reason: 'DeleteDiskObject and icon-file deletion are not modelled' }],
  ['_icon free', { status: 'faithful', reason: 'decoded immutable DiskObjects have no observable allocation lifecycle' }],
  ['_icon def', { status: 'missing', reason: 'GetDefDiskObject and default icon allocation are not modelled' }],
  ['_icon load', { status: 'partial', reason: 'DiskObject files decode, but coordinates, DrawerData contents and ToolWindow are not retained' }],
  ['_icon save', { status: 'missing', reason: 'PutDiskObject serialization is not modelled' }],
  ['_icon info', { status: 'missing', reason: 'workbench.library Info window integration is not modelled' }],
  ['_icon get', { status: 'partial', reason: 'machine code aliases _icon load after AMOS path conversion' }],
  ['_icon del', { status: 'missing', reason: 'machine code aliases _icon kill after AMOS path conversion' }],
  ['_icon put', { status: 'missing', reason: 'machine code aliases _icon save after AMOS path conversion' }],
  ['_li new', { status: 'partial', reason: 'LayerInfo exists, but requires host dimensions instead of native dimensionless allocation' }],
  ['_li free', { status: 'partial', reason: 'LayerInfo has managed lifetime but no native DisposeLayerInfo invalidation semantics' }],
  ['_layer create behind', { status: 'partial', reason: 'layer ordering and clipping exist; bitmap, RastPort and backfill-hook binding do not' }],
  ['_layer create upfront', { status: 'partial', reason: 'layer ordering and clipping exist; bitmap, RastPort and backfill-hook binding do not' }],
  ['_layer delete', { status: 'partial', reason: 'chain deletion and exposure exist; native bitmap restoration and backfill do not' }],
])

const auditMany = (status: OsBackendStatus, reason: string, names: readonly string[]): void => {
  for (const name of names) AUDITED.set(name, { status, reason })
}

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
])
auditMany('missing', 'window menu-strip or shared-port attachment is not modelled', [
  '_menu set', '_menu clear', '_menu share',
])
auditMany('partial', 'the underlying gadget/menu/bank primitive exists, but OS DevKit high-level bank integration is not implemented', [
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
auditMany('partial', 'GetUniqueID is process-local and unique, but does not share native utility.library global state', [
  '_id unique',
])
auditMany('missing', 'stoneplayer.library and its installed player state are not modelled; the library binary is not shipped with OS DevKit or present in the held library set', [
  '_sp install', '_sp play', '_sp stop', '_sp remove', '_sp volume', '_sp balance', '_sp speed', '_sp mix',
  '_sp check', '_fx balance',
])
auditMany('partial', 'AMOS Samples-bank selection and Paula playback exist, but the absent stoneplayer.library wrapper and its extended playback controls do not', [
  '_fx play', '_fx bank',
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
auditMany('partial', 'Amiga path joining and directory-part extraction exist, but native fixed-buffer and full DOS AddPart edge semantics are not modelled', [
  '_path add', '_path part',
])
auditMany('partial', 'filesystem paths exist, but native BPTR lock identity, shared/exclusive ownership and lock-to-handle lifetime are not exposed', [
  '_dos lock', '_dos unlock', '_dos l open', '_dos l name', '_dos dir', '_dos rd lock', '_dos wr lock', '_lock name$',
])
auditMany('partial', 'the path operation is modelled, but these entry points operate on caller-owned C buffers and pointers that the backend does not expose', [
  '_dos add part', '_dos file part', '_dos path part',
])
auditMany('faithful', 'dos.library FilePart boundary rules are modelled for the AMOS-string wrapper', [
  '_file part',
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
auditMany('partial', 'sequential and random file streams provide the operation, but OS DevKit raw DOS file handles, caller-owned buffers and packet-level modes are not exposed', [
  '_dos open', '_dos close', '_dos seek', '_dos read', '_dos write', '_dos f getc', '_dos f gets',
  '_dos f putc', '_dos f puts', '_dos f ungetc', '_dos mode', '_dos f name',
  '_dos opin', '_dos opout', '_dos append', '_dos print', '_dos input', '_dos eof', '_dos lof', '_fh name$',
])
auditMany('missing', 'the process-wide dos.library IoErr/SetIoErr state is not modelled', [
  '_dos err', '_dos set err',
])
auditMany('partial', 'AmigaDOS error strings are mapped where callers need them, but arbitrary Fault buffer formatting is not exposed', [
  '_dos fault',
])
auditMany('missing', 'dos.library ReportEvent requester/reporting behavior is not modelled', [
  '_dos report',
])
auditMany('partial', 'Amiga hunk loading and host process launch exist, but native segment lists, unloading and CreateNewProc tag lists are not exposed', [
  '_dos seg load', '_dos seg unload', '_dos new proc',
])
auditMany('partial', 'filesystem change subscriptions exist, but native NotifyRequest allocation and task-signal or MsgPort delivery are not integrated', [
  '_dos sig notify', '_dos msg notify', '_dos end notify',
])
auditMany('faithful', 'the NotifyRequest user-data longword at offset 8 is represented exactly', [
  '_nr what user',
])
auditMany('partial', 'the launch name and current directory exist, but the original Workbench WBArg lock/name pair is not retained independently after startup', [
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
auditMany('partial', 'synthetic library open/close and base metadata exist, but arbitrary resident loading, open counts and real build revisions do not', [
  '_lib version', '_lib revision', '_lib open', '_lib close',
])
auditMany('missing', 'the worker invokes an arbitrary negative LVO with a complete 68k register frame, and no 68k execution backend exists', [
  '_lib call',
])
auditMany('faithful', 'the worker returns a stable base for a library with a concrete registered backend', [
  '_base dos', '_base gfx', '_base int', '_base gad', '_base asl', '_base icon', '_base loc', '_base dt',
  '_base layers',
])
auditMany('partial', 'the underlying object exists, but the backend does not expose its native raw pointer layout', [
  '_base topaz', '_base tag',
])
auditMany('missing', 'workbench.library and a Workbench desktop base are not modelled', [
  '_base wb',
])
auditMany('partial', 'four-field timestamp comparison is modelled with the Workbench half-second default, but user Preferences do not supply the interval', [
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
auditMany('partial', 'GadTools message filtering and reply accounting exist, but the workers native TypeOfMem guard and sentinel pointer are not represented', [
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
auditMany('partial', 'the immediate result is exact, but an empty wait cannot suspend and reschedule a TypeScript task', [
  '_port wait', '_sig wait',
])
auditMany('partial', 'GetMsg FIFO removal exists, but the workers raw TypeOfMem guard is not represented', [
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
auditMany('missing', 'the old-style native Requester record, gadget/border chains and activation lifecycle are not modelled', [
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
auditMany('partial', 'disk-font parsing and lookup exist, but native TextAttr/TextFont pointers, the resident font list and open-count ownership are not integrated', [
  '_font add', '_font ask', '_font close', '_font open', '_font rem', '_font load',
])
auditMany('partial', 'polygon, ellipse, flood and rectangle rendering exist, but caller-owned native RastPort/AreaInfo/TmpRas records and raw raster allocation are not integrated', [
  '_area draw', '_area ellipse', '_area end', '_area move', '_rp flood', '_area init', '_rp bar',
  '_rast alloc', '_rast free',
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
auditMany('partial', 'global ENV: variable storage exists, but local-variable lists, FindVar pointers and the full DOS flag surface do not', [
  '_dos var del', '_dos var find', '_dos var value$',
])
auditMany('missing', 'dos.library ReadArgs template parsing and OS DevKit’s retained 256-slot result table have no backend', [
  '_cli read args', '_cli what arg$', '_cli what arg',
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
    const audited = AUDITED.get(name)
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
