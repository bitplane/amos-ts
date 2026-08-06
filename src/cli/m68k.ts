/**
 * The 68000 disassembler both `extdis.ts` and `tddis.ts` drive.
 *
 * There is no m68k disassembler in the JavaScript ecosystem worth depending
 * on, so this shells out to python3 with capstone. That is a tool-only
 * dependency — nothing under src/runtime or src/amiga touches it — and it is
 * why every caller must cope with `null`.
 *
 * It lives here because the two tools had a copy each and they had DRIFTED,
 * not merely duplicated: tddis was still on `CS_MODE_M68K_000`, the mode #176
 * established is wrong for this material. Several libraries are assembled with
 * the long form of Bcc — an $FF displacement byte followed by a 32-bit offset
 * — which the 68000 does not have, so in 000 mode capstone emits a `dc.w
 * $67ff` and resyncs one word late, and every loop after it reads as data. The
 * 020 instruction set is otherwise a superset, so nothing else changes.
 */
import { execFileSync } from 'node:child_process'
import { unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface DisasmOptions {
  /**
   * Step over AMOS's call pseudo-instructions instead of disassembling them.
   *
   * They are checked BEFORE capstone at every boundary and never handed to it.
   * In 020 mode an $F-line word is a legal coprocessor opcode, so capstone
   * consumes the pseudo-op AND whatever follows, then resyncs mid-instruction.
   * Letting it see one at all is what desynced the listing; rewriting its
   * output afterwards could not fix that, because by then the boundaries were
   * already wrong. Sizes come from +CEqu.s: kinds 0 and 1 carry a selector
   * pair and are six bytes, the rest are four.
   *
   * Each one is emitted as `.amoscall <size>` for the caller to name. Off for
   * anything that is not an AMOS extension — AMOS 3D's engine is an ordinary
   * relocated Amiga library and has none.
   */
  readonly amosCalls?: boolean
}

/**
 * Disassemble `[start, end)`, where `bytes[0]` sits at address `base`.
 *
 * Returns the raw capstone lines, `  %07x  %-10s %s`, or null when python3 or
 * capstone is missing. A word capstone cannot decode is emitted as `.dc.w`
 * and the walk steps two bytes, so the listing never desyncs on data.
 */
export function disasm(
  bytes: Uint8Array,
  base: number,
  start: number,
  end: number,
  opts: DisasmOptions = {},
): string[] | null {
  // built line by line: a template literal would eat the Python f-strings'
  // braces and dollars
  const py = [
    'import sys',
    'from capstone import *',
    "c = open(sys.argv[1],'rb').read()",
    'md = Cs(CS_ARCH_M68K, CS_MODE_BIG_ENDIAN | CS_MODE_M68K_020)',
    'base, start, end = int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4])',
    'pos = start',
    'while pos < end:',
    '    o = pos - base',
    ...(opts.amosCalls
      ? [
          '    if c[o] == 0xFE and (c[o + 1] & 0x0F) == 0x01:',
          '        k = c[o + 1] >> 4',
          '        size = 6 if k in (0, 1) else 4',
          '        print("  %07x  .amoscall  %d" % (pos, size)); pos += size; continue',
        ]
      : []),
    '    hit = False',
    '    for i in md.disasm(c[o:end - base], pos):',
    '        print("  %07x  %-10s %s" % (i.address, i.mnemonic, i.op_str))',
    '        pos = i.address + i.size; hit = True; break',
    '    if not hit:',
    '        print("  %07x  .dc.w      $%04x" % (pos, (c[o] << 8) | c[o + 1])); pos += 2',
  ].join('\n')
  const tmp = join(process.env.TMPDIR ?? '/tmp', 'm68kdis-' + String(process.pid) + '.bin')
  try {
    writeFileSync(tmp, bytes)
    const raw = execFileSync('python3', ['-c', py, tmp, String(base), String(start), String(end)], {
      encoding: 'utf8',
    }).trimEnd()
    return raw === '' ? [] : raw.split('\n')
  } catch {
    return null
  } finally {
    try {
      unlinkSync(tmp)
    } catch {
      // the write itself may have failed; nothing to clean up
    }
  }
}
