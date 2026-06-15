# ProofWidgets Compatibility Roadmap

This note records the path from Vir's standalone React renderer toward
richer ProofWidgets compatibility. The implemented renderer and its current
API are tracked separately in `docs/REACT_HTML.md`; this file focuses on the
future infoview/RPC and ProofWidgets-style layers.

## External Shape

Lean user widgets are rendered in the Lean infoview. A widget module is a
JavaScript ES module that normally exports a React component, and the widget
instance passes JSON-like props to that component. The Lean manual also calls
out that widget APIs are unstable and that widgets can communicate with the
Lean server through RPC methods:

- <https://lean-lang.org/examples/1900-1-1-widgets/>
- <https://leanprover-community.github.io/mathlib4_docs/ProofWidgets/Component/Basic.html>

ProofWidgets builds on top of that system. Its Lean side provides component
abstractions and HTML-like syntax, while the JavaScript side is TypeScript
React code bundled into widget modules. Its published README describes
symbolic visualizations, data visualization, tactic interfaces, expression
display customization, proof-script editing, and a build path that compiles
TypeScript/React assets and splices the bundled JavaScript into Lean modules:

- <https://github.com/leanprover-community/ProofWidgets4>

For Vir, full infoview compatibility remains a follow-up target. We do not
yet have the Lean server snapshot/RPC layer, document positions, or proof-script
edit channel that real ProofWidgets can rely on. The first useful target is the
standalone React renderer documented in `docs/REACT_HTML.md`.

## Current Vir Fit

The merged closure bridge gives us the hard part for interactive React views:

- Lean closures can cross to JavaScript as `VirCallback` values.
- JavaScript can retain those callbacks and release them on removal,
  cancellation, package reload, or `VirRuntime.dispose()`.
- Function types are now manifest types, so callback fields can be nested
  inside host-import data structures as long as the surrounding Lean data is
  otherwise representable.
- Opaque host resources already cover DOM elements and can be extended to React
  roots or rendered node handles.

The main remaining mismatch for richer ProofWidgets-style data is structural:
direct recursive structures and simple non-indexed recursive inductives with
nullary or runtime-payload constructors can now cross the boundary, but mutual
recursion, non-uniform recursion, and inherited recursive structures remain
outside the general manifest surface. The current React `Html` tree fits the
supported recursive-inductive surface; broader ProofWidgets compatibility must
still keep callback ownership and renderer-specific cleanup inside a narrow
audited ABI.

This roadmap assumes the current `main` branch repository setup: Lean
`v4.30.0`, the local WASI SDK from `npm run install:wasi`, and the small
repository harness documented in `AGENTS.md`, `CONTRIBUTING.md`, and
`docs/HARNESS.md`. For this line of work, use `npm run setup` for a fresh
checkout and `npm run doctor` before deeper validation when the local toolchain
state is uncertain.

## Current Standalone Renderer

The current standalone renderer is implemented and documented in
`docs/REACT_HTML.md`. In short, Lean can render a recursive DOM-like `Html`
tree into a browser React root, retain Lean callbacks in event handlers, and
release them on rerender, unmount, package reload, or runtime disposal.

That renderer deliberately avoids full infoview compatibility. It validates the
host-resource and callback-lifetime model first. Resource values now cross the
C++/Wasm ABI through an `externref` side channel, while ProofWidgets RPC
compatibility remains a later layer.

## ProofWidgets Compatibility Layers

A realistic path has three layers:

1. **Standalone React renderer.** Render Lean-authored trees and retained Lean
   callbacks into a browser DOM container. This enables small interactive
   widgets from Lean without a Lean server.
2. **ProofWidgets-style HTML subset.** Provide a Lean DSL close to
   `ProofWidgets.Data.Html` / JSX-like usage and compile it to this narrow
   `Html`.
   This should cover text, attributes, children, basic events, and reusable
   Lean components.
3. **Infoview/RPC compatibility.** Add document positions, snapshot-aware RPC,
   server-side references, and edit commands. This is the layer needed for
   tactic UIs and proof-script editing, and it should be designed after the
   standalone renderer is working.

## Open Questions

- How much of ProofWidgets' RPC layer can be approximated without a Lean
  server snapshot model.
- How close the blessed Lean HTML subset should be to `ProofWidgets.Data.Html`
  before implementing infoview transport.
- Whether future recursive-data improvements should support enough structure
  sharing or mutual recursion to represent more of ProofWidgets directly.
