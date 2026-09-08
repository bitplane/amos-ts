import type { ExecMessageSystem } from './osmessage'

export type AppKind = 'icon' | 'menu' | 'window'
export interface AppItem { address: number; kind: AppKind; id: number; userData: number; text: number; port: number; object: number; tags: number; label: string }
export interface AppActivation {
  /** Host-resolved Workbench drop arguments; names are serialized beside the message. */
  args?: ReadonlyArray<{ lock: number; name: string }>
  /** Native passthrough used when the caller already owns a WBArg array. */
  numArgs?: number
  argList?: number
  mouseX?: number
  mouseY?: number
  seconds?: number
  micros?: number
}

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
    const payload = event.args?.reduce((size, arg) => size + 8 + arg.name.length + 1, 0) ?? 0
    const message = this.messages.allocMessage(0, 86 + payload)
    const m = this.messages.memory
    const word = (at: number, value: number): void => { m.writeU8(at, value >>> 8); m.writeU8(at + 1, value) }
    // mn_Length describes struct AppMessage, not the private backing storage
    // retaining its WBArg array and names.
    word(message + 18, 86)
    let numArgs = event.numArgs ?? 0, argList = event.argList ?? 0
    if (event.args) {
      numArgs = event.args.length; argList = numArgs ? message + 86 : 0
      let name = argList + numArgs * 8
      for (let i = 0; i < numArgs; i++) {
        const arg = event.args[i]!, at = argList + i * 8
        m.writeU32(at, arg.lock); m.writeU32(at + 4, name)
        for (let j = 0; j < arg.name.length; j++) m.writeU8(name++, arg.name.charCodeAt(j))
        m.writeU8(name++, 0)
      }
    }
    word(message + 20, APP_TYPE[item.kind])
    m.writeU32(message + 22, item.userData); m.writeU32(message + 26, item.id)
    m.writeU32(message + 30, numArgs); m.writeU32(message + 34, argList)
    word(message + 38, 1); word(message + 40, 0)
    word(message + 42, event.mouseX ?? 0); word(message + 44, event.mouseY ?? 0)
    m.writeU32(message + 46, event.seconds ?? 0); m.writeU32(message + 50, event.micros ?? 0)
    this.messages.putMsg(item.port, message)
    this.message = message
    return message
  }
}
