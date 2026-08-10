/**
 * The OpalVision card and `opal.library`, against Opal Technology's own
 * `devdocs.lha` and against the v4.3 `opal.library` binary inside it.
 *
 * The assertions that carry hunk addresses are reading that binary: no document
 * in the kit says how a pixel is stored, how a frame number reaches a memory
 * segment, or what is inside an `OVTN` chunk, and all three are settled here by
 * the code that does it.
 */
import { describe, expect, it } from 'vitest'
import {
  HIRES24,
  ILACE24,
  OS,
  OVFASTFORMAT,
  OVTN_SIZE,
  OpalVision,
  PLANES15,
  PLANES8,
  SAVEMASK24,
  THUMB_H,
  THUMB_PLANE,
  THUMB_ROW,
  THUMB_W,
  bytesPerLine,
  depthFor,
  frameTarget,
  maxFrames,
  segmentIndex,
} from './opalvision'

const card = (): OpalVision => new OpalVision(0x5600_0000, 0x0200_0000)

/** a virtual screen of the given flags and size */
function screen(ov: OpalVision, flags: number, w: number, h: number): number {
  const s = ov.newScreen(flags, w, h, false)
  expect(s).not.toBe(0)
  return s
}

const setPen = (ov: OpalVision, s: number, r: number, g: number, b: number): void => {
  ov.poke8(s + OS.Pen_R, r)
  ov.poke8(s + OS.Pen_G, g)
  ov.poke8(s + OS.Pen_B, b)
}

/** the RGB the screen holds at (x, y), packed the way `getPixel` packs it */
const at = (ov: OpalVision, s: number, x: number, y: number): [number, number, number] => {
  const v = ov.getPixel(s, x, y)
  return [v & 255, (v >>> 8) & 255, (v >>> 16) & 255]
}

describe('the pixel layout', () => {
  /**
   * `CreateScreen24`: `moveq #$c,d1` for 24-bit and `add.w d1,d1` when HIRES24,
   * which is the AutoDoc's *"4, 8, 12, 16 or 24 entries"* and nothing else.
   */
  it('is twelve planes for 24-bit lores, doubled in hires', () => {
    expect([0, PLANES8, PLANES15].map((f) => depthFor(f))).toEqual([12, 4, 8])
    expect([0, PLANES8, PLANES15].map((f) => depthFor(f | HIRES24))).toEqual([24, 8, 16])
  })

  /** four pixels a byte in lores, and half the pixels in each bank in hires */
  it('never makes BytesPerLine width/8', () => {
    expect(bytesPerLine(320, false)).toBe(80)
    expect(bytesPerLine(640, true)).toBe(80)
    expect(bytesPerLine(368, false)).toBe(92)
  })

  /**
   * Plane `p` carries bit `p` of the component byte as the pair's low half and
   * bit `p + 4` as its high half, most significant pair leftmost. Pure red is
   * therefore `$c0` in each of planes 0 to 3 at pixel 0, and nothing anywhere
   * else.
   */
  it('spreads one component byte over four two-bit planes', () => {
    const ov = card()
    const s = screen(ov, 0, 64, 4)
    setPen(ov, s, 0xff, 0, 0)
    ov.writePixel(s, 0, 0)
    const byte = (p: number): number => ov.peek8(ov.peek32(s + OS.BitPlanes + p * 4))
    expect([0, 1, 2, 3].map(byte)).toEqual([0xc0, 0xc0, 0xc0, 0xc0])
    expect([4, 5, 6, 7, 8, 9, 10, 11].map(byte)).toEqual([0, 0, 0, 0, 0, 0, 0, 0])
    expect(at(ov, s, 0, 0)).toEqual([255, 0, 0])
  })

  it('puts the four pixels of a byte at descending shifts', () => {
    const ov = card()
    const s = screen(ov, 0, 64, 4)
    for (let x = 0; x < 4; x++) {
      setPen(ov, s, 1 << x, 0, 0)
      ov.writePixel(s, x, 0)
    }
    // pixel 0 sets plane 0 at bits 7..6, pixel 1 plane 1 at 5..4, and so on
    const byte = (p: number): number => ov.peek8(ov.peek32(s + OS.BitPlanes + p * 4))
    expect([0, 1, 2, 3].map(byte)).toEqual([0x40, 0x10, 0x04, 0x01])
  })

  /**
   * In hires the odd pixels use the second half of the pointer array — the
   * manual's *"sequential pixels along each horizontal line are situated in
   * alternate banks"* seen from the CPU.
   */
  it('sends odd hires pixels to the second half of the plane array', () => {
    const ov = card()
    const s = screen(ov, HIRES24, 64, 4)
    expect(ov.peek16(s + OS.Depth)).toBe(24)
    setPen(ov, s, 0xff, 0xff, 0xff)
    ov.writePixel(s, 1, 0)
    const byte = (p: number): number => ov.peek8(ov.peek32(s + OS.BitPlanes + p * 4))
    expect(byte(0)).toBe(0)
    expect(byte(12)).toBe(0xc0)
    expect(at(ov, s, 1, 0)).toEqual([255, 255, 255])
    expect(at(ov, s, 0, 0)).toEqual([0, 0, 0])
  })
})

describe('frames and segments', () => {
  /**
   * `WriteFrame24` at hunk $3a36. `UpdatePFStencil24` pins the 8-bit numbering
   * in words: *"the red segment of bank 0 using WriteFrame24(0) and the second
   * playfield into the red segment of bank 1 using WriteFrame24(3)"*, then
   * *"WriteFrame24(1) ... to switch to the green segment"*.
   */
  it('splits an 8-bit frame number into a colour and a slot', () => {
    const t = (n: number): unknown => {
      const f = frameTarget(PLANES8, n)
      return [f.fields[0], f.banks[0], f.colours[0]]
    }
    expect(t(0)).toEqual([0, 0, 0])
    expect(t(1)).toEqual([0, 0, 1])
    expect(t(3)).toEqual([0, 1, 0])
    expect(t(6)).toEqual([1, 0, 0])
  })

  it('gives a 24-bit frame all three colours and one bank', () => {
    expect(frameTarget(0, 1)).toEqual({ banks: [1], fields: [0], colours: [0, 1, 2] })
    expect(frameTarget(0, 2)).toEqual({ banks: [0], fields: [1], colours: [0, 1, 2] })
  })

  /** hires takes both banks and interlace both fields, which is what halves MaxFrames */
  it('spends the bank on hires and the field on interlace', () => {
    expect(frameTarget(HIRES24, 0).banks).toEqual([0, 1])
    expect(frameTarget(ILACE24, 1)).toMatchObject({ banks: [1], fields: [0, 1] })
    expect([
      maxFrames(0),
      maxFrames(HIRES24),
      maxFrames(ILACE24),
      maxFrames(HIRES24 | ILACE24),
    ]).toEqual([4, 2, 2, 1])
  })
})

describe('the frame buffer', () => {
  it('takes a refresh and gives it back to DownLoadFrame24', () => {
    const ov = card()
    const s = screen(ov, 0, 64, 8)
    setPen(ov, s, 10, 20, 30)
    ov.writePixel(s, 5, 3)
    ov.refresh(s)
    ov.clearScreen(s)
    expect(at(ov, s, 5, 3)).toEqual([0, 0, 0])
    ov.downloadFrame(s, 0, 0, 64, 8)
    expect(at(ov, s, 5, 3)).toEqual([10, 20, 30])
  })

  it('puts each component in its own segment', () => {
    const ov = card()
    const s = screen(ov, 0, 64, 8)
    setPen(ov, s, 10, 20, 30)
    ov.writePixel(s, 5, 3)
    ov.refresh(s)
    const off = 3 * 371 + 5
    expect([0, 1, 2].map((c) => ov.segment(segmentIndex(0, 0, c))[off])).toEqual([10, 20, 30])
  })

  /** *"only the segments containing the playfield stencil (green segments)"* */
  it('refreshes green alone once UpdatePFStencil24 has been called', () => {
    const ov = card()
    const s = screen(ov, 0, 64, 8)
    setPen(ov, s, 10, 20, 30)
    ov.rectFill(s, 0, 0, 63, 7)
    ov.pfStencilOnly = true
    ov.refresh(s)
    const off = 0
    expect([0, 1, 2].map((c) => ov.segmentIfWritten(segmentIndex(0, 0, c))?.[off] ?? null)).toEqual(
      [null, 20, null],
    )
  })

  it('separates the write frames', () => {
    const ov = card()
    const s = screen(ov, 0, 64, 8)
    setPen(ov, s, 1, 1, 1)
    ov.rectFill(s, 0, 0, 63, 7)
    ov.refresh(s)
    ov.writeFrame = 1
    setPen(ov, s, 2, 2, 2)
    ov.rectFill(s, 0, 0, 63, 7)
    ov.refresh(s)
    ov.clearScreen(s)
    ov.displayFrame = 0
    ov.downloadFrame(s, 0, 0, 1, 1)
    expect(at(ov, s, 0, 0)).toEqual([1, 1, 1])
    ov.displayFrame = 1
    ov.downloadFrame(s, 0, 0, 1, 1)
    expect(at(ov, s, 0, 0)).toEqual([2, 2, 2])
  })
})

describe('the OVTN thumbnail', () => {
  /** `move.l #$10e0,$b0c0.l`, and twelve planes `$168` apart inside it */
  it('is 4320 bytes of 48 x 30 x 12', () => {
    expect([THUMB_W, THUMB_H, THUMB_ROW, THUMB_PLANE, OVTN_SIZE]).toEqual([48, 30, 12, 360, 4320])
  })

  it('scales a flat screen down to its own colour', () => {
    const ov = card()
    const s = screen(ov, 0, 320, 256)
    setPen(ov, s, 0x40, 0x80, 0xc0)
    ov.setScreen(s)
    const t = ov.thumbnail(s)
    expect(t.length).toBe(OVTN_SIZE)
    // decode the middle pixel back out of the twelve planes
    const px = (x: number, y: number): number[] => {
      const byte = y * THUMB_ROW + (x >> 2)
      const shift = 6 - ((x & 3) << 1)
      const out: number[] = []
      for (let c = 0; c < 3; c++) {
        let v = 0
        for (let p = 0; p < 4; p++) {
          const pair = (t[(c * 4 + p) * THUMB_PLANE + byte]! >> shift) & 3
          v |= (pair & 1) << p
          v |= ((pair >> 1) & 1) << (p + 4)
        }
        out.push(v)
      }
      return out
    }
    expect(px(20, 15)).toEqual([0x40, 0x80, 0xc0])
  })

  /**
   * Hunk $ae34 restores the saved offsets into the scratch structure instead of
   * the source, so they never come back. Reproduced.
   */
  it('leaves the source screen with RelX and RelY zeroed', () => {
    const ov = card()
    const s = screen(ov, 0, 320, 256)
    ov.poke16(s + OS.RelX, 7)
    ov.poke16(s + OS.RelY, 9)
    ov.thumbnail(s)
    expect([ov.peek16(s + OS.RelX), ov.peek16(s + OS.RelY)]).toEqual([0, 0])
  })

  /**
   * The step is the same on both axes, so a 320 x 256 screen scales by 8 and
   * fills 40 of the 48 columns: `(48 - 320/8) / 2` is a four-column border
   * either side, and the 32 rows it wants are clipped back to 30.
   */
  it('keeps the source shape and leaves a border', () => {
    const ov = card()
    const src = screen(ov, 0, 320, 256)
    setPen(ov, src, 0x11, 0x22, 0x33)
    ov.setScreen(src)
    const dst = screen(ov, 0, 320, 256)
    ov.displayThumbnail(dst, ov.thumbnail(src), 8, 4)
    expect(at(ov, dst, 8 + 4, 4)).toEqual([0x11, 0x22, 0x33])
    expect(at(ov, dst, 8 + 43, 4 + 29)).toEqual([0x11, 0x22, 0x33])
    expect(at(ov, dst, 8 + 3, 4)).toEqual([0, 0, 0])
    expect(at(ov, dst, 8 + 44, 4)).toEqual([0, 0, 0])
    expect(at(ov, dst, 8 + THUMB_W, 4)).toEqual([0, 0, 0])
  })
})

describe('IFF', () => {
  const tag = (b: Uint8Array, i: number): string =>
    String.fromCharCode(b[i]!, b[i + 1]!, b[i + 2]!, b[i + 3]!)

  function pattern(ov: OpalVision, s: number, w: number, h: number): void {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        setPen(ov, s, (x * 4) & 255, (y * 8) & 255, (x + y) & 255)
        ov.writePixel(s, x, y)
      }
    }
  }

  /** hunk $a39c writes the thumbnail before BMHD, which is why the reader finds it */
  it('writes OVTN ahead of BMHD', () => {
    const ov = card()
    const s = screen(ov, 0, 64, 16)
    const b = ov.saveIff(s, 0)
    expect([tag(b, 0), tag(b, 8), tag(b, 12), tag(b, 12 + 8 + OVTN_SIZE)]).toEqual([
      'FORM',
      'ILBM',
      'OVTN',
      'BMHD',
    ])
    expect(b[4]! * 0x1000000 + (b[5]! << 16) + (b[6]! << 8) + b[7]!).toBe(b.length - 8)
  })

  it('reports twenty-four planes for a twelve-plane lores screen', () => {
    const ov = card()
    const s = screen(ov, 0, 64, 16)
    const b = ov.saveIff(s, 0)
    let p = 12
    while (tag(b, p) !== 'BMHD')
      p += 8 + ((b[p + 4]! << 24) | (b[p + 5]! << 16) | (b[p + 6]! << 8) | b[p + 7]!)
    expect(b[p + 8 + 8]).toBe(24) // nPlanes
    expect(b[p + 8 + 10]).toBe(1) // ByteRun1
    // PAL 50:43 from the table at hunk $a662
    expect([b[p + 8 + 14], b[p + 8 + 15]]).toEqual([0x32, 0x2b])
  })

  it('round-trips a picture through ByteRun1', () => {
    const ov = card()
    const s = screen(ov, 0, 64, 16)
    pattern(ov, s, 64, 16)
    const back = ov.loadIff(ov.saveIff(s, 0), 0, 8 /* VIRTUALSCREEN24 */, false)
    expect(back).toBeGreaterThan(40)
    expect([ov.peek16(back + OS.Width), ov.peek16(back + OS.Height)]).toEqual([64, 16])
    for (const [x, y] of [
      [0, 0],
      [7, 3],
      [63, 15],
    ] as const) {
      expect(at(ov, back, x, y)).toEqual(at(ov, s, x, y))
    }
  })

  /** *"OVFASTFORMAT - Save as OpalVision fast format"*, and the FORM type says so */
  it('round-trips fast format as raw planes', () => {
    const ov = card()
    const s = screen(ov, 0, 64, 16)
    pattern(ov, s, 64, 16)
    const b = ov.saveIff(s, OVFASTFORMAT)
    expect(tag(b, 8)).toBe('OVFT')
    const back = ov.loadIff(b, 0, 8, false)
    expect(at(ov, back, 9, 5)).toEqual(at(ov, s, 9, 5))
  })

  /**
   * The fast-format length counts the colour planes and the mask goes out after
   * it, so the chunk under-reports by exactly one mask plane. Reproduced.
   */
  it('writes a short BODY length for fast format plus a mask', () => {
    const ov = card()
    const s = screen(ov, 0, 64, 16)
    const mask = ov.pool.alloc((64 >> 3) * 16, { clear: true })
    ov.poke32(s + OS.MaskPlane, mask)
    const b = ov.saveIff(s, OVFASTFORMAT | SAVEMASK24)
    let p = 12
    while (tag(b, p) !== 'BODY')
      p += 8 + ((b[p + 4]! << 24) | (b[p + 5]! << 16) | (b[p + 6]! << 8) | b[p + 7]!)
    const len = (b[p + 4]! << 24) | (b[p + 5]! << 16) | (b[p + 6]! << 8) | b[p + 7]!
    expect(len).toBe(16 * 16 * 12)
    expect(b.length - (p + 8)).toBe(len + (64 >> 3) * 16)
  })

  it('takes a palette-mapped file into 8-bit mode, or 24-bit under FORCE24', () => {
    const ov = card()
    // a 2-plane ILBM, uncompressed, with a four-entry CMAP
    const file = buildIlbm(4, 2, [0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255])
    const eight = ov.loadIff(file, 0, 8, false)
    expect(ov.peek16(eight + OS.Flags) & PLANES8).toBe(PLANES8)
    expect(at(ov, eight, 1, 0)).toEqual([1, 0, 0]) // the index itself
    const forced = ov.loadIff(file, 0, 8 | 1 /* FORCE24 */, false)
    expect(ov.peek16(forced + OS.Flags) & PLANES8).toBe(0)
    expect(at(ov, forced, 1, 0)).toEqual([255, 0, 0]) // through the CMAP
  })

  it('refuses what is not an IFF ILBM', () => {
    const ov = card()
    expect(ov.loadIff(Uint8Array.from([1, 2, 3]), 0, 0, false)).toBe(5) // OL_ERR_FILEREAD
    const notForm = new Uint8Array(16)
    expect(ov.loadIff(notForm, 0, 0, false)).toBe(3) // OL_ERR_NOTIFF
    const wrongType = ov.saveIff(screen(ov, 0, 16, 2), 0).slice()
    wrongType.set([0x41, 0x4e, 0x49, 0x4d], 8) // FORM ANIM
    expect(ov.loadIff(wrongType, 0, 0, false)).toBe(4) // OL_ERR_NOTILBM
  })
})

/**
 * A minimal uncompressed FORM ILBM: `width` x 1, `planes` deep, pixel x holding
 * index x, plus the CMAP given. Enough to exercise the palette-mapped arm.
 */
function buildIlbm(width: number, planes: number, cmap: number[]): Uint8Array {
  const rowBytes = ((width + 15) >> 4) * 2
  const body: number[] = []
  for (let p = 0; p < planes; p++) {
    const row = new Uint8Array(rowBytes)
    for (let x = 0; x < width; x++) if ((x >> p) & 1) row[x >> 3]! |= 0x80 >> (x & 7)
    body.push(...row)
  }
  const out: number[] = []
  const put = (s: string): void => {
    for (const c of s) out.push(c.charCodeAt(0))
  }
  const put32 = (v: number): void => {
    out.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255)
  }
  put('FORM')
  put32(0)
  put('ILBM')
  put('BMHD')
  put32(20)
  out.push(0, width, 0, 1, 0, 0, 0, 0, planes, 0, 0, 0, 0, 0, 1, 1, 0, width, 0, 1)
  put('CMAP')
  put32(cmap.length)
  out.push(...cmap)
  if (cmap.length & 1) out.push(0)
  put('BODY')
  put32(body.length)
  out.push(...body)
  const bytes = Uint8Array.from(out)
  const n = bytes.length - 8
  bytes.set([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255], 4)
  return bytes
}
