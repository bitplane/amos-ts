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
  return entries.filter((entry) => entry.name).map((entry) => {
    const name = entry.name!.replace(/^!/, '')
    const namespace = namespaceOf(name)
    const missing = MISSING.find((f) => f.names(name, namespace))
    const modelled = MODELLED.get(namespace)
    const audited = AUDITED.get(name)
    const routines = [...new Set([entry.instr, entry.func].filter((n) => n !== undefined && n !== 1 && n !== 0xffff))]
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
