import { describe, expect, it } from 'vitest'
import { CORE_TOKENS } from './tables.gen'
import { VERIF_CLASSES } from './verif.gen'
import { EXT_TABLES } from '../ext/tables.gen'
import { T } from './stream'

/**
 * The class table is the verifier's whole dispatch, so an id that slipped by
 * one would send every keyword after it to the wrong handler and still look
 * like a table. These tests anchor it at both ends and in the middle.
 */
describe('the verifier class table', () => {
  it('has a row per core token, on the same ids and in the same order', () => {
    expect(VERIF_CLASSES.length).toBe(CORE_TOKENS.length)
    expect(VERIF_CLASSES.map((v) => v.id)).toEqual(CORE_TOKENS.map((t) => t.id))
  })

  const classOf = (name: string): number => {
    const t = CORE_TOKENS.find((x) => x.name.trim() === name)
    if (t === undefined) throw new Error(`no core token named ${name}`)
    return VERIF_CLASSES.find((v) => v.id === t.id)!.inst
  }

  /**
   * The handler numbers VerDd's jump table gives them (+Verif.s:291), read
   * off its own comments: `bra V1_For  30-For`, `bra VerRem  02-Rem`.
   */
  it('sends the control-flow keywords to the handlers the jump table names', () => {
    expect(classOf('for')).toBe(0x30)
    expect(classOf('next')).toBe(0x31)
    expect(classOf('repeat')).toBe(0x32)
    expect(classOf('if')).toBe(0x3a)
    expect(classOf('goto')).toBe(0x3e)
    expect(classOf('on')).toBe(0x43)
    expect(classOf('rem')).toBe(0x02)
    expect(classOf('dim')).toBe(0x09)
    expect(classOf('print')).toBe(0x0a)
  })

  /**
   * A class above $7F is negative and indexes the SECOND table, the six
   * entries VerDd keeps in front of `.Jmp` for the things that may only open
   * a line: `bra V1_Procedure  FF-Debut procedure`.
   */
  it('marks the line-opening keywords with a negative class', () => {
    expect(classOf('procedure')).toBe(0xff)
    expect(classOf('end proc')).toBe(0xfe)
    expect(classOf('data')).toBe(0xfd)
    expect(classOf('def fn')).toBe(0xfc)
    expect(classOf('shared')).toBe(0xfb)
  })

  /** the twelve entries below T.EXTENSION, which nothing types and everything uses */
  it('classes the special low tokens', () => {
    const at = (id: number): { inst: number; ope: number } => VERIF_CLASSES.find((v) => v.id === id)!
    expect(at(T.EOL).inst).toBe(0x2f) // 2F-Fin de ligne
    expect(at(T.VARIABLE)).toEqual({ id: T.VARIABLE, inst: 0x06, ope: 0x07 })
    expect(at(T.LABEL).inst).toBe(0x07)
    expect(at(T.PROC_CALL).inst).toBe(0x08)
    expect(at(T.EXTENSION)).toEqual({ id: T.EXTENSION, inst: 0x28, ope: 0x06 })
    // 14-Constante Entiere, 15-Constante Float, 17-Constante String
    expect(at(T.INT).ope).toBe(0x14)
    expect(at(T.FLOAT).ope).toBe(0x15)
    expect(at(T.STR_DQ).ope).toBe(0x17)
  })
})

/**
 * The byte that ended the spec. VerC4 (+Verif.s:3158) accepts only $FE, so
 * this is the difference between "try the next entry" and "syntax error".
 */
describe('the spec terminator', () => {
  it('marks 141 core entries, and 139 of them as argument-count variants', () => {
    const marked = CORE_TOKENS.filter((t) => t.end !== undefined)
    expect(marked.length).toBe(141)
    expect(marked.filter((t) => t.end === 0xfe).length).toBe(139)
  })

  /**
   * $FD is the function form rather than another argument count, and only
   * `Screen` and `Colour` carry it. Ope_InstFonction (:2735) is the arm that
   * steps onto the entry behind it, which is why both have operand class $18
   * and their nameless followers $19, Ope_DejaTeste.
   */
  it('gives Screen and Colour a function form behind the instruction', () => {
    const fd = CORE_TOKENS.filter((t) => t.end === 0xfd)
    expect(fd.map((t) => t.name)).toEqual(['!screen', '!colour'])
    for (const t of fd) {
      const i = CORE_TOKENS.indexOf(t)
      expect(VERIF_CLASSES[i]!.ope).toBe(0x18)
      expect(CORE_TOKENS[i + 1]!.name).toBe('')
      expect(VERIF_CLASSES[i + 1]!.ope).toBe(0x19)
    }
  })

  /** no extension ships a function form; 685 entries across the 88 tables are variants */
  it('is only ever $FE in an extension table', () => {
    const ends = Object.values(EXT_TABLES)
      .flat()
      .filter((t) => t.end !== undefined)
      .map((t) => t.end)
    expect(ends.length).toBe(685)
    expect([...new Set(ends)]).toEqual([0xfe])
  })
})
