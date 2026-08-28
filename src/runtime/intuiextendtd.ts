/**
 * IntuiExtend 2.01b, the trackdisk group.
 *
 * Eleven keywords straight onto trackdisk.device. `Wb Td Open` builds the
 * whole thing by hand --- one AllocMem, a MsgPort filled in field by field,
 * AddPort, OpenDevice --- and the other ten poke io_Command and DoIO.
 *
 * ## The 90 bytes
 *
 * `$3ca0 move.l #$5a,d0` with MEMF_PUBLIC|MEMF_CLEAR, and the block holds two
 * structures with nothing spare:
 *
 *     +$00  the IOExtTD, and $38 of it
 *     +$38  the MsgPort, MP_SIZE being $22
 *
 * $38 + $22 is $5a exactly. The workspace keeps the block at +$18c and the
 * port at +$184, and `Wb Td Open` answers the block, which is what Td7 calls
 * "l'adresse de DiskExtIO".
 *
 * The port is built out of `exec/ports.i`: LN_TYPE ($08) is 4 for
 * NT_MSGPORT, MP_FLAGS ($0e) 0 for PA_SIGNAL, MP_SIGBIT ($0f) the bit
 * AllocSignal(-1) gave, MP_SIGTASK ($10) the task out of AMOS's `-$1c(a5)`,
 * and MP_MSGLIST ($14) is NewList'd in place:
 *
 *     $3cfa  move.l  a1,(a1)
 *     $3cfc  addq.l  #$4,(a1)      ; lh_Head = &lh_Tail
 *     $3cfe  move.l  a1,$8(a1)     ; lh_TailPred = &lh_Head
 *
 * lh_Tail is left alone because MEMF_CLEAR already zeroed it.
 *
 * ## The port is never attached to the request
 *
 * DEFECT: after AddPort the routine computes the port's address again and
 * then throws it away.
 *
 *     $3d10  movea.l  $258(a5),a1
 *     $3d14  adda.w   #$184,a1      ; a1 = &workspace+$184, and unused
 *     $3d18  movea.l  (a0),a0       ; a0, not a1
 *     $3d2a  move.l   a0,$e(a1)     ; mn_ReplyPort
 *
 * a0 is not set anywhere in the routine, and AddPort does not return one, so
 * MN_REPLYPORT (`ports.i`:60) is the long at whatever address the interpreter
 * happened to leave in a0. One character: `(a1)` was meant. The port the
 * routine spent twenty instructions building is added to the system and then
 * not pointed at.
 *
 * The port writes 0 there instead, which is the one value that is definitely
 * not a port; what the machine writes cannot be reproduced because it is not
 * defined. A program can see the difference only by reading DISKIO+$e.
 *
 * ## Two more things Wb Td Open does not check
 *
 * AllocMem's result is used without a test --- a failed allocation puts the
 * port at $38 --- and OpenDevice's is dropped on the floor at $3d46, so the
 * keyword answers the block address whether or not the device opened. Td7
 * offers no failure value at all.
 *
 * `Wb Td Close` frees the block and RemPort's the port, but never calls
 * FreeSignal (-$150) for the bit AllocSignal handed out. Sixteen opens and
 * closes exhaust a task's signals.
 *
 * ## What each keyword pokes
 *
 * IO_COMMAND is `io.i`:33 at $1c, IO_LENGTH :42 at $24, IO_DATA :43 at $28
 * and IO_OFFSET :44 at $2c. The commands are `exec/devices.i`'s CMD_READ 2,
 * CMD_WRITE 3, CMD_UPDATE 4, and trackdisk's own TD_MOTOR 9 and TD_FORMAT $b.
 *
 *     block   $200 bytes at BLOCK * $200
 *     track  $1600 bytes at TRACK * $1600
 *
 * $1600 is 5,632, eleven sectors of 512, which is one whole cylinder side.
 * Every one of the seven transfer keywords ends by storing DoIO's answer at
 * workspace+$194, and `Wb Td Error` is that long and nothing else.
 *
 * `mulu.w #$200,d7` and `mulu.w #$1600,d7` are WORD multiplies, so only the
 * low sixteen bits of the block or track number count. Td0 documents 0 to
 * 1759 and the wrap is far outside that.
 *
 * ## Wb Block Update ignores both its arguments
 *
 * Routine 176 sets io_Data, io_Length and io_Offset exactly as `Wb Block
 * Write` does and then asks for CMD_UPDATE, which flushes the device's own
 * track buffer and reads none of the three. Td1's "BLOCK=No du Block a
 * Copier" describes a field the command does not look at.
 *
 * ## Evidence
 *
 * BINARY tier. Every exec LVO came out of `exec_lib.fd` under the GUI 2.10
 * sources and every structure offset out of AMOS Professional's own
 * `includes/exec` copies of nodes.i, ports.i and io.i. The transfers go
 * through ../runtime/runtime.ts's `devTransfer`, which is the same path the
 * core `Dev Do` family and LDos take onto the mounted ADF. Documented against
 * `IntuiExtend_2.0.Guide`'s TrackDisk.guide, @Author CIERP Philippe.
 */
import type { Runtime } from './runtime'
import type { Func, Instr } from '../interp/builtins'
import { VI, int, type Value } from '../interp/values'
import { ieMem } from './intuiextendwin'
import type { IntuiextendState } from './intuiextend'

/** `move.l #$5a,d0` at $3ca0: the IOExtTD and the MsgPort in one block */
export const IE_TD_BLOCK = 0x5a

/** `addi.l #$38,d0` at $3cba: how far into the block the MsgPort sits */
export const IE_TD_PORT = 0x38

/** one sector, and one cylinder side of eleven of them */
export const IE_TD_BLOCK_BYTES = 0x200
export const IE_TD_TRACK_BYTES = 0x1600

/** `exec/nodes.i`:22, `ports.i`:29-32 and :60-61, `io.i`:33 and :42-44 */
const O = {
  LN_TYPE: 0x08,
  LN_PRI: 0x09,
  LN_NAME: 0x0a,
  MN_REPLYPORT: 0x0e,
  MN_LENGTH: 0x12,
  MP_FLAGS: 0x0e,
  MP_SIGBIT: 0x0f,
  MP_SIGTASK: 0x10,
  MP_MSGLIST: 0x14,
  IO_COMMAND: 0x1c,
  IO_ERROR: 0x1f,
  IO_ACTUAL: 0x20,
  IO_LENGTH: 0x24,
  IO_DATA: 0x28,
  IO_OFFSET: 0x2c,
} as const

/** NT_MSGPORT and NT_MESSAGE, the two `ln_Type` values routine 167 writes */
const NT_MSGPORT = 4
const NT_MESSAGE = 5

/** the five commands this group asks for */
export const IE_TD_CMD = { READ: 2, WRITE: 3, UPDATE: 4, MOTOR: 9, FORMAT: 0x0b } as const

export interface IeTdState {
  /** workspace+$194, the long every transfer stores DoIO's answer in */
  error: number
  /** which unit each open DiskExtIO was opened for, by its block address */
  units: Map<number, number>
}

export function newIeTdState(): IeTdState {
  return { error: 0, units: new Map() }
}

export function makeIntuiextendTdInstructions(rt: Runtime): Record<string, Instr> {
  const st = (): IeTdState => rt.intuiextend.td
  const ext = (): IntuiextendState => rt.intuiextend

  /** `DISKIO,A To B`, which is the shape of all seven transfer keywords */
  const args3 = (it: Parameters<Instr>[0]): [number, number, number] => {
    const io = it.evalInt()
    it.expect(',')
    const a = it.evalInt()
    it.expect('to')
    return [io, a, it.evalInt()]
  }

  /**
   * Poke the four fields and run the request, the way every one of the seven
   * does it: `move.w #cmd,$1c(a1)`, io_Data, io_Length, io_Offset, DoIO, and
   * the answer to workspace+$194.
   *
   * TD_FORMAT reaches `devTransfer` as a CMD_WRITE. An ADF is a plain run of
   * sector data with no MFM, no gaps and no sector headers, so formatting a
   * track of one and writing it are the same bytes landing in the same place;
   * there is nothing else for TD_FORMAT to do to an image that has no format
   * to lay down.
   */
  const transfer = (io: number, cmd: number, data: number, length: number, offset: number): void => {
    const m = ieMem(rt)
    const addr = io >>> 0
    m.setWord(addr + O.IO_COMMAND, cmd)
    m.setLong(addr + O.IO_DATA, data >>> 0)
    m.setLong(addr + O.IO_LENGTH, length)
    m.setLong(addr + O.IO_OFFSET, offset >>> 0)
    const unit = st().units.get(addr)
    if (unit === undefined) {
      // nothing was opened here, so there is no device to answer
      st().error = 0
      return
    }
    const wire = cmd === IE_TD_CMD.FORMAT ? IE_TD_CMD.WRITE : cmd
    const r = rt.devTransfer('trackdisk.device', unit, undefined, wire, length, data >>> 0, offset >>> 0)
    m.setLong(addr + O.IO_ACTUAL, r.actual)
    m.setByte(addr + O.IO_ERROR, r.error)
    st().error = r.error | 0
  }

  /**
   * TD_MOTOR, routine 171 ($3d9e), which routines 169 and 170 reach by
   * pushing a 1 or a 0 back onto the argument stack and branching to it.
   *
   *     $3d82  movea.l (a3)+,a1
   *     $3d84  move.l  #$1,-(a3)
   *     $3d8a  Rbra    routine 171
   *
   * The state goes in IO_LENGTH, which is where trackdisk reads it, and this
   * is the one command of the five whose answer is NOT stored at
   * workspace+$194: routine 171 ends at DoIO. So `Wb Td Error` still reports
   * whatever the last transfer left.
   */
  const motor = (it: Parameters<Instr>[0], on: number): void => {
    const m = ieMem(rt)
    const addr = it.evalInt() >>> 0
    m.setWord(addr + O.IO_COMMAND, IE_TD_CMD.MOTOR)
    m.setLong(addr + O.IO_LENGTH, on)
    const unit = st().units.get(addr)
    const drive = unit === undefined ? undefined : rt.machine.drives[unit]
    if (drive) drive.motorOn = on !== 0
  }

  return {
    /**
     * Wb Td Close DISKIO --- routine 168 ($3d56).
     *
     * CloseDevice on the block, RemPort on the block plus $38, then FreeMem
     * of $5a. Td3 says it "Libere la memoire du MsgPort, de DiskExtIO et
     * ferme le trackdisk.device", which is all three in the order it does
     * them --- and no FreeSignal, which the note is silent about too.
     */
    'wb td close': (it) => {
      const addr = it.evalInt() >>> 0
      st().units.delete(addr)
      ext().heap.freeMem(addr)
    },

    /** Wb Td Motor On DISKIO --- routine 169 ($3d82), TD_MOTOR with a 1 */
    'wb td motor on': (it) => motor(it, 1),

    /** Wb Td Motor Off DISKIO --- routine 170 ($3d90), TD_MOTOR with a 0 */
    'wb td motor off': (it) => motor(it, 0),

    /**
     * Wb Block Read DISKIO,BLOCK To BUFFER --- routine 172 ($3db6).
     *
     * `$3db6 move.l (a3)+,d6` takes BUFFER first because it is the last
     * argument pushed, and it is io_Data; BLOCK follows into d7 and is
     * multiplied to the offset.
     */
    'wb block read': (it) => {
      const [io, block, buffer] = args3(it)
      transfer(io, IE_TD_CMD.READ, buffer, IE_TD_BLOCK_BYTES, (block & 0xffff) * IE_TD_BLOCK_BYTES)
    },

    /**
     * Wb Block Write DISKIO,BUFFER To BLOCK --- routine 173 ($3dee).
     *
     * The arguments are the other way round from `Wb Block Read`, and so are
     * the pops: BLOCK is last here.
     */
    'wb block write': (it) => {
      const [io, buffer, block] = args3(it)
      transfer(io, IE_TD_CMD.WRITE, buffer, IE_TD_BLOCK_BYTES, (block & 0xffff) * IE_TD_BLOCK_BYTES)
    },

    /**
     * Wb Block Update DISKIO,BUFFER To BLOCK --- routine 176 ($3e6e).
     *
     * DEFECT: it fills in io_Data, io_Length and io_Offset exactly as a write
     * would and then asks for CMD_UPDATE, which flushes the device's track
     * buffer and reads none of them. Both of Td1's arguments are inert.
     */
    'wb block update': (it) => {
      const [io, buffer, block] = args3(it)
      transfer(io, IE_TD_CMD.UPDATE, buffer, IE_TD_BLOCK_BYTES, (block & 0xffff) * IE_TD_BLOCK_BYTES)
    },

    /** Wb Track Read DISKIO,TRACK To BUFFER --- routine 177 ($3ea6) */
    'wb track read': (it) => {
      const [io, track, buffer] = args3(it)
      transfer(io, IE_TD_CMD.READ, buffer, IE_TD_TRACK_BYTES, (track & 0xffff) * IE_TD_TRACK_BYTES)
    },

    /** Wb Track Write DISKIO,BUFFER To TRACK --- routine 178 ($3ede) */
    'wb track write': (it) => {
      const [io, buffer, track] = args3(it)
      transfer(io, IE_TD_CMD.WRITE, buffer, IE_TD_TRACK_BYTES, (track & 0xffff) * IE_TD_TRACK_BYTES)
    },

    /**
     * Wb Track Format DISKIO,BUFFER To TRACK --- routine 175 ($3e36).
     *
     * `move.w #$b,$1c(a1)` is TD_FORMAT, and the length is a whole track, so
     * the buffer has to hold 5,632 bytes.
     */
    'wb track format': (it) => {
      const [io, buffer, track] = args3(it)
      transfer(io, IE_TD_CMD.FORMAT, buffer, IE_TD_TRACK_BYTES, (track & 0xffff) * IE_TD_TRACK_BYTES)
    },
  }
}

export function makeIntuiextendTdFunctions(rt: Runtime): Record<string, Func> {
  const st = (): IeTdState => rt.intuiextend.td
  const i0 = (a: Value[], n: number): number => int(a[n] ?? VI(0)) | 0

  return {
    /**
     * =Wb Td Open(UNIT,FLAGS) --- routine 167 ($3c9a).
     *
     * FLAGS reaches OpenDevice as its flags argument, and Td7 says it "Doit
     * toujours etre a zero". UNIT is the drive: Df0 is 0.
     *
     * The answer is the block, always. OpenDevice's result is never tested,
     * so a unit with no drive behind it answers an address just the same and
     * the first transfer through it is what fails.
     */
    'wb td open': (_, a) => {
      const unit = i0(a, 0) | 0
      const s = st()
      const block = rt.intuiextend.heap.alloc(IE_TD_BLOCK, { clear: true })
      if (block === 0) return VI(0)
      const m = ieMem(rt)
      const port = (block + IE_TD_PORT) >>> 0
      // the MsgPort, exactly the fields $3cda to $3cfe write
      m.setLong(port + O.LN_NAME, 0)
      m.setByte(port + O.LN_PRI, 0)
      m.setByte(port + O.LN_TYPE, NT_MSGPORT)
      m.setByte(port + O.MP_FLAGS, 0)
      m.setByte(port + O.MP_SIGBIT, 0)
      m.setLong(port + O.MP_SIGTASK, 0)
      m.setLong(port + O.MP_MSGLIST, port + O.MP_MSGLIST + 4)
      m.setLong(port + O.MP_MSGLIST + 8, port + O.MP_MSGLIST)
      // and the request. MN_REPLYPORT is left at 0: see the header --- the
      // machine writes the long at an undefined address here
      m.setByte(block + O.LN_TYPE, NT_MESSAGE)
      m.setLong(block + O.MN_REPLYPORT, 0)
      m.setLong(block + O.MN_LENGTH, IE_TD_PORT)
      s.units.set(block >>> 0, unit)
      return VI(block | 0)
    },

    /**
     * =Wb Td Error --- routine 174 ($3e28), the long at workspace+$194.
     *
     * It is DoIO's answer and not io_Error read back off the request, though
     * DoIO returns io_Error and the two agree. Td4 calls it "No de l'erreur
     * lors d'une action sur une disquette"; an empty drive answers 29,
     * TDERR_DiskChanged, and a write to a protected one 28.
     */
    'wb td error': () => VI(st().error | 0),
  }
}
