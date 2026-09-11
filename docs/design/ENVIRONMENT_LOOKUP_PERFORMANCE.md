# Environment Lookup Performance

The focused measurements from 2026-08-05 explain VIR's declaration-name hashes
and lookup indices. They used fresh interpreter entries; the current benchmark uses a
package-scoped session, as described in [Performance](../development/PERFORMANCE.md#environment-lookup-workload).

## Outcome

The reported lookup cost had two independent causes:

1. VIR's local `lean_name_mk_string` and `lean_name_mk_numeral` providers wrote
   the constant hash `1729` into every decoded `Lean.Name`. Consequently,
   `lean_name_eq` could not reject unequal names by hash, and every hash table
   collapsed into one bucket.
2. `find_package_decl` and `find_package_boxed_decl` linearly scanned all loaded
   declarations for every fresh interpreter cache miss.

The implementation computes the same name hashes as Lean and builds
two `lean::name_hash_map<uint32_t>` indices when a package set is prepared. One
map indexes full declaration names and the other indexes boxed base names;
manifest validation and initializer execution happen afterward.
Values remain stable slots in the package-owned declaration vector.

Correct hashes also reduced index-construction cost. The measured hash-map
implementation improved package loading without a format change.

## Reproducible Workload

The repository-local workload reproduces Illuminate's many short asynchronous
entries without depending on Illuminate:

- the package used for the recorded measurements contained 1,546 declarations;
- `Vir.Fixtures.ExprPrinter.exprCoverageScore` is deterministic and returns
  `1232`;
- for the recorded `environment-lookup-v1` results, every timed call entered a
  fresh upstream interpreter, matching a callback after the previous
  browser-to-Lean call had returned;
- the execution row excludes package loading, initializer execution, and
  export-slot resolution;
- the package-load row times decode, initializer execution, and manifest
  installation in a fresh Wasm instance while excluding instantiation and
  disposal.

[Performance](../development/PERFORMANCE.md#environment-lookup-workload) gives the report,
profile and AB/BA comparison commands, including `--no-build` prerequisites
and the complete comparison identity. Profiles are diagnostic; the timing
comparisons below use unprofiled runs with matching artifacts and workloads.

## Measurements

The focused comparisons used six order-balanced AB/BA passes on 2026-08-05, Node
24.18.0, an AMD Ryzen AI 9 HX 370, the pinned Lean 4.33.0-rc2 toolchain, and
the same format-10 package bytes within each comparison.

| Comparison | Execution paired median | Package-load paired median |
| --- | ---: | ---: |
| constant hashes + linear scan → correct hashes + linear scan | -56.7% | -23.8% |
| correct hashes + linear scan → correct hashes + sorted binary index | -57.9% | -3.4% |
| correct hashes + sorted binary index → correct hashes + `name_hash_map` | -15.3% | -1.6% |
| original → combined implementation | -84.8% | -26.2% |

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

### Illuminate acceptance

The follow-up representative test used the same animation, package bytes,
modular runtime, and sustained 60 Hz callback rate for control and candidate.
Across eight order-balanced A/B runs it reported:

| Workload                        |  Control | Candidate | Improvement |
| ------------------------------- | -------: | --------: | ----------: |
| VIR fresh-entry benchmark       | 371.4 µs |   56.2 µs |        6.6x |
| Package loading                 | 12.35 ms |   9.21 ms |       25.4% |
| Illuminate sustained 60 Hz mean |  1.10 ms |  0.545 ms |        2.0x |
| Illuminate sustained p95        |  1.60 ms |   0.75 ms |         53% |
| Illuminate callback CPU         |     6.6% |      3.3% |         50% |

There were zero DOM mismatches and zero browser errors. The post-change sampled
profile also moved in the predicted direction:

- `lean_name_eq` represented 32% of symbolized active time in the control and
  was absent from the candidate's top 25;
- sampled `get_decl` self-time fell from 14.8 to 3.3 milliseconds;
- native-symbol lookup fell from 29.0 to 10.3 milliseconds;
- interpreter symbol lookup fell from 21.1 to 4.2 milliseconds; and
- the new package hash-map lookup represented about 6.5% of the remaining
  symbolized active time.

This broader movement is expected: correct `Name` hashes improve every
interpreter hash table that sees decoded package names, not only VIR's new
declaration index. Profile timings remain attribution evidence; the unprofiled,
order-balanced callback measurements are the acceptance result.

### Post-index attribution

A later Illuminate profile examined what remained after accepting the index.
Of symbolized attributable samples, package, native, and interpreter-local
lookup together with `get_decl` and `lookup_symbol` accounted for 14.9%.
Including interpreter call dispatch raised that cluster to 18.9%. The leading
other buckets were generic IR body evaluation at 12.58%, DOM `setAttribute` at
5.69%, and garbage collection at 3.38%. `lean_name_eq` was no longer a leading
symbol, confirming that the accepted patch removed the original collision
pathology.

That profile is diagnostic: Chrome assigned 53.18% of its sample to
unsymbolized program time. An accompanying eight-context unprofiled snapshot
ran on an unusually busy host and is not numerically comparable with the
controlled acceptance run. It measured a 2.30 millisecond median and 3.70
millisecond p95 for the isolated VIR callback, with no callback exceeding the
16.7 millisecond frame budget. These values establish the post-index path, not
a replacement baseline.

VIR now retains the complete interpreter session for one package generation,
including evaluated nullary constants across public calls; see the
[interpreter lifecycle](../reference/UPSTREAM_BOUNDARY.md#package-instance-lifecycle).

## Name hashes and indices

Decoded names now use Lean's real construction rules:

```text
str hash = mixHash(prefix.hash, string.hash)
num component = numeral value when numeral < 2^64, otherwise 17
num hash = mixHash(prefix.hash, num component)
```

The package provider keeps two heap-allocated maps:

```cpp
lean::name_hash_map<uint32_t> declarations;
lean::name_hash_map<uint32_t> boxedDeclarations;
```

They are allocated after all package-set members have been appended and before
initializers run. Heap allocation gives the maps an explicit package-set
lifecycle and mirrors the upstream interpreter's cache initialization; the
JavaScript runtime calls `__wasm_call_ctors` before package loading. Map keys
retain their `Lean.Name`; map values are declaration slots and add no
declaration ownership. Clearing a package deletes both maps before releasing
vector-owned names and declarations.

Lean's environment uses sorted `Name.quickLt` arrays for imported entries and a
persistent hash map for local entries. Its C++ interpreter uses
`lean::name_hash_map` for initializer, native-symbol, constant and symbol caches.
The same C++ map measured faster than a sorted side index for VIR's flat
declaration namespace.

[Boundary fixtures](../../fixtures/Boundary.lean) compare string and numeric
`Name.hash` values against host Lean, including the largest UInt64 numeral and
the oversized-numeral rule.

## Provider boundary

VIR still supplies `lean_ir_find_env_decl*` and passes a dummy environment to
the interpreter. Lean's default lookup expects a valid `Lean.Environment` with
module ownership and `Lean.IR.declMapExt` state, whereas `.irpkg` currently
carries decoded declarations rather than an environment.

[ULC-0001](IR_DECLARATION_LOOKUP.md)
records why constructing a valid environment pulls in a disproportionate
compiler-initialization closure for declaration-only execution, and describes
the proposed upstream provider API.

## Rejected or Superseded Experiments

- The first `name_hash_map` screen was rejected at 1.07 milliseconds per call,
  but that result was invalidated: every key hashed to `1729`, so the map had
  one bucket. With correct hashes it is the fastest measured representation.
- A stored 64-bit-hash collision index reached 1.83 milliseconds per call for
  the same reason: every runtime name landed in the collision range.
- A sorted side-vector index was a robust improvement and closely mirrors
  imported Lean environment lookup, but the corrected hash map was another
  15.3% faster in paired testing.
- A format-11 precomputed sorted-index section was abandoned: correct hashes
  removed the apparent sorting regression, so the measurements no longer
  justified the extra format and decoder complexity.
