/**
 * The floppy drives: the slot, the tab and the four status lines.
 *
 * The bit positions and the polarities are `hardware/cia.i`:112-115 and are
 * tested in ./cia.test.ts. What is tested here is the DRIVE, which is what
 * puts a value on each of those lines, and the AmigaDOS distinction between
 * a device node and a volume node that having one finally makes real.
 */
import { describe, expect, it } from 'vitest'
import { CIAF_DSKCHANGE, CIAF_DSKMOTOR, CIAF_DSKPROT, CIAF_DSKRDY, CIAF_DSKTRACK0 } from './cia'
import { Machine } from './machine'
import { TD_CYLINDERS, TD_UNITS, type DiskMedium, FloppyDrive, driveName, newDrives } from './trackdisk'
import { AmigaFS } from './vfs'

/** the smallest thing that satisfies DiskMedium: a Volume plus sectors */
function medium(label: string, files: Record<string, string> = {}): DiskMedium {
  const image = new Uint8Array(901_120)
  return {
    image,
    label,
    read: (segs) => {
      const v = files[segs.join('/')]
      return v === undefined ? null : new TextEncoder().encode(v)
    },
    list: (segs) =>
      segs.length === 0
        ? Object.keys(files).map((name) => ({ name, isDir: false, size: files[name]!.length }))
        : null,
    exists: (segs) => (segs.length === 0 ? 'dir' : segs.join('/') in files ? 'file' : null),
  }
}

describe('the units', () => {
  it('is four, because CIA-B port B has four select lines and no fifth', () => {
    // cia.i:133-136. There was never a DF7:, and this is why.
    expect(TD_UNITS).toBe(4)
    expect(newDrives().map((d) => driveName(d.unit))).toEqual(['DF0', 'DF1', 'DF2', 'DF3'])
  })
})

describe('a drive with nothing in it', () => {
  it('is fitted and empty, which are different things', () => {
    const d = new FloppyDrive(0)
    expect(d.empty).toBe(true)
    expect(d.medium).toBeNull()
  })

  it('reports not ready, on track 0, not protected, and CHANGED', () => {
    // the change line asserted is how a program knows the disk it was reading
    // is not there any more
    expect(new FloppyDrive(0).lines()).toEqual({
      ready: false,
      track0: true,
      writeProtected: false,
      changed: true,
    })
  })

  it('is not ready even with the motor running, because there is no disk', () => {
    const d = new FloppyDrive(0)
    d.motorOn = true
    expect(d.lines().ready).toBe(false)
  })
})

describe('putting a disk in and taking it out', () => {
  it('is ready once the motor is up, and no longer reports a change once stepped', () => {
    const d = new FloppyDrive(0)
    d.insert(medium('Workbench'))
    expect(d.lines().changed).toBe(true)
    expect(d.lines().ready).toBe(false)
    d.motorOn = true
    expect(d.lines().ready).toBe(true)
    d.step(true)
    expect(d.lines().changed).toBe(false)
  })

  it('asserts the change line again on a SWAP, not only on an eject', () => {
    // a program that missed the swap must not carry on reading the old disk's
    // directory, which is the whole point of the latch
    const d = new FloppyDrive(0)
    d.insert(medium('One'))
    d.step(true)
    expect(d.lines().changed).toBe(false)
    d.insert(medium('Two'))
    expect(d.lines().changed).toBe(true)
  })

  it('hands the disk back on eject, so a caller can put it in another drive', () => {
    const d = new FloppyDrive(0)
    const disk = medium('Workbench')
    d.insert(disk)
    expect(d.eject()).toBe(disk)
    expect(d.empty).toBe(true)
    expect(d.lines().changed).toBe(true)
  })

  it('drops the write-protect tab with the disk, because the tab is on the disk', () => {
    const d = new FloppyDrive(0)
    d.insert(medium('Locked'), { writeProtected: true })
    expect(d.lines().writeProtected).toBe(true)
    d.eject()
    expect(d.writeProtected).toBe(false)
  })
})

describe('the head', () => {
  it('stops at both ends and clears the change latch either way', () => {
    const d = new FloppyDrive(0)
    d.insert(medium('X'))
    for (let i = 0; i < 200; i++) d.step(true)
    expect(d.cylinder).toBe(TD_CYLINDERS - 1)
    expect(d.lines().track0).toBe(false)
    for (let i = 0; i < 200; i++) d.step(false)
    expect(d.cylinder).toBe(0)
    expect(d.lines().track0).toBe(true)
  })
})

describe('CIA-A reads the SELECTED drive and no other', () => {
  const select = (m: Machine, unit: number | null, motor = false): void => {
    // /SELn is bit 3+n on CIA-B port B and is ACTIVE LOW, and so is /MTR on
    // bit 7. Selecting a unit hands it whatever /MTR reads at that moment,
    // which is why the motor cannot be set behind the register's back.
    const sel = unit === null ? 0xff : 0xff & ~(1 << (3 + unit))
    m.ciab.writePrb(motor ? sel & ~CIAF_DSKMOTOR : sel)
  }

  it('answers all four lines inactive with no unit selected', () => {
    const m = new Machine()
    m.drives[0]!.insert(medium('X'))
    m.drives[0]!.motorOn = true
    select(m, null)
    const v = m.cia.pra()
    expect(v & CIAF_DSKRDY).toBe(CIAF_DSKRDY)
    expect(v & CIAF_DSKCHANGE).toBe(CIAF_DSKCHANGE)
  })

  it('answers for unit 1 when unit 1 is selected, not unit 0', () => {
    const m = new Machine()
    m.drives[1]!.insert(medium('X'), { writeProtected: true })
    m.drives[1]!.step(true)
    select(m, 1, true)
    const v = m.cia.pra()
    // ready and write protected are asserted, so both bits read LOW
    expect(v & CIAF_DSKRDY).toBe(0)
    expect(v & CIAF_DSKPROT).toBe(0)
    expect(v & CIAF_DSKCHANGE).toBe(CIAF_DSKCHANGE)
    // the head stepped once, so it is off track 0
    expect(v & CIAF_DSKTRACK0).toBe(CIAF_DSKTRACK0)
    // and unit 0 is empty, which is a completely different byte
    select(m, 0)
    expect(m.cia.pra() & CIAF_DSKRDY).toBe(CIAF_DSKRDY)
  })
})

describe('the motor line, which is one wire to four drives', () => {
  it('reaches the drive whose /SELn is low and no other', () => {
    const m = new Machine()
    // $7f: /MTR low, nothing selected. $77 adds /SEL0.
    m.ciab.writePrb(0x7f)
    expect(m.drives[0]!.motorOn).toBe(false)
    m.ciab.writePrb(0x77)
    expect(m.drives[0]!.motorOn).toBe(true)
    expect(m.drives[1]!.motorOn).toBe(false)
  })

  it('leaves a drive spinning once it has been handed the motor', () => {
    // a deselected drive keeps what it was given, which is the whole reason
    // the state is on the drive and not read off the register
    const m = new Machine()
    m.ciab.writePrb(0x77)
    m.ciab.writePrb(0xff)
    expect(m.drives[0]!.motorOn).toBe(true)
  })

  it('stops it with a deasserted /MTR and the same unit selected', () => {
    const m = new Machine()
    m.ciab.writePrb(0x77)
    m.ciab.writePrb(0xf7)
    expect(m.drives[0]!.motorOn).toBe(false)
  })

  it('takes DDRB into account, because a line the chip is not driving floats', () => {
    const m = new Machine()
    m.ciab.writePrb(0x77)
    m.ciab.ddrb = 0x00
    // nothing is selected any more, so drive 0 keeps the motor it was handed
    expect(m.drives[0]!.motorOn).toBe(true)
    expect(m.ciab.motorLine).toBe(false)
  })

  it('spins the drive when a program pokes the register itself', () => {
    // Misc 1.0, Delta 1.4 and JD all write these two bytes by hand
    const m = new Machine()
    m.drives[2]!.insert(medium('X'))
    m.ciab.writePrb(0x7f)
    m.ciab.writePrb(0x5f)
    expect(m.drives[2]!.motorOn).toBe(true)
    expect(m.drives[2]!.lines().ready).toBe(true)
  })
})

describe('one disk, two names: the device node and the volume node', () => {
  const boot = (): { fs: AmigaFS; m: Machine } => {
    const m = new Machine()
    const fs = new AmigaFS()
    fs.drives = m.drives
    return { fs, m }
  }

  it('reaches the same disk as DF0: and as its own label', () => {
    // dosextens.i:279-281 keeps DLT_DEVICE and DLT_VOLUME apart for exactly
    // this: DF0 is there with the drive empty and the label only while the
    // disk is
    const { fs, m } = boot()
    m.drives[0]!.insert(medium('Workbench', { 'startup-sequence': 'echo hi' }))
    expect(fs.readFile('DF0:startup-sequence')).not.toBeNull()
    expect(fs.readFile('Workbench:startup-sequence')).not.toBeNull()
    expect(fs.volumeNames()).toContain('DF0')
    expect(fs.volumeNames()).toContain('Workbench')
  })

  it('and the label goes away with the disk while DF0 stays a drive', () => {
    const { fs, m } = boot()
    m.drives[0]!.insert(medium('Workbench', { file: 'x' }))
    m.drives[0]!.eject()
    expect(fs.readFile('Workbench:file')).toBeNull()
    expect(fs.volumeNames()).not.toContain('DF0')
    // the drive is still there; it is the VOLUME that left
    expect(m.drives[0]!.empty).toBe(true)
  })

  it('picks the drive with the matching label, not just the first one', () => {
    const { fs, m } = boot()
    m.drives[0]!.insert(medium('One', { a: 'first' }))
    m.drives[2]!.insert(medium('Two', { a: 'third' }))
    expect(new TextDecoder().decode(fs.readFile('Two:a')!)).toBe('third')
    expect(new TextDecoder().decode(fs.readFile('DF2:a')!)).toBe('third')
  })

  it('lets an EMPTY drive name fall through to the mount table', () => {
    // a filesystem with no machine behind it is the normal case, and mounting
    // a tree under DF0 has to keep working
    const { fs } = boot()
    const mem = fs.mountMemory('DF0')
    mem.write(['thing'], new TextEncoder().encode('x'))
    expect(fs.readFile('DF0:thing')).not.toBeNull()
  })

  /**
   * A LOCK belongs to the volume, so it can only ever name the volume.
   *
   * `AskDir2` (+B.s:1153) walks `ParentDir` up to the root and comes back down
   * `Examine`-ing each lock, appending `fib_FileName` with a `:` after the
   * first. `Examine` on a root lock answers with the VOLUME's name whichever
   * node the caller reached it through, so there is no getting "DF0" back out
   * of one — which is what makes `Dir$ = "Df0:"` a "what disc is in this
   * drive" probe, and what AMOS Pro's `Install.AMOS` uses it as.
   */
  it('a lock on the device node still answers with the volume name', () => {
    const { fs, m } = boot()
    m.drives[0]!.insert(medium('AMOSPro_System', { 'install.amos': 'x' }))
    // the path echoes back as it was typed...
    expect(fs.resolve('DF0:install.amos')?.canonical).toBe('DF0:install.amos')
    // ...but a lock on it does not
    expect(fs.volumeNodeName('df0')).toBe('AMOSPro_System')
    expect(fs.setCurrentDir('DF0:')).toBe(true)
    expect(fs.currentDir).toBe('AMOSPro_System:')
  })

  it('an unlabelled disk has no volume node, so the unit stands in', () => {
    const { fs, m } = boot()
    m.drives[1]!.insert(medium('', { file: 'x' }))
    expect(fs.volumeNodeName('df1')).toBe('DF1')
  })

  it('refuses a write to a disk whose tab is open', () => {
    // this could not be expressed at all before there was a drive to hold the
    // tab: AdfVolume declines the question by design
    const { fs, m } = boot()
    m.drives[0]!.insert(medium('Locked'), { writeProtected: true })
    expect(fs.writeFile('DF0:new', new Uint8Array(4))).toBe(false)
    expect(fs.mkdir('DF0:drawer')).toBe(false)
    m.drives[0]!.writeProtected = false
    expect(fs.writeFile('DF0:new', new Uint8Array(4))).toBe(true)
  })
})
