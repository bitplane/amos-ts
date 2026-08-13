# AMOS 3D

AMOS 3D was a commercial extension published by Europress in 1991, written by
Voodoo Software. It ships as two files and no source: `3d.lib`, a 4,876-byte
stub holding the token table, and `c3d.lib`, a 47,696-byte engine in 29
relocatable hunks. Everything below was recovered from those binaries, from the
demo programs, and from a manual update found on a coverdisk. All 64 keywords
are implemented.

`src/cli/tddis.ts` is the tool: `tddis "td redraw"` resolves a keyword to its
engine routine and disassembles it, and `tddis @0x218cc4` disassembles a raw
address. It needs `python3` with `capstone`.

## How the extension is put together

The stub's marshalling code ends in a tail at `$7cc` that switches to a private
stack and does `movea.l $8(a2),a0 : movea.l (a0,d1.w),a0 : jsr (a0)`. `$8(a2)`
is the loaded engine's base, so **d1 is a byte offset into a table of 32-bit
function pointers at the front of the engine**, and each keyword's stub is a
`move.w #x,d0 : move.w #y,d1` pair naming its routine. Walking the stub from a
keyword's entry point therefore recovers its calling signature as well.

The engine is a C program built small-data, which is why it is 29 hunks and why
nothing in it can be read until they are relocated. Its init clears its BSS and
finishes `lea $d0(pc),a0 : movea.l a4,a1 : rts`, handing back both the pointer
table (a fixed offset into its own first hunk) and the small-data base the
dispatcher keeps in `a4`. Engine offsets below are written `a4+$xx`; addresses
are as loaded at `$210000`, which is what `tddis` uses.

## Numbers

- **Angles**: 65536 units per revolution.
- **Fixed point**: 4096ths of a unit (`TD_ONE`); products come back down by
  `>>12`.
- **Everything downstream of the view matrix** is in 4096ths of a world unit,
  because the matrix product is not shifted back down. The perspective divide
  takes depth back to world units, which fixes the focal length at 4096/16 =
  256 pixels, a 64-degree field of view on a 320-wide screen.
- **Screen mapping**: column = `(x >> 4) + 160`, row = `((h-1)>>1) - (y >> 4)`,
  with rows 1..h-1 drawn and row 0 never touched.

A real 1991 limit worth knowing about: the perspective divide is `divs.w`, a
32-by-16 divide that takes only the low word of its divisor. The divisor is the
depth in world units, so **past 32767 units objects come back the wrong size, and
mirrored once it goes negative**. With the near limit at 16 units that
still leaves a range of about 2000 to 1.

## The file formats

Three extensions, one container. `.3DO` is an object, `.3DT` a template, `.3DS`
a surface. The loader is at `$219ba4`; the five section offsets at `+$38`
through `+$40` become pointers.

### Pens are plane masks, not colours

A pen is **two bits**, EOR'd into the bottom two bitplanes: bit 0 selects plane
0, bit 1 selects plane 1. This is why `Td Background` puts its picture at plane
0 and full depth: the 3D draws *over* it changing only the bottom two bits, so
the picture keeps its upper planes and the objects appear in front.

### Block colours are dither pairs

A "block" is the engine's word for a sub-object (error 24 is "Block does not
exist"). Each block carries a **pair** of pens out of the sixteen pairs at
`a4+$54` rather than a colour index, and the face is filled with the two
alternating.
`Td Set Colour n,block,code` picks the pair. `$212faa` masks the code with `$F`
rather than clamping it, so 16 lands on 0.

### `.3DS` surfaces contain no coordinates at all

This is the surprising one. A surface has three sections plus a relocation base
at `+$12`; a stored pointer minus that base, divided by 10, is a **slot index**.

- Slots 1 to 4 are the four projected corners of the face the surface is applied
  to.
- Every other slot is built by **repeated bisection**: a 12-byte construction
  record `(dest, a, b)` sets slot `dest` to the midpoint of slots `a` and `b`.
- A fill list of 6-byte records `(slot, pen, spare)` then names polygons; a
  zero record closes a polygon and a second zero ends the list.

So a surface is a recipe relative to whatever face it lands on, which is how
one surface file decorates faces of different sizes. The dice demo's six faces
use fill counts `[3, 1, 4, 12, 5, 2]`, the twelve being six pips drawn twice,
once in each pen.

### Relocation, and why two copies of a file differ

Stored pointers are absolute Amiga addresses, fixed up against the base at
`+$12`. Two copies of the same object saved on machines with the engine at
different addresses differ in every pointer by a constant. `p8.3DT` from the
Amiga Computing coverdisk differs from the archive's copy in 240 bytes across
57 runs, all explained by one delta of `$073247B8`, which is the difference
between their two relocation bases. Any reader that subtracts the recorded base
sees identical data, and neither copy is more canonical.

## The undocumented keywords

The printed manual documents neither `Td Priority` nor `Td Set Colour`. Both
are described in `3D_Read_Me_Now`, an official Voodoo/Europress manual update
dated 31/10/1992 that shipped on the Object Modeller disk of the *Amiga
Computing* #66 coverdisk (November 1993), under the heading "Undocumented Td
Commands".

The readme is useful but not authoritative. It says `Td Set Colour` takes 0 to
16 and truncates out-of-range codes to the nearest valid one, and the binary
does neither (there are sixteen combinations, and it masks). Where they
disagree, the binary is what runs.

### Draw order

`Td Priority n,p` sets a word at `+$42` of the object's render record and does
nothing else. The order is decided at every `Td Redraw` by a bubble sort at
`$218cc4` over a scratch copy of the live object list:

```
move.w $42(a0),d6                  ; A's priority
move.w $42(a1),d5                  ; B's
move.l d6,d0 : or.w d5,d0 : bne .prio
move.l $1c(a0),d0 : cmp.l $1c(a1),d0 : bgt .swap   ; both zero: depth
.prio  cmp.w d5,d6 : bge .keep                     ; else: priority
```

So a pair of zero-priority objects sorts on `+$1c` **ascending**, and any pair
with a priority between them sorts on priority **descending**. Nearest and
highest-priority come first, and the engine draws first-to-last with the
first-drawn in front. The comparison is not a total order, so the arrangement
depends on the algorithm and the bubble sort has to be reproduced rather than
handed to a library sort.

`+$1c` is the object origin's Z in the camera's frame, written from `$218de8`.
That routine also computes the **per-object range shift** at `+$40`: the three
world deltas are OR'd by magnitude, and once that reaches `$4000` a count
starting at `$12` comes down one per doubling. It scales the deltas before the
matrix so the products stay inside a long. It is a range scale computed every
frame, not a property of the model.

## Where the port stops, and where the original did

`src/coverage/status.ts` is authoritative and `UNIMPLEMENTED.md` argues the
three that matter. Three separate things get confused here, so they are kept
apart.

**Approximated, meaning we fall short.** Four keywords:

- **`td surface points`** and **`td surface points off`**. The four anchors are
  recorded where the engine records them and nothing consumes them yet.
- **`td visible`**. Answered from our own face count rather than the engine's
  bounding-sphere cull at `$2190c8`, which has not been read, so the two agree
  for an object rejected by the near limit and can differ at the far margin.
- **`td advanced`**. Hands back an Amiga address, and there is no address space
  here for one to mean anything in, so it answers zero.

**Faithful, with the mechanism swapped.** `td redraw` is classified faithful
and carries a note saying why the classification is not the whole story: the
model is the engine's and the rasteriser is ours. The engine hands the blitter
one EOR line per edge in line mode and area-fills the mask. There is no blitter
here, so the same shapes are computed by a scanline fill, even-odd, with edges
half-open at the bottom. Right polygons and right pens, not guaranteed
identical bits, and the phase of the two-pen dither is a choice rather than a
reading.

**Faithful because the original does nothing.** `Td Debug` and `Td Pragma` are
`link/unlk/rts` in the shipped library, stubs that survived with their bodies
removed, and `Td Pragma Status` is `moveq #$2a,d0` and always answers 42.
Reproducing a stub is the port working. These are not gaps and do not belong
on a list of them.

## The demo objects

`tinycube.3DO` is missing from every archive searched so far, which stops the
demo Spunt's Village. `monitor.3DO` was in the same position until it turned up
on the coverdisk above. Rather than substitute a similar object and pretend,
the demo is left failing and recorded here.
