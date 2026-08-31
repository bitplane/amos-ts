# Keyword audit

This directory contains the instructions for one complete Luna audit of every
keyword. The audit is temporary work, not project state: its reports are
ignored, are never committed, and may be deleted after Sol has dealt with the
issues.

Luna writes two local files:

- `faithful.md` lists completed checks that found no mismatch.
- `issues.md` contains only defects and suspected defects for Sol to inspect.

Run batches until every keyword is represented in one of those files. If a
Luna context or credit allowance ends, start another with [`LUNA.md`](LUNA.md);
it reads the existing reports and continues at the first unaudited keyword.
The reports are progress markers across those resets, not durable records.

The audit is source-led, but observable behavior can also be reproduced on the
live site at <https://amos.bitplane.net>. Luna records findings and does not
edit the implementation. Sol subsequently reads `issues.md`, verifies each
finding, and makes any warranted code and test changes.
