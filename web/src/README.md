# `web/src` Map

This directory contains the browser demo, JavaScript runtime, SDK entry points,
and host-binding implementations. Keep public entry points stable and move
implementation detail into narrower helper modules when files start mixing
unrelated responsibilities.

## Public Runtime Entry Points

- `vir-runtime.js`: generic runtime API, WASM/package loading, exported Lean
  calls, host import dispatch, and callback lifecycle.
- `vir-runtime-node.js`: Node/test wrapper that installs virtual browser and
  React host bindings.
- `vir-host-bindings.js`: public common/browser host-binding factories and
  stable re-exports.
- `vir-react-host-bindings.js`: browser React root, component, and hook
  bindings. This entry imports `react` and `react-dom/client`; keep React
  dependencies out of the generic runtime and host-binding entry points.
- `browser-react-runtime.js`: browser convenience factory that composes generic
  browser bindings with React bindings.
- `vir-infoview-widget.js`: live infoview widget shell that loads WASM,
  requests fresh `.irpkg` packages from Lean, and mounts Lean-authored React
  widgets.

## Runtime Internals

- `runtime/vir-codec.js`: binary reader/writer and interface type descriptor
  codec.
- `runtime/vir-value-normalizers.js`: JavaScript input normalization for the
  object ABI lowering path.
- `runtime/interface-manifest.js`: interface manifest validation, diagnostics,
  and type formatting helpers.
- `runtime/wire-tags.js`: shared wire tag constants.
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
- `generated/vir-infoview-widget.js`: checked-in bundle generated from
  `vir-infoview-widget.js` for `Vir.Infoview`'s `include_str` path.

## Demo And Page Modules

- `main.js`: landing-page fixture runner and Tamagotchi demo wiring.
- `dev.js`: local `.irpkg` package runner.
- `format-demo.js`: pretty-printer workbench.
- `react-review.js`: React review page.
- `runtime-example.js`: minimal runtime example page.
- `pages/fixture-catalog.js`: fixture metadata, package mapping, and input
  defaults.
- `pages/fixture-sources.js`: raw fixture/source snippets shown by the landing
  page.
- `pages/input-parsers.js`: shared input parsing for page controls.
- `pages/interface-inputs.js`: dynamic form controls for manifest-described
  inputs.
- `pages/page-utils.js`: page-level helper functions shared by Vite entries.

## Maintenance Notes

- Keep SDK-visible imports under the public entry points above unless a new
  package export is intentional. The SDK artifact mirrors these subdirectories
  under `js/` so internal imports resolve without wrapper files.
- Keep React imports isolated to `vir-react-host-bindings.js` and modules that
  intentionally compose it.
- Regenerate `generated/vir-infoview-widget.js` with
  `npm run build:infoview` after editing the infoview widget shell or any
  runtime modules it bundles.
- Prefer adding focused helpers beside the relevant runtime area instead of
  growing page entry files or `vir-runtime.js`.
- Generated `web/dist/` output and generated `web/public/*.wasm`, `.irpkg`,
  `.input.json`, and `.report.md` artifacts stay out of Git.
