/**
 * EasyLife's own half of MUI — the object registry behind the twenty
 * `Mui ...` keywords.
 *
 * `src/amiga/muimaster.ts` is the library. This is what the extension keeps
 * BESIDE it, and the reason it needs to: MUI knows nothing about AMOS strings.
 * A taglist built in AMOS is full of pointers to strings that AMOS is about to
 * throw away, so EasyLife copies each one into a pool (`Tag Str`, slice 9) and
 * has to remember which object owns which copy, so that disposing the object
 * frees them. That bookkeeping is routines 231, 232, 238 and 241, and none of
 * it exists on MUI's side.
 *
 * ## The node, and the two kinds of key
 *
 * Routine 238 ($335e) keeps a doubly-linked list of 32-byte nodes at `$c2`:
 *
 *     $00 next      $04 prev      $08 KEY       $0c string chain
 *     $10 sibling   $14 firstchild $18 saved Tag Keep  $1c attached
 *
 * The key is usually a MUI object address, but before the object exists it is
 * a negative counter — `$c6`, which `Mui Begin` decrements. So `Tag Str` can
 * attach a string to an object that has not been created yet, and routine 232
 * rewrites the key to the real address once `Mui New` answers. That is the
 * whole trick behind the guide's "binds any strings that have been stored
 * since the last call to Mui Begin to the new object".
 *
 * The lookup rules are routine 238's, in its order:
 *
 *   - a key already in the list is found, whatever `create` says
 *   - `create` (the $ff callers: routine 232, `Mui Make Button`, `Mui Flush`)
 *     makes one unconditionally
 *   - key 0 makes one: that is the temporary node, which `Tag Keep False`
 *     stores into and which routine 241 empties after every `Mui New`
 *   - a key equal to the pending counter makes one
 *   - a key ABOVE the counter — which every real object address is — is
 *     rejected with message 24, because a positive key that is not already
 *     registered is an address MUI never gave out
 *   - a key below the counter falls through and makes one, which is the
 *     `bpl` at $3390 taken the other way
 */
import type { BoopsiObject } from '../amiga/boopsi'

/** one entry in routine 238's list */
export interface MuiNode {
  /** `$08` — a MUI object address, or a negative pending handle */
  key: number
  /** `$0c` — the addresses of the pooled strings this object owns */
  strings: number[]
  /** `$14`/`$10` — children, most recently attached first */
  children: number[]
  /** `$1c` — set once the object has been made someone's child */
  attached: boolean
  /**
   * `$18` — the Tag Keep setting `Mui Begin` saved here.
   *
   * `undefined` means never written, which routine 238's create path leaves
   * it as: it clears `$00`, `$04`, `$0c`, `$10`, `$14` and `$1c` and skips
   * `$18`. See `muiRestoreKeep`.
   */
  savedKeep?: number
}

/** the whole registry, plus the counter and the application object */
export interface MuiRegistry {
  /** `$c2` — the node list */
  nodes: Map<number, MuiNode>
  /** `$c6` — the pending counter, which `Mui Begin` counts DOWN from zero */
  pending: number
  /** `$e8` — the one application object */
  app: BoopsiObject | null
  /** `$cc` — the signal mask MUIM_Application_Input last handed back */
  signals: number
}

export const newMuiRegistry = (): MuiRegistry => ({
  nodes: new Map(),
  pending: 0,
  app: null,
  signals: 0,
})

const node = (key: number): MuiNode => ({ key, strings: [], children: [], attached: false })

/**
 * Routine 238 ($335e) — find the node for `key`, or make one.
 *
 * Answers null where the routine raises message 24, so the caller decides
 * whether that is an error or a "no" — `Mui Flush` and routine 232 pass
 * `create` and can never see it.
 */
export function muiFind(reg: MuiRegistry, key: number, create = false): MuiNode | null {
  const have = reg.nodes.get(key)
  if (have) return have
  if (!create && key !== 0 && key !== reg.pending && key >= reg.pending) return null
  const n = node(key)
  reg.nodes.set(key, n)
  return n
}

/**
 * Routine 232 ($31b6) — hand a freshly created object its pending node.
 *
 * `Mui New` reads the counter, refuses at zero (message 25, "Missing Elmui
 * Begin Instruction"), takes the node keyed by it, rewrites the key to the
 * object's address, restores Tag Keep from the node and counts back up.
 *
 * Answers the restored Tag Keep, or null when the counter was zero.
 */
export function muiAdopt(reg: MuiRegistry, obj: number): number | null {
  if (reg.pending === 0) return null
  const n = muiFind(reg, reg.pending, true)!
  reg.nodes.delete(n.key)
  n.key = obj
  reg.nodes.set(obj, n)
  reg.pending++
  return muiRestoreKeep(n)
}

/**
 * `$18` read back, and the DEFECT in reading it.
 *
 * DEFECT: routine 232 restores Tag Keep from a field routine 238's create
 * path never writes. `Mui Begin` saves into the node keyed by the counter
 * BEFORE decrementing, and `Mui New` reads the node keyed by the counter
 * AFTER all the decrementing, so the two are one apart and only line up for
 * the outer objects of a nest:
 *
 *     Mui Begin True     counter 0  -> node(0).$18 = old keep, counter = -1
 *     S$=Tag Str$(...)              -> node(-1) created, $18 UNWRITTEN
 *     OBJ=Mui New(...)   counter -1 -> reads node(-1).$18
 *
 * so the guide's "Mui New restores the previous objects Tag Keep setting"
 * holds for the second and later News of a nest and not for the first. On the
 * machine the value is whatever routine 239's pool block held, since AllocMem
 * is called without MEMF_CLEAR; the pool here is zero-filled, so an unwritten
 * `$18` reads as 0 — `Tag Keep False`, which is also the extension's initial
 * setting and therefore the least surprising of the possible answers.
 */
export function muiRestoreKeep(n: MuiNode): number {
  return n.savedKeep ?? 0
}

/**
 * Routine 241 ($34fe) — free a node, its subtree and all their strings.
 *
 * Depth first over `$14`/`$10`, and each node's `$c` chain goes back to the
 * pool on the way. Called with 0 after every `Mui New`, `Mui Do` and `Mui
 * Notify` to empty the temporary node, and with an object by `Mui Dispose`.
 *
 * Answers every string address it freed, so the caller can drop them from the
 * pool's own record.
 */
export function muiFree(reg: MuiRegistry, key: number): number[] {
  const freed: number[] = []
  const walk = (k: number): void => {
    const n = reg.nodes.get(k)
    if (!n) return
    reg.nodes.delete(k)
    for (const c of n.children) walk(c)
    freed.push(...n.strings)
  }
  walk(key)
  return freed
}

/**
 * Routines 235, 236 and 237 — make CHILD a child of PARENT, or unmake it.
 *
 * The parent's list is front-inserted (`move.l $14(a1),$10(a2)` then
 * `move.l a2,$14(a1)`), and `$1c` is the guard: `Tag Attach$` and `Mui Add`
 * both refuse an object that is already attached, with Illegal Function Call.
 * `Mui Remove` clears it again, which is the guide's "you can add it to
 * another part of the application tree to 'move' the object".
 */
export function muiAttach(parent: MuiNode, child: MuiNode): boolean {
  if (child.attached) return false
  child.attached = true
  parent.children.unshift(child.key)
  return true
}

/** Routine 237 ($32e0) — unlink, and refuse if it was not there */
export function muiDetach(parent: MuiNode, child: MuiNode): boolean {
  const i = parent.children.indexOf(child.key)
  if (i < 0) return false
  parent.children.splice(i, 1)
  child.attached = false
  return true
}
