import { imagesCollide } from './objects'
import type { BankImage, Bob } from './objects'
import type { Runtime } from './runtime'

/**
 * Collision detection: Bob Col, Sprite Col, Bobsprite Col, Spritebob Col,
 * Set Hardcol / =Hardcol and the =Col() bits they all leave behind.
 *
 * Two mechanisms with nothing in common but their answer. The four ...Col
 * checks are AMOS's own software test (ColRout +W.s:179) — raw hot spots and
 * boxes, then a mask AND. Hardcol is the *hardware* collision register pair,
 * CLXCON/CLXDAT, where sprites are grouped in pairs and the playfield takes
 * part through a plane mask. They share exactly one thing, `colSet`: whichever
 * ran last decides what =Col(n) answers, which is why they belong together and
 * why neither of them belongs in the compositor.
 *
 * `rt` is Runtime for its object and screen state — nine members, all read
 * only: bobs, hwSprites, spriteBank, screens/screen, spriteUpdateOn,
 * frozenSprites, and spriteChannels/frontAt from the display.
 */
export class Collide {
  constructor(private readonly rt: Runtime) {}

  /** objects hit by the last collision check of any kind, read by =Col() */
  readonly colSet = new Set<number>()

  /**
   * The un-flipped collision image: ColRout (+W.s:179) strips the flip
   * flags, so collision always uses the raw hot spot and box even when the
   * object is drawn flipped.
   */
  private colImage(image: number): BankImage | undefined {
    return this.rt.spriteBank?.image(image & 0x3fff)
  }

  /** Bob n vs bobs first..last on the same screen; fills colSet. -1/0. */
  bobColCheck(n: number, first = -Infinity, last = Infinity): number {
    this.colSet.clear()
    const me = this.rt.bobs.get(n)
    const img = me && this.colImage(me.image)
    if (!me || !img) return 0
    for (const other of this.rt.bobs.values()) {
      if (other.n === n || other.n < first || other.n > last || other.screen !== me.screen) continue
      const oimg = this.colImage(other.image)
      if (oimg && imagesCollide(img, me.x, me.y, oimg, other.x, other.y)) this.colSet.add(other.n)
    }
    return this.colSet.size > 0 ? -1 : 0
  }

  spriteColCheck(n: number, first = -Infinity, last = Infinity): number {
    this.colSet.clear()
    const me = this.rt.hwSprites.get(n)
    const img = me && this.colImage(me.image)
    if (!me || !img) return 0
    for (const other of this.rt.hwSprites.values()) {
      if (other.n === n || other.n < first || other.n > last) continue
      const oimg = this.colImage(other.image)
      if (oimg && imagesCollide(img, me.x, me.y, oimg, other.x, other.y)) this.colSet.add(other.n)
    }
    return this.colSet.size > 0 ? -1 : 0
  }

  /**
   * Map a bob's screen position into hardware-sprite coordinate space
   * (CXyS +W.s:10840): X is halved in HIRES, Y is halved when INTERLACED —
   * one hardware unit is one lowres pixel. Sprites already live in hardware
   * coords, so this puts the bob alongside them for collision.
   */
  private bobToHw(bob: Bob): { x: number; y: number } {
    const s = this.rt.screens.get(bob.screen) ?? this.rt.screen
    return {
      x: (s.hires ? bob.x >> 1 : bob.x) + s.displayX,
      y: (s.laced ? bob.y >> 1 : bob.y) + s.displayY,
    }
  }

  /** Bob n vs hardware sprites first..last (Bobsprite Col, GoToSp +W.s:415). */
  bobSpriteColCheck(n: number, first = 0, last = 63): number {
    this.colSet.clear()
    const me = this.rt.bobs.get(n)
    const img = me && this.colImage(me.image)
    if (!me || !img) return 0
    const p = this.bobToHw(me)
    for (const sp of this.rt.hwSprites.values()) {
      if (sp.n < first || sp.n > last) continue
      const oimg = this.colImage(sp.image)
      if (oimg && imagesCollide(img, p.x, p.y, oimg, sp.x, sp.y)) this.colSet.add(sp.n)
    }
    return this.colSet.size > 0 ? -1 : 0
  }

  /** Hardware sprite n vs bobs first..last (Spritebob Col, SpToBb +W.s:526). */
  spriteBobColCheck(n: number, first = 0, last = 10000): number {
    this.colSet.clear()
    const me = this.rt.hwSprites.get(n)
    const img = me && this.colImage(me.image)
    if (!me || !img) return 0
    for (const bob of this.rt.bobs.values()) {
      if (bob.n < first || bob.n > last) continue
      const oimg = this.colImage(bob.image)
      const p = this.bobToHw(bob)
      if (oimg && imagesCollide(img, me.x, me.y, oimg, p.x, p.y)) this.colSet.add(bob.n)
    }
    return this.colSet.size > 0 ? -1 : 0
  }

  /**
   * CLXCON, the collision control register (HColSet +W.s:10018).
   *
   * Set Hardcol enable,match writes it: bits 12-15 enable the odd sprite
   * of each pair (AMOS always sets all four), bits 6-11 say which
   * bitplanes take part, bits 0-5 the value those planes must carry for a
   * playfield pixel to count as solid.
   */
  clxcon = 0

  /**
   * CLXDAT for the current sprite and playfield positions (HColGet
   * +W.s:115).
   *
   * Bit 0 is playfield 1 against playfield 2; bits 1-4 are sprite pairs
   * 0-3 against playfield 1 and bits 5-8 the same against playfield 2;
   * bits 9-14 are the six pair-against-pair combinations. That is the
   * layout HColT (+W.s:159) indexes, and it is the hardware's.
   *
   * Deviation: the real register accumulates whatever the beam passed over
   * during the frame and clears when read. This samples the positions as
   * they stand at the call. For the way programs use it — move, Wait Vbl,
   * test — the two agree; for a sprite that has already been moved on
   * within the same frame they do not.
   */
  hardcolData(): number {
    const en = (this.clxcon >> 6) & 0x3f
    const mv = this.clxcon & 0x3f
    const ensp = (this.clxcon >> 12) & 0xf
    // sprite coverage per pair, as hardware pixel keys
    const cover: Set<number>[] = [new Set(), new Set(), new Set(), new Set()]
    const sprites = this.rt.spriteUpdateOn ? [...this.rt.hwSprites.values()] : (this.rt.frozenSprites ?? [])
    const channels = this.rt.spriteChannels(sprites)
    for (const sp of sprites) {
      const img = this.rt.spriteBank?.image(sp.image)
      if (!img) continue
      const ch = channels.get(sp.n) ?? 6
      // an odd channel only takes part when its ENSPn bit is set
      if (ch & 1 && !(ensp & (1 << (ch >> 1)))) continue
      const set = cover[ch >> 1]!
      const x0 = sp.x - img.hotX
      const y0 = sp.y - img.hotY
      for (let y = 0; y < img.height; y++) {
        for (let x = 0; x < img.width; x++) {
          if (img.pixels[y * img.width + x] !== 0) set.add((y0 + y) * 1024 + (x0 + x))
        }
      }
    }
    // a playfield pixel is solid when every enabled plane matches
    const solid = (pix: number, planes: number[]): boolean => {
      let e = 0
      let m = 0
      for (let i = 0; i < planes.length; i++) {
        if (en & (1 << planes[i]!)) e |= 1 << i
        if (mv & (1 << planes[i]!)) m |= 1 << i
      }
      return ((pix ^ m) & e) === 0
    }
    const ODD = [0, 2, 4]
    const EVEN = [1, 3, 5]
    const ALL = [0, 1, 2, 3, 4, 5]
    /** the playfield values at a hardware pixel, or null outside every screen */
    const pfAt = (hx: number, hy: number): { p1: boolean; p2: boolean; dual: boolean } | null => {
      const f = this.rt.frontAt(hy)
      if (!f) return null
      const back = !f.dualIsBack && f.dualPartner !== null ? (this.rt.screens.get(f.dualPartner) ?? null) : null
      const sx = f.hardToScreenX(hx)
      const sy = f.hardToScreenY(hy)
      if (sx < 0 || sy < 0 || sx >= f.width || sy >= f.height) return null
      const v1 = f.displayBuffer[sy * f.width + sx]! & 63
      if (!back) return { p1: solid(v1, ALL), p2: false, dual: false }
      const v2 = sx < back.width && sy < back.height ? back.displayBuffer[sy * back.width + sx]! & 7 : 0
      return { p1: solid(v1 & 7, ODD), p2: solid(v2, EVEN), dual: true }
    }
    let dat = 0
    // pair against pair — HColT's first four columns
    const PAIRBIT = [
      [-1, 9, 10, 11],
      [9, -1, 12, 13],
      [10, 12, -1, 14],
      [11, 13, 14, -1],
    ]
    for (let a = 0; a < 4; a++) {
      for (let b = a + 1; b < 4; b++) {
        for (const k of cover[a]!) {
          if (cover[b]!.has(k)) {
            dat |= 1 << PAIRBIT[a]![b]!
            break
          }
        }
      }
    }
    // pair against playfield — columns 4 and 5 of HColT are bits 1+p and 5+p
    for (let p = 0; p < 4; p++) {
      for (const k of cover[p]!) {
        const pf = pfAt(k % 1024, Math.floor(k / 1024))
        if (!pf) continue
        if (pf.p1) dat |= 1 << (1 + p)
        if (pf.p2) dat |= 1 << (5 + p)
        if (dat & (1 << (1 + p)) && dat & (1 << (5 + p))) break
      }
    }
    // playfield against playfield, wherever a dual pair is on screen
    outer: for (const s of this.rt.screens.values()) {
      if (!s.visible || s.dualIsBack || s.dualPartner === null) continue
      for (let y = 0; y < s.height; y++) {
        for (let x = 0; x < s.width; x++) {
          const pf = pfAt(s.displayX + (s.hires ? x >> 1 : x), s.displayY + y)
          if (pf?.dual && pf.p1 && pf.p2) {
            dat |= 1
            break outer
          }
        }
      }
    }
    return dat
  }

  /**
   * =Hardcol(n) (FnHardcol +Lib.s:12353 -> HColGet +W.s:115).
   *
   * n < 0 answers the playfield-against-playfield bit. Otherwise it walks
   * HColT's row for sprite n's pair, building the two-bits-per-entry word
   * the 68k byte-swaps into T_TColl for Col() to read, and returns true
   * only when a *sprite* collision was among them — a playfield hit fills
   * in the Col() bits without making the function itself true.
   */
  hardcol(n: number): number {
    const dat = this.hardcolData()
    this.colSet.clear()
    if (n < 0) return dat & 1 ? -1 : 0
    const HCOL_T = [
      [-1, 9, 10, 11, 1, 5],
      [9, -1, 12, 13, 2, 6],
      [10, 12, -1, 14, 3, 7],
      [11, 13, 14, -1, 4, 8],
    ]
    const row = HCOL_T[(n & 6) >> 1]!
    let hit = 0
    for (let i = 0; i < row.length; i++) {
      const bit = row[i]!
      if (bit < 0 || !(dat & (1 << bit))) continue
      // two adjacent Col() objects per entry, as the %11 mask gives
      this.colSet.add(i * 2)
      this.colSet.add(i * 2 + 1)
      if (i < 4) hit = -1
    }
    return hit
  }

  /** =Col(n): >=0 membership (-1/0); <0 the first colliding object number. */
  colGet(n: number): number {
    if (n < 0) {
      for (const m of this.colSet) return m
      return 0
    }
    return this.colSet.has(n) ? -1 : 0
  }
}
