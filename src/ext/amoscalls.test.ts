/**
 * Which numbering an extension's `Rjsr` into library 0 is written in.
 *
 * This was wrong for a year and looked right, which is the whole reason it
 * needs a test. `AMOS_ROUTINES` comes from `+lib_Labels.s`, AMOS Pro 2.0's
 * own external list, and reading extension calls against it produced fluent
 * nonsense: 1025 came out `L_Dia_ScCopy` and fifty-two extensions use that
 * number to raise their own error requester.
 *
 * The answer is in the loader. `+B.s:2627` tests `LBF_20` — set only when
 * the library file carries the magic `AP20`, which two of seventy-one
 * third-party binaries do — and for every other library runs `Ext_OldLabel`,
 * a lookup in a table headed "Table de conversion des labels AMOSPro 1.0
 * >>> AMOSPro 2.0". So an extension is numbered against the older kit, whose
 * label list says as much in its own first line:
 *
 *     ; AMOS 1.34 Compiler librarie numbers
 *     ; + AMOSPro V1.0 extension functions
 *
 * The tests below are the cross-check that makes this evidence rather than a
 * better-looking guess.
 */
import { describe, expect, it } from 'vitest'
import { AMOS_EXT_CONVERT, AMOS_EXT_LABELS, AMOS_ROUTINES } from './amoscalls.gen'

describe('the numbering extensions call AMOS in', () => {
  it('is a different table from the one AMOS Pro 2.0 uses internally', () => {
    // both exist, and they disagree about the same numbers — which is the
    // failure mode: every number resolves under either, plausibly
    expect(Object.keys(AMOS_EXT_LABELS).length).toBeGreaterThan(900)
    expect(AMOS_EXT_LABELS[1025]).toBe('L_ErrorExt')
    expect(AMOS_ROUTINES[1025]).toBe('L_Dia_ScCopy')
    expect(AMOS_EXT_LABELS[431]).toBe('L_AdOuBank')
    expect(AMOS_ROUTINES[431]).toBe('L_InSetPaint')
  })

  it('reaches past where the 2.0 list stops, which is how the mismatch showed', () => {
    // +lib_Labels.s ends on `L_End_Externes: set 1040`; the bank, disk and
    // device helpers extensions lean on are all above it
    expect(AMOS_ROUTINES[1040]).toBe('L_End_Externes')
    expect(AMOS_ROUTINES[1100]).toBeUndefined()
    expect(AMOS_EXT_LABELS[1100]).toBe('L_Bnk_GetAdr')
    expect(AMOS_EXT_LABELS[1107]).toBe('L_Bnk_EffAll')
    expect(AMOS_EXT_LABELS[1121]).toBe('L_Bnk_OrAdr')
  })

  /**
   * The cross-check, and the reason this is settled rather than argued.
   *
   * `Ext_Convert` maps an old number to a 2.0 LABEL. Those labels are in
   * `+lequ.s` space, which is `+lib_Labels.s` plus exactly 500. So for every
   * conversion whose target `+lib_Labels.s` also carries, two independent
   * files must agree on the name — and they do, 21 times, with no
   * disagreement anywhere. The ten that cannot be checked are labels
   * `+lib_Labels.s` does not carry at all, not conflicts.
   */
  it('agrees with Ext_Convert everywhere both tables can be asked', () => {
    const byName = new Map(Object.entries(AMOS_ROUTINES).map(([n, l]) => [l, Number(n)]))
    const disagreements: string[] = []
    let checked = 0
    for (const [oldNum, label] of Object.entries(AMOS_EXT_CONVERT)) {
      const twoOh = byName.get(label)
      if (twoOh === undefined) continue // not an external in the 2.0 list
      const ours = AMOS_EXT_LABELS[Number(oldNum)]
      if (ours === undefined) continue
      checked++
      // `_` in the 1.34 spelling is `.` in the 2.0 one — L_Bnk_GetAdr / L_Bnk.GetAdr
      if (ours.replace(/_/g, '.').toLowerCase() !== label.replace(/_/g, '.').toLowerCase()) {
        disagreements.push(`${oldNum}: ${ours} vs ${label}`)
      }
    }
    expect(checked).toBeGreaterThanOrEqual(21)
    expect(disagreements).toEqual([])
  })

  it('keeps the conversion table at the 31 entries the shipped binary has', () => {
    // read out of fixtures/official-amos/AMOSPro at $4f26 as well as out of
    // +B.s; the two agree entry for entry, so the source snapshot is complete
    // and "the shipped build exported more" is ruled out
    expect(Object.keys(AMOS_EXT_CONVERT)).toHaveLength(31)
    expect(AMOS_EXT_CONVERT[1024]).toBe('L_Error')
    expect(AMOS_EXT_CONVERT[1025]).toBe('L_ErrorExt')
    expect(AMOS_EXT_CONVERT[1121]).toBe('L_Bnk.OrAdr')
  })
})
