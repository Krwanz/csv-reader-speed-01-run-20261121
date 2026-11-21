# Read Broken CSV Files Faster

[![csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/Krwanz/csv-reader-speed-01-run-20261121/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/Krwanz/csv-reader-speed-01-run-20261121/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)

A fast, dependency-free CSV reader with exactly csv-reader 1.0.0's broken-row
policy: BOM dropped, LF/CRLF record ends, stray CRs dropped, doubled quotes,
quote junk after a closing quote, unterminated quotes re-read as unquoted,
short/long rows padded or cut to the first record's width, and every broken
thing reported as `{code, line, row}`.

Entry for the make.fun bounty: https://make.fun/bounty/csv-reader-speed-01-run-20261121

## How it works

`solve.js` exports `run(input)`, which reads `{text, header}` once, left to
right, and answers `{columns, rows, errors}`. Instead of walking character by
character, it lets the engine do the scanning: an unquoted field is one slice
to the next comma or the end of its line (the line end is found once per
record), a quoted field is one slice between its opening quote and the next
quote that is not doubled, and only the rare broken pieces — stray CRs,
doubled quotes, line breaks inside quotes, junk after a closing quote, a quote
that never closes — take a short slow path of their own. On the kit's practice
set (10.2 MB of CSV) it runs in ~85 ms of CPU against the house baseline's
~417 ms, about 5× faster, with byte-identical answers on every practice case
and on 4,000 fuzzed edge-case inputs.

`main.ts` is the program the harness runs: it reads every case from
`/input/cases.json`, answers each one alone with `run`, and writes
`/output/answers.json`. Run it locally:

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=../kit-fresh/csv-reader-speed-01-run-20261121-kit/practice/input MAKEFUN_OUTPUT_DIR=out node main.ts
```
