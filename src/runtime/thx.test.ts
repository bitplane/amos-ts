/**
 * THX 0.6's six keywords, driven from BASIC.
 *
 * The module the file loads is built here rather than taken from the corpus,
 * because what these tests are about is the shim: which errors fire, what the
 * bank ends up called, when the play flag moves. `../amiga/thx.corpus.test.ts`
 * is where real modules go through the parser and the sequencer.
 */
import { describe, expect, it } from 'vitest'
import { mustFinish } from '../testing/run'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { extensionById } from '../ext/registry'
import { AmigaFS } from '../amiga/vfs'
import { THX_BANK_NAME, THX_ERRORS } from './thx'
import { Runtime } from './runtime'

const table = new TokenTable(CORE_TOKENS)
/** `move.l a4,$228(a5)` in routine 0, and `($228-$f8)/16 + 1` is 20 */
const THX_SLOT = 20
const thx = extensionById('thx-0.6')!
const extensions = new Map([[THX_SLOT, thx.table]])

/**
 * The smallest module the parser accepts: one position, one two-row track, one
 * instrument, no subsongs. Byte 3 is the version and must be ZERO — see
 * ../amiga/thx.ts on why this extension rejects anything else and Jotre does
 * not.
 */
function moduleFile(subSongs = 0, version = 0): Uint8Array {
  const body: number[] = []
  for (let i = 0; i < subSongs; i++) body.push(0, 0)
  body.push(1, 0, 0, 0, 0, 0, 0, 0)
  body.push(0, 0, 0, 0, 0, 0)
  body.push(0x40, 0x05, 1, 2, 3, 4, 5, 6, 7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)
  const nameOffset = 14 + body.length
  return Uint8Array.from([
    0x54, 0x48, 0x58, version,
    nameOffset >> 8, nameOffset & 0xff,
    0x80, 1,
    0, 0,
    2, 1, 1, subSongs,
    ...body,
    0, 0,
  ])
}

interface Boot {
  rt: Runtime
  out: () => string
}

function boot(src: string, file: Uint8Array | null = moduleFile()): Boot {
  const fs = new AmigaFS()
  fs.mountMemory('RAM')
  if (file) fs.writeFile('RAM:tune.thx', file)
  let printed = ''
  const rt = new Runtime(tokenize(src, table, extensions), table, {
    extensions,
    extBindings: new Map([[THX_SLOT, thx]]),
    maxSteps: 200_000,
    onText: (t) => (printed += t),
    fs,
  })
  return { rt, out: () => printed }
}

function run(src: string, file: Uint8Array | null = moduleFile()): Boot {
  const b = boot(src, file)
  mustFinish(b.rt.runHeadless(4000))
  return b
}

/** the bank a program would otherwise make with Thx Load */
const LOAD = 'Thx Load "RAM:tune.thx",5\n'

/**
 * N real frames.
 *
 * `Wait n` will not do: runHeadless fast-forwards it by moving the tick to
 * `until - 1`, so the frames are skipped and the VBL hook never runs. `Wait
 * Vbl` blocks for exactly one and has to be stepped.
 */
const VBLS = (n: number): string => `For I=1 To ${String(n)} : Wait Vbl : Next I\n`

describe('THX 0.6 — the six keywords', () => {
  it('starts with the play flag clear and no module', () => {
    const { rt } = boot('')
    expect([rt.thx.playing, rt.thx.module, rt.thx.parsed]).toEqual([false, 0, null])
  })

  describe('Thx Load (routine 4, $105e)', () => {
    it('reserves the bank, names it and fills it', () => {
      const { rt } = run(LOAD)
      const bank = rt.memBanks.get(5)!
      expect(bank.name).toBe(THX_BANK_NAME)
      expect(bank.data.length).toBe(moduleFile().length)
      expect(Array.from(bank.data.subarray(0, 3))).toEqual([0x54, 0x48, 0x58])
    })

    it('rounds an odd file up to an even bank', () => {
      // `btst.b #$0,d2 / addq.l #$1,d2` --- V0.5's fix for the compiler's
      // "Not an AMOS-Program" on an odd bank
      const odd = Uint8Array.from([...moduleFile(), 0x55])
      const { rt } = run(LOAD, odd)
      expect(odd.length % 2).toBe(1)
      expect(rt.memBanks.get(5)!.data.length).toBe(odd.length + 1)
      // and the extra byte is not read from the file --- it is just room
      expect(rt.memBanks.get(5)!.data[odd.length]).toBe(0)
    })

    it('is error 81 when the file is not there', () => {
      expect(() => run('Thx Load "RAM:nope.thx",5\n')).toThrow(/File not found/)
    })
  })

  describe('Thx Play (routine 2, $fec)', () => {
    it('sets the play flag and starts the replay', () => {
      const { rt } = run(`${LOAD}Thx Play 5,0`)
      expect(rt.thx.playing).toBe(true)
      expect(rt.thx.module).toBe(5)
      expect(rt.thx.parsed).not.toBeNull()
      expect(rt.thx.player.playing).toBe(true)
    })

    it('is error 36 when the bank is not reserved', () => {
      expect(() => run('Thx Play 5,0')).toThrow(/Bank not reserved/)
    })

    it('takes a bank that is NOT a THX module, which is the declared defect', () => {
      // "There is also no routine to check, if the bank you access contains a
      // THX module." Nothing raises --- the flag goes up on rubbish.
      const { rt } = run('Reserve As Data 5,64\nThx Play 5,0')
      expect(rt.thx.playing).toBe(true)
      expect(rt.thx.parsed).toBeNull()
    })

    it('refuses a non-zero version byte, where Jotre would clear it and accept', () => {
      // `cmpi.l #$54485800,(a0)+` compares "THX" AND a version of zero, and
      // this routine does not clear the byte first the way Jotre's does
      const bad = run(`${LOAD}Thx Play 5,0`, moduleFile(0, 2))
      expect(bad.rt.thx.parsed).toBeNull()
      // the flag still goes up, because the return code is never tested
      expect(bad.rt.thx.playing).toBe(true)
      // and the same module at version 0 parses, so it is the byte and
      // nothing else that made the difference
      expect(run(`${LOAD}Thx Play 5,0`, moduleFile(0, 0)).rt.thx.parsed).not.toBeNull()
    })
  })

  describe('Thx Stop (routine 3, $1040)', () => {
    it('clears the flag and stops the replay', () => {
      const { rt } = run(`${LOAD}Thx Play 5,0\nThx Stop`)
      expect(rt.thx.playing).toBe(false)
      expect(rt.thx.player.playing).toBe(false)
    })

    it('does nothing at all when nothing is playing', () => {
      // `tst.b (a2) / beq` is the first instruction, so StopSong is not called
      const { rt } = run('Thx Stop')
      expect(rt.thx.playing).toBe(false)
    })
  })

  describe('Thx Volume (routine 5, $111e)', () => {
    it('takes 0 to 63 and writes the replayer global at state+$1', () => {
      expect(run('Thx Volume 0').rt.thx.player.playerVolume).toBe(0)
      expect(run('Thx Volume 63').rt.thx.player.playerVolume).toBe(63)
    })

    it('is error 23 outside that range, which V0.6 added', () => {
      // "I noticed that the music became louder when using 'Thx Volume 99'."
      for (const v of ['64', '99', '-1']) {
        expect(() => run(`Thx Volume ${v}`)).toThrow(/Illegal function call/)
      }
    })

    it('cannot reach the chain unity of 64, so 63 is one step below full', () => {
      const { rt } = run('Thx Volume 63')
      expect(rt.thx.player.playerVolume).toBeLessThan(64)
    })
  })

  describe('=Thx Subsongs (routine 6, $1156)', () => {
    it('initialises the bank and answers its count', () => {
      const { out } = run(`${LOAD}Print Thx Subsongs(5)`, moduleFile(3))
      expect(out()).toBe(' 3\n')
    })

    it('is error 1 while something is playing', () => {
      expect(() => run(`${LOAD}Thx Play 5,0\nPrint Thx Subsongs(5)`)).toThrow(THX_ERRORS[1])
    })

    it('is error 36 for a bank that is not there', () => {
      expect(() => run('Print Thx Subsongs(5)')).toThrow(/Bank not reserved/)
    })

    it('answers for the module already loaded when the bank is zero or less', () => {
      const { out } = run(`${LOAD}Print Thx Subsongs(5)\nPrint Thx Subsongs(0)`, moduleFile(2))
      expect(out()).toBe(' 2\n 2\n')
    })

    it('is error 2 when nothing has ever been initialised', () => {
      expect(() => run('Print Thx Subsongs(0)')).toThrow(THX_ERRORS[2])
    })
  })

  describe('=Thx End (routine 7, $11c8)', () => {
    it('is error 2 before anything has been played', () => {
      expect(() => run('Print Thx End')).toThrow(THX_ERRORS[2])
    })

    it('answers 0 while the song is still going', () => {
      expect(run(`${LOAD}Thx Play 5,0\nPrint Thx End`).out()).toBe(' 0\n')
    })

    it('answers 255, not 1, once the song has wrapped', () => {
      // `st.b $3(a6)` sets every bit. One position of a two-row track at
      // speed 6 is twelve frames. The loop is `Wait Vbl` and not `Wait 15`
      // because runHeadless FAST-FORWARDS a timed wait --- it jumps the tick
      // straight to `until - 1` --- so no frame would run and no VBL with it.
      const b = run(`${LOAD}Thx Play 5,0\n${VBLS(14)}Print Thx End`)
      expect(b.out()).toBe(' 255\n')
    })

    it('does not clear the flag, so it stays 255 while the song goes round', () => {
      // only StartSong clears it (`sf.b $3(a6)`), and nothing here calls that
      const b = run(`${LOAD}Thx Play 5,0\n${VBLS(14)}Print Thx End\n${VBLS(14)}Print Thx End`)
      expect(b.out()).toBe(' 255\n 255\n')
    })
  })

  it('the VBL hook only ticks while the play flag is up', () => {
    const stopped = run(`${LOAD}Thx Play 5,0\nThx Stop`)
    const before = stopped.rt.thx.player.row
    for (let i = 0; i < 20; i++) stopped.rt.frame()
    expect(stopped.rt.thx.player.row).toBe(before)

    const playing = run(`${LOAD}Thx Play 5,0`)
    for (let i = 0; i < 6; i++) playing.rt.frame()
    expect(playing.rt.thx.player.row).toBe(1)
  })
})
