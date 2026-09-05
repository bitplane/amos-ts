/** Workbench's default double-click interval when Preferences are unavailable. */
export const DEFAULT_DOUBLE_CLICK_MICROS = 500_000

/**
 * intuition.library DoubleClick(s1,m1,s2,m2): whether the second timestamp is
 * at or after the first and no further away than the preference interval.
 */
export function doubleClick(
  firstSeconds: number,
  firstMicros: number,
  secondSeconds: number,
  secondMicros: number,
  intervalMicros = DEFAULT_DOUBLE_CLICK_MICROS,
): boolean {
  const elapsed = (secondSeconds - firstSeconds) * 1_000_000 + secondMicros - firstMicros
  return elapsed >= 0 && elapsed <= intervalMicros
}
