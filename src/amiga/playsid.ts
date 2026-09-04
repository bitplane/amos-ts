/**
 * `playsid.library` 1.1, Per Hakan Sundell and Ron Birk, 19 June 1994.
 *
 * The library DME 2.0's nine `sid *` keywords are a veneer over. It is the
 * one external replayer DME does not ship, and its guide says why in its own
 * words: *"To keep the full copyright of this format we didn't enclose the
 * playsid.library"*. It came off Aminet instead, in `mus/play/PlaySID3.lha`,
 * and `fixtures/aminet/PlaySID3/PlaySID3.0/` holds the binary, an `.fd`, the
 * C headers and four documents.
 *
 * ## Why this is here and not in `../runtime`
 *
 * `src/amiga/README.md`'s test is shared AND AmigaOS. This is a standard
 * Amiga shared library that any program could open, the archive documents it
 * as such ("Several people suggested the development of a library to help
 * programs having support for PlaySID modules", Developer.doc), and DME is
 * merely its first caller here. Same shape as `asl.ts` under `aslreq.ts`.
 *
 * ## Evidence
 *
 * `fixtures/aminet/PlaySID3/PlaySID3.0/libs/playsid.library`, 36,764 bytes
 * over five hunks, relocated to $210000 by `loadHunks`. The romtag at
 * $210004 reads "playsid.library 1.1 (19.06.94)". Vectors come from
 * `fd/playsid_lib.fd` rather than from their order, and every address below
 * is in that image.
 *
 *     -30 $21025e  AllocEmulResource   -84 $2104fe  ForwardSong
 *     -36 $2102a0  FreeEmulResource    -90 $210532  RewindSong
 *     -42 $2184c0  ReadIcon            -96 $2102bc  SetVertFreq
 *     -48 $2102f2  CheckModule        -102 $2102e8  SetChannelEnable
 *     -54 $210318  SetModule          -108 $2102e2  SetReverseEnable
 *     -60 $21036e  StartSong
 *     -66 $21044e  StopSong           the four private ones, -114 to -132,
 *     -72 $21048a  PauseSong          are signal plumbing for the PlaySID
 *     -78 $2104b6  ContinueSong       program's time and scope displays
 *
 * `PlaySidBase`'s public head is in playsidbase.h and its private tail is
 * read off the code. The one that matters is `PlayMode` at $2c, which the
 * header declares and $210440, $21047e and $2104aa write, so the two agree.
 *
 *     $2c PlayMode    $46 speed       $6a emul resource allocated
 *     $36 data ptr    $4a flags       $6c module set
 *     $3a data len    $4c song        $6e four channel enables
 *     $3c load        $4e uses CIA
 *     $3e init        $52 vert freq
 *     $40 play        $56 time signal task
 *     $42 songs       $60 display signal task
 *     $44 defsong     $68 reverse
 *
 * ## What the library allocates, off `$21056c`
 *
 * Five blocks, all through exec `AllocMem` at -$c6:
 *
 *     $20000  $152  the 256 generated opcode fragments (see mos6502.ts)
 *     $10000  $156  one byte per C64 address saying what lives there
 *     $10000  $15a  the C64's RAM, with the SID at +$d400
 *      $8004  $15e  the mixing buffers
 *      $8800  $162  CHIP, the waveform tables Paula loops over
 *
 * Only the third and the fifth are behaviour. The first is a code generator's
 * scratch space and the second is a dispatch table, both of which
 * `mos6502.ts` and this file replace with an `if`.
 *
 * ## Three voices onto four Paula channels
 *
 * `playsid.library` does not emulate a SID sample by sample. It precomputes
 * waveform tables in chip RAM and hands them to Paula, one voice each, then
 * rewrites them as the tune changes waveform. `$211362` lays the chip block
 * out and `$2113c0` onwards fills it, and the lengths come from the table at
 * $21401c:
 *
 *     256 182 128 92 64 46 32 24 16 12 8 6 4
 *
 * which is half-octave steps, each about the previous over the square root
 * of two. A voice picks the longest table whose length times its frequency
 * Paula can still clock, so a high note gets four samples a period and a low
 * one gets 256. That is the whole trick, and it is why this sounds like
 * PlaySID rather than like a SID.
 *
 * The fourth channel is not a SID voice. `$21187c` writes $DFF09A, $DFF096,
 * $DFF0D6 and $DFF0D8 --- INTENA, DMACON, AUD3PER and AUD3VOL --- so Paula
 * voice 3 belongs to PlaySID's own sample extension, the one a tune reaches
 * by writing $D41D. `DisplayData` in playsidbase.h says the same thing from
 * the other side: four entries for `Sample`, `Length`, `Period` and `Enve`,
 * three for `SyncLength` and `SyncInd`.
 */
import type { AudioSink } from './host'
import { Mos6502, type Bus } from './mos6502'
import { PAULA_CLOCK, MIN_PERIOD, MAX_VOLUME } from './paula'
import { parsePsid, psidSongUsesCia, SIDF_SIDSONG, type PsidHeader } from './psid'
import { C64_CLOCK_NTSC, C64_CLOCK_PAL, CTRL_GATE, SidChip, sidFreqHz, type SidVoice } from './sidchip'

/** playsidbase.h's eleven error codes, unchanged. */
export const SID_NOMEMORY = -1
export const SID_NOAUDIODEVICE = -2
export const SID_NOCIATIMER = -3
export const SID_NOPAUSE = -4
export const SID_NOMODULE = -5
export const SID_NOICON = -6
export const SID_BADTOOLTYPE = -7
export const SID_NOLIBRARY = -8
export const SID_BADHEADER = -9
export const SID_NOSONG = -10
export const SID_LIBINUSE = -11

/** playsidbase.h's three play modes, which live at `PlaySidBase.PlayMode`. */
export const PM_STOP = 0
export const PM_PLAY = 1
export const PM_PAUSE = 2

/**
 * The waveform table lengths, read out of the library at $21401c.
 *
 * Thirteen of them, terminated by a zero word in the file. `$21140e` divides
 * $10000 by the length to get the step it fills a table with, which is what
 * makes these periods rather than sizes.
 */
export const WAVE_LENGTHS = [256, 182, 128, 92, 64, 46, 32, 24, 16, 12, 8, 6, 4] as const

/** The fastest Paula can be clocked, which is what caps a table's length. */
const MAX_RATE = PAULA_CLOCK / MIN_PERIOD

/**
 * PAL is 50Hz and anything else is 60. `$210a5a` compares `$52(a6)` against
 * $32 and takes the NTSC constants when it differs, so 50 is not a default
 * so much as the only value with its own branch.
 */
export const PAL_VERT_FREQ = 50
export const NTSC_VERT_FREQ = 60

/**
 * The C64 bus the tune's code runs on.
 *
 * 64KB of RAM with the SID folded into $D400 to $D7FF. `$2126c6` builds that
 * as a table, clearing the map to zero below $D400, writing a repeating
 * 32-byte pattern up to $D800 and clearing the rest: the SID's 29 registers
 * mirrored every 32 bytes across its whole kilobyte, which is what the chip
 * does on a real machine.
 */
export class C64Bus implements Bus {
  readonly ram = new Uint8Array(0x10000)
  /** Used by PlaySID's optional reverse log; called before a RAM byte changes. */
  onRamWrite: ((addr: number, previous: number) => void) | null = null

  constructor(readonly sid: SidChip) {}

  read(addr: number): number {
    const a = addr & 0xffff
    if (a >= 0xd400 && a < 0xd800) return this.sid.read(a & 0x1f)
    return this.ram[a]!
  }

  write(addr: number, value: number): void {
    const a = addr & 0xffff
    if (a >= 0xd400 && a < 0xd800) {
      this.sid.write(a & 0x1f, value)
      return
    }
    const v = value & 0xff
    if (this.ram[a] !== v) this.onRamWrite?.(a, this.ram[a]!)
    this.ram[a] = v
  }
}

interface ReverseFrame {
  ram: Map<number, number>
  sid: {
    regs: Uint8Array
    voices: SidVoice[]
    volume: number
    filterCutoff: number
    filterVoices: number
    voice3Off: boolean
    sampleMode: number
  }
  cpu: {
    a: number
    x: number
    y: number
    sp: number
    pc: number
    p: number
    jammed: boolean
    cycles: number
  }
  frames: number
}

interface VoiceOut {
  /** The table length in use, so a change can re-point the DMA. */
  length: number
  rate: number
  volume: number
  buffer: Int8Array | null
}

/**
 * One instance of the library.
 *
 * The real one refuses a second opener --- "The library can only be used by
 * one application at a time", Developer.doc, and `$210262` returns
 * `SID_LIBINUSE` when `$6a(a6)` is already set. That check is on
 * `allocEmulResource` here for the same reason it is there.
 */
export class PlaySid {
  readonly sid: SidChip
  readonly bus: C64Bus
  readonly cpu: Mos6502

  playMode = PM_STOP
  header: PsidHeader | null = null
  /** `$4c(a6)`, zero-based, which is not how `StartSong` takes it. */
  song = 0
  /** `$4e(a6)`, set from the speed bitmap for the song that is playing. */
  usesCia = false
  /** `$52(a6)`. */
  vertFreq = PAL_VERT_FREQ
  /** `$68(a6)`, which `RewindSong` needs set to do anything. */
  reverse = false
  /** `$6e(a6)`, four words, though only three are SID voices. */
  readonly channelEnable = [true, true, true, true]
  /** `$11a(a6)`, the frame counter the time display reads. */
  frames = 0

  private allocated = false
  private moduleSet = false
  private data: Uint8Array | null = null
  private loadAddress = 0
  private initAddress = 0
  private playAddress = 0
  /** Sparse per-play undo records, allocated only while reverse is enabled. */
  private readonly reverseFrames: ReverseFrame[] = []
  private readonly out: VoiceOut[] = [
    { length: 0, rate: 0, volume: -1, buffer: null },
    { length: 0, rate: 0, volume: -1, buffer: null },
    { length: 0, rate: 0, volume: -1, buffer: null },
  ]

  constructor(
    private readonly sinkOf: () => AudioSink | undefined,
    clock = C64_CLOCK_PAL,
  ) {
    this.sid = new SidChip(clock)
    this.bus = new C64Bus(this.sid)
    this.cpu = new Mos6502(this.bus)
  }

  private get sink(): AudioSink | undefined {
    return this.sinkOf()
  }

  /** The φ2 clock, which follows the TV system `SetVertFreq` was told about. */
  get clock(): number {
    return this.vertFreq === PAL_VERT_FREQ ? C64_CLOCK_PAL : C64_CLOCK_NTSC
  }

  // --- the API, in `.fd` order ---------------------------------------------

  /** LVO -30, `$21025e`. */
  allocEmulResource(): number {
    if (this.allocated) return SID_LIBINUSE
    this.bus.ram.fill(0)
    this.sid.reset()
    this.allocated = true
    this.playMode = PM_STOP
    return 0
  }

  /** LVO -36, `$2102a0`: stop first, then let the blocks go. */
  freeEmulResource(): void {
    if (!this.allocated) return
    this.stopSong()
    this.allocated = false
    this.moduleSet = false
  }

  /** LVO -48, `$2102f2`. */
  checkModule(data: Uint8Array | null | undefined): number {
    return parsePsid(data) ? 0 : SID_BADHEADER
  }

  /**
   * LVO -54, `$210318`.
   *
   * The library takes a header and a body separately so a two-part file can
   * name one of each. `$21031e` is the one-part case: when the body starts
   * with 'PSID' too it skips `dataOffset` bytes and shortens the length by
   * the same, which is what makes passing the same pointer twice work.
   */
  setModule(data: Uint8Array | null | undefined): number {
    const header = parsePsid(data)
    if (!header || !data) return SID_BADHEADER
    this.header = header
    this.data = data.subarray(header.dataOffset)
    this.loadAddress = header.loadAddress
    this.initAddress = header.initAddress
    this.playAddress = header.playAddress
    this.moduleSet = true
    return 0
  }

  /**
   * LVO -60, `$21036e`. `tune` is ONE-based and zero means the default.
   *
   * `$21037e`: a zero takes `$44(a6)`, the header's own default song, and
   * then `subq.w #$1` makes it an index. `$210388` compares that index
   * against the song count as UNSIGNED, so song 0 with a default of 0
   * underflows to $ffff and is refused, which is the same `SID_NOSONG` a
   * caller asking for song 99 gets.
   */
  startSong(tune = 0): number {
    if (!this.moduleSet || !this.header) return SID_NOMODULE
    const wanted = tune === 0 ? this.header.defaultSong : tune
    const index = (wanted - 1) & 0xffff
    if (index >= this.header.songs) return SID_NOSONG

    this.song = index
    if (!this.allocated) {
      const err = this.allocEmulResource()
      if (err !== 0 && err !== SID_LIBINUSE) return err
    }
    this.stopSong()

    this.usesCia = psidSongUsesCia(this.header, index)
    this.loadIntoRam()

    // `$210418`: $D418 is set to $0f before init runs, so a tune that never
    // writes a master volume is audible rather than silent.
    this.sid.write(0x18, 0x0f)

    // `$2106ea`: A is the song index, X and Y are zero, SP is $ff.
    this.cpu.runUntilReturn(this.initAddress, index, 0, 0)

    this.playMode = PM_PLAY
    this.frames = 0
    this.reverseFrames.length = 0
    return 0
  }

  /** LVO -66, `$21044e`. Silent, and the emulation resource stays allocated. */
  stopSong(): void {
    if (this.playMode === PM_STOP) return
    this.playMode = PM_STOP
    const sink = this.sink
    for (let v = 0; v < 3; v++) {
      sink?.stop(v)
      this.out[v] = { length: 0, rate: 0, volume: -1, buffer: null }
    }
  }

  /** LVO -72, `$21048a`. Only a PLAYING song can pause. */
  pauseSong(): void {
    if (this.playMode !== PM_PLAY) return
    this.playMode = PM_PAUSE
    for (let v = 0; v < 3; v++) this.sink?.setVolume(v, 0)
  }

  /** LVO -78, `$2104b6`: anything but PM_PAUSE is `SID_NOPAUSE`. */
  continueSong(): number {
    if (this.playMode !== PM_PAUSE) return SID_NOPAUSE
    this.playMode = PM_PLAY
    for (let v = 0; v < 3; v++) this.out[v]!.volume = -1
    return 0
  }

  /**
   * LVO -84, `$2104fe`. "The play routine will be called as many times as
   * given in the speed parameter", Developer.doc.
   */
  forwardSong(speed: number): void {
    if (this.playMode !== PM_PLAY) return
    for (let i = 0; i < speed; i++) this.callPlay()
  }

  /**
   * LVO -90, `$210532`. Developer.doc: "The reverse flag needs to be set!",
   * and the library means it. `$210ef6` restores one entry from the reverse
   * log and `$21054e` decrements the frame counter after each successful
   * restore. The native log is sparse too (its documentation budgets about
   * 30KB per minute), rather than retaining a 64KB RAM image per frame.
   */
  rewindSong(speed: number): void {
    if (this.playMode !== PM_PLAY || !this.reverse) return
    let restored = false
    for (let i = 0; i < speed; i++) {
      const frame = this.reverseFrames.pop()
      if (!frame) break
      restored = true
      for (const [addr, previous] of frame.ram) this.bus.ram[addr] = previous
      this.sid.regs.set(frame.sid.regs)
      for (let v = 0; v < 3; v++) Object.assign(this.sid.voices[v]!, frame.sid.voices[v]!)
      this.sid.volume = frame.sid.volume
      this.sid.filterCutoff = frame.sid.filterCutoff
      this.sid.filterVoices = frame.sid.filterVoices
      this.sid.voice3Off = frame.sid.voice3Off
      this.sid.sampleMode = frame.sid.sampleMode
      Object.assign(this.cpu, frame.cpu)
      this.frames = frame.frames
    }
    if (!restored) return
    for (let v = 0; v < 3; v++) this.out[v]!.volume = -1
    this.render()
  }

  /** LVO -96, `$2102bc`. 50 for PAL or 60 for NTSC, and nothing else has a branch. */
  setVertFreq(hz: number): void {
    this.vertFreq = hz
  }

  /**
   * LVO -102, `$2102e8`: two longs copied into `$6e(a6)`, which is four
   * 16-bit booleans and not a bitmask.
   */
  setChannelEnable(flags: readonly boolean[]): void {
    for (let i = 0; i < 4; i++) this.channelEnable[i] = flags[i] ?? true
    for (let v = 0; v < 3; v++) {
      if (!this.channelEnable[v]) this.sink?.setVolume(v, 0)
      this.out[v]!.volume = -1
    }
  }

  /** LVO -108, `$2102e2`. */
  setReverseEnable(on: boolean): void {
    this.reverse = on
    if (!on) this.reverseFrames.length = 0
  }

  // --- the interrupt --------------------------------------------------------

  /**
   * One frame: the play routine, then the registers it left behind.
   *
   * `$210726` is this. It clears $D41D first (`clr.b $1d(a5)`), so the sample
   * extension only ever sees a write from the frame that made it, runs the
   * play routine, and bumps the frame counter at `$21077c`.
   */
  tick(): void {
    if (this.playMode !== PM_PLAY) return
    this.callPlay()
    this.sid.tickEnvelopes(1 / this.vertFreq)
    this.render()
  }

  private callPlay(): void {
    const reverseFrame = this.reverse ? this.captureReverseFrame() : null
    if (reverseFrame) {
      this.bus.onRamWrite = (addr, previous) => {
        if (!reverseFrame.ram.has(addr)) reverseFrame.ram.set(addr, previous)
      }
    }
    this.sid.sampleMode = 0
    try {
      if (this.playAddress !== 0) {
        this.cpu.runUntilReturn(this.playAddress)
      } else {
        // `$2108a6`: a tune with no play address installed its own interrupt,
        // so the vector it left at $0314 is where the play routine is.
        const vector = this.bus.ram[0x0314]! | (this.bus.ram[0x0315]! << 8)
        if (vector !== 0) this.cpu.runUntilReturn(vector)
      }
    } finally {
      this.bus.onRamWrite = null
    }
    this.frames++
    if (reverseFrame) this.reverseFrames.push(reverseFrame)
  }

  private captureReverseFrame(): ReverseFrame {
    return {
      ram: new Map(),
      sid: {
        regs: this.sid.regs.slice(),
        voices: this.sid.voices.map((voice) => ({ ...voice })),
        volume: this.sid.volume,
        filterCutoff: this.sid.filterCutoff,
        filterVoices: this.sid.filterVoices,
        voice3Off: this.sid.voice3Off,
        sampleMode: this.sid.sampleMode,
      },
      cpu: {
        a: this.cpu.a,
        x: this.cpu.x,
        y: this.cpu.y,
        sp: this.cpu.sp,
        pc: this.cpu.pc,
        p: this.cpu.p,
        jammed: this.cpu.jammed,
        cycles: this.cpu.cycles,
      },
      frames: this.frames,
    }
  }

  /**
   * Put the module where the header says, which is three rules deep.
   *
   * `$2107a0`: a load address of zero means the first two bytes of the data
   * are it, LITTLE-endian --- `movep.w $1(a0),d0 / move.b (a0),d0` --- and
   * they are consumed rather than loaded.
   *
   * `$2107c0`: an init address of zero means the load address.
   *
   * `$2107ce`: `SIDF_SIDSONG` replaces all of it. The library copies 2,048
   * bytes of its own from $213526 to C64 $C000 and forces load $5FFE, init
   * $C7B0 and play 0, because a SIDsong is data for a player the library
   * carries rather than a program of its own. DEVIATION: that 2KB player is
   * not reproduced here, so a SIDsong loads and initialises and makes no
   * sound. Nothing in the corpus is one.
   *
   * `$210806` copies the body in, stopping at $10000 rather than wrapping.
   */
  private loadIntoRam(): void {
    if (!this.data || !this.header) return
    let body = this.data
    let load = this.loadAddress

    if (load === 0) {
      load = (body[0]! | (body[1]! << 8)) & 0xffff
      body = body.subarray(2)
    }
    this.initAddress = this.header.initAddress === 0 ? load : this.header.initAddress

    if (this.header.flags & SIDF_SIDSONG) {
      this.initAddress = 0xc7b0
      this.playAddress = 0
      return
    }

    const room = Math.min(body.length, 0x10000 - load)
    this.bus.ram.set(body.subarray(0, room), load)
  }

  /**
   * The three voices onto Paula, the way `$211362`'s tables are used.
   *
   * A voice picks the longest table whose length times its frequency Paula
   * can still clock. `WAVE_LENGTHS` is the library's own list and `MAX_RATE`
   * is Paula's ceiling, so the choice is the library's arithmetic over this
   * port's chip rather than a rule invented here.
   */
  private render(): void {
    const sink = this.sink
    if (!sink) return

    for (let v = 0; v < 3; v++) {
      const voice = this.sid.voices[v]!
      const out = this.out[v]!
      const hz = sidFreqHz(voice.freq, this.clock)

      const gated = (voice.control & CTRL_GATE) !== 0 || voice.env > 0
      const audible = this.channelEnable[v] && gated && hz > 0 && voice.control >= 0x10
      if (!audible) {
        if (out.volume !== 0) {
          out.volume = 0
          sink.setVolume(v, 0)
        }
        continue
      }

      // The longest table Paula can still clock at this pitch.
      let ideal = WAVE_LENGTHS[WAVE_LENGTHS.length - 1]!
      for (const candidate of WAVE_LENGTHS) {
        if (candidate * hz <= MAX_RATE) {
          ideal = candidate
          break
        }
      }

      // DEVIATION: the length is held rather than re-chosen every frame.
      //
      // On the machine, changing table is `move.l` into AUDxLC and AUDxLEN
      // and the DMA keeps running: the tables sit contiguously in the chip
      // block `$211362` lays out, so re-pointing costs nothing. Here it is a
      // `play()`, which restarts the sample at offset zero. A tune with
      // vibrato sits on a half-octave boundary and crosses it several times
      // a second, which turned into 292 restarts in 300 frames of Last Ninja
      // 2 and a click on each. So the current length stands while it is still
      // inside Paula's range, and is only given up when the pitch has moved
      // a whole octave and the resolution is worth reclaiming.
      let length = out.length
      if (length === 0 || length * hz > MAX_RATE || ideal >= length * 2) length = ideal

      // Noise moves every frame, so its table is rebuilt every frame; the
      // periodic waveforms only change when the tune changes them.
      const noise = (voice.control & 0x80) !== 0
      if (noise) this.sid.clockNoise(voice, length)

      const buffer = new Int8Array(length)
      const prev = this.sid.voices[(v + 2) % 3]!
      for (let i = 0; i < length; i++) {
        const s = this.sid.sampleWaveform(voice, i / length, prev)
        buffer[i] = Math.max(-128, Math.min(127, Math.round(s * 127)))
      }

      const rate = Math.min(MAX_RATE, length * hz)
      const volume = Math.round((voice.env / 255) * (this.sid.volume / 15) * MAX_VOLUME)

      if (out.length !== length || !out.buffer) {
        // The table changed length, so the DMA has to be re-pointed. This is
        // the one place a click is possible, and it is where the library
        // re-points AUDxLC and AUDxLEN too.
        sink.play(v, buffer, rate, volume, 0, length)
        out.length = length
        out.rate = rate
        out.volume = volume
      } else {
        sink.setWaveform?.(v, buffer)
        if (rate !== out.rate) {
          out.rate = rate
          sink.setFrequency(v, rate)
        }
        if (volume !== out.volume) {
          out.volume = volume
          sink.setVolume(v, volume)
        }
      }
      out.buffer = buffer

      // Voice 3 can be cut from the output while still driving $D41B, which
      // is how a tune uses it as a modulation source without hearing it.
      if (v === 2 && this.sid.voice3Off && out.volume !== 0) {
        out.volume = 0
        sink.setVolume(v, 0)
      }
    }
  }
}
