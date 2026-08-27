/**
 * A picture file to pixels a canvas can take, for the Files panel.
 *
 * Three decoders exist in this port and none of them had ever been pointed at
 * a file somebody was only LOOKING at: `../amiga/ilbm.ts` reads an IFF into a
 * screen for `Load Iff`, `../amiga/jpeg.ts` is the OpalVision board's, and
 * `../loader/pacpic.ts` unpacks the bank AMOS's own `Pack` writes. This asks
 * them the same question the panel asks about everything else and gets RGBA
 * back.
 *
 * ## The Amiga pixel is not square, in either direction
 *
 * Every PAL screen fills the same display whatever its resolution, so the
 * pixels change shape rather than the picture changing size. A lowres pixel
 * is twice the width of a hires one, and a non-interlaced line is twice the
 * height of an interlaced one. Both halves matter and only doing the first
 * one is worse than doing neither: it stretches a 320x256 picture to 640x256,
 * which is twice as wide as it should be.
 *
 * So the display size is `width * (hires ? 1 : 2)` by
 * `height * (laced ? 1 : 2)`, and every full-screen PAL picture lands on the
 * same 1.25 whichever of the four modes it was drawn in. 320x256, 640x256,
 * 320x512 and 640x512 all come out 640x512.
 *
 * The panel stretches with CSS rather than resampling, so the buffer keeps
 * one sample per stored pixel. The bits are CAMG's, and the fallback for a
 * picture with no CAMG chunk is the width: `printPage` in ./player.ts draws
 * the same conclusion from `page.width <= 400` and for the same reason.
 *
 * ## What it does not do
 *
 * GIF, PCX, BMP and MacPaint are all identified by `../amiga/datatypes.gen.ts`
 * and none of them has a decoder here. The panel says so by name rather than
 * showing an empty box: a format this port can NAME and cannot READ is a
 * different state from one it does not recognise, and the row should say
 * which.
 */
import { parseIlbm } from '../amiga/ilbm'
import { decodeJpeg } from '../amiga/jpeg'
import { colourResolver } from '../amiga/planar'

export interface Picture {
  width: number
  height: number
  /** RGBA, width * height * 4, ready for `putImageData` */
  pixels: Uint8ClampedArray
  /** planes, or 0 for a picture that never had a palette */
  depth: number
  /** how wide it was meant to LOOK, in hires pixels */
  displayWidth: number
  /** and how tall, in interlaced lines */
  displayHeight: number
  /** "HAM", "extra-half-brite", "hires", "interlaced", or '' */
  mode: string
}

/** $8000 hires, $4 lace, $800 HAM, $80 extra-half-brite: the CAMG bits */
const CAMG_HIRES = 0x8000
const CAMG_LACE = 0x4
const CAMG_HAM = 0x800
const CAMG_EHB = 0x80

/**
 * An IFF ILBM, through the same reader `Load Iff` uses.
 *
 * EHB is inferred rather than read where the CAMG chunk does not say it: six
 * planes that are not HAM can only be extra-half-brite, which is the same
 * conclusion `Screen.ehb` draws from the hardware and the same one the
 * hardware itself draws.
 */
function fromIlbm(bytes: Uint8Array): Picture {
  const img = parseIlbm(bytes)
  const ham = (img.mode & CAMG_HAM) !== 0
  const ehb = !ham && ((img.mode & CAMG_EHB) !== 0 || (img.depth === 6 && img.palette.length <= 32))
  const pal = img.palette
  const hi = (i: number): number => pal[i % Math.max(pal.length, 1)] ?? 0
  const out = new Uint8ClampedArray(img.width * img.height * 4)

  // Row by row, because HAM is a state machine: three of its four codes
  // modify the colour the previous pixel left, and the hardware restarts from
  // the border colour at the beginning of every line.
  for (let y = 0; y < img.height; y++) {
    const resolve = colourResolver({ hi, lo: hi, ham, ehb })
    for (let x = 0; x < img.width; x++) {
      const at = y * img.width + x
      const rgb = resolve(img.pixels[at] ?? 0)
      out[at * 4] = (rgb >> 16) & 0xff
      out[at * 4 + 1] = (rgb >> 8) & 0xff
      out[at * 4 + 2] = rgb & 0xff
      out[at * 4 + 3] = 255
    }
  }

  const hires = (img.mode & CAMG_HIRES) !== 0 || (img.mode === 0 && img.width > 400)
  // A picture with no CAMG chunk and more than 400 lines was interlaced,
  // by the same argument the width makes about hires: PAL is 256 lines and
  // there is nowhere else for the other 256 to have come from.
  const laced = (img.mode & CAMG_LACE) !== 0 || (img.mode === 0 && img.height > 400)
  const modes = [
    ...(ham ? ['HAM'] : ehb ? ['extra-half-brite'] : []),
    ...(hires ? ['hires'] : []),
    ...(laced ? ['interlaced'] : []),
  ]
  return {
    width: img.width,
    height: img.height,
    pixels: out,
    depth: img.depth,
    displayWidth: img.width * (hires ? 1 : 2),
    displayHeight: img.height * (laced ? 1 : 2),
    mode: modes.join(', '),
  }
}

/** a JPEG, through the decoder the OpalVision board reads its stills with */
function fromJpeg(bytes: Uint8Array): Picture | null {
  const img = decodeJpeg(bytes)
  if (img === null) return null
  const out = new Uint8ClampedArray(img.width * img.height * 4)
  for (let i = 0; i < img.width * img.height; i++) {
    out[i * 4] = img.pixels[i * 3] ?? 0
    out[i * 4 + 1] = img.pixels[i * 3 + 1] ?? 0
    out[i * 4 + 2] = img.pixels[i * 3 + 2] ?? 0
    out[i * 4 + 3] = 255
  }
  // Not an Amiga picture and never was: a JPEG on an Amiga arrived from
  // somewhere else, so its pixels are square like everybody else's.
  return {
    width: img.width,
    height: img.height,
    pixels: out,
    depth: 0,
    displayWidth: img.width,
    displayHeight: img.height,
    mode: '',
  }
}

/**
 * Decode what `../web/kinds.ts` called a picture, or null.
 *
 * `name` is the datatype's own name, which is what tells ILBM from JPEG
 * without sniffing the bytes a second time.
 */
export function decodePicture(bytes: Uint8Array, name: string): Picture | null {
  try {
    if (name === 'ILBM') return fromIlbm(bytes)
    if (name === 'JPEG') return fromJpeg(bytes)
  } catch {
    // A truncated or damaged picture is a normal thing to find on a 30-year
    // old disk. The row says the format and shows nothing, which is more than
    // a thrown exception through the panel's redraw would leave.
    return null
  }
  return null
}
