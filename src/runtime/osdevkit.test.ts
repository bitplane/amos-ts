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
    expect(rt.osdevkit.strings.memory.sizeOf(rt.osdevkit.memory.base + 8)).toBe(0)
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

  it('extracts every Utility Amiga2Date field from the live clock (workers 1848-1853)', () => {
    expect(run('Print _ut sec,_ut min,_ut hour,_ut day,_ut month,_ut year').output).toBe(
      ' 0\t 30\t 14\t 12\t 7\t 1994\n',
    )
  })
})

describe('OS DevKit 1.61 tag lists', () => {
  it('allocates, appends, terminates, finds, reads and frees TagItems (workers 1319-1325)', () => {
    const source = [
      'T=_tag list alloc(2)',
      '_tag set T,$80000001,123',
      '_tag set T,$80000002,456',
      '_tag done T',
      'Print _tag find(T,$80000002)-T,_tag data(T,$80000001,-1),_tag data(T,99,-1)',
      '_tag list free T',
    ].join('\n')
    const { rt, output } = run(source)
    expect(output).toBe(' 8\t 123\t-1\n')
    expect(rt.osdevkit.memory.sizeOf(rt.osdevkit.memory.base)).toBe(0)
  })
})

describe('OS DevKit 1.61 native memory', () => {
  it('maps AllocMem/AllocVec blocks, copies bytes, clears structures and frees each form', () => {
    const source = [
      'A=_mem alloc(8,$10001)',
      'B=_vec alloc(8,$10001)',
      'C=_mem abs alloc(4,1)',
      'S=_struct alloc(4)',
      'Loke A,$123480ff',
      '_mem copy A,B,4',
      'Print Hex$(Leek(B)),Leek(S)',
      '_mem free A,8 : _vec free B : _mem free C,4 : _struct free S',
    ].join('\n')
    const { rt, output } = run(source)
    expect(output).toBe('$123480FF\t 0\n')
    expect(rt.osdevkit.memory.sizeOf(rt.osdevkit.memory.base)).toBe(0)
  })

  it('reads and writes signed and unsigned structure fields (routines 16-25)', () => {
    const source = [
      'S=_struct alloc(12)',
      '_struct byte(S,0)=$80 : _struct ubyte(S,1)=$ff',
      '_struct word(S,2)=$8001 : _struct uword(S,4)=$ffff',
      '_struct long(S,6)=$80000001',
      'Print _struct byte(S,0),_struct ubyte(S,1)',
      'Print _struct word(S,2),_struct uword(S,4),Hex$(_struct long(S,6))',
      '_struct free S',
    ].join('\n')
    expect(run(source).output).toBe('-128\t 255\n-32767\t 65535\t$80000001\n')
  })
})

describe('OS DevKit 1.61 low-level machine wrappers', () => {
  it('reads and writes direct CPU words and longs (routines 10-15)', () => {
    const source = [
      'Reserve As Work 1,8 : P=Start(1)',
      '_cpu word(P)=$8001 : _cpu uword(P+2)=$ffff : _cpu long(P+4)=$80000001',
      'Print _cpu word(P),_cpu uword(P+2),Hex$(_cpu long(P+4))',
    ].join('\n')
    expect(run(source).output).toBe('-32767\t 65535\t$80000001\n')
  })

  it('returns distinct LockIBase tokens and accepts their matching unlocks (workers 1589/1590)', () => {
    expect(run('A=_ibase lock(0) : B=_ibase lock(1) : Print A<>B : _ibase unlock A : _ibase unlock B').output)
      .toBe('-1\n')
  })

  it('returns every concrete library base retained by extension initialization', () => {
    const source = [
      'Print _base dos<>0,_base gfx<>0,_base int<>0,_base gad<>0,_base asl<>0',
      'Print _base icon<>0,_base loc<>0,_base dt<>0,_base layers<>0',
    ].join('\n')
    expect(run(source).output).toBe('-1\t-1\t-1\t-1\t-1\n-1\t-1\t-1\t-1\n')
  })

  it('records Exec ColdReboot as a machine reset request (worker 1570)', () => {
    const { rt } = run('_cold reboot')
    expect(rt.machine.pendingReset).toEqual({ kind: 'cold', by: '_cold reboot' })
  })
})
