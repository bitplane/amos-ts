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
