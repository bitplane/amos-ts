/**
 * FileID 1.0 — Haiko Lemser's wrapper around `FileID.library`, at slot 25.
 *
 * Six functions that ask an external library what type a file is. The
 * extension does no identification of its own: it opens the library at
 * startup and every keyword is a check-then-call.
 *
 * ## Evidence
 *
 * SOURCE tier — `FileID.s`, 6,327 bytes, ships in the archive beside the
 * built `FileID.Lib`, so every line below is read rather than disassembled.
 * Plus `FileID.Lib.Guide` and `fileidex.readme`, both German.
 *
 * Same author as MED 7.1, and the same habits: German requester messages, a
 * table of them at the end, and a `$VER` built from a `Version` macro.
 *
 * ## Identity, off the source
 *
 * `ExtNb equ 25-1` (source:14) and, in the file's own header comment, `Slot : 25`. The
 * store is `move.l a3,ExtAdr+ExtNb*16(a5)` — which is the third independent
 * confirmation of the slot arithmetic this port uses, written out as the
 * assembler's own expression rather than as a computed offset. Version 1.0,
 * from the `Version` macro and the title `FileID Extension V 1.0 by Haiko
 * Lemser (c)1998`. The readme says `Requires: AMOS1.3`.
 *
 * ## The library this port does not have
 *
 * Startup is `OpenLibrary("FileID.library", 0)` — version 0, though the
 * comment says `ab Version 6`, so any version will do — stored at `_IDbase`.
 * Four of the six keywords open with
 *
 *     Tst.l _IDbase / bne .ok / moveq #0,d0 / RBra L_Custom
 *
 * which is message 0, *"FileID.library nicht geöffnet"*.
 *
 * `FileID.library` is not modelled here. It is a table of magic numbers
 * maintained by someone else — the readme points at Aminet's
 * `util/libs/FIDLib80.lha` for version 8.0 — and its ID NUMBERS are its own,
 * so inventing them would be worse than absence: a program that compares
 * `Id Identify File(...)` against a documented ID would silently get a wrong
 * answer instead of a plain error. So `openLibrary` answers 0 and the four
 * guarded keywords raise the extension's own message, which is exactly what
 * they do on an Amiga without the library installed.
 *
 * That leaves the two UNGUARDED ones working, and they are the two that only
 * read state: `Id Fileinfo` and `Id Error` return the longs at `FileInfo` and
 * `IDerr`, both still zero.
 *
 * ## Id Get String could never have worked
 *
 *     Jsr _LVOFiGetIDString(a6)
 *     Move.l d0,d0
 *     sub.b  #2,d0
 *     move.l d0,d3
 *     moveq  #2,d2
 *
 * The library returns a C string pointer; AMOS wants a length-word-prefixed
 * one, so the author steps back two bytes to invent a length word. Two things
 * are wrong with that and the second is fatal:
 *
 *   - the two bytes before a C string are not a length. Whatever is there is
 *     read as one, so the string comes out an arbitrary length.
 *   - `sub.b` subtracts from the LOW BYTE ONLY. A pointer ending in $00 or
 *     $01 does not step back two bytes, it jumps forward 254 — `$1234_5600`
 *     becomes `$1234_56FE`. The instruction wanted is `sub.l`.
 *
 * Nothing here can reproduce a pointer arithmetic bug in a library this port
 * does not have, and the keyword cannot be reached anyway while the library
 * is absent. Recorded because it is the reading, and because it means the
 * keyword was broken on the machine too.
 */
import { AmosError, VI, VS, int, str } from '../interp/values'
import type { Value } from '../interp/values'
import type { Func } from '../interp/builtins'
import type { Runtime } from './runtime'
import { openLibrary } from '../amiga/exec'

/**
 * `ErrMsg` (source:277) at the end of FileID.s — eight NUL-separated German strings,
 * indexed 0-based by d0 and delivered through `L_ErrorExt` with
 * `moveq #ExtNb,d2`, the slot zero-based.
 *
 * Only 0 and 4 have callers in the extension. The other six are the
 * library's own `FIERR_*` codes, negated into d0 by
 * `move.l #0,d3 / sub.l IDerr,d3` and passed straight through — so a library
 * error of 1 reports message 1 and so on down the list.
 */
export const FILEID_ERRORS = [
  'FileID.library nicht geöffnet',
  'Kann Datei nicht finden',
  'Kann Datei nicht prüfen',
  'Kann Datei nicht öffnen',
  'Kein Speicher mehr',
  'Datei Lese Fehler',
  'Datei Größe ist NULL',
  'Kein Datei Name in angegebenen Pfad',
]

/** `L_Custom` (source:274) — the requester, by the index the caller puts in d0 */
const fileidErr = (n: number): never => {
  throw new AmosError(FILEID_ERRORS[n] ?? `FileID error ${n}`)
}

export interface FileIdState {
  /** `_IDbase` — what OpenLibrary("FileID.library", 0) returned at startup */
  base: number
  /** `FileInfo` — the last FiAllocFileInfo, freed again before each return */
  fileInfo: number
  /** `IDerr` — the last identify call's error code, 0 when it succeeded */
  err: number
}

/** L0 (source:86), the cold start: one OpenLibrary and nothing else */
export const newFileIdState = (): FileIdState => ({
  base: openLibrary('fileid.library', 0),
  fileInfo: 0,
  err: 0,
})

/** the `Tst.l _IDbase / bne / moveq #0,d0 / RBra L_Custom` (source:268) four of them open with */
function needLib(st: FileIdState): void {
  if (st.base === 0) fileidErr(0)
}

export function makeFileIdFunctions(rt: Runtime): Record<string, Func> {
  const st = (): FileIdState => rt.fileId

  return {
    /**
     * =Id Get High Id — L3 (source:134). `FiGetHighID()`, the highest type number the
     * installed library knows. The Guide's point is that the answer depends
     * on the library version rather than on the extension.
     */
    'id get high id': (): Value => {
      needLib(st())
      return VI(0)
    },

    /**
     * =Id Get String(num) — L4 (source:148). `FiGetIDString(num)`, the human-readable name
     * of a type number, returned as a string.
     *
     * NOTE, and see the header: the pointer fix-up is `sub.b #2,d0` where it
     * needed `sub.l`, and even done right it invents a length word out of
     * whatever precedes a C string. Not marked DEFECT because nothing here
     * REPRODUCES it — the bug is pointer arithmetic in a library this port
     * does not have, and the keyword is unreachable while it is absent.
     */
    'id get string': (_, a): Value => {
      void int(a[0] ?? VI(0))
      needLib(st())
      return VS('')
    },

    /**
     * =Id Identify File("name") — L5 (source:165), and the routine is four calls:
     *
     *     add.l #2,a4                      step over the AMOS length word
     *     FiAllocFileInfo   -> FileInfo    null is message 4, "Kein Speicher mehr"
     *     FiIdentifyFromName(name, info)   non-zero is NEGATED into the message index
     *     move.w 4(a0),d0                  the type, a WORD at FileInfo+4
     *     FiFreeFileInfo
     *
     * NOTE the order: the structure is freed BEFORE the value is returned,
     * and the type was copied out to `dummy` first — so `Id Fileinfo` below
     * hands back a pointer to memory that has already been given back.
     */
    'id identify file': (_, a): Value => {
      void str(a[0] ?? VS(''))
      needLib(st())
      return VI(0)
    },

    /**
     * =Id Identify Adresse(addr) — L6 (source:208), byte for byte L5 with `FiIdentify` in
     * place of `FiIdentifyFromName` and no length-word step, so the argument
     * is an address of data already in memory rather than a filename.
     *
     * The spelling is the author's — German `Adresse` inside an English
     * keyword — and the token table is what a program has to type.
     */
    'id identify adresse': (_, a): Value => {
      void int(a[0] ?? VI(0))
      needLib(st())
      return VI(0)
    },

    /**
     * =Id Fileinfo — L7 (source:248), three instructions: `move.l FileInfo,d3 / moveq
     * #0,d2 / Rts`. NO library check, so it answers even with nothing
     * installed, and what it answers is the pointer the last identify call
     * already freed.
     */
    'id fileinfo': (): Value => VI(st().fileInfo),

    /**
     * =Id Error — L8 (source:253), the same three instructions over `IDerr`. Also
     * unguarded. Zero means the last identify succeeded; a non-zero value is
     * the library's own `FIERR_*`, and the messages above are the extension's
     * translations of them.
     */
    'id error': (): Value => VI(st().err),
  }
}
