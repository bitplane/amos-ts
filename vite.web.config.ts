import { defineConfig } from 'vite'

/**
 * The deployable site, as published to amos.bitplane.net.
 *
 * `vite.config.ts` is a *library* build (src/index.ts -> dist/amos-ts.js) for
 * consumers importing the runtime. This one is the app build: the standalone
 * player, emitted to dist-web/.
 *
 * `base: './'` matters more than it looks. The same build is published to
 * three places — the site root, /v/<x.y.z>/ and /v/latest/ — so every asset
 * reference has to be relative to the page rather than to the server root.
 * With the default absolute base, a copy under /v/0.3.0/ would ask for
 * /assets/... and get the root build's files, which is the sort of bug that
 * only shows up after a version has been pinned for a month.
 */
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist-web',
    emptyOutDir: true,
    target: 'es2022',
    // No sourcemap in the published site. It is 2.9 MB against the bundle's
    // 827 kB, and every version is kept forever under /v/, so shipping it
    // would grow the site repo four times faster for something almost nobody
    // fetches. Each release is reproducible from its tag — check out v0.3.0
    // and `npm run build:web` with sourcemap on to debug that exact build.
    sourcemap: false,
    // One 827 kB chunk is the whole interpreter and runtime with no
    // dependencies behind it, and a single file is the easiest thing to
    // embed. Splitting it would trade that for parallel fetches we do not
    // need, so the warning is turned off rather than worked around.
    chunkSizeWarningLimit: 1024,
    rollupOptions: {
      output: {
        // No content hash in the filename. Hashing exists to bust caches
        // when a URL's contents change, and here they never do: every
        // version lives at its own immutable path, so the path IS the cache
        // key. Hashing on top of that would only mean /v/latest/ collecting
        // a new orphaned bundle on every release, and it would deny anyone
        // embedding the player a URL they can predict and write down.
        entryFileNames: 'assets/amos-player.js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
})
