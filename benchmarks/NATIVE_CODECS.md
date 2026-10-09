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

The local draft-pair experiment can be selected with
`"experiment": "native-value-interface"` on a variant. It uses the generic SDK
and its existing fixture package. Before calls, it installs a different cached
value-codec binder; normal entry lookup, ownership, native dispatch and disposal
remain in use. Installation is recorded separately. Lazy descriptor snapshot and
binding remain included in first-call observations, outside warmed call timing.
The snapshot expresses the admitted producer metadata in the draft grammar;
it is an experimental input adapter, not a second supported manifest format.
The driver records the experiment sources and their imported ABI helpers. No
claim about new manifest size, native producer integration or public API readiness
follows from this experiment.

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
| Nat/Int transport | Current helpers format/parse decimal text through UTF-8 and JS bigint. | No change to this transport in the pair prototype. |
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

The latest retained release screen used Node24.21.0, an AMD Ryzen AI9 HX370,
the same Wasm/native program sections, sizes0/16/128/1024, small/large integers,
and12 alternating AB/BA pairs. At1024, these are median paired roundtrip changes
for the **draft-pair prototype relative to the older specialized codec**:

| Family | Small integers | Large integers |
| --- | ---: | ---: |
| Records | -8.6% | -6.3% |
| Recursive Tree | -32.2% | -13.3% |
| Nested List/Option/Prod | +3.2% | -0.3% |
| Enum array | -44.6% | -43.4% |
| String control | +4.1% | +0.6% |
| Byte-array control | +2.9% | +2.9% |

Negative means faster. Small nested roundtrip and large nested output were mixed
across pairs; small nested output remained10.7% slower (10/12 pairs). Even the
unchanged text/byte paths have small deltas, so these figures should guide source
inspection, not serve as precise forecasts. They describe the prototype, not a
speedup already present in the production generic-container codec.

These timings precede the draft's core-tag reduction. The current prototype
uses primitives, Lean objects, and resources; constructor, native-array and
callable facts are optional codec metadata. The grammar revision retains the
same conversion algorithms and makes no new speed claim.

The representative next comparison is an actual caller's complete encode/call/
decode workflow, including the materialization it chooses. A JSL boundary can
keep data opaque when the application does not need a JS graph. The view grammar
should make that choice explicit; it should not infer application wire rules or
route ordinary native calls through JSON serialization.
