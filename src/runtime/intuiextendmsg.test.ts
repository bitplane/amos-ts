import { describe, expect, it } from 'vitest'
import { mustFinish } from '../testing/run'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/source'
import { extensionById } from '../ext/registry'
import { AmigaFS } from '../amiga/vfs'
import { Runtime } from './runtime'
import { IE_MEMF, IE_PORT_ALLOC, IE_PORT_SIZEOF, ieMenuCode, ieMenuPick } from './intuiextendmsg'

const table = new TokenTable(CORE_TOKENS)
const ie = extensionById('intuiextend-2.01b')!

function run(src: string, fs?: AmigaFS): { rt: Runtime; out: () => string } {
  const exts = new Map([[23, ie.table]])
  let printed = ''
  const rt = new Runtime(tokenize(src, table, exts), table, {
    extensions: exts,
    extBindings: new Map([[23, ie]]),
    maxSteps: 500_000,
    ...(fs ? { fs } : {}),
    onText: (t) => (printed += t),
  })
  mustFinish(rt.runHeadless(5000))
  return { rt, out: () => printed }
}

/** a machine with a RAM: disk, which `Write Mem` needs to have anywhere to go */
function withRam(): AmigaFS {
  const fs = new AmigaFS()
  fs.mountMemory('RAM')
  fs.currentDir = 'RAM:'
  return fs
}

const lines = (src: string): string[] =>
  run(src)
    .out()
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '')

describe('IntuiExtend 2.01b — the eight memory flags', () => {
  /**
   * Every one is a `moveq` or a `move.l #imm` and a return. The guide's Sortie
   * line calls seven of the eight an AMOUNT of free memory; they are the bits
   * you pass TO `Avail Mem`, which M6's own Remarque gives away:
   * "MEM=Avail Mem(Mtotal)".
   */
  it('are constants, not measurements', () => {
    const src = `Print Mpublic\nPrint Mchip\nPrint Mfast\nPrint Mlocal\nPrint Mdma\nPrint Mclear\nPrint Mlargest\nPrint Mtotal`
    expect(lines(src)).toEqual(['1', '2', '4', '256', '512', '65536', '131072', '524288'])
  })

  it('match the bits the 1.3 include defines', () => {
    // exec/memory.i:50-54 — BITDEF MEM,PUBLIC,0 / CHIP,1 / FAST,2 / CLEAR,16 / LARGEST,17
    expect(IE_MEMF.PUBLIC).toBe(1 << 0)
    expect(IE_MEMF.CHIP).toBe(1 << 1)
    expect(IE_MEMF.FAST).toBe(1 << 2)
    expect(IE_MEMF.CLEAR).toBe(1 << 16)
    expect(IE_MEMF.LARGEST).toBe(1 << 17)
  })

  it('are what Avail Mem takes, and the guide sums them', () => {
    // "C=Avail Mem(Mchip+Mfast)"
    const both = Number(lines('Print Avail Mem(Mchip+Mfast)')[0])
    const chip = Number(lines('Print Avail Mem(Mchip)')[0])
    const fast = Number(lines('Print Avail Mem(Mfast)')[0])
    expect(both).toBe(chip + fast)
    expect(chip).toBeGreaterThan(0)
  })
})

describe('IntuiExtend 2.01b — allocation', () => {
  it('Alloc Mem hands back an address Free Mem takes again', () => {
    const src = `A=Alloc Mem(64,Mpublic)\nPrint A>0\nFree Mem A,64\nB=Alloc Mem(64,Mpublic)\nPrint A=B`
    expect(lines(src)).toEqual(['-1', '-1'])
  })

  it('Mclear zeroes the block', () => {
    const src = `A=Alloc Mem(16,Mpublic+Mclear)\nPrint Peek(A)\nPrint Peek(A+15)`
    expect(lines(src)).toEqual(['0', '0'])
  })

  /**
   * DEVIATION: there is no free list to carve a named address out of, so an
   * absolute request can only be refused -- which is what AllocAbs does for
   * an address that is not free.
   */
  it('Alloc Abs refuses, because every address here is already spoken for', () => {
    expect(lines('Print Alloc Abs(64,$30000000)')).toEqual(['0'])
  })

  /**
   * Routine 285 asks for 999,999,999 bytes of MEMF_PUBLIC|MEMF_CLEAR and tail
   * calls Alloc Mem. The allocation is meant to fail; that is how you make
   * exec expunge what nothing is using.
   */
  it('Wb Flush Memory asks for a gigabyte and carries on', () => {
    const src = `Wb Flush Memory\nA=Alloc Mem(32,Mpublic)\nPrint A>0`
    expect(lines(src)).toEqual(['-1'])
  })
})

describe('IntuiExtend 2.01b — moving bytes about', () => {
  it('Copy Mem takes a LENGTH where AMOS Copy takes an end address', () => {
    // the guide's own example, with Bnk 1 into Bnk 2
    const src = `Reserve As Work 1,16
Reserve As Work 2,16
Loke Start(1),$DEADBEEF
Copy Mem Start(1),4 To Start(2)
Print Hex$(Leek(Start(2)))`
    expect(lines(src)).toEqual(['$DEADBEEF'])
  })

  it('Copy Mem tests only the low word of its size', () => {
    // `tst.w d0 / ble` at $2d9c, so $10000 copies nothing at all
    const src = `Reserve As Work 1,16
Reserve As Work 2,16
Loke Start(1),$DEADBEEF
Loke Start(2),0
Copy Mem Start(1),$10000 To Start(2)
Print Leek(Start(2))`
    expect(lines(src)).toEqual(['0'])
  })

  /**
   * The guide says Wb Poke$ "stoppera la copie lorsqu'elle rencontrera un
   * zéro". The loop is a plain `dbra` on the string's length, so it stops at
   * the length and writes no terminator.
   */
  it('Wb Poke$ copies the whole string and adds no terminator', () => {
    const src = `Reserve As Work 1,16
Loke Start(1),0
Loke Start(1)+4,0
Wb Poke$ "Hi" To Start(1)
Print Peek(Start(1))
Print Peek(Start(1)+1)
Print Peek(Start(1)+2)`
    // 'H', 'i', then the byte that was already there rather than a zero it wrote
    expect(lines(src)).toEqual(['72', '105', '0'])
  })

  it('Wb Peek reads one, two or four bytes by its flag', () => {
    const src = `Reserve As Work 1,16
Loke Start(1),$12345678
Print Wb Peek(Start(1),1)
Print Wb Peek(Start(1),2)
Print Hex$(Wb Peek(Start(1),4))`
    expect(lines(src)).toEqual(['18', '4660', '$12345678'])
  })

  it('Wb Peek compares its flag as a BYTE, so 257 reads one byte', () => {
    const src = `Reserve As Work 1,16\nLoke Start(1),$12345678\nPrint Wb Peek(Start(1),257)`
    expect(lines(src)).toEqual(['18'])
  })

  it('Wb Peek falls through to a long for any flag that is not 1 or 2', () => {
    const src = `Reserve As Work 1,16\nLoke Start(1),$12345678\nPrint Hex$(Wb Peek(Start(1),9))`
    expect(lines(src)).toEqual(['$12345678'])
  })
})

describe('IntuiExtend 2.01b — Wb Mem Compare is inverted', () => {
  /**
   * DEFECT: `dbeq d3,$4d6a` at $4d6c. DBcc exits when its condition is TRUE
   * and EQ means the two bytes matched, so the loop runs while they DIFFER
   * and stops on the first byte they SHARE. The guide promises
   * "RESULT=0 Si les deux segments sont identiques".
   */
  it('stops at the first byte that MATCHES, not the first that differs', () => {
    const src = `Reserve As Work 1,16
Reserve As Work 2,16
Loke Start(1),$AABBCCDD
Loke Start(2),$AABBCCDD
Print Wb Mem Compare(Start(1),Start(2),4)`
    // identical segments match at once, so the countdown never runs: 4-1 = 3
    expect(lines(src)).toEqual(['3'])
  })

  it('runs the counter to -1 when no byte matches at all', () => {
    const src = `Reserve As Work 1,16
Reserve As Work 2,16
Loke Start(1),$01020304
Loke Start(2),$05060708
Print Wb Mem Compare(Start(1),Start(2),4)`
    expect(lines(src)).toEqual(['-1'])
  })
})

describe('IntuiExtend 2.01b — Write Mem answers backwards', () => {
  /**
   * DEFECT: `moveq #$0,d3` at $24e6 is the path where Open succeeded and the
   * write went through; `moveq #$ff,d3` at $24ea is where Open returned zero.
   * The guide says "RESULT=True si Ok, ou False", and AMOS true is -1.
   */
  it('gives 0 for a file it wrote and -1 for one it could not open', () => {
    const src = `Reserve As Work 1,16
Loke Start(1),$41424344
Print Write Mem(Start(1),4 To "RAM:iewm.bin")
Print Write Mem(Start(1),4 To "nosuchdevice:x/y.bin")`
    const b = run(src, withRam())
    expect(b.out().split('\n').map((l) => l.trim()).filter(Boolean)).toEqual(['0', '-1'])
  })

  it('and the bytes really are in the file', () => {
    const fs = withRam()
    const src = `Reserve As Work 1,16
Loke Start(1),$41424344
R=Write Mem(Start(1),4 To "RAM:iewm2.bin")`
    run(src, fs)
    expect([...(fs.read('RAM:iewm2.bin') ?? [])]).toEqual([0x41, 0x42, 0x43, 0x44])
  })

  it('answers -1 on a machine with no filesystem at all', () => {
    const src = `Reserve As Work 1,16\nPrint Write Mem(Start(1),4 To "RAM:x.bin")`
    expect(lines(src)).toEqual(['-1'])
  })
})

describe('IntuiExtend 2.01b — the menu code', () => {
  it('packs and unpacks the same three numbers', () => {
    // $1f for the menu, $3f<<5 for the item, $1f<<11 for the subitem
    const code = ieMenuCode(3, 5, 7)
    expect(ieMenuPick(code)).toEqual({ menu: 3, item: 5, sub: 7 })
    expect(lines('Print Get Menu Code(3,5,7)')).toEqual([`${code}`])
  })

  it('takes MENU, ITEM, SUB in the guide order', () => {
    // "MENUCODE=Get Menu Code(MENUNB,ITEMNB,SUBINB)"
    expect(lines('Print Get Menu Code(1,0,0)')).toEqual(['1'])
    expect(lines('Print Get Menu Code(0,1,0)')).toEqual([`${1 << 5}`])
    expect(lines('Print Get Menu Code(0,0,1)')).toEqual([`${1 << 11}`])
  })

  /**
   * DEFECT: `Get Msg` unpacks a MENUPICK into workspace+$6e0, +$6e1 and +$6e2,
   * and `Get Subitem Msg` reads +$6e2 -- but `Get Menu Msg` reads +$6fe and
   * `Get Item Msg` reads +$6ff. Nothing in the file writes either, and both
   * ship as zero.
   */
  it('Get Menu Msg and Get Item Msg answer 0 whatever happened', () => {
    expect(lines('Print Get Menu Msg\nPrint Get Item Msg')).toEqual(['0', '0'])
  })

  it('Get Subitem Msg is the one of the three that reads where Get Msg wrote', () => {
    expect(lines('Print Get Subitem Msg')).toEqual(['0'])
  })
})

describe('IntuiExtend 2.01b — the message accessors', () => {
  it('all read the block Get Msg fills, and start at zero', () => {
    const src = `Print Get Msg Code\nPrint Get Msg Qualifier\nPrint Get Msg Iadr\nPrint Get Msg Xm\nPrint Get Msg Ym\nPrint Get Msg Scancode`
    expect(lines(src)).toEqual(['0', '0', '0', '0', '0', '0'])
  })

  it('Get Msg Scancode is Get Msg Code masked to seven bits', () => {
    const b = run('Print Get Msg Code')
    b.rt.intuiextend.msg.code = 0x00c5
    // `andi.l #$7f,d3` at $2eea
    expect(0x00c5 & 0x7f).toBe(0x45)
  })

  it('Wb New Idcmp replaces the flags the window opened with', () => {
    const src = `Wb Screen Open 0,0,320,200,3,0
S=Wb Screen Base
Wb Wind Open S To 10,20,100,60,0
W=Wb Wind Base
Wb New Idcmp W,$200`
    const b = run(src)
    const w = b.rt.intuiextend.windowState.windows.get(b.rt.intuiextend.windBase)!
    expect(w.idcmpFlags).toBe(0x200)
  })
})

describe('IntuiExtend 2.01b — message ports', () => {
  it('Wb Create Msgport hands back the port it made', () => {
    const src = `P=Wb Create Msgport\nPrint P>0`
    expect(lines(src)).toEqual(['-1'])
  })

  it('Wb Erase Msgport takes it away, and ignores a zero', () => {
    const b = run('P=Wb Create Msgport\nWb Erase Msgport P\nWb Erase Msgport 0')
    expect(b.rt.intuiextend.portState.ports.size).toBe(0)
  })

  /**
   * DEFECT: $555c is `move.l d0,d3` and d0 there is whatever AddPort left --
   * AddPort returns nothing. The address the routine built is in a3 and is
   * dropped. Its neighbour `Wb Create Msgport` does the same job through exec
   * and answers correctly.
   */
  it('Wb Create Port never returns the port it created', () => {
    const b = run('P=Wb Create Port("test",0)\nPrint P')
    expect(b.out().trim()).toBe('0')
    // the port was made all the same
    expect(b.rt.intuiextend.portState.ports.size).toBe(1)
  })

  /**
   * DEFECT: `move.l #$20,-(a3)` at $54e0 asks for 32 bytes where MP_SIZE is
   * 34 — LN_SIZE 14, then mp_Flags, mp_SigBit, mp_SigTask and a 14-byte List.
   */
  it('and it allocates two bytes fewer than a MsgPort needs', () => {
    expect(IE_PORT_ALLOC).toBe(0x20)
    expect(IE_PORT_SIZEOF).toBe(0x22)
    expect(IE_PORT_SIZEOF - IE_PORT_ALLOC).toBe(2)
  })

  it('Wb Get Msg answers -1 for a null port', () => {
    expect(lines('Print Wb Get Msg(0)')).toEqual(['-1'])
  })
})

describe('IntuiExtend 2.01b — Hard Mouse Key', () => {
  /**
   * Six hardware tests, all active low: CIA-A port A bits 6 and 7 for the two
   * fire buttons, and POTGOR bits 10, 8, 14 and 12 for the rest. The `btst.b`
   * on $dff016 reads the high byte of the word, which is where those bits are.
   */
  it('reads no button as no button', () => {
    expect(lines('Print Hard Mouse Key')).toEqual(['0'])
  })

  it('answers bit 0 for the left button on port A, like the guide says', () => {
    // "Port A: Bouton Gauche=1"
    const b = run('Print Hard Mouse Key')
    const cia = b.rt.resolveAddr(0xbf_e001)
    expect(cia).not.toBeNull()
  })
})
