/**
 * LSerial 2.1, against `LSerial.LIB` disassembled with `extdis lserial-2.1`
 * and against `LserialV21.DOC`, which documents every keyword's arguments and
 * carries the whole `Lser Status` bit table and the XPR contract.
 *
 * The device is the modelled one throughout — no host has granted a port —
 * which is the case the doc itself describes when it warns that a read with no
 * carrier will hang.
 */
import { describe, expect, it } from 'vitest'
import { mustFinish } from '../testing/run'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/source'
import { extensionById } from '../ext/registry'
import { Runtime } from './runtime'

const table = new TokenTable(CORE_TOKENS)
/** slot 11 — "you MUST place LSerial as extension number eleven (11)" */
const LSERIAL_SLOT = 11
const lserial = extensionById('lserial-2.1')!
const extensions = new Map([[LSERIAL_SLOT, lserial.table]])

interface Boot {
  rt: Runtime
  out: () => string
}

function boot(src: string): Boot {
  let printed = ''
  const rt = new Runtime(tokenize(src, table, extensions), table, {
    extensions,
    extBindings: new Map([[LSERIAL_SLOT, lserial]]),
    maxSteps: 200_000,
    onText: (t) => (printed += t),
  })
  return { rt, out: () => printed }
}

function run(src: string, prep?: (rt: Runtime) => void): Boot {
  const b = boot(src)
  prep?.(b.rt)
  mustFinish(b.rt.runHeadless(2_000))
  return b
}

const text = (src: string, prep?: (rt: Runtime) => void): string => run(src, prep).out()
const num = (src: string, prep?: (rt: Runtime) => void): number => Number(text(src, prep).trim())

/** the doc's own example line: 9600 8N1, a 2K buffer and a quarter-second break */
const OPEN = 'Lser Open 9600,8,1,2048,250000,0,0,"serial.device" : '

/** put bytes in the receive queue, as if they had arrived */
const arrive = (rt: Runtime, s: string): void => {
  rt.lserial.dev!.rx.push(...[...s].map((c) => c.charCodeAt(0)))
}

describe('LSerial: opening and closing', () => {
  it('Lser Open takes eight arguments in the doc\'s order', () => {
    const { rt } = run(OPEN)
    const d = rt.lserial.dev!
    expect(d.baud).toBe(9600)
    expect(d.dataBits).toBe(8)
    expect(d.stopBits).toBe(1)
    expect(d.bufLen).toBe(2048)
    expect(d.brkTime).toBe(250_000)
    expect(d.serFlags).toBe(0)
    expect(d.unit).toBe(0)
    expect(d.name).toBe('serial.device')
  })

  it('opening twice is "Serial already open!"', () => {
    // `tst.l $e(a4) / bne` -- the first thing the routine does
    expect(() => run(OPEN + OPEN)).toThrow(/Serial already open/)
  })

  it('an empty device name is "Invalid devicename!"', () => {
    // the length word is checked before OpenDevice is reached
    expect(() =>
      run('Lser Open 9600,8,1,2048,250000,0,0,""'),
    ).toThrow(/Invalid devicename/)
  })

  it('a device this port has no back-end for is "Unable to open device!"', () => {
    expect(() =>
      run('Lser Open 9600,8,1,2048,250000,0,0,"midi.device"'),
    ).toThrow(/Unable to open device/)
  })

  it('Lser Close is safe when nothing is open, and lets Open run again', () => {
    // the whole reason the extension exists: "The main 1.3-bug seems to be
    // when one tries to open the device after closing it"
    expect(() => run('Lser Close')).not.toThrow()
    expect(() => run(OPEN + 'Lser Close : ' + OPEN + 'Lser Close')).not.toThrow()
    expect(run(OPEN + 'Lser Close').rt.lserial.dev).toBe(null)
  })
})

describe('LSerial: sending and receiving', () => {
  it('Lser Send queues the bytes, and an empty string sends nothing', () => {
    const { rt } = run(OPEN + 'Lser Send "AB" : Lser Send ""')
    expect(rt.lserial.dev!.tx).toEqual([65, 66])
  })

  it('Lser Query is what the device has buffered', () => {
    expect(num(OPEN + 'Print Lser Query')).toBe(0)
    const { rt } = run(OPEN + 'Rem')
    arrive(rt, 'hello')
    // re-run in the same Runtime is not possible, so check the queue directly
    expect(rt.lserial.dev!.rx.length).toBe(5)
  })

  it('Lser Read takes everything waiting and leaves the queue empty', () => {
    // the device only exists once Lser Open has run, so the bytes are put in
    // after the first frame rather than in a prep callback
    const b = boot(OPEN + 'Wait 1 : A$=Lser Read : Print "[";A$;"]";Lser Query')
    b.rt.runHeadless(1)
    arrive(b.rt, 'hi')
    mustFinish(b.rt.runHeadless(2_000))
    expect(b.out().trim()).toBe('[hi] 0')
  })

  it('Lser Read of an empty queue is the empty string, not an error', () => {
    expect(text(OPEN + 'Print "[";Lser Read;"]"').trim()).toBe('[]')
  })

  it('Lser Get(0) is "Invalid read size!", and the guard is unsigned', () => {
    // `cmp.l #$0,d3 / bhi` -- zero fails, and a NEGATIVE count passes as a
    // number near four billion, which then waits for that many characters
    expect(() => run(OPEN + 'A$=Lser Get(0)')).toThrow(/Invalid read size/)
    const b = boot(OPEN + 'A$=Lser Get(-1) : Print 1')
    b.rt.runHeadless(20)
    expect(b.out()).toBe('')
  })

  it('Lser Get waits until exactly that many characters have arrived', () => {
    const b = boot(OPEN + 'Wait 1 : A$=Lser Get(3) : Print "[";A$;"]"')
    b.rt.runHeadless(1)
    arrive(b.rt, 'ab')
    b.rt.runHeadless(5)
    expect(b.out()).toBe('') // two is not three
    arrive(b.rt, 'cd')
    mustFinish(b.rt.runHeadless(2_000))
    // exactly three, and the fourth stays in the queue
    expect(b.out().trim()).toBe('[abc]')
    expect(b.rt.lserial.dev!.rx).toEqual([100])
  })

  it('Lser Mulsend sends and Lser Mulcheck says it finished', () => {
    // DEVIATION: the host write is fire-and-forget, so the check is true on
    // the next statement where a real 300-baud line would still be going
    // the doc spells them Mulsend and Mulcheck; the token table's names are
    // `lser mul send` and `lser mul check`, and this port's source tokenizer
    // wants the spaces a tokenised program never had to spell
    const { rt, out } = run(OPEN + 'Lser Mul Send "xyz" : Print Lser Mul Check')
    expect(rt.lserial.dev!.tx).toEqual([120, 121, 122])
    expect(out().trim()).toBe('-1')
  })
})

describe('LSerial: the modem lines', () => {
  it('Lser Status is io_Status, with the active-low lines set when idle', () => {
    // DSR, CTS, CD, RTS and DTR are bits 3 to 7 and active LOW, so a port with
    // nothing on it has all five SET
    expect(num(OPEN + 'Print Lser Status')).toBe(0b1111_1000)
  })

  it('Lcarrier is bit 5 inverted, so an idle port has no carrier', () => {
    expect(num(OPEN + 'Print Lcarrier')).toBe(0)
  })

  it('and it answers true once the line goes active low', () => {
    const b = boot(OPEN + 'Wait 1 : Print Lcarrier')
    b.rt.runHeadless(1)
    b.rt.lserial.dev!.status &= ~0x20
    mustFinish(b.rt.runHeadless(2_000))
    expect(b.out().trim()).toBe('-1')
  })

  it('Lser Baud and Lser Params reach the device', () => {
    const { rt } = run(OPEN + 'Lser Baud 2400 : Lser Params 7,2,1024,500000,3,192')
    const d = rt.lserial.dev!
    expect(d.baud).toBe(2400)
    expect(d.dataBits).toBe(7)
    expect(d.stopBits).toBe(2)
    expect(d.bufLen).toBe(1024)
    expect(d.brkTime).toBe(500_000)
    expect(d.extFlags).toBe(3)
    // $c0 is SERB_PARTY_ON with SERB_PARTY_ODD clear -> even parity
    expect(d.serFlags).toBe(192)
  })

  it('Lser Brk needs a device and sends no bytes', () => {
    const { rt } = run(OPEN + 'Lser Brk')
    expect(rt.lserial.dev!.tx).toEqual([])
    expect(() => run('Lser Brk')).toThrow(/Unable to open device/)
  })
})

describe('LSerial: Linkey$', () => {
  const key = (ch: string, scan: number, shift = 0) => (rt: Runtime) => {
    rt.input.keyQueue.push({ ch, scan, shift })
  }

  it('is the empty string when nothing was pressed', () => {
    expect(text('Print "[";Linkey$;"]"').trim()).toBe('[]')
  })

  it('passes an ordinary character straight through', () => {
    expect(text('Print "[";Linkey$;"]"', key('A', 0x20)).trim()).toBe('[A]')
  })

  it('turns the four cursor keys into ANSI escapes', () => {
    // AMOS's 28-31 to ESC[C, ESC[D, ESC[A and ESC[B -- right, left, up, down
    const esc = (code: number): string =>
      text('Print "[";Linkey$;"]"', key(String.fromCharCode(code), 0x4c)).trim()
    expect(esc(0x1c)).toBe('[\x1b[C]')
    expect(esc(0x1d)).toBe('[\x1b[D]')
    expect(esc(0x1e)).toBe('[\x1b[A]')
    expect(esc(0x1f)).toBe('[\x1b[B]')
  })

  it('folds a letter held with CONTROL down to 1..26', () => {
    // bit 3 of the qualifier byte is raw key $63, CTRL
    expect(text('Print Asc(Linkey$)', key('a', 0x20, 0x08)).trim()).toBe('1')
    expect(text('Print Asc(Linkey$)', key('A', 0x20, 0x08)).trim()).toBe('1')
    expect(text('Print Asc(Linkey$)', key('y', 0x15, 0x08)).trim()).toBe('25')
    expect(text('Print Asc(Linkey$)', key('z', 0x31, 0x08)).trim()).toBe('26')
  })

  it('DEFECT: CONTROL with a SHIFTED Z gives 250 instead of 26', () => {
    // `cmp.b #$5a,d1 / bcc` skips the lowercase fold for 'Z' itself as well as
    // for everything above it, so $5a - $60 wraps
    expect(text('Print Asc(Linkey$)', key('Z', 0x31, 0x08)).trim()).toBe('250')
  })

  it('CONTROL with h is DEL rather than backspace', () => {
    // the one letter singled out, and what a VT100 host expects
    expect(text('Print Asc(Linkey$)', key('h', 0x25, 0x08)).trim()).toBe('127')
  })

  it('a key with no ASCII uses its raw code', () => {
    expect(text('Print Asc(Linkey$)', key('', 0x50)).trim()).toBe('80')
  })
})

describe('LSerial: Lxpr', () => {
  it('XPROPEN answers the empty string, because no xpr library is modelled', () => {
    // the routine is OldOpenLibrary on the name it was given; a machine
    // without xprzmodem.library answers exactly this
    expect(
      text(OPEN + 'Print "[";Lxpr("","","xprzmodem.library",2);"]"').trim(),
    ).toBe('[]')
    // and an empty library name never even reaches OpenLibrary
    expect(text(OPEN + 'Print "[";Lxpr("","","",2);"]"').trim()).toBe('[]')
  })

  it('XPRCLOSE with nothing open returns without touching anything', () => {
    expect(text(OPEN + 'Print "[";Lxpr("","","",3);"]"').trim()).toBe('[]')
  })

  it('XPRREAD and XPRWRITE fall back to the plain serial path', () => {
    // "XPRREAD and XPRWRITE are always checked for first", and with no library
    // asking for HostMon they are Lser Read and Lser Send
    const { rt } = run(OPEN + 'A$=Lxpr("hey","","",6)')
    expect(rt.lserial.dev!.tx).toEqual([104, 101, 121])
    const b = boot(OPEN + 'Wait 1 : Print "[";Lxpr("","","",5);"]"')
    b.rt.runHeadless(1)
    arrive(b.rt, 'in')
    mustFinish(b.rt.runHeadless(2_000))
    expect(b.out().trim()).toBe('[in]')
  })

  it('XPRSEND and XPRSETUP demand a NUL-terminated argument', () => {
    // "WARNING! FILENAME$ MUST BE NULLTERMINATED!" -- and the routine checks
    expect(() => run(OPEN + 'A$=Lxpr("file.txt","","",0)')).toThrow(/NULL-terminated/)
    expect(() => run(OPEN + 'A$=Lxpr("","opts","",4)')).toThrow(/NULL-terminated/)
    expect(() =>
      run(OPEN + 'A$=Lxpr("file.txt"+Chr$(0),"","",0)'),
    ).not.toThrow()
  })

  it('an empty argument is its own error', () => {
    expect(() => run(OPEN + 'A$=Lxpr("","","",0)')).toThrow(/empty argument/)
  })

  it('a function number outside 0..7 is "Non valid XPR-command"', () => {
    expect(() => run(OPEN + 'A$=Lxpr("","","",8)')).toThrow(/Non valid XPR-command/)
  })
})
