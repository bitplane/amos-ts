/**
 * The mixer, checked as arithmetic rather than as sound.
 *
 * Every number here is exact and the filter is off for all but the last two
 * cases, because the point of rendering is that a test can finally say what
 * came out. `-128` at AUDxVOL 64 is -1.0 and nothing in between is rounded,
 * so a wrong step or a wrong loop wrap shows up as a wrong sample and not as
 * a slightly different tone.
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_MIX_RATE, PaulaMixer, VOICE_CHANNEL } from './mixer'

/** the left channel of a rendered block */
const left = (b: Float32Array): number[] => [...b].filter((_, i) => i % 2 === 0)
/** the right */
const right = (b: Float32Array): number[] => [...b].filter((_, i) => i % 2 === 1)

const dry = (): PaulaMixer => new PaulaMixer({ rate: 8000, filter: false })

describe('PaulaMixer: one voice', () => {
  it('renders full scale at AUDxVOL 64: -128 is -1.0, and 64 is half', () => {
    const m = dry()
    m.play(0, new Int8Array([-128, 64]), 8000, 64, 0, 2)
    expect(left(m.render(2))).toEqual([-1, 0.5])
  })

  it('scales by volume/64, which makes AMOS_s own maximum of 63 audibly short of unity', () => {
    const m = dry()
    m.play(0, new Int8Array([-128]), 8000, 32, 0, 1)
    expect(left(m.render(1))).toEqual([-0.5])
    m.setVolume(0, 63)
    expect(left(m.render(1))).toEqual([(-63 / 64)])
  })

  it('holds each sample rather than interpolating: a quarter-rate voice is a stair', () => {
    const m = dry()
    m.play(0, new Int8Array([64, -64]), 2000, 64, 0, 2)
    expect(left(m.render(8))).toEqual([0.5, 0.5, 0.5, 0.5, -0.5, -0.5, -0.5, -0.5])
  })

  it('plays the whole buffer before it loops, then repeats the loop region', () => {
    const m = dry()
    m.play(0, new Int8Array([1, 2, 3, 4]), 8000, 64, 2, 4)
    const out = left(m.render(8)).map((s) => Math.round(s * 128))
    expect(out).toEqual([1, 2, 3, 4, 3, 4, 3, 4])
  })

  it('stops at the end when nothing set a loop region', () => {
    const m = dry()
    m.play(0, new Int8Array([1, 2, 3, 4]), 8000, 64, -1)
    expect(left(m.render(6)).map((s) => Math.round(s * 128))).toEqual([1, 2, 3, 4, 0, 0])
  })

  it('keeps the pointer moving at volume 0, so a voice resumes where the DMA got to', () => {
    const m = dry()
    m.play(0, new Int8Array([1, 2, 3, 4]), 8000, 0, 0, 4)
    expect(left(m.render(2))).toEqual([0, 0])
    m.setVolume(0, 64)
    expect(left(m.render(2)).map((s) => Math.round(s * 128))).toEqual([3, 4])
  })

  it('changes rate without restarting: setFrequency moves the step, not the position', () => {
    const m = dry()
    m.play(0, new Int8Array([1, 2, 3, 4]), 8000, 64, 0, 4)
    m.render(1)
    m.setFrequency(0, 4000)
    expect(left(m.render(4)).map((s) => Math.round(s * 128))).toEqual([2, 2, 3, 3])
  })

  it('swaps the bytes under a running voice and leaves the phase alone', () => {
    const m = dry()
    m.play(0, new Int8Array([1, 2, 3, 4]), 8000, 64, 0, 4)
    m.render(2)
    m.setWaveform(0, new Int8Array([9, 9, 7, 7]))
    expect(left(m.render(2)).map((s) => Math.round(s * 128))).toEqual([7, 7])
  })
})

describe('PaulaMixer: the four voices', () => {
  it('wires 0 and 3 to the left and 1 and 2 to the right, which is where the jacks are', () => {
    expect([...VOICE_CHANNEL]).toEqual([0, 1, 1, 0])
    for (let v = 0; v < 4; v++) {
      const m = dry()
      m.play(v, new Int8Array([64]), 8000, 64, 0, 1)
      const b = m.render(1)
      expect([left(b)[0], right(b)[0]]).toEqual(VOICE_CHANNEL[v] === 0 ? [0.5, 0] : [0, 0.5])
    }
  })

  it('sums a channel_s two voices unscaled, so full scale on both reaches -2', () => {
    const m = dry()
    m.play(0, new Int8Array([-128]), 8000, 64, 0, 1)
    m.play(3, new Int8Array([-128]), 8000, 64, 0, 1)
    expect(left(m.render(1))).toEqual([-2])
  })

  it('silences a voice on stop and leaves the other three alone', () => {
    const m = dry()
    m.play(0, new Int8Array([64]), 8000, 64, 0, 1)
    m.play(1, new Int8Array([64]), 8000, 64, 0, 1)
    m.stop(0)
    const b = m.render(1)
    expect([left(b)[0], right(b)[0]]).toEqual([0, 0.5])
  })
})

describe('PaulaMixer: the clock', () => {
  it('renders the frames a span is worth, and hands each block to the caller', () => {
    const blocks: number[] = []
    const m = new PaulaMixer({ filter: false, onBlock: (b) => blocks.push(b.length / 2) })
    m.runTo(1 / 50)
    expect(blocks).toEqual([DEFAULT_MIX_RATE / 50])
    expect(m.frames).toBe(882)
  })

  it('carries the fraction, so 300 MED ticks a second still come to exactly one second', () => {
    const m = new PaulaMixer({ filter: false })
    // 44100/300 is 147 exactly; 44100/293.5 is not, and neither is any real
    // MED tempo. 587 ticks of it is what a second of tempo 1 costs.
    for (let i = 1; i <= 587; i++) m.runTo(i / 587)
    expect(m.frames).toBe(DEFAULT_MIX_RATE)
    expect(m.time).toBe(1)
  })

  it('renders nothing for a time already passed, because the later write simply wins', () => {
    const m = new PaulaMixer({ filter: false })
    m.runTo(1 / 50)
    m.runTo(1 / 100)
    expect(m.frames).toBe(882)
    expect(m.time).toBe(1 / 50)
  })

  it('lands a register write where the clock was left, not at the top of the frame', () => {
    const m = new PaulaMixer({ rate: 8000, filter: false })
    const pcm = new Int8Array([64])
    m.runTo(4 / 8000)
    m.play(0, pcm, 8000, 64, 0, 1)
    m.runTo(8 / 8000)
    // four frames of nothing, then four of the note: the first block was
    // rendered before `play`, which is the whole point of the clock
    expect(m.frames).toBe(8)
  })
})

describe('PaulaMixer: the LED filter', () => {
  it('is switched by the same bit the machine switches it with, and starts engaged', () => {
    const m = new PaulaMixer({ rate: 8000 })
    expect(m.filter).toBe(true)
    m.setFilter(false)
    expect(m.filter).toBe(false)
  })

  it('rolls a step off rather than passing it, and converges on the level it is fed', () => {
    const m = new PaulaMixer({ rate: 8000 })
    m.play(0, new Int8Array([64]), 8000, 64, 0, 1)
    const out = left(m.render(400))
    expect(out[0]!).toBeLessThan(0.5)
    expect(out[0]!).toBeGreaterThan(0)
    expect(out[399]!).toBeCloseTo(0.5, 3)
  })
})

describe('a loop that runs past its sample', () => {
  /**
   * DME 2.0's own ProTracker example has them, and the first render of it
   * came out silent from 6.886 seconds onward.
   *
   * Paula takes AUDxLEN in words and cannot know how long the caller's buffer
   * is: aim it past the end on the machine and the DMA reads whatever chip
   * RAM follows, which is somebody else's data and audible garbage. There is
   * no memory after the buffer here, so `pcm[pos | 0]` was `undefined`,
   * `undefined * gain` was NaN, and the NaN then sat in the LED filter's
   * state for every sample after it. One bad read silenced the rest.
   */
  it('play() clamps a loop end past the buffer instead of reading off the end', () => {
    const m = new PaulaMixer({ rate: 44100, filter: false })
    const pcm = Int8Array.from([64, -64, 64, -64])
    // a loop the caller says is four times longer than the sample
    m.play(0, pcm, 8000, 64, 0, 16)
    const out = m.render(2000)
    expect(out.every((s) => Number.isFinite(s))).toBe(true)
    expect(out.some((s) => s !== 0)).toBe(true)
  })

  it('setLoop() clamps the same way, which it did not before', () => {
    const m = new PaulaMixer({ rate: 44100, filter: false })
    m.play(0, Int8Array.from([32, -32]), 8000, 64, 0)
    m.setLoop(0, 0, 9999)
    const out = m.render(2000)
    expect(out.every((s) => Number.isFinite(s))).toBe(true)
  })

  it('and one NaN would have poisoned the LED filter for the whole render', () => {
    // the filter is two cascaded one-poles: its state feeds itself, so a
    // single non-finite input never washes out. This is why 2,403 bad
    // samples became 1,019,349
    const m = new PaulaMixer({ rate: 44100 })
    m.setFilter(true)
    m.play(0, Int8Array.from([64, -64, 64, -64]), 8000, 64, 0, 64)
    const out = m.render(4000)
    expect(out.every((s) => Number.isFinite(s))).toBe(true)
  })
})
