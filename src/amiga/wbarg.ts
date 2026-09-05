/** A Workbench startup argument: BPTR lock followed by APTR name. */
export interface WbArg {
  lock: number
  name: number
}

/** OS DevKit routines 1866/1867: guarded, one-based WBArg field access. */
export function wbArgName(args: readonly WbArg[] | null, count: number, index: number): number {
  if (index < 1 || args === null || index > count) return 0
  return args[index - 1]?.name ?? 0
}

export function wbArgLock(args: readonly WbArg[] | null, count: number, index: number): number {
  if (index < 1 || args === null || index > count) return 0
  return args[index - 1]?.lock ?? 0
}
