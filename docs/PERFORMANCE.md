# Performance

This document owns benchmark commands, artifact-cache behavior, and
before/after comparison workflow. Setup, generated artifacts, and CI shape live
in `docs/HARNESS.md`.

`npm run bench` runs the manifest-driven JavaScript runtime benchmark against
the host Lean IR baseline. It restores or stores built benchmark inputs under
`.perf-artifacts/vir-bench-cache` by default, keyed by commit plus a build-key
hash. The build key covers tracked diffs, relevant untracked input contents,
the effective compiler/linker/tool versions, Lean source commit and dirty state,
build flags, and selected source identities. The shell build and benchmark
cache share the same effective-tool resolver, including the repository-local
WASI SDK fallback. The cache stores generated inputs, not timing samples, so
benchmark timings are still regenerated for each run. Use
`--no-artifact-cache` to disable the cache,
`--artifact-cache DIR` to put it elsewhere, and `--refresh-artifact-cache` to
replace the current cache entry. Use `--no-build` to require existing generated
inputs without cache restore or build activity. Repeat `--filter TEXT` to run
only benchmark names containing one of the supplied strings; an unfiltered run
retains the complete default matrix.

Pass `--json` to save a machine-readable report:

```bash
npm run bench -- --json build/perf/current.json
```

General reports include a comparison identity covering the selected row names
and titles, Node/V8/platform details, and the SHA-256 of every loaded Wasm and
package artifact. Saved and paired comparisons reject different identities
before reporting timing deltas.

## Environment Lookup Workload

Use the focused environment lookup benchmark when changing package declaration
resolution or the upstream interpreter/provider boundary:

```bash
npm run bench:env-lookup -- \
  --json build/perf/env-lookup/current.json
```

It repeatedly enters a fresh interpreter through
`Vir.Fixtures.ExprPrinter.exprCoverageScore` in `fixtures-lean.irpkg`; the
recorded 2026-08-05 measurements used 1,546 declarations, and the default
workload rejects packages with fewer than 1,000. The headline execution row
excludes package loading, initializer execution, and export-slot resolution. A
separate package-load row uses a fresh Wasm instance for each load; Wasm
instantiation and disposal are outside that row's timed window. Reports preserve
both sets of raw rounds, artifact and source hashes, toolchain/CPU identity,
package declaration count, and the expected result. Wasm profile, optimization,
target, memory, and stack settings are part of the report/comparison identity
and artifact-cache key. Output paths are never overwritten, and `--json` and
`--cpu-profile` must resolve to different files.

Focused reports include a stable comparison identity; saved and paired
comparisons require the same workload/result, run policy, diagnostic mode,
Node/V8 version, Lean toolchain, platform/architecture, CPU model, Wasm
artifact/build configuration, package content and format, timing harness, and
fixture before reporting a delta. Package content identity ignores only the
manifest's volatile `generatedAt` field; the report also retains the exact
package SHA-256. Timing-harness identity covers the benchmark helpers and the
complete local JavaScript module closure loaded by the focused runtime.

Capture sampled attribution in a separate diagnostic run:

```bash
npm run bench:env-lookup -- \
  --cpu-profile build/perf/env-lookup/current.cpuprofile \
  --json build/perf/env-lookup/current-profiled.json
```

The profiling path uses the optimized, unstripped debug Wasm companion. Its
timings are marked diagnostic and are not before/after evidence. See
[Environment Lookup Performance](ENVIRONMENT_LOOKUP_PERFORMANCE.md) for the
baseline and final profiles, measured representation experiments, and accepted
local design.
[ULC-0001](roadmap/cards/ULC-0001-ir-declaration-lookup-boundary/README.md)
owns the environment/provider API decision;
[ULC-0002](roadmap/cards/ULC-0002-cross-entry-symbol-resolution-cache/README.md)
owns the measurement-gated cross-entry resolution-cache experiment.

The repository-owned `Std.Format` conversion rows and accepted
manifest-derived normalization-plan cache are documented in
[Custom Inductive Object Conversion Performance](OBJECT_CONVERSION_PERFORMANCE.md).

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
The `format-tag-transitions` representative row and `format-empty-nodes`
focused row use the generated `pretty-printer.irpkg` to exercise recursive
`Std.Format` custom-inductive lowering through the same public runtime path.

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
  "iterations": 10000,
  "checksum": 0,
  "medianMs": 185.0,
  "perCallMs": 0.0185
}
```

The `base-*` conversion rows use this stable row shape:

```json
{
  "name": "base-bool",
  "title": "Bool -> Bool x 10000",
  "lower": {
    "label": "lower-base-bool",
    "iterations": 20000,
    "checksum": 20000,
    "medianMs": 8.36,
    "perCallMs": 0.000418
  },
  "wasm": {
    "label": "base-bool",
    "iterations": 10000,
    "checksum": 0,
    "medianMs": 185.0,
    "perCallMs": 0.0185
  }
}
```

The `branchAndSub` row calls a tiny exported fixture through
`vir_call_resolved_objects`, comparing repeated name resolution with a cached package
slot. The two fixed-size candidates run once as a warm-up, then run in seven
interleaved measured rounds whose starting order rotates. Warm-up timings are
excluded from the median, while warm-up checksums still participate in each
candidate's stability check. Any per-candidate checksum instability or
cross-candidate disagreement fails the benchmark. This row is the focused check
for package-owned ABI and call-slot dispatch changes. Object host-import framing
is more visible in the host/resource and React rows because those paths cross
from Lean back into JavaScript. The broader `fib` and `sort` rows spend more time
in Lean execution and should show smaller movement from boundary-only work.
`npm run bench:engines` remains a WASI command-module comparison across
available engines for the broader `fib` and `sort` rows.

For routine before/after comparisons between two already checked-out trees, use
the paired runner:

```bash
npm run bench:paired -- --repeat 6 --out build/perf/general-abba \
  ../vir-main ../vir-feature
```

It runs order-balanced AB/BA passes, stores every per-run report plus
`schedule.json`, and prints both the aggregate median per-call comparison and
the paired percentage delta for every pass.
The output directory must not already exist. Side-only rows are reported with
the same summary format as `bench:compare`. Select a compatible focused script
with `--npm-script`, for example:

```bash
npm run bench:paired -- --npm-script bench:env-lookup --repeat 6 \
  --out build/perf/env-lookup/index-abba ../vir-baseline ../vir-index
```

Use repeatable `--bench-arg` options to strengthen a focused comparison without
changing its defaults, for example
`--bench-arg=--iterations=500 --bench-arg=--samples=9`. The selected benchmark
still validates those arguments through its comparison identity.
The general benchmark accepts the same forwarding mechanism for row selection
and exact prebuilt inputs, for example:

```bash
npm run bench:paired -- --repeat 6 \
  --bench-arg=--no-build --bench-arg=--filter=format- \
  --out build/perf/format-abba ../vir-main ../vir-feature
```

Both checkouts must contain the same generated inputs for this `--no-build`
form; their artifact hashes are part of the comparison identity.

Use an even pass count for an order-balanced acceptance run. One pass remains
available for quick screening and is reported as unbalanced. The compared
checkouts must both support the selected benchmark JSON interface; for older
refs, first create a temporary compatible checkout or compare manually saved
reports with `bench:compare`.
