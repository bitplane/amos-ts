/**
 * DME 2.0 — Thomas Reetz's "DOOM Music Extension", at slot 15.
 *
 * Fifteen music formats in one extension, 220 named keywords, and by some
 * distance the widest audio surface in the registry. DOOM Productions was the
 * author's demo group; the game has nothing to do with it.
 *
 * ## Batch 1 of two: the ProTracker block
 *
 * Twelve of the fifteen formats are separate Amiga libraries the extension
 * opens by name — each has its own versioned error string in the hunk, from
 * *"Can't load DME_OctaMix.library V2.0 or higher"* down. FOUR ARE INSIDE
 * THESE 46,208 BYTES and have no library name and no load error anywhere:
 * `ptm`, `thx`, `p61` and `dme sam`, which is the guide's own Internal-Player
 * column to the entry.
 *
 * Those four are also the four this port already has engines for. This batch
 * is the ProTracker block over ../amiga/protracker.ts, plus the 37 `nop`
 * rows; `thx`, `p61` and `dme sam` are the rest of #145 and the eleven
 * external libraries are #146.
 *
 * ## Evidence
 *
 * DISASSEMBLY tier over `AMOSPro_DOOM_Music.Lib`, with `DME_V2.0.guide`
 * (74,389 bytes) beside it. Every citation is an address in the code hunk.
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

/**
 * Routine 301's message table at $ac90, which `L_ErrorExt` is entered with
 * `d1 = 0` and `d2 = $e` — 14, the slot zero-based, so every one is
 * trappable.
 *
 * Only the first is reachable from this batch: `Ptm Load` raises it for a tag
 * it does not know, and `Ptm Play` and `=Ptm Song Length` raise it for a bank
 * that is not a "Tracker " one.
 */
export const DME_ERRORS = ['Not a 4 channel module']

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
  }
  // the vu bytes at `$a(a0)` are the replayer's own, written per trigger and
  // cleared by the reader --- the same read-and-clear AMOS's `Vumeter` has
  ptm.onVu = (voice, volume) => {
    if (voice >= 0 && voice < 4) st.ptmVu[voice] = volume & 0xff
  }
  return st
}

/** routine 92 ($4c86): `moveq #$17,d0 / Rjmp L_Error` */
const badCall = (): never => {
  throw new AmosError('Illegal function call', 23)
}

/** routine 301 with `d0 = $11`, message 0 */
const notAModule = (): never => {
  throw new AmosError(DME_ERRORS[0]!)
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
  }
}

export function makeDmeFunctions(rt: Runtime): Record<string, Func> {
  const st = (): DmeState => rt.dme

  return {
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
     * =Ptm End — routine 296 ($7b5e): `cmpi.w #$ff,$e(a0)`, -1 when the song
     * has wrapped, and `clr.w $e(a0)` on the way out.
     *
     * Cleared by the read, which is the opposite of THX 0.6's `Thx End` —
     * that one latches and only StartSong clears it, so the same question
     * asked of two formats in this extension has two answers.
     */
    'ptm end': () => {
      const s = st()
      const out = s.ptmEnd
      s.ptmEnd = false
      return VI(out ? -1 : 0)
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
  if (!s.ptmPlaying) return
  const before = s.ptm.pos
  s.ptm.tick()
  // the end flag the replayer raises on a wrap; `=Ptm End` reads and clears it
  if (s.ptm.song && before > s.ptm.pos) s.ptmEnd = true
}
