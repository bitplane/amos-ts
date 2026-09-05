/** Machine identity and Intuition time operations read by OS DevKit `_sys`. */

export const EXEC_VERSION = 40
/** ExecBase.SoftVer at offset $22; `_sys revision` does not read lib_Revision. */
export const EXEC_SOFT_VERSION = 0
// AFB_68010 is explicitly also set for a 68020, so the capability bits are cumulative.
export const A1200_ATTN_FLAGS = (1 << 0) | (1 << 1)

const UNIX_TO_AMIGA_SECONDS = 2922 * 24 * 60 * 60

export interface SystemTime {
  seconds: number
  micros: number
}

/** Intuition CurrentTime, whose epoch is 1 January 1978. */
export function currentSystemTime(unixMilliseconds = Date.now()): SystemTime {
  const wholeMilliseconds = Math.floor(unixMilliseconds)
  const unixSeconds = Math.floor(wholeMilliseconds / 1000)
  return {
    seconds: (unixSeconds - UNIX_TO_AMIGA_SECONDS) >>> 0,
    micros: (((wholeMilliseconds % 1000) + 1000) % 1000) * 1000,
  }
}

/** Routine 1753: add ten for each of AttnFlags bits 0..3. */
export function systemCpu(attnFlags: number): number {
  let result = 0
  for (let bit = 0; bit < 4; bit++) if ((attnFlags & (1 << bit)) !== 0) result += 10
  return result
}

/** Routine 1754, including its unusual bit-clears when AFB_68040 is set. */
export function systemFpu(attnFlags: number): number {
  let result = 0
  if ((attnFlags & (1 << 4)) !== 0) result += 0x51
  if ((attnFlags & (1 << 5)) !== 0) result += 1
  if ((attnFlags & (1 << 6)) !== 0) {
    result &= ~(1 << 4)
    result &= ~(1 << 6)
    result += 40
  }
  return result
}
