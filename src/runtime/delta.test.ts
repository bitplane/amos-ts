/**
 * Delta, against both binaries — `extdis delta-1.4` and `extdis delta-1.6` —
 * and against `AMOSPro_Delta.Guide`, which documents all forty-six.
 *
 * The 1.4 table is bound for the twenty-six keywords both releases share and
 * the 1.6 table for the twenty 1.6 added, because only the second table has
 * them; one port answers both, so the split is in the harness and not in the
 * code under test.
 *
 * Several defects here are pinned by comparison rather than by behaviour,
 * because the behaviour is the machine's and this port has no vector table to
 * corrupt, no code memory to overwrite and no interrupt to switch off. The
 * five keywords Delta shares with Misc 1.0 are pinned against Misc's own
 * handlers, since Misc ships the source that proves what they do.
 */
import { describe, expect, it } from 'vitest'
import { mustFinish } from '../testing/run'
import { WB_SLOT } from '../amiga/intuition'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { extensionById } from '../ext/registry'
import { Runtime } from './runtime'
import { DELTA_ERRORS, ffp } from './delta'

const table = new TokenTable(CORE_TOKENS)
/** slot 15 — the guide's install note, and routine 0's `moveq #$e,d0` */
const DELTA_SLOT = 15
const delta = extensionById('delta-1.4')!
const extensions = new Map([[DELTA_SLOT, delta.table]])

interface Boot {
  rt: Runtime
  out: () => string
}

function boot(src: string): Boot {
  let printed = ''
  const rt = new Runtime(tokenize(src, table, extensions), table, {
    extensions,
    extBindings: new Map([[DELTA_SLOT, delta]]),
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

describe('Delta: the display pokes', () => {
  it('Delta Pal writes $2020, because a byte write reaches both halves', () => {
    // `move.b #$20,$dff1dc` is the register's HIGH half; PAL is bit 5 in the
    // low one, and only arrives because the 68000 duplicates the byte across
    // the bus. Personnal's Set Pal writes the same register as a word
    expect(run('Delta Pal').rt.beamcon0).toBe(0x2020)
  })

  it('Delta Ntsc clears BEAMCON0 outright', () => {
    expect(run('Delta Pal : Delta Ntsc').rt.beamcon0).toBe(0)
  })

  it('Delta No Synchro puts the program\'s byte in both halves', () => {
    expect(run('Delta No Synchro 1').rt.beamcon0).toBe(0x0101)
    expect(run('Delta No Synchro $FF').rt.beamcon0).toBe(0xffff)
    // a byte write, so anything above 255 is truncated
    expect(run('Delta No Synchro $123').rt.beamcon0).toBe(0x2323)
  })

  it('DEFECT: Delta Decrunch sets colour ONE and blacks colour zero', () => {
    // `move.l d0,$dff180` writes COLOR00 from the high word and COLOR01 from
    // the low one, so the guide's "This efect using colour 0" is backwards
    const { rt } = run('Screen Open 0,320,64,16,0 : Colour 0,$FFF : Delta Decrunch $F00')
    expect(rt.screen.palette[0]).toBe(0)
    expect(rt.screen.palette[1]).toBe(0xf00)
  })

  it('Delta Decrunch refuses 0 and anything from 4096 up', () => {
    const scr = 'Screen Open 0,320,64,16,0 : '
    expect(() => run(`${scr}Delta Decrunch 0`)).toThrow(/Illegal function call/)
    expect(() => run(`${scr}Delta Decrunch 4096`)).toThrow(/Overflow/)
    expect(() => run(`${scr}Delta Decrunch 4095`)).not.toThrow()
  })

  it('DEFECT: Delta Inter On does nothing, and Delta Inter Off is not reproduced', () => {
    // routine 6 is `move.w #$0,$dff09a` -- INTENA's bit 15 chooses set or
    // clear, and with it clear the write clears the bits present in $0000,
    // which is none. Routine 11 is `#$4000` and really does take INTEN down,
    // so a program can turn interrupts off and has no way back; reproducing
    // that means hanging, so both run and neither changes anything
    const { rt, out } = run('Delta Inter Off : Delta Inter On : Print 1')
    expect(out().trim()).toBe('1')
    // the vertical blank is still running, which on the machine it would not be
    const before = rt.interp.tick
    rt.frame()
    expect(rt.interp.tick).toBeGreaterThan(before)
  })

  it('DEFECT: both checks are word tests, so negatives pass and 65536 does not', () => {
    const scr = 'Screen Open 0,320,64,16,0 : '
    // `cmpi.w #$1000` is a SIGNED word compare, and -1 is $ffff as a word
    const { rt } = run(`${scr}Delta Decrunch -1`)
    expect(rt.screen.palette[1]).toBe(0xfff)
    // ...while 65536, whose low word is zero, is refused as if it were 0
    expect(() => run(`${scr}Delta Decrunch 65536`)).toThrow(/Illegal function call/)
  })
})

describe('Delta: the five keywords that are Misc 1.0\'s', () => {
  it('Delta Mouse Off clears sprite DMA, and nothing puts it back', () => {
    const { rt } = run('Delta Mouse Off')
    expect(rt.spriteDma).toBe(false)
  })

  it('DEFECT: the two drive-motor keywords are the wrong way round', () => {
    // both write $7f then $77 to CIA-B port B and differ only in the direction
    // register: On makes it all INPUTS, which stops driving /MTR
    expect(run('Delta Drive Motor On').rt.driveMotor).toBe(false)
    expect(run('Delta Drive Motor Off').rt.driveMotor).toBe(true)
    expect(run('Delta Drive Motor Off : Delta Drive Motor On').rt.driveMotor).toBe(false)
  })

  it('it is the same flag Misc 1.0\'s Dled On and Dled Off write', () => {
    // the same four writes from two extensions that do not know about each
    // other, which is why the flag is on the Runtime
    const misc = extensionById('misc-1.0')!
    const both = new Map([
      [DELTA_SLOT, delta.table],
      [20, misc.table],
    ])
    const rt = new Runtime(tokenize('Dled Off : Delta Drive Motor On', table, both), table, {
      extensions: both,
      extBindings: new Map([
        [DELTA_SLOT, delta],
        [20, misc],
      ]),
      maxSteps: 200_000,
    })
    mustFinish(rt.runHeadless(2_000))
    expect(rt.driveMotor).toBe(false)
  })

  it('Delta Change Disk returns instead of waiting for a floppy', () => {
    // there is no disk to swap and no Validator task to outlive; the
    // alternative is to block for ever
    expect(() => run('Delta Change Disk : Print 1')).not.toThrow()
    expect(text('Delta Change Disk : Print 1').trim()).toBe('1')
  })

  it('Delta Wait Fire waits until the button is down', () => {
    // held from the start, so it falls straight through
    expect(text('Delta Wait Fire : Print 1', (rt) => (rt.input.joy = 16)).trim()).toBe('1')
    // never pressed: the statement blocks and the program does not finish
    const b = boot('Delta Wait Fire : Print 1')
    b.rt.runHeadless(20)
    expect(b.out()).toBe('')
  })
})

describe('Delta: the waits', () => {
  it('Delta Wait Left Mouse falls through on a held button and blocks otherwise', () => {
    expect(text('Delta Wait Left Mouse : Print 1', (rt) => (rt.input.mouseK = 1)).trim()).toBe('1')
    const b = boot('Delta Wait Left Mouse : Print 1')
    b.rt.runHeadless(20)
    expect(b.out()).toBe('')
  })

  it('DEFECT: Delta Wait Double Mouse never waits for a RELEASE', () => {
    // press, delay, press -- with nothing between, so a button that is still
    // held when the delay runs out satisfies the second wait too and one click
    // counts as two
    const b = boot('Delta Wait Double Mouse 1 : Print 1')
    b.rt.input.mouseK = 1
    mustFinish(b.rt.runHeadless(2_000))
    expect(b.out().trim()).toBe('1')
  })

  it('and it does not finish while the button is never pressed', () => {
    const b = boot('Delta Wait Double Mouse 100 : Print 1')
    b.rt.runHeadless(20)
    expect(b.out()).toBe('')
  })
})

describe('Delta: Reset', () => {
  it('asks the machine for a cold reset and ends the program', () => {
    // Misc 1.0's Reset instruction for instruction, and `clr.l $4.w` wipes
    // ExecBase, so the ROM cold-boots
    const { rt, out } = run('Delta Reset : Print 1')
    expect(rt.machine.pendingReset).toEqual({ kind: 'cold', by: 'delta reset' })
    expect(out()).toBe('')
  })
})

describe('Delta: the constants', () => {
  it('Delta Pi# and Delta E# are FFP longwords, accurate to seven digits', () => {
    // $c90fdb42 and $adf85442: a 24-bit mantissa is all FFP has
    expect(ffp(0xc90fdb42)).toBeCloseTo(Math.PI, 6)
    expect(ffp(0xadf85442)).toBeCloseTo(Math.E, 6)
    // and not to eight, which is the point of spelling the format out
    expect(ffp(0xc90fdb42)).not.toBe(Math.PI)
    const p = Number(text('Print Delta Pi#').trim())
    const e = Number(text('Print Delta E#').trim())
    expect(p).toBeCloseTo(Math.PI, 5)
    expect(e).toBeCloseTo(Math.E, 5)
  })

  it('Delta Brithday is an integer and nothing says how to read it', () => {
    expect(Number(text('Print Delta Brithday').trim())).toBe(0x015f70ad)
  })

  it('the unit strings are the bytes the routines write', () => {
    expect(text('Print Delta Yard$').trim()).toBe('0.9144')
    expect(text('Print Delta Feet$').trim()).toBe('0.3048')
    expect(text('Print Delta Inch$').trim()).toBe('0.0254')
    expect(text('Print Delta English Mile$').trim()).toBe('1852')
    expect(text('Print Delta American Mile$').trim()).toBe('1853.25')
    expect(text('Print Delta Euler$').trim()).toBe('0.57722')
    expect(text('Print Delta About$').trim()).toBe('Delta of Opium^Hv^Fnz!')
  })

  it('Delta About$ is four bytes longer than the buffer it is built in', () => {
    // The author reserved two ten-byte buffers side by side and builds into
    // the first: 20 bytes, two of them the length word. 22 characters makes
    // 24. In 1.6 the four that do not fit land on the first longword of
    // routine 3, Delta Decrunch -- see the DEFECT in delta.ts's header. The
    // arithmetic is what the note rests on, so it is pinned here; the write
    // itself is NOT REPRODUCED, there being no code memory to land in.
    expect(text('Print Len(Delta About$)').trim()).toBe('22')
    expect(2 + 22).toBeGreaterThan(20)
  })

  it('two of them carry a unit that Val has to stop at', () => {
    // the guide's own `Radian#=Val(Delta Radian$)` depends on it
    expect(text('Print Delta Radian$').trim()).toBe('57.29578°')
    expect(text('Print Delta Degree$').trim()).toBe('0.01745rd')
    expect(Number(text('Print Val(Delta Radian$)').trim())).toBeCloseTo(57.29578, 4)
    expect(Number(text('Print Val(Delta Degree$)').trim())).toBeCloseTo(0.01745, 5)
  })
})

/**
 * The twenty 1.6 adds, against `amospro_delta.lib` disassembled with
 * `extdis delta-1.6`. A second harness because the keywords only exist in
 * 1.6's token table — the 26 above are at the same ids in both, which is why
 * one port answers for both, but the twenty are new entries.
 */
const delta16 = extensionById('delta-1.6')!
const ext16 = new Map([[DELTA_SLOT, delta16.table]])

function boot16(src: string): Boot {
  let printed = ''
  const rt = new Runtime(tokenize(src, table, ext16), table, {
    extensions: ext16,
    extBindings: new Map([[DELTA_SLOT, delta16]]),
    maxSteps: 200_000,
    onText: (t) => (printed += t),
  })
  return { rt, out: () => printed }
}

function run16(src: string): Boot {
  const b = boot16(src)
  mustFinish(b.rt.runHeadless(2_000))
  return b
}

const text16 = (src: string): string => run16(src).out()

describe('Delta 1.6: the one keyword the two releases disagree about', () => {
  const scr = 'Screen Open 0,320,64,16,0 : '

  it('Delta Decrunch raises 1.6\'s OWN messages where 1.4 raises AMOS numbers', () => {
    // routine 3 is the same three instructions in both. 1.4 ($280) ends its
    // two branches `moveq #$17,d0 / Rjmp L_Error` and `#$1d`; 1.6 ($1e78)
    // ends them `Rbeq 34` and `Rbge 35`, which are `moveq #0,d0` and `moveq
    // #1,d0` in front of the shared dispatcher at routine 66
    expect(() => run16(`${scr}Delta Decrunch 0`)).toThrow(DELTA_ERRORS[0])
    expect(() => run16(`${scr}Delta Decrunch 4096`)).toThrow(DELTA_ERRORS[1])
    // and the 1.4 harness above gets 23 and 29 from the same two arguments
  })

  it('and the word-sized checks are still word-sized, message or no message', () => {
    // the DEFECTS are 1.4's and 1.6 kept them: only the error path moved
    expect(() => run16(`${scr}Delta Decrunch 65536`)).toThrow(DELTA_ERRORS[0])
    expect(run16(`${scr}Delta Decrunch -1`).rt.screen.palette[1]).toBe(0xfff)
    expect(() => run16(`${scr}Delta Decrunch 4095`)).not.toThrow()
  })

  it('an UNBOUND program answers as 1.4, because there is nothing to ask', () => {
    // identified by token table alone -- no extBindings, so no way to tell
    // the releases apart, and 1.4 is the release the port was read from
    const rt = new Runtime(tokenize(`${scr}Delta Decrunch 0`, table, ext16), table, {
      extensions: ext16,
      maxSteps: 200_000,
    })
    expect(() => mustFinish(rt.runHeadless(2_000))).toThrow(/Illegal function call/)
  })
})

describe('Delta 1.6: the private Move block', () => {
  // `movea.l (a3)+,a0 / move.l (a3)+,d0 / move.b d0,(a0)` — the ADDRESS pops
  // first, so it is the last argument, and the guide agrees: "Moveb DATA,
  // ADDRESS ... (like Poke)". This is the only thing about the three worth
  // knowing and it is the thing a caller gets wrong
  const bank = 'Reserve As Data 5,64 : '

  it('Moveb is Poke with the arguments the other way round', () => {
    expect(text16(`${bank}Moveb $7F,Start(5) : Print Peek(Start(5))`).trim()).toBe('127')
  })

  it('Movew is Doke and Movel is Loke, both reversed', () => {
    expect(text16(`${bank}Movew $1234,Start(5) : Print Deek(Start(5))`).trim()).toBe('4660')
    expect(text16(`${bank}Movel $1234,Start(5)+4 : Print Leek(Start(5)+4)`).trim()).toBe('4660')
  })

  it('they agree with Poke, Doke and Loke given the same bytes', () => {
    const via = text16(`${bank}Moveb 65,Start(5) : Movew 513,Start(5)+2 : Print Peek(Start(5));Deek(Start(5)+2)`)
    const core = text16(`${bank}Poke Start(5),65 : Doke Start(5)+2,513 : Print Peek(Start(5));Deek(Start(5)+2)`)
    expect(via).toBe(core)
  })
})

describe('Delta 1.6: Change Bank', () => {
  it('renumbers the bank whose Start() it is given', () => {
    const out = text16('Reserve As Data 10,100 : Delta Change Bank Start(10) To 50 : Print Length(50)')
    expect(out.trim()).toBe('100')
  })

  it('the old number is gone once it has moved', () => {
    const { rt } = run16('Reserve As Data 10,100 : Delta Change Bank Start(10) To 50')
    expect(rt.memBanks.has(10)).toBe(false)
    expect(rt.memBanks.get(50)?.data.length).toBe(100)
  })

  it('the data goes with it', () => {
    const src = 'Reserve As Data 10,100 : Loke Start(10),$DEADBEEF : Delta Change Bank Start(10) To 50 : Print Hex$(Leek(Start(50)))'
    expect(text16(src).trim()).toBe('$DEADBEEF')
  })

  it('refuses 0 and refuses a negative, both as "too small"', () => {
    // `tst.w d1 / Rbeq 34` then `tst.w d1 / Rbmi 34` — two tests, one message
    expect(() => run16('Reserve As Data 10,100 : Delta Change Bank Start(10) To 0')).toThrow(/too small/)
    expect(() => run16('Reserve As Data 10,100 : Delta Change Bank Start(10) To -1')).toThrow(/too small/)
  })

  it('refuses 4096 and takes 4095 — the bound is $1000, not 65535', () => {
    expect(() => run16('Reserve As Data 10,100 : Delta Change Bank Start(10) To 4096')).toThrow(/too large/)
    expect(() => run16('Reserve As Data 10,100 : Delta Change Bank Start(10) To 4095')).not.toThrow()
  })

  it('DEFECT: the checks are WORD tests on a longword argument', () => {
    // 65536 has a low word of zero, so `tst.w` calls it "too small"
    expect(() => run16('Reserve As Data 10,100 : Delta Change Bank Start(10) To 65536')).toThrow(/too small/)
  })

  it('DEFECT: nothing checks the address is a bank — routine 37 has no caller', () => {
    // "Bank is not defined" is message 2 and unreachable; the write goes to
    // whatever is sixteen bytes below the address instead
    expect(() => run16('Reserve As Data 10,100 : Delta Change Bank Start(10)+1 To 50')).not.toThrow()
  })
})

describe('Delta 1.6: the public-screen lock', () => {
  it('locks, and unlocks again', () => {
    expect(() => run16('Delta Lock Pub Screens : Delta Unlock Pub Screens')).not.toThrow()
  })

  it('unlocking first is "already unlocked" — the flag starts clear', () => {
    expect(() => run16('Delta Unlock Pub Screens')).toThrow(/Public screens already unlocked/)
  })

  it('locking twice is "already locked"', () => {
    expect(() => run16('Delta Lock Pub Screens : Delta Lock Pub Screens')).toThrow(/Public screen already locked/)
  })

  it('and that error UNLOCKS on its way out, which routine 49 does deliberately', () => {
    // routine 49 opens intuition, calls UnlockPubScreenList and clears $1e62
    // BEFORE raising, so a trapped double-lock leaves the list unlocked —
    // which is why the next Unlock complains rather than succeeding
    const { rt } = run16('Delta Lock Pub Screens')
    expect(rt.delta.pubLocked).toBe(true)
    expect(() => run16('Delta Lock Pub Screens : Delta Lock Pub Screens')).toThrow()
    const b = boot16('Delta Lock Pub Screens : Delta Lock Pub Screens')
    try {
      b.rt.runHeadless(2_000)
    } catch {
      /* the error is the point; the flag after it is what is under test */
    }
    expect(b.rt.delta.pubLocked).toBe(false)
  })
})

describe('Delta 1.6: tasks, Workbench and the machine', () => {
  it('=Delta Find Task answers 0, which is the guide\'s own not-found test', () => {
    // one task here, and no address for it: "if ADDRESS=0 then task not found"
    expect(text16('Print Delta Find Task(" AMOS")').trim()).toBe('0')
    expect(text16('Print Delta Find Task("nothing at all")').trim()).toBe('0')
  })

  it('Delta Kill Task therefore always says so', () => {
    expect(() => run16('Delta Kill Task "Validator"')).toThrow(/Task not found/)
  })

  it('Delta Wb To Front and Wb To Back reach the same calls CRAFT does', () => {
    expect(() => run16('Delta Wb To Front : Delta Wb To Back')).not.toThrow()
  })

  it('Delta Hard Reset asks the machine for a cold one and ends the program', () => {
    const b = boot16('Delta Hard Reset : Print "never"')
    b.rt.runHeadless(2_000)
    expect(b.rt.machine.pendingReset).toEqual({ kind: 'cold', by: 'delta hard reset' })
    expect(b.out()).toBe('')
  })

  it('Delta Blit Off returns — the wait is satisfied on entry', () => {
    // `btst.b #$e,$dff002 / bne` waits for BBUSY, and a blit finishes inside
    // the keyword that started it here, so nothing is ever busy
    expect(() => run16('Delta Blit Off : Print 1')).not.toThrow()
    expect(text16('Delta Blit Off : Print 1').trim()).toBe('1')
  })

  it('Delta Crash and Delta Beep All are reached and show nothing', () => {
    expect(text16('Delta Crash 1234 : Delta Beep All : Print 1').trim()).toBe('1')
  })

  it('Delta Intuition Message evaluates both arguments', () => {
    expect(text16('Delta Intuition Message 100,Chr$(20)+"AMOS is cool!" : Print 1').trim()).toBe('1')
  })
})

describe('Delta 1.6: the error table', () => {
  it('is the nine strings at $26d4, in the order d0 indexes them', () => {
    expect(DELTA_ERRORS).toEqual([
      'Variable is too small',
      'Variable is too large',
      'Bank is not defined',
      'Cannot create intuition alert',
      'Cannot open reqtools.library',
      'Public screen already locked',
      'Public screens already unlocked',
      'Task not found',
      'Not a tracker module',
    ])
  })

  it('three of them are unreachable, and the guide knows about one', () => {
    // routines 37, 38 and 42 have no caller anywhere in the binary. That is
    // why every reqtools example in the guide is wrapped in
    // `If Exist("LIBS:reqtools.library")` and says "Else you will have GURU."
    expect(DELTA_ERRORS[2]).toBe('Bank is not defined')
    expect(DELTA_ERRORS[3]).toBe('Cannot create intuition alert')
    expect(DELTA_ERRORS[4]).toBe('Cannot open reqtools.library')
  })

  it('and the ninth names something this library does not do at all', () => {
    expect(DELTA_ERRORS[8]).toBe('Not a tracker module')
  })
})

/** press and release the left button over a window-relative point */
function dclick(b: Boot, wx: number, wy: number): void {
  const st = b.rt.rtReq!
  const scr = b.rt.screens.get(WB_SLOT)!
  b.rt.input.mouseX = scr.screenToHardX(st.window.leftEdge + wx)
  b.rt.input.mouseY = st.window.topEdge + wy + scr.displayY - scr.offsetY
  b.rt.input.mouseK = 1
  b.rt.frame()
  b.rt.input.mouseK = 0
  b.rt.frame()
}

/** click gadget `i`, counting from the left */
function dpress(b: Boot, i: number): void {
  const g = b.rt.rtReq!.layout.buttons[i]!.box
  dclick(b, g.x + (g.w >> 1), g.y + (g.h >> 1))
}

describe('Delta 1.6: the reqtools requesters', () => {
  it('=Delta Reqtools Requester cancels to 0 with nobody there to click', () => {
    // a headless run answers the RIGHTMOST gadget, and reqtools numbers the
    // rightmost 0 --- so the guide's `"Yes|No"` cancels to No
    const b = boot16('Print Delta Reqtools Requester("Is AMOS cool ?","Yes|No")')
    mustFinish(b.rt.runHeadless(4_000))
    expect(b.out().trim()).toBe('0')
  })

  it('and answers the gadget that was pressed, in reqtools\' own numbering', () => {
    const b = boot16('Print Delta Reqtools Requester("Is AMOS cool ?","Yes|No")')
    b.rt.frame()
    dpress(b, 0)
    for (let k = 0; k < 4; k++) b.rt.frame()
    expect(b.out().trim()).toBe('1')
  })

  it('the gadget string splits on "|", which is reqtools\' separator', () => {
    const b = boot16('Print Delta Reqtools Requester("T","First|Second|Third")')
    b.rt.frame()
    expect(b.rt.rtReq!.layout.buttons.map((g) => g.text)).toEqual(['First', 'Second', 'Third'])
  })

  it('gets reqtools\' own window title, because routine 54 passes no tag list', () => {
    // `Request` with two gadgets or more, `Information` with one or none ---
    // `req.c` picks between them on the POINTER being null, and a0 is zero at
    // `$260c jsr -$42(a6)` so RTEZ_ReqTitle never arrives
    const two = boot16('Print Delta Reqtools Requester("T","Yes|No")')
    two.rt.frame()
    expect(two.rt.rtReq!.window.title).toBe('Request')
    const one = boot16('Print Delta Reqtools Requester("T","Ok")')
    one.rt.frame()
    expect(one.rt.rtReq!.window.title).toBe('Information')
  })

  it('draws an underscore rather than eating it, having asked for no RT_Underscore', () => {
    const b = boot16('Print Delta Reqtools Requester("T","_Yes|_No")')
    b.rt.frame()
    expect(b.rt.rtReq!.layout.buttons.map((g) => g.text)).toEqual(['_Yes', '_No'])
  })

  it('=Delta Reqtools Get Number hands back its default when cancelled', () => {
    // rtGetLongA edits the long at $1d06 IN PLACE and a cancel leaves it, so
    // the default the caller passed is what comes back
    const b = boot16('Print Delta Reqtools Get Number("Enter number:",10)')
    mustFinish(b.rt.runHeadless(4_000))
    expect(b.out().trim()).toBe('10')
  })

  it('and puts TITLE$ in the title bar, not in a body line', () => {
    // rtGetLongA's second argument is the requester TITLE; the body would
    // have to come from an RTGL_TextFmt tag and routine 55 passes none
    const b = boot16('Print Delta Reqtools Get Number("Enter number:",10)')
    b.rt.frame()
    const st = b.rt.rtReq!
    expect(st.window.title).toBe('Enter number:')
    expect(st.layout.lines).toEqual([])
    expect(st.buffer).toBe('10')
  })

  it('answers what was typed into the gadget', () => {
    const b = boot16('Print Delta Reqtools Get Number("Enter number:",10)')
    b.rt.frame()
    for (const ch of ['\b', '\b', '7']) b.rt.pressKey(ch, 0)
    b.rt.frame()
    dpress(b, 0)
    for (let k = 0; k < 4; k++) b.rt.frame()
    expect(b.out().trim()).toBe('7')
  })
})

/** click a window-relative point on the palette requester */
function pclick(b: Boot, wx: number, wy: number): void {
  const st = b.rt.rtPalette!
  const scr = b.rt.screens.get(WB_SLOT)!
  b.rt.input.mouseX = scr.screenToHardX(st.window.leftEdge + wx)
  b.rt.input.mouseY = st.window.topEdge + wy + scr.displayY - scr.offsetY
  b.rt.input.mouseK = 1
  b.rt.frame()
  b.rt.input.mouseK = 0
  b.rt.frame()
}

/** click swatch `i` of the palette grid */
function pcell(b: Boot, i: number): void {
  const l = b.rt.rtPalette!.layout
  const cw = l.grid.w / l.cols
  pclick(b, l.grid.x + Math.trunc((i + 0.5) * cw), l.grid.y + (l.grid.h >> 1))
}

/** click Copy (0), Swap (1) or Spread (2) */
function pmode(b: Boot, i: number): void {
  const g = b.rt.rtPalette!.layout.modes[i]!.box
  pclick(b, g.x + (g.w >> 1), g.y + (g.h >> 1))
}

/** click Ok (0), Undo (1) or Cancel (2) */
function pbutton(b: Boot, i: number): void {
  const g = b.rt.rtPalette!.layout.buttons[i]!.box
  pclick(b, g.x + (g.w >> 1), g.y + (g.h >> 1))
}

/** drag gun `g` to its far right, which is the maximum a four-bit gun holds */
function pgunMax(b: Boot, g: number): void {
  const s = b.rt.rtPalette!.layout.sliders[g]!
  pclick(b, s.x + s.w - 1, s.y + (s.h >> 1))
}

describe('Delta 1.6: the palette requester', () => {
  const PROG = 'Delta Reqtools Palette "Colours"'
  const wb = (b: Boot): Uint16Array => b.rt.screens.get(WB_SLOT)!.palette

  it('opens on the WORKBENCH, which is not the screen the program draws on', () => {
    // a0 is zero at `$23f4 jsr -$66(a6)`, so there is no RT_Window and no
    // RT_Screen; GetReqScreen falls through to the default public screen
    const b = boot16(PROG)
    b.rt.frame()
    const st = b.rt.rtPalette!
    expect(st.slot).toBe(WB_SLOT)
    expect(st.window.title).toBe('Colours')
    // the Workbench is four colours, so four swatches in one row
    expect([st.layout.rows, st.layout.cols]).toEqual([1, 4])
  })

  it('starts on pen 1 and shows its three guns', () => {
    // `glob->color = 1` before the tags are read, and Workbench colour 1 is
    // white --- ../amiga/intuition.ts's WB_PALETTE, read out of Preferences
    const b = boot16(PROG)
    b.rt.frame()
    const st = b.rt.rtPalette!
    expect(st.color).toBe(1)
    expect(st.levels).toEqual([15, 15, 15])
    expect(st.maxLevels).toEqual([15, 15, 15])
  })

  it('writes the pen as the slider moves', () => {
    const b = boot16(PROG)
    b.rt.frame()
    pgunMax(b, 0)
    expect(b.rt.rtPalette!.levels[0]).toBe(15)
    // red to the top and green and blue where they were: still white
    expect(wb(b)[1]).toBe(0xfff)
    // now take green and blue down by clicking near the left of each
    for (const g of [1, 2]) {
      const s = b.rt.rtPalette!.layout.sliders[g]!
      pclick(b, s.x + 2, s.y + (s.h >> 1))
    }
    expect(wb(b)[1]).toBe(0xf00)
  })

  it('Copy puts the selected pen into the one clicked next', () => {
    const b = boot16(PROG)
    b.rt.frame()
    const was = wb(b)[3]
    pmode(b, 0)
    expect(b.rt.rtPalette!.mode).toBe(0)
    pcell(b, 3)
    // pen 3 now holds pen 1's white, and the selection has moved to 3
    expect(wb(b)[3]).toBe(0xfff)
    expect(wb(b)[3]).not.toBe(was)
    expect(b.rt.rtPalette!.color).toBe(3)
    expect(b.rt.rtPalette!.mode).toBe(-1)
  })

  it('Swap exchanges the two, because its case falls into Copy\'s', () => {
    const b = boot16(PROG)
    b.rt.frame()
    const one = wb(b)[1]!
    const three = wb(b)[3]!
    pmode(b, 1)
    pcell(b, 3)
    expect(wb(b)[1]).toBe(three)
    expect(wb(b)[3]).toBe(one)
  })

  it('Spread walks the run between the two and leaves the far end alone', () => {
    // `for (actcol = from; actcol != to; ...)` stops BEFORE `to`
    const b = boot16(PROG)
    b.rt.frame()
    const three = wb(b)[3]!
    pmode(b, 2)
    pcell(b, 3)
    expect(wb(b)[3]).toBe(three)
    // pen 2 sits between white at 1 and orange at 3, so it is neither now
    expect(wb(b)[2]).not.toBe(0x002)
  })

  it('Undo goes back to the palette as it stood before the last swatch click', () => {
    // `RefreshVpCM (vp, undomap)` runs FIRST in the PALETTE_ID arm, so the
    // undo map is re-taken on every click and Undo is one step, not all of it
    const b = boot16(PROG)
    b.rt.frame()
    pgunMax(b, 0)
    const afterSlider = Uint16Array.from(wb(b))
    pmode(b, 0)
    pcell(b, 3)
    expect(wb(b)[3]).not.toBe(afterSlider[3])
    pbutton(b, 1)
    expect(Array.from(wb(b))).toEqual(Array.from(afterSlider))
  })

  it('Cancel puts the whole palette back', () => {
    const b = boot16(PROG)
    b.rt.frame()
    const opened = Uint16Array.from(wb(b))
    pmode(b, 0)
    pcell(b, 3)
    expect(wb(b)[3]).not.toBe(opened[3])
    pbutton(b, 2)
    expect(Array.from(wb(b))).toEqual(Array.from(opened))
  })

  it('Ok keeps it, and throws the pen away because routine 41 has nowhere to put it', () => {
    const b = boot16(PROG)
    b.rt.frame()
    pmode(b, 0)
    pcell(b, 3)
    const chosen = wb(b)[3]
    pbutton(b, 0)
    for (let k = 0; k < 4; k++) b.rt.frame()
    expect(wb(b)[3]).toBe(chosen)
    expect(b.rt.rtPalette).toBeNull()
  })

  it('a headless run cancels it, which puts the palette back', () => {
    const b = boot16(PROG)
    b.rt.frame()
    const opened = Uint16Array.from(wb(b))
    pgunMax(b, 0)
    mustFinish(b.rt.runHeadless(2_000))
    expect(Array.from(wb(b))).toEqual(Array.from(opened))
  })
})
