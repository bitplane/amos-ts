/**
 * MMD2, against three of the 187 modules OctaMED Professional 6 shipped.
 *
 * The checks that matter are the ones a reader of MMD0 would get wrong: the
 * song header grew four pointers and two words past $1f8, a block carries its
 * OWN track count rather than the song's, and a note is four bytes where MMD0
 * used three.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { describeWith } from '../testing/fixture'
import {
  MMD2_CHANNELS_AT,
  MMD2_ECHODEPTH_AT,
  MMD2_ECHOTYPE_AT,
  MMD2_FLAGS3_AT,
  MMD2_NUMPSEQS_AT,
  MMD2_NUMTRACKS_AT,
  MMD2_PLAYSEQ_HEADER,
  MMD2_PLAYSEQ_LENGTH_AT,
  MMD2_STEREOSEP_AT,
  MMD2_VOLADJ_AT,
  MMD_BLOCK_HEADER,
  MMD_FLAG2_BMASK,
  MMD_FLAG2_BPM,
  MMD_FLAG2_MIX,
  MMD_FLAG_8CHANNEL,
  MMD_FLAGS2_AT,
  MMD_FLAGS_AT,
  MMD_INSTRUMENTS,
  MMD_INSTRUMENT_BYTES,
  MMD_NOTE_BYTES,
  MMD_TEMPO2_AT,
  mmd2NoteAt,
  mmdMixType,
  parseMmd2,
  type Mmd2Song,
} from './mmd2'

const load = (n: string): Mmd2Song | null => {
  try {
    return parseMmd2(new Uint8Array(readFileSync(`fixtures/modules/dme/${n}.mmd2`)))
  } catch {
    return null
  }
}

describe('the layout the relocation pass states', () => {
  it('puts numblocks at $1f8 because 63 instruments of eight come first', () => {
    expect(MMD_INSTRUMENTS * MMD_INSTRUMENT_BYTES).toBe(0x1f8)
  })

  it('leaves a two-word gap at $208, which is why $215c4a skips it', () => {
    // the pass relocates $1fc, $200, $204 and $20c; $208 and $20a are words
    expect(MMD2_NUMPSEQS_AT - MMD2_NUMTRACKS_AT).toBe(2)
  })

  it('opens a play sequence with 32 of name and eight reserved', () => {
    expect(MMD2_PLAYSEQ_LENGTH_AT).toBe(0x28)
    expect(MMD2_PLAYSEQ_HEADER).toBe(0x2a)
  })

  it('takes only MMD2, and leaves MMD0 and MMD1 to runtime/med.ts', () => {
    const stub = (id: string): Uint8Array => {
      const d = new Uint8Array(0x400)
      for (const [i, c] of [...id].entries()) d[i] = c.charCodeAt(0)
      d[0xb] = 0x40 // the song header, well inside the buffer
      return d
    }
    expect(parseMmd2(stub('MMD0'))).toBeNull()
    expect(parseMmd2(stub('MMD1'))).toBeNull()
    expect(parseMmd2(stub('MMD3'))).toBeNull()
    expect(parseMmd2(stub('MMD2'))).not.toBeNull()
  })

  it('refuses a song header that points outside the module', () => {
    const d = new Uint8Array(0x400)
    for (const [i, c] of [...'MMD2'].entries()) d[i] = c.charCodeAt(0)
    d[0xa] = 0xff
    expect(parseMmd2(d)).toBeNull()
  })
})

const fugue = load('omed-fugue')
const cuku = load('omed-cuku')
const notears = load('omed-notears')

describe.skipIf(!fugue)('"Little Fugue In G Minor", six tracks throughout', () => {
  const song = fugue!

  it('is nine blocks of six tracks, played straight through', () => {
    expect(song.tracks).toBe(6)
    expect(song.blocks).toHaveLength(9)
    expect(song.playSeqs).toHaveLength(1)
    expect(song.playSeqs[0]).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8])
    expect(song.sections).toBe(1)
    expect(song.sectionTable).toEqual([0])
  })

  it('stores one less than the line count, so 131 means 132 lines', () => {
    expect(song.blocks[0]!.lines).toBe(132)
    expect(song.blocks[2]!.lines).toBe(205)
  })

  it('spaces its blocks four bytes a note, not three', () => {
    // block 0 to block 1 is 3,176 bytes, and 8 + 132 * 6 * 4 is 3,176
    const b0 = song.blocks[0]!
    const b1 = song.blocks[1]!
    expect(b1.at - MMD_BLOCK_HEADER - (b0.at - MMD_BLOCK_HEADER)).toBe(
      MMD_BLOCK_HEADER + b0.lines * b0.tracks * MMD_NOTE_BYTES,
    )
  })

  it('puts each block info BEFORE its block, where a reader would not look', () => {
    for (const b of song.blocks) {
      if (b.info === 0) continue
      expect(b.info).toBeLessThan(b.at)
    }
  })

  it('keeps every note inside the module', () => {
    for (const b of song.blocks) {
      const last = mmd2NoteAt(song, b, b.lines - 1, b.tracks - 1)
      expect(last).toHaveLength(MMD_NOTE_BYTES)
    }
  })

  it('names six instruments with a volume', () => {
    expect(song.instruments).toHaveLength(63)
    expect(song.instruments.filter((i) => i.volume > 0)).toHaveLength(6)
  })
})

describe.skipIf(!cuku)('"Cuku\'s Dead", where the blocks disagree with the song', () => {
  const song = cuku!

  it('says seven tracks and then holds blocks of five, six and seven', () => {
    expect(song.tracks).toBe(7)
    const widths = new Set(song.blocks.map((b) => b.tracks))
    expect([...widths].sort()).toEqual([4, 5, 6, 7])
  })

  it('indexes a note by the BLOCK\'s track count, not the song\'s', () => {
    const narrow = song.blocks.find((b) => b.tracks === 5)!
    const wide = song.blocks.find((b) => b.tracks === 7)!
    // a line is tracks * 4 bytes, so the two strides differ by eight
    expect(mmd2NoteAt(song, narrow, 1, 0).byteOffset - narrow.at).toBe(5 * MMD_NOTE_BYTES)
    expect(mmd2NoteAt(song, wide, 1, 0).byteOffset - wide.at).toBe(7 * MMD_NOTE_BYTES)
  })

  it('repeats blocks 2 and 3 in its play sequence', () => {
    expect(song.playSeqs[0]!.slice(0, 12)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 2, 3, 8, 9])
  })
})

describe.skipIf(!notears)('"No Tears", the four-track case', () => {
  const song = notears!

  it('is four blocks of 4x64 and a sequence that reorders them', () => {
    expect(song.tracks).toBe(4)
    expect(song.blocks.map((b) => `${b.tracks}x${b.lines}`)).toEqual(['4x64', '4x64', '4x64', '4x64'])
    expect(song.playSeqs[0]).toEqual([1, 1, 0, 2, 2, 3])
  })

  it('is an MMD2 even though four tracks would fit medplayer', () => {
    // which is the point: the format, not the width, decides who plays it
    expect(song.id).toBe('MMD2')
    expect(song.extraSongs).toBe(0)
  })
})

describe('the mixing-mode tail, which only DME_OctaMix.library reads', () => {
  /** the fields sit between trackpans at $20c and deftempo at $2fc */
  it('lays the mix fields out where the library indexes them', () => {
    expect(MMD2_FLAGS3_AT).toBe(0x210)
    expect(MMD2_VOLADJ_AT).toBe(0x214)
    expect(MMD2_CHANNELS_AT).toBe(0x216)
    expect(MMD2_ECHOTYPE_AT).toBe(0x218)
    expect(MMD2_ECHODEPTH_AT).toBe(0x219)
    expect(MMD2_STEREOSEP_AT).toBe(0x21c)
    expect(MMD_TEMPO2_AT).toBe(0x301)
  })

  /** flags2 packs three things into one byte, and $2115ce reads two of them */
  it('splits flags2 into a beat mask, a BPM bit and the mix bit', () => {
    expect(MMD_FLAG2_BMASK).toBe(0x1f)
    expect(MMD_FLAG2_BPM).toBe(0x20)
    expect(MMD_FLAG2_MIX).toBe(0x80)
    expect(MMD_FLAG2_BMASK | MMD_FLAG2_BPM | MMD_FLAG2_MIX).toBe(0xbf)
  })

  /**
   * $212e5c, and the reason `Omix Load` refuses every module in `fixtures/`.
   * Two bits, tested in that order, and a module with neither answers 0.
   */
  it('answers 2 for the mix bit, 1 for the eight-channel bit and 0 for neither', () => {
    const mod = (flags: number, flags2: number): Uint8Array => {
      const d = new Uint8Array(0x400)
      d.set([0x4d, 0x4d, 0x44, 0x32])
      // the song pointer, as a bank-relative offset
      d[8] = 0
      d[9] = 0
      d[10] = 0
      d[11] = 0x40
      d[0x40 + MMD_FLAGS_AT] = flags
      d[0x40 + MMD_FLAGS2_AT] = flags2
      return d
    }
    expect(mmdMixType(mod(0, 0))).toBe(0)
    expect(mmdMixType(mod(0, MMD_FLAG2_MIX))).toBe(2)
    expect(mmdMixType(mod(MMD_FLAG_8CHANNEL, 0))).toBe(1)
    // the mix bit is tested FIRST, so it wins when both are set
    expect(mmdMixType(mod(MMD_FLAG_8CHANNEL, MMD_FLAG2_MIX))).toBe(2)
    // and the beat mask and the BPM bit are not the mix bit
    expect(mmdMixType(mod(0, MMD_FLAG2_BMASK | MMD_FLAG2_BPM))).toBe(0)
  })

  it('is 0 for anything too short to hold a song header', () => {
    expect(mmdMixType(new Uint8Array(16))).toBe(0)
  })
})

describeWith('an OctaMED Professional 6 module', load('omed-cuku'), (song) => {
  /**
   * The point of this suite. All three fixtures are MMD2 and none of them has
   * the mix bit, which is why `Omix Load` refuses all 187 of the modules that
   * shipped with the tracker that wrote them.
   */
  it('is a real MMD2 that OctaMix would refuse', () => {
    expect(song.id).toBe('MMD2')
    expect(song.mixType).not.toBe(2)
    expect(song.flags2 & MMD_FLAG2_MIX).toBe(0)
  })

  it('reads the tempo tail every MMD song shares', () => {
    expect(song.defTempo).toBeGreaterThan(0)
    expect(song.tempo2).toBeGreaterThan(0)
    // the beat mask plus one is what $2115d2 multiplies the BPM by
    expect((song.flags2 & MMD_FLAG2_BMASK) + 1).toBeGreaterThan(0)
  })

  /**
   * $213672 is `move.w $216(a4),d0 / bne / moveq #$4,d0`, so a module that
   * never set the field mixes four channels rather than none.
   */
  it('defaults the channel count to four rather than zero', () => {
    expect(song.channels).toBeGreaterThanOrEqual(4)
  })
})
