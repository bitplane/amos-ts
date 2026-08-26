/**
 * `LIBS:`, and why a modelled library has to be visible as a file.
 *
 * `OpenLibrary` answering yes is only half of what a program asks. The other
 * half is `Exist("LIBS:x.library")`, which is the Amiga idiom for "is it
 * installed" and is what guards the call. AMOSPro_Delta's demo is the case:
 *
 *     If Exist("libs:reqtools.library")
 *        REQUESTER=Delta Reqtools Requester(...)
 *     Else
 *        _SCROLL["Reqtools.library not found"]
 *
 * and it took the else arm while `./reqtools.ts` sat underneath, fully ported.
 */
import { describe, expect, it } from 'vitest'
import { AmigaFS } from './vfs'
import { modelledLibraries, openLibrary } from './exec'

const names = (): string[] => modelledLibraries().map((l) => l.name)

function machine(): AmigaFS {
  const fs = new AmigaFS()
  fs.mountSystem(names())
  return fs
}

describe('the libraries the machine models are in LIBS:', () => {
  it('answers Exist for every one OpenLibrary answers for', () => {
    const fs = machine()
    for (const name of names()) {
      expect(openLibrary(name), name).not.toBe(0)
      expect(fs.exists(`LIBS:${name}`), name).not.toBe(null)
    }
  })

  it('says no to one the machine does not model, and holds nothing extra', () => {
    const fs = machine()
    expect(fs.exists('libs:banana.library')).toBe(null)
    expect(openLibrary('banana.library')).toBe(0)
    // `req.library` is the real case: six corpus programs use this idiom and
    // one of them asks for that. It is not modelled, `OpenLibrary` refuses
    // it, and `Exist` has to agree -- the drawer is the OpenLibrary list and
    // nothing else.
    expect(fs.exists('libs:req.library')).toBe(null)
    for (const e of fs.listDir('LIBS:') ?? []) expect(openLibrary(e.name), e.name).not.toBe(0)
  })

  it('matches the way AmigaDOS does, without regard to case', () => {
    // `Libs:XPKMaster.Library` is how one corpus program spells it
    const fs = machine()
    expect(fs.exists('Libs:XPKMaster.Library')).not.toBe(null)
  })

  it('is an assign onto SYS:Libs, which is what an Amiga has', () => {
    // `Devices` lists the volume and `Assigns` lists the name, rather than a
    // made-up disk called LIBS
    const fs = machine()
    expect(fs.volumeNames()).toContain('SYS')
    expect(fs.volumeNames()).not.toContain('LIBS')
    expect(fs.resolve('LIBS:reqtools.library')?.canonical).toBe('SYS:Libs/reqtools.library')
  })

  /**
   * DEVIATION: the markers are empty. What is modelled is a library, not a
   * file holding one, and no byte of the real thing is ours to invent.
   */
  it('holds markers and not libraries', () => {
    const fs = machine()
    expect(fs.readFile('LIBS:reqtools.library')?.length).toBe(0)
  })

  it('mounts once, however many times it is asked', () => {
    const fs = machine()
    fs.mountSystem(names())
    expect(fs.volumeNames().filter((v) => v === 'SYS')).toHaveLength(1)
    expect(fs.exists('LIBS:asl.library')).not.toBe(null)
  })
})
