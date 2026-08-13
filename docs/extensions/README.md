# AMOS extensions

AMOS Professional could be extended with third-party libraries that added
keywords to the language. Dozens were written and released on Aminet, on
coverdisks and by post, and a great many AMOS programs depend on at least one
of them, including most of the ambitious ones. A player that only handles the
stock keyword set will load a large fraction of the surviving AMOS corpus and
then fail on the first line that matters.

This directory documents how extensions are handled here. The short version is
that **an extension is identified by what it is, never by where it was
installed**, and everything below follows from why that has to be so.

## A slot number is not an identity

AMOS Professional loads up to 26 extensions, each into a numbered slot, from
filenames in the interpreter config: slot *n* comes from config message *15+n*
(`+B.s:2149-2166`, `+Interpreter_Config.s:150-157`). A stock installation
fills five:

| slot | config message | library |
|---|---|---|
| 1 | 16 | `AMOSPro_Music.Lib` |
| 2 | 17 | `AMOSPro_Compact.Lib` |
| 3 | 18 | `AMOSPro_Request.Lib` |
| 5 | 20 | `AMOSPro_Compiler.Lib` |
| 6 | 21 | `AMOSPro_IOPorts.Lib` |

Slots 4 and 7 to 26 ship empty, for the user to fill.

A tokenised program records an extension keyword as `EXTENSION, slot, nparams,
token id` and nothing else, so a slot is a property of the machine a program
was saved on rather than an identity. **The argument, the citations and the
consequences are in `src/ext/registry.ts`'s header**, which is where the
registry that acts on them lives. Working out what each slot actually held is
`src/ext/identify.ts`.

## How identification works

Three kinds of evidence, all carried by the program: the set of token ids used
in the slot, the argument count recorded beside each use, and whether the ids
land on entries with usable names. A candidate must account for every observed
id, and where the evidence leaves more than one standing the answer is
`ambiguous` rather than a guess.

**`src/ext/identify.ts` documents this properly**, including the two caveats
about the recorded count that were found by measurement, and it carries the
four confidence levels as a type. The regression oracle is in
`src/ext/ext.test.ts`: the configured slot map is thrown away and every slot
used anywhere in the fixture corpus must resolve to exactly one extension with
no token id left over.

## Evidence tiers

Reading a token table gives keyword names and argument counts for free and
says nothing about what the keywords *do*. That is tracked separately as
`source`, `disassembly` or `manual`, and **`src/ext/registry.ts`'s
`ExtEvidence` is the definition**: what each tier means, that the tier records
the strongest evidence AVAILABLE rather than whichever artifact somebody
consulted, and that `manual` is therefore legal only where no binary exists.
`src/ext/ext.test.ts` enforces it against the field and against the prose
describing the field.

What belongs here is the evidence for the rule, which is that manuals are
wrong often enough to matter. Every one of these was found by reading a
library whose manifest called it `manual` tier:

- LDos's manual states a password-length check that only one of its two crypt
  routines actually has.
- AMCAF's says `Amcaf Aga Notation On` selects 24-bit values, where routines
  80 and 81 have the pair the wrong way round and `On` sets the mode it was
  already in.
- AMCAF's `Ham Point` is documented as returning -1 off-screen, and there is
  no -1 anywhere in routine 160.

Two consequences worth stating where a porter will meet them. First, the tier
is not a record of work done: `disassembly` says the evidence is there, not
that anyone has read it. `src/cli/extaudit.ts` answers the per-keyword
question, reporting how many implemented keywords cite the routine they came
from and how many cite nothing, and that is the number to look at before
believing a port is finished.

Second, 68k machine code is never *executed* here, and reading it is the same
activity as reading `+Lib.s`. Because it is never run, a binary-only extension
cannot be probed by experiment: behaviour is read out of the disassembly or
marked unknown.

Whether the documentation is any *good* is a separate and useful question, and
that is what the manifest's `docs` field is for.


## The registry

An extension is described by a manifest in `src/ext/manifests/<id>.json`
recording identity, provenance and evidence tier, and its files live in
`fixtures/extensions/<id>/`. Token tables are generated from the two together
into `src/ext/tables.gen.ts` by `src/cli/genext.ts`.

The split is deliberate: `fixtures/` is gitignored because the AMOS libraries
are not ours to redistribute, so manifests are tracked separately and the
registry's documentation, provenance and generated tables all survive a clone
even though the binaries have to be supplied locally. `genext` skips any manifest whose fixture is absent,
with a warning rather than an error.

Currently registered. Regenerate with `npm run cli -- src/cli/genextdoc.ts`
after adding a manifest:

<!-- BEGIN registry (generated by src/cli/genextdoc.ts) -->

87 extensions are registered, 5 of them stock.
Ordered by evidence tier, then by size. "Keywords" counts DISTINCT named table
entries, matching `KEYWORDS.md`: unnamed entries are argument-count and
function-form variants of the keyword above them, and a name can legitimately
appear twice (IOPorts declares `serial speed` at two ids). "Seen at" is the
slots corpus programs actually used it in, which is evidence; "Slot" is where
it belongs. Three kinds of answer, strongest first: "states N" is the
library's own word — `d2` at its extension-call-1025 sites is the extension
number, compiled in by whoever built it, and 62 rows carry one. "stock, slot
N" is +Interpreter_Config.s. "recommends N" is a manual or a wiki page, which
is a claim and not evidence. Eleven of the 62 have nothing but the binary.

"Evidence" is what is available to read, not what has been read — see the tier
rule above. Nearly every row says `source` or `disassembly` because a held
binary outranks any manual, so the column separates the extensions whose
behaviour is knowable from the ones where a port would be guessing. It says
nothing about how much of each is ported; `src/cli/extaudit.ts` answers that,
per keyword.

| id                     | name                                  | evidence    | keywords | seen at | slot          |
| ---------------------- | ------------------------------------- | ----------- | -------: | ------: | ------------- |
| `explode-2.01`         | Explode                               | source      |      131 |       — | recommends 7  |
| `jd-5.3`               | JD                                    | source      |      130 |      22 | —             |
| `jd-4.6`               | JD                                    | source      |      125 |      22 | —             |
| `personal-1.0b`        | Personnal Extension                   | source      |      108 |      13 | states 13     |
| `opal-1.1`             | Opal                                  | source      |       78 |       — | states 21     |
| `sln-2.0`              | SLN                                   | source      |       70 |       — | states 24     |
| `jd-prt-1.3`           | JD Printer                            | source      |       63 |       — | —             |
| `amospro-music-2.0`    | Music                                 | source      |       49 |       1 | stock, slot 1 |
| `jd-colour-1.4`        | JD Colour                             | source      |       44 |       — | states 20     |
| `amospro-ioports-2.0`  | IOPorts                               | source      |       38 |       6 | stock, slot 6 |
| `gamesupport-1.2`      | GameSupport                           | source      |       37 |       — | states 23     |
| `amospro-colours-1.0`  | AMOSPro Colours                       | source      |       27 |       — | recommends 23 |
| `maxsdoor-0.20`        | MAXS Door Handler                     | source      |       21 |       — | states 16     |
| `amospro-compiler-2.0` | Compiler                              | source      |       15 |       5 | stock, slot 5 |
| `serial-1.2`           | Serial (AMOS 1.3)                     | source      |       15 |       — | states 6      |
| `misc-1.0`             | Misc Extension                        | source      |       12 |       — | recommends 23 |
| `jvp-1.01`             | JVP NoKids                            | source      |       11 |       — | states 25     |
| `p61-1.2`              | P61 Music                             | source      |        9 |       — | states 25     |
| `fileid-1.0`           | FileID                                | source      |        6 |       — | states 25     |
| `amospro-compact-2.0`  | Compact                               | source      |        3 |       2 | stock, slot 2 |
| `amospro-request-2.0`  | Request                               | source      |        3 |       3 | stock, slot 3 |
| `personnal-extra-1.0a` | Personnal EXTRA                       | source      |        2 |       — | states 17     |
| `os-devkit-1.61`       | OS-DevKit                             | disassembly |     1047 |      20 | recommends 20 |
| `intuiextend-2.01b`    | IntuiExtend                           | disassembly |      301 |       — | states 23     |
| `intuiextend-1.6`      | IntuiExtend                           | disassembly |      294 |       — | recommends 23 |
| `amcaf-1.50`           | AMCAF                                 | disassembly |      280 |       — | states 8      |
| `amcaf-1.40`           | AMCAF                                 | disassembly |      268 |       — | states 8      |
| `gui-2.10`             | GUI                                   | disassembly |      204 |       — | states 24     |
| `dme-2.0`              | DOOM Music Extension                  | disassembly |      184 |       — | states 15     |
| `easylife-1.09`        | EasyLife                              | disassembly |      156 |       — | states 16     |
| `easylife-1.10`        | Easy Life                             | disassembly |      156 |       — | states 16     |
| `turbo-plus-2.15`      | TURBO Plus                            | disassembly |      152 |       — | states 12     |
| `craft-1.0`            | CRAFT                                 | disassembly |      138 |       — | states 18     |
| `turbo-plus-1.0`       | TURBO Plus Extension                  | disassembly |      134 |      12 | states 12     |
| `jd-5.9`               | JD                                    | disassembly |      133 |       — | recommends 22 |
| `personnal-1.1`        | Personnal                             | disassembly |      126 |      13 | states 13     |
| `easylife-1.44`        | Easy Life                             | disassembly |      108 |       — | states 16     |
| `gui-1.61`             | AMOSPro GUI Extension                 | disassembly |      103 |      24 | states 24     |
| `the-game-0.9`         | The Game Extension                    | disassembly |      103 |       — | states 14     |
| `turbo-plus-1.9`       | TURBO Plus                            | disassembly |       87 |      12 | states 12     |
| `ldos-2.6`             | LDos                                  | disassembly |       85 |       — | states 10     |
| `ldos-2.5`             | LDos                                  | disassembly |       77 |      10 | states 10     |
| `range-2.0`            | Range                                 | disassembly |       73 |       — | states 9      |
| `easylife-1.0`         | Easy Life                             | disassembly |       72 |       — | states 16     |
| `jd-prt-1.4`           | JD Printer                            | disassembly |       69 |       — | recommends 21 |
| `tome-4.23`            | TOME                                  | disassembly |       67 |       7 | states 7      |
| `powerbobs-1.0`        | Power Bobs                            | disassembly |       65 |       — | states 13     |
| `amos3d-1.0`           | AMOS 3D                               | disassembly |       64 |       4 | states 4      |
| `int-1.0`              | Int                                   | disassembly |       62 |       — | states 25     |
| `eme-3.0`              | Enhanced Music Extension              | disassembly |       59 |       — | states 1      |
| `jd-prt-1.1`           | JD Printer                            | disassembly |       58 |       — | —             |
| `jd-colour-2.0`        | JD Colour                             | disassembly |       56 |       — | states 20     |
| `eme-3.0-demo`         | Enhanced Music Extension (demo build) | disassembly |       55 |       — | states 1      |
| `symbase-0.94`         | SymBase                               | disassembly |       51 |       — | states 21     |
| `d-sam-1.01`           | D-Sam                                 | disassembly |       50 |       — | states 15     |
| `gui-1.5b`             | GUI                                   | disassembly |       48 |       — | states 24     |
| `range-1.0`            | Range                                 | disassembly |       48 |       — | states 9      |
| `delta-1.6`            | Delta                                 | disassembly |       46 |       — | states 15     |
| `tome-3.1`             | TOME                                  | disassembly |       34 |       — | states 7      |
| `jd-int-1.3`           | JD Intuition                          | disassembly |       33 |       — | recommends 18 |
| `tools-1.01`           | Tools                                 | disassembly |       33 |       — | states 23     |
| `make-1.30`            | Make                                  | disassembly |       32 |       — | states 17     |
| `music-omega-1.0`      | Music (Omega)                         | disassembly |       32 |       1 | states 1      |
| `bsdsocket-1.1.4`      | BSDSocket                             | disassembly |       30 |       — | recommends 18 |
| `med-7.1`              | MED                                   | disassembly |       28 |       — | states 19     |
| `delta-1.4`            | Delta                                 | disassembly |       26 |       — | recommends 15 |
| `aga-1.0`              | AMOS AGA                              | disassembly |       24 |       — | states 20     |
| `amon-1.04`            | Amon                                  | disassembly |       24 |       — | states 25     |
| `dbench-0.42`          | DBench                                | disassembly |       23 |       — | states 21     |
| `tft-0.6`              | TFT                                   | disassembly |       22 |       — | states 25     |
| `locale-0.26`          | Locale                                | disassembly |       20 |       — | states 17     |
| `amon-1.03`            | Amon                                  | disassembly |       18 |       — | states 16     |
| `sticks-1.01b`         | Sticks                                | disassembly |       16 |      17 | states 17     |
| `butility-1.21`        | BUtility                              | disassembly |       15 |       — | states 12     |
| `lserial-2.1`          | LSerial                               | disassembly |       15 |      11 | states 11     |
| `orgasm-1.0`           | OrgAsm                                | disassembly |       13 |       — | recommends 20 |
| `musicraft-1.0`        | MusiCRAFT                             | disassembly |       12 |      19 | states 19     |
| `ercole-1.7`           | Ercole                                | disassembly |       11 |       — | states 10     |
| `stars-2.33`           | Stars                                 | disassembly |       11 |       — | states 20     |
| `dump-1.0`             | Dump                                  | disassembly |        8 |       — | recommends 20 |
| `ctext-1.0`            | CText                                 | disassembly |        6 |       8 | states 8      |
| `display-0.01`         | Display                               | disassembly |        6 |       — | states 24     |
| `jd-k3-1.1`            | JD K3                                 | disassembly |        6 |       — | recommends 19 |
| `thx-0.6`              | THX                                   | disassembly |        6 |       — | states 20     |
| `jotre-1.0`            | Jotre                                 | disassembly |        5 |       — | states 22     |
| `first-0.1`            | First                                 | disassembly |        4 |       — | recommends 22 |
| `intuition-1.3b`       | Intuition Extension                   | manual      |      183 |      14 | recommends 25 |

<!-- END registry -->

Notes worth having on individual entries, which the table cannot carry:
`turbo-plus-1.0` and `1.9` are different tables, not subsets of each other, and
neither is a subset of `2.15`. `tome-4.0` has two versions on the disc and
identification is ambiguous between them. `sticks-1.01b` is a shareware build
whose PD limitation is nag requesters rather than disabled keywords. Its one
"Command not available in this version" guards the two-argument `Stick Fire`,
which its own manual documents as a deliberate placeholder. Registration bought
extra commands that are not in this table at all. `dump-1.0` is low-level disc access,
much of it likely n/a here. `intuition-1.3b` ships no `.Lib` at all. See
"Token tables from source" below.

Twelve entries came from one source, the AMOS PD Library CD (Weird Science,
1994), scanned with `libscan` and written up by hand. Their
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

A linked `Intuition.lib` **does** survive elsewhere, in the Ultimate Amiga
archive under `ie13b/Intuition/`, and it corroborates the assembly rather
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
   `tokenSource`. Record every identity string you find in the binary, because a
   later copy may carry only one of them. Be honest in `idBaseEvidence`:
   `calibrated` means proven against observed programs, `assumed` means taken
   from the layout of similar libraries and possibly uniformly offset.
3. Run `npm run cli -- src/cli/genext.ts` to regenerate the tables, then
   `npm run cli -- src/cli/genextdoc.ts` to put the new entry in the table
   above.
4. Run `npm test`. The registry tests check that the table parses, that ids are
   unique and even, and that provenance and evidence are recorded.
5. If you have programs that use it, add a few under
   `fixtures/extensions/<id>/progs/`. That is what turns `idBaseEvidence` from
   `assumed` into `calibrated`, and it guards the table against regressions.

Implementing the keywords is a separate step from registering the extension, and
a registered-but-unimplemented extension is useful on its own: programs using it
detokenise with real keyword names instead of `{ext12:$02d4}`, and unimplemented
functions return a type-correct default rather than a type mismatch.

### Do not register a build that shares another's token ids

Identification works from the token **ids** a program used, because a tokenised
program records `(slot, id)` and nothing else. Two builds sharing every id are
therefore indistinguishable in a program *no matter how differently their
keywords are spelled*, so a second registry entry for one can never win an
identification, and can only turn `exact` into `probable` or `ambiguous`.

This is measured rather than theoretical. Registering five earlier stock builds
and Intuition's Creator build took Intuition's own identification from `exact`
to `probable` and left it with no `best` candidate at all; `ext.test.ts` caught
it. The rule now is:

- **ids differ** → register it. AMOS Pro's IOPorts folded serial, parallel and
  printer into one extension and renumbered, so `serial-1.2` is a real identity.
- **ids identical** → record it as a note on the sibling entry instead. The AMOS
  1.3 `3d.lib`, and the 1.0 builds of Music, Compact, Request and IOPorts, are
  documented that way. No knowledge is lost and identification stays sharp.

Check with `libcat` before writing the manifest: a `variant` verdict with 100%
name overlap is the shape to be suspicious of.

### Before you implement: ask what it contests

```
npm run contested -- eme
```

Dispatch is by name (that is what "a slot number is not an identity" forces),
so two products spelling a keyword the same way is not a syntax error. It is
one layer silently answering for the other, in every program, forever. The
token tables know this before a line of the port is written:

```
eme (eme-3.0)
59 keywords, 49 contested

armed (49), the other side is ported, porting this one collides
  bell           amospro-music*
  boom           amospro-music*
  ...
```

Every collision needs a decision, and there are only two: the names mean the
same thing and one implementation serves both, or they do not and the port
declares them in `qualified` so each answers only on its own slot (see
`src/runtime/extimpl.ts`). Finding that out afterwards means threading the
declaration back through work that is already finished.

Two ported products settle a shared name between them: **one keeps the bare
key** as the default and the other qualifies, and each is served on its own
slots. Both mechanisms produce a slot-qualified key, `qualified` and `aliases`
alike, so a name reached only through an alias is already declared
and needs nothing further.

**Registering a table you have not ported is the case with no second side.**
It hands that product's keyword names to whoever already answers them, and the
unported product has no `ExtensionImpl` to declare anything on, so its programs
get the other product's handler under the other product's contract. Twenty
names were in that state. `Nop` is a function in DME 2.0 and an instruction in
AMCAF; `Plane Swap` takes two arguments in Explode and three in TURBO Plus, so the
handler does not merely behave differently. It reads a different number of
arguments off the stack. The fix comes from the only side that can give it:
the **ported** product qualifies, the bare key goes away, and the unported
product's programs get an unimplemented keyword, which is what they have.
`answeredForUnported()` is the standing check.

Run it with no argument for the whole picture. `live` is what is misdispatching
today, `armed` is what the next port sets off.

### And check whether the releases agree with each other

A port serves several identities of one product, and releases do not always
call the keywords the same thing. JD's printer companion renamed **all 58** of
them between 1.1 and 1.3, so `Prt Bold` became `Jd Prt Bold` and the two tables
share not one name. EasyLife did the same to its prefix between 1.09 and 1.10
(`znsx` → `elznsx`). Intuition and IntuiExtend instead ship an AMOS build and
an AMOS Pro build of a *single* release that disagree on some names.

This fails silently and is worth stating plainly: dispatch is by name, a name
nothing registered is simply unimplemented, and an unimplemented function
returns a type-correct default rather than erroring. A program written against
the release you did not port runs, prints nothing useful, and reports no
problem.

The fix is `aliases` on the `ExtensionImpl` (`src/runtime/extimpl.ts`). Implement one
set of names, whichever release you worked from, and declare what the others
call them, keyed by identity:

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
registered table instead of transcribing it, and pin the rule with a test. 58
hand-written pairs are 58 chances at a typo that only shows up as a keyword
quietly doing nothing.

Before relying on aliases, check the two releases really do behave the same.
Prt 1.1 and 1.3 carry the same 46 escape sequences, verified byte for byte,
which is what makes one handler correct for both; 1.4 changed two of them and
needs the version branch it already had.

### While you are reading: how the library raises its own errors

```
npm run cli -- src/cli/errscan.ts
```

Extension call 1025, `L_ErrorExt`. Every library that has messages of its own
raises them through it, and 43 of the 49 registered binaries that call it do so
from exactly two sites, because AMOS's extension skeleton ships the pair. The full
account, with the lines from AMOS's interpreter, its compiled runtime and the
commented Voodoo 3D skeleton, is on `ExtensionImpl.errors` in
`src/runtime/extimpl.ts`. In brief: **a0** the NUL-separated table, **d0** the
zero-based index into it, **d1** a threshold below which an error cannot be
trapped (extensions pass 0, so all of theirs can), **d2** the extension number
zero-based, **d3** 0 to print the message and -1 not to.

Read from one disassembly this shape is ambiguous, and five ports here got it
wrong in four different ways. `d3` was called "the index", `d1 = 0` was read as
a boolean, and the whole thing was called a requester when the interpreter's own
comment on that arm is `Erreur normale, branche a l'editeur`. Read across all
49 at once it is unambiguous, which is what the CLI is for.

**`d2` also tells you the slot**, zero-based and independently of any manual,
which is useful because most `defaultSlot` values come from a wiki list. All 34 with a
manifest slot agree with their binary; eleven more have no manifest slot and
`d2` is the only evidence there is.

### And whether a port already answers a release nobody named

```
npm run cli -- src/cli/versweep.ts --all
```

The other half of the same problem. A release that IS implemented reads 0%
when no `ExtensionImpl` names its identity, because dispatch is by name and
nothing said the two tables were the same library. EME 3.0 read 17% that way,
`serial-1.2` read 0%, and `delta-1.6` read 0% while 26 of its 46 keywords were
already faithful. Each was one string in `ids:`.

The sweep is a standing test now, so a new registration that a port already
covers fails `versweep.test.ts` rather than sitting at zero. Its criterion is one
thing, **no keyword name the two releases share may sit at a different id**,
and everything else is allowed. Adding keywords is the point of looking;
dropping them is harmless, because a handler no table entry reaches never
fires. Requiring a superset was the first attempt and it rejected `serial-1.2`,
one of the three cases the check exists to catch.

A `renumbered` verdict is not a refusal, it is a question. Dispatch would still work,
because every identity brings its own table, but a rebuilt table is no longer
evidence that the routine behind a shared name is the routine the port read.
Read the binary before adding that one.

## The published list

Andrew Burton maintained an AMOS Extensions List from the AMOS-LIST archives,
magazine clippings and coverdisk CDs; a copy is kept at ultimateamiga.com
(last updated 2007-07-29) and in the corpus as `extension-list.txt`. It names
62 extensions with their conventional slot, their AMOS and AMOS Pro version
numbers, and occasionally where to find them.

It is worth reading for two reasons. First, it is a **check on identification
that was arrived at independently**: of the ten slots the corpus actually uses,
eight match Burton exactly: Music at 1, Compactor at 2, Requestor at 3, Voodoo
3D at 4, Compiler at 5, IO_Devices at 6, Turbo Plus at 12 and OS Devkit at 20. Two do not, and both are informative rather than worrying:

- **slot 13**, where Burton lists Powerbobs and the corpus holds Personnal,
  which he does not list at all. Two extensions recommending one slot is the
  ordinary case, not a contradiction.
- **slot 14**, where he lists The Game Extension, and puts Intuition at 25 with
  the note "Slot 14 originally?". Every corpus program that uses Intuition has
  it at 14, which answers his question from the programs themselves.

Second, it fills in what a binary cannot tell you: authorship (Sticks is by
N. Critten, GUI by Pietro Ghizzoni), version numbers this port had only
guessed at (TOME is 4.24, CText 1.32, Range 2.8), and the fact that Turbo
and Turbo Plus were separately credited, Manuel Andre's 1.9 and Ryan Scott's
2.x, even though their token tables are plainly one lineage.

Where the list and a binary disagree, the binary wins: it records The Game
Extension at 0.4b where the library's own \$VER says 0.9.

**An extension id is a stable key, not an assertion.** Several carry a version
suffix that was a provisional guess when the entry was created; the `version`
field is the authoritative one and is corrected as evidence arrives, while the
id stays put so that generated tables and manifests keep matching up.

## What to port next

<!-- BEGIN demand: generated by src/cli/libdemand.ts, do not edit by hand -->

Programs identified to each extension across 6476 readable programs
(3594 of them use an extension at all), one program at a time.

122 further program(s) could not be parsed and are not counted here.
That loss is not evenly spread — it concentrates in one AMOS Basic release —
so the counts are sound at the top of the table and should not be read as
decisive between two neighbouring rows near the bottom.

| programs | extension                   | port              | keywords answered |
| -------: | --------------------------- | ----------------- | ----------------: |
|     2293 | `amospro-music-2.0`         | module            |           49 / 49 |
|     1637 | `amospro-compact-2.0`       | core              |             3 / 3 |
|      157 | `turbo-plus-1.9`            | module            |           87 / 87 |
|      132 | `amcaf-1.40`                | module            |         268 / 268 |
|      109 | `amospro-request-2.0`       | core              |             3 / 3 |
|      108 | `ldos-2.5`                  | module            |           77 / 77 |
|       92 | `personal-1.0b`             | module            |         108 / 108 |
|       78 | `amos3d-1.0`                | module            |           64 / 64 |
|       75 | `amospro-compiler-2.0`      | part              |            8 / 15 |
|       59 | `turbo-plus-1.0`            | module            |         134 / 134 |
|       51 | `easylife-1.09`             | module            |         156 / 156 |
|       49 | `jd-4.6`                    | module            |         125 / 125 |
|       34 | `amospro-ioports-2.0`       | module            |           38 / 38 |
|       28 | `intuition-1.3b`            | part              |           2 / 183 |
|       16 | `amcaf-1.50`                | module            |         280 / 280 |
|       16 | `dme-2.0`                   | part              |           5 / 184 |
|       16 | `tome-4.23`                 | module            |           67 / 67 |
|       16 | `int-1.0`                   | —                 |            0 / 62 |
|       15 | `tft-0.6`                   | module            |           22 / 22 |
|       14 | `ctext-1.0`                 | module            |             6 / 6 |
|       13 | `lserial-2.1`               | module            |           15 / 15 |
|       11 | `sticks-1.01b`              | module            |           16 / 16 |
|       10 | `music-omega-1.0`           | module            |           32 / 32 |
|       10 | `jd-5.3`                    | module            |         130 / 130 |
|       10 | `personnal-1.1`             | module            |         126 / 126 |
|        9 | `sln-2.0`                   | module            |           70 / 70 |
|        8 | `make-1.30`                 | module            |           32 / 32 |
|        6 | `gui-1.61`                  | —                 |           0 / 103 |
|        6 | `orgasm-1.0`                | —                 |            0 / 13 |
|        5 | `stars-2.33`                | module            |           11 / 11 |
|        4 | `craft-1.0`                 | module            |         138 / 138 |
|        4 | `amospro_tft-v0.7-0405eb73` | UNREGISTERED lead |                 — |
|        4 | `tome-3.1`                  | module            |           33 / 34 |
|        4 | `aga-1.0`                   | module            |           24 / 24 |
|        3 | `gui-2.10`                  | —                 |           0 / 204 |
|        3 | `gui-1.5b`                  | —                 |            0 / 48 |
|        3 | `d-sam-1.01`                | —                 |            0 / 50 |
|        3 | `jvp-1.01`                  | module            |           11 / 11 |
|        2 | `delta-1.6`                 | module            |           46 / 46 |
|        2 | `bsdsocket-1.1.4`           | —                 |            0 / 30 |
|        2 | `easylife-1.0`              | module            |           72 / 72 |
|        2 | `locale-0.26`               | module            |           20 / 20 |
|        2 | `jd-colour-1.4`             | module            |           44 / 44 |
|        2 | `os-devkit-1.61`            | —                 |          0 / 1047 |
|        2 | `range-1.0`                 | module            |           48 / 48 |
|        2 | `ldos-2.6`                  | module            |           85 / 85 |
|        2 | `the-game-0.9`              | module            |         103 / 103 |
|        1 | `butility-1.21`             | module            |           15 / 15 |
|        1 | `turbo_plus-v1.0-3927a4fb`  | UNREGISTERED lead |                 — |
|        1 | `dump-1.0`                  | module            |             8 / 8 |
|        1 | `maxsdoor-0.20`             | —                 |            0 / 21 |
|        1 | `thx-0.6`                   | —                 |             0 / 6 |
|        1 | `delta-1.4`                 | module            |           26 / 26 |
|        1 | `opal-1.1`                  | module            |           78 / 78 |
|        1 | `jotre-1.0`                 | module            |             5 / 5 |
|        1 | `turbo-plus-2.15`           | module            |         152 / 152 |

`port`: **module** = a dedicated port (`EXT_IMPLS` in `src/runtime/instr.ts`),
**core** = every keyword it has is answered by core AMOS anyway, **part** =
some are, **-** = none. `keywords answered` counts named entries in that
extension's own token table that the dispatch answers for, n/a included.

These counts DISAGREE with `KEYWORDS.md` and both are right, because they
answer different questions. This asks whether a program will run: a keyword
is answered if ANY dispatch layer has a handler under its name. The manifest
asks whether the port is done: a keyword counts only if the extension's own
ExtensionImpl registers it. So `intuition-1.3b` reads 2 of 183 here and 0% in
the manifest, and the two happen to be the same fact: two of its keyword
names collide with core AMOS ones, and nothing has been ported.

The next port is argued from the top row that is not already answered: a high
program count against a low keyword count. Program counts come from a corpus
assembled from many machines, so they are per program, never per slot — see
the phase 2 measurements above for why that distinction is not cosmetic.

<!-- END demand -->

Regenerate against a corpus with:

```
npm run cli -- src/cli/libdemand.ts /path/to/corpus --libs /path/to/corpus --md docs/extensions/README.md
```

Regenerating needs the corpus, which is not always to hand, so the "port" and
"keywords answered" columns may be hand-corrected as ports land. The program
counts are the part that needs the corpus and the part that never changes on
its own, so correcting a cell beside them beats leaving the table saying an
extension is unported until somebody can reassemble 6,000 programs.

## Finding what is missing

**Ask per program, never per slot.** A slot number belongs to the machine a
program was saved on, so two programs in one collection routinely hold
different extensions, or different versions of one, at the same slot. Merging
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
id is a specific, actionable request, "find the extension whose token table has
an entry at offset `$04d2` taking one argument", and `--json` writes them out
as a wanted list. Working through a large archive is then mechanical rather than
a matter of recognising keyword names by eye.

Against the bundled corpus all ten slots in use resolve with no unexplained
ids: eight `exact`, two `probable`, none ambiguous or unknown.
That is a starting point, not a finish line: the corpus
is the official releases plus the Intuition distribution's own samples, and a
real sweep of Aminet would turn up extensions nobody here has seen.

## Collections that identify themselves

`src/cli/libscan.ts` is the other half. Where extscan reads programs and reports
the slots they use, libscan reads the `.Lib` files and reports what each token
table *contains*, meaning every keyword the extension has and not just the ones
some program happened to call:

```
npm run cli -- src/cli/libscan.ts /path/to/collection --json libs.json
```

A collection carrying programs and their libraries together, a PD library disc,
an install or a coverdisk rip, can therefore resolve its own slot numbers.
`extscan --libs` adds the scanned tables to the identification pool for that
run:

```
npm run cli -- src/cli/extscan.ts /path/to/collection --libs /path/to/collection
```

A hit here is a **lead, not a registry entry**, and extscan labels it
`UNREGISTERED` to keep the two apart. A matching id set establishes which token
table a slot held; it says nothing about the extension's name, version, author,
licence or behaviour, and the id base is assumed rather than calibrated.
Promoting a lead means doing the work in "Adding an extension" above,
including recording where it came from.

This is also how to sanity-check a corpus you cannot fully parse. Token ids are
byte offsets into a real table, so a desynchronised reader cannot produce
dozens of ids that all land inside one library. Slots resolving exactly against
libraries found beside the programs is strong evidence the tokenised stream was
read correctly, whatever version of AMOS wrote it.
