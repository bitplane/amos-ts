/**
 * Recursive directory walk for the command-line tools.
 *
 * Paths are Buffers for the reason `NodeVolume` reads directories as buffers
 * (see nodefs.ts): **Amiga filenames are ISO-8859-1**. Node decodes directory
 * entries as UTF-8, so a name holding a byte like $E4 (a-umlaut) comes back
 * carrying a replacement character and no longer names the file it was read
 * from — every later stat or open on it fails. `Väliaikainen.AMOS` on APD150
 * of the AMOS PD Library CD is one of these, and it is enough on its own to
 * end a survey of the collection.
 *
 * The runtime learned this rule; the tools that survey the corpus had not,
 * which is why it only ever showed up on material outside `fixtures/`.
 *
 * Entries that cannot be read are skipped rather than thrown. A tool pointed
 * at a large, old collection meets broken symlinks and unreadable drawers, and
 * the survey is worth more than the one entry it loses.
 */
import { readdirSync, statSync } from 'node:fs'

const SEP = Buffer.from('/')

/** Every file under `root`, depth-first, as raw path bytes. */
export function* walkFiles(root: Buffer | string): Generator<Buffer> {
  const p = Buffer.isBuffer(root) ? root : Buffer.from(root)
  let st
  try {
    st = statSync(p)
  } catch {
    return
  }
  if (st.isDirectory()) {
    let entries: Buffer[]
    try {
      entries = readdirSync(p, { encoding: 'buffer' })
    } catch {
      return
    }
    for (const e of entries) yield* walkFiles(Buffer.concat([p, SEP, e]))
  } else if (st.isFile()) {
    yield p
  }
}

/**
 * A path as text, for printing and for matching extensions. Latin-1 because
 * that is what the bytes are; the result is safe to show and to test with a
 * regex, but pass the Buffer itself back to `fs` rather than this.
 */
export function hostPath(p: Buffer): string {
  return p.toString('latin1')
}
