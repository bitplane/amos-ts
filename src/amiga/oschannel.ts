/** Managed equivalent of OS DevKit's private `_chn` chain/list records. */

export interface OsChannelList {
  /** +0 */
  number: number
  /** +4: default payload length */
  defaultLength: number
  /** +8 */
  first: OsChannel | null
  /** +12 */
  last: OsChannel | null
}

/**
 * The public pointer returned by the binary points at `data`; these four
 * fields occupy its private 24-byte header at -$18, -$14, -$10 and -$0c.
 */
export interface OsChannel {
  length: number
  list: OsChannelList
  previous: OsChannel | null
  next: OsChannel | null
  data: Uint8Array
}

export function channelList(defaultLength: number): OsChannelList {
  return { number: 0, defaultLength: defaultLength | 0, first: null, last: null }
}

function make(list: OsChannelList, length: number): OsChannel {
  const size = Math.max(0, length | 0)
  return { length: size, list, previous: null, next: null, data: new Uint8Array(size) }
}

/** Routine 1146: append, using the list default when its wrapper 1139 calls. */
export function channelAdd(list: OsChannelList, length = list.defaultLength): OsChannel {
  const node = make(list, length)
  node.previous = list.last
  if (list.last) list.last.next = node
  else list.first = node
  list.last = node
  list.number++
  return node
}

/** One-based position, or zero when the node is not reachable from its list. */
export function channelLocation(node: OsChannel | null): number {
  if (!node) return 0
  let at = node.list.first
  for (let position = 1; at; position++, at = at.next) if (at === node) return position
  return 0
}

/** Routine 1141: one-based lookup with the same out-of-range null result. */
export function channelFind(list: OsChannelList | null, position: number): OsChannel | null {
  if (!list || position <= 0 || position > list.number) return null
  let node = list.first
  for (let at = 1; node && at < position; at++) node = node.next
  return node
}

/** Routine 1148: insert immediately before an existing node. */
export function channelInsert(before: OsChannel | null, length?: number): OsChannel | null {
  if (!before) return null
  const list = before.list
  const node = make(list, length ?? list.defaultLength)
  node.previous = before.previous
  node.next = before
  if (before.previous) before.previous.next = node
  else list.first = node
  before.previous = node
  list.number++
  return node
}

/** Routine 1143: unlink and invalidate a node's linkage. */
export function channelFree(node: OsChannel | null): void {
  if (!node) return
  const list = node.list
  const linked = channelLocation(node) !== 0
  if (!linked) return
  if (node.previous) node.previous.next = node.next
  else if (list.first === node) list.first = node.next
  if (node.next) node.next.previous = node.previous
  else if (list.last === node) list.last = node.previous
  list.number--
  node.previous = null
  node.next = null
}

export function channelListFree(list: OsChannelList | null): void {
  if (!list) return
  let node = list.first
  while (node) {
    const next = node.next
    node.previous = null
    node.next = null
    node = next
  }
  list.number = 0
  list.first = null
  list.last = null
}

/**
 * Routine 1142 replaces the allocation in place in the list.
 *
 * The shipped worker mistakenly asks its copy helper for MAX(old,new) bytes,
 * overflowing whichever allocation is shorter. Managed arrays cannot expose
 * adjacent-allocation corruption, so this preserves the meaningful prefix.
 */
export function channelResize(node: OsChannel | null, length: number): OsChannel | null {
  if (!node) return null
  const replacement = channelInsert(node, length)!
  replacement.data.set(node.data.subarray(0, replacement.data.length))
  channelFree(node)
  return replacement
}

/** Routine 1151 is shipped as a six-byte no-op; it only consumes its args. */
export function channelSwap(_a: OsChannel | null, _b: OsChannel | null): void {}
