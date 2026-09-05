import { describe, expect, it } from 'vitest'
import { ExecListHeap } from './oslist'

describe('OS DevKit Exec List and Node operations', () => {
  it('allocates the exact 14-byte empty List sentinel layout', () => {
    const heap = new ExecListHeap()
    const list = heap.allocList()
    expect(heap.listHead(list)).toBe(list + 4)
    expect(heap.readU32(list + 4)).toBe(0)
    expect(heap.listTail(list)).toBe(list)
    expect(heap.listType(list)).toBe(0)
  })

  it('writes and reads every exposed List and Node field at native widths', () => {
    const heap = new ExecListHeap()
    const list = heap.allocList()
    const node = heap.allocNode(12)
    const name = heap.allocCString('Node')
    heap.setListHead(list, node)
    heap.setListTail(list, node)
    heap.setListType(list, 0x101)
    heap.setNodeSucc(node, 0x1234_5678)
    heap.setNodePred(node, 0x8765_4321)
    heap.setNodeType(node, 0x102)
    heap.setNodePriority(node, 0xff)
    heap.setNodeName(node, name)
    expect([heap.listHead(list), heap.listTail(list), heap.listType(list)]).toEqual([node, node, 1])
    expect([heap.nodeSucc(node), heap.nodePred(node), heap.nodeType(node)]).toEqual([0x1234_5678, 0x8765_4321, 2])
    expect(heap.nodePriority(node)).toBe(-1)
    expect(heap.nodeName(node)).toBe(name)
    expect(heap.nodeStart(node)).toBe(node + 14)
  })

  it('implements Insert, Remove, head and tail operations through the sentinels', () => {
    const heap = new ExecListHeap()
    const list = heap.allocList()
    const a = heap.allocNode()
    const b = heap.allocNode()
    const c = heap.allocNode()
    heap.addHead(list, b)
    heap.addHead(list, a)
    heap.addTail(list, c)
    expect(heap.listHead(list)).toBe(a)
    expect(heap.nodeSucc(a)).toBe(b)
    expect(heap.nodePred(a)).toBe(list)
    expect(heap.nodeSucc(c)).toBe(list + 4)
    expect(heap.listTail(list)).toBe(c)
    heap.remove(b)
    expect(heap.nodeSucc(a)).toBe(c)
    expect(heap.nodePred(c)).toBe(a)
    expect(heap.remHead(list)).toBe(a)
    expect(heap.remTail(list)).toBe(c)
    expect(heap.remHead(list)).toBe(0)
    expect(heap.remTail(list)).toBe(0)
  })

  it('enqueues stably by signed priority and performs case-sensitive continued name searches', () => {
    const heap = new ExecListHeap()
    const list = heap.allocList()
    const nodes = [heap.allocNode(), heap.allocNode(), heap.allocNode(), heap.allocNode()]
    const specs: Array<[number, string]> = [[-2, 'low'], [4, 'First'], [4, 'second'], [10, 'HIGH']]
    for (let i = 0; i < nodes.length; i++) {
      heap.setNodePriority(nodes[i]!, specs[i]![0])
      heap.setNodeName(nodes[i]!, heap.allocCString(specs[i]![1]))
      heap.enqueue(list, nodes[i]!)
    }
    const ordered: number[] = []
    for (let node = heap.listHead(list); node !== list + 4; node = heap.nodeSucc(node)) ordered.push(node)
    expect(ordered).toEqual([nodes[3], nodes[1], nodes[2], nodes[0]])
    expect(heap.findName(list, heap.allocCString('First'))).toBe(nodes[1])
    expect(heap.findName(nodes[1]!, heap.allocCString('second'))).toBe(nodes[2])
    expect(heap.findName(list, heap.allocCString('fIrSt'))).toBe(0)
    expect(heap.findName(list, heap.allocCString('absent'))).toBe(0)
  })

  it('invalidates an allocation when FreeVec releases it', () => {
    const heap = new ExecListHeap()
    const node = heap.allocNode()
    heap.free(node)
    expect(() => heap.nodeType(node)).toThrow(RangeError)
  })
})
