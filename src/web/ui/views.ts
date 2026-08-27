/**
 * What a file can be LOOKED at as, which for an AMOS file is several things.
 *
 * An `.AMOS` is a listing and the banks beside it, and a bank is a picture, a
 * sprite sheet, a set of samples or a module. Every one of those already had
 * a reader in this port before the Files panel existed, each written because
 * one keyword needed it: `parseSpriteBank` for `Sprite`, `parseSampleBank`
 * for `Sam Play`, `parsePacPic` for `Unpack`, `parseAmalBank` for `Amal`.
 * Nothing had ever asked all of them about one file.
 *
 * This is the asking. Each view is a label and a function that fills an
 * element, and ./viewer.ts puts tabs above them.
 *
 * ## Sniffed, then named
 *
 * A bank's own eight-character name is the LAST thing consulted. `Samples`
 * has no magic and can only be recognised by its name, but a music bank is
 * identified by `detectModule` reading its bytes, which is right for the
 * corpus: DME parks a THX module in a bank called `THX     ` and Jotre parks
 * one in a bank called whatever the program's author typed.
 *
 * ## Hex is a real answer
 *
 * The last view, and always offered. A bank this port has no reader for is a
 * normal thing to find, and 256 bytes of hex is how anybody has ever started
 * working out what one is. It is what the corpus work in this repo does all
 * day, so the panel may as well do it too.
 */
import { parseAmosFile, parseSpriteBankBody, type Bank, type SpriteBank } from '../../loader/amosfile'
import { parseSampleBank } from '../../runtime/audio'
import { parseAmalBank } from '../../loader/amalbank'
import { parseSource, TokenTable } from '../../tokens/stream'
import { detokSource } from '../../tokens/edtok'
import { CORE_TOKENS } from '../../tokens/tables.gen'
import { extensionTablesFor } from '../../ext/identify'
import { decode as decodePlanes, bankRowBytesFor } from '../../amiga/planar'
import { detectModule, MOD_FORMAT_NAMES } from '../../amiga/modformat'
import { fromPacPic, pictureFromChunky, type Picture } from '../picture'
import { facts } from './list'
import type { View } from './viewer'

/** what a view needs the page to do, which is everything with a side effect */
export interface ViewHost {
  /** run this module through the port's own replayer for it */
  playModule(bankName: string, data: Uint8Array): void
  /** run `Sam Play n` over this bank */
  playSample(bankNumber: number, data: Uint8Array, index: number): void
  onStatus(text: string): void
}

/** 901120 -> "880K", the way a disk was always described */
function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} b`
  const k = bytes / 1024
  return k >= 1024 ? `${(k / 1024).toFixed(1)}M` : `${Math.round(k)}K`
}

/** a canvas showing one decoded picture, at the shape it was drawn to look */
function canvasFor(pic: Picture): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = pic.width
  canvas.height = pic.height
  canvas.className = 'fm-shot'
  canvas.style.width = `min(100%, ${pic.displayWidth}px)`
  canvas.style.aspectRatio = `${pic.displayWidth} / ${pic.displayHeight}`
  const cx = canvas.getContext('2d')
  if (cx) {
    const img = cx.createImageData(pic.width, pic.height)
    img.data.set(pic.pixels)
    cx.putImageData(img, 0, 0)
  }
  return canvas
}

/**
 * One sprite out of a bank, as a picture.
 *
 * A sprite's rows are padded to a whole WORD per plane, which is
 * `bankRowBytesFor` and not `rowBytesFor`: the two conventions differ and
 * mixing them up is what `chipUsed` got wrong once already. The palette is
 * the bank's own 32 entries, shared by every image in it, because that is how
 * `Sprite` and `Paste Icon` use them.
 */
function spritePicture(bank: SpriteBank, index: number): Picture {
  const s = bank.sprites[index]!
  const rowBytes = bankRowBytesFor(s.width)
  const chunky = new Uint8Array(s.width * s.height)
  decodePlanes(s.data, rowBytes * s.height, rowBytes, s.depth, s.width, s.height, chunky)
  return pictureFromChunky({
    width: s.width,
    height: s.height,
    depth: s.depth,
    pixels: chunky,
    palette: bank.palette,
    // A sprite has no display of its own: it is pasted onto whatever screen
    // is open, and a lowres screen is what nearly all of them were drawn for.
    hires: false,
    laced: false,
    ham: false,
    ehb: false,
  })
}

/** a grid of images, which is what a sprite or icon bank is */
function imagesView(bank: SpriteBank): View {
  return {
    id: 'images',
    label: bank.kind === 'icons' ? 'Icons' : 'Sprites',
    count: bank.sprites.length,
    mount(host) {
      const grid = document.createElement('div')
      grid.className = 'vw-grid'
      bank.sprites.forEach((s, i) => {
        const cell = document.createElement('figure')
        cell.className = 'vw-cell'
        // Each image at its own size rather than stretched to a tile: a
        // 16x16 icon beside a 64x48 ship is information about the bank.
        try {
          cell.appendChild(canvasFor(spritePicture(bank, i)))
        } catch {
          const bad = document.createElement('div')
          bad.className = 'vw-bad'
          bad.textContent = 'would not decode'
          cell.appendChild(bad)
        }
        const cap = document.createElement('figcaption')
        cap.textContent = `${i + 1}: ${s.width}x${s.height}, ${s.depth}p`
        cell.appendChild(cap)
        grid.appendChild(cell)
      })
      host.appendChild(grid)
    },
  }
}

/** the samples in a `Samples` bank, each with a button that plays it */
function samplesView(number: number, data: Uint8Array, hostApi: ViewHost): View {
  const samples = parseSampleBank(data)
  return {
    id: 'samples',
    label: 'Samples',
    count: samples.length,
    mount(host) {
      const table = document.createElement('div')
      table.className = 'vw-rows'
      samples.forEach((s, i) => {
        const row = document.createElement('div')
        const play = document.createElement('button')
        play.type = 'button'
        play.className = 'act'
        play.textContent = '▶'
        play.title = `Sam Play ${i + 1}`
        // Sam Play counts from one, which is what a program types
        play.addEventListener('click', () => hostApi.playSample(number, data, i + 1))
        const name = document.createElement('span')
        name.textContent = s.name === '' ? `sample ${i + 1}` : s.name
        const detail = document.createElement('span')
        detail.className = 'vw-detail'
        // The length in SAMPLES and the rate it was recorded at, because
        // together they are the only thing that says how long it lasts.
        const secs = s.freq > 0 ? (s.pcm.length / s.freq).toFixed(2) : '?'
        detail.textContent = `${s.pcm.length} bytes · ${s.freq} Hz · ${secs}s`
        row.append(play, name, detail)
        table.appendChild(row)
      })
      host.appendChild(table)
      if (samples.length === 0) host.appendChild(facts([['holds', 'no samples this can read']]))
    },
  }
}

/** a module in a bank, with the button that runs it through this port */
function musicView(bankName: string, data: Uint8Array, format: string, hostApi: ViewHost): View {
  return {
    id: 'music',
    label: 'Music',
    mount(host) {
      host.appendChild(
        facts([
          ['format', format],
          ['size', sizeText(data.length)],
        ]),
      )
      const play = document.createElement('button')
      play.type = 'button'
      play.className = 'act'
      play.textContent = '▶ play'
      play.title = 'write the AMOS program that plays it, and run that'
      play.addEventListener('click', () => hostApi.playModule(bankName, data))
      host.appendChild(play)
    },
  }
}

/** an AMAL bank: the animation programs, as the source they were written in */
function amalView(data: Uint8Array): View {
  const bank = parseAmalBank(data)
  return {
    id: 'amal',
    label: 'AMAL',
    count: bank.programs.length,
    mount(host) {
      const moves = bank.movements.filter((m) => m !== null).length
      host.appendChild(
        facts([
          ['programs', String(bank.programs.length)],
          ['movements', String(moves)],
        ]),
      )
      const pre = document.createElement('pre')
      pre.className = 'fm-text'
      pre.textContent = bank.programs.map((p, i) => `; program ${i}\n${p}`).join('\n\n')
      host.appendChild(pre)
    },
  }
}

/** how much of a bank the hex view shows before it stops */
const HEX_LIMIT = 4096

/**
 * Bytes, sixteen to a line, with the printable ones beside them.
 *
 * The oldest tool there is and the one that answers a question no decoder
 * can: what IS this. Every bank this port learned to read started as somebody
 * looking at exactly this.
 */
function hexView(data: Uint8Array): View {
  return {
    id: 'hex',
    label: 'Hex',
    mount(host) {
      const n = Math.min(data.length, HEX_LIMIT)
      const lines: string[] = []
      for (let at = 0; at < n; at += 16) {
        const row = data.subarray(at, Math.min(at + 16, n))
        const hex = [...row].map((b) => b.toString(16).padStart(2, '0')).join(' ')
        // Latin-1's printable range, because that is what an Amiga wrote:
        // anything outside it is a dot rather than a guess at what it meant.
        const text = [...row].map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join('')
        lines.push(`${at.toString(16).padStart(6, '0')}  ${hex.padEnd(47)}  ${text}`)
      }
      const pre = document.createElement('pre')
      pre.className = 'fm-text vw-hex'
      pre.textContent = lines.join('\n')
      host.appendChild(pre)
      if (data.length > HEX_LIMIT) {
        const more = document.createElement('p')
        more.className = 'fm-more'
        more.textContent = `first ${HEX_LIMIT} of ${data.length} bytes`
        host.appendChild(more)
      }
    },
  }
}

/** the detokenised listing, which is what a program IS */
function listingView(source: Uint8Array): View {
  return {
    id: 'listing',
    label: 'Listing',
    mount(host) {
      const table = new TokenTable(CORE_TOKENS)
      const lines = parseSource(source, table)
      // A program records an extension keyword as a slot and a token id with
      // no name attached, so without identifying the extension from the ids a
      // listing is right up to the first one and then turns into numbers.
      const text = detokSource(lines, table, { extensions: extensionTablesFor(lines) })
      const pre = document.createElement('pre')
      pre.className = 'fm-text'
      pre.textContent = text
      host.appendChild(pre)
    },
  }
}

/** what one bank turns into, in the order the questions get asked */
function viewForBank(bank: Bank, hostApi: ViewHost, index: number): View {
  if (bank.kind !== 'memory') {
    const v = imagesView(bank)
    return { ...v, id: `bank${index}` }
  }
  const name = bank.name.trim()

  // A module by its BYTES, not by the name of the bank it is in. DME parks a
  // THX module in a bank called `THX` and Jotre parks one in a bank called
  // whatever the author typed.
  const format = detectModule(bank.data)
  if (format !== null) {
    return { ...musicView(name, bank.data, MOD_FORMAT_NAMES[format], hostApi), id: `bank${index}` }
  }

  // The rest have no magic and are known by the name AMOS gives them
  try {
    if (/^Samples/i.test(name)) return { ...samplesView(bank.number, bank.data, hostApi), id: `bank${index}` }
    if (/^Pac\.Pic/i.test(name)) {
      const pic = fromPacPic(bank.data)
      return {
        id: `bank${index}`,
        label: 'Picture',
        mount(host) {
          host.appendChild(canvasFor(pic))
          host.appendChild(
            facts([
              ['size', `${pic.width} x ${pic.height}`],
              ['depth', `${pic.depth} planes, ${1 << pic.depth} colours`],
              ...(pic.mode === '' ? [] : ([['mode', pic.mode]] as [string, string][])),
            ]),
          )
        },
      }
    }
    if (/^Amal/i.test(name)) return { ...amalView(bank.data), id: `bank${index}` }
    // A sprite bank saved on its own has no `AmSp` in front of it: that is
    // what a PowerPacked object bank decrunches to, and `parseSpriteBankBody`
    // exists for exactly that shape.
    if (/^(Sprites?|Icons?)$/i.test(name)) {
      return { ...imagesView(parseSpriteBankBody(bank.data, /icon/i.test(name) ? 'icons' : 'sprites')), id: `bank${index}` }
    }
  } catch {
    // fall through to hex, which is the honest answer for a bank whose
    // reader would not take it
  }
  return { ...hexView(bank.data), id: `bank${index}`, label: name === '' ? `Bank ${bank.number}` : name }
}

/**
 * Every way of looking at one file.
 *
 * `null` when there is nothing to show that the row does not already say,
 * which is what keeps a plain text file from growing a tab bar with one tab
 * on it.
 */
export function viewsFor(bytes: Uint8Array, hostApi: ViewHost): View[] | null {
  let file
  try {
    file = parseAmosFile(bytes)
  } catch {
    return null
  }
  const views: View[] = []
  if (file.source.length > 0) views.push(listingView(file.source))
  file.banks.forEach((bank, i) => {
    try {
      const v = viewForBank(bank, hostApi, i)
      const number = bank.kind === 'memory' ? bank.number : i + 1
      views.push({ ...v, label: `${number}. ${v.label}` })
    } catch {
      views.push({ ...hexView(bank.kind === 'memory' ? bank.data : new Uint8Array(0)), id: `bank${i}` })
    }
  })
  return views.length > 0 ? views : null
}
