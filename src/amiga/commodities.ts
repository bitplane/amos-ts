/** Runtime-wide commodities.library object graph and broker message queue. */
import type { ExecMessageSystem } from './osmessage'

export interface CxObject { address: number; type: number; arg1: number; arg2: number; error: number; active: boolean; parent: number; children: Set<number> }
export interface CxEvent { message: number; type: number; id: number; data: number }

export class Commodities {
  readonly objects = new Map<number, CxObject>()
  readonly ids = new Map<number, number>()
  base = 0; broker = 0; port = 0; current: CxEvent | null = null; enabled = true
  constructor(private readonly messages: ExecMessageSystem) {}

  install(name: string, unique: number, flags: number, priority: number): number {
    if (this.broker !== 0) return unique ? 1 : 0
    this.port = this.messages.createPort('', priority)
    if (!this.port) return 2
    this.broker = this.create(-1, 5, this.port, flags); void name; return this.broker ? 0 : 2
  }
  uninstall(): void {
    for (const p of [...this.objects.keys()]) this.delete(p)
    if (this.port) this.messages.deletePort(this.port)
    this.port = 0; this.broker = 0; this.current = null
  }
  create(id: number, type: number, arg1: number, arg2: number): number {
    if (id >= 0) this.delete(this.ids.get(id) ?? 0)
    const address = this.messages.memory.allocNode(24)
    if (!address) return 0
    this.objects.set(address, { address, type, arg1, arg2, error: 0, active: true, parent: 0, children: new Set() })
    if (id >= 0) this.ids.set(id, address)
    return address
  }
  delete(address: number): void {
    const o = this.objects.get(address); if (!o) return
    for (const child of [...o.children]) this.delete(child)
    this.remove(address); this.objects.delete(address); this.messages.memory.free(address)
    for (const [id, p] of this.ids) if (p === address) this.ids.delete(id)
  }
  attach(child: number, parent: number): void { this.remove(child); const c = this.objects.get(child), p = this.objects.get(parent); if (c && p) { c.parent = parent; p.children.add(child) } }
  remove(address: number): void { const o = this.objects.get(address); if (o?.parent) this.objects.get(o.parent)?.children.delete(address); if (o) o.parent = 0 }
  next(wait: boolean): number {
    const message = wait ? (this.messages.waitPort(this.port) ?? 0) : this.messages.getMsg(this.port)
    if (!message) { this.current = null; return 0 }
    if (wait) this.messages.getMsg(this.port)
    const m = this.messages.memory
    this.current = { message, type: m.readU32(message + 20), id: m.readU32(message + 24), data: m.readU32(message + 28) }
    // The worker has copied all three CxMsg fields before ReplyMsg. A message
    // synthesized by this backend has no reply owner, so release it here.
    if (this.messages.messageReplyPort(message) === 0) m.free(message)
    else this.messages.replyMsg(message)
    return this.current.type
  }

  /** Deliver one CxMsg through the broker's real Exec port. */
  post(type: number, id: number, data: number): number {
    if (!this.port || !this.enabled) return 0
    const message = this.messages.allocMessage(0, 32)
    const m = this.messages.memory
    m.writeU32(message + 20, type); m.writeU32(message + 24, id); m.writeU32(message + 28, data)
    this.messages.putMsg(this.port, message)
    return message
  }
}
