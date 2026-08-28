/**
 * The interpreter's window on the outside world. The core only needs text
 * output and input; everything else is optional and stubbed when absent so
 * programs run headless. The web runtime will implement the full interface.
 */
export interface AmosIO {
  /** Raw text output; '\n' means newline. */
  write(text: string): void
  /** Move the text cursor; -1 keeps the current coordinate. */
  locate?(x: number, y: number): void
  cls?(): void
  pen?(color: number): void
  paper?(color: number): void
  /** Read a line of input (Input / Line Input). Return undefined to make
   * the interpreter block until a line arrives (the statement re-executes). */
  input?(prompt: string): string | undefined
  /** Non-blocking key read (Inkey$); '' when no key is pending. */
  inkey?(): string
  waitKey?(): void
  /** Wait n 50ths of a second. */
  wait?(ticks: number): void
  /** Current value of the Timer 50Hz counter. */
  timer?(): number
}

/** Captures output in memory and feeds Input from a queue — for tests. */
export class BufferIO implements AmosIO {
  out = ''
  ticks = 0

  constructor(private inputs: string[] = []) {}

  write(text: string): void {
    this.out += text
  }

  input(prompt: string): string {
    this.write(prompt)
    const line = this.inputs.shift() ?? ''
    // the echo, and no newline: LEd_Loop leaves the cursor where the typing
    // stopped and Inn11 (+ILib.s:4984) is what prints InnRet afterwards
    this.write(line)
    return line
  }

  inkey(): string {
    return ''
  }

  wait(ticks: number): void {
    this.ticks += ticks
  }

  timer(): number {
    return this.ticks
  }
}
