/**
 * IntuiExtend 2.01b, the IFF group.
 *
 * The pictures are built here with ../amiga/ilbm.ts rather than vendored, so
 * what a test asserts about a chunk is asserted against bytes it wrote. What
 * is pinned is the veneer: which iff.library entry each keyword reaches, what
 * the two handle shapes hold, and the four places the binary and Iff.guide
 * disagree.
 */
import { describe, expect, it } from 'vitest'
import { mustFinish } from '../testing/run'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/source'
import { extensionById } from '../ext/registry'
import { AmigaFS } from '../amiga/vfs'
import { encodeIlbm, type IlbmImage } from '../amiga/ilbm'
import { xpkPack } from '../amiga/xpkmaster'
import { Runtime } from './runtime'
import { IE_IFF_ERR, IFF_WRITE_MAGIC } from './intuiextendiff'

const table = new TokenTable(CORE_TOKENS)
const ie = extensionById('intuiextend-2.01b')!
const extensions = new Map([[23, ie.table]])

/** a 16x8 four-colour picture with a known pixel at (3,2) */
function picture(mode = 0): IlbmImage {
  const pixels = new Uint8Array(16 * 8)
  pixels[2 * 16 + 3] = 3
  pixels[0] = 1
  return { width: 16, height: 8, depth: 2, mode, palette: [0x000, 0xf00, 0x0f0, 0x00f], pixels }
}

function boot(src: string, files: Record<string, Uint8Array> = {}): { rt: Runtime; out: () => string } {
  let printed = ''
  const fs = new AmigaFS()
  const ram = fs.mountMemory('RAM')
  for (const [name, data] of Object.entries(files)) ram.write([name], data)
  fs.currentDir = 'RAM:'
  const rt = new Runtime(tokenize(src, table, extensions), table, {
    extensions,
    extBindings: new Map([[23, ie]]),
    maxSteps: 500_000,
    fs,
    onText: (t) => (printed += t),
  })
  mustFinish(rt.runHeadless(5000))
  return { rt, out: () => printed }
}

const PIC = { 'pic.iff': encodeIlbm(picture()) }

const vals = (src: string, files: Record<string, Uint8Array> = PIC): number[] =>
  boot(src, files)
    .out()
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(Number)

/** screen 0's RastPort, which is its Screen address plus $54 */
const RP = (Runtime.SCREEN_CTRL_BASE + 0x54) >>> 0
const SCREEN = 'Wb Screen Open 0,0,320,200,3,0\n'

describe('IntuiExtend 2.01b — Iff Open Read and Iff Close', () => {
  /**
   * The answer is the whole file in memory, so the FORM length four bytes in
   * is the file's own.
   */
  it('answers a buffer whose FORM header is the file', () => {
    const out = vals('I=Iff Open Read("RAM:pic.iff")\nPrint I<>0;" ";Leek(I)=$464F524D;" ";Leek(I+8)=$494C424D\n')
    expect(out).toEqual([-1, -1, -1])
  })

  /**
   * `$3ba move.l -(a1),d0` frees using the long in front of the buffer, so
   * that long is the allocation size and it is bigger than the file.
   */
  it('keeps the allocation size in the long before the buffer', () => {
    const out = vals('I=Iff Open Read("RAM:pic.iff")\nPrint Leek(I-4)>Leek(I+4)\n')
    expect(out).toEqual([-1])
  })

  /** a missing file is error 16, and it is 0 rather than -1 */
  it('answers 0 and error 16 for a file that will not open', () => {
    expect(vals('Print Iff Open Read("RAM:nothing.iff")\nPrint Iff Get Error\n')).toEqual([0, IE_IFF_ERR.OPEN])
  })

  /** `$812 move.l $12(a0),d0 / $816 clr.l $12(a0)`: reading an error clears it */
  it('clears the error when it is read', () => {
    expect(vals('A=Iff Open Read("RAM:nothing.iff")\nPrint Iff Get Error;Iff Get Error\n')).toEqual([
      IE_IFF_ERR.OPEN,
      0,
    ])
  })

  /** not FORM and not something xpkmaster will take is error 19 */
  it('answers error 19 for a file that is not IFF at all', () => {
    const junk = { 'junk.bin': new TextEncoder().encode('this is not a picture at all, not even close') }
    expect(vals('A=Iff Open Read("RAM:junk.bin")\nPrint A;Iff Get Error\n', junk)).toEqual([0, IE_IFF_ERR.NOT_IFF])
  })

  /**
   * `Iff Open Read` opens xpkmaster.library for anything that is not FORM,
   * so a crunched picture loads without the program knowing.
   */
  it('decrunches an xpk-packed picture', () => {
    const packed = { 'pic.pp': xpkPack(encodeIlbm(picture()), 'NUKE') }
    expect(vals('I=Iff Open Read("RAM:pic.pp")\nPrint I<>0;" ";Iff Get Width(I)\n', packed)).toEqual([-1, 16])
  })

  /** the buffer is heap memory, so closing one lets the next call have it back */
  it('gives the block back on Iff Close', () => {
    expect(vals('I=Iff Open Read("RAM:pic.iff")\nIff Close I\nJ=Iff Open Read("RAM:pic.iff")\nPrint I=J\n')).toEqual([
      -1,
    ])
  })

  /** `$3ae move.l a1,d0 / beq`: a close of nothing is a no-op */
  it('takes a close of 0', () => {
    expect(vals('Iff Close 0\nPrint 1\n')).toEqual([1])
  })
})

describe('IntuiExtend 2.01b — Iff Find Chunk', () => {
  /**
   * Iff0 documents `(CHKNAME$,BUFF,LEN)` and the spec is `"02,0"`, two
   * arguments. The end of the stream comes from the FORM length, so LEN never
   * had anything to do.
   */
  it('takes two arguments where the guide documents three', () => {
    expect(ie.tokens.find((t) => t.name === 'iff find chunk')!.spec).toBe('02,0')
    expect(() => boot('I=Iff Open Read("RAM:pic.iff")\nA=Iff Find Chunk("BMHD",I,100)\n', PIC)).toThrow()
  })

  /**
   * The answer is the chunk's ID, not its data. So the length is at CHK+4 and
   * Iff0's "CHKLEN=Leek(CHK-4)" reads four bytes in front of the id, which is
   * the tail of whatever came before.
   */
  it('answers the chunk id address, so the length is at CHK+4', () => {
    const out = vals(
      'I=Iff Open Read("RAM:pic.iff")\nC=Iff Find Chunk("BMHD",I)\nPrint Leek(C)=$424D4844;Leek(C+4)\n',
    )
    expect(out).toEqual([-1, 20])
  })

  /** and a chunk that is not there is 0 */
  it('answers 0 for a chunk the file does not hold', () => {
    expect(vals('I=Iff Open Read("RAM:pic.iff")\nPrint Iff Find Chunk("ANNO",I)\n')).toEqual([0])
  })
})

describe('IntuiExtend 2.01b — the BitMapHeader getters', () => {
  /** bmh_Width, bmh_Height, bmh_Left, bmh_Top and bmh_Depth, at 0, 2, 4, 6 and 8 */
  it('reads the five fields the five keywords name', () => {
    const out = vals(
      'I=Iff Open Read("RAM:pic.iff")\n' +
        'Print Iff Get Width(I);Iff Get Height(I);Iff Get Depth(I)\n' +
        'Print Iff Get Xpos(I);Iff Get Ypos(I)\n',
    )
    expect(out).toEqual([16, 8, 2, 0, 0])
  })

  /** `$45a addq.l #$8,d0` turns the chunk address into the BMHD data pointer */
  it('Iff Get Bitmap Header points eight bytes past the chunk id', () => {
    const out = vals('I=Iff Open Read("RAM:pic.iff")\nPrint Iff Get Bitmap Header(I)=Iff Find Chunk("BMHD",I)+8\n')
    expect(out).toEqual([-1])
  })

  /**
   * DEFECT: the five getters never test -$30's answer. A buffer with no BMHD
   * gives 0, and `movea.l d0,a0 / move.w (a0),d3` then reads address 0.
   * `Iff Get Bitmap Header` is the one that hands the 0 back instead.
   */
  it('reads through a null BMHD pointer rather than reporting one', () => {
    // a FORM with a type and no chunks at all
    const bare = new Uint8Array([0x46, 0x4f, 0x52, 0x4d, 0, 0, 0, 4, 0x49, 0x4c, 0x42, 0x4d])
    const out = vals(
      'I=Iff Open Read("RAM:bare.iff")\nPrint Iff Get Bitmap Header(I);Iff Get Width(I);Iff Get Error\n',
      { 'bare.iff': bare },
    )
    expect(out).toEqual([0, 0, IE_IFF_ERR.NO_BMHD])
  })
})

describe('IntuiExtend 2.01b — Iff Get Ctable', () => {
  /**
   * DEFECT: `dbra d4` runs count+1 times where d4 is the colour COUNT, and
   * the count was already saved as the return value. So the keyword reports
   * four colours and writes five words, building the fifth out of the three
   * bytes after the CMAP data.
   */
  it('reports the count but writes one word more than that', () => {
    const out = vals(
      'I=Iff Open Read("RAM:pic.iff")\n' +
        'Reserve As Work 10,64\nC=Start(10)\n' +
        'N=Iff Get Ctable(I,C)\n' +
        'Print N;Deek(C);Deek(C+2);Deek(C+4);Deek(C+6)\n',
    )
    // four colours, and each gun keeps its top four bits: $f00 $0f0 $00f
    expect(out.slice(0, 5)).toEqual([4, 0x000, 0xf00, 0x0f0, 0x00f])
  })

  /** a file with no CMAP answers 0 and writes nothing */
  it('answers 0 when there is no CMAP', () => {
    const bare = new Uint8Array([0x46, 0x4f, 0x52, 0x4d, 0, 0, 0, 4, 0x49, 0x4c, 0x42, 0x4d])
    const out = vals('I=Iff Open Read("RAM:bare.iff")\nReserve As Work 10,64\nC=Start(10)\nPrint Iff Get Ctable(I,C)\n', {
      'bare.iff': bare,
    })
    expect(out).toEqual([0])
  })
})

describe('IntuiExtend 2.01b — Iff Get Vmode', () => {
  /** a CAMG whose low word is not zero comes back untouched */
  it('answers the CAMG value when the file carries one', () => {
    const files = { 'lace.iff': encodeIlbm(picture(0x8004)) }
    expect(vals('I=Iff Open Read("RAM:lace.iff")\nPrint Iff Get Vmode(I)\n', files)).toEqual([0x8004])
  })

  /**
   * With no CAMG it guesses from the BMHD at $858: HIRES only when the depth
   * is 4 or less AND the width is over 400, LACE when the height is 320 or
   * more. A 16x8 picture is neither.
   */
  it('guesses 0 from a small BMHD when there is no CAMG', () => {
    const files = { 'plain.iff': encodeIlbm(picture(0)) }
    expect(vals('I=Iff Open Read("RAM:plain.iff")\nPrint Iff Get Vmode(I)\n', files)).toEqual([0])
  })
})

describe('IntuiExtend 2.01b — decoding a picture', () => {
  /**
   * `$57f6 movea.l $4(a0),a0` is rp_BitMap, so the RastPort is only there to
   * be followed.
   */
  it('Iff Decode Picture puts the pixels in the screen', () => {
    // no Print in this one: AMOS text goes into the same bitmap, and a glyph
    // at the cursor would paint over the first character cell of the picture
    const b = boot(SCREEN + 'I=Iff Open Read("RAM:pic.iff")\nA=Iff Decode Picture(I,' + RP + ')\n', PIC)
    const rp = b.rt.screens.get(0)!.rp
    expect(rp.point(3, 2)).toBe(3)
    expect(rp.point(0, 0)).toBe(1)
    expect(rp.point(5, 5)).toBe(0)
  })

  /** Iff3's "RES=0 Si tout est Ok" */
  it('answers 0 for a picture that decoded', () => {
    expect(vals(SCREEN + 'I=Iff Open Read("RAM:pic.iff")\nPrint Iff Decode Picture(I,' + RP + ')\n')).toEqual([0])
  })

  /**
   * DEFECT: `$5800 moveq #$0,d3` runs whatever -$3c answered, so a decode
   * that failed still reports the 0 Iff3 calls success. Only `Iff Get Error`
   * can tell.
   */
  it('answers 0 for a picture that is not ILBM, and only the error says so', () => {
    const notIlbm = new Uint8Array([0x46, 0x4f, 0x52, 0x4d, 0, 0, 0, 4, 0x53, 0x4d, 0x55, 0x53])
    const out = vals(SCREEN + 'I=Iff Open Read("RAM:s.iff")\nPrint Iff Decode Picture(I,' + RP + ');Iff Get Error\n', {
      's.iff': notIlbm,
    })
    expect(out).toEqual([0, IE_IFF_ERR.NOT_ILBM])
  })

  /** `Iff Display` is the instruction form, and it fills the colour table too */
  it('Iff Display decodes and reads the colour table in one go', () => {
    const b = boot(
      SCREEN + 'I=Iff Open Read("RAM:pic.iff")\nReserve As Work 10,64\nC=Start(10)\nIff Display ' + RP + ',I,C\n',
      PIC,
    )
    expect(b.rt.screens.get(0)!.rp.point(3, 2)).toBe(3)
    // and the second colour of the CMAP, $f00, reached the caller's buffer
    const out = vals(
      SCREEN + 'I=Iff Open Read("RAM:pic.iff")\nReserve As Work 10,64\nC=Start(10)\nIff Display ' + RP + ',I,C\nPrint Deek(C+2)\n',
    )
    expect(out).toEqual([0xf00])
  })
})

describe('IntuiExtend 2.01b — the write side', () => {
  /** the 80-byte handle whose first long is `\0IfH`, and the FORM it starts with */
  it('Iff Open Write hands back a handle carrying the magic', () => {
    const out = vals('W=Iff Open Write("RAM:out.iff")\nPrint W<>0;" ";Leek(W)=' + IFF_WRITE_MAGIC + ';Leek(W+8)\n')
    expect(out).toEqual([-1, -1, 8])
  })

  /** `$afc add.l d3,$8(a2)` keeps the running total beside the file handle */
  it('Iff Write Chunk adds the length to the total at handle+8', () => {
    const out = vals(
      'W=Iff Open Write("RAM:out.iff")\nReserve As Work 10,16\nD=Start(10)\nLoke D,$41424344\n' +
        'Iff Write Chunk D,4 To W\nPrint Leek(W+8)\n',
    )
    expect(out).toEqual([12])
  })

  /** and the file appears when the handle is closed */
  it('writes the bytes out at Iff Close', () => {
    const b = boot(
      'W=Iff Open Write("RAM:out.iff")\nReserve As Work 10,16\nD=Start(10)\nLoke D,$41424344\n' +
        'Iff Write Chunk D,4 To W\nIff Close W\n',
    )
    const got = b.rt.vfs?.readFile('RAM:out.iff')
    expect(got && Array.from(got)).toEqual([0x46, 0x4f, 0x52, 0x4d, 0, 0, 0, 0, 0x41, 0x42, 0x43, 0x44])
  })

  /**
   * DEFECT: both take the library base from `*B`, one of their own integer
   * arguments, and `Iff Save Bitmap` also names -$2a (FindChunk) where
   * SaveBitMap is -$42. Neither can do anything on the machine but jump wild.
   */
  it('Iff Save Bitmap and Iff Save Clip do nothing', () => {
    const b = boot(SCREEN + 'Iff Save Bitmap 1,2 To "RAM:x.iff",3\nIff Save Clip 1,2,3,4,5,6 To "RAM:y.iff",7\nPrint 9\n')
    expect(b.out().trim()).toBe('9')
    expect(b.rt.vfs?.readFile('RAM:x.iff')).toBeNull()
    expect(b.rt.vfs?.readFile('RAM:y.iff')).toBeNull()
  })
})

describe('IntuiExtend 2.01b — the block keywords', () => {
  /** method 1 is ByteRun1, and it round-trips */
  it('packs and unpacks a run with method 1', () => {
    const out = vals(
      'Reserve As Work 10,256\nS=Start(10)\n' +
        'For I=0 To 19 : Poke S+I,7 : Next I\n' +
        'Reserve As Work 11,256\nD=Start(11)\n' +
        'Reserve As Work 12,256\nB=Start(12)\n' +
        'N=Iff Compress Block(S,20 To D,1)\n' +
        'M=Iff Decompress Block(D,20 To B,1)\n' +
        'Print N;M;Peek(B);Peek(B+19)\n',
    )
    // a 20-byte run packs to two bytes, and the unpack answers the length given
    expect(out).toEqual([2, 20, 7, 7])
  })

  /** method 0 falls to exec CopyMemQuick and answers the length it was given */
  it('copies with method 0', () => {
    const out = vals(
      'Reserve As Work 10,64\nS=Start(10)\nPoke S,65 : Poke S+1,66\n' +
        'Reserve As Work 11,64\nD=Start(11)\n' +
        'Print Iff Compress Block(S,2 To D,0);Peek(D);Peek(D+1)\n',
    )
    expect(out).toEqual([2, 65, 66])
  })

  /** `subq.l #$1,d1` leaves anything above 1 to error 28 */
  it('answers error 28 for a compression it does not know', () => {
    const out = vals(
      'Reserve As Work 10,64\nS=Start(10)\nReserve As Work 11,64\nD=Start(11)\n' +
        'Print Iff Compress Block(S,2 To D,2);Iff Get Error\n',
    )
    expect(out).toEqual([0, IE_IFF_ERR.COMPRESSION])
  })

  /** a literal run keeps its bytes, and the count byte is length-1 */
  it('encodes a literal run as length-1 then the bytes', () => {
    const out = vals(
      'Reserve As Work 10,64\nS=Start(10)\nPoke S,1 : Poke S+1,2 : Poke S+2,3\n' +
        'Reserve As Work 11,64\nD=Start(11)\n' +
        'N=Iff Compress Block(S,3 To D,1)\n' +
        'Print N;Peek(D);Peek(D+1);Peek(D+3)\n',
    )
    expect(out).toEqual([4, 2, 1, 3])
  })
})
