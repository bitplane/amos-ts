/**
 * MAXS Door Handler 0.20 — twenty-one keywords, one message.
 *
 * The tests come in two halves because the extension does. Without a BBS
 * every keyword takes its `beq.s Ln_NoPort` arm, which is a real branch of
 * the author's code and the one a door hits when MAX's is not running; with
 * the stand-in BBS below the whole protocol runs, and what is asserted is the
 * 106 bytes that reach it — the command number, the two words, and where the
 * string sits.
 *
 * The stand-in is deliberately dumb. It records the message, writes a carrier
 * state over `Command` and whatever the test wants over `Data` and `String`,
 * and that is all a BBS is from this side. Making it clever would test the
 * double rather than the extension.
 */
import { describe, expect, it } from 'vitest'
import { mustFinish } from '../testing/run'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { extensionById } from '../ext/registry'
import type { PortHandle } from '../amiga/host'
import { Runtime } from './runtime'
import { CARRIER_DROPPED, DOOR_COMMAND, DOOR_DATA, DOOR_MSG_LENGTH, DOOR_STRING } from './maxsdoor'

const table = new TokenTable(CORE_TOKENS)
/** `ExtNb equ 16-1` — the author's own equate, the first line of his source */
const maxs = extensionById('maxsdoor-0.20')!

/** what the BBS saw, and what it will answer with */
interface Bbs {
  sent: Uint8Array[]
  /** written over `Command` in every reply, as MAX's writes the carrier state */
  carrier: number
  /** written over `Data`, for the keywords that read it back */
  data: number
  /** written into `String`, for the three that copy it out */
  text: string
  handle: PortHandle
}

function bbs(): Bbs {
  const b: Bbs = {
    sent: [],
    carrier: 1,
    data: 0,
    text: '',
    handle: {
      send(msg) {
        b.sent.push(msg.slice())
        msg[DOOR_COMMAND] = (b.carrier >> 8) & 0xff
        msg[DOOR_COMMAND + 1] = b.carrier & 0xff
        msg[DOOR_DATA] = (b.data >> 8) & 0xff
        msg[DOOR_DATA + 1] = b.data & 0xff
        msg.fill(0, DOOR_STRING, DOOR_MSG_LENGTH)
        for (let i = 0; i < b.text.length && DOOR_STRING + i < DOOR_MSG_LENGTH; i++) {
          msg[DOOR_STRING + i] = b.text.charCodeAt(i) & 0xff
        }
      },
    },
  }
  return b
}

let printed = ''

/** `node` present means MAX's is running and published `DoorControl<node>` */
function boot(src: string, b?: Bbs, node = 1): Runtime {
  const exts = new Map([[16, maxs.table]])
  printed = ''
  return new Runtime(tokenize(src, table, exts), table, {
    extensions: exts,
    extBindings: new Map([[16, maxs]]),
    maxSteps: 200_000,
    onText: (t) => (printed += t),
    ...(b
      ? { host: { ports: { find: (n: string) => (n === `DoorControl${node}` ? b.handle : undefined) } } }
      : {}),
  })
}

function run(src: string, b?: Bbs, node = 1): Runtime {
  const rt = boot(src, b, node)
  mustFinish(rt.runHeadless(2000))
  return rt
}

const out = (): string => printed.trim()

/** the last message's Command / Data / String */
const cmd = (b: Bbs, i = 0): number => (b.sent[i]![DOOR_COMMAND]! << 8) | b.sent[i]![DOOR_COMMAND + 1]!
const dat = (b: Bbs, i = 0): number => (b.sent[i]![DOOR_DATA]! << 8) | b.sent[i]![DOOR_DATA + 1]!
function txt(b: Bbs, i = 0): string {
  const m = b.sent[i]!
  let s = ''
  for (let p = DOOR_STRING; p < DOOR_MSG_LENGTH && m[p] !== 0; p++) s += String.fromCharCode(m[p]!)
  return s
}

const OPEN = 'A=M_Portopen(1)\n'

describe('MAXS Door 0.20 — with no BBS running', () => {
  it('M_Portopen answers 0, which is FindPort finding nothing (L1)', () => {
    run('Print M_Portopen(1)')
    expect(out()).toBe('0')
  })

  it('the port name is the node digit written over offset 11 of "DoorControl"', () => {
    expect(run('A=M_Portopen(3)').maxsDoor.name).toBe('DoorControl3')
    // `add.l #48,d0` with no range check, so 10 makes a colon and -1 a slash.
    // Both are legal port names and both simply find nothing
    expect(run('A=M_Portopen(10)').maxsDoor.name).toBe('DoorControl:')
    expect(run('A=M_Portopen(-1)').maxsDoor.name).toBe('DoorControl/')
  })

  it('every other keyword takes its Ln_NoPort arm and answers 0 without sending', () => {
    const b = bbs()
    const src = [
      'Print M_Bbstext("hello")',
      'Print M_Modemchar(65)',
      'Print M_Twituser',
      'Print M_Checkfile("s:x")',
      'Print M_Getusernum(1)',
      'Print M_Getkey',
      'Print M_Dofunction(1,2,"x")',
    ].join('\n')
    run(src, b)
    // the BBS exists but M_Portopen was never called, so MAXDoorPort is null
    expect(out().split('\n').map((s) => s.trim())).toEqual(['0', '0', '0', '0', '0', '0', '0'])
    expect(b.sent).toEqual([])
  })

  it('M_Portclose is clean after a failed open: the two tests are separate (L2_TryReply)', () => {
    expect(() => run('A=M_Portopen(1)\nM_Portclose')).not.toThrow()
  })
})

describe('MAXS Door 0.20 — the protocol', () => {
  it('M_Portopen finds the port and answers non-zero', () => {
    const b = bbs()
    run('Print M_Portopen(1)', b)
    expect(out()).toBe('-1')
  })

  it('a node the BBS did not publish still finds nothing', () => {
    run('Print M_Portopen(2)', bbs(), 1)
    expect(out()).toBe('0')
  })

  it('the three text keywords are three command numbers on one message (L3, L4)', () => {
    const b = bbs()
    run(`${OPEN}A=M_Bbstext("both")\nA=M_Localtext("sysop")`, b)
    expect([cmd(b, 0), txt(b, 0), dat(b, 0)]).toEqual([1, 'both', 0])
    expect([cmd(b, 1), txt(b, 1)]).toEqual([2, 'sysop'])
  })

  it('the three char keywords put the character in Data, not the string (L5, L6, L7)', () => {
    const b = bbs()
    run(`${OPEN}A=M_Modemchar(65)\nA=M_Screenchar(66)\nA=M_Bbschar(67)`, b)
    expect(b.sent.map((_, i) => [cmd(b, i), dat(b, i)])).toEqual([
      [3, 65],
      [4, 66],
      [5, 67],
    ])
  })

  it('a string is capped at 79 characters and NUL-terminated (`cmpi.w #78,d0` after `subq.w #1`)', () => {
    const b = bbs()
    run(`${OPEN}A=M_Bbstext(String$("x",120))`, b)
    expect(txt(b).length).toBe(79)
    expect(b.sent[0]![DOOR_STRING + 79]).toBe(0)
  })

  it('every keyword returns the carrier state the reply wrote over Command', () => {
    const b = bbs()
    b.carrier = CARRIER_DROPPED
    run(`${OPEN}Print M_Bbstext("x")`, b)
    expect(out()).toBe('20')
  })

  it('Prompt and SPrompt differ by one command, and Data is the input length capped at 79', () => {
    const b = bbs()
    b.text = 'typed'
    run(`${OPEN}A$=Space$(20)\nPrint M_Prompttext("Name? ",A$)\nB$=Space$(20)\nPrint M_Sprompttext("Pass? ",B$)`, b)
    expect([cmd(b, 0), dat(b, 0), txt(b, 0)]).toEqual([6, 20, 'Name? '])
    expect([cmd(b, 1), dat(b, 1), txt(b, 1)]).toEqual([7, 20, 'Pass? '])
    // the token spec is `02,2` --- an INTEGER result --- so both answer the
    // carrier state, and the reply text lands in the message
    expect(out().split('\n').map((s) => s.trim())).toEqual(['1', '1'])
  })

  it('M_Getchar stops at the first NUL, which is its dbne against the others dbra (L10_InpLoop)', () => {
    const b = bbs()
    b.text = 'Y'
    const rt = run(`${OPEN}A$=Space$(10)\nPrint M_Getchar("[YN] ",A$)`, b)
    expect(cmd(b)).toBe(8)
    expect(out()).toBe('1')
    // 'Y' then the NUL `dbne` stopped on, left in the message where the
    // machine would have copied it into A$ --- see the APPROXIMATED note
    expect(rt.maxsDoor.msg[DOOR_STRING]).toBe('Y'.charCodeAt(0))
    expect(rt.maxsDoor.msg[DOOR_STRING + 1]).toBe(0)
  })

  it('M_Getchar never sets Data, so MAX\'s is handed back what its own last reply left', () => {
    const b = bbs()
    b.data = 5
    run(`${OPEN}A=M_Modemchar(77)\nA$=Space$(4)\nA=M_Getchar("?",A$)`, b)
    // Modemchar wrote 77 and the reply wrote 5 over it; Getchar sets Command
    // and nothing else, so 5 is what goes back out
    expect(dat(b, 0)).toBe(77)
    expect(dat(b, 1)).toBe(5)
  })

  it('the file keywords carry the constants the author fixed (L13, L14)', () => {
    const b = bbs()
    b.data = 7
    run(`${OPEN}Print M_Checkfile("s:a")\nPrint M_Editfile("s:b")\nPrint M_Showfile("s:c")`, b)
    expect([cmd(b, 0), dat(b, 0)]).toEqual([11, 1])
    expect([cmd(b, 1), dat(b, 1)]).toEqual([12, 99])
    expect([cmd(b, 2), txt(b, 2)]).toEqual([10, 's:c'])
    // Checkfile and Editfile answer Data; Showfile answers the carrier
    expect(out().split('\n').map((s) => s.trim())).toEqual(['7', '7', '1'])
  })

  it('a dropped carrier wins over Data in the four that read it back', () => {
    const b = bbs()
    b.carrier = CARRIER_DROPPED
    b.data = 7
    run(`${OPEN}Print M_Getusernum(2)\nPrint M_Checkfile("x")`, b)
    expect(out().split('\n').map((s) => s.trim())).toEqual(['20', '20'])
  })

  it('M_Dofunction adds 100 to the function number and does NOT cap its path (L19)', () => {
    const b = bbs()
    run(`${OPEN}A=M_Dofunction(5,9,"path")`, b)
    expect([cmd(b), dat(b), txt(b)]).toEqual([105, 9, 'path'])
    // DEFECT: no `cmpi.w #78,d0` here, so a long path runs off String. It is
    // bounded by the 106 bytes rather than by nothing, and the message still
    // ends where a message ends
    const long = bbs()
    run(`${OPEN}A=M_Dofunction(1,0,String$("z",200))`, long)
    expect(long.sent[0]!.length).toBe(DOOR_MSG_LENGTH)
    expect(long.sent[0]![DOOR_MSG_LENGTH - 1]).toBe('z'.charCodeAt(0))
  })

  it('M_Changeuserdata puts the LONG in String and the type in Data (L20)', () => {
    const b = bbs()
    run(`${OPEN}A=M_Changeuserdata(3,$12345678)`, b)
    expect([cmd(b), dat(b)]).toEqual([200, 3])
    expect(Array.from(b.sent[0]!.slice(DOOR_STRING, DOOR_STRING + 4))).toEqual([0x12, 0x34, 0x56, 0x78])
  })

  it('M_Getkey packs remote into bit 31 and the character into the low byte (L21)', () => {
    const b = bbs()
    b.text = 'A'
    b.data = 1 // remote
    run(`${OPEN}Print Hex$(M_Getkey)`, b)
    expect(out()).toBe('$80000041')
    const local = bbs()
    local.text = 'A'
    local.data = 0
    run(`${OPEN}Print Hex$(M_Getkey)`, local)
    expect(out()).toBe('$41')
  })

  it('M_Getuserstr REFUSES a string of 40 or fewer and never sends (DEFECT, L16)', () => {
    const b = bbs()
    b.text = 'Ari'
    run(`${OPEN}A$=Space$(40)\nPrint M_Getuserstr(1,A$)`, b)
    expect(b.sent.length).toBe(0)
    expect(out()).toBe('0')
    // 41 is the first length it will take, which is one past what MAX's
    // needs and is the shape of the bug
    const ok = bbs()
    ok.text = 'Ari'
    const rt = run(`${OPEN}A$=Space$(41)\nPrint M_Getuserstr(1,A$)`, ok)
    expect(cmd(ok)).toBe(14)
    expect(out()).toBe('1')
    expect(String.fromCharCode(...rt.maxsDoor.msg.slice(DOOR_STRING, DOOR_STRING + 3))).toBe('Ari')
  })

  it('M_Newaccess and M_Addtime are one command number each (L17, L18)', () => {
    const b = bbs()
    run(`${OPEN}A=M_Newaccess(200)\nA=M_Addtime(15)`, b)
    // NewAccess is 15 and NewTime is 21 --- the gap is where End (20) sits,
    // which is why M_Addtime's command is not 16
    expect([cmd(b, 0), dat(b, 0)]).toEqual([15, 200])
    expect([cmd(b, 1), dat(b, 1)]).toEqual([21, 15])
  })

  it('M_Portclose sends End and forgets the port', () => {
    const b = bbs()
    const rt = run(`${OPEN}M_Portclose\nA=M_Bbstext("after")`, b)
    expect([cmd(b), dat(b)]).toEqual([20, 0])
    expect(b.sent.length).toBe(1)
    expect(rt.maxsDoor.door).toBe(null)
  })

  it('the message is 106 bytes with NT_MESSAGE and the length the author equated', () => {
    const b = bbs()
    run(`${OPEN}A=M_Twituser`, b)
    const m = b.sent[0]!
    expect(m.length).toBe(DOOR_MSG_LENGTH)
    expect(m[0x08]).toBe(5) // ln_Type = NT_MESSAGE
    expect((m[0x12]! << 8) | m[0x13]!).toBe(DOOR_MSG_LENGTH) // mn_Length
  })
})
