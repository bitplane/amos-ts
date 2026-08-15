/**
 * The queue policy, which is the half of the worklet path that can be tested.
 *
 * There is no browser here and no `AudioWorkletProcessor` in Node, so the
 * processor itself is exercised by nobody — which is exactly why it holds a
 * queue and a cursor and nothing else. Every decision about what to send, what
 * to drop and when to trim lives in `AudioQueue`, and this is it.
 */
import { describe, expect, it } from 'vitest'
import { PaulaMixer } from '../amiga/mixer'
import { AudioQueue, MASTER_GAIN, MAX_MS, MIXER_WORKLET_SOURCE, TARGET_MS } from './mixersink'

const RATE = 44100
/** what one 50Hz frame of simulated time renders to */
const FRAME = RATE / 50

describe('the queue the worklet is fed from', () => {
  it('sends while there is room, and counts what it holds', () => {
    const q = new AudioQueue(RATE)
    for (let i = 0; i < 6; i++) expect(q.offer(FRAME).send).toBe(true)
    expect(q.depth).toBe(6 * FRAME)
    expect(q.dropped).toBe(0)
    // six frames of audio is 120ms, which is the target
    expect(q.target).toBe(Math.round((RATE * TARGET_MS) / 1000))
    expect(q.max).toBe(Math.round((RATE * MAX_MS) / 1000))
  })

  it('drops a block that would overflow rather than growing the latency', () => {
    const q = new AudioQueue(RATE)
    let sent = 0
    for (let i = 0; i < 40; i++) if (q.offer(FRAME).send) sent++
    expect(sent).toBeLessThan(40)
    expect(q.depth).toBeLessThanOrEqual(q.max)
    expect(q.dropped).toBeGreaterThan(0)
  })

  it('trims back to the target when the queue is over the mark on its own', () => {
    const q = new AudioQueue(RATE)
    // twenty frames at once, which is what turbo renders in one animation frame
    for (let i = 0; i < 20; i++) q.offer(FRAME)
    expect(q.depth).toBeLessThanOrEqual(q.max)
    q.report(q.max + FRAME) // the worklet says it is deeper than we thought
    const action = q.offer(FRAME)
    expect(action.send).toBe(false)
    expect(action.trim).toBe(q.target)
    expect(q.depth).toBe(q.target)
    expect(q.trims).toBe(1)
  })

  it('leaves a queue alone when a block merely would not fit', () => {
    const q = new AudioQueue(RATE)
    q.report(q.max - 10)
    const action = q.offer(FRAME)
    expect(action.send).toBe(false)
    expect(action.trim).toBeNull()
    expect(q.depth).toBe(q.max - 10)
  })

  it('takes the worklet_s own count over its estimate', () => {
    const q = new AudioQueue(RATE)
    q.offer(FRAME)
    q.offer(FRAME)
    expect(q.depth).toBe(2 * FRAME)
    q.report(17)
    expect(q.depth).toBe(17)
    expect(q.offer(FRAME).send).toBe(true)
    expect(q.depth).toBe(17 + FRAME)
  })

  it('recovers once the device has drained what it was given', () => {
    const q = new AudioQueue(RATE)
    while (q.offer(FRAME).send) {
      /* fill it */
    }
    expect(q.offer(FRAME).send).toBe(false)
    q.report(0)
    expect(q.offer(FRAME).send).toBe(true)
  })
})

describe('the mixer clock, started late', () => {
  it('renders from the instant the device appeared, not from zero', () => {
    // the browser has no context until a user gesture, and a program can have
    // been running for minutes: without `startAt` the first runTo asks for
    // every sample since it started
    const blocks: number[] = []
    const mix = new PaulaMixer({ rate: RATE, onBlock: (b) => blocks.push(b.length >> 1) })
    mix.startAt(600)
    mix.runTo(600.02)
    expect(blocks).toEqual([FRAME])
    expect(mix.frames).toBe(FRAME)
  })

  it('still carries the fraction across an origin', () => {
    const mix = new PaulaMixer({ rate: RATE })
    mix.startAt(123)
    for (let i = 1; i <= 587; i++) mix.runTo(123 + i / 587)
    expect(mix.frames).toBe(RATE)
  })

  it('is a no-op on a mixer that starts at zero, which is every other caller', () => {
    const mix = new PaulaMixer({ rate: RATE })
    mix.runTo(1)
    expect(mix.frames).toBe(RATE)
  })
})

describe('the processor source', () => {
  /**
   * It ships as a string and becomes a Blob URL, so nothing type-checks it and
   * nothing here runs it. What can be checked is that it is the shape
   * `addModule` needs and that it agrees with this side about the protocol.
   */
  it('registers the name the node asks for', () => {
    expect(MIXER_WORKLET_SOURCE).toContain("registerProcessor('amos-mixer'")
    expect(MIXER_WORKLET_SOURCE).toContain('extends AudioWorkletProcessor')
  })

  it('handles all three messages this side sends', () => {
    for (const field of ['m.pcm', 'm.trim', 'm.gain']) {
      expect(MIXER_WORKLET_SOURCE, field).toContain(field)
    }
    expect(MIXER_WORKLET_SOURCE).toContain('postMessage({ depth:')
  })

  it('keeps the processor alive through silence', () => {
    // a process() returning false is torn down, and this one has to survive
    // a program that is not making any sound yet
    expect(MIXER_WORKLET_SOURCE).toContain('return true')
    expect(MIXER_WORKLET_SOURCE).not.toContain('return false')
  })

  it('starts at the gain the old sink used, so the swap is not a level change', () => {
    expect(MASTER_GAIN).toBe(0.4)
    expect(MIXER_WORKLET_SOURCE).toContain('this.gain = 0.4')
  })

  it('parses as JavaScript', () => {
    // `new Function` will not accept a class body it cannot parse, which
    // catches the typo that a string constant otherwise ships with
    expect(() => new Function(`if (typeof AudioWorkletProcessor === 'undefined') return; ${MIXER_WORKLET_SOURCE}`)).not.toThrow()
  })
})
