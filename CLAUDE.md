# Project working rules

`README.md` covers the product. Architecture belongs in the nearest subsystem
README or source file; this file only records repository-wide working rules.

## Evidence

Prefer shipped assembler source, then the library binary, then its manual. The
binary decides when sources disagree. Use `src/cli/extdis.ts` and the `.fd`
files in the corpus rather than recalling routine or LVO offsets.

Citations must be checkable: name a symbol, routine or binary address. Vendor a
document before quoting it, and preserve quoted text exactly.

Before treating a library as unavailable, check the indexed corpus at
`../amos-files`. Fixtures and third-party binaries are local and gitignored.

## Coverage

Finish an extension as one unit. Do not leave a partially covered manifest row.
Judge coverage by the whole keyword table rather than the supplied demos.

`KEYWORDS.md` is generated from `src/coverage/status.ts`; run
`npm run manifest` before every commit. Do not hand-edit generated inventories
or copy their counts into prose.

An `n/a` entry describes what the keyword is and which future capability would
make it executable. It is not a substitute for an unimplemented backend.

Source prose states the current conclusion. Keep investigation history in git,
not as a sequence of corrections in comments or documentation.

## Validation

`npm test` runs Vitest and then the faithfulness gate. Read the exit code: the
test summary can pass before the teardown gate fails.

```sh
npm run typecheck
npm run lint
```

There is no repository formatter. Avoid mechanical reformatting of packed
coverage tables.

The corpus contains Amiga files with binary bytes and may need binary-safe
searches. Verify extracted file sizes against archive listings.

## Writing

Keep durable conclusions, exact evidence and non-obvious constraints. Remove
progress reports, superseded beliefs, copied counts and generic justification.
Put extension-specific quirks beside that extension, not in shared backends.

`src/runtime/README.md` defines `DEVIATION:` and `DEFECT:`. A deviation is an
observable difference in this port; a defect is an original bug reproduced for
compatibility. Both require concrete evidence.
