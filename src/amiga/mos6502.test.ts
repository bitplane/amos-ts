/**
 * The 6502, against somebody else's test rather than against my reading.
 *
 * Every other replayer in this directory is checked by replaying a module and
 * looking at what comes out, because a format has no other oracle. A
 * processor does: Klaus Dormann's `6502_functional_test` is 30.6 million
 * instructions that check each documented opcode, each addressing mode, both
 * halves of decimal mode and the flag each one leaves behind, and it traps to
 * a known address when it is finished. That is a far better witness than any
 * test I would write for my own code, so it goes first and the hand-written
 * ones below only cover what it does not reach.
 *
 * The image is `fixtures/6502/6502_functional_test.bin`, sha256
 * fa12bfc761e6f9057e4cc01a665a7b800ff01ae91f598af1e39a1201d01953fd, from
 * Klaus2m5/6502_65C02_functional_tests. `fixtures/` is gitignored, so the
 * suite skips rather than fails where it is absent, and nothing third-party
 * is redistributed.
 *
 * ## What it does not reach
 *
 * The functional test is documented opcodes only. The undocumented ones
 * matter here because `PlaySID.doc:427` claims them ("Emulation of
 * undocumented 6502 instructions", V3.0), so a tune is entitled to use them,
 * and those get unit tests below. So does the calling convention, which is
 * playsid's rather than the processor's.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { describeIf } from '../testing/fixture'
import { FLAG_C, FLAG_D, FLAG_N, FLAG_V, FLAG_Z, Mos6502, RamBus } from './mos6502'

const IMAGE = join(process.cwd(), 'fixtures', '6502', '6502_functional_test.bin')

/**
 * Where the test traps when it passes. Reaching any OTHER self-branch is the
 * test reporting a failure, and the address says which one, so the assertion
 * below prints it rather than a bare boolean.
 */
const SUCCESS = 0x3469

describeIf('Klaus Dormann\'s 6502 functional test', existsSync(IMAGE), () => {
  it('runs to the success trap at $3469', () => {
    const bus = new RamBus()
    bus.ram.set(readFileSync(IMAGE), 0)
    const cpu = new Mos6502(bus)
    cpu.reset()
    cpu.pc = 0x0400

    let trap = -1
    for (let n = 0; n < 100_000_000; n++) {
      const before = cpu.pc
      cpu.step()
      if (cpu.jammed || cpu.pc === before) {
        trap = before
        break
      }
    }
    expect(`$${trap.toString(16)}`).toBe(`$${SUCCESS.toString(16)}`)
  }, 60_000)
})

function cpuWith(bytes: number[], at = 0x1000): Mos6502 {
  const bus = new RamBus()
  bus.ram.set(Uint8Array.from(bytes), at)
  const cpu = new Mos6502(bus)
  cpu.reset()
  cpu.pc = at
  return cpu
}

it('LAX ($AF) loads A and X from one read', () => {
  const cpu = cpuWith([0xaf, 0x00, 0x20])
  cpu.bus.write(0x2000, 0x37)
  cpu.step()
  expect(cpu.a).toBe(0x37)
  expect(cpu.x).toBe(0x37)
})

it('SAX ($8F) stores A AND X and touches no flag', () => {
  const cpu = cpuWith([0x8f, 0x00, 0x20])
  cpu.a = 0xf0
  cpu.x = 0x3c
  const before = cpu.p
  cpu.step()
  expect(cpu.bus.read(0x2000)).toBe(0x30)
  expect(cpu.p).toBe(before)
})

it('SLO ($0F) shifts memory left and ORs the result into A', () => {
  const cpu = cpuWith([0x0f, 0x00, 0x20])
  cpu.a = 0x01
  cpu.bus.write(0x2000, 0x81)
  cpu.step()
  expect(cpu.bus.read(0x2000)).toBe(0x02)
  expect(cpu.a).toBe(0x03)
  expect(cpu.p & FLAG_C).toBe(FLAG_C)
})

it('DCP ($CF) decrements memory and compares it against A', () => {
  const cpu = cpuWith([0xcf, 0x00, 0x20])
  cpu.a = 0x40
  cpu.bus.write(0x2000, 0x41)
  cpu.step()
  expect(cpu.bus.read(0x2000)).toBe(0x40)
  expect(cpu.p & FLAG_Z).toBe(FLAG_Z)
  expect(cpu.p & FLAG_C).toBe(FLAG_C)
})

it('ISC ($EF) increments memory and subtracts it from A', () => {
  const cpu = cpuWith([0xef, 0x00, 0x20])
  cpu.a = 0x10
  cpu.p |= FLAG_C
  cpu.bus.write(0x2000, 0x04)
  cpu.step()
  expect(cpu.bus.read(0x2000)).toBe(0x05)
  expect(cpu.a).toBe(0x0b)
})

it('ANC ($0B) copies bit 7 of the result into carry', () => {
  const cpu = cpuWith([0x0b, 0xff])
  cpu.a = 0x80
  cpu.step()
  expect(cpu.a).toBe(0x80)
  expect(cpu.p & FLAG_C).toBe(FLAG_C)
  expect(cpu.p & FLAG_N).toBe(FLAG_N)
})

it('ALR ($4B) ANDs then shifts right', () => {
  const cpu = cpuWith([0x4b, 0x0f])
  cpu.a = 0xff
  cpu.step()
  expect(cpu.a).toBe(0x07)
  expect(cpu.p & FLAG_C).toBe(FLAG_C)
})

it('SBX ($CB) puts (A AND X) minus the operand in X', () => {
  const cpu = cpuWith([0xcb, 0x10])
  cpu.a = 0xff
  cpu.x = 0x3f
  cpu.step()
  expect(cpu.x).toBe(0x2f)
  expect(cpu.p & FLAG_C).toBe(FLAG_C)
})

it('SHX ($9E) ANDs the stored value with the high address byte plus one', () => {
  const cpu = cpuWith([0x9e, 0x00, 0x20])
  cpu.x = 0xff
  cpu.y = 0x10
  cpu.step()
  expect(cpu.bus.read(0x2010)).toBe(0x21)
})

it('the twelve JAM opcodes stop the processor where they stand', () => {
  for (const op of [0x02, 0x12, 0x22, 0x32, 0x42, 0x52, 0x62, 0x72, 0x92, 0xb2, 0xd2, 0xf2]) {
    const cpu = cpuWith([op])
    cpu.step()
    expect(cpu.jammed).toBe(true)
    expect(cpu.pc).toBe(0x1000)
  }
})

it('JMP ($xxFF) reads its high byte from the start of the same page', () => {
  const bus = new RamBus()
  bus.ram[0x10ff] = 0x34
  bus.ram[0x1000] = 0x12
  bus.ram[0x1100] = 0xcd
  bus.ram.set(Uint8Array.from([0x6c, 0xff, 0x10]), 0x2000)
  const cpu = new Mos6502(bus)
  cpu.reset()
  cpu.pc = 0x2000
  cpu.step()
  expect(cpu.pc).toBe(0x1234)
})

it('decimal ADC carries out of the tens digit', () => {
  const cpu = cpuWith([0x69, 0x01])
  cpu.a = 0x99
  cpu.p |= FLAG_D
  cpu.step()
  expect(cpu.a).toBe(0x00)
  expect(cpu.p & FLAG_C).toBe(FLAG_C)
})

it('ADC sets overflow when two positives make a negative', () => {
  const cpu = cpuWith([0x69, 0x01])
  cpu.a = 0x7f
  cpu.step()
  expect(cpu.a).toBe(0x80)
  expect(cpu.p & FLAG_V).toBe(FLAG_V)
})

/**
 * The library's own convention, off `$210700` and `$21075e`: SP starts at $FF
 * and the routine's closing RTS unwinds past the bottom of the stack, which
 * is what returns control to 68k at `$2127b2`.
 */
it('runUntilReturn comes back on the RTS that empties the stack', () => {
  //   $1000  JSR $1010
  //   $1003  RTS          <- this one ends the call
  //   $1010  LDA #$42 / STA $2000 / RTS
  const cpu = cpuWith([0x20, 0x10, 0x10, 0x60])
  cpu.bus.write(0x1010, 0xa9)
  cpu.bus.write(0x1011, 0x42)
  cpu.bus.write(0x1012, 0x8d)
  cpu.bus.write(0x1013, 0x00)
  cpu.bus.write(0x1014, 0x20)
  cpu.bus.write(0x1015, 0x60)
  expect(cpu.runUntilReturn(0x1000)).toBe(true)
  expect(cpu.bus.read(0x2000)).toBe(0x42)
  expect(cpu.sp).toBe(0xff)
})

it('runUntilReturn takes A, X and Y in, the way StartSong passes the song number', () => {
  // STA $2000 / STX $2001 / STY $2002 / RTS
  const cpu = cpuWith([0x8d, 0x00, 0x20, 0x8e, 0x01, 0x20, 0x8c, 0x02, 0x20, 0x60])
  expect(cpu.runUntilReturn(0x1000, 3, 7, 9)).toBe(true)
  expect([cpu.bus.read(0x2000), cpu.bus.read(0x2001), cpu.bus.read(0x2002)]).toEqual([3, 7, 9])
})

it('runUntilReturn gives up on a routine that never returns', () => {
  // JMP to itself, which no cycle budget escapes.
  const cpu = cpuWith([0x4c, 0x00, 0x10])
  expect(cpu.runUntilReturn(0x1000, 0, 0, 0, 10_000)).toBe(false)
})

it('runUntilReturn survives an RTS reached by pushing an address', () => {
  // The RTS trick: push $1FFF, RTS, and land at $2000. Counting JSRs would
  // have gone negative here and stopped on the wrong instruction.
  //   LDA #$1f / PHA / LDA #$ff / PHA / RTS
  const cpu = cpuWith([0xa9, 0x1f, 0x48, 0xa9, 0xff, 0x48, 0x60])
  cpu.bus.write(0x2000, 0xa9)
  cpu.bus.write(0x2001, 0x5a)
  cpu.bus.write(0x2002, 0x8d)
  cpu.bus.write(0x2003, 0x00)
  cpu.bus.write(0x2004, 0x30)
  cpu.bus.write(0x2005, 0x60)
  expect(cpu.runUntilReturn(0x1000)).toBe(true)
  expect(cpu.bus.read(0x3000)).toBe(0x5a)
})
