import type { TokenLine } from '../tokens/stream'
import { TokenTable } from '../tokens/stream'
import { Interp, newInputState } from '../interp/interp'
import type { AmosArray, InputState, InterpOptions, RunResult } from '../interp/interp'
import type { AmosIO } from '../interp/io'
import { AmosError } from '../interp/values'
import type { Bank, MemoryBank } from '../loader/amosfile'
import { parseAmosFile } from '../loader/amosfile'
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
import { NullAudio, parseSampleBank } from './audio'
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
 * The system flash sequence (interpreter-config message 46,
 * +Interpreter_Config.s:186) — Screen Open runs `Flash 3` with it on any
 * screen deeper than one plane (+Lib.s:8989), which is what makes the
 * out-of-the-box cursor pulse gold-white-blue.
 */
export const DEFAULT_FLASH_SPEC =
  '(000,2)(440,2)(880,2)(bb0,2)(dd0,2)(ee0,2)(ff2,2)(ff8,2)(ffc,2)(fff,2)(aaf,2)(88c,2)(66a,2)(226,2)(004,2)(001,2)'

export function parseFlashSpec(spec: string): Array<{ rgb: number; ticks: number }> {
  const seq: Array<{ rgb: number; ticks: number }> = []
  for (const m of spec.matchAll(/\(\s*([0-9a-f]+)\s*,\s*(\d+)\s*\)/gi)) {
    seq.push({ rgb: parseInt(m[1]!, 16) & 0xfff, ticks: Math.max(1, parseInt(m[2]!, 10)) })
  }
  return seq
}

/** the default cursor shape: an underline (DefCurs +W.s:16736) */
export const CURSOR_SHAPE = [0, 0, 0, 0, 0, 0, 0xff, 0xff]

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
  /** Flash n,"(rgb,ticks)...": palette-register animations, each bound to
   * the screen that was current at Flash time (FlInt +W.s:5678 stores the
   * screen address in the flash record) */
  flashes = new Map<number, { seq: Array<{ rgb: number; ticks: number }>; idx: number; left: number; screen: number }>()
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
  bobModes = new Map<number, number>()
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
  /** per-voice: busy-until tick and volume */
  voices = [
    { until: 0, volume: 63 },
    { until: 0, volume: 63 },
    { until: 0, volume: 63 },
    { until: 0, volume: 63 },
  ]
  /** Sam Loop On voice mask */
  samLoopMask = 0
  // ---- file channels (Open In/Out, Print #, Input #) ----
  fileChans = new Map<
    number,
    { mode: 'in' | 'out'; path: string; data: Uint8Array; pos: number; out: number[] }
  >()
  /** Set Input line terminator pair (default CR, skip LF) */
  chrInp: [number, number] = [13, 10]
  /** Dir First$/Dir Next$ iterator */
  dirIter: { entries: Array<{ name: string; isDir: boolean }>; idx: number } | null = null
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
      // logical buffer where Cop Logic readers see it. (The real machine
      // also hides the mouse pointer, T_MouShow=-1 — a front-end concern.)
      this.copPos = 0
      const l = this.copLogic
      l[0] = 0xff
      l[1] = 0xff
      l[2] = 0xff
      l[3] = 0xfe
      this.copLogIsA = !this.copLogIsA
      this.copPos = 0
      this.copCross = false
    } else {
      if (this.copperOn) return
      this.copperOn = true
      this.buildCopperList() // EcForceCop: recalcule les listes
    }
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

  reserveBank(n: number, length: number, name: string, dataBank = true): void {
    // flags bit 0 = Bnk_BitData (+Equ.s:1865): Data banks survive Erase Temp,
    // Work banks (bit clear) do not
    this.memBanks.set(n, { kind: 'memory', number: n, memType: 0, name, flags: dataBank ? 1 : 0, data: new Uint8Array(length) })
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
    const prevScreen = this.currentIndex
    // a system screen outside the user range 0-7 (like the 68k's Fs_ScOpen)
    const s = new Screen(9, 640, 200, res!.graphics?.nColors ?? 8, 0x8000)
    this.screens.set(9, s)
    this.order = this.order.filter((i) => i !== 9)
    this.order.push(9)
    this.currentIndex = 9
    s.cls(0)
    if (res!.graphics) for (let i = 0; i < 32; i++) s.palette[i] = res!.graphics.palette[i]!
    let chan = 65536
    while (this.dialogs.has(chan)) chan++
    const d = new DialogChannel(chan, 32, res!)
    d.script = prog
    d.screenNb = 9
    try {
      const scan = prescanDialog(prog)
      d.labels = scan.labels
      d.userInstrs = scan.userInstrs
    } catch {
      this.closeScreen(9)
      this.setCurrent(prevScreen)
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
      screenNb: 9,
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
    this.setCurrent(f.prevScreen)
    f.done = true
    f.result = result
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
  dualPlayfield: { front: number; back: number; pf2Front: boolean } | null = null
  /** Auto View Off: newly opened screens stay hidden until View */
  autoView = true
  pendingView = new Set<number>()
  /** Request On (1) / Off (0) / Wb (2) — no requesters exist in the port */
  requestMode = 1
  /** Set Font / Get Fonts state (single-face Topaz port) */
  currentFont = 1
  fontsListed = false
  // ---- sprite update freeze ----
  spriteUpdateOn = true
  frozenSprites: HwSprite[] | null = null
  /** Sprite Priority (HsPri): 0..4 sprite-vs-playfield z-order; 4 = behind */
  /**
   * Sprite Priority (BPLCON2 PF2P, HsPri +W.s:11374): sprite PAIRS below
   * this value show in front of the playfield, pairs at/above it behind.
   * EcCree initialises EcCon2 to %100100 — PF2P 4, every pair in front.
   */
  spritePriority = 4
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
    vumeter: (voice) => this.vumeter(voice),
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

  chan(n: number): { mode: 'in' | 'out'; path: string; data: Uint8Array; pos: number; out: number[] } {
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
    }
    this.fileChans.delete(n)
  }

  getSample(n: number): SampleEntry | null {
    const bank = this.memBanks.get(this.samBankNum)
    if (!bank) return null
    if (this.sampleCache?.bank !== bank) {
      this.sampleCache = { bank, entries: parseSampleBank(bank.data) }
    }
    return this.sampleCache.entries[n - 1] ?? null
  }

  /** start PCM on every voice in the mask, tracking busy state for Vumeter */
  playPcm(mask: number, pcm: Int8Array, freq: number, loop: boolean): void {
    if (freq <= 0 || pcm.length === 0) return
    const ticks = loop ? Infinity : Math.ceil((pcm.length / freq) * 50)
    for (let v = 0; v < 4; v++) {
      if (!(mask & (1 << v))) continue
      this.audio.play(v, pcm, freq, this.voices[v]!.volume, loop ? 0 : -1)
      this.voices[v]!.until = this.interp.tick + ticks
    }
  }

  stopVoices(mask: number): void {
    for (let v = 0; v < 4; v++) {
      if (!(mask & (1 << v))) continue
      this.audio.stop(v)
      this.voices[v]!.until = 0
    }
  }

  /**
   * Approximate Vumeter: the real one reads the sample amplitude from the
   * audio interrupt; we synthesize a lively deterministic level while the
   * voice is busy.
   */
  vumeter(voice: number): number {
    const v = this.voices[voice & 3]
    if (!v || this.interp.tick >= v.until) return 0
    const wob = 16 + ((Math.floor(this.interp.tick) * 13 + voice * 7) % 48)
    return Math.min(63, Math.floor((wob * v.volume) / 63))
  }

  stepAmal(): void {
    const nums = [...this.channels.keys()].sort((a, b) => a - b)
    for (const n of nums) {
      const ch = this.channels.get(n)!
      if (ch.on && !ch.frozen) ch.step(this.amalHost)
    }
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
        this.screen.pen = n
      },
      paper: (n) => {
        this.screen.paper = n
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
    this.fs = opts.fs ?? null
    if (opts.audio) this.audio = opts.audio
    for (const bank of opts.banks ?? []) {
      if (bank.kind === 'sprites') this.spriteBank = ObjectBank.fromSpriteBank(bank)
      else if (bank.kind === 'icons') this.iconBank = ObjectBank.fromSpriteBank(bank)
      else if (bank.kind === 'memory') this.memBanks.set(bank.number, bank)
    }
    // AMOS boots with screen 0: 320x200, 16 colours, lowres
    this.openScreen(0, 320, 200, 16, 0)
  }

  /** the sprite bank, created on demand (Get Bob into an empty bank) */
  needSpriteBank(): ObjectBank {
    this.spriteBank ??= new ObjectBank()
    return this.spriteBank
  }

  /** Stamp an image into a screen's framebuffer (Paste Bob / Unpack / Load Iff). */
  blit(s: Screen, img: { width: number; height: number; pixels: Uint8Array }, dx: number, dy: number, opaque: boolean): void {
    for (let y = 0; y < img.height; y++) {
      const ty = dy + y
      if (ty < 0 || ty >= s.height) continue
      for (let x = 0; x < img.width; x++) {
        const v = img.pixels[y * img.width + x]!
        if (!opaque && v === 0) continue
        const tx = dx + x
        if (tx < 0 || tx >= s.width) continue
        if (s.inClip(tx, ty)) s.pixels[ty * s.width + tx] = v
      }
    }
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
    for (let i = 0; i < this.defaultPalette.length && i < 32; i++) s.palette[i] = this.defaultPalette[i]!
    this.screens.set(n, s)
    this.order = this.order.filter((i) => i !== n)
    this.order.push(n)
    this.currentIndex = n
    s.cls()
    // "Fait flasher la couleur 3" — Screen Open installs the system flash
    // on colour 3 of any screen deeper than one plane (+Lib.s:8989)
    if (nColors > 2) {
      const seq = parseFlashSpec(DEFAULT_FLASH_SPEC)
      this.flashes.set(3, { seq, idx: 0, left: seq[0]!.ticks, screen: n })
    }
    if (!this.autoView) {
      // Auto View Off: the display change is deferred until View
      s.visible = false
      this.pendingView.add(n)
    }
    return s
  }

  closeScreen(n: number): void {
    // closing either half of a dual-playfield pair dissolves it (EcDel)
    const dp = this.dualPlayfield
    if (dp && (dp.front === n || dp.back === n)) {
      const back = this.screens.get(dp.back)
      if (back) back.visible = true
      this.dualPlayfield = null
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
    this.input.keyQueue.push({ ch, scan })
  }

  /** Submit a line for a pending Input statement. */
  submitLine(line: string): void {
    this.pendingLine = line
  }

  // ---- the clock ----

  /** Advance one 50Hz frame: release expired waits, run a slice. */
  frame(): RunResult {
    this.interp.tick++
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
    for (const [reg, fl] of this.flashes) {
      if (--fl.left > 0) continue
      fl.idx = (fl.idx + 1) % fl.seq.length
      const step = fl.seq[fl.idx]!
      fl.left = step.ticks
      // FlInt writes EcPal of the screen recorded at Flash time, not
      // whichever screen is current now (+W.s:5700)
      const s = this.screens.get(fl.screen)
      if (s) s.palette[reg & 31] = step.rgb & 0xfff
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
      if (b?.type === 'wait') this.interp.tick = Math.max(this.interp.tick, b.until - 1)
      else if (b?.type === 'waitKey') this.pressKey('\r', 0x44)
      else if (b?.type === 'input') this.submitLine('')
      else if (b?.type === 'dialog') {
        const d = this.dialogs.get(b.channel)
        if (d && d.runState === 'waiting') this.finishDialogRun(d, 0)
        else this.interp.blocked = null
      } else if (b?.type === 'fsel') {
        if (this.fsel && !this.fsel.done) this.finishFsel('')
        else this.interp.blocked = null
      }
    }
    return { status, frames, unimplemented: this.interp.unimplemented }
  }

  // ---- video out ----

  /** Compose all visible screens into a 640x400 RGBA frame. */
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
    const dual = this.dualPlayfield
    if (dual && f && f === this.screens.get(dual.back) && this.screens.has(dual.front)) {
      const df = this.screens.get(dual.front)!
      if (df.visible && this.coversLine(df, L)) f = df
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
        put(0x0024)
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
    const H = 400
    const data = out ?? new Uint8ClampedArray(W * H * 4)
    this.activateRainbows()
    // Copper Off: the display is whatever the user's physical list says
    if (!this.copperOn) {
      this.drawHwSprites(data, W, H, false)
      this.compositeFromList(data, W, H)
      this.drawHwSprites(data, W, H, true)
      return { width: W, height: H, data }
    }
    // rainbows in slot order — the copper machine scans 0..NbRain-1
    const rbs = [...this.rainbows.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, r]) => r)
      .filter((r) => r.table.length > 0 && r.h >= 0 && r.ty > 0)
    const dual = this.dualPlayfield
    const dualBack = dual && this.screens.has(dual.front) && this.screens.has(dual.back) ? this.screens.get(dual.back)! : null
    // behind-playfield sprite pairs draw first, in-front pairs after
    this.drawHwSprites(data, W, H, false)

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
      const baseY = (posFrom.displayY - 50) * 2
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

    for (let L = 50; L < 250; L++) {
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
      // render the two output rows of this hardware line
      const bg = hwPal[0]!
      const bgR = ((bg >> 8) & 15) * 17
      const bgG = ((bg >> 4) & 15) * 17
      const bgB = (bg & 15) * 17
      const r0 = (L - 50) * 2
      for (const r of [r0, r0 + 1]) {
        for (let o = r * W * 4; o < (r + 1) * W * 4; o += 4) {
          data[o] = bgR
          data[o + 1] = bgG
          data[o + 2] = bgB
          data[o + 3] = 255
        }
        if (f) {
          const isDualFront = dual !== null && dualBack !== null && f === this.screens.get(dual.front)
          if (!isDualFront) {
            drawRow(f, r, hwPal, false)
          } else if (!dual!.pf2Front) {
            // PF1 priority (default): PF2 behind through palette 8-15
            drawRow(dualBack!, r, hwPal, true, 8, f)
            drawRow(f, r, hwPal, true)
          } else {
            // Dual Priority named the back screen first: PF2 in front
            drawRow(f, r, hwPal, true)
            drawRow(dualBack!, r, hwPal, true, 8, f)
          }
        }
      }
    }
    this.drawHwSprites(data, W, H, true)
    return { width: W, height: H, data }
  }

  /**
   * Interpret the physical copper list (Copper Off mode): a beam walk over
   * the real word stream. WAITs advance the line (a $FFxx vpos is the
   * 255-crossing; $FFFF/$FFFE ends the list); MOVEs apply at the current
   * line — COLORxx into the live palette, BPL1PTH/L resolved back to a
   * screen + row through the chip-RAM map, BPLCON0's hires bit, DMACON's
   * raster enable, DIWSTRT's horizontal start. DIWSTOP/DDF/modulos/
   * BPLCON1-2/sprite pointers are parsed and ignored (the fetch geometry
   * comes from the resolved screen). Registers start each frame from the
   * fond (real hardware would carry last frame's values).
   */
  private compositeFromList(data: Uint8ClampedArray, W: number, H: number): void {
    const phys = this.copPhysic
    const hwPal = new Uint16Array(32)
    hwPal[0] = this.colourBack & 0xfff
    let p = 0
    let line = 0
    let cross = false
    let dmaOn = false
    let hires = false
    let hstart = 0x81
    let screen: Screen | null = null
    let usePhy = false
    let srcRow = 0
    const bplH = new Int32Array(8).fill(-1)
    const bplL = new Int32Array(8).fill(-1)
    const cs = this.screens.get(this.currentIndex) ?? null
    const cw = cs?.curWin ?? null
    const curX0 = cw ? cw.x + cw.curX * 8 : 0
    const curY0 = cw ? cw.y + cw.curY * 8 : 0

    const renderLines = (to: number): void => {
      const end = Math.min(to, 313)
      for (; line < end; line++) {
        const fetching = dmaOn && screen !== null
        if (line >= 50 && line < 250) {
          const bg = hwPal[0]!
          const bgR = ((bg >> 8) & 15) * 17
          const bgG = ((bg >> 4) & 15) * 17
          const bgB = (bg & 15) * 17
          const r0 = (line - 50) * 2
          for (let ri = 0; ri < 2; ri++) {
            const r = r0 + ri
            for (let o = r * W * 4; o < (r + 1) * W * 4; o += 4) {
              data[o] = bgR
              data[o + 1] = bgG
              data[o + 2] = bgB
              data[o + 3] = 255
            }
            if (!fetching) continue
            const s = screen!
            const sy = s.laced ? srcRow + ri : srcRow
            if (sy < 0 || sy >= s.height) continue
            const pixels = usePhy ? s.displayBuffer : s.pixels
            const pw = hires ? 1 : 2
            const baseX = (hstart - 1 - 128) * 2
            const isCur = s === cs && s.cursorOn && cw !== null && sy >= curY0 && sy < curY0 + 8
            const mask = isCur ? CURSOR_SHAPE[sy - curY0]! : 0
            const colour = this.rowColours(s, hwPal)
            for (let sx = 0; sx < s.width; sx++) {
              let pix = pixels[sy * s.width + sx]! & 63
              if (mask !== 0 && sx >= curX0 && sx < curX0 + 8 && (mask << (sx - curX0)) & 0x80) pix = cw!.cuCol & 63
              const rgb4 = colour(pix)
              const cr = ((rgb4 >> 8) & 15) * 17
              const cg = ((rgb4 >> 4) & 15) * 17
              const cb = (rgb4 & 15) * 17
              const px = baseX + sx * pw
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
        if (fetching) srcRow += screen!.laced ? 2 : 1
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
                srcRow = Math.floor(within / s.rowBytes)
              }
            }
          }
        } else if (reg === 0x100) {
          hires = (w2 & 0x8000) !== 0
        } else if (reg === 0x096) {
          if (w2 & 0x8000) {
            if (w2 & 0x0100) dmaOn = true
          } else if (w2 & 0x0100) {
            dmaOn = false
          }
        } else if (reg === 0x08e) {
          hstart = w2 & 0xff
        }
      }
    }
    renderLines(313)
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
      for (let y = y1; y < y2; y++) {
        const iy = y - dy
        for (let x = x1; x < x2; x++) {
          const v = img.pixels[iy * img.width + (x - dx)]!
          if (v !== 0 || img.opaque) s.pixels[y * s.width + x] = v
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

  /** Hardware sprites draw over everything, colours 16-31, hw coords. */
  private drawHwSprites(data: Uint8ClampedArray, W: number, H: number, frontPass: boolean): void {
    let sprites = this.spriteUpdateOn ? [...this.hwSprites.values()] : (this.frozenSprites ?? [])
    // hardware pair priority: sprites 0-7 pair n>>1; computed sprites
    // (8+) multiplex onto the tail channels — treated as pair 3
    const p = this.spritePriority
    sprites = sprites.filter((sp) => {
      const pair = sp.n < 8 ? sp.n >> 1 : 3
      return frontPass ? pair < p : pair >= p
    })
    if (sprites.length === 0) return
    const front = this.screens.get(this.order[this.order.length - 1] ?? 0)
    const palette = front?.palette
    if (!palette) return
    for (const sp of sprites) {
      const img = this.spriteBank?.image(sp.image)
      if (!img) continue
      const bx = (sp.x - img.hotX - 128) * 2
      const by = (sp.y - img.hotY - 50) * 2
      for (let y = 0; y < img.height; y++) {
        for (let x = 0; x < img.width; x++) {
          const v = img.pixels[y * img.width + x]!
          if (v === 0) continue
          const rgb4 = palette[16 + (v & 15)]!
          const r = ((rgb4 >> 8) & 15) * 17
          const g = ((rgb4 >> 4) & 15) * 17
          const b = (rgb4 & 15) * 17
          for (let dy = 0; dy < 2; dy++) {
            for (let dx = 0; dx < 2; dx++) {
              const tx = bx + x * 2 + dx
              const ty = by + y * 2 + dy
              if (tx < 0 || ty < 0 || tx >= W || ty >= H) continue
              const o = (ty * W + tx) * 4
              data[o] = r
              data[o + 1] = g
              data[o + 2] = b
            }
          }
        }
      }
    }
  }
}

/** dialog SP pattern number → fill rows (0 solid, <0 sprite image, >0 builtin) */
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
  return builtinPattern(n)
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
