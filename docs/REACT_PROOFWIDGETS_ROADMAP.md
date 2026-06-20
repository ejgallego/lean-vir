# ProofWidgets Compatibility Roadmap

This note records the path from Vir's standalone React renderer toward
richer ProofWidgets compatibility. The implemented renderer and its current
API are tracked separately in `docs/REACT_NODE.md`; this file focuses on the
future infoview/RPC and ProofWidgets-style layers.

## External Shape

Lean user widgets are rendered in the Lean infoview. A widget module is a
JavaScript ES module that normally exports a React component, and the widget
instance passes JSON-like props to that component. The Lean manual also calls
out that widget APIs are unstable and that widgets can communicate with the
Lean server through RPC methods. It further documents the convention of
externalizing `react`, `react-dom`, and `@leanprover/infoview` when bundling
widget modules, because those dependencies are supplied by the infoview:

- <https://lean-lang.org/examples/1900-1-1-widgets/>
- <https://leanprover-community.github.io/mathlib4_docs/ProofWidgets/Component/Basic.html>

ProofWidgets builds on top of that system. Its Lean side provides component
abstractions and HTML-like syntax, while the JavaScript side is TypeScript
React code bundled into widget modules. Its published README describes
symbolic visualizations, data visualization, tactic interfaces, expression
display customization, proof-script editing, and a build path that compiles
TypeScript/React assets and splices the bundled JavaScript into Lean modules:

- <https://github.com/leanprover-community/ProofWidgets4>

Compatibility with that repository is the product target, not merely
inspiration. The first useful success criterion is that representative
ProofWidgets4 examples can be ported to this repository with a familiar
programming model and modest mechanical changes. In particular, the API should
stay close to the current ProofWidgets4 shape:

- `ProofWidgets.Component Props`: a Lean value naming a React component export,
  with props encoded through `RpcEncodable` and a normal infoview widget-module
  loading path.
- `ProofWidgets.Html`: a Lean tree with `element`, `text`, and `component`
  nodes, where component nodes carry a component hash/export, encoded props,
  and children.
- `ProofWidgets.Html.ofComponent`: the standard way for Lean-authored HTML to
  embed another component.
- `ProofWidgets.Jsx`: JSX-like syntax where lowercase tags are HTML elements
  and uppercase tags are `Component`s.
- `mk_rpc_widget%`: the existing Lean-computed component pattern, which turns
  an RPC method returning `Html` into a component.

Lean VIR should therefore first grow the familiar React/ProofWidgets API
surface, even if it exposes the same footguns as JavaScript React hooks. Hook
order, render purity, StrictMode replay, and stale closure issues are real, but
they should be handled by documentation, Lean-side linting, and later safer
abstractions. They should not block the first compatibility layer from looking
like React and ProofWidgets code that users already understand.

For Vir, full infoview compatibility remains a follow-up target.
The current `Vir.Infoview` shell can mount a VIR package in the Lean infoview
and can fetch local WASM/`.irpkg` assets through a narrow asset RPC. It now has
a minimal snapshot-aware activation path for live Lean widget code, but it does
not yet have the proof-script edit channel or broader ProofWidgets RPC
compatibility that tactic UIs can rely on.

The current API coverage inventory is maintained as a machine-readable block in
`docs/API_COVERAGE.md`; `docs/API_COVERAGE.tsv` is generated from that
documentation block for tooling compatibility.

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
outside the general manifest surface. The current standalone renderer now uses
a native `ReactNode` resource rather than a recursive `Html` tree; broader
ProofWidgets compatibility must still keep callback ownership and
renderer-specific cleanup inside a narrow audited ABI.

This roadmap assumes the current `main` branch repository setup: Lean
`v4.31.0`, the local WASI SDK from `npm run install:wasi`, and the small
repository harness documented in `AGENTS.md`, `CONTRIBUTING.md`, and
`docs/HARNESS.md`. For this line of work, use `npm run setup` for a fresh
checkout and `npm run doctor` before deeper validation when the local toolchain
state is uncertain.

## Current Standalone Renderer

The current standalone renderer is implemented and documented in
`docs/REACT_NODE.md`. In short, Lean can construct `ReactNode` resources
through DOM-like combinators, render them into a browser React root, retain
Lean callbacks in event handlers, and release them on rerender, unmount,
package reload, or runtime disposal.

That renderer deliberately avoids full infoview compatibility. It validates the
host-resource and callback-lifetime model first. Resource values now cross the
C++/Wasm ABI through an `externref` side channel, while ProofWidgets RPC
compatibility remains a later layer.

## ProofWidgets Compatibility Layers

A realistic path has three layers:

1. **Standalone React renderer.** Render Lean-authored trees and retained Lean
   callbacks into a browser DOM container. This enables small interactive
   widgets from Lean without a Lean server.
2. **ProofWidgets programming model.** Provide a Lean API close to
   `ProofWidgets.Data.Html`, `ProofWidgets.Component`, and JSX-like usage, and
   compile it to this narrow `ReactNode`/React host boundary. This should cover
   text, attributes, children, component nodes, basic events, reusable Lean
   components, and a JS-like component entry mode in which the infoview shell
   renders a real React component while Lean computes its returned tree. Raw
   hook-like APIs can be accepted at this layer if they are called only under
   that React render context; early tooling should document and lint the normal
   React rules rather than replacing them with a new model. Before adding that
   API layer,
   `examples/ReactProofWidgetHello.lean` provides the first copyable
   infoview-only proof-widget example: it compiles through the existing React
   renderer, mounts a live `Surface`, and keeps the required widget package
   shape visible without the full showcase UI. `examples/ReactProofWidget.lean`
   is the next rung and provides the fuller API showcase. The JavaScript
   shell receives real `PanelWidgetProps`, flattens `InteractiveGoal` and
   `InteractiveTermGoal` values, normalizes cursor and selected-location data,
   and passes the shared `Lean.Vir.Infoview.Surface` structure to the VIR entry.
   The current blessed surface carries typed document position data, goal
   kind/index/user/metavariable identity, hypothesis free-variable identifiers,
   and normalized selected locations. The demo also exercises the first narrow
   infoview host command, `Lean.Vir.Infoview.Clipboard.writeText`, by copying the
   selected target or a text snapshot of the selected goal context, plus
   `Lean.Vir.Infoview.Command.revealCursor`, which dispatches through upstream
   `EditorConnection.revealPosition` in the bundled infoview shell. The file also
   includes a file-local `vir_proof_widget` declaration and `show_panel_widgets`
   command that mount the component through a real Lean `@[widget_module]` shell
   in the infoview, then leave the widget active for the proof playground below
   it.
   That shell embeds an esbuild bundle of the VIR JavaScript runtime graph,
   keeps React/ReactDOM/infoview imports external so they resolve to the Lean
   infoview dependencies, loads the WASM through `Lean.Vir.Infoview.readAsset`,
   and derives the standard mount/unmount, `IRPackage`, and `WidgetProps`
   declarations from the supplied component. The package bytes are still built
   from the active Lean server snapshot through
   `Lean.Vir.Infoview.buildIRPackage`, so the local demo no longer requires the
   repository Vite dev server or a package watcher.
   `statIRPackage` provides a package-root revision token for cache lookup and
   later refreshes. The token is derived from the compiled IR declaration
   closure plus source ranges for local declarations, so imported helper-module
   changes are detected once they are present in the active Lean snapshot.
   Cursor movement is not part of the runtime cache key, and ordinary proof
   edits outside the widget closure should not rebuild the package. With
   `autoReloadMs` set, the demo detects widget-code edits with a stat-only poll
   and emits fresh package bytes again only when that token changes. It compiles
   each WASM asset revision to a cached
   `WebAssembly.Module`, which avoids recompiling the Lean IR interpreter module
   on ordinary infoview refreshes. For stable widget configuration it also keeps
   a module-level VIR runtime service alive across React component remounts and
   calls the entry again only when the semantic proof surface or package
   revision changes; `ReactProofWidget.mount` is idempotent for a selector and
   rerenders the existing React root. Idle cached services have a bounded TTL,
   and superseded services are disposed after their active widgets release them.
   The shell consumes widget mouse/click events at its outer container and calls
   `ReactProofWidget.unmount` when a selector is genuinely dropped. Removing the
   base64 byte transport remains a separate infoview/webview asset API
   improvement; inside this repository we can avoid external patches, but raw
   binary transfer would need support from the host webview/RPC surface.
3. **Infoview/RPC compatibility.** Extend the current typed cursor/goal/selection
   surface with snapshot-aware RPC, server-side references, and edit commands.
   This is the layer needed for tactic UIs and proof-script editing, and it
   should stay narrow and typed instead of exposing an arbitrary JavaScript RPC
   bag to Lean. The first reference slice is intentionally smaller than this
   final target: `Vir.ProofWidgets.Rpc` provides `RpcRef`, `WithRpcRef α`,
   `ExprWithCtx.save`, and a host-dispatched `resolveRef` action so
   `InteractiveExpr`-shaped component props can cross the Lean/JS boundary and
   update component-owned React state from an async callback.
   `Vir.Infoview.ProofWidgetsRpc` resolves descriptor fallbacks through the
   active Lean server snapshot and now has a standard `Lean.Server.WithRpcRef`
   route for server-owned expression-with-context objects, while
   elaborator-backed construction and edit commands remain future work.

## Porting Targets

Use upstream ProofWidgets4 examples as the compatibility test corpus. The first
ports should be small enough to keep failures actionable, but representative
enough to prevent us from designing an API in a vacuum:

1. `ProofWidgets/Demos/Jsx.lean`: verifies JSX-like Lean syntax, lowercase HTML
   tags, string/JSON attributes, children interpolation, and uppercase component
   embedding. The current combinator-only fixture also includes the first
   `InteractiveExpr`-shaped `WithRpcRef`/`resolveRef` case.
2. `ProofWidgets/Component/HtmlDisplay.lean` and
   `ProofWidgets/Data/Html.lean`: verify the core `Html` and component-node
   encoding.
3. `ProofWidgets/Component/OfRpcMethod.lean`: verifies the Lean-computed
   component shape analogous to `mk_rpc_widget%`.
4. A small interactive example that uses React state/hooks from the component
   render context, so we learn the real constraints before designing safer
   wrappers.
5. A tactic/editing example such as the selection/insert-conversion demos once
   the infoview RPC/edit channel exists.

## Open Questions

- How much of ProofWidgets' RPC layer can be approximated without a full Lean
  server snapshot/edit model.
- How faithfully the initial component/JSX API can mirror
  `ProofWidgets.Data.Html` before we need repository-specific extensions for
  callbacks and hook-like behavior.
- Whether future recursive-data improvements should support enough structure
  sharing or mutual recursion to represent more of ProofWidgets directly.
