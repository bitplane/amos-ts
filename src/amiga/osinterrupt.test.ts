import { describe, expect, it } from 'vitest'
import { ExecInterruptSystem, NT_INTERRUPT } from './osinterrupt'

describe('OS DevKit Exec interrupt operations', () => {
  it('allocates the exact Node plus two-pointer Interrupt record', () => {
    const exec = new ExecInterruptSystem()
    const interrupt = exec.alloc()
    expect(exec.memory.nodeType(interrupt)).toBe(NT_INTERRUPT)
    exec.set(interrupt, 0x1234_5678, 0x8765_4321)
    expect(exec.data(interrupt)).toBe(0x1234_5678)
    expect(exec.code(interrupt)).toBe(0x8765_4321)
  })

  it('orders interrupt servers by signed priority and removes them', () => {
    const exec = new ExecInterruptSystem()
    const low = exec.alloc()
    const first = exec.alloc()
    const second = exec.alloc()
    exec.memory.setNodePriority(low, -5)
    exec.memory.setNodePriority(first, 3)
    exec.memory.setNodePriority(second, 3)
    exec.add(5, low)
    exec.add(5, first)
    exec.add(5, second)
    expect(exec.servers(5)).toEqual([first, second, low])
    exec.rem(5, first)
    expect(exec.servers(5)).toEqual([second, low])
  })

  it('free invalidates the record and removes any registration', () => {
    const exec = new ExecInterruptSystem()
    const interrupt = exec.alloc()
    exec.add(6, interrupt)
    exec.free(interrupt)
    expect(exec.servers(6)).toEqual([])
    expect(() => exec.data(interrupt)).toThrow(RangeError)
  })
})
