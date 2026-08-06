/**
 * The note tables every Amiga replayer shipped.
 *
 * Three things live here and all three were written out more than once in this
 * port before it existed, because four replayers wanted them and none of them
 * could reach the others:
 *
 *   - the finetuned period table, 16 rows of 37 words. `paula.ts` held row 0
 *     under the name `AMIGA_PERIODS` and `protracker.ts` held all sixteen; the
 *     two agreed only because a test said so.
 *   - the 32-point vibrato sine, which had THREE copies — `protracker.ts` in
 *     decimal, `music.ts` in hex, `med.ts` in decimal and uncited.
 *   - the finetune stride, which is the reason the period table's rows are 37
 *     words and not 36.
 *
 * This is a leaf: it imports nothing, so `paula.ts` can derive its own table
 * from it without the cycle that importing the replay would make.
 *
 * ## Evidence
 *
 * Player 6.1A `incbin`s both tables — `data/p61a.periods` and
 * `data/p61a.vibtab` — and the AMOS distribution does not include the data
 * directory, so neither is in the source at all. Both were read out of the
 * assembled `AMOSPro_P61.Lib` instead: the periods at file offset `$aa8` and
 * the vibrato table at `$17a6`. `protracker.test.ts` re-extracts both from the
 * library and compares, so the transcription cannot rot.
 *
 * AMOS's own Music extension corroborates the untuned row and the sine
 * independently: `+Music.s:2146` is `Sinus`, the same thirty-two bytes, and
 * `Periods` immediately below it is the same thirty-six words with two
 * trailing zeros that `music.ts` still adds back for its arpeggio lookup.
 */

/** the table as the replayer indexes it: `fine * 37 + note`, note 1..36 */
export const PT_PERIODS_PER_ROW = 37

const PERIOD_ROWS: readonly (readonly number[])[] = [
  [856, 808, 762, 720, 678, 640, 604, 570, 538, 508, 480, 453, 428, 404, 381, 360, 339, 320, 302, 285, 269, 254, 240, 226, 214, 202, 190, 180, 170, 160, 151, 143, 135, 127, 120, 113],
  [850, 802, 757, 715, 674, 637, 601, 567, 535, 505, 477, 450, 425, 401, 379, 357, 337, 318, 300, 284, 268, 253, 239, 225, 213, 201, 189, 179, 169, 159, 150, 142, 134, 126, 119, 113],
  [844, 796, 752, 709, 670, 632, 597, 563, 532, 502, 474, 447, 422, 398, 376, 355, 335, 316, 298, 282, 266, 251, 237, 224, 211, 199, 188, 177, 167, 158, 149, 141, 133, 125, 118, 112],
  [838, 791, 746, 704, 665, 628, 592, 559, 528, 498, 470, 444, 419, 395, 373, 352, 332, 314, 296, 280, 264, 249, 235, 222, 209, 198, 187, 176, 166, 157, 148, 140, 132, 125, 118, 111],
  [832, 785, 741, 699, 660, 623, 588, 555, 524, 495, 467, 441, 416, 392, 370, 350, 330, 312, 294, 278, 262, 247, 233, 220, 208, 196, 185, 175, 165, 156, 147, 139, 131, 124, 117, 110],
  [826, 779, 736, 694, 655, 619, 584, 551, 520, 491, 463, 437, 413, 390, 368, 347, 328, 309, 292, 276, 260, 245, 232, 219, 206, 195, 184, 174, 164, 155, 146, 138, 130, 123, 116, 109],
  [820, 774, 730, 689, 651, 614, 580, 547, 516, 487, 460, 434, 410, 387, 365, 345, 325, 307, 290, 274, 258, 244, 230, 217, 205, 193, 183, 172, 163, 154, 145, 137, 129, 122, 115, 109],
  [814, 768, 725, 684, 646, 610, 575, 543, 513, 484, 457, 431, 407, 384, 363, 342, 323, 305, 288, 272, 256, 242, 228, 216, 204, 192, 181, 171, 161, 152, 144, 136, 128, 121, 114, 108],
  [907, 856, 808, 762, 720, 678, 640, 604, 570, 538, 508, 480, 453, 428, 404, 381, 360, 339, 320, 302, 285, 269, 254, 240, 226, 214, 202, 190, 180, 170, 160, 151, 143, 135, 127, 120],
  [900, 850, 802, 757, 715, 675, 636, 601, 567, 535, 505, 477, 450, 425, 401, 379, 357, 337, 318, 300, 284, 268, 253, 238, 225, 212, 200, 189, 179, 169, 159, 150, 142, 134, 126, 119],
  [894, 844, 796, 752, 709, 670, 632, 597, 563, 532, 502, 474, 447, 422, 398, 376, 355, 335, 316, 298, 282, 266, 251, 237, 223, 211, 199, 188, 177, 167, 158, 149, 141, 133, 125, 118],
  [887, 838, 791, 746, 704, 665, 628, 592, 559, 528, 498, 470, 444, 419, 395, 373, 352, 332, 314, 296, 280, 264, 249, 235, 222, 209, 198, 187, 176, 166, 157, 148, 140, 132, 125, 118],
  [881, 832, 785, 741, 699, 660, 623, 588, 555, 524, 494, 467, 441, 416, 392, 370, 350, 330, 312, 294, 278, 262, 247, 233, 220, 208, 196, 185, 175, 165, 156, 147, 139, 131, 123, 117],
  [875, 826, 779, 736, 694, 655, 619, 584, 551, 520, 491, 463, 437, 413, 390, 368, 347, 328, 309, 292, 276, 260, 245, 232, 219, 206, 195, 184, 174, 164, 155, 146, 138, 130, 123, 116],
  [868, 820, 774, 730, 689, 651, 614, 580, 547, 516, 487, 460, 434, 410, 387, 365, 345, 325, 307, 290, 274, 258, 244, 230, 217, 205, 193, 183, 172, 163, 154, 145, 137, 129, 122, 115],
  [862, 814, 768, 725, 684, 646, 610, 575, 543, 513, 484, 457, 431, 407, 384, 363, 342, 323, 305, 288, 272, 256, 242, 228, 216, 203, 192, 181, 171, 161, 152, 144, 136, 128, 121, 114],
]

/**
 * The finetuned period table: sixteen rows of thirty-seven words, at `$aa8`.
 *
 * Rows 0 to 7 are finetune 0 to +7 and rows 8 to 15 are -8 to -1, which is the
 * order the finetune nibble already has — `E5x` and a MOD sample header both
 * store the value as a four-bit two's-complement number, so the nibble indexes
 * this straight without a sign fixup.
 *
 * The thirty-seventh word is why this is flat rather than a 16x36 array.
 * Entry 0 of each row DUPLICATES entry 1 (856, 856, 808, ... and 850, 850,
 * 802, ...), and both the arpeggio and the note lookup index it as one long
 * table, so a note near the top of the range plus an arpeggio offset reads
 * into the NEXT finetune row rather than off the end. That overflow is
 * audible — an arpeggio on B-3 detunes instead of transposing — and keeping
 * the shape means it happens here for the same reason it happens there.
 *
 * `AMIGA_PERIODS` in `paula.ts` is now row 0 without its duplicate, taken from
 * this table rather than written out again beside it.
 */
export const PT_PERIODS: Int16Array = ((): Int16Array => {
  const t = new Int16Array(16 * PT_PERIODS_PER_ROW)
  for (let r = 0; r < 16; r++) {
    const row = PERIOD_ROWS[r]!
    t[r * PT_PERIODS_PER_ROW] = row[0]! // the duplicate entry 0
    for (let n = 0; n < 36; n++) t[r * PT_PERIODS_PER_ROW + 1 + n] = row[n]!
  }
  return t
})()

/**
 * ProTracker's sine, the 32 points a vibrato or tremolo walks.
 *
 * Player 6.1A never uses this directly. `P61_vibtab` is 16 x 32 BYTES of
 * `(sine * depth) >> 7` precomputed, because a `mulu` per channel per tick was
 * worth avoiding on a 7MHz machine — and this port derives it rather than
 * carrying 512 constants, having first checked the derivation is byte-exact
 * against the table in the shipped library at `$17a6`.
 *
 * AMOS's two vibratos walk the same thirty-two bytes with the same
 * `lsr.w #2 / and.w #$1f` index and then disagree on the depth: `MuVib`
 * (+Music.s:1538) ends `lsr.w #$06,d2` and `mt_vib2` (+Music.s:1924) ends with
 * a seven. The shift belongs to each replayer and stays in `music.ts`; only
 * the table is shared.
 */
export const PT_SINE: readonly number[] = [
  0, 24, 49, 74, 97, 120, 141, 161, 180, 197, 212, 224, 235, 244, 250, 253,
  255, 253, 250, 244, 235, 224, 212, 197, 180, 161, 141, 120, 97, 74, 49, 24,
]

/** `P61_vibtab`: the sine scaled by depth, 16 rows of 32 */
export const PT_VIBRATO: Uint8Array = ((): Uint8Array => {
  const t = new Uint8Array(16 * 32)
  for (let d = 0; d < 16; d++) for (let p = 0; p < 32; p++) t[d * 32 + p] = (PT_SINE[p]! * d) >> 7
  return t
})()

/**
 * `P61_mulutab` — 0, 74, 148, ... 1110, the finetune nibble scaled to a BYTE
 * offset into the period table. 74 bytes is 37 words, which is one row, so
 * the nibble and the row index are the same number and this port stores the
 * row. Kept as a constant because it is the check that the table's stride is
 * 37 and not 36.
 */
export const FINETUNE_STRIDE_BYTES = 74
