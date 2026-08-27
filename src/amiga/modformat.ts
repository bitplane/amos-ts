/**
 * Which replayer reads this file, from the bytes at the front of it.
 *
 * The fourth identification question, beside the three `./xadmaster.ts` names
 * in its own header: `./datatypes.ts` says what a file IS, `./xfdmaster.ts`
 * whether it is PACKED, `./xadmaster.ts` whether it HOLDS other files, and
 * this says which of the eleven replayers in this directory can play it.
 *
 * It is here rather than beside a caller because the replayers are here.
 * `./protracker.ts`, `./thx.ts`, `./tfmx.ts` and the rest are the things
 * being chosen between, and a chooser that lived above them would be a second
 * place the format list has to be kept right.
 *
 * Every magic below is the one the Amiga replayer itself tests, not a
 * signature table copied from a file identifier. SoundFX is the clearest
 * case: its tag sits at 60, behind the fifteen sample lengths, and it is the
 * only thing `DME_SoundFX1.3.library` looks at before playing.
 *
 * ## What it does NOT answer
 *
 * Which EXTENSION plays it. Twelve extensions in the registry offer a play
 * keyword and a plain ProTracker module is claimed by six of them, so that is
 * a caller's choice out of several right answers and not a fact about the
 * bytes. See `../runtime/` for the keyword side.
 */

/**
 * The formats this port's replayers read.
 *
 * `med` and `omed` are one file format family split by which replayer takes
 * it, because that is the split the two Amiga libraries make and the tag is
 * what makes it: medplayer reads the MMD0-shaped playseq at song+$1fc and the
 * track volumes at $302, and an MMD2 has a section table in the first and
 * nothing in the second.
 */
export type ModFormat =
  | 'mod' | 'p61' | 'thx' | 'med' | 'omed' | 'sfx' | 'fc14' | 'fc13' | 'digi' | 'smon' | 's3m'

/** what a format is called where a person reads it */
export const MOD_FORMAT_NAMES: Readonly<Record<ModFormat, string>> = {
  mod: 'ProTracker',
  p61: 'The Player 6.1',
  thx: 'THX',
  med: 'MED',
  omed: 'OctaMED',
  sfx: 'SoundFX 1.3',
  fc14: 'FutureComposer 1.4',
  fc13: 'FutureComposer 1.3',
  digi: 'DigiBooster',
  smon: 'BP SoundMon 2.0',
  s3m: 'ScreamTracker 3',
}

/**
 * What the first bytes say it is.
 *
 * MOD is last because it is the one with no magic at the front: the four-byte
 * tag sits at 1080, after 31 sample headers and the pattern order, and a
 * 15-sample module has no tag at all. `parseMod` decides that part.
 */
export function detectModule(d: Uint8Array): ModFormat | null {
  const tag = (at: number, n = 4): string => String.fromCharCode(...d.subarray(at, at + n))
  // MMD2 and MMD3 go to octaplayer, not medplayer: medplayer reads the
  // MMD0-shaped playseq at song+$1fc and the track volumes at $302, and an
  // MMD2 has a section table in the first and nothing in the second
  if (tag(0) === 'MMD2' || tag(0) === 'MMD3') return 'omed'
  if (tag(0) === 'MMD0' || tag(0) === 'MMD1') return 'med'
  if (tag(0, 3) === 'THX' || tag(0, 3) === 'HVL') return 'thx'
  if (tag(0) === 'P61A') return 'p61'
  if (tag(0) === 'FC14') return 'fc14'
  if (tag(0) === 'SMOD') return 'fc13'
  if (tag(0) === 'DIGI') return 'digi'
  if (d.length > 0x200 && tag(0x1a, 3) === 'V.2') return 'smon'
  if (d.length > 0x60 && tag(0x2c) === 'SCRM') return 's3m'
  // SoundFX 1.3's magic sits at 60, behind the fifteen sample lengths, and is
  // the only thing DME_SoundFX1.3.library checks
  if (d.length > 0x294 && tag(0x3c) === 'SONG') return 'sfx'
  if (d.length > 1084 && ['M.K.', 'M!K!', 'FLT4', '4CHN', 'M&K!'].includes(tag(1080))) return 'mod'
  return null
}
