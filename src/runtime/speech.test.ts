import { describe, expect, it } from 'vitest'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { extensionById } from '../ext/registry'
import { tokenize } from '../tokens/tokenizer'
import { Runtime } from './runtime'
import { AmigaFS } from '../amiga/vfs'
import { ED_RUN_MESSAGES } from '../interp/errors.gen'
import { modelledLibraries, openLibrary } from '../amiga/exec'
import { importJson } from './speech'

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

/**
 * `SPEAK:` — the AmigaOS speech handler, reached as a file.
 *
 * The rules being pinned live in src/amiga/speak.ts and are unit-tested there
 * without a voice. These are the wiring: that a SPEAK: open is a device and
 * not a file, that writing to it reaches the synthesiser, and that the path's
 * options rather than Set Talk decide the voice.
 */
describe('SPEAK: the speech handler as a file', () => {
  /** a runner with a real filesystem, so "did it write a file" is answerable */
  async function runFs(src: string): Promise<{ rt: Runtime; fs: AmigaFS }> {
    const fs = new AmigaFS()
    fs.mountMemory('DH0')
    const rt = new Runtime(tokenize(src, table, exts), table, { extensions: exts, maxSteps: 500_000, fs })
    for (let i = 0; i < 20; i++) {
      const r = rt.runHeadless(200)
      if (r.status !== 'blocked') return { rt, fs }
      await new Promise((res) => setTimeout(res, 5))
    }
    return { rt, fs }
  }

  it('opens as a device, and writes no file', async () => {
    // the point of the handler: a program gets speech through the file
    // keywords it already uses, and SPEAK: is not a path on any volume
    const { fs } = await runFs('Open Out 1,"SPEAK:" : Print #1,"Hello there." : Close 1')
    expect(fs.read('SPEAK:')).toBe(null)
    expect(fs.read('DH0:SPEAK:')).toBe(null)
  })

  it('a plain file open is untouched by any of this', async () => {
    const { fs } = await runFs('Open Out 1,"DH0:notes.txt" : Print #1,"Hello there." : Close 1')
    const data = fs.read('DH0:notes.txt')
    expect(data).not.toBe(null)
    expect(String.fromCharCode(...data!)).toBe('Hello there.\r\n')
  })

  it('takes its voice from the path, not from Set Talk', async () => {
    // two separate opens of narrator.device on the machine, so Set Talk's
    // state and the handler's are different things
    const { rt } = await runFs('Set Talk 1,1,300,90 : Open Out 1,"SPEAK:OPT p200 r95" : Close 1')
    const c = rt.fileChans.get(1)
    // Close removed it, so re-open to inspect: the assertion that matters is
    // that the parsed voice is the path's
    expect(c).toBeUndefined()
    const { rt: rt2 } = await runFs('Set Talk 1,1,300,90 : Open Out 1,"SPEAK:OPT p200 r95"')
    expect(rt2.fileChans.get(1)!.speak!.voice).toMatchObject({ pitch: 200, rate: 95 })
    expect(rt2.speech.pitch).toBe(300) // Set Talk's, untouched
  })

  it('holds a semicolon-continued sentence until it is terminated', async () => {
    const { rt } = await runFs(
      ['Open Out 1,"SPEAK:"', 'Print #1,"hello ";', 'Print #1,"there";'].join('\n'),
    )
    // nothing terminated it, so nothing has been spoken and it is still held
    expect(rt.fileChans.get(1)!.speak).toBeTruthy()
    expect(rt.fileChans.get(1)!.out.length).toBe(11)
  })

  it('speaks, and the audio reaches voice 0', async () => {
    // the end-to-end path: text -> translator -> narrator -> playPcm. The
    // channel is what proves it got as far as audio.
    const { rt } = await runFs('Open Out 1,"SPEAK:" : Print #1,"hello there." : Close 1')
    expect(rt.speech.lib).not.toBe(null)
    expect(rt.speechRestore).toBeGreaterThan(0)
  })

  it('Append to SPEAK: is Open Out to SPEAK:', async () => {
    // there is nothing to append to; a real handler has no existing contents
    const { rt } = await runFs('Append 1,"SPEAK:OPT/r"')
    expect(rt.fileChans.get(1)!.speak!.voice.raw).toBe(true)
    expect(rt.fileChans.get(1)!.out.length).toBe(0)
  })
})

describe('when the narrator will not open (OpNar +Music.s:2443)', () => {
  it('raises error 185, rather than saying nothing', async () => {
    // `OpNarE` (:2508) is `move.w #7+178,d0 / Rjmp L_Error` --- one error for
    // both halves, OpenDevice on narrator.device and OpenLibrary on
    // translator.library. Going quiet is the one thing the machine does not
    // do, and a silent Say is undiagnosable from outside.
    const rt = new Runtime(tokenize('Say "hello"', table, exts), table, { extensions: exts, maxSteps: 500_000 })
    rt.speech.failed = true
    expect(() => rt.runHeadless(50)).toThrow("Can't open narrator")
  })

  it('names the same error the run-time table does', () => {
    expect(ED_RUN_MESSAGES[185]).toBe("Can't open narrator")
  })
})

describe('the speech chain as the machine reaches it', () => {
  it('answers OpenLibrary for translator.library, which OpNar opens', () => {
    // +Music.s:2489 opens it by name right after narrator.device. The port
    // implements the translation, so answering zero would fail a program
    // that checks, for a facility that is present.
    expect(openLibrary('translator.library', 37)).toBeGreaterThan(0)
    expect(modelledLibraries().some((l) => l.name === 'translator.library')).toBe(true)
  })

  it('lists SPEAK: as a device, because AmigaDOS has one device list', () => {
    // a handler sits in it beside the drives; it is not a filesystem, so it
    // is a name rather than a Volume
    const fs = new AmigaFS()
    fs.mountMemory('DH0')
    expect(fs.handlerNames()).toContain('SPEAK')
    // and not among the volumes, which three page walkers read through
    expect(fs.volumeNames()).not.toContain('SPEAK')
  })
})

describe('importing the voice tables on two hosts that want opposite things', () => {
  it('falls back to a plain import when the attribute is rejected', async () => {
    // Node needs `with { type: 'json' }` (ERR_IMPORT_ATTRIBUTE_MISSING without
    // it); Vite's dev server rewrites the specifier to a JS module served as
    // text/javascript, and a type:'json' assertion against a response that is
    // not application/json has to be rejected. Firefox refuses both tables on
    // the dev server and takes the fallback, which is what made Say report
    // "Can't open narrator" there while every test and the built site passed.
    const tried: string[] = []
    const got = await importJson(
      () => {
        tried.push('attr')
        return Promise.reject(new Error('error loading dynamically imported module'))
      },
      () => {
        tried.push('plain')
        return Promise.resolve({ ok: true })
      },
    )
    expect(tried).toEqual(['attr', 'plain'])
    expect(got).toEqual({ ok: true })
  })

  it('does not reach for the fallback when the attribute works', async () => {
    const tried: string[] = []
    await importJson(
      () => {
        tried.push('attr')
        return Promise.resolve({ ok: true })
      },
      () => {
        tried.push('plain')
        return Promise.resolve({ ok: false })
      },
    )
    expect(tried).toEqual(['attr'])
  })
})
