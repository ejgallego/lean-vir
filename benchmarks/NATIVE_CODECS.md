# Native codec comparison

This focused screen compares the same native program, Wasm, and JavaScript
representations through public `runtime.call`. It measures no JSON data conversion.
Configuration and reports use JSON only as a file format.

This is a reduced mechanism screen, not an application performance target.
Retain earlier SDK/package pairs as comparison controls. Reuse retained
measurements for architectural review; run a focused comparison when a concrete
change needs evidence. Full sweeps are optional and are not a release gate.

The fixture supplies records with mixed scalar/object fields, nested Options,
Tree through List/Option/Prod/Sum, enums, Unicode/NUL strings, and bytes. Sizes
0/16/128/1024 and small/large integer corpora are generated identically for both
variants. Tree size means its base binary leaf count, with additional leaves in
the mixed-container fields; size 0 is the required single leaf inhabitant.

Each family has three call boundaries:

| Direction | Actual boundary |
| --- | --- |
| `roundtrip` | Structural input -> native identity -> structural output. |
| `input` | Structural input -> constant-work inspection -> small scalar output. |
| `output` | Retained JSL input -> owned native value -> structural output. |

Input/output cases include their complete public call and small native body;
they are not isolated lowering/lifting kernel timers. Retained values are
prepared outside timing, remain strongly reachable, and are released on runtime
disposal. No borrowed-pointer API or extra shared-service lifetime is introduced.

Fresh-runtime observations record factory construction, runtime creation,
retained-value preparation, and the first call of each export separately. Imports
are single observations outside those trials. These are not cold-process/browser
measurements. There is no supported standalone codec-compilation timer yet;
first-call cost includes planning and call preparation. Do not add independently
aggregated phase medians into a total.

## Running

Supply immutable extracted SDK roots and independently generated fixture packages:

```json
{
  "control": {
    "label": "specialized-reference",
    "sourceRoot": "./control-checkout",
    "sdk": "./control-sdk",
    "package": "./control.irpkg"
  },
  "candidate": {
    "label": "candidate",
    "sourceRoot": "./candidate-checkout",
    "sdk": "./candidate-sdk",
    "package": "./candidate.irpkg"
  },
  "profile": "release",
  "wasm": "./shared-vir-upstream.wasm",
  "output": "./release-comparison.json",
  "sizes": [0, 16, 128, 1024],
  "warmups": 10,
  "rounds": 12,
  "calls": 10,
  "coldRounds": 2
}
```

Paths are relative to the configuration file. `cases` optionally selects names
`records`, `nested`, `tree`, `modes`, `text`, or `bytes` for a bounded run.

```sh
node benchmarks/harness/bench-native-codecs.mjs prepare comparison.json
node benchmarks/harness/bench-native-codecs.mjs run comparison.json
```

`prepare` resolves the existing generator with `--no-build`, then explicitly builds
and packs the same fixture through the existing project helper. Matching compiled
library/generator inputs must already be prepared; it does not rebuild a missing
generator, generate an SDK, replace runtime pins, or run timings. Commit source
changes and prepare the matching SDKs separately before recording an accepted
comparison. `run` performs no builds.

The driver uses the ordinary public call path for each independently retained
SDK/package pair. The ordinary producer emits the pair directly;
no snapshot adapter or benchmark-specific binder is installed. Cold first-call
observations include lazy binding; warmed calls reuse the admitted cached plan.
The shared fixture and Wasm/native program sections remain comparison controls.

The driver verifies all SDK payload hashes, one shared Wasm hash, matching Lean
toolchains and identical non-manifest native package sections before timing.
Only descriptor metadata may differ. It preserves source/SDK/package identities,
all raw samples and measured orders. Output paths are exclusive: use a fresh path
for each run. A failed run is retained with `status: failed`.

Correct output, unchanged input, healthy runtime state and expected live carriers
are checked outside timing. Teardown verifies carrier cleanup. These counters
are benchmark diagnostics, not a public codec API or a complete heap-leak proof.
The report contains per-pair ratios and distributions; review small/empty rows as
well as large ones. Host load and short timings can make a result inconclusive.

Report fresh-runtime costs and manifest size separately. This focused screen
does not qualify application speedups: real callers still need matched public
codec integration and their own full-response or typed-value acceptance.

## Performance and slow paths

The conversion path is:

```text
JS value checks -> lower fields -> allocate Lean objects -> execute Lean
  -> acquire/inspect fields -> lift primitives -> construct JS values
```

| Cost | Why it remains | What the bound plan removes |
| --- | --- | --- |
| Value checks | Constructor choice, own payloads, keys and ranges vary per call. | Repeated interpretation of admitted descriptor structure. |
| Native allocation | Materializing a constructor graph allocates its nontrivial nodes. | Storage selection and field-location branches for common small layouts. |
| Bridge calls and pointer buffers | Construction, inspection and reference release cross JS/Wasm. | Repeated scratch allocation within a lowering operation; it does not remove all crossings. |
| Nat/Int transport | Heap Nat, Int and textual inputs use decimal UTF-8 conversion. | Numeric wasm32 Nat values through 2³¹−1 use existing native scalar construction/inspection. |
| Strings and bytes | Strings cross UTF-16/UTF-8; byte results copy into JS-owned storage. | No zero-copy or binary-integer claim. |
| Output materialization | Structural output creates JS objects/arrays and releases acquired children. | Per-field property-descriptor allocation, using bound own-property templates. |
| Binding/startup | Admission, freezing, slot resolution and codec compilation precede warmed calls. | Planning is cached; warmed measurements exclude these costs. |

Finite immediate constructor values are obtained from the native allocator once
and checked against that set. This avoids repeating scalar boxing/unboxing,
without reproducing pointer encoding or retaining heap objects. Enum, Bool and
Unit representations still come from their chosen value interface. Logical field
mappings, physical storage and recursive scope remain distinct facts.

## Recorded comparisons and next measurement

The [historical mechanism screens](https://github.com/ejgallego/lean-vir/blob/b6d11badcb5119589cd861cc6901be2a4b0ad677/benchmarks/NATIVE_CODECS.md#performance-and-slow-paths)
record the initial pair migration, scalar-Nat path and scratch-view comparisons,
with their separate immediate baselines and limitations. Preserve their SDK/
program identities and raw samples when comparing another change. Do not combine
ratios from those separate screens into a predicted application speedup.

The matched whole-pair-sharing comparison records:

| Measurement | Inline pairs | Shared pairs |
| --- | ---: | ---: |
| Callable pair occurrences / table entries | 52 | 10 |
| Manifest JSON bytes | 55,258 | 17,712 |
| Manifest offline gzip bytes | 2,585 | 2,171 |
| Whole-package offline gzip bytes | 3,760 | 3,325 |
| Resolved object/array identities | 1,882 | 445 |

All non-manifest native sections and all 26 callable signatures agree. Object
counts are static graph identities, not heap measurements. Sharing has no new
timing or application/startup speedup claim. Runtime lines, compressed bundle
size, manifest size and whole-call cost remain separate measurements.

The next comparison should use an actual caller's complete encode/call/decode
workflow, including the materialization it requests. Constructor creation, field
acquisition/release, value checks and output allocation remain costs. Heap
integers and real strings retain UTF conversion. Sampled encode/decode frames
identify UTF work in these callers, not JSON data serialization.

An application can retain substantial Lean state through JSL when it needs only
operations on that state. Explicit application codecs own wire rules and JSON
serialization; ordinary native calls do not infer those rules. The existing
focused harness is sufficient for a bounded next comparison.
