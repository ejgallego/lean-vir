# Documentation

This directory contains the maintainer and integration notes for Lean VIR. The
top-level `README.md` remains the user-facing quickstart.

## Developer Reading Paths

Start with [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md) for implementation work.
It maps the Lean API, package generator, WASI shim, JavaScript runtime, host
resources, React bridge, and benchmark code, and includes call-flow and
ownership diagrams.

- Package/interface work: read [INTERFACE_PIPELINE.md](INTERFACE_PIPELINE.md),
  `Vir/GeneratePackage.lean`, `web/src/value-codec.js`, and
  `wasm/upstream_shim/interface_codec.cpp`.
- Browser or React host work: read
  [LEAN_VIR_LIBRARY.md](LEAN_VIR_LIBRARY.md),
  [HOST_BINDINGS.md](HOST_BINDINGS.md),
  [REACT_NODE.md](REACT_NODE.md), `web/src/host/vir-host-resources.js`, and
  `web/src/react/`.
- WASI/runtime boundary work: read
  [UPSTREAM_BOUNDARY.md](UPSTREAM_BOUNDARY.md),
  `wasm/upstream_shim/README.md`, and `wasm/upstream_shim/shim.cpp`.
- Benchmark work: read [PERFORMANCE.md](PERFORMANCE.md),
  `scripts/bench-vir.mjs`, and `scripts/bench-utils.mjs`.

## Documentation Ownership

- [LEAN_VIR_LIBRARY.md](LEAN_VIR_LIBRARY.md) owns the public Lean API inventory.
- [HOST_BINDINGS.md](HOST_BINDINGS.md) owns JavaScript host target behavior and
  resource cleanup rules.
- [REACT_NODE.md](REACT_NODE.md) owns React-specific authoring conventions and
  renderer details.
- [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md) owns implementation paths, call-flow
  diagrams, and object ownership.
- [UPSTREAM_BOUNDARY.md](UPSTREAM_BOUNDARY.md) owns the WASI/upstream interpreter
  boundary.

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

- [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md): implementation map, call-flow
  diagrams, object ownership, and focused validation pointers.
- [HARNESS.md](HARNESS.md): setup, generated artifacts, validation commands,
  and CI shape.
- [ADDING_DEMOS.md](ADDING_DEMOS.md): adding browser demos and package roots.
- [INTERFACE_PIPELINE.md](INTERFACE_PIPELINE.md): package configs, manifests,
  supported types, and interface internals.
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
- [REACT_NODE.md](REACT_NODE.md): current Lean-authored React Node surface.
- [REACT_PROOFWIDGETS_ROADMAP.md](REACT_PROOFWIDGETS_ROADMAP.md): future
  infoview and ProofWidgets alignment.
- [REACT_WASM_BINDINGS.md](REACT_WASM_BINDINGS.md): `externref`, JSPI, and
  related Wasm interop plan.
- [OBJECT_ABI.md](OBJECT_ABI.md): staged plan for JS-driven Lean object
  lowering/lifting.
