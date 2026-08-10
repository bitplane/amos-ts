/**
 * The baseline JPEG codec.
 *
 * Two things are worth knowing about how this is checked. The reference files
 * are made by libjpeg-turbo through Pillow and pasted in base64, because
 * fixtures/ is gitignored and a codec test that ships no other encoder's output
 * only proves it agrees with itself. And where the comparison is against
 * libjpeg's own decode of the same bytes rather than against the original
 * picture, the tolerance is 1: a JPEG has exactly one right answer to within
 * IDCT rounding, so anything looser would be hiding something.
 *
 * The 4:2:0 files are deliberately grey ramps. libjpeg upsamples chrominance
 * with a triangle filter and this decoder replicates, which is the conventional
 * choice and the one the standard's informative text describes, so on a colour
 * image the two disagree by up to 10 for reasons that are nothing to do with
 * correctness. Holding the chrominance constant takes the upsampler out of the
 * comparison and puts the tolerance back to 1.
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  decodeJpeg,
  encodeJpeg,
  findApp0Thumbnail,
  qualityScale,
  quantTable,
  STD_AC_CHROMA,
  STD_AC_LUMA,
  STD_CHROMA_QUANT,
  STD_DC_CHROMA,
  STD_DC_LUMA,
  STD_LUMA_QUANT,
  ZIGZAG,
} from './jpeg'

const COLOUR_444 =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsL' +
  'EBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQU' +
  'FBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAAQABgDAREAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcI' +
  'CQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRol' +
  'JicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ip' +
  'qrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAA' +
  'AAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLR' +
  'ChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaX' +
  'mJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEA' +
  'PwD4k8O/Cn7v7n9Kxo4k8rKs/wBtT0/w78KPu/uf0r3KOJP2DKs/21PTvD3wo+7+5/Svco4k/YMqz/bU67w78Kfu/uf0' +
  'r8do4k/yvyrP9tT07w98Kfu/uf0r3KOJP2DKs/21PT/D3wp+7+5/Svco4k/YMqz/AG1P/9k='

const COLOUR_444_RGB =
  'AAEABwEDEgELHQEQJwEYMgEePQElRQEoTwIwVwAzYwE6bQBBdgFHgQFOjAFUlQFZnwFgpwFjsgFrvQFxxgB30QF93ACE' +
  '5ACHAQ4HCQ0MFA4SHw4YKQ4fNA4lPw4sRw4vUQ43Wg48ZQ5BcA5JeA5Ogw5Vjg5blw5goQ5nqQ5stA5yvw54yA1+0w2E' +
  '3g2M5g2PAR0OCR0SFB0YHx0eKR4mMx4tPx4zSB42UR4/Wh5CZR5IcB5PeB1Wgh5cjx1ilx1moR5uqR1ztB54vx5+yB2F' +
  '0h6M3h2S5x2VACwTBy0WFCweHywjKCwrMi0xPiw4RS07UC1DWC1IZC1NbyxVeCxagS1hjixnlS1soCxzpy12tCx+vyyE' +
  'xyyK0S2Q3SyY5CybADwYCTwdFDwiHzwqKDwwMTw2Pjw9RjtBUT1JWT1MZDxUbz1aeDxggT1mjjxtljxwoDx4qTx9tDyD' +
  'vzyKxzyP0TyW3Tyc5juhAEsdB0siE0soHUsuKEs1MEs8PktCREtEUEtPV0xSY0tYbUxfd0tmgUtrjUtxlEt2oEx+pkyC' +
  's0uIvUyOyEyV0Euc3Uqi5EulAFskB1spE1ouHVs2JVs7MFpCO1pIRFpNT1xVV1xYZFtgbVxmdltsgVtyjFt4lFt8n1yF' +
  'p1uJs1uOvVuWxlyc0Fui21uo5FutAGgrCWgwFWc2H2g9KGhDMmdJPmhQR2hVUWlcWWlfZmhnb2lteWl0g2h5j2mClmiE' +
  'oWmMqmmRtmmXv2idyGmj02mr3mmw5me0AHkwB3k0E3k6HnlAJ3lIMnlPPXlVRnlYT3lhWHlkY3pqbnlxd3l4gnl+jXmE' +
  'lXmIoHqRp3mVsnmavXmgx3qo0Xiu3Hi05Xm3Aoc4CYU8FYdCIIZHKYZPNIZWP4ZcSIZfUYZoWoZrZYZxcIZ5eYZ/hIaF' +
  'j4aLl4aQooeYqoedtYejv4anyYav1Ia234a854W+AZU9CpVCFZVIIJVPKZZVM5ZdP5ZjSJVnUpZvWpZ0ZZZ5cJZ/eZWG' +
  'gpaLj5WTl5WWopefqpaitZaowJWwyZa10pa83pXC55XGAKRDB6VIFKRNH6RTKKRbMqViP6RoRqVrUaV0WKV3ZKV9b6WF' +
  'eKSLgqWRjqSXlaWboaWkp6WotaWvv6SzyKW70aTB3aTH5aXKALRJCbRMFLRSH7RaKbRhMrVnP7RtR7RxUbV5WrR+ZbSE' +
  'b7SIeLSQgrSXjrSdlrOfoLSpqbSstLSyv7S6yLTA0bTG3rTM5rTRAMNNB8NSE8NXHcNfKMNlMcRsPsNyRcR3UMN+V8SB' +
  'ZMOJbcSPd8OVgcSbjcOhlcOmoMOtp8Sys8O4vcO/x8PE0MPM3cLR5MPWANNVB9NYE9JeHdNlJ9NtMdJyPdN5RNJ8T9SF' +
  'V9OKZNOPbdOUdtOcgNKijNOplNKrntO1p9O4s9O+vdPGxtPM0dPS3NPY5NPdAOBcCeBfFd9lH+BtKeB0NOB6P+CAR+CF' +
  'UeGMWeCRZuCXb+GceOCjg+CrjuCwl+CzoeG+qeDAteDFv+DNyeHU0+DZ3uDf5uDk'

const RAMP_420 =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsL' +
  'EBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQU' +
  'FBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAAQABgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcI' +
  'CQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRol' +
  'JicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ip' +
  'qrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAA' +
  'AAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLR' +
  'ChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaX' +
  'mJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEA' +
  'PwD4j+Emif6n5fSvtX4SaJ/qfl9K+avhJon+p+X0r7V+Emif6n5fSgD6W+Emif6n5fSiuJ/aM8a33wc/ZK+I3ijTEuBq' +
  'UWmCxtZ7S6a1mtpbuVLRLhJFBKtE04lGMEmMAFc7gUAf/9k='

const GREYSCALE =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsL' +
  'EBYQERMUFRUVDA8XGBYUGBIUFRT/wAALCAAQABgBAREA/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QA' +
  'tRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0' +
  'NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2' +
  't7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oACAEBAAA/APiz4W+Ef9T8np2r7A+FvhH/' +
  'AFPyenavsD4W+Ef9T8np2r86vhb4R/1PyenavsD4W+Ef9T8np2r0D9pj4vf8Mxfs4a54qs28rxJebdI0H5M4v5lbZJzG' +
  '6fukSWfbINr+TsJBcV//2Q=='

const RESTART =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsL' +
  'EBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQU' +
  'FBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAAQABgDAREAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcI' +
  'CQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRol' +
  'JicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ip' +
  'qrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAA' +
  'AAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLR' +
  'ChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaX' +
  'mJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/90ABAAC/9oADAMB' +
  'AAIRAxEAPwD4j+Emif6n5fSgD7V+Emif6n5fSgD/0Ps/4SaJ/qfl9KAPyU+Emif6n5fSgD//0e5+Emif6n5fSgD2D9oz' +
  'xrffBz9kr4jeKNMS4GpRaYLG1ntLprWa2lu5UtEuEkUEq0TTiUYwSYwAVzuAB//Z'

const PROGRESSIVE =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsL' +
  'EBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQU' +
  'FBQUFBQUFBQUFBQUFBQUFBQUFBT/wgARCAAQABgDASIAAhEBAxEB/8QAFgABAQEAAAAAAAAAAAAAAAAABgAH/8QAFgEB' +
  'AQEAAAAAAAAAAAAAAAAABQMH/9oADAMBAAIQAxAAAAHEVD5PAgDbLMan/8QAFhAAAwAAAAAAAAAAAAAAAAAAAAQF/9oA' +
  'CAEBAAEFAl5QvKF5QvKF5QvKP//EABkRAAIDAQAAAAAAAAAAAAAAAAAFBCExI//aAAgBAwEBPwFW/wAsjP8Anp//xAAY' +
  'EQACAwAAAAAAAAAAAAAAAAAABAIDIf/aAAgBAgEBPwGlkizh/8QAFRABAQAAAAAAAAAAAAAAAAAAADH/2gAIAQEABj8C' +
  'iIiI/8QAFRABAQAAAAAAAAAAAAAAAAAAADH/2gAIAQEAAT8hmzYs2LF//9oADAMBAAIAAwAAABCM7//EABURAQEAAAAA' +
  'AAAAAAAAAAAAAAAh/9oACAEDAQE/EEyP/8QAFxEBAAMAAAAAAAAAAAAAAAAAACExUf/aAAgBAgEBPxCiWx//xAAVEAEB' +
  'AAAAAAAAAAAAAAAAAAAA8f/aAAgBAQABPxCAiJiAkJD/2Q=='

const OURS_RAMP_Q75_PIL_RGB =
  'AQEBCQkJFBQUHh4eJycnMTExPT09REREUVFRWVlZZGRkbm5ud3d3gYGBjY2NlJSUoqKiqqqqtbW1v7+/yMjI0tLS3t7e' +
  '5eXlBAQECwsLFhYWISEhKioqNDQ0Pz8/R0dHVFRUW1tbZmZmcXFxenp6hISEj4+Pl5eXpaWlrKyst7e3wsLCy8vL1dXV' +
  '4ODg6OjoBwcHDw8PGhoaJCQkLi4uODg4Q0NDSkpKV1dXX19fampqdHR0fn5+iIiIk5OTmpqaqKiosLCwu7u7xcXFz8/P' +
  '2dnZ5OTk6+vrCgoKEhISHR0dJycnMDAwOzs7RkZGTU1NWlpaYmJibW1td3d3gICAi4uLlpaWnZ2dq6urs7Ozvr6+yMjI' +
  '0dHR3Nzc5+fn7u7uDQ0NFBQUHx8fKioqMzMzPT09SEhIUFBQXV1dZGRkb29venp6g4ODjY2NmJiYoKCgrq6utbW1wMDA' +
  'y8vL1NTU3t7e6enp8fHxEBAQFxcXIiIiLCwsNjY2QEBAS0tLU1NTYGBgZ2dncnJyfHx8hoaGkJCQm5ubo6OjsbGxuLi4' +
  'w8PDzc3N19fX4eHh7Ozs9PT0ExMTGxsbJiYmMDAwOTk5RERET09PVlZWY2Nja2trdnZ2gICAiYmJlJSUn5+fpqamtLS0' +
  'vLy8x8fH0dHR2tra5eXl8PDw9/f3FhYWHR0dKSkpMzMzPDw8RkZGUVFRWVlZZmZmbW1teXl5g4ODjIyMlpaWoaGhqamp' +
  't7e3vr6+ysrK1NTU3d3d5+fn8vLy+vr6GRkZISEhLCwsNjY2Pz8/SUlJVVVVXFxcaWlpcXFxfHx8hoaGj4+PmZmZpaWl' +
  'rKyswMDAt7e329vby8vL5ubm7+/v+vr6////HBwcIyMjLi4uOTk5QkJCTExMV1dXX19fbGxsc3Nzfn5+iYmJkpKSnJyc' +
  'p6enr6+vsrKyyMjI2tra29vb4+Pj5ubm7e3tAAAAHx8fJycnMjIyPDw8RkZGUFBQW1tbYmJib29vd3d3goKCjIyMlpaW' +
  'oKCgq6ursrKyxsbGxcXFzc3Nzc3N7Ozs////////EhISIiIiKioqNTU1Pz8/SEhIU1NTXl5eZWVlcnJyenp6hYWFj4+P' +
  'mJiYo6Ojrq6utbW1t7e31NTU0dHR6+vr19fX7+/v+/v7BAQEJSUlLCwsNzc3QkJCS0tLVVVVYGBgaGhodXV1fHx8h4eH' +
  'kpKSm5ubpaWlsLCwuLi4zs7OwcHB19fX6Ojo////7+/vDAwMBwcHKCgoLy8vOjo6RERETk5OWFhYY2Nja2treHh4f39/' +
  'ioqKlJSUnp6eqKios7Ozu7u7xMTE2dnZ3t7e4uLi4eHh+Pj4Dg4OBQUFKysrMzMzPj4+SEhIUVFRXFxcZ2dnbm5ue3t7' +
  'g4ODjo6OmJiYoaGhrKyst7e3vr6+yMjIy8vL5+fn5eXl9vb2////AAAAKCgoLi4uNTU1QUFBS0tLVFRUXl5eaWlpcXFx' +
  'fn5+hYWFkZGRm5ubpKSkrq6uubm5wcHB2NjYz8/P3Nzc8PDw8fHx+fn5IyMjBQUF'

const b64 = (s: string): Uint8Array => Uint8Array.from(Buffer.from(s, 'base64'))

const W = 24
const H = 16

/** the three pictures the reference files were made from, rebuilt here */
function picture(f: (x: number, y: number) => readonly [number, number, number]): Uint8Array {
  const out = new Uint8Array(W * H * 3)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const [r, g, b] = f(x, y)
      const o = (y * W + x) * 3
      out[o] = r
      out[o + 1] = g
      out[o + 2] = b
    }
  }
  return out
}
const COLOUR = picture((x, y) => [(x * 10) & 255, (y * 15) & 255, ((x + y) * 6) & 255])
const RAMP = picture((x, y) => {
  const v = (x * 10 + y * 3) & 255
  return [v, v, v]
})
const GREY = picture((x, y) => {
  const v = (x * 9 + y * 5) & 255
  return [v, v, v]
})

/** the largest absolute difference between two same-length byte runs */
function worst(got: Uint8Array, want: Uint8Array): number {
  expect(got.length).toBe(want.length)
  let n = 0
  for (let i = 0; i < want.length; i++) {
    const e = Math.abs(got[i]! - want[i]!)
    if (e > n) n = e
  }
  return n
}

/** every marker up to and including the scan header, in the order written */
function markers(data: Uint8Array): number[] {
  const out = [data[1]!]
  let p = 2
  while (p + 4 <= data.length) {
    if (data[p] !== 0xff) break
    const code = data[p + 1]!
    out.push(code)
    if (code === 0xda) break
    p += 2 + ((data[p + 2]! << 8) | data[p + 3]!)
  }
  return out
}

/** where a segment with this marker starts, or -1 */
function segment(data: Uint8Array, want: number): number {
  let p = 2
  while (p + 4 <= data.length) {
    if (data[p] !== 0xff) return -1
    if (data[p + 1] === want) return p
    if (data[p + 1] === 0xda) return -1
    p += 2 + ((data[p + 2]! << 8) | data[p + 3]!)
  }
  return -1
}

/** the offset of a byte run inside another, or -1 */
function indexOfRun(haystack: Uint8Array, needle: readonly number[]): number {
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer
    return i
  }
  return -1
}

describe('quality', () => {
  it('scales as jpeg_set_quality does', () => {
    // hunk 3 $2668: clamped to 1..100, then 5000/q below 50 and 200-2q above
    expect(qualityScale(50)).toBe(100)
    expect(qualityScale(75)).toBe(50)
    expect(qualityScale(100)).toBe(0)
    expect(qualityScale(25)).toBe(200)
    expect(qualityScale(1)).toBe(5000)
    // "(0...100)", and out of range at either end is pulled back in
    expect(qualityScale(0)).toBe(5000)
    expect(qualityScale(-40)).toBe(5000)
    expect(qualityScale(1000)).toBe(0)
  })

  it('gives the standard tables at 50 and all ones at 100', () => {
    // "A value of 50 corresponds to the quantization tables suggested by the
    // draft standard", and "A factor of 100 corresponds to a quantization table
    // of all 1's and hence has no quantization loss"
    expect([...quantTable(STD_LUMA_QUANT, qualityScale(50))]).toEqual([...STD_LUMA_QUANT])
    expect([...quantTable(STD_CHROMA_QUANT, qualityScale(50))]).toEqual([...STD_CHROMA_QUANT])
    expect([...quantTable(STD_LUMA_QUANT, qualityScale(100))]).toEqual(new Array(64).fill(1))
  })

  it('clamps to 255 because the caller forces baseline', () => {
    // 16 * 5000 / 100 is 800, which only fits in a byte after the clamp
    const q1 = quantTable(STD_LUMA_QUANT, qualityScale(1))
    expect([...q1]).toEqual(new Array(64).fill(255))
    // and nothing ever reaches zero: 10 * 0 + 50 over 100 floors to 0, then 1
    expect(quantTable([0, ...new Array(63).fill(1)], 0)[0]).toBe(1)
  })
})

describe('the decoder', () => {
  it('agrees with libjpeg on a 4:4:4 colour file', () => {
    const img = decodeJpeg(b64(COLOUR_444))
    expect(img).not.toBeNull()
    expect(img!.width).toBe(W)
    expect(img!.height).toBe(H)
    expect(worst(img!.pixels, b64(COLOUR_444_RGB))).toBeLessThanOrEqual(1)
  })

  it('reads a 4:2:0 file back to the picture it was made from', () => {
    const img = decodeJpeg(b64(RAMP_420))
    expect(img).not.toBeNull()
    expect(worst(img!.pixels, RAMP)).toBeLessThanOrEqual(10)
  })

  it('reads a single-component file as grey', () => {
    // "It can load files with source colour space of Y Cb Cr, RGB and Grey scale"
    const img = decodeJpeg(b64(GREYSCALE))
    expect(img).not.toBeNull()
    expect(worst(img!.pixels, GREY)).toBeLessThanOrEqual(10)
    // grey means all three components equal, not just close
    for (let i = 0; i < img!.pixels.length; i += 3) {
      expect(img!.pixels[i + 1]).toBe(img!.pixels[i])
      expect(img!.pixels[i + 2]).toBe(img!.pixels[i])
    }
  })

  it('resynchronises on restart markers', () => {
    const file = b64(RESTART)
    // the file really does carry DRI and RSTn, or this would prove nothing
    let dri = -1
    for (let i = 0; i + 1 < file.length; i++) {
      if (file[i] === 0xff && file[i + 1] === 0xdd) dri = i
    }
    expect(dri).toBeGreaterThan(0)
    expect((file[dri + 4]! << 8) | file[dri + 5]!).toBe(2)
    const img = decodeJpeg(file)
    expect(img).not.toBeNull()
    expect(worst(img!.pixels, RAMP)).toBeLessThanOrEqual(10)
  })

  it('refuses what the AutoDoc says it refuses', () => {
    // "It does not support non interleaved files, progressive, hierarchical or
    // lossless modes"
    expect(decodeJpeg(b64(PROGRESSIVE))).toBeNull()
    // and everything else that is not a readable baseline file
    expect(decodeJpeg(new Uint8Array([0x46, 0x4f, 0x52, 0x4d]))).toBeNull()
    expect(decodeJpeg(new Uint8Array([0xff, 0xd8]))).toBeNull()
    expect(decodeJpeg(b64(COLOUR_444).subarray(0, 40))).toBeNull()
  })

  it('refuses a scan that names fewer components than the frame', () => {
    // non-interleaved: SOS says one component where SOF said three
    const file = Uint8Array.from(b64(COLOUR_444))
    const sos = segment(file, 0xda)
    expect(sos).toBeGreaterThan(0)
    file[sos + 4] = 1
    expect(decodeJpeg(file)).toBeNull()
  })

  it('refuses sixteen-bit quantization tables', () => {
    // "supports only 8 bit quantization tables" -- Pq in the high nibble
    const file = Uint8Array.from(b64(COLOUR_444))
    const dqt = segment(file, 0xdb)
    expect(dqt).toBeGreaterThan(0)
    file[dqt + 4] = 0x10
    expect(decodeJpeg(file)).toBeNull()
  })
})

describe('the encoder', () => {
  const bytes = encodeJpeg(COLOUR, W, H, { quality: 75 })

  it('writes the markers the library writes, in its order', () => {
    // hunk 3 $1d16 writes SOI then APP0 then the quantization tables then SOF0,
    // and $1dba writes the Huffman tables then SOS
    expect(markers(bytes)).toEqual([
      0xd8, 0xe0, 0xdb, 0xdb, 0xc0, 0xc4, 0xc4, 0xc4, 0xc4, 0xc4, 0xc4, 0xda,
    ])
    expect(bytes[bytes.length - 2]).toBe(0xff)
    expect(bytes[bytes.length - 1]).toBe(0xd9)
  })

  it('defines the two chrominance tables twice over', () => {
    // per component and not per table, so tables 1 and 1 go out three times
    // between them: hunk 3 $1dba, reproduced
    const classes: number[] = []
    let p = 2
    while (p + 4 <= bytes.length) {
      const code = bytes[p + 1]!
      if (code === 0xda) break
      if (code === 0xc4) classes.push(bytes[p + 4]!)
      p += 2 + ((bytes[p + 2]! << 8) | bytes[p + 3]!)
    }
    expect(classes).toEqual([0x00, 0x10, 0x01, 0x11, 0x01, 0x11])
  })

  it('writes a JFIF APP0 with no thumbnail by default', () => {
    expect((bytes[4]! << 8) | bytes[5]!).toBe(16)
    expect(String.fromCharCode(...bytes.subarray(6, 10))).toBe('JFIF')
    expect(bytes[10]).toBe(0)
    expect([bytes[11], bytes[12]]).toEqual([1, 1]) // version 1.1
    expect(bytes[13]).toBe(0) // density_unit
    expect([bytes[18], bytes[19]]).toEqual([0, 0]) // XThumbnail, YThumbnail
    expect(findApp0Thumbnail(bytes)).toBeNull()
  })

  it('writes SOF0 as 4:2:0 with the numbering the library sets up', () => {
    const sof = segment(bytes, 0xc0)
    expect(sof).toBeGreaterThan(0)
    expect(bytes[sof + 4]).toBe(8) // sample precision
    expect((bytes[sof + 5]! << 8) | bytes[sof + 6]!).toBe(H)
    expect((bytes[sof + 7]! << 8) | bytes[sof + 8]!).toBe(W)
    expect(bytes[sof + 9]).toBe(3)
    // {id 1, 2x2, quantization table 0}, {id 2, 1x1, table 1}, {id 3, 1x1, table 1}
    expect([...bytes.subarray(sof + 10, sof + 19)]).toEqual([1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1])
  })

  it('writes the scaled quantization tables in zigzag order', () => {
    const want = quantTable(STD_LUMA_QUANT, qualityScale(75))
    const dqt = segment(bytes, 0xdb)
    expect(dqt).toBeGreaterThan(0)
    expect((bytes[dqt + 2]! << 8) | bytes[dqt + 3]!).toBe(67)
    expect(bytes[dqt + 4]).toBe(0)
    for (let i = 0; i < 64; i++) expect(bytes[dqt + 5 + i]).toBe(want[ZIGZAG[i]!])
  })

  it('makes a file libjpeg reads the same way this decoder does', () => {
    // the sharp check: libjpeg's decode of these exact bytes, and our own,
    // agreeing to within IDCT rounding
    const ours = decodeJpeg(encodeJpeg(RAMP, W, H, { quality: 75 }))
    expect(ours).not.toBeNull()
    expect(worst(ours!.pixels, b64(OURS_RAMP_Q75_PIL_RGB))).toBeLessThanOrEqual(1)
  })

  it('round-trips a colour picture', () => {
    const back = decodeJpeg(encodeJpeg(COLOUR, W, H, { quality: 95 }))
    expect(back).not.toBeNull()
    expect(back!.width).toBe(W)
    expect(back!.height).toBe(H)
    expect(worst(back!.pixels, COLOUR)).toBeLessThanOrEqual(20)
  })

  it('loses nothing on a flat picture at any quality', () => {
    const flat = picture(() => [200, 40, 90])
    for (const quality of [1, 50, 75, 100]) {
      const back = decodeJpeg(encodeJpeg(flat, W, H, { quality }))
      expect(back).not.toBeNull()
      // a constant image is one DC coefficient a block, so quantization can
      // only move it by half a step and the round trip is near exact
      expect(worst(back!.pixels, flat)).toBeLessThanOrEqual(quality === 1 ? 24 : 3)
    }
  })

  it('pads a picture that is not a whole number of MCUs', () => {
    // 17 by 9 is two MCUs across and one down, both of them part padding
    const odd = new Uint8Array(17 * 9 * 3).fill(0x60)
    const back = decodeJpeg(encodeJpeg(odd, 17, 9, { quality: 90 }))
    expect(back).not.toBeNull()
    expect(back!.width).toBe(17)
    expect(back!.height).toBe(9)
    expect(back!.pixels.length).toBe(17 * 9 * 3)
    expect(worst(back!.pixels, odd)).toBeLessThanOrEqual(3)
  })
})

describe('the APP0 thumbnail', () => {
  const payload = Uint8Array.from([0x4f, 0x56, 0x54, 0x4e, 1, 2, 3, 4, 5, 6])
  const bytes = encodeJpeg(COLOUR, W, H, {
    quality: 75,
    thumbnail: { x: 48, y: 30, data: payload },
  })

  it('declares 48 by 30 and the length the library declares', () => {
    // 16 for the fixed part and the payload on top, which for a real save is
    // "OVTN" and 4320 bytes: the 4340 hunk 3 $1b02 adds up to
    expect((bytes[4]! << 8) | bytes[5]!).toBe(16 + payload.length)
    expect(bytes[18]).toBe(48)
    expect(bytes[19]).toBe(30)
  })

  it('comes back out byte for byte', () => {
    const found = findApp0Thumbnail(bytes)
    expect(found).not.toBeNull()
    expect(found!.x).toBe(48)
    expect(found!.y).toBe(30)
    expect([...found!.data]).toEqual([...payload])
  })

  it('is not confused for a picture', () => {
    // JFIF says 3*48*30 bytes of RGB follow and Opal writes something else, so
    // the decoder has to skip the segment on its length and not on its shape
    const img = decodeJpeg(bytes)
    expect(img).not.toBeNull()
    expect(img!.width).toBe(W)
  })

  it('finds nothing in a file that has none', () => {
    expect(findApp0Thumbnail(b64(COLOUR_444))).toBeNull()
    expect(findApp0Thumbnail(b64(GREYSCALE))).toBeNull()
    expect(findApp0Thumbnail(new Uint8Array([1, 2, 3]))).toBeNull()
  })
})

// The tables this codec uses are the ones the library carries, and the library
// is in fixtures/, which is gitignored -- so this is the check that can only
// run where the development kit is present.
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const LIB = join(root, 'fixtures/extensions/opal-1.1/devdocs/Libs/opal.library')
describe.skipIf(!existsSync(LIB))('against opal.library itself', () => {
  const lib = new Uint8Array(readFileSync(LIB))

  it('carries the same quantization tables, as words in zigzag order', () => {
    const at = (base: number, table: readonly number[]): void => {
      for (let i = 0; i < 64; i++) {
        const v = (lib[base + i * 2]! << 8) | lib[base + i * 2 + 1]!
        expect(v).toBe(table[ZIGZAG[i]!])
      }
    }
    at(0xd41a, STD_LUMA_QUANT)
    at(0xd49a, STD_CHROMA_QUANT)
  })

  it('carries the four standard Huffman tables, BITS then HUFFVAL', () => {
    // they run from $d27b in this order, each array aligned to an even address,
    // so the check is that the byte runs are there and in that order rather
    // than that they are contiguous
    let at = 0xd27b - 1
    for (const spec of [STD_DC_LUMA, STD_DC_CHROMA, STD_AC_LUMA, STD_AC_CHROMA]) {
      const found = indexOfRun(lib, [...spec.bits, ...spec.values])
      expect(found).toBeGreaterThan(at)
      at = found
    }
  })
})
