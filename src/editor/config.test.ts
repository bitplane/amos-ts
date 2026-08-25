import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { describeWith } from '../testing/fixture'
import { corpusFile, corpusIndex, haveCorpus } from '../cli/corpus'
import { ED_KFONC, ED_ROUTINES } from './keymap.gen'
import { readMenuDefs } from './menus'
import { ED_MESSAGES, ED_SYSTEME, ED_TST_MESSAGES, EDM_MESSAGES } from '../runtime/edmessages.gen'
import { ED_RUN_MESSAGES } from '../interp/errors.gen'
import {
  CFG,
  CONFIG_SIZE,
  EditorConfig,
  changeMessage,
  messages,
  readConfig,
  writeConfig,
} from './config'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokeniseSource } from '../tokens/edtok'
import { verify } from '../tokens/verify'
import { AmigaFS } from '../amiga/vfs'
import { ProgramBuffer } from './buffer'
import { EditBuffer } from './editbuf'
import { UndoBuffer } from './undo'
import { Edit } from './edit'
import { ED, edCall } from './commands'
import type { Confirm, DialogueAnswer, EditorDialogues, SearchDialogue } from './search'
import type { PrgCommand } from './windows'

const table = new TokenTable(CORE_TOKENS)

function open(): Edit {
  const src = verify(tokeniseSource('Print "one"', table), {}).slice(0, -2)
  const e = new Edit(ProgramBuffer.load(src), new EditBuffer(8), new UndoBuffer(50), table)
  e.fill()
  e.fs = new AmigaFS()
  ;(e.fs as AmigaFS).mountMemory('RAM')
  ;(e.fs as AmigaFS).mountMemory('AMOSPro_System')
  return e
}

const requester = (
  confirm: (c: Confirm) => number = () => 1,
  value: (which: number) => number = () => 0,
): EditorDialogues => ({
  ask: (d: SearchDialogue): DialogueAnswer => ({ ...d, ok: true }),
  confirm,
  select: (_w, name) => name,
  pressKey: () => 0,
  pickWindow: () => 0,
  value,
})

describe('the block', () => {
  it('is 1,202 bytes, which is the file\'s only check', () => {
    const c = new EditorConfig()
    expect(c.bytes.length).toBe(CONFIG_SIZE)
    // `.Ed_KFonc` is at $288 of the shipped file, which is 4 bytes of length
    // plus 644 into the block -- the same arithmetic src/cli/genedkeys.ts
    // verifies against the binary
    expect(4 + 644).toBe(0x288)
  })

  it('holds the defaults +Editor_Config.s assembles', () => {
    const c = new EditorConfig()
    expect(c.sx).toBe(640)
    expect(c.sy).toBe(256)
    expect(c.wx).toBe(129)
    expect(c.wy).toBe(50)
    expect(c.lUndo).toBe(4096)
    expect(c.nUndo).toBe(1000)
    expect(c.keywordCase).toBe(2)
    expect(c.identCase).toBe(1)
    expect(c.svBak).toBe(true)
    expect(c.tabs).toBe(3)
    expect(c.insert).toBe(true)
    expect(c.sounds).toBe(false)
    expect(c.quitFlags).toBe(1) // "Par default: confirm quit"
    expect(c.palette).toEqual([0x000, 0x06f, 0x077, 0xeee, 0xf00, 0x0dd, 0x0aa, 0xff3])
    expect(c.code).toBe('1.10')
  })

  it('carries the key map, terminator and all', () => {
    const c = new EditorConfig()
    // 552 bytes of records plus the `$FF,0` that lives in what looks like
    // two bytes of alignment at 1196
    expect(c.keyMap.length).toBe(554)
    expect([...c.keyMap]).toEqual([...ED_KFONC])
    expect(c.keyMap[552]).toBe(0xff)
    expect(c.keyMap[553]).toBe(0)
  })

  it('binds no command to a program until one is loaded', () => {
    expect(new EditorConfig().autoLoad.every((b) => b === 0)).toBe(true)
  })
})

describe('the file', () => {
  it('is refused when the length at the front is not 1,202', () => {
    const file = writeConfig(new EditorConfig())
    file[3] = 0
    expect(readConfig(file).error).toBe(CFG.BAD)
    expect(readConfig(new Uint8Array(2)).error).toBe(CFG.DISK)
  })

  it('round-trips a config with its eight text blocks', () => {
    const c = new EditorConfig()
    c.texts.system = Uint8Array.from([0, 3, 65, 66, 67, 0, 0xff])
    c.texts.messages = Uint8Array.from([0, 1, 90, 0, 0xff])
    const back = readConfig(writeConfig(c)).config!
    expect([...back.bytes]).toEqual([...c.bytes])
    expect(messages(back.texts.system)).toEqual(['ABC'])
    expect(messages(back.texts.messages)).toEqual(['Z'])
    expect(back.texts.menus.length).toBe(0)
  })

  it('keeps a field this port does not name', () => {
    const c = new EditorConfig()
    // the 28 "Securite" bytes at 48, which nothing reads and a save must not
    // drop: the block IS the file
    c.bytes[50] = 0x5a
    expect(readConfig(writeConfig(c)).config!.bytes[50]).toBe(0x5a)
  })
})

describe('a text block', () => {
  it('is walked 1-based and stops at a length of $FF', () => {
    const b = Uint8Array.from([0, 2, 72, 105, 0, 0, 0, 4, 84, 104, 101, 114, 0, 0xff, 0, 3, 88, 89, 90])
    expect(messages(b)).toEqual(['Hi', '', 'Ther'])
  })
})

/** the shipped configuration, wherever this machine keeps it */
function shipped(): Uint8Array | null {
  const local = '../AMOS-Professional-Official/AMOS/APSystem/AMOSPro_Editor_Config'
  if (existsSync(local)) return new Uint8Array(readFileSync(local))
  if (!haveCorpus()) return null
  const index = corpusIndex()
  for (const [sha, path] of index) {
    if (!path.endsWith('APSystem/AMOSPro_Editor_Config')) continue
    const file = corpusFile(sha, index)
    if (file !== null) return new Uint8Array(readFileSync(file))
  }
  return null
}

describeWith('AMOSPro_Editor_Config', shipped(), (file) => {
  const c = readConfig(file).config!

  it('reads, and every field is the assembler default', () => {
    expect(readConfig(file).error).toBe(CFG.OK)
    expect(c.sx).toBe(640)
    expect(c.sy).toBe(256)
    expect(c.tabs).toBe(3)
    expect(c.quitFlags).toBe(1)
    expect(c.code).toBe('1.10')
    expect([...c.keyMap]).toEqual([...ED_KFONC])
  })

  it('writes back byte for byte, less two the machine never wrote', () => {
    const back = writeConfig(c)
    expect(back.length).toBe(18866)
    expect(file.length).toBe(18868)
    // `EdC_Save` writes the block and eight length-prefixed text blocks and
    // stops. The shipped file has two zero bytes past the end of the last one
    expect([...file.subarray(18866)]).toEqual([0, 0])
    expect([...back]).toEqual([...file.subarray(0, 18866)])
  })

  it('carries the five message tables this port generates from the source', () => {
    expect(messages(c.texts.system)).toEqual([...ED_SYSTEME])
    expect(messages(c.texts.menus)).toEqual([...EDM_MESSAGES])
    expect(messages(c.texts.messages)).toEqual([...ED_MESSAGES])
    expect(messages(c.texts.test)).toEqual([...ED_TST_MESSAGES])
    expect(messages(c.texts.run)).toEqual([...ED_RUN_MESSAGES])
  })

  it('rebuilds a text block byte for byte when the message is unchanged', () => {
    // `EdC_ChangeTexte` copies every record into a new block, so replacing a
    // message with itself is the whole format going out and coming back
    for (const name of ['system', 'menus', 'messages', 'test', 'run', 'programs'] as const) {
      const block = c.texts[name]
      const first = messages(block)[0]!
      expect([...changeMessage(block, 1, first)]).toEqual([...block])
    }
  })

  it('is a menu of 199 records, three of them stars, and 196 labels', () => {
    const defs = c.texts.menuDefs
    const labels = messages(c.texts.menus)
    expect(defs.length).toBe(199 * 8 + 2)
    const sections = readMenuDefs(defs, labels)
    expect(sections.length).toBe(4)
    expect(sections.reduce((n, m) => n + m.length, 0)).toBe(196)
    expect(labels.length).toBe(196)
    // the AMOS branch's own title and the two entries under it, which is where
    // the labels prove the records and the messages are in step
    const amos = sections[1]!
    expect(amos[0]!.title).toBe(true)
    expect(amos[0]!.label).toBe(' AMOS ')
    expect([amos[1]!.command, amos[1]!.label]).toEqual([150, ' About AMOS Professionnal '])
    expect([amos[2]!.command, amos[2]!.label]).toEqual([149, ' About Loaded Extensions  '])
  })

  it('binds F5 to the Help accessory through the user slot, not to a routine', () => {
    // `Ed_GoHelp` is `moveq #26,d2`, so F5 is command 27, and 27 is an
    // `Ed_UserMenu` slot with nothing of its own to do
    expect(ED_ROUTINES[26]).toBe('Ed_UserMenu')
    const at = (27 - 1) * 3
    expect(c.autoLoad[at]).toBe(1)
    const programs = messages(c.texts.programs)
    expect(programs[c.autoLoad[at + 1]! - 1]).toBe(
      'AMOSPro_Accessories:AMOSPro_Help/AMOSPro_Help.AMOS',
    )
  })

  it('carries three more the port had no copy of', () => {
    expect(messages(c.texts.programs).length).toBe(46)
    expect(messages(c.texts.userMenus).length).toBe(20)
    expect(messages(c.texts.menuDefs).length).toBe(26)
    expect(messages(c.texts.programs)[0]).toBe('AMOSPro_Accessories:AMOSPro_Help/AMOSPro_Help.AMOS')
  })

  it('binds 37 commands to a program, three of which are real commands', () => {
    const bound: number[] = []
    for (let n = 1; n <= 184; n++) if (c.autoLoad[(n - 1) * 3] !== 0) bound.push(n)
    expect(bound.length).toBe(37)
    // `Ed_FCall` reads Ed_AutoLoad before it reads JFonc, so these three run
    // the Help accessory from a menu and the editor command from the ZAP
    expect(bound).toContain(152)
    expect(bound).toContain(153)
    expect(bound).toContain(154)
    expect(ED_ROUTINES[151]).toBe('Ed_SaveAsName')
    expect(ED_ROUTINES[152]).toBe('Ed_CloseName')
    expect(ED_ROUTINES[153]).toBe('Ed_Rename')
    // command 27 is Help itself, and its command line is the current editor
    // line because the third byte is zero
    expect([...c.autoLoad.subarray(26 * 3, 26 * 3 + 3)]).toEqual([1, 1, 0])
  })
})

describe('the config commands', () => {
  it('save to the default name, under the system directory', () => {
    const e = open()
    expect(edCall(e, ED.CONFIG_SAVE_DEFAULT)).toBe(0)
    expect(e.name1).toBe('AMOSPro_System:AMOSPro_Editor_Config')
    const written = e.fs!.readFile(e.name1)!
    expect(readConfig(written).error).toBe(CFG.OK)
    expect(e.editor.configChanged).toBe(0)
  })

  it('are not done when the requester says no', () => {
    const e = open()
    e.dialogues = requester(() => 2)
    // EdD_SvConf, and `cmp.w #1,d0 / bne Ed_NotDone`
    expect(edCall(e, ED.CONFIG_SAVE_DEFAULT)).toBe(206)
  })

  it('load one back, and mark it as come off disc', () => {
    const e = open()
    const c = new EditorConfig()
    c.tabs = 8
    c.sy = 200
    e.fs!.writeFile('RAM:other', writeConfig(c))
    e.name1 = 'RAM:other'
    expect(edCall(e, ED.CONFIG_LOAD_AS)).toBe(0)
    expect(e.tabs).toBe(8)
    expect(e.editor.sy).toBe(200)
    // `move.b #2,EdC_Changed(a5)`
    expect(e.editor.configChanged).toBe(2)
  })

  it('give the current window the rows the new screen height leaves', () => {
    const e = open()
    const c = new EditorConfig()
    c.sy = 128
    e.fs!.writeFile('RAM:small', writeConfig(c))
    e.name1 = 'RAM:small'
    edCall(e, ED.CONFIG_LOAD_AS)
    // (128 - 16 title - 16 chrome) / 8
    expect(e.windTy).toBe(12)
    // (14 rows - 6) / 3, so a 128-line screen holds two windows
    expect(e.editor.wMax).toBe(2)
  })

  it('say so when the file is not a configuration', () => {
    const e = open()
    e.fs!.writeFile('RAM:junk', Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]))
    e.name1 = 'RAM:junk'
    expect(edCall(e, ED.CONFIG_LOAD_AS)).toBe(139)
  })

  it('offer to save a config the USER changed, and not one that was loaded', () => {
    const e = open()
    const asked: number[] = []
    e.dialogues = requester((c) => {
      asked.push(c.which)
      return 2
    })
    e.editor.configChanged = 2
    edCall(e, ED.CONFIG_LOAD_DEFAULT)
    expect(asked).not.toContain(46)
    e.editor.configChanged = 1
    edCall(e, ED.CONFIG_LOAD_DEFAULT)
    // EdD_CSaved, and `cmp.b #1,EdC_Changed(a5)` is the whole test
    expect(asked).toContain(46)
  })
})

describe('Quit Options and Autosave', () => {
  it('write the four flags straight out of the requester', () => {
    const e = open()
    e.dialogues = requester(() => 0b1011)
    expect(edCall(e, ED.QUIT_OPTIONS)).toBe(0)
    expect(e.editor.quitFlags).toBe(0b1011)
    expect(e.editor.configChanged).toBe(1)
  })

  it('turn minutes into vertical blanks, and keep both', () => {
    const e = open()
    e.dialogues = requester(() => 1, () => 5)
    expect(edCall(e, ED.SET_AUTOSAVE)).toBe(0)
    expect(e.editor.config.autoSaveMn).toBe(5)
    // minutes * 60 seconds * 50 frames
    expect(e.editor.config.autoSave).toBe(15000)
    expect(e.editor.autoSaveRef).toBe(-1)
    expect(e.editor.configChanged).toBe(1)
  })
})

describeWith('a command with a program bound to it', shipped(), (file) => {
  it('never reaches JFonc, so Save As Name runs Help instead', () => {
    const e = open()
    e.editor.config = readConfig(file).config!
    e.prog.name = 'RAM:prog.AMOS'
    e.name1 = 'RAM:prog.AMOS'
    const asked: PrgCommand[] = []
    e.editor.prgCommand = (c) => asked.push(c)
    expect(edCall(e, ED.SAVE_AS_NAME)).toBe(0)
    expect(asked.length).toBe(1)
    expect(asked[0]!.program).toBe('AMOSPro_Accessories:AMOSPro_Help/AMOSPro_Help.AMOS')
    expect(asked[0]!.line).toBe('HelpMenu')
    // and nothing was written
    expect(e.fs!.readFile('RAM:prog.AMOS')).toBeNull()
  })

  it('is the editor command again under the ZAP remote control', () => {
    const e = open()
    e.editor.config = readConfig(file).config!
    e.editor.zappeuse = true
    e.prog.name = 'RAM:prog.AMOS'
    e.name1 = 'RAM:prog.AMOS'
    e.editor.prgCommand = () => expect.unreachable('the ZAP path does not bind')
    expect(edCall(e, ED.SAVE_AS_NAME)).toBe(0)
    expect(e.fs!.readFile('RAM:prog.AMOS')).not.toBeNull()
  })
})
