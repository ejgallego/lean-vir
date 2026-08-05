# Environment Lookup Performance

This note defines the reproducible workload and proposed design for the
environment/declaration lookup cost reported by Illuminate's animation player.
It intentionally stops before implementing the lookup optimization. Land the
measurement surface first, then use it to evaluate the provider index and any
later upstream interpreter API.

## Current Finding

Illuminate reported many short asynchronous entries into interpreted Lean. Its
profile put `lean_name_eq` first, with interpreter-local/native symbol maps and
VIR's declaration provider accounting for most of the remaining symbolized
work. VIR currently resolves a package declaration by linearly scanning
`g_entries` in `package_decl_provider.cpp`.

The repository-local focused workload reproduces that shape without depending
on Illuminate:

- `fixtures-lean.irpkg` contains 1,546 declarations;
- `Vir.Fixtures.ExprPrinter.exprCoverageScore` is a short, deterministic,
  no-argument call that resolves many internal targets;
- every measured operation enters a fresh upstream interpreter, matching an
  asynchronous callback after the previous browser-to-Lean call has returned;
- the headline execution row starts after package loading, initializer
  execution, and export-slot resolution;
- a secondary row times package decode, initializer execution, and manifest
  installation in a fresh Wasm instance, with instantiation and disposal
  excluded;
- every call must return `1232`.

One unprofiled run on 2026-08-05 at commit `246493d76ded` measured a median
400.8 microseconds per fresh entry, with seven batch medians ranging from 391.8
to 420.2 microseconds. Later same-build screening runs measured 618.4 and 676.0
microseconds, demonstrating substantial machine-state noise and the need for
order-balanced comparisons. These are attribution/workload snapshots, not a
committed threshold. The first run used Node 24.18.0 on an AMD Ryzen AI 9 HX
370, Wasm SHA-256
`072b7fa43acf3a7db54507df49250f13a4ad1fcb2ee88c9cfa7c74d583e75a33`, and
package SHA-256
`c6789f8da1a1967844923213d13be6cf10e7242d4ea3aeb281d673f909682738`.

A separate V8 CPU profile at a requested 100 microsecond interval, restricted
to the execution window, attributed self samples as follows:

| Symbol or bucket | Self samples |
| --- | ---: |
| `lean_name_eq` | 53.4% |
| interpreter-local symbol-map `find` | 15.0% |
| global native-symbol-map `find` | 6.5% |
| `lean::vir::find_package_decl` | 5.4% |
| `interpreter::get_decl` | 1.2% |

The sampled profile is attribution evidence and its timings must not be used as
headline numbers. The focused workload selects the mechanism; Illuminate's
callback/dashboard run remains the representative acceptance workload.

## Measurement Commands

Build or restore inputs, then capture an unprofiled report:

```bash
npm run bench:env-lookup -- \
  --json build/perf/env-lookup/baseline.json
```

Use a new output path for every run; the command refuses to overwrite reports.
`--no-build` is an explicit local shortcut after `npm run build:demo` has
already produced matching artifacts. The report records:

- command, Git revision, dirty-status hash, and tracked-diff hash;
- Node/V8, CPU, platform, pinned Lean toolchain, and Wasm build configuration;
- Wasm, package, harness, and fixture hashes;
- package/manifest versions and declaration count;
- warmup/sample policy, exact endpoint, raw batch timings, and checksum.

Reports also carry a stable comparison identity. `bench:compare` and
`bench:paired` reject a mismatch in workload, run policy, diagnostics mode,
toolchain/machine, package size/version, harness, or fixture before printing a
delta.

Collect attribution separately. Profiling automatically selects the optimized,
unstripped `vir-upstream.dev.wasm` companion:

```bash
npm run bench:env-lookup -- \
  --cpu-profile build/perf/env-lookup/baseline.cpuprofile \
  --json build/perf/env-lookup/baseline-profiled.json
```

The JSON report includes a short self-sample summary and the raw profile hash.
Load the `.cpuprofile` into Chrome DevTools for call-tree inspection. Do not
compare its elapsed timings with diagnostics-off runs.

For a candidate, use two checkouts that both contain this harness and an even
number of AB/BA passes:

```bash
npm run bench:paired -- \
  --npm-script bench:env-lookup \
  --repeat 6 \
  --out build/perf/env-lookup/index-abba \
  ../vir-baseline ../vir-index
```

The paired runner refuses an existing output directory. It preserves every
per-run report plus `schedule.json`, including pass, AB/BA sequence, position,
and completion state. Its summary prints every paired pass delta and their
median. One pass remains available for screening; an odd pass count is
explicitly reported as not order-balanced.

## Current Lookup Path

For the first occurrence of an internal target in each fresh entry:

```text
decoded IR target name
  -> interpreter-local m_symbol_cache                  miss
  -> process-wide native-symbol name_hash_map          usually hit
  -> interpreter::get_decl
  -> lean_ir_find_env_decl
  -> VIR find_package_decl                             linear g_entries scan
  -> interpreter-local cache insertion
```

The process-wide native cache stores the address/boxed decision, not the
environment-dependent IR declaration. It therefore still calls `get_decl` on a
fresh interpreter. The local symbol cache disappears when the asynchronous
entry returns.

## Stage 1: Package Declaration Index

The first optimization should remain VIR-local and use Lean's own
`name_hash_map` representation:

```cpp
struct package_decl_indices {
    lean::name_hash_map<uint32_t> declarations;
    lean::name_hash_map<uint32_t> boxed_declarations;
};
```

Values are indices into the existing package-owned vectors. Map keys retain
their `Lean.Name`; values do not add declaration ownership and remain valid
until the immutable package vectors are cleared.

Build both maps in `finish_package_set` after every package-set member has been
decoded and appended, but before initializers run. Package-set append and
duplicate validation can remain linear because they are outside the steady
execution window and already reject duplicates. Lookup becomes one map find
followed by a bounds-checked vector access. A miss remains `nullptr`.

Clearing or abandoning a package load must clear the maps before releasing
vector-owned names and declarations. A failed index build or initializer must
use the same complete cleanup path. Initializer and host-import tables should
remain unchanged in the first patch unless a post-index profile identifies
them as material.

This stage preserves the exact mapping:

```text
loaded package set x structurally equal Lean.Name -> existing declaration slot
```

It does not cache evaluated constants, interpreter state, host results, or
mutable stacks. It also does not require a package-format or JavaScript API
change.

## Upstream API Direction

VIR currently integrates by defining the exported
`lean_ir_find_env_decl`/`lean_ir_find_env_decl_boxed` symbols and passing a dummy
environment to `ir::run_boxed`. The local index can ship behind that boundary,
but the desired endpoint is an explicit upstream provider API rather than link
symbol replacement.

Propose two separable upstream changes.

### 1. Explicit declaration provider

Add a `run_boxed` overload whose lookup source is an explicit callback table.
The exact public types belong upstream, but the ownership and invalidation
contract should be equivalent to:

```cpp
struct decl_provider {
    void * state;
    uint64_t revision;
    object * (*find_decl)(void * state, object * name);       // borrowed or null
    object * (*find_boxed_decl)(void * state, object * name); // borrowed or null
};
```

The interpreter retains any returned declaration it caches. `state` must stay
alive for the call. `revision` changes before a provider can return a different
answer for the same name. The existing environment-backed lookup remains the
default overload, so upstream behavior and callers do not change.

VIR's `package_decl_provider` should be shaped around this table now: its
callbacks consult the Stage 1 maps, and its revision advances before old
package objects are released. Once the upstream overload exists,
`interpreter_bridge.cpp` passes this provider directly and removes the exported
lookup-symbol definitions.

This first upstream patch is architectural and should not claim a speedup by
itself. It makes VIR's indexed lookup a supported interpreter input.

### 2. Optional caller-owned symbol cache

Only pursue this if the indexed-provider profile still shows fresh
interpreter-local/native map reconstruction as a material cost. Add an opaque,
noncopyable symbol-resolution cache that an embedding may pass to `run_boxed`.
The interpreter continues to own the resolution algorithm and the same
`name_hash_map<symbol_cache_entry>` entries; VIR does not duplicate native
symbol selection.

Before reuse, the cache must match all resolution-sensitive identities:

- exact environment object;
- exact relevant options (at minimum `prefer_native`);
- provider `state` and `revision`.

A mismatch clears the cache. A null cache pointer preserves today's
per-invocation behavior. Insert only after declaration and native resolution
complete successfully.

The reusable object contains only symbol metadata: retained IR declaration,
native address, and boxed decision. Keep `m_constant_cache`, argument/join/call
stacks, exceptions, and tracing state per interpreter invocation. Do not
persist the entire interpreter.

The cache should be single-owner and non-concurrent by contract; nested calls
with the same environment/options/provider continue to reuse the active
thread-local interpreter. This avoids adding a lock to every lookup. VIR's
browser runtime is single-threaded today and clears the cache before package
revision or instance teardown.

## Validation Sequence

For the Stage 1 index:

1. Run package-provider correctness coverage for hits, misses, separately
   allocated equal names, boxed/unboxed separation, package sets, failed loads,
   initializer failure, clearing, and repeated runtime replacement.
2. Capture a fresh diagnostics-off focused report with an even AB/BA comparison.
3. Capture a fresh CPU profile and verify that `find_package_decl` and its
   linear-scan `lean_name_eq` samples collapse as predicted.
4. Rerun the Illuminate isolated callback and 16-player dashboard workloads,
   including DOM/state differential checks.
5. If provider scans collapse but wall time does not, reject further provider
   tuning and investigate the remaining interpreter-local/native maps. That is
   the gate for the optional upstream reusable cache.

Do not use package-load time as the headline metric; report it separately if
index construction becomes visible. Do not add permanent runtime counters to
select the next target. Counters may be used later as diagnostics after sampled
attribution has established the path.

The baseline self-comparison is also part of the interpretation contract. On
the development host, identical artifacts produced execution pass deltas from
about -31% to +5% and package-load pass deltas from about -28% to +22% in a
four-pass AB/BA control. The declaration index is expected to clear that broad
noise floor. Smaller follow-up representation changes require stronger
same-process evidence or a profile movement; a small aggregate timing delta is
not sufficient.

## Deferred Alternatives

- Decoder-wide name interning may make equal names pointer-identical, but it
  adds ownership/package-format pressure and should follow the index result.
- Persisting the whole interpreter retains mutable stacks and evaluated
  constants and is not needed for symbol resolution.
- Application-level batching can help Illuminate, but callers should not need
  to batch unrelated callbacks to avoid a linear declaration scan.
- Moving SVG work to JavaScript is not supported by the profile; explicit DOM
  updates were a small fraction of the reported samples.
