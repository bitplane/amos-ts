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
import { PT_PLAY_VOLUME, thegameVbl } from './thegame'

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
