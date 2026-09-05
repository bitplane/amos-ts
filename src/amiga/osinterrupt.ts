import { ExecListHeap } from './oslist'

export const NT_INTERRUPT = 2

/** Native 22-byte Exec Interrupt records and per-vector server chains. */
export class ExecInterruptSystem {
  readonly memory: ExecListHeap
  private readonly vectors = new Map<number, number[]>()

  constructor(memory = new ExecListHeap()) {
    this.memory = memory
  }

  alloc(): number {
    const interrupt = this.memory.allocNode(8)
    this.memory.setNodeType(interrupt, NT_INTERRUPT)
    return interrupt
  }

  free(interrupt: number): void {
    if (interrupt === 0) return
    for (const chain of this.vectors.values()) {
      const at = chain.indexOf(interrupt)
      if (at >= 0) chain.splice(at, 1)
    }
    this.memory.free(interrupt)
  }

  /** OS DevKit `_int set`: is_Data at +$e and is_Code at +$12. */
  set(interrupt: number, data: number, code: number): void {
    if (interrupt === 0) return
    this.memory.writeU32(interrupt + 14, data)
    this.memory.writeU32(interrupt + 18, code)
  }

  data(interrupt: number): number { return this.memory.readU32(interrupt + 14) }
  code(interrupt: number): number { return this.memory.readU32(interrupt + 18) }

  /** AddIntServer, descending signed node priority and stable for ties. */
  add(vector: number, interrupt: number): void {
    if (interrupt === 0) return
    const chain = this.vectors.get(vector | 0) ?? []
    const priority = this.memory.nodePriority(interrupt)
    const at = chain.findIndex((entry) => this.memory.nodePriority(entry) < priority)
    chain.splice(at < 0 ? chain.length : at, 0, interrupt)
    this.vectors.set(vector | 0, chain)
  }

  rem(vector: number, interrupt: number): void {
    if (interrupt === 0) return
    const chain = this.vectors.get(vector | 0)
    if (!chain) return
    const at = chain.indexOf(interrupt)
    if (at >= 0) chain.splice(at, 1)
  }

  servers(vector: number): readonly number[] {
    return this.vectors.get(vector | 0) ?? []
  }
}
