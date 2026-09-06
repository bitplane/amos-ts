/**
 * OS DevKit 1.61's private C-string allocations, routines 1466-1473.
 *
 * `_str alloc n` AllocVecs n+8 cleared bytes, stores that total in the first
 * longword and returns base+7. The three bytes between the size and text are
 * mutable cursor metadata used by `_str pos`; `_str put` uses size-8 as the
 * text capacity and always writes a trailing zero.
 */
import { MemPool } from './exec'

const HEADER = 7
const OVERHEAD = 8

export class OsCStringHeap {
  readonly memory: MemPool

  constructor(base = 0x3a10_0000, reserved = 0x00f0_0000) {
    this.memory = new MemPool(base, reserved)
  }

  private off(addr: number): number {
    return (addr >>> 0) - this.memory.base
  }

  private u32(at: number): number {
    const b = this.memory.buffer
    return (((b[at] ?? 0) << 24) | ((b[at + 1] ?? 0) << 16) | ((b[at + 2] ?? 0) << 8) | (b[at + 3] ?? 0)) >>> 0
  }

  private set16(at: number, value: number): void {
    this.memory.buffer[at] = value >>> 8
    this.memory.buffer[at + 1] = value
  }

  alloc(capacity: number): number {
    const total = Math.trunc(capacity) + OVERHEAD
    const block = this.memory.alloc(total, { clear: true })
    if (block === 0) return 0
    const at = this.off(block)
    this.memory.buffer[at] = total >>> 24
    this.memory.buffer[at + 1] = total >>> 16
    this.memory.buffer[at + 2] = total >>> 8
    this.memory.buffer[at + 3] = total
    return (block + HEADER) >>> 0
  }

  /** routine 1475 (`_to str`): allocate to the AMOS length and CopyMem its bytes. */
  fromAmos(value: string): number {
    const text = this.alloc(value.length)
    if (text !== 0) this.put(text, value)
    return text
  }

  free(text: number): void {
    this.memory.freeMem((text - HEADER) >>> 0)
  }

  length(text: number, terminator = 0): number {
    if (text === 0) return 0
    const b = this.memory.buffer
    let at = this.off(text)
    let n = 0
    while (at >= 0 && at < b.length && b[at++] !== (terminator & 0xff)) n++
    return n
  }

  get(text: number, terminator = 0): string {
    if (text === 0) return ''
    const at = this.off(text)
    return String.fromCharCode(...this.memory.buffer.subarray(at, at + this.length(text, terminator)))
  }

  position(text: number, position: number, value: number): void {
    if (text === 0) return
    const at = this.off(text)
    this.set16(at - 3, position)
    this.memory.buffer[at - 1] = value
  }

  put(text: number, value: string, terminator = 0): void {
    if (text === 0) return
    const at = this.off(text)
    const capacity = this.u32(at - HEADER) - OVERHEAD
    const length = Math.min(capacity, value.length)
    for (let i = 0; i < length; i++) this.memory.buffer[at + i] = value.charCodeAt(i) & 0xff
    this.memory.buffer[at + length] = terminator
  }
}
