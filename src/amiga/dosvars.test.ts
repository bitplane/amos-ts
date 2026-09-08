import { describe, expect, it } from 'vitest'
import { MemPool } from './exec'
import { AmigaFS, MemoryVolume } from './vfs'
import { DosVariables, GVF_BINARY_VAR, GVF_DONT_NULL_TERM, GVF_GLOBAL_ONLY, GVF_LOCAL_ONLY, GVF_SAVE_VAR, LV_ALIAS, LV_VAR } from './dosvars'

const setup = (): { vars: DosVariables; memory: MemPool; fs: AmigaFS } => {
  const memory = new MemPool(0x1000_0000, 0x10000); const fs = new AmigaFS()
  fs.mount('ENV', new MemoryVolume()); fs.mount('ENVARC', new MemoryVolume())
  return { vars: new DosVariables(memory, () => fs), memory, fs }
}
const u32 = (memory: MemPool, address: number): number => new DataView(memory.buffer.buffer).getUint32(address - memory.base)

describe('dos.library variables', () => {
  it('keeps local precedence and never returns a global file from FindVar', () => {
    const { vars } = setup()
    expect(vars.set('Editor', 'global', GVF_GLOBAL_ONLY)).toBe(true)
    expect(vars.find('editor', LV_VAR)).toBe(0)
    expect(vars.set('Editor', 'local', GVF_LOCAL_ONLY)).toBe(true)
    expect(vars.get('EDITOR', 0)).toBe('local'); expect(vars.get('EDITOR', GVF_GLOBAL_ONLY)).toBe('global')
    expect(vars.delete('editor', 0)).toBe(true); expect(vars.get('EDITOR', 0)).toBe('global')
  })

  it('publishes the exact public LocalVar fields for variables and aliases', () => {
    const { vars, memory } = setup(); expect(vars.set('path/item', 'value', LV_ALIAS | GVF_BINARY_VAR)).toBe(true)
    const node = vars.find('PATH/ITEM', LV_ALIAS); expect(node).toBeGreaterThan(0)
    const at = node - memory.base
    expect(memory.buffer[at + 8]).toBe(LV_ALIAS); expect(new DataView(memory.buffer.buffer).getUint16(at + 14)).toBe(GVF_BINARY_VAR)
    expect(u32(memory, node + 16)).toBeGreaterThan(0); expect(u32(memory, node + 20)).toBe(5)
  })

  it('applies text termination and persists saved globals to ENVARC:', () => {
    const { vars, fs } = setup(); const value = 'first\nsecond\0third'
    expect(vars.set('Nested/Value', value, GVF_GLOBAL_ONLY | GVF_SAVE_VAR)).toBe(true)
    expect(vars.get('Nested/Value', GVF_GLOBAL_ONLY)).toBe('first')
    expect(vars.get('Nested/Value', GVF_GLOBAL_ONLY | GVF_BINARY_VAR)).toBe(value)
    expect(fs.readFile('ENVARC:Nested/Value')).toEqual(Uint8Array.from(value, c => c.charCodeAt(0)))
  })

  it('honours the GetVar buffer boundary and failure result', () => {
    const { vars } = setup(); expect(vars.set('Long', 'abcdef', 0)).toBe(true)
    expect(vars.read('Long', 0, 4)).toEqual({ value: 'abc', result: 3, ioErr: 0 })
    expect(vars.read('Long', GVF_DONT_NULL_TERM, 4)).toEqual({ value: 'abcd', result: 4, ioErr: 0 })
    expect(vars.read('Missing', 0, 4)).toEqual({ value: '', result: -1, ioErr: 205 })
    expect(vars.read('Long', 0, 0)).toEqual({ value: '', result: -1, ioErr: 115 })
  })
})
