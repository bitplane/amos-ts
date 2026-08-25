/**
 * `Ed_DConfig` (+Equ.s:1775) and the file it is written to.
 *
 * Everything the editor remembers between sessions is one contiguous block of
 * 1,202 bytes: the screen size, the palette, the undo lengths, the two
 * detokenise case modes, the tab, the quit flags, and the key map. There is no
 * record structure and no field names on disc -- the block is written as it
 * lies in memory, and `+Editor_Config.s:28` carries each field's offset as a
 * comment because that offset IS the format.
 *
 * ## The file
 *
 * ```
 *  0  [length:4]  Ed_FConfig - Ed_DConfig, which is 1202
 *  4  [block]     the 1,202 bytes
 *     [len:4][bytes] x 8   the eight text blocks, in `EdC_Load`'s order
 * ```
 *
 * The length at the front is the whole of the validation: `EdC_Load` (:4959)
 * reads four bytes, compares them with `Ed_FConfig-Ed_DConfig` and reports
 * "bad config" on a mismatch. So a config from a build whose block was a
 * different size is refused, and one from a build with the same size is not
 * checked at all.
 *
 * `Ed_ConfigHead equ "ApCf"` (+Equ.s:1667) is declared next to `Ed_QuitHead`
 * and used by nothing. `Ed_Code` at offset 1198 is the four characters "1.10"
 * (+Editor_Config.s:441) and is read by nothing either. The file has a magic
 * number and a version, and the loader looks at neither.
 *
 * ## The two bytes at 1196
 *
 * Not padding. `.Ed_KFonc` is 552 bytes of three-byte records and the walk
 * that reads it stops on `$FF,0`, so the terminator lives in what the `rs.b 2`
 * looks like it reserved for alignment. The shipped file has `ff 00` there.
 *
 * ## The text blocks
 *
 * Eight of them, each `[length:4][bytes]`, in the order `EdC_Load` reads them:
 * the system strings, the menu strings, the dialogue messages, the test-time
 * errors, the run-time errors, the menu programs, the user menus and the menu
 * definitions. Each block is a run of `[pad][length][bytes]` records that
 * `GetMessage` (+B.s:562) walks 1-based, stopping at a length of `$FF`. This
 * keeps them as bytes, because that is what `EdC_LoadTextes` (:5148) does: it
 * reads the length, reserves that much and reads the lot, and never looks
 * inside.
 *
 * A length of zero is legal and means the pointer stays null (`.Skip`), which
 * is how a config with no user menus is written.
 *
 * ## What the shipped file says
 *
 * `AMOSPro_Editor_Config` is 18,868 bytes and everything above accounts for
 * 18,866 of them. The last two are zeroes that `EdC_Save` does not write.
 */
import { ED_KFONC } from './keymap.gen'

/** `Ed_FConfig - Ed_DConfig`: the length the file opens with, and its only check */
export const CONFIG_SIZE = 1202

/** where each field sits in the block, off the offsets +Editor_Config.s:28 lists */
const AT = {
  SX: 0,
  SY: 2,
  WX: 4,
  WY: 6,
  VSCROL: 8,
  INTER: 10,
  COL_B: 12,
  L_UNDO: 14,
  N_UNDO: 18,
  MAJ1: 22,
  MAJ2: 23,
  SV_BAK: 24,
  MENU_KEYS: 25,
  K_MEM_MAX: 26,
  PALETTE: 28,
  ES_Y1: 44,
  ES_Y2: 46,
  AUTO_SAVE: 76,
  AUTO_SAVE_MN: 80,
  SCH_MODE: 84,
  TABS: 86,
  ESC_OUTPUT: 88,
  QUIT_FLAGS: 89,
  INSERT: 90,
  SOUNDS: 91,
  AUTO_LOAD: 92,
  K_FONC: 644,
  CODE: 1198,
} as const

/** `Ed_AutoLoad` and `.Ed_KFonc` are both three bytes for each of the 184 commands */
const TABLE_BYTES = 3 * 184

/** `EdC_Load`'s d0: 0 ok, 1 the file would not open or read, 2 the length was wrong */
export const CFG = { OK: 0, DISK: 1, BAD: 2 } as const

/**
 * The eight text blocks, in the order `EdC_Load` (:4977) reads them, which is
 * the order of the pointers at +Equ.s:1673 under "ne pas changer l'ordre".
 *
 * Seven are message blocks. The eighth is not: `EdM_Definition` is the menu
 * tree, eight bytes a record, and `EdM_CreObjet` (:13005) reads it with
 * `lsr.l #3` rather than by walking lengths. It has no `$FF` on the end
 * either, so anything that treats it as messages runs to the end of the block
 * and then past it.
 */
export const TEXT_BLOCKS = [
  'system',
  'menus',
  'messages',
  'test',
  'run',
  'programs',
  'userMenus',
  'menuDefs',
] as const

export type TextBlock = (typeof TEXT_BLOCKS)[number]

export type ConfigTexts = Record<TextBlock, Uint8Array>

const empty = (): ConfigTexts =>
  Object.fromEntries(TEXT_BLOCKS.map((n) => [n, new Uint8Array(0)])) as ConfigTexts

/**
 * `Ed_DConfig` in memory: a block of bytes and the names for the offsets.
 *
 * Held as bytes rather than as fields, because the block IS the file and the
 * editor writes it back unchanged apart from what the user altered. A field
 * that this port does not use still survives a load and save.
 */
export class EditorConfig {
  readonly bytes: Uint8Array
  texts: ConfigTexts

  constructor(bytes?: Uint8Array, texts?: ConfigTexts) {
    this.bytes = bytes ?? Uint8Array.from(DEFAULTS)
    this.texts = texts ?? empty()
  }

  private u16(at: number): number {
    return (this.bytes[at]! << 8) | this.bytes[at + 1]!
  }

  private put16(at: number, n: number): void {
    this.bytes[at] = (n >>> 8) & 0xff
    this.bytes[at + 1] = n & 0xff
  }

  private u32(at: number): number {
    return ((this.u16(at) << 16) | this.u16(at + 2)) >>> 0
  }

  private put32(at: number, n: number): void {
    this.put16(at, (n >>> 16) & 0xffff)
    this.put16(at + 2, n & 0xffff)
  }

  /** `Ed_Sx`: the editor screen's width in pixels, 640 */
  get sx(): number {
    return this.u16(AT.SX)
  }

  /** `Ed_Sy`: its height, 256, and what `Ed_WMax` is worked out from */
  get sy(): number {
    return this.u16(AT.SY)
  }

  set sy(n: number) {
    this.put16(AT.SY, n)
  }

  /** `Ed_Wx` and `Ed_Wy`: where the editor screen sits on the display */
  get wx(): number {
    return this.u16(AT.WX)
  }

  get wy(): number {
    return this.u16(AT.WY)
  }

  /** `Ed_VScrol`: how far the escape screen slides, in pixels */
  get vScrol(): number {
    return this.u16(AT.VSCROL)
  }

  /** `Ed_Inter`: the editor screen is interlaced */
  get interlaced(): boolean {
    return this.bytes[AT.INTER] !== 0
  }

  /** `Ed_ColB`: the colour behind everything, as $RGB */
  get colB(): number {
    return this.u16(AT.COL_B)
  }

  /** `Ed_LUndo` and `Ed_NUndo`: the undo buffer's bytes and its record count */
  get lUndo(): number {
    return this.u32(AT.L_UNDO)
  }

  get nUndo(): number {
    return this.u32(AT.N_UNDO)
  }

  /** `DtkMaj1` and `DtkMaj2`: 0 lower, 1 UPPER, 2 Capitalised */
  get keywordCase(): number {
    return this.bytes[AT.MAJ1]!
  }

  get identCase(): number {
    return this.bytes[AT.MAJ2]!
  }

  /** `Ed_SvBak`: rename the old file to `.Bak` before saving over it */
  get svBak(): boolean {
    return this.bytes[AT.SV_BAK] !== 0
  }

  set svBak(v: boolean) {
    this.bytes[AT.SV_BAK] = v ? 0xff : 0
  }

  /** `EdM_Keys`: show the key shortcuts beside the menu entries */
  get menuKeys(): boolean {
    return this.bytes[AT.MENU_KEYS] !== 0
  }

  set menuKeys(v: boolean) {
    this.bytes[AT.MENU_KEYS] = v ? 0xff : 0
  }

  /** `Esc_KMemMax`: how many lines the escape screen remembers */
  get kMemMax(): number {
    return this.u16(AT.K_MEM_MAX)
  }

  /** `Ed_Palette`: eight $RGB words, and the editor uses every one */
  get palette(): number[] {
    return Array.from({ length: 8 }, (_, i) => this.u16(AT.PALETTE + 2 * i))
  }

  /** `Es_Y1` and `Es_Y2`: the escape screen's top and bottom */
  get esY1(): number {
    return this.u16(AT.ES_Y1)
  }

  get esY2(): number {
    return this.u16(AT.ES_Y2)
  }

  /**
   * `Ed_AutoSave`: how long between autosaves, in VERTICAL BLANKS.
   *
   * `Ed_SetAutoSave` (:5355) asks for minutes, multiplies by 50 or 60 off
   * `EcCall NTSC` and then by 60, and keeps the minutes separately in
   * `Ed_AutoSaveMn`. Only that command recomputes it, so a config written on a
   * PAL machine and loaded on an NTSC one keeps the PAL frame count and
   * autosaves at five sixths of the interval it names.
   */
  get autoSave(): number {
    return this.u32(AT.AUTO_SAVE)
  }

  set autoSave(n: number) {
    this.put32(AT.AUTO_SAVE, n)
  }

  /** `Ed_AutoSaveMn`: the same interval in minutes, which is what is shown */
  get autoSaveMn(): number {
    return this.u32(AT.AUTO_SAVE_MN)
  }

  set autoSaveMn(n: number) {
    this.put32(AT.AUTO_SAVE_MN, n)
  }

  /** `Ed_SchMode`: the search requester's four gadgets, which survive a session */
  get schMode(): number {
    return this.u16(AT.SCH_MODE)
  }

  set schMode(n: number) {
    this.put16(AT.SCH_MODE, n)
  }

  /** `Ed_Tabs`: three spaces */
  get tabs(): number {
    return this.u16(AT.TABS)
  }

  set tabs(n: number) {
    this.put16(AT.TABS, n)
  }

  /** `Esc_Output`: which of the escape screen's outputs is selected */
  get escOutput(): number {
    return this.bytes[AT.ESC_OUTPUT]!
  }

  /**
   * `Ed_QuitFlags`: bit 0 asks before quitting, bit 1 saves the config, bit 2
   * the macros, bit 3 the list of open programs. The shipped default is 1.
   */
  get quitFlags(): number {
    return this.bytes[AT.QUIT_FLAGS]!
  }

  set quitFlags(n: number) {
    this.bytes[AT.QUIT_FLAGS] = n & 0xff
  }

  /** `Ed_Insert`: insert rather than overwrite */
  get insert(): boolean {
    return this.bytes[AT.INSERT] !== 0
  }

  set insert(v: boolean) {
    this.bytes[AT.INSERT] = v ? 0xff : 0
  }

  /** `Ed_Sounds`: the editor makes a noise when a key does something */
  get sounds(): boolean {
    return this.bytes[AT.SOUNDS] !== 0
  }

  set sounds(v: boolean) {
    this.bytes[AT.SOUNDS] = v ? 0xff : 0
  }

  /**
   * `Ed_AutoLoad`: three bytes per command naming a program to run instead.
   *
   * `Ed_FCall` (:2612) tests the first of the three and branches to
   * `Ed_PrgCommand` when it is not zero, so any command can be replaced by an
   * AMOS program. The shipped file leaves all 552 bytes at zero.
   */
  get autoLoad(): Uint8Array {
    return this.bytes.subarray(AT.AUTO_LOAD, AT.AUTO_LOAD + TABLE_BYTES)
  }

  /**
   * `.Ed_KFonc`: the key map, 552 bytes plus the `$FF,0` that ends it.
   *
   * The terminator sits in the two bytes at 1196 that read as alignment, which
   * is why this runs to 554 and not 552. `src/editor/keymap.gen.ts` holds the
   * same 554 bytes as the default.
   */
  get keyMap(): Uint8Array {
    return this.bytes.subarray(AT.K_FONC, AT.K_FONC + TABLE_BYTES + 2)
  }

  /** `Ed_Code`: "1.10", which nothing reads */
  get code(): string {
    return String.fromCharCode(...this.bytes.subarray(AT.CODE, AT.CODE + 4))
  }
}

/** what came out of the file */
export interface ConfigRead {
  error: number
  config: EditorConfig | null
}

/** `EdC_Load` (+Edit.s:4959) */
export function readConfig(file: Uint8Array): ConfigRead {
  const fail = (error: number): ConfigRead => ({ error, config: null })
  if (file.length < 4) return fail(CFG.DISK)
  const size = ((file[0]! << 24) | (file[1]! << 16) | (file[2]! << 8) | file[3]!) >>> 0
  // `cmp.l (a0),d3 / bne .Err2`: the length is the whole of the validation
  if (size !== CONFIG_SIZE) return fail(CFG.BAD)
  if (file.length < 4 + CONFIG_SIZE) return fail(CFG.DISK)
  const config = new EditorConfig(file.slice(4, 4 + CONFIG_SIZE))
  let at = 4 + CONFIG_SIZE
  for (const name of TEXT_BLOCKS) {
    if (at + 4 > file.length) return fail(CFG.DISK)
    const n = ((file[at]! << 24) | (file[at + 1]! << 16) | (file[at + 2]! << 8) | file[at + 3]!) >>> 0
    at += 4
    if (at + n > file.length) return fail(CFG.DISK)
    config.texts[name] = file.slice(at, at + n)
    at += n
  }
  return { error: CFG.OK, config }
}

/** `EdC_Save` (+Edit.s:5072) */
export function writeConfig(config: EditorConfig): Uint8Array {
  let size = 4 + CONFIG_SIZE
  for (const name of TEXT_BLOCKS) size += 4 + config.texts[name].length
  const out = new Uint8Array(size)
  const put32 = (at: number, n: number): void => {
    out[at] = (n >>> 24) & 0xff
    out[at + 1] = (n >>> 16) & 0xff
    out[at + 2] = (n >>> 8) & 0xff
    out[at + 3] = n & 0xff
  }
  put32(0, CONFIG_SIZE)
  out.set(config.bytes, 4)
  let at = 4 + CONFIG_SIZE
  for (const name of TEXT_BLOCKS) {
    const block = config.texts[name]
    put32(at, block.length)
    out.set(block, at + 4)
    at += 4 + block.length
  }
  return out
}

/**
 * `GetMessage` (+B.s:562): the records of a text block, 1-based.
 *
 * `[pad][length][bytes]` each, and a length of `$FF` ends the block. The pad
 * is zero in every record of the shipped file and the walk steps over it
 * without looking.
 */
export function messages(block: Uint8Array): string[] {
  const out: string[] = []
  for (let p = 0; p + 1 < block.length; ) {
    const len = block[p + 1]!
    if (len === 0xff) break
    out.push(String.fromCharCode(...block.subarray(p + 2, p + 2 + len)))
    p += 2 + len
  }
  return out
}

/**
 * `Ed_GetFsMessage` (+Edit.s:5290): the first EMPTY record of a block, 1-based.
 *
 * Not the first free slot past the end: a message the user deleted is left in
 * place as a zero-length record, and this is what finds it again. Only when
 * the walk reaches the `$FF` without seeing one does it answer `count + 1`,
 * which is `.New` falling through to `Ed_GetNbMessage`.
 */
export function firstFreeMessage(block: Uint8Array): number {
  const list = messages(block)
  const at = list.findIndex((m) => m.length === 0)
  return at < 0 ? list.length + 1 : at + 1
}

/**
 * `EdC_ChangeTexte` (+Edit.s:5203): one record of a block replaced, and a
 * whole new block built to hold it.
 *
 * The machine cannot edit in place, because the records are packed and a
 * longer message would run into the next one. So it works out the new total,
 * allocates, copies every record across and swaps the pointer, which is why
 * the routine ends in `Ed_MemFree` on what it just read.
 *
 * `n` is 1-based. A number ABOVE the count appends (`.New` reserves two bytes
 * plus the text and `.CpX` writes it after the loop), which no caller reaches:
 * `EdZ_NewConfig` refuses `d0 > d1` first, and equal goes to the replace arm.
 *
 * The pads come out zero, because the rebuild writes `clr.b (a0)+` in front of
 * the first record and after every one. They are zero in the shipped file too.
 */
export function changeMessage(block: Uint8Array, n: number, text: string): Uint8Array {
  const list = messages(block)
  const len = Math.min(text.length, 0xfe)
  // `add.l -(a0),d0` (:5232): the size is the OLD block's own length plus what
  // this record grew by, and not a fresh count. That is what carries the byte
  // the assembler's `Even` left after the `$FF`: the shipped system block is
  // 748 bytes for 747 bytes of records, and stays 748 across a change
  let delta: number
  if (n >= 1 && n <= list.length) {
    delta = len - Math.min(list[n - 1]!.length, 0xfe)
    list[n - 1] = text
  } else {
    delta = 2 + len
    list.push(text)
  }
  const out = new Uint8Array(Math.max(block.length + delta, 2))
  let p = 0
  for (const m of list) {
    const size = Math.min(m.length, 0xfe)
    out[p + 1] = size
    for (let i = 0; i < size; i++) out[p + 2 + i] = m.charCodeAt(i) & 0xff
    p += 2 + size
  }
  out[p + 1] = 0xff
  return out
}

/**
 * The block `+Editor_Config.s:27` assembles, which is what the editor starts
 * with when there is no file to read.
 *
 * The key map comes from ./keymap.gen.ts rather than being repeated here,
 * because that table is checked against the shipped binary on the way out of
 * `src/cli/genedkeys.ts`.
 */
const DEFAULTS = (() => {
  const b = new Uint8Array(CONFIG_SIZE)
  const put16 = (at: number, n: number): void => {
    b[at] = (n >>> 8) & 0xff
    b[at + 1] = n & 0xff
  }
  const put32 = (at: number, n: number): void => {
    put16(at, (n >>> 16) & 0xffff)
    put16(at + 2, n & 0xffff)
  }
  put16(AT.SX, 640)
  put16(AT.SY, 256)
  put16(AT.WX, 129)
  put16(AT.WY, 50)
  put16(AT.VSCROL, 300)
  put16(AT.COL_B, 0x000)
  put32(AT.L_UNDO, 4096)
  put32(AT.N_UNDO, 1000)
  b[AT.MAJ1] = 2
  b[AT.MAJ2] = 1
  b[AT.SV_BAK] = 0xff
  b[AT.MENU_KEYS] = 0xff
  put16(AT.K_MEM_MAX, 20)
  const palette = [0x000, 0x06f, 0x077, 0xeee, 0xf00, 0x0dd, 0x0aa, 0xff3]
  palette.forEach((c, i) => put16(AT.PALETTE + 2 * i, c))
  put16(AT.ES_Y1, 200)
  put16(AT.ES_Y2, 256)
  put16(AT.TABS, 3)
  b[AT.ESC_OUTPUT] = 1
  b[AT.QUIT_FLAGS] = 1
  b[AT.INSERT] = 0xff
  b.set(ED_KFONC, AT.K_FONC)
  b.set([0x31, 0x2e, 0x31, 0x30], AT.CODE) // "1.10"
  return b
})()
