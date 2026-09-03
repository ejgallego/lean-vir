# `web/src` Map

This directory contains the browser demo, JavaScript runtime, SDK entry points,
and host-binding implementations. Keep public entry points stable and move
implementation detail into narrower helper modules when files start mixing
unrelated responsibilities.

## Runtime Entry Points

- `vir-runtime.js`: public package/SDK runtime facade, WASM instantiation, package loading
  convenience helpers, and host import wiring.
- `vir-runtime-node.js`: public package/SDK Node/test wrapper that installs
  virtual browser bindings and explicit unsupported React shims.
- `vir-host-bindings.js`: public package/SDK common/browser host-binding factories and
  stable re-exports.
- `vir-react-host-bindings.js`: public package/SDK browser React root, component, and hook
  bindings. This entry imports `react` and `react-dom/client`; keep React
  dependencies out of the generic runtime and host-binding entry points.
- `vir-react-dom-client.js`: seven-line import seam that exposes the official
  `react-dom/client` entry to SDK consumers. The infoview bundler substitutes
  Lean's provided `react-dom` external at this seam; it contains no ReactDOM
  implementation.
- `vir-infoview-widget.js`: repository live infoview widget shell that loads WASM,
  requests fresh `.irpkg` packages from Lean, and mounts Lean-authored React
  widgets.

## Runtime Internals

- `runtime/call-timing.js`: opt-in synchronous runtime call phase
  attribution.
- `runtime/vir-codec.js`: binary reader/writer and interface type descriptor
  codec.
- `runtime/callbacks.js`: private Lean closure roots associated with ordinary
  JavaScript functions, plus runtime-disposal helpers.
- `runtime/cleanup.js`: shared cleanup error collection and deterministic
  single/aggregate reporting.
- `runtime/core.js`: package loading, manifest export tables, call resolution,
  memory helpers, and runtime/callback lifecycle.
- `runtime/object-values.js`: object ABI lowering and lifting between
  JavaScript values and owned Lean objects.
- `runtime/host-state.js`: host import dispatch state, exact-value externref
  roots, host-binding lookup, and host-binding disposal.
- `runtime/object-abi.js`: object ABI support checks, layout planning, scalar
  field packing, and unpacking helpers used by the object-value runtime.
- `runtime/object-abi-exports.js`: shared object ABI export-name manifest used
  by runtime availability checks and Wasm linker tooling.
- `runtime/vir-value-normalizers.js`: JavaScript input normalization for the
  object ABI lowering path.
- `runtime/interface-manifest.js`: interface manifest validation, diagnostics,
  and type formatting helpers.
- `runtime/interface-tags.js`: shared interface descriptor tag constants.
- `host-boundary.js`: exact-value externref roots and host-call rollback
  transactions.
- `host/vir-dom-host-bindings.js`: passive, direct-value DOM adapters shared by
  the browser and virtual test hosts.
- `host/vir-host-resources.js`: explicit teardown for active listeners,
  timers, frames, and React roots.
- `host/vir-virtual-host-bindings.js`: virtual document, event, element, and
  unsupported React host bindings for Node tests/tools.
- `react/vir-react-node.js`: browser React node/props/children operations over
  exact JavaScript component values.
- `react/vir-react-hooks.js`: direct official browser React hook operations and
  explicit Lean-to-JavaScript function conversions.

## Demo And Page Modules

- `apps/`: Vite page entry points, page-only styles, and the browser React
  runtime composition helper.
- `apps/demo.js`: runtime-demo fixture runner and Tamagotchi wiring.
- `apps/dev.js`: local `.irpkg` package runner.
- `apps/format-demo.js`: pretty-printer workbench.
- `apps/react-tamagotchi.js`: standalone React Tamagotchi page.
- `apps/runtime-example.js`: minimal runtime example page.
- `pages/fixture-catalog.js`: fixture metadata, strict package resolution, and
  input defaults.
- `pages/fixture-sources.js`: raw fixture/source snippets shown by the landing
  page.
- `pages/input-parsers.js`: shared input parsing for page controls.
- `pages/interface-inputs.js`: dynamic form controls for manifest-described
  inputs.
- `pages/page-utils.js`: page-level helper functions shared by Vite entries.

## Maintenance Notes

- Treat `apps/` as the imperative browser shell. Keep reusable parsing, state
  transformations, and page configuration under `pages/` import-safe and
  preferably pure so Node tests can exercise them without a DOM.
- Keep application-facing imports under the package/SDK entry points above
  unless a new package export is intentional. The SDK artifact mirrors runtime,
  host, and React helper subdirectories under `js/` so internal relative
  imports resolve without wrapper files; those nested modules are not a stable
  application API.
- Keep React imports isolated to `vir-react-host-bindings.js` and modules that
  intentionally compose it.
- The infoview bundle is generated at
  `build/generated/infoview/vir-infoview-widget.js` by Lake or
  `npm run build:infoview`; it stays out of Git.
- Prefer adding focused helpers beside the relevant runtime area instead of
  growing page entry files or `vir-runtime.js`.
- Generated `web/dist/` output and generated `web/public/*.wasm`, `.irpkg`,
  `.input.json`, and `.report.md` artifacts stay out of Git.
