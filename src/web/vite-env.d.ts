/**
 * Vite's client types, for the two build-time constants the web entry uses.
 *
 * tsconfig sets `"types": ["node"]`, which excludes vite/client, so
 * `import.meta.env` is otherwise untyped. Declared narrowly here rather than by
 * widening the global types list, so the rest of the tree keeps seeing only the
 * Node types it actually wants.
 */
interface ImportMetaEnv {
  /** true under `vite dev`, false in any production build */
  readonly DEV: boolean
  readonly PROD: boolean
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
