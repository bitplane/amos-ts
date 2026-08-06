import { describe, expect, it } from 'vitest'
import { mustFinish } from '../testing/run'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { extensionById } from '../ext/registry'
import { Runtime } from './runtime'
import { DUMP_MESSAGES } from './dump'

const table = new TokenTable(CORE_TOKENS)
/**
 * Slot 20, off routine 0's `move.l a0,$228(a5)` and its `moveq #$13,d0`
 * return — where the manifest had 10, from Andrew Burton's list. Version 1.1,
 * off the title string `Dump v1.1 by Alex J. Grant & F.Lionet`, where the
 * manifest had 1.0.
 */
const dump = extensionById('dump-1.0')!

interface Boot {
  rt: Runtime
  out: () => string
}

function boot(src: string): Boot {
  const exts = new Map([[20, dump.table]])
  let printed = ''
  const rt = new Runtime(tokenize(src, table, exts), table, {
    extensions: exts,
    extBindings: new Map([[20, dump]]),
    maxSteps: 200_000,
    onText: (t) => (printed += t),
  })
  return { rt, out: () => printed }
}

function run(src: string): Boot {
  const b = boot(src)
  const r = b.rt.runHeadless(2000)
  mustFinish(r)
  return b
}

describe('Dump 1.1 — the printer half', () => {
  it('=Dump reports "Not a graphics printer." (routines 3/4/5, read by 12)', () => {
    // APPROXIMATED: the engine (routines 9-19, printer.device's graphics
    // dump) is not reproduced. Message 2 is the machine's own answer when the
    // installed driver has no dump support, which is why the message exists
    const b = run('A=Dump\nPrint Dump Err$')
    expect(b.out().trim()).toBe(DUMP_MESSAGES[2])
    expect(b.rt.dump.dumpErr).toBe(2)
  })

  it('=Dump Err$ starts at "Ok." before anything has been dumped (routine 12, $59e)', () => {
    // index 0 walks the list not at all
    expect(run('Print Dump Err$').out().trim()).toBe(DUMP_MESSAGES[0])
  })

  it('=Dump takes three arities (routines 3 $244, 4 $27a, 5 $306)', () => {
    expect(() => run('A=Dump')).not.toThrow()
    expect(() => run('A=Dump(0,0 To 320,256)')).not.toThrow()
    expect(() => run('A=Dump(0,0 To 320,256,1,1,1)')).not.toThrow()
  })

  it('the message list has the author\'s two gaps in it', () => {
    // entries 3 and 5 really are a single space in the binary --- he left
    // holes in the numbering rather than renumbering the codes around them
    expect(DUMP_MESSAGES).toHaveLength(8)
    expect(DUMP_MESSAGES[3]).toBe(' ')
    expect(DUMP_MESSAGES[5]).toBe(' ')
  })
})

describe('Dump 1.1 — the trackdisk half', () => {
  it('the four boolean ones answer 0 with no drive attached (routine 41)', () => {
    // routine 35's `jsr -$1bc(a6)` is OpenDevice on "trackdisk.device", and
    // routine 41 makes the result -1 only when the error is zero
    expect(run('Print Diskin(0)').out().trim()).toBe('0')
    expect(run('Print Writeenable(0)').out().trim()).toBe('0')
    expect(run('Print Secwrite(0,0,512,"x")').out().trim()).toBe('0')
    expect(run('Print Trackformat(0,0)').out().trim()).toBe('0')
  })

  it('=Secread always answers 512 bytes — the exit writes $200 as a constant', () => {
    // `move.w #$200,(a0)` over the buffer's length word, whatever was asked
    expect(run('A$=Secread(0,0,16)\nPrint Len(A$)').out().trim()).toBe('512')
    expect(run('A$=Secread(0,0,512)\nPrint Len(A$)').out().trim()).toBe('512')
  })

  it('=Disk Err$ returns a NUMBER despite the name (routine 34, $9a4)', () => {
    // token spec `0` and `move.l #$0,d2` --- the integer type. It hands back
    // the raw io_Error, and 5 is exec's IOERR_OPENFAIL
    expect(Number(run('A=Diskin(0)\nPrint Disk Err$').out().trim())).toBe(5)
    expect(run('Print Disk Err$').out().trim()).toBe('0')
  })
})
