/** Managed Exec task identity/priority registry for OS DevKit wrappers. */
export class ExecTaskSystem {
  readonly currentTask = 0x7b00_0000
  private next = this.currentTask + 0x100
  private readonly names = new Map<string, number>()
  private readonly priorities = new Map<number, number>([[this.currentTask, 0]])

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
}
