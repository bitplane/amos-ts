import { describe, expect, it } from 'vitest'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { extensionById } from '../ext/registry'
import { NullAudio } from '../amiga/paula'
import { JOY_FIRE } from '../interp/gameport'
import { Runtime } from './runtime'

const table = new TokenTable(CORE_TOKENS)
/**
 * Slot 22, off `moveq #$15,d0` in routine 0 — which is all of routine 0 —
 * and off the readme's *"put on slot 22 this name: AmosPro_First.lib"*.
 */
const first = extensionById('first-0.1')!

interface Boot {
  rt: Runtime
  audio: NullAudio
  out: () => string
}

function boot(src: string): Boot {
  const exts = new Map([[22, first.table]])
  const audio = new NullAudio()
  let printed = ''
  const rt = new Runtime(tokenize(src, table, exts), table, {
    extensions: exts,
    extBindings: new Map([[22, first]]),
    audio,
    maxSteps: 200_000,
    onText: (t) => (printed += t),
  })
  return { rt, audio, out: () => printed }
}

function run(src: string): Boot {
  const b = boot(src)
  const r = b.rt.runHeadless(2000)
  if (r.status !== 'ended' && r.status !== 'stopped') throw new Error(`program ${r.status}`)
  return b
}

describe('First 0.1 — four keywords in 248 bytes', () => {
  it('Change Led toggles CIA-A PRA bit 1 both ways (routine 3, $6c)', () => {
    // `bchg.b #$1,$bfe001`, and the machine boots with the filter engaged
    const b = run('Change Led')
    expect(b.rt.ledFilter).toBe(false)
    expect(b.audio.filter).toBe(false)
    expect(run('Change Led\nChange Led').rt.ledFilter).toBe(true)
  })

  it('the bit is the one Led On and Led Off drive, so a bchg sees them', () => {
    // the Music extension is not bound here, so the starting state is set
    // directly --- what matters is that both go through Runtime.ledFilter and
    // the bit is therefore READABLE, which is the whole reason it exists
    const b = boot('Change Led')
    b.rt.ledFilter = false
    b.rt.runHeadless(2000)
    expect(b.rt.ledFilter).toBe(true)
    expect(b.audio.filter).toBe(true)
  })

  it('Wait Mouse returns once the LEFT button is down (routine 4, $76)', () => {
    // `btst.b #$6,$bfe001 / beq (done)` --- the line is active low
    const b = boot('Wait Mouse\nPrint 7')
    b.rt.input.mouseK = 1
    b.rt.runHeadless(2000)
    expect(b.out().replace(/\s+/g, '')).toBe('7')
  })

  it('Wait Mouse blocks while the button is up, without spinning', () => {
    // DEVIATION: the original is a bare `btst / beq / bra` that cannot be
    // interrupted; this yields, which is what keeps the program stoppable
    const b = boot('Wait Mouse\nPrint 7')
    expect(b.rt.runHeadless(50).status).not.toBe('ended')
    expect(b.out()).toBe('')
  })

  it('Wait Joy waits on port 1 fire (routine 5, $84)', () => {
    const b = boot('Wait Joy\nPrint 7')
    b.rt.input.joy = JOY_FIRE
    b.rt.runHeadless(2000)
    expect(b.out().replace(/\s+/g, '')).toBe('7')
    expect(boot('Wait Joy\nPrint 7').rt.runHeadless(50).status).not.toBe('ended')
  })

  it('Clear Banks erases every bank (routine 6, $92)', () => {
    // one `Rjsr routine 1107` and an rts; the number is past the end of the
    // label table this port holds, so the behaviour is the readme's
    const b = run('Reserve As Data 1,16\nReserve As Data 2,16\nClear Banks')
    expect(b.rt.memBanks.size).toBe(0)
  })
})
