/**
 * BP SoundMon 2.0 — the replay, off `DME_SoundMon2.0.library`.
 *
 * The format is `soundmon.ts`. This is the tick, the ten row commands and the
 * synth, and the synth is the reason the format exists: a SoundMon instrument
 * can be three modulator scripts instead of audio, and the third of them
 * REWRITES THE PLAYING WAVEFORM IN PLACE while the voice is on it.
 *
 * ## Evidence
 *
 * `DME_SoundMon2.0.library` at $210000, hunk 0 code ($210000+3340). The
 * veneer is the one `DME_SoundFX1.3.library` and both FutureComposers carry,
 * at $21034e: four vu bytes, the end flag at +$4, the master at +$6, its saved
 * copy at +$8 and four voice enables from +$a. Four channels straight onto
 * Paula, so there is no mixer here.
 *
 * ## The tick, $210698
 *
 * `bsr $210b60` runs the modulators for every voice whose `$1a` says it is a
 * synth, then `$210d99` counts down. Per voice: the period gains the signed
 * per-tick slide at `$c`, AUDxPER takes it UNLESS the pitch modulator owns the
 * register (`$1e`), AUDxLC and AUDxLEN are rewritten, and the arpeggio picks a
 * note off `$b` and `$d` by which of the three phases `$210d99` is on.
 *
 * The speed counter at `$210d97` then falls, and on zero the row is read.
 *
 * ## The period table
 *
 * $210e82, 48 words, four octaves from 856 down to 57. It is NOT ProTracker's
 * and `notes.ts` cannot supply it: 760 where ProTracker has 762, 680 where it
 * has 678, and a fourth octave ProTracker never had. A note is ONE-BASED into
 * it (`-$2(a4,d3.w)` at $210b58 after `asl.w #$1`).
 *
 * ## The row, $2107ba
 *
 * A cell is a note, then the instrument in the high nibble of byte 1 with the
 * command in the low one, then a parameter. The step's two transposes are
 * added to the note and to the instrument, and command $a suppresses one or
 * the other: a nonzero HIGH nibble of the parameter cancels the note
 * transpose ($210840) and a nonzero LOW nibble cancels the sound transpose
 * ($21088e). The same command, two independent switches.
 *
 * A new note sets bit 15 of the period word, which is what $210798 tests
 * before triggering.
 *
 * ## The synth, $210ba0
 *
 * Three modulators, each with an enable byte, a table, a length, a speed and a
 * position, and each clearing its own enable at the wrap when the enable byte
 * is exactly 1 --- so 1 is one-shot and 2 loops forever.
 *
 *   volume  $1f  scales `(byte + $80) >> 2` by the voice volume, over 64
 *   pitch   $1e  adds `byte / record[$0b]` to the period, and OWNS AUDxPER
 *   shape   $1d  rewrites the waveform
 *
 * The shape modulator is the interesting one. Each voice keeps a 32-byte
 * BACKUP of the waveform it started on ($210b1a copies eight longs into
 * `$210daa + voice * $24 + 4`), and the modulator turns a byte of its table
 * into a width of 0 to 31. When the width grows it copies backup bytes forward
 * NEGATED ($210ce0); when it shrinks it copies them back unaltered ($210cd2).
 * So the waveform is the original with its first `width` bytes inverted, and
 * sweeping the width sweeps a pulse. That is SoundMon's sound.
 *
 * A trigger restores the backup first ($2109ac), because the last note left
 * the shared table mangled.
 */

import type { AudioSink } from './host'
import { clampVolume, PAULA_CLOCK, periodToHz } from './paula'
import type { SmonSong, SmonSynth } from './soundmon'

/**
 * The 48 words at $210e82: four octaves, and not ProTracker's.
 *
 * 760, 680, 572, 540, 452, 380, 340, 302, 286, 270 and 226 all differ from
 * the equivalents in `notes.ts`, and nothing there has a fourth octave, so
 * this is the library's own and is carried rather than derived.
 */
export const SMON_PERIODS: readonly number[] = [
  856, 808, 760, 720, 680, 640, 604, 572, 540, 508, 480, 452,
  428, 404, 380, 360, 340, 320, 302, 286, 270, 254, 240, 226,
  214, 202, 190, 180, 170, 160, 151, 143, 135, 127, 120, 113,
  107, 101, 95, 90, 85, 80, 76, 72, 68, 64, 60, 57,
]

/** `move.b #$3,$210d99` at $21074c: the arpeggio walks three phases */
export const SMON_ARP_PHASES = 3
/** `moveq #$7,d4` and four bytes a pass at $210b1a */
export const SMON_BACKUP_BYTES = 32
/** `move.b #$ff,$2(a1)` at $210866: take the record's own volume */
export const SMON_VOLUME_DEFAULT = 0xff

const s8 = (n: number): number => (n << 24) >> 24
const u8 = (n: number): number => n & 0xff

/** the $20-byte block at $210d10 + voice * $20, plus what a synth needs */
interface Voice {
  /** `(a0)`: the period the row set, before the modulators touch it */
  period: number
  /** bit 15 of that word: a note is waiting to be triggered */
  retrigger: boolean
  /** `$2`: 0..64, and $ff until a note takes the record's default */
  volume: number
  /** `$3`: the instrument, after the step's sound transpose */
  instrument: number
  /** `$4` and `$8`: what AUDxLC and AUDxLEN are rewritten with every tick */
  pcm: Int8Array | null
  words: number
  loopStart: number
  loopEnd: number
  /** `$a`, `$b`, `$c`, `$d`: the note, two arpeggio bytes and the slide */
  note: number
  arp1: number
  slide: number
  arp2: number
  /** `$e`, `$10`, `$12`: where the three modulators have got to */
  shapePos: number
  pitchPos: number
  volPos: number
  /** `$14`, `$16`, `$18`: and how many ticks until each moves again */
  shapeCount: number
  pitchCount: number
  volCount: number
  /** `$1a`: this voice is running a synth rather than a sample */
  synth: boolean
  /** `$1c`: the width the shape modulator last wrote */
  width: number
  /** `$1d`, `$1e`, `$1f`: 0 off, 1 one-shot, 2 looping */
  shapeOn: number
  pitchOn: number
  volOn: number
  /** `$210daa + v * $24`: the untouched first 32 bytes of the waveform */
  backup: Int8Array
  /** the record the synth reads, kept whole rather than copied field by field */
  script: SmonSynth | null
}

const newVoice = (): Voice => ({
  period: 0, retrigger: false, volume: 0, instrument: 0,
  pcm: null, words: 0, loopStart: 0, loopEnd: 0,
  note: 0, arp1: 0, slide: 0, arp2: 0,
  shapePos: 0, pitchPos: 0, volPos: 0,
  shapeCount: 0, pitchCount: 0, volCount: 0,
  synth: false, width: 0, shapeOn: 0, pitchOn: 0, volOn: 0,
  backup: new Int8Array(SMON_BACKUP_BYTES), script: null,
})

/**
 * The replay: one `tick()` is one interrupt.
 *
 * DEVIATION: the tick runs from the frame loop at 50Hz. $21040c hangs it off a
 * CIA timer with the same fixed `1775101 / 125` divisor every other DOOM
 * library uses, and there is no interrupt here to hang one off.
 */
export class SoundMon {
  song: SmonSong | null = null
  readonly voices: Voice[] = [newVoice(), newVoice(), newVoice(), newVoice()]

  /** `$210d92` and `$210d94`, the position and the row as a byte offset */
  position = 0
  rowByte = 0
  /** `$210d95` and `$210d96`, out of the step the position names */
  soundTranspose = 0
  noteTranspose = 0
  /** `$210d97` and `$210d98` */
  counter = 1
  speed = 1
  /** `$210d99`, which counts 3, 2, 1 and reloads */
  arpPhase = SMON_ARP_PHASES
  /** `$210d9a`, the counter commands 6 and 7 share */
  loopCount = 0
  /** the veneer's block at $21034e */
  master = 0x40
  savedMaster = 0x40
  enabled = 0b1111
  readonly vu = new Uint8Array(4)
  end = false
  playing = false

  constructor(private readonly sinkOf: () => AudioSink | undefined) {}

  private get sink(): AudioSink | undefined {
    return this.sinkOf()
  }

  /** LVO -30 at $21018c: the module, `InitModule`, then the timer */
  load(song: SmonSong): void {
    this.song = song
    this.position = 0
    this.rowByte = 0
    this.soundTranspose = 0
    this.noteTranspose = 0
    this.counter = 1
    this.speed = 1
    this.arpPhase = SMON_ARP_PHASES
    this.loopCount = 0
    this.end = false
    this.playing = true
    this.vu.fill(0)
    for (let v = 0; v < 4; v++) {
      this.voices[v] = newVoice()
      this.sink?.stop(v)
    }
  }

  /** LVO -36 at $2101d8, and the master saved the way the shared veneer does */
  stop(): void {
    this.playing = false
    for (let v = 0; v < 4; v++) this.sink?.stop(v)
    this.savedMaster = this.master
    if (this.master === 0) this.master = 0x40
  }

  /** LVO -84 at $210208 */
  cont(): void {
    this.master = this.savedMaster
    this.playing = true
  }

  /** LVO -60 at $210288 and -66 at $2102a4 */
  nextPattern(): void {
    this.position = u8(this.position + 1)
    this.rowByte = 0
  }

  prevPattern(): void {
    this.position = this.position > 0 ? this.position - 1 : 0
    this.rowByte = 0
  }

  setVoices(mask: number): void {
    this.enabled = mask
    for (let v = 0; v < 4; v++) {
      if (mask & (1 << v)) continue
      this.sink?.setVolume(v, 0)
    }
  }

  readVu(channel: number): number {
    const n = this.vu[channel] ?? 0
    if (channel >= 0 && channel < 4) this.vu[channel] = 0
    return n
  }

  readEnd(): boolean {
    const was = this.end
    this.end = false
    return was
  }

  /** one interrupt: $210698 */
  tick(): void {
    if (!this.song || !this.playing) return

    // $210b60: the synth first, so a modulator's AUDxPER survives the pass below
    for (let v = 0; v < 4; v++) {
      if (!(this.enabled & (1 << v))) continue
      const ch = this.voices[v]!
      if (ch.synth) this.modulate(v, ch)
    }
    this.arpPhase = u8(this.arpPhase - 1)

    for (let v = 0; v < 4; v++) {
      if (!(this.enabled & (1 << v))) continue
      const ch = this.voices[v]!
      // $2106c0: the slide is a SIGNED byte added to the period every tick
      ch.period = (ch.period + s8(ch.slide)) & 0xffff
      // $2106c2: the pitch modulator owns AUDxPER while it is running
      if (ch.pitchOn === 0) this.setPeriod(v, ch.period & 0x7fff)
      if (ch.arp1 !== 0 || ch.arp2 !== 0) this.arpeggio(v, ch)
    }
    // $210744: the phase reloads only after all four voices have seen it
    if (this.arpPhase === 0) this.arpPhase = SMON_ARP_PHASES

    this.counter = u8(this.counter - 1)
    if (this.counter !== 0) return
    this.counter = this.speed
    this.rowPass()

    // $210798: a note set bit 15, and only then is the channel retriggered
    for (let v = 0; v < 4; v++) {
      if (!(this.enabled & (1 << v))) continue
      const ch = this.voices[v]!
      if (!ch.retrigger) continue
      ch.retrigger = false
      this.trigger(v, ch)
    }
  }

  /* ---- the row, $2107ba ---- */

  private rowPass(): void {
    const song = this.song!
    const step = song.sequence[this.position % Math.max(1, song.steps)] ?? []
    for (let v = 0; v < 4; v++) {
      const ch = this.voices[v]!
      const slot = step[v]
      if (!slot) continue
      this.soundTranspose = slot.soundTranspose
      this.noteTranspose = slot.noteTranspose
      const pattern = song.patterns[slot.pattern - 1]
      const cell = pattern?.[this.rowByte / 3]
      if (!cell) continue

      if (cell.note !== 0) {
        ch.slide = 0
        // $210840: a nonzero HIGH nibble of an $a parameter cancels the note
        // transpose, and the LOW nibble cancels the sound transpose below
        const keepNote = cell.command === 0x0a && (cell.param & 0xf0) !== 0
        const note = keepNote ? cell.note : cell.note + this.noteTranspose
        ch.note = note
        ch.period = (SMON_PERIODS[note - 1] ?? 0) | 0x8000
        ch.retrigger = true
        ch.volume = SMON_VOLUME_DEFAULT

        let inst = cell.instrument
        if (inst === 0) inst = ch.instrument
        const keepSound = cell.command === 0x0a && (cell.param & 0x0f) !== 0
        if (!keepSound) inst += this.soundTranspose
        // $21089e: a length of one, or a different instrument, restarts it
        if (ch.words === 1 || inst !== ch.instrument) ch.instrument = inst
      }

      const param = cell.param
      switch (cell.command) {
        case 0x0: ch.arp1 = param; break
        case 0x1: ch.volume = param; this.setVolume(v, param); break
        case 0x2: this.counter = param; this.speed = param; break
        case 0x3: if (param === 0) continue; break
        case 0x4: ch.period = (ch.period - param) & 0xffff; ch.arp1 = 0; break
        case 0x5: ch.period = (ch.period + param) & 0xffff; ch.arp1 = 0; break
        case 0x6: this.loopCount = param; break
        case 0x7:
          // $210926: a DBRA on one shared counter, so the jump only fires
          // while the counter has not run out
          this.loopCount = u8(this.loopCount - 1)
          if (this.loopCount !== 0) this.position = param
          break
        case 0x8: ch.slide = param; break
        case 0x9: ch.arp2 = param; break
        default: break
      }
    }

    // $210956: three bytes a row, sixteen rows, then the next step
    this.rowByte += 3
    if (this.rowByte !== 0x30) return
    this.rowByte = 0
    this.position += 1
    if (this.position !== song.steps) return
    this.end = true
    this.position = 0
  }

  /* ---- the trigger, $21099c ---- */

  private trigger(v: number, ch: Voice): void {
    const song = this.song!
    const inst = song.instruments[ch.instrument - 1]
    // $2109ac: put the waveform back before the next note mangles it again
    if (ch.synth && ch.pcm) ch.pcm.set(ch.backup.subarray(0, Math.min(ch.pcm.length, SMON_BACKUP_BYTES)))
    this.setPeriod(v, ch.period & 0x7fff)
    if (!inst) return

    if (!inst.synth) {
      ch.synth = false
      ch.shapeOn = ch.pitchOn = ch.volOn = 0
      ch.script = null
      const s = inst.sample!
      if (s.words === 0) return
      ch.pcm = s.pcm
      ch.words = s.words
      ch.loopStart = Math.min(s.pcm.length, s.repeatStart)
      ch.loopEnd = Math.min(s.pcm.length, ch.loopStart + s.repeatWords * 2)
      if (ch.volume === SMON_VOLUME_DEFAULT) ch.volume = 0x40
      this.play(v, ch)
      return
    }

    // $210a4c: a synth, and every one of its counters is loaded one high
    const k = inst.synthesis!
    ch.synth = true
    ch.script = k
    ch.shapePos = ch.pitchPos = ch.volPos = 0
    ch.shapeCount = k.shapeDelay + 1
    ch.pitchCount = k.pitchDelay + 1
    ch.volCount = 1
    ch.shapeOn = k.shapeOn
    ch.pitchOn = k.pitchOn
    ch.volOn = k.volOn
    if (ch.volume === SMON_VOLUME_DEFAULT) ch.volume = k.volume
    const table = song.waves[k.wave]
    if (!table) return
    // a private copy, because the shape modulator writes into whatever is
    // playing and the tables are shared between voices
    ch.pcm = Int8Array.from(table)
    ch.words = k.words
    ch.loopStart = 0
    ch.loopEnd = Math.min(ch.pcm.length, k.words * 2)
    ch.backup = ch.pcm.slice(0, SMON_BACKUP_BYTES)
    // $210b26: a synth with both a shape enable and a width starts inverted
    if (k.shapeOn !== 0 && k.shapeWidth !== 0) {
      ch.width = k.shapeWidth >> 3
      for (let i = 0; i < Math.min(ch.width, ch.pcm.length); i++) ch.pcm[i] = -ch.pcm[i]!
    }
    this.play(v, ch)
  }

  private play(v: number, ch: Voice): void {
    if (!ch.pcm || ch.pcm.length === 0) return
    const end = Math.max(Math.min(ch.pcm.length, ch.words * 2), ch.loopEnd)
    this.sink?.play(
      v,
      ch.pcm.subarray(0, end),
      periodToHz(Math.max(1, ch.period & 0x7fff), PAULA_CLOCK),
      clampVolume((Math.min(0x40, ch.volume === SMON_VOLUME_DEFAULT ? 0 : ch.volume) * this.master) >> 6),
      ch.loopStart,
      ch.loopEnd,
    )
  }

  /* ---- the three modulators, $210ba0 ---- */

  private modulate(v: number, ch: Voice): void {
    const k = ch.script
    const song = this.song!
    if (!k) return

    if (ch.volOn !== 0 && --ch.volCount === 0) {
      ch.volCount = k.volSpeed
      const table = song.waves[k.volTable]
      const byte = table?.[ch.volPos] ?? 0
      // $210bd6: `addi.b #$80 / lsr.w #$2` turns a signed byte into 0..63
      const level = ((u8(byte + 0x80) >> 2) * ch.volume) >> 6
      this.setVolume(v, level)
      ch.volPos += 1
      if (ch.volPos === k.volLength) {
        ch.volPos = 0
        if (ch.volOn === 1) ch.volOn = 0
      }
    }

    if (ch.pitchOn !== 0 && --ch.pitchCount === 0) {
      ch.pitchCount = k.pitchSpeed
      const table = song.waves[k.pitchTable]
      let d = s8(table?.[ch.pitchPos] ?? 0)
      // $210c40: a divisor of zero is skipped rather than dividing
      if (k.pitchDivide !== 0) d = Math.trunc(d / k.pitchDivide)
      this.setPeriod(v, ((ch.period & 0x7fff) + d) & 0xffff)
      ch.pitchPos += 1
      if (ch.pitchPos === k.pitchLength) {
        ch.pitchPos = 0
        if (ch.pitchOn === 1) ch.pitchOn = 0
      }
    }

    if (ch.shapeOn !== 0 && --ch.shapeCount === 0) {
      ch.shapeCount = k.shapeSpeed
      const table = song.waves[k.shapeTable]
      const byte = table?.[ch.shapePos] ?? 0
      // $210cb2: `>> 3` this time, so a width is 0 to 31
      const want = u8(byte + 0x80) >> 3
      const had = ch.width
      ch.width = want
      const buf = ch.pcm
      if (buf) {
        if (want < had) {
          // $210cd2: walk both back, putting the untouched bytes in
          for (let i = had - 1; i >= want; i--) if (i < buf.length) buf[i] = ch.backup[i] ?? 0
        } else if (want > had) {
          // $210ce0: walk both forward, NEGATING as it goes
          for (let i = had; i < want; i++) if (i < buf.length) buf[i] = -(ch.backup[i] ?? 0)
        }
        if (want !== had) this.sink?.setWaveform?.(v, buf.subarray(0, Math.max(ch.loopEnd, ch.words * 2)))
      }
      ch.shapePos += 1
      if (ch.shapePos === k.shapeLength) {
        ch.shapePos = 0
        if (ch.shapeOn === 1) ch.shapeOn = 0
      }
    }
  }

  /** $210b4e, and the arpeggio's three phases off `$b` and `$d` */
  private arpeggio(v: number, ch: Voice): void {
    let note = ch.note
    if (this.arpPhase === 0) note += (ch.arp2 >> 4) + (ch.arp1 >> 4)
    else if (this.arpPhase === 1) note += (ch.arp2 & 0x0f) + (ch.arp1 & 0x0f)
    this.setPeriod(v, SMON_PERIODS[Math.max(0, Math.min(SMON_PERIODS.length - 1, note - 1))] ?? 0)
  }

  /** $21039a: the master over 64, the vu byte, and the voice enable */
  private setVolume(v: number, level: number): void {
    const on = (this.enabled & (1 << v)) !== 0
    const out = on ? (Math.min(0x40, level) * this.master) >> 6 : 0
    this.vu[v] = out & 0xff
    this.sink?.setVolume(v, clampVolume(out))
  }

  private setPeriod(v: number, period: number): void {
    if (period <= 0) return
    this.sink?.setFrequency(v, periodToHz(period, PAULA_CLOCK))
  }
}
