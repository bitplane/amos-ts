/**
 * TURBO Plus — a large graphics and system extension by Manuel Andre.
 *
 * The most used unimplemented extension in the corpus: 136 programs across
 * its three builds. Those builds are one lineage rather than three
 * extensions — 1.0's 134 keywords are a strict subset of 2.15's, and 1.9
 * shares 83 of its 87 with 1.0 — and the 2.15 manual says as much, calling
 * itself "a patched-up version of TURBO V1.0". So one set of handlers serves
 * all three, while the coverage manifest keeps them separate because 1.9 has
 * four keywords the others lack.
 *
 * ## Evidence
 *
 * `TURBO_DocsV2.15.Asc`, the extension's own manual, documents 128 of its
 * 152 keywords — and, measured against the corpus, 62 of the 63 keywords
 * programs actually call. Where the manual is thin the routine is read out
 * of the binary with `extdis`; those cases say so individually.
 *
 * ## What TURBO was for
 *
 * Speed, on a machine where AMOS's own drawing was too slow for a game. Many
 * keywords are faster replacements for core ones (`F Plot` for `Plot`), and
 * several exist purely to work around AMOS 1.3's `Multi No`, which disabled
 * the keyboard and mouse outright — `Left Click` and `Raw Key` are there so
 * a program could still read input with multitasking off. Under AMOS Pro
 * that stopped being necessary, and the manual says so, but programs kept
 * using them for compatibility.
 */
import { AmosError, VI, int, type Value } from '../interp/values'
import type { Func, Instr } from '../interp/builtins'
import type { Runtime } from './runtime'

/** a TURBO Check zone: its own rectangle system, not AMOS's */
export interface CheckZone {
  x1: number
  y1: number
  x2: number
  y2: number
  set: boolean
}

export interface TurboState {
  /**
   * Check zones, TURBO's replacement for AMOS's Zone commands. "These
   * commands are not compatible with the normal Zone commands!"
   */
  checks: CheckZone[]
  /**
   * The task priority Multi No / Multi Yes / Amos Pri set. There is no
   * scheduler here to apply it to; it is kept so a program that reads it
   * back sees what it wrote.
   */
  priority: number
}

export const newTurboState = (): TurboState => ({ checks: [], priority: 0 })

/** `Check`, `Hit Bob Check` and `Hit Spr Check` all share this scan */
function checkHit(rt: Runtime, from: number, to: number, x: number, y: number): number {
  const zones = rt.turbo.checks
  const lo = Math.max(0, Math.min(from, to))
  const hi = Math.min(zones.length - 1, Math.max(from, to))
  for (let i = lo; i <= hi; i++) {
    const z = zones[i]
    if (!z?.set) continue
    if (x >= z.x1 && x <= z.x2 && y >= z.y1 && y <= z.y2) return 1
  }
  return 0
}

export function makeTurboInstructions(rt: Runtime): Record<string, Instr> {
  return {
    'multi yes'() {
      // "Sets the priority to normal (0). Normal multitasking takes place."
      // SetTaskPri(FindTask(NULL), 0) in the binary.
      rt.turbo.priority = 0
    },
    'multi no'() {
      // The routine is exactly SetTaskPri(FindTask(NULL), 20) — exec
      // FindTask (-$126) then SetTaskPri (-$12c), with 20 in d0 — which is
      // what the manual describes: "Under AMOS Pro, Multi No sets the
      // priority of AMOS Pro to 20, blocking most tasks, but not blocking
      // the VITAL task."
      rt.turbo.priority = 20
    },
    'amos pri'(it) {
      // "Set the priority of AMOS. Value ranges from -128 to 20"
      rt.turbo.priority = Math.max(-128, Math.min(20, it.evalInt()))
    },
    'workbench open'() {
      // The counterpart to AMOS's Close Workbench, which this port already
      // treats as faithful because there is no Workbench memory to free.
      // Reopening it is the same nothing in reverse.
    },
    'vbl wait'(it) {
      // Vbl Wait x — "Wait until the raster beam has reached a given value".
      // The routine is a four-instruction busy-wait on the low byte of
      // VHPOSR: move.b $dff006,d1 / cmp.b d0,d1 / bne. Sub-frame beam racing
      // has no meaning against a compositor that draws once per frame, so
      // this waits a frame like Wait Vbl does; see the NOTES entry.
      const line = it.evalInt()
      void line
      it.block({ type: 'wait', until: Math.floor(it.tick) + 1 })
    },
    'reserve check'(it) {
      // "Reserves x check ZONES for TURBO zone (CHECK) routines. Execute
      // this command before Setting any Check zones."
      const n = it.evalInt()
      if (n < 0) throw new AmosError('Illegal function call')
      rt.turbo.checks = Array.from({ length: n }, () => ({ x1: 0, y1: 0, x2: 0, y2: 0, set: false }))
    },
    'check erase'() {
      // "releases the memory used by Reserve Check and erases all
      // definitions. You must Reserve more Check zones before Setting any
      // after this command."
      rt.turbo.checks = []
    },
    'reset check'(it) {
      // "Erases a Check zone's definition. You must give the zone number."
      const z = rt.turbo.checks[it.evalInt()]
      if (z) z.set = false
    },
    'set check'(it) {
      // Set Check z,x1,y1 To x2,y2 — "Does the same thing as the Set Zone
      // command."
      const n = it.evalInt()
      it.expect(',')
      const x1 = it.evalInt()
      it.expect(',')
      const y1 = it.evalInt()
      it.expect('to')
      const x2 = it.evalInt()
      it.expect(',')
      const y2 = it.evalInt()
      const z = rt.turbo.checks[n]
      if (!z) throw new AmosError('Illegal function call')
      z.x1 = Math.min(x1, x2)
      z.y1 = Math.min(y1, y2)
      z.x2 = Math.max(x1, x2)
      z.y2 = Math.max(y1, y2)
      z.set = true
    },
  }
}

export function makeTurboFunctions(rt: Runtime): Record<string, Func> {
  return {
    'left click'(_) {
      // Eight instructions in the binary: btst.b #6,$bfe001 — CIA-A port A
      // bit 6, the left mouse button — then -1 if clear (pressed) and 0 if
      // set. "Returns TRUE if left mouse is pressed."
      return VI(rt.input.mouseK & 1 ? -1 : 0)
    },
    'right click'(_) {
      // "See Left Click function, but then for right mousebutton."
      return VI(rt.input.mouseK & 2 ? -1 : 0)
    },
    'raw key'(_, a) {
      // x=Raw Key(n) — "Does the same thing as the Key State function but
      // works even if multitasking is disabled. Returns true (-1) if key N
      // is being pressed. N is the Scancode." The real routine reads CIA-A's
      // keyboard serial register directly, which is how it survives Multi
      // No; here the key state is the same state Key State reads, and there
      // is no multitasking to survive.
      return VI(rt.input.keys.has(int(a[0] ?? VI(0)) & 0xff) ? -1 : 0)
    },
    'is raw key'(_) {
      // "Returns the last key press in raw format. Beware! It gives
      // different values if the key is pressed or released." The raw code
      // differs by the release bit, bit 7, which a key-up sets.
      return VI(rt.input.lastScan)
    },
    check(_, a) {
      // x=Check(start To end,x,y) — "Returns 1 is the result is true, 0 if
      // not." Note 1, not AMOS's -1.
      return VI(checkHit(rt, int(a[0] ?? VI(0)), int(a[1] ?? VI(0)), int(a[2] ?? VI(0)), int(a[3] ?? VI(0))))
    },
    'hit bob check'(_, a) {
      // x=Hit Bob Check(start To end,dx,dy,n) — "dx and dy are optional and
      // give a displacement in opposite to the bob's hot spot"
      const [s, e, dx, dy, n] = [0, 1, 2, 3, 4].map((i) => int(a[i] ?? VI(0)))
      const bob = rt.bobs.get(n!)
      if (!bob) return VI(0)
      return VI(checkHit(rt, s!, e!, bob.x - dx!, bob.y - dy!))
    },
    'hit spr check'(_, a) {
      // x=Hit Spr Check(start To end,dx,dy,n) — as above, for a sprite, and
      // the manual gives the displacement the other way round
      const [s, e, dx, dy, n] = [0, 1, 2, 3, 4].map((i) => int(a[i] ?? VI(0)))
      const spr = rt.hwSprites.get(n!)
      if (!spr) return VI(0)
      return VI(checkHit(rt, s!, e!, spr.x + dx!, spr.y + dy!))
    },
  } as Record<string, Func>
}

export type { Value }
