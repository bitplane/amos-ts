/**
 * Make Lib 1.30 — thirty-two keywords at slot 17.
 *
 * An anonymous author's answer to a complaint stated in the first line of his
 * own documentation: *"my opinion is that AMOSPro is missing usable memory
 * allocation routines and it doesn't have any routines to handle lists and
 * nodes at all"*. So the library is exec — `AllocMem`, `AllocVec`, a `malloc`
 * with its own free-all, and eight of exec's list routines — plus a C-shaped
 * `stdio` over `dos.library`, and three graphics keywords that have nothing to
 * do with either.
 *
 * ## Evidence
 *
 * BINARY tier with a complete manual. `AMOSPro_Make.lib` is a 2,344-byte code
 * hunk with 38 jump-table entries, 32 of which are keywords; `extdis make-1.30`
 * disassembles it, and at this size every routine fits on a screen. Beside it
 * ships `Make_lib.doc`, which documents all thirty-two — usage, inputs and
 * outputs for each — so the two can be read against each other throughout, and
 * every place they disagree is recorded below.
 *
 * The slot is confirmed from both sides: routine 0 writes its data zone to
 * `$1f8(a5)`, which is `($1f8-$f8)/16+1 = 17`, and the doc says so in as many
 * words — *"The extension number of MakeLib is 17."*
 *
 * ## What routine 0 sets up, and what routine 0 tears down
 *
 * The data zone is forty bytes inside the code hunk. Routine 0 `NewList`s two
 * `MinList`s in it, opens `dos.library`, and takes one 1,024-byte MEMF_CLEAR
 * block to build C strings and FileInfoBlocks in:
 *
 *     +$00  MinList   every block `Ma Malloc` has handed out
 *     +$10  MinList   every file `Ma Fopen` has opened
 *     +$20  APTR      the 1,024-byte scratch buffer
 *     +$24  APTR      DOSBase
 *
 * It then installs a cleanup routine at `$200(a5)` — the extension slot's
 * REMOVE vector — which walks the file list closing and freeing, closes
 * dos.library, frees the buffer, and walks the malloc list freeing. That is
 * what the doc means by *"when you quit AMOSPro or Compiled program Make Lib
 * automatically frees all memory allocated with malloc"*.
 *
 * Both lists live at real addresses here, in an extension data block, because
 * the whole point of the library is that a program threads its OWN nodes
 * through them: the doc's worked example allocates a 10-byte node, pokes two
 * bytes into it past the 8-byte `MinNode`, and hands it to `Ma AddHead`. So
 * the list routines are the memory operations exec performs and nothing more,
 * and a program that corrupts a link sees exactly what it would have seen.
 *
 * The pool behind `Ma Malloc` is `MemPool` from ../amiga/exec.ts — the same
 * first-fit `AllocMem` SLN uses, which is what it was promoted out of sln.ts
 * for. `Ma Malloc`'s twelve-byte header (`MinNode` + size) is written into the
 * front of the block exactly as the 68k writes it, so `Leek(ptr-4)` answers
 * with the size the library stored, and `Ma Free`'s `lea -$c(a1),a1` finds the
 * node where the Amiga finds it.
 *
 * ## Where the binary and the manual disagree
 *
 * Four places, and the binary wins in all four:
 *
 * - **`Ma Fopen`'s third mode is not "a".** The routine uppercases the first
 *   character and tests it against 'W' and 'R'; ANY other character takes the
 *   append arm. `Ma Fopen(f$,"x")` appends, and so does `Ma Fopen(f$,"")`.
 * - **`Ma Fread`, `Ma Fwrite` and `Ma Fseek` return their LAST ARGUMENT when
 *   the file handle is zero** — see each keyword.
 * - **`Ma Point` and `Ma Plot` do not work "exactly as AMOSPro's".** They walk
 *   `EcCurrent` and ignore the clip window and the ink; see `ma point`.
 * - **`Ma Realloc(0,n)` returns whatever the last function returned.** The
 *   null arm branches to the exit without writing d3.
 *
 * ## The dead half of the jump table
 *
 * Two entries sit past the last keyword. Routine 36 is `L_ErrorExt` with
 * `d3 = 0` and the string *"Out of memory!"*; routine 37 is the same call with
 * `d3 = -1` and *"AMOSPro Make's Lib 1.30"*, which is the extension's identity
 * banner. NOTHING IN THE LIBRARY CALLS EITHER: every allocation failure here is
 * reported by returning 0, which is what the doc promises throughout (*"ptr =
 * pointer to memory block or 0 if not enough memory"*). `MAKE_ERRORS` records
 * the message because the table is the extension's, but no keyword can raise
 * it and none is written to.
 */
import type { Runtime } from './runtime'
import type { Func, Instr } from '../interp/builtins'
import { AmosError, VI, int, str } from '../interp/values'
import { MEMF, MemPool } from '../amiga/exec'

/**
 * The extension's error table, as routine 36 spells it.
 *
 * One entry, and unreachable — see the header. Declared because the table
 * belongs to the identity rather than to whichever keyword happens to raise
 * from it, and because a port that exports one and does not declare it is the
 * silent wrong answer `extimpl.test.ts` exists to catch.
 */
export const MAKE_ERRORS = ['Out of memory!']

/**
 * Where `Ma Malloc`'s pool is mapped, matching `Runtime.MAKE_HEAP_BASE` and
 * `MAKE_HEAP_RESERVED`. Spelled out rather than imported because `./runtime`
 * is a TYPE-only import here; `memmap.test.ts` holds the two to agreeing.
 */
const HEAP_BASE = 0x4c00_0000
const HEAP_RESERVED = 0x0400_0000

/** the data zone's own layout, off the base routine 0 writes to `$1f8(a5)` */
const MALLOC_LIST = 0x00
const FILE_LIST = 0x10
const ZONE_SIZE = 0x30

/** `Ma Malloc`'s header: `MinNode` (8) plus the size it stores at +8 */
const MALLOC_HEADER = 12
/** `Ma AllocVec`'s header: the size, and nothing else */
const VEC_HEADER = 4

/**
 * One file `Ma Fopen` has open.
 *
 * The whole file is held rather than streamed, as LDos's channels are and for
 * the same reason: `Ma Fseek` may go anywhere in it and `Ma Fwrite` may land
 * in the middle.
 */
export interface MakeFile {
  /** what `Ma Fopen` handed back and `Ma Fclose` matches on */
  handle: number
  path: string
  data: Uint8Array
  /** the read/write cursor, always from the start of the file */
  pos: number
}

export interface MakeState {
  /** `AllocMem`, for every keyword here that takes memory */
  pool: MemPool
  /** the forty-byte data zone; both MinLists are in it */
  zone: Uint8Array
  /** where the zone is mapped, or 0 until the first keyword asks */
  base: number
  /** open files by handle — the file list holds the same set, by address */
  files: Map<number, MakeFile>
  /** the next synthetic handle; see `newHandle` */
  nextHandle: number
}

export const newMakeState = (): MakeState => ({
  pool: new MemPool(HEAP_BASE, HEAP_RESERVED),
  zone: new Uint8Array(ZONE_SIZE),
  base: 0,
  files: new Map(),
  nextHandle: 0,
})

/* ---- reading and writing the modelled address space ------------------- */

const peek8 = (rt: Runtime, a: number): number => {
  const m = rt.resolveAddr(a >>> 0)
  return m ? (m.data[m.off] ?? 0) : 0
}

const poke8 = (rt: Runtime, a: number, v: number): void => {
  const m = rt.resolveWrite(a >>> 0)
  if (m) m.data[m.off] = v & 0xff
}

const peek32 = (rt: Runtime, a: number): number =>
  ((peek8(rt, a) << 24) | (peek8(rt, a + 1) << 16) | (peek8(rt, a + 2) << 8) | peek8(rt, a + 3)) >>> 0

const poke32 = (rt: Runtime, a: number, v: number): void => {
  poke8(rt, a, v >>> 24)
  poke8(rt, a + 1, v >>> 16)
  poke8(rt, a + 2, v >>> 8)
  poke8(rt, a + 3, v)
}

/**
 * The data zone's address, initialising it the way routine 0 does on the first
 * ask.
 *
 * Lazy rather than done in `init` because the address comes from the Runtime's
 * own block registry and the two `NewList`s write absolute pointers into the
 * zone, so there is nothing to write until the block has a base. Routine 0
 * runs when the library loads and this runs when the first keyword does; no
 * keyword can observe the difference, because reaching the zone at all means
 * calling one.
 */
function zoneBase(rt: Runtime): number {
  const st = rt.make
  if (st.base === 0) {
    st.base = rt.extBlockBase('make', st.zone)
    newList(rt, st.base + MALLOC_LIST)
    newList(rt, st.base + FILE_LIST)
  }
  return st.base
}

const mallocList = (rt: Runtime): number => zoneBase(rt) + MALLOC_LIST
const fileList = (rt: Runtime): number => zoneBase(rt) + FILE_LIST

/* ---- exec's list routines, as memory operations ----------------------- */

/**
 * NEWLIST, which routine 6 open-codes rather than calling:
 *
 *     move.l a0,(a0) / addq.l #$4,(a0) / clr.l $4(a0) / move.l a0,$8(a0)
 *
 * i.e. head = &tail, tail = 0, tailpred = &head — the empty `MinList` every
 * exec list starts as, and the shape `Ma First` and `Ma Last` test against.
 */
function newList(rt: Runtime, list: number): void {
  poke32(rt, list, (list + 4) >>> 0)
  poke32(rt, list + 4, 0)
  poke32(rt, list + 8, list >>> 0)
}

/** exec `AddHead(a0=list, a1=node)` */
function addHead(rt: Runtime, list: number, node: number): void {
  const head = peek32(rt, list)
  poke32(rt, node, head)
  poke32(rt, node + 4, list)
  poke32(rt, head + 4, node)
  poke32(rt, list, node)
}

/** exec `AddTail(a0=list, a1=node)` */
function addTail(rt: Runtime, list: number, node: number): void {
  const tailpred = peek32(rt, list + 8)
  poke32(rt, node, (list + 4) >>> 0)
  poke32(rt, node + 4, tailpred)
  poke32(rt, tailpred, node)
  poke32(rt, list + 8, node)
}

/** exec `Remove(a1=node)` — unlinks it, and does not care whose list it is on */
function removeNode(rt: Runtime, node: number): void {
  const succ = peek32(rt, node)
  const pred = peek32(rt, node + 4)
  poke32(rt, pred, succ)
  poke32(rt, succ + 4, pred)
}

/** exec `RemHead(a0=list)` — the first node, or 0 when the list is empty */
function remHead(rt: Runtime, list: number): number {
  const node = peek32(rt, list)
  const succ = peek32(rt, node)
  if (succ === 0) return 0
  poke32(rt, list, succ)
  poke32(rt, succ + 4, list)
  return node
}

/* ---- helpers the keywords share --------------------------------------- */

/** `move.l (a3)+,d1` then `jsr AllocMem` — the requirement bits, honoured */
const allocOpts = (req: number): { clear: boolean; chip: boolean } => ({
  clear: (req & MEMF.CLEAR) !== 0,
  chip: (req & MEMF.CHIP) !== 0,
})

/** an unsigned 32-bit compare, for the `bcc`/`bls` arms */
const below = (a: number, b: number): boolean => (a >>> 0) < (b >>> 0)

/**
 * A file handle.
 *
 * On the Amiga this is a BPTR to a `FileHandle`, and the only thing a program
 * may do with it is hand it back — `Ma Fclose` compares it for equality
 * against what it stored, and nothing here or in the doc dereferences one. So
 * it is synthetic and deliberately un-dereferenceable, on the same reasoning
 * as the library bases in ../amiga/exec.ts: high, obviously not an address,
 * and recognisable in a bug report. Longword-aligned because a BPTR is.
 */
const HANDLE_ORIGIN = 0x7f20_0000
const newHandle = (st: MakeState): number => (HANDLE_ORIGIN + st.nextHandle++ * 4) >>> 0

/** the open file a handle names, or null — an unknown handle is not modelled */
const fileOf = (rt: Runtime, handle: number): MakeFile | null =>
  rt.make.files.get(handle >>> 0) ?? null

/**
 * Put the file back. AmigaDOS buffers a write inside the handler and this does
 * not: there is no second process to flush for, and a program that writes and
 * then asks `Ma Filelen` — which goes round the handle, through `Lock` and
 * `Examine` — would otherwise see a length that no longer exists anywhere.
 *
 * DEVIATION: so a write is on disk the moment it is made, where the Amiga's is
 * on disk at the next buffer boundary or at `Close`.
 */
function flush(rt: Runtime, f: MakeFile): void {
  rt.vfs?.writeFile(f.path, f.data)
}

/* ---- the graphics three ----------------------------------------------- */

/**
 * Where this port maps the icon bank's 68k image, matching
 * `Runtime.ICON_BANK_BASE`. Spelled out for the same reason the heap base is:
 * `./runtime` is a TYPE-only import here, and `Ma Paste Icon` needs to turn
 * the record pointers in that image back into offsets within it.
 */
const ICON_BANK_BASE = 0x6800_0000

/**
 * The screen the three graphics keywords draw on.
 *
 * All three load `$52c(a5)` — the current screen's control block — and take
 * the plane pointers from `$30(a2)`, which is `EcCurrent`, not `EcLogic` at
 * +0. On a single-buffered screen the two name the same bitmap; on a
 * double-buffered one `EcCurrent` is the PHYSICAL bitmap, which is what
 * `planarView('phy')` answers with here.
 */
const planes = (rt: Runtime, write: boolean): Uint8Array =>
  rt.screen.planarView('phy', write)

/**
 * The row stride the routines compute, which is not the one AMOS stores.
 *
 * `move.w $4c(a2),d3 / lsr.w #$3,d3` derives it from EcTx, the screen's pixel
 * width, rather than reading EcTLigne at +178. For every screen AMOS can open
 * the two agree, because a bitmap's width is rounded up to a word; the
 * arithmetic is kept as the routine spells it anyway, since that is what a
 * screen whose width is not a multiple of 16 would follow.
 */
const strideOf = (rt: Runtime): number => (rt.screen.width >> 3) & 0xffff

export function makeMakeInstructions(rt: Runtime): Record<string, Instr> {
  return {
    /**
     * Routine 5 — `Ma Freemem PTR,SIZE`.
     *
     * `move.l (a3)+,d0` is the size and `movea.l (a3)+,a1` the pointer, popped
     * right to left as every argument here is. A null pointer is checked and
     * skipped; the size goes straight through to exec, where this pool takes
     * the length from its own bookkeeping instead — so a caller that hands
     * back the right block with the wrong size is forgiven here and would
     * corrupt the memory list on the machine. See `MemPool.freeMem`.
     */
    'ma freemem'(it) {
      const ptr = it.evalInt() >>> 0
      it.expect(',')
      it.evalInt() // the size, which the pool does not need
      if (ptr !== 0) rt.make.pool.freeMem(ptr)
    },

    /** Routine 6 — `Ma Newlist LIST`, the four instructions above */
    'ma newlist'(it) {
      newList(rt, it.evalInt() >>> 0)
    },

    /** Routine 7 — `Ma Addhead LIST,NODE`, straight to exec's AddHead */
    'ma addhead'(it) {
      const list = it.evalInt() >>> 0
      it.expect(',')
      addHead(rt, list, it.evalInt() >>> 0)
    },

    /**
     * Routine 8 — `Ma Remove NODE`.
     *
     * exec's `Remove` takes the node alone and never sees the list, which is
     * why the doc's parameter list has only one entry. A node that was never
     * on a list unlinks whatever its two pointers happen to name.
     */
    'ma remove'(it) {
      removeNode(rt, it.evalInt() >>> 0)
    },

    /** Routine 9 — `Ma Addtail LIST,NODE` */
    'ma addtail'(it) {
      const list = it.evalInt() >>> 0
      it.expect(',')
      addTail(rt, list, it.evalInt() >>> 0)
    },

    /**
     * Routine 12 — `Ma Freevec PTR`.
     *
     *     movea.l (a3)+,a1 / move.l a1,d0 / beq / move.l -(a1),d0 / FreeMem
     *
     * The pre-decrement is the whole trick the doc advertises: `Ma Allocvec`
     * stored the total size in the longword in front of the pointer it
     * returned, so the size the caller does not have to remember is four bytes
     * behind the block.
     */
    'ma freevec'(it) {
      const ptr = it.evalInt() >>> 0
      if (ptr === 0) return
      rt.make.pool.freeMem((ptr - VEC_HEADER) >>> 0)
    },

    /**
     * Routine 14 — `Ma Free PTR`.
     *
     *     lea -$c(a1),a1 / Remove / FreeMem(a1, $8(a1))
     *
     * The twelve bytes in front of the pointer are `MinNode` plus the size, so
     * the block comes off the malloc list before it goes back to exec. A
     * pointer that did not come from `Ma Malloc` unlinks whatever the eight
     * bytes before it look like — there is no check, and none is possible.
     */
    'ma free'(it) {
      const ptr = it.evalInt() >>> 0
      if (ptr === 0) return
      const node = (ptr - MALLOC_HEADER) >>> 0
      removeNode(rt, node)
      rt.make.pool.freeMem(node)
    },

    /**
     * Routine 15 — `Ma Free All`.
     *
     * `RemHead` on the malloc list until it answers 0, freeing each node with
     * the size stored at +8. The doc's *"Very useful in cleanup code to free
     * all memory blocks with one command"*, and the same loop the extension's
     * REMOVE vector runs when AMOS unloads it.
     */
    'ma free all'() {
      const list = mallocList(rt)
      for (;;) {
        const node = remHead(rt, list)
        if (node === 0) break
        rt.make.pool.freeMem(node)
      }
    },

    /**
     * Routine 23 — `Ma Paste Icon X,Y,ICON`.
     *
     * A raw blitter copy, minterm $f0 (D = A) with both masks $ffffffff, from
     * the icon bank straight onto the screen. Popped right to left, so `d3` is
     * the icon, `d1` the y and `d2` the x.
     *
     *     Rjsr L_Bnk_GetIcons / beq error 74
     *     cmp.w (a0)+,d3 / bhi error      ; past the count
     *     subq.w #$1,d3  / bmi error      ; icon 0 or below
     *     lsl.l #$3,d3 / adda.l d3,a0 / movea.l (a0),a0
     *
     * Eight bytes an entry because an AMOS object bank's table is a record
     * pointer and a mask pointer per image; the record is `widthWords.w
     * height.w planes.w hotX.w hotY.w` and the planar data follows at +10.
     *
     * DEFECT: `move.w $50(a2),d4` is the SCREEN's plane count, and the icon's
     * own — at +4 of the record it just read — is never looked at. An icon with
     * fewer planes than the screen has its missing planes filled from whatever
     * follows it in the bank, which is the next icon's header and then the next
     * icon; a 1-plane icon on a 4-plane screen paints three planes of the
     * neighbouring images. The reverse is merely wasteful: the extra planes are
     * ignored.
     *
     * NOTE: `lsr.l #$4,d2` rounds x down to a 16-pixel boundary, which the doc
     * says outright (*"ma Paste Icon is word oriented"*). Nothing clips: y is
     * multiplied by the row stride unchecked and a negative coordinate becomes
     * an enormous unsigned offset, so an off-screen paste writes wherever the
     * arithmetic lands. Here it lands outside the plane buffer and is dropped.
     */
    'ma paste icon'(it) {
      const x = it.evalInt()
      it.expect(',')
      const y = it.evalInt()
      it.expect(',')
      const icon = it.evalInt()

      const bank = rt.objectBankImage('icons')
      if (!bank) throw new AmosError('Icon not defined', 74)
      const b16 = (o: number): number => ((bank[o] ?? 0) << 8) | (bank[o + 1] ?? 0)
      const b32 = (o: number): number => ((b16(o) << 16) | b16(o + 2)) >>> 0

      const count = b16(0)
      // cmp.w/bhi and subq.w/bmi are WORD tests on a longword argument
      if ((icon & 0xffff) > count) throw new AmosError('Icon not defined', 74)
      const index = ((icon & 0xffff) - 1) & 0xffff
      if (index & 0x8000) throw new AmosError('Icon not defined', 74)
      const rec = (b32(2 + index * 8) - ICON_BANK_BASE) >>> 0

      const widthWords = b16(rec)
      const height = b16(rec + 2)
      const src = rec + 10
      const iconBytes = (widthWords * 2) & 0xffff
      // `mulu.w d0,d7` — the plane stride, and what `adda.l d7,a0` steps by
      const planeStride = ((height & 0xffff) * iconBytes) >>> 0

      const s = rt.screen
      const stride = strideOf(rt)
      const dest = ((y & 0xffff) * stride + (x >>> 4) * 2) >>> 0
      const buf = planes(rt, true)
      for (let p = 0; p < s.depth; p++) {
        let from = src + p * planeStride
        let to = p * s.planeSize + dest
        for (let row = 0; row < height; row++) {
          for (let i = 0; i < iconBytes; i++) {
            if (to + i < buf.length) buf[to + i] = bank[from + i] ?? 0
          }
          from += iconBytes
          to += stride
        }
      }
    },

    /**
     * Routine 25 — `Ma Plot X,Y,COLOUR`.
     *
     * The same address arithmetic `Ma Point` does, then one `bset`/`bclr` per
     * plane off the colour's bits, low bit first:
     *
     *     btst.l d2,d7 / beq / bset.b d0,(a0) / bra / bclr.b d0,(a0)
     *     lsr.w d5,d7 / dbra d4
     *
     * `d2` is zero and stays zero, so the test is always of bit 0 and the shift
     * is what walks the colour — the two spellings are the same loop.
     *
     * An out-of-range coordinate returns silently, with no error and nothing
     * drawn: `bls`/`bcc` to a bare `rts`. See `ma point` for what the bounds
     * are and what they are not.
     */
    'ma plot'(it) {
      const x = it.evalInt()
      it.expect(',')
      const y = it.evalInt()
      it.expect(',')
      let colour = it.evalInt() & 0xffff

      const s = rt.screen
      if (!below(x & 0xffff, s.width & 0xffff)) return
      if (!below(y & 0xffff, s.height & 0xffff)) return
      const off = (y & 0xffff) * strideOf(rt) + ((x & 0xffff) >> 3)
      const bit = (x & 7) ^ 7
      const buf = planes(rt, true)
      for (let p = 0; p < s.depth; p++) {
        const at = p * s.planeSize + off
        if (at < buf.length) {
          const was = buf[at]!
          buf[at] = colour & 1 ? was | (1 << bit) : was & ~(1 << bit) & 0xff
        }
        colour >>= 1
      }
    },

    /**
     * Routine 31 — `Ma Fclose FILE`.
     *
     * Declared as an INSTRUCTION although the doc spells it `Ma Fclose (FILE)`;
     * AMOS parses the parentheses either way. It walks the file list looking
     * for the node whose +8 holds this handle, and a handle that is not on the
     * list — one already closed, or never opened — falls off the end of the
     * walk and closes nothing at all.
     */
    'ma fclose'(it) {
      const handle = it.evalInt() >>> 0
      if (handle === 0) return
      const list = fileList(rt)
      for (let node = peek32(rt, list); peek32(rt, node) !== 0; node = peek32(rt, node)) {
        if (peek32(rt, node + 8) !== handle) continue
        const f = fileOf(rt, handle)
        if (f) {
          flush(rt, f)
          rt.make.files.delete(handle)
        }
        removeNode(rt, node)
        rt.make.pool.freeMem(node)
        return
      }
    },
  }
}

export function makeMakeFunctions(rt: Runtime): Record<string, Func> {
  return {
    /**
     * Routine 4 — `=Ma Allocmem(SIZE,REQUIREMENTS)`.
     *
     * exec's `AllocMem` with nothing around it: `move.l (a3)+,d1` is the
     * requirement word and `move.l (a3)+,d0` the size, in exec's own register
     * order. The doc's bit table is exec's — `$1` public, `$2` chip, `$4` fast,
     * `$10000` clear — and `Mem Public`/`Mem Chip`/`Mem Fast`/`Mem Clear`
     * further down are those four constants spelled as keywords.
     */
    'ma allocmem': (_it, a) =>
      VI(rt.make.pool.alloc(int(a[0]!), allocOpts(int(a[1]!)))),

    /**
     * Routine 10 — `=Ma Remhead(LIST)`, exec's `RemHead`: the first node off
     * the list, or 0 when it is empty.
     */
    'ma remhead': (_it, a) => VI(remHead(rt, int(a[0]!) >>> 0)),

    /**
     * Routine 11 — `=Ma Allocvec(SIZE,REQUIREMENTS)`.
     *
     *     addq.l #$4,d0 / move.l d0,d2 / AllocMem
     *     movea.l d0,a0 / move.l d2,(a0)+ / move.l a0,d3
     *
     * Four bytes more than asked for, the TOTAL written into them, and the
     * pointer handed back past them — so `Ma Freevec` can find the size by
     * stepping back one longword. The doc's *"You have no need to store it
     * anywhere"*.
     *
     * NOTE the stored size includes the header, so a program that reads it
     * back sees four more than it asked for.
     */
    'ma allocvec': (_it, a) => {
      const total = int(a[0]!) + VEC_HEADER
      const block = rt.make.pool.alloc(total, allocOpts(int(a[1]!)))
      if (block === 0) return VI(0)
      poke32(rt, block, total)
      return VI((block + VEC_HEADER) >>> 0)
    },

    /**
     * Routine 13 — `=Ma Malloc(SIZE,REQUIREMENTS)`.
     *
     *     addq.l #$8,d0 / addq.l #$4,d0      ; MinNode, then the size
     *     AllocMem / movea.l $1f8(a5),a0
     *     move.l d2,$8(a1) / lea $c(a1),a2 / AddHead / move.l a2,d3
     *
     * Twelve bytes more than asked for: an eight-byte `MinNode` so the block
     * can go on the library's own list, and the total size at +8 so `Ma Free`
     * and the cleanup vector can hand it back. The pointer returned is the
     * block plus twelve.
     *
     * The header is written AFTER the allocation, so `Mem Clear` clears it and
     * then the size goes in — which is why `Leek(ptr-4)` is the size on a
     * cleared block just as on an uncleared one.
     */
    'ma malloc': (_it, a) => {
      const total = int(a[0]!) + MALLOC_HEADER
      const block = rt.make.pool.alloc(total, allocOpts(int(a[1]!)))
      if (block === 0) return VI(0)
      poke32(rt, block + 8, total)
      addHead(rt, mallocList(rt), block)
      return VI((block + MALLOC_HEADER) >>> 0)
    },

    /**
     * Routine 16 — `=Ma Next(NODE)`.
     *
     *     movea.l (a0),a0 / tst.l (a0) / beq / move.l a0,d3
     *
     * The successor, unless the successor's own successor is zero — which is
     * only true of the list header's `lh_Tail`, so the last node answers 0.
     * That is exec's idiom for "walk until the tail sentinel" and it is what
     * makes `Ma Next` safe to loop on without the list in hand.
     */
    'ma next': (_it, a) => {
      const succ = peek32(rt, int(a[0]!) >>> 0)
      return VI(peek32(rt, succ) === 0 ? 0 : succ)
    },

    /**
     * Routine 17 — `=Ma Prev(NODE)`, the mirror: the predecessor unless its own
     * predecessor is zero, which is only true of `lh_Head`'s pred slot.
     */
    'ma prev': (_it, a) => {
      const pred = peek32(rt, (int(a[0]!) + 4) >>> 0)
      return VI(peek32(rt, pred + 4) === 0 ? 0 : pred)
    },

    /**
     * Routine 18 — `=Ma First(LIST)`.
     *
     *     cmpa.l $8(a0),a0 / beq / move.l (a0),d3
     *
     * An empty `MinList` has `tailpred == &head`, so comparing the list's
     * address against its own tailpred is exec's emptiness test. Non-empty, the
     * head pointer IS the first node.
     */
    'ma first': (_it, a) => {
      const list = int(a[0]!) >>> 0
      return VI(peek32(rt, list + 8) === list ? 0 : peek32(rt, list))
    },

    /** Routine 19 — `=Ma Last(LIST)`, the same test and the tailpred instead */
    'ma last': (_it, a) => {
      const list = int(a[0]!) >>> 0
      return VI(peek32(rt, list + 8) === list ? 0 : peek32(rt, list + 8))
    },

    /**
     * Routine 20 — `=Ma Filelen(NAME$)`.
     *
     *     Lock(name, 0) / beq -1
     *     Examine(lock, fib) / UnLock(lock) / move.l $7c(a0),d3
     *
     * `fib_Size` at +124 of the FileInfoBlock the scratch buffer holds. An
     * empty name and a failed Lock both answer -1, which the doc gives (*"or -1
     * if no file present"*); a DIRECTORY locks and examines fine and its
     * fib_Size is zero, so a directory answers 0 rather than -1.
     *
     * NOTE the lock mode is `moveq #$0,d2`, which is neither `SHARED_LOCK`
     * (-2) nor `EXCLUSIVE_LOCK` (-1). A filesystem takes anything that is not
     * exclusive as shared, so it works, but it is not a mode either dos.library
     * header defines.
     *
     * NOTE `Examine`'s result is discarded — `jsr` and no `tst` — so a lock
     * that examines badly would report whatever was in the buffer at +124. It
     * cannot happen for a lock that succeeded.
     */
    'ma filelen': (_it, a) => {
      const name = str(a[0]!)
      if (name.length === 0) return VI(-1)
      const kind = rt.vfs?.exists(name) ?? null
      if (kind === null) return VI(-1)
      if (kind === 'dir') return VI(0)
      return VI(rt.vfs?.readFile(name)?.length ?? -1)
    },

    /**
     * Routine 21 — `=Ma Extb(VALUE)`: `ext.w d3 / ext.l d3`, a byte widened
     * through a word to a signed longword. The doc's use is `Ma Extb(Peek(p))`,
     * because AMOS's own `Peek` is unsigned.
     */
    'ma extb': (_it, a) => VI((int(a[0]!) << 24) >> 24),

    /** Routine 22 — `=Ma Extw(VALUE)`: `ext.l d3` alone, for `Deek` */
    'ma extw': (_it, a) => VI((int(a[0]!) << 16) >> 16),

    /**
     * Routine 24 — `=Ma Point(X,Y)`.
     *
     *     move.w $4c(a2),d5 / cmp.w d0,d5 / bls  -> -1
     *     cmp.w $4e(a2),d1  / bcc         -> -1
     *     lsr.w #3,d5 / mulu.w d5,d1 / add.w x>>3
     *     and.b #7,d0 / eor.b #7,d0 / btst d0,(a0)
     *
     * Both bounds are UNSIGNED word compares, so a negative coordinate is a
     * large one and answers -1 rather than reading backwards — which is the
     * only clipping either graphics keyword has.
     *
     * The doc says *"ma Point works exactly as AMOSPro's Point function"*, and
     * it does not, twice over. AMOS's `Point` respects the current screen's
     * clip window; this reads the whole bitmap. And AMOS's reads `EcLogic`
     * where this reads `EcCurrent` ($30), so on a double-buffered screen the
     * two answer about different bitmaps. Same distinction TURBO's `Turbo Text`
     * carries in the other direction — see turbo.ts.
     */
    'ma point': (_it, a) => {
      const x = int(a[0]!)
      const y = int(a[1]!)
      const s = rt.screen
      if (!below(x & 0xffff, s.width & 0xffff)) return VI(-1)
      if (!below(y & 0xffff, s.height & 0xffff)) return VI(-1)
      const off = (y & 0xffff) * strideOf(rt) + ((x & 0xffff) >> 3)
      const bit = (x & 7) ^ 7
      const buf = planes(rt, false)
      let colour = 0
      for (let p = 0; p < s.depth; p++) {
        const at = p * s.planeSize + off
        if (at < buf.length && ((buf[at]! >> bit) & 1) !== 0) colour |= 1 << p
      }
      return VI(colour)
    },

    /**
     * Routines 26-29 — `=Mem Chip`, `=Mem Fast`, `=Mem Clear`, `=Mem Public`.
     *
     * Four `moveq`s. They exist so a program can write `Ma Malloc(100,Mem Fast
     * + Mem Clear)` instead of `$10004`, which is the doc's whole example for
     * all four.
     */
    'mem chip': () => VI(MEMF.CHIP),
    'mem fast': () => VI(MEMF.FAST),
    'mem clear': () => VI(MEMF.CLEAR),
    'mem public': () => VI(MEMF.PUBLIC),

    /**
     * Routine 30 — `=Ma Fopen(NAME$,MODE$)`.
     *
     *     movea.l (a3)+,a1 / addq.l #$2,a1 / move.b (a1),d3 / bclr.b #$5,d3
     *
     * The mode is ONE character, taken past the AMOS string's length word and
     * uppercased by clearing bit 5. Then:
     *
     *     cmpi.b #$57,d3 -> MODE_NEWFILE ($3ee)      ; 'W'
     *     cmpi.b #$52,d3 -> MODE_OLDFILE ($3ed)      ; 'R'
     *     otherwise: Open(MODE_OLDFILE); if it worked, Seek(0, OFFSET_END);
     *                if it did not, Open(MODE_NEWFILE)
     *
     * DEFECT: the third arm is not "a", it is EVERY OTHER CHARACTER, which is
     * only a defect against the doc — the routine does what it does perfectly
     * well. The doc lists three modes and the routine tests
     * two, so `Ma Fopen(f$,"append")` and `Ma Fopen(f$,"q")` both append, and
     * so does an empty mode string — which reads the byte after the length word
     * of a zero-length AMOS string, whatever that is.
     *
     * On success it takes a twelve-byte MEMF_CLEAR node, stores the handle at
     * +8 and puts it on the file list; if THAT fails the file is closed again
     * and the call answers 0. The value returned is the dos.library handle
     * itself, not the node.
     */
    'ma fopen': (_it, a) => {
      const st = rt.make
      const name = str(a[0]!)
      const raw = (a[1] !== undefined ? str(a[1]) : '').charCodeAt(0)
      // `bclr #$5` on a character that was never a letter is still what happens
      const m = Number.isNaN(raw) ? 0 : raw & ~0x20
      if (name.length === 0) return VI(0)

      let data: Uint8Array
      let pos = 0
      if (m === 0x52 /* 'R' — MODE_OLDFILE, and no creating */) {
        const had = rt.vfs?.readFile(name) ?? null
        if (had === null) return VI(0)
        data = had
      } else {
        // 'W' truncates; every other character opens old and seeks to the end,
        // falling back to creating one. Both arms leave a file on disk.
        const had = m === 0x57 ? null : (rt.vfs?.readFile(name) ?? null)
        data = had ?? new Uint8Array(0)
        pos = had ? had.length : 0
        if (rt.vfs?.writeFile(name, data) !== true) return VI(0)
      }

      const node = st.pool.alloc(MALLOC_HEADER, { clear: true })
      if (node === 0) return VI(0)
      const handle = newHandle(st)
      poke32(rt, node + 8, handle)
      addHead(rt, fileList(rt), node)
      st.files.set(handle, { handle, path: name, data, pos })
      return VI(handle)
    },

    /**
     * Routine 33 — `=Ma Fread(FILE,BUFFER,LEN)`.
     *
     *     move.l (a3)+,d3 / move.l (a3)+,d2 / move.l (a3)+,d1 / beq
     *     Read(d1,d2,d3) / move.l d0,d3
     *
     * DEFECT: the null-handle arm branches PAST `move.l d0,d3`, so d3 is still
     * the length that was popped into it and the call reports that it read
     * exactly as many bytes as were asked for. `Ma Fread(0,buf,100)` answers
     * 100 with nothing read, and a program checking the count for short reads
     * cannot tell that from success.
     */
    'ma fread': (_it, a) => {
      const handle = int(a[0]!) >>> 0
      const buffer = int(a[1]!) >>> 0
      const len = int(a[2]!)
      if (handle === 0) return VI(len)
      const f = fileOf(rt, handle)
      if (!f) return VI(-1)
      const n = Math.max(0, Math.min(len, f.data.length - f.pos))
      for (let i = 0; i < n; i++) poke8(rt, buffer + i, f.data[f.pos + i]!)
      f.pos += n
      return VI(n)
    },

    /**
     * Routine 32 — `=Ma Fwrite(FILE,BUFFER,LEN)`, the same shape and the same
     * defect: a null handle answers LEN, so a write that never happened reports
     * that every byte went out.
     */
    'ma fwrite': (_it, a) => {
      const handle = int(a[0]!) >>> 0
      const buffer = int(a[1]!) >>> 0
      const len = int(a[2]!)
      if (handle === 0) return VI(len)
      const f = fileOf(rt, handle)
      if (!f) return VI(-1)
      if (len <= 0) return VI(0)
      if (f.pos + len > f.data.length) {
        const grown = new Uint8Array(f.pos + len)
        grown.set(f.data)
        f.data = grown
      }
      for (let i = 0; i < len; i++) f.data[f.pos + i] = peek8(rt, buffer + i)
      f.pos += len
      flush(rt, f)
      return VI(len)
    },

    /**
     * Routine 34 — `=Ma Fseek(FILE,POSITION,MODE)`.
     *
     * dos.library `Seek`, argument for argument: mode -1 from the start, 0 from
     * the current position, 1 from the end, and the OLD position comes back.
     * The doc's own trick falls out of that — two `Ma Fseek(f,0,1)` in a row
     * give the length, because the second one's "old position" is the end.
     *
     * DEFECT: the null-handle arm is the third of the same kind, and here what
     * comes back is the MODE, since that is the last argument popped. `Ma
     * Fseek(0,x,1)` answers 1, which is indistinguishable from a successful
     * seek that started at byte one.
     *
     * A seek past either end fails and answers -1 with the position unmoved,
     * which is what dos.library does and what the doc's examples assume.
     */
    'ma fseek': (_it, a) => {
      const handle = int(a[0]!) >>> 0
      const position = int(a[1]!)
      const mode = int(a[2]!)
      if (handle === 0) return VI(mode)
      const f = fileOf(rt, handle)
      if (!f) return VI(-1)
      const from = mode < 0 ? 0 : mode === 0 ? f.pos : f.data.length
      const want = from + position
      if (want < 0 || want > f.data.length) return VI(-1)
      const old = f.pos
      f.pos = want
      return VI(old)
    },

    /**
     * Routine 35 — `=Ma Realloc(OLDPTR,NEWSIZE)`.
     *
     *     Remove(node) / TypeOfMem(node) / addi.l #$10000,d1 / AllocMem
     *     move.l d2,$8(a4) / copy min(new,old) - $c bytes / AddHead / FreeMem
     *
     * Everything the doc promises, and it is all in those six calls. The new
     * block asks for the old block's own attributes with MEMF_CLEAR added,
     * which is both *"if old memory was CHIP memory --> new memory will be CHIP
     * too"* and *"additional bytes will be cleared"*. The copy is the smaller
     * of the two totals less the header. And the old block is freed on BOTH
     * paths, because the failure arm falls into the same `FreeMem` — *"If
     * there's not enough memory ... old memory block will be deleted and NULL
     * will be returned"*.
     *
     * DEFECT: `movea.l (a3)+,a1 / move.l a1,d0 / beq $8d0` jumps to the exit
     * without writing d3, so `Ma Realloc(0,n)` returns whatever the previous
     * function call left in the return register. Nothing here has a stale d3 to
     * hand back, so this answers 0 — the only stable choice, and the value the
     * register holds after any of the allocators that just failed.
     */
    'ma realloc': (_it, a) => {
      const old = int(a[0]!) >>> 0
      const total = int(a[1]!) + MALLOC_HEADER
      if (old === 0) return VI(0)

      const st = rt.make
      const node = (old - MALLOC_HEADER) >>> 0
      removeNode(rt, node)
      const oldTotal = peek32(rt, node + 8)
      const block = st.pool.alloc(total, { clear: true, chip: st.pool.chip(node) })
      if (block === 0) {
        st.pool.freeMem(node)
        return VI(0)
      }
      poke32(rt, block + 8, total)
      const copy = Math.max(0, Math.min(total, oldTotal) - MALLOC_HEADER)
      for (let i = 0; i < copy; i++) {
        poke8(rt, block + MALLOC_HEADER + i, peek8(rt, old + i))
      }
      addHead(rt, mallocList(rt), block)
      st.pool.freeMem(node)
      return VI((block + MALLOC_HEADER) >>> 0)
    },
  }
}
