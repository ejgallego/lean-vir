# React Node Renderer

This note tracks the standalone React renderer that Vir exposes today. It
is intentionally separate from the future ProofWidgets compatibility work in
`docs/REACT_PROOFWIDGETS_ROADMAP.md`.

For implementors, [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md) has the React
component call-flow diagram and the shared host-resource/closure ownership
diagrams. The short model is:

- `Component props := props -> ReactM (Lean.Vir.Js Node)` is a Lean-authored
  React function component.
- `Root.render root tree` takes a `ReactM (Lean.Vir.Js Node)` tree and lowers
  it at the DOM/root boundary.
- `Root.renderComponent` wraps that Lean function in a real JavaScript React
  function component, so hooks run under React's dispatcher.
- `RuntimeM` is for JavaScript resource/runtime operations such as scalar
  boxing and React setter calls; it lifts into `ReactM` and `DomM`.
- `ReactM` is for render-safe React construction; root and DOM lifetime
  operations remain in `DomM`.
- `Node`, `Root`, state setters, events, and primitive JavaScript state values
  are JavaScript-owned resources that cross as `Lean.Vir.Js α`.
- Event and updater closures are Lean-owned closures that cross to JavaScript
  as releasable `VirCallback` objects.

## Current V0

The current v0 exposes React as a runtime renderer behind a narrow native-node
resource ABI:

```lean
namespace Lean.Vir.React

@[irreducible] def ReactM (α : Type) : Type := Lean.Vir.RuntimeM α

opaque Root : Type
opaque StateSetter (α : Type) : Type
opaque Props : Type
opaque Node : Type

inductive PropValue where
  | string : String → PropValue
  | bool : Bool → PropValue
  | int : Int → PropValue
  | float : Float → PropValue
  | style : Array StyleProperty → PropValue
  | classList : Array String → PropValue

structure StyleProperty where
  name : String
  value : String

structure Property where
  name : String
  value : PropValue

structure EventHandler where
  name : String
  callback : Lean.Vir.Js Lean.Vir.Browser.Event → Lean.Vir.Browser.DomM Unit

structure State (α : Type) where
  value : α
  setter : Lean.Vir.Js (StateSetter α)

abbrev Component (props : Type := Unit) : Type :=
  props → ReactM (Lean.Vir.Js Node)

end Lean.Vir.React

namespace Lean.Vir.JsValue

def ofString (value : String) : Lean.Vir.RuntimeM (Lean.Vir.Js String)
def toString (value : Lean.Vir.Js String) : Lean.Vir.RuntimeM String
def ofNat (value : Nat) : Lean.Vir.RuntimeM (Lean.Vir.Js Nat)
def toNat (value : Lean.Vir.Js Nat) : Lean.Vir.RuntimeM Nat
def ofBool (value : Bool) : Lean.Vir.RuntimeM (Lean.Vir.Js Bool)
def toBool (value : Lean.Vir.Js Bool) : Lean.Vir.RuntimeM Bool

end Lean.Vir.JsValue

namespace Lean.Vir.React

namespace Hooks

def useState (initial : Lean.Vir.Js α) : ReactM (State (Lean.Vir.Js α))

end Hooks

namespace State

def set
    (state : State (Lean.Vir.Js α))
    (value : Lean.Vir.Js α) :
    Lean.Vir.RuntimeM Unit
def modify
    (state : State (Lean.Vir.Js α))
    (update : Lean.Vir.Js α → Lean.Vir.RuntimeM (Lean.Vir.Js α)) :
    Lean.Vir.RuntimeM Unit

end State

namespace Node

@[vir_js "react.node.text"]
opaque text (value : @& String) : ReactM (Lean.Vir.Js Node)

@[vir_js "react.node.createElement"]
opaque createElement
    (tag : @& String)
    (key? : Option String)
    (props : Array Property)
    (handlers : Array EventHandler)
    (children : Array (Lean.Vir.Js Node)) :
    ReactM (Lean.Vir.Js Node)

end Node

namespace Root

@[vir_js "react.root.create"]
opaque create (container : @& Lean.Vir.Js Lean.Vir.Browser.Element) :
  Lean.Vir.Browser.DomM (Lean.Vir.Js Root)

def createFromSelector (selector : String) :
  Lean.Vir.Browser.DomM (Option (Lean.Vir.Js Root)) := ...

def mountFromSelector
    (selector : String)
    (action : Lean.Vir.Js Root → Lean.Vir.Browser.DomM Unit) :
    Lean.Vir.Browser.DomM Bool := ...

@[vir_js "react.root.render"]
opaque render (root : @& Lean.Vir.Js Root) (node : ReactM (Lean.Vir.Js Node)) :
  Lean.Vir.Browser.DomM Unit := ...

def renderComponent
    (root : @& Lean.Vir.Js Root)
    (component : Component props)
    (props : props) :
    Lean.Vir.Browser.DomM Unit

def renderIntoSelector (selector : String) (node : @& Lean.Vir.Js Node) :
  Lean.Vir.Browser.DomM Bool

def renderComponentIntoSelector
    (selector : String)
    (component : Component props)
    (props : props) :
    Lean.Vir.Browser.DomM Bool

@[vir_js "react.root.unmount"]
opaque unmount (root : @& Lean.Vir.Js Root) : Lean.Vir.Browser.DomM Unit

def unmountSelector (selector : String) : Lean.Vir.Browser.DomM Bool

end Root
end Lean.Vir.React
```

`Lean.Vir.React.Node` is an opaque JavaScript-owned object marker and crosses
the host boundary as `Lean.Vir.Js Node`. Lean builds nodes through
`react.node.text` and `react.node.createElement`; the browser host constructs native
React nodes immediately with `React.createElement`, while the virtual test host
constructs equivalent virtual nodes. The package generator still represents the
known `Property`, `PropValue`, and `EventHandler` payload shapes directly; the
React-specific boundary is the native React node resource and callback
ownership policy, not a private recursive wire codec.

`Lean.Vir.RuntimeM` is the JavaScript runtime/resource effect: it can allocate
or inspect `Lean.Vir.Js ...` values and update VIR runtime bookkeeping, but it
does not represent DOM/root mutation or arbitrary host `IO`. `ReactM` lifts
`RuntimeM` so component code can box scalar state and call React setter
resources without gaining access to raw `IO`.

`Lean.Vir.Browser.DomM` is the browser/DOM effect used by React root lifetime
operations and event callbacks. `ReactM` is the narrower render-construction
effect reserved for React component APIs and static tree construction.
`Root.render` is itself the host boundary and receives a `ReactM` tree action.
The JavaScript host invokes that render action to obtain the concrete `Js Node`
resource, renders it into the root, and releases the render callback. The
current runtime uses the same synchronous host-call representation for all
recognized effects, so these are irreducible Lean-side effect markers rather
than distinct runtime wrappers.

`Root.renderComponent` wraps the Lean function in a real JavaScript React
function component. Hooks therefore run under React's normal dispatcher instead
of being simulated by the Lean runtime. Components are props-taking functions:
`Component props := props → ReactM (Lean.Vir.Js Node)`, and no-props
components use `Component Unit` plus `()` at the render call.

The public state surface is resource-typed: `Hooks.useState`, `State.set`, and
`State.modify` operate on `Lean.Vir.Js α` values. There are deliberately no
`String`, `Nat`, or `Bool` `useState` overloads; scalar values must be converted
explicitly with `JsValue` helpers before crossing the React hook boundary.
`State.set` and `State.modify` are `RuntimeM` operations because they call a
retained JavaScript React setter resource; `modify` passes a monadic functional
updater to React's setter. The resource ownership policy for state values,
updater-local handles, and scalar `JsValue` wrappers is centralized in
[HOST_BINDINGS.md](HOST_BINDINGS.md#resource-ownership-policy).

```lean
State.modify count fun previous => do
  let value ← Lean.Vir.JsValue.toNat previous
  Lean.Vir.JsValue.ofNat (value + 1)
```

## Blessed Helpers

The intended authoring surface is a DOM-like helper set over that ABI:

- props: named helpers for common DOM/React names such as `id`, `inputName`,
  `formName`, `className`, `classList`, `title`, `role`, `aria*`, `data`,
  `dataTestId`, `tabIndex`, `style`/`stylePairs`, link/media props,
  controlled/default input props, dimensions, and boolean form props.
- handlers: `onClick`/`onClickWith`, input/change/submit helpers, focus/blur,
  keyboard, mouse, and raw `on`/`onUnit` escape hatches.
- elements: keyed and unkeyed helpers for common text, form, sectioning, list,
  table, inline, button, link, image, and void elements.

`Property.inputValue` maps to React's `value` prop. It is named `inputValue`
because `Property.value` is already the Lean structure-field projection.
`Property.inputName` and `Property.formName` map to React's `name` prop for the
same reason: `Property.name` is the structure-field projection.
`Property.htmlFor` maps to React's label `htmlFor` prop. The `aria*` helpers
map to hyphenated ARIA attributes, `Property.data name value` prefixes the prop
name with `data-`, `Property.dataTestId` maps to `data-testid`, and
`Property.tabIndex` maps to React's numeric `tabIndex` prop. The `data` helper
expects a non-empty suffix, matching the documented `data-*` shape.
`Property.classList` validates DOMTokenList-like non-empty class tokens,
deduplicates them while preserving order, and lowers to `className`.
`Property.style` builds React's object-valued `style` prop from camelCase
`StyleProperty.mk` entries with string values. The keyed element helpers set
React's `key` for list-like children while preserving the same props, handlers,
and children conventions as their unkeyed counterparts.

`Property.string`/`bool`/`int`/`float`, `EventHandler.on`/`onUnit`, and
`Node.elementWith`/`keyedElementWith` remain intentional escape hatches for
unblessed scalar prop names, event names, and tags. `PropValue.style` and
`PropValue.classList` are intentionally constrained to the `style` and
`className` props by the host renderer.

## Runtime Contract

The browser React host binding is exposed from
`lean-vir/react-host-bindings`. It owns a React root resource:

- `react.root.create` calls `ReactDOM.createRoot(container)`.
- `react.node.text` creates a `ReactNode` resource for a string node.
- `react.node.createElement` validates props/handlers/children, calls
  `React.createElement(tag, props, ...children)`, and returns a `ReactNode`
  resource.
- `react.root.render` invokes the received Lean `ReactM` render action, renders
  the retained native React node held by the resulting `ReactNode` resource,
  and releases the render callback.
- `react.root.renderComponent` wraps a Lean thunk produced from
  `Component props` plus concrete props in a JavaScript React function
  component and invokes `root.render(...)` with that component.
- `react.useState` calls `React.useState` while rendering a component. Its ABI
  is resource-typed: `(initial : Js) -> ReactM (State (Js α))`.
- `js.string`, `js.nat`, and `js.bool` convert Lean scalar values into explicit
  `Lean.Vir.Js α` values through `RuntimeM` for examples that need primitive
  React state.
- `react.root.renderIntoSelector` and
  `react.root.renderComponentIntoSelector` create or reuse a host-owned React
  root for a selector. This is the infoview/proof-widget path where the shell
  owns the DOM mount element and Lean supplies the current tree or component.
- `react.state.set` and `react.state.modify` call the retained React setter;
  both are `RuntimeM`, and `modify` retains the Lean updater callback until
  React invokes it or the runtime is disposed.
- `react.state.modify` updater-local resource lifetime is documented with the
  shared host ownership rules in
  [HOST_BINDINGS.md](HOST_BINDINGS.md#resource-ownership-policy).
- `react.root.unmount` calls `root.unmount()` and releases callbacks retained
  by the current render.
- `react.root.unmountSelector` unmounts and forgets a selector-owned root.
- Rendering a new tree into the same browser root queues callbacks retained by
  the previous tree for microtask release after React has been given the
  replacement tree. Event-triggered rerenders defer stale callback release
  until the event handler returns, then flush immediately. Function-component
  rerenders use the same policy in the browser and virtual host.
- Runtime dispose and package reload unmount all live React roots through the
  same disposable-resource path used for DOM listeners, timeouts, and frames.

Browser apps compose these bindings with `createBrowserHostBindings` and a
shared `createHostResourceState()`. The generic `lean-vir/host-bindings` entry
does not import React; the Node wrapper still provides a virtual React host for
tests.

Event handlers use DOM-like names such as `onClick`, `onChange`, `onInput`, and
`onSubmit`, and receive the same opaque
`Lean.Vir.Js Lean.Vir.Browser.Event` resource that `Element.addEventListener`
uses. React synthetic events should not be stored by Lean; they are
callback-scoped resources.

Input callbacks can read `Event.currentTarget` or `Event.target`, narrow the
returned element with `HTMLInputElement.fromElement`, or use
`Event.inputValue?`/`inputChecked?` for common controlled-input cases. Those
helpers check `currentTarget` first, then fall back to `target`.

## Implemented Slice

1. Added `react` and `react-dom` dependencies to the Vite app.
2. Added `Vir/React.lean` with `Root`, opaque `Node`, `Property`,
   `PropValue`, `EventHandler`, native Node construction, and root
   create/render/unmount host imports.
3. Added `ReactNode` resource typing so Lean cannot bind a JavaScript-backed
   React node without the marker appearing under `Lean.Vir.Js`.
4. Added JavaScript React node validation with depth and node-count limits
   before rendering.
5. Added browser and virtual Node host bindings for React roots, components,
   and hooks.
6. Added `examples/ReactCounter.lean` that renders a hook-backed function
   component with `Hooks.useState` and a functional setter.
7. Added `examples/ReactInput.lean` with hook-backed controlled text, change,
   submit, checkbox, attribute-conformance, label, and form examples.
8. Added `ReactTamagotchi` in `examples/Tamagotchi.lean` as a larger stateful
   example that shares the non-React Tamagotchi model, renders a keyed React
   tree, and handles controlled input, checkbox, submit, and action callbacks.
9. Added `examples/ReactProofWidget.lean` as a fuller proof-widget-shaped
   example that compiles into `demo-host.irpkg`, displays on `react.html`, and
   can also be loaded as a live infoview widget through `show_panel_widgets`.
10. Added runtime tests for nested callbacks inside `ReactNode`, hook-backed
   component rerenders, root rerender cleanup, unmount cleanup, package reload
   cleanup, runtime dispose, malformed Node construction, depth limits, missing
   selectors, and input-event
   target fallback. Virtual `Document.querySelector` follows DOM semantics, so
   tests pre-seed expected fixtures with `ensureVirtualElementState`. Virtual
   React callback tests find nodes by DOM-like `id` props instead of child
   indexes.
11. Added browser smoke coverage proving real React click, input, change,
    submit/checkbox, and React Tamagotchi handlers call back into Lean,
    including rapid rerender cleanup, plus proof-state goal selection.

## Future Notes

`externref` is now required by the experimental JavaScript resource path.
Resource values cross the JS/Wasm boundary through `externref` side-channel
imports, while Lean stores GC-finalized external resource objects. This keeps
the Lean-facing API compatible with future component-model-style resources.
The React-first direction and feature probes are tracked in
`docs/REACT_WASM_BINDINGS.md`.

Open engineering questions:

- Whether `PropValue` should add JSON-like values beyond the current scalar,
  style-object, and class-list surface.
- Whether the microtask cleanup policy for browser React rerenders is enough for
  broader concurrent React edge cases.
- Whether broader prop values should include JSON-like objects or stay limited
  to the current scalar/style/class-list set until a real ProofWidgets port
  needs more.
