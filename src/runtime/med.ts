/**
 * The MED/OctaMED player behind Med Load/Play/Stop/Cont.
 *
 * The AMOS side (+Music.s:4456-4745) is thin plumbing over the external
 * medplayer.library (_MEDPlayModule and friends), which is not part of
 * the AMOS source but IS in the corpus, in sixteen places and three
 * builds. docs/medplayer/README.md is the read; src/cli/libdis.ts gets
 * from an LVO in +Music.s:2281-2293 to the code behind it, and the
 * addresses in this file are that build loaded at $210000.
 *
 * The keyword semantics come from +Music.s: bank handling, the MMD0/MMD1
 * magic check with bank erase on failure (error 189), Med Play stopping
 * samples/tracker/med first, Med Cont resuming only when stopped,
 * MedCheck killing the music when the bank vanishes.
 *
 * The replay is the library's. Both dispatch tables are ported entry by
 * entry: the row-tick table at $2109fe, 32 wide because MMD1 stores five
 * bits of command, and the per-tick table at $210daa. The pieces that are
 * NOT here, each because the machinery is missing rather than the reading:
 *
 * - MIDI, and only the half that would leave the machine. $210d4c sends a
 *   track marked MIDI to a second set of handlers and $210d54 sends every
 *   track from index 4 up there as well, so this library sounds four Paula
 *   voices whatever the block holds. THAT part is faithful. The handlers
 *   themselves have nowhere to send a message, so `Med Midi On` stores its
 *   flag and stops.
 *
 * Synthsounds and hybrids ARE here, and they are the two bytecode
 * interpreters at $2105d6 rather than an approximation of them.
 *
 * ## Two builds, one replay
 *
 * `MedPlayer` takes a build, because there are two libraries in this family
 * and DME 2.0 drives both. `medplayer` is everything above. `octaplayer` is
 * `DME_OctaMed.library`, which shares 69.2% of its bytes with the medplayer
 * build this file was read from --- the sixteen period tables at its $2123e2
 * are the same 3,264 bytes as medplayer's at $211fca --- and differs in
 * exactly five ways, all of them read off the binary and none inferred:
 *
 * - It plays MMD2, whose song header grew a section table and an array of
 *   named play sequences past $1f8. $211aca walks section, then play
 *   sequence, then block; the MMD0 path at $211af8 is still one byte out of
 *   `playseq[]`.
 * - It sounds up to EIGHT tracks. Track n+4 is mixed on top of track n rather
 *   than sent to MIDI, which is `mmd2mix.ts`.
 * - Its tick is a DMA buffer and not a CIA timer, so the tempo range
 *   collapses. `omedTickHz` replaces `medTickHz` for this build.
 * - It never reads `trkvol` at $302 or `mastervol` at $312. Both are dead in
 *   this build, which is checkable: neither offset appears anywhere in the
 *   library.
 * - `Omed Next Patt` and `Omed Prev Patt` are LVOs of their own ($210230 and
 *   $21028e), and both force the line to 63 as well as moving the position.
 */

import { AmosError } from '../interp/values'
import { PT_PERIODS, PT_PERIODS_PER_ROW } from '../amiga/notes'
import { PAULA_CLOCK_PAL, VBL_HZ, clampVolume, periodToHz } from '../amiga/paula'
import type { AudioSink } from '../amiga/paula'
import { MMD2_PLAYSEQ_HEADER, MMD2_PLAYSEQ_LENGTH_AT } from '../amiga/mmd2'
import {
  OMED_FLAG_SLOWHQ,
  OMED_TRACKS,
  omedBufferWords,
  omedMix,
  omedMixRate,
  omedTickHz,
  type OmedSide,
} from '../amiga/mmd2mix'
import {
  MMD_FLAG2_BPM,
  MMD2_CHANNELS_AT,
  MMD2_ECHODEPTH_AT,
  MMD2_ECHOLEN_AT,
  MMD2_ECHOTYPE_AT,
  MMD2_FLAGS3_AT,
  MMD2_STEREOSEP_AT,
  MMD2_TRACKVOLS_AT,
  MMD2_VOLADJ_AT,
  MMD_FLAG3_STEREO,
} from '../amiga/mmd2'
import {
  OMIX_CLOCK,
  OMIX_DEFAULT_BUFFER,
  OMIX_DEFAULT_RATE,
  OMIX_MAX_CHANNELS,
  OMIX_NOTES,
  omixNoteTable,
  omixRateHz,
  omixSamplesPerTick,
  omixTickHz,
} from '../amiga/omix'
import {
  OMIX_FLAG_LOOP,
  OMIX_FLAG_OFF,
  omixChannelVolume,
  omixEcho,
  omixEchoFrames,
  omixMix,
  omixShift,
  omixStep,
  omixStereoSpread,
  omixTrackScale,
  omixVoice,
  omixVolumeRow,
  omixVolumeTable,
  type OmixVoice,
} from '../amiga/omixmix'

/**
 * The CIA timer periods for primary tempos 1 to 10, read out of the table at
 * $2111e0 of medplayer-1f2ca57f. `MEDSetTempo` ($2111a4) indexes it with
 * `cmp.w #$a,d0 / bhi` and sends 11 upward to a divide instead.
 *
 * The line the table follows is `tempo * 14500/6`, so each tempo is that many
 * times the rate of tempo 1, and nine of the ten entries sit within four
 * counts of it. The ninth is 21436 where the line says 21750. It is 314 low,
 * nothing derives it, and a replay written from the published MMD format gets
 * that one tempo wrong with no way to find out.
 */
const TEMPO_TIMER = [2417, 4833, 7250, 9666, 12083, 14500, 16916, 19332, 21436, 24163]

/** $c2(a6). $2116ce swaps in 474326 when `ExecBase+$212` is not 50, so this is PAL. */
const TEMPO_CLOCK = 470000
/** $53a(a6), the BPM numerator. 1789772 on NTSC, by the same swap. */
const BPM_CLOCK = 1773447

/**
 * The CIA clock, which is the one number this arithmetic needs and the
 * library never states.
 *
 * Its own NTSC switch is the proof that this is the right identification:
 * `Math.round(470000 * PAULA_CLOCK_NTSC / PAULA_CLOCK_PAL)` is 474326 and the
 * same scaling of 1773447 is 1789772, which are exactly the two constants
 * $2116ce writes. Both PAL constants are the NTSC ones divided by the Paula
 * clock ratio, so the divisor is the Paula clock over five and the resulting
 * tick rate is the same on either machine. `med.test.ts` asserts both.
 */
const CIA_CLOCK = PAULA_CLOCK_PAL / 5

/**
 * Ticks a single frame may run, so a nonsense tempo cannot spin `vbl()`.
 * The real ceiling is 5.9, at tempo 1, and 15.4 in BPM mode at 240 beats
 * over 32 lines.
 */
const MAX_TICKS_PER_VBL = 32

/**
 * The CIA timer period `MEDSetTempo` writes: low byte through $11c(a6), high
 * byte through $120(a6), which is a 16-bit period however it was reached.
 *
 * `linesPerBeat` is read even outside BPM mode because the caller has it; the
 * non-BPM branches never look at it.
 */
export function medTimer(tempo: number, bpm: boolean, linesPerBeat: number): number {
  // $2111f4: `andi.w #$1f / addq.b #1 / mulu.w / divu.w`. The multiply cannot
  // reach 16 bits here, since tempo tops out at 240 and lines-per-beat at 32.
  if (bpm) return Math.floor(BPM_CLOCK / (tempo * linesPerBeat))
  if (tempo >= 1 && tempo <= 10) return TEMPO_TIMER[tempo - 1]!
  return Math.floor(TEMPO_CLOCK / tempo)
}

/**
 * How often the replay steps, in Hz.
 *
 * The tick is the CIA clock over the timer period, and in BPM mode over four
 * more. $2108a2 is where that four comes from: `$538(a6)` is set by `seq`
 * when `Med Play` reads `flags2` ($211638), so it holds $ff outside BPM mode
 * and `bmi` jumps the gate entirely. In BPM mode it holds 0, the gate counts
 * down and reloads with 4, and three interrupts in every four return having
 * done nothing. That four is what makes 125 beats over 4 lines come out at
 * 50.01 Hz rather than 200.
 */
export function medTickHz(tempo: number, bpm: boolean, linesPerBeat: number): number {
  // DEVIATION: tempo 0 runs `subq.b #1,d0` to $ff and reads 510 bytes past
  // the table ($2111be), and a tempo big enough to divide to 0 asks the CIA
  // for a period it has no encoding for. Neither is a rate, so both stop the
  // clock here rather than inventing one.
  const timer = medTimer(tempo, bpm, linesPerBeat)
  if (!Number.isFinite(timer) || timer <= 0) return 0
  return CIA_CLOCK / timer / (bpm ? 4 : 1)
}

/**
 * The vibrato and tremolo waveform, 32 SIGNED bytes at $21087a.
 *
 * This was ProTracker's `PT_SINE` on the reasoning that a four-channel MMD
 * replay would use the shared one, since medplayer.library was thought
 * unreadable. It is readable and it disagrees: a full symmetric sine peaking
 * at +/-127, where ProTracker's is an unsigned quarter-wave peaking at 255.
 * The same 32 bytes are in all three medplayer builds and in octaplayer and
 * octamixplayer, so one table serves the family.
 */
export const MED_SINUS: readonly number[] = [
  0, 25, 49, 71, 90, 106, 117, 125, 127, 125, 117, 106, 90, 71, 49, 25,
  0, -25, -49, -71, -90, -106, -117, -125, -127, -125, -117, -106, -90, -71, -49, -25,
]

/**
 * The period a note plays at, and it is a five-octave table rather than
 * ProTracker's three.
 *
 * The library keeps sixteen of them at $212088, 192 bytes apart, and picks
 * one with the track's finetune ($21035c). Row 0 is ProTracker's row 0 with
 * its first octave multiplied by four and its second by two, which this
 * derives and `med.test.ts` checks against the binary to the word.
 *
 * `note` is the index off the row pointer the note-on stored at $4e(a5), so 0
 * is ProTracker's C-1 for a sampled instrument and 24 notes lower for a pure
 * synth. `PT_ROW_OFFSET` is the 48 bytes that difference is.
 *
 * DEVIATION: rows 1 to 15 are NOT ProTracker's finetuned rows. MED computed
 * its own and they part company by up to 13 counts, 0.45%, or about eight
 * cents at the extreme. Carrying the library's 1,536 words would mean copying
 * its data, so the finetuned rows come from `PT_PERIODS` and the error above
 * is what a program can hear. Finetune 0, which is every note in every module
 * that never sets one, is exact.
 */
export function medPeriod(note: number, finetune: number): number {
  // The row pointer is 48 bytes INTO the row. $212c88 holds the sixteen of
  // them and every one is $212088 + 48 + finetune * 192, so note 0 of a
  // sampled instrument is word 24, which is ProTracker's 856. The two octaves
  // below it are reachable only by the pure synth path, which subtracts the 48
  // straight back off ($21058c).
  let n = note + PT_ROW_OFFSET
  const row = (finetune & 0xf) * PT_PERIODS_PER_ROW + 1
  // 60 real entries and then 36 more, which are the top octave three times
  // over: a note past the end of the table lands in the top octave again
  if (n >= 60) n = 48 + ((n - 60) % 12)
  if (n < 0) n = 0
  if (n < 12) return PT_PERIODS[row + n]! * 4
  if (n < 24) return PT_PERIODS[row + n - 12]! * 2
  return PT_PERIODS[row + n - 24]!
}

/**
 * $21033a: add an octave until the note is positive, then take ONE off if it
 * is past 62. A loop up and a single step down, which is what the code does
 * (`bra.b $21033a` on the way up, fall-through on the way down).
 *
 * The sampled path runs this and the pure synth path never reaches it, so a
 * synth note is whatever the row holds at that index.
 */
export function medNoteWrap(note: number): number {
  let n = note
  while (n < 0) n += 12
  if (n > 62) n -= 12
  return n
}

/**
 * One track, named by its offset in the library's own per-track block so the
 * handlers below can be read against the disassembly.
 */
interface MedVoice {
  note: number // (a5)
  instr: number // $1
  /** $2, already scaled by the track and master volumes */
  vol: number
  cmd: number // $4
  data: number // $5
  /** $7, the hold counter; negative means hold forever */
  hold: number
  holdSet: number // $8
  decaySet: number // $9
  strans: number // $a
  finetune: number // $b
  period: number // $14
  /** $c, an 8.8 offset the `$19` command adds under the period */
  periodFine: number
  vibShift: number // $22
  vibSpeed: number // $23
  vibDepth: number // $24
  portTarget: number // $20
  portSpeed: number // $52
  /** $54, and $55 is the copy that counts the note down */
  decay: number
  decayRun: number
  vibPos: number // $5c
  tremPos: number // $5d
  tremDepth: number // $5e
  tremSpeed: number // $60
  /** $61, the tremolo's volume for one tick; negative means none pending */
  tremVol: number
  /** the last period and volume handed to the sink, so a tick that changes
   *  nothing writes nothing */
  outPeriod: number
  outVol: number

  // The synth half. $4d(a5) is 0 for a sampled instrument, 1 for a pure
  // synth and -1 for a hybrid, which is the sign $2102ca tests to decide
  // whether a finished note stops the DMA.
  synth: number // $4d
  syn: number // $26, the SynthInstr offset in the module
  baseNote: number // $4b, the note the waveform list arpeggios around
  /** -24 for a pure synth: $210574 biases the period table by $30 bytes */
  synBias: number
  volPc: number // $31
  volWait: number // $34
  volSpeed: number // $48
  volCount: number // $2e
  volOut: number // $4c
  volStep: number // $4a
  envPtr: number // $3c
  envLoop: number // $56
  envPos: number // $5a
  wfPc: number // $33
  wfStart: number // what command E left in $33 before the note cleared it
  wfWait: number // $35
  wfSpeed: number // $49
  wfCount: number // $2f
  periodStep: number // $38
  periodAcc: number // $3a
  synVibDepth: number // $41
  synVibSpeed: number // $37
  synVibPos: number // $46
  /** $42, and -1 is the built-in table at $21087a it is initialised to */
  synVibWave: number
  arpPtr: number // $2a
  arpLoop: number // $2c
  /** whether the sink has a buffer for this voice yet */
  sounding: boolean
}

const newVoice = (): MedVoice => ({
  note: 0, instr: 0, vol: 0, cmd: 0, data: 0,
  hold: -1, holdSet: 0, decaySet: 0, strans: 0, finetune: 0,
  period: 0, periodFine: 0, vibShift: 5, vibSpeed: 0, vibDepth: 0,
  portTarget: 0, portSpeed: 0, decay: 0, decayRun: 0,
  vibPos: 0, tremPos: 0, tremDepth: 0, tremSpeed: 0, tremVol: -1,
  outPeriod: -1, outVol: -1,
  synth: 0, syn: 0, baseNote: 0, synBias: 0,
  volPc: 0, volWait: 0, volSpeed: 1, volCount: 0, volOut: 0, volStep: 0,
  envPtr: 0, envLoop: 0, envPos: 0,
  wfPc: 0, wfStart: 0, wfWait: 0, wfSpeed: 1, wfCount: 0,
  periodStep: 0, periodAcc: 0,
  synVibDepth: 0, synVibSpeed: 0, synVibPos: 0, synVibWave: -1,
  arpPtr: 0, arpLoop: 0, sounding: false,
})

/** SynthInstr, whose fields the two interpreters index from a0 */
const SYN_VOLSPEED = 0x12
const SYN_WFSPEED = 0x13
const SYN_VOLTABLE = 0x16
const SYN_WFTABLE = 0x96
/**
 * Words the sixteen row pointers at $212c88 start into their row: 48 bytes,
 * so a sampled note 0 is ProTracker's 856 and not the table's first word.
 */
const PT_ROW_OFFSET = 24

const SYN_WFORMS = 0x14
const SYN_WAVEFORMS = 0x116
/** a script byte at or above this is a command, and the low nibble selects it */
const SYN_CMD = 0x80

export interface MedHost {
  audio: AudioSink
  tick: () => number
  getBank: (n: number) => { name: string; data: Uint8Array } | null
}

/**
 * Which library's front end this player wears.
 *
 * `medplayer` is four Paula voices on a CIA timer. `octaplayer` is
 * `DME_OctaMed.library`: MMD2, up to eight tracks mixed two to a voice, and a
 * tick that is the length of a DMA buffer.
 */
export type MedBuild = 'medplayer' | 'octaplayer' | 'octamixplayer'

/**
 * `medPeriod`'s table is sixty notes and wraps its top octave; OctaMix's is
 * seventy-two and does not. The two agree to under a cent everywhere the first
 * is valid, and MedPlayer note `n` is OctaMix entry `n + 24` --- checked across
 * all sixty rather than read off the two tables.
 *
 * So the octamix build cannot borrow `medPeriod`: above note 35 it would play
 * an octave low. It uses OctaMix's own tables and converts to a period, which
 * is what $21218e does before any effect touches it.
 */
const OMIX_NOTE_OFFSET = 24

/** $210882, $210896, $2108aa, $2108be: four blocks, and $78 further on is the
 *  second track of each pair */
const OMED_PAIRS = 4

export class MedPlayer {
  /**
   * Told the volume of every trigger, so a caller can keep vu bytes.
   *
   * `Protracker` has the same hook for the same reason: the vu meters belong
   * to whoever wraps the replayer rather than to the replayer. AMOS's own
   * `Vumeter` reads them, and so does `=Dmed Vu` through
   * `DME_Med.library`'s veneer.
   */
  onVu: ((voice: number, volume: number) => void) | undefined

  private host: MedHost
  /** Med_Bank (+Music.s:2248): default 7 */
  bank = 7
  /** Med_Midi flag — stored only, no MIDI output exists in the port */
  midi = false
  on = false
  /** Med_Adr: a module is loaded/positioned (Med Cont resumes it) */
  private data: Uint8Array | null = null
  private bankNum = 7
  private song = 0 // song section offset
  private blockarr = 0
  private smplarr = 0
  private numblocks = 0
  private songlen = 0
  private tempo = 33 // primary tempo (deftempo)
  private bpm = false
  /** flags2 low five bits plus one ($2111f8); only BPM mode reads it */
  private lpb = 4
  private tempo2 = 6 // ticks per line
  private transp = 0 // playtransp
  private mastervol = 64
  private seqPos = 0
  private line = 0
  private tickCount = 0
  /**
   * When the CIA next fires, in seconds on the sink's clock. Below the frame
   * being played it is pulled up to the frame's start, which is what a player
   * that was stopped, positioned, or never started yet needs.
   */
  private next = -Infinity
  /**
   * $52a: 0 for none, 1 for a break that advances the position, and -1 when
   * `Bxx` has already written the position ($210c5c tests the sign).
   * $52b keeps the line number across the break.
   */
  private breakKind = 0
  private keepLine = false
  /** $530, one past the line to resume at, so 0 means "no target" */
  private lineJump = 0
  private loopLine = 0 // $532
  private loopCount = 0 // $534
  private lineDelay = 0 // $536
  private flags = 0 // song flags at $2ff
  private voices: MedVoice[] = [0, 1, 2, 3].map(newVoice)

  /** which library, and everything below that tests it cites its own address */
  readonly build: MedBuild
  /** `$3(a2)`: 0, 1 or 2, and `cmpi.b #$32,$3(a2)` is the MMD2 gate */
  private fmt = 0
  /** $1fa of an MMD2 song header, and $1fc, $200 and $208 beside it */
  private sections = 0
  private sectionTable = 0
  private pseqTable = 0
  /** `$c(a2)`, the section index, and `$e(a2)`, the byte offset $211ade caches */
  private section = 0
  private pseqAt = 0
  /** the eight mixer sides, and the four buffers they are summed into */
  private sides: OmedSide[] = []
  /** the $4c blocks at `$215950`, one per mixed channel */
  private omixVoices: OmixVoice[] = []
  /** the word accumulator $211968 clears and $21039c adds into */
  private omixAcc = new Int16Array(0)
  /** what the converters at $2116c6 and $21171c hand Paula */
  private omixOut = new Int8Array(0)
  /** `$2264(a6)`, the echo line, and `$226c(a6)`, its position */
  private omixLine = new Int16Array(0)
  private omixLinePos = 0
  /** the 64 x 256 table at `$225c(a6)` and the shift at `$227e(a6)` */
  private omixTable: Int16Array = new Int16Array(0)
  private omixShiftAmt = 0
  /** `$21591c` and `$215918`: what `Omix Freq` and `Omix Buffer` set */
  omixRequestedRate = OMIX_DEFAULT_RATE
  omixBuffer = OMIX_DEFAULT_BUFFER
  /** `$215920`, which only `Omix 14 Bit On` and `Off` write */
  omix14Bit = false
  /** `$2159c4`, the subsong `Omix Play` asks for */
  omixSubsong = 0
  /** `$2274(a6)`: the request put through a whole Paula period and back */
  private omixRate = OMIX_DEFAULT_RATE
  /** the song's mixing tail, read once at load */
  private omixChannels = 4
  private omixVolAdj = 100
  private omixFlags3 = 0
  private omixEchoType = 0
  private omixEchoDepth = 0
  private omixStereoSep = 0
  /** `$70(a3)`, one per channel: `trackvol * mastervol >> 4` */
  private omixScales: number[] = []
  private buffers: Int8Array[] = []
  private pcm: Int8Array | null = null
  /** the byte `Omed Hq On` writes through LVO -$54 */
  hq = false

  constructor(host: MedHost, build: MedBuild = 'medplayer') {
    this.host = host
    this.build = build
    if (build === 'octaplayer' || build === 'octamixplayer') this.resetMix()
  }

  private resetMix(): void {
    this.sides = [...Array(OMED_TRACKS)].map(() => ({ at: 0, end: 0, loop: 0, period: 0 }))
    this.buffers = [...Array(OMED_PAIRS)].map(() => new Int8Array(0))
    if (this.build !== 'octamixplayer') return
    this.omixVoices = [...Array(OMIX_MAX_CHANNELS)].map(() => omixVoice())
    this.omixLinePos = 0
    this.omixAcc = new Int16Array(0)
    this.omixOut = new Int8Array(0)
    this.omixLine = new Int16Array(0)
  }

  /**
   * How many tracks reach audio: four in medplayer whatever the block holds,
   * eight in octaplayer, and the song's own `channels` in octamix --- which
   * $213672 reads at `$216` and defaults to FOUR rather than to none.
   */
  private get tracks(): number {
    if (this.build === 'octamixplayer') return this.omixChannels
    return this.build === 'octaplayer' ? OMED_TRACKS : 4
  }

  /** whether the finished stream is two channels, off bit 0 of flags3 */
  private get omixStereo(): boolean {
    return (this.omixFlags3 & MMD_FLAG3_STEREO) !== 0
  }

  /**
   * $211132 with the period already found: OctaMix's own table gives a value,
   * $21219a turns a period back into one, and $211146 divides it by the rate.
   */
  private omixStepFor(period: number): number {
    if (period <= 0) return 0
    return omixStep(Math.floor(OMIX_CLOCK / period), this.omixRate)
  }

  /**
   * `medPeriod` for the two Paula builds, and OctaMix's own tables for the
   * third, because the two do NOT agree everywhere.
   *
   * They agree to under a cent for sixty notes, which is how the offset of 24
   * was established rather than read off. Above that `medPeriod` wraps --- its
   * table is sixty entries and $212c88 repeats the top octave --- where
   * OctaMix's runs to 72 and keeps climbing. Borrowing it would play the top
   * octave of a mixing module a full octave low.
   *
   * The finetune field is MED's four bits, 0..7 then -8..-1, and $2132e4 builds
   * its tables from -8 upward, so the two orderings need converting between.
   */
  private periodFor(note: number, finetune: number): number {
    if (this.build !== 'octamixplayer') return medPeriod(note, finetune)
    const ft = finetune & 0xf
    const table = omixNoteTable(ft < 8 ? ft : ft - 16)
    let idx = note + OMIX_NOTE_OFFSET
    if (idx < 0) idx = 0
    if (idx >= OMIX_NOTES) idx = OMIX_NOTES - 1
    const value = table[idx]!
    // $21218e turns the value into a period, which is what every effect in the
    // sequencer then bends
    return value > 0 ? Math.floor(OMIX_CLOCK / value) : 0
  }

  private w(off: number): number {
    const d = this.data
    if (!d || off < 0 || off + 2 > d.length) return 0
    return (d[off]! << 8) | d[off + 1]!
  }

  private l(off: number): number {
    const d = this.data
    if (!d || off < 0 || off + 4 > d.length) return 0
    return ((d[off]! << 24) | (d[off + 1]! << 16) | (d[off + 2]! << 8) | d[off + 3]!) >>> 0
  }

  private b(off: number): number {
    return this.data?.[off] ?? 0
  }

  /**
   * Whether a note is four bytes and a block header eight.
   *
   * `sge.b d5` on `cmpi.b #$31,$3(a2)` at $210c7c is the test, so MMD1 and
   * everything above it share one layout and MMD0 is the odd one.
   */
  get mmd1(): boolean {
    return this.fmt >= 1
  }

  /** `cmpi.b #$32,$3(a2)`: the sections-and-play-sequences header */
  get mmd2(): boolean {
    return this.fmt >= 2
  }

  /**
   * The four live fields medplayer.library writes back into the MMD header
   * while a module plays — `pblock` ($2a), `pline` ($2c), `pseqnum` ($2e) and
   * `counter` ($32) — plus the static `extra_songs` ($33).
   *
   * They are here because MED 7.1's `Med Pblock`, `Med Pline`, `Med Seq Num`,
   * `Med Counter` and `Med Get Sub Songs` are literally `move.w $2a(a0),d0`
   * and friends over the loaded module: the extension does not ask the library
   * anything, it reads the struct the library maintains. This port's replayer
   * keeps that state in fields rather than in the module bytes, so it answers
   * for them here instead. See medext.ts.
   */
  get hdrPblock(): number {
    return this.data ? this.blockNumber() : 0
  }

  get hdrPline(): number {
    return this.line
  }

  get hdrPseqnum(): number {
    return this.seqPos
  }

  get hdrCounter(): number {
    return this.tickCount
  }

  /** `extra_songs` at $33 — static header data, not playback state */
  get extraSongs(): number {
    return this.b(0x33)
  }

  /**
   * The primary tempo, as MED 7.1's `Med Set Tempo` sets it.
   *
   * The AMOS core has no keyword for this — the Music extension's `Med Play`
   * takes whatever `deftempo` the module carries — so nothing needed a setter
   * until the third-party extension arrived with one.
   */
  setTempo(t: number): void {
    this.tempo = t
  }

  /** "Med     " for medplayer, "OctaMed " for the DME_OctaMed veneer */
  private get bankPrefix(): string {
    if (this.build === 'octamixplayer') return 'OctaMix'
    return this.build === 'octaplayer' ? 'OctaMed' : 'Med'
  }

  /** the bank verification half of InMedPlay2 (+Music.s:4628-4634) */
  checkBank(bankArg: number | null): number {
    let n = bankArg ?? this.bank
    if (n >= 0x01000000) n = Math.floor((n - 0x01000000) / 0x00100000)
    const bank = this.host.getBank(n)
    if (!bank || !bank.name.startsWith(this.bankPrefix)) throw new AmosError('not a med module', 189)
    return n
  }

  /** InMedPlay2 (+Music.s:4588): module positioned and started */
  play(n: number, modnum: number): void {
    const bank = this.host.getBank(n)!
    this.stop()
    this.bankNum = n
    this.data = bank.data
    // MEDSetModnum: multi-module files chain through expdata->nextmod
    let base = 0
    for (let i = 0; i < modnum; i++) {
      const exp = this.l(base + 0x20)
      const next = exp ? this.l(exp) : 0
      if (!next) break
      base = next
    }
    this.song = this.l(base + 8)
    this.blockarr = this.l(base + 0x10)
    this.smplarr = this.l(base + 0x18)
    // $211a80 rewrites a 'T' id to '0', so a MMDT plays as an MMD0
    const id3 = this.b(base + 3)
    this.fmt = id3 === 0x54 ? 0 : Math.max(0, Math.min(3, id3 - 0x30))
    const s = this.song
    this.numblocks = this.w(s + 504)
    this.songlen = Math.max(1, this.w(s + 506))
    // MMD2 keeps $1fa for the SECTION count and hangs the play sequences off
    // $1fc as an array of pointers, each with its own length word at $28
    this.sections = this.mmd2 ? Math.max(1, this.w(s + 0x1fa)) : 0
    this.sectionTable = this.mmd2 ? this.l(s + 0x200) : 0
    this.pseqTable = this.mmd2 ? this.l(s + 0x1fc) : 0
    // $208, the song's own track count, is deliberately not read: nothing in
    // octaplayer reads it either, because the block header carries its own
    this.section = 0
    this.pseqAt = this.mmd2 ? this.w(this.sectionTable) * 4 : 0
    // DEVIATION: deftempo 0 is the off-the-table read medTickHz describes, so
    // it is replaced here with a tempo that ticks at about a PAL frame.
    this.tempo = this.w(s + 0x2fc) || 33
    this.transp = (this.b(s + 0x2fe) << 24) >> 24
    const flags2 = this.b(s + 0x300)
    this.bpm = (flags2 & 0x20) !== 0 // FLAG2_BPM, $2111b0 `btst #5,$300(a0)`
    this.lpb = (flags2 & 0x1f) + 1
    this.tempo2 = this.b(s + 0x301) || 6
    this.mastervol = this.b(s + 0x312) || 64
    this.flags = this.b(s + 0x2ff)
    this.seqPos = 0
    this.line = 0
    this.tickCount = 0
    this.next = -Infinity
    this.breakKind = 0
    this.keepLine = false
    this.lineJump = this.loopLine = this.loopCount = this.lineDelay = 0
    if (this.build === 'octamixplayer') this.loadOmixSong(s)
    this.voices = [...Array(this.tracks)].map(newVoice)
    if (this.build === 'octaplayer' || this.build === 'octamixplayer') {
      this.resetMix()
      this.pcm = new Int8Array(bank.data.buffer, bank.data.byteOffset, bank.data.length)
    }
    this.on = true
  }

  /**
   * The master volume, which `DME_Med.library` exposes at LVO -84 and AMOS's
   * own Music extension does not.
   *
   * `play()` loads it from the module's own byte at song+$312, so setting it
   * after a `play` is the only order that sticks --- which is what routine 216
   * ($6852) does.
   */
  set masterVolume(v: number) {
    this.mastervol = Math.max(0, Math.min(0x40, v))
  }

  get masterVolume(): number {
    return this.mastervol
  }

  /**
   * Step the sequence position, which is LVO -90 and -96 of
   * `DME_Med.library`'s veneer.
   *
   * The line goes back to zero and the position wraps at the song length,
   * which is what `advanceLine` does when a block runs out --- this is the
   * same move without waiting for the block.
   */
  seek(delta: number): void {
    if (!this.data) return
    let pos = this.seqPos + delta
    if (pos < 0) pos = Math.max(0, this.seqLength - 1)
    if (pos >= this.seqLength) pos = 0
    this.seqPos = pos
    this.line = 0
    this.tickCount = 0
  }

  /** InMedStop (+Music.s:4562) */
  stop(): void {
    if (!this.on) return
    this.on = false
    if (this.build === 'octaplayer' || this.build === 'octamixplayer') this.resetMix()
    for (let v = 0; v < 4; v++) this.host.audio.stop(v)
  }

  /**
   * $2107bc with the buffer swap spent: four pairs mixed, four buffers handed
   * to Paula, once per tick.
   *
   * The library double-buffers because the DMA is reading one while the other
   * fills. Here the buffer holds exactly one tick, so playing it from the top
   * each tick is the same thing, which is the choice `digiplay.ts` makes for
   * DigiBooster's pairs as well.
   *
   * DEVIATION: the volume is the sounding track's own. $210858 copies four
   * bytes from `$172(a6)` into the four AUDxVOL registers and nothing in the
   * library ever writes them, so a literal port sets every channel to zero on
   * the first interrupt. `mmd2mix.ts` sets that out at length. The first track
   * of a pair wins when both sound, because the pair is its Paula channel.
   */
  private emit(): void {
    const pcm = this.pcm
    if (!pcm) return
    const words = omedBufferWords(this.tempo, this.hq, (this.flags & OMED_FLAG_SLOWHQ) !== 0)
    const n = words * 2
    const rate = omedMixRate(this.hq)
    for (let v = 0; v < OMED_PAIRS; v++) {
      const a = this.sides[v]!
      const b = this.sides[v + OMED_PAIRS]!
      const aLive = a.at !== 0 && a.period !== 0
      const bLive = b.at !== 0 && b.period !== 0
      if (!aLive && !bLive) {
        this.host.audio.setVolume(v, 0)
        continue
      }
      let buf = this.buffers[v]!
      if (buf.length !== n) buf = this.buffers[v] = new Int8Array(n)
      omedMix(buf, pcm, a, b, this.hq)
      const lead = this.voices[aLive ? v : v + OMED_PAIRS]!
      this.host.audio.play(v, buf, rate, clampVolume(lead.outVol), 0, n)
    }
  }

  /**
   * $212ef4 and $213334: everything about the song the MIXER needs, read once.
   *
   * The track volumes are the difference that bites. On an MMD0 they are
   * sixteen bytes in the song tail at $302; on an MMD2 they are a POINTER at
   * $204 to `numtracks` of them, and $212f16 takes that branch on the id byte.
   * Reading the tail on an MMD2 gets zeroes and silences every track.
   */
  private loadOmixSong(song: number): void {
    this.omixChannels = Math.max(1, Math.min(OMIX_MAX_CHANNELS, this.w(song + MMD2_CHANNELS_AT) || 4))
    this.omixVolAdj = this.w(song + MMD2_VOLADJ_AT) || 100
    this.omixFlags3 = this.l(song + MMD2_FLAGS3_AT)
    this.omixEchoType = this.b(song + MMD2_ECHOTYPE_AT)
    this.omixEchoDepth = this.b(song + MMD2_ECHODEPTH_AT)
    this.omixStereoSep = (this.b(song + MMD2_STEREOSEP_AT) << 24) >> 24

    this.omixRate = omixRateHz(this.omixRequestedRate)
    this.omixTable = omixVolumeTable(this.omixChannels, this.omixVolAdj, this.omixFlags3)
    this.omixShiftAmt = omixShift(this.omixChannels, this.omixVolAdj, this.omixFlags3)

    // $212f16: the MMD2 arm, a pointer and a count, against $212f22's tail
    this.omixScales = []
    const vols = this.l(song + MMD2_TRACKVOLS_AT)
    for (let v = 0; v < this.omixChannels; v++) {
      const tv = vols !== 0 ? this.b(vols + v) : this.b(song + 0x302 + v)
      this.omixScales.push(omixTrackScale(tv, this.mastervol))
    }

    // $2134b4: `mix_echolen * rate / 1000`, two bytes a frame mono and four
    // stereo, and only when there is an echo type to run
    const frames = this.omixEchoType !== 0 ? omixEchoFrames(this.w(song + MMD2_ECHOLEN_AT), this.omixRate) : 0
    this.omixLine = new Int16Array(frames * (this.omixStereo ? 2 : 1))
    this.omixLinePos = 0
  }

  /**
   * $211968: clear the accumulator, mix every channel into it, then the echo
   * and the stereo spread, then hand Paula the finished bytes.
   *
   * The library splices this against the sequencer --- $2119be ticks in the
   * middle of a buffer when the tick falls there --- and this port ticks first
   * and mixes a whole tick's worth, the way `emit` does for octaplayer.
   *
   * DEVIATION: a note that lands mid-buffer on the machine is heard at the
   * buffer boundary here instead, which is at most one tick early. It is also
   * why `Omix Buffer` is stored and not acted on: the buffer length is exactly
   * the thing that splicing depends on.
   *
   * The converter at $2116c6 takes the HIGH byte of each accumulator word, so
   * the eight bits Paula gets are the top of a sixteen-bit sum that nothing
   * clamps. `omixmix.ts` says why that wraps rather than saturating.
   */
  private emitOmix(): void {
    const pcm = this.pcm
    if (!pcm) return
    const flags2 = (this.bpm ? MMD_FLAG2_BPM : 0) | ((this.lpb - 1) & 0x1f)
    const n = omixSamplesPerTick(this.omixRate, this.tempo, flags2)
    if (n <= 0) return
    const stereo = this.omixStereo
    const words = stereo ? n * 2 : n
    if (this.omixAcc.length !== words) {
      this.omixAcc = new Int16Array(words)
      this.omixOut = new Int8Array(words)
    }
    this.omixAcc.fill(0)

    // $21039c walks the channel blocks; a voice out of range of the song's own
    // count never had a block built for it
    for (let v = 0; v < this.omixChannels; v++) {
      const mv = this.omixVoices[v]
      if (!mv) continue
      if (stereo) {
        // the accumulator is interleaved, so a mono voice is mixed into the
        // side its channel number puts it on and left alone on the other
        const side = new Int16Array(n)
        if (omixMix(side, n, mv, pcm)) {
          const at = v & 1
          for (let i = 0; i < n; i++) this.omixAcc[i * 2 + at] = this.omixAcc[i * 2 + at]! + side[i]!
        }
      } else omixMix(this.omixAcc, n, mv, pcm)
    }

    // $2119dc, and only when there is a type: an echo of nothing is skipped
    if (this.omixEchoType !== 0 && this.omixLine.length > 0) {
      this.omixLinePos = omixEcho(
        this.omixAcc,
        n,
        this.omixLine,
        this.omixLinePos,
        this.omixEchoDepth,
        stereo,
        this.omixEchoType,
      )
    }
    // $2119ee: the separation must be non-zero AND the song must be stereo
    if (stereo && this.omixStereoSep !== 0) omixStereoSpread(this.omixAcc, n, this.omixStereoSep)

    // $2116dc: the high byte of each word, which is the whole of the 8-bit path
    for (let i = 0; i < words; i++) this.omixOut[i] = this.omixAcc[i]! >> 8
    const rate = this.omixRate
    if (stereo) {
      const l = new Int8Array(n)
      const r = new Int8Array(n)
      for (let i = 0; i < n; i++) {
        l[i] = this.omixOut[i * 2]!
        r[i] = this.omixOut[i * 2 + 1]!
      }
      // $2118b0: mode 3 puts one buffer on AUD0 and AUD3 and the other on
      // AUD1 and AUD2, which is left and right doubled
      this.host.audio.play(0, l, rate, 64, 0, n)
      this.host.audio.play(1, r, rate, 64, 0, n)
    } else {
      this.host.audio.play(0, this.omixOut.subarray(0, n), rate, 64, 0, n)
      this.host.audio.play(1, this.omixOut.subarray(0, n), rate, 64, 0, n)
    }
  }

  /** InMedCont (+Music.s:4706): only when positioned and stopped */
  cont(): void {
    if (this.data && !this.on) this.on = true
  }

  /**
   * LVO -$5a, $210230: `Omed Next Patt`, and it is not `seek(1)`.
   *
   * It forces the line to 63 whatever the block's length, by adding `63 -
   * pline` to the line rather than assigning. And on an MMD2 it steps the
   * SECTION at `$c(a2)` and leaves the cached play-sequence offset at `$e(a2)`
   * alone, so the block does not change now: the next time the play sequence
   * runs out, $210dea increments the section again from where this left it and
   * one section is skipped. Only the MMD0 arm moves the position itself.
   */
  octaNextPatt(): void {
    const line = this.line
    if (this.mmd2) {
      let sec = this.section + 1
      if (sec >= this.sections) sec = 0
      this.section = sec
    } else {
      let pos = this.seqPos + 1
      if (pos >= this.songlen) pos = 0
      this.seqPos = pos
    }
    this.line = line + (0x3f - line)
  }

  /**
   * LVO -$60, $21028e: `Omed Prev Patt`, which is not the mirror of the above.
   *
   * $210298 substitutes 63 for a line of zero before the same `63 - pline`
   * arithmetic, so at the top of a block the line stays where it is. And the
   * MMD2 arm DOES reload `$e(a2)` and the play sequence, which the forward one
   * does not.
   */
  octaPrevPatt(): void {
    const line = this.line === 0 ? 0x3f : this.line
    if (this.mmd2) {
      let pos = this.seqPos - 1
      if (pos < 0) {
        let sec = this.section - 1
        if (sec < 0) sec = 0
        this.section = sec
        this.pseqAt = this.w(this.sectionTable + sec * 2) * 4
        pos = 0
      }
      this.seqPos = pos
    } else {
      this.seqPos = Math.max(0, this.seqPos - 1)
    }
    this.line = this.line + (0x3f - line)
  }

  /** MedClose (+Music.s:4685) */
  close(): void {
    this.stop()
    this.midi = false
    this.data = null
  }

  vbl(): void {
    if (!this.on) return
    // MedCheck (+Music.s:4541): the bank vanished or was replaced
    const bank = this.host.getBank(this.bankNum)
    if (!bank || bank.data !== this.data || !bank.name.startsWith(this.bankPrefix)) {
      this.stop()
      this.data = null
      return
    }
    // The CIA fires on its own clock and not on the frame's, so each interrupt
    // is placed at the instant it happens rather than counted into a frame's
    // worth: tempo 33 is 49.81 Hz, not 50, and the two part company after four
    // minutes of a module that never changes tempo.
    const end = this.host.tick() / VBL_HZ
    const start = end - 1 / VBL_HZ
    if (this.next < start) this.next = start
    if (this.tickHz() <= 0) return
    let ticks = 0
    while (this.next < end) {
      if (++ticks > MAX_TICKS_PER_VBL) {
        this.next = end
        break
      }
      this.host.audio.runTo?.(this.next)
      this.tick()
      if (this.build === 'octaplayer') this.emit()
      else if (this.build === 'octamixplayer') this.emitOmix()
      // AFTER the tick, because `Fxx` writes the CIA's reload latch and the
      // timer is already counting down the interval it was given. The new
      // period takes effect at the underflow, which is the next fire.
      const hz = this.tickHz()
      if (hz <= 0) {
        this.next = end
        break
      }
      this.next += 1 / hz
    }
  }

  /**
   * Where the two builds part company on time.
   *
   * medplayer asks CIA-B for an interval. octaplayer asks Paula for a buffer
   * and lets its end interrupt be the tick, so the whole tempo scale is the
   * ten-byte table at $212346 and nothing else.
   */
  private tickHz(): number {
    if (this.build === 'octamixplayer') {
      // $2115be picks the arm on bit 5 of flags2, which is the same bit
      // medplayer calls `bpm`, and the beat mask lives in the low five
      const flags2 = (this.bpm ? MMD_FLAG2_BPM : 0) | ((this.lpb - 1) & 0x1f)
      return omixTickHz(this.omixRate, this.tempo, flags2)
    }
    if (this.build === 'octaplayer')
      return omedTickHz(this.tempo, this.hq, (this.flags & OMED_FLAG_SLOWHQ) !== 0)
    return medTickHz(this.tempo, this.bpm, this.lpb)
  }

  /**
   * One CIA interrupt, which is $2108a2 with the BPM gate already spent.
   *
   * `$2108d8` counts to the secondary tempo, and on the tick that wraps it
   * plays the row. The per-track effect pass runs on EVERY tick including
   * that one: the row path falls into it at $210d30 with the counter freshly
   * cleared, which is the only way the handlers' `tst.b d3` tick-0 branches
   * are ever reached.
   */
  private tick(): void {
    let hold = false
    if (this.tickCount === 0) {
      // $2108f0: a pending line delay holds the row without replaying it
      if (this.lineDelay !== 0) {
        this.lineDelay--
        hold = this.lineDelay !== 0
      }
      if (!hold) this.playLine()
    }
    for (let v = 0; v < this.tracks; v++) this.tickEffect(v)
    if (++this.tickCount >= this.tempo2) {
      this.tickCount = 0
      if (!hold) this.advanceLine()
    }
  }

  /**
   * $210c28, which decides the next line and, when the block runs out, the
   * next position.
   *
   * `lineJump` is one past the target, so zero means nothing set it. The
   * position advances by one unless `Bxx` already wrote it, which is what
   * `$52a` holding $ff rather than 1 distinguishes ($210c5c, `bmi`).
   */
  private advanceLine(): void {
    let target = this.lineJump !== 0 ? this.lineJump - 1 : this.line + 1
    this.lineJump = 0
    if (target <= this.blockLines(this.currentBlock()) && this.breakKind === 0) {
      this.line = target
      return
    }
    if (!this.keepLine) target = 0
    if (this.mmd2) this.advanceMmd2()
    else {
      let pos = this.seqPos
      if (this.breakKind >= 0) pos++
      if (pos >= this.songlen) pos = 0
      this.seqPos = pos
    }
    this.breakKind = 0
    this.keepLine = false
    this.line = target
  }

  /**
   * $210dcc: the play sequence first, the section only when it runs out.
   *
   * A play-sequence word with its top bit set is not a block. $210e1e's
   * `bpl` sends it back to $210dcc, which advances again from wherever the
   * walk now stands --- so a marker is skipped rather than played, and a
   * sequence of nothing but markers would spin. The 256-turn guard is this
   * port's, and the loop it protects is the library's.
   */
  private advanceMmd2(): void {
    let step = this.breakKind >= 0
    for (let guard = 0; guard < 256; guard++) {
      let pos = this.seqPos + (step ? 1 : 0)
      step = true
      if (pos >= this.seqLength) {
        let sec = this.section + 1
        if (sec >= this.sections) sec = 0
        this.section = sec
        this.pseqAt = this.w(this.sectionTable + sec * 2) * 4
        pos = 0
      }
      this.seqPos = pos
      if ((this.w(this.l(this.pseqTable + this.pseqAt) + MMD2_PLAYSEQ_HEADER + pos * 2) & 0x8000) === 0) return
    }
  }

  /**
   * The block this position names.
   *
   * $211af8 is MMD0's: one BYTE out of `playseq[]`, which is why a song can
   * hold 256 positions and no more. $211aca is MMD2's: the section index
   * chooses a play sequence, and the play sequence's words start at $2a past
   * a 32-character name.
   */
  private blockNumber(): number {
    if (!this.mmd2) return this.b(this.song + 508 + Math.min(this.seqPos, 255))
    const pseq = this.l(this.pseqTable + this.pseqAt)
    return this.w(pseq + MMD2_PLAYSEQ_HEADER + this.seqPos * 2)
  }

  /** $210ee0 reads the length out of the play sequence itself, not the song */
  private get seqLength(): number {
    if (!this.mmd2) return this.songlen
    return Math.max(1, this.w(this.l(this.pseqTable + this.pseqAt) + MMD2_PLAYSEQ_LENGTH_AT))
  }

  private currentBlock(): number {
    const seq = this.blockNumber()
    if (seq >= this.numblocks) return 0
    return this.l(this.blockarr + seq * 4)
  }

  private blockLines(blk: number): number {
    return this.mmd1 ? this.w(blk + 2) : this.b(blk + 1)
  }

  private blockTracks(blk: number): number {
    return this.mmd1 ? this.w(blk) : this.b(blk)
  }

  /**
   * The row: instrument, then the command through the row-tick table at
   * $2109fe, then the note.
   *
   * medplayer reads only four tracks. `$210d54` sends track index 4 and up to
   * the MIDI handler whatever the block holds, so an eight-track MMD is four
   * Paula voices in that library and the rest is note data for a synthesiser
   * that is not here. octaplayer reads eight and mixes the second four onto
   * the first.
   *
   * The stride is the BLOCK's own track count, not the song's: `move.w (a0),d7
   * / mulu.w d7,d0` at $210eb8 reads it out of the block header every line,
   * which is what lets one MMD2 hold blocks four, five, six and seven tracks
   * wide. "Cuku's Dead" in `fixtures/` does exactly that.
   */
  private playLine(): void {
    const blk = this.currentBlock()
    if (!blk) return
    const tracks = this.blockTracks(blk)
    const head = this.mmd1 ? 8 : 2
    const esize = this.mmd1 ? 4 : 3
    for (let v = 0; v < Math.min(this.tracks, tracks); v++) {
      const off = blk + head + (this.line * tracks + v) * esize
      let note: number
      let instr: number
      let cmd: number
      if (this.mmd1) {
        note = this.b(off) & 0x7f
        instr = this.b(off + 1) & 0x3f
        cmd = this.b(off + 2) & 0x1f // $210996
        this.voices[v]!.data = this.b(off + 3)
      } else {
        const b0 = this.b(off)
        const b1 = this.b(off + 1)
        note = b0 & 0x3f
        instr = ((b0 & 0xc0) >> 2) | (b1 >> 4)
        cmd = b1 & 0x0f
        this.voices[v]!.data = this.b(off + 2)
      }
      const V = this.voices[v]!
      if (instr !== 0) this.setInstrument(v, instr)
      V.cmd = cmd
      if (cmd !== 0 && this.rowEffect(v, note)) continue
      if (note !== 0) {
        V.note = note
        this.trigger(v, note)
      }
    }
  }

  /**
   * $2109a8: an instrument number loads the whole per-track note context
   * before the command runs, which is why `C40` on a row with an instrument
   * is that instrument's volume scaled and not the last one's.
   *
   * The three defaults at $53e(a6), $57d(a6) and $5bc(a6) are hold, decay and
   * finetune per instrument. Nothing in AMOS writes them, so they are zero
   * here and only the `8` and `$15` commands move them.
   */
  private setInstrument(v: number, instr: number): void {
    const V = this.voices[v]!
    const rec = this.song + (instr - 1) * 8
    V.instr = instr
    V.holdSet = 0
    V.decaySet = 0
    V.finetune = 0
    V.vol = (this.b(rec + 6) * this.trackScale(v)) >> 8
    V.strans = (this.b(rec + 7) << 24) >> 24
  }

  /** $211484: (trackvol * mastervol) >> 4, so 64 against 64 is 256, unity */
  private trackScale(v: number): number {
    // octaplayer reads neither `trkvol` at $302 nor `mastervol` at $312 --
    // neither offset appears anywhere in DME_OctaMed.library -- so the
    // instrument's own volume is the whole of it. On an MMD2 that is not a
    // detail: $302 belongs to the MMD0 tail and holds zeroes, and scaling by
    // it would make every mixed track silent.
    if (this.build === 'octaplayer') return 0x100
    // $212f28 reads BOTH, where octaplayer reads neither, and on an MMD2 the
    // track volumes are a pointer at $204 rather than the MMD0 tail at $302
    if (this.build === 'octamixplayer') return this.omixScales[v] ?? 0x100
    return (this.b(this.song + 0x302 + v) * this.mastervol) >> 4
  }

  /**
   * The period for a note as the row and the effects compute it: the note
   * number less one, plus the song's `playtransp` and the instrument's own
   * `strans` ($210bda, $210e78).
   */
  private notePeriod(v: number, note: number): number {
    const V = this.voices[v]!
    const n = note - 1 + this.transp + V.strans
    // A pure synth is the one caller that never runs the wrap at $21033a: it
    // is sent straight to $210574, where the only arithmetic is the 48 bytes
    // `synBias` stands for.
    return this.periodFor(V.synth > 0 ? n + V.synBias : medNoteWrap(n), V.finetune)
  }

  /**
   * The row-tick half of a command. Returns true when the note must NOT
   * retrigger, which is the `bra $210c1c` exit that `3`, `F$f2` and `F$fd`
   * take.
   */
  private rowEffect(v: number, note: number): boolean {
    const V = this.voices[v]!
    const d = V.data
    switch (V.cmd) {
      case 0x3: // $210bd0: portamento target, and the note never restarts
        if (note !== 0) {
          // $210be6 guards on the index and then reads $4e(a5), the row
          // pointer the last note-on left, so a synth track gets the synth one
          const idx = note - 1 + this.transp + V.strans
          if (idx >= 0) V.portTarget = this.periodFor(idx + V.synBias, V.finetune)
        }
        if (d !== 0) V.portSpeed = d
        return true
      case 0x8: // $210b98: high nibble decay, low nibble hold
        V.decaySet = d >> 4
        V.holdSet = d & 0xf
        return false
      case 0x9: // $210b2a: five bits, and zero means 32
        this.tempo2 = (d & 0x1f) || 32
        return false
      case 0xb: // $210bb2: position jump, which sets the position itself
        if (d <= this.seqLength) {
          this.seqPos = d
          this.breakKind = -1
        }
        return false
      case 0xc:
        this.setVolume(v, d)
        return false
      case 0xe: // $210ad4: where a synth's waveform list starts, tracks 0..3
        return false
      case 0xf:
        return this.commandF(v, note)
      case 0x15: // $210b3a: finetune, signed, and outside -8..+7 it is ignored
        if (d <= 7 || d >= 0xf8) V.finetune = d & 0xf
        return false
      case 0x16: // $210b52: block loop
        if (d === 0) {
          this.loopLine = this.line
        } else if (this.loopCount !== 0) {
          if (--this.loopCount !== 0) this.lineJump = this.loopLine + 1
        } else {
          this.loopCount = d
          this.lineJump = this.loopLine + 1
        }
        return false
      case 0x19: // $210baa: the fine period offset a slide adds to
        V.periodFine = (d << 8) & 0xffff
        return false
      case 0x1c: // $210b82: MIDI preset in the instrument record
        return false
      case 0x1d: // $210bc2: break to line d of the next position
        this.breakKind = 1
        this.keepLine = true
        this.lineJump = d + 1
        return false
      default:
        return false
    }
  }

  /**
   * `C` ($210ae4). The data is DECIMAL unless the song's flags say hex, so
   * `C40` is 40 and not 64 in most modules, and bit 7 aims the same value at
   * the instrument's stored volume instead of the track's.
   *
   * DEFECT: the bit 7 path writes the instrument record and then falls into
   * the track-volume store at $210b1c anyway, so `C$c0` sets both.
   */
  private setVolume(v: number, data: number): void {
    let n = data
    if ((data & 0x80) !== 0) {
      n = data & 0x7f
      if (n > 64) return
      const rec = this.song + (this.voices[v]!.instr - 1) * 8 + 6
      if (this.data && rec >= 0 && rec < this.data.length) this.data[rec] = n
    } else {
      if ((this.flags & 0x10) === 0) n = (n >> 4) * 10 + (n & 0xf)
      if (n > 64) return
    }
    this.voices[v]!.vol = (n * this.trackScale(v)) >> 8
  }

  /**
   * `F` ($210a3e). One to $f0 is the primary tempo and everything above it is
   * a separate command.
   */
  private commandF(v: number, note: number): boolean {
    const V = this.voices[v]!
    const d = V.data
    if (d === 0) {
      this.breakKind = 1 // $210aca
      return false
    }
    if (d <= 0xf0) {
      this.tempo = d // $210a4e, then straight into MEDSetTempo
      return false
    }
    switch (d) {
      case 0xf2: // $210a5a: note delay, the note is held rather than played
        if (note !== 0) V.note = note
        V.hold = V.holdSet !== 0 ? V.holdSet : -1
        return true
      case 0xfd: // $210a92: retune without restarting the sample
        if (note !== 0) V.period = this.notePeriod(v, note)
        return true
      case 0xfe: // $210a76: stop the whole player
        this.stop()
        return true
      // $21119a and $211190: the LED filter, and the two are the way round the
      // hardware bit is rather than the way round the names suggest. `bset`
      // puts bit 1 of $bfe001 up, which turns the filter OFF.
      case 0xf8:
        this.host.audio.setFilter(false)
        return false
      case 0xf9:
        this.host.audio.setFilter(true)
        return false
      default:
        return false
    }
  }

  /**
   * A note starts: $210298 through $2104ca. The hold counter is loaded from
   * $8(a5) and a zero there means $ff, hold forever ($210c0c).
   */
  private trigger(v: number, note: number): void {
    const V = this.voices[v]!
    const instr = V.instr
    if (instr === 0 || instr > 63) return
    let ptr = this.l(this.smplarr + (instr - 1) * 4)
    if (!ptr) return
    V.baseNote = note - 1 + this.transp + V.strans // $210558
    V.periodFine = 0
    V.vibPos = 0 // $210324
    V.decayRun = 0 // $21031a
    V.decay = V.decaySet // $21031e
    V.hold = V.holdSet !== 0 ? V.holdSet : -1
    // $210560: type $ffff is a synthsound and $fffe a hybrid, which carries a
    // sampled waveform in waveforms[0] and runs the same two scripts over it
    const type = (this.w(ptr + 4) << 16) >> 16
    V.synth = 0
    V.syn = 0
    V.synBias = 0
    if (type === -1 || type === -2) {
      V.syn = ptr
      if (type === -2) {
        V.synth = -1 // $210568, `st.b $4d(a5)`
        ptr = this.waveform(ptr, 0)
        if (ptr === 0) return
      } else {
        V.synth = 1 // $210574
        V.synBias = -PT_ROW_OFFSET // the `suba.w #$30,a1` on the row pointer
      }
    }
    // after the type is known, because the row pointer a pure synth stores at
    // $4e(a5) is 48 bytes below the one every other instrument stores
    V.period = this.notePeriod(v, note)
    const rec = this.song + (instr - 1) * 8
    const rep = this.w(rec) * 2
    const replen = this.w(rec + 2) * 2
    if (V.syn !== 0) this.synthNoteOn(v)
    // A pure synth has no sample to start: $2102ca leaves its DMA running and
    // the waveform list points it somewhere. Here the first waveform the list
    // selects starts the voice and every one after it swaps the buffer.
    if (V.synth > 0) {
      V.sounding = false
      V.outPeriod = -1
      V.outVol = -1
      return
    }
    const length = this.l(ptr)
    if (length === 0) return
    const d = this.data!
    const start = ptr + 6
    const end = Math.min(d.length, start + length)
    if (start >= end) return
    const pcm = new Int8Array(d.buffer, d.byteOffset + start, end - start)
    let loopStart = -1
    let loopEnd = pcm.length
    if (replen > 2 && rep + replen <= pcm.length) {
      loopStart = rep
      loopEnd = rep + replen
    }
    V.outPeriod = V.period
    V.outVol = V.vol
    V.sounding = true
    if (this.build === 'octamixplayer') {
      // $2111a4: the play pointer, the end and the loop length, as module
      // offsets, because the mixer reads the bank in place
      const mv = this.omixVoices[v]
      if (mv) {
        mv.sample = start
        mv.position = 0
        mv.fraction = 0
        mv.end = (loopStart >= 0 ? start + loopEnd : end) - start
        mv.loopLength = loopStart >= 0 ? loopEnd - loopStart : 0
        mv.flags = loopStart >= 0 ? OMIX_FLAG_LOOP : 0
        mv.sixteenBit = false
        mv.shift = this.omixShiftAmt
        mv.volumeTable = omixVolumeRow(this.omixTable, omixChannelVolume(V.vol, this.trackScale(v)))
        mv.step = this.omixStepFor(V.period)
      }
    } else if (this.build === 'octaplayer') {
      // AUDxLC, AUDxLEN and the loop pointer, as module offsets: the mixer
      // reads the bank in place, exactly as $2108ee does
      const side = this.sides[v]!
      side.at = start
      side.end = loopStart >= 0 ? start + loopEnd : end
      side.loop = loopStart >= 0 ? start + loopStart : 0
      side.period = V.period
    } else {
      this.host.audio.play(v, pcm, periodToHz(V.period), V.vol, loopStart, loopEnd)
    }
    this.onVu?.(v, V.vol)
  }

  /**
   * $21059e: the note-on clear, which wipes $2a through $41 and then puts back
   * the four fields that are not zero.
   */
  private synthNoteOn(v: number): void {
    const V = this.voices[v]!
    V.arpPtr = V.arpLoop = 0
    V.volCount = V.wfCount = 0
    V.volPc = V.wfPc = 0
    V.volWait = V.wfWait = 0
    V.periodStep = V.periodAcc = 0
    V.envPtr = V.envLoop = V.envPos = 0
    V.synVibDepth = V.synVibSpeed = V.synVibPos = 0
    V.synVibWave = -1 // $2105b2, the effect vibrato's own table at $21087a
    V.volSpeed = this.b(V.syn + SYN_VOLSPEED) // $2105be loads both as a word
    V.wfSpeed = this.b(V.syn + SYN_WFSPEED)
    V.volStep = 0
    // $2105c4: command E on this row is the waveform list's start position,
    // put back after the clear
    if (V.cmd === 0xe) V.wfPc = V.data
  }

  /**
   * The per-track tick pass: the hold and decay counters at $210d5c, then the
   * command through the tick table at $210daa, then the period and volume
   * write at $21108e.
   */
  private tickEffect(v: number): void {
    const V = this.voices[v]!
    // $210d5c: the hold runs out, the decay starts, and with no decay the
    // voice's DMA is simply switched off
    if (V.hold >= 0 && --V.hold < 0) {
      V.decayRun = V.decay
      if (V.decayRun === 0) {
        this.host.audio.stop(v)
        V.outPeriod = V.outVol = -1
        V.period = 0
      }
    }
    if (V.decayRun !== 0) {
      V.vol -= V.decayRun
      if (V.vol < 0) {
        V.vol = 0
        V.decayRun = 0
      }
    }
    if (V.period <= 0) return
    let period = this.tickCommand(v)
    // $211072 and $21107e: a synth instrument runs its two scripts between the
    // effect and the register write, and the scripts have the last word
    if (V.syn !== 0) period = this.synthStep(v, period)
    this.writeVoice(v, period)
  }

  /**
   * The tick table at $210daa, which is 32 entries wide because MMD1 stores
   * five bits of command. It returns the period to sound: the handlers that
   * reach $21107e compute a temporary one, and the rest fall through to
   * $21108a and the stored period.
   */
  private tickCommand(v: number): number {
    const V = this.voices[v]!
    const d = V.data
    const t = this.tickCount
    switch (V.cmd) {
      case 0x0: {
        // $210e52: remainder 0 is the LOW nibble, 1 the high, 2 the base note,
        // where ProTracker runs base, high, low
        if (d === 0) break
        const r = t % 3
        const half = r === 0 ? d & 0xf : r === 1 ? d >> 4 : 0
        const idx = V.note - 1 + half + this.transp + V.strans
        if (idx < 0) break
        return this.periodFor(idx, V.finetune)
      }
      case 0x1: // $210dea, clamped at 113 and nowhere else
        if (t === 0 && this.stSlide()) break
        V.period = Math.max(0x71, V.period - d)
        break
      case 0x2: // $210e26, and there is no upper clamp at all
        if (t === 0 && this.stSlide()) break
        V.period += d
        break
      case 0x11: // $210e14: the fine slides move once, on the row tick
        if (t === 0) V.period -= d
        break
      case 0x12:
        if (t === 0) V.period += d
        break
      case 0x13: // $211014: slides for the first three ticks only
        if (t < 3) return V.period - d
        break
      case 0x3: // $210fd4
        if (t === 0 && this.stSlide()) break
        this.portamento(v)
        break
      case 0x5: // $210fc2: portamento and volume slide together
        if (t === 0 && this.stSlide()) break
        this.volumeSlide(v)
        this.portamento(v)
        break
      case 0x4: // $210e98, depth shifted by five
        V.vibShift = 5
        return this.vibrato(v, t !== 0)
      case 0x14: // $210e90, the same with six, so half the depth
        V.vibShift = 6
        return this.vibrato(v, t !== 0)
      case 0x6: // $210ef0: vibrato and volume slide, no parameter reload
        if (t === 0 && this.stSlide()) break
        this.volumeSlide(v)
        return this.vibrato(v, true)
      case 0x7:
        return this.tremolo(v)
      case 0xa:
      case 0xd: // $210f62: one handler for both
        if (t === 0 && this.stSlide()) break
        this.volumeSlide(v)
        break
      case 0x1a: // $210f9e: fine volume slide up, once
        if (t === 0) V.vol = Math.min(64, V.vol + d)
        break
      case 0x1b: // $210fb0
        if (t === 0) V.vol = Math.max(0, V.vol - d)
        break
      case 0x18: // $21103c: cut the note on tick d
        if (t === d) V.vol = 0
        break
      case 0x1e: // $21102e: hold the line, set once
        if (this.lineDelay === 0) this.lineDelay = d + 1
        break
      case 0x1f: {
        // $211046: high nibble delays the note, low nibble retriggers it
        const delay = d >> 4
        if (delay !== 0 && t < delay) break
        if (delay !== 0 && t === delay) this.trigger(v, V.note)
        const every = d & 0xf
        if (every !== 0 && t % every === 0) this.trigger(v, V.note)
        break
      }
      default:
        break
    }
    return V.period + (V.periodFine >> 8)
  }

  /** song flags bit 5: slides skip the row tick, the way ProTracker's do */
  private stSlide(): boolean {
    return (this.flags & 0x20) !== 0
  }

  /** $210fe2, shared by 3 and 5 */
  private portamento(v: number): void {
    const V = this.voices[v]!
    if (V.portTarget === 0) return
    if (V.period <= V.portTarget) {
      V.period += V.portSpeed
      if (V.period >= V.portTarget) {
        V.period = V.portTarget
        V.portTarget = 0
      }
    } else {
      V.period -= V.portSpeed
      if (V.period <= V.portTarget) {
        V.period = V.portTarget
        V.portTarget = 0
      }
    }
  }

  /**
   * $210f76, the worker behind A, D, 5 and 6. A zero high nibble slides DOWN
   * by the whole byte, which is the low nibble, and anything else slides up
   * by the high nibble. It works on the already-scaled volume.
   */
  private volumeSlide(v: number): void {
    const V = this.voices[v]!
    const up = V.data & 0xf0
    if (up === 0) V.vol = Math.max(0, V.vol - V.data)
    else V.vol = Math.min(64, V.vol + (up >> 4))
  }

  /** $210e9e and the body at $210ec0 */
  private vibrato(v: number, skipParams: boolean): number {
    const V = this.voices[v]!
    if (!skipParams && V.data !== 0) {
      const depth = V.data & 0xf
      if (depth !== 0) V.vibDepth = depth
      const speed = V.data & 0xf0
      if (speed !== 0) V.vibSpeed = (speed >> 3) & 0x3e
    }
    const delta = (MED_SINUS[(V.vibPos >> 2) & 0x1f]! * V.vibDepth) >> V.vibShift
    V.vibPos = (V.vibPos + V.vibSpeed) & 0xff
    return V.period + delta
  }

  /**
   * $210f02. The position steps by three bits rather than the vibrato's two,
   * so the same nibble is twice the speed, and the result is a volume for one
   * tick rather than a period.
   *
   * DEFECT: `$210f18` branches to $210ec0 when the speed nibble is zero, and
   * $210ec0 is the VIBRATO body. So `7x0` bends the pitch with the vibrato's
   * depth and speed instead of shaking the volume.
   */
  private tremolo(v: number): number {
    const V = this.voices[v]!
    if (this.tickCount === 0 && V.data !== 0) {
      const depth = V.data & 0xf
      if (depth !== 0) V.tremDepth = depth
      if ((V.data & 0xf0) === 0) return this.vibrato(v, true)
      V.tremSpeed = ((V.data & 0xf0) >> 2) & 0x3e
    }
    const delta = (MED_SINUS[(V.tremPos >> 3) & 0x1f]! * V.tremDepth) >> 7
    V.tremPos = (V.tremPos + V.tremSpeed) & 0xff
    V.tremVol = Math.max(0, Math.min(64, V.vol + delta))
    return V.period
  }

  /**
   * One step of a synth instrument, $2105d6 through $210878.
   *
   * Two independent interpreters run here, each with its own program counter,
   * its own speed counter and its own wait: the volume list over `volTable`
   * at $16 of the SynthInstr, and the waveform list over `wfTable` at $96.
   * Each can jump the other's program counter, which is how a MED synth
   * instrument keeps its pitch and its volume in step.
   *
   * The volume the list produces REPLACES the note's ($2106fe writes $4c(a5)
   * straight into $2(a5)), so a volume slide or a tremolo on a synth track is
   * overwritten the same tick it is computed.
   */
  private synthStep(v: number, period: number): number {
    const V = this.voices[v]!
    let d5 = period
    // the volume list's speed gate, $2105e2
    if (--V.volCount <= 0) {
      V.volCount = V.volSpeed
      if (V.volStep !== 0) V.volOut = Math.max(0, Math.min(64, V.volOut + V.volStep))
      if (V.envPtr !== 0) {
        // $21060a: the envelope reads one byte of a waveform per step and
        // scales it into 0..63. 128 bytes in, it either loops or stops.
        V.volOut = ((this.b(V.envPtr) + 0x80) & 0xff) >> 2
        V.envPtr++
        if (++V.envPos >= 0x80) {
          V.envPos = 0
          V.envPtr = V.envLoop
        }
      }
      this.volList(v)
    }
    V.vol = V.volOut // $2106fe
    // the waveform list's own gate, $210708
    if (--V.wfCount <= 0) {
      V.wfCount = V.wfSpeed
      if (V.periodStep !== 0) V.periodAcc = (V.periodAcc + V.periodStep) & 0xffff
      const reset = this.wfList(v)
      if (reset) d5 = V.period
    }
    // the arpeggio run, $210818
    if (V.arpPtr !== 0) {
      const step = (this.b(V.syn + SYN_WFTABLE + V.arpPtr) << 24) >> 24
      d5 = this.periodFor(V.baseNote + step + V.synBias, V.finetune)
      let next = V.arpPtr + 1
      if (this.b(V.syn + SYN_WFTABLE + next) >= SYN_CMD) next = V.arpLoop
      V.arpPtr = next
    }
    // the synth's own vibrato, $210842, which reads the position four bits up
    // where the effect vibrato reads it two, and scales by 256 not 32
    if (V.synVibDepth !== 0) {
      const pos = (V.synVibPos >> 4) & 0x1f
      const wave = V.synVibWave < 0 ? MED_SINUS[pos]! : (this.b(V.synVibWave + pos) << 24) >> 24
      d5 += (wave * V.synVibDepth) >> 8
      V.synVibPos = (V.synVibPos + V.synVibSpeed) & 0xffff
    }
    d5 = (d5 + ((V.periodAcc << 16) >> 16)) & 0xffff
    // DEFECT: $21086e reads `cmp.w #$71,d5 / bge / moveq #$71,d1`, and d1 is
    // not the period. The clamp writes a register nothing looks at, so a synth
    // period runs straight past 113 and Paula is handed whatever comes out.
    return (d5 << 16) >> 16
  }

  /**
   * The volume list, $210630. A script byte below $80 is the volume itself; a
   * byte at or above it is a command whose low nibble selects the handler, and
   * the interpreter keeps going within the same step until it reaches a data
   * byte, a wait or the halt.
   */
  private volList(v: number): void {
    const V = this.voices[v]!
    if (V.volWait !== 0 && --V.volWait > 0) return
    const table = V.syn + SYN_VOLTABLE
    let pc = V.volPc & 0xff
    // DEVIATION: the library will spin forever on a list that jumps to itself,
    // because nothing counts its steps. This gives up after 256.
    for (let guard = 0; guard < 256; guard++) {
      const b = this.b(table + pc)
      if (b < SYN_CMD) {
        V.volOut = b
        V.volPc = (pc + 1) & 0xff
        return
      }
      const arg = this.b(table + pc + 1)
      switch (b & 0xf) {
        case 0x0: // $21068a: this list's speed
          V.volSpeed = arg
          pc += 2
          break
        case 0x1: // $210692: wait
          V.volWait = arg
          V.volPc = (pc + 2) & 0xff
          return
        case 0x2: // $2106a4: step the volume down each step
          V.volStep = -((arg << 24) >> 24)
          pc += 2
          break
        case 0x3: // $21069c: step it up
          V.volStep = (arg << 24) >> 24
          pc += 2
          break
        case 0x4: // $2106bc: run a waveform as the envelope, once
        case 0x5: // $2106d2: and again, looping
          V.envPtr = this.waveform(V.syn, arg) + 2
          V.envLoop = (b & 0xf) === 5 ? V.envPtr : 0
          V.envPos = 0
          pc += 2
          break
        case 0x6: // $2106de: no envelope
          V.envPtr = 0
          pc += 1
          break
        case 0xa: // $2106b0: jump the WAVEFORM list
          V.wfPc = arg
          V.wfWait = 0
          pc += 2
          break
        case 0xe: // $210684
          pc = arg
          break
        case 0xb: // $2106f8: halt, by storing the pc back on top of itself
        case 0xf:
          V.volPc = pc & 0xff
          return
        default: // $2106fa: a byte and a step, and nothing else
          V.volPc = (pc + 1) & 0xff
          return
      }
    }
    V.volPc = pc & 0xff
  }

  /**
   * The waveform list, $210716. Returns true when the list reset the pitch,
   * which is the one thing it does to the period directly ($2107f8).
   */
  private wfList(v: number): boolean {
    const V = this.voices[v]!
    if (V.wfWait !== 0 && --V.wfWait > 0) return false
    const table = V.syn + SYN_WFTABLE
    let pc = V.wfPc & 0xff
    let reset = false
    for (let guard = 0; guard < 256; guard++) {
      const b = this.b(table + pc)
      if (b < SYN_CMD) {
        // $210742: a data byte points the voice's DMA at that waveform
        this.setWaveform(v, b)
        V.wfPc = (pc + 1) & 0xff
        return reset
      }
      const arg = this.b(table + pc + 1)
      switch (b & 0xf) {
        case 0x0: // $2107b4
          V.wfSpeed = arg
          pc += 2
          break
        case 0x1: // $2107be
          V.wfWait = arg
          V.wfPc = (pc + 2) & 0xff
          return reset
        case 0x2: // $2107e0: the period climbs by this much each step
          V.periodStep = arg
          pc += 2
          break
        case 0x3: // $2107ee: and falls
          V.periodStep = (-arg << 16) >> 16
          pc += 2
          break
        case 0x4: // $2107c8: vibrato depth
          V.synVibDepth = arg
          pc += 2
          break
        case 0x5: // $2107d2: vibrato speed, stored one higher than written
          V.synVibSpeed = (arg + 1) & 0xff
          pc += 2
          break
        case 0x6: // $2107f8: back to the note's own period
          V.periodAcc = 0
          reset = true
          pc += 1
          break
        case 0x7: // $210786: a waveform to shape the vibrato with
          V.synVibWave = this.waveform(V.syn, arg) + 2
          pc += 2
          break
        case 0xa: // $210804: jump the VOLUME list
          V.volPc = arg
          V.volWait = 0
          pc += 2
          break
        case 0xc: {
          // $2107a2: the arpeggio. The run of data bytes that follows becomes
          // the note offsets, and the list carries on past the ARE that ends
          // it, so the run costs the interpreter nothing per step.
          V.arpPtr = V.arpLoop = (pc + 1) & 0xff
          let j = pc + 1
          while (j < 0x100 && this.b(table + j) < SYN_CMD) j++
          pc = j + 1
          break
        }
        case 0xd: // $21073a: the end of an arpeggio run, and a no-op reaching it
          pc += 1
          break
        case 0xe: // $21079c
          pc = arg
          break
        case 0xb: // $210812: halt
        case 0xf:
          V.wfPc = pc & 0xff
          return reset
        default: // $210814: a wasted step
          V.wfPc = (pc + 1) & 0xff
          return reset
      }
    }
    V.wfPc = pc & 0xff
    return reset
  }

  /**
   * $210748: a waveform's first word is its length in words and its samples
   * follow, and the list writes them to AUDxLEN and AUDxLC.
   *
   * DEVIATION: on the machine those registers reload the DMA at the end of the
   * current pass, so a waveform swap never restarts the voice. `setWaveform`
   * is the sink's version of that ($117 added it for THX) and it is optional,
   * so a sink without one gets a `play` and an audible click.
   */
  /**
   * Waveform `n` of the synth instrument at `syn`, as an offset in the module.
   *
   * The pointer stored at $116 is relative to the INSTRUMENT and not to the
   * module, which is the one place `MEDRelocModule` departs from the rule the
   * rest of the format follows. $212dba is the primitive every other pointer
   * goes through, `add.l d1,(a0)+` with d1 the module base; the waveform loop
   * at $212daa is `add.l d3,(a3)+` and d3 is the instrument's own address,
   * just relocated one instruction earlier at $212d92.
   *
   * It relocates `wforms` of them ($14, `move.w $14(a3),d2`), which is why the
   * waveform data starts immediately after that many longs rather than after a
   * fixed 64. DEVIATION: past that count the library adds nothing and follows
   * the raw value into the bottom of the module. This reads it as absent.
   */
  private waveform(syn: number, n: number): number {
    if (n < 0 || n >= this.w(syn + SYN_WFORMS)) return 0
    return syn + this.l(syn + SYN_WAVEFORMS + n * 4)
  }

  private setWaveform(v: number, n: number): void {
    const V = this.voices[v]!
    const ptr = this.waveform(V.syn, n)
    if (ptr === 0) return
    const words = this.w(ptr)
    const d = this.data!
    const start = ptr + 2
    const end = Math.min(d.length, start + words * 2)
    if (words === 0 || start >= end) return
    if (this.build === 'octamixplayer') {
      const mv = this.omixVoices[v]
      if (mv) {
        mv.sample = start
        mv.position = 0
        mv.fraction = 0
        mv.end = end - start
        mv.loopLength = end - start
        mv.flags = OMIX_FLAG_LOOP
        mv.sixteenBit = false
        mv.shift = this.omixShiftAmt
        mv.volumeTable = omixVolumeRow(this.omixTable, omixChannelVolume(V.vol, this.trackScale(v)))
        mv.step = this.omixStepFor(V.period)
      }
      V.sounding = true
      return
    }
    if (this.build === 'octaplayer') {
      const side = this.sides[v]!
      side.at = start
      side.end = end
      side.loop = start
      side.period = V.period
      V.sounding = true
      return
    }
    const pcm = new Int8Array(d.buffer, d.byteOffset + start, end - start)
    if (V.sounding && this.host.audio.setWaveform) {
      this.host.audio.setWaveform(v, pcm)
      return
    }
    V.sounding = true
    V.outPeriod = V.period
    V.outVol = V.vol
    this.host.audio.play(v, pcm, periodToHz(V.period), V.vol, 0, pcm.length)
  }

  /**
   * $21108e: period to AUDxPER, then volume to AUDxVOL unless the period came
   * out zero. The tremolo's volume at $61(a5) wins for exactly one tick and
   * is spent by the write.
   */
  private writeVoice(v: number, period: number): void {
    const V = this.voices[v]!
    if (this.build === 'octamixplayer') {
      // $211132 and $2111be: a step and a table row, because a mixed channel
      // has neither an AUDxPER nor an AUDxVOL of its own
      const mv = this.omixVoices[v]
      V.outVol = V.tremVol >= 0 ? V.tremVol : V.vol
      V.tremVol = -1
      if (mv) {
        // $211140: a period of nothing takes the channel OUT rather than
        // stopping it at a step of zero
        if (period <= 0) mv.flags |= OMIX_FLAG_OFF
        else mv.step = this.omixStepFor(period)
        mv.volumeTable = omixVolumeRow(this.omixTable, omixChannelVolume(V.outVol, this.trackScale(v)))
      }
      return
    }
    if (this.build === 'octaplayer') {
      // $6(a2) and $7e(a2), which the mixer divides into rather than a
      // register Paula reads: a mixed track has no AUDxPER of its own
      this.sides[v]!.period = period
      V.outVol = V.tremVol >= 0 ? V.tremVol : V.vol
      V.tremVol = -1
      return
    }
    if (period !== V.outPeriod) {
      V.outPeriod = period
      if (period > 0) this.host.audio.setFrequency(v, periodToHz(period))
    }
    if (period === 0) return
    const vol = V.tremVol >= 0 ? V.tremVol : V.vol
    V.tremVol = -1
    if (vol !== V.outVol) {
      V.outVol = vol
      this.host.audio.setVolume(v, vol)
    }
  }
}
