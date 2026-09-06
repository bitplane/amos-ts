import { describe, expect, it } from 'vitest'
import { ExecMessageSystem, NT_MESSAGE, NT_MSGPORT } from './osmessage'

describe('OS DevKit Exec messages, ports and signals', () => {
  it('creates the complete MsgPort and manages its public name', () => {
    const exec = new ExecMessageSystem()
    const port = exec.createPort('public', -2)
    expect(exec.memory.nodeType(port)).toBe(NT_MSGPORT)
    expect(exec.memory.nodePriority(port)).toBe(-2)
    expect(exec.portSignalTask(port)).toBe(exec.currentTask)
    expect(exec.memory.listHead(port + 20)).toBe(port + 24)
    exec.addPort(port)
    expect(exec.findPort('public')).toBe(port)
    exec.remPort(port)
    expect(exec.findPort('public')).toBe(0)
  })

  it('puts, gets and replies native Messages in FIFO order', () => {
    const exec = new ExecMessageSystem()
    const requestPort = exec.createPort()
    const replyPort = exec.createPort()
    const a = exec.allocMessage(replyPort, 0x1234)
    const b = exec.allocMessage(replyPort, 20)
    expect(exec.memory.nodeType(a)).toBe(NT_MESSAGE)
    expect(exec.messageReplyPort(a)).toBe(replyPort)
    expect(exec.messageLength(a)).toBe(0x1234)
    exec.putMsg(requestPort, a)
    exec.putMsg(requestPort, b)
    expect(exec.waitPort(requestPort)).toBe(a)
    expect(exec.getMsg(requestPort)).toBe(a)
    exec.replyMsg(a)
    expect(exec.getMsg(requestPort)).toBe(b)
    expect(exec.getMsg(replyPort)).toBe(a)
    expect(exec.getMsg(requestPort)).toBe(0)
  })

  it('allocates requested or lowest free signals and preserves SetSignal return state', () => {
    const exec = new ExecMessageSystem()
    expect(exec.allocSignal(3)).toBe(3)
    expect(exec.allocSignal(3)).toBe(-1)
    expect(exec.allocSignal(-1)).toBe(0)
    expect(exec.setSignal(0b1010, 0b1111)).toBe(0)
    expect(exec.setSignal(0b0100, 0b0110)).toBe(0b1010)
    expect(exec.wait(0b1100)).toBe(0b1100)
    expect(exec.wait(0b1100)).toBeNull()
    exec.freeSignal(3)
    expect(exec.allocSignal(3)).toBe(3)
  })

  it('signals a port owner and reports a wait that would block', () => {
    const exec = new ExecMessageSystem()
    const port = exec.createPort()
    expect(exec.waitPort(port)).toBeNull()
    exec.putMsg(port, exec.allocMessage())
    expect(exec.wait(1 << exec.portSignalBit(port))).not.toBeNull()
  })

  it('deletes a port allocation and releases its signal', () => {
    const exec = new ExecMessageSystem()
    const port = exec.createPort()
    const bit = exec.portSignalBit(port)
    exec.deletePort(port)
    expect(() => exec.portSignalBit(port)).toThrow(RangeError)
    expect(exec.allocSignal(bit)).toBe(bit)
  })

  it('does not claim or free the signal bit of an embedded static port', () => {
    const exec = new ExecMessageSystem()
    expect(exec.allocSignal(0)).toBe(0)
    const port = exec.createPort('', 0, 34, false)
    expect(exec.portSignalBit(port)).toBe(0)
    exec.deletePort(port)
    expect(exec.allocSignal(0)).toBe(-1)
  })
})
