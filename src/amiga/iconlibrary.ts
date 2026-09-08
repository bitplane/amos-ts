import type { MemPool } from './exec'
import type { AmigaFS } from './vfs'
import { readIcon, writeIcon, type Icon } from './icon'

export class IconLibrary {
  readonly objects = new Map<number, Icon>()
  constructor(private readonly memory: MemPool, private readonly fs: () => AmigaFS | null) {}
  private path(name: string): string { return name.toLowerCase().endsWith('.info') ? name : name + '.info' }
  alloc(icon: Icon): number { const p = this.memory.alloc(78, { clear: true }); if (p) this.objects.set(p, icon); return p }
  load(name: string): number { const bytes = this.fs()?.readFile(this.path(name)); const icon = bytes ? readIcon(bytes) : null; return icon ? this.alloc(icon) : 0 }
  def(type: number): number { return this.alloc({ type, normal: null, selected: null, defaultTool: '', toolTypes: [], currentX: 0, currentY: 0, stackSize: 4096, drawer: type === 1 || type === 2 || type === 5, drawerData: null, toolWindow: '' }) }
  free(address: number): void { if (this.objects.delete(address)) this.memory.freeMem(address) }
  save(name: string, address: number): boolean { const icon = this.objects.get(address); return icon ? this.fs()?.writeFile(this.path(name), writeIcon(icon)) ?? false : false }
  kill(name: string): boolean { return this.fs()?.deleteFile(this.path(name)) ?? false }
}
