import { ExecListHeap } from './oslist'

export const NT_MSGPORT = 4
export const NT_MESSAGE = 5

/** Native Exec MsgPort, Message and signal behavior used by OS DevKit. */
export class ExecMessageSystem {
  readonly memory = new ExecListHeap()
  readonly currentTask = 0x7b00_0000
  private allocatedSignals = 0
  private readonly taskSignals = new Map<number, number>([[this.currentTask, 0]])
  private readonly publicPorts = new Map<string, number>()

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
    const old = this.taskSignals.get(this.currentTask) ?? 0
    this.taskSignals.set(this.currentTask, ((old & ~mask) | (value & mask)) >>> 0)
    return old >>> 0
  }

  signal(task: number, mask: number): void {
    if (task === 0) return
    this.taskSignals.set(task, ((this.taskSignals.get(task) ?? 0) | mask) >>> 0)
  }

  /** Returns null where native Wait would suspend the current task. */
  wait(mask: number): number | null {
    const pending = this.taskSignals.get(this.currentTask) ?? 0
    const received = (pending & mask) >>> 0
    if (received === 0) return null
    this.taskSignals.set(this.currentTask, (pending & ~received) >>> 0)
    return received
  }

  createPort(name = '', priority = 0): number {
    const bit = this.allocSignal(-1)
    if (bit < 0) return 0
    const port = this.memory.allocNode(20) // MP_SIZE = 34
    this.memory.setNodeType(port, NT_MSGPORT)
    this.memory.setNodePriority(port, priority)
    if (name !== '') this.memory.setNodeName(port, this.memory.allocCString(name))
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
