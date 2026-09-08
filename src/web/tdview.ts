/** WebGL wireframes over the AMOS 3D backend's decoded object structures. */
import {
  parseTdFile,
  parseTdGeometry,
  parseTdSurface,
  tdSurfaceSlots,
  type TdPoint,
} from '../runtime/td'

export interface Wireframe {
  points: TdPoint[]
  edges: Array<[number, number]>
}

const uniqueEdges = (polygons: readonly (readonly number[])[]): Array<[number, number]> => {
  const seen = new Set<string>()
  const out: Array<[number, number]> = []
  for (const polygon of polygons) {
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i]!
      const b = polygon[(i + 1) % polygon.length]!
      if (a === b) continue
      const key = a < b ? `${a}:${b}` : `${b}:${a}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push([a, b])
    }
  }
  return out
}

/** A `.3DO` as the exact points and face edges exposed by the runtime parser. */
export function objectWireframe(bytes: Uint8Array): Wireframe {
  const geometry = parseTdGeometry(parseTdFile(bytes))
  return { points: geometry.points, edges: uniqueEdges(geometry.faces.map((face) => face.vertices)) }
}

/** A `.3DS` has no 3D coordinates; show its construction mapped onto one face. */
export function surfaceWireframe(bytes: Uint8Array): Wireframe {
  const surface = parseTdSurface(parseTdFile(bytes, 23))
  const slots = tdSurfaceSlots(surface, [
    { x: -1000, y: -1000 }, { x: 1000, y: -1000 },
    { x: 1000, y: 1000 }, { x: -1000, y: 1000 },
  ])
  const points: TdPoint[] = slots.map((point) => ({ x: point?.x ?? 0, y: -(point?.y ?? 0), z: 0 }))
  const polygons = surface.fills.map((fill) => fill.map((point) => point.slot))
  const edges = uniqueEdges(polygons)
  for (const edge of surface.edges) {
    const key = edge[0] < edge[1] ? `${edge[0]}:${edge[1]}` : `${edge[1]}:${edge[0]}`
    if (!edges.some(([a, b]) => (a < b ? `${a}:${b}` : `${b}:${a}`) === key)) edges.push(edge)
  }
  return { points, edges }
}

function shader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const value = gl.createShader(type)
  if (!value) return null
  gl.shaderSource(value, source)
  gl.compileShader(value)
  if (!gl.getShaderParameter(value, gl.COMPILE_STATUS)) return null
  return value
}

/** Mount an interactive wireframe. Parsing stays above; this only draws lines. */
export function mountWireframe(host: HTMLElement, model: Wireframe, flat = false): void {
  const canvas = document.createElement('canvas')
  canvas.className = 'td-wireframe'
  canvas.width = 960
  canvas.height = 600
  canvas.tabIndex = 0
  canvas.title = flat ? 'AMOS 3D surface mapped onto a face' : 'drag to rotate; wheel to zoom'
  host.appendChild(canvas)
  const gl = canvas.getContext('webgl', { antialias: true })
  if (!gl) {
    const message = document.createElement('p')
    message.className = 'fm-more'
    message.textContent = 'WebGL is unavailable.'
    host.appendChild(message)
    return
  }

  const vert = shader(gl, gl.VERTEX_SHADER, 'attribute vec2 p; void main(){gl_Position=vec4(p,0.,1.);}')
  const frag = shader(gl, gl.FRAGMENT_SHADER, 'precision mediump float; void main(){gl_FragColor=vec4(.15,.72,1.,1.);}')
  const program = gl.createProgram()
  const buffer = gl.createBuffer()
  if (!vert || !frag || !program || !buffer) return
  gl.attachShader(program, vert)
  gl.attachShader(program, frag)
  gl.linkProgram(program)
  gl.useProgram(program)
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  const location = gl.getAttribLocation(program, 'p')
  gl.enableVertexAttribArray(location)
  gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0)

  const xs = model.points.map((p) => p.x)
  const ys = model.points.map((p) => p.y)
  const zs = model.points.map((p) => p.z)
  const centre: TdPoint = {
    x: (Math.min(...xs) + Math.max(...xs)) / 2 || 0,
    y: (Math.min(...ys) + Math.max(...ys)) / 2 || 0,
    z: (Math.min(...zs) + Math.max(...zs)) / 2 || 0,
  }
  const radius = Math.max(1, ...model.points.map((p) => Math.hypot(p.x - centre.x, p.y - centre.y, p.z - centre.z)))
  let rx = flat ? 0 : -0.35
  let ry = flat ? 0 : 0.55
  let zoom = 0.85

  const draw = (): void => {
    const sx = Math.sin(rx), cx = Math.cos(rx), sy = Math.sin(ry), cy = Math.cos(ry)
    const transformed = model.points.map((point) => {
      const x = (point.x - centre.x) / radius
      const y = (point.y - centre.y) / radius
      const z = (point.z - centre.z) / radius
      const ax = x * cy + z * sy
      const az = -x * sy + z * cy
      const ay = y * cx - az * sx
      return [ax * zoom * canvas.height / canvas.width, ay * zoom] as const
    })
    const vertices = new Float32Array(model.edges.flatMap(([a, b]) => [...(transformed[a] ?? [0, 0]), ...(transformed[b] ?? [0, 0])]))
    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.clearColor(0.03, 0.035, 0.04, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW)
    gl.drawArrays(gl.LINES, 0, vertices.length / 2)
  }

  let drag: { x: number; y: number } | null = null
  canvas.addEventListener('pointerdown', (event) => {
    if (flat) return
    drag = { x: event.clientX, y: event.clientY }
    canvas.setPointerCapture(event.pointerId)
  })
  canvas.addEventListener('pointermove', (event) => {
    if (!drag) return
    ry += (event.clientX - drag.x) * 0.01
    rx += (event.clientY - drag.y) * 0.01
    drag = { x: event.clientX, y: event.clientY }
    draw()
  })
  canvas.addEventListener('pointerup', () => { drag = null })
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault()
    zoom = Math.max(0.15, Math.min(3, zoom * Math.exp(-event.deltaY * 0.001)))
    draw()
  }, { passive: false })
  draw()
}
