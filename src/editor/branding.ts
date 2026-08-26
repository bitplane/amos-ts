/**
 * What this port calls itself, where the editor names the program it is.
 *
 * AMOS Professional says "AMOS Professional" in a few places, and in two of
 * them it is answering the question "what am I". This is not that program, so
 * those two answer differently: the About box (`EdD_Title`, requester 0) and
 * the menu entry that opens it.
 *
 * Everywhere else the messages are left exactly as the assembler wrote them.
 * `ED_MESSAGES` is generated evidence and nothing here edits it; these are
 * applied on top, by the two callers that put a message on the screen.
 *
 * The licence the AMOS Professional source was released under adds one
 * condition to bare MIT: "you can do anything you want from it as long as the
 * copyright notice is present in both the modified source code and the boot
 * screen of the application". Messages 21 to 23 are that notice and the
 * escape screen prints them unchanged (`NOTICE`, ../runtime/directscreen.ts),
 * which is this application's boot screen. The About box carries it too, in
 * the second box where "See Latest News" was.
 */
import { VERSION } from '../version'

/** the name, and the version the build was made from ('dev' under vite) */
export const PORT_NAME = 'amos-ts'
export const PORT_VERSION = VERSION
export const PORT_HOME = 'bitplane.net'

/**
 * `Ed_Messages` records the About box shows, replaced.
 *
 * The requester (label 0 of the resource bank's script) composes them:
 *
 *     SV 0,21ME 0VA !     the title, message 21 and then `Ed_About`'s slot 0
 *     PR 22MECX,...       under it, message 22
 *     PR 23MECX,...       and message 23
 *     PO 188MECX,...      the second box, messages 188 and 189
 *     SV 2,219ME 2VA !    "Registered User: " and slot 2
 *     SV 3,220ME 3VA !    "Registration Number: " and slot 3
 *
 * The two registration lines are what Install.AMOS fills in for the buyer.
 * Nobody buys this one, so their labels go empty and `Ed_About` puts nothing
 * in the slots; the requester prints two empty strings and no gap shows.
 */
export const PORT_MESSAGES: ReadonlyMap<number, string> = new Map([
  [21, `${PORT_NAME}: AMOS Professional`],
  [22, 'By François Lionet / Gareth Davidson'],
  [23, `2026 ${PORT_HOME}`],
  [188, `version ${PORT_VERSION}`],
  [189, '© 1992 Europress Software Ltd.'],
  [219, ''],
  [220, ''],
])

/**
 * Menu labels this port replaces, by the `JFonc` number the entry runs.
 *
 * One: `Ed_About` is 150 and the shipped label is " About AMOS Professionnal "
 * -- the author's spelling, kept in `EDM_MESSAGES` where it belongs.
 */
export const PORT_MENU_LABELS: ReadonlyMap<number, string> = new Map([[150, ` About ${PORT_NAME} `]])
