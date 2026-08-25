import { describe, expect, it } from 'vitest'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/source'
import { Runtime, type EditorZap } from './runtime'

const table = new TokenTable(CORE_TOKENS)

/** every call the two keywords made, and whatever the stub was told to answer */
function driven(
  src: string,
  answer: (kind: 'call' | 'ask', n: number, param: number, line: string | null) => { value: number; text: string },
): { out: string; seen: Array<[string, number, number, string | null]> } {
  const seen: Array<[string, number, number, string | null]> = []
  let out = ''
  const zap: EditorZap = {
    call: (n, param, line) => {
      seen.push(['call', n, param, line])
      return answer('call', n, param, line)
    },
    ask: (n, param) => {
      seen.push(['ask', n, param, null])
      return answer('ask', n, param, null)
    },
  }
  const rt = new Runtime(tokenize(src, table), table, {
    maxSteps: 100_000,
    editorZap: zap,
    onText: (t) => (out += t),
  })
  rt.runHeadless(200)
  return { out, seen }
}

const ok = (): { value: number; text: string } => ({ value: 0, text: '' })
/** `EntNul` (+Equ.s:39), which forms 1 and 2 push for the arguments they lack */
const ENT_NUL = -0x8000_0000

describe('Call Editor and Ask Editor take three forms each', () => {
  it('pushes EntNul for an argument the form does not have', () => {
    // `InCallEditor1` is `move.l d3,-(a3) / move.l #EntNul,d3 / move.l d3,-(a3)`
    // and falls into 3; form 2 pushes one EntNul (+ILib.s:1649)
    const { seen } = driven('Call Editor 4\nCall Editor 4,7\nCall Editor 4,7,"x"', ok)
    expect(seen).toEqual([
      ['call', 4, ENT_NUL, null],
      ['call', 4, 7, null],
      ['call', 4, 7, 'x'],
    ])
  })

  it('takes a blank middle slot, which is how CRAFT writes a line', () => {
    // `Call Editor 71,,C$+B$` is CRAFT_Interface_Packer.AMOS verbatim
    const { seen } = driven('C$="P"\nCall Editor 71,,C$+"rint"', ok)
    expect(seen).toEqual([['call', 71, ENT_NUL, 'Print']])
  })

  it('asks the same three ways', () => {
    const { seen } = driven('Ask Editor 5\nAsk Editor 1,2\nAsk Editor 1,2,"z"', ok)
    expect(seen).toEqual([
      ['ask', 5, ENT_NUL, null],
      ['ask', 1, 2, null],
      ['ask', 1, 2, null],
    ])
  })
})

describe('what comes back', () => {
  it('puts a Call Editor answer in Param, and its text only when it failed', () => {
    // `ZapReturn` (+ILib.s:1763): `move.l ChVide(a5),ParamC(a5)` first, then
    // `A0ToChaine` only under `tst.l d0 / beq .Bof`
    const { out } = driven(
      'Call Editor 4\nPrint Param;"/";Param$;"/"\nCall Editor 9\nPrint Param;"/";Param$;"/"',
      (_k, n) => (n === 4 ? { value: 0, text: 'ignored' } : { value: -4, text: 'Editor command not runnable.' }),
    )
    expect(out.replace(/\s+/g, ' ').trim()).toBe('0// -4/Editor command not runnable./')
  })

  it('puts an Ask Editor string in Param$ even when the value is zero', () => {
    // `InAskEditor3` is not `ZapReturn`: the string follows `tst.w d2`
    // (+ILib.s:1635), so a question that answers text answers it
    const { out } = driven('Ask Editor 2\nPrint Param;"/";Param$;"/"', () => ({ value: 0, text: 'RAM:one.AMOS' }))
    expect(out.replace(/\s+/g, ' ').trim()).toBe('0/RAM:one.AMOS/')
  })
})

describe('with no editor loaded', () => {
  it('is an Illegal function call, which is what a CLI run gets', () => {
    // `tst.l Edit_Segment(a5) / beq FonCall` (+ILib.s:1674 and :1633)
    for (const src of ['Call Editor 4', 'Ask Editor 5']) {
      const rt = new Runtime(tokenize(src, table), table, { maxSteps: 10_000 })
      expect(() => rt.runHeadless(50), src).toThrow(/Illegal function call/)
    }
  })
})
