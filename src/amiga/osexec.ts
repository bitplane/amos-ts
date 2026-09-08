/**
 * One runtime-wide native Exec service.
 *
 * Every address-bearing Exec subsystem shares this memory and task identity.
 * This is intentionally the seam for a future scheduler and 68k execution
 * engine: extensions consume Exec here instead of growing private ports,
 * signal sets, interrupt chains or synthetic address spaces of their own.
 */
import { LibraryRegistry, MemPool } from './exec'
import { ExecInterruptSystem } from './osinterrupt'
import { ExecListHeap, type ExecAddressSpace } from './oslist'
import { ExecMessageSystem } from './osmessage'
import { ExecTaskSystem } from './ostask'

export interface ExecAlert {
  number: number
  source: string
  data?: number
  deadEnd: boolean
}

export class ExecSystem {
  readonly pool: MemPool
  readonly memory: ExecListHeap
  readonly tasks: ExecTaskSystem
  readonly messages: ExecMessageSystem
  readonly interrupts: ExecInterruptSystem
  readonly libraries = new LibraryRegistry()
  lastAlert: ExecAlert | null = null

  constructor(base: number, reserved: number, addressSpace?: ExecAddressSpace) {
    this.pool = new MemPool(base, reserved)
    this.memory = new ExecListHeap(this.pool, addressSpace)
    this.tasks = new ExecTaskSystem()
    this.messages = new ExecMessageSystem(this.memory, this.tasks)
    this.interrupts = new ExecInterruptSystem(this.memory)
  }

  /** Exec Alert (-108): retain the process-wide alert for UI/reset policy. */
  alert(number: number, source: string, data?: number): ExecAlert {
    const alert = { number: number >>> 0, source, ...(data === undefined ? {} : { data: data >>> 0 }), deadEnd: (number >>> 0) >= 0x8000_0000 }
    this.lastAlert = alert
    return alert
  }
}
