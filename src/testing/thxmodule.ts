/**
 * The smallest THX module the parser accepts, hand-packed.
 *
 * Both AMOS front ends for the format need one and neither should carry its
 * own copy: the header is fourteen bytes of fixed layout and a second
 * hand-packing of it would drift the moment ../amiga/thx.ts learns something.
 * The real modules live in ../amiga/thx.corpus.test.ts, which is where the
 * parser and the sequencer are judged; this is for the SHIMS, where what is
 * being tested is which error fires and when the play flag moves.
 *
 * One position, one two-row track, one instrument. Bit 15 of +6 is set, so
 * track 0 is not stored and the position's four channels all point at it.
 */
export interface ThxModuleOptions {
  /** +13, and each subsong costs a word in the block that follows the header */
  subSongs?: number
  /**
   * +3. Jotre clears this byte before its `cmpi.l #$54485800,(a0)+` and so
   * accepts every version; thx-0.6 does not clear it and so accepts only zero.
   */
  version?: number
}

export function thxModuleFile({ subSongs = 0, version = 0 }: ThxModuleOptions = {}): Uint8Array {
  const body: number[] = []
  // the subsong table, then the one position's four channel/transpose pairs
  for (let i = 0; i < subSongs; i++) body.push(0, 0)
  body.push(1, 0, 0, 0, 0, 0, 0, 0)
  // the one track: two steps, both empty
  body.push(0, 0, 0, 0, 0, 0)
  // the one instrument: volume $40, wave length 5, a seven-byte envelope, and
  // a playlist length of ZERO in byte 21, so no playlist bytes follow. Both
  // tracks are empty, so no note ever strikes and nothing reads it.
  body.push(0x40, 0x05, 1, 2, 3, 4, 5, 6, 7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)
  const nameOffset = 14 + body.length
  return Uint8Array.from([
    0x54, 0x48, 0x58, version,
    nameOffset >> 8, nameOffset & 0xff,
    0x80, 1,
    0, 0,
    2, 1, 1, subSongs,
    ...body,
    0, 0,
  ])
}
