/**
 * Playing a module by writing the AMOS program that plays it.
 *
 * The Files panel's play button does not drive a replayer. It builds a real
 * `.AMOS` file, four lines of source with the module in a bank beside them,
 * and hands it to the player like any other program. So the preview IS the
 * port: a module that sounds wrong here sounds wrong because a keyword is
 * wrong, and the file it produced is sitting in RAM: to be opened in the
 * editor and looked at.
 *
 * `src/cli/renderaudio.ts` reached the same conclusion headlessly and got
 * there first: its `track` and `medext` engines build a bank and run
 * `Track Loop On : Track Play : Do : Loop` on a Runtime rather than calling
 * `Protracker` themselves, because that is the path a program takes.
 *
 * ## Why an extension keyword tokenises at all
 *
 * A listing typed at the machine gets the STOCK slot bindings, which are the
 * five Europress extensions, so `Thx Play` in one is not a keyword and does
 * not tokenise. A saved program is different: `../loader/program.ts` calls
 * `extensionBindingsFor`, which reads the token ids back out of the program
 * and identifies the extension from them (`../ext/identify.ts`). Tokenising
 * against DME's table therefore produces a file that identifies AS a DME
 * program when it is loaded, which is exactly what a DME program is.
 *
 * That is the whole reason this writes a file rather than a listing.
 *
 * ## The formats that are not here
 *
 * `omed` is MMD2 and MMD3, and stock `Med Load` refuses anything but MMD0 and
 * MMD1 (`+Music.s`, and instr.ts's 'med load' says so in as many words). DME
 * plays them through `Omed Play`, so it goes through DME like the rest.
 */
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokeniseSource } from '../tokens/edtok'
import { writeProgramFile } from '../editor/files'
import { defaultExtensionTables, extensionById } from '../ext/registry'
import type { ModFormat } from '../amiga/modformat'
import {
  DIGI_BANK_NAME,
  FC13_BANK_NAME,
  FC14_BANK_NAME,
  OMED_BANK_NAME,
  P61_BANK_NAME,
  PTM_BANK_NAME,
  S3M_BANK_NAME,
  SFX_BANK_NAME,
  SMON_BANK_NAME,
  THX_BANK_NAME,
} from '../runtime/dme'

/** DME 2.0's slot, from routine 0's own `moveq #$e,d0` (../runtime/dme.ts) */
const DME_SLOT = 15
const DME = 'dme-2.0'

/**
 * What each format needs: a bank, and the lines that start it.
 *
 * The bank NUMBER and NAME are both checked by the keyword before it plays a
 * note. `Track Play` tests the eight bytes in front of the data and refuses
 * anything that is not `Tracker ` exactly, trailing space and all.
 */
interface Recipe {
  /** the extension whose table the source is tokenised against, or null for stock */
  ext: string | null
  bank: number
  /** padded to eight characters on the way into the file */
  bankName: string
  source: string
}

const RECIPES: Readonly<Record<ModFormat, Recipe>> = {
  // The two the stock Music extension plays, which is what an AMOS program
  // written in 1992 would have used and what most of the corpus contains.
  mod: { ext: null, bank: 6, bankName: PTM_BANK_NAME, source: 'Track Loop On\nTrack Play\nDo\nLoop\n' },
  med: { ext: null, bank: 7, bankName: 'Med', source: 'Med Play\nDo\nLoop\n' },

  // The rest through DME 2.0, the widest audio surface in the registry:
  // fifteen formats, twelve of which play here. Every bank name is DME's own
  // constant rather than a copy, because each keyword compares all eight
  // characters and a trailing space is part of the name.
  omed: { ext: DME, bank: 6, bankName: OMED_BANK_NAME, source: 'Omed Play 6\nDo\nLoop\n' },
  thx: { ext: DME, bank: 6, bankName: THX_BANK_NAME, source: 'Thx Play 6\nDo\nLoop\n' },
  p61: { ext: DME, bank: 6, bankName: P61_BANK_NAME, source: 'P61 Play 6\nDo\nLoop\n' },
  fc13: { ext: DME, bank: 6, bankName: FC13_BANK_NAME, source: 'Fc13 Play 6\nDo\nLoop\n' },
  fc14: { ext: DME, bank: 6, bankName: FC14_BANK_NAME, source: 'Fc14 Play 6\nDo\nLoop\n' },
  sfx: { ext: DME, bank: 6, bankName: SFX_BANK_NAME, source: 'Sfx13 Play 6\nDo\nLoop\n' },
  digi: { ext: DME, bank: 6, bankName: DIGI_BANK_NAME, source: 'Db Play 6\nDo\nLoop\n' },
  smon: { ext: DME, bank: 6, bankName: SMON_BANK_NAME, source: 'Smon Play 6\nDo\nLoop\n' },
  s3m: { ext: DME, bank: 6, bankName: S3M_BANK_NAME, source: 'S3m Play 6\nDo\nLoop\n' },
}

/**
 * One memory bank as a file holds it, `AmBk` onwards.
 *
 * The inverse of `parseMemoryBank` in `../loader/amosfile.ts`, and the length
 * longword is the part worth watching: it carries the data length PLUS the
 * eight bytes of name that follow it, with the flags in its top byte. `LB_Bank`
 * (+Lib.s:4090) reads it back as `and.l #$0FFFFFFF,d2 / subq.l #8,d2`.
 */
function memoryBank(number: number, name: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + 2 + 2 + 4 + 8 + data.length)
  const v = new DataView(out.buffer)
  out.set([0x41, 0x6d, 0x42, 0x6b], 0) // AmBk
  v.setUint16(4, number, false)
  v.setUint16(6, 1, false) // memType 1: chip, which is where a replayer wants it
  v.setUint32(8, (data.length + 8) & 0x0fffffff, false)
  for (let i = 0; i < 8; i++) out[12 + i] = name.padEnd(8).charCodeAt(i)
  out.set(data, 20)
  return out
}

/** the bank list a program carries after its source: `AmBs`, a count, the banks */
function bankList(banks: readonly Uint8Array[]): Uint8Array {
  const total = banks.reduce((n, b) => n + b.length, 0)
  const out = new Uint8Array(6 + total)
  out.set([0x41, 0x6d, 0x42, 0x73], 0) // AmBs
  new DataView(out.buffer).setUint16(4, banks.length, false)
  let at = 6
  for (const b of banks) {
    out.set(b, at)
    at += b.length
  }
  return out
}

export interface ModPreview {
  /** what to call the file, which is what the editor and the tree will show */
  name: string
  /** a whole `.AMOS`, header and banks and all */
  bytes: Uint8Array
  /** the keyword it will run, for the status line to name */
  keyword: string
}

/**
 * The program that plays this module, or null for a format with no recipe.
 *
 * Null is a real answer and the panel says which format it was: a module this
 * port can NAME and cannot start is a different state from a file it does not
 * recognise.
 */
export function modProgram(fileName: string, module: Uint8Array, format: ModFormat): ModPreview | null {
  const recipe = RECIPES[format]
  if (!recipe) return null

  const table = new TokenTable(CORE_TOKENS)
  // The stock bindings FIRST, and then DME over them. `Track Play` and
  // `Med Play` are the Music extension's and live at its own slot, not in the
  // core table: tokenising against the core table alone turned `Track Loop
  // On` into a variable called TRACK followed by a syntax error.
  const extensions = new Map<number, TokenTable>(defaultExtensionTables())
  if (recipe.ext !== null) {
    const ext = extensionById(recipe.ext)
    if (!ext) return null
    extensions.set(DME_SLOT, ext.table)
  }

  const source = tokeniseSource(recipe.source, table, { extensions })
  const bytes = writeProgramFile({
    pro: true,
    mathFlags: 0,
    tested: true,
    // writeProgramFile adds the terminating zero word back, so it comes off
    // here: a file that carried one would gain a second
    source: source.subarray(0, Math.max(0, source.length - 2)),
    banks: bankList([memoryBank(recipe.bank, recipe.bankName, module)]),
  })

  return {
    name: `${fileName.replace(/\.[^.]*$/, '')}.play.amos`,
    bytes,
    keyword: recipe.source.split('\n')[0]!,
  }
}
