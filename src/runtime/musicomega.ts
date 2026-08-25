/**
 * The three keywords somebody bolted onto AMOS 1.3's Music.Lib for one demo.
 *
 * `music-omega-1.0` is not a separate extension. It is APD230's Music.Lib, 39
 * entries and 29 named ending at `set talk` ($01fa), with three more appended
 * and the jump table extended to 89 routines: `starset` $0210 on routine 84,
 * `starstop` $0220 on 85, `starplay` $022e on 86. Routines 73 to 83 are
 * skipped and unreachable. Everything below $01fa is the stock library and is
 * served by ../runtime/music.ts, which is why this file has three handlers
 * rather than thirty-two.
 *
 * They are a ProTracker replayer, not the starfield the names suggest. Stars
 * 2.33 spells its keywords `Stars Blast` and `Stars Vbl` and has no entry
 * under any of these three names; routine 86 reads `$3b8(a0)` for the song
 * positions, takes their maximum plus one for the pattern count, multiplies
 * by 1024 and lands on the sample data at `$43c(a0)` plus that — the 31-sample
 * MOD layout, byte for byte.
 *
 * The point of registering it is a collision. The official AMOS 1.3 line also
 * grew a module player, and grew it at the same offsets: the $VER 1.62 build
 * on the Amiga Computing issue 66 coverdisk continues past $01fa with `sload`
 * at $0210 and `sam swapped` at $0220, and AMOS Pro's Music inherits both.
 * Two people extended one token table from the same last entry and gave the
 * same ids different meanings. Before this entry existed, `identifySlot` read
 * APD426's slot 1 as amospro-music-2.0 — the only answer the ids alone
 * support — and `techno.amos` listed its `Starstop` as a bare `Sam Swapped`
 * statement, which is a FUNCTION, and its `Starset Start(13),` as `Sload
 * Start(13),` with a dangling comma where sload's `I0t0,0` wants a string.
 * Wrong output rather than absent output, which is the worse failure. Ten
 * corpus programs are tokenised against this table, not one: the demand table
 * in docs/extensions/README.md had it as an unregistered lead under its table
 * hash, `music-68451de1`, all along.
 *
 * The library carries no author string, no copyright and no version of its
 * own beyond the two banners the stock build already had. What the disc says
 * about itself is in `s/startup-sequence`, which prints "\xa9 Omega Demos Inc.
 * 1991/92", "Release Version. #1.1" and "Release Date 26/03/92" before
 * chaining RAMOS 1.3 into a demo called Golden Ages.
 */
import type { Runtime } from './runtime'
import type { Instr } from '../interp/builtins'
import { Protracker, parseMod, type PtSong } from '../amiga/protracker'

/**
 * The player's variables, all of them in the library's data hunk off the
 * `lea $1412(pc),a3` base that every one of its routines sets up.
 *
 * The offsets are worth keeping in the field names' company because the
 * player is spread across three places — the two keywords, the interrupt at
 * $504, and the row engine from $54e — and the only thing tying them together
 * is that they agree about these bytes.
 */
export interface MusicOmegaState {
  /** the replay this port drives instead of the library's own 1.6KB of it */
  replay: Protracker
  /** $924 — the module address `Starset` recorded, unparsed */
  mod: number
  /** $928 — `Starset`'s SECOND argument plus 24; see the keyword */
  samples: number
  /** $920 — the interrupt does nothing at all while this is clear */
  active: boolean
  /** $530 — set inside the row engine, acted on by the interrupt one tick later */
  stopping: boolean
  /** $531 — `andi.b #$1`, so any odd value is "keep going" */
  loop: boolean
  /** $534 — `andi.b #$1`, "this pattern and no other" */
  onePattern: boolean
  /** $532 — the row to come back to. The library holds it times 16, in bytes */
  startRow: number
  /** $535 — `andi.b #$7f`, the position to come back to */
  startPos: number
}

/** `Starplay`'s `move.b #$5,$7f4(a3)`, where ProTracker's own default is 6 */
export const OMEGA_SPEED = 5

export function newMusicOmegaState(rt?: Runtime): MusicOmegaState {
  return {
    replay: new Protracker(() => rt?.host.audio),
    mod: 0,
    samples: 0,
    active: false,
    stopping: false,
    loop: false,
    onePattern: false,
    startRow: 0,
    startPos: 0,
  }
}

/**
 * The four AUDxVOL writes and the DMACON clear that `Starstop` and the
 * interrupt's stop arm both make, letter for letter:
 *
 *     clr.w $dff0a8 / clr.w $dff0b8 / clr.w $dff0c8 / clr.w $dff0d8
 *     move.w #$f, $dff096          bit 15 clear, so CLR: audio DMA off
 *     clr.b  $920(a3)
 *
 * `Starstop` at $28d2 and the interrupt at $524 are the same eleven
 * instructions twice, which is how the row engine stops the music without
 * being able to call a keyword.
 *
 * Note what is NOT here. The filter bit is set by `Starplay` on the way in
 * ($2990, `ori.b #$2,$bfe001`, so the low-pass comes OFF and the power LED
 * with it) and nothing ever puts it back. Stopping the module leaves the LED
 * dark, which on a real machine is visible across the room.
 */
function omegaSilence(st: MusicOmegaState): void {
  st.replay.stop()
  // the volumes are written behind the replay, so the next tick must not
  // believe the hardware already agrees with what it last sent
  st.replay.forget()
  st.active = false
  st.stopping = false
}

/** the module `Starset` pointed at, as bytes, or null if the address is not ours */
function moduleAt(rt: Runtime, addr: number): PtSong | null {
  const m = rt.resolveAddr(addr >>> 0)
  if (!m) return null
  return parseMod(m.data.subarray(m.off))
}

/**
 * The interrupt at $504, which is the whole player as a program can observe
 * it.
 *
 *     movem.l d0-d7/a0-a6,-(a7)
 *     lea     $1412(pc),a3
 *     tst.b   $920(a3) / beq -> exit          not playing: nothing, not even a decay
 *     bsr     $54e                            the row engine
 *     lea     $1412(pc),a3
 *     tst.b   $530(a3) / beq -> exit          the engine asked to stop
 *     <the four volumes, DMACON, $920>
 *
 * So the stop is always one interrupt late: the engine sets $530 while
 * finishing a row and the silence happens on the NEXT frame, with that row
 * played in full. That ordering is preserved here.
 *
 * DEVIATION: the row engine itself is not reproduced. The library carries
 * about 1.6KB of its own replay from $54e to $b62, and this port runs
 * ../amiga/protracker.ts instead and imposes the library's position rules on
 * top of it. What that costs is the effect handling: the two engines agree
 * about notes, samples, volumes and speed, and they are not known to agree
 * about every ProTracker command. The rules below ARE the library's, read off
 * $66c to $6d2.
 */
export function musicOmegaVbl(rt: Runtime): void {
  const st = rt.musicOmega as MusicOmegaState | undefined
  if (!st || !st.active) return
  const pt = st.replay
  const song = pt.song
  if (!song) return

  const wasPos = pt.pos
  pt.playing = true
  pt.tick()

  if (pt.pos !== wasPos) {
    if (st.onePattern) {
      /*
       * $68a: with $534 set the position never moves. The row goes back to
       * $532, which is where `Starplay` was told to start, and the pattern
       * plays again — unless $531 is clear, and then this wrap is the end:
       *
       *     tst.b   $534(a6) / beq -> advance
       *     cmpi.b  #$1,$531(a6) / beq -> done
       *     move.b  #$1,$530(a6)
       */
      pt.pos = wasPos
      pt.patt = song.positions[wasPos] ?? 0
      pt.row = st.startRow
      if (!st.loop) st.stopping = true
    } else if (pt.pos >= song.positions.length || pt.pos === 0) {
      /*
       * $6a4: position plus one, masked to 7 bits, then compared against the
       * module's own song length at $3b6. Equal means the song ran out:
       *
       *     addq.b  #$1,$7f8(a6) / andi.b #$7f,$7f8(a6)
       *     move.b  $3b6(a0),d0 / cmp.b $7f8(a6),d0 / bne -> done
       *     tst.b   $531(a6) / bne -> restart
       *     move.b  #$1,$530(a6)
       *     ...
       *     move.b  $535(a6),$7f8(a6)      restart at the START position
       *
       * The restart goes back to $535, the position `Starplay` was given, not
       * to zero — so a module started at position 8 loops 8 to the end rather
       * than round the whole song.
       */
      if (!st.loop) st.stopping = true
      else pt.setPosition(st.startPos)
    }
  }

  if (st.stopping) omegaSilence(st)
}

export function makeMusicOmegaInstructions(rt: Runtime): Record<string, Instr> {
  return {
    /**
     * `Starset MODULE,SAMPLES` — routine 84 ($28b6), twenty-eight bytes:
     *
     *     movea.l (a3)+,a0 / movea.l (a3)+,a1
     *     move.l  a3,-(a7) / lea $1412(pc),a3
     *     adda.l  #$18,a0
     *     move.l  a0,$928(a3)            SAMPLES plus 24
     *     move.l  a1,$924(a3)            MODULE, as given
     *     movea.l (a7)+,a3 / rts
     *
     * The last argument pops first, so a1 is the FIRST one and holds the
     * module. It is stored raw and not looked at: nothing is parsed, nothing
     * is checked, and a bad address costs nothing until `Starplay`.
     *
     * The second argument is the odd one. Twenty-four is a memory bank's
     * header — `Bnk_Reserve` puts the data at +24 past the node — so this is
     * a bank being turned into a data pointer. What it points AT is a table
     * of 120-byte entries: the row engine at $752 does `mulu.w #$78,d0 /
     * add.l $928(a6),d0` on the sample number from the pattern cell, then
     * `cmpi.w #$414d,(a0)`, which is 'AM'. So a sample slot may be an AMOS
     * sample rather than one of the module's own, and the length comes from
     * the word at +6 shifted down two.
     *
     * That path is unreached by the only program we hold. `techno.amos`
     * writes `Starset Start(13),` and elides the second argument, so `a0`
     * arrives as EntNul ($80000000, +Equ.s:39), $928 becomes $80000018, and
     * the 'AM' test reads whatever is at that address. Here `resolveAddr`
     * answers null for it and the AMOS-sample arm never fires, which is the
     * same outcome by a defensible route rather than by luck.
     */
    starset(it): void {
      const mod = it.evalInt()
      it.expect(',')
      const samples = it.atStmtEnd() || it.nm() === ',' ? 0x8000_0000 : it.evalInt()
      const st = rt.musicOmega
      st.mod = mod >>> 0
      st.samples = (samples + 0x18) >>> 0
    },
    /**
     * `Starstop` — routine 85 ($28d2), forty-six bytes, and the same eleven
     * instructions the interrupt's stop arm runs. See `omegaSilence`.
     *
     * It takes no argument and checks nothing: stopping a player that was
     * never started still clears the four volumes and the audio DMA, so it
     * will silence AMOS's own music as readily as its own. `techno.amos`
     * calls it before `Starset` for exactly that reason, and again at the end
     * of the demo.
     */
    starstop(): void {
      omegaSilence(rt.musicOmega)
    },
    /**
     * `Starplay ONEPATTERN,POSITION,ROW,LOOP` — routine 86 ($2900), 200
     * bytes, and the only one of the three that does real work.
     *
     * The last argument pops first, so the four `move.l (a3)+,d0` below read
     * the arguments backwards. Each is masked rather than checked:
     *
     *     move.l (a3)+,d0 / andi.b #$1,d0  / move.b d0,$531(a1)   LOOP
     *     move.l (a3)+,d0 / andi.w #$3f,d0 / add.w d0,d0 (x4)     ROW
     *                       move.w d0,$7f6(a1) / move.w d0,$532(a1)
     *     move.l (a3)+,d0 / andi.b #$7f,d0 / move.b d0,$7f8(a1) / $535(a1)   POSITION
     *     move.l (a3)+,d0 / andi.b #$1,d0  / move.b d0,$534(a1)   ONEPATTERN
     *
     * `techno.amos` calls `Starplay 0,0,0,1`, which is the whole song from the
     * top, round and round, and is the reading that settles the order: with
     * the arguments the other way up it would be one pattern played once,
     * which is not what a demo puts behind seven screens of scrolltext.
     *
     * The four `add.w d0,d0` are a shift by four: the library holds the row
     * as its byte offset into the pattern, sixteen bytes a row, and $400 is
     * how it recognises the end of one. This port holds rows.
     *
     * Then it walks the module. `$3b8(a0)` is the 128-byte position table,
     * scanned for its maximum with a `dbra` that always runs all 128 whatever
     * the song length says; plus one is the pattern count, times 1024 is
     * their size, and `$43c(a0)` plus that is the first sample. The 31
     * headers are walked from `$2a(a0)`, thirty bytes apart, and each sample
     * gets `clr.l (a2)` at its head and `clr.b $2(a0)` in its header — the
     * first longword silenced and the FINETUNE thrown away. This port's
     * `parseMod` reads finetune, so a module that uses it will play in tune
     * here and slightly out of tune on the machine.
     *
     * DEVIATION: the library never checks the module. It reads $3b8 and $43c
     * on faith, so `Starplay` on a bank that is not a MOD plays noise. Our
     * `parseMod` requires "M.K." or "M!K!" at 1080 and this refuses quietly
     * when it is absent, because the alternative is synthesising the garbage
     * a specific Amiga would have made of specific memory.
     *
     * There is no error path: no argument can raise one, and neither can a
     * module that is not there. The library has no message table of its own.
     */
    starplay(it): void {
      const onePattern = it.evalInt()
      it.expect(',')
      const position = it.evalInt()
      it.expect(',')
      const row = it.evalInt()
      it.expect(',')
      const loop = it.evalInt()

      const st = rt.musicOmega
      st.onePattern = (onePattern & 1) !== 0
      st.startPos = position & 0x7f
      st.startRow = row & 0x3f
      st.loop = (loop & 1) !== 0
      st.stopping = false

      const song = moduleAt(rt, st.mod)
      if (!song) return
      st.replay.load(song, st.startPos)
      st.replay.row = st.startRow
      st.replay.speed = OMEGA_SPEED
      st.replay.playing = true
      st.active = true
    },
  }
}
