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
   * Keywords this port must answer for under a slot-qualified key rather than
   * its plain name, because another layer owns the plain one (see
   * interp/names.ts:qualified). Declared by plain name here and rewritten to
   * `ext<slot>:<name>` per bound slot, so the port itself never spells a slot.
   */
  readonly qualified?: readonly string[]
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
  if (bound && bound.size > 0) {
    return [...bound]
      .filter(([, ext]) => impl.ids.includes(ext.id))
      .map(([slot]) => slot)
      .sort((a, b) => a - b)
  }
  const slots = new Set<number>()
  for (const ext of allExtensions()) {
    if (!impl.ids.includes(ext.id)) continue
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
