/**
 * BUtility 1.21, against `BUtility.Lib` disassembled with `extdis
 * butility-1.21` and against `BUtility.doc`, which gives all fifteen
 * signatures with worked examples.
 *
 * Three of the keywords substitute a modelled requester for a reqtools one
 * and two substitute AMOS's own selector for a file requester, so what is
 * pinned here is the CONTRACT --- which numbers come back, which buffers are
 * left holding what --- rather than any pixel. The buffer sharing is tested
 * hardest, because it is the one thing a program can see that the doc never
 * mentions.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { mustFinish } from '../testing/run'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { extensionById } from '../ext/registry'
import { AmigaFS } from '../amiga/vfs'
import { Runtime } from './runtime'
import { openLibrary } from '../amiga/exec'
import { BUTILITY_ERRORS } from './butility'

const FIXTURES = join(__dirname, '..', '..', 'fixtures')
const DEFAULT_ABK = join(FIXTURES, 'official-amos', 'APSystem', 'AMOSPro_Default_Resource.Abk')

const table = new TokenTable(CORE_TOKENS)
/** slot 12 --- routine 0's `moveq #$b,d0` and the readme's install note */
const BU_SLOT = 12
const bu = extensionById('butility-1.21')!
const extensions = new Map([[BU_SLOT, bu.table]])

interface Boot {
  rt: Runtime
  out: () => string
}

function boot(src: string, prep?: (rt: Runtime) => void): Boot {
  let printed = ''
  const fs = new AmigaFS()
  const ram = fs.mountMemory('RAM')
  ram.write(['plain.txt'], new TextEncoder().encode('hello hello hello hello'))
  fs.currentDir = 'RAM:'
  const rt = new Runtime(tokenize(src, table, extensions), table, {
    extensions,
    extBindings: new Map([[BU_SLOT, bu]]),
    maxSteps: 300_000,
    fs,
    onText: (t) => (printed += t),
  })
  if (existsSync(DEFAULT_ABK)) rt.loadSystemResource(readFileSync(DEFAULT_ABK))
  prep?.(rt)
  return { rt, out: () => printed }
}

function run(src: string, prep?: (rt: Runtime) => void): Boot {
  const b = boot(src, prep)
  mustFinish(b.rt.runHeadless(4_000))
  return b
}

/**
 * `runHeadless` answers a block on the frame it appears --- a dialog with 0, a
 * selector with "" --- so a test that wants to answer for itself has to step
 * one frame and park.
 */
function park(b: Boot): void {
  b.rt.frame()
}

const text = (src: string): string => run(src).out()
/** AMOS puts a space in front of a non-negative number; compare the numbers */
const vals = (src: string): number[] =>
  text(src).trim().split(/\s+/).filter(Boolean).map(Number)

describe('BUtility: routine 0 and the three libraries', () => {
  it('opens the three its readme names, at the versions it asks for', () => {
    // routine 0 is `OpenLibrary` three times: xpkmaster v4, reqtools v$26=38,
    // asl v$25=37, each stored and each tested by every keyword that uses it
    expect(openLibrary('xpkmaster.library', 4)).not.toBe(0)
    expect(openLibrary('reqtools.library', 38)).not.toBe(0)
    expect(openLibrary('asl.library', 37)).not.toBe(0)
    // and exec's version rule still bites, which is what makes the arms real
    expect(openLibrary('reqtools.library', 39)).toBe(0)
  })

  it('carries the six error messages the hunk spells out', () => {
    // routines 16-21 are `moveq #n,d0 / Rbra routine 22`, so index IS number
    expect(BUTILITY_ERRORS).toEqual([
      'Xpkmaster library V4+ not opened',
      'Reqtools library V38+ not opened',
      'Asl library V37+ not opened',
      'Reqtools file requester not allocated',
      'Asl file requester not allocated',
      'Incorrect max string length',
    ])
  })
})

describe('BUtility: the XPK keywords', () => {
  it('packs and unpacks a file, answering -1 for success', () => {
    // =Bxpkpack("infile" To "outfile","method","password"), the doc's own
    // shape --- the To is the `t` in the token spec "02t2,2,2"
    const b = run(
      'A=Bxpkpack("RAM:plain.txt" To "RAM:packed","NONE","") : ' +
        'B=Bxpkunpack("RAM:packed" To "RAM:back","") : Print A;" ";B',
    )
    expect(b.out().trim().split(/\s+/).map(Number)).toEqual([-1, -1])
    const back = b.rt.fs?.read('RAM:back')
    expect(back && new TextDecoder().decode(back)).toBe('hello hello hello hello')
  })

  it('answers 0 and records the error when the input will not open', () => {
    // `move.l d0,$26a(a0)` stores the result whether or not it is zero, so
    // Bxpkerror$ can be read straight afterwards
    const b = run('A=Bxpkunpack("RAM:nothing" To "RAM:out","") : Print A : Print Bxpkerror$')
    const [first, ...rest] = b.out().trim().split('\n')
    expect(Number(first)).toBe(0)
    expect(rest.join('\n').trim()).not.toBe('')
  })

  it('an empty password is a NULL tag rather than an empty string', () => {
    // `tst.w d0 / bne / suba.l a0,a0` on the LAST argument popped, which is
    // the password in both keywords -- the doc's examples all pass ""
    expect(vals('A=Bxpkpack("RAM:plain.txt" To "RAM:p2","NONE","") : Print A')).toEqual([-1])
  })

  it('Bxpkerror$ reads the stored code and starts at zero', () => {
    // nothing special-cases 0, so a fresh extension answers XpkFault's own
    // text for no error
    expect(text('Print Bxpkerror$').trim()).not.toBe('')
  })
})

describe('BUtility: the shared buffers', () => {
  it('Bfilereqchg sets what the next requester opens on, readable at once', () => {
    // routine 6 is rtChangeReqAttrA with RTFI_MatchPat and RTFI_Dir; Breqdir$
    // reads the requester's Dir field rather than any result, so the change
    // shows up before anything has been selected
    expect(text('Bfilereqchg "mod.#?","RAM:" : Print Breqdir$').trim()).toBe('RAM:')
  })

  it('a drawer gets a slash and a volume does not', () => {
    // `cmpi.b #$3a,-2(a0)` then `cmpi.b #$2f,-2(a0)` -- ':' and '/'
    expect(text('Bfilereqchg "","DH0:Games" : Print Breqdir$').trim()).toBe('DH0:Games/')
    expect(text('Bfilereqchg "","DH0:" : Print Breqdir$').trim()).toBe('DH0:')
    expect(text('Bfilereqchg "","DH0:Games/" : Print Breqdir$').trim()).toBe('DH0:Games/')
  })

  it('Breqfile$ answers before anything has been selected', () => {
    // routine 7 has no library test and no requester test at all: it is a
    // strlen of data+$16 and nothing else
    expect(text('Print "["+Breqfile$+"]"').trim()).toBe('[]')
  })

  it('DEFECT: Baslfile$ writes the buffer Breqfile$ reads', () => {
    // routine 9 copies fr_File into data+$16 -- the SAME buffer -- before
    // answering it, so the reqtools and asl readers are not independent.
    // Nothing in the doc says so.
    const b = run('Print "["+Baslfile$+"]["+Breqfile$+"]"', (rt) => {
      rt.butility.file = 'from-reqtools'
      rt.butility.aslFile = 'from-asl'
    })
    // reading the asl name has OVERWRITTEN the reqtools one
    expect(b.out().trim()).toBe('[from-asl][from-asl]')
  })

  it('Basldir$ and Breqdir$ share their buffer too, and both append', () => {
    const b = run('Print "["+Basldir$+"]"', (rt) => {
      rt.butility.aslDrawer = 'RAM:Work'
    })
    expect(b.out().trim()).toBe('[RAM:Work/]')
  })
})

describe.skipIf(!existsSync(DEFAULT_ABK))('BUtility: the text requesters', () => {
  it('Binforeq cancels to 0 with nobody there to click', () => {
    // headless drains a dialog block with return 0, which is the rightmost
    // gadget -- reqtools numbers the rightmost 0 and counts the rest from 1
    expect(vals('A=Binforeq("Quit?","_Yes|_No","Quit request") : Print A')).toEqual([0])
  })

  it('and answers the gadget that was pressed', () => {
    const b = boot('A=Binforeq("Quit?","_Yes|_No","Quit request") : Print A')
    // park it on the block, then answer as a click on gadget 1 would
    park(b)
    const chan = b.rt.butility.req?.chan
    expect(chan).toBeDefined()
    const d = b.rt.dialogs.get(chan!)!
    expect(d.runState).toBe('waiting')
    b.rt.finishDialogRun(d, 1)
    mustFinish(b.rt.runHeadless(2_000))
    expect(b.out().trim().split(/\s+/).map(Number)).toEqual([1])
  })

  it('the underscore marks a shortcut and is not part of the label', () => {
    // "_Yes|_No" is reqtools' RT_Underscore, set to '_' in the tag list at
    // data+$374. DEVIATION: stripped rather than underlined here
    const b = boot('A=Binforeq("Quit?","_Yes|_No","T") : Print A')
    park(b)
    const d = b.rt.dialogs.get(b.rt.butility.req!.chan)!
    // 0 is the title, 1 the one body line, then the labels
    expect(d.vars[2]).toBe('Yes')
    expect(d.vars[3]).toBe('No')
  })

  it('Bgetlongreq leaves the default in place when cancelled', () => {
    // rtGetLong edits the long at data+$26e IN PLACE and nothing clears it,
    // so a cancel leaves the default for Bgetlong to hand back
    expect(vals('A=Bgetlongreq("T","Main",-1000,1000,100) : Print A;" ";Bgetlong')).toEqual([0, 100])
  })

  it('Bgetstrreq leaves the default in place when cancelled', () => {
    expect(text('A=Bgetstrreq("T","Main","Mariusz Rycyk",40) : Print A;" [";Bgetstr$;"]"').trim()).toBe(
      '0 [Mariusz Rycyk]',
    )
  })

  it('DEFECT: Bgetstrreq copies the default BEFORE checking the length', () => {
    // `tst.l d0 / Rble` and `cmp.l #$100,d0 / Rbge` come after the copy loop
    // and after the body pointer is stored, so an out-of-range Max chars
    // raises with the buffer already overwritten
    const b = boot('A=Bgetstrreq("T","Main","typed",0) : Print A')
    expect(() => mustFinish(b.rt.runHeadless(2_000))).toThrow(/Incorrect max string length/)
    expect(b.rt.butility.str).toBe('typed')
  })

  it('the legal Max chars is 1..255, which is what the doc says', () => {
    const bad = (n: number): (() => void) => () => run(`A=Bgetstrreq("T","M","d",${n})`)
    expect(bad(0)).toThrow(/Incorrect max string length/)
    expect(bad(-1)).toThrow(/Incorrect max string length/)
    expect(bad(256)).toThrow(/Incorrect max string length/)
    expect(bad(255)).not.toThrow()
    expect(bad(1)).not.toThrow()
  })

  it('a multi-line body is split on Chr$(10), as the doc\'s demo writes it', () => {
    const b = boot('A=Binforeq("Line one"+Chr$(10)+"Line two","_Ok","T") : Print A')
    park(b)
    const d = b.rt.dialogs.get(b.rt.butility.req!.chan)!
    // RTEZ_ReqTitle is variable 0 and the body follows it, a line each
    expect(d.vars[0]).toBe('T')
    expect(d.vars[1]).toBe('Line one')
    expect(d.vars[2]).toBe('Line two')
  })
})

describe.skipIf(!existsSync(DEFAULT_ABK))('BUtility: the file requesters', () => {
  it('Bfilereq splits its answer the way reqtools does', () => {
    // rtFileRequest writes the NAME into the caller's buffer and leaves the
    // DRAWER in the requester, which is why the doc's demo rebuilds the path
    // as KAT$+PLIK$
    const b = boot('A=Bfilereq("Load","plain.txt") : Print A')
    park(b)
    expect(b.rt.fsel).not.toBeNull()
    b.rt.finishFselNow('RAM:Work/thing.txt')
    mustFinish(b.rt.runHeadless(2_000))
    expect(b.out().trim().split(/\s+/).map(Number)).toEqual([-1])
    expect(b.rt.butility.file).toBe('thing.txt')
    expect(b.rt.butility.reqDir).toBe('RAM:Work')
  })

  it('and a cancel answers 0 without disturbing the buffers', () => {
    const b = boot('A=Bfilereq("Load","keep.txt") : Print A;" [";Breqfile$;"]"')
    park(b)
    b.rt.finishFselNow('')
    mustFinish(b.rt.runHeadless(2_000))
    // the default was copied into data+$16 BEFORE the call, and a cancel
    // leaves it there -- rtFileRequest edits that buffer in place
    expect(b.out().trim()).toBe('0 [keep.txt]')
  })

  it('Baslfilereq writes the asl fields, not the reqtools ones', () => {
    const b = boot('A=Baslfilereq("Load","#?.txt","RAM:","x.txt") : Print A')
    park(b)
    b.rt.finishFselNow('RAM:Deep/other.txt')
    mustFinish(b.rt.runHeadless(2_000))
    expect(b.rt.butility.aslFile).toBe('other.txt')
    expect(b.rt.butility.aslDrawer).toBe('RAM:Deep')
    // the reqtools requester is untouched by it
    expect(b.rt.butility.reqDir).toBe('')
  })
})
