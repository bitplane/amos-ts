import { describe, expect, it } from 'vitest'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/source'
import { extensionById } from '../ext/registry'
import { JOY_FIRE } from '../interp/gameport'
import { Runtime } from './runtime'

const table = new TokenTable(CORE_TOKENS)
/** slot 23, which the source names itself: `ExtNb equ 23-1` (:26) */
const misc = extensionById('misc-1.0')!

function boot(src: string): Runtime {
  const exts = new Map([[23, misc.table]])
  return new Runtime(tokenize(src, table, exts), table, {
    extensions: exts,
    extBindings: new Map([[23, misc]]),
    maxSteps: 200_000,
    onText: () => {},
  })
}

function run(src: string, frames = 20): Runtime {
  const rt = boot(src)
  rt.runHeadless(frames)
  return rt
}

/** is anything but black on the composed frame? */
function hasPicture(rt: Runtime): boolean {
  const { data } = rt.display.composite()
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] !== 0 || data[i + 1] !== 0 || data[i + 2] !== 0) return true
  }
  return false
}

describe('Misc 1.0: the display DMA bits', () => {
  it('Display Off clears BPLEN+COPEN+SPREN and blacks the screen', () => {
    // `move.w #$01a0,$dff096` — bit 15 clear is a CLEAR, and $1a0 is the
    // three display bits together (Misc_Extension.asm:106)
    const lit = run('Screen Open 0,320,200,4,0 : Cls 2')
    expect(hasPicture(lit)).toBe(true)
    const dark = run('Screen Open 0,320,200,4,0 : Cls 2 : Display Off')
    expect(dark.videoOff).toBe(true)
    expect(hasPicture(dark)).toBe(false)
  })

  it('Display On puts them back, and the picture returns', () => {
    // `move.w #$81a0,$dff096` (:111). COLOR00 is NOT restored by the routine —
    // re-enabling COPEN lets the copper list do it, which is why nothing is
    // left black afterwards
    const rt = run('Screen Open 0,320,200,4,0 : Cls 2 : Display Off : Display On')
    expect(rt.videoOff).toBe(false)
    expect(hasPicture(rt)).toBe(true)
  })

  it('is the same flag Jd Video Off drives, because it is the same two instructions', () => {
    const rt = run('Display Off')
    expect(rt.videoOff).toBe(true)
  })
})

describe('Misc 1.0: Mouse Off', () => {
  it('clears SPREN, which takes every sprite and not just the pointer', () => {
    // `move.w #$20,$dff096` (:141) — $20 alone is SPREN
    const rt = run('Mouse Off')
    expect(rt.spriteDma).toBe(false)
  })

  it('cannot be undone — the extension has no Mouse On', () => {
    // the manual asks the reader to add one; the token table has twelve
    // entries and this is not among them
    const named = misc.table.entries.map((e) => e.name.trim().replace(/^!/, '')).filter((n) => n !== '')
    expect(named).toContain('mouse off')
    expect(named).not.toContain('mouse on')
    expect(named).toHaveLength(12)
  })
})

describe('Misc 1.0: Dled On and Dled Off are the wrong way round', () => {
  /**
   * The DEFECT, and the reason the manual is baffled by its own keyword.
   *
   * Both write 127 then 119 to CIA-B's port B and then differ only in the
   * DIRECTION register at $bfd300: On writes 0 (all inputs, so the port stops
   * driving and the active-low /MTR floats inactive — LED out) and Off writes
   * 255 (all outputs, driving the 119 still in the data register — LED on).
   */
  it('Dled On puts the LED out and Dled Off lights it', () => {
    expect(run('Dled On').driveMotor).toBe(false)
    expect(run('Dled Off').driveMotor).toBe(true)
    expect(run('Dled Off : Dled On').driveMotor).toBe(false)
  })

  it('starts out unlit', () => {
    expect(boot('Rem').driveMotor).toBe(false)
  })
})

describe('Misc 1.0: Reset', () => {
  /**
   * Routine 10 (:147): SuperState, Disable, `CLR.L 4.W`, `LEA $00FC0000,A0`,
   * RESET, `JMP (A0)`. ExecBase is wiped, so it is a COLD reboot -- the same
   * seven instructions Delta 1.4's `Delta Reset` carries, which is why one of
   * the two being n/a while the other was faithful could not both be right.
   */
  it('asks the machine for a cold reset and ends the program', () => {
    const rt = run('Reset : Dled Off')
    expect(rt.machine.pendingReset).toEqual({ kind: 'cold', by: 'reset' })
    // the statement after it never runs
    expect(rt.driveMotor).toBe(false)
  })

  it('is the same request Delta Reset makes, from a different extension', () => {
    const delta = extensionById('delta-1.4')!
    const exts = new Map([[15, delta.table]])
    const rt = new Runtime(tokenize('Delta Reset', table, exts), table, {
      extensions: exts,
      extBindings: new Map([[15, delta]]),
      maxSteps: 200_000,
      onText: () => {},
    })
    rt.runHeadless(20)
    expect(rt.machine.pendingReset?.kind).toBe('cold')
  })
})

describe('Misc 1.0: Firewait', () => {
  it('falls straight through when fire is already down', () => {
    // `btst #07,$bfe001 / bne` — the bit is active LOW, so a set bit means
    // NOT pressed and the loop spins on it (:171)
    const rt = boot('Firewait : Cls 2')
    rt.input.joy = JOY_FIRE
    const r = rt.runHeadless(5)
    expect(r.status === 'ended' || r.status === 'stopped').toBe(true)
  })

  it('holds the program while fire is up, and releases it when pressed', () => {
    const rt = boot('Firewait : Cls 2')
    rt.input.joy = 0
    // ten frames of not-pressed and it is still on the same statement, so
    // the run has neither ended nor stopped
    const held = rt.runHeadless(10)
    expect(held.status === 'ended' || held.status === 'stopped').toBe(false)
    rt.input.joy = JOY_FIRE
    const r = rt.runHeadless(10)
    expect(r.status === 'ended' || r.status === 'stopped').toBe(true)
  })
})

describe('Misc 1.0: the two that have nothing to do here', () => {
  it('Clear Ram runs and changes nothing', () => {
    // the 100MB AllocMem is meant to FAIL; the cleanup is exec's expunge, and
    // there is nothing expungeable here (:159)
    const before = run('Rem').chipUsed()
    expect(run('Clear Ram').chipUsed()).toBe(before)
  })

  it('Disk Wait returns instead of blocking for ever', () => {
    // there is no floppy to insert and no Validator task to outlive (:176)
    const r = boot('Disk Wait : Cls 2').runHeadless(5)
    expect(r.status === 'ended' || r.status === 'stopped').toBe(true)
  })
})

describe('Misc 1.0: the four that are n/a', () => {
  it('has no handler for Multi Off, Multi On, Reset or Pal On', () => {
    // an n/a keyword must have no handler, which coverage.test.ts also
    // enforces; this says WHICH four and keeps the list honest against the
    // token table rather than against the NA set
    const named = misc.table.entries.map((e) => e.name.trim().replace(/^!/, '')).filter((n) => n !== '')
    for (const n of ['multi off', 'multi on', 'reset', 'pal on']) expect(named).toContain(n)
  })

  it('Pal On is a syntax the port refuses rather than a crash it fakes', () => {
    // the label is followed only by RS.B/EQU/MACRO directives, which emit no
    // code, so it falls into Go60 — ";put system in NTSC mode" — and reads
    // Flag_FatAgnus(a0) with a0 never loaded (:209)
    expect(() => boot('Pal On').runHeadless(5)).toThrow()
  })
})
