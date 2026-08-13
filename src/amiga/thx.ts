/**
 * The THX module format — Abyss's synth tracker, read off its own replayer.
 *
 * THX is not a sampler. A module carries no PCM at all: every instrument is a
 * waveform number, an envelope and a playlist of per-frame commands, and the
 * replayer builds the sound as it goes. That is why a 3,312-byte file is a
 * whole tune, and why this parser stops where it does. The structure is here;
 * the synthesis is not.
 *
 * ## Evidence
 *
 * DISASSEMBLY tier, from `InitModule` at $4c6 of `AMOSPRO_THX.lib`'s 4,792-byte
 * code hunk. That routine walks the file field by field and stores each one
 * into the player's state block, so it states the layout outright rather than
 * leaving it to be inferred: `move.b (a0)+,$17d(a6)` IS the track length, and
 * `lsl.w #$3,d3` before skipping the position table IS eight bytes a position.
 * Every offset below is one of its instructions.
 *
 * The step packing comes from the tick at $666 and its row handler at $760,
 * which is the only code that reads a track byte. The instrument fields come
 * from the note-on path at $8a4, which copies the 22-byte header into the
 * channel one field at a time.
 *
 * There is no THX replayer source anywhere. The extension's author asked for
 * one and did not get it, which is why he disassembled the binary himself:
 * *"(Hey Martin, what about to distribute a source code of the replayer
 * routine, instead of a binary?)"*, `THXLib.guide`, THX-ErrorMSGs.
 *
 * ## The header
 *
 *     +0   'THX'
 *     +3   version
 *     +4   word   offset to the name block
 *     +6   word   bit 15 set = track 0 is NOT stored; bits 0-14 = song length
 *     +8   word   restart position
 *     +10  byte   track length, in rows
 *     +11  byte   the HIGHEST track number, so there are that many plus one
 *     +12  byte   instrument count
 *     +13  byte   subsong count
 *
 * then, in order and with no padding between them: the subsong table, one word
 * each; the position table, `songLength` entries of four channels of (track
 * byte, signed transpose byte); the tracks, three bytes a row; the instruments,
 * 22 bytes each plus a playlist; the names.
 *
 * `+4` is the one field the replayer does not use — `addq.w #$2,a0` at $4e0
 * steps straight over it. That makes it an independent check on everything
 * else rather than an input, and it is the check `thx.corpus.test.ts` runs:
 * walking all five variable-length sections has to land exactly on it.
 *
 * ## Track 0
 *
 * When bit 15 of `+6` is set, track 0 is not in the file and the stored array
 * begins at track 1. The replayer handles it in three instructions at $776:
 *
 *     tst.b   $7(a6)          the flag InitModule set from bit 15
 *     beq.b   $784            stored --- index it directly
 *     subq.w  #$1,d0          not stored --- shift down by one
 *     bge.b   $784
 *     moveq   #$0,d1          track 0 itself: an EMPTY step, every row
 *
 * so track 0 is silence rather than an error. `tracks` below is indexed by
 * ABSOLUTE track number either way, with an all-empty track 0 synthesised when
 * the file omits it. All nine modules in the corpus omit it, so the stored
 * case is read off the routine and has nothing to check it.
 *
 * ## The version byte is a trap, and the two extensions fall differently
 *
 * `cmpi.l #$54485800,(a0)+` at $4d2 compares four bytes: "THX" AND a version
 * of ZERO. THX 0.6 therefore rejects any module whose fourth byte is not 0.
 * Jotre accepts every version, but only by accident — its InitModule stashes
 * the byte and then CLEARS it in the caller's memory before the same compare
 * (../runtime/jotre.ts).
 *
 * So this parser reads the version and rejects nothing on it. The acceptance
 * rule belongs to whichever extension is driving, and the two do not agree.
 */

/** one cell of a track, three bytes in the file */
export interface ThxStep {
  /**
   * bits 15..10 of the first word, so `byte0 >> 2`. 0 is no note.
   *
   * `rol.w #$6,d1 / andi.w #$3f,d1` at $9f2 — six bits, and the replayer
   * indexes its period table with the result.
   */
  note: number
  /**
   * bits 9..4, so `((byte0 & 3) << 4) | (byte1 >> 4)`. 0 is none, and any
   * other value is ONE-BASED: `andi.w #$3f0,d3 / lsr.w #$4,d3 / subq.w #$1,d3
   * / bmi` at $884 subtracts one before indexing the instrument array.
   */
  instrument: number
  /** bits 3..0 — `move.w d1,d2 / andi.w #$f,d2` at $79c */
  command: number
  /** the third byte, the command's argument */
  data: number
}

/** one channel of one position */
export interface ThxPosition {
  /** the track number, absolute — see the note about track 0 above */
  track: number
  /** SIGNED: `move.b $1(a0),d2 / ext.w d2` at $da0 */
  transpose: number
}

/**
 * The seven envelope bytes, +2 to +8 of the instrument header.
 *
 * Read off the note-on path at $8b4-$908, which turns each pair into a
 * per-frame ramp: `(attackVolume << 8) / attackFrames`, then
 * `((decayVolume - attackVolume) << 8) / decayFrames`, then
 * `((releaseVolume - decayVolume) << 8) / releaseFrames`.
 *
 * Sustain has a frame count and NO level of its own — the arithmetic above
 * runs the release ramp from `decayVolume`, so sustain holds whatever decay
 * finished on. That is why there are seven bytes and not eight.
 */
export interface ThxEnvelope {
  attackFrames: number
  attackVolume: number
  decayFrames: number
  decayVolume: number
  sustainFrames: number
  releaseFrames: number
  releaseVolume: number
}

export interface ThxInstrument {
  /** from the name block; empty when the file stores an empty string */
  name: string
  /**
   * the 22 header bytes, verbatim.
   *
   * The named fields below are the ones the note-on path settles. The rest is
   * synthesis — filter sweeps, the square-wave modulation, the hard-cut flags
   * — and naming them wants the engine, not this file. They are reached at
   * $918 (+0), $922 (+$d), $928 (+$e), $92e (+$f), $948 (+$10), $94e (+$11)
   * and $966 (+$14), which is where that work starts.
   */
  header: Uint8Array
  /**
   * `header[1] & 7` — `move.b $1(a3),d1 / andi.b #$7,d1` at $90c.
   *
   * A shift count, not a length: the replayer scales two of the header bytes
   * by `lsr.b #(5 - waveLength)` at $944-$952 before using them.
   */
  waveLength: number
  envelope: ThxEnvelope
  /**
   * the playlist, four bytes an entry, verbatim.
   *
   * `header[21]` is the entry count — `move.b $15(a0),d3 / adda.w #$16,a0 /
   * lsl.w #$2,d3` at $554 is how InitModule strides past one instrument, and
   * it is the only thing that makes the file walkable at all.
   */
  playlist: Uint8Array
}

export interface ThxModule {
  /** the byte at +3, whatever it is; see the header note */
  version: number
  /** the first string of the name block */
  name: string
  /** positions in the song, bits 0-14 of +6 */
  songLength: number
  /** +8, the position the song loops to when it runs off the end */
  restart: number
  /** +10, rows in every track */
  trackLength: number
  /** false when bit 15 of +6 is set and the file omits track 0 */
  trackZeroStored: boolean
  /** +14, one word each; a subsong is a starting position */
  subSongs: number[]
  /** `[position][channel]`, always four channels */
  positions: ThxPosition[][]
  /** indexed by ABSOLUTE track number, `trackLength` steps each */
  tracks: ThxStep[][]
  instruments: ThxInstrument[]
  /** +4, which the replayer ignores and this parser checks itself against */
  nameOffset: number
}

const rdW = (b: Uint8Array, at: number): number => ((b[at] ?? 0) << 8) | (b[at + 1] ?? 0)

/** the four bytes `cmpi.l #$54485800,(a0)+` at $4d2 tests, minus the version */
export const isThxModule = (b: Uint8Array): boolean => b.length >= 4 && b[0] === 0x54 && b[1] === 0x48 && b[2] === 0x58

/** an empty step, the `moveq #$0,d1` at $780 that an absent track 0 plays */
const emptyStep = (): ThxStep => ({ note: 0, instrument: 0, command: 0, data: 0 })

/**
 * The name block: `instrumentCount + 1` NUL-terminated strings, the song's
 * first and then one an instrument.
 *
 * Nothing in the replayer reads this — it is the editor's, which is why the
 * count is stated as a rule here rather than cited. All nine corpus modules
 * hold exactly that many and end on the last one, and `thx.corpus.test.ts`
 * is where that is checked.
 */
function readNames(b: Uint8Array, at: number, count: number): string[] {
  const out: string[] = []
  let p = at
  for (let i = 0; i < count; i++) {
    let e = p
    while (e < b.length && b[e] !== 0) e++
    out.push(String.fromCharCode(...b.subarray(p, e)))
    p = e + 1
  }
  return out
}

/**
 * Parse a module, the way `InitModule` at $4c6 walks one.
 *
 * Throws when the magic is wrong or the file runs out under a section, which
 * is more than the replayer does: it checks the magic and NOTHING else, so a
 * short module walks straight off the end of the bank. The extension does not
 * help either — its own Guide says *"There is also no routine to check, if the
 * bank you access contains a THX module"*. Being stricter here is deliberate.
 * A caller that wants the crash can have it; a parser that returns nonsense
 * cannot be told apart from one that is wrong.
 */
export function thxParse(bytes: Uint8Array): ThxModule {
  if (!isThxModule(bytes)) throw new Error('not a THX module')
  const need = (at: number, n: number, what: string): void => {
    if (at + n > bytes.length) throw new Error(`THX module is short: ${what} runs past the end`)
  }

  const version = bytes[3]!
  const nameOffset = rdW(bytes, 4)
  const flags = rdW(bytes, 6)
  const trackZeroStored = (flags & 0x8000) === 0
  const songLength = flags & 0x7fff
  const restart = rdW(bytes, 8)
  const trackLength = bytes[10]!
  // +11 is the highest track NUMBER; tracks 0..that exist
  const highestTrack = bytes[11]!
  const instrumentCount = bytes[12]!
  const subSongCount = bytes[13]!

  let p = 14
  need(p, subSongCount * 2, 'the subsong table')
  const subSongs: number[] = []
  for (let i = 0; i < subSongCount; i++) subSongs.push(rdW(bytes, p + i * 2))
  p += subSongCount * 2

  // `lsl.w #$3,d3` at $524 --- eight bytes a position, four channels of two
  need(p, songLength * 8, 'the position table')
  const positions: ThxPosition[][] = []
  for (let i = 0; i < songLength; i++) {
    const row: ThxPosition[] = []
    for (let c = 0; c < 4; c++) {
      const at = p + i * 8 + c * 2
      row.push({ track: bytes[at]!, transpose: (bytes[at + 1]! << 24) >> 24 })
    }
    positions.push(row)
  }
  p += songLength * 8

  // `mulu.w #$3,d3 / mulu.w d7,d3` at $53c --- three bytes a row, and d7 is
  // the stored count rather than the highest number
  const storedTracks = highestTrack + (trackZeroStored ? 1 : 0)
  need(p, storedTracks * trackLength * 3, 'the tracks')
  const stored: ThxStep[][] = []
  for (let t = 0; t < storedTracks; t++) {
    const rows: ThxStep[] = []
    for (let r = 0; r < trackLength; r++) {
      const at = p + (t * trackLength + r) * 3
      const word = rdW(bytes, at)
      rows.push({
        note: (word >> 10) & 0x3f,
        instrument: (word >> 4) & 0x3f,
        command: word & 0xf,
        data: bytes[at + 2]!,
      })
    }
    stored.push(rows)
  }
  p += storedTracks * trackLength * 3
  // indexed absolutely: an omitted track 0 becomes the empty one $780 plays
  const tracks = trackZeroStored ? stored : [Array.from({ length: trackLength }, emptyStep), ...stored]

  // 22 bytes and a playlist each, the stride at $554
  const headers: Uint8Array[] = []
  const playlists: Uint8Array[] = []
  for (let i = 0; i < instrumentCount; i++) {
    need(p, 22, `instrument ${i + 1}`)
    const entries = bytes[p + 21]!
    need(p + 22, entries * 4, `instrument ${i + 1}'s playlist`)
    // copied rather than viewed: a module lives in an AMOS bank and Jotre's
    // InitModule writes into one --- `clr.b $3(a0)` over the version byte
    headers.push(bytes.slice(p, p + 22))
    playlists.push(bytes.slice(p + 22, p + 22 + entries * 4))
    p += 22 + entries * 4
  }

  const names = readNames(bytes, nameOffset, instrumentCount + 1)
  const instruments = headers.map((header, i) => ({
    name: names[i + 1] ?? '',
    header,
    waveLength: header[1]! & 7,
    envelope: {
      attackFrames: header[2]!,
      attackVolume: header[3]!,
      decayFrames: header[4]!,
      decayVolume: header[5]!,
      sustainFrames: header[6]!,
      releaseFrames: header[7]!,
      releaseVolume: header[8]!,
    },
    playlist: playlists[i]!,
  }))

  return {
    version,
    name: names[0] ?? '',
    songLength,
    restart,
    trackLength,
    trackZeroStored,
    subSongs,
    positions,
    tracks,
    instruments,
    nameOffset,
  }
}

/**
 * Where the instrument list ends, which is where the names should begin.
 *
 * Separate from `thxParse` because it is the one number that can disagree with
 * the file: the replayer never reads `+4`, so a walk that lands anywhere else
 * means the reading above is wrong. Handed back rather than asserted, because
 * a module built by something other than the THX editor is entitled to differ
 * and this port has no business refusing it.
 */
export function thxWalkEnd(bytes: Uint8Array): number {
  const flags = rdW(bytes, 6)
  const songLength = flags & 0x7fff
  const storedTracks = (bytes[11] ?? 0) + ((flags & 0x8000) === 0 ? 1 : 0)
  let p = 14 + (bytes[13] ?? 0) * 2 + songLength * 8 + storedTracks * (bytes[10] ?? 0) * 3
  for (let i = 0; i < (bytes[12] ?? 0); i++) p += 22 + (bytes[p + 21] ?? 0) * 4
  return p
}

/**
 * The subsong's starting position, as `StartSong` at $570 resolves one.
 *
 *     btst.b  #$f,d0          bit 15: d0 IS a position, use it as it stands
 *     bne     ...
 *     tst.w   d0
 *     beq     ...             0: position 0, whatever the table says
 *     movea.l $320(a6),a3
 *     subq.w  #$1,d0
 *     move.w  (a3,d0.w*2),d0  otherwise ONE-BASED into the subsong table
 *
 * so `Thx Play bank,0` and `Play Thx addr,0` both start at position 0 and
 * never touch the table, and subsong 1 is its first entry. Out of range is
 * not checked by the replayer and is not checked here.
 */
export function thxSubSongPosition(m: ThxModule, subSong: number): number {
  if (subSong & 0x8000) return subSong & 0x7fff
  if (subSong === 0) return 0
  return m.subSongs[subSong - 1] ?? 0
}
