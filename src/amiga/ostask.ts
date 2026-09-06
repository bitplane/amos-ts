/** Managed Exec task identity/priority registry for OS DevKit wrappers. */
export class ExecTaskSystem {
  readonly currentTask = 0x7b00_0000
  private next = this.currentTask + 0x100
  private readonly names = new Map<string, number>()
  private readonly priorities = new Map<number, number>([[this.currentTask, 0]])
  private allocatedSignals = 0
  private readonly pendingSignals = new Map<number, number>([[this.currentTask, 0]])

  register(name: string, priority = 0): number {
    const existing = this.names.get(name)
    if (existing !== undefined) return existing
    const task = this.next
    this.next += 0x100
    this.names.set(name, task)
    this.priorities.set(task, (priority << 24) >> 24)
    return task
  }

  /** Exec FindTask: null name means the calling task; names are case-sensitive. */
  find(name: string | null): number {
    return name === null ? this.currentTask : (this.names.get(name) ?? 0)
  }

  /** Exec SetTaskPri, returning the previous signed BYTE priority as a WORD. */
  setPriority(task: number, priority: number): number {
    if (!this.priorities.has(task)) return 0
    const old = this.priorities.get(task) ?? 0
    this.priorities.set(task, (priority << 24) >> 24)
    return old
  }

  priority(task: number): number | null {
    return this.priorities.get(task) ?? null
  }

  allocSignal(request = -1): number {
    let bit = request | 0
    if (bit === -1) {
      bit = -1
      for (let candidate = 0; candidate < 32; candidate++) {
        if ((this.allocatedSignals & (1 << candidate)) === 0) { bit = candidate; break }
      }
    }
    if (bit < 0 || bit > 31 || (this.allocatedSignals & (1 << bit)) !== 0) return -1
    this.allocatedSignals = (this.allocatedSignals | (1 << bit)) >>> 0
    return bit
  }

  freeSignal(bit: number): void {
    if (bit >= 0 && bit < 32) this.allocatedSignals = (this.allocatedSignals & ~(1 << bit)) >>> 0
  }

  setSignal(value: number, mask: number): number {
    const old = this.pendingSignals.get(this.currentTask) ?? 0
    this.pendingSignals.set(this.currentTask, ((old & ~mask) | (value & mask)) >>> 0)
    return old >>> 0
  }

  signal(task: number, mask: number): void {
    if (task === 0) return
    this.pendingSignals.set(task, ((this.pendingSignals.get(task) ?? 0) | mask) >>> 0)
  }

  /** Returns null where native Wait would suspend and ask a scheduler to resume this task. */
  wait(mask: number): number | null {
    const pending = this.pendingSignals.get(this.currentTask) ?? 0
    const received = (pending & mask) >>> 0
    if (received === 0) return null
    this.pendingSignals.set(this.currentTask, (pending & ~received) >>> 0)
    return received
  }
}
