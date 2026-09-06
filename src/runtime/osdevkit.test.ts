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

function run(source: string, prepare?: (rt: Runtime) => void): { rt: Runtime; output: string } {
  const extensions = new Map([[20, os.table]])
  let output = ''
  const rt = new Runtime(tokenize(source, core, extensions), core, {
    extensions,
    extBindings: new Map([[20, os]]),
    host: { clock: fixedClock() },
    maxSteps: 200_000,
    onText: (text) => { output += text },
  })
  prepare?.(rt)
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

describe('OS DevKit 1.61 native graphics records', () => {
  it('round-trips BitMap, TmpRas and SimpleSprite fields at native widths', () => {
    const source = [
      'B=_struct alloc(40) : _bm set datas B,$12345,$23456,$103,$104 : Loke B+8,$12345678',
      'Print Hex$(_bm what modulo(B)),Hex$(_bm what height(B)),_bm what depth(B),_bm what flags(B)',
      'Print Hex$(_bm what plane(B,0)),_bm what plane(B,3)',
      'T=_struct alloc(8) : _tmpras init T,$23456789,$3456789a',
      'Print Hex$(_tr what raster(T)),Hex$(_tr what size(T)) : _tr set T,3,4',
      'S=_struct alloc(12) : _spr set height S,$12345 : _spr set nb S,$23456 : _spr set pos S,$34567,$45678',
      'Print Hex$(_struct uword(S,4)),Hex$(_struct uword(S,6)),Hex$(_struct uword(S,8)),Hex$(_struct uword(S,10))',
      '_struct free B : _struct free T : _struct free S',
    ].join('\n')
    expect(run(source).output).toBe(
      '$2345\t$3456\t 3\t 4\n$12345678\t 0\n$23456789\t$3456789A\n$2345\t$4567\t$5678\t$3456\n',
    )
  })

  it('initializes and exposes RastPort fields and font style', () => {
    const source = [
      'R=_struct alloc(72)',
      '_rp set layer R,1 : _rp set bmap R,2 : _rp set tmpras R,3 : _rp set area info R,4',
      '_rp set o pen R,5 : _rp set o pen R,$80000000 : _rp set line R,$12345 : _rp set wr msk R,$106',
      'Doke R+36,$8001 : Doke R+38,$ffff : Doke R+62,$8002',
      'Print _rp what layer(R),_rp what bmap(R),_rp what tmpras(R),_rp what area info(R)',
      'Print _rp what xgr(R),_rp what ygr(R),_rp what text base(R)',
      '_rp wr msk R,7 : _rp o pen R,8 : _font set R,9',
      'Print _struct ubyte(R,24),_struct ubyte(R,27),_struct long(R,52)',
      '_struct ubyte(R,56)=$a5 : Print Hex$(_font style(R)),Hex$(_font soft style(R,$3c,$0f))',
      '_struct free R',
    ].join('\n')
    expect(run(source).output).toBe(' 1\t 2\t 3\t 4\n-32767\t-1\t 32770\n 7\t 8\t 9\n$A5\t$AC\n')
  })

  it('reproduces View and ViewPort setters, including their shipped defects', () => {
    const source = [
      'V=_struct alloc(18) : _cop init view V : _view set V,$12345678,10,20,$92348001',
      'Print Hex$(_view what vport(V)),_view what x(V),_view what y(V),_view what modes(V)',
      'P=_struct alloc(40) : _cop init vport P : _vp set next P,1 : _vp set cmap P,2 : _vp set ras info P,3',
      '_vp set body P,$ffff,$fffe,100,200,$12345,$6789',
      'Print _vp what next(P),_vp what cmap(P),_vp what ras info(P)',
      'Print _vp what width(P),_vp what height(P),Hex$(_vp what x(P)),Hex$(_vp what y(P)),Hex$(_vp what modes(P)),Hex$(_vp what spr pri(P))',
      '_struct free V : _struct free P',
    ].join('\n')
    expect(run(source).output).toBe(
      '$12345678\t-32767\t-28108\t 0\n 1\t 2\t 3\n 0\t 200\t$FFFF\t$FFFE\t$2345\t$67\n',
    )
  })

  it('round-trips signed RasInfo offsets and managed ColorMap components', () => {
    const source = [
      'I=_struct alloc(12) : _ri set I,$12345678,$23456789,-2,-32767',
      'Print Hex$(_ri what next(I)),Hex$(_ri what bmap(I)),_ri what x(I),_ri what y(I)',
      'C=_cm alloc(3) : _rgb4 cm set C,1,$a,$b,$c : Print Hex$(_rgb4 get(C,1))',
      '_rgb32 cm set C,2,$89abcdef,$12345678,$fedcba98 : O=_struct alloc(12) : _rgb32 get C,2,1,O',
      'Print Hex$(Leek(O)),Hex$(Leek(O+4)),Hex$(Leek(O+8))',
      '_blt own : _blt wait : _blt disown : _cm free C : _struct free I : _struct free O',
    ].join('\n')
    expect(run(source).output).toBe('$12345678\t$23456789\t-2\t-32767\n$ABC\n$89ABCDEF\t$12345678\t$FEDCBA98\n')
  })

  it('draws through caller-owned native RastPort, BitMap and plane pointers', () => {
    const source = [
      'P=_struct alloc(16) : B=_struct alloc(40) : R=_struct alloc(72)',
      '_bm set datas B,2,4,2,0 : Loke B+8,P : Loke B+12,P+8',
      '_rp set bmap R,B : _rp set wr msk R,3 : _rp set line R,$ffff : _rp a pen R,3 : _rp b pen R,1 : _rp dr md R,0',
      '_rp plot R,0,0 : Print _rp point(R,0,0),Hex$(Peek(P)),Hex$(Peek(P+8))',
      '_rp dr md R,2 : _rp plot R,0,0 : Print _rp point(R,0,0)',
      '_rp dr md R,0 : _rp rast R,0 : _rp move R,0,0 : _rp draw R,3,0',
      'Print Hex$(Peek(P)),_rp what xgr(R),_rp what ygr(R)',
      '_rp ellipse R,8,2,2,1 : Print _rp point(R,10,2)',
      '_rp move R,1,2 : _rp text R,"abc" : Print _rp what xgr(R),_rp len text(R,"abcd")',
      '_struct free P : _struct free B : _struct free R',
    ].join('\n')
    expect(run(source).output).toBe(' 3\t$80\t$80\n 0\n$F0\t 3\t 0\n 3\n 25\t 32\n')
  })

  it('uses caller-owned AreaInfo and TmpRas records for fills and raster allocation', () => {
    const source = [
      'P=_struct alloc(64) : B=_struct alloc(40) : R=_struct alloc(72)',
      '_bm set datas B,4,8,2,0 : Loke B+8,P : Loke B+12,P+32',
      '_rp set bmap R,B : _rp set wr msk R,3 : _rp set line R,$ffff : _rp a pen R,3 : _rp b pen R,0 : _rp set o pen R,1',
      'T=_struct alloc(8) : S=_rast alloc(32,8) : _tr set T,S,32 : _rp set tmpras R,T',
      'A=_struct alloc(24) : V=_struct alloc(40) : _area init A,V,8 : _rp set area info R,A',
      'Print _struct long(A,0)=V,_struct long(A,8)=V+32,_struct uword(A,18)',
      'Print _area move(R,1,1),_area draw(R,8,1),_area draw(R,1,6),_area end(R)',
      'Print _rp point(R,2,2),_struct uword(A,16)',
      '_rp a pen R,2 : Print _area ellipse(R,16,4,3,2),_area end(R),_rp point(R,16,4)',
      '_rp bar R,20,1,22,3 : Print _rp point(R,21,2)',
      '_rp rast R,0 : _rp a pen R,1 : _rp move R,24,1 : _rp draw R,30,1 : _rp draw R,30,6 : _rp draw R,24,6 : _rp draw R,24,1',
      '_rp a pen R,2 : _rp flood R,1,26,3 : Print _rp point(R,26,3)',
      '_rast free S,32,8 : _struct free T : _struct free A : _struct free V : _struct free P : _struct free B : _struct free R',
    ].join('\n')
    expect(run(source).output).toBe('-1\t-1\t 8\n-1\t-1\t-1\t-1\n 3\t 0\n-1\t-1\t 2\n 2\n 2\n')
  })

  it('owns native LayerInfo and Layer wrappers over caller BitMaps', () => {
    const source = [
      'B=_struct alloc(40) : _bm set datas B,4,16,2,0 : L=_li new',
      'A=_layer create behind(L,B,0,0,31,15,65,0) : Z=_layer create upfront(L,B,4,2,20,10,2,$12345678)',
      'Print L<>0,A<>0,Z<>0,_struct long(A,8)=B,_struct word(Z,16),_struct word(Z,18),_struct word(Z,20),_struct word(Z,22)',
      '_layer delete Z : _layer delete A : _li free L : _struct free B',
    ].join('\n')
    expect(run(source).output).toBe('-1\t-1\t-1\t-1\t 4\t 2\t 20\t 10\n')
  })

  it('shares native TextFont ownership with RastPort text and TextAttr records', () => {
    const source = [
      'N=_to str("topaz.font") : A=_struct alloc(8) : _ta set A,N,8,0,0',
      'F=_font open(A) : D=_font load(A) : Print F<>0,D=F,_struct uword(F,20)',
      'R=_struct alloc(72) : _font set R,F : Print _font style(R),_font soft style(R,3,1),_font style(R),_rp len text(R,"AB")',
      'Q=_struct alloc(8) : _font ask R,Q : Print _str get(_struct long(Q,0)),_struct uword(Q,4),_struct ubyte(Q,6),_struct ubyte(Q,7)',
      '_font rem F : _font add F : _font close D : _font close F',
      '_struct free Q : _struct free R : _struct free A : _str free N',
    ].join('\n')
    expect(run(source).output).toBe('-1\t-1\t 8\n 0\t 1\t 1\t 16\ntopaz.font\t 8\t 0\t 0\n')
  })

  it('owns the private Screen-ID lifecycle over Intuition screens', () => {
    const source = [
      '_scr id open 3,12,20,160,100,4,$8004,15,"Native"',
      'Print _scr id in use,_scr id base(3)<>0,_scr id rport(3)<>0,_scr id vport(3)<>0',
      'Print _scr id width(3),_scr id height(3),_scr id depth(3),Hex$(_scr id mode(3))',
      '_scr id move 3,5,-2 : _scr id offset 3,7,9 : _scr id set mouse pos 3,40,30',
      'Print _scr id x mouse(3),_scr id y mouse(3)',
      '_scr id set pal 2,$abc : Print Hex$(_scr id get pal(2))',
      '_scr id set aga pal 3,$12abef : Print Hex$(_scr id get aga pal(3))',
      '_scr id ink 3,1,2 : _scr id set low pattern $aaaa,$aaaa,$aaaa,$aaaa,$aaaa,$aaaa,$aaaa,$aaaa',
      '_scr id set high pattern $aaaa,$aaaa,$aaaa,$aaaa,$aaaa,$aaaa,$aaaa,$aaaa : _scr id pattern on',
      '_scr id bar 0,0 To 3,1 : Print _scr id point(0,0),_scr id point(1,0)',
      '_scr id pattern off : _scr id fill ellipse 8,8,2,2 : Print _scr id point(8,8)',
      '_scr id ink 2,1,3 : _scr id paint 8,8,0 : Print _scr id point(8,8)',
      '_scr id close 3 : Print _scr id base(3),_scr id in use',
      '_scr id from wb 4 : Print _scr id base(4)<>0,_scr id width(4),_scr id height(4)',
      '_scr id close 4',
    ].join('\n')
    const { rt, output } = run(source)
    expect(output).toBe(' 3\t-1\t-1\t-1\n 160\t 100\t 4\t$8004\n 40\t 30\n$ABC\n$12ABEF\n 3\t 1\n 3\n 2\n 0\t-1\n-1\t 640\t 256\n')
    expect(rt.intuition.workBenchOpen()).toBe(true)
  })

  it('shares the Intuition public-screen registry and lock ownership', () => {
    const source = [
      'N=_to str("Workbench") : _scr def pub N : P=_scr pub lock(N)',
      'Print P<>0,_scr pub modes(1),_scr pub modes(2),_scr pub status(P,3),_scr pub status(P,0)',
      '_scr pub unlock P : _scr id from pub 5,"Workbench"',
      'Print _scr id base(5)=P,_scr id width(5) : _scr id close 5 : _str free N',
    ].join('\n')
    expect(run(source).output).toBe('-1\t 0\t 1\t 0\t 3\n-1\t 640\n')
  })

  it('folds native Border and Image chains into that same planar target', () => {
    const source = [
      'P=_struct alloc(16) : B=_struct alloc(40) : R=_struct alloc(72)',
      '_bm set datas B,2,4,2,0 : Loke B+8,P : Loke B+12,P+8',
      '_rp set bmap R,B : _rp set wr msk R,3 : _rp set line R,$ffff',
      'D=_dots alloc(2) : _dots set D,0,0,0 : _dots set D,1,3,0',
      'H=_struct alloc(16) : _bd set H,0,0,3,0,0,2,D,0 : _bd draw H,R,0,0',
      'Print Hex$(Peek(P)),Hex$(Peek(P+8))',
      'Q=_struct alloc(2) : Poke Q,$80 : I=_struct alloc(20) : _img set body I,4,1,1,1,1,Q : _img set planes I,1,2',
      '_img draw I,R,0,0 : Print _rp point(R,4,1) : _img erase I,R,0,0 : Print _rp point(R,4,1)',
      '_img draw state I,R,0,0,1,0 : Print _rp point(R,4,1)',
      '_dots free D : _struct free H : _struct free Q : _struct free I : _struct free P : _struct free B : _struct free R',
    ].join('\n')
    expect(run(source).output).toBe('$F0\t$F0\n 3\n 0\n 0\n')
  })
})

describe('OS DevKit 1.61 screen-ID graphics binding', () => {
  it('binds an existing screen to stable native records and the shared planar drawing path', () => {
    const source = [
      'Screen Open 0,32,16,4,Lowres',
      '_scr id from pointer 7,Screen Base : _scr id use 7',
      'Print _scr id in use,_scr id base(7)=Screen Base,_scr id rport(7)<>0,_scr id vport(7)<>0',
      'Print _scr id width(7),_scr id height(7),_scr id depth(7),_scr id mode(7)',
      '_scr id ink 3,0,0 : _scr id gr writing 0 : _scr id set line $ffff',
      '_scr id plot 1,1 : Print _scr id point(1,1)',
      '_scr id gr locate 0,2 : _scr id line to 3,2 : _scr id rect 4,1 To 7,3 : _scr id ellipse 10,5,2,1',
      '_scr id text 1,8,"abc" : Print _rp what xgr(_scr id rport(7))',
      '_scr id hide 7 : _scr id show 7 : _scr id cls 0 : Print _scr id point(1,1)',
      '_scr id close 7 : Print _scr id base(7)',
    ].join('\n')
    expect(run(source).output).toBe(' 7\t-1\t-1\t-1\n 32\t 16\t 2\t 0\n 3\n 25\n 0\n 0\n')
  })

  it('clips drawing through the shared screen RastPort while SetRast still clears all of it', () => {
    const source = [
      'Screen Open 0,16,8,4,Lowres : _scr id from pointer 7,Screen Base : _scr id use 7',
      '_scr id ink 3,0,0 : _scr id clip 4,2 To 7,4 : _scr id bar 0,0 To 15,7',
      'A=_scr id point(3,2) : B=_scr id point(4,2) : C=_scr id point(7,4) : D=_scr id point(8,4)',
      '_scr id cls 1 : E=_scr id point(0,0) : F=_scr id point(15,7) : Print A,B,C,D : Print E,F',
    ].join('\n')
    const { rt, output } = run(source)
    expect(output).toBe(' 1\t 3\t 3\t 1\n 1\t 1\n')
    expect(rt.screen.rp.clip).toEqual({ x1: 4, y1: 2, x2: 7, y2: 4 })
  })

  it('binds a non-Workbench public screen to its actual native slot', () => {
    const { output } = run('_scr id from pub 9,"Shared" : Print _scr id width(9),_scr id height(9)', (rt) => {
      const address = rt.intuition.openScreen({
        width: 123, height: 77, depth: 2, hires: false, laced: false,
        palette: [], displayY: 0, title: 'Shared',
      })
      expect(rt.intuition.publishPubScreen('Shared', address)).toBe(true)
    })
    expect(output).toBe(' 123\t 77\n')
  })
})

describe('OS DevKit 1.61 shared GadTools ownership', () => {
  it('builds its native gadget defaults and contexts in the runtime GadTools object space', () => {
    const source = [
      'Screen Open 0,32,16,4,Lowres : _scr id from pointer 1,Screen Base',
      '_wnd id open 1,0,0,32,16,0,0,0,"GadTools"',
      'T=_to str("Go") : V=_ggad vinf get(Screen Base,0)',
      '_ggad def body -2,-3,20,9 : _ggad def text T : _ggad def id $12345 : _ggad def flags $20',
      '_ggad def user $12345678 : _ggad def vinf V : _ggad def font $23456789',
      'Print _ggad wdef left,_ggad wdef top,_ggad wdef width,_ggad wdef height',
      'Print _ggad wdef text=T,Hex$(_ggad wdef id),Hex$(_ggad wdef flags),Hex$(_ggad wdef user),_ggad wdef vinf=V,Hex$(_ggad wdef font)',
      'P=_struct alloc(4) : Print _ggad context(P) : C=_struct long(P,0) : G=_ggad create(1,C,0) : Print C<>0,G<>0',
      'Print _ggad add(G,_wnd id base(1),-1) : _ggad define 1,2,3,4,T,$10,$11111,$22222222',
      'Print _ggad wdef left,_ggad wdef top,_ggad wdef width,_ggad wdef height,Hex$(_ggad wdef font),Hex$(_ggad wdef flags),Hex$(_ggad wdef id),Hex$(_ggad wdef user)',
      '_ggad free C : _ggad vinf free V : _struct free P : _str free T : _wnd id close 1 : _scr id close 1',
    ].join('\n')
    expect(run(source).output).toBe('-2\t-3\t 20\t 9\n-1\t$2345\t$20\t$12345678\t-1\t$23456789\n-1\n-1\t-1\n 0\n 1\t 2\t 3\t 4\t$23456789\t$10\t$1111\t$22222222\n')
  })
})

describe('OS DevKit 1.61 Window-ID lifecycle', () => {
  it('opens, selects and closes an owned native window wrapper on the current screen', () => {
    const source = [
      'Screen Open 0,64,32,4,Lowres : _scr id from pointer 1,Screen Base',
      '_wnd id open 3,2,1,32,16,0,$200,0,"Native"',
      'W=_wnd id base(3) : Print W<>0,_wnd id in use',
      'Print _struct uword(W,4),_struct uword(W,6),_struct uword(W,8),_struct uword(W,10)',
      'Print _struct long(W,46)=_scr id base(1),_struct long(W,50)<>0,_struct long(W,82)<>0',
      '_wnd id use 3 : Print _wnd id in use',
      '_wnd id close 3 : Print _wnd id base(3),_wnd id in use',
      '_scr id close 1',
    ].join('\n')
    expect(run(source).output).toBe('-1\t 3\n 2\t 1\t 32\t 16\n-1\t-1\t-1\n 3\n 0\t-1\n')
  })

  it('draws through the selected window native RastPort and its window-relative origin', () => {
    const source = [
      'Screen Open 0,64,32,4,Lowres : _scr id from pointer 1,Screen Base',
      '_wnd id open 3,2,1,32,16,0,0,0,"Draw" : _wnd id use 3',
      '_wnd id cls 0 : _wnd id ink 3,0,1 : _wnd id gr writing 0 : _wnd id set line $ffff',
      '_wnd id plot 1,1 : Print _wnd id point(1,1)',
      '_wnd id gr locate 0,2 : _wnd id line to 3,2 : _wnd id line 0,3 To 3,3',
      '_wnd id rect 4,1 To 7,3 : _wnd id ellipse 10,5,2,1 : _wnd id bar 12,1 To 14,3',
      '_wnd id fill ellipse 18,5,2,1 : Print _wnd id point(18,5)',
      '_wnd id text 1,8,"abc" : Print _rp what xgr(_struct long(_wnd id base(3),50))',
      '_wnd id set paint 1 : _wnd id pattern on : _wnd id pattern off',
      '_wnd id set low pattern 1,2,3,4,5,6,7,8 : _wnd id set high pattern 9,10,11,12,13,14,15,16',
      '_wnd id ink 2,0,1 : _wnd id paint 20,10,0 : _wnd id scroll 0,0 To 8,8,1,0',
      '_wnd id close 3 : _scr id close 1',
    ].join('\n')
    expect(run(source).output).toBe(' 3\n 3\n 25\n')
  })
})
