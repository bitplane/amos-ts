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

export interface Rainbow {
  base: number
  height: number
  r: string
  g: string
  b: string
  colours: Uint16Array
  x: number
  y: number
  h: number
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
  shifts = new Map<number, { dir: number; delay: number; first: number; last: number; count: number }>()
  /** Fade: per-screen nibble-stepping toward targets (-1 = untouched) */
  fades = new Map<number, { delay: number; count: number; targets: Int32Array }>()
  /** Flash n,"(rgb,ticks)...": palette-register animations */
  flashes = new Map<number, { seq: Array<{ rgb: number; ticks: number }>; idx: number; left: number }>()
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
  resolveAddr(addr: number): { data: Uint8Array; off: number } | null {
    const a = addr >>> 0
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
    // per-run reset (Dia_RunProgram 20567-20585)
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
    this.dialogDraw.activate(d.screenNb)
    this.dialogDraw.setWriting(0)
    d.drawn = true
    const exec = new DialogExec(d, this.dialogHost, this.dialogDraw)
    try {
      const r = exec.run(startPos)
      editFirst(d, this.dialogDraw) // activate the first edit zone
      if (r.status === 'run') {
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
        // the tail hit another RU — keep waiting
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
        zoneChange(d, z, host, draw)
        if (z.quit) {
          exit++
          return exit
        }
      } else {
        d.ret = 0
        d.release = null
        zoneDraw(d, z, host, draw)
      }
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
      } else if (press && !z && d.runFlags & 8) {
        exit++ // flag bit3: any click exits
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
  dualPlayfield: { front: number; back: number } | null = null
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
    col: (n) => (this.colSet.has(n) ? -1 : 0),
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
    if (kind === 'rainbow' || kind === 'screen size') {
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
    const s = new Screen(n, Math.max(8, w), Math.max(8, h), nColors, mode)
    for (let i = 0; i < this.defaultPalette.length && i < 32; i++) s.palette[i] = this.defaultPalette[i]!
    this.screens.set(n, s)
    this.order = this.order.filter((i) => i !== n)
    this.order.push(n)
    this.currentIndex = n
    s.cls()
    if (!this.autoView) {
      // Auto View Off: the display change is deferred until View
      s.visible = false
      this.pendingView.add(n)
    }
    return s
  }

  closeScreen(n: number): void {
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

  /** Bob n vs bobs first..last on the same screen; fills colSet. -1/0. */
  bobColCheck(n: number, first = -Infinity, last = Infinity): number {
    this.colSet.clear()
    const me = this.bobs.get(n)
    const img = me && this.spriteBank?.image(me.image)
    if (!me || !img) return 0
    for (const other of this.bobs.values()) {
      if (other.n === n || other.n < first || other.n > last || other.screen !== me.screen) continue
      const oimg = this.spriteBank?.image(other.image)
      if (oimg && imagesCollide(img, me.x, me.y, oimg, other.x, other.y)) this.colSet.add(other.n)
    }
    return this.colSet.size > 0 ? -1 : 0
  }

  spriteColCheck(n: number, first = -Infinity, last = Infinity): number {
    this.colSet.clear()
    const me = this.hwSprites.get(n)
    const img = me && this.spriteBank?.image(me.image)
    if (!me || !img) return 0
    for (const other of this.hwSprites.values()) {
      if (other.n === n || other.n < first || other.n > last) continue
      const oimg = this.spriteBank?.image(other.image)
      if (oimg && imagesCollide(img, me.x, me.y, oimg, other.x, other.y)) this.colSet.add(other.n)
    }
    return this.colSet.size > 0 ? -1 : 0
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
      const s = this.screens.get(this.currentIndex)
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
      if (sh.dir > 0) {
        const tmp = s.palette[last]!
        for (let i = last; i > first; i--) s.palette[i] = s.palette[i - 1]!
        s.palette[first] = tmp
      } else {
        const tmp = s.palette[first]!
        for (let i = first; i < last; i++) s.palette[i] = s.palette[i + 1]!
        s.palette[last] = tmp
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
  composite(out?: Uint8ClampedArray): { width: number; height: number; data: Uint8ClampedArray } {
    const W = 640
    const H = 400
    const data = out ?? new Uint8ClampedArray(W * H * 4)
    const bg = this.colourBack & 0xfff
    const bgR = ((bg >> 8) & 15) * 17
    const bgG = ((bg >> 4) & 15) * 17
    const bgB = (bg & 15) * 17
    for (let i = 0; i < data.length; i += 4) {
      data[i] = bgR
      data[i + 1] = bgG
      data[i + 2] = bgB
      data[i + 3] = 255
    }
    // Dual Playfield: the front screen composites last with colour 0 clear
    let order = this.order
    const dual = this.dualPlayfield
    if (dual && this.screens.has(dual.front) && this.screens.has(dual.back)) {
      order = [...this.order.filter((n) => n !== dual.front), dual.front]
    }
    for (const n of order) {
      const s = this.screens.get(n)
      if (!s || !s.visible) continue
      const clearZero = dual !== null && n === dual.front
      const pixels = s.displayBuffer
      const pw = s.hires ? 1 : 2
      const ph = s.laced ? 1 : 2
      const baseX = (s.displayX - 128) * 2
      const baseY = (s.displayY - 50) * 2
      // Screen Display n,,,w,h clips the visible window to w×h (EcAWTx/Ty)
      const winW = s.displayW >= 0 ? Math.min(s.displayW, s.width) : s.width
      const winH = s.displayH >= 0 ? Math.min(s.displayH, s.height) : s.height
      for (let y = 0; y < winH; y++) {
        const sy = y + s.offsetY
        if (sy < 0 || sy >= s.height) continue
        for (let x = 0; x < winW; x++) {
          const sx = x + s.offsetX
          if (sx < 0 || sx >= s.width) continue
          const pix = pixels[sy * s.width + sx]! & 31
          if (clearZero && pix === 0) continue
          const rgb4 = s.palette[pix]!
          const r = ((rgb4 >> 8) & 15) * 17
          const g = ((rgb4 >> 4) & 15) * 17
          const b = (rgb4 & 15) * 17
          const px = baseX + x * pw
          const py = baseY + y * ph
          for (let dy = 0; dy < ph; dy++) {
            for (let dx = 0; dx < pw; dx++) {
              const tx = px + dx
              const ty = py + dy
              if (tx < 0 || ty < 0 || tx >= W || ty >= H) continue
              const o = (ty * W + tx) * 4
              data[o] = r
              data[o + 1] = g
              data[o + 2] = b
              data[o + 3] = 255
            }
          }
        }
      }
    }
    this.drawHwSprites(data, W, H)
    return { width: W, height: H, data }
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
  private drawHwSprites(data: Uint8ClampedArray, W: number, H: number): void {
    const sprites = this.spriteUpdateOn ? [...this.hwSprites.values()] : (this.frozenSprites ?? [])
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
