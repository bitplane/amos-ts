import { describe, expect, it } from 'vitest'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/source'
import { Runtime } from './runtime'
import { compileAmal } from './amal'

const table = new TokenTable(CORE_TOKENS)

/** run the program to completion, then keep stepping frames */
function boot(src: string, extraFrames = 0): Runtime {
  const rt = new Runtime(tokenize(src, table), table, { maxSteps: 200_000 })
  rt.runHeadless(1_000)
  for (let i = 0; i < extraFrames; i++) rt.frame()
  return rt
}

describe('AMAL compiler', () => {
  it('skips lowercase comments and separators', () => {
    const p = compileAmal('Let RA=1 ; then jump to the end J E ; E: Let RB=2')
    // "Let"→L + lowercase "et" ignored; ';' ignored; label E:
    expect(p.main.length).toBeGreaterThan(2)
  })

  it('reports syntax errors with a position', () => {
    expect(() => compileAmal('M 10,')).toThrow(/operand/)
  })

  it('rejects cross-scope jumps', () => {
    expect(() => compileAmal('AU(I RA>0 J B) B: L RA=1 E')).toThrow(/autotest/)
  })
})

describe('AMAL execution', () => {
  it('moves a bob with fixed-point interpolation', () => {
    const rt = boot(
      [
        'Ink 5 : Bar 0,0 To 7,7 : Get Bob 1,0,0 To 8,8 : Cls 0',
        'Bob 1,10,20,1',
        'Channel 1 To Bob 1',
        'Amal 1,"M 30,15,10"',
        'Amal On',
      ].join('\n'),
      12,
    )
    const bob = rt.bobs.get(1)!
    expect([bob.x, bob.y]).toEqual([40, 35])
  })

  it('animates images in the background', () => {
    const rt = boot(
      ['Channel 2 To Sprite 2', 'Sprite 2,200,100,1', 'Amal 2,"A 0,(1,3)(2,3)"', 'Amal On'].join('\n'),
      3,
    )
    const first = rt.hwSprites.get(2)!.image
    for (let i = 0; i < 3; i++) rt.frame()
    const second = rt.hwSprites.get(2)!.image
    expect(first).not.toBe(second)
    expect([first, second].sort()).toEqual([1, 2])
  })

  it('evaluates expressions strictly left-to-right', () => {
    const rt = boot(['Amal 3,"L RA=2+3*4"', 'Amal On'].join('\n'), 2)
    expect(rt.amalGlobals[0]).toBe(20) // (2+3)*4, not 14
  })

  it('runs For/Next loops', () => {
    const rt = boot(['Amal 3,"L RB=0 F R0=1 T 5 L RB=RB+R0 N R0"', 'Amal On'].join('\n'), 3)
    expect(rt.amalGlobals[1]).toBe(15)
  })

  it('survives infinite jump loops via the per-frame budget', () => {
    const rt = boot(['Amal 3,"L: L RA=RA+1 J L"', 'Amal On'].join('\n'), 0)
    rt.frame() // must return, not hang
    rt.frame()
    expect(rt.amalGlobals[0]!).toBeGreaterThan(0)
  })

  it('redirects the main sequence from an autotest', () => {
    const prog = 'AU(I RA>0 D G X) W ; G: L RB=99 E'
    const rt = boot([`Amal 4,"${prog}"`, 'Amal On'].join('\n'), 3)
    expect(rt.amalGlobals[1]).toBe(0) // waiting
    rt.amalGlobals[0] = 1
    for (let i = 0; i < 3; i++) rt.frame()
    expect(rt.amalGlobals[1]).toBe(99)
  })

  it('drives Screen Offset for hardware scrolling', () => {
    const rt = boot(['Channel 9 To Screen Offset 0', 'Amal 9,"M 64,0,8"', 'Amal On'].join('\n'), 10)
    expect(rt.screens.get(0)!.offsetX).toBe(64)
  })

  it('exposes Amreg, Chanmv and X Bob to BASIC', () => {
    const out: string[] = []
    const rt = new Runtime(
      tokenize(
        [
          'Ink 5 : Bar 0,0 To 7,7 : Get Bob 1,0,0 To 8,8',
          'Bob 1,0,0,1',
          'Channel 1 To Bob 1',
          'Amreg(3)=7',
          'Amal 1,"M 100,0,50 ; L RD=RD+1"',
          'Amal On',
          'Wait 5',
          'Print Amreg(3);Chanmv(1)',
        ].join('\n'),
        table,
      ),
      table,
      { maxSteps: 100_000, onText: (t) => out.push(t) },
    )
    rt.runHeadless(100)
    expect(out.join('')).toContain(' 7-1')
  })

  it('freezes and resumes channels', () => {
    const rt = boot(['Channel 5 To Sprite 5', 'Sprite 5,100,100,1', 'Amal 5,"M 100,0,100"', 'Amal On'].join('\n'), 5)
    const x1 = rt.hwSprites.get(5)!.x
    rt.channels.get(5)!.frozen = true
    for (let i = 0; i < 5; i++) rt.frame()
    expect(rt.hwSprites.get(5)!.x).toBe(x1)
    rt.channels.get(5)!.frozen = false
    for (let i = 0; i < 5; i++) rt.frame()
    expect(rt.hwSprites.get(5)!.x).toBeGreaterThan(x1)
  })
})


// ---------------------------------------------------------------------------
// PLay: recorded movements out of the AMAL bank (bank 4, "Amal")
// ---------------------------------------------------------------------------

/**
 * Build a bank payload in the shape AmPli (+W.s:8663) and InAmal2
 * (+Lib.s:11857) read: movement count and word-offset table at +4, an
 * optional program-string section reached through the long at +0.
 */
function amalBankBytes(
  movements: Array<{ speed: number; x: number[]; y: number[] } | null>,
  programs: string[] = [],
): Uint8Array {
  const out: number[] = [0, 0, 0, 0]
  const w = (at: number, v: number): void => {
    out[at] = (v >> 8) & 0xff
    out[at + 1] = v & 0xff
  }
  out.push(0, 0)
  w(4, movements.length)
  for (let i = 0; i < movements.length; i++) out.push(0, 0) // table, filled below
  for (let i = 0; i < movements.length; i++) {
    const m = movements[i]
    if (!m) continue
    if (out.length % 2) out.push(0)
    const base = out.length
    w(6 + i * 2, (base - 4) / 2) // entry n is the word at +4+n*2, so 1-based
    const yoff = 5 + m.x.length + 1
    out.push(m.speed >> 8, m.speed & 0xff, yoff >> 8, yoff & 0xff)
    out.push(0, ...m.x, 0) // a terminator on each side of the steps
    out.push(0, ...m.y, 0)
  }
  if (programs.length) {
    if (out.length % 2) out.push(0)
    const sec = out.length
    out[0] = (sec >> 24) & 0xff
    out[1] = (sec >> 16) & 0xff
    out[2] = (sec >> 8) & 0xff
    out[3] = sec & 0xff
    out.push(0, 0)
    w(sec, programs.length - 1) // count = the highest valid index
    const table = sec + 2
    for (let i = 0; i < programs.length; i++) out.push(0, 0)
    for (let i = 0; i < programs.length; i++) {
      if (out.length % 2) out.push(0)
      w(table + i * 2, (out.length - table) / 2)
      out.push(programs[i]!.length >> 8, programs[i]!.length & 0xff)
      for (const c of programs[i]!) out.push(c.charCodeAt(0))
    }
  }
  return new Uint8Array(out)
}

/** boot a program with bank 4 already holding an "Amal" bank */
function bootBank(data: Uint8Array, src: string, extraFrames = 0): Runtime {
  const rt = new Runtime(tokenize(src, table), table, { maxSteps: 200_000 })
  rt.memBanks.set(4, { kind: 'memory', number: 4, memType: 1, name: 'Amal', flags: 1, data })
  rt.runHeadless(1_000)
  for (let i = 0; i < extraFrames; i++) rt.frame()
  return rt
}

const PLAYER = ['Channel 0 To Sprite 0', 'Sprite 0,100,50,1'].join('\n')

describe('AMAL PLay (recorded movements from the Amal bank)', () => {
  it('walks the X and Y streams independently, at the record tempo', () => {
    const rt = bootBank(
      amalBankBytes([{ speed: 1, x: [3, 0x82, 5], y: [1, 1, 1, 1, 1] }]),
      [PLAYER, 'Amal 0,"PL 1"', 'Amal On'].join('\n'),
    )
    const path: Array<[number, number]> = []
    for (let i = 0; i < 7; i++) {
      rt.frame()
      const s = rt.hwSprites.get(0)!
      path.push([s.x, s.y])
    }
    // frame 1 initialises and takes the first step of each stream; 2-4 are
    // the $82 pause in X while Y keeps stepping; 5 takes the last X step;
    // 6 reads the X terminator and the movement ends
    expect(path).toEqual([
      [103, 51],
      [103, 52],
      [103, 53],
      [103, 54],
      [108, 55],
      [108, 55],
      [108, 55],
    ])
  })

  it('holds a step for the record tempo in R0', () => {
    const rt = bootBank(
      amalBankBytes([{ speed: 3, x: [10, 10], y: [1, 1, 1] }]),
      [PLAYER, 'Amal 0,"PL 1"', 'Amal On'].join('\n'),
    )
    const xs: number[] = []
    for (let i = 0; i < 7; i++) {
      rt.frame()
      xs.push(rt.hwSprites.get(0)!.x)
    }
    // one step, then two idle frames, then the next: AmCpt reloads from R0
    expect(xs).toEqual([110, 110, 110, 120, 120, 120, 120])
  })

  it('reads a 7-bit signed step, so bit 6 is the sign', () => {
    // 0x7f = -1, 0x40 = -64, 0x3f = +63
    const rt = bootBank(
      amalBankBytes([{ speed: 1, x: [0x7f, 0x40, 0x3f], y: [1, 1, 1] }]),
      [PLAYER, 'Amal 0,"PL 1"', 'Amal On'].join('\n'),
      4,
    )
    expect(rt.hwSprites.get(0)!.x).toBe(100 - 1 - 64 + 63)
  })

  it('plays the path backwards when R1 is 0, stopping on the leading zero', () => {
    // one frame forwards, then Amplay flips the direction: the pointer walks
    // back over the step it took and onto the 0 that precedes the stream
    const rt = bootBank(
      amalBankBytes([{ speed: 1, x: [10, 10], y: [1, 1] }]),
      [PLAYER, 'Amal 0,"PL 1"', 'Amal On', 'Wait 1', 'Amplay ,0', 'Wait 5'].join('\n'),
    )
    expect(rt.hwSprites.get(0)!.x).toBe(100)
  })

  it('aborts on a negative R1 and runs on past the PLay', () => {
    const rt = bootBank(
      amalBankBytes([{ speed: 1, x: [10, 10, 10], y: [1, 1, 1] }]),
      [PLAYER, 'Amal 0,"PL 1 ; L RA=99"', 'Amal On', 'Wait 1', 'Amplay ,-1', 'Wait 2'].join('\n'),
    )
    expect(rt.hwSprites.get(0)!.x).toBe(110) // no step after the abort
    expect(rt.amalGlobals[0]).toBe(99)
  })

  it('runs on to the next instruction when the movement number is absent', () => {
    const rt = bootBank(
      amalBankBytes([{ speed: 1, x: [10], y: [1] }]),
      [PLAYER, 'Amal 0,"PL 9 ; L RA=42"', 'Amal On'].join('\n'),
      1,
    )
    expect(rt.amalGlobals[0]).toBe(42)
    expect(rt.hwSprites.get(0)!.x).toBe(100)
  })

  it('Amplay writes R0/R1 only over its channel range', () => {
    const rt = bootBank(
      amalBankBytes([]),
      ['Amal 0,"L RA=0"', 'Amal 3,"L RA=0"', 'Amplay 7,2,0 To 1'].join('\n'),
    )
    expect([rt.channels.get(0)!.regs[0], rt.channels.get(0)!.regs[1]]).toEqual([7, 2])
    expect([rt.channels.get(3)!.regs[0], rt.channels.get(3)!.regs[1]]).toEqual([0, 0])
  })

  it('elides either parameter on its own (EntNul, SetPlay +W.s:7948)', () => {
    const rt = bootBank(
      amalBankBytes([]),
      ['Amal 0,"L RA=0"', 'Amplay 7,2', 'Amplay ,5', 'Amplay 9,'].join('\n'),
    )
    expect([rt.channels.get(0)!.regs[0], rt.channels.get(0)!.regs[1]]).toEqual([9, 5])
  })

  it('rejects channel ranges outside 0-63', () => {
    expect(() => bootBank(amalBankBytes([]), 'Amplay 1,1,0 To 64')).toThrow(/function call/)
    expect(() => bootBank(amalBankBytes([]), 'Amplay 1,1,6 To 2')).toThrow(/function call/)
  })
})

describe('Amal n,# — programs stored in the bank', () => {
  it('compiles the numbered program from the bank', () => {
    const rt = bootBank(amalBankBytes([], ['', 'L RA=11', 'L RB=22']), ['Amal 0,2', 'Amal On'].join('\n'), 1)
    expect(rt.amalGlobals[1]).toBe(22)
  })

  it('takes an empty slot as the empty string, but errors past the count', () => {
    const bank = amalBankBytes([], ['', 'L RA=11'])
    expect(() => bootBank(bank, 'Amal 0,0')).not.toThrow()
    expect(() => bootBank(bank, 'Amal 0,5')).toThrow(/function call/)
  })

  it('is a bank-not-reserved error with no Amal bank at all', () => {
    const rt = new Runtime(tokenize('Amal 0,1', table), table, { maxSteps: 100 })
    expect(() => rt.runHeadless(100)).toThrow(/bank not reserved/)
  })
})

describe('For and Next count in either register file (AmFor/AmNxt +W.s:8869)', () => {
  it('takes a global RA-RZ as well as an internal R0-R9', () => {
    // AmFor reads the compiled register offset and branches on its SIGN:
    // `move.w (a3)+,d0 / bpl.s AmFr0` uses T_AmRegs(a5), the globals, and a
    // negative offset uses AmIRegs+NbInterne*2(a6), the internals. AmNxt does
    // the same. Ant Wars II's barebones.AMOS steps its bob frames with
    // `For RA=0 To 29`, which used to be a syntax error here.
    expect(() => compileAmal('Loop: For RA=0 To 29; Let X=RA; Next RA; Jump Loop')).not.toThrow()
    expect(() => compileAmal('Loop: For R0=0 To 29; Let X=R0; Next R0; Jump Loop')).not.toThrow()
  })
})
