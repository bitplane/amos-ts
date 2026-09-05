/** Small stateful half of utility.library. */
export class UniqueIdSource {
  private next = 1

  /** `GetUniqueID` (-270): non-zero and unique for this source's lifetime. */
  get(): number {
    const id = this.next >>> 0
    this.next = (this.next + 1) >>> 0
    if (this.next === 0) this.next = 1
    return id
  }
}
