/**
 * MusiCRAFT 1.0, against `AMOSPro_MusiCRAFT.Lib` disassembled with
 * `extdis musicraft-1.0`, and against the nine `St *` topics in CRAFT's own
 * help file — which documents nine of the eleven keywords and knows nothing
 * about the other two.
 *
 * Where the AMOS 1.3 build differs it is named in musicraft.ts; the addresses
 * cited here are the AMOS Pro one's, which is the build the manifest points at.
 */
import { describe, expect, it } from 'vitest'
import { mustFinish } from '../testing/run'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/tokenizer'
import { extensionById } from '../ext/registry'
import { AmigaFS } from '../amiga/vfs'
import { MUSICRAFT_ERRORS } from './musicraft'
import { Runtime } from './runtime'

const table = new TokenTable(CORE_TOKENS)
/** `move.l a4,$218(a5)` in routine 0, and `$f8 + 18*16` is $218 */
const MC_SLOT = 19
const mc = extensionById('musicraft-1.0')!
const extensions = new Map([[MC_SLOT, mc.table]])

interface Boot {
  rt: Runtime
  out: () => string
}

/**
 * A four-pattern M.K. module with one 64-byte sample.
 *
 * Every pattern's row 0 plays instrument 1 on channel 0 and sets the speed on
 * channel 1, so a position change is one row and the volume the vumeter picks
 * up is the sample header's.
 */
function modFile(speed = 1, volume = 40): Uint8Array {
  const PATTERNS = 4
  const d = new Uint8Array(1084 + PATTERNS * 1024 + 64)
  const dv = new DataView(d.buffer)
  dv.setUint16(20 + 22, 32) // sample 1: 64 bytes
  d[20 + 25] = volume
  dv.setUint16(20 + 28, 1) // the conventional one-word repeat
  d[950] = PATTERNS
  for (let p = 0; p < PATTERNS; p++) d[952 + p] = p
  d.set([0x4d, 0x2e, 0x4b, 0x2e], 1080) // "M.K."
  const cell = (p: number, row: number, ch: number, cmd: number, info: number): void => {
    const at = 1084 + p * 1024 + row * 16 + ch * 4
    d[at] = 0x1ac >> 8
    d[at + 1] = 0x1ac & 0xff
    d[at + 2] = 0x10 | (cmd & 0xf) // instrument 1
    d[at + 3] = info & 0xff
  }
  for (let p = 0; p < PATTERNS; p++) {
    cell(p, 0, 1, 0xf, speed)
    cell(p, 0, 0, 0, 0)
  }
  return d
}

function boot(src: string, data: Uint8Array | null = modFile()): Boot {
  const fs = new AmigaFS()
  fs.mountMemory('RAM')
  if (data) fs.writeFile('RAM:tune.mod', data)
  let printed = ''
  const rt = new Runtime(tokenize(src, table, extensions), table, {
    extensions,
    extBindings: new Map([[MC_SLOT, mc]]),
    maxSteps: 200_000,
    onText: (t) => (printed += t),
    fs,
  })
  return { rt, out: () => printed }
}

function run(src: string, data: Uint8Array | null = modFile()): Boot {
  const b = boot(src, data)
  mustFinish(b.rt.runHeadless(2_000))
  return b
}

const num = (src: string): number => Number(run(src).out().trim())

const LOAD = 'St Load "RAM:tune.mod",5 : '

/** step vertical blanks until the song position changes; answer the new one */
function untilPos(rt: Runtime, limit = 400): number {
  const from = rt.musicraft.replay.pos
  for (let i = 0; i < limit; i++) {
    rt.frame()
    if (rt.musicraft.replay.pos !== from) return rt.musicraft.replay.pos
  }
  return from
}

describe('MusiCRAFT: St Load', () => {
  it('reserves a chip data bank called "Tracker ", four bytes longer than the file', () => {
    // the four are not slack: mt_init's sample walk writes `clr.l (a2)` at the
    // head of each of 31 samples and the last lands past the module
    const b = run(`${LOAD}Print Length(5)`)
    const bank = b.rt.memBanks.get(5)!
    expect(bank.name).toBe('Tracker ')
    expect(bank.memType).toBe(1) // Bnk_BitChip
    expect(bank.data.length).toBe(modFile().length + 4)
  })

  it('refuses a bank that already exists rather than erasing it', () => {
    // `Rjsr L_Bnk_GetAdr / bne` at $13d4 --- error 35, not a replacement
    expect(() => run(`Reserve As Work 5,100 : ${LOAD}`)).toThrow('Bank already reserved')
  })

  it('bank zero and bank 65536 are both illegal function call', () => {
    // `tst.w (a3) / Rbne` is the high word; `move.l (a3)+,d0 / Rbeq` is zero
    expect(() => run('St Load "RAM:tune.mod",0')).toThrow('Illegal function call')
    expect(() => run('St Load "RAM:tune.mod",65536')).toThrow('Illegal function call')
    expect(() => run('St Load "RAM:tune.mod",65535 : Print Length(65535)')).not.toThrow()
  })

  it('an empty filename is illegal function call', () => {
    // `move.w (a0)+,d0 / Rbeq` --- the length word in front of an AMOS string
    expect(() => run('St Load "",5')).toThrow('Illegal function call')
  })

  it('a file that will not open is error 81', () => {
    // `moveq #$51,d0` at $1476 -- AMOS's "File not found"
    expect(() => run('St Load "RAM:nothing.mod",5', null)).toThrow('File not found')
  })
})

describe('MusiCRAFT: St Play', () => {
  it('plays, walks its positions and wraps for ever', () => {
    // there is no times-to-play: mt_NextPosition at $724 is
    // `addq.b #1 / andi.b #$7f / cmp.b 950(a0),d1 / bcs / moveq #0,d1`
    const b = run(`${LOAD}St Play 5`)
    expect(b.rt.musicraft.replay.playing).toBe(true)
    expect(b.rt.musicraft.installed).toBe(true)
    expect(untilPos(b.rt)).toBe(1)
    expect(untilPos(b.rt)).toBe(2)
    for (let i = 0; i < 8; i++) untilPos(b.rt)
    expect(b.rt.musicraft.installed).toBe(true)
  })

  it('the first vertical blank plays a row rather than waiting six for it', () => {
    // `moveq #6,d0 / move.b d0,$5d2(a2) / move.b d0,$5d3(a2)` at $35c: the
    // counter starts AT the speed, so the very first tick wraps it
    const b = run(`${LOAD}St Play 5`)
    expect(b.rt.musicraft.replay.counter).toBe(6)
    b.rt.frame()
    expect(b.rt.musicraft.replay.counter).toBe(0)
    expect(b.rt.musicraft.replay.channels[0]!.instrument).toBe(1)
  })

  it('a bank that is not one of its own is "Not a tracker bank"', () => {
    // `cmpi.l #"Trac",(a0)+ / cmpi.l #"ker ",(a0)+` --- the eight bytes in
    // front of a bank's data are its name, and there is no address back door
    expect(() => run('Reserve As Work 5,2000 : St Play 5')).toThrow(MUSICRAFT_ERRORS[0])
  })

  it('a bank that does not exist is error 36', () => {
    expect(() => run('St Play 5')).toThrow('Bank not reserved')
  })

  it('a start position over 127 is illegal function call, and 127 is not', () => {
    // `moveq #$7f,d0 / cmp.l d0,d7 / Rbhi` and nothing else --- the position
    // is never checked against the song length
    expect(() => run(`${LOAD}St Play 5,128`)).toThrow('Illegal function call')
    expect(() => run(`${LOAD}St Play 5,127`)).not.toThrow()
  })

  it('a start position the song has is where it starts', () => {
    const b = run(`${LOAD}St Play 5,2`)
    expect(b.rt.musicraft.replay.pos).toBe(2)
    expect(untilPos(b.rt)).toBe(3)
    expect(untilPos(b.rt)).toBe(0)
  })

  it('there is no CIA tempo: F80 is a speed of 128', () => {
    // routine 0's Fxx arm at $b66 is `move.b 3(a6),d0 / beq / sf.b mt_counter
    // / move.b d0,mt_speed / rts` for every value
    const b = run(`${LOAD}St Play 5`, modFile(0x80))
    b.rt.frame()
    expect(b.rt.musicraft.replay.speed).toBe(0x80)
    expect(b.rt.musicraft.replay.ciaTempo).toBe(false)
    expect(b.rt.musicraft.replay.bpm).toBe(125)
  })

  it('a second St Play re-inits without a second server', () => {
    const b = run(`${LOAD}St Play 5,2 : St Voice 1 : St Play 5`)
    expect(b.rt.musicraft.replay.pos).toBe(0)
    // `move.w #$f,$5e0(a2)` at $36c --- mt_init writes the mask back
    expect(b.rt.musicraft.mask).toBe(0b1111)
  })
})

describe('MusiCRAFT: stopping and pausing', () => {
  it('St Stop with nothing playing does nothing at all', () => {
    // `move.w $1de(pc),d0 / beq .out` is the first thing routine $1fa does
    const b = run('St Stop')
    expect(b.rt.musicraft.installed).toBe(false)
    expect(b.rt.musicraft.mask).toBe(0)
  })

  it('St Stop takes the server out and clears the voice mask', () => {
    const b = run(`${LOAD}St Play 5 : St Stop`)
    expect(b.rt.musicraft.installed).toBe(false)
    expect(b.rt.musicraft.running).toBe(false)
    expect(b.rt.musicraft.mask).toBe(0)
    const pos = b.rt.musicraft.replay.pos
    for (let i = 0; i < 50; i++) b.rt.frame()
    expect(b.rt.musicraft.replay.pos).toBe(pos)
  })

  it('St Pause On stops the tick and St Pause Off starts it again', () => {
    const b = run(`${LOAD}St Play 5 : St Pause On`)
    expect(b.rt.musicraft.running).toBe(false)
    const pos = b.rt.musicraft.replay.pos
    for (let i = 0; i < 100; i++) b.rt.frame()
    expect(b.rt.musicraft.replay.pos).toBe(pos)
    const c = run(`${LOAD}St Play 5 : St Pause On : St Pause Off`)
    expect(c.rt.musicraft.running).toBe(true)
    expect(untilPos(c.rt)).toBe(1)
  })

  it('Default stops a song, because DEFAULT and REMOVE are the same routine', () => {
    // routine 0 writes $1fa into both $21c and $220
    const b = run(`${LOAD}St Play 5 : Default`)
    expect(b.rt.musicraft.installed).toBe(false)
  })
})

describe('MusiCRAFT: the voices', () => {
  it('St Voice masks four bits and checks nothing', () => {
    // `andi.w #$f,d0` at $234 is the whole of it
    expect(num(`${LOAD}St Play 5 : St Voice 5 : Print St Channel(0)`)).toBe(-1)
    expect(num(`${LOAD}St Play 5 : St Voice 5 : Print St Channel(1)`)).toBe(0)
    expect(num(`${LOAD}St Play 5 : St Voice -1 : Print St Channel(3)`)).toBe(-1)
    expect(num(`${LOAD}St Play 5 : St Voice 16 : Print St Channel(0)`)).toBe(0)
  })

  it('the mask reaches the replay, so a masked voice takes no notes', () => {
    const b = run(`${LOAD}St Play 5 : St Voice 2`)
    expect(b.rt.musicraft.replay.voices).toBe(0b0010)
  })

  it('St Voice before St Play is set for nobody', () => {
    // mt_init writes $f over the word at $13bc and the DMA bit back into every
    // channel's $2a, so the order that reads naturally is the one that fails
    const b = run(`${LOAD}St Voice 1 : St Play 5`)
    expect(b.rt.musicraft.mask).toBe(0b1111)
  })

  it('=St Channel starts at zero and answers 0 to 3 only', () => {
    // `moveq #4,d1 / cmp.l d1,d0 / Rbcc` --- unsigned
    expect(num('Print St Channel(0)')).toBe(0)
    expect(() => run('Print St Channel(4)')).toThrow('Illegal function call')
    expect(() => run('Print St Channel(-1)')).toThrow('Illegal function call')
  })
})

describe('MusiCRAFT: the vumeters', () => {
  it('St Vumeter Speed takes 0 to 64 and nothing else', () => {
    // `moveq #$40,d1 / cmp.l d1,d0 / Rbhi`
    expect(() => run('St Vumeter Speed 64')).not.toThrow()
    expect(() => run('St Vumeter Speed 65')).toThrow('Illegal function call')
    expect(() => run('St Vumeter Speed -1')).toThrow('Illegal function call')
  })

  it('with a speed set it owns the meters and decays them every frame', () => {
    // `sub.b d1,(a0)+ / bpl / move.b d0,-1(a0)` in front of the tick, and
    // `move.l $2ee(pc),(a0)` into AMOS's own four bytes behind it
    const b = run(`${LOAD}St Vumeter Speed 8 : St Play 5`)
    b.rt.frame()
    expect(b.rt.musicraft.vu[0]).toBe(40) // the sample header's volume
    expect(b.rt.vuBytes[0]).toBe(40)
    b.rt.frame()
    expect(b.rt.musicraft.vu[0]).toBe(32)
    b.rt.frame()
    expect(b.rt.musicraft.vu[0]).toBe(24)
  })

  it('the decay floors at zero rather than wrapping', () => {
    const b = run(`${LOAD}St Vumeter Speed 64 : St Play 5`)
    b.rt.frame()
    for (let i = 0; i < 4; i++) b.rt.frame()
    expect(b.rt.musicraft.vu[0]).toBe(0)
    expect(b.rt.vuBytes[0]).toBe(0)
  })

  it('the meters keep falling while the module is paused', () => {
    // the decay pass at $278 is in FRONT of the tick, and the pause word is
    // tested inside the tick at $3c8
    const b = run(`${LOAD}St Vumeter Speed 8 : St Play 5 : Wait Vbl : St Pause On`)
    expect(b.rt.musicraft.vu[0]).toBe(40)
    b.rt.frame()
    expect(b.rt.musicraft.vu[0]).toBe(32)
    expect(b.rt.vuBytes[0]).toBe(32)
  })

  it('a speed of zero leaves =Vumeter to AMOS except where a note just landed', () => {
    // *"If the speed is set to zero, the function =Vumeter works normally"* ---
    // `move.l d0,(a0)` clears its own four first and only non-zero ones are
    // copied out, so a channel with no note keeps whatever AMOS put there
    const b = run(`${LOAD}St Vumeter Speed 0 : St Play 5`)
    b.rt.vuBytes[2] = 55
    b.rt.frame()
    expect(b.rt.vuBytes[0]).toBe(40) // channel 0 triggered
    expect(b.rt.vuBytes[2]).toBe(55) // channel 2 did not, and AMOS's stands
  })

  it('nothing decays once the server is gone', () => {
    const b = run(`${LOAD}St Vumeter Speed 8 : St Play 5 : Wait Vbl : St Stop`)
    expect(b.rt.musicraft.vu[0]).toBe(40)
    for (let i = 0; i < 10; i++) b.rt.frame()
    expect(b.rt.musicraft.vu[0]).toBe(40)
  })
})

describe('MusiCRAFT: the constants and the data zone', () => {
  it('=St Version is 100 in both builds', () => {
    // *"multiplied with 100 (1.00=100)"*, and `moveq #$64,d3` says so
    expect(num('Print St Version')).toBe(100)
  })

  it('the volume pair is a stub: St Volume takes nothing and the reading is 64', () => {
    // DEFECT: the token table spec is `I`, no parameters, and routine 12 is
    // `move.l (a3)+,d0 / rts` --- it pops one anyway. Routine 13 is four
    // bytes of `moveq #$40,d3`, so there is no volume in the extension at all
    expect(num('Print St Get Volume')).toBe(64)
    expect(num('St Volume : Print St Get Volume')).toBe(64)
    expect(() => run('St Volume 20')).toThrow()
  })

  it('=St Base answers an address a program can read the channels through', () => {
    // `move.l $218(a5),d3 / addi.l #$496,d3` --- the first of four structures
    // at a stride of $2e
    const b = run(`${LOAD}St Play 5 : A=St Base : Print A`)
    const base = Number(b.out().trim())
    expect(base).toBeGreaterThan(0)
    b.rt.frame()
    const m = b.rt.resolveAddr(base + 0x10)! // n_period
    const period = ((m.data[m.off] ?? 0) << 8) | (m.data[m.off + 1] ?? 0)
    expect(period).toBe(0x1ac)
    // n_volume, and the extension's own enable word four bytes past the end
    // of ProTracker's 42
    const v = b.rt.resolveAddr(base + 0x13)!
    expect(v.data[v.off]).toBe(40)
    const e = b.rt.resolveAddr(base + 0x2a)!
    expect(((e.data[e.off] ?? 0) << 8) | (e.data[e.off + 1] ?? 0)).toBe(1)
  })

  it('the address is stable across calls', () => {
    expect(num('Print St Base-St Base')).toBe(0)
  })
})
