# Known limits

`KEYWORDS.md` is the generated, authoritative inventory. It distinguishes
faithful, approximated, missing and not-applicable keywords and gives the
reason for every non-faithful result. Regenerate it with:

```sh
npm run manifest
```

This file describes the boundaries rather than repeating generated counts or
per-keyword notes.

## Missing backends

- **OS DevKit native calls:** `_lib call`, `_call`, `a3 pointer` and `give me`
  require executable 68k code or stable addresses for AMOS interpreter
  internals. The reusable library-backed OS DevKit operations are callable;
  their operation-level verdicts live in `src/ext/osbackend.ts` and feed the
  generated keyword inventory directly; `src/cli/osbackend.ts --json` adds
  binary routine and library-call evidence without creating another list.
- **OrgAsm 1.0 (`orgasm-1.0`):** its interface ultimately jumps into 68k code loaded by the
  program. Porting the surrounding Exec, Intuition and GadTools calls cannot
  make that code executable.
- **BSDSocket 1.1.4 (`bsdsocket-1.1.4`):** requires `bsdsocket.library` and a host-network policy.
  It is intentionally deferred.

These are future machine or host integrations, not unfinished AMOS language
semantics.

## Structural approximations

Implemented keywords may still differ where a browser-hosted TypeScript
runtime cannot reproduce the original mechanism. The common boundaries are:

- arbitrary 68k callbacks, negative-LVO calls and AMOS internal pointers;
- native memory corruption, allocator fragmentation and pointer arithmetic
  outside owned allocations;
- multitasking priority, interrupt handlers and sub-frame beam timing;
- physical serial, parallel, printer, disk and expansion-card hardware;
- exact analogue audio characteristics and cycle-level chipset timing;
- host requesters, browser audio scheduling and localized system UI.

These keywords remain callable. Their individual notes in `KEYWORDS.md` state
what a program can observe differently. `DEVIATION:` comments live beside the
implementation; `src/runtime/README.md` defines that marker.

## Finite fidelity work

Some approximations are ordinary implementation work rather than platform
boundaries. Current examples include broader native tag/structure handling,
remaining OS DevKit rendering details, additional decrunch handlers and a few
codec paths that are conformant but not byte-identical. Treat the metadata
that generates `KEYWORDS.md` as the backlog; do not maintain another keyword
list here.

## Compatibility sampling

`runreport` is an exploratory corpus tool, not a committed release metric:

```sh
npm run cli -- src/cli/runreport.ts --all <roots...>
```

Programs that reach a frame loop or wait for input are normally working. For
actionable failures, use the report's program and first error rather than
copying a corpus snapshot into this document.
