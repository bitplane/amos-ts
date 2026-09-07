/** Process-wide amigaguide.library client lifecycle. */

export interface AmigaGuideLaunch {
  handle: number
  name: string
  screen: number
  baseName: string
  context: number
}

/**
 * OpenAmigaGuideA returns an opaque client handle. Presentation belongs to a
 * host viewer, but retaining the launch and handle lifetime keeps extensions
 * on one library boundary instead of inventing private help systems.
 */
export class AmigaGuide {
  private nextHandle = 0x7900_0000
  readonly active = new Map<number, AmigaGuideLaunch>()
  lastLaunch: AmigaGuideLaunch | null = null

  open(name: string, screen: number, baseName = '', context = 0): number {
    if (name === '') return 0
    const handle = this.nextHandle
    this.nextHandle += 0x100
    const launch = { handle, name, screen: screen >>> 0, baseName, context: context >>> 0 }
    this.active.set(handle, launch)
    this.lastLaunch = launch
    return handle
  }

  close(handle: number): boolean {
    return this.active.delete(handle >>> 0)
  }
}
