/** Binary-compatible managed backing for Exec List/Node helpers. */

import type { MemPool } from './exec'

interface Block {
  base: number
  data: Uint8Array
}

/**
 * A small big-endian address space for Exec's 14-byte `List` and `Node`
 * records. Keeping addresses, including the List's embedded tail sentinel,
 * makes the public predecessor/successor values match the machine layout.
 */
export class ExecListHeap {
  private next = 0x7c00_0000
  private readonly blocks = new Map<number, Block>()

  constructor(readonly pool?: MemPool) {}

  private alloc(bytes: number): number {
    if (this.pool) return this.pool.alloc(Math.max(1, bytes), { clear: true })
    const base = this.next
    const size = Math.max(1, bytes)
    this.next = (base + size + 3) & ~3
    this.blocks.set(base, { base, data: new Uint8Array(size) })
    return base
  }

  private block(address: number, bytes = 1): { block: Block; offset: number } {
    if (this.pool) {
      const offset = (address >>> 0) - this.pool.base
      if (
        offset >= 0 && offset + bytes <= this.pool.buffer.length &&
        this.pool.typeOfMem(address) !== 0 && this.pool.typeOfMem(address + bytes - 1) !== 0
      ) return { block: { base: this.pool.base, data: this.pool.buffer }, offset }
      throw new RangeError(`invalid Exec address $${(address >>> 0).toString(16)}`)
    }
    for (const block of this.blocks.values()) {
      const offset = address - block.base
      if (offset >= 0 && offset + bytes <= block.data.length) return { block, offset }
    }
    throw new RangeError(`invalid Exec address $${(address >>> 0).toString(16)}`)
  }

  readU8(address: number): number {
    const { block, offset } = this.block(address)
    return block.data[offset]!
  }

  writeU8(address: number, value: number): void {
    const { block, offset } = this.block(address)
    block.data[offset] = value
  }

  readU32(address: number): number {
    const { block, offset } = this.block(address, 4)
    return new DataView(block.data.buffer, block.data.byteOffset).getUint32(offset)
  }

  writeU32(address: number, value: number): void {
    const { block, offset } = this.block(address, 4)
    new DataView(block.data.buffer, block.data.byteOffset).setUint32(offset, value >>> 0)
  }

  allocList(): number {
    const list = this.alloc(14)
    this.initList(list)
    return list
  }

  /** Initialize a List embedded in a larger native allocation. */
  initList(list: number): void {
    // NewList: lh_Head=&lh_Tail, lh_Tail=NULL, lh_TailPred=&lh_Head.
    this.writeU32(list, list + 4)
    this.writeU32(list + 4, 0)
    this.writeU32(list + 8, list)
  }

  allocNode(extraBytes = 0): number {
    return this.alloc(14 + Math.max(0, extraBytes | 0))
  }

  allocCString(text: string): number {
    const address = this.alloc(text.length + 1)
    for (let i = 0; i < text.length; i++) this.writeU8(address + i, text.charCodeAt(i))
    return address
  }

  free(address: number): void {
    if (address === 0) return
    if (this.pool) this.pool.freeMem(address)
    else this.blocks.delete(address)
  }

  setListHead(list: number, head: number): void {
    if (list !== 0) this.writeU32(list, head)
  }

  setListTail(list: number, tailPred: number): void {
    if (list !== 0) this.writeU32(list + 8, tailPred)
  }

  setListType(list: number, type: number): void {
    if (list !== 0) this.writeU8(list + 12, type)
  }

  setNodeSucc(node: number, succ: number): void {
    if (node !== 0) this.writeU32(node, succ)
  }

  setNodePred(node: number, pred: number): void {
    if (node !== 0) this.writeU32(node + 4, pred)
  }

  setNodeType(node: number, type: number): void {
    if (node !== 0) this.writeU8(node + 8, type)
  }

  setNodePriority(node: number, priority: number): void {
    if (node !== 0) this.writeU8(node + 9, priority)
  }

  setNodeName(node: number, name: number): void {
    if (node !== 0) this.writeU32(node + 10, name)
  }

  listHead(list: number): number { return this.readU32(list) }
  listTail(list: number): number { return this.readU32(list + 8) }
  listType(list: number): number { return this.readU8(list + 12) }
  nodeSucc(node: number): number { return this.readU32(node) }
  nodePred(node: number): number { return this.readU32(node + 4) }
  nodeType(node: number): number { return this.readU8(node + 8) }
  nodePriority(node: number): number { return (this.readU8(node + 9) << 24) >> 24 }
  nodeName(node: number): number { return this.readU32(node + 10) }
  nodeStart(node: number): number { this.block(node, 14); return node + 14 }

  insert(list: number, node: number, predecessor: number): void {
    if (list === 0 || node === 0) return
    const pred = predecessor === 0 ? list : predecessor
    const succ = this.readU32(pred)
    this.writeU32(node, succ)
    this.writeU32(node + 4, pred)
    this.writeU32(pred, node)
    this.writeU32(succ + 4, node)
  }

  remove(node: number): void {
    if (node === 0) return
    const succ = this.nodeSucc(node)
    const pred = this.nodePred(node)
    this.writeU32(pred, succ)
    this.writeU32(succ + 4, pred)
  }

  addHead(list: number, node: number): void { this.insert(list, node, list) }
  addTail(list: number, node: number): void { this.insert(list, node, this.listTail(list)) }

  remHead(list: number): number {
    if (list === 0) return 0
    const node = this.listHead(list)
    if (node === list + 4) return 0
    this.remove(node)
    return node
  }

  remTail(list: number): number {
    if (list === 0) return 0
    const node = this.listTail(list)
    if (node === list) return 0
    this.remove(node)
    return node
  }

  /** Exec Enqueue: descending signed priority, stable among equal priorities. */
  enqueue(list: number, node: number): void {
    if (list === 0 || node === 0) return
    const priority = this.nodePriority(node)
    let pred = list
    let cursor = this.listHead(list)
    while (cursor !== list + 4 && this.nodePriority(cursor) >= priority) {
      pred = cursor
      cursor = this.nodeSucc(cursor)
    }
    this.insert(list, node, pred)
  }

  cString(address: number): string {
    if (address === 0) return ''
    let result = ''
    for (let at = address; this.readU8(at) !== 0; at++) result += String.fromCharCode(this.readU8(at))
    return result
  }

  /** Exec FindName is case-sensitive and can start at a List or prior Node. */
  findName(list: number, name: number): number {
    if (list === 0 || name === 0) return 0
    const wanted = this.cString(name)
    // The successor-null tail sentinel is not a candidate. Reading the first
    // pointer also gives FindName((struct List *)previousNode, ...) its native
    // "continue after this node" behaviour.
    for (let node = this.readU32(list); node !== 0 && this.nodeSucc(node) !== 0; node = this.nodeSucc(node)) {
      if (this.cString(this.nodeName(node)) === wanted) return node
    }
    return 0
  }
}
