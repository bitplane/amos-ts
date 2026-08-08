/**
 * Make Lib 1.30, against `AMOSPro_Make.lib` disassembled with
 * `extdis make-1.30` and against `Make_lib.doc`, which documents all
 * thirty-two keywords.
 *
 * Where the two disagree the binary wins, and the four places they do are
 * pinned here as tests rather than left as notes: the third `Ma Fopen` mode is
 * not "a", three of the file functions report their own last argument when
 * handed a null handle, `Ma Point` is not AMOS's, and `Ma Realloc(0,n)` never
 * writes a return value at all.
 */
import { describe, expect, it } from 'vitest'
import { mustFinish } from '../testing/run'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { extensionById } from '../ext/registry'
import { AmigaFS } from '../amiga/vfs'
import { BankImage } from './objects'
import { ObjectBank } from './objects'
import { Runtime } from './runtime'

const table = new TokenTable(CORE_TOKENS)
/** slot 17 — `move.l a3,$1f8(a5)`, and the doc says so in words */
const MAKE_SLOT = 17
const make = extensionById('make-1.30')!
const extensions = new Map([[MAKE_SLOT, make.table]])

interface Boot {
  rt: Runtime
  out: () => string
}

function boot(src: string, fs?: AmigaFS): Boot {
  let printed = ''
  const rt = new Runtime(tokenize(src, table, extensions), table, {
    extensions,
    extBindings: new Map([[MAKE_SLOT, make]]),
    maxSteps: 200_000,
    onText: (t) => (printed += t),
    ...(fs ? { fs } : {}),
  })
  return { rt, out: () => printed }
}

function run(src: string, prep?: (rt: Runtime) => void): Boot {
  const b = boot(src)
  prep?.(b.rt)
  mustFinish(b.rt.runHeadless(2_000))
  return b
}

const num = (src: string, prep?: (rt: Runtime) => void): number =>
  Number(run(src, prep).out().trim())

/**
 * Every printed value, as numbers.
 *
 * AMOS puts a leading space in front of a non-negative number and none in
 * front of a negative one, so comparing whole output strings is comparing
 * AMOS's number formatting rather than the keyword's answer. Splitting on
 * whitespace says what was asked.
 */
const vals = (src: string, prep?: (rt: Runtime) => void): number[] =>
  run(src, prep).out().trim().split(/\s+/).map(Number)

/** the same over a writable RAM: volume, which every file keyword needs */
function bootFs(src: string): Boot {
  const fs = new AmigaFS()
  fs.mountMemory('RAM')
  return boot(src, fs)
}

function runFs(src: string, prep?: (rt: Runtime) => void): Boot {
  const b = bootFs(src)
  prep?.(b.rt)
  mustFinish(b.rt.runHeadless(2_000))
  return b
}

const numFs = (src: string, prep?: (rt: Runtime) => void): number =>
  Number(runFs(src, prep).out().trim())

const valsFs = (src: string, prep?: (rt: Runtime) => void): number[] =>
  runFs(src, prep).out().trim().split(/\s+/).map(Number)

/**
 * `n` icons, each 16x1 with pixel 0 set to its own number, in `depth` planes.
 *
 * Sixteen wide because a bank image's width is truncated to whole words, and
 * one line high so a paste lands on one row and the plane arithmetic is
 * readable in the result.
 */
function icons(n: number, depth = 4): ObjectBank {
  const b = new ObjectBank()
  b.images = []
  for (let i = 1; i <= n; i++) {
    const img = new BankImage(16, 1, depth, 0, 0)
    img.pixelsW()[0] = i
    img.flush()
    b.images.push(img)
  }
  return b
}

describe('Make: exec memory', () => {
  it('Ma Allocmem hands back an address, and a distinct one each time', () => {
    const src = 'A=Ma Allocmem(64,0) : B=Ma Allocmem(64,0) : Print A<>0;" ";B<>0;" ";A<>B'
    expect(vals(src)).toEqual([-1, -1, -1])
  })

  it('Mem Chip, Mem Fast, Mem Clear and Mem Public are exec\'s own bits', () => {
    // four moveq/move.l, and the doc's bit table: $1 public, $2 chip, $4 fast,
    // $10000 clear
    expect(num('Print Mem Public')).toBe(1)
    expect(num('Print Mem Chip')).toBe(2)
    expect(num('Print Mem Fast')).toBe(4)
    expect(num('Print Mem Clear')).toBe(0x10000)
  })

  it('Mem Clear really clears, and without it the bytes are what was there', () => {
    // the pool reuses a freed block first-fit, so the second Ma Allocmem lands
    // on the first one's bytes -- which is exactly the case MEMF_CLEAR is for
    const dirty = num(
      'A=Ma Allocmem(64,0) : Poke A,123 : Ma Freemem A,64 : B=Ma Allocmem(64,0) : Print Peek(B)',
    )
    expect(dirty).toBe(123)
    const cleared = num(
      'A=Ma Allocmem(64,0) : Poke A,123 : Ma Freemem A,64 : B=Ma Allocmem(64,Mem Clear) : Print Peek(B)',
    )
    expect(cleared).toBe(0)
  })

  it('Ma Freemem takes a size it does not need, and ignores a null pointer', () => {
    // `move.l a1,d1 / beq` -- the null check is the routine's, and the size
    // goes to exec where this pool takes the length from its own bookkeeping
    expect(() => run('Ma Freemem 0,64')).not.toThrow()
    expect(() => run('A=Ma Allocmem(64,0) : Ma Freemem A,999999')).not.toThrow()
  })

  it('Ma Allocvec stores the TOTAL size in the longword in front of the block', () => {
    // `addq.l #$4,d0 / move.l d0,d2 / move.l d2,(a0)+` -- four more than asked
    // for, and the header counts itself
    expect(num('A=Ma Allocvec(100,0) : Print Leek(A-4)')).toBe(104)
  })

  it('Ma Freevec finds the size behind the pointer, and the block comes back', () => {
    const src = [
      'A=Ma Allocvec(100,0)',
      'Ma Freevec A',
      'B=Ma Allocvec(100,0)',
      'Print A=B',
    ].join(' : ')
    expect(num(src)).toBe(-1)
  })
})

describe('Make: Ma Malloc and its list', () => {
  it('lays a twelve-byte header in front of the block, size at +8', () => {
    // `addq.l #$8,d0 / addq.l #$4,d0` then `move.l d2,$8(a1)` -- MinNode plus
    // the total, and the pointer handed back is the block plus twelve
    expect(num('A=Ma Malloc(100,0) : Print Leek(A-4)')).toBe(112)
  })

  it('the header survives Mem Clear, because it is written after the alloc', () => {
    expect(num('A=Ma Malloc(100,Mem Clear) : Print Leek(A-4)')).toBe(112)
    expect(num('A=Ma Malloc(100,Mem Clear) : Print Peek(A)')).toBe(0)
  })

  it('threads every block onto the library\'s own list, newest first', () => {
    // AddHead, so Ma First answers the LAST block allocated. The list header
    // is not reachable by keyword, but Ma Prev from a node walks back to it
    const src = [
      'A=Ma Malloc(16,0)',
      'B=Ma Malloc(16,0)',
      "Print Ma Next(A-12)=0;\" \";Ma Prev(B-12)=0;\" \";Ma Next(B-12)=A-12",
    ].join(' : ')
    // A is the tail: its succ is the list's own tail sentinel, so Ma Next is 0.
    // B is the head: its pred is the list header, so Ma Prev is 0.
    expect(vals(src)).toEqual([-1, -1, -1])
  })

  it('Ma Free unlinks the block and hands it back', () => {
    const src = [
      'A=Ma Malloc(64,0)',
      'Ma Free A',
      'B=Ma Malloc(64,0)',
      'Print A=B',
    ].join(' : ')
    expect(num(src)).toBe(-1)
  })

  it('Ma Free All empties the list and frees everything on it', () => {
    const src = [
      'A=Ma Malloc(64,0)',
      'B=Ma Malloc(64,0)',
      'Ma Free All',
      'C=Ma Malloc(64,0)',
      'D=Ma Malloc(64,0)',
      // the free list is coalesced and first fit, so the two blocks come back
      // out at the same two addresses and in the same order
      'Print C=A;" ";D=B',
    ].join(' : ')
    expect(vals(src)).toEqual([-1, -1])
  })

  it('Ma Free All is safe on an empty list', () => {
    expect(() => run('Ma Free All : Ma Free All')).not.toThrow()
  })
})

describe('Make: the list routines', () => {
  /** a list header and two nodes, all out of Ma Allocmem so they have addresses */
  const listSetup = [
    'L=Ma Allocmem(12,Mem Clear)',
    'Ma Newlist L',
    'N1=Ma Allocmem(16,Mem Clear)',
    'N2=Ma Allocmem(16,Mem Clear)',
  ].join(' : ')

  it('Ma Newlist writes head=&tail, tail=0, tailpred=&head', () => {
    // the four instructions routine 6 open-codes, and the shape every exec
    // list starts as
    const src = `${listSetup} : Print Leek(L)=L+4;" ";Leek(L+4)=0;" ";Leek(L+8)=L`
    expect(vals(src)).toEqual([-1, -1, -1])
  })

  it('an empty list answers 0 from both Ma First and Ma Last', () => {
    // `cmpa.l $8(a0),a0 / beq` -- tailpred == &head is exec's emptiness test
    const src = `${listSetup} : Print Ma First(L);" ";Ma Last(L)`
    expect(vals(src)).toEqual([0, 0])
  })

  it('Ma Addhead puts a node at the front, Ma Addtail at the back', () => {
    const src = [
      listSetup,
      'Ma Addhead L,N1',
      'Ma Addtail L,N2',
      'Print Ma First(L)=N1;" ";Ma Last(L)=N2',
    ].join(' : ')
    expect(vals(src)).toEqual([-1, -1])
  })

  it('Ma Next and Ma Prev stop at the sentinels rather than running off', () => {
    // `movea.l (a0),a0 / tst.l (a0) / beq` -- the successor unless ITS successor
    // is zero, which is only true of the header's lh_Tail
    const src = [
      listSetup,
      'Ma Addhead L,N1',
      'Ma Addtail L,N2',
      'Print Ma Next(N1)=N2;" ";Ma Next(N2)=0;" ";Ma Prev(N2)=N1;" ";Ma Prev(N1)=0',
    ].join(' : ')
    expect(vals(src)).toEqual([-1, -1, -1, -1])
  })

  it('Ma Remove takes a node off without being told which list', () => {
    // exec's Remove takes the node alone, which is why the doc's parameter
    // list has one entry
    const src = [
      listSetup,
      'Ma Addhead L,N1',
      'Ma Addtail L,N2',
      'Ma Remove N1',
      'Print Ma First(L)=N2;" ";Ma Last(L)=N2',
    ].join(' : ')
    expect(vals(src)).toEqual([-1, -1])
  })

  it('Ma Remhead pops the front, and answers 0 once the list is empty', () => {
    const src = [
      listSetup,
      'Ma Addtail L,N1',
      'Ma Addtail L,N2',
      'Print Ma Remhead(L)=N1;" ";Ma Remhead(L)=N2;" ";Ma Remhead(L)=0',
    ].join(' : ')
    expect(vals(src)).toEqual([-1, -1, -1])
  })

  it('a list built in an AMOS bank works exactly the same', () => {
    // nothing about these routines knows where the memory came from, which is
    // the doc's whole premise -- the nodes are the program's
    const src = [
      'Reserve As Work 1,256',
      'L=Start(1)',
      'Ma Newlist L',
      'N=Start(1)+64',
      'Ma Addhead L,N',
      'Print Ma First(L)=N;" ";Ma Last(L)=N',
    ].join(' : ')
    expect(vals(src)).toEqual([-1, -1])
  })
})

describe('Make: Ma Realloc', () => {
  it('keeps the old bytes and clears the new ones when it grows', () => {
    const src = [
      'A=Ma Malloc(8,0)',
      'Poke A,11 : Poke A+7,22',
      'B=Ma Realloc(A,32)',
      'Print Peek(B);" ";Peek(B+7);" ";Peek(B+8);" ";Leek(B-4)',
    ].join(' : ')
    expect(vals(src)).toEqual([11, 22, 0, 44])
  })

  it('keeps as much as fits when it shrinks', () => {
    // the doc: "New MAP ptr contains 512 bytes of old data"
    const src = [
      'A=Ma Malloc(32,0)',
      'Poke A,77 : Poke A+15,88',
      'B=Ma Realloc(A,16)',
      'Print Peek(B);" ";Peek(B+15);" ";Leek(B-4)',
    ].join(' : ')
    expect(vals(src)).toEqual([77, 88, 28])
  })

  it('puts the new block on the list and takes the old one off', () => {
    const src = [
      'A=Ma Malloc(16,0)',
      'B=Ma Realloc(A,16)',
      // one block on the list: its successor is the tail sentinel
      'Print Ma Next(B-12)=0;" ";Ma Prev(B-12)=0',
    ].join(' : ')
    expect(vals(src)).toEqual([-1, -1])
  })

  it('DEFECT: Ma Realloc(0,n) never writes a return value', () => {
    // `movea.l (a3)+,a1 / move.l a1,d0 / beq $8d0` jumps straight to the exit,
    // so on the machine the answer is whatever the previous function left in
    // d3. Nothing here has a stale return register, so it answers 0
    expect(num('Print Ma Realloc(0,64)')).toBe(0)
  })
})

describe('Make: ma ExtB and ma ExtW', () => {
  it('sign-extend a byte and a word, which is what Peek and Deek do not', () => {
    expect(num('Print Ma Extb(255)')).toBe(-1)
    expect(num('Print Ma Extb(127)')).toBe(127)
    expect(num('Print Ma Extb(128)')).toBe(-128)
    expect(num('Print Ma Extw(65535)')).toBe(-1)
    expect(num('Print Ma Extw(32768)')).toBe(-32768)
    expect(num('Print Ma Extw(32767)')).toBe(32767)
  })

  it('Ma Extb keeps only the low byte, as ext.w does after ext.b', () => {
    // `ext.w d3 / ext.l d3` starts from the byte, so anything above is dropped
    expect(num('Print Ma Extb(511)')).toBe(-1)
  })
})

describe('Make: the file functions', () => {
  it('Ma Fopen "w" creates a file, and Ma Fwrite/Ma Fclose put bytes in it', () => {
    const src = [
      'B=Ma Allocmem(8,0)',
      'Poke B,65 : Poke B+1,66 : Poke B+2,67',
      'F=Ma Fopen("RAM:t.dat","w")',
      'N=Ma Fwrite(F,B,3)',
      'Ma Fclose F',
      'Print F<>0;" ";N;" ";Ma Filelen("RAM:t.dat")',
    ].join(' : ')
    expect(valsFs(src)).toEqual([-1, 3, 3])
  })

  it('Ma Fopen "r" reads back, and refuses a file that is not there', () => {
    const src = [
      'B=Ma Allocmem(8,0)',
      'Poke B,88 : Poke B+1,89',
      'F=Ma Fopen("RAM:r.dat","w") : X=Ma Fwrite(F,B,2) : Ma Fclose F',
      'G=Ma Fopen("RAM:r.dat","r")',
      'C=Ma Allocmem(8,Mem Clear)',
      'N=Ma Fread(G,C,2)',
      'Ma Fclose G',
      'Print N;" ";Peek(C);" ";Peek(C+1);" ";Ma Fopen("RAM:nope.dat","r")',
    ].join(' : ')
    expect(valsFs(src)).toEqual([2, 88, 89, 0])
  })

  it('Ma Fread stops at the end of the file and reports the short count', () => {
    const src = [
      'B=Ma Allocmem(8,0) : Poke B,1 : Poke B+1,2',
      'F=Ma Fopen("RAM:s.dat","w") : X=Ma Fwrite(F,B,2) : Ma Fclose F',
      'G=Ma Fopen("RAM:s.dat","r")',
      'C=Ma Allocmem(64,Mem Clear)',
      'Print Ma Fread(G,C,64)',
    ].join(' : ')
    expect(numFs(src)).toBe(2)
  })

  it('Ma Fopen "a" opens an old file positioned at the end', () => {
    const src = [
      'B=Ma Allocmem(8,0) : Poke B,1 : Poke B+1,2',
      'F=Ma Fopen("RAM:a.dat","w") : X=Ma Fwrite(F,B,2) : Ma Fclose F',
      'G=Ma Fopen("RAM:a.dat","a")',
      'Y=Ma Fwrite(G,B,2)',
      'Ma Fclose G',
      'Print Ma Filelen("RAM:a.dat")',
    ].join(' : ')
    expect(numFs(src)).toBe(4)
  })

  it('Ma Fopen "a" creates the file when there is not one', () => {
    // "creates new if file named Name$ does not exists!"
    const src = [
      'F=Ma Fopen("RAM:new.dat","a")',
      'Ma Fclose F',
      'Print F<>0;" ";Ma Filelen("RAM:new.dat")',
    ].join(' : ')
    expect(valsFs(src)).toEqual([-1, 0])
  })

  it('the third mode is not "a" -- it is every character that is not R or W', () => {
    // `cmpi.b #$57,d3` and `cmpi.b #$52,d3` and nothing else. The doc lists
    // three modes and the routine tests two
    const src = [
      'B=Ma Allocmem(8,0) : Poke B,9',
      'F=Ma Fopen("RAM:q.dat","w") : X=Ma Fwrite(F,B,1) : Ma Fclose F',
      'G=Ma Fopen("RAM:q.dat","zebra")',
      'Y=Ma Fwrite(G,B,1)',
      'Ma Fclose G',
      // appended rather than truncated, so the "z" behaved as "a"
      'Print Ma Filelen("RAM:q.dat")',
    ].join(' : ')
    expect(numFs(src)).toBe(2)
  })

  it('the mode character is uppercased by clearing bit 5, so "R" works too', () => {
    const src = [
      'B=Ma Allocmem(8,0) : Poke B,3',
      'F=Ma Fopen("RAM:u.dat","W") : X=Ma Fwrite(F,B,1) : Ma Fclose F',
      'G=Ma Fopen("RAM:u.dat","R")',
      'C=Ma Allocmem(8,Mem Clear)',
      'Print Ma Fread(G,C,1);" ";Peek(C)',
    ].join(' : ')
    expect(valsFs(src)).toEqual([1, 3])
  })

  it('an empty name is refused before anything else happens', () => {
    // `move.w (a0)+,d0 / beq` -- the one length check the routine makes
    expect(numFs('Print Ma Fopen("","w")')).toBe(0)
  })

  it('Ma Fseek returns the OLD position, and two seeks to the end give the length', () => {
    // the doc's own trick, and it falls straight out of Seek's contract
    const src = [
      'B=Ma Allocmem(16,0)',
      'F=Ma Fopen("RAM:k.dat","w") : X=Ma Fwrite(F,B,10)',
      'P=Ma Fseek(F,0,1)',
      'Q=Ma Fseek(F,0,1)',
      'Ma Fclose F',
      'Print P;" ";Q',
    ].join(' : ')
    expect(valsFs(src)).toEqual([10, 10])
  })

  it('Ma Fseek takes -1 from the start, 0 from here and 1 from the end', () => {
    const src = [
      'B=Ma Allocmem(16,0)',
      'F=Ma Fopen("RAM:m.dat","w") : X=Ma Fwrite(F,B,10)',
      'A=Ma Fseek(F,3,-1)',
      'C=Ma Fseek(F,2,0)',
      'D=Ma Fseek(F,-4,1)',
      'E=Ma Fseek(F,0,0)',
      'Ma Fclose F',
      'Print A;" ";C;" ";D;" ";E',
    ].join(' : ')
    // A: was at 10, moves to 3. C: was at 3, moves to 5. D: was at 5, moves to
    // 6. E: was at 6 and stays
    expect(valsFs(src)).toEqual([10, 3, 5, 6])
  })

  it('a seek past either end fails with -1 and leaves the position alone', () => {
    const src = [
      'B=Ma Allocmem(16,0)',
      'F=Ma Fopen("RAM:z.dat","w") : X=Ma Fwrite(F,B,10)',
      'A=Ma Fseek(F,999,-1)',
      'C=Ma Fseek(F,-999,-1)',
      'D=Ma Fseek(F,0,0)',
      'Ma Fclose F',
      'Print A;" ";C;" ";D',
    ].join(' : ')
    expect(valsFs(src)).toEqual([-1, -1, 10])
  })

  it('DEFECT: a null handle makes Fread, Fwrite and Fseek report their last argument', () => {
    // all three branch past `move.l d0,d3`, so d3 is still what was popped
    // into it -- the length for the two transfers, the MODE for the seek
    expect(numFs('Print Ma Fread(0,0,100)')).toBe(100)
    expect(numFs('Print Ma Fwrite(0,0,55)')).toBe(55)
    expect(numFs('Print Ma Fseek(0,999,1)')).toBe(1)
  })

  it('Ma Fclose closes nothing at all when the handle is not on its list', () => {
    // the walk falls off the end; a handle already closed, or never opened,
    // simply does not match
    expect(() => runFs('Ma Fclose 12345')).not.toThrow()
    const src = [
      'F=Ma Fopen("RAM:d.dat","w")',
      'Ma Fclose F',
      'Ma Fclose F',
      'Print 1',
    ].join(' : ')
    expect(numFs(src)).toBe(1)
  })

  it('Ma Filelen answers -1 for a missing file and 0 for a directory', () => {
    // fib_Size at +124 of the FileInfoBlock; a directory locks and examines
    // fine and its size is zero, so it is not the -1 the doc promises
    expect(numFs('Print Ma Filelen("RAM:absent")')).toBe(-1)
    expect(numFs('Print Ma Filelen("")')).toBe(-1)
    expect(numFs('Print Ma Filelen("RAM:")')).toBe(0)
  })
})

describe('Make: the graphics three', () => {
  /**
   * A 64-line screen, and everything here draws at y >= 32.
   *
   * `Print` evaluates and emits one item at a time, so a `Print` of two
   * `Ma Point`s renders the first answer as TEXT before the second one reads
   * the bitmap. Text lands in the top eight rows; keeping the drawing well
   * below them is what makes the two independent.
   */
  const scr = 'Screen Open 0,320,64,16,0 : Cls 0 : '

  it('Ma Plot sets a pixel and Ma Point reads it back', () => {
    expect(num(`${scr}Ma Plot 10,40,13 : Print Ma Point(10,40)`)).toBe(13)
  })

  it('both answer only within the bitmap, and unsigned', () => {
    // `cmp.w d0,d5 / bls` and `cmp.w $4e(a2),d1 / bcc` -- a negative coordinate
    // is a large unsigned one, so it is out of range rather than backwards
    expect(num(`${scr}Print Ma Point(320,40)`)).toBe(-1)
    expect(num(`${scr}Print Ma Point(0,64)`)).toBe(-1)
    expect(num(`${scr}Print Ma Point(-1,40)`)).toBe(-1)
    // and Ma Plot simply returns, with no error
    expect(() => run(`${scr}Ma Plot -5,-5,15`)).not.toThrow()
  })

  it('Ma Plot writes every plane the screen has, low bit first', () => {
    // `btst.l d2,d7` with d2 fixed at zero and `lsr.w d5,d7` walking the value
    expect(num(`${scr}Ma Plot 0,40,15 : Print Ma Point(0,40)`)).toBe(15)
    expect(num(`${scr}Ma Plot 0,40,15 : Ma Plot 0,40,4 : Print Ma Point(0,40)`)).toBe(4)
    // bits above the screen's depth are dropped, because the loop is dbra on
    // the plane count
    expect(num(`${scr}Ma Plot 1,41,255 : Print Ma Point(1,41)`)).toBe(15)
  })

  it('Ma Plot agrees with AMOS Point on a single-buffered screen', () => {
    // EcCurrent and EcLogic name the same bitmap until Double Buffer splits
    // them, which is why the doc's claim passes unnoticed
    expect(num(`${scr}Ma Plot 7,40,9 : Print Point(7,40)`)).toBe(9)
    expect(num(`${scr}Plot 8,40,6 : Print Ma Point(8,40)`)).toBe(6)
  })

  it('Ma Paste Icon draws the icon at a 16-pixel boundary', () => {
    // `lsr.l #$4,d2 / add.l d2,d2` -- x is rounded down to a whole word, which
    // the doc states outright
    const draw = (x: number): number =>
      num(`${scr}Ma Paste Icon ${x},40,3 : Print Ma Point(32,40)`, (rt) => {
        rt.iconBank = icons(8)
      })
    expect(draw(32)).toBe(3)
    expect(draw(47)).toBe(3) // rounds down to 32
    expect(draw(48)).toBe(0) // lands on the next word
  })

  it('Ma Paste Icon overwrites rather than masking', () => {
    // minterm $f0 with both masks $ffffffff: D = A, so colour 0 in the icon
    // erases what was under it. AMOS's own Paste Icon is masked
    const src = `${scr}Ma Plot 1,40,15 : Ma Paste Icon 0,40,2 : Print Ma Point(0,40);" ";Ma Point(1,40)`
    expect(
      vals(src, (rt) => {
        rt.iconBank = icons(8)
      }),
    ).toEqual([2, 0])
  })

  it('refuses icon 0 and anything past the end of the bank', () => {
    // `cmp.w (a0)+,d3 / bhi` then `subq.w #$1,d3 / bmi`, both to error 74
    const paste = (n: number): void => {
      run(`${scr}Ma Paste Icon 0,40,${n}`, (rt) => {
        rt.iconBank = icons(4)
      })
    }
    expect(() => paste(4)).not.toThrow()
    expect(() => paste(5)).toThrow(/Icon not defined/)
    expect(() => paste(0)).toThrow(/Icon not defined/)
  })

  it('raises when there is no icon bank at all', () => {
    expect(() => run(`${scr}Ma Paste Icon 0,40,1`)).toThrow(/Icon not defined/)
  })

  it('DEFECT: it fills the screen\'s planes, not the icon\'s', () => {
    // `move.w $50(a2),d4` is the SCREEN's plane count and the icon's own, at
    // +4 of the record it just read, is never looked at. A one-plane icon on a
    // four-plane screen takes its other three planes from whatever follows it
    // in the bank -- here the next icon's header, so the pasted colour is not
    // the icon's colour
    // icon 1 is a single plane with only pixel 0 lit, so pixel 15 is blank in
    // the only plane the icon has. The screen's other three planes are filled
    // from the twelve bytes after it -- the NEXT record's widthWords, height
    // and depth, each `$0001` -- and the low byte of each lands on pixel 15
    const got = vals(
      `${scr}Ma Paste Icon 0,40,1 : Print Ma Point(0,40);" ";Ma Point(15,40)`,
      (rt) => {
        rt.iconBank = icons(4, 1)
      },
    )
    expect(got).toEqual([1, 14])
  })
})
