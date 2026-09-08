export type CliArg = string | number | string[] | number[] | boolean

interface Word { value: string; quoted: boolean }
interface Spec { name: string; aliases: string[]; mods: Set<string> }

function words(input: string): Word[] | null {
  const out: Word[] = []; let word = '', quote = false, quoted = false
  const emit = (): void => { if (word || quoted) out.push({ value: word, quoted }); word = ''; quoted = false }
  for (let i = 0; i < input.length; i++) {
    const c = input[i]!
    if (c === '*') {
      const escaped = input[++i]; if (escaped === undefined) { word += '*'; continue }
      word += escaped === 'N' || escaped === 'n' ? '\n' : escaped === 'E' || escaped === 'e' ? '\x1b' : escaped
    } else if (c === '"') { if (!quote && word === '') quoted = true; quote = !quote }
    else if (!quote && /\s/.test(c)) emit()
    else word += c
  }
  if (quote) return null
  emit(); return out
}

function specs(template: string): Spec[] | null {
  const out: Spec[] = []
  for (const part of template.split(',')) {
    const [names, ...rawMods] = part.trim().split('/')
    const aliases = (names ?? '').split('=').map(s => s.trim().toLowerCase()).filter(Boolean)
    const mods = new Set(rawMods.map(s => s.toUpperCase()))
    if (!aliases.length || [...mods].some(m => !['A', 'F', 'K', 'M', 'N', 'S', 'T'].includes(m))) return null
    out.push({ name: aliases.at(-1)!, aliases, mods })
  }
  return out
}

/** The DOS ReadArgs template/result model used by CLI-facing extensions. */
export class ReadArgs {
  values: CliArg[] = []
  read(input: string, template: string): boolean {
    const fields = specs(template), tokens = words(input)
    if (!fields || !tokens || fields.length > 100) return this.fail()
    const byKey = new Map<string, Spec>()
    for (const field of fields) if (field.mods.has('K') || field.mods.has('S') || field.mods.has('T')) for (const alias of field.aliases) byKey.set(alias, field)
    const keyed = new Map<string, string[]>(), positional: string[] = []
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]!, eq = token.quoted ? -1 : token.value.indexOf('=')
      const spelling = (eq > 0 ? token.value.slice(0, eq) : token.value).toLowerCase(), field = token.quoted ? undefined : byKey.get(spelling)
      if (!field) { positional.push(token.value); continue }
      if (field.mods.has('S') || field.mods.has('T')) { keyed.set(field.name, ['']); continue }
      const value = eq > 0 ? token.value.slice(eq + 1) : tokens[++i]?.value
      if (value === undefined) return this.fail()
      const values = keyed.get(field.name) ?? []; values.push(value); keyed.set(field.name, values)
    }

    let at = 0; this.values = []
    for (let index = 0; index < fields.length; index++) {
      const field = fields[index]!, found = keyed.get(field.name)
      if (field.mods.has('S') || field.mods.has('T')) { this.values.push(found !== undefined); continue }
      let raw: string | string[] | undefined = found && (field.mods.has('M') ? found : found.at(-1))
      if (raw === undefined && !field.mods.has('K')) {
        if (field.mods.has('F')) { raw = positional.slice(at).join(' '); at = positional.length }
        else if (field.mods.has('M')) {
          const requiredAfter = fields.slice(index + 1).filter(s => s.mods.has('A') && !s.mods.has('K') && !s.mods.has('S') && !s.mods.has('T')).length
          const take = Math.max(0, positional.length - at - requiredAfter); raw = positional.slice(at, at + take); at += take
        } else raw = positional[at++]
      }
      if ((raw === undefined || (Array.isArray(raw) && raw.length === 0)) && field.mods.has('A')) return this.fail()
      const converted = this.convert(raw, field.mods.has('N'))
      if (converted === null) return this.fail()
      this.values.push(converted)
    }
    if (at < positional.length) return this.fail()
    return true
  }
  private convert(raw: string | string[] | undefined, numeric: boolean): CliArg | null {
    if (!numeric) return raw ?? ''
    const number = (value: string): number | null => /^[+-]?\d+$/.test(value) ? Number.parseInt(value, 10) : null
    if (Array.isArray(raw)) { const values = raw.map(number); return values.some(v => v === null) ? null : values as number[] }
    if (raw === undefined) return 0
    return number(raw)
  }
  private fail(): false { this.values = []; return false }
  string(index: number, sub = 0): string { const v = this.values[index]; if (Array.isArray(v)) return String(v[sub] ?? ''); return typeof v === 'boolean' ? (v ? '-1' : '0') : String(v ?? '') }
  number(index: number, sub = 0): number { const v = this.values[index]; if (Array.isArray(v)) return Number(v[sub] ?? 0); if (typeof v === 'boolean') return v ? -1 : 0; return typeof v === 'number' ? v : Number.parseInt(v ?? '', 10) || 0 }
}
