# Environment Lookup Performance

This note records the reproducible workload, measured experiments, accepted
implementation, and proposed upstream boundary for VIR declaration lookup.

## Outcome

The reported lookup cost had two independent causes:

1. VIR's local `lean_name_mk_string` and `lean_name_mk_numeral` providers wrote
   the constant hash `1729` into every decoded `Lean.Name`. Consequently,
   `lean_name_eq` could not reject unequal names by hash, and every hash table
   collapsed into one bucket.
2. `find_package_decl` and `find_package_boxed_decl` linearly scanned all loaded
   declarations for every fresh interpreter cache miss.

The accepted implementation computes the same name hashes as Lean and builds
two `lean::name_hash_map<uint32_t>` indices when a package set is finished. One
map indexes full declaration names and the other indexes boxed base names.
Values remain stable slots in the package-owned declaration vector.

No `.irpkg` format change is needed. A format-11 precomputed-index experiment
was started when runtime sorting appeared to regress package loading, but the
profile showed that the apparent sort cost was itself caused by constant name
hashes. Correct hashes made index construction cheap, and the measured hash-map
implementation does not regress package load.

## Reproducible Workload

The repository-local workload reproduces Illuminate's many short asynchronous
entries without depending on Illuminate:

- `fixtures-lean.irpkg` contains 1,546 declarations;
- `Vir.Fixtures.ExprPrinter.exprCoverageScore` is deterministic and returns
  `1232`;
- every timed call enters a fresh upstream interpreter, matching a callback
  after the previous browser-to-Lean call has returned;
- the execution row excludes package loading, initializer execution, and
  export-slot resolution;
- the package-load row times decode, initializer execution, and manifest
  installation in a fresh Wasm instance while excluding instantiation and
  disposal.

Capture an unprofiled report with a fresh output path:

```bash
npm run bench:env-lookup -- \
  --json build/perf/env-lookup/current.json
```

Use `--no-build` only after matching artifacts have been built. Reports record
the Git state, machine and toolchain, Wasm/package/harness/fixture hashes, run
policy, raw samples, and checksum. Comparisons reject mismatched identities.

Collect attribution separately:

```bash
npm run bench:env-lookup -- \
  --cpu-profile build/perf/env-lookup/current.cpuprofile \
  --json build/perf/env-lookup/current-profiled.json
```

For acceptance, use byte-identical packages and an even AB/BA schedule:

```bash
npm run bench:paired -- \
  --npm-script bench:env-lookup \
  --repeat 6 \
  --out build/perf/env-lookup/lookup-abba \
  --bench-arg=--iterations=1000 \
  --bench-arg=--samples=9 \
  ../vir-baseline ../vir-candidate
```

## Measurements

All decisions below use six order-balanced AB/BA passes on 2026-08-05, Node
24.18.0, an AMD Ryzen AI 9 HX 370, the pinned Lean 4.33.0-rc2 toolchain, and
the same format-10 package bytes within each comparison.

| Comparison | Execution paired median | Package-load paired median | Decision |
| --- | ---: | ---: | --- |
| constant hashes + linear scan → correct hashes + linear scan | -56.7% | -23.8% | accept hash fix |
| correct hashes + linear scan → correct hashes + sorted binary index | -57.9% | -3.4% | useful, but not final |
| correct hashes + sorted binary index → correct hashes + `name_hash_map` | -15.3% | -1.6% | accept hash map |
| original → accepted combined implementation | -84.8% | -26.2% | final focused result |

For the final original-to-candidate comparison, aggregate medians moved from
403.4 to 58.9 microseconds per fresh entry, a 6.85x speedup. All six paired
execution deltas improved, ranging from -84.7% to -85.8%. Package loading moved
from 12.44 to 9.07 milliseconds; all six paired passes improved. The compared
package SHA-256 was
`966ff81ae17f86b508e02dfcc66ba1b5ec636ef5ef9a5ac35d2cd6106270c68b`.

The initial execution profile attributed 53.4% of self samples to
`lean_name_eq`, followed by the interpreter symbol-cache lookup at 15.0%, the
native-symbol lookup at 6.5%, and VIR declaration lookup at 5.4%. In the final
hash-map profile, `lean_name_eq` fell to 3.6%; the VIR declaration map lookup
was 6.6%, while interpreter execution and its symbol cache became the largest
remaining buckets. Profiled elapsed time is diagnostic and is not used for the
headline comparison.

An identical-code AB/BA control produced execution deltas from about -31% to
+5%, so small one-off deltas are not actionable. The accepted execution
movements are much larger, consistent across every paired pass, and accompanied
by the predicted profile movement.

## Accepted Local Design

Decoded names now use Lean's real construction rules:

```text
str hash = mixHash(prefix.hash, string.hash)
num hash = mixHash(prefix.hash, numeral value)
```

The package provider keeps two heap-allocated maps:

```cpp
lean::name_hash_map<uint32_t> declarations;
lean::name_hash_map<uint32_t> boxedDeclarations;
```

They are allocated after all package-set members have been appended and before
initializers run. Heap allocation is required because ordinary C++ global
constructors are not run in this Wasm build. Map keys retain their `Lean.Name`;
map values are declaration slots and add no declaration ownership. Clearing a
package deletes both maps before releasing vector-owned names and declarations.

This is close to upstream rather than a new VIR-specific hash structure:

- Lean's environment lookup uses sorted `Name.quickLt` arrays for imported
  module entries and a persistent hash map for local entries;
- the upstream C++ interpreter already uses `lean::name_hash_map` for its
  initializer, native-symbol, constant, and symbol caches;
- VIR has a flat package-set declaration namespace, for which the shared C++
  `name_hash_map` measured faster than a sorted side index.

The binary-search candidate remains a valid analogue of upstream imported
lookup, but the hash map is the measured winner for VIR's flat provider.

## Upstream API Direction

VIR currently supplies the exported `lean_ir_find_env_decl` and
`lean_ir_find_env_decl_boxed` symbols and passes a dummy environment to the
interpreter. The local implementation can ship behind that boundary, but the
desired upstream endpoint is an explicit provider rather than link-symbol
replacement.

The first upstream change should add a `run_boxed` overload with a callback
table equivalent in ownership semantics to:

```cpp
struct decl_provider {
    void * state;
    uint64_t revision;
    object * (*find_decl)(void * state, object * name);       // borrowed or null
    object * (*find_boxed_decl)(void * state, object * name); // borrowed or null
};
```

The provider state remains alive for the call. The interpreter retains any
declaration it caches. `revision` changes before the provider can return a
different answer for the same name. Existing environment-backed entry points
remain the default, so normal Lean callers do not change.

VIR's current map lookups can become these callbacks without moving the index
into upstream or exposing `.irpkg`. Once the overload exists,
`interpreter_bridge.cpp` passes the provider explicitly and removes VIR's
replacement definitions of the exported lookup symbols.

Only after the Illuminate acceptance workload is re-profiled should upstream
consider an optional caller-owned symbol cache. The final focused profile still
shows interpreter symbol-cache work, but a reusable cache needs precise
identity over environment, relevant options, provider state, and provider
revision. It should retain only resolved declaration/native-symbol metadata,
not mutable interpreter stacks or evaluated constants.

## Rejected or Superseded Experiments

- The first `name_hash_map` screen was rejected at 1.07 milliseconds per call,
  but that result was invalidated: every key hashed to `1729`, so the map had
  one bucket. With correct hashes it is the fastest measured representation.
- A stored 64-bit-hash collision index reached 1.83 milliseconds per call for
  the same reason: every runtime name landed in the collision range.
- A sorted side-vector index was a robust improvement and closely mirrors
  imported Lean environment lookup, but the corrected hash map was another
  15.3% faster in paired testing.
- A format-11 precomputed sorted-index section was abandoned. Compatibility
  was not a constraint, but measurements no longer justified the format and
  decoder complexity.
- Decoder-wide name interning and whole-interpreter persistence remain
  unnecessary. Application batching may still help Illuminate, but it should
  not be required to hide provider lookup costs.

## Remaining Validation

Repository validation covers package hits/misses, boxed separation, package
sets and duplicate rejection, failed loads, initializers, reload, and fixture
agreement. The boundary fixture also includes actual `Name.hash` values so the
constant-hash regression is observable against host Lean.

The representative acceptance gate remains Illuminate's isolated callback and
16-player dashboard workloads, including DOM/state differential checks. If
those do not move with the focused 6.85x result, the next profile—not the old
provider hypothesis—should select the next target.
