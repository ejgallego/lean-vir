# Remove responsibilities before introducing boundaries

The design target is two concrete execution paths. Inventory clusters are
reasoning labels, not a proposed set of layers.
The [use-case contracts](../design/VIR_USE_CASES.md) specify required behavior,
map existing test evidence, and identify compatibility decisions for the proposed
one-runtime-per-generation API.

- **Document:** document build selects the Lean entry and emits package assets
  and a small bootstrap; the page loads its required package set once, invokes
  the entry, and uses ordinary browser values. Verso owns build integration.
  DOM interaction needs no React dependency; React is an author choice. Keep
  internal state in Lean and use actual JavaScript objects or opaque Lean
  handles across the boundary where appropriate.
- **Infoview:** the current Lean snapshot supplies package bytes; a fresh runtime
  generation invokes a component factory; its returned function renders in the
  existing Infoview React tree. Props, goals, position and context updates use
  normal React/Infoview behavior. Code replacement selects a new component and
  may reset component state. Reuse compiled Wasm and the interpreter within each
  generation.

UI unmount releases UI ownership. It does not hard-dispose the runtime: escaped
callbacks, handles and pending Promise continuations retain their original
generation. An old continuation executes its original Lean code, including its
stale-result branch. Explicit hard disposal prevents subsequent Lean entry.
Unpublished or obsolete load candidates are hard-disposed. React context is
inherited without a shell bridge or second React root.

| Candidate | Decision | Behavior or decision that bounds removal |
| --- | --- | --- |
| Infoview source-kind dispatch, source records, options forwarding and service constructor | **Remove now** | One direct asset/load/build/create path; retain response validation and candidate publication checks. |
| Service disposal flag/wrapper and manifest scan fallback | **Remove now** (this patch) | Concrete runtime supplies idempotent `dispose` and `findManifestEntry`; no named compatibility consumer was found. |
| `replaceIrPackageManifest`, `encodeInvalidMagicPackage` | **Remove now** from execution responsibilities (separate patch) | Migrate actual tooling/test imports; retain execution accessors and writers. This patch does not relocate them. |
| Descriptor equality/round-trip tooling | **Remove after changing a supported contract** | Execution does not call these helpers, but `tests/runtime/sdk-import-smoke.mjs` explicitly requires their codec exports. Separate tooling placement from the SDK export decision. |
| `findTaggedUnionConstructor` | **Remove after changing a supported contract** | Repository search finds only its definition; confirm support for direct source imports before removal. |
| Stable-facade reload and its adoption/rebinding machinery | **Remove after changing a supported contract** | Documented and tested invalidation behavior; decide whether any consumer requires stable runtime identity, then migrate callers/docs/tests explicitly. |
| `HostBindingsLease` and release callbacks | **Remove after changing a supported contract** | Independent runtimes can share bindings with automatic last-owner disposal. Decide separately whether integrations instead own supplied services. |
| Historical manifest versions and option variants | **Remove after changing a supported contract** | Name supported released artifacts and consumers before narrowing compatibility. |
| Widget error presentation and JSON-input classifications | **Remove now** from general runtime responsibilities (separate patch) | Preserve application diagnostics and actual consumers; moving code alone is not a simplification claim. |
| Repeated validation of owned package bytes | **Keep because it protects a specific behavior**, pending an ownership audit | Shape, physical layout and backend metadata checks are distinct. Remove duplicate parsing only after a private immutable validated result can cross the existing internal boundary. |
| Wasm cache, change polling, obsolete-candidate checks and failed-load cleanup | **Keep because it protects a specific behavior** | Shared compilation, failed cache eviction, snapshot coherence, bounded polling and prevention of stale publication. The package build response replaces the separate pre-build stat/equality gate. |
| Thin native providers, rooting/refcounts, closure/handle retention and cleanup-error collection | **Keep because it protects a specific behavior** | Receiver/property semantics, cross-heap lifetime, partial-construction cleanup and independent teardown after an error. |
| Structural conversion, including Expr/Level support | **Keep because it protects a specific behavior** | Existing explicit conversion clients; first avoid unnecessary round trips in document/widget paths and establish the specialized consumers. |

The proposed future invariant is **one runtime object, one package generation**.
It would remove `replaceIrPackageSetBytes`, `replacePackageState`,
`adoptRuntimeState`, the replacement-factory back-reference and replacement-only
resets. It does not require a generation manager. It is not implemented here.

The first patch flattens the Infoview loader. It preserves the package RPC
protocol, binding ownership, runtime reload API and UI lifetime. Internal shell
exports used by the smoke test change: `loadRuntimeOptions` is removed and
`loadWasmModule` takes a path and revision instead of a source record. The shell
is not an entry in the npm exports map; no repository application imports those
helpers. Its default widget export and props remain unchanged.

The acquisition follow-up uses the package build's own revision and bytes. Stat
is only for live refresh, whose state records the requested revision rather than
a numeric reload counter. An unchanged failed revision does not start repeated
builds; a subsequent edit can recover, including after an initial failure.
The now redundant internal `shouldReloadIRPackage` wrapper is removed. The server
RPC schemas, widget props and runtime lifetime contracts remain unchanged.

Next, establish one small Verso document example with two independent Lean DOM
interactions, generated bootstrap wiring, no required React, and a shared page
package load. Record asset requests and startup work using existing tooling.
Only then select the reload consumer decision; host-binding ownership is a
separate decision. Add no public API, manager, generic adapter, compatibility
fallback or runtime dependency to the loader cleanup. Measure deletions across
execution, tests and documentation separately; no latency or bundle-size benefit
is inferred from source reduction.

Acceptance reuses `tests/infoview/widget.mjs`,
`tests/browser/shell-lifetime.mjs` and `tests/infoview/rpc-shell-lifetime.mjs`:
cache reuse/retry, authoritative build revisions, out-of-order replies, failed
refreshes, removal during loading, inherited context, prop updates and old native
Promise continuations after replacement. The real-server suite edits the open
document through `textDocument/didChange`: comment edits preserve hook state;
implementation edits replace the visible component; delayed package replies
converge to the latest source; broken source preserves old UI and recovers when
fixed, including after an initial failure. This exercises Chromium and the Lean
server, not an actual editor window or arbitrary state migration. A Retry button
is explicitly excluded; ordinary edit races are protocol/lifecycle bugs to fix.
