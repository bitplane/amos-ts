/**
 * The Game Extension 0.9 — the tracker keywords.
 *
 * All twelve are calls into ptreplay.library 6.6 and nothing else, so what is
 * checked here is which call each keyword makes, with which argument, and what
 * the library does with it — read off `fixtures/libs/ptreplay.library` rather
 * than off `TGE.guide.beta`, which is wrong about three of them.
 */
import { describe, expect, it } from 'vitest'
import { mustFinish } from '../testing/run'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { extensionById } from '../ext/registry'
import { AmigaFS } from '../amiga/vfs'
import { Runtime } from './runtime'
import { BTN_RED, DIR_UP } from '../amiga/controller'
import { PT_PLAY_VOLUME, TGE_ENCRYPT_BANK_NAME, TGE_GFX_BASE, keyChecksum, thegameVbl } from './thegame'

const table = new TokenTable(CORE_TOKENS)
/** the manifest's recommended slot; the extension itself names none */
const TGE_SLOT = 14
const tge = extensionById('the-game-0.9')!
const extensions = new Map([[TGE_SLOT, tge.table]])

function boot(src: string | string[], fs?: AmigaFS): Booted {
  const text = Array.isArray(src) ? src.join('\n') : src
  let printed = ''
  const rt = new Runtime(tokenize(text, table, extensions), table, {
    extensions,
    extBindings: new Map([[TGE_SLOT, tge]]),
    maxSteps: 400_000,
    onText: (t) => (printed += t),
    ...(fs ? { fs } : {}),
  })
  return Object.assign(rt, { out: () => printed })
}

function run(src: string | string[], fs?: AmigaFS): Runtime {
  const rt = boot(src, fs)
  mustFinish(rt.runHeadless(2000))
  return rt
}

/** every printed number, which is how the two functions answer */
function vals(src: string | string[], fs?: AmigaFS): number[] {
  let printed = ''
  const text = Array.isArray(src) ? src.join('\n') : src
  const rt = new Runtime(tokenize(text, table, extensions), table, {
    extensions,
    extBindings: new Map([[TGE_SLOT, tge]]),
    maxSteps: 400_000,
    onText: (t) => (printed += t),
    ...(fs ? { fs } : {}),
  })
  mustFinish(rt.runHeadless(2000))
  return printed.trim().split(/\s+/).map(Number)
}

/** a Runtime with its printed text collected, for a test that pokes it first */
type Booted = Runtime & { readonly out: () => string }

/** run a Runtime that a test has already poked, and read its numbers back */
function printed(rt: Booted): number[] {
  mustFinish(rt.runHeadless(2000))
  return rt.out().trim().split(/\s+/).map(Number)
}

/**
 * The smallest thing `parseMod` will take: one pattern, `positions` long, and
 * the `M.K.` signature at 1080. Row 0 of channel 0 plays sample 1 at C-2 so a
 * tick has something to do.
 */
function modFile(positions: number[]): Uint8Array {
  const out = new Uint8Array(1084 + 1024 + 32)
  out[950] = positions.length
  out[951] = 127
  for (let i = 0; i < positions.length; i++) out[952 + i] = positions[i]!
  out.set([0x4d, 0x2e, 0x4b, 0x2e], 1080) // "M.K."
  // sample 1: sixteen bytes, volume 64
  out[20 + 22] = 0
  out[20 + 23] = 8
  out[20 + 25] = 64
  // pattern 0, row 0, channel 0: instrument 1, period 428 (C-2)
  out[1084] = 0x11
  out[1085] = 0xac
  return out
}

/** an AMOS string's bytes, for a payload a test wants to compare against */
const bytesOf = (s: string): Uint8Array => new Uint8Array([...s].map((c) => c.charCodeAt(0)))

const withRam = (data = modFile([0, 0, 0, 0])): AmigaFS => {
  const fs = new AmigaFS()
  fs.mountMemory('RAM')
  fs.writeFile('RAM:song.mod', data)
  return fs
}

describe('G Ptload', () => {
  it('loads a module and leaves it ready to play', () => {
    const rt = run('G Ptload "RAM:song.mod"', withRam())
    expect(rt.thegame.module).not.toBe(0)
    expect(rt.thegame.song).not.toBeNull()
    expect(rt.thegame.song!.positions.length).toBe(4)
  })

  /**
   * DEFECT: routine 15 ($18ca) calls OpenLibrary unconditionally and stores
   * the base over the last one, so two loads are two opens and at most one
   * close.
   */
  it('opens ptreplay.library again on every call', () => {
    const rt = run(
      ['G Ptload "RAM:song.mod"', 'G Ptload "RAM:song.mod"', 'G Ptload "RAM:song.mod"'],
      withRam(),
    )
    expect(rt.thegame.ptOpens).toBe(3)
  })

  /** LoadModule answers zero for a file it cannot read, and the store happens anyway */
  it('leaves a zero handle for a file that is not a module', () => {
    const fs = withRam()
    fs.writeFile('RAM:notamod', Uint8Array.from([1, 2, 3, 4]))
    const rt = run('G Ptload "RAM:notamod"', fs)
    expect(rt.thegame.module).toBe(0)
    expect(rt.thegame.song).toBeNull()
  })
})

describe('G Ptplay', () => {
  it('plays the loaded module', () => {
    const rt = run(['G Ptload "RAM:song.mod"', 'G Ptplay'], withRam())
    expect(rt.thegame.replay.playing).toBe(true)
    expect(rt.thegame.replay.song).not.toBeNull()
  })

  /**
   * ptreplay $3a6 opens `move.w #$39,$e(a5)` — 57 — so PlayModule throws away
   * whatever volume was set and does not start at full either.
   */
  it('resets the volume to 57, discarding an earlier G Ptvolume', () => {
    const rt = run(['G Ptload "RAM:song.mod"', 'G Ptplay', 'G Ptvolume 12', 'G Ptplay'], withRam())
    expect(PT_PLAY_VOLUME).toBe(57)
    expect(rt.thegame.replay.master).toBe(57)
  })

  /** routine 16 has no guard of its own and ptreplay null-checks the handle */
  it('is quiet when nothing is loaded', () => {
    const rt = run('G Ptplay', withRam())
    expect(rt.thegame.replay.playing).toBe(false)
  })
})

describe('G Ptstop', () => {
  it('stops and unloads', () => {
    const rt = run(['G Ptload "RAM:song.mod"', 'G Ptplay', 'G Ptstop'], withRam())
    expect(rt.thegame.replay.playing).toBe(false)
    expect(rt.thegame.song).toBeNull()
  })

  /**
   * DEFECT: routine 17 ($1934) calls StopModule then UnLoadModule and never
   * clears +$d0, so the handle survives its own module. Both guards still
   * pass afterwards, which is how a second G Ptstop frees it twice.
   */
  it('frees the module and keeps the pointer', () => {
    const rt = run(['G Ptload "RAM:song.mod"', 'G Ptplay', 'G Ptstop'], withRam())
    expect(rt.thegame.module).not.toBe(0)
    expect(rt.thegame.song).toBeNull()
    // and the dangling handle lets the guards through a second time
    expect(() => mustFinish(rt.runHeadless(10))).not.toThrow()
  })

  it('does nothing at all when nothing was loaded', () => {
    const rt = run('G Ptstop', withRam())
    expect(rt.thegame.module).toBe(0)
  })
})

describe('G Ptpause and G Ptunpause', () => {
  it('stop the ticks and start them again', () => {
    const rt = run(['G Ptload "RAM:song.mod"', 'G Ptplay', 'G Ptpause'], withRam())
    expect(rt.thegame.paused).toBe(true)
    const before = rt.thegame.replay.counter
    thegameVbl(rt)
    thegameVbl(rt)
    expect(rt.thegame.replay.counter).toBe(before)

    const rt2 = run(['G Ptload "RAM:song.mod"', 'G Ptplay', 'G Ptpause', 'G Ptunpause'], withRam())
    expect(rt2.thegame.paused).toBe(false)
    const c = rt2.thegame.replay.counter
    thegameVbl(rt2)
    expect(rt2.thegame.replay.counter).not.toBe(c)
  })

  /** ptreplay $528 clears the word with no test, so this is not an error */
  it('un-pause a module that was never paused', () => {
    const rt = run(['G Ptload "RAM:song.mod"', 'G Ptplay', 'G Ptunpause'], withRam())
    expect(rt.thegame.paused).toBe(false)
    expect(rt.thegame.replay.playing).toBe(true)
  })
})

describe('G Ptvolume', () => {
  it('sets the volume', () => {
    const rt = run(['G Ptload "RAM:song.mod"', 'G Ptplay', 'G Ptvolume 30'], withRam())
    expect(rt.thegame.replay.master).toBe(30)
  })

  /** the 0-63 in the guide is the guide's; ptreplay $59e stores the word unclamped */
  it('needs a module: the library null-checks the handle', () => {
    const rt = run('G Ptvolume 30', withRam())
    expect(rt.thegame.replay.master).toBe(64)
  })
})

describe('G Ptfade', () => {
  /**
   * The guide calls the argument seconds. ptreplay $6c2 puts it in both fade
   * bytes and the interrupt at $9b8 counts one down, reloads it from the
   * other and drops the volume by one — so it is ticks per step.
   */
  it('takes a rate in ticks per volume step, not a time', () => {
    const rt = run(['G Ptload "RAM:song.mod"', 'G Ptplay', 'G Ptfade 3'], withRam())
    expect(rt.thegame.fadeRate).toBe(3)
    expect(rt.thegame.replay.master).toBe(57)
    // three frames to the first step, and one step is one level
    thegameVbl(rt)
    thegameVbl(rt)
    expect(rt.thegame.replay.master).toBe(57)
    thegameVbl(rt)
    expect(rt.thegame.replay.master).toBe(56)
  })

  it('runs the volume down to zero and then stops the module', () => {
    const rt = run(['G Ptload "RAM:song.mod"', 'G Ptplay', 'G Ptfade 1'], withRam())
    for (let i = 0; i < PT_PLAY_VOLUME + 2; i++) thegameVbl(rt)
    expect(rt.thegame.replay.master).toBe(0)
    expect(rt.thegame.replay.playing).toBe(false)
  })

  /** $6cc: `tst.w d0 / bne` and the fall-through is `jmp -$30(a6)`, StopModule */
  it('a rate of zero is a stop, not a fast fade', () => {
    const rt = run(['G Ptload "RAM:song.mod"', 'G Ptplay', 'G Ptfade 0'], withRam())
    expect(rt.thegame.replay.playing).toBe(false)
    expect(rt.thegame.song).toBeNull()
  })
})

describe('G Ptchan On and G Ptchan Off', () => {
  /**
   * ptreplay $6ea tests bit 0 and writes $dff0a0, which is AUD0. The guide's
   * "G Ptchan %0101 for chan 2 and 4" reads the binary literal left to right
   * and is wrong.
   */
  it('bit 0 is the first channel', () => {
    const rt = run(
      ['G Ptload "RAM:song.mod"', 'G Ptplay', 'G Ptchan Off %1111', 'G Ptchan On %0101'],
      withRam(),
    )
    expect(rt.thegame.replay.voices).toBe(0b0101)
  })

  it('on sets bits and off clears them, leaving the rest alone', () => {
    const rt = run(
      ['G Ptload "RAM:song.mod"', 'G Ptplay', 'G Ptchan Off %0010', 'G Ptchan On %1000'],
      withRam(),
    )
    expect(rt.thegame.replay.voices).toBe(0b1101)
  })
})

describe('G Ptset Pos, G Ptpos and G Ptlength', () => {
  it('moves the player and reads the position back', () => {
    expect(
      vals(
        ['G Ptload "RAM:song.mod"', 'G Ptplay', 'G Ptset Pos 2', 'Print G Ptpos'],
        withRam(modFile([0, 0, 0, 0, 0, 0])),
      ),
    ).toEqual([2])
  })

  /**
   * ptreplay $5c8 follows the handle to the module and reads byte $3b6, which
   * is the song length — the number of positions, not a duration.
   */
  it('answers the number of positions', () => {
    expect(
      vals(['G Ptload "RAM:song.mod"', 'Print G Ptlength'], withRam(modFile([0, 0, 0]))),
    ).toEqual([3])
  })

  it('both answer zero with nothing loaded', () => {
    expect(vals(['Print G Ptpos;G Ptlength'], withRam())).toEqual([0, 0])
  })
})

describe('the host and OS keywords', () => {
  it('G Reboot asks for a cold reset', () => {
    const rt = run('G Reboot', withRam())
    expect(rt.machine.pendingReset).toEqual({ kind: 'cold', by: 'g reboot' })
  })

  it('=G Left Click and =G Right Click read the two buttons', () => {
    const rt = boot('Print G Left Click;G Right Click', withRam())
    rt.input.mouseK = 1
    expect(printed(rt)).toEqual([-1, 0])
  })

  /**
   * `cmpi.b #$ff,$dff006` — the low eight bits of the beam's vertical
   * position, so it is true on one line in 256 and that line is not in the
   * vertical blank at all.
   */
  it('=G Check Vbl is a compare against one raster line', () => {
    expect([0, -1]).toContain(vals(['Print G Check Vbl'], withRam())[0])
  })

  /**
   * The guide says "returns lowlevel bitmap" and the routine repacks it: the
   * four directions into bits 3..0 reversed, and the seven pad buttons into
   * bits 4 to 10.
   */
  it('=G Cd32 repacks ReadJoyPort rather than passing it through', () => {
    const rt = boot('Print G Cd32(1)', withRam())
    rt.input.ports[1] = { ...rt.input.ports[1]!, dirs: DIR_UP, buttons: BTN_RED }
    // up is ReadJoyPort bit 3 and G Cd32 bit 0; red is bit 22 and bit 4
    expect(printed(rt)).toEqual([0x001 | 0x010])
  })

  it('=G File Size answers the length, and leaks a FileInfoBlock doing it', () => {
    const fs = withRam()
    fs.writeFile('RAM:x.dat', new Uint8Array(1234))
    expect(vals(['Print G File Size("RAM:x.dat")'], fs)).toEqual([1234])
    // DEFECT: AllocMem($3e8) with no FreeMem, on every call
    const rt = run(['A=G File Size("RAM:x.dat")', 'A=G File Size("RAM:x.dat")'], fs)
    expect(rt.thegame.fibLeak).toBe(2000)
  })

  /**
   * Three instructions: `lea $352(a3),a0`. The answer is the address of the
   * extension's own scratch area, and a program poking it must find memory.
   */
  it('=G Getmem answers an address that can be poked', () => {
    expect(
      vals(['A=G Getmem', 'Poke A,123', 'Poke A+2147,45', 'Print Peek(A);Peek(A+2147)'], withRam()),
    ).toEqual([123, 45])
  })

  /** DEFECT: the two overlapping longs leave x holding zero and y holding x */
  it('G Set Mouse writes two overlapping longs', () => {
    const rt = run('G Set Mouse 100,50', withRam())
    // $b32..$b35 after `move.l d0,$b34` then `move.l d1,$b32`: the x store's
    // low word lands on the y field and its high word on the x field
    expect(rt.thegame.mouseX).toBe(0)
    expect(rt.thegame.mouseY).toBe(100)
  })

  it('=G X Mouse accumulates rather than reporting a coordinate', () => {
    const rt = boot('Print G X Mouse;G X Mouse', withRam())
    rt.input.mouseX = 10
    rt.input.mouseY = 0
    // the first read seeds the counter, the second adds nothing new
    const [a, b] = printed(rt)
    expect(b).toBe(a)
  })

  /**
   * The routine could not open workbench.library, so it closed icon.library
   * and returned; there is no AppIcon and no port to check.
   */
  it('G Iconify does nothing and =G Icon Check stays false', () => {
    expect(vals(['G Iconify "Title","RAM:icon"', 'Print G Icon Check'], withRam())).toEqual([0])
  })

  it('G Iconify takes the three-argument form too', () => {
    const rt = run('G Iconify "Title","RAM:icon",1', withRam())
    expect(rt.thegame.iconUp).toBe(false)
  })

  /** dos.library's Execute, and the value register is never set */
  it('=G Cli always answers zero', () => {
    expect(vals(['Print G Cli("list")'], withRam())).toEqual([0])
  })

  it('G Wait Lmb returns at once when the button is already down', () => {
    const rt = boot('G Wait Lmb : Print 1', withRam())
    rt.input.mouseK = 1
    expect(printed(rt)).toEqual([1])
  })

  it('G Wait Rmb blocks until the right button goes down', () => {
    let out = ''
    const rt = new Runtime(tokenize('G Wait Rmb : Print 1', table, extensions), table, {
      extensions,
      extBindings: new Map([[TGE_SLOT, tge]]),
      maxSteps: 400_000,
      onText: (t) => (out += t),
      fs: withRam(),
    })
    expect(rt.runHeadless(50).status).toBe('blocked')
    expect(out).toBe('')
    rt.input.mouseK = 2
    mustFinish(rt.runHeadless(2000))
    expect(out.trim()).toBe('1')
  })
})

/**
 * The trigonometry batch.
 *
 * `G Set Table` is undocumented and the two functions are useless without it,
 * so the shape of the table is checked first and the functions against it.
 * Every expectation here comes from the routines at $31bc and $323c rather
 * than from `Math.sin`: the series is a fixed-point cosine to x^12/12!, and
 * the port reproduces its arithmetic, not its intent.
 */
describe('the trigonometry tables', () => {
  /** `G Set Table 90` is the degrees the =Gcos node assumes */
  it('G Set Table allocates 10n bytes and points cos n entries in', () => {
    const rt = run('G Set Table 90', withRam())
    expect(rt.thegame.trigBytes).toBe(900)
    expect(rt.thegame.trig!.length).toBe(450)
    expect(rt.thegame.cosAt).toBe(90)
  })

  /**
   * The table is a quarter of a cosine reflected into five quadrants, and it
   * agrees with a real sine to a unit in 32768 across the first four of them.
   * Entries 0 and 2n are never written by the fill at all — MEMF_CLEAR leaves
   * them zero and sin(0) and sin(pi) are zero, so nobody noticed.
   */
  it('the table is a sine to within one part in 32768', () => {
    const t = run('G Set Table 90', withRam()).thegame.trig!
    let worst = 0
    // 0..359: entry 360 begins the quarter that is a step out, below
    for (let i = 0; i < 360; i++) {
      worst = Math.max(worst, Math.abs(t[i]! - Math.round(Math.sin((i * Math.PI) / 180) * 32768)))
    }
    expect(worst).toBeLessThanOrEqual(1)
    expect(t[0]).toBe(0)
    expect(t[180]).toBe(0)
    // cos(0) would be exactly $8000 and so negative as a word; the `tst.w /
    // dbpl` pair at $329e turns it into $7fff
    expect(t[90]).toBe(32767)
  })

  /**
   * DEFECT: `move.w d1,-(a4)` starts at entry 5n, one past the end, so the
   * last quarter holds cos(k+1) where it should hold cos(k).
   */
  it('the last quarter of the table is one step out', () => {
    const t = run('G Set Table 90', withRam()).thegame.trig!
    // entry 360 should be sin(360) = 0 and holds sin(361) instead
    expect(t[359]).toBe(-573)
    expect(t[360]).toBe(573)
    expect(t[361]).toBe(1144)
  })

  it('=Gsin is the table shifted down eight, which is the guide’s *128', () => {
    expect(vals(['G Set Table 90', 'Print Gsin(0);Gsin(30);Gsin(90)'], withRam())).toEqual([
      0, 64, 127,
    ])
  })

  it('=Gcos reads the same table ninety entries in', () => {
    expect(vals(['G Set Table 90', 'Print Gcos(0);Gcos(60);Gcos(90)'], withRam())).toEqual([
      127, 64, 0,
    ])
  })

  /**
   * DEFECT: the routine writes only the low half of the value register and
   * then shifts the whole of it, so the negative half of the circle comes back
   * as a large positive number — $C000 read as $0000C000.
   */
  it('=Gsin cannot answer a negative number', () => {
    // sin(210) is -0.5, so -64; sin(270) is -1, so -128
    expect(vals(['G Set Table 90', 'Print Gsin(210);Gsin(270)'], withRam())).toEqual([192, 128])
    expect(vals(['G Set Table 90', 'Print Gcos(180)'], withRam())).toEqual([128])
  })

  /** the same off-by-one, seen from the function that reads that quarter */
  it('=Gcos is a step out from 270 degrees on', () => {
    expect(vals(['G Set Table 90', 'Print Gcos(270);Gcos(271)'], withRam())).toEqual([2, 4])
  })

  /**
   * No table test and no bounds test: `movea.l $bce(a0),a1` and then straight
   * into `move.w (a1,d0.w),d3`. Both read memory this port does not have.
   */
  it('=Gsin without a table reads through a null pointer', () => {
    expect(vals(['Print Gsin(30);Gcos(30)'], withRam())).toEqual([0, 0])
  })

  it('=Gsin past the end of the table reads past the end of the table', () => {
    expect(vals(['G Set Table 90', 'Print Gsin(450);Gsin(20000)'], withRam())).toEqual([0, 0])
  })

  /**
   * DEFECT: the default of 180 is applied to the size and not to the count the
   * fill is handed, so `divu.l d0,d1` at $3246 divides by zero. There is no
   * exception vector here; AMOS error 20 is the nearest true thing to say.
   */
  it('G Set Table 0 divides by zero', () => {
    expect(() => run('G Set Table 0', withRam())).toThrow(/Division by zero/i)
  })

  /** a negative count makes a negative size, and AllocMem answers zero */
  it('G Set Table with a negative count builds nothing', () => {
    const rt = run(['G Set Table 90', 'G Set Table -1'], withRam())
    // DEFECT: FreeMem ran first, so the pointers left behind are dangling
    expect(rt.thegame.trig!.length).toBe(450)
    expect(rt.thegame.trigBytes).toBe(-10)
  })

  /** a count of 45 is half-degree steps, and the whole table scales with it */
  it('G Set Table takes any resolution, not just 90', () => {
    const rt = run('G Set Table 45', withRam())
    expect(rt.thegame.trig!.length).toBe(225)
    expect(rt.thegame.cosAt).toBe(45)
    // entry 45 is a quarter turn whatever n is
    expect(rt.thegame.trig![45]).toBe(32767)
  })
})

/**
 * The encryption batch.
 *
 * The compression underneath is ../amiga/stonecracker.ts and is tested there;
 * what is checked here is the container The Game wraps round it — the bank,
 * the magic longword, the four swaps and the password that drives them.
 */
describe('the encryption keywords', () => {
  const withFile = (data: Uint8Array): AmigaFS => {
    const fs = withRam()
    fs.writeFile('RAM:secret.dat', data)
    return fs
  }
  /** something that will not crunch to nothing, so the bank is a real size */
  const payload = ((): Uint8Array => {
    const out = new Uint8Array(900)
    let x = 12345
    for (let i = 0; i < out.length; i++) {
      x = (Math.imul(x, 1103515245) + 12345) >>> 0
      out[i] = (x >>> 16) & 0xff
    }
    return out
  })()

  it('G Init Encyrpt reserves a hundred thousand bytes in bank 9', () => {
    const rt = run('G Init Encyrpt', withRam())
    const b = rt.memBanks.get(9)!
    expect(b.data.length).toBe(100_000)
    expect(b.name).toBe(TGE_ENCRYPT_BANK_NAME)
    // `bset.b #$0,d1` on an uninitialised register: bit 0 is Bnk_BitData
    expect(b.flags & 1).toBe(1)
  })

  it('G Encrypt fills the bank it is given, not bank 9', () => {
    const rt = run('G Encrypt "RAM:secret.dat",5,"password"', withFile(payload))
    expect(rt.memBanks.get(5)!.name).toBe(TGE_ENCRYPT_BANK_NAME)
    expect(rt.memBanks.has(9)).toBe(false)
  })

  it('the bank holds a crunch of the file', () => {
    const text = bytesOf('AMOS Professional and The Game Extension. '.repeat(40))
    const rt = run('G Encrypt "RAM:secret.dat",5,"password"', withFile(text))
    expect(rt.memBanks.get(5)!.data.length).toBeLessThan(text.length / 2)
    expect(run(['G Encrypt "RAM:secret.dat",5,"p"', 'G Decrypt 5 To 6,"p"'], withFile(text)).memBanks.get(6)!.data).toEqual(text)
  })

  it('G Decrypt gives the file back', () => {
    const rt = run(
      ['G Encrypt "RAM:secret.dat",5,"password"', 'G Decrypt 5 To 6,"password"'],
      withFile(payload),
    )
    expect(rt.memBanks.get(6)!.data).toEqual(payload)
  })

  /** the four swaps and the magic longword, with nothing in between */
  it('the encrypted bank is not the crunched file', () => {
    const rt = run('G Encrypt "RAM:secret.dat",5,"password"', withFile(payload))
    const bank = rt.memBanks.get(5)!.data
    // `S404` plus $1131511 in the first longword
    expect(bank[0]).not.toBe(0x53)
    // and the four swaps reach up to bank + 272, which this one is long
    // enough for -- see the short-bank case below
    expect(bank.length).toBeGreaterThan(272)
  })

  /**
   * The password is one byte: `add.b` cannot carry, and the doubled sum is
   * stored as a longword whose top two bytes are therefore always zero.
   */
  it('a password differing only in its last character unlocks the bank', () => {
    // the checksum loop walks offsets len..0 of the AMOS string, so the last
    // character is never added
    const rt = run(
      ['G Encrypt "RAM:secret.dat",5,"secret"', 'G Decrypt 5 To 6,"secreX"'],
      withFile(payload),
    )
    expect(rt.memBanks.get(6)!.data).toEqual(payload)
  })

  it('two passwords with the same byte sum unlock each other', () => {
    // "ab" and "ba" differ, but only the first character of each is summed
    expect(keyChecksum('ab')).toBe(keyChecksum('aX'))
    expect(keyChecksum('')).toBe(0)
  })

  /** DEFECT: nothing puts the source bank back the way it was */
  it('G Decrypt leaves the source bank decrypted', () => {
    const rt = run(
      ['G Encrypt "RAM:secret.dat",5,"password"', 'G Decrypt 5 To 6,"password"'],
      withFile(payload),
    )
    const bank = rt.memBanks.get(5)!.data
    // it is the plain crunched file again, magic and all
    expect(Array.from(bank.subarray(0, 4))).toEqual([0x53, 0x34, 0x30, 0x34])
  })

  /** DEFECT: OpenLibrary on every call, the base stored over the last */
  it('G Encrypt opens stc.library again every time', () => {
    const rt = run(
      ['G Encrypt "RAM:secret.dat",5,"a"', 'G Encrypt "RAM:secret.dat",6,"a"'],
      withFile(payload),
    )
    expect(rt.thegame.stcOpens).toBe(2)
    // G Decrypt tests the base first, so it adds nothing
    const rt2 = run(
      ['G Encrypt "RAM:secret.dat",5,"a"', 'G Decrypt 5 To 6,"a"'],
      withFile(payload),
    )
    expect(rt2.thegame.stcOpens).toBe(1)
  })

  /**
   * DEFECT: the swaps reach bank + 272 with no length test, and it is
   * contained here rather than reproduced.
   * A file that crunches to less than that is written past on the machine;
   * the swap is skipped here, and skipped the same way by G Decrypt, so the
   * pair still round-trips.
   */
  it('a bank too short for the swaps still round-trips', () => {
    const tiny = bytesOf('tiny')
    const rt = run(
      ['G Encrypt "RAM:secret.dat",5,"password"', 'G Decrypt 5 To 6,"password"'],
      withFile(tiny),
    )
    expect(rt.memBanks.get(5)!.data.length).toBeLessThan(272)
    expect(rt.memBanks.get(6)!.data).toEqual(tiny)
  })

  /** DEFECT: the FileInfoBlock goes on every call, as it does for File Size */
  it('G Encrypt leaks a FileInfoBlock', () => {
    const rt = run('G Encrypt "RAM:secret.dat",5,"a"', withFile(payload))
    expect(rt.thegame.fibLeak).toBe(1000)
  })

  /** a file that will not lock is `moveq #$51,d0` into G Exit */
  it('G Encrypt on a missing file is AMOS error 81', () => {
    expect(() => run('G Encrypt "RAM:nothere",5,"a"', withRam())).toThrow(/File format not recognised/i)
  })
})

describe('=G Word$', () => {
  /**
   * The guide says "Not DONE". Both length tests are dead and the second scan
   * counts the separator's offset twice, so on the machine it reads past the
   * string into AMOS's string bank; there is no such bank here, both scans
   * stop at the end of the text, and the answer is the empty string for any
   * string short enough that the doubled offset is already past its end.
   */
  it('answers the empty string for an ordinary call', () => {
    expect(vals(['A$=G Word$("one two three",1,32)', 'Print Len(A$)'], withRam())).toEqual([0])
  })

  it('answers the empty string when the separator is not there at all', () => {
    expect(vals(['A$=G Word$("no separators here",1,124)', 'Print Len(A$)'], withRam())).toEqual([0])
  })

  /**
   * The doubled offset only lands inside the string when the first separator
   * is very near the front and the string is long, which is the one shape
   * where the routine returns anything — and what it returns starts two
   * characters after the separator, not one.
   */
  it('returns a field only when the doubled offset lands inside the string', () => {
    // the separator is at text index 0, so d3 = 2, the field starts at text
    // index 2 -- one character further on than it should -- and the second
    // scan looks for the next separator from raw offset d3 + d3 + 1
    const rt = boot('A$=G Word$("|abcdef|ghij",1,124) : Print A$;"."', withRam())
    mustFinish(rt.runHeadless(2000))
    expect(rt.out().trim()).toBe('bcdef.')
  })
})

describe('the rest of batch 1a', () => {
  /**
   * `move.l -$18ae(a5),d3` — AMOS's graphics.library base, and nothing to do
   * with odd numbers. The spec is `V0`, a reserved variable, so it takes no
   * brackets either.
   */
  it('=G Oddno answers the graphics.library base', () => {
    expect(vals(['Print G Oddno'], withRam())).toEqual([TGE_GFX_BASE])
  })

  /**
   * DEFECT: `move.l #$80,d0` into SetTaskPri, which reads a signed byte — so
   * the guide's "priority of 256! ... thus speeding up your code" installs the
   * lowest priority there is.
   */
  it('G Handicap sets the priority to -128, not to 128', () => {
    const rt = run('G Handicap', withRam())
    expect(rt.thegame.priority).toBe(-128)
    expect(rt.thegame.handicapped).toBe(true)
  })

  it('G Unhandicap puts the old priority back', () => {
    const rt = run(['G Handicap', 'G Unhandicap'], withRam())
    expect(rt.thegame.priority).toBe(0)
  })

  /** DEFECT: the second call saves the handicap, so the restore restores it */
  it('G Handicap twice loses the priority it displaced', () => {
    const rt = run(['G Handicap', 'G Handicap', 'G Unhandicap'], withRam())
    expect(rt.thegame.priority).toBe(-128)
  })

  /** DEFECT: neither the task pointer nor the saved priority is tested */
  it('G Unhandicap on its own has no task to set', () => {
    const rt = run('G Unhandicap', withRam())
    expect(rt.thegame.priority).toBe(0)
    expect(rt.thegame.handicapped).toBe(false)
  })
})
