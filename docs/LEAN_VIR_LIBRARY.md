# Lean.Vir Library

`Lean.Vir.*` is the Lean-side library for declarations that call back into the
JavaScript host while running through VIR's WASM interpreter.

The library is built locally by:

```bash
npm run build:lean-lib
```

Package generation commands run that step automatically and add
`build/lean-lib` to `LEAN_PATH`, so local `.lean` sources can import the
modules below.

## User Workflow

For the built-in browser, React, and common host imports, the Lean code is the only
piece users need to write. The JavaScript runtime already provides default
bindings for `common.*`, `browser.*`, and `react.root.*` targets.

1. Import the Lean module that provides the host import.

   ```lean
   import Lean.Vir.Browser
   ```

2. Write an exported Lean declaration that calls the host import.

   ```lean
   def titleHandshake (label : String) : IO String := do
     let title := "Lean VIR host: " ++ label
     Lean.Vir.Browser.Document.setTitle title
     Lean.Vir.Browser.Document.getTitle
   ```

3. Generate a package with that declaration as a root.

   ```bash
   npm run generate:irpkg -- MyDemo.lean web/public/my-demo.irpkg titleHandshake
   ```

   The command builds `Lean.Vir.*`, adds `build/lean-lib` to `LEAN_PATH`, writes
   the `.irpkg`, and writes a report next to it. The report should list the
   JavaScript host imports collected from the package.

4. Load the package in `/dev.html`. If it was written under `web/public/`, use a
   package URL. Otherwise, upload the generated `.irpkg` from the page.

   ```text
   dev.html?package=my-demo.irpkg&entry=titleHandshake
   ```

No extra `createVirRuntime` option is needed for the built-in browser imports:

```js
const vir = await createVirRuntime({
  wasmUrl: "vir-upstream.wasm",
  irPackageUrl: "my-demo.irpkg",
});

vir.call("titleHandshake", "browser handshake");
```

Browser event listeners use the same default bindings. Lean passes a closure
directly with `Element.addEventListener`; the host retains that closure
until the listener is removed or the runtime is disposed.

```lean
import Lean.Vir.Browser

def mountButtonCallback : IO Unit := do
  match ← Lean.Vir.Browser.Document.querySelector "#run" with
  | none => pure ()
  | some button =>
      let _listener ← Lean.Vir.Browser.Element.addEventListener
        button "click" fun _event => do
          Lean.Vir.Browser.Console.log "clicked run"
      pure ()
```

In Node tests or command-line tools, import the Node wrapper instead:

```js
import {
  createVirRuntime,
  ensureVirtualElementState,
  findVirtualReactElementById,
  virtualReactElementById,
} from "lean-vir/vir-runtime-node";
```

That wrapper uses the same runtime and installs virtual browser bindings for
`Lean.Vir.Browser.Document`, `Lean.Vir.Browser.Element`,
`Lean.Vir.Browser.Event`, `Lean.Vir.Browser.HTMLInputElement`, timers,
animation frames, and React roots. It also exports
`createVirtualElementState`, `createVirtualEventState`,
`ensureVirtualElementState`, `findVirtualReactElementById`, and
`virtualReactElementById` for direct virtual callback tests. Virtual
`Document.querySelector` matches the DOM by returning `none` for missing
selectors; call `ensureVirtualElementState(state, selector)` in JS tests when
the fixture should exist.

Pass `hostBindings` only for custom targets or to override one of the default
bindings. If a package imports both built-in and custom targets, the custom map
can contain just the custom entries; unresolved keys still fall through to the
default bindings.

For custom JavaScript functions, declare the host import in Lean and bind the
same target string in JavaScript.

```lean
import Lean.Vir.Host

@[vir_js "demo.bumpNat"]
opaque jsBumpNat (n : Nat) : Nat

def bumpViaJs (n : Nat) : Nat :=
  jsBumpNat n
```

Generate a package with `bumpViaJs` as a root:

```bash
npm run generate:irpkg -- MyCustom.lean web/public/custom.irpkg bumpViaJs
```

Then provide the matching JavaScript binding when creating the runtime:

```js
const vir = await createVirRuntime({
  wasmUrl: "vir-upstream.wasm",
  irPackageUrl: "custom.irpkg",
  hostBindings: {
    "demo.bumpNat": (n) => (BigInt(n) + 1n).toString(),
  },
});

vir.call("bumpViaJs", 41);
```

When checking a Lean file outside package generation, use the same library path:

```bash
npm run build:lean-lib
LEAN_PATH="build/lean-lib${LEAN_PATH:+:$LEAN_PATH}" lean MyDemo.lean
```

## Modules

`Lean.Vir.Host` provides the low-level `@[vir_js "..."]` host-import attribute
and the `@[vir_resource "..."]` marker for opaque Lean resource types.

```lean
import Lean.Vir.Host

@[vir_js "demo.bumpNat"]
opaque jsBumpNat (n : Nat) : Nat
```

`Lean.Vir.Common` provides small host imports that are useful in browser and
Node-like environments:

- `Lean.Vir.Common.echoString : @& String -> String`
- `Lean.Vir.Common.addNat : Nat -> Nat -> Nat`

`Lean.Vir.Browser` provides the first browser-specific imports:

- `Lean.Vir.Browser.Console.log : @& String -> IO Unit`
- `Lean.Vir.Browser.Element`
- `Lean.Vir.Browser.Event`
- `Lean.Vir.Browser.EventListener`
- `Lean.Vir.Browser.HTMLInputElement`
- `Lean.Vir.Browser.Timeout`
- `Lean.Vir.Browser.AnimationFrame`
- `Lean.Vir.Browser.Document.getTitle : IO String`
- `Lean.Vir.Browser.Document.setTitle : @& String -> IO Unit`
- `Lean.Vir.Browser.Document.querySelector : @& String -> IO (Option Lean.Vir.Browser.Element)`
- `Lean.Vir.Browser.Event.target : @& Lean.Vir.Browser.Event -> IO (Option Lean.Vir.Browser.Element)`
- `Lean.Vir.Browser.Event.currentTarget : @& Lean.Vir.Browser.Event -> IO (Option Lean.Vir.Browser.Element)`
- `Lean.Vir.Browser.Event.preventDefault : @& Lean.Vir.Browser.Event -> IO Unit`
- `Lean.Vir.Browser.Event.stopPropagation : @& Lean.Vir.Browser.Event -> IO Unit`
- `Lean.Vir.Browser.Event.inputElement? : @& Lean.Vir.Browser.Event -> IO (Option Lean.Vir.Browser.HTMLInputElement)`
- `Lean.Vir.Browser.Event.inputValue? : @& Lean.Vir.Browser.Event -> IO (Option String)`
- `Lean.Vir.Browser.Event.inputChecked? : @& Lean.Vir.Browser.Event -> IO (Option Bool)`
- `Lean.Vir.Browser.Element.getTextContent : @& Lean.Vir.Browser.Element -> IO String`
- `Lean.Vir.Browser.Element.setTextContent : @& Lean.Vir.Browser.Element -> @& String -> IO Unit`
- `Lean.Vir.Browser.Element.getAttribute : @& Lean.Vir.Browser.Element -> @& String -> IO (Option String)`
- `Lean.Vir.Browser.Element.setAttribute : @& Lean.Vir.Browser.Element -> @& String -> @& String -> IO Unit`
- `Lean.Vir.Browser.Element.addEventListener : @& Lean.Vir.Browser.Element -> @& String -> (Lean.Vir.Browser.Event -> IO Unit) -> IO Lean.Vir.Browser.EventListener`
- `Lean.Vir.Browser.Element.removeEventListener : @& Lean.Vir.Browser.EventListener -> IO Unit`
- `Lean.Vir.Browser.HTMLInputElement.fromElement : @& Lean.Vir.Browser.Element -> IO (Option Lean.Vir.Browser.HTMLInputElement)`
- `Lean.Vir.Browser.HTMLInputElement.getChecked : @& Lean.Vir.Browser.HTMLInputElement -> IO Bool`
- `Lean.Vir.Browser.HTMLInputElement.setChecked : @& Lean.Vir.Browser.HTMLInputElement -> Bool -> IO Unit`
- `Lean.Vir.Browser.HTMLInputElement.getValue : @& Lean.Vir.Browser.HTMLInputElement -> IO String`
- `Lean.Vir.Browser.HTMLInputElement.setValue : @& Lean.Vir.Browser.HTMLInputElement -> @& String -> IO Unit`
- `Lean.Vir.Browser.Timer.setTimeout : UInt32 -> IO Unit -> IO Lean.Vir.Browser.Timeout`
- `Lean.Vir.Browser.Timer.clearTimeout : @& Lean.Vir.Browser.Timeout -> IO Unit`
- `Lean.Vir.Browser.Animation.requestAnimationFrame : (Float -> IO Unit) -> IO Lean.Vir.Browser.AnimationFrame`
- `Lean.Vir.Browser.Animation.cancelAnimationFrame : @& Lean.Vir.Browser.AnimationFrame -> IO Unit`

`Lean.Vir.React` provides the first React-specific imports and a narrow
recursive `Html` tree:

- `Lean.Vir.React.Root`
- `Lean.Vir.React.Html`
- `Lean.Vir.React.Property`
- `Lean.Vir.React.PropValue`
- `Lean.Vir.React.EventHandler`
- `Lean.Vir.React.Root.create : @& Lean.Vir.Browser.Element -> IO Lean.Vir.React.Root`
- `Lean.Vir.React.Root.createFromSelector : String -> IO (Option Lean.Vir.React.Root)`
- `Lean.Vir.React.Root.mountFromSelector : String -> (Lean.Vir.React.Root -> IO Unit) -> IO Bool`
- `Lean.Vir.React.Root.render : @& Lean.Vir.React.Root -> @& Lean.Vir.React.Html -> IO Unit`
- `Lean.Vir.React.Root.unmount : @& Lean.Vir.React.Root -> IO Unit`

`Html` uses the generic non-indexed custom-inductive and `recursiveSelf`
interface descriptors. Rendering retains any Lean event callbacks embedded in
the tree until the root is rerendered, unmounted, the package is reloaded, or
the runtime is disposed.

The intended v0 authoring surface is a small DOM-like helper set over that
recursive `Html` ABI:

- `Lean.Vir.React.Property.id`, `inputName`, `className`, `title`, `role`,
  `classList`, `ariaLabel`, `ariaHidden`, `data`, `dataTestId`, `tabIndex`,
  `style`, `type`, `htmlFor`, `inputValue`, `placeholder`, `autoComplete`,
  `maxLength`, `checked`, and `disabled`
- `Lean.Vir.React.EventHandler.onClick`, `onClickWith`, `onInput`,
  `onInputUnit`, `onChange`, `onChangeUnit`, `onSubmit`, and `onSubmitWith`
- `Lean.Vir.React.Html.div`/`keyedDiv`, `divWith`/`keyedDivWith`,
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
`EventHandler.onInput` and `onChange` receive the callback `Event`; use
`Event.inputValue?` when reading controlled text state and
`Event.inputChecked?` when reading controlled checkbox/radio state. Both check
`Event.currentTarget` first, then fall back to `Event.target`. Use the `*Unit`
variants for handlers that do not need the event.

`Property.string`/`bool`/`int`/`float`, `EventHandler.on`/`onUnit`, and
`Html.elementWith`/`keyedElementWith` are intentional escape hatches for the
small v0 surface. Prefer the named helpers above unless a demo needs a specific
scalar DOM prop, handler, or tag that is not blessed yet. `PropValue.style` and
`PropValue.classList` are intentionally constrained to the `style` and
`className` props by the host renderer.

The React browser fixtures are split by intent: `examples/ReactCounter.lean`
contains the counter, static render, lifecycle, and stress cases, while
`examples/ReactInput.lean` contains controlled text, change, submit,
attribute-conformance, and checkbox callbacks. `examples/Tamagotchi.lean`
keeps both demos: `Tamagotchi` is the non-React DOM-hosted version, and
`ReactTamagotchi` reuses the same model with a keyed React tree, controlled
text input, checkbox state, form submit handling, and action callbacks.

The standalone React HTML renderer status is tracked in `docs/REACT_HTML.md`.
Future ProofWidgets compatibility work is tracked separately in
`docs/REACT_PROOFWIDGETS_ROADMAP.md`.

The browser runtime bindings use standard browser APIs and require
`globalThis.document` for document calls. In non-browser runtimes, use
`lean-vir/vir-runtime-node` or pass explicit `hostBindings`; the Node wrapper
keeps virtual document and element state for the built-in browser APIs. Event
listener, timeout, animation-frame, and React root imports are also virtualized
for tests.

External references:

- [MDN `console.log`](https://developer.mozilla.org/en-US/docs/Web/API/console/log_static)
- [MDN `Document.title`](https://developer.mozilla.org/en-US/docs/Web/API/Document/title)
- [MDN `Document.querySelector`](https://developer.mozilla.org/en-US/docs/Web/API/Document/querySelector)
- [MDN `Node.textContent`](https://developer.mozilla.org/en-US/docs/Web/API/Node/textContent)
- [MDN `Element.getAttribute`](https://developer.mozilla.org/en-US/docs/Web/API/Element/getAttribute)
- [MDN `Element.setAttribute`](https://developer.mozilla.org/en-US/docs/Web/API/Element/setAttribute)
- [MDN `Event`](https://developer.mozilla.org/en-US/docs/Web/API/Event)
- [MDN `Event.target`](https://developer.mozilla.org/en-US/docs/Web/API/Event/target)
- [MDN `Event.currentTarget`](https://developer.mozilla.org/en-US/docs/Web/API/Event/currentTarget)
- [MDN `Event.preventDefault`](https://developer.mozilla.org/en-US/docs/Web/API/Event/preventDefault)
- [MDN `Event.stopPropagation`](https://developer.mozilla.org/en-US/docs/Web/API/Event/stopPropagation)
- [MDN `EventTarget.addEventListener`](https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/addEventListener)
- [MDN `EventTarget.removeEventListener`](https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/removeEventListener)
- [MDN `HTMLInputElement.checked`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLInputElement/checked)
- [MDN `HTMLInputElement.value`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLInputElement/value)
- [MDN `setTimeout`](https://developer.mozilla.org/en-US/docs/Web/API/setTimeout)
- [MDN `clearTimeout`](https://developer.mozilla.org/en-US/docs/Web/API/clearTimeout)
- [MDN `requestAnimationFrame`](https://developer.mozilla.org/en-US/docs/Web/API/window/requestAnimationFrame)
- [MDN `cancelAnimationFrame`](https://developer.mozilla.org/en-US/docs/Web/API/window/cancelAnimationFrame)
- [React `createRoot`](https://react.dev/reference/react-dom/client/createRoot)
- [React `root.unmount`](https://react.dev/reference/react-dom/client/createRoot#root-unmount)

## Example

```lean
import Lean.Vir.Browser

namespace HostInterop

def titleHandshake (label : String) : IO String := do
  let title := "Lean VIR host: " ++ label
  Lean.Vir.Browser.Document.setTitle title
  Lean.Vir.Browser.Document.getTitle

end HostInterop
```

This example is included in the stock host package. In the browser runner:

```text
dev.html?package=demo-host.irpkg&entry=HostInterop_titleHandshake
```

## Binding Contract

`@[vir_js "target.name"]` marks an `opaque` declaration as a package-scoped
JavaScript host import. The package generator records the Lean declaration,
JavaScript target, argument types, result type, effect, and trampoline slot in
the embedded manifest `hostImports` array.

The JavaScript runtime binds targets through `hostBindings`:

```js
const vir = await createVirRuntime({
  wasmUrl: "vir-upstream.wasm",
  irPackageUrl: "custom.irpkg",
  hostBindings: {
    "demo.bumpNat": (n) => (BigInt(n) + 1n).toString(),
  },
});
```

Bindings receive decoded JavaScript values and return a value matching the Lean
result type. `Unit` results should return `undefined` or `null`.

Lean function values in host-import arguments are supported as callbacks from
JavaScript into Lean. The JavaScript runtime roots the closure in the WASM shim,
passes a handle to the host binding, and releases it with `vir_closure_release`
when the host binding calls `callback.release()` or when the runtime is disposed.
JavaScript-provided function values are not accepted as Lean arguments in this
phase.

`Element.addEventListener`, `Timer.setTimeout`,
`Animation.requestAnimationFrame`, and `React.Root.render` use the callback ABI.
Event resources are valid only during the callback. Listener, timeout, frame,
and React root handles own their retained callbacks until removal,
cancellation, firing, rerender, unmount, package reload, or runtime disposal. See
`docs/EVENT_CALLBACK_ROADMAP.md` for the detailed ownership contract and
follow-up work.

## Current Surface

Supported host import signatures use the same v1 interface types as exported
entrypoints:

- `Unit`
- `Nat`, `Int`, `Bool`, `String`
- `UInt8`, `UInt16`, `UInt32`, `UInt64`, `USize`
- `ByteArray`
- `Array α`, `List α`, `Option α`, `α × β`, `Sum α β`, and `Except ε α` over
  supported types
- non-indexed user-defined structures and custom inductives with nullary or
  runtime-payload constructors
- nullary inductive enums
- opaque `Lean.Vir.Browser` and `Lean.Vir.React` resource handles
- Lean function values used as host callbacks
- `Lean.Expr`
- `Lean.Vir.React.Html` through the generic recursive custom-inductive surface

Imports may be pure functions or `IO α` actions. The v1 host boundary is
synchronous; returning a JavaScript `Promise` is an error. The current package
format supports up to 32 host imports with IR arity at most 6.

## Runtime Behavior

Host imports are not native extern registrations. The package generator encodes
them separately, the WASM shim maps them to finite trampolines, and the runtime
dispatches them through `env.vir_js_call`.

This keeps general native symbol lookup closed while allowing declarations in a
package to call explicitly declared JavaScript bindings.

## Troubleshooting

If package generation fails, inspect the generated report:

- `JavaScript Host Imports` should list the imported declarations and targets.
- `Interface Diagnostics` points out unsupported argument or result types.
- `Missing Native Extern Registrations` is unrelated to `@[vir_js]`; it means
  the normal Lean IR closure reached an unsupported native runtime primitive.

If a host import is missing at runtime, check that the manifest target string
matches the key in `hostBindings`. If a binding returns a `Promise`, the v1
runtime rejects the call because host imports are synchronous.
