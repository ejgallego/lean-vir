# Native codec comparison

This focused screen compares the same native program, Wasm, and JavaScript
representations through public `runtime.call`. It measures no JSON data conversion.
Configuration and reports use JSON only as a file format.

This is a reduced mechanism screen, not an application performance target.
Keep the older specialized and generic codec paths as references. Reuse retained
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
SDK/package pair. The producer/runtime migration emits the pair directly;
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

Sampling of nested values identified field loops, pointer writes, field
inspection and Nat/UTF conversion. The builtin `encode`/`decode` frames refer to
UTF handling in these callers; they are not evidence of JSON data conversion.
Numeric Wasm frames were not assigned names speculatively. Sampling shares are
attribution hints, not predicted application savings.

The emitted-pair migration was compared with the preceding generic production
codec using Node 24.21.0, an AMD Ryzen AI 9 HX 370, identical Wasm/native program
sections, sizes 16/1024, small/large integers, and eight alternating AB/BA pairs.
At 1,024, the median paired roundtrip changes **before the new optimizations** were:

| Family | Small integers | Large integers |
| --- | ---: | ---: |
| Records | -6.8% | -1.8% |
| Recursive Tree | -15.0% | -5.6% |
| Nested List/Option/Prod | -12.8% | -4.9% |
| Enum array | -43.3% | -43.0% |
| String control | -0.7% | -7.0% |
| Byte-array control | -2.4% | -2.3% |

Negative means faster. These are mechanism measurements, not application
forecasts. The manifest grew from 46,095 to 55,270 bytes, about 20%; separating
native facts from value mappings does not make inline JSON smaller. Fresh-runtime
creation medians were 7.7ms and 8.3ms across eight observations each. Imports and
first calls remain separately recorded; this small screen does not establish a
cold-browser startup result.

A sampled nested-small-integer workload then identified decimal UTF conversion:
`encode` alone accounted for about 9% of sampled time. Using existing native
scalar operations for numeric Nat values through 2³¹−1 removed that text path.
A separate matched comparison against the corrected migrated codec measured:

| Family at 1,024 | Small integers | Large integers |
| --- | ---: | ---: |
| Records | -13.6% | -1.2% |
| Nested List/Option/Prod | -35.7% | -1.6% |
| Recursive Tree | -37.4% | -0.4% |

The small nested/tree roundtrips improved in all eight pairs. Large-integer
results remain close to baseline; their decimal path remains. Large-tree output
was 3% slower in this screen, while unchanged controls also moved, so this is not
proof of zero overhead. Boundary regression tests cover the largest scalar,
heap values, exact larger integers, textual inputs, and invalid inputs.

The follow-up profile put pointer-buffer writes first. Reusing the DataView
inside an existing per-lowering scratch region gave another 14.2% improvement
for small nested roundtrips and 10.5% for small trees in a focused eight-pair
comparison; both improved in every pair. Large nested/tree improvements were
4.1%/3.9%. This preserves explicit little-endian writes and refreshes the view
when allocation or memory growth changes its backing buffer. A real Wasm test
forces growth after the view has already been used. Unchanged enum controls
varied between screens; their deltas are not attributed to this change.

Those stages use different immediate baselines. Do not multiply their median
ratios into a claimed combined speedup. The final profile still shows native
constructor creation, field acquisition/release, shape checks and output
materialization. Larger integers and real strings still use UTF conversion.
No JSON data serialization, new native ABI, or borrowed-pointer API was added.

The representative next comparison is an actual caller's complete encode/call/
decode workflow, including the materialization it chooses. A JSL boundary can
keep data opaque when the application does not need a JS graph. The view grammar
should make that choice explicit; it should not infer application wire rules or
route ordinary native calls through JSON serialization.
