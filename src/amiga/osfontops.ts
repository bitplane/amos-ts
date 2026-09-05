import type { DiskFont } from './diskfont'

/** The RastPort fields touched by graphics.library's font/style trio. */
export interface FontRastPort {
  font: DiskFont | null
  algoStyle: number
}

/** SetFont changes only rp_Font. */
export function setFont(rastPort: FontRastPort | null, font: DiskFont | null): void {
  if (rastPort && font) rastPort.font = font
}

/** AskSoftStyle returns the RastPort's current algorithmic style byte. */
export const askSoftStyle = (rastPort: FontRastPort | null): number => rastPort ? rastPort.algoStyle & 0xff : 0

/** SetSoftStyle replaces only the enabled bits and returns the resulting byte. */
export function setSoftStyle(rastPort: FontRastPort | null, style: number, enable: number): number {
  if (!rastPort) return 0
  rastPort.algoStyle = ((rastPort.algoStyle & ~enable) | (style & enable)) & 0xff
  return rastPort.algoStyle
}
