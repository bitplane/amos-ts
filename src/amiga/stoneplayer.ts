/** Shared state boundary for stoneplayer.library's unavailable decoder. */
export class StonePlayer {
  installed = false
  playing = false
  start = 0
  end = 0
  leftVolume = 64
  rightVolume = 64
  balance = 0
  speed = 0
  mixPeriod = 124

  install(): number { this.installed = true; this.playing = false; return 1 }
  remove(): void { this.stop(); this.installed = false; this.start = 0; this.end = 0 }
  stop(): void { this.playing = false }

  play(start: number, end: number): number {
    if (start === 0) return 250
    if (end === 0) return 249
    if (!this.installed) return 0
    this.start = start >>> 0; this.end = end >>> 0; this.playing = true
    return 0
  }

  check(start: number, end: number): number {
    return this.installed && start !== 0 && end > start ? -1 : 0
  }

  setMixFrequency(frequency: number): void {
    if (frequency <= 0) return
    this.mixPeriod = Math.max(124, Math.trunc(0x3548de / frequency))
  }
}
