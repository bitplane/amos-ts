import type { AmigaFS } from './vfs'
import type { MemPool } from './exec'

export const GVF_GLOBAL_ONLY = 0x100
export const GVF_LOCAL_ONLY = 0x200

/** dos.library GetVar/SetVar/DeleteVar/FindVar state shared by extensions. */
export class DosVariables {
  private readonly local = new Map<string, string>()
  private readonly nodes = new Map<string, number>()
  constructor(private readonly memory: MemPool, private readonly fs: () => AmigaFS | null) {}
  get(name: string, flags: number): string {
    const key = name.toLowerCase()
    if ((flags & GVF_GLOBAL_ONLY) === 0 && this.local.has(key)) return this.local.get(key)!
    if ((flags & GVF_LOCAL_ONLY) !== 0) return ''
    const b = this.fs()?.readFile('ENV:' + name); return b ? String.fromCharCode(...b) : ''
  }
  set(name: string, value: string, flags: number): boolean {
    if (!name || /[:/]/.test(name)) return false
    if ((flags & GVF_GLOBAL_ONLY) !== 0) return this.fs()?.writeFile('ENV:' + name, Uint8Array.from(value, c => c.charCodeAt(0) & 255)) ?? false
    this.local.set(name.toLowerCase(), value); return true
  }
  delete(name: string, flags: number): boolean {
    const key = name.toLowerCase(); let deleted = false
    if ((flags & GVF_GLOBAL_ONLY) === 0) deleted = this.local.delete(key)
    if ((flags & GVF_LOCAL_ONLY) === 0) deleted = (this.fs()?.deleteFile('ENV:' + name) ?? false) || deleted
    const p = this.nodes.get(key); if (p) { this.memory.freeMem(p); this.nodes.delete(key) }
    return deleted
  }
  find(name: string, type: number): number {
    const key = name.toLowerCase()
    if (type !== 0 || (!this.local.has(key) && this.fs()?.exists('ENV:' + name) !== 'file')) return 0
    const old = this.nodes.get(key); if (old) return old
    const address = this.memory.alloc(32, { clear: true }); if (address) this.nodes.set(key, address); return address
  }
}
