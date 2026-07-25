import type { Tok } from '../tokens/stream'
import { TokenTable } from '../tokens/stream'

/**
 * Resolves core/extension tokens to their dispatch name: trimmed, lowercase,
 * variant entries resolved to the named instruction ("mid$", "end if", ":").
 */
export class Names {
  private core = new Map<number, string | undefined>()

  constructor(
    readonly table: TokenTable,
    readonly extensions: Map<number, TokenTable> = new Map(),
  ) {}

  coreName(id: number): string | undefined {
    if (!this.core.has(id)) {
      const n = this.table.name(id)
      this.core.set(id, n === undefined ? undefined : n.trim().toLowerCase())
    }
    return this.core.get(id)
  }

  /** Dispatch name of a core or extension token; undefined for other kinds. */
  of(tok: Tok): string | undefined {
    if (tok.kind === 'core') return this.coreName(tok.id)
    if (tok.kind === 'ext') {
      const t = this.extensions.get(tok.ext)
      const n = t?.name(tok.id)
      return n === undefined ? `ext${tok.ext}:$${tok.id.toString(16)}` : n.trim().toLowerCase()
    }
    return undefined
  }

  /**
   * The token's spec string (parameter/return type codes). The first code
   * is the return type: 0=int, 1=float, 2=string. Used to give an
   * unimplemented extension FUNCTION a type-correct default so a program
   * that assigns it (A$=Ldate(...)) doesn't hit a Type mismatch.
   */
  specOf(tok: Tok): string | undefined {
    if (tok.kind === 'core') return this.table.get(tok.id)?.spec
    if (tok.kind === 'ext') return this.extensions.get(tok.ext)?.get(tok.id)?.spec
    return undefined
  }
}
