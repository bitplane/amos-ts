/**
 * IntuiExtend 2.01b, the trackdisk group.
 *
 * The transfers go through the same `devTransfer` the core `Dev *` family
 * uses, which is already pinned by dev.test.ts. What is pinned here is the
 * veneer: the 90-byte block and where the MsgPort sits in it, which argument
 * becomes which io field, and the three places routine 167 leaves something
 * undone.
 */
import { describe, expect, it } from 'vitest'
import { mustFinish } from '../testing/run'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/source'
import { extensionById } from '../ext/registry'
import { AdfVolume } from '../amiga/adf'
import { Machine } from '../amiga/machine'
import { Runtime } from './runtime'
import { IE_TD_BLOCK, IE_TD_BLOCK_BYTES, IE_TD_PORT, IE_TD_TRACK_BYTES } from './intuiextendtd'

const table = new TokenTable(CORE_TOKENS)
const ie = extensionById('intuiextend-2.01b')!
const extensions = new Map([[23, ie.table]])

/** the smallest image AdfVolume will mount, with a mark to read back */
function disk(): Uint8Array {
  const b = new Uint8Array(901_120)
  const v = new DataView(b.buffer)
  b[0] = 0x44
  b[1] = 0x4f
  b[2] = 0x53
  v.setInt32(880 * 512 + 0, 2, false)
  v.setInt32(880 * 512 + 12, 72, false)
  v.setInt32(880 * 512 + 508, 1, false)
  b[880 * 512 + 432] = 4
  // block 3, byte 0: something no boot block would put there
  b[3 * 512] = 0xa5
  b[3 * 512 + 1] = 0x5a
  return b
}

function withDisk(img: Uint8Array, protect = false): Machine {
  const m = new Machine()
  m.drives[0]!.insert(new AdfVolume(img), { writeProtected: protect })
  return m
}

function boot(src: string, machine?: Machine): { rt: Runtime; out: () => string } {
  let printed = ''
  const rt = new Runtime(tokenize(src, table, extensions), table, {
    extensions,
    extBindings: new Map([[23, ie]]),
    maxSteps: 500_000,
    ...(machine ? { machine } : {}),
    onText: (t) => (printed += t),
  })
  mustFinish(rt.runHeadless(2000))
  return { rt, out: () => printed }
}

const vals = (src: string, machine?: Machine): number[] =>
  boot(src, machine)
    .out()
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(Number)

/** open unit 0 and keep the DiskExtIO in D */
const OPEN = 'D=Wb Td Open(0,0)\n'

describe('IntuiExtend 2.01b — Wb Td Open', () => {
  /**
   * `$3ca0 move.l #$5a,d0` and `$3cba addi.l #$38,d0`: one block holding the
   * IOExtTD and, $38 in, the MsgPort. $38 plus MP_SIZE $22 is $5a exactly.
   */
  it('lays the port $38 into a 90-byte block', () => {
    expect([IE_TD_BLOCK, IE_TD_PORT]).toEqual([0x5a, 0x38])
    expect(IE_TD_PORT + 0x22).toBe(IE_TD_BLOCK)
  })

  /** ln_Type 4 is NT_MSGPORT on the port and 5 is NT_MESSAGE on the request */
  it('builds a MsgPort and a Message with the right node types', () => {
    const out = vals(OPEN + 'Print Peek(D+' + (IE_TD_PORT + 8) + ');Peek(D+8)\n', withDisk(disk()))
    expect(out).toEqual([4, 5])
  })

  /**
   * NewList in place: `move.l a1,(a1) / addq.l #$4,(a1)` is lh_Head = &lh_Tail
   * and `move.l a1,$8(a1)` is lh_TailPred = &lh_Head.
   */
  it('NewLists the message list', () => {
    const list = IE_TD_PORT + 0x14
    const out = vals(
      OPEN + 'L=D+' + list + '\nPrint Leek(L)=L+4;" ";Leek(L+8)=L;" ";Leek(L+4)\n',
      withDisk(disk()),
    )
    expect(out).toEqual([-1, -1, 0])
  })

  /**
   * DEFECT: `$3d18 movea.l (a0),a0` where a1 held the port address computed
   * two instructions earlier, so mn_ReplyPort gets the long at an undefined
   * address. The port the routine built is never pointed at, which is the
   * part a program can see.
   */
  it('never points the request at the port it just added', () => {
    const out = vals(OPEN + 'Print Leek(D+$E)=D+' + IE_TD_PORT + '\n', withDisk(disk()))
    expect(out).toEqual([0])
  })

  /** mn_Length is $38, the size of the request part and not of the block */
  it('sets mn_Length to $38', () => {
    expect(vals(OPEN + 'Print Leek(D+$12)\n', withDisk(disk()))).toEqual([0x38])
  })

  /**
   * OpenDevice's result is dropped at $3d46, so a unit with no drive behind
   * it still answers an address. There is no failure value in Td7.
   */
  it('answers an address for a unit that cannot open', () => {
    expect(vals('Print Wb Td Open(9,0)<>0\n', withDisk(disk()))).toEqual([-1])
  })

  /** and two opens are two blocks */
  it('hands out a fresh block each time', () => {
    expect(vals('A=Wb Td Open(0,0)\nB=Wb Td Open(0,0)\nPrint A=B\n', withDisk(disk()))).toEqual([0])
  })

  /** Wb Td Close gives the block back, so the next open can have it */
  it('reuses a closed block', () => {
    expect(vals('A=Wb Td Open(0,0)\nWb Td Close A\nB=Wb Td Open(0,0)\nPrint A=B\n', withDisk(disk()))).toEqual([-1])
  })
})

describe('IntuiExtend 2.01b — reading and writing blocks', () => {
  /** CMD_READ of $200 bytes at BLOCK * $200, into BUFFER */
  it('Wb Block Read moves one sector into the buffer', () => {
    const out = vals(
      OPEN + 'Reserve As Work 10,1024\nB=Start(10)\nWb Block Read D,3 To B\nPrint Peek(B);Peek(B+1);Wb Td Error\n',
      withDisk(disk()),
    )
    expect(out).toEqual([0xa5, 0x5a, 0])
  })

  /** the four io fields the routine pokes, read back off the request */
  it('leaves io_Command, io_Length and io_Offset behind', () => {
    const out = vals(
      OPEN +
        'Reserve As Work 10,1024\nB=Start(10)\nWb Block Read D,3 To B\n' +
        'Print Deek(D+$1C);Leek(D+$24);Leek(D+$2C);" ";Leek(D+$28)=B\n',
      withDisk(disk()),
    )
    expect(out.slice(0, 3)).toEqual([2, IE_TD_BLOCK_BYTES, 3 * IE_TD_BLOCK_BYTES])
    expect(out[3]).toBe(-1)
  })

  /** CMD_WRITE is 3, and the arguments are the other way round from the read */
  it('Wb Block Write takes BUFFER first and BLOCK last', () => {
    const img = disk()
    const b = boot(
      OPEN + 'Reserve As Work 10,1024\nB=Start(10)\nPoke B,17\nWb Block Write D,B To 5\nPrint Deek(D+$1C)\n',
      withDisk(img),
    )
    expect(b.out().trim()).toBe('3')
    expect(img[5 * 512]).toBe(17)
  })

  /**
   * DEFECT: `Wb Block Update` fills in io_Data, io_Length and io_Offset the
   * way a write does and then asks for CMD_UPDATE, which reads none of them.
   * The BLOCK Td1 documents is inert.
   */
  it('Wb Block Update writes nothing to the block it names', () => {
    const img = disk()
    const b = boot(
      OPEN + 'Reserve As Work 10,1024\nB=Start(10)\nPoke B,99\nWb Block Update D,B To 7\nPrint Deek(D+$1C)\n',
      withDisk(img),
    )
    expect(b.out().trim()).toBe('4')
    expect(img[7 * 512]).toBe(0)
  })

  /** TDERR_DiskChanged is 29, which is what an empty drive answers */
  it('answers 29 with no disk in the drive', () => {
    const out = vals(OPEN + 'Reserve As Work 10,1024\nB=Start(10)\nWb Block Read D,3 To B\nPrint Wb Td Error\n')
    expect(out).toEqual([29])
  })

  /** and TDERR_WriteProt is 28 */
  it('answers 28 writing to a protected disk', () => {
    const out = vals(
      OPEN + 'Reserve As Work 10,1024\nB=Start(10)\nWb Block Write D,B To 5\nPrint Wb Td Error\n',
      withDisk(disk(), true),
    )
    expect(out).toEqual([28])
  })
})

describe('IntuiExtend 2.01b — tracks', () => {
  /** $1600 is 5,632: eleven sectors of 512, one cylinder side */
  it('a track is eleven sectors', () => {
    expect(IE_TD_TRACK_BYTES).toBe(11 * 512)
  })

  /** CMD_READ again, but a whole track at TRACK * $1600 */
  it('Wb Track Read takes a track at a time', () => {
    const out = vals(
      OPEN +
        'Reserve As Work 10,8192\nB=Start(10)\nWb Track Read D,0 To B\n' +
        'Print Deek(D+$1C);Leek(D+$24);Peek(B)\n',
      withDisk(disk()),
    )
    // track 0 starts at the boot block, so the first byte is the D of DOS
    expect(out).toEqual([2, IE_TD_TRACK_BYTES, 0x44])
  })

  /** the offset is the track number times a whole track */
  it('seeks by whole tracks', () => {
    const out = vals(
      OPEN + 'Reserve As Work 10,8192\nB=Start(10)\nWb Track Read D,4 To B\nPrint Leek(D+$2C)\n',
      withDisk(disk()),
    )
    expect(out).toEqual([4 * IE_TD_TRACK_BYTES])
  })

  /** `move.w #$b,$1c(a1)` is TD_FORMAT, and it lays the buffer down as a track */
  it('Wb Track Format writes the buffer over the track', () => {
    const img = disk()
    const b = boot(
      OPEN + 'Reserve As Work 10,8192\nB=Start(10)\nPoke B,123\nWb Track Format D,B To 2\nPrint Deek(D+$1C)\n',
      withDisk(img),
    )
    expect(b.out().trim()).toBe('11')
    expect(img[2 * IE_TD_TRACK_BYTES]).toBe(123)
  })

  /** Wb Track Write is the same shape with CMD_WRITE */
  it('Wb Track Write puts the buffer on the track', () => {
    const img = disk()
    const b = boot(
      OPEN + 'Reserve As Work 10,8192\nB=Start(10)\nPoke B,55\nWb Track Write D,B To 3\nPrint Deek(D+$1C)\n',
      withDisk(img),
    )
    expect(b.out().trim()).toBe('3')
    expect(img[3 * IE_TD_TRACK_BYTES]).toBe(55)
  })
})

describe('IntuiExtend 2.01b — the motor', () => {
  /**
   * TD_MOTOR is 9 and the state goes in IO_LENGTH, which routines 169 and 170
   * push onto the argument stack for routine 171 to pop.
   */
  it('Wb Td Motor On and Off write the command and the state', () => {
    const b = boot(OPEN + 'Wb Td Motor On D\nPrint Deek(D+$1C);Leek(D+$24)\n', withDisk(disk()))
    expect(b.out().trim().split(/\s+/).map(Number)).toEqual([9, 1])
    expect(b.rt.machine.drives[0]!.motorOn).toBe(true)
  })

  it('turns the motor back off', () => {
    const b = boot(OPEN + 'Wb Td Motor On D\nWb Td Motor Off D\nPrint Leek(D+$24)\n', withDisk(disk()))
    expect(b.out().trim()).toBe('0')
    expect(b.rt.machine.drives[0]!.motorOn).toBe(false)
  })

  /**
   * Routine 171 ends at DoIO and never stores its answer, so the motor is the
   * one command of the five that leaves `Wb Td Error` reading whatever the
   * last transfer left there.
   */
  it('does not disturb Wb Td Error', () => {
    const out = vals(
      OPEN + 'Reserve As Work 10,1024\nB=Start(10)\nWb Block Read D,3 To B\nWb Td Motor Off D\nPrint Wb Td Error\n',
    )
    expect(out).toEqual([29])
  })
})
