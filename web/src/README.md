# `web/src` Map

This directory contains the browser demo, JavaScript runtime, SDK entry points,
and host-binding implementations. Keep public entry points stable and move
implementation detail into narrower helper modules when files start mixing
unrelated responsibilities.

## Runtime Entry Points

- `vir-web-assets.js`: staged-SDK helper that validates a composed-assets
  manifest and creates one explicitly named program runtime.
- `vir-runtime.js`: public package/SDK runtime facade, WASM instantiation, package loading
  convenience helpers, and host import wiring.
- `vir-runtime-node.js`: public package/SDK Node/test wrapper that installs virtual browser and
  React host bindings.
- `vir-browser-host-bindings.js`: browser runtime's dependency-closure entry for
  common/browser host-binding factories.
- `vir-host-bindings.js`: compatibility facade that also exports the Node and
  virtual-document bindings.
- `vir-react-host-bindings.js`: public package/SDK browser React root, component, and hook
  bindings. This entry imports `react` and `react-dom/client`; keep React
  dependencies out of the generic runtime and host-binding entry points.
- `vir-infoview-widget.js`: repository live infoview widget shell that loads WASM,
  requests fresh `.irpkg` packages from Lean, and mounts Lean-authored React
  widgets.

## Runtime Internals

- `runtime/call-timing.js`: opt-in synchronous runtime call phase
  attribution.
- `runtime/vir-codec.js`: binary reader/writer and interface type descriptor
  codec.
- `runtime/callbacks.js`: JavaScript callable Lean closure wrappers,
  callback state tracking, release, and disposal helpers.
- `runtime/cleanup.js`: shared cleanup error collection and deterministic
  single/aggregate reporting.
- `runtime/core.js`: package loading, manifest export tables, call resolution,
  memory helpers, and runtime/callback lifecycle.
- `runtime/object-values.js`: object ABI lowering and lifting between
  JavaScript values and owned Lean objects.
- `runtime/host-state.js`: host import dispatch state, externref resource
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
- `host-resource.js`: opaque host-resource objects and externref root tables.
- `host/vir-host-resources.js`: host-resource store, liveness, teardown,
  timers, callbacks, and shared host-binding helpers.
- `host/vir-virtual-host-bindings.js`: virtual document, event, element, and
  React host bindings for Node tests/tools.
- `react/vir-react-node.js`: `Lean.Vir.React.Node` resource construction,
  native/virtual React node creation, validation, virtual text rendering, and
  callback release.
- `react/vir-react-hooks.js`: shared React component hook runtime and typed
  state setter host bindings for browser and virtual React roots.

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
