# Custom Inductive Object Conversion Performance

Last measured: 2026-08-08

## Result

Cache the manifest-derived normalization plan for custom-inductive values. In
the repository-owned `Std.Format` benchmark, the six-pass AB/BA paired median
improved by 61.9% for JavaScript lowering and 36.2% for the full Wasm call on
the representative tag-transition workload. On the focused empty-node
workload, lowering improved by 80.4% and the full call by 62.7%.

The manifest is validated when a package is installed, but the old lowering
path repeated the following work for every recursive custom-inductive node:

- validate every constructor and field layout;
- generate all diagnostic shape strings;
- linearly search constructor names;
- allocate allowed-key and expected-field sets.

`normalizeCustomInductive` now stores a `WeakMap` plan keyed by the manifest
type object. The plan retains the constructor-array identity, constructor name
map, diagnostic shapes, and validation sets. Installed manifest descriptors are
read-only runtime metadata; replacing `type.constructors` defensively
invalidates the entry, but arbitrary in-place descriptor mutation is not
supported. Per-value kind, key, field-presence, and payload checks remain on
every call, with the same diagnostics.

## Repository-owned Benchmark

The workloads are rows in `npm run bench`, use the generated
`pretty-printer.irpkg`, and enter through the normal
`Vir.Fixtures.FormatPretty.formatBoundaryPretty` public call. The shared
`Std.Format` JavaScript constructors are also used by the object-ABI smoke
test, and a contract test pins each workload's constructor counts.

- `format-tag-transitions` is the representative row: 64 text chunks, each
  under 64 tags, joined by a balanced append tree (4,223 nodes). It checks the
  exact output `"x".repeat(64)` and uses 8 lowering iterations or 4 full calls
  per internal sample.
- `format-empty-nodes` is the focused row: 1,024 `nil` leaves in a balanced
  append tree (2,047 nodes). It checks the exact empty output and uses 20
  lowering iterations or 12 full calls per internal sample.

Each reported pass is the median of seven internal samples. The acceptance run
used the canonical paired runner and selected these rows with the general
benchmark filter:

```bash
npm run bench:paired -- \
  --repeat 6 \
  --bench-arg=--no-build \
  --bench-arg=--filter=format- \
  --out build/perf/format-abba \
  ../vir-main ../vir-feature
```

`--no-build` requires the generated inputs to exist in both checkouts. For
this comparison both sides received byte-identical copies. The report's
comparison identity now includes every selected row, Node/V8/platform details,
and all benchmark artifact hashes; the paired runner rejects a mismatch.

| Workload and sample | Control median | Candidate median | Aggregate delta | Median paired delta | Paired candidate deltas |
| --- | ---: | ---: | ---: | ---: | --- |
| tag transitions, `lower` | 52.08 ms | 17.51 ms | -66.4% | -61.9% | -67.9%, -48.9%, -61.9%, -66.4%, -71.0%, -61.2% |
| tag transitions, `wasm` | 50.71 ms | 28.26 ms | -44.3% | -36.2% | -59.1%, -48.9%, -47.7%, +70.6%, -18.7%, -36.2% |
| empty append tree, `lower` | 13.21 ms | 2.59 ms | -80.4% | -80.4% | -80.4%, -88.8%, -81.7%, -78.7%, -90.7%, -69.7% |
| empty append tree, `wasm` | 14.90 ms | 6.80 ms | -54.4% | -62.7% | -64.7%, -61.2%, -80.4%, -62.7%, -67.5%, -53.4% |

All structural checksums were stable. Every lowering pass and every focused
full-call pass improved. Five of six representative full-call passes improved;
the paired median remains the acceptance statistic in the presence of the one
noisy pass.

The control runtime is clean `main` at
[commit `5202d27`](https://github.com/ejgallego/lean-vir/commit/5202d27), with
the benchmark-only commits applied identically to both worktrees. The measured
candidate is
[commit `510ebbb`](https://github.com/ejgallego/lean-vir/commit/510ebbb).
The comparison identity recorded these SHA-256 values:

- `vir-upstream.wasm`: `a7b77ac4704d614999789e0661e73087e05bd4a7b705962f2a6b3b6f5db718e5`
- `fixtures-basic.irpkg`: `b2458c333877cda3e5033d395259f4980532d076c99aa07c7e68cb3cf1fda818`
- `demo-host.irpkg`: `b626dea6e78e5a6180157c011ae0e4406acdcbd680bcb1217f72c66bce628947`
- `pretty-printer.irpkg`: `d090391d6ceba8eb2bdcfb5b6ae76554cdd198a97f5203ec4839437a040afeac`

## Profile Cross-check

The initial diagnostic profiles used the same public object-conversion boundary
and predicted the accepted movement. For tag transitions, the conversion-owner
share fell from 76.3% to 63.9%; for empty nodes it fell from 74.0% to 37.1%.
The control-only repeated plan-building helpers accounted for 29.5% of tag
samples and 43.8% of empty-node samples, then disappeared from the candidate's
top self symbols. `normalizeCustomInductive` itself fell from 9.0% to 3.3% for
tags and from 11.6% to 4.5% for empty nodes.

Sample shares are diagnostic. The order-balanced, uninstrumented,
repository-owned comparison above is the acceptance evidence.

## Size And Validation

The checked-in infoview bundle grew from 321,934 to 322,971 bytes. The Wasm is
unchanged. Validation includes the cached/replaced-plan test, workload shape
contract, pure JavaScript and Lean-backed runtime suites, generated infoview
bundle parity, exact benchmark output checks, and upstream fixtures.

After this change, the largest conversion-specific owners are
`objectLayoutSlotsFromPlan`, `normalizeCustomInductiveFields`, and the remaining
per-node construction path. The interpreter is now the largest owner in the
empty-output profile, so further conversion changes should start from a fresh
representative profile rather than extending this cache speculatively.
