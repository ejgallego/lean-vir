# Custom Inductive Object Conversion Performance

Last measured: 2026-08-06

## Result

Cache the manifest-derived normalization plan for custom-inductive values. On
the direct `Std.Format.prettyM` boundary, the accepted candidate reduced the
representative 64-by-64 tag-transition workload by 43.65% and the focused
2,047-node empty-output workload by 64.01% in an eight-pass AB/BA comparison.
Every structural paired pass improved. The small text call and fresh-runtime
guardrails showed no regression.

The manifest is validated when a package is installed, but the old lowering
path repeated the following work for every recursive custom-inductive node:

- validate every constructor and field layout;
- generate all diagnostic shape strings;
- linearly search constructor names;
- allocate allowed-key and expected-field sets.

`normalizeCustomInductive` now stores a `WeakMap` plan keyed by the manifest
type object. The plan retains the constructor-array identity, constructor name
map, diagnostic shapes, and validation sets. Replacing `type.constructors`
invalidates the entry. Per-value kind, key, field-presence, and payload checks
remain on every call, with the same diagnostics.

## Comparison

The benchmark loads the unmodified PR #104 runtime and the candidate runtime in
one Node process. Both sides use the same compiled Wasm module and `.irpkg`.
The structural rows keep ordinary `runtime.call`, so input lowering,
interpreter execution, and result lifting are all included.

```bash
npm run bench:pretty-object-conversion -- \
  --passes 8 \
  --warmup-batches 6 \
  --batch-target-ms 750 \
  --startup-iterations 10 \
  --output build/object-conversion/comparison-8pass-long.json
```

| Workload | Control median | Candidate median | Upper-median paired delta | Paired candidate deltas |
| --- | ---: | ---: | ---: | --- |
| 64 tag levels x 64 chunks | 98.664428 ms | 54.933655 ms | -43.65% | -43.94%, -43.65%, -43.60%, -48.20%, -43.58%, -44.76%, -41.94%, -45.50% |
| 2,047 empty-output nodes | 28.316006 ms | 10.171186 ms | -64.01% | -65.27%, -62.66%, -62.18%, -61.24%, -64.01%, -66.01%, -68.69%, -65.84% |
| 8 text code points | 0.068038 ms | 0.053636 ms | -17.09% | -5.93%, -17.09%, +0.88%, -23.82%, -10.24%, -18.45%, -29.09%, -21.84% |
| fresh runtime/package/first text call | 20.829150 ms | 20.135926 ms | -2.73% | -6.75%, -11.46%, -0.19%, +2.09%, -6.02%, -3.50%, -2.73%, -1.79% |

Every warmup and measured batch checked the exact output digest. The control
source is clean PR #104 commit
`64e30784da16957cca92951344d776f895b30491`; the measured candidate is clean
commit `76a9629ea03d59883f4c4705151d611ddb414621`.

The ignored report is 22,725 bytes with SHA-256
`ae176df76855dfb8ffc92ebd12445504af2c4be899aef70132ee0095c41c1222`.
Its Wasm SHA-256 is
`c70093b656120ed1346fb916ed7d21eb02baefb283ed337092f8276f209c7185`;
the package SHA-256 is
`2a15c5c6b069c753f00f3efc660f0f4bbe01cdc1b9b856816198cd84c0c78f0b`.

## Profile Cross-check

Comparable four-second V8 profiles used the optimized unstripped Wasm and the
same public call boundary. For tag transitions, the object-conversion owner
share fell from 76.3% to 63.9%, while completed calls rose from 31 to 54. For
empty nodes, it fell from 74.0% to 37.1%, while calls rose from 126 to 298.

`customInductiveShape`, `requireCustomInductiveConstructors`, and
`customInductiveShapes` accounted for 29.5% of control tag samples and 43.8%
of control empty-node samples. None remained among the candidate's top self
symbols. `normalizeCustomInductive` itself fell from 9.0% to 3.3% for tags and
from 11.6% to 4.5% for empty nodes. This is the predicted profile movement.

Raw profiles and summaries are ignored artifacts in the profiling worktree:

- `build/internal-counters/profiles/object-conversion-control-final-20260806/`
- `build/internal-counters/profiles/object-conversion-candidate-final-20260806/`

Sample shares and profiled throughput are diagnostic. The order-balanced,
uninstrumented comparison is the acceptance evidence.

## Size And Validation

The checked-in infoview bundle grew from 321,934 to 322,971 bytes. The Wasm is
unchanged. Validation includes the focused cached/replaced-plan test, all 12
pure JavaScript runtime tests, all 17 runtime tests including the Lean-backed
package cases, generated infoview bundle parity, exact benchmark output parity,
and all 82 upstream fixtures.

After this change, the largest conversion-specific owners are
`objectLayoutSlotsFromPlan`, `normalizeCustomInductiveFields`, and the remaining
per-node construction path. The interpreter is now the largest owner in the
empty-output profile, so further conversion changes should be selected from a
fresh representative profile rather than extending this cache speculatively.
