import { describe, expect, it } from 'vitest'
import { AmigaFS } from '../runtime/vfs'
import { baseName, deleteEntry, moveEntry, newDrawer, relabelVolume, renameEntry } from './filemanager'

const enc = (s: string): Uint8Array => Uint8Array.from([...s].map((c) => c.charCodeAt(0)))

function makeFs(): AmigaFS {
  const fs = new AmigaFS()
  const dh0 = fs.mountMemory('DH0')
  dh0.write(['Games', 'Zybex', 'level1.iff'], enc('LEVEL1'))
  dh0.write(['Games', 'Zybex', 'Music', 'theme.abk'], enc('THEME'))
  dh0.write(['readme'], enc('HI'))
  fs.mountMemory('RAM')
  fs.currentDir = 'DH0:'
  return fs
}

describe('the Files panel write operations', () => {
  it('renames in place, keeping the entry where it is', () => {
    const fs = makeFs()
    expect(renameEntry(fs, 'DH0:Games/Zybex', 'Xybez').ok).toBe(true)
    expect(fs.readFile('DH0:Games/Xybez/Music/theme.abk')).toEqual(enc('THEME'))
    expect(renameEntry(fs, 'DH0:readme', 'read.me').ok).toBe(true)
    expect(fs.readFile('DH0:read.me')).toEqual(enc('HI'))
  })

  it('refuses names with a separator in them, and clashes', () => {
    const fs = makeFs()
    expect(renameEntry(fs, 'DH0:readme', 'a/b')).toEqual({ ok: false, message: '"a/b" can\'t contain : or /' })
    expect(renameEntry(fs, 'DH0:readme', 'RAM:x').ok).toBe(false)
    expect(renameEntry(fs, 'DH0:readme', '  ')).toEqual({ ok: false, message: 'a name is needed' })
    fs.writeFile('DH0:taken', enc('T'))
    expect(renameEntry(fs, 'DH0:readme', 'taken')).toEqual({ ok: false, message: 'taken already exists' })
    expect(fs.readFile('DH0:readme')).toEqual(enc('HI')) // untouched
  })

  it('moves entries between drawers', () => {
    const fs = makeFs()
    expect(moveEntry(fs, 'DH0:readme', 'DH0:Games/Zybex').ok).toBe(true)
    expect(fs.readFile('DH0:Games/Zybex/readme')).toEqual(enc('HI'))
    expect(fs.exists('DH0:readme')).toBeNull()
    // a whole drawer, contents and all
    expect(moveEntry(fs, 'DH0:Games/Zybex/Music', 'DH0:').ok).toBe(true)
    expect(fs.readFile('DH0:Music/theme.abk')).toEqual(enc('THEME'))
  })

  it('copies across volumes, since AmigaDOS Rename() can not', () => {
    const fs = makeFs()
    expect(moveEntry(fs, 'DH0:Games/Zybex', 'RAM:').ok).toBe(true)
    expect(fs.readFile('RAM:Zybex/Music/theme.abk')).toEqual(enc('THEME'))
    expect(fs.exists('DH0:Games/Zybex')).toBeNull()
  })

  it('will not swallow a drawer into itself or overwrite', () => {
    const fs = makeFs()
    expect(moveEntry(fs, 'DH0:Games', 'DH0:Games/Zybex')).toEqual({
      ok: false,
      message: "can't move Games into itself",
    })
    expect(moveEntry(fs, 'DH0:readme', 'DH0:')).toEqual({ ok: false, message: 'readme is already there' })
    expect(moveEntry(fs, 'DH0:readme', 'DH0:Games/Zybex/level1.iff')).toEqual({
      ok: false,
      message: 'DH0:Games/Zybex/level1.iff is not a drawer',
    })
    fs.writeFile('DH0:Games/readme', enc('OTHER'))
    expect(moveEntry(fs, 'DH0:readme', 'DH0:Games').ok).toBe(false)
    expect(fs.readFile('DH0:Games/readme')).toEqual(enc('OTHER')) // not clobbered
  })

  it('deletes files, empty drawers, and full ones only when asked', () => {
    const fs = makeFs()
    expect(deleteEntry(fs, 'DH0:Games/Zybex', false)).toEqual({ ok: false, message: 'Zybex is not empty' })
    expect(deleteEntry(fs, 'DH0:Games/Zybex', true).ok).toBe(true)
    expect(fs.readFile('DH0:Games/Zybex/Music/theme.abk')).toBeNull()
    expect(deleteEntry(fs, 'DH0:Games', false).ok).toBe(true) // now empty
    expect(deleteEntry(fs, 'DH0:Games', false).ok).toBe(false) // and gone
  })

  it('creates drawers', () => {
    const fs = makeFs()
    expect(newDrawer(fs, 'DH0:Games', 'New').ok).toBe(true)
    expect(fs.exists('DH0:Games/New')).toBe('dir')
    expect(newDrawer(fs, 'DH0:Games', 'New').ok).toBe(false)
    expect(newDrawer(fs, 'DH0:Games', 'a:b').ok).toBe(false)
  })

  it('relabels volumes', () => {
    const fs = makeFs()
    fs.setCurrentDir('DH0:Games')
    expect(relabelVolume(fs, 'DH0:', 'Work')).toEqual({ ok: true, message: 'DH0: is now Work:' })
    expect(fs.currentDir).toBe('Work:Games')
    expect(fs.readFile('Work:readme')).toEqual(enc('HI'))
    expect(relabelVolume(fs, 'Work', 'RAM').ok).toBe(false) // name taken
  })

  it('takes the last component of a path', () => {
    expect(baseName('DH0:Games/Zybex')).toBe('Zybex')
    expect(baseName('DH0:readme')).toBe('readme')
    expect(baseName('DH0:')).toBe('')
  })
})
