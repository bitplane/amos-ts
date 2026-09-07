import type { ExecMessageSystem } from './osmessage'

export type AppKind = 'icon' | 'menu' | 'window'
export interface AppItem { address: number; kind: AppKind; id: number; userData: number; text: number; port: number; object: number; tags: number }

/** workbench.library AppItem ownership over the shared Exec address space. */
export class Workbench {
  readonly items = new Map<number, AppItem>()
  message = 0
  constructor(private readonly messages: ExecMessageSystem) {}
  add(kind: AppKind, id: number, userData: number, text: number, port: number, object: number, tags: number): number {
    const address = this.messages.memory.allocNode(32); if (!address) return 0
    this.items.set(address, { address, kind, id, userData, text, port, object, tags }); return address
  }
  remove(address: number, kind: AppKind): boolean { const item = this.items.get(address); if (!item || item.kind !== kind) return false; this.items.delete(address); this.messages.memory.free(address); return true }
}
