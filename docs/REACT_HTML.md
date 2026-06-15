# React HTML Renderer

This note tracks the standalone React renderer that Vir exposes today. It
is intentionally separate from the future ProofWidgets compatibility work in
`docs/REACT_PROOFWIDGETS_ROADMAP.md`.

## Current V0

The current v0 exposes React as a runtime renderer behind a narrow native-node
resource ABI:

```lean
namespace Lean.Vir.React

@[irreducible] def ReactM (α : Type) : Type := Lean.Vir.Browser.DomM α

opaque Root : Type
opaque StateSetter (α : Type) : Type
opaque Props : Type
opaque Html : Type

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
  props → ReactM (Lean.Vir.Js Html)

namespace JsValue

def ofString (value : String) : ReactM (Lean.Vir.Js String)
def toString (value : Lean.Vir.Js String) : ReactM String
def ofNat (value : Nat) : ReactM (Lean.Vir.Js Nat)
def toNat (value : Lean.Vir.Js Nat) : ReactM Nat
def ofBool (value : Bool) : ReactM (Lean.Vir.Js Bool)
def toBool (value : Lean.Vir.Js Bool) : ReactM Bool

end JsValue

namespace Hooks

def useState (initial : Lean.Vir.Js α) : ReactM (State (Lean.Vir.Js α))

end Hooks

namespace State

def set (state : State (Lean.Vir.Js α)) (value : Lean.Vir.Js α) : ReactM Unit
def modify
    (state : State (Lean.Vir.Js α))
    (update : Lean.Vir.Js α → Lean.Vir.Js α) :
    ReactM Unit

end State

namespace Html

@[vir_js "react.html.text"]
opaque text (value : @& String) : ReactM (Lean.Vir.Js Html)

@[vir_js "react.html.element"]
opaque element
    (tag : @& String)
    (key? : Option String)
    (props : Array Property)
    (handlers : Array EventHandler)
    (children : Array (Lean.Vir.Js Html)) :
    ReactM (Lean.Vir.Js Html)

end Html

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
opaque render (root : @& Lean.Vir.Js Root) (html : @& Lean.Vir.Js Html) :
  Lean.Vir.Browser.DomM Unit

def renderComponent
    (root : @& Lean.Vir.Js Root)
    (component : Component props)
    (props : props) :
    Lean.Vir.Browser.DomM Unit

@[vir_js "react.root.unmount"]
opaque unmount (root : @& Lean.Vir.Js Root) : Lean.Vir.Browser.DomM Unit

end Root
end Lean.Vir.React
```

`Lean.Vir.React.Html` is an opaque JavaScript-owned object marker and crosses
the host boundary as `Lean.Vir.Js Html`. Lean builds nodes through
`react.html.text` and `react.html.element`; the browser host constructs native
React nodes immediately with `React.createElement`, while the virtual test host
constructs equivalent virtual nodes. The package generator still represents the
known `Property`, `PropValue`, and `EventHandler` payload shapes directly; the
React-specific boundary is the native React node resource and callback
ownership policy, not a private recursive wire codec.

`Lean.Vir.Browser.DomM` is the browser/DOM effect used by React root lifetime
operations and event callbacks. `ReactM` is the narrower render-construction
effect reserved for React component APIs; it follows the proofwidgets-style
split between host IO, DOM mutation, and React render construction.

`Root.renderComponent` wraps the Lean function in a real JavaScript React
function component. Hooks therefore run under React's normal dispatcher instead
of being simulated by the Lean runtime. Components are props-taking functions:
`Component props := props → ReactM (Lean.Vir.Js Html)`, and no-props
components use `Component Unit` plus `()` at the render call.

The public state surface is resource-typed: `Hooks.useState`, `State.set`, and
`State.modify` operate on `Lean.Vir.Js α` values. There are deliberately no
`String`, `Nat`, or `Bool` `useState` overloads; scalar values must be converted
explicitly with `JsValue` helpers before crossing the React hook boundary.
`State.modify` passes a functional updater to React's setter.

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
`Html.elementWith`/`keyedElementWith` remain intentional escape hatches for
unblessed scalar prop names, event names, and tags. `PropValue.style` and
`PropValue.classList` are intentionally constrained to the `style` and
`className` props by the host renderer.

## Runtime Contract

The browser React host binding is exposed from
`lean-vir/react-host-bindings`. It owns a React root resource:

- `react.root.create` calls `ReactDOM.createRoot(container)`.
- `react.html.text` creates a `ReactHtml` resource for a string node.
- `react.html.element` validates props/handlers/children, calls
  `React.createElement(tag, props, ...children)`, and returns a `ReactHtml`
  resource.
- `react.root.render` renders the retained native React node held by a
  `ReactHtml` resource.
- `react.root.renderComponent` wraps a Lean thunk produced from
  `Component props` plus concrete props in a JavaScript React function
  component and invokes `root.render(...)` with that component.
- `react.useState` calls `React.useState` while rendering a component. Its ABI
  is resource-typed: `(initial : Js) -> ReactM (State (Js α))`.
- `js.string`, `js.nat`, and `js.bool` convert Lean scalar values into explicit
  `Lean.Vir.Js α` values for examples that need primitive React state.
- `react.state.set` and `react.state.modify` call the retained React setter;
  `modify` retains the Lean updater callback until React invokes it or the
  runtime is disposed.
- `react.root.unmount` calls `root.unmount()` and releases callbacks retained
  by the current render.
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
2. Added `Vir/React.lean` with `Root`, opaque `Html`, `Property`,
   `PropValue`, `EventHandler`, native Html construction, and root
   create/render/unmount host imports.
3. Added `ReactHtml` resource typing so Lean cannot bind a JavaScript-backed
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
9. Added runtime tests for nested callbacks inside `ReactHtml`, hook-backed
   component rerenders, root rerender cleanup, unmount cleanup, package reload
   cleanup, runtime dispose, malformed Html construction, depth limits, missing selectors, and input-event
   target fallback. Virtual `Document.querySelector` follows DOM semantics, so
   tests pre-seed expected fixtures with `ensureVirtualElementState`. Virtual
   React callback tests find nodes by DOM-like `id` props instead of child
   indexes.
10. Added browser smoke coverage proving real React click, input, change,
    submit/checkbox, and React Tamagotchi handlers call back into Lean,
    including rapid rerender cleanup.

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
