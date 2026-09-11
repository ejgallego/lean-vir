# ProofWidgets Compatibility Roadmap

The target is ordinary ProofWidgets components implemented in Lean rather than
TypeScript, running in the same browser React/infoview environment. Semantic
divergences are compatibility defects or missing support unless a necessary
Lean/JavaScript bridge obligation is identified explicitly. The implemented
renderer is tracked in `docs/REACT_NODE.md`; concrete component parity targets
are maintained in [PROOFWIDGETS_PORTING.md](PROOFWIDGETS_PORTING.md).

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
- The optional `ProofWidgets.Html`/`HtmlDisplay` path: a Lean tree with `element`, `text`, and `component`
  nodes, where component nodes carry a component hash/export, encoded props,
  and children.
- `ProofWidgets.Html.ofComponent`: the standard way for Lean-authored HTML to
  embed another component.
- `ProofWidgets.Jsx`: JSX-like syntax where lowercase tags are HTML elements
  and uppercase tags are `Component`s.
- `mk_rpc_widget%`: an optional server-computed component pattern, which turns
  an RPC method returning `Html` into a component.

Lean VIR should therefore first grow the familiar React/ProofWidgets API
surface, even if it exposes the same footguns as JavaScript React hooks. Hook
order, render purity, StrictMode replay, and stale closure issues remain the
programmer's responsibility just as in TypeScript. Explain them without promising
new enforcement or adding a parallel scheduler. The serialized HTML path is one
API to interoperate with, not the universal widget execution model.

For Vir, full infoview compatibility remains a follow-up target.
The current `Vir.Infoview` shell can mount a VIR package in the Lean infoview
and can fetch local WASM/`.irpkg` assets through a narrow asset RPC. It now has
a minimal snapshot-aware activation path for live Lean widget code, but it does
not yet have the broader structured proof-script edit and tactic RPC channels
that full ProofWidgets compatibility requires. Narrow commands for revealing
the cursor and inserting text at it are already available.

The current API coverage inventory is maintained as a machine-readable block in
`docs/API_COVERAGE.md`; tooling can generate
`build/analysis/api-coverage.tsv` from that documentation block.

## Current Vir Fit

The merged closure bridge gives us the hard part for interactive React views:

- Lean closures cross to JavaScript as ordinary callable functions with
  private, self-owning Lean roots.
- JavaScript retains those functions through ordinary reachability; package
  reload and `VirRuntime.dispose()` provide deterministic root cleanup.
- Function types are now manifest types, so callback fields can be nested
  inside host-import data structures as long as the surrounding Lean data is
  otherwise representable.
- Exact JavaScript values already cover DOM elements, React roots, and rendered
  nodes without a parallel wrapper model.

The main remaining mismatch for richer ProofWidgets-style data is structural:
direct recursive structures and simple non-indexed recursive inductives with
nullary or runtime-payload constructors can now cross the boundary, but mutual
recursion, non-uniform recursion, and inherited recursive structures remain
outside the general manifest surface. The current standalone renderer now uses
a native `ReactNode` resource rather than a recursive `Html` tree; broader
ProofWidgets compatibility must still keep Lean-root obligations and active
renderer cleanup inside a narrow audited ABI.

This roadmap assumes the current `main` branch repository setup and the small
repository harness documented in `AGENTS.md`, `CONTRIBUTING.md`, and
`docs/HARNESS.md`. For this line of work, use `npm run setup` for a fresh
checkout and `npm run doctor` before deeper validation when the local toolchain
state is uncertain.

## Current Standalone Renderer

The current standalone renderer is implemented and documented in
`docs/REACT_NODE.md`. In short, Lean can construct `ReactNode` resources
through DOM-like combinators and render them into a browser React root. Props,
children, elements, and callbacks are their actual JavaScript values and use
the same reachability rules as a TypeScript React application.

That renderer deliberately avoids full infoview compatibility. It validates the
exact-value and active-resource model first. JavaScript values cross the
C++/Wasm ABI through an `externref` side channel, while ProofWidgets RPC
compatibility remains a later layer.

## React Faithfulness Plan

The React layer should stay a shallow embedding of React's own programming
model. Lean code should author real React function components, create real
React elements, call React-owned hooks during render, and accept the usual
React pitfalls around hook order, render purity, stale closures, and effect
dependencies. Safer Lean abstractions can come later, but the compatibility
surface should first be familiar enough that ProofWidgets4 examples can be
ported without redesigning their component model.

Current RF status:

- `Component.ofLean` creates the actual JavaScript function identity seen by
  React. Reusing that value preserves hook state; constructing another value
  remounts under React's normal rules. No string identity registry remains.
- `useState`, `useReducer`, `useMemo`, `useCallback`, `useContext`, and native
  `useEffect` delegate exact JavaScript values to React. Explicit callback
  conversions and tuple projections are separate helpers.
- `useEffectWithDeps` exposes React's dependency-array shape through
  an actual JavaScript dependency array. React decides when dependencies are
  unchanged; VIR keeps no parallel dependency ownership state.
- `useRef` exposes React-owned ref objects, and `Node.fragment` maps to
  `React.Fragment`.

Remaining RF gaps to close in order:

1. Add the remaining common DOM attributes/events needed by real ProofWidgets
   examples.
2. Fill missing official call shapes such as root options and the reducer
   initializer without adding a second semantic model.
3. Keep StrictMode/concurrent-render callback-root behavior documented and
   audited; do not invent non-React lifetime semantics to hide it.

## ProofWidgets Compatibility Layers

A realistic path has three layers:

1. **Standalone React renderer.** Render Lean-authored trees and retained Lean
   callbacks into a browser DOM container. This enables small interactive
   widgets from Lean without a Lean server.
2. **ProofWidgets programming model.** Provide a Lean API close to
   `ProofWidgets.Data.Html`, `ProofWidgets.Component`, and JSX-like usage, and
   compile it to the direct React host boundary. The current native JSX slice
   covers text, attributes, children, component nodes, basic events, reusable
   Lean components, and a JS-like component entry mode in which the infoview
   shell renders a real React component while Lean computes its returned tree.
   Raw hook APIs are accepted only under that React render context; documentation
   leaves the normal React rules with the programmer rather than replacing
   them with a new model.
   `examples/tutorials/ReactProofWidgetHello.lean` provides the first copyable
   infoview-only proof-widget example: it compiles through the existing React
   renderer, mounts a live `Surface`, and keeps the required widget package
   shape visible without the action UI. `examples/ReactProofWidget.lean`
   is the next rung and provides context-derived tactic actions. The JavaScript
   shell receives real `PanelWidgetProps`, flattens `InteractiveGoal` and
   `InteractiveTermGoal` values, normalizes cursor and selected-location data,
   and passes the shared `Lean.Vir.Infoview.Surface` structure to the VIR entry.
   The current blessed surface carries typed document position data, goal
   kind/index/user/metavariable identity, hypothesis free-variable identifiers,
   and normalized selected locations. The demo also exercises the first narrow
   infoview host command, `Lean.Vir.Infoview.Clipboard.writeText`, as a fallback
   for copying the selected goal context, plus
   `Lean.Vir.Infoview.Command.revealCursor`, which dispatches through upstream
   `EditorConnection.revealPosition` in the bundled infoview shell, and
   `Lean.Vir.Infoview.Command.insertAtCursor`, which applies a zero-width editor
   edit for the selected tactic. The file also
   includes a file-local `vir_proof_widget` declaration and `show_panel_widgets`
   command that mount the component through a real Lean `@[widget_module]` shell
   in the infoview, then leave the widget active for the proof playground below
   it.
   That shell embeds an esbuild bundle of the VIR JavaScript runtime graph,
   keeps React/ReactDOM/infoview imports external so they resolve to the Lean
   infoview dependencies, loads the WASM through `Lean.Vir.Infoview.readAsset`,
   and derives the standard component-factory/mount/unmount, `IRPackage`, and
   `WidgetProps` declarations from the supplied component action. The shell
   creates the component once per runtime service and passes that exact
   function to each mount update. The package bytes are still built
   from the active Lean server snapshot through
   `Lean.Vir.Infoview.buildIRPackage`, so the local demo no longer requires the
   repository Vite dev server or a package watcher.
   `statIRPackage` provides a package-root revision token for later refreshes.
   The token is derived from the compiled IR declaration
   closure plus source ranges for local declarations, so imported helper-module
   changes are detected once they are present in the active Lean snapshot.
   Cursor movement does not replace the widget-owned runtime, and ordinary
   proof edits outside the widget closure should not rebuild the package. With
   `autoReloadMs` set, the demo detects widget-code edits with a stat-only poll
   and emits fresh package bytes again only when that token changes. It compiles
   the current revision of each WASM asset as a compiled
   `WebAssembly.Module`, which avoids recompiling the Lean IR interpreter module
   on ordinary infoview refreshes without retaining superseded revisions. Each
   widget shell owns its mutable VIR runtime service directly; services are not
   shared between widget instances.
   The shell keeps that service across cursor and proof-surface updates and
   replaces it when the package revision or widget configuration changes. It
   reuses the component value produced by
   `ReactProofWidget.createComponent`, so `ReactProofWidget.mount` rerenders the
   existing React root without changing the component type. Normal unmount or
   refresh releases shell ownership; surviving callbacks and JSL remain usable.
   See the [lifetime contract](HOST_BINDINGS.md#ui-cleanup-versus-runtime-disposal)
   for the distinction from explicit disposal and failure handling.
   The shell consumes widget mouse/click events at its outer container and owns
   the nested official React root. Removing the
   base64 byte transport remains a separate infoview/webview asset API
   improvement; inside this repository we can avoid external patches, but raw
   binary transfer would need support from the host webview/RPC surface.
3. **Infoview/RPC compatibility.** Extend the current typed cursor/goal/selection
   surface using the official position-specific RPC session, native Promise,
   server-side references, and broader structured edit and tactic commands.
   `Vir.Infoview.Surface` now carries the exact `RpcSessionAtPos` object and
   `RpcSession.call` returns its exact native Promise. Direct Promise
   continuations and generic property access keep requests, responses, and
   nested reference objects in their ordinary JavaScript representation; VIR
   does not add an RPC scheduler or decoded response model.
   The real-server Chromium fixture now covers native request options,
   cancellation, rejection, rerendering, package replacement and genuine
   `Server.WithRpcRef` round trips, including successful replies arriving after
   cancellation. It also resolves a fixture-owned goal snapshot in a real
   hypothesis context. The provisional descriptor resolver,
   normalizer and global reference store are removed. Broader expression/context
   construction, upstream serialized HTML, and structured edit/tactic commands
   remain future work.

## Porting Targets

Use the ordered component list in [PROOFWIDGETS_PORTING.md](PROOFWIDGETS_PORTING.md).
Compare each Lean implementation with its upstream TypeScript implementation in
the same official React/infoview environment, reusing upstream dependencies.
`InteractiveExpr`, `HtmlDisplay` and `MakeEditLink` are planned parity ports, not
completed features. The current RPC tutorial supplies boundary evidence rather
than substituting for any of those components.

## Open Questions

- Which official infoview context and component exports need direct bindings for
  the selected ports?
- Which shared server/client declarations and identity-preserving accessors would
  remove duplicated schema assumptions without introducing a decoded object model?
- What loading/export gaps remain for composing upstream and Lean-authored
  components through the same widget-module interface?
