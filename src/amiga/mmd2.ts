/**
 * MMD2 — OctaMED Professional's five-to-eight channel format, off
 * `octaplayer.library`.
 *
 * `runtime/med.ts` already plays MMD0 and MMD1 through medplayer.library, and
 * that library sounds four Paula voices whatever the block holds: $210d54
 * sends every track from index 4 upward to the MIDI handlers. MMD2 is the
 * format where the extra tracks are meant to be heard, and octaplayer is the
 * sibling that mixes them.
 *
 * ## Evidence
 *
 * Two independent copies of the same replayer, which is the best position any
 * of the eleven DME formats is in.
 *
 * `octaplayer-b27d6bb2.library` in `fixtures/libs/medplayer`, 23,984 bytes at
 * $210000, romtag "octaplayer.library  Version 1.0", version 7. And
 * `DME_OctaMed.library`, 23,824 bytes, which shares 73% of its bytes with it
 * --- DOOM Productions wrapped the same replayer they wrapped medplayer with
 * for `Med Play`.
 *
 * Every offset below is read out of the relocation pass at $215ae0, which has
 * to name each pointer in the module to add the load address to it, and so
 * states the whole layout in one place.
 *
 * ## The header
 *
 * $215b56 relocates four longs and skips the fields between them, which is
 * what identifies them. It reads `lea $8(a2),a0` and then `bsr / addq #4`
 * three times, and $215ad8 advances `a0` itself, so the four are $8, $10, $18
 * and $20 rather than four in a row.
 *
 *   $00  4 bytes  "MMD0", "MMD1", "MMD2" or "MMD3" ($2159e0 takes all four)
 *   $04  long     how long the module is
 *   $08  long     the song header
 *   $10  long     the block pointer array
 *   $14  byte     the flags, and bit 0 decides chip or any memory ($215a00)
 *   $18  long     the instrument pointer array
 *   $20  long     the expansion data
 *   $33  byte     how many more songs hang off the expansion data ($215b3c)
 *
 * ## The song header, and why $208 is skipped
 *
 * $215c4a is the MMD2-and-above pass, gated on byte 3 of the id being '2' or
 * above and not 'T'. It relocates $1fc, $200, $204 and $20c, and the
 * `addq.l #$4,a0` between the third and fourth is the giveaway: $208 holds two
 * WORDS, not a pointer.
 *
 *   $000  63 instruments of eight bytes: repeat, repeat length, MIDI channel,
 *         MIDI preset, volume, transpose
 *   $1f8  word  how many blocks
 *   $1fa  word  how many sections
 *   $1fc  long  the play-sequence table, itself an array of pointers
 *   $200  long  the section table
 *   $204  long  the track volumes
 *   $208  word  how many tracks
 *   $20a  word  how many play sequences
 *   $20c  long  the track pans
 *
 * `move.w -$6(a0),d0` at $215c64 then reads $20a and relocates that many
 * entries of the table at $1fc, which is how the two are known to belong
 * together.
 *
 * ## A play sequence
 *
 * $210ede reads its length from $28, so the header ahead of the words is 40
 * bytes: a 32-character name and eight bytes the format reserves.
 *
 * ## A block
 *
 * $215c1e walks the block array backwards and relocates $4 of each, so a block
 * opens with two words and a pointer:
 *
 *   $00  word  how many tracks THIS block has, which need not be $208's
 *   $02  word  the last line, so there are one more than this
 *   $04  long  the block info, which sits just BEFORE the block in the file
 *   $08  the notes, FOUR bytes each, across then down
 *
 * Four rather than three is settled by arithmetic on the file: the first two
 * blocks of "Little Fugue In G Minor" are 3,176 bytes apart and
 * `8 + 132 * 6 * 4` is 3,176, where three bytes a note would leave 792
 * unaccounted for in every block of every module.
 */

/** `cmpi.l` at $2159e0, $2159e8, $2159f0 and $2159f8, in that order */
export const MMD_MAGICS = ['MMD3', 'MMD2', 'MMD1', 'MMD0'] as const
/** `cmpi.b #$32,$3(a2)` at $215afe: '2' and above have the extra song fields */
export const MMD2_ID = 'MMD2'
/** 63 of eight bytes, which is what puts `numblocks` at $1f8 */
export const MMD_INSTRUMENTS = 63
export const MMD_INSTRUMENT_BYTES = 8
export const MMD2_NUMBLOCKS_AT = 0x1f8
export const MMD2_SECTIONS_AT = 0x1fa
export const MMD2_PLAYSEQTABLE_AT = 0x1fc
export const MMD2_SECTIONTABLE_AT = 0x200
export const MMD2_TRACKVOLS_AT = 0x204
export const MMD2_NUMTRACKS_AT = 0x208
export const MMD2_NUMPSEQS_AT = 0x20a
export const MMD2_TRACKPANS_AT = 0x20c

// The mixing-mode tail of MMD2song, which only `DME_OctaMix.library` reads.
// Every offset below was taken from an instruction in that library rather than
// from the format documentation.

/** `move.l $210(a0),d1` at $21162a, a long; bit 0 is stereo and bit 1 pairs */
export const MMD2_FLAGS3_AT = 0x210
/** $213348 compares it against a cached copy to decide whether to rebuild */
export const MMD2_VOLADJ_AT = 0x214
/** `move.w $216(a4),d0 / bne / moveq #$4,d0` at $213672: FOUR when it is zero */
export const MMD2_CHANNELS_AT = 0x216
/** `move.b $218(a0),$211681` at $211638 */
export const MMD2_ECHOTYPE_AT = 0x218
/** `move.b $219(a0),$211682` at $211640 */
export const MMD2_ECHODEPTH_AT = 0x219
export const MMD2_ECHOLEN_AT = 0x21a
/** `move.b $21c(a0),d1 / beq` at $2119ee: zero turns the stereo spread off */
export const MMD2_STEREOSEP_AT = 0x21c

// The tail every MMD song shares, whatever the id.

/** `divu.w $2fc(a0),d0` at $2115f8 */
export const MMD_DEFTEMPO_AT = 0x2fc
/** `add.b $2fe(a4),d1` at $211e00, added to every note */
export const MMD_PLAYTRANSP_AT = 0x2fe
export const MMD_FLAGS_AT = 0x2ff
export const MMD_FLAGS2_AT = 0x300
/** `cmp.b $301(a4),d3` at $2121f6: ticks per line */
export const MMD_TEMPO2_AT = 0x301

/** `andi.w #$1f,d1 / addq.w #$1,d1` at $2115ce: the beat mask, plus one */
export const MMD_FLAG2_BMASK = 0x1f
export const MMD_FLAG2_BPM = 0x20
/** `tst.b $300(a0) / bmi` at $212e64, and the whole of what OctaMix demands */
export const MMD_FLAG2_MIX = 0x80
/** `btst #$6,$2ff(a0)` at $212e6a, which is type 1 rather than type 2 */
export const MMD_FLAG_8CHANNEL = 0x40
/** `btst #$0,$213(a0)` at $2119f4, the low byte of the flags3 long */
export const MMD_FLAG3_STEREO = 1

// The play state, which is in the MODULE header rather than the song, because
// the replay writes it back as it goes. `=Omix Song Pos` and `=Omix Patt Pos`
// read two of these straight out of the bank ($715a and $717e).

export const MMD_PSECNUM_AT = 0x0c
export const MMD_PSEQ_AT = 0x0e
/** `tst.w $28(a2) / beq` at $2121e2: zero and the tick does nothing */
export const MMD_PSTATE_AT = 0x28
export const MMD_PBLOCK_AT = 0x2a
/** what `=Omix Patt Pos` reports */
export const MMD_PLINE_AT = 0x2c
/** what `=Omix Song Pos` reports */
export const MMD_PSEQNUM_AT = 0x2e
/** `move.b $32(a2),d3 / addq.b #$1,d3` at $2121f0: the tick within the line */
export const MMD_COUNTER_AT = 0x32

/**
 * `$212e5c`, which is LVO -36 and the only test `Omix Load` makes on content.
 *
 * Two bits decide it and nothing else does: bit 7 of `flags2` is mixing mode
 * and answers 2, bit 6 of `flags` is eight-channel and answers 1, and a module
 * with neither answers 0. `Omix Load` demands 2 at $6dfc and erases the bank
 * for anything else, which is why a module authored in four-channel mode does
 * not load however many tracks it has.
 */
export function mmdMixType(data: Uint8Array): 0 | 1 | 2 {
  if (data.length < 0x40) return 0
  const song = rd32(data, 8)
  if (song === 0 || song + MMD_TEMPO2_AT >= data.length) return 0
  if (((data[song + MMD_FLAGS2_AT] ?? 0) & MMD_FLAG2_MIX) !== 0) return 2
  if (((data[song + MMD_FLAGS_AT] ?? 0) & MMD_FLAG_8CHANNEL) !== 0) return 1
  return 0
}
/** `cmp.w $28(a0),d4` at $210ede: 32 of name and eight reserved */
export const MMD2_PLAYSEQ_HEADER = 0x2a
export const MMD2_PLAYSEQ_LENGTH_AT = 0x28
/** two words and a pointer, then the notes */
export const MMD_BLOCK_HEADER = 8
export const MMD_NOTE_BYTES = 4
/** `$33(a2)` at $215af0, counted down at $215b3c */
export const MMD_EXTRA_SONGS_AT = 0x33

/** one of the 63 eight-byte entries at the top of the song header */
export interface Mmd2Instrument {
  repeat: number
  repeatLength: number
  midiChannel: number
  midiPreset: number
  volume: number
  transpose: number
}

export interface Mmd2Block {
  tracks: number
  /** one more than the word at $2 */
  lines: number
  /** where the notes start in the module */
  at: number
  /** the block info, which the file puts before the block rather than after */
  info: number
}

export interface Mmd2Song {
  id: string
  length: number
  flags: number
  extraSongs: number
  instruments: Mmd2Instrument[]
  blocks: Mmd2Block[]
  /** `$208`, the song's own track count, which a block may disagree with */
  tracks: number
  sections: number
  /** each play sequence, as the block numbers it names */
  playSeqs: number[][]
  /** the names at the head of each play sequence, as the author left them */
  playSeqNames: string[]
  /** `$200`: which play sequence each section runs */
  sectionTable: number[]
  /** `$2fc`, `$2ff`, `$300` and `$301`: the tail every MMD song shares */
  defTempo: number
  playTransp: number
  songFlags: number
  flags2: number
  tempo2: number
  /** the mixing-mode tail, which is meaningless unless `mixType` is 2 */
  mixType: 0 | 1 | 2
  flags3: number
  volAdj: number
  /** `$216`, and FOUR when the field is zero, the way $213672 reads it */
  channels: number
  echoType: number
  echoDepth: number
  echoLength: number
  stereoSeparation: number
  /** the whole module, because the replay reads it in place */
  data: Uint8Array
}

const rd16 = (d: Uint8Array, a: number): number => ((d[a] ?? 0) << 8) | (d[a + 1] ?? 0)
const rd32 = (d: Uint8Array, a: number): number =>
  (((d[a] ?? 0) << 24) | ((d[a + 1] ?? 0) << 16) | ((d[a + 2] ?? 0) << 8) | (d[a + 3] ?? 0)) >>> 0
const s8 = (v: number): number => (v << 24) >> 24

const name32 = (d: Uint8Array, at: number): string => {
  let s = ''
  for (let i = at; i < Math.min(at + 32, d.length); i++) {
    const c = d[i]!
    if (c === 0) break
    s += String.fromCharCode(c)
  }
  return s
}

/**
 * An MMD2 module as it sits in a bank, with every stored offset left alone.
 *
 * The library relocates in place by adding the load address; a bank here is
 * already based at zero, so a stored offset IS an index and nothing needs
 * adding. Returns null for anything that is not an MMD2, including the MMD0
 * and MMD1 that `runtime/med.ts` handles.
 */
export function parseMmd2(data: Uint8Array): Mmd2Song | null {
  if (data.length < 0x40) return null
  const id = String.fromCharCode(...data.subarray(0, 4))
  if (id !== MMD2_ID) return null

  const song = rd32(data, 8)
  const blockarr = rd32(data, 0x10)
  if (song === 0 || song + MMD2_TRACKPANS_AT + 4 > data.length) return null

  const instruments: Mmd2Instrument[] = []
  for (let i = 0; i < MMD_INSTRUMENTS; i++) {
    const at = song + i * MMD_INSTRUMENT_BYTES
    instruments.push({
      repeat: rd16(data, at),
      repeatLength: rd16(data, at + 2),
      midiChannel: data[at + 4] ?? 0,
      midiPreset: data[at + 5] ?? 0,
      volume: data[at + 6] ?? 0,
      transpose: s8(data[at + 7] ?? 0),
    })
  }

  const numBlocks = rd16(data, song + MMD2_NUMBLOCKS_AT)
  const blocks: Mmd2Block[] = []
  for (let i = 0; i < numBlocks; i++) {
    const b = rd32(data, blockarr + i * 4)
    if (b === 0 || b + MMD_BLOCK_HEADER > data.length) continue
    blocks.push({
      tracks: rd16(data, b),
      // the word at $2 is the LAST line, so a 64-line block stores 63
      lines: rd16(data, b + 2) + 1,
      at: b + MMD_BLOCK_HEADER,
      info: rd32(data, b + 4),
    })
  }

  const pseqTable = rd32(data, song + MMD2_PLAYSEQTABLE_AT)
  const numPseqs = rd16(data, song + MMD2_NUMPSEQS_AT)
  const playSeqs: number[][] = []
  const playSeqNames: string[] = []
  for (let i = 0; i < numPseqs; i++) {
    const p = rd32(data, pseqTable + i * 4)
    if (p === 0 || p + MMD2_PLAYSEQ_HEADER > data.length) {
      playSeqs.push([])
      playSeqNames.push('')
      continue
    }
    const n = rd16(data, p + MMD2_PLAYSEQ_LENGTH_AT)
    playSeqNames.push(name32(data, p))
    playSeqs.push([...Array(n)].map((_, k) => rd16(data, p + MMD2_PLAYSEQ_HEADER + k * 2)))
  }

  const sections = rd16(data, song + MMD2_SECTIONS_AT)
  const sectionTable = rd32(data, song + MMD2_SECTIONTABLE_AT)
  return {
    id,
    length: rd32(data, 4),
    flags: data[0x14] ?? 0,
    extraSongs: data[MMD_EXTRA_SONGS_AT] ?? 0,
    instruments,
    blocks,
    tracks: rd16(data, song + MMD2_NUMTRACKS_AT),
    sections,
    playSeqs,
    playSeqNames,
    sectionTable: [...Array(sections)].map((_, i) => rd16(data, sectionTable + i * 2)),
    defTempo: rd16(data, song + MMD_DEFTEMPO_AT),
    playTransp: s8(data[song + MMD_PLAYTRANSP_AT] ?? 0),
    songFlags: data[song + MMD_FLAGS_AT] ?? 0,
    flags2: data[song + MMD_FLAGS2_AT] ?? 0,
    tempo2: data[song + MMD_TEMPO2_AT] ?? 0,
    mixType: mmdMixType(data),
    flags3: rd32(data, song + MMD2_FLAGS3_AT),
    volAdj: rd16(data, song + MMD2_VOLADJ_AT),
    channels: rd16(data, song + MMD2_CHANNELS_AT) || 4,
    echoType: data[song + MMD2_ECHOTYPE_AT] ?? 0,
    echoDepth: data[song + MMD2_ECHODEPTH_AT] ?? 0,
    echoLength: rd16(data, song + MMD2_ECHOLEN_AT),
    stereoSeparation: s8(data[song + MMD2_STEREOSEP_AT] ?? 0),
    data,
  }
}

/** one note of one block: `tracks * 4` bytes a line, across then down */
export function mmd2NoteAt(song: Mmd2Song, block: Mmd2Block, line: number, track: number): Uint8Array {
  const at = block.at + (line * block.tracks + track) * MMD_NOTE_BYTES
  return song.data.subarray(at, at + MMD_NOTE_BYTES)
}
