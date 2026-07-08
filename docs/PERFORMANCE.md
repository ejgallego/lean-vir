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

## Reading The Numbers

Use a different comparison point depending on the question:

- For PR review, compare against `main` with `npm run bench:paired`. This is the
  regression check for the JavaScript runtime, package ABI, and shim changes.
- For pure interpreter cost, compare the `fib` and `sort` rows against the host
  Lean IR baseline printed in the same report. Those rows mostly measure Lean IR
  execution, not boundary conversion.
- For call-dispatch overhead, compare `resolve+call` with `cached slot` in the
  `branchAndSub` row. Most user-facing call paths should behave like the cached
  slot sample after the first resolution.
- For boundary conversion cost, compare each `base-*` row's `lower` sample with
  its `wasm` sample. `lower` isolates JavaScript-to-Lean object construction;
  `wasm` includes lowering, the interpreter call, result lifting, and release.
- For new rows that do not exist on `main`, keep the current absolute per-call
  number as the first baseline and compare future PRs against it.

Avoid comparing unrelated rows directly. For example, a React render row includes
host resource work and React object creation, while a scalar base row is mostly a
small boundary call. They answer different questions.

The comparison checks common benchmark rows for sample names, iteration counts,
and checksums before printing per-call deltas. Rows present in only one report
are listed separately with their per-call medians. The default benchmark
includes the `branchAndSub` top-level dispatch row with both resolve-each-call
and cached-slot samples, pure-runtime controls (`fib` and `sort`), JavaScript
object-lowering rows, base boundary rows for `Unit`, `Bool`, `Nat`, `Int`,
`String`, fixed-width unsigned integers, `USize`, `Float`, `Float32`,
`ByteArray`, and shallow array inputs, plus end-to-end top-level value
conversion rows for WIT-like scalar records, nested records/lists/options, and
recursive custom inductives. It also includes host/resource rows for scalar host
imports, callback root round trips, DOM listener resource churn, React root
lifecycle work, and focused React `Node` render conversion.

The `base-*` JSON rows are intended as the first regression surface for direct
base-type conversion work. Each row has a `lower` sample for JavaScript object
lowering and a `wasm` sample for the full top-level call. Calls over the
supported object subset use the object ABI lane through the normal `wasm`
sample, so the public `runtime.call(...)` path is also the main direct
conversion measurement. The runtime currently lowers base arguments, `Array`,
`List`, `Option`, `Prod`, and manifest-described
structure/constructor values with object, `USize`, and scalar runtime fields,
and lifts the same subset recursively. The no-fallback runtime smoke covers
decimal scalars, `ByteArray`, `Array Nat -> Nat`, `Array String -> Nat`,
`List UInt32 -> Nat`, `Array Nat -> Array Nat`, `List String -> List String`,
`Option` arguments/results, `Prod` arguments/results, a nested
`List (Nat × String)` argument, `Profile` records, `ProfileStats` mixed scalar
records, trivial scalar wrappers, `Tagged Profile`, `Metered`, extended records,
recursive structures/custom inductives, `Sum`/`Except` tagged unions, and
nullary/unary/binary pretty-printer calls.
JavaScript lowers inputs with the matching `vir_obj_*` constructor,
`vir_obj_array`, `vir_obj_ctor`, or `vir_obj_ctor_layout`, calls
`vir_call_resolved_objects`, and lifts the owned result with the matching
inspection helpers. The scalar host/resource and React rows repeat one exported
operation from JavaScript where possible, so they stress boundary conversion
without primarily measuring a deep recursive Lean `DomM` loop.

The machine-readable report schema is `lean-vir.bench.v1`. Benchmark rows are
objects under the top-level `benchmarks` array. Every timed sample uses the same
shape, regardless of whether it is named `lower`, `wasm`, `native`, `host`,
`resolveEachCall`, `cachedSlot`, or `js`:

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
  "lower": {
    "label": "lower-base-bool",
    "iterations": 50000,
    "medianMs": 8.36,
    "checksum": 0
  },
  "wasm": {
    "label": "base-bool",
    "iterations": 50000,
    "medianMs": 185.0,
    "checksum": 0
  }
}
```

The `branchAndSub` row calls a tiny exported fixture through
`vir_call_resolved_objects`, comparing repeated name resolution with a cached package
slot. It is the focused check for package-owned ABI and call-slot dispatch
changes. Object host-import framing is more visible in the host/resource and
React rows because those paths cross from Lean back into JavaScript. The broader
`fib` and `sort` rows spend more time in Lean execution and should show smaller
movement from boundary-only work.
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
