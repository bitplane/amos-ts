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
import { newPiConfig } from './piconfig.gen'
import type { PiConfig } from './piconfig.gen'
import { parseAmalBank } from '../loader/amalbank'
import type { AmalBank } from '../loader/amalbank'
import { isResourceBankName, parseResourceBank } from '../loader/resource'
import type { ResourceBank } from '../loader/resource'
import { Screen, builtinPattern, sliderMetrics } from './screen'
import { makeInstructions, makeFunctions, makeRawFunctions } from './instr'
import { ObjectBank, imagesCollide } from './objects'
import type { BankImage, Bob, HwSprite, Zone } from './objects'
import type { AmosFS } from './fs'
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
import { NullAudio, parseSampleBank, periodToHz, samPeriod } from './audio'
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
import { FONT8 } from './font.gen'
import type { AudioSink, SampleEntry } from './audio'
import { AmigaFS, amigaPattern } from './vfs'

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

/** the default cursor shape: an underline (DefCurs +W.s:16736) */
export const CURSOR_SHAPE = [0, 0, 0, 0, 0, 0, 0xff, 0xff]

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

export interface RuntimeOptions {
  extensions?: Map<number, TokenTable>
  onUnimplemented?: 'throw' | 'skip'
  maxSteps?: number
  /** statements executed per frame() before yielding (default 20000) */
  frameBudget?: number
  /** mirror of all console text output (for transcripts/CLIs) */
  onText?: (text: string) => void
  /** resource banks from the .AMOS file */
  banks?: Bank[]
  /** file provider for Load Iff etc. */
  fs?: AmosFS
  /** sound output (default: recording NullAudio) */
  audio?: AudioSink
}

/**
 * The "virtual Amiga": owns the interpreter, the screens, the 50Hz clock
 * and the input devices. Drive it by calling frame() fifty times a second
 * (or in a tight loop headless).
 */
export class Runtime {
  readonly interp: Interp
  readonly input: InputState = newInputState()
  screens = new Map<number, Screen>()
  /** z-order, back to front */
  order: number[] = []
  currentIndex = 0
  rainbows = new Map<number, Rainbow>()
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
  bobs = new Map<number, Bob>()
  hwSprites = new Map<number, HwSprite>()
  /** bob pipeline: auto update each frame (Bob Update On/Off) */
  bobUpdateOn = true
  /** saved background under each drawn bob, restored before redraw */
  private bobSaved = new Map<number, { screen: number; x: number; y: number; w: number; h: number; data: Uint8Array }>()
  /** Set Bob background modes: 0 save/restore, <0 none, >0 fill colour-1 */
  /**
   * The simulated machine's memory pools, in bytes. AvailMem has no meaning
   * without a real allocator, but returning a constant is worse than useless:
   * a program that reserves banks until Chip Free runs out never stops. These
   * are an A1200's 2MB chip plus a modest fast board — generous enough that
   * "have I room for this?" checks pass, while still responding to what the
   * program actually allocates.
   */
  static readonly CHIP_TOTAL = 2 * 1024 * 1024
  static readonly FAST_TOTAL = 8 * 1024 * 1024
  /**
   * The nominal BASIC variable region Free reports against (TabBas-HiChaine).
   * AMOS Pro's default buffer is 32K, grown by Set Buffer.
   */
  static readonly VARIABLE_SPACE = 32 * 1024

  bobModes = new Map<number, number>()
  /**
   * Set Bob's `planes` argument: the bitplane write mask (BbAPlan, set by
   * ResBOB +W.s:998 and handed to the blitter as BbDAPlan at +W.s:1271).
   * Omitted means -1, every plane.
   */
  bobPlanes = new Map<number, number>()
  /** Limit Bob rectangles: global (key -1) or per bob */
  bobLimits = new Map<number, { x1: number; y1: number; x2: number; y2: number }>()
  priorityReverse = false
  zones: Array<Zone | null> = []
  /** objects hit by the last Bob Col/Sprite Col, read by Col() */
  colSet = new Set<number>()
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
      tick: () => rt.interp.tick,
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
  fileChans = new Map<
    number,
    {
      mode: 'in' | 'out' | 'random'
      path: string
      data: Uint8Array
      pos: number
      out: number[]
      /** Field record layout (InField +ILib.s:4769) */
      fields?: Array<{ len: number; get: () => string; set: (v: string) => void }>
      recSize?: number
      /** file size, snapshotted at Field time, grown by Put */
      fileSize?: number
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
   * The interpreter configuration block (PI_*, +Equ.s:1590-1650, defaults
   * from +Interpreter_Config.s). Editable defaults rather than constants:
   * the file selector stores its Sort/Size/Store toggles and its window
   * position back here when it closes (Fs_Close +Lib.s:18469), so they
   * persist from one call to the next within a session.
   */
  pi: PiConfig = newPiConfig()
  static readonly COPPER_LONG = 12 * 1024
  /** T_CopON: the system rebuilds and owns the display while true */
  copperOn = true
  copBufA = new Uint8Array(Runtime.COPPER_LONG)
  copBufB = new Uint8Array(Runtime.COPPER_LONG)
  private copLogIsA = true
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
  private copRegs = {
    pal: new Uint16Array(32),
    dmaOn: false,
    hires: false,
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
  private seedCopperRegs(): void {
    const r = this.copRegs
    r.pal.fill(0)
    r.pal[0] = this.colourBack & 0xfff
    r.dmaOn = false
    r.hires = false
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

  private resolveInto(addr: number, write: boolean): { data: Uint8Array; off: number } | null {
    const a = addr >>> 0
    if (a >= 0xdff004 && a < 0xdff008) {
      // VPOSR/VHPOSR beam counters, synthesized from the pseudo-beam
      const line = this.interp.beamLine()
      const vh = this.interp.beamWord()
      // VPOSR: V8 in bit 0 of the low byte; VHPOSR: V7-0 / H8-1
      const b = Uint8Array.of(0, (line >> 8) & 1, (vh >> 8) & 0xff, vh & 0xff)
      return { data: b, off: a - 0xdff004 }
    }
    if (a >= Runtime.MUBASE_ADDR && a < Runtime.MUBASE_ADDR + 4) {
      // =Mubase points at the music extension data zone; the vumeter
      // bytes at MB+0..3 are the mapped part (FnMusicBase +Music.s:3907)
      return { data: this.vuBytes, off: a - Runtime.MUBASE_ADDR }
    }
    if (a >= Runtime.VAR_BASE && a < this.varArenaNext) {
      return this.resolveVarSlot(a)
    }
    const temp = this.tempBuffer
    if (temp && a >= Runtime.TEMP_BUFFER_BASE && a < Runtime.TEMP_BUFFER_BASE + temp.length) {
      return { data: temp, off: a - Runtime.TEMP_BUFFER_BASE }
    }
    for (const [kind, base] of [
      ['sprites', Runtime.SPRITE_BANK_BASE],
      ['icons', Runtime.ICON_BANK_BASE],
    ] as Array<['sprites' | 'icons', number]>) {
      if (a >= base && a < base + 0x04000000) {
        const img = this.objectBankImage(kind)
        if (!img || a - base >= img.length) return null
        return { data: img, off: a - base }
      }
    }
    if (a >= Runtime.COPPER_BASE && a < Runtime.COPPER_BASE + 2 * Runtime.COPPER_SLOT) {
      const rel = a - Runtime.COPPER_BASE
      const buf = rel < Runtime.COPPER_SLOT ? this.copBufA : this.copBufB
      const off = rel % Runtime.COPPER_SLOT
      return off < buf.length ? { data: buf, off } : null
    }
    if (a >= Runtime.SCREEN_CTRL_BASE && a < Runtime.SCREEN_CTRL_BASE + 8 * Runtime.SCREEN_CTRL_SLOT) {
      const rel = a - Runtime.SCREEN_CTRL_BASE
      const s = this.screens.get(Math.floor(rel / Runtime.SCREEN_CTRL_SLOT))
      if (!s) return null
      const off = rel % Runtime.SCREEN_CTRL_SLOT
      // synthesized read-only block; writes land in a throwaway copy
      const block = this.screenCtrlBlock(s)
      return off < block.length ? { data: block, off } : null
    }
    if (a >= Runtime.SCREEN_CHIP_BASE && a < Runtime.SCREEN_CHIP_BASE + 8 * Runtime.SCREEN_CHIP_SLOT) {
      const rel = a - Runtime.SCREEN_CHIP_BASE
      const s = this.screens.get(Math.floor(rel / Runtime.SCREEN_CHIP_SLOT))
      if (!s) return null
      const within = rel % Runtime.SCREEN_CHIP_SLOT
      const phy = within >= Runtime.SCREEN_PHY_OFFSET
      const off = phy ? within - Runtime.SCREEN_PHY_OFFSET : within
      const planar = s.planarView(phy ? 'phy' : 'log', write)
      return off < planar.length ? { data: planar, off } : null
    }
    for (const [n, bank] of this.memBanks) {
      const base = this.bankBase(n) >>> 0
      if (a >= base && a < base + bank.data.length) return { data: bank.data, off: a - base }
    }
    return null
  }

  reserveBank(n: number, length: number, name: string, dataBank = true, chip = false): void {
    // RsBqX (+Lib.s): length <= 0 or bank outside 1..65535 = function call
    // error; flags bit 0 = Bnk_BitData (+Equ.s:1865): Data banks survive
    // Erase Temp, Work banks (bit clear) do not
    if (length <= 0 || n <= 0 || n >= 0x10000) throw new AmosError('Illegal function call', 23)
    this.memBanks.set(n, { kind: 'memory', number: n, memType: chip ? 1 : 0, name, flags: dataBank ? 1 : 0, data: new Uint8Array(length) })
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
   */
  static readonly EC_FSEL = 10
  /**
   * The file selector is itself an Interface dialog: the layout comes from
   * program 2 of the system default resource bank; this controller is the
   * native driver that fills the list, reacts to the zone returns and
   * assembles the result. Zone scheme (from the bank script): 1 OK,
   * 2 Cancel, 3 Parent, 4 Devices, 5 Assigns, 6 Get Dir, 7 Sort, 8 Sizes,
   * 13 the file list, 14 the Path edit (var 15), 15 the Name edit (var 14).
   */
  fsel: {
    done: boolean
    result: string
    chan: number
    screenNb: number
    prevScreen: number
    path: string
    pattern: string
    sorted: boolean
    sizes: boolean
    devices: boolean
    entries: Array<{ name: string; isDir: boolean; size: number }>
    arr: AmosArray
    lastSel: number
    lastSelTick: number
  } | null = null

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
    // a system screen outside the user range 0-7 (like the 68k's Fs_ScOpen)
    const s = new Screen(Runtime.EC_FSEL, 640, 200, res!.graphics?.nColors ?? 8, 0x8000)
    this.screens.set(Runtime.EC_FSEL, s)
    this.order = this.order.filter((i) => i !== Runtime.EC_FSEL)
    this.order.push(Runtime.EC_FSEL)
    this.currentIndex = Runtime.EC_FSEL
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
    d.vars[0] = t1
    d.vars[1] = t2
    d.vars[10] = 0
    d.vars[11] = handle
    d.vars[14] = defName
    d.vars[15] = path
    this.dialogs.set(chan, d)
    this.fsel = {
      done: false,
      result: '',
      chan,
      screenNb: Runtime.EC_FSEL,
      prevScreen,
      path,
      pattern,
      sorted: true,
      sizes: false,
      devices: false,
      entries: [],
      arr,
      lastSel: -1,
      lastSelTick: -1000,
    }
    try {
      this.runDialog(chan, -1, null, null)
    } catch {
      this.finishFsel('')
      return true // surfaced as a cancel
    }
    this.fselRefresh()
    return true
  }

  /** re-read the directory (or device list) into the list zone */
  private fselRefresh(): void {
    const f = this.fsel
    if (!f || !this.vfs) return
    const d = this.dialogs.get(f.chan)
    if (!d) return
    const dirMark = this.systemResource?.messages?.[15] ?? '* '
    let names: string[]
    if (f.devices) {
      f.entries = [...this.vfs.volumeNames(), ...this.vfs.assignNames()].map((n) => ({
        name: `${n.replace(/:$/, '')}:`,
        isDir: true,
        size: 0,
      }))
      names = f.entries.map((e) => e.name)
    } else {
      const list = this.vfs.listDir(f.path) ?? []
      const match = f.pattern !== '' ? amigaPatternRx(f.pattern) : null
      const dirs = list.filter((e) => e.isDir)
      const files = list.filter((e) => !e.isDir && (!match || match.test(e.name)))
      if (f.sorted) {
        dirs.sort((a, b) => a.name.localeCompare(b.name))
        files.sort((a, b) => a.name.localeCompare(b.name))
      }
      f.entries = [...dirs, ...files].map((e) => ({ name: e.name, isDir: e.isDir, size: e.size }))
      names = f.entries.map((e) => (e.isDir ? dirMark + e.name : f.sizes ? `${e.name} (${e.size})` : e.name))
    }
    f.arr.data = names.map((s) => ({ k: 'str' as const, s }))
    f.arr.dims = [names.length]
    this.dialogDraw.activate(d.screenNb)
    const list = d.zones.find((z) => z.kind === 'list')
    if (list) {
      list.count = names.length
      list.scroll = 0
      list.sel = -1
      list.pos = -1
      drawListZone(d, list, this.dialogHost, this.dialogDraw)
    }
    const slider = d.zones.find((z) => z.kind === 'slider' && z.vertical)
    if (slider) {
      slider.total = names.length
      slider.pos = 0
      drawSliderZone(d, slider, this.dialogDraw)
    }
    const pathZone = d.zones.find((z) => z.number === 14 && (z.kind === 'edit' || z.kind === 'digit'))
    if (pathZone) {
      pathZone.text = f.path
      drawEditZone(d, pathZone, this.dialogDraw)
    }
    this.dialogDraw.deactivate()
  }

  /** the native FSel loop: act on the dialog's zone returns */
  private stepFsel(): void {
    const f = this.fsel
    if (!f || f.done) return
    const d = this.dialogs.get(f.chan)
    if (!d || !d.drawn) {
      this.finishFsel('')
      return
    }
    const ret = d.ret
    if (ret === 0) return
    d.ret = 0
    const zoneText = (n: number): string =>
      d.zones.find((z) => z.number === n && (z.kind === 'edit' || z.kind === 'digit'))?.text ?? ''
    const ok = (): void => {
      const name = zoneText(15)
      const path = zoneText(14)
      this.finishFsel(name === '' ? '' : joinAmigaPath(path, name))
    }
    switch (ret) {
      case 1:
      case 15:
        ok()
        break
      case 2:
        this.finishFsel('')
        break
      case 3: {
        f.path = parentAmigaPath(zoneText(14))
        f.devices = false
        this.fselRefresh()
        break
      }
      case 4:
      case 5:
        f.devices = true
        this.fselRefresh()
        break
      case 6:
      case 14:
        f.path = zoneText(14)
        f.devices = false
        this.fselRefresh()
        break
      case 7:
        f.sorted = !f.sorted
        this.fselRefresh()
        break
      case 8:
        f.sizes = !f.sizes
        this.fselRefresh()
        break
      case 13: {
        const list = d.zones.find((z) => z.kind === 'list')
        const idx = list?.pos ?? -1
        const entry = idx >= 0 ? f.entries[idx] : undefined
        if (!entry) break
        if (f.devices) {
          f.path = entry.name
          f.devices = false
          this.fselRefresh()
          break
        }
        if (entry.isDir) {
          f.path = joinAmigaPath(f.path, entry.name)
          this.fselRefresh()
          break
        }
        // a file: put it in the Name field; double-click = OK
        const dbl = idx === f.lastSel && this.interp.tick - f.lastSelTick < 25
        f.lastSel = idx
        f.lastSelTick = this.interp.tick
        const nameZone = d.zones.find((z) => z.number === 15 && z.kind === 'edit')
        if (nameZone) {
          nameZone.text = entry.name
          this.dialogDraw.activate(d.screenNb)
          drawEditZone(d, nameZone, this.dialogDraw)
          this.dialogDraw.deactivate()
        }
        if (dbl) ok()
        break
      }
      default:
        break
    }
  }

  /** close the selector: dialog, screen, restore, store the result */
  finishFsel(result: string): void {
    const f = this.fsel
    if (!f) return
    const d = this.dialogs.get(f.chan)
    if (d) {
      eraseDialog(d, this.dialogDraw)
      this.dialogs.delete(f.chan)
    }
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
  readText: { done: boolean; result: string; chan: number; screenNb: number; prevScreen: number } | null = null

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
    this.readText = { done: false, result: '', chan, screenNb: Runtime.EC_FSEL, prevScreen }
    try {
      this.runDialog(chan, -1, null, null)
    } catch {
      this.finishReadText('')
    }
    return true
  }

  /** the reader's own wait loop (+Lib.s:14843): poll zone 5, quit when the
   * dialog closes itself */
  private stepReadText(): void {
    const t = this.readText
    if (!t || t.done) return
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
    if (!t) return
    const d = this.dialogs.get(t.chan)
    if (d) {
      eraseDialog(d, this.dialogDraw)
      this.dialogs.delete(t.chan)
    }
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
        s.pixels.copyWithin(dy * s.width + from, sy * s.width + from, sy * s.width + to)
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
          if (dx >= 0 && dx < s.width) s.pixels[dy * s.width + dx] = b.pix[r * b.w + c]!
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
      x: (this.input.mouseX - s.displayX) * (s.hires ? 2 : 1) + s.offsetX,
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
        d.ret = z.number // Return reports the edit zone
        editNext(d, draw)
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
      for (const z of d.zones) {
        if (z.kind !== 'key') continue
        const kc = z.code!
        if (kc === 0) continue
        // code $FF = any key; bit7 = scancode match; else ASCII (uppercased)
        const hit = kc === 0xff || (kc & 0x80 ? (kc & 0x7f) === key.scan : kc === ascii)
        if (!hit) continue
        // qualifier bytes (shift/amiga/ctrl/alt) are approximated as 0
        if (z.ref) simulated = z.ref
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
  private lastRmb = false
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
          return (v - s.displayX) * (s.hires ? 2 : 1) + s.offsetX
        case 'YS':
          return v - s.displayY + s.offsetY
        case 'XH':
          return s.displayX + Math.trunc((v - s.offsetX) / (s.hires ? 2 : 1))
        case 'YH':
          return s.displayY + (v - s.offsetY)
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

  closeChannel(n: number): void {
    const c = this.fileChans.get(n)
    if (!c) return
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

  /** Chip bytes held by banks and by open screens' bitplanes. */
  chipUsed(): number {
    let n = 0
    for (const b of this.memBanks.values()) if (b.memType === 1) n += b.data.length
    for (const s of this.screens.values()) {
      // bitplanes are chip memory: a row is rounded up to a whole word
      n += (((s.width + 15) >> 4) << 1) * s.height * s.depth
    }
    for (const bank of [this.spriteBank, this.iconBank]) {
      if (!bank) continue
      for (const img of bank.images) n += (((img.width + 15) >> 4) << 1) * img.height * 2
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

  // ---- the Varptr variable arena -----------------------------------------
  // Variables mapped into the fake address space (FnVarPtr +ILib.s:4087):
  // integer/float cells get a stable 4-byte slot that syncs from the
  // variable on reads and flushes Pokes back; strings are snapshotted
  // (length word + chars, Varptr returns chars) exactly as the 68k hands
  // out the current string block — reassignment leaves the old address
  // stale there too. Pokes into a string flush back while the variable
  // still has the snapshot's length.

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
        return typeof val === 'function' ? (val as (...a: unknown[]) => unknown).bind(t) : val
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
  varptrArray(key: string, arr: { data: Value[]; type?: number }, type: number): number {
    return this.makeVarSlot(
      `a:${key}`,
      Math.max(4, arr.data.length * 4),
      (buf) => {
        for (let i = 0; i < arr.data.length; i++) {
          const v = arr.data[i]!
          const n = v.k === 'str' ? 0 : v.n
          const raw = type === 1 ? toFFP(n) : n | 0
          buf[i * 4] = (raw >>> 24) & 0xff
          buf[i * 4 + 1] = (raw >>> 16) & 0xff
          buf[i * 4 + 2] = (raw >>> 8) & 0xff
          buf[i * 4 + 3] = raw & 0xff
        }
      },
      (buf) => {
        for (let i = 0; i < arr.data.length; i++) {
          const raw = ((buf[i * 4]! << 24) | (buf[i * 4 + 1]! << 16) | (buf[i * 4 + 2]! << 8) | buf[i * 4 + 3]!) >>> 0
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
   * out. The display is not reinitialised (DefRunAcc, the d0=-1 arm of
   * Prg_RunIt at 4398): screens, and whatever is drawn on them, survive in
   * both directions.
   */
  prun(path: string, resumeAt: Addr): void {
    // an accessory cannot Prun another one (PRun_Acc, +ILib.s:1600)
    if (this.interp.nestedProgram) throw new AmosError('accessory cannot Prun', 102)
    const bytes = this.fs?.read(path)
    if (!bytes) throw new AmosError('file not found')
    const file = parseAmosFile(bytes)
    if (file.source.length === 0) throw new AmosError('file not found')
    const lines = parseSource(file.source, this.table)
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
  // (Bnk.Load LB_Sprites +Lib.s). Synthesized read-only; rebuilt when
  // the image count changes (in-place pixel edits may serve a stale
  // image until then — NOTES).

  private objBankCache = new Map<string, { bank: ObjectBank; count: number; image: Uint8Array }>()

  objectBankImage(kind: 'sprites' | 'icons'): Uint8Array | null {
    const bank = kind === 'sprites' ? this.spriteBank : this.iconBank
    if (!bank) return null
    const cached = this.objBankCache.get(kind)
    if (cached && cached.bank === bank && cached.count === bank.images.length) return cached.image
    const count = bank.images.length
    const recOffsets: number[] = []
    let size = 2 + count * 8 + 64
    for (const img of bank.images) {
      recOffsets.push(size)
      size += 10 + (img.width >> 4) * 2 * img.height * img.depth
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
      const planeSize = widthWords * 2 * img.height
      for (let p = 0; p < img.depth; p++) {
        const bit = 1 << p
        for (let y = 0; y < img.height; y++) {
          for (let x = 0; x < img.width; x++) {
            if (img.pixels[y * img.width + x]! & bit) {
              const bo = off + 10 + p * planeSize + y * widthWords * 2 + (x >> 3)
              out[bo] = out[bo]! | (1 << (7 - (x & 7)))
            }
          }
        }
      }
    })
    this.objBankCache.set(kind, { bank, count, image: out })
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
   * Bnk.OrAdr: a small value is a bank number (its start address), else
   * a raw address into the fake address space.
   */
  bankOrAddr(n: number): { data: Uint8Array; off: number } | null {
    if (n >= 0 && n < 0x10000) {
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
  /** line waiting to satisfy an Input statement */
  private pendingLine: string | null = null
  private promptShown = false
  private frameBudget: number
  private onText: ((text: string) => void) | undefined

  constructor(lines: TokenLine[], table: TokenTable, opts: RuntimeOptions = {}) {
    this.frameBudget = opts.frameBudget ?? 20_000
    this.onText = opts.onText
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
          io.write(line + '\n')
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
      instructions: makeInstructions(this),
      functions: makeFunctions(this),
      rawFunctions: makeRawFunctions(this),
      input: this.input,
    }
    if (opts.extensions) interpOpts.extensions = opts.extensions
    if (opts.onUnimplemented) interpOpts.onUnimplemented = opts.onUnimplemented
    if (opts.maxSteps) interpOpts.maxSteps = opts.maxSteps
    this.interp = new Interp(lines, table, interpOpts)
    this.interp.onProgramPop = (host) => this.restoreProgramBanks(host)
    this.table = table
    this.fs = opts.fs ?? null
    if (opts.audio) this.audio = opts.audio
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

  /** the sprite bank, created on demand (Get Bob into an empty bank) */
  needSpriteBank(): ObjectBank {
    this.spriteBank ??= new ObjectBank()
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
        const i = ty * s.width + tx
        s.pixels[i] = planeMask === -1 ? v : (s.pixels[i]! & ~planeMask) | (v & planeMask)
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
    const w = Math.max(0, x2 - x1)
    const h = Math.max(0, y2 - y1)
    const pixels = new Uint8Array(w * h)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v = s.point(x1 + x, y1 + y)
        pixels[y * w + x] = v < 0 ? 0 : v
      }
    }
    const depth = Math.max(1, Math.ceil(Math.log2(Math.max(2, s.nColors))))
    return { width: w, height: h, depth, hotX: 0, hotY: 0, pixels, opaque: false }
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
      if (![2, 4, 8, 16, 32, 64].includes(colours)) throw new AmosError('illegal number of colours')
      if (m & 0x8000 && colours > 16) throw new AmosError('function call error')
    }
    const s = new Screen(n, Math.max(8, w), Math.max(8, h), colours, m)
    // Default Palette is a sparse override list — the mouse bank fills only
    // the sprite half (16-31), so unset entries must keep the boot colours
    for (let i = 0; i < this.defaultPalette.length && i < 32; i++) {
      const c = this.defaultPalette[i]
      if (c !== undefined) s.palette[i] = c
    }
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

  /**
   * The un-flipped collision image: ColRout (+W.s:179) strips the flip
   * flags, so collision always uses the raw hot spot and box even when the
   * object is drawn flipped.
   */
  private colImage(image: number): BankImage | undefined {
    return this.spriteBank?.image(image & 0x3fff)
  }

  /** Bob n vs bobs first..last on the same screen; fills colSet. -1/0. */
  bobColCheck(n: number, first = -Infinity, last = Infinity): number {
    this.colSet.clear()
    const me = this.bobs.get(n)
    const img = me && this.colImage(me.image)
    if (!me || !img) return 0
    for (const other of this.bobs.values()) {
      if (other.n === n || other.n < first || other.n > last || other.screen !== me.screen) continue
      const oimg = this.colImage(other.image)
      if (oimg && imagesCollide(img, me.x, me.y, oimg, other.x, other.y)) this.colSet.add(other.n)
    }
    return this.colSet.size > 0 ? -1 : 0
  }

  spriteColCheck(n: number, first = -Infinity, last = Infinity): number {
    this.colSet.clear()
    const me = this.hwSprites.get(n)
    const img = me && this.colImage(me.image)
    if (!me || !img) return 0
    for (const other of this.hwSprites.values()) {
      if (other.n === n || other.n < first || other.n > last) continue
      const oimg = this.colImage(other.image)
      if (oimg && imagesCollide(img, me.x, me.y, oimg, other.x, other.y)) this.colSet.add(other.n)
    }
    return this.colSet.size > 0 ? -1 : 0
  }

  /**
   * Map a bob's screen position into hardware-sprite coordinate space
   * (CXyS +W.s:10840): X is halved in HIRES, Y is halved when INTERLACED —
   * one hardware unit is one lowres pixel. Sprites already live in hardware
   * coords, so this puts the bob alongside them for collision.
   */
  private bobToHw(bob: Bob): { x: number; y: number } {
    const s = this.screens.get(bob.screen) ?? this.screen
    return {
      x: (s.hires ? bob.x >> 1 : bob.x) + s.displayX,
      y: (s.laced ? bob.y >> 1 : bob.y) + s.displayY,
    }
  }

  /** Bob n vs hardware sprites first..last (Bobsprite Col, GoToSp +W.s:415). */
  bobSpriteColCheck(n: number, first = 0, last = 63): number {
    this.colSet.clear()
    const me = this.bobs.get(n)
    const img = me && this.colImage(me.image)
    if (!me || !img) return 0
    const p = this.bobToHw(me)
    for (const sp of this.hwSprites.values()) {
      if (sp.n < first || sp.n > last) continue
      const oimg = this.colImage(sp.image)
      if (oimg && imagesCollide(img, p.x, p.y, oimg, sp.x, sp.y)) this.colSet.add(sp.n)
    }
    return this.colSet.size > 0 ? -1 : 0
  }

  /** Hardware sprite n vs bobs first..last (Spritebob Col, SpToBb +W.s:526). */
  spriteBobColCheck(n: number, first = 0, last = 10000): number {
    this.colSet.clear()
    const me = this.hwSprites.get(n)
    const img = me && this.colImage(me.image)
    if (!me || !img) return 0
    for (const bob of this.bobs.values()) {
      if (bob.n < first || bob.n > last) continue
      const oimg = this.colImage(bob.image)
      const p = this.bobToHw(bob)
      if (oimg && imagesCollide(img, me.x, me.y, oimg, p.x, p.y)) this.colSet.add(bob.n)
    }
    return this.colSet.size > 0 ? -1 : 0
  }

  /**
   * CLXCON, the collision control register (HColSet +W.s:10018).
   *
   * Set Hardcol enable,match writes it: bits 12-15 enable the odd sprite
   * of each pair (AMOS always sets all four), bits 6-11 say which
   * bitplanes take part, bits 0-5 the value those planes must carry for a
   * playfield pixel to count as solid.
   */
  clxcon = 0

  /**
   * CLXDAT for the current sprite and playfield positions (HColGet
   * +W.s:115).
   *
   * Bit 0 is playfield 1 against playfield 2; bits 1-4 are sprite pairs
   * 0-3 against playfield 1 and bits 5-8 the same against playfield 2;
   * bits 9-14 are the six pair-against-pair combinations. That is the
   * layout HColT (+W.s:159) indexes, and it is the hardware's.
   *
   * Deviation: the real register accumulates whatever the beam passed over
   * during the frame and clears when read. This samples the positions as
   * they stand at the call. For the way programs use it — move, Wait Vbl,
   * test — the two agree; for a sprite that has already been moved on
   * within the same frame they do not.
   */
  hardcolData(): number {
    const en = (this.clxcon >> 6) & 0x3f
    const mv = this.clxcon & 0x3f
    const ensp = (this.clxcon >> 12) & 0xf
    // sprite coverage per pair, as hardware pixel keys
    const cover: Set<number>[] = [new Set(), new Set(), new Set(), new Set()]
    const sprites = this.spriteUpdateOn ? [...this.hwSprites.values()] : (this.frozenSprites ?? [])
    const channels = this.spriteChannels(sprites)
    for (const sp of sprites) {
      const img = this.spriteBank?.image(sp.image)
      if (!img) continue
      const ch = channels.get(sp.n) ?? 6
      // an odd channel only takes part when its ENSPn bit is set
      if (ch & 1 && !(ensp & (1 << (ch >> 1)))) continue
      const set = cover[ch >> 1]!
      const x0 = sp.x - img.hotX
      const y0 = sp.y - img.hotY
      for (let y = 0; y < img.height; y++) {
        for (let x = 0; x < img.width; x++) {
          if (img.pixels[y * img.width + x] !== 0) set.add((y0 + y) * 1024 + (x0 + x))
        }
      }
    }
    // a playfield pixel is solid when every enabled plane matches
    const solid = (pix: number, planes: number[]): boolean => {
      let e = 0
      let m = 0
      for (let i = 0; i < planes.length; i++) {
        if (en & (1 << planes[i]!)) e |= 1 << i
        if (mv & (1 << planes[i]!)) m |= 1 << i
      }
      return ((pix ^ m) & e) === 0
    }
    const ODD = [0, 2, 4]
    const EVEN = [1, 3, 5]
    const ALL = [0, 1, 2, 3, 4, 5]
    /** the playfield values at a hardware pixel, or null outside every screen */
    const pfAt = (hx: number, hy: number): { p1: boolean; p2: boolean; dual: boolean } | null => {
      const f = this.frontAt(hy)
      if (!f) return null
      const back = !f.dualIsBack && f.dualPartner !== null ? (this.screens.get(f.dualPartner) ?? null) : null
      const sx = (hx - f.displayX) * (f.hires ? 2 : 1) + f.offsetX
      const sy = hy - f.displayY + f.offsetY
      if (sx < 0 || sy < 0 || sx >= f.width || sy >= f.height) return null
      const v1 = f.displayBuffer[sy * f.width + sx]! & 63
      if (!back) return { p1: solid(v1, ALL), p2: false, dual: false }
      const v2 = sx < back.width && sy < back.height ? back.displayBuffer[sy * back.width + sx]! & 7 : 0
      return { p1: solid(v1 & 7, ODD), p2: solid(v2, EVEN), dual: true }
    }
    let dat = 0
    // pair against pair — HColT's first four columns
    const PAIRBIT = [
      [-1, 9, 10, 11],
      [9, -1, 12, 13],
      [10, 12, -1, 14],
      [11, 13, 14, -1],
    ]
    for (let a = 0; a < 4; a++) {
      for (let b = a + 1; b < 4; b++) {
        for (const k of cover[a]!) {
          if (cover[b]!.has(k)) {
            dat |= 1 << PAIRBIT[a]![b]!
            break
          }
        }
      }
    }
    // pair against playfield — columns 4 and 5 of HColT are bits 1+p and 5+p
    for (let p = 0; p < 4; p++) {
      for (const k of cover[p]!) {
        const pf = pfAt(k % 1024, Math.floor(k / 1024))
        if (!pf) continue
        if (pf.p1) dat |= 1 << (1 + p)
        if (pf.p2) dat |= 1 << (5 + p)
        if (dat & (1 << (1 + p)) && dat & (1 << (5 + p))) break
      }
    }
    // playfield against playfield, wherever a dual pair is on screen
    outer: for (const s of this.screens.values()) {
      if (!s.visible || s.dualIsBack || s.dualPartner === null) continue
      for (let y = 0; y < s.height; y++) {
        for (let x = 0; x < s.width; x++) {
          const pf = pfAt(s.displayX + (s.hires ? x >> 1 : x), s.displayY + y)
          if (pf?.dual && pf.p1 && pf.p2) {
            dat |= 1
            break outer
          }
        }
      }
    }
    return dat
  }

  /**
   * =Hardcol(n) (FnHardcol +Lib.s:12353 -> HColGet +W.s:115).
   *
   * n < 0 answers the playfield-against-playfield bit. Otherwise it walks
   * HColT's row for sprite n's pair, building the two-bits-per-entry word
   * the 68k byte-swaps into T_TColl for Col() to read, and returns true
   * only when a *sprite* collision was among them — a playfield hit fills
   * in the Col() bits without making the function itself true.
   */
  hardcol(n: number): number {
    const dat = this.hardcolData()
    this.colSet.clear()
    if (n < 0) return dat & 1 ? -1 : 0
    const HCOL_T = [
      [-1, 9, 10, 11, 1, 5],
      [9, -1, 12, 13, 2, 6],
      [10, 12, -1, 14, 3, 7],
      [11, 13, 14, -1, 4, 8],
    ]
    const row = HCOL_T[(n & 6) >> 1]!
    let hit = 0
    for (let i = 0; i < row.length; i++) {
      const bit = row[i]!
      if (bit < 0 || !(dat & (1 << bit))) continue
      // two adjacent Col() objects per entry, as the %11 mask gives
      this.colSet.add(i * 2)
      this.colSet.add(i * 2 + 1)
      if (i < 4) hit = -1
    }
    return hit
  }

  /** =Col(n): >=0 membership (-1/0); <0 the first colliding object number. */
  colGet(n: number): number {
    if (n < 0) {
      for (const m of this.colSet) return m
      return 0
    }
    return this.colSet.has(n) ? -1 : 0
  }

  /** 1-based index of the first zone containing (x,y) in screen coords, 0 if none. */
  zoneAt(x: number, y: number): number {
    for (let i = 0; i < this.zones.length; i++) {
      const z = this.zones[i]
      if (z && x >= z.x1 && y >= z.y1 && x <= z.x2 && y <= z.y2) return i + 1
    }
    return 0
  }

  // ---- input from the host ----

  /** Type a character (feeds Inkey$ / Wait Key). */
  pressKey(ch: string, scan = 0): void {
    // the shift byte (scancodes $60-$67 -> bits 0-7) is captured WITH the
    // keystroke; Inkey$ stores it in SScan for Scanshift (+Lib.s:13618)
    let shift = 0
    for (let i = 0; i < 8; i++) if (this.input.keys.has(0x60 + i)) shift |= 1 << i
    this.input.keyQueue.push({ ch, scan, shift })
  }

  /** Submit a line for a pending Input statement. */
  submitLine(line: string): void {
    this.pendingLine = line
  }

  // ---- the clock ----

  /** Advance one 50Hz frame: release expired waits, run a slice. */
  frame(): RunResult {
    this.interp.tick++
    // MusInt is the first VBL routine (Mus_Cold +Music.s:848)
    this.music.vbl()
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
    this.unblock()
    let result: RunResult
    if (!this.interp.done && this.interp.blocked === null) {
      result = this.interp.run(this.frameBudget)
    } else {
      result = { status: this.interp.done ? 'ended' : 'blocked', steps: 0, unimplemented: this.interp.unimplemented }
    }
    if (this.bobUpdateOn && this.interp.tick % this.updateEvery === 0) this.updateBobs()
    this.stepMenus()
    this.stepDialogs()
    this.stepFsel()
    this.stepReadText()
    return result
  }

  /** the menu interaction (MnGere +Lib.s:15811), one iteration per frame */
  private stepMenus(): void {
    const t = this.menu
    const rmb = (this.input.mouseK & 2) !== 0
    const s = this.screens.get(t.screenNb >= 0 ? t.screenNb : this.currentIndex) ?? this.screens.get(this.currentIndex) ?? null
    if (!t.on || t.roots.length === 0 || !s) {
      if (this.menuOpen && s) this.closeMenu(s)
      this.lastRmb = rmb
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
    this.lastRmb = rmb
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

  private unblock(): void {
    const b = this.interp.blocked
    if (b === null) return
    if (b.type === 'wait' && this.interp.tick >= b.until) this.interp.blocked = null
    else if (b.type === 'waitKey' && this.input.keyQueue.length > 0) {
      this.input.keyQueue.shift()
      this.interp.blocked = null
    } else if (b.type === 'input' && this.pendingLine !== null) this.interp.blocked = null
    else if (b.type === 'dialog') {
      const d = this.dialogs.get(b.channel)
      if (!d || d.runState === 'done') this.interp.blocked = null
    } else if (b.type === 'fsel') {
      if (!this.fsel || this.fsel.done) this.interp.blocked = null
    } else if (b.type === 'readtext') {
      if (!this.readText || this.readText.done) this.interp.blocked = null
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
        if (this.fsel && !this.fsel.done) this.finishFsel('')
        else this.interp.blocked = null
      } else if (b?.type === 'readtext') {
        if (this.readText && !this.readText.done) this.finishReadText('')
        else this.interp.blocked = null
      }
    }
    return { status, frames, unimplemented: this.interp.unimplemented }
  }

  // ---- video out ----

  /** The composite window: a full-overscan PAL monitor. Hardware lines
   * COMPOSITE_TOP .. COMPOSITE_TOP+COMPOSITE_LINES-1 (26..311 — vertical
   * blank ends ~25, bottom overscan ~311) each map to two canvas rows.
   * The AMOS default screen sits at line 50; accessories place screens
   * from ~line 20 (Object_Editor) to ~291 and Limit Mouse 25..310. */
  static readonly COMPOSITE_TOP = 26
  static readonly COMPOSITE_LINES = 286

  /** Compose all visible screens into a 640x572 RGBA frame (the PAL
   * overscan window, doubled). */
  /**
   * Fold Rainbow-instruction changes into the display fields, exactly like
   * the copper build's activation pass (RainA1-A5 +W.s:6079): a height
   * change re-latches RnTY and forces the Y pass; the Y pass clamps the
   * start to hardware line 28; a base change is IGNORED when out of range
   * (RainA4 keeps the old base). Nothing happens while h < 0.
   */
  private activateRainbows(): void {
    for (const rb of this.rainbows.values()) {
      if (rb.table.length === 0 || rb.h < 0 || rb.act === 0) continue
      let act = rb.act
      rb.act = 0
      if (act & 1) {
        rb.ty = rb.h
        act |= 4
      }
      if (act & 4) {
        rb.dy = Math.max(28, rb.y)
        rb.fy = rb.dy + rb.ty
      }
      if (act & 2 && ((rb.x << 1) & 0xffff) < rb.table.length * 2) rb.base = rb.x
    }
  }

  /**
   * Per-row colour resolver: plain indexed, EHB half-bright (values 32-63
   * show colours 0-31 with each component halved), or HAM6 (control bits
   * 5-4: 0 = set from the 16-colour palette, 1/2/3 = modify blue/red/green
   * of a running colour that restarts from colour 0 each scanline).
   */
  private rowColours(s: Screen, pal: Uint16Array | null): (pix: number) => number {
    const get = (i: number): number => (pal ? pal[i & 31]! : s.palette[i & 31]! & 0xfff)
    if (s.ham) {
      let c = get(0)
      return (pix) => {
        const dat = pix & 15
        switch (pix >> 4) {
          case 0:
            c = get(dat)
            break
          case 1:
            c = (c & 0xff0) | dat
            break
          case 2:
            c = (c & 0x0ff) | (dat << 8)
            break
          default:
            c = (c & 0xf0f) | (dat << 4)
        }
        return c
      }
    }
    if (s.ehb) return (pix) => (pix >= 32 ? (get(pix - 32) >> 1) & 0x777 : get(pix))
    return (pix) => get(pix)
  }

  private winWOf(s: Screen): number {
    return s.displayW >= 0 ? Math.min(s.displayW, s.width) : s.width
  }
  private winHOf(s: Screen): number {
    return s.displayH >= 0 ? Math.min(s.displayH, s.height) : s.height
  }
  private coversLine(s: Screen, L: number): boolean {
    const hwH = s.laced ? Math.ceil(this.winHOf(s) / 2) : this.winHOf(s)
    return L >= s.displayY && L < s.displayY + hwH
  }
  /** the front screen band owning hardware line L (priority slices) */
  private frontAt(L: number): Screen | null {
    let f: Screen | null = null
    for (let i = this.order.length - 1; i >= 0; i--) {
      const s = this.screens.get(this.order[i]!)
      if (!s || !s.visible || !this.coversLine(s, L)) continue
      f = s
      break
    }
    // the hidden back half of a pair defers to its front screen
    if (f?.dualIsBack && f.dualPartner !== null) {
      const df = this.screens.get(f.dualPartner)
      if (df?.visible && this.coversLine(df, L)) f = df
    }
    return f
  }

  /**
   * Build the system copper list into the logical buffer and swap — the
   * word-for-word equivalent of EcCopper (+W.s:5730/6030-6500) run at each
   * vbl. The list is real memory behind Cop Logic: the header wait
   * $1003FFFE + sprite pointers $120-$13E (HsCop +W.s:6786), then per
   * screen band an EcCopHo block (WAIT, DMACON stop, the 16-colour
   * palette, BPLxPTH/L pointing into the screen's chip-RAM planes,
   * DIWSTRT/STOP, DDFSTRT/STOP, modulos, BPLCON0-2, then a WAIT for the
   * next line + DMACON $8300 + colours 16-31, FiniCop), per rainbow line
   * a WAIT + COLOR move (CopBow), EcCopBa (DMA stop + fond) at band ends,
   * and the $FFFFFFFE terminator. Deviation: the rainbow-restore move is
   * emitted after a WAIT for its own line (the 68k emits it unwaited,
   * which lands it a beam-race early — idealized here).
   */
  buildCopperList(): void {
    this.activateRainbows()
    const l = this.copLogic
    let p = 0
    const put = (w: number): void => {
      if (p + 2 <= l.length) {
        l[p] = (w >> 8) & 0xff
        l[p + 1] = w & 0xff
        p += 2
      }
    }
    let cross = false
    const wait = (line: number): void => {
      if (line >= 256 && !cross) {
        put(0xffdf)
        put(0xfffe)
        cross = true
      }
      put(((line << 8) & 0xff00) | 0x03)
      put(0xfffe)
    }
    put(0x1003)
    put(0xfffe)
    for (let r = 0x120; r <= 0x13e; r += 2) {
      put(r)
      put(0)
    }
    const rbs = [...this.rainbows.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, r]) => r)
      .filter((r) => r.table.length > 0 && r.h >= 0 && r.ty > 0)
    let front: Screen | null = null
    let curRb: Rainbow | null = null
    let emitted = false
    for (let L = 0; L < 313; L++) {
      const f = this.frontAt(L)
      const bandStart = f !== front && f !== null
      const bandEnd = f !== front && f === null
      if (bandStart && f) {
        emitted = true
        // EcCopHo head (+W.s:6293) — the band splitter stores boundaries
        // at EcWY-1 (MkD2 +W.s:5830), so the setup runs on the line BEFORE
        // the band and the DMA restart lands exactly on its first line
        wait(Math.max(0, L - 1))
        put(0x096)
        put(0x0100)
        for (let i = 0; i < 16; i++) {
          put(0x180 + i * 2)
          put(f.palette[i]! & 0xfff)
        }
        // bitplane pointers: the +1 window offset relative to the setup
        // line cancels the -1, pointing at the band's first row
        const rowOff = (L - f.displayY + f.offsetY) * f.rowBytes + ((f.offsetX >> 4) << 1)
        const base = this.screenChipBase(f.index) + (f.doubleBuffered ? Runtime.SCREEN_PHY_OFFSET : 0)
        for (let pl = 0; pl < f.depth; pl++) {
          const ad = (base + pl * f.planeSize + rowOff) >>> 0
          put(0x0e0 + pl * 4)
          put((ad >>> 16) & 0xffff)
          put(0x0e2 + pl * 4)
          put(ad & 0xffff)
        }
        const hwx = f.displayX + 1
        put(0x08e) // DIWSTRT
        put(((hwx & 0xff) | 0x0100) & 0xffff)
        put(0x090) // DIWSTOP
        put((((hwx + (this.winWOf(f) >> (f.hires ? 1 : 0))) & 0xff) | 0x3700) & 0xffff)
        const ds = f.hires ? ((hwx - 9) >> 1) & 0xfffc : ((hwx - 17) >> 1) & 0xfff8
        const de = ds + (this.winWOf(f) >> (f.hires ? 2 : 1)) - 8
        put(0x092)
        put(ds & 0xffff)
        put(0x094)
        put(de & 0xffff)
        const fetch = (this.winWOf(f) >> 4) << 1
        let mod = Math.max(0, f.rowBytes - (f.hires ? fetch >> 1 : fetch))
        if (f.laced) mod += f.rowBytes
        put(0x108)
        put(mod)
        put(0x10a)
        put(mod)
        put(0x100) // BPLCON0
        put(((f.hires ? 0x8000 : 0) | (Math.min(f.depth, 7) << 12) | 0x0200 | (f.laced ? 4 : 0)) & 0xffff)
        put(0x102)
        put(0)
        put(0x104)
        // BPLCON2 is the screen's own EcCon2 (+W.s:6470), so a list copied
        // out of Cop Logic carries that screen's sprite priority with it
        put(((f.pf1p & 7) | ((f.pf2p & 7) << 3) | (f.pf2Front ? 0x40 : 0)) & 0xffff)
        // FiniCop: restart the DMA on the band's first line + the upper
        // palette half
        wait(L)
        put(0x096)
        put(0x8300)
        for (let i = 16; i < 32; i++) {
          put(0x180 + i * 2)
          put(f.palette[i]! & 0xfff)
        }
      } else if (bandEnd) {
        // EcCopBa (+W.s:6741)
        wait(L)
        put(0x096)
        put(0x0100)
        put(0x180)
        put(this.colourBack & 0xfff)
      }
      front = f
      // the single-rainbow machine (CopBow), interleaved with the bands
      if (curRb && L >= curRb.fy) {
        if (!bandStart && !bandEnd && front) {
          wait(L)
          put(0x180 + curRb.colour * 2)
          put(front.palette[curRb.colour]! & 0xfff)
        }
        curRb = null
      }
      if (!curRb) curRb = rbs.find((r) => L >= r.dy && L < r.fy) ?? null
      if (curRb) {
        // at a band start the beam already sits at L after FiniCop
        if (!bandStart) wait(L)
        const t = curRb.table
        put(0x180 + curRb.colour * 2)
        put(t[(L - curRb.dy + curRb.base) % t.length]!)
      }
    }
    if (!emitted) {
      // no screens: the fond is still parked at the bottom (MCopX)
      wait(312)
      put(0x096)
      put(0x0100)
      put(0x180)
      put(this.colourBack & 0xfff)
    }
    put(0xffff)
    put(0xfffe)
    // MCopSw: swap the lists; the freshly built one becomes physical
    this.copLogIsA = !this.copLogIsA
  }

  /**
   * The scanline compositor: a faithful walk of the copper list the real
   * AMOS builds each vbl (EcCopper/CopBow +W.s:6030-6260). Per hardware
   * line: exactly ONE front screen is fetched (the screens are cut into
   * vertical slices by priority — "Decoupe les ecrans en tranches",
   * +W.s:5808); a band start reloads the hardware palette (EcCopHo); ONE
   * rainbow at a time writes its colour register per line (lowest-numbered
   * rainbow covering the line wins, RainN0), and on leaving its span the
   * register is restored from the screen palette — or colour 0 from the
   * fond when no screen is above (RainNX). The border shows hardware
   * colour 0, so a screen's palette bleeds into the border beside it and
   * a rainbow on colour 0 recolours the border itself.
   *
   * The current window's cursor is overlaid in its cursor pen (AffCur
   * +W.s:13604 forces the masked pixels to WiCuCol), so Flash and rainbows
   * show straight through it — the classic fading AMOS cursor.
   */
  composite(out?: Uint8ClampedArray): { width: number; height: number; data: Uint8ClampedArray } {
    const W = 640
    const H = Runtime.COMPOSITE_LINES * 2
    const data = out ?? new Uint8ClampedArray(W * H * 4)
    this.activateRainbows()
    // Copper Off: the display is whatever the user's physical list says
    if (!this.copperOn) {
      // no system list patches SPRxPT now, so the sprite side of the display
      // is whatever the user's list points at (TCopOn clears T_HsChange,
      // +W.s:6822). Until a list writes a sprite pointer the registers still
      // hold what the last system list left there, so AMOS's own sprites
      // carry on showing — at the priority the list's BPLCON2 asks for.
      const R = this.copRegs
      const pf1p = R.bplcon2 & 7
      const spr = (frontPass: boolean): void => {
        if (R.sprSet) this.drawListSprites(data, W, H, frontPass)
        else this.drawHwSprites(data, W, H, frontPass, pf1p)
      }
      spr(false)
      this.compositeFromList(data, W, H)
      spr(true)
      return { width: W, height: H, data }
    }
    // rainbows in slot order — the copper machine scans 0..NbRain-1
    const rbs = [...this.rainbows.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, r]) => r)
      .filter((r) => r.table.length > 0 && r.h >= 0 && r.ty > 0)
    const sprites = this.spriteList()

    const winWOf = (s: Screen): number => this.winWOf(s)
    // cursor cell of the current screen's current window (AffCur)
    const cs = this.screens.get(this.currentIndex) ?? null
    const cw = cs?.curWin ?? null
    const curX0 = cw ? cw.x + cw.curX * 8 : 0
    const curY0 = cw ? cw.y + cw.curY * 8 : 0

    const hwPal = new Uint16Array(32)
    hwPal[0] = this.colourBack & 0xfff
    let front: Screen | null = null
    let curRb: Rainbow | null = null

    const drawRow = (s: Screen, r: number, pal: Uint16Array | null, clearZero: boolean, palOff = 0, posFrom: Screen = s): void => {
      // pal = the live hardware palette. palOff 8 = a dual-playfield PF2
      // pass: 3-bit pixels through palette entries 8-15, positioned by the
      // FRONT screen (the playfields share the display window).
      const pixels = s.displayBuffer
      const pw = posFrom.hires ? 1 : 2
      const ph = posFrom.laced ? 1 : 2
      const baseX = (posFrom.displayX - 128) * 2
      const baseY = (posFrom.displayY - Runtime.COMPOSITE_TOP) * 2
      const sy = Math.floor((r - baseY) / ph) + s.offsetY
      if (sy < 0 || sy >= s.height) return
      const winW = winWOf(posFrom)
      const isCur = s === cs && s.cursorOn && cw !== null && sy >= curY0 && sy < curY0 + 8
      const mask = isCur ? CURSOR_SHAPE[sy - curY0]! : 0
      const colour = this.rowColours(s, pal)
      for (let x = 0; x < winW; x++) {
        const sx = x + s.offsetX
        if (sx < 0 || sx >= s.width) continue
        let pix = pixels[sy * s.width + sx]! & (palOff ? 7 : 63)
        if (mask !== 0 && sx >= curX0 && sx < curX0 + 8 && (mask << (sx - curX0)) & 0x80) pix = cw!.cuCol & 63
        if (clearZero && pix === 0) continue
        const rgb4 = palOff ? (pal ? pal[palOff + pix]! : s.palette[palOff + pix]! & 0xfff) : colour(pix)
        const cr = ((rgb4 >> 8) & 15) * 17
        const cg = ((rgb4 >> 4) & 15) * 17
        const cb = (rgb4 & 15) * 17
        const px = baseX + x * pw
        if (px + pw <= 0 || px >= W) continue
        for (let dx = 0; dx < pw; dx++) {
          const tx = px + dx
          if (tx < 0 || tx >= W) continue
          const o = (r * W + tx) * 4
          data[o] = cr
          data[o + 1] = cg
          data[o + 2] = cb
          data[o + 3] = 255
        }
      }
    }

    for (let L = Runtime.COMPOSITE_TOP; L < Runtime.COMPOSITE_TOP + Runtime.COMPOSITE_LINES; L++) {
      // the front screen band for this line (highest priority covering it;
      // a dual-playfield pair displays as one, the front screen leading)
      const f = this.frontAt(L)
      if (f !== front) {
        if (f) {
          // band start: EcCopHo emits the screen's palette block
          for (let i = 0; i < 32; i++) hwPal[i] = f.palette[i]! & 0xfff
        } else {
          // band end into a gap: EcCopBa restores the fond (T_EcFond)
          hwPal[0] = this.colourBack & 0xfff
        }
        front = f
      }
      // the single-rainbow copper machine
      if (curRb && L >= curRb.fy) {
        if (front) hwPal[curRb.colour] = front.palette[curRb.colour]! & 0xfff
        else hwPal[0] = this.colourBack & 0xfff
        curRb = null
      }
      if (!curRb) curRb = rbs.find((r) => L >= r.dy && L < r.fy) ?? null
      if (curRb) {
        const t = curRb.table
        hwPal[curRb.colour] = t[(L - curRb.dy + curRb.base) % t.length]!
      }
      // What is in front of what, back to front.
      //
      // EcCon2 does not say "sprites in front" or "sprites behind": PF1P and
      // PF2P each name the sprite pair a playfield slots in behind, so the
      // display is one interleaved stack — pair 0, pair 1, ... with each
      // playfield inserted at its own threshold. Sorting on that alone gets
      // the dual-playfield cases right, including the ones where the numbers
      // put playfield 2 in front of playfield 1 without PFBA being set; a
      // tie is what PFBA (Dual Priority) breaks.
      const back = f && !f.dualIsBack && f.dualPartner !== null ? (this.screens.get(f.dualPartner) ?? null) : null
      const stack: { key: number; layer: 'pf1' | 'pf2' | number }[] = [0, 1, 2, 3].map((p) => ({ key: p, layer: p }))
      if (f) stack.push({ key: f.pf1p - 0.5 + (back && f.pf2Front ? 0.1 : 0), layer: 'pf1' })
      if (f && back) stack.push({ key: f.pf2p - 0.5 + (f.pf2Front ? 0 : 0.1), layer: 'pf2' })
      const layers = stack.sort((a, b) => b.key - a.key).map((e) => e.layer)
      // render the two output rows of this hardware line
      const bg = hwPal[0]!
      const bgR = ((bg >> 8) & 15) * 17
      const bgG = ((bg >> 4) & 15) * 17
      const bgB = (bg & 15) * 17
      const r0 = (L - Runtime.COMPOSITE_TOP) * 2
      for (const r of [r0, r0 + 1]) {
        for (let o = r * W * 4; o < (r + 1) * W * 4; o += 4) {
          data[o] = bgR
          data[o + 1] = bgG
          data[o + 2] = bgB
          data[o + 3] = 255
        }
        for (const layer of layers) {
          if (layer === 'pf1') drawRow(f!, r, hwPal, true)
          else if (layer === 'pf2') drawRow(back!, r, hwPal, true, 8, f!)
          else this.blitSpriteRow(data, W, r, sprites, hwPal, (p) => p === layer)
        }
      }
    }
    return { width: W, height: H, data }
  }

  /**
   * Interpret the physical copper list (Copper Off mode): a beam walk over
   * the real word stream. WAITs advance the line (a $FFxx vpos is the
   * 255-crossing; $FFFF/$FFFE ends the list); MOVEs apply at the current
   * line.
   *
   * The fetch geometry comes from the registers, not from the screen the
   * pointers happen to resolve to:
   *
   * - BPL1PTH/L is a byte pointer walked down memory. Its row inside the
   *   screen is `ptr / rowBytes` and any remainder is a horizontal skew of
   *   8 pixels a byte, so a list that aims mid-row shears the picture just
   *   as the hardware does.
   * - BPL1MOD is added to that pointer at the end of every line (odd planes
   *   take MOD1; plane 0 is bitplane *one*). AMOS's own bands set it to
   *   `rowBytes - fetch`, which is what makes the pointer step exactly one
   *   row — a list choosing anything else legitimately repeats or shears
   *   the display, and interlace falls out of MOD1 += rowBytes.
   * - DDFSTRT/DDFSTOP set how many words are fetched per line, hence the
   *   width, and where the data lands: the first fetched pixel appears at
   *   colour clock `DDFSTRT*2 + 17` (lores) or `+9` (hires), the constants
   *   AMOS itself inverts when it derives DDF from DIWSTRT (+W.s:6293).
   * - BPLCON1's PF1H delays the playfield by up to 15 lores pixels.
   * - DIWSTRT/DIWSTOP window the result horizontally.
   * - BPLCON2's PF1P decides which sprite pairs are in front (see
   *   composite), and SPRxPT feed drawListSprites.
   *
   * Registers persist across frames, as the hardware's do — see copRegs.
   */
  private compositeFromList(data: Uint8ClampedArray, W: number, H: number): void {
    void H
    const phys = this.copPhysic
    const R = this.copRegs
    const hwPal = new Uint16Array(32)
    hwPal.set(R.pal)
    let p = 0
    let line = 0
    let cross = false
    let dmaOn = R.dmaOn
    let hires = R.hires
    let hstart = R.hstart
    let hstop = R.hstop
    let ddfstrt = R.ddfstrt
    let ddfstop = R.ddfstop
    let mod1 = R.mod1
    let mod2 = R.mod2
    let bplcon1 = R.bplcon1
    let bplcon2 = R.bplcon2
    let sprSet = R.sprSet
    let screen: Screen | null = R.screenIdx >= 0 ? (this.screens.get(R.screenIdx) ?? null) : null
    let usePhy = R.usePhy
    let ptr = R.ptr
    const bplH = Int32Array.from(R.bplH)
    const bplL = Int32Array.from(R.bplL)
    const sprH = Int32Array.from(R.sprH)
    const sprL = Int32Array.from(R.sprL)
    const cs = this.screens.get(this.currentIndex) ?? null
    const cw = cs?.curWin ?? null
    const curX0 = cw ? cw.x + cw.curX * 8 : 0
    const curY0 = cw ? cw.y + cw.curY * 8 : 0

    const renderLines = (to: number): void => {
      const end = Math.min(to, 313)
      for (; line < end; line++) {
        const fetching = dmaOn && screen !== null
        // words fetched per line: (stop-start)/8+1 lores, /4+2 hires — the
        // standard $38/$D0 and $3C/$D4 pairs give 20 and 40 words
        let words = 0
        if (fetching) {
          const span = ddfstop - ddfstrt
          words = span < 0 ? 0 : hires ? (span >> 2) + 2 : (span >> 3) + 1
          if (words > 128) words = 128
        }
        if (line >= Runtime.COMPOSITE_TOP && line < Runtime.COMPOSITE_TOP + Runtime.COMPOSITE_LINES) {
          const bg = hwPal[0]!
          const bgR = ((bg >> 8) & 15) * 17
          const bgG = ((bg >> 4) & 15) * 17
          const bgB = (bg & 15) * 17
          const r0 = (line - Runtime.COMPOSITE_TOP) * 2
          for (let ri = 0; ri < 2; ri++) {
            const r = r0 + ri
            for (let o = r * W * 4; o < (r + 1) * W * 4; o += 4) {
              data[o] = bgR
              data[o + 1] = bgG
              data[o + 2] = bgB
              data[o + 3] = 255
            }
            if (!fetching || words === 0) continue
            const s = screen!
            const rowPix = s.rowBytes * 8
            // the pointer is a byte address: whole rows plus a byte skew
            const abs = ptr * 8 + (s.laced ? ri * rowPix : 0)
            const pixels = usePhy ? s.displayBuffer : s.pixels
            const pw = hires ? 1 : 2
            // where the first fetched pixel lands, in colour clocks
            const dataStart = ddfstrt * 2 + (hires ? 9 : 17) + (bplcon1 & 15)
            const originX = (dataStart - 1 - 128) * 2
            const colour = this.rowColours(s, hwPal)
            const n = words * 16
            for (let i = 0; i < n; i++) {
              const a = abs + i
              const sy = Math.floor(a / rowPix)
              const sx = a - sy * rowPix
              if (sy < 0 || sy >= s.height || sx >= s.width) continue
              // DIW clips in colour clocks, so a hires pair shares one
              const hx = dataStart + (hires ? i >> 1 : i)
              if (hx < hstart || hx >= hstop) continue
              let pix = pixels[sy * s.width + sx]! & 63
              const isCur = s === cs && s.cursorOn && cw !== null && sy >= curY0 && sy < curY0 + 8
              if (isCur) {
                const mask = CURSOR_SHAPE[sy - curY0]!
                if (sx >= curX0 && sx < curX0 + 8 && (mask << (sx - curX0)) & 0x80) pix = cw!.cuCol & 63
              }
              const rgb4 = colour(pix)
              const cr = ((rgb4 >> 8) & 15) * 17
              const cg = ((rgb4 >> 4) & 15) * 17
              const cb = (rgb4 & 15) * 17
              const px = originX + i * pw
              for (let dx = 0; dx < pw; dx++) {
                const tx = px + dx
                if (tx < 0 || tx >= W) continue
                const o = (r * W + tx) * 4
                data[o] = cr
                data[o + 1] = cg
                data[o + 2] = cb
                data[o + 3] = 255
              }
            }
          }
        }
        // end of line: the modulo joins the fetched words (BPL1MOD, odd planes)
        if (fetching) ptr += words * 2 + mod1
      }
      if (to > line) line = end
    }

    while (p + 4 <= phys.length) {
      const w1 = (phys[p]! << 8) | phys[p + 1]!
      const w2 = (phys[p + 2]! << 8) | phys[p + 3]!
      p += 4
      if (w1 & 1) {
        if (w1 === 0xffff && w2 === 0xfffe) break
        const vp = (w1 >> 8) & 0xff
        if (vp === 0xff && !cross) {
          renderLines(256)
          cross = true
          continue
        }
        renderLines(vp + (cross ? 256 : 0))
      } else {
        const reg = w1 & 0x1fe
        if (reg >= 0x180 && reg < 0x1c0) {
          hwPal[(reg - 0x180) >> 1] = w2 & 0xfff
        } else if (reg >= 0x0e0 && reg <= 0x0f6) {
          const idx = (reg - 0xe0) >> 2
          if (reg & 2) bplL[idx] = w2
          else bplH[idx] = w2
          if (idx === 0 && bplH[0]! >= 0 && bplL[0]! >= 0) {
            const ad = (((bplH[0]! << 16) | bplL[0]!) >>> 0)
            screen = null
            if (ad >= Runtime.SCREEN_CHIP_BASE && ad < Runtime.SCREEN_CHIP_BASE + 8 * Runtime.SCREEN_CHIP_SLOT) {
              const rel = ad - Runtime.SCREEN_CHIP_BASE
              const s = this.screens.get(Math.floor(rel / Runtime.SCREEN_CHIP_SLOT))
              if (s) {
                let within = rel % Runtime.SCREEN_CHIP_SLOT
                usePhy = within >= Runtime.SCREEN_PHY_OFFSET
                if (usePhy) within -= Runtime.SCREEN_PHY_OFFSET
                screen = s
                ptr = within
              }
            }
          }
        } else if (reg >= 0x120 && reg <= 0x13e) {
          const idx = (reg - 0x120) >> 2
          if (reg & 2) sprL[idx] = w2
          else sprH[idx] = w2
          sprSet = true
        } else if (reg === 0x100) {
          hires = (w2 & 0x8000) !== 0
        } else if (reg === 0x102) {
          bplcon1 = w2 & 0xff
        } else if (reg === 0x104) {
          bplcon2 = w2 & 0x7f
        } else if (reg === 0x108) {
          mod1 = (w2 << 16) >> 16 // signed word
        } else if (reg === 0x10a) {
          mod2 = (w2 << 16) >> 16
        } else if (reg === 0x092) {
          ddfstrt = w2 & 0xfe
        } else if (reg === 0x094) {
          ddfstop = w2 & 0xfe
        } else if (reg === 0x096) {
          if (w2 & 0x8000) {
            if (w2 & 0x0100) dmaOn = true
          } else if (w2 & 0x0100) {
            dmaOn = false
          }
        } else if (reg === 0x08e) {
          hstart = w2 & 0xff
        } else if (reg === 0x090) {
          // DIWSTOP's H8 is inverted on the hardware, so a stop right of
          // colour clock 255 is written with the bit clear
          hstop = (w2 & 0xff) | 0x100
        }
      }
    }
    renderLines(313)
    // carry the register file into the next frame
    R.pal.set(hwPal)
    R.dmaOn = dmaOn
    R.hires = hires
    R.hstart = hstart
    R.hstop = hstop
    R.ddfstrt = ddfstrt
    R.ddfstop = ddfstop
    R.mod1 = mod1
    R.mod2 = mod2
    R.bplcon1 = bplcon1
    R.bplcon2 = bplcon2
    R.bplH.set(bplH)
    R.bplL.set(bplL)
    R.sprH.set(sprH)
    R.sprL.set(sprL)
    R.sprSet = sprSet
    R.screenIdx = screen ? screen.index : -1
    R.usePhy = usePhy
    // the pointer keeps whatever the walk left it at: nothing reloads
    // BPLxPT at the vertical blank, the copper list does it, so a list that
    // sets the pointers once and never again really does march off the
    // bitmap on its second frame
    R.ptr = ptr
  }

  /**
   * Hardware sprites straight out of SPRxPT (Copper Off).
   *
   * The system list leaves eight patch slots at $120-$13E for HsAff to fill
   * in (HsCop +W.s:6783); once the program owns the list they are its to
   * write, and the data behind them is the plain Amiga sprite structure:
   * SPRxPOS/SPRxCTL, then VSTOP-VSTART rows of two bitplane words, then a
   * zero long to end. Pair n draws in colours 17+4n..19+4n; CTL bit 7
   * attaches the odd sprite to the even one for a single 16-colour sprite
   * out of colours 16-31.
   */
  private drawListSprites(data: Uint8ClampedArray, W: number, H: number, frontPass: boolean): void {
    const R = this.copRegs
    const pf1p = R.bplcon2 & 7
    const pal = R.pal
    /** decoded pixels of one channel: y*1024+hx -> 2-bit colour */
    const decode = (n: number): Map<number, number> => {
      const out = new Map<number, number>()
      if (R.sprH[n]! < 0 || R.sprL[n]! < 0) return out
      const m = this.resolveAddr((((R.sprH[n]! << 16) | R.sprL[n]!) >>> 0))
      if (!m) return out
      const mem = m.data
      let o = m.off
      const w = (i: number): number => (i + 1 < mem.length ? (mem[i]! << 8) | mem[i + 1]! : 0)
      // one pointer can chain several sprites down the display
      for (let guard = 0; guard < 32; guard++) {
        if (o + 4 > mem.length) break
        const pos = w(o)
        const ctl = w(o + 2)
        if (pos === 0 && ctl === 0) break
        const vstart = ((pos >> 8) & 0xff) | (ctl & 4 ? 0x100 : 0)
        let vstop = ((ctl >> 8) & 0xff) | (ctl & 2 ? 0x100 : 0)
        const hx = ((pos & 0xff) << 1) | (ctl & 1)
        if (vstop < vstart) vstop = vstart
        if (vstop - vstart > 313) vstop = vstart + 313
        o += 4
        for (let y = vstart; y < vstop && o + 4 <= mem.length; y++) {
          const a = w(o)
          const b = w(o + 2)
          o += 4
          for (let x = 0; x < 16; x++) {
            const bit = 15 - x
            const v = ((a >> bit) & 1) | (((b >> bit) & 1) << 1)
            if (v !== 0) out.set(y * 1024 + ((hx + x) & 1023), v)
          }
        }
      }
      return out
    }
    /** ATTACH lives in the odd sprite's control word */
    const attached = (n: number): boolean => {
      if (R.sprH[n]! < 0 || R.sprL[n]! < 0) return false
      const m = this.resolveAddr((((R.sprH[n]! << 16) | R.sprL[n]!) >>> 0))
      if (!m || m.off + 4 > m.data.length) return false
      return (((m.data[m.off + 2]! << 8) | m.data[m.off + 3]!) & 0x80) !== 0
    }
    const put = (hx: number, hy: number, rgb4: number): void => {
      const bx = (hx - 128) * 2
      const by = (hy - Runtime.COMPOSITE_TOP) * 2
      const cr = ((rgb4 >> 8) & 15) * 17
      const cg = ((rgb4 >> 4) & 15) * 17
      const cb = (rgb4 & 15) * 17
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const tx = bx + dx
          const ty = by + dy
          if (tx < 0 || ty < 0 || tx >= W || ty >= H) continue
          const o = (ty * W + tx) * 4
          data[o] = cr
          data[o + 1] = cg
          data[o + 2] = cb
        }
      }
    }
    // pairs draw back-to-front: 3, 2, 1, 0 — sprite 0 tops the display
    for (let pair = 3; pair >= 0; pair--) {
      if (frontPass ? !(pair < pf1p) : pair < pf1p) continue
      const even = decode(pair * 2)
      const odd = decode(pair * 2 + 1)
      if (attached(pair * 2 + 1)) {
        for (const k of new Set([...even.keys(), ...odd.keys()])) {
          const v = (even.get(k) ?? 0) | ((odd.get(k) ?? 0) << 2)
          if (v !== 0) put(k & 1023, Math.floor(k / 1024), pal[16 + v]! & 0xfff)
        }
        continue
      }
      for (const [k, v] of odd) put(k & 1023, Math.floor(k / 1024), pal[16 + pair * 4 + v]! & 0xfff)
      for (const [k, v] of even) put(k & 1023, Math.floor(k / 1024), pal[16 + pair * 4 + v]! & 0xfff)
    }
  }

  /** Workbench-style menu bar while the right button is held */

  /**
   * The real bob pipeline (the vbl Actualise): restore the saved
   * backgrounds of the previous frame in reverse order, then draw every
   * bob into the LOGICAL buffer, saving what was underneath. Point,
   * Screen Copy and Get Bob therefore see bobs, exactly as with a
   * single-buffered real AMOS.
   */
  updateBobs(): void {
    // restore, newest first
    const saved = [...this.bobSaved.entries()].reverse()
    for (const [n, bg] of saved) {
      const s = this.screens.get(bg.screen)
      if (s) {
        for (let y = 0; y < bg.h; y++) {
          s.pixels.set(bg.data.subarray(y * bg.w, (y + 1) * bg.w), (bg.y + y) * s.width + bg.x)
        }
      }
      this.bobSaved.delete(n)
    }
    // draw in priority order
    const bobs = [...this.bobs.values()]
    bobs.sort((a, b) => {
      if (!this.priorityOn) return a.n - b.n
      return this.priorityReverse ? b.y - a.y : a.y - b.y
    })
    for (const bob of bobs) {
      const s = this.screens.get(bob.screen)
      const img = this.spriteBank?.image(bob.image)
      if (!s || !img) continue
      const mode = this.bobModes.get(bob.n) ?? 0
      const limit = this.bobLimits.get(bob.n) ?? this.bobLimits.get(-1)
      let bx = bob.x
      let by = bob.y
      if (limit) {
        bx = Math.max(limit.x1 + img.hotX, Math.min(limit.x2 - (img.width - img.hotX), bx))
        by = Math.max(limit.y1 + img.hotY, Math.min(limit.y2 - (img.height - img.hotY), by))
        bob.x = bx
        bob.y = by
      }
      const dx = bx - img.hotX
      const dy = by - img.hotY
      // clip the rect to the screen
      const x1 = Math.max(0, dx)
      const y1 = Math.max(0, dy)
      const x2 = Math.min(s.width, dx + img.width)
      const y2 = Math.min(s.height, dy + img.height)
      if (x1 >= x2 || y1 >= y2) continue
      if (mode >= 0) {
        const w = x2 - x1
        const h = y2 - y1
        const data = new Uint8Array(w * h)
        if (mode === 0) {
          for (let y = 0; y < h; y++) {
            data.set(s.pixels.subarray((y1 + y) * s.width + x1, (y1 + y) * s.width + x2), y * w)
          }
        } else {
          data.fill((mode - 1) & 63)
        }
        this.bobSaved.set(bob.n, { screen: bob.screen, x: x1, y: y1, w, h, data })
      }
      // Set Bob's plane mask restricts which bitplanes the bob writes, so a
      // bob can be confined to (say) the low two planes of a 16-colour screen
      // and leave the rest of the background showing through (BbAPlan).
      const planes = this.bobPlanes.get(bob.n) ?? -1
      for (let y = y1; y < y2; y++) {
        const iy = y - dy
        for (let x = x1; x < x2; x++) {
          const v = img.pixels[iy * img.width + (x - dx)]!
          if (v === 0 && !img.opaque) continue
          const i = y * s.width + x
          s.pixels[i] = planes === -1 ? v : (s.pixels[i]! & ~planes) | (v & planes)
        }
      }
    }
  }

  /** restore all bob backgrounds now (Bob Clear) */
  clearBobs(): void {
    const saved = [...this.bobSaved.entries()].reverse()
    for (const [n, bg] of saved) {
      const s = this.screens.get(bg.screen)
      if (s) {
        for (let y = 0; y < bg.h; y++) {
          s.pixels.set(bg.data.subarray(y * bg.w, (y + 1) * bg.w), (bg.y + y) * s.width + bg.x)
        }
      }
      this.bobSaved.delete(n)
    }
  }

  /** decode a screen id from Logic()/Physic() (bit 31 set, bit 30 = physic) */
  resolveScreenId(id: number): { s: Screen; buf: Uint8Array } {
    if (id < 0) {
      const physic = (id & 0x40000000) !== 0
      const n = id & 0xff
      const useCurrent = (id & 0x3fffff00) === 0x3fffff00 // bare Logic/Physic (-1 based)
      const s = this.screens.get(useCurrent ? this.currentIndex : n)
      if (!s) throw new AmosError(`screen not opened: ${useCurrent ? this.currentIndex : n}`)
      return { s, buf: s.bufferFor(physic ? 'physic' : 'logic') }
    }
    const s = this.screens.get(id)
    if (!s) throw new AmosError(`screen not opened: ${id}`)
    return { s, buf: s.pixels }
  }

  /**
   * The PF1P in force at a hardware scanline: the topmost visible screen
   * covering it, else the frontmost screen (EcCon2, HsPri +W.s:11374).
   */
  private priorityUnder(hy: number): number {
    for (let i = this.order.length - 1; i >= 0; i--) {
      const s = this.screens.get(this.order[i]!)
      if (!s || !s.visible) continue
      if (hy >= s.displayY && hy < s.displayY + s.height) return s.pf1p
    }
    return this.screens.get(this.order[this.order.length - 1] ?? 0)?.pf1p ?? 4
  }

  /**
   * Which hardware channel each sprite ends up on (HsAff +W.s:11742-11960).
   *
   * Sprites 0-7 are "direct": they own the channel of the same number, and
   * a visible mouse pointer holds channel 0 (HsAff's T_MouShow test). Every
   * higher sprite is "computed" and shares what is left, which is the whole
   * point of the multiplexer: the channels are re-used down the display, so
   * a sprite only needs a channel free from its own top line onward.
   *
   * The 68k sorts them by top edge (HsYr, ties by sprite number — Hss20-23)
   * and packs them round-robin: try channels from where the last one landed,
   * take the first whose previous occupant has already finished above this
   * sprite's top (`HsYr >= HsYAct`) and which still has room in its column
   * buffer (`HsPAct + height+1 <= HsPMax`), and give up after eight misses.
   * A sprite wider than 16 pixels takes that many channels side by side, and
   * a 16-colour one must start on an even channel (HsMAff).
   *
   * This decides the sprite's *pair*, so it decides whether it is in front
   * of the playfield: exactly the thing that used to be guessed by calling
   * every computed sprite pair 3.
   */
  spriteChannels(sprites: HwSprite[]): Map<number, number> {
    const out = new Map<number, number>()
    const free = [true, true, true, true, true, true, true, true]
    const yAct = new Int32Array(8)
    const pAct = new Int32Array(8)
    const computed: { sp: HwSprite; yr: number; h: number; w: number; multi: boolean }[] = []
    for (const sp of sprites) {
      if (sp.n < 8) {
        out.set(sp.n, sp.n)
        free[sp.n] = false
        continue
      }
      const img = this.spriteBank?.image(sp.image)
      if (!img) continue
      computed.push({
        sp,
        yr: Math.max(0, sp.y - img.hotY),
        h: img.height + 1,
        w: Math.max(1, Math.ceil(img.width / 16)),
        multi: img.depth > 2,
      })
    }
    if (this.mouseShow >= 0) free[0] = false
    // HsPMax = lines - 2 words per column (HsRBuf +W.s:11311)
    const pMax = Math.max(0, this.spriteBufferLines - 2)
    computed.sort((a, b) => a.yr - b.yr || a.sp.n - b.sp.n)
    let cur = 0
    for (const c of computed) {
      for (let tries = 0; tries < 8; tries++) {
        const col = (cur + tries) % 8
        if (!free[col]) continue
        if (c.multi && col % 2 !== 0) continue
        if (c.yr < yAct[col]! || pAct[col]! + c.h > pMax) continue
        out.set(c.sp.n, col)
        // a wide sprite occupies consecutive channels, 16 pixels apart
        for (let k = 0; k < c.w && col + k < 8; k++) {
          yAct[col + k] = c.yr + c.h
          pAct[col + k] = pAct[col + k]! + c.h
        }
        cur = (col + c.w) % 8
        break
      }
    }
    return out
  }

  /** Hardware sprites draw over everything, colours 16-31, hw coords. */
  private drawHwSprites(data: Uint8ClampedArray, W: number, H: number, frontPass: boolean, pf1pOverride?: number): void {
    const list = this.spriteList()
    for (let r = 0; r < H; r++) {
      this.blitSpriteRow(data, W, r, list, null, (pair) => {
        const p = pf1pOverride ?? this.priorityUnder(Runtime.COMPOSITE_TOP + (r >> 1))
        return frontPass ? pair < p : pair >= p
      })
    }
  }

  /**
   * The visible hardware sprites, each with the channel pair it landed on.
   *
   * The mouse pointer is hardware sprite 0 — HiSho1 sets it up through the
   * same HsSet channel 0 — so it is pair 0, and it goes last so it tops
   * whatever else shares its layer.
   */
  private spriteList(): { img: BankImage; hx: number; hy: number; pair: number }[] {
    const sprites = this.spriteUpdateOn ? [...this.hwSprites.values()] : (this.frozenSprites ?? [])
    const channels = this.spriteChannels(sprites)
    const out: { img: BankImage; hx: number; hy: number; pair: number }[] = []
    for (const sp of sprites) {
      const img = this.spriteBank?.image(sp.image)
      if (img) out.push({ img, hx: sp.x, hy: sp.y, pair: (channels.get(sp.n) ?? 6) >> 1 })
    }
    if (this.copperOn && this.mouseShow >= 0 && this.mouseShape !== null) {
      out.push({ img: this.mouseShape, hx: this.input.mouseX, hy: this.input.mouseY, pair: 0 })
    }
    return out
  }

  /**
   * Blit one output row's worth of the sprites whose pair `keep` accepts.
   *
   * Row at a time because that is the only way the playfield can be drawn
   * between two sprite layers, which is what PF1P and PF2P describe: a
   * sprite pair can be in front of one playfield and behind the other.
   */
  private blitSpriteRow(
    data: Uint8ClampedArray,
    W: number,
    r: number,
    list: { img: BankImage; hx: number; hy: number; pair: number }[],
    pal: Uint16Array | null,
    keep: (pair: number) => boolean,
  ): void {
    const fallback = this.screens.get(this.order[this.order.length - 1] ?? 0)?.palette
    for (const { img, hx, hy, pair } of list) {
      if (!keep(pair)) continue
      const by = (hy - img.hotY - Runtime.COMPOSITE_TOP) * 2
      const iy = (r - by) >> 1
      if (iy < 0 || iy >= img.height) continue
      const bx = (hx - img.hotX - 128) * 2
      for (let x = 0; x < img.width; x++) {
        const v = img.pixels[iy * img.width + x]!
        if (v === 0) continue
        const rgb4 = (pal ? pal[16 + (v & 15)] : fallback?.[16 + (v & 15)]) ?? 0
        const cr = ((rgb4 >> 8) & 15) * 17
        const cg = ((rgb4 >> 4) & 15) * 17
        const cb = (rgb4 & 15) * 17
        for (let dx = 0; dx < 2; dx++) {
          const tx = bx + x * 2 + dx
          if (tx < 0 || tx >= W) continue
          const o = (r * W + tx) * 4
          data[o] = cr
          data[o + 1] = cg
          data[o + 2] = cb
        }
      }
    }
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

/** "DH0:Games" + "Zybex" → "DH0:Games/Zybex"; volume roots need no slash */
function joinAmigaPath(path: string, name: string): string {
  if (path === '' || path.endsWith(':') || path.endsWith('/')) return path + name
  return `${path}/${name}`
}

function parentAmigaPath(path: string): string {
  const noSlash = path.replace(/\/$/, '')
  const i = noSlash.lastIndexOf('/')
  if (i >= 0) return noSlash.slice(0, i)
  const c = noSlash.indexOf(':')
  return c >= 0 ? noSlash.slice(0, c + 1) : noSlash
}

function amigaPatternRx(pattern: string): RegExp {
  return amigaPattern(pattern)
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
    const widthWords = (img.width + 15) >> 4
    const hdr = new Uint8Array(10)
    const hv = new DataView(hdr.buffer)
    hv.setUint16(0, widthWords)
    hv.setUint16(2, img.height)
    hv.setUint16(4, img.depth)
    hv.setUint16(6, img.hotX)
    hv.setUint16(8, img.hotY)
    parts.push(hdr)
    const rowBytes = widthWords * 2
    const planar = new Uint8Array(rowBytes * img.height * img.depth)
    for (let plane = 0; plane < img.depth; plane++) {
      const bit = 1 << plane
      const planeBase = plane * rowBytes * img.height
      for (let y = 0; y < img.height; y++) {
        const rowBase = planeBase + y * rowBytes
        for (let x = 0; x < img.width; x++) {
          if (img.pixels[y * img.width + x]! & bit) planar[rowBase + (x >> 3)]! |= 1 << (7 - (x & 7))
        }
      }
    }
    parts.push(planar)
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
