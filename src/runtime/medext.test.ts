import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { mustFinish } from '../testing/run'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/source'
import { extensionById } from '../ext/registry'
import { NullAudio } from '../amiga/paula'
import { Runtime } from './runtime'
import { MED_ERRORS } from './medext'

const table = new TokenTable(CORE_TOKENS)
/**
 * Slot 19, off the binary: routine 0's `move.l a3,$218(a5)` puts the data
 * pointer in the slot entry at `$f8 + 18*16`, and the routine then returns
 * `moveq #$12,d0` — the same 18, zero-based.
 */
const med = extensionById('med-7.1')!

/** the module the AMOS Pro examples ship, a real 51,108-byte MMD0 */
const REAL = join(__dirname, '../../fixtures/official-amos/Examples/Music/Med_Module')
const haveReal = existsSync(REAL)

/**
 * A four-byte header is all the five struct readers and the mode dispatch
 * need. It is not a playable module and no test below asks it to play — the
 * shipped MMD0 does that — but `Med Load` accepts it because LoadModule's own
 * test is the identifier, and the readers take fixed offsets the MMD struct
 * fixes: pblock $2a, pline $2c, pseqnum $2e, counter $32, extra_songs $33.
 */
function header(id: string, fields: Record<number, number> = {}): Uint8Array {
  const b = new Uint8Array(0x40)
  for (let i = 0; i < 4; i++) b[i] = id.charCodeAt(i)
  for (const [at, v] of Object.entries(fields)) b[Number(at)] = v
  return b
}

interface Boot {
  rt: Runtime
  audio: NullAudio
  out: () => string
}

function boot(src: string, files: Record<string, Uint8Array> = {}, tweak?: (rt: Runtime) => void): Boot {
  const exts = new Map([[19, med.table]])
  const audio = new NullAudio()
  let printed = ''
  const rt = new Runtime(tokenize(src, table, exts), table, {
    extensions: exts,
    extBindings: new Map([[19, med]]),
    audio,
    maxSteps: 200_000,
    onText: (t) => (printed += t),
    fs: { read: (p: string) => files[p] ?? null },
  })
  tweak?.(rt)
  return { rt, audio, out: () => printed }
}

function run(src: string, files: Record<string, Uint8Array> = {}, tweak?: (rt: Runtime) => void): Boot {
  const b = boot(src, files, tweak)
  const r = b.rt.runHeadless(2000)
  mustFinish(r)
  return b
}

const num = (src: string, files: Record<string, Uint8Array> = {}, tweak?: (rt: Runtime) => void): number =>
  Number(run(src, files, tweak).out().trim())

/** step the vbl, which is where the replayer runs */
function frames(rt: Runtime, n: number): void {
  for (let i = 0; i < n; i++) rt.frame()
}

const MOD0 = { 'x.med': header('MMD0') }

describe('MED 7.1 — the shim over the three player libraries', () => {
  it('routine 0 opens medplayer and leaves the mode at 0 (routine 0, $2aa)', () => {
    const { rt } = boot('')
    expect(rt.medExt.medBase).toBeGreaterThan(0)
    expect(rt.medExt.octaBase).toBeGreaterThan(0)
    expect(rt.medExt.octaMixBase).toBeGreaterThan(0)
    expect(rt.medExt.mode).toBe(0)
    expect(rt.medExt.module).toBeNull()
  })

  it('Med Load takes the module and Med Mod Base its address (routines 5 $672, 23 $bea)', () => {
    const { rt } = run('Med Load "x.med",0\nPrint Med Mod Base', MOD0)
    expect(rt.medExt.module).not.toBeNull()
    expect(rt.medExt.mode).toBe(0)
    expect(rt.medModule).toBe(rt.medExt.module)
    expect(num('Med Load "x.med",0\nPrint Med Mod Base', MOD0)).toBe(Runtime.MED_MODULE_BASE)
  })

  it('Med Mod Base answers 0 with nothing loaded — routine 23 has no module check', () => {
    expect(num('Print Med Mod Base')).toBe(0)
  })

  it('the module is Peekable at Med Mod Base — the Guide’s whole reason for it', () => {
    // "Da zum laden keine AMOS Banken benutzt werden, kann dieser Befehl zum
    // bearbeiten eines MED Moduls sehr nützlich sein"
    expect(num('Med Load "x.med",0\nPrint Peek(Med Mod Base)', MOD0)).toBe('M'.charCodeAt(0))
  })

  it('a second Med Load is error 2, "Player reserviert" ($67c)', () => {
    expect(() => run('Med Load "x.med",0\nMed Load "x.med",0', MOD0)).toThrow(MED_ERRORS[2])
  })

  it('a mode outside 0..2 is error 7, "Mode Nummer nicht gültig" ($6ba)', () => {
    expect(() => run('Med Load "x.med",3', MOD0)).toThrow(MED_ERRORS[7])
  })

  it('a file LoadModule refuses is error 1, and Med Fast Load reports 8 instead ($6f6, $b86)', () => {
    const junk = { 'j.bin': new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]) }
    expect(() => run('Med Load "j.bin",0', junk)).toThrow(MED_ERRORS[1])
    expect(() => run('Med Fast Load "j.bin",0', junk)).toThrow(MED_ERRORS[8])
    expect(() => run('Med Load "nope.med",0')).toThrow(MED_ERRORS[1])
  })

  it('Med Fast Load is Med Load with a different message (routine 17, $b02)', () => {
    const { rt } = run('Med Fast Load "x.med",0', MOD0)
    expect(rt.medExt.module).not.toBeNull()
    expect(rt.medExt.fastLoaded).toBe(true)
  })

  it('mode 1 and mode 2 load through their installed version-7 libraries', () => {
    expect(run('Med Load "x.med",1', MOD0).rt.medExt.mode).toBe(1)
    const { rt } = run('Med Load "x.med",2', MOD0)
    expect(rt.medExt.mode).toBe(2)
    expect(rt.medExt.module).not.toBeNull()
  })

  it('Med Init Player selects the current library build and carries its controls into it', () => {
    const octa = run('Med Load "x.med",1\nMed Set Hq 1\nMed Init Player 0', MOD0).rt.medExt.player!
    expect(octa.build).toBe('octaplayer')
    expect(octa.hq).toBe(true)
    const mix = run(
      'Med Load "x.med",2\nMed 14bit Mode Off\nMed Set Mixing Freq 28800\nMed Set Mixbuffer 4096\nMed Init Player 0',
      MOD0,
    ).rt.medExt.player!
    expect(mix.build).toBe('octamixplayer')
    expect(mix.omix14Bit).toBe(false)
    expect(mix.omixRequestedRate).toBe(28800)
    expect(mix.omixBuffer).toBe(4096)
  })

  it('mode-specific controls continue to update an installed player', () => {
    const octa = run('Med Load "x.med",1\nMed Init Player 0\nMed Set Hq 1', MOD0).rt.medExt.player!
    expect(octa.hq).toBe(true)
    const mix = run(
      'Med Load "x.med",2\nMed Init Player 0\nMed 14bit Mode Off\nMed Set Mixing Freq 22000\nMed Set Mixbuffer 2048',
      MOD0,
    ).rt.medExt.player!
    expect(mix.omix14Bit).toBe(false)
    expect(mix.omixRequestedRate).toBe(22000)
    expect(mix.omixBuffer).toBe(2048)
  })
})

describe('MED 7.1 — the fourteen keywords that need a module', () => {
  const needy = [
    'Med Play',
    'Med Stop',
    'Med Continue',
    'Med Init Player 0',
    'Med Free Player',
    'Med Unload',
    'Med Set Tempo 100',
    'Med Set Mod Nr 1',
    'Med Reset Midi',
    'Med Reloc',
    'Print Med Pointer',
    'Print Med Is Fastplaying',
  ]

  for (const src of needy) {
    it(`${src} with nothing loaded is error 3, "Kein MED Modul geladen"`, () => {
      expect(() => run(src)).toThrow(MED_ERRORS[3])
    })
  }

  it('Med Set Hq and the fastplay/mix family do NOT check, matching their routines', () => {
    // routines 16, 25-32 open on the argument or on routine 37, never on $3f2
    expect(() => run('Med Set Hq 1')).not.toThrow()
    expect(() => run('Med Fastplay On')).not.toThrow()
    expect(() => run('Med Fastplay Off')).not.toThrow()
    expect(() => run('Med 14bit Mode On')).not.toThrow()
    expect(() => run('Med 14bit Mode Off')).not.toThrow()
    expect(() => run('Med Set Mixing Freq 28800')).not.toThrow()
    expect(() => run('Med Set Mixbuffer 2048')).not.toThrow()
  })
})

describe('MED 7.1 — the player lifecycle', () => {
  it('Med Init Player takes the MIDI flag and installs the player (routine 7, $73c)', () => {
    const { rt } = run('Med Load "x.med",0\nMed Init Player 1', MOD0)
    expect(rt.medExt.midi).toBe(true)
    expect(rt.medExt.player).not.toBeNull()
    expect(run('Med Load "x.med",0\nMed Init Player 0', MOD0).rt.medExt.midi).toBe(false)
  })

  it('Med Free Player stops and removes it (routine 8, $7b8)', () => {
    const { rt } = run('Med Load "x.med",0\nMed Init Player 0\nMed Free Player', MOD0)
    expect(rt.medExt.player).toBeNull()
    // "Dieser Befehl STOPT und entfernt die MED Player Routine"
    expect(rt.medExt.module).not.toBeNull()
  })

  it('Med Unload runs Med Stop and Med Free Player, then clears $3f2 (routine 11, $8d6)', () => {
    const { rt } = run('Med Load "x.med",0\nMed Init Player 0\nMed Unload\nPrint Med Mod Base', MOD0)
    expect(rt.medExt.module).toBeNull()
    expect(rt.medModule).toBeNull()
    expect(rt.medExt.player).toBeNull()
    // and the module can be loaded again, because $3f2 is what error 2 tests
    expect(() => run('Med Load "x.med",0\nMed Unload\nMed Load "x.med",0', MOD0)).not.toThrow()
  })

  it('the DEFAULT hook at $312 stops the player and drops the module', () => {
    // InDefault (+Lib.s:8681) calls every occupied slot's +$4, which routine 0
    // filled with $312 --- so `Default` is the way to reach it from BASIC
    const { rt } = run('Med Load "x.med",0\nMed Init Player 0\nDefault', MOD0)
    expect(rt.medExt.player).toBeNull()
    expect(rt.medExt.module).toBeNull()
  })

  it('Med Set Tempo reaches the replayer (routine 10, $8a6)', () => {
    const { rt } = run('Med Load "x.med",0\nMed Init Player 0\nMed Set Tempo 240', MOD0)
    expect(rt.medExt.player).not.toBeNull()
  })

  it('Med Set Mod Nr stores the sub-song, and every Load puts it back to 0 (routine 13, $990)', () => {
    const { rt } = run('Med Load "x.med",0\nMed Set Mod Nr 3', MOD0)
    expect(rt.medExt.modNr).toBe(3)
    const again = run('Med Load "x.med",0\nMed Set Mod Nr 3\nMed Unload\nMed Load "x.med",0', MOD0)
    expect(again.rt.medExt.modNr).toBe(0)
  })

  it('Med Reset Midi and Med Reloc need a module and otherwise pass (routines 12 $962, 14 $a06)', () => {
    expect(() => run('Med Load "x.med",0\nMed Reset Midi\nMed Reloc', MOD0)).not.toThrow()
  })
})

describe('MED 7.1 — the settings, and the modes that gate them', () => {
  it('Med Set Hq is MODE 1 ONLY — routine 16 has one cmpi against $3f6', () => {
    expect(run('Med Set Hq 1', MOD0).rt.medExt.hq).toBe(0)
    const inMode1 = run('Med Set Hq 1', MOD0, (r) => {
      r.medExt.octaBase = 0x7f21_0000
      r.medExt.mode = 1
    })
    expect(inMode1.rt.medExt.hq).toBe(1)
  })

  it('Med Fastplay On/Off default the buffer to 64 and take one when given (routines 25-28)', () => {
    // routine 25 loads `move.l #$40,d1`; routine 26 pops the buffer instead
    const on = run('Med Fastplay On', MOD0)
    expect(on.rt.medExt.fastPlay).toBe(true)
    expect(on.rt.medExt.fastBuffer).toBe(0x40)
    const sized = run('Med Fastplay On 128', MOD0)
    expect(sized.rt.medExt.fastBuffer).toBe(128)
    const off = run('Med Fastplay On\nMed Fastplay Off', MOD0)
    expect(off.rt.medExt.fastPlay).toBe(false)
    // mode 2 falls straight to the exit and changes nothing
    const inMode2 = run('Med Fastplay On', MOD0, (r) => {
      r.medExt.octaMixBase = 0x7f20_0000
      r.medExt.mode = 2
    })
    expect(inMode2.rt.medExt.fastPlay).toBe(false)
  })

  it('14bit mode, mixing frequency and mixbuffer are MODE 2 ONLY (routines 29-32)', () => {
    const mode2 = (r: Runtime): void => {
      r.medExt.octaMixBase = 0x7f20_0000
      r.medExt.mode = 2
    }
    // the Guide's defaults, which the shim itself never writes
    const boot0 = boot('').rt.medExt
    expect(boot0.bit14).toBe(true)
    expect(boot0.mixFreq).toBe(15000)
    expect(boot0.mixBuffer).toBe(1024)
    // mode 0: nothing moves
    const m0 = run('Med 14bit Mode Off\nMed Set Mixing Freq 28800\nMed Set Mixbuffer 4096', MOD0)
    expect(m0.rt.medExt.bit14).toBe(true)
    expect(m0.rt.medExt.mixFreq).toBe(15000)
    expect(m0.rt.medExt.mixBuffer).toBe(1024)
    // mode 2: all three land
    const m2 = run('Med 14bit Mode Off\nMed Set Mixing Freq 28800\nMed Set Mixbuffer 4096', MOD0, mode2)
    expect(m2.rt.medExt.bit14).toBe(false)
    expect(m2.rt.medExt.mixFreq).toBe(28800)
    expect(m2.rt.medExt.mixBuffer).toBe(4096)
    expect(run('Med 14bit Mode On', MOD0, mode2).rt.medExt.bit14).toBe(true)
  })
})

describe('MED 7.1 — the functions', () => {
  it('=Med Get Player names the library a file needs (routine 15, $a80)', () => {
    const files = {
      'a.med': header('MMD0'),
      'b.med': header('MMD1'),
      'c.med': header('MMD2'),
      'd.med': header('MMD3'),
      'e.bin': new Uint8Array(8),
    }
    expect(num('Print Med Get Player("a.med")', files)).toBe(0)
    expect(num('Print Med Get Player("b.med")', files)).toBe(0)
    expect(num('Print Med Get Player("c.med")', files)).toBe(1)
    expect(num('Print Med Get Player("d.med")', files)).toBe(2)
    // routine 15 has no failure path at all
    expect(num('Print Med Get Player("e.bin")', files)).toBe(0)
    // and it touches neither $3f2 nor $3f6, so it is safe mid-song
    const { rt } = run('Med Load "a.med",0\nPrint Med Get Player("c.med")', files)
    expect(rt.medExt.mode).toBe(0)
    expect(rt.medExt.module).not.toBeNull()
  })

  it('=Med Pointer answers Med Mod Base (routine 6, $70a)', () => {
    // DEVIATION: the Guide says the library's version is sometimes wrong,
    // which is why Med Mod Base exists; there is no library here to be wrong
    expect(num('Med Load "x.med",0\nPrint Med Pointer', MOD0)).toBe(Runtime.MED_MODULE_BASE)
  })

  it('=Med Get Sub Songs reads extra_songs at $33 (routine 18, $b9a)', () => {
    const files = { 'x.med': header('MMD0', { 0x33: 3 }) }
    expect(num('Med Load "x.med",0\nPrint Med Get Sub Songs', files)).toBe(3)
    expect(num('Med Load "x.med",0\nPrint Med Get Sub Songs', MOD0)).toBe(0)
  })

  it('the four live readers take $2a/$2c/$2e/$32 (routines 19-22)', () => {
    const files = { 'x.med': header('MMD0', { 0x2a: 0, 0x2b: 7, 0x2d: 5, 0x2f: 2, 0x32: 4 }) }
    const src = 'Med Load "x.med",0\nPrint Med Pblock;",";Med Pline;",";Med Seq Num;",";Med Counter'
    // AMOS prints a leading space for a non-negative number
    expect(run(src, files).out().replace(/\s+/g, '')).toBe('7,5,2,4')
  })

  it('the five readers have NO module check — routines 18-23 open on a bare movea.l', () => {
    expect(num('Print Med Get Sub Songs')).toBe(0)
    expect(num('Print Med Pblock')).toBe(0)
    expect(num('Print Med Pline')).toBe(0)
    expect(num('Print Med Seq Num')).toBe(0)
    expect(num('Print Med Counter')).toBe(0)
  })

  it('=Med Is Fastplaying is a constant -1 in mode 2 (routine 24, $c34)', () => {
    // "Merkwürdiger Weise funktioniert das nur bei MED Modulen die mit dem
    // octamixplayer.library gespielt werden" --- because it never asks
    expect(num('Med Load "x.med",0\nPrint Med Is Fastplaying', MOD0)).toBe(0)
    expect(num('Med Load "x.med",0\nMed Fastplay On\nPrint Med Is Fastplaying', MOD0)).toBe(-1)
    const inMode2 = num('Med Load "x.med",2\nPrint Med Is Fastplaying', MOD0, (r) => {
      r.medExt.octaMixBase = 0x7f20_0000
    })
    expect(inMode2).toBe(-1)
  })
})

describe.skipIf(!haveReal)('MED 7.1 — replay, on the shipped MMD0', () => {
  const files = (): Record<string, Uint8Array> => ({ 'real.med': new Uint8Array(readFileSync(REAL)) })

  it('Med Play drives the four-channel replayer (routines 7 $73c, 3 $584)', () => {
    const { rt, audio } = boot('Med Load "real.med",0\nMed Init Player 0\nMed Play\nWait 500', files())
    rt.runHeadless(50)
    frames(rt, 400)
    expect(rt.medExt.player!.on).toBe(true)
    expect(audio.events.filter((e) => e.kind === 'play').length).toBeGreaterThan(2)
  })

  it('Med Stop silences and Med Continue resumes (routines 4 $5fe, 9 $82c)', () => {
    const { rt } = boot('Med Load "real.med",0\nMed Init Player 0\nMed Play\nWait 200\nMed Stop', files())
    rt.runHeadless(50)
    frames(rt, 300)
    expect(rt.medExt.player!.on).toBe(false)
    const cont = boot(
      'Med Load "real.med",0\nMed Init Player 0\nMed Play\nWait 100\nMed Stop\nMed Continue',
      files(),
    )
    cont.rt.runHeadless(50)
    frames(cont.rt, 300)
    expect(cont.rt.medExt.player!.on).toBe(true)
  })

  it('Med Pblock/Pline/Seq Num/Counter follow the replayer once it is running', () => {
    const { rt } = boot('Med Load "real.med",0\nMed Init Player 0\nMed Play\nWait 500', files())
    rt.runHeadless(50)
    frames(rt, 200)
    const p = rt.medExt.player!
    expect(p.hdrPline).toBeGreaterThanOrEqual(0)
    expect(p.hdrPseqnum).toBeGreaterThanOrEqual(0)
    expect(p.hdrCounter).toBeGreaterThanOrEqual(0)
    expect(p.extraSongs).toBe(0)
  })

  it('Med Unload stops replay dead — the pointer is what MedCheck tests', () => {
    const { rt, audio } = boot(
      'Med Load "real.med",0\nMed Init Player 0\nMed Play\nWait 200\nMed Unload',
      files(),
    )
    rt.runHeadless(50)
    frames(rt, 300)
    expect(rt.medExt.module).toBeNull()
    const after = audio.events.length
    frames(rt, 100)
    expect(audio.events.length).toBe(after)
  })
})
