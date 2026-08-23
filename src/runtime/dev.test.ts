/**
 * The core `Dev *` family (+Lib.s:3300-3385), over the shared device layer in
 * device.ts that IOPorts already drives.
 *
 * What is pinned here is the part a program can see: which names open, what a
 * closed channel does, and that `=Dev Base` gives an address a Doke really
 * reaches — which is the whole point of the family.
 */
import { describe, expect, it } from 'vitest'
import { mustFinish } from '../testing/run'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/source'
import { AmigaFS } from '../amiga/vfs'
import { AdfVolume } from '../amiga/adf'
import { Machine } from '../amiga/machine'
import { Runtime } from './runtime'
import { DEV_MAX, DEV_MODELLED } from './device'

const table = new TokenTable(CORE_TOKENS)

function boot(src: string, fs?: AmigaFS, machine?: Machine): { rt: Runtime; out: () => string } {
  let out = ''
  const rt = new Runtime(tokenize(src, table), table, {
    maxSteps: 500_000,
    ...(fs ? { fs } : {}),
    ...(machine ? { machine } : {}),
    onText: (t) => (out += t),
  })
  return { rt, out: () => out }
}

const run = (src: string, fs?: AmigaFS, machine?: Machine): string => {
  const b = boot(src, fs, machine)
  mustFinish(b.rt.runHeadless(500))
  return b.out().trim()
}

/** a machine with `img` in drive 0, which is what trackdisk.device unit 0 is */
function withDisk(img: Uint8Array): Machine {
  const m = new Machine()
  m.drives[0]!.insert(new AdfVolume(img))
  return m
}

/** the smallest image AdfVolume will mount */
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
  return b
}

describe('Dev Open', () => {
  it('opens the devices this port has a back end for', () => {
    // DEV_MODELLED names the four; anything else would be claiming a device
    // that does nothing
    expect([...DEV_MODELLED.keys()].sort()).toEqual([
      'parallel.device',
      'printer.device',
      'serial.device',
      'trackdisk.device',
    ])
    expect(run('Dev Open 0,"trackdisk.device",64,0,0 : Print 1')).toBe('1')
  })

  it('refuses a device nothing is behind, with the message the source picks', () => {
    // `move.w #145,d3 / moveq #1,d4` gives the whole family ONE message, and
    // AMOS reused the serial device's rather than adding one of its own
    expect(() => run('Dev Open 0,"nosuch.device",64,0,0')).toThrow(/[Ss]erial/)
  })

  it('refuses an empty name and a non-positive length', () => {
    // `Rbeq L_FonCall` on the string and `Rble L_FonCall` on the length
    expect(() => run('Dev Open 0,"",64,0,0')).toThrow(/function call/)
    expect(() => run('Dev Open 0,"trackdisk.device",0,0,0')).toThrow(/function call/)
    expect(() => run('Dev Open 0,"trackdisk.device",-1,0,0')).toThrow(/function call/)
  })

  it('opening a channel twice is error 140, not a silent success', () => {
    // Dev.Open's own `.AOp` arm
    expect(() =>
      run('Dev Open 0,"trackdisk.device",64,0,0 : Dev Open 0,"trackdisk.device",64,0,0'),
    ).toThrow(/already/i)
  })

  it('admits eight channels, which is one more than the table holds', () => {
    // `Dev_Max equ 7` with `Dev_List rs.b 12*Dev_Max`: GetA2 admits 0..7 and
    // Dev.Close sweeps eight, over seven slots
    expect(DEV_MAX).toBe(7)
    expect(run('Dev Open 7,"trackdisk.device",64,0,0 : Print 1')).toBe('1')
    expect(() => run('Dev Open 8,"trackdisk.device",64,0,0')).toThrow(/function call/)
  })
})

describe('Dev Close', () => {
  it('with no argument closes every channel', () => {
    // Dev.Close sweeps Dev_Max down to zero
    const b = boot(
      'Dev Open 0,"trackdisk.device",64,0,0 : Dev Open 1,"trackdisk.device",64,1,0 : Dev Close',
    )
    mustFinish(b.rt.runHeadless(200))
    expect(b.rt.dev.channels.size).toBe(0)
  })

  it('and closing one that is not open is not an error', () => {
    expect(run('Dev Close 3 : Print 1')).toBe('1')
  })
})

describe('Dev Base and Dev Check', () => {
  it('Dev Base gives an address a Doke reaches', () => {
    // the request is real mapped memory: this is what a program does before
    // Dev Do, and if the write did not land the transfer would read zeros
    const out = run(
      'Dev Open 0,"trackdisk.device",64,0,0 : B=Dev Base(0) : Doke B+36,512 : Print Deek(B+36)',
    )
    expect(out).toBe('512')
  })

  it('and answers zero for a channel that was never opened', () => {
    // Dev.GetA2 only bounds-checks; the "not opened" error is Dev.GetIO's,
    // which FnDevBase does not go through
    expect(run('Print Dev Base(4)')).toBe('0')
  })

  it('Dev Check raises on a closed channel rather than reporting not-ready', () => {
    // Dev.CheckIO calls GetIO first, which is error 141
    expect(() => run('Print Dev Check(2)')).toThrow(/not open/i)
  })

  it('and answers -1 for a channel that has issued nothing', () => {
    // the source's own "Simule le TRUE"
    expect(run('Dev Open 0,"trackdisk.device",64,0,0 : Print Dev Check(0)')).toBe('-1')
  })
})

describe('Dev Do against trackdisk', () => {
  it('CMD_READ moves the sector into the buffer the program named', () => {
    const img = disk()
    img[3 * 512] = 0x41
    const out = run(
      [
        'Reserve As Work 10,600',
        'Dev Open 0,"trackdisk.device",64,0,0',
        'B=Dev Base(0)',
        'Loke B+36,512 : Loke B+40,Start(10) : Loke B+44,3*512',
        'Dev Do 0,2',
        'Print Peek(Start(10))',
      ].join('\n'),
      undefined,
      withDisk(img),
    )
    expect(out).toBe('65')
  })

  it('CMD_WRITE moves it back, and the filesystem is told', () => {
    const img = disk()
    run(
      [
        'Reserve As Work 10,600',
        'Poke Start(10),90',
        'Dev Open 0,"trackdisk.device",64,0,0',
        'B=Dev Base(0)',
        'Loke B+36,512 : Loke B+40,Start(10) : Loke B+44,5*512',
        'Dev Do 0,3',
      ].join('\n'),
      undefined,
      withDisk(img),
    )
    expect(img[5 * 512]).toBe(90)
  })

  it('Dev Send leaves the state byte where Dev Check can see it', () => {
    // DEVIATION: every modelled transfer completes instantly, so the state
    // byte is the only observable difference from Dev Do
    const b = boot('Dev Open 0,"trackdisk.device",64,0,0 : Dev Send 0,9')
    mustFinish(b.rt.runHeadless(200))
    expect(b.rt.dev.channels.get(0)!.slot.state).toBe(2)
    const d = boot('Dev Open 0,"trackdisk.device",64,0,0 : Dev Do 0,9')
    mustFinish(d.rt.runHeadless(200))
    expect(d.rt.dev.channels.get(0)!.slot.state).toBe(1)
  })

  it('Dev Abort raises on a closed channel and settles an open one', () => {
    expect(() => run('Dev Abort 1')).toThrow(/not open/i)
    const b = boot('Dev Open 0,"trackdisk.device",64,0,0 : Dev Send 0,9 : Dev Abort 0')
    mustFinish(b.rt.runHeadless(200))
    expect(b.rt.dev.channels.get(0)!.slot.state).toBe(1)
  })
})

describe('Open Port and =Port', () => {
  it('Open Port marks the channel and =Port reads one byte at a time', () => {
    const fs = new AmigaFS()
    const ram = fs.mountMemory('RAM')
    ram.write(['stream'], Uint8Array.of(65, 66))
    fs.currentDir = 'RAM:'
    // `%111` sets bit 2, which is the only thing FnPort checks
    const out = run('Open Port 1,"RAM:stream" : Print Port(1);" ";Port(1);" ";Port(1)', fs)
    // two bytes, then -1 for "no character yet" -- not zero
    expect(out.split(/\s+/).map(Number)).toEqual([65, 66, -1])
  })

  it('refuses a channel that was not opened as a port', () => {
    // `btst #2,FhT(a2)` then L_FilTM -- a file-type mismatch, not a quiet zero
    const fs = new AmigaFS()
    const ram = fs.mountMemory('RAM')
    ram.write(['plain'], Uint8Array.of(1))
    fs.currentDir = 'RAM:'
    expect(() => run('Open In 1,"RAM:plain" : Print Port(1)', fs)).toThrow(/type mismatch/i)
  })

  it('and one that is not open at all', () => {
    expect(() => run('Print Port(3)')).toThrow(/not open/i)
  })
})
