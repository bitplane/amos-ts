/**
 * BUtility 1.21, slot 12 --- Mariusz Rycyk's freeware wrapper round three
 * third-party libraries, disassembled with `extdis butility-1.21` and checked
 * against `BUtility.doc`, which gives every signature with a worked example.
 *
 * EVIDENCE: binary only. There is no source, so every reading here is the
 * disassembly's; the doc is used to name arguments and never to decide
 * behaviour. Where the two disagree the binary wins, and the disagreement is
 * written down.
 *
 * Routine 0 ($162) is the whole design in fifty instructions. It parks a
 * static data zone --- $226 in the hunk itself, not an allocation --- at
 * `$1a8(a5)`, which is slot 12 by the usual arithmetic (($1a8-$f8)/16+1), and
 * confirms it by returning `moveq #$b,d0` = 11 = ExtNb. Then three
 * `OpenLibrary` calls whose results are the extension's entire state:
 *
 *     +$00  xpkmaster.library v4     +$0c  rtAllocRequestA(RT_FILEREQ)
 *     +$04  reqtools.library v38     +$10  AllocAslRequest(ASL_FileRequest)
 *     +$08  asl.library v37
 *
 * Any that fails stores 0, and every keyword tests its own before doing
 * anything --- which is why the error list leads with three "not opened"
 * messages. `src/amiga/exec.ts` models all three (the comment on its MODELLED
 * map names this extension), so those five arms are unreachable here, exactly
 * as EasyLife's "Could Not Open XPK Master Library" is unreachable for the
 * same reason. They are still spelled out, because a keyword that cannot
 * report a missing library is not the same keyword.
 *
 * THE THREE LIBRARIES all have back ends here now:
 *
 * - `Bfilereq`, `Binforeq`, `Bgetlongreq` and `Bgetstrreq` go to
 *   ../amiga/reqtools.ts, the real one. Every tag list is read out of
 *   BUtility.Lib: `80000003 00000002` is RT_ReqPos = REQPOS_CENTERSCR on all
 *   four, `8000000b 0000005f` is RT_Underscore = `_` on Binforeq alone, and
 *   `80000016 00000004` is RTEZ_Flags = EZREQF_CENTERTEXT on the three text
 *   ones. They used to go through AMOS's own selector and the Interface
 *   dialog engine, which is what `Lfreq` still does for req.library.
 * - `Baslfilereq` goes to ../amiga/asl.ts, and always did.
 * - the three XPK keywords need nothing: `src/amiga/xpkmaster.ts` is a real
 *   port of the packer, and EasyLife already drives it.
 *
 * A NOTE ON THE DATA ZONE, because two pairs of keywords share one buffer and
 * a program can see it. `Breqfile$` and `Baslfile$` both answer the string at
 * data+$16, and `Baslfile$` COPIES the asl requester's name into it before
 * reading --- so calling `Baslfile$` changes what `Breqfile$` says. The same
 * holds for `Breqdir$` and `Basldir$` at data+$118. reqtools and asl are not
 * separate namespaces in this extension; whichever ran last wins.
 */
import type { Runtime } from './runtime'
import type { Func, Instr } from '../interp/builtins'
import type { Value } from '../interp/values'
import { AmosError, VI, VS, int, str } from '../interp/values'
import { XpkError, xpkErrorText, xpkPack, xpkUnpack } from '../amiga/xpkmaster'
import { EZREQF, REQ_MODE, REQPOS, RT_MAXINT, RT_MININT, RT_TEXT, FREQF, type FileReqSetup, type ReqSetup } from '../amiga/reqtools'
import type { RtReqArgs } from './rtreq'

/**
 * Routines 16-21 are `moveq #n,d0 / Rbra routine 22`, so the index IS the
 * position in this list and the six strings sit consecutively in the hunk.
 */
export const BUTILITY_ERRORS = [
  'Xpkmaster library V4+ not opened',
  'Reqtools library V38+ not opened',
  'Asl library V37+ not opened',
  'Reqtools file requester not allocated',
  'Asl file requester not allocated',
  'Incorrect max string length',
]

const buError = (n: number): never => {
  throw new AmosError(BUTILITY_ERRORS[n] ?? `BUtility error ${n}`)
}

/** the string buffer at data+$274 ends where the EZRequest tag list begins */
export const BU_STRING_MAX = 255

export interface BUtilityState {
  /** data+$16 --- read by BOTH Breqfile$ and Baslfile$ */
  file: string
  /** the reqtools requester's Dir field, which Bfilereqchg also writes */
  reqDir: string
  /** its MatchPat field (RTFI_Dir/RTFI_MatchPat, tags base+50 and base+51) */
  reqPattern: string
  /** the asl requester's fr_File ($4) and fr_Drawer ($8) */
  aslFile: string
  aslDrawer: string
  /** data+$26a --- the last XpkPack/XpkUnpack result, read by Bxpkerror$ */
  xpkError: number
  /** data+$26e --- the long rtGetLong edits in place, read by Bgetlong */
  long: number
  /** data+$274 --- the string rtGetString edits in place, read by Bgetstr$ */
  str: string
}

export const newBUtilityState = (): BUtilityState => ({
  file: '',
  reqDir: '',
  reqPattern: '',
  aslFile: '',
  aslDrawer: '',
  xpkError: 0,
  long: 0,
  str: '',
})

/**
 * `cmpi.b #$3a,-2(a0)` then `cmpi.b #$2f,-2(a0)`: a drawer gets a trailing
 * slash unless it already ends in one or is a bare volume. Both dir readers
 * do this, byte for byte the same code.
 */
function withSlash(dir: string): string {
  if (dir === '') return ''
  const last = dir[dir.length - 1]!
  return last === ':' || last === '/' ? dir : dir + '/'
}

/**
 * Split a selector answer the way rtFileRequest hands its result back: the
 * NAME into the caller's buffer, the DIRECTORY into the requester's own Dir
 * field. The doc's demo depends on the split --- it reassembles the path as
 * `KAT$+PLIK$` from `Breqdir$` and `Breqfile$`.
 */
function splitPath(r: string): { dir: string; name: string } {
  const cut = Math.max(r.lastIndexOf('/'), r.lastIndexOf(':'))
  if (cut < 0) return { dir: '', name: r }
  const name = r.slice(cut + 1)
  // the separator stays on a volume ("DH0:") and comes off a drawer, which is
  // the state the '/'-appending readers above expect to be given
  const dir = r[cut] === ':' ? r.slice(0, cut + 1) : r.slice(0, cut)
  return { dir, name }
}

/** read a file for the XPK keywords; a missing one is an I/O error, not a raise */
function readFile(rt: Runtime, path: string): Uint8Array | null {
  const raw = rt.fs?.read(path)
  return raw ? Uint8Array.from(raw) : null
}

/**
 * The shared tail of Bxpkpack and Bxpkunpack: `move.l d0,$26a(a0)` stores the
 * result whether or not it is zero, and d3 is -1 for success, 0 for failure.
 * XPKERR_IOERRIN (-3) is what a file that will not open reports.
 */
function xpkRun(rt: Runtime, fn: () => Uint8Array, out: string): Value {
  const st = rt.butility
  try {
    const packed = fn()
    if (!rt.vfs?.writeFile(out, packed)) {
      st.xpkError = -4 // XPKERR_IOERROUT
      return VI(0)
    }
    st.xpkError = 0
    return VI(-1)
  } catch (e) {
    st.xpkError = e instanceof XpkError ? e.code : -3
    return VI(0)
  }
}

/**
 * Open one of the three text requesters and block the statement on it.
 *
 * `it.block(..., true)` re-runs the whole statement, so the arguments are
 * evaluated a second time; nothing here may depend on a side effect of the
 * first pass that the second would repeat wrongly. False means the requester
 * did not open, which is the cancel answer every one of the three gives.
 */
function startBuReq(rt: Runtime, it: Parameters<Func>[0], args: RtReqArgs): boolean {
  if (!rt.startRtRequest(args, null)) return false
  it.block({ type: 'rtreq' }, true)
  return true
}

/**
 * The EZRequest `Binforeq` builds, and the tag list at data+$374 that shapes
 * it: `8000000b 0000005f` is RT_Underscore = `_`, `80000003 00000002` is
 * RT_ReqPos = REQPOS_CENTERSCR, `80000014` is RTEZ_ReqTitle and `80000016
 * 00000004` is RTEZ_Flags = EZREQF_CENTERTEXT.
 *
 * The title tag is always PRESENT, so an empty title$ passes a pointer to a
 * NUL rather than NULL and the title bar comes up blank; reqtools' own
 * `Request` and `Information` defaults are only reached by leaving the tag
 * out, which this extension never does.
 */
function ezSetup(body: string, gadgets: string, title: string): RtReqArgs {
  const setup: ReqSetup = {
    mode: REQ_MODE.EZREQUEST,
    body,
    gadgets,
    title,
    flags: EZREQF.CENTERTEXT,
    width: 0,
    underscore: '_',
    defaultResponse: 1,
    min: RT_MININT,
    max: RT_MAXINT,
    minmax: false,
  }
  return { setup, buffer: '', maxLen: 0, value: 0, showDefault: true, allowEmpty: false, invisible: false }
}

/**
 * The three tags routine 5 does NOT fill in, read out of the template at file
 * offset `0x64e` in `BUtility.Lib`.
 *
 * ASL_FuncFlags 1 is FILF_PATGAD, V37's "put a pattern gadget on it", which
 * is why the second argument has anywhere to go.
 */
const BASL_WIDTH = 100
const BASL_HEIGHT = 220
const BASL_FUNCFLAGS = 1

export function makeBUtilityInstructions(rt: Runtime): Record<string, Instr> {
  return {
    /**
     * Bfilereqchg Pattern$, Dir$ --- routine 6 ($8be), rtChangeReqAttrA on
     * the file requester with two tags: base+51 takes the pattern and base+50
     * the directory (the value slots at data+$3b8 and data+$3b0, filled right
     * to left as always). Nothing is displayed; it sets what the NEXT
     * `Bfilereq` opens on, and `Breqdir$` can read the new directory back
     * straight away because it reads the requester rather than a result.
     */
    'bfilereqchg'(it) {
      const pattern = it.evalStr()
      it.expect(',')
      const dir = it.evalStr()
      const st = rt.butility
      st.reqPattern = pattern
      st.reqDir = dir
    },
  }
}

export function makeBUtilityFunctions(rt: Runtime): Record<string, Func> {
  return {
    /**
     * =Bxpkunpack("infile" To "outfile","password") --- routine 1 ($6ea).
     * Three tags at data+$470: XPK_InName, XPK_OutName and the password,
     * then `jsr -$30(a6)` = XpkUnpack. An EMPTY password becomes a NULL tag
     * value rather than a pointer to nothing (`tst.w d0 / bne / suba.l a0,a0`),
     * which is how the doc's own `Bxpkunpack(... ,"")` asks for no password.
     */
    'bxpkunpack'(_, a) {
      const [inf, outf, pw] = [str(a[0]!), str(a[1]!), str(a[2]!)]
      const data = readFile(rt, inf)
      if (!data) {
        rt.butility.xpkError = -3 // XPKERR_IOERRIN
        return VI(0)
      }
      return xpkRun(rt, () => xpkUnpack(data, pw === '' ? undefined : pw), outf)
    },

    /**
     * =Bxpkpack("infile" To "outfile","method","password") --- routine 2
     * ($746). The same shape with one more tag, and it is the METHOD that
     * goes NULL when empty, not the password: the `tst.w d0` guard is on the
     * last argument popped, and the tag it fills is the one the unpack list
     * also carries. An empty method leaves xpkmaster to pick its default.
     */
    'bxpkpack'(_, a) {
      const [inf, outf, method, pw] = [str(a[0]!), str(a[1]!), str(a[2]!), str(a[3]!)]
      const data = readFile(rt, inf)
      if (!data) {
        rt.butility.xpkError = -3
        return VI(0)
      }
      return xpkRun(rt, () => xpkPack(data, method === '' ? 'NONE' : method, pw === '' ? undefined : pw), outf)
    },

    /**
     * =Bxpkerror$ --- routine 3 ($7ae). XpkFault of the stored error into an
     * 80-byte buffer at data+$21a (`moveq #$50,d1`), then a strlen and the
     * AMOS length word written at data+$218, one word in FRONT of the text.
     * Error 0 is not special-cased, so a call after a success gives whatever
     * XpkFault says for zero.
     */
    'bxpkerror$': () => VS(xpkErrorText(rt.butility.xpkError)),

    /**
     * =Bfilereq("Title","Default file") --- routine 4 ($7f6).
     *
     * `$806 lea.l $16(a2),a2` and the byte loop after it copy the default
     * into the shared file buffer BEFORE the call, because rtFileRequestA
     * edits that buffer in place --- a2 is the buffer itself at `$842 jsr
     * -$36(a6)`, and a3 is the title. Two guards come first: `$818 move.l
     * $4(a0),d6 / Rbeq routine 17` is "Reqtools library V38+ not opened" and
     * `$820 move.l $c(a0),d1 / Rbeq routine 19` is "Reqtools file requester
     * not allocated".
     *
     * The tag list at data+$398 is `80000003 00000002 80000028 00000010`:
     * RT_ReqPos = REQPOS_CENTERSCR and RTFI_Flags = FREQF_PATGAD, which is
     * the pattern gadget `Bfilereqchg` exists to fill in.
     *
     * A Cancel returns FALSE without going near the buffer --- `case CANCEL:`
     * in `filereqmain.c`:1341 is `FreeAllCheckBuffer / return (FALSE)` and
     * `LeaveReq` never runs --- so `Breqfile$` still answers the default that
     * was copied in. The DIRECTORY is not like that: `filereqmain.c`:136 sets
     * `fdir = freq->dirname` and the requester navigates by writing straight
     * into the requester's own buffer, so a cancelled requester still moves
     * what `Breqdir$` reads.
     */
    'bfilereq'(it, a) {
      const st = rt.butility
      if (rt.rtFile) {
        if (!rt.rtFile.done) {
          it.block({ type: 'rtreq' }, true)
          return VI(0)
        }
        const f = rt.rtFile
        rt.rtFile = null
        st.reqDir = f.dir
        st.reqPattern = f.pattern
        if (!f.ok) return VI(0)
        st.file = f.result
        return VI(-1)
      }
      const title = str(a[0]!)
      // the copy into data+$16 is unconditional and comes first
      st.file = str(a[1]!)
      const setup: FileReqSetup = {
        title,
        okText: RT_TEXT.ok,
        underscore: '_',
        dir: st.reqDir,
        pattern: st.reqPattern,
        file: st.file,
        flags: FREQF.PATGAD,
        height: 0,
        hideInfo: false,
        reqPos: REQPOS.CENTERSCR,
      }
      if (!rt.startRtFileRequest(setup, null)) return VI(0)
      it.block({ type: 'rtreq' }, true)
      return VI(0)
    },

    /**
     * =Baslfilereq("Title","Pattern","Default dir","Default file") --- routine
     * 5 ($856). Four tag values at data+$424/$42c/$434/$43c, filled right to
     * left, so they land on ASL_File, ASL_Dir, the pattern tag (ASL_TagBase+10)
     * and ASL_Hail in the doc's own order. The window is asked for 100x220
     * (ASL_Width/ASL_Height) and `jsr -$3c(a6)` is AslRequest.
     *
     * The tag TEMPLATE holds the other three, as constants at file offset
     * `0x64e`: ASL_Width 100, ASL_Height 220 and ASL_FuncFlags 1. Each of the
     * four strings is NUL-terminated IN PLACE before its pointer is stored
     * (`move.w (a1)+,d0 / clr.b (a1,d0.w)`), so this one does not carry
     * Int 1.0's `Wb Intuitext` overrun.
     *
     * This is a REAL asl.library requester now --- ../amiga/asl.ts, the one
     * Int 1.0's `Wb Asl Req` opens --- rather than AMOS's own selector
     * standing in for it, which is what `Bfilereq` beside it still does
     * because that one is reqtools and not asl. It writes the asl fields
     * rather than the reqtools ones, which the two pairs of readers then
     * share a buffer over.
     */
    'baslfilereq'(it, a) {
      const st = rt.butility
      if (rt.asl) {
        if (rt.asl.done) {
          const r = rt.asl.result
          rt.asl = null
          if (r === '') return VI(0)
          const { dir, name } = splitPath(r)
          st.aslFile = name
          st.aslDrawer = dir
          return VI(-1)
        }
        it.block({ type: 'asl' }, true)
        return VI(0)
      }
      const [title, pattern, dir, file] = [str(a[0]!), str(a[1]!), str(a[2]!), str(a[3]!)]
      st.aslDrawer = dir
      st.aslFile = file
      const started = rt.startAslRequest(
        {
          hail: title,
          okText: '',
          cancelText: '',
          left: 0,
          top: 0,
          width: BASL_WIDTH,
          height: BASL_HEIGHT,
          dir: dir === '' ? (rt.vfs?.currentDir ?? '') : dir,
          file,
          pattern,
          rejectIcons: false,
          doPatterns: (BASL_FUNCFLAGS & 1) !== 0,
        },
        null,
      )
      // `$10(a2)` empty is routine 20's error, and a requester that will not
      // open is the same outcome: 0, which is a cancel
      if (!started) return VI(0)
      it.block({ type: 'asl' }, true)
      return VI(0)
    },

    /**
     * =Breqfile$ --- routine 7 ($904). A strlen of the buffer at data+$16 and
     * nothing else: no library test, no requester test, so it answers even
     * before anything has been selected. NOTE: this is the buffer `Baslfile$`
     * writes, so the two are not independent.
     */
    'breqfile$': () => VS(rt.butility.file),

    /**
     * =Breqdir$ --- routine 8 ($926). Needs the reqtools file requester
     * (data+$c) or error 3, then copies its Dir field ($10) into the buffer
     * at data+$118 and appends a '/' unless it ends in ':' or '/'. An empty
     * Dir short-circuits with length 0 without touching the buffer.
     */
    'breqdir$': () => VS(withSlash(rt.butility.reqDir)),

    /**
     * =Baslfile$ --- routine 9 ($978). Needs the asl requester (data+$10) or
     * error 4, then copies fr_File ($4) into data+$16 --- the SAME buffer
     * Breqfile$ reads --- and answers it.
     */
    'baslfile$'() {
      const st = rt.butility
      // the copy is the point: it is what makes the two readers interfere
      if (st.aslFile !== '') st.file = st.aslFile
      return VS(st.aslFile)
    },

    /**
     * =Basldir$ --- routine 10 ($9b0). fr_Drawer ($8) into data+$118, the
     * same '/'-appending as Breqdir$, and the same shared buffer.
     */
    'basldir$': () => VS(withSlash(rt.butility.aslDrawer)),

    /**
     * =Binforeq("Main text","Gadgets","Title") --- routine 11 ($a02).
     *
     * rtEZRequestA with the body in a1, the gadget string in a2 and a tag
     * list at data+$374 carrying RT_Underscore = '_', RT_ReqPos =
     * REQPOS_CENTERSCR and RTEZ_ReqTitle = the title. The answer is `move.l
     * d0,d3` with no massaging at all, so it is reqtools' own numbering: the
     * leftmost gadget is 1, counting up, and the RIGHTMOST is 0. The doc's
     * `"_Yes|_No"` therefore reads as a boolean.
     *
     * NOTE: with a single gadget that rule makes the only gadget the
     * rightmost, so it answers 0. Nothing in BUtility decides this --- the
     * string goes straight to reqtools --- and no example in the doc reads
     * the result of a one-gadget call, so it is recorded rather than tested
     * against a demo.
     *
     * APPROXIMATED: an Interface dialog stands in for the reqtools requester,
     * with RTEZ_ReqTitle in its title bar.
     */
    'binforeq'(it, a) {
      if (rt.rtReq) {
        if (!rt.rtReq.done) {
          it.block({ type: 'rtreq' }, true)
          return VI(0)
        }
        const r = rt.rtReq
        rt.rtReq = null
        return VI(r.result)
      }
      // `$a0e move.l a1,$388(a0)` is RTEZ_ReqTitle's value slot; a1 and a2
      // are the body and the gadget string, in that order at `$a3c jsr
      // -$42(a6)`
      if (!startBuReq(rt, it, ezSetup(str(a[0]!), str(a[1]!), str(a[2]!)))) return VI(0)
      return VI(0)
    },

    /**
     * =Bgetlongreq("Title","Main text",Min,Max,Default) --- routine 12 ($a4a).
     *
     * The default goes into the long at data+$26e, which is both what
     * rtGetLong edits and what `Bgetlong` reads; Max and Min go to the tag
     * values at data+$3d4 and $3cc (base+31 and base+30) and the body text to
     * data+$3dc. Answers -1 when the user accepted and 0 when they cancelled
     * --- `tst.l d0 / beq / moveq #$ff,d3`.
     *
     * Because the long is edited IN PLACE, a cancel leaves the default there
     * and `Bgetlong` hands it back; nothing clears it.
     */
    'bgetlongreq'(it, a) {
      const st = rt.butility
      if (rt.rtReq) {
        if (!rt.rtReq.done) {
          it.block({ type: 'rtreq' }, true)
          return VI(0)
        }
        const r = rt.rtReq
        rt.rtReq = null
        // rtGetLongA edits the long at data+$26e in place, so a cancel leaves
        // the default there and `Bgetlong` hands it back
        st.long = r.value
        return VI(r.result !== 0 ? -1 : 0)
      }
      const [title, body] = [str(a[0]!), str(a[1]!)]
      const [min, max, def] = [int(a[2]!), int(a[3]!), int(a[4]!)]
      st.long = def
      const setup: ReqSetup = {
        mode: REQ_MODE.ENTER_NUMBER,
        body,
        gadgets: '',
        title,
        // `$62e` of the tag list at data+$3c0 is RTEZ_Flags = 4
        flags: EZREQF.CENTERTEXT,
        width: 0,
        underscore: '',
        defaultResponse: 1,
        min,
        max,
        minmax: true,
      }
      if (!startBuReq(rt, it, { setup, buffer: '', maxLen: 0, value: def, showDefault: true, allowEmpty: false, invisible: false })) {
        return VI(0)
      }
      return VI(0)
    },

    /** =Bgetlong --- routine 13 ($aa2), twelve bytes: the long at data+$26e. */
    'bgetlong': () => VI(rt.butility.long),

    /**
     * =Bgetstrreq("Title","Main text","Default text",Max chars) --- routine 14
     * ($aae).
     *
     * DEFECT: the order of operations. The default is copied into the buffer
     * at data+$274 by an UNBOUNDED byte loop, and the body text pointer is
     * stored, BEFORE `tst.l d0 / Rble` and `cmp.l #$100,d0 / Rbge` check the
     * length --- so an out-of-range Max chars raises error 5 with the copy
     * already done, and `Bgetstr$` answers the new default afterwards. The
     * buffer runs from data+$274 to data+$373, 256 bytes, ending exactly
     * where the EZRequest tag list begins: a default longer than that writes
     * over the tag list. Modelled to the extent a string can be --- the copy
     * happens first, the raise happens second --- but nothing here can be
     * overwritten by it.
     *
     * The legal range the checks leave is 1..255, which is what the doc says.
     */
    'bgetstrreq'(it, a) {
      const st = rt.butility
      if (rt.rtReq) {
        if (!rt.rtReq.done) {
          it.block({ type: 'rtreq' }, true)
          return VI(0)
        }
        const r = rt.rtReq
        rt.rtReq = null
        // rtGetStringA edits data+$274 in place, and a cancel leaves the
        // default sitting in it for `Bgetstr$`
        if (r.result !== 0) st.str = r.text
        return VI(r.result !== 0 ? -1 : 0)
      }
      const [title, body, def] = [str(a[0]!), str(a[1]!), str(a[2]!)]
      const maxLen = int(a[3]!)
      // the copy is unconditional and comes first --- see the DEFECT above
      st.str = def
      if (maxLen <= 0 || maxLen >= 0x100) buError(5)
      const setup: ReqSetup = {
        mode: REQ_MODE.ENTER_STRING,
        body,
        gadgets: '',
        title,
        flags: EZREQF.CENTERTEXT,
        width: 0,
        underscore: '',
        defaultResponse: 1,
        min: RT_MININT,
        max: RT_MAXINT,
        minmax: false,
      }
      if (!startBuReq(rt, it, { setup, buffer: def, maxLen, value: 0, showDefault: true, allowEmpty: false, invisible: false })) {
        return VI(0)
      }
      return VI(0)
    },

    /** =Bgetstr$ --- routine 15 ($b20): a strlen of the buffer at data+$274. */
    'bgetstr$': () => VS(rt.butility.str),
  }
}
