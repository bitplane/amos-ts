/**
 * AGA 1.0 — 256-colour screens for AMOS, by Nigel Critten, 1995. Licenceware
 * (F1), copyright Michael Prince. 24 keywords at slot 20, which the docs state
 * outright: "Type in at line 20 ... AMOSPro_AGA.Lib".
 *
 * Evidence: `AGA_Doc` (which documents 21 of the 24) plus every routine in the
 * 9,904-byte code hunk disassembled with `extdis aga-1.0`. Where the two
 * disagree the binary wins, and the disagreements are recorded below.
 *
 * `AGA.lib` and `AMOSPro_AGA.lib` carry a byte-identical token table, so this
 * one port answers for AMOS 1.3 and AMOS Pro alike. The archive's v0.09 ships
 * no library at all, only a readme and a Guide, so there is no second release
 * to serve.
 *
 * ## What the extension actually is
 *
 * A thin AMOS-facing veneer over **graphics.library**. Every drawing keyword
 * is a library call on the AGA screen's RastPort, reached through
 * `a6 = -$18ae(a5)`:
 *
 *   Aga Cls         SetRast              jsr -$ea
 *   Aga Bar         RectFill             jsr -$132
 *   Aga Box         Move + PolyDraw      jsr -$f0, -$150
 *   Aga Point       ReadPixel            jsr -$13e
 *   Aga Draw Mode   SetDrMd              jsr -$162
 *   Aga Text        TextExtent + TextFit jsr -$2b2, -$396
 *   Aga Screen Copy BltBitMapRastPort    jsr -$25e
 *   Aga Put Block   BltMaskBitMapRastPort when the block has a mask, -$27c
 *   Aga Use Font    OpenDiskFont         jsr -$1e on diskfont.library
 *
 * so the port is those primitives — which `src/amiga/graphics.ts` has had
 * since the RastPort work — driven from the extension's own state block.
 *
 * ## The state block at $228(a5)
 *
 *   $00  Aga Ink, a BYTE — which is why the doc says a colour over 255
 *        "will wrap around again": it is truncation, not a range check
 *   $54  the per-bank copper offsets Aga Colour indexes
 *   $7e  the copper list the screens are displayed by
 *   $8a  the screen with the focus
 *   $96  the eight screen pointers
 *   $b2  the block table          $b6  the open font
 *   $ba  diskfont.library base    $c4  the clipping flag
 *
 * ## Screens
 *
 * Every AGA screen is 320x256x8 and they **share one palette** — the doc says
 * so ("At the present time each screen has to share a common palette") and
 * `Aga Get Bank Palette` proves it, because it has no screen argument at all
 * despite a synopsis that shows one.
 *
 * DEVIATION: the original builds its own copper list outside AMOS's screen
 * system, which is why its docs warn that "Sprites,Bobs and Mouse related
 * commands may react in a corrupting way on screen". Here an AGA screen is an
 * ordinary `Screen` of 256 colours — the display grew eight-bitplane screens
 * and a banked 24-bit palette for exactly this — so it composes with sprites,
 * bobs and the pointer instead of fighting them. Programs written around that
 * warning will look better than they did, not worse, and nothing they can do
 * depends on the corruption.
 *
 * ## Where the doc and the binary disagree
 *
 * The doc is wrong about `Aga Get Bank Palette`, which it calls "AGA Get
 * Palette Bank bank To screen". Three things are wrong with that line — the
 * keyword is not called that, there is no `To`, and there is no screen
 * argument. The token spec is `I0`: one bank, nothing else.
 *
 * `Aga Get Palette` is FOUR BYTES, `move.l (a3)+,d0 / rts` ($11d8). It pops
 * its argument and returns. It is undocumented, and it is not the keyword the
 * doc's "AGA Get Palette Bank" entry describes — that is the routine above.
 * Reproduced as the no-op it is.
 *
 * ## The packed picture format, read off Aga Unpack ($1fd2)
 *
 * A bank headed `Aga.Pic`:
 *
 *  - **1024 bytes of palette**: 256 entries of two words, the high nibbles
 *    then the low nibbles, which the routine pokes into the copper list four
 *    bytes apart at +0 and +$420 — the LOCT pair.
 *  - **then an RLE stream of (count, value) byte pairs** decoded into a
 *    320x256 CHUNKY buffer, one byte a pixel. `x += count` after each run and
 *    a run never crosses a row: at 320 the routine zeroes x and steps y, and
 *    stops at y = 256. The chunky buffer is converted to bitplanes in one go
 *    at the end, which is why the doc can say Akiko helps.
 *
 * A count of zero still writes one byte — the store precedes the `dbra` — but
 * advances x by nothing, so a stream full of zeroes never terminates. The
 * packer never emits one.
 */
import type { Runtime } from './runtime'
import type { Func, Instr } from '../interp/builtins'
import { VI, AmosError, int, type Value } from '../interp/values'
import { BitMap, RastPort } from '../amiga/graphics'
import { bltBitMap } from '../amiga/blitter'
import { rowBytesFor } from '../amiga/planar'
import { openDiskFont } from '../amiga/diskfont'

/** every AGA screen is this size; nothing in the extension varies it */
const AGA_W = 320
const AGA_H = 256
/** "Allows upto 4000 blocks to be grabbed with numbers from 1 to 4000" */
const MAX_BLOCK = 4000

/**
 * The extension routes every failure through routine 68 with a number in d0.
 * Its message table was not read, so these map onto AMOS's own errors rather
 * than inventing text: what a program can observe through `Trap` is that the
 * call failed, and the numbers below are the extension's, kept for the record.
 *
 *   0 screen not open      1 screen already exists   3 bad bar coordinates
 *   5 screen number out of range                     8 block number out of range
 *   $a block does not exist                          $10 out of memory
 */
const agaErr: (n: number) => never = (n) => {
  if (n === 0x10) throw new AmosError('out of memory')
  throw new AmosError('Illegal function call', 23)
}

interface AgaBlock {
  /** the block's own bitmap, which is what Get Block really allocates */
  bm: BitMap
  /** "You cannot allocate a mask afterwards" — decided at Get Block */
  mask: boolean
}

export interface AgaState {
  /** $96: which AMOS screen number each AGA screen took, -1 for closed */
  screens: Int8Array
  /** $8a: the screen with the focus, -1 when none */
  current: number
  /**
   * The extension's own RastPort — the state block at $228(a5) holds one set
   * of pens, one draw mode and one font for the whole extension, and the
   * screen with the focus supplies the bitmap they act on.
   *
   * Deliberately NOT the focused Screen's RastPort. AGA screens are real AMOS
   * `Screen`s here, so `s.rp` carries whatever AMOS's own Ink, Gr Writing and
   * Set Planes last set; drawing an extension's graphics through it would let
   * AMOS's state into a library that has none of its own. A separate RastPort
   * over the same BitMap starts at the library defaults — full write mask,
   * solid line pattern — which is what the extension actually has.
   *
   * rp_FgPen is Aga Ink ($0, a BYTE, so 256 wraps to 0), rp_DrawMode is
   * SetDrMd (0 JAM1, 1 JAM2, 2 COMPLEMENT, 4 INVERSVID) and rp_Font is $b6,
   * the face Aga Use Font opened.
   */
  rp: RastPort
  /** $c4 */
  clip: boolean
  /** 0 low, 1 medium, 2 high — patched into the copper as $00/$80/$c0 */
  spriteMode: number
  /** $b2, numbered 1..4000 */
  blocks: Map<number, AgaBlock>
}

export function newAgaState(): AgaState {
  // a placeholder surface until a screen takes the focus: every keyword that
  // draws goes through `focus()`, which errors before the bitmap is read
  const rp = new RastPort(new BitMap(1, 1, 1, 2))
  rp.fgPen = 0
  rp.drawMode = 0 // the extension's SetDrMd default is JAM1, not AMOS's JAM2
  return {
    screens: Int8Array.from([-1, -1, -1, -1, -1, -1, -1, -1]),
    current: -1,
    rp,
    clip: true,
    spriteMode: 0,
    blocks: new Map(),
  }
}

export function makeAgaInstructions(rt: Runtime): Record<string, Instr> {
  /**
   * The extension's RastPort, pointed at the screen with the focus — or the
   * extension's error 0 when there is none.
   *
   * Repointing the bitmap rather than keeping a RastPort per screen is what
   * the state block does: one set of pens at $228(a5), and $8a saying which
   * screen they currently act on.
   */
  const focus = (): RastPort => {
    const st = rt.aga
    if (st.current < 0) agaErr(0)
    const s = rt.screens.get(st.current)
    if (!s) agaErr(0)
    st.rp.bitMap = s.rp.bitMap
    return st.rp
  }

  /** the AMOS bank a `bank` argument names, as raw bytes */
  const bankBytes = (n: number): Uint8Array => {
    const b = rt.memBanks.get(n)
    if (!b) agaErr(0x10)
    return b.data
  }

  return {
    'aga screen open'(it) {
      // routine 2 ($1050): 0..7 or error 5, must not already exist (error 1),
      // 320x256x8, brought to the front, and the default font selected
      const n = it.evalInt()
      if (n < 0 || n > 7) agaErr(5)
      const st = rt.aga
      if (st.screens[n]! >= 0) agaErr(1)
      openAgaScreen(rt, n)
      st.screens[n] = n
      st.current = n
      rt.currentIndex = n
    },
    /**
     * Aga Screen Close n — routine 22 ($1540), 28 bytes: look the screen up
     * (routine 28), `cmp.w #$0,d0 / beq` to the error tail at routine 68 if it
     * is not open, and otherwise routine 33 to close it.
     *
     * The doc's warning stands -- "If you have more than one screen open and
     * you close the top screen you will have to use AGA Front Screen to bring
     * a new screen to the front" -- so nothing is promoted.
     */
    'aga screen close'(it) {
      const n = it.evalInt()
      const st = rt.aga
      if (n < 0 || n > 7 || st.screens[n]! < 0) agaErr(0)
      rt.closeScreen(n)
      st.screens[n] = -1
      if (st.current === n) st.current = -1
    },
    /**
     * Aga Screen n — routine 23 ($155c), the focus, so "all future drawing
     * operations will be carried out on this screen". It does NOT bring it to
     * the front.
     *
     *     move.l  (a3)+, d1
     *     movea.l $228(a5), a2 / adda.w #$96, a2     the screen pointer table
     *     move.l  d1, d0 / asl.w #$2, d0
     *     movea.l (a2, d0.l), a2
     *     tst.l   a2 / beq -> routine 68             only a NULL check
     *     move.l  a2, $8a(a1)                        the current screen
     *
     * DEVIATION: the index is scaled and used with no range check at all --
     * only the pointer it lands on is tested -- so `Aga Screen 99` reads past
     * the eight-entry table on the machine and `Aga Screen -1` reads before it.
     * This port bounds it to 0..7 and raises the same error 0, for the reason
     * Exchange Icon does: there is no table behind it to read off the end of.
     */
    'aga screen'(it) {
      const n = it.evalInt()
      const st = rt.aga
      if (n < 0 || n > 7 || st.screens[n]! < 0) agaErr(0)
      st.current = n
    },
    'aga front screen'(it) {
      // routine 30 ($1868), which brings it forward AND hides the others.
      //
      // NOTE: this routine indexes the screen table through a2 without ever
      // loading a2 -- every sibling does `movea.l $228(a5),a2 / adda.w #$96,a2`
      // first and this one does not. Whether that is a live defect depends on
      // what the dispatcher leaves in a2, which cannot be settled without
      // running the 68k. Implemented as the doc and the routine's evident
      // intent say, with the discrepancy recorded rather than guessed at.
      const n = it.evalInt()
      const st = rt.aga
      if (n < 0 || n > 7 || st.screens[n]! < 0) agaErr(0)
      for (let i = 0; i < 8; i++) {
        const s = st.screens[i]! >= 0 ? rt.screens.get(i) : null
        if (s) s.visible = i === n
      }
      rt.toFront(n)
      st.current = n
    },
    'aga ink'(it) {
      // routine 9 ($13a0): `move.b d0,$0(a2)`. A byte, so 256 is 0 --
      // "If it goes over 255 it will wrap around again"
      rt.aga.rp.fgPen = it.evalInt() & 0xff
    },
    /**
     * Aga Clip n — routine 39 ($1ad2), twelve bytes and a byte store:
     * `move.l (a3)+,d0 / movea.l $228(a5),a2 / move.b d0,$c4(a2)`.
     *
     * DEFECT: it is the LOW BYTE that lands in the flag, so `Aga Clip 256`
     * turns clipping OFF rather than on -- the same truncation Aga Ink has and
     * which the doc owns up to there ("If it goes over 255 it will wrap around
     * again"), but nothing says it here. This port tested the whole value and
     * so disagreed with the library on every multiple of 256.
     */
    'aga clip'(it) {
      rt.aga.clip = (it.evalInt() & 0xff) !== 0
    },
    'aga draw mode'(it) {
      // routine 35 ($19e2) = SetDrMd(rp, n). Jam1 0, Jam2 1, XOR 2, INVV 4
      rt.aga.rp.drawMode = it.evalInt()
    },
    'aga sprite mode'(it) {
      // routine 36 ($19fe): patches $00 / $80 / $c0 into the copper for low,
      // medium and high resolution sprites. Anything else leaves d3 at 0,
      // because the three cmp.w tests simply do not match -- so an out of
      // range value is low res rather than an error
      const n = it.evalInt()
      rt.aga.spriteMode = n === 1 || n === 2 ? n : 0
    },
    /**
     * Aga Cls [ink] — routine 12 ($13e2), which is `SetRast(rp, ink)`. The
     * optional argument is a second token entry at instruction 13; without it
     * the current Aga Ink is used.
     */
    'aga cls'(it) {
      const rp = focus()
      rp.setRast(it.atStmtEnd() ? rp.fgPen : it.evalInt() & 0xff)
    },
    'aga box'(it) {
      // routine 6 ($11dc): Move to (x1,y1) then PolyDraw over four corners --
      // (x1,y2) (x2,y2) (x2,y1) (x1,y1) -- so it is an outline, not a fill
      const x1 = it.evalInt()
      it.expect(',')
      const y1 = it.evalInt()
      it.expect('to')
      const x2 = it.evalInt()
      it.expect(',')
      const y2 = it.evalInt()
      const rp = focus()
      rp.draw(x1, y1, x1, y2)
      rp.draw(x1, y2, x2, y2)
      rp.draw(x2, y2, x2, y1)
      rp.draw(x2, y1, x1, y1)
    },
    'aga bar'(it) {
      // routine 7 ($1236) = RectFill, but only after `cmp.w d0,d2 / ble` and
      // `cmp.w d1,d3 / ble` -- an inverted or degenerate bar is error 3, where
      // AMOS's own Bar would happily swap the corners
      const x1 = it.evalInt()
      it.expect(',')
      const y1 = it.evalInt()
      it.expect('to')
      const x2 = it.evalInt()
      it.expect(',')
      const y2 = it.evalInt()
      if (x2 <= x1 || y2 <= y1) agaErr(3)
      focus().rectFill(x1, y1, x2, y2)
    },
    'aga text'(it) {
      // routine 8 ($127e): TextExtent to measure, TextFit to clip, then the
      // glyphs. The face is whatever Aga Use Font opened, or the system one
      const x = it.evalInt()
      it.expect(',')
      const y = it.evalInt()
      it.expect(',')
      const s = it.evalStr()
      focus().text(x, y, s)
    },
    'aga use font'(it) {
      // routine 54 ($2324): OpenLibrary("diskfont.library") cached at $ba,
      // CloseFont the previous, build a TextAttr at $c5 -- name, ySize, style,
      // flags 0 -- and OpenDiskFont. `adda.l #$2,a0` steps over the AMOS
      // string's length word, so the name is the characters themselves
      const name = it.evalStr()
      it.expect(',')
      const size = it.evalInt()
      it.expect(',')
      const style = it.evalInt()
      void style // "You can't use the style parameter with scalable fonts yet"
      rt.aga.rp.font = openDiskFont((p) => rt.vfs?.read(p) ?? null, name, size)
    },
    'aga get block'(it) {
      // routine 18 ($1434): 0..4000 or error 8. The mask argument is the
      // six-parameter form; "You cannot allocate a mask afterwards"
      const n = it.evalInt()
      it.expect(',')
      const x = it.evalInt()
      it.expect(',')
      const y = it.evalInt()
      it.expect(',')
      const w = it.evalInt()
      it.expect(',')
      const h = it.evalInt()
      let mask = false
      if (it.accept(',')) mask = it.evalInt() !== 0
      if (n < 0 || n > MAX_BLOCK) agaErr(8)
      const rp = focus()
      // the block gets a bitmap of its own, which is what the routine
      // allocates before blitting the rectangle into it
      const bw = Math.max(0, w)
      const bh = Math.max(0, h)
      const bm = new BitMap(bw, bh, rp.depth, rowBytesFor(bw))
      bltBitMap(rp.bitMap, x, y, bm, 0, 0, bw, bh)
      // "If you try to overwrite a block you will lose the memory that the
      // previous block was using" -- the original leaks; a Map just replaces
      rt.aga.blocks.set(n, { bm, mask })
    },
    /**
     * Aga Put Block n,x,y — routine 20 ($1490): x < 320 and y < 256 or error,
     * the block must exist, and a masked block goes through
     * BltMaskBitMapRastPort so colour 0 is transparent.
     */
    'aga put block'(it) {
      const n = it.evalInt()
      it.expect(',')
      const x = it.evalInt()
      it.expect(',')
      const y = it.evalInt()
      if (x >= AGA_W || y >= AGA_H) agaErr(8)
      const b = rt.aga.blocks.get(n)
      if (!b) agaErr(0xa)
      const rp = focus()
      bltBitMap(b.bm, 0, 0, rp.bitMap, x, y, b.bm.width, b.bm.height, b.mask ? 0 : -1)
    },
    /** Aga Del Block n — routine 42 ($1c08): $ffff back from the lookup is error $a */
    'aga del block'(it) {
      const n = it.evalInt()
      if (!rt.aga.blocks.delete(n)) agaErr(0xa)
    },
    /**
     * Aga Screen Copy src To dst — routine 3 ($10e8), which is
     * BltBitMapRastPort. The five-argument form is a second token entry at
     * instruction 4 and copies a clipped sub-rectangle; the whole-screen form
     * hardcodes 320x256, minterm $c0 and mask $ff.
     */
    'aga screen copy'(it) {
      const src = it.evalInt()
      let sx = 0
      let sy = 0
      let w = AGA_W
      let h = AGA_H
      if (it.accept(',')) {
        sx = it.evalInt()
        it.expect(',')
        sy = it.evalInt()
        it.expect(',')
        w = it.evalInt()
        it.expect(',')
        h = it.evalInt()
      }
      it.expect('to')
      const dst = it.evalInt()
      let dx = 0
      let dy = 0
      if (it.accept(',')) {
        dx = it.evalInt()
        it.expect(',')
        dy = it.evalInt()
      }
      const st = rt.aga
      if (src < 0 || src > 7 || st.screens[src]! < 0) agaErr(0)
      if (dst < 0 || dst > 7 || st.screens[dst]! < 0) agaErr(0)
      // "Screencopy and Blocks were known to misbehave if they went off the
      // screen anywhere, sanity checking has been put in to clip these"
      bltBitMap(rt.screens.get(src)!.rp.bitMap, sx, sy, rt.screens.get(dst)!.rp.bitMap, dx, dy, w, h)
    },
    'aga load bitplanes'(it) {
      // routine 29 ($1804): eight CopyMem calls of $2800 bytes each, straight
      // into the planes in order. $2800 is 320/8 * 256, one whole plane. The
      // destination screen is OPENED if it is not already
      const bank = it.evalInt()
      it.expect('to')
      const n = it.evalInt()
      const st = rt.aga
      if (n < 0 || n > 7) agaErr(5)
      if (st.screens[n]! < 0) {
        openAgaScreen(rt, n)
        st.screens[n] = n
        st.current = n
      }
      const src = bankBytes(bank)
      const s = rt.screens.get(n)!
      const bm = s.rp.bitMap
      const dst = bm.planeBytes(true)
      const planeBytes = (AGA_W >> 3) * AGA_H
      for (let p = 0; p < 8; p++) {
        const from = p * planeBytes
        for (let i = 0; i < planeBytes; i++) dst[p * bm.planeSize + i] = src[from + i] ?? 0
      }
      bm.invalidate()
    },
    'aga spack'(it) {
      // the inverse of Aga Unpack's format: 1024 bytes of palette as
      // high/low word pairs, then (count,value) runs that never cross a row.
      // "Due to the limitations of RLE it is quite possible for the packed
      // picture to be larger than the original RAW data!"
      const n = it.evalInt()
      it.expect('to')
      const bank = it.evalInt()
      const st = rt.aga
      if (n < 0 || n > 7 || st.screens[n]! < 0) agaErr(0)
      const s = rt.screens.get(n)!
      const px = s.rp.bitMap.pixels
      const out: number[] = []
      for (let i = 0; i < 256; i++) {
        const hi = s.palette[i] ?? 0
        const lo = rt.copRegs.palLo[i] ?? hi
        out.push((hi >> 8) & 0xff, hi & 0xff, (lo >> 8) & 0xff, lo & 0xff)
      }
      for (let y = 0; y < AGA_H; y++) {
        const row = y * AGA_W
        let x = 0
        while (x < AGA_W) {
          const v = px[row + x]!
          let run = 1
          while (x + run < AGA_W && run < 255 && px[row + x + run] === v) run++
          out.push(run, v)
          x += run
        }
      }
      rt.reserveBank(bank, out.length, 'Aga.Pic')
      rt.memBanks.get(bank)!.data.set(Uint8Array.from(out))
    },
    'aga unpack'(it) {
      // routine 48 ($1fd2). "if the screen isn't opened then one will be
      // opened for you"
      const bank = it.evalInt()
      it.expect('to')
      const n = it.evalInt()
      const st = rt.aga
      if (n < 0 || n > 7) agaErr(5)
      if (st.screens[n]! < 0) {
        openAgaScreen(rt, n)
        st.screens[n] = n
        st.current = n
      }
      const src = bankBytes(bank)
      const s = rt.screens.get(n)!
      const bm = s.rp.bitMap
      // the palette: 256 entries of (high word, low word)
      for (let i = 0; i < 256; i++) {
        const o = i * 4
        s.palette[i] = (((src[o] ?? 0) << 8) | (src[o + 1] ?? 0)) & 0xfff
        rt.copRegs.pal[i] = s.palette[i]!
        rt.copRegs.palLo[i] = (((src[o + 2] ?? 0) << 8) | (src[o + 3] ?? 0)) & 0xfff
      }
      // the runs
      let p = 1024
      let x = 0
      let y = 0
      while (y < AGA_H && p + 1 < src.length) {
        const count = src[p]!
        const value = src[p + 1]!
        p += 2
        // the store precedes the dbra, so a count of 0 still writes one pixel
        const runs = Math.max(1, count)
        for (let k = 0; k < runs; k++) if (x + k < AGA_W) bm.writePixel(x + k, y, value)
        x += count
        if (x >= AGA_W) {
          x = 0
          y++
        }
      }
      bm.invalidate()
    },
    'aga get palette'(it) {
      // routine 5 ($11d8) is FOUR BYTES: `move.l (a3)+,d0 / rts`. It pops its
      // argument and returns. Undocumented, and not the keyword the doc's
      // "AGA Get Palette Bank" entry describes -- that is Aga Get Bank Palette
      it.evalInt()
    },
    'aga get bank palette'(it) {
      // routine 38 ($1a94): ONE argument, not the two the doc's synopsis
      // shows. 256 entries of four bytes each, the first discarded, calling
      // Aga Colour for every one -- so the bank is 0RGB longwords
      const bank = it.evalInt()
      const src = bankBytes(bank)
      for (let i = 0; i < 256; i++) {
        const o = i * 4
        const r = src[o + 1] ?? 0
        const g = src[o + 2] ?? 0
        const b = src[o + 3] ?? 0
        setAgaColour(rt, i, r, g, b)
      }
    },
    'aga colour'(it) {
      // routine 24 ($158a): each 8-bit channel splits into a high nibble word
      // and a low nibble word, poked into the copper four bytes apart at +0
      // and +$420 -- the LOCT pair. n > 255 is skipped SILENTLY, with no error
      const n = it.evalInt()
      it.expect(',')
      const r = it.evalInt()
      it.expect(',')
      const g = it.evalInt()
      it.expect(',')
      const b = it.evalInt()
      if (n > 255) return
      setAgaColour(rt, n, r, g, b)
    },
  }
}

/**
 * Open one AGA screen: 320x256x8, and with AMOS's text cursor turned off.
 *
 * The cursor is the one place where making an AGA screen a real `Screen`
 * shows through. AMOS draws it into the bitplanes (screen.ts: AffCur), so a
 * freshly opened screen is not blank — and the extension's screens have no
 * AMOS console on them at all, because they are not AMOS screens. Turning it
 * off is what keeps the deviation invisible instead of leaving a cursor
 * blinking in the corner of every AGA display.
 */
function openAgaScreen(rt: Runtime, n: number): void {
  const s = rt.openScreen(n, AGA_W, AGA_H, 256, 0)
  s.cursorOn = false
  s.curWin.pen = 0
  s.curWin.paper = 0
  /*
   * AMOS's Screen Open clears to the window's paper, which is colour 1 on a
   * multi-plane screen. The extension allocates its bitplanes and paints
   * nothing into them, so an AGA screen starts genuinely black — a program
   * that opens one and pastes a block onto it must not find paper underneath.
   */
  s.rp.bitMap.planeBytes(true).fill(0)
  s.rp.bitMap.invalidate()
}

/** the shared body of Aga Colour and Aga Get Bank Palette */
function setAgaColour(rt: Runtime, n: number, r: number, g: number, b: number): void {
  const hi = (((r >> 4) & 15) << 8) | (((g >> 4) & 15) << 4) | ((b >> 4) & 15)
  const lo = ((r & 15) << 8) | ((g & 15) << 4) | (b & 15)
  rt.copRegs.pal[n & 0xff] = hi
  rt.copRegs.palLo[n & 0xff] = lo
  const st = rt.aga
  // the screens share one palette, which is why Aga Get Bank Palette has no
  // screen argument: "each screen has to share a common palette"
  for (let i = 0; i < 8; i++) {
    if (st.screens[i]! < 0) continue
    const s = rt.screens.get(i)
    if (s) s.palette[n & 0xff] = hi
  }
}

export function makeAgaFunctions(rt: Runtime): Record<string, Func> {
  return {
    'aga colour'(_, a): Value {
      // the function form ($15dc onward, spec "00"): "Returns a LONGWORD for
      // the colour 'n'. Red = $00FF0000, Blue = $000000FF"
      const n = int(a[0]!) & 0xff
      const hi = rt.copRegs.pal[n] ?? 0
      const lo = rt.copRegs.palLo[n] ?? 0
      const r = (((hi >> 8) & 15) << 4) | ((lo >> 8) & 15)
      const g = (((hi >> 4) & 15) << 4) | ((lo >> 4) & 15)
      const b = ((hi & 15) << 4) | (lo & 15)
      return VI(r * 65536 + g * 256 + b)
    },
    /**
     * =Aga Point(x,y) — routine 55 ($23f6), thirty-four bytes ending in
     * `movea.l -$18ae(a5),a6 / jsr -$13e(a6)`: GfxBase and ReadPixel, against
     * the current screen's RastPort at `$8a(a2)`. The arguments pop in reverse,
     * so d1 is y and d0 is x.
     */
    'aga point'(_, a): Value {
      const x = int(a[0]!)
      const y = int(a[1]!)
      const st = rt.aga
      if (st.current < 0) return VI(0)
      const s = rt.screens.get(st.current)
      if (!s) return VI(0)
      st.rp.bitMap = s.rp.bitMap
      const v = st.rp.point(x, y)
      return VI(v < 0 ? 0 : v)
    },
  }
}
