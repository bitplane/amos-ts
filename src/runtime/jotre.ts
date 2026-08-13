/**
 * Jotre 1.0 — "Jolly's THX II Replayer", at slot 22.
 *
 * Five keywords over an embedded THX Sound System 2.0 replayer. A program
 * `Bload`s a module into a bank and hands `Play Thx` its `Start(bank)`
 * address; no bank is reserved by the extension and no file is read by it.
 *
 * ## Evidence
 *
 * DISASSEMBLY tier. `AMOSPro_Jotre.Lib`, a 12,568-byte code hunk, plus
 * `Jotre.Guide` beside it. Only about 700 of those bytes are the extension:
 * the rest is Dexter/Abyss's replayer, linked in whole, and the shim reaches
 * it through a jump table rather than through the AMOS routine table — which
 * is why `extdis` reports nine routines for a library this size and why
 * "routine 0" spans $7c..$2d88.
 *
 * ## Identity, off the binary
 *
 * `$VER: 1.0` at $312c and, at $30c2, `NuJolly: THX Extension V1.0, 68k Code
 * By Thomas Verduin (Alias: Protonic)` — which settles an author the manifest
 * had as "unknown". The Guide credits the parts: *"Jotre was coded by
 * Protonic/Jolly, the Guide and the intro where created by Cloak/Jolly and
 * Jazz/Jolly, and Thx was coded by Dexter/Abyss"*. A second `$VER` at $196,
 * `THX-Sound_System_BinaryPlayer_2.00 (Aug 97)`, belongs to the replayer.
 *
 * Slot 22, three ways. Routine 0 stores its data block with
 * `move.l a3,$248(a5)` — `($248-$f8)/16 + 1 = 22` on the ExtAdr layout
 * +Equ.s:1176-1183 fixes — puts its REMOVE routine at `$250(a5)`, the same
 * entry's +$8, and returns `moveq #$15,d0`, the slot zero-based. The Guide
 * agrees: *"Find and select extension slot 22"*.
 *
 * ## The three hooks routine 0 installs
 *
 *     move.l a3, $248(a5)     the data block, at $13a
 *     move.l a3, $250(a5)     ... no: $250 takes the routine at $a0
 *     move.l a0, $0(a5)       VblRout[0], the routine at $112
 *
 * `$250(a5)` is the slot entry's REMOVE routine and `$0(a5)` is the first of
 * the eight per-frame VBL slots. The VBL one is four instructions: if the flag
 * byte has BOTH bits set — initialised and playing — call the replayer's
 * interrupt entry at block+$14, and otherwise return.
 *
 * The REMOVE routine at $a0 is StopSong if playing, EndPlayer if initialised,
 * then `move.b #$0,(a0)` over the whole flag byte — the outright clear
 * `Deinit Thx` should have used and does not. It has NO hook here and is
 * deliberately not written as one: it is +$8, the teardown vector, not the +$4
 * DEFAULT that AMOS's `Default` calls and that MED 7.1 registers. Nothing in
 * this port tears an extension down, so a `remove` would be machinery for
 * nobody. The consequence is real and worth knowing: unlike MED, `Default`
 * does not stop a Jotre song.
 *
 * ## The block
 *
 * The data block at $13a opens with a jump table of `bra.w`s into the
 * replayer, and the shim only ever calls it by offset:
 *
 *     +$08  InitPlayer     Init Thx
 *     +$0c  InitModule     Play Thx, first call
 *     +$10  StartSong      Play Thx, second call
 *     +$14  the interrupt  the VBL hook
 *     +$18  StopSong       Stop Thx, Deinit Thx, the REMOVE hook
 *     +$1c  EndPlayer      Deinit Thx, the REMOVE hook
 *     +$24  a POINTER      Volume Thx writes one byte at (*ptr)+1
 *
 * and its own state sits far past that:
 *
 *     +$2bca  flags   bit 0 initialised, bit 1 playing
 *     +$2bcc  the module address Play Thx was handed
 *     +$2bd0  the sub-song byte
 *     +$2bd1  the error code routine 3 reports
 *
 * ## What is here and what is not
 *
 * The shim is complete: every flag, every error, and both orderings that
 * matter. The SYNTHESIS is not — THX is a synth tracker, not a sampler, and
 * its engine is ten kilobytes of 68k in this file with no published source.
 * That is the same boundary MED 7.1 draws at octaplayer.library, and it is
 * tracked separately.
 *
 * One thing the shim does is genuinely observable without any of that, and it
 * is reproduced: `InitModule` at $802 opens
 *
 *     move.b $3(a0), $43e(a6)      stash the module's version byte
 *     clr.b  $3(a0)                and ZERO it, in the caller's memory
 *     cmpi.l #$54485800, (a0)+     then compare against "THX" + 0
 *
 * so a module's fourth byte is destroyed by playing it, and the compare that
 * follows can never see a version — which is how any version is accepted. A
 * program that plays the same bank twice, or checks the header afterwards,
 * sees the difference.
 *
 * NOTE: `Jotre.Guide` carries Cloak/Jolly's home address and a phone number.
 * Deliberately not copied here or into any commit.
 */
import { AmosError } from '../interp/values'
import type { Instr } from '../interp/builtins'
import type { Runtime } from './runtime'

/**
 * Routine 3's message table at $2d0c — four NUL-separated strings, indexed
 * 0-based by the error byte at $2d0b, which is block+$2bd1. Delivered through
 * `Rjmp L_ErrorExt` with `moveq #$15,d2`, the slot zero-based, and `moveq
 * #$0,d1`, which makes it trappable — see ../runtime/extimpl.ts's `errors`.
 *
 * NOTE: Jotre ships only the message-printing half of the pair every other
 * extension has both of. There is no `d3 = -1` routine, so a program compiled
 * with -E0 has nothing to call.
 *
 * Every raiser lands right — `Init Thx` writes 2 when it is already up and 0
 * when InitPlayer fails, `Play Thx` writes 3 when InitModule does, and all
 * four of the others write 1 when nothing is initialised.
 */
export const JOTRE_ERRORS = [
  "Couldn't Initialise THX! (Out Of Memory?)",
  'THX Not Initialised!',
  'THX Already Initialised!',
  "Couldn't Initialise Module/SubSong!",
]

/** routine 3 ($2dfa) — raise one, by the code left at block+$2bd1 */
const jotreErr = (n: number): never => {
  throw new AmosError(JOTRE_ERRORS[n] ?? `Jotre error ${n}`)
}

/** block+$2bca, and the only state four of the five keywords test */
export const JOTRE_READY = 1
export const JOTRE_PLAYING = 2

export interface JotreState {
  /** block+$2bca — JOTRE_READY | JOTRE_PLAYING */
  flags: number
  /** block+$2bcc — the address Play Thx was handed, stored before any check */
  module: number
  /** block+$2bd0 — the sub-song, a BYTE */
  subSong: number
  /** the version byte InitModule stashes out of the module's byte 3 */
  version: number
  /** what Volume Thx wrote through the pointer at block+$24 */
  volume: number
}

/**
 * Routine 0 ($7c) installs three hooks and clears nothing else — the block is
 * static data in the hunk, so its flag byte starts at whatever the file holds,
 * which is zero.
 */
export const newJotreState = (): JotreState => ({
  flags: 0,
  module: 0,
  subSong: 0,
  version: 0,
  volume: 0,
})

/**
 * The VBL hook at $112, installed into `$0(a5)` = VblRout[0].
 *
 *     move.b $2bca(a3), d0 / andi.b #$3, d0 / cmpi.b #$3, d0 / bne
 *     movea.l $248(a5), a2 / adda.w #$14, a2 / jsr (a2)
 *
 * BOTH bits, so a module that was started and then stopped is not stepped,
 * and neither is one whose player was removed.
 *
 * NOTE: there is no THX synthesis here, so the interrupt has nothing to do
 * beyond what the gate above already says. The gate itself is reproduced
 * because it is what `Stop Thx` and `Deinit Thx` are observable through.
 */
export function jotreVbl(st: JotreState | undefined): boolean {
  return !!st && (st.flags & (JOTRE_READY | JOTRE_PLAYING)) === (JOTRE_READY | JOTRE_PLAYING)
}

/** the `andi.l #$1 / cmpi.l #$1 / bne -> error 1` four keywords open with */
function needReady(st: JotreState): void {
  if (!(st.flags & JOTRE_READY)) jotreErr(1)
}

export function makeJotreInstructions(rt: Runtime): Record<string, Instr> {
  const st = (): JotreState => rt.jotre

  return {
    /**
     * Init Thx — routine 4 ($2e1a).
     *
     * Already up is error 2. Otherwise the flag byte is cleared OUTRIGHT
     * (`move.b #$0,(a1)`, not an AND), then `suba.l a0,a0 / suba.l a1,a1 /
     * moveq #$0,d0 / moveq #$0,d1` and InitPlayer at block+$8; a -1 return is
     * error 0, and success ORs in bit 0.
     *
     * The Guide says what the four zero arguments buy: *"Init Thx initialises
     * the filter data used by the replayer. This wil grab 414768 bytes of
     * public memory"* — THX pre-computes every filtered waveform rather than
     * filtering as it plays.
     *
     * Cloak's figure is close and not right. InitPlayer at $460 asks for
     * `move.l #$649f0,d0` = 412,144 of public memory and `move.l #$a00,d0` =
     * 2,560 of chip, which is 414,704 between them. The public half is $568 of
     * state and 63 waveform sets of 6,520 — see ../amiga/thxwaves.ts, which
     * builds all of it.
     *
     * NOTE: nothing is charged for either allocation here. PowerBobs' own
     * AllocMems are not charged either, and for the same reason: no keyword
     * hands the address back, so the only observable would be `Fast Free`.
     */
    'init thx'() {
      const s = st()
      if (s.flags & JOTRE_READY) jotreErr(2)
      s.flags = 0
      s.flags |= JOTRE_READY
    },

    /**
     * Deinit Thx — routine 5 ($2eaa). Error 1 when nothing is up; then
     * StopSong if bit 1 is set, EndPlayer either way.
     *
     * DEFECT: the flag clear is `move.b #$ff,d1 / subi.b #$1,d1 / and.b d1,d0`
     * — $FE, so it clears bit 0 ONLY and leaves the PLAYING bit set. A program
     * that deinits mid-song and then inits again starts with the block already
     * claiming to play, and the very next `Deinit Thx` calls StopSong on a
     * player that is not running. Reproduced: the bit survives here too.
     */
    'deinit thx'() {
      const s = st()
      needReady(s)
      // `andi.l #$2 / cmpi.l #$2 / bne` --- StopSong only when playing
      // (the bit it does not then clear)
      s.flags &= 0xfe
    },

    /**
     * Play Thx address,subsong — routine 6 ($2f4a).
     *
     * `move.l (a3)+,d0 / movea.l (a3)+,a0` pops the sub-song first and the
     * address second, arguments coming off in reverse source order. Both are
     * STORED BEFORE the initialised test: a `Play Thx` that raises error 1
     * still leaves its address at block+$2bcc and its sub-song byte at
     * block+$2bd0, and the next successful one would use them.
     *
     * Then InitModule (block+$c) with the address in a0, -1 being error 3, and
     * StartSong (block+$10) with the sub-song in d0 and 0 in d1. Bit 1 goes on
     * last.
     *
     * The Guide's usage is `Play Thx Start(Bank),SubSong`, with a warning that
     * an odd-length bank breaks the compiler — so the address really is an AMOS
     * bank's, which is why this resolves it rather than treating it as opaque.
     */
    'play thx'(it) {
      const s = st()
      const addr = it.evalInt()
      it.expect(',')
      const sub = it.evalInt()
      // stored first, and kept even when the check below raises
      s.module = addr >>> 0
      s.subSong = sub & 0xff
      needReady(s)
      // InitModule ($802): stash the version byte, ZERO it in the caller's
      // memory, then `cmpi.l #$54485800,(a0)+` --- "THX" and the byte it just
      // cleared, which is how every version is accepted
      const m = rt.resolveWrite(s.module)
      if (!m || m.off + 4 > m.data.length) jotreErr(3)
      const d = m!.data
      const at = m!.off
      s.version = d[at + 3]!
      d[at + 3] = 0
      if (d[at] !== 0x54 || d[at + 1] !== 0x48 || d[at + 2] !== 0x58) jotreErr(3)
      s.flags |= JOTRE_PLAYING
    },

    /**
     * Stop Thx — routine 7 ($3006). Error 1 when nothing is up, StopSong at
     * block+$18, then `#$ff - 2` = $FD to clear bit 1 — which, unlike Deinit's
     * clear, is the right mask for the bit it means.
     *
     * It does NOT check bit 1 first, so stopping something that was never
     * started calls StopSong anyway.
     */
    'stop thx'() {
      const s = st()
      needReady(s)
      s.flags &= 0xfd
    },

    /**
     * Volume Thx v — routine 8 ($3074). Error 1 when nothing is up; then
     *
     *     movea.l $248(a5), a0 / adda.w #$24, a0
     *     movea.l (a0), a1 / adda.l #$1, a1
     *     move.b d7, (a1)
     *
     * a byte written one past whatever the pointer at block+$24 holds —
     * inside the replayer, not in the extension's own state.
     *
     * The Guide gives the range as *"anything between 0 (silent) to 63 (very
     * loud)"* and the routine enforces none of it: `move.b` takes the low byte
     * of whatever was passed, so 64 and -1 both land.
     */
    'volume thx'(it) {
      const s = st()
      const v = it.evalInt()
      needReady(s)
      s.volume = v & 0xff
    },
  }
}

