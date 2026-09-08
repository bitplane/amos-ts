import { describe, expect, it } from 'vitest'
import { objectWireframe, surfaceWireframe } from './tdview'
import { readFileSync } from 'node:fs'

const ROOT = 'fixtures/extensions/amos3d-1.0/engine/om/examples'

describe('AMOS 3D viewer models', () => {
  it('uses the runtime geometry parser for object points and edges', () => {
    const model = objectWireframe(readFileSync(`${ROOT}/amiga.3DO`))
    expect(model.points.length).toBeGreaterThan(3)
    expect(model.edges.length).toBeGreaterThan(3)
    expect(model.edges.every(([a, b]) => a < model.points.length && b < model.points.length)).toBe(true)
  })

  it('loads linked templates for an object whose default faces are not repeated in the object file', () => {
    const root = 'fixtures/extensions/amos3d-1.0/demos/AMOS_3D_demos/objects'
    const model = objectWireframe(readFileSync(`${root}/church.3DO`), (name) => readFileSync(`${root}/${name}`))
    expect(model.points.length).toBe(29)
    expect(model.edges.length).toBe(44)
  })

  it('maps a surface onto a face without inventing a 3D mesh', () => {
    const model = surfaceWireframe(readFileSync(`${ROOT}/td1s1.3DS`))
    expect(model.points.length).toBeGreaterThanOrEqual(5)
    expect(model.edges.length).toBeGreaterThan(0)
    expect(model.points.every((point) => point.z === 0)).toBe(true)
  })
})
