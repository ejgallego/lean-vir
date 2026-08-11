# ULC-0002 Cross-entry Symbol Resolution Cache

Status: superseded
Kind: upstream-api experiment
Priority: medium
Origin: Illuminate post-index profile
Last reviewed: 2026-08-12
Owner: none
Issue: none linked
Lean PR: none linked
Upstream timing: only after a successful VIR prototype
Superseded by: package-scoped interpreter session

## Supersession

The package-scoped interpreter session described in
[Upstream Boundary](../../../UPSTREAM_BOUNDARY.md#package-instance-lifecycle)
supersedes this resolution-only proposal. A lean-zip workload showed that
evaluated nullary constants, deliberately excluded below, also need to survive
successive public calls. VIR now retains both upstream caches for one immutable
package generation and resets the session before releasing package-owned
declarations or after a failed evaluation.

The remaining sections preserve the earlier proposal and its evidence as a
historical record; they are not current implementation guidance.

## Summary

Measure whether a caller-owned cache of immutable symbol-resolution metadata
can remove repeated resolution work across fresh asynchronous interpreter
entries. The experiment must not persist an entire interpreter, and it must not
be presented upstream until focused and Illuminate measurements show a material
benefit with correct ownership and invalidation.

## Evidence

The accepted name-hash and package-index patch reduced focused fresh-entry time
by 6.85x and halved the controlled Illuminate callback mean. In the later
post-index profile, package, native, and interpreter-local lookup together with
`get_decl` and `lookup_symbol` accounted for 14.9% of symbolized attributable
samples. Including interpreter call dispatch raised the cluster to 18.9%.

Every asynchronous callback constructs a fresh upstream interpreter. Its local
symbol cache starts empty, so complete entries are reconstructed even when the
loaded VIR package set has not changed. Sampling identifies a plausible target
but does not establish repeated-name counts or profitability.

See [Environment Lookup Performance](../../../ENVIRONMENT_LOOKUP_PERFORMANCE.md)
for the accepted result, profile limitations, and benchmark evidence.

## Relationship To ULC-0001

[ULC-0001](../ULC-0001-ir-declaration-lookup-boundary/README.md) decides whether
VIR should use a real `Lean.Environment` or request an explicit declaration
provider. This card asks a different question: whether immutable resolution
metadata should survive one interpreter invocation.

Keep the experiments and upstream decisions separate. A successful cache may
need provider identity and revision in a future API, but it is not evidence by
itself that the explicit-provider alternative in ULC-0001 is preferable.

## Prototype Contract

The cached value is a fully resolved successful entry containing a retained
declaration plus native address/boxed metadata. Its identity includes at least:

```text
provider identity × provider revision × relevant options × Lean.Name
```

For VIR, a loaded package set is immutable for one generation. Create one
cache per generation, expose it to every fresh interpreter path including
retained-closure entry, and destroy it before releasing package-owned names and
declarations. Increment the provider revision before the same name can resolve
to different contents.

The cache must retain stored Lean objects, remain isolated per Wasm instance,
insert only complete successes, preserve nested and reentrant calls, and leave
today's behavior unchanged when absent. Do not cache negative results unless
the provider contract makes them revision-stable.

Do not retain stacks, tracing or exception state, evaluated constants,
callbacks, host resources, or mutable interpreter options. Persisting the
whole interpreter is outside this card.

The prototype must keep the vendored
`third_party/lean4-src/src/library/ir_interpreter.cpp` unmodified. Run the
interpreter change in a dedicated Lean worktree or another explicit temporary
upstream patch boundary so the experiment cannot become an invisible vendor
fork.

## Instrumentation

Collect at least:

- top-level interpreter constructions and nested interpreter reuses;
- local and external resolution-cache hits and misses;
- global native-cache and package declaration-index hits and misses;
- complete resolved entries inserted, entries alive, and unique names;
- provider revisions, invalidations, and released name/declaration references.

Report total resolutions and unique resolved names per fresh entry. Those
counters bound the maximum possible win before cache behavior is interpreted
from wall-clock timing.

## Acceptance Gate

Use the existing environment-lookup benchmark with byte-identical package
content, an even six-pass AB/BA schedule, strengthened iteration/sample counts,
and an identical-code control. Record execution, package loading, live cache
size, construction cost, and ownership counters.

Then run interleaved fresh-context Illuminate measurements for an isolated
sustained animation, a structurally different animation, and the full player
set. Require unchanged playback state and DOM, no browser errors, and no
lifecycle, memory, package-load, or reference-count regression.

A consistent reduction in unprofiled focused fresh-entry time and isolated
Illuminate callback time is required. Profile movement alone is insufficient.
If that gate fails, close the API direction and investigate interpreter
dispatch or application batching from new measurements.

## Correctness Cases

Cover repeated resolution within one interpreter and across fresh entries;
load/clear/reload with overlapping names; failed package loads and initializer
failure; structurally equal separately allocated names; interpreted, native,
boxed, unboxed, missing, and host-import targets; nested calls and retained
callbacks; pending-callback disposal; two isolated Wasm instances; and repeated
load/clear cycles with balanced references.

## Open Decisions

- Which interpreter options affect resolution identity?
- Can upstream expose a stable cache value without exposing interpreter
  internals?
- Should native metadata remain in the existing global cache or be retained in
  one complete external entry?
- Can every retained-closure entry receive the same provider/cache context
  without VIR-specific callback machinery?

Resolve these only after the instrumented prototype establishes value.
