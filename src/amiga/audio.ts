/**
 * Paula's audio half, as a fitted part.
 *
 * A chip and not a socket, so the slot holding it has no "nothing" in its
 * list: an Amiga without Paula is not an Amiga with the sound removed, it is a
 * different machine. What varies between models is not the chip but the analog
 * stage after it, and that is the whole reason this is a device with a setting
 * rather than a constant.
 *
 * ## Two filters, one switch
 *
 * The LED filter is a 3.3 kHz low-pass switched by CIA-A PRA bit 1, the same
 * bit that drives the power light, which is why a program that dims the LED
 * also brightens the audio. `../amiga/paula.ts` holds its state, because it is
 * the chip's pin and not this object's.
 *
 * The other one has no switch at all. Every Amiga has a fixed RC low-pass
 * after the DAC, and it is a different part in different models: about 4.4 kHz
 * on the older machines and about 30 kHz on AGA. `./mixer.ts` names both
 * corners and is blunt about their evidence, which is community figures rather
 * than a schematic anybody here has read.
 *
 * The default is 'a500', because that is the machine nearly every AMOS program
 * was written on and heard on.
 */
import type { Device } from './device'
import type { AmigaAudioModel } from './mixer'

export class PaulaAudio implements Device {
  readonly kind = 'audio' as const
  readonly name = 'Paula'

  /**
   * Which machine's output stage, which sets the fixed pole.
   *
   * Audible rather than cosmetic. An A1200 playing 8-channel OctaMED is bright
   * and an A500 playing the same file is not, because the fixed pole is the
   * only thing above Paula's images at 12.8 kHz and up.
   */
  model: AmigaAudioModel = 'a500'
}
