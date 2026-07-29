import { describe, expect, it } from 'vitest'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { extensionById } from '../ext/registry'
import { tokenize } from '../tokens/tokenizer'
import { Runtime } from './runtime'
import { makeIoPortsFunctions } from './ioports'
import { VI, VS } from '../interp/values'
import { fixedClock } from './host'

const table = new TokenTable(CORE_TOKENS)
// IOPorts is slot 6 (`ExtNb equ 6-1`, +IO_Ports.s:46)
const exts = new Map([[6, extensionById('amospro-ioports-2.0')!.table]])

function run(src: string): { rt: Runtime; out: string } {
  let out = ''
  const rt = new Runtime(tokenize(src, table, exts), table, {
    extensions: exts,
    maxSteps: 200_000,
    onText: (t) => (out += t),
  })
  rt.runHeadless(100_000)
  return { rt, out }
}

describe('IOPorts: the shared device layer (Dev.*, +Lib.s:3068-3260)', () => {
  it('touching a closed device is error 141, not a quiet "not ready"', () => {
    // Dev.GetIO (+Lib.s:3178) is reached by every keyword including the
    // Check and Status functions, so a closed port raises rather than
    // reporting. This is the one I would have got wrong from the manual.
    expect(() => run('A=Parallel Status')).toThrow(/Device not opened/)
    expect(() => run('A=Parallel Check')).toThrow(/Device not opened/)
    expect(() => run('A=Printer Check')).toThrow(/Device not opened/)
    expect(() => run('Parallel Send "x"')).toThrow(/Device not opened/)
  })

  it('opening an already-open device is error 140', () => {
    // Dev.Open's .AOp branch: `move.w #140,d0 / Rbra L_GoError`
    expect(() => run('Parallel Open\nParallel Open')).toThrow(/Device already opened/)
    expect(() => run('Printer Open\nPrinter Open')).toThrow(/Device already opened/)
    expect(() => run('Serial Open 0,0\nSerial Open 0,0')).toThrow(/Device already opened/)
  })

  it('closing a device that was never open is not an error', () => {
    expect(() => run('Parallel Close')).not.toThrow()
    expect(() => run('Printer Close')).not.toThrow()
    // and re-opening after a close is fine
    expect(() => run('Parallel Open\nParallel Close\nParallel Open')).not.toThrow()
  })

  it('Check reports TRUE before any request has been issued', () => {
    // Dev.CheckIO: `tst.b 9(a2) / beq -> moveq #-1,d0`, and the caller
    // normalises anything non-zero to -1
    const { out } = run('Parallel Open\nPrint Parallel Check')
    expect(out).toBe('-1\n')
  })
})

describe('IOPorts: Serial (+IO_Ports.s:295-655)', () => {
  it('the channel number is an unsigned compare against NSerial', () => {
    // GetSerial (+IO_Ports.s:636) is `cmp.l #NSerial,d0 / Rbcc L_IOFonc`,
    // so a negative channel fails the same test a too-large one does
    expect(() => run('Serial Open 4,0')).toThrow(/function call/)
    expect(() => run('Serial Open -1,0')).toThrow(/function call/)
    expect(() => run('Serial Open 3,0')).not.toThrow()
  })

  it('physical port 0 gets the French Minitel defaults', () => {
    // "If NOT user-serial (#0), default settings for French MINITEL:
    // 1200/7/1 Stop/EVEN parity" — only the source records this
    const { rt } = run('Serial Open 0,0')
    const p = rt.ioports.serial[0]!.params
    expect([p.baud, p.dataBits, p.stopBits, p.parity]).toEqual([1200, 7, 1, 'even'])
  })

  it('a user port keeps the device defaults instead', () => {
    const { rt } = run('Serial Open 1,1')
    const p = rt.ioports.serial[1]!.params
    expect(p.baud).toBe(9600)
    expect(p.dataBits).toBe(8)
  })

  it('Serial Parity maps 0 to EVEN, not to off', () => {
    // InSerialParity: -1 no parity, 0 EVEN, 1 odd, 2 space, 3 mark. The
    // "0 means none" reading is the obvious one and it is wrong.
    const cases: Array<[number, string]> = [
      [-1, 'none'],
      [0, 'even'],
      [1, 'odd'],
      [2, 'space'],
      [3, 'mark'],
      [4, 'none'], // falls through .par3 with every flag cleared
    ]
    for (const [arg, want] of cases) {
      const { rt } = run(`Serial Open 0,1\nSerial Parity 0,${arg}`)
      expect(rt.ioports.serial[0]!.params.parity, `parity ${arg}`).toBe(want)
    }
  })

  it('Serial Bits sets read and write length together', () => {
    const { rt } = run('Serial Open 0,1\nSerial Bits 0,7,2')
    const p = rt.ioports.serial[0]!.params
    expect([p.dataBits, p.stopBits]).toEqual([7, 2])
  })

  it('Serial Fast is not only a speed change', () => {
    // it clears parity, disables XON/XOFF, forces 8 bits and sets RAD_BOOGIE
    const { rt } = run('Serial Open 0,0\nSerial Fast 0')
    const p = rt.ioports.serial[0]!.params
    expect(p.parity).toBe('none') // the Minitel even parity is undone
    expect(p.dataBits).toBe(8)
    expect(p.xDisabled).toBe(true)
    expect(p.radBoogie).toBe(true)

    const slow = run('Serial Open 0,0\nSerial Fast 0\nSerial Slow 0')
    // Serial Slow clears RAD_BOOGIE and nothing else
    expect(slow.rt.ioports.serial[0]!.params.radBoogie).toBe(false)
    expect(slow.rt.ioports.serial[0]!.params.dataBits).toBe(8)
  })

  it('Serial X takes -1 to mean XON/XOFF off, anything else as the char', () => {
    const off = run('Serial Open 0,1\nSerial X 0,-1')
    expect(off.rt.ioports.serial[0]!.params.xDisabled).toBe(true)
    const on = run('Serial Open 0,1\nSerial X 0,17')
    expect(on.rt.ioports.serial[0]!.params.xDisabled).toBe(false)
    expect(on.rt.ioports.serial[0]!.params.ctlChar).toBe(17)
  })

  it('Serial Send writes the string and leaves the request outstanding', () => {
    // Serial Send uses Dev.SendIO (asynchronous) where the Parallel and
    // Printer equivalents use Dev.DoIO
    const { rt } = run('Serial Open 0,1\nSerial Send 0,"Hi"')
    expect(rt.ioports.serial[0]!.tx).toEqual([72, 105])
    expect(rt.ioports.serial[0]!.dev.state).toBe(2)
  })

  it('Serial Get is -1 on an empty port but Serial Input$ is ""', () => {
    // the asymmetry is in the source: FnSerialGet does `moveq #-1,d3`
    // before the query, FnSerialInput takes the ChVide (empty string) path
    const { out } = run('Serial Open 0,1\nPrint Serial Get(0)\nPrint "["+Serial Input$(0)+"]"')
    expect(out).toBe('-1\n[]\n')
  })

  it('Serial Get takes one byte and Input$ drains the rest', () => {
    // drive the functions directly: the bytes have to arrive between the
    // open and the read, and runHeadless has already ended by then
    const { rt } = run('Serial Open 0,1')
    rt.ioports.serial[0]!.rx.push(65, 66, 67)
    const fns = makeIoPortsFunctions(rt)
    expect(fns['serial get']!(rt.interp, [VI(0)])).toEqual(VI(65))
    expect(fns['serial input$']!(rt.interp, [VI(0)])).toEqual(VS('BC'))
    expect(rt.ioports.serial[0]!.rx).toEqual([])
  })

  it('Serial Close with no argument closes every channel', () => {
    // InSerialClose0 loops NSerial-1 down through the slots, 12 bytes apart
    const { rt } = run('Serial Open 0,1\nSerial Open 2,1\nSerial Close')
    expect(rt.ioports.serial.map((c) => c.dev.open)).toEqual([false, false, false, false])
  })
})

describe('IOPorts: Printer and Parallel (+IO_Ports.s:656-1090)', () => {
  it('Parallel Status reports nothing attached, and polling it is legal', () => {
    // this is what the two corpus programs do thousands of times: open the
    // port, then poll. On a real Amiga parallel.device opens whether or not
    // anything is plugged in, and the status reports the bare port.
    const { out } = run('Parallel Open\nFor I=1 To 3 : Print Parallel Status; : Next I')
    expect(out).toBe(' 0 0 0')
  })

  it('Parallel Send is synchronous where Serial Send is not', () => {
    // InParallelSend ends `Rjmp L_Dev.DoIO`, InSerialSend `Rjmp L_Dev.SendIO`
    const { rt } = run('Parallel Open\nParallel Send "AB"')
    expect(rt.ioports.parallelOut).toEqual([65, 66])
    expect(rt.ioports.parallel.state).toBe(1)
  })

  it('Printer Send writes bytes through', () => {
    const { rt } = run('Printer Open\nPrinter Send "Hi"')
    expect(rt.ioports.printerOut).toEqual([72, 105])
  })

  it('an empty string to Send is error 23', () => {
    // `move.w (a0)+,d0 / Rbeq L_IOFonc` — a zero length is rejected
    expect(() => run('Parallel Open\nParallel Send ""')).toThrow(/function call/)
    expect(() => run('Printer Open\nPrinter Send ""')).toThrow(/function call/)
  })

  it('Out with a length of zero or less is error 23', () => {
    const pre = 'Reserve As Work 10,4\nParallel Open\n'
    expect(() => run(pre + 'Parallel Out Start(10),0')).toThrow(/function call/)
    expect(() => run(pre + 'Parallel Out Start(10),-1')).toThrow(/function call/)
  })

  it('Parallel Out sends a block of memory', () => {
    const { rt } = run(
      ['Reserve As Work 10,4', 'Poke Start(10),65', 'Poke Start(10)+1,66', 'Parallel Open', 'Parallel Out Start(10),2'].join(
        '\n',
      ),
    )
    expect(rt.ioports.parallelOut).toEqual([65, 66])
  })
})

describe('IOPorts: the keywords with no observable result but real state', () => {
  it('Serial Speed and Serial Buf set the request fields', () => {
    // InSerialSpeed writes IO_BAUD, InSerialBuf writes IO_RBUFLEN, and both
    // end in Stpar (SDCMD_SETPARAMS), which is why they need the port open
    const { rt } = run('Serial Open 0,1\nSerial Speed 0,2400\nSerial Buf 0,2048')
    const p = rt.ioports.serial[0]!.params
    expect([p.baud, p.bufLen]).toEqual([2400, 2048])
    // Stpar goes through Dev.DoIO, so the request is left completed
    expect(rt.ioports.serial[0]!.dev.state).toBe(1)
  })

  it('Serial Speed on a closed channel is error 141, not a stored setting', () => {
    // GetSerA1 resolves the channel and then requires it open
    expect(() => run('Serial Speed 0,2400')).toThrow(/Device not opened/)
  })

  it('Serial Out and Printer Out send a block of memory', () => {
    const pre = ['Reserve As Work 10,4', 'Poke Start(10),1', 'Poke Start(10)+1,2'].join('\n')
    const ser = run(`${pre}\nSerial Open 0,1\nSerial Out 0,Start(10),2`)
    expect(ser.rt.ioports.serial[0]!.tx).toEqual([1, 2])
    const prt = run(`${pre}\nPrinter Open\nPrinter Out Start(10),2`)
    expect(prt.rt.ioports.printerOut).toEqual([1, 2])
  })

  it('Serial Out rejects a zero or negative length before touching the port', () => {
    // `move.l d3,d2 / Rbmi L_IOFonc / Rbeq L_IOFonc` — the length is tested
    // first, so this is error 23 even though the channel is fine
    expect(() => run('Serial Open 0,1\nSerial Out 0,0,0')).toThrow(/function call/)
    expect(() => run('Serial Open 0,1\nSerial Out 0,0,-5')).toThrow(/function call/)
  })

  it('Serial Check reports on an open channel', () => {
    const { out } = run('Serial Open 0,1\nPrint Serial Check(0)')
    expect(out).toBe('-1\n')
    expect(() => run('A=Serial Check(0)')).toThrow(/Device not opened/)
  })

  it('Abort leaves the device open with its request settled', () => {
    // Dev.AbortIO calls GetIO first, so aborting a closed device raises
    const ser = run('Serial Open 0,1\nSerial Send 0,"x"\nSerial Abort 0')
    expect(ser.rt.ioports.serial[0]!.dev.open).toBe(true)
    expect(ser.rt.ioports.serial[0]!.dev.state).toBe(1)

    const par = run('Parallel Open\nParallel Abort')
    expect(par.rt.ioports.parallel.open).toBe(true)
    const prt = run('Printer Open\nPrinter Abort')
    expect(prt.rt.ioports.printer.open).toBe(true)

    expect(() => run('Parallel Abort')).toThrow(/Device not opened/)
    expect(() => run('Printer Abort')).toThrow(/Device not opened/)
  })
})

describe('IOPorts: Printer Dump (InPrinterDump0/4/7, +IO_Ports.s:801/812/861)', () => {
  const pre = ['Screen Open 0,320,200,32,Lowres', 'Cls 0', 'Ink 5', 'Bar 10,10 To 59,59', 'Printer Open'].join('\n')

  it('with no arguments it dumps the whole screen', () => {
    // Dump0 sets pwidth/pheight from the screen and special $8c
    const { rt } = run(`${pre}\nPrinter Dump`)
    const p = rt.ioports.pages[0]!
    expect([p.width, p.height, p.srcX, p.srcY]).toEqual([320, 200, 0, 0])
    expect(p.special).toBe(0x8c) // ASPECT | FULLROWS | FULLCOLS
    expect([p.destCols, p.destRows]).toEqual([0, 0])
    expect(p.pixels.length).toBe(320 * 200 * 4)
  })

  it('the corners are an extent, not a second rectangle', () => {
    // Dump2a pops bottom-y, bottom-x, srcY, srcX and then negates:
    // `width = -srcX + bottomX`
    const { rt } = run(`${pre}\nPrinter Dump 40,20 To 140,120`)
    const p = rt.ioports.pages[0]!
    expect([p.srcX, p.srcY, p.width, p.height]).toEqual([40, 20, 100, 100])
  })

  it('four arguments size the page as a 16.16 fraction of the screen covered', () => {
    // half the screen each way -> $7fff in the top word, ~half the page
    const { rt } = run(`${pre}\nPrinter Dump 0,0 To 160,100`)
    const p = rt.ioports.pages[0]!
    expect(p.special).toBe(0xb0) // ASPECT | FRACROWS | FRACCOLS
    expect(p.destCols).toBe(0x7fff_0000)
    expect(p.destRows).toBe(0x7fff_0000)
  })

  it('a region bigger than the screen is error 23, not a fraction over one', () => {
    // both divu.w results are checked with Rbeq L_IOFonc, so a region the
    // screen does not divide into at least once is rejected
    expect(() => run(`${pre}\nPrinter Dump 0,0 To 640,400`)).toThrow(/function call/)
  })

  it('seven arguments are taken verbatim', () => {
    const { rt } = run(`${pre}\nPrinter Dump 10,10 To 60,60,100,200,128`)
    const p = rt.ioports.pages[0]!
    expect([p.width, p.height, p.destCols, p.destRows, p.special]).toEqual([50, 50, 100, 200, 128])
  })

  it('the dump carries the screen pixels through its own palette', () => {
    // the Bar is ink 5 over a cleared screen, so the dumped region should be
    // one solid colour and it should not be the background
    const { rt } = run(`${pre}\nPrinter Dump 20,20 To 50,50`)
    const p = rt.ioports.pages[0]!
    const px = (i: number): number[] => [p.pixels[i * 4]!, p.pixels[i * 4 + 1]!, p.pixels[i * 4 + 2]!]
    const first = px(0)
    for (let i = 1; i < p.width * p.height; i++) expect(px(i)).toEqual(first)

    const bg = run(`${pre}\nPrinter Dump 200,150 To 230,180`)
    expect(px(0)).not.toEqual([
      bg.rt.ioports.pages[0]!.pixels[0]!,
      bg.rt.ioports.pages[0]!.pixels[1]!,
      bg.rt.ioports.pages[0]!.pixels[2]!,
    ])
  })

  it('dumping with the printer closed is error 141', () => {
    expect(() => run('Screen Open 0,320,200,32,Lowres\nPrinter Dump')).toThrow(/Device not opened/)
  })

  it('the page reaches a host that has a printer', () => {
    const seen: number[] = []
    const rt = new Runtime(tokenize(`${pre}\nPrinter Dump`, table, exts), table, {
      extensions: exts,
      maxSteps: 200_000,
      host: { clock: fixedClock(), printerPage: (pg) => seen.push(pg.width, pg.height) },
    })
    rt.runHeadless(100_000)
    expect(seen).toEqual([320, 200])
  })
})
