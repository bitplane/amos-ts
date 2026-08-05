/**
 * `SPEAK:` — the AmigaOS speech handler, modelled.
 *
 * On a real machine this is a DOS handler, not a file: `L:Speak-Handler`
 * mounted at `SPEAK:` by a Mountlist entry. A program opens it like any other
 * output file and whatever it writes is spoken through `translator.library`
 * and `narrator.device`.
 *
 *     Open Out 1,"SPEAK:"
 *     Print #1,"Hello there."
 *     Close 1
 *
 * That is the whole appeal of it: a program gets speech with no extension
 * loaded and no keywords beyond the file ones it already uses. AMOS programs
 * on the disks use it exactly this way.
 *
 * ## What is evidence here and what is not
 *
 * NOTE: this file is MODELLED, not ported. No Speak-Handler binary or source
 * is held in the corpus — the handler shipped as part of AmigaOS rather than
 * with AMOS, and nothing in `AMOS-Professional-Official/` contains it. So
 * unlike every extension in `src/ext/`, there is no routine to cite and this
 * cannot be marked faithful. Under the tier rule in docs/extensions/README.md
 * it is `manual` evidence: behaviour follows the AmigaDOS description of the
 * handler, and the two decisions below are the ones a reader should distrust
 * first.
 *
 * The VOICE is a separate question and a separate disclaimer: narrator-ts
 * speaks with `voice-free.json`, a rebuild from published phonetics, because
 * narrator.device's own tables are not redistributable. See src/runtime/
 * speech.ts, which says the same thing for `Say`.
 *
 * ## The two modelled decisions
 *
 * **When it speaks.** Text is buffered and an utterance is released at a
 * sentence terminator or a line end — `.`, `\n`, or `\r`. A program building
 * one sentence from several `Print #1,...;` fragments therefore speaks it
 * once, whole, rather than in disconnected pieces, and a program printing
 * whole lines speaks as it runs rather than all at Close. Anything still
 * buffered when the channel closes is spoken then, so nothing is lost.
 *
 * **The options.** `SPEAK:OPT/...` carries voice settings in the filename,
 * which is how a handler takes parameters when its only interface is a path.
 * The letters below are modelled on the AmigaDOS description; an unrecognised
 * one is ignored rather than an error, because a handler that refused to open
 * would break a program that a real machine ran.
 */

/** The four narrator parameters a path may set, plus raw-phoneme mode. */
export interface SpeakOptions {
  /** words per minute, narrator's own range */
  rate: number
  /** 65..320 */
  pitch: number
  /** 0 male, 1 female */
  sex: number
  /** 0 natural, 1 robotic — narrator's "mode" bit */
  mode: number
  /** `/r`: the text is already phonemes and skips the translator */
  raw: boolean
}

/**
 * narrator.device's own defaults, the same ones src/runtime/speech.ts starts
 * `Say` from. A bare `SPEAK:` speaks in this voice.
 */
export const defaultSpeakOptions = (): SpeakOptions => ({
  rate: 150,
  pitch: 110,
  sex: 0,
  mode: 0,
  raw: false,
})

/** narrator's accepted ranges; a value outside one is ignored, not clamped. */
const RANGES: Record<string, [number, number]> = {
  rate: [40, 400],
  pitch: [65, 320],
}

/**
 * Whether a path names the speech handler.
 *
 * AmigaDOS device names are case-insensitive, so `speak:`, `SPEAK:` and
 * `Speak:` are one device. Everything after the colon is the option string.
 */
export function isSpeakPath(path: string): boolean {
  return /^speak:/i.test(path.trim())
}

/**
 * Parse `SPEAK:OPT/r`, `SPEAK:OPT r150 p90`, or a bare `SPEAK:`.
 *
 * Both separators are accepted because both spellings appear in the wild: the
 * `/` form is what the manual's own example uses and the space-separated form
 * is what a Mountlist STARTUP string looks like. Letters are:
 *
 *   `r<n>`  rate, words per minute       `p<n>`  pitch
 *   `s<n>`  sex, 0 male 1 female         `x<n>`  expression/mode, 0 natural
 *   `/r`    raw phonemes, no number      1 robotic
 *
 * A bare `r` with no digits is the raw flag; `r` followed by digits is the
 * rate. That ambiguity is real and is resolved by whether a number follows,
 * which is the only reading under which both documented examples work.
 */
export function parseSpeakOptions(path: string): SpeakOptions {
  const opts = defaultSpeakOptions()
  const tail = path.trim().replace(/^speak:/i, '')
  // everything after the OPT keyword, if there is one; a path with no OPT at
  // all is a plain open and keeps the defaults
  const m = /opt\b/i.exec(tail)
  if (!m) return opts
  const spec = tail.slice(m.index + m[0].length)

  for (const tok of spec.split(/[/\s,]+/)) {
    if (tok === '') continue
    const letter = tok[0]!.toLowerCase()
    const rest = tok.slice(1)
    if (letter === 'r' && rest === '') {
      opts.raw = true
      continue
    }
    if (!/^-?\d+$/.test(rest)) continue // unknown or malformed: ignore it
    const n = Number(rest)
    switch (letter) {
      case 'r':
        if (inRange('rate', n)) opts.rate = n
        break
      case 'p':
        if (inRange('pitch', n)) opts.pitch = n
        break
      case 's':
        opts.sex = n & 1
        break
      case 'x':
        opts.mode = n & 1
        break
      default:
        break // an option this model does not know
    }
  }
  return opts
}

function inRange(key: string, n: number): boolean {
  const [lo, hi] = RANGES[key]!
  return n >= lo && n <= hi
}

/**
 * The write side: bytes in, whole utterances out.
 *
 * Kept separate from the synthesis so the release rule can be tested without a
 * voice, and so `src/amiga` stays free of any dependency on the runtime — the
 * caller supplies the speaking.
 */
export class SpeakBuffer {
  private pending = ''

  /**
   * Feed written text and take back whatever is ready to speak, in order.
   *
   * The terminator is CONSUMED into the utterance for `.` — "Hello." is spoken
   * as a sentence, which is what the translator wants, where a bare newline is
   * a line break and contributes nothing to say.
   */
  feed(text: string): string[] {
    this.pending += text
    const out: string[] = []
    for (;;) {
      const at = this.pending.search(/[.\r\n]/)
      if (at < 0) break
      const ch = this.pending[at]!
      const body = this.pending.slice(0, at).trim()
      this.pending = this.pending.slice(at + 1)
      // a blank line — or a "." with nothing in front of it — says nothing.
      // The test is on the BODY rather than on the utterance, because a lone
      // stop would otherwise survive as the string "." and be handed to the
      // translator, which has no way to pronounce it.
      if (body !== '') out.push(ch === '.' ? `${body}.` : body)
    }
    return out
  }

  /** Whatever is left when the channel closes, if it is worth speaking. */
  flush(): string[] {
    const left = this.pending.trim()
    this.pending = ''
    return left === '' ? [] : [left]
  }
}
