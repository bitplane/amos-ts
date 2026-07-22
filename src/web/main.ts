/**
 * Browser runner: load a .AMOS file (or plain-text listing), run it on the
 * Runtime at 50 frames a second, composite to a canvas, feed it keys and
 * mouse. `npm run dev` and open the page.
 */
import { parseAmosFile } from '../loader/amosfile'
import { parseSource, TokenTable } from '../tokens/stream'
import { tokenize } from '../tokens/tokenizer'
import { CORE_TOKENS, EXTENSION_TOKENS } from '../tokens/tables.gen'
import { Runtime } from '../runtime/runtime'
import { AmosRuntimeError } from '../interp/interp'

const table = new TokenTable(CORE_TOKENS)
const extensions = new Map([...EXTENSION_TOKENS].map(([slot, defs]) => [slot, new TokenTable(defs)]))

const canvas = document.getElementById('screen') as HTMLCanvasElement
const ctx = canvas.getContext('2d')!
const statusEl = document.getElementById('status')!
const fileEl = document.getElementById('file') as HTMLInputElement
const lineEl = document.getElementById('line') as HTMLInputElement
const turboEl = document.getElementById('turbo') as HTMLInputElement
const img = ctx.createImageData(640, 400)

const DEMO = `Curs Off : Cls 0
For C=1 To 15
   Ink C : Circle 160,100,C*6
Next
Pen 2 : Paper 0
Locate 0,1 : Centre "amos-ts"
Locate 0,23 : Centre "drop a .AMOS file above"
Do
   For C=1 To 15
      Colour C,Rnd($FFF)
   Next
   Wait 10
Loop`

let rt: Runtime | null = null
let lastBytes: Uint8Array | null = null
let lastName = ''
let error = ''

function load(bytes: Uint8Array, name: string): void {
  lastBytes = bytes
  lastName = name
  error = ''
  try {
    const isAmos = /^AMOS (Basic|Pro)/.test(new TextDecoder('latin1').decode(bytes.subarray(0, 16)))
    const amos = isAmos ? parseAmosFile(bytes) : null
    const lines = amos ? parseSource(amos.source, table) : tokenize(new TextDecoder('latin1').decode(bytes), table)
    rt = new Runtime(lines, table, { extensions, onUnimplemented: 'skip', banks: amos?.banks ?? [] })
  } catch (e) {
    rt = null
    error = e instanceof Error ? e.message : String(e)
  }
}

fileEl.addEventListener('change', () => {
  const f = fileEl.files?.[0]
  if (!f) return
  void f.arrayBuffer().then((buf) => load(new Uint8Array(buf), f.name))
})
document.getElementById('restart')!.addEventListener('click', () => {
  if (lastBytes) load(lastBytes, lastName)
})

// ---- input ----

// DOM code → Amiga rawkey scancode (the common ones games poll)
const SCAN: Record<string, number> = {
  Escape: 0x45, Space: 0x40, Enter: 0x44, Backspace: 0x41, Tab: 0x42, Delete: 0x46,
  ArrowUp: 0x4c, ArrowDown: 0x4d, ArrowRight: 0x4e, ArrowLeft: 0x4f,
  ShiftLeft: 0x60, ShiftRight: 0x61, ControlLeft: 0x63, AltLeft: 0x64, AltRight: 0x65,
  KeyQ: 0x10, KeyW: 0x11, KeyE: 0x12, KeyR: 0x13, KeyT: 0x14, KeyY: 0x15, KeyU: 0x16, KeyI: 0x17, KeyO: 0x18, KeyP: 0x19,
  KeyA: 0x20, KeyS: 0x21, KeyD: 0x22, KeyF: 0x23, KeyG: 0x24, KeyH: 0x25, KeyJ: 0x26, KeyK: 0x27, KeyL: 0x28,
  KeyZ: 0x31, KeyX: 0x32, KeyC: 0x33, KeyV: 0x34, KeyB: 0x35, KeyN: 0x36, KeyM: 0x37,
  Digit1: 0x01, Digit2: 0x02, Digit3: 0x03, Digit4: 0x04, Digit5: 0x05,
  Digit6: 0x06, Digit7: 0x07, Digit8: 0x08, Digit9: 0x09, Digit0: 0x0a,
  F1: 0x50, F2: 0x51, F3: 0x52, F4: 0x53, F5: 0x54, F6: 0x55, F7: 0x56, F8: 0x57, F9: 0x58, F10: 0x59,
}
const JOY: Record<string, number> = { ArrowUp: 1, ArrowDown: 2, ArrowLeft: 4, ArrowRight: 8, Space: 16, ControlLeft: 16 }

document.addEventListener('keydown', (e) => {
  if (e.target === lineEl || !rt) return
  const scan = SCAN[e.code] ?? 0
  if (scan) rt.input.keys.add(scan)
  if (JOY[e.code] !== undefined) rt.input.joy |= JOY[e.code]!
  const ch = e.key === 'Enter' ? '\r' : e.key.length === 1 ? e.key : ''
  if (ch !== '') rt.pressKey(ch, scan)
  if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault()
})
document.addEventListener('keyup', (e) => {
  if (!rt) return
  const scan = SCAN[e.code] ?? 0
  if (scan) rt.input.keys.delete(scan)
  if (JOY[e.code] !== undefined) rt.input.joy &= ~JOY[e.code]!
})
lineEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && rt) {
    rt.submitLine(lineEl.value)
    lineEl.value = ''
    e.stopPropagation()
  }
})
canvas.addEventListener('mousemove', (e) => {
  if (!rt) return
  const r = canvas.getBoundingClientRect()
  rt.input.mouseX = 128 + Math.floor(((e.clientX - r.left) / r.width) * 320)
  rt.input.mouseY = 50 + Math.floor(((e.clientY - r.top) / r.height) * 200)
})
canvas.addEventListener('mousedown', (e) => {
  if (!rt) return
  rt.input.mouseK |= e.button === 2 ? 2 : 1
  rt.input.clicks++
  e.preventDefault()
})
canvas.addEventListener('mouseup', (e) => {
  if (rt) rt.input.mouseK &= ~(e.button === 2 ? 2 : 1)
})
canvas.addEventListener('contextmenu', (e) => e.preventDefault())

// ---- the 50Hz loop ----

let acc = 0
let last = performance.now()
function loop(now: number): void {
  requestAnimationFrame(loop)
  acc += now - last
  last = now
  if (!rt) return
  const frames = turboEl.checked ? 20 : Math.min(5, Math.floor(acc / 20))
  if (!turboEl.checked && frames > 0) acc -= frames * 20
  else if (turboEl.checked) acc = 0
  let status = ''
  for (let i = 0; i < frames; i++) {
    if (rt.interp.done) break
    try {
      rt.frame()
    } catch (e) {
      error = e instanceof AmosRuntimeError ? e.message : String(e)
      rt = null
      break
    }
  }
  if (rt) {
    rt.composite(img.data as unknown as Uint8ClampedArray)
    ctx.putImageData(img, 0, 0)
    const b = rt.interp.blocked
    status = rt.interp.done
      ? 'ended'
      : b
        ? b.type === 'input'
          ? 'waiting for Input — type in the box below'
          : b.type
        : `running · ${lastName}`
    const skipped = rt.interp.unimplemented.size
    if (skipped > 0) status += ` · ${skipped} unimplemented skipped`
  }
  statusEl.textContent = error !== '' ? `error: ${error}` : status
}

load(new TextEncoder().encode(DEMO), 'demo')
requestAnimationFrame(loop)
