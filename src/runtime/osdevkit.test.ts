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

describe('OS DevKit 1.61 Exec List and Node wrappers', () => {
  it('round-trips every public List and Node field at its native width (workers 1439-1465)', () => {
    const source = [
      'L=_lnod alloc : N=_nod alloc(4)',
      '_lnod set head L,$12345678 : _lnod set tail L,$23456789 : _lnod set type L,$101',
      '_nod set succ N,$3456789a : _nod set pred N,$456789ab',
      '_nod set type N,$102 : _nod set pri N,$ff : _nod set name N,$56789abc',
      'Print Hex$(_lnod what head(L)),Hex$(_lnod what tail(L)),_lnod what type(L)',
      'Print Hex$(_nod what succ(N)),Hex$(_nod what pred(N)),_nod what type(N),_nod what pri(N)',
      'Print Hex$(_nod what name(N)),_nod what start(N)-N',
      '_nod free N : _lnod free L',
    ].join('\n')
    expect(run(source).output).toBe(
      '$12345678\t$23456789\t 1\n$3456789A\t$456789AB\t 2\t-1\n$56789ABC\t 14\n',
    )
  })

  it('inserts, removes, searches and priority-enqueues through Exec sentinels', () => {
    const source = [
      'L=_lnod alloc : A=_nod alloc(0) : B=_nod alloc(0) : C=_nod alloc(0)',
      '_nod set pri A,1 : _nod set pri B,3 : _nod set name C,_to str("C")',
      '_nod h add L,B : _nod h add L,A : _nod ins L,C,A',
      'Print _lnod what head(L)=A,_nod what succ(A)=C,_nod what pred(C)=A,_lnod what tail(L)=B',
      'Print _nod find name(L,_nod what name(C))=C',
      '_nod rem C : _nod t rem L : _nod h rem L',
      '_nod t add L,A : _nod enqueue L,B : Print _lnod what head(L)=B',
      '_nod free A : _nod free B : _nod free C : _lnod free L',
    ].join('\n')
    expect(run(source).output).toBe('-1\t-1\t-1\t-1\n-1\n-1\n')
  })
})

describe('OS DevKit 1.61 shared Exec services', () => {
  it('uses one mapped arena for OS allocations, lists, ports and messages', () => {
    const source = [
      'P=_port create : _nod set name P,_to str("public") : _port add P',
      'Print _port find(_nod what name(P))=P,_port what sig task(P)<>0,_port what sig nb(P)>=0',
      'R=_port create : M=_nod alloc(6) : Loke M+14,R : Doke M+18,$1234',
      '_msg put P,M',
      'Print Hex$(_msg what length(M)),_msg what reply port(M)=R',
      '_msg reply M : A=_lnod what head(R+20) : _nod h rem R+20 : Print A=M',
      '_port rem P : Print _port find(_nod what name(P))=0',
      '_nod free M : _port delete P : _port delete R',
    ].join('\n')
    const { rt, output } = run(source)
    expect(output).toBe('-1\t-1\t-1\n$1234\t-1\n-1\n-1\n')
    expect(rt.osdevkit.memory).toBe(rt.exec.pool)
    expect(rt.osdevkit.exec).toBe(rt.exec)
  })

  it('shares signal state and native Interrupt records through the runtime Exec service', () => {
    const source = [
      'S=_sig alloc(-1) : Print S,_sig set(5,7),_sig set(2,3)',
      'T=_port create : _sig put _port what sig task(T),8 : _port delete T : _sig free S',
      'I=_int alloc : _int set I,$12345678,$23456789',
      'Print Hex$(Leek(I+14)),Hex$(Leek(I+18))',
      '_int rem 5,I : _int free I',
    ].join('\n')
    const { rt, output } = run(source)
    expect(output).toBe(' 0\t 0\t 5\n$12345678\t$23456789\n')
    expect(rt.exec.pool.sizeOf(rt.exec.pool.base + 8)).toBe(0)
  })
})

describe('OS DevKit 1.61 channel records', () => {
  it('round-trips all list and private data-header fields (workers 1122-1137)', () => {
    const source = [
      'L=_chn list alloc(3) : A=_chn add(L)',
      '_chn set number L,7 : _chn set default L,8 : _chn set first L,$12345678 : _chn set last L,$23456789',
      '_chn set list A,$3456789a : _chn set length A,9',
      '_chn set next A,$456789ab : _chn set previous A,$56789abc',
      'Print _chn what number(L),_chn what default(L),Hex$(_chn what first(L)),Hex$(_chn what last(L))',
      'Print Hex$(_chn what list(A)),_chn what length(A),Hex$(_chn what next(A)),Hex$(_chn what previous(A))',
      '_mem free A-24,27 : _mem free L,16',
    ].join('\n')
    expect(run(source).output).toBe(
      ' 7\t 8\t$12345678\t$23456789\n$3456789A\t 9\t$456789AB\t$56789ABC\n',
    )
  })

  it('adds, inserts, locates, finds and frees linked channel allocations', () => {
    const source = [
      'L=_chn list alloc(3) : A=_chn add(L) : C=_chn add(L,5)',
      'B=_chn ins(C,4)',
      'Print _chn what number(L),_chn location(B),_chn find(L,2)=B',
      'D=_chn ins(L To 2) : Print _chn what length(D),_chn location(D)',
      'E=_chn ins(L,6 To 3) : Print _chn what length(E),_chn location(E)',
      '_chn swap A,C : _chn free L,2 : _chn free A',
      'Print _chn what number(L)',
      '_chn list free L',
    ].join('\n')
    expect(run(source).output).toBe(' 3\t 2\t-1\n 3\t 2\n 6\t 3\n 3\n')
  })
})

describe('OS DevKit 1.61 native event and utility structures', () => {
  it('reads every IntuiMessage field at its native width (workers 478-486)', () => {
    const source = [
      'M=_struct alloc(48)',
      'Loke M+20,$80000001 : Doke M+24,$fedc : Doke M+26,$cafe : Loke M+28,$12345678',
      'Doke M+32,$fffe : Doke M+34,3 : Loke M+36,9 : Loke M+40,10 : Loke M+44,$23456789',
      'Print Hex$(_imsg what class(M)),Hex$(_imsg what code(M)),Hex$(_imsg what qualifier(M))',
      'Print Hex$(_imsg what item(M)),_imsg what x mouse(M),_imsg what y mouse(M)',
      'Print _imsg what seconds(M),_imsg what micros(M),Hex$(_imsg what wnd(M))',
      '_struct free M',
    ].join('\n')
    expect(run(source).output).toBe(
      '$80000001\t$FEDC\t$CAFE\n$12345678\t-2\t 3\n 9\t 10\t$23456789\n',
    )
  })

  it('allocates signed coordinate pairs and fills a native TextAttr', () => {
    const source = [
      'D=_dots alloc(2) : _dots set D,1,-2,32767',
      'T=_struct alloc(8) : _ta set T,$12345678,$fedc,$ab,$cd',
      'Print _dots what x(D,1),_dots what y(D,1)',
      'Print Hex$(_ta what name(T)),Hex$(_ta what height(T)),Hex$(_ta what style(T)),Hex$(_ta what flags(T))',
      '_dots free D : _struct free T',
    ].join('\n')
    expect(run(source).output).toBe('-2\t 32767\n$12345678\t$FEDC\t$AB\t$CD\n')
  })
})

describe('OS DevKit 1.61 native Intuition data structures', () => {
  it('sets and reads complete Border and BooleanInfo records (workers 300-313, 335-339)', () => {
    const source = [
      'B=_struct alloc(16) : _bd set B,$ffff,$2345,$101,$202,$303,$104,$87654321,$12345678',
      'Print _bd what left(B),_bd what top(B),_bd what front pen(B),_bd what back pen(B)',
      'Print _bd what draw mode(B),_bd what dots nb(B),Hex$(_bd what dots(B)),Hex$(_bd what next(B))',
      '_bd set draw B,7,8,9 : _bd set corner B,10,11 : _bd set dots B,12,13 : _bd set next B,14',
      'Print _bd what left(B),_bd what top(B),_bd what front pen(B),_bd what dots nb(B),_bd what next(B)',
      'I=_struct alloc(6) : _bi set I,$12345,$ffffffff',
      'Print Hex$(_bi what flags(I)),Hex$(_bi what mask(I))',
      '_bi set flags I,2 : _bi set mask I,3 : Print _bi what flags(I),_bi what mask(I)',
      '_struct free B : _struct free I',
    ].join('\n')
    expect(run(source).output).toBe(
      ' 65535\t 9029\t 1\t 2\n 3\t 4\t$87654321\t$12345678\n 10\t 11\t 7\t 12\t 14\n$2345\t$FFFFFFFF\n 2\t 3\n',
    )
  })

  it('sets and reads Image geometry, planes and links (workers 319-334)', () => {
    const source = [
      'I=_struct alloc(20)',
      '_img set body I,-2,3,10,5,2,$12345678 : _img set planes I,$1ff,$102 : _img set next I,$87654321',
      'Print _img point in(I,-2,3),_img point in(I,7,7),_img point in(I,8,7)',
      'Print Hex$(_img what left(I)),_img what top(I),_img what width(I),_img what height(I),_img what depth(I)',
      'Print Hex$(_img what body(I)),Hex$(_img what pick(I)),_img what onoff(I),Hex$(_img what next(I))',
      '_struct free I',
    ].join('\n')
    expect(run(source).output).toBe(
      '-1\t-1\t 0\n$FFFE\t 3\t 10\t 5\t 2\n$12345678\t$FF\t 2\t$87654321\n',
    )
  })

  it('sets the first five PropInfo words without disturbing calculated geometry', () => {
    const source = [
      'P=_struct alloc(22)',
      'Doke P+10,6 : Doke P+12,7 : Doke P+14,8 : Doke P+16,9 : Doke P+18,10 : Doke P+20,11',
      '_pi set P,1,2,3,4,5',
      'Print _pi what flags(P),_pi what % horiz(P),_pi what % vert(P),_pi what % width(P),_pi what % height(P)',
      'Print _pi what width(P),_pi what height(P),_pi what hinc(P),_pi what vinc(P),_pi what left(P),_pi what top(P)',
      '_struct free P',
    ].join('\n')
    expect(run(source).output).toBe(' 1\t 2\t 3\t 4\t 5\n 6\t 7\t 8\t 9\t 10\t 11\n')
  })

  it('sets complete and partial StringInfo fields at offsets 0 through $20', () => {
    const source = [
      'S=_struct alloc(36)',
      'Doke S+14,6 : Doke S+16,7 : Doke S+18,8 : Doke S+20,9 : Doke S+22,10',
      '_si set S,11,12,13,14,15,16,-17,18',
      'Print _si what buf(S),_si what undo buf(S),_si what pos buf(S),_si what max chars(S),_si what disp chars(S)',
      'Print _si what undo pos(S),_si what nb chars(S),_si what disp count(S),_si what cleft(S),_si what ctop(S)',
      'Print _si what ext(S),_si what integer(S),_si what keymap(S)',
      '_si set buf S,21,22,23,24,25 : _si set ext S,26 : _si set integer S,-27 : _si set keymap S,28',
      'Print _si what buf(S),_si what undo buf(S),_si what pos buf(S),_si what max chars(S),_si what disp chars(S)',
      'Print _si what ext(S),_si what integer(S),_si what keymap(S),_si what undo pos(S)',
      '_struct free S',
    ].join('\n')
    expect(run(source).output).toBe(
      ' 11\t 12\t 13\t 14\t 15\n 6\t 7\t 8\t 9\t 10\n 16\t-17\t 18\n' +
      ' 21\t 22\t 23\t 24\t 25\n 26\t-27\t 28\t 6\n',
    )
  })
})
