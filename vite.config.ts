import { defineConfig } from 'vitest/config'

/**
 * The npm library build: src/index.ts -> dist/amos-ts.js.
 *
 * narrator-ts is BUNDLED here rather than left external, which is the
 * opposite of what a library normally wants — so it is a devDependency, not
 * a dependency, and consumers get exactly one copy.
 *
 * The reason is `Say`'s dynamic imports of narrator-ts's two JSON tables.
 * Left external, the bundler drops the `with { type: 'json' }` attribute and
 * Node refuses the import with ERR_IMPORT_ATTRIBUTE_MISSING, so `Say` fails
 * to load the voice and goes permanently silent. (Forcing `target: 'esnext'`
 * keeps an attribute but emits the withdrawn `assert` spelling, which Node
 * 22+ rejects too.) Bundled, vite turns the JSON into ordinary JS chunks and
 * the question does not arise — verified by installing the tarball into a
 * clean project and speaking.
 *
 * Code-splitting still applies, so the 45K voice table stays out of the main
 * chunk and is only fetched by a program that actually speaks.
 *
 * The fix that would let this go external is upstream: narrator-ts shipping
 * JS wrappers beside reference/*.json. Until then, bundling is what works.
 */
export default defineConfig({
  build: {
    lib: {
      entry: 'src/index.ts',
      name: 'amosTs',
      fileName: 'amos-ts',
      formats: ['es'],
    },
    sourcemap: true,
  },
  test: {
    include: ['src/**/*.test.ts'],
    // records which keywords the suite actually dispatches, so the
    // faithfulness gate can enforce that every FAITHFUL one is exercised
    setupFiles: ['src/coverage/probe.setup.ts'],
    globalSetup: ['src/coverage/gate.ts'],
  },
})
