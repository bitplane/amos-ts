/**
 * MusiCRAFT 1.0 — CRAFT's companion, and a ProTracker replayer with eleven
 * keywords bolted to the front of it.
 *
 * The binary was found inside CRAFT's own installer blob: `Data0` holds four
 * executables behind a four-word length table, and `parseAmosLibOld` stops at
 * the first, so `AMOSPro_MusiCRAFT.Lib` sat unread in a file this repo had
 * been disassembling for weeks. 5,648 bytes, of which 4,774 are routine 0 —
 * the player, whose own name string at $1ec is `PT2.1A Replay`.
 *
 * IT IS STOCK PT2.1A. This port does not reimplement it: `../amiga/protracker.ts`
 * is a four-voice ProTracker replay already checked against the corpus and
 * already serving AMCAF, P61, MED, GameSupport and SLN. What is read off this
 * one is what it ADDS, because that is the only place the two can differ:
 *
 *   - a fifth and sixth word on the channel structure, taking `n_sizeof` from
 *     42 to 46: `$2a` is the voice's DMA bit or zero, and `$2c` is the
 *     finetune already multiplied by 72
 *   - four vumeter bytes of its own at $2ee, decayed by `St Vumeter Speed`
 *     every vertical blank and copied into AMOS's own
 *   - a pause word at $13be the tick tests before doing anything
 *   - a start position, checked against 127 and against nothing else
 *
 * ONE THING IT DOES NOT ADD, and it is the same thing SLN's does not add:
 * there is no CIA tempo. Routine 0's `Fxx` arm at $b66 is `move.b 3(a6),d0 /
 * beq / sf.b mt_counter / move.b d0,mt_speed / rts` for every value, so `F80`
 * is a speed of 128 rather than 128 BPM. `ciaTempo = false` says so. Nor does
 * it need the deviation note every other replayer here carries about ticking
 * once a vertical blank, because this one ticks once a vertical blank too:
 * routine 0 installs an exec `AddIntServer` on INTB_VERTB at priority 0, which
 * is why the hook in `Runtime.frame` sits after AMOS's own music rather than
 * in a VblRout slot.
 *
 * The documentation is CRAFT's, because MusiCRAFT never shipped any of its
 * own: nine of the 138 topics in `../craft-1.0/CRAFT_Help.txt` are the `St *`
 * group, and none of those nine is in CRAFT's token table. They cover eleven
 * of these twelve keywords — `St Pause On/Off` is one topic and two tokens —
 * and say nothing at all about the twelfth, `St Volume`, or its reader.
 *
 * The a5-relative base is `$218(a5)`, and it points at $ddc INSIDE the code
 * hunk: the player's routines are at negative offsets from it and its data at
 * positive ones, which is why the addresses cited below all read as base
 * arithmetic. Everything here was read from `AMOSPro_MusiCRAFT.Lib`; where the
 * AMOS 1.3 build differs it is said so, and it differs in exactly one thing
 * that a program can see — the bank range.
 */
import type { Runtime } from './runtime'
import type { Func, Instr } from '../interp/builtins'
import { AmosError, VI, int, type Value } from '../interp/values'
import { ED_RUN_MESSAGES } from '../interp/errors.gen'
import { PT_PERIODS, Protracker, parseMod } from '../amiga/protracker'

/**
 * The one message the extension carries of its own, at $15b0, raised through
 * `L_ErrorExt` with `d2 = 18` — its length, and the whole of the string.
 */
export const MUSICRAFT_ERRORS: readonly string[] = ['Not a tracker bank']

const mcError = (n: number): never => {
  throw new AmosError(MUSICRAFT_ERRORS[n] ?? `MusiCRAFT error ${n}`)
}

/** the numbered errors, raised through `L_Error` — `moveq #n,d0 / Rjmp` */
const amosError = (n: number): never => {
  throw new AmosError(ED_RUN_MESSAGES[n] ?? `error ${n}`, n)
}

/** the name `St Load` gives its bank and `St Play` insists on */
export const TRACK_BANK_NAME = 'Tracker '

/** `=St Version`: routine 15 is `moveq #$64,d3 / moveq #0,d2 / rts` */
export const MUSICRAFT_VERSION = 100

/**
 * `=St Get Volume`: routine 13 is `moveq #$40,d3 / moveq #0,d2 / rts`.
 *
 * A constant, not a reading. See `st volume` for the other half of the pair.
 */
export const MUSICRAFT_VOLUME = 64

/** `n_sizeof`, four bytes longer than ProTracker's own */
const MC_CHANNEL_SIZEOF = 0x2e

/** the zone `=St Base` hands out: the four channel structures and no more */
const MC_ZONE_BYTES = 4 * MC_CHANNEL_SIZEOF

/**
 * The channel structure, which is ProTracker's with two words added.
 *
 * Offsets 0 to $28 are stock and are named the way the replay sources name
 * them. `enable` and `fineOffset` are MusiCRAFT's, and both are written by
 * `mt_init` at $37a — the first to the voice's DMA bit, the second at every
 * instrument change from `lsl.w #3 / move / lsl.w #3 / add`, which is 72 and
 * is the stride of one finetune row through the period table.
 */
const MC_N = {
  note: 0x00,
  cmd: 0x02,
  info: 0x03,
  start: 0x04,
  length: 0x08,
  loopStart: 0x0a,
  repLen: 0x0e,
  period: 0x10,
  finetune: 0x12,
  volume: 0x13,
  dmaBit: 0x14,
  tpDirection: 0x16,
  tpSpeed: 0x17,
  wantedPeriod: 0x18,
  vibratoCmd: 0x1a,
  vibratoPos: 0x1b,
  tremoloCmd: 0x1c,
  tremoloPos: 0x1d,
  waveControl: 0x1e,
  glissFunk: 0x1f,
  sampleOffset: 0x20,
  pattPos: 0x21,
  loopCount: 0x22,
  funkOffset: 0x23,
  waveStart: 0x24,
  realLength: 0x28,
  enable: 0x2a,
  fineOffset: 0x2c,
} as const

/** `move.w d0,$c0(a0)` at $238 — `andi.w #$f,d0` first, so four bits and no more */
const MC_ALL_VOICES = 0b1111

export interface MusicraftState {
  /** the engine, shared with every other module player here */
  replay: Protracker
  /**
   * The word at $1de: routine 0's interrupt server is in the VERTB chain.
   *
   * `St Play` adds it and `St Stop` removes it, and BOTH check first, so a
   * second `St Play` re-inits without a second `AddIntServer` and an `St Stop`
   * with nothing playing does nothing at all — not even silence.
   */
  installed: boolean
  /**
   * The word at $13be, which the tick tests at $3c8 before it does anything.
   *
   * `St Pause On` clears it and `St Pause Off` sets it. It is NOT the same
   * flag as `installed`: the vumeter decay at $278 runs in front of the test,
   * so a paused module's meters keep falling.
   */
  running: boolean
  /** the longword at $13c0 — `St Play`'s bank number, in the AMOS Pro build */
  bank: number
  /** the word at $13bc, whose low byte `=St Channel` reads a bit out of */
  mask: number
  /** the four bytes at $2ee, this extension's own vumeters */
  vu: Uint8Array
  /** the word at $2f2, `St Vumeter Speed`'s setting */
  vuSpeed: number
  /** the block `=St Base` hands out an address for; see `mcZone` */
  zone: Uint8Array
}

export function newMusicraftState(rt?: Runtime): MusicraftState {
  return {
    replay: new Protracker(() => rt?.host.audio),
    // routine 0 writes none of these. The data zone is static inside the code
    // hunk and every field above is assembled as zero: $13ae is the only byte
    // in it that is not, and it is `dc.b 6`, the speed mt_init overwrites with
    // the same 6 anyway
    installed: false,
    running: false,
    bank: 0,
    mask: 0,
    vu: new Uint8Array(4),
    vuSpeed: 0,
    zone: new Uint8Array(MC_ZONE_BYTES),
  }
}

/**
 * `mt_init`'s voice pass at $37a, and `St Voice`'s routine at $22a, which are
 * the same write from two directions: a channel's `$2a` is its DMA bit when
 * the voice is on and zero when it is off, and the replay skips a zero one
 * everywhere — the volume write at $5aa, the trigger at $634, and with it the
 * DMA and the vumeter byte.
 *
 *     btst  d1,d0 / beq .off
 *     bset  d1,$2b(a0)              back on: the bit IS the channel index
 *  .off
 *     tst.w $2a(a0) / beq .next     already off, so nothing to silence
 *     move.w d2,(a1)                AUDxVOL = 0
 *     move.w d2,$14(a0) / move.w d2,$2a(a0)
 *     bset  d1,d3
 *  .next
 *     move.w d3,-2(a1)              DMACON, with bit 15 clear
 *
 * `Protracker.voices` is the same mask from the other side. The silencing is
 * done behind the replay, so `forget` has to follow it or the next tick will
 * believe the hardware already agrees.
 */
function mcVoice(rt: Runtime, mask: number): void {
  const st = rt.musicraft
  const want = mask & MC_ALL_VOICES
  for (let v = 3; v >= 0; v--) {
    if (want & (1 << v)) continue
    if (!(st.mask & (1 << v))) continue
    if (!st.installed) continue // `tst.w d4` — no server, no hardware writes
    rt.host.audio?.setVolume(v, 0)
    rt.host.audio?.stop(v)
  }
  st.mask = want
  st.replay.voices = want
  st.replay.forget()
}

/**
 * Routine 6 — `St Stop`, which is the entry at base-$be2.
 *
 *     move.w $1de(pc),d0 / beq .out      not installed: do nothing
 *     moveq #0,d0 / bsr mcVoice          silence all four
 *     clr.w  $13be                       and stop the tick
 *     RemIntServer / clr.w $1de
 *     bclr #1,$bfe001                    the audio filter back on
 *
 * The filter is the one write here that this port does not model: `mt_init`
 * turns it off with `bset #1,$bfe001` at $350 and this turns it back on, and
 * nothing in the modelled machine hears either.
 */
export function musicraftStop(rt: Runtime): void {
  const st = rt.musicraft
  if (!st.installed) return
  mcVoice(rt, 0)
  st.running = false
  st.installed = false
  st.replay.playing = false
}

/**
 * The vumeter pass at $278, which is the whole of the interrupt server bar the
 * call to the tick — and it brackets that call, half in front and half behind.
 *
 *     move.w $2f2(pc),d1 / beq .free
 *     sub.b  d1,(a0)+ / bpl / move.b d0,-1(a0)     four times, floored at zero
 *     bsr    mt_music
 *     movea.l $2ea(pc),a0 / move.l $2ee(pc),(a0)   all four, zeros and all
 *  .free
 *     move.l d0,(a0)                               its own four cleared first
 *     bsr    mt_music
 *     move.b (a0)+,d0 / beq / move.b d0,(a1)       only the ones it just set
 *
 * `$2ea` is `$f8(a5)`, copied there by routine 0 at $142: AMOS's own vumeter
 * bytes, the four `=Vumeter` reads and clears. So with a speed set MusiCRAFT
 * owns them outright and refills them every frame from a decaying copy, and
 * with the speed at zero it writes only where it has just triggered a note and
 * leaves the rest to AMOS — which is exactly what the help promises: *"If the
 * speed is set to zero, the function =Vumeter works normally."*
 */
export function musicraftVbl(rt: Runtime): void {
  const st = rt.musicraft as MusicraftState | undefined
  if (!st || !st.installed) return
  const free = st.vuSpeed === 0
  if (free) st.vu.fill(0)
  else for (let v = 0; v < 4; v++) st.vu[v] = Math.max(0, st.vu[v]! - st.vuSpeed)
  if (st.running) {
    st.replay.playing = true
    st.replay.tick()
  }
  for (let v = 0; v < 4; v++) {
    const b = st.vu[v]!
    if (free && b === 0) continue
    rt.vuBytes[v] = b
  }
  mcZone(rt)
}

/**
 * Refresh the block `=St Base` hands out.
 *
 * The layout above is the machine's and is complete; what is written into it
 * is not, and cannot be. Sixteen fields are live because the engine holds
 * them: the row cell at $0-$3, the period, finetune and volume, the DMA bit,
 * the tone-portamento pair, the vibrato and tremolo pairs, the sample offset,
 * and MusiCRAFT's own two words. The rest are zero, and they are the ones that
 * are ADDRESSES — `n_start`, `n_loopstart`, `n_wavestart` — together with the
 * lengths that only mean anything beside them. There is no chip RAM here for a
 * sample to live in, so there is no pointer to give.
 *
 * DEVIATION: reads see the mirror, writes do not reach the replay. A `Doke`
 * into `=St Base+$10` changes the period on the machine and is overwritten by
 * the next vertical blank here.
 */
function mcZone(rt: Runtime): Uint8Array {
  const st = rt.musicraft
  const z = st.zone
  const dv = new DataView(z.buffer, z.byteOffset, z.byteLength)
  for (let v = 0; v < 4; v++) {
    const at = v * MC_CHANNEL_SIZEOF
    const ch = st.replay.channels[v]!
    z.fill(0, at, at + MC_CHANNEL_SIZEOF)
    // `move.l (a1)+,(a6)` at $49e — the pattern cell, copied in whole
    dv.setUint16(at + MC_N.note, ((ch.instrument & 0xf0) << 8) | (PT_PERIODS[ch.note] ?? 0))
    z[at + MC_N.cmd] = ((ch.instrument & 0xf) << 4) | (ch.command & 0xf)
    z[at + MC_N.info] = ch.info & 0xff
    dv.setUint16(at + MC_N.period, ch.period & 0xffff)
    z[at + MC_N.finetune] = ch.fine & 0xff
    z[at + MC_N.volume] = ch.volume & 0xff
    dv.setUint16(at + MC_N.dmaBit, st.mask & (1 << v) ? 1 << v : 0)
    z[at + MC_N.tpSpeed] = ch.tpSpeed & 0xff
    dv.setUint16(at + MC_N.wantedPeriod, ch.toPeriod & 0xffff)
    z[at + MC_N.vibratoCmd] = ch.vibCmd & 0xff
    z[at + MC_N.vibratoPos] = ch.vibPos & 0xff
    z[at + MC_N.tremoloCmd] = ch.treCmd & 0xff
    z[at + MC_N.tremoloPos] = ch.trePos & 0xff
    z[at + MC_N.sampleOffset] = ch.offset >> 8 // `lsl.w #8` at the E9x arm
    dv.setUint16(at + MC_N.enable, st.mask & (1 << v) ? 1 << v : 0)
    dv.setUint16(at + MC_N.fineOffset, (ch.fine & 0xf) * 72)
  }
  return z
}

/**
 * `St Play`'s bank, and the whole of MusiCRAFT's type system.
 *
 *     tst.w (a3) / Rbne error 23          the high word of the number
 *     move.l (a3)+,d0 / Rbeq error 23     and zero is not a bank
 *     Rjsr L_Bnk_GetAdr / Rbeq error 36
 *     subq.l #8,a0
 *     cmpi.l #"Trac",(a0)+ / Rbne
 *     cmpi.l #"ker ",(a0)+ / Rbne         -> "Not a tracker bank"
 *
 * The eight bytes in front of a bank's data are its name, so the check is that
 * `St Load` made this bank. Unlike SLN's, which takes an address above 65536
 * and skips the check, there is no back door: a module loaded any other way
 * cannot be played.
 */
function mcBank(rt: Runtime, nr: number): Uint8Array {
  if ((nr >>> 16) !== 0 || nr === 0) amosError(23)
  const bank = rt.memBanks.get(nr)
  if (!bank || bank.kind !== 'memory') amosError(36)
  if (bank!.name.padEnd(8, ' ') !== TRACK_BANK_NAME) mcError(0)
  return (bank as { data: Uint8Array }).data
}

export function makeMusicraftInstructions(rt: Runtime): Record<string, Instr> {
  return {
    /**
     * Routine 3 — `St Load F$,BANK`. *"Loads a sound/noise/protracker module
     * f$ to bank b_nro."*
     *
     * A bank of 65536 or more is error 23 (`tst.w (a3)`), a bank of zero is
     * error 23, and a bank that already exists is error 35 — this does not
     * erase, it refuses. An empty filename is error 23 and one of 1024
     * characters or more is error 23. A file that will not open is error 81,
     * "File format not recognised", which is a strange choice and the
     * routine's own: `moveq #$51,d0` at $1476.
     *
     * The reserve is `Bnk_BitData | Bnk_BitChip` under the name "Tracker ",
     * for the file's length PLUS FOUR. The four bytes are not slack: `mt_init`
     * walks the 31 sample headers writing `clr.l (a2)` at the head of each
     * sample, and the last of those lands one longword past the module.
     *
     * The AMOS 1.3 build does the same thing by hand — `$816(a5)`, eight bytes
     * an entry, its own `"Trac"`/`"ker "` written into the front — and asks
     * for length plus TWELVE, which is the same four bytes with the name in
     * front of them. Its one visible difference is the range: `subq.l #1 /
     * cmp.l #16 / Rbcc`, so 1 to 16 there and 1 to 65535 here.
     *
     * A short read is error 94. Nothing here can produce one: `vfs.read` hands
     * back the whole file or nothing.
     */
    'st load'(it): void {
      const name = it.evalStr()
      it.expect(',')
      const nr = it.evalInt()
      if ((nr >>> 16) !== 0 || nr === 0) amosError(23)
      if (rt.memBanks.has(nr)) amosError(35)
      if (name.length === 0 || name.length >= 0x400) amosError(23)
      const bytes = rt.vfs?.read(name)
      if (!bytes) amosError(81)
      rt.reserveBank(nr, bytes!.length + 4, TRACK_BANK_NAME, true, true)
      rt.memBanks.get(nr)!.data.set(bytes!)
    },
    /**
     * Routines 4 and 5 — `St Play BANK [,POS]`, the one-argument form pushing
     * a zero and falling into the two.
     *
     * `cmp.l #$7f,d7 / Rbhi` is the only check the position gets: 0 to 127,
     * unsigned, and NOT against the song length. Then `mt_init` at $2f4 with
     * the bank address in a0 and the position in d0, `mt_speed` and
     * `mt_counter` both 6 so the first vertical blank plays a row rather than
     * waiting six for it, and the voice mask back to all four.
     *
     * There is no times-to-play: `mt_NextPosition` at $724 is
     * `addq.b #1,d1 / andi.b #$7f,d1 / cmp.b 950(a0),d1 / bcs / moveq #0,d1`
     * and the module runs until something stops it.
     *
     * DEVIATION: a start position past the song length. The machine indexes
     * the whole 128-byte order table with it and plays whatever is there —
     * almost always pattern 0, and one pattern later `mt_NextPosition`'s
     * compare brings it home. `Protracker.load` keeps only the used positions
     * and starts at 0 instead. The two agree for every position the song
     * actually has.
     */
    'st play'(it): void {
      const st = rt.musicraft
      const nr = it.evalInt()
      const pos = it.accept(',') ? it.evalInt() : 0
      if ((pos >>> 0) > 0x7f) amosError(23)
      const data = mcBank(rt, nr)
      const song = parseMod(data)
      // mt_init reads a module rather than validating one; a bank called
      // "Tracker " holding something else walks off the end of it on the
      // machine and there is nothing here to reproduce that with
      if (!song) mcError(0)
      st.bank = nr
      st.running = false
      st.replay.load(song!, pos & 0x7f)
      // `moveq #6,d0 / move.b d0,$5d2(a2) / move.b d0,$5d3(a2)` at $35c: the
      // counter starts AT the speed, so the first tick wraps it immediately
      st.replay.counter = st.replay.speed
      st.replay.ciaTempo = false
      st.replay.trigVolPercent = 100
      st.replay.onVu = (v, vol) => {
        st.vu[v] = vol & 0xff
      }
      // `move.w #$f,$5e0(a2)` at $36c, and the per-channel `$2a` beside it
      st.mask = MC_ALL_VOICES
      st.replay.voices = MC_ALL_VOICES
      st.replay.playing = true
      st.installed = true
      st.running = true
    },
    /** Routine 6 — `St Stop`. *"Stops the music started with St Play."* */
    'st stop'(): void {
      musicraftStop(rt)
    },
    /**
     * Routine 7 — `St Pause On`. `clr.w $5e2(a0)` and then the silence routine
     * at $38c, which zeroes all four AUDxVOL and turns all four DMA channels
     * off whatever the voice mask says.
     */
    'st pause on'(): void {
      const st = rt.musicraft
      st.running = false
      for (let v = 0; v < 4; v++) {
        rt.host.audio?.setVolume(v, 0)
        rt.host.audio?.stop(v)
      }
      st.replay.forget()
    },
    /**
     * Routine 8 — `St Pause Off`. It clears each channel's `n_dmabit` before
     * setting the flag back, which does nothing a program can see: the field
     * is only ever read to turn DMA off ahead of a trigger that is about to
     * set it again from `$2a`. What a program CAN see is that the pause left
     * the voices dead, and nothing here brings them back — each channel is
     * silent until its own next instrument.
     */
    'st pause off'(): void {
      rt.musicraft.running = true
    },
    /**
     * Routine 9 — `St Voice BIT_MASK`. *"This instruction works like the
     * normal AMOS voice instruction; it switches the audio channels on and
     * off."*
     *
     * `andi.w #$f,d0` and no check at all, so `St Voice -1` is all four on and
     * `St Voice 16` is all four off. NOTE the mask does not survive an
     * `St Play`: `mt_init` writes $f over it, so this before that is set for
     * nobody.
     */
    'st voice'(it): void {
      mcVoice(rt, it.evalInt())
    },
    /**
     * Routine 11 — `St Vumeter Speed X`. *"Sets the decreasing speed of the
     * vumeters of the current module."*
     *
     * `cmp.l #$40,d0 / Rbhi` — unsigned, so 0 to 64 and a negative number is
     * error 23. Stored as a word at $2f2 and subtracted from each of the four
     * bytes every vertical blank; see `musicraftVbl` for what zero means.
     */
    'st vumeter speed'(it): void {
      const v = it.evalInt()
      if ((v >>> 0) > 0x40) amosError(23)
      rt.musicraft.vuSpeed = v & 0xffff
    },
    /**
     * Routine 12 — `St Volume`, which the help does not document and which
     * does nothing.
     *
     * DEFECT: the token table gives it the spec `I` — an instruction with no
     * parameters — and the routine is `move.l (a3)+,d0 / rts`, which pops one
     * anyway. Its other half is `=St Get Volume`, four bytes of `moveq #$40,d3`,
     * so there is no volume in this extension at all: the pair is a stub that
     * shipped.
     *
     * DEVIATION: the phantom pop moves AMOS's arithmetic-stack pointer four
     * bytes past whatever the last expression left, and this port has no such
     * stack to move. What the machine does next is not known here, and is not
     * guessed at: the keyword takes nothing and does nothing.
     */
    'st volume'(): void {},
  }
}

export function makeMusicraftFunctions(rt: Runtime): Record<string, Func> {
  return {
    /**
     * Routine 10 — `=St Channel(C)`. *"Returns a value of -1, if the channel c
     * is used by CRAFT module playing system."*
     *
     * `moveq #4,d1 / cmp.l d1,d0 / Rbcc` — unsigned, so 0 to 3 and anything
     * else is error 23. The bit comes out of the low byte of the same word
     * `St Voice` writes, which starts at zero and is only ever $f or a subset
     * of it after the first `St Play`.
     */
    'st channel'(_, a): Value {
      const c = int(a[0]!)
      if ((c >>> 0) >= 4) amosError(23)
      return VI(rt.musicraft.mask & (1 << c) ? -1 : 0)
    },
    /**
     * Routine 14 — `=St Base`. *"Returns the address of the internal data zone
     * of the player routine."*
     *
     * `move.l $218(a5),d3 / addi.l #$496,d3`, which is base+$496 and is the
     * first of the four channel structures — the same four `St Stop` walks at
     * a stride of $2e. See `mcZone` for which of their fields are live here.
     */
    'st base'(): Value {
      return VI(rt.extBlockBase('musicraft', mcZone(rt)))
    },
    /**
     * Routine 15 — `=St Version`. *"Returns the current version number of
     * MusiCRAFT multiplied by 100 (1.00=100)."* `moveq #$64,d3`, in both
     * builds.
     */
    'st version'(): Value {
      return VI(MUSICRAFT_VERSION)
    },
    /** Routine 13 — `=St Get Volume`, a constant. See `st volume` */
    'st get volume'(): Value {
      return VI(MUSICRAFT_VOLUME)
    },
  }
}
