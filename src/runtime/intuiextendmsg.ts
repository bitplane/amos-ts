/**
 * IntuiExtend 2.01b, the memory and message groups.
 *
 * Thirty-six keywords that share one habit: they are thin wrappers, and the
 * interesting part is almost always a constant or an offset rather than the
 * call. Eight of them do not call anything at all.
 *
 * ## The message block at workspace+$78
 *
 * `Get Msg` is the only routine that fills it, and it fills it once per
 * message before replying:
 *
 *     $2c6e  move.w  $18(a1),$0(a0)    ; im_Code       -> +$78
 *     $2c74  move.w  $1a(a1),$2(a0)    ; im_Qualifier  -> +$7a
 *     $2c7a  move.l  $1c(a1),$4(a0)    ; im_IAddress   -> +$7c
 *     $2c80  move.w  $20(a1),$8(a0)    ; im_MouseX     -> +$80
 *     $2c86  move.w  $22(a1),$a(a0)    ; im_MouseY     -> +$82
 *
 * Those five offsets are IntuiMessage's, confirmed against
 * includes/intuition/intuition.i:585-607 with MN_SIZE of $14 (LN_SIZE 14, a
 * reply port and a length word). `Get Msg Code`, `Get Msg Qualifier`,
 * `Get Msg Iadr`, `Get Msg Xm`, `Get Msg Ym` and `Get Msg Scancode` are each
 * four instructions reading one of them back.
 *
 * `Get Msg` REPLIES to the message itself, at $2c90, before it returns. So
 * the six accessors read a copy and there is nothing left to reply to --
 * which is why `Wb Reply Msg` belongs to `Wb Get Msg` and not to this one.
 *
 * ## Get Msg blocks, and the guide says so
 *
 * $2c56 is WaitPort and $2c5c is GetMsg. The author's own warning: "Si vous
 * limiter les codes, Get Msg attendras un message et votre programme risque
 * de se trouvé bloqué, Get Msg attendant un message pour eviter de bloquer
 * votre programme, incluer le code IntuiTicks ($400000) au code IDCMP de
 * votre fenetre." And $2cc8 turns an INTUITICKS class into 0 on the way out,
 * so the recommended escape hatch reads as "nothing happened".
 *
 * ## Three defects, one of them in a pair of keywords that cannot work
 *
 * `Get Menu Msg` and `Get Item Msg` read the wrong bytes. `Get Msg` unpacks a
 * MENUPICK code into workspace+$6e0, +$6e1 and +$6e2, and `Get Subitem Msg`
 * reads +$6e2 -- but $4a9c is `adda.w #$6fe,a0` and $4aac is `adda.w #$6ff,a0`,
 * thirty bytes further on. Nothing in the 23,084-byte file writes either
 * byte, and the file ships both as zero, so both keywords answer 0 forever.
 * See each.
 *
 * ## Evidence
 *
 * BINARY tier. Every LVO read out of the corpus `.fd` files under GUI 2.10
 * (exec_lib.fd, dos_lib.fd, intuition_lib.fd); the MEMF bits and the struct
 * offsets out of the AMOS Pro `includes` copies of exec/memory.i,
 * exec/ports.i, exec/nodes.i, libraries/dos.i and intuition/intuition.i.
 * Documented against `IntuiExtend_2.0.Guide`'s System.guide, Misc.guide,
 * MemFlags.guide, Menu.guide, Text.guide and IDCMP.guide.
 */
import type { Runtime } from './runtime'
import type { Func, Instr } from '../interp/builtins'
import { VI, VS, int, str, type Value } from '../interp/values'
import type { IntuiextendState } from './intuiextend'
import type { IeWindow } from './intuiextendwin'

/**
 * The MEMF bits the eight `M*` keywords answer, each one a `moveq` or a
 * `move.l #imm` and nothing else.
 *
 * PUBLIC, CHIP, FAST, CLEAR and LARGEST are the 1.3 include's own
 * (exec/memory.i:50-54, as BITDEF bits 0, 1, 2, 16 and 17). LOCAL, 24BITDMA
 * and TOTAL are 2.0 additions and no include on this machine defines them;
 * the VALUES below are the binary's and the NAMES are the guide's own
 * MemFlags nodes, which call them "mémoire Locale", "24Bit DMA" and the
 * public total.
 */
export const IE_MEMF = {
  /** routine 202 ($44ae), `moveq #$1,d3` */
  PUBLIC: 0x1,
  /** routine 203 ($44b4), `moveq #$2,d3` */
  CHIP: 0x2,
  /** routine 204 ($44ba), `moveq #$4,d3` */
  FAST: 0x4,
  /** routine 205 ($44c0), `move.l #$100,d3` */
  LOCAL: 0x100,
  /** routine 208 ($44de), `move.l #$200,d3` */
  DMA24: 0x200,
  /** routine 206 ($44ca), `move.l #$10000,d3` */
  CLEAR: 0x10000,
  /** routine 201 ($44a4), `move.l #$20000,d3` */
  LARGEST: 0x20000,
  /** routine 207 ($44d4), `move.l #$80000,d3` */
  TOTAL: 0x80000,
} as const

/**
 * `Wb Flush Memory` asks for this many bytes — routine 285 ($547a),
 * `move.l #$3b9ac9ff,-(a3)`, which is 999,999,999.
 *
 * The allocation is meant to fail. Asking exec for more than the machine has
 * is the documented way to make it expunge every library and device nothing
 * is using, and the routine then `Rbra`s straight into `Alloc Mem` and lets
 * the null result fall out as its own. It never frees anything, because there
 * is never anything to free.
 */
export const IE_FLUSH_SIZE = 0x3b9a_c9ff

/** the message block at workspace+$78, which only `Get Msg` writes */
export interface IeMsgBlock {
  /** +$78, im_Code */
  code: number
  /** +$7a, im_Qualifier */
  qualifier: number
  /** +$7c, im_IAddress */
  iaddress: number
  /** +$80, im_MouseX */
  mouseX: number
  /** +$82, im_MouseY */
  mouseY: number
  /** +$6e0, +$6e1, +$6e2 — the unpacked MENUPICK code */
  menu: number
  item: number
  sub: number
}

export function newIeMsgBlock(): IeMsgBlock {
  return { code: 0, qualifier: 0, iaddress: 0, mouseX: 0, mouseY: 0, menu: 0, item: 0, sub: 0 }
}

/** one MsgPort, by the address `Wb Create Msgport` or `Wb Create Port` gave */
export interface IePort {
  addr: number
  name: string
  pri: number
  /** exec's own queue. Nothing in this port puts a message on one yet. */
  queue: number[]
}

export interface IePortState {
  ports: Map<number, IePort>
  next: number
  /** workspace+$6e4, the message `Wb Get Msg` last took off a port */
  lastMsg: number
}

export function newIePortState(): IePortState {
  return { ports: new Map(), next: 0, lastMsg: 0 }
}

/**
 * Where a `struct MsgPort *` lives. Handles, like the window ones, and for
 * the same reason: nothing here lays a MsgPort out in addressable memory.
 */
export const IE_PORT_BASE = 0x4c00_0000
export const IE_PORT_STEP = 0x40

/**
 * What routine 288 allocates for a MsgPort, and what it needs.
 *
 * `move.l #$20,-(a3)` at $54e0 asks for 32 bytes. MP_SIZE is 34: LN_SIZE is
 * 14 (exec/nodes.i), then mp_Flags, mp_SigBit, mp_SigTask and a 14-byte List
 * (exec/ports.i:30-33). The last two bytes of the List sit outside the block.
 */
export const IE_PORT_ALLOC = 0x20
export const IE_PORT_SIZEOF = 0x22

/** the low word, signed */
const lo = (v: number): number => (v << 16) >> 16

/**
 * `Get Msg`'s MENUPICK unpacking, $2c9c-$2cc6.
 *
 *     andi.l #$1f,d0                    ; menu
 *     andi.l #$7e0,d0 / ror.w #$5,d0    ; item
 *     andi.l #$f800,d0 / ror.w #$8 / ror.w #$3   ; subitem
 *
 * Two rotates rather than one because `ror.w` takes at most 8 in an
 * immediate; together they are a rotate of 11, and with only bits 11-15 left
 * standing that is a shift.
 */
export function ieMenuPick(code: number): { menu: number; item: number; sub: number } {
  const c = code & 0xffff
  return { menu: c & 0x1f, item: (c & 0x7e0) >>> 5, sub: (c & 0xf800) >>> 11 }
}

/**
 * `Get Menu Code(MENUNB,ITEMNB,SUBINB)` — routine 222 ($4816), the inverse.
 *
 * The masks are not the same width in both directions: the subitem is masked
 * to five bits here and unpacked from five, the item to six and unpacked from
 * six, so the pair round-trips for anything that fits.
 */
export function ieMenuCode(menu: number, item: number, sub: number): number {
  const s = ((sub & 0x1f) << 11) & 0xffff
  const i = ((item & 0x3f) << 5) & 0xffff
  return (s + i + (menu & 0x1f)) & 0xffff
}

export function makeIntuiextendMsgInstructions(rt: Runtime): Record<string, Instr> {
  const st = (): IntuiextendState => rt.intuiextend

  const windowAt = (addr: number): IeWindow | null => st().windowState.windows.get(addr >>> 0) ?? null

  /** `a,b To c` — the shape `Copy Mem` and `Wb Poke$` have */
  const toArgs = (it: Parameters<Instr>[0], before: number): number[] => {
    const out = [it.evalInt()]
    for (let i = 1; i < before; i++) {
      it.expect(',')
      out.push(it.evalInt())
    }
    it.expect('to')
    out.push(it.evalInt())
    return out
  }

  const byteAt = (addr: number): number | null => {
    const m = rt.resolveAddr(addr >>> 0)
    return m ? (m.data[m.off] ?? 0) : null
  }
  const putByte = (addr: number, v: number): void => {
    const m = rt.resolveWrite(addr >>> 0)
    if (m) m.data[m.off] = v & 0xff
  }

  return {
    /**
     * Free Mem START,LEN — routine 5 ($24a8), exec FreeMem at -$d2.
     *
     *     move.l  (a3)+,d0     ; LEN, the last argument
     *     movea.l (a3)+,a1     ; START
     *
     * The guide is blunt about the contract: "seule une zone mémoire allouée
     * avec la fonction AllocMem, doit être libérée."
     */
    'free mem'(it) {
      const start = it.evalInt()
      it.expect(',')
      it.evalInt()
      st().heap.freeMem(start >>> 0)
    },

    /**
     * Copy Mem STAR,SIZE To DEST — routine 42 ($2d98), a byte loop and no
     * library call at all.
     *
     * The guide's point is the argument, not the speed: "il suffit de donner
     * la taille réelle du block de mémoire et non pas la position de fin",
     * against AMOS's own `Copy Start(1),Start(1)+Length(1) To Start(2)`.
     *
     * `tst.w d0 / ble` tests the LOW WORD, so a size of $10000 copies nothing
     * and a size of $18000 copies $8000 bytes.
     */
    'copy mem'(it) {
      const [src, size, dst] = toArgs(it, 2)
      const n = lo(size!)
      if (n <= 0) return
      for (let i = 0; i < n; i++) {
        const b = byteAt((src! + i) >>> 0)
        if (b === null) break
        putByte((dst! + i) >>> 0, b)
      }
    },

    /**
     * Wb Poke$ TXT$ To PTR — routine 162 ($3c16).
     *
     *     move.w  (a0)+,d0
     *     subq.w  #$1,d0
     *     move.b  (a0)+,(a1)+
     *     dbra    d0,$3c1e
     *
     * The guide says it "Effectue la copie des chaînes intuition (qui se
     * terminent par un zéro), cette commande stoppera la copie lorsqu'elle
     * rencontrera un zéro." The loop is a plain `dbra` with no test, so it
     * does neither: it copies exactly the string's length and appends no
     * terminator.
     *
     * DEFECT: `subq.w #$1,d0` before any test, so an EMPTY string makes the
     * counter -1 and the `dbra` copies 65,536 bytes.
     */
    'wb poke$'(it) {
      const s = str(it.evalExpr())
      it.expect('to')
      const dst = it.evalInt()
      const n = s.length === 0 ? 0x10000 : s.length
      for (let i = 0; i < n; i++) {
        putByte((dst + i) >>> 0, i < s.length ? s.charCodeAt(i) : 0)
        if (!rt.resolveWrite((dst + i) >>> 0)) break
      }
    },

    /**
     * Wb Flush Memory — routine 285 ($547a), three instructions.
     *
     *     move.l  #$3b9ac9ff,-(a3)
     *     move.l  #$10001,-(a3)
     *     Rbra    routine 35
     *
     * 999,999,999 bytes of MEMF_PUBLIC|MEMF_CLEAR, which is a request no
     * machine can meet, and that is the point: exec expunges everything
     * unused trying to satisfy it and then fails. The `Rbra` is a tail call,
     * so `Alloc Mem`'s null answer becomes this keyword's, and nothing is
     * ever freed because nothing is ever allocated.
     *
     * DEVIATION: there is no library list to expunge here and no allocator
     * that can be asked for a gigabyte. The request is made against the
     * extension's own pool, fails, and nothing changes -- which is the
     * observable outcome on the machine too.
     */
    'wb flush memory'() {
      st().heap.alloc(IE_FLUSH_SIZE, { clear: true })
    },

    /**
     * Wb New Idcmp WIND,IDCMP — routine 75 ($3132), ModifyIDCMP at -$96.
     *
     *     move.l  (a3)+,d0     ; IDCMP, the last argument
     *     movea.l (a3)+,a0     ; WIND
     *
     * IDCMP.guide lists all thirty bits by name, from SizeVerify $1 to
     * LonelyMessage $80000000.
     */
    'wb new idcmp'(it) {
      const addr = it.evalInt()
      it.expect(',')
      const flags = it.evalInt()
      const w = windowAt(addr)
      if (w) w.idcmpFlags = flags | 0
    },

    /**
     * Wb Erase Msgport PORTADR — routine 248 ($4bcc), DeleteMsgPort at -$2a0,
     * and it checks for a zero first.
     */
    'wb erase msgport'(it) {
      const addr = it.evalInt()
      if (addr === 0) return
      st().portState.ports.delete(addr >>> 0)
    },

    /**
     * Wb Reply Msg — routine 255 ($4cc2), and it takes NO argument: the
     * message is the one at workspace+$6e4, which is where `Wb Get Msg` put
     * it. ReplyMsg at -$17a.
     *
     * `Get Msg` does not need this. It replies at $2c90, inside itself,
     * before it hands the class back.
     */
    'wb reply msg'() {
      st().portState.lastMsg = 0
    },
  }
}

export function makeIntuiextendMsgFunctions(rt: Runtime): Record<string, Func> {
  const st = (): IntuiextendState => rt.intuiextend
  const i0 = (a: Value[], n: number): number => int(a[n] ?? VI(0)) | 0
  const s0 = (a: Value[], n: number): string => str(a[n] ?? VS(''))

  const windowAt = (addr: number): IeWindow | null => st().windowState.windows.get(addr >>> 0) ?? null

  const byteAt = (addr: number): number | null => {
    const m = rt.resolveAddr(addr >>> 0)
    return m ? (m.data[m.off] ?? 0) : null
  }

  return {
    // ---- the eight flag constants ---------------------------------------
    //
    // The guide's Sortie line calls seven of the eight an AMOUNT of free
    // memory -- "Totalité de la mémoire publique libre (Chip+Fast)" for
    // Mpublic, and so on. They are flags you pass TO `Avail Mem`, and the
    // author knew it: M6's Remarque is "MEM=Avail Mem(Mtotal)". Every routine
    // is one `moveq` or `move.l #imm` and a return.
    /** =Mpublic — routine 202 ($44ae) */
    mpublic: () => VI(IE_MEMF.PUBLIC),
    /** =Mchip — routine 203 ($44b4) */
    mchip: () => VI(IE_MEMF.CHIP),
    /** =Mfast — routine 204 ($44ba) */
    mfast: () => VI(IE_MEMF.FAST),
    /** =Mlocal — routine 205 ($44c0); "Chip, sans les extentions mémoire" */
    mlocal: () => VI(IE_MEMF.LOCAL),
    /** =Mdma — routine 208 ($44de); "24Bit DMA" */
    mdma: () => VI(IE_MEMF.DMA24),
    /** =Mclear — routine 206 ($44ca); "Demande une zone de mémoire remplie de '0'" */
    mclear: () => VI(IE_MEMF.CLEAR),
    /** =Mlargest — routine 201 ($44a4); "Plus grand block de mémoire libre" */
    mlargest: () => VI(IE_MEMF.LARGEST),
    /** =Mtotal — routine 207 ($44d4) */
    mtotal: () => VI(IE_MEMF.TOTAL),

    /**
     * =Alloc Mem(SIZE,MEMTYPE) — routine 35 ($2ce2), exec AllocMem at -$c6.
     *
     *     move.l  (a3)+,d1     ; MEMTYPE
     *     move.l  (a3)+,d0     ; SIZE
     *
     * The guide is emphatic that this is the right way to get memory: "c'est
     * >LA< methode a utiliser car le system vous donneras un block non
     * utiliser et vous le reserveras pour vous." Zero when it cannot.
     */
    'alloc mem': (_, a) => {
      const size = i0(a, 0)
      const type = i0(a, 1)
      if (size <= 0) return VI(0)
      return VI(st().heap.alloc(size, { clear: (type & IE_MEMF.CLEAR) !== 0 }) | 0)
    },

    /**
     * =Alloc Abs(SIZE,LOCATE) — routine 36 ($2cf8), exec AllocAbs at -$cc.
     *
     *     movea.l (a3)+,a1     ; LOCATE
     *     move.l  (a3)+,d0     ; SIZE
     *
     * The guide's own warning: "cette commande et extremement dangeureuse
     * pour le system, car si vous alloué un block deja utiliser vous risquez
     * un bloquage du system..."
     *
     * DEVIATION: there is no free list to carve a specific address out of.
     * The pool this port allocates from hands out its own addresses, so an
     * absolute request can only be refused -- which is what AllocAbs does for
     * an address that is not free, and every address here is not free.
     */
    'alloc abs': (_, a) => {
      i0(a, 0)
      i0(a, 1)
      return VI(0)
    },

    /**
     * =Avail Mem(MEMTYPE) — routine 37 ($2d0e), exec AvailMem at -$d8.
     *
     * The guide's example sums the flags: `C=Avail Mem(Mchip+Mfast)`.
     *
     * CHIP and FAST are the machine's two pools. LARGEST asks for the biggest
     * single block rather than the total, and with no fragmentation modelled
     * the biggest block in a pool IS the pool. LOCAL, 24BITDMA and TOTAL are
     * read the way MemFlags.guide describes them, since no include on this
     * machine gives them a value: all three are chip plus fast.
     */
    'avail mem': (_, a) => {
      const type = i0(a, 0)
      const chip = rt.chipFree()
      const fast = rt.fastFree()
      if ((type & IE_MEMF.LARGEST) !== 0) return VI(Math.max(chip, fast))
      const wantChip = (type & IE_MEMF.CHIP) !== 0
      const wantFast = (type & IE_MEMF.FAST) !== 0
      if (wantChip && !wantFast) return VI(chip)
      if (wantFast && !wantChip) return VI(fast)
      return VI(chip + fast)
    },

    /**
     * =Write Mem(START,LEN To NAME$) — routine 6 ($24ba).
     *
     * Open (-$1e) with MODE_NEWFILE, Write (-$30), Close (-$24), through the
     * library base at $2b8(a5) -- which those three LVOs identify as
     * dos.library. MODE_NEWFILE is 1006, `move.l #$3ee,d2` at $24c6
     * (libraries/dos.i:30).
     *
     * DEFECT: the answer is inverted. The guide says "RESULT=True si Ok, ou
     * False", and AMOS true is -1 -- but $24e6 is `moveq #$0,d3` on the path
     * where the file opened and was written, and $24ea is `moveq #$ff,d3`
     * where Open returned zero. Success answers False and failure answers
     * True.
     */
    'write mem': (_, a) => {
      const start = i0(a, 0)
      const len = i0(a, 1)
      const name = s0(a, 2)
      const bytes = new Uint8Array(Math.max(0, len))
      for (let i = 0; i < bytes.length; i++) bytes[i] = byteAt((start + i) >>> 0) ?? 0
      const vfs = rt.vfs
      if (!vfs) return VI(-1)
      let ok = false
      try {
        ok = vfs.writeFile(name, bytes)
      } catch {
        ok = false
      }
      return VI(ok ? 0 : -1)
    },

    /**
     * =Wb Peek(ADR,FLAG) — routine 113 ($36d6).
     *
     *     cmp.b   #$1,d0  -> move.b (a0),d3
     *     cmp.b   #$2,d0  -> move.w (a0),d3
     *     otherwise          move.l (a0),d3
     *
     * The guide gives the three flags as 1, 2 and 4 with "le 4 est le Flag
     * par défaut", and 4 reaches the long arm by falling through rather than
     * by being tested. The comparisons are BYTE ones, so a flag of 257 reads
     * a byte.
     *
     * d3 is cleared before the branch, so the byte and word arms answer
     * zero-extended rather than sign-extended.
     */
    'wb peek': (_, a) => {
      const addr = i0(a, 0)
      const flag = i0(a, 1) & 0xff
      const b = (n: number): number => byteAt((addr + n) >>> 0) ?? 0
      if (flag === 1) return VI(b(0))
      if (flag === 2) return VI((b(0) << 8) | b(1))
      return VI((((b(0) << 24) | (b(1) << 16) | (b(2) << 8) | b(3)) | 0) >>> 0 | 0)
    },

    /**
     * =Wb Mem Compare(ADR0,ADR1,ADRLEN) — routine 258 ($4d60), eighteen bytes.
     *
     *     subq.w  #$1,d3
     *     cmpm.b  (a1)+,(a0)+
     *     dbeq    d3,$4d6a
     *
     * DEFECT: `dbeq` where the keyword needs `dbne`. DBcc exits when its
     * condition is TRUE, and EQ is "the two bytes were equal" -- so the loop
     * runs while the bytes DIFFER and stops at the first byte they SHARE.
     * That is the opposite of a comparison.
     *
     * The guide promises "RESULT=0 Si les deux segments sont identiques. >0
     * Emplacement où se trouve la différence." Two identical segments match
     * on the very first byte, so the loop exits at once and the answer is
     * ADRLEN-1. Two segments with nothing in common run the counter down to
     * -1. Neither number is a position, and 0 comes back only for a length of
     * exactly one byte that differs.
     */
    'wb mem compare': (_, a) => {
      const p = i0(a, 0)
      const q = i0(a, 1)
      let d3 = (lo(i0(a, 2)) - 1) & 0xffff
      for (;;) {
        if ((byteAt(p) ?? 0) === (byteAt(q) ?? 0)) return VI(lo(d3))
        if (d3 === 0) return VI(-1)
        d3 = (d3 - 1) & 0xffff
      }
    },

    /**
     * =Hard Mouse Key — routine 63 ($2fd0), and it reads the hardware.
     *
     *     btst.b  #$6,$bfe001    -> bit 0    port 0 left
     *     btst.b  #$2,$dff016    -> bit 1    port 0 right
     *     btst.b  #$0,$dff016    -> bit 2    port 0 middle
     *     btst.b  #$7,$bfe001    -> bit 3    port 1 left
     *     btst.b  #$6,$dff016    -> bit 4    port 1 right
     *     btst.b  #$4,$dff016    -> bit 5    port 1 middle
     *
     * All six are ACTIVE LOW -- each `bne` skips the `bset`. The POTGOR tests
     * are BYTE reads of a WORD register, so they land on bits 15-8: #2 is bit
     * 10 (DATLY), #0 is bit 8 (DATLX), #6 is bit 14 (DATRY) and #4 is bit 12
     * (DATRX).
     *
     * The guide's table gives the same six, port A's three then port B's, and
     * says of them: "Les valeur retournées sont au format Bits, plusieurs
     * teste permettent de connaitre les boutons utilisés."
     *
     * Read through the memory map rather than from the host's mouse, the same
     * way ./craft.ts's `Hw Mouse Key` does, so a program that Peeks $bfe001
     * itself gets the same answer.
     */
    'hard mouse key': () => {
      const cia = rt.resolveAddr(0xbf_e001)
      const pot = rt.resolveAddr(0xdf_f016)
      const pra = cia ? (cia.data[cia.off] ?? 0xff) : 0xff
      const potw = pot ? (((pot.data[pot.off] ?? 0xff) << 8) | (pot.data[pot.off + 1] ?? 0xff)) : 0xffff
      let d3 = 0
      if ((pra & 0x40) === 0) d3 |= 1
      if ((potw & (1 << 10)) === 0) d3 |= 2
      if ((potw & (1 << 8)) === 0) d3 |= 4
      if ((pra & 0x80) === 0) d3 |= 8
      if ((potw & (1 << 14)) === 0) d3 |= 16
      if ((potw & (1 << 12)) === 0) d3 |= 32
      return VI(d3)
    },

    /**
     * =Get Msg(WINDOW) — routine 33 ($2c46), 146 bytes and the heart of the
     * group.
     *
     * `movea.l $56(a2),a2` is wd_UserPort, then WaitPort (-$180), GetMsg
     * (-$174), the five fields copied to workspace+$78, and ReplyMsg (-$17a).
     * It answers im_Class.
     *
     * Two things happen on the way out. A MENUPICK ($100) has its code
     * unpacked into workspace+$6e0..$6e2, and an INTUITICKS ($400000) is
     * turned into 0 -- `cmp.l #$400000,d3 / bne / moveq #$0,d3` at $2cc8.
     * That second one is why the guide tells you to ask for IntuiTicks: it
     * wakes the WaitPort and then reads as nothing.
     *
     * DEVIATION: this WAITS on the machine, and here it yields to the
     * interpreter the way ./jdint.ts's `Jd Intevent` does. The statement
     * re-runs on resume, so the 0 returned while waiting is discarded rather
     * than seen.
     */
    'get msg': (it, a) => {
      const w = windowAt(i0(a, 0))
      if (!w) return VI(0)
      const m = w.win.getMsg()
      if (!m) {
        it.block({ type: 'waitInput', mouse: true, key: true }, true)
        return VI(0)
      }
      const b = st().msg
      b.code = m.code & 0xffff
      b.qualifier = m.qualifier & 0xffff
      b.iaddress = m.iaddress | 0
      b.mouseX = m.mouseX & 0xffff
      b.mouseY = m.mouseY & 0xffff
      if (m.class === 0x100) {
        const pick = ieMenuPick(b.code)
        b.menu = pick.menu
        b.item = pick.item
        b.sub = pick.sub
      }
      return VI(m.class === 0x40_0000 ? 0 : m.class | 0)
    },

    /** =Get Msg Code — routine 90 ($335a), the word at workspace+$78 */
    'get msg code': () => VI(st().msg.code),

    /**
     * =Get Msg Scancode — routine 53 ($2ee0), the SAME word masked $7f.
     *
     *     adda.w  #$78,a0
     *     move.w  (a0),d3
     *     andi.l  #$7f,d3
     *
     * Seven bits, which for a RAWKEY message is the raw key code without the
     * up transition in bit 7.
     */
    'get msg scancode': () => VI(st().msg.code & 0x7f),

    /** =Get Msg Qualifier — routine 91 ($3368), the word at workspace+$7a */
    'get msg qualifier': () => VI(st().msg.qualifier),

    /**
     * =Get Msg Iadr — routine 92 ($3376), the LONG at workspace+$7c.
     *
     * The guide: "Retourne l'adresse de l'objet qui a produit le dernier
     * message ... comme l'adresse d'un gadget apres un click ou l'adresse
     * d'un écran."
     */
    'get msg iadr': () => VI(st().msg.iaddress),

    /** =Get Msg Xm — routine 93 ($3384), the word at workspace+$80 */
    'get msg xm': () => VI(st().msg.mouseX),
    /** =Get Msg Ym — routine 94 ($3392), the word at workspace+$82 */
    'get msg ym': () => VI(st().msg.mouseY),

    /**
     * =Get Menu Msg — routine 240 ($4a96), and it reads the wrong byte.
     *
     *     movea.l $258(a5),a0
     *     adda.w  #$6fe,a0
     *     move.b  (a0),d3
     *
     * DEFECT: `Get Msg` writes the menu number to workspace+$6e0 ($2ca2 is
     * `adda.w #$6e0,a1`, then `move.b d0,(a2)+` three times for menu, item
     * and subitem). This reads +$6fe, thirty bytes further on. Nothing in the
     * file writes +$6fe -- a scan of every `adda.w #imm,An` in the 23,084-byte
     * hunk finds this one reference and no other -- and the workspace ships
     * it as zero, so the guide's "MENUNB=N° du menu sélectionné" is always 0.
     *
     * DEVIATION: the byte is modelled as the constant it is rather than as
     * storage, because there is no path by which it could ever hold anything
     * else.
     */
    'get menu msg': () => VI(0),

    /**
     * =Get Item Msg — routine 241 ($4aa6), +$6ff, the same defect one byte
     * along. `Get Msg` wrote the item number to +$6e1.
     */
    'get item msg': () => VI(0),

    /**
     * =Get Subitem Msg — routine 221 ($4806), +$6e2 -- and this is the ONE of
     * the three that reads where `Get Msg` wrote.
     */
    'get subitem msg': () => VI(st().msg.sub),

    /**
     * =Get Menu Code(MENUNB,ITEMNB,SUBINB) — routine 222 ($4816), the packer
     * `Get Msg` unpacks. The subitem is masked to five bits and shifted
     * eleven, the item masked to six and shifted five, the menu masked to
     * five and left alone.
     */
    'get menu code': (_, a) => VI(ieMenuCode(i0(a, 0), i0(a, 1), i0(a, 2))),

    /**
     * =Wb Create Msgport — routine 244 ($4b30), exec CreateMsgPort at -$29a
     * and nothing else. Four instructions.
     */
    'wb create msgport': () => {
      const ps = st().portState
      const addr = (IE_PORT_BASE + ps.next++ * IE_PORT_STEP) >>> 0
      ps.ports.set(addr, { addr, name: '', pri: 0, queue: [] })
      return VI(addr)
    },

    /**
     * =Wb Create Port(NAME$,PRI) — routine 288 ($54e0), the same job done by
     * hand, and done wrong twice.
     *
     * It allocates, calls AllocSignal(-1) at -$14a, fills in ln_Name ($a),
     * ln_Pri ($9), ln_Type 4 ($8), mp_Flags 0 ($e), mp_SigBit ($f) and
     * mp_SigTask from $114(a6) ($10), builds the message List, and AddPorts
     * it at -$162.
     *
     * DEFECT: it asks for 32 bytes and a MsgPort is 34. `move.l #$20,-(a3)`
     * at $54e0, and MP_SIZE is LN_SIZE 14 plus mp_Flags, mp_SigBit,
     * mp_SigTask and a 14-byte List (exec/nodes.i, exec/ports.i:30-33). The
     * List's last two bytes land outside the block. The FreeMem on the
     * AllocSignal failure path uses the same 32.
     *
     * DEFECT: it never returns the port. $555c is `move.l d0,d3`, and d0 at
     * that point is whatever AddPort left -- AddPort returns nothing. The
     * address it built is in a3 and is dropped. `Wb Create Msgport` two
     * routines away does the same job through exec and answers correctly.
     *
     * DEVIATION: the port IS created here and the handle recorded, because a
     * program has no other way to reach it and `Wb Erase Msgport` must have
     * something to delete. What is FAITHFUL is the answer: 0, standing for
     * the undefined d0 the routine returns.
     */
    'wb create port': (_, a) => {
      const name = s0(a, 0)
      const pri = i0(a, 1)
      const ps = st().portState
      const addr = (IE_PORT_BASE + ps.next++ * IE_PORT_STEP) >>> 0
      ps.ports.set(addr, { addr, name, pri: (pri << 24) >> 24, queue: [] })
      return VI(0)
    },

    /**
     * =Wb Get Msg(MSGPORT) — routine 252 ($4c42). WaitPort then GetMsg on the
     * port, the message stored at workspace+$6e4, and im_Class returned.
     *
     * -1 for a NULL port, which is the `moveq #$ff,d3` the routine opens
     * with. The guide draws the line with its neighbour: "A ne pas confondre
     * 'Get Msg', avec cette commande, 'Get Msg' demande l'adresse d'une
     * fenetre, alors que cette commande demande un port de message..."
     *
     * DEVIATION: nothing in this port ever puts a message on one of these.
     * The producers are AppWindow and AppIcon, which are a later group, so a
     * WaitPort here could never be woken and would hang the interpreter
     * rather than block it. An empty port answers the same -1 a null one
     * does; when the App group lands this becomes a real wait.
     */
    'wb get msg': (_, a) => {
      const addr = i0(a, 0)
      if (addr === 0) return VI(-1)
      const p = st().portState.ports.get(addr >>> 0)
      if (!p || p.queue.length === 0) return VI(-1)
      const m = p.queue.shift()!
      st().portState.lastMsg = m
      return VI(m)
    },
  }
}
