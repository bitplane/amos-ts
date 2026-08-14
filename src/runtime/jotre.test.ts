import { describe, expect, it } from 'vitest'
import { mustFinish } from '../testing/run'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { extensionById } from '../ext/registry'
import { thxModuleFile } from '../testing/thxmodule'
import { Runtime } from './runtime'
import { JOTRE_ERRORS, JOTRE_PLAYING, JOTRE_READY, jotreVbl } from './jotre'

const table = new TokenTable(CORE_TOKENS)
/**
 * Slot 22, three ways: routine 0's `move.l a3,$248(a5)` on the ExtAdr layout
 * +Equ.s:1176-1183 fixes, its `moveq #$15,d0` return, and the Guide's own
 * "Find and select extension slot 22".
 */
const jotre = extensionById('jotre-1.0')!

interface Boot {
  rt: Runtime
  out: () => string
}

function boot(src: string): Boot {
  const exts = new Map([[22, jotre.table]])
  let printed = ''
  const rt = new Runtime(tokenize(src, table, exts), table, {
    extensions: exts,
    extBindings: new Map([[22, jotre]]),
    maxSteps: 200_000,
    onText: (t) => (printed += t),
  })
  return { rt, out: () => printed }
}

function run(src: string): Boot {
  const b = boot(src)
  const r = b.rt.runHeadless(2000)
  mustFinish(r)
  return b
}

/** a THX module the way the Guide says to make one: Bloaded into a data bank */
const MODULE = 'Reserve As Data 1,64\nPoke Start(1),84\nPoke Start(1)+1,72\nPoke Start(1)+2,88\nPoke Start(1)+3,2\n'

/**
 * The same bank, holding a module the parser will actually walk.
 *
 * The Guide's own route is `Bload` into a reserved bank, and there is no
 * keyword here that reads a file — Jotre never touches the filesystem — so the
 * bank is filled directly and the program plays `Start(1)`.
 */
function bootModule(src: string, file: Uint8Array = thxModuleFile({ version: 2 })): Boot {
  const b = boot(src)
  b.rt.reserveBank(1, file.length, 'THXMod', true, false)
  b.rt.memBanks.get(1)!.data.set(file)
  return b
}

function runModule(src: string, file: Uint8Array = thxModuleFile({ version: 2 })): Boot {
  const b = bootModule(src, file)
  mustFinish(b.rt.runHeadless(2000))
  return b
}

/**
 * N real frames.
 *
 * `Wait n` will not do: runHeadless fast-forwards it by moving the tick to
 * `until - 1`, so no frame runs and the VBL hook never fires.
 */
const VBLS = (n: number): string => `For I=1 To ${String(n)} : Wait Vbl : Next I\n`

describe('Jotre 1.0 — the THX shim', () => {
  it('routine 0 leaves the flag byte clear', () => {
    const { rt } = boot('')
    expect([rt.jotre.flags, rt.jotre.module, rt.jotre.subSong]).toEqual([0, 0, 0])
    expect([rt.jotre.version, rt.jotre.volume, rt.jotre.parsed]).toEqual([0, 0, null])
    expect(rt.jotre.player.playing).toBe(false)
  })

  it('Init Thx sets bit 0 and a second one is error 2 (routine 4, $2e1a)', () => {
    expect(run('Init Thx').rt.jotre.flags).toBe(JOTRE_READY)
    expect(() => run('Init Thx\nInit Thx')).toThrow(JOTRE_ERRORS[2])
  })

  it('the other four all need bit 0 and raise error 1 without it', () => {
    for (const src of ['Deinit Thx', 'Play Thx 0,0', 'Stop Thx', 'Volume Thx 32']) {
      expect(() => run(src)).toThrow(JOTRE_ERRORS[1])
    }
  })

  it('Play Thx stores its arguments BEFORE the init test (routine 6, $2f4a)', () => {
    // the address goes to block+$2bcc at $2f5a and the sub-song to $2bd0 at
    // $2f64; the `andi.l #$1` test is not until $2f76
    const b = boot('Play Thx 1234,7')
    expect(() => b.rt.runHeadless(2000)).toThrow(JOTRE_ERRORS[1])
    expect(b.rt.jotre.module).toBe(1234)
    expect(b.rt.jotre.subSong).toBe(7)
  })

  it('Play Thx checks "THX" and sets bit 1 (InitModule, $802)', () => {
    const { rt } = run(`Init Thx\n${MODULE}Play Thx Start(1),0`)
    expect(rt.jotre.flags).toBe(JOTRE_READY | JOTRE_PLAYING)
  })

  it('InitModule STASHES the version byte and ZEROES it in the caller\'s bank', () => {
    // `move.b $3(a0),$43e(a6) / clr.b $3(a0)` happens before the compare, so
    // any version passes and the module's fourth byte is destroyed by playing
    const { rt } = run(`Init Thx\n${MODULE}Play Thx Start(1),0`)
    expect(rt.jotre.version).toBe(2)
    expect(rt.memBanks.get(1)!.data[3]).toBe(0)
    // and the byte having been cleared is exactly why version 2 was accepted
    expect(rt.jotre.flags & JOTRE_PLAYING).toBe(JOTRE_PLAYING)
  })

  it('a module that is not THX is error 3', () => {
    const bad = 'Reserve As Data 1,64\nPoke Start(1),77\nPoke Start(1)+1,79\nPoke Start(1)+2,68\n'
    expect(() => run(`Init Thx\n${bad}Play Thx Start(1),0`)).toThrow(JOTRE_ERRORS[3])
    // an address that resolves nowhere fails the same way
    expect(() => run('Init Thx\nPlay Thx 1234,0')).toThrow(JOTRE_ERRORS[3])
  })

  it('Stop Thx clears bit 1 with the right mask (routine 7, $3006)', () => {
    const { rt } = run(`Init Thx\n${MODULE}Play Thx Start(1),0\nStop Thx`)
    expect(rt.jotre.flags).toBe(JOTRE_READY)
    // it does NOT test bit 1 first, so stopping what never started is allowed
    expect(() => run('Init Thx\nStop Thx')).not.toThrow()
  })

  it('DEFECT: Deinit Thx clears bit 0 only, so PLAYING survives (routine 5, $2eaa)', () => {
    // `move.b #$ff,d1 / subi.b #$1,d1 / and.b d1,d0` --- $FE, not $FC
    const { rt } = run(`Init Thx\n${MODULE}Play Thx Start(1),0\nDeinit Thx`)
    expect(rt.jotre.flags).toBe(JOTRE_PLAYING)
    // and the next Init starts with the block already claiming to play
    const again = run(`Init Thx\n${MODULE}Play Thx Start(1),0\nDeinit Thx\nInit Thx`)
    expect(again.rt.jotre.flags).toBe(JOTRE_READY)
  })

  it('the VBL gate wants BOTH bits (the hook at $112)', () => {
    const { rt } = boot('')
    expect(jotreVbl(rt.jotre)).toBe(false)
    rt.jotre.flags = JOTRE_READY
    expect(jotreVbl(rt.jotre)).toBe(false)
    rt.jotre.flags = JOTRE_PLAYING
    expect(jotreVbl(rt.jotre)).toBe(false)
    rt.jotre.flags = JOTRE_READY | JOTRE_PLAYING
    expect(jotreVbl(rt.jotre)).toBe(true)
  })

  it('Volume Thx takes the low byte and clamps nothing (routine 8, $3074)', () => {
    // the Guide says 0..63; `move.b d7,(a1)` says otherwise
    expect(run('Init Thx\nVolume Thx 32').rt.jotre.volume).toBe(32)
    expect(run('Init Thx\nVolume Thx 255').rt.jotre.volume).toBe(255)
    expect(run('Init Thx\nVolume Thx 256').rt.jotre.volume).toBe(0)
    expect(run('Init Thx\nVolume Thx -1').rt.jotre.volume).toBe(255)
  })

  describe('the replayer behind the shim', () => {
    it('Play Thx parses the bank and starts the song', () => {
      const { rt } = runModule('Init Thx\nPlay Thx Start(1),0')
      expect(rt.jotre.parsed).not.toBeNull()
      expect(rt.jotre.player.playing).toBe(true)
    })

    it('accepts a version byte thx-0.6 would refuse, because it cleared it first', () => {
      // the module is built at version 2. `clr.b $3(a0)` runs before the
      // compare, so the parse sees a zero and ../runtime/thx.ts's `bytes[3]
      // !== 0` test has no counterpart here
      const { rt } = runModule('Init Thx\nPlay Thx Start(1),0')
      expect(rt.jotre.version).toBe(2)
      expect(rt.jotre.parsed!.version).toBe(0)
    })

    it('the VBL gate wants BOTH bits, and steps the song when it has them', () => {
      const { rt } = runModule('Init Thx\nPlay Thx Start(1),0')
      // one two-row track at the default speed of six: six frames a row
      for (let i = 0; i < 6; i++) rt.frame()
      expect(rt.jotre.player.row).toBe(1)
    })

    it('Stop Thx stops the engine and Play Thx starts it again', () => {
      const { rt } = runModule(`Init Thx\nPlay Thx Start(1),0\n${VBLS(6)}Stop Thx`)
      expect(rt.jotre.player.playing).toBe(false)
      const at = rt.jotre.player.row
      for (let i = 0; i < 12; i++) rt.frame()
      expect(rt.jotre.player.row).toBe(at)
    })

    it('DEFECT: Deinit Thx leaves PLAYING set, and the gate is what stops the frame', () => {
      // bit 0 is gone, so `jotreVbl` refuses even though bit 1 says otherwise
      const { rt } = runModule(`Init Thx\nPlay Thx Start(1),0\n${VBLS(6)}Deinit Thx`)
      expect(rt.jotre.flags).toBe(JOTRE_PLAYING)
      expect(jotreVbl(rt.jotre)).toBe(false)
      // and StopSong DID run on the way past, so the engine is stopped too
      expect(rt.jotre.player.playing).toBe(false)
    })

    it('Volume Thx writes the replayer global, and Init Thx puts it back to $40', () => {
      // `move.b #$40,$1(a6)` at $776 is the last thing InitPlayer does
      expect(run('Init Thx').rt.jotre.player.playerVolume).toBe(0x40)
      const { rt } = run('Init Thx\nVolume Thx 99')
      expect(rt.jotre.player.playerVolume).toBe(99)
      // 99 is past the chain's unity of 64 and nothing here clamps the TERM,
      // which is the loudness thx-0.6's author complained about
      expect(rt.jotre.player.playerVolume).toBeGreaterThan(64)
    })

    it('an error-3 Play Thx leaves the running song alone, where thx-0.6 would not', () => {
      const b = bootModule('Init Thx\nPlay Thx Start(1),0\nReserve As Data 2,64\nPlay Thx Start(2),0')
      expect(() => b.rt.runHeadless(2000)).toThrow(JOTRE_ERRORS[3])
      // routine 6 tests InitModule's -1 and raises, so StartSong never runs
      // and the engine still holds the first module. thx-0.6 never tests the
      // return code at all and calls StartSong over the rubbish --- see
      // ./thx.ts, where that is one of the author's declared defects
      expect(b.rt.jotre.player.playing).toBe(true)
      expect(b.rt.jotre.parsed).not.toBeNull()
    })
  })
})
