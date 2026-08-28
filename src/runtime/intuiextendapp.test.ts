/**
 * IntuiExtend 2.01b, the AppWindow and icon group.
 *
 * Five of the seven go through workbench.library or icon.library, neither of
 * which `../amiga/exec.ts` answers for, so what is pinned is each routine's
 * own no-library arm and the value it means by failure. The two `App Get`
 * keywords touch no library at all: they read an AppMessage, and those tests
 * build one.
 */
import { describe, expect, it } from 'vitest'
import { mustFinish } from '../testing/run'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/source'
import { extensionById } from '../ext/registry'
import { openLibrary } from '../amiga/exec'
import { Runtime } from './runtime'
import { ieMem } from './intuiextendwin'
import { IE_PORT_BASE } from './intuiextendmsg'
import { IE_AM, IE_WBARG_SIZE, IE_WBTYPE } from './intuiextendapp'

const table = new TokenTable(CORE_TOKENS)
const ie = extensionById('intuiextend-2.01b')!
const extensions = new Map([[23, ie.table]])

/** an AppMessage is $36 of fields plus am_Reserved, per `os_wb.guide`:201-214 */
const AM_SIZE = 0x3a

interface Seed {
  /** the names to put in the WBArg array, one per entry */
  args?: string[]
  /** what to write into am_NumArgs, which need not agree with the array */
  numArgs?: number
  /** put the message on a port at IE_PORT_BASE instead of parking it */
  onPort?: boolean
}

function boot(src: string, seed?: Seed): { rt: Runtime; out: () => string } {
  let printed = ''
  const rt = new Runtime(tokenize(src, table, extensions), table, {
    extensions,
    extBindings: new Map([[23, ie]]),
    maxSteps: 200_000,
    onText: (t) => (printed += t),
  })
  if (seed) {
    const ext = rt.intuiextend
    const m = ieMem(rt)
    const names = seed.args ?? []
    const list = ext.heap.alloc(Math.max(1, names.length) * IE_WBARG_SIZE, { clear: true })
    names.forEach((n, i) => {
      if (n === '') return // a WBArg whose wa_Name is NULL
      const p = ext.heap.alloc(n.length + 1, { clear: true })
      for (let j = 0; j < n.length; j++) m.setByte(p + j, n.charCodeAt(j))
      m.setLong(list + i * IE_WBARG_SIZE + 4, p)
    })
    const msg = ext.heap.alloc(AM_SIZE, { clear: true })
    m.setLong(msg + IE_AM.NUMARGS, seed.numArgs ?? names.length)
    m.setLong(msg + IE_AM.ARGLIST, list)
    if (seed.onPort) {
      ext.portState.ports.set(IE_PORT_BASE, { addr: IE_PORT_BASE, name: 'test', pri: 0, queue: [msg] })
    } else {
      ext.portState.lastMsg = msg
    }
  }
  mustFinish(rt.runHeadless(10_000))
  return { rt, out: () => printed }
}

/** AMOS puts a leading space before every non-negative number it prints */
const out = (src: string, seed?: Seed): string =>
  boot(src, seed)
    .out()
    .trim()
    .replace(/\s+/g, ' ')

describe('IntuiExtend 2.01b — neither library is there to open', () => {
  /** routine 51's OpenLibrary and routine 52's both come back empty */
  it('exec answers 0 for workbench.library and icon.library', () => {
    expect(openLibrary('workbench.library')).toBe(0)
    expect(openLibrary('icon.library')).toBe(0)
  })

  /** $4b7a `moveq #$ff,d3`, the arm taken when workspace+$8 is zero */
  it('App Create Icon answers -1', () => {
    expect(out('Print App Create Icon(0,0,"Amos")')).toBe('-1')
  })

  /** and it takes a DiskObject, a MsgPort and a label, in that order */
  it('App Create Icon takes three arguments', () => {
    expect(ie.tokens.find((t) => t.name === 'app create icon')!.spec).toBe('00,0,2')
    expect(out('P=Wb Create Msgport\nPrint App Create Icon(1234,P,"Amos")')).toBe('-1')
  })

  /** $4be2 opens with the same `moveq #$ff,d3` before it tries workspace+$c */
  it('Wb Get Deficon answers -1 for every icon type', () => {
    const src = `For T=${IE_WBTYPE.DISK} To ${IE_WBTYPE.KICK}\nPrint Wb Get Deficon(T);\nNext T`
    expect(out(src)).toBe('-1-1-1-1-1-1-1')
  })

  /** nothing range-checks the type: it goes to the library as it arrives */
  it('Wb Get Deficon does not range-check the type', () => {
    expect(out('Print Wb Get Deficon(0);" ";Wb Get Deficon(99)')).toBe('-1 -1')
  })

  /**
   * The library test at $4c10 comes before the `tst.l (a0)` at $4c16, so an
   * address nothing allocated is never read through.
   */
  it('Wb Free Diskobject does nothing and does not read its argument', () => {
    expect(out('Wb Free Diskobject 12345\nWb Free Diskobject 0\nPrint 7')).toBe('7')
  })

  /** the same shape, on workbench.library's RemoveAppIcon */
  it('App Free Icon does nothing', () => {
    expect(out('App Free Icon 12345\nPrint 7')).toBe('7')
  })

  /**
   * DEFECT: $4cf4 pushes a6 inside the branch and $4cfe pops it outside, so
   * with icon.library absent the machine pops the return address into a6 and
   * the `rts` goes somewhere else entirely. -1 is what $4cda loaded and what
   * the routine means by failure; it is not what a real machine does here.
   */
  it('Wb Get Wbicon answers the -1 it never gets to return', () => {
    expect(out('Print Wb Get Wbicon("Work:thing")')).toBe('-1')
  })

  it('Wb Get Wbicon takes one string', () => {
    expect(ie.tokens.find((t) => t.name === 'wb get wbicon')!.spec).toBe('02')
  })
})

describe('IntuiExtend 2.01b — App Get Numarg and App Get Arglist', () => {
  /**
   * Routine 253 dereferences workspace+$6e4 with no test, so before any
   * `Wb Get Msg` the machine reads absolute $1e. This port answers 0.
   */
  it('answer nothing when no message has been taken', () => {
    expect(out('Print App Get Numarg')).toBe('0')
    expect(out('Print "[";App Get Arglist(1);"]"')).toBe('[]')
  })

  /** `move.l $1e(a0),d3`, am_NumArgs and nothing else */
  it('App Get Numarg is the long at am_NumArgs', () => {
    expect(out('Print App Get Numarg', { args: ['df0:a', 'df0:b', 'df0:c'] })).toBe('3')
  })

  /** it reports the field, not the array: the two need not agree */
  it('App Get Numarg reports the field even when it lies', () => {
    expect(out('Print App Get Numarg', { args: ['one'], numArgs: 99 })).toBe('99')
  })

  /**
   * `asl.w #$3,d0 / subq.w #$4,d0` is NUM * 8 - 4, and a WBArg is eight bytes
   * with wa_Name at +4 (`startup.i`:34-37), so NUM counts from one.
   */
  it('App Get Arglist is one-based', () => {
    const seed = { args: ['Work:first', 'Work:second', 'Work:third'] }
    expect(out('Print App Get Arglist(1)', seed)).toBe('Work:first')
    expect(out('Print App Get Arglist(2)', seed)).toBe('Work:second')
    expect(out('Print App Get Arglist(3)', seed)).toBe('Work:third')
  })

  /** a WBArg with a NULL wa_Name gives the empty string, not a crash */
  it('App Get Arglist survives a NULL name', () => {
    expect(out('Print "[";App Get Arglist(2);"]"', { args: ['a', '', 'c'] })).toBe('[]')
  })

  /** the length comes out of a strlen loop, so any length works */
  it('App Get Arglist copies the whole name', () => {
    const long = 'Work:a/very/long/path/that/keeps/going/name.iff'
    expect(out('Print App Get Arglist(1)', { args: [long] })).toBe(long)
  })

  /**
   * The chain end to end: `Wb Get Msg` (routine 252) parks the message at
   * workspace+$6e4 and these two read it back.
   */
  it('read the message Wb Get Msg parked', () => {
    const src = `R=Wb Get Msg(${IE_PORT_BASE})\nPrint App Get Numarg;" ";App Get Arglist(2)`
    expect(out(src, { args: ['Work:one', 'Work:two'], onPort: true })).toBe('2 Work:two')
  })

  /** and Wb Reply Msg clears it, which puts both back to answering nothing */
  it('Wb Reply Msg puts them back to nothing', () => {
    const src = `R=Wb Get Msg(${IE_PORT_BASE})\nWb Reply Msg\nPrint App Get Numarg`
    expect(out(src, { args: ['Work:one'], onPort: true })).toBe('0')
  })
})
