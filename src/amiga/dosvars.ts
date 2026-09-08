import type { AmigaFS } from './vfs'
import type { MemPool } from './exec'

export const GVF_GLOBAL_ONLY = 0x100
export const GVF_LOCAL_ONLY = 0x200
export const GVF_BINARY_VAR = 0x400
export const GVF_DONT_NULL_TERM = 0x800
export const GVF_SAVE_VAR = 0x1000
export const LV_VAR = 0
export const LV_ALIAS = 1

interface LocalVariable { name: string; value: string; flags: number; node: number; nameAddress: number; valueAddress: number }
export interface DosVariableRead { value: string; result: number; ioErr: number }

/** dos.library GetVar/SetVar/DeleteVar/FindVar state shared by extensions. */
export class DosVariables {
  private readonly local = new Map<string, LocalVariable>()
  constructor(private readonly memory: MemPool, private readonly fs: () => AmigaFS | null) {}
  get(name: string, flags: number): string {
    return this.read(name, flags, Number.MAX_SAFE_INTEGER).value
  }
  /** GetVar's caller-buffer boundary and return/error contract. */
  read(name: string, flags: number, size: number): DosVariableRead {
    if (size <= 0) return { value: '', result: -1, ioErr: 115 }
    const key = name.toLowerCase()
    const type = flags & 0xff
    const local = this.local.get(key)
    let value: string | undefined
    if ((flags & GVF_GLOBAL_ONLY) === 0 && local?.flags === type) value = local.value
    else if ((flags & GVF_LOCAL_ONLY) === 0) {
      const bytes = this.fs()?.readFile('ENV:' + name)
      if (bytes) value = String.fromCharCode(...bytes)
    }
    if (value === undefined) return { value: '', result: -1, ioErr: 205 }
    const visible = this.visible(value, flags)
    const capacity = (flags & (GVF_BINARY_VAR | GVF_DONT_NULL_TERM)) !== 0 ? size : Math.max(0, size - 1)
    const truncated = visible.slice(0, capacity)
    return { value: truncated, result: truncated.length, ioErr: 0 }
  }
  set(name: string, value: string, flags: number): boolean {
    if (!name || name.includes(':') || ((flags & 0xff) !== LV_VAR && (flags & 0xff) !== LV_ALIAS)) return false
    if ((flags & GVF_GLOBAL_ONLY) !== 0) {
      if ((flags & 0xff) === LV_ALIAS) return false
      const bytes = Uint8Array.from(value, c => c.charCodeAt(0) & 255)
      const written = this.fs()?.writeFile('ENV:' + name, bytes) ?? false
      if (written && (flags & GVF_SAVE_VAR) !== 0 && this.fs()?.hasVolume('ENVARC')) this.fs()?.writeFile('ENVARC:' + name, bytes)
      return written
    }
    const key = name.toLowerCase(); this.freeNode(this.local.get(key))
    this.local.set(key, { name, value, flags: flags & (0xff | GVF_BINARY_VAR), node: 0, nameAddress: 0, valueAddress: 0 }); return true
  }
  delete(name: string, flags: number): boolean {
    const key = name.toLowerCase(); let deleted = false
    if ((flags & GVF_GLOBAL_ONLY) === 0) {
      const local = this.local.get(key)
      if (local && local.flags % 0x100 === (flags & 0xff)) { this.freeNode(local); this.local.delete(key); deleted = true }
    }
    if ((flags & GVF_LOCAL_ONLY) === 0 && ((flags & GVF_GLOBAL_ONLY) !== 0 || !deleted)) {
      deleted = (this.fs()?.deleteFile('ENV:' + name) ?? false) || deleted
    }
    return deleted
  }
  find(name: string, type: number): number {
    const variable = this.local.get(name.toLowerCase())
    if (!variable || variable.flags % 0x100 !== (type & 0xff)) return 0
    if (variable.node) return variable.node
    variable.node = this.memory.alloc(24, { clear: true })
    variable.nameAddress = this.writeString(variable.name, true)
    variable.valueAddress = this.writeString(variable.value, false)
    if (!variable.node || !variable.nameAddress || !variable.valueAddress) { this.freeNode(variable); return 0 }
    this.write32(variable.node + 10, variable.nameAddress)
    this.write16(variable.node + 14, variable.flags & GVF_BINARY_VAR)
    this.write32(variable.node + 16, variable.valueAddress)
    this.write32(variable.node + 20, variable.value.length)
    this.memory.buffer[variable.node - this.memory.base + 8] = variable.flags & 0xff
    return variable.node
  }
  private visible(value: string, flags: number): string {
    if ((flags & GVF_BINARY_VAR) !== 0) return value
    const nul = value.indexOf('\0'), lf = value.indexOf('\n')
    const end = nul < 0 ? lf : lf < 0 ? nul : Math.min(nul, lf)
    return end < 0 ? value : value.slice(0, end)
  }
  private writeString(value: string, nul: boolean): number {
    const address = this.memory.alloc(Math.max(1, value.length + (nul ? 1 : 0)), { clear: true }); if (!address) return 0
    const at = address - this.memory.base
    for (let i = 0; i < value.length; i++) this.memory.buffer[at + i] = value.charCodeAt(i) & 255
    return address
  }
  private freeNode(variable: LocalVariable | undefined): void {
    if (!variable) return
    if (variable.node) this.memory.freeMem(variable.node)
    if (variable.nameAddress) this.memory.freeMem(variable.nameAddress)
    if (variable.valueAddress) this.memory.freeMem(variable.valueAddress)
    variable.node = 0; variable.nameAddress = 0; variable.valueAddress = 0
  }
  private write16(address: number, value: number): void { const at = address - this.memory.base; this.memory.buffer[at] = value >>> 8; this.memory.buffer[at + 1] = value }
  private write32(address: number, value: number): void { this.write16(address, value >>> 16); this.write16(address + 2, value) }
}
