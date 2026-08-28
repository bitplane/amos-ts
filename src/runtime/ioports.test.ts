import { describe, expect, it } from 'vitest'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { extensionById } from '../ext/registry'
import { tokenize } from '../tokens/source'
import { Runtime } from './runtime'
import { makeIoPortsFunctions } from './ioports'
import { VI, VS } from '../interp/values'
import { fixedClock, type SerialHost, type SerialLineParams } from '../amiga/host'
import { AMOS_ERRORS } from '../interp/values'
import { ED_RUN_MESSAGES } from '../interp/errors.gen'

const table = new TokenTable(CORE_TOKENS)
// IOPorts is slot 6 (`ExtNb equ 6-1`, +IO_Ports.s:22)
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

describe('IOPorts: the shared device layer (Dev.*, +Lib.s:3020-3269)', () => {
  it('touching a closed device is error 141, not a quiet "not ready"', () => {
    // Dev.GetIO (+Lib.s:3149) is reached by every keyword including the
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

describe('IOPorts: Serial (+IO_Ports.s:269-629)', () => {
  it('the channel number is an unsigned compare against NSerial', () => {
    // GetSerial (+IO_Ports.s:610) is `cmp.l #NSerial,d0 / Rbcc L_IOFonc`,
    // so a negative channel fails the same test a too-large one does
    expect(() => run('Serial Open 4,0')).toThrow(/function call/)
    expect(() => run('Serial Open -1,0')).toThrow(/function call/)
    expect(() => run('Serial Open 3,0')).not.toThrow()
  })

  it('every unit BUT 0 gets the French Minitel defaults', () => {
    // "If NOT user-serial (#0), default settings for French MINITEL:
    // 1200/7/1 Stop/EVEN parity" — and `beq.s .PaSet` SKIPS them for unit 0,
    // which is the machine's own port. These tests quoted that sentence and
    // asserted its opposite until the source was read.
    const { rt } = run('Serial Open 0,1')
    const p = rt.ioports.serial[0]!.params
    expect([p.baud, p.dataBits, p.stopBits, p.parity]).toEqual([1200, 7, 1, 'even'])
  })

  it('unit 0, the user serial port, keeps the device defaults instead', () => {
    const { rt } = run('Serial Open 1,0')
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

  it('the parity dispatch is WORD-sized, so 65536 is EVEN', () => {
    // `tst.w d1` then `cmp.w #1,d1` and the rest: only the low word decides.
    // This port compared the full long and made 65536 'none'
    expect(run('Serial Open 0,1\nSerial Parity 0,65536').rt.ioports.serial[0]!.params.parity).toBe('even')
    expect(run('Serial Open 0,1\nSerial Parity 0,65537').rt.ioports.serial[0]!.params.parity).toBe('odd')
    // ...and the sign test is a word test too, so $8000 reads as negative
    expect(run('Serial Open 0,1\nSerial Parity 0,32768').rt.ioports.serial[0]!.params.parity).toBe('none')
  })

  it('Serial Bits sets read and write length together', () => {
    const { rt } = run('Serial Open 0,1\nSerial Bits 0,7,2')
    const p = rt.ioports.serial[0]!.params
    expect([p.dataBits, p.stopBits]).toEqual([7, 2])
  })

  it('Serial Fast is not only a speed change', () => {
    // it clears parity, disables XON/XOFF, forces 8 bits and sets RAD_BOOGIE
    const { rt } = run('Serial Open 0,1\nSerial Fast 0')
    const p = rt.ioports.serial[0]!.params
    expect(p.parity).toBe('none') // the Minitel even parity is undone
    expect(p.dataBits).toBe(8)
    expect(p.xDisabled).toBe(true)
    expect(p.radBoogie).toBe(true)

    const slow = run('Serial Open 0,1\nSerial Fast 0\nSerial Slow 0')
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

  it('Serial Input$ refuses at String_Max, which is $FFC0 and not 64K', () => {
    // `cmp.l #String_Max,d4 / Rbcc L_IOFonc` (+IO_Ports.s:406) against
    // `String_Max equ $FFC0` (+Equ.s:1139) — AMOS keeps 64 bytes below the
    // word so Demande can round the length even and add its two-byte header
    const { rt } = run('Serial Open 0,1')
    const fns = makeIoPortsFunctions(rt)
    const fill = (n: number): void => {
      const ch = rt.ioports.serial[0]!
      ch.rx.length = 0
      for (let i = 0; i < n; i++) ch.rx.push(65)
    }
    fill(0xffbf)
    expect(fns['serial input$']!(rt.interp, [VI(0)])).toEqual(VS('A'.repeat(0xffbf)))
    fill(0xffc0)
    expect(() => fns['serial input$']!(rt.interp, [VI(0)])).toThrow(/function call/)
  })

  it('Serial Close with no argument closes every channel', () => {
    // InSerialClose0 loops NSerial-1 down through the slots, 12 bytes apart
    const { rt } = run('Serial Open 0,1\nSerial Open 2,1\nSerial Close')
    expect(rt.ioports.serial.map((c) => c.dev.open)).toEqual([false, false, false, false])
  })
})

describe('IOPorts: Printer and Parallel (+IO_Ports.s:630-1064)', () => {
  it('Parallel Status reports nothing attached, and polling it is legal', () => {
    // this is what the two corpus programs do thousands of times: open the
    // port, then poll. On a real Amiga parallel.device opens whether or not
    // anything is plugged in, and the status reports the bare port.
    const { out } = run('Parallel Open\nFor I=1 To 3 : Print Parallel Status; : Next I')
    expect(out).toBe(' 0 0 0')
  })

  it('PARALLEL alone is synchronous — serial and printer are not', () => {
    // InParallelSend/Out end `Rjmp L_Dev.DoIO` (+IO_Ports.s:1018, :1060);
    // InSerialSend and InPrinterSend both end `Rjmp L_Dev.SendIO` (:369,
    // :741). This port had the printer on DoIO, and device.ts's own comment
    // asserted the printer was synchronous "like the parallel port"
    const par = run('Parallel Open\nParallel Send "AB"')
    expect(par.rt.ioports.parallelOut).toEqual([65, 66])
    expect(par.rt.ioports.parallel.state).toBe(1) // DoIO

    const prt = run('Printer Open\nPrinter Send "Hi"')
    expect(prt.rt.ioports.printerOut).toEqual([72, 105])
    expect(prt.rt.ioports.printer.state).toBe(2) // SendIO

    const ser = run('Serial Open 0,1\nSerial Send 0,"Hi"')
    expect(ser.rt.ioports.serial[0]!.dev.state).toBe(2) // SendIO
  })

  it('an empty string to Send is error 23', () => {
    // `move.w (a0)+,d0 / Rbeq L_IOFonc` — a zero length is rejected
    expect(() => run('Parallel Open\nParallel Send ""')).toThrow(/function call/)
    expect(() => run('Printer Open\nPrinter Send ""')).toThrow(/function call/)
  })

  it('only Serial Out refuses a negative length; the other two take it', () => {
    // `move.l d3,d2 / Rbmi / Rbeq` on InSerialOut (+IO_Ports.s:362) against
    // the bare `Rbeq` on InPrinterOut (:735) and InParallelOut (:1038)
    const pre = 'Reserve As Work 10,4\nParallel Open\nPrinter Open\n'
    expect(() => run(pre + 'Parallel Out Start(10),0')).toThrow(/function call/)
    expect(() => run(pre + 'Printer Out Start(10),0')).toThrow(/function call/)
    expect(() => run(pre + 'Parallel Out Start(10),-1')).not.toThrow()
    expect(() => run(pre + 'Printer Out Start(10),-1')).not.toThrow()
    // and nothing is written, because there is no block to write
    const { rt } = run(pre + 'Parallel Out Start(10),-1')
    expect(rt.ioports.parallelOut).toEqual([])

    const ser = 'Reserve As Work 10,4\nSerial Open 0,1\n'
    expect(() => run(ser + 'Serial Out 0,Start(10),0')).toThrow(/function call/)
    expect(() => run(ser + 'Serial Out 0,Start(10),-1')).toThrow(/function call/)
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

  it('Abort is the one Dev entry a closed device does not raise on', () => {
    // Dev.AbortIO reads the open byte itself (`tst.b 8(a2) / beq.s .Skip`,
    // +Lib.s:3227) instead of calling GetIO, and it never writes 9(a2) --
    // so SendIO's state of 2 survives the abort rather than settling to 1
    const ser = run('Serial Open 0,1\nSerial Send 0,"x"\nSerial Abort 0')
    expect(ser.rt.ioports.serial[0]!.dev.open).toBe(true)
    expect(ser.rt.ioports.serial[0]!.dev.state).toBe(2)

    const par = run('Parallel Open\nParallel Abort')
    expect(par.rt.ioports.parallel.open).toBe(true)
    const prt = run('Printer Open\nPrinter Abort')
    expect(prt.rt.ioports.printer.open).toBe(true)

    expect(() => run('Parallel Abort')).not.toThrow()
    expect(() => run('Printer Abort')).not.toThrow()
    expect(() => run('Serial Abort 0')).not.toThrow()
    // GetSerial's range check is untouched by any of that
    expect(() => run('Serial Abort 4')).toThrow(/illegal function call/i)
  })
})

describe('IOPorts: Printer Dump (InPrinterDump0/4/7, +IO_Ports.s:775/786/835)', () => {
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

  it('the SCREEN is looked at before the printer', () => {
    // InPrinterDump0 is `Rbsr L_GetScr` (+IO_Ports.s:778) and only reaches
    // Dump's Dev.GetIO afterwards, so with neither one open it is 47
    expect(() => run('Screen Close 0\nPrinter Dump')).toThrow(/screen not opened/i)
    expect(() => run('Screen Close 0\nPrinter Dump 0,0 To 100,100')).toThrow(/screen not opened/i)
  })

  it('the coordinates are WORDS, and the extent is word arithmetic', () => {
    // Dump2a steps `lea 2(a3),a3` past the high half of every long before
    // `move.w (a3)+,(a0)`, so 70000 arrives as 4464
    const { rt } = run(`${pre}\nPrinter Dump 0,0 To 70000,100,1,1,0`)
    expect(rt.ioports.pages[0]!.width).toBe(70_000 - 65_536)
  })

  it('only the four-argument form checks the extent', () => {
    // the seven-argument form runs straight into Dump, which has no test
    expect(() => run(`${pre}\nPrinter Dump 60,60 To 10,10`)).toThrow(/function call/)
    const { rt } = run(`${pre}\nPrinter Dump 60,60 To 10,10,1,1,0`)
    const p = rt.ioports.pages[0]!
    expect([p.width, p.height]).toEqual([-50, -50])
    expect(p.pixels.length).toBe(0)
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

describe('IOPorts: a real host port (Host.serial)', () => {
  /** a stand-in for Web Serial: records writes, replays canned reads */
  function stubHost(): {
    host: SerialHost
    written: number[]
    incoming: number[]
    params: SerialLineParams[]
    closed: number
    units: number[]
  } {
    const written: number[] = []
    const incoming: number[] = []
    const params: SerialLineParams[] = []
    const units: number[] = []
    const rec = { closed: 0 }
    const host: SerialHost = {
      open(unit, p) {
        units.push(unit)
        params.push(p)
        return {
          write: (b) => written.push(...b),
          read: () => incoming.splice(0, incoming.length),
          setParams: (q) => params.push(q),
          close: () => (rec.closed += 1),
        }
      },
    }
    return {
      host,
      written,
      incoming,
      params,
      units,
      get closed() {
        return rec.closed
      },
    }
  }

  function withHost(src: string, s: ReturnType<typeof stubHost>): Runtime {
    const rt = new Runtime(tokenize(src, table, exts), table, {
      extensions: exts,
      maxSteps: 200_000,
      host: { clock: fixedClock(), serial: s.host },
    })
    rt.runHeadless(100_000)
    return rt
  }

  it('Serial Open asks for the physical unit and hands over settled parameters', () => {
    const s = stubHost()
    withHost('Serial Open 0,1', s)
    // the Minitel defaults must already be applied — the host is asked last,
    // so it is never told 9600 and then corrected
    expect(s.units).toEqual([1])
    expect(s.params[0]).toMatchObject({ baud: 1200, dataBits: 7, stopBits: 1, parity: 'even' })
  })

  it('writes reach the port and reads come back from it', () => {
    const s = stubHost()
    const rt = withHost('Serial Open 0,1\nSerial Send 0,"Hi"', s)
    expect(s.written).toEqual([72, 105])
    // and what the port has received turns up in Serial Input$
    s.incoming.push(79, 75)
    const fns = makeIoPortsFunctions(rt)
    expect(fns['serial input$']!(rt.interp, [VI(0)])).toEqual(VS('OK'))
  })

  it('Serial Get takes one byte of what the port delivered', () => {
    const s = stubHost()
    const rt = withHost('Serial Open 0,1', s)
    s.incoming.push(1, 2, 3)
    const fns = makeIoPortsFunctions(rt)
    expect(fns['serial get']!(rt.interp, [VI(0)])).toEqual(VI(1))
    // the rest stay queued — the port was drained in one go, as SDCMD_QUERY
    // reports everything waiting
    expect(rt.ioports.serial[0]!.rx).toEqual([2, 3])
  })

  it('every parameter keyword pushes the settings at the port (Stpar)', () => {
    const s = stubHost()
    withHost('Serial Open 0,1\nSerial Speed 0,2400\nSerial Bits 0,7,2\nSerial Fast 0', s)
    // one from the open, then one per parameter keyword
    expect(s.params.length).toBe(4)
    expect(s.params[1]).toMatchObject({ baud: 2400 })
    expect(s.params[2]).toMatchObject({ dataBits: 7, stopBits: 2 })
    expect(s.params[3]).toMatchObject({ dataBits: 8, parity: 'none' })
  })

  it('Serial Close releases the port, and closing all releases each', () => {
    const s = stubHost()
    withHost('Serial Open 0,1\nSerial Close 0', s)
    expect(s.closed).toBe(1)

    const t = stubHost()
    withHost('Serial Open 0,1\nSerial Open 2,1\nSerial Close', t)
    expect(t.closed).toBe(2)
  })

  it('a host with no port granted still opens, on the modelled port', () => {
    // this is the important one: on a real Amiga serial.device opens with
    // nothing in the socket, so a refused port must not fail Serial Open
    const none: SerialHost = { open: () => null }
    const rt = new Runtime(tokenize('Serial Open 0,1\nSerial Send 0,"x"', table, exts), table, {
      extensions: exts,
      maxSteps: 200_000,
      host: { clock: fixedClock(), serial: none },
    })
    expect(() => rt.runHeadless(100_000)).not.toThrow()
    expect(rt.ioports.serial[0]!.dev.open).toBe(true)
    expect(rt.ioports.serial[0]!.port).toBe(null)
    expect(rt.ioports.serial[0]!.tx).toEqual([120]) // still recorded
  })
})

describe('Err$ resolves device errors at their own number', () => {
  /**
   * `ED_RUN_MESSAGES` is the editor's message block and its index IS the AMOS
   * error number, all the way through. The device range is pinned here because
   * it is the range that proved it: +IO_Ports.s opens serial with `move.w
   * #145,d3` and parallel with `#171`, and those are the first message of each
   * device's block.
   *
   * This block used to assert the opposite — that the device codes ran 14
   * ahead of their index — and the +14 it asserted was a correction fitted to
   * the wrong fault. The generator was dropping fourteen records from the
   * middle of the block, so the device messages really did sit fourteen rows
   * low; adding 14 back put them right and left everything between wrong. See
   * AMOS_ERRORS in ../interp/values.ts.
   */
  it('keeps the core range indexed directly', () => {
    expect(AMOS_ERRORS[1]).toBe('RETURN without GOSUB')
    expect(AMOS_ERRORS[23]).toBe('Illegal function call')
    expect(AMOS_ERRORS[24]).toBe('Out of memory')
  })

  it('and the device block, at the numbers the library passes around', () => {
    // Dev.GetIO's two, +Lib.s:3020-3269
    expect(AMOS_ERRORS[140]).toBe('Device already opened')
    expect(AMOS_ERRORS[141]).toBe('Device not opened')
    // the two the source names outright
    expect(AMOS_ERRORS[145]).toBe('Serial device already in use')
    expect(AMOS_ERRORS[171]).toBe('Parallel device already used')
  })

  it('has every record the block declares, which is what keeps the index true', () => {
    // 201 EdT records in .Error1, index 0 being the empty one it opens with.
    // A SHORT BLOCK IS THE FAILURE MODE: nothing about a dropped record looks
    // wrong on its own, it just moves every message after it down one.
    expect(ED_RUN_MESSAGES.length).toBe(201)
  })

  it('and the fourteen records that used to be missing entirely', () => {
    // `EdT 80,<Directory not found>  204` and its thirteen neighbours, each
    // carrying the AmigaDOS code it maps from after the closing bracket
    expect(AMOS_ERRORS[80]).toBe('Directory not found')
    expect(AMOS_ERRORS[81]).toBe('File not found')
    expect(AMOS_ERRORS[93]).toBe('No disc in drive')
    // and the record straight after them, which is what Explode's L_IOError
    // raises and what the block used to number 80
    expect(AMOS_ERRORS[94]).toBe('I/O error')
  })

  it('leaves no core message stranded at a device code', () => {
    // the messages that used to answer these are the bug, not the fix
    expect(AMOS_ERRORS[145]).not.toBe('Break detected')
    expect(AMOS_ERRORS[171]).not.toBe('No Arexx message waiting')
  })
})
