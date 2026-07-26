# AMOS extensions

AMOS Professional could be extended with third-party libraries that added
keywords to the language. Dozens were written and released on Aminet, on
coverdisks and by post, and a great many AMOS programs — including most of the
ambitious ones — depend on at least one of them. A player that only handles the
stock keyword set will load a large fraction of the surviving AMOS corpus and
then fail on the first line that matters.

This directory documents how extensions are handled here. The short version is
that **an extension is identified by what it is, never by where it was
installed**, and everything below follows from why that has to be so.

## A slot number is not an identity

AMOS Professional loads up to 26 extensions, each into a numbered slot. The
filenames come from the interpreter config: slot *n* is loaded from config
message *15+n* (`+B.s:2149-2166`, `+Interpreter_Config.s:150-157`). A stock
installation fills five of them:

| slot | config message | library |
|---|---|---|
| 1 | 16 | `AMOSPro_Music.Lib` |
| 2 | 17 | `AMOSPro_Compact.Lib` |
| 3 | 18 | `AMOSPro_Request.Lib` |
| 5 | 20 | `AMOSPro_Compiler.Lib` |
| 6 | 21 | `AMOSPro_IOPorts.Lib` |

Slots 4 and 7–26 ship empty, for the user to fill in.

When a program uses an extension keyword, the tokenised file records it as
`EXTENSION, slot, nparams, token id` — and nothing else. No name, no version,
no checksum. On load, `Ver_Extension` (`+Verif.s:430-460`) indexes
`AdTokens[slot]`, and if that slot is empty raises error 5, *"Extension not
present"*. It never checks that the extension sitting in the slot is the one
the program was written against. If slot 12 holds a different library than it
did on the author's machine, the program does not fail — it silently executes
whatever keywords happen to live at those offsets.

So a slot number is a property of the machine a program was saved on. It
travels with the program and means nothing away from that machine. Extension
authors compound this by recommending a slot in their documentation — the Misc
extension's manual says *"load the Interpreter config and enter at number
23"* — which is a suggestion, not a reservation. Two users following two
manuals collide; a user who ignores both collides with everybody.

**Consequence:** to run somebody else's program we have to work out which
extension each slot actually held, from evidence in the program itself. That is
what `src/ext/identify.ts` does, and it is why `src/ext/registry.ts` is keyed by
identity strings like `intuition-1.3b` rather than by slot.

## How identification works

Three kinds of evidence are available, all carried by the program:

1. **The set of token ids used in the slot.** A token id is the byte offset of
   that keyword's entry within the extension's token table, so the ids used by a
   program form a fingerprint of one specific table. This is the hard
   constraint: a candidate extension must account for *every* observed id. One
   unexplained id disqualifies it.

2. **The recorded argument count.** `Ver_Extension` (`+Verif.s:452-460`) writes
   a byte beside each use: `$FF` when the slot held an AP20-format library, and
   the call's real argument count when it held an older one. Where counts are
   present they must agree with the candidate's parameter spec. Two caveats,
   both found by measurement rather than assumed:
   - The marker reflects the format of the library loaded when the program was
     *last verified*, not the format of the copy we hold. AMOS 1.3-era programs
     carry recorded counts for extensions that shipped as AP20 libraries under
     AMOS Pro, so the marker is reported but not enforced.
   - A zero where the keyword plainly takes arguments means the byte was never
     written — the program was saved without a clean verify pass. Every instance
     in the corpus is in a file the extension's own author named `bug1.amos` or
     `bug2.amos`. It is treated as absence of evidence, not as an arity of zero.

3. **Whether the ids land on entries with usable names**, which separates a real
   table from a coincidental numeric fit.

A candidate that survives all of this is reported with a confidence:
`exact` (exactly one candidate survives), `probable` (several survive but only
one has been seen in this slot before), `ambiguous` (the evidence genuinely does
not separate them) or `unknown` (nothing explains it). **Ambiguous and unknown
are reported, not guessed at.** A wrong binding does not produce an error; it
silently runs the wrong keywords, which is worse than declining to choose.

The regression oracle for all of this lives in `src/ext/ext.test.ts`: the
configured slot map is thrown away and every slot used anywhere in the fixture
corpus must resolve to exactly one extension with no token id left over.

## Evidence tiers

Reading an extension's token table gives us keyword names and argument counts
for free. It tells us almost nothing about what the keywords *do*. Those are
tracked separately, because the difference decides whether a ported keyword can
ever be called faithful:

| tier | meaning |
|---|---|
| `source` | Original assembler source is available; behaviour can be read directly. |
| `manual` | The extension's own manual or command reference documents behaviour. |
| `table` | Token table only. Names and arities are known; behaviour is inferred. |

A keyword implemented from `table`-tier evidence alone **cannot** be marked
faithful, however plausible the implementation looks. It is guesswork from a
name, and the honest classification is structural, with a NOTES entry saying so.
This mirrors the rule for the core language, where faithful means verified
against the original 68k source, the manual, or byte-exact artifacts.

68k machine code is never executed here, so a binary-only extension is not
something we can run to find out. Behaviour has to come from documentation or
source, or be marked as unknown.

## The registry

An extension is described by a manifest in `src/ext/manifests/<id>.json`
recording identity, provenance and evidence tier, and its files live in
`fixtures/extensions/<id>/`. Token tables are generated from the two together
into `src/ext/tables.gen.ts` by `src/cli/genext.ts`.

The split is deliberate: `fixtures/` is gitignored because the AMOS libraries
are not ours to redistribute, so manifests are tracked separately and the
registry's documentation, provenance and generated tables all survive a clone
even though the binaries have to be supplied locally. `genext` skips — with a
warning, not an error — any manifest whose fixture is absent.

Currently registered:

"Keywords" counts named table entries; unnamed entries are argument-count and
function-form variants of the keyword above them.

| id | evidence | keywords | notes |
|---|---|---|---|
| `amospro-music-2.0` | source | 49 | stock, slot 1 |
| `amospro-compact-2.0` | source | 3 | stock, slot 2 |
| `amospro-request-2.0` | source | 3 | stock, slot 3 |
| `amospro-compiler-2.0` | source | 15 | stock, slot 5 |
| `amospro-ioports-2.0` | source | 39 | stock, slot 6 |
| `intuition-1.3b` | source | 183 | Table assembled from its own `itokens.s`. |
| `personal-1.0b` | source | 110 | Full assembler source ships with it. |
| `jd-5.3` | source | 130 | Assembler source and a per-keyword manual. |
| `jd-prt-1.3` | source | 63 | Printer control; source and manual. |
| `jd-colour-1.4` | source | 44 | Palette manipulation; source, no manual. |
| `misc-1.0` | source | 12 | Public Domain, with both source and a manual documenting every keyword. Recommends slot 23. |
| `turbo-plus-1.9` | manual | 87 | Later than 1.0 and better evidenced: full English doc set. PD release by Manuel Andre. |
| `ldos-2.5` | manual | 77 | Manual located on the AMOS PD Library CD. |
| `easylife-1.0` | manual | 72 | Documented; by Paul Hickman. |
| `lserial-2.1` | manual | 15 | Unregistered shareware build; documented. |
| `stars-2.33` | manual | 11 | Documented; (c) 1993 J. G. Doig. |
| `turbo-plus-1.0` | table | 134 | No manual found for *this* build; see 1.9. |
| `gui-1.61` | table | 103 | No manual found. |
| `tome-4.0` | table | 67 | Two versions on the disc; identification ambiguous between them. |
| `amos3d-1.0` | table | 64 | Commercial Europress product; no manual found. |
| `range-1.0` | table | 47 | No manual or attribution found. |
| `sticks-1.01b` | table | 16 | Shareware build that disables some of its own keywords. |
| `dump-1.0` | table | 8 | Low-level disc access; much of it likely n/a here. |
| `ctext-1.0` | table | 6 | No manual found. |

Twelve of these came from a single source — the AMOS PD Library CD (Weird Science,
1994) — scanned with `libscan` and written up by hand. Their `provenance` records
that the disc's own copyright notice disclaims any assumption of public-domain
status, so redistribution terms are unverified for all of them.

Two of these carry identity strings that disagree with how they were
distributed, and the registry records both rather than quietly picking one:
LDos's `$VER` cookie says 2.5 while its copyright banner still says 1.0, and the
Intuition extension ships in a folder called `Intuition-41.95` (41.95 is the
`intuition.library` version it targets) while its own guide and makefile say
1.3b.

### Token tables from source

Extensions that ship source but no linked library are not out of reach. The
token table is a plain run of `dc.w`/`dc.b` directives, so `src/ext/tokensrc.ts`
assembles it back to the exact bytes the linker would have produced and parses
them with the same `parseTokenTable` used for binaries. That makes a
source-derived table byte-exact ground truth rather than a hand transcription.

The Intuition extension is the worked example. Its distribution contains no
`.Lib` at all, only `Intuition.lib.info`. Its table is assembled from
`src/itokens.s`, and the id base is *proven* rather than assumed: exactly one
offset in −2048..2048 (K=6) maps all 149 distinct slot-14 token ids observed
across the corpus onto valid entry starts. One fit out of 2049 candidates is not
a coincidence.

## Adding an extension

1. Create `fixtures/extensions/<id>/` and drop in the `.Lib` binary, its source
   if you have it, and any manual. Choose `<id>` as `name-version` using the
   version the **binary reports about itself** (`$VER` cookie or banner), not
   the version on the archive it came in.
2. Write `src/ext/manifests/<id>.json`. Copy a neighbour. Required: `id`,
   `name`, `version`, `source` (`binary` or `tokens`), `evidence`,
   `idBaseEvidence`, `provenance`, and either `library`+`format` or
   `tokenSource`. Record every identity string you find in the binary — a later
   copy may carry only one of them. Be honest in `idBaseEvidence`:
   `calibrated` means proven against observed programs, `assumed` means taken
   from the layout of similar libraries and possibly uniformly offset.
3. Run `npm run cli -- src/cli/genext.ts` to regenerate the tables.
4. Run `npm test`. The registry tests check that the table parses, that ids are
   unique and even, and that provenance and evidence are recorded.
5. If you have programs that use it, add a few under
   `fixtures/extensions/<id>/progs/` — that is what turns `idBaseEvidence` from
   `assumed` into `calibrated`, and it guards the table against regressions.

Implementing the keywords is a separate step from registering the extension, and
a registered-but-unimplemented extension is useful on its own: programs using it
detokenise with real keyword names instead of `{ext12:$02d4}`, and unimplemented
functions return a type-correct default rather than a type mismatch.

## Finding what is missing

`src/cli/extscan.ts` walks a tree of `.AMOS` files and reports what each slot
most plausibly held:

```
npm run cli -- src/cli/extscan.ts /path/to/collection --json wanted.json
```

The interesting output is the rows it *cannot* identify. Each unexplained token
id is a specific, actionable request — "find the extension whose token table has
an entry at offset `$04d2` taking one argument" — and `--json` writes them out
as a wanted list. Working through a large archive is then mechanical rather than
a matter of recognising keyword names by eye.

Against the bundled corpus (426 programs) every slot currently resolves exactly,
with no unexplained ids. That is a starting point, not a finish line: the corpus
is the official releases plus the Intuition distribution's own samples, and a
real sweep of Aminet would turn up extensions nobody here has seen.

## Collections that identify themselves

`src/cli/libscan.ts` is the other half. Where extscan reads programs and reports
the slots they use, libscan reads the `.Lib` files and reports what each token
table *contains* — every keyword the extension has, not just the ones some
program happened to call:

```
npm run cli -- src/cli/libscan.ts /path/to/collection --json libs.json
```

A collection carrying programs and their libraries together — a PD library
disc, an install, a coverdisk rip — can therefore resolve its own slot numbers.
`extscan --libs` adds the scanned tables to the identification pool for that
run:

```
npm run cli -- src/cli/extscan.ts /path/to/collection --libs /path/to/collection
```

A hit here is a **lead, not a registry entry**, and extscan labels it
`UNREGISTERED` to keep the two apart. A matching id set establishes which token
table a slot held; it says nothing about the extension's name, version, author,
licence or behaviour, and the id base is assumed rather than calibrated.
Promoting a lead means doing the work in "Adding an extension" above —
including recording where it came from.

This is also how to sanity-check a corpus you cannot fully parse. Token ids are
byte offsets into a real table, so a desynchronised reader cannot produce
dozens of ids that all land inside one library. Slots resolving exactly against
libraries found beside the programs is strong evidence the tokenised stream was
read correctly, whatever version of AMOS wrote it.
