/**
 * The MOS 6502, as `playsid.library` runs one.
 *
 * A PSID file is not a music format in the sense the rest of this directory
 * uses the word. There is no pattern table to walk and no envelope to step:
 * the file is C64 machine code, and the "replay" is running it. The header
 * names two entry points, `init` and `play`, and a player calls `init` once
 * with the song number in A and then `play` fifty times a second forever.
 * Everything audible is a side effect of that code writing the SID's
 * registers at $D400.
 *
 * So this is the one file here that is a processor rather than a replayer,
 * and it exists because ../runtime/dme.ts's nine `sid *` keywords cannot work
 * without it. `cpu.ts` says of the 68000 that "nothing here executes 68k",
 * and that stays true. A 6502 inside a data file is not the host CPU: it is
 * an interpreter over bytes AMOS loaded into a bank, which is what
 * `runtime/amal.ts` already is for AMAL's own instruction set.
 *
 * ## Evidence
 *
 * `playsid.library` 1.1 (19.06.94), 36,764 bytes over five hunks, loaded at
 * $210000 by `loadHunks`. Per Hakan Sundell and Ron Birk's romtag is at
 * $210004. The archive is `fixtures/aminet/PlaySID3/`, off Aminet's
 * `mus/play/PlaySID3.lha`, and DME 2.0 does not ship it: the guide says
 * *"To keep the full copyright of this format we didn't enclose the
 * playsid.library"*.
 *
 * ## What the library does instead of an interpreter
 *
 * `$2124ce` builds its 6502 at `AllocEmulResource` time. It walks 256 opcodes
 * (`addi.w #$100,d7` until d7 wraps at $2124fc) and assembles a fragment of
 * 68k for each one into the 128KB block at `$152(a6)+$8000`, copying from the
 * template table at `$2142dc` with the per-opcode offsets at `$2140da`. Each
 * opcode gets a 256-byte slot with two entry points, `$0(a4)` and `$7e(a4)`,
 * which is what the two tails at `$21269e` and `$2126b2` dispatch to. The
 * run loop is therefore not a loop at all. `$2127a8` fetches one opcode and
 * does `jsr (a4,d7.w)` with `d7` the opcode times 256, and every generated
 * fragment ends by fetching the next opcode and jumping to it.
 *
 * DEVIATION: this interprets. Generating 68k is how a 7MHz machine ran a 1MHz
 * one and has nothing to do with what the 6502 DOES, so what is ported here
 * is the instruction set and the calling convention, not the threading. The
 * one place the technique shows through is the register bank: `$21277e` tests
 * bit 11 of the flags word and adds $10000 to `a4`, selecting a second copy
 * of all 256 fragments. That is the decimal-mode variant, assembled twice so
 * that ADC and SBC pay nothing for a flag almost no tune sets.
 *
 * ## The calling convention, off `$21274a`
 *
 *     a0 = the 64KB C64 RAM, `$15a(a6)`
 *     a1 = a0 + SP + $101, so the stack lives at $0100 and grows down
 *     a4 = the generated fragments
 *     a6 = a0 + PC
 *     d0..d3 = A, X, Y and the flags
 *     d7 = SP on the way in, and on the way out `a1 - a0 - 1`
 *
 * A call ends when the 6502 executes an RTS with the stack already empty:
 * that fragment does a 68k `rts` and lands back at `$2127b2`, which is where
 * the final PC and SP are recovered. `runUntilReturn` below is that rule.
 *
 * ## Undocumented opcodes
 *
 * All 256 are implemented, because PlaySID's own history list claims them:
 * `PlaySID.doc:427` lists "Emulation of undocumented 6502 instructions" as a
 * V3.0 feature, alongside "Faster emulation of 6502" at :424. A tune that
 * uses LAX or SLO to save a cycle is not exotic on the C64, and the eleven
 * JAM opcodes have to hang rather than fall through.
 *
 * The two undocumented instructions with unstable behaviour on real silicon,
 * ANE ($8B) and LXA ($AB), use the constant $EE. That is a choice: the value
 * depends on temperature and on what was last on the bus, and $EE is what the
 * common emulators settled on. DEVIATION, and the only one in the
 * instruction set.
 */

/** The 6502's status bits, in the order PHP pushes them. */
export const FLAG_C = 0x01
export const FLAG_Z = 0x02
export const FLAG_I = 0x04
export const FLAG_D = 0x08
export const FLAG_B = 0x10
export const FLAG_U = 0x20
export const FLAG_V = 0x40
export const FLAG_N = 0x80

/** Where the stack page is. `$212752` adds $101 to SP, so this plus one. */
export const STACK_BASE = 0x0100

/**
 * The bus the processor sees.
 *
 * `playsid.library` gives its 6502 a flat 64KB and a second 64KB table that
 * says what each address IS: `$2126c6` clears the map to zero from the base
 * to $D400, writes a repeating 32-byte pattern over $D400 to $D800, and
 * clears the rest to $10000. That pattern is the SID mirrored every 32 bytes,
 * which is what the real chip does across its 1KB of address space.
 *
 * Modelled as two methods rather than as that table, because the table is a
 * dispatch technique and the mirroring is the behaviour.
 */
export interface Bus {
  read(addr: number): number
  write(addr: number, value: number): void
}

/** A plain 64KB of RAM, which is what a PSID file is loaded into. */
export class RamBus implements Bus {
  readonly ram = new Uint8Array(0x10000)

  read(addr: number): number {
    return this.ram[addr & 0xffff]!
  }

  write(addr: number, value: number): void {
    this.ram[addr & 0xffff] = value & 0xff
  }
}

/** How many cycles each opcode takes, before page-cross and branch penalties. */
// prettier-ignore
const CYCLES = Uint8Array.from([
  7, 6, 0, 8, 3, 3, 5, 5, 3, 2, 2, 2, 4, 4, 6, 6,
  2, 5, 0, 8, 4, 4, 6, 6, 2, 4, 2, 7, 4, 4, 7, 7,
  6, 6, 0, 8, 3, 3, 5, 5, 4, 2, 2, 2, 4, 4, 6, 6,
  2, 5, 0, 8, 4, 4, 6, 6, 2, 4, 2, 7, 4, 4, 7, 7,
  6, 6, 0, 8, 3, 3, 5, 5, 3, 2, 2, 2, 3, 4, 6, 6,
  2, 5, 0, 8, 4, 4, 6, 6, 2, 4, 2, 7, 4, 4, 7, 7,
  6, 6, 0, 8, 3, 3, 5, 5, 4, 2, 2, 2, 5, 4, 6, 6,
  2, 5, 0, 8, 4, 4, 6, 6, 2, 4, 2, 7, 4, 4, 7, 7,
  2, 6, 2, 6, 3, 3, 3, 3, 2, 2, 2, 2, 4, 4, 4, 4,
  2, 6, 0, 6, 4, 4, 4, 4, 2, 5, 2, 5, 5, 5, 5, 5,
  2, 6, 2, 6, 3, 3, 3, 3, 2, 2, 2, 2, 4, 4, 4, 4,
  2, 5, 0, 5, 4, 4, 4, 4, 2, 4, 2, 4, 4, 4, 4, 4,
  2, 6, 2, 8, 3, 3, 5, 5, 2, 2, 2, 2, 4, 4, 6, 6,
  2, 5, 0, 8, 4, 4, 6, 6, 2, 4, 2, 7, 4, 4, 7, 7,
  2, 6, 2, 8, 3, 3, 5, 5, 2, 2, 2, 2, 4, 4, 6, 6,
  2, 5, 0, 8, 4, 4, 6, 6, 2, 4, 2, 7, 4, 4, 7, 7,
])

/** ANE ($8B) and LXA ($AB) AND in a value the real chip does not define. */
const MAGIC = 0xee

/**
 * One 6502.
 *
 * `step()` runs a single instruction and returns the cycles it took.
 * `runUntilReturn()` is what a PSID player calls: it is the JSR at `$2127ae`
 * and the `rts` that comes back to `$2127b2`.
 */
export class Mos6502 {
  a = 0
  x = 0
  y = 0
  sp = 0xff
  pc = 0
  /** The status register, less B and U, which only exist on the stack. */
  p = FLAG_I | FLAG_U

  /** Set when a JAM opcode ($02, $12, ... ) locks the processor up. */
  jammed = false

  /** Cycles executed since the last `runUntilReturn`. */
  cycles = 0

  constructor(readonly bus: Bus) {}

  reset(): void {
    this.a = 0
    this.x = 0
    this.y = 0
    this.sp = 0xff
    this.p = FLAG_I | FLAG_U
    this.jammed = false
    this.cycles = 0
  }

  // --- the bus, and the two things that are not plain reads -----------------

  private rd(addr: number): number {
    return this.bus.read(addr & 0xffff) & 0xff
  }

  private wr(addr: number, v: number): void {
    this.bus.write(addr & 0xffff, v & 0xff)
  }

  private rdWord(addr: number): number {
    return this.rd(addr) | (this.rd(addr + 1) << 8)
  }

  /**
   * The indirect JMP bug: `JMP ($xxFF)` reads the high byte from $xx00 rather
   * than from the next page. Real silicon, and tunes have relied on it.
   */
  private rdWordBug(addr: number): number {
    const lo = this.rd(addr)
    const hi = this.rd((addr & 0xff00) | ((addr + 1) & 0x00ff))
    return lo | (hi << 8)
  }

  private fetch(): number {
    const v = this.rd(this.pc)
    this.pc = (this.pc + 1) & 0xffff
    return v
  }

  private fetchWord(): number {
    const v = this.rdWord(this.pc)
    this.pc = (this.pc + 2) & 0xffff
    return v
  }

  private push(v: number): void {
    this.wr(STACK_BASE + this.sp, v)
    this.sp = (this.sp - 1) & 0xff
  }

  private pull(): number {
    this.sp = (this.sp + 1) & 0xff
    return this.rd(STACK_BASE + this.sp)
  }

  // --- flags ----------------------------------------------------------------

  private setNZ(v: number): number {
    const b = v & 0xff
    this.p = (this.p & ~(FLAG_N | FLAG_Z)) | (b & FLAG_N) | (b === 0 ? FLAG_Z : 0)
    return b
  }

  private setFlag(mask: number, on: boolean): void {
    this.p = on ? this.p | mask : this.p & ~mask
  }

  // --- addressing -----------------------------------------------------------
  //
  // Each returns an effective address. `pageCross` is left set for the opcodes
  // that pay a cycle for it; the ones that always pay call the `W` variants.

  private pageCross = false

  private aZp(): number {
    return this.fetch()
  }

  private aZpX(): number {
    return (this.fetch() + this.x) & 0xff
  }

  private aZpY(): number {
    return (this.fetch() + this.y) & 0xff
  }

  private aAbs(): number {
    return this.fetchWord()
  }

  private aAbsX(): number {
    const base = this.fetchWord()
    const ea = (base + this.x) & 0xffff
    this.pageCross = (base & 0xff00) !== (ea & 0xff00)
    return ea
  }

  private aAbsY(): number {
    const base = this.fetchWord()
    const ea = (base + this.y) & 0xffff
    this.pageCross = (base & 0xff00) !== (ea & 0xff00)
    return ea
  }

  private aIndX(): number {
    const zp = (this.fetch() + this.x) & 0xff
    return this.rd(zp) | (this.rd((zp + 1) & 0xff) << 8)
  }

  private aIndY(): number {
    const zp = this.fetch()
    const base = this.rd(zp) | (this.rd((zp + 1) & 0xff) << 8)
    const ea = (base + this.y) & 0xffff
    this.pageCross = (base & 0xff00) !== (ea & 0xff00)
    return ea
  }

  // --- the ALU pieces shared by documented and undocumented opcodes ----------

  private adc(v: number): void {
    const c = this.p & FLAG_C ? 1 : 0
    if (this.p & FLAG_D) {
      // Decimal mode, the half the library assembles a second time for.
      let lo = (this.a & 0x0f) + (v & 0x0f) + c
      let hi = (this.a >> 4) + (v >> 4)
      if (lo > 9) {
        lo += 6
        hi += 1
      }
      // N, V and Z come from the BINARY result on a real 6502.
      const bin = this.a + v + c
      this.setFlag(FLAG_Z, (bin & 0xff) === 0)
      this.setFlag(FLAG_N, ((hi << 4) & 0x80) !== 0)
      this.setFlag(FLAG_V, (~(this.a ^ v) & (this.a ^ (hi << 4)) & 0x80) !== 0)
      if (hi > 9) hi += 6
      this.setFlag(FLAG_C, hi > 15)
      this.a = ((hi << 4) | (lo & 0x0f)) & 0xff
      return
    }
    const sum = this.a + v + c
    this.setFlag(FLAG_C, sum > 0xff)
    this.setFlag(FLAG_V, (~(this.a ^ v) & (this.a ^ sum) & 0x80) !== 0)
    this.a = this.setNZ(sum)
  }

  private sbc(v: number): void {
    const c = this.p & FLAG_C ? 1 : 0
    const diff = this.a - v - (1 - c)
    if (this.p & FLAG_D) {
      let lo = (this.a & 0x0f) - (v & 0x0f) - (1 - c)
      let hi = (this.a >> 4) - (v >> 4)
      if (lo & 0x10) {
        lo -= 6
        hi -= 1
      }
      if (hi & 0x10) hi -= 6
      // The flags are binary here too.
      this.setFlag(FLAG_C, (diff & 0x100) === 0)
      this.setFlag(FLAG_V, ((this.a ^ v) & (this.a ^ diff) & 0x80) !== 0)
      this.setNZ(diff)
      this.a = ((hi << 4) | (lo & 0x0f)) & 0xff
      return
    }
    this.setFlag(FLAG_C, (diff & 0x100) === 0)
    this.setFlag(FLAG_V, ((this.a ^ v) & (this.a ^ diff) & 0x80) !== 0)
    this.a = this.setNZ(diff)
  }

  private cmp(reg: number, v: number): void {
    const d = reg - v
    this.setFlag(FLAG_C, d >= 0)
    this.setNZ(d)
  }

  private aslV(v: number): number {
    this.setFlag(FLAG_C, (v & 0x80) !== 0)
    return this.setNZ(v << 1)
  }

  private lsrV(v: number): number {
    this.setFlag(FLAG_C, (v & 0x01) !== 0)
    return this.setNZ(v >> 1)
  }

  private rolV(v: number): number {
    const c = this.p & FLAG_C ? 1 : 0
    this.setFlag(FLAG_C, (v & 0x80) !== 0)
    return this.setNZ((v << 1) | c)
  }

  private rorV(v: number): number {
    const c = this.p & FLAG_C ? 0x80 : 0
    this.setFlag(FLAG_C, (v & 0x01) !== 0)
    return this.setNZ((v >> 1) | c)
  }

  private branch(take: boolean): void {
    const rel = (this.fetch() << 24) >> 24
    if (!take) return
    const to = (this.pc + rel) & 0xffff
    this.cycles += (to & 0xff00) === (this.pc & 0xff00) ? 1 : 2
    this.pc = to
  }

  /**
   * One instruction.
   *
   * Returns the cycles it consumed, which nothing in the PSID path reads yet:
   * the play routine runs to its RTS and the frame is over. It is here
   * because a CIA-speed tune eventually needs to know how long the routine
   * took, and because a cycle count is the cheapest thing to test a core
   * against.
   */
  step(): number {
    if (this.jammed) return 1
    const startCycles = this.cycles
    const op = this.fetch()
    this.pageCross = false
    this.cycles += CYCLES[op]!

    switch (op) {
      // --- load and store ---------------------------------------------------
      case 0xa9: this.a = this.setNZ(this.fetch()); break
      case 0xa5: this.a = this.setNZ(this.rd(this.aZp())); break
      case 0xb5: this.a = this.setNZ(this.rd(this.aZpX())); break
      case 0xad: this.a = this.setNZ(this.rd(this.aAbs())); break
      case 0xbd: this.a = this.setNZ(this.rd(this.aAbsX())); this.crossed(); break
      case 0xb9: this.a = this.setNZ(this.rd(this.aAbsY())); this.crossed(); break
      case 0xa1: this.a = this.setNZ(this.rd(this.aIndX())); break
      case 0xb1: this.a = this.setNZ(this.rd(this.aIndY())); this.crossed(); break

      case 0xa2: this.x = this.setNZ(this.fetch()); break
      case 0xa6: this.x = this.setNZ(this.rd(this.aZp())); break
      case 0xb6: this.x = this.setNZ(this.rd(this.aZpY())); break
      case 0xae: this.x = this.setNZ(this.rd(this.aAbs())); break
      case 0xbe: this.x = this.setNZ(this.rd(this.aAbsY())); this.crossed(); break

      case 0xa0: this.y = this.setNZ(this.fetch()); break
      case 0xa4: this.y = this.setNZ(this.rd(this.aZp())); break
      case 0xb4: this.y = this.setNZ(this.rd(this.aZpX())); break
      case 0xac: this.y = this.setNZ(this.rd(this.aAbs())); break
      case 0xbc: this.y = this.setNZ(this.rd(this.aAbsX())); this.crossed(); break

      case 0x85: this.wr(this.aZp(), this.a); break
      case 0x95: this.wr(this.aZpX(), this.a); break
      case 0x8d: this.wr(this.aAbs(), this.a); break
      case 0x9d: this.wr(this.aAbsX(), this.a); break
      case 0x99: this.wr(this.aAbsY(), this.a); break
      case 0x81: this.wr(this.aIndX(), this.a); break
      case 0x91: this.wr(this.aIndY(), this.a); break

      case 0x86: this.wr(this.aZp(), this.x); break
      case 0x96: this.wr(this.aZpY(), this.x); break
      case 0x8e: this.wr(this.aAbs(), this.x); break

      case 0x84: this.wr(this.aZp(), this.y); break
      case 0x94: this.wr(this.aZpX(), this.y); break
      case 0x8c: this.wr(this.aAbs(), this.y); break

      // --- transfers --------------------------------------------------------
      case 0xaa: this.x = this.setNZ(this.a); break
      case 0xa8: this.y = this.setNZ(this.a); break
      case 0x8a: this.a = this.setNZ(this.x); break
      case 0x98: this.a = this.setNZ(this.y); break
      case 0xba: this.x = this.setNZ(this.sp); break
      case 0x9a: this.sp = this.x; break

      // --- stack ------------------------------------------------------------
      case 0x48: this.push(this.a); break
      case 0x68: this.a = this.setNZ(this.pull()); break
      case 0x08: this.push(this.p | FLAG_B | FLAG_U); break
      case 0x28: this.p = (this.pull() & ~FLAG_B) | FLAG_U; break

      // --- logic ------------------------------------------------------------
      case 0x29: this.a = this.setNZ(this.a & this.fetch()); break
      case 0x25: this.a = this.setNZ(this.a & this.rd(this.aZp())); break
      case 0x35: this.a = this.setNZ(this.a & this.rd(this.aZpX())); break
      case 0x2d: this.a = this.setNZ(this.a & this.rd(this.aAbs())); break
      case 0x3d: this.a = this.setNZ(this.a & this.rd(this.aAbsX())); this.crossed(); break
      case 0x39: this.a = this.setNZ(this.a & this.rd(this.aAbsY())); this.crossed(); break
      case 0x21: this.a = this.setNZ(this.a & this.rd(this.aIndX())); break
      case 0x31: this.a = this.setNZ(this.a & this.rd(this.aIndY())); this.crossed(); break

      case 0x09: this.a = this.setNZ(this.a | this.fetch()); break
      case 0x05: this.a = this.setNZ(this.a | this.rd(this.aZp())); break
      case 0x15: this.a = this.setNZ(this.a | this.rd(this.aZpX())); break
      case 0x0d: this.a = this.setNZ(this.a | this.rd(this.aAbs())); break
      case 0x1d: this.a = this.setNZ(this.a | this.rd(this.aAbsX())); this.crossed(); break
      case 0x19: this.a = this.setNZ(this.a | this.rd(this.aAbsY())); this.crossed(); break
      case 0x01: this.a = this.setNZ(this.a | this.rd(this.aIndX())); break
      case 0x11: this.a = this.setNZ(this.a | this.rd(this.aIndY())); this.crossed(); break

      case 0x49: this.a = this.setNZ(this.a ^ this.fetch()); break
      case 0x45: this.a = this.setNZ(this.a ^ this.rd(this.aZp())); break
      case 0x55: this.a = this.setNZ(this.a ^ this.rd(this.aZpX())); break
      case 0x4d: this.a = this.setNZ(this.a ^ this.rd(this.aAbs())); break
      case 0x5d: this.a = this.setNZ(this.a ^ this.rd(this.aAbsX())); this.crossed(); break
      case 0x59: this.a = this.setNZ(this.a ^ this.rd(this.aAbsY())); this.crossed(); break
      case 0x41: this.a = this.setNZ(this.a ^ this.rd(this.aIndX())); break
      case 0x51: this.a = this.setNZ(this.a ^ this.rd(this.aIndY())); this.crossed(); break

      case 0x24: this.bit(this.rd(this.aZp())); break
      case 0x2c: this.bit(this.rd(this.aAbs())); break

      // --- arithmetic -------------------------------------------------------
      case 0x69: this.adc(this.fetch()); break
      case 0x65: this.adc(this.rd(this.aZp())); break
      case 0x75: this.adc(this.rd(this.aZpX())); break
      case 0x6d: this.adc(this.rd(this.aAbs())); break
      case 0x7d: this.adc(this.rd(this.aAbsX())); this.crossed(); break
      case 0x79: this.adc(this.rd(this.aAbsY())); this.crossed(); break
      case 0x61: this.adc(this.rd(this.aIndX())); break
      case 0x71: this.adc(this.rd(this.aIndY())); this.crossed(); break

      case 0xe9: case 0xeb: this.sbc(this.fetch()); break
      case 0xe5: this.sbc(this.rd(this.aZp())); break
      case 0xf5: this.sbc(this.rd(this.aZpX())); break
      case 0xed: this.sbc(this.rd(this.aAbs())); break
      case 0xfd: this.sbc(this.rd(this.aAbsX())); this.crossed(); break
      case 0xf9: this.sbc(this.rd(this.aAbsY())); this.crossed(); break
      case 0xe1: this.sbc(this.rd(this.aIndX())); break
      case 0xf1: this.sbc(this.rd(this.aIndY())); this.crossed(); break

      case 0xc9: this.cmp(this.a, this.fetch()); break
      case 0xc5: this.cmp(this.a, this.rd(this.aZp())); break
      case 0xd5: this.cmp(this.a, this.rd(this.aZpX())); break
      case 0xcd: this.cmp(this.a, this.rd(this.aAbs())); break
      case 0xdd: this.cmp(this.a, this.rd(this.aAbsX())); this.crossed(); break
      case 0xd9: this.cmp(this.a, this.rd(this.aAbsY())); this.crossed(); break
      case 0xc1: this.cmp(this.a, this.rd(this.aIndX())); break
      case 0xd1: this.cmp(this.a, this.rd(this.aIndY())); this.crossed(); break

      case 0xe0: this.cmp(this.x, this.fetch()); break
      case 0xe4: this.cmp(this.x, this.rd(this.aZp())); break
      case 0xec: this.cmp(this.x, this.rd(this.aAbs())); break

      case 0xc0: this.cmp(this.y, this.fetch()); break
      case 0xc4: this.cmp(this.y, this.rd(this.aZp())); break
      case 0xcc: this.cmp(this.y, this.rd(this.aAbs())); break

      // --- read-modify-write ------------------------------------------------
      case 0x0a: this.a = this.aslV(this.a); break
      case 0x06: this.rmw(this.aZp(), (v) => this.aslV(v)); break
      case 0x16: this.rmw(this.aZpX(), (v) => this.aslV(v)); break
      case 0x0e: this.rmw(this.aAbs(), (v) => this.aslV(v)); break
      case 0x1e: this.rmw(this.aAbsX(), (v) => this.aslV(v)); break

      case 0x4a: this.a = this.lsrV(this.a); break
      case 0x46: this.rmw(this.aZp(), (v) => this.lsrV(v)); break
      case 0x56: this.rmw(this.aZpX(), (v) => this.lsrV(v)); break
      case 0x4e: this.rmw(this.aAbs(), (v) => this.lsrV(v)); break
      case 0x5e: this.rmw(this.aAbsX(), (v) => this.lsrV(v)); break

      case 0x2a: this.a = this.rolV(this.a); break
      case 0x26: this.rmw(this.aZp(), (v) => this.rolV(v)); break
      case 0x36: this.rmw(this.aZpX(), (v) => this.rolV(v)); break
      case 0x2e: this.rmw(this.aAbs(), (v) => this.rolV(v)); break
      case 0x3e: this.rmw(this.aAbsX(), (v) => this.rolV(v)); break

      case 0x6a: this.a = this.rorV(this.a); break
      case 0x66: this.rmw(this.aZp(), (v) => this.rorV(v)); break
      case 0x76: this.rmw(this.aZpX(), (v) => this.rorV(v)); break
      case 0x6e: this.rmw(this.aAbs(), (v) => this.rorV(v)); break
      case 0x7e: this.rmw(this.aAbsX(), (v) => this.rorV(v)); break

      case 0xe6: this.rmw(this.aZp(), (v) => this.setNZ(v + 1)); break
      case 0xf6: this.rmw(this.aZpX(), (v) => this.setNZ(v + 1)); break
      case 0xee: this.rmw(this.aAbs(), (v) => this.setNZ(v + 1)); break
      case 0xfe: this.rmw(this.aAbsX(), (v) => this.setNZ(v + 1)); break

      case 0xc6: this.rmw(this.aZp(), (v) => this.setNZ(v - 1)); break
      case 0xd6: this.rmw(this.aZpX(), (v) => this.setNZ(v - 1)); break
      case 0xce: this.rmw(this.aAbs(), (v) => this.setNZ(v - 1)); break
      case 0xde: this.rmw(this.aAbsX(), (v) => this.setNZ(v - 1)); break

      case 0xe8: this.x = this.setNZ(this.x + 1); break
      case 0xca: this.x = this.setNZ(this.x - 1); break
      case 0xc8: this.y = this.setNZ(this.y + 1); break
      case 0x88: this.y = this.setNZ(this.y - 1); break

      // --- flow -------------------------------------------------------------
      case 0x4c: this.pc = this.fetchWord(); break
      case 0x6c: this.pc = this.rdWordBug(this.fetchWord()); break
      case 0x20: {
        const to = this.fetchWord()
        const ret = (this.pc - 1) & 0xffff
        this.push(ret >> 8)
        this.push(ret & 0xff)
        this.pc = to
        break
      }
      case 0x60: {
        const lo = this.pull()
        const hi = this.pull()
        this.pc = ((lo | (hi << 8)) + 1) & 0xffff
        break
      }
      case 0x40: {
        this.p = (this.pull() & ~FLAG_B) | FLAG_U
        const lo = this.pull()
        const hi = this.pull()
        this.pc = lo | (hi << 8)
        break
      }
      case 0x00: {
        // BRK pushes PC+2 and the B flag, then vectors through $FFFE.
        this.pc = (this.pc + 1) & 0xffff
        this.push(this.pc >> 8)
        this.push(this.pc & 0xff)
        this.push(this.p | FLAG_B | FLAG_U)
        this.setFlag(FLAG_I, true)
        this.pc = this.rdWord(0xfffe)
        break
      }

      case 0x10: this.branch((this.p & FLAG_N) === 0); break
      case 0x30: this.branch((this.p & FLAG_N) !== 0); break
      case 0x50: this.branch((this.p & FLAG_V) === 0); break
      case 0x70: this.branch((this.p & FLAG_V) !== 0); break
      case 0x90: this.branch((this.p & FLAG_C) === 0); break
      case 0xb0: this.branch((this.p & FLAG_C) !== 0); break
      case 0xd0: this.branch((this.p & FLAG_Z) === 0); break
      case 0xf0: this.branch((this.p & FLAG_Z) !== 0); break

      case 0x18: this.setFlag(FLAG_C, false); break
      case 0x38: this.setFlag(FLAG_C, true); break
      case 0x58: this.setFlag(FLAG_I, false); break
      case 0x78: this.setFlag(FLAG_I, true); break
      case 0xb8: this.setFlag(FLAG_V, false); break
      case 0xd8: this.setFlag(FLAG_D, false); break
      case 0xf8: this.setFlag(FLAG_D, true); break

      case 0xea: break

      // --- undocumented: the NOPs -------------------------------------------
      case 0x1a: case 0x3a: case 0x5a: case 0x7a: case 0xda: case 0xfa:
        break
      case 0x80: case 0x82: case 0x89: case 0xc2: case 0xe2:
        this.fetch()
        break
      case 0x04: case 0x44: case 0x64:
        this.aZp()
        break
      case 0x14: case 0x34: case 0x54: case 0x74: case 0xd4: case 0xf4:
        this.aZpX()
        break
      case 0x0c:
        this.aAbs()
        break
      case 0x1c: case 0x3c: case 0x5c: case 0x7c: case 0xdc: case 0xfc:
        this.aAbsX()
        this.crossed()
        break

      // --- undocumented: the combinations -----------------------------------
      // LAX: LDA and LDX at once.
      case 0xa7: this.lax(this.rd(this.aZp())); break
      case 0xb7: this.lax(this.rd(this.aZpY())); break
      case 0xaf: this.lax(this.rd(this.aAbs())); break
      case 0xbf: this.lax(this.rd(this.aAbsY())); this.crossed(); break
      case 0xa3: this.lax(this.rd(this.aIndX())); break
      case 0xb3: this.lax(this.rd(this.aIndY())); this.crossed(); break

      // SAX: store A AND X.
      case 0x87: this.wr(this.aZp(), this.a & this.x); break
      case 0x97: this.wr(this.aZpY(), this.a & this.x); break
      case 0x8f: this.wr(this.aAbs(), this.a & this.x); break
      case 0x83: this.wr(this.aIndX(), this.a & this.x); break

      // SLO, RLA, SRE, RRA, DCP, ISC: an RMW and an ALU op in one.
      case 0x07: this.rmw(this.aZp(), (v) => this.slo(v)); break
      case 0x17: this.rmw(this.aZpX(), (v) => this.slo(v)); break
      case 0x0f: this.rmw(this.aAbs(), (v) => this.slo(v)); break
      case 0x1f: this.rmw(this.aAbsX(), (v) => this.slo(v)); break
      case 0x1b: this.rmw(this.aAbsY(), (v) => this.slo(v)); break
      case 0x03: this.rmw(this.aIndX(), (v) => this.slo(v)); break
      case 0x13: this.rmw(this.aIndY(), (v) => this.slo(v)); break

      case 0x27: this.rmw(this.aZp(), (v) => this.rla(v)); break
      case 0x37: this.rmw(this.aZpX(), (v) => this.rla(v)); break
      case 0x2f: this.rmw(this.aAbs(), (v) => this.rla(v)); break
      case 0x3f: this.rmw(this.aAbsX(), (v) => this.rla(v)); break
      case 0x3b: this.rmw(this.aAbsY(), (v) => this.rla(v)); break
      case 0x23: this.rmw(this.aIndX(), (v) => this.rla(v)); break
      case 0x33: this.rmw(this.aIndY(), (v) => this.rla(v)); break

      case 0x47: this.rmw(this.aZp(), (v) => this.sre(v)); break
      case 0x57: this.rmw(this.aZpX(), (v) => this.sre(v)); break
      case 0x4f: this.rmw(this.aAbs(), (v) => this.sre(v)); break
      case 0x5f: this.rmw(this.aAbsX(), (v) => this.sre(v)); break
      case 0x5b: this.rmw(this.aAbsY(), (v) => this.sre(v)); break
      case 0x43: this.rmw(this.aIndX(), (v) => this.sre(v)); break
      case 0x53: this.rmw(this.aIndY(), (v) => this.sre(v)); break

      case 0x67: this.rmw(this.aZp(), (v) => this.rra(v)); break
      case 0x77: this.rmw(this.aZpX(), (v) => this.rra(v)); break
      case 0x6f: this.rmw(this.aAbs(), (v) => this.rra(v)); break
      case 0x7f: this.rmw(this.aAbsX(), (v) => this.rra(v)); break
      case 0x7b: this.rmw(this.aAbsY(), (v) => this.rra(v)); break
      case 0x63: this.rmw(this.aIndX(), (v) => this.rra(v)); break
      case 0x73: this.rmw(this.aIndY(), (v) => this.rra(v)); break

      case 0xc7: this.rmw(this.aZp(), (v) => this.dcp(v)); break
      case 0xd7: this.rmw(this.aZpX(), (v) => this.dcp(v)); break
      case 0xcf: this.rmw(this.aAbs(), (v) => this.dcp(v)); break
      case 0xdf: this.rmw(this.aAbsX(), (v) => this.dcp(v)); break
      case 0xdb: this.rmw(this.aAbsY(), (v) => this.dcp(v)); break
      case 0xc3: this.rmw(this.aIndX(), (v) => this.dcp(v)); break
      case 0xd3: this.rmw(this.aIndY(), (v) => this.dcp(v)); break

      case 0xe7: this.rmw(this.aZp(), (v) => this.isc(v)); break
      case 0xf7: this.rmw(this.aZpX(), (v) => this.isc(v)); break
      case 0xef: this.rmw(this.aAbs(), (v) => this.isc(v)); break
      case 0xff: this.rmw(this.aAbsX(), (v) => this.isc(v)); break
      case 0xfb: this.rmw(this.aAbsY(), (v) => this.isc(v)); break
      case 0xe3: this.rmw(this.aIndX(), (v) => this.isc(v)); break
      case 0xf3: this.rmw(this.aIndY(), (v) => this.isc(v)); break

      // --- undocumented: the immediate oddities ------------------------------
      case 0x0b: case 0x2b: {
        // ANC: AND then copy bit 7 into carry.
        this.a = this.setNZ(this.a & this.fetch())
        this.setFlag(FLAG_C, (this.a & 0x80) !== 0)
        break
      }
      case 0x4b: {
        // ALR: AND then LSR.
        this.a = this.lsrV(this.a & this.fetch())
        break
      }
      case 0x6b: {
        // ARR: AND, then a rotate whose flags come out of the adder.
        const v = this.a & this.fetch()
        const c = this.p & FLAG_C ? 0x80 : 0
        this.a = this.setNZ((v >> 1) | c)
        this.setFlag(FLAG_C, (this.a & 0x40) !== 0)
        this.setFlag(FLAG_V, (((this.a >> 6) ^ (this.a >> 5)) & 1) !== 0)
        break
      }
      case 0x8b: {
        // ANE, unstable on silicon. See the header.
        this.a = this.setNZ((this.a | MAGIC) & this.x & this.fetch())
        break
      }
      case 0xab: {
        // LXA, unstable on silicon. See the header.
        this.a = this.setNZ((this.a | MAGIC) & this.fetch())
        this.x = this.a
        break
      }
      case 0xcb: {
        // SBX: (A AND X) minus immediate, into X, with a CMP's carry.
        const v = this.fetch()
        const d = (this.a & this.x) - v
        this.setFlag(FLAG_C, d >= 0)
        this.x = this.setNZ(d)
        break
      }

      // --- undocumented: the ones that AND the high address byte -------------
      case 0x9c: this.shy(this.aAbsX()); break
      case 0x9e: this.shx(this.aAbsY()); break
      case 0x93: this.sha(this.aIndY()); break
      case 0x9f: this.sha(this.aAbsY()); break
      case 0x9b: {
        // TAS: SP becomes A AND X, then SHA.
        const ea = this.aAbsY()
        this.sp = this.a & this.x
        this.sha(ea)
        break
      }
      case 0xbb: {
        // LAS: memory AND SP into A, X and SP.
        const v = this.rd(this.aAbsY()) & this.sp
        this.a = this.setNZ(v)
        this.x = v
        this.sp = v
        this.crossed()
        break
      }

      // --- undocumented: the eleven that lock the processor up ---------------
      case 0x02: case 0x12: case 0x22: case 0x32: case 0x42: case 0x52:
      case 0x62: case 0x72: case 0x92: case 0xb2: case 0xd2: case 0xf2:
        this.jammed = true
        this.pc = (this.pc - 1) & 0xffff
        this.cycles += 1
        break

      default:
        // Unreachable: all 256 are above. Kept so a future edit cannot open a
        // silent hole in the table.
        throw new Error(`6502: opcode $${op.toString(16)} not handled`)
    }

    return this.cycles - startCycles
  }

  private crossed(): void {
    if (this.pageCross) this.cycles += 1
  }

  private rmw(ea: number, f: (v: number) => number): void {
    this.wr(ea, f(this.rd(ea)))
  }

  private bit(v: number): void {
    this.setFlag(FLAG_Z, (this.a & v) === 0)
    this.setFlag(FLAG_N, (v & 0x80) !== 0)
    this.setFlag(FLAG_V, (v & 0x40) !== 0)
  }

  private lax(v: number): void {
    this.a = this.setNZ(v)
    this.x = this.a
  }

  private slo(v: number): number {
    const r = this.aslV(v)
    this.a = this.setNZ(this.a | r)
    return r
  }

  private rla(v: number): number {
    const r = this.rolV(v)
    this.a = this.setNZ(this.a & r)
    return r
  }

  private sre(v: number): number {
    const r = this.lsrV(v)
    this.a = this.setNZ(this.a ^ r)
    return r
  }

  private rra(v: number): number {
    const r = this.rorV(v)
    this.adc(r)
    return r
  }

  private dcp(v: number): number {
    const r = (v - 1) & 0xff
    this.cmp(this.a, r)
    return r
  }

  private isc(v: number): number {
    const r = (v + 1) & 0xff
    this.sbc(r)
    return r
  }

  /** SHA/SHX/SHY store the register ANDed with the address's high byte plus one. */
  private sha(ea: number): void {
    this.wr(ea, this.a & this.x & (((ea >> 8) + 1) & 0xff))
  }

  private shx(ea: number): void {
    this.wr(ea, this.x & (((ea >> 8) + 1) & 0xff))
  }

  private shy(ea: number): void {
    this.wr(ea, this.y & (((ea >> 8) + 1) & 0xff))
  }

  /**
   * Call a 6502 subroutine and come back, which is `$2127a8` through
   * `$2127c0`.
   *
   * The library sets SP to $FF (`moveq #$ff,d7` at `$210700` for init and
   * `$21075e` for play) and lets the routine's own RTS unwind past the bottom
   * of the stack: `a1` walks back up to `a0 + $200` and the generated RTS
   * fragment returns to 68k. So the run ends on the RTS that pops the stack
   * empty, and that is what `depth` counts here.
   *
   * `maxCycles` has no counterpart in the library, which trusts the tune.
   * DEVIATION: a PSID file is third-party code loaded off disk, and a play
   * routine that never returns would hang the browser's frame loop rather
   * than an Amiga somebody can reset. It returns false when it trips.
   */
  runUntilReturn(pc: number, a = 0, x = 0, y = 0, maxCycles = 2_000_000): boolean {
    this.pc = pc & 0xffff
    this.a = a & 0xff
    this.x = x & 0xff
    this.y = y & 0xff
    this.sp = 0xff
    this.jammed = false
    this.cycles = 0

    while (this.cycles < maxCycles) {
      // The end condition is the STACK, not a nesting count. C64 code reaches
      // a subroutine by pushing an address and executing RTS often enough that
      // counting JSRs would come apart on the first tune that did it.
      if (this.rd(this.pc) === 0x60 && this.sp === 0xff) {
        this.pc = (this.pc + 1) & 0xffff
        this.cycles += 6
        return true
      }
      this.step()
      if (this.jammed) return false
    }
    return false
  }
}
