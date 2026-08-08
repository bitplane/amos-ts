import { describe, expect, it } from 'vitest'
import {
  Boopsi,
  OM_ADDTAIL,
  OM_DISPOSE,
  OM_GET,
  OM_NEW,
  OM_REMOVE,
  OM_SET,
  coerceMethodA,
  doMethodA,
  doSuperMethodA,
  findTagItem,
  getAttr,
  setAttrsA,
  type BoopsiClass,
  type BoopsiObject,
  type Dispatcher,
  type OpGet,
  type OpSet,
} from './boopsi'

/** two attributes, so a subclass has something of its own to know about */
const A_Colour = 0x8000_0001
const A_Depth = 0x8000_0002

interface ThingData extends Record<string, unknown> {
  colour: number
}

/**
 * A minimal subclass in the shape every real one has: hand OM_NEW up, take the
 * address back, initialise, then let the taglist through OM_SET.
 */
function thingClass(b: Boopsi): BoopsiClass {
  const dispatch: Dispatcher = (cl, obj, msg) => {
    switch (msg.MethodID) {
      case OM_NEW: {
        const o = b.objectAt(doSuperMethodA(cl, obj, msg))
        if (!o) return 0
        o.instData<ThingData>(cl).colour = 0
        setOwn(cl, o, (msg as OpSet).attrs)
        return o.address
      }
      case OM_SET:
        return setOwn(cl, obj as BoopsiObject, (msg as OpSet).attrs)
      case OM_GET: {
        const g = msg as OpGet
        if (g.attrID !== A_Colour) return doSuperMethodA(cl, obj, msg)
        g.storage = (obj as BoopsiObject).instData<ThingData>(cl).colour
        return 1
      }
      default:
        return doSuperMethodA(cl, obj, msg)
    }
  }
  const setOwn = (cl: BoopsiClass, o: BoopsiObject, attrs: readonly { tag: number; data: number }[]): number => {
    let used = 0
    for (const t of attrs)
      if (t.tag === A_Colour) {
        o.instData<ThingData>(cl).colour = t.data
        used++
      }
    return used
  }
  return b.makeClass('thing', 'rootclass', dispatch)!
}

describe('BOOPSI: rootclass', () => {
  it('OM_NEW allocates and OM_DISPOSE retires the handle', () => {
    const b = new Boopsi()
    const o = b.newObjectA('rootclass')!
    expect(o).not.toBeNull()
    expect(b.objectAt(o.address)).toBe(o)
    expect(b.rootClass.objectCount).toBe(1)

    b.disposeObject(o)
    expect(o.disposed).toBe(true)
    expect(b.objectAt(o.address)).toBeNull()
    expect(b.rootClass.objectCount).toBe(0)
  })

  it('addresses are never reused — DEVIATION, and the safe direction', () => {
    const b = new Boopsi()
    const first = b.newObjectA('rootclass')!
    b.disposeObject(first)
    const second = b.newObjectA('rootclass')!
    expect(second.address).not.toBe(first.address)
    // the stale handle answers "no such object" rather than finding the new one
    expect(b.objectAt(first.address)).toBeNull()
  })

  it('OM_ADDTAIL and OM_REMOVE answer TRUE, everything else falls through to 0', () => {
    const b = new Boopsi()
    const o = b.newObjectA('rootclass')!
    expect(doMethodA(o, { MethodID: OM_ADDTAIL })).toBe(1)
    expect(doMethodA(o, { MethodID: OM_REMOVE })).toBe(1)
    // an attribute nobody claims: 0 from the root, which is how a caller
    // learns there is no such attribute rather than that its value is zero
    expect(setAttrsA(o, [{ tag: A_Colour, data: 7 }])).toBe(0)
    expect(getAttr(A_Colour, o)).toBeNull()
  })

  it('a double dispose is not a double decrement', () => {
    const b = new Boopsi()
    const o = b.newObjectA('rootclass')!
    b.disposeObject(o)
    b.disposeObject(o)
    doMethodA(o, { MethodID: OM_DISPOSE })
    expect(b.rootClass.objectCount).toBe(0)
  })
})

describe('BOOPSI: subclassing', () => {
  it('OM_NEW goes up to rootclass and comes back with the object', () => {
    const b = new Boopsi()
    const thing = thingClass(b)
    const o = b.newObjectA(thing, [{ tag: A_Colour, data: 3 }])!
    expect(o.cl).toBe(thing)
    expect(getAttr(A_Colour, o)).toBe(3)
    // the object counts against the class that made it, not the whole chain,
    // which is what rootclass.c increments
    expect(thing.objectCount).toBe(1)
    expect(b.rootClass.objectCount).toBe(0)
  })

  it('an unknown attribute is handed up and answers null, a known zero answers 0', () => {
    const b = new Boopsi()
    const thing = thingClass(b)
    const o = b.newObjectA(thing)!
    expect(getAttr(A_Colour, o)).toBe(0)
    expect(getAttr(A_Depth, o)).toBeNull()
  })

  it('OM_SET answers how many attributes it used', () => {
    const b = new Boopsi()
    const o = b.newObjectA(thingClass(b))!
    expect(
      setAttrsA(o, [
        { tag: A_Colour, data: 9 },
        { tag: A_Depth, data: 4 },
      ]),
    ).toBe(1)
    expect(getAttr(A_Colour, o)).toBe(9)
  })

  it('instance data is per class, so a subclass cannot tread on its parent', () => {
    const b = new Boopsi()
    const thing = thingClass(b)
    // a subclass that stores under the same key in its OWN slice
    const sub = b.makeClass('subthing', thing, (cl, obj, msg) => {
      if (msg.MethodID === OM_NEW) {
        const o = b.objectAt(doSuperMethodA(cl, obj, msg))
        if (!o) return 0
        o.instData<ThingData>(cl).colour = 99
        return o.address
      }
      return doSuperMethodA(cl, obj, msg)
    })!
    const o = b.newObjectA(sub, [{ tag: A_Colour, data: 3 }])!
    expect(o.instData<ThingData>(sub).colour).toBe(99)
    expect(o.instData<ThingData>(thing).colour).toBe(3)
    expect(getAttr(A_Colour, o)).toBe(3)
  })

  it('a subclass that refuses OM_NEW leaves nothing allocated', () => {
    const b = new Boopsi()
    const picky = b.makeClass('picky', 'rootclass', (cl, obj, msg) => {
      if (msg.MethodID === OM_NEW) {
        // the guide's case: a child that failed to create takes its parent
        // down with it, because the parent never calls up
        if (findTagItem(A_Depth, (msg as OpSet).attrs) === 0) return 0
        return doSuperMethodA(cl, obj, msg)
      }
      return doSuperMethodA(cl, obj, msg)
    })!
    expect(b.newObjectA(picky)).toBeNull()
    expect(picky.objectCount).toBe(0)
    expect(b.newObjectA(picky, [{ tag: A_Depth, data: 1 }])).not.toBeNull()
  })

  it('isA walks the chain, and coerce enters where it is told', () => {
    const b = new Boopsi()
    const thing = thingClass(b)
    const sub = b.makeClass('subthing2', thing, (cl, obj, msg) => doSuperMethodA(cl, obj, msg))!
    expect(sub.isA(b.rootClass)).toBe(true)
    expect(thing.isA(sub)).toBe(false)

    const o = b.newObjectA(sub, [{ tag: A_Colour, data: 5 }])!
    // coercing to `thing` reads thing's slice, which sub's OM_NEW passed through
    const g: OpGet = { MethodID: OM_GET, attrID: A_Colour, storage: 0 }
    expect(coerceMethodA(thing, o, g)).toBe(1)
    expect(g.storage).toBe(5)
  })
})

describe('BOOPSI: classes', () => {
  it('MakeClass refuses an unknown superclass and registers a named one', () => {
    const b = new Boopsi()
    expect(b.makeClass('orphan', 'nosuchclass', () => 0)).toBeNull()
    const cl = b.makeClass('named', 'rootclass', () => 0)!
    expect(b.findClass('named')).toBe(cl)
    expect(b.rootClass.subclassCount).toBe(1)
  })

  it('a private class has no id and is not findable', () => {
    const b = new Boopsi()
    const cl = b.makeClass('', 'rootclass', (c, o, m) => doSuperMethodA(c, o, m))!
    expect(b.findClass('')).toBeNull()
    expect(b.newObjectA(cl)).not.toBeNull()
  })

  it('FreeClass refuses while objects or subclasses are outstanding', () => {
    const b = new Boopsi()
    const thing = thingClass(b)
    const o = b.newObjectA(thing)!
    expect(b.freeClass(thing)).toBe(false)
    b.disposeObject(o)

    const sub = b.makeClass('sub3', thing, () => 0)!
    expect(b.freeClass(thing)).toBe(false)
    expect(b.freeClass(sub)).toBe(true)
    expect(b.freeClass(thing)).toBe(true)
    expect(b.findClass('thing')).toBeNull()
  })

  it('two object spaces do not see each other', () => {
    const a = new Boopsi()
    const b = new Boopsi()
    const o = a.newObjectA('rootclass')!
    expect(b.objectAt(o.address)).toBeNull()
  })
})
