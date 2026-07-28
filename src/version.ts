/**
 * Which build this is.
 *
 * The site publishes the same bundle to `/`, `/v/latest/` and an immutable
 * `/v/<x.y.z>/`, and the asset filenames are deliberately stable so the
 * moving copies overwrite in place rather than accumulating. The cost of that
 * is that a CDN can go on serving an old `/v/latest/assets/amos-player.js`
 * after a release, and nothing on the page says so — the only way to tell was
 * to hash the file and compare. Showing the version makes a stale copy
 * visible instead of merely suspected.
 *
 * `__AMOS_VERSION__` is substituted at build time from package.json. The
 * `typeof` guard is what makes it safe under the dev server and vitest, where
 * nothing defines it.
 */
declare const __AMOS_VERSION__: string | undefined

export const VERSION: string = typeof __AMOS_VERSION__ === 'string' ? __AMOS_VERSION__ : 'dev'
