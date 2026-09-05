import { describe, expect, it } from 'vitest'
import {
  channelAdd, channelFind, channelFree, channelInsert, channelList, channelListFree,
  channelLocation, channelResize, channelSwap,
} from './oschannel'

describe('OS DevKit _chn records (workers 1122-1151)', () => {
  it('keeps the four list and four private-node fields', () => {
    const list = channelList(3)
    const a = channelAdd(list)
    const b = channelAdd(list, 5)
    expect(list).toMatchObject({ number: 2, defaultLength: 3, first: a, last: b })
    expect(a).toMatchObject({ length: 3, list, previous: null, next: b })
    expect(b).toMatchObject({ length: 5, list, previous: a, next: null })
  })

  it('uses one-based location/find and inserts before the named node', () => {
    const list = channelList(2)
    const a = channelAdd(list)
    const c = channelAdd(list)
    const b = channelInsert(c, 4)!
    expect([channelLocation(a), channelLocation(b), channelLocation(c)]).toEqual([1, 2, 3])
    expect(channelFind(list, 2)).toBe(b)
    expect(channelFind(list, 0)).toBeNull()
    expect(channelFind(list, 4)).toBeNull()
  })

  it('replaces a resized node at the same position and preserves its prefix', () => {
    const list = channelList(2)
    const a = channelAdd(list)
    a.data.set([1, 2])
    const b = channelResize(a, 4)!
    expect(channelLocation(b)).toBe(1)
    expect([...b.data]).toEqual([1, 2, 0, 0])
    expect(list.number).toBe(1)
  })

  it('unlinks individual nodes, frees whole lists, and reproduces Swap as a no-op', () => {
    const list = channelList(1)
    const a = channelAdd(list)
    const b = channelAdd(list)
    channelSwap(a, b)
    expect(list.first).toBe(a)
    channelFree(a)
    expect(list).toMatchObject({ number: 1, first: b, last: b })
    channelListFree(list)
    expect(list).toMatchObject({ number: 0, first: null, last: null })
  })
})
