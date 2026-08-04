/**
 * AMOS's bank list, and the flags word that makes it ONE list.
 *
 * On the machine every bank — a Reserve'd block, the Bob bank, the Icon bank,
 * a music bank — is an entry in a single chain, and what it IS lives in a
 * flags word (+Equ.s:1864-8):
 *
 *     Bnk_BitData  0    Banque de data
 *     Bnk_BitChip  1    Banque en chip
 *     Bnk_BitBob   2    Banque de Bobs
 *     Bnk_BitIcon  3    Banque d'icons
 *
 * `L_Bnk.GetAdr` walks that chain and finds any of them, which is why `Start`,
 * `Length`, `Erase`, `List Bank` and the rest are each about six instructions
 * long in the original: they ask one question of one list.
 *
 * This port had TWO lists — `memBanks` for Reserve'd blocks and `spriteBank` /
 * `iconBank` beside it — so every one of those keywords had to special-case
 * banks 1 and 2 by hand, and they did not agree. `Erase` and `Length` handled
 * them, `List Bank` and `Bank Swap` each had their own version, `Start` threw
 * "bank not reserved" for a bank that plainly existed, and AMCAF's Wsave
 * carried a type-bit check that could never fire because a `Map<number,
 * MemoryBank>` cannot hold a Bob bank. This module is the one list.
 *
 * ## The flags are read, not invented
 *
 * A Bob or Icon bank's flags word is not stored in the file — 26 of the 63
 * `.abk` files in the corpus are bare `AmSp` with no AmBk header at all, so
 * the magic IS the type. AMOS builds the word when it reserves the bank, and
 * says exactly what it puts there:
 *
 *     Bnk.ResIco (+Lib.s:8145)  moveq #(1<<Bnk_BitIcon)+(1<<Bnk_BitData),d2
 *     Bnk.ResBob (+Lib.s:8153)  moveq #(1<<Bnk_BitBob)+(1<<Bnk_BitData),d2
 *
 * Both carry Bnk_BitData, and that answers a question the old comment on
 * `Erase Temp` guessed at: Bnk.EffTemp (+Lib.s:8059) tests `btst
 * #Bnk_BitData,d0` and NOTHING else, so a Bob bank survives Erase Temp
 * because it is a Data bank, not because Bob banks are special-cased.
 */

/** the four bank flag bits, as +Equ.s:1864-8 numbers them */
export const BNK = {
  /** Bnk_BitData — survives Erase Temp */
  DATA: 1 << 0,
  /** Bnk_BitChip */
  CHIP: 1 << 1,
  /** Bnk_BitBob — the sprite/Bob bank, number 1 */
  BOB: 1 << 2,
  /** Bnk_BitIcon — the icon bank, number 2 */
  ICON: 1 << 3,
} as const

/** both object-bank bits, which is AMCAF's `andi.w #$c` and Ppload's `& 0x0c` */
export const BNK_OBJECT = BNK.BOB | BNK.ICON

/** `Bnk.ResBob` +Lib.s:8153 */
export const BOB_BANK_FLAGS = BNK.BOB | BNK.DATA
/** `Bnk.ResIco` +Lib.s:8145 */
export const ICON_BANK_FLAGS = BNK.ICON | BNK.DATA

/** the bank numbers AMOS gives the two object banks */
export const BOB_BANK = 1
export const ICON_BANK = 2

/**
 * One entry of the bank list, whatever kind of bank it is.
 *
 * `length` is what `=Length()` answers, and that is NOT always a byte count:
 * FnLength (+Lib.s:2491) computes the byte length and then, for a Bob or Icon
 * bank, throws it away and returns `move.w (a1),d3` — the word at the bank
 * start, which is the IMAGE COUNT. So a sprite bank of 40KB with three images
 * answers 3.
 */
export interface BankRef {
  number: number
  /** the flags word, Bob and Icon bits included */
  flags: number
  /** the eight-character bank id */
  name: string
  /** what `=Length()` answers — bytes, or the image count for an object bank */
  length: number
  /** what `=Start()` answers */
  address: number
}

/** is this an object bank — the `andi.w #$c` every saver checks */
export function isObjectBank(b: BankRef): boolean {
  return (b.flags & BNK_OBJECT) !== 0
}
