import { defineConfig } from 'vite'

/**
 * The embeddable player, as a library.
 *
 * Published beside the standalone page (vite.web.config.ts) into the same
 * dist-web, so one deploy carries both: a page you can open, and a module a
 * host imports. `emptyOutDir: false` because this build runs second and must
 * not delete the page.
 *
 * The filename is fixed and unhashed for the same reason as the page's: the
 * version lives in the path, so /v/0.3.0/assets/amos-player.js is stable,
 * cacheable forever and something a person can write down.
 */
export default defineConfig({
  build: {
    outDir: 'dist-web',
    emptyOutDir: false,
    target: 'es2022',
    sourcemap: false,
    minify: 'esbuild',
    // Not vite's `lib` mode: that leaves the output pretty-printed (only
    // rollup's own deconfliction renames anything), which costs a quarter of
    // the transfer for a file every embedder fetches. A normal build with
    // preserveEntrySignatures keeps the exports and minifies like the page.
    rollupOptions: {
      input: 'src/web/player.ts',
      preserveEntrySignatures: 'strict',
      output: {
        format: 'es',
        entryFileNames: 'assets/amos-player.js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
})
