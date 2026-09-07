import { describe, expect, it } from 'vitest'
import { mustFinish } from '../testing/run'
import { extensionById } from '../ext/registry'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/source'
import { fixedClock } from '../amiga/host'
import { Runtime } from './runtime'
import { BankImage, ObjectBank } from './objects'
import { AmigaFS, MemoryVolume } from '../amiga/vfs'
import { KIND } from '../amiga/gadtools'
import { writeIcon } from '../amiga/icon'

const core = new TokenTable(CORE_TOKENS)
const os = extensionById('os-devkit-1.61')!

function boot(source: string, prepare?: (rt: Runtime) => void): { rt: Runtime; output: () => string } {
  const extensions = new Map([[20, os.table]])
  const fs = new AmigaFS(); fs.mount('RAM', new MemoryVolume()); fs.mount('ENV', new MemoryVolume())
  let output = ''
  const rt = new Runtime(tokenize(source, core, extensions), core, {
    extensions,
    extBindings: new Map([[20, os]]),
    host: { clock: fixedClock() },
    fs,
    maxSteps: 200_000,
    onText: (text) => { output += text },
  })
  prepare?.(rt)
  return { rt, output: () => output }
}

function run(source: string, prepare?: (rt: Runtime) => void): { rt: Runtime; output: string } {
  const b = boot(source, prepare)
  mustFinish(b.rt.runHeadless(100))
  return { rt: b.rt, output: b.output() }
}

describe('OS DevKit 1.61 callable scalar slice', () => {
  it('wires the binary-derived 32-class resource tracker into all four keywords', () => {
    const { rt, output } = run([
      'Track Set 3,$1234 : Track Set 3,$1234 : Track Add 3,$1234',
      'Print Track Exist(3,$1234),Track Exist(4,$1234)',
      'Track Unset 3,$1234 : Print Track Exist(3,$1234)',
      'Track Unset 3,$1234 : Print Track Exist(3,$1234)',
    ].join('\n'))
    expect(output).toBe(' 1\t 0\n 1\n 0\n')
    expect(rt.osdevkit.tracker.entries(3)).toEqual([])
  })

  it('exposes guarded one-based WBArg name and lock fields from native memory', () => {
    const { output } = run([
      'Reserve As Work 1,16 : A=Start(1)',
      'Loke A,$1111 : Loke A+4,$AAAA : Loke A+8,$2222 : Loke A+12,$BBBB',
      'Print _arg what str(A,2,2),_arg what lock(A,2,2)',
      'Print _arg what str(A,2,0),_arg what lock(A,2,3),_arg what str(0,2,1)',
    ].join('\n'))
    expect(output).toBe(' 48059\t 8738\n 0\t 0\t 0\n')
  })

  it('folds all pointer and AMOS-string ToolType wrappers into icon.library', () => {
    const { output } = run([
      'N=_to str("RAM:tool") : T=_to str("filetype") : V=_to str("paintprogram")',
      'D=_icon load(N) : P=_tool find(D,T)',
      'Print _str get(P),_tool match(P,V),P=_tool find(D,T)',
      'Print _tool get$(D,"FILETYPE"),_tool exist(D,"quiet"),_tool exist(D,"missing")',
      'Print _tool val match$("ILBM|AMOS","amos"),_tool val match$("ILBM | AMOS","AMOS")',
      '_icon free D',
    ].join('\n'), (rt) => {
      rt.vfs!.writeFile('RAM:tool.info', writeIcon({
        type: 4, normal: null, selected: null, defaultTool: '',
        toolTypes: ['FILETYPE=PaintProgram|ILBM', 'QUIET'], stackSize: 4096, drawer: false,
      }))
    })
    expect(output).toBe('PaintProgram|ILBM\t-1\t-1\nPaintProgram|ILBM\t-1\t 0\n-1\t 0\n')
  })

  it('reads and writes the exact 20-byte native IntuiText layout', () => {
    const { output } = run([
      'Reserve As Work 1,40 : A=Start(1) : B=A+20',
      '_it set A,3,4,5,-12,-34,$11223344,$55667788,B',
      'Print _it what front pen(A),_it what back pen(A),_it what draw mode(A)',
      'Print _it what left(A),_it what top(A),Hex$(_it what font(A)),Hex$(_it what str(A)),_it what next(A)=B',
      '_it set draw A,7,8,9 : _it set corner A,123,234 : _it set font A,1 : _it set str A,2 : _it set next A,3',
      'Print _it what front pen(A),_it what back pen(A),_it what draw mode(A),_it what left(A),_it what top(A)',
      'Print _it what font(A),_it what str(A),_it what next(A)',
    ].join('\n'))
    expect(output).toBe(' 3\t 4\t 5\n-12\t-34\t$11223344\t$55667788\t-1\n 7\t 8\t 9\t 123\t 234\n 1\t 2\t 3\n')
  })

  it('uses native IntuiText fields for metrics and RastPort text state', () => {
    const { output } = run([
      'I=_struct alloc(20) : R=_struct alloc(72) : S=_to str("Hi")',
      '_it set I,3,4,5,5,7,0,S,0 : Print _it what len(I)',
      '_it print I,R,10,20',
      'Print _struct ubyte(R,25),_struct ubyte(R,26),_struct ubyte(R,28),_struct word(R,36),_struct word(R,38)',
      '_struct free R : _struct free I : _str free S',
    ].join('\n'))
    expect(output).toBe(' 16\n 3\t 4\t 5\t 31\t 27\n')
  })

  it('exposes every field of the 44-byte native Gadget layout', () => {
    const { output } = run([
      'Reserve As Work 1,44 : G=Start(1)',
      '_gad set next G,$10111213 : _gad set body G,$8001,$8002,$8003,$8004',
      '_gad set fat G,$2122,$2324,$2526 : _gad set render G,$31323334,$41424344',
      '_gad set text G,$51525354 : _gad set spec info G,$61626364 : _gad set user G,$7172,$81828384',
      'Print Hex$(_gad what next(G)),Hex$(_gad what left(G)),Hex$(_gad what top(G)),Hex$(_gad what width(G)),Hex$(_gad what height(G))',
      'Print Hex$(_gad what flags(G)),Hex$(_gad what activation(G)),Hex$(_gad what type(G))',
      'Print Hex$(_gad what render(G)),Hex$(_gad what h render(G)),Hex$(_gad what text(G))',
      'Print Hex$(_gad what spec info(G)),Hex$(_gad what user id(G)),Hex$(_gad what user data(G))',
    ].join('\n'))
    expect(output).toBe([
      '$10111213\t$8001\t$8002\t$8003\t$8004',
      '$2122\t$2324\t$2526',
      '$31323334\t$41424344\t$51525354',
      '$61626364\t$7172\t$81828384',
      '',
    ].join('\n'))
  })

  it('retains NewScreen defaults and reads the exact public Screen fields', () => {
    const { output } = run([
      '_scr def body -1,-2,320,200,5 : _scr def pens 6,7',
      '_scr def title $11111111 : _scr def font $22222222 : _scr def bmap $33333333',
      '_scr def vmodes $4444 : _scr def type $5555',
      'Print Hex$(_scr wdef title),Hex$(_scr wdef font),Hex$(_scr wdef bmap),Hex$(_scr wdef vmodes),Hex$(_scr wdef type)',
      'Reserve As Work 1,346 : S=Start(1)',
      'Loke S,$10111213 : Loke S+4,$20212223 : Doke S+12,640 : Doke S+14,256',
      'Doke S+16,-30 : Doke S+18,-40 : Doke S+20,$1234 : Loke S+22,$31323334 : Loke S+26,$41424344',
      'Poke S+30,9 : Loke S+40,$51525354 : Doke S+76,$6162 : Poke S+189,6',
      'Poke S+330,10 : Poke S+331,11 : Loke S+334,$71727374',
      'Print Hex$(_scr what next(S)),Hex$(_scr what first wnd(S)),_scr what width(S),_scr what height(S)',
      'Print _scr what x mouse(S),_scr what y mouse(S),Hex$(_scr what title(S)),Hex$(_scr what def title(S))',
      'Print Hex$(_scr what font(S)),_scr what depth(S),_scr what d pen(S),_scr what b pen(S),_scr what barh(S)',
      'Print Hex$(_scr what vmodes(S)),Hex$(_scr what type(S)),Hex$(_scr what layer(S)),_scr what bmap(S)=S+184',
      '_scr set title S,$81828384 : _scr set def title S,$91929394',
      'Print Hex$(_scr what title(S)),Hex$(_scr what def title(S))',
    ].join('\n'))
    expect(output).toBe([
      '$11111111\t$22222222\t$33333333\t$4444\t$5555',
      '$10111213\t$20212223\t 640\t 256',
      '-40\t-30\t$31323334\t$41424344',
      '$51525354\t 6\t 10\t 11\t 9',
      '$6162\t$1234\t$71727374\t-1',
      '$81828384\t$91929394',
      '',
    ].join('\n'))
  })

  it('retains NewWindow definitions and exposes the complete public Window prefix', () => {
    const { output } = run([
      '_wnd def body 1,2,320,100 : _wnd def limits 10,20,640,256 : _wnd def pens 3,4',
      '_wnd def idcmp $11111111 : _wnd def flags $22222222 : _wnd def gad $33333333',
      '_wnd def image $44444444 : _wnd def title $55555555 : _wnd def scr $66666666',
      '_wnd def bmap $77777777 : _wnd def type $8888',
      'Print _wnd wdef left,_wnd wdef top,_wnd wdef width,_wnd wdef height,_wnd wdef d pen,_wnd wdef b pen',
      'Print Hex$(_wnd wdef idcmp),Hex$(_wnd wdef flags),Hex$(_wnd wdef gad),Hex$(_wnd wdef image)',
      'Print Hex$(_wnd wdef title),Hex$(_wnd wdef scr),Hex$(_wnd wdef bmap),Hex$(_wnd wdef type)',
      'Print _wnd wdef min width,_wnd wdef min height,_wnd wdef max width,_wnd wdef max height',
      'Reserve As Work 1,144 : W=Start(1) : S=W+136',
      'Loke S+4,$10111213 : Loke W,$20212223 : Loke W+32,$30313233 : Loke W+46,$40414243 : Loke W+50,$50515253',
      'Doke W+4,11 : Doke W+6,12 : Doke W+8,320 : Doke W+10,100 : Doke W+12,-5 : Doke W+14,-6',
      'Poke W+54,1 : Poke W+55,2 : Poke W+56,3 : Poke W+57,4 : Loke W+124,$60616263 : Loke W+128,$70717273',
      'Print Hex$(_wnd what front(S)),Hex$(_wnd what next(W)),Hex$(_wnd what title(W)),Hex$(_wnd what scr(W)),Hex$(_wnd what rport(W))',
      'Print _wnd what left(W),_wnd what top(W),_wnd what width(W),_wnd what height(W),_wnd what x mouse(W),_wnd what y mouse(W)',
      'Print _wnd what bdr left(W),_wnd what bdr top(W),_wnd what bdr right(W),_wnd what bdr bottom(W)',
      'Print Hex$(_wnd what layer(W)),Hex$(_wnd what font(W))',
    ].join('\n'))
    expect(output).toBe([
      ' 1\t 2\t 320\t 100\t 3\t 4',
      '$11111111\t$22222222\t$33333333\t$44444444',
      '$55555555\t$66666666\t$77777777\t$8888',
      ' 10\t 20\t 640\t 256',
      '$10111213\t$20212223\t$30313233\t$40414243\t$50515253',
      ' 11\t 12\t 320\t 100\t-6\t-5',
      ' 1\t 2\t 3\t 4',
      '$60616263\t$70717273',
      '',
    ].join('\n'))
  })

  it('wires ReportMouse, display handles and Window-ID data into shared state', () => {
    const { output } = run([
      'Reserve As Work 1,136 : W=Start(1) : Loke W+24,$10000000',
      '_mouse report W : Print Hex$(Leek(W+24)) : _mouse unreport W : Print Hex$(Leek(W+24))',
      'H=_disp info find($21000) : Print H<>0,Leek(H)=$21000,_disp info find($21000)=H,_disp info find($11000)',
      '_wnd id data(7)=$89ABCDEF : Print Hex$(_wnd id data(7)),_wnd id data(6)',
    ].join('\n'))
    expect(output).toBe('$10000200\n$10000000\n-1\t-1\t-1\t 0\n$89ABCDEF\t 0\n')
  })

  it('shares Locale strings and catalog parsing through managed native handles', () => {
    const { rt, output } = run([
      'L=_loc open(0) : P=_loc str(L,$27) : Print _loc init,L<>0,_str get(P),_loc str(L,$27)=P',
      'N=_to str("RAM:test.catalog") : D=_to str("Default") : C=_cat open(L,N,0)',
      'T=_cat str(C,7,D) : Print C<>0,_str get(T),_cat str(C,8,D)=D,_cat str(0,7,D)=D',
      '_cat close C : _loc close L',
    ].join('\n'), (runtime) => {
      runtime.vfs!.writeFile('RAM:test.catalog', Uint8Array.from([
        70, 79, 82, 77, 0, 0, 0, 28, 67, 84, 76, 71,
        83, 84, 82, 83, 0, 0, 0, 16,
        0, 0, 0, 7, 0, 0, 0, 6, 83, 97, 108, 117, 116, 0, 0, 0,
      ]))
    })
    expect(output).toBe('-1\t-1\tYes\t-1\n-1\tSalut\t-1\t-1\n')
    expect(rt.osdevkit.locales.size).toBe(0)
    expect(rt.osdevkit.catalogs.size).toBe(0)
  })

  it('exposes shared library metadata and Exec memory queries', () => {
    const { output } = run([
      'G=_lib open("graphics.library",0) : Print _lib version(G),_lib revision(G),_lib version(0)',
      'A=_mem avail(2) : P=_mem alloc(100,2) : Print A-_mem avail(2),_mem type(P),_mem type(P+99),_mem type(0)',
      '_mem free P,100 : Print _mem avail(2)=A : _lib close G',
    ].join('\n'))
    expect(output).toBe(' 40\t 0\t 0\n 104\t 3\t 3\t 0\n-1\n')
  })

  it('wires cache, chipset, ViewPort mode and saved register controls', () => {
    const { rt, output } = run([
      'Print Hex$(_cache ctrl($A,$F)),Hex$(_cache ctrl($5,$3))',
      'Print Hex$(_chip set rev(3)),Hex$(_chip set rev(-1))',
      'V=_struct alloc(40) : Doke V+32,$8123 : Print Hex$(_vp get mode(V)) : _struct free V',
      '_dreg(2)=$12345678 : _areg(7)=-9 : _dreg(9)=10',
      'Print Hex$(_dreg(2)),_areg(7),_dreg(9)',
      '_amos name "abcdefghijklmnopqrstuvwxyz0123456789"',
    ].join('\n'))
    expect(output).toBe('$0\t$A\n$F\t$3\n$8123\n$12345678\t-9\t 0\n')
    expect(rt.machine.cpu.cacheBits).toBe(9)
    expect(rt.osdevkit.chipRevision).toBe(0xf)
    expect(rt.osdevkit.amosName).toBe('~abcdefghijklmnopqrstuvwxyz0123')
  })

  it('shares V39 pool allocations with the native arena and owns their lifetime', () => {
    const { rt, output } = run([
      'X=_mem alloc(8,0) : Poke X,99 : _mem free X,8',
      'P=_pool create($10002,4096,256) : A=_pool alloc(P,8)',
      'Print P<>0,A<>0,_mem type(A),Peek(A)',
      '_pool free P,A,8 : Print _mem type(A)',
      'B=_pool alloc(P,8) : _pool delete P : Print _mem type(B)',
    ].join('\n'))
    expect(output).toBe('-1\t-1\t 3\t 0\n 0\n 0\n')
    expect(rt.osdevkit.pools.size).toBe(0)
  })

  it('routes ViewPort RGB4 and RGB32 updates into the selected shared screen', () => {
    const { output } = run([
      '_scr id open 1,0,0,64,32,4,0,0,"Palette" : V=_scr id vport(1)',
      '_rgb4 set V,2,$A,$B,$C : Print Hex$(_scr id get pal(2))',
      'T=_struct alloc(4) : Doke T,$0123 : Doke T+2,$0456 : _rgb4 load V,T,2',
      'Print Hex$(_scr id get pal(0)),Hex$(_scr id get pal(1))',
      '_rgb32 set V,3,$12000000,$34000000,$56000000 : Print Hex$(_scr id get aga pal(3))',
      'U=_struct alloc(16) : Doke U,1 : Doke U+2,4 : Loke U+4,$78000000 : Loke U+8,$9A000000 : Loke U+12,$BC000000',
      '_rgb32 load V,U : Print Hex$(_scr id get aga pal(4))',
      '_struct free U : _struct free T : _scr id close 1',
    ].join('\n'))
    expect(output).toBe('$ABC\n$123\t$456\n$123456\n$789ABC\n')
  })

  it('allocates native BitMaps and planes in the shared memory arena', () => {
    const { rt, output } = run([
      'B=_bm alloc(17,3,2,1,0) : P=_bm what plane(B,0)',
      'Print B<>0,P<>0,_bm what modulo(B),_bm what height(B),_bm what depth(B),_bm what flags(B)',
      'Print _bm what attr(B,0),_bm what attr(B,4),_bm what attr(B,8),_bm what attr(B,12),Peek(P)',
      '_bm set plane B,1,$12345678 : Print Hex$(_bm what plane(B,1))',
      '_bm free B',
    ].join('\n'))
    expect(output).toBe('-1\t-1\t 4\t 3\t 2\t 1\n 3\t 2\t 17\t 1\t 0\n$12345678\n')
    expect(rt.osdevkit.bitMaps.size).toBe(0)
  })

  it('owns classic hardware sprite slots through native SimpleSprite records', () => {
    const { rt, output } = run([
      'S=_struct alloc(12) : N=_spr get(S,3) : Print N,_spr get(S,4),_struct uword(S,10)',
      '_spr change $11111111,S,$22222222 : _spr move $33333333,S,-5,300',
      'Print Hex$(_struct long(S,0)),_struct word(S,6),_struct word(S,8)',
      '_spr free N : _spr free 4 : T=_struct alloc(12) : Print _spr get(T,-1)',
      '_spr free 0 : _struct free T : _struct free S',
    ].join('\n'))
    expect(output).toBe(' 3\t 4\t 4\n$22222222\t-5\t 300\n 0\n')
    expect(rt.osdevkit.hardwareSprites.every((entry) => entry === null)).toBe(true)
  })

  it('wires task priority, interrupt chains and message waits through shared Exec', () => {
    const { rt, output } = run([
      'T=_task find(0) : Print _task set pri(T,5),_task set pri(T,-3)',
      'I=_int alloc : _nod set pri I,7 : _int add 4,I',
      'P=_port create : Print _port wait(P),_gmsg get(P) : _gmsg reply 0',
      '_int rem 4,I : _int free I : _port delete P',
    ].join('\n'))
    expect(output).toBe(' 0\t 5\n 0\t 0\n')
    expect(rt.exec.tasks.priority(rt.exec.tasks.currentTask)).toBe(-3)
    expect(rt.exec.interrupts.servers(4)).toEqual([])
  })

  it('folds raw Window mutation and pointer calls into Window-ID Intuition state', () => {
    const { rt, output } = run([
      'Screen Open 0,200,100,4,Lowres : _scr id from pointer 1,Screen Base',
      '_wnd id open 2,10,10,80,50,0,0,0,"Old" : W=_wnd id base(2)',
      'T=_to str("New") : S=_to str("Screen") : _wnd set titles W,T,S : _wnd set idcmp W,$12345678',
      '_wnd set limits W,20,20,120,80 : _wnd move W,5,6 : _wnd size W,10,10',
      'Print _wnd what left(W),_wnd what top(W),_wnd what width(W),_wnd what height(W),Hex$(_wnd what idcmp(W))',
      'Print _str get(_wnd what title(W)),_str get(_wnd what scr title(W))',
      '_ptr set W,$11111111,16,2,-3,4 : _wnd activate W : Print Hex$(_wnd what pointer(W)),_wnd what active=W,_wnd what vport(W)=_scr id vport(1)',
      'Print Hex$(_struct long(W,74)),_wnd what pointer height(W),_wnd what pointer width(W),_wnd what pointer xoff(W),_wnd what pointer yoff(W)',
      '_wnd to back W : _wnd to front W',
      '_wnd box W,1,2,60,40 : Print _wnd what left(W),_wnd what top(W),_wnd what width(W),_wnd what height(W)',
      '_ptr clear W : _wnd id close 2 : _scr id close 1',
    ].join('\n'))
    expect(output).toBe(' 15\t 16\t 90\t 60\t$12345678\nNew\tScreen\n$11111111\t-1\t-1\n$11111111\t 16\t 2\t 253\t 4\n 1\t 2\t 60\t 40\n')
    expect(rt.intuition.windows).toHaveLength(0)
  })

  it('closes a managed native Window pointer through the raw lifecycle worker', () => {
    const { rt, output } = run([
      'Screen Open 0,80,40,4,Lowres : _scr id from pointer 1,Screen Base',
      '_wnd id open 2,1,2,30,20,0,0,0,"Raw close" : W=_wnd id base(2)',
      '_wnd close W : Print _wnd id base(2),_wnd what active',
      '_scr id close 1',
    ].join('\n'))
    expect(output).toBe(' 0\t 0\n')
    expect(rt.intuition.windows).toHaveLength(0)
  })

  it('refreshes and scrolls through a raw Window pointer on the shared raster backend', () => {
    const { output } = run([
      'Screen Open 0,40,20,4,Lowres : _scr id from pointer 1,Screen Base',
      '_wnd id open 2,5,3,20,10,0,0,0,"Raster" : W=_wnd id base(2)',
      '_wnd id use 2 : _wnd id cls 0 : _wnd id ink 3,0,1 : _wnd id plot 5,5',
      '_wnd refresh frame W : _wnd scroll raster W,1,0,0,0 To 10,8',
      'Print _wnd id point(5,5),_wnd id point(4,5)',
      '_wnd close W : _scr id close 1',
    ].join('\n'))
    expect(output).toBe(' 0\t 3\n')
  })

  it('shares, filters, clears and detaches Window UserPorts through the Exec queue', () => {
    const { rt, output } = run([
      'Screen Open 0,80,40,4,Lowres : _scr id from pointer 1,Screen Base',
      '_wnd id open 2,1,1,30,15,0,$C0000,0,"Ports" : _wnd id open 3,35,1,30,15,0,0,0,"Other"',
      'W=_wnd id base(2) : P=_port create : _wnd share port W,P : _wnd id activate 2',
      'Print _wnd what user port(W)=P,Hex$(_wnd wait port(W,$40000)),_wnd id event wnd',
      '_wnd id activate 3 : _wnd id activate 2 : _wnd clear port W : Print _port wait(P)',
      '_wnd unshare port W : Print _wnd what user port(W),_wnd what idcmp(W)',
      '_wnd close W : _wnd id close 3 : _port delete P : _scr id close 1',
    ].join('\n'))
    expect(output).toBe('-1\t$40000\t 2\n 0\n 0\t 0\n')
    expect(rt.intuition.windows).toHaveLength(0)
  })

  it('reproduces the three obsolete Preferences workers as zero-returning stubs', () => {
    const { output } = run('Print _prfs get def(123,1),_prfs get(456,2),_prfs set(789,3,1)')
    expect(output).toBe(' 0\t 0\t 0\n')
  })

  it('folds caller-owned old-style Requesters into the shared Window lifecycle', () => {
    const { rt, output } = run([
      'Reserve As Work 1,112 : R=Start(1) : Doke R,$1234 : _req init R',
      'Screen Open 0,200,100,4,Lowres : _scr id from pointer 1,Screen Base',
      '_wnd id open 3,10,10,160,80,0,0,0,"Requester" : W=_wnd id base(3)',
      'Print Deek(R),_req do(R,W),_req do(R,W) : _req end R,W : Print _req do(R,W)',
      '_wnd id close 3 : _scr id close 1',
    ].join('\n'))
    expect(output).toBe(' 0\t 1\t 0\n 1\n')
    expect(rt.osdevkit.requesterWindows.size).toBe(0)
  })

  it('allocates ASL public records and follows their exact field and WBArg offsets', () => {
    const { rt, output } = run([
      'R=_asl alloc(0,0) : Reserve As Work 2,16 : A=Start(2)',
      'Loke R+4,111 : Loke R+8,222 : Loke R+32,2 : Loke R+36,A',
      'Loke A+4,333 : Loke A+12,444',
      'Print R<>0,_asl what file(R),_asl what file(R,1),_asl what file(R,2),_asl what file(R,3)',
      'Print _asl what drawer(R),_asl what nb args(R),_asl what font(R)=R+8',
      '_asl free R',
    ].join('\n'))
    expect(output).toBe('-1\t 111\t 333\t 444\t 0\n 222\t 2\t-1\n')
    expect(rt.osdevkit.aslRequests.size).toBe(0)
  })

  it('runs _asl do through the shared modal file requester and updates its public fields', () => {
    const b = boot('R=_asl alloc(0,0) : Print _asl do(R,0) : Print _str get(_asl what drawer(R)),_str get(_asl what file(R)) : _asl free R')
    b.rt.frame()
    expect(b.rt.asl).not.toBeNull()
    b.rt.asl!.setup.dir = 'RAM:Work'
    b.rt.asl!.setup.file = 'picked.amos'
    b.rt.asl!.result = 'RAM:Work/picked.amos'
    b.rt.asl!.done = true
    mustFinish(b.rt.runHeadless(100))
    expect(b.output()).toBe(' 1\nRAM:Work\tpicked.amos\n')
    expect(b.rt.osdevkit.aslRequests.size).toBe(0)
  })

  it('merges allocation and request TagItems for ASL worker 1595', () => {
    const b = boot([
      'D=_to str("RAM:Work") : F=_to str("old.amos") : A=_to str("Allocated") : Q=_to str("Requested")',
      'T=_tag list alloc(4) : _tag set T,$80080009,D : _tag set T,$80080008,F : _tag set T,$80080001,A : _tag done T',
      'U=_tag list alloc(4) : _tag set U,$80080001,Q : _tag set U,$80080005,260 : _tag set U,$8008003c,1 : _tag done U',
      'R=_asl alloc(0,T) : X=_asl do(R,U)',
    ].join('\n'))
    b.rt.frame()
    expect(b.rt.asl?.setup).toMatchObject({
      hail: 'Requested', dir: 'RAM:Work', file: 'old.amos', width: 260, rejectIcons: true,
    })
  })

  it('runs _asl file$ through the same requester and returns its selected path', () => {
    const b = boot('Print "["+_asl file$(0,"Pick","RAM:","old.amos","#?.amos")+"]"')
    b.rt.frame()
    expect(b.rt.asl?.setup).toMatchObject({ hail: 'Pick', dir: 'RAM:', file: 'old.amos', pattern: '#?.amos' })
    b.rt.asl!.result = 'RAM:new.amos'
    b.rt.asl!.done = true
    mustFinish(b.rt.runHeadless(100))
    expect(b.output()).toBe('[RAM:new.amos]\n')
  })

  it('writes modal font and screen-mode results into their native public records', () => {
    const font = boot('R=_asl alloc(1,0) : Print _asl do(R,0) : T=_asl what font(R) : Print _str get(_struct long(T,0)),_struct uword(T,4) : _asl free R')
    font.rt.frame()
    font.rt.aslFont!.result = 'courier.font'; font.rt.aslFont!.resultSize = 13; font.rt.aslFont!.done = true
    mustFinish(font.rt.runHeadless(100))
    expect(font.output()).toBe(' 1\ncourier.font\t 13\n')

    const mode = boot('R=_asl alloc(2,0) : Print _asl do(R,0) : Print _struct long(R,0),_struct long(R,4),_struct long(R,8),_struct uword(R,12) : _asl free R')
    mode.rt.frame()
    Object.assign(mode.rt.aslMode!.setup, { displayWidth: 640, displayHeight: 512, depth: 4 })
    mode.rt.aslMode!.result = 0x00029004; mode.rt.aslMode!.done = true
    mustFinish(mode.rt.runHeadless(100))
    expect(mode.output()).toBe(' 1\n 167940\t 640\t 512\t 4\n')
  })

  it('shares HelpControl window state and the process-wide AmigaGuide lifecycle', () => {
    const { rt, output } = run([
      'Screen Open 0,200,100,4,Lowres : _scr id from pointer 1,Screen Base',
      '_wnd id open 3,10,10,160,80,0,0,0,"Help" : W=_wnd id base(3) : _help ctrl W,$1234',
      'N=_to str("RAM:manual.guide") : B=_to str("Manual")',
      'Print _ag display(_scr id base(1),N,B,7)<>0,_ag show(_scr id base(1),"RAM:other.guide")<>0',
    ].join('\n'))
    expect(output).toBe('-1\t-1\n')
    expect(rt.osdevkit.windowHandles.get(3)?.window.helpControlFlags).toBe(0x1234)
    expect(rt.amigaGuide.active.size).toBe(0)
    expect(rt.amigaGuide.lastLaunch).toMatchObject({ name: 'RAM:other.guide', baseName: '', context: 0 })
  })

  it('shares lowlevel SystemControlA takeover state with the runtime', () => {
    const { rt, output } = run('_sys own : Print 1 : _sys disown : Print 2')
    expect(output).toBe(' 1\n 2\n')
    expect(rt.lowlevel.ownsSystem).toBe(false)
  })

  it('shares recoverable and dead-end Exec Alert state with reset policy', () => {
    const recoverable = run('_alert $12345678 : Print 1')
    expect(recoverable.output).toBe(' 1\n')
    expect(recoverable.rt.exec.lastAlert).toEqual({ number: 0x12345678, source: '_alert', deadEnd: false })
    expect(recoverable.rt.machine.pendingReset).toBeNull()

    const deadEnd = run('_alert $80000001 : Print 2')
    expect(deadEnd.output).toBe('')
    expect(deadEnd.rt.exec.lastAlert).toEqual({ number: 0x80000001, source: '_alert', deadEnd: true })
    expect(deadEnd.rt.machine.pendingReset).toEqual({ kind: 'cold', by: '_alert $80000001' })
  })

  it('caches the private file image class and creates it through shared BOOPSI', () => {
    const { rt, output } = run([
      'C=_class get file : Print C<>0,C=_class get file',
      'T=_tag list alloc(1) : _tag set T,$80000001,77 : _tag done T',
      'O=_obj new(C,"",T) : Print O<>0,_obj what attr(O,$80000001) : _obj free O',
    ].join('\n'))
    expect(output).toBe('-1\t-1\n-1\t 77\n')
    expect(rt.boopsi.classAt(rt.osdevkit.fileImageClass)?.superClass?.id).toBe('imageclass')
  })

  it('shares the binary-derived StonePlayer control protocol', () => {
    const { rt, output } = run([
      'Print _sp install,_sp play(0,200),_sp play(100,0),_sp play(100,200),_sp check(100,200)',
      '_sp volume 12,34 : _sp balance 10,30 : _sp speed 7 : _sp mix 22050 : _fx balance -8',
      '_sp stop : _sp remove',
    ].join('\n'))
    expect(output).toBe(' 1\t 250\t 249\t 0\t-1\n')
    expect(rt.stonePlayer).toMatchObject({ installed: false, playing: false, leftVolume: 12, rightVolume: 34, balance: -8, speed: 7, mixPeriod: 158 })
  })
  it('selects the shared AMOS Samples bank through FX worker 1911', () => {
    const { rt } = run('_fx bank 65535 : _fx bank 0')
    expect(rt.samBankNum).toBe(65535)
  })
  it('routes Samples-bank FX playback through eight shared StonePlayer channels', () => {
    const record = [
      ...new TextEncoder().encode('TICK    '), 0x20, 0xab, 0, 0, 0, 4,
      10, 20, 30, 40,
    ]
    const data = new Uint8Array([0, 1, 0, 0, 0, 6, ...record])
    const { rt } = run('_fx bank 5 : _fx play %10010001,1,9000', runtime => {
      runtime.memBanks.set(5, { kind: 'memory', number: 5, memType: 1, name: 'Samples', flags: 0, data })
    })
    expect([...rt.stonePlayer.fxChannels.keys()]).toEqual([0, 4, 7])
    expect(rt.stonePlayer.fxChannels.get(7)).toEqual({ sample: 1, frequency: 9000, volume: 64 })
    expect(rt.stonePlayer.playing).toBe(true)
  })

  it('shares process-wide DOS IoErr and records ReportEvent arguments', () => {
    const { rt, output } = run('Print _dos err,_dos set err(205),_dos err,_dos report(212,1,$1234,$5678),_dos err', runtime => { runtime.craft.ioError = 111 })
    expect(output).toBe(' 111\t 111\t 205\t-1\t 212\n')
    expect(rt.dos.lastReport).toEqual({ error: 212, type: 1, argument: 0x1234, device: 0x5678 })
  })

  it('writes dos.library Fault text into caller-owned C buffers', () => {
    const { output } = run([
      'B=_struct alloc(32) : H=_to str("Load")',
      'Print _dos fault(205,H,B,32),_str get(B)',
      'R=_dos fault(205,0,B,8) : Print _str get(B)',
      '_str free H : _struct free B',
    ].join('\n'))
    expect(output).toBe(' 0\tLoad: Object not found\nObject \n')
  })

  it('mutates and returns pointers into caller-owned DOS path strings', () => {
    const { output } = run([
      'P=_str alloc(40) : N=_to str("serial.prefs") : _str put "RAM:ENV/Sys",P',
      'Print _dos add part(P,N,40),_str get(P)',
      'F=_dos file part(P) : D=_dos path part(P)',
      'Print F-P,D-P,_str get(F),Peek$(P,D-P)',
      'Print _dos add part(P,N,8),_str get(P)',
      '_str free N : _str free P',
    ].join('\n'))
    expect(output).toBe('-1\tRAM:ENV/Sys/serial.prefs\n 12\t 11\tserial.prefs\tRAM:ENV/Sys\n 0\tRAM:ENV/Sys/serial.prefs\n')
  })

  it('exposes the same DOS path boundaries through AMOS strings', () => {
    expect(run('Print _path add("RAM:ENV/Sys","serial.prefs"),_path part("RAM:ENV/Sys/serial.prefs"),_file part("RAM:ENV/Sys/serial.prefs")').output)
      .toBe('RAM:ENV/Sys/serial.prefs\tRAM:ENV/Sys\tserial.prefs\n')
  })

  it('shares native DOS handles across raw, buffered and convenience I/O', () => {
    const { output } = run([
      'N=_to str("RAM:dos.bin") : B=_str alloc(16) : _str put "ABC",B',
      'H=_dos open(N,1006) : Print H<>0,_dos write(H,B,3),_dos seek(H,0,1)',
      'Print _dos f putc(H,68),_dos lof(H),_fh name$(H) : _dos close H',
      'H=_dos opin("RAM:dos.bin") : Print _dos f getc(H),_dos f ungetc(H,-1),_dos f getc(H)',
      'Print _dos read(H,B,3),Peek$(B,3),_dos eof(H) : _dos close H',
      'H=_dos append("RAM:dos.bin") : Print _dos print(H,"EF"),_dos lof(H) : _dos close H',
      'H=_dos opin("RAM:dos.bin") : Print _dos input(H),_dos eof(H) : _dos close H',
      '_str free B : _str free N',
    ].join('\n'))
    expect(output).toBe('-1\t 3\t 3\n 68\t 4\tRAM:dos.bin\n 65\t 65\t 65\n 3\tBCD\t-1\n-1\t 6\nABCDEF\t-1\n')
  })

  it('retains DOS lock identity through names, parents and CurrentDir', () => {
    const { output } = run([
      'Mkdir "RAM:one" : Mkdir "RAM:one/two"',
      'L=_dos rd lock("RAM:one/two") : P=_dos l open(L) : B=_str alloc(32)',
      'Print L<>0,P<>0,_lock name$(L),_lock name$(P),_dos l name(L,B,32),_str get(B)',
      'O=_dos dir(L) : Print O<>0,_dos what dir$,_lock name$(O)',
      '_dos unlock O : _dos unlock P : _dos unlock L : _str free B',
    ].join('\n'))
    expect(output).toBe('-1\t-1\tRAM:one/two\tRAM:one\t-1\tRAM:one/two\n-1\tRAM:one/two\tRAM:\n')
  })

  it('delivers DOS notifications through shared Exec signals and messages', () => {
    const { output } = run([
      'P=_to str("RAM:watched") : T=_task find(0)',
      'S=_dos sig notify(P,T,5,77) : H=_dos opout("RAM:watched") : _dos close H',
      'Print S<>0,_nr what user(S),_sig wait(32) : _dos end notify S',
      'Q=_port create : M=_dos msg notify(P,Q,88)',
      'H=_dos opout("RAM:watched") : _dos close H : E=_msg get(Q)',
      'Print M<>0,_nr what user(M),E<>0,_nmsg what nreq(E)=M,_imsg what class(E),_imsg what code(E)',
      '_dos end notify M : _port delete Q : _str free P',
    ].join('\n'))
    expect(output).toBe('-1\t 77\t 32\n-1\t 88\t-1\t-1\t 1073741824\t 4660\n')
  })

  it('loads mapped hunk segments and launches NP_Seglist processes through the host seam', () => {
    const source = [
      'F=_to str("RAM:tool") : S=_dos seg load(F,0) : N=_to str("Worker")',
      'T=_tag list alloc(4) : _tag set T,$800003E9,S : _tag set T,$800003F3,8192',
      '_tag set T,$800003F4,N : _tag set T,$800003F5,3 : _tag done T',
      'P=_dos new proc(T) : Print S<>0,P<>0,_dos seg unload(S)',
      '_tag list free T : _str free N : _str free F',
    ].join('\n')
    let launched: { name: string; priority: number; stackSize: number } | null = null
    const { rt, output } = run(source, runtime => {
      const longs = [0x3f3, 0, 1, 0, 0, 1, 0x3e9, 1, 0x4e75_0000, 0x3f2]
      const bytes = new Uint8Array(longs.length * 4), view = new DataView(bytes.buffer)
      longs.forEach((value, i) => view.setUint32(i * 4, value))
      runtime.vfs?.writeFile('RAM:tool', bytes)
      runtime.host.process = { launch: request => { launched = request; return true } }
    })
    expect(output).toBe('-1\t-1\t-1\n')
    expect(launched).toEqual({ name: 'RAM:tool', priority: 3, stackSize: 8192 })
    expect(rt.osdevkit.dosSegments.size).toBe(0)
  })

  it('derives Workbench program identity from the retained launch name', () => {
    const { output } = run('Print _prg dir$,_prg name$', runtime => {
      Object.defineProperty(runtime, 'commandName', { value: 'RAM:Tools/paint.amos' })
    })
    expect(output).toBe('RAM:Tools\tpaint.amos\n')
  })

  it('shares Workbench lifecycle, AppItems and serialized DiskObjects', () => {
    const { rt, output } = run([
      'Print _base wb<>0,_wb open : _wb to back : _wb to front : Print _wb close,_wb open',
      'P=_port create : D=_icon def(3) : A=_app add icon(7,99,_to str("Tool"),P,0,D,0)',
      'M=_app add menu(8,88,_to str("Menu"),P,0) : W=_app add wnd(9,77,123,P,0)',
      'Print A<>0,M<>0,W<>0,_app rem icon(A),_app rem menu(M),_app rem wnd(W)',
      'Print _icon put("RAM:tool",D),_icon info(0,"RAM:tool") : _icon free D',
      'E=_icon get("RAM:tool") : Print E<>0,_icon del("RAM:tool") : _icon free E',
    ].join('\n'))
    expect(output).toBe('-1\t-1\n-1\t-1\n-1\t-1\t-1\t-1\t-1\t-1\n-1\t-1\n-1\t-1\n')
    expect(rt.workbench.items.size).toBe(0)
    expect(rt.icons.objects.size).toBe(0)
    expect(rt.vfs?.exists('RAM:tool.info')).toBe(null)
  })

  it('integrates DataTypes objects, attributes and window attachment on the shared backend', () => {
    const ilbm = Uint8Array.from([0x46,0x4f,0x52,0x4d,0,0,0,4,0x49,0x4c,0x42,0x4d])
    const { rt, output } = run([
      'T=_tag list alloc(1) : _tag set T,$80001001,77 : _tag done T',
      'O=_dt create(_to str("RAM:image.iff"),T) : Print _dt init<>0,O<>0,_dt add(O,123,0,4)',
      'Reserve As Data 1,4 : Q=_tag list alloc(1) : _tag set Q,$80001001,Start(1) : _tag done Q',
      'Print _dt what attrs(O,Q),Leek(Start(1)),_dt what methods(O)<>0,_dt what triggers(O)<>0,_dt do(O,123,0,0)',
      'Print _dt remove(123,O),Len(_dt str$(0)),_dt obtain(2,_to str("RAM:image.iff"),0)<>0 : _dt delete O',
    ].join('\n'), runtime => runtime.vfs?.writeFile('RAM:image.iff', ilbm))
    expect(output).toBe('-1\t-1\t 4\n 1\t 77\t-1\t-1\t 1\n 4\t 9\t-1\n')
    expect(rt.osdevkit.dataTypes.objects.size).toBe(0)
  })

  it('shares DOS variables through ENV: and parses CLI templates once', () => {
    const { rt, output } = run([
      '_dos var value$("Editor",256)="AMOS Pro"',
      'Print _dos var value$("editor",256),_dos var find("EDITOR",0)<>0',
      'Print _cli read args("FILE=demo.amos COUNT=12 QUIET","FILE/A/K,COUNT/N/K,QUIET/S")',
      'Print _cli what arg$(0),_cli what arg(1),_cli what arg(2),_dos var del("editor",256)',
    ].join('\n'))
    expect(output).toBe('AMOS Pro\t-1\n-1\ndemo.amos\t 12\t-1\t-1\n')
    expect(rt.vfs?.readFile('ENV:Editor')).toBe(null)
  })

  it('shares a Commodities broker, object graph and Exec message port', () => {
    const { rt, output } = run([
      'Print _cx init<>0,_cx install("Tool","Title","Description",1,0,0)',
      '_cx id create 1,1,10,20 : _cx id create 2,3,30,40 : _cx id attach 2 To 1',
      'Print _cx broker<>0,_cx msg port<>0,_cx id base(1)<>0,_cx id type(2),_cx id error(2)',
      '_cx id inactivate 2 : _cx id activate 2 : _cx disable : _cx enable : _cx uninstall',
    ].join('\n'))
    expect(output).toBe('-1\t 0\n-1\t-1\t-1\t 3\t 0\n')
    expect(rt.osdevkit.commodities.objects.size).toBe(0)
    expect(rt.osdevkit.commodities.port).toBe(0)
  })

  it('uses one iffparse backend for nested input chunks and native buffers', () => {
    const iff = Uint8Array.from([0x46,0x4f,0x52,0x4d, 0,0,0,14, 0x54,0x45,0x53,0x54, 0x44,0x41,0x54,0x41, 0,0,0,2, 0x12,0x34])
    const { output } = run([
      'Reserve As Data 1,2 : H=_iff open in("RAM:test.iff")',
      'Print _iff init<>0,_iff parse(H,1),Hex$(_chunk what id(_chunk current(H))),Hex$(_chunk what type(_chunk current(H)))',
      'Print _iff parse(H,1),Hex$(_chunk what id(_chunk current(H))),_chunk read(H,Start(1),2),Hex$(Deek(Start(1))) : _iff close H',
    ].join('\n'), rt => rt.vfs?.writeFile('RAM:test.iff', iff))
    expect(output).toBe('-1\t 0\t$464F524D\t$54455354\n 0\t$44415441\t 2\t$1234\n')
  })

  it('shares libraries, lowlevel input, timing and display ownership with the runtime', () => {
    const source = [
      'L=_lib open("lowlevel.library",40) : B=_low init : Print L<>0,B=L',
      'Print _joy type(1),_joy set(1,1),_joy type(1),_joy init(1),_joy type(1)',
      'Print _time elapsed,_key pressed : _sys own : _sys disown : _lib close L',
    ].join('\n')
    const { rt, output } = run(source, runtime => runtime.input.keys.add(32))
    expect(output).toBe('-1\t-1\n 3\t 3\t 1\t 1\t 3\n 0\t 32\n')
    expect(rt.copperOn).toBe(true)
    expect(rt.osdevkit.openLibraries.size).toBe(0)
  })

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
  it('exposes mapped embedded Topaz and default TagItem records', () => {
    const { output } = run([
      'A=_base topaz : Print _str get(_ta what name(A)),_ta what height(A),_ta what flags(A)',
      '_tag set 0,$12345678,99 : _tag done 0 : T=_base tag',
      'Print Hex$(_struct long(T,0)),_struct long(T,4),_struct long(T,8)',
    ].join('\n'))
    expect(output).toBe('topaz.font\t 8\t 1\n$12345678\t 99\t 0\n')
  })
  it('uses the machine-wide utility GetUniqueID source', () => {
    const { rt, output } = run('Print _id unique,_id unique')
    expect(output).toBe(' 1\t 2\n')
    expect(rt.uniqueIds.get()).toBe(3)
  })
  it('uses Intuition shared double-click preference timing', () => {
    const { output } = run('Print _dbl click(1,800000,2,100000),_dbl click(2,0,1,999999)')
    expect(output).toBe(' 1\t 0\n')
    const narrow = run('Print _dbl click(1,0,1,150000)', rt => { rt.intuition.doubleClickMicros = 100_000 })
    expect(narrow.output).toBe(' 0\n')
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

  it('replaces a channel allocation while preserving links and its data prefix', () => {
    const source = [
      'L=_chn list alloc(3) : A=_chn add(L,3) : B=_chn add(L,2)',
      '_struct ubyte(A,0)=10 : _struct ubyte(A,1)=20 : _struct ubyte(A,2)=30',
      'N=_chn new length(A,6)',
      'Print N<>0,N<>A,_chn what length(N),_chn what first(L)=N,_chn what previous(B)=N',
      'Print _struct ubyte(N,0),_struct ubyte(N,1),_struct ubyte(N,2),_struct ubyte(N,3)',
      '_chn list free L',
    ].join('\n')
    expect(run(source).output).toBe('-1\t-1\t 6\t-1\t-1\n 10\t 20\t 30\t 0\n')
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

  it('owns DrawInfo records and captures the selected Screen-ID pen policy', () => {
    const source = [
      '_scr id def dri pens v1 10,11,12,13,14,15,16,17,18',
      '_scr id def dri pens v2 19,20,21 : _scr id fix dri pens -1',
      '_scr id open 3,0,0,160,100,4,0,15,"Pens" : S=_scr id base(3) : D=_scr dinf get(S)',
      'P=_struct long(D,4) : Print D<>0,_struct uword(D,0),_struct uword(D,2),_struct uword(D,12)',
      'Print _struct uword(P,0),_struct uword(P,16),_struct uword(P,18),_struct uword(P,22),_struct long(D,8)<>0',
      '_scr dinf free S,D : _scr id close 3',
    ].join('\n')
    const { rt, output } = run(source)
    expect(output).toBe('-1\t 2\t 12\t 4\n 10\t 18\t 19\t 21\t-1\n')
    expect(rt.osdevkit.drawInfos.size).toBe(0)
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
  const withBob = (rt: Runtime): void => {
    const image = new BankImage(16, 2, 2, 0, 0)
    image.planes.fill(0)
    for (let plane = 0; plane < 2; plane++) for (let y = 0; y < 2; y++) {
      image.planes[plane * image.planeSize + y * image.rowBytes] = 0xff
    }
    image.planes = Uint8Array.from(image.planes)
    const bank = new ObjectBank(); bank.images = [image]; rt.spriteBank = bank
  }

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

  it('uses the shared RastPort pattern and transient scratch raster for area fills', () => {
    const source = [
      'Screen Open 0,24,12,4,Lowres : _scr id from pointer 7,Screen Base : _scr id use 7',
      '_scr id ink 3,1,0 : _scr id set low pattern $aaaa,$aaaa,$aaaa,$aaaa,$aaaa,$aaaa,$aaaa,$aaaa',
      '_scr id set high pattern $aaaa,$aaaa,$aaaa,$aaaa,$aaaa,$aaaa,$aaaa,$aaaa : _scr id pattern on',
      '_scr id fill ellipse 8,5,5,3 : A=_scr id point(8,5) : B=_scr id point(9,5)',
      '_scr id pattern off : _scr id paint 2,10,0 : C=_scr id point(2,10) : Print A,B,C',
    ].join('\n')
    expect(run(source).output).toBe(' 3\t 1\t 3\n')
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

  it('pastes the same AMOS Bob image through Screen-ID and clipped Window-ID targets', () => {
    const source = [
      'Screen Open 0,32,16,4,Lowres : _scr id from pointer 7,Screen Base : _scr id use 7',
      '_scr id put bob 1,2,2 : A=_scr id point(2,2) : B=_scr id point(9,3) : C=_scr id point(10,3)',
      '_wnd id open 1,8,4,8,4,0,0,0,"Bob" : _wnd id use 1 : _wnd id put bob 1,0,0',
      'D=_scr id point(8,4) : E=_scr id point(15,5) : F=_scr id point(16,5)',
      'Print A,B,C : Print D,E,F',
    ].join('\n')
    expect(run(source, withBob).output).toBe(' 3\t 3\t 0\n 3\t 3\t 1\n')
  })
})

describe('OS DevKit 1.61 shared GadTools ownership', () => {
  const withGtBob = (rt: Runtime): void => {
    const first = new BankImage(16, 2, 2, 0, 0); first.planes.fill(0xff)
    const second = new BankImage(16, 3, 2, 0, 0); second.planes.fill(0x55)
    const bank = new ObjectBank(); bank.images = [first, second]; rt.spriteBank = bank
  }
  it('creates a low-level GadTools gadget from worker 1498 GA tags', () => {
    const source = [
      'Screen Open 0,80,40,4,Lowres : _scr id from pointer 1,Screen Base',
      'P=_struct alloc(4) : X=_ggad context(P) : C=_struct long(P,0) : V=_ggad vinf get(Screen Base,0) : S=_to str("Tagged") : T=_tag list alloc(9)',
      '_tag set T,$80030001,3 : _tag set T,$80030003,4 : _tag set T,$80030005,20 : _tag set T,$80030007,8',
      '_tag set T,$80030009,S : _tag set T,$80030010,37 : _tag set T,$80030011,$1234 : _tag set T,$80080034,V : _tag done T',
      'G=_gt create(1,C,0,$55,T) : Print G',
    ].join('\n')
    const { rt, output } = run(source)
    const address = Number(output.trim())
    expect(address).toBeGreaterThan(0)
    expect(rt.osdevkit.gadtools.gadget(address)).toMatchObject({
      kind: KIND.BUTTON, leftEdge: 3, topEdge: 4, width: 20, height: 8,
      text: 'Tagged', id: 37, flags: 0x55, userData: 0x1234,
    })
    expect(rt.osdevkit.gadtools.gadget(address)?.visualInfo).toBeGreaterThan(0)
  })
  it('owns high-level gadget banks and their one-window attachment lifecycle', () => {
    const source = [
      'Screen Open 0,80,40,4,Lowres : _scr id from pointer 1,Screen Base',
      '_wnd id open 3,0,0,40,20,0,0,0,"Gadgets"',
      'Reserve As Gt Gadgets 7,6,0 : _gt set mode 0,"_",1,1',
      '_gt button 0,1,2,20,7,0,"Go" : _gt checkbox 1,2,10,20,7,0,"Check",1',
      '_gt set integer mode 1,6,1,1 : _gt integer 2,2,18,25,7,0,"Value",12,0',
      '_gt set string mode 1,12,1,1 : _gt string 3,2,26,30,7,0,"Name","AMOS",0',
      '_gt text 4,35,2,30,7,0,"","Ready",1',
      '_gt gadgets attach 7 : _gt set checkbox 1,0 : _gt set integer 2,34 : _gt set string 3,"AMOS Pro" : _gt set text 4,"Running",1,0,0',
      'Print _gt what integer(2),_gt what string(3) : W=_wnd id base(3)',
      '_gt disable 3 : _gt enable 3 : _gt activate 3 : _gt refresh 3 : Print _gt base(3)<>0',
      '_gt begin refresh W : _gt end refresh W,-1 : _gt refresh wnd W,0',
      '_gt set mode 1,"_",1,0 : Reserve As Gt Gadgets 8,2,0 : _gt gadgets erase 8',
    ].join('\n')
    const { rt, output } = run(source)
    expect(output).toBe(' 34\tAMOS Pro\n-1\n')
    expect(rt.bankRef(7)?.name).toBe('GT Gads')
    expect(rt.osdevkit.gtGadgetBanks.get(7)).toMatchObject({ max: 6, screenSlot: 0, attachedWindowId: 3 })
    expect(rt.osdevkit.gtGadgetBanks.get(7)?.gadgets.get(0)).toMatchObject({ kind: 1, text: 'Go' })
    expect(rt.osdevkit.gtGadgetBanks.get(7)?.gadgets.get(1)).toMatchObject({ kind: 2, checked: false })
    expect(rt.osdevkit.gtGadgetBanks.get(7)?.gadgets.get(2)).toMatchObject({ kind: 3, number: 34, maxChars: 6 })
    expect(rt.osdevkit.gtGadgetBanks.get(7)?.gadgets.get(3)).toMatchObject({ kind: 12, string: 'AMOS Pro', maxChars: 12 })
    expect(rt.osdevkit.gtGadgetBanks.get(7)?.gadgets.get(4)).toMatchObject({ kind: 13, displayText: 'Running' })
    expect(rt.osdevkit.nativeGadgets.get(rt.osdevkit.gtGadgetBanks.get(7)!.gadgets.get(3)!.address)?.strInfo).toMatchObject({ buffer: 'AMOS Pro', maxChars: 13 })
    expect(rt.osdevkit.windowHandles.get(3)?.window.gadgets).toHaveLength(5)
    expect(rt.osdevkit.gtGadgetBanks.has(8)).toBe(false)
    expect(rt.osdevkit.gtMode).toEqual({ disabled: true, underscore: '_', immediate: true, relVerify: false })
  })

  it('routes scalar display, palette, scroller and slider state through shared GadTools', () => {
    const source = [
      'Screen Open 0,100,60,4,Lowres : _scr id from pointer 1,Screen Base : Reserve As Gt Gadgets 9,8,0',
      '_gt number 0,1,1,20,7,0,"Number",5,1 : _gt set number 0,42,1,0,0,"%ld"',
      '_gt palette 1,1,9,30,8,0,"Palette",4,3 : _gt set palette 1,5,2,0',
      '_gt h scroller 2,1,18,40,8,0,"H",6 : _gt v scroller 3,45,18,8,30,0,"V",4',
      '_gt set scroller 2,7,10,100 : _gt set scroller 3,2,4,20',
      '_gt h slider 4,1,28,40,8,0,"HS",$30001,"%ld" : _gt v slider 5,55,18,8,30,0,"VS",$40002,"%02ld"',
      '_gt set slider 4,25,10,50,0,"%ld" : _gt set slider 5,-2,-10,10,0,"%ld"',
    ].join('\n')
    const { rt } = run(source)
    const gadgets = rt.osdevkit.gtGadgetBanks.get(9)?.gadgets
    expect(gadgets?.get(0)).toMatchObject({ kind: 6, number: 42 })
    expect(gadgets?.get(1)).toMatchObject({ kind: 8, paletteDepth: 4, color: 5, colorOffset: 2 })
    expect(gadgets?.get(2)).toMatchObject({ kind: 9, horizontal: true, top: 7, visible: 10, total: 100 })
    expect(gadgets?.get(3)).toMatchObject({ kind: 9, horizontal: false, top: 2, visible: 4, total: 20 })
    expect(gadgets?.get(4)).toMatchObject({ kind: 11, horizontal: true, level: 25, min: 10, max: 50 })
    expect(gadgets?.get(5)).toMatchObject({ kind: 11, horizontal: false, level: -2, min: -10, max: 10 })
  })

  it('snapshots AMOS string arrays into shared Cycle, ListView and MX label state', () => {
    const source = [
      'Dim A$(2) : A$(0)="One" : A$(1)="Two" : A$(2)="Three"',
      'Dim B$(1) : B$(0)="Alpha" : B$(1)="Beta"',
      'Screen Open 0,100,60,4,Lowres : _scr id from pointer 1,Screen Base : Reserve As Gt Gadgets 10,3,0',
      '_gt cycle 0,1,1,30,8,0,"Cycle",Array(A$(0)),1',
      '_gt set listview mode 2,1,1,12,0,3 : _gt listview 1,1,12,40,24,0,"List",Array(A$(0)),2',
      '_gt mx 2,50,1,20,8,0,"Mx",Array(A$(0)),2',
      '_gt set cycle 0,Array(B$(0)),0 : _gt set listview 1,Array(B$(0)),1,0,1 : _gt set mx 2,2',
    ].join('\n')
    const { rt } = run(source)
    const gadgets = rt.osdevkit.gtGadgetBanks.get(10)?.gadgets
    expect(gadgets?.get(0)).toMatchObject({ kind: 7, labels: ['Alpha', 'Beta'], active: 0 })
    expect(gadgets?.get(1)).toMatchObject({ kind: 4, listLabels: ['Alpha', 'Beta'], selected: 1, top: 0 })
    expect(gadgets?.get(2)).toMatchObject({ kind: 5, labels: ['One', 'Two', 'Three'], active: 2 })
  })

  it('converts string arrays into native pointer arrays and Exec lists', () => {
    const source = [
      'Dim A$(1) : A$(0)="Alpha" : A$(1)="Beta" : H=Array(A$(0))',
      'P=_gt make array(H) : L=_gt make list(H)',
      'Print P<>0,_struct long(P,0)<>0,_struct long(P,4)<>0,_struct long(P,8)',
      'N=_lnod what head(L) : Print L<>0,N<>L+4,_nod what name(N)<>0',
      '_gt free array P : _gt free list L',
    ].join('\n')
    expect(run(source).output).toBe('-1\t-1\t-1\t 0\n-1\t-1\t-1\n')
  })

  it('draws bevel boxes through the selected window and shared visual info', () => {
    const source = [
      'Screen Open 0,40,20,4,Lowres : _scr id from pointer 1,Screen Base',
      '_wnd id open 3,0,0,30,16,0,0,0,"Bevel" : Reserve As Gt Gadgets 13,1,0',
      '_gt bevel box 0,2,2,12,8,0',
    ].join('\n')
    const { rt } = run(source)
    const pixels = rt.screens.get(0)!.pixels
    expect(pixels.some(pixel => pixel !== 0)).toBe(true)
  })

  it('uses the machine-wide BOOPSI registry for public Intuition objects', () => {
    const source = [
      'T=_tag list alloc(2) : _tag set T,$80030001,12 : _tag done T',
      'O=_obj new(0,"gadgetclass",T) : Print O<>0,_obj what attr(O,$80030001)',
      'U=_tag list alloc(2) : _tag set U,$80030001,34 : _tag done U',
      'Print _obj set attrs(O,0,0,U),_obj what attr(O,$80030001)',
      'M=_struct alloc(4) : Loke M,$105 : Print _obj do(O,0,0,M)',
      '_obj free O : Print _obj what attr(O,$80030001)',
      '_struct free M : _tag list free U : _tag list free T',
    ].join('\n')
    expect(run(source).output).toBe('-1\t 12\n 1\t 34\n 1\n 0\n')
  })

  it('owns high-level public BOOPSI gadgets in the selected gadget bank', () => {
    const source = [
      'Screen Open 0,80,40,4,Lowres : _scr id from pointer 1,Screen Base : _wnd id open 3,0,0,40,20,0,0,0,"BOOPSI"',
      'Reserve As Gt Gadgets 11,2,0 : T=_tag list alloc(5)',
      '_tag set T,$80030001,2 : _tag set T,$80030002,3 : _tag set T,$80030003,20 : _tag set T,$80030004,7 : _tag done T',
      '_gt boopsi 0,0,"gadgetclass",T : _gt gadgets attach 11 : Print _gt base(0)<>0,_gt what attr(0,$80030003)',
      'U=_tag list alloc(2) : _tag set U,$80030003,25 : _tag done U : _gt set attrs 0,U : Print _gt what attr(0,$80030003)',
      '_tag list free U : _tag list free T',
    ].join('\n')
    const { rt, output } = run(source)
    expect(output).toBe('-1\t 20\n 25\n')
    expect(rt.osdevkit.gtGadgetBanks.get(11)?.objects.get(0)?.cl.id).toBe('gadgetclass')
    expect(rt.osdevkit.windowHandles.get(3)?.window.gadgets).toHaveLength(1)
  })

  it('shares native Image and BitMap records with Bob-backed image gadgets', () => {
    const source = [
      'Screen Open 0,80,40,4,Lowres : _scr id from pointer 1,Screen Base : _wnd id open 3,0,0,40,20,0,0,0,"Images"',
      'Reserve As Gt Gadgets 12,2,0 : I=_gt make image(1) : B=_gt make bitmap(1)',
      'Print _struct uword(I,4),_struct uword(I,6),_struct uword(B,0),_struct uword(B,2)',
      '_gt image 0,1,2,1,I,I : _gt bob 1,2,5,1,1,2 : _gt gadgets attach 12',
      '_gt set bob 1,2,1 : _gt set image 0,I,I',
    ].join('\n')
    const { rt, output } = run(source, withGtBob)
    expect(output).toBe(' 16\t 2\t 2\t 2\n')
    expect(rt.osdevkit.gtGadgetBanks.get(12)?.gadgets.get(0)).toMatchObject({ width: 16, height: 2 })
    expect(rt.osdevkit.gtGadgetBanks.get(12)?.gadgets.get(1)).toMatchObject({ width: 16, height: 3 })
    expect(rt.osdevkit.windowHandles.get(3)?.window.gadgets).toHaveLength(2)
  })

  it('builds high-level menu banks on the shared menu-strip backend', () => {
    const source = [
      'Screen Open 0,80,40,4,Lowres : _scr id from pointer 1,Screen Base : _wnd id open 3,0,0,40,20,0,$100,0,"Menus"',
      'Reserve As Gt Menus 14,2,0 : _gt add menu "Project",0',
      '_gt add item "Open","O",$101,0 : _gt add sub "Recent","R",1,0',
      'I=_gt make image(1) : _gt add image item I,"",0,0 : _gt add bob item 2,"",0,0',
      '_gt menus attach 14 : _gt menu clear check 0,0,-1 : Print _gt menu what check(0,0,-1)',
      '_gt menu set check 0,0,-1 : Print _gt menu what check(0,0,-1) : _gt menu off 0,0,-1 : _gt menu on 0,0,-1',
    ].join('\n')
    const { rt, output } = run(source, withGtBob)
    expect(output).toBe(' 0\n-1\n')
    const bank = rt.osdevkit.gtMenuBanks.get(14)!
    expect(bank.strip?.menus[0]?.items).toHaveLength(3)
    expect(bank.strip?.menus[0]?.items[0]?.subItems).toHaveLength(1)
    expect(bank.strip?.menus[0]?.items[1]?.image).toBeDefined()
    expect(rt.osdevkit.windowHandles.get(3)?.window.menuStrip).toBe(bank.strip?.address)
  })

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

  it('builds, lays out and attaches one shared native menu tree', () => {
    const source = [
      'Screen Open 0,80,40,4,Lowres : _scr id from pointer 1,Screen Base',
      '_wnd id open 3,0,0,40,20,0,$100,0,"Menu" : W=_wnd id base(3)',
      'A=_to str("Project") : B=_to str("Open") : K=_to str("O")',
      'N=_gmn list alloc(2) : _gmn set N,1,A,0,0,0,11 : _gmn set N,2,B,K,$101,0,$12345678 : _gmn end N',
      'M=_gmn create(N,0) : V=_ggad vinf get(Screen Base,0) : Print M<>0,_gmn layout(M,V,0)',
      'I=_menu what address(M,$f800) : Print I<>0,_menu what menu nb($f800),_menu what item nb($f800),_menu what sub nb($f800)',
      'Print Hex$(_menu what flags(I)),Hex$(_menu what user(I)),Hex$(_menu what next sel(I))',
      '_menu set W,M : Print _struct long(W,28)=M : _menu off W,$f800 : Print Hex$(_menu what flags(I))',
      '_menu on W,$f800 : _menu share W To M : _menu clear W : Print _struct long(W,28)',
      '_gmn free M : _gmn list free N : _ggad vinf free V : _str free A : _str free B : _str free K',
      '_wnd id close 3 : _scr id close 1',
    ].join('\n')
    expect(run(source).output).toBe('-1\t-1\n-1\t 0\t 0\t 31\n$101\t$12345678\t$FFFF\n-1\n$111\n 0\n')
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
      '_wnd id ink 7,4,1 : _wnd id paint 20,10,0 : _wnd id scroll 0,0 To 8,8,1,0',
      '_wnd id close 3 : _scr id close 1',
    ].join('\n')
    const { rt, output } = run(source)
    expect(output).toBe(' 3\n 3\n 25\n')
    expect(rt.screen.rp.snapshot()).toMatchObject({ fgPen: 2, bgPen: 1, drawMode: 1, cpX: 0, cpY: 0 })
  })

  it('applies limits, delta geometry, absolute boxes, titles, activation and requester locking', () => {
    const source = [
      'Screen Open 0,80,40,4,Lowres : _scr id from pointer 1,Screen Base',
      '_wnd id open 3,2,1,30,16,0,0,0,"First" : _wnd id open 4,40,1,20,12,0,0,0,"Other"',
      '_wnd id use 3 : _wnd id limits 12,8,36,20 : _wnd id size -99,-99 : _wnd id move 5,4',
      '_wnd id box 9,6,25,14 : _wnd id titles "Renamed","Screen name"',
      'W=_wnd id base(3) : Print _wnd id x,_wnd id y,_wnd id width,_wnd id height',
      'Print _struct uword(W,16),_struct uword(W,18),_struct uword(W,20),_struct uword(W,22)',
      'Print _str get(_struct long(W,32)),_str get(_struct long(W,104))',
      '_wnd id lock 3 : _wnd id lock 3 : _wnd id unlock 3 : _wnd id activate 4 : Print _wnd id in use',
    ].join('\n')
    const { rt, output } = run(source)
    expect(output).toBe(' 9\t 6\t 25\t 14\n 12\t 8\t 36\t 20\nRenamed\tScreen name\n 4\n')
    expect(rt.osdevkit.windowHandles.get(3)?.window.requesterDepth).toBe(0)
    expect(rt.osdevkit.windowHandles.get(3)?.window.active).toBe(false)
    expect(rt.osdevkit.windowHandles.get(4)?.window.active).toBe(true)
  })

  it('opens a Window-ID from the OpenWindowTagList geometry and ownership tags', () => {
    const source = [
      'Screen Open 0,80,40,4,Lowres : _scr id from pointer 1,Screen Base',
      'T=_tag list alloc(10) : P=_to str("Tagged")',
      '_tag set T,$80000064,7 : _tag set T,$80000065,5 : _tag set T,$80000066,28 : _tag set T,$80000067,15',
      '_tag set T,$8000006E,P : _tag set T,$80000070,_scr id base(1)',
      '_tag set T,$80000072,10 : _tag set T,$80000073,8 : _tag set T,$80000074,32 : _tag set T,$80000075,18 : _tag done T',
      '_wnd id tag open 6,T : W=_wnd id base(6)',
      'Print W<>0,_wnd id x,_wnd id y,_wnd id width,_wnd id height,_str get(_struct long(W,32))',
      'Print _struct uword(W,16),_struct uword(W,18),_struct uword(W,20),_struct uword(W,22)',
      '_wnd id close 6 : _tag list free T : _str free P',
    ].join('\n')
    expect(run(source).output).toBe('-1\t 7\t 5\t 28\t 15\tTagged\n 10\t 8\t 32\t 18\n')
  })

  it('filters and copies events from the one shared Window-ID UserPort', () => {
    const source = [
      'Screen Open 0,80,40,4,Lowres : _scr id from pointer 1,Screen Base',
      '_wnd id open 3,2,1,30,16,0,$C0000,0,"First" : _wnd id open 4,40,1,20,12,0,$C0000,0,"Other"',
      'W3=_wnd id base(3) : W4=_wnd id base(4) : Print Hex$(_struct long(W3,82)),_struct long(W3,86)=_struct long(W4,86),_wnd id wait event',
      '_wnd id activate 3 : _wnd id activate 4',
      'A=_wnd id mask event($80000) : Print Hex$(A),_wnd id event wnd,_wnd id event code,_wnd id event qualifier',
      'B=_wnd id next event : Print Hex$(B),_wnd id event wnd,_wnd id event gadget,_wnd id event gt bank',
      'Print _wnd id event menu,_wnd id event item,_wnd id event sub,_wnd id event x mouse,_wnd id event y mouse,_wnd id next event',
      '_wnd id close 3 : _wnd id close 4 : _scr id close 1',
    ].join('\n')
    expect(run(source).output).toBe('$C0000\t-1\t 0\n$80000\t 3\t 0\t 0\n$40000\t 4\t-1\t-1\n-1\t-1\t-1\t 0\t 0\t 0\n')
  })

  it('warps the shared input pointer relative to a Window-ID', () => {
    const source = [
      'Screen Open 0,80,40,4,Lowres : _scr id from pointer 1,Screen Base',
      '_wnd id open 3,12,7,30,16,0,0,0,"Mouse"',
      '_wnd id set mouse pos 3,5,4 : Print _scr id x mouse(1),_scr id y mouse(1)',
      '_wnd id close 3 : _scr id close 1',
    ].join('\n')
    expect(run(source).output).toBe(' 17\t 11\n')
  })

  it('sets, clears and selects the busy pointer through Window-ID ownership', () => {
    const source = [
      'Screen Open 0,80,40,4,Lowres : _scr id from pointer 1,Screen Base',
      '_wnd id open 3,0,0,30,16,0,0,0,"Mouse"',
      '_wnd id mouse 3,1,0',
    ].join('\n')
    const { rt } = run(source, (runtime) => {
      runtime.spriteBank = new ObjectBank()
      runtime.spriteBank.images.push(new BankImage(16, 9, 2, 3, 4))
    })
    const window = rt.osdevkit.windowHandles.get(3)!.window
    expect(window.pointer).toEqual({ data: rt.bankBase(1) + 1, height: 9, width: 1, xOffset: -3, yOffset: -4 })
    const busy = run([
      'Screen Open 0,80,40,4,Lowres : _scr id from pointer 1,Screen Base',
      '_wnd id open 3,0,0,30,16,0,0,0,"Mouse" : _wnd id mouse 3,-1,0',
    ].join('\n')).rt.osdevkit.windowHandles.get(3)!.window
    expect(busy.pointer?.data).toBe(0x8000_0000)
    const cleared = run([
      'Screen Open 0,80,40,4,Lowres : _scr id from pointer 1,Screen Base',
      '_wnd id open 3,0,0,30,16,0,0,0,"Mouse" : _wnd id mouse 3,-1,0 : _wnd id mouse 3,0,0',
    ].join('\n')).rt.osdevkit.windowHandles.get(3)!.window
    expect(cleared.pointer).toBeNull()
  })
})
