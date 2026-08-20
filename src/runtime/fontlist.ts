/**
 * The font list `Get Fonts` walks and the ASL font requester shows.
 *
 * Extracted from ./instr.ts when the requester needed it too. It is the same
 * list either way --- `AvailFonts` does not know which of AMOS's Get Fonts
 * variants asked --- and having one copy is the point: two scans of `Fonts:`
 * that could disagree about a face is exactly the bug this avoids.
 */
import { parseFontDescriptor } from '../amiga/diskfont'
import type { Runtime } from './runtime'

/** one entry of the list, which is what `AvailFonts` fills a buffer with */
export interface FontEntry {
  name: string
  height: number
  type: string
  file?: string
  dir?: string
}

/** the ROM font list (Get Fonts / Font$) — the port carries Topaz only */
// the ROM faces plus the stock Workbench Fonts: drawer, so Set Font
// numbers that work on a real machine work here (rendering stays the
// single 8x8 face — see NOTES). examinedFonts() applies the Get Fonts
// variant's rom/disc mask.
export const FONT_LIST: FontEntry[] = [
  { name: 'topaz.font', height: 8, type: 'Rom' },
  { name: 'topaz.font', height: 9, type: 'Rom' },
  ...[
    ['courier.font', [11, 13, 15, 18, 24]],
    ['diamond.font', [12, 20]],
    ['emerald.font', [17, 20]],
    ['garnet.font', [9, 16]],
    ['helvetica.font', [9, 11, 13, 15, 18, 24]],
    ['opal.font', [9, 12]],
    ['pearl.font', [8]],
    ['ruby.font', [8, 12, 15]],
    ['sapphire.font', [14, 19]],
    ['times.font', [11, 13, 15, 18, 24]],
  ].flatMap(([name, sizes]) => (sizes as number[]).map((height) => ({ name: name as string, height, type: 'Disc' }))),
]


/** Disc fonts come from the real Fonts: drawer when one is mounted
 * (AvailFonts scans FONTS:); the synthetic Workbench list stands in when
 * there is none, so stock Set Font numbers still resolve. */
export function discFontList(rt: Runtime): FontEntry[] {
  if (rt.discFontCache) return rt.discFontCache
  const out: FontEntry[] = []
  const entries = rt.vfs?.listDir('Fonts:')
  for (const e of entries ?? []) {
    if (e.isDir || !/\.font$/i.test(e.name)) continue
    const bytes = rt.vfs!.read('Fonts:' + e.name)
    const desc = bytes ? parseFontDescriptor(bytes) : null
    if (!desc) continue // corrupt descriptors are skipped, not fatal
    for (const d of desc) out.push({ name: e.name, height: d.ySize, type: 'Disc', file: d.file })
  }
  rt.discFontCache = out.length > 0 ? out : FONT_LIST.filter((f) => f.type === 'Disc')
  return rt.discFontCache
}

export function examinedFonts(rt: Runtime): FontEntry[] {
  const mask = rt.fontsListed
  // AFF_MEMORY is the system font list, so a face Ldisk Font opened is in it
  const rom = mask & 1 ? [...FONT_LIST.filter((f) => f.type === 'Rom'), ...rt.memoryFonts] : []
  const disc = mask & 2 ? discFontList(rt) : []
  return [...rom, ...disc]
}

/**
 * EVERY face the machine has, which is what a requester lists.
 *
 * `examinedFonts` applies `Get Fonts`' own rom/disc mask, because that is
 * what the keyword asking it means. asl.library has no such mask: it lists
 * what AvailFonts finds and lets the user pick, so this is that list without
 * the mask in front of it.
 */
export function availFonts(rt: Runtime): FontEntry[] {
  return [...FONT_LIST.filter((f) => f.type === 'Rom'), ...rt.memoryFonts, ...discFontList(rt)]
}
