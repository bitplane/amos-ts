# The npm package

`amos-ts` on npm is the machine without the browser around it: the loaders,
the token tables, the interpreter and the runtime. Nothing from `src/web/` is
exported, so the embeddable player is not in here. That one is a module
published beside the site, and `README.md` shows how to import it.

```sh
npm install amos-ts
```

```js
import { Runtime, TokenTable, CORE_TOKENS, tokenize, defaultExtensionTables } from 'amos-ts'

const table = new TokenTable(CORE_TOKENS)
const exts = defaultExtensionTables()   // the stock extension slots

let out = ''
const rt = new Runtime(tokenize('Print "Hello" : Print 42', table, exts), table, {
  extensions: exts,
  onText: (t) => (out += t),
})
rt.runHeadless(1000)
console.log(out)   // "Hello\n 42\n". The space before 42 is AMOS's, not a
                   // typo: it writes one before every non-negative number
```

`runHeadless(n)` runs up to `n` steps and returns a status: `ended`, `blocked`
(waiting on input, a `Wait`, or a resource still loading) or `running` if it
hit the step cap. Nothing in the runtime blocks the thread. A driver calls it
once per frame at 50 Hz, which is what the browser player does.

To load a real program rather than a string, `parseAmosFile` gives you its
token stream and banks, and `loadProgram` takes it from there.

`src/index.ts` is the whole export list, and it is short enough to read.
`docs/internals.md` says what each of those subsystems covers.
