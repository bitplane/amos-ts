import { defineConfig, type Plugin } from 'vitest/config'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { join, normalize, resolve } from 'node:path'
import { indexLibrary } from './src/cli/genlibrary'

/**
 * Serve bitplane/amos-library at /library/ under `npm run dev`.
 *
 * On the site those files are pushed by the library repository's own job and
 * this plugin has no part in it. Locally there is no such job, so the Browse
 * tab would have nothing to fetch and could only ever be tested by
 * deploying, which is how you find out from production that the covers
 * 404. The index is built per request rather than cached, so adding a
 * disk to the checkout and reloading the page shows it.
 *
 * AMOS_LIBRARY names the checkout; ../amos-library is where it sits beside
 * this one. With neither there the plugin stands down, and the tab says it
 * found no library at the URL, which is the truth.
 */
function libraryDevServer(): Plugin {
  const root = resolve(process.env.AMOS_LIBRARY ?? '../amos-library')
  const TYPES: Record<string, string> = {
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.webp': 'image/webp',
    '.adf': 'application/octet-stream',
    '.zip': 'application/zip',
  }
  return {
    name: 'amos-library-dev',
    configureServer(server) {
      if (!existsSync(root)) {
        server.config.logger.info(`amos-library: nothing at ${root}, the Browse tab will be empty`)
        return
      }
      server.config.logger.info(`amos-library: serving ${root} at /library/`)
      server.middlewares.use('/library', (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/').replace(/^\/+/, '')
        if (rel === 'index.json') {
          const { library, warnings } = indexLibrary(root)
          for (const w of warnings) server.config.logger.warn(`amos-library: ${w.path}: ${w.message}`)
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify(library))
          return
        }
        // a dev server on localhost, but a path out of the library root is
        // still a path out of the library root
        const path = join(root, normalize(rel))
        if (!path.startsWith(root) || !existsSync(path) || !statSync(path).isFile()) {
          next()
          return
        }
        const ext = /\.[^.]*$/.exec(path)?.[0]?.toLowerCase() ?? ''
        res.setHeader('content-type', TYPES[ext] ?? 'application/octet-stream')
        res.setHeader('content-length', String(statSync(path).size))
        createReadStream(path).pipe(res)
      })
    },
  }
}

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
  plugins: [libraryDevServer()],
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

    /**
     * Capped because the suite was getting things OOM-killed.
     *
     * One worker per core is the default and it costs more memory than a
     * development machine has spare. Measured on 16 cores, full suite, peak
     * resident across every vitest process:
     *
     *     16 workers   4.7 GB   33s
     *      8 workers   3.4 GB   39s
     *      6 workers   2.7 GB   35s
     *      4 workers   2.2 GB   45s
     *
     * The default is about 10% faster and costs 2 GB more, which is the wrong
     * trade on a 14.7 GB box that is also running a browser and an editor.
     * The kernel OOM killer fired twice in one day here, once on an editor
     * process, and a run that survives it has still been swapping.
     *
     * Six rather than eight because the headroom is the point, not the three
     * seconds. CI is unaffected: that runner has four cores, so it never
     * reaches this cap.
     */
    maxWorkers: 6,

    /**
     * Raised because the default catches nothing here and fails honest tests.
     *
     * 4,902 of this suite's 4,922 test bodies are SYNCHRONOUS, and vitest
     * cannot interrupt a synchronous body. It runs to completion and is marked
     * failed afterwards: given a 50 ms budget, one still recorded its full
     * 391 ms and then failed. So this stops no hang, because a synchronous
     * infinite loop hangs the worker whatever the number says. For those tests
     * it only turns a slow machine into a red suite, which teaches you to
     * re-run instead of read.
     *
     * It fired three times in one day on the corpus sweeps, which walk a
     * 139 MB fixture tree CI does not have. Over five clean runs the worst was
     * iffcorpus at 3.7s, already 74% of the old 5s budget, and the same test
     * varied 2.2x between runs.
     *
     * The twenty async bodies are what this still guards, and none of them
     * needs anything like 20s.
     */
    testTimeout: 20_000,
  },
})
