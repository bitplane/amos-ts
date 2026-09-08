import { describe, expect, it } from 'vitest'
import { ExecMessageSystem } from './osmessage'
import { Workbench } from './workbench'

describe('workbench.library AppMessages', () => {
  it('delivers the documented 86-byte AppMessage prefix through Exec', () => {
    const exec = new ExecMessageSystem()
    const wb = new Workbench(exec)
    const port = exec.createPort()
    const icon = wb.add('icon', 7, 99, 0, port, 1234, 0, 'AMOS')
    const message = wb.activate(icon, {
      numArgs: 2, argList: 0x11223344, mouseX: -12, mouseY: 34, seconds: 567, micros: 890,
    })
    const m = exec.memory
    const word = (at: number): number => (m.readU8(at) << 8) | m.readU8(at + 1)
    expect(exec.messageLength(message)).toBe(86)
    expect(word(message + 20)).toBe(8)
    expect(m.readU32(message + 22)).toBe(99)
    expect(m.readU32(message + 26)).toBe(7)
    expect(m.readU32(message + 30)).toBe(2)
    expect(m.readU32(message + 34)).toBe(0x11223344)
    expect([word(message + 38), word(message + 40)]).toEqual([1, 0])
    expect([word(message + 42) << 16 >> 16, word(message + 44) << 16 >> 16]).toEqual([-12, 34])
    expect([m.readU32(message + 46), m.readU32(message + 50)]).toEqual([567, 890])
    expect(exec.getMsg(port)).toBe(message)
  })

  it('uses the native AppWindow and AppMenuItem type numbers', () => {
    const exec = new ExecMessageSystem()
    const wb = new Workbench(exec)
    const port = exec.createPort()
    for (const [kind, type] of [['window', 7], ['menu', 9]] as const) {
      const message = wb.activate(wb.add(kind, 0, 0, 0, port, 0, 0))
      expect((exec.memory.readU8(message + 20) << 8) | exec.memory.readU8(message + 21)).toBe(type)
      expect(exec.getMsg(port)).toBe(message)
    }
  })
})
