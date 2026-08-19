/**
 * The modelled requesters. There is no reqtools.library here, so these are
 * Interface-language dialogs; what is tested is that the scripts are legal
 * Interface (the engine's own prescan is the judge), that they lay out from
 * the text they are given, and that the numbers they answer are reqtools'.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DialogChannel, prescanDialog } from './dialog'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { Runtime } from './runtime'
import { finishRequester, requesterScript, startRequester, REQ_INPUT_ZONE } from './requester'
import type { RequesterSpec } from './requester'

const FIXTURES = join(__dirname, '..', '..', 'fixtures')
const DEFAULT_ABK = join(FIXTURES, 'official-amos', 'APSystem', 'AMOSPro_Default_Resource.Abk')

const table = new TokenTable(CORE_TOKENS)

function boot(): Runtime {
  const rt = new Runtime(tokenize('Screen Open 0,320,200,16,0', table), table, { maxSteps: 300_000 })
  rt.loadSystemResource(readFileSync(DEFAULT_ABK))
  rt.runHeadless(2_000)
  return rt
}

const ALERT: RequesterSpec = { kind: 'alert', title: 'Careful', body: 'Delete it?', gadgets: ['Yes', 'No'] }

describe('requester scripts are legal Interface', () => {
  it('every shape prescans', () => {
    const specs: RequesterSpec[] = [
      ALERT,
      { kind: 'alert', title: 'Three', body: 'Line one\nLine two\nLine three', gadgets: ['Yes', 'No', 'Cancel'] },
      { kind: 'alert', title: '', body: 'Just so you know', gadgets: [] },
      { kind: 'string', title: 'Name', body: 'Enter a name', def: 'fred', maxLen: 32 },
      { kind: 'long', title: 'Count', body: 'How many?', def: 5, min: 1, max: 99 },
    ]
    for (const spec of specs) {
      const { script } = requesterScript(spec)
      expect(() => prescanDialog(script)).not.toThrow()
    }
  })

  it('puts the strings in variables, never in the script', () => {
    // a body with a quote in it would end an Interface string literal early;
    // this is why nothing user-supplied is spliced into the text
    const { script, vars } = requesterScript({
      kind: 'alert',
      title: "Wasn't it?",
      body: "It's gone",
      gadgets: ["Don't", 'Do'],
    })
    expect(script).not.toContain("It's")
    expect(script).not.toContain("Don't")
    // 0 is the title, 1.. the body a line each, then the gadget labels
    expect(vars[0]).toBe("Wasn't it?")
    expect(vars[1]).toBe("It's gone")
    expect(vars[2]).toBe("Don't")
    expect(vars[3]).toBe('Do')
    expect(() => prescanDialog(script)).not.toThrow()
  })

  it('draws with primitives only, so any resource bank renders it', () => {
    // program 4 of the default bank is the model: no UN, no BO, because those
    // are 9-patches out of a bank whose image numbering is not ours
    const { script } = requesterScript(ALERT)
    expect(script).not.toMatch(/\bUN /)
    expect(script).not.toMatch(/\bBO /)
    expect(script).toContain('GB 0,0,SX,SY')
    expect(script).toContain('GS 0,0,SX1-,SY1-')
  })

  it('binds Return to the first gadget and Escape to the last', () => {
    const { script } = requesterScript(ALERT)
    expect(script).toContain('KY 13,0')
    expect(script).toContain('KY 27,0')
  })

  it('widens to fit the longest line and the gadget strip', () => {
    const narrow = requesterScript({ kind: 'alert', title: '', body: 'Hi', gadgets: ['Ok'] }).script
    const wide = requesterScript({
      kind: 'alert',
      title: '',
      body: 'A very much longer message than the other one indeed',
      gadgets: ['Ok'],
    }).script
    const sizeOf = (s: string): number => Number(/^SI (\d+)SWMI,/.exec(s)![1])
    expect(sizeOf(wide)).toBeGreaterThan(sizeOf(narrow))
    // never narrower than the floor, so a one-word alert is not a slit
    expect(sizeOf(narrow)).toBe(208)
  })

  it('prints every body line, in pen 0 against the pen 1 fill', () => {
    // `PR` draws a string with newlines in it as one run, so a five-line body
    // handed to one PR loses four lines; and a PR in pen 1 on the pen 1 fill
    // that `frame` lays down is invisible on every palette. BUtility's demo
    // opens with a six-line Binforeq and showed neither.
    const { script } = requesterScript({
      kind: 'alert',
      title: 'Butility V1.21 info request',
      body: '----\nButility.Lib V1.21 - FREEWARE\nStart the Butility demo ?',
      gadgets: ['Yes please', 'No'],
    })
    const prs = [...script.matchAll(/PR [^;]+;/g)].map((m) => m[0])
    // the title, three body lines, and a label inside each of the two buttons
    expect(prs).toHaveLength(6)
    // the title bar is filled pen 0 and prints pen 1; everything else sits on
    // the pen 1 fill and prints pen 0
    expect(prs[0]).toMatch(/,1;$/)
    for (const pr of prs.slice(1)) expect(pr).toMatch(/,0;$/)
    expect(prs[1]).toContain('1VACX')
    expect(prs[2]).toContain('2VACX')
    expect(prs[3]).toContain('3VACX')
  })

  it('a titleless alert draws no title bar and starts higher up', () => {
    // `Jd Request` and craft's DisplayAlert have no title to put in one
    const titled = requesterScript(ALERT).script
    const bare = requesterScript({ ...ALERT, title: '' }).script
    expect(titled).toContain('GB 0,0,SX,20')
    expect(bare).not.toContain('GB 0,0,SX,20')
    // the one body line sits at 24 with a title bar above it and at 8 without
    expect(titled).toContain('PR 1VACX,24,')
    expect(bare).toContain('PR 1VACX,8,')
  })

  it('never asks for a box wider or taller than the screen', () => {
    // BUtility's demo rules its requester off with 40 hyphens, which wants
    // 352 pixels; on a 320 screen `BA SWSX- 2/` would centre it at -16 and
    // the left edge, the outlines and the first column of text would all be
    // off the screen
    const { script } = requesterScript({
      kind: 'alert',
      title: '',
      body: '-'.repeat(40),
      gadgets: ['Ok'],
    })
    expect(script).toMatch(/^SI \d+SWMI,\d+SHMI;BA SWSX- 2\/,SHSY- 2\/ 16- 0MA;/)
  })

  it('gives the string requester an ED zone and the numeric one a DI', () => {
    const s = requesterScript({ kind: 'string', title: 'T', body: 'B', def: 'x', maxLen: 12 }).script
    const l = requesterScript({ kind: 'long', title: 'T', body: 'B', def: 7, min: 0, max: 9 }).script
    expect(s).toContain(`ED ${REQ_INPUT_ZONE},16,`)
    expect(s).toContain(',12,4VA,0,1;') // maxlen, then the seeded variable
    expect(l).toContain(`DI ${REQ_INPUT_ZONE},16,`)
    expect(l).toContain(',7,1,0,1;') // value, then flag bit 0 = seed the field
  })
})

describe.skipIf(!existsSync(DEFAULT_ABK))('requesters run on the dialog engine', () => {
  it('an alert stands up, draws its gadgets and blocks', () => {
    const rt = boot()
    const chan = startRequester(rt, ALERT)!
    expect(chan).not.toBeNull()
    const d = rt.dialogs.get(chan)!
    expect(d.drawn).toBe(true)
    // one zone per gadget, and RU parked it
    expect(d.zones.filter((z) => z.kind === 'button').map((z) => z.number)).toEqual([1, 2])
    expect(d.runState).toBe('waiting')
    // each KY adds a keyboard zone of its own pointing back at the button, so
    // Return and Escape reach the gadgets without a click
    const keys = d.zones.filter((z) => z.kind === 'key')
    expect(keys.map((z) => z.code)).toEqual([13, 27])
    expect(keys.map((z) => z.ref?.number)).toEqual([1, 2])
  })

  it('an input requester carries its default into the field', () => {
    const rt = boot()
    const spec: RequesterSpec = { kind: 'string', title: 'Name', body: 'Who?', def: 'fred', maxLen: 32 }
    const chan = startRequester(rt, spec)!
    const d = rt.dialogs.get(chan)!
    const field = d.zones.find((z) => z.number === REQ_INPUT_ZONE)!
    expect(field.kind).toBe('edit')
    expect(field.text).toBe('fred')
    expect(field.maxLen).toBe(32)
  })

  it('a numeric requester seeds its field from the default', () => {
    const rt = boot()
    const spec: RequesterSpec = { kind: 'long', title: 'Count', body: 'How many?', def: 42, min: 1, max: 99 }
    const chan = startRequester(rt, spec)!
    const d = rt.dialogs.get(chan)!
    const field = d.zones.find((z) => z.number === REQ_INPUT_ZONE)!
    expect(field.kind).toBe('digit')
    expect(field.text).toBe('42')
  })
})

describe('the numbers a requester answers are reqtools numbers', () => {
  function done(spec: RequesterSpec, ret: number, text = ''): ReturnType<typeof finishRequester> {
    const rt = { dialogs: new Map<number, DialogChannel>() } as unknown as Runtime
    const d = new DialogChannel(1, 32, { graphics: null, messages: [], programs: null })
    d.runState = 'done'
    d.ret = ret
    if (text !== '') {
      d.zones.push({
        kind: 'edit',
        number: REQ_INPUT_ZONE,
        text,
      } as unknown as (typeof d.zones)[number])
    }
    rt.dialogs.set(1, d)
    return finishRequester(rt, 1, spec)
  }

  it('numbers the rightmost gadget 0 and the rest left to right', () => {
    // rtEZRequest's "Yes|No" answers 1 for Yes and 0 for No, which is why a
    // two-gadget requester reads as a boolean
    expect(done(ALERT, 1)!.ret).toBe(1)
    expect(done(ALERT, 2)!.ret).toBe(0)
    const three: RequesterSpec = { kind: 'alert', title: '', body: 'x', gadgets: ['A', 'B', 'C'] }
    expect(done(three, 1)!.ret).toBe(1)
    expect(done(three, 2)!.ret).toBe(2)
    expect(done(three, 3)!.ret).toBe(0)
  })

  it('an input requester answers 1 for Ok and 0 for Cancel', () => {
    const spec: RequesterSpec = { kind: 'string', title: 'T', body: 'B', def: 'd', maxLen: 8 }
    expect(done(spec, 1, 'typed')).toEqual({ ret: 1, text: 'typed' })
    // Cancel discards the field, so a program cannot read a half-typed answer
    expect(done(spec, 2, 'typed')).toEqual({ ret: 0, text: '' })
  })

  it('a requester still up answers nothing, so the keyword blocks again', () => {
    const rt = { dialogs: new Map<number, DialogChannel>() } as unknown as Runtime
    const d = new DialogChannel(1, 32, { graphics: null, messages: [], programs: null })
    d.runState = 'waiting'
    rt.dialogs.set(1, d)
    expect(finishRequester(rt, 1, ALERT)).toBeNull()
  })

  it('a channel that has gone answers a cancel rather than throwing', () => {
    const rt = { dialogs: new Map<number, DialogChannel>() } as unknown as Runtime
    expect(finishRequester(rt, 1, ALERT)).toEqual({ ret: 0, text: '' })
  })
})
