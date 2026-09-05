import { describe, expect, it } from 'vitest'
import { OsCStringHeap } from './oscstring'

describe('OS DevKit private strings: routines 1466-1473', () => {
  it('stores the unrounded total, returns base+7, and frees through that header', () => {
    const heap = new OsCStringHeap(0x1000, 0x100)
    const text = heap.alloc(5)
    expect(text).toBe(0x100f)
    expect([...heap.memory.buffer.subarray(8, 15)]).toEqual([0, 0, 0, 13, 0, 0, 0])
    heap.free(text)
    expect(heap.memory.sizeOf(text - 7)).toBe(0)
  })

  it('copies Latin-1, caps at capacity, terminates, and reports C length', () => {
    const heap = new OsCStringHeap(0x2000, 0x100)
    const text = heap.alloc(4)
    heap.put(text, 'ABCDE')
    expect(heap.get(text)).toBe('ABCD')
    expect(heap.length(text)).toBe(4)
    expect(heap.length(0)).toBe(0)
  })

  it('writes the position word and byte into the three metadata bytes', () => {
    const heap = new OsCStringHeap(0x3000, 0x100)
    const text = heap.alloc(8)
    heap.position(text, 0x1234, 0x56)
    const at = text - heap.memory.base
    expect([...heap.memory.buffer.subarray(at - 3, at)]).toEqual([0x12, 0x34, 0x56])
  })
})
