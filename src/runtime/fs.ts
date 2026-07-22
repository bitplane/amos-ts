/**
 * The virtual filesystem the runtime reads from (Load Iff, Bload, ...).
 * Paths arrive in Amiga form — "AMOSPro_Tutorial:IFF/Window.iff" — with
 * device/assign prefixes and case-insensitive names; implementations
 * resolve them however they like (disk mounts, zip archives, fetch).
 */
export interface AmosFS {
  read(path: string): Uint8Array | null
}

/** An in-memory FS: exact paths plus case-insensitive fallback. */
export class MemoryFS implements AmosFS {
  private files = new Map<string, Uint8Array>()

  add(path: string, bytes: Uint8Array): void {
    this.files.set(path.toLowerCase().replace(/\\/g, '/'), bytes)
  }

  read(path: string): Uint8Array | null {
    return this.files.get(path.toLowerCase().replace(/\\/g, '/')) ?? null
  }
}
