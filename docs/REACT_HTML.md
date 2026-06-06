# React HTML Renderer

This note tracks the standalone React renderer that LeanVir exposes today. It
is intentionally separate from the future ProofWidgets compatibility work in
`docs/REACT_PROOFWIDGETS_ROADMAP.md`.

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
  callback : Lean.Vir.Browser.Event → IO Unit

inductive Html where
  | text (value : String)
  | element
      (tag : String)
      (key? : Option String)
      (props : Array Property)
      (handlers : Array EventHandler)
      (children : Array Html)

namespace Root

@[vir_js "react.root.create"]
opaque create (container : @& Lean.Vir.Browser.Element) : IO Root

def createFromSelector (selector : String) : IO (Option Root) := ...

def mountFromSelector (selector : String) (action : Root → IO Unit) : IO Bool := ...

@[vir_js "react.root.render"]
opaque render (root : @& Root) (html : @& Html) : IO Unit

@[vir_js "react.root.unmount"]
opaque unmount (root : @& Root) : IO Unit

end Root
end Lean.Vir.React
```

`Lean.Vir.React.Html` uses the generic non-indexed custom-inductive and
`recursiveSelf` interface descriptors. The package generator represents the
known `Property`, `PropValue`, and `EventHandler` payload shapes directly; the
React-specific boundary is the renderer and callback ownership policy, not a
private recursive wire codec.

## Blessed Helpers

The intended authoring surface is a small DOM-like helper set over that ABI:

- props: `Property.id`, `inputName`, `className`, `title`, `role`,
  `classList`, `ariaLabel`, `ariaHidden`, `data`, `dataTestId`, `tabIndex`,
  `style`, `type`, `htmlFor`, `inputValue`, `placeholder`, `autoComplete`,
  `maxLength`, `checked`, and `disabled`
- handlers: `EventHandler.onClick`, `onClickWith`, `onInput`, `onInputUnit`,
  `onChange`, `onChangeUnit`, `onSubmit`, and `onSubmitWith`
- elements: `Html.div`/`keyedDiv`, `divWith`/`keyedDivWith`,
  `span`/`keyedSpan`, `spanWith`/`keyedSpanWith`, `input`/`keyedInput`,
  `label`/`keyedLabel`, `labelWith`/`keyedLabelWith`,
  `form`/`keyedForm`, `formWith`/`keyedFormWith`,
  `button`/`keyedButton`, and `buttonWith`/`keyedButtonWith`

`Property.inputValue` maps to React's `value` prop. It is named `inputValue`
because `Property.value` is already the Lean structure-field projection.
`Property.inputName` maps to React's `name` prop for the same reason:
`Property.name` is the structure-field projection. `Property.htmlFor` maps to
React's label `htmlFor` prop, `Property.ariaLabel` maps to `aria-label`,
`Property.ariaHidden` maps to `aria-hidden`, `Property.data name value`
prefixes the prop name with `data-`, `Property.dataTestId` maps to
`data-testid`, and `Property.tabIndex` maps to React's numeric `tabIndex` prop.
`Property.autoComplete` and `Property.maxLength` use React's DOM prop names.
The `data` helper expects a non-empty suffix, matching the documented
`data-*` shape. `Property.classList` validates
DOMTokenList-like non-empty class tokens, deduplicates them while preserving
order, and lowers to `className`.
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

The browser host binding owns a React root resource:

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

Event handlers use DOM-like names such as `onClick`, `onChange`, `onInput`, and
`onSubmit`, and receive the same opaque `Lean.Vir.Browser.Event` resource that
`Element.addEventListener` uses. React synthetic events should not be stored by
Lean; they are callback-scoped resources.

Input callbacks can read `Event.currentTarget` or `Event.target`, narrow the
returned element with `HTMLInputElement.fromElement`, or use
`Event.inputValue?`/`inputChecked?` for common controlled-input cases. Those
helpers check `currentTarget` first, then fall back to `target`.

## Implemented Slice

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
7. Added `examples/ReactInput.lean` with controlled text, change, submit,
   checkbox, attribute-conformance, label, and form examples.
8. Added `ReactTamagotchi` in `examples/Tamagotchi.lean` as a larger stateful
   example that shares the non-React Tamagotchi model, renders a keyed React
   tree, and handles controlled input, checkbox, submit, and action callbacks.
9. Added runtime tests for nested callbacks inside `Html`, root rerender
   cleanup, unmount cleanup, package reload cleanup, runtime dispose,
   malformed trees, recursion limits, missing selectors, and input-event
   target fallback. Virtual `Document.querySelector` follows DOM semantics, so
   tests pre-seed expected fixtures with `ensureVirtualElementState`. Virtual
   React callback tests find nodes by DOM-like `id` props instead of child
   indexes.
10. Added browser smoke coverage proving real React click, input, change,
    submit/checkbox, and React Tamagotchi handlers call back into Lean,
    including rapid rerender cleanup.

## Future Notes

`externref` remains the right future representation for host-owned resources,
but it is not required for this v0. The resource table is enough for
`ReactRoot` and callback-scoped events, and it keeps the current path
compatible with the `wasm32-wasip1` shim. An `externref` lowering can replace
the table later without changing this Lean-facing API much.

Open engineering questions:

- Whether `PropValue` should add JSON-like values beyond the current scalar,
  style-object, and class-list surface.
- Whether the microtask cleanup policy for browser React rerenders is enough for
  broader concurrent React edge cases.
- Whether recursive custom-inductive values should eventually preserve sharing
  or intentionally treat `Html` as a pure tree.
