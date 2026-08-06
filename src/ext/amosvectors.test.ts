import { describe, expect, it } from 'vitest'
import { EC_VECTORS, SY_VECTORS, WI_VECTORS, amosVector } from './amosvectors'

describe('the AMOS vector tables extensions reach through a5', () => {
  it('the three lists end where their equate lists do', () => {
    // +Equ.s: Request_OnOff equ 100, PourSli equ 76, SXSYCuWi equ 19
    expect(SY_VECTORS.length).toBe(101)
    expect(SY_VECTORS[100]).toBe('Request_OnOff')
    expect(EC_VECTORS.length).toBe(77)
    expect(EC_VECTORS[76]).toBe('PourSli')
    expect(WI_VECTORS.length).toBe(20)
    expect(WI_VECTORS[19]).toBe('SXSYCuWi')
  })

  it('the offset is the index times four, per SyCall/EcCall/WiCall', () => {
    // `jsr \1*4(a0)` — +Equ.s:394, :660, :768
    expect(amosVector(4, 0)).toBe('SyCall Inkey')
    expect(amosVector(4, 49 * 4)).toBe('SyCall SetBob')
    expect(amosVector(8, 35 * 4)).toBe('EcCall ClsEc')
    expect(amosVector(12, 1 * 4)).toBe('WiCall Print')
  })

  it('names the calls Range makes, which is how the mapping was confirmed', () => {
    // read off the binary before the equate lists were found, from what the
    // keywords do: Float Bob's pair, List Bobs' paste, First Col's test
    expect(amosVector(4, 0xc4)).toBe('SyCall SetBob')
    expect(amosVector(4, 0xc8)).toBe('SyCall OffBob')
    expect(amosVector(4, 0x11c)).toBe('SyCall Patch')
    expect(amosVector(4, 0xfc)).toBe('SyCall ColGet')
    expect(amosVector(8, 0x12c)).toBe('EcCall NTSC')
  })

  it('says nothing rather than guessing when the reading cannot be right', () => {
    expect(amosVector(4, 0x102)).toBeNull() // not a multiple of four
    expect(amosVector(4, 101 * 4)).toBeNull() // past the end of the table
    expect(amosVector(16, 0)).toBeNull() // not one of the three slots
    expect(amosVector(8, 2 * 4)).toBeNull() // the one Ec entry +Equ.s leaves unnamed
  })
})
