/**
 * OpalVision — Opal Technology's 24-bit framebuffer, and `opal.library`.
 *
 * A card in the A2000/A3000 video slot with its own 1.5MB of frame buffer, its
 * own palette and its own line-by-line coprocessor, keyed against the Amiga's
 * output so the two displays can be mixed pixel by pixel. `opal.library` is
 * the card's driver, and Opal 1.1 (`src/runtime/opal.ts`) is an AMOS extension
 * that is almost nothing but a shim over it — so the extension's behaviour IS
 * this library's behaviour, and it belongs here rather than beside the
 * keywords.
 *
 * ## Evidence
 *
 * SOURCE tier for the shim and DISASSEMBLY tier for the library, with the
 * library's own AutoDocs beside it — an unusually good position, and it is
 * the developer kit that supplies both. Opal Technology published the whole
 * thing — `devdocs.lha` on Aminet, uploaded 22 September 1993 — and the
 * fixture carries it:
 *
 * - `devdocs/opal.doc`, the AutoDocs, one entry per library function with the
 *   register each argument arrives in.
 * - `devdocs/OVDevManual.TXT`, the *"OpalVision Programmers Technical Reference
 *   Manual"* v1.2, which describes the hardware the library drives: colour
 *   modes, the two stencils, the memory segments, and every register.
 * - `devdocs/Assembler/opallib.i` and `devdocs/C/opallib.h`, which fix the
 *   OpalScreen structure, the flags and the LVO order.
 * - `devdocs/Libs/opal.library`, the driver binary itself.
 *
 * The archive also contains `AMOS/Opal.lib`, `Opal.s` and `Opal.Readme`, byte
 * for byte the files the extension fixture already held — so the AMOS
 * extension and the library documentation come from one publisher, and Martin
 * Boyd wrote both.
 *
 * **The struct offsets are confirmed twice.** `opallib.i` puts `OS_Pen_R` at
 * 912 and `OS_Red` at 915; `Opal.lib` writes `$390(a0)` and reads `$393(a0)`.
 * The AMOS example program poking `OSCRN+142` is `OS_PixelReadMask`, which is
 * where the include puts it, and its comment says *"set pixel read mask to 0"*.
 *
 * ## The card
 *
 * Memory is *"divided into two Banks and in turn each bank is divided into two
 * fields. Each field is also divided into three regions one each for Red,
 * Green and Blue"* — twelve independently writable segments of 128K, which is
 * what a frame number selects. A 24-bit image needs three segments, so how
 * many whole images fit depends on the resolution, and that count is
 * `MaxFrames`.
 *
 * Two stencils ride in the low bits of the pixel data itself. The **playfield
 * stencil** is *"least significant bit of green bank 0"* and picks between the
 * two banks per pixel; the **priority stencil** is *"least significant bit of
 * blue bank 0"* and picks between Amiga and OpalVision per pixel. Writing one
 * is therefore writing a colour bit, which is why the stencil calls take a
 * screen.
 *
 * ## Planes are two bits wide
 *
 * No document in the kit says how a pixel is stored, and the obvious reading —
 * twenty-four ordinary Amiga bitplanes — is wrong. `WritePixel24` and
 * `CreateScreen24` in the shipped `opal.library` settle it between them: a
 * plane byte holds **four pixels at two bits each**, so 24-bit colour takes
 * twelve planes rather than twenty-four, and a hires screen has twice as many
 * because its even and odd pixels sit in different banks. Plane `p` of a
 * component carries bit `p` of that component's byte as the low half of the
 * pair and bit `p + 4` as the high half. See `depthFor`, `bytesPerLine` and
 * `cell` for the instructions each of those comes from.
 *
 * That is what makes three otherwise puzzling lines of documentation fit: the
 * AutoDoc's *"BitPlanes ... will contain 4, 8, 12, 16 or 24 entries"* is
 * exactly the five values `depthFor` can return, *"This value is not always
 * width/8"* is true because it is never width/8, and the two stencils land on
 * planes 4 and 8 rather than 8 and 16.
 *
 * ## Three more layouts the kit does not describe
 *
 * **Which segments a frame number reaches.** The manual draws the twelve and
 * says what a picture costs in each resolution; nothing maps a `WriteFrame24`
 * argument onto them. `WriteFrame24` itself does, in eleven instructions —
 * see `frameTarget`.
 *
 * **The `OVTN` thumbnail chunk.** 4320 bytes of 48 x 30 x 12, and the scaler
 * that fills it, both read out of `WriteThumbnail24`. See `OpalVision.thumbnail`.
 *
 * **`DownLoadFrame24`.** No AutoDoc entry and no mention in the manual. The FD
 * file gives the signature and hunk $53ca gives the behaviour — and it is the
 * only thing in the library that reads the frame buffer back, which is why the
 * segments have contents here.
 *
 * ## What is inferred rather than documented
 *
 * **`MaxFrames` outside 24-bit.** Section 11.5's two frame-assignment tables
 * are captions with no table under them in the text edition, so only the
 * prose in section 9.0 survives, and it covers 24-bit alone. See `maxFrames`.
 *
 * **The line stride inside a segment.** `OVMODULO` is 371 and a segment is
 * 128K, which is room for all 290 display lines; the manual says only that
 * *"picture information is stored in sequential form"*. See `bufferCell`.
 *
 * **`VStart`.** *"This is normally defined in preferences"*, and there are no
 * Preferences here. See `vStart`.
 */
import { MemPool } from './exec'
import { decodeJpeg, encodeJpeg } from './jpeg'

/* ---- struct OpalScreen (devdocs/Assembler/opallib.i) ------------------ */

/** every field's byte offset, exactly as `STRUCTURE OS,0` lays them out */
export const OS = {
  Width: 0,
  Height: 2,
  Depth: 4,
  ClipX1: 6,
  ClipY1: 8,
  ClipX2: 10,
  ClipY2: 12,
  BytesPerLine: 14,
  Flags: 16,
  RelX: 18,
  RelY: 20,
  UserPort: 22,
  MaxFrames: 26,
  VStart: 28,
  CoProOffset: 30,
  LastWait: 32,
  LastCoProIns: 34,
  BitPlanes: 36,
  MaskPlane: 132,
  AddressReg: 136,
  UpdateRate: 140,
  PalLoadAddress: 141,
  PixelReadMask: 142,
  CommandReg: 143,
  Palette: 144,
  Pen_R: 912,
  Pen_G: 913,
  Pen_B: 914,
  Red: 915,
  Green: 916,
  Blue: 917,
  CoProData: 918,
  Modulo: 1208,
  Reserved: 1210,
  CopList_Cycle: 1248,
  Update_Cycles: 1296,
  Pad: 1297,
} as const

/** `LABEL OS_SIZEOF` */
export const OS_SIZEOF = 1298

/** `MAXCOPROINS EQU 290` — "one for each line of the display" */
export const MAXCOPROINS = 290

/**
 * `OVMODULO EQU 371`, and the include's own advice is *"Don't use this, use
 * OS_Modulo"*, because the ColorBurst's differs. It is the address counter's
 * line stride: *"Each address is equal to a low res pixel size. and there are
 * 371 address counts per line"*, so scrolling down one line adds 371.
 */
export const OVMODULO = 371

/* ---- screen flags ----------------------------------------------------- */

export const HIRES24 = 0x1
export const ILACE24 = 0x2
export const OVERSCAN24 = 0x4
/** *"Not user definable"* — the library sets it on an NTSC machine */
export const NTSC24 = 0x8
export const CLOSEABLE24 = 0x10
export const PLANES8 = 0x20
export const PLANES15 = 0x40
export const CONTROLONLY24 = 0x2000
export const PALMAP24 = 0x4000
/** *"Not user definable"* — set on a display screen, clear on a virtual one */
export const INCHIP24 = 0x8000

/** what `OpenScreen24` and `CreateScreen24` will accept from the caller */
export const FLAGSMASK24 =
  CONTROLONLY24 | PALMAP24 | CLOSEABLE24 | PLANES8 | PLANES15 | OVERSCAN24 | ILACE24 | HIRES24

/* ---- LoadImage24 / SaveIFF24 / SaveJPEG24 flags ----------------------- */

export const FORCE24 = 1
export const KEEPRES24 = 2
export const LOADMASK24 = 4
export const VIRTUALSCREEN24 = 8

export const OVFASTFORMAT = 1
export const NOTHUMBNAIL = 4
export const SAVEMASK24 = 8

/* ---- Config24 --------------------------------------------------------- */

export const OVCF_OPALVISION = 1
export const OVCF_COLORBURST = 2

/* ---- CoPro instruction bits (one byte per display line) --------------- */

export const VIDMODE0 = 0x01
export const VIDMODE1 = 0x02
export const DISPLAYBANK2 = 0x04
export const HIRESDISP = 0x08
/** *"Select dual display mode (active low)"* — clear it to mix the two */
export const DUALDISPLAY = 0x10
export const OVPRI = 0x20
export const PRISTENCIL = 0x40
/** *"Address load bit. Active low"* */
export const ADDLOAD = 0x80

/* ---- control line register bits (twenty, one register per segment) ---- */

export const CL_VALID0 = 0x00001
export const CL_VALID1 = 0x00002
export const CL_VALID2 = 0x00004
export const CL_VALID3 = 0x00008
export const CL_WREN = 0x00010
export const CL_COL_COPRO = 0x00020
export const CL_AUTO = 0x00040
export const CL_DUALPLAYFIELD = 0x00080
export const CL_FIELD = 0x00100
export const CL_AUTOFIELD = 0x00200
export const CL_DISPLAYLATCH = 0x00400
export const CL_FRAMEGRAB = 0x00800
export const CL_RWR1 = 0x01000
export const CL_RWR2 = 0x02000
export const CL_GWR1 = 0x04000
export const CL_GWR2 = 0x08000
export const CL_BWR1 = 0x10000
export const CL_BWR2 = 0x20000
export const CL_VLSIPROG = 0x40000
export const CL_FREEZEFRAME = 0x80000

/** `NUMCONTROLBITS EQU 20` */
export const NUMCONTROLBITS = 20

/**
 * `VALID EQU %0101` — the activation code the card looks for in the first scan
 * line of every frame. Bits 3..0 are 0,1,0,1 in the manual's own table, and
 * without it there is no OpalVision display at all.
 */
export const CL_VALID = 0b0101

/**
 * Fourteen control line registers: twelve memory segments plus the manual's
 * *"12 Field 0 Display only"* and *"13 Field 1 Display only"*, which
 * `SetControlBit24` calls *"2 noupdate lists"*.
 */
export const NUM_CONTROL_LINES = 14

/* ---- error codes (opallib.i, and the AutoDocs return them) ------------ */

export const OL_ERR_OUTOFMEM = 1
export const OL_ERR_OPENFILE = 2
export const OL_ERR_NOTIFF = 3
/** the include gives 3 twice: `OL_ERR_NOTIFF` and `OL_ERR_FORMATUNKNOWN` */
export const OL_ERR_FORMATUNKNOWN = 3
export const OL_ERR_NOTILBM = 4
export const OL_ERR_FILEREAD = 5
export const OL_ERR_FILEWRITE = 6
export const OL_ERR_BADIFF = 7
export const OL_ERR_CANTCLOSE = 8
export const OL_ERR_OPENSCREEN = 9
export const OL_ERR_NOTHUMBNAIL = 10
export const OL_ERR_BADJPEG = 11
export const OL_ERR_UNSUPPORTED = 12
export const OL_ERR_CTRLC = 13

/**
 * *"the value can be compared to OL_ERR_MAXERR, if it is lower than this value
 * then the result is an error code, if it is greater than this number then it
 * is a screen pointer"* — so every allocation this port hands back must be
 * above 40, which the pool's base guarantees many times over.
 */
export const OL_ERR_MAXERR = 40

/* ---- screen geometry -------------------------------------------------- */

/**
 * The size `OpenScreen24` gives a screen, from the AutoDoc's own table.
 *
 * |  | Hires | Interlaced | PAL | NTSC |
 * |---|---|---|---|---|
 * | | No | No | 320x256 | 320x200 |
 * | | Yes | No | 640x256 | 640x200 |
 * | | No | Yes | 320x512 | 320x400 |
 * | | Yes | Yes | 640x512 | 640x400 |
 *
 * Overscan comes from section 11.1 instead, which gives it per flag rather
 * than as a table: *"368 pixels wide in low resolution or 736 pixels wide in
 * high resolution. The number of lines in PAL is 286 non interlaced or 576
 * interlaced and in NTSC there are 236 lines in non interlaced or 476 lines
 * interlaced."*
 */
export function screenSize(flags: number, ntsc: boolean): { width: number; height: number } {
  const hires = (flags & HIRES24) !== 0
  const lace = (flags & ILACE24) !== 0
  if (flags & OVERSCAN24) {
    return {
      width: hires ? 736 : 368,
      height: ntsc ? (lace ? 476 : 236) : lace ? 576 : 286,
    }
  }
  return {
    width: hires ? 640 : 320,
    height: ntsc ? (lace ? 400 : 200) : lace ? 512 : 256,
  }
}

/**
 * `Depth` — how many PLANES a screen's flags ask for, which is not how many
 * bits a pixel has.
 *
 * OpalVision planes hold TWO bits per pixel, not one, so a 24-bit pixel takes
 * twelve of them rather than twenty-four, and a hires screen takes twice as
 * many again because its even and odd pixels live in different banks.
 * `CreateScreen24` computes it in eight instructions:
 *
 *     btst.b #$5,d3 / beq / moveq #$4,d1     ; PLANES8  -> 4
 *     btst.b #$6,d3 / beq / moveq #$8,d1     ; PLANES15 -> 8
 *                          moveq #$c,d1      ; else       12
 *     btst.b #$0,d3 / beq / add.w d1,d1      ; HIRES24  -> doubled
 *     move.w d1,$4(a4)
 *
 * Which is exactly the set the AutoDoc lists, and nothing else: *"This field
 * is an array of pointers to the bitplanes for the screen which will contain
 * 4, 8, 12, 16 or 24 entries."* Four is 8-bit lores, eight is 8-bit hires or
 * 15-bit lores, twelve is 24-bit lores, sixteen is 15-bit hires and
 * twenty-four is 24-bit hires.
 */
export function depthFor(flags: number): number {
  const base = flags & PLANES8 ? 4 : flags & PLANES15 ? 8 : 12
  return flags & HIRES24 ? base * 2 : base
}

/**
 * How many pen bytes a screen's depth uses: three for 24-bit, two for 15-bit,
 * one for 8-bit, which is the AutoDoc's *"In 24bit mode the three values
 * contain 8bits of red, green and blue. In 8bit mode, Pen_R contains the 8bit
 * value to be written."*
 *
 * `WritePixel24` runs one iteration per pen byte over four planes at a time,
 * and its loop count is `(hires ? Depth : Depth * 2) / 8` — which comes to the
 * same three, two or one.
 */
export function components(flags: number): number {
  return flags & PLANES8 ? 1 : flags & PLANES15 ? 2 : 3
}

/**
 * `BytesPerLine`, and the AutoDoc's *"This value is not always width/8 and
 * depends on the resolution of the screen"* is an understatement: it is never
 * width/8.
 *
 * A plane byte holds four pixels at two bits each, so a lores line is
 * `width/4` bytes. A hires line puts half its pixels in each bank, so each
 * bank's line is `width/8`. `CreateScreen24` rounds the pixel count up to a
 * whole word first either way — `addi.w #$f,d4 / lsr.w #$4,d4`, then
 * `add.w d4,d4` for hires or `lsl.w #$2,d4` for lores.
 */
export function bytesPerLine(width: number, hires: boolean): number {
  const words = (width + 15) >> 4
  return hires ? words * 2 : words * 4
}

/**
 * `MaxFrames` — how many whole images of this resolution fit in the buffer.
 *
 * Section 9.0 states it for 24-bit and nothing states it for 8 or 15: *"In low
 * resolution non-interlaced each of the four fields (Banks 1 and 2) can hold
 * complete images. In low resolution interlaced both fields are required for
 * each full picture therefore two complete images may be stored, one in each
 * bank. In high resolution non interlaced, one bank is required for each
 * picture allowing the storage of two complete pictures. Finally in high
 * resolution interlaced, only one picture can reside in the OpalVision memory
 * at a given time."*
 *
 * So 24-bit is 4, 2, 2, 1 over (lores, hires) x (non-interlaced, interlaced),
 * which is exactly *"twelve segments divided by the three a 24-bit image
 * needs"* halved once per doubling. An 8-bit image needs ONE segment rather
 * than three, so the same division gives three times as many — twelve in lores
 * non-interlaced — and `UpdatePFStencil24`'s worked example confirms the
 * arithmetic by naming frames 0 and 3 as the red segments of the two banks.
 * Fifteen-bit needs two segments of the three.
 *
 * INFERRED for 8 and 15 bit: the section 11.5 tables that would have said so
 * are captions with nothing under them in the text edition of the manual.
 */
export function maxFrames(flags: number): number {
  const hires = (flags & HIRES24) !== 0
  const lace = (flags & ILACE24) !== 0
  const segments = 12 >> ((hires ? 1 : 0) + (lace ? 1 : 0))
  return Math.max(1, Math.floor(segments / components(flags)))
}

/**
 * `VStart` — *"the starting scan line of the screen. This is normally defined
 * in preferences or is given a default value for overscan screens."*
 *
 * Preferences are the user's and this port has none, so the value here is the
 * standard Amiga display window top, $2c, which is the vertical start of
 * DIWSTRT $2c81 on a PAL and an NTSC machine alike and what an unmodified
 * Preferences holds. The manual's *"given a default value for overscan
 * screens"* does not say which value; $24 is the usual overscan top and the
 * one this port uses.
 *
 * Only a program that peeks the field can see either number, and nothing in
 * the extension reads it back.
 */
export function vStart(flags: number): number {
  return flags & OVERSCAN24 ? 0x24 : 0x2c
}

/**
 * The rest of the machine's memory, as the conversion routines see it.
 *
 * `ILBMtoOV` and its five siblings move pixels between an OpalScreen and
 * ordinary Amiga memory the program owns, so they need an address space wider
 * than the card's own pool. The Runtime supplies one; the card only needs
 * bytes.
 */
export interface Bus {
  peek8(addr: number): number
  poke8(addr: number, value: number): void
}

/* ---- the card --------------------------------------------------------- */

/**
 * *"In total there are 12 regions of memory which may be independently
 * accessed, these are referred to as segments in this document"* — two banks,
 * two fields each, three colour regions each, 128K apiece.
 *
 * Numbered here `field * 6 + bank * 3 + colour`, and which of them a frame
 * number reaches is `frameTarget`.
 */
export const NUM_SEGMENTS = 12

/**
 * *"128K"* a segment, which is 371 bytes a line — `OVMODULO` — for all 290
 * display lines with room to spare.
 */
export const SEGMENT_SIZE = 0x20000

/** how many whole lines of `OVMODULO` bytes a segment holds */
export const SEGMENT_LINES = Math.floor(SEGMENT_SIZE / OVMODULO)

/** which segments one `WriteFrame24` frame number covers */
export interface FrameTarget {
  /** both when `HIRES24`, since *"sequential pixels ... are situated in alternate banks"* */
  readonly banks: readonly number[]
  /** both when `ILACE24`: *"Interlaced pictures must be stored in adjacent fields"* */
  readonly fields: readonly number[]
  /** one in 8-bit mode, all three otherwise */
  readonly colours: readonly number[]
}

/**
 * Turn a frame number into the segments it writes.
 *
 * `WriteFrame24` at hunk $3a36 is the definition, and it is eleven
 * instructions:
 *
 *     btst.b #$5,d2 / beq                  ; PLANES8?
 *     divu.w #$3,d3 / swap d0 / bsr SetColour(remainder)
 *     btst.b #$0,d2 / bne hires            ; HIRES24 leaves both banks enabled
 *     btst.b #$0,d3 / beq / bsr Bank2      ; else bank = slot & 1
 *     bsr Bank1
 *     btst.b #$1,d2 / bne done             ; ILACE24 leaves both fields enabled
 *     move.w d3,d0 / lsr.w #$1,d0 / bsr SetField
 *
 * The two bank routines mask the control lines with $15000 and $2a000, which
 * are `RWR1|GWR1|BWR1` and `RWR2|GWR2|BWR2`, so "bank" there is the segment
 * diagram's bank. So: eight-bit mode splits the number into a colour and a
 * slot, and the slot's low bit is the bank and its next bit the field.
 *
 * The manual agrees for every mode it describes — *"in low resolution
 * interlaced ... two complete images may be stored, one in each bank"* is
 * `banks: [slot & 1], fields: [0, 1]` — and `UpdatePFStencil24`'s worked
 * example pins the eight-bit numbering exactly: *"the red segment of bank 0
 * using WriteFrame24(0) and the second playfield into the red segment of bank
 * 1 using WriteFrame24(3)"*, then *"WriteFrame24(1) ... to switch to the green
 * segment"*.
 *
 * Fifteen-bit mode is where `MaxFrames` and this part company. That field is
 * `(12 >> hires+lace) / components`, six for a lores non-interlaced 15-bit
 * screen, but only the low two bits of the slot are ever used here, so frames
 * 4 and 5 land on the same segments as 0 and 1; and 15-bit never narrows the
 * colour, so an update writes all three of the bank's segments and leaves the
 * blue one holding whatever it held. The library is wrong and this is what it
 * does; `../runtime/opal.ts` catalogues it.
 */
export function frameTarget(flags: number, frame: number): FrameTarget {
  const f = Math.max(0, frame | 0)
  const eight = (flags & PLANES8) !== 0
  const slot = eight ? Math.floor(f / 3) : f
  return {
    banks: flags & HIRES24 ? [0, 1] : [slot & 1],
    fields: flags & ILACE24 ? [0, 1] : [(slot >> 1) & 1],
    colours: eight ? [f % 3] : [0, 1, 2],
  }
}

/** the segment numbering this file uses throughout */
export const segmentIndex = (field: number, bank: number, colour: number): number =>
  field * 6 + bank * 3 + colour

/**
 * A screen this port allocated, remembered so the pool can be given the blocks
 * back. Everything a program can see lives in the pool at `addr`; this is only
 * the bookkeeping the library keeps privately.
 */
export interface OpalScreen {
  /** address of the OpalScreen structure — what every keyword passes around */
  readonly addr: number
  /** addresses of the `Depth` bitplanes, and what `OS_BitPlanes` holds */
  readonly planes: readonly number[]
  /** bytes in one plane, `Height * BytesPerLine` */
  readonly planeSize: number
  /** false for a virtual screen: `CreateScreen24`'s screens are never displayed */
  readonly display: boolean
}

/**
 * The OpalVision card and `opal.library`'s state.
 *
 * The library is *"basically a passive entity"* apart from one vertical-blank
 * handler, so almost all of this is registers: a copy lives in every
 * OpalScreen and reaches the card only when the program asks. That indirection
 * is the library's central idea and it is modelled straight — `UpdateRegs24`,
 * `UpdatePalette24` and `UpdateCoPro24` are the three copies, and `RegWait24`
 * is the wait that has to follow them.
 */
export class OpalVision {
  /** screen structures, bitplanes and the mask planes, by structure address */
  readonly pool: MemPool
  readonly screens = new Map<number, OpalScreen>()

  /**
   * The display screen, or 0. *"If there is no OpalVision display active then
   * a null value is returned"* — `ActiveScreen24`.
   */
  active = 0

  /* -- registers on the card, as distinct from the copies in a screen -- */

  /** fourteen control line registers; see NUM_CONTROL_LINES */
  readonly controlLines = new Int32Array(NUM_CONTROL_LINES)
  /** the CoPro's 290 instructions, one per display line */
  readonly copro = new Uint8Array(MAXCOPROINS)
  /** 256 entries of R,G,B, matching the screen's `OS_Palette` layout */
  readonly palette = new Uint8Array(3 * 256)

  /**
   * The twelve segments' contents, each allocated the first time something
   * writes to it.
   *
   * The buffer has to be here because it is readable: `DownLoadFrame24` pulls a
   * rectangle back out of it through the card's parallel-port interface, one
   * byte at a time — hunk $53ca reads `$bfe101` and unpacks it through the same
   * four lookup tables `WritePixel24` writes with. Nothing else in the library
   * reads it, so a segment nothing has updated stays unallocated and reads as
   * zero, which is also what a freshly powered card holds.
   */
  private readonly segmentData: (Uint8Array | null)[] = new Array<Uint8Array | null>(
    NUM_SEGMENTS,
  ).fill(null)
  pixelReadMask = 0xff
  commandReg = 0
  palLoadAddress = 0
  addressReg = 0

  /* -- display state --------------------------------------------------- */

  /** `DisplayFrame24` */
  displayFrame = 0
  /** `WriteFrame24` */
  writeFrame = 0
  /** `UpdateDelay24` set it and started continuous updates; `StopUpdate24` clears it */
  updating = false
  /** frames to wait between updates; 0 is *"continuous full speed updates"* */
  updateDelay = 0
  /** `UpdatePFStencil24` restricts updates to the green segments until `UpdateAll24` */
  pfStencilOnly = false
  /** `LatchDisplay24` — the display survives `CloseScreen24`, *"even if the Amiga is reset"* */
  latched = false
  /** `AutoSync24` */
  autoSync = false
  /** `FreezeFrame24`, which needs the Scan Rate Converter module */
  frozen = false
  /** `SetDisplayBottom24`'s last line, or -1 when none is set */
  displayBottom = -1
  /** `SetSprite24`: sprite data address by hardware sprite number, 0 for none */
  readonly sprites = new Int32Array(8)

  /**
   * True once `AmosPatch24` has been called with 1 and not yet with 0.
   *
   * The AMOS extension is the only caller — `Opal.s` passes `-$7fa(a5)` and a
   * flag around every keyword that opens a screen or updates the buffer — and
   * no AutoDoc documents the function, so what it does inside the library is
   * not on record. What IS on record is when the extension calls it, and that
   * is modelled here so the sequence is visible.
   */
  patched = false

  constructor(base: number, reserved: number) {
    this.pool = new MemPool(base, reserved)
  }

  /* -- the pool, as bytes ---------------------------------------------- */

  /** a pool address as an offset into the backing buffer, or -1 if it is not ours */
  private at(addr: number): number {
    const off = (addr >>> 0) - this.pool.base
    return off >= 0 && off < this.pool.buffer.length ? off : -1
  }

  peek8(addr: number): number {
    const o = this.at(addr)
    return o < 0 ? 0 : (this.pool.buffer[o] ?? 0)
  }

  poke8(addr: number, v: number): void {
    const o = this.at(addr)
    if (o >= 0) this.pool.buffer[o] = v & 0xff
  }

  peek16(addr: number): number {
    return (this.peek8(addr) << 8) | this.peek8(addr + 1)
  }

  poke16(addr: number, v: number): void {
    this.poke8(addr, v >> 8)
    this.poke8(addr + 1, v)
  }

  /** a WORD field read as signed, which every coordinate in the structure is */
  peekS16(addr: number): number {
    return (this.peek16(addr) << 16) >> 16
  }

  peek32(addr: number): number {
    return ((this.peek16(addr) << 16) | this.peek16(addr + 2)) >>> 0
  }

  poke32(addr: number, v: number): void {
    this.poke16(addr, v >>> 16)
    this.poke16(addr + 2, v & 0xffff)
  }

  /* -- screens ---------------------------------------------------------- */

  /**
   * Allocate an OpalScreen and its bitplanes, and fill in every field the
   * library sets — the shared half of `OpenScreen24` and `CreateScreen24`.
   *
   * A display screen's planes are chip memory (`INCHIP24`, *"The display
   * screen's bitplanes must reside in chip ram"*); a virtual screen's are not,
   * and `CreateScreen24` says so: *"This function allocates memory with no
   * MEMF_ bits set"*.
   *
   * Returns 0 when the pool cannot find the room, which is `OpenScreen24`'s
   * *"NULL if unsuccessful"*.
   */
  newScreen(flags: number, width: number, height: number, display: boolean): number {
    const depth = depthFor(flags)
    const rowBytes = bytesPerLine(width, (flags & HIRES24) !== 0)
    const planeSize = rowBytes * height
    const addr = this.pool.alloc(OS_SIZEOF, { clear: true })
    if (addr === 0) return 0

    const planes: number[] = []
    // CONTROLONLY24 opens "a bitplaneless screen", which is the whole point of
    // it: the registers can be reached without disturbing a latched display
    const wanted = flags & CONTROLONLY24 ? 0 : depth
    for (let i = 0; i < wanted; i++) {
      const p = this.pool.alloc(planeSize, { clear: true, chip: display })
      if (p === 0) {
        for (const q of planes) this.pool.freeMem(q)
        this.pool.freeMem(addr)
        return 0
      }
      planes.push(p)
    }

    this.poke16(addr + OS.Width, width)
    this.poke16(addr + OS.Height, height)
    this.poke16(addr + OS.Depth, depth)
    // "The clipping rectangle is initialized to the size of the screen when it
    // is created", and the region is ClipX1 <= x < ClipX2
    this.poke16(addr + OS.ClipX2, width)
    this.poke16(addr + OS.ClipY2, height)
    this.poke16(addr + OS.BytesPerLine, rowBytes)
    this.poke16(addr + OS.Flags, (flags & FLAGSMASK24) | (display ? INCHIP24 : 0))
    this.poke16(addr + OS.MaxFrames, maxFrames(flags))
    this.poke16(addr + OS.VStart, vStart(flags))
    this.poke16(addr + OS.LastWait, vStart(flags))
    this.poke16(addr + OS.LastCoProIns, MAXCOPROINS)
    this.poke16(addr + OS.Modulo, OVMODULO)
    for (let i = 0; i < planes.length; i++) this.poke32(addr + OS.BitPlanes + i * 4, planes[i]!)
    // `move.b #$ff,$8e(a4)`: the pixel read mask is all ones until a program
    // narrows it, and the example program's "set mask back to $ff" is putting
    // back exactly this
    this.poke8(addr + OS.PixelReadMask, 0xff)
    // and the palette is a greyscale ramp, written backwards:
    //   lea $390(a4),a0 / move.w #$ff,d0
    //   move.b d0,-(a0) x3 / dbra d0
    // so entry N is (N, N, N) and entry 255 is white
    for (let i = 0; i < 256; i++) {
      for (let c = 0; c < 3; c++) this.poke8(addr + OS.Palette + i * 3 + c, i)
    }

    this.screens.set(addr, { addr, planes, planeSize, display })
    return addr
  }

  /** give a screen's structure and planes back to the pool */
  freeScreen(addr: number): void {
    const s = this.screens.get(addr >>> 0)
    if (!s) return
    for (const p of s.planes) this.pool.freeMem(p)
    const mask = this.peek32(addr + OS.MaskPlane)
    if (mask !== 0) this.pool.freeMem(mask)
    this.pool.freeMem(s.addr)
    this.screens.delete(s.addr)
    if (this.active === s.addr) this.active = 0
  }

  /* -- pixels ----------------------------------------------------------- */

  /**
   * Whether (x, y) is inside the screen's clip region, after `RelX`/`RelY`.
   *
   * *"The actual region is defined as ClipX1 <= x < ClipX2 and ClipY1 <= x <
   * ClipY2"* — the second `x` is a typo for `y`, since a rectangle whose
   * vertical bound tested the horizontal coordinate would clip nothing
   * sensible and the field names say which is which.
   */
  inClip(scrn: number, x: number, y: number): boolean {
    return (
      x >= this.peekS16(scrn + OS.ClipX1) &&
      x < this.peekS16(scrn + OS.ClipX2) &&
      y >= this.peekS16(scrn + OS.ClipY1) &&
      y < this.peekS16(scrn + OS.ClipY2)
    )
  }

  /** *"These values are simply added to the input coordinates of drawing routines"* */
  relX(scrn: number): number {
    return this.peekS16(scrn + OS.RelX)
  }

  relY(scrn: number): number {
    return this.peekS16(scrn + OS.RelY)
  }

  /**
   * Where a pixel lives — the one piece of this card no document describes,
   * and the one the library settles outright.
   *
   * `WritePixel24` at hunk $59d2, after the four clip tests:
   *
   *     move.w  $4(a0),d7            ; Depth
   *     lea     $24(a0),a1           ; BitPlanes
   *     btst.b  #$0,$11(a0)          ; HIRES24?
   *     beq     lores
   *     lsr.w   #$1,d0               ; x/2, and the bit out says which bank
   *     bcc     go
   *     adda.w  d7,a1 / adda.w d7,a1 ; odd x: the second half of the array
   *     bra     go
   *   lores:
   *     add.w   d7,d7
   *   go:
   *     moveq   #$3,d4 / and.b d0,d4 / add.b d4,d4
   *     moveq   #$3f,d6 / ror.b d4,d6          ; two bits to keep clear
   *     mulu.w  $e(a0),d1 / lsr.w #$2,d0 / add.l d1,d0
   *     lsr.w   #$3,d7 / subq.w #$1,d7         ; one pass per pen byte
   *
   * So a plane byte holds FOUR pixels at TWO bits each, most significant pair
   * leftmost, and each pass of the loop takes one pen byte and spreads it over
   * four planes. Twelve planes carry 24-bit colour, not twenty-four. In hires
   * the even pixels use the first half of the pointer array and the odd ones
   * the second, which is the manual's *"sequential pixels along each
   * horizontal line are situated in alternate banks"* seen from the CPU side.
   *
   * The spread within a component is a 4 x 256 lookup table per pixel phase,
   * four of them from hunk $6500, and it is perfectly regular: **plane `p`
   * carries bit `p` of the byte as its low bit and bit `p + 4` as its high
   * bit.** `ReadPixel24` at $592e undoes exactly that, with `eori.b #$6,d4`
   * turning the phase into the pair's low bit number.
   */
  private cell(
    scrn: number,
    x: number,
    y: number,
  ): { group: number; byte: number; shift: number; passes: number } {
    const depth = this.peek16(scrn + OS.Depth)
    const rowBytes = this.peekS16(scrn + OS.BytesPerLine)
    const hires = (this.peek16(scrn + OS.Flags) & HIRES24) !== 0
    const half = hires && (x & 1) === 1 ? depth / 2 : 0
    const px = hires ? x >> 1 : x
    return {
      group: half,
      byte: y * rowBytes + (px >> 2),
      // the pair for pixel phase q sits at bits 2q+1 and 2q counted from the
      // TOP: `ror.b` on $3f clears bits 7,6 for phase 0
      shift: 6 - ((px & 3) << 1),
      passes: (hires ? depth : depth * 2) >> 3,
    }
  }

  /** the two-bit field of one plane at (x, y) — no clipping, the callers do that */
  getCell(scrn: number, plane: number, x: number, y: number): number {
    const c = this.cell(scrn, x, y)
    const base = this.peek32(scrn + OS.BitPlanes + (c.group + plane) * 4)
    return (this.peek8(base + c.byte) >> c.shift) & 3
  }

  setCell(scrn: number, plane: number, x: number, y: number, pair: number): void {
    const c = this.cell(scrn, x, y)
    const base = this.peek32(scrn + OS.BitPlanes + (c.group + plane) * 4)
    const at = base + c.byte
    const keep = this.peek8(at) & ~(3 << c.shift)
    this.poke8(at, keep | ((pair & 3) << c.shift))
  }

  /**
   * Write one pixel from up to three component bytes, red first — the order
   * `WritePixel24` reads them in, `move.b (a0)+,d5` walking up from `$390`.
   */
  putPixel(scrn: number, x: number, y: number, value: number): void {
    const c = this.cell(scrn, x, y)
    for (let i = 0; i < c.passes; i++) {
      const v = (value >>> (i * 8)) & 0xff
      for (let p = 0; p < 4; p++) {
        this.setCell(scrn, i * 4 + p, x, y, ((v >> p) & 1) | (((v >> (p + 4)) & 1) << 1))
      }
    }
  }

  /** the inverse, and what `ReadPixel24` leaves in `Red`, `Green` and `Blue` */
  getPixel(scrn: number, x: number, y: number): number {
    const c = this.cell(scrn, x, y)
    let out = 0
    for (let i = 0; i < c.passes; i++) {
      let v = 0
      for (let p = 0; p < 4; p++) {
        const pair = this.getCell(scrn, i * 4 + p, x, y)
        v |= (pair & 1) << p
        v |= ((pair >> 1) & 1) << (p + 4)
      }
      out |= v << (i * 8)
    }
    return out >>> 0
  }

  /**
   * The screen's pen, as the component bytes `putPixel` wants.
   *
   * *"In 24bit mode the colour of the line is specified by the Pen_R, Pen_G and
   * Pen_B fields in the OpalScreen structure. In 15bit mode, Pen_R and Pen_G
   * specify the colour of the line, while in 8bit only Pen_R is used."* Which
   * bytes are read is the loop count, so this only has to supply all three.
   */
  pen(scrn: number): number {
    return (
      (this.peek8(scrn + OS.Pen_R) |
        (this.peek8(scrn + OS.Pen_G) << 8) |
        (this.peek8(scrn + OS.Pen_B) << 16)) >>>
      0
    )
  }

  /** `ReadPixel24`'s answer, into `OS_Red`/`OS_Green`/`OS_Blue` */
  storeRead(scrn: number, value: number): void {
    this.poke8(scrn + OS.Red, value & 0xff)
    this.poke8(scrn + OS.Green, (value >>> 8) & 0xff)
    this.poke8(scrn + OS.Blue, (value >>> 16) & 0xff)
  }

  /* -- drawing ---------------------------------------------------------- */

  /**
   * `WritePixel24` — *"Writes a pixel in the specified OpalScreen using the
   * current pen value in that structure"*, answering *"-1 if the pixel is
   * outside the clip boundary else 0"*.
   */
  writePixel(scrn: number, x0: number, y0: number): number {
    const x = x0 + this.relX(scrn)
    const y = y0 + this.relY(scrn)
    if (!this.inClip(scrn, x, y)) return -1
    this.putPixel(scrn, x, y, this.pen(scrn))
    return 0
  }

  /**
   * `ReadPixel24` — the colour goes into `Red`/`Green`/`Blue` and the RESULT is
   * only whether it was in range: *"Error = 0 if no error occurred, or -1 if
   * pixel was out of the clipping region"*.
   */
  readPixel(scrn: number, x0: number, y0: number): number {
    const x = x0 + this.relX(scrn)
    const y = y0 + this.relY(scrn)
    if (!this.inClip(scrn, x, y)) return -1
    this.storeRead(scrn, this.getPixel(scrn, x, y))
    return 0
  }

  /**
   * Which plane a stencil lives in.
   *
   * The playfield stencil is *"least significant bit of green bank 0"* and the
   * priority stencil *"least significant bit of blue bank 0"*. Green is the
   * second component and blue the third, four planes each, so those are planes
   * 4 and 8 — and "least significant bit" is the LOW bit of the two-bit pair,
   * because plane `p` carries bit `p` there and green's bit 0 is plane 4's.
   *
   * Eight-bit mode is plane 0 for both, and the four routines say so in one
   * instruction each: `btst.b #$5,$11(a0)` — PLANES8 — choosing `$24(a0)`, the
   * base of the array, over `$34(a0)` or `$44(a0)`. It follows from what the
   * manual says the mode does: *"To use the playfield stencil in 8bit mode, the
   * green bank contains the stencil and therefore must be updated"*, so the one
   * component a pixel has IS the bank the stencil is in.
   *
   * There is no existence check anywhere in the library, and none here. A
   * 15-bit screen has eight planes and `SetPRStencil24` still reads
   * `BitPlanes[8]`, which is a cleared word in the structure, so the write goes
   * through a null pointer.
   */
  private stencilPlane(scrn: number, priority: boolean): number {
    if (this.peek16(scrn + OS.Flags) & PLANES8) return 0
    return priority ? 8 : 4
  }

  /**
   * `WritePFPixel24` / `WritePRPixel24` — *"Sets or clears a pixel in the
   * playfield stencil depending on the state of Pen_R in the screen structure.
   * If Pen_R is = 0, the pixel will be cleared else it is set."*
   */
  writeStencil(scrn: number, x0: number, y0: number, priority: boolean): number {
    const x = x0 + this.relX(scrn)
    const y = y0 + this.relY(scrn)
    if (!this.inClip(scrn, x, y)) return -1
    const plane = this.stencilPlane(scrn, priority)
    const pair = this.getCell(scrn, plane, x, y)
    const on = this.peek8(scrn + OS.Pen_R) !== 0
    this.setCell(scrn, plane, x, y, on ? pair | 1 : pair & ~1)
    return 0
  }

  /**
   * `ReadPFPixel24` / `ReadPRPixel24` — *"returns 1 if the corresponding
   * playfield stencil pixel is set, or 0 if it is cleared. If the coordinates
   * are outside of the clip boundary then -1 is returned."*
   */
  readStencil(scrn: number, x0: number, y0: number, priority: boolean): number {
    const x = x0 + this.relX(scrn)
    const y = y0 + this.relY(scrn)
    if (!this.inClip(scrn, x, y)) return -1
    return this.getCell(scrn, this.stencilPlane(scrn, priority), x, y) & 1
  }

  /**
   * `SetPFStencil24` / `ClearPFStencil24` and their priority twins — *"of all
   * of the pixels in the specified screen"*, so the whole plane rather than the
   * clip region.
   */
  fillStencil(scrn: number, priority: boolean, on: boolean): void {
    const plane = this.stencilPlane(scrn, priority)
    const s = this.screens.get(scrn >>> 0)
    if (!s) return
    const base = this.peek32(scrn + OS.BitPlanes + plane * 4)
    // every pixel's LOW bit, which is one of each pair: %01010101
    for (let i = 0; i < s.planeSize; i++) {
      const b = this.peek8(base + i)
      this.poke8(base + i, on ? b | 0x55 : b & ~0x55)
    }
  }

  /**
   * `ClearScreen24` — *"Clear all bitplanes contained in the OpalScreen
   * structure"*. Not clipped, and not the frame buffer: *"This function clears
   * the bitplane memory without updating the frame buffer"*.
   */
  clearScreen(scrn: number): void {
    const s = this.screens.get(scrn >>> 0)
    if (!s) return
    for (const p of s.planes) {
      const off = (p >>> 0) - this.pool.base
      if (off >= 0) this.pool.buffer.fill(0, off, off + s.planeSize)
    }
  }

  /**
   * `SetScreen24` — *"similar to ClearScreen24, but fills the screen with the
   * colour contained in Pen_R,Pen_G & Pen_B"*. A plane is all ones where the
   * pen's bit is set and all zeros where it is not, which is the same whole
   * screen `ClearScreen24` covers.
   */
  setScreen(scrn: number): void {
    const s = this.screens.get(scrn >>> 0)
    if (!s) return
    const value = this.pen(scrn)
    const hires = (this.peek16(scrn + OS.Flags) & HIRES24) !== 0
    const depth = this.peek16(scrn + OS.Depth)
    const passes = (hires ? depth : depth * 2) >> 3
    for (let i = 0; i < passes; i++) {
      const v = (value >>> (i * 8)) & 0xff
      for (let p = 0; p < 4; p++) {
        const pair = ((v >> p) & 1) | (((v >> (p + 4)) & 1) << 1)
        // the same pair four times over makes the byte every pixel wants
        const fill = pair * 0x55
        for (const half of hires ? [0, depth / 2] : [0]) {
          const off = (s.planes[half + i * 4 + p]! >>> 0) - this.pool.base
          if (off >= 0) this.pool.buffer.fill(fill, off, off + s.planeSize)
        }
      }
    }
  }

  /**
   * `RectFill24` — *"Draws a solid rectangle with the colour specified by
   * Pen_R,Pen_G & Pen_B"*, clipped.
   *
   * The AutoDoc names the arguments `(Left, Top, Bottom, Right)` and then
   * describes them the other way round — *"Bottom = x coordinate of the bottom
   * right-hand corner of rectangle"*, *"Right = y coordinate"*. The
   * descriptions are what the library does, and the same slip appears twice
   * more in `RGBtoOV` and `OVtoRGB`, where Opal's own `Renderer.c` settles it.
   * So the four are x1, y1, x2, y2.
   */
  rectFill(scrn: number, x1: number, y1: number, x2: number, y2: number): void {
    const dx = this.relX(scrn)
    const dy = this.relY(scrn)
    const lo = Math.min(x1, x2) + dx
    const hi = Math.max(x1, x2) + dx
    const top = Math.min(y1, y2) + dy
    const bot = Math.max(y1, y2) + dy
    const value = this.pen(scrn)
    for (let y = top; y <= bot; y++) {
      for (let x = lo; x <= hi; x++) if (this.inClip(scrn, x, y)) this.putPixel(scrn, x, y, value)
    }
  }

  /**
   * `DrawLine24`, transcribed from v4.3 `$5df8`. It is Bresenham with one
   * unusual observable: a non-degenerate line does not draw its final point.
   */
  drawLine(scrn: number, x1: number, y1: number, x2: number, y2: number): void {
    const dx0 = this.relX(scrn)
    const dy0 = this.relY(scrn)
    let x = x1 + dx0
    let y = y1 + dy0
    const ex = x2 + dx0
    const ey = y2 + dy0
    const value = this.pen(scrn)
    let major = Math.abs(ex - x)
    let minor = Math.abs(ey - y)
    let steep = false
    let end = ex
    if (minor > major) {
      steep = true
      ;[major, minor] = [minor, major]
      ;[x, y] = [y, x]
      end = ey
    }
    let error = minor * 2 - major
    const errorDown = (minor - major) * 2
    const errorUp = minor * 2
    const yStep = y > (steep ? ex : ey) ? -1 : 1
    const xStep = x < end ? 1 : -1
    // The binary plots once for a point, otherwise stops just before `end`.
    do {
      const px = steep ? y : x
      const py = steep ? x : y
      if (this.inClip(scrn, px, py)) this.putPixel(scrn, px, py, value)
      if (error < 0) error += errorUp
      else {
        y += yStep
        error += errorDown
      }
      x += xStep
    } while (xStep > 0 ? x < end : x > end)
  }

  /**
   * `DrawEllipse24 (OScrn, cx, cy, a, b)` — *"a = horizontal radius of ellipse
   * (must be >0)"*, *"set a=b for circles"*, clipped. The integer recurrence
   * is transcribed from v4.3 `$5c8e`; in particular it emits all four
   * symmetric points even where they coincide on an axis.
   */
  drawEllipse(scrn: number, cx0: number, cy0: number, a: number, b: number): void {
    if (a <= 0 || b <= 0) return
    const cx = cx0 + this.relX(scrn)
    const cy = cy0 + this.relY(scrn)
    const value = this.pen(scrn)
    const plot = (x: number, y: number): void => {
      if (this.inClip(scrn, x, y)) this.putPixel(scrn, x, y, value)
    }
    const four = (x: number, y: number): void => {
      plot(cx + x, cy + y)
      plot(cx - x, cy + y)
      plot(cx + x, cy - y)
      plot(cx - x, cy - y)
    }
    const a2 = a * a
    const b2 = b * b
    const twoA2 = 2 * a2
    const fourA2 = 4 * a2
    const twoB2 = 2 * b2
    const fourB2 = 4 * b2
    let x = a
    let y = 0
    let yDelta = 0
    let xDelta = fourB2 * a
    let d1 = twoA2 - xDelta / 2 + b2
    let d2 = twoB2 - xDelta + a2

    while (d2 < 0) {
      four(x, y)
      y++
      yDelta += fourA2
      if (d1 < 0) {
        d1 += yDelta + twoA2
        d2 += yDelta
      } else {
        x--
        xDelta -= fourB2
        d1 += yDelta + twoA2 - xDelta
        d2 += yDelta + twoB2 - xDelta
      }
    }

    while (x > 0) {
      four(x, y)
      x--
      xDelta -= fourB2
      if (d2 < 0) {
        y++
        yDelta += fourA2
        d2 += twoB2 + yDelta - xDelta
      } else {
        d2 += twoB2 - xDelta
      }
    }
    four(x, y)
  }
  /* -- memory format conversion ----------------------------------------- */

  /**
   * How many ORDINARY Amiga bitplanes a conversion moves — one bit per pixel
   * each, which is not how the OpalScreen stores them: *"The destination data
   * will be non-interleaved 24, 15 or 8 planes depending on the type of display
   * OScrn is. Note that the 15bit display mode is actually stored internally as
   * 16 bitplanes which in turn causes this function to return 16 planes instead
   * of 15."*
   *
   * So this is eight per component, and the screen's own `Depth` — four planes
   * per component, two bits wide — is a different number entirely.
   */
  private convDepth(scrn: number): number {
    const depth = this.peek16(scrn + OS.Depth)
    const hires = (this.peek16(scrn + OS.Flags) & HIRES24) !== 0
    const comps = (hires ? depth : depth * 2) >> 3
    return comps === 2 ? 16 : comps * 8
  }

  /**
   * `ILBMtoOV (OScrn, ILBMData, SrcWidth, Lines, TopLine, SrcPlanes)` —
   * *"Converts interleaved bitmap memory into OpalVision memory format and
   * stores this in the OpalScreen supplied."*
   *
   * Interleaved means all of a row's planes together before the next row,
   * which is what an ILBM BODY holds; the planes are ordinary Amiga ones, one
   * bit per pixel, least significant first, so eight of them make a component.
   * *"The source data will be clipped if it is wider than the destination
   * screen, or will be padded out if it is narrower."* The clip region is not
   * involved — this is a conversion, not a drawing routine.
   */
  ilbmToOv(
    bus: Bus,
    scrn: number,
    src: number,
    srcWidth: number,
    lines: number,
    topLine: number,
    srcPlanes: number,
  ): void {
    const width = this.peek16(scrn + OS.Width)
    const height = this.peek16(scrn + OS.Height)
    for (let l = 0; l < lines; l++) {
      const y = topLine + l
      if (y < 0 || y >= height) continue
      for (let x = 0; x < width; x++) {
        let v = 0
        if (x >> 3 < srcWidth) {
          for (let p = 0; p < srcPlanes; p++) {
            const byte = bus.peek8(src + (l * srcPlanes + p) * srcWidth + (x >> 3))
            v |= ((byte >> (7 - (x & 7))) & 1) << p
          }
        }
        this.putPixel(scrn, x, y, v >>> 0)
      }
    }
  }

  /**
   * `OVtoILBM (OScrn, ILBMData, DestWidth, Lines, TopLine)` — the inverse.
   * *"The memory pointed to by ILBMData must be large enough to hold DestWidth
   * * lines * (8 or 16 or 24 depending on screen type) bytes."*
   */
  ovToIlbm(
    bus: Bus,
    scrn: number,
    dst: number,
    dstWidth: number,
    lines: number,
    topLine: number,
  ): void {
    const planes = this.convDepth(scrn)
    const width = this.peek16(scrn + OS.Width)
    const height = this.peek16(scrn + OS.Height)
    for (let l = 0; l < lines; l++) {
      const y = topLine + l
      for (let p = 0; p < planes; p++) {
        for (let b = 0; b < dstWidth; b++) bus.poke8(dst + (l * planes + p) * dstWidth + b, 0)
      }
      if (y < 0 || y >= height) continue
      for (let x = 0; x < Math.min(width, dstWidth * 8); x++) {
        const v = this.getPixel(scrn, x, y)
        for (let p = 0; p < planes; p++) {
          if (((v >>> p) & 1) === 0) continue
          const at = dst + (l * planes + p) * dstWidth + (x >> 3)
          bus.poke8(at, bus.peek8(at) | (0x80 >> (x & 7)))
        }
      }
    }
  }

  /**
   * `BitPlanetoOV (OScrn, SrcPlanes, SrcWidth, Lines, TopLine, SrcDepth)` —
   * the same conversion from SEPARATE planes: *"A pointer to an array of
   * pointers to source Bitplanes"*, so `SrcPlanes` is read as longwords.
   */
  bitPlaneToOv(
    bus: Bus,
    scrn: number,
    planeList: number,
    srcWidth: number,
    lines: number,
    topLine: number,
    srcDepth: number,
  ): void {
    const width = this.peek16(scrn + OS.Width)
    const height = this.peek16(scrn + OS.Height)
    const src: number[] = []
    for (let p = 0; p < srcDepth; p++) src.push(read32(bus, planeList + p * 4))
    for (let l = 0; l < lines; l++) {
      const y = topLine + l
      if (y < 0 || y >= height) continue
      for (let x = 0; x < width; x++) {
        let v = 0
        if (x >> 3 < srcWidth) {
          for (let p = 0; p < srcDepth; p++) {
            const byte = bus.peek8(src[p]! + l * srcWidth + (x >> 3))
            v |= ((byte >> (7 - (x & 7))) & 1) << p
          }
        }
        this.putPixel(scrn, x, y, v >>> 0)
      }
    }
  }

  /** `OVtoBitPlane (OScrn, BitPlanes, DestWidth, Lines, TopLine)` — its inverse */
  ovToBitPlane(
    bus: Bus,
    scrn: number,
    planeList: number,
    dstWidth: number,
    lines: number,
    topLine: number,
  ): void {
    const planes = this.convDepth(scrn)
    const width = this.peek16(scrn + OS.Width)
    const height = this.peek16(scrn + OS.Height)
    const dst: number[] = []
    for (let p = 0; p < planes; p++) dst.push(read32(bus, planeList + p * 4))
    for (let l = 0; l < lines; l++) {
      const y = topLine + l
      for (let p = 0; p < planes; p++) {
        for (let b = 0; b < dstWidth; b++) bus.poke8(dst[p]! + l * dstWidth + b, 0)
      }
      if (y < 0 || y >= height) continue
      for (let x = 0; x < Math.min(width, dstWidth * 8); x++) {
        const v = this.getPixel(scrn, x, y)
        for (let p = 0; p < planes; p++) {
          if (((v >>> p) & 1) === 0) continue
          const at = dst[p]! + l * dstWidth + (x >> 3)
          bus.poke8(at, bus.peek8(at) | (0x80 >> (x & 7)))
        }
      }
    }
  }

  /**
   * `RGBtoOV (OScrn, RGBPlanes[], x, y, Width, Height)` — three BYTE planes,
   * one per component, into the screen. *"Unlike the other conversion
   * routines, this function is clipped if it is outside of the clipping
   * region, this enables it to be used as a drawing function rather than a
   * conversion function."*
   *
   * The AutoDoc calls the third and fourth arguments `Top` and `Left` and then
   * says *"Top = x coordinate of top left hand corner"* and *"Left = y
   * coordinate"*. Opal's own `Render/Renderer.c` settles which is which — it
   * calls `RGBtoOV (WriteScreen,RGBPlanes,0,Y,3*Width,Lines)` while walking
   * down an image, so the third argument is x and the fourth is y.
   *
   * `Modulo` is not a parameter here, so a plane's rows are `Width` apart.
   */
  rgbToOv(
    bus: Bus,
    scrn: number,
    planeList: number,
    x0: number,
    y0: number,
    width: number,
    height: number,
  ): void {
    const src = [read32(bus, planeList), read32(bus, planeList + 4), read32(bus, planeList + 8)]
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const x = x0 + col
        const y = y0 + row
        if (!this.inClip(scrn, x, y)) continue
        const r = bus.peek8(src[0]! + row * width + col)
        const g = bus.peek8(src[1]! + row * width + col)
        const b = bus.peek8(src[2]! + row * width + col)
        this.putPixel(scrn, x, y, (r | (g << 8) | (b << 16)) >>> 0)
      }
    }
  }

  /**
   * `OVtoRGB (OScrn, RGBPlanes[], x, y, Width, Height)` — the inverse, and
   * *"more flexible than the other memory conversion routines in that it can
   * convert a rectangular region of bitplane memory positioned anywhere within
   * the source screen"*. Not clipped: it is a conversion, not a drawing call.
   */
  ovToRgb(
    bus: Bus,
    scrn: number,
    planeList: number,
    x0: number,
    y0: number,
    width: number,
    height: number,
  ): void {
    const dst = [read32(bus, planeList), read32(bus, planeList + 4), read32(bus, planeList + 8)]
    const sw = this.peek16(scrn + OS.Width)
    const sh = this.peek16(scrn + OS.Height)
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const x = x0 + col
        const y = y0 + row
        const v = x >= 0 && x < sw && y >= 0 && y < sh ? this.getPixel(scrn, x, y) : 0
        bus.poke8(dst[0]! + row * width + col, v & 0xff)
        bus.poke8(dst[1]! + row * width + col, (v >>> 8) & 0xff)
        bus.poke8(dst[2]! + row * width + col, (v >>> 16) & 0xff)
      }
    }
  }

  /* -- the frame buffer -------------------------------------------------- */

  /** a segment's 128K, allocated on first use */
  segment(i: number): Uint8Array {
    const have = this.segmentData[i]
    if (have) return have
    const made = new Uint8Array(SEGMENT_SIZE)
    this.segmentData[i] = made
    return made
  }

  /** the same, without allocating: null when nothing has ever written to it */
  segmentIfWritten(i: number): Uint8Array | null {
    return this.segmentData[i] ?? null
  }

  /**
   * Where a screen pixel lands in the frame buffer.
   *
   * A segment is a plain 8-bit raster of `OVMODULO` bytes a line, and the two
   * ways a mode can spread a picture across segments are the two the manual
   * draws: *"In interlaced modes sequential horizontal lines are stored in
   * alternate memory fields"* and *"In high resolution modes, sequential pixels
   * along each horizontal line are situated in alternate banks"*. Everything
   * else the frame's `frameTarget` fixes.
   */
  private bufferCell(
    flags: number,
    t: FrameTarget,
    x: number,
    y: number,
  ): { field: number; bank: number; offset: number } | null {
    const lace = (flags & ILACE24) !== 0
    const hires = (flags & HIRES24) !== 0
    const field = lace ? y & 1 : t.fields[0]!
    const row = lace ? y >> 1 : y
    const bank = hires ? x & 1 : t.banks[0]!
    const col = hires ? x >> 1 : x
    if (row < 0 || row >= SEGMENT_LINES || col < 0 || col >= OVMODULO) return null
    return { field, bank, offset: row * OVMODULO + col }
  }

  /**
   * Push a screen into the frame buffer at the current write frame — the shared
   * body of `Refresh24` and of the continuous updates `UpdateDelay24` starts.
   *
   * *"This function will update the framebuffer in the minimum number of frames
   * required"*, and which segments it touches is `UpdateAll24` or
   * `UpdatePFStencil24`: the latter *"enables updates to only the segments
   * containing the playfield stencil (green segments)"*, so a green-only
   * refresh leaves red and blue as they were.
   */
  refresh(scrn: number): void {
    if (!this.screens.get(scrn >>> 0)) return
    const flags = this.peek16(scrn + OS.Flags)
    if (flags & CONTROLONLY24) return
    const width = this.peek16(scrn + OS.Width)
    const height = this.peek16(scrn + OS.Height)
    const comps = components(flags)
    const t = frameTarget(flags, this.writeFrame)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const at = this.bufferCell(flags, t, x, y)
        if (!at) continue
        const v = this.getPixel(scrn, x, y)
        for (let c = 0; c < comps; c++) {
          const colour = t.colours[c] ?? c
          if (this.pfStencilOnly && colour !== 1) continue
          this.segment(segmentIndex(at.field, at.bank, colour))[at.offset] = (v >>> (c * 8)) & 0xff
        }
      }
    }
  }

  /**
   * `DownLoadFrame24 (Scrn, x, y, w, h)` — the frame buffer read back into a
   * screen's bitplanes.
   *
   * The AutoDocs have no entry for it; the name, the argument order and the
   * registers come from `devdocs/Basic/opal_lib.fd`, which gives
   * `DownLoadFrame24(Scrn,x,y,w,h)(A0,D0,D1,D2,D3)`, and the behaviour from
   * hunk $53ca. That routine takes the display down to `SetLores24(0, 290)`,
   * clears CoPro bits 12 and 13, drives the transfer over CIA-B's parallel
   * port under `Forbid`, and unpacks each byte through the four pixel-phase
   * tables at hunk $6500. It halves `x` and `w` when `HIRES24` is set and
   * leaves `y` and `h` alone, so the rectangle is in screen pixels either way.
   *
   * What the read costs on the machine is the display: the frame buffer cannot
   * be scanned out and downloaded at once, which is why the routine reprograms
   * the CoPro first. Nothing here has a raster to interrupt, so the modelled
   * download is only the pixels.
   */
  downloadFrame(scrn: number, x0: number, y0: number, w: number, h: number): void {
    if (!this.screens.get(scrn >>> 0)) return
    const flags = this.peek16(scrn + OS.Flags)
    if (flags & CONTROLONLY24) return
    const width = this.peek16(scrn + OS.Width)
    const height = this.peek16(scrn + OS.Height)
    const comps = components(flags)
    const t = frameTarget(flags, this.displayFrame)
    for (let row = 0; row < h; row++) {
      const y = y0 + row
      if (y < 0 || y >= height) continue
      for (let col = 0; col < w; col++) {
        const x = x0 + col
        if (x < 0 || x >= width) continue
        const at = this.bufferCell(flags, t, x, y)
        if (!at) continue
        let v = 0
        for (let c = 0; c < comps; c++) {
          const seg = this.segmentIfWritten(segmentIndex(at.field, at.bank, t.colours[c] ?? c))
          v |= (seg?.[at.offset] ?? 0) << (c * 8)
        }
        this.putPixel(scrn, x, y, v >>> 0)
      }
    }
  }

  /* -- thumbnails -------------------------------------------------------- */

  /**
   * `WriteThumbnail24`'s picture: a 48 x 30 lores 24-bit OpalVision screen,
   * twelve planes of 360 bytes, 4320 bytes in all and no header.
   *
   * The `OVTN` chunk it goes into is documented nowhere in the developer kit,
   * so the layout comes from hunk $ad0c, which allocates `$10e0` bytes,
   * distributes them as twelve planes `$168` apart, and fills in a scratch
   * OpalScreen with Width `$30`, Height `$1e`, Depth `$c` and BytesPerLine `$c`
   * before writing the whole block out behind `"OVTN"` and its length.
   *
   * The scaler at hunk $ae7e is reproduced here rather than summarised, because
   * every step of it shows in the result:
   *
   * - the step is `max(srcW / 48, srcH / 30)` — integer division, both axes the
   *   same — so the thumbnail keeps the source's shape and leaves borders;
   * - then interlaced-and-not-hires halves the x step and hires-and-not-
   *   interlaced halves the y step, correcting for the pixel shape;
   * - each thumbnail pixel is the average of a 2 x 2 sample at the step's half
   *   offsets, and the four reads go through `ReadPixel24`, which does not
   *   store anything when the point falls outside the clip region — so a sample
   *   off the edge silently reuses the previous pixel's colour;
   * - the source is sampled in 8-, 15- or 24-bit terms and averaged without
   *   rescaling, so an 8-bit or 15-bit screen makes a very dark thumbnail.
   *
   * Two things the library gets wrong here are reproduced rather than fixed,
   * and `../runtime/opal.ts` catalogues both: the vertical loop bounds the
   * destination row against 48 rather than 30 — `cmpi.l #$30,$b0b2`, the
   * horizontal limit — so only `WritePixel24`'s clipping keeps those rows out
   * of the buffer; and 8-bit non-palette-mapped sampling loses red, because
   * hunk $aff0 unpacks the pen byte as 3-3-2, rotates red into `d1` and then
   * accumulates `d0`, which still holds green.
   */
  thumbnail(scrn: number): Uint8Array {
    const out = new Uint8Array(OVTN_SIZE)
    if (!this.screens.get(scrn >>> 0)) return out
    const srcW = this.peek16(scrn + OS.Width)
    const srcH = this.peek16(scrn + OS.Height)
    if (srcW <= 0 || srcH <= 0) return out
    const flags = this.peek16(scrn + OS.Flags)
    const hires = (flags & HIRES24) !== 0
    const lace = (flags & ILACE24) !== 0

    const xRatio = Math.floor(srcW / THUMB_W)
    const yRatio = Math.floor(srcH / THUMB_H)
    const both = Math.max(xRatio, yRatio)
    let xStep = lace && !hires ? both >> 1 : both
    let yStep = hires && !lace ? both >> 1 : both
    xStep = Math.max(1, xStep)
    yStep = Math.max(1, yStep)
    const xOff = xStep > xRatio ? (THUMB_W - Math.floor(srcW / xStep)) >> 1 : 0
    const yOff = yStep > yRatio ? (THUMB_H - Math.floor(srcH / yStep)) >> 1 : 0
    const halfX = xStep >> 1
    const halfY = yStep >> 1

    // Hunk $ae34 saves the source screen's RelX and RelY, clears them for the
    // duration of the scale, and then puts them back into `a3` -- the scratch
    // thumbnail structure -- instead of `a4`, so a screen that has had a
    // thumbnail taken of it comes back with both offsets zeroed. Reproduced;
    // see the catalogue in ../runtime/opal.ts
    this.poke16(scrn + OS.RelX, 0)
    this.poke16(scrn + OS.RelY, 0)

    let sx = 0
    let sy = 0
    let tx = xOff
    let ty = yOff
    for (;;) {
      let r = 0
      let g = 0
      let b = 0
      for (const dy of [0, halfY]) {
        for (const dx of [0, halfX]) {
          // ReadPixel24 leaves Red/Green/Blue untouched on a clip failure
          this.readPixel(scrn, sx + dx, sy + dy)
          r += this.peek8(scrn + OS.Red)
          g += this.peek8(scrn + OS.Green)
          b += this.peek8(scrn + OS.Blue)
        }
      }
      thumbPutPixel(
        out,
        tx,
        ty,
        ((r >> 2) & 0xff) | (((g >> 2) & 0xff) << 8) | (((b >> 2) & 0xff) << 16),
      )
      sx += xStep
      if (sx < srcW && ++tx < THUMB_W) continue
      tx = xOff
      sx = 0
      sy += yStep
      // the library's own bound, and it is the horizontal one
      if (sy >= srcH || ++ty >= THUMB_W) break
    }
    return out
  }

  /**
   * `DisplayThumbnail24`'s last step: 4320 bytes straight into the first twelve
   * planes of a screen, at hunk $a34a.
   *
   * It is a raw plane copy and not a draw, so nothing about it is clipped. The
   * x coordinate is *"rounded down to the nearest multiple of four in low
   * resolution mode and to the nearest multiple of 8 in high resolution"*
   * because a plane byte is four pixels and hires halves x first, and the y
   * coordinate is *"rounded down to the nearest even line in interlaced mode"*
   * — `bclr.b #$0,d1` — with the row stride doubled to match.
   *
   * Twelve planes are copied whatever the screen's depth, which is why the
   * AutoDoc says *"Thumbnails must always be displayed in low resolution non
   * interlaced mode"*: on a 24-plane hires screen those twelve are the even
   * pixels alone.
   */
  displayThumbnail(scrn: number, data: Uint8Array, x: number, y: number): void {
    const s = this.screens.get(scrn >>> 0)
    if (!s) return
    const flags = this.peek16(scrn + OS.Flags)
    let stride = this.peekS16(scrn + OS.BytesPerLine)
    let px = x
    let py = y
    if (flags & HIRES24) px >>= 1
    if (flags & ILACE24) {
      stride *= 2
      py &= ~1
    }
    const start = py * this.peekS16(scrn + OS.BytesPerLine) + (px >> 2)
    for (let p = 0; p < THUMB_PLANES; p++) {
      const base = this.peek32(scrn + OS.BitPlanes + p * 4)
      if (base === 0) break
      for (let row = 0; row < THUMB_H; row++) {
        for (let i = 0; i < THUMB_ROW; i++) {
          this.poke8(base + start + row * stride + i, data[p * THUMB_PLANE + row * THUMB_ROW + i]!)
        }
      }
    }
  }

  /* -- IFF ---------------------------------------------------------------- */

  /**
   * `SaveIFF24 (OScrn, FileName, ChunkFunction, Flags)`, as bytes.
   *
   * The AutoDoc lists the chunks — *"CAMG ... CMAP ... CLUT ... OVTN ...
   * BODY"* — and hunk $a39c gives the order they go out in, which is not that
   * one: the thumbnail is written first of all, before `BMHD`. Nothing in the
   * kit remarks on it, and `DisplayThumbnail24` depends on it, since that
   * routine gives up the moment it reaches `BODY`.
   *
   * `OVFASTFORMAT` changes three things together: the FORM type becomes `OVFT`
   * instead of `ILBM`, `BMHD`'s compression byte becomes 0, and the `BODY` is
   * the screen's own planes copied out whole — two bits a pixel, plane after
   * plane, no interleaving and no packing. That format is named in the AutoDoc
   * and described nowhere.
   *
   * The AutoDoc's *"CMAP - Colour map if in 8bit mode. CLUT - Colour lookup
   * tables if in true colour mode"* overstates both: the library writes colours
   * only for a `PALMAP24` screen, and then `CMAP` if it is also `PLANES8` and
   * three `CLUT`s otherwise. A plain 24-bit screen gets neither.
   *
   * With `OVFASTFORMAT` and `SAVEMASK24` together the mask is appended to the
   * `BODY` but the length written ahead of it counts only the colour planes, so
   * the chunk under-reports by one mask plane, and the error check on that
   * write is dead as well — `cmp.l d0,d0` where `cmp.l d3,d0` was meant. Both
   * are reproduced; see the catalogue in `../runtime/opal.ts`.
   *
   * `ChunkFunction` has no counterpart here. It is *"a pointer to code to be
   * executed after file is opened"* called in C convention with the DOS file
   * handle on the stack, and an AMOS program can only supply a raw address into
   * a Code Bank; this port has no 68000 to run it on, so any non-zero value is
   * treated as the AutoDoc's *"must return 0 or an error code"* returning 0.
   */
  saveIff(scrn: number, saveFlags: number): Uint8Array {
    const out: number[] = []
    const put = (t: string): void => {
      for (let i = 0; i < t.length; i++) out.push(t.charCodeAt(i) & 0xff)
    }
    const put16 = (v: number): void => {
      out.push((v >>> 8) & 255, v & 255)
    }
    const put32 = (v: number): void => {
      out.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255)
    }
    const fast = (saveFlags & OVFASTFORMAT) !== 0

    put('FORM')
    put32(0)
    put(fast ? 'OVFT' : 'ILBM')
    if (!this.screens.get(scrn >>> 0)) return Uint8Array.from(out)

    const flags = this.peek16(scrn + OS.Flags)
    const width = this.peek16(scrn + OS.Width)
    const height = this.peek16(scrn + OS.Height)
    const depth = this.peek16(scrn + OS.Depth)
    const rowBytes = this.peekS16(scrn + OS.BytesPerLine)
    const hires = (flags & HIRES24) !== 0
    const maskPlane = this.peek32(scrn + OS.MaskPlane)
    const withMask = maskPlane !== 0 && (saveFlags & SAVEMASK24) !== 0

    if (!(saveFlags & NOTHUMBNAIL)) {
      const thumb = this.thumbnail(scrn)
      put('OVTN')
      put32(OVTN_SIZE)
      for (const b of thumb) out.push(b)
    }

    // BMHD. nPlanes is the count an ILBM reader expects, which is the screen's
    // own Depth doubled in lores -- twelve two-bit planes are twenty-four
    // one-bit ones
    const planes = hires ? depth : depth * 2
    const aspect = (flags & NTSC24 ? NTSC_ASPECT : PAL_ASPECT)[flags & 3]!
    put('BMHD')
    put32(20)
    put16(width)
    put16(height)
    put16(0)
    put16(0)
    out.push(planes & 255, withMask ? 1 : 0, fast ? 0 : 1, 0)
    put16(0)
    out.push(aspect[0]!, aspect[1]!)
    put16(width)
    put16(height)

    // CAMG, and it carries the two resolution bits and nothing else
    put('CAMG')
    put32(4)
    put32((hires ? 0x8000 : 0) | (flags & ILACE24 ? 4 : 0))

    if (flags & PALMAP24) {
      if (flags & PLANES8) {
        // 3 << planes, or the whole 768 once planes reaches 8 -- which it
        // always has, since the smallest Depth CreateScreen24 makes is 4
        const n = planes >= 8 ? 768 : 3 * (1 << planes)
        put('CMAP')
        put32(n)
        for (let i = 0; i < n; i++) out.push(this.peek8(scrn + OS.Palette + i))
      } else {
        // ColorLookupTable types 1, 2 and 3: red, green, blue
        for (let type = 1; type <= 3; type++) {
          put('CLUT')
          put32(264)
          put32(type)
          put32(0)
          for (let i = 0; i < 256; i++) out.push(this.peek8(scrn + OS.Palette + i * 3 + type - 1))
        }
      }
    }

    put('BODY')
    if (fast) {
      put32(rowBytes * height * depth)
      for (let p = 0; p < depth; p++) {
        const base = this.peek32(scrn + OS.BitPlanes + p * 4)
        for (let i = 0; i < rowBytes * height; i++) out.push(this.peek8(base + i))
      }
      if (withMask) {
        const n = (width >> 3) * height
        for (let i = 0; i < n; i++) out.push(this.peek8(maskPlane + i))
      }
    } else {
      const at = out.length
      put32(0)
      const conv = this.convDepth(scrn)
      const dstWidth = ((width + 15) >> 4) * 2
      const rows: Uint8Array[] = []
      for (let p = 0; p < conv; p++) rows.push(new Uint8Array(dstWidth))
      const mask = new Uint8Array(dstWidth)
      for (let y = 0; y < height; y++) {
        for (const r of rows) r.fill(0)
        for (let x = 0; x < Math.min(width, dstWidth * 8); x++) {
          const v = this.getPixel(scrn, x, y)
          const bit = 0x80 >> (x & 7)
          for (let p = 0; p < conv; p++) if ((v >>> p) & 1) rows[p]![x >> 3]! |= bit
        }
        for (const r of rows) packRow(r, out)
        if (withMask) {
          for (let i = 0; i < dstWidth; i++) mask[i] = this.peek8(maskPlane + y * dstWidth + i)
          packRow(mask, out)
        }
      }
      if ((out.length - at - 4) & 1) out.push(0)
      const len = out.length - at - 4
      out[at] = (len >>> 24) & 255
      out[at + 1] = (len >>> 16) & 255
      out[at + 2] = (len >>> 8) & 255
      out[at + 3] = len & 255
    }

    const form = out.length - 8 + ((out.length - 8) & 1)
    out[4] = (form >>> 24) & 255
    out[5] = (form >>> 16) & 255
    out[6] = (form >>> 8) & 255
    out[7] = form & 255
    return Uint8Array.from(out)
  }

  /**
   * Which screen a load lands in, for both halves of `LoadImage24`.
   *
   * *"If the screen pointer is NULL then LoadImage24 will open a screen itself,
   * the screen it opens will be a display screen unless VIRTUALSCREEN24 is set
   * ... If the passed screen structure is not NULL and the image being loaded
   * is the same resolution, then it will be loaded into that screen. If this is
   * not the case then the screen will be closed and a new screen of the same
   * resolution as the file will be opened. However if KEEPRES24 is set, the
   * file will be loaded into the supplied screen regardless of its
   * resolution."*
   *
   * Zero means the open failed and the caller answers `OL_ERR_OUTOFMEM`.
   */
  private loadTarget(
    flags: number,
    width: number,
    height: number,
    scrn: number,
    loadFlags: number,
    ntsc: boolean,
  ): number {
    const RES = HIRES24 | ILACE24 | PLANES8 | PLANES15
    let target = scrn >>> 0
    if (target !== 0 && !(loadFlags & KEEPRES24)) {
      if ((this.peek16(target + OS.Flags) & RES) !== (flags & RES)) {
        this.freeScreen(target)
        target = 0
      }
    }
    if (target !== 0) return target
    const virt = (loadFlags & VIRTUALSCREEN24) !== 0
    const size = virt ? { width, height } : screenSize(flags, ntsc)
    target = this.newScreen(flags | (loadFlags & CLOSEABLE24), size.width, size.height, !virt)
    if (target === 0) return 0
    if (!virt) {
      if (this.active !== 0 && this.active !== target) this.freeScreen(this.active)
      this.active = target
    }
    return target
  }

  /**
   * `SaveJPEG24 (OScrn, FileName, Flags, Quality)`, as bytes.
   *
   * The screen is read a row at a time through `OVtoRGB`, which is what hunk 3
   * $1e9a does: `x` fixed at 0, `Height` fixed at 1, and the y coordinate bumped
   * after each call. That routine hands back *"three planes, one containing
   * Red, one Blue and the last Green, each of these has one byte per pixel"* —
   * the screen's own component bytes, with no attention to what they mean, so a
   * palette-mapped screen saves its indices as red and an 8-bit screen saves
   * dark. Reading them here through `getPixel` is the same read without the
   * three intermediate buffers.
   *
   * *"A thumbnail will also be written into the APP0 marker of the JFIF file
   * unless the NOTHUMBNAIL flag is set"*, and it is the `OVTN` chunk again —
   * the four-byte tag and 4320 bytes of OpalVision planes, declared to JFIF as
   * a 48 by 30 RGB thumbnail that it is not. See ../amiga/jpeg.ts.
   *
   * Making the thumbnail zeroes the screen's `RelX` and `RelY`, because
   * `MakeThumbnail` does; the catalogue in ../runtime/opal.ts has it.
   */
  saveJpeg(scrn: number, saveFlags: number, quality: number): Uint8Array | null {
    if (!this.screens.get(scrn >>> 0)) return null
    const width = this.peek16(scrn + OS.Width)
    const height = this.peek16(scrn + OS.Height)
    if (width <= 0 || height <= 0) return null
    const wanted = (saveFlags & NOTHUMBNAIL) === 0
    const thumb = wanted
      ? { x: THUMB_W, y: THUMB_H, data: taggedThumbnail(this.thumbnail(scrn)) }
      : null
    const pixels = new Uint8Array(width * height * 3)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const v = this.getPixel(scrn, x, y)
        const o = (y * width + x) * 3
        pixels[o] = v & 0xff
        pixels[o + 1] = (v >>> 8) & 0xff
        pixels[o + 2] = (v >>> 16) & 0xff
      }
    }
    return encodeJpeg(pixels, width, height, thumb ? { quality, thumbnail: thumb } : { quality })
  }

  /**
   * `LoadImage24 (OScrn, FileName, Flags)` for the JPEG half.
   *
   * A JPEG carries no `CAMG`, so there is nothing to take a display mode from
   * and hunk 3 $c50 takes one from the picture's width instead: over 640 is
   * hires and overscan, over 370 is hires, over 320 is overscan, and anything
   * else is plain lores. Over 256 lines is interlaced. The thresholds are the
   * routine's own; that a JPEG is what reaches them is read from the branch at
   * $c00, which sends a file with no mode information down this path.
   *
   * The screen is always true colour. Rows go in through `RGBtoOV` — hunk 3
   * $142a — which writes three component bytes a pixel whatever the depth, so
   * there is no palette-mapped arm here the way there is for IFF.
   */
  loadJpeg(data: Uint8Array, scrn: number, loadFlags: number, ntsc: boolean): number {
    const img = decodeJpeg(data)
    if (!img) return OL_ERR_FORMATUNKNOWN
    let flags = 0
    if (img.width > 640) flags = HIRES24 | OVERSCAN24
    else if (img.width > 370) flags = HIRES24
    else if (img.width > 320) flags = OVERSCAN24
    if (img.height > 256) flags |= ILACE24
    if (ntsc) flags |= NTSC24

    const target = this.loadTarget(flags, img.width, img.height, scrn, loadFlags, ntsc)
    if (target === 0) return OL_ERR_OUTOFMEM

    const dw = this.peek16(target + OS.Width)
    const dh = this.peek16(target + OS.Height)
    for (let y = 0; y < Math.min(img.height, dh); y++) {
      for (let x = 0; x < Math.min(img.width, dw); x++) {
        const o = (y * img.width + x) * 3
        this.putPixel(
          target,
          x,
          y,
          (img.pixels[o]! | (img.pixels[o + 1]! << 8) | (img.pixels[o + 2]! << 16)) >>> 0,
        )
      }
    }
    return target
  }

  /**
   * `LoadImage24 (OScrn, FileName, Flags)` for the IFF half.
   *
   * *"The IFF portion of this loader will load IFF 24bit, Fast Format 24 bit,
   * Palette mapped (up to 256 colours), Hold and Modify and Extra half brite
   * files"*, and *"All palette mapped files will be loaded in the 8 bit palette
   * mapped mode unless the CONVERT24 flag is set"* — which names a flag the
   * headers do not have; the flag list two paragraphs down calls it `FORCE24`,
   * and that is the one `opallib.h` defines.
   *
   * Which screen the picture lands in follows the AutoDoc exactly: a NULL
   * screen opens one, *"a display screen unless VIRTUALSCREEN24 is set"*; a
   * screen of the wrong resolution is closed and replaced *"however if
   * KEEPRES24 is set, the file will be loaded into the supplied screen
   * regardless"*. The answer is a screen pointer or an error, told apart by
   * `OL_ERR_MAXERR`.
   *
   * A display screen gets the resolution's standard size rather than the file's
   * — `OpenScreen24` has no other size to give — and the picture is written
   * into the top left of it. A virtual screen gets the file's own dimensions.
   */
  loadIff(data: Uint8Array, scrn: number, loadFlags: number, ntsc: boolean): number {
    const u16 = (i: number): number => ((data[i] ?? 0) << 8) | (data[i + 1] ?? 0)
    const u32 = (i: number): number => ((u16(i) << 16) | u16(i + 2)) >>> 0
    const tag = (i: number): string =>
      String.fromCharCode(data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0, data[i + 3] ?? 0)

    if (data.length < 12) return OL_ERR_FILEREAD
    if (tag(0) !== 'FORM') return OL_ERR_NOTIFF
    const form = tag(8)
    if (form !== 'ILBM' && form !== 'OVFT') return OL_ERR_NOTILBM

    let width = 0
    let height = 0
    let nPlanes = 0
    let masking = 0
    let compression = 0
    let camg = 0
    let cmap: Uint8Array | null = null
    const clut: (Uint8Array | null)[] = [null, null, null]
    let body: Uint8Array | null = null
    for (let p = 12; p + 8 <= data.length;) {
      const id = tag(p)
      const len = u32(p + 4)
      const at = p + 8
      const end = Math.min(at + len, data.length)
      switch (id) {
        case 'BMHD':
          width = u16(at)
          height = u16(at + 2)
          nPlanes = data[at + 8] ?? 0
          masking = data[at + 9] ?? 0
          compression = data[at + 10] ?? 0
          break
        case 'CAMG':
          camg = u32(at)
          break
        case 'CMAP':
          cmap = data.subarray(at, end)
          break
        case 'CLUT': {
          const type = u32(at)
          if (type >= 1 && type <= 3) clut[type - 1] = data.subarray(at + 8, end)
          break
        }
        case 'BODY':
          body = data.subarray(at, end)
          break
      }
      p = at + len + (len & 1)
    }
    if (width === 0 || height === 0 || nPlanes === 0 || !body) return OL_ERR_BADIFF

    const ham = (camg & 0x800) !== 0
    const ehb = (camg & 0x80) !== 0
    const force = (loadFlags & FORCE24) !== 0
    // 24 planes is true colour, 16 is the 15-bit mode stored as sixteen, and a
    // HAM file has to become true colour because HAM is not a palette
    const paletted = nPlanes < 16 && !ham
    let flags = (camg & 0x8000 ? HIRES24 : 0) | (camg & 4 ? ILACE24 : 0)
    if (nPlanes === 16) flags |= PLANES15
    else if (paletted && !force) flags |= PLANES8 | PALMAP24
    if (width > (flags & HIRES24 ? 640 : 320)) flags |= OVERSCAN24
    if (ntsc) flags |= NTSC24

    const virt = (loadFlags & VIRTUALSCREEN24) !== 0
    const target = this.loadTarget(flags, width, height, scrn, loadFlags, ntsc)
    if (target === 0) return OL_ERR_OUTOFMEM

    // the palette, whichever chunk carried it -- 768 bytes into OS_Palette,
    // which is the `move.l (a2)+,(a1)+` x 192 at hunk $917e
    const pal = new Uint8Array(768)
    for (let i = 0; i < 768; i++) pal[i] = this.peek8(target + OS.Palette + i)
    if (cmap) for (let i = 0; i < Math.min(768, cmap.length); i++) pal[i] = cmap[i]!
    for (let c = 0; c < 3; c++) {
      const t = clut[c]
      if (t) for (let i = 0; i < 256 && i < t.length; i++) pal[i * 3 + c] = t[i]!
    }
    if (ehb && cmap) {
      // "Extra half brite": the upper 32 entries are half the lower 32
      for (let i = 0; i < 32; i++) {
        for (let c = 0; c < 3; c++) pal[(32 + i) * 3 + c] = (pal[i * 3 + c]! >> 1) & 0xff
      }
    }
    for (let i = 0; i < 768; i++) this.poke8(target + OS.Palette + i, pal[i]!)
    if (!virt) this.palette.set(pal)

    const dw = this.peek16(target + OS.Width)
    const dh = this.peek16(target + OS.Height)

    if (form === 'OVFT') {
      // the screen's own planes, straight back in
      const depth = this.peek16(target + OS.Depth)
      const dstRow = this.peekS16(target + OS.BytesPerLine)
      const srcRow = bytesPerLine(width, (camg & 0x8000) !== 0)
      const srcPlane = srcRow * height
      const cols = Math.min(srcRow, dstRow)
      for (let pl = 0; pl < depth; pl++) {
        const base = this.peek32(target + OS.BitPlanes + pl * 4)
        if (base === 0) break
        for (let y = 0; y < Math.min(height, dh); y++) {
          for (let i = 0; i < cols; i++) {
            this.poke8(base + y * dstRow + i, body[pl * srcPlane + y * srcRow + i] ?? 0)
          }
        }
      }
      return target
    }

    const srcRow = ((width + 15) >> 4) * 2
    const planesPerRow = nPlanes + (masking === 1 ? 1 : 0)
    const rows: Uint8Array[] = []
    for (let p = 0; p < planesPerRow; p++) rows.push(new Uint8Array(srcRow))
    let mask = 0
    if (masking === 1 && loadFlags & LOADMASK24) {
      mask = this.pool.alloc((dw >> 3) * dh, { clear: true })
      this.poke32(target + OS.MaskPlane, mask)
    }
    let bp = 0
    for (let y = 0; y < height; y++) {
      for (let p = 0; p < planesPerRow; p++) {
        const row = rows[p]!
        row.fill(0)
        if (compression === 1) {
          let o = 0
          while (o < srcRow && bp < body.length) {
            const n = body[bp++]!
            if (n < 128) for (let i = 0; i <= n && o < srcRow; i++) row[o++] = body[bp++] ?? 0
            else if (n > 128) {
              const v = body[bp++] ?? 0
              for (let i = 0; i < 257 - n && o < srcRow; i++) row[o++] = v
            }
          }
        } else {
          row.set(body.subarray(bp, bp + srcRow))
          bp += srcRow
        }
      }
      if (y >= dh) continue
      let hr = 0
      let hg = 0
      let hb = 0
      for (let x = 0; x < Math.min(width, dw); x++) {
        let idx = 0
        const byte = x >> 3
        const bit = 7 - (x & 7)
        for (let p = 0; p < nPlanes; p++) idx |= ((rows[p]![byte]! >> bit) & 1) << p
        let value = idx
        if (ham) {
          // HAM6 holds two control bits above four data bits; HAM8 two above six
          const bits = nPlanes >= 8 ? 6 : 4
          const ctl = idx >> bits
          const d = idx & ((1 << bits) - 1)
          const up = 8 - bits
          if (ctl === 0) {
            hr = pal[d * 3]!
            hg = pal[d * 3 + 1]!
            hb = pal[d * 3 + 2]!
          } else if (ctl === 1) hb = (d << up) & 0xff
          else if (ctl === 2) hr = (d << up) & 0xff
          else hg = (d << up) & 0xff
          value = (hr | (hg << 8) | (hb << 16)) >>> 0
        } else if (paletted && force) {
          value = (pal[idx * 3]! | (pal[idx * 3 + 1]! << 8) | (pal[idx * 3 + 2]! << 16)) >>> 0
        }
        this.putPixel(target, x, y, value >>> 0)
      }
      if (mask !== 0) {
        const src = rows[nPlanes]!
        for (let i = 0; i < Math.min(srcRow, dw >> 3); i++)
          this.poke8(mask + y * (dw >> 3) + i, src[i]!)
      }
    }
    return target
  }
}

/**
 * `BMHD`'s xAspect and yAspect, from the two eight-byte tables at hunks $a662
 * and $a66a, indexed by `flags & (HIRES24 | ILACE24)`. `NTSC24` picks the
 * second, and the two are on different scales for no reason the kit gives.
 */
const PAL_ASPECT: ReadonlyArray<readonly [number, number]> = [
  [0x32, 0x2b],
  [0x32, 0x56],
  [0x64, 0x2b],
  [0x32, 0x2b],
]
const NTSC_ASPECT: ReadonlyArray<readonly [number, number]> = [
  [0x0a, 0x0b],
  [0x05, 0x0b],
  [0x14, 0x0b],
  [0x0a, 0x0b],
]

/** ByteRun1, appended to a growing byte list — `BODY`'s packing when not fast format */
function packRow(row: Uint8Array, out: number[]): void {
  let i = 0
  while (i < row.length) {
    let run = 1
    while (i + run < row.length && row[i + run] === row[i] && run < 128) run++
    if (run >= 2) {
      out.push(257 - run, row[i]!)
      i += run
      continue
    }
    const start = i
    let lit = 0
    while (i < row.length && lit < 128) {
      if (i + 2 < row.length && row[i + 1] === row[i] && row[i + 2] === row[i]) break
      i++
      lit++
    }
    out.push(lit - 1)
    for (let j = start; j < i; j++) out.push(row[j]!)
  }
}

/* ---- the OVTN thumbnail, as bytes ------------------------------------- */

/** the scratch screen hunk $adc4 fills in: `move.w #$30,(a3)` and `#$1e,$2(a3)` */
export const THUMB_W = 48
export const THUMB_H = 30
/** `move.w #$c,$4(a3)` and `#$c,$e(a3)` — Depth and BytesPerLine */
export const THUMB_PLANES = 12
export const THUMB_ROW = 12
/** `lea $168(a1),a1` between plane pointers */
export const THUMB_PLANE = THUMB_ROW * THUMB_H
/** `move.l #$10e0,$b0c0.l` — the OVTN chunk's length, and it is always this */
export const OVTN_SIZE = THUMB_PLANE * THUMB_PLANES

/**
 * The APP0 payload: the tag and then the planes, with no length between them.
 *
 * Hunk 3 $1cc0 writes the four bytes and hunk 3 $1ce4 writes the 4320 — unlike
 * the IFF chunk of the same name, which carries `$10e0` in between.
 */
function taggedThumbnail(planes: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + OVTN_SIZE)
  out.set([0x4f, 0x56, 0x54, 0x4e])
  out.set(planes, 4)
  return out
}

/**
 * One pixel into the thumbnail block, with the screen's own two-bits-a-plane
 * layout at a fixed 48 x 30 x 12. Out-of-range rows and columns are dropped,
 * which is `WritePixel24`'s clip against the scratch screen's own rectangle.
 */
function thumbPutPixel(out: Uint8Array, x: number, y: number, value: number): void {
  if (x < 0 || x >= THUMB_W || y < 0 || y >= THUMB_H) return
  const byte = y * THUMB_ROW + (x >> 2)
  const shift = 6 - ((x & 3) << 1)
  for (let c = 0; c < 3; c++) {
    const v = (value >>> (c * 8)) & 0xff
    for (let p = 0; p < 4; p++) {
      const pair = ((v >> p) & 1) | (((v >> (p + 4)) & 1) << 1)
      const at = (c * 4 + p) * THUMB_PLANE + byte
      out[at] = ((out[at]! & ~(3 << shift)) | (pair << shift)) & 0xff
    }
  }
}

/** a longword from the machine, for the plane-pointer arrays the conversions take */
function read32(bus: Bus, a: number): number {
  return (
    ((bus.peek8(a) << 24) |
      (bus.peek8(a + 1) << 16) |
      (bus.peek8(a + 2) << 8) |
      bus.peek8(a + 3)) >>>
    0
  )
}
