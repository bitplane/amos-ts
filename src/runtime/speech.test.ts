import { describe, expect, it } from 'vitest'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { extensionById } from '../ext/registry'
import { tokenize } from '../tokens/tokenizer'
import { Runtime } from './runtime'

const table = new TokenTable(CORE_TOKENS)
// the speech keywords are the Music extension's, not core; slot 1 is its home
const exts = new Map([[1, extensionById('amospro-music-2.0')!.table]])

/**
 * Run to a stop, letting the event loop turn between attempts.
 *
 * The first Say blocks while narrator-ts is imported — 88K of voice table and
 * letter-to-sound rules that a program which never speaks should not carry —
 * and `runHeadless` is synchronous, so the import cannot resolve inside one
 * call. This is what a driver's frame loop does for free.
 */
async function run(src: string, frames = 200): Promise<{ rt: Runtime; out: string }> {
  let out = ''
  const rt = new Runtime(tokenize(src, table, exts), table, {
    extensions: exts,
    maxSteps: 500_000,
    onText: (t) => (out += t),
  })
  for (let i = 0; i < 20; i++) {
    const r = rt.runHeadless(frames)
    if (r.status !== 'blocked') return { rt, out }
    await new Promise((res) => setTimeout(res, 5))
  }
  return { rt, out }
}

describe('Music extension: Say (InSay1/InSay2, +Music.s:2535/2540)', () => {
  it('imports the voice on the first Say and blocks until it lands', async () => {
    const rt = new Runtime(tokenize('Say "hello"', table, exts), table, { extensions: exts, maxSteps: 500_000 })
    // synchronously, nothing can have loaded yet: runHeadless never yields to
    // the event loop, so the import cannot have resolved inside it
    expect(rt.runHeadless(50).status).toBe('blocked')
    expect(rt.speech.lib).toBe(null)
    // then it resolves on its own. Poll rather than sleeping a fixed time —
    // one 50ms wait passed alone and lost the race under a full suite run.
    let status = 'blocked'
    for (let i = 0; i < 40 && status === 'blocked'; i++) {
      await new Promise((res) => setTimeout(res, 10))
      status = rt.runHeadless(50).status
    }
    expect(status).toBe('ended')
    expect(rt.speech.lib).not.toBe(null)
  })

  it('only the asynchronous form generates mouths', async () => {
    // `move.b #1,66(a1)` on the async path — the source's own comment is
    // "Generer des mouths!" — where the synchronous path does `clr.b 66(a1)`.
    const sync = await run('Say "hello there"')
    expect(sync.rt.speech.mouths).toBe(null)
    expect(sync.rt.speech.mouthsOn).toBe(false)

    const async = await run('Say "hello there",1')
    expect(async.rt.speech.mouthsOn).toBe(true)
    expect(async.rt.speech.mouths!.length).toBeGreaterThan(0)
  })

  it('a leading ~ is phonemes, and anything else goes through the translator', async () => {
    const phon = await run('Say "~/HEH4LOW.",1')
    const text = await run('Say "hello",1')
    // both speak; the phoneme form bypasses translation, so the streams differ
    expect(phon.rt.speech.mouths!.length).toBeGreaterThan(0)
    expect(text.rt.speech.mouths!.length).toBeGreaterThan(0)
  })

  it('a string that is not phonemes says nothing rather than failing', async () => {
    // the device reports a parse error in io_Error and speaks nothing
    const { rt } = await run('Say "~!!!!",1')
    expect(rt.speech.mouths).toBe(null)
  })
})

describe('Music extension: the mouth stream (+Music.s:4370/2658/2666)', () => {
  it('Mouth Read walks it, and both readings go to -1 together at the end', async () => {
    // every failure path in InMouthRead is `move.w #-1,88(a0)` — ONE WORD
    // across bytes 88 and 89 — so Mouth Width and Mouth Height both read -1.
    // That is what the talking-head demos loop on.
    const { rt } = await run(
      ['Say "hello",1', 'For I=1 To 4', '  Mouth Read', 'Next I', 'W=Mouth Width : H=Mouth Height'].join('\n'),
    )
    expect(rt.speech.mouthAt).toBe(4)
    expect(rt.speech.width).toBeGreaterThanOrEqual(0)
    expect(rt.speech.height).toBeGreaterThanOrEqual(0)

    const n = rt.speech.mouths!.length
    const past = await run(['Say "hello",1', `For I=1 To ${n + 2}`, '  Mouth Read', 'Next I'].join('\n'))
    expect([past.rt.speech.width, past.rt.speech.height]).toEqual([-1, -1])
  })

  it('reads -1 with no asynchronous Say in flight', async () => {
    const { rt } = await run(['Say "hello"', 'Mouth Read'].join('\n'))
    expect([rt.speech.width, rt.speech.height]).toEqual([-1, -1])
  })

  it('width is the low nibble and height the high one', async () => {
    // hunk+0x30a0 packs both into a byte; the device splits them into 88/89
    const { rt } = await run(['Say "hello",1', 'Mouth Read'].join('\n'))
    const byte = rt.speech.mouths![0]!
    expect(rt.speech.width).toBe(byte & 0x0f)
    expect(rt.speech.height).toBe((byte >> 4) & 0x0f)
  })
})

describe('Music extension: Set Talk, Talk Misc, Talk Stop', () => {
  it('Set Talk sex,mode,pitch,rate takes the ranges the source checks', async () => {
    const { rt } = await run('Set Talk 1,1,200,250')
    const s = rt.speech
    expect([s.sex, s.mode, s.pitch, s.rate]).toEqual([1, 1, 200, 250])
    // 40..400 for rate and 65..320 for pitch — exactly narrator-ts's own bounds
    await expect(run('Set Talk 0,0,64,150')).rejects.toThrow(/function call/)
    await expect(run('Set Talk 0,0,110,401')).rejects.toThrow(/function call/)
  })

  it('an omitted Set Talk parameter leaves its field alone (EntNul)', async () => {
    const { rt } = await run(['Set Talk 1,1,200,250', 'Set Talk ,,300,'].join('\n'))
    const s = rt.speech
    expect(s.pitch).toBe(300) // the one that was given
    expect([s.sex, s.mode, s.rate]).toEqual([1, 1, 250]) // the rest survive
  })

  it('Talk Misc volume,freq clamps to AMOS bounds, not the device s', async () => {
    const { rt } = await run('Talk Misc 32,11000')
    expect([rt.speech.volume, rt.speech.sampfreq]).toEqual([32, 11000])
    // narrator-ts allows sampfreq up to 28000; AMOS refuses past 25000
    await expect(run('Talk Misc 32,26000')).rejects.toThrow(/function call/)
    await expect(run('Talk Misc 65,11000')).rejects.toThrow(/function call/)
  })

  it('Talk Stop ends an asynchronous say and its stream', async () => {
    const { rt } = await run(['Say "hello there",1', 'Mouth Read', 'Talk Stop'].join('\n'))
    expect(rt.speech.mouthsOn).toBe(false)
    expect(rt.speech.mouths).toBe(null)
    expect([rt.speech.width, rt.speech.height]).toEqual([-1, -1])
  })

  it('Talk Stop does nothing when nothing is speaking', async () => {
    await expect(run('Talk Stop')).resolves.toBeTruthy()
  })
})
