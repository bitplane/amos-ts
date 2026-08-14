import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { CONFIG_MESSAGES, configSlots, mainLibrary, readConfigTables } from './slottab'
import { corpusFile, haveCorpus } from './corpus'

const FLASH = '(000,2)(440,2)(880,2)(bb0,2)(dd0,2)(ee0,2)(ff2,2)(ff8,2)(ffc,2)(fff,2)'

/** The `EdT` entries for a message list: `dc.b 0`, a length byte, the chars. */
function encode(messages: string[]): number[] {
  const out: number[] = []
  for (const m of messages) {
    out.push(0, m.length)
    for (const c of m) out.push(c.charCodeAt(0))
  }
  return out
}

/** A stock-shaped text zone: 47 messages, the flash list at 46. */
function config(slots: Record<number, string> = {}): string[] {
  const m = new Array<string>(CONFIG_MESSAGES).fill('')
  m[0] = 'APSystem/'
  m[4] = 'AutoExec.AMOS'
  m[13] = 'AMOSPro.Lib' // message 14
  m[15] = 'AMOSPro_Music.Lib' // message 16, slot 1
  m[16] = 'AMOSPro_Compact.Lib'
  m[42] = 'Par:'
  m[43] = 'Aux:'
  m[45] = FLASH // message 46
  for (const [slot, name] of Object.entries(slots)) m[14 + Number(slot)] = name
  return m
}

describe('interpreter config message tables', () => {
  it('reads the slot list, numbering slot n as message 15+n', () => {
    const [t] = readConfigTables(Uint8Array.from(encode(config({ 22: 'JD.Lib' }))))
    expect(t).toBeDefined()
    expect(mainLibrary(t!)).toBe('AMOSPro.Lib')
    expect([...configSlots(t!)]).toEqual([
      [1, 'AMOSPro_Music.Lib'],
      [2, 'AMOSPro_Compact.Lib'],
      [22, 'JD.Lib'],
    ])
  })

  it('is not shifted by a run of zeros ahead of the table', () => {
    // The case the message-46 anchor exists for: zeros parse as any number of
    // empty messages, so a table found by its start would renumber every slot.
    const zeros = new Array(64).fill(0)
    const [t] = readConfigTables(Uint8Array.from([...zeros, ...encode(config({ 24: 'ProTracker.lib' }))]))
    expect(t?.offset).toBe(64)
    expect(configSlots(t!).get(24)).toBe('ProTracker.lib')
  })

  it('reads a table padded with empty entries and no $ff terminator', () => {
    // what a compiled program carries -- PuzCat's zone is filled to length
    const pad = new Array(34).fill(0)
    const [t] = readConfigTables(Uint8Array.from([...encode(config({ 8: 'AMCAF.Lib' })), ...pad]))
    expect(configSlots(t!).get(8)).toBe('AMCAF.Lib')
  })

  it('reads a table ending in the $ff terminator', () => {
    const [t] = readConfigTables(Uint8Array.from([...encode(config()), 0, 0xff]))
    expect(t?.messages).toHaveLength(CONFIG_MESSAGES)
  })

  it('does not find a config whose message 46 was emptied', () => {
    const m = config()
    m[45] = ''
    expect(readConfigTables(Uint8Array.from(encode(m)))).toHaveLength(0)
  })

  it('does not find a flash list that is not message 46', () => {
    expect(readConfigTables(Uint8Array.from(encode(['', FLASH])))).toHaveLength(0)
  })
})

describe.runIf(haveCorpus())('a compiled program in the corpus', () => {
  // PuzCat, Aminet game/jump/Puzcat.lha. Its .AMOS source calls five token ids
  // in slot 24 that no registered extension explains; the config it was built
  // with names what was there.
  const path = corpusFile('09ac7d3c805462201347b6d7f5a8e61e70938887dc02b59a5077fdb8192dd0f3')

  it.runIf(path !== null)('names the three unregistered extensions PuzCat was built with', () => {
    const [t] = readConfigTables(readFileSync(path!))
    expect(t?.offset).toBe(0x17838)
    expect(mainLibrary(t!)).toBe('AMOSPro.Lib')
    const slots = configSlots(t!)
    // the five stock slots the parse validates against (+Interpreter_Config.s:152-157)
    expect(slots.get(1)).toBe('AMOSPro_Music.lib')
    expect(slots.get(2)).toBe('AMOSPro_Compact.Lib')
    expect(slots.get(3)).toBe('AMOSPro_Request.Lib')
    expect(slots.get(5)).toBe('AMOSPro_Compiler.Lib')
    expect(slots.get(6)).toBe('AMOSPro_IOPorts.Lib')
    expect(slots.has(4)).toBe(false) // no AMOS 3D on that machine
    expect(slots.get(22)).toBe('MaxMap.lib')
    expect(slots.get(23)).toBe('MachMaths.lib')
    expect(slots.get(24)).toBe('ProTracker.lib')
  })
})
