# VIR use cases and generation contracts

This is a proposed acceptance specification for simplifying the runtime after
the Infoview loader cleanup. It describes observable requirements, not a new
runtime API or a proof of the current implementation. Existing tests are evidence
for particular cases; gaps and deliberately changing contracts are named below.

## Model and invariants

Let `R` be a runtime object, `P` an owned snapshot of an ordered package set,
`M` a compiled Wasm module, and `current(V)` the runtime selected by a host view.
These are specification names, not new identifiers or manager objects in code.

1. Once `R` has loaded `P`, its package set never changes. Lean state, caches,
   browser objects and component state may change during normal execution.
   Two distinct runtimes may load identical bytes and share `M`.
2. Every Lean callback or opaque Lean handle belongs to its original runtime.
   Changing `current(V)` does not redirect it to another runtime or heap.
3. Browser resource values preserve ordinary JavaScript object identity across
   calls. Structural conversion is an explicit choice, not a requirement for
   passing a browser object to Lean.
4. UI ownership and runtime validity are separate. Unmount releases that UI's
   ownership; explicit disposal prevents further Lean entry and is idempotent,
   including after a cleanup error. Disposal still attempts independent cleanup.
5. A candidate may be published only if its request is still current and its
   package/component preparation succeeded. Failed or obsolete unpublished
   candidates are disposed. A failed preparation leaves the old runtime usable;
   this does not promise rollback of arbitrary effects on shared browser objects.
6. Factory/input handling owns the bytes it validates before asynchronous work.
   Later mutation of caller buffers cannot change the installed program.

For replacement, the desired transition is:

```text
current(V) = R1
prepare(P2, M) succeeds as fresh R2, request still current
current(V) := R2
release V's UI ownership of R1
```

If preparation fails or the request becomes obsolete, `R2` is never published.
An escaped callback from `R1` may still run in `R1` until explicit disposal;
the application decides whether its result is stale. This model specifies no
automatic transfer of React state or internal Lean values between generations.

## Required use cases and evidence

| Use case | Required observable behavior | Existing evidence / remaining acceptance |
| --- | --- | --- |
| Document with two Lean-authored DOM interactions | One page package set may serve both elements; events reuse its runtime, ordinary DOM objects and independent element state. No required React or handwritten per-element bootstrap. | Proposed Verso baseline: still to be built. Existing browser providers alone do not prove this integration. |
| Infoview props, goals, position or context update | Reuse the component/runtime when code and configuration are unchanged; inherit upstream React context and preserve ordinary hook state. | `tests/infoview/rpc-shell-lifetime-entry.js` checks context and notification-driven RPC updates. |
| Infoview implementation edit | With live refresh enabled, prepare fresh code, publish only the current successful component, and allow its React state to reset. Ordinary edit races must settle without a user Retry action when source is valid and transport remains available. Explicitly disabling live refresh remains a valid host choice. | `tests/infoview/rpc-shell-lifetime-entry.js` exercises unsaved implementation changes, a held older reply followed by another edit, and broken/fixed source through the actual Lean server and Chromium. An actual editor window is not exercised. |
| Slow, failed or obsolete load | Keep usable old UI on refresh failure; dispose unpublished candidates; removal prevents late publication. Later edits can recover a failed initial load. A failure of an older cache promise must not erase a newer entry. | Browser and real-server lifetime suites plus `tests/infoview/widget.mjs`. An unchanged failed observed revision does not trigger repeated builds. |
| Promise or callback survives UI replacement | Execute the original Lean continuation and its stale-result guard; never silently enter the successor program. | Browser and real-server shell lifetime suites. |
| Headless/browser caller runs multiple entries | Keep interpreter state and initialized constants within a generation; calls and callbacks do not instantiate fresh interpreters. | `tests/runtime/interpreter-constant-cache-smoke.mjs`, CLI and module-package tests. |
| Multi-module package set | Preserve member ordering, identity checks, initialization and startup semantics. A complete set is one generation, not one runtime per member. | `tests/runtime/module-package-set-smoke.mjs` and descriptor tests. |
| Several runtimes share compiled Wasm and host services | Isolate Lean heaps and per-runtime resources; reuse compilation. Preserve the current shared-binding disposal contract while removing reload. | `tests/infoview/widget.mjs`, `tests/runtime/generation-lifecycle-cases.js`. |
| Host intentionally resets a computation | Create a fresh runtime, select it, then explicitly dispose the previous one when invalidation is intended. An old cleanup failure must be surfaced; ordering and partial effects need a documented migration. | Reload lifecycle tests exercise reset, failure and cleanup contracts; migration to fresh objects remains to be demonstrated. |
| Separate fetching or raw instantiation from installation | Keep useful transport control and Wasm-only clients. Determine whether public deferred first installation is required; first installation is distinct from replacing loaded code. | Factory/descriptor and low-level runtime callers require a targeted audit before deleting loader entry points. |

## Contracts that cannot be silently removed

The current `loadIrPackageSetBytes` API explicitly supports synchronous replacement
after compilation, stable JavaScript runtime-object identity, invalidation of old
handles, and a specific terminal outcome when teardown fails. These are documented
in [JS_API.md](../guides/JS_API.md#replacing-a-package-set) and tested. Fresh-object
creation does not automatically preserve synchronous timing or stable identity.

The application search in `web/app`, `examples`, `benchmarks`, `tools` and
`scripts` found no runtime reload consumer. The developer runner already creates
a candidate and selects it; demos use factory-created runtimes. Tests and public
documentation do use reload. This establishes a migration opportunity, not the
absence of downstream users. Before removing it, identify any caller requiring
stable object identity, synchronous replacement or deferred first installation,
and either preserve the use case or explicitly agree its contract change.

Keep tests for meaningful behavior: failed preparation preserves the old runtime,
explicit disposal invalidates handles, initialization and per-generation constant
identity remain correct, shared services survive another runtime's disposal.
Replace assertions that merely require adoption into the same wrapper only when
that API change is selected. Keep host-service ownership as a separate decision.

## Small acquisition protocol

The requirement is that bytes used for a generation and cache reuse correspond to
the requested artifact. Relative path plus mtime/size does not establish that
across projects. Client comparison of stat/read tokens alone also cannot prove a
coherent read when the server samples metadata before reading bytes.

Choose the smallest protocol that establishes that requirement. Candidates are an
immutable build-selected asset loaded once by its integration, or reading the
bytes and reusing compilation by a digest of those bytes. Compare transport cost
and invalidation behavior before selecting one. Neither requires a project
identity registry, general resolver, or additional ownership layer.

For IR packages, the `buildIRPackage` response is the authoritative snapshot;
`statIRPackage` detects changes for live refresh. The build handler derives its
bytes and revision from one prepared snapshot input. The shell no longer requires
a separate pre-build stat to match, since an intervening edit can produce a valid
newer build. Request obsolescence and response/root validation remain in place.
Polling waits for a pending load to settle, then observes newer edits, even if
the first load failed. A failed observed revision is not rebuilt until it changes;
successful installation clears that failed-attempt state.

There will be no Retry button. Ordinary edit/load races are protocol or lifecycle
bugs to fix, rather than a recovery obligation for the document author or reader.
Report actual build/transport failures without obscuring them with indefinite
retries. Automatic eventual success under permanent external failure is not a
requirement.

Validation deduplication and tooling-only cleanup are accepted in principle.
Preserve caller-buffer snapshotting and distinct layout/backend checks; audit
shipped source exports before deleting helpers. They are separate implementation
patches, not prerequisites for adopting this use-case specification.
