/**
 * MAXS Door Handler 0.20 — Ari Tsironis's twenty-one keywords for writing a
 * door for MAX's BBS in AMOS, at slot 16.
 *
 * A "door" is a program the BBS launches for a caller: it talks to the user
 * through the BBS rather than through the screen, so that whatever it prints
 * goes down the modem and whatever it reads comes back up. All twenty-one
 * keywords are one mechanism — fill a 106-byte `DoorMsg`, `PutMsg` it to the
 * BBS's public port, wait for the reply, read two words back out.
 *
 * ## Evidence
 *
 * SOURCE tier. `_MAXSDoorHandler.s` is 46,126 bytes of the author's own
 * commented assembler and ships in the archive beside the library, which
 * makes this the second extension in the corpus to arrive that way after
 * Explode. Its own equates open the file: `ExtNb equ 16-1` and
 * `MsgLength equ 106`.
 *
 * ONE CAUTION, AND IT APPLIES TO EVERY CITATION BELOW. The source is dated
 * 3 January 1995 and the library 29 May 1994, eight months earlier. They are
 * not guaranteed to be the same build, so the token table was checked against
 * the listing before a line of it was treated as a statement about the
 * binary: 21 named entries, same ids, same specs, same order. Where the two
 * ever disagree the binary is what programs ran against.
 *
 * Citations here are source LABELS (`L8`, `L16_NoPort`) rather than
 * addresses, because the source is the evidence and the labels are what it
 * names. The routine numbers are the token table's.
 *
 * ## The protocol, which is the whole extension
 *
 * `MsgLength equ 106` and the structure is laid out field by field at `MB:`.
 * Twenty bytes of exec `Message` — a `Node`, then `mn_ReplyPort` and
 * `mn_Length` — then three words and a string:
 *
 *     +$14  Command   what to do, and on the way back the carrier state
 *     +$16  Data      the argument, and on the way back the answer
 *     +$18  String    80 bytes, NUL-terminated
 *     +$68  Carrier
 *
 * The reply overwrites `Command` with the carrier state, so every keyword
 * returns the same thing: whether the caller is still connected. **20 means
 * the carrier dropped**, which is why the five keywords that have their own
 * answer to give (`M_CheckFile`, `M_EditFile`, `M_GetUserNum`, `M_GetKey`)
 * test for it before reading `Data`.
 *
 * The command numbers are the author's, in the order he wrote them: 1
 * SendMessage, 2 LocalMessage, 3 PutModemChar, 4 PutScreenChar, 5
 * PutDoorChar, 6 Prompt, 7 SPrompt, 8 HotKey, 9 TwitUser, 10 ShowFile, 11
 * CheckFile, 12 EditFile, 13 GetSNum, 14 GetSVar, 15 NewAccess, 20 End, 21
 * NewTime, 200 ChangeUserInt, 201 GetKey. `M_DoFunction` sends `FUNC + 100`,
 * so 100 upward is MAX's own function table reached straight through.
 *
 * ## Without a BBS
 *
 * `M_PortOpen(node)` builds the name `DoorControlN` by writing the node
 * digit over offset 11 of `"DoorControl",0,0` (`L1`) and calls `FindPort`.
 * Nothing on this machine publishes that port unless a host supplies one
 * (`Host.ports`, ../amiga/host.ts), so the answer is normally zero.
 *
 * THAT IS THE ROUTINE'S OWN ANSWER, not a stub, and it is the reason this
 * extension could be ported before anything stands behind it — the same
 * argument ../amiga/process.ts makes for `Execute`. Every one of the other
 * twenty keywords tests `MAXDoorPort` for zero and returns zero WITHOUT
 * sending, so a door run on a machine where MAX's is not running behaves
 * exactly as it does here, all the way down to which keywords still write
 * their string into the message first.
 *
 * ## Two the author shipped and one he did not mean
 *
 * `M_GetUserStr(TYPE, USER$)` is `cmpi.w #40,d4 / ble.s L16_NoPort` — it
 * REFUSES a string of 40 characters or fewer and answers 0. The comment
 * above it reads `IF LENGTH OF USER$ <= 40`, so the guard is doing what he
 * wrote; what it means is that the keyword only works when handed a string
 * longer than the 40 bytes MAX's will write into it, which is backwards from
 * every other length check in the file. DEFECT, reproduced.
 *
 * `M_DoFunction` is the one string copy with NO length cap (`L19_StrLoop`
 * has no `cmpi.w #78,d0`), so a path longer than 79 characters runs off the
 * end of the 80-byte `String` field and over `Carrier`. DEFECT, reproduced
 * as far as the message goes: the copy is bounded by the 106 bytes here
 * rather than by nothing, because there is no memory after them to reach.
 */
import type { Func, Instr } from '../interp/builtins'
import type { Runtime } from './runtime'
import type { PortHandle } from '../amiga/host'
import { VI, int, str } from '../interp/values'

/** `MsgLength equ 106` */
export const DOOR_MSG_LENGTH = 106
/** the `DoorMsg` fields, off the `ds` run at `MB:` */
export const DOOR_COMMAND = 0x14
export const DOOR_DATA = 0x16
export const DOOR_STRING = 0x18
export const DOOR_STRING_MAX = 80
export const DOOR_CARRIER = 0x68
/** `MAXDoorName dc.b "DoorControl",0,0`, with the node digit written at 11 */
export const DOOR_PORT_NAME = 'DoorControl'
/** the carrier state a reply carries when the caller hung up */
export const CARRIER_DROPPED = 20

export interface MaxsDoorState {
  /** the 106 bytes themselves, sent and replied into */
  msg: Uint8Array
  /** `MAXDoorPort` — what `FindPort` returned, or null */
  door: PortHandle | null
  /** `MyReplyPort` — `CreatePort(NULL,NULL)`, which cannot fail here */
  reply: boolean
  /** the name `M_PortOpen` looked up, kept so a test can read it back */
  name: string
}

export function newMaxsDoorState(): MaxsDoorState {
  return { msg: new Uint8Array(DOOR_MSG_LENGTH), door: null, reply: false, name: '' }
}

export function makeMaxsDoorFunctions(rt: Runtime): Record<string, Func> {
  const st = (): MaxsDoorState => rt.maxsDoor

  const w = (off: number, v: number): void => {
    const s = st()
    s.msg[off] = (v >> 8) & 0xff
    s.msg[off + 1] = v & 0xff
  }
  const r = (off: number): number => {
    const s = st()
    return ((s.msg[off]! << 8) | s.msg[off + 1]!) & 0xffff
  }

  /**
   * `L3_StrLoop` and eleven more like it, which are the same nine
   * instructions every time: copy the AMOS string into `String`, capped so
   * that at most 79 characters go in, then a NUL.
   *
   * The cap is written as `subq.w #1,d0 / cmpi.w #78,d0 / ble` — on the
   * length MINUS ONE, so 79 characters pass and the 80th byte is the
   * terminator. An empty string makes d0 negative and `dbra` then runs 65,536
   * times on the machine; here the loop simply copies nothing, which is the
   * one place this cannot follow and the reason it is written down.
   */
  const putString = (text: string, cap = 78): void => {
    const s = st()
    s.msg.fill(0, DOOR_STRING, DOOR_STRING + DOOR_STRING_MAX)
    const n = Math.min(text.length - 1, cap)
    for (let i = 0; i <= n && DOOR_STRING + i < DOOR_MSG_LENGTH; i++) {
      s.msg[DOOR_STRING + i] = text.charCodeAt(i) & 0xff
    }
  }

  /** `String` back out as an AMOS string of exactly `len` bytes (`L8_InpLoop`) */
  const getString = (len: number): string => {
    const s = st()
    let out = ''
    for (let i = 0; i < len; i++) out += String.fromCharCode(s.msg[DOOR_STRING + i] ?? 0)
    return out
  }

  /**
   * The `SendDoorMsg` macro: `PutMsg(MAXDoorPort, DoorMsg)`, then
   * `WaitPort(MyReplyPort)` and `GetMsg(MyReplyPort)`.
   *
   * False when `MAXDoorPort` is zero, which is the `beq.s Ln_NoPort` every
   * routine takes and the reason they all answer 0 with no BBS attached.
   */
  const send = (): boolean => {
    const s = st()
    if (!s.door) return false
    s.door.send(s.msg)
    return true
  }

  /** what a routine returns after a send: the reply's carrier state */
  const carrier = (): number => r(DOOR_COMMAND)

  /** the four that answer with `Data` unless the carrier dropped */
  const dataUnlessDropped = (): number => {
    const c = carrier()
    return c === CARRIER_DROPPED ? c : r(DOOR_DATA)
  }

  /** every keyword but M_PortOpen and M_PortClose: set up, send, or answer 0 */
  const round = (command: number, data: number, after?: () => number): number => {
    w(DOOR_DATA, data)
    w(DOOR_COMMAND, command)
    if (!send()) return 0
    return after ? after() : carrier()
  }

  return {
    /**
     * =M_Portopen(node) — routine 1 (`L1`).
     *
     * Clears the 106 bytes and both port pointers, turns the node number into
     * a digit with `add.l #48,d0` and writes it at offset 11 of
     * `"DoorControl"`, then `Forbid / FindPort / Permit`. On success it
     * creates its own reply port and fills in the three exec fields the BBS
     * needs to answer: `ReplyPort`, `Type = NT_MESSAGE` and
     * `Length = MsgLength`.
     *
     * The return is `d0` wherever it left off, so 0 means either FindPort
     * found nothing or CreatePort failed, and a non-zero return is the reply
     * port's address. Nothing distinguishes the two failures, which is the
     * author's `beq.s L1_InitError` from two different places.
     *
     * The digit is written with no range check: `M_Portopen(10)` makes the
     * name `DoorControl:` and `M_Portopen(-1)` makes `DoorControl/`. Both are
     * legal names and both simply fail to find a port.
     */
    'm_portopen': (_, a) => {
      const s = st()
      s.msg.fill(0)
      s.door = null
      s.reply = false
      const node = int(a[0]!)
      s.name = DOOR_PORT_NAME + String.fromCharCode((node + 48) & 0xff)
      const found = rt.host.ports?.find?.(s.name)
      if (!found) return VI(0)
      s.door = found
      s.reply = true
      // NT_MESSAGE is 5 (exec/nodes.i), at the Node's ln_Type byte
      s.msg[0x08] = 5
      w(0x12, DOOR_MSG_LENGTH)
      // the reply port's address, which is the value the routine leaves in
      // d0. There are no addresses for exec structures here, so this is the
      // truth a program tests -- non-zero means the port opened
      return VI(-1)
    },

    /**
     * M_Portclose — routine 2 (`L2`), the only instruction in the set.
     *
     * `Command = 20`, End, with `Data = 0`. It sends only if the door port
     * was found, then deletes its reply port whether or not it was — the two
     * are separate tests, `L2_TryReply` and `L2_NoPort`, so a failed
     * `M_Portopen` followed by `M_Portclose` is clean rather than a leak.
     */
    'm_portclose': () => {
      const s = st()
      w(DOOR_DATA, 0)
      w(DOOR_COMMAND, 20)
      send()
      s.door = null
      s.reply = false
      return VI(0)
    },

    /** =M_Bbstext(text$) — routine 3 (`L3`), command 1: to the modem AND the screen, `Data = 0` for no carriage return */
    'm_bbstext': (_, a) => {
      putString(str(a[0]!))
      return VI(round(1, 0))
    },

    /** =M_Localtext(text$) — routine 4 (`L4`), command 2: the sysop's screen only */
    'm_localtext': (_, a) => {
      putString(str(a[0]!))
      return VI(round(2, 0))
    },

    /** =M_Modemchar(char) — routine 5 (`L5`), command 3 */
    'm_modemchar': (_, a) => VI(round(3, int(a[0]!) & 0xffff)),
    /** =M_Screenchar(char) — routine 6 (`L6`), command 4 */
    'm_screenchar': (_, a) => VI(round(4, int(a[0]!) & 0xffff)),
    /** =M_Bbschar(char) — routine 7 (`L7`), command 5: both at once */
    'm_bbschar': (_, a) => VI(round(5, int(a[0]!) & 0xffff)),

    /**
     * =M_Prompttext(text$, input$) — routine 8 (`L8`), command 6, and
     * =M_Sprompttext — routine 9 (`L9`), command 7, which is the same
     * routine with the command changed. The S is for silent: MAX's echoes
     * nothing, which is how a door asks for a password.
     *
     * `Data` is the length of `input$` capped at 79 (`cmpi.w #79,d4`), and
     * that length is what MAX's is allowed to write back. The reply is copied
     * into `input$` for exactly that many bytes with a `dbra`, so the AMOS
     * string keeps its length and gets NUL-padded rather than truncated —
     * a door sizes its input by pre-filling `input$ = Space$(20)`.
     *
     * APPROXIMATED, and this is the deviation the whole port turns on. The
     * reply comes back by writing over the CALLER'S VARIABLE — AMOS hands
     * the extension a pointer to the string descriptor on the `(a3)` stack
     * and `L8_InpLoop` copies into it — and a `Func` here receives values,
     * not references, so `input$` is unchanged. The token spec is `02,2`, an
     * integer result, so the return is the carrier state on both machines and
     * only the variable differs. The four keywords that write back
     * (`M_Prompttext`, `M_Sprompttext`, `M_Getchar`, `M_Getuserstr`) keep the
     * reply in `rt.maxsDoor.msg` where a test reads it; closing it wants a
     * raw function that parses its own second argument with `parseTarget`,
     * which is a mechanism no ExtensionImpl has yet.
     */
    'm_prompttext': (_, a) => {
      const len = Math.min(str(a[1]!).length, 79)
      putString(str(a[0]!))
      w(DOOR_DATA, len)
      w(DOOR_COMMAND, 6)
      if (!send()) return VI(0)
      void getString(len)
      return VI(carrier())
    },
    'm_sprompttext': (_, a) => {
      const len = Math.min(str(a[1]!).length, 79)
      putString(str(a[0]!))
      w(DOOR_DATA, len)
      w(DOOR_COMMAND, 7)
      if (!send()) return VI(0)
      void getString(len)
      return VI(carrier())
    },

    /**
     * =M_Getchar(text$, char$) — routine 10 (`L10`), command 8, HotKey:
     * prints the prompt and waits for one of the characters in `char$`.
     *
     * The copy back is `dbne` rather than `dbra` (`L10_InpLoop`), so it stops
     * at the first NUL as well as at the length — the only one of the three
     * that does.
     *
     * It never sets `Data`, so MAX's is handed whatever the last keyword
     * left there. That is the author's, not an omission here.
     */
    'm_getchar': (_, a) => {
      const len = str(a[1]!).length
      putString(str(a[0]!))
      w(DOOR_COMMAND, 8)
      if (!send()) return VI(0)
      void len
      return VI(carrier())
    },

    /** =M_Twituser — routine 11 (`L11`), command 9. No arguments, no `Data`: the BBS decides what happens to a twit */
    'm_twituser': () => {
      w(DOOR_COMMAND, 9)
      return VI(send() ? carrier() : 0)
    },

    /** =M_Showfile(file$) — routine 12 (`L12`), command 10: MAX's displays an ASCII or ANSI file down the line */
    'm_showfile': (_, a) => {
      putString(str(a[0]!))
      w(DOOR_COMMAND, 10)
      return VI(send() ? carrier() : 0)
    },

    /** =M_Checkfile(file$) — routine 13 (`L13`), command 11 with `Data = 1`; answers the file status unless the carrier dropped */
    'm_checkfile': (_, a) => {
      putString(str(a[0]!))
      return VI(round(11, 1, dataUnlessDropped))
    },

    /** =M_Editfile(file$) — routine 14 (`L14`), command 12 with `Data = 99`, the line limit the author fixed */
    'm_editfile': (_, a) => {
      putString(str(a[0]!))
      return VI(round(12, 99, dataUnlessDropped))
    },

    /** =M_Getusernum(type) — routine 15 (`L15`), command 13, GetSNum: one number out of the caller's record */
    'm_getusernum': (_, a) => VI(round(13, int(a[0]!) & 0xffff, dataUnlessDropped)),

    /**
     * =M_Getuserstr(type, user$) — routine 16 (`L16`), command 14, GetSVar.
     *
     * DEFECT: it is in the source in the author's own hand.
     *
     *     move.w   (a4)+,d4                 ; LENGTH OF USER$
     *     cmpi.w   #40,d4
     *     ble.s    L16_NoPort               ; IF LENGTH OF USER$ <= 40
     *
     * `ble` to the EXIT, so a string of 40 characters or fewer answers 0 and
     * never sends. Every other length check in the file clamps; this one
     * refuses, and it refuses the case the comment describes.
     */
    'm_getuserstr': (_, a) => {
      const len = str(a[1]!).length
      if (len <= 40) return VI(0)
      w(DOOR_DATA, int(a[0]!) & 0xffff)
      w(DOOR_COMMAND, 14)
      if (!send()) return VI(0)
      void getString(len)
      return VI(carrier())
    },

    /** =M_Newaccess(access) — routine 17 (`L17`), command 15 */
    'm_newaccess': (_, a) => VI(round(15, int(a[0]!) & 0xffff)),
    /** =M_Addtime(minutes) — routine 18 (`L18`), command 21, NewTime */
    'm_addtime': (_, a) => VI(round(21, int(a[0]!) & 0xffff)),

    /**
     * =M_Dofunction(func, extra, path$) — routine 19 (`L19`), command
     * `func + 100`: MAX's own function table, reached straight through.
     *
     * DEFECT: `L19_StrLoop` is the one string copy with no `cmpi.w #78,d0`
     * before it, so a path of more than 79 characters walks off `String` and
     * over `Carrier` and whatever follows. Bounded here by the 106 bytes,
     * because there is nothing after them to reach.
     */
    'm_dofunction': (_, a) => {
      putString(str(a[2]!), DOOR_MSG_LENGTH)
      return VI(round((int(a[0]!) + 100) & 0xffff, int(a[1]!) & 0xffff))
    },

    /**
     * =M_Changeuserdata(type, data) — routine 20 (`L20`), command 200.
     *
     * The odd one: `data` is a LONG written into the first four bytes of
     * `String` (`move.l d0,(a0)`) rather than into `Data`, which takes the
     * type instead. So the field that carries a number everywhere else
     * carries the selector here.
     */
    'm_changeuserdata': (_, a) => {
      const s = st()
      const data = int(a[1]!) | 0
      s.msg[DOOR_STRING] = (data >>> 24) & 0xff
      s.msg[DOOR_STRING + 1] = (data >>> 16) & 0xff
      s.msg[DOOR_STRING + 2] = (data >>> 8) & 0xff
      s.msg[DOOR_STRING + 3] = data & 0xff
      return VI(round(200, int(a[0]!) & 0xffff))
    },

    /**
     * =M_Getkey — routine 21 (`L21`), command 201: a keypress without waiting
     * for a return.
     *
     * The answer is packed rather than plain, and the author drew it:
     * `RETURN 0xRXXXXXKK  KK = KEY`. `Data` comes back 1 for a remote press
     * and 0 for a local one, and `lsl.l #31` puts that bit at the top; the
     * character itself is the first byte of `String`, ORed in at the bottom.
     * So a remote 'A' is $80000041 and a local one is $41.
     *
     * A dropped carrier returns 20 before any of that, as everywhere else.
     */
    'm_getkey': () => {
      w(DOOR_COMMAND, 201)
      if (!send()) return VI(0)
      const c = carrier()
      if (c === CARRIER_DROPPED) return VI(c)
      const remote = (r(DOOR_DATA) << 31) >>> 0
      return VI((remote | st().msg[DOOR_STRING]!) | 0)
    },
  }
}

export function makeMaxsDoorInstructions(rt: Runtime): Record<string, Instr> {
  const funcs = makeMaxsDoorFunctions(rt)
  return {
    /**
     * `M_Portclose` is the table's one INSTRUCTION — spec `I`, no arguments
     * and no result — where the other twenty are functions. It reaches the
     * same routine either way.
     */
    'm_portclose'() {
      funcs['m_portclose']!(rt.interp, [])
    },
  }
}
