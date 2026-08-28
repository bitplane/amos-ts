/**
 * IntuiExtend 2.01b, the ReqTools group.
 *
 * Twenty-three keywords over reqtools.library, and all of them go through one
 * long at workspace+$10. `Rt Lib Open` (routine 209, $44e8) fills it and
 * every other keyword in the group opens with the same four instructions:
 *
 *     $452a  movea.l  $258(a5),a0
 *     $452e  adda.w   #$10,a0
 *     $4532  tst.l    (a0)
 *     $4534  beq.b    $4588        ; straight to the rts
 *
 * so a program that forgets `Rt Lib Open` gets nothing at all from any of
 * them. That is modelled: `base` is 0 until the keyword is called.
 *
 * ## The seven that leave their arguments behind
 *
 * The branch above jumps PAST the `(a3)+` pops. AMOS pushes arguments onto
 * a3 and the routine is what takes them off again, so with the library
 * unopened `Rt File Req`, `Rt Dir Req`, `Rt Multifile Req`, `Rt Text Req`,
 * `Rt String Req`, `Rt Number Req` and `Rt Screen Mode Req` all return
 * leaving their arguments on the stack, and everything evaluated afterwards
 * reads one argument too far.
 *
 * Two of the nine get it right, in two different ways. `Rt Palette Req`
 * tests first and cleans up with `$48c8 adda.l #$c,a3`, three longs at once.
 * `Rt Font Req` pops all three arguments at $48d0-$48d6 BEFORE it looks at
 * the base at all.
 *
 * DEFECT: seven of the nine walk off leaving their arguments behind. This
 * port cannot reproduce what follows, because arguments arrive here already
 * evaluated rather than on a shared stack, so the seven consume theirs and
 * answer 0. What the machine does after the misalignment depends on what the
 * program evaluates next, which is not behaviour a port can offer.
 *
 * ## FLAG is the tag list in three of them
 *
 * `rtPaletteRequestA(title,reqinfo,taglist)(A2/A3,A0)`,
 * `rtFontRequestA(fontreq,title,taglist)(A1,A3,A0)` and
 * `rtScreenModeRequestA(screenmodereq,title,taglist)(A1,A3,A0)` all take
 * their tag list in a0, and all three keywords leave the guide's FLAG there:
 *
 *     $48a4  movea.l  (a3)+,a0    ; POS, overwritten on the next line
 *     $48a6  movea.l  (a3)+,a0    ; FLAG
 *     ...
 *     $48b0  jsr      -$66(a6)    ; rtPaletteRequestA, a0 still FLAG
 *
 * The guide documents FLAG as 0, 1 or 4 for each of the three. A FLAG of 0
 * is a NULL tag list and works; 1 or 4 is a TagItem array at address 1 or 4.
 * DEFECT: marked where each of the three is defined. The port ignores a
 * non-zero FLAG there, because a Guru is not behaviour to be faithful to.
 *
 * `Rt Text Req` and `Rt String Req` are the two that use FLAG properly:
 * `move.l (a3)+,$10(a2)` puts it in rtReqInfo.Flags, which is RTEZ_Flags and
 * RTGS_Flags, and the guide's 1 and 4 are NORETURNKEY and CENTERTEXT there.
 *
 * ## POS
 *
 * rtReqInfo and rtFileRequester both start with ReqPos, so
 * `move.l (a3)+,(a2)` is POS reaching it in the five keywords that do it.
 * `Rt Font Req` writes POS to `$8(a1)` instead, which is rtfo_Flags, and
 * `Rt Palette Req` and `Rt Screen Mode Req` pop it into a0 and overwrite it.
 *
 * ## The workspace this group keeps
 *
 * Every answer lands in the static workspace at $1d28 rather than being
 * returned, which is why the group needs nine "get" keywords:
 *
 *     +$010  ReqToolsBase
 *     +$602  the file name, as an AMOS string: length word, text at +$604
 *     +$670  the directory, length word, text at +$672
 *     +$6f2  the rtFileList head, +$6f6 the count as a word
 *     +$6fa  the font name, length word, text at +$6fc
 *     +$73c  the font size, a word --- $40 past the name text, so 64 bytes
 *     +$75c  the screen mode block: id, width, height, depth, overscan,
 *            autoscroll, at +0, +4, +6, +8, +$a and +$c
 *
 * `Rt Get Name$` (routine 212) is `$258(a5)` plus $602 with d2 of 2, and
 * `Rt Get Font Size` (routine 142) is the word at +$73c. The offsets are the
 * keywords.
 *
 * ## Evidence
 *
 * BINARY tier. Every LVO and register assignment was read out of
 * `fixtures/aminet/ReqToolsDev/ReqTools/fd/reqtools_lib.fd`, every structure
 * offset computed from that release's `include/libraries/reqtools.h`, and the
 * return values quoted from its `doc/reqtools.doc`. ../amiga/reqtools.ts is
 * the library itself, ported for `intuition-1.3b`, and ./rtreq.ts is the
 * frame loop; this file is the veneer between them and the keywords.
 * Documented against `IntuiExtend_2.0.Guide`'s Request.guide, @Author CIERP
 * Philippe.
 *
 * ## Three things the guide gets wrong
 *
 * ReqA has `Rt Number Req` backwards. It says "BOUT=0 Si le bouton Ok est
 * selectionne ou 1 Si c'est le bouton Annuler/Cancel", and routine 224 hands
 * rtGetLongA's result straight back in d3. `reqtools.doc`:1130 is
 * "ret - TRUE if user entered a number, FALSE if not."
 *
 * ReqG links `Rt Get Display Overscantype` and `Rt Get Display Autoscroll`.
 * The table calls them `rt get overscan type` and `rt get autoscroll`, so
 * neither name the guide gives will parse.
 *
 * `Rt Get Display Id` has no node in the guide at all, and it is the one of
 * the six that names the mode rather than describing it.
 *
 * ## Two keywords that always answer 0
 *
 * OverscanType is filled in only when SCREQF_OVERSCANGAD asked for the
 * gadget, and AutoScroll only under SCREQF_AUTOSCROLLGAD --- `reqtools.doc`
 * :1710 and :1717. Routine 227 passes FLAG as its tag list and never sets
 * RTSC_Flags, so neither gadget is ever on the requester and neither field is
 * ever written. `Rt Get Overscan Type` and `Rt Get Autoscroll` read them
 * anyway.
 */
import type { Runtime } from './runtime'
import type { Func, Instr } from '../interp/builtins'
import { VI, VS, int, str, type Value } from '../interp/values'
import {
  FREQF,
  REQ_MODE,
  RT_MAXINT,
  RT_MININT,
  RT_TEXT,
  type FileReqSetup,
  type FontReqSetup,
  type PaletteReqSetup,
  type ReqSetup,
  type ScreenReqSetup,
} from '../amiga/reqtools'
import { ieMem } from './intuiextendwin'

/**
 * What `Rt Lib Open` hands back the first time.
 *
 * A library base is a pointer and nothing in this port reads one as memory,
 * so it is a handle, minted a page above IE_WINDOW_BASE for the same reason
 * that one was.
 */
export const IE_REQTOOLS_BASE = 0x4b00_0000

/** the screen mode block at workspace+$75c, before any request has filled it */
export interface IeScreenMode {
  id: number
  width: number
  height: number
  depth: number
  overscan: number
  autoScroll: number
}

export interface IeReqState {
  /** workspace+$10, and 0 is what every keyword in the group tests for */
  base: number
  /** workspace+$602 */
  name: string
  /** workspace+$670 */
  dir: string
  /** workspace+$6f2 and the count at +$6f6 */
  files: string[]
  /** workspace+$6fa */
  fontName: string
  /** workspace+$73c */
  fontSize: number
  /** workspace+$75c */
  screen: IeScreenMode
  /**
   * What a blocked keyword needs when it comes back.
   *
   * `Rt String Req` fills the buffer with DEFAULTTEXT$ before the call and
   * reads the buffer after it, so a cancel hands the default back; the
   * default has to outlive the block to do that. `Rt Number Req` writes
   * rtGetLongA's answer through VAL_ADR and needs the address again.
   */
  pendingText: string
  pendingAddr: number
}

export function newIeReqState(): IeReqState {
  return {
    base: 0,
    name: '',
    dir: '',
    files: [],
    fontName: '',
    fontSize: 0,
    screen: { id: 0, width: 0, height: 0, depth: 0, overscan: 0, autoScroll: 0 },
    pendingText: '',
    pendingAddr: 0,
  }
}

/** REQPOS_POINTER through REQPOS_TOPLEFTSCR, and anything else is out of range */
const reqPos = (v: number): number => (v >= 0 && v <= 4 ? v : 0)

export function makeIntuiextendReqInstructions(rt: Runtime): Record<string, Instr> {
  const st = (): IeReqState => rt.intuiextend.req

  return {
    /**
     * Rt Lib Close --- routine 211 ($458a), CloseLibrary (-$19e).
     *
     * It clears workspace+$10 BEFORE the call (`$459e move.l #$0,(a0)` with
     * the base already in a1), so the group is shut off whether or not exec
     * does anything, and a second close is a no-op.
     */
    'rt lib close': () => {
      st().base = 0
    },

    /**
     * Rt Free Flist --- routine 218 ($46fe), rtFreeFileList (-$3c).
     *
     * Guarded twice: nothing happens without a library AND without a list.
     * `$4728 clr.l (a0)+ / $472a clr.w (a0)` clears the head at +$6f2 and the
     * count at +$6f6 together.
     *
     * `Rt Multifile Req` does NOT free the list it replaces, so two calls
     * without a `Rt Free Flist` between them lose the first list.
     */
    'rt free flist': () => {
      const s = st()
      if (s.base === 0 || s.files.length === 0) return
      s.files = []
    },
  }
}

export function makeIntuiextendReqFunctions(rt: Runtime): Record<string, Func> {
  const st = (): IeReqState => rt.intuiextend.req
  const i0 = (a: Value[], n: number): number => int(a[n] ?? VI(0)) | 0
  const s0 = (a: Value[], n: number): string => (a[n] === undefined ? '' : str(a[n]))

  /**
   * The tail routine 214 ($45c8) runs after every one of the three file
   * requesters: DIR$ into rtfi_Dir, TITLE$ as the title, rtFileRequestA, then
   * the directory copied back to +$670 and the file name's length recomputed
   * at +$602.
   *
   * The filename buffer at +$604 is an ARGUMENT to rtFileRequestA, so `Rt Dir
   * Req` and `Rt Multifile Req` hand it whatever the last call left there.
   * Only `Rt File Req` writes it first, from NAME$.
   */
  const fileSetup = (title: string, dir: string, pattern: string, file: string, flags: number, pos: number): FileReqSetup => ({
    title,
    okText: RT_TEXT.ok,
    // no tag list reaches rtFileRequestA, so RT_Underscore is absent and
    // `glob->underchar` stays 0: an underscore in a label is drawn, not eaten
    underscore: '',
    dir,
    pattern,
    file,
    flags,
    height: 0,
    hideInfo: false,
    reqPos: reqPos(pos),
  })

  /** what routine 214 copies out of the requester when it comes back */
  const fileDone = (ok: boolean, result: string, dir: string): void => {
    const s = st()
    s.dir = dir
    if (ok) s.name = result
  }

  /** the rtReqInfo three of these fill in, with no tag list behind it */
  const reqSetup = (mode: number, body: string, gadgets: string, title: string, flags: number): ReqSetup => ({
    mode,
    body,
    gadgets,
    title,
    flags,
    width: 0,
    underscore: '',
    defaultResponse: 1,
    min: RT_MININT,
    max: RT_MAXINT,
    minmax: false,
  })

  return {
    /**
     * =Rt Lib Open --- routine 209 ($44e8), OpenLibrary (-$228) with
     * `moveq #$0,d0`, so any version will do.
     *
     * DEFECT: `$44e8 moveq #$ff,d3` runs before the test, and the
     * already-open path at $4514 sets only d2. So the FIRST call answers the
     * library base, as Req7 promises ("Retourne l'adresse de la ReqTools"),
     * and every call after it answers -1.
     *
     * The name is at $4518, sixteen bytes of "reqtools.library" that the
     * disassembler reads as instructions because they sit in the code hunk.
     */
    'rt lib open': () => {
      const s = st()
      if (s.base !== 0) return VI(-1)
      s.base = IE_REQTOOLS_BASE
      return VI(IE_REQTOOLS_BASE | 0)
    },

    /**
     * =Rt File Req(TITLE$,DIR$,NAME$,MPAT$,POS) --- routine 210 ($452a).
     *
     *     $454a  move.l  #$10,$8(a2)     ; rtfi_Flags = FREQF_PATGAD
     *     $4552  movea.l $14(a2),a1      ; rtfi_MatchPat, MPAT$ copied in
     *     $4562  adda.w  #$604,a0        ; the name buffer, NAME$ copied in
     *
     * $10 is bit 4, FREQF_PATGAD, which is the pattern gadget the keyword's
     * MPAT$ argument needs. Req1's answer is rtFileRequestA's: 1 for Ok and 0
     * for Cancel.
     */
    'rt file req': (it, a) => {
      const s = st()
      if (rt.rtFile) {
        if (!rt.rtFile.done) {
          it.block({ type: 'rtreq' }, true)
          return VI(0)
        }
        const r = rt.rtFile
        rt.rtFile = null
        fileDone(r.ok, r.result, r.dir)
        return VI(r.ok ? 1 : 0)
      }
      if (s.base === 0) return VI(0)
      s.name = s0(a, 2)
      const setup = fileSetup(s0(a, 0), s0(a, 1), s0(a, 3), s.name, FREQF.PATGAD, i0(a, 4))
      if (!rt.startRtFileRequest(setup, null)) return VI(0)
      it.block({ type: 'rtreq' }, true)
      return VI(0)
    },

    /**
     * =Rt Dir Req(TITLE$,DIR$,POS) --- routine 215 ($463a).
     *
     * `$465a move.l #$8,$8(a2)` is FREQF_NOFILES, bit 3, which the doc calls
     * "Set this if you want to use the requester to allow the user to select
     * a directory rather than a file".
     */
    'rt dir req': (it, a) => {
      const s = st()
      if (rt.rtFile) {
        if (!rt.rtFile.done) {
          it.block({ type: 'rtreq' }, true)
          return VI(0)
        }
        const r = rt.rtFile
        rt.rtFile = null
        fileDone(r.ok, r.result, r.dir)
        return VI(r.ok ? 1 : 0)
      }
      if (s.base === 0) return VI(0)
      const setup = fileSetup(s0(a, 0), s0(a, 1), '', s.name, FREQF.NOFILES, i0(a, 2))
      if (!rt.startRtFileRequest(setup, null)) return VI(0)
      it.block({ type: 'rtreq' }, true)
      return VI(0)
    },

    /**
     * =Rt Multifile Req(TITLE$,DIR$,POS) --- routine 216 ($466e).
     *
     * `$468e move.l #$1,$8(a2)` is FREQF_MULTISELECT and nothing else, so
     * FREQF_SELECTDIRS is off and the list holds files only.
     *
     * The count is walked rather than asked for: $46a8 to $46b2 follows
     * rtFileList.Next adding one each time, and `$46b4 move.w d3,$4(a1)`
     * stores it beside the head. Req8's ">0=Nombre de fichier selectionne".
     */
    'rt multifile req': (it, a) => {
      const s = st()
      if (rt.rtFile) {
        if (!rt.rtFile.done) {
          it.block({ type: 'rtreq' }, true)
          return VI(0)
        }
        const r = rt.rtFile
        rt.rtFile = null
        fileDone(r.ok, r.result, r.dir)
        s.files = r.ok ? r.list.map((e) => e.name) : []
        return VI(s.files.length | 0)
      }
      if (s.base === 0) return VI(0)
      const setup = fileSetup(s0(a, 0), s0(a, 1), '', s.name, FREQF.MULTISELECT, i0(a, 2))
      if (!rt.startRtFileRequest(setup, null)) return VI(0)
      it.block({ type: 'rtreq' }, true)
      return VI(0)
    },

    /** =Rt Get Name$ --- routine 212 ($45ac), workspace+$602 with d2 of 2 */
    'rt get name$': () => VS(st().name),

    /** =Rt Get Dir$ --- routine 213 ($45ba), workspace+$670 */
    'rt get dir$': () => VS(st().dir),

    /**
     * =Rt Get Flist$(F_NB) --- routine 217 ($46be), one-based.
     *
     *     $46ce  tst.w   d0        ; and `bls` sends 0 and below to the exit
     *     $46d2  cmp.w   $4(a2),d0 ; and `bgt` sends anything past the count
     *
     * so it is checked at both ends and an out-of-range number answers the
     * empty string.
     *
     * A note rather than a defect: `$46e0 move.l $4(a2),d7` takes the length
     * from rtFileList.StrLen, which the header says is "-1 for directories".
     * Routine 143 would then round -1 up to a two-byte allocation and store
     * $ffff as the AMOS length. It cannot happen here, because a directory
     * only reaches the list under FREQF_SELECTDIRS and routine 216 sets
     * FREQF_MULTISELECT alone.
     */
    'rt get flist$': (_, a) => {
      const s = st()
      const n = i0(a, 0)
      if (n <= 0 || n > s.files.length) return VS('')
      return VS(s.files[n - 1] ?? '')
    },

    /**
     * =Rt Text Req(TEXT$,BOUT$,TITLE$,FLAG,POS) --- routine 219 ($4730),
     * rtEZRequestA (-$42).
     *
     * The three strings are handed over as `adda.w #$2,a0` past their length
     * words, so they reach the library as the AMOS text with whatever follows
     * it. a4 is cleared at $476e, which is rtEZRequestA's argarray:
     *
     * DEFECT: TEXT$ is `bodyfmt` and there are no format arguments behind it.
     * `reqtools.doc`:273 is "You may also include printf() style formatting
     * codes", so a `%` in the text formats from an empty array. The port
     * prints the body as it stands, which is what a text without a `%` in it
     * does anyway.
     *
     * Req9's answer is rtEZRequestA's: 0 for the rightmost gadget, then 1
     * upwards from the left.
     */
    'rt text req': (it, a) => {
      const s = st()
      if (rt.rtReq) {
        if (!rt.rtReq.done) {
          it.block({ type: 'rtreq' }, true)
          return VI(0)
        }
        const r = rt.rtReq
        rt.rtReq = null
        return VI(r.result | 0)
      }
      if (s.base === 0) return VI(0)
      const setup = reqSetup(REQ_MODE.EZREQUEST, s0(a, 0), s0(a, 1), s0(a, 2), i0(a, 3))
      const args = { setup, buffer: '', maxLen: 0, value: 0, showDefault: true, allowEmpty: false, invisible: false }
      if (!rt.startRtRequest(args, null)) return VI(0)
      it.block({ type: 'rtreq' }, true)
      return VI(0)
    },

    /**
     * =Rt String Req(TITLE$,DEFAULTTEXT$,CARMAX,FLAG,POS) --- routine 220
     * ($4790), rtGetStringA (-$48).
     *
     * CARMAX is rtGetStringA's `maxchars` in d0 AND the size routine 143
     * allocates for the buffer, so the two cannot disagree.
     *
     * The result is read out of the BUFFER and not out of d0: $47f4 to $47fc
     * counts the buffer to its NUL and writes that length back over the AMOS
     * string's own. rtGetStringA's TRUE/FALSE is dropped on the floor. So a
     * cancelled requester hands back DEFAULTTEXT$, and nothing distinguishes
     * that from the user pressing Ok without typing.
     */
    'rt string req': (it, a) => {
      const s = st()
      if (rt.rtReq) {
        if (!rt.rtReq.done) {
          it.block({ type: 'rtreq' }, true)
          return VI(0)
        }
        const r = rt.rtReq
        rt.rtReq = null
        return VS(r.result !== 0 ? r.text : s.pendingText)
      }
      if (s.base === 0) return VS('')
      const max = i0(a, 2)
      s.pendingText = s0(a, 1)
      const setup = reqSetup(REQ_MODE.ENTER_STRING, '', '', s0(a, 0), i0(a, 3))
      const args = {
        setup,
        buffer: s.pendingText,
        maxLen: max,
        value: 0,
        showDefault: true,
        allowEmpty: false,
        invisible: false,
      }
      if (!rt.startRtRequest(args, null)) return VS(s.pendingText)
      it.block({ type: 'rtreq' }, true)
      return VS('')
    },

    /**
     * =Rt Number Req(TITLE$,VAL_ADR) --- routine 224 ($4846), rtGetLongA
     * (-$4e) with a1 straight off the argument stack.
     *
     * VAL_ADR is a real address the program owns --- ReqA's own examples are
     * `Varptr(VAL)` and `Start(10)` --- so the answer is written back through
     * it and the return value is only the button. "'longvar' will NOT change
     * if the requester is aborted", `reqtools.doc`:1136, so a cancel leaves
     * the program's long alone.
     *
     * ReqA has the return backwards: it says 0 for Ok and 1 for Cancel, and
     * `reqtools.doc`:1130 says "ret - TRUE if user entered a number, FALSE if
     * not." Routine 224 copies d0 to d3 untouched.
     */
    'rt number req': (it, a) => {
      const s = st()
      if (rt.rtReq) {
        if (!rt.rtReq.done) {
          it.block({ type: 'rtreq' }, true)
          return VI(0)
        }
        const r = rt.rtReq
        rt.rtReq = null
        if (r.result !== 0 && s.pendingAddr !== 0) ieMem(rt).setLong(s.pendingAddr, r.value)
        return VI(r.result | 0)
      }
      if (s.base === 0) return VI(0)
      s.pendingAddr = i0(a, 1) >>> 0
      const setup = reqSetup(REQ_MODE.ENTER_NUMBER, '', '', s0(a, 0), 0)
      const args = {
        setup,
        buffer: '',
        maxLen: 0,
        value: s.pendingAddr === 0 ? 0 : ieMem(rt).long(s.pendingAddr) | 0,
        showDefault: true,
        allowEmpty: false,
        invisible: false,
      }
      if (!rt.startRtRequest(args, null)) return VI(0)
      it.block({ type: 'rtreq' }, true)
      return VI(0)
    },

    /**
     * =Rt Palette Req(TITLE$,FLAG,POS) --- routine 225 ($4886),
     * rtPaletteRequestA (-$66).
     *
     * DEFECT: POS is popped into a0 at $48a4 and overwritten by FLAG at
     * $48a6, and a0 is the tag list. So the position argument does nothing
     * and the flag argument is dereferenced as a TagItem array. Only ReqE's
     * documented FLAG of 0 is safe. The port ignores a non-zero one.
     *
     * ReqE's "COUL=No de la couleur selectionnee" is rtPaletteRequestA's own
     * answer, and it is -1 for a cancel.
     */
    'rt palette req': (it, a) => {
      const s = st()
      if (rt.rtPalette) {
        if (!rt.rtPalette.done) {
          it.block({ type: 'rtreq' }, true)
          return VI(0)
        }
        const r = rt.rtPalette
        rt.rtPalette = null
        return VI(r.result | 0)
      }
      if (s.base === 0) return VI(0)
      const setup: PaletteReqSetup = {
        title: s0(a, 0),
        // `glob->color = 1` before the tags are read, and there is no
        // RTPA_Color in a tag list that is only ever FLAG
        color: 1,
        depth: 0,
        bits: [4, 4, 4],
      }
      if (!rt.startRtPaletteRequest(setup, null)) return VI(0)
      it.block({ type: 'rtreq' }, true)
      return VI(0)
    },

    /**
     * =Rt Font Req(TITLE$,FLAG,POS) --- routine 226 ($48d0), rtFontRequestA
     * (-$60).
     *
     * DEFECT: the worst of the three, because BOTH arguments land elsewhere.
     * `$48fc move.l d6,$8(a1)` puts POS in rtfo_Flags, which is RTFO_Flags
     * and not a position, and FLAG stays in a0 as the tag list. rtfo_ReqPos
     * is never written and stays at the 0 rtAllocRequestA cleared it to,
     * which is REQPOS_POINTER.
     *
     * On the way back `$490e tst.b d0` tests the low byte only, then either
     * clears the name at +$6fa or copies rtfo_Attr: `$491e move.w $14(a0),
     * $40(a2)` is ta_YSize to +$73c and `$4924 movea.l $10(a0),a0` is ta_Name
     * to +$6fc. So a cancel EMPTIES `Rt Get Font Name` and leaves
     * `Rt Get Font Size` at whatever the last accepted request left.
     */
    'rt font req': (it, a) => {
      const s = st()
      if (rt.rtFont) {
        if (!rt.rtFont.done) {
          it.block({ type: 'rtreq' }, true)
          return VI(0)
        }
        const r = rt.rtFont
        rt.rtFont = null
        if (!r.ok) s.fontName = ''
        else {
          s.fontName = r.result
          s.fontSize = r.resultSize & 0xffff
        }
        return VI(r.ok ? 1 : 0)
      }
      if (s.base === 0) return VI(0)
      const setup: FontReqSetup = {
        title: s0(a, 0),
        okText: RT_TEXT.ok,
        underscore: '',
        // POS, because $48fc writes it here; RTFO_Flags and nothing else
        flags: i0(a, 2),
        height: 0,
        sampleHeight: 24,
        minSize: 5,
        maxSize: 24,
      }
      if (!rt.startRtFontRequest(setup, s.fontName, s.fontSize, null)) return VI(0)
      it.block({ type: 'rtreq' }, true)
      return VI(0)
    },

    /**
     * =Rt Screen Mode Req(TITLE$,FLAG,POS) --- routine 227 ($494c),
     * rtScreenModeRequestA (-$90).
     *
     * POS and FLAG go the same way as `Rt Palette Req`: $496a pops POS into
     * a0 and $496c overwrites it with FLAG, which stays there as the tag
     * list. DEFECT at both.
     *
     * The six fields are copied out only when the low byte of d0 is set, and
     * they go to workspace+$75c in the order the six "get" keywords read
     * them: `$498c move.l $10(a1),$0(a2)` is DisplayID, then DisplayWidth
     * ($14), DisplayHeight ($16), DisplayDepth ($34), OverscanType ($36) and
     * AutoScroll ($38).
     *
     * With no RTSC_Flags there are no size or depth gadgets, so the width and
     * height are the mode's default for its overscan and the depth is the
     * deepest the mode opens in --- `reqtools.doc`:1723 and :1727.
     */
    'rt screen mode req': (it, a) => {
      const s = st()
      if (rt.rtScreen) {
        if (!rt.rtScreen.done) {
          it.block({ type: 'rtreq' }, true)
          return VI(0)
        }
        const r = rt.rtScreen
        rt.rtScreen = null
        if (r.ok) {
          s.screen = {
            id: r.modeId | 0,
            width: r.width & 0xffff,
            height: r.height & 0xffff,
            depth: r.depth & 0xffff,
            // never written: routine 227 sets no RTSC_Flags, so the requester
            // carries neither gadget and reqtools leaves both fields alone
            overscan: 0,
            autoScroll: 0,
          }
        }
        return VI(r.ok ? 1 : 0)
      }
      if (s.base === 0) return VI(0)
      const setup: ScreenReqSetup = {
        title: s0(a, 0),
        okText: RT_TEXT.ok,
        underscore: '',
        flags: 0,
        height: 0,
      }
      const prev = { displayId: s.screen.id, width: s.screen.width, height: s.screen.height, depth: s.screen.depth }
      if (!rt.startRtScreenRequest(setup, prev, null)) return VI(0)
      it.block({ type: 'rtreq' }, true)
      return VI(0)
    },

    /** =Rt Get Font Name --- routine 158 ($3b50), workspace+$6fa */
    'rt get font name': () => VS(st().fontName),

    /** =Rt Get Font Size --- routine 142 ($394c), the word at workspace+$73c */
    'rt get font size': () => VI(st().fontSize & 0xffff),

    /**
     * =Rt Get Display Id --- routine 297 ($5656), the long at workspace+$75c.
     *
     * The only one of the six with no node in Request.guide, and the only one
     * that names the mode rather than measuring it.
     */
    'rt get display id': () => VI(st().screen.id | 0),

    /** =Rt Get Display Width --- routine 298 ($5666), the word at +$760 */
    'rt get display width': () => VI(st().screen.width & 0xffff),

    /** =Rt Get Display Height --- routine 299 ($5678), the word at +$762 */
    'rt get display height': () => VI(st().screen.height & 0xffff),

    /** =Rt Get Display Depth --- routine 300 ($568a), the word at +$764 */
    'rt get display depth': () => VI(st().screen.depth & 0xffff),

    /**
     * =Rt Get Overscan Type --- routine 301 ($569c), the word at +$766.
     *
     * ReqG links this as "Rt Get Display Overscantype", which the table does
     * not hold and which will not parse. See the header for why the answer is
     * always 0.
     */
    'rt get overscan type': () => VI(st().screen.overscan & 0xffff),

    /**
     * =Rt Get Autoscroll --- routine 302 ($56ae), the long at +$768.
     *
     * ReqG links this as "Rt Get Display Autoscroll", which is the same
     * mistake, and the answer is always 0 for the same reason.
     */
    'rt get autoscroll': () => VI(st().screen.autoScroll | 0),
  }
}
