# amos-ts

A TypeScript port of AMOS Professional, the Amiga BASIC, and of the third-party
extensions people wrote for it. `README.md` covers what it is and how to run it.

Architecture is documented where it applies rather than here:

- `src/amiga/README.md` decides what belongs in the modelled machine layer.
- `src/runtime/README.md` defines the `DEVIATION:` and `DEFECT:` markers.
- `src/ext/registry.ts` defines the evidence tiers, at some length.

This file holds the working rules that no file states, and that a session
otherwise has to be told again.

## Evidence

Rank sources: shipped assembler source, then the library binary, then the
manual. A manual is context. The disassembly is truth, and where they disagree
the binary wins and the disagreement is worth writing down.

`manual` as an evidence tier is legal only when no binary exists anywhere.
Every keyword carries a routine number, so `src/cli/extdis.ts` can find the
code in tens of instructions. Choosing a paragraph over shipped code is not a
shortcut, it is a wrong answer.

Before declaring a library unreadable, look on Aminet and in the corpus.
Absence from this machine is not absence from the world. That check has
already turned up eight libraries assumed lost.

Never recall an LVO offset from memory. The corpus holds 54 `.fd` files under
the GUI 2.10 sources. Read the offset out of one.

Cite what you read. `+Lib.s:3650` and `$1e78` are checkable; "the source says"
is not. `src/ext/citations.test.ts` verifies the ones it can reach.

## Quotations

Vendor the document before quoting it. A quotation that cannot be checked
against a file in the corpus does not go in.

Never tidy anything inside quotation marks. Not a typo, not a missing verb,
not an umlaut. `st erase` quoted an author's "If is OK" as "It is OK" and read
perfectly, which is how it survived. The author's mistakes are evidence about
the author.

## Coverage

An extension row reads 0% or 100%. Partial coverage is a state to leave, not a
state to record.

Judge a port by its whole keyword set, not by whether the demos pass. The
programs that matter were never published.

An `n/a` must say what the keyword IS. It may never name a capability this
port lacks, because that is a gap wearing a classification.

Source prose states what is true now. It is not a history of what was once
believed, and a correction rewrites the claim rather than appending to it.

## Running things

`npm test` is `AMOS_COVERAGE_GATE=1 vitest run`, and the faithfulness gate runs
at teardown, after the summary prints. Read the exit code. A run can print
5,001 passing tests and still exit 1.

`npm run lint` is oxlint. `npx tsc --noEmit` typechecks. There is no prettier
here and adding one would be a mistake: `src/coverage/status.ts` holds packed
keyword lists that reformat into a 3,700 line diff.

The corpus is at `../amos-files`, 45,743 files with a checksum index. Reading
it needs `dangerouslyDisableSandbox: true`.

Verify extracted sizes against the archive listing. 7-Zip has silently
truncated corpus files twice while reporting success. `ancient` decodes the
Amiga crunchers and is an independent check on our codecs, though it will not
open an LHA container.

`fixtures/` is gitignored. Third-party libraries are read for behaviour and
never redistributed, and their code is never copied.

## Writing

The unslop rules in `~/.claude/CLAUDE.md` apply to everything here: doc
comments, coverage notes, commit messages, task descriptions, markdown.

Two carve-outs, because this project settled on the words first:

- "API surface" means the whole keyword set of a library, which is the unit
  coverage is judged in.
- "harness" means a test's boot and run helpers, which is what the test files
  already call them.

Rules 27 to 31 are the ones that matter here. A doc comment earns its place by
naming an address, a routine number, an instruction or a measurement. If a
sentence would read the same in another project's source, it says nothing
about this one.
