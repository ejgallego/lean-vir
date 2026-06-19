# Documentation

This directory contains the maintainer and integration notes for Lean VIR. The
top-level `README.md` remains the user-facing quickstart.

## User And Integration Guides

- [LOCAL_IRPKG.md](LOCAL_IRPKG.md): local `.irpkg` package generation and
  `/dev.html` loading.
- [CALL_LEAN_FROM_JS.md](CALL_LEAN_FROM_JS.md): calling exported Lean
  declarations from JavaScript.
- [JS_API.md](JS_API.md): runtime wrapper API details.
- [LEAN_VIR_LIBRARY.md](LEAN_VIR_LIBRARY.md): Lean-side host import helpers and
  demo APIs.
- [HOST_BINDINGS.md](HOST_BINDINGS.md): JavaScript host bindings, virtual
  hosts, and resources.

## Maintainer Guides

- [HARNESS.md](HARNESS.md): setup, generated artifacts, validation commands,
  and CI shape.
- [ADDING_DEMOS.md](ADDING_DEMOS.md): adding browser demos and package roots.
- [INTERFACE_PIPELINE.md](INTERFACE_PIPELINE.md): package configs, manifests,
  supported types, and interface internals.
- [GENERATE_PACKAGE.md](GENERATE_PACKAGE.md): Lean package generator module
  map, data flow, and diagnostics.
- [UPSTREAM_BOUNDARY.md](UPSTREAM_BOUNDARY.md): upstream interpreter boundary
  and native externs.
- [IMPLEMENTATION_NOTES.md](IMPLEMENTATION_NOTES.md): current architecture and
  implementation status.
- [FIXTURE_COVERAGE.md](FIXTURE_COVERAGE.md): fixture coverage and known
  unsupported surface.
- [PERFORMANCE.md](PERFORMANCE.md): benchmark commands, artifact-cache
  behavior, and before/after comparisons.
- [OBJECT_ABI.md](OBJECT_ABI.md): Lean object ABI construction,
  inspection, ownership, and codec-retirement roadmap.

## Roadmaps

- [EVENT_CALLBACK_ROADMAP.md](EVENT_CALLBACK_ROADMAP.md): callback/resource
  ownership direction.
- [REACT_HTML.md](REACT_HTML.md): current Lean-authored React HTML surface.
- [REACT_PROOFWIDGETS_ROADMAP.md](REACT_PROOFWIDGETS_ROADMAP.md): future
  infoview and ProofWidgets alignment.
- [REACT_WASM_BINDINGS.md](REACT_WASM_BINDINGS.md): `externref`, JSPI, and
  related Wasm interop plan.
- [OBJECT_ABI.md](OBJECT_ABI.md): staged plan for JS-driven Lean object
  lowering/lifting.
