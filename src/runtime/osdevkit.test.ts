import { describe, expect, it } from 'vitest'
import { mustFinish } from '../testing/run'
import { extensionById } from '../ext/registry'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/source'
import { fixedClock } from '../amiga/host'
import { Runtime } from './runtime'

const core = new TokenTable(CORE_TOKENS)
const os = extensionById('os-devkit-1.61')!

function run(source: string): { rt: Runtime; output: string } {
  const extensions = new Map([[20, os.table]])
  let output = ''
  const rt = new Runtime(tokenize(source, core, extensions), core, {
    extensions,
    extBindings: new Map([[20, os]]),
    host: { clock: fixedClock() },
    maxSteps: 200_000,
    onText: (text) => { output += text },
  })
  mustFinish(rt.runHeadless(100))
  return { rt, output }
}

describe('OS DevKit 1.61 callable scalar slice', () => {
  it('runs the exact word joins and sign extensions (workers 1752, 1757-1759)', () => {
    const { output } = run('Print Hex$(_join.w($12345678,$abcd9abc))\nPrint _ext.b($80),Hex$(_ext.w($12345680)),_ext.l($8001)')
    expect(output).toBe('$9ABC1234\n-128\t$1234FF80\t-32767\n')
  })

  it('round-trips the fixed-width binary strings (workers 26-29)', () => {
    const { output } = run('A$=_chr$.l($123480ff) : Print Hex$(_val.l(A$))\nPrint Hex$(_val.w(_chr$.w($80ff)))')
    expect(output).toBe('$123480FF\n$80FF\n')
  })

  it('reports the binary-observed Exec identity (workers 675/676/1753/1754)', () => {
    expect(run('Print _sys version,_sys revision,_sys cpu,_sys fpu').output).toBe(' 40\t 0\t 20\t 0\n')
  })
})

describe('OS DevKit 1.61 private C strings', () => {
  it('allocates, copies, measures, reads and frees (workers 1466-1475)', () => {
    const { rt, output } = run('P=_str alloc(4) : _str pos P,$1234,$56 : _str put "ABCDE",P : Print _str len(P),_str get(P) : _str free P')
    expect(output).toBe(' 4\tABCD\n')
    expect(rt.osdevkit.strings.memory.sizeOf(0x5c00_0008)).toBe(0)
  })

  it('supports the delimiter overloads and custom terminator worker', () => {
    const { output } = run('P=_str alloc(8) : _str put "ABCD",P,33 : Print _str len(P,33),_str get(P,33)')
    expect(output).toBe(' 4\tABCD\n')
  })

  it('converts AMOS strings and returns the static empty string (workers 1475/1476)', () => {
    expect(run('P=_to str("AMOS") : Print _str get(P),Len(_0$)').output).toBe('AMOS\t 0\n')
  })
})

describe('OS DevKit 1.61 system operations', () => {
  it('writes CurrentTime output and accepts CacheClearU (workers 512/1755)', () => {
    const { rt } = run('Reserve As Data 1,8 : P=Start(1) : _sys time P,P+4 : _cache clr')
    const address = rt.bankRef(1)!.address
    expect(rt.longsAt(address, false)?.get(0)).toBeGreaterThan(0)
    expect(rt.longsAt(address + 4, false)?.get(0)).toBeGreaterThanOrEqual(0)
  })
})
