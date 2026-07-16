# Vir Library

`Vir.*` is the Lean-side module family for declarations that call back into the
JavaScript host while running through VIR's WASM interpreter. Those modules
expose APIs in the `Lean.Vir.*` namespace.

The library is built locally by:

```bash
npm run build:lean-lib
```

Package generation commands run that step automatically and add
`build/lean-lib` to `LEAN_PATH`, so local `.lean` sources can import the
modules below.

## User Workflow

For the built-in browser and common host imports, the Lean code is the only
piece users need to write. The JavaScript runtime already provides default
bindings for `common.*` and `browser.*` targets. Browser packages that call
`Lean.Vir.React.Root.*` or `Lean.Vir.React.Hooks.*` should also install the
bindings from `lean-vir/react-host-bindings`; the Node wrapper provides virtual
React bindings for tests. The JavaScript-side binding composition reference lives in
`docs/JS_API.md`.

1. Import the Lean module that provides the host import.

   ```lean
   import Vir.Browser
   ```

2. Write an exported Lean declaration that calls the host import.

   ```lean
   def titleHandshake (label : String) : Lean.Vir.Browser.DomM String := do
     let title := "Lean VIR host: " ++ label
     Lean.Vir.Browser.Document.setTitle title
     Lean.Vir.Browser.Document.getTitle
   ```

3. Generate a package with that declaration as a root.

   ```bash
   npm run generate:irpkg -- MyDemo.lean web/public/my-demo.irpkg titleHandshake
   ```

   The command builds `Vir.*`, adds `build/lean-lib` to `LEAN_PATH`, writes
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
import Vir.Browser

def mountButtonCallback : Lean.Vir.Browser.DomM Unit := do
  match ← Lean.Vir.Browser.Document.querySelector "#run" with
  | none => pure ()
  | some button =>
      let _listener ← Lean.Vir.Browser.Element.addEventListener
        button "click" fun _event => do
          Lean.Vir.Browser.Element.setTextContent button "clicked run"
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
import Vir.Js

@[vir_js "demo.bumpNat"]
opaque jsBumpNat (n : @& Lean.Vir.Js Nat) : Lean.Vir.RuntimeM (Lean.Vir.Js Nat)

def bumpViaJs (n : Nat) : Lean.Vir.RuntimeM Nat := do
  let input ← Lean.Vir.JsValue.ofNat n
  let output ← jsBumpNat input
  Lean.Vir.JsValue.toNat output
```

Generate a package with `bumpViaJs` as a root:

```bash
npm run generate:irpkg -- MyCustom.lean web/public/custom.irpkg bumpViaJs
```

Then provide the matching JavaScript binding when creating the runtime:

```js
const resources = createHostResourceState();
const vir = await createVirRuntime({
  wasmUrl: "vir-upstream.wasm",
  irPackageUrl: "custom.irpkg",
  defaultHostBindings: createBrowserHostBindings({ resources }),
  hostBindings: {
    "demo.bumpNat": (n) => resources.resourceForValue(resources.resolveResource(n, "JsNat") + 1n),
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

`Vir.Host` provides the low-level `@[vir_js "..."]` host-import attribute.

```lean
import Vir.Js

@[vir_js "demo.bumpNat"]
opaque jsBumpNat (n : @& Lean.Vir.Js Nat) : Lean.Vir.RuntimeM (Lean.Vir.Js Nat)
```

`Vir.Runtime` provides `Lean.Vir.RuntimeM`, the effect for
JavaScript-runtime operations that may
allocate or inspect `Lean.Vir.Js ...` resources or update runtime bookkeeping,
but do not themselves mutate the browser DOM or enter React root APIs. It is
narrower than raw `IO` and lifts into `DomM` and `ReactM`.

`Vir.Js` provides `Lean.Vir.Js α`, an opaque resource handle for
JavaScript-owned objects. The `α` parameter is a Lean-side phantom marker: while
the value remains inside `Js`, the runtime transports it as one host resource
and does not decode the underlying `α`. This is the intended lane for
polymorphic JavaScript object APIs that move objects around without inspecting
their Lean representation.

`Lean.Vir.LeanRef.toJSL`, `Lean.Vir.LeanRef.fromJSL`, and
`Lean.Vir.LeanRef.releaseJSL` are the generic handle lane for Lean-owned values
that JavaScript should store or route without decoding. They are backed by the
intrinsic `js.leanRef`, `js.leanRef.value`, and `js.leanRef.release`
object-handle imports. The JavaScript host retains the Lean object pointer
behind a `Lean.Vir.JSL α` resource, returns a fresh owned Lean pointer when the
value is unwrapped, and releases the retained pointer when the handle is
explicitly released or torn down with the runtime.
`JSL α` is an alias for `Js (LeanRef.Handle α)`, so `JSL String` is distinct
from a true JavaScript `Js String`. This avoids named structured `js.value.*`
conversion targets for state/action values that are only coordinated through
JavaScript.

`Vir.Js` also provides explicit scalar conversion helpers for JavaScript
state/resource values:

- `Lean.Vir.JsValue.ofString : @& String -> Lean.Vir.RuntimeM (Lean.Vir.Js String)`
- `Lean.Vir.JsValue.toString : @& Lean.Vir.Js String -> Lean.Vir.RuntimeM String`
- `Lean.Vir.JsValue.ofNat : Nat -> Lean.Vir.RuntimeM (Lean.Vir.Js Nat)`
- `Lean.Vir.JsValue.toNat : @& Lean.Vir.Js Nat -> Lean.Vir.RuntimeM Nat`
- `Lean.Vir.JsValue.ofBool : Bool -> Lean.Vir.RuntimeM (Lean.Vir.Js Bool)`
- `Lean.Vir.JsValue.toBool : @& Lean.Vir.Js Bool -> Lean.Vir.RuntimeM Bool`
- `Lean.Vir.JsValue.ofFloat : Float -> Lean.Vir.RuntimeM (Lean.Vir.Js Float)`
- `Lean.Vir.JsValue.toFloat : @& Lean.Vir.Js Float -> Lean.Vir.RuntimeM Float`

Top-level erased type parameters are allowed before runtime arguments in
host-import signatures. The package records how many leading erased parameters
the low-level trampoline must skip, while JavaScript receives only the
manifest-described runtime arguments. Polymorphic callback values are still not
supported; callbacks must have a concrete runtime signature. Exported Lean
entrypoints with erased type parameters are also unsupported for now; export a
concrete wrapper instead.

`Vir.Common` provides small host imports that are useful in browser and
Node-like environments:

- `Lean.Vir.Common.echoString : @& String -> Lean.Vir.RuntimeM String`
- `Lean.Vir.Common.addNat : Nat -> Nat -> Lean.Vir.RuntimeM Nat`

`Vir.Browser` provides the first browser-specific imports. DOM object names
such as `Lean.Vir.Browser.Element` and `Lean.Vir.Browser.Event` are object-class
markers; values at the boundary are `Lean.Vir.Js ...` handles. DOM-mutating or
DOM-reading APIs use `Lean.Vir.Browser.DomM`; it is the Lean-facing browser
effect and is recognized by the package generator as a synchronous host effect.
Use `DomM.run` only at an explicit exported `IO` boundary.

- `Lean.Vir.Browser.Console.log : @& String -> IO Unit`
- object markers: `Element`, `Event`, `EventListener`, `HTMLInputElement`,
  `HTMLCanvasElement`, `CanvasRenderingContext2D`, `Timeout`, and
  `AnimationFrame`
- `Lean.Vir.Browser.Document.getTitle : Lean.Vir.Browser.DomM String`
- `Lean.Vir.Browser.Document.setTitle : @& String -> Lean.Vir.Browser.DomM Unit`
- `Lean.Vir.Browser.Document.querySelector : @& String -> Lean.Vir.Browser.DomM (Option (Lean.Vir.Js Lean.Vir.Browser.Element))`
- `Lean.Vir.Browser.Document.createElement : @& String -> Lean.Vir.Browser.DomM (Lean.Vir.Js Lean.Vir.Browser.Element)`
- `Lean.Vir.Browser.Event.target : @& Lean.Vir.Js Lean.Vir.Browser.Event -> Lean.Vir.Browser.DomM (Option (Lean.Vir.Js Lean.Vir.Browser.Element))`
- `Lean.Vir.Browser.Event.currentTarget : @& Lean.Vir.Js Lean.Vir.Browser.Event -> Lean.Vir.Browser.DomM (Option (Lean.Vir.Js Lean.Vir.Browser.Element))`
- `Lean.Vir.Browser.Event.preventDefault : @& Lean.Vir.Js Lean.Vir.Browser.Event -> Lean.Vir.Browser.DomM Unit`
- `Lean.Vir.Browser.Event.stopPropagation : @& Lean.Vir.Js Lean.Vir.Browser.Event -> Lean.Vir.Browser.DomM Unit`
- `Lean.Vir.Browser.Event.inputElement? : @& Lean.Vir.Js Lean.Vir.Browser.Event -> Lean.Vir.Browser.DomM (Option (Lean.Vir.Js Lean.Vir.Browser.HTMLInputElement))`
- `Lean.Vir.Browser.Event.inputValue? : @& Lean.Vir.Js Lean.Vir.Browser.Event -> Lean.Vir.Browser.DomM (Option String)`
- `Lean.Vir.Browser.Event.inputChecked? : @& Lean.Vir.Js Lean.Vir.Browser.Event -> Lean.Vir.Browser.DomM (Option Bool)`
- `Lean.Vir.Browser.Element.getTextContent : @& Lean.Vir.Js Lean.Vir.Browser.Element -> Lean.Vir.Browser.DomM String`
- `Lean.Vir.Browser.Element.setTextContent : @& Lean.Vir.Js Lean.Vir.Browser.Element -> @& String -> Lean.Vir.Browser.DomM Unit`
- `Lean.Vir.Browser.Element.getAttribute : @& Lean.Vir.Js Lean.Vir.Browser.Element -> @& String -> Lean.Vir.Browser.DomM (Option String)`
- `Lean.Vir.Browser.Element.setAttribute : @& Lean.Vir.Js Lean.Vir.Browser.Element -> @& String -> @& String -> Lean.Vir.Browser.DomM Unit`
- `Lean.Vir.Browser.Element.appendChild` and `remove` provide basic DOM tree mutation.
- `Lean.Vir.Browser.Element.ClassList.add`, `remove`, and `toggle` update CSS classes; `Element.Style.setProperty` updates inline style properties.
- `Lean.Vir.Browser.Element.addEventListener : @& Lean.Vir.Js Lean.Vir.Browser.Element -> @& String -> (Lean.Vir.Js Lean.Vir.Browser.Event -> Lean.Vir.Browser.DomM Unit) -> Lean.Vir.Browser.DomM (Lean.Vir.Js Lean.Vir.Browser.EventListener)`
- `Lean.Vir.Browser.Element.removeEventListener : @& Lean.Vir.Js Lean.Vir.Browser.EventListener -> Lean.Vir.Browser.DomM Unit`
- `Lean.Vir.Browser.HTMLInputElement.fromElement : @& Lean.Vir.Js Lean.Vir.Browser.Element -> Lean.Vir.Browser.DomM (Option (Lean.Vir.Js Lean.Vir.Browser.HTMLInputElement))`
- `Lean.Vir.Browser.HTMLInputElement.getChecked : @& Lean.Vir.Js Lean.Vir.Browser.HTMLInputElement -> Lean.Vir.Browser.DomM Bool`
- `Lean.Vir.Browser.HTMLInputElement.setChecked : @& Lean.Vir.Js Lean.Vir.Browser.HTMLInputElement -> Bool -> Lean.Vir.Browser.DomM Unit`
- `Lean.Vir.Browser.HTMLInputElement.getValue : @& Lean.Vir.Js Lean.Vir.Browser.HTMLInputElement -> Lean.Vir.Browser.DomM String`
- `Lean.Vir.Browser.HTMLInputElement.setValue : @& Lean.Vir.Js Lean.Vir.Browser.HTMLInputElement -> @& String -> Lean.Vir.Browser.DomM Unit`
- `Lean.Vir.Browser.HTMLCanvasElement.fromElement`, `getWidth`, `setWidth`, `getHeight`, `setHeight`, and `getContext2D` narrow and configure canvas elements.
- `Lean.Vir.Browser.CanvasRenderingContext2D.clearRect`, `fillRect`, and `strokeRect` accept ordinary Lean `Float` coordinates.
- `Lean.Vir.Browser.CanvasRenderingContext2D.beginPath`, `closePath`, `moveTo`, `lineTo`, `arc`, `fill`, and `stroke` provide basic path drawing.
- `Lean.Vir.Browser.CanvasRenderingContext2D.setFillStyle`, `setStrokeStyle`, `setLineWidth`, `save`, `restore`, `translate`, and `rotate` configure drawing state and transforms.
- `Lean.Vir.Browser.Timer.setTimeout : UInt32 -> Lean.Vir.Browser.DomM Unit -> Lean.Vir.Browser.DomM (Lean.Vir.Js Lean.Vir.Browser.Timeout)`
- `Lean.Vir.Browser.Timer.clearTimeout : @& Lean.Vir.Js Lean.Vir.Browser.Timeout -> Lean.Vir.Browser.DomM Unit`
- `Lean.Vir.Browser.Animation.requestAnimationFrame : (Float -> Lean.Vir.Browser.DomM Unit) -> Lean.Vir.Browser.DomM (Lean.Vir.Js Lean.Vir.Browser.AnimationFrame)`
- `Lean.Vir.Browser.Animation.cancelAnimationFrame : @& Lean.Vir.Js Lean.Vir.Browser.AnimationFrame -> Lean.Vir.Browser.DomM Unit`

`Vir.React` provides the first React-specific imports and a native `ReactNode`
resource surface. React root lifetime operations and event callbacks use
`Lean.Vir.Browser.DomM`; JavaScript resource helpers and React state setters
use `Lean.Vir.RuntimeM`; `Lean.Vir.React.ReactM` is the narrower
render-construction effect for React component APIs and lifts `RuntimeM`.

- object marker: `Lean.Vir.React.Root`
- object marker: `Lean.Vir.React.ElementType`
- object marker: `Lean.Vir.React.StateSetter α`
- object marker: `Lean.Vir.React.Ref α`
- object marker: `Lean.Vir.React.Props`
- object marker: `Lean.Vir.React.NodeChildren`
- object marker: `Lean.Vir.React.DependencyList`
- `Lean.Vir.React.Node`
- `Lean.Vir.React.Property`
- `Lean.Vir.React.PropValue`
- `Lean.Vir.React.EventHandler`
- `Lean.Vir.React.Props.Entry`
- `Lean.Vir.React.State α`
- `Lean.Vir.React.ReducerState state action`
- `Lean.Vir.React.Component props := props -> Lean.Vir.React.ReactM (Lean.Vir.Js Lean.Vir.React.Node)`
- `Lean.Vir.React.ElementType.ofTag : @& String -> Lean.Vir.React.ReactM (Lean.Vir.Js Lean.Vir.React.ElementType)`
- `Lean.Vir.React.Node.text : @& String -> Lean.Vir.React.ReactM (Lean.Vir.Js Lean.Vir.React.Node)`
- `Lean.Vir.React.Node.createElement : @& Lean.Vir.Js Lean.Vir.React.ElementType -> Array Lean.Vir.React.Props.Entry -> Array (Lean.Vir.Js Lean.Vir.React.Node) -> Lean.Vir.React.ReactM (Lean.Vir.Js Lean.Vir.React.Node)`
- `Lean.Vir.React.Node.createElementTag : @& String -> Array Lean.Vir.React.Props.Entry -> Array (Lean.Vir.Js Lean.Vir.React.Node) -> Lean.Vir.React.ReactM (Lean.Vir.Js Lean.Vir.React.Node)`
- `Lean.Vir.React.Props.key : String -> Lean.Vir.React.Props.Entry`
- `Lean.Vir.React.Props.ref : Lean.Vir.Js (Lean.Vir.React.Ref (Lean.Vir.Js α)) -> Lean.Vir.React.Props.Entry`
- `Lean.Vir.React.Root.create : @& Lean.Vir.Js Lean.Vir.Browser.Element -> Lean.Vir.Browser.DomM (Lean.Vir.Js Lean.Vir.React.Root)`
- `Lean.Vir.React.Root.createFromSelector : String -> Lean.Vir.Browser.DomM (Option (Lean.Vir.Js Lean.Vir.React.Root))`
- `Lean.Vir.React.Root.mountFromSelector : String -> (Lean.Vir.Js Lean.Vir.React.Root -> Lean.Vir.Browser.DomM Unit) -> Lean.Vir.Browser.DomM Bool`
- `Lean.Vir.React.Root.render : @& Lean.Vir.Js Lean.Vir.React.Root -> Lean.Vir.React.ReactM (Lean.Vir.Js Lean.Vir.React.Node) -> Lean.Vir.Browser.DomM Unit`
- `Lean.Vir.React.Root.renderComponent : @& Lean.Vir.Js Lean.Vir.React.Root -> Lean.Vir.React.Component props -> props -> Lean.Vir.Browser.DomM Unit`
- `Lean.Vir.React.Root.unmount : @& Lean.Vir.Js Lean.Vir.React.Root -> Lean.Vir.Browser.DomM Unit`
- `Lean.Vir.React.Hooks.useState : @& Lean.Vir.Js α -> Lean.Vir.React.ReactM (Lean.Vir.React.State (Lean.Vir.Js α))`
- `Lean.Vir.React.Hooks.useReducer : (Lean.Vir.Js state -> Lean.Vir.Js action -> Lean.Vir.RuntimeM (Lean.Vir.Js state)) -> @& Lean.Vir.Js state -> Lean.Vir.React.ReactM (Lean.Vir.React.ReducerState state action)`
- `Lean.Vir.React.Hooks.useRef : @& Lean.Vir.Js α -> Lean.Vir.React.ReactM (Lean.Vir.Js (Lean.Vir.React.Ref (Lean.Vir.Js α)))`
- `Lean.Vir.React.Hooks.DependencyList.empty : Lean.Vir.React.ReactM (Lean.Vir.Js Lean.Vir.React.DependencyList)`
- `Lean.Vir.React.Hooks.DependencyList.push : @& Lean.Vir.Js Lean.Vir.React.DependencyList -> @& Lean.Vir.Js α -> Lean.Vir.React.ReactM Unit`
- `Lean.Vir.React.Hooks.DependencyList.ofArray : @& Array (Lean.Vir.Js α) -> Lean.Vir.React.ReactM (Lean.Vir.Js Lean.Vir.React.DependencyList)`
- `Lean.Vir.React.Hooks.useMemo : Lean.Vir.React.ReactM (Lean.Vir.Js α) -> @& Lean.Vir.Js Lean.Vir.React.DependencyList -> Lean.Vir.React.ReactM (Lean.Vir.Js α)`
- `Lean.Vir.React.Hooks.useMemoWithArrayDeps : Lean.Vir.React.ReactM (Lean.Vir.Js α) -> @& Array (Lean.Vir.Js β) -> Lean.Vir.React.ReactM (Lean.Vir.Js α)`
- `Lean.Vir.React.Hooks.useMemoWithStringDeps : Lean.Vir.React.ReactM (Lean.Vir.Js α) -> @& Array String -> Lean.Vir.React.ReactM (Lean.Vir.Js α)`
- `Lean.Vir.React.Hooks.useEffectWithDeps : @& Lean.Vir.Js Lean.Vir.React.DependencyList -> Lean.Vir.Browser.DomM (Lean.Vir.Js α) -> (@& Lean.Vir.Js α -> Lean.Vir.Browser.DomM Unit) -> Lean.Vir.React.ReactM Unit`
- `Lean.Vir.React.Hooks.useEffectWithStringDeps : @& Array String -> Lean.Vir.Browser.DomM (Lean.Vir.Js α) -> (@& Lean.Vir.Js α -> Lean.Vir.Browser.DomM Unit) -> Lean.Vir.React.ReactM Unit`
- `Lean.Vir.React.ReducerDispatch.dispatch : Lean.Vir.Js (Lean.Vir.React.ReducerDispatch state action) -> Lean.Vir.Js action -> Lean.Vir.RuntimeM Unit`
- `Lean.Vir.React.State.set : Lean.Vir.React.State (Lean.Vir.Js α) -> Lean.Vir.Js α -> Lean.Vir.RuntimeM Unit`
- `Lean.Vir.React.State.modify : Lean.Vir.React.State (Lean.Vir.Js α) -> (Lean.Vir.Js α -> Lean.Vir.RuntimeM (Lean.Vir.Js α)) -> Lean.Vir.RuntimeM Unit`

`Node` is an opaque JavaScript-owned renderable marker. Lean constructs values
with `Node.text` and `Node.createElement`; those public helpers explicitly
convert text through `JsValue`, build JavaScript-owned `Props`/`NodeChildren`
resources, and then call the low-level `react.node.*` host targets.
`Node.createElement` takes a JavaScript-owned `ElementType` resource, matching
React's `type` parameter; `Node.createElementTag` and DOM helpers explicitly
wrap ordinary tag strings with `ElementType.ofTag`. Browser hosts construct
native React nodes with `React.createElement` at that point. Rendering retains
any Lean event callbacks embedded in the resource graph until the root is
rerendered, unmounted, the package is reloaded, or the runtime is disposed.

`Root.render` is the host boundary for rendering a `ReactM` tree into an
existing root. The JavaScript host invokes the received render action to obtain
the concrete `Js Node` resource and releases that render callback after the
render attempt. `Root.renderComponent` wraps a Lean `Component props` plus
concrete props in a real JavaScript React function component. The public hook
surface is
resource-typed: `useState`, `State.set`, and `State.modify` accept
`Lean.Vir.Js α`, not raw Lean scalar values. Use the explicit
`Lean.Vir.JsValue` helpers when a component needs scalar state. State setters
are runtime-side calls to React setter resources, not DOM mutations. They are
typed JavaScript resources and must cross public signatures as `Lean.Vir.Js
(Lean.Vir.React.StateSetter α)`.

`Hooks.useReducer` keeps reducer state and actions in JavaScript-land. The
reducer receives `Lean.Vir.Js state` and `Lean.Vir.Js action` values and returns
the next `Lean.Vir.Js state`. Structured Lean-owned reducer values should use
`Lean.Vir.JSL` handles and explicit `Lean.Vir.LeanRef.toJSL` / `fromJSL` calls at
the application boundary, so React stores retained-Lean handles instead of
JavaScript-shaped copies.

```lean
Lean.Vir.React.State.modify count fun previous => do
  let value ← Lean.Vir.JsValue.toNat previous
  Lean.Vir.JsValue.ofNat (value + 1)
```

State value, updater-local, and scalar `JsValue` resource ownership is
documented in [HOST_BINDINGS.md](HOST_BINDINGS.md#resource-ownership-policy).

The intended v0 authoring surface is a DOM-like helper set over that `Js Node`
resource ABI: named property helpers, named event-handler helpers, and keyed
or unkeyed constructors for the currently blessed elements. The
generic scalar prop, event, and element helpers remain intentional escape
hatches for demos that need a DOM case not yet covered by the named surface.
`docs/REACT_NODE.md` is the canonical reference for helper names, prop
mappings, validation rules, callback ownership, and the JavaScript renderer
contract.

The React browser fixtures are split by intent: `examples/ReactCounter.lean`
contains the hook-backed counter, static render, lifecycle, and stress cases, while
`examples/ReactInput.lean` contains hook-backed controlled text, change,
submit, textarea/select, attribute-conformance, and checkbox callbacks.
`Vir.Examples.Tamagotchi` keeps the shared Tamagotchi implementation:
`Tamagotchi` is the non-React DOM-hosted version, and `ReactTamagotchi` reuses
the same model with a hook-backed keyed React tree, controlled text input,
checkbox state, form submit handling, and action callbacks.
`examples/Tamagotchi.lean` is the browser-demo wrapper, while
`examples/ReactTamagotchiWidget.lean` mounts the same `ReactTamagotchi.View`
component through the live infoview shell.
`examples/ReactProofWidget.lean` is the fuller proof-widget-shaped React
example. It compiles into `demo-host.irpkg`, displays on `react.html`, and can
also be loaded as a live infoview widget through `show_panel_widgets`.
`Vir.ProofWidgets.Html` adds the first shallow ProofWidgets-style authoring
facade over the same native React node ABI. `examples/ProofWidgetsHtml.lean`
uses `Html.text`, `Html.element`, `Html.ofComponent`, `Attr`, and `Handler`
aliases and is included in the host package as a compatibility regression.
`examples/ProofWidgetsJsxSubset.lean` ports a tiny upstream JSX-shaped pattern
with explicit combinators, including child-bearing `Html.ofComponent`, image
attributes, style attributes, child spread, and a `MarkdownDisplay`-shaped
component. `Vir.ProofWidgets.Rpc` adds the first narrow RPC-reference shape:
`RpcRef`, `WithRpcRef α`, `ResolvedRef`, `ExprWithCtx.save`, and
`Rpc.resolveRef` are enough for the JSX-subset fixture to include an
`InteractiveExpr`-shaped component whose click handler dispatches a
host-inspectable reference descriptor and updates component-owned React state
from the callback. The public RPC helpers keep accepting `RpcRef`, but their
low-level host targets receive `Js RpcRef` resources built by the
`proofwidgets.rpc.ref` host targets. Resolve callbacks receive
`Js ResolvedRef` resources and decode them through
`js.value.proofwidgets.resolvedRef.value` before running user callbacks. In live
infoview widgets,
`Vir.Infoview.ProofWidgetsRpc`
can resolve that expression-shaped descriptor as a fallback, and the live
infoview shell asks the Lean server to create a standard
`Lean.Server.WithRpcRef` handle for the current interactive goal at the cursor.
`Vir.Infoview.Surface` carries the live
`proofWidgetsExpr : Option (WithRpcRef ExprWithCtx)` prop, and the infoview
shell stores the server RPC handle as a typed `Js ServerRef` host resource
instead of serializing the handle through a string field.

The standalone React Node renderer status is tracked in `docs/REACT_NODE.md`.
Future ProofWidgets compatibility work is tracked separately in
`docs/REACT_PROOFWIDGETS_ROADMAP.md` and `docs/PROOFWIDGETS_PORTING.md`.

The `Vir.Infoview` module provides the first infoview-facing shell:

- `Lean.Vir.Infoview.Assets`
- `Lean.Vir.Infoview.Package`
- `Lean.Vir.Infoview.ProofWidgetsRpc`
- `Lean.Vir.Infoview.Widget`
- `Lean.Vir.Infoview.Surface`
- `Lean.Vir.Infoview.IRPackage`
- `Lean.Vir.Infoview.WidgetProps`
- `Lean.Vir.Infoview.ReactWidget`
- `vir_proof_widget`
- `Lean.Vir.Infoview.widget`

`Lean.Vir.Infoview.Clipboard.writeText` remains a public `String -> DomM Bool`
helper, but its low-level host target receives an explicit
`Lean.Vir.Js String` resource via `JsValue.ofString` and returns an explicit
`Lean.Vir.Js Bool` resource. The infoview command and proof-widget RPC command
helpers follow the same `Js Bool` result convention at the low-level host
boundary. `Lean.Vir.Infoview.Command.revealPosition` keeps its public
`DocumentPosition -> DomM Bool` shape, but first builds a `Js DocumentPosition`
with the `infoview.documentPosition` conversion target from explicit
`Js String` and `Js Nat` fields.

`WidgetProps` deliberately keeps one blessed activation path: the bundled
infoview runtime shell, a repo-local `wasmPath`, an `IRPackage` declaration, and
entry names. The package roots are built from the active Lean server snapshot.
The mount entry must have signature `String -> Surface -> DomM Bool`; the
optional unmount entry must have signature `String -> DomM Bool`. The shell
creates a nested mount element, passes its selector plus the current infoview
`Surface`, and rerenders the React component with fresh surface props on cursor
movement. It reloads the runtime service only when the widget IR package
revision changes. That revision token hashes the compiled IR closure and local
source ranges, so imported helper changes are detected once the active Lean
snapshot contains them.

`vir_proof_widget` is the narrow authoring helper for Lean-authored React proof
widgets: users provide a `React.Component Surface`, and the command declares the
standard selector-owned `mount`/`unmount` entries, `irPackage`, and
`widgetProps` in the current namespace. `ReactWidget` is the lower-level
expansion target when a caller needs to assemble those pieces manually.
`examples/ReactProofWidgetHello.lean` is the minimal live example and
`examples/ReactProofWidget.lean` is the fuller API showcase.
`node scripts/smoke-infoview-widget.mjs` checks that the shell module loads and
that the proof-widget entries have the required signatures.

The JavaScript runtime binding map, Node virtual-host behavior, cleanup hooks,
and external browser/React API references are documented in
`docs/HOST_BINDINGS.md`.

## Example

```lean
import Vir.Browser

namespace HostInterop

def titleHandshake (label : String) : Lean.Vir.Browser.DomM String := do
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
const resources = createHostResourceState();
const vir = await createVirRuntime({
  wasmUrl: "vir-upstream.wasm",
  irPackageUrl: "custom.irpkg",
  defaultHostBindings: createBrowserHostBindings({ resources }),
  hostBindings: {
    "demo.bumpNat": (n) => resources.resourceForValue(resources.resolveResource(n, "JsNat") + 1n),
  },
});
```

Host imports use an explicit JavaScript-resource boundary by default. Use
`Unit`, `Lean.Vir.Js α` resources, `Lean.Vir.Js.Nullable α` resources for
JavaScript `null`, or callback arguments whose own arguments/results are
`Unit` or resources. Nested callback arguments are rejected. Raw Lean scalars,
structures, arrays, lists, options, and products are rejected unless the target
is a built-in conversion primitive such as `js.nat.value` or
`js.value.react.property`. `Unit` results should return `undefined` or `null`.

Lean function values in host-import arguments are supported as callbacks from
JavaScript into Lean. The JavaScript runtime roots the closure in the WASM shim,
passes a callable `VirCallback` object to the host binding, and releases the
internal root with `vir_closure_release` when the host binding calls
`callback.release()` or when the runtime is disposed.
JavaScript-provided function values are not accepted as Lean arguments in this
phase.

`Element.addEventListener`, `Timer.setTimeout`,
`Animation.requestAnimationFrame`, and raw React Node rendering use the callback ABI.
Event resources are valid only during the callback. Listener, timeout, frame,
and React root resources own their retained callbacks until removal,
cancellation, firing, rerender, unmount, package reload, or runtime disposal. See
`docs/EVENT_CALLBACK_ROADMAP.md` for the detailed ownership contract and
follow-up work.

## Current Surface

Exported entrypoints support the current interface types:

- `Unit`
- `Nat`, `Int`, `Bool`, `String`
- `UInt8`, `UInt16`, `UInt32`, `UInt64`, `USize`
- `ByteArray`
- `Array α`, `List α`, `Option α`, `α × β`, `Sum α β`, and `Except ε α` over
  supported types
- non-indexed user-defined structures and custom inductives with nullary or
  runtime-payload constructors
- nullary inductive enums
- opaque `Lean.Vir.Js α` resources for JavaScript-owned objects, including
  browser and React object markers
- `Lean.Vir.Js.Nullable α` resources for JavaScript `null` values, with
  explicit `toOption`/`ofOption` helpers at the Lean API edge
- Lean function values used as host callbacks
- `Lean.Expr`
- `Lean.Vir.React.Node` as an opaque JavaScript-owned resource under
  `Lean.Vir.Js`

Imports may be pure functions or synchronous effect actions, but host imports
are narrower than exports: low-level host declarations should expose
`Lean.Vir.Js α` resources and perform scalar conversion through
`Lean.Vir.JsValue` or another explicit conversion target. JavaScript
resource/runtime APIs use `Lean.Vir.RuntimeM α`; DOM and React-root APIs use
`Lean.Vir.Browser.DomM α`; render construction APIs use `ReactM α`. The current
host boundary rejects raw Lean scalar, structure, array, list, option, and
product imports and is synchronous; returning a JavaScript `Promise` is an
error. The
current package format supports up to 128 host imports with IR arity at most 6.
Host-import metadata records both the low-level IR arity and the number of
leading erased type parameters skipped before JavaScript-visible arguments.
The JSON manifest also records each host import boundary as `hostResource`,
`explicitConversion`, or `objectHandle`, plus effect labels as `pure`, `runtime`, `io`,
`dom`, or `react`.

## Runtime Behavior

Host imports are not native extern registrations. The package generator encodes
them separately, the WASM shim maps them to finite trampolines, and the runtime
dispatches them through `env.vir_js_call_objects`.

This keeps general native symbol lookup closed while allowing declarations in a
package to call explicitly declared JavaScript bindings.

## Troubleshooting

If package generation fails, inspect the generated report:

- `JavaScript Host Imports` should list the imported declarations and targets.
- `Package Diagnostics` points out unsupported argument or result types.
- `Missing Native Extern Registrations` is unrelated to `@[vir_js]`; it means
  the normal Lean IR closure reached an unsupported native runtime primitive.

If a host import is missing at runtime, check that the manifest target string
matches the key in `hostBindings`. If a binding returns a `Promise`, the
runtime rejects the call because host imports are synchronous.
