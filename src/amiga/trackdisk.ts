/**
 * A floppy drive: the thing a disk goes into, as distinct from the disk.
 *
 * The port has had a disk since `./adf.ts` was written and never had a drive.
 * An image was mounted under the name `DF0` and four separate places then
 * reached past the filesystem for its sectors with the same duck-typed cast:
 *
 *     const adf = vol as { image?: Uint8Array; invalidate?: () => void } | null
 *
 * in `Runtime.devTransfer` for `trackdisk.device`, in JD's `jdDisk`, and
 * twice in Explode. A mounted name is not a drive, and the difference is not
 * pedantry. It is why:
 *
 *   - a disk could not be EJECTED, because a name is not a slot
 *   - `DF0:` and the disk's own label were two mounts of one disk, or one
 *     mount under whichever name the caller picked
 *   - WRITE PROTECT had nowhere to live. `AdfVolume.dosInfo` says so in as
 *     many words: *"There is no write-protect state here, because that
 *     belongs to the DRIVE"*, and so the tab was simply not modelled and
 *     every write to every disk succeeded.
 *   - CIA-A's four floppy status lines had nothing behind them
 *
 * ## Device and volume are two nodes, and AmigaDOS agrees
 *
 * `dosextens.i`:279-281 gives the device list three node types, `DLT_DEVICE`,
 * `DLT_DIRECTORY` and `DLT_VOLUME`, and a floppy uses two of them at once. The
 * DEVICE node is named DF0 and never goes away; the VOLUME node is named after
 * whatever disk is in the drive and comes and goes with it. That is why both
 * `DF0:` and `Workbench3.1:` resolve on a real machine, and `./vfs.ts` does
 * the same thing now by asking the drives before the mount table.
 *
 * ## How deep this goes
 *
 * As deep as the callers need and no deeper, which is the rule this layer
 * runs on. `trackdisk.device` in this port serves whole-image reads and
 * writes at a byte offset, so a drive holds sectors, a head position and the
 * four status lines. There is no MFM encoding, no sector gap, no index pulse
 * and no rotational latency, because nothing asks: SLN's `S Disk Read`, JD's
 * sector keywords and Explode's all take a byte offset into the image.
 *
 * The head position exists because /TRK0 is one of the four lines and a step
 * clears the disk-change latch. It moves when something steps it, and today
 * nothing does.
 *
 * ## What is read and what is modelled
 *
 * `hardware/cia.i`:112-115 gives the four lines, their bit positions and
 * their asterisks, so which bit and which polarity are read off a file in the
 * corpus. What each line MEANS about a drive is not in anything vendored
 * here: that /CHNG stays asserted until the head steps, and that /RDY follows
 * the motor, are the drive's behaviour and are modelled. JD's own port note
 * draws the same line about DDRB, *"6526 behaviour rather than anything the
 * source states"*.
 */
import type { DiskLines } from './cia'
import type { Device } from './device'
import type { Volume } from './vfs'

/**
 * The four units `trackdisk.device` supports.
 *
 * Four is the real ceiling and not a convenience: `cia.i`:133-136 has exactly
 * four /SELn lines on CIA-B port B, so a fifth drive has no wire to be
 * selected by. `../amiga/vfs.ts` already listed DF0 to DF3 for the same
 * reason, with a comment saying there was never a DF7.
 */
export const TD_UNITS = 4

/** cylinders on an Amiga floppy: 80 per surface, 0 to 79 */
export const TD_CYLINDERS = 80

/**
 * What is in a drive.
 *
 * A `Volume`, because the filesystem reads files out of it, AND a sector
 * image, because `trackdisk.device` reads blocks out of it without asking the
 * filesystem anything. `AdfVolume` is both already and satisfies this without
 * changing: an ADF *is* the sectors.
 */
export interface DiskMedium extends Volume {
  /** the raw sector image, live: a write through it is a raw device write */
  readonly image: Uint8Array
  /** the volume label off the root block, which names the VOLUME node */
  readonly label: string
  /** the filesystem's cached walks are stale after a raw write */
  invalidate?(): void
}

/** how a disk went in: the tab is on the disk, the drive only reads it */
export interface InsertOptions {
  writeProtected?: boolean
}

/**
 * One drive, DF0: to DF3:.
 *
 * The unit is fixed at construction because it is which /SELn line the drive
 * answers, which is a wire and not a setting.
 */
export class FloppyDrive implements Device {
  readonly kind = 'floppy' as const

  /**
   * What a hardware page prints.
   *
   * Generic on purpose. A host that knows it is modelling a particular
   * mechanism can say so, and nothing a program can read tells one 880K
   * drive from another.
   */
  readonly name = 'floppy drive'

  /** which /SELn line on CIA-B port B this drive answers, `cia.i`:133-136 */
  readonly unit: number

  private disk: DiskMedium | null = null

  /**
   * The write-protect tab.
   *
   * On the DRIVE and not on the image, because the drive is what reads the
   * tab and the tab is what the /WPRO line reports. An ADF carries no such
   * bit, which is exactly why `AdfVolume` refused to answer the question.
   */
  writeProtected = false

  /**
   * Is the motor spinning?
   *
   * Held here rather than read off the register because /MTR is one wire to
   * four drives: a write that pulls this unit's /SELn low hands it the motor
   * state and the drive keeps it. `../amiga/cia.ts`'s `latch` is the wire.
   */
  motorOn = false

  /** where the head is, 0 to 79. /TRK0 is this being zero. */
  cylinder = 0

  /**
   * The disk-change latch.
   *
   * Asserted while the drive is empty, and asserted after a disk goes in
   * until the head is stepped. That is what makes a program's "is there a
   * disk?" test work: it steps and looks again. MODELLED, see the header.
   */
  private change = true

  /**
   * How many times a disk has gone in or come out.
   *
   * `TD_CHANGENUM`, which SLN's `=S Disk Changes` reads through routine 76.
   * Its source's comment calls the answer *"number of disk changes*2"*, which
   * is an observation about a disk being swapped rather than anything the
   * counter does: it moves on insertion and on removal alike, so a swap moves
   * it twice.
   */
  changes = 0

  constructor(unit: number) {
    this.unit = unit
  }

  /** what is in the drive, or null */
  get medium(): DiskMedium | null {
    return this.disk
  }

  get empty(): boolean {
    return this.disk === null
  }

  /**
   * Put a disk in.
   *
   * The change latch is asserted whether or not there was already a disk in
   * there, because a swap is a change and a program that missed the eject
   * must not carry on reading the old one's directory.
   */
  insert(disk: DiskMedium, opts: InsertOptions = {}): void {
    this.disk = disk
    this.writeProtected = opts.writeProtected ?? false
    this.change = true
    this.changes++
  }

  /** take the disk out, and hand it back so a caller can put it elsewhere */
  eject(): DiskMedium | null {
    const was = this.disk
    this.disk = null
    this.writeProtected = false
    this.change = true
    if (was) this.changes++
    return was
  }

  /**
   * Move the head one cylinder, and clear the change latch.
   *
   * The clear happens on any step, including one that goes nowhere because
   * the head is already at an end. That is the point of the latch: the OS
   * steps to find out whether the drive is still holding the disk it thinks
   * it is.
   */
  step(inward: boolean): void {
    this.cylinder = Math.max(0, Math.min(TD_CYLINDERS - 1, this.cylinder + (inward ? 1 : -1)))
    this.change = false
  }

  /**
   * The four lines this drive puts on CIA-A while it is the selected unit,
   * in positive logic. `./cia.ts` inverts them.
   */
  lines(): DiskLines {
    return {
      // /RDY is the motor up to speed with a disk under it
      ready: this.disk !== null && this.motorOn,
      track0: this.cylinder === 0,
      writeProtected: this.disk !== null && this.writeProtected,
      changed: this.disk === null || this.change,
    }
  }
}

/** the four drives a machine has, DF0: to DF3: */
export const newDrives = (): FloppyDrive[] =>
  Array.from({ length: TD_UNITS }, (_, unit) => new FloppyDrive(unit))

/** `DF0`, `DF1`, ... — the DEVICE node's name, which never changes */
export const driveName = (unit: number): string => `DF${unit}`
