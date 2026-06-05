# React And ProofWidgets Roadmap

This note records the browser-facing React direction after the closure host
callback bridge. The practical goal is basic React support good enough to write
ProofWidgets-style views from Lean, then grow toward richer ProofWidgets
compatibility.

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

For LeanVir, the immediate target should not be full infoview compatibility.
We do not yet have the Lean server snapshot/RPC layer, document positions, or
proof-script edit channel that real ProofWidgets can rely on. The first useful
target is a standalone React renderer for Lean-authored UI trees with retained
Lean callbacks.

## Current LeanVir Fit

The merged closure bridge gives us the hard part for interactive React views:

- Lean closures can cross to JavaScript as `VirCallback` values.
- JavaScript can retain those callbacks and release them on removal,
  cancellation, package reload, or `VirRuntime.dispose()`.
- Function types are now manifest types, so callback fields can be nested
  inside host-import data structures as long as the surrounding Lean data is
  otherwise representable.
- Opaque host resources already cover DOM elements and can be extended to React
  roots or rendered node handles.

The main remaining mismatch is structural: direct recursive structures and
simple non-indexed recursive inductives with nullary or runtime-payload
constructors can now cross the boundary, but mutual recursion, non-uniform
recursion, and inherited recursive structures remain outside the general
manifest surface. A natural ProofWidgets-like `Html` tree is recursive and may
fit that surface, but the v0 React plan should still keep callback ownership
and renderer-specific cleanup inside a narrow audited ABI.

This roadmap assumes the current `main` branch repository setup: Lean
`v4.30.0-rc2`, the local WASI SDK from `npm run install:wasi`, and the small
repository harness documented in `AGENTS.md`, `CONTRIBUTING.md`, and
`docs/HARNESS.md`. For this line of work, use `npm run setup` for a fresh
checkout and `npm run doctor` before deeper validation when the local toolchain
state is uncertain.

## Current V0

The current v0 exposes React as a runtime renderer behind a narrow recursive
`Html` ABI:

```lean
namespace Lean.Vir.React

@[vir_resource "ReactRoot"]
opaque Root : Type

inductive PropValue where
  | string : String → PropValue
  | bool : Bool → PropValue

structure Property where
  name : String
  value : PropValue

structure EventHandler where
  name : String
  callback : Lean.Vir.Browser.Event → IO Unit

inductive Html where
  | text (value : String)
  | element
      (tag : String)
      (key? : Option String)
      (props : Array Property)
      (handlers : Array EventHandler)
      (children : Array Html)

def button (label : String) (onClick : IO Unit) : Html :=
  .element "button" none #[]
    #[EventHandler.mkClick onClick]
    #[.text label]

namespace Root

@[vir_js "react.root.create"]
opaque create (container : @& Lean.Vir.Browser.Element) : IO Root

@[vir_js "react.root.render"]
opaque render (root : @& Root) (html : @& Html) : IO Unit

@[vir_js "react.root.unmount"]
opaque unmount (root : @& Root) : IO Unit

end Root

end Lean.Vir.React
```

After the recursive interface work, this no longer needs a private `reactHtml`
wire tag. The package generator represents `Lean.Vir.React.Html` using the
generic non-indexed custom-inductive and `recursiveSelf` descriptors, including
the known `Property`, `PropValue`, and `EventHandler` payload shapes. The small
audited surface is now the React renderer and callback ownership policy rather
than a separate recursive codec.

The JavaScript renderer may still flatten the tree internally for bookkeeping,
diffing, or callback cleanup. That lowering should remain an implementation
detail, not the Lean-facing API.

## JavaScript Runtime Contract

The browser host binding should own a React root resource:

- `react.root.create` calls `ReactDOM.createRoot(container)`.
- `react.root.render` converts the decoded `Html` tree into `React.createElement`
  calls and invokes `root.render(...)`.
- `react.root.unmount` calls `root.unmount()` and releases callbacks retained
  by the current render.
- Rendering a new tree into the same browser root queues callbacks retained by
  the previous tree for microtask release after React has been given the
  replacement tree. The virtual test host releases immediately.
- Runtime dispose and package reload unmount all live React roots through the
  same disposable-resource path used for DOM listeners, timeouts, and frames.

For v0, keep event handlers to DOM-like names such as `onClick`, `onChange`,
and `onInput`, and pass the same opaque `Lean.Vir.Browser.Event` resource that
`Element.addEventListener` already uses. React synthetic events should not be
stored by Lean; they should be callback-scoped resources just like the current
DOM event handles.

## Why Not Start With `externref`

`externref` remains the right future representation for host-owned resources,
but it is not required for basic React. The resource table is enough for
`ReactRoot` and callback-scoped events, and it keeps the v0 path compatible
with the current `wasm32-wasip1` shim. React support should validate the
resource lifetime model first; an `externref` lowering can replace the table
later without changing the Lean-facing API much.

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

## Implemented V0 Slice

1. Added `react` and `react-dom` dependencies to the Vite app.
2. Added `LeanVir/React.lean` with `Root`, `Html`, `Property`, `PropValue`,
   `EventHandler`, and root create/render/unmount host imports.
3. Reused the generic custom-inductive and `recursiveSelf` manifest support for
   the recursive `Html` shape.
4. Added JavaScript React tree validation with recursion-depth and node-count
   limits before rendering.
5. Added browser and virtual Node host bindings under `react.root.*`.
6. Added `examples/ReactCounter.lean` that renders a button and updates through
   a retained Lean callback.
7. Added runtime tests for nested callbacks inside `Html`, root rerender cleanup,
   unmount cleanup, package reload cleanup, runtime dispose, malformed trees,
   and recursion limits.
8. Added browser smoke coverage proving a real React click calls back into Lean,
   including a rapid rerender cleanup stress case.

## Open Questions

- Whether `PropValue` should stay at `String`/`Bool` in v0 or add numeric,
  style-object, class-list, and JSON-like values immediately.
- Whether React roots should be created only from `Browser.Element` resources
  or also from CSS selectors for convenience.
- Whether the microtask cleanup policy for browser React rerenders is enough for
  broader concurrent React edge cases.
- Whether recursive custom-inductive values should eventually preserve sharing
  or intentionally treat `Html` as a pure tree. The first phase should almost
  certainly use pure trees and reject only by depth/node-count limits.
- How much of ProofWidgets' RPC layer can be approximated without a Lean
  server snapshot model.
