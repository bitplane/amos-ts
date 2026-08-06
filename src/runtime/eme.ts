/**
 * EME 3.0 — Paul Reece's Enhanced Music Extension.
 *
 * EME is not a new extension in a new slot. It ships AS `AMOSPro_Music.Lib`
 * and is copied over the stock one — "copy the file AMOSPro_Music.lib over the
 * existing file in your APSystem folder" — so it takes slot 1 and every
 * program written for stock Music has to tokenise and run unchanged. All 49
 * stock keywords are present with identical token ids AND identical parameter
 * specs; this file is only the ten it adds.
 *
 * ## Evidence
 *
 * DISASSEMBLY tier, both builds, plus EME.doc for the registered one. Every
 * routine below is quoted. The binary wins where they disagree, and they
 * disagree twice — see the two NOTES at the foot of this comment.
 *
 * The whole of EME's own state is bytes in the extension's data block, reached
 * as `movea.l $f8(a5),a0`. Read out of the routines that use them:
 *
 *   $bce  the tracker SPEED, ticks a row        (Track Tempo writes it)
 *   $bcf  the tick within the row               (cleared with it)
 *   $bd0  the song position                     (=Trpos)
 *   $bca  the module base, and $bdc a second copy of it
 *   $be6  playing                               (=Trstat)
 *   $be7  the song length                       (=Trlen)
 *   $be8  Track Loop's flag
 *   $be9  the pattern-loop mode                 (Patt Loop On/Of/No)
 *
 * `Track Stop`, routine 90, is what pins most of them: it tests $be6, and then
 * clears $bd0, $bcf, $bd8, $be7, $bdc, $be8, $be9 and $be6 in one run after
 * silencing the four AUDxVOL and clearing the audio DMA bits.
 *
 * ## What this port does NOT reproduce
 *
 * DEVIATION: **EME's replayer is not the one running here.** EME rebuilt the
 * Music extension — 16,420 bytes of code against stock's 12,676, and only 54%
 * of stock's code appears verbatim in it — and the tracker this port steps is
 * AMOS's own `mt_*` (+Music.s:1673), not EME's. Two differences are visible in
 * the disassembly and neither is reproduced:
 *
 *   - at the end of a song EME does `clr.b $bd0` — position 0 — where stock
 *     does `move.b -1(a2),mt_songpos`, the module's RESTART byte. A module
 *     whose restart byte is not 0 loops to a different place under EME.
 *   - EME's own note about `Track Loop On`, below.
 *
 * The pattern-loop mode IS wired into the shared replay, because a keyword
 * that sets a byte nothing reads is not a port of anything.
 *
 * ## Two places EME.doc is wrong about its own binary
 *
 * NOTE: "In the original Amos Pro music extension, both of these [Track Loop
 * On/Of] commands led straight to an RTS instruction (it did absolutely
 * nothing!!). This just shows how much testing software houses actually do!"
 * — that is not true of AMOS Professional. `InTrackLoopOn` (+Music.s:4251) is
 * `Dload a0 / move.b #1,Track_Loop-MB(a0)`, and `mt_next` reads it at
 * +Music.s:1767 to decide whether to set Track_Stop. It works. EME shipped for
 * AMOS 1.3 as well and the remark may be true there; it is not true of the
 * source this port is written against, and the port has always implemented it.
 *
 * NOTE: "If used before Track Play, the specified pattern will be repeated" —
 * half wrong. `Patt Loop On` takes no argument at all (its spec is `I`), so
 * there is no "specified pattern"; the sentence reads like it was written for
 * a version of the keyword that took a number. The other half holds, but only
 * from a stopped state: Track Play opens with `Rbsr routine 90`, and routine
 * 90 is `tst.b $be6(a0) / beq` to its own exit BEFORE the clears — so the mode
 * survives a Track Play when nothing was playing and is wiped by one that
 * replaces a running module.
 *
 * ## Both builds we hold are DEMOS
 *
 * `eme-3.0`'s own $VER cookie is `$VER: 3.0DEMO` and its title string reads
 * "EME V3.0DEMO — © Paul Reece 1993"; `eme-3.0-demo` is the AMOS 1.3 build off
 * APD600. There is no full version to read, which decides `Track Sample
 * On`/`Off` below: in BOTH binaries they are byte-for-byte the same twelve
 * bytes and both raise the extension's own "Only available in full version!".
 * The doc claims Off is the disabled one and On is a working new command. The
 * binary disables both, and the binary wins.
 */
import { AmosError, int } from '../interp/values'
import { VI } from '../interp/values'
import type { Value } from '../interp/values'
import type { Func, Instr } from '../interp/builtins'
import type { Runtime } from './runtime'

/**
 * The demo's own refusal.
 *
 * `moveq #$9,d0 / Rbra routine 123` in the registered build and `moveq #$d,d0`
 * in the AMOS 1.3 one — different numbers because that build's message list
 * carries five extra medplayer strings, the same message either way. Routine
 * 123 is the error raiser: `lea (pc),a0` onto the message table, then AMOS's
 * custom-error call.
 */
const demoOnly = (): never => {
  throw new AmosError('Only available in full version!')
}

export function makeEmeInstructions(rt: Runtime): Record<string, Instr> {
  return {
    /**
     * Track Tempo n — routine 116 ($3e3a), 22 bytes:
     *
     *     move.l  (a3)+,d0
     *     movea.l $f8(a5),a0 / clr.b $bcf(a0)      the tick within the row
     *     movea.l $f8(a5),a0 / adda.w #$bce,a0 / move.b d0,(a0)
     *
     * so the speed is set and the tick restarted, in that order. The argument
     * is popped as a LONG and stored as a BYTE with no range check at all, so
     * `Track Tempo 256` is tempo 0 — which the doc calls the fastest.
     *
     * "This command does not over-ride the tempo commands used in the module.
     * ie. if you set a tempo, it will be changed by any tempo commands in the
     * music. (eg. F03)" — nothing in the routine says otherwise; it writes the
     * same byte the module's Fxx writes.
     */
    'track tempo'(it) {
      rt.music.setTrackSpeed(it.evalInt())
    },

    /**
     * Patt Loop On — routine 113 ($3e16): `move.b #$1,$be9(a0)`, twelve bytes.
     *
     * The mode is read in the replayer between clearing mt_pattpos and the
     * `addq.b #1` on the song position:
     *
     *     cmpi.b  #1,$be9(a4) / beq  (past the increment)
     *     cmpi.b  #2,$be9(a4) / beq  (into the stop)
     *     addq.b  #1,$bd0(a4) / andi.b #$7f,$bd0(a4)
     *
     * so mode 1 leaves the position alone and the same pattern comes round
     * again, for ever. A `Dxx` pattern break reaches the same place, so it
     * restarts the pattern rather than leaving it.
     */
    'patt loop on'() {
      rt.music.pattLoop = 1
    },

    /** Patt Loop Of — routine 114 ($3e22): `clr.b $be9(a0)`. One f, as the table spells it */
    'patt loop of'() {
      rt.music.pattLoop = 0
    },

    /**
     * Patt Loop No — routine 120 ($3e9a): `move.b #$2,$be9(a0)`.
     *
     * Mode 2's `beq` lands on the stop itself — `clr.b $be6 / clr.b $be7 /
     * clr.l $bdc` and the four AUDxVOL — not on the loop test, so the song
     * ends when the current pattern does whatever Track Loop says.
     */
    'patt loop no'() {
      rt.music.pattLoop = 2
    },

    /**
     * Track Sample On — routine 122 ($3eb2) — and Track Sample Off, routine
     * 121 ($3ea6), which is the same twelve bytes:
     *
     *     movea.l $f8(a5),a0 / moveq #$9,d0 / Rbra routine 123
     *
     * Both raise "Only available in full version!". EME.doc marks only Off as
     * "NOT IN DEMO VERSION!!!" and describes On as a working new command that
     * "turns off tracker channel 4 (Left channel) while playing tracker
     * modules ... so you can use the spare channel for playing samples".
     * Neither build we hold does that, and there is no full build to read.
     */
    'track sample on'() {
      demoOnly()
    },
    'track sample off'() {
      demoOnly()
    },

    /**
     * Med Tempo n — routine 112 ($3a82) of the AMOS 1.3 build, and in THAT
     * table only; the AMOS Pro build has no such name.
     *
     *     Rbsr    routine 107
     *     move.l  (a3)+,d0
     *     movea.l $f8(a5),a0 / movea.l $5d4(a0),a6 / jsr -$42(a6)
     *
     * -$42 is medplayer.library's SetTempo, the same LVO MED 7.1's `Med Set
     * Tempo` calls (its routine 10), so this is that keyword under another
     * name. Nothing is clamped there and nothing is clamped here.
     *
     * Routine 107 is NOT a module check, which is worth saying because the
     * obvious guess is that it is: `tst.l $5d4(a2) / bne` then `lea $5df(a2),a1
     * / moveq #2,d0 / OpenLibrary` on "medplayer.library" v2, `move.l d0,$5d4`,
     * and an init through -$1e. Failure is its errors 9 and 10, "Can't open
     * medplayer.library v2+" and "Can't initialize medplayer.library". So it
     * opens the library on demand and asks nothing about a module at all.
     * medplayer.library is modelled present here (see `amiga/exec.ts` and
     * MED 7.1's mode 0), so neither error is reachable.
     */
    'med tempo'(it) {
      rt.music.med.setTempo(it.evalInt())
    },

    /**
     * Tr Credits — routine 119 ($3ae2) of the AMOS 1.3 build, six bytes:
     * `moveq #$f,d0 / Rbra routine 120`.
     *
     * Message 15 of that build's list is "Enhanced Music Extension v3.0 by
     * Paul Reece - © Stealth Productions 1993". So the keyword is a credit
     * delivered through the error mechanism: it stops the program and prints
     * the author's name. Reproduced as what it is.
     */
    'tr credits'() {
      throw new AmosError('Enhanced Music Extension v3.0 by Paul Reece - © Stealth Productions 1993')
    },
  }
}

export function makeEmeFunctions(rt: Runtime): Record<string, Func> {
  return {
    /**
     * =Trpos — routine 117 ($3e50), eighteen bytes:
     *
     *     moveq #0,d3 / moveq #0,d2
     *     movea.l $f8(a5),a0 / adda.w #$bd0,a0 / move.b (a0),d3
     *
     * a BYTE, so no sign to worry about. "0 is the first position and so on."
     */
    'trpos': (): Value => VI(rt.music.trackPos),

    /**
     * =Trlen — routine 118 ($3e62), the same eighteen bytes over $be7.
     *
     * "If the length returned is 34, the last position played would be 33." It
     * is the song-length byte at $3b6 of the module, cached when Track Play
     * reads it and cleared by Track Stop.
     */
    'trlen': (): Value => VI(rt.music.trackLen),

    /**
     * =Trpat(pos) — routine 119 ($3e74), 38 bytes:
     *
     *     move.l  (a3)+,d0
     *     movea.l $f8(a5),a1
     *     tst.b   $be7(a1) / beq (out, with d3 still 0)
     *     movem.l a0-a6,-(a7)
     *     movea.l $bdc(a1),a0 / adda.w d0,a0 / move.b $3b8(a0),d3
     *     movem.l (a7)+,a0-a6
     *
     * the 128-byte pattern order table of the module. The guard is on the
     * LENGTH byte, not on the pointer, so it answers 0 whenever nothing is
     * playing. `adda.w` bounds nothing — see `trackPattern`.
     */
    'trpat': (_, a): Value => VI(rt.music.trackPattern(a[0] ? int(a[0]) : 0)),

    /**
     * =Trstat — routine 115 ($3e2c), fourteen bytes: `move.b $be6(a0),d3`.
     *
     * "Returns 1 if the song is still playing. 0 if it has finished." $be6 is
     * the byte Track Play sets and both Track Stop and the end-of-song arm
     * clear, so it is the playing flag itself rather than a computed answer.
     */
    'trstat': (): Value => VI(rt.music.mtOn ? 1 : 0),
  }
}
