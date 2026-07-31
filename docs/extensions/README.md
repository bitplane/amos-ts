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
| `disassembly` | The library binary was disassembled. Ranks with `source`. |
| `manual` | The extension's own manual or command reference documents behaviour. |
| `table` | Token table only. Names and arities are known; behaviour is inferred. |

`disassembly` deserves a word, because it is the tier that turns a dead end
into a job of work. Reading the shipped binary is *more* authoritative than a
manual — LDos's manual states a password-length check that only one of its two
crypt routines has, which the code settles and the prose does not. The token
table makes it targeted rather than heroic: every keyword carries a routine
number, so the read is tens of instructions, not thousands. What separates it
from `source` is the failure mode. There are no symbols and no comments, data
and code are easily confused (a string table disassembles into plausible
nonsense), and nothing can be grepped for callers. So a keyword read this way
can be faithful, but a future reader needs to know that is where it came from
— which is why it is its own tier rather than folded into `source`.

Evidence is recorded per extension, but it is really per keyword: an
extension whose headline tier is `manual` may still have individual keywords
established by disassembly, and those carry a NOTES entry saying so.

68k machine code is never *executed* here — that rule is unchanged. Reading it
is the same activity as reading `+Lib.s`.

A keyword implemented from `table`-tier evidence alone **cannot** be marked
faithful, however plausible the implementation looks. It is guesswork from a
name, and the honest classification is structural, with a NOTES entry saying so.
This mirrors the rule for the core language, where faithful means verified
against the original 68k source, the manual, or byte-exact artifacts.

Because the code is never run, a binary-only extension cannot be probed by
experiment — behaviour has to be read out of the disassembly, out of
documentation, or be marked unknown.

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

Currently registered — regenerate with `npm run cli -- src/cli/genextdoc.ts`
after adding a manifest:

<!-- BEGIN registry (generated by src/cli/genextdoc.ts) -->

65 extensions are registered, 5 of them stock.
Ordered by evidence tier, then by size. "Keywords" counts DISTINCT named table
entries, matching `KEYWORDS.md`: unnamed entries are argument-count and
function-form variants of the keyword above them, and a name can legitimately
appear twice (IOPorts declares `serial speed` at two ids). "Seen at" is the
slots corpus programs actually used it in, which is evidence; "Slot" is what
the config or the extension's own manual suggests, which is not.

| id | name | evidence | keywords | seen at | slot |
|---|---|---|---|---|---|
| `intuition-1.3b` | Intuition Extension | source | 183 | 14 | recommends 25 |
| `jd-5.3` | JD | source | 130 | 22 | — |
| `jd-4.6` | JD | source | 125 | 22 | — |
| `personal-1.0b` | Personnal Extension | source | 108 | 13 | — |
| `sln-2.0` | SLN | source | 70 | — | recommends 24 |
| `jd-prt-1.3` | JD Printer | source | 63 | — | — |
| `amospro-music-2.0` | Music | source | 49 | 1 | stock, slot 1 |
| `jd-colour-1.4` | JD Colour | source | 44 | — | — |
| `amospro-ioports-2.0` | IOPorts | source | 38 | 6 | stock, slot 6 |
| `gamesupport-1.2` | GameSupport | source | 37 | — | recommends 23 |
| `amospro-colours-1.0` | AMOSPro Colours | source | 27 | — | recommends 23 |
| `amospro-compiler-2.0` | Compiler | source | 15 | 5 | stock, slot 5 |
| `misc-1.0` | Misc Extension | source | 12 | — | recommends 23 |
| `p61-1.2` | P61 Music | source | 9 | — | recommends 25 |
| `fileid-1.0` | FileID | source | 6 | — | — |
| `amospro-compact-2.0` | Compact | source | 3 | 2 | stock, slot 2 |
| `amospro-request-2.0` | Request | source | 3 | 3 | stock, slot 3 |
| `ctext-1.0` | CText | disassembly | 6 | 8 | recommends 8 |
| `os-devkit-1.61` | OS-DevKit | manual | 1047 | 20 | recommends 20 |
| `amcaf-1.50` | AMCAF | manual | 280 | — | recommends 8 |
| `gui-2.10` | GUI | manual | 204 | — | recommends 24 |
| `easylife-1.10` | Easy Life | manual | 156 | — | recommends 16 |
| `turbo-plus-2.15` | TURBO Plus | manual | 152 | — | — |
| `jd-5.9` | JD | manual | 133 | — | recommends 22 |
| `personnal-1.1` | Personnal | manual | 126 | 13 | — |
| `easylife-1.44` | Easy Life | manual | 108 | — | recommends 16 |
| `the-game-0.9` | The Game Extension | manual | 103 | — | recommends 14 |
| `ldos-2.6` | LDos | manual | 85 | — | recommends 10 |
| `opal-1.1` | Opal | manual | 78 | — | recommends 21 |
| `ldos-2.5` | LDos | manual | 77 | 10 | recommends 10 |
| `easylife-1.0` | Easy Life | manual | 72 | — | recommends 16 |
| `jd-prt-1.4` | JD Printer | manual | 69 | — | recommends 21 |
| `powerbobs-1.0` | Power Bobs | manual | 65 | — | recommends 13 |
| `eme-3.0` | Enhanced Music Extension | manual | 59 | — | recommends 1 |
| `jd-colour-2.0` | JD Colour | manual | 56 | — | recommends 20 |
| `delta-1.6` | Delta | manual | 46 | — | recommends 15 |
| `jd-int-1.3` | JD Intuition | manual | 33 | — | recommends 18 |
| `tools-1.01` | Tools | manual | 33 | — | recommends 23 |
| `make-1.30` | Make | manual | 32 | — | recommends 17 |
| `bsdsocket-1.1.4` | BSDSocket | manual | 30 | — | recommends 18 |
| `med-7.1` | MED | manual | 28 | — | — |
| `delta-1.4` | Delta | manual | 26 | — | recommends 15 |
| `aga-1.0` | AMOS AGA | manual | 24 | — | recommends 20 |
| `tft-0.6` | TFT | manual | 22 | — | recommends 25 |
| `locale-0.26` | Locale | manual | 20 | — | recommends 17 |
| `sticks-1.01b` | Sticks | manual | 16 | 17 | recommends 17 |
| `butility-1.21` | BUtility | manual | 15 | — | — |
| `lserial-2.1` | LSerial | manual | 15 | 11 | recommends 11 |
| `ercole-1.7` | Ercole | manual | 11 | — | recommends 10 |
| `jvp-1.01` | JVP NoKids | manual | 11 | — | recommends 25 |
| `stars-2.33` | Stars | manual | 11 | — | recommends 20 |
| `jd-k3-1.1` | JD K3 | manual | 6 | — | recommends 19 |
| `jotre-1.0` | Jotre | manual | 5 | — | recommends 22 |
| `first-0.1` | First | manual | 4 | — | recommends 22 |
| `craft-1.0` | CRAFT | table | 138 | — | recommends 18 |
| `turbo-plus-1.0` | TURBO Plus Extension | table | 134 | 12 | recommends 12 |
| `gui-1.61` | AMOSPro GUI Extension | table | 103 | 24 | recommends 24 |
| `turbo-plus-1.9` | TURBO Plus | table | 87 | 12 | recommends 12 |
| `range-2.0` | Range | table | 73 | — | recommends 9 |
| `tome-4.0` | TOME | table | 67 | 7 | recommends 7 |
| `amos3d-1.0` | AMOS 3D | table | 64 | 4 | recommends 4 |
| `jd-prt-1.1` | JD Printer | table | 58 | — | — |
| `d-sam-1.01` | D-Sam | table | 50 | — | recommends 15 |
| `range-1.0` | Range | table | 48 | — | recommends 9 |
| `dump-1.0` | Dump | table | 8 | — | recommends 10 |

<!-- END registry -->

Notes worth having on individual entries, which the table cannot carry:
`turbo-plus-1.0` and `1.9` are different tables, not subsets of each other, and
neither is a subset of `2.15`. `tome-4.0` has two versions on the disc and
identification is ambiguous between them. `sticks-1.01b` is a shareware build
whose PD limitation is nag requesters, not disabled keywords — the one
"Command not available in this version" guards the two-argument `Stick Fire`,
which its own manual documents as a deliberate placeholder. Registration bought
extra commands that are not in this table at all. `dump-1.0` is low-level disc access,
much of it likely n/a here. `intuition-1.3b` ships no `.Lib` at all — see
"Token tables from source" below.

Twelve entries came from a single source — the AMOS PD Library CD (Weird
Science, 1994) — scanned with `libscan` and written up by hand. Their
`provenance` records that the disc's own copyright notice disclaims any
assumption of public-domain status, so redistribution terms are unverified for
all of them.

Two carry identity strings that disagree with how they were
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

The Intuition extension is the worked example. The copy in the
AMOS-Professional-Official tree contains no `.Lib` at all, only
`Intuition.lib.info`, so its table is assembled from `src/itokens.s`, and the id
base is *proven* rather than assumed: exactly one offset in −2048..2048 (K=6)
maps all 149 distinct slot-14 token ids observed across the corpus onto valid
entry starts. One fit out of 2049 candidates is not a coincidence.

A linked `Intuition.lib` **does** survive elsewhere — in the Ultimate Amiga
archive, under `ie13b/Intuition/` — and it corroborates the assembly rather
than contradicting it: 183 named entries against our 183, **zero** differing
id-to-name pairs. It carries one extra unnamed entry at id `$0` that the
source-assembled table does not, which is why a comparison keyed on whole id
sets calls the two different. `libscan --gap` keys on named entries for exactly
this reason and reports the padding difference separately.

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
3. Run `npm run cli -- src/cli/genext.ts` to regenerate the tables, then
   `npm run cli -- src/cli/genextdoc.ts` to put the new entry in the table
   above.
4. Run `npm test`. The registry tests check that the table parses, that ids are
   unique and even, and that provenance and evidence are recorded.
5. If you have programs that use it, add a few under
   `fixtures/extensions/<id>/progs/` — that is what turns `idBaseEvidence` from
   `assumed` into `calibrated`, and it guards the table against regressions.

Implementing the keywords is a separate step from registering the extension, and
a registered-but-unimplemented extension is useful on its own: programs using it
detokenise with real keyword names instead of `{ext12:$02d4}`, and unimplemented
functions return a type-correct default rather than a type mismatch.

### Before you implement: ask what it contests

```
npm run contested -- eme
```

Dispatch is by name (that is what "a slot number is not an identity" forces),
so two products spelling a keyword the same way is not a syntax error — it is
one layer silently answering for the other, in every program, forever. The
token tables know this before a line of the port is written:

```
eme (eme-3.0)
59 keywords, 49 contested

armed (49) — the other side is ported — porting this one collides
  bell           amospro-music*
  boom           amospro-music*
  ...
```

Every collision needs a decision, and there are only two: the names mean the
same thing and one implementation serves both, or they do not and the port
declares them in `qualified` so each answers only on its own slot (see
`src/runtime/extimpl.ts`). Finding that out afterwards means threading the
declaration back through work that is already finished.

Run it with no argument for the whole picture — `live` is what is misdispatching
today, `armed` is what the next port sets off.

### And check whether the releases agree with each other

A port serves several identities of one product, and releases do not always
call the keywords the same thing. JD's printer companion renamed **all 58** of
them between 1.1 and 1.3 — `Prt Bold` became `Jd Prt Bold` — so the two tables
share not one name. EasyLife did the same to its prefix between 1.09 and 1.10
(`znsx` → `elznsx`). Intuition and IntuiExtend instead ship an AMOS build and
an AMOS Pro build of a *single* release that disagree on some names.

This fails silently and is worth stating plainly: dispatch is by name, a name
nothing registered is simply unimplemented, and an unimplemented function
returns a type-correct default rather than erroring. A program written against
the release you did not port runs, prints nothing useful, and reports no
problem.

The fix is `aliases` on the `ExtensionImpl` (`src/runtime/extimpl.ts`). Implement
one set of names — whichever release you worked from — and declare what the
others call them, keyed by identity:

```ts
{
  ids: ['jd-prt-1.1', 'jd-prt-1.3', 'jd-prt-1.4'],
  functions: makeJdPrtFunctions,
  aliases: { 'jd-prt-1.1': jdPrt11Aliases() },
}
```

Each alias binds to the slots where *that* identity was identified, exactly as
`qualified` does, so `prt bold` answers where Prt 1.1 sits and nowhere else.
Where the rename is a rule rather than a list, derive the map from the
registered table instead of transcribing it — 58 hand-written pairs are 58
chances at a typo that only shows up as a keyword quietly doing nothing — and
pin the rule with a test.

Before relying on aliases, check the two releases really do behave the same.
Prt 1.1 and 1.3 carry the same 46 escape sequences, verified byte for byte,
which is what makes one handler correct for both; 1.4 changed two of them and
needs the version branch it already had.

## The published list

Andrew Burton maintained an AMOS Extensions List from the AMOS-LIST archives,
magazine clippings and coverdisk CDs; a copy is kept at ultimateamiga.com
(last updated 2007-07-29) and in the corpus as `extension-list.txt`. It names
62 extensions with their conventional slot, their AMOS and AMOS Pro version
numbers, and occasionally where to find them.

It is worth reading for two reasons. First, it is a **check on identification
that was arrived at independently**: of the ten slots the corpus actually uses,
eight match Burton exactly — Music at 1, Compactor at 2, Requestor at 3,
Voodoo 3D at 4, Compiler at 5, IO_Devices at 6, Turbo Plus at 12 and OS Devkit
at 20. Two do not, and both are informative rather than worrying:

- **slot 13**, where Burton lists Powerbobs and the corpus holds Personnal —
  which he does not list at all. Two extensions recommending one slot is the
  ordinary case, not a contradiction.
- **slot 14**, where he lists The Game Extension, and puts Intuition at 25 with
  the note "Slot 14 originally?". Every corpus program that uses Intuition has
  it at 14, which answers his question from the programs themselves.

Second, it fills in what a binary cannot tell you: authorship (Sticks is by
N. Critten, GUI by Pietro Ghizzoni), version numbers this port had only
guessed at (TOME is 4.24, CText 1.32, Range 2.8), and the fact that Turbo
and Turbo Plus were separately credited — Manuel Andre's 1.9 and Ryan Scott's
2.x — even though their token tables are plainly one lineage.

Where the list and a binary disagree, the binary wins: it records The Game
Extension at 0.4b where the library's own \$VER says 0.9.

**An extension id is a stable key, not an assertion.** Several carry a version
suffix that was a provisional guess when the entry was created; the `version`
field is the authoritative one and is corrected as evidence arrives, while the
id stays put so that generated tables and manifests keep matching up.

## What to port next

<!-- BEGIN demand: generated by src/cli/libdemand.ts, do not edit by hand -->

Programs identified to each extension across 5191 readable programs
(2814 of them use an extension at all), one program at a time.

301 further program(s) could not be parsed and are not counted here.
That loss is not evenly spread — it concentrates in one AMOS Basic release —
so the counts are sound at the top of the table and should not be read as
decisive between two neighbouring rows near the bottom.

| programs | extension | port | keywords answered |
|---:|---|---|---:|
| 1939 | `amospro-music-2.0` | module | 49 / 49 |
| 1325 | `amospro-compact-2.0` | core | 3 / 3 |
| 129 | `turbo-plus-1.9` | module | 87 / 87 |
| 85 | `ldos-2.5` | module | 77 / 77 |
| 76 | `amos3d-1.0` | module | 64 / 64 |
| 58 | `personal-1.0b` | module | 108 / 108 |
| 56 | `amospro-request-2.0` | core | 3 / 3 |
| 52 | `turbo-plus-1.0` | module | 134 / 134 |
| 51 | `amospro-compiler-2.0` | part | 8 / 15 |
| 42 | `jd-4.6` | core | 125 / 125 |
| 28 | `easylife-1.10` | — | 0 / 156 |
| 23 | `amospro-ioports-2.0` | module | 38 / 38 |
| 20 | `tome-4.0` | — | 0 / 67 |
| 14 | `ctext-1.0` | module | 6 / 6 |
| 13 | `intuition-1.3b` | part | 2 / 183 |
| 11 | `sticks-1.01b` | module | 16 / 16 |
| 10 | `music-68451de1` | UNREGISTERED lead | — |
| 10 | `jd-5.3` | module | 130 / 130 |
| 10 | `lserial-2.1` | — | 0 / 15 |
| 10 | `personnal-1.1` | module | 126 / 126 |
| 9 | `amcaf-1.50` | part | 7 / 280 |
| 9 | `sln-2.0` | — | 0 / 70 |
| 8 | `tft-0.6` | — | 0 / 22 |
| 6 | `range-1.0` | part | 1 / 48 |
| 4 | `aga-1.0` | — | 0 / 24 |
| 3 | `d-sam-1.01` | — | 0 / 50 |
| 3 | `jvp-1.01` | — | 0 / 11 |
| 2 | `jd-colour-1.4` | module | 44 / 44 |
| 2 | `stars-2.33` | — | 0 / 11 |
| 2 | `os-devkit-1.61` | — | 0 / 1047 |
| 2 | `ldos-2.6` | module | 77 / 85 |
| 2 | `the-game-0.9` | — | 0 / 103 |
| 1 | `dump-1.0` | — | 0 / 8 |
| 1 | `easylife-1.0` | — | 0 / 72 |
| 1 | `delta-1.4` | — | 0 / 26 |
| 1 | `delta-1.6` | — | 0 / 46 |
| 1 | `locale-0.26` | — | 0 / 20 |
| 1 | `opal-1.1` | — | 0 / 78 |
| 1 | `gui-2.10` | — | 0 / 204 |
| 1 | `jotre-1.0` | — | 0 / 5 |
| 1 | `turbo-plus-2.15` | module | 152 / 152 |

`port`: **module** = a dedicated port (`EXT_IMPLS` in `src/runtime/instr.ts`),
**core** = every keyword it has is answered by core AMOS anyway, **part** =
some are, **—** = none. `keywords answered` counts named entries in that
extension's own token table that the dispatch answers for, n/a included.

The next port is argued from the top row that is not already answered: a high
program count against a low keyword count. Program counts come from a corpus
assembled from many machines, so they are per program, never per slot — see
the phase 2 measurements above for why that distinction is not cosmetic.

<!-- END demand -->

Regenerate against a corpus with:

```
npm run cli -- src/cli/libdemand.ts /path/to/corpus --libs /path/to/corpus --md docs/extensions/README.md
```

## Finding what is missing

**Ask per program, never per slot.** A slot number belongs to the machine a
program was saved on, so two programs in one collection routinely hold
different extensions — or different versions of one — at the same slot. Merging
their token ids into a single fingerprint and identifying *that* asks a
question nothing has to answer, and it fails in a way that looks like a
discovery: with no candidate surviving there is no table to subtract, so every
id the slot ever used is reported as unexplained.

The local 4,783-program archive measured both ways:

| | merged per slot | per program |
|---|---|---|
| ids reported unexplained | 758 across 12 slots | 53 across 10 slots |
| programs involved | — | 49 of 4,783 |
| slot 12 | "39 of 110 ids missing — a fourth TURBO build" | 105 programs on TURBO 1.9, 48 on 1.0, 1 on 2.15 |
| slot 14 | "10 of 159 ids missing" | 13 Intuition, 2 The Game Extension, 1 unknown id |
| slot 22 | "5 of 47 ids missing" | 30 JD 5.3, 2 JD 4.6, 1 Jotre, 20 with one stray id |

Nothing was missing in most of those slots; the programs simply disagreed with
each other. `extscan` identifies per program and aggregates the answers, and
`ext.test.ts` pins the trap so it cannot come back.

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

Against the bundled corpus (488 programs) all ten slots in use resolve with no
unexplained ids — eight `exact`, two `probable`, none ambiguous or unknown.
That is a starting point, not a finish line: the corpus
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
