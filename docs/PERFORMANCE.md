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

The comparison checks benchmark names, sample names, iteration counts, and
checksums before printing per-call deltas. The default benchmark includes the
`branchAndSub` top-level dispatch row with both named and resolved package call
samples, pure-runtime controls (`fib` and `sort`), JavaScript codec-only rows
plus end-to-end top-level value conversion rows for WIT-like scalar records,
nested records/lists/options, and recursive custom inductives, plus
host/resource rows for scalar host imports, callback root round trips, DOM
listener resource churn, React root lifecycle work, and focused React `Html`
render conversion.

The host/resource and React `Html` rows run loops inside Lean so they measure
repeated host interop or render-conversion operations without mostly measuring
repeated top-level `vir.call(...)` entry overhead.

The `branchAndSub` row calls a tiny exported fixture through both `vir_call` and
`vir_call_resolved`, so it is the focused check for call-slot dispatch changes.
The broader `fib`, `sort`, host/resource, and React rows spend more time in Lean
execution or host work and should show smaller movement from dispatch-only work.
`npm run bench:engines` remains a WASI command-module comparison across
available engines for the broader `fib` and `sort` rows.

For routine before/after comparisons between two already checked-out trees, use
the paired runner:

```bash
npm run bench:paired -- --repeat 5 ../vir-main ../vir-feature
```

It alternates `npm run bench -- --json` in each checkout, stores the per-run
reports under `build/perf/paired/`, and prints median per-call deltas for common
benchmark rows. Rows present in only one checkout are listed separately with
their per-call medians, which makes newly added benchmark rows visible without
pretending they have a before/after delta. The compared checkouts must both
support the current benchmark JSON interface; for older refs, first create a
temporary compatible checkout or compare manually saved reports with
`bench:compare`.
