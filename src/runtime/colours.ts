/**
 * AMOSPro Colours 1.0 — Jan Normann Nielsen's named colour constants.
 *
 * Twenty-seven functions that take no arguments and return a number. There is
 * no state, no hardware and nothing to get wrong except the numbers, and the
 * numbers are in the source.
 *
 * ## Evidence
 *
 * SOURCE tier, and complete: `AMOSPro_Colours.Lib.s` ships with the library,
 * 344 lines, "This file is public domain". Every constant below is its `equ`
 * (:24-50) and every routine is the same three instructions:
 *
 *     L2  move.l  #RED,d3
 *         moveq   #0,d2
 *         rts
 *
 * `d3` is the value and `d2` is AMOS's type word, cleared to say "integer" —
 * so there is no float or string form, and no error path in the whole library.
 *
 * The slot is the extension's own: `ExtNb equ 23-1` (:21) and `L0 moveq
 * #ExtNb,d0 / rts` (:131), which is routine 0 answering with its zero-based
 * extension number, exactly as MED 7.1's does. The registry had slot 23 from
 * Andrew Burton's extensions list; the source agrees with it.
 *
 * ## The values are 12-bit $RGB
 *
 * `$F00`, `$0F0`, `$00F` — one nibble a channel, which is a COLORxx register
 * and therefore what `Colour n,v` takes. `Colour 1,Red` is the intended use
 * and works without conversion. They are NOT palette indices.
 *
 * ## Two things worth knowing before typing one
 *
 * NOTE: the keyword is `C Orange`, not `Orange`. The token is
 * `dc.b "c orang","e"+$80` (:95) and it is the only prefixed name in the
 * table — every other one is the bare colour. The source gives no reason and
 * there is no `Orange` anywhere else in AMOS for it to have avoided, so the
 * prefix is recorded rather than explained.
 *
 * NOTE: there is no `Orange`, `Dark Orange` or `Light Orange` either — the
 * dark/light pairs cover the other nine colours and orange has just the one
 * entry. Nothing is missing from this port; the library is that shape.
 *
 * The last two routines, `L_Custom` (:326) and the one after it, are the
 * extension's "with messages" and "no errors" hooks. Both are a bare `rts`,
 * so there is nothing for `init` or `defaults` to do here.
 */
import { VI } from '../interp/values'
import type { Value } from '../interp/values'
import type { Func } from '../interp/builtins'

/**
 * The twenty-seven `equ`s of `AMOSPro_Colours.Lib.s:24-50`, in the order the
 * token table lists them.
 *
 * Transcribed rather than derived. The set looks systematic — each colour at
 * full, half and brightened — but it is not quite: green is already `$F` at
 * full, so `Light Green` is `$2F2` rather than a brighter green, and the three
 * browns vary only in red (`$420`, `$820`, `$A20`). Computing them from a rule
 * would get several wrong.
 */
export const COLOURS: Readonly<Record<string, number>> = {
  red: 0xf00,
  green: 0x0f0,
  blue: 0x00f,
  black: 0x000,
  yellow: 0xff0,
  magenta: 0xf0f,
  cyan: 0x0ff,
  white: 0xfff,
  grey: 0x888,
  brown: 0x820,
  'c orange': 0xa40,
  'dark red': 0x800,
  'dark green': 0x080,
  'dark blue': 0x008,
  'dark yellow': 0x880,
  'dark magenta': 0x808,
  'dark cyan': 0x088,
  'dark grey': 0x333,
  'dark brown': 0x420,
  'light red': 0xf44,
  'light green': 0x2f2,
  'light blue': 0x03f,
  'light yellow': 0xff3,
  'light magenta': 0xf3f,
  'light cyan': 0x3ff,
  'light grey': 0xbbb,
  'light brown': 0xa20,
}

export function makeColoursFunctions(): Record<string, Func> {
  const out: Record<string, Func> = {}
  for (const [name, value] of Object.entries(COLOURS)) out[name] = (): Value => VI(value)
  return out
}
