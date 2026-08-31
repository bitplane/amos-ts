# Luna keyword-audit instructions

Continue the single full audit of the AMOS keyword set. Work through as many
unaudited keywords as the current context permits. Do not edit project code or
documentation; write only the ignored local files `audit/faithful.md` and
`audit/issues.md`.

## Resume

1. Read `CLAUDE.md`, `KEYWORDS.md`, and both report files if they exist.
2. Treat a keyword implementation already named in either report as complete.
3. Continue in `KEYWORDS.md` order from the first incomplete implementation.
4. Distinguish same-named core and extension keywords. Combine aliases only
   when the token tables show that they use the same implementation.

Create missing reports as plain Markdown. `faithful.md` needs only a heading
and a table with columns `keyword`, `implementation`, `evidence`, and `check`.
In `issues.md`, number findings `AUD-NNNN` from `AUD-0001` and give each one a
status of `defect` or `suspected`.

## Check

Establish the original behavior from shipped assembler source first, then the
shipped binary, and use a manual only when code is unavailable. Follow called
helpers far enough to compare observable behavior. Check every token-table
form, including:

- syntax and optional arguments;
- evaluation, coercion, signedness, and truncation;
- range checks and exact AMOS errors;
- return values and failure cases;
- state changes, ordering, persistence, and cleanup;
- memory, bank, screen, and file bounds;
- release-specific defects that the port should preserve.

Read offsets, error numbers, widths, routine identities, and OS calls from the
available evidence; do not supply them from memory. Different internal
structure is fine when an AMOS program observes the same result. Missing tests,
style, performance, and browser-imposed host limitations are not findings by
themselves. Use <https://amos.bitplane.net> when running a small program in the
live browser is the clearest way to reproduce port behavior.

## Record

For a faithful implementation, append one compact row naming the exact source
line or binary routine/address and what behavior was checked.

For a defect or suspicion, append one self-contained entry to `issues.md` with:

- keyword and implementation identity;
- `defect` when evidence proves an observable mismatch, otherwise `suspected`;
- original source line or routine/address;
- TypeScript file and line;
- the observable difference and a small reproducer when practical.

Do not put an issue in `faithful.md`, fix it, redesign it, or add general review
notes. Quote only the minimum necessary source text. Before stopping, check
that every keyword examined appears in exactly one report and state the next
unaudited keyword in your handoff.
