import type { ExecMessageSystem } from './osmessage'

export type AppKind = 'icon' | 'menu' | 'window'
export interface AppItem { address: number; kind: AppKind; id: number; userData: number; text: number; port: number; object: number; tags: number; label: string }
export interface AppActivation { numArgs?: number; argList?: number; mouseX?: number; mouseY?: number; seconds?: number; micros?: number }

const APP_TYPE: Readonly<Record<AppKind, number>> = { window: 7, icon: 8, menu: 9 }

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
  activate(address: number, event: AppActivation = {}): number {
    const item = this.items.get(address); if (!item || item.port === 0) return 0
    // workbench/startup.h AppMessage is 86 bytes. The fields through +$36
    // are the public prefix OS DevKit documents and extension code reads.
    const message = this.messages.allocMessage(0, 86)
    const m = this.messages.memory
    const word = (at: number, value: number): void => { m.writeU8(at, value >>> 8); m.writeU8(at + 1, value) }
    word(message + 20, APP_TYPE[item.kind])
    m.writeU32(message + 22, item.userData); m.writeU32(message + 26, item.id)
    m.writeU32(message + 30, event.numArgs ?? 0); m.writeU32(message + 34, event.argList ?? 0)
    word(message + 38, 1); word(message + 40, 0)
    word(message + 42, event.mouseX ?? 0); word(message + 44, event.mouseY ?? 0)
    m.writeU32(message + 46, event.seconds ?? 0); m.writeU32(message + 50, event.micros ?? 0)
    this.messages.putMsg(item.port, message)
    this.message = message
    return message
  }
}
