/**
 * Type something and hear it: `translator.library` and the narrator, tried
 * without a program.
 *
 * This exists because `Say` shipped broken on the dev server and nothing on
 * the page could have caught it. The fault was an import attribute the built
 * site accepts and Vite's dev server rejects, so the library never loaded and
 * every `Say` raised error 185. Finding that needed an AMOS program, a
 * keyword and a working audio clock all at once. One text box and a button
 * would have found it in a second.
 *
 * So the box drives the SAME loader `Say` drives, `loadSpeechLib()` in
 * ../../runtime/speech.ts, and the same two calls in the same order:
 * `translate()` then `speak()`. A box that reached for narrator-ts its own
 * way would have gone on working through exactly the failure it is here to
 * catch.
 *
 * What it deliberately does NOT share is the output path. `Say` plays through
 * Paula's voice 0 and stops whatever was on it, which on a page where a demo
 * is running means testing the narrator by interrupting the music. This plays
 * through its own AudioContext, so the machine below is undisturbed.
 *
 * The phonemes are shown because they are the interesting half. This row is
 * `translator.library`'s, and what it produces from English is the thing the
 * row is about; a voice that sounds wrong and a translation that IS wrong
 * look identical through a speaker.
 */
import { loadSpeechLib, latin1, type SpeechLib } from '../../runtime/speech'

/**
 * The ranges +Music.s clamps to, so the box cannot ask for a voice a program
 * could not. `Set Talk` writes pitch and rate, `Talk Misc` the rest, and the
 * offsets in ../../runtime/speech.ts name the IO-request fields each lands
 * in. Defaults are narrator.device's own, which +Music.s never overrides at
 * open.
 */
const RATE = { min: 40, max: 400, def: 150 }
const PITCH = { min: 65, max: 320, def: 110 }
const SAMPFREQ = 22200

function field(label: string, ...parts: HTMLElement[]): HTMLElement {
  const wrap = document.createElement('label')
  wrap.className = 'field'
  const text = document.createElement('span')
  text.textContent = label
  wrap.appendChild(text)
  for (const p of parts) wrap.appendChild(p)
  return wrap
}

/** a range with its own live readout, since a slider alone says no number */
function slider(label: string, range: typeof RATE, unit: string): { row: HTMLElement; read: () => number } {
  const el = document.createElement('input')
  el.type = 'range'
  el.min = String(range.min)
  el.max = String(range.max)
  el.value = String(range.def)
  const out = document.createElement('span')
  out.className = 'field-hint'
  out.textContent = `${range.def} ${unit}`
  el.addEventListener('input', () => (out.textContent = `${el.value} ${unit}`))
  return { row: field(label, el, out), read: () => Number(el.value) }
}

function chooser(options: Array<[string, number]>): { el: HTMLSelectElement; read: () => number } {
  const el = document.createElement('select')
  el.className = 'act'
  for (const [label, value] of options) {
    const o = document.createElement('option')
    o.value = String(value)
    o.textContent = label
    el.appendChild(o)
  }
  return { el, read: () => Number(el.value) }
}

/**
 * Build the box.
 *
 * The library loads on the first Speak rather than when the row opens, which
 * is `ensureLib`'s bargain too: 80K of voice table and 8K of rules is not
 * something a page should fetch because somebody expanded a disclosure.
 */
export function createSpeechBox(): HTMLElement {
  const host = document.createElement('div')
  host.className = 'speechbox'

  const text = document.createElement('input')
  text.type = 'text'
  text.className = 'speech-text'
  text.value = 'hello, i am an amiga'
  text.spellcheck = false
  text.setAttribute('aria-label', 'text to speak')

  const say = document.createElement('button')
  say.type = 'button'
  say.className = 'act'
  say.textContent = 'Speak'

  const line = document.createElement('div')
  line.className = 'speech-line'
  line.appendChild(text)
  line.appendChild(say)
  host.appendChild(line)

  const rate = slider('rate', RATE, 'wpm')
  const pitch = slider('pitch', PITCH, 'Hz')
  host.appendChild(rate.row)
  host.appendChild(pitch.row)

  const sex = chooser([
    ['male', 0],
    ['female', 1],
  ])
  host.appendChild(field('sex', sex.el))

  const mode = chooser([
    ['natural', 0],
    ['robotic', 1],
  ])
  host.appendChild(field('mode', mode.el))

  /** what translator.library made of the text, which is this row's subject */
  const phon = document.createElement('code')
  phon.className = 'speech-phonemes'
  host.appendChild(phon)

  const status = document.createElement('p')
  status.className = 'speech-status'
  host.appendChild(status)

  let lib: SpeechLib | null = null
  let audio: AudioContext | null = null
  let busy = false

  function report(message: string, bad = false): void {
    status.textContent = message
    status.classList.toggle('bad', bad)
  }

  async function run(): Promise<void> {
    if (busy) return
    busy = true
    say.disabled = true
    try {
      if (lib === null) {
        report('loading narrator-ts…')
        lib = await loadSpeechLib()
      }
      const phonemes = lib.translate(text.value, lib.rules).phonemes
      phon.textContent = phonemes

      const out = lib.speak(latin1(phonemes), lib.voice, {
        pitch: pitch.read(),
        mode: mode.read(),
        sex: sex.read(),
        rate: rate.read(),
        sampfreq: SAMPFREQ,
        mouths: false,
      })
      if (out.pcm.length === 0) {
        // the device's own answer to something it cannot pronounce is
        // silence and an io_Error, so this is not a failure of the box
        report('nothing to say: the translation produced no samples')
        return
      }

      // its own context, so a running demo keeps its voices. The narrator's
      // 8-bit signed samples are what Paula would have been fed.
      audio ??= new AudioContext()
      if (audio.state === 'suspended') await audio.resume()
      const buf = audio.createBuffer(1, out.pcm.length, out.sampleRate)
      const chan = buf.getChannelData(0)
      for (let i = 0; i < out.pcm.length; i++) chan[i] = out.pcm[i]! / 128
      const src = audio.createBufferSource()
      src.buffer = buf
      src.connect(audio.destination)
      src.start()

      const ms = Math.round((out.pcm.length / out.sampleRate) * 1000)
      report(`${out.pcm.length} samples at ${out.sampleRate} Hz, ${ms} ms`)
    } catch (e) {
      // the same failure a program gets, spelled the way a program would see
      // it: OpNarE (+Music.s:2482) raises 185 for either half of the chain
      phon.textContent = ''
      report(`narrator-ts did not load — a program here would get error 185, "Can't open narrator". ${String(e)}`, true)
    } finally {
      busy = false
      say.disabled = false
    }
  }

  say.addEventListener('click', () => void run())
  text.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      void run()
    }
  })

  return host
}
