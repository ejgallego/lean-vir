# Performance

For setup and generated-artifact prerequisites, see [HARNESS.md](../HARNESS.md).

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

The order-balanced differential sampler also accepts a structured candidate
result, `{ checksum, phases }`. It retains the independently measured candidate
wall time in `samples`/`medianMs` and records named timings in
`phaseSamples`/`phaseMedians`; an omitted `totalMs` phase defaults to the wall
sample. Phase names must remain stable across warm-up and measured rounds.
This lets runtime consumers feed `callTimed(...).timings` into the shared
sampler without moving application conversion, rendering, or UI-specific
phases into VIR.

```js
run: () => {
  const { value, timings } = runtime.callTimed("MyPackage.entry", input);
  return { checksum: Number(value), phases: timings };
}
```

Named phase values and summaries are not necessarily additive. In particular,
`hostMs` overlaps `executeMs`, `totalMs` is measured independently, and each
entry in `phaseMedians` is computed independently; the phase medians therefore
need not sum to the median `totalMs`.

## Environment Lookup Workload

Use the focused environment lookup benchmark when changing package declaration
resolution or the upstream interpreter/provider boundary:

```bash
npm run bench:env-lookup -- \
  --json build/perf/env-lookup/current.json
```

It repeatedly calls `Vir.Fixtures.ExprPrinter.exprCoverageScore` in
`fixtures-lean.irpkg` through one package-scoped interpreter session. Workload
identity `environment-lookup-v2` names this lifecycle explicitly; the recorded
2026-08-05 `v1` measurements instead constructed a fresh interpreter for every
call and must not be compared directly with `v2` reports. The default workload
rejects packages with fewer than 1,000 declarations. The headline execution row
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
fixture before reporting a delta. Package manifests do not embed wall-clock
generation time, so package content identity covers every manifest field and
the report also retains the exact package SHA-256. Timing-harness identity covers the benchmark helpers and the
complete local JavaScript module closure loaded by the focused runtime.

Capture sampled attribution in a separate diagnostic run:

```bash
npm run bench:env-lookup -- \
  --cpu-profile build/perf/env-lookup/current.cpuprofile \
  --json build/perf/env-lookup/current-profiled.json
```

The profiling path uses the optimized, unstripped debug Wasm companion. Its
timings are marked diagnostic and are not before/after evidence. See
[Environment Lookup Performance](../design/ENVIRONMENT_LOOKUP_PERFORMANCE.md) for the
baseline and final profiles, measured representation experiments, and accepted
local design.
[ULC-0001](../design/IR_DECLARATION_LOOKUP.md)
owns the remaining environment/provider API decision.

When the intervention is a Wasm build mode rather than a source-checkout
change, compare two frozen artifacts in one process:

```bash
npm run bench:env-lookup:wasm-pair -- \
  --json build/perf/env-lookup/wasm-pair.json \
  build/control/vir-upstream.wasm build/candidate/vir-upstream.wasm
```

This path compiles both modules once, alternates control/candidate order inside
every measured round, forces V8 collection outside each timed window, and
records explicit per-round order and ratios, checksum/parity outcomes, and the
exact Git, runtime environment, harness, package, and Wasm identities. It is
useful when the
standard saved-report comparator must reject an intentional build-identity
difference. Use the median of the per-round candidate/control ratios as the
headline; the report retains the more outlier-sensitive geometric mean and the
slower/equal/faster round counts as diagnostics.

The `Std.Format` conversion rows and measured
manifest-derived normalization-plan cache are documented in
[Custom Inductive Object Conversion Performance](../design/OBJECT_CONVERSION_PERFORMANCE.md).

Compare two saved reports with:

```bash
npm run bench:compare -- build/perf/before.json build/perf/after.json
```

## Browser benchmark catalog

The standalone application under `benchmarks/browser/` runs client examples,
differential tests and browser performance campaigns. Its canonical example
compares five `Std.Format.prettyM` backends. It runs independently of the VIR
documentation site, Reveal and Verso.

Root commands use the `bench:browser:*` prefix as convenience pointers. See
[`benchmarks/browser/README.md`](../../benchmarks/browser/README.md) for the
command list, ignored artifact layout, example contribution
format, and measurement cautions.

Pages serves the application under `/lean-vir/benchmarks/`, using the catalog
and `tests.json` validated with the candidate build.

## Reading The Numbers

Use a different comparison point depending on the question:

- For runtime, package ABI or shim regressions, compare two checkouts with
  `npm run bench:paired`.
- For pure interpreter cost, compare the `fib` and `sort` rows against the host
  Lean IR baseline printed in the same report. Those rows mostly measure Lean IR
  execution, not boundary conversion.
- For call-dispatch overhead, compare `resolve+call` with `cached slot` in the
  `branchAndSub` row. Most user-facing call paths should behave like the cached
  slot sample after the first resolution.
- For boundary conversion cost, compare each `base-*` row's `lower` sample with
  its `wasm` sample. `lower` isolates JavaScript-to-Lean object construction;
  `wasm` includes lowering, the interpreter call, result lifting, and release.
- A new row's absolute per-call measurement is its first baseline.

Avoid comparing unrelated rows directly. For example, a recursive `Std.Format`
row includes thousands of object conversions, while a scalar base row is mostly
a small boundary call. They answer different questions.

The comparison checks common rows for sample names, iteration counts and
checksums before printing per-call deltas. Rows present in only one report
are listed separately with their per-call medians. The
[benchmark sources](../../benchmarks) define the row catalog.

The `format-tag-transitions` representative row and `format-empty-nodes`
focused row use `pretty-printer.irpkg` to measure recursive `Std.Format`
lowering through the public runtime. Host/resource rows repeat an exported
operation from JavaScript where possible, measuring boundary conversion without
a deep recursive Lean `DomM` loop.

React is absent from this Node benchmark: the Node bindings provide neither
a DOM nor React implementation. React performance needs the real browser host
and a browser-catalog workload. [HARNESS.md](../HARNESS.md#browser-smoke) covers
semantic checks; [OBJECT_ABI.md](../reference/OBJECT_ABI.md) defines object conversion.

The machine-readable report schema is `lean-vir.bench.v1`, with rows under
`benchmarks`. Samples named `lower`, `wasm`, `native`, `host`,
`resolveEachCall`, `cachedSlot` or `js` share the fields shown in this example:

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
for call-slot dispatch. Host/resource rows expose the reverse crossing into
JavaScript; `fib` and `sort` spend more time in Lean execution.
`npm run bench:engines` remains a WASI command-module comparison across
available engines for the broader `fib` and `sort` rows.

Compare two existing checkouts with the paired runner:

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
