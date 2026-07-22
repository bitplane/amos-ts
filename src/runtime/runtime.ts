import type { TokenLine } from '../tokens/stream'
import { TokenTable } from '../tokens/stream'
import { Interp, newInputState } from '../interp/interp'
import type { InputState, InterpOptions, RunResult } from '../interp/interp'
import type { AmosIO } from '../interp/io'
import { AmosError } from '../interp/values'
import type { Bank, MemoryBank } from '../loader/amosfile'
import { Screen } from './screen'
import { makeInstructions, makeFunctions } from './instr'
import { ObjectBank } from './objects'
import type { BankImage, Bob, HwSprite, Zone } from './objects'
import type { AmosFS } from './fs'

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
  scrollZones = new Map<number, { x1: number; y1: number; x2: number; y2: number; dx: number; dy: number }>()
  // ---- objects ----
  spriteBank: ObjectBank | null = null
  iconBank: ObjectBank | null = null
  memBanks = new Map<number, MemoryBank>()
  bobs = new Map<number, Bob>()
  hwSprites = new Map<number, HwSprite>()
  zones: Array<Zone | null> = []
  /** objects hit by the last Bob Col/Sprite Col, read by Col() */
  colSet = new Set<number>()
  priorityOn = false
  fs: AmosFS | null = null
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
      input: this.input,
    }
    if (opts.extensions) interpOpts.extensions = opts.extensions
    if (opts.onUnimplemented) interpOpts.onUnimplemented = opts.onUnimplemented
    if (opts.maxSteps) interpOpts.maxSteps = opts.maxSteps
    this.interp = new Interp(lines, table, interpOpts)
    this.fs = opts.fs ?? null
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
    this.unblock()
    if (!this.interp.done && this.interp.blocked === null) {
      return this.interp.run(this.frameBudget)
    }
    return { status: this.interp.done ? 'ended' : 'blocked', steps: 0, unimplemented: this.interp.unimplemented }
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
    data.fill(0)
    for (let i = 3; i < data.length; i += 4) data[i] = 255
    for (const n of this.order) {
      const s = this.screens.get(n)
      if (!s || !s.visible) continue
      const pixels = this.pixelsWithBobs(n, s)
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
    return { width: W, height: H, data }
  }

  /**
   * Screen pixels with its bobs overlaid. The framebuffer itself is not
   * touched — equivalent to AMOS's autoback keeping the background saved.
   */
  private pixelsWithBobs(index: number, s: Screen): Uint8Array {
    const bobs = [...this.bobs.values()].filter((b) => b.screen === index)
    if (bobs.length === 0) return s.pixels
    bobs.sort((a, b) => (this.priorityOn ? a.y - b.y : a.n - b.n))
    const out = s.pixels.slice()
    for (const bob of bobs) {
      const img = this.spriteBank?.image(bob.image)
      if (!img) continue
      const dx = bob.x - img.hotX
      const dy = bob.y - img.hotY
      for (let y = 0; y < img.height; y++) {
        const ty = dy + y
        if (ty < 0 || ty >= s.height) continue
        for (let x = 0; x < img.width; x++) {
          const v = img.pixels[y * img.width + x]!
          if (v === 0 && !img.opaque) continue
          const tx = dx + x
          if (tx < 0 || tx >= s.width) continue
          out[ty * s.width + tx] = v
        }
      }
    }
    return out
  }

  /** Hardware sprites draw over everything, colours 16-31, hw coords. */
  private drawHwSprites(data: Uint8ClampedArray, W: number, H: number): void {
    if (this.hwSprites.size === 0) return
    const front = this.screens.get(this.order[this.order.length - 1] ?? 0)
    const palette = front?.palette
    if (!palette) return
    for (const sp of this.hwSprites.values()) {
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
