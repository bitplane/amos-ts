import { defineConfig } from 'vitest/config'

/**
 * The npm library build: src/index.ts -> dist/amos-ts.js.
 *
 * narrator-ts is BUNDLED, deliberately, and is a devDependency rather than a
 * dependency so nothing installs it twice. Do not "fix" this by making it
 * external.
 *
 * Self-contained is the product, not a compromise. What ships is meant to be
 * one thing you drop in and link — see vite.lib.config.ts, where the same
 * decision is load-bearing enough that the player inlines its chunks too.
 * The usual argument for externalizing a dependency (the consumer dedupes it
 * against their own copy, and can swap the voice) assumes a wider ecosystem
 * with two narrators in it, which is not what this targets. Anyone who does
 * want a different voice can build their own.
 *
 * It also happens not to work. Left external, the bundler drops the
 * `with { type: 'json' }` attribute from Say's dynamic imports and Node
 * refuses them with ERR_IMPORT_ATTRIBUTE_MISSING — which does not throw, it
 * just leaves the voice unloaded and Say permanently silent. Forcing
 * `target: 'esnext'` keeps an attribute but emits the withdrawn `assert`
 * spelling, which Node 22+ rejects too. That is a second reason, not the
 * reason; fixing it upstream would not change the decision above.
 *
 * Code-splitting still applies here, so the 45K voice table stays out of the
 * main chunk — a bundler consuming this package can drop it from builds that
 * never speak. CI packs this, installs it into an empty project and speaks,
 * because the failure mode is silent.
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
