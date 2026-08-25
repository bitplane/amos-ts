/**
 * THX 0.6 — Thomas Nokielski's six keywords over the THX Sound System.
 *
 * The other AMOS front end for the same format is Jotre 1.0 (./jotre.ts), and
 * the two share nothing but the format: different authors, different replayer
 * builds, no byte of extension code in common. This one loads its own files
 * and reserves its own banks, which Jotre never does.
 *
 * ## Evidence
 *
 * DISASSEMBLY tier. `AMOSPRO_THX.lib`, a 4,792-byte code hunk, plus the
 * vendored `THXLib.guide`. Routine 0 is at $94 and the six keywords at $fec,
 * $1040, $105e, $111e, $1156 and $11c8.
 *
 * Identity off the binary: `$VER: AMOSPro THX Sound System Extension 0.6
 * (06-Sep-96)` at $127b, and a second copy without the cookie at $1250.
 *
 * Slot 20, from routine 0's `move.l a4,$228(a5)` — `($228-$f8)/16 + 1 = 20` on
 * the ExtAdr layout +Equ.s:1148-1155 fixes. The Guide agrees, and says it in
 * the imperative: *"click on entry number 20"*.
 *
 * ## What routine 0 installs
 *
 *     lea $1aa(pc),a4 / move.l a4,$228(a5)     the data block at $1aa
 *     lea $184(pc),a3 / move.l a3,$22c(a5)     +$4, the DEFAULT routine
 *     lea $18a(pc),a3 / move.l a3,$230(a5)     +$8, REMOVE
 *     lea $1a4(pc),a3 / move.l a3,$234(a5)     +$c
 *     jsr $4(a3)                               InitPlayer
 *     ... walk $0(a5) upward in fours to $24, looking for a free VblRout ...
 *     lea $fd0(pc),a1 / move.l a1,(a0)
 *
 * The VBL search is what the Guide's install note is about: *"this means, the
 * THX Extension didn't found a free entry in the VBL jump table of AMOSPro"*.
 * Nine slots are tried and a failure returns `moveq #$13,d0`, the slot
 * zero-based, having already opened intuition.library to put a guru up.
 *
 * The VBL hook at $fd0 is four instructions — if the play flag at block+0 is
 * set, call the replayer's tick at jumptable+$10, and otherwise return. That
 * is `thxVbl` below.
 *
 * ## The block, and where the state actually lives
 *
 * The block at $1aa is two bytes of the extension's own and then the
 * replayer's jump table at $1ac:
 *
 *     block+$00   the PLAY flag, and the only state this extension keeps
 *     table+$04   InitPlayer      routine 0
 *     table+$08   InitModule      Thx Play, Thx Subsongs
 *     table+$0c   StartSong       Thx Play
 *     table+$10   the tick        the VBL hook
 *     table+$14   StopSong        Thx Stop
 *     table+$18   EndPlayer       the REMOVE routine, two FreeMems
 *     table+$1c   a POINTER to the replayer's state block
 *     table+$2c   the module address InitModule stored
 *
 * so `Thx Subsongs` and `Thx End` reach through +$1c into the replayer and
 * read bytes of it directly: state+$2 is the subsong count InitModule wrote
 * and state+$3 is the end flag StartSong cleared. Both are `ThxPlayer` fields
 * here — see ../amiga/thxplay.ts.
 *
 * ## The two defects the author declared, and a third he did not
 *
 * Both of his are reproduced, and the first is one instruction long. *"Maybe
 * you know there's a bank check routine in every AMOS Extension to check if a
 * used bank has changed or erased. THIS ROUTINE IS EMPTY! So if you erase a
 * bank which is currently used by the THX replay routine AMOS will crash!"* —
 * the routine routine 0 registers at `$234(a5)` is `$1a4`, and `$1a4` is an
 * `rts`. The second is *"There is also no routine to check, if the bank you
 * access contains a THX module."* Neither `Thx Play` nor `Thx Subsongs` looks
 * at the bank's name or its magic, so a bank holding anything at all is handed
 * to InitModule.
 *
 * The third is his replayer's and he complained about it from the outside:
 * *"There seems to be a bug in the initialisation routine of the THX replayer.
 * It always returns a non-zero value instead as in the docs described."* The
 * disassembly says why. `InitModule` ends `clr.w d0` on success and `moveq
 * #$ff,d0` on failure and BOTH fall into `movem.l (a7)+,d0-d7/a0-a6` at $566,
 * which restores d0 off the stack. The return code is destroyed by the
 * register restore, so it is always the caller's own d0. It makes no
 * difference here: `Thx Play` never tests it, which is why the error message
 * at index 0 cannot be reached and why the Guide calls it *"an error you
 * wan't seen anytime ;)"*.
 */
import { AmosError, VI, int, type Value } from '../interp/values'
import { ED_RUN_MESSAGES } from '../interp/errors.gen'
import { isThxModule, thxParse, type ThxModule } from '../amiga/thx'
import { ThxPlayer } from '../amiga/thxplay'
import type { Func, Instr } from '../interp/builtins'
import type { Runtime } from './runtime'

/**
 * The message table at $1200 — three NUL-separated strings, indexed 0-based by
 * `moveq #n,d0` before the `L_ErrorExt` call.
 *
 * Index 0 has no raiser anywhere in the library. The two that do are the two
 * the Guide describes as reachable, and both come out of `Thx Subsongs`.
 *
 * NOTE: like Jotre, this ships only the message-printing half of the pair. All
 * three raisers are the 4-byte `L_ErrorExt` form, so a program compiled with
 * -E0 has nothing to call.
 */
export const THX_ERRORS = ["Can't initialize module", 'THX is in play-mode', 'Module not initialized']

/** the extension's own errors, `moveq #n,d0` then L_ErrorExt */
const thxError = (n: number): never => {
  throw new AmosError(THX_ERRORS[n] ?? `THX error ${n}`)
}

/** the numbered AMOS errors, `moveq #n,d0 / Rjmp L_Error` */
const amosError = (n: number): never => {
  throw new AmosError(ED_RUN_MESSAGES[n] ?? `error ${n}`, n)
}

/**
 * The name `Thx Load` gives its bank, from the eight bytes at $1116:
 * `54 48 58 4d 6f 64 20 20`.
 *
 * Held trimmed and compared padded, which is the convention `reserveBank`
 * settled. NOTHING compares it — see the bank-check defect above — so it is
 * only ever a label a program can read back with `Bank$`.
 */
export const THX_BANK_NAME = 'THXMod'

export interface ThxState {
  /**
   * block+$0. `Thx Stop` returns early when it is clear, `Thx Subsongs`
   * refuses when it is set, and the VBL hook only ticks while it is set.
   *
   * Set by `Thx Play` and cleared by `Thx Stop`, and by nothing else — there
   * is no "the song ended" clear, because the replayer restarts instead.
   */
  playing: boolean
  /**
   * table+$2c — the address InitModule was last handed.
   *
   * Stored BEFORE the magic test (`move.l a0,$2c(a5)` at $4ce precedes the
   * `cmpi.l` at $4d2), so a bank that is not a THX module still leaves its
   * address here. That is what `Thx Subsongs` and `Thx End` test for zero, so
   * a failed play makes both of them answer rather than raise.
   */
  module: number
  /** what the module parsed to, or null when it did not parse */
  parsed: ThxModule | null
  player: ThxPlayer
}

export const newThxState = (rt: Runtime): ThxState => ({
  playing: false,
  module: 0,
  parsed: null,
  player: new ThxPlayer(() => rt.host.audio),
})

/**
 * The VBL hook at $fd0, installed into the first free `VblRout` slot.
 *
 *     movea.l $228(a5),a0
 *     tst.b   (a0) / beq
 *     lea     $2(a0),a0
 *     jsr     $10(a0)
 *
 * One flag, not two — unlike Jotre, which gates on both an initialised bit and
 * a playing bit. So this hook runs whenever `Thx Play` has been called and
 * `Thx Stop` has not.
 */
export function thxVbl(st: ThxState | undefined): void {
  if (!st?.playing) return
  st.player.tick()
}

/**
 * Resolve a bank the way the `.amoscall` at $ffa and $117e does.
 *
 * Error 36 when there is no such bank. NO check that it holds a THX module and
 * none that it is a memory bank, because the routine makes neither — this is
 * the author's second declared defect and it is deliberate here.
 */
function thxBank(rt: Runtime, nr: number): Uint8Array | null {
  const bank = rt.memBanks.get(nr)
  if (!bank || bank.kind !== 'memory') return null
  return bank.data
}

/**
 * `InitModule` at $4c6, as much of it as is observable.
 *
 * The address is stored whatever happens. The parse is only kept when the four
 * bytes at the front are "THX" and a version of ZERO, which is what `cmpi.l
 * #$54485800,(a0)+` tests — see ../amiga/thx.ts on why Jotre accepts every
 * version and this does not.
 *
 * DEVIATION: on a bank that is not a THX module the routine returns -1 and
 * leaves the previous module's fields in place, and `Thx Play` then calls
 * StartSong over them. On the machine that plays garbage or crashes; here the
 * previous parse simply stays loaded. Nothing else is faithful and safe at
 * once, and the crash is the author's declared defect rather than this port's.
 */
function initModule(st: ThxState, addr: number, bytes: Uint8Array | null): void {
  st.module = addr
  if (!bytes || !isThxModule(bytes) || bytes[3] !== 0) return
  try {
    st.parsed = thxParse(bytes)
  } catch {
    // a short or malformed module: InitModule walks off the end rather than
    // reporting, so there is nothing to raise here either
  }
}

export function makeThxInstructions(rt: Runtime): Record<string, Instr> {
  const st = (): ThxState => rt.thx

  return {
    /**
     * `Thx Play bank,subsong` — routine 2 ($fec).
     *
     * `move.l (a3)+,d7 / move.l (a3)+,d6` pops the sub-song first and the bank
     * second, arguments coming off in reverse source order.
     *
     * The bank is resolved before anything else and a miss is error 36. Then
     * InitModule, whose result is not tested, StartSong with the sub-song in
     * d0 and 0 in d1, and `move.b #$1,(a4)` last.
     */
    'thx play'(it) {
      const s = st()
      const bank = it.evalInt()
      it.expect(',')
      const sub = it.evalInt()
      const bytes = thxBank(rt, bank)
      if (bytes === null) amosError(36)
      initModule(s, bank, bytes)
      // `jsr $c(a3)` --- StartSong, and the sub-song is a LONG here where the
      // replayer takes a word
      if (s.parsed) s.player.load(s.parsed, sub & 0xffff)
      s.playing = true
    },

    /**
     * `Thx Stop` — routine 3 ($1040).
     *
     *     tst.b (a2) / beq (done)
     *     clr.b (a2)
     *     jsr   $14(a2)
     *
     * The flag is tested FIRST, so stopping a song that is not playing calls
     * nothing at all — unlike Jotre's `Stop Thx`, which calls StopSong
     * whatever the state.
     */
    'thx stop'() {
      const s = st()
      if (!s.playing) return
      s.playing = false
      s.player.stop()
    },

    /**
     * `Thx Load "name",bank` — routine 4 ($105e).
     *
     * The one keyword that touches the filesystem. Open (MODE_OLDFILE $3ed),
     * two Seeks to measure the length, reserve, Read, Close, and a compare of
     * the byte count against the length.
     *
     *     Open fails                 error 81
     *     the reserve fails          error 24, after closing the file
     *     a short read               error 94
     *
     * The odd-length fix is V0.5's and the Guide explains it: *"If an AMOSPro
     * bank is unequal, the compiler stops with error 'Not an AMOS-Program'. So
     * 'Thx Load' checks the file size for an equal length, if it is not, it
     * adds one byte at the bank reservation. (Thanks to Chris Hodges)."* The
     * instruction is `btst.b #$0,d2 / beq / addq.l #$1,d2`, and it grows the
     * BANK without changing how many bytes are read into it.
     */
    'thx load'(it) {
      const name = it.evalStr()
      it.expect(',')
      const nr = it.evalInt()
      const bytes = rt.vfs?.read(name)
      if (!bytes) amosError(81)
      // `btst.b #$0,d2 / addq.l #$1,d2` --- an odd file gets an even bank
      const length = bytes!.length + (bytes!.length & 1)
      rt.reserveBank(nr, length, THX_BANK_NAME, true, false)
      rt.memBanks.get(nr)!.data.set(bytes!)
    },

    /**
     * `Thx Volume v` — routine 5 ($111e).
     *
     *     tst.l  d7      / blt (error)
     *     cmp.l  #$3f,d7 / bgt (error)
     *     movea.l $1c(a0),a0 / move.b d7,$1(a0)
     *
     * so 0 to 63 and error 23 outside, which is V0.6's change: *"'Thx Volume'
     * accepts only values between 0 and 63, now. I noticed that the music
     * became louder when using 'Thx Volume 99'."*
     *
     * The byte it writes is the replayer's global volume at state+$1, the last
     * multiply of the chain at $148e. Note the range stops at 63 while the
     * chain treats 64 as unity, so this keyword cannot reach full scale — the
     * same one-step gap AMOS's own volume keywords have.
     */
    'thx volume'(it) {
      const s = st()
      const v = it.evalInt()
      if (v < 0 || v > 0x3f) amosError(23)
      s.player.playerVolume = v
    },
  }
}

export function makeThxFunctions(rt: Runtime): Record<string, Func> {
  const st = (): ThxState => rt.thx

  return {
    /**
     * `=Thx Subsongs(bank)` — routine 6 ($1156).
     *
     * Two paths on the sign of the argument, and the Guide describes both:
     * *"Returns the number of subsongs used in the THX-Module in bank {bank}.
     * This function only works if no THX module is currently replaying"* and
     * *"If {bank} is lower/equal zero, the number of subsongs of the module
     * currently playing or was played before is returnd."*
     *
     *     bank > 0    playing -> error 1; no such bank -> error 36;
     *                 otherwise InitModule and read the count
     *     bank <= 0   never initialised -> error 2; otherwise read the count
     *
     * The first path INITIALISES the module as a side effect, which is why it
     * refuses while something is playing: it would overwrite the running
     * song's state. That is the author's own reasoning — *"this is because I
     * have to initialize the module before accessing to this value so the
     * replay routine could crash"*.
     *
     * The count is `move.b $2(a3),d3` off the replayer's state, which is the
     * byte InitModule copied out of the module's +13.
     */
    'thx subsongs'(_, a): Value {
      const s = st()
      const nr = int(a[0]!)
      if (nr > 0) {
        if (s.playing) thxError(1)
        const bytes = thxBank(rt, nr)
        if (bytes === null) amosError(36)
        initModule(s, nr, bytes)
      } else if (s.module === 0) {
        thxError(2)
      }
      return VI(s.parsed?.subSongs.length ?? 0)
    },

    /**
     * `=Thx End` — routine 7 ($11c8). *"Returns 255 if module has reached end,
     * else 0. The replayer will restart the module automatically."*
     *
     * `tst.l $2c(a1) / beq` is error 2 when nothing has ever been initialised,
     * then `move.b $3(a1),d3` reads the end flag straight out of the replayer.
     *
     * It does NOT clear the flag, and only `StartSong` does (`sf.b $3(a6)`).
     * So the first wrap latches 255 and every later call answers 255 until
     * another `Thx Play`, even though the song is still going round. The
     * jingle idiom the Guide suggests works because the program stops the
     * music the moment it sees the 255.
     */
    'thx end'(): Value {
      const s = st()
      if (s.module === 0) thxError(2)
      // `st.b` sets every bit, so the flag reads as $ff and not as 1
      return VI(s.player.ended ? 0xff : 0)
    },
  }
}
