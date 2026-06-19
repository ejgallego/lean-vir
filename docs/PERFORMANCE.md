# Performance

This document owns benchmark commands, artifact-cache behavior, and
before/after comparison workflow. Setup, generated artifacts, and CI shape live
in `docs/HARNESS.md`.

`npm run bench` runs the manifest-driven JavaScript runtime benchmark against
the host Lean IR baseline. It restores or stores built benchmark inputs under
`.perf-artifacts/vir-bench-cache` by default, keyed by commit plus a build-key
hash. The cache stores generated inputs, not timing samples, so benchmark
timings are still regenerated for each run. Use `--no-artifact-cache` to
disable the cache, `--artifact-cache DIR` to put it elsewhere, and
`--refresh-artifact-cache` to replace the current cache entry.

Pass `--json` to save a machine-readable report:

```bash
npm run bench -- --json build/perf/current.json
```

Compare two saved reports with:

```bash
npm run bench:compare -- build/perf/before.json build/perf/after.json
```

The comparison checks common benchmark rows for sample names, iteration counts,
and checksums before printing per-call deltas. Rows present in only one report
are listed separately with their per-call medians. The default benchmark
includes the `branchAndSub` top-level dispatch row with both named and resolved
package call samples, pure-runtime controls (`fib` and `sort`), JavaScript
codec-only rows plus end-to-end top-level value conversion rows for WIT-like
scalar records, nested records/lists/options, and recursive custom inductives,
an exact `String -> String` round trip, plus host/resource rows for scalar host
imports, callback root round trips, DOM listener resource churn, React root
lifecycle work, and focused React `Html` render conversion.

The `base-*` JSON rows are intended as the first regression surface for direct
base-type conversion work. Each row has a `codec` sample for JavaScript request
encoding and a `wasm` sample for the full top-level call. Rows supported by the
primitive-lane resolved-call API also have a `direct` sample that bypasses value
payload encoding/decoding while still resolving and validating the package
entry. The scalar host/resource and React rows repeat one exported operation
from JavaScript where possible, so they stress boundary conversion without
primarily measuring a deep recursive Lean `DomM` loop.

The manifest runtime also has a narrow primitive-lane resolved-call fast path
for exact pure `Unit -> Unit`, `Bool -> Bool`, same-width
`UInt8`/`UInt16`/`UInt32`, `Float`, `Float32`, and `String -> String`
signatures. Those rows still report under the normal `wasm` sample because the
public API remains `vir.call(...)`; internally they bypass payload allocation,
binary value encoding, and result byte decoding after the package slot is
resolved. The `direct` rows expose the same primitive-lane path explicitly for
benchmarking.
Exact pure `ByteArray -> ByteArray` calls use the object ABI lane through the
normal `wasm` sample: JavaScript lowers the input with `vir_obj_byte_array`,
calls `vir_call_resolved_objects`, and lifts the owned result with the
byte-array inspection helpers.

The machine-readable report schema is `lean-vir.bench.v1`. Benchmark rows are
objects under the top-level `benchmarks` array. Every timed sample uses the same
shape, regardless of whether it is named `codec`, `wasm`, `native`, `host`,
`direct`, `host`, `named`, `resolved`, or `js`:

```json
{
  "label": "base-bool",
  "iterations": 50000,
  "medianMs": 1.07,
  "checksum": 0
}
```

The `base-*` conversion rows use this stable row shape:

```json
{
  "name": "base-bool",
  "title": "base Bool conversion boundary",
  "codec": {
    "label": "codec-base-bool",
    "iterations": 50000,
    "medianMs": 8.36,
    "checksum": 0
  },
  "wasm": {
    "label": "base-bool",
    "iterations": 50000,
    "medianMs": 185.0,
    "checksum": 0
  },
  "direct": {
    "label": "direct-base-bool",
    "iterations": 50000,
    "medianMs": 1.07,
    "checksum": 0
  }
}
```

`direct` is optional. Its absence means the row does not yet have a
primitive-lane call path; it must not be interpreted as zero time or a failed
benchmark. Today the direct sample covers only exact pure `Unit`, `Bool`,
`UInt8`, `UInt16`, `UInt32`, `Float`, `Float32`, and `String` round trips.

The `branchAndSub` row calls a tiny exported fixture through both descriptor-
bearing `vir_call` and compact `vir_call_resolved`, so it is the focused check
for package-owned ABI and call-slot dispatch changes. The primitive-lane call
path now covers pure `Unit -> Unit`, `Bool -> Bool`, same-width
`UInt8`/`UInt16`/`UInt32`, `Float`, `Float32`, and `String -> String` calls.
Compact host-import framing is more visible in the host/resource and React rows
because those paths cross from Lean back into JavaScript. The broader `fib` and
`sort` rows spend more time in Lean execution and should show smaller movement
from boundary-only work.
`npm run bench:engines` remains a WASI command-module comparison across
available engines for the broader `fib` and `sort` rows.

For routine before/after comparisons between two already checked-out trees, use
the paired runner:

```bash
npm run bench:paired -- --repeat 5 ../vir-main ../vir-feature
```

It alternates `npm run bench -- --json` in each checkout, stores the per-run
reports under `build/perf/paired/`, and prints median per-call deltas for common
benchmark rows. Side-only rows are reported with the same summary format as
`bench:compare`. The compared checkouts must both support the current benchmark
JSON interface; for older refs, first create a temporary compatible checkout or
compare manually saved reports with `bench:compare`.
