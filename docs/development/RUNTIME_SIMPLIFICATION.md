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
- **Infoview:** elaboration retains package inputs under a fingerprint; the RPC
  selects those inputs from the current environment and emits package bytes; a fresh runtime
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
| Stable-facade reload and its adoption/rebinding machinery | **Remove now in this candidate; downstream adoption required** | One runtime owns one package generation. A deferred runtime may install its first package; later code uses a fresh runtime from the same factory. The dirty Slides live demo still needs migration before publication. |
| `HostBindingsLease` and release callbacks | **Remove after changing a supported contract** | Independent runtimes can share bindings with automatic last-owner disposal. Decide separately whether integrations instead own supplied services. |
| Historical manifest versions and option variants | **Remove after changing a supported contract** | Name supported released artifacts and consumers before narrowing compatibility. |
| Widget error presentation and JSON-input classifications | **Remove now** from general runtime responsibilities (separate patch) | Preserve application diagnostics and actual consumers; moving code alone is not a simplification claim. |
| Repeated validation of owned package bytes | **Keep because it protects a specific behavior**, pending an ownership audit | Shape, physical layout and backend metadata checks are distinct. Remove duplicate parsing only after a private immutable validated result can cross the existing internal boundary. |
| Wasm compilation reuse, obsolete-candidate checks and failed-load cleanup | **Keep because it protects a specific behavior** | Shared compilation, failed cache eviction and prevention of stale publication remain. Polling and package stat are removed; required elaboration fingerprints select retained inputs. |
| Thin native providers, rooting/refcounts, closure/handle retention and cleanup-error collection | **Keep because it protects a specific behavior** | Receiver/property semantics, cross-heap lifetime, partial-construction cleanup and independent teardown after an error. |
| Structural conversion, including Expr/Level support | **Keep because it protects a specific behavior** | Existing explicit conversion clients; first avoid unnecessary round trips in document/widget paths and establish the specialized consumers. |

The candidate invariant is **one runtime object, one package generation**. It removes
`replaceIrPackageSetBytes`, `replacePackageState`, `adoptRuntimeState`, the
replacement-factory back-reference and replacement-only resets. It does not require
a generation manager. Compiled `WebAssembly.Module` reuse and shared host-binding
leases remain available through the factory.

The first patch flattens the Infoview loader. It preserves the package RPC
protocol, binding ownership and UI lifetime. Internal shell
exports used by the smoke test change: `loadRuntimeOptions` is removed and
`loadWasmModule` takes a path and revision instead of a source record. The shell
is not an entry in the npm exports map; no repository application imports those
helpers. That earlier loader flattening preserved the default export and props; the
subsequent fingerprint protocol below deliberately narrows the props and RPC API.

The acquisition follow-up requires an elaborated package description containing
one factory entry and its fingerprint. The RPC returns that identity and encoded
bytes. The roots array, duplicate component entry, manual update token and stat
endpoint are removed. Custom integrations use the generated `irPackage` and
`widgetProps`. No package is rebuilt from arbitrary display-position roots.

Healthy proof/context updates do not acquire code. A failed acquisition may use
a new upstream RPC context once; local loading-state renders cannot manufacture
reconnect attempts. Infoview UI lifetime contracts remain unchanged; runtime
package loading now uses one generation per runtime object.

Next, establish one small Verso document example with two independent Lean DOM
interactions, generated bootstrap wiring, no required React, and a shared page
package load. Record asset requests and startup work using existing tooling.
The runtime consumer decision is now explicit: downstream callers must select a
fresh generation and dispose the previous one when invalidation is intended;
host-binding ownership is a separate decision. Add no public API, manager, generic
adapter, compatibility fallback or runtime dependency to the loader cleanup. Measure deletions across
execution, tests and documentation separately; no latency or bundle-size benefit
is inferred from source reduction.

Acceptance reuses `tests/infoview/widget.mjs`,
`tests/browser/shell-lifetime.mjs` and `tests/infoview/rpc-shell-lifetime.mjs`:
cache reuse/retry, required package identities, out-of-order replies, failed
refreshes, removal during loading, inherited context, prop updates and old native
Promise continuations after replacement. The real-server suite edits the open
document through `textDocument/didChange`: comment edits preserve hook state;
implementation edits replace the visible component; delayed package replies
converge to the latest source. Acquisition failure preserves working UI. Invalid
widget elaboration can remove registration and UI; repairing the definition
restores it. A failed initial acquisition can recover with a new RPC context. This exercises Chromium and the Lean
server, not an actual editor window or arbitrary state migration. A Retry button
is explicitly excluded; ordinary edit races are protocol/lifecycle bugs to fix.
