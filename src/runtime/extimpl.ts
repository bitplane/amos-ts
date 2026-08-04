/**
 * What it means to have ported an extension.
 *
 * The registry (../ext/registry.ts) says what an extension IS, keyed by
 * identity — "personal-1.0b", "turbo-plus-2.15" — and identify.ts works out
 * which identity a program's slot numbers referred to. Until now that identity
 * stopped there: extensionTablesFor handed the Runtime a slot -> TokenTable
 * map, dispatch keyed everything by NAME, and the ports were listed as free
 * text ('personnal', 'music-speech', 'ctext-1.32') that matched no registry id
 * and nothing checked.
 *
 * That cost two things. A port could not say which release it is a port OF, so
 * nothing could tell whether the table we identify and the behaviour we
 * implement are the same version. And a port needing a slot-qualified keyword
 * had to guess its own slots: Personnal derived them with an id regex over the
 * registry plus a hardcoded floor of 13, which means `ext13:sprite col` was
 * registered whether or not slot 13 held Personnal — so a program with a
 * DIFFERENT extension at 13 that happens to name a keyword `Sprite Col` got
 * Personnal's implementation of it.
 *
 * So a port declares the identities it serves, and slot-qualified keywords are
 * bound to the slots where one of those identities was actually identified.
 */
import type { Extension } from '../ext/registry'
import { allExtensions } from '../ext/registry'
import type { Func, Instr } from '../interp/builtins'
import type { Runtime } from './runtime'

export interface ExtensionImpl {
  /**
   * The registry identities this port implements. Every one must exist in the
   * registry (extimpl.test.ts), which is what keeps them from drifting back
   * into labels. More than one where releases share a table and we implement
   * the shared part — the two Personnal releases, the three TURBOs.
   */
  readonly ids: readonly string[]
  instructions?: (rt: Runtime) => Record<string, Instr>
  functions?: (rt: Runtime) => Record<string, Func>
  /**
   * Build this extension's state, as it is the moment the library loads.
   *
   * Called once when the Runtime is built — which is what a port's state
   * FIELD used to do, `amcaf: AmcafState = newAmcafState()` and fifteen more
   * like it on the Runtime. Uniform, but owned by the wrong object and
   * impossible to run twice, and both of those are the same problem: an
   * extension's startup was not something a port could declare, so nothing
   * could ask for it again.
   *
   * AMCAF's Extreinit asks for exactly that. It is `init` and not `defaults`
   * because the two are different sizes: TURBO's default routine puts back
   * two settings, where its init builds the whole TurboState.
   *
   * NOTE: AMOS's own shape for this is subscriber LISTS rather than one
   * routine per extension — `Sys_ClearRoutines`, `Sys_DefaultRoutines` and
   * `Sys_ErrorRoutines` (+Equ.s:1215, :1242-3), joined with `AddRoutine`
   * (SyCall 98) and walked with `CallRoutines` (99); one subsystem may sit in
   * all three, as the menus do at +Lib.s:17355. Only the default list has a
   * caller here, so only it is modelled, and this init has no AMOS list
   * behind it at all — it is where the port's own construction lives.
   */
  init?: (rt: Runtime) => void
  /**
   * Put this extension's own settings back to what they are at boot.
   *
   * Every extension slot holds three pointers on the machine (`$f8(a5)`, 16
   * bytes each): its base, a DEFAULT routine at +$4 and a REMOVE routine at
   * +$8. `Default` (InDefault +Lib.s:8710) calls the +$4 of every occupied
   * slot after it reopens screen 0, which is how TURBO's Scene Icon Bank and
   * Scene Mask Palette go back to their boot values without the core knowing
   * either keyword exists.
   *
   * Declared here rather than called by name because it had been discovered
   * twice: `default()` imported `turboDefault` and `personnalDefault` and
   * invoked them directly, so a port that needed the hook had to edit the
   * core to get it, and AMCAF's `Extdefault` — which is the SAME +$4 pointer,
   * reached by slot instead of all at once — had no way to ask for it at all.
   */
  defaults?: (rt: Runtime) => void
  /**
   * Keywords this port must answer for under a slot-qualified key rather than
   * its plain name, because another layer owns the plain one (see
   * interp/names.ts:qualified). Declared by plain name here and rewritten to
   * `ext<slot>:<name>` per bound slot, so the port itself never spells a slot.
   */
  readonly qualified?: readonly string[]
  /**
   * Keyword names one RELEASE spells differently, per identity.
   *
   * A port serves several identities of one product, and they do not always
   * agree on what the keywords are called. JD's printer companion renamed
   * every one of its 58 keywords between 1.1 and 1.3 — `Prt Bold` became
   * `Jd Prt Bold` — so the two tables share not a single name, and a port
   * written against either answers nothing at all for the other. Silently:
   * dispatch is by name, a name nothing registered is simply unimplemented,
   * and an unimplemented function hands back a type-correct default rather
   * than complaining.
   *
   * So the port implements ONE set of names — whichever release it was
   * written from — and declares here what the other releases call them. Keyed
   * by identity, because the answer differs per release, and mapping the
   * table's spelling to the handler's:
   *
   *     aliases: { 'jd-prt-1.1': { 'prt bold': 'jd prt bold', ... } }
   *
   * Each alias is bound to the slots where that identity was actually
   * identified, exactly as `qualified` is, and for the same reason: `prt bold`
   * belongs to Prt 1.1 at the slot Prt 1.1 sits in, and registering it as a
   * plain name would hand it to whatever else spells a keyword that way.
   *
   * An alias whose target has no handler is skipped, so a port may list a
   * whole release's vocabulary without implementing all of it.
   */
  readonly aliases?: Readonly<Record<string, Readonly<Record<string, string>>>>
  /**
   * The extension's own error table, indexed the way its library indexes it.
   * A declaration point, not a mechanism: each port still raises its own
   * errors, but "which messages can this extension produce" is answerable from
   * the identity now instead of by knowing which module to open.
   */
  readonly errors?: readonly string[]
}

/** How a port is named in collision reports and coverage — its first identity. */
export function implLabel(impl: ExtensionImpl): string {
  return impl.ids[0] ?? 'unidentified'
}

/**
 * The slots a port's qualified keywords should answer on.
 *
 * With bindings — a real program load, where identify.ts has said what sits
 * where — it is exactly the slots holding one of the port's identities, and
 * nothing else. Without them (a Runtime built from a source listing, or a test
 * that passes token tables only) identity is unknown, so it falls back to every
 * slot the registry has recorded for those identities: their default and
 * everywhere they have been observed.
 */
export function implSlots(
  impl: ExtensionImpl,
  bound: ReadonlyMap<number, Extension> | null | undefined,
): number[] {
  return slotsForIds(impl.ids, bound)
}

/**
 * Which port sits in which slot — the inverse of `implSlots`.
 *
 * AMOS's extension table is indexed BY SLOT, so anything reaching a single
 * extension through its slot number needs this direction: AMCAF's Extbase,
 * Extdefault and Extremove are `$f8(a5) + 16*(n-1)` and nothing else.
 *
 * Last-wins on a collision, which cannot happen with real bindings — a slot
 * holds one extension — and is arbitrary without them, where `implSlots`
 * falls back to every slot an identity has ever been seen at and two ports may
 * claim one. That fallback is for source listings and tests, which is also the
 * case where no program can be asking about a slot it did not name.
 */
export function implsBySlot(
  impls: readonly ExtensionImpl[],
  bound: ReadonlyMap<number, Extension> | null | undefined,
): Map<number, ExtensionImpl> {
  const out = new Map<number, ExtensionImpl>()
  for (const impl of impls) for (const slot of implSlots(impl, bound)) out.set(slot, impl)
  return out
}

/**
 * The slots holding any of these identities, by the same rule as `implSlots`.
 *
 * Split out because aliases resolve ONE identity at a time where `qualified`
 * resolves the whole port: `prt bold` should answer only where Prt 1.1 sits,
 * not wherever any Prt sits, or a 1.3 program would inherit 1.1's spelling.
 */
export function slotsForIds(
  ids: readonly string[],
  bound: ReadonlyMap<number, Extension> | null | undefined,
): number[] {
  if (bound && bound.size > 0) {
    return [...bound]
      .filter(([, ext]) => ids.includes(ext.id))
      .map(([slot]) => slot)
      .sort((a, b) => a - b)
  }
  const slots = new Set<number>()
  for (const ext of allExtensions()) {
    if (!ids.includes(ext.id)) continue
    if (ext.defaultSlot !== undefined) slots.add(ext.defaultSlot)
    for (const s of ext.observedSlots) slots.add(s)
  }
  return [...slots].sort((a, b) => a - b)
}

/**
 * Move a port's `qualified` names onto slot-qualified keys.
 *
 * The plain name is dropped, not kept alongside: it belongs to whichever layer
 * owns it, and leaving it would be the silent replacement this whole mechanism
 * exists to prevent. No bound slots means the keyword is not reachable in this
 * program — which is the honest answer when the extension is not there.
 */
export function qualifyForSlots<T>(
  table: Record<string, T>,
  qualified: readonly string[],
  slots: readonly number[],
): Record<string, T> {
  if (qualified.length === 0) return table
  const out: Record<string, T> = {}
  for (const [name, handler] of Object.entries(table)) {
    if (!qualified.includes(name)) {
      out[name] = handler
      continue
    }
    for (const slot of slots) out[`ext${slot}:${name}`] = handler
  }
  return out
}

/**
 * Add a port's per-identity aliases as slot-qualified keys.
 *
 * `raw` is the port's table BEFORE `qualifyForSlots` has moved anything: an
 * alias resolves to a handler by the port's own name for it, and once a
 * qualified name has been rewritten to `ext13:sprite col` that name is gone.
 * Looking the target up in the raw table keeps the two mechanisms independent,
 * so a keyword can be both aliased and slot-qualified without either knowing
 * about the other.
 *
 * Aliases are added to the result rather than replacing anything. The port's
 * own names stay exactly as they were — this only makes another release's
 * spelling reach the same handler, at the slots that release occupies.
 */
export function aliasForSlots<T>(
  table: Record<string, T>,
  raw: Record<string, T>,
  aliases: ExtensionImpl['aliases'],
  bound: ReadonlyMap<number, Extension> | null | undefined,
): Record<string, T> {
  if (aliases === undefined) return table
  let out: Record<string, T> | null = null
  for (const [id, map] of Object.entries(aliases)) {
    const slots = slotsForIds([id], bound)
    if (slots.length === 0) continue
    for (const [alias, canonical] of Object.entries(map)) {
      const handler = raw[canonical]
      // a release may name keywords this port has not implemented
      if (handler === undefined) continue
      out ??= { ...table }
      for (const slot of slots) out[`ext${slot}:${alias}`] = handler
    }
  }
  return out ?? table
}
