/**
 * The three keywords appended to APD426's Music.Lib, against
 * `extdis music-omega-1.0` and against the one program in the corpus that
 * calls any of them.
 *
 * That program is `techno.amos` on the same disc, and it is worth naming what
 * it gives and what it does not. It gives the argument ORDER, because
 * `Starplay 0,0,0,1` is only a sensible thing for a demo to do under one
 * reading of the four. It gives `Starset Start(13),` with the second argument
 * elided. It does not exercise the AMOS-sample table, the start row, the
 * start position, or the one-pattern arm, so those are checked here against
 * the disassembly alone.
 */
import { describe, expect, it } from 'vitest'
import { mustFinish } from '../testing/run'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { extensionById } from '../ext/registry'
import { AmigaFS } from '../amiga/vfs'
import { Runtime } from './runtime'

const table = new TokenTable(CORE_TOKENS)
/** the stock slot, and the one APD426 kept: this is Music with three more entries */
const SLOT = 1
const omega = extensionById('music-omega-1.0')!
const extensions = new Map([[SLOT, omega.table]])

/**
 * A four-pattern M.K. module, one 64-byte sample, one note on row 0 of every
 * pattern. Every pattern is its own position, so a wrap is visible in `pos`.
 */
function modFile(): Uint8Array {
  const PATTERNS = 4
  const d = new Uint8Array(1084 + PATTERNS * 1024 + 64)
  const dv = new DataView(d.buffer)
  dv.setUint16(20 + 22, 32) // sample 1 is 64 bytes, counted in words
  d[20 + 25] = 40 // volume
  dv.setUint16(20 + 28, 1) // the conventional one-word repeat
  d[950] = PATTERNS // $3b6, the song length Starplay's wrap test reads
  for (let p = 0; p < PATTERNS; p++) d[952 + p] = p
  d.set([0x4d, 0x2e, 0x4b, 0x2e], 1080) // "M.K."
  for (let p = 0; p < PATTERNS; p++) {
    const at = 1084 + p * 1024
    d[at] = 0x1ac >> 8
    d[at + 1] = 0x1ac & 0xff
    d[at + 2] = 0x10 // instrument 1, no command
  }
  return d
}

const MOD = modFile()
/** reserve a chip bank and read the module into it; `Start(5)` is then its address */
const LOAD = `Reserve As Chip Data 5,${MOD.length} : Bload "RAM:tune.mod",5 : `

function run(src: string, data: Uint8Array | null = MOD): Runtime {
  const fs = new AmigaFS()
  fs.mountMemory('RAM')
  if (data) fs.writeFile('RAM:tune.mod', data)
  const rt = new Runtime(tokenize(src, table, extensions), table, {
    extensions,
    extBindings: new Map([[SLOT, omega]]),
    maxSteps: 200_000,
    fs,
  })
  mustFinish(rt.runHeadless(2_000))
  return rt
}

/** step frames until the player stops or the position moves; answer the frames spent */
function frames(rt: Runtime, n: number): void {
  for (let i = 0; i < n; i++) rt.frame()
}

describe('Music (Omega): Starset', () => {
  it('records the module address and parses nothing', () => {
    // routine 84 is `movea.l (a3)+,a0 / movea.l (a3)+,a1 / ... / move.l
    // a1,$924(a3)` and that is all: no signature test, no length, no error
    const rt = run(`${LOAD}Starset Start(5),0`)
    const at = rt.resolveAddr(rt.musicOmega.mod)!
    expect(at.data).toBe(rt.memBanks.get(5)!.data)
    expect(at.off).toBe(0)
    expect(rt.musicOmega.replay.song).toBeNull()
    expect(rt.musicOmega.active).toBe(false)
  })

  it('adds 24 to the second argument, which is a bank node rather than its data', () => {
    // `adda.l #$18,a0` before the store --- Bnk_Reserve puts a bank's data 24
    // bytes past its node (+Lib.s:8494), so this is a node being read as one
    const rt = run(`${LOAD}Starset Start(5),1000`)
    expect(rt.musicOmega.samples).toBe(1024)
  })

  it('takes an elided second argument, which is what the one real caller writes', () => {
    // techno.amos:70 is `Starset Start(13),` --- the comma's FnNull loads
    // EntNul ($80000000, +Equ.s:67), so the sample base becomes $80000018 and
    // the 'AM' test at $764 reads an address resolveAddr answers null for
    const rt = run(`${LOAD}Starset Start(5),`)
    expect(rt.musicOmega.samples).toBe(0x8000_0018)
    expect(rt.resolveAddr(rt.musicOmega.samples)).toBeNull()
  })

  it('accepts an address that is not a module, and says nothing until Starplay', () => {
    const rt = run('Starset 4,0 : Starplay 0,0,0,0')
    expect(rt.musicOmega.mod).toBe(4)
    expect(rt.musicOmega.active).toBe(false)
  })
})

describe('Music (Omega): Starplay', () => {
  it('starts at speed 5, where ProTracker itself starts at 6', () => {
    // `move.b #$5,$7f4(a3)` at $29b4
    const rt = run(`${LOAD}Starset Start(5), : Starplay 0,0,0,1`)
    expect(rt.musicOmega.active).toBe(true)
    expect(rt.musicOmega.replay.speed).toBe(5)
  })

  it('reads its four arguments backwards, as the pops require', () => {
    // ONEPATTERN,POSITION,ROW,LOOP: the last pops first into $531 (loop), then
    // $532 (row x16), then $535 (position), then $534 (one pattern)
    const rt = run(`${LOAD}Starset Start(5), : Starplay 1,2,3,1`)
    const st = rt.musicOmega
    expect([st.onePattern, st.startPos, st.startRow, st.loop]).toEqual([true, 2, 3, true])
    expect(rt.musicOmega.replay.pos).toBe(2)
    expect(rt.musicOmega.replay.row).toBe(3)
  })

  it('masks each argument instead of checking it', () => {
    // andi.b #$1 on the flags, andi.b #$7f on the position, andi.w #$3f on the
    // row. Nothing here can raise an error; the library has no message table
    const rt = run(`${LOAD}Starset Start(5), : Starplay 2,130,70,2`)
    const st = rt.musicOmega
    expect([st.onePattern, st.startPos, st.startRow, st.loop]).toEqual([false, 2, 6, false])
  })

  it('does nothing at all when Starset was never called', () => {
    const rt = run('Starplay 0,0,0,1')
    expect(rt.musicOmega.active).toBe(false)
  })
})

describe('Music (Omega): the interrupt', () => {
  it('loops the whole song, which is what techno.amos asks for', () => {
    // Starplay 0,0,0,1 --- every pattern, round and round. $6a4 advances the
    // position, and $6cc puts it back to $535 when it runs off the end
    const rt = run(`${LOAD}Starset Start(5), : Starplay 0,0,0,1`)
    const st = rt.musicOmega
    frames(rt, 5 * 64 * 4 + 20) // four patterns of 64 rows at five ticks a row
    expect(st.active).toBe(true)
    expect(st.replay.pos).toBeLessThan(4)
  })

  it('stops at the end of the song when the loop flag is clear', () => {
    // `tst.b $531(a6) / bne / move.b #$1,$530(a6)` at $6bc
    const rt = run(`${LOAD}Starset Start(5), : Starplay 0,0,0,0`)
    const st = rt.musicOmega
    frames(rt, 5 * 64 * 4 + 20)
    expect(st.active).toBe(false)
  })

  it('restarts at the position it was given, not at zero', () => {
    // $6cc is `move.b $535(a6),$7f8(a6)`, and $535 is Starplay's POSITION ---
    // so a song started at 2 loops 2 to the end rather than round the whole of it
    const rt = run(`${LOAD}Starset Start(5), : Starplay 0,2,0,1`)
    const st = rt.musicOmega
    frames(rt, 5 * 64 * 4 + 20)
    expect(st.active).toBe(true)
    expect(st.replay.pos).toBeGreaterThanOrEqual(2)
  })

  it('holds one pattern when $534 is set, and holds it forever with the loop flag', () => {
    // $68a: the position never advances, the row goes back to $532
    const rt = run(`${LOAD}Starset Start(5), : Starplay 1,1,0,1`)
    const st = rt.musicOmega
    frames(rt, 5 * 64 * 3 + 20)
    expect(st.active).toBe(true)
    expect(st.replay.pos).toBe(1)
  })

  it('plays that one pattern once when the loop flag is clear', () => {
    // `cmpi.b #$1,$531(a6) / beq / move.b #$1,$530(a6)`
    const rt = run(`${LOAD}Starset Start(5), : Starplay 1,1,0,0`)
    const st = rt.musicOmega
    frames(rt, 5 * 64 + 20)
    expect(st.active).toBe(false)
  })

  it('does not run while the player is off', () => {
    const rt = run(`${LOAD}Starset Start(5),`)
    frames(rt, 50)
    expect(rt.musicOmega.replay.song).toBeNull()
  })
})

describe('Music (Omega): Starstop', () => {
  it('clears the player and silences the voices', () => {
    const rt = run(`${LOAD}Starset Start(5), : Starplay 0,0,0,1 : Starstop`)
    expect(rt.musicOmega.active).toBe(false)
    expect(rt.musicOmega.replay.playing).toBe(false)
  })

  it('checks nothing, so stopping a player that never started is legal', () => {
    // routine 85 takes no argument and tests no flag before clearing the four
    // volumes and the audio DMA --- techno.amos:69 calls it before Starset
    const rt = run('Starstop')
    expect(rt.musicOmega.active).toBe(false)
  })
})
