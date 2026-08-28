import { examinedFonts } from './fontlist'
import { AmosError, ERR, VF, VI, VS, funcCall, int, num, str, varType } from '../interp/values'
import { varKey } from '../interp/prescan'
import { DOSFALSE, execute } from '../amiga/process'
import { BNK, isObjectBank } from './banks'
import type { Instr, Func } from '../interp/builtins'
import type { Tok } from '../tokens/stream'
import { aliasForSlots, implLabel, implSlots, qualifyForSlots, type ExtensionImpl } from './extimpl'
import { newLdosState, makeLdosFunctions, makeLdosInstructions } from './ldos'
import { makeJdK3Functions, makeJdK3Instructions } from './jdk3'
import { newTftState, makeTftFunctions, makeTftInstructions } from './tft'
import { newJvpState, JVP_ERRORS, makeJvpFunctions, makeJvpInstructions } from './jvp'
import { newLocaleState, makeLocaleFunctions, makeLocaleInstructions } from './locale'
import { newTurboState, TURBO_ERRORS, makeTurboFunctions, makeTurboInstructions, turboDefault } from './turbo'
import { newPersonnalState, PERSONNAL_ERRORS, makePersonnalFunctions, makePersonnalInstructions, personnalDefault } from './personnal'
import { AMCAF_ERRORS, newAmcafState, makeAmcafFunctions, makeAmcafInstructions } from './amcaf'
import { newSpeechState, makeSpeechFunctions, makeSpeechInstructions, ensureLib } from './speech'
import { makeEmeFunctions, makeEmeInstructions } from './eme'
import { makeColoursFunctions } from './colours'
import { makeMiscExtInstructions, newMiscExtState } from './miscext'
import { makePlibFunctions } from './plib'
import { makeDumpFunctions, newDumpState } from './dump'
import {
  CRAFT_ERRORS,
  craftForget,
  craftFrReset,
  craftTrReset,
  makeCraftFunctions,
  makeCraftInstructions,
  newCraftState,
} from './craft'
import {
  MUSICRAFT_ERRORS,
  makeMusicraftFunctions,
  makeMusicraftInstructions,
  musicraftStop,
  newMusicraftState,
} from './musicraft'
import { makeMusicOmegaInstructions, newMusicOmegaState } from './musicomega'
import { ERCOLE_ERRORS, makeErcoleFunctions, makeErcoleInstructions, newErcoleState } from './ercole'
import { EASYLIFE_ERRORS, makeEasyLifeFunctions, makeEasyLifeInstructions, newEasyLifeState } from './easylife'
import { FILEID_ERRORS, makeFileIdFunctions, newFileIdState } from './fileid'
import { makeFirstInstructions } from './first'
import { makeDisplayExtInstructions, makeDisplayExtFunctions, newDisplayExtState } from './displayext'
import { makeMaxsDoorInstructions, makeMaxsDoorFunctions, newMaxsDoorState } from './maxsdoor'
import { makeSymBaseInstructions, makeSymBaseFunctions, newSymBaseState, SYMBASE_ERRORS } from './symbase'
import { makeDmeInstructions, makeDmeFunctions, newDmeState, DME_ERRORS } from './dme'
import { makeRangeFunctions, makeRangeInstructions, newRangeState } from './range'
import { JOTRE_ERRORS, makeJotreInstructions, newJotreState } from './jotre'
import { THX_ERRORS, makeThxFunctions, makeThxInstructions, newThxState } from './thx'
import { MED_ERRORS, makeMedExtFunctions, makeMedExtInstructions, medExtDefault, newMedExtState } from './medext'
import { makeP61Functions, makeP61Instructions, newP61State } from './p61'
import { makePowerBobsFunctions, makePowerBobsInstructions, newPowerBobsState } from './powerbobs'
import { makeTomeFunctions, makeTomeInstructions, newTomeState } from './tome'
import { SpeakBuffer, isSpeakPath, parseSpeakOptions, type SpeakOptions } from '../amiga/speak'
import { newIoPortsState, makeIoPortsFunctions, makeIoPortsInstructions } from './ioports'
import { newCtextState, makeCtextFunctions, makeCtextInstructions } from './ctext'
import { DSAM_ERRORS, makeDsamFunctions, makeDsamInstructions, newDsamState } from './dsam'
import { newSticksState, makeSticksFunctions, makeSticksInstructions } from './sticks'
import {
  GAMESUPPORT_ERRORS,
  makeGameSupportFunctions,
  makeGameSupportInstructions,
  newGameSupportState,
} from './gamesupport'
import {
  makeTheGameFunctions,
  makeTheGameInstructions,
  newTheGameState,
} from './thegame'
import { SLN_ERRORS, makeSlnFunctions, makeSlnInstructions, newSlnState } from './sln'
import { MAKE_ERRORS, makeMakeFunctions, makeMakeInstructions, newMakeState } from './make'
import { TOOLS_ERRORS, makeToolsFunctions, makeToolsInstructions, newToolsState } from './tools'
import { OPAL_ERRORS, makeOpalFunctions, makeOpalInstructions, newOpalState } from './opal'
import { DELTA_ERRORS, makeDeltaFunctions, makeDeltaInstructions, newDeltaState } from './delta'
import { LSERIAL_ERRORS, makeLSerialFunctions, makeLSerialInstructions, newLSerialState } from './lserial'
import { BUTILITY_ERRORS, makeBUtilityFunctions, makeBUtilityInstructions, newBUtilityState } from './butility'
import {
  DEV_IO_STRIDE,
  DEV_MAX,
  DEV_MODELLED,
  devAbort,
  devCheckIO,
  devClose,
  devDoIO,
  devOpen,
  devSendIO,
  devSlotOf,
  ioError,
  newDevSlot,
} from './device'
import { DEV_SERIAL_DEFAULTS } from './device'
import { RXFF_RESULT } from '../amiga/rexx'
import { newStarsState, makeStarsFunctions, makeStarsInstructions } from './stars'
import { newAgaState, makeAgaFunctions, makeAgaInstructions } from './aga'
import { newJdState, JD_ERRORS, makeJdFunctions, makeJdInstructions } from './jd'
import { makeJdColourFunctions, makeJdColourInstructions, newJdColourState } from './jdcolour'
import { GUI_ERRORS, guiRelease, makeGuiFunctions, makeGuiInstructions, newGuiState } from './gui'
import { INT_ERRORS, makeIntFunctions, makeIntInstructions, newIntState } from './int'
import { IEXT_ERRORS, makeIextFunctions, makeIextInstructions, newIextState } from './intuition'
import { makeJdIntFunctions, makeJdIntInstructions, newJdIntState } from './jdint'
import { isAmon103, makeAmonFunctions, makeAmonInstructions, newAmonState } from './amon'
import { makeExplodeFunctions, makeExplodeInstructions, newExplodeState } from './explode'
import { jdPrt11Aliases, makeJdPrtFunctions, makeJdPrtInstructions } from './jdprt'
import { newTdState, TD_ERRORS, makeTdFunctions, makeTdInstructions } from './td'
import { FUNCS, INSTR, parseAmosNumber } from '../interp/builtins'
import { parseAmosFile, parseSpriteBankBody } from '../loader/amosfile'
import { encodeIlbm, parseIlbm } from '../amiga/ilbm'
import { packBitmap, packScreen, parsePacPic } from '../loader/pacpic'
import { parseDiskFont } from '../amiga/diskfont'
import { ED_MESSAGES, ED_SYSTEME, ED_TST_MESSAGES, EDM_MESSAGES } from './edmessages.gen'
import { ED_RUN_MESSAGES } from '../interp/errors.gen'
import { DEFAULT_FLASH_SPEC, Runtime, SYS_MESSAGES, extractCodeHunk, parseFlashSpec } from './runtime'
import { Screen } from './screen'
import { BankImage, ObjectBank } from './objects'
import { AmalChannel, AmalCompileError, compileAmal } from './amal'
import {
  DIALOG_ERRORS,
  DialogChannel,
  DialogError,
  dialogZoneAt,
  dialogZoneByNumber,
  dialogZoneValue,
  eraseDialog,
  prescanDialog,
  updateZone,
} from './dialog'
import { fillSortKey } from '../amiga/vfs'
import { joker, matchesJoker } from './joker'
import { MF_BAR, MF_BOUGE, MF_FIXED, MF_OFF, MF_SEP, MF_TBOUGE, MF_TOTAL, bankToMenu, compileMenuObject, menuCalc, menuToBank } from './menu'
import type { MenuNode } from './menu'
import { ENV_BELL, ENV_BOOM, ENV_SHOOT } from './music'
import { squash as squashBytes, unsquash as unsquashBytes } from './squash'
import { formLoad, formPlay, formSize } from './iffanim'
import { parsePpBank, writePpBank } from './ppbank'

/**
 * Graphics/screen instruction and function registries, bound to a Runtime.
 * Merged over the core builtins when the interpreter is created.
 */

type It = Parameters<Instr>[0]

/** optional integer argument: elided (",," or end) yields def */
/**
 * The extra channel state a `SPEAK:` open needs, or nothing for a real file.
 *
 * Opening starts the narrator-ts import so the wait lands here rather than on
 * the first Print — a program that opens the handler is going to speak, and
 * the load is 88K of voice table it should not pay for otherwise.
 */
function speakChannel(rt: Runtime, path: string): { speak?: { buf: SpeakBuffer; voice: SpeakOptions } } {
  if (!isSpeakPath(path)) return {}
  ensureLib(rt)
  return { speak: { buf: new SpeakBuffer(), voice: parseSpeakOptions(path) } }
}

/**
 * `ZapReturn` (+ILib.s:1763): a `Call Editor`'s answer, into `Param`/`Param$`.
 *
 * Four instructions and the second is the one to read: `move.l ChVide(a5),
 * ParamC(a5)` clears the string FIRST, and `A0ToChaine` only fills it when d0
 * is not zero. So a command that worked leaves `Param$` empty whatever the
 * last one said. `Ask Editor` does not come through here.
 */
function zapReturn(it: It, r: { value: number; text: string }): void {
  it.paramInt = r.value
  it.paramStr = r.value === 0 ? '' : r.text
}

function optInt(it: It, def: number): number {
  if (it.atStmtEnd() || it.nm() === ',' || it.nm() === ')') return def
  return it.evalInt()
}

function pair(it: It): [number, number] {
  const x = it.evalInt()
  it.expect(',')
  return [x, it.evalInt()]
}

/**
 * Read a block number, the way all six block keywords do.
 *
 * Get, Put and Del, for both Block and Cblock, open with the same two lines:
 * `Rbeq L_BFonCall / cmp.l #65536,d5 / Rbcc L_BFonCall` (+Lib.s:11069, 11091,
 * 11109, 11133, 11176, 11195). So 0 is refused and so is anything from 65536
 * up, and `Rbcc` is unsigned, which puts every negative number above the
 * limit too.
 *
 * `BFonCall` is `moveq #22,d0 / Rbra L_EcWiErr` (+Lib.s:12998) and EcWiErr
 * adds `EcEBase-1` = 44 (+Lib.s:12917, +Equ.s:771), so a program sees error
 * 66, "Illegal block parameters" — not 22, which is Syntax error. The
 * argument-less forms `InDelBlock0` and `InDelCBlock0` reach `EcCall BlRaz`
 * with no check at all, so Del Block on its own still clears the lot.
 */
function blockNum(it: It): number {
  const n = it.evalInt()
  if (n <= 0 || n >= 65536) throw new AmosError(`illegal block parameters: ${n}`, 66)
  return n
}

/**
 * Was this numeric slot left blank?
 *
 * AMOS compiles an empty numeric argument to EntNul ($80000000, +Equ.s:39)
 * rather than refusing the line, and the routines test for it. Five places in
 * this tree had grown the same test independently — `optInt` above,
 * `omittable` in intuition.ts, the inline `omitted()` in `Limit Mouse`, and
 * `Ink`'s own `it.nm() !== ','` — and the one place that never grew it is the
 * one with the bug: `pair` evaluates both slots unconditionally, so every
 * keyword reaching `GrXY` ignored the convention.
 */
function omittedArg(it: It): boolean {
  return it.atStmtEnd() || it.nm() === ',' || it.nm() === 'to' || it.nm() === ')'
}

/** `pair`, for the keywords whose original routine reaches `GrXY` */
/**
 * Draw's DESTINATION, which gets none of GrXY's care.
 *
 * InDraw and InDrawTo hand d0/d1 straight to RDraw, and graphics.library
 * takes them as words. EntNul's low word is zero, so an omitted destination
 * coordinate draws to 0 rather than staying where it was.
 */
function drawEnd(it: It): [number, number] {
  const [x, y] = optPair(it)
  return [(x ?? 0) << 16 >> 16, (y ?? 0) << 16 >> 16]
}

function optPair(it: It): [number | null, number | null] {
  const x = omittedArg(it) ? null : it.evalInt()
  it.expect(',')
  return [x, omittedArg(it) ? null : it.evalInt()]
}

/**
 * `GrXY` (+Lib.s:11225): move the graphics cursor, then say where it ended up.
 *
 *     cmp.l #EntNul,d1 / beq.s GrXy1 / move.w d1,38(a1)
 *     GrXy1: cmp.l #EntNul,d0 / beq.s GrXy2 / move.w d0,36(a1)
 *
 * A blank coordinate leaves that axis where it was, so `Gr Locate ,100` moves
 * y alone and `Plot ,100` plots at the cursor's own x. `InPlot2`, `InPlot3`,
 * `RPoint`, `InDraw`, `EllCir`, `InGrLocate` and `InText` all call it;
 * `InDrawTo` deliberately does not.
 */
function grXY(s: Screen, x: number | null, y: number | null): [number, number] {
  if (y !== null) s.grY = y
  if (x !== null) s.grX = x
  return [s.grX, s.grY]
}

/**
 * The rectangle `X Mouse =`/`Y Mouse =` clamp against. On the Amiga these are
 * T_MouXMin/Max and T_MouYMin/Max, whose only writer is MLimA (+W.s:10977) —
 * `Limit Mouse`. MLimA also caps the rectangle it is given at 458x312 and
 * floors it at 0, so with no Limit Mouse in force that cap is the widest
 * bound any program could have set, and it stands in for the boot default.
 */
function mouseBounds(rt: Runtime): { x1: number; y1: number; x2: number; y2: number } {
  return rt.mouseLimit ?? { x1: 0, y1: 0, x2: 458, y2: 312 }
}

/**
 * MSetAb (+W.s:10921) one axis. The value is doubled into the fine counter
 * (`lsl.w #1`, so it wraps in the word), clamped there against the limits —
 * which MLimA stored doubled too — and halved back with `lsr.w`. The compares
 * are UNSIGNED (bcc/bcs) where the vbl clamp in MousInt (+W.s:10556) is signed
 * (bge/ble), so a negative value looks enormous, fails the "below max" test
 * and lands on the far limit: `X Mouse = -1` puts the pointer at the right.
 */
function setMouseAxis(v: number, lo: number, hi: number): number {
  let d = (v << 1) & 0xffff
  const min = (lo << 1) & 0xffff
  const max = (hi << 1) & 0xffff
  if (d < min) d = min
  if (d >= max) d = max
  return d >>> 1
}

/** Screen Width/Height(n): explicit n must be open (CheckScreenNumber + AdrEc) */
/** a 68000 `sub.w` result, sign-extended back out of the word */
function word(a: number, b: number): number {
  return ((a - b) << 16) >> 16
}

/**
 * CheckScreenNumber (+Lib.s:9165), which every screen keyword goes through:
 *
 *     tst.b   Prg_Accessory(a5)
 *     bne.s   .Skip
 *     cmp.l   #8,d1 / Rbcc L_IllScN
 *     rts
 *   .Skip
 *     cmp.l   #10,d1 / Rbcc L_IllScN
 *
 * An ACCESSORY gets ten screens and a normal program eight, and the two extra
 * exist so an accessory can open a screen without taking one its host is
 * using. Rbcc is unsigned, which is why one test covers both ends.
 *
 * IllScN (+Lib.s:12983) is `moveq #6,d0 / Rbra L_EcWiErr`, which after the 44
 * is error 50, "Valid screen numbers range 0 to 7". The message says 7 even
 * for an accessory, because IllScN is shared and nobody rewrote it. A raw 6
 * is "Resume label not defined".
 *
 * Sixteen call sites reach it (+Lib.s:8739 through 9128), and the check runs
 * before the screen is looked up, so 9 is error 50 in a normal program and
 * not "screen not opened".
 */
function checkScreenNumber(rt: Runtime, n: number): number {
  const limit = rt.interp.program.accessory ? 10 : 8
  if (n >>> 0 >= limit) throw new AmosError(ED_RUN_MESSAGES[50]!, 50)
  return n
}

function screenArg(rt: Runtime, a: import('../interp/values').Value[]): Screen {
  if (a.length > 0 && int(a[0]!) !== ENT_NUL) {
    const n = checkScreenNumber(rt, int(a[0]!))
    const s = rt.screens.get(n)
    if (!s) throw new AmosError(`screen not opened: ${n}`, 47)
    return s
  }
  return rt.screen
}

/**
 * EcToD1 (+W.s:10755) — the screen a `Zone`/`Hzone`-family call names.
 *
 * The keyword pushes `screen + 1` into d3 (the two-argument form pushes
 * `moveq #-1,d3` and the shared tail does `addq.l #1,d3`), so ZERO means the
 * current screen and -1 is how the short form spells it. A positive index is
 * looked up in T_EcAdr and a hole there is d0=3, which EcWiErr turns into
 * `EcEBase-1 + 3` = error 47.
 *
 * `null` is EcToD4: a screen argument of -2 or lower makes EcToD1 discard its
 * return address and answer EntNul ($80000000) with d0 = 0, so the keyword
 * returns that as an integer instead of raising anything.
 */
/**
 * Is a hardware coordinate inside this screen's display box? `ZoEc`, +W.s:11128.
 *
 *     move.w d3,d1 / sub.w EcWx(a1),d1 / bcs .out
 *     cmp.w  EcWTx(a1),d1 / bcc .out
 *     move.w d4,d2 / add.w #EcYBase,d2 / sub.w EcWy(a1),d2 / bcs .out
 *     cmp.w  EcWTy(a1),d2 / bcc .out
 *
 * The test is in HARDWARE units, against the display width and height, and
 * the hires and laced doublings happen after it passes. Doubling first and
 * comparing against the screen's own width and height is the same test ---
 * `EcWTx` is the width in hardware pixels, which for a hires screen is half
 * of it --- and it is how `hardToScreenX` already spells it, so the offset
 * comes straight back off rather than being left out.
 *
 * `Scin` and `Mouse Screen` both used the doubled X and an UNdoubled Y, so an
 * interlaced screen reported the pointer as over it for twice as many
 * hardware lines as it occupies.
 */
function overScreen(s: Screen, hx: number, hy: number): boolean {
  const sx = s.hardToScreenX(hx) - s.offsetX
  const sy = s.hardToScreenY(hy) - s.offsetY
  return sx >= 0 && sy >= 0 && sx < s.width && sy < s.height
}

function zoneScreen(rt: Runtime, a: import('../interp/values').Value[], full: number): Screen | null {
  if (a.length < full) return rt.screen
  const n = int(a[0]!)
  if (n < -1) return null
  if (n < 0) return rt.screen
  const s = rt.screens.get(n)
  if (!s) throw new AmosError(`screen not opened: ${n}`, 47)
  return s
}

/**
 * `RReg` (+Lib.s:2716): which slot of `CallReg`, or an Illegal function call.
 *
 *     cmp.l d0,d2 / Rbcc L_FonCall / add.w d1,d2 / lsl.w #2,d2
 *     lea CallReg(a5),a0 / lea 0(a0,d2.w),a0
 *
 * d0 is the limit and d1 the base, so `Dreg` is 8 and 0 and `Areg` is 7 and
 * 8: one array, and no `Areg(7)` because A7 is the stack pointer.
 */
function regSlot(n: number, limit: number, base: number): number {
  if (n < 0 || n >= limit) funcCall()
  return base + n
}

/** `IReg` (+ILib.s:2705): `Rbsr L_RReg / move.l d3,(a0)` */
/**
 * Amreg's bounds, from AmRR (+Lib.s:11968), which measures before it reads.
 *
 * The one-argument form addresses a GLOBAL and is guarded by `cmp.l #26,d3 /
 * Rbcc L_FonCall`, so R0 to R25. The test is unsigned, so a negative fails
 * the same branch as an oversized one; the port had been answering 0 for
 * out-of-range instead of raising anything.
 */
/**
 * `BsRout` (+ILib.s:5776), the target parser Bset, Bclr, Bchg, Btst and the
 * six Rol/Ror instructions all share.
 *
 * The count comes first, and `tst.l d3 / bmi FonCall` refuses a negative one.
 * Then the routine reads the next token. Anything that is not a variable is an
 * ADDRESS, and `bset #31,d3` marks the count so the caller can tell the two
 * arms apart with one `bmi`. A variable stays a variable only when the token
 * after it closes the call (`cmp.w #_TkPar2,(a6)+`) or ends the statement
 * (`bsr Finie`); otherwise BsR3 (+ILib.s:5805) puts a6 back and reads the
 * whole thing again as an integer expression. So `Bset 3,A` sets a bit in A
 * and `Bset 3,A+0` sets one in the byte A points at.
 *
 * The variable arm holds a long and the byte and word forms work on the low
 * end of it, `move.b 3(a0)` and `move.w 2(a0)`. The address arm works on a
 * byte, word or long at the address, and the bit instructions there are the
 * 68000's memory form, which takes its bit number modulo 8 rather than 32.
 *
 * DEVIATION: `move.w (a0),d1` and `move.l (a0),d1` are address errors on a
 * 68000 when the address is odd, and Struc is the only one of this family
 * that checks first (`btst #0,d1 / bne AdrErr`). This reads and writes
 * byte-wise at every address instead of modelling the exception.
 */
type BitTarget = { get: () => number; set: (v: number) => void; mem: boolean }

function bitTarget(it: It, rt: Runtime, bytes: number): BitTarget {
  const save = { ...it.pc }
  if (it.tok()?.kind === 'var') {
    const tg = it.parseTarget()
    if (it.atStmtEnd() || it.nm() === ')') {
      return { get: () => int(tg.get()), set: (v) => tg.set(VI(v)), mem: false }
    }
    it.pc = save
  }
  const addr = it.evalInt()
  return {
    mem: true,
    get: () => {
      const m = rt.resolveAddr(addr)
      if (!m || m.off + bytes > m.data.length) return 0
      let v = 0
      for (let i = 0; i < bytes; i++) v = ((v << 8) | m.data[m.off + i]!) >>> 0
      return v | 0
    },
    set: (v) => {
      const m = rt.resolveWrite(addr)
      if (!m || m.off + bytes > m.data.length) return
      for (let i = 0; i < bytes; i++) m.data[m.off + bytes - 1 - i] = (v >>> (i * 8)) & 0xff
    },
  }
}

function amregGlobal(n: number): number {
  if (n >>> 0 >= 26) funcCall()
  return n
}

/**
 * The two-argument form: `cmp.l #64,d1` on the channel, `cmp.l #10,d3` on the
 * register. RegAMAL (+W.s:7884) then walks the channel list for a matching
 * AmNb and answers `moveq #-1,d0` when there is none, which AmRR turns into
 * the same error with `Rbmi L_FonCall`. Reading a register of a channel that
 * has no AMAL program is error 23, not zero.
 */
function amregChannel(rt: Runtime, ch: number, reg: number): AmalChannel {
  if (ch >>> 0 >= 64 || reg >>> 0 >= 10) funcCall()
  const c = rt.channels.get(ch)
  if (!c) funcCall()
  return c
}

function writeReg(rt: Runtime, it: It, limit: number, base: number): void {
  it.expect('(')
  const n = it.evalInt()
  it.expect(')')
  it.expectOp('=')
  rt.callReg[regSlot(n, limit, base)] = it.evalInt() | 0
}

/** EcToD4's answer, which reaches BASIC as a plain integer */
const ENT_NUL = -0x8000_0000

/** Rdialog/Rdialog$(c,zone[,item]) shared lookup (Dia_GetValue +Lib.s:20843) */
function rdialogValue(rt: Runtime, a: import('../interp/values').Value[]): { n: number; s: string | null } {
  const d = rt.dialogs.get(int(a[0]!))
  if (!d) throw new AmosError(DIALOG_ERRORS[6]!)
  const item = a.length >= 3 ? int(a[2]!) : 1
  const z = dialogZoneByNumber(d, int(a[1]!), item)
  if (!z) throw new AmosError(DIALOG_ERRORS[6]!)
  return dialogZoneValue(z)
}

/** Vdialog(c,n)= / Vdialog$(c,n)= assignment forms (Dia_GetVariable +Lib.s:20764) */
function vdialogWrite(it: It, rt: Runtime, isStr: boolean): void {
  it.expect('(')
  const c = it.evalInt()
  it.expect(',')
  const n = it.evalInt()
  it.expect(')')
  it.expectOp('=')
  const d = rt.dialogs.get(c)
  if (!d) throw new AmosError(DIALOG_ERRORS[6]!)
  if (n < 0 || n >= d.vars.length) throw new AmosError(DIALOG_ERRORS[8]!)
  d.vars[n] = isStr ? it.evalStr() : it.evalInt()
}

/**
 * Logbase/Phybase (FnLogBase +Lib.s:8823): bitplane addresses. The port's
 * screens are chunky, so these return stable fake addresses that resolve
 * nowhere — plane pokes are ignored (see NOTES).
 */
function planeBase(rt: Runtime, plane: number, phys: number): number {
  // Logbase(p)/Phybase(p): the address of bitplane p of the logical/physical
  // bitmap. Faithful Amiga layout — planes are `planeSize` apart (+W.s:1856),
  // and the region is backed by the screen's planar mirror (Runtime.resolveAddr).
  const s = rt.screen
  if (plane < 0 || plane >= s.depth) funcCall()
  // single-buffered screens open with EcLogic == EcPhysic (+W.s:3001); only
  // Double Buffer splits the physical bitmap onto its own address
  const physical = phys !== 0 && s.doubleBuffered
  const base = rt.screenChipBase(s.index) + (physical ? Runtime.SCREEN_PHY_OFFSET : 0)
  return (base + plane * s.planeSize) >>> 0
}

/**
 * Set Rainbow's table build (TRSet +W.s:4020-4100): each channel is a
 * little state machine driven by "(interval,step,count)" groups — every
 * `interval` lines add `step` to the 4-bit component, `count` times, then
 * load the next group (wrapping at the end; count 0 repeats forever).
 * Numbers are AniLong's (+W.s:7059): optional '-', decimal or $hex.
 * Groups must be juxtaposed — a comma BETWEEN groups is a syntax error
 * (RainTok +W.s:4089); lowercase letters and spaces are skipped as noise
 * (AniChr +W.s:7041). An empty string freezes the channel at its seed.
 */
function buildRainbowTable(len: number, seed: number, rs: string, gs: string, bs: string): Uint16Array {
  const parse = (src: string): Array<[number, number, number]> => {
    // AniChr keeps chars 33..'Z' (plus '|' and ESC, which then fail the
    // structural checks); everything else is skipped
    const sig: string[] = []
    for (const ch of src) {
      const cc = ch.charCodeAt(0)
      if ((cc >= 33 && cc <= 90) || cc === 124 || cc === 27) sig.push(ch)
    }
    let p = 0
    const next = (): string => sig[p++] ?? ''
    const num = (): number => {
      let neg = false
      let ch = next()
      if (ch === '-') {
        neg = true
        ch = next()
      }
      let v = 0
      if (ch === '$') {
        let any = false
        for (;;) {
          const d = sig[p] ?? ''
          const dv = /[0-9]/.test(d) ? d.charCodeAt(0) - 48 : /[A-F]/.test(d) ? d.charCodeAt(0) - 55 : -1
          if (dv < 0) break
          v = v * 16 + dv
          p++
          any = true
        }
        if (!any) funcCall()
      } else {
        if (!/[0-9]/.test(ch)) funcCall()
        v = ch.charCodeAt(0) - 48
        for (;;) {
          const d = sig[p] ?? ''
          if (!/[0-9]/.test(d)) break
          v = v * 10 + (d.charCodeAt(0) - 48)
          p++
        }
      }
      return neg ? -v : v
    }
    const groups: Array<[number, number, number]> = []
    while (p < sig.length) {
      if (next() !== '(') funcCall()
      const a = num()
      if (a <= 0) funcCall() // ble RainTE
      if (next() !== ',') funcCall()
      const b = num()
      if (next() !== ',') funcCall()
      const c = num()
      if (c < 0) funcCall() // blt RainTE
      if (next() !== ')') funcCall()
      groups.push([a, b, c])
    }
    return groups
  }
  interface Chan {
    val: number
    plus: number
    cpt: number
    vit: number
    nb: number
    pos: number
    toks: Array<[number, number, number]>
  }
  const mkChan = (src: string, nib: number): Chan => ({
    val: nib & 15,
    plus: 0,
    cpt: 1,
    vit: 0,
    nb: 1,
    pos: 0,
    toks: parse(src),
  })
  // channel seeds: R = seed bits 8-11, G = 4-7, B = 0-3 (TRSet pushes B,G,R)
  const chans = [mkChan(rs, seed >> 8), mkChan(gs, seed >> 4), mkChan(bs, seed)]
  const step = (ch: Chan): void => {
    if (ch.cpt === 0) return // frozen channel
    if (--ch.cpt !== 0) return
    ch.cpt = ch.vit
    ch.val = (ch.val + ch.plus) & 15
    if (ch.nb === 0) return // count 0: repeat the group forever
    if (--ch.nb !== 0) return
    if (ch.toks.length === 0) {
      // empty string: the zeroed group — freeze from now on
      ch.cpt = 0
      ch.vit = 0
      ch.plus = 0
      return
    }
    if (ch.pos >= ch.toks.length) ch.pos = 0
    const [a, b, c] = ch.toks[ch.pos++]!
    ch.cpt = a
    ch.vit = a
    ch.plus = b
    ch.nb = c
  }
  const table = new Uint16Array(len)
  for (let i = 0; i < len; i++) {
    for (const ch of chans) step(ch)
    table[i] = (chans[0]!.val << 8) | (chans[1]!.val << 4) | chans[2]!.val
  }
  return table
}

/**
 * STOS-string scanner (StChr +W.s:7465): spaces skipped, lowercase
 * upper-cased; numbers are AniLong's (optional '-', decimal or $hex).
 */
function stosScan(src: string): { next: () => string; num: () => number; done: () => boolean } {
  const sig: string[] = []
  for (const ch of src) {
    if (ch === ' ') continue
    sig.push(ch >= 'a' && ch <= 'z' ? String.fromCharCode(ch.charCodeAt(0) - 32) : ch)
  }
  let p = 0
  const next = (): string => sig[p++] ?? ''
  const num = (): number => {
    let neg = false
    let ch = next()
    if (ch === '-') {
      neg = true
      ch = next()
    }
    let v = 0
    if (ch === '$') {
      let any = false
      for (;;) {
        const d = sig[p] ?? ''
        const dv = /[0-9]/.test(d) ? d.charCodeAt(0) - 48 : /[A-F]/.test(d) ? d.charCodeAt(0) - 55 : -1
        if (dv < 0) break
        v = v * 16 + dv
        p++
        any = true
      }
      if (!any) throw new AmosError('syntax error in animation string', 107)
    } else {
      if (!/[0-9]/.test(ch)) throw new AmosError('syntax error in animation string', 107)
      v = ch.charCodeAt(0) - 48
      while (/[0-9]/.test(sig[p] ?? '')) v = v * 10 + (sig[p++]!.charCodeAt(0) - 48)
    }
    return neg ? -v : v
  }
  return { next, num, done: () => p >= sig.length }
}

/** Anim string "(image,delay)...[L]" (AniStos +W.s:7461) */
function parseStosAnim(src: string): { pairs: Array<[number, number]>; loop: boolean } {
  const s = stosScan(src)
  const synt = (): never => {
    throw new AmosError('syntax error in animation string', 107)
  }
  const pairs: Array<[number, number]> = []
  if (s.next() !== '(') synt()
  for (;;) {
    const img = s.num()
    if (s.next() !== ',') synt()
    const delay = s.num()
    if (delay < 0) synt()
    if (s.next() !== ')') synt()
    pairs.push([img, delay])
    const c = s.next()
    if (c === '') return { pairs, loop: false }
    if (c === 'L') return { pairs, loop: true }
    if (c !== '(') synt()
  }
}

/** Move string "[start](speed,step,count)...[L|E][pos]" (AnMve +W.s:7487) */
export function parseStosMove(src: string): { start: number | null; groups: Array<[number, number, number]>; loop: boolean; endPos: number | null } {
  const s = stosScan(src)
  const synt = (): never => {
    throw new AmosError('syntax error in animation string', 107)
  }
  let start: number | null = null
  let c = s.next()
  if (c !== '(') {
    if (c === '') synt()
    // a leading number is the starting coordinate
    let neg = false
    if (c === '-') {
      neg = true
      c = s.next()
    }
    if (!/[0-9$]/.test(c)) synt()
    let v = 0
    if (c === '$') v = s.num()
    else {
      v = c.charCodeAt(0) - 48
      for (;;) {
        const d = s.next()
        if (/[0-9]/.test(d)) v = v * 10 + (d.charCodeAt(0) - 48)
        else {
          c = d
          break
        }
      }
    }
    start = neg ? -v : v
    if (c !== '(') synt()
  }
  const groups: Array<[number, number, number]> = []
  for (;;) {
    const speed = s.num()
    if (speed <= 0) synt()
    if (s.next() !== ',') synt()
    const step = s.num()
    if (s.next() !== ',') synt()
    const count = s.num()
    if (count < 0) synt()
    if (s.next() !== ')') synt()
    groups.push([speed, step, count])
    const t = s.next()
    if (t === '(') continue
    if (t === '') return { start, groups, loop: false, endPos: null }
    let loop = false
    if (t === 'L') loop = true
    else if (t !== 'E') synt()
    const endPos = s.done() ? null : s.num()
    return { start, groups, loop, endPos }
  }
}

/**
 * Sprite Base / Icon Base (Sb/AdBob +Lib.s:12792): index = |n| & $3FFF
 * with 0 erroring; a missing bank is "bank not reserved"; out of range
 * is error 74 "Icon not defined" for BOTH functions (AdBErr is shared —
 * a real 68k quirk). Positive n returns the image record's address in
 * the synthesized bank, negative n the mask pointer, which stays 0
 * (the 68k computes masks lazily).
 */
/**
 * Sprite Base and Icon Base, which share one routine.
 *
 * Sb (+Lib.s:12775) takes the absolute value, `tst.l d3 / bpl.s FsBi1 / neg.l
 * d1`, calls AdBob or AdIcon for the checking, and then reads a longword out
 * of the bank entry. The SIGN picks which longword: `tst.l d3 / bpl.s FsBi2 /
 * addq.l #4,a2`, so a NEGATIVE number answers with the MASK pointer and a
 * positive one with the image. The port used to short-circuit a negative to
 * 0 without reading anything; it now reads the field the routine reads.
 *
 * The entry is eight bytes, image then mask, the same pair Paste Icon pokes
 * $C0000000 into at 4(a2).
 *
 * DEVIATION: the answer is still 0, because objectBankImage leaves every
 * mask pointer 0 — this port allocates no mask blocks and carries the mask
 * as a per-image flag instead. Reading the right field costs nothing and
 * means Sprite Base(-n) comes right on its own if that ever changes.
 */
function objBase(rt: Runtime, kind: 'sprites' | 'icons', n: number): number {
  const idx = Math.abs(n) & 0x3fff
  if (idx === 0) funcCall()
  const bank = kind === 'sprites' ? rt.spriteBank : rt.iconBank
  if (!bank) throw new AmosError('bank not reserved', 36)
  // AdBob and AdIcon both fail into AdBErr (+Lib.s:12816), which is `moveq
  // #EcEBase+30-1,d0 / Rbra L_GoError` — 74 whichever bank it was, so a
  // Sprite Base out of range really does say "Icon not defined". Its `tst.w
  // d1 / Rbeq L_BkNoRes` on the bank count is the 36 above.
  if (idx > bank.images.length) throw new AmosError(ED_RUN_MESSAGES[74]!, 74)
  const img = rt.objectBankImage(kind)!
  const off = 2 + (idx - 1) * 8 + (n < 0 ? 4 : 0)
  return (((img[off]! << 24) | (img[off + 1]! << 16) | (img[off + 2]! << 8) | img[off + 3]!) >>> 0) | 0
}

/** Frame Play/Skip core: resolve the buffer, walk, return the new address */
function framePlaySkip(rt: Runtime, ad: number, n: number, param: number | null, skip: boolean): number {
  if (n < 0 || n >= 32768) funcCall()
  const base = ad > 0 && ad < 0x10000 ? rt.bankBase(ad) : ad
  const m = rt.bankOrAddr(ad)
  if (!m) throw new AmosError('bad IFF format')
  const end = formPlay(rt, m.data, m.off, n, param, skip)
  return base + (end - m.off)
}

/**
 * GetPut (+Lib.s:5353): record-1 must be under 65500, the channel must
 * be the random-access type ("file type mismatch"), and the offset is
 * (record-1) * record size. Callers apply their own EOF rule.
 */
function getPut(rt: Runtime, it: It): { c: NonNullable<ReturnType<Runtime['fileChans']['get']>>; off: number } {
  it.accept('#')
  const n = it.evalInt()
  it.expect(',')
  const rec = it.evalInt()
  if (rec - 1 < 0 || rec - 1 >= 65500) funcCall()
  const c = rt.chan(n)
  if (c.mode !== 'random' || !c.fields) throw new AmosError('file type mismatch', 98)
  return { c, off: (rec - 1) * c.recSize! }
}

/**
 * One Dir/Dev listing entry, exactly as FnFillNext returns it
 * (+Lib.s:5583): [marker][name] truncated then space-padded to the Set Dir
 * name width (FillFPoke +Lib.s:6328, FillF32 set), followed by an 8-char
 * field with the size left-aligned (LongToDec) — or spaces when the entry
 * is a directory ('*' marker) or its size is negative (devices).
 */
function fillEntry(rt: Runtime, marker: string, name: string, size: number | null): string {
  const nameField = (marker + name).slice(0, rt.dirWidth).padEnd(rt.dirWidth)
  const sizeField = marker !== '*' && size !== null && size >= 0 ? String(size).slice(0, 8).padEnd(8) : ' '.repeat(8)
  return nameField + sizeField
}

function devFirst(rt: Runtime, filter: string): string {
  const vfs = rt.vfs
  if (!vfs) return ''
  // the filter's first letter selects the class: D* = devices (volumes),
  // A* = assigns, anything else lists both (FillDev +Lib.s:6088-6101);
  // the whole filter then jokers against "NAME:" (FDev3)
  const first = filter.charAt(0).toUpperCase()
  const names = [
    // a handler is a device: AmigaDOS has one list and SPEAK: is in it
    ...(first === 'A' ? [] : [...vfs.volumeNames(), ...vfs.handlerNames()]),
    ...(first === 'D' ? [] : vfs.assignNames()),
  ].map((n) => `${n}:`)
  const entries = names
    .filter((n) => matchesJoker(filter, n))
    .map((n) => fillEntry(rt, ' ', n, null))
    .sort((a, b) => (fillSortKey(a) < fillSortKey(b) ? -1 : 1))
  rt.devIter = { entries, idx: 0 }
  return devNext(rt)
}

/** FillSort (+Lib.s:6245) compares name fields uppercased with '*' as
 * byte 1 — so directory entries bubble to the front */
function devNext(rt: Runtime): string {
  const it2 = rt.devIter
  if (!it2 || it2.idx >= it2.entries.length) return ''
  return it2.entries[it2.idx++]!
}

/**
 * Shift Up/Down delay,first,last[,flag] (ShD1 +Lib.s:9329): the 4th arg is
 * a wrap flag — flag 0 smears (Shf8a skips the wrap write), else the range
 * cycles. Omitted defaults to wrap (the common cycling case; the original's
 * omitted-arg polarity is unverified — see NOTES).
 */
/**
 * Free bytes on the volume a path lives on, as `Info()` reports them.
 *
 * `=Dfree` (+Lib.s:4938) and `Disc Info$` (:4995) are the same three lines
 * over the same `struct InfoData`:
 *
 *     move.l  12(a0),d3     * id_NumBlocks
 *     sub.l   16(a0),d3     * less id_NumBlocksUsed
 *     move.l  20(a0),d2     * times id_BytesPerBlock
 *     Rbsr    L_Mulu32
 *
 * A real disk answers from its BITMAP -- `AdfVolume.dosInfo` walks bm_pages
 * and counts set bits, a set bit being a FREE block -- so an 880K floppy
 * finally reports the room it actually has instead of 2GB.
 *
 * DEVIATION: a volume with no geometry has no answer to give. A zip, a host
 * directory and the browser's own writable store are not fixed-size media and
 * `Info()` on them would be inventing a number. `0x7fffffff` stands in, which
 * is what both keywords returned unconditionally before any volume could be
 * measured; a program testing whether a save will fit sees "yes", which is
 * true, because a write to those never fails for want of room.
 */
function freeBytes(rt: Runtime, path: string): number {
  const info = rt.vfs?.volumeInfo(path.split(':')[0] ?? '')
  if (!info) return 0x7fffffff
  const free = Math.max(0, info.numBlocks - info.numBlocksUsed)
  // Mulu32 is a 32-bit product and AMOS integers are signed, so a volume with
  // more than 2GB free wraps on the machine too. Clamped rather than wrapped:
  // nothing this port mounts gets near it, and a negative free count is a
  // worse answer than a large one.
  return Math.min(0x7fffffff, free * info.bytesPerBlock)
}

/**
 * Dir / Dir/W / Ldir / Ldir/W (+Lib.s:5793-5880).
 *
 * The four are one routine with two flags. DirComp (wide) halves the name
 * field to WiTx/2 and packs two entries a line; ImpFlg picks the sink, and
 * ImpChaine (+Lib.s:5384) tests it first: set, every line goes to
 * PRT_Print instead of the window. The L forms set ImpFlg, which is all
 * the L means.
 */
function dirListing(it: It, rt: Runtime, wide: boolean, printer: boolean): void {
  const path = it.atStmtEnd() ? '' : it.evalStr()
  const entries = rt.vfs?.listDir(path === '' ? rt.vfs.currentDir : path)
  if (!entries) throw new AmosError('directory not found', 80)
  // no printer host, so the printer sink discards — as Lprint's does
  const out = printer ? (): void => {} : (t: string): void => it.write(t)
  if (!wide) {
    for (const e of entries) out((e.isDir ? '*' + e.name : ' ' + e.name) + '\n')
    return
  }
  const width = Math.max(2, (rt.screen.curWin?.cols ?? 40) >> 1)
  let col = 0
  for (const e of entries) {
    out(((e.isDir ? '*' : ' ') + e.name).slice(0, width - 1).padEnd(width))
    if (++col === 2) {
      out('\n')
      col = 0
    }
  }
  if (col !== 0) out('\n')
}

function shiftArgs(it: It): { delay: number; first: number; last: number; wrap: boolean } {
  const delay = it.evalInt()
  it.expect(',')
  // ShD1 (+Lib.s:9337) pops the first colour and mends it rather than
  // refusing it: `move.l (a3)+,d3 / bpl.s ShD3 / moveq #1,d3`. Colour 0 is
  // the background and never joins a cycle, so a negative start becomes 1.
  const firstRaw = it.evalInt()
  const first = firstRaw < 0 ? 1 : firstRaw
  it.expect(',')
  const last = it.evalInt()
  // the spec is "I0,0,0,0", so the flag is a slot like the rest
  it.expect(',')
  const wrap = it.evalInt() !== 0
  return { delay: Math.max(1, delay), first, last, wrap }
}

/** Menu keyword index path: (n[,m[,k...]]) */
function menuPath(it: It): number[] {
  it.expect('(')
  const path = [it.evalInt()]
  while (it.accept(',')) path.push(it.evalInt())
  it.expect(')')
  return path
}

/**
 * MnDim (+ILib.s:6967), which every menu flag keyword goes through.
 *
 * It picks the form off the NEXT TOKEN: `cmp.w #_TkPar1,(a6) / beq.s
 * MnDim1`. A parenthesised list is a path, walked by MnFind, and a miss
 * lands on MnINDef — `moveq #39,d0 / bra.s RunErr` (+ILib.s:1147), so error
 * 39, "Menu item not defined", and RunErr adds no 44. A bare number is a
 * level, checked against 1 and MnNDim and used to index MnDFlags.
 *
 * Thirteen keywords reach it (+Lib.s:15655 to 15729) and each then does one
 * bset or bclr on the byte it returns. The port had split them in two: the
 * seven layout keywords only took a level, the rest only took a path.
 */
/** the function-side half of MnDim: a path is always parenthesised here */
function menuNodeOf(rt: Runtime, path: number[]): MenuNode {
  const node = rt.menu.find(path)
  if (!node) throw new AmosError(ED_RUN_MESSAGES[39]!, 39)
  return node
}

function menuNodeFlag(it: It, rt: Runtime, set: number, clear: number): void {
  if (it.nm() !== '(') {
    rt.menu.setLevelFlag(it.evalInt(), set, clear)
    return
  }
  const node = rt.menu.find(menuPath(it))
  if (!node) throw new AmosError(ED_RUN_MESSAGES[39]!, 39)
  node.flags = (node.flags | set) & ~clear
  rt.menu.change = true
}

/** Set Slider/Set Pattern number → fill rows (0 solid, <0 sprite image, >0 builtin) */
function resolvePattern(rt: Runtime, n: number): Uint16Array | null {
  if (n === 0) return null
  if (n < 0) {
    const img = rt.spriteBank?.image(-n)
    if (!img) return null
    const rows = Math.min(16, img.height)
    const bits = new Uint16Array(rows)
    for (let y = 0; y < rows; y++) {
      let row = 0
      for (let x = 0; x < Math.min(16, img.width); x++) {
        if (img.pixels[y * img.width + x] !== 0) row |= 1 << (15 - x)
      }
      bits[y] = row
    }
    return bits
  }
  return rt.systemPattern(n)
}

/**
 * Hslider/Vslider x1,y1 To x2,y2,total,pos,size (InHSlider/InVSlider
 * +Lib.s:10143/10151): every argument non-negative, the box non-empty and
 * pos <= total, else function call error (GetSli/SlPa).
 */
function slider(it: It, s: Screen, vertical: boolean): void {
  const x1 = it.evalInt()
  it.expect(',')
  const y1 = it.evalInt()
  it.expect('to')
  const x2 = it.evalInt()
  it.expect(',')
  const y2 = it.evalInt()
  it.expect(',')
  const total = it.evalInt()
  it.expect(',')
  const pos = it.evalInt()
  it.expect(',')
  const size = it.evalInt()
  if (x1 < 0 || y1 < 0 || x2 < 0 || y2 < 0 || total < 0 || pos < 0 || size < 0) {
    funcCall()
  }
  if (x2 - x1 <= 0 || y2 - y1 <= 0 || pos > total) funcCall()
  s.drawSlider(vertical, x1, y1, x2, y2, total, pos, size)
}

/**
 * `Arx_Message` and the answer `=Arexx` builds on it (+Lib.s:15064): take a
 * message if one is waiting and hold it, then report 0 for none, 1 for one,
 * and 2 when the sender asked for a result string.
 */
function arexxPoll(rt: Runtime): number {
  if (!rt.arexx.held && rt.arexx.port !== null) rt.arexx.held = rt.rexx.take(rt.arexx.port)
  const m = rt.arexx.held
  if (!m) return 0
  return (m.action & RXFF_RESULT) !== 0 ? 2 : 1
}

export function makeInstructions(rt: Runtime): Record<string, Instr> {
  const bitOp =
    (op: (v: number, bit: number) => number): Instr =>
    (it) => {
      const n = it.evalInt()
      if (n < 0) funcCall()
      it.expect(',')
      const tg = bitTarget(it, rt, 1)
      tg.set(op(tg.get(), 1 << (n & (tg.mem ? 7 : 31))) | 0)
    }
  const rotOp =
    (width: number, left: boolean): Instr =>
    (it) => {
      const count = it.evalInt()
      if (count < 0) funcCall()
      it.expect(',')
      const tg = bitTarget(it, rt, width >> 3)
      // the 68000 takes the count modulo 64, and 8, 16 and 32 all divide it
      const n = count % width
      const mask = width === 32 ? -1 : (1 << width) - 1
      const v = tg.get()
      const x = v & mask
      const r =
        n === 0 ? x : left ? ((x << n) | (x >>> (width - n))) & mask : ((x >>> n) | (x << (width - n))) & mask
      tg.set(((v & ~mask) | r) | 0)
    }
  const scr = (): Screen => rt.screen
  const byIndex = (n: number): Screen => {
    const s = rt.screens.get(n)
    if (!s) throw new AmosError(`screen not opened: ${n}`, 47)
    return s
  }

  /**
   * The source argument of Amal / Anim / Move X / Move Y, which all share
   * Lib_Def MvA3 (+Lib.s:11809). Before looking at the argument at all, MvA3
   * finds bank 4 and keeps its address if the bank is named "Amal" — that is
   * what fixes T_AmBank for the AMAL PLay instruction, and it happens for
   * every one of these keywords, not just Amal.
   *
   * The argument is then either a string or, on the Amiga, a value below
   * 1024 — too small to be a string pointer — which indexes the bank's
   * program table (InMb1, 11857). Our values are typed, so anything numeric
   * takes the bank path; only the low word of it is used (`move.w a1,d0`).
   * An empty table slot is not an error: it yields ChVide, the empty string.
   */
  /**
   * The channel a declaration may name, which is not the channel a query may.
   *
   * Amal, Anim, Move X and Move Y are four Lib_Par entries that all branch to
   * MvA3, and the limit is decided there (+Lib.s:11816):
   *
   *     moveq #16,d0
   *     tst.w InterOff(a5)
   *     beq.s InMva1
   *     moveq #64,d0
   *     InMva1: cmp.l d0,d6 / Rbcc L_FonCall
   *
   * so 0 to 15 under the interrupt and 0 to 63 once Synchro Off has set
   * InterOff. The queries do NOT share it: FnAm1 (+Lib.s:11920) is a flat
   * `Rbmi` plus `cmp.l #64,d1 / Rbcc`, so =Movon(40) is legal while the
   * `Amal 40` that would make it true is not.
   *
   * `clr.w PAmalE(a5)` (+Lib.s:11814) is the line above the limit, and it is
   * the ONLY place =Amal Err is ever cleared — the whole tree has three
   * references to that word, this one, the read in FnAmalerr and the write
   * in IAmE. So a declaration that compiles resets it, and the port, which
   * only ever wrote it, kept reporting the offset of an error two Amals ago.
   */
  const amDeclChannel = (n: number): number => {
    rt.amalErrPos = 0
    if (n >>> 0 >= (rt.synchroManual ? 64 : 16)) funcCall()
    return n
  }
  const amalSource = (it: It): string => {
    const bank = rt.refreshAmalBank()
    const v = it.evalExpr()
    if (v.k === 'str') return v.s
    if (!bank) throw new AmosError('bank not reserved', 36)
    if (bank.programs.length === 0) funcCall()
    const n = int(v) & 0xffff
    if (n >= bank.programs.length) funcCall()
    return bank.programs[n]!
  }

  /**
   * Pack / Spack (InPack6 / InSPack6, +Compact.s:142/165).
   *
   * PacPar (296) takes `screen, bank, x1, y1 To x2, y2`, forces the X
   * coordinates down to byte boundaries and clamps the far corner to the
   * screen, so the two-argument forms — which pass 0,0 To 10000,10000 — pack
   * the whole thing. Spack puts a 90-byte screen definition in front so
   * Unpack can rebuild the screen it came from.
   */
  const packOrSpack = (it: It, withScreen: boolean): void => {
    // `Pack screen To bank` / `Pack screen To bank,x1,y1,x2,y2` — the token
    // table in +Compact.s:74 spells both out: "I0t0" and "I0t0,0,0,0,0",
    // where t is the To separator. Only the one To; the manual's
    // ",x1,y1 TO x2,y2" and the source comment above InSPack6 are both
    // wrong, and the corpus writes `Pack 1 To 7,104,13,250,60`.
    const n = it.evalInt()
    const s = byIndex(n)
    it.expect('to')
    const bank = it.evalInt()
    let dx = 0
    let dy = 0
    let x2 = 10000
    let y2 = 10000
    if (it.accept(',')) {
      dx = it.evalInt()
      it.expect(',')
      dy = it.evalInt()
      it.expect(',')
      x2 = it.evalInt()
      it.expect(',')
      y2 = it.evalInt()
    }
    if (bank >>> 0 >= 0x10000) funcCall()
    // lsr.w #3 on both X coordinates, then the far corner clamps to the
    // screen's row width and height
    dx = (dx & 0xffff) >>> 3
    const tx = Math.min((x2 & 0xffff) >>> 3, s.rowBytes) - dx
    const ty = Math.min(y2 & 0xffff, s.height) - dy
    if (tx <= 0 || ty <= 0) funcCall()
    const bitmap = packBitmap(
      { planar: s.planarView('log', false), planeSize: s.planeSize, rowBytes: s.rowBytes, nPlanes: s.depth },
      dx,
      dy,
      tx,
      ty,
    )
    let data = bitmap
    if (withScreen) {
      // EcCon0 (+W.s:2964) carries the plane count in bits 12-14 alongside
      // the mode bits, which is what real Spack'd banks hold
      data = packScreen(
        {
          width: s.width,
          height: s.height,
          nColors: s.nColors,
          nPlanes: s.depth,
          mode: (s.depth << 12) | (s.hires ? 0x8000 : 0) | (s.laced ? 4 : 0) | (s.ham ? 0x800 : 0),
          awX: s.displayX,
          awY: s.displayY,
          awTX: s.displayW >= 0 ? s.displayW : Math.min(s.width, s.hires ? 640 : 320),
          awTY: s.displayH >= 0 ? s.displayH : Math.min(s.height, 256),
          avX: s.offsetX,
          avY: s.offsetY,
          palette: s.palette,
        },
        bitmap,
      )
    }
    rt.reserveBank(bank, data.length, 'Pac.Pic.')
    rt.memBanks.get(bank)!.data.set(data)
  }

  return {
    // ---- the Arexx family (+Lib.s:15025-15160) -------------------------
    /**
     * Arexx Open "PORT_NAME" --- `InArexxOpen` (+Lib.s:15010). The name is
     * copied into `Arx_PortName` with two checks the manual does not mention:
     * `cmp.w #32,d2 / Rbcc L_StooLong` refuses 32 characters or more, and
     * `cmp.b #" ",-1(a0) / Rble L_FonCall` refuses any character at or below
     * a space -- so a name with a space in it is a function-call error, not a
     * port with a space in it.
     */
    'arexx open'(it) {
      const name = it.evalStr()
      // L_StooLong is error 21, ED_RUN_MESSAGES[21]
      if (name.length >= 32) throw new AmosError(ED_RUN_MESSAGES[21]!, 21)
      for (const ch of name) if (ch <= ' ') funcCall()
      if (!rt.rexx.open(name)) funcCall()
      rt.arexx.port = name
    },

    /**
     * Arexx Close --- `InArexxClose` (+Lib.s:15066). Error 198 when a message
     * is still being held: `tst.l Arx_Answer(a5) / bne .Err`. A program must
     * answer before it may close, which is what stops a sender waiting for
     * ever on a reply that is never coming.
     */
    'arexx close'() {
      if (rt.arexx.held) throw new AmosError('Arexx message not answered', 198)
      if (rt.arexx.port !== null) rt.rexx.close(rt.arexx.port)
      rt.arexx.port = null
    },

    /**
     * Arexx Wait --- `InArexxWait` (+Lib.s:15052): `Sys_WaitMul`,
     * `Test_Normal`, then poll, round and round until a message arrives. It
     * yields the frame rather than spinning, which is what WaitMul does.
     *
     * With nothing sending, this waits for ever -- and so does the machine
     * with no ARexx script talking to it.
     */
    'arexx wait'(it) {
      if (arexxPoll(rt) === 0) {
        it.block({ type: 'wait', until: Math.floor(it.tick) + 1 }, true)
      }
    },

    /**
     * Arexx Answer ERROR [,"answer"] --- `InArexxAnswer1`/`2` (+Lib.s:15105),
     * two entries on one name; the one-argument form pushes AMOS's shared
     * empty string as the answer. The result string is only attached when the
     * sender set RXFF_RESULT in rm_Action -- `and.l #RXFF_RESULT,d0 / beq
     * .NoResult` -- so answering a message that did not ask for one drops the
     * string rather than raising.
     */
    'arexx answer'(it) {
      const code = it.evalInt()
      const answer = it.accept(',') ? it.evalStr() : ''
      const m = rt.arexx.held
      if (!m) funcCall()
      m.result1 = code
      if ((m.action & RXFF_RESULT) !== 0) m.result2 = answer
      m.replied = true
      rt.arexx.held = null
    },

    // ---- the Dev * family (+Lib.s:3274-3357) ---------------------------
    /**
     * Dev Open CHANNEL,NAME$,LENGTH,UNIT,FLAGS --- `Lib_Par InDevOpen`
     * (+Lib.s:3274). An empty name is a function-call error and so is a
     * LENGTH of zero or less (`Rble L_FonCall`); a channel already open is
     * error 140, from `Dev.Open`'s own `.AOp` arm.
     *
     * NOTE: the error message a failed OpenDevice raises is 145, which the
     * error table words as the SERIAL device's. `move.w #145,d3 / moveq #1,d4`
     * sets one message for every failure, and AMOS reused serial's rather than
     * giving the generic family one of its own -- so a trackdisk that will not
     * open reports a serial fault.
     *
     * Which names open is `DEV_MODELLED` in device.ts: this port has a back
     * end for trackdisk, serial, printer and parallel, and answering yes for
     * anything else would be claiming a device that does nothing.
     *
     * DEFECT: channel 7 is one slot past the end of the table. `Dev.GetA2`
     * (+Lib.s:3020) admits 0 to 7 with `cmp.l #Dev_Max,d0 / Rbhi L_FonCall`
     * and indexes with `mulu #12,d0`, but the table is `Dev_List rs.b
     * 12*Dev_Max` (+Equ.s:1394), 84 bytes for seven slots. Channel 7 lands at
     * offset 84, and `Lib_List rs.l 4*Lib_Max` starts there -- so `Dev Open 7`
     * writes its twelve bytes over the base pointers of libraries 0, 1 and 2.
     * Nothing here reproduces that: the three keywords that would show it,
     * `=Lib Base`, `=Lib Call` and `Lib Close`, are the m68k-deferred set.
     */
    'dev open'(it) {
      const chan = it.evalInt()
      it.expect(',')
      const name = it.evalStr()
      it.expect(',')
      const len = it.evalInt()
      it.expect(',')
      const unit = it.evalInt()
      it.expect(',')
      const flags = it.evalInt()
      if (name === '' || len <= 0) funcCall()
      if (chan < 0 || chan > DEV_MAX) funcCall()
      const existing = rt.dev.channels.get(chan)
      if (existing?.slot.open) throw ioError(140)
      if (!DEV_MODELLED.has(name.toLowerCase())) throw ioError(145)
      // the one modelled device with a real port behind it is opened now, so
      // a host that cannot give one reports the same failure OpenDevice would
      let serial
      if (name.toLowerCase() === 'serial.device') {
        serial = rt.host?.serial?.open(unit, DEV_SERIAL_DEFAULTS) ?? undefined
        if (!serial) throw ioError(145)
      }
      const slot = newDevSlot(145, 1)
      devOpen(slot)
      const addr = Runtime.DEV_IO_BASE + chan * DEV_IO_STRIDE
      rt.dev.io.fill(0, chan * DEV_IO_STRIDE, (chan + 1) * DEV_IO_STRIDE)
      rt.dev.channels.set(chan, { slot, name, unit, flags, addr, len, ...(serial ? { serial } : {}) })
    },

    /**
     * Dev Close [CHANNEL] --- `InDevClose0` (+Lib.s:3296) and `InDevClose1`
     * (+Lib.s:3303), two entries on one name. With no argument `Dev.Close` sweeps
     * every channel from Dev_Max down to zero; with one it closes that
     * channel alone. Closing a device that is not open is not an error, which
     * is `Dev.CloseA2`'s own behaviour.
     */
    'dev close'(it) {
      if (it.atStmtEnd()) {
        for (const c of rt.dev.channels.values()) {
          devClose(c.slot)
          c.serial?.close()
        }
        rt.dev.channels.clear()
        return
      }
      const chan = it.evalInt()
      const c = devSlotOf(rt.dev, chan)
      if (c) {
        devClose(c.slot)
        c.serial?.close()
      }
      rt.dev.channels.delete(chan)
    },

    /**
     * Dev Do CHANNEL,COMMAND --- `InDevDo` (+Lib.s:3323). The command word is
     * written into io_Command at `28(a1)` and the request run to completion,
     * waiting first for anything still outstanding. A non-zero io_Error
     * raises through `Dev.Error`.
     */
    'dev do'(it) {
      const chan = it.evalInt()
      it.expect(',')
      const cmd = it.evalInt()
      const c = devSlotOf(rt.dev, chan)
      if (!c) throw ioError(141)
      devDoIO(c.slot)
      rt.devCommand(c, cmd)
    },

    /**
     * Dev Send CHANNEL,COMMAND --- `InDevSend` (+Lib.s:3334), SendIO instead
     * of DoIO, leaving the state byte at 2 so the next request waits for this
     * one. DEVIATION: with every modelled transfer completing instantly the
     * only observable difference from Dev Do is that state byte, which is
     * what `=Dev Check` reads.
     */
    'dev send'(it) {
      const chan = it.evalInt()
      it.expect(',')
      const cmd = it.evalInt()
      const c = devSlotOf(rt.dev, chan)
      if (!c) throw ioError(141)
      devSendIO(c.slot)
      rt.devCommand(c, cmd)
    },

    /**
     * Dev Abort CHANNEL --- `InDevAbort` (+Lib.s:3345). AbortIO then WaitIO,
     * and both are skipped unless the device is open AND something is in
     * flight.
     */
    'dev abort'(it) {
      const c = devSlotOf(rt.dev, it.evalInt())
      if (!c) throw ioError(141)
      devAbort(c.slot)
    },

    // ---- screens ----
    'screen open'(it) {
      // ScOo2 (+Lib.s:8949) checks the screen number after the colour count,
      // so the number goes down unchecked and rt.openScreen tests it in the
      // right place
      const n = it.evalInt()
      it.expect(',')
      // EcCree +W.s:2881 masks the bitmap width down to a multiple of 16
      const w = it.evalInt() & ~15
      it.expect(',')
      const h = it.evalInt()
      it.expect(',')
      const nc = it.evalInt()
      it.expect(',')
      const mode = it.evalInt()
      rt.openScreen(n, w, h, nc, mode)
      // "Fait flasher la couleur 3 (si plus de 2 couleurs)" — only the
      // Screen Open instruction adds the system flash (+Lib.s:8989);
      // HAM (4096) is 6 planes so it qualifies
      if (nc === 4096 || nc > 2) rt.installSystemFlash()
    },
    'screen close'(it) {
      rt.closeScreen(checkScreenNumber(rt, optInt(it, rt.currentIndex)))
    },
    default() {
      // InDefault +Lib.s:8681: back to the boot display — every screen
      // closed, screen 0 reopened with the default palette and the boot
      // cursor flash
      for (const n of [...rt.screens.keys()]) rt.closeScreen(n)
      rt.openScreen(0, 320, 200, 16, 0)
      rt.installSystemFlash()
      // then every occupied slot's +$4 routine: extensions hook Default to
      // re-initialise their own settings, and TURBO Plus puts Scene Icon Bank
      // and Scene Mask Palette back here. AMCAF's Extdefault is this same
      // hook reached one slot at a time -- see extimpl.ts
      for (const impl of new Set(rt.extSlotImpls().values())) impl.defaults?.(rt)
    },
    'default palette'(it) {
      // InDefaultPalette +ILib.s:5360 is `lea DefPal(a5),a0 / bsr Plt`, the
      // same Plt that Palette uses. So the skip rule is the same one:
      // `tst.l d3 / bmi.s Plt2` (+ILib.s:5392) steps over the store for any
      // NEGATIVE value, not only for an elided slot. The port masked a
      // negative into 12 bits and wrote it, turning `Default Palette -1` into
      // white instead of leaving the default alone.
      let i = 0
      for (;;) {
        if (!(it.atStmtEnd() || it.nm() === ',')) {
          const v = it.evalInt()
          if (v >= 0 && i < 32) rt.defaultPalette[i] = v & 0xfff
        }
        i++
        if (!it.accept(',')) break
      }
    },
    'dual playfield'(it) {
      // SetDual +W.s:2810: a = front (PF1), b = back (PF2). The back
      // screen is hidden (BitHide) and its pixels resolve through the
      // FRONT screen's palette entries 8-15, like the hardware. Checks:
      // different screens, neither already dual, same resolution + mode
      // (EcCon0 compared with the plane bits masked out), planes <= 3
      // each (2 in hires), and counts equal or the back one fewer.
      // (Error 70's exact message text is not in the source tree.)
      const a = checkScreenNumber(rt, it.evalInt())
      it.expect(',')
      const b = checkScreenNumber(rt, it.evalInt())
      const sa = rt.screens.get(a)
      const sb = rt.screens.get(b)
      if (!sa || !sb) throw new AmosError('screen not opened', 47)
      const dualErr = (): never => {
        throw new AmosError('dual playfield impossible')
      }
      if (a === b || sa.dualPartner !== null || sb.dualPartner !== null) dualErr()
      if (sa.hires !== sb.hires || sa.laced !== sb.laced) dualErr()
      const cap = sa.hires ? 2 : 3
      if (sa.depth > cap || sb.depth > cap) dualErr()
      if (!(sa.depth === sb.depth || sa.depth === sb.depth + 1)) dualErr()
      sb.visible = false // BitHide on the back screen
      sa.dualPartner = b
      sa.dualIsBack = false
      sa.pf2Front = false
      sb.dualPartner = a
      sb.dualIsBack = true
    },
    'dual priority'(it) {
      // DualP +W.s:2841: both screens must be in dual mode; the FIRST-
      // named screen's playfield comes to the front (BPLCON2 bit 6, PFBA)
      // InDualPriority (+Lib.s:8894) checks BOTH numbers, same as
      // InDualPlayfield (+Lib.s:8881) above
      const a = checkScreenNumber(rt, it.evalInt())
      it.expect(',')
      const b = checkScreenNumber(rt, it.evalInt())
      if (!rt.screens.has(a) || !rt.screens.has(b)) throw new AmosError('screen not opened', 47)
      const sa = rt.screens.get(a)!
      const sb = rt.screens.get(b)!
      if (sa.dualPartner !== b || sb.dualPartner !== a) {
        // DualP's own refusal is EcE27 (+W.s:2843), and 27 + 44 is 71
        throw new AmosError(ED_RUN_MESSAGES[71]!, 71)
      }
      // the first-named screen's playfield comes forward
      const front = sa.dualIsBack ? sb : sa
      front.pf2Front = sa.dualIsBack
    },
    view() {
      // InView +Lib.s:9077: apply deferred display changes (CopMake)
      for (const s of rt.screens.values()) {
        if (rt.pendingView.has(s.index)) s.visible = true
      }
      rt.pendingView.clear()
    },
    'auto view on'() {
      /*
       * Turning it back on APPLIES what was deferred.
       *
       * `InAutoViewOn` (+Lib.s:9065) is one instruction, `bset #BitEcrans,
       * ActuMask`, and the bit it sets is a mask over `T_Actualise`. A
       * screen created meanwhile left BitEcrans set there (`EcTout`
       * +W.s:3111), and the per-VBL dispatcher reaches `EcCall CopMake` for
       * exactly that bit (+ILib.s:1011) as soon as the mask stops hiding it.
       * So the copper list is rebuilt at the next VBL with no `View` in the
       * program at all.
       *
       * Teratris opens its title screen inside `Auto View Off / Unpack 4 To
       * 0 / Double Buffer / Auto View On` and then waits for a click. With
       * the deferral never applied it waited on a black screen.
       */
      rt.autoView = true
      for (const s of rt.screens.values()) if (rt.pendingView.has(s.index)) s.visible = true
      rt.pendingView.clear()
    },
    'auto view off'() {
      rt.autoView = false
    },
    screen(it) {
      rt.setCurrent(checkScreenNumber(rt, it.evalInt()))
    },
    'screen display'(it) {
      // EcView +W.s:3247: n,x,y,w,h with per-arg keep-current; w/h set the
      // displayed-window size (EcAWTx/EcAWTy). It does NOT un-hide the screen.
      const s = byIndex(checkScreenNumber(rt, it.evalInt()))
      if (it.accept(',')) {
        s.displayX = optInt(it, s.displayX)
        if (it.accept(',')) {
          s.displayY = optInt(it, s.displayY)
          if (it.accept(',')) {
            s.displayW = optInt(it, s.displayW)
            if (it.accept(',')) s.displayH = optInt(it, s.displayH)
          }
        }
      }
    },
    'screen offset'(it) {
      const s = byIndex(checkScreenNumber(rt, it.evalInt()))
      it.expect(',')
      s.offsetX = optInt(it, s.offsetX)
      if (it.accept(',')) s.offsetY = optInt(it, s.offsetY)
    },
    // Screen Show and Screen Hide meet at ScShHi (+Lib.s:9057), which
    // checks the number whichever of the two arrived with it
    'screen hide'(it) {
      byIndex(checkScreenNumber(rt, optInt(it, rt.currentIndex))).visible = false
    },
    'screen show'(it) {
      byIndex(checkScreenNumber(rt, optInt(it, rt.currentIndex))).visible = true
    },
    // EcFirst and EcLast (+W.s:3274/3294) both open `bsr EcGet / beq EcE3`,
    // and EcE3 is `moveq #3,d0` (+W.s:3130) through EcWiErr, which adds
    // EcEBase-1 = 44 for error 47. Naming a screen that is not open is an
    // error, not the silent no-op the port had.
    'screen to front'(it) {
      const n = checkScreenNumber(rt, optInt(it, rt.currentIndex))
      byIndex(n)
      rt.toFront(n)
    },
    'screen to back'(it) {
      const n = checkScreenNumber(rt, optInt(it, rt.currentIndex))
      byIndex(n)
      rt.toBack(n)
    },
    /**
     * Screen Swap [n] --- two different routines, not one with a default.
     *
     * `InScreenSwap1` (+Lib.s:8869) is `Rbsr L_CheckScreenNumber / EcCall
     * SwapSc`, and ScSwap (+W.s:2593) opens `bsr EcGet / beq EcE3`, so a
     * screen that is not open is error 47. A screen that IS open but not
     * double-buffered falls out at `btst #BitDble,EcFlags(a4) / beq EcOk`
     * with no error.
     *
     * `InScreenSwap0` (+Lib.s:8859) calls ScSwapS instead (+W.s:2646), and
     * that one is `lea T_EcAdr(a5),a1 / moveq #8-1,d6` over every slot: it
     * swaps EVERY double-buffered screen, not the current one. The port
     * swapped just the current screen either way, so a game double-buffering
     * two screens and flipping them with a bare `Screen Swap` left the
     * second one showing its logical buffer.
     */
    'screen swap'(it) {
      if (it.atStmtEnd() || it.nm() === ',') {
        void rt.screen // `tst.w ScOn(a5) / Rbeq L_ScNOp` guards the bare form
        for (const s of rt.screens.values()) s.swap()
        return
      }
      byIndex(checkScreenNumber(rt, it.evalInt())).swap()
    },
    'double buffer'() {
      // InDoubleBuffer +Lib.s:8853: `EcCall Double / Rbne L_EcWiErr`, so a
      // second Double Buffer on the same screen is error 69, not a no-op
      if (!scr().doubleBuffer()) throw new AmosError('Screen already in double buffering', 69)
    },
    autoback(it) {
      // InAutoback (+Lib.s:9510) opens `cmp.l #3,d3 / Rbcc L_FonCall`, so
      // the range is 0 to 2 and not 0 to 3, and the error is 23 rather than
      // the 60 most of the console keywords raise. The port masked to 3,
      // which turned Autoback 3 into a mode AMOS refuses.
      const n = it.evalInt()
      if (n >>> 0 >= 3) funcCall()
      scr().autoback = n
    },
    'screen copy'(it) {
      const src = rt.resolveScreenId(it.evalInt())
      let x1 = 0
      let y1 = 0
      let x2 = src.s.width
      let y2 = src.s.height
      if (it.accept(',')) {
        x1 = it.evalInt()
        it.expect(',')
        y1 = it.evalInt()
        it.expect(',')
        x2 = it.evalInt()
        it.expect(',')
        y2 = it.evalInt()
      }
      it.expect('to')
      const dst = rt.resolveScreenId(it.evalInt(), true)
      let dx = 0
      let dy = 0
      if (it.accept(',')) {
        dx = it.evalInt()
        it.expect(',')
        dy = it.evalInt()
        // optional blitter mode
        if (it.accept(',')) it.evalInt()
      }
      Screen.copyBuf(src.s, src.buf, x1, y1, x2, y2, dst.s, dst.buf, dx, dy)
      // charge the blitter cost so a no-Wait-Vbl loop that Screen Copies
      // every iteration paces realistically (~pixels/16 budget units)
      it.charge((Math.max(0, x2 - x1) * Math.max(0, y2 - y1)) >> 4)
    },

    // ---- drawing ----
    cls(it) {
      // InCls +Lib.s:8722: no arg = clear the current WINDOW and home its
      // cursor (Clw); Cls c / region clears pixels without homing
      const s = scr()
      if (it.atStmtEnd()) {
        s.clw()
        return
      }
      const c = it.evalInt()
      if (it.accept(',')) {
        const [x1, y1] = pair(it)
        it.expect('to')
        const [x2, y2] = pair(it)
        s.cls(c, x1, y1, x2 - 1, y2 - 1)
      } else {
        s.cls(c)
      }
    },
    ink(it) {
      /*
       * Ink [pen][,[paper]][,[border]]. InInk3 (+Lib.s:10069) unwinds the
       * arguments backwards and each one is skipped when it holds EntNul:
       * the BORDER arrives in d3 and goes straight into the RastPort with
       * `move.b d3,27(a1)`, which is AOlPen; then `(a3)+` gives the paper to
       * SetBPen and `(a3)+` the pen to SetAPen. Nothing is range-checked —
       * the three graphics pens take whatever they are handed.
       *
       * All three land in RastPort BYTES, AOlPen directly and the other two
       * through SetAPen/SetBPen, so `Ink 0,0,300` keeps 44.
       */
      const s = scr()
      if (it.nm() !== ',' && !it.atStmtEnd()) s.ink = it.evalInt() & 0xff
      if (it.accept(',')) {
        if (it.nm() !== ',' && !it.atStmtEnd()) s.gPaper = it.evalInt() & 0xff
        if (it.accept(',') && !it.atStmtEnd()) s.gBorder = it.evalInt() & 0xff
      }
    },
    plot(it) {
      const s = scr()
      const slots = optPair(it)
      /*
       * InPlot3 (+Lib.s:9535) settles the pen before it touches the
       * coordinates:
       *
       *     move.l d3,d0 / Rbmi L_FonCall
       *     cmp.l #EntNul,d0 / beq.s .Skip / GfxCa5 SetAPen
       *
       * so a negative pen is an Illegal function call, a blank one is left
       * alone, and a given one goes through `SetAPen` — the RastPort's own
       * pen, which OUTLIVES the statement. `Plot 0,0,5 : Plot 9,9` draws the
       * second point in 5 as well. The two-argument form has none of this and
       * draws in the current ink.
       */
      if (it.accept(',') && !omittedArg(it)) {
        const c = it.evalInt()
        if (c < 0) funcCall()
        s.ink = c
      }
      const [x, y] = grXY(s, ...slots)
      s.plot(x, y)
    },
    draw(it) {
      /*
       * InDraw (+Lib.s:9588) does not hand its start point to the draw at
       * all. It pops the four arguments, puts the first two through `Rbsr
       * L_GrXY` and then draws from wherever the cursor now is to the last
       * two. GrXY is the same routine Gr Locate calls and skips an EntNul
       * axis, and the spec is "I0,0t0,0", so `Draw ,100 To 200,50` keeps the
       * graphics cursor's own x for the start. The port read the pair
       * without elision and passed it straight to the line.
       */
      const s = scr()
      if (!it.accept('to')) {
        grXY(s, ...optPair(it))
        it.expect('to')
      }
      const [x, y] = drawEnd(it)
      s.line(s.grX, s.grY, x, y)
    },
    'draw to'(it) {
      // InDrawTo (+Lib.s:9579) is the same tail without the GrXY
      const s = scr()
      const [x, y] = drawEnd(it)
      s.line(s.grX, s.grY, x, y)
    },
    'gr locate'(it) {
      // InGrLocate (+Lib.s:9661) is `move.l d3,d1 / move.l (a3)+,d0 / Rbsr
      // L_GrXY` and nothing else, so `Gr Locate ,100` moves y alone
      grXY(scr(), ...optPair(it))
    },
    box(it) {
      const [x1, y1] = pair(it)
      it.expect('to')
      const [x2, y2] = pair(it)
      scr().box(x1, y1, x2, y2)
    },
    bar(it) {
      // InBar +Lib.s:9946: x2<=x1 or y2<=y1 is a function call error
      const s = scr()
      const [x1, y1] = pair(it)
      it.expect('to')
      const [x2, y2] = pair(it)
      if (x2 <= x1 || y2 <= y1) funcCall()
      s.bar(x1, y1, x2, y2)
      s.grX = x1 // InBar sets the graphics cursor to the top-left corner
      s.grY = y1
    },
    circle(it) {
      const s = scr()
      const slots = optPair(it)
      it.expect(',')
      const r = it.evalInt()
      /*
       * InCircle (+Lib.s:9603) is `move.l d3,d2 / Rbls L_FonCall`, and a
       * `move` CLEARS the carry, so `bls` can only branch on Z: the error is a
       * radius of exactly zero and a negative one is passed through to
       * `EllCir`. Testing `r <= 0` here refused `Circle 10,10,-5`, which the
       * original draws.
       *
       * The test comes before `EllCir` reaches `GrXY`, so an error leaves the
       * graphics cursor where it was.
       */
      if (r === 0) funcCall()
      // on a hires screen the x-radius is doubled so the circle is round on
      // non-square pixels
      const [x, y] = grXY(s, ...slots)
      s.ellipse(x, y, s.hires ? r * 2 : r, r)
    },
    ellipse(it) {
      const s = scr()
      const slots = optPair(it)
      it.expect(',')
      const rx = it.evalInt()
      it.expect(',')
      const ry = it.evalInt()
      // InEllipse (+Lib.s:9617) is `tst.l d3 / Rbls` then `move.l (a3)+,d2 /
      // Rbls`, and both flag-setters clear the carry, so each `bls` is a
      // `beq`. Zero is the error, negative is not. d3 is the LAST argument,
      // so the y radius is the one tested first.
      if (ry === 0 || rx === 0) funcCall()
      const [x, y] = grXY(s, ...slots)
      s.ellipse(x, y, rx, ry)
    },
    polyline: polyish(false),
    polygon: polyish(true),
    paint(it) {
      // graphics.library Flood: mode 1 (default) fills the same-colour
      // region; mode 0 fills until the outline pen (Ink's 3rd argument)
      const s = scr()
      const [x, y] = pair(it)
      const mode = it.accept(',') ? it.evalInt() & 1 : 1
      s.paint(x, y, s.ink, mode === 0)
      s.grX = x
      s.grY = y
    },
    text(it) {
      // InText +Lib.s:9820: cursor to x,y then advanced by the string width
      const s = scr()
      const [x, y] = pair(it)
      it.expect(',')
      const str2 = it.evalStr()
      s.text(x, y, str2)
      s.grX = x + str2.length * 8
      s.grY = y
    },
    clip(it) {
      const s = scr()
      if (it.atStmtEnd()) {
        s.clip = null
        return
      }
      const [x1, y1] = pair(it)
      it.expect('to')
      const [x2, y2] = pair(it)
      s.clip = { x1, y1, x2: x2 - 1, y2: y2 - 1 }
    },

    // ---- palette ----
    colour(it) {
      // InColour (+Lib.s:9185) hands both numbers to EcSCol (+W.s:3812),
      // which is `and.w #31,d1` on the index and `and.w #$FFF,d2` on the
      // value and cannot fail — `moveq #0,d0 / rts`. Both masks below are
      // the routine's own, not a shortcut, and there is no error to raise.
      const s = scr()
      const n = it.evalInt()
      it.expect(',')
      s.palette[n & 31] = it.evalInt() & 0xfff
    },
    'colour back'(it) {
      // EcSColB (+W.s:3878) opens `and.w #$FFF,d1` and nothing else
      rt.colourBack = it.evalInt() & 0xfff
    },
    palette(it) {
      const s = scr()
      let i = 0
      do {
        const v = it.atStmtEnd() || it.nm() === ',' ? -1 : it.evalInt()
        if (v >= 0 && i < 32) s.palette[i] = v & 0xfff
        i++
      } while (it.accept(','))
    },
    /**
     * Get Palette n[,mask] (InGetPalette1/2 +Lib.s:9244/9279). The one-argument
     * form pushes the screen and sets the mask to -1, then falls into the
     * two-argument one — which is why an absent mask means every colour.
     *
     * The screen may be omitted: `Get Palette,0` is in the corpus
     * (APD470/HomeRun2). An omitted slot has a defined value — the comma's
     * FUNCTION routine is `FnNull` (+ILib.s:3725), which loads `EntNul`
     * ($80000000, +Equ.s:39) into d3 and steps the token pointer back two so
     * the collector's own comma-skip still lands right. Keywords that accept
     * omission test for it: `Set Talk` and `Talk Misc` (+Music.s:2621/4395)
     * compare every parameter against EntNul and leave the field alone.
     *
     * Get Palette does not test for it, so the sentinel reaches `L_GetEc` as
     * a screen number. It does not matter: mask 0 means `PalRout`'s
     * `btst d0,d3` never fires, every entry stays the $FFFF "unchanged"
     * marker, and nothing is copied whichever screen was named. The omitted
     * slot resolves to the current screen here, which is the one choice that
     * cannot throw.
     */
    'get palette'(it) {
      const src = it.nm() === ',' ? scr() : byIndex(it.evalInt())
      const mask = it.accept(',') ? it.evalInt() : -1
      const dst = scr()
      for (let i = 0; i < 32; i++) if (mask & (1 << i)) dst.palette[i] = src.palette[i]!
    },
    // ShD1 (+Lib.s:9329) opens `tst.w ScOn(a5) / Rbeq L_ScNOp` before it pops
    // a single argument, and InShiftOff (+Lib.s:9310) is that guard and one
    // EcCall. The port reached currentIndex, which answers 0 whether or not a
    // screen is open.
    'shift up'(it) {
      void rt.screen
      rt.shifts.set(rt.currentIndex, { dir: 1, ...shiftArgs(it), count: 0 })
    },
    'shift down'(it) {
      void rt.screen
      rt.shifts.set(rt.currentIndex, { dir: -1, ...shiftArgs(it), count: 0 })
    },
    'shift off'() {
      void rt.screen
      rt.shifts.delete(rt.currentIndex)
    },
    'set line'(it) {
      // InSetLine (+Lib.s:10108) is one `move.w d3,34(a0)` into the
      // RastPort's LinePtrn, so the mask below is the instruction's own
      scr().linePattern = it.evalInt() & 0xffff
    },
    'set paint'(it) {
      // InSetPaint (+Lib.s:9906) reads the RastPort Flags word, clears bit 3
      // (AREAOUTLINE) and puts it back with `tst.l d3 / beq.s ISpt / bset
      // #3,d0`, so any non-zero turns outlining on and 0 turns it off
      scr().outline = it.evalInt() !== 0
    },
    'set font'(it) {
      // InSetFont +Lib.s:9806: negative errors; needs Get Fonts first
      // ("fonts not examined", error 37); Set Font 0 is a silent no-op
      // (TSFont +W.s:4922); an unknown number is "font not available"
      const n = it.evalInt()
      if (n < 0) funcCall()
      if (!rt.fontsListed) throw new AmosError('fonts not examined', 37)
      if (n === 0) return
      const entry = examinedFonts(rt)[n - 1]
      if (!entry) throw new AmosError('font not available', 44)
      rt.currentFont = n
      if (entry.file) {
        // a real disc font: load <dir><name>/<size> onto the screen. The dir
        // is Fonts: for anything AvailFonts found there and the opened file's
        // own drawer for one Ldisk Font brought in from elsewhere
        const bytes = rt.vfs?.read((entry.dir ?? 'Fonts:') + entry.file)
        const df = bytes ? parseDiskFont(bytes) : null
        if (!df) throw new AmosError('font not available', 44)
        scr().font = df
      } else {
        scr().font = null // ROM/synthetic: the built-in 8x8 face
      }
    },
    // InGetFonts/Igf +Lib.s:9743: d1 mask 3/1/2 selects rom+disc, rom
    // only, disc only; Font$/Set Font see the filtered list
    'get fonts'() {
      rt.fontsListed = 3
      rt.discFontCache = null
    },
    'get rom fonts'() {
      rt.fontsListed = 1
    },
    'get disc fonts'() {
      rt.fontsListed = 2
      rt.discFontCache = null
    },
    'request on'() {
      rt.requestMode = 1
    },
    'request off'() {
      rt.requestMode = 0
    },
    'request wb'() {
      rt.requestMode = 2
    },
    hslider(it) {
      slider(it, scr(), false)
    },
    vslider(it) {
      slider(it, scr(), true)
    },
    'set slider'(it) {
      // SliSet +W.s:5217: 8 params, elided ones keep their current value
      const cfg = scr().slider
      const vals: Array<number | null> = []
      for (let i = 0; i < 8; i++) {
        if (i > 0 && !it.accept(',')) break
        vals.push(it.atStmtEnd() || it.nm() === ',' ? null : it.evalInt())
      }
      const [fa, fb, fc, fpat, ia, ib, ic, ipat] = vals
      if (fa != null) cfg.fa = fa
      if (fb != null) cfg.fb = fb
      if (fc != null) cfg.fc = fc
      if (fpat != null) cfg.fpat = resolvePattern(rt, fpat)
      if (ia != null) cfg.ia = ia
      if (ib != null) cfg.ib = ib
      if (ic != null) cfg.ic = ic
      if (ipat != null) cfg.ipat = resolvePattern(rt, ipat)
    },
    'set pattern'(it) {
      const n = it.evalInt()
      const s = scr()
      // SPat (+W.s:4695) opens `bsr EffPat`, "efface l'ancien", BEFORE it
      // looks at the argument at all. Every exit after that has already
      // dropped the old pattern, including the quiet ones below, so
      // `Set Pattern -99` with no sprite 99 leaves a solid fill and not the
      // pattern that was there before it.
      s.pattern = null
      if (n === 0) return
      if (n < 0) {
        // negative: a sprite image is the fill pattern (SPat1 +W.s:4712).
        // A missing bank, a number past the bank count and a null image all
        // reach SPatX, which is `moveq #0,d0` — success, quietly.
        const img = rt.spriteBank?.image(-n)
        if (!img) return
        /*
         * SPat3 (+W.s:4729) walks d0 up in powers of two hunting for the
         * height, and SPat4 backs off one step when it overshoots, so the
         * pattern is the largest power of two NOT ABOVE the sprite. The
         * search gives up once d3 reaches 8, which puts the ceiling at 128
         * rows, and that exit is SPatE — error 23, not a silent clamp.
         */
        if (img.height > 128) funcCall()
        let rows = 1
        while (rows * 2 <= img.height) rows *= 2
        const bits = new Uint16Array(rows)
        for (let y = 0; y < rows; y++) {
          let row = 0
          for (let x = 0; x < Math.min(16, img.width); x++) {
            if (img.pixels[y * img.width + x] !== 0) row |= 1 << (15 - x)
          }
          bits[y] = row
        }
        s.pattern = bits
        return
      }
      // positive patterns come from the machine mouse bank (SPat +W.s:4701)
      s.pattern = rt.systemPattern(n)
    },
    fade(it) {
      // InFade +ILib.s:5411. Every `speed` ticks each RGB nibble steps one
      // toward its target. Forms:
      //   Fade n              → fade to black
      //   Fade n,c1,c2,...    → to those colours (elided = untouched)
      //   Fade n To s         → to screen s's palette (s<0 = sprite bank)
      //   Fade n To s,mask    → the same, for the colours the MASK selects
      const delay = Math.max(1, it.evalInt())
      const targets = new Int32Array(32).fill(-1)
      if (it.accept('to')) {
        const s = it.evalInt()
        const pal = s < 0 ? rt.spriteBank?.palette : rt.screens.get(s)?.palette
        /*
         * A MASK, not a colour list. `IFat2` (+ILib.s:5436) is `moveq #-1,d3`
         * and a comma after the screen replaces d3; `PalRout` (+Lib.s:9264)
         * then walks all 32 colours:
         *
         *     PalR1  move.w #$FFFF,(a1)      leave this one alone
         *            btst   d0,d3
         *            beq.s  PalR2
         *            move.w (a0),(a1)        ... unless its bit is set
         *
         * so a clear bit means untouched, which is what $FFFF is throughout
         * this port's `-1`. Reading the value as a colour override for
         * colour 0 turned Doctor Strange 2's `Fade 1 To -1,$FFFF-$1`, which
         * asks for every colour BUT the background, into a fade of the
         * background up to $FFE. The game played on a white sky.
         */
        const mask = it.accept(',') ? it.evalInt() : -1
        for (let j = 0; j < 32; j++) targets[j] = ((mask >> j) & 1) === 1 ? (pal?.[j] ?? 0) & 0xfff : -1
      } else {
        let i = 0
        let any = false
        while (it.accept(',')) {
          if (!(it.atStmtEnd() || it.nm() === ',')) {
            if (i < 32) targets[i] = it.evalInt() & 0xfff
            any = true
          }
          i++
        }
        if (!any) targets.fill(0) // Fade n alone: fade everything to black
      }
      rt.fade = { scr: scr(), delay, count: 0, targets }
    },
    'flash off'() {
      // InFlashOff (+Lib.s:9285) is `tst.w ScOn(a5) / Rbeq L_ScNOp / EcCall
      // FlRaz`, and FlStop (+W.s:5256) stops the flashes of the ACTIVE screen
      // only
      void rt.screen
      rt.flashOff()
    },
    flash(it) {
      // InFlash (+Lib.s:9294) makes the same screen check before it reads the
      // string, so no screen beats a bad declaration
      void rt.screen
      const reg = it.evalInt()
      it.expect(',')
      const spec = it.evalStr()
      const seq = parseFlashSpec(spec)
      // flsynt (+W.s:5333): a bad string still clears the colour's entry,
      // then errors (code 8 → message 52, "Flash declaration error")
      if (seq === null) {
        rt.flashStop(reg)
        throw new AmosError('flash declaration error', 52)
      }
      // Flash n,"" is the documented way to stop one colour — no error
      if (seq.length === 0) {
        rt.flashStop(reg)
        return
      }
      rt.flashStart(reg, seq)
    },

    // ---- rainbows (TRSet/TRDo/TRVar/TRDel, +W.s:3916-4170) ----
    'set rainbow'(it) {
      // Set Rainbow n,colour,length,r$,g$,b$[,seed]: builds the 12-bit
      // table once, via three per-channel wave machines (Trs1/Trs2).
      // Bounds from InSetRainbow7 +Lib.s:9356: n < 4, 16 <= length < 32700;
      // the colour is masked &31 THEN must be < PalMax=16 (TRSet +W.s:3999)
      // — so colour 33 legally wraps to 1. The optional 7th value seeds the
      // three channel nibbles (R=bits 8-11, G=4-7, B=0-3).
      const n = it.evalInt()
      it.expect(',')
      const colour = it.evalInt()
      it.expect(',')
      const len = it.evalInt()
      it.expect(',')
      const rs = it.evalStr()
      it.expect(',')
      const gs = it.evalStr()
      it.expect(',')
      const bs = it.evalStr()
      const seed = it.accept(',') ? it.evalInt() : 0
      if (n >>> 0 >= 4) funcCall()
      if (len < 16 || len >= 32700) funcCall()
      if (colour < 0) funcCall()
      const c = colour & 31
      if (c >= 16) funcCall()
      let table: Uint16Array
      try {
        table = buildRainbowTable(len, seed, rs, gs, bs)
      } catch {
        // TrSynt deletes the half-made rainbow and errors (+W.s:4113)
        rt.rainbows.delete(n)
        funcCall()
      }
      // fresh entry: nothing displayed until a Rainbow instruction (RnI=-1)
      rt.rainbows.set(n, { colour: c, table, base: 0, x: 0, y: 0, h: -1, act: 0, dy: 0, fy: 0, ty: 0 })
    },
    rainbow(it) {
      // Rainbow n[,base][,y][,h] (TRDo +W.s:3911): elided values keep the
      // current ones; changes are latched as RnAct bits and folded in at
      // the next copper build. Errors report as OUT OF MEMORY — RainEr
      // returns 1, which EcWiErr maps to L_OOfMem (+Lib.s).
      const n = it.evalInt()
      const rb = rt.rainbows.get(n)
      if (n >>> 0 >= 4 || !rb || rb.table.length === 0) throw new AmosError('out of memory', 24)
      it.expect(',')
      if (!(it.atStmtEnd() || it.nm() === ',')) {
        rb.x = it.evalInt()
        rb.act |= 2
      }
      if (it.accept(',')) {
        if (!(it.atStmtEnd() || it.nm() === ',')) {
          rb.y = it.evalInt()
          rb.act |= 4
        }
        if (it.accept(',') && !it.atStmtEnd()) {
          // the tutorial writes `Rainbow N,Y,,` — trailing elision keeps h
          rb.h = it.evalInt()
          rb.act |= 1
        }
      }
    },
    'rainbow del'(it) {
      // TRDel +W.s:4131: no argument clears every rainbow
      if (it.atStmtEnd()) rt.rainbows.clear()
      else rt.rainbows.delete(it.evalInt())
    },

    // ---- user copper (TCop* +W.s:6815-6935) ----
    'copper on'() {
      rt.copperOnOff(true)
    },
    'copper off'() {
      rt.copperOnOff(false)
    },
    'cop swap'() {
      rt.copSwapUser()
    },
    'cop reset'() {
      rt.copResetUser()
    },
    'cop wait'(it) {
      // Cop Wait x,y[,xmask,ymask] — masks default -1 (InCopWait2 +Lib.s:9458)
      const x = it.evalInt()
      it.expect(',')
      const y = it.evalInt()
      let mx = -1
      let my = -1
      if (it.accept(',')) {
        mx = it.evalInt()
        it.expect(',')
        my = it.evalInt()
      }
      rt.copWait(x, y, mx, my)
    },
    'cop move'(it) {
      const reg = it.evalInt()
      it.expect(',')
      rt.copMove(reg, it.evalInt())
    },
    'cop movel'(it) {
      const reg = it.evalInt()
      it.expect(',')
      rt.copMoveL(reg, it.evalInt())
    },
    rain(it) {
      // assignment form: Rain(n,line) = colour (TRVar +W.s:3937: bounds
      // checked, the value masked to 12 bits; errors are OUT OF MEMORY
      // via EcWiErr, like Rainbow)
      it.expect('(')
      const n = it.evalInt()
      it.expect(',')
      const line = it.evalInt()
      it.expect(')')
      it.expectOp('=')
      const v = it.evalInt()
      const rb = rt.rainbows.get(n)
      if (n >>> 0 >= 4 || !rb || rb.table.length === 0 || line < 0 || line >= rb.table.length)
        throw new AmosError('out of memory', 24)
      rb.table[line] = v & 0xfff
    },

    // ---- text console extras ----
    /*
     * WCentre (+W.s:15543) measures the string with Compte (+W.s:15597),
     * which counts a printable byte as one and an ESC as none, skipping the
     * two bytes behind it:
     *
     *     Copt1: tst.b (a0) / beq.s Copt2
     *            addq.w #1,d0
     *            cmp.b #27,(a0)+ / bne.s Copt1
     *            subq.w #1,d0 / addq.l #2,a0 / bra.s Copt1
     *
     * So `Centre Pen$(3)+"Hi"` centres two characters, not five, and the
     * port started it two columns to the left of where AMOS puts it.
     *
     * `sub.w d0,d1 / lsr.w #1,d1` is a LOGICAL shift, so a string wider than
     * the window yields a column near 32767 and Loca refuses it. WCentre
     * never tests what LocaX returned -- it falls straight into Prt -- so an
     * over-long string prints from the column the cursor was already on,
     * with no move and no error. The port homed it to column 0 instead.
     */
    centre(it) {
      const s = scr()
      const t = it.evalStr()
      let visible = 0
      for (let i = 0; i < t.length; i += t.charCodeAt(i) === 27 ? 3 : 1) {
        if (t.charCodeAt(i) !== 27) visible++
      }
      if (visible <= s.cols) s.locate((s.cols - visible) >> 1, -1)
      s.writeText(t)
    },
    cdown() {
      // InCdown (+Lib.s:13373) sends chr(31), which is CDown (+W.s:14939) --
      // down one row with the COLUMN kept. It is not a new line.
      scr().writeText('\x1f') // ChCDn +Lib.s:13377
    },
    // Every cursor move is a console CHARACTER on the machine — InCup is
    // `lea ChCUp` + GoWn with ChCUp = chr(30) (+Lib.s:13365) — so it runs
    // inside WOutC's EffCur/AffCur bracket and the drawn cursor moves with
    // it. Sending the character rather than poking curX/curY is both the
    // faithful path and the one that cannot leave a cursor behind.
    cup() {
      scr().writeText('\x1e') // ChCUp +Lib.s:13369
    },
    cleft() {
      scr().writeText('\x1d') // ChCLf +Lib.s:13353
    },
    cright() {
      scr().writeText('\x1c') // ChCRt +Lib.s:13361
    },
    cmove(it) {
      /*
       * InCmove (+Lib.s:13276): elided arguments mean 0 (WnCm1/WnCm3), then
       * `add.l #128,d0 / cmp.l #255,d0 / Rbhi L_WFonCall` on each. The
       * compare is unsigned after the bias, so the range is -128..127 and a
       * value outside it is error 60. The instruction takes -128 where the
       * Cmove$ function refuses it, because Cmove$ tests the raw value.
       */
      const dx = optInt(it, 0)
      it.accept(',')
      const dy = optInt(it, 0)
      if ((dx + 128) >>> 0 > 255 || (dy + 128) >>> 0 > 255) {
        throw new AmosError(ED_RUN_MESSAGES[60]!, 60)
      }
      // ChCMv is a fixed six-byte template, so both escapes always go out.
      // Sending them rather than calling locate() is what makes Cmove clamp
      // at the window edge instead of erroring there.
      scr().writeText('\x1bN' + String.fromCharCode((128 + dx) & 0xff) + '\x1bO' + String.fromCharCode((128 + dy) & 0xff))
    },
    clw(it) {
      void it
      scr().clw() // clears the current WINDOW only
    },
    // the same again: ESC "M0".."M3" (+Lib.s:13502-13526)
    'memorize x'() {
      scr().writeText('\x1bM0')
    },
    'memorize y'() {
      scr().writeText('\x1bM2')
    },
    'remember x'() {
      scr().writeText('\x1bM1')
    },
    'remember y'() {
      scr().writeText('\x1bM3')
    },
    'set curs'(it) {
      // eight rows, top first (InSetCurs +Lib.s:13232). It used to skip the
      // arguments because the cursor was a compositor overlay of one fixed
      // shape; the cursor is in the bitmap now, so the shape is real.
      const rows: number[] = [it.evalInt()]
      while (rows.length < 8) {
        it.expect(',')
        rows.push(it.evalInt())
      }
      scr().setCursShape(rows)
    },
    cline(it) {
      /*
       * InCline0 (+Lib.s:13461) is the bare form and sends control code 26.
       * InCline1 (+Lib.s:13501) takes the count and checks it first: `tst.l
       * d3 / Rbeq L_WFonCall / cmp.l #255-48,d3 / Rbcc L_WFonCall`, so 1 to
       * 206 and error 60 outside. The port took any number at all.
       */
      const s = scr()
      const bare = it.atStmtEnd()
      const n = bare ? s.cols - s.curX : it.evalInt()
      if (!bare && (n === 0 || n >>> 0 >= 207)) throw new AmosError(ED_RUN_MESSAGES[60]!, 60)
      s.bar(s.curX * 8, s.curY * 8, (s.curX + n) * 8 - 1, s.curY * 8 + 7, s.paper)
    },
    'curs pen'(it) {
      // InCursPen (+Lib.s:13301) sends ESC "D" + the colour, so the change
      // reaches the cursor that is already drawn — CurCol (+W.s:14778) sits
      // inside the same bracket and refuses a colour the screen has not got
      // WnPp (+Lib.s:13323) adds the digit with `add.b #"0",d3`, a BYTE, so
      // the colour arrives modulo 256 here too
      const b = (it.evalInt() + 48) & 0xff
      const s = scr()
      if (b - 48 < 0 || b - 48 >= s.nColors) throw new AmosError('illegal text window parameter', 60)
      s.writeText(`\x1bD${String.fromCharCode(b)}`)
    },
    'curs on'() {
      // InCursOn +Lib.s:13389 sends ESC "C1", and every console character
      // runs inside WOutC's EffCur/AffCur bracket (+W.s:15356) — which is
      // what lifts the drawn cursor out of the bitmap before the flag moves
      const s = scr()
      s.console(() => {
        s.cursorOn = true
      })
    },
    'curs off'() {
      const s = scr()
      s.console(() => {
        s.cursorOn = false
      })
    },
    writing(it) {
      /*
       * Writing w1[,w2]: 0 replace/1 OR/2 XOR/3 AND/4 ignore; w2: 0 both,
       * 1 paper only, 2 pen on colour 0 (console escape 'W').
       *
       * InWriting2 (+Lib.s:13148) checks both, `cmp.l #3,d0 / Rbcc` on w2
       * and `cmp.l #5,d1 / Rbcc` on w1, so 0 to 2 and 0 to 4, error 60. The
       * port masked instead, which let Writing 7 through as 7.
       *
       * InWriting1 (+Lib.s:13142) is the one-argument form, and it pushes
       * its argument and sets d3 to zero before falling in — so `Writing 2`
       * RESETS w2, where the port left the previous value standing.
       */
      const w = scr().curWin
      const w1 = it.evalInt()
      const w2 = it.accept(',') ? it.evalInt() : 0
      if (w1 >>> 0 >= 5 || w2 >>> 0 >= 3) throw new AmosError(ED_RUN_MESSAGES[60]!, 60)
      w.writing1 = w1
      w.writing2 = w2
    },
    'gr writing'(it) {
      // SetDrMd: 0 JAM1 (transparent), 1 JAM2, 2 COMPLEMENT (XOR).
      // InGrWriting (+Lib.s:10090) refuses a negative with Rbmi L_FonCall
      // and passes everything else to SetDrMd whole, with no mask.
      const n = it.evalInt()
      if (n < 0) funcCall()
      scr().grMode = n & 7
    },
    'set tab'(it) {
      /*
       * InSetTab (+Lib.s:13543) is `cmp.l #255-48,d3 / Rbhi L_WFonCall`, so
       * 0 to 207 and error 60 outside. Rbhi rather than Cline's Rbcc, which
       * is why 207 passes here and fails there, and why there is no tst.l:
       * AMOS sends a tab of 0 straight to the window code. The port clamps
       * it to 1 instead, because a tab of 0 has nothing to step by.
       */
      const raw = it.evalInt()
      if (raw >>> 0 > 207) throw new AmosError(ED_RUN_MESSAGES[60]!, 60)
      const n = Math.max(1, raw)
      scr().curWin.tab = n
      it.tabWidth = n // transcripts mirror the console
    },
    'wind open'(it) {
      const n = it.evalInt()
      it.expect(',')
      const [x, y] = pair(it)
      it.expect(',')
      const [w, h] = pair(it)
      const border = it.accept(',') ? it.evalInt() : 0
      /*
       * InWindopen7 (+Lib.s:13057) is `cmp.l #65536,d1 / Rbcc L_WFonCall`,
       * and it is there because WOpen keeps the number in a word: `move.w
       * d1,WiNumber(a5)` (+W.s:13664). The compare is unsigned, so a
       * negative fails it too. Without the test `Wind Open 70000` opened
       * window 4464 and =Windon said so.
       *
       * The number is checked in +Lib.s, before WOpen runs, so it beats the
       * already-open test; the border check inside WOpen (+W.s:13676) loses
       * to it, which is why that one moved down into windOpen.
       */
      if (n >>> 0 >= 65536) throw new AmosError(ED_RUN_MESSAGES[60]!, 60)
      // windOpen already throws AmosError with WErr2's number; the catch that
      // used to sit here rebuilt it as `new AmosError(message)`, and the
      // second argument defaults to 0, so =Errn read 0 for every one of them
      scr().windOpen(n, x, y, w, h, border)
    },
    'wind close'() {
      scr().windClose()
    },
    'wind save'() {
      scr().windSave = true
    },
    'wind move'(it) {
      const s = scr()
      const [x, y] = pair(it)
      windParams(x, y)
      // WiMv0 (+W.s:13880) brackets the move with EffCur/AffCur — without
      // that the cursor stays drawn at the window's old position
      s.console(() => {
        const w = s.curWin
        const b = w.border !== 0 ? 8 : 0
        w.x = ((x >> 4) << 4) + b
        w.y = y + b
        s.drawWindowFrame2()
      })
    },
    'wind size'(it) {
      // WiSize +W.s:13941: resize, redraw the frame, then Clw the interior
      // (the window is blanked to paper and the cursor homed)
      const s = scr()
      const [w2, h2] = pair(it)
      windParams(w2, h2)
      // WiSi0 (+W.s:13950), bracketed for the same reason as Wind Move
      s.console(() => {
        s.curWin.cols = w2
        s.curWin.rows = h2
        s.drawWindowFrame2()
        s.clw()
      })
    },
    window(it) {
      // WQWind (+W.s:13826) is `bsr WindFind / bne WErr1`, and WErr1 is
      // `moveq #10,d0` (+W.s:15827) which reaches error 54 through EcWiErr.
      // selectWindow raises exactly that; the catch that used to wrap it
      // threw the message away from its number and left =Errn reading 0.
      scr().selectWindow(it.evalInt())
    },
    border(it) {
      // Border n[,paper][,pen], and n itself may be omitted: `Border,0,14`
      // is legal and appears in the PD corpus (APD076/BomBase1_0 and four
      // others). AMOS pushes a slot for every parameter in the spec whether
      // it was typed or not, so the routine always pops the same count —
      // which is why an empty leading slot parses there and used to reach
      // keyword dispatch here as a bare "," (#90).
      const s = scr()
      const w = s.curWin
      /*
       * WSBor (+W.s:14012) checks each slot it was given and skips the ones
       * left empty. The number is `cmp.l #16,d1 / bcc WErr7`, unsigned so a
       * negative fails it too, and WErr7 is `moveq #16,d0` (+W.s:15839) which
       * through EcWiErr is error 60, "Illegal text window parameter". Then
       * `tst.w d1 / beq.s Wsb1`: zero passes the range check and is NOT
       * stored, so `Border 0` leaves the frame alone where the port cleared
       * it.
       *
       * Both colour slots get `cmp.w EcNbCol(a4),d2 / bcc WErr7`, the same
       * error against the screen's colour count. The port took any number and
       * masked the first one to 31.
       */
      const wErr = (): never => {
        throw new AmosError('illegal text window parameter', 60)
      }
      if (it.nm() !== ',') {
        const n = it.evalInt()
        if (n < 0 || n >= 16) wErr()
        if (n !== 0) w.border = n
      }
      if (it.accept(',')) {
        if (it.nm() !== ',' && !it.atStmtEnd()) {
          const c = it.evalInt()
          if (c < 0 || c >= s.nColors) wErr()
          w.borPap = c
        }
        if (it.accept(',') && !it.atStmtEnd()) {
          const c = it.evalInt()
          if (c < 0 || c >= s.nColors) wErr()
          w.borPen = c
        }
      }
      s.drawWindowFrame2()
    },
    /*
     * InTitleTop and InTitleBottom (+Lib.s:13181) copy the string through
     * `Rbsr L_ChVerBuf` before WnTT sees it, and ChVerBuf2 (+Lib.s:3654) is
     * `cmp.w #510,d0 / bcs.s Chv1 / move.w #509,d0` into the 512-byte
     * Buffer: 510 characters and a terminator, whatever it was handed.
     */
    'title top'(it) {
      const s = scr()
      s.curWin.titleTop = it.evalStr().slice(0, 510)
      s.drawWindowFrame2()
    },
    'title bottom'(it) {
      const s = scr()
      s.curWin.titleBottom = it.evalStr().slice(0, 510)
      s.drawWindowFrame2()
    },

    freeze() {
      // InFreeze +Lib.s:11597 -> FrzAMAL: park the whole channel chain
      rt.freezeAll()
    },
    unfreeze() {
      rt.unfreezeAll()
    },
    'set tempras'(it) {
      // InSetTempras0/1/2 (+Lib.s:9968): [size | addr,size] with size
      // 256..65535; the chunky renderer needs no raster buffer, so the
      // validated values are stored and unused
      if (it.atStmtEnd()) {
        rt.tempRas = null
        return
      }
      const a = it.evalInt()
      if (it.accept(',')) {
        const size = it.evalInt()
        if (size < 256 || size >= 65536) funcCall()
        rt.tempRas = { addr: a, size }
        return
      }
      if (a < 256 || a >= 65536) funcCall()
      rt.tempRas = { addr: 0, size: a }
    },
    'set stack'(it) {
      // InSetStack -> InSetBuffer, which is rts (+Lib.s:1683)
      it.evalInt()
    },
    'set equate bank'(it) {
      // InSetEquateBank -> InSetBuffer, rts (+Lib.s:1689)
      it.evalInt()
    },

    // ---- pointer visibility (MHide/MShow +W.s:10693, both no-ops under
    // Copper Off): a counter, visible while >= 0; Hide/Show step it,
    // the On forms force -1 / 0 ----
    hide: () => {
      if (rt.copperOn) rt.mouseShow--
    },
    'hide on': () => {
      if (rt.copperOn) rt.mouseShow = -1
    },
    show: () => {
      if (rt.copperOn) rt.mouseShow++
    },
    'show on': () => {
      if (rt.copperOn) rt.mouseShow = 0
    },
    'def scroll'(it) {
      const n = it.evalInt()
      it.expect(',')
      const [x1, y1] = pair(it)
      it.expect('to')
      const [x2, y2] = pair(it)
      it.expect(',')
      const dx = it.evalInt()
      it.expect(',')
      const dy = it.evalInt()
      // InDefScroll (+Lib.s:10179) checks the number after reading all seven:
      // `tst.l d7 / Rbeq L_FonCall / cmp.l #NDScrolls,d7 / Rbhi L_FonCall`,
      // and `NDScrolls equ 10` (+Equ.s:1430), so the zones are 1 to 10
      if (n <= 0 || n > 10) funcCall()
      rt.scrollZones.set(n, { x1, y1, x2, y2, dx, dy })
    },
    scroll(it) {
      const n = it.evalInt()
      // InScroll (+Lib.s:10194) writes the same range the other way round,
      // `subq.l #1,d3 / cmp.l #NDScrolls,d3 / Rbcc L_FonCall`, unsigned so it
      // catches 0 and negatives on the wrap
      if (n <= 0 || n > 10) funcCall()
      const z = rt.scrollZones.get(n)
      // an untouched slot reads $8000: `cmp.w #$8000,(a1) / beq ScNoDef`, and
      // ScNoDef is `moveq #28,d0 / Rbra L_EcWiErr` (+Lib.s:10225), which after
      // EcWiErr's +44 is error 72, "Scrolling zone not defined". 28 on its own
      // is "Array already dimensioned", which is how you know the +44 is there
      if (!z) throw new AmosError('Scrolling zone not defined', 72)
      const s = scr()
      Screen.copy(s, z.x1, z.y1, z.x2, z.y2, s, z.x1 + z.dx, z.y1 + z.dy)
    },

    zoom(it) {
      // Zoom src,x1,y1,x2,y2 To dst,x1,y1,x2,y2 — scaled blit
      const src = rt.resolveScreenId(it.evalInt())
      it.expect(',')
      const [sx1, sy1] = pair(it)
      it.expect(',')
      const [sx2, sy2] = pair(it)
      it.expect('to')
      const dst = rt.resolveScreenId(it.evalInt(), true)
      it.expect(',')
      const [dx1, dy1] = pair(it)
      it.expect(',')
      const [dx2, dy2] = pair(it)
      const sw = sx2 - sx1
      const sh = sy2 - sy1
      const dw = dx2 - dx1
      const dh = dy2 - dy1
      // InZoom (+Lib.s:10531) measures the whole rectangle before it draws a
      // pixel, and every failure lands on ZooF, which frees its table and
      // falls into L_FonCall. The low/high pair test is `cmp.l d5,d4 / bcc`,
      // UNSIGNED, so a negative low coordinate is caught there and needs no
      // branch of its own; the screen-size test is `cmp.w`, which sees only
      // the low word of a coordinate that already passed `bmi`.
      const bad = (lo: number, hi: number, limit: number): boolean =>
        hi < 0 || (hi & 0xffff) > limit || lo >>> 0 >= hi >>> 0
      if (bad(dx1, dx2, dst.s.width) || bad(sx1, sx2, src.s.width)) funcCall()
      if (bad(dy1, dy2, dst.s.height) || bad(sy1, sy2, src.s.height)) funcCall()
      for (let y = 0; y < dh; y++) {
        const ty = dy1 + y
        if (ty < 0 || ty >= dst.s.height) continue
        const sy = sy1 + Math.floor((y * sh) / dh)
        if (sy < 0 || sy >= src.s.height) continue
        for (let x = 0; x < dw; x++) {
          const tx = dx1 + x
          if (tx < 0 || tx >= dst.s.width) continue
          const sx = sx1 + Math.floor((x * sw) / dw)
          if (sx < 0 || sx >= src.s.width) continue
          dst.buf[ty * dst.s.width + tx] = src.buf[sy * src.s.width + sx]!
        }
      }
    },
    appear(it) {
      /*
       * Appear src To dst,e[,p] (InAppear4 +Lib.s:10443): p iterations
       * (default = every pixel) stepping (e mod p) through the source
       * pixel index space, copying only the planes both screens share and
       * preserving the destination's higher planes. gcd(e, total) > 1
       * leaves pixels uncopied — the classic venetian/checker dissolves.
       *
       * The two guards are not the same test. `move.l d3,d6 / Rbmi
       * L_FonCall` (+Lib.s:10446) is a real sign test on p, but the one on
       * e is `move.l (a3)+,d7 / Rbls L_FonCall` (+Lib.s:10448), and a `move`
       * CLEARS the carry, so that bls can only branch on Z: e = 0 is the
       * error and a negative e goes through. LApp0's `cmp.l d6,d7 / bcs` is
       * an UNSIGNED compare, so what AMOS then subtracts is the 32-bit
       * unsigned reading — `Appear 0 To 1,-1` steps by $FFFFFFFF mod count.
       * The port refused it outright, and would have walked backwards off
       * the buffer if it had not.
       */
      const src = rt.resolveScreenId(it.evalInt())
      it.expect('to')
      const dst = rt.resolveScreenId(it.evalInt(), true)
      it.expect(',')
      const e = it.evalInt()
      const p = it.accept(',') ? it.evalInt() : 0
      if (e === 0 || p < 0) funcCall()
      const s = src.s
      const d = dst.s
      const total = s.rowBytes * 8 * s.height
      const count = p === 0 ? total : p
      // LApp0 subtracts d6 in a loop; `%` is the same answer without the
      // four billion iterations a negative e would otherwise cost here
      const step = (e >>> 0) % count
      const mask = (1 << Math.min(s.depth, d.depth)) - 1
      let idx = 0
      for (let i = 0; i < count; i++) {
        idx += step
        if (idx >= total) idx -= total
        const byte = idx >> 3
        const row = Math.floor(byte / s.rowBytes)
        if (row >= d.height) continue
        const byteInRow = byte % s.rowBytes
        if (byteInRow >= d.rowBytes) continue
        const x = byteInRow * 8 + (idx & 7)
        if (x >= s.width || x >= d.width) continue
        const v = src.buf[row * s.width + x]! & mask
        const di = row * d.width + x
        dst.buf[di] = (dst.buf[di]! & ~mask) | v
      }
    },

    // ---- bobs ----
    bob(it) {
      const n = it.evalInt()
      const cur = rt.bobs.get(n)
      it.expect(',')
      const x = optInt(it, cur?.x ?? 0)
      it.accept(',')
      const y = optInt(it, cur?.y ?? 0)
      it.accept(',')
      // An omitted image leaves BbI alone (`cmp.l d7,d4 / beq.s CreBb8` at
      // BobSet's CreBb7, +W.s:945), and a bob ResBOB has just made has BbI = 0: it
      // sets BbNb, BbEc, the limits, BbAPlan, BbACon, BbDecor and BbEff, and
      // never touches the image. Image 0 is not image 1 --- there is no image
      // 0, so the bob does not draw at all.
      //
      // Defaulting to 1 put a copy of image 1 on screen for every bob a
      // program stepped without ever having given it one. AMOSPro_Examples
      // Help_70 runs `For N=1 To 21` while only creating bobs 8 to 21, so bobs
      // 1-7 sat at 0,0 and stamped a "T" --- the first letter of
      // THEOUTERLIMITS --- into the corner of the starfield.
      const image = optInt(it, cur?.image ?? 0)
      rt.bobs.set(n, { n, x, y, image, screen: cur?.screen ?? rt.currentIndex })
    },
    'bob off'(it) {
      // Neither BobSOff (+W.s:1015) nor BobOff erases anything or frees
      // anything. Both write -1 into BbAct and set BitBobs, and the update
      // passes that follow do the work --- which is what gets the background
      // back into BOTH buffers of a double buffered screen. Dropping the bob
      // here instead left it painted in the buffer that was not on the pen,
      // where it flickered on every swap for the rest of the program.
      if (it.atStmtEnd()) for (const b of rt.bobs.values()) rt.stopBob(b)
      else {
        const b = rt.bobs.get(it.evalInt())
        if (b) rt.stopBob(b)
      }
    },
    'bob update'(it) {
      // InBobUpdate (+Lib.s:11459) is EffBob / ActBob / AffBob / EcCall
      // SwapScS, the same four calls InUpdate makes before it goes on to the
      // hardware sprites. The swap was missing here, so a double buffered
      // program driving its bobs with Bob Update alone drew every frame into
      // the buffer nobody was looking at.
      void it
      rt.updateBobs()
      rt.swapDoubleBuffered()
    },
    // ---- Update family (InUpdate* +Lib.s:11423-11498): both pipelines ----
    'update on'() {
      rt.bobUpdateOn = true
      rt.spriteUpdateOn = true
    },
    'update off'() {
      // InUpdateOff (+Lib.s:11417) clears ActuMask bits 5 and 6, which is
      // what Bob Update Off and Sprite Update Off clear one at a time.
      // Clearing bit 6 stops the sprites being UPDATED and does not remove
      // them, so the frozen copy has to be taken here as well. Without it
      // the display fell back to `frozenSprites ?? []` and every hardware
      // sprite vanished on Update Off.
      rt.bobUpdateOn = false
      if (rt.spriteUpdateOn) rt.frozenSprites = [...rt.hwSprites.values()].map((hs) => ({ ...hs }))
      rt.spriteUpdateOn = false
    },
    update() {
      /*
       * InUpdate (+Lib.s:11435) is six calls: `SyCall EffBob / ActBob /
       * AffBob / EcCall SwapScS` and then, after the a5 restore, `SyCall
       * ActHs / SyCall AffHs`.
       *
       * Those last two ARE InSpriteUpdate (+Lib.s:11479), which is nothing
       * else, so Update does the sprite half as well as the bob half. The
       * port stopped after the swap, so under Sprite Update Off a sprite
       * moved and then Updated stayed at its frozen position -- and one
       * created after the freeze was not drawn at all, because the display
       * reads `frozenSprites ?? []`.
       */
      rt.updateBobs()
      rt.swapDoubleBuffered()
      if (!rt.spriteUpdateOn) rt.frozenSprites = [...rt.hwSprites.values()].map((s) => ({ ...s }))
    },
    'update every'(it) {
      // InUpdateEvery (+Lib.s:11490) is `cmp.l #65536,d3 / Rbcc L_FonCall`
      // before `move.w d3,VBLDelai(a5)`. Rbcc is unsigned, so a negative
      // count fails the same test a count above 65535 does. The port checked
      // only the high end and let Update Every -1 through.
      const n = it.evalInt()
      if (n >>> 0 >= 65536) funcCall()
      rt.updateEvery = Math.max(1, n)
    },
    'bob update on'() {
      rt.bobUpdateOn = true
    },
    'bob update off'() {
      rt.bobUpdateOn = false
    },
    'bob clear'() {
      rt.clearBobs()
    },
    'bob draw'() {
      // InBobDraw +Lib.s:11505 is ActBob + AffBob. The erase is Bob Clear's.
      rt.drawBobs()
    },
    'set bob'(it) {
      // Set Bob n,back,planes,mask (InSetBob +Lib.s:12196 -> ResBOB +W.s:959).
      // back  -> BbEff: 0 save/restore, <0 BLANK the rectangle on erase (a
      //          negative value clears BbDecor, the count of background
      //          buffers, so there is nothing to put back), >0 restore with
      //          solid colour back-1. See ./display.ts for why the negative
      //          case blanks rather than leaving the bob where it was.
      // planes-> BbAPlan, the bitplane write mask; omitted is -1, all planes
      // mask  -> BbACon, the blitter control word. Its SIGN chooses what it
      //          means (BbS1a +W.s:1396): 0 the default cookie-cut, negative
      //          a minterm with the channel bits forced on, positive the
      //          whole BLTCON0 verbatim. bobBltcon0 does the resolving.
      const n = it.evalInt()
      it.expect(',')
      const back = optInt(it, 0)
      rt.bobModes.set(n, back)
      if (it.accept(',')) {
        rt.bobPlanes.set(n, optInt(it, -1))
        if (it.accept(',')) rt.bobMinterms.set(n, optInt(it, 0))
      }
    },
    'limit bob'(it) {
      // Limit Bob [n,]x1,y1 To x2,y2 | Limit Bob (clear all)
      if (it.atStmtEnd()) {
        rt.bobLimits.clear()
        return
      }
      const a = it.evalInt()
      it.expect(',')
      const b = it.evalInt()
      if (it.nm() === 'to') {
        it.advance()
        const [x2, y2] = pair(it)
        setBobLimit(-1, a, b, x2, y2)
        return
      }
      it.expect(',')
      const y1 = it.evalInt()
      it.expect('to')
      const [x2, y2] = pair(it)
      setBobLimit(a, b, y1, x2, y2)
    },
    'x mouse'(it) {
      // X Mouse = n (InXMouse +Lib.s:12079) -> MSetAb (+W.s:10921) with
      // EntNul for Y, so only X moves.
      it.expectOp('=')
      it.inp.mouseX = setMouseAxis(it.evalInt(), mouseBounds(rt).x1, mouseBounds(rt).x2)
    },
    'y mouse'(it) {
      // Y Mouse = n (InYMouse +Lib.s:12093) -> MSetAb with EntNul for X.
      it.expectOp('=')
      it.inp.mouseY = setMouseAxis(it.evalInt(), mouseBounds(rt).y1, mouseBounds(rt).y2)
    },
    'command line$'(it) {
      // Command Line$ = a$ (InCommandLine +Lib.s:7838): stashed under a
      // "CmdL" cookie just below TBuffer, so it survives Run chaining. 256
      // or longer is a function call error (cmp.w #256,d2 / Rbcc).
      it.expectOp('=')
      const s = str(it.evalExpr())
      if (s.length >= 256) funcCall()
      rt.commandLine = s
    },
    'limit mouse'(it) {
      // InLimitMouse (+Lib.s:12330): no args = the current screen's display
      // area; `Limit Mouse n` = screen n's; `Limit Mouse x1,y1 To x2,y2` =
      // a hardware-coordinate rectangle. Clamped every vbl (LimitMEc).
      const screenRect = (s: Screen): { x1: number; y1: number; x2: number; y2: number } => {
        const winW = s.displayW >= 0 ? Math.min(s.displayW, s.width) : s.width
        const winH = s.displayH >= 0 ? Math.min(s.displayH, s.height) : s.height
        const hwW = winW >> (s.hires ? 1 : 0)
        const hwH = s.laced ? Math.ceil(winH / 2) : winH
        return { x1: s.displayX, y1: s.displayY, x2: s.displayX + hwW - 1, y2: s.displayY + hwH - 1 }
      }
      if (it.atStmtEnd()) {
        rt.mouseLimit = screenRect(rt.screen)
        return
      }
      const a = it.evalInt()
      if (!it.accept(',')) {
        const s = rt.screens.get(a)
        if (!s) throw new AmosError(`screen not opened: ${a}`, 47)
        rt.mouseLimit = screenRect(s)
        return
      }
      /*
       * Every one of the four may be left out. The token spec is
       * `"I0,0t0,0"` (+Lib.s:1191), the same shape as `screen display`'s
       * `"I0,0,0,0,0"` (:481), and an empty integer slot compiles to EntNul.
       * `MLimA` (+W.s:10977) reads its arguments as WORDS, and the low word
       * of $80000000 is zero, so an omitted coordinate arrives as 0.
       *
       * Arcadia's `Limit Mouse 166,To 328,` pins the pointer to a horizontal
       * strip that way, and the port would not parse the line at all.
       */
      const omitted = (): boolean => it.atStmtEnd() || it.nm() === ',' || it.nm() === 'to'
      const arg = (): number => (omitted() ? 0 : it.evalInt())
      const y1 = arg()
      it.expect('to')
      const x2 = arg()
      it.expect(',')
      const y2 = arg()
      /*
       * MLimA in full. The ceilings are `cmp.w #458,d3` and `cmp.w #312,d4`
       * and both branches are `bls`, so they are unsigned and a negative
       * maximum comes down to the ceiling. A negative MINIMUM is cleared
       * instead (`tst.w d1 / bpl / clr.w d1`, signed), and a min above its
       * max is exchanged with it.
       */
      const word = (v: number): number => v & 0xffff
      const signed = (v: number): number => (v << 16) >> 16
      let lx = word(a)
      let ly = word(y1)
      let hx = word(x2)
      let hy = word(y2)
      if (hx > 458) hx = 458
      if (hy > 312) hy = 312
      if (signed(lx) < 0) lx = 0
      if (signed(ly) < 0) ly = 0
      if (lx > hx) [lx, hx] = [hx, lx]
      if (ly > hy) [ly, hy] = [hy, ly]
      rt.mouseLimit = { x1: lx, y1: ly, x2: hx, y2: hy }
    },
    'paste bob'(it) {
      // InPasteBob +Lib.s:12724 -> Patch: bset #31,d3 sets the "PAS POINT
      // CHAUD" flag, so BobCalc (+W.s:1358) skips the hot-spot subtraction
      // — Paste Bob draws at the raw top-left x,y, unlike Bob/Sprite
      const [x, y] = pair(it)
      it.expect(',')
      // TPatch (+W.s:819) starts with `bsr Retourne`, so the Hrev/Vrev bits
      // on the number mirror the bank image in place before the paste
      const img = pasteImage(it.evalInt(), 'sprite')
      rt.blit(scr(), img, x, y, img.opaque)
    },
    'paste icon'(it) {
      // InPasteIcon +Lib.s:12734 pastes THROUGH an existing mask and only
      // pokes the $C0000000 non-mask when the field is empty, so an icon is
      // solid until Make Icon Mask has been over the bank
      const [x, y] = pair(it)
      it.expect(',')
      const img = pasteImage(it.evalInt(), 'icon')
      rt.blit(scr(), img, x, y, img.opaque)
    },
    'get bob': getObj('sprite'),
    'get sprite': getObj('sprite'),
    'get icon': getObj('icon'),
    'put bob'(it) {
      // InPutBob (+Lib.s:12694) is `SyCall PutBob`, and `BobPut` (+W.s:1178)
      // sets the bob's erase counter to its buffer count. It stamps nothing:
      // the bob is left behind by SKIPPING its next erase, once per buffer.
      // See Runtime.bobPut. Blitting a copy here instead put one in the
      // logical buffer only, so it flickered on a double-buffered screen and
      // the bob went on erasing itself normally.
      //
      // Both guards are on the instruction: `move.l d3,d1 / Rbmi L_FonCall`
      // for a negative number, and `SyCall PutBob / Rbne L_FonCall` for a bob
      // that is not on screen. The port returned quietly for both.
      const n = it.evalInt()
      if (n < 0) funcCall()
      const bob = rt.bobs.get(n)
      if (!bob) funcCall()
      const s = rt.screens.get(bob.screen) ?? scr()
      rt.bobPut.set(n, s.doubleBuffered ? 2 : 1)
    },
    'put key'(it) {
      // InPutKey +Lib.s:13695 hands the string to ClPutK (+W.s:13072), which
      // fills the buffer three bytes at a time: shift, scancode, ascii. A
      // plain character clears the first two and stores itself as the ascii,
      // chr$(1) says the next THREE bytes are those fields already (this is
      // what Scan$ builds), and an apostrophe opens a comment that runs to
      // the next apostrophe and stores nothing.
      const s2 = it.evalStr()
      // `cmp.w #64,d2 / Rbcc L_StooLong` (+Lib.s:13695) -- error 21, not the
      // catch-all a numberless throw reports as
      if (s2.length >= 64) throw new AmosError(ED_RUN_MESSAGES[21]!, 21)
      for (let i = 0; i < s2.length; i++) {
        const c = s2.charCodeAt(i)
        if (c === 39) {
          // ClPk5: an unterminated comment swallows the rest of the string
          const end = s2.indexOf("'", i + 1)
          if (end < 0) break
          i = end
        } else if (c === 1) {
          const asc = s2.charCodeAt(i + 3) || 0
          rt.pressKey(asc === 0 ? '' : String.fromCharCode(asc), s2.charCodeAt(i + 2) || 0, s2.charCodeAt(i + 1) || 0)
          i += 3
        } else {
          rt.pressKey(s2[i]!, 0, 0)
        }
      }
    },
    'del bob': delObj('sprite'),
    'del sprite': delObj('sprite'),
    'del icon': delObj('icon'),
    'ins bob': insObj('sprite'),
    'ins sprite': insObj('sprite'),
    'ins icon': insObj('icon'),
    'make icon mask': maskAll('icon', false),
    'no icon mask': maskAll('icon', true),
    'get sprite palette': bankPalette(),
    'get bob palette': bankPalette(),
    'get icon palette'(it) {
      // the icon pair of the same `Rbsr L_Bnk.GetIcons / Rbeq L_BkNoRes`
      const mask = it.atStmtEnd() ? -1 : it.evalInt()
      const bank = rt.iconBank
      if (!bank) throw new AmosError('Bank not reserved', 36)
      const pal = bank.palette
      if (pal) {
        for (let i = 0; i < Math.min(32, pal.length); i++) {
          if (mask & (1 << i)) scr().palette[i] = pal[i]!
        }
      }
    },
    'hot spot'(it) {
      const img = rt.spriteBank?.image(it.evalInt())
      if (it.accept(',')) {
        const a = it.evalInt()
        if (it.accept(',')) {
          const b = it.evalInt()
          if (img) {
            img.hotX = a
            img.hotY = b
          }
        } else if (img) {
          /*
           * Predefined code $XY. InHotSpot2 (+Lib.s:12552) does `and.w
           * #%01110111,d1 / addq.w #1,d1`, and SpotH (+W.s:580) undoes the
           * +1 straight away — it is there only so that 0 can go on meaning
           * "explicit coordinates follow" at `tst.w d1 / beq.s Spo4`.
           *
           * Each axis then takes two bits and subtracts one: `bhi` keeps the
           * far edge, `beq` halves it, and anything below zeroes it first.
           * bhi is >=, so a nibble of 3 is the far edge as surely as 2 is —
           * the port had 3 falling through to the near edge.
           *
           * The width is `move.w (a1),d2 / lsl.w #4,d2`: word 0 of a bob
           * image is its WORD count, so the right edge is the grab rounded
           * up to 16, not the width that was asked for.
           */
          const cx = (a >> 4) & 3
          const cy = a & 3
          const w16 = ((img.width + 15) >> 4) << 4
          img.hotX = cx >= 2 ? w16 : cx === 1 ? w16 >> 1 : 0
          img.hotY = cy >= 2 ? img.height : cy === 1 ? img.height >> 1 : 0
        }
      }
    },
    'make mask': maskAll('sprite', false),
    'no mask': maskAll('sprite', true),
    // All four reach Prooo (+Lib.s:11578), which is `tst.w ScOn(a5) / Rbeq
    // L_ScNOp / SyCall SPrio`, so each one needs a screen open before it
    // changes anything. SPrio is TPrio (+W.s:1086), taking d1 (priority) and
    // d2 (reverse) and treating a NEGATIVE value as "leave this one alone":
    // `tst.l d1 / bmi.s TPri2` and `tst.l d2 / bmi.s TPri3`. Priority On
    // passes d1=1,d2=-1 and Priority Reverse On passes d1=-1,d2=1, so the two
    // settings are independent. The port had Priority Reverse On switching
    // priority on as well.
    // DEVIATION: TPri1 stores `T_EcCourant(a5)`, not a flag, so on the 68000
    // priority applies to the screen it was turned on for. This port keeps
    // one boolean shared by every screen.
    'priority on'() {
      void rt.screen
      rt.priorityOn = true
    },
    'priority off'() {
      void rt.screen
      rt.priorityOn = false
    },
    'priority reverse on'() {
      void rt.screen
      rt.priorityReverse = true
    },
    'priority reverse off'() {
      void rt.screen
      rt.priorityReverse = false
    },

    // ---- hardware sprites ----
    sprite(it) {
      // InSprite +Lib.s:12286 → HsNxya: n in 0..63; omitted args keep the
      // previous value (each compared to EntNul)
      const n = it.evalInt()
      if (n < 0 || n >= 64) throw new AmosError('illegal sprite number')
      const cur = rt.hwSprites.get(n)
      it.expect(',')
      const x = optInt(it, cur?.x ?? 0)
      it.accept(',')
      const y = optInt(it, cur?.y ?? 0)
      it.accept(',')
      const image = optInt(it, cur?.image ?? 1)
      rt.hwSprites.set(n, { n, x, y, image })
    },
    'sprite off'(it) {
      /*
       * InSpriteOff0/1 (+Lib.s:12300) reach HsOff and HsXOff (+W.s:11412),
       * and both call `bsr DAdAMAL` before they finish. DAdAMAL (+W.s:8160)
       * walks the whole AMAL list and DAMALs every channel whose AmAct
       * matches the object address, so switching a sprite off takes its
       * animation with it: the AMAL program, the Anim and both Moves. The
       * port had been removing the sprite and leaving its channels running
       * against an object that was no longer there.
       */
      if (it.atStmtEnd()) {
        killObjectAnim('sprite', null)
        rt.hwSprites.clear()
        return
      }
      const n = it.evalInt()
      rt.hwSprites.delete(n)
      killObjectAnim('sprite', n)
    },
    'sprite update'(it) {
      // InSpriteUpdate +Lib.s:11479: apply buffered changes now (ActHs+AffHs)
      it.skipToStmtEnd()
      if (!rt.spriteUpdateOn) rt.frozenSprites = [...rt.hwSprites.values()].map((s) => ({ ...s }))
    },
    'sprite priority'(it) {
      // InSpritePriority -> HsPri (+W.s:11345). Sprite PAIRS below the value
      // show in front of the playfield; 4 (the EcCore default) puts every
      // pair in front, 0 puts them all behind.
      //
      // Two details the old single global missed:
      //  - the value is stored in the CURRENT SCREEN's EcCon2, not machine
      //    state, so screens can differ
      //  - on the second playfield of a dual pair the poke is redirected to
      //    the FIRST screen's PF2P field instead of its own PF1P
      //
      // The range check belongs to the keyword, not to HsPri: InSpritePriority
      // (+Lib.s) does cmp.l #4,d1 / Rbhi L_FonCall before calling PriHs, so
      // anything above 4 (unsigned, so negatives too) is a function call
      // error. HsPri's own cmp.w #5 / moveq #0 clamp only guards its other
      // callers and is never reached from BASIC.
      const p = it.evalInt()
      if (p >>> 0 > 4) funcCall()
      const cur = scr()
      if (cur.dualIsBack && cur.dualPartner !== null && rt.screens.has(cur.dualPartner)) {
        rt.screens.get(cur.dualPartner)!.pf2p = p
      } else {
        cur.pf1p = p
      }
    },
    'set sprite buffer'(it) {
      // InSetSpriteBuffer +Lib.s:12261: scanlines per multiplexer column,
      // must be >= 16 (cmp #16 / bcs error). HsSBuf reserves n+2 lines
      // (+W.s:11268), leaving n words of room per column — the budget that
      // decides how many computed sprites share a channel.
      const n = it.evalInt()
      if (n < 16) funcCall()
      rt.spriteBufferLines = n + 2
    },

    // ---- zones ----
    //
    // The table belongs to the CURRENT SCREEN (EcAZones/EcNZones), and all
    // three of these go through T_EcCourant to reach it. See Screen.zones.
    'reserve zone'(it) {
      // InReserveZone0/1 (+Lib.s:10895): the count is checked for sign
      // (`move.l d3,d1 / Rbmi L_FonCall`) and a screen must be open
      // (`tst.w ScOn(a5) / Rbeq L_ScNOp`) BEFORE SyResZ allocates n*8 bytes.
      // The no-argument form is `moveq #0,d3`, which reserves nothing at all
      // rather than the sixteen this port used to assume — SyRz1's `move.w
      // d1,d0 / beq.s ZoOk` frees the old table and returns with EcAZones
      // null, so `Reserve Zone` bare is how a program DISCARDS its zones.
      const n = it.atStmtEnd() ? 0 : it.evalInt()
      if (n < 0) funcCall()
      // `SyCall ResZone / Rbne L_OOfMem` — SyResZ frees the old table first
      // and then asks FastMm for n*8 bytes, so a count the fast pool cannot
      // hold is error 24 AND leaves the screen with no zones at all
      const s = rt.screen
      s.reserveZones(0)
      if (n * 8 > rt.fastFree()) throw new AmosError('Out of memory', ERR.OUT_OF_MEMORY)
      s.reserveZones(n)
    },
    'set zone'(it) {
      const n = it.evalInt()
      it.expect(',')
      const [x1, y1] = pair(it)
      it.expect('to')
      const [x2, y2] = pair(it)
      // InSetZone (+Lib.s:10932) tests the zone number the moment it pops it,
      // `move.l (a3)+,d1 / Rbls L_FonCall`, and a `move` clears the carry so
      // that bls is a beq. Zone 0 is error 23 BEFORE `tst.w ScOn(a5)`, so
      // with no screen open it is still 23 and not 47.
      if (n === 0) funcCall()
      const s = rt.screen
      // SySetZ (+W.s:11090) is four refusals and four word stores, and all
      // four refusals reach InSetZone's `Rbne L_FonCall` as AMOS 23:
      //   EcAZones == 0        no zones reserved on this screen
      //   n == 0 or n > count  `tst.w d1 / beq` and `cmp.w EcNZones(a1),d1 /
      //                        bhi` — so the table does NOT grow to fit,
      //                        which is what this port used to do silently
      //   x1 >= x2, y1 >= y2   `cmp.w d4,d2 / bcc` and `cmp.w d5,d3 / bcc`,
      //                        UNSIGNED word compares, so the far corner is
      //                        exclusive and a zero-width zone is refused
      if (s.zones.length === 0) funcCall()
      if (n <= 0 || n > s.zones.length) funcCall()
      if ((x1 & 0xffff) >= (x2 & 0xffff) || (y1 & 0xffff) >= (y2 & 0xffff)) {
        funcCall()
      }
      // `move.w` four times: the record is words, so the coordinates are
      // truncated to sixteen bits on the way in
      s.zones[n - 1] = { x1: x1 & 0xffff, y1: y1 & 0xffff, x2: x2 & 0xffff, y2: y2 & 0xffff }
    },
    'reset zone'(it) {
      // InResetZone0/1 (+Lib.s:10911) -> SyRazZ (+W.s:11065). A null table is
      // NoZo, which returns 29 and which this caller alone turns into error
      // 73 (`.Err moveq #73,d0 / Rbra L_GoError`) rather than into 23 — the
      // only place "No zones defined" is raised.
      const s = rt.screen
      if (s.zones.length === 0) throw new AmosError(ED_RUN_MESSAGES[73]!, 73)
      if (it.atStmtEnd()) {
        s.zones.fill(null)
        return
      }
      // `cmp.w EcNZones(a1),d1 / bhi PErr7` — out of range is a function call
      // error; zone 0 is `tst.w d1 / beq SyRzz`, which clears them ALL
      const n = it.evalInt()
      if (n === 0) {
        s.zones.fill(null)
        return
      }
      if (n < 0 || n > s.zones.length) funcCall()
      s.zones[n - 1] = null
    },

    // ---- packed pictures and IFF ----
    pack(it) {
      packOrSpack(it, false)
    },
    spack(it) {
      packOrSpack(it, true)
    },
    unpack(it) {
      // first argument: a bank number, or an ADDRESS inside a bank (many
      // programs keep several packed pictures in one bank with an offset
      // table)
      const src = it.evalInt()
      let bytes: Uint8Array
      const bank = rt.memBanks.get(src)
      if (bank) {
        bytes = bank.data
      } else {
        const m = rt.resolveAddr(src)
        if (!m) throw new AmosError('bank not reserved')
        bytes = m.data.subarray(m.off)
      }
      // NOTE: the unpacker itself does not raise — UnPack_Screen tests the
      // $06071963 magic and returns d0=0 (+Lib.s:25505 `.NoPac`), leaving the
      // decision to its caller in the Compact extension, whose source is not
      // in the archive (only +Compact_Labels.s). 23 is AMOS's catch-all and
      // is our choice; what matters here is that a plain Error escaped the
      // AMOS machinery entirely, so On Error Goto could not trap it.
      let pic
      try {
        pic = parsePacPic(bytes)
      } catch {
        funcCall()
      }
      if (it.accept('to')) {
        const n = it.evalInt()
        const sc = pic.screen
        if (!sc) throw new AmosError('bank has no screen header')
        const s = rt.openScreen(n, sc.width, sc.height, sc.nColors, sc.mode)
        for (let i = 0; i < 32; i++) s.palette[i] = sc.palette[i]!
        // Unpack_Screen prints Esc"C0" to the new screen — cursor off, and
        // no system flash either (+Lib.s:25520-25552)
        s.cursorOn = false
        rt.blit(s, pic, 0, 0, true)
        return
      }
      let x = pic.x
      let y = pic.y
      if (it.accept(',')) {
        x = optInt(it, x) & ~7
        if (it.accept(',')) y = optInt(it, y)
      }
      rt.blit(scr(), pic, x, y, true)
    },
    // ---- dialogs (Interface language) ----
    'dialog open'(it) {
      // InDialogOpen2/3/4 +Lib.s:14301: Dialog Open c,prog[,nvars[,buflen]];
      // prog is a string or a program number (<1024) in the resource bank
      const c = it.evalInt()
      if (c <= 0) funcCall()
      it.expect(',')
      const prog = it.evalExpr()
      let nVars = 16
      let bufLen = 1024
      if (it.accept(',')) {
        nVars = it.evalInt()
        if (nVars < 0) funcCall()
        if (it.accept(',')) {
          bufLen = it.evalInt()
          if (bufLen <= 256) funcCall()
        }
      }
      if (rt.dialogs.has(c)) throw new AmosError(DIALOG_ERRORS[5]!)
      const res = rt.resource()
      let script: string
      if (prog.k === 'str') {
        script = prog.s
      } else {
        const n = int(prog)
        const progs = res.programs
        if (!progs || n < 1 || n > progs.length) funcCall()
        script = progs[n - 1]!
      }
      const chan = new DialogChannel(c, nVars, res)
      chan.script = script
      chan.screenNb = rt.currentIndex
      try {
        const scan = prescanDialog(script)
        chan.labels = scan.labels
        chan.userInstrs = scan.userInstrs
      } catch (e) {
        if (e instanceof DialogError) {
          rt.dialogErrPos = e.position
          throw new AmosError(e.message)
        }
        throw e
      }
      rt.dialogErrPos = 0
      rt.dialogs.set(c, chan)
    },
    'dialog close'(it) {
      // InDialogClose0/1 +Lib.s:14370
      if (it.atStmtEnd()) {
        rt.dialogs.clear()
        return
      }
      const c = it.evalInt()
      if (c <= 0) funcCall()
      if (!rt.dialogs.delete(c)) throw new AmosError(DIALOG_ERRORS[6]!)
    },
    'dialog clr'(it) {
      // InDialogClr +Lib.s:14386 → Dia_EffChannel: erase the display,
      // keep the channel
      const c = it.evalInt()
      if (c <= 0) funcCall()
      const d = rt.dialogs.get(c)
      if (!d) throw new AmosError(DIALOG_ERRORS[6]!)
      eraseDialog(d, rt.dialogDraw)
    },
    'dialog update'(it) {
      // InDialogUpdate2..5 +Lib.s:14462 → Dia_ZUpdate: push a value into
      // zone z of channel n; elided values just redraw
      const c = it.evalInt()
      if (c <= 0) funcCall()
      it.expect(',')
      const z = it.evalInt()
      // the value stays a raw long in the 68k — a string reaches a string
      // edit zone as its pointer, so carry either type through
      let v: number | string | null = null
      let p4: number | null = null
      let p5: number | null = null
      if (it.accept(',')) {
        if (!it.atStmtEnd() && it.nm() !== ',') {
          const raw = it.evalExpr()
          v = raw.k === 'str' ? raw.s : int(raw)
        }
        if (it.accept(',')) {
          p4 = it.atStmtEnd() || it.nm() === ',' ? null : it.evalInt()
          if (it.accept(',')) p5 = it.evalInt()
        }
      }
      const d = rt.dialogs.get(c)
      if (!d) throw new AmosError(DIALOG_ERRORS[6]!)
      updateZone(d, z, v, p4, p5, rt.dialogHost, rt.dialogDraw)
    },
    'dialog freeze'(it) {
      // InDialogFreeze0/1 +Lib.s:14397
      if (it.atStmtEnd()) {
        for (const d of rt.dialogs.values()) d.frozen = true
        return
      }
      const c = it.evalInt()
      if (c <= 0) funcCall()
      const d = rt.dialogs.get(c)
      if (!d) throw new AmosError(DIALOG_ERRORS[6]!)
      d.frozen = true
    },
    'dialog unfreeze'(it) {
      if (it.atStmtEnd()) {
        for (const d of rt.dialogs.values()) d.frozen = false
        return
      }
      const c = it.evalInt()
      if (c <= 0) funcCall()
      const d = rt.dialogs.get(c)
      if (!d) throw new AmosError(DIALOG_ERRORS[6]!)
      d.frozen = false
    },
    vdialog(it) {
      // InVDialog +Lib.s:14521: Vdialog(c,n)=v
      vdialogWrite(it, rt, false)
    },
    'vdialog$'(it) {
      vdialogWrite(it, rt, true)
    },

    // ---- resource banks (Interface language) ----
    'resource bank'(it) {
      // InResourceBank +Lib.s:14904: negative bank = function call error
      const n = it.evalInt()
      if (n < 0) funcCall()
      rt.resourceBankNumber = n
    },
    'resource unpack'(it) {
      // InResourceUnpack +Lib.s:14969: image n of the puzzle bank onto the
      // current screen at x,y
      const n = it.evalInt()
      it.expect(',')
      const x = it.evalInt()
      it.expect(',')
      const y = it.evalInt()
      const g = rt.resource().graphics
      if (!g || n <= 0 || n > g.count) funcCall()
      const pic = g.image(n)
      if (!pic) funcCall()
      rt.blit(scr(), pic, x, y, true)
    },
    'resource screen open'(it) {
      // InResourceScreenOpen +Lib.s:14883 → Dia_RScOpen 20995: screen n
      // sized sx,sy with colours/mode/palette from the graphics section;
      // colour `flash` gets the system flash animation (config message 46),
      // flash 0 turns the cursor off instead
      const n = it.evalInt()
      it.expect(',')
      const sx = it.evalInt()
      it.expect(',')
      const sy = it.evalInt()
      it.expect(',')
      const flash = it.evalInt()
      checkScreenNumber(rt, n)
      const g = rt.resource().graphics
      if (!g) throw new AmosError('resource bank not present')
      const s = rt.openScreen(n, sx, sy, g.nColors, g.mode & 0x8004)
      for (let i = 0; i < 32; i++) s.palette[i] = g.palette[i]!
      if (flash === 0) {
        s.cursorOn = false
      } else {
        if (flash >= g.nColors) funcCall()
        // +Interpreter_Config.s:186, system message 46, on the new
        // (current) screen's chosen colour
        rt.flashStart(flash & 31, parseFlashSpec(DEFAULT_FLASH_SPEC)!)
      }
    },
    'read text'(it) {
      // InReadText1 +Lib.s:14707 (a file) / InReadText3 14744 (title,
      // address, length) → IRText 14755: both open the resource bank's
      // reader dialog and block until it closes, leaving the clicked
      // hypertext keyword in Param$
      const t = rt.readText
      if (t) {
        if (t.done) {
          it.paramStr = t.result
          rt.readText = null
          it.skipToStmtEnd()
          return
        }
        it.block({ type: 'readtext' }, true)
        return
      }
      const first = it.evalStr()
      let title: string
      let addr: number
      let length: number
      if (it.accept(',')) {
        // Read Text title$,address,length — the text is already in memory
        title = first
        addr = it.evalInt()
        it.expect(',')
        length = it.evalInt()
      } else {
        // Read Text file$ — loaded into TempBuffer, titled from default
        // resource message 20 (Def_GetMessage)
        const bytes = rt.fs?.read(first)
        if (!bytes) throw new AmosError(`file not found: ${first}`)
        // D_Read leaves the file in the buffer; the reader wants it
        // NUL-terminated (ResTempBuffer takes size+4, +Lib.s:14727)
        const buf = new Uint8Array(bytes.length + 4)
        buf.set(bytes)
        rt.tempBuffer = buf
        addr = Runtime.TEMP_BUFFER_BASE
        length = bytes.length
        title = rt.systemResource?.messages?.[19] ?? ''
      }
      if (!rt.startReadText(title, addr, length)) {
        // no system resource bank: nothing to read the text with
        it.paramStr = ''
        return
      }
      it.block({ type: 'readtext' }, true)
    },

    load(it) {
      // Load "file.abk"[,bank#] — install banks from an .Abk/.AMOS container
      const path = it.evalStr()
      const forced = it.accept(',') ? it.evalInt() : null
      // InLoad2 (+Lib.s:3996) is `cmp.l #$10000,d3 / Rbge L_FonCall` and only
      // the two-argument entry carries it; InLoad1 (+Lib.s:3988) pushes
      // EntNul and branches straight into Load0. The test is SIGNED, so it
      // stops 65536 and lets every negative number through to Bnk.Load
      if (forced !== null && forced >= 0x10000) funcCall()
      const bytes = rt.fs?.read(path)
      if (!bytes) throw new AmosError(`file not found: ${path}`, ERR.FILE_NOT_FOUND)
      const file = parseAmosFile(bytes)
      // an AmBs bank list erases ALL banks first (LB_Multiples: Bnk.EffAll,
      // +Lib.s Bnk.Load)
      if (file.bankList) {
        rt.memBanks.clear()
        rt.spriteBank = null
        rt.iconBank = null
      }
      /*
       * a forced number applies only to a single-bank load; a multi-bank
       * container restores each bank to its own stored number (Bnk.Load,
       * +Lib.s:4025) — forcing every bank would collide them
       *
       * A NEGATIVE number is not a bank number, it is the same request as
       * leaving the argument out. `move.l d5,d3 / bpl.s .Skip1 / moveq #0,d3
       * / move.w (a2),d3 / bne.s .Skip1 / moveq #5,d3` (+Lib.s:4058) reads
       * the number out of the bank header and falls back to 5, and EntNul
       * reaches it by being negative rather than by being EntNul. The port
       * took -1 at face value and installed the bank at -1, where nothing
       * that names a bank could reach it again.
       */
      const numbered = forced !== null && forced >= 0
      const single = file.banks.length === 1
      for (const bank of file.banks) {
        if (bank.kind === 'sprites' || bank.kind === 'icons') {
          /*
           * LB_Sprites/LB_Icons (+Lib.s:4095 and 4096) decide between append
           * and overwrite with `tst.w d5`, on the LOW WORD of the argument.
           *
           * The no-number form passes EntNul, and EntNul is $80000000
           * (+Equ.s:39), whose low word is zero. So `Load "bobs.abk"`
           * OVERWRITES and only `Load "bobs.abk",n` with n's low word set
           * appends. Treating the omitted argument as an append left Alien
           * Pong Trilogy 2 with the 18 menu images of `b1.dat` still at
           * 1..18 after `Load "disk2:g/b2.dat"` put the bats and the ball at
           * 19..30, so `Bob 1,5,Y1,1` drew "BAT SPEED : SLOW" for a bat.
           */
          const nb = ObjectBank.fromSpriteBank(bank)
          const slot = bank.kind === 'sprites' ? 'spriteBank' : ('iconBank' as const)
          const cur = rt[slot]
          if (cur && forced !== null && (forced & 0xffff) !== 0) {
            cur.images.push(...nb.images)
            cur.palette = nb.palette
          } else rt[slot] = nb
        } else if (bank.kind === 'memory') rt.memBanks.set(single && numbered ? forced : bank.number || 5, bank)
      }
    },
    // ---- audio ----
    'sam bank'(it) {
      // InSamBank +Music.s:3008: 1-16, else illegal function call
      const n = it.evalInt()
      if (n <= 0 || n > 16) funcCall()
      rt.samBankNum = n
    },
    'sam play'(it) {
      // Sam Play n | Sam Play voices,n | Sam Play voices,n,freq
      // (InSamPlay1-3 +Music.s:3102: an explicit frequency <=500 errors)
      const a = it.evalInt()
      let mask = 0b1111
      let n = a
      let freq: number | null = null
      if (it.accept(',')) {
        mask = a
        n = it.evalInt()
        if (it.accept(',')) freq = it.evalInt()
      }
      if (freq !== null && freq <= 500) funcCall()
      const sample = rt.getSample(n)
      rt.samPlay(mask & 15, sample.pcm, freq ?? sample.freq)
    },
    'sam stop'(it) {
      rt.stopVoices((it.atStmtEnd() ? 0b1111 : it.evalInt()) & 15)
    },
    'sam swap'(it) {
      // InSamSwap +Music.s:4054: Sam Swap voices To address,length —
      // queues the next buffer, picked up when the playing one ends
      const mask = it.evalInt()
      it.expect('to')
      const addr = it.evalInt()
      it.expect(',')
      const len = it.evalInt()
      if (len < 0) funcCall()
      const m = rt.bankOrAddr(addr)
      if (!m) return
      const pcm = new Int8Array(m.data.buffer, m.data.byteOffset + m.off, Math.min(len, m.data.length - m.off))
      rt.music.samSwap(mask & 15, pcm)
    },
    /*
     * Sload / Ssave are the Music extension's, and they answer for AMCAF's
     * too. AMCAF 1.50 ships its own pair -- routines 106 ($38e8) and 107
     * ($3922) -- and its changelog says why they exist rather than what they
     * do: "V1.43 - Added Sload/Ssave. Just the same commands like in the
     * music extension. Now you can really remove it!" One handler for both is
     * the author's intent, so AMCAF deliberately registers neither; see
     * ALLOWED_UNDECLARED in ../runtime/contested.test.ts.
     *
     * The two are not byte-identical, and the differences are AMCAF's:
     *
     *   - the channel is 1..9 there and 1..10 here. `cmp.l #$a,d0 / Rbcc` on
     *     routine 106 rejects ten, where Music's takes it.
     *   - AMCAF checks no MODE. It takes the handle out of the table at
     *     $8bc(a5) and calls Read or Write on whatever it finds, so its
     *     Sload on an output channel reaches dos.library; Music's refuses.
     *   - AMCAF does not reject a zero length. Ssave's `sub.l d0,d3` just
     *     yields nought and writes nothing, where `end - start <= 0` here is
     *     error 23.
     *
     * NOTE: this handler keeps Music's contract, because Music is the one
     * with source (+Music.s) and AMCAF's is the clone of it. A program
     * written against AMCAF that uses channel 10, an unopened mode or a zero
     * length therefore meets Music's answer, not AMCAF's.
     */
    sload(it) {
      // InSload +Music.s:3239: Sload f To address,length — reads raw
      // bytes from an open sequential channel into memory
      const ch = it.evalInt()
      it.expect('to')
      const addr = it.evalInt()
      it.expect(',')
      const len = it.evalInt()
      if (len < 0 || ch < 1 || ch > 10) funcCall()
      const c = rt.fileChans.get(ch)
      if (!c || c.mode !== 'in') funcCall()
      const m = rt.resolveWrite(addr)
      if (!m) return
      const n = Math.min(len, c.data.length - c.pos, m.data.length - m.off)
      for (let i = 0; i < n; i++) m.data[m.off + i] = c.data[c.pos + i]!
      c.pos += n
    },
    ssave(it) {
      // InSsave +Music.s:4426: Ssave f,start To end — end must be past
      // start; writes the raw bytes to an open output channel
      const ch = it.evalInt()
      it.expect(',')
      const start = it.evalInt()
      it.expect('to')
      const end = it.evalInt()
      if (end - start <= 0 || ch < 1 || ch > 10) funcCall()
      const c = rt.fileChans.get(ch)
      if (!c || c.mode !== 'out') funcCall()
      const m = rt.resolveAddr(start)
      if (!m) return
      const n = Math.min(end - start, m.data.length - m.off)
      for (let i = 0; i < n; i++) c.out.push(m.data[m.off + i]!)
    },
    'sam loop on'() {
      // SL0 +Music.s:3073: updates the mask AND re-points live samples.
      //
      // DEFECT: the masked form is unreachable. +Music.s:408 gives the $FE
      // variant behind `!sam loop on` the spec "I" where `InSamLoopOn1`
      // (:3020) does `move.l d3,d1` and needs "I0". `Sam Loop Off` has the
      // pair written correctly at :412, so OFF takes a mask and ON does not.
      // What is left is `InSamLoopOn0` (:3026), `moveq #%1111,d1`.
      rt.samLoopMask = 0b1111
      for (let v = 0; v < 4; v++) rt.audio.setLoop(v, 0)
    },
    'sam loop off'(it) {
      const mask = (it.atStmtEnd() ? 0b1111 : it.evalInt()) & 15
      rt.samLoopMask &= ~mask
      for (let v = 0; v < 4; v++) if (mask & (1 << v)) rt.audio.setLoop(v, -1)
    },
    volume(it) {
      // InVolume1/2 +Music.s:2713: the one-argument form also sets the
      // music master volume (L_MVol); out-of-range volume errors in Vol
      const a = it.evalInt()
      if (it.accept(',')) {
        rt.setVolume(a & 15, it.evalInt())
      } else {
        rt.setVolume(0b1111, a)
        rt.musicVolume = a & 63
        rt.music.setMusicVolume()
      }
    },
    bell(it) {
      // InBell +Music.s:2681: the square wave (1) with EnvBell on all
      // four voices; default note 70
      rt.music.playNote(0b1111, it.atStmtEnd() ? 70 : it.evalInt(), 1, ENV_BELL)
    },
    shoot() {
      // InShoot +Music.s:2687: noise notes 60..63, one per voice
      rt.music.shout(60, ENV_SHOOT)
    },
    boom() {
      // InBoom +Music.s:2676: noise notes 36..39 with the boom envelope
      rt.music.shout(36, ENV_BOOM)
    },
    play(it) {
      // InPlay2/3 +Music.s:2776: Play [voices,]note,wait — a negative
      // wait errors; a positive one behaves as Wait n after starting
      const a = it.evalInt()
      it.expect(',')
      const b = it.evalInt()
      let mask = 0b1111
      let note = a
      let wait = b
      if (it.accept(',')) {
        mask = a & 15
        note = b
        wait = it.evalInt()
      }
      if (wait < 0) funcCall()
      rt.music.playNote(mask, note)
      if (wait > 0) it.block({ type: 'wait', until: it.tick + wait })
    },
    'play off'(it) {
      // InPlayOff +Music.s:2977 -> EnvOff
      rt.music.playOff((it.atStmtEnd() ? 0b1111 : it.evalInt()) & 15)
    },
    'set wave'(it) {
      // InSetWave +Music.s:3361: needs at least 256 characters (error
      // 181), wave 0 illegal; the first 256 bytes become the waveform
      const n = it.evalInt()
      it.expect(',')
      const s = it.evalStr()
      if (s.length < 256) throw new AmosError('256 characters for a wave', 181)
      if (n <= 0) funcCall()
      const src = new Int8Array(256)
      for (let i = 0; i < 256; i++) src[i] = (s.charCodeAt(i) << 24) >> 24
      rt.music.setWave(n, src)
    },
    'del wave'(it) {
      // InDelWave +Music.s:3379: waves 0 and 1 are reserved (error 182);
      // deleting resets every voice to wave 1
      const n = it.evalInt()
      if (n < 0) funcCall()
      if (n === 0 || n === 1) throw new AmosError('wave 0 and 1 are reserved', 182)
      rt.music.delWave(n)
    },
    'set envel'(it) {
      // InSetEnvel +Music.s:3426: Set Envel wave,phase To duration,volume;
      // a negative duration in phases 1-6 loops the envelope
      const wave = it.evalInt()
      it.expect(',')
      const phase = it.evalInt()
      it.expect('to')
      const dur = it.evalInt()
      it.expect(',')
      const vol = it.evalInt()
      if (vol < 0 || vol >= 64) funcCall()
      if (phase < 0 || phase >= 7) funcCall()
      if (wave < 0) funcCall()
      if (phase === 0 && dur <= 0) funcCall()
      rt.music.setEnvel(wave, phase, dur, vol)
    },
    wave(it) {
      // InWave +Music.s:3347: Wave n To voices
      const n = it.evalInt()
      if (n < 0) funcCall()
      it.expect('to')
      rt.music.waveTo(n, it.evalInt() & 15)
    },
    'noise to'(it) {
      // InNoiseTo +Music.s:3067
      rt.music.noiseTo(it.evalInt() & 15)
    },
    sample(it) {
      // InSampleTo +Music.s:3076: Sample n To voices
      const n = it.evalInt()
      it.expect('to')
      rt.music.sampleTo(n, it.evalInt() & 15)
    },
    voice(it) {
      // InVoice +Music.s:3728: mask &15 -> VOnOf; only acts while a
      // music is playing (stops/reclaims the player's voices)
      rt.music.voiceOnOff(it.evalInt() & 15)
    },
    music(it) {
      // InMusic +Music.s:3815: song from the bank-3 music bank; up to
      // 3 musics stack, a full stack ignores the call
      rt.music.music(it.evalInt())
    },
    'music off'() {
      rt.music.musicOff()
    },
    'music stop'() {
      // InMusicStop +Music.s:3675: zero the voice counters — the player
      // pops the music stack at the next step-tick
      rt.music.musicStop()
    },
    tempo(it) {
      // InTempo +Music.s:3852: 0-100 (unsigned compare), only affects a
      // playing music
      const t = it.evalInt()
      if (t < 0 || t > 100) funcCall()
      rt.music.tempo(t)
    },
    mvolume(it) {
      // InMvolume +Music.s:3694: >=64 errors; rescales all stacked musics
      const v = it.evalInt()
      if (v < 0 || v >= 64) funcCall()
      rt.musicVolume = v & 63
      rt.music.setMusicVolume()
    },
    'track load'(it) {
      // InTrackLoad +Music.s:4120: the whole file into a chip bank named
      // "Tracker "; reloading the currently playing bank stops it first
      const path = it.evalStr()
      it.expect(',')
      const n = it.evalInt()
      if (n < 1 || n >= 0x10000) funcCall()
      if (n === rt.music.trackBank && rt.music.mtOn) rt.music.trackStop()
      rt.music.trackBank = n
      const bytes = rt.fs?.read(path)
      if (!bytes) throw new AmosError(`file not found: ${path}`)
      rt.memBanks.set(n, { kind: 'memory', number: n, memType: 1, name: 'Tracker', flags: 0, data: bytes })
    },
    'track play'(it) {
      // InTrackPlay0-2 +Music.s:4240: bank defaults to Track_Bank; the
      // pattern argument is "not supported in this version" there either
      let bank: number | null = null
      if (!it.atStmtEnd()) {
        if (it.nm() !== ',') bank = it.evalInt()
        if (it.accept(',')) it.evalInt()
      }
      rt.music.trackPlay(bank)
    },
    'track stop'() {
      rt.music.trackStop()
    },
    run(it) {
      // InRun0 (+ILib.s:1436): bare Run only works in direct mode, and inside
      // a program it is a syntax error. Run "file" is the other way round --
      // InRun1 (+ILib.s:1447) opens `tst.w Direct(a5) / bne RIllDir`, and
      // RIllDir (:1156) is `moveq #17,d0`, Illegal direct mode.
      //
      // Then two tests decide what Run MEANS: `tst.l Mon_Base(a5) / bne
      // PRun_Acc` and `tst.b Prg_Accessory(a5) / bne PRun_Acc` (:1452). With
      // the monitor up, or in a program the verifier marked an accessory, Run
      // chains the way Prun does instead of replacing its host -- which is
      // what lets an accessory hand control on and still come back.
      if (it.atStmtEnd()) throw new AmosError('syntax error', 22)
      if (it.direct !== 0) throw new AmosError(ED_RUN_MESSAGES[17]!, 17)
      const path = it.evalStr()
      if (it.program.accessory) {
        rt.prun(path, it.afterCurrentStatement())
        return 'jumped'
      }
      rt.runFile(path)
      return 'jumped'
    },
    prun(it) {
      // InPRun +ILib.s:1537: run a second program as an accessory; the
      // caller's saved ChrGet points past this statement, so it resumes
      // there when the accessory ends
      const path = it.evalStr()
      rt.prun(path, it.afterCurrentStatement())
      return 'jumped'
    },
    exec(it) {
      /*
       * Exec "command" — InExec (+Lib.s:3363), source tier and complete:
       *
       *     move.l  d3,a2 / move.w (a2)+,d2
       *     Rbeq    L_FonCall               ; an empty string is error 23
       *     Rbsr    L_ChVerBuf              ; into Buffer(a5), NUL-terminated
       *     lea     .Nil(pc),a1 / move.l #1005,d2
       *     jsr     _LVOOpen(a6)            ; open NIL:
       *     move.l  Buffer(a5),d1
       *     move.l  d5,d2 / move.l d5,d3    ; input AND output are that NIL:
       *     jsr     _LVOExecute(a6)
       *     ... _LVOClose ...
       *     tst.l   d3 / Rbeq L_DiskError   ; DOSFALSE is error 87
       *
       * So AMOS's own Exec runs the command DETACHED -- both handles are the
       * NIL: it just opened, which is why nothing a command prints ever
       * appears. LDos's Lexecute and EasyLife's Elexec pass a literal 0 for
       * the same effect; Craft's Cli Execute is the one that does not.
       *
       * ChVerBuf (+Lib.s:3643) falls into ChVerBuf2, which truncates at 510
       * characters: `cmp.w #510,d0 / bcs / move.w #509,d0` (+Lib.s:3654)
       * copies at most 510 bytes and then the NUL.
       *
       * NOTE: nothing can run a command here, so Execute always answers
       * DOSFALSE and this always raises "Disc error". That is the branch the
       * routine itself takes for a command that does not exist -- which is
       * what every command is on a machine with no shell -- rather than a
       * stub. The seam is `host.process`; see ../amiga/process.ts.
       */
      const cmd = it.evalStr()
      if (cmd.length === 0) funcCall()
      const command = cmd.slice(0, 510)
      const r = execute(rt.host.process, { command, io: { input: null, output: null } })
      if (r === DOSFALSE) throw new AmosError('Disc error', 87)
    },
    system(it) {
      // InSystem +ILib.s:1820: `move.w #1002,d0 / bra RunErr`, leave AMOS
      // entirely. `Ed_Errr` (+Edit.s:8261) is the only place that reads 1002
      // differently from 1000, and it goes to `Ed_System`
      it.endCode = 1002
      // as Edit and Direct do: `rErr1` pulls the stack before it jumps
      it.exitDirect()
      it.halt('ended', false)
      return 'jumped'
    },
    /**
     * AMOS_WB window juggling (+Lib.s:11361).
     *
     * These used to be no-ops, on the grounds that a single-display host has
     * nothing to raise or lower. That was true only while AMOS was the only
     * thing that could own a display band: the machine has one copper list
     * and one screen table, and `Runtime.SCREEN_SLOTS` now partitions it by
     * owner so that intuition.library and a game system can hold slots of
     * their own. AMOS's screens move as one block against theirs.
     *
     * With nothing but AMOS screens open both are still the identity, which
     * is every program that has not started GMS or opened a Workbench.
     */
    'amos to front': () => rt.amosToFront(),
    'amos to back': () => rt.amosToBack(),
    'amos lock'() {
      // InAmosLock: to front + T_NoFlip, and now it can do both halves
      rt.amosToFront()
      rt.noFlip = true
    },
    'amos unlock'() {
      rt.noFlip = false
    },
    'close workbench'() {
      // WB_Close frees Workbench memory on the Amiga; nothing to close
    },
    'close editor'() {
      // Ed_CloseEditor frees the editor; there is no editor in the port
    },
    /**
     * `Call Editor n [,param [,line$]]` --- `InCallEditor1`/`2`/`3`
     * (+ILib.s:1649, :1660, :1670).
     *
     * The three forms are one routine: 1 and 2 push `EntNul` for the
     * arguments they were not given and fall into 3, which is `Ed_Par`
     * (+ILib.s:1745) unpacking them and `Ed_ZapIn` running the command.
     *
     * `Ed_Par` writes the string's LENGTH into `Name2` and its characters into
     * `Name1`, and `Ed_ZapIn` reads the length to decide whether a command
     * that wants a string was given one. An empty string is the same as none.
     */
    'call editor'(it) {
      const n = it.evalInt()
      // `Call Editor 71,,C$+B$` is CRAFT_Interface_Packer.AMOS verbatim: the
      // middle slot is left blank and compiles to EntNul, which is what form 2
      // pushes for it anyway
      const param = it.accept(',') ? optInt(it, ENT_NUL) : ENT_NUL
      const line = it.accept(',') ? it.evalStr() : null
      const ed = rt.editorZap
      if (ed === null) funcCall()
      zapReturn(it, ed.call(n, param, line))
    },
    /**
     * `Ask Editor n [,param [,line$]]` --- `InAskEditor1`/`2`/`3`
     * (+ILib.s:1608, :1619, :1629), the same three forms over
     * `Ed_ZapFonction`.
     */
    'ask editor'(it) {
      const n = it.evalInt()
      const param = it.accept(',') ? optInt(it, ENT_NUL) : ENT_NUL
      if (it.accept(',')) it.evalStr() // `Ed_Par` reads it; no question uses it
      const ed = rt.editorZap
      if (ed === null) funcCall()
      // NOT `ZapReturn`. `InAskEditor3` writes its own four instructions
      // (+ILib.s:1635): d0 goes to `Param` whatever it is, and the string
      // follows `tst.w d2` rather than d0, so a question answering the empty
      // string still answers it
      const r = ed.ask(n, param)
      it.paramInt = r.value
      it.paramStr = r.text
    },
    'set buffer'(it) {
      // InSetBuffer +ILib.s:1799 is literally rts in the interpreter —
      // the buffer size only matters to the editor/compiler at load time
      it.evalInt()
    },
    'set hardcol'(it) {
      // InSetHardcol +Lib.s:12317 -> HColSet +W.s:73: CLXCON is built
      // from a fixed $F in the odd-sprite enables, the first argument in
      // ENBP1-6 and the second in MVBP1-6
      const enable = it.evalInt()
      it.expect(',')
      const match = it.evalInt()
      rt.collide.clxcon = (0xf << 12) | ((enable & 0x3f) << 6) | (match & 0x3f)
    },
    'set accessory'() {
      // The token table points this at L_InNull (+Lib.s:1474) and InNull is
      // one instruction, rts (+ILib.s:3748), so nothing happens HERE. The
      // work is the verifier's: VerSetA (+Verif.s:826) is `bsr SetNot1.3 /
      // addq.b #1,Prg_Accessory(a5)`, and Ver_APCmp (:1631) reads the same
      // flag out of a saved program's APrg_MathFlags high byte.
      //
      // So the flag is set before the program runs and holds for all of it,
      // including the lines above this statement. Two places read it back:
      // CheckScreenNumber (+Lib.s:9163) gives an accessory ten screens rather
      // than eight, and InRun1 (+ILib.s:1452) turns Run into Prun. This port
      // carries it on Program.accessory, which ../interp/prescan.ts sets on
      // the same pass the verifier would. $2578's spec is a bare "I", so
      // there is no argument to read either.
    },
    'iff anim'(it) {
      // InIffAnim2 +Lib.s:4509: Iff Anim "file" To screen[,times] — the
      // whole ANIM loads, frame 1 creates and double-buffers the
      // screen, then each frame waits the ANHD time, swaps, and plays
      // the next DLTA into the logical buffer (which is what makes
      // ANIM5's two-frames-back deltas land correctly).
      // The separator is `To`, not a comma: $260c's spec is "I2t0" with an
      // "I2t0,0" behind it, and Disc_Manager.AMOS:436 writes
      // `Iff Anim FF$ To 1`
      const path = it.evalStr()
      it.expect('to')
      const screen = it.evalInt()
      const times = it.accept(',') ? it.evalInt() : 1
      if (times < 0) funcCall()
      if (!rt.iffAnim) {
        const bytes = rt.fs?.read(path)
        if (!bytes) throw new AmosError(`file not found: ${path}`)
        const data = Uint8Array.from(bytes)
        const { bytes: size } = formSize(data, 0, 32767)
        const buf = new Uint8Array(size + 8)
        formLoad(data, 0, 32767, buf)
        if (String.fromCharCode(buf[8]!, buf[9]!, buf[10]!, buf[11]!) !== 'ILBM') throw new AmosError('bad IFF format')
        const pos = formPlay(rt, buf, 0, 1, screen, false)
        rt.screen.doubleBuffer()
        rt.iffAnim = { buf, pos, firstPos: pos, remaining: times, nextDue: it.tick + Math.max(1, rt.iffReturn + 1) }
      }
      const st = rt.iffAnim
      while (it.tick >= st.nextDue) {
        rt.screen.swap()
        if (String.fromCharCode(st.buf[st.pos]!, st.buf[st.pos + 1]!, st.buf[st.pos + 2]!, st.buf[st.pos + 3]!) === 'AenD') {
          if (--st.remaining > 0) {
            st.pos = st.firstPos
          } else {
            rt.iffAnim = null
            return
          }
        }
        st.pos = formPlay(rt, st.buf, st.pos, 1, null, false)
        st.nextDue = it.tick + Math.max(1, rt.iffReturn + 1)
      }
      it.block({ type: 'wait', until: st.nextDue }, true)
      return 'jumped'
    },
    'med load'(it) {
      // InMedLoad +Music.s:4456: whole file into a chip bank "Med     ";
      // a bad magic erases the bank and raises error 189
      const path = it.evalStr()
      it.expect(',')
      const n = it.evalInt()
      if (n < 1 || n >= 0x10000) funcCall()
      if (n === rt.music.med.bank) rt.music.med.stop()
      rt.music.med.bank = n
      const bytes = rt.fs?.read(path)
      if (!bytes) throw new AmosError(`file not found: ${path}`)
      rt.memBanks.set(n, { kind: 'memory', number: n, memType: 1, name: 'Med', flags: 0, data: bytes })
      const magic = String.fromCharCode(...bytes.slice(0, 4))
      if (magic !== 'MMD0' && magic !== 'MMD1') {
        rt.memBanks.delete(n)
        throw new AmosError('not a med module', 189)
      }
    },
    'med play'(it) {
      // InMedPlay0-2 +Music.s:4577: Med Play [bank][,song] — the bank is
      // verified first, then samples/tracker/med all stop before the start
      let bank: number | null = null
      let song = 0
      if (!it.atStmtEnd()) {
        if (it.nm() !== ',') bank = it.evalInt()
        if (it.accept(',')) song = it.evalInt()
      }
      rt.music.med.stop()
      const n = rt.music.med.checkBank(bank)
      rt.stopVoices(0b1111)
      rt.music.trackStop()
      rt.music.med.play(n, song)
    },
    'med stop'() {
      rt.music.med.stop()
    },
    'med cont'() {
      rt.music.med.cont()
    },
    'med midi on'() {
      // InMedMidiOn +Music.s:4676: flag only — no MIDI output in the port
      rt.music.med.midi = true
    },
    'track loop on'() {
      rt.music.trackLoop = true
    },
    // the original token table really does spell it with one f
    // ("track loop o","f"+$80 — +Music.s:503)
    'track loop of'() {
      rt.music.trackLoop = false
    },
    // InLedOn/Of +Music.s:3891: $BFE001 bit 1 — LED lit = low-pass filter engaged
    // the bit is READ back by First 0.1's `Change Led`, a bchg, so the state
    // has to live somewhere rather than only being written at the sink
    // the bit lives on ../amiga/cia.ts and drives the sink from there, so
    // these set it and nothing else
    'led on': () => {
      rt.ledFilter = true
    },
    'led off': () => {
      rt.ledFilter = false
    },

    // ---- menus ----
    'menu$'(it) {
      // InMenu +ILib.s:6827: Menu$(path)=normal$[,highlight$][,inactive$]
      // [,background$] — labels compile to display objects (MnObjet)
      const path = menuPath(it)
      it.expectOp('=')
      const node = rt.menu.insert(path)
      const w = rt.screen.curWin
      node.inks1 = [w.paper, w.pen, w.paper]
      node.inks2 = [w.pen, w.paper, w.paper]
      node.ob1 = compileMenuObject(it.evalStr())
      node.ob2 = it.accept(',') ? compileMenuObject(it.evalStr()) : null
      node.ob3 = it.accept(',') ? compileMenuObject(it.evalStr()) : null
      node.obF = it.accept(',') ? compileMenuObject(it.evalStr()) : null
      if (rt.menu.screenNb < 0) rt.menu.screenNb = rt.currentIndex
    },
    'menu on'(it) {
      void it
      // InMenuOn +Lib.s:15563 opens `tst.l MnBase(a5) / beq.s .Skip`: with no
      // menu defined the instruction does nothing whatever, and does not
      // leave the flag set for a menu built later.
      if (rt.menu.roots.length === 0) return
      rt.menu.on = true
      // clr.l T_ClLast(a5) — a button already down when the menu comes on is
      // not a selection, so the click that is already in hand is dropped
      rt.input.mouseClickOld = rt.input.mouseK
    },
    'menu off'() {
      rt.menu.on = false
    },
    'menu calc'() {
      // InMenuCalc (+Lib.s:15738) is the fourth keyword to test MnBase, and
      // it answers the way Menu Base does: `tst.l MnBase(a5) / Rbeq L_MnNOp`,
      // error 38. Its second guard is the menu's own screen, `move.l
      // MnAdEc(a5),d0 / Rbeq L_ScNOp` (+Lib.s:15743), which is what MnRaz
      // clears -- so calculating after a Bank To Menu that failed is 38 here
      // and never reaches the 47.
      if (rt.menu.roots.length === 0) throw new AmosError(ED_RUN_MESSAGES[38]!, 38)
      void rt.screen
      menuCalc(rt.menu)
    },
    'menu base'(it) {
      /*
       * InMenuBase (+Lib.s:15595) opens `move.l MnBase(a5),d0 / Rbeq
       * L_MnNOp`, the same MnBase test Menu On makes 32 lines earlier -- and
       * the two answer it differently. Menu On skips in silence; Menu Base
       * raises MnNOp, `moveq #38,d0` (+Lib.s:15761), "Menu not opened". The
       * port had the test on Menu On and nothing at all here, so setting a
       * base before building the menu passed and then had no menu to move.
       *
       * EntNul-style elision keeps whichever coordinate was left out, and
       * only a coordinate actually given sets MnFixed.
       */
      if (rt.menu.roots.length === 0) throw new AmosError(ED_RUN_MESSAGES[38]!, 38)
      const x = it.atStmtEnd() || it.nm() === ',' ? null : it.evalInt()
      if (it.accept(',')) {
        const y = it.atStmtEnd() ? null : it.evalInt()
        if (y !== null) rt.menu.baseY = y
      }
      if (x !== null) rt.menu.baseX = x
      rt.menu.change = true
    },
    'menu movable'(it) {
      menuNodeFlag(it, rt, MF_TBOUGE, 0)
    },
    'menu static'(it) {
      menuNodeFlag(it, rt, 0, MF_TBOUGE)
    },
    'menu item movable'(it) {
      menuNodeFlag(it, rt, MF_BOUGE, 0)
    },
    'menu item static'(it) {
      menuNodeFlag(it, rt, 0, MF_BOUGE)
    },
    'menu bar'(it) {
      // level layout styles (+Lib.s:15653): bar = vertical column
      menuNodeFlag(it, rt, MF_BAR, 0)
    },
    'menu line'(it) {
      menuNodeFlag(it, rt, 0, MF_BAR | MF_TOTAL)
    },
    'menu tline'(it) {
      menuNodeFlag(it, rt, MF_TOTAL, MF_BAR)
    },
    'menu active'(it) {
      menuNodeFlag(it, rt, 0, MF_OFF)
    },
    'menu inactive'(it) {
      menuNodeFlag(it, rt, MF_OFF, 0)
    },
    'menu separate'(it) {
      // MnDim addresses either a node path (parens) or a whole level
      menuNodeFlag(it, rt, MF_SEP, 0)
    },
    'menu link'(it) {
      menuNodeFlag(it, rt, 0, MF_SEP)
    },
    /*
     * InMenuCalled and InMenuOnce (+Lib.s:15721) are `Rjsr L_MnDim` and one
     * write to MnFlag+1(a2), -1 against a clear. MnDim only sets a2 on its
     * PATH arm, so the bare-level form of these two writes through a
     * register the routine never filled — an AMOS bug, and the reason this
     * port takes the path form only.
     *
     * A path that resolves to nothing is MnDim's own MnINDef, error 39,
     * which the other menu keywords already raise and these two were
     * swallowing.
     */
    'menu called'(it) {
      menuNodeOf(rt, menuPath(it)).called = true
    },
    'menu once'(it) {
      menuNodeOf(rt, menuPath(it)).called = false
    },
    'menu del'(it) {
      // InMenuDel +ILib.s:6925: no path = wipe the whole tree
      if (it.atStmtEnd()) {
        rt.menu.reset()
        return
      }
      rt.menu.delete(menuPath(it))
    },
    'menu mouse on'() {
      rt.menu.mouse = true
    },
    'menu mouse off'() {
      rt.menu.mouse = false
    },
    'set menu'(it) {
      // InSetMenu +ILib.s:6944: Set Menu(path) To x,y — fixed position
      const node = rt.menu.insert(menuPath(it))
      it.expect('to')
      node.x = it.evalInt()
      it.expect(',')
      node.y = it.evalInt()
      node.flags |= MF_FIXED
      rt.menu.change = true
    },
    'menu key'(it) {
      // InMenuKey +ILib.s:6731: Menu Key(path) To k$ (ASCII, first char of
      // a non-empty string) or To scan[,shift] (numeric, scan < 128,
      // shift < 256); leaf nodes only; NO To clears the key (IMnk2)
      const node = rt.menu.find(menuPath(it))
      if (node && node.children.length > 0) funcCall()
      if (!it.accept('to')) {
        if (node) node.key = { kind: 0, asc: 0, scan: 0, shift: 0 }
        return
      }
      const v = it.evalExpr()
      if (v.k === 'str') {
        if (v.s.length === 0) funcCall()
        if (node) node.key = { kind: 1, asc: v.s.charCodeAt(0), scan: 0, shift: 0 }
        return
      }
      const scan = int(v)
      const shift = it.accept(',') ? it.evalInt() : 0
      if (shift >>> 0 >= 256 || scan >>> 0 >= 128) funcCall()
      if (node) node.key = { kind: -1, asc: 0, scan, shift }
    },
    'menu to bank'(it) {
      // +Lib.s:15401: serialise the tree as a "Menu    " bank. InMenuToBank
      // opens `move.l MnBase(a5),d0 / Rbeq L_FonCall` (+Lib.s:15375), so with
      // no menu built it is error 23 -- not Menu Base's 38, and not the empty
      // bank the port used to write.
      const n = it.evalInt()
      if (rt.menu.roots.length === 0) funcCall()
      rt.memBanks.set(n, {
        kind: 'memory',
        number: n,
        memType: 0,
        name: 'Menu    ',
        flags: 0,
        data: menuToBank(rt.menu),
      })
    },
    /*
     * InBankToMenu (+Lib.s:15465) throws the current menu away before it
     * looks at anything: `Rjsr L_MnRaz / Rjsr L_MnClearVar` come first, and
     * MnRaz (+Lib.s:17305) frees every node, clears MnAdEc and clears
     * BitMenu in ActuMask -- so a Bank To Menu that then fails has left the
     * program with no menu and the menu switched off.
     *
     * Then the checks, in this order: `tst.w ScOn(a5) / Rbeq L_ScNOp`, then
     * `Bnk.GetAdr / Rbeq L_BkNoRes` for a bank that is not there at all, then
     * `cmp.l (a1),d0 / Rbne L_FonCall` against the "Menu" identifier. A bank
     * of the wrong type is error 23; only a missing one is 36. The port
     * answered 36 to both and cleared nothing.
     */
    'bank to menu'(it) {
      const n = it.evalInt()
      rt.menu.roots = []
      rt.menu.on = false
      rt.menu.screenNb = -1
      rt.menu.change = true
      void rt.screen
      const bank = rt.memBanks.get(n)
      if (!bank) throw new AmosError('bank not reserved', 36)
      if (!/^menu/i.test(bank.name)) funcCall()
      bankToMenu(rt.menu, bank.data)
      if (rt.menu.screenNb < 0) rt.menu.screenNb = rt.currentIndex
    },
    'on menu'(it) {
      // On Menu Goto/Gosub L1[,L2...] / On Menu Proc P1[,P2...]. `V1_OnMenu`
      // (+Verif.s:1061) takes _TkGto, _TkGsb or _TkPrc and nothing else, and
      // the first two share the label path.
      const kind = it.nm()
      if (kind !== 'goto' && kind !== 'gosub' && kind !== 'proc') {
        throw new AmosError('On Menu needs Goto, Gosub or Proc')
      }
      it.advance()
      const targets: string[] = []
      for (;;) {
        const t = it.tok()
        if (t === undefined || !('name' in t)) throw new AmosError('label expected')
        it.advance()
        targets.push(t.name.toLowerCase())
        if (!it.accept(',')) break
      }
      rt.onMenu = { kind, targets, armed: false }
    },
    'on menu on'() {
      // InOnMenuOn (+Lib.s:15326) is `tst.w OMnNb(a5) / beq.s .Skip / bset
      // #BitJump,ActuMask(a5)`, so it does nothing until On Menu Goto/Gosub/
      // Proc has built the table -- and that instruction ENDS by clearing the
      // same bit (+ILib.s:6813, "Plus de branchements"), which is why a
      // program has to arm itself before its first menu selection counts.
      if (rt.onMenu) rt.onMenu.armed = true
    },
    'on menu off'() {
      // DEFECT: InOnMenuOff (+Lib.s:15335) is InOnMenuOn instruction for
      // instruction. It `bset`s BitJump where it plainly means to clear it,
      // and the mislabelled "; ON MENU ON" comment sitting above it is the
      // author's own copy-paste showing how. So On Menu Off ARMS the jump
      // exactly as On Menu On does, and On Menu Del is the only way to stop
      // one. Reproduced; this port used to disarm.
      if (rt.onMenu) rt.onMenu.armed = true
    },
    'on menu del'() {
      // InOnMenuDel -> OMnEff (+Lib.s:15343) frees the jump table and clears
      // OMnNb and OMnBase, after which On Menu On and Off are both no-ops
      // because their `tst.w OMnNb(a5)` fails.
      rt.onMenu = null
    },
    // ---- blocks ----
    'get block'(it) {
      const n = blockNum(it)
      it.expect(',')
      const [x, y] = pair(it)
      it.expect(',')
      const [w, h] = pair(it)
      const mask = it.accept(',') ? it.evalInt() !== 0 : false
      /*
       * A block IS a bob image: `MakeBloc` (+W.s:12389) grabs it with the
       * same `GetBob`, and GetBob stores a WORD COUNT — `add.w #15,d4 /
       * lsr.w #4,d4` (+W.s:620). So the stored width is the request rounded
       * UP to 16 and the odd columns on the right come out zero.
       *
       * Keeping the requested width beside a rounded buffer gave Put Block
       * the wrong stride. Crystal Caverns' title screen is
       * `Get Block 1,50,0,220,120,1` and `Put Block 1,50,34`: 220 was stored
       * in 224, and reading it back four pixels short per row sheared the
       * whole 220x120 picture into diagonal stripes.
       */
      const img = rt.grab(scr(), x, y, x + w, y + h)
      rt.blocks.set(n, { x, y, w: img.width, h: img.height, pixels: img.pixels, mask })
    },
    'put block'(it) {
      const b = rt.blocks.get(blockNum(it))
      if (!b) throw new AmosError(ED_RUN_MESSAGES[46]!, 46)
      let x = b.x
      let y = b.y
      if (it.accept(',')) {
        x = it.evalInt()
        it.expect(',')
        y = it.evalInt()
        while (it.accept(',')) it.evalInt() // planes/minterm
      }
      rt.blit(scr(), { width: b.w, height: b.h, pixels: b.pixels }, x, y, !b.mask)
    },
    'del block'(it) {
      // InDelBlock0 is a bare `EcCall BlRaz` and says nothing about what it
      // cleared. The one-argument form goes through BlDel (+W.s:12463), which
      // is `bsr FindBloc / bne.s FrBloc / moveq #BlE+2,d0`, and the caller's
      // `Rbne L_EcWiErr` turns that into 19+2+44.
      if (it.atStmtEnd()) rt.blocks.clear()
      else if (!rt.blocks.delete(blockNum(it))) throw new AmosError(ED_RUN_MESSAGES[65]!, 65)
    },
    'get cblock'(it) {
      /*
       * A Cblock is NOT a bob. `CBloc` (+W.s:12065) opens with `lsr.w #3,d1`
       * on the x and `lsr.w #3,d3` on the width, and works in whole BYTES of
       * bitplane from there. Both truncate, so x starts at the byte it falls
       * in and the width loses its remainder: 8 pixels of granularity, which
       * is the rule the manual states for these coordinates.
       *
       * It is a different rounding from Get Block's, and in the opposite
       * direction, because the two keywords call different routines.
       */
      const n = blockNum(it)
      it.expect(',')
      const [x, y] = pair(it)
      it.expect(',')
      const [w, h] = pair(it)
      const x0 = x & ~7
      const bw = Math.max(0, (w >> 3) << 3)
      const bh = Math.max(0, h)
      const s = scr()
      const pixels = new Uint8Array(bw * bh)
      for (let py = 0; py < bh; py++) {
        for (let px = 0; px < bw; px++) {
          const v = s.point(x0 + px, y + py)
          pixels[py * bw + px] = v < 0 ? 0 : v
        }
      }
      rt.cblocks.set(n, { x: x0, y, w: bw, h: bh, pixels })
    },
    'put cblock'(it) {
      const b = rt.cblocks.get(blockNum(it))
      if (!b) throw new AmosError(ED_RUN_MESSAGES[46]!, 46)
      let x = b.x
      let y = b.y
      if (it.accept(',')) {
        x = it.evalInt()
        it.expect(',')
        y = it.evalInt()
      }
      // `PBloc` (+W.s:12212) snaps the destination the same way, `lsr.w #3,d1`
      rt.blit(scr(), { width: b.w, height: b.h, pixels: b.pixels }, x & ~7, y, true)
    },
    'del cblock'(it) {
      // FreeCBloc (+W.s:12309) reaches CBlE2, which is the same `moveq
      // #BlE+2,d0` DelBloc uses, so a missing cblock reports the same 65
      if (it.atStmtEnd()) rt.cblocks.clear()
      else if (!rt.cblocks.delete(blockNum(it))) throw new AmosError(ED_RUN_MESSAGES[65]!, 65)
    },

    // ---- screens extra ----
    'screen clone'(it) {
      const n = checkScreenNumber(rt, it.evalInt())
      const src = scr()
      const clone = rt.openScreen(n, src.width, src.height, src.ham ? 4096 : src.nColors, (src.hires ? 0x8000 : 0) | (src.laced ? 4 : 0))
      // a shared BITMAP, which is what the keyword means: the clone points at
      // the same planes, so a write through either screen is visible from
      // both. Assigning the chunky buffers across shared the cache and left
      // each screen its own planes, and the planes are the bitmap
      clone.shareBitmapsFrom(src)
      // the palette is COPIED, not shared. `EcCClo` (+W.s:2707) reserves
      // EcLong bytes and byte-copies the whole screen structure into them,
      // and the colours live in that structure, so the clone owns its own.
      // Sharing the array broke the standard fade-in: Alien Pong Trilogy 2's
      // NICEFADE clones, blacks all 32 colours of the original, then does
      // `Fade 2 To 1` to bring them back up from the clone's copy. With one
      // array the target was black too and the game played in the dark.
      clone.palette.set(src.palette)
      rt.setCurrent(src.index)
    },
    'sprite update on'() {
      rt.spriteUpdateOn = true
      rt.frozenSprites = null
    },
    'sprite update off'() {
      rt.frozenSprites = [...rt.hwSprites.values()].map((s2) => ({ ...s2 }))
      rt.spriteUpdateOn = false
    },
    /*
     * Both fall into HVSc (+Lib.s:13529), which walks a table of four
     * null-terminated strings to reach the n'th:
     *
     *     cmp.l #4,d3 / Rbhi L_WFonCall
     *   Hv1: subq.l #1,d3 / Rbmi L_WFonCall / beq.s Hv3
     *   Hv2: tst.b (a1)+ / bne.s Hv2 / bra.s Hv1
     *
     * so 1 to 4, with 0 caught by the `Rbmi` after the first decrement and a
     * negative by the unsigned `Rbhi` above it. Both exits are WFonCall,
     * `moveq #16,d0 / Rbra L_EcWiErr` (+Lib.s:13003), which is error 60 and
     * not the catch-all 23 the port raised -- the same 60 Cline and Set Tab
     * eight lines up already had right.
     */
    'hscroll'(it) {
      // n in 1..4 prints window control code 15+n — the scroll itself is the
      // escape-code handler (ScG*/ScD* +W.s:14539), so Print Chr$(16) does
      // the same thing (InHScroll +Lib.s:13515)
      const n = it.evalInt()
      if (n < 1 || n > 4) throw new AmosError(ED_RUN_MESSAGES[60]!, 60)
      scr().writeText(String.fromCharCode(15 + n))
    },
    'vscroll'(it) {
      // InVScroll +Lib.s:13523: codes 19+n (ScBas/ScBasHaut/ScHaut/
      // ScHautBas +W.s:14657-14760)
      const n = it.evalInt()
      if (n < 1 || n > 4) throw new AmosError(ED_RUN_MESSAGES[60]!, 60)
      scr().writeText(String.fromCharCode(19 + n))
    },

    // ---- text styles ----
    'under on'() {
      scr().curWin.style |= 1
    },
    'under off'() {
      scr().curWin.style &= ~1
    },
    'shade on'() {
      scr().curWin.shade = true
    },
    'shade off'() {
      scr().curWin.shade = false
    },
    // InInverseOn/Off (+Lib.s:13397, :13405) print ESC "I1" and ESC "I0",
    // and Inv (+W.s:14830) SWAPS WiPen and WiPaper rather than setting a
    // rendering flag -- see Screen.setInverse
    'inverse on'() {
      scr().setInverse(true)
    },
    'inverse off'() {
      scr().setInverse(false)
    },
    'set text'(it) {
      // InSetText +Lib.s:9879: the rastport SoftStyle byte — it styles
      // the graphics Text instruction only; the console's underline is
      // the separate Under On/Off flag (Esc U)
      scr().textStyle = it.evalInt() & 0xff
    },
    'scroll on'() {
      scr().curWin.scrollOff = false
    },
    'scroll off'() {
      scr().curWin.scrollOff = true
    },
    'key speed'(it) {
      // InKeySpeed +Lib.s:2136 refuses a negative on either argument, and the
      // spec is "I0,0" so both slots are there to fill. A blank one still
      // arrives as EntNul, which is negative, so `Key Speed 5,` is the same
      // error as `Key Speed 5,-1`.
      const delay = it.evalInt()
      it.expect(',')
      const rate = it.evalInt()
      if (delay < 0 || rate < 0) funcCall()
      // the rates themselves go no further: SyCall KeySpeed programs the
      // Amiga's own repeat thresholds, and the host keyboard owns those here
    },
    'change mouse'(it) {
      // InChangeMouse +Lib.s:12185: shape 0 and below error before MChange
      const n = it.evalInt()
      if (n <= 0) funcCall()
      rt.changeMouse(n)
    },

    // ---- memory / banks ----
    // InResData/InResWork +Lib.s:2408-2425 each `Rlea` a name out of the
    // eight-byte table at +Lib.s:3644-3658, where BkDat is "Data    ". The
    // shipped AMOSPro.Lib agrees: "Sprites Icons   Music   Amal    Menu
    // Data    Work    Asm     Iff     Loading!", one run of eight-byte
    // fields at $9514. AMOS 1.x said "Datas   " in the same slot -- every
    // AMOS/RAMOS 1.00 to 1.36 binary in the corpus, and only those -- which
    // is why 1.x-era programs carry Datas banks. This is the Pro port.
    'reserve as data': reserve('Data', true),
    'reserve as work': reserve('Work', false),
    'reserve as chip data': reserve('Data', true, true),
    'reserve as chip work': reserve('Work', false, true),
    erase(it) {
      // InErase +Lib.s:2181 has no error path — a missing bank is a no-op
      rt.eraseBank(it.evalInt())
    },
    'erase all'() {
      rt.memBanks.clear()
      rt.spriteBank = null
      rt.iconBank = null
    },
    'erase temp'() {
      // Bnk.EffTemp +Lib.s:8030 tests `btst #Bnk_BitData,d0` and NOTHING
      // else, so what survives is Data banks. A Bob or Icon bank survives
      // because Bnk.ResBob/ResIco (+Lib.s:8124/8116) build their flags as
      // `(1<<Bnk_BitBob)+(1<<Bnk_BitData)` -- it is a Data bank -- and not
      // because the sweep knows about object banks at all
      for (const b of rt.bankRefs()) {
        if ((b.flags & BNK.DATA) === 0) rt.eraseBank(b.number)
      }
    },
    'bank swap'(it) {
      const a = it.evalInt()
      it.expect(',')
      const b = it.evalInt()
      // InBankSwap bounds BOTH numbers before it touches a list: `Rble
      // L_FonCall / cmp.l #$10000,d0 / Rbge L_FonCall` on b (+Lib.s:2209)
      // and the same pair on a (+Lib.s:2216). So 1 to 65535, and bank 0 is
      // as much an error as a negative. The port checked neither.
      if (b <= 0 || b >= 0x10000 || a <= 0 || a >= 0x10000) funcCall()
      // NOTE: InBankSwap swaps the NUMBER fields in the one chain, so on the
      // machine `Bank Swap 1,5` leaves a Bob bank numbered 5. The two
      // representations here cannot express that -- an ObjectBank is parsed
      // images, not bytes -- so only the 1<->2 case is modelled
      if ((a === 1 || a === 2) && (b === 1 || b === 2) && a !== b) {
        const t = rt.spriteBank
        rt.spriteBank = rt.iconBank
        rt.iconBank = t
        return
      }
      // InBankSwap +Lib.s:2235: swap the number fields; an absent bank
      // just renumbers the other one — never an error
      const ba = rt.memBanks.get(a)
      const bb = rt.memBanks.get(b)
      if (ba) rt.memBanks.delete(a)
      if (bb) rt.memBanks.delete(b)
      if (ba) rt.memBanks.set(b, { ...ba, number: b })
      if (bb) rt.memBanks.set(a, { ...bb, number: a })
    },
    'bank shrink'(it) {
      // Bnk.Schrink +Lib.s:8265: shrink only — a larger length errors
      const n = it.evalInt()
      it.expect('to')
      const len = it.evalInt()
      const ref = rt.bankRef(n)
      if (!ref) throw new AmosError('bank not reserved')
      // `btst #Bnk_BitBob,d0  Pas une banque de bobs!` then the same for
      // Icon: an object bank is a function call error, not "not reserved"
      if (isObjectBank(ref)) funcCall()
      const bank = rt.memBanks.get(n)!
      if (len > bank.data.length || len < 0) funcCall()
      bank.data = bank.data.subarray(0, len)
    },
    'list bank'(it) {
      // InListBank/Bnk.List +Lib.s:2165/8616: ascending bank number;
      // "NN - name8 S: $XXXXXXXX L: len" — numbers under 10 get a
      // leading space, bob/icon banks list their image COUNT as L:
      for (const b of rt.bankRefs()) {
        const num = (b.number < 10 ? ' ' : '') + b.number
        const hex = b.address.toString(16).toUpperCase().padStart(8, '0')
        it.write(`${num} - ${b.name.padEnd(8).slice(0, 8)} S: $${hex} L: ${b.length}\n`)
      }
    },
    // Bset/Bclr/Bchg and the six rotates, over BsRout's two arms
    bset: bitOp((v, b) => v | b),
    bclr: bitOp((v, b) => v & ~b),
    bchg: bitOp((v, b) => v ^ b),
    'rol.b': rotOp(8, true),
    'rol.w': rotOp(16, true),
    'rol.l': rotOp(32, true),
    'ror.b': rotOp(8, false),
    'ror.w': rotOp(16, false),
    'ror.l': rotOp(32, false),
    poke(it) {
      const addr = it.evalInt()
      it.expect(',')
      const v = it.evalInt()
      const m = rt.resolveWrite(addr)
      if (m) m.data[m.off] = v & 0xff
    },
    /*
     * InDoke and InLoke (+Lib.s:2735) are what the source calls the
     * "POKEDOKELOKE ameliores": `btst #0,d0` picks an odd address out and
     * writes it a byte at a time, high byte first, instead of taking the
     * 68000's address error. FnDeek and FnLeek (+Lib.s:2776) read the same
     * way, and Deek's `moveq #0,d3` before the word makes it unsigned.
     * Byte-wise big-endian access is therefore right at every address, which
     * is what these already do.
     */
    doke(it) {
      const addr = it.evalInt()
      it.expect(',')
      const v = it.evalInt()
      const m = rt.resolveWrite(addr)
      if (m && m.off + 1 < m.data.length) {
        m.data[m.off] = (v >> 8) & 0xff
        m.data[m.off + 1] = v & 0xff
      }
    },
    loke(it) {
      const addr = it.evalInt()
      it.expect(',')
      const v = it.evalInt()
      const m = rt.resolveWrite(addr)
      if (m && m.off + 3 < m.data.length) {
        m.data[m.off] = (v >>> 24) & 0xff
        m.data[m.off + 1] = (v >>> 16) & 0xff
        m.data[m.off + 2] = (v >>> 8) & 0xff
        m.data[m.off + 3] = v & 0xff
      }
    },
    /**
     * `InStruc` (+ILib.s:5896, $7652 in AMOSPro.Lib), the assigning form.
     *
     * DEFECT: a byte field is written with the wrong register. The arms are
     * reached through `lsl.w #1,d0 / jmp .Jmp(pc,d0.w)` with the value in d3
     * and the doubled type index in d0, and `.Byte` is `move.b d0,(a0)` --
     * `10 80` at $7666, so the shipped binary and the source agree. Every
     * byte field therefore stores the type index doubled and never the value:
     * 0 for a signed byte, 6 for an unsigned one. The word and long arms use
     * d3 and are correct.
     */
    struc: (it, tok) => {
      const { addr, type } = strucAddr(it, tok)
      it.expectOp('=')
      const v = it.evalInt()
      strucCheck(addr, type)
      const m = rt.resolveWrite(addr)
      if (!m) throw new AmosError('Address error', 25)
      const put = (i: number, b: number): void => {
        if (m.off + i < m.data.length) m.data[m.off + i] = b & 0xff
      }
      if (type === 0 || type === 3) return put(0, type * 2)
      if (type === 1 || type === 4) {
        put(0, v >> 8)
        return put(1, v)
      }
      put(0, v >>> 24)
      put(1, v >>> 16)
      put(2, v >>> 8)
      put(3, v)
    },
    /**
     * `InStrucD` (:5962). The field is cleared first, so a string opening
     * with the four characters `|00|` leaves a null pointer behind -- the
     * shipped way to write one (`cmp.l #"|00|",(a2) / beq .Skp`).
     *
     * DEFECT: what it stores cannot be read back. The block it builds is a
     * length word, the characters and a zero, and the pointer it stores is to
     * the LENGTH WORD, while `FnStrucD` (:5993) follows the pointer with
     * `A0ToChaine` (+Lib.s:3720), which reads a C string. For any string
     * shorter than 255 characters the length word's high byte is that C
     * string's terminator, so `=Struc$` reads back empty. No program in the
     * corpus of 3,875 uses `Struc$` at all.
     */
    'struc$': (it, tok) => {
      const { addr, type } = strucAddr(it, tok)
      it.expectOp('=')
      strucCheck(addr, type)
      const m = rt.resolveWrite(addr)
      if (!m) throw new AmosError('Address error', 25)
      const put = (ptr: number): void => {
        for (let i = 0; i < 4; i++) {
          if (m.off + i < m.data.length) m.data[m.off + i] = (ptr >>> (24 - i * 8)) & 0xff
        }
      }
      put(0) // clr.l (a0), before the expression and not after
      const text = it.evalStr()
      if (!text.startsWith('|00|')) put(rt.allocAmosString(text))
    },
    'poke$'(it) {
      const addr = it.evalInt()
      it.expect(',')
      const str2 = it.evalStr()
      const m = rt.resolveWrite(addr)
      if (m) for (let i = 0; i < str2.length && m.off + i < m.data.length; i++) m.data[m.off + i] = str2.charCodeAt(i) & 0xff
    },
    fill(it) {
      // FillBis +Lib.s:2619: the long value written big-endian and repeated,
      // the trailing 1-3 bytes continuing the same rotation
      const start = it.evalInt()
      it.expect('to')
      const end = it.evalInt()
      it.expect(',')
      const v = it.evalInt()
      const m = rt.resolveWrite(start)
      if (!m) return
      const len = Math.min(end - start, m.data.length - m.off)
      for (let i = 0; i < len; i++) m.data[m.off + i] = (v >>> (24 - (i & 3) * 8)) & 0xff
    },
    copy(it) {
      // TransMem +Lib.s:2506: direction chosen by src/dst order so
      // overlapping moves within one bank stay correct
      const start = it.evalInt()
      it.expect(',')
      const end = it.evalInt()
      it.expect('to')
      const dest = it.evalInt()
      // InCopy (+Lib.s:2602) is `sub.l a0,d0 / Rbls L_FonCall`: the length is
      // end minus start and `bls` catches both the zero and the borrow, so a
      // Copy that would move nothing is error 23 rather than a no-op. The
      // port returned quietly, which hid the swapped-argument mistake this
      // check exists to report.
      if (end - start <= 0) funcCall()
      const src = rt.resolveAddr(start)
      const dst = rt.resolveWrite(dest)
      if (!src || !dst) return
      const len = Math.min(end - start, src.data.length - src.off, dst.data.length - dst.off)
      if (len <= 0) return
      if (src.data === dst.data) {
        // same bank: copyWithin handles overlap in both directions
        dst.data.copyWithin(dst.off, src.off, src.off + len)
      } else {
        dst.data.set(src.data.subarray(src.off, src.off + len), dst.off)
      }
    },
    bload(it) {
      // InBload +Lib.s:4278: destination through Bnk.OrAdr — a bank
      // number names a RESERVED bank (missing = bank not reserved); the
      // whole file loads to the address (bounded here by the region;
      // the real machine would overrun into raw memory)
      const path = it.evalStr()
      it.expect(',')
      const dest = it.evalInt()
      const bytes = rt.fs?.read(path)
      if (!bytes) throw new AmosError(`file not found: ${path}`)
      const m = rt.bankOrAddr(dest)
      if (m) m.data.set(bytes.subarray(0, m.data.length - m.off), m.off)
    },
    bsave(it) {
      // InBSave +Lib.s:4310: end-start must be positive (Rbls FonCall);
      // the start goes through Bnk.OrAdr
      const path = it.evalStr()
      it.expect(',')
      const start = it.evalInt()
      it.expect('to')
      const end = it.evalInt()
      const bankForm = start >= 0 && start < 0x10000
      const base = bankForm ? rt.bankBase(start) : start
      if (end - base <= 0) funcCall()
      const m = rt.bankOrAddr(start)
      if (!m) throw new AmosError('address error')
      const len = Math.min(end - base, m.data.length - m.off)
      if (!rt.vfs?.writeFile(path, Uint8Array.from(m.data.subarray(m.off, m.off + len)))) {
        throw new AmosError('disc is write protected', 84)
      }
    },
    ppload(it) {
      // Ppload "file"[,number] — InppLoad +CompExt.s:455. Loads a PowerPacked
      // "PPbk" bank; with no number the header's own bank number is used.
      const path = it.evalStr()
      const forced = it.accept(',') ? it.evalInt() : -1
      const bytes = rt.fs?.read(path)
      if (!bytes) throw new AmosError(`file not found: ${path}`)
      // the codec lives in ../amiga and raises plain Errors — an AMOS error
      // number is this keyword's to choose, not powerpacker.library's
      let bank
      try {
        bank = parsePpBank(Uint8Array.from(bytes))
      } catch {
        throw new AmosError('Not a powerpacked bank', 23)
      }
      /*
       * A bob or icon bank, Bnk_BitBob and Bnk_BitIcon (+Equ.s:1839-1840,
       * which are BIT NUMBERS, so bits 2 and 3).
       *
       * These used to be refused as "carrying serialised objects", and what
       * they carry is an ordinary sprite bank with no `AmSp` magic on the
       * front: a count, then width-in-words, height and depth per image,
       * which is how a bank sits in memory and so how `Ppsave` writes it.
       * Renegades' `Ppload PATH$+"LOGO.ABK",1` is one 96x28 five-plane
       * image and got "Not a powerpacked bank" for it.
       */
      if (bank.flags & 0x0c) {
        const kind = bank.flags & 0x08 ? 'icons' : 'sprites'
        let parsed
        try {
          parsed = parseSpriteBankBody(bank.data, kind)
        } catch {
          throw new AmosError('Not a powerpacked bank', 23)
        }
        /*
         * A POSITIVE number APPENDS. It is not a bank number at all here:
         * `tst.l d5 / ble .Over` then `Bnk.GetBobs / beq .Over / moveq #1,d0
         * ... add.w d5,d1` (+CompExt.s:551-560) reserves existing+new and
         * writes the arriving images after the ones already there. Zero, a
         * negative, or no bank at all overwrites.
         *
         * Renegades loads FONT.ABK, takes `_LOGO=Length(1)`, then
         * `Ppload "LOGO.ABK",1` and draws its text with images 1.._LOGO and
         * its logo with `_LOGO+1`. Overwriting left one image in the bank,
         * so every letter of "THIS GAME WAS WRITTEN IN..." came out as the
         * AMOS logo.
         */
        const loaded = ObjectBank.fromSpriteBank(parsed)
        const into = kind === 'sprites' ? rt.spriteBank : rt.iconBank
        if (forced > 0 && into && into.images.length > 0) {
          into.images = [...into.images, ...loaded.images]
          into.palette = loaded.palette
        } else if (kind === 'sprites') rt.spriteBank = loaded
        else rt.iconBank = loaded
        return
      }
      const num = forced >= 0 ? forced : bank.number
      rt.memBanks.set(num, {
        kind: 'memory',
        number: num,
        memType: bank.flags & 0x02 ? 1 : 0, // Bnk_BitChip
        // Ppload names nothing: ppBnk_Load pokes only the number and the
        // flags (+CompExt.s:539-548) and the name is already there, having
        // come out of the crunched payload with the rest of the bank
        name: bank.name ?? '',
        flags: bank.flags,
        data: bank.data,
      })
    },
    ppsave(it) {
      // Ppsave "file",number[,efficiency] — InppSave +CompExt.s:686
      const path = it.evalStr()
      it.expect(',')
      const num = it.evalInt()
      const efficiency = it.accept(',') ? it.evalInt() : 2
      if (efficiency < 0 || efficiency >= 5) funcCall()
      const bank = rt.memBanks.get(num)
      if (!bank) throw new AmosError('bank not reserved', 36)
      const file = writePpBank({
        number: num,
        flags: bank.flags | (bank.memType ? 0x02 : 0),
        name: bank.name,
        data: bank.data,
      })
      if (!rt.vfs?.writeFile(path, file)) throw new AmosError('disc is write protected', 84)
    },
    'sam raw'(it) {
      // InSamRaw +Music.s:3131: freq<=500 then length<=256 error; plays
      // through GoSam, so Sam Loop On applies to raw plays too
      const mask = it.evalInt()
      it.expect(',')
      const addr = it.evalInt()
      it.expect(',')
      const len = it.evalInt()
      it.expect(',')
      const freq = it.evalInt()
      if (freq <= 500 || len <= 256) funcCall()
      const m = rt.resolveAddr(addr)
      if (!m) return
      const pcm = new Int8Array(m.data.buffer, m.data.byteOffset + m.off, Math.min(len, m.data.length - m.off))
      rt.samPlay(mask & 15, pcm, freq)
    },
    'hrev block'(it) {
      // RevBloc +W.s:12591: FindBloc raises "Block not defined" on a missing
      // block, then Retourne mirrors the pixels along the chosen axis.
      //
      // Retourne (+W.s:1647) is idempotent on its own --- it XORs the stored
      // flags at 6(a1) against the requested ones and flips only the axes
      // that differ --- but RevBloc runs `and.w #$3FFF,6(a1)` first, which
      // zeroes that record. So every Hrev Block flips again, and a plain
      // toggle is right. Do not "fix" this into a set by reading Retourne
      // alone. InHRevBlock passes bit 15 and InVRevBlock bit 14
      // (+Lib.s:11205, :11210), and neither checks the block number: the only error
      // is FindBloc's.
      const b = rt.blocks.get(it.evalInt())
      if (!b) throw new AmosError(ED_RUN_MESSAGES[46]!, 46)
      for (let y = 0; y < b.h; y++) b.pixels.subarray(y * b.w, (y + 1) * b.w).reverse()
    },
    /*
     * Hrev Block and Vrev Block (+Lib.s:11205) each load one bit into d2 and
     * fall into Rev, which is `move.l d3,d1 / EcCall BlRev / Rbne
     * L_EcWiErr`. RevBloc (+W.s:12592) opens `bsr FindBloc / beq BlNDef`,
     * and BlNDef is `moveq #2,d0` — 46 through EcWiErr, "Block not defined".
     *
     * That is NOT Del Block's 65, "Block not found", which comes from
     * `moveq #BlE+2,d0`. Two block-missing errors with two numbers, and the
     * port had the right string on all four of these with no number at all,
     * so they were reporting as the catch-all 23.
     */
    'vrev block'(it) {
      const b = rt.blocks.get(it.evalInt())
      if (!b) throw new AmosError(ED_RUN_MESSAGES[46]!, 46)
      for (let y = 0; y < b.h >> 1; y++) {
        const a = b.pixels.slice(y * b.w, (y + 1) * b.w)
        b.pixels.copyWithin(y * b.w, (b.h - 1 - y) * b.w, (b.h - y) * b.w)
        b.pixels.set(a, (b.h - 1 - y) * b.w)
      }
    },

    // ---- files (Open In/Out, Print #, sequential channels) ----
    'open random'(it) {
      /*
       * InOpenRandom (+Lib.s:5220) is `move.w #$80,d0 / Rbsr L_RanApp`, and
       * RanApp (+Lib.s:5243) opens on the same two lines Append does: `move.l
       * (a3)+,d0 / Rbsr L_GetFile / Rbne L_FilOO`. So the channel goes
       * through GetFile's 1-to-9 bound and a channel that already holds a
       * handle is error 96, not a replacement.
       *
       * This is the one of the five openers that had neither. Open In, Open
       * Out, Open Port and Append all reach openChan; Open Random wrote
       * straight into the map, so `Open Random 0` opened channel 0 and a
       * second Open Random on a live channel dropped the first file.
       *
       * The file itself is opened OLD and then NEW (+Lib.s:5247), which is
       * why a missing one is created rather than a disc error.
       */
      const n = openChan(it.evalInt())
      it.expect(',')
      const path = it.evalStr()
      const data = rt.fs?.read(path)
      rt.fileChans.set(n, { mode: 'random', path, data: data ? Uint8Array.from(data) : new Uint8Array(0), pos: 0, out: [] })
    },
    field(it) {
      // InField +ILib.s:4740: Field #c, len As var$,... — the channel
      // must be open; zero lengths error; the record size is the sum
      // and the file size is snapshotted here for the Get/Put checks
      it.accept('#')
      const n = it.evalInt()
      const c = rt.chan(n)
      const fields: NonNullable<typeof c.fields> = []
      let recSize = 0
      do {
        it.expect(',')
        const len = it.evalInt()
        it.expect('as')
        const tg = it.parseTarget()
        if (tg.type !== 2) throw new AmosError('Type mismatch')
        if (len <= 0) funcCall()
        recSize += len
        // Fld2 (+ILib.s:4776) sums the lengths and tests the RUNNING total:
        // `add.l d0,d2 / cmp.l #String_Max,d2 / bcc FldFonc`, with
        // String_Max $FFC0 (+Equ.s:1139). A record of 65472 bytes or more is
        // a function-call error, because the record has to fit one AMOS
        // string; the port summed without ever looking.
        if (recSize >= 0xffc0) funcCall()
        fields.push({ len, get: () => str(tg.get()), set: (v: string) => tg.set(VS(v)) })
      } while (it.nm() === ',')
      c.fields = fields
      c.recSize = recSize
      c.fileSize = c.data.length
    },
    get(it) {
      // InGet +Lib.s:5262: Get #c,record — reads one record into the
      // Field variables; past the snapshot size is "end of file"
      const { c, off } = getPut(rt, it)
      if (off >= c.fileSize!) throw new AmosError('end of file', 100)
      let pos = off
      for (const f of c.fields!) {
        if (pos + f.len > c.data.length) throw new AmosError('disc error', 101)
        let s = ''
        for (let i = 0; i < f.len; i++) s += String.fromCharCode(c.data[pos + i]!)
        f.set(s)
        pos += f.len
      }
    },
    put(it) {
      // InPut +Lib.s:5295: writes each field (string truncated to the
      // field, short strings space-padded); writing may extend the file
      // by one record (offset > size is "end of file")
      const { c, off } = getPut(rt, it)
      if (off > c.fileSize!) throw new AmosError('end of file', 100)
      const end = off + c.recSize!
      if (end > c.data.length) {
        const grown = new Uint8Array(end)
        grown.set(c.data)
        c.data = grown
      }
      let pos = off
      for (const f of c.fields!) {
        const s = f.get()
        for (let i = 0; i < f.len; i++) c.data[pos + i] = i < s.length ? s.charCodeAt(i) & 0xff : 32
        pos += f.len
      }
      if (c.data.length > c.fileSize!) c.fileSize = c.data.length
    },
    /*
     * OpIn (+Lib.s:5082) ends `DosCall _LVOOpen / tst.l d0 / Rbeq
     * L_DiskError`, which reads as "a failed open is a disc error". It is
     * not that blunt. DiskError (+Lib.s:12843) calls _LVOIoErr and DiskErr
     * walks the AmigaDOS code down a table, adding the INDEX to DEBase:
     *
     *   ErDisk: 203,204,205,210,213,214,216,218,220,221,222,223,224,225,226
     *
     * so 203 is 79, 205 is 81, 226 is 93, and anything not in the table is
     * `moveq #DEBase+15,d0`, 94. Every one of the fifteen lands on the
     * message the AmigaDOS name predicts — 203 OBJECT_EXISTS on "File
     * already exists", 205 OBJECT_NOT_FOUND on "File not found", 226 NO_DISK
     * on "No disc in drive", 94 on "I/O error" — which is fifteen
     * independent confirmations that DEBase is 79.
     *
     * A missing file is therefore 81 and not the generic 101, which is what
     * these handlers already raise.
     */
    'open in'(it) {
      const n = openChan(it.evalInt())
      it.expect(',')
      const path = it.evalStr()
      const data = rt.fs?.read(path)
      if (data == null) throw new AmosError(`file not found: ${path}`)
      rt.fileChans.set(n, { mode: 'in', path, data, pos: 0, out: [] })
    },
    /**
     * Open Port CHANNEL,NAME$ --- `InOpenPort` (+Lib.s:5049). Open In and
     * Open Out with a different pair of constants: mode 1005 (MODE_OLDFILE)
     * as Open In uses, and channel-type flags `%111` where Open In pushes
     * `%010` and Open Out `%001`. Bit 2 is what marks it a PORT, and it is
     * the only thing `=Port(n)` checks before reading.
     *
     * SER: and PAR: are the names the manual gives, and a real host serial
     * port is bound when one is there; any other name opens as a file, which
     * is what MODE_OLDFILE on an arbitrary string does on the machine too.
     */
    'open port'(it) {
      const n = openChan(it.evalInt())
      it.expect(',')
      const path = it.evalStr()
      const serial = /^ser:/i.test(path) ? (rt.host?.serial?.open(0, DEV_SERIAL_DEFAULTS) ?? undefined) : undefined
      const data = serial ? new Uint8Array(0) : rt.fs?.read(path)
      if (data == null) throw new AmosError(`file not found: ${path}`)
      rt.fileChans.set(n, { mode: 'in', path, data, pos: 0, out: [], port: true, ...(serial ? { serial } : {}) })
    },
    'open out'(it) {
      const n = openChan(it.evalInt())
      it.expect(',')
      const path = it.evalStr()
      rt.fileChans.set(n, { mode: 'out', path, data: new Uint8Array(0), pos: 0, out: [], ...speakChannel(rt, path) })
    },
    append(it) {
      const n = openChan(it.evalInt())
      it.expect(',')
      const path = it.evalStr()
      // Append to SPEAK: is Open Out to SPEAK: — there is nothing to append to
      if (isSpeakPath(path)) {
        rt.fileChans.set(n, { mode: 'out', path, data: new Uint8Array(0), pos: 0, out: [], ...speakChannel(rt, path) })
        return
      }
      const existing = rt.fs?.read(path)
      rt.fileChans.set(n, { mode: 'out', path, data: new Uint8Array(0), pos: 0, out: existing ? [...existing] : [] })
    },
    close(it) {
      // the bare form shuts every channel; a numbered one goes through
      // GetFile like the rest, so 0 and 10 are error 23 and a channel that
      // was never opened is 97 rather than a silent no-op
      if (it.atStmtEnd()) {
        for (const n of [...rt.fileChans.keys()]) rt.closeChannel(n)
        return
      }
      const n = it.evalInt()
      rt.chan(n)
      rt.closeChannel(n)
    },
    'print #'(it) {
      const n = it.evalInt()
      const c = rt.chan(n)
      if (c.mode !== 'out') throw new AmosError('file type mismatch', 98)
      // A write to SPEAK: needs the voice loaded. Block and re-run the whole
      // statement, exactly as Say does — the arguments have not been consumed
      // yet, so this is the one point where the wait is free.
      if (c.speak && !ensureLib(rt) && !rt.speech.failed) {
        it.block({ type: 'speech' }, true)
        return
      }
      it.accept(',')
      const spoken: string[] = []
      const put = (t: string): void => {
        for (let i = 0; i < t.length; i++) c.out.push(t.charCodeAt(i) & 0xff)
        if (c.speak) spoken.push(t)
      }
      let nl = true
      while (!it.atStmtEnd()) {
        if (it.accept(';')) {
          nl = false
          continue
        }
        if (it.accept(',')) {
          put('\x09')
          nl = false
          continue
        }
        put(it.formatValue(it.evalExpr()))
        nl = true
      }
      // sp14: CR+LF line ends, unless JD Colour's Write patch is in (see
      // Runtime.amigaLineEnds), which turns the CR of a trailing CR+LF into
      // an LF and shortens the buffer by one
      if (nl) put(rt.amigaLineEnds ? '\n' : '\r\n')
      if (c.speak) rt.speakWrite(c, spoken.join(''))
    },
    'input #'(it) {
      const n = it.evalInt()
      it.expect(',')
      do {
        const tg = it.parseTarget()
        const raw = rt.readField(n, true) // Input # splits at commas
        if (tg.type === 2) tg.set(VS(raw))
        else tg.set(parseAmosNumber(raw))
      } while (it.accept(','))
    },
    'line input #'(it) {
      const n = it.evalInt()
      it.expect(',')
      do {
        const tg = it.parseTarget()
        const raw = rt.readField(n, false)
        if (tg.type === 2) tg.set(VS(raw))
        else tg.set(parseAmosNumber(raw))
      } while (it.accept(','))
    },
    pof(it) {
      /*
       * InPof (+Lib.s:5127) is `move.l d3,d2 / Rbmi L_FonCall` before the
       * Seek, so a negative position is error 23 and not a clamp to zero.
       * The Seek itself is `moveq #-1,d3`, OFFSET_BEGINNING, and a failure
       * is `tst.l d0 / Rbmi L_DiskError`.
       *
       * The reader is the same Seek with offset 0 and mode 0, which answers
       * the position it was already at.
       */
      it.expect('(')
      const c = rt.chan(it.evalInt())
      it.expect(')')
      it.expectOp('=')
      const v = it.evalInt()
      if (v < 0) funcCall()
      if (c.mode === 'in') c.pos = Math.min(c.data.length, v)
      else c.out.length = Math.min(c.out.length, v)
    },
    'set input'(it) {
      /*
       * InSetInput (+Lib.s:4650) checks ONE of its two arguments: `lsl.w
       * #8,d3 / move.l (a3)+,d0 / cmp.l #256,d0 / Rbcc L_FonCall / or.w
       * d3,d0`. So the first must be 0 to 255 and the second is shifted into
       * the high byte of ChrInp whatever it is — a negative keeps its low
       * byte, which is why -1 reads as the character 255 and so never
       * matches. The port masked the first instead of refusing it.
       */
      const a = it.evalInt()
      it.expect(',')
      const b = it.evalInt()
      if (a >>> 0 >= 256) funcCall()
      rt.chrInp = [a, b < 0 ? -1 : b & 0xff]
    },
    mkdir(it) {
      // InMkDir (+Lib.s:4912) is `DosCall _LVOCreateDir / tst.l d0 / Rbeq
      // L_DiskError`, and DiskError puts IoErr through the ErDisk table
      // documented above Open In. ERROR_OBJECT_EXISTS is 203, the table's
      // first entry, so making a directory that is already there is 79,
      // "File already exists", and not the catch-all disc error.
      const path = it.evalStr()
      if (rt.vfs?.exists(path) != null) throw new AmosError(ED_RUN_MESSAGES[79]!, 79)
      if (!rt.vfs?.mkdir(path)) throw new AmosError('disc error', 101)
    },
    kill(it) {
      // DeleteFile() takes a file or an *empty* directory, and both failures
      // go through DiskError's ErDisk table (see Open In): a missing name is
      // ERROR_OBJECT_NOT_FOUND 205, index 2, so 81; a full directory is
      // ERROR_DIRECTORY_NOT_EMPTY 216, index 6, so 85 — not the catch-all.
      const path = it.evalStr()
      if (rt.vfs?.exists(path) == null) throw new AmosError('file not found', 81)
      if (!rt.vfs.deleteFile(path)) throw new AmosError(ED_RUN_MESSAGES[85]!, 85)
    },
    rename(it) {
      // Rename() also moves, within one volume. Onto a name that is already
      // taken it fails with ERROR_OBJECT_EXISTS 203, the ErDisk table's first
      // entry, which is 79.
      const from = it.evalStr()
      it.expect('to')
      const to = it.evalStr()
      if (rt.vfs?.exists(from) == null) throw new AmosError('file not found', 81)
      if (rt.vfs.exists(to) != null) throw new AmosError(ED_RUN_MESSAGES[79]!, 79)
      if (!rt.vfs.rename(from, to)) throw new AmosError('disc error', 101)
    },
    assign(it) {
      // InAssign +Lib.s:5596. The name is the FIRST argument and the path the
      // last, and the name is the one with rules: `Rbeq L_FonCall` on an empty
      // one, `cmp.w #108,d2 / Rbcc L_FonCall` on the length, and
      // `cmp.b #":",-2(a0) / Rbne L_FonCall` demanding the trailing colon that
      // `clr.b -2(a0)` then strips before AssignLock sees it.
      const name = it.evalStr()
      it.expect('to')
      const path = it.evalStr()
      if (name === '' || name.length >= 108 || !name.endsWith(':')) funcCall()
      if (path.length >= 108) funcCall()
      // .Vide (+Lib.s:5612) skips LockGet for an empty path, so AssignLock is
      // handed a null lock and takes the assign away
      if (path === '') rt.vfs?.unassign(name)
      else rt.vfs?.assign(name, path)
    },
    'dir$'(it) {
      // assignment form: Dir$ = "path". InDirD (+Lib.s:4799) locks the path
      // and branches to L_DiskError if it cannot, so a bad one stops the
      // program on a real machine — which is what happens here too.
      //
      // Unless the host has turned on the stray-volume fallback, in which
      // case a path that no longer exists leaves the current directory alone
      // rather than ending the game. A 1997 program pointing at its author's
      // second hard drive is not a bug in the program; the files are in the
      // drawer next to it, and every load after this line names them bare.
      it.expectOp('=')
      const path = it.evalStr()
      if (!rt.vfs?.setCurrentDir(path)) {
        if (rt.vfs?.strayVolume !== 'currentDir') throw new AmosError(`directory not found: ${path}`)
      }
    },
    dir(it) {
      dirListing(it, rt, false, false)
    },
    'dir/w'(it) {
      dirListing(it, rt, true, false)
    },
    ldir(it) {
      dirListing(it, rt, false, true)
    },
    'ldir/w'(it) {
      dirListing(it, rt, true, true)
    },
    parent(it) {
      // InParent +Lib.s:4849: strip the last path component of the
      // current directory (back to the ':' or previous '/')
      void it
      const vfs = rt.vfs
      if (!vfs) return
      const cur = vfs.currentDir
      const i = cur.lastIndexOf('/')
      const c = cur.indexOf(':')
      vfs.currentDir = i > c ? cur.slice(0, i) : cur.slice(0, c + 1)
    },
    /*
     * Bgrab and Bsend move one bank between a Prun'd accessory and the
     * program that started it. Both open `move.l d3,d0 / Rble L_FonCall`, and
     * a `move` clears the carry so that bls is beq: a bank number of 0 or
     * below is error 23.
     *
     * They are not mirror images. InBGrab (+Lib.s:2276) erases the
     * destination first and then wants BOTH a previous program and the bank
     * in it, `Rjsr L_Bnk.PrevProgram / beq.s .Err` and `Rbsr L_Bnk.GetAdr /
     * beq.s .Err`, where .Err is L_BkNoRes -- error 36, and the destination
     * stays erased. InBSend (+Lib.s:2304) wants a previous program with
     * `Rbeq L_FonCall`, error 23 and not 36, erases the bank THERE, and then
     * `Rbsr L_Bnk.GetAdr / beq.s .Ok` finishes quietly when the current
     * program has no such bank to send.
     */
    bgrab(it) {
      const n = it.evalInt()
      if (n <= 0) funcCall()
      rt.memBanks.delete(n) // Bnk.Eff on the destination, before anything can fail
      const prev = rt.interp.previousProgramHost as { memBanks: Map<number, import('../loader/amosfile').MemoryBank> } | null
      const bank = prev?.memBanks.get(n)
      if (!bank) throw new AmosError(ED_RUN_MESSAGES[36]!, 36)
      prev!.memBanks.delete(n) // Lst.Remove from the origin
      rt.memBanks.set(n, bank) // Lst.Insert into ours
    },
    bsend(it) {
      const n = it.evalInt()
      if (n <= 0) funcCall()
      const prev = rt.interp.previousProgramHost as { memBanks: Map<number, import('../loader/amosfile').MemoryBank> } | null
      if (!prev) funcCall()
      prev!.memBanks.delete(n) // Bnk.Eff, on the previous program's list
      const bank = rt.memBanks.get(n)
      if (!bank) return // .Ok: nothing of ours to send, and no error
      rt.memBanks.delete(n)
      prev!.memBanks.set(n, bank)
    },
    'set dir'(it) {
      // InSetDir0/1 (+Lib.s:5496): Set Dir [width][,neg$] — width is
      // forced even (and.l #$FFFFFFFE), must be 2..104; the second arg is
      // the negative filename filter for listings
      //
      // `cmp.l #106,d3 / Rbcc L_FonCall` (+Lib.s:5502) is unsigned and runs
      // AFTER the AND, so -1 arrives as $fffffffe and is refused with 200.
      // A signed test let it through and stored a width of -2
      if (!(it.atStmtEnd() || it.nm() === ',')) {
        const w = it.evalInt() & ~1
        if (w === 0 || w >>> 0 >= 106) funcCall()
        rt.dirWidth = w
      }
      if (it.accept(',')) rt.dirNegFilter = it.evalStr()
    },

    // ---- AMAL ----
    amal(it) {
      // MvA3's limit is the one Anim, Move X and Move Y already carry: this
      // keyword reaches the same routine and had gone without it, so
      // `Amal 20,"..."` built a channel the interrupt never scans.
      const n = amDeclChannel(it.evalInt())
      it.expect(',')
      const src = amalSource(it)
      let prog
      try {
        prog = compileAmal(src)
      } catch (e) {
        if (e instanceof AmalCompileError) {
          rt.amalErrPos = e.position
          throw new AmosError(`syntax error in animation string: ${e.message}`)
        }
        throw e
      }
      const target = rt.chanTargets.get(n) ?? rt.makeChannelTarget('sprite', n)
      const ch = new AmalChannel(n, prog, target)
      ch.on = rt.amalDefaultOn
      rt.channels.set(n, ch)
    },
    // ---- STOS-compatibility Anim / Move (InAnim2/InMoveX2 +Lib.s:11783) ----
    anim(it) {
      // Anim n,"(image,delay)...[L]" — an independent slot beside the
      // channel's AMAL program (ID channel*4+1, CreAMAL +W.s:7998)
      const n = amDeclChannel(it.evalInt())
      it.expect(',')
      const spec = parseStosAnim(amalSource(it))
      const slot = rt.stosSlot(n)
      slot.anim = { ...spec, idx: 0, left: 1, done: false, on: false, frozen: false }
    },
    'move x'(it) {
      const n = amDeclChannel(it.evalInt())
      it.expect(',')
      const spec = parseStosMove(amalSource(it))
      rt.stosSlot(n).moveX = { ...spec, gi: 0, speedLeft: 1, countLeft: spec.groups[0]![2] || 0x10000, started: false, done: false, on: false, frozen: false }
    },
    'move y'(it) {
      const n = amDeclChannel(it.evalInt())
      it.expect(',')
      const spec = parseStosMove(amalSource(it))
      rt.stosSlot(n).moveY = { ...spec, gi: 0, speedLeft: 1, countLeft: spec.groups[0]![2] || 0x10000, started: false, done: false, on: false, frozen: false }
    },
    /*
     * Amal, Anim and Move On/Off/Freeze are nine keywords and one routine.
     * InAmalOn0 and its eight siblings (+Lib.s:11631) each set two registers
     * and branch to MvOnOf0: d2 is a STREAM MASK — %0001 AMAL, %0010 ANIM,
     * %1100 Move, two bits because X and Y are separate streams — and d3 is
     * the action, 1 on, -1 off, 0 freeze. d1 carries the channel, or -1 from
     * the no-argument forms, which MvOAll (+W.s:8288) turns into a walk of
     * the whole list. MvOAMAL picks the stream out with `move.w AmNb(a1),d7
     * / and.w #$0003,d7 / btst d7,d2`, so the low two bits of a channel's
     * number are its type: 0 AMAL, 1 Anim, 2 Move X, 3 Move Y.
     *
     * OnOfFrz (+W.s:8302) is where the surprise is. On and Freeze are one
     * bit, `and.w #$7FFF,AmBit(a1)` against `or.w #$8000,AmBit(a1)`. OFF is
     * not a bit at all: `tst.w d3 / bmi.s DAMAL` unlinks the channel from
     * the list and hands its memory back through FreeMm. The animation is
     * GONE, and a later On cannot restart it because there is nothing left
     * to unfreeze. The port had Off as a flag, so `Amal Off 1 : Amal On 1`
     * resumed a program AMOS had already freed.
     */
    'anim on'(it) {
      stosOnOff(it, ['anim'], 1)
    },
    'anim off'(it) {
      stosOnOff(it, ['anim'], -1)
    },
    'anim freeze'(it) {
      stosOnOff(it, ['anim'], 0)
    },
    'move on'(it) {
      stosOnOff(it, ['moveX', 'moveY'], 1)
    },
    'move off'(it) {
      stosOnOff(it, ['moveX', 'moveY'], -1)
    },
    'move freeze'(it) {
      stosOnOff(it, ['moveX', 'moveY'], 0)
    },
    channel(it) {
      /*
       * InChannel (+ILib.s:5569) bounds both numbers and the port bounded
       * neither. The channel is `bsr New_Expentier / cmp.l #64,d3 / bcc
       * FonCall`, so 0 to 63. The TARGET's ceiling arrives in d5, which the
       * type ladder sets as it walks past: 64 for Sprite and Bob, 8 for the
       * three Screen forms, 4 for Rainbow, then `cmp.l d5,d2 / bcc FonCall`.
       * Both tests are unsigned, so a negative fails them as an enormous
       * value would.
       *
       * The type codes are not consecutive. `addq.w #2,d4` before the
       * Rainbow arm skips 5, so the byte written to AnCanaux is 6.
       */
      const n = it.evalInt()
      if (n >>> 0 >= 64) funcCall()
      it.expect('to')
      const kind = it.nm()
      if (
        kind !== 'bob' &&
        kind !== 'sprite' &&
        kind !== 'screen display' &&
        kind !== 'screen offset' &&
        kind !== 'screen size' &&
        kind !== 'rainbow'
      ) {
        throw new AmosError('Channel: Bob/Sprite/Screen Display/Screen Offset/Rainbow expected')
      }
      it.advance()
      const m = it.evalInt()
      const limit = kind === 'sprite' || kind === 'bob' ? 64 : kind === 'rainbow' ? 4 : 8
      if (m >>> 0 >= limit) funcCall()
      const target = rt.makeChannelTarget(kind, m)
      rt.chanTargets.set(n, target)
      const ch = rt.channels.get(n)
      if (ch) ch.target = target
    },
    'amal on'(it) {
      amalOnOff(it, 1)
    },
    'amal off'(it) {
      amalOnOff(it, -1)
    },
    'amal freeze'(it) {
      amalOnOff(it, 0)
    },
    amplay(it) {
      // InAmPlay2/4 +Lib.s:11988 → SetPlay +W.s:7908. The PLay instruction
      // is steered entirely by two per-channel internal registers, and this
      // writes them across a range of channels in one go: R0 is the tempo,
      // R1 the direction (>0 forwards, 0 backwards, <0 abort). RegAMAL
      // (+W.s:7925) indexes the internal registers from the end, so R0/R1
      // are the same words AmPli initialises.
      const speed = it.atStmtEnd() || it.nm() === ',' ? null : it.evalInt()
      let dir: number | null = null
      let first = 0
      let last = 63
      if (it.accept(',')) {
        if (!(it.atStmtEnd() || it.nm() === ',')) dir = it.evalInt()
        if (it.accept(',')) {
          first = it.evalInt()
          it.expect('to')
          last = it.evalInt()
        }
      }
      // InAmPlay4's own checks, in its order: last unsigned-compared against
      // 64, first non-negative, and the range the right way round
      if (last >>> 0 >= 64 || first < 0 || last < first) funcCall()
      for (let n = first; n <= last; n++) {
        const ch = rt.channels.get(n)
        if (!ch) continue
        if (speed !== null) ch.regs[0] = speed
        if (dir !== null) ch.regs[1] = dir
      }
    },
    synchro(it) {
      if (rt.synchroManual) rt.stepAmal()
      void it
    },
    'synchro on'() {
      rt.synchroManual = false
    },
    'synchro off'() {
      rt.synchroManual = true
    },
    /**
     * `InDReg` and `InAReg` (+Lib.s:2672-2700), which are four instructions
     * each and share `IReg`, `FReg` and `RReg` under them.
     *
     *     InAReg: moveq #7,d0 / moveq #8,d1 / move.l (a3)+,d2 / Rbra L_IReg
     *     InDReg: moveq #8,d0 / moveq #0,d1 / move.l (a3)+,d2 / Rbra L_IReg
     *     RReg:   cmp.l d0,d2 / Rbcc L_FonCall / add.w d1,d2 / lsl.w #2,d2
     *             lea CallReg(a5),a0 / lea 0(a0,d2.w),a0
     *
     * So `CallReg` is one array of longs, `Dreg(n)` is index n with n < 8 and
     * `Areg(n)` is index 8+n with n < 7 -- A7 is the stack pointer and there
     * is no seventh address register to name. Anything at or above the limit
     * is an Illegal function call.
     *
     * DEVIATION: `Call` loads these into the CPU and reads them back, and
     * this port reads 68k without executing it, so nothing here ever writes
     * them but a program. That makes them eight and seven longs of program
     * storage, which is what they are between calls anyway, and it is what
     * `AMOSPro_Help` needs: `ADAT=Leek(Dreg(3)) : If ADAT` reads a structure
     * address out of d3 and has the guard for exactly the machine that did
     * not leave one there.
     */
    dreg(it) {
      writeReg(rt, it, 8, 0)
    },
    areg(it) {
      writeReg(rt, it, 7, 8)
    },
    amreg(it) {
      // assignment form: Amreg([channel,] n) = value
      it.expect('(')
      const a = it.evalInt()
      const b = it.accept(',') ? it.evalInt() : null
      it.expect(')')
      it.expectOp('=')
      const v = it.evalInt()
      // IAmR (+Lib.s:11958) stores with `move.w d5,(a0)`, a WORD
      if (b === null) rt.amalGlobals[amregGlobal(a)] = (v << 16) >> 16
      else amregChannel(rt, a, b).regs[b] = (v << 16) >> 16
    },

    'load iff'(it) {
      const path = it.evalStr()
      const n = it.accept(',') ? it.evalInt() : null
      const bytes = rt.fs?.read(path)
      // a missing file is error 81, never a skip: Chopper II's OPTIONS.IFF
      // went quietly missing and the 32-colour screen it opens never
      // replaced the 16-colour one, so the NEXT line's `Pen 31` was the
      // first thing to complain and named a text window
      if (!bytes) throw new AmosError(`file not found: ${path}`, ERR.FILE_NOT_FOUND)
      // the reader lives in ../loader and raises plain Errors; error 30 is
      // AMOS's own answer for a file that is not the FORM it wants
      // (IffFormLoad +Lib.s:6876 `Rbne L_IffFor`, IffFor +Lib.s:12973
      // `moveq #30,d0`)
      let img
      try {
        img = parseIlbm(bytes)
      } catch {
        throw new AmosError('Bad IFF format', ERR.BAD_IFF)
      }
      if (n !== null && img.width > 0) {
        // CAMG $800 = HAM: open through the 4096-colour path so the
        // compositor decodes the modify chains (InScreenOpen ScOo)
        const colours = img.mode & 0x800 ? 4096 : 1 << img.depth
        rt.openScreen(n, img.width, img.height, colours, (img.mode & 0x8000) | (img.mode & 4))
      }
      const s = scr()
      for (let i = 0; i < Math.min(32, img.palette.length); i++) s.palette[i] = img.palette[i]!
      // Mask Iff: only load the bitplanes selected by the mask (IffMask)
      if (img.width > 0) rt.blit(s, img, 0, 0, true, rt.iffMask)
    },
    'mask iff'(it) {
      // InMaskIff +Lib.s:4336: store the bitplane mask Load Iff obeys
      rt.iffMask = it.evalInt()
    },
    'save iff'(it) {
      // InSaveIff1/2 (+Lib.s:4595, :4601): save the screen as a compressed
      // ILBM; the optional 2nd arg is the compression mode (must be < 3)
      const path = it.evalStr()
      const mode = it.accept(',') ? it.evalInt() : 1
      // InSaveIff2 opens `tst.l ScOnAd(a5) / Rbeq L_ScNOp` (+Lib.s:4603) and
      // only then `cmp.l #3,d3 / Rbcc L_FonCall`, so with no screen open a
      // bad compression mode still answers 47 and not 23
      const s = scr()
      if (mode >>> 0 >= 3) funcCall()
      const camg = (s.hires ? 0x8000 : 0) | (s.laced ? 4 : 0) | (s.ham ? 0x800 : 0) | (s.ehb ? 0x80 : 0)
      const bytes = encodeIlbm({ width: s.width, height: s.height, depth: s.depth, mode: camg, palette: [...s.palette], pixels: s.pixels })
      if (!rt.vfs?.writeFile(path, bytes)) throw new AmosError('disc is write protected', 84)
    },
    save(it) {
      // InSave1/2 +Lib.s:3819: Save "file" = all banks (AmBs container);
      // Save "file",n = bank n alone (AmBk/AmSp/AmIc)
      const path = it.evalStr()
      const n = it.accept(',') ? it.evalInt() : null
      const bytes = n === null ? rt.serializeAllBanks() : rt.serializeBank(n)
      if (!rt.vfs?.writeFile(path, bytes)) throw new AmosError('disc is write protected', 84)
    },
    pload(it) {
      // InPLoad +Lib.s:4225: load the code hunk of an AmigaDOS executable
      // into bank n as a Data bank (n<0 = chip RAM).
      //
      // The name is NOT "Data". +Lib.s:4256 reserves with `Rlea L_BkAsm,0`,
      // so a Ploaded bank is called "Asm     " -- the Data BIT is set, and
      // the name says what the bank holds rather than which bit is on.
      const path = it.evalStr()
      it.expect(',')
      const n = it.evalInt()
      if (n === 0) funcCall()
      const bytes = rt.fs?.read(path)
      if (!bytes) throw new AmosError(`file not found: ${path}`, ERR.FILE_NOT_FOUND)
      const data = extractCodeHunk(bytes)
      if (!data) throw new AmosError('file format not recognised', 95)
      const num = Math.abs(n)
      rt.memBanks.set(num, { kind: 'memory', number: num, memType: n < 0 ? 1 : 0, name: 'Asm', flags: 1, data })
    },
  }

  /** Reserve As ... n,length */
  function reserve(name: string, dataBank: boolean, chip = false): Instr {
    return (it) => {
      const n = it.evalInt()
      it.expect(',')
      rt.reserveBank(n, it.evalInt(), name, dataBank, chip)
    }
  }

  /**
   * BobLim (+W.s:1026), which measures once for the whole bob list.
   *
   * The x edges are snapped DOWN to a multiple of 16 by `and.w #$FFF0,d2`
   * and `and.w #$FFF0,d4`, the blitter's word granularity, and every test
   * after that is word-sized and unsigned. A failure reaches LBbE's `moveq
   * #-1,d0`, which the caller turns into error 23 with `Rbne L_FonCall`.
   *
   * DEFECT: the vertical test is `cmp.w d2,d5 / bls.s LbbE`, which measures
   * the BOTTOM edge against the LEFT one. d3 holds the top edge and appears
   * in no test at all. So `Limit Bob 100,0 To 200,50` is refused for having
   * a bottom edge above x1, and a tall strip down the right of the screen
   * cannot be asked for however the numbers are written.
   */
  function setBobLimit(n: number, x1: number, y1: number, x2: number, y2: number): void {
    // `move.l T_BbDeb(a5),d0 / beq LBbX` returns success before any of this,
    // so with nothing drawn yet the instruction checks nothing and stores
    // nothing — the limits live on the bobs, not beside them
    if (rt.bobs.size === 0) return
    const s = scr()
    const gx1 = x1 & 0xfff0
    const gx2 = x2 & 0xfff0
    const gy2 = y2 & 0xffff
    if (gx2 <= gx1) funcCall()
    if (gy2 <= gx1) funcCall()
    if (gx2 > (s.width & 0xffff)) funcCall()
    if (gy2 > (s.height & 0xffff)) funcCall()
    rt.bobLimits.set(n, { x1: gx1, y1: y1 & 0xffff, x2: gx2, y2: gy2 })
  }

  /**
   * GetFile (+Lib.s:4625) for a channel about to be OPENED.
   *
   * The range is `cmp.l #10,d0 / Rbcc L_FonCall` then `subq.l #1,d0 / Rbmi
   * L_FonCall`, so 1 to 9 and error 23 outside it. GetFile finishes with
   * `move.l FhA(a2),d1`, which sets the flags from the file handle, and OpIn
   * (+Lib.s:5077) reads them straight back: `Rbne L_FilOO`. A channel that
   * already has a handle cannot be opened over the top of itself. FilOO is
   * `moveq #DEBase+17,d0 / Rbra L_GoError` (+Lib.s:12879) — GoError, so no
   * +44, and DEBase is EcEBase+35-1, which puts it at 96.
   */
  /**
   * Anim/Move On, Off and Freeze. See the block comment on 'anim on'.
   *
   * @param act 1 clears the freeze bit, 0 sets it, -1 is DAMAL — the stream
   * is unlinked and freed, not merely stopped.
   */
  function stosOnOff(it: It, streams: ('anim' | 'moveX' | 'moveY')[], act: 1 | 0 | -1): void {
    const n = it.atStmtEnd() ? null : it.evalInt()
    for (const [k, s] of rt.stosSlots) {
      if (n !== null && k !== n) continue
      for (const f of streams) {
        const m = s[f]
        if (!m) continue
        if (act < 0) delete s[f]
        else if (act === 0) m.frozen = true
        else {
          m.frozen = false
          m.on = true
        }
      }
    }
  }

  /**
   * DAdAMAL (+W.s:8160): drop every animation stream attached to an object.
   *
   * It matches on `cmp.l AmAct(a1),d7`, the object's ADDRESS, so one call
   * takes the AMAL program, the Anim and both Moves. A null n is HsOff's
   * sweep of every object of that kind.
   */
  function killObjectAnim(kind: string, n: number | null): void {
    for (const [k, ch] of [...rt.channels]) {
      if (ch.target.kind === kind && (n === null || ch.target.n === n)) rt.channels.delete(k)
    }
    for (const [k, s] of [...rt.stosSlots]) {
      if (s.target.kind === kind && (n === null || s.target.n === n)) rt.stosSlots.delete(k)
    }
  }

  /** Amal On/Off/Freeze, the %0001 stream of the same routine */
  function amalOnOff(it: It, act: 1 | 0 | -1): void {
    const one = it.atStmtEnd() ? null : it.evalInt()
    for (const k of [...rt.channels.keys()]) {
      if (one !== null && k !== one) continue
      const ch = rt.channels.get(k)!
      if (act < 0) rt.channels.delete(k)
      else if (act === 0) ch.frozen = true
      else {
        ch.frozen = false
        ch.on = true
      }
    }
    if (one === null && act !== 0) rt.amalDefaultOn = act > 0
  }

  function openChan(n: number): number {
    if (n <= 0 || n >= 10) funcCall()
    if (rt.fileChans.has(n)) throw new AmosError(ED_RUN_MESSAGES[96]!, 96)
    return n
  }

  function bankPalette(): Instr {
    return (it) => {
      const mask = it.atStmtEnd() ? -1 : it.evalInt()
      // InGetBobPal (+Lib.s:9235) opens `Rbsr L_Bnk.GetBobs / Rbeq
      // L_BkNoRes`, and BkNoRes (+Lib.s:12934) is `moveq #36,d0 / Rbra
      // L_GoError` — straight to GoError, so 36 with no +44, "Bank not
      // reserved". With no bank the port had been doing nothing at all.
      const bank = rt.spriteBank
      if (!bank) throw new AmosError('Bank not reserved', 36)
      const pal = bank.palette
      if (pal) {
        for (let i = 0; i < Math.min(32, pal.length); i++) {
          if (mask & (1 << i)) scr().palette[i] = pal[i]!
        }
      }
    }
  }

  /** Get Bob/Sprite/Icon: [screen,] image, x1,y1 To x2,y2 */
  /**
   * Resolve a Paste Bob / Paste Icon image number, raising what AMOS raises.
   *
   * The two keywords share a preamble: `move.l d3,d1 / Rbmi L_FonCall / Rbsr
   * L_AdBob` (+Lib.s:12726, +Lib.s:12735). AdBob (+Lib.s:12794) opens
   * `and.l #$3FFF,d1 / Rbeq L_FonCall`, because bits 14 and 15 are the
   * Hrev/Vrev flags: the number is the low 14 bits and zero is refused however
   * the flags are set.
   *
   * `Bnk.AdBob` (+Lib.s:8069) then answers zero two different ways, and
   * `AdBErr` (+Lib.s:12816) tells them apart on d1, its documented "Max de
   * bobs". No bank at all leaves `moveq #0,d1` standing and reaches BkNoRes,
   * `moveq #36,d0 / Rbra L_GoError`, error 36 "Bank not reserved". A number
   * past `move.w (a1),d1 / cmp.w d1,d0 / bhi.s .Rien` leaves d1 set and gets
   * `moveq #EcEBase+30-1,d0`, error 74. That constant is written out longhand
   * there, which is a third witness to the +44 that EcWiErr applies elsewhere.
   *
   * Only the last step differs between the two: a slot inside the bank that
   * holds no image is `tst.l (a2) / Rbne L_Paste / moveq #24,d0 / Rbra
   * L_EcWiErr` for a bob, error 68 "Bob not defined", and `moveq #30,d0` for
   * an icon, error 74. Read raw those say "Out of memory" and "Bad IFF
   * format", which is how you know the +44 belongs there.
   */
  function adBob(n: number, kind: 'sprite' | 'icon'): ObjectBank {
    // the mask is not a range check: bits 14 and 15 are Hrev/Vrev, so $4000
    // is all flags and no number and fails the same way 0 does
    if ((n & 0x3fff) === 0) funcCall()
    const bank = kind === 'icon' ? rt.iconBank : rt.spriteBank
    if (!bank) throw new AmosError('Bank not reserved', 36)
    if ((n & 0x3fff) > bank.images.length) throw new AmosError('Icon not defined', 74)
    return bank
  }

  function pasteImage(n: number, kind: 'sprite' | 'icon'): BankImage {
    // the Rbmi belongs to the paste keywords, not to AdBob: Make Mask has no
    // sign check and `and.l #$3FFF` turns its -1 into 16383
    if (n < 0) funcCall()
    const img = adBob(n, kind).retourne(n)
    if (!img) {
      if (kind === 'icon') throw new AmosError('Icon not defined', 74)
      throw new AmosError('Bob not defined', 68)
    }
    return img
  }

  /**
   * Make Mask / No Mask, and their icon pair.
   *
   * The no-argument form is not "image 1". `InMakeMask0` (+Lib.s:12484) and
   * `InNoMask0` (+Lib.s:12509) both go `moveq #1,d1 / Rbsr L_AdBob / Rbne
   * L_GoError / subq.w #1,d5`, and d5 is the bank COUNT that AdBob left there
   * (`move.w d1,d5`, d1 being Bnk.AdBob's documented "Max de bobs"). So
   * `dbra d5,.Loop` in MkMa1 and NoMa1 walks the whole bank, which is what the
   * manual promises: "make mask for all icons", "remove mask of all icons".
   * The one-argument forms set `moveq #0,d5` and walk exactly one.
   *
   * Both loops open `tst.l (a2) / beq.s .Skip`, so a hole in the bank is
   * stepped over in silence. Only the number itself can raise, through AdBob.
   */
  function maskAll(kind: 'sprite' | 'icon', opaque: boolean): Instr {
    return (it) => {
      const all = it.atStmtEnd()
      const n = all ? 1 : it.evalInt()
      const bank = adBob(n, kind)
      if (all) for (const im of bank.images) im.opaque = opaque
      else {
        const img = bank.image(n)
        if (img) img.opaque = opaque
      }
    }
  }

  function getObj(kind: 'sprite' | 'icon'): Instr {
    return (it) => {
      const args: number[] = [it.evalInt()]
      while (it.accept(',')) {
        args.push(it.evalInt())
        if (it.nm() === 'to') break
      }
      it.expect('to')
      const x2 = it.evalInt()
      it.expect(',')
      const y2 = it.evalInt()
      let s = scr()
      let img: number
      let x1: number
      let y1: number
      if (args.length === 4) {
        const sc = rt.screens.get(args[0]!)
        if (!sc) throw new AmosError(`screen not opened: ${args[0]}`, 47)
        s = sc
        ;[img, x1, y1] = [args[1]!, args[2]!, args[3]!]
      } else if (args.length === 3) {
        ;[img, x1, y1] = [args[0]!, args[1]!, args[2]!]
      } else {
        throw new AmosError('Get Bob: wrong arguments')
      }
      /*
       * Ritoune (+Lib.s:12668) is the argument reader all three share, and it
       * refuses a negative coordinate before it measures anything: `move.l
       * d3,d5 / Rbmi L_FonCall / move.l (a3)+,d4 / Rbmi L_FonCall / move.l
       * (a3)+,d3 / Rbmi L_FonCall / move.l (a3)+,d2 / Rbmi L_FonCall`. Only
       * then the size: `cmp.w EcTx(a0),d4 / Rbhi` and `cmp.w EcTy(a0),d5 /
       * Rbhi`, then `sub.w d2,d4 / Rbls` and `sub.w d3,d5 / Rbls`.
       *
       * The port had the last four. Without the first four `Get Bob 1,-5,-5
       * To 10,10` grabbed from off the left of the screen, because a negative
       * corner still satisfies x2 > x1.
       */
      if (x1 < 0 || y1 < 0 || x2 < 0 || y2 < 0) funcCall()
      if (x2 <= x1 || y2 <= y1 || x2 > s.width || y2 > s.height) funcCall()
      // and GS/GI open `move.l (a3),d0 / Rble L_FonCall` (+Lib.s:12590,
      // +Lib.s:12638), so the image number is checked after the coordinates
      if (img <= 0) funcCall()
      const bank = kind === 'icon' ? (rt.iconBank ??= rt.newObjectBank()) : rt.needSpriteBank()
      // a freshly grabbed icon has no mask either, for the same reason
      const grabbed = rt.grab(s, x1, y1, x2, y2)
      if (kind === 'icon') grabbed.opaque = true
      bank.setImage(img, grabbed)
    }
  }

  /** Del Bob/Sprite/Icon n[ To m] — splice+compact (Bnk.DelBob +Lib.s:8372) */
  function delObj(kind: 'sprite' | 'icon'): Instr {
    return (it) => {
      const n = it.evalInt()
      const m = it.accept('to') ? it.evalInt() : n
      const bank = kind === 'icon' ? rt.iconBank : rt.spriteBank
      if (!bank) throw new AmosError('bank not reserved')
      /*
       * IDIc3 (+Lib.s:2382), shared by Del Bob, Del Sprite and Del Icon:
       *
       *	move.l	(a3)+,d1	the FIRST written argument
       *	Rble	L_FonCall
       *	move.l	d3,d0		the second
       *	Rble	L_FonCall
       *	cmp.l	d1,d0
       *	Rbhi	L_FonCall
       *
       * so both have to be 1 or more, and the second may not exceed the
       * first. Bnk.DelBob then deletes every image whose number is `>= d0`
       * and `<= d1` (+Lib.s:8357), and d0 is the SECOND argument — the range
       * runs from the second to the first, the reverse of how `Del Sprite
       * 5 To 10` reads. Written that way round it is error 23; the range it
       * actually deletes is 10 To 5. The port bounded neither end.
       */
      if (n <= 0 || m <= 0 || m > n) funcCall()
      if (!bank.delete(m, n)) {
        if (kind === 'icon') rt.iconBank = null
        else rt.spriteBank = null
      }
    }
  }

  /** Ins Bob/Sprite/Icon n — single blank insert (Bnk.InsBob +Lib.s:8316) */
  /*
   * The guard Wind Move and Wind Size share. InWindmove (+Lib.s:13081) and
   * InWindsize (+Lib.s:13095) both read their pair through `move.l d3,d2 /
   * Rbmi L_FonCall / move.l (a3)+,d1 / Rbmi L_FonCall`, then call through
   * `WiCall / Rbne L_EcWiErr`.
   *
   * WiMove (+W.s:13871) and WiSize (+W.s:13941) both open `tst.w
   * WiNumber(a5) / bne.s / moveq #18,d0 / bra WOut`, so window 0 can be
   * neither moved nor resized. 18 plus EcWiErr's 44 is 62, and the message
   * table settles it: nothing at all sits at 18, and 62 reads "Text window 0
   * can't be closed".
   */
  function windParams(a: number, b: number): void {
    if (a < 0 || b < 0) funcCall()
    if (scr().curWin.n === 0) throw new AmosError(ED_RUN_MESSAGES[62]!, 62)
  }

  function insObj(kind: 'sprite' | 'icon'): Instr {
    return (it) => {
      const n = it.evalInt()
      /*
       * InInsSprite (+Lib.s:2334) and InInsIcon (+Lib.s:2347) open `Rbsr
       * L_Bnk.GetBobs / Rbeq L_BkNoRes / move.l d3,d0 / Rble L_FonCall`, in
       * that order. Ins Bob does not make a bank, it needs one: with none
       * reserved it is error 36, and the port used to answer by quietly
       * creating an empty bank and inserting into it.
       */
      const bank = kind === 'icon' ? rt.iconBank : rt.spriteBank
      if (!bank) throw new AmosError('Bank not reserved', 36)
      if (n <= 0) funcCall()
      bank.insert(n)
    }
  }

  function polyish(close: boolean): Instr {
    return (it) => {
      const s = scr()
      const pts: Array<[number, number]> = []
      if (it.accept('to')) {
        pts.push([s.grX, s.grY])
      } else {
        const [x, y] = pair(it)
        pts.push([x, y])
        it.expect('to')
      }
      do {
        pts.push(pair(it))
      } while (it.accept('to'))
      if (close) {
        // Polygon is filled (InitArea/AreaEnd)
        s.fillPolygon(pts)
      } else {
        for (let i = 0; i + 1 < pts.length; i++) s.line(pts[i]![0], pts[i]![1], pts[i + 1]![0], pts[i + 1]![1])
      }
      const last = pts[pts.length - 1]!
      s.grX = last[0]
      s.grY = last[1]
    }
  }
}

/** raw-parsed runtime functions (their args use To syntax) */
/**
 * What the Test pass poked into an equate token's own six inline bytes:
 * a longword value, a type digit and a flag byte whose bit 7 says it is
 * there (`Equ_Verif` +Verif.s:1308).
 *
 * It stays in the source, which is the whole design. Equates.Doc: "once the
 * program has been tested, AMOS Pro will not need to load the Equate file",
 * so a program reaches a machine that never had one. That is why these read
 * the token and never the file, and why 123 corpus lines using `Equ` name
 * equates that are in nobody's shipped file.
 */
function equPayload(tok: Tok): { value: number; type: number } {
  const equ = tok.kind === 'core' ? tok.equ : undefined
  if (equ === undefined || !equ.resolved) throw new AmosError('Equate not defined')
  return equ
}

/** `("NAME")`, which the runtime steps over without looking (`FnEqu` +ILib.s:5881) */
function skipEquName(it: It): void {
  it.expect('(')
  if (it.tok()?.kind !== 'str') throw new AmosError('Equate not defined')
  it.advance()
  it.expect(')')
}

/**
 * `GStruc` (+ILib.s:6007): base address plus the equate's offset.
 *
 * The base is an ordinary integer expression, so `Struc(BANKS+4,"…")` works;
 * the name is a string CONSTANT that the verifier has already resolved, and
 * is skipped rather than evaluated.
 */
function strucAddr(it: It, tok: Tok): { addr: number; type: number } {
  const { value, type } = equPayload(tok)
  it.expect('(')
  const base = it.evalInt()
  it.expect(',')
  if (it.tok()?.kind !== 'str') throw new AmosError('Equate not defined')
  it.advance()
  it.expect(')')
  return { addr: (base + value) | 0, type }
}

/** `btst #0,d1 / bne AdrErr`, which the two byte arms do not do */
function strucCheck(addr: number, type: number): void {
  if (type !== 0 && type !== 3 && (addr & 1) !== 0) throw new AmosError('Address error', 25)
}

export function makeRawFunctions(rt: Runtime): Record<string, (it: It, tok: Tok) => import('../interp/values').Value> {
  return {
    /**
     * `FnBtst` (+ILib.s:5655) is `addq.w #2,a6` past the open bracket and then
     * BsRout, so it reads its target the same way the three instructions do
     * and answers -1 or 0.
     */
    btst: (it) => {
      it.expect('(')
      const n = it.evalInt()
      if (n < 0) funcCall()
      it.expect(',')
      const tg = bitTarget(it, rt, 1)
      it.expect(')')
      return VI(tg.get() & (1 << (n & (tg.mem ? 7 : 31))) ? -1 : 0)
    },
    /**
     * `FnEqu` (+ILib.s:5881), which is `Equ` and `Lvo` both: `Ope_Equ` and
     * `Ope_LVO` (+Verif.s:2955) differ only in the "_LVO" the verifier puts
     * in front of the name, so by run time there is one routine.
     */
    equ: (it, tok) => {
      const { value } = equPayload(tok)
      skipEquName(it)
      return VI(value)
    },
    lvo: (it, tok) => {
      const { value } = equPayload(tok)
      skipEquName(it)
      return VI(value)
    },
    /**
     * `FnStruc` (+ILib.s:5923, $768c in AMOSPro.Lib). Type 0-2 is a signed
     * byte, word and long, 3-5 the unsigned three, and 6 -- a pointer to a
     * string -- reads as an unsigned long.
     */
    struc: (it, tok) => {
      const { addr, type } = strucAddr(it, tok)
      strucCheck(addr, type)
      const m = rt.resolveAddr(addr)
      if (!m) throw new AmosError('Address error', 25)
      const at = (i: number): number => m.data[m.off + i] ?? 0
      if (type === 0) return VI((at(0) << 24) >> 24)
      if (type === 3) return VI(at(0))
      if (type === 1) return VI((((at(0) << 8) | at(1)) << 16) >> 16)
      if (type === 4) return VI((at(0) << 8) | at(1))
      return VI(((at(0) << 24) | (at(1) << 16) | (at(2) << 8) | at(3)) >>> 0)
    },
    /**
     * `FnStrucD` (:5993). The field holds a pointer to a C STRING, which is
     * what an exec structure holds: `LN_NAME` is one. `A0ToChaine`
     * (+Lib.s:3720) counts to the zero byte and copies that many characters.
     * A null pointer reads as empty rather than as an address error.
     */
    'struc$': (it, tok) => {
      const { addr, type } = strucAddr(it, tok)
      strucCheck(addr, type)
      const m = rt.resolveAddr(addr)
      if (!m) throw new AmosError('Address error', 25)
      const at = (i: number): number => m.data[m.off + i] ?? 0
      const ptr = ((at(0) << 24) | (at(1) << 16) | (at(2) << 8) | at(3)) >>> 0
      if (ptr === 0) return VS('')
      const p = rt.resolveAddr(ptr)
      if (!p) throw new AmosError('Address error', 25)
      let out = ''
      for (let i = p.off; i < p.data.length && p.data[i] !== 0; i++) out += String.fromCharCode(p.data[i]!)
      return VS(out)
    },
    array(it) {
      // FnArray +ILib.s:4103: the array's data address. Int/float arrays
      // get a live arena block (big-endian cells, FFP floats) that Peek/
      // Poke/Deek/Doke reach; the dialog engine resolves the same
      // address for its AR/AS zones. String arrays hold pointers on the
      // 68k — they keep an opaque handle (NOTES).
      it.expect('(')
      const t = it.tok()
      if (t?.kind !== 'var') throw new AmosError('array expected')
      const key = varKey(t.name, t.flags)
      const type = varType(t.flags)
      const arr = it.parseArrayRef()
      it.expect(')')
      if (type === 2) {
        for (const [h, known] of rt.dialogArrays) if (known === arr) return VI(h)
        const handle = 0x10000 + rt.dialogArrays.size
        rt.dialogArrays.set(handle, arr)
        return VI(handle)
      }
      const addr = rt.varptrArray(key, arr, type)
      rt.dialogArrays.set(addr, arr)
      return VI(addr)
    },
    'frame load'(it) {
      // =Frame Load(f To dest[,n]) — FnFormLoad +Lib.s:4412: n>0; a
      // dest under 1024 reserves a Work bank "Iff" sized by
      // IffFormSize; returns the number of frames loaded
      it.expect('(')
      const f = it.evalInt()
      it.expect('to')
      const dest = it.evalInt()
      const n = it.accept(',') ? it.evalInt() : 1
      it.expect(')')
      if (n <= 0 || dest <= 0) funcCall()
      const c = rt.chan(f)
      if (c.mode !== 'in') throw new AmosError('file type mismatch', 98)
      let view: { data: Uint8Array; off: number } | null
      if (dest < 1024) {
        rt.memBanks.delete(dest)
        const { bytes } = formSize(c.data, c.pos, n)
        rt.reserveBank(dest, bytes, 'Iff', false)
        view = { data: rt.memBanks.get(dest)!.data, off: 0 }
      } else {
        view = rt.resolveWrite(dest)
      }
      if (!view) return VI(0)
      const r = formLoad(c.data, c.pos, n, view.off === 0 ? view.data : view.data.subarray(view.off))
      c.pos = r.pos
      return VI(r.frames)
    },
    'frame length'(it) {
      // =Frame Length(f[,n]) — FnFormLength2 +Lib.s:4435: bytes for the
      // next n FORMs (+4 for AenD) without moving the position
      it.expect('(')
      const f = it.evalInt()
      const n = it.accept(',') ? it.evalInt() : 1
      it.expect(')')
      if (n < 0 || n >= 32768) funcCall()
      const c = rt.chan(f)
      if (c.mode !== 'in') throw new AmosError('file type mismatch', 98)
      return VI(formSize(c.data, c.pos, n).bytes)
    },
    'frame play'(it) {
      // =Frame Play(ad,n[,screen]) — FnFormPlay3 +Lib.s:4463: plays n
      // FORMs from the buffer; the screen argument creates the screen
      // at each BODY; returns the address after the played frames
      it.expect('(')
      const ad = it.evalInt()
      it.expect(',')
      const n = it.evalInt()
      const param = it.accept(',') ? it.evalInt() : null
      it.expect(')')
      return VI(framePlaySkip(rt, ad, n, param, false))
    },
    'frame skip'(it) {
      // =Frame Skip(ad[,n]) — FnFormSkip2 +Lib.s:4489: bit 30 set, no
      // drawing; returns the advanced address
      it.expect('(')
      const ad = it.evalInt()
      const n = it.accept(',') ? it.evalInt() : 1
      it.expect(')')
      return VI(framePlaySkip(rt, ad, n, null, true))
    },
    varptr(it) {
      // FnVarPtr +ILib.s:4058: numbers -> the address of the 4-byte cell
      // (arena slots that sync/flush through Peek/Poke, floats in FFP);
      // strings -> the character data, length word at -2, snapshotted
      // like the 68k's moving string heap
      it.expect('(')
      const tg = it.parseTarget()
      it.expect(')')
      if (tg.type === 2) {
        return VI(rt.varptrString(() => str(tg.get()), (v) => tg.set(VS(v))))
      }
      const type = tg.type
      // An ARRAY ELEMENT resolves inside the whole-array block, so the
      // elements above it are reachable by walking the pointer. That is what
      // an array is on the machine — one contiguous allocation — and it is the
      // only reason anyone takes Varptr of one: GameSupport's own manual has
      // `Gspasscode("Testing",Varptr(A(0)),4)`, which reads four longwords
      // from it. This used to hand back a lone four-byte cell per element,
      // so A(0)'s pointer plus four was not A(1) and every such walk read
      // whatever the arena had put next to it.
      if (tg.array && tg.index !== undefined) {
        return VI(rt.varptrArrayElement(tg.key!.replace(/\[.*$/, ''), tg.array, type, tg.index))
      }
      return VI(rt.varptrScalar(tg.key ?? 'anon', type, () => num(tg.get()), (v) => tg.set(type === 1 ? VF(v) : VI(v))))
    },
    hunt(it) {
      // FnHunt +Lib.s:2643: the start goes through Bnk.OrAdr (a bank
      // number names its bank), the end address is raw; a match may
      // START before the end and extend past it (only the candidate
      // start is compared against the end)
      it.expect('(')
      const start = it.evalInt()
      it.expect('to')
      const finish = it.evalInt()
      it.expect(',')
      const needle = it.evalStr()
      it.expect(')')
      const bankForm = start >= 0 && start < 0x10000
      const base = bankForm ? rt.bankBase(start) : start
      const m = rt.bankOrAddr(start)
      if (!m || needle === '') return VI(0)
      const span = Math.min(finish - base, m.data.length - m.off)
      outer: for (let i = 0; i < span; i++) {
        for (let k = 0; k < needle.length; k++) {
          if (m.data[m.off + i + k] !== (needle.charCodeAt(k) & 0xff)) continue outer
        }
        return VI(base + i)
      }
      return VI(0)
    },
  }
}

export function makeFunctions(rt: Runtime): Record<string, Func> {
  const scr = (): Screen => rt.screen
  /**
   * FnAm1 (+Lib.s:11920) is `move.l d3,d1 / Rbmi L_FonCall / cmp.l #64,d1 /
   * Rbcc L_FonCall`, and Movon, Chanan and Chanmv each open `Rbsr L_FnAm1`
   * (+Lib.s:11895, 11904, 11913) before they look at anything.
   */
  /** EcToD1's screen pick, shared by the four coordinate converters */
  const xyConv = (
    a: readonly import('../interp/values').Value[],
    pick: (s: Screen, v: number) => number,
  ): import('../interp/values').Value => {
    const v = int(a[a.length - 1]!)
    if (a.length < 2) return VI(pick(scr(), v))
    const d3 = int(a[0]!) + 1
    if (d3 < 0) return VI(ENT_NUL)
    if (d3 === 0) return VI(pick(scr(), v))
    const s = rt.screens.get(d3 - 1)
    if (!s) throw new AmosError(ED_RUN_MESSAGES[47]!, 47)
    return VI(pick(s, v))
  }
  const amChannel = (n: number): number => {
    if (n < 0 || n >= 64) funcCall()
    return n
  }
  /** FPn's range check (+Lib.s:14002), shared by Pen$ and Paper$ */
  const fpn = (n: number): number => {
    if (n >>> 0 >= 32) throw new AmosError(ED_RUN_MESSAGES[60]!, 60)
    return n
  }
  /** HsActAd's range check (+W.s:11399), shared by X Sprite, Y Sprite, I Sprite */
  const hwSprite = (n: number): { x: number; y: number; image: number } | undefined => {
    if (n < 0 || n >= 64) funcCall()
    return rt.hwSprites.get(n)
  }

  /*
   * FnXBob, FnYBob and FnIBob (+Lib.s:12012, 12022, 12058) are the same four
   * instructions as their sprite counterparts: `move.l d3,d1 / Rbmi
   * L_FonCall / SyCall XYBob / Rbne L_FonCall`.
   *
   * XYBob is BobXY (+W.s:801), which opens `bsr BobAd / bne.s BobxyE`. BobAd
   * (+W.s:1163) walks T_BbDeb's list comparing BbNb, and falls out of the
   * walk at AdBb1 with `moveq #1,d0`. So a bob that was never made is an
   * error, and NOT the zero an unused hardware sprite reads back — the
   * sprites are a fixed table of 64, the bobs are a list of what exists.
   *
   * FonCall (+Lib.s:12958) is `moveq #23,d0 / Rbra L_GoError`. It reaches
   * GoError rather than EcWiErr, so there is no 44 to add: it really is 23.
   */
  const bobXY = (n: number): { x: number; y: number; image: number } => {
    if (n < 0) funcCall()
    const b = rt.bobs.get(n)
    if (!b) funcCall()
    return b
  }
  return {
    /**
     * =Arexx Exist("port") --- `FnArexxExist` (+Lib.s:14996), which is
     * `Arx_RegisterPort` with d0 = 0: a LOOKUP rather than a registration.
     * Non-zero when a public port of that name is there. Names are
     * case-sensitive, as exec's FindPort is.
     */
    'arexx exist'(_, a) {
      const name = a[0]!.k === 'str' ? a[0]!.s : ''
      return VI(rt.rexx.exists(name) ? -1 : 0)
    },

    /**
     * =Arexx --- `FnArexx` (+Lib.s:15035). Three answers, not two: 0 for no
     * message, 1 for a message, and 2 for a message whose rm_Action has
     * RXFF_RESULT set, meaning the sender wants a result STRING and not just
     * a return code. A program branches on 2 to decide whether to bother
     * building one.
     */
    'arexx'() {
      return VI(arexxPoll(rt))
    },

    /**
     * =Arexx$(n) --- `FnArexxD` (+Lib.s:15077). Argument n of the message
     * being held, 0 to 15 (`cmp.l #16,d3 / Rbcc L_FonCall`). The empty string
     * when no message is held, when that argument slot is null, or when its
     * `ra_Length` is zero -- three separate `Rbeq L_Ret_ChVide` arms for what
     * a program sees as one answer.
     */
    'arexx$'(_, a) {
      const n = int(a[0]!)
      if (n < 0 || n >= 16) funcCall()
      const m = rt.arexx.held
      return VS(m ? (m.args[n] ?? '') : '')
    },

    /**
     * =Port(CHANNEL) --- `FnPort` (+Lib.s:5021). `GetFile` first, so a
     * channel that is not open raises; then `btst #2,FhT(a2)` refuses one
     * that was not opened by `Open Port` -- a file-type mismatch, not a quiet
     * zero. Then `WaitForChar` for 50 microseconds: nothing waiting answers
     * TRUE (-1) through `L_FnTrue`, and otherwise ONE byte is Read and
     * returned.
     *
     * So -1 is "no character yet" and 0 to 255 is the character, which is why
     * a program loops on it rather than testing for zero.
     *
     * `GetFile` is `cmp.l #10,d0 / Rbcc L_FonCall / subq.l #1,d0 / Rbmi
     * L_FonCall` (+Lib.s:4627), so it answers 23 outside 1 to 9 before it
     * answers 97 for a channel nobody opened. Reading the map directly gave
     * `=Port(0)` the wrong one of the two.
     */
    'port'(_, a) {
      const c = rt.chan(int(a[0]!))
      if (!c.port) throw new AmosError('file type mismatch', 98)
      if (c.serial) {
        const got = c.serial.read()
        return VI(got.length > 0 ? got[0]! & 0xff : -1)
      }
      if (c.pos >= c.data.length) return VI(-1)
      return VI(c.data[c.pos++]! & 0xff)
    },

    /**
     * =Dev Base(CHANNEL) --- `FnDevBase` (+Lib.s:3312): the first long of the
     * slot, which is the IORequest pointer. A channel that was never opened
     * answers zero, because `Dev.GetA2` only bounds-checks -- the "device not
     * opened" error belongs to `Dev.GetIO`, which this does not go through.
     *
     * The address is real here: each channel owns a 256-byte slice of the
     * `Dev IORequests` region, so a program can Doke io_Length, io_Data and
     * io_Offset into it before `Dev Do` and the write lands where the
     * transfer reads it.
     */
    'dev base'(_, a) {
      const c = devSlotOf(rt.dev, int(a[0]!))
      return VI(c ? c.addr : 0)
    },

    /**
     * =Dev Check(CHANNEL) --- `FnDevCheck` (+Lib.s:3356). GetIO first, so a
     * closed channel raises 141 rather than reporting "not ready"; then a
     * channel that has never issued a function answers -1, the source's own
     * "Simule le TRUE".
     */
    'dev check'(_, a) {
      const c = devSlotOf(rt.dev, int(a[0]!))
      if (!c) throw ioError(141)
      return VI(devCheckIO(c.slot))
    },

    point(_, a) {
      // RPoint +Lib.s:9557 calls GrXY, so =Point(x,y) moves the graphics
      // cursor to x,y as a side effect
      const [x, y] = [a[0], a[1]]
      if (x === undefined || y === undefined) throw new AmosError('wrong number of arguments')
      const s = scr()
      const c = s.point(int(x), int(y))
      s.grX = int(x)
      s.grY = int(y)
      return VI(c)
    },
    screen(_, a) {
      void a
      // FnScreen (+Lib.s:9137) is `move.w ScOn(a5),d3 / subq.w #1,d3 /
      // ext.l d3`, and ScOn is a 1-based slot that Screen Close leaves at
      // zero once the last screen goes (+Lib.s:8980). So the answer with
      // nothing open is -1. The port returned currentIndex, which
      // closeScreen falls back to 0, and 0 is a legal screen number.
      return VI(rt.screens.size === 0 ? -1 : rt.currentIndex)
    },
    'screen width'(_, a) {
      // FnScreenWidth0/1 +Lib.s:8749: EcTx bitmap width; an explicit
      // unopened screen number is an error, not a fallback
      return VI(screenArg(rt, a).width)
    },
    'screen height'(_, a) {
      return VI(screenArg(rt, a).height)
    },
    'screen colour'(_, a) {
      void a
      // FnScreenColour (+Lib.s:8777) reads EcNbCol, then
      // `btst #3,EcCon0(a0) / beq.s .Skip / move.l #4096,d3`. btst against
      // memory is byte-sized, so bit 3 of the high byte of BPLCON0 is bit 11,
      // HAM. A HAM screen answers 4096 whatever its six planes hold.
      const s = scr()
      return VI(s.ham ? 4096 : s.nColors)
    },
    colour(_, a) {
      if (a.length !== 1) throw new AmosError('wrong number of arguments')
      return VI(scr().palette[int(a[0]!) & 31]!)
    },
    // FnXGr (+Lib.s:9641) and FnYGr (+Lib.s:9650) are `tst.w ScOn(a5) / Rbeq
    // L_ScNOp` and then 36(a0) and 38(a0) of the RastPort, which is the
    // graphics cursor GrXY moves
    xgr() {
      return VI(scr().grX)
    },
    ygr() {
      return VI(scr().grY)
    },
    lowres() {
      return VI(0)
    },
    hires() {
      return VI(0x8000)
    },
    laced() {
      return VI(0x4)
    },
    /**
     * =X Screen(x) / =Y Screen(y) / =X Hard(x) / =Y Hard(y) --- `SyCall XyScr`
     * and `SyCall XyHard` (+Lib.s:10743 onwards), which are `CXyScr` and
     * `CXyHard` in +W.s.
     *
     * These four wrote the conversion out longhand with 128 and 50 in it,
     * where the routine they name reads `EcWx(a0)` and `EcWy(a0)` --- the
     * screen's own display position. `Screen Display` moves that, so the
     * keywords disagreed with `Screen.hardToScreenX` beside them and with
     * AMAL's XS/YS/XH/YH, which have gone through the helper all along. See
     * ./screen.ts for the routines and for why the two directions are not
     * inverses.
     *
     * The optional first argument is the screen number; `a[a.length - 1]` is
     * the coordinate either way, and `scr()` is already the right screen
     * because the two-argument form selected it.
     */
    /*
     * X Screen, Y Screen, X Hard and Y Hard all convert against a NAMED
     * screen when given one, and the port had been converting against the
     * current one whatever it was told.
     *
     * FnXHard2 (+Lib.s:10754) reads the coordinate out of d3 and then pulls
     * the screen off (a3) and does `addq.w #1,d3`; the one-argument forms
     * set d3 to 0 outright. EcToD1 (+W.s:10755) reads that biased number:
     * 0 is the current screen, positive indexes T_EcAdr at `-4(a0,d3.w)`
     * which is screen d3-1, and a slot holding nothing falls to EcToD3's
     * `moveq #3,d0`, which the caller's `Rbne L_EcWiErr` makes 47.
     *
     * The bias is visible from BASIC. `tst.w d3 / bmi.s EcToD4` measures
     * the number AFTER the +1, so screen -1 arrives as 0 and means the
     * current screen; only -2 and below reach EcToD4, which abandons the
     * conversion and answers EntNul rather than raising anything.
     */
    'x screen'(_, a) {
      return xyConv(a, (s, v) => s.hardToScreenX(v))
    },
    'y screen'(_, a) {
      return xyConv(a, (s, v) => s.hardToScreenY(v))
    },
    'x hard'(_, a) {
      return xyConv(a, (s, v) => s.screenToHardX(v))
    },
    'y hard'(_, a) {
      return xyConv(a, (s, v) => s.screenToHardY(v))
    },
    'screen base'() {
      // FnScreenBase +Lib.s:8769: ScOnAd — the current screen's control
      // block (the Ec structure), mapped read-only so Deek/Leek walks work.
      // GetScreen0 (+Lib.s:8799) is `move.l ScOnAd(a5),d0 / Rbeq L_ScNOp`,
      // so with nothing open this is an error and not an address; the port's
      // screenCtrlAddr is arithmetic and would answer for a closed slot.
      void rt.screen
      return VI(rt.screenCtrlAddr(rt.currentIndex) | 0)
    },
    logic(_, a) {
      // FnLogic0/1 (+Lib.s:10422) sets bit 31 and clears bit 30 on the
      // argument and touches nothing else, so the low bits are the screen
      // number the caller wrote. Masking them to a byte loses the one value
      // that matters: Logic(-1) is $BFFFFFFF, the same "current screen" the
      // bare form returns from `moveq #-1,d3 / bclr #30,d3`.
      if (a.length === 0) return VI(0xbfffffff | 0)
      return VI(((int(a[0]!) | 0x80000000) & ~0x40000000) | 0)
    },
    physic(_, a) {
      // FnPhysic0/1 (+Lib.s:10409): both bits set, and bare is a plain -1
      if (a.length === 0) return VI(-1)
      return VI((int(a[0]!) | 0xc0000000) | 0)
    },
    'text length'(_, a) {
      // TextLength() with the set font: sum of per-char advances
      return VI(scr().measureText(str(a[0]!)))
    },
    'text styles'() {
      // FnTextStyle +Lib.s:9869: the rastport SoftStyle byte
      return VI(scr().textStyle)
    },
    'frame param'(_, a) {
      // FnFormParam +Lib.s:4587: the last DLTA's ANHD relative time
      void a
      return VI(rt.iffReturn)
    },
    'sprite base'(_, a) {
      return VI(objBase(rt, 'sprites', int(a[0]!)))
    },
    // ---- machine memory (AvailMem) ----
    // The pool sizes and the arithmetic are exec's (../amiga/exec.ts); the
    // Runtime supplies what it has allocated. These used to inline
    // `CHIP_TOTAL - rt.chipUsed()` rather than call rt.chipFree(), so there
    // were two copies of the same subtraction free to drift apart.
    'chip free'(_, a) {
      // FnChipFree +Lib.s:2481 = AvailMem(MEMF_CHIP)
      void a
      return VI(rt.chipFree())
    },
    'fast free'(_, a) {
      // FnFastFree +Lib.s:2488 = AvailMem(MEMF_FAST)
      void a
      return VI(rt.fastFree())
    },
    free(_, a) {
      // FnFree +Lib.s:13571 garbage-collects then reports TabBas-HiChaine,
      // the space left for variables and strings — not machine memory. There
      // is no fixed variable region here, so report what is left of a nominal
      // one after the Varptr arena in use.
      void a
      return VI(Math.max(0, Runtime.VARIABLE_SPACE - rt.arenaBytes()))
    },
    'icon base'(_, a) {
      return VI(objBase(rt, 'icons', int(a[0]!)))
    },
    'amos here'(_, a) {
      // FnAmosHere = AMOS_WB(-1): is the AMOS display in front? `order` runs
      // back to front, so this asks who owns the last entry -- see
      // Runtime.SCREEN_SLOTS for the partition
      void a
      return VI(rt.amosInFront() ? -1 : 0)
    },
    // =Prg First$ and =Dev First$ are the SAME routine on the 68k
    // (FnPrgFirst/FnDevFirst +Lib.s:5510 both go through DevAcc/FillDev):
    // they enumerate the mounted devices and assigns
    'dev first$'(_, a) {
      return VS(devFirst(rt, a.length > 0 ? str(a[a.length - 1]!) : '*'))
    },
    'dev next$'(_, a) {
      void a
      return VS(devNext(rt))
    },
    'prg first$'(_, a) {
      return VS(devFirst(rt, a.length > 0 ? str(a[a.length - 1]!) : '*'))
    },
    'prg next$'(_, a) {
      void a
      return VS(devNext(rt))
    },
    'text base'() {
      // the graphics font's tf_Baseline (topaz 8 = 6)
      return VI(scr().font?.baseline ?? 6)
    },
    picture(_, a) {
      // FnPicture +Lib.s:4343: a legacy AMOS 1.3 constant, always 127
      void a
      return VI(127)
    },
    windon(_, a) {
      void a
      return VI(scr().curWin.n)
    },
    'x curs'(_, a) {
      void a
      return VI(scr().curX)
    },
    'y curs'(_, a) {
      void a
      return VI(scr().curY)
    },
    /*
     * FnZoneD (+Lib.s:14138) is `tst.l d3 / Rbeq L_WFonCall / cmp.l #255-48,d3
     * / Rbcc L_WFonCall`, so 1 to 206 and error 60 -- the same WFonCall
     * Repeat$ raises, not the catch-all 23 the port used.
     *
     * Both escapes came out numbered, and only the closing one is. FinRpt
     * (+Lib.s:14152) is shared with Border$ and Repeat$, and it writes the
     * digit once: `add.b #"0",d3 / move.b d3,6(a0)`. Offset 6 is the second
     * template's digit -- ChZon is `dc.b 27,"Z0",0,27,"Z0",0` -- so the
     * leading escape keeps the "0" it was assembled with. Border$ already
     * had that right eight lines away.
     */
    'zone$'(_, a) {
      const text = str(a[0]!)
      const n = int(a[1]!)
      if (n < 1 || n >= 207) throw new AmosError(ED_RUN_MESSAGES[60]!, 60)
      return VS('\x1bZ0' + text + '\x1bZ' + String.fromCharCode(48 + n))
    },

    // ---- objects ----
    'x bob'(_, a) {
      return VI(bobXY(int(a[0]!)).x)
    },
    'y bob'(_, a) {
      return VI(bobXY(int(a[0]!)).y)
    },
    'i bob'(_, a) {
      return VI(bobXY(int(a[0]!)).image)
    },
    /*
     * FnXSprite, FnYSprite and FnISprite (+Lib.s:12035, 12045, 12067) are the
     * same four instructions: `move.l d3,d1 / Rbmi L_FonCall / SyCall XYSp /
     * Rbne L_FonCall`. XYSp is HsXY (+W.s:11440), which ends `moveq #0,d0` and
     * so never fails on its own — the failure is inside HsActAd
     * (+W.s:11398), `cmp.w #HsNb,d1 / bcc.s HsAdE`, and HsAdE is `addq.l
     * #4,sp / moveq #1,d0 / rts`: it throws away its caller's return address
     * and hands the 1 straight back, which is what `Rbne L_FonCall` catches.
     *
     * `HsNb equ 64` (+WEqu.s:177), so the sprites are 0 to 63 and anything
     * else is Illegal function call. In range and never used reads the table
     * as it stands, which is zero, and that part the port already had.
     */
    'x sprite'(_, a) {
      return VI(hwSprite(int(a[0]!))?.x ?? 0)
    },
    'y sprite'(_, a) {
      return VI(hwSprite(int(a[0]!))?.y ?? 0)
    },
    'i sprite'(_, a) {
      return VI(hwSprite(int(a[0]!))?.image ?? 0)
    },
    'bob col'(_, a) {
      /*
       * FnBobCol1 (+Lib.s:12365) fills the range in itself: `moveq #0,d2 /
       * move.l #10000,d3`, so the one-argument form tests bobs 0 to 10000 —
       * the same ceiling FnSpriteBobCol1 uses, and not the everything the
       * port had been passing. FnBobCol3 (+Lib.s:12375) then puts `Rbmi
       * L_FonCall` on all three arguments; unlike Sprite Col there is no
       * upper bound on the pair, only the sign.
       */
      const n = int(a[0]!)
      const first = a.length > 1 ? int(a[1]!) : 0
      const last = a.length > 2 ? int(a[2]!) : 10000
      if (n < 0 || first < 0 || last < 0) funcCall()
      return VI(rt.bobColCheck(n, first, last))
    },
    'sprite col'(_, a) {
      // FnSpriteCol1 (+Lib.s:12421) is `moveq #0,d2 / moveq #63,d3`, and
      // FnSpriteCol3 opens `cmp.l #63,d3` — the one bound Bob Col lacks
      const n = int(a[0]!)
      const first = a.length > 1 ? int(a[1]!) : 0
      const last = a.length > 2 ? int(a[2]!) : 63
      if (n < 0 || first < 0 || last >>> 0 > 63) funcCall()
      return VI(rt.spriteColCheck(n, first, last))
    },
    'bobsprite col'(_, a) {
      // FnBobSpriteCol1/3 (+Lib.s:12338/12349): bob n against hardware
      // sprites. The three-argument form is `cmp.l #63,d3 / Rbhi L_FonCall`
      // then `Rbmi` on the other two, the same pair of rules Sprite Col
      // carries — the targets are sprites, so the range end stops at 63.
      const n = int(a[0]!)
      const first = a.length > 1 ? int(a[1]!) : 0
      const last = a.length > 2 ? int(a[2]!) : 63
      if (n < 0 || first < 0 || last >>> 0 > 63) funcCall()
      return VI(rt.bobSpriteColCheck(n, first, last))
    },
    'spritebob col'(_, a) {
      // FnSpriteBobCol1/3 (+Lib.s:12390/12401): sprite n against bobs, so it
      // follows Bob Col instead — `tst.l d3 / Rbmi L_FonCall` and nothing
      // above it, because the ceiling on that side is the 10000 the
      // one-argument form fills in.
      const n = int(a[0]!)
      const first = a.length > 1 ? int(a[1]!) : 0
      const last = a.length > 2 ? int(a[2]!) : 10000
      if (n < 0 || first < 0 || last < 0) funcCall()
      return VI(rt.spriteBobColCheck(n, first, last))
    },
    hardcol(_, a) {
      // FnHardcol +Lib.s:12324: -1 or lower asks about the playfields,
      // otherwise the sprite number, and 8 or above is a function call
      // error (cmp.l #8,d3 / bcc)
      const n = int(a[0]!)
      if (n >= 8) funcCall()
      return VI(rt.hardcol(n))
    },
    col(_, a) {
      // =Col(n): >=0 membership; <0 = the first colliding object number
      return VI(rt.colGet(int(a[0]!)))
    },
    zone(_, a) {
      // FnZone2/3 (+Lib.s:10945) -> SyZoGr (+W.s:11112) -> GZone. The
      // three-argument form names the screen whose table is walked, and it
      // is a real difference now that a table belongs to a screen: `Zone(x,y)`
      // is the current one, `Zone(screen,x,y)` any open one. Screen
      // coordinates go straight to GZone with no clipping — a point outside
      // the screen still matches a zone that covers it.
      const s = zoneScreen(rt, a, 3)
      if (!s) return VI(ENT_NUL)
      return VI(rt.zoneAt(s, int(a[a.length - 2]!), int(a[a.length - 1]!)))
    },
    hzone(_, a) {
      // FnHZone2/3 (+Lib.s:10980) -> SyZoHd (+W.s:11121) -> ZoEc -> GZone.
      // ZoEc is the same routine Mouse Zone reaches, so Hzone gets its
      // BOUNDS TEST too: a hardware coordinate outside the screen's
      // displayed window answers 0 without the table ever being walked
      // (`sub.w EcWx(a1),d1 / bcs` and `cmp.w EcWTx(a1),d1 / bcc`, and the
      // same pair in Y). This port used to convert and walk regardless.
      const s = zoneScreen(rt, a, 3)
      if (!s) return VI(ENT_NUL)
      return VI(rt.hardZoneAt(s, int(a[a.length - 2]!), int(a[a.length - 1]!)))
    },
    'mouse zone'(it, a) {
      // FnMouseZone +Lib.s:11048 is `moveq #0,d3` then SyCall ZoHd — d3 = 0
      // is "the current screen", the same selector Zone(x,y) passes, so
      // Mouse Zone asks only the current screen's table and not, as SyMouZ
      // (+W.s:11216, which nothing calls) would, every screen in priority
      // order.
      void a
      return VI(rt.hardZoneAt(scr(), it.inp.mouseX, it.inp.mouseY))
    },
    /**
     * =Exist("name") -- FnExist +Lib.s:5704, four instructions over L_RExist.
     *
     *     Lib_Def RExist
     *       Rbsr    L_NoReq            suppress AmigaDOS's insert-volume requester
     *       move.l  Name1(a5),d1
     *       DosCall _LVOLock
     *       Rbsr    L_YesReq
     *       move.l  d0,d1
     *       beq.s   FExF
     *       DosCall _LVOUnLock
     *       moveq   #-1,d3
     *
     * A LOCK, not a read. Lock() succeeds on a file, a drawer, an assign and
     * a VOLUME alike, which is why `Exist("Boing:")` is how a game asks
     * whether its own disk is in the machine -- and why RExist brackets the
     * call with NoReq/YesReq, so a missing volume answers false instead of
     * popping "Please insert volume". Reading the name instead answered 0 for
     * a drawer, an assign and a mounted disk, and Boing 3.0's DISKPRESENT
     * procedure sat in `Repeat ... Until Exist("boing:")` for ever with the
     * disk mounted, flashing a palette that is all zeros on alternate frames.
     *
     * An empty name answers false without locking: `tst.w (a2) / Rbeq
     * L_FnFalse` in FnExist, ahead of NomDisc. 108 characters or more is an
     * illegal function call, off NomDisc's own `cmp.w #108,d2 / Rbcc
     * L_FonCall` (+Lib.s:6574) -- so a too-long name raises where an absent
     * one answers 0.
     *
     * The NoReq bracket is load-bearing and not decoration: without it
     * `Exist("Boing:")` on an absent disk stops the program inside the
     * handler's requester, and DISKPRESENT's `Repeat ... Until Exist(...)` is
     * a loop whose whole point is that the answer can be no. `Runtime.noReq`
     * is `pr_WindowPtr`.
     */
    exist(_, a) {
      const name = str(a[0]!)
      if (name === '') return VI(0)
      if (name.length >= 108) funcCall()
      const vfs = rt.vfs
      if (vfs) return rt.withNoReq(() => VI(vfs.exists(name) !== null ? -1 : 0))
      // a bare AmosFS is files and nothing else, so a read IS its Lock
      return VI(rt.fs?.read(name) != null ? -1 : 0)
    },
    scin(_, a) {
      /*
       * Scin(x,y) asks which screen is under a hardware coordinate, and the
       * THREE-argument form asks which one is under it AT OR BELOW a named
       * screen. FnScIn3 (+Lib.s:11018) reads that screen out of the first
       * argument and biases it, `addq.l #1,d3`, the same EcToD1 convention
       * X Hard uses; FnScIn2 sets it to -1 so the +1 makes 0.
       *
       * GetSIn (+W.s:10879) then reads it: 0 or negative starts at the head
       * of the priority list T_EcPri, and anything else resolves the screen
       * and walks the list to ITS position first, so the search begins
       * there. The port had been ignoring the argument and always starting
       * at the front.
       */
      const x = int(a[a.length - 2]!)
      const y = int(a[a.length - 1]!)
      let start = rt.order.length - 1
      if (a.length >= 3) {
        const d3 = int(a[0]!) + 1
        if (d3 > 0) {
          start = rt.order.indexOf(d3 - 1)
          if (start < 0) throw new AmosError(ED_RUN_MESSAGES[47]!, 47)
        }
      }
      for (let i = start; i >= 0; i--) {
        const s = rt.screens.get(rt.order[i]!)
        // `btst #BitHide,EcFlags(a0) / bne.s GSin1` skips a hidden screen
        if (!s || !s.visible) continue
        if (overScreen(s, x, y)) return VI(s.index)
      }
      return VI(-1)
    },
    'key shift'(it, a) {
      // FnKeyShift +Lib.s:13631: the qualifier byte — 0 LShift, 1 RShift,
      // 2 CapsLock, 3 Ctrl, 4 LAlt, 5 RAlt, 6 LAmiga, 7 RAmiga
      void a
      let m = 0
      if (it.inp.keys.has(0x60)) m |= 1
      if (it.inp.keys.has(0x61)) m |= 2
      if (it.inp.keys.has(0x62)) m |= 4
      if (it.inp.keys.has(0x63)) m |= 8
      if (it.inp.keys.has(0x64)) m |= 16
      if (it.inp.keys.has(0x65)) m |= 32
      if (it.inp.keys.has(0x66)) m |= 64
      if (it.inp.keys.has(0x67)) m |= 128
      return VI(m)
    },
    length(_, a) {
      // FnLength +Lib.s:2462 takes the byte length and then, for a Bob or Icon
      // bank, replaces it with `move.w (a1),d3` -- the image COUNT. bankRef
      // carries that rule so nothing else has to know it
      return VI(rt.bankRef(int(a[0]!))?.length ?? 0)
    },

    // ---- the 68k register slots (Dreg/Areg) ----
    dreg: (_, a) => VI(rt.callReg[regSlot(int(a[0]!), 8, 0)]!),
    areg: (_, a) => VI(rt.callReg[regSlot(int(a[0]!), 7, 8)]!),

    // ---- AMAL ----
    amreg(_, a) {
      // FAmR (+Lib.s:11964) reads `move.w (a0),d3 / ext.l d3`, a SIGNED word
      if (a.length === 2) {
        const r = int(a[1]!)
        const ch = amregChannel(rt, int(a[0]!), r)
        return VI((ch.regs[r]! << 16) >> 16)
      }
      return VI((rt.amalGlobals[amregGlobal(int(a[0]!))]! << 16) >> 16)
    },
    chanan(_, a) {
      return VI(rt.channels.get(amChannel(int(a[0]!)))?.animating ? -1 : 0)
    },
    chanmv(_, a) {
      return VI(rt.channels.get(amChannel(int(a[0]!)))?.moving ? -1 : 0)
    },
    amalerr() {
      return VI(rt.amalErrPos)
    },

    // ---- audio ----
    vumeter(_, a) {
      // FnVuMeter +Music.s:3867: voice 0-3 else illegal function call
      const v = int(a[0]!)
      if (v < 0 || v >= 4) funcCall()
      return VI(rt.vumeter(v))
    },
    mubase() {
      // FnMusicBase +Music.s:3881: the extension data zone address; the
      // vumeter bytes at +0..3 are mapped into the fake address space
      return VI(Runtime.MUBASE_ADDR)
    },
    'sam swapped'(_, a) {
      // FnSamSwapped +Music.s:4029: voice 0-3 else illegal function call;
      // 1 = voice off, 0 = swap pending, -1 = playing / swap consumed
      const v = int(a[0]!)
      if (v < 0 || v > 3) funcCall()
      return VI(rt.music.samState[v]!)
    },

    // ---- files ----
    eof(_, a) {
      const c = rt.chan(int(a[0]!))
      return VI(c.mode === 'in' && c.pos >= c.data.length ? -1 : 0)
    },
    lof(_, a) {
      const c = rt.chan(int(a[0]!))
      return VI(c.mode === 'in' ? c.data.length : c.out.length)
    },
    pof(_, a) {
      const c = rt.chan(int(a[0]!))
      return VI(c.mode === 'in' ? c.pos : c.out.length)
    },
    'input$'(it, a) {
      if (a.length === 2) {
        // Input$(channel, count): read raw bytes from the file
        const c = rt.chan(int(a[0]!))
        if (c.mode !== 'in') throw new AmosError('file type mismatch', 98)
        const n = int(a[1]!)
        let out = ''
        for (let i = 0; i < n && c.pos < c.data.length; i++) out += String.fromCharCode(c.data[c.pos++]!)
        return VS(out)
      }
      // Input$(n): FnInputD1 +Lib.s:4666. AskD3 rejects a zero or negative
      // length before the loop is reached (`tst.l d3 / Rbeq / Rbmi`), then
      //
      //   FInp1a: Rjsr L_Test_PaSaut / SyCall Inkey
      //           tst.l d1 / beq.s FInp1a        no key yet: keep waiting
      //           cmp.b #32,d1 / bcs.s FInp1a    below space: thrown away
      //           move.b d1,(a1)+ / subq.w #1,d2 / bne.s FInp1a
      //
      // so it BLOCKS until n printable characters have been typed, silently
      // drops Return, Backspace and the cursor keys, and echoes nothing.
      const n = int(a[0]!)
      if (n <= 0) funcCall()
      for (;;) {
        const k = it.inp.keyQueue.shift()
        if (!k) break
        if (k.ch.length === 1 && k.ch >= ' ') rt.inputChars += k.ch
        if (rt.inputChars.length >= n) break
      }
      if (rt.inputChars.length < n) {
        // Test_PaSaut yields to the interrupts each turn round the loop, so a
        // frame passes and the whole statement runs again
        it.block({ type: 'waitInput', mouse: false, key: true }, true)
        return VS('')
      }
      const out = rt.inputChars.slice(0, n)
      rt.inputChars = ''
      return VS(out)
    },
    'dir$'(_, a) {
      // the reader half of Dir$ (+Lib.s:4799); the assignment form and its
      // stray-volume fallback are on the instruction below
      void a
      return VS(rt.vfs?.currentDir ?? '')
    },
    'disc info$'(_, a) {
      // FnDiscInfo +Lib.s:4995: "VOLUME:" (from the volume node of the
      // locked path) + a 10-char field with the free byte count
      // left-aligned (LongToDec into ten spaces). The count is `=Dfree`'s,
      // computed the same way from the same Info() call.
      const path = a.length > 0 ? str(a[0]!) : ''
      const vfs = rt.vfs
      if (!vfs) throw new AmosError('device not available', 86)
      const r = vfs.resolve(path === '' ? vfs.currentDir : path)
      if (!r || vfs.exists(path === '' ? vfs.currentDir : path) === null) {
        throw new AmosError('device not available', 86)
      }
      // id_VolumeNode, then dl_Name at offset $28 — the VOLUME node, so a
      // disk asked about as `Df0:` still names itself. `AmigaFS.lockPath`
      // carries the argument.
      const volName = vfs.volumeNodeName(r.volume) ?? r.canonical.split(':')[0]!
      return VS(`${volName}:` + String(freeBytes(rt, r.canonical)).padEnd(10))
    },
    'dir first$'(_, a) {
      const pattern = a.length > 0 ? str(a[0]!) : '*'
      const vfs = rt.vfs
      if (!vfs) return VS('')
      // a path prefix may be included: "Data:pics/*.IFF"
      const slash = Math.max(pattern.lastIndexOf('/'), pattern.lastIndexOf(':'))
      const dirPart = slash >= 0 ? pattern.slice(0, slash + 1) : ''
      const filePart = slash >= 0 ? pattern.slice(slash + 1) : pattern
      const entries = vfs.listDir(dirPart === '' ? vfs.currentDir : dirPart) ?? []
      // positive joker + Set Dir's negative filter apply to FILES only —
      // directories always list (FillNxt +Lib.s:6184: tst.w 4(a2) bpl)
      const kept = entries.filter(
        (e) =>
          e.isDir ||
          (matchesJoker(filePart, e.name) && !(rt.dirNegFilter !== '' && joker(rt.dirNegFilter, e.name))),
      )
      kept.sort((a2, b) => {
        const ka = fillSortKey((a2.isDir ? '*' : ' ') + a2.name)
        const kb = fillSortKey((b.isDir ? '*' : ' ') + b.name)
        return ka < kb ? -1 : 1
      })
      rt.dirIter = { entries: kept, idx: 0 }
      return VS(nextDirEntry())
    },
    'dir next$'(_, a) {
      void a
      return VS(nextDirEntry())
    },
    dfree(_, a) {
      // FnDFree +Lib.s:4938 takes no argument: it copies `PathAct` -- the
      // CURRENT path -- into Name1, locks that, and calls Info().
      void a
      return VI(freeBytes(rt, rt.vfs?.currentDir ?? ''))
    },
    choice(_, a) {
      // =Choice: self-clearing latch (-1/0); =Choice(n): level n's number
      const m = rt.menu
      if (a.length === 0) {
        const v = m.choice
        m.choice = 0
        return VI(v)
      }
      // FnChoice1 (+Lib.s:15641): `tst.l d3 / Rbls L_FonCall / cmp.l
      // #MnNDim,d3 / Rbhi L_FonCall`, so 1 to 8 and error 23 outside. Rbls
      // is unsigned low-or-same, which takes the negatives with the zero.
      const n = int(a[0]!)
      if (n <= 0 || n > 8) funcCall()
      return VI(m.choix[n - 1] ?? 0)
    },
    // FnXMenu and FnYMenu (+Lib.s:15618, 15627) open with the same Rjsr
    // L_MnDim, so a path that names nothing is error 39, not a zero
    'x menu'(_, a) {
      return VI(menuNodeOf(rt, a.map((v) => int(v))).x)
    },
    'y menu'(_, a) {
      return VI(menuNodeOf(rt, a.map((v) => int(v))).y)
    },

    'dialog run'(it, a) {
      // FnDialogRun1/2/4 +Lib.s:14471: =Dialog Run(c[,label][,x,y]); RU in
      // the script blocks the interpreter until the wait loop exits
      const c = int(a[0]!)
      if (c <= 0) funcCall()
      const d = rt.dialogs.get(c)
      if (!d) throw new AmosError(DIALOG_ERRORS[6]!)
      if (d.runState === 'done') {
        d.runState = 'idle'
        return VI(d.ret)
      }
      if (d.runState === 'waiting') {
        it.block({ type: 'dialog', channel: c }, true)
        return VI(0)
      }
      const label = a.length >= 2 ? int(a[1]!) : -1
      if (label >= 65536) funcCall()
      const x = a.length >= 4 ? int(a[2]!) : null
      const y = a.length >= 4 ? int(a[3]!) : null
      const r = rt.runDialog(c, label, x, y)
      if (r === 'blocked') {
        it.block({ type: 'dialog', channel: c }, true)
        return VI(0)
      }
      return VI(r)
    },
    'dialog box'(it, a) {
      // FnDialogBox1..5 +Lib.s:14655 → Dia_RunQuick 20437: a temporary
      // channel >= 65536 runs the script (or bank program) synchronously;
      // v and v$ seed vars 0 and 1
      if (rt.dialogBoxChan !== null) {
        const d = rt.dialogs.get(rt.dialogBoxChan)
        if (d && d.runState === 'done') {
          const ret = d.ret
          rt.dialogs.delete(rt.dialogBoxChan)
          rt.dialogBoxChan = null
          return VI(ret)
        }
        if (d && d.runState === 'waiting') {
          it.block({ type: 'dialog', channel: rt.dialogBoxChan }, true)
          return VI(0)
        }
        rt.dialogBoxChan = null
      }
      const res = rt.resource()
      let script: string
      if (a[0]!.k === 'str') {
        script = a[0]!.s
      } else {
        const n = int(a[0]!)
        const progs = res.programs
        if (!progs || n < 1 || n > progs.length) funcCall()
        script = progs[n - 1]!
      }
      let c = 65536
      while (rt.dialogs.has(c)) c++
      const chan = new DialogChannel(c, 16, res)
      chan.script = script
      chan.screenNb = rt.currentIndex
      try {
        const scan = prescanDialog(script)
        chan.labels = scan.labels
        chan.userInstrs = scan.userInstrs
      } catch (e) {
        if (e instanceof DialogError) {
          rt.dialogErrPos = e.position
          throw new AmosError(e.message)
        }
        throw e
      }
      chan.vars[0] = a.length >= 2 ? int(a[1]!) : 0
      chan.vars[1] = a.length >= 3 ? str(a[2]!) : ''
      rt.dialogs.set(c, chan)
      const x = a.length >= 5 ? int(a[3]!) : null
      const y = a.length >= 5 ? int(a[4]!) : null
      const r = rt.runDialog(c, -1, x, y)
      if (r === 'blocked') {
        rt.dialogBoxChan = c
        it.block({ type: 'dialog', channel: c }, true)
        return VI(0)
      }
      rt.dialogs.delete(c)
      return VI(r)
    },
    dialog(_, a) {
      // FnDialog +Lib.s:14509 → Dia_GetReturn: -1 when not drawn, else the
      // return value, read-and-cleared (one-shot)
      const c = int(a[0]!)
      if (c <= 0) funcCall()
      const d = rt.dialogs.get(c)
      if (!d) throw new AmosError(DIALOG_ERRORS[6]!)
      if (!d.drawn) return VI(-1)
      const v = d.ret
      d.ret = 0
      return VI(v)
    },
    vdialog(_, a) {
      // FnVDialog +Lib.s:14534: raw long read; string slots read as 0
      const d = rt.dialogs.get(int(a[0]!))
      if (!d) throw new AmosError(DIALOG_ERRORS[6]!)
      const n = int(a[1]!)
      if (n < 0 || n >= d.vars.length) throw new AmosError(DIALOG_ERRORS[8]!)
      const v = d.vars[n]!
      return VI(typeof v === 'number' ? v : 0)
    },
    'vdialog$'(_, a) {
      const d = rt.dialogs.get(int(a[0]!))
      if (!d) throw new AmosError(DIALOG_ERRORS[6]!)
      const n = int(a[1]!)
      if (n < 0 || n >= d.vars.length) throw new AmosError(DIALOG_ERRORS[8]!)
      const v = d.vars[n]!
      return VS(typeof v === 'string' ? v : '')
    },
    edialog(_, a) {
      // FnEDialog +Lib.s:14362: position of the last dialog error
      void a
      return VI(rt.dialogErrPos)
    },
    'fsel$'(it, a) {
      // FnFileSelector1..4 +Lib.s:6778 → Dsk.FileSelector: the selector is
      // the default resource bank's dialog program 2 driven natively;
      // blocks until OK/Cancel, "" on cancel
      if (rt.fsel) {
        if (rt.fsel.done) {
          const r = rt.fsel.result
          rt.fsel = null
          return VS(r)
        }
        it.block({ type: 'fsel' }, true)
        return VS('')
      }
      const path = a.length >= 1 ? str(a[0]!) : ''
      const def = a.length >= 2 ? str(a[1]!) : ''
      const t1 = a.length >= 3 ? str(a[2]!) : ''
      const t2 = a.length >= 4 ? str(a[3]!) : ''
      if (!rt.startFsel(path, def, t1, t2)) return VS('') // no system bank/vfs
      it.block({ type: 'fsel' }, true)
      return VS('')
    },
    'psel$'(_, a) {
      // FnPSel (+Lib.s:6742) is a bare `rts`. The keyword has four token-table
      // variants and no implementation at all in AMOS Professional, so it
      // returns d3 — the last argument — untouched.
      return VS(a.length > 0 ? str(a[a.length - 1]!) : '')
    },
    rdialog(_, a) {
      // FnRDialog2/3 +Lib.s:14559 → Dia_GetValue: a zone's numeric result
      // (string-valued zones read as 0)
      const v = rdialogValue(rt, a)
      return VI(v.s === null ? v.n : 0)
    },
    'rdialog$'(_, a) {
      const v = rdialogValue(rt, a)
      return VS(v.s ?? '')
    },
    zdialog(_, a) {
      // FnZDialog +Lib.s:14603 → Dia_GetZ: zone number at screen x,y
      const d = rt.dialogs.get(int(a[0]!))
      if (!d) throw new AmosError(DIALOG_ERRORS[6]!)
      const z = dialogZoneAt(d, int(a[1]!), int(a[2]!))
      return VI(z ? z.number : -1)
    },
    movon(_, a) {
      // =Movon(n) (FnMovon +Lib.s:11893): -1 while a Move X/Y program on
      // channel n is still running
      const n = amChannel(int(a[0]!))
      const s = rt.stosSlots.get(n)
      const live = (m: { on: boolean; done: boolean } | undefined): boolean => !!m && m.on && !m.done
      return VI(s && (live(s.moveX) || live(s.moveY)) ? -1 : 0)
    },
    'cop logic'(_, a) {
      // =Cop Logic (FnCopLogic +Lib.s:9498 → TCopBs): the address of the
      // logical copper list — real mapped memory, Leek/Loke reach it
      void a
      return VI(rt.copLogicAddr() | 0)
    },
    rain(_, a) {
      // =Rain(n,line) (FnRain +Lib.s:9418 → TRVar +W.s:3937): bounds
      // errors report as OUT OF MEMORY via EcWiErr, like Rainbow
      const n = int(a[0]!)
      const line = int(a[1]!)
      const rb = rt.rainbows.get(n)
      if (n >>> 0 >= 4 || !rb || rb.table.length === 0 || line < 0 || line >= rb.table.length)
        throw new AmosError('out of memory', 24)
      return VI(rb.table[line]!)
    },
    ntsc(_, a) {
      void a
      return VI(0) // FnNTSC: the emulated machine is PAL
    },
    'command line$'(_, a) {
      // FnCommandLine +Lib.s:7886: "" unless the "CmdL" cookie is there
      void a
      return VS(rt.commandLine)
    },
    'display height'(_, a) {
      /*
       * TMaxRaw (+W.s:2578) is two instructions:
       *
       *     move.w  T_EcYMax(a5),d1
       *     sub.w   #EcYBase,d1
       *
       * and T_EcYMax is a MACHINE constant, written once at startup as
       * `#311+EcYBase` for PAL and `#261+EcYBase` for NTSC (+W.s:2447 and
       * :2451). So this answers 311 here and has nothing to do with the
       * current screen.
       *
       * It used to return the screen's own height, capped at 283, which for
       * an ordinary 256-line screen gave 256. Knights asks
       * `If Display Height<270 or Ntsc` to decide whether it is on a short
       * display, took the NTSC branch on a PAL machine, and put its screen
       * at raster 24 with a 240-line window. Almost none of that is inside
       * the display, so the game ran perfectly and drew to a black screen.
       */
      void a
      // 311, because `Ntsc` above answers 0: the modelled machine is PAL.
      return VI(311)
    },
    'screen mode'(_, a) {
      /*
       * FnScreenMode (+Lib.s:8789): GetScreen0, then EcCon0 & $8004, so
       * hires and interlace survive and nothing else does.
       *
       * DEFECT: it is the one Screen query that ends `and.l #$00008004,d3 /
       * rts` instead of `Ret_Int`, and Ret_Int is `moveq #0,d2 / rts`
       * (+CEqu.s:22) -- d2 is the RESULT TYPE. Its four neighbours
       * (FnScreenHeight0, FnScreenWidth0, FnScreenBase, FnScreenColour, all
       * argumentless like this one) set it; this returns with whatever type
       * the last evaluation left behind. Routines that skip Ret_Int legally
       * are the ones whose argument already carries the type -- =Int and
       * =Deek take an integer and give one back, =Psel$ hands its string
       * argument straight back -- and this takes no argument at all.
       * Nothing here reproduces that: a JS return value has one type.
       */
      void a
      const s = rt.screen
      return VI((s.hires ? 0x8000 : 0) | (s.laced ? 4 : 0))
    },
    logbase(_, a) {
      // FnLogBase +Lib.s:8822: EcLogic[plane]; the plane arg defaults to 0
      return VI(planeBase(rt, a.length ? int(a[0]!) : 0, 0))
    },
    phybase(_, a) {
      // FnPhyBase +Lib.s:8835: EcPhysic[plane]; the plane arg defaults to 0
      return VI(planeBase(rt, a.length ? int(a[0]!) : 0, 1))
    },
    'font$'(_, a) {
      // FnFont +Lib.s:9757: requires Get Fonts first ("fonts not
      // examined"); negative errors; past the list returns "". The
      // string is exactly 38 chars: name to 30, height decimal at 30,
      // "Rom "/"Disc" at 34.
      const n = int(a[0]!)
      if (n < 0) funcCall()
      if (!rt.fontsListed) throw new AmosError('fonts not examined', 37)
      const f = examinedFonts(rt)[n - 1]
      if (!f) return VS('')
      const out = (f.name + ' ').padEnd(30).slice(0, 30) + String(f.height).padEnd(4).slice(0, 4) + (f.type === 'Rom' ? 'Rom ' : 'Disc')
      return VS(out)
    },
    'resource$'(_, a) {
      // FnResource +ILib.s:6699 walks six tables a thousand apart: n>0 is
      // message n of the puzzle bank, 0 the system path, then -1.. the
      // interpreter-config messages and -1001.. -5001 the editor's own
      // five (Ed_Systeme, the menus, the editor messages, the test-time
      // and the run-time errors). Past -6000 it is a function call error.
      // Records are 1-based within each block (GetMessage +B.s:562) and
      // an index past the end reads empty, not an error.
      const n = int(a[0]!)
      if (n > 0) {
        const msgs = rt.resource().messages
        return VS(msgs?.[n - 1] ?? '')
      }
      if (n === 0) return VS('AMOSPro:')
      let d = -n
      if (d <= 1000) return VS(SYS_MESSAGES[d] ?? '')
      const blocks = [ED_SYSTEME, EDM_MESSAGES, ED_MESSAGES, ED_TST_MESSAGES, ED_RUN_MESSAGES]
      for (const b of blocks) {
        d -= 1000
        if (d <= 1000) return VS(b[d - 1] ?? '')
      }
      funcCall()
    },

    at(_, a) {
      /*
       * FnAt (+Lib.s:14017) tests each slot for EntNul and skips it, and
       * otherwise `cmp.l #255-48,d2 / Rbhi L_WFonCall`. Rbhi is unsigned, so
       * that one compare refuses a negative as well as anything over 207, and
       * WFonCall is `moveq #16,d0 / Rbra L_EcWiErr` — error 60, not 23.
       *
       * The port read any negative as an absent slot, so At(-5,6) built the
       * same two-escape string as At(,6) instead of raising.
       */
      let out = ''
      const x = int(a[0]!)
      const y = int(a[1]!)
      const bad = (n: number): boolean => n !== ENT_NUL && n >>> 0 > 207
      if (bad(x) || bad(y)) throw new AmosError(ED_RUN_MESSAGES[60]!, 60)
      if (x !== ENT_NUL) out += '\x1bX' + String.fromCharCode(48 + x)
      if (y !== ENT_NUL) out += '\x1bY' + String.fromCharCode(48 + y)
      return VS(out)
    },

    // ---- flips, memory, conversions ----
    hrev(_, a) {
      // FnHRev +Lib.s:12707 is one `bset #15,d3`, and Retourne reads the two
      // top bits off the image number before AdBob masks them away with $3FFF
      return VI(int(a[0]!) | 0x8000)
    },
    vrev(_, a) {
      // FnVRev +Lib.s:12712: `bset #14,d3`
      return VI(int(a[0]!) | 0x4000)
    },
    rev(_, a) {
      // FnRev +Lib.s:12715: both flip bits at once
      return VI(int(a[0]!) | 0xc000)
    },
    drive(_, a) {
      // FnDrive +Lib.s:4922: True when the name ends with ':' AND the
      // device/assign resolves (DeviceProc), else False
      const s = str(a[0]!)
      if (!s.endsWith(':')) return VI(0)
      const known = [...(rt.vfs?.volumeNames() ?? []), ...(rt.vfs?.assignNames() ?? [])].map((n) => n.toLowerCase())
      return VI(known.includes(s.slice(0, -1).toLowerCase()) ? -1 : 0)
    },
    'scan$'(_, a) {
      // FnScan2 +Lib.s:13776: a 4-byte Put Key scancode injection string.
      // d4 is the LAST argument and d5 the first, and the writes run
      // `move.b d4,(a0)+ / move.b d5,(a0)+`, so the shift byte goes down
      // first and the scancode second: chr$(1), shift, scancode, chr$(0).
      // FnScan1 pushes its one argument and clears d3, so the one-argument
      // form is a zero shift.
      const scan = int(a[0]!)
      const shift = a.length > 1 ? int(a[1]!) : 0
      if (scan >>> 0 >= 256 || shift >>> 0 >= 256) funcCall()
      return VS(String.fromCharCode(1, shift, scan, 0))
    },
    'bstart'(_, a) {
      // FnBStart +Lib.s:2242: bank address in the PREVIOUS program's list
      // (the editor/accessory exchange) — no parent program here, so the
      // Bnk.PrevProgram failure path: bank not reserved
      void a
      throw new AmosError('bank not reserved')
    },
    'blength'(_, a) {
      // FnBLength +Lib.s:2255: 0 when there is no previous program's bank
      void a
      return VI(0)
    },
    start(_, a) {
      // FnStart +Lib.s:2452 is `Rbsr L_Bnk.GetAdr / Rbeq L_BkNoRes / move.l
      // a1,d3` -- ONE list, so a Bob or Icon bank answers like any other. It
      // used to look only in memBanks and threw for a bank that plainly
      // existed. See ./banks.ts
      const ref = rt.bankRef(int(a[0]!))
      if (!ref) throw new AmosError('bank not reserved')
      return VI(ref.address)
    },
    peek(_, a) {
      const m = rt.resolveAddr(int(a[0]!))
      return VI(m ? m.data[m.off]! : 0)
    },
    squash(_, a) {
      // =Squash(address,length,fast,speed,colour) — Squash +CompExt.s:943.
      // Compresses in place and returns the compressed length, or -1 when the
      // result would not beat the original ("Squashed >= Normal").
      const address = int(a[0]!)
      const length = int(a[1]!)
      const speed = a.length >= 4 ? int(a[3]!) : 4095
      const colour = a.length >= 5 ? int(a[4]!) : 0
      if (length <= 0 || colour < 0 || colour >= 32) funcCall()
      if (a.length >= 4 && (speed < 256 || speed >= 4096)) funcCall()
      const m = rt.resolveWrite(address)
      if (!m) throw new AmosError('Address error', 25)
      const len = Math.min(length, m.data.length - m.off)
      const packed = squashBytes(m.data.slice(m.off, m.off + len), Math.min(speed, 4096))
      if (!packed) return VI(-1)
      m.data.set(packed, m.off)
      return VI(packed.length)
    },
    unsquash(_, a) {
      // =Unsquash(address,length) — UnSquash +CompExt.s:1468. Decompresses in
      // place; returns the expanded length, -1 on corrupt data (bad checksum)
      // or -2 if it would write past the end of the memory block.
      const address = int(a[0]!)
      const length = int(a[1]!)
      if (length <= 0) funcCall()
      const m = rt.resolveWrite(address)
      if (!m) throw new AmosError('Address error', 25)
      const comp = m.data.slice(m.off, m.off + Math.min(length, m.data.length - m.off))
      let out: Uint8Array
      try {
        out = unsquashBytes(comp)
      } catch {
        return VI(-1)
      }
      if (m.off + out.length > m.data.length) return VI(-2)
      m.data.set(out, m.off)
      return VI(out.length)
    },
    deek(_, a) {
      const m = rt.resolveAddr(int(a[0]!))
      return VI(m && m.off + 1 < m.data.length ? (m.data[m.off]! << 8) | m.data[m.off + 1]! : 0)
    },
    leek(_, a) {
      const m = rt.resolveAddr(int(a[0]!))
      if (!m || m.off + 3 >= m.data.length) return VI(0)
      return VI(((m.data[m.off]! << 24) | (m.data[m.off + 1]! << 16) | (m.data[m.off + 2]! << 8) | m.data[m.off + 3]!) | 0)
    },
    'peek$'(_, a) {
      // FPeekD (+Lib.s:2842) clamps the count to a string's own ceiling with
      // `cmp.l #String_Max,d4 / bcs.s .Ln / move.w #String_Max,d4`, and
      // String_Max is $FFC0 (+Equ.s:1139). The comparison is unsigned, so a
      // negative length is a huge one and clamps to the same place.
      //
      // The third argument is a terminator CHARACTER, taken as the first byte
      // of the string: FnPeekD3 (+Lib.s:2833) reads the length word first and
      // an empty string leaves d2 at -1, which means no terminator at all.
      // The matching byte ends the copy without joining it.
      const m = rt.resolveAddr(int(a[0]!))
      if (!m) return VS('')
      const len = Math.min(int(a[1]!) >>> 0, 0xffc0)
      const stop = a.length > 2 ? str(a[2]!).charCodeAt(0) : -1
      let out = ''
      for (let i = 0; i < len && m.off + i < m.data.length; i++) {
        const b = m.data[m.off + i]!
        if (b === stop) break
        out += String.fromCharCode(b)
      }
      return VS(out)
    },
    /*
     * All four convert between the CURRENT WINDOW's text grid and screen
     * pixels, and the port had been converting against the screen.
     *
     * WOpen's WiAdr (+W.s:13763) sets `WiDxI = d2` and `WiDyI = d3`, then
     * adds 1 to WiDxI and WiTyCar to WiDyI when the window has a border. So
     * WiDxI counts CHARACTERS and WiDyI counts PIXELS, which is why the two
     * axes multiply and add in the opposite order below. WiTx and WiTy hold
     * the inner size while the console is in "Mode INTERIEUR" (WiInt,
     * +W.s:15583), which is where it rests.
     */
    'x text'(_, a) {
      // CXyWi +W.s:10841: `lsr.w #3,d1 / sub.w WiDxI(a0),d1 / bmi / cmp.w
      // WiTxI(a0),d1 / bcc`, and both failures answer EntNul, not -1
      const w = scr().curWin
      const n = word((int(a[0]!) & 0xffff) >>> 3, w.x >> 3)
      return VI(n < 0 || n >= w.cols ? ENT_NUL : n)
    },
    'y text'(_, a) {
      // CXyWi +W.s:10831: `sub.w WiDyI(a0),d2 / bmi / divu WiTyCar(a0),d2 /
      // cmp.w WiTyI(a0),d2 / bcc`. The divide is by the CHARACTER HEIGHT,
      // where the X axis shifts by a fixed three.
      const w = scr().curWin
      const d = word(int(a[0]!), w.y)
      if (d < 0) return VI(ENT_NUL)
      const n = Math.floor(d / 8)
      return VI(n >= w.rows ? ENT_NUL : n)
    },
    'x graphic'(_, a) {
      // WiXGr +W.s:15272: `cmp.w WiTx(a0),d1 / bcc.s WiXYo / add.w
      // WiDxI(a0),d1 / lsl.w #3,d1`. WiXYo is `moveq #-1,d1` — this pair
      // answers -1 where the text pair answers EntNul. FnXGraphic
      // (+Lib.s:10872) refuses a negative first, with Rbmi L_FonCall.
      const n = int(a[0]!)
      if (n < 0) funcCall()
      const w = scr().curWin
      return VI(n >= w.cols ? -1 : (n + (w.x >> 3)) * 8)
    },
    'y graphic'(_, a) {
      // WiYGr +W.s:15281 shifts BEFORE it adds, because WiDyI is in pixels
      const n = int(a[0]!)
      if (n < 0) funcCall()
      const w = scr().curWin
      return VI(n >= w.rows ? -1 : n * 8 + w.y)
    },
    'mouse screen'(it, a) {
      // FnMouseScreen (+Lib.s:11035) opens `tst.w ScOn(a5) / Rbeq L_ScNOp`
      // before it asks XyMou anything, so with no screen open the answer is
      // error 47 and not the EntNul that means "over no screen"
      void a
      void rt.screen
      for (let i = rt.order.length - 1; i >= 0; i--) {
        const s = rt.screens.get(rt.order[i]!)
        if (!s || !s.visible) continue
        if (overScreen(s, it.inp.mouseX, it.inp.mouseY)) return VI(s.index)
      }
      return VI(-0x80000000) // GetSIn +W.s:10915 returns EntNul when over no screen
    },
    scanshift(it, a) {
      // FnScanshift +Lib.s:13611: the shift byte captured with the last
      // Inkey$, read AND cleared (like Scancode)
      void a
      const v = it.inp.lastShift
      it.inp.lastShift = 0
      return VI(v)
    },
    /*
     * FnPenD and FnPaperD (+Lib.s:13986, 13993) differ only in the letter they
     * point a2 at, and both fall into FPn (+Lib.s:14000): `cmp.l #32,d3 /
     * Rbcc L_WFonCall / add.b #"0",d3 / move.b d3,2(a2)`. Unsigned, so the one
     * compare refuses a negative too, and WFonCall is `moveq #16,d0 / Rbra
     * L_EcWiErr`, error 60. The port put whatever it was given through
     * `48 + n`, so Pen$(200) built an escape naming a colour that is not there.
     */
    'pen$'(_, a) {
      return VS('\x1bP' + String.fromCharCode(48 + fpn(int(a[0]!))))
    },
    'paper$'(_, a) {
      return VS('\x1bB' + String.fromCharCode(48 + fpn(int(a[0]!))))
    },
    'cmove$'(_, a) {
      /*
       * FnCMoveD (+Lib.s:14060) walks each slot in turn: zero and EntNul both
       * leave the axis out, and anything else must pass `cmp.l #128 / Rbge`
       * and `cmp.l #-128 / Rble`, so the range is -127..127 and the error is
       * WFonCall, 60. It counts the escapes it will need in d3 and flags them
       * in d4, then `tst.w d4 / Rbeq L_Ret_ChVide` returns the empty string
       * when neither axis was given.
       *
       * The x escape is written first and is Esc N; Esc O carries y. The port
       * emitted both escapes every time, in the other order, on the other
       * axes.
       */
      const axis = (v: import('../interp/values').Value | undefined): number => {
        if (v === undefined) return 0
        const n = int(v)
        if (n === ENT_NUL || n === 0) return 0
        if (n >= 128 || n <= -128) throw new AmosError(ED_RUN_MESSAGES[60]!, 60)
        return n
      }
      const x = axis(a[0])
      const y = axis(a[1])
      let out = ''
      if (x !== 0) out += '\x1bN' + String.fromCharCode((128 + x) & 0xff)
      if (y !== 0) out += '\x1bO' + String.fromCharCode((128 + y) & 0xff)
      return VS(out)
    },
    'border$'(_, a) {
      // FnBorderD +Lib.s:14124: style 1-15, `tst.l d3 / Rbeq L_WFonCall /
      // cmp.l #16,d3 / Rbcc L_WFonCall`, so error 60 and not 23. The text is
      // wrapped in Esc E 0 (store position) ... Esc E n (draw box)
      const n = int(a[1]!)
      if (n <= 0 || n >= 16) throw new AmosError(ED_RUN_MESSAGES[60]!, 60)
      return VS('\x1bE0' + str(a[0]!) + '\x1bE' + String.fromCharCode(48 + n))
    },
  }

  function nextDirEntry(): string {
    const it2 = rt.dirIter
    if (!it2 || it2.idx >= it2.entries.length) return ''
    const e = it2.entries[it2.idx++]!
    return e.isDir ? fillEntry(rt, '*', e.name, null) : fillEntry(rt, ' ', e.name, e.size)
  }
}

/**
 * Core keywords plus every implemented extension's.
 *
 * Extension keywords dispatch through the same tables as core ones (interp.ts
 * treats 'core' and 'ext' identically), so this is where an extension is
 * plugged in. Both the Runtime and the coverage manifest build from here, so
 * a new extension file cannot be implemented-but-unreported.
 */
/**
 * Core, then every ported extension, innermost first.
 *
 * On a real machine this list could not collide: core keywords are core
 * tokens and extension keywords are (slot, id) pairs, so `Sprite Col` from
 * core and `Sprite Col` from ext13 are different tokens that coexist. Here
 * both collapse onto a string, and a spread would let the later one silently
 * replace the earlier — which is exactly what adding Personnal's Sprite Col
 * did in a80e5bb: two unrelated sprite tests broke and the census lost two
 * programs, with no error anywhere.
 *
 * So the merge is FIRST-wins, not last: core keeps its name, and between
 * extensions the earlier-listed one keeps it. `keywordLayerCollisions` below
 * reports anything that had to be resolved that way, and a test asserts the
 * list is empty — a collision should be a red build, not a resolution rule
 * quietly doing its job. A port that legitimately needs a name another layer
 * owns declares it in `qualified` instead and answers per slot; see
 * ./extimpl.ts.
 *
 * The ids are registry identities, checked against the registry by
 * extimpl.test.ts. They used to be free text, and six of the eight named no
 * registered extension at all.
 */
const EXT_IMPLS: readonly ExtensionImpl[] = [
  {
    ids: ['tft-0.6', 'tft-0.7'],
    init: (rt) => {
      rt.tft = newTftState()
    },
    instructions: makeTftInstructions,
    functions: makeTftFunctions,
  },
  {
    ids: ['locale-0.26'],
    init: (rt) => {
      rt.locale = newLocaleState()
    },
    instructions: makeLocaleInstructions,
    functions: makeLocaleFunctions,
  },
  {
    // The Game 0.9 is a shim over other libraries; only the ptreplay half is
    // ported so far. See thegame.ts and the batches in the task list.
    ids: ['the-game-0.9'],
    init: (rt) => {
      rt.thegame = newTheGameState(rt)
    },
    instructions: makeTheGameInstructions,
    functions: makeTheGameFunctions,
  },
  {
    ids: ['jvp-1.01'],
    init: (rt) => {
      rt.jvp = newJvpState()
    },
    instructions: makeJvpInstructions,
    functions: makeJvpFunctions,
    errors: JVP_ERRORS,
  },
  {
    ids: ['ldos-2.5', 'ldos-2.6'],
    init: (rt) => {
      rt.ldos = newLdosState()
    },
    instructions: makeLdosInstructions,
    functions: makeLdosFunctions,
  },
  {
    ids: ['turbo-plus-1.0', 'turbo-plus-1.9', 'turbo-plus-2.15'],
    init: (rt) => {
      rt.turbo = newTurboState()
    },
    instructions: makeTurboInstructions,
    functions: makeTurboFunctions,
    defaults: turboDefault,
    errors: TURBO_ERRORS,
    // CRAFT declares `amos pri` too, so bind this one to TURBO's own slot
    qualified: [
      'amos pri',
      // Explode 2.01 spells all seven, and `Plane Swap` is `I0,0` there
      // against `I0,0,0` here -- a handler reading one argument too many.
      'lsl.b', 'lsl.l', 'lsl.w', 'lsr.b', 'lsr.l', 'lsr.w', 'plane swap',
    ],
  },
  {
    // P61 1.2 at slot 25 --- Chris Hodges' wrapper around Jarno Paananen's
    // Player 6.1A. `p61 play` and `p61 stop` are SLOT-QUALIFIED because
    // Personnal 1.1 has keywords of the same names at slot 13, with
    // different arguments. See p61.ts.
    ids: ['p61-1.2'],
    init: (rt) => {
      rt.p61 = newP61State()
    },
    instructions: makeP61Instructions,
    functions: makeP61Functions,
    qualified: ['p61 play', 'p61 stop', 'p61 pause', 'p61 volume'],
  },
  {
    // PowerBobs 1.0 at slot 13, by the author of TURBO Plus. The SHAREWARE
    // build: 64 Pbobs, and a startup screen this port does not reproduce.
    // See powerbobs.ts.
    ids: ['powerbobs-1.0'],
    init: (rt) => {
      rt.powerbobs = newPowerBobsState()
    },
    instructions: makePowerBobsInstructions,
    functions: makePowerBobsFunctions,
  },
  {
    // MED 7.1 at slot 19 --- Haiko Lemser's shim over OctaMED's three player
    // libraries. `med load`, `med play` and `med stop` are SLOT-QUALIFIED
    // because the stock Music extension spells all three, with a bank where
    // this takes a filename and a mode. See medext.ts.
    ids: ['med-7.1'],
    init: (rt) => {
      rt.medExt = newMedExtState()
    },
    instructions: makeMedExtInstructions,
    functions: makeMedExtFunctions,
    defaults: medExtDefault,
    qualified: ['med load', 'med play', 'med stop'],
    errors: MED_ERRORS,
  },
  {
    // Ercole 1.7 at slot 10 --- the readme is blunt about the slot: "Place
    // this extension as extension 10 otherwise it won`t work". `xfire` is
    // SLOT-QUALIFIED because AMCAF spells it too, at slot 8. See ercole.ts.
    ids: ['ercole-1.7'],
    init: (rt) => {
      rt.ercole = newErcoleState()
    },
    instructions: makeErcoleInstructions,
    functions: makeErcoleFunctions,
    errors: ERCOLE_ERRORS,
    // `library open` and `library close` join the list now that Range is a
    // ported product spelling them too --- contested.test.ts requires a name
    // claimed by two ported products to be qualified by one of them, and only
    // Ercole implements these yet
    qualified: ['xfire', 'library open', 'library close'],
  },
  {
    // EasyLife at slot 16 --- Paul Hickman's extension, four builds and one
    // port. 1.0 spells every keyword without the `el` prefix, so it is served
    // by ALIASES rather than by a second implementation; 1.09/1.10/1.44 share
    // the names this file uses. See easylife.ts.
    ids: ['easylife-1.10', 'easylife-1.09', 'easylife-1.44', 'easylife-1.0'],
    init: (rt) => {
      rt.easylife = newEasyLifeState()
    },
    instructions: makeEasyLifeInstructions,
    functions: makeEasyLifeFunctions,
    errors: EASYLIFE_ERRORS,
    aliases: {
      /*
       * 1.0's spelling of this slice. The rename was total --- the two tables
       * share not one name --- but over the zone block it is a plain prefix,
       * so six aliases cover it. `El Overlap` and the four `El Lap*` readers
       * have no 1.0 entry at all: that block was added later.
       *
       * `zb install` is 1.0's alone as a NAME and not as a keyword. 1.10
       * folded it into `!elzb multi add`'s one-argument continuation (id
       * $45a, routine 103), which is why the guide's C_ElzbInstall node is
       * headed "ElZb Multi Add BANK" rather than a name of its own. It
       * arrives with the multi-zone slice, which is what it needs.
       *
       * Two 1.0 names are deliberately still unbound, both because their
       * TARGET is unimplemented rather than because the mapping is unknown:
       * `zb multi add` and `zb install` on `elzb multi add`. Binding a name
       * to a keyword that is not there would move a miss from one name to
       * another and change nothing. `iconify amos` was the third until
       * Intuition arrived, and is bound below.
       */
      'easylife-1.0': {
        znsx: 'elznsx',
        znsy: 'elznsy',
        znex: 'elznex',
        zney: 'elzney',
        'zn shift': 'elzn shift',
        'zb add': 'elzb add',
        // the multi-zone block, where 1.0's names are not a prefix strip at
        // all: `reserve multi zone` and `set multi zone` read as English and
        // `mzone`/`mzoneg`/`mzonen` drop the `el` as well as the `m` boundary
        'reserve multi zone': 'elmz reserve',
        'set multi zone': 'elmz  set',
        'clear multi group': 'elmz erase',
        mznsx: 'elmznsx',
        mznsy: 'elmznsy',
        mznex: 'elmznex',
        mzney: 'elmzney',
        mzone: 'elmzone',
        mzoneg: 'elmzoneg',
        mzonen: 'elmzonen',
        // the character searches, where 1.0's `find` became `elf`
        'find asc': 'elf asc',
        'find char': 'elf char',
        'find not asc': 'elf not asc',
        'find not char': 'elf not char',
        'find last asc': 'elf last asc',
        'find last char': 'elf last char',
        'find last not asc': 'elf last not asc',
        'find last not char': 'elf last not char',
        'find control': 'elf control',
        'find nth asc': 'elf nth asc',
        'find nth char': 'elf nth char',
        'find num asc': 'elf num asc',
        'find num char': 'elf num char',
        // strings, memory, banks and messages. `bank name$` is the one
        // contested name in the whole extension -- core, AMCAF and Range all
        // spell it -- and an alias is already bound per slot, exactly as
        // `qualified` is, so it collides with nothing
        'long$': 'ellong$',
        long: 'ellong',
        'word$': 'elword$',
        word: 'elword',
        extb: 'elextb',
        extw: 'elextw',
        'mem$': 'elmem$',
        mem: 'elmem',
        'mem inc': 'elmem inc',
        'bank name$': 'elbank name$',
        'set bank name': 'els bank name',
        'message$': 'elmessage$',
        // the bitwise block
        wtst: 'elwtst',
        ltst: 'elltst',
        wset: 'elwset',
        lset: 'ellset',
        wclr: 'elwclr',
        lclr: 'ellclr',
        wchg: 'elwchg',
        lchg: 'ellchg',
        // PowerPacker. 1.0 has no `elpp allocate` -- it arrived later.
        'pp load': 'elpp load',
        'pp buf': 'elpp buf',
        'pp len': 'elpp len',
        'pp free': 'elpp free',
        'pp crunch': 'elpp crunch',
        'pp keep on': 'elpp keep on',
        'pp keep off': 'elpp keep off',
        // system, AmigaDOS and fonts. 1.0 has no exists/exec/compiled/pro/
        // reset/stdin/font-open keywords at all, and its `amos data` was
        // folded into `El Base(0)`.
        'easy base': 'el base',
        protect: 'elprotect',
        'set protect': 'els protect',
        'raster wait': 'elraster wait',
        'output exists': 'elout exists',
        output: 'elout',
        // the Workbench three; 1.0 has no XPK
        'i open workbench': 'elwb open',
        'i close workbench': 'elwb close',
        'i test workbench': 'elwb test',
        // and 1.0's single iconify keyword, which is the later build's
        // `Eliconify Amos` -- it has none of the other three
        'iconify amos': 'eliconify amos',
        /*
         * The font pair. 1.0's routines 111 and 112 do the job 1.09/1.10 give
         * to `elopen font` (160) and `elclose fonts` (163) -- OpenDiskFont on
         * a name and a size, and CloseFont over the whole list -- but the
         * lists are not the same shape: 1.0 keeps a count word and up to
         * thirty-one longwords at `$56`, and 1.09 a chain at `$7c`. The
         * KEYWORD is what an alias binds, and that is unchanged.
         *
         * 1.44 is the odd one: it spells them `ellock font` and
         * `elunlock fonts` on routines 111 and 112, 1.0's own numbers, so the
         * rename to `elopen font` happened in 1.09 and 1.44 was branched from
         * before it. Those two are aliased under their own id below.
         */
        'lock font': 'elopen font',
        'unlock fonts': 'elclose fonts',
        /*
         * `Amos Data` is 1.0's routine 107 ($1530), SIX BYTES: `move.l a5,d3
         * / moveq #$0,d2 / rts` — a5 itself, which is what `El Base(0)`
         * answers. The alias reaches `el base` with no argument, so `n`
         * defaults to 0 and takes that arm; it answers 0 here, because a5 is
         * AMOS's own system base and this port has no address for it.
         */
        'amos data': 'el base',
        // the zone-bank pair, both onto the one keyword 1.10 folded them into
        'zb multi add': 'elzb multi add',
        'zb install': 'elzb multi add',
      },
      /*
       * 1.44's two survivors of the font rename. Everything else in 1.44
       * shares 1.10's spelling.
       */
      'easylife-1.44': {
        'ellock font': 'elopen font',
        'elunlock fonts': 'elclose fonts',
      },
    },
  },
  {
    // Range 2.6 and 2.9Plus at slot 9 --- Shadow Software's AMOS Club
    // extension, shipped with TOME IV. 2.6's token table is a strict PREFIX
    // of 2.9Plus's, so one port serves both, as TOME 3.1/4.23 does. Five
    // armed contested names, the most of any extension here. See range.ts.
    ids: ['range-2.0', 'range-1.0'],
    init: (rt) => {
      rt.range = newRangeState()
    },
    instructions: makeRangeInstructions,
    functions: makeRangeFunctions,
    // `library open` and `library close` are 2.9Plus's and arrive with the
    // slice that implements them --- extimpl.test.ts requires a qualified
    // name to be one this port already defines, which is what stops the list
    // rotting into a wish
    qualified: ['range', 'bank name', 'bank name$'],
  },
  {
    // DME 2.0 at slot 15 --- Thomas Reetz's DOOM Music Extension, fifteen
    // formats in one library. Batch 1 of two: the ProTracker block over
    // ../amiga/protracker.ts, plus the 37 `nop` rows. See dme.ts.
    ids: ['dme-2.0'],
    init: (rt) => {
      rt.dme = newDmeState(rt)
    },
    instructions: makeDmeInstructions,
    functions: makeDmeFunctions,
    errors: DME_ERRORS,
    // Ten names DME shares with two extensions that were ported first, and
    // not one of them at a shared id --- which is what put DME on versweep's
    // `renumbered` list. THX 0.6 (slot 20) and P61 1.2 keep the bare keys
    // because they got here first; DME answers under its own slot.
    qualified: [
      'thx play',
      'thx stop',
      'thx load',
      'thx volume',
      'thx subsongs',
      'thx end',
      'p61 play',
      'p61 stop',
      'p61 pause',
      'p61 volume',
    ],
  },
  {
    // SymBase 0.94 and DBench 0.42 at slot 21 --- Lazar Zoltan's xBase engine,
    // one product at two ages. Batch 2 of four: channels and navigation. See
    // symbase.ts, and dbf.ts for the file format under it.
    ids: ['symbase-0.94', 'dbench-0.42'],
    init: (rt) => {
      rt.symbase = newSymBaseState(rt)
    },
    instructions: makeSymBaseInstructions,
    functions: makeSymBaseFunctions,
    errors: SYMBASE_ERRORS,
  },
  {
    // MAXS Door Handler 0.20 at slot 16 --- Ari Tsironis's door protocol for
    // MAX's BBS, SOURCE tier (_MAXSDoorHandler.s ships with it). Twenty-one
    // keywords over one 106-byte message. See maxsdoor.ts.
    ids: ['maxsdoor-0.20'],
    init: (rt) => {
      rt.maxsDoor = newMaxsDoorState()
    },
    instructions: makeMaxsDoorInstructions,
    functions: makeMaxsDoorFunctions,
  },
  {
    // Display 0.01 at slot 24 --- "JB"'s 2011 copper-list helper, the youngest
    // extension registered here. Six keywords over a dual-playfield list it
    // builds itself in two chip buffers. See displayext.ts.
    ids: ['display-0.01'],
    init: (rt) => {
      rt.displayExt = newDisplayExtState(rt)
    },
    instructions: makeDisplayExtInstructions,
    functions: makeDisplayExtFunctions,
  },
  {
    // First 0.1 at slot 22 --- Pedro Gil's 248-byte first extension. Three
    // CIA-A PRA accesses and one AMOS call. See first.ts.
    ids: ['first-0.1'],
    instructions: makeFirstInstructions,
    // Explode 2.01 spells `Wait Mouse` too.
    qualified: ['wait mouse'],
  },
  {
    // FileID 1.0 at slot 25 --- Haiko Lemser's wrapper around FileID.library,
    // which this port does not model. SOURCE tier: FileID.s ships with it.
    // See fileid.ts.
    ids: ['fileid-1.0'],
    init: (rt) => {
      rt.fileId = newFileIdState()
    },
    functions: makeFileIdFunctions,
    errors: FILEID_ERRORS,
  },
  {
    // Dump 1.1 at slot 20 --- Alex J. Grant and Francois Lionet's printer
    // dump plus raw trackdisk.device access. Functions only. See dump.ts.
    ids: ['dump-1.0'],
    init: (rt) => {
      rt.dump = newDumpState()
    },
    functions: makeDumpFunctions,
  },
  {
    // CRAFT 1.0 at slot 18 --- Hannu Rummukainen's toolbox for Black Legend.
    // Eight unrelated groups; the string and memory ones are here, the rest
    // arrive in later batches. It opens no library at all, so there is no
    // init hook and nothing to tear down. See craft.ts.
    ids: ['craft-1.0'],
    init: (rt) => {
      rt.craft = newCraftState()
    },
    // "This instruction is automatically executed when an AMOS program is run
    // or a Default instruction is used" -- the manual on Dr Forget, and it
    // says the same of Tr Reset ("this instruction is also automatically...")
    defaults: (rt) => {
      craftForget(rt)
      craftTrReset(rt)
      craftFrReset(rt)
    },
    functions: makeCraftFunctions,
    instructions: makeCraftInstructions,
    errors: CRAFT_ERRORS,
    /*
     * `contested` puts CRAFT against another table on exactly four names --
     * `amos pri` with TURBO Plus, `open workbench` and `pal spread` with
     * AMCAF, `set protect` with EasyLife. Three of the four are now live and
     * qualified: `pal spread` and `open workbench` against AMCAF, which
     * already qualifies both from its side, and `amos pri` against TURBO
     * Plus. `pal spread` is the interesting one -- the two are different
     * keywords that happen to share a spelling, "I0,0t0,0" against "I0t0",
     * two colour VALUES against two colour REGISTERS. `set protect` stays
     * unqualified: EasyLife reaches the same SetProtection through an alias,
     * so one handler serves both (see ALLOWED_UNDECLARED in
     * contested.test.ts).
     *
     * Nothing else is listed, and that is deliberate: qualifying a name that
     * does not collide moves it out of reach. It is what made `Mem Type` parse
     * as a zero-argument function and print its own argument beside it.
     */
    qualified: ['pal spread', 'open workbench', 'amos pri', 'file type'],
  },
  {
    /*
     * The three keywords appended to APD426's Music.Lib, at the same slot 1
     * the stock library holds. Everything below `set talk` ($01fa) is that
     * library and is already registered by the core Music layer, so this
     * entry adds three names and no more. See musicomega.ts for why the
     * registry needs the identity at all: the ids collide with `sload` and
     * `sam swapped`, which AMOS Pro put at the same offsets.
     */
    ids: ['music-omega-1.0'],
    init: (rt) => {
      rt.musicOmega = newMusicOmegaState(rt)
    },
    instructions: makeMusicOmegaInstructions,
  },
  {
    // MusiCRAFT 1.0 at slot 19 --- CRAFT's companion, and the same author's.
    // The slot is no longer only observed: routine 0 is `move.l a4,$218(a5)`,
    // and `$f8 + 18*16` IS $218 on the ExtAdr layout, so the binary says 19
    // the way Jotre's says 22. It fills the whole entry --- $21c (DEFAULT) and
    // $220 (REMOVE) both get the St Stop routine at $1fa, so `Default` stops a
    // song, and the fourth longword at $224 gets $158, which re-checks that
    // the bank St Play was given is still a "Tracker " bank and stops the
    // player if it is not. A stock PT2.1A replayer with eleven keywords in
    // front of it; the tick is an exec VERTB server and is stepped from
    // Runtime.frame(). See musicraft.ts.
    ids: ['musicraft-1.0'],
    init: (rt) => {
      rt.musicraft = newMusicraftState(rt)
    },
    defaults: (rt) => {
      musicraftStop(rt)
    },
    instructions: makeMusicraftInstructions,
    functions: makeMusicraftFunctions,
    errors: MUSICRAFT_ERRORS,
    /*
     * `st load` is the extension's one contested name, against EasyLife's
     * structure loader. The two do not in fact reach each other --- EasyLife's
     * is `=St Load(FILENAME$)`, a function, and this one is an instruction, so
     * they sit in different dispatch tables --- but the invariant in
     * contested.ts is by name and the cost of honouring it is nothing. This
     * side qualifies; EasyLife's keeps the plain key it has always had.
     */
    qualified: ['st load'],
  },
  {
    // Jotre 1.0 at slot 22 --- Thomas Verduin's five-keyword shim over an
    // embedded THX Sound System 2.0 replayer. No functions, and no `defaults`
    // hook: routine 0 installs its teardown at the slot entry's +$8 (REMOVE)
    // rather than +$4 (DEFAULT), so `Default` does not stop a song. Its
    // per-frame gate is stepped from Runtime.frame(). See jotre.ts.
    ids: ['jotre-1.0'],
    init: (rt) => {
      rt.jotre = newJotreState(rt)
    },
    instructions: makeJotreInstructions,
    errors: JOTRE_ERRORS,
  },
  {
    // THX 0.6 at slot 20 --- Thomas Nokielski's six keywords over the same
    // format Jotre plays, and no code in common with it. Its VBL hook takes
    // the first FREE slot rather than a fixed one, and is stepped from
    // Runtime.frame(). No `defaults` hook: its +$4 is one AMOS call and an
    // rts, and its +$c is the bare rts the author called an empty bank check.
    // See thx.ts.
    ids: ['thx-0.6'],
    init: (rt) => {
      rt.thx = newThxState(rt)
    },
    instructions: makeThxInstructions,
    functions: makeThxFunctions,
    errors: THX_ERRORS,
    /**
     * All six, because DME 2.0 carries a `thx *` block with the same six names
     * and NOT ONE id in common — so a program written for one detokenises to
     * nonsense under the other. DME's is unported; binding these by bare name
     * would hand its programs this implementation of a keyword that means
     * something else to them.
     */
    qualified: ['thx play', 'thx stop', 'thx load', 'thx volume', 'thx subsongs', 'thx end'],
  },
  {
    // TOME 4.23 and 3.1 share one port: 3.1's table is a strict prefix of
    // 4.23's, identical down to the routine numbers, with one rename that
    // `aliases` carries. See tome.ts.
    ids: ['tome-4.23', 'tome-3.1'],
    init: (rt) => {
      rt.tome = newTomeState()
    },
    instructions: makeTomeInstructions,
    functions: makeTomeFunctions,
    aliases: { 'tome-3.1': { 'tile val bank': 'tile typ bank' } },
  },
  {
    ids: ['amos3d-1.0'],
    init: (rt) => {
      rt.td = newTdState()
    },
    instructions: makeTdInstructions,
    functions: makeTdFunctions,
    errors: TD_ERRORS,
  },
  {
    ids: ['personal-1.0b', 'personnal-1.1'],
    init: (rt) => {
      rt.personnal = newPersonnalState()
    },
    instructions: makePersonnalInstructions,
    functions: makePersonnalFunctions,
    defaults: personnalDefault,
    // core owns Sprite Col and TURBO owns Right Click
    qualified: [
      'sprite col', 'right click',
      // Intuition 1.3b spells `Ehb` and `Ham`, and DME 2.0 spells the two P61
      // names P61 1.2 already qualifies from its side -- so Personnal held the
      // plain key for both and answered DME's programs with it.
      'ehb', 'ham', 'p61 play', 'p61 stop',
    ],
    errors: PERSONNAL_ERRORS,
  },
  {
    /*
     * AMCAF, slot 8. One port for both releases: 1.50 is 1.40 plus twelve
     * keywords, sharing 268 names, which is why the 1.50 manual documents
     * 1.40. No error table — the extension ships no message strings at all
     * and fails through AMOS's own numbers.
     *
     * The qualified list is the seven ARMED contested names, where the other
     * side is already ported and a plain registration would silently replace
     * a working implementation: six are Personnal's and Sload/Ssave belong to
     * the Music extension and EME. On the machine these are different tokens
     * at different slots and coexist; `ext8:` reproduces that.
     */
    ids: ['amcaf-1.40', 'amcaf-1.50'],
    init: (rt) => {
      rt.amcaf = newAmcafState()
    },
    instructions: makeAmcafInstructions,
    functions: makeAmcafFunctions,
    errors: AMCAF_ERRORS,
    /*
     * The armed contested names, registered per slot. Personnal keeps the
     * plain ones; on the machine these are different tokens at different
     * slots and coexist, which is what ext8: reproduces.
     *
     * `raster wait` is the newest: EasyLife spells it too, at slot 16, and
     * became a ported product with slice 1, which is what turns the name from
     * armed into live. AMCAF's is bound to AMCAF's slot here; EasyLife's own
     * arrives with the slice that implements it, and until then a program at
     * slot 16 gets the unimplemented answer rather than AMCAF's routine.
     */
    // `open workbench` and `pal spread` are CRAFT's names as well
    qualified: [
      'set ntsc', 'set pal', 'speek', 'blitter copy limit', 'blitter copy', 'blitter clear', 'raster wait',
      'open workbench', 'pal spread',
      // and four an UNPORTED product claims, which is the same collision with
      // nobody on the other side to declare it: Explode 2.01 spells `Bank To
      // Chip`, `Even` and `Odd`, and DME 2.0 spells `Nop` -- as a FUNCTION,
      // where AMCAF's is an instruction. See answeredForUnported in contested.ts.
      'bank to chip', 'even', 'odd', 'nop',
    ],
    /*
     * 1.50's two additions, which its own guide says ARE Music's:
     *
     *   V1.43 02-Nov-96
     *   - Added Sload/Ssave. Just the same commands like in the music
     *     extension. Now you can really remove it!
     *
     * Routines 106 ($38e8) and 107 ($3922) bear that out: both resolve the
     * channel through the same `$8bc(a5)` table AMOS's own file channels live
     * in and hand off to a shared reader. Three differences, all narrower
     * rather than different -- the channel is bounded 1..9 where Music takes
     * 1..10, there is no open-mode check, and no refusal of a zero length --
     * so a program written against Music runs unchanged, and one written
     * against AMCAF stays inside what Music accepts. Music's contract is the
     * one kept; see contested.test.ts, which records the same decision from
     * the collision side.
     */
    viaCore: ['sload', 'ssave'],
  },
  {
    // the speech slice of the Music extension: Say, and the mouth stream.
    // EME 3.0 keeps all of it at the same ids and specs — the AMOS Pro build
    // has the whole seven, the AMOS 1.3 one only Say and Set Talk, and
    // music-omega-1.0 is an AMOS 1.3 one: `!say` $01e4 and `set talk` $01fa,
    // the last two entries before its own three were appended
    ids: ['amospro-music-2.0', 'eme-3.0', 'eme-3.0-demo', 'music-omega-1.0'],
    init: (rt) => {
      rt.speech = newSpeechState()
    },
    instructions: makeSpeechInstructions,
    functions: makeSpeechFunctions,
  },
  {
    // EME 3.0 IS the Music extension — it ships as AMOSPro_Music.Lib and is
    // copied over the stock one, so it takes slot 1 with all 49 stock
    // keywords at their own ids and adds ten. Only the ten are here; the
    // stock half is the core Music implementation, unchanged.
    ids: ['eme-3.0', 'eme-3.0-demo'],
    instructions: makeEmeInstructions,
    functions: makeEmeFunctions,
    /**
     * The stock 49, which EME copied in order to BE compatible with them —
     * same ids, same specs, nothing renamed. The core Music implementation
     * answers all of them and that is the extension working, not the port
     * missing something; without saying so the manifest reports a finished
     * extension at 17% and points at keywords that already run.
     *
     * `say` and the six speech keywords are not here because core does not
     * implement them either — the speech slice above does, and EME is bound
     * to it by `ids` for exactly this reason.
     */
    viaCore: [
      'mubase', 'vumeter', 'voice', 'music off', 'music stop', 'tempo', 'music',
      'noise to', 'boom', 'shoot', 'sam bank', 'sam loop on', 'sam loop off',
      'sample', 'sam play', 'sam raw', 'bell', 'play off', 'play', 'set wave',
      'del wave', 'set envel', 'mvolume', 'volume', 'wave', 'led on', 'led off',
      'sload', 'sam swapped', 'sam swap', 'sam stop', 'track stop',
      'track loop on', 'track loop of', 'track play', 'track load', 'ssave',
      'med load', 'med play', 'med stop', 'med cont', 'med midi on',
    ],
  },
  {
    // slot 23, which the source names itself: `ExtNb equ 23-1`. Twenty-seven
    // named colour constants and nothing else — no state, no init, no
    // defaults, and the library's own hook routines are bare rts
    ids: ['amospro-colours-1.0'],
    functions: makeColoursFunctions,
  },
  {
    // slot 23 as well — Misc's source bakes in the same `ExtNb equ 23-1` that
    // Colours does, and its manual tells the user to type it into config
    // number 23. They share no keyword name, so nothing is contested here;
    // on a real machine only one of them can be loaded
    ids: ['misc-1.0'],
    init: (rt) => {
      rt.miscExt = newMiscExtState()
    },
    instructions: makeMiscExtInstructions,
  },
  {
    // slot 17, `ExtNb Equ 17-1`. Two functions reporting the version of the
    // Personnal library in slot 13 — no state of its own beyond the `_Exist`
    // flag, which is derived from the bindings rather than stored
    ids: ['personnal-extra-1.0a'],
    functions: makePlibFunctions,
  },
  {
    // serial-1.2 is AMOS 1.3's standalone Serial.Lib, which AMOS Pro absorbed
    // into IOPorts along with parallel and printer. Its nineteen table entries
    // are a byte-identical PREFIX of this one's forty-five — same ids, names
    // and specs — and the routines agree instruction for instruction with
    // +IO_Ports.s on the same IOExtSer offsets; see the `serial speed` note.
    // No parallel or printer keyword exists in it, so the extra 26 are simply
    // not in its table and nothing is over-credited
    ids: ['amospro-ioports-2.0', 'serial-1.2'],
    init: (rt) => {
      rt.ioports = newIoPortsState()
    },
    instructions: makeIoPortsInstructions,
    functions: makeIoPortsFunctions,
  },
  {
    // 'ctext-1.0' is the registry's stable key for CText; the library is 1.32
    ids: ['ctext-1.0'],
    init: (rt) => {
      rt.ctext = newCtextState()
    },
    instructions: makeCtextInstructions,
    functions: makeCtextFunctions,
    // Explode 2.01 spells `Font Base` too, and takes two arguments to this
    // one's none.
    qualified: ['font base'],
  },
  {
    // D-Sam 1.01 at slot 15 --- `lea $66a(pc),a2 / move.l a2,$1d8(a5)` in
    // routine 0, and ($1d8-$f8)/16 is 14, the slot zero-based. Fifty keywords
    // that play a sample off disk rather than out of memory; see dsam.ts.
    ids: ['d-sam-1.01'],
    init: (rt) => {
      rt.dsam = newDsamState()
    },
    instructions: makeDsamInstructions,
    functions: makeDsamFunctions,
    errors: DSAM_ERRORS,
  },
  {
    ids: ['sticks-1.01b'],
    init: (rt) => {
      rt.sticks = newSticksState()
    },
    instructions: makeSticksInstructions,
    functions: makeSticksFunctions,
  },
  {
    // GameSupport 1.2 at slot 23 --- Alastair M. Robinson's toolkit. The slot
    // is `ExtNb equ 23-1` in his own source AND `move.l a3,$258(a5)` in the
    // binary, which agree. Its cold start seeds four mouse counters off the
    // live registers, so `init` needs the Runtime. See gamesupport.ts.
    ids: ['gamesupport-1.2'],
    init: (rt) => {
      rt.gamesupport = newGameSupportState(rt)
    },
    instructions: makeGameSupportInstructions,
    functions: makeGameSupportFunctions,
    errors: GAMESUPPORT_ERRORS,
  },
  {
    // SLN 2.0 at slot 24 --- Søren Nielsen's toolbox. `ExtNb equ 24-1` in his
    // own `sln_extII.s`, which is the whole extension rather than a shell.
    // See sln.ts for what the 70 names cover and which one is not real.
    ids: ['sln-2.0'],
    init: (rt) => {
      rt.sln = newSlnState(rt)
    },
    instructions: makeSlnInstructions,
    functions: makeSlnFunctions,
    errors: SLN_ERRORS,
  },
  {
    // Make Lib 1.30 at slot 17 --- `move.l a3,$1f8(a5)` in routine 0, and its
    // own doc says "The extension number of MakeLib is 17." exec's memory and
    // list routines, a C-shaped stdio, and three graphics keywords; see make.ts
    ids: ['make-1.30'],
    init: (rt) => {
      rt.make = newMakeState()
    },
    instructions: makeMakeInstructions,
    functions: makeMakeFunctions,
    errors: MAKE_ERRORS,
  },
  {
    // LSerial 2.1 at slot 11 --- Niklas Sjoberg's serial.device wrapper,
    // written because AMOS's own would not reopen a closed device. The doc is
    // unusually firm about the slot: "you MUST place LSerial as extension
    // number eleven (11)", and routine 0's `$198(a5)` agrees. See lserial.ts
    ids: ['lserial-2.1'],
    init: (rt) => {
      rt.lserial = newLSerialState()
    },
    instructions: makeLSerialInstructions,
    functions: makeLSerialFunctions,
    errors: LSERIAL_ERRORS,
  },
  {
    // BUtility 1.21 at slot 12 --- Mariusz Rycyk's freeware facade over
    // reqtools, asl and xpkmaster. Routine 0 returns `moveq #$b,d0` = 11 =
    // ExtNb and writes `$1a8(a5)`, both of which say slot 12, and the readme
    // agrees: "Install BUtility.Lib as extension number 12". See butility.ts
    ids: ['butility-1.21'],
    init: (rt) => {
      rt.butility = newBUtilityState()
    },
    instructions: makeBUtilityInstructions,
    functions: makeBUtilityFunctions,
    errors: BUTILITY_ERRORS,
  },
  {
    // Delta 1.4 at slot 15 --- Lukasz Zelezny's public-domain toolbox. Routine
    // 0 is `moveq #$e,d0 / rts` and nothing else; the guide says slot 15. Five
    // of its fourteen instructions are Misc 1.0's routines instruction for
    // instruction, inverted drive-motor defect and all; see delta.ts
    /*
     * 1.6 IS BOUND HERE TOO, and it costs nothing: all 26 of 1.4's entries sit
     * at the id 1.6 gives the same keyword -- checked entry for entry, none
     * moved and none absent, so 1.6 appended and did not rebuild. That is the
     * whole test for whether one port can serve two identities, and it is the
     * same evidence identifySlot resolves a slot with.
     *
     * Without the second id, a program bound to 1.6 got NOTHING from a port
     * that already answers 26 of its 46 keywords, and the coverage table read
     * 0% beside a row saying "26 of the 46 are Delta 1.4's, already faithful".
     *
     * ONE KEYWORD DISAGREES BETWEEN THE TWO, and delta.ts's `isDelta16`
     * tells them apart from `rt.extBindings`, the way jdprt.ts's `isPre14`
     * and amon.ts's `isAmon103` do. `Delta Decrunch` is routine 3 in both;
     * 1.4 raises AMOS's numbered errors from it, `moveq #$17,d0 / Rjmp
     * L_Error` for 23 and `#$1d` for 29, and 1.6 sends the same two checks
     * to its own message table instead, "Variable is too small" and
     * "Variable is too large".
     *
     * An UNBOUND program — identified by token table alone — cannot be told
     * apart, so the port still needs a default, and 1.4 is it: the release
     * delta.ts was read from. That limit is real and is not going away.
     */
    ids: ['delta-1.4', 'delta-1.6'],
    init: (rt) => {
      rt.delta = newDeltaState()
    },
    instructions: makeDeltaInstructions,
    functions: makeDeltaFunctions,
    errors: DELTA_ERRORS,
  },
  {
    // Tools 1.01 at slot 23 --- Tor Erik Ottinsen's personal toolbox, made
    // public. `move.l a3,$258(a5)` in routine 0, and the guide's install note
    // says to put it in slot 23. Eleven of the 33 are the `Oui` keywords its
    // author declined to document; see tools.ts for what they turned out to be
    ids: ['tools-1.01'],
    init: (rt) => {
      rt.tools = newToolsState()
    },
    instructions: makeToolsInstructions,
    functions: makeToolsFunctions,
    errors: TOOLS_ERRORS,
    // Range 2.6/2.9Plus claims `range` as well, and both are ported now --- the
    // guide even says whose it was first, "a somewhat optimized version of the
    // Range command in the Shuffle Extension"
    qualified: ['range'],
  },
  {
    // Opal 1.1 at slot 21 --- Martin Boyd's shim over opal.library, the
    // OpalVision 24-bit card's driver. `ExtNb EQU 21-1` in the extension's own
    // source, `$238(a5)` in the assembled binary, and Andrew Burton's list and
    // the AMOS FAQ both put OpalVision at 21. Opal Technology published the
    // library's AutoDocs, its include files and the library itself as
    // devdocs.lha, so the shim is SOURCE tier over a documented library; the
    // card is modelled in ../amiga/opalvision.ts. See opal.ts
    ids: ['opal-1.1'],
    init: (rt) => {
      rt.opal = newOpalState(Runtime.OPAL_BASE, Runtime.OPAL_RESERVED)
    },
    instructions: makeOpalInstructions,
    functions: makeOpalFunctions,
    errors: OPAL_ERRORS,
  },
  {
    // stars.lib (AMOS 1.3) and starspro.lib (AMOS Pro) are different binaries
    // with a byte-identical token table, so one port answers for both
    ids: ['stars-2.33'],
    init: (rt) => {
      rt.stars = newStarsState()
    },
    instructions: makeStarsInstructions,
    functions: makeStarsFunctions,
  },
  {
    // AGA.lib and AMOSPro_AGA.lib share one token table, so this covers
    // AMOS 1.3 and AMOS Pro; v0.09 shipped no library at all
    ids: ['aga-1.0'],
    init: (rt) => {
      rt.aga = newAgaState()
    },
    instructions: makeAgaInstructions,
    functions: makeAgaFunctions,
  },
  {
    // 5.9 renumbered the token table but kept the vocabulary; dispatch is by
    // name, so one port serves both (see jd.ts). 4.6 is the EARLIER release
    // and its table is a subset of 5.3's --- it was left out of this list and
    // then reported 100% anyway, because the manifest credited it for names
    // this port implements under 5.3. Declared now, so the credit is real.
    ids: ['jd-4.6', 'jd-5.3', 'jd-5.9'],
    init: (rt) => {
      rt.jd = newJdState()
    },
    instructions: makeJdInstructions,
    functions: makeJdFunctions,
    errors: JD_ERRORS,
    /**
     * 4.6 carried the six slides in THIS library, at routines 98 to 103, and
     * 5.3 moved them to JD Colour, which has the same six at routines 41 to
     * 46 -- identical instruction for instruction. Both libraries can be
     * loaded at once, at different slots, so the name is qualified in both
     * and each slot dispatches to its own binding. The implementation is
     * shared; see makeJdSlides in jdcolour.ts.
     */
    qualified: ['jd slide x', 'jd slide y', 'jd slide left', 'jd slide right', 'jd slide up', 'jd slide down'],
  },
  {
    // the K3 companion at slot 19 — six keywords, sharing the JD state
    ids: ['jd-k3-1.1'],
    instructions: makeJdK3Instructions,
    functions: makeJdK3Functions,
    // K3's Jd Relabel is dos.library's; the main JD library's keyword of the
    // same name rewrites a root block through trackdisk and stays n/a. Bound
    // to K3's own slot so the two do not become one. See jdk3.ts.
    qualified: ['jd relabel'],
    errors: JD_ERRORS,
  },
  {
    /*
     * JD Intuition 1.3 at slot 18 --- an Intuition screen, a window on it,
     * graphics.library primitives and an IDCMP loop. The slot is the binary's
     * own twice over: routine 0 ends `moveq #$11,d0` and every routine reaches
     * its data zone through `$208(a5)`, which is `$f8 + 17*16`. See jdint.ts.
     */
    ids: ['jd-int-1.3'],
    init: (rt) => {
      rt.jdint = newJdIntState()
    },
    instructions: makeJdIntInstructions,
    functions: makeJdIntFunctions,
  },
  {
    /*
     * AMon at slot 25 (1.04) and slot 16 (1.03) --- Paul Overy's hardware
     * mouse, keyboard, joystick, fixed-point trig and four fast graphics
     * primitives, written so a game can Forbid the multitasking system and
     * still read its input. The slot is the binary's: routine 0 publishes the
     * zone to `$278(a5)` = `$f8 + 24*16` and ends `moveq #$18,d0`.
     *
     * ONE PORT FOR BOTH RELEASES. Seventeen of the eighteen shared routines
     * are the same instructions; the two that a program can tell apart --- the
     * rodent limits 1.03 ships as zeros, and Fast Circle's error number ---
     * are asked for by identity rather than guessed. See amon.ts.
     */
    ids: ['amon-1.03', 'amon-1.04'],
    init: (rt) => {
      rt.amon = newAmonState(isAmon103(rt) ? { minX: 0, maxX: 0, minY: 0, maxY: 0 } : undefined)
    },
    instructions: makeAmonInstructions,
    functions: makeAmonFunctions,
  },
  {
    /*
     * Explode 2.01 at slot 7 --- Volker Stepprath's toolbox: packers, banks,
     * files, a structure allocator, bitplanes, fonts and system odds. SOURCE
     * tier, and the slot is the source's own, `ExtNb equ 7-1`. Being ported
     * in batches by functional group; see explode.ts.
     */
    ids: ['explode-2.01'],
    init: (rt) => {
      rt.explode = newExplodeState()
    },
    instructions: makeExplodeInstructions,
    functions: makeExplodeFunctions,
  },
  {
    // the Colour companion, its own library at its own slot (ExtNb equ 20-1)
    ids: ['jd-colour-1.4', 'jd-colour-2.0'],
    init: (rt) => {
      rt.jdColour = newJdColourState()
    },
    instructions: makeJdColourInstructions,
    functions: makeJdColourFunctions,
    // the six slides are 4.6's too; see the JD entry above
    qualified: ['jd slide x', 'jd slide y', 'jd slide left', 'jd slide right', 'jd slide up', 'jd slide down'],
  },
  {
    /*
     * The three GUI releases by Pietro Ghizzoni, 48 keywords in the 1.5
     * beta, 103 in 1.61, 204 in 2.10, served by one body of code, because
     * that is what they are: 45 of 1.5b's names survive into 1.61 unchanged
     * and 85 of 1.61's into 2.10. gui.ts branches on `rt.gui.release` at the
     * points where the binaries differ and nowhere else.
     *
     * 1.62 is not a fourth identity. Its token table is byte-identical to
     * 1.61's, which is what libcat calls the same library, and its guide and
     * demos are the documentation for both.
     *
     * `errors` is 2.10's thirty-five, which the other two tables are a prefix
     * of with two substitutions each; gui.ts exports all three and
     * `guiErrorOn` picks the one the bound release indexes.
     */
    ids: ['gui-2.10', 'gui-1.61', 'gui-1.5b'],
    init: (rt) => {
      rt.gui = newGuiState(guiRelease(rt))
    },
    instructions: makeGuiInstructions,
    functions: makeGuiFunctions,
    errors: GUI_ERRORS,
  },
  {
    /**
     * Andrew Church's Intuition Extension 1.3b, slot 14.
     *
     * The one row in the registry whose evidence is the author's own source
     * rather than a binary --- 26 assembler files, his comments and his
     * symbols. See ./intuition.ts's header for what is readable in it and
     * what is compiled C.
     */
    ids: ['intuition-1.3b'],
    init: (rt) => {
      rt.iext = newIextState()
    },
    instructions: makeIextInstructions,
    functions: makeIextFunctions,
    errors: IEXT_ERRORS,
  },
  {
    /*
     * Int 1.0 by D.J.Software, slot 25 by its own install note. The first
     * batch: windows, screens, menus, boolean gadgets and the event loop,
     * which are the keywords whose back end ../amiga/intuition.ts and
     * ../amiga/gadtools.ts already were, and then the drawing group, which is
     * graphics.library through wd_RPort. The row stays 0% until the input,
     * ASL and IFF groups land beside them.
     */
    ids: ['int-1.0'],
    init: (rt) => {
      rt.int = newIntState()
    },
    instructions: makeIntInstructions,
    functions: makeIntFunctions,
    errors: INT_ERRORS,
    /*
     * IntuiExtend spells six of these the same way and nobody has ported it,
     * so answering them under the bare name would hand its programs Int's
     * behaviour. Two are readers of a different thing --- IntuiExtend's `Wb
     * Screen Base` is its own screen list and Int's is the `$6d4` table ---
     * and the four drawing ones take different arguments: Int's `Wb Scroll`
     * leads with a window number that IntuiExtend's does not.
     */
    qualified: ['wb current window', 'wb screen base', 'wb box', 'wb draw', 'wb ellipse', 'wb scroll'],
  },
  {
    // the printer companion, slot 21 by its own manual. 1.1 is served through
    // `aliases` rather than by a second table: it names every keyword without
    // the `Jd ` prefix 1.3 added, and the sequences behind them are identical
    ids: ['jd-prt-1.1', 'jd-prt-1.3', 'jd-prt-1.4'],
    instructions: makeJdPrtInstructions,
    functions: makeJdPrtFunctions,
    aliases: { 'jd-prt-1.1': jdPrt11Aliases() },
  },
]

/** the ports, for the tests and docs that need to see the contract */
export function extensionImpls(): readonly ExtensionImpl[] {
  return EXT_IMPLS
}

/** every layer's table, labelled, with qualified names bound to their slots */
function layers<T>(
  rt: Runtime,
  kind: 'instructions' | 'functions',
  core: Record<string, T>,
): Array<[string, Record<string, T>]> {
  const out: Array<[string, Record<string, T>]> = [['core', core]]
  for (const impl of EXT_IMPLS) {
    const make = impl[kind] as ((rt: Runtime) => Record<string, T>) | undefined
    if (!make) continue
    const slots = implSlots(impl, rt.extBindings)
    // `raw` is passed on to aliasForSlots because qualifyForSlots consumes the
    // plain names it moves, and an alias resolves its target by plain name
    const raw = make(rt)
    const table = qualifyForSlots(raw, impl.qualified ?? [], slots)
    out.push([implLabel(impl), aliasForSlots(table, raw, impl.aliases, rt.extBindings)])
  }
  return out
}

function mergeLayers<T>(layered: Array<[string, Record<string, T>]>): Record<string, T> {
  const out: Record<string, T> = {}
  for (const [, table] of layered) for (const [k, v] of Object.entries(table)) if (!(k in out)) out[k] = v
  return out
}

function instrLayers(rt: Runtime): Array<[string, Record<string, Instr>]> {
  return layers(rt, 'instructions', makeInstructions(rt))
}

function funcLayers(rt: Runtime): Array<[string, Record<string, Func>]> {
  return layers(rt, 'functions', makeFunctions(rt))
}

/**
 * Names that `src/interp/builtins.ts` defines AND a runtime layer redefines.
 *
 * builtins is the no-runtime fallback: `new Interp(...)` without an
 * `instructions` option uses it, which interp.test.ts does. Runtime.interp is
 * built as `{ ...INSTR, ...runtimeLayers }` — spread order, so the runtime wins
 * — while mergeLayers below is first-wins. Two merge directions in one pipeline
 * is confusing enough that the overlap has to be declared rather than
 * discovered, especially since the builtins entries here are thin stubs over
 * `it.io.*` and the runtime ones are the real ports (builtins `cls` calls
 * `it.io.cls?.()`; the runtime `cls` is InCls +Lib.s:8722 with windows,
 * regions and colours).
 *
 * These nine are deliberate. Nothing exercises them — a standalone Interp is
 * only used by interp.test.ts and none of these appear there — so they are
 * kept as the fallback contract, not as tested code. `genmanifest` unions
 * builtins with the runtime layers when it decides what is implemented, so a
 * TENTH entry appearing here would silently take coverage credit for a stub;
 * builtinsShadowedByRuntime() plus its test is what stops that.
 */
export const DECLARED_BUILTIN_SHADOWS = new Set<string>([
  // instructions
  'centre',
  'cls',
  'curs on',
  'curs off',
  'set tab',
  // functions
  'at',
  'mouse zone',
  'command line$',
  'display height',
])

/** builtins names the runtime layer overrides, computed from the live tables. */
export function builtinsShadowedByRuntime(rt: Runtime): string[] {
  const out: string[] = []
  const instr = mergeLayers(instrLayers(rt))
  const funcs = mergeLayers(funcLayers(rt))
  for (const k of Object.keys(INSTR)) if (k in instr) out.push(k)
  for (const k of Object.keys(FUNCS)) if (k in funcs) out.push(k)
  return out.sort()
}

/** Every name claimed by more than one layer, with the layers that claim it. */
export function keywordLayerCollisions(rt: Runtime): Array<{ table: string; name: string; layers: string[] }> {
  const found: Array<{ table: string; name: string; layers: string[] }> = []
  for (const [table, layered] of [
    ['instructions', instrLayers(rt)],
    ['functions', funcLayers(rt)],
  ] as Array<[string, Array<[string, Record<string, unknown>]>]>) {
    const owner = new Map<string, string[]>()
    for (const [name, tbl] of layered) {
      for (const k of Object.keys(tbl)) owner.set(k, [...(owner.get(k) ?? []), name])
    }
    for (const [name, ls] of owner) if (ls.length > 1) found.push({ table, name, layers: ls })
  }
  return found
}

export function makeAllInstructions(rt: Runtime): Record<string, Instr> {
  return mergeLayers(instrLayers(rt))
}

export function makeAllFunctions(rt: Runtime): Record<string, Func> {
  return mergeLayers(funcLayers(rt))
}
