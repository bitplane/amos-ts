import type { TokenLine } from '../tokens/stream'
import { TokenTable } from '../tokens/stream'
import { Interp, newInputState } from '../interp/interp'
import type { InputState, InterpOptions, RunResult } from '../interp/interp'
import type { AmosIO } from '../interp/io'
import { AmosError } from '../interp/values'
import type { Bank, MemoryBank } from '../loader/amosfile'
import { parseAmosFile } from '../loader/amosfile'
import { isResourceBankName, parseResourceBank } from '../loader/resource'
import type { ResourceBank } from '../loader/resource'
import { Screen } from './screen'
import { makeInstructions, makeFunctions, makeRawFunctions } from './instr'
import { ObjectBank, imagesCollide } from './objects'
import type { BankImage, Bob, HwSprite, Zone } from './objects'
import type { AmosFS } from './fs'
import { AmalChannel } from './amal'
import type { AmalHost, ChannelTarget } from './amal'
import { NullAudio, parseSampleBank } from './audio'
import { FONT8 } from './font.gen'
import type { AudioSink, SampleEntry } from './audio'
import { AmigaFS } from './vfs'

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

  reserveBank(n: number, length: number, name: string): void {
    this.memBanks.set(n, { kind: 'memory', number: n, memType: 0, name, flags: 0, data: new Uint8Array(length) })
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
  // ---- sprite update freeze ----
  spriteUpdateOn = true
  frozenSprites: HwSprite[] | null = null
  // ---- menus ----
  menus = {
    titles: [] as string[],
    items: [] as string[][],
    on: false,
    /** currently dropped-down menu index (-1 none) while RMB held */
    open: -1,
    hoverItem: -1,
    /** last completed selection, 1-based [menu, item] */
    selection: null as [number, number] | null,
    /** set on selection, cleared by =Choice */
    choiceFlag: false,
  }
  onMenu: { kind: 'gosub' | 'proc'; targets: string[]; armed: boolean } | null = null
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
    this.screens.set(n, s)
    this.order = this.order.filter((i) => i !== n)
    this.order.push(n)
    this.currentIndex = n
    s.cls()
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
    if (this.bobUpdateOn) this.updateBobs()
    this.stepMenus()
    return result
  }

  /** right-button menu interaction + On Menu dispatch */
  private stepMenus(): void {
    const m = this.menus
    const rmb = (this.input.mouseK & 2) !== 0
    if (m.on && rmb) {
      const mx = (this.input.mouseX - 128) * 2
      const my = (this.input.mouseY - 50) * 2
      // title spans: 16px pad + 8px/char each
      let x = 0
      m.open = -1
      for (let i = 0; i < m.titles.length; i++) {
        const w = m.titles[i]!.length * 8 + 16
        if (my < 10 && mx >= x && mx < x + w) m.open = i
        x += w
      }
      if (m.open < 0 && this.openMenuAt >= 0) m.open = this.openMenuAt
      if (m.open >= 0) {
        this.openMenuAt = m.open
        const items = m.items[m.open] ?? []
        const row = Math.floor((my - 10) / 10)
        m.hoverItem = my >= 10 && row < items.length ? row : -1
      }
    } else if (m.on && this.lastRmb && !rmb) {
      // release: commit the selection
      if (this.openMenuAt >= 0 && m.hoverItem >= 0) {
        m.selection = [this.openMenuAt + 1, m.hoverItem + 1]
        m.choiceFlag = true
        if (this.onMenu?.armed) this.dispatchOnMenu(this.openMenuAt)
      }
      m.open = -1
      m.hoverItem = -1
      this.openMenuAt = -1
    }
    this.lastRmb = rmb
  }

  private openMenuAt = -1

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
    for (const n of this.order) {
      const s = this.screens.get(n)
      if (!s || !s.visible) continue
      const pixels = s.displayBuffer
      const pw = s.hires ? 1 : 2
      const ph = s.laced ? 1 : 2
      const baseX = (s.displayX - 128) * 2
      const baseY = (s.displayY - 50) * 2
      for (let y = 0; y < s.height; y++) {
        const sy = y + s.offsetY
        if (sy < 0 || sy >= s.height) continue
        for (let x = 0; x < s.width; x++) {
          const sx = x + s.offsetX
          if (sx < 0 || sx >= s.width) continue
          const rgb4 = s.palette[pixels[sy * s.width + sx]! & 31]!
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
    this.drawMenus(data, W, H)
    return { width: W, height: H, data }
  }

  /** Workbench-style menu bar while the right button is held */
  private drawMenus(data: Uint8ClampedArray, W: number, H: number): void {
    const m = this.menus
    if (!m.on || (this.input.mouseK & 2) === 0) return
    const put = (x: number, y: number, rgb: [number, number, number]): void => {
      if (x < 0 || y < 0 || x >= W || y >= H) return
      const o = (y * W + x) * 4
      data[o] = rgb[0]
      data[o + 1] = rgb[1]
      data[o + 2] = rgb[2]
    }
    const WHITE: [number, number, number] = [255, 255, 255]
    const BLACK: [number, number, number] = [0, 0, 0]
    const BLUE: [number, number, number] = [68, 68, 170]
    const text = (tx: number, ty: number, t: string, fg: [number, number, number]): void => {
      for (let i = 0; i < t.length; i++) {
        const glyph = FONT8[t.charCodeAt(i)] ?? FONT8[32]!
        for (let r = 0; r < 8; r++) {
          for (let c = 0; c < 8; c++) {
            if ((glyph[r]! >> (7 - c)) & 1) put(tx + i * 8 + c, ty + r, fg)
          }
        }
      }
    }
    for (let y = 0; y < 10; y++) for (let x = 0; x < W; x++) put(x, y, WHITE)
    let x = 0
    for (let i = 0; i < m.titles.length; i++) {
      const w = m.titles[i]!.length * 8 + 16
      if (i === this.openMenuAt) for (let y = 0; y < 10; y++) for (let xx = x; xx < x + w; xx++) put(xx, y, BLUE)
      text(x + 8, 1, m.titles[i]!, i === this.openMenuAt ? WHITE : BLACK)
      x += w
    }
    if (this.openMenuAt >= 0) {
      const items = m.items[this.openMenuAt] ?? []
      let bx = 0
      for (let i = 0; i < this.openMenuAt; i++) bx += m.titles[i]!.length * 8 + 16
      const bw = Math.max(...items.map((t) => t.length), 4) * 8 + 16
      for (let i = 0; i < items.length; i++) {
        const on = i === m.hoverItem
        for (let y = 0; y < 10; y++) for (let xx = bx; xx < bx + bw; xx++) put(xx, 10 + i * 10 + y, on ? BLUE : WHITE)
        text(bx + 8, 11 + i * 10, items[i]!, on ? WHITE : BLACK)
      }
    }
  }

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
