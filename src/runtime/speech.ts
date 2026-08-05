/**
 * The Music extension's speech keywords (+Music.s), on narrator-ts.
 *
 * Seven keywords, all in amospro-music-2.0 rather than core: Say, Set Talk,
 * Talk Misc, Talk Stop, Mouth Read, Mouth Width, Mouth Height. They drive
 * `translator.library` and `narrator.device`, which narrator-ts reimplements —
 * so this file is the AMOS side only: parameter ranges, the IO-request state
 * the keywords read and write, and the blocking.
 *
 * THE VOICE IS NOT THE AMIGA'S. narrator-ts ships `voice-free.json`, a free
 * rebuild from published phonetics, because narrator.device's own tables are
 * not redistributable. It speaks; it does not sound like a real Amiga.
 * Supplying the original binary is the library's documented upgrade path.
 *
 * The library is loaded on demand — 80K of voice table and 8K of letter-to-
 * sound rules that a program which never speaks should not carry. Say already
 * blocks, so the first one blocks a little longer while the import resolves,
 * and `block(..., true)` re-runs the statement once it has.
 */
import { VI, int, type Value } from '../interp/values'
import type { Func, Instr } from '../interp/builtins'
import type { Runtime } from './runtime'
import { AmosError } from '../interp/values'

/** narrator-ts, once the dynamic import has resolved. */
export interface SpeechLib {
  speak: (input: Uint8Array, voice: unknown, opts: Record<string, unknown>) => {
    pcm: Int8Array
    sampleRate: number
    sentences: Array<{ mouths?: Uint8Array }>
  }
  translate: (text: string, tables: unknown) => { phonemes: string }
  voice: unknown
  rules: unknown
}

/**
 * The narrator write/read IO request, as +Music.s uses it. The offsets in the
 * comments are the ones the source pokes, so the ranges can be checked against
 * it directly.
 */
export interface SpeechState {
  lib: SpeechLib | null
  loading: boolean
  /** the import failed — say nothing rather than retry every statement */
  failed: boolean
  /** `48(a1)`, words per minute, 40..400 */
  rate: number
  /** `50(a1)`, 65..320 */
  pitch: number
  /** `52(a1)`, one bit */
  mode: number
  /** `54(a1)`, one bit */
  sex: number
  /** `62(a1)`, 0..64 */
  volume: number
  /** `64(a1)`, 5000..25000 */
  sampfreq: number
  /** `66(a1)` — non-zero only for the asynchronous Say that asks for mouths */
  mouthsOn: boolean
  /** the stream that Say produced, and how far Mouth Read has walked it */
  mouths: Uint8Array | null
  mouthAt: number
  /** `88(a0)` and `89(a0)`, both -1 when there is nothing to read */
  width: number
  height: number
}

export function newSpeechState(): SpeechState {
  return {
    lib: null,
    loading: false,
    failed: false,
    // narrator.device's own defaults, which +Music.s never overrides at open
    rate: 150,
    pitch: 110,
    mode: 0,
    sex: 0,
    volume: 64,
    sampfreq: 22200,
    mouthsOn: false,
    mouths: null,
    mouthAt: 0,
    width: -1,
    height: -1,
  }
}

/**
 * Start the import if it has not started, and answer whether the library is
 * ready. Everything narrator-ts needs is reachable from its published entry
 * points; the two JSON tables are separate exports so a caller that supplies
 * its own voice does not pay for the free one.
 */
export function ensureLib(rt: Runtime): boolean {
  const s = rt.speech
  if (s.lib !== null || s.failed) return s.lib !== null
  if (!s.loading) {
    s.loading = true
    void (async () => {
      try {
        const [narrator, translator, voice, rules] = await Promise.all([
          import('narrator-ts'),
          import('narrator-ts/translator'),
          import('narrator-ts/reference/voice-free.json', { with: { type: 'json' } }),
          import('narrator-ts/reference/nrl-table.json', { with: { type: 'json' } }),
        ])
        s.lib = {
          speak: narrator.speak as SpeechLib['speak'],
          translate: translator.translate as SpeechLib['translate'],
          voice: (voice as { default: unknown }).default ?? voice,
          rules: (rules as { default: unknown }).default ?? rules,
        }
      } catch {
        // no narrator-ts in this build: Say becomes silent rather than fatal
        s.failed = true
      } finally {
        s.loading = false
      }
    })()
  }
  return false
}

/** Latin-1 bytes, which is what the device reads. */
function latin1(text: string): Uint8Array {
  const out = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff
  return out
}

/**
 * Speak one utterance for the `SPEAK:` handler.
 *
 * Separate from `Say` because the two share only narrator-ts. `Say` is a
 * Music-extension keyword reading the IO-request state that `Set Talk` and
 * `Talk Misc` write; `SPEAK:` is an AmigaDOS handler whose voice comes from
 * its own path (`src/amiga/speak.ts`), so a program using both is not two
 * things fighting over one set of registers — on the machine they are two
 * separate opens of narrator.device, and here they are two separate calls.
 *
 * The caller must have established that the library is ready; a call made
 * before that says nothing rather than blocking, since a handler write has no
 * statement to re-run.
 */
export function speakOne(rt: Runtime, text: string, opts: SpeakVoice): void {
  const s = rt.speech
  if (s.lib === null) return
  const lib = s.lib
  // `/r` means the program supplies phonemes; otherwise translator.library
  const phonemes = opts.raw ? latin1(`${text}Q#U\0\0`) : latin1(lib.translate(text, lib.rules).phonemes)

  let out
  try {
    out = lib.speak(phonemes, lib.voice, {
      pitch: opts.pitch,
      mode: opts.mode,
      sex: opts.sex,
      rate: opts.rate,
      sampfreq: s.sampfreq,
      mouths: false,
    })
  } catch {
    // not pronounceable: the device reports it in io_Error and says nothing
    return
  }
  if (out.pcm.length === 0) return
  rt.stopVoices(0b0001)
  rt.playPcm(0b0001, out.pcm, out.sampleRate, false)
  rt.speechRestore = rt.interp.tick + Math.ceil((out.pcm.length / out.sampleRate) * 50)
}

/** The voice settings a SPEAK: path carries — structurally SpeakOptions. */
export interface SpeakVoice {
  rate: number
  pitch: number
  sex: number
  mode: number
  raw: boolean
}

/** EntNul — the value an omitted parameter carries (+Equ.s:67). */
const ENT_NUL = -0x80000000

/**
 * Read up to `n` comma-separated slots, any of which may be empty.
 *
 * `Set Talk ,,300,` is legal and every slot the program leaves out arrives as
 * EntNul, which the routine tests for and skips. The first slot can be empty
 * too, which is the case that reaches keyword dispatch as a bare "," if the
 * handler calls evalInt() straight away — the same trap Border and Get Palette
 * fell into (#90).
 */
function slots(it: Parameters<Instr>[0], n: number): number[] {
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    if (i > 0 && !it.accept(',')) break
    out.push(it.nm() === ',' || it.atStmtEnd() ? ENT_NUL : it.evalInt())
  }
  return out
}

export function makeSpeechInstructions(rt: Runtime): Record<string, Instr> {
  return {
    /**
     * Say a$[,async] (InSay1/InSay2 +Music.s:2535/2540).
     *
     * A leading `~` means the string is already phonemes: the routine skips
     * it, copies the rest verbatim and appends "Q#U" and two NULs. Anything
     * else goes through translator.library.
     *
     * The two forms differ in more than blocking. Only the ASYNCHRONOUS one
     * asks for mouths — `move.b #1,66(a1)`, and the source's own comment is
     * "Generer des mouths!" — where the synchronous one clears that byte. So
     * a program that wants Mouth Read has to say `Say a$,1`, and the
     * talking-head demos do.
     *
     * Say silences the music first (`StopDma` then `VOnOf` with an empty
     * mask, and it clears EnvOn and Noise), and the synchronous form turns
     * the voices back on afterwards. The asynchronous one does not — Talk
     * Stop is what restores them.
     *
     * DEVIATION: the real device allocates its own channels through
     * audio.device and this plays the whole utterance on voice 0. The
     * silencing and restoring are modelled; which channels the narrator
     * itself picked are not.
     */
    say(it) {
      const text = it.evalStr()
      const async = it.accept(',') ? it.evalInt() !== 0 : false
      const s = rt.speech
      if (!ensureLib(rt)) {
        if (s.failed) return
        it.block({ type: 'speech' }, true)
        return
      }
      const lib = s.lib!

      let phonemes: Uint8Array
      if (text.startsWith('~')) {
        phonemes = latin1(text.slice(1) + 'Q#U\0\0')
      } else {
        const t = lib.translate(text, lib.rules)
        phonemes = latin1(t.phonemes)
      }

      rt.stopVoices(0b1111)
      s.mouthsOn = async
      s.mouths = null
      s.mouthAt = 0
      s.width = -1
      s.height = -1

      let out
      try {
        out = lib.speak(phonemes, lib.voice, {
          pitch: s.pitch,
          mode: s.mode,
          sex: s.sex,
          rate: s.rate,
          sampfreq: s.sampfreq,
          mouths: async,
        })
      } catch {
        // the parser found something that is not a phoneme; the device
        // reports it in io_Error and says nothing
        return
      }

      if (async) {
        const parts = out.sentences.map((x) => x.mouths).filter((x): x is Uint8Array => x !== undefined)
        const total = parts.reduce((n, p) => n + p.length, 0)
        const joined = new Uint8Array(total)
        let at = 0
        for (const p of parts) {
          joined.set(p, at)
          at += p.length
        }
        s.mouths = joined
      }

      if (out.pcm.length > 0) rt.playPcm(0b0001, out.pcm, out.sampleRate, false)
      // The synchronous form hands the voices back; the asynchronous one
      // leaves them for Talk Stop.
      if (!async) rt.speechRestore = rt.interp.tick + Math.ceil((out.pcm.length / out.sampleRate) * 50)
    },

    /**
     * Set Talk sex,mode,pitch,rate (InSetTalk +Music.s:2621). Every parameter
     * may be omitted, and an omitted one is EntNul and leaves the field alone.
     * Out of range is a function-call error, not a clamp.
     */
    'set talk'(it) {
      const s = rt.speech
      const [sex, mode, pitch, rate] = slots(it, 4)
      if (sex !== undefined && sex !== ENT_NUL) s.sex = sex & 1
      if (mode !== undefined && mode !== ENT_NUL) s.mode = mode & 1
      if (pitch !== undefined && pitch !== ENT_NUL) {
        if (pitch < 65 || pitch > 320) throw new AmosError('Illegal function call', 23)
        s.pitch = pitch
      }
      if (rate !== undefined && rate !== ENT_NUL) {
        if (rate < 40 || rate > 400) throw new AmosError('Illegal function call', 23)
        s.rate = rate
      }
    },

    /**
     * Talk Misc volume,freq (InTalkMisc +Music.s:4395). Volume 0..64 and the
     * sample frequency 5000..25000 — narrator-ts allows up to 28000, so this
     * is AMOS's tighter bound, not the device's.
     */
    'talk misc'(it) {
      const s = rt.speech
      const [volume, freq] = slots(it, 2)
      if (volume !== undefined && volume !== ENT_NUL) {
        if (volume < 0 || volume > 64) throw new AmosError('Illegal function call', 23)
        s.volume = volume
      }
      if (freq !== undefined && freq !== ENT_NUL) {
        if (freq < 5000 || freq > 25000) throw new AmosError('Illegal function call', 23)
        s.sampfreq = freq
      }
    },

    /**
     * Talk Stop (InTalkStop +Music.s:2777). Only does anything while an
     * asynchronous say is in flight: it clears the mouths byte, aborts the
     * request if it has not finished, waits for it, and puts the music voices
     * back.
     */
    'talk stop'() {
      const s = rt.speech
      if (!s.mouthsOn) return
      s.mouthsOn = false
      s.mouths = null
      s.mouthAt = 0
      s.width = -1
      s.height = -1
      rt.stopVoices(0b0001)
      rt.speechRestore = rt.interp.tick
    },

    /**
     * Mouth Read (InMouthRead +Music.s:4370). Steps the lip-sync stream on by
     * one frame. It needs a translator base, a write request, and that
     * request's mouths byte set — so it does nothing useful unless an
     * asynchronous Say is in flight.
     *
     * Every failure path writes `move.w #-1,88(a0)`, ONE WORD across both
     * bytes, so Mouth Width and Mouth Height both read -1 together. That is
     * the "stop reading" signal, and it is what the demos loop on.
     */
    'mouth read'() {
      const s = rt.speech
      const stream = s.mouths
      if (!s.mouthsOn || stream === null || s.mouthAt >= stream.length) {
        s.width = -1
        s.height = -1
        return
      }
      const byte = stream[s.mouthAt++]!
      // hunk+0x30a0: a width in the low nibble and a height in the high one,
      // which the device splits into the two bytes at 88 and 89
      s.width = byte & 0x0f
      s.height = (byte >> 4) & 0x0f
    },
  }
}

export function makeSpeechFunctions(rt: Runtime): Record<string, Func> {
  return {
    /** =Mouth Width / =Mouth Height (+Music.s:2658/2666), bytes 88 and 89. */
    'mouth width'(): Value {
      return VI(rt.speech.width)
    },
    'mouth height'(): Value {
      return VI(rt.speech.height)
    },
  }
}

/** kept so the import is not dropped as unused in type-only builds */
void int
