import type { TokenLine } from '../tokens/stream'
import { TokenTable } from '../tokens/stream'
import { Interp, newInputState } from '../interp/interp'
import type { InputState, InterpOptions, RunResult } from '../interp/interp'
import type { AmosIO } from '../interp/io'
import { AmosError } from '../interp/values'
import { Screen } from './screen'
import { makeInstructions, makeFunctions } from './instr'

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
    // AMOS boots with screen 0: 320x200, 16 colours, lowres
    this.openScreen(0, 320, 200, 16, 0)
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
          const rgb4 = s.palette[s.pixels[sy * s.width + sx]! & 31]!
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
    return { width: W, height: H, data }
  }
}
