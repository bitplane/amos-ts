/**
 * DME 2.0 — Thomas Reetz's "DOOM Music Extension", at slot 15.
 *
 * Fifteen music formats in one extension, 220 named keywords, and by some
 * distance the widest audio surface in the registry. DOOM Productions was the
 * author's demo group; the game has nothing to do with it.
 *
 * ## Which formats are in this binary and which are not
 *
 * Twelve of the fifteen formats are separate Amiga libraries the extension
 * opens by name — each has its own versioned error string in the hunk, from
 * *"Can't load DME_OctaMix.library V2.0 or higher"* down. FOUR ARE INSIDE
 * THESE 46,208 BYTES and have no library name and no load error anywhere:
 * `ptm`, `thx`, `p61` and `dme sam`, which is the guide's own Internal-Player
 * column to the entry.
 *
 * Those four were the first batch, over engines this port already had. Five
 * of the external ones have followed: `sfx13` over ../amiga/soundfx.ts, `fc14`
 * over ../amiga/fc14.ts, `fc13` over ../amiga/fc13.ts and `db` over
 * ../amiga/digiplay.ts, each read out of its own library in `libs/`, and then
 * `dmed` --- which needed no new engine at all, because `DME_Med.library` is
 * medplayer.library behind the same veneer and ../runtime/med.ts was read out
 * of medplayer.library itself for the Music extension. 12, 12, 12, 15 and 12
 * keywords. The other six replayer libraries are #146.
 *
 * ## Evidence
 *
 * DISASSEMBLY tier over `AMOSPro_DOOM_Music.Lib`, with `DME_V2.0.guide`
 * (74,389 bytes) beside it. Every citation is an address in the code hunk,
 * except the `$21xxxx` ones, which belong to whichever replayer library the
 * keyword drives --- `DME_SoundFX1.3.library`, `DME_FC1.4.library` and
 * `DME_FC1.3.library` all relocate to $210000, and their own files say which
 * is which.
 *
 * ## Two things routine 0 says
 *
 * **Slot 15**, from the binary rather than from the 1997 web page that was
 * the row's only source: `move.l d0,$1d8(a5)` for its AllocMem'd block and
 * `moveq #$e,d0` for the return, and ($1d8-$f8)/16+1 is 15 on the ExtAdr
 * layout (+Equ.s:1185).
 *
 * **It refuses to load anywhere else.** The first instruction after the
 * register save is `cmp.l #$41506578,d1` — the ASCII `APex` — and a mismatch
 * takes `suba.l a0,a0 / moveq #$ff,d0 / rts` without allocating anything.
 * Nothing else in the registry checks who is loading it.
 *
 * ## The replayer's variable block
 *
 * `Rbsr routine 299` with `d0 = 4` hands back `a0`, the ProTracker replayer's
 * own variables, and the keywords are almost all one field each:
 *
 *     -$0c  song position          =Ptm Song Pos
 *     -$04  row, in the high nibble    =Ptm Patt Pos, `lsr.w #$4`
 *      $00  the CIA divisor, 125 at Ptm Play (`move.w #$7d,$0(a0)`)
 *      $04  volume, 0..64          Ptm Volume
 *      $06  four voice enables     Ptm Voice
 *      $0a  four vu bytes          =Ptm Vu, read and CLEARED
 *      $0e  the end flag           =Ptm End, read and cleared
 *
 * Routine 299 itself is 4,834 bytes and is the replayer; routines 297 and 298
 * install and remove a CIA-B interrupt around it, picking the clock off
 * GfxBase's DisplayFlags — `$1b0f87` PAL and `$1b4f4d` NTSC, which are the
 * two CIA clocks exactly.
 *
 * ## `Nop` is padding, and it does not work
 *
 * Thirty-seven token rows are called `nop` and they point at THIRTY-SEVEN
 * DIFFERENT routines, 2 through 38 — 74 bytes at $3f04..$3f4e, every one of
 * them a bare `rts`. One spare jump-table slot per format block, so a later
 * version could add a keyword without moving anybody's ids.
 *
 * And it cannot be typed. The spec is `"0"`, an integer RESULT, which makes
 * AMOS parse `Nop` as a function — but the function routine is -1 and the
 * instruction slot the row carries can never be reached, because the spec
 * never lets it parse as a statement. That is `S Mask$`'s shape exactly, and
 * it is n/a for the same reason: there is no behaviour to be faithful to.
 *
 * DEVIATION: this port drives ../amiga/protracker.ts on the frame instead,
 * because there is no CIA interrupt here to hang a replayer off. `Ptm Cia
 * Speed` therefore sets a tempo the engine honours rather than a timer
 * divisor, which is the same thing one layer up.
 */
import type { Func, Instr } from '../interp/builtins'
import type { Runtime } from './runtime'
import { AmosError, funcCall, VI } from '../interp/values'
import { Protracker, parseMod } from '../amiga/protracker'
import { ThxPlayer } from '../amiga/thxplay'
import { thxParse } from '../amiga/thx'
import { parseP61, p61Song } from '../amiga/p61'
import { SFX_LENGTH_AT, SFX_MAGIC, SFX_MAGIC_AT, SoundFx, parseSfx } from '../amiga/soundfx'
import { FC14_MAGIC, FC14_STEP_BYTES, Fc14, parseFc14 } from '../amiga/fc14'
import { FC13_MAGIC, FC13_STEP_BYTES, Fc13, parseFc13 } from '../amiga/fc13'
import { DIGI_MAGIC, parseDigi } from '../amiga/digi'
import { DigiPlayer } from '../amiga/digiplay'
import { VBL_HZ } from '../amiga/paula'
import { MedPlayer } from './med'
import { parseTfmx } from '../amiga/tfmx'
import { TfmxPlayer } from '../amiga/tfmxplay'
import { MMD_EXTRA_SONGS_AT, MMD_PLINE_AT, MMD_PSEQNUM_AT, mmdMixType } from '../amiga/mmd2'
import { OMIX_MAX_BUFFER, OMIX_MAX_CHANNELS, OMIX_MAX_RATE, OMIX_MIN_BUFFER, OMIX_MIN_RATE } from '../amiga/omix'
import { SMON_MAGIC, SMON_MAGIC_AT, parseSmon } from '../amiga/soundmon'
import { SoundMon } from '../amiga/soundmonplay'
import { S3M_MAGIC, S3M_MAGIC_AT, parseS3m } from '../amiga/s3m'
import { S3mPlayer } from '../amiga/s3mplay'
import { PlaySid, PAL_VERT_FREQ } from '../amiga/playsid'
import { PSID_MAGIC } from '../amiga/psid'
import { XM_MAGIC, parseXm } from '../amiga/xm'
import { XmPlayer } from '../amiga/xmplay'

/** the bank `Ptm Load` reserves, and the name `Ptm Play` insists on ($7882) */
export const PTM_BANK_NAME = 'Tracker '
/** `move.w #$7d,$0(a0)` at $78f6 — 125 bpm, whatever the module said */
export const PTM_DEFAULT_BPM = 0x7d
/** `cmpi.l #$80000000,(a3)` at $7900: play the bank `Ptm Load` last used */
export const PTM_CURRENT_BANK = -0x80000000

/**
 * The three tags `Ptm Load` will accept, at offset $438 — and only these
 * three. `cmpi.l #$4d2e4b2e` / `#$4d214b21` / `#$464c5434` at $784c-$7860, so
 * a 15-instrument module with no tag at all, and every `6CHN`/`8CHN` variant,
 * is refused with "Not a 4 channel module".
 */
export const PTM_TAGS = ['M.K.', 'M!K!', 'FLT4']
/** where the tag sits in a 31-instrument module */
export const PTM_TAG_AT = 0x438
/** the song length byte `=Ptm Song Length` reads straight out of the bank */
export const PTM_SONG_LENGTH_AT = 0x3b6

/** `cmpi.l #$54485800` / `#$54485801` at $5fc0: `THX` and a version byte */
export const THX_TAGS = ['THX\x00', 'THX\x01']
/** the bank `Thx Load` reserves ($5fe8), and `=Thx Subsongs` checks for */
export const THX_BANK_NAME = 'THX     '
/** `move.b $d(a2),d3` at $6142 --- the sub-song count, out of the module */
export const THX_SUBSONGS_AT = 0x0d
/** the bank `P61 Load` reserves ($75cc) */
export const P61_BANK_NAME = 'P61     '
/** the sample bank `Dme Sam Play` reads: `cmp.l #$53616d70` at $40c8 */
export const SAM_BANK_MAGIC = 'Samp'
/** `cmp.w #$190` and `#$7530` at $3fd8 and $4140 --- 400 Hz to 30,000 Hz */
export const SAM_MIN_HZ = 0x190
export const SAM_MAX_HZ = 0x7530
/** the bank `Sfx13 Load` reserves ($5214), and the name `Sfx13 Play` insists on */
export const SFX_BANK_NAME = 'SFX1.3  '
/** the bank `Fc14 Load` reserves ($5908), tested as "FC1." and "4   " ($5a90) */
export const FC14_BANK_NAME = 'FC1.4   '
/** the bank `Fc13 Load` reserves ($5c78), tested as "FC1." and "3   " ($5d0a) */
export const FC13_BANK_NAME = 'FC1.3   '
/** the bank `Db Load` reserves ($4e02), tested as "Digi" and "Mod " ($4e94) */
export const DIGI_BANK_NAME = 'DigiMod '
/** the bank `Smon Load` reserves ($558c), tested as "Soun" and "dMon" ($561e) */
export const SMON_BANK_NAME = 'SoundMon'
/** `$53334d6d` then `$6f642020` at $4774: "S3Mmod" and two spaces */
export const S3M_BANK_NAME = 'S3Mmod  '

/**
 * `dc.b "Extended Module:XMmod   "` at $428c, twenty-four bytes: the
 * sixteen $4248 compares four longs of, and then the bank name.
 */
export const XM_BANK_NAME = 'XMmod   '

/** $4258's `move.l $438(a2),d0 / andi.l #$ffffff,d1`: "C", "H", "N" */
export const XM_MOD_MAGIC_AT = 0x438
export const XM_MOD_MAGIC = 0x43484e

/** $44786a: the song length byte an XM keeps at $40 and a MOD at $3b6 */
export const XM_LENGTH_AT = 0x40
export const XM_MOD_LENGTH_AT = 0x3b6

/** message 44, and message 55 when nothing is playing */
export const XM_NOT_A_MODULE = 44
export const XM_NOT_INITIALIZED = 55
/** the eight bytes at $72ac, tested as `$50536964` and `$20202020` at -$8/-$4 */
export const SID_BANK_NAME = 'PSid    '
/**
 * `=Sid Songs` reads ONE byte, at $754c: `move.b $f(a2),d3`.
 *
 * Offset $0f is the LOW half of the header's `number` word, so a file
 * claiming 256 songs reports zero here. Nothing in the corpus has more than
 * twelve and the SID format's own limit is 256, so the truncation is real and
 * unreachable at once.
 */
export const SID_SONGS_AT = 0x0f
/** `moveq #$10,d0` at $74b6 and $74e6, both when nothing is playing */
const SID_NOT_INITIALIZED = 16
/** `moveq #$d,d0` at $72a6, $73b4 and $755a: the bank is not named "PSid    " */
const SID_NOT_A_MODULE = 13
/** `moveq #$10,d0` into ForwardSong at $74a4 */
const SID_FORWARD_STEPS = 0x10
/** `moveq #$20,d0` into RewindSong at $74d6 */
const SID_REWIND_STEPS = 0x20
/** the eight bytes at $69e6, checked as "Octa" and "Med " at -$8 and -$4 */
export const OMED_BANK_NAME = 'OctaMed '

/** `dc.b "OctaMix "` at $6e42, checked as two longs at $6ed4 and $6ee0 */
export const OMIX_BANK_NAME = 'OctaMix '

/** `move.b $5d(a2),d3` at $710a, and only for an MMD3 */
export const OMIX_MMD3_LENGTH_AT = 0x5d

/** messages 6, 10 and 54 */
export const OMIX_NOT_A_MODULE = 6
export const OMIX_NOT_MIXING = 10
export const OMIX_NOT_INITIALIZED = 54
/** 20, 21 and 22: the three that fire only while something is playing */
export const OMIX_14BIT_BUSY = 20
export const OMIX_FREQ_BUSY = 21
export const OMIX_BUFFER_BUSY = 22
/** the eight at $4942, compared as "TFMX" and "Mod " at -$8 and -$4 */
export const TFMX_BANK = 'TFMXMod '
/** the bank `Dmed Load` reserves ($65a2), tested as "Med " and four spaces ($663c) */
export const DMED_BANK_NAME = 'Med     '
/** `cmpi.l #$4d4d4432,(a2)` at $6794: MMD2 keeps its sequence count elsewhere */
export const MMD2_TAG = 'MMD2'
/** MMD0 and MMD1 count their sequence at $22f, MMD2 at $5d */
export const DMED_SEQLEN_AT = 0x22f
export const MMD2_SEQLEN_AT = 0x5d

/**
 * What every `* Load` in this extension asks `L_Bnk_Reserve` for.
 *
 * `moveq #$3,d1` --- Bnk_BitData and Bnk_BitChip together (banks.ts, out of
 * +Equ.s) --- on eight of the nine loaders, so a module bank is a DATA bank in
 * CHIP ram: it survives `Erase Temp` and the DMA can reach it. Only `Dmed
 * Load` differs, with `moveq #$1,d1` at $64ea and no chip bit, because
 * medplayer.library relocates the module into chip itself.
 *
 * All eight said Work and fast here until DigiBooster's neighbour was read.
 */
export const DME_BANK_FLAGS = { data: true, chip: true }

/**
 * Routine 301's message table at $ac90 — sixty strings, NUL-separated, and
 * `d0` is the INDEX into it. `lea $ac90(pc),a0 / moveq #$0,d1 / moveq #$0,d3 /
 * moveq #$e,d2 / Rjmp L_ErrorExt`, so d2 is 14 (the slot zero-based) and d1 is
 * 0, which makes every one trappable.
 *
 * The whole table is here because the indices are what the routines cite:
 * `Ptm Load` is `moveq #$11,d0` (17), `Thx Subsongs` is `#$17` (23), the
 * sampler is `#$3a` and `#$3b` (58 and 59). Fifty of the sixty belong to the
 * eleven external libraries and are #146's; they are kept so a later batch
 * does not have to renumber anything.
 */
export const DME_ERRORS = [
  'Not a 4 channel module', // 0
  'FastMem required',
  "Can't initialize DME_OctaMix.library",
  "Can't load DME_OctaMix.library V2.0 or higher",
  "Can't initialize DME_OctaMed.library",
  "Can't load DME_OctaMed.library V2.0 or higher",
  'Not a Octamix module',
  'Not a Med module',
  'Not a Octamed module',
  'Not a 5-8 channel module',
  'Not a 1-64 channel mixing module', // 10
  "Can't initialize DME_Med.library",
  "Can't load DME_Med.library V2.0 or higher",
  'Not a PlaySid module',
  "Can't initialize playsid.library",
  "Can't load playsid.library",
  'No PlaySid module initialized',
  'Not a Protracker module', // 17
  "Can't found free CIA-Timer",
  "Can't initialize HQ mode",
  "Can't initialize 14 Bit mode", // 20
  "Can't initialize mixing frequency",
  "Can't initialize mix-buffer",
  'Not a Thx module', // 23
  'No Thx module initialized', // 24
  'No Protracker module initialized', // 25
  "Can't found free VBL-Timer",
  'No ScreamTracker module initialized',
  'Not a Player 6.1 module', // 28
  'Not a converted TFMX V1.5 or TFMX Pro module',
  "Can't load DME_TFMX.library", // 30
  'No TFMX V1.5 or TFMX Pro module initialized',
  'No FutureComposer V1.0-1.3 module initialized',
  'Not a ScreamTracker module',
  "Can't load DME_ScreamTracker.library V2.0 or higher",
  'Not a FutureComposer V1.0-1.3 module',
  "Can't load DME_FC1.3.library V2.0 or higher",
  'Not a FutureComposer V1.4 module',
  "Can't load DME_FC1.4.library V2.0 or higher",
  'Not a SoundMon V2.0 module',
  "Can't load DME_SoundMon2.0.library V2.0 or higher", // 40
  'No SoundFX V1.3 module initialized',
  'Not a SoundFX V1.3 module',
  "Can't load DME_SoundFX1.3.library V2.0 or higher",
  'Not a FastTracker module',
  "Can't load DME_FastTracker.library",
  'No FastTracker module initialized',
  'No FutureComposer V1.4 module initialized',
  'No SoundMon V2.0 module initialized',
  'Not a DigiBooster V1.x module',
  "Can't load DME_DigiBooster.library V2.0 or higher", // 50
  "Can't initialize DigiBooster mix mode",
  'No Med module initialized',
  'No OctaMed module initialized',
  'No OctaMix module initialized',
  'No FastTracker module initialized',
  'Wrong THX Cia speed',
  'No DigiBooster V1.x module initialized',
  'Sample not defined', // 58
  'Sample bank not found', // 59
]

export interface DmeState {
  /** the ProTracker replay, which routine 299 is 4,834 bytes of */
  ptm: Protracker
  /** `$122(a2)`: the bank `Ptm Load` last filled */
  ptmBank: number
  /** `$128(a2)`: playing, which `Ptm Cont` sets without restarting */
  ptmPlaying: boolean
  /** `$129(a2)`: a module has been started at least once */
  ptmStarted: boolean
  /** the four vu bytes at `$a(a0)`, read and cleared */
  ptmVu: Uint8Array
  /** the end flag at `$e(a0)`, read and cleared */
  ptmEnd: boolean
  /** the voice mask `Ptm Voice` writes, and DMACON with it */
  ptmVoices: number

  /** the THX replay; its flag is at data+$00 and its bank at data+$06 */
  thx: ThxPlayer
  thxBank: number
  thxPlaying: boolean
  /** whether `Thx Play` has ever put a module in the replay */
  thxLoaded: boolean

  /** P61 plays through a second Protracker, as ../amiga/p61.ts converts it */
  p61: Protracker
  /** data+$38, data+$3a and data+$3c */
  p61Bank: number
  p61Playing: boolean
  p61Paused: boolean
  /** data+$42, the has-ever-played byte `=P61 Song Pos` is guarded by */
  p61Started: boolean
  p61Vu: Uint8Array

  /** the SoundFX 1.3 replay, which is a separate library rather than in-hunk */
  sfx: SoundFx
  /** `$96(a2)`, the bank `Sfx13 Load` last filled */
  sfxBank: number
  /** `$a0(a2)`: playing, which the stop and cont pair test before acting */
  sfxPlaying: boolean
  /** `$a1(a2)`: a module has been played at least once, which guards `=Sfx13 Song Pos` */
  sfxStarted: boolean

  /** the FutureComposer 1.4 replay, the second of the eleven external libraries */
  fc14: Fc14
  /** `$7e(a2)`, `$88(a2)` and `$89(a2)`, the same three fields one block along */
  fc14Bank: number
  fc14Playing: boolean
  fc14Started: boolean

  /**
   * MED, the fifth --- and the only one whose engine this port already had.
   *
   * `DME_Med.library` is medplayer.library behind DOOM's veneer, and #121 read
   * medplayer.library itself for the Music extension. So `dmed *` is a shim
   * over `MedPlayer` rather than another replayer.
   */
  dmed: MedPlayer | null
  /** `$48(a2)`, `$52(a2)` and `$54(a2)`: the bank, playing, and ever-played */
  dmedBank: number
  dmedPlaying: boolean
  dmedStarted: boolean
  /** the four vu bytes the veneer keeps, read and cleared */
  dmedVu: Uint8Array

  /** ScreamTracker 3, the seventh --- twelve channels through a 28 kHz mixer */
  /** `DME_TFMX.library`'s replay, over `src/amiga/tfmxplay.ts` */
  tfmx: TfmxPlayer
  /** `$b0(a2)`, the bank `Tfmx Load` last filled */
  tfmxBank: number
  tfmxPlaying: boolean
  /** `$bc(a2)`, which nothing clears, so the readers answer after a stop */
  tfmxStarted: boolean
  /**
   * `DME_OctaMed.library`'s replay, which is medplayer's with MMD2, eight
   * tracks and a mixer. `MedPlayer` in its `octaplayer` build is the engine.
   */
  omed: MedPlayer | null
  /** `$56(a2)`, the bank `Omed Load` last filled */
  omedBank: number
  omedPlaying: boolean
  omedStarted: boolean
  /** the eight bytes at $21033c, which `=Omed Vu` reads and clears */
  omedVu: Uint8Array

  /**
   * `DME_OctaMix.library`'s replay: the same OctaMED sequencer over a 1-to-64
   * channel software mixer. `MedPlayer` in its `octamixplayer` build.
   */
  omix: MedPlayer | null
  /** `$64(a2)`, the bank `Omix Load` last filled */
  omixBank: number
  /** `$6e(a2)`, which `Omix Stop` clears, and `$70(a2)`, which it does not */
  omixPlaying: boolean
  omixStarted: boolean
  /** the 64 bytes LVO -120 reads and clears */
  omixVu: Uint8Array
  s3m: S3mPlayer
  /** `$dc(a2)`, `$e6(a2)` and `$e7(a2)` */
  s3mBank: number
  s3mPlaying: boolean
  s3mStarted: boolean

  /** FastTracker 2, the twelfth and last external replayer */
  xm: XmPlayer
  /** `$e8(a2)`, the bank `Xm Load` last filled */
  xmBank: number
  /** `$f2(a2)`, which `Xm Stop` clears, and `$f3(a2)`, which it does not */
  xmPlaying: boolean
  xmStarted: boolean

  /** BP SoundMon 2.0, the sixth --- four channels and a synth, no mixer */
  smon: SoundMon
  /** `$8a(a2)`, `$94(a2)` and `$95(a2)` */
  smonBank: number
  smonPlaying: boolean
  smonStarted: boolean

  /** the DigiBooster 1.x replay, the fourth of the eleven */
  digi: DigiPlayer
  /** `$a2(a2)`, `$ac(a2)`, `$ad(a2)` and `$ae(a2)`: bank, playing, unpaused, started */
  digiBank: number
  digiPlaying: boolean
  digiUnpaused: boolean
  digiStarted: boolean
  /** where the tick clock has got to, because DigiBooster's rate is the module's */
  digiTime: number

  /** the FutureComposer 1.0-1.3 replay, the third of the eleven */
  fc13: Fc13
  /** `$72(a2)`, `$7c(a2)` and `$7d(a2)`, the same three fields one block back */
  fc13Bank: number
  fc13Playing: boolean
  fc13Started: boolean

  /**
   * `playsid.library` itself, which is the twelfth external replayer and the
   * only one DME does not ship. See ../amiga/playsid.ts.
   */
  sid: PlaySid
  /** `$f4(a2)`: the bank `Sid Load` last filled */
  sidBank: number
  /** `$fe(a2)`: playing, the flag every one of the eight instructions tests */
  sidPlaying: boolean
  /**
   * `$f6(a2)`: the library base, null until routine 261 opens it.
   *
   * A boolean here rather than a pointer, because what the extension does
   * with it is test it for zero and call through it. `Sid Stop` is the only
   * keyword that closes anything, and it closes the emulation resource
   * rather than the library.
   */
  sidOpened: boolean

  /** data+$12c, data+$12a: the sampler's bank and volume */
  samBank: number
  samVolume: number
}

export function newDmeState(rt?: Runtime): DmeState {
  const ptm = new Protracker(() => rt?.host.audio)
  const st: DmeState = {
    ptm,
    ptmBank: 0,
    ptmPlaying: false,
    ptmStarted: false,
    ptmVu: new Uint8Array(4),
    ptmEnd: false,
    ptmVoices: 0b1111,
    thx: new ThxPlayer(() => rt?.host.audio),
    thxBank: 0,
    thxPlaying: false,
    thxLoaded: false,
    p61: new Protracker(() => rt?.host.audio),
    p61Bank: 0,
    p61Playing: false,
    p61Paused: false,
    p61Started: false,
    p61Vu: new Uint8Array(4),
    sfx: new SoundFx(() => rt?.host.audio),
    sfxBank: 0,
    sfxPlaying: false,
    sfxStarted: false,
    fc14: new Fc14(() => rt?.host.audio),
    fc14Bank: 0,
    fc14Playing: false,
    fc14Started: false,
    smon: new SoundMon(() => rt?.host.audio),
    smonBank: 0,
    smonPlaying: false,
    smonStarted: false,
    tfmx: new TfmxPlayer(() => rt?.host.audio),
    tfmxBank: 0,
    tfmxPlaying: false,
    tfmxStarted: false,
    omed: null,
    omedBank: 0,
    omedPlaying: false,
    omix: null,
    omixBank: 0,
    omixPlaying: false,
    omixStarted: false,
    omixVu: new Uint8Array(OMIX_MAX_CHANNELS),
    omedStarted: false,
    omedVu: new Uint8Array(8),
    s3m: new S3mPlayer(() => rt?.host.audio),
    s3mBank: 0,
    s3mPlaying: false,
    s3mStarted: false,
    xm: new XmPlayer(() => rt?.host.audio),
    xmBank: 0,
    xmPlaying: false,
    xmStarted: false,
    dmed: null,
    dmedBank: 0,
    dmedPlaying: false,
    dmedStarted: false,
    dmedVu: new Uint8Array(4),
    digi: new DigiPlayer(() => rt?.host.audio),
    digiBank: 0,
    digiPlaying: false,
    digiUnpaused: false,
    digiStarted: false,
    digiTime: 0,
    fc13: new Fc13(() => rt?.host.audio),
    fc13Bank: 0,
    fc13Playing: false,
    fc13Started: false,
    sid: new PlaySid(() => rt?.host.audio),
    sidBank: 0,
    sidPlaying: false,
    sidOpened: false,
    samBank: 0,
    samVolume: 0x40,
  }
  // the vu bytes at `$a(a0)` are the replayer's own, written per trigger and
  // cleared by the reader --- the same read-and-clear AMOS's `Vumeter` has
  ptm.onVu = (voice, volume) => {
    if (voice >= 0 && voice < 4) st.ptmVu[voice] = volume & 0xff
  }
  st.p61.onVu = (voice, volume) => {
    if (voice >= 0 && voice < 4) st.p61Vu[voice] = volume & 0xff
  }
  return st
}

/**
 * The `MedPlayer` the `dmed` block drives, made on first use.
 *
 * It reads the module out of the bank `Dmed Load` filled, which is what makes
 * `MedCheck` mean the right thing: freeing or replacing that bank stops the
 * replay, exactly as it does for AMOS's own `Med Play` off bank 3.
 */
function medFor(rt: Runtime, s: DmeState): MedPlayer {
  if (s.dmed) return s.dmed
  const player = new MedPlayer({
    get audio() {
      return rt.audio
    },
    tick: () => rt.frames,
    getBank: () => rt.memBanks.get(s.dmedBank) ?? null,
  })
  player.onVu = (voice, volume) => {
    if (voice >= 0 && voice < 4) s.dmedVu[voice] = volume & 0xff
  }
  player.bank = s.dmedBank
  s.dmed = player
  return player
}

/**
 * The `MedPlayer` the `omed` block drives, in its octaplayer build.
 *
 * `DME_OctaMed.library` shares 69.2% of its bytes with the medplayer build
 * `med.ts` was read from, so this is the same replay with MMD2, eight tracks
 * and `mmd2mix.ts` behind it rather than a second engine.
 */
function omedFor(rt: Runtime, s: DmeState): MedPlayer {
  if (s.omed) return s.omed
  const player = new MedPlayer(
    {
      get audio() {
        return rt.audio
      },
      tick: () => rt.frames,
      getBank: () => rt.memBanks.get(s.omedBank) ?? null,
    },
    'octaplayer',
  )
  player.onVu = (voice, volume) => {
    if (voice >= 0 && voice < 8) s.omedVu[voice] = volume & 0xff
  }
  s.omed = player
  return player
}

/**
 * Routine 242 ($6f2e): open the library once, at version 2, and initialise it.
 *
 * The version matters. `moveq #$2,d0` at $6f40 is the only "V2.0 or higher"
 * open in the whole extension that is NOT spelled out in its error message,
 * and `DME_OctaMix.library` is the one sibling that really is version 2 --- the
 * FastTracker one this port did earlier is still at 1.0.
 */
function omixFor(rt: Runtime, s: DmeState): MedPlayer {
  if (s.omix) return s.omix
  const player = new MedPlayer(
    {
      get audio() {
        return rt.audio
      },
      tick: () => rt.frames,
      getBank: () => rt.memBanks.get(s.omixBank) ?? null,
    },
    'octamixplayer',
  )
  player.onVu = (voice, volume) => {
    if (voice >= 0 && voice < OMIX_MAX_CHANNELS) s.omixVu[voice] = volume & 0xff
  }
  s.omix = player
  return player
}

/** routine 92 ($4c86): `moveq #$17,d0 / Rjmp L_Error` */
const badCall = (): never => {
  funcCall()
}

/** routine 301 with the index the caller puts in d0 */
const dmeErr = (n: number): never => {
  throw new AmosError(DME_ERRORS[n] ?? `DME error ${n}`)
}
/** `moveq #$11,d0` (17) --- `Ptm Load` at $787c and `Ptm Play` at $794c */
const notAModule = (): never => dmeErr(17)

/**
 * Routine 261 ($73c2): open `playsid.library` once and keep the base.
 *
 * `tst.l $f6(a2) / bne` skips it when the base is already there, otherwise
 * `OpenLibrary` at exec -$228 with version 0 and the name at $740a. A failure
 * is message 15.
 *
 * The routine's second half is dead: `moveq #$0,d0 / tst.l d0 / bne` can
 * never branch, so message 14, "Can't initialize playsid.library", is
 * unreachable in this extension. It is still in `DME_ERRORS` because the
 * string is in the binary.
 *
 * DEVIATION: the library is always present here, because it is
 * ../amiga/playsid.ts rather than a file in `LIBS:`. Message 15 therefore
 * never fires, which is the one branch of this routine a program can see and
 * this port cannot reach.
 */
function openPlaySid(s: DmeState): void {
  if (s.sidOpened) return
  s.sidOpened = true
}

/** Routine 258 ($72e8): `StopSong` at LVO -66 and `FreeEmulResource` at -36 */
function sidStop(s: DmeState): void {
  if (!s.sidPlaying) return
  s.sidPlaying = false
  s.sid.stopSong()
  s.sid.freeEmulResource()
}

/** the eight bytes before a bank's data are its name; `Ptm Play` reads them as two longs */
function isTrackerBank(rt: Runtime, n: number): boolean {
  const b = rt.memBanks.get(n)
  return b !== undefined && b.name.padEnd(8).slice(0, 8) === PTM_BANK_NAME
}

export function makeDmeInstructions(rt: Runtime): Record<string, Instr> {
  const st = (): DmeState => rt.dme

  /** routine 298 into 283: the interrupt off and the replay with it */
  const stop = (): void => {
    const s = st()
    if (!s.ptmPlaying) return
    s.ptmPlaying = false
    s.ptm.stop()
  }

  return {
    /**
     * Ptm Load file$, bank — routine 281 ($77de).
     *
     * The bank number pops FIRST despite being written last (`move.l (a3)+,d3
     * / cmp.l #$10000,d3`), and a bank at or past 65,536 is AMOS error 23.
     * Reloading the bank that is currently playing stops it first — the test
     * is `cmp.w $122(a2),d3` AND `tst.b $128(a2)`, so reloading a DIFFERENT
     * bank leaves the music running.
     *
     * The bank it reserves is a Work bank named "Tracker ", sized as the file
     * rounded up to even plus eight ($7810-$781a). Then the tag at $438 is
     * checked against three values and nothing else, and a module it does not
     * recognise has its bank ERASED again (`L_Bnk_Eff`, $7876) before the
     * error is raised — so a failed load leaves nothing behind.
     */
    'ptm load'(it) {
      const path = it.evalStr()
      it.expect(',')
      const bank = it.evalInt()
      const s = st()
      if (bank >= 0x10000) badCall()
      if (bank === s.ptmBank && s.ptmPlaying) stop()
      const bytes = rt.vfs?.readFile(path) ?? rt.fs?.read(path) ?? null
      if (!bytes) throw new AmosError(`file not found: ${path}`, 94)
      s.ptmBank = bank
      const size = (bytes.length & 1 ? bytes.length + 1 : bytes.length) + 8
      rt.reserveBank(bank, size, PTM_BANK_NAME, true, true)
      const data = rt.memBanks.get(bank)!.data
      data.set(bytes.subarray(0, Math.min(bytes.length, data.length)))
      const tag = String.fromCharCode(...data.subarray(PTM_TAG_AT, PTM_TAG_AT + 4))
      if (!PTM_TAGS.includes(tag)) {
        rt.eraseBank(bank)
        notAModule()
      }
    },

    /**
     * Ptm Play bank — routine 284 ($78de), which branches into routine 285.
     *
     * It is two instructions: it PUSHES `$80000000` and branches.
     * That value is popped into d7 as the play parameter, and then the
     * argument the program passed is compared against the same constant —
     * `Ptm Play $80000000` means "the bank `Ptm Load` last used", which is
     * the only way the remembered `$122(a2)` is ever read back.
     *
     * It stops whatever is playing first, sets the CIA divisor to 125
     * regardless of the module, and refuses a bank that is not named
     * "Tracker ".
     */
    'ptm play'(it) {
      const arg = it.evalInt()
      const s = st()
      stop()
      const bank = arg === PTM_CURRENT_BANK ? s.ptmBank : arg
      if (!isTrackerBank(rt, bank)) notAModule()
      const song = parseMod(rt.memBanks.get(bank)!.data)
      if (!song) notAModule()
      s.ptm.bpm = PTM_DEFAULT_BPM
      s.ptm.voices = s.ptmVoices
      s.ptm.load(song!)
      s.ptmPlaying = true
      s.ptmStarted = true
      s.ptmEnd = false
      s.ptmVu.fill(0)
    },

    /** Ptm Stop — routine 283 ($78bc): the flag, the interrupt, and the replay */
    'ptm stop'() {
      stop()
    },

    /**
     * Ptm Cont — routine 288 ($79d6): put the flag back and reinstall the
     * interrupt, WITHOUT touching the replayer's position.
     *
     * `tst.b $128(a2) / bne` — already playing is a no-op, so a double
     * continue cannot restart anything.
     */
    'ptm cont'() {
      const s = st()
      if (s.ptmPlaying) return
      if (!s.ptmStarted) return
      s.ptmPlaying = true
      s.ptm.playing = true
    },

    /**
     * Ptm Volume n — routine 286 ($7952), and the range check runs twice.
     *
     * `Rbmi routine 92` refuses a negative and `cmp.l #$40,d7 / Rbhi` refuses
     * past 64, so both are AMOS error 23 — and then the value is clamped
     * again into 0..64 by two more branches that can no longer fire.
     */
    'ptm volume'(it) {
      const v = it.evalInt()
      if (v < 0 || v > 64) badCall()
      st().ptm.master = v
    },

    /**
     * Ptm Voice mask — routine 287 ($797c): the low four bits say which
     * voices the music may use.
     *
     * A bit that is CLEAR gets AUDxVOL zeroed directly ($a8/$b8/$c8/$d8 off
     * $dff000) and its enable byte cleared; then `ori.w #$8000,d0 / move.w
     * d0,$96(a2)` writes DMACON with bit 15 set, which turns the wanted
     * voices back ON. Note what that means: the mask is written to DMACON
     * whole, so bits above 3 would reach DMACON's other fields — and nothing
     * masks them.
     */
    'ptm voice'(it) {
      const mask = it.evalInt() & 0xf
      const s = st()
      for (let v = 0; v < 4; v++) {
        if (mask & (1 << v)) continue
        rt.host.audio?.setVolume(v, 0)
        rt.host.audio?.stop(v)
      }
      s.ptmVoices = mask
      s.ptm.voices = mask
      s.ptm.forget()
    },

    /**
     * Ptm Cia Speed n — routine 289 ($79ec), the only CIA-tempo keyword in
     * the extension.
     *
     * `cmp.l #$1f,d7 / Rbls` and `cmp.l #$ff,d7 / Rbhi`, so the range is 32
     * to 255 inclusive and anything outside is AMOS error 23. Setting the
     * speed it already has is a no-op (`cmp.l d7,d1 / beq`), and the
     * interrupt is only reinstalled when one is already running.
     *
     * DEVIATION: on the machine this is a CIA timer divisor and here it is
     * the replay's bpm, which is the same tempo one layer up. There is no
     * timer to divide.
     */
    'ptm cia speed'(it) {
      const n = it.evalInt()
      if (n <= 0x1f || n > 0xff) badCall()
      st().ptm.bpm = n
    },


    /**
     * Thx Load file$, bank — routine 187 ($5f56), and the same nine steps as
     * `Ptm Load`: the bank pops first, `cmp.l #$10000,d3`, the same
     * even-plus-eight sizing, and a tag test at the end.
     *
     * The tag is at offset ZERO rather than $438 and it is two values,
     * `THX\0` and `THX\1` (`cmpi.l #$54485800` / `#$54485801`), so the version
     * byte is part of what is compared. The bank is named "THX     ".
     */
    'thx load'(it) {
      const path = it.evalStr()
      it.expect(',')
      const bank = it.evalInt()
      const s = st()
      if (bank >= 0x10000) badCall()
      if (bank === s.thxBank && s.thxPlaying) {
        s.thxPlaying = false
        s.thx.stop()
      }
      const bytes = rt.vfs?.readFile(path) ?? rt.fs?.read(path) ?? null
      if (!bytes) throw new AmosError(`file not found: ${path}`, 94)
      s.thxBank = bank
      const size = (bytes.length & 1 ? bytes.length + 1 : bytes.length) + 8
      rt.reserveBank(bank, size, THX_BANK_NAME, true, true)
      const data = rt.memBanks.get(bank)!.data
      data.set(bytes.subarray(0, Math.min(bytes.length, data.length)))
      const tag = String.fromCharCode(...data.subarray(0, 4))
      if (!THX_TAGS.includes(tag)) {
        rt.eraseBank(bank)
        dmeErr(23)
      }
    },

    /**
     * Thx Play bank — routine 190 ($6044), the same two instructions as
     * `Ptm Play`: push `$80000000` and branch into the body.
     */
    'thx play'(it) {
      const arg = it.evalInt()
      const s = st()
      s.thxPlaying = false
      s.thx.stop()
      const bank = arg === PTM_CURRENT_BANK ? s.thxBank : arg
      const b = rt.memBanks.get(bank)
      if (!b || b.name.padEnd(8).slice(0, 8) !== THX_BANK_NAME) dmeErr(23)
      s.thx.load(thxParse(b!.data))
      s.thxPlaying = true
      s.thxLoaded = true
    },

    /**
     * Thx Stop — routine 189 ($6024): `tst.w (a2)` on the flag at data+$00,
     * then `jsr $14(a2)` into the replayer's own stop.
     */
    'thx stop'() {
      const s = st()
      if (!s.thxPlaying) return
      s.thxPlaying = false
      s.thx.stop()
    },

    /**
     * Thx Cont — routine 197 ($6218), and it is NOT `Ptm Cont`.
     *
     * Where the ProTracker one puts a flag back and reinstalls an interrupt,
     * this rewrites eight of the replayer's fields: `st.b $4(a6)` to start it,
     * `clr.w $3aa` for the tick counter, `sf.b $3b0` for the break flag,
     * `clr.w $446` and `$3b6` for the row, and then the position test at
     * $6244 — if the current position equals the END position it sets the end
     * byte and jumps back to the restart. So `Thx Cont` on a song that has
     * finished starts it again rather than doing nothing.
     */
    'thx cont'() {
      const s = st()
      if (s.thxPlaying) return
      if (!s.thxLoaded) return
      s.thxPlaying = true
      s.thx.playing = true
      s.thx.tickCount = 0
      s.thx.row = 0
    },

    /**
     * Thx Volume n — routine 194 ($6180): 0..64 both ways, then
     * `move.b d7,$1(a0)` on the replayer's own master.
     */
    'thx volume'(it) {
      const v = it.evalInt()
      if (v < 0 || v > 64) badCall()
      st().thx.playerVolume = v
    },

    /**
     * Thx Next Patt / Thx Prev Patt — routines 198 ($6268) and 199 ($62ee).
     */
    'thx next patt'() {
      const s = st()
      if (!s.thxLoaded) return
      s.thx.position += 1
      s.thx.row = 0
    },
    'thx prev patt'() {
      const s = st()
      if (!s.thxLoaded) return
      s.thx.position = Math.max(0, s.thx.position - 1)
      s.thx.row = 0
    },

    /**
     * Thx Voice mask — routine 201 ($6378), the THX block's own version of
     * `Ptm Voice`.
     */
    'thx voice'(it) {
      const mask = it.evalInt() & 0xf
      for (let v = 0; v < 4; v++) {
        if (mask & (1 << v)) continue
        rt.host.audio?.setVolume(v, 0)
        rt.host.audio?.stop(v)
      }
    },

    /**
     * P61 Load file$, bank — routine 269 ($7560): the same shape again, and
     * the bank is named "P61     ".
     *
     * A Player 6.1A stream has no tag, so what the load checks is the
     * structure rather than four bytes — and ../amiga/p61.ts's parser is what
     * answers that here. A stream it cannot read is message 28, "Not a Player
     * 6.1 module".
     */
    'p61 load'(it) {
      const path = it.evalStr()
      it.expect(',')
      const bank = it.evalInt()
      const s = st()
      if (bank >= 0x10000) badCall()
      if (bank === s.p61Bank && s.p61Playing) {
        s.p61Playing = false
        s.p61.stop()
      }
      const bytes = rt.vfs?.readFile(path) ?? rt.fs?.read(path) ?? null
      if (!bytes) throw new AmosError(`file not found: ${path}`, 94)
      s.p61Bank = bank
      const size = (bytes.length & 1 ? bytes.length + 1 : bytes.length) + 8
      rt.reserveBank(bank, size, P61_BANK_NAME, true, true)
      const data = rt.memBanks.get(bank)!.data
      data.set(bytes.subarray(0, Math.min(bytes.length, data.length)))
      if (!parseP61(data)) {
        rt.eraseBank(bank)
        dmeErr(28)
      }
    },

    /** P61 Play bank — routine 272 ($7646), the same push-and-branch */
    'p61 play'(it) {
      const arg = it.evalInt()
      const s = st()
      s.p61Playing = false
      s.p61.stop()
      const bank = arg === PTM_CURRENT_BANK ? s.p61Bank : arg
      const b = rt.memBanks.get(bank)
      if (!b || b.name.padEnd(8).slice(0, 8) !== P61_BANK_NAME) dmeErr(28)
      const m = parseP61(b!.data)
      if (!m) dmeErr(28)
      s.p61.load(p61Song(m!))
      s.p61Playing = true
      s.p61Started = true
      s.p61Paused = false
      s.p61Vu.fill(0)
    },

    /**
     * P61 Stop — routine 271 ($760a), and it frees memory the other three do
     * not: `L_RamFree` on the block at data+$3e with the length at data+$44,
     * which is where a PACKED P61 stream was unpacked to. A module that was
     * not packed leaves those zero and the free is skipped.
     */
    'p61 stop'() {
      const s = st()
      if (!s.p61Playing) return
      s.p61Playing = false
      s.p61.stop()
    },

    /**
     * P61 Pause — routine 277 ($7744), which has no equivalent in the other
     * three blocks.
     *
     * It clears the replayer's own play flag, sets data+$3c, zeroes all four
     * AUDxVOL and then writes DMACON `$f` — bit 15 CLEAR, so that turns the
     * four audio DMA channels OFF rather than on. Nothing is faded; the sound
     * stops on the instruction.
     */
    'p61 pause'() {
      const s = st()
      if (s.p61Paused) return
      s.p61Paused = true
      s.p61.playing = false
      for (let v = 0; v < 4; v++) {
        rt.host.audio?.setVolume(v, 0)
        rt.host.audio?.stop(v)
      }
    },

    /**
     * P61 Cont — routine 278 ($777c), four instructions and NO guard:
     * `movea.l $34(a2),a0 / move.w #$1,$20(a0) / clr.w $3c(a2)`.
     *
     * It writes the replayer's play flag and clears the pause word whether or
     * not anything is loaded, where `Ptm Cont` tests its flag first. So a
     * `P61 Cont` on a machine that has never played anything still comes out
     * of pause.
     */
    'p61 cont'() {
      const s = st()
      s.p61Paused = false
      if (s.p61Started) s.p61.playing = true
    },

    /** P61 Volume n — routine 274 ($76dc): 0..64, checked twice as `Ptm Volume` is */
    'p61 volume'(it) {
      const v = it.evalInt()
      if (v < 0 || v > 64) badCall()
      st().p61.master = v
    },

    /**
     * Dme Sam Bank n — routine 40 ($3f5c), three instructions:
     * `move.l (a3)+,d0 / move.l d0,$12c(a2)`. It is remembered and NOT
     * checked; the bank is only looked at when `Dme Sam Play` reads it.
     */
    'dme sam bank'(it) {
      st().samBank = it.evalInt()
    },

    /**
     * Dme Sam Volume n — routine 41 ($3f68), and it CLAMPS where the music
     * blocks raise: `bpl` takes a negative to 0 and `cmp.w #$40 / ble` takes
     * anything past 64 down to 64. Same range, opposite manners.
     */
    'dme sam volume'(it) {
      const v = it.evalInt()
      st().samVolume = v < 0 ? 0 : v > 0x40 ? 0x40 : v
    },

    /**
     * Dme Sam Freq mask, hz — routine 43 ($3fc0).
     *
     * The frequency is clamped to 400..30,000 (`cmp.w #$190` / `#$7530`) and
     * turned into a period by `divu.w` against the clock at data+$130, which
     * routine 0 set to the PAL or NTSC value off AMOS's own NTSC call. Then
     * one voice per set bit — but only if that voice's busy byte is CLEAR
     * (`tst.b (a1) / bne`), so it retunes idle voices and leaves a playing
     * one alone.
     */
    'dme sam freq'(it) {
      const mask = it.evalInt()
      it.expect(',')
      let hz = it.evalInt()
      if (hz < 0) hz = 0
      if (hz <= SAM_MIN_HZ) hz = SAM_MIN_HZ
      if (hz >= SAM_MAX_HZ) hz = SAM_MAX_HZ
      for (let v = 0; v < 4; v++) {
        if (!(mask & (1 << v))) continue
        rt.host.audio?.setFrequency(v, hz)
      }
    },

    /**
     * Dme Sam Stop — routine 44 ($4012), two instructions: it pushes `$f` and
     * falls into routine 45, which is the same loop `Dme Sam Play` ends with.
     * So "stop" is "stop all four", and there is no per-voice form.
     */
    'dme sam stop'() {
      for (let v = 0; v < 4; v++) rt.host.audio?.stop(v)
    },

    /**
     * Dme Sam Play n — routine 46 ($405c) through routine 49.
     *
     * A NEGATIVE sample number means loop: `bpl` skips, otherwise `neg.l d7`
     * and a flag. Zero is AMOS error 23 before anything else.
     *
     * Routine 49 is the bank read, and it is the AMOS sample bank exactly:
     * the name must be `Samp` (`cmp.l #$53616d70` on the eight bytes before
     * the data), the count is the first word, the offset table is four bytes
     * an entry from -2, and a zero offset is message 58, "Sample not
     * defined". A bank that is not there at all is 59, "Sample bank not
     * found". The header it lands on is frequency at +$8, length at +$a and
     * the data at +$e.
     *
     * It always plays on all four voices — `moveq #$f,d1` at $406e — which is
     * what makes it a one-shot sound effect rather than a channel allocator.
     */
    'dme sam play'(it) {
      const n = it.evalInt()
      const s = st()
      if (n === 0) badCall()
      const loop = n < 0
      const num = Math.abs(n)
      if (s.samBank === 0) badCall()
      const b = rt.memBanks.get(s.samBank)
      if (!b || b.name.padEnd(4).slice(0, 4) !== SAM_BANK_MAGIC) dmeErr(59)
      const data = b!.data
      const count = ((data[0]! << 8) | data[1]!) & 0xffff
      if (num > count) badCall()
      const at = num * 4 - 2
      const off =
        ((data[at]! << 24) | (data[at + 1]! << 16) | (data[at + 2]! << 8) | data[at + 3]!) >>> 0
      if (off === 0) dmeErr(58)
      const hz = ((data[off + 8]! << 8) | data[off + 9]!) & 0xffff
      const len =
        ((data[off + 10]! << 24) | (data[off + 11]! << 16) | (data[off + 12]! << 8) | data[off + 13]!) >>> 0
      const pcm = new Int8Array(Math.max(0, Math.min(len, data.length - off - 14)))
      for (let i = 0; i < pcm.length; i++) pcm[i] = (data[off + 14 + i]! << 24) >> 24
      for (let v = 0; v < 4; v++) {
        rt.host.audio?.play(v, pcm, hz, s.samVolume, loop ? 0 : pcm.length)
      }
    },

    /**
     * Dme Sam Raw mask, address, length, hz — routine 39 ($3f4e), four pops
     * straight into routine 50 with no bank in the way.
     *
     * The pops are in reverse, so the mask is the FIRST argument and the
     * frequency the last. Routine 50 halves the length (`lsr.w #$1,d2` — the
     * hardware counts words) and clamps the frequency the same 400..30,000
     * the `Freq` keyword does.
     */
    'dme sam raw'(it) {
      const mask = it.evalInt()
      it.expect(',')
      const addr = it.evalInt()
      it.expect(',')
      const len = it.evalInt()
      it.expect(',')
      let hz = it.evalInt()
      if (hz <= SAM_MIN_HZ) hz = SAM_MIN_HZ
      if (hz >= SAM_MAX_HZ) hz = SAM_MAX_HZ
      if (len === 0 || (mask & 0xf) === 0) return
      const m = rt.resolveAddr(addr >>> 0)
      if (!m) throw new AmosError('address error')
      const n = Math.min(len, m.data.length - m.off)
      const pcm = new Int8Array(n)
      for (let i = 0; i < n; i++) pcm[i] = (m.data[m.off + i]! << 24) >> 24
      for (let v = 0; v < 4; v++) {
        if (!(mask & (1 << v))) continue
        rt.host.audio?.play(v, pcm, hz, st().samVolume, pcm.length)
      }
    },

    /**
     * Ptm Next Patt / Ptm Prev Patt — routines 294 ($7ac8) and 295 ($7b16):
     * step the song position without stopping.
     */
    'ptm next patt'() {
      const s = st()
      if (!s.ptmStarted || !s.ptm.song) return
      s.ptm.setPosition(Math.min(s.ptm.pos + 1, s.ptm.song.positions.length - 1))
    },
    'ptm prev patt'() {
      const s = st()
      if (!s.ptmStarted || !s.ptm.song) return
      s.ptm.setPosition(Math.max(s.ptm.pos - 1, 0))
    },

    /**
     * Sfx13 Load file$, bank — routine 123 ($5184), and the same nine steps
     * as `Ptm Load` down to the instruction.
     *
     * The bank is named "SFX1.3  " ($5214) and the tag test is one compare:
     * `cmpi.l #$534f4e47,$3c(a2)`, "SONG" at offset 60. There is no second
     * form. SoundFX also exists with a 31-instrument "SO31" header and this
     * extension refuses it, so one variant is the whole format here.
     */
    'sfx13 load'(it) {
      const path = it.evalStr()
      it.expect(',')
      const bank = it.evalInt()
      const s = st()
      if (bank >= 0x10000) badCall()
      if (bank === s.sfxBank && s.sfxPlaying) {
        s.sfxPlaying = false
        s.sfx.stop()
      }
      const bytes = rt.vfs?.readFile(path) ?? rt.fs?.read(path) ?? null
      if (!bytes) throw new AmosError(`file not found: ${path}`, 94)
      s.sfxBank = bank
      const size = (bytes.length & 1 ? bytes.length + 1 : bytes.length) + 8
      rt.reserveBank(bank, size, SFX_BANK_NAME, true, true)
      const data = rt.memBanks.get(bank)!.data
      data.set(bytes.subarray(0, Math.min(bytes.length, data.length)))
      if (String.fromCharCode(...data.subarray(SFX_MAGIC_AT, SFX_MAGIC_AT + 4)) !== SFX_MAGIC) {
        rt.eraseBank(bank)
        dmeErr(42)
      }
    },

    /**
     * Sfx13 Play bank — routine 126 ($5270), the same push-and-branch into
     * routine 127.
     *
     * Routine 127 opens the library first (routine 128, message 43 if that
     * fails), stops whatever is playing, and then checks the BANK NAME rather
     * than the module: `cmpi.l #$53465831,-$8(a2)` and `#$2e332020,-$4(a2)`
     * are "SFX1" and ".3  ", the eight bytes in front of the bank data. So a
     * bank filled by hand with a valid module but the wrong name is message
     * 42, and one named right with rubbish in it plays.
     *
     * Two of the replayer's own bugs are catalogued here rather than in
     * ../amiga/soundfx.ts, which is where they are reproduced: that directory
     * carries deviations and never defects (../amiga/README.md).
     *
     * DEFECT: the sample clear at $21061e never runs. It guards `clr.l (a1)`
     * with `cmpa.l $210b0a.l,a1 / bge`, and no instruction in the 2,960 bytes
     * ever writes $210b0a --- a scan of the relocated image finds the one read
     * and no write. It stays zero, every sample pointer is above zero, and the
     * branch is always taken. So an unlooped sample ends by looping its own
     * first word rather than a zeroed one, which is a drone whenever the
     * composer did not start the sample silent.
     *
     * DEFECT: the arpeggio's table search at $2107e4 has no test for the
     * $ffff terminator that the slide's search at $210772 does have, so a
     * period the table does not hold walks off the end of the data hunk. This
     * port stops on the base period instead, which is the closest thing to
     * what the composer heard that does not read past an array.
     */
    'sfx13 play'(it) {
      const arg = it.evalInt()
      const s = st()
      s.sfxPlaying = false
      s.sfx.stop()
      const bank = arg === PTM_CURRENT_BANK ? s.sfxBank : arg
      const b = rt.memBanks.get(bank)
      if (!b || b.name.padEnd(8).slice(0, 8) !== SFX_BANK_NAME) dmeErr(42)
      const song = parseSfx(b!.data)
      if (!song) dmeErr(42)
      s.sfx.load(song!)
      s.sfxPlaying = true
      s.sfxStarted = true
    },

    /** Sfx13 Stop — routine 125 ($5250): the flag, then LVO -36 */
    'sfx13 stop'() {
      const s = st()
      if (!s.sfxPlaying) return
      s.sfxPlaying = false
      s.sfx.stop()
    },

    /**
     * Sfx13 Cont — routine 130 ($536e): `tst.b $a0(a2) / bne`, so continuing
     * something already playing is a no-op, and the position is untouched.
     */
    'sfx13 cont'() {
      const s = st()
      if (s.sfxPlaying) return
      if (!s.sfxStarted) return
      s.sfxPlaying = true
      s.sfx.cont()
    },

    /**
     * Sfx13 Volume n — routine 137 ($54aa): `cmp.l #$0,d7 / Rblt` and
     * `cmp.l #$40,d7 / Rbhi`, so 0 to 64 and anything else is AMOS error 23.
     *
     * The library then does `mulu.w #$40,d0 / lsr.w #$6,d0` ($210232), which
     * is the value back again — 64 up and 64 down. Reproduced as the identity
     * it is, because the multiply overflows a word above 1,023 and nothing
     * can get there through the range check.
     *
     * DEFECT: `Sfx13 Volume 0` silences every voice on the next note rather
     * than that note. The volume routine at $2103b0 tests the scaled result
     * and, when it is zero, clears all FOUR of $dff0a8, $b8, $c8 and $d8
     * instead of this channel's. Each other voice stays silent until its own
     * next trigger. It fires for any note that scales to zero, and a master of
     * 0 makes every note do it. Reproduced in ../amiga/soundfx.ts.
     */
    'sfx13 volume'(it) {
      const v = it.evalInt()
      if (v < 0 || v > 0x40) badCall()
      st().sfx.master = v
    },

    /**
     * Sfx13 Voice mask — routine 138 ($54dc), and it checks NOTHING: the
     * whole longword goes to LVO -84, which tests bits 0 to 3 and then writes
     * the value to DMACON with bit 15 set.
     */
    'sfx13 voice'(it) {
      st().sfx.setVoices(it.evalInt())
    },

    /**
     * Sfx13 Next Patt / Sfx13 Prev Patt — routines 133 ($5404) and 134
     * ($542a), and both raise message 41 when nothing is playing rather than
     * returning quietly, which is what the `ptm` pair do.
     */
    'sfx13 next patt'() {
      const s = st()
      if (!s.sfxPlaying) dmeErr(41)
      s.sfx.nextPattern()
    },
    'sfx13 prev patt'() {
      const s = st()
      if (!s.sfxPlaying) dmeErr(41)
      s.sfx.prevPattern()
    },

    /**
     * Fc14 Load file$, bank — routine 155 ($587a), the same nine steps again,
     * with the bank named "FC1.4   " ($5908) and the tag `cmpi.l #$46433134`
     * at offset ZERO rather than at $3c.
     */
    'fc14 load'(it) {
      const path = it.evalStr()
      it.expect(',')
      const bank = it.evalInt()
      const s = st()
      if (bank >= 0x10000) badCall()
      if (bank === s.fc14Bank && s.fc14Playing) {
        s.fc14Playing = false
        s.fc14.stop()
      }
      const bytes = rt.vfs?.readFile(path) ?? rt.fs?.read(path) ?? null
      if (!bytes) throw new AmosError(`file not found: ${path}`, 94)
      s.fc14Bank = bank
      const size = (bytes.length & 1 ? bytes.length + 1 : bytes.length) + 8
      rt.reserveBank(bank, size, FC14_BANK_NAME, true, true)
      const data = rt.memBanks.get(bank)!.data
      data.set(bytes.subarray(0, Math.min(bytes.length, data.length)))
      if (String.fromCharCode(...data.subarray(0, 4)) !== FC14_MAGIC) {
        rt.eraseBank(bank)
        dmeErr(37)
      }
    },

    /**
     * Fc14 Play bank — routine 158 ($5964) pushing $80000000 into routine 159,
     * which checks the BANK NAME ("FC1." and "4   " at -$8 and -$4) rather
     * than the module, exactly as the SoundFX pair do.
     */
    'fc14 play'(it) {
      const arg = it.evalInt()
      const s = st()
      s.fc14Playing = false
      s.fc14.stop()
      const bank = arg === PTM_CURRENT_BANK ? s.fc14Bank : arg
      const b = rt.memBanks.get(bank)
      if (!b || b.name.padEnd(8).slice(0, 8) !== FC14_BANK_NAME) dmeErr(37)
      const song = parseFc14(b!.data)
      if (!song) dmeErr(37)
      s.fc14.load(song!)
      s.fc14Playing = true
      s.fc14Started = true
    },

    /** Fc14 Stop — routine 157 ($5944): the flag at $88(a0), then LVO -36 */
    'fc14 stop'() {
      const s = st()
      if (!s.fc14Playing) return
      s.fc14Playing = false
      s.fc14.stop()
    },

    /** Fc14 Cont — routine 162 ($5a5c): `tst.b $88(a0) / bne`, position untouched */
    'fc14 cont'() {
      const s = st()
      if (s.fc14Playing) return
      if (!s.fc14Started) return
      s.fc14Playing = true
      s.fc14.cont()
    },

    /** Fc14 Volume n — routine 169 ($5b9c): 0..64, and outside it AMOS error 23 */
    'fc14 volume'(it) {
      const v = it.evalInt()
      if (v < 0 || v > 0x40) badCall()
      st().fc14.master = v
    },

    /** Fc14 Voice mask — routine 170 ($5bce), unchecked, straight to LVO -84 */
    'fc14 voice'(it) {
      st().fc14.setVoices(it.evalInt())
    },

    /**
     * Fc14 Next Patt / Fc14 Prev Patt — routines 165 ($5af6) and 166 ($5b1c),
     * both message 47 when nothing is playing.
     *
     * DEFECT: `Fc14 Next Patt` does not advance. LVO -54 at $21029c is
     * `subq.w #$1,d1` immediately followed by `addq.w #$1,d1`, a pair that
     * cancels, so the position it writes back is the position it read. All it
     * does is clamp a position past the end to zero and set `$28` to $40,
     * which makes the next row pass re-take the CURRENT step. The `Prev` twin
     * two vectors along has the same cancelling pair AND a real `subq` after
     * it, which is what the missing instruction here would have looked like.
     * Reproduced in ../amiga/fc14.ts.
     */
    'fc14 next patt'() {
      const s = st()
      if (!s.fc14Playing) dmeErr(47)
      s.fc14.nextPattern()
    },
    'fc14 prev patt'() {
      const s = st()
      if (!s.fc14Playing) dmeErr(47)
      s.fc14.prevPattern()
    },

    /**
     * Fc13 Load file$, bank — routine 171 ($5bea), the same nine steps once
     * more, with the bank named "FC1.3   " ($5c78) and the tag `cmpi.l
     * #$534d4f44` --- "SMOD" --- at offset zero.
     */
    'fc13 load'(it) {
      const path = it.evalStr()
      it.expect(',')
      const bank = it.evalInt()
      const s = st()
      if (bank >= 0x10000) badCall()
      if (bank === s.fc13Bank && s.fc13Playing) {
        s.fc13Playing = false
        s.fc13.stop()
      }
      const bytes = rt.vfs?.readFile(path) ?? rt.fs?.read(path) ?? null
      if (!bytes) throw new AmosError(`file not found: ${path}`, 94)
      s.fc13Bank = bank
      const size = (bytes.length & 1 ? bytes.length + 1 : bytes.length) + 8
      rt.reserveBank(bank, size, FC13_BANK_NAME, true, true)
      const data = rt.memBanks.get(bank)!.data
      data.set(bytes.subarray(0, Math.min(bytes.length, data.length)))
      if (String.fromCharCode(...data.subarray(0, 4)) !== FC13_MAGIC) {
        rt.eraseBank(bank)
        dmeErr(35)
      }
    },

    /**
     * Fc13 Play bank — routine 174 ($5cd4) pushing $80000000 into routine 175,
     * which checks the BANK NAME ("FC1." and "3   " at -$8 and -$4) rather
     * than the module, exactly as the other two pairs do.
     */
    'fc13 play'(it) {
      const arg = it.evalInt()
      const s = st()
      s.fc13Playing = false
      s.fc13.stop()
      const bank = arg === PTM_CURRENT_BANK ? s.fc13Bank : arg
      const b = rt.memBanks.get(bank)
      if (!b || b.name.padEnd(8).slice(0, 8) !== FC13_BANK_NAME) dmeErr(35)
      const song = parseFc13(b!.data)
      if (!song) dmeErr(35)
      s.fc13.load(song!)
      s.fc13Playing = true
      s.fc13Started = true
    },

    /** Fc13 Stop — routine 173 ($5cb4): the flag at $7c(a0), then LVO -36 */
    'fc13 stop'() {
      const s = st()
      if (!s.fc13Playing) return
      s.fc13Playing = false
      s.fc13.stop()
    },

    /** Fc13 Cont — routine 178 ($5dcc): `tst.b $7c(a0) / bne`, position untouched */
    'fc13 cont'() {
      const s = st()
      if (s.fc13Playing) return
      if (!s.fc13Started) return
      s.fc13Playing = true
      s.fc13.cont()
    },

    /** Fc13 Volume n — routine 185 ($5f08): 0..64, and outside it AMOS error 23 */
    'fc13 volume'(it) {
      const v = it.evalInt()
      if (v < 0 || v > 0x40) badCall()
      st().fc13.master = v
    },

    /** Fc13 Voice mask — routine 186 ($5f3a), unchecked, straight to LVO -84 */
    'fc13 voice'(it) {
      st().fc13.setVoices(it.evalInt())
    },

    /**
     * Fc13 Next Patt / Fc13 Prev Patt — routines 181 ($5e62) and 182 ($5e88),
     * both message 32 where the 1.4 pair use 47.
     *
     * DEFECT: `Fc13 Next Patt` does not advance, for the same reason 1.4's
     * does not. LVO -54 at $210298 is `subq.w #$1,d1` immediately followed by
     * `addq.w #$1,d1`, a pair that cancels, so the position it writes back is
     * the position it read. Reproduced in ../amiga/fc13.ts.
     */
    'fc13 next patt'() {
      const s = st()
      if (!s.fc13Playing) dmeErr(32)
      s.fc13.nextPattern()
    },
    'fc13 prev patt'() {
      const s = st()
      if (!s.fc13Playing) dmeErr(32)
      s.fc13.prevPattern()
    },

    /**
     * Db Load file$, bank --- routine 104 ($4d70), the same nine steps with a
     * bank named "DigiMod " ($4e02) and `cmpi.l #$44494749` --- "DIGI" --- at
     * offset zero.
     */
    'db load'(it) {
      const path = it.evalStr()
      it.expect(',')
      const bank = it.evalInt()
      const s = st()
      if (bank >= 0x10000) badCall()
      if (bank === s.digiBank && s.digiPlaying) {
        s.digiPlaying = false
        s.digi.stop()
      }
      const bytes = rt.vfs?.readFile(path) ?? rt.fs?.read(path) ?? null
      if (!bytes) throw new AmosError(`file not found: ${path}`, 94)
      s.digiBank = bank
      const size = (bytes.length & 1 ? bytes.length + 1 : bytes.length) + 8
      rt.reserveBank(bank, size, DIGI_BANK_NAME, true, true)
      const data = rt.memBanks.get(bank)!.data
      data.set(bytes.subarray(0, Math.min(bytes.length, data.length)))
      if (String.fromCharCode(...data.subarray(0, 4)) !== DIGI_MAGIC) {
        rt.eraseBank(bank)
        dmeErr(49)
      }
    },

    /**
     * Db Play bank --- routine 107 ($4e5e) pushing $80000000 into routine 108,
     * which checks the bank NAME ("Digi" and "Mod " at -$8 and -$4).
     *
     * The longword under the bank is a start position that $4ebe passes to
     * LVO -30 in d0, and $210194 does not read it. Nothing here does either.
     *
     * DEFECT: every sample of a version 1.0 to 1.3 module plays a finetune
     * step flat, about twelve cents. $2107b2 clears all 31 finetune bytes for
     * exactly the versions $10 to $13, and $210f60 then does `subq.b #$1,d2`
     * on the byte it reads back --- so DigiBooster's stored finetune is
     * ONE-BASED and a cleared field means -1 rather than neutral. The lookup
     * at $210f96 duly picks row 7 of the sixteen at $212980 for every sample
     * of every module this extension can load. It is uniform, so it transposes
     * a tune rather than detuning it against itself, which is presumably how
     * it shipped. Reproduced in ../amiga/digiplay.ts.
     */
    'db play'(it) {
      const arg = it.evalInt()
      const s = st()
      s.digiPlaying = false
      s.digi.stop()
      const bank = arg === PTM_CURRENT_BANK ? s.digiBank : arg
      const b = rt.memBanks.get(bank)
      if (!b || b.name.padEnd(8).slice(0, 8) !== DIGI_BANK_NAME) dmeErr(49)
      const song = parseDigi(b!.data)
      if (!song) dmeErr(49)
      s.digi.load(song!)
      s.digiPlaying = true
      s.digiUnpaused = true
      s.digiStarted = true
      s.digiTime = 0
    },

    /** Db Stop --- routine 106 ($4e3e): the flag at $ac(a0), then LVO -36 */
    'db stop'() {
      const s = st()
      if (!s.digiPlaying) return
      s.digiPlaying = false
      s.digiUnpaused = false
      s.digi.stop()
    },

    /** Db Pause --- routine 113 ($4fce): `$ad(a0)` down, then LVO -48 ($210226) */
    'db pause'() {
      const s = st()
      if (!s.digiUnpaused) return
      s.digiUnpaused = false
      s.digi.playing = false
      for (let v = 0; v < 4; v++) rt.host.audio?.setVolume(v, 0)
    },

    /** Db Cont --- routine 114 ($4ff2): `$ad(a0)` up, then LVO -54 ($210276) */
    'db cont'() {
      const s = st()
      if (s.digiUnpaused) return
      if (!s.digiStarted) return
      s.digiUnpaused = true
      s.digiPlaying = true
      s.digi.cont()
    },

    /**
     * Db Mix On / Db Mix Off --- routines 115 ($5018) and 116 ($5044), both
     * into LVO -60 ($2102bc), which writes one byte at $21097c.
     *
     * Both raise message 51 WHILE A MODULE IS PLAYING (`tst.b $ac(a0) / bne`),
     * so the mode is a thing to choose before `Db Play` and not during.
     */
    'db mix on'() {
      const s = st()
      if (s.digiPlaying) dmeErr(51)
      s.digi.mixing = true
    },
    'db mix off'() {
      const s = st()
      if (s.digiPlaying) dmeErr(51)
      s.digi.mixing = false
    },

    /** Db Volume n --- routine 117 ($5070): 0..64, then LVO -66 ($2102a2) */
    'db volume'(it) {
      const v = it.evalInt()
      if (v < 0 || v > 0x40) badCall()
      st().digi.master = v
    },

    /**
     * Db Boost Rate n --- routine 118 ($50a2): 0..100, then LVO -72 ($2102cc).
     *
     * $211396 multiplies the base of 64 at $210978 by it and divides by a
     * hundred, so 75 (the library's own default) plays a module at three
     * quarters of full scale and 100 at all of it.
     */
    'db boost rate'(it) {
      const v = it.evalInt()
      if (v < 0 || v > 100) badCall()
      st().digi.boost = v
    },

    /**
     * Db Next Patt / Db Prev Patt --- routines 121 ($5138) and 122 ($515e),
     * message 57 when nothing is playing, and neither goes through the
     * position-clamping the other players' pairs do: LVO -90 ($2102fe) is
     * `addq.b #$1` on one byte and LVO -96 ($210316) a `subq.b` floored at
     * zero. Both clear the row.
     */
    'db next patt'() {
      const s = st()
      if (!s.digiPlaying) dmeErr(57)
      s.digi.nextPattern()
    },
    'db prev patt'() {
      const s = st()
      if (!s.digiPlaying) dmeErr(57)
      s.digi.prevPattern()
    },

    /**
     * Dmed Load file$, bank --- routine 204 ($64be), the bank named "Med     "
     * ($65a2) and CHIP, and the tag checked by the LIBRARY rather than here:
     * $6544 calls LVO -30 and then -36, and a nonzero answer from the second
     * erases the bank and raises message 0.
     */
    'dmed load'(it) {
      const path = it.evalStr()
      it.expect(',')
      const bank = it.evalInt()
      const s = st()
      if (bank >= 0x10000) badCall()
      if (bank === s.dmedBank && s.dmedPlaying) {
        s.dmedPlaying = false
        s.dmed?.stop()
      }
      const bytes = rt.vfs?.readFile(path) ?? rt.fs?.read(path) ?? null
      if (!bytes) throw new AmosError(`file not found: ${path}`, 94)
      s.dmedBank = bank
      const size = (bytes.length & 1 ? bytes.length + 1 : bytes.length) + 8
      rt.reserveBank(bank, size, DMED_BANK_NAME, true, false)
      const data = rt.memBanks.get(bank)!.data
      data.set(bytes.subarray(0, Math.min(bytes.length, data.length)))
      if (!/^MMD[0-3]$/.test(String.fromCharCode(...data.subarray(0, 4)))) {
        rt.eraseBank(bank)
        dmeErr(7)
      }
    },

    /**
     * Dmed Play bank --- routine 207 ($6606) pushing $80000000 into routine
     * 208, which checks the bank NAME ("Med " and four spaces at -$8 and -$4)
     * and then calls LVO -78 with the sub-song in d0 and LVO -48 with the
     * module.
     *
     * The engine is `MedPlayer`, read out of medplayer.library itself for the
     * Music extension (#121). `DME_Med.library` is that replayer behind DOOM's
     * veneer, so this is the one external player that needed no new engine.
     */
    'dmed play'(it) {
      const arg = it.evalInt()
      const s = st()
      s.dmedPlaying = false
      s.dmed?.stop()
      const bank = arg === PTM_CURRENT_BANK ? s.dmedBank : arg
      const b = rt.memBanks.get(bank)
      if (!b || b.name.padEnd(8).slice(0, 8) !== DMED_BANK_NAME) dmeErr(7)
      s.dmedBank = bank
      const player = medFor(rt, s)
      player.play(0, 0)
      s.dmedPlaying = true
      s.dmedStarted = true
    },

    /** Dmed Stop --- routine 206 ($65e6): the flag at $52(a0), then LVO -66 */
    'dmed stop'() {
      const s = st()
      if (!s.dmedPlaying) return
      s.dmedPlaying = false
      s.dmed?.stop()
    },

    /** Dmed Cont --- routine 211 ($6734): `tst.b $52(a0) / bne`, then LVO -72 */
    'dmed cont'() {
      const s = st()
      if (s.dmedPlaying) return
      if (!s.dmedStarted) return
      s.dmedPlaying = true
      s.dmed?.cont()
    },

    /** Dmed Volume n --- routine 216 ($6852): 0..64, then LVO -84 */
    'dmed volume'(it) {
      const v = it.evalInt()
      if (v < 0 || v > 0x40) badCall()
      const s = st()
      medFor(rt, s).masterVolume = v
    },

    /**
     * Dmed Next Patt / Dmed Prev Patt --- routines 217 ($6884) and 218
     * ($68aa), message 52 when nothing is playing, into LVO -90 and -96.
     */
    'dmed next patt'() {
      const s = st()
      if (!s.dmedPlaying) dmeErr(52)
      medFor(rt, s).seek(1)
    },
    'dmed prev patt'() {
      const s = st()
      if (!s.dmedPlaying) dmeErr(52)
      medFor(rt, s).seek(-1)
    },

    /**
     * Smon Load file$, bank --- routine 139 ($54f8), the bank "SoundMon"
     * ($558c) and DATA plus CHIP.
     *
     * Its tag test is LOOSER than the library's: $5564 reads the LONG at $1a
     * and clears the low byte before comparing with "V.2\0", so the waveform
     * count at $1d is not part of it, where $21060a checks the three
     * characters and nothing else.
     */
    'smon load'(it) {
      const path = it.evalStr()
      it.expect(',')
      const bank = it.evalInt()
      const s = st()
      if (bank >= 0x10000) badCall()
      if (bank === s.smonBank && s.smonPlaying) {
        s.smonPlaying = false
        s.smon.stop()
      }
      const bytes = rt.vfs?.readFile(path) ?? rt.fs?.read(path) ?? null
      if (!bytes) throw new AmosError(`file not found: ${path}`, 94)
      s.smonBank = bank
      const size = (bytes.length & 1 ? bytes.length + 1 : bytes.length) + 8
      rt.reserveBank(bank, size, SMON_BANK_NAME, true, true)
      const data = rt.memBanks.get(bank)!.data
      data.set(bytes.subarray(0, Math.min(bytes.length, data.length)))
      if (String.fromCharCode(...data.subarray(SMON_MAGIC_AT, SMON_MAGIC_AT + 3)) !== SMON_MAGIC) {
        rt.eraseBank(bank)
        dmeErr(39)
      }
    },

    /** Smon Play bank --- routine 142 ($55e8) into routine 143, on the bank NAME */
    'smon play'(it) {
      const arg = it.evalInt()
      const s = st()
      s.smonPlaying = false
      s.smon.stop()
      const bank = arg === PTM_CURRENT_BANK ? s.smonBank : arg
      const b = rt.memBanks.get(bank)
      if (!b || b.name.padEnd(8).slice(0, 8) !== SMON_BANK_NAME) dmeErr(39)
      const song = parseSmon(b!.data)
      if (!song) dmeErr(39)
      s.smon.load(song!)
      s.smonPlaying = true
      s.smonStarted = true
    },

    /** Smon Stop --- routine 141 ($55c8): the flag at $94(a0), then LVO -36 */
    'smon stop'() {
      const s = st()
      if (!s.smonPlaying) return
      s.smonPlaying = false
      s.smon.stop()
    },

    /** Smon Cont --- routine 154 ($5854): `tst.b $94(a0) / bne`, then LVO -84 */
    'smon cont'() {
      const s = st()
      if (s.smonPlaying) return
      if (!s.smonStarted) return
      s.smonPlaying = true
      s.smon.cont()
    },

    /** Smon Volume n --- routine 152 ($5806): 0..64, then LVO -72 */
    'smon volume'(it) {
      const v = it.evalInt()
      if (v < 0 || v > 0x40) badCall()
      st().smon.master = v
    },

    /** Smon Voice mask --- routine 153 ($5838), unchecked, straight to LVO -78 */
    'smon voice'(it) {
      st().smon.setVoices(it.evalInt())
    },

    /**
     * Smon Next Patt / Smon Prev Patt --- routines 148 ($5760) and 149
     * ($5786), message 48 when nothing is playing, into LVO -48 and -54.
     */
    'smon next patt'() {
      const s = st()
      if (!s.smonPlaying) dmeErr(48)
      s.smon.nextPattern()
    },
    'smon prev patt'() {
      const s = st()
      if (!s.smonPlaying) dmeErr(48)
      s.smon.prevPattern()
    },

    /**
     * S3m Load file$,bank --- routine 64 ($453c).
     *
     * The only DME loader that does NOT ask for chip: `moveq #$1,d1` at $456c
     * is Data alone, because ScreamTracker mixes in software and Paula only
     * ever sees the four buffers the library AllocVecs for itself. Every other
     * format here reserves Data plus Chip.
     */
    's3m load'(it) {
      const path = it.evalStr()
      it.expect(',')
      const bank = it.evalInt()
      const s = st()
      if (bank >= 0x10000) badCall()
      if (bank === s.s3mBank && s.s3mPlaying) {
        s.s3mPlaying = false
        s.s3m.stop()
      }
      const bytes = rt.vfs?.readFile(path) ?? rt.fs?.read(path) ?? null
      if (!bytes) throw new AmosError(`file not found: ${path}`, 94)
      s.s3mBank = bank
      const size = (bytes.length & 1 ? bytes.length + 1 : bytes.length) + 8
      rt.reserveBank(bank, size, S3M_BANK_NAME, true, false)
      const data = rt.memBanks.get(bank)!.data
      data.set(bytes.subarray(0, Math.min(bytes.length, data.length)))
      if (String.fromCharCode(...data.subarray(S3M_MAGIC_AT, S3M_MAGIC_AT + 4)) !== S3M_MAGIC) {
        rt.eraseBank(bank)
        dmeErr(39)
      }
    },

    /**
     * S3m Play [bank] --- routine 67 ($4632) into 68, on the bank NAME.
     *
     * DEFECT: three of ScreamTracker's commands are dead or wrong in this
     * library and a module that uses them plays differently here than it does
     * in ScreamTracker. `I` and `R` appear in neither dispatch table, so
     * tremor and tremolo do nothing. `H`, `U` and `K` read the command byte at
     * `$3(a2)` where the parameter is at `$4(a2)`, so `H` never bends at all
     * and `U` runs at a fixed speed of one and depth of five. And `Bxx` only
     * jumps when its target is AHEAD of the current order; backwards, $211d86
     * discards the target and the song restarts from zero. `src/amiga/s3mplay.ts`
     * carries the instructions.
     */
    's3m play'(it) {
      const arg = it.evalInt()
      const s = st()
      s.s3mPlaying = false
      s.s3m.stop()
      const bank = arg === PTM_CURRENT_BANK ? s.s3mBank : arg
      const b = rt.memBanks.get(bank)
      if (!b || b.name.padEnd(8).slice(0, 8) !== S3M_BANK_NAME) dmeErr(39)
      const song = parseS3m(b!.data)
      if (!song) dmeErr(39)
      s.s3m.load(song!)
      s.s3mPlaying = true
      s.s3mStarted = true
    },

    /**
     * Xm Load file$,bank --- routine 51 ($41d0).
     *
     * `moveq #$1,d1` at $4200 is Data alone, the second loader here to ask for
     * no chip, and for the same reason ScreamTracker's does not: this library
     * mixes in software and Paula only ever sees the four buffers LVO -30
     * AllocMems for itself at $2101f2.
     *
     * The bank is checked TWICE and differently. $4248 compares four longs
     * against "Extended Module:" and accepts; failing that, $4262 masks the
     * long at $438 to its low three bytes and accepts "CHN", which is a
     * multi-channel ProTracker module. Anything else is erased and is message
     * 44. So the loader takes `4CHN` through `9CHN` but not `16CH` and not
     * `M.K.`, where the LIBRARY's own detect at $21098c takes all of `nCHN`,
     * `nnCH` and `TDZn` --- the extension is stricter than the thing it feeds.
     */
    'xm load'(it) {
      const path = it.evalStr()
      it.expect(',')
      const bank = it.evalInt()
      const s = st()
      if (bank >= 0x10000) badCall()
      // $41e8: reloading the bank that is playing stops it first
      if (bank === s.xmBank && s.xmPlaying) {
        s.xmPlaying = false
        s.xm.stop()
      }
      const bytes = rt.vfs?.readFile(path) ?? rt.fs?.read(path) ?? null
      if (!bytes) throw new AmosError(`file not found: ${path}`, 94)
      s.xmBank = bank
      const size = (bytes.length & 1 ? bytes.length + 1 : bytes.length) + 8
      rt.reserveBank(bank, size, XM_BANK_NAME, true, false)
      const data = rt.memBanks.get(bank)!.data
      data.set(bytes.subarray(0, Math.min(bytes.length, data.length)))
      const magic = String.fromCharCode(...data.subarray(0, XM_MAGIC.length))
      if (magic === XM_MAGIC) return
      const tag =
        ((data[XM_MOD_MAGIC_AT + 1] ?? 0) << 16) |
        ((data[XM_MOD_MAGIC_AT + 2] ?? 0) << 8) |
        (data[XM_MOD_MAGIC_AT + 3] ?? 0)
      if (tag === XM_MOD_MAGIC) return
      rt.eraseBank(bank)
      dmeErr(XM_NOT_A_MODULE)
    },

    /**
     * Xm Play [bank] --- routine 54 ($42f8) into 55, on the bank NAME.
     *
     * Routine 55 takes TWO parameters and the token table offers one. $42f8
     * pushes $80000000 for the second, $4354 turns that back into a start
     * order of zero, and nothing anywhere pushes anything else, so the order
     * is always zero and the rest of $4354 is unreachable. The first
     * parameter still uses the empty-argument convention: `Xm Play ,` leaves
     * $80000000 on the stack and $4314 substitutes the bank `Xm Load` filled.
     *
     * DEVIATION: a bank holding a `nCHN` ProTracker module loads and then
     * plays nothing. The library has a second sequencer for those --- $213874
     * initialises it and $2139a8 is its tick, chosen by `$c4(a5)` at $210a4e
     * --- and this port has only the FastTracker one. The library answers a
     * module it cannot identify by returning zero from $21096a and starting
     * no interrupt, which is silence rather than an error, so silence is what
     * a MOD gets here too.
     *
     * DEFECT: three effects are computed and thrown away. Arpeggio and
     * vibrato store their period into `$10(a4)` and tremolo its volume into
     * `$12(a4)`, and the pass at $211bf4 that runs after every tick rewrites
     * both registers from the channel block before the mixer reads them. A
     * module that leans on `0xy`, `4xy` or `7xy` plays those notes flat and
     * unmodulated. Tremor is in neither dispatch table and `Xxy` is past the
     * end of both. `src/amiga/xmplay.ts` carries the instruction bytes.
     */
    'xm play'(it) {
      const arg = it.evalInt()
      const s = st()
      s.xmPlaying = false
      s.xm.stop()
      const bank = arg === PTM_CURRENT_BANK ? s.xmBank : arg
      const b = rt.memBanks.get(bank)
      if (!b || b.name.padEnd(8).slice(0, 8) !== XM_BANK_NAME) dmeErr(XM_NOT_A_MODULE)
      s.xmBank = bank
      const song = parseXm(b!.data)
      if (!song) return
      s.xm.load(song)
      s.xmPlaying = true
      s.xmStarted = true
    },

    /** Xm Stop --- routine 53 ($42d8): the flag at $f2(a0), then LVO -36 */
    'xm stop'() {
      const s = st()
      if (!s.xmPlaying) return
      s.xmPlaying = false
      s.xm.stop()
    },

    /**
     * Xm Volume n --- routine 60 ($448c), 0 to 64 and an illegal argument
     * outside it, into LVO -48.
     *
     * $2103a8 is `mulu.w #$40,d0 / lsr.w #$6,d0`, which is d0 for every value
     * the range check lets through. The library multiplies by 64 and divides
     * by 64 and stores what it was given.
     */
    'xm volume'(it) {
      const v = it.evalInt()
      if (v < 0 || v > 0x40) badCall()
      st().xm.setMaster(v)
    },

    /**
     * Xm Next Patt / Xm Prev Patt --- routines 61 ($44be) and 62 ($44e4),
     * message 55 when nothing is playing, into LVO -60 and -54.
     *
     * $210838 rewinds with `subq.w #$1,$cc(a5) / tst.w $cc(a5) / bgt`, so an
     * order of 1 does not land on 0: it lands on the module's restart
     * position. Only a rewind from order 2 or higher steps by one.
     */
    'xm next patt'() {
      const s = st()
      if (!s.xmPlaying) dmeErr(XM_NOT_INITIALIZED)
      s.xm.nextPattern()
    },
    'xm prev patt'() {
      const s = st()
      if (!s.xmPlaying) dmeErr(XM_NOT_INITIALIZED)
      s.xm.prevPattern()
    },

    /** S3m Stop --- routine 66 ($4612): the flag at $e6(a0), then LVO -36 */
    's3m stop'() {
      const s = st()
      if (!s.s3mPlaying) return
      s.s3mPlaying = false
      s.s3m.stop()
    },

    /**
     * S3m Next Patt / S3m Prev Patt --- routines 73 ($47a6) and 74 ($47cc),
     * message 27 when nothing is playing, into LVO -54 and -48.
     */
    's3m next patt'() {
      const s = st()
      if (!s.s3mPlaying) dmeErr(27)
      s.s3m.nextPattern()
    },
    's3m prev patt'() {
      const s = st()
      if (!s.s3mPlaying) dmeErr(27)
      s.s3m.prevPattern()
    },

    /**
     * Tfmx Load file$, bank --- routine 77 ($4856), the bank "TFMXMod " and
     * DATA plus CHIP (`moveq #$3,d1` at $4884), rounded up to even.
     *
     * TFMX normally ships as a PAIR of files and an AMOS bank holds one, so
     * DME wraps them in a container of its own. $48c4 wants "TFHD" and $48d8
     * masks the type to seven bits.
     *
     * DEFECT: a type 0 whose mdat has no "TFMX-SONG " banner is not refused.
     * $4900's `bne` and $4918's `beq` both leave by $491a, which writes
     * `move.b #$1,$ca(a2)` and returns success --- the banner test decides a
     * LABEL and never a rejection, so the only ways to fail this keyword are a
     * missing "TFHD" and a type of 3 or more.
     */
    'tfmx load'(it) {
      const path = it.evalStr()
      it.expect(',')
      const bank = it.evalInt()
      const s = st()
      if (bank >= 0x10000) badCall()
      if (bank === s.tfmxBank && s.tfmxPlaying) {
        s.tfmxPlaying = false
        s.tfmx.stop()
      }
      const bytes = rt.vfs?.readFile(path) ?? rt.fs?.read(path) ?? null
      if (!bytes) throw new AmosError(`file not found: ${path}`, 94)
      s.tfmxBank = bank
      const size = (bytes.length & 1 ? bytes.length + 1 : bytes.length) + 8
      rt.reserveBank(bank, size, TFMX_BANK, true, true)
      const data = rt.memBanks.get(bank)!.data
      data.set(bytes.subarray(0, Math.min(bytes.length, data.length)))
      if (!parseTfmx(data)) {
        rt.eraseBank(bank)
        dmeErr(29)
      }
    },

    /**
     * Tfmx Play [bank] --- routine 80 ($49a4) pushing $80000000 into routine
     * 81, which checks the bank NAME and then calls LVO -$24 with the mdat,
     * the smpl and the subsong, and LVO -$2a to start it.
     *
     * $49fc hands the library three things and no more, and everything else
     * the replay needs comes out of the mdat itself.
     */
    'tfmx play'(it) {
      const arg = it.evalInt()
      const s = st()
      s.tfmxPlaying = false
      s.tfmx.stop()
      const bank = arg === PTM_CURRENT_BANK ? s.tfmxBank : arg
      const b = rt.memBanks.get(bank)
      if (!b || b.name.padEnd(8).slice(0, 8) !== TFMX_BANK) dmeErr(29)
      const song = parseTfmx(b!.data)
      if (!song) dmeErr(29)
      s.tfmxBank = bank
      s.tfmx.load(song!)
      s.tfmx.play(0)
      s.tfmxPlaying = true
      s.tfmxStarted = true
    },

    /** Tfmx Stop --- routine 79 ($4984): the flag at $ba(a0), then LVO -$1e */
    'tfmx stop'() {
      const s = st()
      if (!s.tfmxPlaying) return
      s.tfmxPlaying = false
      s.tfmx.stop()
    },

    /**
     * Tfmx Cont --- routine 84 ($4aca): `tst.b $ba(a2) / bne`, then LVO -$30
     * with the sub-song `Tfmx Play` remembered at `$be(a2)`.
     */
    'tfmx cont'() {
      const s = st()
      if (s.tfmxPlaying) return
      if (!s.tfmxStarted) return
      s.tfmxPlaying = true
      s.tfmx.cont(0)
    },

    /**
     * Tfmx Volume n --- routine 85 ($4af4): 0..64 checked here, and then
     * $210264's `mulu.w #$40,d0 / lsr.w #$6,d0`, which is a round trip.
     */
    'tfmx volume'(it) {
      const v = it.evalInt()
      if (v < 0 || v > 0x40) badCall()
      st().tfmx.volume = v
    },

    /**
     * Tfmx Next Patt / Tfmx Prev Patt --- routines 90 ($4c58) and 89 ($4c32),
     * message 31 when nothing is playing, into LVO -$54 and -$4e.
     *
     * Both go through $211960, which clamps the new trackstep against the
     * SUBSONG's own first and last rather than the whole table's.
     */
    'tfmx next patt'() {
      const s = st()
      if (!s.tfmxPlaying) dmeErr(31)
      s.tfmx.seek(1)
    },
    'tfmx prev patt'() {
      const s = st()
      if (!s.tfmxPlaying) dmeErr(31)
      s.tfmx.seek(-1)
    },

    /**
     * Omed Load file$, bank --- routine 220 ($6902), the bank "OctaMed " and
     * DATA ALONE: `moveq #$1,d1` at $692e, the same choice `S3m Load` makes
     * and for the same reason. octaplayer mixes into four buffers it AllocVecs
     * for itself, so nothing Paula reads ever lives in the module.
     *
     * The extension's own magic test at $6964 takes MMD2, MMD1 and MMD0 and
     * NOT MMD3, which is narrower than the library behind it: $2159e0's accept
     * chain compares all four ids, and so does octamixplayer's at $3f8e.
     *
     * Then two library calls. LVO -$24 must answer 1 or the module is not 5-8
     * channel (message 9), and LVO -$2a answering 1 raises message 1,
     * "FastMem required" ($69f0, `moveq #$1,d0`). This port has one address
     * space and models a machine with fast memory, so the second never fires.
     */
    'omed load'(it) {
      const path = it.evalStr()
      it.expect(',')
      const bank = it.evalInt()
      const s = st()
      if (bank >= 0x10000) badCall()
      if (bank === s.omedBank && s.omedPlaying) {
        s.omedPlaying = false
        s.omed?.stop()
      }
      const bytes = rt.vfs?.readFile(path) ?? rt.fs?.read(path) ?? null
      if (!bytes) throw new AmosError(`file not found: ${path}`, 94)
      s.omedBank = bank
      const size = (bytes.length & 1 ? bytes.length + 1 : bytes.length) + 8
      rt.reserveBank(bank, size, OMED_BANK_NAME, true, false)
      const data = rt.memBanks.get(bank)!.data
      data.set(bytes.subarray(0, Math.min(bytes.length, data.length)))
      if (!/^MMD[0-2]$/.test(String.fromCharCode(...data.subarray(0, 4)))) {
        rt.eraseBank(bank)
        dmeErr(8)
      }
    },

    /**
     * Omed Play [bank] --- routine 223 ($6a4a) pushing $80000000 into routine
     * 224, which checks the bank NAME and then calls LVO -$4e with the
     * sub-song and LVO -$30 with the module.
     *
     * The sub-song is always that sentinel here, so `$6aa4`'s `moveq #$0,d0`
     * is what reaches the library. DME declares a second, unnamed form at
     * token $f2 with spec "I0,0" that would carry one; the port follows
     * `Dmed Play` and wires only the named keyword, so `=Omed Subsongs` can
     * count sub-songs that `Omed Play` has no way to select.
     */
    'omed play'(it) {
      const arg = it.evalInt()
      const s = st()
      s.omedPlaying = false
      s.omed?.stop()
      const bank = arg === PTM_CURRENT_BANK ? s.omedBank : arg
      const b = rt.memBanks.get(bank)
      if (!b || b.name.padEnd(8).slice(0, 8) !== OMED_BANK_NAME) dmeErr(8)
      s.omedBank = bank
      const player = omedFor(rt, s)
      player.play(bank, 0)
      s.omedPlaying = true
      s.omedStarted = true
    },

    /**
     * Omix Load file$,bank --- routine 237 ($6d70), a Data-only bank named
     * "OctaMix " and the file length plus eight with NO rounding to even,
     * which is the one loader here that does not.
     *
     * The content test is in two halves and the second is the whole story of
     * this block. $6dd6 takes "MMD3" or "MMD2" and nothing else, message 6
     * otherwise. Then $6df2 relocates through LVO -30 and $6df8 asks LVO -36
     * what kind of module it is, and $6dfc demands the answer TWO. That is
     * `mmdMixType`, and it is one bit: bit 7 of `flags2`. A module in
     * four-channel or eight-channel mode is erased and is message 10 however
     * many tracks it has.
     *
     * DEVIATION: LVO -30 relocates the bank in place, adding the load address
     * to every stored offset. A bank here is already based at zero so nothing
     * needs adding, and the bank is left exactly as the file was --- which a
     * program could see by `Peek`ing it after a load.
     */
    'omix load'(it) {
      const path = it.evalStr()
      it.expect(',')
      const bank = it.evalInt()
      const s = st()
      if (bank >= 0x10000) badCall()
      if (bank === s.omixBank && s.omixPlaying) {
        s.omixPlaying = false
        s.omix?.stop()
      }
      const bytes = rt.vfs?.readFile(path) ?? rt.fs?.read(path) ?? null
      if (!bytes) throw new AmosError(`file not found: ${path}`, 94)
      s.omixBank = bank
      // $6da4 is `move.l d6,d2 / addq.l #$8,d2` and nothing else
      rt.reserveBank(bank, bytes.length + 8, OMIX_BANK_NAME, true, false)
      const data = rt.memBanks.get(bank)!.data
      data.set(bytes.subarray(0, Math.min(bytes.length, data.length)))
      const id = String.fromCharCode(...data.subarray(0, 4))
      if (id !== 'MMD3' && id !== 'MMD2') {
        rt.eraseBank(bank)
        dmeErr(OMIX_NOT_A_MODULE)
      }
      if (mmdMixType(data) !== 2) {
        rt.eraseBank(bank)
        dmeErr(OMIX_NOT_MIXING)
      }
    },

    /**
     * Omix Play [bank[,subsong]] --- routine 240 ($6e9e) into 241, on the bank
     * NAME rather than on the id.
     *
     * Unlike every other `Play` in this extension the second parameter is
     * REAL: the token table declares an unnamed "I0,0" variant at $01d4, and
     * $6efa passes it to LVO -84 as the sub-song before LVO -54 starts the
     * module. `Omix Play 5` is sub-song zero and `Omix Play 5,2` is the third.
     */
    'omix play'(it) {
      const first = it.evalInt()
      const song = it.accept(',') ? it.evalInt() : 0
      const s = st()
      s.omixPlaying = false
      s.omix?.stop()
      const bank = first === PTM_CURRENT_BANK ? s.omixBank : first
      const b = rt.memBanks.get(bank)
      if (!b || b.name.padEnd(8).slice(0, 8) !== OMIX_BANK_NAME) dmeErr(OMIX_NOT_A_MODULE)
      s.omixBank = bank
      const player = omixFor(rt, s)
      player.omixSubsong = song
      player.play(bank, song)
      s.omixPlaying = true
      s.omixStarted = true
    },

    /** Omix Stop --- routine 239 ($6e7e): the flag at $6e(a0), then LVO -72 */
    'omix stop'() {
      const s = st()
      if (!s.omixPlaying) return
      s.omixPlaying = false
      s.omix?.stop()
    },

    /** Omix Cont --- routine 244 ($6fd4): needs $6a(a0) set and $6e clear */
    'omix cont'() {
      const s = st()
      if (s.omixPlaying) return
      if (!s.omixStarted) return
      s.omixPlaying = true
      s.omix?.cont()
    },

    /**
     * Omix 14 Bit On / Off --- routines 245 ($7002) and 246 ($702e), both into
     * LVO -102, and both message 20 while something is playing.
     *
     * DEVIATION: the flag is kept and never acted on. $21183c picks one of four
     * interrupt-and-converter pairs on it, and the 14-bit pair splits each
     * sample into a high byte on one Paula pair and six low bits on the other
     * at volume 1. `AudioSink` has one volume a voice and no way to sum two
     * voices at a 64:1 ratio, so this port plays the 8-bit conversion either
     * way. What a program can see is the flag and the error; what it cannot
     * hear is the extra six bits.
     */
    'omix 14 bit on'() {
      const s = st()
      if (s.omixPlaying) dmeErr(OMIX_14BIT_BUSY)
      omixFor(rt, s).omix14Bit = true
    },
    'omix 14 bit off'() {
      const s = st()
      if (s.omixPlaying) dmeErr(OMIX_14BIT_BUSY)
      omixFor(rt, s).omix14Bit = false
    },

    /**
     * Omix Freq n --- routine 247 ($705a), 1,000 to 65,535 and an AMOS error
     * 23 outside it, message 21 while playing, into LVO -96.
     *
     * It is a REQUEST. $213610 turns it into a whole Paula period and $21365c
     * divides the clock by that period again, and the second number is the one
     * the mixer and the tempo actually use.
     */
    'omix freq'(it) {
      const v = it.evalInt()
      if (v < OMIX_MIN_RATE || v > OMIX_MAX_RATE) badCall()
      const s = st()
      if (s.omixPlaying) dmeErr(OMIX_FREQ_BUSY)
      omixFor(rt, s).omixRequestedRate = v
    },

    /**
     * Omix Buffer n --- routine 248 ($709a), 4 to 32,764, message 22 while
     * playing, into LVO -90.
     *
     * DEVIATION: kept and not acted on. On the machine it is AUD0LEN and
     * therefore the interrupt rate, and the mixer splices the sequencer against
     * it at $2119be; this port mixes a whole tick at a time, so the buffer
     * changes nothing it can hear. The range check and the error are real.
     */
    'omix buffer'(it) {
      const v = it.evalInt()
      if (v < OMIX_MIN_BUFFER || v > OMIX_MAX_BUFFER) badCall()
      const s = st()
      if (s.omixPlaying) dmeErr(OMIX_BUFFER_BUSY)
      omixFor(rt, s).omixBuffer = v
    },

    /**
     * Omix Next Patt / Omix Prev Patt --- routines 253 ($71a2) and 254
     * ($71c8), message 54 when nothing is playing, into LVO -108 and -114.
     */
    'omix next patt'() {
      const s = st()
      if (!s.omixPlaying) dmeErr(OMIX_NOT_INITIALIZED)
      s.omix?.octaNextPatt()
    },
    'omix prev patt'() {
      const s = st()
      if (!s.omixPlaying) dmeErr(OMIX_NOT_INITIALIZED)
      s.omix?.octaPrevPatt()
    },

    /** Omed Stop --- routine 222 ($6a2a): the flag at $60(a0), then LVO -$42 */
    'omed stop'() {
      const s = st()
      if (!s.omedPlaying) return
      s.omedPlaying = false
      s.omed?.stop()
    },

    /** Omed Cont --- routine 228 ($6be8): `tst.b $60(a0) / bne`, then LVO -$48 */
    'omed cont'() {
      const s = st()
      if (s.omedPlaying) return
      if (!s.omedStarted) return
      s.omedPlaying = true
      s.omed?.cont()
    },

    /**
     * Omed Hq On / Omed Hq Off --- routines 229 ($6c16) and 230 ($6c42), both
     * into LVO -$54, and both raise message 19 when something is PLAYING.
     *
     * `tst.b $60(a0) / bne` is the guard, so the quality is chosen before the
     * module starts and never during it. That is not a policy: the flag
     * decides AUDxPER and the buffer length together ($211ba2 and $211676), so
     * changing it under a running DMA would change the tick rate mid-buffer.
     */
    'omed hq on'() {
      const s = st()
      if (s.omedPlaying) dmeErr(19)
      omedFor(rt, s).hq = true
    },
    'omed hq off'() {
      const s = st()
      if (s.omedPlaying) dmeErr(19)
      omedFor(rt, s).hq = false
    },

    /**
     * Omed Next Patt / Omed Prev Patt --- routines 234 ($6cf2) and 235
     * ($6d18), message 53 when nothing is playing, into LVO -$5a and -$60.
     *
     * Neither is a plain seek, and they are not each other's mirror. `med.ts`
     * carries $210230 and $21028e instruction for instruction.
     */
    'omed next patt'() {
      const s = st()
      if (!s.omedPlaying) dmeErr(53)
      omedFor(rt, s).octaNextPatt()
    },
    'omed prev patt'() {
      const s = st()
      if (!s.omedPlaying) dmeErr(53)
      omedFor(rt, s).octaPrevPatt()
    },

    /** S3m Volume n --- routine 75 ($47f2): 0..64, then LVO -60 */
    's3m volume'(it) {
      const v = it.evalInt()
      if (v < 0 || v > 0x40) badCall()
      st().s3m.master = v
    },

    /**
     * Sid Load file$, bank --- routine 256 ($7220), the same nine steps as
     * `Ptm Load` with a different tag.
     *
     * `Rbsr routine 261` runs FIRST, so a machine with no `playsid.library`
     * raises message 15 before the file is opened rather than after. The bank
     * pops first (`move.l (a3)+,d3 / cmp.l #$10000,d3`), reloading the bank
     * that is currently playing stops it, and the bank is a Work bank named
     * "PSid    " sized as the file rounded up to even plus eight.
     *
     * The guide is explicit that a two-part module is not accepted: "It's only
     * possible to load PlaySid mod's - One File Format - (no Data/Icon
     * Files)." That is why DME never calls `ReadIcon`, the one public LVO of
     * the library's fifteen that no keyword here reaches.
     *
     * The only check on the contents is `cmpi.l #$50534944,(a2)` at $728c ---
     * the 'PSID' magic and nothing else. The header's version, its data
     * offset and its song count are all `CheckModule`'s business, and
     * `Sid Load` never calls it. A failed tag ERASES the bank ($72a0) before
     * raising message 13, so a bad load leaves nothing behind.
     */
    'sid load'(it) {
      const path = it.evalStr()
      it.expect(',')
      const bank = it.evalInt()
      const s = st()
      openPlaySid(s)
      if (bank >= 0x10000) badCall()
      if (bank === s.sidBank && s.sidPlaying) sidStop(s)
      const bytes = rt.vfs?.readFile(path) ?? rt.fs?.read(path) ?? null
      if (!bytes) throw new AmosError(`file not found: ${path}`, 94)
      s.sidBank = bank
      const size = (bytes.length & 1 ? bytes.length + 1 : bytes.length) + 8
      rt.reserveBank(bank, size, SID_BANK_NAME, true, true)
      const data = rt.memBanks.get(bank)!.data
      data.set(bytes.subarray(0, Math.min(bytes.length, data.length)))
      const magic = (data[0]! << 24) | (data[1]! << 16) | (data[2]! << 8) | data[3]!
      if ((magic >>> 0) !== PSID_MAGIC) {
        rt.eraseBank(bank)
        dmeErr(SID_NOT_A_MODULE)
      }
    },

    /**
     * Sid Play bank [, song] --- routines 259 ($7314) and 260 ($731a).
     *
     * Two entries, because the token table's `!sid play` carries a $FE
     * terminator and the nameless `I0,0` row after it is the two-argument
     * variant. The one-argument form is six bytes: `clr.l -(a3)` pushes a
     * zero song and falls into the other, so `Sid Play 3` IS
     * `Sid Play 3,0`.
     *
     * DME's song number is ZERO-based and the library's is one-based:
     * $7398 is `addq.l #$1,d7` before `jsr -$3c(a6)`. So `Sid Play b,0` asks
     * `StartSong(1)`, and DME's own example walks `SUB` from 0 up to
     * `Sid Songs - 1`. A bank of `$80000000` means the one `Sid Load` last
     * used, which is the same sentinel `Ptm Play` takes.
     *
     * Then five library calls in order, at $736e to $739c:
     *
     *     -30  AllocEmulResource   and its result is NEVER TESTED
     *     -96  SetVertFreq         60 on an NTSC machine, 50 otherwise
     *     -54  SetModule           a2 as BOTH header and body, the one-part case
     *     -60  StartSong           the song plus one
     *
     * DEFECT: `AllocEmulResource` returns `SID_LIBINUSE` when the resource is
     * already held and DME ignores it, along with every other error the four
     * calls can return. The audible effect is nil --- the library tolerates
     * being asked twice, which is why $73a0 goes on to record the module
     * regardless --- but a genuine out-of-memory would be silent.
     */
    'sid play'(it) {
      const first = it.evalInt()
      const song = it.accept(',') ? it.evalInt() : 0
      const s = st()
      const bank = first === PTM_CURRENT_BANK ? s.sidBank : first
      const b = rt.memBanks.get(bank)
      if (!b || b.name.padEnd(8).slice(0, 8) !== SID_BANK_NAME) dmeErr(SID_NOT_A_MODULE)
      openPlaySid(s)
      s.sid.allocEmulResource()
      // $7372: `jsr $12c(a0)` is AMOS's own NTSC call and `tst.w d1` picks
      // $3c or $32. `FnNTSC` returns 0 here --- the emulated machine is PAL
      // and instr.ts says so --- so this arm is the only reachable one.
      s.sid.setVertFreq(PAL_VERT_FREQ)
      s.sid.setModule(b!.data)
      s.sid.startSong((song + 1) & 0xffff)
      s.sidBank = bank
      s.sidPlaying = true
    },

    /**
     * Sid Stop --- routine 258 ($72e8), and it does two things rather than one.
     *
     * `jsr -$42(a6)` is `StopSong` and `jsr -$24(a6)` right after it is
     * `FreeEmulResource`, so stopping gives the 320KB back. That is why
     * `Sid Play` allocates again every time instead of once.
     */
    'sid stop'() {
      sidStop(st())
    },

    /**
     * Sid Pause --- routine 264 ($746c), into LVO -72 `PauseSong`.
     *
     * Guarded on the extension's own flag rather than on the library's
     * `PlayMode`, so pausing something already paused does nothing and
     * cannot reach the library's `SID_NOPAUSE`.
     */
    'sid pause'() {
      const s = st()
      if (!s.sidPlaying) return
      s.sidPlaying = false
      s.sid.pauseSong()
    },

    /** Sid Cont --- routine 263 ($7446), into LVO -78 `ContinueSong` */
    'sid cont'() {
      const s = st()
      if (s.sidPlaying) return
      s.sidPlaying = true
      s.sid.continueSong()
    },

    /**
     * Sid Forward --- routine 265 ($7490): `ForwardSong(16)`, and the 16 is
     * the extension's, not the caller's.
     *
     * `moveq #$0,d0 / move.w #$10,d0` at $74a2 is a fixed sixteen, which is
     * why the keyword takes no argument where the library's LVO does. Nothing
     * playing is message 16.
     */
    'sid forward'() {
      const s = st()
      if (!s.sidPlaying) dmeErr(SID_NOT_INITIALIZED)
      s.sid.forwardSong(SID_FORWARD_STEPS)
    },

    /**
     * Sid Rewind --- routine 266 ($74bc): `SetReverseEnable(1)` and then
     * `RewindSong(32)`, twice Forward's step.
     *
     * Setting the reverse flag first is what playsid's own developer notes
     * require of RewindSong, and DME is the reason the flag has no keyword of
     * its own: nothing else in the extension ever writes it. The guide says
     * only "Use this command to rewind a currently replaying Sid-Song."
     */
    'sid rewind'() {
      const s = st()
      if (!s.sidPlaying) dmeErr(SID_NOT_INITIALIZED)
      s.sid.setReverseEnable(true)
      s.sid.rewindSong(SID_REWIND_STEPS)
    },

    /**
     * Sid Channel n --- routine 267 ($74ec), and it is the extension's one
     * broken keyword.
     *
     * The range check is real: `cmp.l #$4,d7 / Rbhi` and `cmp.l #$1,d7 /
     * Rblt` make anything outside 1 to 4 an AMOS error 23, and the guide
     * states the intent --- "With this command you can choose,how many
     * channels you will use for replaying Sid-Song."
     *
     * DEFECT: `SetChannelEnable` takes a POINTER to four 16-bit booleans ---
     * `void SetChannelEnable( BOOL flags[4] )` in Developer.doc, and
     * `$2102e8` copies eight bytes from A0. $7518 is `movea.l d7,a0`, which
     * puts the COUNT in the address register. So the library reads its four
     * flags from address 1, 2, 3 or 4, which on a real machine is the reset
     * vectors and SysBase; on a 68000 the odd two are an address error as
     * well. The keyword cannot do what its own example says it does.
     *
     * DEVIATION: nothing is mapped at address 1 to 4 here, so rather than
     * invent bytes this enables all four channels, which is the state the
     * library was in before the call. The range check, the error and the
     * `SetReverseEnable(1)` at $7512 are all reproduced, because those are
     * the parts of the keyword that work.
     */
    'sid channel'(it) {
      const n = it.evalInt()
      const s = st()
      openPlaySid(s)
      if (n < 1 || n > 4) badCall()
      s.sid.setReverseEnable(true)
      s.sid.setChannelEnable([true, true, true, true])
    },
  }
}

export function makeDmeFunctions(rt: Runtime): Record<string, Func> {
  const st = (): DmeState => rt.dme

  return {

    /**
     * =Thx Subsongs(bank) — routine 192 ($611a): the byte at $d of the
     * module, read out of the BANK rather than the replay, and the bank's
     * name is checked as two longs (`THX ` and four spaces).
     */
    'thx subsongs': (_, a) => {
      const bank = Number(a[0]!.k === 'str' ? 0 : a[0]!.n) | 0
      const b = rt.memBanks.get(bank)
      if (!b || b.name.padEnd(8).slice(0, 8) !== THX_BANK_NAME) dmeErr(23)
      return VI(b!.data[THX_SUBSONGS_AT] ?? 0)
    },

    /**
     * =Sid Songs(bank) --- routine 268 ($7524), the block's only function.
     *
     * `L_Bnk_OrAdr` on the bank, the "PSid    " name checked as two longs at
     * -$8 and -$4, then `move.b $f(a2),d3`: one byte out of the BANK, not out
     * of the library, so it answers without a module being set. A bank that
     * is not a PSid is message 13.
     *
     * It reads the header's song count at $0e as a BYTE from $0f, which is
     * the low half. `SIDHeader.number` is a UWORD, so a file with 256 songs
     * would report zero. Nothing has more than twelve.
     */
    'sid songs': (_, a) => {
      const bank = Number(a[0]!.k === 'str' ? 0 : a[0]!.n) | 0
      const b = rt.memBanks.get(bank)
      if (!b || b.name.padEnd(8).slice(0, 8) !== SID_BANK_NAME) dmeErr(SID_NOT_A_MODULE)
      return VI(b!.data[SID_SONGS_AT] ?? 0)
    },

    /**
     * =Thx End — routine 193 ($6156), and it READS AND CLEARS: `move.b
     * $3(a3),d0 / tst.b d0 / beq / move.l d0,d3 / clr.b $3(a3)`.
     *
     * `move.l d0,d3` with d0 a zero-extended byte, so 255 again.
     *
     * The same as `=Ptm End`, then. THX 0.6 --- a different extension over
     * the same format --- latches instead and only StartSong clears it, so
     * the divergence is between the two ports rather than inside this one.
     */
    'thx end': () => {
      const s = st()
      const out = s.thx.ended
      if (out) s.thx.ended = false
      return VI(out ? 0xff : 0)
    },

    /** =Thx Song Length(bank) — routine 195 ($61b0) */
    'thx song length': (_, a) => {
      const bank = Number(a[0]!.k === 'str' ? 0 : a[0]!.n) | 0
      const b = rt.memBanks.get(bank)
      if (!b || b.name.padEnd(8).slice(0, 8) !== THX_BANK_NAME) dmeErr(23)
      return VI(thxParse(b!.data).positions.length)
    },

    /** =Thx Song Pos — routine 196 ($61ec), the replayer's `$448(a6)` */
    'thx song pos': () => VI(st().thx.position),

    /**
     * =Thx Vu(n) — routine 200 ($634a). The THX replayer keeps no vumeter
     * bytes of its own, so this reads the voice's current volume rather than
     * a decayed peak, which is why it is not read-and-clear the way
     * `=Ptm Vu` is.
     */
    'thx vu': (_, a) => {
      const v = Number(a[0]!.k === 'str' ? -1 : a[0]!.n) | 0
      if (v < 0 || v >= 4) badCall()
      return VI(st().thx.channels[v]!.volume)
    },

    /** =P61 Song Pos — routine 275 ($7708), guarded by data+$42 as `=Ptm Song Pos` is */
    'p61 song pos': () => VI(st().p61Started ? st().p61.pos : 0),
    /** =P61 Patt Pos — routine 276 ($7726) */
    'p61 patt pos': () => VI(st().p61Started ? st().p61.row : 0),

    /**
     * =P61 Song Length — routine 280 ($77be): `move.w $2e(a0),d3` out of the
     * REPLAYER, not out of the bank.
     *
     * That is the one place the four blocks disagree about where a length
     * comes from: `=Ptm Song Length` and `=Thx Song Length` both take a bank
     * number and read the file, and this takes none and reads the running
     * replay.
     */
    'p61 song length': () => {
      const s = st()
      return VI(s.p61.song ? s.p61.song.positions.length : 0)
    },

    /**
     * =P61 Vu(n) — routine 279 ($7790): `jsr $14(a0)` into the replayer with
     * the voice in d1, so the level comes from Player 6.1A's own vumeter
     * rather than from a byte DME keeps.
     */
    'p61 vu': (_, a) => {
      const v = Number(a[0]!.k === 'str' ? -1 : a[0]!.n) | 0
      if (v < 0 || v >= 4) badCall()
      const s = st()
      const out = s.p61Vu[v]!
      s.p61Vu[v] = 0
      return VI(out)
    },

    /**
     * =Ptm Song Pos — routine 291 ($7a5a): `move.b -$c(a0),d3`.
     *
     * Guarded by `tst.b $129(a2)`, the has-ever-played flag, and answers 0
     * before the first `Ptm Play` rather than raising.
     */
    'ptm song pos': () => VI(st().ptmStarted ? st().ptm.pos : 0),

    /**
     * =Ptm Patt Pos — routine 292 ($7a7a): `move.w -$4(a0),d3 / lsr.w #$4`.
     *
     * The replayer keeps the row in the high nibble of a word, so the read
     * shifts it back down. Same guard, same zero.
     */
    'ptm patt pos': () => VI(st().ptmStarted ? st().ptm.row : 0),

    /**
     * =Ptm Song Length(bank) — routine 290 ($7a1e).
     *
     * It reads the BANK, not the running replay, so it answers for a module
     * that has never been played — and it checks the "Tracker " name first,
     * so a bank that is not one raises "Not a 4 channel module". The byte is
     * at $3b6, which is a ProTracker module's own song-length field.
     */
    'ptm song length': (_, a) => {
      const bank = Number(a[0]!.k === 'str' ? 0 : a[0]!.n) | 0
      const b = rt.memBanks.get(bank)
      if (!b || b.name.padEnd(8).slice(0, 8) !== PTM_BANK_NAME) notAModule()
      return VI(b!.data[PTM_SONG_LENGTH_AT] ?? 0)
    },

    /**
     * =Ptm Vu(n) — routine 293 ($7a9c): `move.b $a(a0,d7.w),d3` then
     * `clr.b` on the same byte.
     *
     * READ AND CLEARED, so two reads of one voice without a trigger between
     * them answer the level and then zero. `Rbmi` and `cmp.l #$4,d7 / Rbcc`
     * bound it to 0..3.
     */
    'ptm vu': (_, a) => {
      const v = Number(a[0]!.k === 'str' ? -1 : a[0]!.n) | 0
      if (v < 0 || v >= 4) badCall()
      const s = st()
      const out = s.ptmVu[v]!
      s.ptmVu[v] = 0
      return VI(out)
    },

    /**
     * =Ptm End — routine 296 ($7b5e): `cmpi.w #$ff,$e(a0)` when the song has
     * wrapped, and `clr.w $e(a0)` on the way out.
     *
     * It answers 255, not -1: `moveq #$0,d3 / move.b #$ff,d3` writes one byte
     * into a longword the `moveq` has already zeroed. `=Thx End` and
     * `=Sfx13 End` are all three written that way.
     *
     * Cleared by the read, which is the opposite of THX 0.6's `Thx End` —
     * that one latches and only StartSong clears it, so the same question
     * asked of two formats in this extension has two answers.
     */
    'ptm end': () => {
      const s = st()
      const out = s.ptmEnd
      s.ptmEnd = false
      return VI(out ? 0xff : 0)
    },

    /**
     * =Sfx13 Song Length — routine 131 ($5394), and it calls no library
     * vector: it takes the bank's address, checks the eight name bytes in
     * front of it against "SFX1" and ".3  ", and reads the byte at module+$212.
     *
     * So this one answers without the library loaded and without anything
     * playing, which none of the other three do.
     */
    'sfx13 song length': (_, a) => {
      const n = Number(a[0]!.k === 'str' ? 0 : a[0]!.n) | 0
      const bank = rt.memBanks.get(n)
      if (!bank || bank.name.padEnd(8).slice(0, 8) !== SFX_BANK_NAME) dmeErr(42)
      return VI(bank!.data[SFX_LENGTH_AT] ?? 0)
    },

    /**
     * =Sfx13 Song Pos — routine 132 ($53d4): guarded by the has-ever-played
     * byte at `$a1(a2)`, and 0 before the first `Sfx13 Play`.
     */
    'sfx13 song pos': () => VI(st().sfxStarted ? st().sfx.pos : 0),

    /**
     * =Sfx13 Vu(n) — routine 135 ($5450). `Rbmi` and `cmp.l #$4,d7 / Rbcc`,
     * so 0 to 3 and anything else is AMOS error 23.
     *
     * The library's LVO -48 reads the byte and clears it in one go
     * (`move.b (a2,d7.w),d1 / clr.b (a2,d7.w)`), so asking twice between two
     * notes gives the number and then zero.
     */
    'sfx13 vu': (_, a) => {
      const n = Number(a[0]!.k === 'str' ? -1 : a[0]!.n) | 0
      if (n < 0 || n >= 4) badCall()
      return VI(st().sfx.readVu(n))
    },

    /**
     * =Sfx13 End — routine 136 ($5482), read and cleared, and 255 rather than
     * -1: `moveq #$0,d3 / move.b #$ff,d3` leaves the top three bytes zero.
     * `=Ptm End` and `=Thx End` are written the same way in the same binary.
     *
     * The library sets the flag only where the position WRAPS at $210918, and
     * `Sfx13 Next Patt` walking off the end does not raise it.
     */
    'sfx13 end': () => VI(st().sfx.readEnd() ? 0xff : 0),

    /**
     * =Fc14 Song Length(bank) — routine 163 ($5a86), and like `=Sfx13 Song
     * Length` it calls no vector: it checks the bank name and then divides the
     * long at module+$4 by thirteen, which is the sequence in bytes over the
     * size of a step.
     */
    'fc14 song length': (_, a) => {
      const n = Number(a[0]!.k === 'str' ? 0 : a[0]!.n) | 0
      const bank = rt.memBanks.get(n)
      if (!bank || bank.name.padEnd(8).slice(0, 8) !== FC14_BANK_NAME) dmeErr(37)
      const d = bank!.data
      const len = (((d[4] ?? 0) << 24) | ((d[5] ?? 0) << 16) | ((d[6] ?? 0) << 8) | (d[7] ?? 0)) >>> 0
      return VI(Math.floor(len / FC14_STEP_BYTES))
    },

    /** =Fc14 Song Pos — routine 164 ($5ac6), guarded by $89(a2) and 0 before the first play */
    'fc14 song pos': () => VI(st().fc14Started ? st().fc14.position : 0),

    /** =Fc14 Vu(n) — routine 167 ($5b42), 0..3, read and cleared */
    'fc14 vu': (_, a) => {
      const n = Number(a[0]!.k === 'str' ? -1 : a[0]!.n) | 0
      if (n < 0 || n >= 4) badCall()
      return VI(st().fc14.readVu(n))
    },

    /** =Fc14 End — routine 168 ($5b74), read and cleared, and 255 for the same reason */
    'fc14 end': () => VI(st().fc14.readEnd() ? 0xff : 0),

    /**
     * =Fc13 Song Length(bank) — routine 179 ($5df2), the 1.4 routine with one
     * character of the bank name changed: it calls no vector either, and
     * divides the long at module+$4 by thirteen.
     */
    'fc13 song length': (_, a) => {
      const n = Number(a[0]!.k === 'str' ? 0 : a[0]!.n) | 0
      const bank = rt.memBanks.get(n)
      if (!bank || bank.name.padEnd(8).slice(0, 8) !== FC13_BANK_NAME) dmeErr(35)
      const d = bank!.data
      const len = (((d[4] ?? 0) << 24) | ((d[5] ?? 0) << 16) | ((d[6] ?? 0) << 8) | (d[7] ?? 0)) >>> 0
      return VI(Math.floor(len / FC13_STEP_BYTES))
    },

    /** =Fc13 Song Pos — routine 180 ($5e32), guarded by $7d(a2) and 0 before the first play */
    'fc13 song pos': () => VI(st().fc13Started ? st().fc13.position : 0),

    /** =Fc13 Vu(n) — routine 183 ($5eae), 0..3, read and cleared */
    'fc13 vu': (_, a) => {
      const n = Number(a[0]!.k === 'str' ? -1 : a[0]!.n) | 0
      if (n < 0 || n >= 4) badCall()
      return VI(st().fc13.readVu(n))
    },

    /** =Fc13 End — routine 184 ($5ee0), read and cleared, and 255 for the same reason */
    'fc13 end': () => VI(st().fc13.readEnd() ? 0xff : 0),

    /**
     * =Db Song Length(bank) — routine 119 ($50d4), which calls no vector: it
     * checks the bank name and reads ONE BYTE at module+$2f.
     */
    'db song length': (_, a) => {
      const n = Number(a[0]!.k === 'str' ? 0 : a[0]!.n) | 0
      const bank = rt.memBanks.get(n)
      if (!bank || bank.name.padEnd(8).slice(0, 8) !== DIGI_BANK_NAME) dmeErr(49)
      return VI(bank!.data[0x2f] ?? 0)
    },

    /** =Db Song Pos — routine 111 ($4f6e) into LVO -42 ($210206), a byte at $210958 */
    'db song pos': () => VI(st().digiStarted ? st().digi.position : 0),

    /** =Db Patt Pos — routine 112 ($4f9e) into LVO -84 ($210216), the row at $210959 */
    'db patt pos': () => VI(st().digiStarted ? st().digi.row & 0xff : 0),

    /**
     * =Digi End — routine 120 ($5110) into LVO -78 ($2102dc), read and
     * cleared, 255 for the same `move.b #$ff,d3` reason the other four have.
     * The keyword is spelt `Digi End` and every other one in the block `Db`.
     */
    'digi end': () => VI(st().digi.readEnd() ? 0xff : 0),

    /**
     * =Dmed Song Length(bank) — routine 212 ($6762), which calls no vector and
     * reads a DIFFERENT BYTE depending on the tag: `cmpi.l #$4d4d4432,(a2)`
     * sends MMD2 to $5d and everything else to $22f.
     */
    'dmed song length': (_, a) => {
      const n = Number(a[0]!.k === 'str' ? 0 : a[0]!.n) | 0
      const bank = rt.memBanks.get(n)
      if (!bank || bank.name.padEnd(8).slice(0, 8) !== DMED_BANK_NAME) dmeErr(7)
      const d = bank!.data
      const mmd2 = String.fromCharCode(...d.subarray(0, 4)) === MMD2_TAG
      return VI(d[mmd2 ? MMD2_SEQLEN_AT : DMED_SEQLEN_AT] ?? 0)
    },

    /** =Dmed Subsongs(bank) — routine 213 ($67ca), the `extra_songs` byte at $33 */
    'dmed subsongs': (_, a) => {
      const n = Number(a[0]!.k === 'str' ? 0 : a[0]!.n) | 0
      const bank = rt.memBanks.get(n)
      if (!bank || bank.name.padEnd(8).slice(0, 8) !== DMED_BANK_NAME) dmeErr(7)
      return VI(bank!.data[0x33] ?? 0)
    },

    /**
     * =Dmed Song Pos and =Dmed Patt Pos — routines 214 ($6806) and 215
     * ($682c), and NEITHER calls a vector: both take the bank's address and
     * read the module's own header, `pseqnum` at $2e and `pline` at $2c, which
     * medplayer.library writes back as it plays. Guarded by $54(a2), so both
     * answer zero before the first `Dmed Play`.
     */
    'dmed song pos': () => VI(st().dmedStarted ? (st().dmed?.hdrPseqnum ?? 0) : 0),
    'dmed patt pos': () => VI(st().dmedStarted ? (st().dmed?.hdrPline ?? 0) : 0),

    /**
     * =Tfmx Subsongs(bank) — routine 86 ($4b26), which is the walk at $2101e8
     * with one added at $4b84, and only when the walk answered something.
     *
     * The walk stops after the SECOND zero word it sees and answers one less
     * than that zero's index, which is right only for a table ending in two
     * zeroes. The module in `fixtures/` has a legitimate zero at index 2 with
     * six live songs behind it, so the walk says seven and the correction
     * makes it eight --- the right number, by a constant rather than by
     * counting. `src/amiga/tfmx.ts` carries the walk.
     */
    'tfmx subsongs': (_, a) => {
      const n = Number(a[0]!.k === 'str' ? 0 : a[0]!.n) | 0
      const bank = rt.memBanks.get(n)
      if (!bank || bank.name.padEnd(8).slice(0, 8) !== TFMX_BANK) dmeErr(29)
      const song = parseTfmx(bank!.data)
      if (!song) dmeErr(29)
      return VI(song!.subsongs === 0 ? 0 : song!.subsongs + 1)
    },

    /**
     * =Tfmx Song Length(bank) — routine 87 ($4b96) into LVO -$48, which is
     * $21035a: the subsong's end word less its start word, and nothing about
     * how many rows it actually plays.
     */
    'tfmx song length': (_, a) => {
      const n = Number(a[0]!.k === 'str' ? 0 : a[0]!.n) | 0
      const bank = rt.memBanks.get(n)
      if (!bank || bank.name.padEnd(8).slice(0, 8) !== TFMX_BANK) dmeErr(29)
      const song = parseTfmx(bank!.data)
      if (!song) dmeErr(29)
      // subsong 0, because `Tfmx Play` has no way to select another: routine
      // 80 pushes $80000000 for it and routine 81 turns that into a zero
      return VI((song!.end[0] ?? 0) - (song!.start[0] ?? 0))
    },

    /**
     * =Tfmx Song Pos — routine 88 ($4c02) into LVO -$42, gated on `$bc(a2)`,
     * the word `Tfmx Play` sets and nothing clears.
     */
    'tfmx song pos': () => VI(st().tfmxStarted ? st().tfmx.position : 0),

    /**
     * =Omed Song Length(bank) — routine 226 ($6b4a), which calls no vector and
     * reads ONE BYTE out of the bank at a fixed offset.
     *
     * Both offsets assume OctaMED Professional laid the file out the way it
     * always does, and neither follows a pointer. $6b8a reads $22f, which is
     * the low byte of `songlen` only if the song header sits at $34, right
     * behind the 52-byte module header. $6b9e reads $5d, which is the low byte
     * of the FIRST play sequence's length word only if that play sequence sits
     * at $34 instead. All three MMD2s in `fixtures/` do: the byte reads 9, 18
     * and 6, which are their play sequences to the entry.
     *
     * Being a byte, a song 256 positions long answers 0.
     *
     * The bank must be named "OctaMed " ($6b54 and $6b60 compare "Octa" and
     * "Med " at -$8 and -$4) or the answer is message 8.
     */
    'omed song length': (_, a) => {
      const n = Number(a[0]!.k === 'str' ? 0 : a[0]!.n) | 0
      const bank = rt.memBanks.get(n)
      if (!bank || bank.name.padEnd(8).slice(0, 8) !== OMED_BANK_NAME) dmeErr(8)
      const d = bank!.data
      return VI(d[String.fromCharCode(...d.subarray(0, 4)) === 'MMD2' ? 0x5d : 0x22f] ?? 0)
    },

    /**
     * =Omed Subsongs(bank) — routine 231 ($6c6e): the byte at $33, which is
     * `extra_songs` in the module header and so one LESS than the number of
     * songs the file holds.
     */
    'omed subsongs': (_, a) => {
      const n = Number(a[0]!.k === 'str' ? 0 : a[0]!.n) | 0
      const bank = rt.memBanks.get(n)
      if (!bank || bank.name.padEnd(8).slice(0, 8) !== OMED_BANK_NAME) dmeErr(8)
      return VI(bank!.data[MMD_EXTRA_SONGS_AT] ?? 0)
    },

    /**
     * =Omed Song Pos / =Omed Patt Pos — routines 232 ($6caa) and 233 ($6cce).
     *
     * Both read the live header words `$2e` and `$2c` that the library keeps
     * in the module while it plays, and both are gated on `$62(a2)`, the byte
     * `Omed Play` sets and nothing clears --- so they answer zero before the
     * first play and keep answering after a stop.
     */
    'omed song pos': () => VI(st().omedStarted ? (st().omed?.hdrPseqnum ?? 0) : 0),
    'omed patt pos': () => VI(st().omedStarted ? (st().omed?.hdrPline ?? 0) : 0),

    /**
     * =Omed Vu(n) — routine 236 ($6d3e), 0..7 and `Rbcc` to message 23 above
     * it, into LVO -$66. $210320 reads the byte and clears it in one go.
     */
    'omed vu': (_, a) => {
      const n = Number(a[0]!.k === 'str' ? -1 : a[0]!.n) | 0
      if (n < 0 || n >= 8) badCall()
      const s = st()
      const v = s.omedVu[n] ?? 0
      s.omedVu[n] = 0
      return VI(v)
    },

    /**
     * =Smon Song Length(bank) — routine 146 ($56f4), which calls no vector and
     * reads the WORD at module+$1e, the step count `InitModule` uses to size
     * everything after the header.
     */
    'smon song length': (_, a) => {
      const n = Number(a[0]!.k === 'str' ? 0 : a[0]!.n) | 0
      const bank = rt.memBanks.get(n)
      if (!bank || bank.name.padEnd(8).slice(0, 8) !== SMON_BANK_NAME) dmeErr(39)
      const d = bank!.data
      return VI(((d[0x1e] ?? 0) << 8) | (d[0x1f] ?? 0))
    },

    /** =Smon Song Pos — routine 147 ($5730) into LVO -42, guarded by $95(a2) */
    'smon song pos': () => VI(st().smonStarted ? st().smon.position : 0),

    /** =Smon Vu(n) — routine 150 ($57ac), 0..3, into LVO -60, read and cleared */
    'smon vu': (_, a) => {
      const n = Number(a[0]!.k === 'str' ? -1 : a[0]!.n) | 0
      if (n < 0 || n >= 4) badCall()
      return VI(st().smon.readVu(n))
    },

    /** =Smon End — routine 151 ($57de) into LVO -66, read and cleared, and 255 */
    'smon end': () => VI(st().smon.readEnd() ? 0xff : 0),

    /**
     * =S3m Song Length(bank) — routine 72 ($476a), which calls no vector and
     * reads the BYTE at module+$20.
     *
     * That field is a WORD, and the low half is the one this reads: a module
     * of 300 orders reports 44. Message 33 rather than 39 when the bank is not
     * a module, which is the only place in the port that number is used.
     */
    's3m song length': (_, a) => {
      const n = Number(a[0]!.k === 'str' ? 0 : a[0]!.n) | 0
      const bank = rt.memBanks.get(n)
      if (!bank || bank.name.padEnd(8).slice(0, 8) !== S3M_BANK_NAME) dmeErr(33)
      return VI(bank!.data[0x20] ?? 0)
    },

    /** =S3m Song Pos — routine 71 ($473a) into LVO -42, guarded by $e7(a2) */
    's3m song pos': () => VI(st().s3mStarted ? st().s3m.position : 0),

    /** =S3m Vu(n) — routine 76 ($4824), 0..31, into LVO -66, read and cleared */
    's3m vu': (_, a) => {
      const n = Number(a[0]!.k === 'str' ? -1 : a[0]!.n) | 0
      if (n < 0 || n >= 32) badCall()
      return VI(st().s3m.readVu(n))
    },

    /**
     * =Xm Song Length(bank) — routine 59 ($442e), which calls no vector and
     * reads a BYTE.
     *
     * Which byte depends on what the bank holds: $4478 takes $3b6 for a `CHN`
     * module, which is ProTracker's song length, and $446a takes $40 for an
     * XM, which is the LOW half of a little-endian word. A 256-order module
     * therefore reports 0. Message 44 when the bank is not named "XMmod   ".
     */
    'xm song length': (_, a) => {
      const n = Number(a[0]!.k === 'str' ? 0 : a[0]!.n) | 0
      const bank = rt.memBanks.get(n)
      if (!bank || bank.name.padEnd(8).slice(0, 8) !== XM_BANK_NAME) dmeErr(XM_NOT_A_MODULE)
      const d = bank!.data
      const tag = ((d[XM_MOD_MAGIC_AT + 1] ?? 0) << 16) | ((d[XM_MOD_MAGIC_AT + 2] ?? 0) << 8) | (d[XM_MOD_MAGIC_AT + 3] ?? 0)
      return VI(tag === XM_MOD_MAGIC ? (d[XM_MOD_LENGTH_AT] ?? 0) : (d[XM_LENGTH_AT] ?? 0))
    },

    /**
     * =Xm Song Pos — routine 58 ($43fe) into LVO -42, guarded by `$f3(a2)`.
     *
     * `Xm Stop` clears `$f2(a2)` and leaves `$f3(a2)` set, so the position
     * survives a stop and this keeps reporting the order the module was on.
     */
    'xm song pos': () => VI(st().xmStarted ? st().xm.position : 0),

    /** =Xm Vu(n) — routine 63 ($450a), 0..31, into LVO -66, read and cleared */
    'xm vu': (_, a) => {
      const n = Number(a[0]!.k === 'str' ? -1 : a[0]!.n) | 0
      if (n < 0 || n >= 32) badCall()
      return VI(st().xm.readVu(n))
    },

    /**
     * =Omix Song Length(bank) — routine 249 ($70da), which calls no vector.
     *
     * DEFECT: it answers only for an MMD3. $70fc is `cmpi.l #$4d4d4433,(a2) /
     * bne`, and the branch goes to the `rts` at $7116 WITHOUT setting d3 or d2
     * --- so on an MMD2, which is the other id `Omix Load` accepts, the
     * keyword returns whatever the expression stack happened to be holding.
     * This port answers 0 there rather than inventing a register's contents.
     *
     * The byte it reads for an MMD3 is at module+$5d, which is not a field any
     * MMD documentation names and is thirteen bytes past the end of the 52-byte
     * header. Reproduced as read.
     */
    'omix song length': (_, a) => {
      const n = Number(a[0]!.k === 'str' ? 0 : a[0]!.n) | 0
      const bank = rt.memBanks.get(n)
      if (!bank || bank.name.padEnd(8).slice(0, 8) !== OMIX_BANK_NAME) dmeErr(OMIX_NOT_A_MODULE)
      const d = bank!.data
      if (String.fromCharCode(...d.subarray(0, 4)) !== 'MMD3') return VI(0)
      return VI(d[OMIX_MMD3_LENGTH_AT] ?? 0)
    },

    /** =Omix Subsongs(bank) — routine 250 ($711e): the byte at module+$33 */
    'omix subsongs': (_, a) => {
      const n = Number(a[0]!.k === 'str' ? 0 : a[0]!.n) | 0
      const bank = rt.memBanks.get(n)
      if (!bank || bank.name.padEnd(8).slice(0, 8) !== OMIX_BANK_NAME) dmeErr(OMIX_NOT_A_MODULE)
      return VI(bank!.data[MMD_EXTRA_SONGS_AT] ?? 0)
    },

    /**
     * =Omix Song Pos — routine 251 ($715a), and it calls no vector either: it
     * takes the bank's address and reads `pseqnum` at $2e, which the replay
     * writes back into the module's own header as it plays. Guarded by
     * `$70(a2)`, which `Omix Stop` leaves set.
     */
    'omix song pos': () => {
      const s = st()
      if (!s.omixStarted) return VI(0)
      const bank = rt.memBanks.get(s.omixBank)
      return VI(bank ? ((bank.data[MMD_PSEQNUM_AT] ?? 0) << 8) | (bank.data[MMD_PSEQNUM_AT + 1] ?? 0) : 0)
    },

    /** =Omix Patt Pos — routine 252 ($717e), the same shape reading `pline` at $2c */
    'omix patt pos': () => {
      const s = st()
      if (!s.omixStarted) return VI(0)
      const bank = rt.memBanks.get(s.omixBank)
      return VI(bank ? ((bank.data[MMD_PLINE_AT] ?? 0) << 8) | (bank.data[MMD_PLINE_AT + 1] ?? 0) : 0)
    },

    /** =Omix Vu(n) — routine 255 ($71ee), 0..63, into LVO -120, read and cleared */
    'omix vu': (_, a) => {
      const n = Number(a[0]!.k === 'str' ? -1 : a[0]!.n) | 0
      if (n < 0 || n >= OMIX_MAX_CHANNELS) badCall()
      const s = st()
      const v = s.omixVu[n] ?? 0
      s.omixVu[n] = 0
      return VI(v)
    },

    /** =Dmed Vu(n) — routine 219 ($68d0), 0..3, into LVO -102, read and cleared */
    'dmed vu': (_, a) => {
      const n = Number(a[0]!.k === 'str' ? -1 : a[0]!.n) | 0
      if (n < 0 || n >= 4) badCall()
      const s = st()
      const v = s.dmedVu[n] ?? 0
      s.dmedVu[n] = 0
      return VI(v)
    },
  }
}

/**
 * One frame of the ProTracker replay.
 *
 * The machine hangs routine 299 off a CIA-B interrupt (routine 297 installs
 * it, 298 removes it) and this port has no interrupt to hang it off, so the
 * tick runs from the frame loop as every other replayer here does.
 */
export function dmeVbl(rt: Runtime): void {
  const s = rt.dme
  if (s.ptmPlaying) {
    const before = s.ptm.pos
    s.ptm.tick()
    // the end flag the replayer raises on a wrap; `=Ptm End` reads and clears it
    if (s.ptm.song && before > s.ptm.pos) s.ptmEnd = true
  }
  if (s.thxPlaying) s.thx.tick()
  if (s.p61Playing && !s.p61Paused) s.p61.tick()
  // SoundFX keeps its own play flag, because `Sfx13 Stop` clears the flag
  // INSIDE the replayer ($210668) rather than only removing the interrupt
  if (s.sfxPlaying) s.sfx.tick()
  if (s.fc14Playing) s.fc14.tick()
  if (s.fc13Playing) s.fc13.tick()
  // DigiBooster's CIA rate is the module's own and `Fxx` above $1f moves it,
  // so its ticks are counted against the frame rather than one to a frame
  if (s.smonPlaying) s.smon.tick()
  // ScreamTracker runs off a CIA at the module's tempo like DigiBooster, but
  // its own tick is a buffer of mix rather than a register write, so one frame
  // is one tick here and the tempo shows in the buffer length instead
  if (s.s3mPlaying) s.s3m.vbl()
  // OctaMix is the third OctaMED build: the same sequencer, and a tick that
  // is a span of software mix rather than a DMA buffer or a CIA underflow
  if (s.omixPlaying) s.omix?.vbl()
  // FastTracker is ScreamTracker's shape exactly: a CIA at the module's BPM,
  // and a tick that is a buffer of mix rather than a register write, so the
  // tempo shows in `samplesPerTick` and not in how often this comes round
  if (s.xmPlaying) s.xm.vbl()
  // MED drives itself off the frame count, as `runtime/medext.ts`'s copy does
  if (s.dmedPlaying) s.dmed?.vbl()
  // OctaMed is the same replay on a different clock: its tick is the end of a
  // DMA buffer rather than a CIA underflow, so `vbl` runs it at the buffer rate
  if (s.omedPlaying) s.omed?.vbl()
  // TFMX is CIA-B timer B, 50 Hz by default and up to 500 when a subsong names
  // a divisor, so its own `vbl` counts the interrupts a frame owes it
  if (s.tfmxPlaying) s.tfmx.vbl()
  // PlaySid runs the tune's own 6502 once a frame. `$210726` is hung off a
  // CIA timer whose reload `$210a46` picks as $376c (PAL, 709,379/50) or
  // $2e9c (NTSC), and the PSID speed bitmap chooses between the raster and
  // that timer per song. Both are 50Hz here, so a CIA-speed tune runs at the
  // raster's rate --- the same simplification every other replayer in this
  // file carries, and the reason `usesCia` is recorded but not acted on.
  if (s.sidPlaying) s.sid.tick()
  if (s.digiPlaying && s.digiUnpaused) {
    s.digiTime += 1 / VBL_HZ
    for (let guard = 0; guard < 64 && s.digiTime > 0; guard++) {
      s.digi.tick()
      s.digiTime -= 1 / s.digi.tickHz
    }
  }
}
