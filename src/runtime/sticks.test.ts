/**
 * Sticks 1.01b, verified against its own AutoDoc manual (Docs/Sticks.Doc on the
 * AMOS PD CD) and against Sticks.lib disassembled with `extdis sticks-1.01b`.
 *
 * Where manual and binary disagree the binary wins, and the two places they do
 * are pinned here so nobody quietly "fixes" them back to the prose.
 */
import { describe, expect, it } from 'vitest'
import { mustFinish } from '../testing/run'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { EXTENSION_TOKENS, extensionById } from '../ext/registry'
import { Runtime } from './runtime'

const table = new TokenTable(CORE_TOKENS)
/** the slot the extension's own installer and Burton's list both use */
const STICKS_SLOT = 17
const extensions = new Map([
  ...[...EXTENSION_TOKENS].map(([slot, defs]) => [slot, new TokenTable(defs)] as const),
  [STICKS_SLOT, extensionById('sticks-1.01b')!.table] as const,
])

function run(src: string, prep?: (rt: Runtime) => void): { out: string; rt: Runtime } {
  let out = ''
  const rt = new Runtime(tokenize(src, table, extensions), table, {
    maxSteps: 200_000,
    extensions,
    onText: (t) => (out += t),
  })
  prep?.(rt)
  const r = rt.runHeadless(2_000)
  mustFinish(r)
  return { out, rt }
}

describe('Sticks: the two normal ports, which the host has', () => {
  it('Multi Joy puts directions in the low nibble and fire at $80', () => {
    // The manual's diagram ("76543210 / ABCDUDLR") and its value table
    // ("1 up, 2 down, 4 left, 8 right ... 128 A") contradict each other. The
    // routine ORs $80/$40/$20/$10 for the buttons above the direction bits, so
    // the value table is right and the diagram is written backwards.
    const { out } = run('Print Multi Joy(1)', (rt) => {
      rt.input.joy = 1 | 16 // up + fire
    })
    expect(out).toBe(' 129\n') // 1 (up) | 128 (button A)
  })

  it('Multi Joy reads port 0 and port 1 as separate players', () => {
    const { out } = run('Print Multi Joy(0);Multi Joy(1)', (rt) => {
      rt.input.joy0 = 4 // left
      rt.input.joy = 8 // right
    })
    expect(out).toBe(' 4 8\n')
  })

  it('Multi Joy refuses a port outside 0..1', () => {
    // `cmp.w #$0,d4 : blt` then `cmp.w #$1,d4 : bgt` ($26e-$27a)
    expect(() => run('Print Multi Joy(2)')).toThrow(/Illegal function call/)
    expect(() => run('Print Multi Joy(-1)')).toThrow(/Illegal function call/)
  })

  it('Multi Fire tests button 1, and answers 0 for the adaptor buttons', () => {
    const { out } = run('Print Multi Fire(1,1);Multi Fire(2,1);Multi Fire(1,1)', (rt) => {
      rt.input.joy = 16
    })
    // button 1 pressed; button 2 needs a two-button adaptor, so 0
    expect(out).toBe('-1 0-1\n')
  })

  it('Multi Fire range-checks the PORT but not the BUTTON', () => {
    // the routine pops button into d4 and jport into d5, and only d5 gets the
    // blt/bgt pair ($374-$380). An out-of-range button falls through every
    // cmp.w and returns 0.
    expect(() => run('Print Multi Fire(1,9)')).toThrow(/Illegal function call/)
    expect(run('Print Multi Fire(99,1)').out).toBe(' 0\n')
  })

  it('Mouse Button is a bitmask, so both buttons together read 3', () => {
    // `ori.b #$1` and `ori.b #$2` and nothing else ($ad8-$b0a). The manual
    // calls 3 "Middle Button Pressed"; the routine reads no third line, so 3
    // simply means both.
    expect(run('Print Mouse Button(0)', (rt) => { rt.input.mouseK = 1 }).out).toBe(' 1\n')
    expect(run('Print Mouse Button(0)', (rt) => { rt.input.mouseK = 2 }).out).toBe(' 2\n')
    expect(run('Print Mouse Button(0)', (rt) => { rt.input.mouseK = 3 }).out).toBe(' 3\n')
  })
})

describe('Sticks: the parallel-port adaptor, which the host has not', () => {
  it('every Stick direction reports an unused port', () => {
    // Stick Joy reads CIA-A PRB ($bfe101) and Stick Fire CIA-B PRA ($bfd000) —
    // parallel-port lines, whatever the manual calls them. No adaptor here.
    const { out } = run(
      'Print Stick Joy(0);Stick Up(0);Stick Down(0);Stick Left(0);Stick Right(0);Stick Fire(0)',
    )
    expect(out).toBe(' 0 0 0 0 0 0\n')
  })

  it('the Stick keywords still range-check their port', () => {
    for (const kw of ['Stick Joy', 'Stick Up', 'Stick Down', 'Stick Left', 'Stick Right', 'Stick Fire']) {
      expect(() => run(`Print ${kw}(2)`), kw).toThrow(/Illegal function call/)
    }
  })

  it('the two-argument Stick Fire is an error, as the shipped build intends', () => {
    // The manual owns up to it: "if you enter =Stick Fire(Jport,button) it will
    // return an error (This command has been provided so it can be easily
    // updated to handle more buttons in later version)". The binary carries the
    // matching string, "Command not available in this version".
    expect(() => run('Print Stick Fire(0,1)')).toThrow(/Illegal function call/)
  })

  it('Stick Scan is two instructions and Stick X/Y read one paddle register', () => {
    // Stick Scan writes POTGO; Stick X takes the low byte of POTnDAT and
    // Stick Y the high byte of the SAME register (asr.l #$8 at $53a)
    expect(run('Stick Scan : Print Stick X(0);Stick Y(0)').out).toBe(' 0 0\n')
  })
})

describe('Sticks: the second mouse, which is not the AMOS pointer', () => {
  it('Mouse X/Y set and read a position independent of the pointer', () => {
    // "This function does not alter or read the AMOS pointer position to do so
    // you should use the X Mouse function"
    const { out, rt } = run(
      [
        'Screen Open 0,320,200,16,Lowres : Curs Off',
        // hardware coordinates: the default box is the displayed screen, which
        // for screen 0 starts at 128,50 — so these are inside it
        'Mouse X 1,200',
        'Mouse Y 1,120',
        'Print Mouse X(1);Mouse Y(1)',
      ].join('\n'),
    )
    expect(out).toBe(' 200 120\n')
    // the AMOS pointer is untouched by it
    expect(rt.input.mouseX).not.toBe(200)
  })

  it('Mouse Clip holds the mouse inside its box', () => {
    const { out } = run(
      [
        'Screen Open 0,320,200,16,Lowres : Curs Off',
        'Mouse Clip 1,10,20 To 100,120',
        'Mouse X 1,5 : Mouse Y 1,5',
        'Print Mouse X(1);Mouse Y(1)',
        'Mouse X 1,999 : Mouse Y 1,999',
        'Print Mouse X(1);Mouse Y(1)',
      ].join('\n'),
    )
    expect(out).toBe(' 10 20\n 100 120\n')
  })

  it('a box may sit beyond the screen, as the manual allows', () => {
    // "This will Limit the mouse to an area on the screen or even beyond the
    // screen if you want"
    const { out } = run(
      [
        'Screen Open 0,320,200,16,Lowres : Curs Off',
        'Mouse Clip 1,400,300 To 500,400',
        'Mouse X 1,0 : Mouse Y 1,0',
        'Print Mouse X(1);Mouse Y(1)',
      ].join('\n'),
    )
    expect(out).toBe(' 400 300\n')
  })

  it('the one-argument Mouse Clip puts the limit back to the screen', () => {
    const { out } = run(
      [
        'Screen Open 0,320,200,16,Lowres : Curs Off',
        'Mouse Clip 1,10,20 To 30,40',
        'Mouse Clip 1',
        'Mouse X 1,200 : Mouse Y 1,150',
        'Print Mouse X(1);Mouse Y(1)',
      ].join('\n'),
    )
    // back to the screen's displayed area, which starts at hardware 128,50
    expect(out).toBe(' 200 150\n')
  })

  it('Mouse X and Mouse Clip range-check the mouse number', () => {
    expect(() => run('Mouse X 2,0')).toThrow(/Illegal function call/)
    expect(() => run('Mouse Clip 2')).toThrow(/Illegal function call/)
    expect(() => run('Print Mouse X(2)')).toThrow(/Illegal function call/)
  })

  it('Mouse Area answers the zone the tracked mouse is over', () => {
    // "the same as Mouse Zone in AMOS except Mouse Zone can only read one
    // mouse", so it goes through the same zone lookup
    const { out } = run(
      [
        'Screen Open 0,320,200,16,Lowres : Curs Off',
        'Reserve Zone 4 : Set Zone 1,10,10 To 50,50',
        'Mouse X 1,148 : Mouse Y 1,70',
        'Print Mouse Area(1)',
        'Mouse X 1,400 : Mouse Y 1,240',
        'Print Mouse Area(1)',
      ].join('\n'),
    )
    expect(out).toBe(' 1\n 0\n')
  })
})
