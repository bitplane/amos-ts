import { describe, expect, it } from 'vitest'
import { QUAL } from '../editor/keymap'
import { decode } from './termkeys'

/** every key one chunk holds, in order */
function keys(buf: string): { ch?: string; scan?: number; shift?: number }[] {
  const out = []
  let left = buf
  for (;;) {
    const got = decode(left)
    if (got === null) return out
    out.push(got.key)
    left = left.slice(got.used)
  }
}

describe('a terminal, as EdKey', () => {
  it('gives the cursor keys their AMOS characters and their scancodes', () => {
    // `Cla_Special` (+W.s:12912): up is Chr$(30), down 31, right 28, left 29
    expect(keys('\x1b[A\x1b[B\x1b[C\x1b[D')).toEqual([
      { ch: '\x1e', scan: 0x4c },
      { ch: '\x1f', scan: 0x4d },
      { ch: '\x1c', scan: 0x4e },
      { ch: '\x1d', scan: 0x4f },
    ])
  })

  it('reads F1 to F10 in both of xterm shapes', () => {
    expect(keys('\x1bOP\x1bOQ\x1bOR\x1bOS').map((k) => k.scan)).toEqual([0x50, 0x51, 0x52, 0x53])
    expect(keys('\x1b[15~\x1b[17~\x1b[21~').map((k) => k.scan)).toEqual([0x54, 0x55, 0x59])
    expect(keys('\x1b[11~\x1b[14~').map((k) => k.scan)).toEqual([0x50, 0x53])
  })

  it('folds Ctrl-A to Ctrl-Z back into a letter and a qualifier', () => {
    expect(keys('\x01\x1a')).toEqual([
      { ch: 'a', shift: QUAL.CTRL },
      { ch: 'z', shift: QUAL.CTRL },
    ])
  })

  it('reads Return, Backspace, Tab and Del with the scancodes the map wants', () => {
    expect(keys('\r\x7f\t')).toEqual([
      { ch: '\r', scan: 0x44 },
      { ch: '\x08', scan: 0x41 },
      { ch: '\t', scan: 0x42 },
    ])
    // Del stores ASCII 0 with its scancode, which is how AMOS tells it apart
    expect(keys('\x1b[3~')).toEqual([{ ch: '\x00', scan: 0x46 }])
  })

  it('reads a lone ESC as the Escape key, which is Ed_Escape', () => {
    expect(keys('\x1b')).toEqual([{ ch: '\x1b', scan: 0x45 }])
  })

  it('passes an ordinary character through with no scancode at all', () => {
    // `Ed_Ky2Fonc` matches on the ASCII when the record has one, so a
    // scancode this port cannot know is better left out than guessed
    expect(keys('Ab1')).toEqual([{ ch: 'A' }, { ch: 'b' }, { ch: '1' }])
  })

  it('answers nothing for an empty buffer, so a partial sequence waits', () => {
    expect(decode('')).toBe(null)
  })
})
