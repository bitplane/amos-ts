/**
 * Opal 1.1, against the shipped `Opal.s` and against Opal Technology's own
 * developer kit — `devdocs.lha`, vendored beside the extension.
 *
 * The extension is a shim, so most of what a keyword does belongs to
 * `opal.library` and is tested in `../amiga/opalvision.test.ts`. What is tested
 * here is the AMOS half: which argument goes where, what each keyword answers,
 * and the three places `Opal.s` is wrong.
 */
import { describe, expect, it } from 'vitest'
import { mustFinish } from '../testing/run'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { extensionById } from '../ext/registry'
import { AmigaFS } from '../amiga/vfs'
import { OS, OVTN_SIZE } from '../amiga/opalvision'
import { Runtime } from './runtime'

const table = new TokenTable(CORE_TOKENS)
/** `ExtNb EQU 21-1` — "NOTE: Extension number is 21." */
const OPAL_SLOT = 21
const opal = extensionById('opal-1.1')!
const extensions = new Map([[OPAL_SLOT, opal.table]])

interface Boot {
  rt: Runtime
  out: () => string
}

function boot(src: string | string[], fs?: AmigaFS): Boot {
  let printed = ''
  const text = Array.isArray(src) ? src.join('\n') : src
  const rt = new Runtime(tokenize(text, table, extensions), table, {
    extensions,
    extBindings: new Map([[OPAL_SLOT, opal]]),
    maxSteps: 4_000_000,
    onText: (t) => (printed += t),
    ...(fs ? { fs } : {}),
  })
  return { rt, out: () => printed }
}

function run(src: string | string[], fs?: AmigaFS): Boot {
  const b = boot(src, fs)
  mustFinish(b.rt.runHeadless(2_000))
  return b
}

/** every printed number, which is how each of these keywords answers */
const vals = (src: string | string[], fs?: AmigaFS): number[] =>
  run(src, fs).out().trim().split(/\s+/).map(Number)

const num = (src: string | string[], fs?: AmigaFS): number => vals(src, fs)[0]!

const withRam = (): AmigaFS => {
  const fs = new AmigaFS()
  fs.mountMemory('RAM')
  return fs
}

describe('screens', () => {
  /** the AutoDoc's own table: lores non-interlaced PAL is 320 x 256 */
  it('Ovopenscreen24 opens 320x256 with twelve planes, and is the display screen', () => {
    expect(
      vals([
        'S=Ovopenscreen24(0)',
        'Print Deek(S);Deek(S+2);Deek(S+4);Deek(S+14)',
        'Print Ovactivescreen24-S',
      ]),
    ).toEqual([320, 256, 12, 80, 0])
  })

  /**
   * DEFECT: `clr.b OS_Pen_R(A0)` and `move.b #$FF,OS_Pen_G(A0)` and no third
   * store, so blue is whatever the structure held. `OpenScreen24` clears it, so
   * the pen is pure green in practice and nothing in the extension makes it so.
   */
  it('Ovopenscreen24 sets only two thirds of the pen', () => {
    expect(vals(['S=Ovopenscreen24(0)', 'Print Peek(S+912);Peek(S+913);Peek(S+914)'])).toEqual([
      0, 255, 0,
    ])
  })

  it('Ovcreatescreen24 takes any size and is never the display screen', () => {
    expect(
      vals(['S=Ovcreatescreen24(0,64,16)', 'Print Deek(S);Deek(S+2);Ovactivescreen24']),
    ).toEqual([64, 16, 0])
  })

  /** *"Returns flags indicating the hardware configuration"* — OVCF_OPALVISION */
  it('Ovconfig24 reports an OpalVision', () => {
    expect(num('Print Ovconfig24')).toBe(1)
  })
})

describe('pixels', () => {
  it('Ovsetpen24 and Ovreadpixel24 round-trip through Ovgetred24 and friends', () => {
    expect(
      vals([
        'S=Ovcreatescreen24(0,64,16)',
        'Ovsetpen24 S,10,20,30',
        'Ovwritepixel24 S,5,7',
        'Ovreadpixel24 S,5,7',
        'Print Ovgetred24(S);Ovgetgreen24(S);Ovgetblue24(S)',
      ]),
    ).toEqual([10, 20, 30])
  })

  /** `move.b` into $390..$392, so only the low byte of each argument survives */
  it('Ovsetpen24 keeps one byte of each component', () => {
    expect(
      vals(['S=Ovcreatescreen24(0,64,16)', 'Ovsetpen24 S,256+7,0,0', 'Print Peek(S+912)']),
    ).toEqual([7])
  })

  it('Ovrectfill24 fills and Ovclearscreen24 empties', () => {
    expect(
      vals([
        'S=Ovcreatescreen24(0,64,16)',
        'Ovsetpen24 S,1,2,3',
        'Ovrectfill24 S,0,0,63,15',
        'Ovreadpixel24 S,63,15 : Print Ovgetred24(S)',
        'Ovclearscreen24 S',
        'Ovreadpixel24 S,63,15 : Print Ovgetred24(S)',
      ]),
    ).toEqual([1, 0])
  })
})

describe('the frame buffer', () => {
  it('Ovrefresh24 then Ovdownloadframe24 brings a picture back', () => {
    expect(
      vals([
        'S=Ovopenscreen24(0)',
        'Ovsetpen24 S,44,55,66',
        'Ovwritepixel24 S,3,2',
        'Ovrefresh24',
        'Ovclearscreen24 S',
        'Ovreadpixel24 S,3,2 : Print Ovgetred24(S)',
        'A=Ovdownloadframe24(S,0,0,8,8)',
        'Ovreadpixel24 S,3,2 : Print Ovgetred24(S);Ovgetgreen24(S);Ovgetblue24(S)',
      ]),
    ).toEqual([0, 44, 55, 66])
  })

  /** *"This function will also zero all bitplanes in memory"* */
  it('Ovclearquick24 empties the buffer as well as the screen', () => {
    expect(
      vals([
        'S=Ovopenscreen24(0)',
        'Ovsetpen24 S,44,0,0',
        'Ovwritepixel24 S,3,2',
        'Ovrefresh24',
        'Ovclearquick24',
        'A=Ovdownloadframe24(S,0,0,8,8)',
        'Ovreadpixel24 S,3,2 : Print Ovgetred24(S)',
      ]),
    ).toEqual([0])
  })
})

describe('image files', () => {
  const SAVE = 'A=Ovsaveiff24(S,"RAM:pic.iff",0,0)'

  it('Ovsaveiff24 answers 0 and writes a FORM ILBM', () => {
    const fs = withRam()
    expect(vals(['S=Ovcreatescreen24(0,64,16)', SAVE, 'Print A'], fs)).toEqual([0])
    const b = fs.readFile('RAM:pic.iff')!
    expect(String.fromCharCode(...b.subarray(0, 4))).toBe('FORM')
    expect(String.fromCharCode(...b.subarray(8, 12))).toBe('ILBM')
  })

  it('Ovloadimage24 and Ovloadiff24 read it back into a virtual screen', () => {
    const fs = withRam()
    const script = (kw: string): string[] => [
      'S=Ovcreatescreen24(0,64,16)',
      'Ovsetpen24 S,9,8,7',
      'Ovwritepixel24 S,11,4',
      SAVE,
      `T=${kw}(0,"RAM:pic.iff",8)`,
      'Print Deek(T);Deek(T+2)',
      'Ovreadpixel24 T,11,4',
      'Print Ovgetred24(T);Ovgetgreen24(T);Ovgetblue24(T)',
    ]
    expect(vals(script('Ovloadimage24'), fs)).toEqual([64, 16, 9, 8, 7])
    expect(vals(script('Ovloadiff24'), fs)).toEqual([64, 16, 9, 8, 7])
  })

  /** *"OL_ERR Codes described in Opallib.h"*: 2 is OL_ERR_OPENFILE */
  it('answers OL_ERR_OPENFILE for a file that is not there', () => {
    expect(num(['Print Ovloadimage24(0,"RAM:none.iff",0)'], withRam())).toBe(2)
  })

  /**
   * The JPEG half of the loader is not written. `OL_ERR_FORMATUNKNOWN` shares
   * its number with `OL_ERR_NOTIFF` and is what the library answers for a file
   * it cannot identify.
   */
  it('answers OL_ERR_FORMATUNKNOWN for a JPEG', () => {
    const fs = withRam()
    fs.writeFile('RAM:pic.jpg', Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]))
    expect(num(['Print Ovloadimage24(0,"RAM:pic.jpg",0)'], fs)).toBe(3)
  })
})

describe('thumbnails', () => {
  it('Ovdisplaythumbnail24 finds the OVTN a save left behind', () => {
    const fs = withRam()
    const b = run(
      [
        'S=Ovcreatescreen24(0,320,256)',
        'Ovsetpen24 S,60,120,180',
        'Ovsetscreen24 S',
        'A=Ovsaveiff24(S,"RAM:pic.iff",0,0)',
        'T=Ovcreatescreen24(0,320,256)',
        'Print Ovdisplaythumbnail24(T,"RAM:pic.iff",0,0)',
        'Ovreadpixel24 T,20,10',
        'Print Ovgetred24(T);Ovgetgreen24(T);Ovgetblue24(T)',
      ],
      fs,
    )
    expect(b.out().trim().split(/\s+/).map(Number)).toEqual([0, 60, 120, 180])
  })

  /** *"NOTHUMBNAIL - Inhibit writing thumb-nail chunk"*, and then there is none */
  it('answers OL_ERR_NOTHUMBNAIL when the save inhibited it', () => {
    const fs = withRam()
    expect(
      num(
        [
          'S=Ovcreatescreen24(0,64,16)',
          'A=Ovsaveiff24(S,"RAM:pic.iff",0,4)',
          'T=Ovcreatescreen24(0,64,16)',
          'Print Ovdisplaythumbnail24(T,"RAM:pic.iff",0,0)',
        ],
        fs,
      ),
    ).toBe(10)
  })

  /**
   * `File` is an AmigaDOS handle, and nothing in this port hands one out except
   * Make's `=Ma Fopen`. Anything else is a `Write()` that fails, which is
   * `OL_ERR_FILEWRITE`.
   */
  it('Ovwritethumbnail24 answers OL_ERR_FILEWRITE for a handle it cannot resolve', () => {
    expect(num(['S=Ovcreatescreen24(0,64,16)', 'Print Ovwritethumbnail24(S,0)'], withRam())).toBe(6)
  })

  it('the chunk it would write is OVTN and 4320 bytes', () => {
    const fs = withRam()
    run(['S=Ovcreatescreen24(0,64,16)', 'A=Ovsaveiff24(S,"RAM:pic.iff",0,0)'], fs)
    const b = fs.readFile('RAM:pic.iff')!
    expect(String.fromCharCode(...b.subarray(12, 16))).toBe('OVTN')
    expect((b[18]! << 8) | b[19]!).toBe(OVTN_SIZE)
  })
})

describe('the extension source is wrong in three places', () => {
  /**
   * DEFECT: `"ovcopperrefres","h"+$80,"00"` declares a function of one integer
   * and routine 79 pops nothing. This port consumes the argument, because the
   * interpreter's stack is not the machine's and leaving a value on it would
   * desync the caller rather than reproduce the leak.
   */
  it('Ovcopperrefresh takes an argument it never reads', () => {
    expect(vals(['Print Ovcopperrefresh(7);', 'Print 1'])).toEqual([0, 1])
  })

  /**
   * DEFECT: the cold start calls `OpenLibrary`, stores the result and returns
   * `moveq #ExtNb,D0` with the comment `;NO ERRORS` either way, so
   * `ErrMess dc.b "Can't Open Opal.Library"` is unreachable. The modelled card
   * is present, which is the arm that has behaviour to reproduce.
   */
  it('never reaches its one error message', () => {
    expect(num('Print Ovconfig24')).toBe(1)
  })

  /** `A_CALLOPAL AmosPatch24` goes in before `OpenScreen24`, not after */
  it('patches the copper before opening the screen', () => {
    const b = run('S=Ovopenscreen24(0)')
    expect(b.rt.opal.ov.patched).toBe(true)
  })
})

describe('the display registers', () => {
  it('Ovsetdisplaybottom24 moves LastCoProIns and Ovcleardisplaybottom24 puts it back', () => {
    expect(
      vals([
        'S=Ovopenscreen24(0)',
        'Ovsetdisplaybottom24 100 : Print Deek(S+34)',
        'Ovcleardisplaybottom24 : Print Deek(S+34)',
      ]),
    ).toEqual([100, 290])
  })

  it('Ovsetrgb24 writes the card palette and not the screen copy', () => {
    const b = run(['S=Ovopenscreen24(0)', 'Ovsetrgb24 3,10,20,30'])
    expect([...b.rt.opal.ov.palette.subarray(9, 12)]).toEqual([10, 20, 30])
    expect(b.rt.opal.ov.peek8(b.rt.opal.ov.active + OS.Palette + 9)).toBe(3)
  })

  /**
   * *"Changing register values in the screen structure does not take effect
   * until an update has been initiated"*, and these are the three updates.
   */
  it('Ovupdateregs24 and Ovupdatepalette24 copy the screen structure onto the card', () => {
    const b = run([
      'S=Ovopenscreen24(0)',
      'Poke S+142,15 : Poke S+143,7 : Poke S+141,2',
      'Ovupdateregs24',
      'Poke S+144,99',
      'Ovupdatepalette24',
      'Ovregwait24',
    ])
    const ov = b.rt.opal.ov
    expect([ov.pixelReadMask, ov.commandReg, ov.palLoadAddress]).toEqual([15, 7, 2])
    // PalLoadAddress rotates the 256 entries, so entry 0 lands at entry 2
    expect(ov.palette[2 * 3]).toBe(99)
  })

  /** *"Encodes the entire CoPro instruction list from the displayed screen structure"* */
  it('Ovupdatecopro24 takes the list from the screen and Ovsetcopro24 writes one back', () => {
    const b = run([
      'S=Ovopenscreen24(0)',
      'Poke S+918,171',
      'Ovupdatecopro24',
      'Ovsetcopro24 5,205',
    ])
    const ov = b.rt.opal.ov
    expect(ov.copro[0]).toBe(171)
    expect(ov.copro[5]).toBe(205)
    // and the write went back into the screen's own copy as well
    expect(ov.peek8(ov.active + OS.CoProData + 5)).toBe(205)
  })

  /**
   * The eight CoPro bit setters are one shape: *"clears the OVPRI bit of all
   * CoPro instructions"*, and its seven siblings. `DUALDISPLAY` is active low,
   * which is why the pair reads backwards.
   */
  it('the CoPro bit setters each move one bit of every instruction', () => {
    const bit = (src: string, mask: number): boolean[] => {
      const ov = run(['S=Ovopenscreen24(0)', src]).rt.opal.ov
      return [(ov.copro[0]! & mask) !== 0, (ov.copro[289]! & mask) !== 0]
    }
    expect(bit('Ovamigapriority', 0x20)).toEqual([false, false])
    expect(bit('Ovpriority', 0x20)).toEqual([true, true])
    expect(bit('Ovdualdisplay24', 0x10)).toEqual([false, false])
    expect(bit('Ovsingledisplay24', 0x10)).toEqual([true, true])
    expect(bit('Ovenableprstencil24', 0x40)).toEqual([true, true])
    expect(bit('Ovenableprstencil24 : Ovdisableprstencil24', 0x40)).toEqual([false, false])
  })

  /**
   * The AutoDoc says Dual Play Field *"sets the DUALPLAYFIELD bit of all CoPro
   * instructions"* and the library does not touch the CoPro: it is fourteen
   * `SetControlBit24` calls setting bit 7 of every control line register, and
   * the CoPro's eight bits do not include one by that name.
   */
  it('Ovdualplayfield24 moves a control line bit and no CoPro bit', () => {
    const ov = run(['S=Ovopenscreen24(0)', 'Ovdualplayfield24']).rt.opal.ov
    expect(ov.controlLines.every((v) => (v & 0x80) !== 0)).toBe(true)
    expect(ov.copro.every((v) => (v & 0x80) === 0)).toBe(true)
    const off = run(['S=Ovopenscreen24(0)', 'Ovdualplayfield24', 'Ovsingleplayfield24']).rt.opal.ov
    expect(off.controlLines.every((v) => (v & 0x80) === 0)).toBe(true)
  })

  /**
   * *"Sets the HIRESDISP bits on CoPro instructions starting at TopLine for
   * 'Lines' number of lines"*, so unlike the eight above these take a range.
   */
  it('Ovsethires24 and Ovsetlores24 take a range of scan lines', () => {
    const ov = run(['S=Ovopenscreen24(0)', 'Ovsethires24 10,5', 'Ovsetlores24 12,1']).rt.opal.ov
    const hires = [9, 10, 11, 12, 13, 14, 15].map((i) => (ov.copro[i]! & 0x08) !== 0)
    expect(hires).toEqual([false, true, true, false, true, true, false])
  })

  /**
   * *"BitNumber = Bit number within control line to modify (4...19)"*, over the
   * fourteen registers the library's own table numbers 0 to 13. `AUTO` is bit 6
   * and `DISPLAYLATCH` bit 10, and the two keywords that own them set the bit
   * in every register at once.
   */
  it('Ovsetcontrolbit24, Ovautosync24 and Ovlatchdisplay24 drive the control lines', () => {
    const ov = run([
      'S=Ovopenscreen24(0)',
      'Ovsetcontrolbit24 2,11,1',
      'Ovautosync24 -1',
      'Ovlatchdisplay24 -1',
    ]).rt.opal.ov
    expect(ov.controlLines[2]! & (1 << 11)).not.toBe(0)
    expect(ov.controlLines[0]! & (1 << 11)).toBe(0)
    // AUTO is cleared by switching auto-sync ON: the bit inhibits it
    expect(ov.controlLines.every((v) => (v & (1 << 6)) === 0)).toBe(true)
    expect(ov.controlLines.every((v) => (v & (1 << 10)) !== 0)).toBe(true)
    expect([ov.autoSync, ov.latched]).toEqual([true, true])
  })
})

describe('the stencils', () => {
  /**
   * The playfield stencil is *"least significant bit of green bank 0"* and the
   * priority stencil *"least significant bit of blue bank 0"* — planes 4 and 8,
   * because plane p carries bit p and each component's bit 0 is its first
   * plane's low half.
   */
  it('Ovwritepfpixel24 and Ovwriteprpixel24 set one bit of a colour plane', () => {
    const b = run([
      'S=Ovcreatescreen24(0,64,4)',
      'Ovsetpen24 S,1,0,0',
      'Ovwritepfpixel24 S,0,0',
      'Ovwriteprpixel24 S,1,0',
    ])
    const ov = b.rt.opal.ov
    const s = ov.screens.keys().next().value!
    const plane = (p: number): number => ov.peek8(ov.peek32(s + OS.BitPlanes + p * 4))
    expect(plane(4)).toBe(0x40) // pixel 0, low half of the pair
    expect(plane(8)).toBe(0x10) // pixel 1
    expect(plane(0)).toBe(0)
  })

  /** *"of all of the pixels in the specified screen"*, so the whole plane */
  it('Ovsetpfstencil24 and its three siblings fill and empty a whole plane', () => {
    const fill = (src: string, p: number): number[] => {
      const ov = run(['S=Ovcreatescreen24(0,64,4)', src]).rt.opal.ov
      const s = ov.screens.keys().next().value!
      const base = ov.peek32(s + OS.BitPlanes + p * 4)
      return [ov.peek8(base), ov.peek8(base + 1)]
    }
    expect(fill('Ovsetpfstencil24 S', 4)).toEqual([0x55, 0x55])
    expect(fill('Ovsetpfstencil24 S : Ovclearpfstencil24 S', 4)).toEqual([0, 0])
    expect(fill('Ovsetprstencil24 S', 8)).toEqual([0x55, 0x55])
    expect(fill('Ovsetprstencil24 S : Ovclearprstencil24 S', 8)).toEqual([0, 0])
  })

  /**
   * DEFECT: the library's only way to READ a stencil pixel is unreachable from
   * AMOS. `ReadPFPixel24` and `ReadPRPixel24` *"return 1 if the corresponding
   * playfield stencil pixel is set, or 0 if it is cleared"*, and the extension
   * declares both as instructions — `"ovreadpfpixel2","4"+$80,"I0,0,0"` — so
   * the answer is computed and dropped. They are kept because the routines are
   * kept, and because a program that calls them must not fault.
   */
  it('Ovreadpfpixel24 and Ovreadprpixel24 compute an answer nothing can see', () => {
    const b = run([
      'S=Ovcreatescreen24(0,64,4)',
      'Ovsetpfstencil24 S',
      'Ovreadpfpixel24 S,0,0',
      'Ovreadprpixel24 S,0,0',
      'Print 1',
    ])
    expect(b.out().trim()).toBe('1')
  })
})

describe('memory format conversion', () => {
  /**
   * *"Converts interleaved bitmap memory into OpalVision memory format"* —
   * ordinary Amiga planes, one bit per pixel, least significant first, all of a
   * row's planes together before the next row's.
   */
  it('Ovilbmtoov reads twenty-four one-bit planes and Ovtoilbm writes them back', () => {
    expect(
      vals([
        'Reserve As Work 10,512',
        'A=Start(10)',
        'S=Ovcreatescreen24(0,64,1)',
        // plane 0 bit 7 is red bit 0; plane 8 bit 7 is green bit 0
        'Poke A,128 : Poke A+64,128',
        'Ovilbmtoov S,A,8,1,0,24',
        'Ovreadpixel24 S,0,0',
        'Print Ovgetred24(S);Ovgetgreen24(S);Ovgetblue24(S)',
        'B=A+256',
        'Ovtoilbm S,B,8,1,0',
        'Print Peek(B);Peek(B+64)',
      ]),
    ).toEqual([1, 1, 0, 128, 128])
  })

  /** *"A pointer to an array of pointers to source Bitplanes"*, so separate planes */
  it('Ovbitplanetoov and Ovtobitplane walk an array of plane pointers', () => {
    expect(
      vals([
        'Reserve As Work 10,1024',
        'A=Start(10)',
        'For I=0 To 23 : Loke A+I*4,A+96+I*8 : Next I',
        'S=Ovcreatescreen24(0,64,1)',
        'Poke A+96+16*8,128', // plane 16 is blue bit 0
        'Ovbitplanetoov S,A,8,1,0,24',
        'Ovreadpixel24 S,0,0',
        'Print Ovgetred24(S);Ovgetblue24(S)',
        'For I=0 To 23 : Loke A+I*4,A+512+I*8 : Next I',
        'Ovtobitplane S,A,8,1,0',
        'Print Peek(A+512+16*8)',
      ]),
    ).toEqual([0, 1, 128])
  })

  /**
   * Three BYTE planes, one per component. The AutoDoc names the third and
   * fourth arguments `Top` and `Left` and then describes them the other way
   * round; Opal's own `Render/Renderer.c` settles it by calling
   * `RGBtoOV (WriteScreen,RGBPlanes,0,Y,3*Width,Lines)` while walking down an
   * image, so the third is x and the fourth is y.
   */
  it('Ovrgbtoov and Ovtorgb move three byte planes', () => {
    expect(
      vals([
        'Reserve As Work 10,512',
        'A=Start(10)',
        'Loke A,A+12 : Loke A+4,A+76 : Loke A+8,A+140',
        'S=Ovcreatescreen24(0,64,2)',
        'Poke A+12,11 : Poke A+76,22 : Poke A+140,33',
        'Ovrgbtoov S,A,0,1,1,1',
        'Ovreadpixel24 S,0,1',
        'Print Ovgetred24(S);Ovgetgreen24(S);Ovgetblue24(S)',
        'Loke A,A+256 : Loke A+4,A+320 : Loke A+8,A+384',
        'Ovtorgb S,A,0,1,1,1',
        'Print Peek(A+256);Peek(A+320);Peek(A+384)',
      ]),
    ).toEqual([11, 22, 33, 11, 22, 33])
  })
})

describe('closing, freeing and the frames', () => {
  it('Ovclosescreen24 takes the display screen away and Ovfreescreen24 a virtual one', () => {
    const b = run([
      'S=Ovopenscreen24(0)',
      'V=Ovcreatescreen24(0,64,4)',
      'Ovclosescreen24',
      'Print Ovactivescreen24',
      'Ovfreescreen24 V',
    ])
    expect(b.out().trim()).toBe('0')
    expect(b.rt.opal.ov.screens.size).toBe(0)
  })

  /**
   * *"The display frame and the write frame, must reside in the same field area
   * ... Due to this DisplayFrame24() has the side effect of changing the write
   * frame if the new display frame is in a different field."* Frames 0 and 1
   * are the two banks of field 0; frame 2 is field 1.
   */
  it('Ovdisplayframe24 and Ovwriteframe24 drag each other across a field boundary', () => {
    const ov = run(['S=Ovopenscreen24(0)', 'Ovwriteframe24 1', 'Ovdisplayframe24 0']).rt.opal.ov
    expect([ov.displayFrame, ov.writeFrame]).toEqual([0, 1])
    const moved = run(['S=Ovopenscreen24(0)', 'Ovwriteframe24 1', 'Ovdisplayframe24 2']).rt.opal.ov
    expect([moved.displayFrame, moved.writeFrame]).toEqual([2, 2])
  })

  /**
   * *"modifies the internal state of the library so that subsequent calls to
   * Refresh24() ... will only update the segments containing the playfield
   * stencil"*, and *"can be returned to normal by calling UpdateAll24()"*.
   */
  it('Ovupdatepfstencil24 narrows the refresh and Ovupdateall24 widens it again', () => {
    const narrow = run([
      'S=Ovopenscreen24(0)',
      'Ovsetpen24 S,7,8,9',
      'Ovwritepixel24 S,0,0',
      'Ovupdatepfstencil24',
      'Ovrefresh24',
    ]).rt.opal.ov
    expect(narrow.segmentIfWritten(0)).toBeNull()
    expect(narrow.segmentIfWritten(1)?.[0]).toBe(8)
    const wide = run([
      'S=Ovopenscreen24(0)',
      'Ovsetpen24 S,7,8,9',
      'Ovwritepixel24 S,0,0',
      'Ovupdatepfstencil24',
      'Ovupdateall24',
      'Ovrefresh24',
    ]).rt.opal.ov
    expect(wide.segmentIfWritten(0)?.[0]).toBe(7)
  })

  /** *"until either Refresh24() or StopUpdate24() is called"* */
  it('Ovstopupdate24 ends the continuous updates Ovupdatedelay24 started', () => {
    const on = run(['S=Ovopenscreen24(0)', 'Ovupdatedelay24 3']).rt.opal.ov
    expect([on.updating, on.updateDelay]).toEqual([true, 3])
    const off = run(['S=Ovopenscreen24(0)', 'Ovupdatedelay24 3', 'Ovstopupdate24']).rt.opal.ov
    expect(off.updating).toBe(false)
  })

  /**
   * *"Updates the frame buffer from a virtual screen ... The 8bit plane display
   * screen opened to perform the update is returned, and should be subsequently
   * closed."* The AutoDoc is firm about whose job that is: *"the display screen
   * opened by LowMemUpdate() MUST be closed by calling CloseScreen24()."*
   */
  it('Ovlowmemupdate24 opens an 8-bit screen, answers it, and pushes the picture', () => {
    const b = run([
      'V=Ovcreatescreen24(0,64,4)',
      'Ovsetpen24 V,3,4,5',
      'Ovwritepixel24 V,0,0',
      'D=Ovlowmemupdate24(V,0)',
      'Print D-Ovactivescreen24;Deek(D+4)',
      'Ovclosescreen24',
    ])
    expect(b.out().trim().split(/\s+/).map(Number)).toEqual([0, 4])
    expect(b.rt.opal.ov.segmentIfWritten(0)?.[0]).toBe(3)
  })

  /** the same *"although it only updates the frame buffer memory"* */
  it('Ovlowmem2update24 leaves the display modes alone', () => {
    const b = run([
      'V=Ovcreatescreen24(0,64,4)',
      'Ovsetpen24 V,3,4,5',
      'Ovwritepixel24 V,0,0',
      'D=Ovlowmem2update24(V,0)',
      'Print D-Ovactivescreen24',
    ])
    expect(b.out().trim()).toBe('0')
    expect(b.rt.opal.ov.segmentIfWritten(2)?.[0]).toBe(5)
  })
})
