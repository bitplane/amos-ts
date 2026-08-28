/**
 * The PSID file, off `playsid.library`'s own `CheckModule` and `SetModule`.
 *
 * A PSID is a 124-byte header in front of a lump of C64 machine code. It
 * carries no music: `init` and `play` are 6502 addresses, and everything
 * audible happens because that code writes the SID's registers. `mos6502.ts`
 * runs it and `playsid.ts` wires it to a chip.
 *
 * ## Evidence
 *
 * The layout is `SIDHeader` in
 * `fixtures/aminet/PlaySID3/PlaySID3.0/include/libraries/playsidbase.h`, and
 * every offset below is confirmed against the code that reads it, which is
 * `SetModule` at $210318 in `playsid.library` 1.1:
 *
 *     $00  long   'PSID'                    `cmpi.l #$50534944,(a1)` $210318
 *     $04  word   version                   `cmpi.w #$2,$4(a0)`      $210356
 *     $06  word   data offset               `move.w $6(a1),d1`       $210320
 *     $08  word   load address              `move.w $8(a0),$3c(a6)`  $210330
 *     $0a  word   init address              `move.w $a(a0),$3e(a6)`  $210336
 *     $0c  word   play address              `move.w $c(a0),$40(a6)`  $21033c
 *     $0e  word   songs                     `move.w $e(a0),$42(a6)`  $210342
 *     $10  word   default song              `move.w $10(a0),$44(a6)` $210348
 *     $12  long   speed, one bit per song   `move.l $12(a0),$46(a6)` $21034e
 *     $16  32     name
 *     $36  32     author
 *     $56  32     copyright
 *     $76  word   flags, VERSION 2 ONLY     `move.w $76(a0),d0`      $21035e
 *     $78  long   reserved
 *
 * `$21035c` is the branch that makes the last two conditional: version 1 is
 * read as flags zero and never touches $76 at all.
 */

/** `cmpi.l #$50534944` at $2102f6 and again at $210318. */
export const PSID_MAGIC = 0x50534944

/** The whole header, and the largest data offset `CheckModule` accepts. */
export const PSID_HEADER_SIZE = 0x7c

/** `SIDF_SIDSONG`, playsidbase.h. Bit 0 of the version 2 flags word. */
export const SIDF_SIDSONG = 1 << 0

/**
 * `SID_BADHEADER`, playsidbase.h, and the `moveq #$f7,d0` at $210314 that
 * `CheckModule` returns when any of its three tests fails.
 */
export const SID_BADHEADER = -9

export interface PsidHeader {
  version: number
  /** Where the C64 data starts, which is also the header's own length. */
  dataOffset: number
  /** Zero means "the first two bytes of the data say", `$2107a0`. */
  loadAddress: number
  /** Zero means "the load address", `$2107c0`. */
  initAddress: number
  /** Zero means the tune drives itself off an interrupt it installs. */
  playAddress: number
  songs: number
  /** One-based, the way `StartSong` takes its argument. */
  defaultSong: number
  /** Bit n set means song n runs off a CIA timer rather than the raster. */
  speed: number
  name: string
  author: string
  copyright: string
  flags: number
}

/** 32 bytes of ISO-8859-1, cut at the first NUL and trimmed. */
function text(b: Uint8Array, at: number): string {
  let end = at
  while (end < at + 32 && b[end] !== 0) end++
  let s = ''
  for (let i = at; i < end; i++) s += String.fromCharCode(b[i]!)
  return s.trim()
}

function be16(b: Uint8Array, at: number): number {
  return ((b[at]! << 8) | b[at + 1]!) >>> 0
}

function be32(b: Uint8Array, at: number): number {
  return ((b[at]! << 24) | (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!) >>> 0
}

/**
 * `CheckModule`, LVO -48 at $2102f2, in the order the library tests.
 *
 * Three tests and no more. It never looks at the data, at the load address or
 * at the song count, so a header claiming forty songs over an empty file
 * passes here and fails later in `StartSong` with `SID_NOSONG`.
 */
export function checkPsid(data: Uint8Array | null | undefined): boolean {
  // `move.l a0,d0 / beq` at $2102f2: a null pointer is a bad header, not a crash.
  if (!data || data.length < 8) return false
  // `cmpi.l #$50534944,(a0)` at $2102f6.
  if (be32(data, 0) !== PSID_MAGIC) return false
  // `cmp.w #$7c,d0 / bhi` at $210302: the data may not start past the header.
  if (be16(data, 6) > PSID_HEADER_SIZE) return false
  // `cmpi.w #$2,$4(a0) / bhi` at $210308.
  if (be16(data, 4) > 2) return false
  return true
}

/**
 * The header, or null when `checkPsid` would have refused it.
 *
 * Everything is big-endian: the file is an Amiga format that happens to carry
 * 6502 code, and only the load address hidden in the data itself (`$2107aa`,
 * a `movep.w`) is little-endian.
 */
export function parsePsid(data: Uint8Array | null | undefined): PsidHeader | null {
  if (!checkPsid(data) || !data) return null
  const version = be16(data, 4)
  return {
    version,
    dataOffset: be16(data, 6),
    loadAddress: be16(data, 8),
    initAddress: be16(data, 0x0a),
    playAddress: be16(data, 0x0c),
    songs: be16(data, 0x0e),
    defaultSong: be16(data, 0x10),
    speed: be32(data, 0x12),
    name: text(data, 0x16),
    author: text(data, 0x36),
    copyright: text(data, 0x56),
    // $21035c: version 1 never reads $76, so its flags are zero by definition.
    flags: version >= 2 && data.length >= 0x78 ? be16(data, 0x76) : 0,
  }
}

/**
 * Is song `index` (0-based) driven by a CIA timer rather than the raster?
 *
 * `$2103d2`: `move.w $4c(a6),d0 / move.l $46(a6),d1 / btst.l d0,d1`. A `btst`
 * on a data register is modulo 32, so song 32 shares song 0's bit. That is
 * the 68000's rule showing through rather than a decision, and a file with
 * more than 32 songs is relying on it either way.
 */
export function psidSongUsesCia(header: PsidHeader, index: number): boolean {
  return (header.speed & (1 << (index & 31))) !== 0
}
