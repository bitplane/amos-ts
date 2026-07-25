import { defineConfig } from 'vitest/config'

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
