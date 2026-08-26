/**
 * What this port calls itself, where the editor names the program it is.
 *
 * AMOS Professional says "AMOS Professional" in a few places, and in two of
 * them it is answering the question "what am I". This is not that program, so
 * those two answer differently: the About box (`EdD_Title`, requester 0) and
 * the menu entry that opens it.
 *
 * Everywhere else the messages are left exactly as the assembler wrote them.
 * `ED_MESSAGES` is generated evidence and nothing here edits it, and neither
 * does anything else: the escape screen prints records 21 to 23 straight out
 * of that table (`NOTICE`, ../runtime/directscreen.ts), so AMOS's own notice
 * stands on this application's boot screen whatever the About box says.
 *
 * The licence the AMOS Professional source was released under asks for
 * exactly that. Its README: "you can do anything you want from it as long as
 * the copyright notice is present in both the modified source code and the
 * boot screen of the application". The About box carries the two copyright
 * lines as well, and ../../LICENSE carries all three.
 */
import { VERSION } from '../version'

/** the name, and the version the build was made from ('dev' under vite) */
export const PORT_NAME = 'amos-ts'
export const PORT_VERSION = VERSION
export const PORT_HOME = 'amos.bitplane.net'
export const PORT_REPO = 'https://github.com/bitplane/amos-ts'

/**
 * The About box, line by line, in the `Ed_VDialogues` slot each one goes into.
 *
 * `Ed_Dialogue` (+Edit.s:3107) fills sixteen Interface variables and runs a
 * label, and nothing about a slot says what it holds: the requester's own
 * program decides. So the port's lines travel the same way the machine's do,
 * as variables, rather than being written over records in `ED_MESSAGES` that
 * mean something else. Slot 1 is the extension count and slot 4 is where
 * `Ed_Ligne` puts a routine address for its `CA`; the rest are free.
 */
export const ABOUT_TITLE = 0
export const ABOUT_COUNT = 1
export const PORT_ABOUT_LINES: ReadonlyMap<number, string> = new Map([
  [ABOUT_TITLE, PORT_NAME],
  [2, PORT_HOME],
  [3, 'Based on AMOS Professional'],
  [5, '(c) 1992 Europress Software'],
  [6, '(c) 2020 Francois Lionet'],
  [7, '(c) 2026 Gareth Davidson'],
  [8, `version: ${PORT_VERSION}`],
  [9, 'This program is free software'],
  [10, 'see LICENSE at'],
  [11, PORT_REPO],
])

/** `EdD_Title` (+Edit.s:15330), the label `Ed_About` runs */
export const PORT_ABOUT_LABEL = 0

/**
 * Label 0 of the editor resource bank's requester script, rewritten.
 *
 * The shipped one is three boxes of Europress's own text and two lines
 * Install.AMOS fills in for the buyer, and every word of it is about a
 * program this is not. Nobody buys this one either. So the label is replaced
 * rather than dressed up, in the language it is already written in --
 * ../runtime/dialog.ts is the Interface interpreter and this runs through it
 * unchanged.
 *
 * What survives from the original is its frame: `SI` then `BA` centres the
 * box, `SA 9` saves the screen under it, `BO 0,0,1,SX,SY` is the outer
 * border, and `RU 3000,15` waits the same way with no button to press. The
 * count line is the shipped `SV 1,1VA# 24ME !`, so it still reads through
 * `Ed_Messages` record 24, " extensions loaded.".
 *
 * Three inner boxes, because the licence notice and the port's own name are
 * different claims and should not run together.
 */
export const PORT_ABOUT_SCRIPT =
  'SV\t1,1VA# 24ME !;' +
  'SI\t448,200;BA\tSWSX- 2/,SH SY- 2/ 16-;SA\t9;BO\t0,0,1,SX,SY;' +
  'BO\t16,8,1,SX16-,46;PO\t0VACX,16,0VA,0,7;PR\t2VACX,32,2VA,7;' +
  'BO\t16,50,1,SX16-,102;PR\t3VACX,58,3VA,3;PR\t5VACX,68,5VA,3;' +
  'PR\t6VACX,78,6VA,3;PR\t7VACX,88,7VA,3;' +
  'BO\t16,106,1,SX16-,170;PR\t8VACX,114,8VA,3;PR\t9VACX,132,9VA,3;' +
  'PR\t10VACX,142,10VA,3;PR\t11VACX,152,11VA,3;' +
  'PR\t1VACX,180,1VA,3;RU\t3000,15;EX;'

/**
 * Menu labels this port replaces, by the `JFonc` number the entry runs.
 *
 * One: `Ed_About` is 150 and the shipped label is " About AMOS Professionnal "
 * -- the author's spelling, kept in `EDM_MESSAGES` where it belongs.
 */
export const PORT_MENU_LABELS: ReadonlyMap<number, string> = new Map([[150, ` About ${PORT_NAME} `]])

/**
 * Menu paths this port does not build, with the branch under each.
 *
 * `8` is Help, and every one of its nineteen entries is a jump into
 * `AMOSPro_Help.AMOS`, which reads `AMOSPro_Help.Map` and `.Txt` -- 318KB of
 * Europress's manual that is not ours to ship and that nobody without an AMOS
 * Pro installation has. The accessory itself answers "Cannot load AMOS
 * Professional help files." and stops, which is a menu of nineteen entries
 * that all do the same nothing. `Ed_GoHelp` (JFonc 183) is untouched: it is a
 * key, not a menu entry, and it still runs whatever the configuration has
 * bound to it.
 */
export const PORT_MENU_HIDDEN: readonly string[] = ['8']
