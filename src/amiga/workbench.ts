import type { ExecMessageSystem } from './osmessage'

export type AppKind = 'icon' | 'menu' | 'window'
export interface AppItem { address: number; kind: AppKind; id: number; userData: number; text: number; port: number; object: number; tags: number; label: string }

/** workbench.library AppItem ownership over the shared Exec address space. */
export class Workbench {
  readonly items = new Map<number, AppItem>()
  message = 0
  constructor(private readonly messages: ExecMessageSystem) {}
  add(kind: AppKind, id: number, userData: number, text: number, port: number, object: number, tags: number, label = ''): number {
    const address = this.messages.memory.allocNode(32); if (!address) return 0
    this.items.set(address, { address, kind, id, userData, text, port, object, tags, label }); return address
  }
  remove(address: number, kind: AppKind): boolean { const item = this.items.get(address); if (!item || item.kind !== kind) return false; this.items.delete(address); this.messages.memory.free(address); return true }
  /** Queue the AppMessage Workbench sends when a registered item is activated. */
  activate(address: number): number {
    const item = this.items.get(address); if (!item || item.port === 0) return 0
    const message = this.messages.allocMessage(0, 0x3a)
    this.messages.putMsg(item.port, message)
    this.message = message
    return message
  }
}
