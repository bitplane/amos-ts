import { AmosError, ERR, VF, VI, VS, int, num, str, varType } from '../interp/values'
import { varKey } from '../interp/prescan'
import { DOSFALSE, execute } from '../amiga/process'
import { BNK, isObjectBank } from './banks'
import type { Instr, Func } from '../interp/builtins'
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
import { makeJdIntFunctions, makeJdIntInstructions, newJdIntState } from './jdint'
import { isAmon103, makeAmonFunctions, makeAmonInstructions, newAmonState } from './amon'
import { makeExplodeFunctions, makeExplodeInstructions, newExplodeState } from './explode'
import { jdPrt11Aliases, makeJdPrtFunctions, makeJdPrtInstructions } from './jdprt'
import { newTdState, TD_ERRORS, makeTdFunctions, makeTdInstructions } from './td'
import { FUNCS, INSTR, parseAmosNumber } from '../interp/builtins'
import { parseAmosFile } from '../loader/amosfile'
import { encodeIlbm, parseIlbm } from '../loader/iff'
import { packBitmap, packScreen, parsePacPic } from '../loader/pacpic'
import { parseDiskFont, parseFontDescriptor } from '../amiga/diskfont'
import { ED_MESSAGES, ED_SYSTEME, ED_TST_MESSAGES, EDM_MESSAGES } from './edmessages.gen'
import { ED_RUN_MESSAGES } from '../interp/errors.gen'
import { DEFAULT_FLASH_SPEC, Runtime, SYS_MESSAGES, extractCodeHunk, parseFlashSpec } from './runtime'
import { Screen } from './screen'
import { ObjectBank } from './objects'
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
 * The rectangle `X Mouse =`/`Y Mouse =` clamp against. On the Amiga these are
 * T_MouXMin/Max and T_MouYMin/Max, whose only writer is MLimA (+W.s:11006) —
 * `Limit Mouse`. MLimA also caps the rectangle it is given at 458x312 and
 * floors it at 0, so with no Limit Mouse in force that cap is the widest
 * bound any program could have set, and it stands in for the boot default.
 */
function mouseBounds(rt: Runtime): { x1: number; y1: number; x2: number; y2: number } {
  return rt.mouseLimit ?? { x1: 0, y1: 0, x2: 458, y2: 312 }
}

/**
 * MSetAb (+W.s:10950) one axis. The value is doubled into the fine counter
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
function screenArg(rt: Runtime, a: import('../interp/values').Value[]): Screen {
  if (a.length > 0 && int(a[0]!) >= 0) {
    const s = rt.screens.get(int(a[0]!))
    if (!s) throw new AmosError(`screen not opened: ${int(a[0]!)}`)
    return s
  }
  return rt.screen
}

/**
 * EcToD1 (+W.s:10784) — the screen a `Zone`/`Hzone`-family call names.
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
function zoneScreen(rt: Runtime, a: import('../interp/values').Value[], full: number): Screen | null {
  if (a.length < full) return rt.screen
  const n = int(a[0]!)
  if (n < -1) return null
  if (n < 0) return rt.screen
  const s = rt.screens.get(n)
  if (!s) throw new AmosError(`screen not opened: ${n}`, 47)
  return s
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

/** Vdialog(c,n)= / Vdialog$(c,n)= assignment forms (Dia_GetVariable +Lib.s:14548) */
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
 * Logbase/Phybase (FnLogBase +Lib.s:8852): bitplane addresses. The port's
 * screens are chunky, so these return stable fake addresses that resolve
 * nowhere — plane pokes are ignored (see NOTES).
 */
function planeBase(rt: Runtime, plane: number, phys: number): number {
  // Logbase(p)/Phybase(p): the address of bitplane p of the logical/physical
  // bitmap. Faithful Amiga layout — planes are `planeSize` apart (+W.s:1856),
  // and the region is backed by the screen's planar mirror (Runtime.resolveAddr).
  const s = rt.screen
  if (plane < 0 || plane >= s.depth) throw new AmosError('function call error')
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
 * Numbers are AniLong's (+W.s:7088): optional '-', decimal or $hex.
 * Groups must be juxtaposed — a comma BETWEEN groups is a syntax error
 * (RainTok +W.s:4118); lowercase letters and spaces are skipped as noise
 * (AniChr +W.s:7070). An empty string freezes the channel at its seed.
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
        if (!any) throw new AmosError('Illegal function call', 23)
      } else {
        if (!/[0-9]/.test(ch)) throw new AmosError('Illegal function call', 23)
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
      if (next() !== '(') throw new AmosError('Illegal function call', 23)
      const a = num()
      if (a <= 0) throw new AmosError('Illegal function call', 23) // ble RainTE
      if (next() !== ',') throw new AmosError('Illegal function call', 23)
      const b = num()
      if (next() !== ',') throw new AmosError('Illegal function call', 23)
      const c = num()
      if (c < 0) throw new AmosError('Illegal function call', 23) // blt RainTE
      if (next() !== ')') throw new AmosError('Illegal function call', 23)
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
 * STOS-string scanner (StChr +W.s:7494): spaces skipped, lowercase
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
      if (!any) throw new AmosError('syntax error in animation string')
    } else {
      if (!/[0-9]/.test(ch)) throw new AmosError('syntax error in animation string')
      v = ch.charCodeAt(0) - 48
      while (/[0-9]/.test(sig[p] ?? '')) v = v * 10 + (sig[p++]!.charCodeAt(0) - 48)
    }
    return neg ? -v : v
  }
  return { next, num, done: () => p >= sig.length }
}

/** Anim string "(image,delay)...[L]" (AniStos +W.s:7490) */
function parseStosAnim(src: string): { pairs: Array<[number, number]>; loop: boolean } {
  const s = stosScan(src)
  const synt = (): never => {
    throw new AmosError('syntax error in animation string')
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

/** Move string "[start](speed,step,count)...[L|E][pos]" (AnMve +W.s:7516) */
export function parseStosMove(src: string): { start: number | null; groups: Array<[number, number, number]>; loop: boolean; endPos: number | null } {
  const s = stosScan(src)
  const synt = (): never => {
    throw new AmosError('syntax error in animation string')
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

/** the ROM font list (Get Fonts / Font$) — the port carries Topaz only */
// the ROM faces plus the stock Workbench Fonts: drawer, so Set Font
// numbers that work on a real machine work here (rendering stays the
// single 8x8 face — see NOTES). examinedFonts() applies the Get Fonts
// variant's rom/disc mask.
const FONT_LIST = [
  { name: 'topaz.font', height: 8, type: 'Rom' },
  { name: 'topaz.font', height: 9, type: 'Rom' },
  ...[
    ['courier.font', [11, 13, 15, 18, 24]],
    ['diamond.font', [12, 20]],
    ['emerald.font', [17, 20]],
    ['garnet.font', [9, 16]],
    ['helvetica.font', [9, 11, 13, 15, 18, 24]],
    ['opal.font', [9, 12]],
    ['pearl.font', [8]],
    ['ruby.font', [8, 12, 15]],
    ['sapphire.font', [14, 19]],
    ['times.font', [11, 13, 15, 18, 24]],
  ].flatMap(([name, sizes]) => (sizes as number[]).map((height) => ({ name: name as string, height, type: 'Disc' }))),
]

/**
 * Sprite Base / Icon Base (Sb/AdBob +Lib.s:12792): index = |n| & $3FFF
 * with 0 erroring; a missing bank is "bank not reserved"; out of range
 * is error 74 "Icon not defined" for BOTH functions (AdBErr is shared —
 * a real 68k quirk). Positive n returns the image record's address in
 * the synthesized bank, negative n the mask pointer, which stays 0
 * (the 68k computes masks lazily).
 */
function objBase(rt: Runtime, kind: 'sprites' | 'icons', n: number): number {
  const idx = Math.abs(n) & 0x3fff
  if (idx === 0) throw new AmosError('Illegal function call', 23)
  const bank = kind === 'sprites' ? rt.spriteBank : rt.iconBank
  if (!bank) throw new AmosError('bank not reserved', 36)
  if (idx > bank.images.length) throw new AmosError('icon not defined')
  if (n < 0) return 0
  const img = rt.objectBankImage(kind)!
  const off = 2 + (idx - 1) * 8
  return (((img[off]! << 24) | (img[off + 1]! << 16) | (img[off + 2]! << 8) | img[off + 3]!) >>> 0) | 0
}

/** Frame Play/Skip core: resolve the buffer, walk, return the new address */
function framePlaySkip(rt: Runtime, ad: number, n: number, param: number | null, skip: boolean): number {
  if (n < 0 || n >= 32768) throw new AmosError('Illegal function call', 23)
  const base = ad > 0 && ad < 0x10000 ? rt.bankBase(ad) : ad
  const m = rt.bankOrAddr(ad)
  if (!m) throw new AmosError('bad IFF format')
  const end = formPlay(rt, m.data, m.off, n, param, skip)
  return base + (end - m.off)
}

/**
 * GetPut (+Lib.s:5382): record-1 must be under 65500, the channel must
 * be the random-access type ("file type mismatch"), and the offset is
 * (record-1) * record size. Callers apply their own EOF rule.
 */
function getPut(rt: Runtime, it: It): { c: NonNullable<ReturnType<Runtime['fileChans']['get']>>; off: number } {
  it.accept('#')
  const n = it.evalInt()
  it.expect(',')
  const rec = it.evalInt()
  if (rec - 1 < 0 || rec - 1 >= 65500) throw new AmosError('Illegal function call', 23)
  const c = rt.chan(n)
  if (c.mode !== 'random' || !c.fields) throw new AmosError('file type mismatch')
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
    ...(first === 'A' ? [] : vfs.volumeNames()),
    ...(first === 'D' ? [] : vfs.assignNames()),
  ].map((n) => `${n}:`)
  const entries = names
    .filter((n) => matchesJoker(filter, n))
    .map((n) => fillEntry(rt, ' ', n, null))
    .sort((a, b) => (fillSortKey(a) < fillSortKey(b) ? -1 : 1))
  rt.devIter = { entries, idx: 0 }
  return devNext(rt)
}

/** FillSort (+Lib.s:6274) compares name fields uppercased with '*' as
 * byte 1 — so directory entries bubble to the front */
function devNext(rt: Runtime): string {
  const it2 = rt.devIter
  if (!it2 || it2.idx >= it2.entries.length) return ''
  return it2.entries[it2.idx++]!
}

/** Disc fonts come from the real Fonts: drawer when one is mounted
 * (AvailFonts scans FONTS:); the synthetic Workbench list stands in when
 * there is none, so stock Set Font numbers still resolve. */
function discFontList(rt: Runtime): Array<{ name: string; height: number; type: string; file?: string }> {
  if (rt.discFontCache) return rt.discFontCache
  const out: Array<{ name: string; height: number; type: string; file?: string }> = []
  const entries = rt.vfs?.listDir('Fonts:')
  for (const e of entries ?? []) {
    if (e.isDir || !/\.font$/i.test(e.name)) continue
    const bytes = rt.vfs!.read('Fonts:' + e.name)
    const desc = bytes ? parseFontDescriptor(bytes) : null
    if (!desc) continue // corrupt descriptors are skipped, not fatal
    for (const d of desc) out.push({ name: e.name, height: d.ySize, type: 'Disc', file: d.file })
  }
  rt.discFontCache = out.length > 0 ? out : FONT_LIST.filter((f) => f.type === 'Disc')
  return rt.discFontCache
}

function examinedFonts(rt: Runtime): Array<{ name: string; height: number; type: string; file?: string }> {
  const mask = rt.fontsListed
  const rom = mask & 1 ? FONT_LIST.filter((f) => f.type === 'Rom') : []
  const disc = mask & 2 ? discFontList(rt) : []
  return [...rom, ...disc]
}

/**
 * Shift Up/Down delay,first,last[,flag] (ShD1 +Lib.s:9358): the 4th arg is
 * a wrap flag — flag 0 smears (Shf8a skips the wrap write), else the range
 * cycles. Omitted defaults to wrap (the common cycling case; the original's
 * omitted-arg polarity is unverified — see NOTES).
 */
/**
 * Dir / Dir/W / Ldir / Ldir/W (+Lib.s:5793-5880).
 *
 * The four are one routine with two flags. DirComp (wide) halves the name
 * field to WiTx/2 and packs two entries a line; ImpFlg picks the sink, and
 * ImpChaine (+Lib.s:5413) tests it first: set, every line goes to
 * PRT_Print instead of the window. The L forms set ImpFlg, which is all
 * the L means.
 */
function dirListing(it: It, rt: Runtime, wide: boolean, printer: boolean): void {
  const path = it.atStmtEnd() ? '' : it.evalStr()
  const entries = rt.vfs?.listDir(path === '' ? rt.vfs.currentDir : path)
  if (!entries) throw new AmosError('directory not found')
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
  const first = it.evalInt()
  it.expect(',')
  const last = it.evalInt()
  const wrap = it.accept(',') ? it.evalInt() !== 0 : true
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

function menuNodeFlag(it: It, rt: Runtime, set: number, clear: number): void {
  // parens = a node path; a bare number = a whole level (MnDim +ILib.s:6996)
  if (it.nm() !== '(') {
    rt.menu.setLevelFlag(it.evalInt(), set, clear)
    return
  }
  const node = rt.menu.find(menuPath(it))
  if (node) {
    node.flags = (node.flags | set) & ~clear
    rt.menu.change = true
  }
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
    throw new AmosError('function call error')
  }
  if (x2 - x1 <= 0 || y2 - y1 <= 0 || pos > total) throw new AmosError('function call error')
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
  const scr = (): Screen => rt.screen
  const byIndex = (n: number): Screen => {
    const s = rt.screens.get(n)
    if (!s) throw new AmosError(`screen not opened: ${n}`)
    return s
  }

  /**
   * The source argument of Amal / Anim / Move X / Move Y, which all share
   * Lib_Def MvA3 (+Lib.s:11838). Before looking at the argument at all, MvA3
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
  const amalSource = (it: It): string => {
    const bank = rt.refreshAmalBank()
    const v = it.evalExpr()
    if (v.k === 'str') return v.s
    if (!bank) throw new AmosError('bank not reserved', 36)
    if (bank.programs.length === 0) throw new AmosError('function call error')
    const n = int(v) & 0xffff
    if (n >= bank.programs.length) throw new AmosError('function call error')
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
    if (bank >>> 0 >= 0x10000) throw new AmosError('function call error')
    // lsr.w #3 on both X coordinates, then the far corner clamps to the
    // screen's row width and height
    dx = (dx & 0xffff) >>> 3
    const tx = Math.min((x2 & 0xffff) >>> 3, s.rowBytes) - dx
    const ty = Math.min(y2 & 0xffff, s.height) - dy
    if (tx <= 0 || ty <= 0) throw new AmosError('function call error')
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
     * Arexx Open "PORT_NAME" --- `InArexxOpen` (+Lib.s:15039). The name is
     * copied into `Arx_PortName` with two checks the manual does not mention:
     * `cmp.w #32,d2 / Rbcc L_StooLong` refuses 32 characters or more, and
     * `cmp.b #" ",-1(a0) / Rble L_FonCall` refuses any character at or below
     * a space -- so a name with a space in it is a function-call error, not a
     * port with a space in it.
     */
    'arexx open'(it) {
      const name = it.evalStr()
      if (name.length >= 32) throw new AmosError('string too long')
      for (const ch of name) if (ch <= ' ') throw new AmosError('function call error')
      if (!rt.rexx.open(name)) throw new AmosError('function call error')
      rt.arexx.port = name
    },

    /**
     * Arexx Close --- `InArexxClose` (+Lib.s:15095). Error 198 when a message
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
     * Arexx Wait --- `InArexxWait` (+Lib.s:15081): `Sys_WaitMul`,
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
     * Arexx Answer ERROR [,"answer"] --- `InArexxAnswer1`/`2` (+Lib.s:15140),
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
      if (!m) throw new AmosError('function call error')
      m.result1 = code
      if ((m.action & RXFF_RESULT) !== 0) m.result2 = answer
      m.replied = true
      rt.arexx.held = null
    },

    // ---- the Dev * family (+Lib.s:3300-3385) ---------------------------
    /**
     * Dev Open CHANNEL,NAME$,LENGTH,UNIT,FLAGS --- `Lib_Par InDevOpen`
     * (+Lib.s:3303). An empty name is a function-call error and so is a
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
      if (name === '' || len <= 0) throw new AmosError('function call error')
      if (chan < 0 || chan > DEV_MAX) throw new AmosError('function call error')
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
     * Dev Close [CHANNEL] --- `InDevClose0` and `InDevClose1` (+Lib.s:3325,
     * :3332), two entries on one name. With no argument `Dev.Close` sweeps
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
     * Dev Do CHANNEL,COMMAND --- `InDevDo` (+Lib.s:3352). The command word is
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
     * Dev Send CHANNEL,COMMAND --- `InDevSend` (+Lib.s:3363), SendIO instead
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
     * Dev Abort CHANNEL --- `InDevAbort` (+Lib.s:3374). AbortIO then WaitIO,
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
      const n = it.evalInt()
      it.expect(',')
      // EcCree +W.s:2910 masks the bitmap width down to a multiple of 16
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
      rt.closeScreen(optInt(it, rt.currentIndex))
    },
    default() {
      // InDefault +Lib.s:8710: back to the boot display — every screen
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
      // InDefaultPalette +ILib.s:5389: colours for subsequently opened
      // screens; elided entries keep their current default
      let i = 0
      for (;;) {
        if (!(it.atStmtEnd() || it.nm() === ',')) {
          if (i < 32) rt.defaultPalette[i] = it.evalInt() & 0xfff
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
      const a = it.evalInt()
      it.expect(',')
      const b = it.evalInt()
      const sa = rt.screens.get(a)
      const sb = rt.screens.get(b)
      if (!sa || !sb) throw new AmosError('screen not opened')
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
      // DualP +W.s:2870: both screens must be in dual mode; the FIRST-
      // named screen's playfield comes to the front (BPLCON2 bit 6, PFBA)
      const a = it.evalInt()
      it.expect(',')
      const b = it.evalInt()
      if (!rt.screens.has(a) || !rt.screens.has(b)) throw new AmosError('screen not opened')
      const sa = rt.screens.get(a)!
      const sb = rt.screens.get(b)!
      if (sa.dualPartner !== b || sb.dualPartner !== a) {
        throw new AmosError('screen not in dual playfield mode')
      }
      // the first-named screen's playfield comes forward
      const front = sa.dualIsBack ? sb : sa
      front.pf2Front = sa.dualIsBack
    },
    view() {
      // InView +Lib.s:9106: apply deferred display changes (CopMake)
      for (const s of rt.screens.values()) {
        if (rt.pendingView.has(s.index)) s.visible = true
      }
      rt.pendingView.clear()
    },
    'auto view on'() {
      rt.autoView = true
    },
    'auto view off'() {
      rt.autoView = false
    },
    screen(it) {
      rt.setCurrent(it.evalInt())
    },
    'screen display'(it) {
      // EcView +W.s:3276: n,x,y,w,h with per-arg keep-current; w/h set the
      // displayed-window size (EcAWTx/EcAWTy). It does NOT un-hide the screen.
      const s = byIndex(it.evalInt())
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
      const s = byIndex(it.evalInt())
      it.expect(',')
      s.offsetX = optInt(it, s.offsetX)
      if (it.accept(',')) s.offsetY = optInt(it, s.offsetY)
    },
    'screen hide'(it) {
      byIndex(optInt(it, rt.currentIndex)).visible = false
    },
    'screen show'(it) {
      byIndex(optInt(it, rt.currentIndex)).visible = true
    },
    'screen to front'(it) {
      rt.toFront(optInt(it, rt.currentIndex))
    },
    'screen to back'(it) {
      rt.toBack(optInt(it, rt.currentIndex))
    },
    'screen swap'(it) {
      const n = optInt(it, rt.currentIndex)
      rt.screens.get(n)?.swap()
    },
    'double buffer'() {
      scr().doubleBuffer()
    },
    autoback(it) {
      scr().autoback = it.evalInt() & 3
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
      // Ink [pen][,[paper]][,[border]] — border goes to the outline pen
      const s = scr()
      if (it.nm() !== ',' && !it.atStmtEnd()) s.ink = it.evalInt()
      if (it.accept(',')) {
        if (it.nm() !== ',' && !it.atStmtEnd()) s.gPaper = it.evalInt()
        if (it.accept(',') && !it.atStmtEnd()) s.gBorder = it.evalInt()
      }
    },
    plot(it) {
      const [x, y] = pair(it)
      const s = scr()
      s.plot(x, y, it.accept(',') ? it.evalInt() : s.ink)
      s.grX = x
      s.grY = y
    },
    draw(it) {
      const s = scr()
      let x1 = s.grX
      let y1 = s.grY
      if (!it.accept('to')) {
        ;[x1, y1] = pair(it)
        it.expect('to')
      }
      const [x2, y2] = pair(it)
      s.line(x1, y1, x2, y2)
    },
    'draw to'(it) {
      const s = scr()
      const [x, y] = pair(it)
      s.line(s.grX, s.grY, x, y)
    },
    'gr locate'(it) {
      const s = scr()
      ;[s.grX, s.grY] = pair(it)
    },
    box(it) {
      const [x1, y1] = pair(it)
      it.expect('to')
      const [x2, y2] = pair(it)
      scr().box(x1, y1, x2, y2)
    },
    bar(it) {
      // InBar +Lib.s:9975: x2<=x1 or y2<=y1 is a function call error
      const s = scr()
      const [x1, y1] = pair(it)
      it.expect('to')
      const [x2, y2] = pair(it)
      if (x2 <= x1 || y2 <= y1) throw new AmosError('Illegal function call', 23)
      s.bar(x1, y1, x2, y2)
      s.grX = x1 // InBar sets the graphics cursor to the top-left corner
      s.grY = y1
    },
    circle(it) {
      const s = scr()
      const [x, y] = pair(it)
      it.expect(',')
      const r = it.evalInt()
      if (r <= 0) throw new AmosError('function call error')
      // InCircle +Lib.s:9632: on a hires screen the x-radius is doubled so
      // the circle is round on non-square pixels
      s.ellipse(x, y, s.hires ? r * 2 : r, r)
      s.grX = x // the cursor ends at the centre
      s.grY = y
    },
    ellipse(it) {
      const s = scr()
      const [x, y] = pair(it)
      it.expect(',')
      const r1 = it.evalInt()
      it.expect(',')
      const r2 = it.evalInt()
      if (r1 <= 0 || r2 <= 0) throw new AmosError('function call error')
      s.ellipse(x, y, r1, r2)
      s.grX = x
      s.grY = y
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
      // InText +Lib.s:9849: cursor to x,y then advanced by the string width
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
      const s = scr()
      const n = it.evalInt()
      it.expect(',')
      s.palette[n & 31] = it.evalInt() & 0xfff
    },
    'colour back'(it) {
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
     * Get Palette n[,mask] (InGetPalette1/2 +Lib.s:9273/9279). The one-argument
     * form pushes the screen and sets the mask to -1, then falls into the
     * two-argument one — which is why an absent mask means every colour.
     *
     * The screen may be omitted: `Get Palette,0` is in the corpus
     * (APD470/HomeRun2). An omitted slot has a defined value — the comma's
     * FUNCTION routine is `FnNull` (+ILib.s:3754), which loads `EntNul`
     * ($80000000, +Equ.s:67) into d3 and steps the token pointer back two so
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
    'shift up'(it) {
      rt.shifts.set(rt.currentIndex, { dir: 1, ...shiftArgs(it), count: 0 })
    },
    'shift down'(it) {
      rt.shifts.set(rt.currentIndex, { dir: -1, ...shiftArgs(it), count: 0 })
    },
    'shift off'() {
      rt.shifts.delete(rt.currentIndex)
    },
    'set line'(it) {
      scr().linePattern = it.evalInt() & 0xffff
    },
    'set paint'(it) {
      scr().outline = it.evalInt() !== 0
    },
    'set font'(it) {
      // InSetFont +Lib.s:9835: negative errors; needs Get Fonts first
      // ("fonts not examined", error 37); Set Font 0 is a silent no-op
      // (TSFont +W.s:4922); an unknown number is "font not available"
      const n = it.evalInt()
      if (n < 0) throw new AmosError('Illegal function call', 23)
      if (!rt.fontsListed) throw new AmosError('fonts not examined')
      if (n === 0) return
      const entry = examinedFonts(rt)[n - 1]
      if (!entry) throw new AmosError('font not available')
      rt.currentFont = n
      if (entry.file) {
        // a real disc font: load Fonts:<name>/<size> onto the screen
        const bytes = rt.vfs?.read('Fonts:' + entry.file)
        const df = bytes ? parseDiskFont(bytes) : null
        if (!df) throw new AmosError('font not available')
        scr().font = df
      } else {
        scr().font = null // ROM/synthetic: the built-in 8x8 face
      }
    },
    // InGetFonts/Igf +Lib.s:9772: d1 mask 3/1/2 selects rom+disc, rom
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
      // SliSet +W.s:5246: 8 params, elided ones keep their current value
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
      if (n === 0) {
        s.pattern = null
        return
      }
      if (n < 0) {
        // negative: a sprite image is the fill pattern (SPat1)
        const img = rt.spriteBank?.image(-n)
        if (!img) return
        const rows = Math.min(16, img.height)
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
      // positive patterns come from the machine mouse bank (SPat +W.s:4730)
      s.pattern = rt.systemPattern(n)
    },
    fade(it) {
      // InFade +ILib.s:5440. Every `speed` ticks each RGB nibble steps one
      // toward its target. Forms:
      //   Fade n              → fade to black
      //   Fade n,c1,c2,...    → to those colours (elided = untouched)
      //   Fade n To s         → to screen s's palette (s<0 = sprite bank)
      //   Fade n To s,c1,...  → that palette, then colour overrides from 0
      const delay = Math.max(1, it.evalInt())
      const targets = new Int32Array(32).fill(-1)
      if (it.accept('to')) {
        const s = it.evalInt()
        const pal = s < 0 ? rt.spriteBank?.palette : rt.screens.get(s)?.palette
        for (let j = 0; j < 32; j++) targets[j] = (pal?.[j] ?? 0) & 0xfff
        let i = 0
        while (it.accept(',')) {
          if (!(it.atStmtEnd() || it.nm() === ',') && i < 32) targets[i] = it.evalInt() & 0xfff
          i++
        }
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
      rt.fades.set(rt.currentIndex, { delay, count: 0, targets })
    },
    'flash off'() {
      // FlStop (+W.s:5285): stops the flashes of the ACTIVE screen only
      rt.flashOff()
    },
    flash(it) {
      const reg = it.evalInt()
      it.expect(',')
      const spec = it.evalStr()
      const seq = parseFlashSpec(spec)
      // flsynt (+W.s:5333): a bad string still clears the colour's entry,
      // then errors (code 8 → message 52, "Flash declaration error")
      if (seq === null) {
        rt.flashStop(reg)
        throw new AmosError('flash declaration error')
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
      // Bounds from InSetRainbow7 +Lib.s:9385: n < 4, 16 <= length < 32700;
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
      if (n >>> 0 >= 4) throw new AmosError('function call error')
      if (len < 16 || len >= 32700) throw new AmosError('function call error')
      if (colour < 0) throw new AmosError('function call error')
      const c = colour & 31
      if (c >= 16) throw new AmosError('function call error')
      let table: Uint16Array
      try {
        table = buildRainbowTable(len, seed, rs, gs, bs)
      } catch {
        // TrSynt deletes the half-made rainbow and errors (+W.s:4113)
        rt.rainbows.delete(n)
        throw new AmosError('function call error')
      }
      // fresh entry: nothing displayed until a Rainbow instruction (RnI=-1)
      rt.rainbows.set(n, { colour: c, table, base: 0, x: 0, y: 0, h: -1, act: 0, dy: 0, fy: 0, ty: 0 })
    },
    rainbow(it) {
      // Rainbow n[,base][,y][,h] (TRDo +W.s:3940): elided values keep the
      // current ones; changes are latched as RnAct bits and folded in at
      // the next copper build. Errors report as OUT OF MEMORY — RainEr
      // returns 1, which EcWiErr maps to L_OOfMem (+Lib.s).
      const n = it.evalInt()
      const rb = rt.rainbows.get(n)
      if (n >>> 0 >= 4 || !rb || rb.table.length === 0) throw new AmosError('out of memory')
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
      // TRDel +W.s:4160: no argument clears every rainbow
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
      // Cop Wait x,y[,xmask,ymask] — masks default -1 (InCopWait2 +Lib.s:9487)
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
      // assignment form: Rain(n,line) = colour (TRVar +W.s:3966: bounds
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
        throw new AmosError('out of memory')
      rb.table[line] = v & 0xfff
    },

    // ---- text console extras ----
    centre(it) {
      const s = scr()
      const t = it.evalStr()
      s.locate(Math.max(0, (s.cols - t.length) >> 1), -1)
      s.writeText(t)
    },
    cdown() {
      scr().newline()
    },
    // Every cursor move is a console CHARACTER on the machine — InCup is
    // `lea ChCUp` + GoWn with ChCUp = chr(30) (+Lib.s:13394) — so it runs
    // inside WOutC's EffCur/AffCur bracket and the drawn cursor moves with
    // it. Sending the character rather than poking curX/curY is both the
    // faithful path and the one that cannot leave a cursor behind.
    cup() {
      scr().writeText('\x1e') // ChCUp +Lib.s:13398
    },
    cleft() {
      scr().writeText('\x1d') // ChCLf +Lib.s:13382
    },
    cright() {
      scr().writeText('\x1c') // ChCRt +Lib.s:13390
    },
    cmove(it) {
      // relative cursor move; elided arguments mean 0 (WnCm1/WnCm3)
      const s = scr()
      const dx = optInt(it, 0)
      it.accept(',')
      const dy = optInt(it, 0)
      s.locate(Math.max(0, s.curX + dx), Math.max(0, s.curY + dy))
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
      // eight rows, top first (InSetCurs +Lib.s:13261). It used to skip the
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
      const s = scr()
      const n = it.atStmtEnd() ? s.cols - s.curX : it.evalInt()
      s.bar(s.curX * 8, s.curY * 8, (s.curX + n) * 8 - 1, s.curY * 8 + 7, s.paper)
    },
    'curs pen'(it) {
      // InCursPen (+Lib.s:13330) sends ESC "D" + the colour, so the change
      // reaches the cursor that is already drawn — CurCol (+W.s:14807) sits
      // inside the same bracket and refuses a colour the screen has not got
      const n = it.evalInt()
      const s = scr()
      if (n < 0 || n >= s.nColors) throw new AmosError('illegal text window parameter', 60)
      s.writeText(`\x1bD${String.fromCharCode(48 + n)}`)
    },
    'curs on'() {
      // InCursOn +Lib.s:13418 sends ESC "C1", and every console character
      // runs inside WOutC's EffCur/AffCur bracket (+W.s:15385) — which is
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
      // Writing w1[,w2]: 0 replace/1 OR/2 XOR/3 AND/4 ignore; w2: 0 both,
      // 1 paper only, 2 pen on colour 0 (console escape 'W')
      const w = scr().curWin
      w.writing1 = it.evalInt() & 7
      if (it.accept(',')) w.writing2 = it.evalInt() & 3
    },
    'gr writing'(it) {
      // SetDrMd: 0 JAM1 (transparent), 1 JAM2, 2 COMPLEMENT (XOR)
      scr().grMode = it.evalInt() & 7
    },
    'set tab'(it) {
      const n = Math.max(1, it.evalInt())
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
      if (border < 0 || border > 16) throw new AmosError('function call error')
      try {
        scr().windOpen(n, x, y, w, h, border)
      } catch (e) {
        throw new AmosError((e as Error).message)
      }
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
      // WiMv0 (+W.s:13909) brackets the move with EffCur/AffCur — without
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
      // WiSize +W.s:13970: resize, redraw the frame, then Clw the interior
      // (the window is blanked to paper and the cursor homed)
      const s = scr()
      const [w2, h2] = pair(it)
      // WiSi0 (+W.s:13979), bracketed for the same reason as Wind Move
      s.console(() => {
        s.curWin.cols = w2
        s.curWin.rows = h2
        s.drawWindowFrame2()
        s.clw()
      })
    },
    window(it) {
      try {
        scr().selectWindow(it.evalInt())
      } catch (e) {
        throw new AmosError((e as Error).message)
      }
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
      if (it.nm() !== ',') w.border = it.evalInt() & 31
      if (it.accept(',')) {
        if (it.nm() !== ',' && !it.atStmtEnd()) w.borPap = it.evalInt()
        if (it.accept(',') && !it.atStmtEnd()) w.borPen = it.evalInt()
      }
      s.drawWindowFrame2()
    },
    'title top'(it) {
      const s = scr()
      s.curWin.titleTop = it.evalStr()
      s.drawWindowFrame2()
    },
    'title bottom'(it) {
      const s = scr()
      s.curWin.titleBottom = it.evalStr()
      s.drawWindowFrame2()
    },

    freeze() {
      // InFreeze +Lib.s:11626 -> FrzAMAL: park the whole channel chain
      rt.freezeAll()
    },
    unfreeze() {
      rt.unfreezeAll()
    },
    'set tempras'(it) {
      // InSetTempras0/1/2 (+Lib.s:9997): [size | addr,size] with size
      // 256..65535; the chunky renderer needs no raster buffer, so the
      // validated values are stored and unused
      if (it.atStmtEnd()) {
        rt.tempRas = null
        return
      }
      const a = it.evalInt()
      if (it.accept(',')) {
        const size = it.evalInt()
        if (size < 256 || size >= 65536) throw new AmosError('function call error')
        rt.tempRas = { addr: a, size }
        return
      }
      if (a < 256 || a >= 65536) throw new AmosError('function call error')
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

    // ---- pointer visibility (MHide/MShow +W.s:10722, both no-ops under
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
      rt.scrollZones.set(n, { x1, y1, x2, y2, dx, dy })
    },
    scroll(it) {
      const z = rt.scrollZones.get(it.evalInt())
      if (!z) return
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
      if (sw <= 0 || sh <= 0 || dw <= 0 || dh <= 0) throw new AmosError('function call error')
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
      // Appear src To dst,e[,p] (InAppear +Lib.s:10466): p iterations
      // (default = every pixel) stepping (e mod p) through the source
      // pixel index space, copying only the planes both screens share and
      // preserving the destination's higher planes. gcd(e, total) > 1
      // leaves pixels uncopied — the classic venetian/checker dissolves.
      const src = rt.resolveScreenId(it.evalInt())
      it.expect('to')
      const dst = rt.resolveScreenId(it.evalInt(), true)
      it.expect(',')
      const e = it.evalInt()
      const p = it.accept(',') ? it.evalInt() : 0
      if (e <= 0 || p < 0) throw new AmosError('function call error')
      const s = src.s
      const d = dst.s
      const total = s.rowBytes * 8 * s.height
      const count = p === 0 ? total : p
      let step = e
      while (step >= count) step -= count
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
      const image = optInt(it, cur?.image ?? 1)
      rt.bobs.set(n, { n, x, y, image, screen: cur?.screen ?? rt.currentIndex })
    },
    'bob off'(it) {
      rt.clearBobs() // restore backgrounds, then drop
      if (it.atStmtEnd()) rt.bobs.clear()
      else rt.bobs.delete(it.evalInt())
    },
    'bob update'(it) {
      void it
      rt.updateBobs() // one manual update pass
    },
    // ---- Update family (InUpdate* +Lib.s:11452-11527): both pipelines ----
    'update on'() {
      rt.bobUpdateOn = true
      rt.spriteUpdateOn = true
    },
    'update off'() {
      rt.bobUpdateOn = false
      rt.spriteUpdateOn = false
    },
    update() {
      // one manual round: bobs erase/draw + buffer swap + sprites
      rt.updateBobs()
    },
    'update every'(it) {
      // InUpdateEvery: the auto update runs every n VBLs (VBLDelai)
      const n = it.evalInt()
      if (n >= 65536) throw new AmosError('function call error')
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
      rt.updateBobs()
    },
    'set bob'(it) {
      // Set Bob n,back,planes,mask (InSetBob +Lib.s:12225 -> ResBOB +W.s:988).
      // back  -> BbEff: 0 save/restore, <0 leave a trail (a negative value
      //          clears BbDecor so no background is kept), >0 restore with
      //          solid colour back-1
      // planes-> BbAPlan, the bitplane write mask; omitted is -1, all planes
      // mask  -> BbACon, the blitter control word. Its SIGN chooses what it
      //          means (BbS1a +W.s:1425): 0 the default cookie-cut, negative
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
        rt.bobLimits.set(-1, { x1: a, y1: b, x2, y2 })
        return
      }
      it.expect(',')
      const y1 = it.evalInt()
      it.expect('to')
      const [x2, y2] = pair(it)
      rt.bobLimits.set(a, { x1: b, y1, x2, y2 })
    },
    'x mouse'(it) {
      // X Mouse = n (InXMouse +Lib.s:12108) -> MSetAb (+W.s:10950) with
      // EntNul for Y, so only X moves.
      it.expectOp('=')
      it.inp.mouseX = setMouseAxis(it.evalInt(), mouseBounds(rt).x1, mouseBounds(rt).x2)
    },
    'y mouse'(it) {
      // Y Mouse = n (InYMouse +Lib.s:12122) -> MSetAb with EntNul for X.
      it.expectOp('=')
      it.inp.mouseY = setMouseAxis(it.evalInt(), mouseBounds(rt).y1, mouseBounds(rt).y2)
    },
    'command line$'(it) {
      // Command Line$ = a$ (InCommandLine +Lib.s:7867): stashed under a
      // "CmdL" cookie just below TBuffer, so it survives Run chaining. 256
      // or longer is a function call error (cmp.w #256,d2 / Rbcc).
      it.expectOp('=')
      const s = str(it.evalExpr())
      if (s.length >= 256) throw new AmosError('function call error')
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
        if (!s) throw new AmosError(`screen not opened: ${a}`)
        rt.mouseLimit = screenRect(s)
        return
      }
      const y1 = it.evalInt()
      it.expect('to')
      const x2 = it.evalInt()
      it.expect(',')
      const y2 = it.evalInt()
      rt.mouseLimit = { x1: a, y1, x2, y2 }
    },
    'paste bob'(it) {
      // InPasteBob +Lib.s:12753 -> Patch: bset #31,d3 sets the "PAS POINT
      // CHAUD" flag, so BobCalc (+W.s:1387) skips the hot-spot subtraction
      // — Paste Bob draws at the raw top-left x,y, unlike Bob/Sprite
      const [x, y] = pair(it)
      it.expect(',')
      const img = rt.spriteBank?.image(it.evalInt())
      if (img) rt.blit(scr(), img, x, y, img.opaque)
    },
    'paste icon'(it) {
      const [x, y] = pair(it)
      it.expect(',')
      const img = rt.iconBank?.image(it.evalInt())
      if (img) rt.blit(scr(), img, x, y, true)
    },
    'get bob': getObj('sprite'),
    'get sprite': getObj('sprite'),
    'get icon': getObj('icon'),
    'put bob'(it) {
      // InPutBob +Lib.s:12723: stamp a live displayed bob permanently into
      // its screen background at its current position/image
      const n = it.evalInt()
      const bob = rt.bobs.get(n)
      if (!bob) return
      const img = rt.spriteBank?.image(bob.image)
      if (!img) return
      const s = rt.screens.get(bob.screen) ?? scr()
      rt.blit(s, img, bob.x - img.hotX, bob.y - img.hotY, img.opaque)
    },
    'put key'(it) {
      // InPutKey +Lib.s:13724: append a string to the keyboard buffer
      const s2 = it.evalStr()
      if (s2.length >= 64) throw new AmosError('string too long')
      for (const ch of s2) rt.pressKey(ch, 0)
    },
    'del bob': delObj('sprite'),
    'del sprite': delObj('sprite'),
    'del icon': delObj('icon'),
    'ins bob': insObj('sprite'),
    'ins sprite': insObj('sprite'),
    'ins icon': insObj('icon'),
    'make icon mask'(it) {
      if (!it.atStmtEnd()) it.evalInt() // masks are implicit here
    },
    'no icon mask'(it) {
      const img = rt.iconBank?.image(it.atStmtEnd() ? 1 : it.evalInt())
      if (img) img.opaque = true
    },
    'get sprite palette': bankPalette(),
    'get bob palette': bankPalette(),
    'get icon palette'(it) {
      const mask = it.atStmtEnd() ? -1 : it.evalInt()
      const pal = rt.iconBank?.palette
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
          // predefined code $XY: nibbles select left/middle/right, top/middle/bottom
          const cx = (a >> 4) & 3
          const cy = a & 3
          img.hotX = cx === 1 ? img.width >> 1 : cx === 2 ? img.width : 0
          img.hotY = cy === 1 ? img.height >> 1 : cy === 2 ? img.height : 0
        }
      }
    },
    'make mask'(it) {
      if (!it.atStmtEnd()) it.evalInt() // masks are implicit here
    },
    'no mask'(it) {
      const img = rt.spriteBank?.image(it.atStmtEnd() ? 1 : it.evalInt())
      if (img) img.opaque = true
    },
    'priority on'() {
      rt.priorityOn = true
    },
    'priority off'() {
      rt.priorityOn = false
    },
    'priority reverse on'() {
      rt.priorityOn = true
      rt.priorityReverse = true
    },
    'priority reverse off'() {
      rt.priorityReverse = false
    },

    // ---- hardware sprites ----
    sprite(it) {
      // InSprite +Lib.s:12315 → HsNxya: n in 0..63; omitted args keep the
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
      if (it.atStmtEnd()) rt.hwSprites.clear()
      else rt.hwSprites.delete(it.evalInt())
    },
    'sprite update'(it) {
      // InSpriteUpdate +Lib.s:11508: apply buffered changes now (ActHs+AffHs)
      it.skipToStmtEnd()
      if (!rt.spriteUpdateOn) rt.frozenSprites = [...rt.hwSprites.values()].map((s) => ({ ...s }))
    },
    'sprite priority'(it) {
      // InSpritePriority -> HsPri (+W.s:11374). Sprite PAIRS below the value
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
      if (p >>> 0 > 4) throw new AmosError('function call error')
      const cur = scr()
      if (cur.dualIsBack && cur.dualPartner !== null && rt.screens.has(cur.dualPartner)) {
        rt.screens.get(cur.dualPartner)!.pf2p = p
      } else {
        cur.pf1p = p
      }
    },
    'set sprite buffer'(it) {
      // InSetSpriteBuffer +Lib.s:12290: scanlines per multiplexer column,
      // must be >= 16 (cmp #16 / bcs error). HsSBuf reserves n+2 lines
      // (+W.s:11268), leaving n words of room per column — the budget that
      // decides how many computed sprites share a channel.
      const n = it.evalInt()
      if (n < 16) throw new AmosError('function call error')
      rt.spriteBufferLines = n + 2
    },

    // ---- zones ----
    //
    // The table belongs to the CURRENT SCREEN (EcAZones/EcNZones), and all
    // three of these go through T_EcCourant to reach it. See Screen.zones.
    'reserve zone'(it) {
      // InReserveZone0/1 (+Lib.s:10924): the count is checked for sign
      // (`move.l d3,d1 / Rbmi L_FonCall`) and a screen must be open
      // (`tst.w ScOn(a5) / Rbeq L_ScNOp`) BEFORE SyResZ allocates n*8 bytes.
      // The no-argument form is `moveq #0,d3`, which reserves nothing at all
      // rather than the sixteen this port used to assume — SyRz1's `move.w
      // d1,d0 / beq.s ZoOk` frees the old table and returns with EcAZones
      // null, so `Reserve Zone` bare is how a program DISCARDS its zones.
      const n = it.atStmtEnd() ? 0 : it.evalInt()
      if (n < 0) throw new AmosError('function call error', ERR.FUNC_CALL)
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
      const s = rt.screen
      // SySetZ (+W.s:11119) is four refusals and four word stores, and all
      // four refusals reach InSetZone's `Rbne L_FonCall` as AMOS 23:
      //   EcAZones == 0        no zones reserved on this screen
      //   n == 0 or n > count  `tst.w d1 / beq` and `cmp.w EcNZones(a1),d1 /
      //                        bhi` — so the table does NOT grow to fit,
      //                        which is what this port used to do silently
      //   x1 >= x2, y1 >= y2   `cmp.w d4,d2 / bcc` and `cmp.w d5,d3 / bcc`,
      //                        UNSIGNED word compares, so the far corner is
      //                        exclusive and a zero-width zone is refused
      if (s.zones.length === 0) throw new AmosError('function call error', ERR.FUNC_CALL)
      if (n <= 0 || n > s.zones.length) throw new AmosError('function call error', ERR.FUNC_CALL)
      if ((x1 & 0xffff) >= (x2 & 0xffff) || (y1 & 0xffff) >= (y2 & 0xffff)) {
        throw new AmosError('function call error', ERR.FUNC_CALL)
      }
      // `move.w` four times: the record is words, so the coordinates are
      // truncated to sixteen bits on the way in
      s.zones[n - 1] = { x1: x1 & 0xffff, y1: y1 & 0xffff, x2: x2 & 0xffff, y2: y2 & 0xffff }
    },
    'reset zone'(it) {
      // InResetZone0/1 (+Lib.s:10940) -> SyRazZ (+W.s:11094). A null table is
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
      if (n < 0 || n > s.zones.length) throw new AmosError('function call error', ERR.FUNC_CALL)
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
        throw new AmosError('Illegal function call', ERR.FUNC_CALL)
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
      // InDialogOpen2/3/4 +Lib.s:14330: Dialog Open c,prog[,nvars[,buflen]];
      // prog is a string or a program number (<1024) in the resource bank
      const c = it.evalInt()
      if (c <= 0) throw new AmosError('function call error')
      it.expect(',')
      const prog = it.evalExpr()
      let nVars = 16
      let bufLen = 1024
      if (it.accept(',')) {
        nVars = it.evalInt()
        if (nVars < 0) throw new AmosError('function call error')
        if (it.accept(',')) {
          bufLen = it.evalInt()
          if (bufLen <= 256) throw new AmosError('function call error')
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
        if (!progs || n < 1 || n > progs.length) throw new AmosError('function call error')
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
      // InDialogClose0/1 +Lib.s:14399
      if (it.atStmtEnd()) {
        rt.dialogs.clear()
        return
      }
      const c = it.evalInt()
      if (c <= 0) throw new AmosError('function call error')
      if (!rt.dialogs.delete(c)) throw new AmosError(DIALOG_ERRORS[6]!)
    },
    'dialog clr'(it) {
      // InDialogClr +Lib.s:14415 → Dia_EffChannel: erase the display,
      // keep the channel
      const c = it.evalInt()
      if (c <= 0) throw new AmosError('function call error')
      const d = rt.dialogs.get(c)
      if (!d) throw new AmosError(DIALOG_ERRORS[6]!)
      eraseDialog(d, rt.dialogDraw)
    },
    'dialog update'(it) {
      // InDialogUpdate2..5 +Lib.s:14462 → Dia_ZUpdate: push a value into
      // zone z of channel n; elided values just redraw
      const c = it.evalInt()
      if (c <= 0) throw new AmosError('function call error')
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
      // InDialogFreeze0/1 +Lib.s:14426
      if (it.atStmtEnd()) {
        for (const d of rt.dialogs.values()) d.frozen = true
        return
      }
      const c = it.evalInt()
      if (c <= 0) throw new AmosError('function call error')
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
      if (c <= 0) throw new AmosError('function call error')
      const d = rt.dialogs.get(c)
      if (!d) throw new AmosError(DIALOG_ERRORS[6]!)
      d.frozen = false
    },
    vdialog(it) {
      // InVDialog +Lib.s:14550: Vdialog(c,n)=v
      vdialogWrite(it, rt, false)
    },
    'vdialog$'(it) {
      vdialogWrite(it, rt, true)
    },

    // ---- resource banks (Interface language) ----
    'resource bank'(it) {
      // InResourceBank +Lib.s:14933: negative bank = function call error
      const n = it.evalInt()
      if (n < 0) throw new AmosError('function call error')
      rt.resourceBankNumber = n
    },
    'resource unpack'(it) {
      // InResourceUnpack +Lib.s:14998: image n of the puzzle bank onto the
      // current screen at x,y
      const n = it.evalInt()
      it.expect(',')
      const x = it.evalInt()
      it.expect(',')
      const y = it.evalInt()
      const g = rt.resource().graphics
      if (!g || n <= 0 || n > g.count) throw new AmosError('function call error')
      const pic = g.image(n)
      if (!pic) throw new AmosError('function call error')
      rt.blit(scr(), pic, x, y, true)
    },
    'resource screen open'(it) {
      // InResourceScreenOpen +Lib.s:14912 → Dia_RScOpen 20995: screen n
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
      if (n >>> 0 >= 8) throw new AmosError('illegal screen number')
      const g = rt.resource().graphics
      if (!g) throw new AmosError('resource bank not present')
      const s = rt.openScreen(n, sx, sy, g.nColors, g.mode & 0x8004)
      for (let i = 0; i < 32; i++) s.palette[i] = g.palette[i]!
      if (flash === 0) {
        s.cursorOn = false
      } else {
        if (flash >= g.nColors) throw new AmosError('function call error')
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
      const bytes = rt.fs?.read(path)
      if (!bytes) {
        if (it.policy === 'skip') {
          it.unimplemented.set('load (file missing)', (it.unimplemented.get('load (file missing)') ?? 0) + 1)
          return
        }
        throw new AmosError(`file not found: ${path}`)
      }
      const file = parseAmosFile(bytes)
      // an AmBs bank list erases ALL banks first (LB_Multiples: Bnk.EffAll,
      // +Lib.s Bnk.Load)
      if (file.bankList) {
        rt.memBanks.clear()
        rt.spriteBank = null
        rt.iconBank = null
      }
      // a forced number applies only to a single-bank load; a multi-bank
      // container restores each bank to its own stored number (Bnk.Load
      // +Lib.s:4054) — forcing every bank would collide them
      const single = file.banks.length === 1
      for (const bank of file.banks) {
        if (bank.kind === 'sprites' || bank.kind === 'icons') {
          // LB_Sprites/LB_Icons: a nonzero (or defaulted) bank argument
          // APPENDS to an existing bank and the file's palette wins;
          // 0 overwrites
          const nb = ObjectBank.fromSpriteBank(bank)
          const slot = bank.kind === 'sprites' ? 'spriteBank' : ('iconBank' as const)
          const cur = rt[slot]
          if (cur && forced !== 0) {
            cur.images.push(...nb.images)
            cur.palette = nb.palette
          } else rt[slot] = nb
        } else if (bank.kind === 'memory') rt.memBanks.set(single && forced !== null ? forced : bank.number || 5, bank)
      }
    },
    // ---- audio ----
    'sam bank'(it) {
      // InSamBank +Music.s:3034: 1-16, else illegal function call
      const n = it.evalInt()
      if (n <= 0 || n > 16) throw new AmosError('Illegal function call', 23)
      rt.samBankNum = n
    },
    'sam play'(it) {
      // Sam Play n | Sam Play voices,n | Sam Play voices,n,freq
      // (InSamPlay1-3 +Music.s:3128: an explicit frequency <=500 errors)
      const a = it.evalInt()
      let mask = 0b1111
      let n = a
      let freq: number | null = null
      if (it.accept(',')) {
        mask = a
        n = it.evalInt()
        if (it.accept(',')) freq = it.evalInt()
      }
      if (freq !== null && freq <= 500) throw new AmosError('Illegal function call', 23)
      const sample = rt.getSample(n)
      rt.samPlay(mask & 15, sample.pcm, freq ?? sample.freq)
    },
    'sam stop'(it) {
      rt.stopVoices((it.atStmtEnd() ? 0b1111 : it.evalInt()) & 15)
    },
    'sam swap'(it) {
      // InSamSwap +Music.s:4080: Sam Swap voices To address,length —
      // queues the next buffer, picked up when the playing one ends
      const mask = it.evalInt()
      it.expect('to')
      const addr = it.evalInt()
      it.expect(',')
      const len = it.evalInt()
      if (len < 0) throw new AmosError('Illegal function call', 23)
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
      if (len < 0 || ch < 1 || ch > 10) throw new AmosError('Illegal function call', 23)
      const c = rt.fileChans.get(ch)
      if (!c || c.mode !== 'in') throw new AmosError('Illegal function call', 23)
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
      if (end - start <= 0 || ch < 1 || ch > 10) throw new AmosError('Illegal function call', 23)
      const c = rt.fileChans.get(ch)
      if (!c || c.mode !== 'out') throw new AmosError('Illegal function call', 23)
      const m = rt.resolveAddr(start)
      if (!m) return
      const n = Math.min(end - start, m.data.length - m.off)
      for (let i = 0; i < n; i++) c.out.push(m.data[m.off + i]!)
    },
    'sam loop on'(it) {
      // SL0 +Music.s:3073: updates the mask AND re-points live samples
      const mask = (it.atStmtEnd() ? 0b1111 : it.evalInt()) & 15
      rt.samLoopMask |= mask
      for (let v = 0; v < 4; v++) if (mask & (1 << v)) rt.audio.setLoop(v, 0)
    },
    'sam loop off'(it) {
      const mask = (it.atStmtEnd() ? 0b1111 : it.evalInt()) & 15
      rt.samLoopMask &= ~mask
      for (let v = 0; v < 4; v++) if (mask & (1 << v)) rt.audio.setLoop(v, -1)
    },
    volume(it) {
      // InVolume1/2 +Music.s:2739: the one-argument form also sets the
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
      // InShoot +Music.s:2713: noise notes 60..63, one per voice
      rt.music.shout(60, ENV_SHOOT)
    },
    boom() {
      // InBoom +Music.s:2702: noise notes 36..39 with the boom envelope
      rt.music.shout(36, ENV_BOOM)
    },
    play(it) {
      // InPlay2/3 +Music.s:2802: Play [voices,]note,wait — a negative
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
      if (wait < 0) throw new AmosError('Illegal function call', 23)
      rt.music.playNote(mask, note)
      if (wait > 0) it.block({ type: 'wait', until: it.tick + wait })
    },
    'play off'(it) {
      // InPlayOff +Music.s:2977 -> EnvOff
      rt.music.playOff((it.atStmtEnd() ? 0b1111 : it.evalInt()) & 15)
    },
    'set wave'(it) {
      // InSetWave +Music.s:3387: needs at least 256 characters (error
      // 181), wave 0 illegal; the first 256 bytes become the waveform
      const n = it.evalInt()
      it.expect(',')
      const s = it.evalStr()
      if (s.length < 256) throw new AmosError('256 characters for a wave')
      if (n <= 0) throw new AmosError('Illegal function call', 23)
      const src = new Int8Array(256)
      for (let i = 0; i < 256; i++) src[i] = (s.charCodeAt(i) << 24) >> 24
      rt.music.setWave(n, src)
    },
    'del wave'(it) {
      // InDelWave +Music.s:3405: waves 0 and 1 are reserved (error 182);
      // deleting resets every voice to wave 1
      const n = it.evalInt()
      if (n < 0) throw new AmosError('Illegal function call', 23)
      if (n === 0 || n === 1) throw new AmosError('wave 0 and 1 are reserved')
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
      if (vol < 0 || vol >= 64) throw new AmosError('Illegal function call', 23)
      if (phase < 0 || phase >= 7) throw new AmosError('Illegal function call', 23)
      if (wave < 0) throw new AmosError('Illegal function call', 23)
      if (phase === 0 && dur <= 0) throw new AmosError('Illegal function call', 23)
      rt.music.setEnvel(wave, phase, dur, vol)
    },
    wave(it) {
      // InWave +Music.s:3373: Wave n To voices
      const n = it.evalInt()
      if (n < 0) throw new AmosError('Illegal function call', 23)
      it.expect('to')
      rt.music.waveTo(n, it.evalInt() & 15)
    },
    'noise to'(it) {
      // InNoiseTo +Music.s:3093
      rt.music.noiseTo(it.evalInt() & 15)
    },
    sample(it) {
      // InSampleTo +Music.s:3102: Sample n To voices
      const n = it.evalInt()
      it.expect('to')
      rt.music.sampleTo(n, it.evalInt() & 15)
    },
    voice(it) {
      // InVoice +Music.s:3754: mask &15 -> VOnOf; only acts while a
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
      // InMusicStop +Music.s:3701: zero the voice counters — the player
      // pops the music stack at the next step-tick
      rt.music.musicStop()
    },
    tempo(it) {
      // InTempo +Music.s:3878: 0-100 (unsigned compare), only affects a
      // playing music
      const t = it.evalInt()
      if (t < 0 || t > 100) throw new AmosError('Illegal function call', 23)
      rt.music.tempo(t)
    },
    mvolume(it) {
      // InMvolume +Music.s:3720: >=64 errors; rescales all stacked musics
      const v = it.evalInt()
      if (v < 0 || v >= 64) throw new AmosError('Illegal function call', 23)
      rt.musicVolume = v & 63
      rt.music.setMusicVolume()
    },
    'track load'(it) {
      // InTrackLoad +Music.s:4120: the whole file into a chip bank named
      // "Tracker "; reloading the currently playing bank stops it first
      const path = it.evalStr()
      it.expect(',')
      const n = it.evalInt()
      if (n < 1 || n >= 0x10000) throw new AmosError('Illegal function call', 23)
      if (n === rt.music.trackBank && rt.music.mtOn) rt.music.trackStop()
      rt.music.trackBank = n
      const bytes = rt.fs?.read(path)
      if (!bytes) throw new AmosError(`file not found: ${path}`)
      rt.memBanks.set(n, { kind: 'memory', number: n, memType: 1, name: 'Tracker', flags: 0, data: bytes })
    },
    'track play'(it) {
      // InTrackPlay0-2 +Music.s:4266: bank defaults to Track_Bank; the
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
      // InRun0/1 +ILib.s:1465: bare Run only works in direct mode —
      // inside a program it is a syntax error; Run "file" chains to the
      // new program (screens kept, banks replaced by the file's)
      if (it.atStmtEnd()) throw new AmosError('syntax error')
      rt.runFile(it.evalStr())
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
       * Exec "command" — InExec (+Lib.s:3392), source tier and complete:
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
       * ChVerBuf (+Lib.s:3677) truncates at 510 characters: `cmp.w #510,d0 /
       * bcs / move.w #509,d0` copies at most 510 bytes and then the NUL.
       *
       * NOTE: nothing can run a command here, so Execute always answers
       * DOSFALSE and this always raises "Disc error". That is the branch the
       * routine itself takes for a command that does not exist -- which is
       * what every command is on a machine with no shell -- rather than a
       * stub. The seam is `host.process`; see ../amiga/process.ts.
       */
      const cmd = it.evalStr()
      if (cmd.length === 0) throw new AmosError('Illegal function call', 23)
      const command = cmd.slice(0, 510)
      const r = execute(rt.host.process, { command, io: { input: null, output: null } })
      if (r === DOSFALSE) throw new AmosError('Disc error', 87)
    },
    system(it) {
      // InSystem +ILib.s:1849: run-error 1002 — leave AMOS entirely; in
      // the port, like Edit/Direct, the program simply ends
      it.halt('ended')
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
    'set buffer'(it) {
      // InSetBuffer +ILib.s:1828 is literally rts in the interpreter —
      // the buffer size only matters to the editor/compiler at load time
      it.evalInt()
    },
    'set hardcol'(it) {
      // InSetHardcol +Lib.s:12346 -> HColSet +W.s:10018: CLXCON is built
      // from a fixed $F in the odd-sprite enables, the first argument in
      // ENBP1-6 and the second in MVBP1-6
      const enable = it.evalInt()
      it.expect(',')
      const match = it.evalInt()
      rt.collide.clxcon = (0xf << 12) | ((enable & 0x3f) << 6) | (match & 0x3f)
    },
    'set accessory'(it) {
      // The token table points this at L_InNull (+Lib.s:1474), and InNull
      // is one instruction: rts (+ILib.s:3748). It marks the program as an
      // accessory for the *editor* — the interpreter never reads the flag,
      // which is why the commented-out Prg_Accessory test in InPRun
      // (+ILib.s:1541) is commented out. Running one directly does nothing.
      if (!it.atStmtEnd()) it.evalInt()
    },
    'iff anim'(it) {
      // InIffAnim +Lib.s:4538: Iff Anim "file",screen[,times] — the
      // whole ANIM loads, frame 1 creates and double-buffers the
      // screen, then each frame waits the ANHD time, swaps, and plays
      // the next DLTA into the logical buffer (which is what makes
      // ANIM5's two-frames-back deltas land correctly)
      const path = it.evalStr()
      it.expect(',')
      const screen = it.evalInt()
      const times = it.accept(',') ? it.evalInt() : 1
      if (times < 0) throw new AmosError('Illegal function call', 23)
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
      if (n < 1 || n >= 0x10000) throw new AmosError('Illegal function call', 23)
      if (n === rt.music.med.bank) rt.music.med.stop()
      rt.music.med.bank = n
      const bytes = rt.fs?.read(path)
      if (!bytes) throw new AmosError(`file not found: ${path}`)
      rt.memBanks.set(n, { kind: 'memory', number: n, memType: 1, name: 'Med', flags: 0, data: bytes })
      const magic = String.fromCharCode(...bytes.slice(0, 4))
      if (magic !== 'MMD0' && magic !== 'MMD1') {
        rt.memBanks.delete(n)
        throw new AmosError('not a med module')
      }
    },
    'med play'(it) {
      // InMedPlay0-2 +Music.s:4603: Med Play [bank][,song] — the bank is
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
      // InMedMidiOn +Music.s:4702: flag only — no MIDI output in the port
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
    // InLedOn/Of +Music.s:3917: $BFE001 bit 1 — LED lit = low-pass filter engaged
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
      // InMenu +ILib.s:6856: Menu$(path)=normal$[,highlight$][,inactive$]
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
      rt.menu.on = true
    },
    'menu off'() {
      rt.menu.on = false
    },
    'menu calc'() {
      menuCalc(rt.menu)
    },
    'menu base'(it) {
      // MnBase +Lib.s:15624 — EntNul-style elision keeps a coordinate
      const x = it.atStmtEnd() || it.nm() === ',' ? null : it.evalInt()
      if (it.accept(',')) {
        const y = it.atStmtEnd() ? null : it.evalInt()
        if (y !== null) rt.menu.baseY = y
      }
      if (x !== null) rt.menu.baseX = x
      rt.menu.change = true
    },
    'menu movable'(it) {
      rt.menu.setLevelFlag(optInt(it, 1), MF_TBOUGE, 0)
    },
    'menu static'(it) {
      rt.menu.setLevelFlag(optInt(it, 1), 0, MF_TBOUGE)
    },
    'menu item movable'(it) {
      rt.menu.setLevelFlag(optInt(it, 1), MF_BOUGE, 0)
    },
    'menu item static'(it) {
      rt.menu.setLevelFlag(optInt(it, 1), 0, MF_BOUGE)
    },
    'menu bar'(it) {
      // level layout styles (+Lib.s:15682): bar = vertical column
      rt.menu.setLevelFlag(optInt(it, 1), MF_BAR, 0)
    },
    'menu line'(it) {
      rt.menu.setLevelFlag(optInt(it, 1), 0, MF_BAR | MF_TOTAL)
    },
    'menu tline'(it) {
      rt.menu.setLevelFlag(optInt(it, 1), MF_TOTAL, MF_BAR)
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
    'menu called'(it) {
      const node = rt.menu.find(menuPath(it))
      if (node) node.called = true
    },
    'menu once'(it) {
      const node = rt.menu.find(menuPath(it))
      if (node) node.called = false
    },
    'menu del'(it) {
      // InMenuDel +ILib.s:6954: no path = wipe the whole tree
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
      // InSetMenu +ILib.s:6973: Set Menu(path) To x,y — fixed position
      const node = rt.menu.insert(menuPath(it))
      it.expect('to')
      node.x = it.evalInt()
      it.expect(',')
      node.y = it.evalInt()
      node.flags |= MF_FIXED
      rt.menu.change = true
    },
    'menu key'(it) {
      // InMenuKey +ILib.s:6760: Menu Key(path) To k$ (ASCII, first char of
      // a non-empty string) or To scan[,shift] (numeric, scan < 128,
      // shift < 256); leaf nodes only; NO To clears the key (IMnk2)
      const node = rt.menu.find(menuPath(it))
      if (node && node.children.length > 0) throw new AmosError('function call error')
      if (!it.accept('to')) {
        if (node) node.key = { kind: 0, asc: 0, scan: 0, shift: 0 }
        return
      }
      const v = it.evalExpr()
      if (v.k === 'str') {
        if (v.s.length === 0) throw new AmosError('function call error')
        if (node) node.key = { kind: 1, asc: v.s.charCodeAt(0), scan: 0, shift: 0 }
        return
      }
      const scan = int(v)
      const shift = it.accept(',') ? it.evalInt() : 0
      if (shift >>> 0 >= 256 || scan >>> 0 >= 128) throw new AmosError('function call error')
      if (node) node.key = { kind: -1, asc: 0, scan, shift }
    },
    'menu to bank'(it) {
      // +Lib.s:15401: serialise the tree as a "Menu    " bank
      const n = it.evalInt()
      rt.memBanks.set(n, {
        kind: 'memory',
        number: n,
        memType: 0,
        name: 'Menu    ',
        flags: 0,
        data: menuToBank(rt.menu),
      })
    },
    'bank to menu'(it) {
      // +Lib.s:15494: load a tree from a menu bank
      const n = it.evalInt()
      const bank = rt.memBanks.get(n)
      if (!bank || !/^menu/i.test(bank.name)) throw new AmosError('bank not reserved')
      bankToMenu(rt.menu, bank.data)
      if (rt.menu.screenNb < 0) rt.menu.screenNb = rt.currentIndex
    },
    'on menu'(it) {
      // On Menu Gosub L1[,L2...] / On Menu Proc P1[,P2...]
      const kind = it.nm()
      if (kind !== 'gosub' && kind !== 'proc') throw new AmosError('On Menu needs Gosub or Proc')
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
      if (rt.onMenu) rt.onMenu.armed = true
    },
    'on menu off'() {
      if (rt.onMenu) rt.onMenu.armed = false
    },
    'on menu del'() {
      rt.onMenu = null
    },
    // ---- blocks ----
    'get block'(it) {
      const n = it.evalInt()
      it.expect(',')
      const [x, y] = pair(it)
      it.expect(',')
      const [w, h] = pair(it)
      const mask = it.accept(',') ? it.evalInt() !== 0 : false
      const img = rt.grab(scr(), x, y, x + w, y + h)
      rt.blocks.set(n, { x, y, w, h, pixels: img.pixels, mask })
    },
    'put block'(it) {
      const b = rt.blocks.get(it.evalInt())
      if (!b) throw new AmosError('block not defined')
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
      if (it.atStmtEnd()) rt.blocks.clear()
      else rt.blocks.delete(it.evalInt())
    },
    'get cblock'(it) {
      const n = it.evalInt()
      it.expect(',')
      const [x, y] = pair(it)
      it.expect(',')
      const [w, h] = pair(it)
      const img = rt.grab(scr(), x, y, x + w, y + h)
      rt.cblocks.set(n, { x, y, w, h, pixels: img.pixels })
    },
    'put cblock'(it) {
      const b = rt.cblocks.get(it.evalInt())
      if (!b) throw new AmosError('block not defined')
      let x = b.x
      let y = b.y
      if (it.accept(',')) {
        x = it.evalInt()
        it.expect(',')
        y = it.evalInt()
      }
      rt.blit(scr(), { width: b.w, height: b.h, pixels: b.pixels }, x, y, true)
    },
    'del cblock'(it) {
      if (it.atStmtEnd()) rt.cblocks.clear()
      else rt.cblocks.delete(it.evalInt())
    },

    // ---- screens extra ----
    'screen clone'(it) {
      const n = it.evalInt()
      const src = scr()
      const clone = rt.openScreen(n, src.width, src.height, src.ham ? 4096 : src.nColors, (src.hires ? 0x8000 : 0) | (src.laced ? 4 : 0))
      // a shared BITMAP, which is what the keyword means: the clone points at
      // the same planes, so a write through either screen is visible from
      // both. Assigning the chunky buffers across shared the cache and left
      // each screen its own planes, and the planes are the bitmap
      clone.shareBitmapsFrom(src)
      clone.palette = src.palette
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
    'hscroll'(it) {
      // InHScroll +Lib.s:13544: n in 1..4 prints window control code 15+n
      // — the scroll itself is the escape-code handler (ScG*/ScD*
      // +W.s:14539), so Print Chr$(16) does the same thing
      const n = it.evalInt()
      if (n < 1 || n > 4) throw new AmosError('function call error')
      scr().writeText(String.fromCharCode(15 + n))
    },
    'vscroll'(it) {
      // InVScroll +Lib.s:13552: codes 19+n (ScBas/ScBasHaut/ScHaut/
      // ScHautBas +W.s:14657-14760)
      const n = it.evalInt()
      if (n < 1 || n > 4) throw new AmosError('function call error')
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
    'inverse on'() {
      scr().curWin.inverse = true
    },
    'inverse off'() {
      scr().curWin.inverse = false
    },
    'set text'(it) {
      // InSetText +Lib.s:9908: the rastport SoftStyle byte — it styles
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
      it.evalInt()
      if (it.accept(',')) it.evalInt() // repeat rates — host handles keys
    },
    'change mouse'(it) {
      // InChangeMouse +Lib.s:12214: shape 0 and below error before MChange
      const n = it.evalInt()
      if (n <= 0) throw new AmosError('function call error')
      rt.changeMouse(n)
    },

    // ---- memory / banks ----
    // InResData/InResWork +Lib.s:2437-2454 each `Rlea` a name out of the
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
      // InErase +Lib.s:2210 has no error path — a missing bank is a no-op
      rt.eraseBank(it.evalInt())
    },
    'erase all'() {
      rt.memBanks.clear()
      rt.spriteBank = null
      rt.iconBank = null
    },
    'erase temp'() {
      // Bnk.EffTemp +Lib.s:8059 tests `btst #Bnk_BitData,d0` and NOTHING
      // else, so what survives is Data banks. A Bob or Icon bank survives
      // because Bnk.ResBob/ResIco (+Lib.s:8153/8145) build their flags as
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
      if (isObjectBank(ref)) throw new AmosError('function call error')
      const bank = rt.memBanks.get(n)!
      if (len > bank.data.length || len < 0) throw new AmosError('function call error')
      bank.data = bank.data.subarray(0, len)
    },
    'list bank'(it) {
      // InListBank/Bnk.List +Lib.s:2194/8616: ascending bank number;
      // "NN - name8 S: $XXXXXXXX L: len" — numbers under 10 get a
      // leading space, bob/icon banks list their image COUNT as L:
      for (const b of rt.bankRefs()) {
        const num = (b.number < 10 ? ' ' : '') + b.number
        const hex = b.address.toString(16).toUpperCase().padStart(8, '0')
        it.write(`${num} - ${b.name.padEnd(8).slice(0, 8)} S: $${hex} L: ${b.length}\n`)
      }
    },
    poke(it) {
      const addr = it.evalInt()
      it.expect(',')
      const v = it.evalInt()
      const m = rt.resolveWrite(addr)
      if (m) m.data[m.off] = v & 0xff
    },
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
    'poke$'(it) {
      const addr = it.evalInt()
      it.expect(',')
      const str2 = it.evalStr()
      const m = rt.resolveWrite(addr)
      if (m) for (let i = 0; i < str2.length && m.off + i < m.data.length; i++) m.data[m.off + i] = str2.charCodeAt(i) & 0xff
    },
    fill(it) {
      // FillBis +Lib.s:2648: the long value written big-endian and repeated,
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
      // TransMem +Lib.s:2535: direction chosen by src/dst order so
      // overlapping moves within one bank stay correct
      const start = it.evalInt()
      it.expect(',')
      const end = it.evalInt()
      it.expect('to')
      const dest = it.evalInt()
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
      // InBload +Lib.s:4307: destination through Bnk.OrAdr — a bank
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
      // InBSave +Lib.s:4336: end-start must be positive (Rbls FonCall);
      // the start goes through Bnk.OrAdr
      const path = it.evalStr()
      it.expect(',')
      const start = it.evalInt()
      it.expect('to')
      const end = it.evalInt()
      const bankForm = start >= 0 && start < 0x10000
      const base = bankForm ? rt.bankBase(start) : start
      if (end - base <= 0) throw new AmosError('Illegal function call', 23)
      const m = rt.bankOrAddr(start)
      if (!m) throw new AmosError('address error')
      const len = Math.min(end - base, m.data.length - m.off)
      if (!rt.vfs?.writeFile(path, Uint8Array.from(m.data.subarray(m.off, m.off + len)))) {
        throw new AmosError('disc is write protected')
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
      // bob/icon banks (flag bits 2/3) carry serialised objects — unsupported
      if (bank.flags & 0x0c) throw new AmosError('Not a powerpacked bank', 23)
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
      if (efficiency < 0 || efficiency >= 5) throw new AmosError('Illegal function call', 23)
      const bank = rt.memBanks.get(num)
      if (!bank) throw new AmosError('bank not reserved', 36)
      const file = writePpBank({
        number: num,
        flags: bank.flags | (bank.memType ? 0x02 : 0),
        name: bank.name,
        data: bank.data,
      })
      if (!rt.vfs?.writeFile(path, file)) throw new AmosError('disc is write protected')
    },
    'sam raw'(it) {
      // InSamRaw +Music.s:3157: freq<=500 then length<=256 error; plays
      // through GoSam, so Sam Loop On applies to raw plays too
      const mask = it.evalInt()
      it.expect(',')
      const addr = it.evalInt()
      it.expect(',')
      const len = it.evalInt()
      it.expect(',')
      const freq = it.evalInt()
      if (freq <= 500 || len <= 256) throw new AmosError('Illegal function call', 23)
      const m = rt.resolveAddr(addr)
      if (!m) return
      const pcm = new Int8Array(m.data.buffer, m.data.byteOffset + m.off, Math.min(len, m.data.length - m.off))
      rt.samPlay(mask & 15, pcm, freq)
    },
    'hrev block'(it) {
      // RevBloc +W.s:12620: FindBloc raises "Block not defined" on a missing
      // block, then Retourne mirrors the pixels along the chosen axis.
      const b = rt.blocks.get(it.evalInt())
      if (!b) throw new AmosError('block not defined')
      for (let y = 0; y < b.h; y++) b.pixels.subarray(y * b.w, (y + 1) * b.w).reverse()
    },
    'vrev block'(it) {
      const b = rt.blocks.get(it.evalInt())
      if (!b) throw new AmosError('block not defined')
      for (let y = 0; y < b.h >> 1; y++) {
        const a = b.pixels.slice(y * b.w, (y + 1) * b.w)
        b.pixels.copyWithin(y * b.w, (b.h - 1 - y) * b.w, (b.h - y) * b.w)
        b.pixels.set(a, (b.h - 1 - y) * b.w)
      }
    },

    // ---- files (Open In/Out, Print #, sequential channels) ----
    'open random'(it) {
      // InOpenRandom +Lib.s:5249 (RanApp $80): opens the existing file
      // or creates it; the channel type is random-access
      const n = it.evalInt()
      it.expect(',')
      const path = it.evalStr()
      const data = rt.fs?.read(path)
      rt.fileChans.set(n, { mode: 'random', path, data: data ? Uint8Array.from(data) : new Uint8Array(0), pos: 0, out: [] })
    },
    field(it) {
      // InField +ILib.s:4769: Field #c, len As var$,... — the channel
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
        if (len <= 0) throw new AmosError('Illegal function call', 23)
        recSize += len
        fields.push({ len, get: () => str(tg.get()), set: (v: string) => tg.set(VS(v)) })
      } while (it.nm() === ',')
      c.fields = fields
      c.recSize = recSize
      c.fileSize = c.data.length
    },
    get(it) {
      // InGet +Lib.s:5291: Get #c,record — reads one record into the
      // Field variables; past the snapshot size is "end of file"
      const { c, off } = getPut(rt, it)
      if (off >= c.fileSize!) throw new AmosError('end of file')
      let pos = off
      for (const f of c.fields!) {
        if (pos + f.len > c.data.length) throw new AmosError('disc error')
        let s = ''
        for (let i = 0; i < f.len; i++) s += String.fromCharCode(c.data[pos + i]!)
        f.set(s)
        pos += f.len
      }
    },
    put(it) {
      // InPut +Lib.s:5324: writes each field (string truncated to the
      // field, short strings space-padded); writing may extend the file
      // by one record (offset > size is "end of file")
      const { c, off } = getPut(rt, it)
      if (off > c.fileSize!) throw new AmosError('end of file')
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
    'open in'(it) {
      const n = it.evalInt()
      it.expect(',')
      const path = it.evalStr()
      const data = rt.fs?.read(path)
      if (data == null) throw new AmosError(`file not found: ${path}`)
      rt.fileChans.set(n, { mode: 'in', path, data, pos: 0, out: [] })
    },
    /**
     * Open Port CHANNEL,NAME$ --- `InOpenPort` (+Lib.s:5078). Open In and
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
      const n = it.evalInt()
      it.expect(',')
      const path = it.evalStr()
      const serial = /^ser:/i.test(path) ? (rt.host?.serial?.open(0, DEV_SERIAL_DEFAULTS) ?? undefined) : undefined
      const data = serial ? new Uint8Array(0) : rt.fs?.read(path)
      if (data == null) throw new AmosError(`file not found: ${path}`)
      rt.fileChans.set(n, { mode: 'in', path, data, pos: 0, out: [], port: true, ...(serial ? { serial } : {}) })
    },
    'open out'(it) {
      const n = it.evalInt()
      it.expect(',')
      const path = it.evalStr()
      rt.fileChans.set(n, { mode: 'out', path, data: new Uint8Array(0), pos: 0, out: [], ...speakChannel(rt, path) })
    },
    append(it) {
      const n = it.evalInt()
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
      if (it.atStmtEnd()) {
        for (const n of [...rt.fileChans.keys()]) rt.closeChannel(n)
        return
      }
      rt.closeChannel(it.evalInt())
    },
    'print #'(it) {
      const n = it.evalInt()
      const c = rt.chan(n)
      if (c.mode !== 'out') throw new AmosError('file type mismatch')
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
      // assignment form: Pof(n) = position
      it.expect('(')
      const c = rt.chan(it.evalInt())
      it.expect(')')
      it.expectOp('=')
      const v = it.evalInt()
      if (c.mode === 'in') c.pos = Math.max(0, Math.min(c.data.length, v))
      else c.out.length = Math.max(0, Math.min(c.out.length, v))
    },
    'set input'(it) {
      const a = it.evalInt()
      it.expect(',')
      const b = it.evalInt()
      rt.chrInp = [a & 0xff, b < 0 ? -1 : b & 0xff]
    },
    mkdir(it) {
      if (!rt.vfs?.mkdir(it.evalStr())) throw new AmosError('disc error')
    },
    kill(it) {
      // DeleteFile() takes a file or an *empty* directory; a full one comes
      // back as a disc error rather than a missing file
      const path = it.evalStr()
      if (rt.vfs?.exists(path) == null) throw new AmosError('file not found')
      if (!rt.vfs.deleteFile(path)) throw new AmosError('disc error')
    },
    rename(it) {
      // Rename() also moves, within one volume — across devices, or onto
      // something that already exists, it fails
      const from = it.evalStr()
      it.expect('to')
      const to = it.evalStr()
      if (rt.vfs?.exists(from) == null) throw new AmosError('file not found')
      if (!rt.vfs.rename(from, to)) throw new AmosError('disc error')
    },
    assign(it) {
      const name = it.evalStr()
      it.expect('to')
      rt.vfs?.assign(name, it.evalStr())
    },
    'dir$'(it) {
      // assignment form: Dir$ = "path". InDirD (+Lib.s:4828) locks the path
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
      // InParent +Lib.s:4878: strip the last path component of the
      // current directory (back to the ':' or previous '/')
      void it
      const vfs = rt.vfs
      if (!vfs) return
      const cur = vfs.currentDir
      const i = cur.lastIndexOf('/')
      const c = cur.indexOf(':')
      vfs.currentDir = i > c ? cur.slice(0, i) : cur.slice(0, c + 1)
    },
    bgrab(it) {
      // InBGrab +Lib.s:2303: pull bank n from the PREVIOUS program's
      // list. There is no previous program in the port (yet — Prun), so
      // the destination is erased and the grab fails: Bnk.Eff + BkNoRes
      const n = it.evalInt()
      if (n <= 0) throw new AmosError('function call error')
      rt.memBanks.delete(n)
      throw new AmosError('bank not reserved')
    },
    bsend(it) {
      // InBSend +Lib.s:2333: push bank n to the previous program — with
      // no previous program, Bnk.PrevProgram fails: function call error
      const n = it.evalInt()
      if (n <= 0) throw new AmosError('function call error')
      throw new AmosError('function call error')
    },
    'set dir'(it) {
      // InSetDir0/1 (+Lib.s:5515): Set Dir [width][,neg$] — width is
      // forced even (and.l #$FFFFFFFE), must be 2..104; the second arg is
      // the negative filename filter for listings
      if (!(it.atStmtEnd() || it.nm() === ',')) {
        const w = it.evalInt() & ~1
        if (w === 0 || w >= 106) throw new AmosError('function call error')
        rt.dirWidth = w
      }
      if (it.accept(',')) rt.dirNegFilter = it.evalStr()
    },

    // ---- AMAL ----
    amal(it) {
      const n = it.evalInt()
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
    // ---- STOS-compatibility Anim / Move (InAnim2/InMoveX2 +Lib.s:11660) ----
    anim(it) {
      // Anim n,"(image,delay)...[L]" — an independent slot beside the
      // channel's AMAL program (ID channel*4+1, CreAMAL +W.s:7998)
      const n = it.evalInt()
      const limit = rt.synchroManual ? 64 : 16
      if (n >>> 0 >= limit) throw new AmosError('function call error')
      it.expect(',')
      const spec = parseStosAnim(amalSource(it))
      const slot = rt.stosSlot(n)
      slot.anim = { ...spec, idx: 0, left: 1, done: false, on: false, frozen: false }
    },
    'move x'(it) {
      const n = it.evalInt()
      const limit = rt.synchroManual ? 64 : 16
      if (n >>> 0 >= limit) throw new AmosError('function call error')
      it.expect(',')
      const spec = parseStosMove(amalSource(it))
      rt.stosSlot(n).moveX = { ...spec, gi: 0, speedLeft: 1, countLeft: spec.groups[0]![2] || 0x10000, started: false, done: false, on: false, frozen: false }
    },
    'move y'(it) {
      const n = it.evalInt()
      const limit = rt.synchroManual ? 64 : 16
      if (n >>> 0 >= limit) throw new AmosError('function call error')
      it.expect(',')
      const spec = parseStosMove(amalSource(it))
      rt.stosSlot(n).moveY = { ...spec, gi: 0, speedLeft: 1, countLeft: spec.groups[0]![2] || 0x10000, started: false, done: false, on: false, frozen: false }
    },
    'anim on'(it) {
      const n = it.atStmtEnd() ? null : it.evalInt()
      for (const [k, s] of rt.stosSlots) {
        if (n !== null && k !== n) continue
        if (s.anim) {
          s.anim.on = true
          s.anim.frozen = false
        }
      }
    },
    'anim off'(it) {
      const n = it.atStmtEnd() ? null : it.evalInt()
      for (const [k, s] of rt.stosSlots) {
        if (n !== null && k !== n) continue
        if (s.anim) s.anim.on = false
      }
    },
    'anim freeze'(it) {
      const n = it.atStmtEnd() ? null : it.evalInt()
      for (const [k, s] of rt.stosSlots) {
        if (n !== null && k !== n) continue
        if (s.anim) s.anim.frozen = true
      }
    },
    'move on'(it) {
      const n = it.atStmtEnd() ? null : it.evalInt()
      for (const [k, s] of rt.stosSlots) {
        if (n !== null && k !== n) continue
        for (const m of [s.moveX, s.moveY]) {
          if (m) {
            m.on = true
            m.frozen = false
          }
        }
      }
    },
    'move off'(it) {
      const n = it.atStmtEnd() ? null : it.evalInt()
      for (const [k, s] of rt.stosSlots) {
        if (n !== null && k !== n) continue
        for (const m of [s.moveX, s.moveY]) {
          if (m) m.on = false
        }
      }
    },
    'move freeze'(it) {
      const n = it.atStmtEnd() ? null : it.evalInt()
      for (const [k, s] of rt.stosSlots) {
        if (n !== null && k !== n) continue
        for (const m of [s.moveX, s.moveY]) {
          if (m) m.frozen = true
        }
      }
    },
    channel(it) {
      const n = it.evalInt()
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
      const target = rt.makeChannelTarget(kind, m)
      rt.chanTargets.set(n, target)
      const ch = rt.channels.get(n)
      if (ch) ch.target = target
    },
    'amal on'(it) {
      if (it.atStmtEnd()) {
        rt.amalDefaultOn = true
        for (const ch of rt.channels.values()) {
          ch.on = true
          ch.frozen = false
        }
        return
      }
      const ch = rt.channels.get(it.evalInt())
      if (ch) {
        ch.on = true
        ch.frozen = false
      }
    },
    'amal off'(it) {
      if (it.atStmtEnd()) {
        rt.amalDefaultOn = false
        for (const ch of rt.channels.values()) ch.on = false
        return
      }
      const ch = rt.channels.get(it.evalInt())
      if (ch) ch.on = false
    },
    'amal freeze'(it) {
      if (it.atStmtEnd()) {
        for (const ch of rt.channels.values()) ch.frozen = true
        return
      }
      const ch = rt.channels.get(it.evalInt())
      if (ch) ch.frozen = true
    },
    amplay(it) {
      // InAmPlay2/4 +Lib.s:12017 → SetPlay +W.s:7937. The PLay instruction
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
      if (last >>> 0 >= 64 || first < 0 || last < first) throw new AmosError('function call error')
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
    amreg(it) {
      // assignment form: Amreg([channel,] n) = value
      it.expect('(')
      const a = it.evalInt()
      const b = it.accept(',') ? it.evalInt() : null
      it.expect(')')
      it.expectOp('=')
      const v = it.evalInt()
      if (b === null) {
        if (a >= 0 && a < 26) rt.amalGlobals[a] = v
      } else {
        const ch = rt.channels.get(a)
        if (ch && b >= 0 && b < 10) ch.regs[b] = v
      }
    },

    'load iff'(it) {
      const path = it.evalStr()
      const n = it.accept(',') ? it.evalInt() : null
      const bytes = rt.fs?.read(path)
      if (!bytes) {
        if (it.policy === 'skip') {
          it.unimplemented.set('load iff (file missing)', (it.unimplemented.get('load iff (file missing)') ?? 0) + 1)
          return
        }
        throw new AmosError(`file not found: ${path}`)
      }
      // the reader lives in ../loader and raises plain Errors; error 30 is
      // AMOS's own answer for a file that is not the FORM it wants
      // (IffFormLoad +Lib.s:6876 `Rbne L_IffFor`, IffFor +Lib.s:13002
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
      // InMaskIff +Lib.s:4365: store the bitplane mask Load Iff obeys
      rt.iffMask = it.evalInt()
    },
    'save iff'(it) {
      // InSaveIff1/2 +Lib.s:4624: save the screen as a compressed ILBM;
      // the optional 2nd arg is the compression mode (must be < 3)
      const path = it.evalStr()
      if (it.accept(',')) {
        const mode = it.evalInt()
        if (mode >>> 0 >= 3) throw new AmosError('function call error')
      }
      const s = scr()
      const camg = (s.hires ? 0x8000 : 0) | (s.laced ? 4 : 0) | (s.ham ? 0x800 : 0) | (s.ehb ? 0x80 : 0)
      const bytes = encodeIlbm({ width: s.width, height: s.height, depth: s.depth, mode: camg, palette: [...s.palette], pixels: s.pixels })
      if (!rt.vfs?.writeFile(path, bytes)) throw new AmosError('disc is write protected')
    },
    save(it) {
      // InSave1/2 +Lib.s:3829: Save "file" = all banks (AmBs container);
      // Save "file",n = bank n alone (AmBk/AmSp/AmIc)
      const path = it.evalStr()
      const n = it.accept(',') ? it.evalInt() : null
      const bytes = n === null ? rt.serializeAllBanks() : rt.serializeBank(n)
      if (!rt.vfs?.writeFile(path, bytes)) throw new AmosError('disc is write protected')
    },
    pload(it) {
      // InPLoad +Lib.s:4254: load the code hunk of an AmigaDOS executable
      // into bank n as a Data bank (n<0 = chip RAM).
      //
      // The name is NOT "Data". +Lib.s:4288 reserves with `Rlea L_BkAsm,0`,
      // so a Ploaded bank is called "Asm     " -- the Data BIT is set, and
      // the name says what the bank holds rather than which bit is on.
      const path = it.evalStr()
      it.expect(',')
      const n = it.evalInt()
      if (n === 0) throw new AmosError('function call error')
      const bytes = rt.fs?.read(path)
      if (!bytes) {
        if (it.policy === 'skip') {
          it.unimplemented.set('pload (file missing)', (it.unimplemented.get('pload (file missing)') ?? 0) + 1)
          return
        }
        throw new AmosError(`file not found: ${path}`)
      }
      const data = extractCodeHunk(bytes)
      if (!data) throw new AmosError('file format not recognised')
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

  function bankPalette(): Instr {
    return (it) => {
      const mask = it.atStmtEnd() ? -1 : it.evalInt()
      const pal = rt.spriteBank?.palette
      if (pal) {
        for (let i = 0; i < Math.min(32, pal.length); i++) {
          if (mask & (1 << i)) scr().palette[i] = pal[i]!
        }
      }
    }
  }

  /** Get Bob/Sprite/Icon: [screen,] image, x1,y1 To x2,y2 */
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
        if (!sc) throw new AmosError(`screen not opened: ${args[0]}`)
        s = sc
        ;[img, x1, y1] = [args[1]!, args[2]!, args[3]!]
      } else if (args.length === 3) {
        ;[img, x1, y1] = [args[0]!, args[1]!, args[2]!]
      } else {
        throw new AmosError('Get Bob: wrong arguments')
      }
      const bank = kind === 'icon' ? (rt.iconBank ??= rt.newObjectBank()) : rt.needSpriteBank()
      // Ritoune +Lib.s:12697: w=x2-x1, h=y2-y1 both must be positive and
      // within the screen
      if (x2 <= x1 || y2 <= y1 || x2 > s.width || y2 > s.height) throw new AmosError('function call error')
      bank.setImage(img, rt.grab(s, x1, y1, x2, y2))
    }
  }

  /** Del Bob/Sprite/Icon n[ To m] — splice+compact (Bnk.DelBob +Lib.s:8372) */
  function delObj(kind: 'sprite' | 'icon'): Instr {
    return (it) => {
      const n = it.evalInt()
      const m = it.accept('to') ? it.evalInt() : n
      const bank = kind === 'icon' ? rt.iconBank : rt.spriteBank
      if (!bank) throw new AmosError('bank not reserved')
      if (!bank.delete(n, m)) {
        if (kind === 'icon') rt.iconBank = null
        else rt.spriteBank = null
      }
    }
  }

  /** Ins Bob/Sprite/Icon n — single blank insert (Bnk.InsBob +Lib.s:8316) */
  function insObj(kind: 'sprite' | 'icon'): Instr {
    return (it) => {
      const n = it.evalInt()
      const bank = kind === 'icon' ? (rt.iconBank ??= rt.newObjectBank()) : rt.needSpriteBank()
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
export function makeRawFunctions(rt: Runtime): Record<string, (it: It) => import('../interp/values').Value> {
  return {
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
      if (n <= 0 || dest <= 0) throw new AmosError('Illegal function call', 23)
      const c = rt.chan(f)
      if (c.mode !== 'in') throw new AmosError('file type mismatch')
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
      // =Frame Length(f[,n]) — FnFormLength +Lib.s:4458: bytes for the
      // next n FORMs (+4 for AenD) without moving the position
      it.expect('(')
      const f = it.evalInt()
      const n = it.accept(',') ? it.evalInt() : 1
      it.expect(')')
      if (n < 0 || n >= 32768) throw new AmosError('Illegal function call', 23)
      const c = rt.chan(f)
      if (c.mode !== 'in') throw new AmosError('file type mismatch')
      return VI(formSize(c.data, c.pos, n).bytes)
    },
    'frame play'(it) {
      // =Frame Play(ad,n[,screen]) — FnFormPlay +Lib.s:4487: plays n
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
      // =Frame Skip(ad[,n]) — FnFormSkip +Lib.s:4513: bit 30 set, no
      // drawing; returns the advanced address
      it.expect('(')
      const ad = it.evalInt()
      const n = it.accept(',') ? it.evalInt() : 1
      it.expect(')')
      return VI(framePlaySkip(rt, ad, n, null, true))
    },
    varptr(it) {
      // FnVarPtr +ILib.s:4087: numbers -> the address of the 4-byte cell
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
      // FnHunt +Lib.s:2672: the start goes through Bnk.OrAdr (a bank
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
  return {
    /**
     * =Arexx Exist("port") --- `FnArexxExist` (+Lib.s:15025), which is
     * `Arx_RegisterPort` with d0 = 0: a LOOKUP rather than a registration.
     * Non-zero when a public port of that name is there. Names are
     * case-sensitive, as exec's FindPort is.
     */
    'arexx exist'(_, a) {
      const name = a[0]!.k === 'str' ? a[0]!.s : ''
      return VI(rt.rexx.exists(name) ? -1 : 0)
    },

    /**
     * =Arexx --- `FnArexx` (+Lib.s:15064). Three answers, not two: 0 for no
     * message, 1 for a message, and 2 for a message whose rm_Action has
     * RXFF_RESULT set, meaning the sender wants a result STRING and not just
     * a return code. A program branches on 2 to decide whether to bother
     * building one.
     */
    'arexx'() {
      return VI(arexxPoll(rt))
    },

    /**
     * =Arexx$(n) --- `FnArexxD` (+Lib.s:15106). Argument n of the message
     * being held, 0 to 15 (`cmp.l #16,d3 / Rbcc L_FonCall`). The empty string
     * when no message is held, when that argument slot is null, or when its
     * `ra_Length` is zero -- three separate `Rbeq L_Ret_ChVide` arms for what
     * a program sees as one answer.
     */
    'arexx$'(_, a) {
      const n = int(a[0]!)
      if (n < 0 || n >= 16) throw new AmosError('function call error')
      const m = rt.arexx.held
      return VS(m ? (m.args[n] ?? '') : '')
    },

    /**
     * =Port(CHANNEL) --- `FnPort` (+Lib.s:5050). `GetFile` first, so a
     * channel that is not open raises; then `btst #2,FhT(a2)` refuses one
     * that was not opened by `Open Port` -- a file-type mismatch, not a quiet
     * zero. Then `WaitForChar` for 50 microseconds: nothing waiting answers
     * TRUE (-1) through `L_FnTrue`, and otherwise ONE byte is Read and
     * returned.
     *
     * So -1 is "no character yet" and 0 to 255 is the character, which is why
     * a program loops on it rather than testing for zero.
     */
    'port'(_, a) {
      const c = rt.fileChans.get(int(a[0]!))
      if (!c) throw new AmosError('file not opened')
      if (!c.port) throw new AmosError('file type mismatch')
      if (c.serial) {
        const got = c.serial.read()
        return VI(got.length > 0 ? got[0]! & 0xff : -1)
      }
      if (c.pos >= c.data.length) return VI(-1)
      return VI(c.data[c.pos++]! & 0xff)
    },

    /**
     * =Dev Base(CHANNEL) --- `FnDevBase` (+Lib.s:3341): the first long of the
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
     * =Dev Check(CHANNEL) --- `FnDevCheck` (+Lib.s:3385). GetIO first, so a
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
      // RPoint +Lib.s:9586 calls GrXY, so =Point(x,y) moves the graphics
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
      return VI(rt.currentIndex)
    },
    'screen width'(_, a) {
      // FnScreenWidth0/1 +Lib.s:8778: EcTx bitmap width; an explicit
      // unopened screen number is an error, not a fallback
      return VI(screenArg(rt, a).width)
    },
    'screen height'(_, a) {
      return VI(screenArg(rt, a).height)
    },
    'screen colour'(_, a) {
      void a
      return VI(scr().nColors)
    },
    colour(_, a) {
      if (a.length !== 1) throw new AmosError('wrong number of arguments')
      return VI(scr().palette[int(a[0]!) & 31]!)
    },
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
    'x screen'(_, a) {
      const x = int(a[a.length - 1]!)
      return VI((x - 128) * (scr().hires ? 2 : 1) + scr().offsetX)
    },
    'y screen'(_, a) {
      const y = int(a[a.length - 1]!)
      return VI(y - 50 + scr().offsetY)
    },
    'x hard'(_, a) {
      const x = int(a[a.length - 1]!)
      return VI(Math.trunc((x - scr().offsetX) / (scr().hires ? 2 : 1)) + 128)
    },
    'y hard'(_, a) {
      const y = int(a[a.length - 1]!)
      return VI(y - scr().offsetY + 50)
    },
    'screen base'() {
      // FnScreenBase +Lib.s:8798: ScOnAd — the current screen's control
      // block (the Ec structure), mapped read-only so Deek/Leek walks work
      return VI(rt.screenCtrlAddr(rt.currentIndex) | 0)
    },
    logic(_, a) {
      // Logic() = $BFFFFFFF, Logic(n) = $80000000|n (FnLogic0/1)
      if (a.length === 0) return VI(0xbfffffff | 0)
      return VI((0x80000000 | (int(a[0]!) & 0xff)) | 0)
    },
    physic(_, a) {
      if (a.length === 0) return VI(-1)
      return VI((0xc0000000 | (int(a[0]!) & 0xff)) | 0)
    },
    'text length'(_, a) {
      // TextLength() with the set font: sum of per-char advances
      return VI(scr().measureText(str(a[0]!)))
    },
    'text styles'() {
      // FnTextStyle +Lib.s:9898: the rastport SoftStyle byte
      return VI(scr().textStyle)
    },
    'frame param'(_, a) {
      // FnFormParam +Lib.s:4616: the last DLTA's ANHD relative time
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
      // FnChipFree +Lib.s:2510 = AvailMem(MEMF_CHIP)
      void a
      return VI(rt.chipFree())
    },
    'fast free'(_, a) {
      // FnFastFree +Lib.s:2517 = AvailMem(MEMF_FAST)
      void a
      return VI(rt.fastFree())
    },
    free(_, a) {
      // FnFree +Lib.s:13600 garbage-collects then reports TabBas-HiChaine,
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
    // (FnPrgFirst/FnDevFirst +Lib.s:5539 both go through DevAcc/FillDev):
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
      // FnPicture +Lib.s:4372: a legacy AMOS 1.3 constant, always 127
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
    'zone$'(_, a) {
      // FnZoneD +Lib.s:14167: Zone$(text$,n) wraps text as a printable
      // text-zone — ESC "Z" <n> text ESC "Z" <n> (n is the last arg, d3);
      // n in 1..206 (sibling of Border$)
      const text = str(a[0]!)
      const n = int(a[1]!)
      if (n < 1 || n >= 207) throw new AmosError('function call error')
      const tag = '\x1bZ' + String.fromCharCode(48 + n)
      return VS(tag + text + tag)
    },

    // ---- objects ----
    'x bob'(_, a) {
      return VI(rt.bobs.get(int(a[0]!))?.x ?? 0)
    },
    'y bob'(_, a) {
      return VI(rt.bobs.get(int(a[0]!))?.y ?? 0)
    },
    'i bob'(_, a) {
      return VI(rt.bobs.get(int(a[0]!))?.image ?? 0)
    },
    'x sprite'(_, a) {
      return VI(rt.hwSprites.get(int(a[0]!))?.x ?? 0)
    },
    'y sprite'(_, a) {
      return VI(rt.hwSprites.get(int(a[0]!))?.y ?? 0)
    },
    'i sprite'(_, a) {
      return VI(rt.hwSprites.get(int(a[0]!))?.image ?? 0)
    },
    'bob col'(_, a) {
      return VI(rt.bobColCheck(int(a[0]!), a.length > 1 ? int(a[1]!) : -Infinity, a.length > 2 ? int(a[2]!) : Infinity))
    },
    'sprite col'(_, a) {
      return VI(rt.spriteColCheck(int(a[0]!), a.length > 1 ? int(a[1]!) : 0, a.length > 2 ? int(a[2]!) : 63))
    },
    'bobsprite col'(_, a) {
      // FnBobSpriteCol1/3 +Lib.s:12367: bob n against hardware sprites
      return VI(rt.bobSpriteColCheck(int(a[0]!), a.length > 1 ? int(a[1]!) : 0, a.length > 2 ? int(a[2]!) : 63))
    },
    'spritebob col'(_, a) {
      // FnSpriteBobCol1/3 +Lib.s:12419: sprite n against bobs
      return VI(rt.spriteBobColCheck(int(a[0]!), a.length > 1 ? int(a[1]!) : 0, a.length > 2 ? int(a[2]!) : 10000))
    },
    hardcol(_, a) {
      // FnHardcol +Lib.s:12353: -1 or lower asks about the playfields,
      // otherwise the sprite number, and 8 or above is a function call
      // error (cmp.l #8,d3 / bcc)
      const n = int(a[0]!)
      if (n >= 8) throw new AmosError('function call error')
      return VI(rt.hardcol(n))
    },
    col(_, a) {
      // =Col(n): >=0 membership; <0 = the first colliding object number
      return VI(rt.colGet(int(a[0]!)))
    },
    zone(_, a) {
      // FnZone2/3 (+Lib.s:10974) -> SyZoGr (+W.s:11141) -> GZone. The
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
      // FnHZone2/3 (+Lib.s:11009) -> SyZoHd (+W.s:11150) -> ZoEc -> GZone.
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
      // FnMouseZone +Lib.s:11077 is `moveq #0,d3` then SyCall ZoHd — d3 = 0
      // is "the current screen", the same selector Zone(x,y) passes, so
      // Mouse Zone asks only the current screen's table and not, as SyMouZ
      // (+W.s:11216, which nothing calls) would, every screen in priority
      // order.
      void a
      return VI(rt.hardZoneAt(scr(), it.inp.mouseX, it.inp.mouseY))
    },
    exist(_, a) {
      return VI(rt.fs?.read(str(a[0]!)) !== null && rt.fs !== null ? -1 : 0)
    },
    scin(_, a) {
      // ScIn(x,y): which screen is under this hardware coordinate?
      const x = int(a[a.length - 2]!)
      const y = int(a[a.length - 1]!)
      for (let i = rt.order.length - 1; i >= 0; i--) {
        const s = rt.screens.get(rt.order[i]!)
        if (!s || !s.visible) continue
        const sx = s.hardToScreenX(x) - s.offsetX
        const sy = y - s.displayY
        if (sx >= 0 && sy >= 0 && sx < s.width && sy < s.height) return VI(s.index)
      }
      return VI(-1)
    },
    'key shift'(it, a) {
      // FnKeyShift +Lib.s:13660: the qualifier byte — 0 LShift, 1 RShift,
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
      // FnLength +Lib.s:2491 takes the byte length and then, for a Bob or Icon
      // bank, replaces it with `move.w (a1),d3` -- the image COUNT. bankRef
      // carries that rule so nothing else has to know it
      return VI(rt.bankRef(int(a[0]!))?.length ?? 0)
    },

    // ---- AMAL ----
    amreg(_, a) {
      if (a.length === 2) {
        const ch = rt.channels.get(int(a[0]!))
        const r = int(a[1]!)
        return VI(ch && r >= 0 && r < 10 ? ch.regs[r]! : 0)
      }
      const n = int(a[0]!)
      return VI(n >= 0 && n < 26 ? rt.amalGlobals[n]! : 0)
    },
    chanan(_, a) {
      return VI(rt.channels.get(int(a[0]!))?.animating ? -1 : 0)
    },
    chanmv(_, a) {
      return VI(rt.channels.get(int(a[0]!))?.moving ? -1 : 0)
    },
    amalerr() {
      return VI(rt.amalErrPos)
    },

    // ---- audio ----
    vumeter(_, a) {
      // FnVuMeter +Music.s:3893: voice 0-3 else illegal function call
      const v = int(a[0]!)
      if (v < 0 || v >= 4) throw new AmosError('Illegal function call', 23)
      return VI(rt.vumeter(v))
    },
    mubase() {
      // FnMusicBase +Music.s:3907: the extension data zone address; the
      // vumeter bytes at +0..3 are mapped into the fake address space
      return VI(Runtime.MUBASE_ADDR)
    },
    'sam swapped'(_, a) {
      // FnSamSwapped +Music.s:4055: voice 0-3 else illegal function call;
      // 1 = voice off, 0 = swap pending, -1 = playing / swap consumed
      const v = int(a[0]!)
      if (v < 0 || v > 3) throw new AmosError('Illegal function call', 23)
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
        if (c.mode !== 'in') throw new AmosError('file type mismatch')
        const n = int(a[1]!)
        let out = ''
        for (let i = 0; i < n && c.pos < c.data.length; i++) out += String.fromCharCode(c.data[c.pos++]!)
        return VS(out)
      }
      // Input$(n): n keys from the keyboard queue (non-blocking best effort)
      const n = int(a[0]!)
      let out = ''
      for (let i = 0; i < n; i++) {
        const k = it.inp.keyQueue.shift()
        if (!k) break
        out += k.ch
      }
      return VS(out)
    },
    'dir$'(_, a) {
      void a
      return VS(rt.vfs?.currentDir ?? '')
    },
    'disc info$'(_, a) {
      // FnDiscInfo +Lib.s:4995: "VOLUME:" (from the volume node of the
      // locked path) + a 10-char field with the free byte count
      // left-aligned (LongToDec into ten spaces). Free space matches
      // =Dfree — the browser store has no real quota (see NOTES).
      const path = a.length > 0 ? str(a[0]!) : ''
      const vfs = rt.vfs
      if (!vfs) throw new AmosError('device not available')
      const r = vfs.resolve(path === '' ? vfs.currentDir : path)
      if (!r || vfs.exists(path === '' ? vfs.currentDir : path) === null) {
        throw new AmosError('device not available')
      }
      const volName = r.canonical.split(':')[0]!
      return VS(`${volName}:` + String(0x7fffffff).padEnd(10))
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
      // directories always list (FillNxt +Lib.s:6213: tst.w 4(a2) bpl)
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
      void a
      return VI(0x7fffffff)
    },
    choice(_, a) {
      // =Choice: self-clearing latch (-1/0); =Choice(n): level n's number
      const m = rt.menu
      if (a.length === 0) {
        const v = m.choice
        m.choice = 0
        return VI(v)
      }
      const n = int(a[0]!)
      return VI(m.choix[n - 1] ?? 0)
    },
    'x menu'(_, a) {
      const node = rt.menu.find(a.map((v) => int(v)))
      return VI(node ? node.x : 0)
    },
    'y menu'(_, a) {
      const node = rt.menu.find(a.map((v) => int(v)))
      return VI(node ? node.y : 0)
    },

    'dialog run'(it, a) {
      // FnDialogRun1/2/4 +Lib.s:14500: =Dialog Run(c[,label][,x,y]); RU in
      // the script blocks the interpreter until the wait loop exits
      const c = int(a[0]!)
      if (c <= 0) throw new AmosError('function call error')
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
      if (label >= 65536) throw new AmosError('function call error')
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
        if (!progs || n < 1 || n > progs.length) throw new AmosError('function call error')
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
      // FnDialog +Lib.s:14538 → Dia_GetReturn: -1 when not drawn, else the
      // return value, read-and-cleared (one-shot)
      const c = int(a[0]!)
      if (c <= 0) throw new AmosError('function call error')
      const d = rt.dialogs.get(c)
      if (!d) throw new AmosError(DIALOG_ERRORS[6]!)
      if (!d.drawn) return VI(-1)
      const v = d.ret
      d.ret = 0
      return VI(v)
    },
    vdialog(_, a) {
      // FnVDialog +Lib.s:14563: raw long read; string slots read as 0
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
      // FnEDialog +Lib.s:14391: position of the last dialog error
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
      // FnPSel (+Lib.s:6771) is a bare `rts`. The keyword has four token-table
      // variants and no implementation at all in AMOS Professional, so it
      // returns d3 — the last argument — untouched.
      return VS(a.length > 0 ? str(a[a.length - 1]!) : '')
    },
    rdialog(_, a) {
      // FnRDialog2/3 +Lib.s:14588 → Dia_GetValue: a zone's numeric result
      // (string-valued zones read as 0)
      const v = rdialogValue(rt, a)
      return VI(v.s === null ? v.n : 0)
    },
    'rdialog$'(_, a) {
      const v = rdialogValue(rt, a)
      return VS(v.s ?? '')
    },
    zdialog(_, a) {
      // FnZDialog +Lib.s:14632 → Dia_GetZ: zone number at screen x,y
      const d = rt.dialogs.get(int(a[0]!))
      if (!d) throw new AmosError(DIALOG_ERRORS[6]!)
      const z = dialogZoneAt(d, int(a[1]!), int(a[2]!))
      return VI(z ? z.number : -1)
    },
    movon(_, a) {
      // =Movon(n) (FnMovon +Lib.s:11945): -1 while a Move X/Y program on
      // channel n is still running
      const n = int(a[0]!)
      if (n < 0) throw new AmosError('function call error')
      const s = rt.stosSlots.get(n)
      const live = (m: { on: boolean; done: boolean } | undefined): boolean => !!m && m.on && !m.done
      return VI(s && (live(s.moveX) || live(s.moveY)) ? -1 : 0)
    },
    'cop logic'(_, a) {
      // =Cop Logic (FnCopLogic +Lib.s:9527 → TCopBs): the address of the
      // logical copper list — real mapped memory, Leek/Loke reach it
      void a
      return VI(rt.copLogicAddr() | 0)
    },
    rain(_, a) {
      // =Rain(n,line) (FnRain +Lib.s:9447 → TRVar +W.s:3966): bounds
      // errors report as OUT OF MEMORY via EcWiErr, like Rainbow
      const n = int(a[0]!)
      const line = int(a[1]!)
      const rb = rt.rainbows.get(n)
      if (n >>> 0 >= 4 || !rb || rb.table.length === 0 || line < 0 || line >= rb.table.length)
        throw new AmosError('out of memory')
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
      // MaxRaw +Lib.s:8835 / TMaxRaw +W.s:2607: the current screen's bottom
      // raster line — laced screens reach ~2x
      void a
      const s = rt.screen
      return VI(s.laced ? s.height : Math.min(283, Math.max(s.height, 256)))
    },
    'screen mode'(_, a) {
      // FnScreenMode +Lib.s:8818: EcCon0 & $8004
      void a
      const s = rt.screen
      return VI((s.hires ? 0x8000 : 0) | (s.laced ? 4 : 0))
    },
    logbase(_, a) {
      // FnLogBase +Lib.s:8851: EcLogic[plane]; the plane arg defaults to 0
      return VI(planeBase(rt, a.length ? int(a[0]!) : 0, 0))
    },
    phybase(_, a) {
      // FnPhyBase +Lib.s:8864: EcPhysic[plane]; the plane arg defaults to 0
      return VI(planeBase(rt, a.length ? int(a[0]!) : 0, 1))
    },
    'font$'(_, a) {
      // FnFont +Lib.s:9786: requires Get Fonts first ("fonts not
      // examined"); negative errors; past the list returns "". The
      // string is exactly 38 chars: name to 30, height decimal at 30,
      // "Rom "/"Disc" at 34.
      const n = int(a[0]!)
      if (n < 0) throw new AmosError('Illegal function call', 23)
      if (!rt.fontsListed) throw new AmosError('fonts not examined')
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
      // Records are 1-based within each block (GetMessage +B.s:590) and
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
      throw new AmosError('Illegal function call', 23)
    },

    at(_, a) {
      // FnAt +Lib.s:14046: Esc X / Esc Y escapes, one per present
      // coordinate; values above 207 (255-48) are a function call error
      let out = ''
      const x = int(a[0]!)
      const y = int(a[1]!)
      if (x > 207 || y > 207) throw new AmosError('Illegal function call', 23)
      if (x >= 0) out += '\x1bX' + String.fromCharCode(48 + x)
      if (y >= 0) out += '\x1bY' + String.fromCharCode(48 + y)
      return VS(out)
    },

    // ---- flips, memory, conversions ----
    hrev(_, a) {
      return VI(int(a[0]!) | 0x8000) // flip flag consumed by image()
    },
    vrev(_, a) {
      return VI(int(a[0]!) | 0x4000)
    },
    rev(_, a) {
      // FnRev +Lib.s:12744: both flip bits at once
      return VI(int(a[0]!) | 0xc000)
    },
    drive(_, a) {
      // FnDrive +Lib.s:4951: True when the name ends with ':' AND the
      // device/assign resolves (DeviceProc), else False
      const s = str(a[0]!)
      if (!s.endsWith(':')) return VI(0)
      const known = [...(rt.vfs?.volumeNames() ?? []), ...(rt.vfs?.assignNames() ?? [])].map((n) => n.toLowerCase())
      return VI(known.includes(s.slice(0, -1).toLowerCase()) ? -1 : 0)
    },
    'scan$'(_, a) {
      // FnScan1/2 +Lib.s:13799: a 4-byte Put Key scancode injection
      // string — chr$(1), scancode, shift, chr$(0); both bytes < 256
      const scan = int(a[0]!)
      const shift = a.length > 1 ? int(a[1]!) : 0
      if (scan >>> 0 >= 256 || shift >>> 0 >= 256) throw new AmosError('function call error')
      return VS(String.fromCharCode(1, scan, shift, 0))
    },
    'bstart'(_, a) {
      // FnBStart +Lib.s:2271: bank address in the PREVIOUS program's list
      // (the editor/accessory exchange) — no parent program here, so the
      // Bnk.PrevProgram failure path: bank not reserved
      void a
      throw new AmosError('bank not reserved')
    },
    'blength'(_, a) {
      // FnBLength +Lib.s:2284: 0 when there is no previous program's bank
      void a
      return VI(0)
    },
    start(_, a) {
      // FnStart +Lib.s:2481 is `Rbsr L_Bnk.GetAdr / Rbeq L_BkNoRes / move.l
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
      // =Squash(address,length,fast,speed,colour) — Squash +CompExt.s:969.
      // Compresses in place and returns the compressed length, or -1 when the
      // result would not beat the original ("Squashed >= Normal").
      const address = int(a[0]!)
      const length = int(a[1]!)
      const speed = a.length >= 4 ? int(a[3]!) : 4095
      const colour = a.length >= 5 ? int(a[4]!) : 0
      if (length <= 0 || colour < 0 || colour >= 32) throw new AmosError('Illegal function call', 23)
      if (a.length >= 4 && (speed < 256 || speed >= 4096)) throw new AmosError('Illegal function call', 23)
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
      if (length <= 0) throw new AmosError('Illegal function call', 23)
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
      const m = rt.resolveAddr(int(a[0]!))
      if (!m) return VS('')
      const len = int(a[1]!)
      const stop = a.length > 2 ? str(a[2]!).charCodeAt(0) : -1
      let out = ''
      for (let i = 0; i < len && m.off + i < m.data.length; i++) {
        const b = m.data[m.off + i]!
        if (b === stop) break
        out += String.fromCharCode(b)
      }
      return VS(out)
    },
    btst(_, a) {
      return VI(int(a[1]!) & (1 << (int(a[0]!) & 31)) ? -1 : 0)
    },
    'x text'(_, a) {
      const x = int(a[0]!) >> 3
      return VI(x >= 0 && x < scr().width >> 3 ? x : -1)
    },
    'y text'(_, a) {
      const y = int(a[0]!) >> 3
      return VI(y >= 0 && y < scr().height >> 3 ? y : -1)
    },
    'x graphic'(_, a) {
      return VI(int(a[0]!) * 8)
    },
    'y graphic'(_, a) {
      return VI(int(a[0]!) * 8)
    },
    'mouse screen'(it, a) {
      void a
      for (let i = rt.order.length - 1; i >= 0; i--) {
        const s = rt.screens.get(rt.order[i]!)
        if (!s || !s.visible) continue
        const sx = s.hardToScreenX(it.inp.mouseX) - s.offsetX
        const sy = it.inp.mouseY - s.displayY
        if (sx >= 0 && sy >= 0 && sx < s.width && sy < s.height) return VI(s.index)
      }
      return VI(-0x80000000) // GetSIn +W.s:10944 returns EntNul when over no screen
    },
    scanshift(it, a) {
      // FnScanshift +Lib.s:13640: the shift byte captured with the last
      // Inkey$, read AND cleared (like Scancode)
      void a
      const v = it.inp.lastShift
      it.inp.lastShift = 0
      return VI(v)
    },
    'pen$'(_, a) {
      return VS('\x1bP' + String.fromCharCode(48 + int(a[0]!)))
    },
    'paper$'(_, a) {
      return VS('\x1bB' + String.fromCharCode(48 + int(a[0]!)))
    },
    'cmove$'(_, a) {
      const x = a.length > 0 ? int(a[0]!) : 0
      const y = a.length > 1 ? int(a[1]!) : 0
      return VS('\x1bO' + String.fromCharCode(128 + x) + '\x1bN' + String.fromCharCode(128 + y))
    },
    'border$'(_, a) {
      // FnBorderD +Lib.s:14153: style 1-15 (0 and >=16 error); the text
      // is wrapped in Esc E 0 (store position) ... Esc E n (draw box)
      const n = int(a[1]!)
      if (n <= 0 || n >= 16) throw new AmosError('Illegal function call', 23)
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
