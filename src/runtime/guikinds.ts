/**
 * The gadget kinds GuiConv writes into a GUI bank's Kind array.
 *
 * Almost gadtools' own, which is the fifth independent confirmation of that
 * numbering in this port. `GuiConv.Amos` sets them out as plain constants:
 *
 *     _GENERIC=0: _BUTTON=1: _CHECKBOX=2: _INTEGER=3: _LISTVIEW=4: _MX=5
 *     _NUMBER=-1: _CYCLE=7: _PALETTE=8: _SCROLLER=9: _SLIDER=11: _STRING=12
 *     _TEXT=13: _NUM=14
 *
 * and prints the names in a Data statement that keeps index 10 EMPTY, which
 * is gadtools' reserved slot between SCROLLER and SLIDER showing up for the
 * third time:
 *
 *     Data "IMAGE","BUTTON","CHECKBOX","INTEGER","LISTVIEW","MUTUALEXCLUDE",
 *     Data "NUMBER","CYCLE","PALETTE","SCROLLER","","SLIDER","STRING","TEXT","NUM"
 *
 * Three things differ from `../amiga/gadtools.ts` and all three are the
 * converter's, not the library's.
 *
 * INDEX 0 IS IMAGE, where gadtools has GENERIC. The guide explains why: "The
 * GadToolsBox Editor don't allows you to create a image gadget, and so i've
 * found another way: You must create a BUTTON gadget, but WITHOUT TEXT!" So
 * an image gadget is a button the editor was told nothing about, and the
 * converter writes 0 for it because it has no gadtools kind to write.
 *
 * `_NUMBER=-1` where gadtools' NUMBER is 6. The converter never emits it: a
 * negative kind cannot be written into the word array as a gadtools kind, so
 * this is a marker meaning "not a real one of these", and index 6 in the name
 * table still reads "NUMBER".
 *
 * `_NUM=14` is past the end of gadtools' set entirely. It is the converter's
 * own, alongside the progress bar the guide describes as a TEXT gadget whose
 * default string is "PBAR".
 */

/** the converter's own image gadget: a BUTTON the editor was given no text for */
export const AMOS_KIND_IMAGE = 0
/** the converter's own, past the end of gadtools' set */
export const AMOS_KIND_NUM = 14

/** the names GuiConv prints, index for index, with its empty slot 10 kept */
export const AMOS_KIND_NAMES: readonly string[] = [
  'IMAGE',
  'BUTTON',
  'CHECKBOX',
  'INTEGER',
  'LISTVIEW',
  'MUTUALEXCLUDE',
  'NUMBER',
  'CYCLE',
  'PALETTE',
  'SCROLLER',
  '',
  'SLIDER',
  'STRING',
  'TEXT',
  'NUM',
]
