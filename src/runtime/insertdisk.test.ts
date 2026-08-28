/**
 * The handler's insert-volume requester, which is the one filesystem failure
 * AmigaDOS ASKS about rather than reporting.
 *
 * `Lock()` on a path whose volume is absent does not fail: the handler puts a
 * requester up and the process sits inside the call until the disk turns up
 * or the user cancels, and only then does `Lock()` answer. That is the part
 * that changes what a program does, and it is what is pinned here. The words
 * on the screen are the host's -- see `Runtime.insertDisk`.
 *
 * `pr_WindowPtr` of -1 turns it off, which AMOS writes with `L_NoReq`
 * (+Lib.s:5732) in exactly three places: `FnDrive` round a `DeviceProc`,
 * `RExist` (:5717) round a `Lock`, and `Fs_Open` (:17877) for the whole life
 * of the file selector.
 */
import { describe, expect, it } from 'vitest'
import { TokenTable } from '../tokens/stream'
import { CORE_TOKENS } from '../tokens/tables.gen'
import { tokenize } from '../tokens/source'
import { Runtime } from './runtime'
import { AmigaFS } from '../amiga/vfs'
import { EXTENSION_TOKENS } from '../ext/registry'

const table = new TokenTable(CORE_TOKENS)

/** the same, with the stock extension tables, so `Request Off` can be typed */
function bootExt(src: string): { rt: Runtime; fs: AmigaFS; out: () => string } {
  const fs = new AmigaFS()
  fs.mountMemory('DH0')
  let out = ''
  const extensions = new Map([...EXTENSION_TOKENS].map(([slot, defs]) => [slot, new TokenTable(defs, true)]))
  const rt = new Runtime(tokenize(src, table, extensions), table, {
    fs,
    extensions,
    onText: (t) => (out += t),
    maxSteps: 50_000,
    diskRequests: true,
  })
  return { rt, fs, out: () => out }
}

function boot(src: string): { rt: Runtime; fs: AmigaFS; out: () => string } {
  const fs = new AmigaFS()
  fs.mountMemory('DH0')
  let out = ''
  const rt = new Runtime(tokenize(src, table), table, {
    // `Runtime.vfs` is `fs` when it is an `AmigaFS`, which is the only kind
    // that has volumes to be missing
    fs,
    onText: (t) => (out += t),
    maxSteps: 50_000,
    // a host with somewhere to draw it. `pr_WindowPtr` is null by default,
    // which is what a headless run is and why it never asks.
    diskRequests: true,
  })
  return { rt, fs, out: () => out }
}

describe('a path naming a volume that is not here', () => {
  it('stops the program inside the call, and carries on when the disk turns up', () => {
    const { rt, fs, out } = boot('Print "before"\nOpen In 1,"Boing:x"\nPrint "after"\nClose 1\n')
    rt.frame()
    expect(rt.insertDisk).toEqual({ volume: 'Boing' })
    expect(rt.interp.blocked).toEqual({ type: 'insert', volume: 'Boing' })
    // the statement stopped BEFORE it did anything, so nothing after it ran
    expect(out()).toBe('before\n')
    for (let i = 0; i < 5; i++) rt.frame()
    expect(out()).toBe('before\n')
    // `block(..., true)` rewound the statement, so the whole `Open In` runs
    // again from the top -- which is what `Lock()` coming back late is
    fs.mountMemory('Boing')
    fs.writeTo('Boing', ['x'], new Uint8Array(1))
    rt.frame()
    rt.frame()
    expect(out()).toBe('before\nafter\n')
    expect(rt.insertDisk).toBe(null)
  })

  it('makes the call fail when it is cancelled, the way Lock answering no does', () => {
    const { rt, out } = boot('Print "before"\nOpen In 1,"Boing:x"\nPrint "after"\n')
    rt.frame()
    expect(rt.insertDisk).toEqual({ volume: 'Boing' })
    rt.cancelInsertDisk()
    expect(() => {
      for (let i = 0; i < 4; i++) rt.frame()
    }).toThrow(/Boing:x/)
    expect(out()).toBe('before\n')
    expect(rt.insertDisk).toBe(null)
  })

  it('asks again for the next Lock, because a refusal is spent on one call', () => {
    const first = boot('Open In 1,"Boing:x"\n')
    first.rt.frame()
    first.rt.cancelInsertDisk()
    expect(() => first.rt.frame()).toThrow()
    // a second program, a second `Lock`, and the handler asks again
    const second = boot('Open In 1,"Boing:x"\n')
    second.rt.frame()
    expect(second.rt.insertDisk).toEqual({ volume: 'Boing' })
  })

  /**
   * `RExist` (+Lib.s:5717) brackets its `Lock` with NoReq/YesReq, and the
   * bracket is load-bearing: Boing 3.0's DISKPRESENT sits in `Repeat ... Until
   * Exist("boing:")`, a loop whose whole point is that the answer can be no.
   * Without the bracket the first turn of it stops the program for ever.
   */
  it('is not asked by Exist, which brackets its Lock with NoReq', () => {
    const { rt, out } = boot('If Exist("Boing:") Then Print "yes" Else Print "no"\n')
    for (let i = 0; i < 3; i++) rt.frame()
    expect(out()).toBe('no\n')
    expect(rt.insertDisk).toBe(null)
    // and the bracket balanced, so the next DOS call can still ask
    expect(rt.noReq).toBe(0)
  })

  it('does not ask at all where there is no window to ask in', () => {
    // `pr_WindowPtr` null: `runHeadless` cancels the ASL and reqtools
    // requesters for the same reason, and a disk that is never coming is a
    // hang rather than a question
    const fs = new AmigaFS()
    fs.mountMemory('DH0')
    const rt = new Runtime(tokenize('Open In 1,"Boing:x"\n', table), table, { fs, maxSteps: 50_000 })
    expect(rt.diskRequests).toBe(false)
    expect(() => rt.runHeadless(20)).toThrow(/Boing:x/)
    expect(rt.insertDisk).toBe(null)
  })

  it('is refused outright under Request Off, and asked again after Default', () => {
    // `Request Off` writes 0 to T_ReqFlag (+Request.s:127), and `Req_In`'s
    // `tst.w T_ReqFlag(a5) / beq.s Req_ANo` in Req_In (+W.s:15903) sends it
    // thing to `Req_ANo`, which drops the caller's frame and answers
    // `moveq #0,d0`. AutoRequest's 0 is the negative gadget, so the handler
    // is told Cancel without anybody being asked --- and AMOS owns
    // AutoRequest by then, `SetFunction`ed at -$15c in WRequest_Start
    // (+W.s:9882). The port stored this flag and read it nowhere, so the
    // program stopped and waited for a disk instead.
    const { rt, out } = bootExt('Request Off\nPrint "before"\nOpen In 1,"Boing:x"\nPrint "after"\n')
    expect(() => {
      for (let i = 0; i < 4; i++) rt.frame()
    }).toThrow(/Boing:x/)
    expect(rt.insertDisk).toBe(null)
    expect(out()).toBe('before\n')
  })

  it('Default puts the requester back to AMOS', () => {
    // Cold installs `Warm` at `ExtAdr+ExtNb*16+4(a5)` (+Request.s:79) and
    // Warm is `Rbra L_InRequestOn` (:94). `DefRunExtensions` (+ILib.s:386)
    // calls the +$4 of all twenty-six slots, and DefRun1 (:283) and DefRun2
    // (:374) are both halves of Default.
    const { rt } = bootExt('Request Off\n')
    rt.frame()
    expect(rt.requestMode).toBe(0)
    const back = bootExt('Request Off\nDefault\nOpen In 1,"Boing:x"\n')
    back.rt.frame()
    expect(back.rt.requestMode).toBe(-1)
    expect(back.rt.insertDisk).toEqual({ volume: 'Boing' })
  })

  it('Request Wb still asks, because this port has one place to ask', () => {
    // -1 and 1 are different destinations on the machine and the same one
    // here: `Req_In` sends 1 to the Workbench requester and -1 to the AMOS
    // one, and falls from either to the other when the target is not there
    // (Req_In's `tst.b WB_Closed(a5) / bne.s .AMOS` at +W.s:15908, and
    // `tst.b T_AMOSHere(a5) / beq.s .WB` at :15914). What a program can tell
    // apart without a screen to look at is asked against not asked.
    const { rt } = bootExt('Request Wb\nOpen In 1,"Boing:x"\n')
    rt.frame()
    expect(rt.requestMode).toBe(1)
    expect(rt.insertDisk).toEqual({ volume: 'Boing' })
  })

  it('leaves the host to browse the same filesystem without being asked', () => {
    // the hook is installed for exactly as long as the interpreter is inside
    // a statement, so a file panel reading the same `AmigaFS` never trips it
    const { rt, fs } = boot('Print "x"\n')
    rt.frame()
    expect(fs.missingVolume).toBe(null)
    expect(fs.resolve('Boing:x')).toBe(null)
    expect(rt.insertDisk).toBe(null)
  })
})
