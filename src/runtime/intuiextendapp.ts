/**
 * IntuiExtend 2.01b, the AppWindow and icon group.
 *
 * Seven keywords over two libraries. Four go through workbench.library at
 * workspace+$8, opened by routine 51 ($2e88); three through icon.library at
 * workspace+$c, opened by routine 52 ($2eb6). Both names sit in the code hunk
 * as plain text, at file offsets $2ec4 and $2ef2, which is $2ea4 and $2ed2
 * once the $20 hunk header comes off, and those are the two `lea ...(pc),a1`
 * operands.
 *
 * ## The LVOs
 *
 * `wb_lib.fd` and `icon_lib.fd` under the GUI 2.10 sources, both bias 30:
 *
 *     -$3c  AddAppIconA(id,userdata,text,msgport,lock,diskobj,taglist)
 *                                            (d0/d1/a0/a1/a2/a3/a4)
 *     -$42  RemoveAppIcon(appIcon)(a0)
 *     -$5a  FreeDiskObject(diskobj)(a0)
 *     -$78  GetDefDiskObject(type)(d0)
 *
 * AMOS Professional's own `includes/lvo/icon_lib.i` is a second, independent
 * source for the icon pair: it gives FreeDiskObject as -90 and
 * GetDefDiskObject as -120, which are -$5a and -$78.
 *
 * ## Wb Get Wbicon calls a vector nobody documents
 *
 * DEFECT: routine 256 ($4cda) puts the filename in a0 and calls -$1e.
 * GetDiskObject(name)(a0), the entry with exactly that shape, is -$4e in both
 * files above; -$1e is `iconPrivate1`, and AMOS's icon_lib.i does not name it
 * at all, its list starting at -42.
 *
 * The vector is not empty. In the icon.library from the AMOS PD Library CD
 * (Library3.0/ICON.LIBRARY, 5,688 bytes) it is a C stub at $19a that pushes
 * a0 and calls a real function, and once every RELOC32 is applied that
 * function is at $5ec: it allocates a block, reads the named file into it,
 * copies eleven longs and eight fields into the block, and answers the block
 * or zero. Whatever it is, it is not GetDiskObject, whose body is at $d54 and
 * allocates $5e bytes. So the block `Wb Get Wbicon` hands back is not a
 * DiskObject, and `Wb Free Diskobject` cannot free it.
 *
 * ## And it unbalances the stack
 *
 * DEFECT: the save is inside the branch and the restore is not.
 *
 *     $4cf2  beq.b    $4cfe
 *     $4cf4  move.l   a6,-(a7)      ; only when the library IS open
 *     $4cf6  movea.l  (a2),a6
 *     $4cf8  jsr      -$1e(a6)
 *     $4cfc  move.l   d0,d3
 *     $4cfe  movea.l  (a7)+,a6      ; always
 *     $4d00  moveq    #$0,d2
 *     $4d02  rts
 *
 * With icon.library missing, `beq` lands on the pop, which takes the return
 * address into a6, and the `rts` two instructions later returns to whatever
 * was above it. The keyword does not fail on a machine without icon.library.
 * It leaves. This is the same in IntuiExtend 1.6, byte for byte.
 *
 * `Wb Get Wbicon` has no node in App.guide or in any other guide here. Only
 * Index.guide:317 carries the name.
 *
 * ## Wb Free Diskobject tests the wrong four bytes
 *
 * DEFECT: routine 250 ($4c06) guards with `movea.l (a3)+,a0 / tst.l (a0)`,
 * which reads the long AT the pointer rather than testing the pointer. A
 * DiskObject starts do_Magic and do_Version (`workbench.i`:56-57), which
 * WB_DISKMAGIC and WB_DISKVERSION at :69-70 make $e310 and 1, so
 * a real one passes; a zeroed block is refused. Passing 0 reads absolute $0,
 * which on an Amiga holds the initial supervisor stack pointer and is never
 * zero, so the guard passes and FreeDiskObject is called with NULL.
 *
 * ## App Create Icon's own documentation is a blank form
 *
 * App.guide's app0 node is `APPADR=App Create Icon(0,0,2)`, and under Entrée
 * it lists three arguments named 0, 0 and 2 with nothing after the equals
 * signs. Those are the token table's argument spec, `00,0,2`, copied into the
 * template and never replaced with names. The
 * disassembly supplies them: a3 gets the first argument (diskobj), a1 the
 * second (msgport), a0 the third with `addq.w #$2,a0` past the AMOS length
 * word (text), while d0, d1, a2 and a4 are all cleared, so the id, the user
 * data, the lock and the tag list are always zero.
 *
 * ## What this port answers
 *
 * DEVIATION: neither library is modelled. `../amiga/exec.ts`'s map carries
 * neither name, and `openLibrary` answers 0 for anything not in it, so
 * workspace+$8 and +$c stay zero and five of the seven keywords take their
 * own no-library arm. `../amiga/icon.ts` is the `.info` FILE FORMAT, which is
 * a different thing from icon.library, and there is no Workbench backdrop
 * here for an AppIcon to sit on. GameSupport's `Gsiconify` reached the same
 * wall on the same two libraries and made the same choice.
 *
 * That arm is a real machine's behaviour too. App.guide marks five of these
 * "System: v2.0+", and on 1.3 workbench.library does not exist.
 *
 * The two `App Get` keywords are not on that list, because neither touches a
 * library. They read fields of whatever message `Wb Get Msg` last parked at
 * workspace+$6e4, so they work here on any AppMessage a program builds and
 * sends to its own port.
 *
 * Documented against `IntuiExtend_2.0.Guide`'s App.guide, @Author CIERP
 * Philippe, nodes app0 to app5. The AppMessage offsets are OS-DevKit 1.61's
 * `os_wb.guide`:201-214, which lists am_NumArgs at $001e and am_ArgList at
 * $0022; WBArg is `includes/workbench/startup.i`:34-37, a BPTR and an APTR,
 * eight bytes.
 */
import type { Runtime } from './runtime'
import type { Func, Instr } from '../interp/builtins'
import { VI, VS, int, str, type Value } from '../interp/values'
import { ieMem } from './intuiextendwin'
import type { IntuiextendState } from './intuiextend'

/** `os_wb.guide`:205-206, the two AppMessage fields this group reads */
export const IE_AM = { NUMARGS: 0x1e, ARGLIST: 0x22 } as const

/** `startup.i`:34-37: a BPTR lock and an APTR name */
export const IE_WBARG_SIZE = 8

/** `workbench.i`:35-41, the seven `Wb Get Deficon` accepts */
export const IE_WBTYPE = {
  DISK: 1,
  DRAWER: 2,
  TOOL: 3,
  PROJECT: 4,
  GARBAGE: 5,
  DEVICE: 6,
  KICK: 7,
} as const

/** what a routine that opened with `moveq #$ff,d3` answers when it gives up */
const IE_APP_FAIL = -1

export function makeIntuiextendAppInstructions(_rt: Runtime): Record<string, Instr> {
  return {
    /**
     * Wb Free Diskobject DEFICON, routine 250 ($4c06). icon.library
     * FreeDiskObject at -$5a, behind two tests: the library base at
     * workspace+$c, then the four bytes at the pointer.
     *
     * app4 gives it as taking what app5 answers, "DEFICON=Adresse de la
     * structure IconObject", and it is the only one of the seven marked
     * "System: v1.3+" rather than v2.0.
     *
     * The library test comes first, so with icon.library absent the argument
     * is popped and nothing is read through it.
     */
    'wb free diskobject'(it) {
      it.evalInt()
    },

    /**
     * App Free Icon APPADR, routine 251 ($4c24). workbench.library
     * RemoveAppIcon at -$42, with the base tested first and the argument
     * passed straight through in a0.
     *
     * app1: "APPADR=Adresse de la structure AppIcon." Nothing checks it is
     * one, and nothing checks it is not zero either.
     */
    'app free icon'(it) {
      it.evalInt()
    },
  }
}

export function makeIntuiextendAppFunctions(rt: Runtime): Record<string, Func> {
  const st = (): IntuiextendState => rt.intuiextend
  const i0 = (a: Value[], n: number): number => int(a[n] ?? VI(0)) | 0
  const s0 = (a: Value[], n: number): string => (a[n] === undefined ? '' : str(a[n]))

  return {
    /**
     * =App Create Icon(DISKOBJ,MSGPORT,TEXT$), routine 245 ($4b42).
     *
     *     $4b56  moveq    #$0,d0        ; id
     *     $4b58  moveq    #$0,d1        ; userdata
     *     $4b5a  movea.l  (a3)+,a0      ; TEXT$, the last argument pushed
     *     $4b5c  addq.w   #$2,a0        ; past the AMOS length word
     *     $4b5e  movea.l  (a3)+,a1      ; MSGPORT
     *     $4b60  movea.l  (a3)+,a2      ; DISKOBJ
     *     $4b62  movem.l  a3-a4,-(a7)
     *     $4b66  movea.l  a2,a3         ; diskobj into its own register
     *     $4b68  suba.l   a2,a2         ; lock
     *     $4b6a  suba.l   a4,a4         ; taglist
     *     $4b6c  jsr      -$3c(a6)      ; AddAppIconA
     *
     * a3 is the argument stack, so it is saved with a4 across the one call
     * that wants both registers.
     *
     * The text is `addq.w #$2,a0` and nothing else: an AMOS string is a
     * length word and then characters, with no terminator, so the label
     * Workbench draws runs on past the string into the next thing in AMOS's
     * string heap. GameSupport's `Gsiconify` makes the identical mistake with
     * the identical call, and its own guide records the author finding and
     * fixing it for a neighbouring argument. Nothing here reads past the
     * string, because there is no AddAppIconA to read it.
     *
     * app0: "APPADR=Adresse de la structure AppIcon", and $4b7a answers -1
     * when the library is not there or the call fails.
     */
    'app create icon': (_, a) => {
      i0(a, 0)
      i0(a, 1)
      s0(a, 2)
      return VI(IE_APP_FAIL)
    },

    /**
     * =Wb Get Deficon(DEFFLAG), routine 249 ($4be2). icon.library
     * GetDefDiskObject at -$78, with DEFFLAG straight into d0.
     *
     * app5 calls it "Type de l'icone par défaut (Def_Icon...)" and names no
     * values; `workbench.i`:35-41 has the seven, WBDISK 1 through WBKICK 7.
     * Nothing range-checks, so an eighth reaches the library as itself.
     *
     * IntuiExtend 1.6 did two more instructions here and 2.01b dropped them:
     *
     *     $4bc0  movea.l  d0,a0
     *     $4bc2  move.l   #$0,$34(a0)
     *
     * with no test of d0 in between. A failed GetDefDiskObject answers zero,
     * and the write then lands at absolute $34. $34 is not the start of any
     * DiskObject field either: do_Type is a UWORD at $30, so do_DefaultTool
     * is at $32 and do_ToolTypes at $36, and a long at $34 takes half of each.
     */
    'wb get deficon': (_, a) => {
      i0(a, 0)
      return VI(IE_APP_FAIL)
    },

    /**
     * =App Get Numarg, routine 253 ($4c74), five instructions and no library
     * at all: the long at workspace+$6e4, then am_NumArgs at $1e of it.
     *
     * app3: "NUMARG=Retourne le nombre d'argument envoyé dans la AppIcon."
     *
     * The message is whatever `Wb Get Msg` last took off a port. There is no
     * test that one has been taken, so before the first `Wb Get Msg` the
     * routine dereferences zero and reads absolute $1e, which on an Amiga is
     * inside the exception vectors. The port answers 0, which no vector table
     * is going to make true and which is the count of a message that is not
     * there.
     */
    'app get numarg': () => {
      const msg = st().portState.lastMsg >>> 0
      if (msg === 0) return VI(0)
      return VI(ieMem(rt).long(msg + IE_AM.NUMARGS) | 0)
    },

    /**
     * =App Get Arglist(NUM), routine 254 ($4c86).
     *
     *     $4c86  move.l   (a3)+,d0
     *     $4c88  asl.w    #$3,d0        ; NUM * 8, a WORD shift
     *     $4c8a  subq.w   #$4,d0        ;   ... minus 4
     *     $4c96  movea.l  $22(a2),a2    ; am_ArgList
     *     $4c9a  adda.l   d0,a2         ; a LONG add
     *     $4c9c  movea.l  (a2),a2       ; wa_Name
     *
     * A WBArg is eight bytes with wa_Name at +4, so NUM * 8 - 4 is entry
     * NUM-1's name: app2's "NUM=N° de l'argument recherché" counts from one.
     * NUM of zero reads four bytes in front of the list, and nothing compares
     * NUM against `App Get Numarg`.
     *
     * The shift and the subtract are word-sized and the add is not, so the
     * high half of NUM survives both and is added to the list address. It
     * only shows above 8,191, where a word shift of NUM * 8 has started to
     * overflow anyway.
     *
     * The string comes back through routine 143, AMOS's string allocator: a
     * strlen loop, then the length as a word and the characters after it.
     */
    'app get arglist': (_, a) => {
      const num = i0(a, 0)
      const msg = st().portState.lastMsg >>> 0
      if (msg === 0) return VS('')
      const m = ieMem(rt)
      const list = m.long(msg + IE_AM.ARGLIST) >>> 0
      // `asl.w #$3,d0 / subq.w #$4,d0` touch the low word, `adda.l` reads all
      const low = ((((num & 0xffff) << 3) & 0xffff) - 4) & 0xffff
      const off = ((num & ~0xffff) | low) >>> 0
      const name = m.long((list + off) >>> 0) >>> 0
      if (name === 0) return VS('')
      let s = ''
      for (let p = name; ; p++) {
        const c = m.byte(p)
        if (c === 0) break
        s += String.fromCharCode(c)
      }
      return VS(s)
    },

    /**
     * =Wb Get Wbicon(NAME$), routine 256 ($4cda). See the two defects at the
     * top of this file: the vector it calls is icon.library's undocumented
     * -$1e rather than GetDiskObject at -$4e, and the library-missing path
     * pops a longword nothing pushed.
     *
     * -1 is what the routine loads into d3 at $4cda and therefore what it
     * means by failure. It is not what a machine without icon.library does,
     * because that machine does not come back from here at all.
     */
    'wb get wbicon': (_, a) => {
      s0(a, 0)
      return VI(IE_APP_FAIL)
    },
  }
}
