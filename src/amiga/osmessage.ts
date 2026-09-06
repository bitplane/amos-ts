import { ExecListHeap } from './oslist'
import { ExecTaskSystem } from './ostask'

export const NT_MSGPORT = 4
export const NT_MESSAGE = 5

/** Native Exec MsgPort, Message and signal behavior used by OS DevKit. */
export class ExecMessageSystem {
  readonly memory: ExecListHeap
  readonly tasks: ExecTaskSystem
  private readonly publicPorts = new Map<string, number>()

  constructor(memory = new ExecListHeap(), tasks = new ExecTaskSystem()) {
    this.memory = memory
    this.tasks = tasks
  }

  get currentTask(): number { return this.tasks.currentTask }

  allocSignal(request = -1): number {
    return this.tasks.allocSignal(request)
  }

  freeSignal(bit: number): void {
    this.tasks.freeSignal(bit)
  }

  setSignal(value: number, mask: number): number {
    return this.tasks.setSignal(value, mask)
  }

  signal(task: number, mask: number): void {
    this.tasks.signal(task, mask)
  }

  /** Returns null where native Wait would suspend the current task. */
  wait(mask: number): number | null {
    return this.tasks.wait(mask)
  }

  createPort(name = '', priority = 0, allocationBytes = 34): number {
    const bit = this.allocSignal(-1)
    if (bit < 0) return 0
    // A port never owns ln_Name. This backing copy stands in for the caller's
    // C string, so place it before deliberately undersized records: IntuiExtend
    // 2.01b allocates 32 bytes for a 34-byte MsgPort and its two-byte overflow
    // must not destroy the name that AddPort is about to inspect.
    const nameAddress = name === '' ? 0 : this.memory.allocCString(name)
    const port = this.memory.allocNode(Math.max(0, (allocationBytes | 0) - 14))
    this.memory.setNodeType(port, NT_MSGPORT)
    this.memory.setNodePriority(port, priority)
    if (nameAddress !== 0) this.memory.setNodeName(port, nameAddress)
    this.memory.writeU8(port + 14, 0) // PA_SIGNAL
    this.memory.writeU8(port + 15, bit)
    this.memory.writeU32(port + 16, this.currentTask)
    this.memory.initList(port + 20)
    return port
  }

  deletePort(port: number): void {
    if (port === 0) return
    this.remPort(port)
    this.freeSignal(this.portSignalBit(port))
    this.memory.free(port)
  }

  addPort(port: number): void {
    if (port === 0) return
    const name = this.memory.cString(this.memory.nodeName(port))
    if (name !== '') this.publicPorts.set(name, port)
  }

  remPort(port: number): void {
    if (port === 0) return
    for (const [name, address] of this.publicPorts) if (address === port) this.publicPorts.delete(name)
  }

  findPort(name: string): number { return this.publicPorts.get(name) ?? 0 }
  portSignalTask(port: number): number { return this.memory.readU32(port + 16) }
  portSignalBit(port: number): number { return this.memory.readU8(port + 15) }

  allocMessage(replyPort = 0, length = 20): number {
    const message = this.memory.allocNode(Math.max(6, (length | 0) - 14))
    this.memory.setNodeType(message, NT_MESSAGE)
    this.memory.writeU32(message + 14, replyPort)
    this.memory.writeU8(message + 18, (length >>> 8) & 0xff)
    this.memory.writeU8(message + 19, length)
    return message
  }

  messageReplyPort(message: number): number { return this.memory.readU32(message + 14) }
  messageLength(message: number): number {
    return (this.memory.readU8(message + 18) << 8) | this.memory.readU8(message + 19)
  }

  getMsg(port: number): number { return port === 0 ? 0 : this.memory.remHead(port + 20) }

  putMsg(port: number, message: number): void {
    if (port === 0 || message === 0) return
    this.memory.addTail(port + 20, message)
    this.signal(this.portSignalTask(port), 1 << this.portSignalBit(port))
  }

  replyMsg(message: number): void {
    if (message !== 0) this.putMsg(this.messageReplyPort(message), message)
  }

  /** WaitPort answers the first queued message without removing it. */
  waitPort(port: number): number | null {
    if (port === 0) return null
    const head = this.memory.listHead(port + 20)
    if (head !== port + 24) return head
    const bit = this.portSignalBit(port)
    if (this.wait(1 << bit) === null) return null
    const after = this.memory.listHead(port + 20)
    return after === port + 24 ? null : after
  }
}
