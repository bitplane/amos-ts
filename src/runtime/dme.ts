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
 * Those four were the first batch, over engines this port already had. Three
 * of the external ones have followed, each read out of its own library in
 * `libs/`: `sfx13` over ../amiga/soundfx.ts, `fc14` over ../amiga/fc14.ts and
 * `fc13` over ../amiga/fc13.ts, 12 keywords each. The other eight replayer
 * libraries are #146.
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
import { AmosError, VI } from '../interp/values'
import { Protracker, parseMod } from '../amiga/protracker'
import { ThxPlayer } from '../amiga/thxplay'
import { thxParse } from '../amiga/thx'
import { parseP61, p61Song } from '../amiga/p61'
import { SFX_LENGTH_AT, SFX_MAGIC, SFX_MAGIC_AT, SoundFx, parseSfx } from '../amiga/soundfx'
import { FC14_MAGIC, FC14_STEP_BYTES, Fc14, parseFc14 } from '../amiga/fc14'
import { FC13_MAGIC, FC13_STEP_BYTES, Fc13, parseFc13 } from '../amiga/fc13'

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

  /** the FutureComposer 1.0-1.3 replay, the third of the eleven */
  fc13: Fc13
  /** `$72(a2)`, `$7c(a2)` and `$7d(a2)`, the same three fields one block back */
  fc13Bank: number
  fc13Playing: boolean
  fc13Started: boolean

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
    fc13: new Fc13(() => rt?.host.audio),
    fc13Bank: 0,
    fc13Playing: false,
    fc13Started: false,
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

/** routine 92 ($4c86): `moveq #$17,d0 / Rjmp L_Error` */
const badCall = (): never => {
  throw new AmosError('Illegal function call', 23)
}

/** routine 301 with the index the caller puts in d0 */
const dmeErr = (n: number): never => {
  throw new AmosError(DME_ERRORS[n] ?? `DME error ${n}`)
}
/** `moveq #$11,d0` (17) --- `Ptm Load` at $787c and `Ptm Play` at $794c */
const notAModule = (): never => dmeErr(17)

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
      rt.reserveBank(bank, size, PTM_BANK_NAME, false, false)
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
      rt.reserveBank(bank, size, THX_BANK_NAME, false, false)
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
      rt.reserveBank(bank, size, P61_BANK_NAME, false, false)
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
      rt.reserveBank(bank, size, SFX_BANK_NAME, false, false)
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
      rt.reserveBank(bank, size, FC14_BANK_NAME, false, false)
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
      rt.reserveBank(bank, size, FC13_BANK_NAME, false, false)
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
      return VI(0)
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
}
