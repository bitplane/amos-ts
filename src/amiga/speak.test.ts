import { describe, expect, it } from 'vitest'
import { SpeakBuffer, defaultSpeakOptions, isSpeakPath, parseSpeakOptions } from './speak'

describe('SPEAK: path recognition', () => {
  it('matches the device name however it is spelled', () => {
    // AmigaDOS device names are case-insensitive
    for (const p of ['SPEAK:', 'speak:', 'Speak:', ' SPEAK: ', 'SPEAK:OPT/r']) {
      expect(isSpeakPath(p), p).toBe(true)
    }
  })

  it('does not match a file that merely begins with the letters', () => {
    // the colon is what makes it a device; `speaker.txt` is a file
    for (const p of ['speaker.txt', 'df0:speak', 'ram:speak.dat', 'speak']) {
      expect(isSpeakPath(p), p).toBe(false)
    }
  })
})

describe('SPEAK: option strings', () => {
  it('a bare open speaks in narrator.device defaults', () => {
    // the same defaults src/runtime/speech.ts starts Say from
    expect(parseSpeakOptions('SPEAK:')).toEqual(defaultSpeakOptions())
    expect(defaultSpeakOptions()).toEqual({ rate: 150, pitch: 110, sex: 0, mode: 0, raw: false })
  })

  it('accepts both the slash and the space spelling', () => {
    expect(parseSpeakOptions('SPEAK:OPT/r').raw).toBe(true)
    expect(parseSpeakOptions('SPEAK:OPT r150 p90').rate).toBe(150)
    expect(parseSpeakOptions('SPEAK:OPT r150 p90').pitch).toBe(90)
    expect(parseSpeakOptions('SPEAK:OPT/r200/p80')).toMatchObject({ rate: 200, pitch: 80 })
  })

  it('reads a bare r as raw and r with digits as the rate', () => {
    // the one real ambiguity in the option letters, resolved by whether a
    // number follows — the only reading under which both spellings work
    expect(parseSpeakOptions('SPEAK:OPT/r')).toMatchObject({ raw: true, rate: 150 })
    expect(parseSpeakOptions('SPEAK:OPT/r250')).toMatchObject({ raw: false, rate: 250 })
    expect(parseSpeakOptions('SPEAK:OPT/r/r250')).toMatchObject({ raw: true, rate: 250 })
  })

  it('takes sex and expression as one bit each', () => {
    expect(parseSpeakOptions('SPEAK:OPT s1').sex).toBe(1)
    expect(parseSpeakOptions('SPEAK:OPT s0').sex).toBe(0)
    expect(parseSpeakOptions('SPEAK:OPT x1').mode).toBe(1)
    // anything else folds to the bit rather than erroring
    expect(parseSpeakOptions('SPEAK:OPT s3').sex).toBe(1)
  })

  it('ignores an out-of-range value rather than clamping it', () => {
    // narrator's own ranges: rate 40..400, pitch 65..320. A program asking
    // for something impossible keeps the default voice, which is what a
    // handler that validates its startup string would do
    expect(parseSpeakOptions('SPEAK:OPT r9999').rate).toBe(150)
    expect(parseSpeakOptions('SPEAK:OPT r10').rate).toBe(150)
    expect(parseSpeakOptions('SPEAK:OPT p30').pitch).toBe(110)
    expect(parseSpeakOptions('SPEAK:OPT p65').pitch).toBe(65)
    expect(parseSpeakOptions('SPEAK:OPT p320').pitch).toBe(320)
  })

  it('ignores an option letter it does not know', () => {
    // a handler that refused to open would break a program a real machine ran
    expect(parseSpeakOptions('SPEAK:OPT z9 q k12')).toEqual(defaultSpeakOptions())
    expect(parseSpeakOptions('SPEAK:OPT z9 p90').pitch).toBe(90)
  })

  it('needs the OPT keyword before it reads any letters', () => {
    // `SPEAK:r250` is not an option string; only OPT introduces one
    expect(parseSpeakOptions('SPEAK:r250')).toEqual(defaultSpeakOptions())
  })
})

describe('SpeakBuffer: when an utterance is released', () => {
  it('speaks at a full stop, keeping the stop', () => {
    const b = new SpeakBuffer()
    expect(b.feed('Hello there.')).toEqual(['Hello there.'])
  })

  it('speaks at a line end, which contributes nothing to say', () => {
    const b = new SpeakBuffer()
    expect(b.feed('Hello there\r\n')).toEqual(['Hello there'])
  })

  it('joins the pieces of a semicolon-continued Print', () => {
    // the case the rule exists for: three writes, one sentence, one utterance
    const b = new SpeakBuffer()
    expect(b.feed('hello ')).toEqual([])
    expect(b.feed('there ')).toEqual([])
    expect(b.feed('world.')).toEqual(['hello there world.'])
  })

  it('releases several utterances from one write', () => {
    const b = new SpeakBuffer()
    expect(b.feed('One. Two. Three.')).toEqual(['One.', 'Two.', 'Three.'])
  })

  it('holds a part-sentence until it is terminated', () => {
    const b = new SpeakBuffer()
    expect(b.feed('half a sen')).toEqual([])
    expect(b.flush()).toEqual(['half a sen'])
  })

  it('says nothing for blank lines', () => {
    const b = new SpeakBuffer()
    expect(b.feed('\r\n\r\n')).toEqual([])
    expect(b.feed('   .  ')).toEqual([])
    expect(b.flush()).toEqual([])
  })

  it('empties itself on flush, so a reused channel does not repeat', () => {
    const b = new SpeakBuffer()
    b.feed('tail')
    expect(b.flush()).toEqual(['tail'])
    expect(b.flush()).toEqual([])
  })
})
