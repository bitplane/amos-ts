import { describe, expect, it } from 'vitest'
import { mustFinish } from '../testing/run'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/source'
import { extensionById } from '../ext/registry'
import { AmigaFS } from '../amiga/vfs'
import { Runtime } from './runtime'
import { ERCOLE_ERRORS } from './ercole'
import { BTN_BLUE, BTN_YELLOW } from '../amiga/controller'

const table = new TokenTable(CORE_TOKENS)
/**
 * Slot 10, and the readme leaves no room: *"Place this extension as extension
 * 10 otherwise it won`t work"*. Routine 0 agrees by returning `moveq #$9,d0`,
 * the slot less one.
 */
const ercole = extensionById('ercole-1.7')!

interface Boot {
  rt: Runtime
  fs: AmigaFS
  out: () => string
}

function boot(src: string, opts: { canExecute?: boolean } = {}): Boot {
  const exts = new Map([[10, ercole.table]])
  const fs = new AmigaFS()
  fs.mountMemory('RAM')
  let printed = ''
  const rt = new Runtime(tokenize(src, table, exts), table, {
    extensions: exts,
    extBindings: new Map([[10, ercole]]),
    maxSteps: 200_000,
    onText: (t) => (printed += t),
    fs,
  })
  if (opts.canExecute) rt.host.process = { execute: () => true }
  return { rt, fs, out: () => printed }
}

function run(src: string, opts: { canExecute?: boolean } = {}): Boot {
  const b = boot(src, opts)
  const r = b.rt.runHeadless(2000)
  mustFinish(r)
  return b
}

const num = (src: string): number => Number(run(src).out().trim())

describe('Ercole 1.7 — the game-port extras', () => {
  it('routine 0 keeps no per-slot data and answers slot 10 less one', () => {
    // it stores nothing into a5 at all: four POTGO bsets and `moveq #$9,d0`
    const { rt } = boot('')
    expect(rt.ercole).toEqual({ prop: false, pot0: 0, pot1: 0 })
  })

  it('Prop On installs the VBL sampler and Prop Off clears it (routines 1 $12c, 2 $13e)', () => {
    // `move.l a0,$4(a5)` is VblRout[1] (+Equ.s:1177), and Prop Off is `clr.l`
    expect(run('Prop On').rt.ercole.prop).toBe(true)
    expect(run('Prop On\nProp Off').rt.ercole.prop).toBe(false)
  })

  it('=Paddle pairs the four numbers onto two registers, odd low and even high (routine 6, $35c)', () => {
    const { rt } = boot('Print Paddle(0);",";Paddle(1);",";Paddle(2);",";Paddle(3)')
    rt.ercole.pot0 = 0x1234
    rt.ercole.pot1 = 0x5678
    let printed = ''
    rt.interp.io.write = (t) => (printed += t)
    rt.runHeadless(2000)
    // paddle 0 = port 0 Y (high), 1 = port 0 X (low), 2 = port 1 Y, 3 = port 1 X
    expect(printed.replace(/\s+/g, '')).toBe('18,52,86,120')
  })

  it('the VBL sampler only runs while Prop On is in force (the hook at $10a)', () => {
    const off = boot('')
    off.rt.ercole.pot0 = 0x1234
    off.rt.frame()
    expect(off.rt.ercole.pot0).toBe(0x1234) // no hook installed: untouched
    const on = run('Prop On')
    on.rt.ercole.pot0 = 0x1234
    on.rt.frame()
    // NOTE: nothing is attached, so the conversion the hook starts never
    // completes and both registers read 0
    expect(on.rt.ercole.pot0).toBe(0)
  })

  it('the six peripheral readers range-check UNSIGNED and raise error 2', () => {
    // `cmp.l #$4,d0 / Rbcc routine 16` and its 2-limit twin: unsigned, so a
    // negative is above the limit too
    for (const src of ['Print Paddle(4)', 'Print Pad Fire(4)', 'Print Paddle(-1)']) {
      expect(() => run(src)).toThrow(ERCOLE_ERRORS[2])
    }
    for (const src of ['Print Ext Joy(2)', 'Print Ext Fire(2)', 'Print Xfire(2)', 'Print Yfire(2)']) {
      expect(() => run(src)).toThrow(ERCOLE_ERRORS[2])
    }
    // and everything inside the range answers rather than raising
    expect(num('Print Paddle(3)')).toBe(0)
    expect(num('Print Pad Fire(3)')).toBe(0)
    expect(num('Print Ext Joy(1)')).toBe(0)
    expect(num('Print Ext Fire(1)')).toBe(0)
    expect(num('Print Xfire(1)')).toBe(0)
    expect(num('Print Yfire(1)')).toBe(0)
    expect(num('Print Xfire(0)')).toBe(0)
    expect(num('Print Yfire(0)')).toBe(0)
  })

  /**
   * Routine 10 reads POTINP bit $e for the right port and $a for the left —
   * pin 9 on each, which is the line `lowlevel.library` reports as BLUE. So
   * Xfire is that button, and it can be pressed now that a controller can say
   * so; before this it answered 0 whatever was held.
   *
   * Yfire is routine 11 on the X pot pins (pin 5), which is the CD32 clock
   * line rather than a button, so it stays 0 — the deviation is unchanged.
   */
  it('Xfire is the second button, off the same pin lowlevel calls blue', () => {
    const b = boot('Print Xfire(1);Xfire(0)')
    b.rt.input.ports[1].buttons = BTN_BLUE
    mustFinish(b.rt.runHeadless(2000))
    // the space before 0 is AMOS's, written before every non-negative number
    expect(b.out().trim()).toBe('-1 0')
  })

  it('Xfire ignores a button the connector has no line for', () => {
    const b = boot('Print Xfire(1)')
    b.rt.input.ports[1].buttons = BTN_YELLOW
    mustFinish(b.rt.runHeadless(2000))
    expect(b.out().trim()).toBe('0')
  })

  it('=Library Open answers a base for a modelled library and errors otherwise (routine 4, $320)', () => {
    // `moveq #$0,d0` --- any version will do
    expect(num('Print Library Open("dos.library")')).toBeGreaterThan(0)
    expect(num('Print Library Open("locale.library")')).toBeGreaterThan(0)
    expect(() => run('Print Library Open("intuition.library")')).toThrow(ERCOLE_ERRORS[1])
  })

  it('Library Close checks nothing at all (routine 5, $346)', () => {
    expect(() => run('A=Library Open("dos.library")\nLibrary Close A')).not.toThrow()
    expect(() => run('Library Close 0')).not.toThrow()
  })

  it('Cli creates the output file and raises error 0 with no shell (routine 3, $14c)', () => {
    // Open(MODE_NEWFILE) happens before Execute, so the file exists either way
    const b = boot('Cli "List DF0:",0,"RAM:out.txt"')
    expect(() => b.rt.runHeadless(2000)).toThrow(ERCOLE_ERRORS[0])
    expect(b.fs.readFile('RAM:out.txt')).not.toBeNull()
  })

  it('an empty output$ uses ram:test and deletes it again', () => {
    // `cmp.w #$0,d4 / bne` substitutes "ram:test" and sets the delete flag
    const b = boot('Cli "List",0,""')
    expect(() => b.rt.runHeadless(2000)).toThrow(ERCOLE_ERRORS[0])
    expect(b.fs.readFile('ram:test')).toBeNull()
  })

  it('a shell that runs the command returns without error', () => {
    expect(() => run('Cli "List",0,"RAM:out.txt"', { canExecute: true })).not.toThrow()
  })

  it('output beginning with the command, or with "Bad ", is error 3', () => {
    // the shell writes the command name or a "Bad ..." complaint into the
    // output file when it could not run it; four bytes are read back and
    // tested two ways
    const b = boot('Cli "List",0,"RAM:out.txt"', { canExecute: true })
    b.rt.host.process = {
      execute: () => {
        b.fs.writeFile('RAM:out.txt', Uint8Array.from([...'List: unknown'].map((c) => c.charCodeAt(0))))
        return true
      },
    }
    expect(() => b.rt.runHeadless(2000)).toThrow(ERCOLE_ERRORS[3])
    const bad = boot('Cli "List",0,"RAM:out.txt"', { canExecute: true })
    bad.rt.host.process = {
      execute: () => {
        bad.fs.writeFile('RAM:out.txt', Uint8Array.from([...'Bad args'].map((c) => c.charCodeAt(0))))
        return true
      },
    }
    expect(() => bad.rt.runHeadless(2000)).toThrow(ERCOLE_ERRORS[3])
  })
})
