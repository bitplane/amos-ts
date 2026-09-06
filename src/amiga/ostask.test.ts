import { describe, expect, it } from 'vitest'
import { ExecTaskSystem } from './ostask'

describe('OS DevKit Exec task operations', () => {
  it('finds the current task for a null name and registered tasks case-sensitively', () => {
    const exec = new ExecTaskSystem()
    const worker = exec.register('Worker')
    expect(exec.find(null)).toBe(exec.currentTask)
    expect(exec.find('Worker')).toBe(worker)
    expect(exec.find('worker')).toBe(0)
    expect(exec.find('absent')).toBe(0)
  })

  it('sets signed-byte priorities and returns the previous value', () => {
    const exec = new ExecTaskSystem()
    const worker = exec.register('Worker', -4)
    expect(exec.setPriority(worker, 0x81)).toBe(-4)
    expect(exec.priority(worker)).toBe(-127)
    expect(exec.setPriority(worker, 3)).toBe(-127)
    expect(exec.priority(worker)).toBe(3)
  })

  it('owns signal allocation and pending masks for the future scheduler boundary', () => {
    const exec = new ExecTaskSystem()
    expect(exec.allocSignal(-1)).toBe(0)
    expect(exec.setSignal(0b1010, 0b1111)).toBe(0)
    exec.signal(exec.currentTask, 0b0100)
    expect(exec.wait(0b1100)).toBe(0b1100)
    expect(exec.wait(0b1100)).toBeNull()
    exec.freeSignal(0)
    expect(exec.allocSignal(0)).toBe(0)
  })
})
