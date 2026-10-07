# `web/src` Map

This directory contains the distributable JavaScript runtime, SDK entry points,
and host-binding implementations. Browser applications live in `web/app/`.
Keep public entry points stable and move
implementation detail into narrower helper modules when files start mixing
unrelated responsibilities.

## Runtime Entry Points

- `vir-runtime.js`: public package/SDK browser entry point selecting the default
  host providers.
- `vir-runtime-node.js`: public package/SDK Node wrapper that installs only
  environment-neutral JavaScript value and console bindings. Browser and React
  imports require an explicitly supplied external host.
- `vir-host-bindings.js`: public package/SDK common/browser host-binding factories and
  stable re-exports.
- `vir-react-host-bindings.js`: public package/SDK browser React root, component, and hook
  bindings. This entry imports `react` and `react-dom/client`; keep React
  dependencies out of the generic runtime and host-binding entry points.
- `vir-react-dom-client.js`: seven-line import seam that exposes the official
  `react-dom/client` entry to SDK consumers. The infoview bundler substitutes
  Lean's provided `react-dom` external at this seam; it contains no ReactDOM
  implementation.

## Runtime Internals

The [managed runtime composition](../../docs/development/MANAGED_RUNTIME_COMPOSITION.md)
is the canonical map of runtime modules, conversion layers and retained-value
ownership. Those modules are revision-locked internals of the public entries.

- `host-boundary.js`: host-call rollback transactions for unpublished resources.
- `host/vir-common-host-bindings.js`: environment-neutral JavaScript value and
  console providers, shared by the browser and Node entry points.
- `host/vir-dom-host-bindings.js`: passive direct-value DOM provider helpers.
- `host/vir-active-host-bindings.js`: explicit teardown for timers and frames.
  It does not represent passive JavaScript values.
- `host/vir-infoview-host-bindings.js`: local infoview/ProofWidgets command
  provider and pure validation for its repository-owned protocol.
- `react/vir-react-root.js`: exact root operations plus the narrow lifecycle
  required for deterministic teardown.

## Boundary JavaScript Provenance

Every shipped boundary layer has one of these explicit sources:

| Files                                                                                           | Provenance and justification                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `host-boundary.js`, `runtime/host-state.js`, `runtime/object-core.js`, `runtime/object-values.js` | VIR-owned Lean/Wasm ABI machinery for host-call rollback, terminal root clearing, object ABI conversion, and foreign Lean closure ownership. |
| `wasm/upstream_shim/abi/resource_roots.cpp` | VIR-owned slot allocator and release operations over an engine-managed Wasm `externref` table. JavaScript references remain exact values; allocator metadata lives in linear memory. |
| `vir-host-bindings.js`, `host/vir-dom-host-bindings.js`, `host/vir-js-*.js`                     | Thin handwritten providers for generated targets. Each target's TypeScript, VIR-owned, or local-contract provenance is recorded in `Vir/*.bindings.json` and checked by `npm run check:bindings`.    |
| `host/vir-active-host-bindings.js`                                                              | VIR-owned lifecycle plus schedule/frame teardown and failed-publication rollback. React roots register with that lifecycle from the React module.                                                    |
| `host/vir-infoview-host-bindings.js`                                                            | Repository-local infoview and ProofWidgets command contract. It validates the local protocol and delegates effects to the supplied browser integration.                                             |
| `vir-react-host-bindings.js`, `react/*.js`, `vir-react-dom-client.js`                           | Official React and ReactDOM calls, root teardown sidecars, and explicitly declared VIR-owned conversions for Lean closures. Chromium with official React is the oracle.                              |

The generated binding report is the review surface connecting provider keys to
their declarations and provenance. A provider without a generated key, or a
generated key without a provider, fails the binding checks.

## Maintenance Notes

- Keep application-facing imports under the package/SDK entry points above
  unless a new package export is intentional. The SDK artifact mirrors runtime,
  host, and React helper subdirectories under `js/` so internal relative
  imports resolve without wrapper files; those nested modules are not a stable
  application API.
- Keep React imports isolated to `vir-react-host-bindings.js` and modules that
  intentionally compose it.
- Prefer adding focused helpers beside the relevant runtime area instead of
  growing page entry files or `vir-runtime.js`.
- Generated `web/dist/` output and generated `web/public/*.wasm`, `.irpkg`,
  `.input.json`, and `.report.md` artifacts stay out of Git.
