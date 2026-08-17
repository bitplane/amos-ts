import type { TokenLine } from '../tokens/stream'
import { DEFAULT_MOUSE_BANK } from './mousebank.gen'
import { TokenTable, parseSource } from '../tokens/stream'
import { Interp, newInputState } from '../interp/interp'
import type { AmosArray, InputState, InterpOptions, RunResult } from '../interp/interp'
import type { Addr } from '../interp/prescan'
import type { AmosIO } from '../interp/io'
import { AmosError, VF, VI } from '../interp/values'
import type { Value } from '../interp/values'
import type { Bank, MemoryBank, SpriteBank } from '../loader/amosfile'
import { parseAmosFile } from '../loader/amosfile'
import { Collide } from './collide'
import { Intuition, WB_SLOT } from '../amiga/intuition'
import { Boopsi } from '../amiga/boopsi'
import { MuiMaster } from '../amiga/muimaster'
import type { DiskFont } from '../amiga/diskfont'
import { FONT8 } from './font.gen'
import { bufferRegion, byteRegister, claimedRegion, findRegion, readOnlyRegister, slottedRegion, within } from '../amiga/memmap'
import type { MemRegion } from '../amiga/memmap'
import { newPiConfig, PI_DEFAULTS } from './piconfig.gen'
import { ensureLib, speakOne, type SpeechState } from './speech'
import { SpeakBuffer, type SpeakOptions } from '../amiga/speak'
import { ercoleVbl, type ErcoleState } from './ercole'
import type { EasyLifeState } from './easylife'
import type { DumpState } from './dump'
import type { MiscExtState } from './miscext'
import type { FileIdState } from './fileid'
import type { RangeState } from './range'
import type { DisplayExtState } from './displayext'
import type { MaxsDoorState } from './maxsdoor'
import type { SymBaseState } from './symbase'
import { dmeVbl, type DmeState } from './dme'
import { jotreVbl, type JotreState } from './jotre'
import { thxVbl, type ThxState } from './thx'
import type { JdIntState } from './jdint'
import type { AmonState } from './amon'
import type { ExplodeState } from './explode'
import { thegameVbl, type TheGameState } from './thegame'
import type { MedExtState } from './medext'
import { p61Vbl, type P61State } from './p61'
import type { PowerBobsState } from './powerbobs'
import type { TomeState } from './tome'
import { type IoPortsState } from './ioports'
import { type CtextState } from './ctext'
import { type JdState } from './jd'
import { type SticksState } from './sticks'
import { gamesupportVbl, type GameSupportState } from './gamesupport'
import { slnVbl, type SlnState } from './sln'
import type { MakeState } from './make'
import type { ToolsState } from './tools'
import type { CraftState } from './craft'
import { musicraftVbl, type MusicraftState } from './musicraft'
import { musicOmegaVbl, type MusicOmegaState } from './musicomega'
import type { OpalState } from './opal'
import type { DeltaState } from './delta'
import type { LSerialState } from './lserial'
import type { BUtilityState } from './butility'
import type { JdColourState } from './jdcolour'
import { type DevChannel, type DevState, newDevState, DEV_IO_STRIDE, DEV_MAX } from './device'
import type { SerialPortHandle } from '../amiga/host'
import { RexxPorts, type RexxMessage } from '../amiga/rexx'
import { starfieldVbl, type StarsState } from './stars'
import { type AgaState } from './aga'
import { amcafPtVbl, type AmcafState } from './amcaf'
import { personnalVbl, type PersonnalState } from './personnal'
import type { PiConfig } from './piconfig.gen'
import { FSV, fselAppear, fselDisAppear, fselFirst, fselJump, fselNext, fselSlideStep, fselStore, slideOpen, slideShut } from './fsel'
import type { SlideState } from './fsel'
import type { FselState, FselStoreEntry } from './fsel'
import { parseAmalBank } from '../loader/amalbank'
import type { AmalBank } from '../loader/amalbank'
import { isResourceBankName, parseResourceBank } from '../loader/resource'
import type { ResourceBank } from '../loader/resource'
import type { Extension } from '../ext/registry'
import { DEFAULT_PALETTE, Screen, builtinPattern, sliderMetrics } from './screen'
import { extensionImpls, makeAllInstructions, makeAllFunctions, makeRawFunctions } from './instr'
import { implsBySlot, type ExtensionImpl } from './extimpl'
import { defaultHost, type Host } from '../amiga/host'
import { Machine } from '../amiga/machine'
import { BNK, BOB_BANK, BOB_BANK_FLAGS, ICON_BANK, ICON_BANK_FLAGS, type BankRef } from './banks'
import { type LdosState } from './ldos'
import { tftVbl, type TftState } from './tft'
import { type JvpState } from './jvp'
import { type LocaleState } from './locale'
import { blitVbl, starsVbl, type TurboState } from './turbo'
import { type TdState } from './td'
import { ObjectBank } from './objects'
import { BankImage } from './objects'
import { Display } from './display'
import { rowBytesFor, bankRowBytesFor } from '../amiga/planar'
import type { Bob, HwSprite } from './objects'
import type { AmosFS } from '../amiga/fs'
import { A1200_POOLS, MEMF, availMem, type MemoryInUse } from '../amiga/exec'
import { CIAA_PRA, CIAA_PRB, CIAA_SDR, CIAB_DDRB, CIAB_PRA, CIAB_PRB } from '../amiga/cia'
import { JOY0DAT, JOY1DAT, POTGOR } from '../amiga/gameport'
import { AmalChannel } from './amal'
import type { AmalHost, ChannelTarget } from './amal'
import {
  DialogChannel,
  DialogError,
  DialogExec,
  dialogZoneAt,
  dialogZoneByNumber,
  dialogZoneValue,
  drawEditZone,
  drawListZone,
  drawSliderZone,
  editFirst,
  editNext,
  eraseDialog,
  prescanDialog,
  zoneChange,
  zoneDraw,
  DIALOG_ERRORS,
} from './dialog'
import type { DialogDraw, DialogHost, DialogZone } from './dialog'
import {
  MF_BOUGE,
  MF_FIXED,
  MF_TBOUGE,
  MenuTree,
  drawMenuCell,
  drawMenuBranch,
  menuCalc,
  menuZoneAt,
  restoreRect,
  MF_BAR,
} from './menu'
import type { MenuHost, MenuNode, OpenLevel } from './menu'
import { parseSampleBank } from './audio'
import { FRAME_DISPATCHES, NullAudio, VBL_HZ, periodToHz, samPeriod } from '../amiga/paula'
import { MusicPlayer } from './music'

/**
 * Motorola FFP float format (mathffp.library): bits 31-8 = normalized
 * mantissa (MSB set), bit 7 = sign, bits 6-0 = exponent excess-64.
 * Varptr'd float cells expose this representation.
 */
export function toFFP(n: number): number {
  if (n === 0 || !Number.isFinite(n)) return 0
  const sign = n < 0 ? 0x80 : 0
  const a = Math.abs(n)
  let e = Math.ceil(Math.log2(a))
  let m = a / 2 ** e // (0.5, 1]
  if (m <= 0.5) {
    m *= 2
    e--
  }
  let mant = Math.round(m * 0x1000000)
  if (mant >= 0x1000000) {
    mant >>= 1
    e++
  }
  const exp = e + 0x40
  if (exp <= 0) return 0
  if (exp > 0x7f) return ((0xffffff << 8) | sign | 0x7f) >>> 0
  return ((mant << 8) | sign | exp) >>> 0
}

export function fromFFP(v: number): number {
  const mant = v >>> 8
  if (mant === 0) return 0
  const sign = v & 0x80 ? -1 : 1
  const exp = (v & 0x7f) - 0x40
  return sign * (mant / 0x1000000) * 2 ** exp
}
import type { SampleEntry } from './audio'
import type { AudioSink } from '../amiga/paula'
import { AmigaFS } from '../amiga/vfs'

/**
 * One rainbow (RainTable entry, +WEqu.s:169-183, NbRain = 4). The 12-bit
 * colour table is generated once by Set Rainbow (TRSet +W.s:3990); Rainbow
 * n,base,y,h stores raw values and pending-change bits (RnAct), which the
 * copper build folds into the display fields lazily (RainA1-A5 +W.s:6079).
 */
export interface Rainbow {
  /** RnColor: the palette register the copper writes (0-15) */
  colour: number
  /** the pre-computed 12-bit colour per line */
  table: Uint16Array
  /** RnBase: validated start offset into the table */
  base: number
  /** RnX/RnY/RnI: raw Rainbow-instruction values (h < 0 = not displayed) */
  x: number
  y: number
  h: number
  /** RnAct pending bits: 0 = height, 1 = base, 2 = y */
  act: number
  /** computed display span in hardware lines [dy, fy) and latched height */
  dy: number
  fy: number
  ty: number
}

/**
 * The interpreter-config message table (Sys_Messages, Txt1 block of
 * +Interpreter_Config.s:135-190): system file names, extension libraries,
 * communication ports and the cursor flash. `Resource$(-n)` reads entry n
 * for n in 1..1000 (FnResource +ILib.s:6714). Sparse — untranscribed
 * entries are genuinely empty in the original.
 */
export const SYS_MESSAGES: Record<number, string> = {
  1: 'APSystem/',
  4: 'Def_Icon',
  5: 'AutoExec.AMOS',
  6: 'AMOSPro_Editor',
  7: 'AMOSPro_Editor_Config',
  8: 'AMOSPro_Default_Resource.Abk',
  9: 'AMOSPro_Productivity1:Equates/AMOSPro_System_Equates',
  10: 'AMOSPro_Monitor',
  11: 'AMOSPro_Monitor_Resource.Abk',
  12: 'AMOSPro_Accessories:AMOSPro_Help/AMOSPro_Help',
  13: 'AMOSPro_Accessories:AMOSPro_Help/LatestNews',
  14: 'AMOSPro.Lib',
  16: 'AMOSPro_Music.Lib',
  17: 'AMOSPro_Compact.Lib',
  18: 'AMOSPro_Request.Lib',
  20: 'AMOSPro_Compiler.Lib',
  21: 'AMOSPro_IOPorts.Lib',
  43: 'Par:',
  44: 'Aux:',
  46: '(000,2)(440,2)(880,2)(bb0,2)(dd0,2)(ee0,2)(ff2,2)(ff8,2)(ffc,2)(fff,2)(aaf,2)(88c,2)(66a,2)(226,2)(004,2)(001,2)',
}

/**
 * The system flash sequence (interpreter-config message 46,
 * +Interpreter_Config.s:186) — Screen Open runs `Flash 3` with it on any
 * screen deeper than one plane (+Lib.s:8989), which is what makes the
 * out-of-the-box cursor pulse gold-white-blue.
 */
export const DEFAULT_FLASH_SPEC = SYS_MESSAGES[46]!

/**
 * FlStart's spec parser (+W.s:5340-5378): a strict run of `(hhh,ticks)`
 * groups — exactly three hex digits, a non-zero delay (decimal or $hex,
 * dechexa), at most 16 pairs, nothing between groups. Returns null on a
 * malformed string ("Flash declaration error"); an empty string is the
 * documented way to stop one colour and parses to an empty sequence.
 */
export function parseFlashSpec(spec: string): Array<{ rgb: number; ticks: number }> | null {
  const seq: Array<{ rgb: number; ticks: number }> = []
  const re = /\(([0-9a-f]{3}),(\$[0-9a-f]+|\d+)\)/giy
  let pos = 0
  while (pos < spec.length) {
    re.lastIndex = pos
    const m = re.exec(spec)
    if (!m) return null
    const ticks = m[2]!.startsWith('$') ? parseInt(m[2]!.slice(1), 16) : parseInt(m[2]!, 10)
    if (ticks === 0) return null
    seq.push({ rgb: parseInt(m[1]!, 16), ticks })
    pos = re.lastIndex
  }
  return seq.length > 16 ? null : seq
}

/** STOS Anim slot: (image,delay) pairs, L = loop (AniStos +W.s:7490) */
export interface StosAnim {
  pairs: Array<[number, number]>
  loop: boolean
  idx: number
  left: number
  done: boolean
  on: boolean
  frozen: boolean
}

/**
 * STOS Move X/Y slot: optional start position, (speed,step,count) groups
 * (count 0 = 65536 steps), L = loop / E = stop, either with an optional
 * position that triggers on equality (AniStos AnMve +W.s:7516).
 */
export interface StosMove {
  start: number | null
  groups: Array<[number, number, number]>
  loop: boolean
  endPos: number | null
  gi: number
  speedLeft: number
  countLeft: number
  started: boolean
  done: boolean
  on: boolean
  frozen: boolean
}


/**
 * An AMOS array block starts with a header, and =Array hands out its address.
 *
 * GetTablo (+ILib.s:4042) is the read side and it is unambiguous — it walks
 * the block as: a BYTE of dimension count, a BYTE of element-size shift, then
 * per dimension a WORD of size and a WORD of stride, then the elements. So a
 * one-dimensional array of longwords has a six-byte header and its first
 * element at +6, and InDim (:3978) allocates exactly `dims*4 + 2` bytes for it.
 *
 * The size word is the DIM value, not the element count: `Dim A(10)` stores 10
 * and holds eleven elements, because AMOS increments after storing (Dim2,
 * :3961). Every consumer agrees — JD's Get Dim reads 2(a0) and its Array Clear
 * wipes size+1 elements (+|jd.s:6074, :6066).
 *
 * This port used to map the elements at offset 0 with no header at all, so a
 * program walking an array through =Array and Leek read one element early and
 * could not find the dimension. The variable's type flag, which InDim writes
 * at -2(a0), lives outside the block and is not mapped: nothing reads it
 * through an address.
 */
const ARRAY_HEADER = 6

/**
 * `Uint8Array` methods that CHANGE the bytes, so a Varptr slot handed out
 * through one of them has to flush back into the AMOS variable.
 *
 * `set`, `fill` and `copyWithin` are not exotic: they are how the port moves
 * a block, and AMOS's own `Copy` reaches its destination through two of
 * them. `sort` and `reverse` are here for completeness rather than because
 * anything calls them on mapped memory.
 *
 * `subarray` is deliberately NOT here. It writes nothing itself, but the
 * view it returns shares the buffer and carries no trap, so a write through
 * one is lost exactly as a DataView's is. Nothing in the tree does it; if
 * something starts to, this is the list that should have caught it.
 */
const MUTATORS = new Set(['set', 'fill', 'copyWithin', 'sort', 'reverse'])

/**
 * The face Intuition draws window titles in — topaz 8, as a `struct
 * TextFont`, so `RastPort.text` can render it like any other opened font.
 *
 * DEVIATION: the glyphs are FONT8, which is AMOS's own console face taken out
 * of the AMOS binary, not Commodore's topaz.font. Both are 8x8 monospaced and
 * neither is in the archive as a file; the real topaz lives in Kickstart ROM,
 * which this port does not have. The METRICS are topaz's — 8 wide, 8 tall,
 * baseline 6 — so the title bar lays out where a real one would, and only the
 * letterforms differ. Opening the real face when a Fonts: drawer holds one is
 * what `Elopen Font` already does and what this should do when it can.
 */
let intuitionFontCache: DiskFont | null = null

function intuitionFont(): DiskFont {
  if (intuitionFontCache) return intuitionFontCache
  // one row of 256 glyphs side by side, which is the diskfont layout
  const modulo = 256
  const charData = new Uint8Array(modulo * 8)
  const charLoc: Array<[number, number]> = []
  for (let ch = 0; ch < 256; ch++) {
    const g = FONT8[ch] ?? FONT8[32]!
    for (let row = 0; row < 8; row++) charData[row * modulo + ch] = g[row]!
    charLoc.push([ch * 8, 8])
  }
  intuitionFontCache = {
    name: 'topaz.font',
    ySize: 8,
    style: 0,
    flags: 0,
    xSize: 8,
    baseline: 6,
    loChar: 0,
    hiChar: 255,
    proportional: false,
    modulo,
    charData,
    charLoc,
    charSpace: null,
    charKern: null,
  }
  return intuitionFontCache
}

function writeArrayHeader(buf: Uint8Array, count: number): void {
  buf[0] = 1 // one dimension
  buf[1] = 2 // element size shift: 4 bytes
  const size = Math.max(0, count - 1) // the DIM value, one less than the count
  buf[2] = (size >>> 8) & 0xff
  buf[3] = size & 0xff
  buf[4] = 0
  buf[5] = 1 // stride, unused for the last dimension
}

export interface RuntimeOptions {
  extensions?: Map<number, TokenTable>
  /**
   * slot -> which extension, by registry identity (loader/program.ts supplies
   * it). Without it a port's slot-qualified keywords fall back to every slot
   * the registry has seen that extension at; with it they answer only where it
   * is actually bound. See ./extimpl.ts.
   */
  extBindings?: Map<number, Extension>
  onUnimplemented?: 'throw' | 'skip'
  maxSteps?: number
  /**
   * Statements a `frame()` runs before yielding. Defaults to `FRAME_DISPATCHES`.
   *
   * Lower it and a program that polls between vertical blanks gets less done
   * per frame, which is the whole point; raise it and BASIC outruns the
   * display. It is not a performance knob, it is how fast the machine was.
   */
  frameBudget?: number
  /** mirror of all console text output (for transcripts/CLIs) */
  onText?: (text: string) => void
  /** resource banks from the .AMOS file */
  banks?: Bank[]
  /** file provider for Load Iff etc. — shorthand for host.fs */
  fs?: AmosFS
  /** sound output (default: recording NullAudio) — shorthand for host.audio */
  audio?: AudioSink
  /**
   * Everything the machine needs from outside itself, in one place: the
   * clock, the printer sink, and the file and audio providers the two
   * options above are shorthand for. See ./host.ts — the deterministic
   * defaults live there, which is what keeps a headless run reproducible.
   */
  host?: Partial<Host>
  /**
   * The machine to run on. Supply one to keep power and reset state across
   * the Runtimes a reset builds; omit it and this environment gets its own,
   * which is right for anything that never resets.
   */
  machine?: Machine
}

/**
 * The "virtual Amiga": owns the interpreter, the screens, the 50Hz clock
 * and the input devices. Drive it by calling frame() fifty times a second
 * (or in a tight loop headless).
 */
/** stand-in for a plane pointer that resolved to nothing */
export const EMPTY_PLANE = new Uint8Array(0)

/**
 * Who owns a screen slot. See `Runtime.SCREEN_SLOTS` for the partition and
 * why the owner is derived from the index rather than stored on the Screen.
 */
export type ScreenOwner = 'user' | 'amos' | 'game' | 'os'

export class Runtime {
  readonly interp: Interp
  /**
   * The machine's input devices, plus this program's consumption of them.
   *
   * Bound through a thunk because `opts.machine` replaces `this.machine`
   * inside the constructor, which runs after this initialiser: capturing the
   * object here would leave the view reading a machine nobody else has.
   */
  readonly input: InputState = newInputState(() => this.machine)
  screens = new Map<number, Screen>()
  /** z-order, back to front */
  order: number[] = []
  currentIndex = 0
  rainbows = new Map<number, Rainbow>()

  /**
   * Personnal's memory registers. The extension builds its own copper list
   * and keeps pointers into it; see personnal.ts.
   *
   * The `!` here and on the fourteen other port states is not a loose end:
   * each is built by its own port's `init` (./extimpl.ts), which the
   * constructor runs for every port before anything can reach one. They used
   * to be `= newPersonnalState()` initialisers, which meant an extension's
   * startup belonged to this class and could only ever happen once — and
   * AMCAF's Extreinit is a request to do it again.
   */
  personnal!: PersonnalState
  /**
   * BEAMCON0 ($DFF1DC). Personnal's Set Pal/Set Ntsc write it directly and
   * nothing here reads it yet — the composite window is a PAL monitor either
   * way. Kept because the register is the whole of those two keywords.
   */
  beamcon0 = 0x0020
  /** FMODE ($DFF1FC), written directly by Aga Off */
  fmode = 0
  /** BPLCON3 ($DFF106) written outside a list, by Aga Off */
  bplcon3Direct = 0
  shifts = new Map<number, { dir: number; delay: number; first: number; last: number; wrap: boolean; count: number }>()
  /** Fade: per-screen nibble-stepping toward targets (-1 = untouched) */
  fades = new Map<number, { delay: number; count: number; targets: Int32Array }>()
  /** The flasher table: up to FlMax=16 entries, one per (colour, screen)
   * pair (T_TFlash +WEqu.s:138-141, FlStart +W.s:5303). The 68k records
   * the screen ADDRESS at Flash time; we record the Screen object and drop
   * the entry once that screen is closed or replaced (on hardware the
   * interrupt would write into freed memory — observably: nothing). */
  flashes: Array<{ reg: number; screen: number; scr: Screen; seq: Array<{ rgb: number; ticks: number }>; idx: number; left: number }> = []
  /** Colour Back: the display border colour (composite background) */
  colourBack = 0
  scrollZones = new Map<number, { x1: number; y1: number; x2: number; y2: number; dx: number; dy: number }>()
  // ---- objects ----
  spriteBank: ObjectBank | null = null
  iconBank: ObjectBank | null = null
  memBanks = new Map<number, MemoryBank>()
  /** which extension each slot holds, by registry identity, or null if unknown */
  readonly extBindings: Map<number, Extension> | null
  bobs = new Map<number, Bob>()
  hwSprites = new Map<number, HwSprite>()
  /** bob pipeline: auto update each frame (Bob Update On/Off) */
  bobUpdateOn = true
  /** saved background under each drawn bob, restored before redraw */
  /**
   * What is under each bob, keyed `bob|buffer`.
   *
   * The buffer is in the key because AMOS keeps one background PER BUFFER when
   * a screen is double buffered, and its own source is explicit about it
   * (`+W.s:975`): `btst #BitDble,EcFlags(a2)` then `addq.w #1,BbDecor(a0)` and
   * a second slot in `BbDCur2`. Keyed by bob alone, a save taken from one
   * buffer was restored into the other on the next frame, painting whatever
   * had been under the bob two frames ago and leaving a trail that never
   * cleared.
   *
   * Insertion order is load-bearing: both restores walk it reversed, so bobs
   * are put back newest first and overlapping saves unwind in the order they
   * were taken.
   */
  bobSaved = new Map<
    string,
    { bob: number; screen: number; buffer: number; x: number; y: number; w: number; h: number; data: Uint8Array }
  >()
  /** Set Bob background modes: 0 save/restore, <0 none, >0 fill colour-1 */
  /**
   * The simulated machine's memory pools, in bytes.
   *
   * The sizes are exec's and live in ../amiga/exec.ts; these two are kept as
   * aliases because `Jd Cpu`, `Jd Chipset` and `Cpu Info` all derive the
   * machine's identity from them — 2MB of chip plus a fast board is what makes
   * the answer an A1200 — and that reasoning is easier to follow when the
   * numbers are named where those keywords can see them.
   */
  static readonly CHIP_TOTAL = A1200_POOLS.chip
  static readonly FAST_TOTAL = A1200_POOLS.fast
  /**
   * The nominal BASIC variable region Free reports against (TabBas-HiChaine).
   * `PI_DefSize` is the editor-editable default, grown by Set Buffer.
   */
  static readonly VARIABLE_SPACE = PI_DEFAULTS.DefSize

  bobModes = new Map<number, number>()
  /**
   * Set Bob's `planes` argument: the bitplane write mask (BbAPlan, set by
   * ResBOB +W.s:998 and handed to the blitter as BbDAPlan at +W.s:1271).
   * Omitted means -1, every plane.
   */
  /**
   * Drop a bob's saved backgrounds in EVERY buffer, for when the bob goes.
   *
   * `clearBobs` restores only the buffer under the pen and leaves the other
   * one's save alone, because it is still wanted when that buffer comes round.
   * Once the BOB is gone that save is orphaned, and restoring it later paints
   * a rectangle of whatever the screen held two frames before whatever is
   * there now. `Bob Off` after a `Cls` is how that surfaces: chunks of the old
   * picture reappear on top of the new one.
   *
   * On the machine there is nothing to leak. The background buffers are part
   * of the bob (`BbDecor` counts them, +W.s:975) and go when it does.
   */
  forgetBobSaves(n?: number): void {
    for (const [key, bg] of this.bobSaved) {
      if (n === undefined || bg.bob === n) this.bobSaved.delete(key)
    }
  }

  /**
   * `Put Bob`'s countdown, per bob: how many more erases to SKIP.
   *
   * Put Bob does not stamp anything. `BobPut` (+W.s:1178) is two
   * instructions: find the bob and set `BbECpt` to `BbDecor`, the number of
   * background buffers it has. The erase pass then tests that counter first
   * (`tst.w BbECpt(a5) / bne.s BbE5`, +W.s:1884, commented "Compteur PUT
   * BOB") and, when it is set, skips the erase and decrements instead.
   *
   * So the bob is simply left behind once in each buffer and normal updating
   * resumes --- which is why moving it afterwards smears copies across the
   * screen, and why one call does the right thing whether or not the screen
   * is double buffered.
   */
  bobPut = new Map<number, number>()

  bobPlanes = new Map<number, number>()
  /** Set Bob's blitter control word, per bob (BbACon) */
  bobMinterms = new Map<number, number>()
  /** Limit Bob rectangles: global (key -1) or per bob */
  bobLimits = new Map<number, { x1: number; y1: number; x2: number; y2: number }>()
  priorityReverse = false
  priorityOn = false
  fs: AmosFS | null = null
  // ---- AMAL ----
  channels = new Map<number, AmalChannel>()
  /** Channel n To ... assignments, applied when Amal defines the channel */
  chanTargets = new Map<number, ChannelTarget>()
  amalGlobals = new Int16Array(26)
  amalSeed = 0x1234
  /** Synchro Off: AMAL only steps via the Synchro instruction */
  synchroManual = false
  amalDefaultOn = false
  /** last AMAL compile error position (=Amalerr) */
  amalErrPos = 0
  // ---- audio ----
  audio: AudioSink = new NullAudio()
  /**
   * Vertical blanks since this Runtime started, and NOT `interp.tick`.
   *
   * `Timer = 0` is an ordinary AMOS statement and `builtins.ts` implements it
   * as `it.tick = it.evalInt()`, so the program-visible timer runs backwards
   * whenever a game resets it — which is most games, most seconds. Anything
   * using it as a CLOCK stops dead at that point: the audio sink refuses a
   * time it has already passed, and MED's CIA never fires again.
   *
   * This one only ever counts up. `interp.tick` stays what it was, because
   * `Wait` and `=Timer` are supposed to see what the program wrote.
   */
  frames = 0
  samBankNum = 5
  /** per-voice default volume (EnvDVol); MusDef sets 56 (+Music.s:918) */
  voices = [{ volume: 56 }, { volume: 56 }, { volume: 56 }, { volume: 56 }]
  /** music master volume (MuVolume), default 56 */
  musicVolume = 56
  /** Sam Loop On voice mask */
  samLoopMask = 0
  /**
   * The Vumeter bytes at the head of the extension data zone (MB+0..3):
   * the music player stores each note's volume here on trigger (DoNote
   * +Music.s:1245/1273); FnVuMeter and AMAL's Vu() read AND clear them.
   * =Mubase maps them at MUBASE_ADDR.
   */
  vuBytes = new Uint8Array(4)
  /** the music bank player (MusInt +Music.s), stepped every frame */
  music = new MusicPlayer(
    ((rt: Runtime) => ({
      get audio() {
        return rt.audio
      },
      get vuBytes() {
        return rt.vuBytes
      },
      get musicVolume() {
        return rt.musicVolume
      },
      tick: () => rt.frames,
      beam: () => rt.interp.beamWord(),
      musicBank: () => {
        const b = rt.memBanks.get(3)
        return b && b.name.startsWith('Musi') ? b.data : null
      },
      getBank: (n: number) => rt.memBanks.get(n) ?? null,
      getSample: (n: number) => rt.getSample(n),
      samLoop: () => rt.samLoopMask,
      voiceVolume: (v: number) => rt.voices[v]!.volume,
    }))(this),
  )
  // ---- file channels (Open In/Out/Random, Print #, Input #, Get/Put) ----
  /**
   * Everything this machine can reach outside itself. Composed once in the
   * constructor from the options, so every default is the one in host.ts and
   * no keyword handler has to remember to be deterministic.
   */
  host: Host = defaultHost()

  /**
   * The machine this environment runs on — power state and a pending reset.
   *
   * It is passed in rather than owned, because it OUTLIVES the Runtime: a
   * reset destroys the environment and not the machine, so a caller that
   * wants the two to be distinguishable (the web player, which keeps its
   * filesystem across one) makes the machine first and hands the same one to
   * every Runtime it builds. Callers that never reset get a fresh one and
   * never look at it. See ../amiga/machine.ts.
   */
  machine: Machine = new Machine()

  /** LDos keeps its own channels, separate from Open In/Open Out */
  ldos!: LdosState
  tft!: TftState
  /** JVP-NoKids: sort type, the six string fields, and the message bank */
  jvp!: JvpState
  /** Locale: the open catalog, and the emit description file */
  locale!: LocaleState

  /** TURBO Plus: its own Check zones, and the task priority Multi No sets */
  turbo!: TurboState
  /** AMOS 3D's loaded objects and settings */
  td!: TdState
  /** TOME: the map bank, tile size and view rectangle */
  p61!: P61State
  powerbobs!: PowerBobsState
  tome!: TomeState
  /** MED 7.1: the three player libraries, the loaded module and the mode */
  medExt!: MedExtState
  /** Ercole 1.7: the Prop On hook and the two POT snapshots it fills */
  ercole!: ErcoleState
  /** EasyLife: the fields it keeps in easylife.library's own struct */
  easylife!: EasyLifeState
  /** Jotre 1.0: the THX replayer's flag byte, module address and sub-song */
  jotre!: JotreState
  /** THX 0.6: the play flag, the module address, and the replay itself */
  thx!: ThxState
  thegame!: TheGameState
  /** Misc 1.0: the drive LED, which is all the state its twelve keywords have */
  miscExt!: MiscExtState
  /** Dump 1.1: the last printer-dump message index and the last device error */
  dump!: DumpState
  /** FileID 1.0: the library base, the FileInfo pointer and the last error */
  fileId!: FileIdState
  /** Range 2.6/2.9Plus: the Case latch, the float-bob counter and Game Area */
  range!: RangeState
  /** Display 0.01: the two copper lists it builds and the bank word between them */
  displayExt!: DisplayExtState
  /** MAXS Door Handler 0.20: the 106-byte DoorMsg and the two message ports */
  maxsDoor!: MaxsDoorState
  /** SymBase 0.94 / DBench 0.42: the open channels and the data zone */
  symbase!: SymBaseState
  /** DME 2.0: the ProTracker replay and the flags routine 0 allocates */
  dme!: DmeState

  /**
   * CIA-A PRA bit 1 — the power LED and Paula's low-pass filter, which are
   * the same line. `Led On`/`Led Off` (InLedOn/Of +Music.s:3917) set it and
   * First 0.1's `Change Led` is a `bchg`, so the bit has to be readable and
   * not just writable. True at boot, as the machine comes up with the filter
   * engaged and NullAudio already assumes.
   *
   * The bit lives on the chip now (../amiga/cia.ts) and this is a view of it,
   * which is what makes `Poke $BFE001` reach the same place `Led On` does.
   * Note the inversion: the register bit is 0 for a BRIGHT LED, so a `true`
   * here is a clear bit.
   */
  get ledFilter(): boolean {
    return this.machine.cia.ledBright
  }

  set ledFilter(on: boolean) {
    this.machine.cia.ledBright = on
  }

  fileChans = new Map<
    number,
    {
      mode: 'in' | 'out' | 'random'
      path: string
      data: Uint8Array
      pos: number
      out: number[]
      /**
       * `Open Port` sets bit 2 of FhT (+Lib.s:5078 opens with `#%111` where
       * Open In uses `#%010`), and `=Port(n)` refuses a channel without it.
       */
      port?: boolean
      /** a host serial port, when the name Open Port was given is a real one */
      serial?: SerialPortHandle
      /** Field record layout (InField +ILib.s:4769) */
      fields?: Array<{ len: number; get: () => string; set: (v: string) => void }>
      recSize?: number
      /** file size, snapshotted at Field time, grown by Put */
      fileSize?: number
      /**
       * `SPEAK:` — the channel is the speech handler rather than a file, so
       * `out` accumulates for nobody and nothing is written at Close. See
       * src/amiga/speak.ts.
       */
      speak?: { buf: SpeakBuffer; voice: SpeakOptions }
    }
  >()
  /** Set Input line terminator pair (default CR, skip LF) */
  chrInp: [number, number] = [13, 10]
  /** Dir First$/Dir Next$ iterator */
  dirIter: { entries: Array<{ name: string; isDir: boolean; size: number }>; idx: number } | null = null
  /** Dev/Prg First$/Next$ iterator (FillDev device list) */
  devIter: { entries: string[]; idx: number } | null = null
  /** Set Dir n[,neg$]: name-column width of Dir/Dev listings (DirLNom,
   * default 30 = PI_DirSize +Interpreter_Config.s:69) + negative filter */
  dirWidth = 30
  dirNegFilter = ''
  /** Set Tempras (RasSize/RasLock +Lib.s:9997) — validated, unused by
   * the chunky renderer */
  tempRas: { addr: number; size: number } | null = null
  /** disc fonts enumerated from Fonts: at Get Fonts time (AvailFonts) */
  discFontCache: Array<{ name: string; height: number; type: string; file?: string }> | null = null
  /** Amos Lock's T_NoFlip flag — no screen flipping to suppress here */
  noFlip = false
  /** IffReturn: the last DLTA's ANHD relative time (=Frame Param) */
  iffReturn = 0
  /** Iff Anim playback state (InIffAnim3's frame loop, +Lib.s:4564) */
  iffAnim: { buf: Uint8Array; pos: number; firstPos: number; remaining: number; nextDue: number } | null = null
  // ---- blocks (Get/Put Block, Cblocks) ----
  blocks = new Map<number, { x: number; y: number; w: number; h: number; pixels: Uint8Array; mask: boolean }>()
  cblocks = new Map<number, { x: number; y: number; w: number; h: number; pixels: Uint8Array }>()
  // ---- memory model: banks with fake base addresses ----
  /** Reserve'd banks (in addition to loaded memBanks) get data here */
  bankBase(n: number): number {
    return 0x01000000 + n * 0x00100000
  }

  /** find the bank containing a fake address */
  /**
   * Screen bitplane chip-RAM region (Logbase/Phybase/Screen Base point here).
   * Well above the bank region (bankBase 0x01000000+n*0x100000) so they never
   * collide. Each screen gets a 1MB slot: logical bitmap at the base, physical
   * bitmap at +0x80000, planes `planeSize` apart.
   */
  static readonly SCREEN_CHIP_BASE = 0x40000000
  static readonly SCREEN_CHIP_SLOT = 0x00100000
  static readonly SCREEN_PHY_OFFSET = 0x00080000

  /**
   * HOW MANY SCREEN SLOTS THE MACHINE HAS, which is not the same as how many
   * `Screen Open` can name, and WHO OWNS EACH ONE.
   *
   * The display is a single copper-list interpreter. Anything that wants to
   * appear has to be a band in that list, so everything that opens a display
   * — AMOS, the machine's OS, a game system that takes the machine over —
   * competes for the same table. `../amiga/intuition.ts` states the rule from
   * the other side: there is no second renderer to hang a screen off.
   *
   * AMOS answered the question before it was asked. It opens screens BASIC
   * cannot name — EcFonc 8, EcEdit 9, EcFsel 10, EcReq 11 (+Equ.s:792) — and
   * they are ordinary screens in every respect the hardware cares about: a
   * slot in `screens`, a place in `order`, a band in the copper list, a slot
   * in the chip address space. What makes one a system screen is only that
   * `Screen Open` rejects the index.
   *
   * So the table is partitioned by OWNER, and the owner is derived from the
   * index rather than stored, because a stored one can disagree with the
   * partition and this cannot:
   *
   *      0-7   'user'   Screen Open
   *      8-11  'amos'   AMOS's own: accessories, editor, file selector, requester
   *     12-19  'game'   a game system that takes the display over -- GMS
   *     20-31  'os'     intuition.library: Workbench, and a program's own
   *
   * THIRTY-TWO, and the number is chosen by address-space arithmetic rather
   * than by taste. A slot costs a 1MB stride of `SCREEN_CHIP_BASE` and 4KB of
   * `SCREEN_CTRL_BASE`, and costs nothing at all when empty — the slotted
   * regions answer null for a slot with no screen. The next base above the
   * bitplane region is `SLN_HEAP_BASE` at 0x44000000, which is 64 slots away,
   * and the next above the control blocks is `MAKE_HEAP_BASE`, 16,384 away.
   * So 64 is the ceiling and 32 takes half of it, leaving the other half for
   * whatever needs to grow between them later. Widening again is free until
   * it is not; widening AFTER a program's Peek addresses are in tests is a
   * migration, which is why the room is taken now.
   *
   * DEFECT: this was 8, hardcoded in four places (both slotted regions here,
   * resolvePlanePtr and the inline BPL1PT decode in display.ts) while EC_FSEL
   * was already 10. The band builder emitted a perfectly correct EcCopHo for
   * the file selector's screen — palette, DIWSTRT, BPLxPT at $40a00000 — and
   * then the compositor could not resolve those pointers to any bitmap, so it
   * fetched nothing. The requester drew into its own pixels, every dialog test
   * that reads them passed, and the composited display showed empty border.
   * Nobody caught it because the only path that reads the planes back is the
   * copper walk, and no test composited a system screen.
   */
  static readonly SCREEN_SLOTS = 32

  /** where each owner's run of slots starts; the next one's start ends it */
  static readonly SCREEN_OWNERS: ReadonlyArray<{ from: number; owner: ScreenOwner }> = [
    { from: 0, owner: 'user' },
    { from: 8, owner: 'amos' },
    { from: 12, owner: 'game' },
    { from: 20, owner: 'os' },
  ]

  /** who owns a slot; out of range is nobody's */
  static screenOwner(index: number): ScreenOwner | null {
    if (index < 0 || index >= Runtime.SCREEN_SLOTS) return null
    let owner: ScreenOwner | null = null
    for (const r of Runtime.SCREEN_OWNERS) if (index >= r.from) owner = r.owner
    return owner
  }

  /**
   * Whether a slot is AMOS's, which is the distinction the display-ordering
   * keywords are about: `Amos To Back` puts the interpreter's whole display
   * behind somebody else's, and the user's screens and AMOS's own system
   * screens go together as one thing.
   */
  static amosOwned(index: number): boolean {
    const o = Runtime.screenOwner(index)
    return o === 'user' || o === 'amos'
  }

  /**
   * Where an owner's run begins and how many slots it has.
   *
   * `freeScreenSlot` below serves an allocator that does not care which slot
   * it gets; this serves one that does. A GMS screen is numbered by the
   * program — `G Screen Open 3,...` names screen 3 and `G Screen Close 3`
   * has to find the same one — so the extension needs the run's base to add
   * its own number to, and its length to refuse a number that would walk off
   * the end.
   */
  static screenRange(owner: ScreenOwner): { from: number; count: number } {
    const at = Runtime.SCREEN_OWNERS.findIndex((r) => r.owner === owner)
    const from = Runtime.SCREEN_OWNERS[at]!.from
    return { from, count: (Runtime.SCREEN_OWNERS[at + 1]?.from ?? Runtime.SCREEN_SLOTS) - from }
  }

  /**
   * The lowest free slot belonging to `owner`, or -1 when that owner's run is
   * full. This is the allocator both `intuition.library` and GMS need, and
   * having it here is what keeps the partition above private to this file.
   */
  freeScreenSlot(owner: ScreenOwner): number {
    for (let i = 0; i < Runtime.SCREEN_SLOTS; i++) {
      if (Runtime.screenOwner(i) === owner && !this.screens.has(i)) return i
    }
    return -1
  }

  /**
   * `Amos To Front` / `Amos To Back` (AMOS_WB, +Lib.s:11361).
   *
   * Every AMOS-owned screen moves as one block and keeps its order within
   * itself; everything else keeps its order too. With nothing but AMOS
   * screens open — which is every program that has not started GMS or opened
   * a Workbench — both are the identity, which is what made them no-ops here
   * before there was anything else to be in front of.
   */
  amosToFront(): void {
    this.orderAmos(false)
  }

  amosToBack(): void {
    this.orderAmos(true)
  }

  private orderAmos(back: boolean): void {
    const amos = this.order.filter((i) => Runtime.amosOwned(i))
    const others = this.order.filter((i) => !Runtime.amosOwned(i))
    this.order = back ? [...amos, ...others] : [...others, ...amos]
  }

  /**
   * `=Amos Here` (FnAmosHere = AMOS_WB(-1)): is AMOS's display the frontmost
   * thing? `order` runs back to front, so this is the last entry. An empty
   * display is AMOS's by default — there is nothing in front of it.
   */
  amosInFront(): boolean {
    const front = this.order[this.order.length - 1]
    return front === undefined || Runtime.amosOwned(front)
  }

  /**
   * Private data blocks belonging to extensions, mapped so that a program can
   * reach them by address.
   *
   * Real extensions keep their state in a block AMOS allocates for them and
   * hand its address to BASIC, which then poke/Bloads through it — CText's
   * `Bload ...".CFNT",Font Data` is the case that forced this. A block kept as
   * private fields cannot serve that, so blocks that a keyword exposes an
   * address for live here instead. One 64KB slot each, well clear of the
   * screen region above and the bank region below. 0x78000000 because every
   * lower slot is taken: copper lists are at 0x50000000, Mubase 0x58000000,
   * variables 0x60000000, the sprite and icon banks 0x64/0x68000000, the temp
   * buffer 0x6c000000 and Personnal's two blocks 0x70/0x74000000.
   */
  static readonly EXT_DATA_BASE = 0x78000000
  static readonly EXT_DATA_SLOT = 0x00010000
  /** insertion order fixes each block's slot; the address is stable per run */
  private extBlocks: Uint8Array[] = []
  private extBlockIndex = new Map<string, number>()

  /** register (or look up) an extension's block and return its base address */
  extBlockBase(id: string, block: Uint8Array): number {
    let i = this.extBlockIndex.get(id)
    if (i === undefined) {
      i = this.extBlocks.length
      this.extBlockIndex.set(id, i)
      this.extBlocks.push(block)
    }
    return (Runtime.EXT_DATA_BASE + i * Runtime.EXT_DATA_SLOT) >>> 0
  }

  /** CText's block base — `Font Base` returns this, `Font Data` this + $1e */
  ctextBase(): number {
    return this.extBlockBase('ctext', this.ctext.block)
  }

  /**
   * An extension's loaded CODE, as an address — what `=Extbase(n)` answers.
   *
   * Not the same thing as `extBlockBase` above, which is an extension's DATA
   * and has bytes behind it because a program Bloads through it. This is the
   * library itself, and there is nothing behind it: extension code in this
   * port is TypeScript, so the address is deliberately un-dereferenceable and
   * is not registered as a memory region. Peeking it fails, which is the
   * truth. What it is FOR is the comparison every program actually makes —
   * `If Extbase(8)=0`, "is AMCAF loaded" — and that answer is exact.
   *
   * Slots are 1..26 (AMOS loads 26 extensions; ../ext/registry.ts). A slot
   * with nothing in it reads 0, because AMOS's table starts zeroed and only a
   * loaded extension writes its base there.
   */
  static readonly EXT_CODE_BASE = 0x7c000000
  static readonly EXT_CODE_SLOT = 0x00010000
  static readonly EXT_SLOTS = 26

  /** whether slot n holds an extension at all */
  extSlotFilled(slot: number): boolean {
    return this.extBindings?.has(slot) ?? this.interp.names.extensions.has(slot)
  }

  /** =Extbase(n) — the slot's base address, or 0 if the slot is empty */
  extSlotBase(slot: number): number {
    if (!this.extSlotFilled(slot)) return 0
    return (Runtime.EXT_CODE_BASE + (slot - 1) * Runtime.EXT_CODE_SLOT) >>> 0
  }

  /**
   * Which port answers for each extension slot — AMOS's extension table, as
   * far as this port has one.
   *
   * The single place the slot -> port direction is worked out, for `Default`
   * (every occupied slot's routine) and AMCAF's Extdefault (one of them).
   */
  extSlotImpls(): Map<number, ExtensionImpl> {
    return implsBySlot(extensionImpls(), this.extBindings)
  }

  /** base address of screen n's logical bitmap = Logbase(n=0) */
  screenChipBase(index: number): number {
    return (Runtime.SCREEN_CHIP_BASE + index * Runtime.SCREEN_CHIP_SLOT) >>> 0
  }

  /**
   * Screen Base points at the AMOS screen CONTROL BLOCK (ScOnAd — the Ec
   * structure, +Equ.s:482-540). A read-only image of the block is
   * synthesized on access so Deek/Leek walks work: EcLogic/EcPhysic plane
   * addresses at +0/+24, EcCon0 +72, EcTx/Ty/NPlan +76/78/80, the window
   * geometry, EcNbCol +96, the live palette EcPal +98, EcTPlan +166,
   * EcTLigne +178, EcNumber +188. Pokes into the block are ignored.
   */
  static readonly SCREEN_CTRL_BASE = 0x48000000
  static readonly SCREEN_CTRL_SLOT = 0x00001000

  screenCtrlAddr(index: number): number {
    return (Runtime.SCREEN_CTRL_BASE + index * Runtime.SCREEN_CTRL_SLOT) >>> 0
  }

  private screenCtrlBlock(s: Screen): Uint8Array {
    const b = new Uint8Array(256)
    const w16 = (off: number, v: number): void => {
      b[off] = (v >> 8) & 0xff
      b[off + 1] = v & 0xff
    }
    const w32 = (off: number, v: number): void => {
      w16(off, v >>> 16)
      w16(off + 2, v & 0xffff)
    }
    const logic = this.screenChipBase(s.index)
    const physic = logic + (s.doubleBuffered ? Runtime.SCREEN_PHY_OFFSET : 0)
    for (let p = 0; p < 6; p++) {
      const off = p < s.depth ? p * s.planeSize : 0
      w32(0 + p * 4, p < s.depth ? logic + off : 0) // EcLogic
      w32(24 + p * 4, p < s.depth ? physic + off : 0) // EcPhysic
      w32(48 + p * 4, p < s.depth ? physic + off : 0) // EcCurrent
    }
    w16(72, (s.hires ? 0x8000 : 0) | (Math.min(s.depth, 7) << 12) | 0x200 | (s.laced ? 4 : 0) | (s.ham ? 0x800 : 0)) // EcCon0
    w16(74, 0x24) // EcCon2
    w16(76, s.width) // EcTx
    w16(78, s.height) // EcTy
    w16(80, s.depth) // EcNPlan
    w16(82, s.displayX) // EcWX
    w16(84, s.displayY) // EcWY
    w16(86, s.displayW >= 0 ? Math.min(s.displayW, s.width) : s.width) // EcWTx
    w16(88, s.displayH >= 0 ? Math.min(s.displayH, s.height) : s.height) // EcWTy
    w16(90, s.offsetX) // EcVX
    w16(92, s.offsetY) // EcVY
    w16(96, s.nColors) // EcNbCol
    for (let i = 0; i < 32; i++) w16(98 + i * 2, s.palette[i]! & 0xfff) // EcPal
    w32(166, s.planeSize) // EcTPlan
    w16(174, s.width - 1) // EcTxM
    w16(176, s.height - 1) // EcTyM
    w16(178, s.rowBytes) // EcTLigne
    w16(188, s.index) // EcNumber
    w16(190, s.autoback) // EcAuto
    return b
  }

  // ---- user copper (CpInit/TCop* +W.s:6764-6935) ----
  /**
   * Two real copper-list buffers in mapped chip RAM (T_CopLogic /
   * T_CopPhysic). T_CopLong is interpreter-config item 12, "Taille liste
   * copper" — 12K by default (+Interpreter_Config.s:60). The buffers are
   * plain memory: Leek/Loke through Cop Logic addresses read and patch
   * the actual list bytes, which is how Multi_Rainbows.AMOS works.
   */
  static readonly COPPER_BASE = 0x50000000
  static readonly COPPER_SLOT = 0x00004000
  /** =Mubase — the music extension data zone (vumeter bytes at +0..3) */
  static readonly MUBASE_ADDR = 0x58000000
  /** Varptr/=Array variable arena (FnVarPtr +ILib.s:4087) */
  static readonly VAR_BASE = 0x60000000
  /** Sprite Base / Icon Base synthesized bank images */
  static readonly SPRITE_BANK_BASE = 0x64000000
  static readonly ICON_BANK_BASE = 0x68000000
  /**
   * TempBuffer (ResTempBuffer +ILib.s): the interpreter's scratch block.
   * Read Text loads its file here and hands the dialog engine the address,
   * so HT walks real memory exactly as it does on the Amiga.
   */
  static readonly TEMP_BUFFER_BASE = 0x6c000000
  tempBuffer: Uint8Array | null = null

  /**
   * EasyLife's eight PowerPacker buffers — the table at `$2e(a5-block)`, two
   * longwords a buffer (address then length).
   *
   * "An Easylife Powerpacker Buffer is similar to an AMOS bank of type
   * 'work'. ElPp Buf returns the address of the start of the buffer. It is
   * similar to the start() function for banks." Which is exactly why they
   * need addresses a `Leek` can reach: the guide's own idiom for reading a
   * loaded text file is `ElMem$(ElPp Buf(0)+POS, ...)`.
   */
  static readonly PP_BUFFER_BASE = 0x54000000
  static readonly PP_BUFFER_SLOT = 0x00400000
  ppBuffers: Array<Uint8Array | null> = [null, null, null, null, null, null, null, null]

  /**
   * Personnal's own AllocMem'd blocks — the Mplot point bank, and the AGA
   * icon bank in batch 9. The extension allocates chip memory itself rather
   * than reserving an AMOS bank, and hands the program the address back
   * through Mplot Base, so it has to live somewhere a Leek can reach it.
   */
  static readonly PERSONNAL_BASE = 0x70000000
  personnalMem: Uint8Array | null = null
  /** the same, for the AGA icon bank — a separate AllocMem in the library */
  static readonly PERSONNAL_ICON_BASE = 0x74000000
  personnalIcons: Uint8Array | null = null

  /**
   * MED 7.1's loaded module.
   *
   * `Med Load` does not reserve an AMOS bank — the Guide is explicit, *"Da
   * zum laden keine AMOS Banken benutzt werden"* — and `Med Mod Base` hands
   * the program the address so it can edit the module in place. Same shape as
   * Personnal's blocks above, and the same reason. See medext.ts.
   */
  static readonly MED_MODULE_BASE = 0x7c000000
  medModule: Uint8Array | null = null

  /**
   * GameSupport's sixteen loaded code modules, one slot each.
   *
   * `Gsloadcodemod` is `LoadSeg` and the module's tables are read back through
   * pointers, so a loaded module has to have an ADDRESS: `Gsfindattr` hands
   * one straight to the program, which is expected to peek and poke the entry
   * through it. Sixteen is the table's own size — `moveq #$f, d7` over
   * eight-byte slots at $7a(a1). See gamesupport.ts.
   */
  static readonly CODEMOD_BASE = 0x5c000000
  static readonly CODEMOD_SLOT = 0x0010_0000
  static readonly CODEMOD_SLOTS = 16

  /**
   * SLN 2.0's AllocMem heap.
   *
   * Unlike Personnal's and MED's single blocks, SLN allocates MANY: `S Ainit`
   * takes one per array and hands the address back through `=S Abase`, and
   * `S Sam Load` takes one per sample and CHAINS them by address — the bank
   * holds a pointer to the first and every sample's header points at the next.
   * So a program walks a linked list through Leek, and the list only exists if
   * the blocks are laid out in one address space with real gaps between them.
   * One region backed by one buffer is that space; see `MemPool` in
   * ../amiga/exec.ts and `newSlnHeap` in sln.ts.
   *
   * 0x44000000 because the screen bitplane region below it claims only
   * 0x40000000..0x40ffffff (16 slots of 1MB) and the screen control blocks
   * start at 0x48000000, so this fits between them without moving anything.
   */
  static readonly SLN_HEAP_BASE = 0x44000000
  static readonly SLN_HEAP_RESERVED = 0x04000000

  /**
   * Make 1.30's AllocMem pool.
   *
   * The second caller of `MemPool`, and the one that made it shared. Make's
   * whole first half is exec — `Ma Malloc` hands a program a block and expects
   * it to thread the library's own `MinList` through the eight bytes in front
   * of it, so the blocks have to be at real, ordered addresses in one space
   * exactly as SLN's do.
   *
   * 0x4c000000 because the screen control blocks below it claim only
   * 0x48000000..0x48010000 and the copper lists start at 0x50000000. See
   * `newMakeState` in make.ts.
   */
  static readonly MAKE_HEAP_BASE = 0x4c000000
  static readonly MAKE_HEAP_RESERVED = 0x04000000

  /**
   * Tools 1.01's `Oui Reserve Text` buffers.
   *
   * `Oui Reserve Text` calls `L_Demande` for an AMOS string and stores its
   * ADDRESS in the Oui bank, which `Oui Set Text` and `= Oui Text` then write
   * and read through. AMOS's string workspace has no addresses in this port,
   * so the buffers come from a pool of their own and the pointer in the bank
   * is a real one. See tools.ts.
   *
   * 0x3c000000 because it ends exactly where the screen bitplanes begin.
   */
  static readonly TOOLS_TEXT_BASE = 0x3c000000
  static readonly TOOLS_TEXT_RESERVED = 0x04000000

  /**
   * Explode 2.01's `Rs Structure` pool, and the strings `Rs Aptr` puts
   * pointers to.
   *
   * The eight structures are `L_RamFast` blocks whose addresses a program
   * reads back with `=Rs Start(n)` and then Pokes through, so they have to be
   * real and ordered — the same reason SLN and Make have pools. `Rs Aptr`
   * needs the second half of it: it stores a POINTER to a NUL-terminated
   * copy of a string, and AMOS's own string workspace has no addresses here.
   *
   * 0x38000000 because it ends exactly where CRAFT's FileInfoBlock begins.
   */
  static readonly EXPLODE_HEAP_BASE = 0x38000000
  static readonly EXPLODE_HEAP_RESERVED = 0x02000000

  /**
   * CRAFT's FileInfoBlock, which `Dr Fib` hands back the ADDRESS of.
   *
   * 0x3a000000 because it is the last free megabyte under the Dev IORequests
   * at 0x3b000000 — 0x54000000 was the first choice and it is EasyLife's
   * PowerPacker buffers, which memmap.test.ts said so immediately.
   *
   * One block, 260 bytes, reserved a page so nothing lands beside it. It is
   * the scan's own buffer -- the extension keeps a single block at $4c6(a5)
   * and every `Dr` accessor reads it -- so a program that Peeks it while a
   * scan is open sees exactly what the accessors do.
   */
  static readonly CRAFT_FIB_BASE = 0x3a000000
  static readonly CRAFT_FIB_RESERVED = 0x1000

  /**
   * CRAFT's turtle workspace -- what `=Tr Base` answers.
   *
   * "Returns the address of the internal turtle variable area", and the
   * manual sends the reader to an appendix of offsets to Peek. The block is
   * the extension's own from $2e of its workspace on, 56 bytes, and it is
   * mapped rather than mirrored so a program that reads it sees the same
   * bytes the keywords do -- see TR in ./craft.ts for what is where.
   */
  static readonly CRAFT_TURTLE_BASE = 0x3a001000
  static readonly CRAFT_TURTLE_RESERVED = 0x1000

  /**
   * Opal 1.1's OpalScreen structures and their bitplanes.
   *
   * `Ovopenscreen24` hands the program the structure's ADDRESS and expects it
   * to be poked through — the extension's own example does `Poke OSCRN+142,0`
   * to narrow the pixel read mask — and `BitPlanes` is twenty-four more
   * addresses inside it. So the whole of an OpalScreen has to sit somewhere a
   * `Peek` can reach. See opal.ts.
   *
   * 0x56000000 because the eight PowerPacker buffers end exactly there and
   * =Mubase is at 0x58000000, which leaves this thirty-two megabytes. A hires
   * overscan 24-bit screen needs about 1.3MB of it.
   */
  static readonly OPAL_BASE = 0x56000000
  static readonly OPAL_RESERVED = 0x02000000

  /**
   * The Game 0.9's scratch area, which `=G Getmem` hands a program the address
   * of.
   *
   * The keyword is `lea $352(a3),a0` and nothing else — the answer is a
   * pointer into the extension's own data block, where 2,148 zero bytes sit
   * between the library-name strings and the end of the block. A program pokes
   * through it, so it has to be at a real address here too. thegame.ts cites
   * the routine and explains the rest.
   *
   * 0x5a000000 because =Mubase sits at 0x58000000 and the Code Bank modules
   * start at 0x5c000000, so this is the gap between them.
   */
  static readonly TGE_SCRATCH_BASE = 0x5a000000
  static readonly TGE_SCRATCH_RESERVED = 0x00010000

  /** the eight Dev Open IORequests, one 256-byte slice each */
  static readonly DEV_IO_BASE = 0x3b000000
  static readonly DEV_IO_RESERVED = DEV_IO_STRIDE * (DEV_MAX + 1)

  /**
   * The interpreter configuration block (PI_*, +Equ.s:1590-1650, defaults
   * from +Interpreter_Config.s). Editable defaults rather than constants:
   * the file selector stores its Sort/Size/Store toggles and its window
   * position back here when it closes (Fs_Close +Lib.s:18469), so they
   * persist from one call to the next within a session.
   */
  pi: PiConfig = newPiConfig()
  /** the Music extension's narrator state (+Music.s); see speech.ts */
  speech!: SpeechState
  /** Serial, Printer and Parallel device state (IOPorts, slot 6) */
  ioports!: IoPortsState
  ctext!: CtextState
  /** JD's own data zone: Get Area's pair, and what Exdatazone hands out */
  jd!: JdState
  sticks!: SticksState
  /** GameSupport 1.2's data block at $1c1a — mouse counters and the rest, slot 23 */
  gamesupport!: GameSupportState
  /** SLN 2.0's data zone (`MB` in sln_extII.s) — slot 24; see sln.ts */
  sln!: SlnState
  /** Make 1.30's forty-byte data zone, its two MinLists and its pool — slot 17 */
  make!: MakeState
  /** Tools 1.01's memory position, its two bank numbers and its text pool — slot 23 */
  tools!: ToolsState
  /** Opal 1.1's OpalVision card, its screens and the pool they live in — slot 21 */
  opal!: OpalState
  /** Delta 1.4's one piece of state: how far Delta Wait Double Mouse has got */
  delta!: DeltaState
  /** LSerial 2.1's one open device, its outstanding Mulsend and its XPR base */
  lserial!: LSerialState
  /** BUtility 1.21's shared requester buffers and its last XPK error, slot 12 */
  butility!: BUtilityState
  /** JD Colour's requester channel and guru alert, slot 20 */
  jdColour!: JdColourState
  /** JD Intuition 1.3's current window and screen, its two lists and its gadgets, slot 18 */
  jdint!: JdIntState
  /** AMon's rodent position, its four limits and the two raw counter bytes, slot 25 (1.03: 16) */
  amon!: AmonState
  /** Explode 2.01's eight Rs structures and the pool they live in, slot 7 */
  explode!: ExplodeState
  /** CRAFT 1.0's open directory scan and the FileInfoBlock it publishes, slot 18 */
  craft!: CraftState
  /** MusiCRAFT 1.0's replayer, its vumeters and its voice mask, slot 19 */
  musicraft!: MusicraftState
  /** the module player appended to APD426's Music.Lib, slot 1 */
  musicOmega!: MusicOmegaState
  /**
   * The eight `Dev Open` channels and the IORequests they hand out.
   *
   * `=Dev Base(n)` gives a program the address of its channel's IORequest so
   * it can Doke io_Length, io_Data and io_Offset in before `Dev Do`, which is
   * the whole point of the family -- so the requests are real mapped memory
   * rather than an object, and land in `memRegions` below.
   */
  dev: DevState = newDevState()
  /**
   * The ARexx public ports a program has opened, and the messages waiting on
   * them. Public so a host can drive an AMOS program from outside: register
   * nothing and `post` to the port the program opened. See amiga/rexx.ts.
   */
  rexx = new RexxPorts()
  /** the core Arexx family's own port and the message it is holding */
  arexx: { port: string | null; held: RexxMessage | null } = { port: null, held: null }
  /**
   * Whether AMOS's file output ends its lines the Amiga way.
   *
   * AMOS writes CR+LF; AmigaDOS text is LF alone. JD Colour's `Jd Setoutput
   * Amiga` SetFunction-patches dos.library's `Write` so a buffer whose
   * second-to-last byte is CR has it replaced by LF and its length dropped by
   * one, and `Jd Setoutput Amos` puts the vector back. The patch is on
   * dos.library rather than on the extension, so it changes every write AMOS
   * makes -- which is why the flag is here and not in JdColourState.
   */
  amigaLineEnds = false
  /** Stars 2.33's interrupt-driven starfield, slot 20 */
  stars!: StarsState
  /** AGA 1.0's 256-colour screens, blocks and shared palette, slot 20 */
  aga!: AgaState
  /** AMCAF's Examine context and last DOS error (slot 8) */
  amcaf!: AmcafState
  /** tick at which a finished Say hands the music voices back, -1 when idle */
  speechRestore = -1
  static readonly COPPER_LONG = 12 * 1024
  /** T_CopON: the system rebuilds and owns the display while true */
  copperOn = true
  /**
   * DMACON's three display bits — BPLEN, COPEN and SPREN — turned off
   * together, and COLOR00 blacked with them.
   *
   * TWO extensions do exactly this and neither knows about the other, which
   * is why the flag is here rather than in either one's state. JD's `Jd Video
   * Off` is `move.w #$01a0,$dff096` and blacks $dff180 (+|jd.s:5145); Misc
   * 1.0's `Display Off` is the same two instructions (Misc_Extension.asm:106).
   * With the copper stopped nothing rebuilds the picture, so the screen stays
   * black until the matching On puts the bits back — and the COLOR00 write
   * needs no undoing, because re-enabling COPEN lets the list restore the
   * palette on its own next frame.
   */
  videoOff = false
  /**
   * SPREN alone. `Mouse Off` (Misc_Extension.asm:141) clears it and there is
   * no keyword anywhere that puts it back — the extension's own manual
   * suggests someone add a `Mouse On`.
   */
  spriteDma = true
  /**
   * CIA-B port B bit 7, /MTR — the floppy motor, and the drive light with it.
   *
   * Here rather than in an extension's state for the same reason `spriteDma`
   * is: TWO extensions drive it and neither knows about the other. Misc 1.0's
   * `Dled On`/`Dled Off` and Delta 1.4's `Delta Drive Motor On`/`Off` are the
   * same four writes instruction for instruction, down to the direction
   * register that makes both pairs the wrong way round — see miscext.ts, which
   * has the author's own source, and delta.ts, which does not.
   *
   * A view of CIA-B port B now (../amiga/cia.ts), because that is what all
   * three extensions are writing: /MTR is bit 7 and the direction register is
   * what decides whether the chip drives it. Six keywords, one line.
   */
  get driveMotor(): boolean {
    return this.machine.ciab.motorLine
  }

  set driveMotor(on: boolean) {
    // the four instructions all six keywords share: assert /MTR with no unit
    // selected, then pull /SEL0 low to latch it into drive 0, then decide with
    // DDRB whether any of it is driven at all
    const b = this.machine.ciab
    b.writePrb(0x7f)
    b.writePrb(0x77)
    b.ddrb = on ? 0xff : 0x00
  }
  /**
   * COP1LC, when something outside the interpreter has pointed it somewhere —
   * Personnal's Active Copper writes $dff080 with the list it built in a
   * program bank. The copper re-reads from there every frame, so the bytes
   * are copied into the physical buffer each composite rather than once,
   * which is what lets a program keep patching its list and see the change.
   */
  copList1Addr: number | null = null
  copBufA = new Uint8Array(Runtime.COPPER_LONG)
  copBufB = new Uint8Array(Runtime.COPPER_LONG)
  copLogIsA = true
  /** T_CopPos: the user write offset into the logical list */
  copPos = 0
  /** T_Cop255: the line-255 crossing wait has been emitted */
  private copCross = false

  get copLogic(): Uint8Array {
    return this.copLogIsA ? this.copBufA : this.copBufB
  }
  get copPhysic(): Uint8Array {
    return this.copLogIsA ? this.copBufB : this.copBufA
  }
  /** =Cop Logic (TCopBs): the mapped address of the logical list */
  copLogicAddr(): number {
    return (Runtime.COPPER_BASE + (this.copLogIsA ? 0 : Runtime.COPPER_SLOT)) >>> 0
  }

  private copCheckOff(): void {
    // CopEr1: every user list write requires Copper Off first
    if (this.copperOn) throw new AmosError('copper not deactivated')
  }

  private copPut(w: number): void {
    // CopFin: the 68k writes first and faults after T_CopLong; we bound
    // each word (protective) with the same error
    if (this.copPos + 2 > Runtime.COPPER_LONG) throw new AmosError('copper list too long')
    const l = this.copLogic
    l[this.copPos] = (w >> 8) & 0xff
    l[this.copPos + 1] = w & 0xff
    this.copPos += 2
  }

  /** Cop Wait x,y[,xmask,ymask] (TCopWt +W.s:6874) */
  copWait(x: number, y: number, mx: number, my: number): void {
    this.copCheckOff()
    if (x >>> 0 >= 313 || y >>> 0 >= 313) throw new AmosError('copper parameter out of range')
    if (y >= 256 && !this.copCross) {
      // the line-255 crossing wait, emitted once ($FFE1,$FFFE)
      this.copPut(0xffe1)
      this.copPut(0xfffe)
      this.copCross = true
    }
    this.copPut(((y << 8) | ((x >> 1) & 0xfe) | 1) & 0xffff)
    this.copPut(((my << 8) | ((mx >> 1) & 0xfe)) & 0xffff)
  }

  /** Cop Move reg,value (TCopMv +W.s:6910) */
  copMove(reg: number, val: number): void {
    this.copCheckOff()
    if (reg >>> 0 >= 512) throw new AmosError('copper parameter out of range')
    this.copPut(reg & 0x1fe)
    this.copPut(val & 0xffff)
  }

  /** Cop Movel reg,value — high word at reg, low at reg+2 (TCopMl) */
  copMoveL(reg: number, val: number): void {
    this.copMove(reg, (val >>> 16) & 0xffff)
    this.copMove(reg + 2, val & 0xffff)
  }

  /** Cop Swap (TCopSw): terminate, swap lists, reset the write pointer */
  copSwapUser(): void {
    this.copCheckOff()
    const l = this.copLogic
    if (this.copPos + 4 <= Runtime.COPPER_LONG) {
      l[this.copPos] = 0xff
      l[this.copPos + 1] = 0xff
      l[this.copPos + 2] = 0xff
      l[this.copPos + 3] = 0xfe
    }
    this.copLogIsA = !this.copLogIsA
    // TCopSw falls into TCopRes
    this.copPos = 0
    this.copCross = false
  }

  /** Cop Reset (TCopRes) */
  copResetUser(): void {
    this.copCheckOff()
    this.copPos = 0
    this.copCross = false
  }

  /** Copper On / Copper Off (TCopOn +W.s:6815) */
  copperOnOff(on: boolean): void {
    if (!on) {
      if (!this.copperOn) return
      this.copperOn = false
      // the OFF path terminates the logical list empty and swaps: the
      // display goes blank, and the last system list lands in the new
      // logical buffer where Cop Logic readers see it. The mouse pointer
      // is hidden too (T_MouShow=-1) and stays hidden until Show.
      this.mouseShow = -1
      this.copPos = 0
      const l = this.copLogic
      l[0] = 0xff
      l[1] = 0xff
      l[2] = 0xff
      l[3] = 0xfe
      this.copLogIsA = !this.copLogIsA
      this.copPos = 0
      this.copCross = false
      this.seedCopperRegs()
    } else {
      if (this.copperOn) return
      this.copperOn = true
      this.buildCopperList() // EcForceCop: recalcule les listes
    }
  }

  /**
   * The custom registers as the user copper list left them.
   *
   * On the hardware a copper MOVE sticks: a register keeps its value until
   * something writes it again, across frames as well as down the display. A
   * list that only pokes COLOR00 therefore keeps showing whatever the
   * bitplane pointers were already aimed at. Rebuilding this from defaults
   * every frame made such a list display nothing at all.
   */
  copRegs = {
    /**
     * COLOR00..COLOR31 as written, but 256 of them: AGA reaches the other
     * 224 by putting a bank number in BPLCON3 bits 13-15 and writing the
     * same 32 registers again. The index is bank * 32 + (reg - $180) / 2.
     */
    pal: new Uint16Array(256),
    /**
     * The LOW nibbles of each component, which AGA writes to the same
     * registers with BPLCON3's LOCT bit ($200) set. Held separately rather
     * than as one 24-bit value because that is how the hardware is written
     * to — two passes over the same registers, which is exactly what Stars'
     * `Cop True Palette` emits (stars.ts).
     *
     * A write with LOCT clear sets BOTH, replicating the high nibble into
     * the low one. That is the AGA compatibility rule, and it is what keeps
     * every ECS screen bit-identical: `hi << 4 | hi` is `hi * 17`, the
     * expansion the renderer used before there was a low nibble at all.
     */
    palLo: new Uint16Array(256),
    dmaOn: false,
    hires: false,
    /**
     * The rest of BPLCON0. Only HIRES used to be read, which was enough for
     * AMOS's own lists — it varies resolution and nothing else. An extension
     * that builds its own list varies all of them: Personnal's Set Lace is
     * literally `Bset/Bclr #2` on this word and Set Resolution `#15`.
     *
     * bpu (bits 12-14) is the plane count. Planes are not composed here —
     * a bitplane pointer resolves to a Screen and the pixel comes from its
     * chunky buffer — so what BPU does is bound the pixel index, the way
     * fetching n planes bounds it on the hardware.
     */
    bpu: 6,
    /** BPLCON0 bit 11, HAM */
    ham: false,
    /** BPLCON0 bit 10, dual playfield */
    dblpf: false,
    /** BPLCON0 bit 2, interlace */
    lace: false,
    /** BPLCON3 — AGA, colour bank select in bits 13-15 */
    bplcon3: 0,
    hstart: 0x81,
    hstop: 0x1c1,
    ddfstrt: 0x38,
    ddfstop: 0xd0,
    mod1: 0,
    mod2: 0,
    bplcon1: 0,
    bplcon2: 0x0024,
    bplH: new Int32Array(8).fill(-1),
    bplL: new Int32Array(8).fill(-1),
    sprH: new Int32Array(8).fill(-1),
    sprL: new Int32Array(8).fill(-1),
    sprSet: false,
    screenIdx: -1,
    usePhy: false,
    /** plane-0 fetch pointer as a byte offset into the resolved screen */
    ptr: 0,
  }

  /**
   * Reset the register file when Copper Off hands the display over.
   *
   * Blank, not "whatever was on screen": AMOS's OFF path swaps in a list
   * that is nothing but an end marker, so the display really does go dark
   * until the program's own list sets bitplane pointers up. What changed is
   * that this now happens ONCE, at the handover, instead of every frame.
   */
  /**
   * Copy a list from anywhere in the address space into the physical buffer,
   * up to its $FFFFFFFE terminator or the buffer's end. This is the copper
   * fetching from COP1LC, which it does afresh every frame.
   */
  loadCopperFrom(addr: number): void {
    const dst = this.copPhysic
    for (let p = 0; p + 4 <= dst.length; p += 4) {
      const m = this.resolveAddr(addr + p)
      if (!m || m.off + 3 >= m.data.length) break
      const a = m.data[m.off]!
      const b = m.data[m.off + 1]!
      const c = m.data[m.off + 2]!
      const d = m.data[m.off + 3]!
      dst[p] = a
      dst[p + 1] = b
      dst[p + 2] = c
      dst[p + 3] = d
      if (a === 0xff && b === 0xff && c === 0xff && d === 0xfe) break
    }
  }

  private seedCopperRegs(): void {
    const r = this.copRegs
    r.pal.fill(0)
    r.palLo.fill(0)
    r.pal[0] = this.colourBack & 0xfff
    r.palLo[0] = r.pal[0]
    r.dmaOn = false
    r.hires = false
    // 6 planes, the most an OCS/ECS list can fetch: the handover blanks the
    // display by clearing the pointers, not by asking for no planes, so BPU
    // only bounds a colour index once a list points somewhere real
    r.bpu = 6
    r.ham = false
    r.dblpf = false
    r.lace = false
    r.bplcon3 = 0
    r.hstart = 0x81
    r.hstop = 0x1c1
    r.ddfstrt = 0x38
    r.ddfstop = 0xd0
    r.mod1 = 0
    r.mod2 = 0
    r.bplcon1 = 0
    r.bplcon2 = 0x0024
    r.bplH.fill(-1)
    r.bplL.fill(-1)
    r.sprH.fill(-1)
    r.sprL.fill(-1)
    r.sprSet = false
    r.screenIdx = -1
    r.usePhy = false
    r.ptr = 0
  }

  /** resolve an address for reading (Peek): planar mirrors refresh from chunky */
  resolveAddr(addr: number): { data: Uint8Array; off: number } | null {
    return this.resolveInto(addr, false)
  }

  /** resolve for writing (Poke): a screen plane write marks the chunky side stale */
  resolveWrite(addr: number): { data: Uint8Array; off: number } | null {
    return this.resolveInto(addr, true)
  }

  /**
   * A longword array at an AMOS address — the shape every extension taking
   * `Varptr(A(0))` wants, and the one way to write one that is correct.
   *
   * USE THIS RATHER THAN A DataView. `new DataView(m.data.buffer, …)` over a
   * `resolveWrite` result reads fine and writes into nothing: an address in
   * the Varptr arena resolves to a Proxy whose job is to push writes back
   * into the AMOS variable, and reaching `.buffer` steps around it. The byte
   * loop below goes through the indexed trap, so it works for the arena, for
   * banks and for every mapped region alike. See the arena's own comment.
   *
   * `length` is how many whole longwords are left in the region from `addr`,
   * so a caller can bound itself the way the 68k could not.
   */
  longsAt(addr: number, write = true): { get: (i: number) => number; getU: (i: number) => number; set: (i: number, v: number) => void; length: number } | null {
    const m = write ? this.resolveWrite(addr >>> 0) : this.resolveAddr(addr >>> 0)
    if (!m) return null
    const { data, off } = m
    const getU = (i: number): number => {
      const a = off + i * 4
      return (((data[a]! << 24) | (data[a + 1]! << 16) | (data[a + 2]! << 8) | data[a + 3]!) >>> 0)
    }
    return {
      getU,
      get: (i) => getU(i) | 0,
      set: (i, v) => {
        const a = off + i * 4
        data[a] = (v >>> 24) & 0xff
        data[a + 1] = (v >>> 16) & 0xff
        data[a + 2] = (v >>> 8) & 0xff
        data[a + 3] = v & 0xff
      },
      length: (data.length - off) >> 2,
    }
  }

  /**
   * The address space, ordered by base. Every region a program can reach by
   * address is here; `memRegions` is the only description of the map, and
   * memmap.test.ts holds it to claiming no address twice.
   *
   * Memory banks are deliberately NOT regions: bankBase(n) is
   * 0x01000000 + n*0x100000, so a bank number high enough walks into the
   * regions above (bank 1008 lands exactly on SCREEN_CHIP_BASE). The regions
   * win, as they did when this was an if-chain with the bank scan last, and
   * the overlap check cannot see a base that depends on a bank number.
   */
  private readonly memRegions: readonly MemRegion[] = [
    /*
     * CIA-B port A and port B, and port B's direction register.
     *
     * PRA is the parallel port's three status lines and the serial port's
     * three inputs; Range's `=Busy Printer` and `=No Paper` and Ercole's
     * `Ext Fire` read it. PRB is the four floppy control lines, which six
     * keywords across three extensions write and nothing reads. DDRB is why
     * all six have their pairs named backwards.
     */
    byteRegister(
      'CIA-B port A',
      CIAB_PRA,
      () => this.machine.ciab.pra(),
      (v) => this.machine.ciab.writePra(v),
    ),
    byteRegister(
      'CIA-B port B',
      CIAB_PRB,
      () => this.machine.ciab.prb(),
      (v) => this.machine.ciab.writePrb(v),
    ),
    byteRegister(
      'CIA-B port B direction',
      CIAB_DDRB,
      () => this.machine.ciab.ddrb,
      (v) => {
        this.machine.ciab.ddrb = v & 0xff
      },
    ),
    /*
     * CIA-A port A, the byte ../amiga/cia.ts composes. Bit 6 is FIR0, the
     * LEFT mouse button, ACTIVE LOW, so a pressed button reads as a zero bit.
     *
     * Here because CRAFT's `=Hw Mouse Key` (routine 190, $313a) reads it with
     * `btst.b #$6,$bfe001.l` rather than asking the operating system, which
     * is the whole point of the keyword: "it works whether the AMOS screen is
     * displayed or not". A program can reach the same register with Peek, and
     * gets the same answer the keyword does.
     *
     * It answered `$ff` or `$bf` until the chip was modelled, and both of
     * those have bit 1 set, so a program that peeked the byte was told the
     * audio filter was off however many times `Led On` had run. Writes went
     * nowhere at all.
     */
    byteRegister(
      'CIA-A port A',
      CIAA_PRA,
      () => this.machine.cia.pra(),
      (v) => this.machine.cia.writePra(v),
    ),
    /*
     * CIA-A's serial data register, where the keyboard's byte lands.
     *
     * Three extensions read this address in the original and none of them
     * could reach it here, because the port modelled the byte (keyboardSdr,
     * ../amiga/keyboard.ts) and then never put it anywhere addressable.
     * `Poke` to it is honoured for the same reason `Change Led` is: the chip
     * takes a write to SDR, and what it does with one is shift it out to the
     * keyboard, which this machine has no wire for.
     */
    /*
     * CIA-A port B, the parallel port's eight data lines. Six of Sticks'
     * keywords and Ercole's `Ext Joy` read it as a four-player joystick
     * adaptor, one stick per nibble, `not.b`'d because a switch pulls a
     * pulled-up line down. Nothing is on the cable, so it reads $ff.
     */
    readOnlyRegister('CIA-A port B', CIAA_PRB, 1, () => this.machine.cia.prb()),
    byteRegister(
      'CIA-A serial data',
      CIAA_SDR,
      () => this.machine.cia.sdr,
      (v) => {
        this.machine.cia.sdr = v
      },
    ),
    {
      // VPOSR/VHPOSR beam counters, synthesized per read from the pseudo-beam
      name: 'beam counters',
      base: 0xdff004,
      reserved: 4,
      live: () => 4,
      resolve: (off) => {
        const line = this.interp.beamLine()
        const vh = this.interp.beamWord()
        // VPOSR: V8 in bit 0 of the low byte; VHPOSR: V7-0 / H8-1
        return { data: Uint8Array.of(0, (line >> 8) & 1, (vh >> 8) & 0xff, vh & 0xff), off }
      },
    },
    /*
     * POTGOR, the pot-port input register, and the other half of `=Hw Mouse
     * Key`. Composed by ../amiga/gameport.ts, which owns the bit positions
     * and now answers for BOTH ports: the version here read port 0 only,
     * because a mouse was the only thing anything asked it about.
     */
    /*
     * The two quadrature counters. ../amiga/gameport.ts has modelled them
     * since GameSupport needed them and nothing could reach them by address,
     * so `Deek($DFF00C)` fell through to the bank scan. Read-only: a write
     * goes to POTGO at $DFF034, which nothing here has a use for.
     */
    readOnlyRegister('JOY0DAT', JOY0DAT, 2, () => this.machine.joyDat(0)),
    readOnlyRegister('JOY1DAT', JOY1DAT, 2, () => this.machine.joyDat(1)),
    readOnlyRegister('POTGOR', POTGOR, 2, () => this.machine.potgor()),
    bufferRegion('Explode heap', Runtime.EXPLODE_HEAP_BASE, Runtime.EXPLODE_HEAP_RESERVED, () =>
      this.explode ? this.explode.pool.buffer : null,
    ),
    bufferRegion('CRAFT FileInfoBlock', Runtime.CRAFT_FIB_BASE, Runtime.CRAFT_FIB_RESERVED, () =>
      this.craft ? this.craft.fib : null,
    ),
    bufferRegion('CRAFT turtle', Runtime.CRAFT_TURTLE_BASE, Runtime.CRAFT_TURTLE_RESERVED, () =>
      this.craft ? new Uint8Array(this.craft.turtle.buffer) : null,
    ),
    bufferRegion('Dev IORequests', Runtime.DEV_IO_BASE, Runtime.DEV_IO_RESERVED, () => this.dev.io),
    bufferRegion('Tools text', Runtime.TOOLS_TEXT_BASE, Runtime.TOOLS_TEXT_RESERVED, () =>
      this.tools ? this.tools.text.buffer : null,
    ),
    slottedRegion(
      'screen bitplanes',
      Runtime.SCREEN_CHIP_BASE,
      Runtime.SCREEN_CHIP_SLOT,
      Runtime.SCREEN_SLOTS,
      (index, off, write) => {
        const s = this.screens.get(index)
        if (!s) return null
        const phy = off >= Runtime.SCREEN_PHY_OFFSET
        return within(
          s.planarView(phy ? 'phy' : 'log', write),
          phy ? off - Runtime.SCREEN_PHY_OFFSET : off,
        )
      },
    ),
    bufferRegion('SLN heap', Runtime.SLN_HEAP_BASE, Runtime.SLN_HEAP_RESERVED, () =>
      this.sln ? this.sln.heap.buffer : null,
    ),
    slottedRegion(
      'screen control blocks',
      Runtime.SCREEN_CTRL_BASE,
      Runtime.SCREEN_CTRL_SLOT,
      Runtime.SCREEN_SLOTS,
      (index, off) => {
        const s = this.screens.get(index)
        // synthesized read-only block; writes land in a throwaway copy
        return s ? within(this.screenCtrlBlock(s), off) : null
      },
    ),
    bufferRegion('Make heap', Runtime.MAKE_HEAP_BASE, Runtime.MAKE_HEAP_RESERVED, () =>
      this.make ? this.make.pool.buffer : null,
    ),
    slottedRegion('copper lists', Runtime.COPPER_BASE, Runtime.COPPER_SLOT, 2, (index, off) =>
      within(index === 0 ? this.copBufA : this.copBufB, off),
    ),
    slottedRegion(
      'EasyLife PowerPacker buffers',
      Runtime.PP_BUFFER_BASE,
      Runtime.PP_BUFFER_SLOT,
      8,
      (index, off) => {
        const b = this.ppBuffers[index]
        return b ? within(b, off) : null
      },
    ),
    bufferRegion('OpalVision screens', Runtime.OPAL_BASE, Runtime.OPAL_RESERVED, () =>
      this.opal ? this.opal.ov.pool.buffer : null,
    ),
    // =Mubase points at the music extension data zone; the vumeter bytes at
    // MB+0..3 are the mapped part (FnMusicBase +Music.s:3907)
    bufferRegion('Mubase', Runtime.MUBASE_ADDR, 4, () => this.vuBytes),
    bufferRegion('The Game scratch', Runtime.TGE_SCRATCH_BASE, Runtime.TGE_SCRATCH_RESERVED, () =>
      this.thegame ? this.thegame.scratch : null,
    ),
    slottedRegion(
      'GameSupport code modules',
      Runtime.CODEMOD_BASE,
      Runtime.CODEMOD_SLOT,
      Runtime.CODEMOD_SLOTS,
      (index, off) => {
        const m = this.gamesupport?.codemods[index]
        return m ? within(m.image, off) : null
      },
    ),

    {
      name: 'variable arena',
      base: Runtime.VAR_BASE,
      reserved: Runtime.SPRITE_BANK_BASE - Runtime.VAR_BASE,
      live: () => this.varArenaNext - Runtime.VAR_BASE,
      resolve: (off) => this.resolveVarSlot(Runtime.VAR_BASE + off),
    },
    claimedRegion('sprite bank image', Runtime.SPRITE_BANK_BASE, 0x04000000, () =>
      this.objectBankImage('sprites'),
    ),
    claimedRegion('icon bank image', Runtime.ICON_BANK_BASE, 0x04000000, () =>
      this.objectBankImage('icons'),
    ),
    bufferRegion('temp buffer', Runtime.TEMP_BUFFER_BASE, 0x04000000, () => this.tempBuffer),
    bufferRegion('Personnal memory', Runtime.PERSONNAL_BASE, 0x04000000, () => this.personnalMem),
    bufferRegion(
      'Personnal icon bank',
      Runtime.PERSONNAL_ICON_BASE,
      0x04000000,
      () => this.personnalIcons,
    ),
    slottedRegion(
      'extension data blocks',
      Runtime.EXT_DATA_BASE,
      Runtime.EXT_DATA_SLOT,
      256,
      (index, off) => {
        const block = this.extBlocks[index]
        return block ? within(block, off) : null
      },
    ),
    bufferRegion('MED module', Runtime.MED_MODULE_BASE, 0x04000000, () => this.medModule),
  ]

  private resolveInto(addr: number, write: boolean): { data: Uint8Array; off: number } | null {
    const a = addr >>> 0
    const region = findRegion(this.memRegions, a)
    if (region) return region.resolve(a - region.base, write)
    for (const [n, bank] of this.memBanks) {
      const base = this.bankBase(n) >>> 0
      if (a >= base && a < base + bank.data.length) return { data: bank.data, off: a - base }
    }
    // the object banks are in the same address space, because they are in the
    // same bank list — `Start(1)` has to point at something
    if (!write) {
      for (const n of [BOB_BANK, ICON_BANK]) {
        const base = this.bankBase(n) >>> 0
        if (a < base) continue
        const bytes = this.bankPayload(n)
        if (bytes && a < base + bytes.length) return { data: bytes, off: a - base }
      }
    }
    return null
  }

  /**
   * The bytes a Bob or Icon bank has at `Start(n)`, built on demand.
   *
   * The payload is what the AmSp/AmIc file carries after its four-byte magic:
   * an image count word, then the image records, then the 32-colour palette.
   * The count coming first is not a guess — FnLength reads exactly that word
   * (`move.w (a1),d3`, +Lib.s:2503) to answer `=Length()` for these banks.
   *
   * DEVIATION: this is READ-ONLY. On the machine a program may Poke into its
   * sprite bank and the next Bob draw shows the change; here the bytes are
   * generated from the parsed images and nothing reads them back, so a write
   * would be silently lost. `resolveInto` refuses writes to this range rather
   * than accept one it cannot honour, which surfaces as an Address error.
   */
  bankPayload(n: number): Uint8Array | null {
    const bank = n === BOB_BANK ? this.spriteBank : n === ICON_BANK ? this.iconBank : null
    if (!bank) return null
    // no cache: the images change under Get/Del/Ins Sprite and a stale buffer
    // would be worse than rebuilding one that almost nothing asks for
    return serializeObjectBank(n === BOB_BANK ? 'AmSp' : 'AmIc', bank).subarray(4)
  }

  /**
   * One entry of the bank list, whichever list it used to be in.
   *
   * This is `L_Bnk.GetAdr` (+Lib.s), which walks a single chain and finds a
   * Reserve'd block, the Bob bank or the Icon bank without caring which. See
   * ./banks.ts for why that mattered and what the flags words are.
   */
  bankRef(n: number): BankRef | null {
    const mem = this.memBanks.get(n)
    if (mem) {
      return { number: n, flags: mem.flags | (mem.memType === 1 ? BNK.CHIP : 0), name: mem.name, length: mem.data.length, address: this.bankBase(n) }
    }
    if (n === BOB_BANK && this.spriteBank) {
      // FnLength returns the IMAGE COUNT for an object bank, not the bytes
      return { number: n, flags: BOB_BANK_FLAGS, name: 'Sprites', length: this.spriteBank.images.length, address: this.bankBase(n) }
    }
    if (n === ICON_BANK && this.iconBank) {
      return { number: n, flags: ICON_BANK_FLAGS, name: 'Icons', length: this.iconBank.images.length, address: this.bankBase(n) }
    }
    return null
  }

  /** every bank there is, in ascending number — Bnk.List's order */
  bankRefs(): BankRef[] {
    const out: BankRef[] = []
    for (const n of this.memBanks.keys()) {
      const r = this.bankRef(n)
      if (r) out.push(r)
    }
    for (const n of [BOB_BANK, ICON_BANK]) {
      if (this.memBanks.has(n)) continue
      const r = this.bankRef(n)
      if (r) out.push(r)
    }
    return out.sort((a, b) => a.number - b.number)
  }

  /** erase one bank, whichever list it is in (InErase +Lib.s:2210) */
  eraseBank(n: number): void {
    if (n === BOB_BANK && this.spriteBank) this.spriteBank = null
    else if (n === ICON_BANK && this.iconBank) this.iconBank = null
    this.memBanks.delete(n)
  }

  reserveBank(n: number, length: number, name: string, dataBank = true, chip = false): void {
    // RsBqX (+Lib.s): length <= 0 or bank outside 1..65535 = function call
    // error; flags bit 0 = Bnk_BitData (+Equ.s:1865): Data banks survive
    // Erase Temp, Work banks (bit clear) do not
    if (length <= 0 || n <= 0 || n >= 0x10000) throw new AmosError('Illegal function call', 23)
    // The name field is EIGHT bytes and Bnk.Reserve copies exactly eight
    // (`moveq #7,d0` +Lib.s:8501), but a bank's name is held here the way
    // the loader holds one, trailing spaces off in parseMemoryBank, so
    // that a reserved bank and a loaded one compare the same way. The
    // padding is the FILE format's, and belongs to whatever writes a file.
    //
    // Trimmed HERE rather than at each caller, because the callers pass
    // whatever their own binary's literal says. AMCAF's Dload really does
    // hold 'Datas   ' and EasyLife's Elxpk Load really does copy eight bytes
    // out of an XPK header; both are evidence about those libraries and both
    // should keep saying so at the call site. A program cannot see the
    // difference: `Bank Name$` pads back to eight on the way out, which is
    // routine 60's own behaviour.
    const held = name.replace(/\s+$/, '')
    this.memBanks.set(n, { kind: 'memory', number: n, memType: chip ? 1 : 0, name: held, flags: dataBank ? 1 : 0, data: new Uint8Array(length) })
  }
  // ---- resource banks (Interface language) ----
  /** Resource Bank n (0 = system default, InResourceBank +Lib.s:14933) */
  resourceBankNumber = 0
  /** the system default resource (AMOSPro_Default_Resource.Abk, Sys_Resource) */
  systemResource: ResourceBank | null = null
  private userResourceCache: { num: number; data: Uint8Array; res: ResourceBank } | null = null

  /** install the system default resource from a bare .Abk file or bank payload */
  loadSystemResource(bytes: Uint8Array): void {
    const file = parseAmosFile(bytes)
    const bank = file.banks.find((b) => b.kind === 'memory' && isResourceBankName(b.name))
    this.systemResource = parseResourceBank(bank && bank.kind === 'memory' ? bank.data : bytes)
  }

  // ---- the machine mouse bank: pointer shapes + system fill patterns ----

  /** T_MouBank (+AMOSPro_Mouse.abk, an AmSp bank baked into the real
   * interpreter binary at +W.s:16795): images 1-3 = arrow/crosshair/clock
   * pointer shapes, images 5+ = the Set Pattern/Set Slider system patterns
   * (SPat +W.s:4730 skips the first 4). Baked in here too, so the shapes
   * and patterns are the machine's whether or not a bank file is around —
   * loadMouseBank still overrides it, as a customised one would. */
  mouseObjects: ObjectBank | null = null
  /** T_MouSpr/T_MouDes: the current pointer shape (1-based) */
  mouseShapeNo = 1
  mouseShape: BankImage | null = null
  /** T_MouShow: visible while >= 0; Hide decrements / Show increments,
   * Hide On forces -1 / Show On forces 0 (MHide/MShow/HiSho +W.s:10722) */
  mouseShow = 0

  /**
   * Scanlines the hardware-sprite multiplexer's column buffer holds
   * (T_HsNLine). 128 from the interpreter config (+Interpreter_Config.s:61,
   * read by HsInit +W.s:9421); Set Sprite Buffer n stores n+2 because
   * HsSBuf adds two before reserving (+W.s:11268). Column capacity is this
   * less 2 words — see spriteChannels.
   */
  spriteBufferLines = 128

  /** boot-load the mouse bank (LdMouse +B.s:2081, init +W.s:9290) */
  loadMouseBank(bytes: Uint8Array): void {
    const file = parseAmosFile(bytes)
    const bank = file.banks.find((b): b is SpriteBank => b.kind === 'sprites')
    // the init insists on at least 4 images (cmp.w #4 / TheEnd_Cantread)
    if (!bank || bank.sprites.length < 4) throw new Error('not a mouse bank')
    this.mouseObjects = ObjectBank.fromSpriteBank(bank)
    // the bank's colours 16-31 become the default palette's sprite half
    // (+W.s:9316 .PCopy) — the white/orange/grey boot pointer
    for (let i = 16; i < 32; i++) this.defaultPalette[i] = bank.palette[i]! & 0xfff
    // on the real machine this happens before any screen opens; the web
    // runner loads asynchronously, so patch screens whose sprite half is
    // still the untouched zero default
    for (const s of this.screens.values()) {
      if (s.palette.slice(16, 32).every((c) => (c & 0xfff) === 0)) {
        for (let i = 16; i < 32; i++) s.palette[i] = this.defaultPalette[i]!
      }
    }
    this.changeMouse(this.mouseShapeNo)
  }

  /**
   * Change Mouse n — MChange (+W.s:10669): 1-3 pick from the mouse bank;
   * n >= 4 takes sprite-bank image n-3, which must be exactly one word
   * wide and two planes (a hardware sprite); anything invalid silently
   * falls back to shape 1 (MChE).
   */
  changeMouse(n: number): void {
    let d1 = n - 1
    for (;;) {
      if (d1 < 3) {
        this.mouseShapeNo = d1 + 1
        this.mouseShape = this.mouseObjects?.image(d1 + 1) ?? null
        return
      }
      const img = this.spriteBank?.image(d1 - 3 + 1)
      if (!img || img.width !== 16 || img.depth !== 2) {
        d1 = 0 // MChE: "met la souris 1"
        continue
      }
      this.mouseShapeNo = d1 + 1
      this.mouseShape = img
      return
    }
  }

  /** Set Pattern n>0: mouse-bank pattern n (bank image 4+n 1-based,
   * SPat +W.s:4730); rows of 16 bits. Without the bank, the classic
   * dither approximations (builtinPattern) stand in. */
  systemPattern(n: number): Uint16Array | null {
    const img = this.mouseObjects?.image(n + 4)
    if (!img) return builtinPattern(n)
    const rows = Math.min(16, img.height)
    const bits = new Uint16Array(rows)
    for (let y = 0; y < rows; y++) {
      let row = 0
      for (let x = 0; x < Math.min(16, img.width); x++) {
        if (img.pixels[y * img.width + x] !== 0) row |= 1 << (15 - x)
      }
      bits[y] = row
    }
    return bits
  }

  /**
   * The merged resource view (Dia_GetPuzzle +Lib.s:14943): start from the
   * system default bank, then override each section the user bank
   * (Resource Bank n) actually provides.
   */
  resource(): ResourceBank {
    let user: ResourceBank | null = null
    if (this.resourceBankNumber !== 0) {
      const bank = this.memBanks.get(this.resourceBankNumber)
      if (!bank || !isResourceBankName(bank.name)) throw new AmosError('resource bank not present')
      if (this.userResourceCache?.num === this.resourceBankNumber && this.userResourceCache.data === bank.data) {
        user = this.userResourceCache.res
      } else {
        user = parseResourceBank(bank.data)
        this.userResourceCache = { num: this.resourceBankNumber, data: bank.data, res: user }
      }
    }
    const sys = this.systemResource
    if (!user && !sys) throw new AmosError('resource bank not present')
    return {
      graphics: user?.graphics ?? sys?.graphics ?? null,
      messages: user?.messages ?? sys?.messages ?? null,
      programs: user?.programs ?? sys?.programs ?? null,
    }
  }
  // ---- dialogs (Interface language) ----
  dialogs = new Map<number, DialogChannel>()
  /** last dialog error position (=Edialog, IDia_Error) */
  dialogErrPos = 0
  /** a pending =Dialog Box quick channel (Dia_RunQuick) */
  dialogBoxChan: number | null = null


  // ---- Fsel$ (Dsk.FileSelector / Start_FSel +Lib.s:17756) ----
  /**
   * EcFsel (+Equ.s:792): the system screen slot the file selector and the
   * text reader both open on, above the user range 0-7 (8 EcFonc, 9 EcEdit,
   * 10 EcFsel, 11 EcReq).
   *
   * This IS the answer to "where does a non-AMOS screen go" — AMOS gave it
   * before the question was asked. A screen above the user range is an
   * ordinary Screen in every respect: it sits in `screens`, takes its place
   * in `order`, gets a band in the copper list and a slot in the chip
   * address space. What makes it a system screen is only that no keyword can
   * name it, because `Screen Open` rejects anything outside 0-7.
   *
   * That is the rule the whole slot table is partitioned by; see
   * `SCREEN_SLOTS` for the four owners and for why the table is as wide as it
   * is.
   */
  static readonly EC_FSEL = 10

  // ---- intuition.library's side of the display ----
  /**
   * The machine's Intuition, over a host that opens screens at slots no
   * keyword can name. Lazy because most programs never reach it: the
   * Workbench screen costs 640*256*2/8 = 40KB of bitmap the moment it exists.
   *
   * Deliberately NOT `openScreen`: that one rejects an index above 7, and it
   * also sets `currentIndex`, which would silently redirect every subsequent
   * AMOS drawing keyword onto the Workbench screen. An Intuition screen
   * appearing must not change which screen AMOS is drawing on.
   */
  private intuitionBase: Intuition | null = null

  get intuition(): Intuition {
    if (!this.intuitionBase) {
      this.intuitionBase = new Intuition({
        openScreen: (slot, spec) => {
          if (this.screens.has(slot)) return
          const s = new Screen(
            slot,
            spec.width,
            spec.height,
            1 << spec.depth,
            (spec.hires ? 0x8000 : 0) | (spec.laced ? 4 : 0),
          )
          for (let i = 0; i < spec.palette.length && i < 32; i++) s.palette[i] = spec.palette[i]!
          s.displayY = spec.displayY
          // NOT cls(): that is AMOS's Cls, which clears to the RastPort's
          // PAPER pen, and a fresh Screen's paper is 1 — a Workbench opened
          // that way came up solid white instead of the blue desktop.
          // OpenScreen BltClears the bitmap to pen 0, which is what a freshly
          // allocated one already is.
          s.bobBracket = this.bobBracket
          this.screens.set(slot, s)
          this.order = this.order.filter((i) => i !== slot)
          // BEHIND everything: a Workbench screen that has just been opened
          // is not brought to front by OpenWorkBench. WBenchToFront is a
          // separate call, and EasyLife's Eliconify Begin makes both — which
          // is only meaningful if the first one does not already do it.
          this.order.unshift(slot)
        },
        closeScreen: (slot) => {
          if (!this.screens.has(slot)) return false
          this.closeScreen(slot)
          return true
        },
        screenToFront: (slot) => this.toFront(slot),
        screenToBack: (slot) => this.toBack(slot),
        isOpen: (slot) => this.screens.has(slot),
        screenAddr: (slot) => this.screenCtrlAddr(slot),
        screenSize: (slot) => {
          const s = this.screens.get(slot)
          return s ? { width: s.width, height: s.height, hires: s.hires } : null
        },
        screenRast: (slot) => this.screens.get(slot)?.rp ?? null,
        systemFont: () => intuitionFont(),
      })
    }
    return this.intuitionBase
  }

  /**
   * The machine's ONE BOOPSI object space.
   *
   * intuition.library owns it — `imageclass` and `gadgetclass` are BOOPSI and
   * shipped in Kickstart 2.0 — so muimaster gets a reference rather than a
   * space of its own, exactly as on the machine, where a MUI object and a
   * boopsi gadget are told apart by their class and nothing else.
   */
  private boopsiBase: Boopsi | null = null

  get boopsi(): Boopsi {
    this.boopsiBase ??= new Boopsi()
    return this.boopsiBase
  }

  /**
   * `muimaster.library`, built on that object space.
   *
   * Lazy for the same reason Intuition is: constructing it registers 64
   * classes, and the overwhelming majority of AMOS programs never name one.
   */
  private muiBase: MuiMaster | null = null

  get mui(): MuiMaster {
    this.muiBase ??= new MuiMaster(this.boopsi)
    return this.muiBase
  }

  /**
   * Drive Intuition for one frame: the pointer on the Workbench screen, then
   * whatever moved.
   *
   * Only when there is something to drive — no window means no Intuition to
   * interact with, and the render() below would repaint a Workbench screen
   * that nothing has touched. AMOS's own mouse coordinates and button mask
   * are what feed it, because there is one pointer and AMOS already owns it.
   */
  private stepIntuition(): void {
    const int = this.intuitionBase
    if (!int || int.windows.length === 0) return
    const s = this.screens.get(WB_SLOT)
    if (!s) return
    const m = this.mouseOnScreen(s)
    int.handleInput(WB_SLOT, m.x, m.y, this.input.mouseK)
    int.render(WB_SLOT)
  }

  /**
   * The file selector is itself an Interface dialog: the layout comes from
   * program 2 of the system default resource bank; this controller is the
   * native driver that fills the list, reacts to the zone returns and
   * assembles the result. Zone scheme (from the bank script): 1 OK,
   * 2 Cancel, 3 Parent, 4 Devices, 5 Assigns, 6 Get Dir, 7 Sort, 8 Sizes,
   * 13 the file list, 14 the Path edit (var 15), 15 the Name edit (var 14).
   */
  fsel: FselState | null = null

  /**
   * Fs_Liste (+Equ.s:1210): the store, a global at a5 and so shared by every
   * Fsel$ in the session rather than owned by one call. Fs_Flush clears it.
   */
  fselStore: FselStoreEntry[] = []

  /** begin Fsel$: open the selector screen + dialog; false = could not */
  startFsel(pathArg: string, defName: string, t1: string, t2: string): boolean {
    const res = this.systemResource
    const prog = res?.programs?.[1]
    if (!prog || !this.vfs) return false
    // a trailing pattern component filters the files (Fsel$("df0:*.iff"))
    let path = pathArg
    let pattern = ''
    const m = /^(.*?)([^:/]*[#?*][^:/]*)$/.exec(pathArg)
    if (m) {
      path = m[1]!
      pattern = m[2]!
    }
    if (path === '') path = this.vfs.currentDir
    // Fs_OldEc (+Lib.s:17800): -1 when no screen is current, and the
    // reactivation at the end is skipped for it (`bmi .PaClo`, 18492)
    const prevScreen = this.screens.has(this.currentIndex) ? this.currentIndex : -1
    // Fs_ScOpen (+Lib.s:18910): a system screen outside the user range 0-7,
    // sized from the config. The 68k retries at 320x128 and drops to the
    // cut-down Fs_LowMemory selector if even that fails; neither the 32K
    // AvailMem cliff nor the retry is reachable here (NOTES).
    const s = new Screen(Runtime.EC_FSEL, this.pi.FsDSx, this.pi.FsDSy, res!.graphics?.nColors ?? 8, 0x8000)
    s.bobBracket = this.bobBracket
    this.screens.set(Runtime.EC_FSEL, s)
    this.order = this.order.filter((i) => i !== Runtime.EC_FSEL)
    this.order.push(Runtime.EC_FSEL)
    this.currentIndex = Runtime.EC_FSEL
    // where the user last dragged it to — Fs_Close stores it back (18482)
    s.displayX = this.pi.FsDWx
    s.displayY = this.pi.FsDWy
    s.cls(0)
    if (res!.graphics) for (let i = 0; i < 32; i++) s.palette[i] = res!.graphics.palette[i]!
    let chan = 65536
    while (this.dialogs.has(chan)) chan++
    const d = new DialogChannel(chan, 32, res!)
    d.script = prog
    d.screenNb = Runtime.EC_FSEL
    try {
      const scan = prescanDialog(prog)
      d.labels = scan.labels
      d.userInstrs = scan.userInstrs
    } catch {
      this.closeScreen(Runtime.EC_FSEL)
      if (prevScreen >= 0) this.setCurrent(prevScreen)
      return false
    }
    const arr: AmosArray = { type: 2, dims: [0], data: [] }
    const handle = 0x20000 + this.dialogArrays.size
    this.dialogArrays.set(handle, arr)
    // Fs_GetInputs (+Lib.s:18923) only assigns a title when the string is
    // non-empty (`tst.b 1(a0)` on the length word), so Fsel$ with a blank
    // title line leaves whatever the dialog program drew for itself
    if (t1 !== '') d.vars[0] = t1 // FsV_Titre0
    if (t2 !== '') d.vars[1] = t2 // FsV_Titre1
    // the three toggles start from the config and are written back to it on
    // close (17863-17865 / Fs_Close 18469), so they persist between calls
    d.vars[7] = this.pi.FsSort
    d.vars[8] = this.pi.FsSize
    d.vars[16] = this.pi.FsStore
    d.vars[10] = 0 // FsV_PList
    d.vars[25] = -1 // FsV_PosFirst, set by Fs_First (18737)
    d.vars[11] = handle // FsV_Array — the magic array (17869)
    d.vars[14] = defName
    d.vars[15] = path
    // Dia_Flags bit 4 (17858): Return still reports the edit zone but does
    // not step on to the next one (+Lib.s:24203)
    d.noEditAdvance = true
    this.dialogs.set(chan, d)
    this.fsel = {
      done: false,
      result: '',
      chan,
      screenNb: Runtime.EC_FSEL,
      prevScreen,
      path,
      filter: pattern,
      devFlag: 0,
      dirOn: false,
      sorted: this.pi.FsSort !== 0,
      click: -1,
      entries: [],
      pending: [],
      slide: null,
      closing: null,
      arr,
    }
    try {
      this.runDialog(chan, -1, null, null)
    } catch {
      this.finishFsel('')
      return true // surfaced as a cancel
    }
    // the draw pass is what sets FsV_Tx/Ty — Start_FSel only ever reads them,
    // because the list geometry belongs to the dialog script (19159)
    fselFirst(this, this.fsel!)
    fselAppear(this, this.fsel!) // Fs_Appear (17893), after the draw pass
    return true
  }

  /** re-read the directory (or device list) into the list zone */
  /**
   * Fs_Loop (+Lib.s:17920): one pass. With a directory read running it takes
   * the next name (Fs_Next); otherwise it waits. Either way a zone report
   * from the dialog is dispatched through Fs_Jumps.
   */
  private stepFsel(): void {
    const f = this.fsel
    if (!f || f.done) return
    // the closing slide outlives the dialog being drawn, so it runs before
    // any of the checks that would otherwise end the selector
    if (f.slide) {
      if (fselSlideStep(this, f.screenNb, f.slide)) {
        f.slide = null
        if (f.closing !== null) this.finishFselNow(f.closing)
      }
      return
    }
    const d = this.dialogs.get(f.chan)
    if (!d || !d.drawn) {
      this.finishFsel('')
      return
    }
    if (f.dirOn) fselNext(this, f)
    const ret = d.ret
    if (ret === 0) return
    d.ret = 0
    fselJump(this, f, d, ret)
  }

  /** close the selector: dialog, screen, restore, store the result */
  /**
   * Fs_Close (+Lib.s:18447): put the state back where it came from, then let
   * the screen slide shut before it is destroyed. The teardown itself is
   * finishFselNow, which the slide calls when it finishes.
   */
  finishFsel(result: string): void {
    const f = this.fsel
    if (!f || f.done || f.closing !== null) return
    const d = this.dialogs.get(f.chan)
    if (d) {
      // Fs_Close (+Lib.s:18461): the last directory goes into the store, and
      // the three toggles go back into the interpreter config, which is what
      // makes them stick from one Fsel$ to the next
      fselStore(this, f, d)
      this.pi.FsSort = Number(d.vars[FSV.sort]) ? 1 : 0
      this.pi.FsSize = Number(d.vars[FSV.size]) ? 1 : 0
      this.pi.FsStore = Number(d.vars[FSV.store]) ? 1 : 0
      eraseDialog(d, this.dialogDraw)
      this.dialogs.delete(f.chan)
    }
    // and where the user dragged the window to (18482) — read before
    // Fs_DisAppear starts moving the top edge
    const sc = this.screens.get(f.screenNb)
    if (sc) {
      this.pi.FsDWx = sc.displayX
      this.pi.FsDWy = sc.displayY
      fselDisAppear(this, f)
    }
    if (f.slide) {
      f.closing = result
      return
    }
    this.finishFselNow(result)
  }

  /** the teardown half of Fs_Close, once the screen has finished sliding */
  finishFselNow(result: string): void {
    const f = this.fsel
    if (!f || f.done) return
    const d = this.dialogs.get(f.chan)
    if (d) {
      eraseDialog(d, this.dialogDraw)
      this.dialogs.delete(f.chan)
    }
    f.slide = null
    this.closeScreen(f.screenNb)
    if (f.prevScreen >= 0) this.setCurrent(f.prevScreen)
    f.done = true
    f.result = result
  }

  // ---- Read Text (InReadText1/3 +Lib.s:14707 -> IRText 14755) ----
  /**
   * The ASCII reader is dialog program 1 of the system default resource
   * bank, run on its own EcFsel screen (PI_RtSx x PI_RtSy, +Interpreter_
   * Config.s:94) with 8 internal variables: 0 = the text address, 1 = the
   * title, 2 = the hypertext flag. The 68k then sits in a vbl loop reading
   * zone 5 (the HT zone) and quits when the dialog stops being drawn, so
   * this controller is stepped a frame at a time while BASIC blocks.
   */
  readText: {
    done: boolean
    result: string
    chan: number
    screenNb: number
    prevScreen: number
    /** the AppCentre slide, shared with the file selector */
    slide: SlideState | null
    closing: string | null
  } | null = null

  /** begin Read Text over text at `addr`; false = no system resource bank */
  startReadText(title: string, addr: number, length: number): boolean {
    const res = this.systemResource
    const prog = res?.programs?.[0]
    if (!prog) return false
    // "#HYPn" in the first bytes selects hypertext mode n and the text
    // itself starts 8 bytes in (+Lib.s:14771)
    let hyp = 0
    let base = addr
    const head = this.resolveAddr(addr)
    if (head) {
      const b = head.data.subarray(head.off, head.off + 5)
      const tag = String.fromCharCode(...b.subarray(0, 4))
      const digit = (b[4] ?? 0) - 0x30
      if (tag === '#HYP' && digit >= 1 && digit <= 9) {
        hyp = digit
        base = addr + 8
      }
    }
    void length // only sizes the 68k's string buffer (Dia_OpenChannel buflen)
    // TRd_OldEc (+Lib.s:14783): the screen to come back to, or -1 when
    // there is no current screen at all (`move.l T_EcCourant(a5),d1 / beq`)
    // — Read Text after a Screen Close has nothing to reactivate
    const prevScreen = this.screens.has(this.currentIndex) ? this.currentIndex : -1
    const g = res!.graphics
    // the reader's screen is config-sized (PI_RtSx x PI_RtSy, +Lib.s:14790),
    // which happens to default to the 640x200 this used to hard-code
    const s = new Screen(Runtime.EC_FSEL, this.pi.RtSx, this.pi.RtSy, g?.nColors ?? 8, (g?.mode ?? 0x8000) & 0x8004)
    s.bobBracket = this.bobBracket
    this.screens.set(Runtime.EC_FSEL, s)
    this.order = this.order.filter((i) => i !== Runtime.EC_FSEL)
    this.order.push(Runtime.EC_FSEL)
    this.currentIndex = Runtime.EC_FSEL
    s.cls(0)
    if (g) for (let i = 0; i < 32; i++) s.palette[i] = g.palette[i]!
    let chan = 65536
    while (this.dialogs.has(chan)) chan++
    const d = new DialogChannel(chan, 8, res!)
    d.script = prog
    d.screenNb = Runtime.EC_FSEL
    try {
      const scan = prescanDialog(prog)
      d.labels = scan.labels
      d.userInstrs = scan.userInstrs
    } catch {
      this.closeScreen(Runtime.EC_FSEL)
      if (prevScreen >= 0) this.setCurrent(prevScreen)
      return false
    }
    d.vars[0] = base
    d.vars[1] = title
    d.vars[2] = hyp
    this.dialogs.set(chan, d)
    // PI_RtWx/RtWy is where the reader sits (+Lib.s:14790)
    s.displayX = this.pi.RtWx
    s.displayY = this.pi.RtWy
    this.readText = { done: false, result: '', chan, screenNb: Runtime.EC_FSEL, prevScreen, slide: null, closing: null }
    try {
      this.runDialog(chan, -1, null, null)
    } catch {
      this.finishReadText('')
    }
    if (this.pi.RtSpeed > 0) this.readText.slide = slideOpen(s, this.pi.RtSpeed)
    return true
  }

  /** the reader's own wait loop (+Lib.s:14843): poll zone 5, quit when the
   * dialog closes itself */
  private stepReadText(): void {
    const t = this.readText
    if (!t || t.done) return
    // the reader arrives and leaves through the same centre-out slide as the
    // selector, at PI_RtSpeed rather than PI_FsDVApp (Fs_Appear/AppCentre)
    if (t.slide) {
      if (fselSlideStep(this, t.screenNb, t.slide)) {
        t.slide = null
        if (t.closing !== null) this.finishReadTextNow(t.closing)
      }
      return
    }
    const d = this.dialogs.get(t.chan)
    if (!d || !d.drawn) {
      // Dia_GetReturn hands back -1 once the dialog stops being drawn
      this.finishReadText('')
      return
    }
    // Dia_GetValue(c,5,0): a hypertext zone with no numeric position gives
    // back its keyword buffer, and a non-empty one ends Read Text in Param$
    const z = dialogZoneByNumber(d, 5, 0)
    if (!z) return
    const v = dialogZoneValue(z)
    if (v.s !== null && v.s !== '') this.finishReadText(v.s)
  }

  /** close the reader: dialog, screen, restore; the result goes to Param$ */
  finishReadText(result: string): void {
    const t = this.readText
    if (!t || t.done || t.closing !== null) return
    const sc = this.screens.get(t.screenNb)
    if (sc && this.pi.RtSpeed > 0) {
      t.slide = slideShut(sc, this.pi.RtSpeed)
      t.closing = result
      return
    }
    this.finishReadTextNow(result)
  }

  /** the teardown half, once the reader's screen has slid shut */
  finishReadTextNow(result: string): void {
    const t = this.readText
    if (!t || t.done) return
    const d = this.dialogs.get(t.chan)
    if (d) {
      eraseDialog(d, this.dialogDraw)
      this.dialogs.delete(t.chan)
    }
    t.slide = null
    this.closeScreen(t.screenNb)
    if (t.prevScreen >= 0) this.setCurrent(t.prevScreen) // .NoEc, 14903
    this.tempBuffer = null // ResTempBuffer 0 (+Lib.s:14905)
    t.done = true
    t.result = result
  }
  readonly dialogHost: DialogHost = {
    screenWidth: () => this.screen.width,
    screenHeight: () => this.screen.height,
    textWidth: (s) => s.length * 8,
    textHeight: () => 8,
    resolveArray: (handle) => {
      const arr = this.dialogArrays.get(handle)
      if (!arr) return null
      return arr.data.map((v) => (v.k === 'str' ? v.s : v.n | 0))
    },
    readMem: (addr, maxLen) => {
      const m = this.resolveAddr(addr)
      if (!m) return null
      return m.data.subarray(m.off, Math.min(m.off + maxLen, m.data.length))
    },
  }
  /** AR/AS/list bridge: =Array(A(0)) handles to live BASIC arrays */
  dialogArrays = new Map<number, AmosArray>()
  private dialogTarget: Screen | null = null
  readonly dialogDraw: DialogDraw = {
    activate: (n) => {
      this.dialogTarget = this.screens.get(n) ?? this.screen
    },
    deactivate: () => {
      this.dialogTarget = null
    },
    stamp: (img, x, y) => {
      this.blit(this.dTarget(), img, x, y, true)
    },
    copyRect: (x1, ySrc, x2, h, yDest) => {
      const s = this.dTarget()
      for (let r = 0; r < h; r++) {
        const sy = ySrc + r
        const dy = yDest + r
        if (sy < 0 || sy >= s.height || dy < 0 || dy >= s.height) continue
        const from = Math.max(0, x1)
        const to = Math.min(s.width, x2)
        s.pixelsW().copyWithin(dy * s.width + from, sy * s.width + from, sy * s.width + to)
      }
    },
    setPen: (c) => {
      this.dTarget().ink = c
    },
    setBPen: (c) => {
      this.dTarget().gPaper = c
    },
    setOutlinePen: (c) => {
      this.dTarget().gBorder = c
    },
    rectFill: (x1, y1, x2, y2) => {
      this.dTarget().bar(x1, y1, x2, y2)
    },
    outlineRect: (x1, y1, x2, y2) => {
      this.dTarget().box(x1, y1, x2, y2)
    },
    line: (x1, y1, x2, y2) => {
      this.dTarget().line(x1, y1, x2, y2)
    },
    ellipse: (x, y, rx, ry) => {
      this.dTarget().ellipse(x, y, rx, ry)
    },
    plot: (x, y) => {
      const s = this.dTarget()
      s.plot(x, y, s.ink)
    },
    text: (x, y, s) => {
      const t = this.dTarget()
      for (let i = 0; i < s.length; i++) {
        t.drawChar(x + i * 8, y, s.charCodeAt(i), t.ink, t.gPaper, t.grMode === 0)
      }
    },
    setWriting: (mode) => {
      this.dTarget().grMode = mode & 7
    },
    setLinePattern: (p) => {
      this.dTarget().linePattern = p & 0xffff
    },
    setFillPattern: (p, outline) => {
      const s = this.dTarget()
      if (outline >= 0) s.outline = outline !== 0
      s.pattern = resolveDialogPattern(this, p)
    },
    setFont: () => {
      // single 8x8 system font in the port (SF stored for compatibility)
    },
    grabBlock: (x, y, w, h) => {
      const s = this.dTarget()
      const pix = new Uint8Array(w * h)
      for (let r = 0; r < h; r++) {
        const sy = y + r
        if (sy < 0 || sy >= s.height) continue
        for (let c = 0; c < w; c++) {
          const sx = x + c
          if (sx >= 0 && sx < s.width) pix[r * w + c] = s.pixels[sy * s.width + sx]!
        }
      }
      return { x, y, w, h, pix }
    },
    putBlock: (saved) => {
      const b = saved as { x: number; y: number; w: number; h: number; pix: Uint8Array }
      const s = this.dTarget()
      for (let r = 0; r < b.h; r++) {
        const dy = b.y + r
        if (dy < 0 || dy >= s.height) continue
        for (let c = 0; c < b.w; c++) {
          const dx = b.x + c
          if (dx >= 0 && dx < s.width) s.putPixel(dx, dy, b.pix[r * b.w + c]!)
        }
      }
    },
    clearKeys: () => {
      this.input.keyQueue.length = 0
    },
    clearClicks: () => {
      this.input.mouseClickOld = this.input.mouseK
    },
    editField: (x, y, wChars, text, pap, pen, cursor) => {
      const s = this.dTarget()
      s.bar(x, y, x + wChars * 8 - 1, y + 7, pap)
      const shown = text.slice(Math.max(0, text.length - wChars))
      for (let i = 0; i < shown.length; i++) {
        s.drawChar(x + i * 8, y, shown.charCodeAt(i), pen, pap, false)
      }
      if (cursor >= 0) {
        const cx = x + Math.min(cursor, wChars - 1) * 8
        s.bar(cx, y, cx + 7, y + 7, pen)
        const ch = shown.charCodeAt(Math.min(cursor, shown.length))
        if (!Number.isNaN(ch)) s.drawChar(cx, y, ch, pap, pen, false)
      }
    },
    textCells: (x, y, s, pen, pap) => {
      const t = this.dTarget()
      for (let i = 0; i < s.length; i++) t.drawChar(x + i * 8, y, s.charCodeAt(i), pen, pap, false)
    },
    dialogSlider: (cfg, vertical, x, y, sx, sy, total, pos, size) => {
      const s = this.dTarget()
      s.drawSlider(vertical, x, y, x + sx - 1, y + sy - 1, total, pos, size, {
        fa: cfg[0]!,
        fb: cfg[1]!,
        fc: cfg[2]!,
        fpat: builtinPattern(cfg[3]!),
        ia: cfg[4]!,
        ib: cfg[5]!,
        ic: cfg[6]!,
        ipat: builtinPattern(cfg[7]!),
      })
    },
  }

  private dTarget(): Screen {
    return this.dialogTarget ?? this.screen
  }

  /**
   * Start or restart =Dialog Run (Dia_RunProgram +Lib.s:20535). Returns the
   * result when the script finishes without RU, or 'blocked' when the wait
   * loop begins.
   */
  runDialog(c: number, label: number, x: number | null, y: number | null): number | 'blocked' {
    const d = this.dialogs.get(c)
    if (!d) throw new AmosError(DIALOG_ERRORS[6]!)
    eraseDialog(d, this.dialogDraw)
    if (x !== null) d.baseX = x
    if (y !== null) d.baseY = y
    let startPos = 0
    if (label >= 0) {
      const off = d.labels.get(label)
      if (off === undefined) throw new AmosError(DIALOG_ERRORS[4]!)
      startPos = off
    }
    // per-run reset (Dia_RunProgram 20567-20585, incl. Dia_Edited /
    // Dia_LastZone / Dia_Release)
    d.xa = 0
    d.ya = 0
    d.xb = 0
    d.yb = 0
    d.ret = 0
    d.uiParams = []
    d.zones = []
    d.curZone = null
    d.runFlags = 0
    d.timer = 0
    d.edited = null
    d.lastZone = null
    d.release = null
    d.drag = null
    this.dialogDraw.activate(d.screenNb)
    this.dialogDraw.setWriting(0)
    d.drawn = true
    const exec = new DialogExec(d, this.dialogHost, this.dialogDraw)
    try {
      const r = exec.run(startPos)
      if (r.status === 'run') {
        // only an RU wait activates the first edit zone (Dia_Run →
        // L_Dia_EdFirst +Lib.s:22699); a live no-RU dialog has none
        // until the user clicks one
        editFirst(d, this.dialogDraw)
        d.exec = exec
        d.runState = 'waiting'
        d.timerStart = this.interp.tick
        return 'blocked'
      }
      // no RU: the dialog stays drawn ("live"), result 0
      d.runState = 'idle'
      return 0
    } catch (e) {
      if (e instanceof DialogError) {
        this.dialogErrPos = e.position
        eraseDialog(d, this.dialogDraw)
        throw new AmosError(e.message)
      }
      throw e
    } finally {
      this.dialogDraw.deactivate()
    }
  }

  /** complete a waiting dialog: run the script tail after RU, erase, store ret */
  finishDialogRun(d: DialogChannel, ret: number): void {
    d.ret = ret
    this.dialogDraw.activate(d.screenNb)
    try {
      const r = d.exec?.run()
      if (r && r.status === 'run') {
        // the tail hit another RU — keep waiting (Dia_Run re-runs EdFirst)
        editFirst(d, this.dialogDraw)
        d.timerStart = this.interp.tick
        return
      }
    } catch (e) {
      if (e instanceof DialogError) this.dialogErrPos = e.position
      else throw e
    } finally {
      this.dialogDraw.deactivate()
    }
    d.exec = null
    eraseDialog(d, this.dialogDraw)
    d.runState = 'done'
  }

  /** run a zone's [routine] block synchronously (button draw/change) */
  runZoneRoutine(d: DialogChannel, off: number, zone: DialogZone | null): void {
    if (off <= 0) return
    const prev = d.curZone
    if (zone) d.curZone = zone
    this.dialogDraw.activate(d.screenNb)
    try {
      const exec = new DialogExec(d, this.dialogHost, this.dialogDraw)
      exec.run(off)
    } catch (e) {
      if (e instanceof DialogError) this.dialogErrPos = e.position
      else throw e
    } finally {
      this.dialogDraw.deactivate()
      d.curZone = prev
    }
  }

  /** per-frame dialog interaction (Dia_AutoTest 24110 + Dia_Tests 24162) */
  private stepDialogs(): void {
    const lmb = (this.input.mouseK & 1) !== 0
    const press = lmb && !this.dialogLmb
    this.dialogLmb = lmb
    for (const d of this.dialogs.values()) {
      if (!d.drawn || d.frozen) continue
      const waiting = d.runState === 'waiting'
      if (waiting && d.timer > 0 && this.interp.tick - d.timerStart >= d.timer) {
        this.finishDialogRun(d, 0)
        continue
      }
      this.dialogDraw.activate(d.screenNb)
      let exit = 0
      try {
        exit = this.dialogTests(d, lmb, press, waiting)
      } catch (e) {
        if (e instanceof DialogError) {
          // an erroring channel freezes to avoid looping (AutoTest .Err)
          this.dialogErrPos = e.position
          d.frozen = true
        } else {
          throw e
        }
      } finally {
        this.dialogDraw.deactivate()
      }
      if (exit > 0) {
        if (waiting) this.finishDialogRun(d, d.ret)
        else eraseDialog(d, this.dialogDraw) // live channel erases itself
      }
    }
  }

  private dialogLmb = false

  /** hardware mouse coords → coords on screen s (SyCall XyScr) */
  private mouseOnScreen(s: Screen): { x: number; y: number } {
    return {
      x: s.hardToScreenX(this.input.mouseX),
      y: this.input.mouseY - s.displayY + s.offsetY,
    }
  }

  /** one round of zone tests; returns the exit count (Dia_Tests) */
  private dialogTests(d: DialogChannel, lmb: boolean, press: boolean, waiting: boolean): number {
    let exit = 0
    const host = this.dialogHost
    const draw = this.dialogDraw
    // a pressed nowait zone is tracked until release (Dia_Release)
    if (d.release) {
      const z = d.release
      d.ret = z.number
      if (lmb) {
        // while held, fire the change routine and skip EVERY other test
        // (both branches reach `bra .TFini`, +Lib.s:24177-24181)
        zoneChange(d, z, host, draw)
        if (z.quit) exit++
        return exit
      }
      // released: clear and fall through to the other tests (.Re)
      d.ret = 0
      d.release = null
      zoneDraw(d, z, host, draw)
    }
    // keyboard: match KY records against the next queued key. Only an RU
    // wait owns the keyboard — live dialogs must not eat Input/Inkey$ keys.
    const key = waiting ? (this.input.keyQueue.shift() ?? null) : (this.input.keyQueue[0] ?? null)
    let simulated: DialogZone | null = null
    if (key && d.edited) {
      // the active edit field consumes the keyboard (LEd_Loop)
      const z = d.edited
      if (key.ch === '\r') {
        d.ret = z.number // Return reports the edit zone (Dia_Tests 24200)
        // ...and moves to the next one unless Dia_Flags bit 4 says otherwise
        if (!d.noEditAdvance) editNext(d, draw)
      } else if (key.ch === '\t') {
        editNext(d, draw)
      } else if (key.ch === '\b' || key.ch === '\x7f') {
        z.text = (z.text ?? '').slice(0, -1)
        drawEditZone(d, z, draw)
      } else if (key.ch >= ' ') {
        const ok = z.kind !== 'digit' || /[0-9-]/.test(key.ch)
        if (ok && (z.text ?? '').length < (z.maxLen ?? 1024)) {
          z.text = (z.text ?? '') + key.ch
          drawEditZone(d, z, draw)
        }
      }
    } else if (key) {
      if (d.runFlags & 4) exit++ // RU flag bit2: any key exits
      const ascii = key.ch.toUpperCase().charCodeAt(0) || 0
      // The qualifiers that were held when the key arrived, which is what
      // pressKey captures into the queue entry, as Inkey$ does for Scanshift.
      const held = key.shift ?? 0
      for (const z of d.zones) {
        if (z.kind !== 'key') continue
        const kc = z.code!
        if (kc === 0) continue
        // code $FF = any key; bit7 = scancode match; else ASCII (uppercased)
        const hit = kc === 0xff || (kc & 0x80 ? (kc & 0x7f) === key.scan : kc === ascii)
        if (!hit) continue
        // .KShf (+Lib.s:24260): four qualifier groups, each compared as a
        // BOOLEAN rather than bit for bit — `and.b #Shf,d2 / sne d2` against
        // the same of the keystroke — so either Shift satisfies a Shift
        // record and no Shift fails it. Shf/Ctr/Alt/Ami are %11, %1000,
        // %110000 and %11000000 (+Equ.s:803).
        //
        // Ignoring them made the reader's `KY $CC,$0` (plain Up) answer
        // Shift+Up and Ctrl+Up as well, since it is the first record in the
        // list and the scan of the shifted ones never got a look in.
        const want = z.shift ?? 0
        const sameQual = (m: number): boolean => ((want & m) !== 0) === ((held & m) !== 0)
        if (!(sameQual(0x03) && sameQual(0x08) && sameQual(0x30) && sameQual(0xc0))) continue
        // .Pa4: a KY with no zone attached falls through to the mouse tests
        // WITHOUT clearing, so only a real hit eats the keystroke
        if (!z.ref) break
        simulated = z.ref
        // Dia_ClearKey — "Nettoyage du buffer". The whole buffer, not one
        // key: SyCall ClearKey then `clr.l T_ClLast`.
        //
        // Without it a live dialog only ever PEEKED, so the reader in Help_82
        // re-fired its Down arrow every frame forever and the Up arrow queued
        // behind it was never reached. Three lines a press, and no way back up.
        this.input.keyQueue.length = 0
        break
      }
    }
    // mouse: hover tracking every frame, presses (or simulated key
    // presses) trigger zone actions
    {
      const s = this.screens.get(d.screenNb) ?? this.screen
      const m = this.mouseOnScreen(s)
      const z = simulated ?? dialogZoneAt(d, m.x, m.y)
      // hover-deselect lists the mouse left (Dia_Tests .LNon)
      for (const lz of d.zones) {
        if (lz.kind !== 'list' || lz === z) continue
        if (lz.sel !== -1 && ((lz.listFlags ?? 0) & 4) === 0) {
          lz.sel = -1
          drawListZone(d, lz, host, draw)
        }
      }
      if (!press && !simulated && z?.kind !== 'list') {
        // nothing else reacts without a press
      } else if (z && z.kind === 'button' && (press || simulated)) {
        d.ret = z.number
        let next = z.pos + 1
        if (next > z.max) next = z.min
        z.pos = next
        zoneDraw(d, z, host, draw)
        const r = zoneChange(d, z, host, draw)
        if (z.nowait) {
          z.pos = r
          d.release = z
        } else if (r !== z.pos) {
          z.pos = r
          zoneDraw(d, z, host, draw)
        }
        if (z.quit) exit++
      } else if (z && (z.kind === 'edit' || z.kind === 'digit') && (press || simulated)) {
        // click activates the edit zone (Dia_Tests .MEd)
        const prev = d.edited
        d.edited = z
        if (prev && prev !== z) drawEditZone(d, prev, draw)
        drawEditZone(d, z, draw)
      } else if (z && z.kind === 'slider' && press) {
        // Sl_Clic: knob → drag, track → step repeatedly while held
        d.ret = z.number
        const span = (z.vertical ? z.sy : z.sx) - 1
        const rel = z.vertical ? m.y - z.y : m.x - z.x
        const { off, len } = sliderMetrics(span, z.total ?? 0, z.pos, z.size ?? 0)
        if (rel < off) d.drag = { z, mode: 'down', grab: 0 }
        else if (rel >= off + len) d.drag = { z, mode: 'up', grab: 0 }
        else d.drag = { z, mode: 'drag', grab: rel - off }
      } else if (z && z.kind === 'list') {
        // Dia_Tests .MLi: hover selects (unless flag bit2 = press-only);
        // a press commits ZoPos = the absolute index
        const row = (m.y - z.y) >> 3
        const idx = (z.scroll ?? 0) + row
        const valid = idx >= 0 && idx < (z.count ?? 0)
        const wantSel = valid ? idx : -1
        const pressOnly = ((z.listFlags ?? 0) & 4) !== 0
        if (wantSel !== z.sel && (!pressOnly || press)) {
          z.sel = wantSel
          drawListZone(d, z, host, draw)
        }
        if (press && valid) {
          d.ret = z.number
          z.pos = idx
          zoneChange(d, z, host, draw)
          if (z.quit) exit++
        }
      } else if (z && z.kind === 'hyper' && press) {
        // Dia_Tests .MHy: click an active segment; numeric keywords set
        // the position, text keywords fill the buffer (Rdialog$)
        const row = (m.y - z.y) >> 3
        const col = (m.x - z.x) >> 3
        const hz = z.htZones?.find((w) => w.row === row && col >= w.x0 && col < w.x1)
        if (hz) {
          d.ret = z.number
          if (/^[0-9$%]/.test(hz.key)) {
            z.pos = parseInt(hz.key.replace(/^\$/, '0x'), hz.key.startsWith('%') ? 2 : undefined) || 0
            z.text = ''
          } else {
            z.pos = 0
            z.text = hz.key
          }
          zoneChange(d, z, host, draw)
          if (z.quit) exit++
        }
      }
      if (press) {
        // any press resets the RU timer and, under flag bit 3, exits —
        // whether or not it hit a zone (+Lib.s:24346-24352; the timer
        // guard there reads Dia_Timer(sp), stack garbage that is
        // effectively always nonzero, so the reset always happens)
        d.timerStart = this.interp.tick
        if (d.runFlags & 8) exit++
      }
    }
    // a held slider (knob drag / track stepping, Sl_Clic)
    if (d.drag) {
      const { z, mode, grab } = d.drag
      if (!lmb) {
        if (mode === 'drag') zoneChange(d, z, host, draw)
        d.drag = null
      } else {
        const s = this.screens.get(d.screenNb) ?? this.screen
        const m = this.mouseOnScreen(s)
        const span = (z.vertical ? z.sy : z.sx) - 1
        const total = z.total ?? 0
        const window = z.size ?? 0
        const maxPos = Math.max(0, total - window)
        let next = z.pos
        if (mode === 'drag') {
          const rel = Math.max(0, (z.vertical ? m.y - z.y : m.x - z.x) - grab)
          next = Math.min(maxPos, Math.floor((rel * (total + 1)) / (span + 1)))
          if (next !== z.pos) {
            z.pos = next
            drawSliderZone(d, z, draw)
          }
        } else {
          next = mode === 'down' ? Math.max(0, z.pos - (z.step ?? 1)) : Math.min(maxPos, z.pos + (z.step ?? 1))
          if (next !== z.pos) {
            z.pos = next
            drawSliderZone(d, z, draw)
            zoneChange(d, z, host, draw)
          }
        }
      }
    }
    return exit
  }
  // ---- display control ----
  /** Update Every n: the auto bob/sprite update runs every n VBLs */
  updateEvery = 1
  /** Default Palette: colours applied to subsequently opened screens */
  defaultPalette: number[] = []
  /** Dual Playfield front/back screens (colour 0 of the front is clear) */
  /** Dual Playfield state: pf2Front = BPLCON2 PFBA (Dual Priority) */
  /** Auto View Off: newly opened screens stay hidden until View */
  autoView = true
  pendingView = new Set<number>()
  /** Request On (1) / Off (0) / Wb (2) — no requesters exist in the port */
  requestMode = 1
  /** Set Font / Get Fonts state (single-face Topaz port) */
  currentFont = 1
  /** Get Fonts examination mask (Igf d1: 1 = rom, 2 = disc, 3 = both) */
  fontsListed = 0
  // ---- sprite update freeze ----
  spriteUpdateOn = true
  frozenSprites: HwSprite[] | null = null
  /**
   * Sprite Priority lives on the screen now (Screen.pf1p/pf2p — EcCon2), not
   * here: HsPri (+W.s:11374) pokes the CURRENT screen's control block, so two
   * screens can order sprites against their playfields differently.
   */
  /** Limit Mouse rectangle in hardware coords, clamped each vbl */
  mouseLimit: { x1: number; y1: number; x2: number; y2: number } | null = null
  /**
   * `Command Line$` (InCommandLine +Lib.s:7867). The 68k keeps it under a
   * "CmdL" cookie below TBuffer rather than in a program variable, which is
   * how it survives `Run` chaining into the next program.
   */
  commandLine = ''
  // ---- menus (the Mn* engine, src/runtime/menu.ts) ----
  menu = new MenuTree()
  /** open interaction state while RMB is held (MnGere) */
  menuOpen: {
    levels: Array<{ lvl: OpenLevel; parent: MenuNode | null }>
    hover: Array<MenuNode | null>
    active: MenuNode | null
    activeLevel: number
  } | null = null
  readonly menuHost: MenuHost = {
    bobImage: (n) => this.spriteBank?.image(n) ?? null,
    iconImage: (n) => this.iconBank?.image(n) ?? null,
    callProc: () => {
      // (PR name) label procedures are not invoked by the port — see NOTES
    },
  }
  onMenu: { kind: 'gosub' | 'proc'; targets: string[]; armed: boolean } | null = null
  /** LMB drag of a movable item or level (MnBGoch +Lib.s:16016) */
  private menuDrag: { kind: 'item' | 'level'; node: MenuNode | null; level: number; mx: number; my: number } | null = null
  private sampleCache: { bank: MemoryBank; entries: SampleEntry[] } | null = null
  readonly amalHost: AmalHost = {
    globals: this.amalGlobals,
    random: (mask) => {
      const full = (this.amalSeed * 0x3171 + (this.interp.tick & 0xffff) + 1) >>> 0
      this.amalSeed = full & 0xffff
      return (full >>> 8) & mask & 0xffff
    },
    mouseX: () => this.input.mouseX,
    mouseY: () => this.input.mouseY,
    mouseKey: (bit) => (this.input.mouseK & bit ? -1 : 0),
    joy: () => this.input.joy,
    vumeter: (voice) => (voice >= 0 && voice < 4 ? this.vumeter(voice) : 0),
    col: (n) => this.colGet(n),
    bobCol: (n, f, t) => this.bobColCheck(n, f, t),
    spriteCol: (n, f, t) => this.spriteColCheck(n, f, t),
    xy: (kind, screen, v) => {
      const s = this.screens.get(screen & 7)
      if (!s) return -1
      switch (kind) {
        case 'XS':
          return s.hardToScreenX(v)
        case 'YS':
          return s.hardToScreenY(v)
        case 'XH':
          return s.screenToHardX(v)
        case 'YH':
          return s.screenToHardY(v)
      }
    },
    amalBank: () => this.amalBank,
  }

  /**
   * T_AmBank (+W.s:7186). TokAMAL stashes the AMAL bank address every time a
   * channel is tokenized, so the bank the PLay instruction reads is whatever
   * bank 4 held at the last Amal/Anim/Move — a global, re-read live by AmPli.
   */
  amalBank: AmalBank | null = null
  private amalBankSrc: Uint8Array | null = null

  /**
   * The bank lookup every Amal/Anim/Move X/Move Y performs before tokenizing
   * (+Lib.s:11855): bank 4, and only if it is named "Amal". Returns null when
   * there is no such bank, which is what makes `Amal n,#` raise BkNoRes.
   */
  refreshAmalBank(): AmalBank | null {
    const b = this.memBanks.get(4)
    const data = b && b.name.startsWith('Amal') ? b.data : null
    if (data === null) {
      this.amalBank = null
      this.amalBankSrc = null
    } else if (this.amalBankSrc !== data) {
      this.amalBankSrc = data
      this.amalBank = parseAmalBank(data)
    }
    return this.amalBank
  }

  /** the object a channel drives, by kind ('bob', 'sprite', 'screen display', ...) */
  makeChannelTarget(kind: string, m: number): ChannelTarget {
    if (kind === 'bob') {
      return {
        kind,
        n: m,
        get: () => {
          const b = this.bobs.get(m)
          return { x: b?.x ?? 0, y: b?.y ?? 0, a: b?.image ?? 1 }
        },
        set: (x, y, a) => {
          let b = this.bobs.get(m)
          if (!b) {
            b = { n: m, x: 0, y: 0, image: 1, screen: this.currentIndex }
            this.bobs.set(m, b)
          }
          if (x !== null) b.x = x
          if (y !== null) b.y = y
          if (a !== null) b.image = a
        },
      }
    }
    if (kind === 'screen display' || kind === 'screen offset') {
      const disp = kind === 'screen display'
      return {
        kind,
        n: m,
        get: () => {
          const s = this.screens.get(m)
          if (!s) return { x: 0, y: 0, a: 0 }
          return disp ? { x: s.displayX, y: s.displayY, a: 0 } : { x: s.offsetX, y: s.offsetY, a: 0 }
        },
        set: (x, y) => {
          const s = this.screens.get(m)
          if (!s) return
          if (disp) {
            if (x !== null) s.displayX = x
            if (y !== null) s.displayY = y
          } else {
            if (x !== null) s.offsetX = x
            if (y !== null) s.offsetY = y
          }
        },
      }
    }
    if (kind === 'rainbow') {
      // Channel n To Rainbow m: X drives the table base, Y the vertical
      // position — changes latch RnAct bits like the Rainbow instruction
      return {
        kind,
        n: m,
        get: () => {
          const rb = this.rainbows.get(m)
          return { x: rb?.x ?? 0, y: rb?.y ?? 0, a: 0 }
        },
        set: (x, y) => {
          const rb = this.rainbows.get(m)
          if (!rb) return
          if (x !== null) {
            rb.x = x
            rb.act |= 2
          }
          if (y !== null) {
            rb.y = y
            rb.act |= 4
          }
        },
      }
    }
    if (kind === 'screen size') {
      return { kind, n: m, get: () => ({ x: 0, y: 0, a: 0 }), set: () => {} }
    }
    // default: hardware sprite
    return {
      kind: 'sprite',
      n: m,
      get: () => {
        const s = this.hwSprites.get(m)
        return { x: s?.x ?? 0, y: s?.y ?? 0, a: s?.image ?? 1 }
      },
      set: (x, y, a) => {
        let s = this.hwSprites.get(m)
        if (!s) {
          s = { n: m, x: 0, y: 0, image: 1 }
          this.hwSprites.set(m, s)
        }
        if (x !== null) s.x = x
        if (y !== null) s.y = y
        if (a !== null) s.image = a
      },
    }
  }

  /**
   * Stamp a file with the host clock's current time. AmigaDOS updates a
   * file's datestamp whenever it is written; doing it here rather than
   * inside AmigaFS keeps the filesystem free of any notion of time, and
   * keeps the clock the single source of it.
   */
  stampFile(path: string): void {
    const { days, mins, ticks } = this.host.clock.now()
    this.vfs?.setMeta(path, { days, mins, ticks })
  }

  /** the fs as a writable AmigaFS, when it is one */
  get vfs(): AmigaFS | null {
    return this.fs instanceof AmigaFS ? this.fs : null
  }

  chan(n: number): NonNullable<ReturnType<Runtime['fileChans']['get']>> {
    const c = this.fileChans.get(n)
    if (!c) throw new AmosError(`file not opened: channel ${n}`)
    return c
  }

  /** read one Input#/Line Input# field from a channel */
  readField(n: number, stopAtComma: boolean): string {
    const c = this.chan(n)
    if (c.mode !== 'in') throw new AmosError('file type mismatch')
    let out = ''
    while (c.pos < c.data.length) {
      const b = c.data[c.pos++]!
      if (stopAtComma && b === 44) return out
      if (b === this.chrInp[0]) {
        if (c.data[c.pos] === this.chrInp[1]) c.pos++
        return out
      }
      out += String.fromCharCode(b)
      if (out.length > 1000) break
    }
    return out
  }

  /**
   * Hand text written to a `SPEAK:` channel to the synthesiser, one utterance
   * at a time. Silent — rather than an error — when narrator-ts is absent or
   * still loading, because a handler write is not a statement that can be
   * re-run the way `Say` is.
   */
  speakWrite(c: { speak?: { buf: SpeakBuffer; voice: SpeakOptions } }, text: string): void {
    if (!c.speak) return
    for (const utterance of c.speak.buf.feed(text)) speakOne(this, utterance, c.speak.voice)
  }

  /**
   * Move the bytes one IORequest asks for, and answer io_Actual and io_Error.
   *
   * Shared by the core `Dev *` family, which pokes its fields into mapped
   * memory, and LDos's `Ldevice`, which passes them as arguments -- the two
   * front ends differ and the transfer does not. Only the devices
   * `DEV_MODELLED` names can be opened, so this never sees a name with
   * nothing behind it.
   *
   * DEVIATION: a command the modelled device does not implement completes
   * silently with io_Error left at zero. On the machine exec would set
   * IOERR_NOCMD and the caller would raise; reproducing that means claiming
   * to know each device's whole command set, which reading these routines
   * does not establish.
   */
  devTransfer(
    name: string,
    unit: number,
    serial: SerialPortHandle | undefined,
    cmd: number,
    length: number,
    data: number,
    offset: number,
  ): { actual: number; error: number } {
    const byte = (a: number): number => {
      const m = this.resolveAddr(a >>> 0)
      return m ? (m.data[m.off] ?? 0) : 0
    }
    const setByte = (a: number, val: number): void => {
      const m = this.resolveWrite(a >>> 0)
      if (m) m.data[m.off] = val & 0xff
    }
    if (name.toLowerCase() === 'trackdisk.device') {
      const drive = this.machine.drives[unit]
      const disk = drive?.medium ?? null
      // TDERR_DiskChanged is 29; an empty drive is what a program tests for
      if (!disk) return { actual: 0, error: 29 }
      const image = disk.image
      let moved = 0
      // CMD_READ is 2, CMD_WRITE 3 and CMD_UPDATE 4
      if (cmd === 2) {
        for (; moved < length && offset + moved < image.length; moved++) setByte(data + moved, image[offset + moved]!)
      } else if (cmd === 3) {
        // TDERR_WriteProt is 28. The tab is on the DRIVE, and a drive that
        // reads one refuses before the medium is touched: the write did not
        // partly happen, so io_Actual stays at zero.
        if (drive?.writeProtected) return { actual: 0, error: 28 }
        for (; moved < length && offset + moved < image.length; moved++) image[offset + moved] = byte(data + moved)
        disk.invalidate?.()
      } else if (cmd === 4) {
        disk.invalidate?.()
      }
      return { actual: moved, error: 0 }
    }
    if (name.toLowerCase() === 'serial.device' && serial) {
      if (cmd === 3) {
        const out: number[] = []
        for (let i = 0; i < length; i++) out.push(byte(data + i))
        serial.write(Uint8Array.from(out))
        return { actual: length, error: 0 }
      }
      if (cmd === 2) {
        const got = serial.read().slice(0, length)
        for (let i = 0; i < got.length; i++) setByte(data + i, got[i]!)
        return { actual: got.length, error: 0 }
      }
    }
    return { actual: 0, error: 0 }
  }

  /**
   * Run one IORequest for a `Dev Do` or `Dev Send`.
   *
   * The command word goes into io_Command at +28 and the caller has already
   * Doked io_Length (+36), io_Data (+40) and io_Offset (+44) into the
   * channel's slice, which is exactly what a program written against this
   * family does; io_Actual (+32) and io_Error (+31) come back the same way.
   */
  devCommand(c: DevChannel, cmd: number): void {
    const base = c.addr - Runtime.DEV_IO_BASE
    const v = new DataView(this.dev.io.buffer, this.dev.io.byteOffset, this.dev.io.byteLength)
    v.setUint16(base + 28, cmd & 0xffff)
    const r = this.devTransfer(
      c.name,
      c.unit,
      c.serial,
      cmd,
      v.getUint32(base + 36),
      v.getUint32(base + 40),
      v.getUint32(base + 44),
    )
    v.setUint32(base + 32, r.actual)
    v.setUint8(base + 31, r.error & 0xff)
  }

  closeChannel(n: number): void {
    const c = this.fileChans.get(n)
    if (!c) return
    if (c.speak) {
      // whatever was written without a terminator is spoken at Close, so a
      // program that never ends its last line still says it
      for (const utterance of c.speak.buf.flush()) speakOne(this, utterance, c.speak.voice)
      this.fileChans.delete(n)
      return
    }
    if (c.mode === 'out') {
      if (!this.vfs?.writeFile(c.path, Uint8Array.from(c.out))) {
        this.fileChans.delete(n)
        throw new AmosError('disc is write protected')
      }
    } else if (c.mode === 'random') {
      if (!this.vfs?.writeFile(c.path, c.data)) {
        this.fileChans.delete(n)
        throw new AmosError('disc is write protected')
      }
    }
    this.fileChans.delete(n)
  }

  /**
   * GetSam (+Music.s:3207): errors follow the 68k order — n<=0 illegal
   * function call; bank missing or not a "Samp" bank = error 180 "Sample
   * bank not found"; n past the count or a zero offset = sample not
   * defined (+Editor_Config.s:1049).
   */
  getSample(n: number): SampleEntry {
    if (n <= 0) throw new AmosError('Illegal function call', 23)
    const bank = this.memBanks.get(this.samBankNum)
    if (!bank || !bank.name.startsWith('Samp')) throw new AmosError('sample bank not found')
    if (this.sampleCache?.bank !== bank) {
      this.sampleCache = { bank, entries: parseSampleBank(bank.data) }
    }
    const s = this.sampleCache.entries[n - 1]
    if (!s || s.pcm.length === 0) throw new AmosError('sample not defined')
    return s
  }

  /**
   * GoSam/SPl0 (+Music.s:3169/3282): start PCM on each masked voice at the
   * period-quantized Paula rate, looping the voices flagged by Sam Loop On.
   */
  samPlay(mask: number, pcm: Int8Array, freq: number): void {
    if (pcm.length === 0) return
    const hz = periodToHz(samPeriod(freq))
    // GoSam steals the voices from the music (VOnOf with the complement,
    // +Music.s:3176); one-shots hand them back when they finish (the Sami
    // handler sets MuReStart at natural end, +Music.s:1080)
    this.music.samSteal(mask)
    for (let v = 0; v < 4; v++) {
      if (!(mask & (1 << v))) continue
      this.music.onSamVoice(v)
      const loop = (this.samLoopMask >> v) & 1
      this.audio.play(v, pcm, hz, this.voices[v]!.volume, loop ? 0 : -1)
      this.music.samEnd[v] = loop ? Infinity : this.interp.tick + Math.ceil((pcm.length / hz) * 50)
    }
  }

  /** start PCM on every voice in the mask (Bell/Boom/Shoot effects path) */
  playPcm(mask: number, pcm: Int8Array, freq: number, loop: boolean): void {
    if (freq <= 0 || pcm.length === 0) return
    for (let v = 0; v < 4; v++) {
      if (!(mask & (1 << v))) continue
      this.audio.play(v, pcm, freq, this.voices[v]!.volume, loop ? 0 : -1)
    }
  }

  stopVoices(mask: number): void {
    for (let v = 0; v < 4; v++) {
      if (!(mask & (1 << v))) continue
      this.audio.stop(v)
      // InSamStop kills the Sami interrupt (+Music.s:4108) — no natural
      // end fires, so the music does NOT reclaim the voice
      this.music.samEnd[v] = Infinity
      this.music.onSamStop(v)
    }
  }

  /**
   * What the program has allocated, in the shape exec's `availMem` wants.
   *
   * The accounting stays here rather than in ../amiga/exec.ts because it is
   * AMOS's: a bank is chip because an AMOS bank flag says so, and a screen's
   * bitplanes are charged to chip because AMOS put them there. exec supplies
   * the pool sizes and the arithmetic; only the Runtime knows what is in them.
   */
  memoryInUse(): MemoryInUse {
    return { chip: this.chipUsed(), fast: this.fastUsed() }
  }

  /** AvailMem(MEMF_CHIP) — what Chip Free reports, and Chip Largest with it */
  chipFree(): number {
    return availMem(A1200_POOLS, this.memoryInUse(), MEMF.CHIP)
  }

  /** AvailMem(MEMF_FAST) */
  fastFree(): number {
    return availMem(A1200_POOLS, this.memoryInUse(), MEMF.FAST)
  }

  chipUsed(): number {
    let n = 0
    for (const b of this.memBanks.values()) if (b.memType === 1) n += b.data.length
    for (const s of this.screens.values()) {
      // bitplanes are chip memory: a row is rounded up to a whole word
      n += rowBytesFor(s.width) * s.height * s.depth
    }
    for (const bank of [this.spriteBank, this.iconBank]) {
      if (!bank) continue
      // this used to round up like a screen and assume two planes; a bank
      // image knows its own geometry, and it truncates
      for (const img of bank.images) n += img.rowBytes * img.height * img.depth
    }
    return n
  }

  /** Fast bytes held by banks (anything not asked for as chip). */
  fastUsed(): number {
    let n = 0
    for (const b of this.memBanks.values()) if (b.memType !== 1) n += b.data.length
    return n
  }

  /** Bytes of the Varptr arena currently mapped, for Free. */
  arenaBytes(): number {
    let n = 0
    for (const slot of this.varSlots) n += slot.buf.length
    return n
  }

  /*
   * ---- the Varptr variable arena -----------------------------------------
   *
   * Variables mapped into the fake address space (FnVarPtr +ILib.s:4087):
   * integer/float cells get a stable 4-byte slot that syncs from the
   * variable on reads and flushes Pokes back; strings are snapshotted
   * (length word + chars, Varptr returns chars) exactly as the 68k hands
   * out the current string block — reassignment leaves the old address
   * stale there too. Pokes into a string flush back while the variable
   * still has the snapshot's length.
   *
   * ## The flush, and the one way round it that is left
   *
   * A slot is handed out as a Proxy so that writing to it writes THROUGH to
   * the AMOS variable. The trap covers `view[i] = x` and, since a write
   * through any of `MUTATORS` was found to be silently lost, those too.
   *
   * What no Proxy can cover is `view.buffer`. A DataView built over it holds
   * the raw ArrayBuffer and writes past every trap there is, so the bytes
   * change and the variable does not. Three keywords did exactly that and
   * three keywords did nothing: TFT's `Qsort` — whose only documented call
   * is `Qsort Varptr(TEST(0)),0,20` — and LDos's `Lcrypt` and `Ldecrypt`.
   * `longsAt` below exists so that no fourth has to invent the byte loop,
   * and `varptr.test.ts` holds every path to the same promise.
   */

  private varSlots: Array<{
    addr: number
    buf: Uint8Array
    view: Uint8Array
    sync: () => void
    flush: () => void
  }> = []

  private varAddrByKey = new Map<string, number>()
  private varArenaNext = Runtime.VAR_BASE

  private makeVarSlot(key: string | null, size: number, sync: (buf: Uint8Array) => void, flush: (buf: Uint8Array) => void): number {
    if (key !== null) {
      const existing = this.varAddrByKey.get(key)
      if (existing !== undefined) return existing
    }
    const buf = new Uint8Array(size)
    const slot: { addr: number; buf: Uint8Array; view: Uint8Array; sync: () => void; flush: () => void } = {
      addr: this.varArenaNext,
      buf,
      view: buf,
      sync: () => sync(buf),
      flush: () => flush(buf),
    }
    slot.view = new Proxy(buf, {
      set(t, prop, v): boolean {
        ;(t as unknown as Record<string | symbol, unknown>)[prop] = v
        slot.flush()
        return true
      },
      get(t, prop): unknown {
        const val = (t as unknown as Record<string | symbol, unknown>)[prop]
        if (typeof val !== 'function') return val
        const fn = (val as (...a: unknown[]) => unknown).bind(t)
        // A bulk write has to flush as surely as `view[i] = x` does. It did
        // not, and that is not a hypothetical: AMOS's own `Copy` reaches the
        // destination through `.copyWithin`/`.set`, and `Copy Varptr(B(0)),…
        // To Varptr(A(0))` left A untouched. Poke was fine, because Poke is
        // the one write that goes through the indexed trap above.
        if (!MUTATORS.has(prop as string)) return fn
        return (...a: unknown[]): unknown => {
          const out = fn(...a)
          slot.flush()
          return out
        }
      },
    }) as Uint8Array
    this.varArenaNext += (size + 15) & ~15
    this.varSlots.push(slot)
    if (key !== null) this.varAddrByKey.set(key, slot.addr)
    return slot.addr
  }

  /** a stable arena slot for a scalar variable cell */
  varptrScalar(key: string, type: number, get: () => number, set: (v: number) => void): number {
    return this.makeVarSlot(
      `s:${key}`,
      4,
      (buf) => {
        const raw = type === 1 ? toFFP(get()) : get() | 0
        buf[0] = (raw >>> 24) & 0xff
        buf[1] = (raw >>> 16) & 0xff
        buf[2] = (raw >>> 8) & 0xff
        buf[3] = raw & 0xff
      },
      (buf) => {
        const raw = ((buf[0]! << 24) | (buf[1]! << 16) | (buf[2]! << 8) | buf[3]!) >>> 0
        set(type === 1 ? fromFFP(raw) : raw | 0)
      },
    )
  }

  /** a string snapshot slot; returns the address of the CHARACTERS */
  varptrString(get: () => string, set: (v: string) => void): number {
    const snapLen = get().length
    const addr = this.makeVarSlot(
      null, // fresh block per call, like the 68k's moving string heap
      2 + snapLen,
      (buf) => {
        const s = get()
        if (s.length !== snapLen) return // variable moved on: stale block
        buf[0] = (snapLen >> 8) & 0xff
        buf[1] = snapLen & 0xff
        for (let i = 0; i < snapLen; i++) buf[2 + i] = s.charCodeAt(i) & 0xff
      },
      (buf) => {
        if (get().length !== snapLen) return
        let s = ''
        for (let i = 0; i < snapLen; i++) s += String.fromCharCode(buf[2 + i]!)
        set(s)
      },
    )
    return addr + 2
  }

  /** the whole-array slot backing =Array() — int/float arrays only */
  /**
   * `Varptr(A(n))` — the address of ONE element, inside the whole-array block.
   *
   * The same slot `varptrArray` builds, so `Varptr(A(0))` and `Varptr(A(1))`
   * are four bytes apart and a caller handed the first can walk the rest. That
   * is what an array is on the machine, and what every routine taking an array
   * by pointer assumes.
   */
  varptrArrayElement(key: string, arr: { data: Value[]; type?: number }, type: number, index: number): number {
    return this.varptrArray(key, arr, type) + ARRAY_HEADER + index * 4
  }

  varptrArray(key: string, arr: { data: Value[]; type?: number }, type: number): number {
    // The header is written ONCE, the way Dim writes it and nothing else
    // touches it — a sync that rewrote it every read would undo an extension
    // that had changed the dimension word, which is exactly what JD's
    // Jd Reduce Dim does (+|jd.s:5984).
    let headerWritten = false
    return this.makeVarSlot(
      `a:${key}`,
      ARRAY_HEADER + Math.max(4, arr.data.length * 4),
      (buf) => {
        if (!headerWritten) {
          writeArrayHeader(buf, arr.data.length)
          headerWritten = true
        }
        for (let i = 0; i < arr.data.length; i++) {
          const v = arr.data[i]!
          const n = v.k === 'str' ? 0 : v.n
          const raw = type === 1 ? toFFP(n) : n | 0
          const at = ARRAY_HEADER + i * 4
          buf[at] = (raw >>> 24) & 0xff
          buf[at + 1] = (raw >>> 16) & 0xff
          buf[at + 2] = (raw >>> 8) & 0xff
          buf[at + 3] = raw & 0xff
        }
      },
      (buf) => {
        for (let i = 0; i < arr.data.length; i++) {
          const at = ARRAY_HEADER + i * 4
          const raw = ((buf[at]! << 24) | (buf[at + 1]! << 16) | (buf[at + 2]! << 8) | buf[at + 3]!) >>> 0
          arr.data[i] = type === 1 ? VF(fromFFP(raw)) : VI(raw | 0)
        }
      },
    )
  }

  /** the token table, kept for Run's program reload */
  private table!: TokenTable

  /**
   * Run "file" (InRun1 +ILib.s:1475): the file must exist ("file not
   * found"), the running program is New'd WITHOUT erasing screens
   * (Prg_New d0=0), and the new program loads with its own banks and
   * starts from the top.
   */
  runFile(path: string): void {
    const bytes = this.fs?.read(path)
    if (!bytes) throw new AmosError('file not found')
    const file = parseAmosFile(bytes)
    if (file.source.length === 0) throw new AmosError('file not found')
    const lines = parseSource(file.source, this.table)
    this.memBanks.clear()
    this.spriteBank = null
    this.iconBank = null
    for (const bank of file.banks) {
      if (bank.kind === 'sprites') this.spriteBank = ObjectBank.fromSpriteBank(bank)
      else if (bank.kind === 'icons') this.iconBank = ObjectBank.fromSpriteBank(bank)
      else if (bank.kind === 'memory') this.memBanks.set(bank.number, bank)
    }
    this.runLines(lines)
  }

  /** the program-swap half of Run: screens survive, execution restarts */
  runLines(lines: TokenLine[]): void {
    this.interp.replaceProgram(lines)
  }

  /**
   * Prun "file" (InPRun +ILib.s:1537): load a second program into its own
   * structure and run it as an accessory, coming back here afterwards.
   *
   * Unlike Run this does not replace the caller: Prg_RunIt pushes the
   * caller's interpreter data (Prg_Push) and only the accessory's End pops
   * it again. Each program structure owns its own bank list — Prg_SetBanks
   * (+Verif.s:4742) just repoints Cur_Banks — so the accessory's banks
   * replace the caller's for the duration and are swapped back on the way
   * out. The display is not reinitialised: `tst.w d2 / beq .Nor / bmi .PRun`
   * (+Verif.s:4396) sends the accessory to DefRunAcc where a normal program
   * goes to DefRun1 and DefRun2, so screens and whatever is drawn on them
   * survive in both directions.
   *
   * What DefRunAcc does NOT skip is the extensions. It opens with the
   * Sys_DefaultRoutines list and, thirty lines later, `Rbsr
   * L_DefRunExtensions` (+ILib.s:403) — the same call DefRun1 makes at :312.
   * That routine is the extension table itself (+ILib.s:415):
   *
   *     lea     ExtAdr(a5),a0 / moveq #26-1,d0
   *   L:move.l  4(a0),d1 / beq          ; the slot's DEFAULT routine, or none
   *     move.l  d1,a1 / jsr (a1)
   *     lea     16(a0),a0 / dbra d0,L   ; sixteen bytes a slot, twenty-six
   *
   * and `ExtAdr: rs.l 26*4` (+Equ.s:1185) is the table AMCAF's Extbase and
   * Extdefault index as `$f8(a5)` — the same twenty-six slots, the same
   * sixteen bytes, the same `+$4`. So an accessory starts with every
   * extension's settings back at boot, and this port ran none of them until
   * the reading above.
   *
   * NOTE: the return trip does not repeat it. Only the forward call reaches
   * Prg_RunIt; the accessory's End goes through Prg_Pull, which restores the
   * caller's data without touching the extensions. So a caller resumes with
   * whatever the accessory left its settings as, and that is reproduced.
   */
  prun(path: string, resumeAt: Addr): void {
    // an accessory cannot Prun another one (PRun_Acc, +ILib.s:1600)
    if (this.interp.nestedProgram) throw new AmosError('accessory cannot Prun', 102)
    const bytes = this.fs?.read(path)
    if (!bytes) throw new AmosError('file not found')
    const file = parseAmosFile(bytes)
    if (file.source.length === 0) throw new AmosError('file not found')
    const lines = parseSource(file.source, this.table)
    // DefRunAcc's `Rbsr L_DefRunExtensions` -- every occupied slot's +$4,
    // the same hook Default runs and AMCAF's Extdefault reaches one at a time
    for (const impl of new Set(this.extSlotImpls().values())) impl.defaults?.(this)
    const saved = { memBanks: this.memBanks, spriteBank: this.spriteBank, iconBank: this.iconBank }
    this.memBanks = new Map()
    this.spriteBank = null
    this.iconBank = null
    for (const bank of file.banks) {
      if (bank.kind === 'sprites') this.spriteBank = ObjectBank.fromSpriteBank(bank)
      else if (bank.kind === 'icons') this.iconBank = ObjectBank.fromSpriteBank(bank)
      else if (bank.kind === 'memory') this.memBanks.set(bank.number, bank)
    }
    this.interp.pushProgram(lines, saved, resumeAt)
  }

  /** Prg_Pull's half of the bank swap: Prg_SetBanks + Bnk.Change */
  private restoreProgramBanks(host: unknown): void {
    const s = host as { memBanks: Map<number, MemoryBank>; spriteBank: ObjectBank | null; iconBank: ObjectBank | null }
    this.memBanks = s.memBanks
    this.spriteBank = s.spriteBank
    this.iconBank = s.iconBank
  }

  // ---- Sprite Base / Icon Base synthesized bank memory --------------------
  // The 68k sprite bank: count.w, then 8 bytes per image (record ptr.l +
  // mask ptr.l), the 32-word palette, and the records themselves
  // (TX.w TY.w planes.w hotX.w hotY.w + planar data) in chip RAM
  // (Bnk.Load LB_Sprites +Lib.s). Synthesized read-only on each access.
  //
  // This used to re-encode every image from its chunky bytes, plane by plane
  // and pixel by pixel, and cache the result to hide the cost — with the
  // staleness that implies, since an in-place pixel edit kept serving the old
  // image until the image COUNT changed. BankImage stores the planes
  // authoritatively now, so the records are a copy of `planeBytes()` and the
  // cache is not needed: no encode, and no stale window.

  objectBankImage(kind: 'sprites' | 'icons'): Uint8Array | null {
    const bank = kind === 'sprites' ? this.spriteBank : this.iconBank
    if (!bank) return null
    const count = bank.images.length
    const recOffsets: number[] = []
    let size = 2 + count * 8 + 64
    for (const img of bank.images) {
      recOffsets.push(size)
      size += 10 + bankRowBytesFor(img.width) * img.height * img.depth
    }
    const base = kind === 'sprites' ? Runtime.SPRITE_BANK_BASE : Runtime.ICON_BANK_BASE
    const out = new Uint8Array(size)
    const w16 = (off: number, v: number): void => {
      out[off] = (v >> 8) & 0xff
      out[off + 1] = v & 0xff
    }
    const w32 = (off: number, v: number): void => {
      w16(off, v >>> 16)
      w16(off + 2, v & 0xffff)
    }
    w16(0, count)
    for (let i = 0; i < count; i++) {
      w32(2 + i * 8, base + recOffsets[i]!)
      w32(2 + i * 8 + 4, 0) // the mask pointer stays 0 (computed lazily on the 68k)
    }
    for (let i = 0; i < 32; i++) w16(2 + count * 8 + i * 2, bank.palette[i] ?? 0)
    bank.images.forEach((img, i) => {
      const off = recOffsets[i]!
      const widthWords = img.width >> 4
      w16(off, widthWords)
      w16(off + 2, img.height)
      w16(off + 4, img.depth)
      w16(off + 6, img.hotX)
      w16(off + 8, img.hotY)
      // the bank's own planar bytes, in the same layout the record wants:
      // widthWords*2 per row, planeSize per plane, planes in order
      out.set(img.planeBytes(), off + 10)
    })
    return out
  }

  private resolveVarSlot(a: number): { data: Uint8Array; off: number } | null {
    for (const s of this.varSlots) {
      if (a >= s.addr && a < s.addr + s.buf.length) {
        s.sync()
        return { data: s.view, off: a - s.addr }
      }
    }
    return null
  }

  /**
   * Bnk.OrAdr (+Lib.s:8082): a value BELOW 1024 is a bank number and answers
   * that bank's start address, anything else is already an address.
   *
   * 1024 is the library's own line and not a round number chosen here:
   * `cmp.l #1024,d0 / bge.s .Skip`. It is well under the 65535 a bank number
   * can reach, so `Bload "f",2000` names an ADDRESS on the machine even
   * though bank 2000 is a bank you can Reserve. This port had 0x10000 here,
   * which is `reserveBank`'s range rather than this routine's.
   */
  bankOrAddr(n: number): { data: Uint8Array; off: number } | null {
    if (n >= 0 && n < 1024) {
      const bank = this.memBanks.get(n)
      if (!bank) throw new AmosError('bank not reserved', 36)
      return { data: bank.data, off: 0 }
    }
    return this.resolveAddr(n)
  }

  /**
   * Vol (+Music.s:2754): volume outside 0-63 = illegal function call
   * (unsigned compare); sets the per-voice default and the live level.
   */
  setVolume(mask: number, vol: number): void {
    if (vol < 0 || vol >= 64) throw new AmosError('Illegal function call', 23)
    for (let v = 0; v < 4; v++) {
      if (!(mask & (1 << v))) continue
      this.voices[v]!.volume = vol
      this.audio.setVolume(v, vol)
    }
  }

  /**
   * FnVuMeter (+Music.s:3893): read AND clear the note-on byte the music
   * player stores per voice. Callers validate the range (BASIC errors on
   * voice>3, AMAL's Vu() returns 0 — AmVu +W.s:9065).
   */
  vumeter(voice: number): number {
    const b = this.vuBytes[voice]!
    this.vuBytes[voice] = 0
    return b
  }

  /** Freeze parks the whole AMAL channel chain (FrzAMAL +W.s:9999:
   * T_AmChaine moves to T_AmFreeze); channels made while frozen run on a
   * fresh live chain. Unfreeze restores ONLY if the live chain is still
   * empty — otherwise the frozen chain is discarded (UFrzAMAL). */
  frozenAmal: Map<number, AmalChannel> | null = null

  freezeAll(): void {
    if (this.frozenAmal !== null) return
    this.frozenAmal = this.channels
    this.channels = new Map()
  }

  unfreezeAll(): void {
    if (this.channels.size === 0 && this.frozenAmal !== null) this.channels = this.frozenAmal
    this.frozenAmal = null
  }

  stepAmal(): void {
    const nums = [...this.channels.keys()].sort((a, b) => a - b)
    for (const n of nums) {
      const ch = this.channels.get(n)!
      if (ch.on && !ch.frozen) ch.step(this.amalHost)
    }
    this.stepStos()
  }

  // ---- STOS-compatibility Anim / Move X / Move Y ----
  // Each channel carries independent Anim/MoveX/MoveY program slots
  // beside its AMAL program (the 68k IDs them channel*4+mode, CreAMAL
  // +W.s:7998). The strings compile in TokAMAL's AniStos pass (+W.s:7483)
  // and run in the AmAnim/AmMvtX/AmMvtY executors (+W.s:8721/8749).
  stosSlots = new Map<number, { target: ChannelTarget; anim?: StosAnim; moveX?: StosMove; moveY?: StosMove }>()

  stosSlot(n: number): { target: ChannelTarget; anim?: StosAnim; moveX?: StosMove; moveY?: StosMove } {
    let s = this.stosSlots.get(n)
    if (!s) {
      s = { target: this.chanTargets.get(n) ?? this.makeChannelTarget('sprite', n) }
      this.stosSlots.set(n, s)
    }
    return s
  }

  private stepStos(): void {
    for (const s of this.stosSlots.values()) {
      const t = s.target
      const a = s.anim
      if (a && a.on && !a.frozen && !a.done && --a.left <= 0) {
        const [img, delay] = a.pairs[a.idx]!
        t.set(null, null, img)
        a.left = Math.max(1, delay)
        if (++a.idx >= a.pairs.length) {
          if (a.loop) a.idx = 0
          else a.done = true
        }
      }
      this.stepStosMove(s.moveX, t, 'x')
      this.stepStosMove(s.moveY, t, 'y')
    }
  }

  private stepStosMove(m: StosMove | undefined, t: ChannelTarget, axis: 'x' | 'y'): void {
    if (!m || !m.on || m.frozen || m.done) return
    if (!m.started) {
      // AmMvtX init: the leading number re-positions the object
      m.started = true
      if (m.start !== null) {
        if (axis === 'x') t.set(m.start, null, null)
        else t.set(null, m.start, null)
      }
    }
    if (--m.speedLeft > 0) return
    const g = m.groups[m.gi]
    if (!g) {
      m.done = true
      return
    }
    m.speedLeft = g[0]
    const cur = axis === 'x' ? t.get().x : t.get().y
    const next = ((cur + g[1]) << 16) >> 16
    if (axis === 'x') t.set(next, null, null)
    else t.set(null, next, null)
    // the L/E position is an equality trigger checked at every step
    // (cmp.w AmDeltY, StM0 +W.s:8782)
    if (m.endPos !== null && next === m.endPos) {
      this.stosLoopOrStop(m, t, axis)
      return
    }
    if (--m.countLeft <= 0) {
      m.gi++
      const ng = m.groups[m.gi]
      if (!ng) this.stosLoopOrStop(m, t, axis)
      else m.countLeft = ng[2] || 0x10000
    }
  }

  private stosLoopOrStop(m: StosMove, t: ChannelTarget, axis: 'x' | 'y'): void {
    if (!m.loop) {
      m.done = true
      return
    }
    // StML: re-apply the start position and restart the group list
    if (m.start !== null) {
      if (axis === 'x') t.set(m.start, null, null)
      else t.set(null, m.start, null)
    }
    m.gi = 0
    m.countLeft = m.groups[0]?.[2] || 0x10000
    m.speedLeft = m.groups[0]?.[0] ?? 1
  }
  /**
   * Characters collected so far by `Input$(n)`. FnInputD1 (+Lib.s:4695) is a
   * busy loop over Inkey, so the keyword itself does the collecting and the
   * statement re-runs each frame until it has n of them.
   */
  inputChars = ''
  /** line waiting to satisfy an Input statement */
  private pendingLine: string | null = null
  private promptShown = false
  /** what has been typed at the console since the Input prompt went up */
  private inputBuf = ''
  /** the console editor already echoed this line, so Input must not repeat it */
  private inputEchoed = false
  private frameBudget: number
  private onText: ((text: string) => void) | undefined

  constructor(lines: TokenLine[], table: TokenTable, opts: RuntimeOptions = {}) {
    this.frameBudget = opts.frameBudget ?? FRAME_DISPATCHES
    // before makeAllInstructions below: the ports' slot-qualified keywords are
    // bound from this
    this.extBindings = opts.extBindings ?? null
    // and before anything can reach a port's state: every port builds its own,
    // which is the `init` an extension's startup used to be fifteen field
    // initialisers on this class. EVERY port, not just the bound ones --
    // dispatch is by name, so a port's keywords are reachable whether or not
    // identify.ts placed it in a slot, and they must not find state missing.
    // AMCAF's Extreinit calls one of these again; see ./extimpl.ts.
    for (const impl of extensionImpls()) impl.init?.(this)
    // one composition point: the fs/audio/onText options are shorthand for
    // host members, and every default comes from defaultHost()
    this.host = { ...defaultHost(), ...opts.host }
    if (opts.machine) this.machine = opts.machine
    if (opts.fs) this.host.fs = opts.fs
    if (opts.audio) this.host.audio = opts.audio
    if (opts.onText) this.host.onText = opts.onText
    this.onText = this.host.onText
    const io: AmosIO = {
      write: (text) => {
        this.onText?.(text)
        this.screen.writeText(text)
      },
      locate: (x, y) => this.screen.locate(x, y),
      cls: () => this.screen.cls(),
      pen: (n) => {
        this.screen.setPenChecked(n)
      },
      paper: (n) => {
        this.screen.setPaperChecked(n)
      },
      input: (prompt) => {
        if (this.pendingLine !== null) {
          const line = this.pendingLine
          this.pendingLine = null
          this.promptShown = false
          // A line typed at the console is already on screen character by
          // character, so only the newline is owed. One submitted from
          // outside — runHeadless fast-forwarding, or a host calling
          // submitLine — still has to be shown.
          io.write((this.inputEchoed ? '' : line) + '\n')
          this.inputEchoed = false
          return line
        }
        if (!this.promptShown) {
          io.write(prompt)
          this.promptShown = true
        }
        return undefined
      },
    }
    const interpOpts: InterpOptions = {
      io,
      instructions: makeAllInstructions(this),
      functions: makeAllFunctions(this),
      rawFunctions: makeRawFunctions(this),
      input: this.input,
    }
    if (opts.extensions) interpOpts.extensions = opts.extensions
    if (opts.onUnimplemented) interpOpts.onUnimplemented = opts.onUnimplemented
    if (opts.maxSteps) interpOpts.maxSteps = opts.maxSteps
    this.interp = new Interp(lines, table, interpOpts)
    this.interp.onProgramPop = (host) => this.restoreProgramBanks(host)
    this.table = table
    this.fs = this.host.fs ?? null
    // the filesystem and the machine have to agree about what is in the
    // drives, and there is one answer: the drives themselves. Without this
    // `DF0:` would be a mount name again and a disk could be in the drive
    // and not on the device list. See ../amiga/trackdisk.ts.
    if (this.vfs) this.vfs.drives = this.machine.drives
    if (this.host.audio) this.audio = this.host.audio
    // one wire from CIA-A PRA bit 1 to Paula's filter, so the three ways of
    // reaching that bit -- `Led On`, `Change Led`, `Poke $BFE001` -- all
    // arrive. The first two used to call the sink themselves and the third
    // could not, because the register was not writable.
    this.machine.cia.onLed = (bright): void => this.audio.setFilter(bright)
    for (const bank of opts.banks ?? []) {
      if (bank.kind === 'sprites') this.spriteBank = ObjectBank.fromSpriteBank(bank)
      else if (bank.kind === 'icons') this.iconBank = ObjectBank.fromSpriteBank(bank)
      else if (bank.kind === 'memory') this.memBanks.set(bank.number, bank)
    }
    // the mouse bank comes up with the interpreter, before any screen —
    // LdMouse +B.s:2081 over a bank the binary already carries
    try {
      this.loadMouseBank(DEFAULT_MOUSE_BANK)
    } catch {
      /* a corrupt baked-in bank must not stop the interpreter booting */
    }
    // AMOS boots with screen 0: 320x200, 16 colours, lowres — with the
    // system flash on colour 3 (the boot cursor pulses out of the box)
    this.openScreen(0, 320, 200, 16, 0)
    this.installSystemFlash()
  }

  /**
   * A newly created sprite or icon bank, carrying the 32 palette words AMOS
   * always writes after the image table.
   *
   * Bnk.Ric2 (+Lib.s:8168) is the one routine that both creates and grows
   * these banks, and it always ends at the `.CPal` loop — `moveq #32-1,d0`,
   * thirty-two words copied from wherever `a0` points. Which is:
   *
   *   .ECop    growing an existing bank: the old bank's own palette, so a
   *            bank keeps what it had. Automatic here, the object survives.
   *   .PaCopy  creating one: `lea DefPal(a5),a0`, then overridden by
   *            `lea EcPal(a0),a0` off ScOnAd when a screen is open.
   *
   * So the palette is snapshotted once, at creation, from the *current*
   * screen — not from whichever screen a four-argument Get Bob is grabbing
   * out of — and later Gets never refresh it. That is what Get Bob Palette
   * and Get Icon Palette hand back.
   */
  newObjectBank(): ObjectBank {
    const b = new ObjectBank()
    const s = this.screens.get(this.currentIndex)
    if (s) {
      b.palette = Array.from(s.palette).slice(0, 32)
      return b
    }
    // no screen open: DefPal, which this port models as the sparse Default
    // Palette overrides sitting on top of the boot colours
    b.palette = DEFAULT_PALETTE.slice(0, 32)
    for (let i = 0; i < this.defaultPalette.length && i < 32; i++) {
      const c = this.defaultPalette[i]
      if (c !== undefined) b.palette[i] = c
    }
    return b
  }

  /** the sprite bank, created on demand (Get Bob into an empty bank) */
  needSpriteBank(): ObjectBank {
    this.spriteBank ??= this.newObjectBank()
    return this.spriteBank
  }

  /** Stamp an image into a screen's framebuffer (Paste Bob / Unpack / Load Iff). */
  blit(s: Screen, img: { width: number; height: number; pixels: Uint8Array }, dx: number, dy: number, opaque: boolean, planeMask = -1): void {
    // Mask Iff: -1 (all planes) unless a program restricted the load;
    // masking a pixel keeps the destination's bits outside the mask
    for (let y = 0; y < img.height; y++) {
      const ty = dy + y
      if (ty < 0 || ty >= s.height) continue
      for (let x = 0; x < img.width; x++) {
        const v = img.pixels[y * img.width + x]!
        if (!opaque && v === 0) continue
        const tx = dx + x
        if (tx < 0 || tx >= s.width) continue
        if (!s.inClip(tx, ty)) continue
        const old = s.point(tx, ty)
        s.putPixel(tx, ty, planeMask === -1 ? v : (old & ~planeMask) | (v & planeMask))
      }
    }
  }

  /** Mask Iff plane mask obeyed by Load Iff (IffMask; -1 = all planes) */
  iffMask = -1

  /** Serialise bank n as a standalone .Abk (AmBk memory / AmSp sprites /
   * AmIc icons) — the inverse of parseAmosFile for one bank */
  serializeBank(n: number): Uint8Array {
    if (n === 1 && this.spriteBank) return serializeObjectBank('AmSp', this.spriteBank)
    if (n === 2 && this.iconBank) return serializeObjectBank('AmIc', this.iconBank)
    const bank = this.memBanks.get(n)
    if (!bank) throw new AmosError('bank not reserved')
    return serializeMemoryBank(bank)
  }

  /** Save "file": all banks in an AmBs container (word count + banks) */
  serializeAllBanks(): Uint8Array {
    const parts: Uint8Array[] = []
    const nums = [...this.memBanks.keys()].sort((a, b) => a - b)
    let count = nums.length + (this.spriteBank ? 1 : 0) + (this.iconBank ? 1 : 0)
    if (this.spriteBank) parts.push(serializeObjectBank('AmSp', this.spriteBank))
    if (this.iconBank) parts.push(serializeObjectBank('AmIc', this.iconBank))
    for (const num of nums) parts.push(serializeMemoryBank(this.memBanks.get(num)!))
    const body = concatBytes(parts)
    const out = new Uint8Array(6 + body.length)
    out[0] = 0x41 // 'A'
    out[1] = 0x6d // 'm'
    out[2] = 0x42 // 'B'
    out[3] = 0x73 // 's'
    out[4] = (count >> 8) & 255
    out[5] = count & 255
    out.set(body, 6)
    return out
  }

  /** Grab a rectangle of a screen as a new bank image (Get Bob). */
  grab(s: Screen, x1: number, y1: number, x2: number, y2: number): BankImage {
    // Ritoune (+Lib.s:12711) makes the width x2-x1, and GetBob (+W.s:10011)
    // rounds it up to whole words -- `add.w #15,d4 / lsr.w #4,d4` -- because
    // the header stores a word count, not a pixel count. The odd pixels at
    // the right are blitted through BltMaskD, which is `not MCls[w and 15]`,
    // so they come out zero rather than carrying whatever was on the screen.
    // Get Bob 1,0,0 To 15,63 is therefore a 16-wide image, which is what
    // Change Mouse needs: MChange (+W.s) rejects any shape whose stored width
    // is not exactly one word.
    const req = Math.max(0, x2 - x1)
    const w = (req + 15) & ~15
    const h = Math.max(0, y2 - y1)
    const pixels = new Uint8Array(w * h)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < req; x++) {
        const v = s.point(x1 + x, y1 + y)
        pixels[y * w + x] = v < 0 ? 0 : v
      }
    }
    const depth = Math.max(1, Math.ceil(Math.log2(Math.max(2, s.nColors))))
    const img = new BankImage(w, h, depth, 0, 0)
    img.pixelsW().set(pixels)
    img.flush()
    return img
  }

  // ---- screens ----

  get screen(): Screen {
    const s = this.screens.get(this.currentIndex)
    if (!s) throw new AmosError(`screen not opened: ${this.currentIndex}`)
    return s
  }

  openScreen(n: number, w: number, h: number, nColors: number, mode: number): Screen {
    if (n < 0 || n > 7) throw new AmosError(`illegal screen number: ${n}`)
    // InScreenOpen (+Lib.s:8948): 4096 = HAM — lowres only, 6 planes,
    // stored as 64 colours with the CAMG bit; otherwise the colour count
    // must be exactly a power of two 2..64 (error 5, "illegal number of
    // colours"), and hires screens cap at 16 colours
    let colours = nColors
    let m = mode
    if (colours === 4096) {
      if (m & 0x8000) throw new AmosError('function call error')
      colours = 64
      m |= 0x800
    } else {
      /*
       * 256 is not AMOS's — `Screen Open` on a real Amiga stops at 64,
       * because AMOS predates AGA and never learned about it. It is here
       * for the extensions that DO drive eight bitplanes: AGA 1.0's `Aga
       * Screen Open` is 320x256x8, and Personnal's AGA icon bank works in
       * the same space. Nothing reaches this with 256 unless an extension
       * asked for it, so no AMOS program's error behaviour changes.
       */
      if (![2, 4, 8, 16, 32, 64, 256].includes(colours))
        throw new AmosError('illegal number of colours')
      if (m & 0x8000 && colours > 16) throw new AmosError('function call error')
    }
    const s = new Screen(n, Math.max(8, w), Math.max(8, h), colours, m)
    // Default Palette is a sparse override list — the mouse bank fills only
    // the sprite half (16-31), so unset entries must keep the boot colours
    for (let i = 0; i < this.defaultPalette.length && i < 32; i++) {
      const c = this.defaultPalette[i]
      if (c !== undefined) s.palette[i] = c
    }
    s.bobBracket = this.bobBracket
    this.screens.set(n, s)
    this.order = this.order.filter((i) => i !== n)
    this.order.push(n)
    this.currentIndex = n
    s.cls()
    // NOTE: no flash here — the low-level create (EcCall Cree) never
    // touches the flasher; only the Screen Open INSTRUCTION adds the
    // system flash (+Lib.s:8989), so Unpack/IFF/clone screens don't blink
    if (!this.autoView) {
      // Auto View Off: the display change is deferred until View
      s.visible = false
      this.pendingView.add(n)
    }
    return s
  }

  /**
   * Flash colour,seq — FlStart (+W.s:5303): the entry binds to the CURRENT
   * screen; an existing (colour, screen) entry is replaced, otherwise a
   * free slot is taken. A full table (FlMax=16 active flashes, checked
   * before the search) raises error 7 → "Too many colours in flash"
   * (EcWiErr maps code n to message 44+n, +Lib.s:12946/+Equ.s:799).
   * The 68k pokes counter=1 so the first vbl applies the first pair.
   */
  flashStart(reg: number, seq: Array<{ rgb: number; ticks: number }>): void {
    const scr = this.screens.get(this.currentIndex)
    if (!scr) throw new AmosError('screen not opened')
    this.flashes = this.flashes.filter((f) => this.screens.get(f.screen) === f.scr)
    const fl = this.flashes.find((f) => f.reg === reg && f.scr === scr)
    if (!fl && this.flashes.length >= 16) throw new AmosError('too many colours in flash')
    if (fl) this.flashes.splice(this.flashes.indexOf(fl), 1)
    this.flashes.push({ reg, screen: this.currentIndex, scr, seq, idx: -1, left: 1 })
  }

  /** Flash n,"" — flspoke with an empty string silently stops that colour
   * on the current screen (+W.s:5333-5339) */
  flashStop(reg: number): void {
    const scr = this.screens.get(this.currentIndex)
    this.flashes = this.flashes.filter((f) => !(f.reg === reg && f.scr === scr))
  }

  /** Flash Off — FlStop (+W.s:5285): stops the CURRENT screen's flashes
   * only; other screens' entries keep running */
  flashOff(): void {
    const scr = this.screens.get(this.currentIndex)
    this.flashes = this.flashes.filter((f) => f.scr !== scr)
  }

  /** the Screen Open instruction's `Flash 3` with config message 46 — the
   * out-of-the-box pulsing cursor colour. Errors (a full table) are
   * swallowed: InScreenOpen never checks EcCall Flash's return
   * (+Lib.s:8996 falls straight into ScOo4). */
  installSystemFlash(): void {
    try {
      this.flashStart(3, parseFlashSpec(DEFAULT_FLASH_SPEC)!)
    } catch {
      /* full flasher table — Screen Open ignores it */
    }
  }

  closeScreen(n: number): void {
    // closing either half of a dual-playfield pair dissolves that pair (EcDel)
    const closing = this.screens.get(n)
    if (closing?.dualPartner !== null && closing !== undefined) {
      const partner = this.screens.get(closing.dualPartner)
      if (partner) {
        partner.dualPartner = null
        partner.dualIsBack = false
        partner.visible = true // the hidden back half comes back into view
      }
    }
    this.screens.delete(n)
    this.order = this.order.filter((i) => i !== n)
    if (this.currentIndex === n) this.currentIndex = this.order[this.order.length - 1] ?? 0
  }

  setCurrent(n: number): void {
    if (!this.screens.has(n)) throw new AmosError(`screen not opened: ${n}`)
    this.currentIndex = n
  }

  toFront(n: number): void {
    if (!this.screens.has(n)) return
    this.order = this.order.filter((i) => i !== n)
    this.order.push(n)
  }

  toBack(n: number): void {
    if (!this.screens.has(n)) return
    this.order = this.order.filter((i) => i !== n)
    this.order.unshift(n)
  }

  /** collision detection and the =Col() bits — see collide.ts */
  readonly collide = new Collide(this)
  bobColCheck(n: number, first = -Infinity, last = Infinity): number {
    return this.collide.bobColCheck(n, first, last)
  }
  spriteColCheck(n: number, first = -Infinity, last = Infinity): number {
    return this.collide.spriteColCheck(n, first, last)
  }
  bobSpriteColCheck(n: number, first = 0, last = 63): number {
    return this.collide.bobSpriteColCheck(n, first, last)
  }
  spriteBobColCheck(n: number, first = 0, last = 10000): number {
    return this.collide.spriteBobColCheck(n, first, last)
  }
  hardcolData(): number {
    return this.collide.hardcolData()
  }
  hardcol(n: number): number {
    return this.collide.hardcol(n)
  }
  colGet(n: number): number {
    return this.collide.colGet(n)
  }

  /**
   * GZone (+W.s:11197) — 1-based index of the first zone of `s` containing
   * (x,y) in that screen's coordinates, 0 if none.
   *
   * The table is the SCREEN's (EcAZones), so the screen is the first
   * argument and not an implied global; `Zone(screen,x,y)` and
   * `Hzone(screen,x,y)` are the forms that ask for one other than the
   * current. First match wins and the walk is in table order.
   */
  zoneAt(s: Screen, x: number, y: number): number {
    for (let i = 0; i < s.zones.length; i++) {
      const z = s.zones[i]
      if (z && x >= z.x1 && y >= z.y1 && x <= z.x2 && y <= z.y2) return i + 1
    }
    return 0
  }

  /**
   * ZoEc (+W.s:11158) — a HARDWARE coordinate into `s`, then GZone.
   *
   * The bounds test is the part worth having in one place: the point must
   * land inside the screen's displayed window before the zone table is
   * consulted at all (`sub.w EcWx(a1),d1 / bcs`, `cmp.w EcWTx(a1),d1 / bcc`,
   * and the same pair in Y), and a miss is 0 rather than "no zone matched".
   *
   * SyCall ZoHd is a system vector, not a keyword, and four things reach it:
   * `Hzone` and `Mouse Zone` in the core, TURBO's `Hit Spr Zone` (routine 19,
   * `jsr $48(a0)` on T_SyVect) and Sticks' `Mouse Area`.
   */
  hardZoneAt(s: Screen, hx: number, hy: number): number {
    const x = s.hardToScreenX(hx)
    const y = s.hardToScreenY(hy)
    if (x < 0 || y < 0 || x >= s.width || y >= s.height) return 0
    return this.zoneAt(s, x, y)
  }

  // ---- input from the host ----

  /** Type a character (feeds Inkey$ / Wait Key). */
  pressKey(ch: string, scan = 0): void {
    // the shift byte (scancodes $60-$67 -> bits 0-7) is captured WITH the
    // keystroke; Inkey$ stores it in SScan for Scanshift (+Lib.s:13618)
    let shift = 0
    for (let i = 0; i < 8; i++) if (this.input.keys.has(0x60 + i)) shift |= 1 << i
    this.input.keyQueue.push({ ch, scan, shift })
    // deliberately NOT touching the serial register: this is "a character
    // arrived", which is one half of a key event. The register is latched by
    // keyDown/keyUp below, so that something typing into the queue does not
    // leave the hardware readers believing a key is still held down.
  }

  /**
   * The host reports a key going down or coming up.
   *
   * These exist because the queue above is not the whole keyboard: a key that
   * produces no character never reaches it, and a key coming back UP is not
   * an event it can express at all. The readers that go to CIA-A rather than
   * to AMOS — TURBO's Raw Key, JD's Jd Moff Key, Range's Key Scan — see both,
   * so the register is latched here, on the event, not on the character.
   */
  keyDown(scan: number): void {
    if (!scan) return
    this.machine.keyboard?.press(scan)
  }

  keyUp(scan: number): void {
    if (!scan) return
    this.machine.keyboard?.release(scan)
  }

  /** Submit a line for a pending Input statement. */
  submitLine(line: string): void {
    this.pendingLine = line
  }

  // ---- the clock ----

  /** Advance one 50Hz frame: release expired waits, run a slice. */
  /**
   * One vertical blank, then a slice of the program.
   *
   * NOTE: the extension hooks below are hand-written in a FIXED order and that
   * order is the machine's, not this file's convenience. Each one names where
   * its library installs itself — `VblRout[0]` and `[1]` for Jotre and Ercole
   * (+Equ.s:1177), VBLANK server priorities 9 and -40 for TURBO's two — and
   * they are interleaved with AMOS's own vbl work rather than grouped: the
   * replayers run before the shifts and fades, TURBO's scroll and starfield
   * after AMAL. Collecting them into a `vbl` hook on ExtensionImpl and
   * iterating would lose both facts, so they stay written out. A new port's
   * hook goes at the position its library's own priority puts it.
   */
  frame(): RunResult {
    this.interp.tick++
    this.frames++
    // MusInt is the first VBL routine (Mus_Cold +Music.s:848)
    this.music.vbl()
    // MED 7.1 drives its own copy of the replayer, off its own module rather
    // than off bank 3 — medplayer.library installs a separate interrupt
    this.medExt?.player?.vbl()
    // AMCAF's ProTracker: routines 376/377 install a VBL or a CIA server,
    // and both land here — see amcafPtVbl for what the CIA arm costs
    amcafPtVbl(this)
    // P61 1.2's replayer — the same engine, off a packed module
    p61Vbl(this)
    // MusiCRAFT's is an exec VERTB server at priority 0 rather than an AMOS
    // VblRout slot, so it runs behind AMOS's own music — which is what lets it
    // have the last word on the vumeter bytes AMOS just wrote
    musicraftVbl(this)
    // the Omega player is an ordinary AMOS VblRout entry in the same library
    // as AMOS's own music, so it runs in front of nothing and behind nothing
    musicOmegaVbl(this)
    // Ercole's Prop On puts its POT sampler in VblRout[1] (+Equ.s:1177)
    ercoleVbl(this.ercole)
    // Jotre's replayer interrupt is VblRout[0], gated on BOTH its flag bits
    jotreVbl(this.jotre)
    // THX 0.6 takes the FIRST free VblRout slot rather than a fixed one, and
    // its hook gates on one flag --- see thx.ts on the nine-slot search
    thxVbl(this.thx)
    dmeVbl(this)
    // Personnal's `Omd Play` is octaplayer, whose tick is a DMA buffer
    personnalVbl(this)
    // The Game's tracker keywords are ptreplay.library, which runs off a CIA
    // timer on the machine and off the frame here -- see thegame.ts
    thegameVbl(this)
    // TFT's own VBL server, when a program has armed it with Start Int
    tftVbl(this.tft)
    // GameSupport's cold start puts its hook in VblRout[0] and never removes
    // it; this is the part that accumulates port 0's mouse counters
    gamesupportVbl(this)
    // SLN's cold start takes the first FREE VblRout slot rather than slot 0,
    // and leaves anyone else's hook alone; the mouse counters are its first job
    slnVbl(this)
    this.applyShifts()
    this.applyFades()
    this.applyFlashes()
    // the copper rebuild runs at the vbl (EcCopper via T_Actualise), so
    // Rainbow-instruction changes latch here — consecutive same-frame
    // Rainbow calls coalesce their RnAct bits, exactly as on the Amiga.
    // While the system copper is on, the real word list is regenerated
    // and swapped so Cop Logic readers see it; Copper Off freezes it.
    if (this.copperOn) this.buildCopperList()
    else this.activateRainbows()
    // Limit Mouse clamp (LimitMEc, run at the vbl)
    if (this.mouseLimit) {
      const m = this.mouseLimit
      this.input.mouseX = Math.max(m.x1, Math.min(m.x2, this.input.mouseX))
      this.input.mouseY = Math.max(m.y1, Math.min(m.y2, this.input.mouseY))
    }
    if (!this.synchroManual) this.stepAmal()
    // TURBO adds its own servers to the VBLANK chain: the blitter scroll at
    // priority 9, the starfield at -40, so they run in that order and after
    // AMOS's own vertical blank work
    blitVbl(this)
    starsVbl(this)
    // Stars 2.33 installs its own VBL server ($1ca); it runs after TURBO's
    // because nothing orders the two and this keeps the existing chain fixed
    starfieldVbl(this)
    this.unblock()
    let result: RunResult
    if (!this.interp.done && this.interp.blocked === null) {
      result = this.interp.run(this.frameBudget)
    } else {
      result = { status: this.interp.done ? 'ended' : 'blocked', steps: 0, unimplemented: this.interp.unimplemented }
    }
    if (this.bobUpdateOn && this.interp.tick % this.updateEvery === 0) this.updateBobs()
    this.stepIntuition()
    this.stepMenus()
    this.stepDialogs()
    this.stepFsel()
    this.stepReadText()
    // The frame is over, so the sound in it is too: a rendering sink runs out
    // to here and starts the next frame at this instant. Last rather than
    // beside the replayers because the interpreter has just run, and a program
    // calling Sam Play or Volume writes Paula from inside the frame, not
    // before it. See AudioSink.runTo.
    this.audio.runTo?.(this.frames / VBL_HZ)
    return result
  }

  /** the menu interaction (MnGere +Lib.s:15811), one iteration per frame */
  private stepMenus(): void {
    const t = this.menu
    const rmb = (this.input.mouseK & 2) !== 0
    const s = this.screens.get(t.screenNb >= 0 ? t.screenNb : this.currentIndex) ?? this.screens.get(this.currentIndex) ?? null
    if (!t.on || t.roots.length === 0 || !s) {
      if (this.menuOpen && s) this.closeMenu(s)
      return
    }
    if (!this.menuOpen) this.menuKeys()
    if (rmb && !this.menuOpen) {
      // open: recompute if dirty, origin = base or the mouse (Menu Mouse On)
      if (t.change) menuCalc(t)
      const m = this.mouseOnScreen(s)
      const ox = t.mouse ? m.x : t.baseX
      const oy = t.mouse ? m.y : t.baseY
      this.menuOpen = {
        levels: [{ lvl: drawMenuBranch(t.roots, s, this.menuHost, ox, oy), parent: null }],
        hover: [],
        active: null,
        activeLevel: -1,
      }
    }
    const open = this.menuOpen
    if (rmb && open) {
      // per-frame: Called items redraw, hover tracking, submenu cascade
      for (const { lvl } of open.levels) {
        for (const n of lvl.list) if (n.called) drawMenuCell(n, s, this.menuHost, n === open.active)
      }
      const m = this.mouseOnScreen(s)
      let found: MenuNode | null = null
      let foundLevel = -1
      for (let i = open.levels.length - 1; i >= 0; i--) {
        const z = menuZoneAt(open.levels[i]!.lvl, m.x, m.y)
        if (z) {
          found = z
          foundLevel = i
          break
        }
      }
      if (found && found !== open.active) {
        while (open.levels.length > foundLevel + 1) {
          const l = open.levels.pop()!
          restoreRect(s, l.lvl.bounds, l.lvl.saved)
        }
        open.hover.length = foundLevel
        const old = open.hover[foundLevel]
        if (old && old !== found) drawMenuCell(old, s, this.menuHost, false)
        open.hover[foundLevel] = found
        open.active = found
        open.activeLevel = foundLevel
        drawMenuCell(found, s, this.menuHost, true)
        if (found.children.length > 0 && open.levels.length < 8) {
          const right = (found.flags & MF_BAR) !== 0
          const cx = right ? found.xx + found.tx + 3 : found.xx - 2
          const cy = right ? found.yy - 2 : found.yy + found.ty + 3
          open.levels.push({ lvl: drawMenuBranch(found.children, s, this.menuHost, cx, cy), parent: found })
        }
      } else if (!found && open.active) {
        // moved off every cell: the active highlight clears (abort state)
        drawMenuCell(open.active, s, this.menuHost, false)
        open.active = null
        open.activeLevel = -1
      }
      // LMB drags movable items/levels (MnBGoch; final position, no band)
      const lmb = (this.input.mouseK & 1) !== 0
      if (lmb && !this.menuDrag) {
        if (open.active && open.active.flags & MF_BOUGE) {
          this.menuDrag = { kind: 'item', node: open.active, level: open.activeLevel, mx: m.x, my: m.y }
        } else if (foundLevel >= 0 && open.levels[foundLevel]!.lvl.list.some((n) => n.flags & MF_TBOUGE)) {
          this.menuDrag = { kind: 'level', node: null, level: foundLevel, mx: m.x, my: m.y }
        }
      }
      const drag = this.menuDrag
      if (drag && lmb) {
        const dx = m.x - drag.mx
        const dy = m.y - drag.my
        if (dx !== 0 || dy !== 0) {
          drag.mx = m.x
          drag.my = m.y
          while (open.levels.length > drag.level + 1) {
            const l = open.levels.pop()!
            restoreRect(s, l.lvl.bounds, l.lvl.saved)
          }
          open.hover.length = drag.level
          open.active = null
          open.activeLevel = -1
          const lvl = open.levels.pop()!
          restoreRect(s, lvl.lvl.bounds, lvl.lvl.saved)
          let ox = lvl.lvl.ox
          let oy = lvl.lvl.oy
          if (drag.kind === 'item' && drag.node) {
            drag.node.x += dx
            drag.node.y += dy
            drag.node.flags |= MF_FIXED
          } else {
            ox += dx
            oy += dy
            if (drag.level === 0 && !t.mouse) {
              t.baseX += dx
              t.baseY += dy
            }
          }
          open.levels.push({ lvl: drawMenuBranch(lvl.parent ? lvl.parent.children : t.roots, s, this.menuHost, ox, oy), parent: lvl.parent })
        }
      }
      if (!lmb) this.menuDrag = null
    } else if (!rmb && open) {
      this.menuDrag = null
      // release (MnExit 15975): commit or abort, then restore backgrounds
      t.choix.fill(0)
      t.choice = 0
      if (open.active) {
        for (let i = 1; i <= open.activeLevel; i++) t.choix[i - 1] = open.levels[i]!.parent!.nb
        t.choix[open.activeLevel] = open.active.nb
        t.choice = -1
      }
      this.closeMenu(s)
      if (t.choice === -1 && this.onMenu?.armed) this.dispatchOnMenu(t.choix[0]! - 1)
    }
  }

  private closeMenu(s: Screen): void {
    const open = this.menuOpen
    if (!open) return
    for (let i = open.levels.length - 1; i >= 0; i--) {
      const l = open.levels[i]!
      restoreRect(s, l.lvl.bounds, l.lvl.saved)
    }
    this.menuOpen = null
  }

  /** keyboard shortcuts fire selections without opening (MenuKeyExplore 17684) */
  private menuKeys(): void {
    if (this.input.keyQueue.length === 0) return
    const t = this.menu
    const match = (list: MenuNode[], path: number[]): number[] | null => {
      for (const n of list) {
        if (n.children.length > 0) {
          const r = match(n.children, [...path, n.nb])
          if (r) return r
          continue
        }
        if (n.key.kind === 0) continue
        for (let qi = 0; qi < this.input.keyQueue.length; qi++) {
          const q = this.input.keyQueue[qi]!
          const want = n.key.asc >= 97 && n.key.asc <= 122 ? n.key.asc - 32 : n.key.asc
          const hit = n.key.kind === 1 ? q.ch.toUpperCase().charCodeAt(0) === want : q.scan === n.key.scan
          if (hit) {
            this.input.keyQueue.splice(qi, 1)
            return [...path, n.nb]
          }
        }
      }
      return null
    }
    const r = match(t.roots, [])
    if (r) {
      t.choix.fill(0)
      r.forEach((nb, i) => (t.choix[i] = nb))
      t.choice = -1
      if (this.onMenu?.armed) this.dispatchOnMenu(r[0]! - 1)
    }
  }

  private dispatchOnMenu(menuIdx: number): void {
    const h = this.onMenu
    if (!h || this.interp.done) return
    const target = h.targets[menuIdx] ?? h.targets[0]
    if (target === undefined) return
    this.interp.blocked = null // menu selections wake waits
    if (h.kind === 'proc') {
      this.interp.callProc(target, [])
    } else {
      this.interp.gosubs.push({ addr: { li: this.interp.pc.li, ti: this.interp.pc.ti }, loopBase: this.interp.loops.length })
      this.interp.jumpLabel(target)
    }
  }

  /**
   * The console line editor an `Input` is waiting on.
   *
   * AMOS reads Input at the console cursor, echoing as you type — there is no
   * separate box to focus, and that is the whole point: the program's prompt,
   * the cursor and what you type are all on the AMOS screen. Keys arrive
   * through the same queue Inkey$ reads, so a headless test drives this with
   * `pressKey` exactly as the browser does.
   *
   * Return submits, backspace rubs out the last character (and puts a space
   * over it, because the console's own backspace only steps the cursor left).
   * Anything below space that is not one of those is dropped rather than
   * echoed as a control glyph.
   */
  private editInputLine(): void {
    const q = this.input.keyQueue
    while (q.length > 0) {
      const k = q[0]!
      if (k.ch === '\r' || k.ch === '\n') {
        q.shift()
        // the characters are already on screen; Input writes the newline
        this.inputEchoed = true
        this.submitLine(this.inputBuf)
        this.inputBuf = ''
        return
      }
      if (k.ch === '\x08') {
        q.shift()
        if (this.inputBuf.length > 0) {
          this.inputBuf = this.inputBuf.slice(0, -1)
          this.interp.io.write('\x08 \x08')
        }
        continue
      }
      if (k.ch.length !== 1 || k.ch < ' ') {
        q.shift()
        continue
      }
      q.shift()
      this.inputBuf += k.ch
      this.interp.io.write(k.ch)
    }
  }

  private unblock(): void {
    const b = this.interp.blocked
    if (b === null) return
    if (b.type === 'input' && this.pendingLine === null) this.editInputLine()
    if (b.type === 'wait' && this.interp.tick >= b.until) this.interp.blocked = null
    else if (b.type === 'waitKey' && this.input.keyQueue.length > 0) {
      this.input.keyQueue.shift()
      this.interp.blocked = null
    } else if (b.type === 'waitInput') {
      // the JD waiters: a button, a key from an allowed set, or either. The
      // statement re-runs on resume (block(..., true)), so the keyword itself
      // reads the live state and answers — nothing is consumed here except
      // the keystroke, as Wait Key consumes one.
      const btn = b.mouse && this.input.mouseK !== 0
      const keyed =
        b.key &&
        this.input.keyQueue.length > 0 &&
        (b.keys === undefined || b.keys === '' || b.keys.includes(this.input.keyQueue[0]!.ch)) &&
        (b.amiga !== true || (this.input.keys.has(0x66) || this.input.keys.has(0x67)))
      // the hardware waiters: any new byte from the keyboard, press or release
      const clocked = b.sdr !== undefined && this.input.sdr !== b.sdr
      if (btn || keyed || clocked) this.interp.blocked = null
    } else if (b.type === 'input' && this.pendingLine !== null) this.interp.blocked = null
    else if (b.type === 'dialog') {
      const d = this.dialogs.get(b.channel)
      if (!d || d.runState === 'done') this.interp.blocked = null
    } else if (b.type === 'fsel') {
      if (!this.fsel || this.fsel.done) this.interp.blocked = null
    } else if (b.type === 'readtext') {
      if (!this.readText || this.readText.done) this.interp.blocked = null
    } else if (b.type === 'iconify') {
      // one poll a frame: the keyword re-runs, calls Eliconify Test itself
      // and blocks again if the window has said nothing yet
      this.interp.blocked = null
    } else if (b.type === 'speech') {
      // ensureLib started the import; wake as soon as it lands, either way
      if (ensureLib(this) || this.speech.failed) this.interp.blocked = null
    }
  }

  private applyFades(): void {
    for (const [n, fade] of this.fades) {
      const s = this.screens.get(n)
      if (!s) {
        this.fades.delete(n)
        continue
      }
      if (++fade.count < fade.delay) continue
      fade.count = 0
      let busy = false
      for (let i = 0; i < 32; i++) {
        const target = fade.targets[i]!
        if (target < 0) continue
        let v = s.palette[i]!
        let out = 0
        for (const shift of [8, 4, 0]) {
          const cur = (v >> shift) & 15
          const want = (target >> shift) & 15
          const next = cur === want ? cur : cur < want ? cur + 1 : cur - 1
          if (next !== want) busy = true
          out |= next << shift
        }
        s.palette[i] = out
      }
      if (!busy) this.fades.delete(n)
    }
  }

  private applyFlashes(): void {
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const fl = this.flashes[i]!
      // entry for a closed/replaced screen: the 68k would write into
      // freed memory — drop it
      if (this.screens.get(fl.screen) !== fl.scr) {
        this.flashes.splice(i, 1)
        continue
      }
      if (--fl.left > 0) continue
      fl.idx = (fl.idx + 1) % fl.seq.length
      const step = fl.seq[fl.idx]!
      fl.left = step.ticks
      // FlInt writes EcPal of the screen recorded at Flash time, not
      // whichever screen is current now (+W.s:5700)
      fl.scr.palette[fl.reg & 31] = step.rgb & 0xfff
    }
  }

  private applyShifts(): void {
    for (const [n, sh] of this.shifts) {
      const s = this.screens.get(n)
      if (!s) continue
      if (++sh.count < sh.delay) continue
      sh.count = 0
      const { first, last } = sh
      if (last <= first) continue
      // wrap = cycle (write the wrapped end); !wrap = smear (skip it, Shf8a)
      if (sh.dir > 0) {
        const tmp = s.palette[last]!
        for (let i = last; i > first; i--) s.palette[i] = s.palette[i - 1]!
        if (sh.wrap) s.palette[first] = tmp
      } else {
        const tmp = s.palette[first]!
        for (let i = first; i < last; i++) s.palette[i] = s.palette[i + 1]!
        if (sh.wrap) s.palette[last] = tmp
      }
    }
  }

  /**
   * Drive frames headless until the program ends. Blocking states are
   * fast-forwarded: waits jump the clock, Wait Key gets a Return, Input
   * gets an empty line.
   */
  runHeadless(maxFrames = 5_000): { status: RunResult['status']; frames: number; unimplemented: Map<string, number> } {
    let frames = 0
    let status: RunResult['status'] = 'paused'
    while (frames < maxFrames) {
      frames++
      const r = this.frame()
      status = r.status
      if (status === 'ended' || status === 'stopped' || status === 'maxSteps') break
      const b = this.interp.blocked
      if (b?.type === 'wait' && Number.isFinite(b.until)) this.interp.tick = Math.max(this.interp.tick, b.until - 1)
      else if (b?.type === 'waitKey') this.pressKey('\r', 0x44)
      else if (b?.type === 'input') this.submitLine('')
      else if (b?.type === 'dialog') {
        const d = this.dialogs.get(b.channel)
        if (d && d.runState === 'waiting') this.finishDialogRun(d, 0)
        else this.interp.blocked = null
      } else if (b?.type === 'fsel') {
        // a close already under way keeps its result; the animation is what
        // headless skips, not the outcome
        if (this.fsel && !this.fsel.done) this.finishFselNow(this.fsel.closing ?? '')
        else this.interp.blocked = null
      } else if (b?.type === 'readtext') {
        if (this.readText && !this.readText.done) this.finishReadTextNow(this.readText.closing ?? '')
        else this.interp.blocked = null
      } else if (b?.type === 'iconify') {
        // nobody is going to click the close gadget headless, so press it —
        // through the real gadget path, so the message carries the
        // coordinates Eliconify Test filters on. Answers 0, which is what a
        // user de-iconifying normally does.
        const w = this.easylife?.iconWindow
        if (!w) this.interp.blocked = null
        else {
          const int = this.intuition
          int.handleInput(w.screenSlot, w.leftEdge + 2, w.topEdge + 2, 1)
          int.handleInput(w.screenSlot, w.leftEdge + 2, w.topEdge + 2, 0)
        }
      }
    }
    return { status, frames, unimplemented: this.interp.unimplemented }
  }

  // ---- video out (src/runtime/display.ts) ----

  /**
   * The copper list, the compositor, bobs and hardware sprites.
   *
   * These eight are the display's whole entry surface: five are reached from
   * elsewhere in this class, and composite / clearBobs / resolveScreenId /
   * spriteChannels / updateBobs from other files. Everything else that module
   * does is private to it.
   */
  readonly display = new Display(this)

  /** re-exported so player.ts and the tests keep one name for the geometry */
  static readonly COMPOSITE_TOP = Display.COMPOSITE_TOP
  static readonly COMPOSITE_LINES = Display.COMPOSITE_LINES

  buildCopperList(): void {
    this.display.buildCopperList()
  }
  composite(out?: Uint8ClampedArray): { width: number; height: number; data: Uint8ClampedArray } {
    return this.display.composite(out)
  }
  updateBobs(): void {
    this.display.updateBobs()
  }
  clearBobs(): void {
    this.display.clearBobs()
  }
  /**
   * Mark a bob for removal, and say how many update passes that takes.
   *
   * The count is `BbDecor`, which `ResBOB` (+W.s:975) sets to 1, to 2 when
   * the screen is double buffered, and to 0 for a `Set Bob n,-1` --- and
   * which `BbDel` counts down. Zero frees on the first pass: `subq.w #1` on
   * zero borrows, so the `bhi` that keeps the bob alive is not taken.
   *
   * DEVIATION: the count is taken now rather than at the bob's creation. A
   * bob made before `Double Buffer` has BbDecor 1 on the machine and would
   * keep one background for a screen with two, which this port cannot
   * represent --- its saves are keyed by buffer, so it always has both.
   */
  stopBob(b: Bob): void {
    if (b.off !== undefined) return
    const mode = this.bobModes.get(b.n) ?? 0
    b.off = mode < 0 ? 0 : this.screens.get(b.screen)?.doubleBuffered ? 2 : 1
  }
  /**
   * A screen's TAbk1/TAbk4 pair, handed to every Screen this runtime opens.
   *
   * TAbk1 (+W.s:3577) is `bsr WVbl / bsr BobEff` and TAbk4 (+W.s:3642) is
   * `bsr BobAct / bsr BobAff`, so a drawing keyword sees a screen with no
   * bobs on it and the bobs re-save afterwards.
   *
   * DEVIATION: TAbk1's `WVbl` is not modelled. A Print on a double buffered
   * screen costs AMOS two vertical blanks --- one here and one in TAbk2B ---
   * which is a large part of why the Sprites_v_Bobs tutorial calls bobs
   * "considerably slower". Waiting here would be faithful and would also
   * halve the frame rate of every program that prints, so the cost is left
   * to the ordinary instruction budget for now.
   */
  readonly bobBracket = (op: () => void): void => {
    if (this.bobs.size === 0) {
      op()
      return
    }
    this.clearBobs()
    try {
      op()
    } finally {
      this.updateBobs()
    }
  }
  resolveScreenId(id: number, write = false): { s: Screen; buf: Uint8Array } {
    return this.display.resolveScreenId(id, write)
  }
  spriteChannels(sprites: HwSprite[]): Map<number, number> {
    return this.display.spriteChannels(sprites)
  }
  activateRainbows(): void {
    this.display.activateRainbows()
  }
  frontAt(L: number): Screen | null {
    return this.display.frontAt(L)
  }

}

/** dialog SP pattern number → fill rows (0 solid, <0 sprite image,
 * >0 machine mouse-bank pattern) */
function resolveDialogPattern(rt: Runtime, n: number): Uint16Array | null {
  if (n === 0) return null
  if (n < 0) {
    const img = rt.spriteBank?.image(-n)
    if (!img) return null
    const rows = Math.min(16, img.height)
    const bits = new Uint16Array(rows)
    for (let y = 0; y < rows; y++) {
      let row = 0
      for (let x = 0; x < Math.min(16, img.width); x++) {
        if (img.pixels[y * img.width + x] !== 0) row |= 1 << (15 - x)
      }
      bits[y] = row
    }
    return bits
  }
  return rt.systemPattern(n)
}

/** join byte chunks into one Uint8Array */
function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let off = 0
  for (const p of parts) {
    out.set(p, off)
    off += p.length
  }
  return out
}

/** serialise a memory bank as AmBk (the inverse of parseMemoryBank) */
function serializeMemoryBank(bank: MemoryBank): Uint8Array {
  const name = (bank.name + '        ').slice(0, 8)
  const out = new Uint8Array(4 + 2 + 2 + 4 + 8 + bank.data.length)
  const v = new DataView(out.buffer)
  out[0] = 0x41 // A
  out[1] = 0x6d // m
  out[2] = 0x42 // B
  out[3] = 0x6b // k
  v.setUint16(4, bank.number)
  v.setUint16(6, bank.memType)
  // low 28 bits = data length + 8 (the name), high byte = flags
  v.setUint32(8, ((bank.flags & 0xff) << 24) | ((bank.data.length + 8) & 0x0fffffff))
  for (let i = 0; i < 8; i++) out[12 + i] = name.charCodeAt(i)
  out.set(bank.data, 20)
  return out
}

/** serialise a sprite/icon ObjectBank as AmSp/AmIc, re-encoding each
 * image's chunky pixels back to planar (inverse of decodeSprite) */
function serializeObjectBank(magic: 'AmSp' | 'AmIc', bank: ObjectBank): Uint8Array {
  const parts: Uint8Array[] = []
  const head = new Uint8Array(6)
  head[0] = magic.charCodeAt(0)
  head[1] = magic.charCodeAt(1)
  head[2] = magic.charCodeAt(2)
  head[3] = magic.charCodeAt(3)
  new DataView(head.buffer).setUint16(4, bank.images.length)
  parts.push(head)
  for (const img of bank.images) {
    // the image's OWN geometry, which is the bank's (width >> 4), not the
    // screen's ceil(width/16) — writing the other one would change the bytes
    const widthWords = img.rowBytes >> 1
    const hdr = new Uint8Array(10)
    const hv = new DataView(hdr.buffer)
    hv.setUint16(0, widthWords)
    hv.setUint16(2, img.height)
    hv.setUint16(4, img.depth)
    hv.setUint16(6, img.hotX)
    hv.setUint16(8, img.hotY)
    parts.push(hdr)
    // The planes as they are, not re-derived from chunky. A bank that is
    // loaded and saved untouched now comes back byte for byte, where the
    // round trip through chunky could only promise "equivalent" — the padding
    // bits past the width had nowhere to survive.
    parts.push(img.planeBytes())
  }
  const pal = new Uint8Array(64)
  const pv = new DataView(pal.buffer)
  for (let i = 0; i < 32; i++) pv.setUint16(i * 2, bank.palette[i] ?? 0)
  parts.push(pal)
  return concatBytes(parts)
}

/** the code hunk of an AmigaDOS load-file (Pload / diskfont): skip the
 * HUNK_HEADER, find HUNK_CODE ($3E9), return its bytes; null if not one */
export function extractCodeHunk(bytes: Uint8Array): Uint8Array | null {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.length < 8 || v.getUint32(0) !== 0x3f3) return null
  let p = 8
  const tableSize = v.getUint32(p)
  p += 12 + tableSize * 4
  if (p + 8 > bytes.length || v.getUint32(p) !== 0x3e9) return null
  const len = v.getUint32(p + 4) * 4
  const base = p + 8
  if (base + len > bytes.length) return null
  return bytes.slice(base, base + len)
}
