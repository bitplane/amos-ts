/**
 * CText 1.32 — icon-bank proportional text, by Aaron Fothergill (Shadow
 * Software), Deja Vu licenseware.
 *
 * Six keywords, read out of CTEXT.Lib with `extdis ctext-1.0`. The library is
 * 1,816 bytes of code in twelve routines, so every one of them is quoted below
 * at the address it lives at.
 *
 * The idea: a font is an ordinary AMOS ICON BANK plus a 768-byte side table.
 * Its own documentation (CText.FONTS/Please_Read_Me! on the AMOS PD CD) sells
 * exactly that — "easy to use icon based text displays ... Use fonts of up to
 * 64 colours ... Use any size of character ... Easily edit fonts (can be edited
 * in SpriteX) ... Use masked fonts ... Use propotional text ... Use Kerning".
 *
 * ## The data block
 *
 * Every routine starts `movea.l $168(a5),a0` — CText's private block. The
 * offsets each routine touches give the layout, and the last three are what the
 * 768-byte `.Cfnt` file loads into:
 *
 *   +$0a  long  fixed character width;  0 means "use the per-character table"
 *   +$0e  long  fixed character height; 0 means "use the per-character table"
 *   +$12  long  pending kern, added to the pen after the next character
 *   +$16  long  escape-pending flag
 *   +$1a        the Kern$ return string: word length 2, then ESC and '0'+n
 *   +$1e  256   character -> icon number       (.Cfnt bytes 0..255)
 *   +$11e 256   character -> advance width     (.Cfnt bytes 256..511)
 *   +$21e 256   character -> Y offset          (.Cfnt bytes 512..767)
 *
 * That the three tables are 256 bytes each is not inferred from the code alone:
 * all 254 `.Cfnt` files on the AMOS PD CD are exactly 768 bytes, and dumping
 * one shows table 0 mapping '!'..'z' to icons 1..96, table 1 holding widths
 * 3..13, and table 2 holding Y offsets where ',' is 2 and '-' is 1 — a comma
 * sits low and a hyphen high. Byte-exact artifacts agreeing with a disassembly
 * is the strongest evidence this extension can offer, since no manual survives.
 *
 * Programs reach the tables by address: the corpus writes
 * `Bload Dir$+"FONTS/TRANS_DOUB_FNT.ABK.CFNT",Font Data`, so `Font Data` has to
 * return something `Bload` can write through. The block is therefore mapped
 * into the fake address space (Runtime.EXT_DATA_BASE) rather than kept as
 * private fields.
 */
import type { Runtime } from './runtime'
import type { Func, Instr } from '../interp/builtins'
import { VI, VS, int, str, type Value } from '../interp/values'

/** offsets within the block, named as the disassembly uses them */
export const CT = {
  FIXED_W: 0x0a,
  FIXED_H: 0x0e,
  KERN_PENDING: 0x12,
  ESC_PENDING: 0x16,
  KERN_STR: 0x1a,
  /** the three 256-byte tables — `Font Data` points here */
  TABLES: 0x1e,
  ICON: 0x1e,
  WIDTH: 0x11e,
  YOFF: 0x21e,
  SIZE: 0x31e,
} as const

/** the escape byte Ctext and Plen both watch for (`cmpi.l #$1b,d0` at $5a4) */
const ESC = 0x1b

export interface CtextState {
  block: Uint8Array
}

export function newCtextState(): CtextState {
  const block = new Uint8Array(CT.SIZE)
  // Kern$ hands back a two-character string whose first byte is always ESC;
  // the length word and that byte never change, only the digit does ($6ca)
  block[CT.KERN_STR] = 0
  block[CT.KERN_STR + 1] = 2
  block[CT.KERN_STR + 2] = ESC
  return { block }
}

const rd32 = (b: Uint8Array, off: number): number =>
  ((b[off]! << 24) | (b[off + 1]! << 16) | (b[off + 2]! << 8) | b[off + 3]!) >>> 0

const wr32 = (b: Uint8Array, off: number, v: number): void => {
  b[off] = (v >>> 24) & 0xff
  b[off + 1] = (v >>> 16) & 0xff
  b[off + 2] = (v >>> 8) & 0xff
  b[off + 3] = v & 0xff
}

/**
 * The character walk Ctext ($570) and Plen ($4d6) share.
 *
 * Both clear the escape flag and the pending kern, then step the string one
 * byte at a time. `draw` is called for a character that maps to an icon; Plen
 * passes nothing and only wants the width. The pen advance is identical in
 * both, which is what makes Plen agree with what Ctext will actually draw.
 */
function walk(
  block: Uint8Array,
  text: string,
  x0: number,
  y0: number,
  draw?: (icon: number, x: number, y: number) => void,
): number {
  wr32(block, CT.ESC_PENDING, 0)
  wr32(block, CT.KERN_PENDING, 0)
  let x = x0
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i) & 0xff
    // ESC sets the flag and draws nothing ($5a4 -> $628)
    if (ch === ESC) {
      wr32(block, CT.ESC_PENDING, 1)
      x += rd32(block, CT.KERN_PENDING)
      wr32(block, CT.KERN_PENDING, 0)
      continue
    }
    // the byte after ESC is the kern amount, as '0'+n ($658: subi.l #$30,d0)
    if (rd32(block, CT.ESC_PENDING) !== 0) {
      wr32(block, CT.KERN_PENDING, (ch - 0x30) | 0)
      wr32(block, CT.ESC_PENDING, 0)
      x += rd32(block, CT.KERN_PENDING)
      wr32(block, CT.KERN_PENDING, 0)
      continue
    }
    const icon = block[CT.ICON + ch]!
    // `cmp.l #$0,d1 : ble` — an unmapped character advances but draws nothing
    if (icon > 0 && draw) {
      const fixedH = rd32(block, CT.FIXED_H)
      const y = y0 - (fixedH !== 0 ? fixedH : block[CT.YOFF + ch]!)
      draw(icon, x, y)
    }
    const fixedW = rd32(block, CT.FIXED_W)
    x += fixedW !== 0 ? fixedW : block[CT.WIDTH + ch]!
    x += rd32(block, CT.KERN_PENDING)
    wr32(block, CT.KERN_PENDING, 0)
  }
  return x
}

export function makeCtextInstructions(rt: Runtime): Record<string, Instr> {
  const pair = (it: Parameters<Instr>[0]): [number, number] => {
    const a = it.evalInt()
    it.expect(',')
    const b = it.evalInt()
    return [a, b]
  }
  return {
    'ctext'(it) {
      // Ctext x,y,text$ — routine 7 ($570). Args pop off a3 in reverse, so the
      // string is read first, then y, then x.
      const [x, y] = pair(it)
      it.expect(',')
      const text = it.evalStr()
      const s = rt.screen
      walk(rt.ctext.block, text, x, y, (icon, ix, iy) => {
        // the draw is AMOS's own icon paste: the icon-bank entry in a2, the
        // screen in a1, and a $ff plane mask in d5 ($5f0-$5fc). Paste Icon is
        // the keyword that reaches the same routine, so it is reused here.
        const img = rt.iconBank?.image(icon)
        if (img) rt.blit(s, img, ix, iy, true)
      })
    },
    'font size'(it) {
      // Font Size w,h — routine 5 ($4c4), five instructions: the two longs
      // land at +$a and +$e. Zero in either restores the per-character table,
      // which is how a program switches between fixed and proportional.
      const [w, h] = pair(it)
      wr32(rt.ctext.block, CT.FIXED_W, w | 0)
      wr32(rt.ctext.block, CT.FIXED_H, h | 0)
    },
  }
}

export function makeCtextFunctions(rt: Runtime): Record<string, Func> {
  return {
    'plen'(_, a): Value {
      // =Plen(text$) — routine 6 ($4d6). The same walk as Ctext with nothing
      // drawn, so the two cannot disagree about what a string measures.
      return VI(walk(rt.ctext.block, str(a[0]!), 0, 0))
    },
    'font base'(): Value {
      // =Font Base — routine 8 ($67e): three instructions handing back the
      // block address itself, so a program can poke the scalars directly.
      return VI(rt.ctextBase())
    },
    'font data'(): Value {
      // =Font Data — routine 9 ($688): the block address plus $1e, i.e. the
      // first of the three tables. This is the Bload target the corpus uses.
      return VI((rt.ctextBase() + CT.TABLES) >>> 0)
    },
    'kern$'(_, a): Value {
      // =Kern$(n) — routine 11 ($6ca). Writes '0'+n into the second byte of a
      // fixed two-character string and returns it: ESC then the digit. So
      // kerning travels INSIDE the text, which is why Ctext and Plen both
      // watch for $1b rather than taking a kern argument.
      const n = int(a[0]!)
      rt.ctext.block[CT.KERN_STR + 3] = (0x30 + n) & 0xff
      return VS(String.fromCharCode(ESC, (0x30 + n) & 0xff))
    },
  }
}
