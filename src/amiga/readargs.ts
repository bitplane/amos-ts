export type CliArg = string | number | string[] | number[] | boolean

function words(input: string): string[] {
  const out: string[] = []; let word = '', quote = false
  for (let i = 0; i < input.length; i++) { const c = input[i]!; if (c === '"') quote = !quote; else if (!quote && /\s/.test(c)) { if (word) { out.push(word); word = '' } } else word += c }
  if (word) out.push(word); return out
}

/** The DOS ReadArgs template/result model used by CLI-facing extensions. */
export class ReadArgs {
  values: CliArg[] = []
  read(input: string, template: string): boolean {
    const specs = template.split(',').map(s => { const [name, ...mods] = s.trim().split('/'); return { name: name!.toLowerCase(), mods: new Set(mods.map(x => x.toUpperCase())) } })
    const tokens = words(input), keyed = new Map<string, string>(), positional: string[] = []
    const keys = new Set(specs.filter(s => s.mods.has('K') || s.mods.has('S')).map(s => s.name))
    for (let i = 0; i < tokens.length; i++) {
      const eq = tokens[i]!.indexOf('='); const key = tokens[i]!.toLowerCase()
      if (eq > 0) keyed.set(key.slice(0, eq), tokens[i]!.slice(eq + 1))
      else if (keys.has(key)) { const sw = specs.find(s => s.name === key)?.mods.has('S'); keyed.set(key, sw ? '' : tokens[++i] ?? '') }
      else positional.push(tokens[i]!)
    }
    let at = 0; this.values = []
    for (const s of specs) {
      let raw: string | string[] | undefined = keyed.get(s.name)
      if (s.mods.has('S')) { this.values.push(raw !== undefined || positional.some(x => x.toLowerCase() === s.name)); continue }
      if (raw === undefined) raw = s.mods.has('M') || s.mods.has('F') ? positional.slice(at) : positional[at++]
      if (raw === undefined && s.mods.has('A')) { this.values = []; return false }
      if (Array.isArray(raw)) this.values.push(s.mods.has('N') ? raw.map(x => Number.parseInt(x, 10) || 0) : raw)
      else this.values.push(s.mods.has('N') ? (raw === undefined ? 0 : Number.parseInt(raw, 10) || 0) : raw ?? '')
    }
    return true
  }
  string(index: number, sub = 0): string { const v = this.values[index]; if (Array.isArray(v)) return String(v[sub] ?? ''); return typeof v === 'boolean' ? (v ? '-1' : '0') : String(v ?? '') }
  number(index: number, sub = 0): number { const v = this.values[index]; if (Array.isArray(v)) return Number(v[sub] ?? 0); if (typeof v === 'boolean') return v ? -1 : 0; return typeof v === 'number' ? v : Number.parseInt(v ?? '', 10) || 0 }
}
