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
  },
})
