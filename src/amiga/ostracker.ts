/** OS DevKit's private 32-class pointer/resource tracker (workers 1883-1886). */
export class OsResourceTracker {
  private readonly classes = Array.from({ length: 32 }, () => [] as number[])

  private valid(type: number, pointer: number): boolean {
    return type >= 0 && type < 32 && pointer !== 0
  }

  /** `track exist`: the one-based slot, or zero. */
  find(type: number, pointer: number): number {
    if (!this.valid(type, pointer)) return 0
    const at = this.classes[type]!.indexOf(pointer >>> 0)
    return at < 0 ? 0 : at + 1
  }

  /** `track add`: append even when the caller did not perform Set's guard. */
  add(type: number, pointer: number): void {
    if (this.valid(type, pointer)) this.classes[type]!.push(pointer >>> 0)
  }

  /** `track set`: add only when that type does not already hold the pointer. */
  set(type: number, pointer: number): void {
    if (this.find(type, pointer) === 0) this.add(type, pointer)
  }

  /** `track unset`: remove the matching slot and close the gap. */
  unset(type: number, pointer: number): void {
    const at = this.find(type, pointer)
    if (at !== 0) this.classes[type]!.splice(at - 1, 1)
  }

  entries(type: number): readonly number[] {
    return type >= 0 && type < 32 ? this.classes[type]! : []
  }
}
