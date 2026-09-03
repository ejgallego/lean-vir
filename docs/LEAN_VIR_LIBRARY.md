# Vir Library

`Vir.*` is the Lean-side module family for declarations that call back into the
JavaScript host while running through VIR's WASM interpreter. Those modules
expose APIs in the `Lean.Vir.*` namespace.

All shipped JavaScript host declarations are generated from the companion
`Vir/**/*.bindings.json` manifests. Browser properties and methods are lowered
directly from pinned TypeScript declarations where supported. VIR-owned or
ABI-special operations use structured reviewed protocol records in the same
manifests; each record identifies a named upstream adapter, a VIR-owned
operation, a local contract, or outstanding classification work. Generated
files live under `Vir/**/Generated.lean`; authored modules
contain reusable types and higher-level Lean APIs, but no host declarations.
The generator derives or records representation, passing, retention, result
ownership, and effect in a canonical operation IR; see
[BINDING_MODALITIES.md](BINDING_MODALITIES.md). Run
`npm run check:lean-bindings` to reject drift. These generated boundaries
preserve JavaScript resources; conversion to Lean-owned values is an explicit
caller-side choice.

The core library used by local package generation is built by:

```bash
npm run build:lean-lib
```

Package generation commands run that step automatically and add
`build/lean-lib` to `LEAN_PATH`, so local `.lean` sources can import the
core modules below. Build the optional infoview integration separately with
`lake build VirInfoview`; that target generates its JavaScript bundle and
requires the repository npm dependencies.

## Package Markers

`Vir.Attributes` provides the markers used by the Lake `:vir` module facet.
Importing `Vir` also imports these attributes.

- `@[vir_export]` selects a declaration for explicit JavaScript calls.
- `@[vir_startup]` selects a zero-argument, `Unit`-returning startup hook. A
  startup hook is also an export and carries `startup: true` in the interface
  manifest.

After Lean compiles a marked declaration, both attributes diagnose private or
non-executable declarations and conclusive blockers in the visible compiled
closure. `@[vir_export]` also rejects erased, implicit, and instance binders and
classifies its complete JavaScript interface, including compiled structure and
inductive layouts. `@[vir_startup]` enforces its complete zero-argument,
`Unit`-result contract immediately. Dependency diagnostics show the path from
the entrypoint to a missing IR declaration, unsupported runtime dependency
(including a missing native extern implementation), or initializer provider.

Opaque imported IR produces an informational diagnostic naming the required
compiled dependency instead of a false rejection. Postponed compilation
provides the option-level remedy needed to make IR available.
Package generation repeats the checks for raw marker metadata and remains
authoritative for generated boxed boundaries, package-wide conflicts, and
unresolved package dependencies.

`Vir.ExternFallback` provides the `vir_extern_fallback` command for an explicit
package-portability decision. It accepts transparent `@[extern] def`s, compiles
internal copies of their Lean reference bodies, and lets VIR package closure
resolution use those copies without changing ordinary native compilation.
Fallback bodies receive the same closure validation as other packaged Lean IR;
the command does not register native symbols or enable dynamic lookup. See
[LAKE_INTEGRATION.md](LAKE_INTEGRATION.md#opt-into-a-lean-extern-reference-body)
for the downstream syntax, restrictions, and ownership behavior.

After loading the generated package, JavaScript calls ordinary exports with
`vir.call(...)` and invokes startup hooks with `vir.runStartupEntries()`.
See [LAKE_INTEGRATION.md](LAKE_INTEGRATION.md) for the complete downstream Lake
workflow, including current module-boundary limitations and remediation.

## Local One-File Workflow

For the built-in browser and common host imports, the Lean code is the only
piece users need to write. The JavaScript runtime already provides default
bindings for `common.*` and `browser.*` targets. Browser packages that call
`Lean.Vir.React.Root.*` or `Lean.Vir.React.Hooks.*` should also install the
bindings from `lean-vir/react-host-bindings`; the Node wrapper provides virtual
document bindings and explicit unsupported React shims. The JavaScript-side binding composition reference
lives in [JS_API.md](JS_API.md). This section documents the repository-local
package generator; downstream Lake packages should prefer the facet workflow
above.

1. Import the Lean module that provides the host import.

   ```lean
   import Vir.Browser
   ```

2. Write an exported Lean declaration that calls the host import.

   ```lean
   def titleHandshake (label : String) : Lean.Vir.Browser.DomM String := do
     let title := "Lean VIR host: " ++ label
     let document ← Lean.Vir.Browser.Document.current
     Lean.Vir.Browser.Document.setTitle document (← Lean.Vir.JsValue.ofString title)
     Lean.Vir.JsValue.toString (← Lean.Vir.Browser.Document.getTitle document)
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
  irPackageSetBytes: [await fetchBytes("my-demo.irpkg")],
});

vir.call("titleHandshake", "browser handshake");
```

Browser event listeners use the same default bindings. The convenience call
creates an ordinary JavaScript function with `EventListener.ofLean`, passes it
unchanged to `Element.addEventListener`, and returns it so callers can later use
the same identity with `Element.removeEventListener`.

```lean
import Vir.Browser

def mountButtonCallback : Lean.Vir.Browser.DomM Unit := do
  let document ← Lean.Vir.Browser.Document.current
  match ← Lean.Vir.Browser.Document.querySelectorString document "#run" with
  | none => pure ()
  | some button =>
      let _listener ← Lean.Vir.Browser.Element.addEventListener
        button "click" fun _event => do
          let text ← Lean.Vir.JsValue.ofString "clicked run"
          Lean.Vir.Browser.Element.setTextContent button
            (← Lean.Vir.Js.Nullable.ofJs text)
      pure ()
```

Node tests and command-line tools may use the environment-neutral wrapper:

```js
import {
  createVirRuntime,
} from "lean-vir/vir-runtime-node";
```

That wrapper uses the same runtime and installs only environment-neutral
JavaScript value and console operations. It has no DOM or React model. Run
browser semantics in Chromium, or pass a focused external `hostBindings` map
when a non-browser test needs a particular operation.

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
const vir = await createVirRuntime({
  wasmUrl: "vir-upstream.wasm",
  irPackageSetBytes: [await fetchBytes("custom.irpkg")],
  hostBindings: {
    "demo.bumpNat": (n) => n + 1n,
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

`Vir.Host` provides the low-level `@[vir_js "..."]` host-import attribute. It
reports unsupported signatures and host-boundary types when Lean elaborates the
declaration; package generation repeats the same typed analysis as a final
fallback for raw extern metadata.

```lean
import Vir.Js

@[vir_js "demo.bumpNat"]
opaque jsBumpNat (n : @& Lean.Vir.Js Nat) : Lean.Vir.RuntimeM (Lean.Vir.Js Nat)
```

`Vir.Runtime` provides `Lean.Vir.RuntimeM`, the effect for
JavaScript-runtime operations that may allocate or inspect exact values carried
by `Lean.Vir.Js ...` or update runtime bookkeeping,
but do not themselves mutate the browser DOM or enter React root APIs. It is
narrower than raw `IO` and lifts into `DomM` and `ReactM`.

It also provides `Lean.Vir.RuntimeRef α`, a Lean-owned mutable cell for state
shared by callbacks. `RuntimeRef.new`, `get`, `set`, `modify`, and `modifyGet`
run in `RuntimeM`. Values replaced in a runtime ref follow normal Lean reference
counting. Stored `Js` values retain their exact JavaScript values through the
normal Lean external-object root; callers do not manually release DOM elements.

`Vir.Js` provides `Lean.Vir.Js α`, an opaque Lean handle for an exact
JavaScript value. The `α` parameter is a Lean-side phantom marker: while the
value remains inside `Js`, the runtime transports it through `externref` and
does not decode the underlying `α`. This is the intended lane for
polymorphic JavaScript object APIs that move objects around without inspecting
their Lean representation.

`Vir.Js` also provides typed JavaScript collection handles:

- `Lean.Vir.Js.Array α` represents a native JavaScript array whose indexed
  values have Lean-side view `α`.
- `Lean.Vir.Js.NodeList α` represents a DOM `NodeList` with the same element
  view convention.
- `Js.NodeList.toArray : Js.NodeList α -> RuntimeM (Js.Array α)` copies only
  the JavaScript container; its entries do not cross into a Lean array.
- `Js.Array.toLeanArray` and `Js.NodeList.toLeanArray` accept collections with
  element view `Js α` and return `Array (Js α)`. Each resulting handle has an
  independent lifetime, so it remains usable after the source collection is
  no longer reachable.

`Lean.Vir.LeanRef.toJSL` and `Lean.Vir.LeanRef.fromJSL` are the generic handle
lane for Lean-owned values that JavaScript should store or route without
decoding. They are backed by the intrinsic `js.leanRef` and `js.leanRef.value`
object-handle imports. The JavaScript host retains the Lean object pointer in
out-of-band state associated with the ordinary `Lean.Vir.JSL α` object and
returns a fresh owned Lean pointer when the value is recovered.
The payload is an ordinary self-owning JavaScript object. Lean and JavaScript
references follow their native reachability rules; there is no VIR-specific
retain/release protocol for JSL carriers. JavaScript collection releases the
retained Lean pointer when finalization is available; package/runtime teardown
always does so synchronously and invalidates the object.
`JSL α` is an alias for `Js (LeanRef.Handle α)`, so `JSL String` is distinct
from a true JavaScript `Js String`. This avoids named structured `js.value.*`
conversion targets for state/action values that are only coordinated through
JavaScript.

Hosts and frameworks store JSL values as ordinary JavaScript object references;
no VIR-specific per-container lease is required.

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

The generated [binding reference](SHIPPED_BINDINGS.md) is the exhaustive source
for browser declarations, exact signatures, upstream TypeScript links,
provider coverage, and binding-author actions. Run `npm run generate:bindings`
and open `build/bindings/index.html` to inspect the current checkout. This
overview records the intended shape without duplicating that generated
inventory:

- `Document` operations take an exact JavaScript receiver. `Document.current`
  separately retrieves the host-global document, and helpers ending in
  `String` perform explicit conversion from Lean-owned text without hiding
  receiver selection.
- `Element` exposes tree, query, content, attribute, listener, and exact
  `DOMTokenList` operations. `Element.ClassList` is a Lean convenience over the
  generated `Element.classList` and `DOMTokenList` boundaries.
- `ElementCSSInlineStyle.fromElement` checks the structural inline-style
  capability without changing identity. Its generated `style` getter returns
  the exact `CSSStyleDeclaration`; `CSSStyleDeclaration.setProperty` preserves
  the upstream `string | null` value.
- `Event` exposes exact `EventTarget | null` properties and propagation
  operations. `EventTarget.asElement` and `KeyboardEvent.fromEvent` perform
  checked identity-preserving narrowing; form helpers likewise make narrowing
  and string conversion explicit.
- `HTMLInputElement` and `HTMLCanvasElement` provide checked element narrowing.
  The canvas surface preserves exact context, text-metric, and style values.
- Timers, intervals, animation frames, and event listeners use private host
  teardown records for active effects. Their JavaScript tokens and values cross
  the public boundary directly.
- `Console.logJs` is the deliberately specialized single-JavaScript-string
  boundary with an exact `Js Console` receiver; `Console.current` separately
  retrieves the host-global console.

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
- object marker: `Lean.Vir.React.DependencyList`
- object markers: `Reducer`, `StateTuple`, `ReducerTuple`,
  `MemoCalculation`, `EffectCallback`, `Callback`, and `Context`
- `Lean.Vir.React.Node`
- `Lean.Vir.React.Property`
- `Lean.Vir.React.PropValue`
- `Lean.Vir.React.EventHandler`
- `Lean.Vir.React.Props.Entry`
- `Lean.Vir.React.State α`
- `Lean.Vir.React.ReducerState state action`
- `Lean.Vir.React.Component props` marks the exact reusable JavaScript function
  returned by `Component.ofLean`
- `Lean.Vir.React.ElementType.ofTag : @& String -> Lean.Vir.React.ReactM (Lean.Vir.Js Lean.Vir.React.ElementType)`
- `Lean.Vir.React.Node.text : @& String -> Lean.Vir.React.ReactM (Lean.Vir.Js Lean.Vir.React.Node)`
- `Lean.Vir.React.Node.createElement : @& Lean.Vir.Js Lean.Vir.React.ElementType -> @& Lean.Vir.Js Lean.Vir.React.Props -> @& Lean.Vir.Js.Array (Lean.Vir.Js Lean.Vir.React.Node) -> Lean.Vir.React.ReactM (Lean.Vir.Js Lean.Vir.React.Node)`
- `Lean.Vir.React.Node.createElementTag` is the explicit tag-string convenience over that exact binding
- `Lean.Vir.React.Props.key : String -> Lean.Vir.React.Props.Entry`
- `Lean.Vir.React.Props.ref : Lean.Vir.Js (Lean.Vir.React.Ref (Lean.Vir.Js α)) -> Lean.Vir.React.Props.Entry`
- `Lean.Vir.React.Root.create : @& Lean.Vir.Js Lean.Vir.Browser.Element -> Lean.Vir.Browser.DomM (Lean.Vir.Js Lean.Vir.React.Root)`
- `Lean.Vir.React.Root.createFromSelector : String -> Lean.Vir.Browser.DomM (Option (Lean.Vir.Js Lean.Vir.React.Root))`
- `Lean.Vir.React.Root.mountFromSelector : String -> (Lean.Vir.Js Lean.Vir.React.Root -> Lean.Vir.Browser.DomM Unit) -> Lean.Vir.Browser.DomM Bool`
- `Lean.Vir.React.Root.renderNode : @& Lean.Vir.Js Lean.Vir.React.Root -> @& Lean.Vir.Js Lean.Vir.React.Node -> Lean.Vir.Browser.DomM Unit`
- `Lean.Vir.React.Root.render : @& Lean.Vir.Js Lean.Vir.React.Root -> Lean.Vir.React.ReactM (Lean.Vir.Js Lean.Vir.React.Node) -> Lean.Vir.Browser.DomM Unit`
- `Lean.Vir.React.Component.ofLean : (props -> Lean.Vir.React.ReactM (Lean.Vir.Js Lean.Vir.React.Node)) -> Lean.Vir.RuntimeM (Lean.Vir.Js (Lean.Vir.React.Component props))`
- `Lean.Vir.React.Root.renderComponent : @& Lean.Vir.Js Lean.Vir.React.Root -> @& Lean.Vir.Js (Lean.Vir.React.Component props) -> props -> Lean.Vir.Browser.DomM Unit`
- `Lean.Vir.React.Root.unmount : @& Lean.Vir.Js Lean.Vir.React.Root -> Lean.Vir.Browser.DomM Unit`
- `Lean.Vir.React.Hooks.useState : @& Lean.Vir.Js α -> Lean.Vir.React.ReactM (Lean.Vir.Js (Lean.Vir.React.StateTuple (Lean.Vir.Js α)))`
- `Lean.Vir.React.Hooks.useReducer : @& Lean.Vir.Js (Lean.Vir.React.Reducer state action) -> @& Lean.Vir.Js state -> Lean.Vir.React.ReactM (Lean.Vir.Js (Lean.Vir.React.ReducerTuple state action))`
- `Lean.Vir.React.Hooks.useRef : @& Lean.Vir.Js α -> Lean.Vir.React.ReactM (Lean.Vir.Js (Lean.Vir.React.Ref (Lean.Vir.Js α)))`
- `Lean.Vir.React.Hooks.DependencyList.empty : Lean.Vir.React.ReactM (Lean.Vir.Js Lean.Vir.React.DependencyList)`
- `Lean.Vir.React.Hooks.DependencyList.push : @& Lean.Vir.Js Lean.Vir.React.DependencyList -> @& Lean.Vir.Js α -> Lean.Vir.React.ReactM Unit`
- `Lean.Vir.React.Hooks.DependencyList.ofArray : @& Array (Lean.Vir.Js α) -> Lean.Vir.React.ReactM (Lean.Vir.Js Lean.Vir.React.DependencyList)`
- `Lean.Vir.React.Hooks.useMemo` accepts an exact `Js MemoCalculation` and dependency array
- `Lean.Vir.React.Hooks.useCallback`, `useContext`, and `useEffect` accept their exact JavaScript values
- `Reducer.ofLean`, `MemoCalculation.ofLean`, and `Callback.ofUnary` are explicit Lean-callback conversions
- `StateTuple.toState` and `ReducerTuple.toState` are explicit tuple projections
- `EffectCallback.ofLean` explicitly converts Lean setup/cleanup actions to a
  native JavaScript effect function; `Hooks.useLeanEffect` composes it with the
  exact hook binding
- `Lean.Vir.React.ReducerDispatch.dispatch : Lean.Vir.Js (Lean.Vir.React.ReducerDispatch state action) -> Lean.Vir.Js action -> Lean.Vir.RuntimeM Unit`
- `Lean.Vir.React.State.set : Lean.Vir.React.State (Lean.Vir.Js α) -> Lean.Vir.Js α -> Lean.Vir.RuntimeM Unit`
- `Lean.Vir.React.State.modify : Lean.Vir.React.State (Lean.Vir.Js α) -> (Lean.Vir.Js α -> Lean.Vir.RuntimeM (Lean.Vir.Js α)) -> Lean.Vir.RuntimeM Unit`

`Node` is an opaque JavaScript-owned renderable marker. Lean constructs values
with `Node.text` and `Node.createElement`; convenience helpers explicitly
convert text through `JsValue`, build an ordinary JavaScript props object and
generic JavaScript child array, and then call the low-level `react.node.*`
host targets.
`Node.createElement` takes a JavaScript-owned `ElementType` resource, matching
React's `type` parameter; `Node.createElementTag` and DOM helpers explicitly
wrap ordinary tag strings with `ElementType.ofTag`. Browser hosts construct
native React nodes with `React.createElement` at that point. Rendering retains
the same object graph React would retain in JavaScript; VIR adds no parallel
node or callback ownership graph.

`Root.renderNode` is the faithful host boundary for borrowing a JavaScript-owned
React node. `Root.render` is a Lean convenience that evaluates the `ReactM`
construction action and calls `renderNode`; it introduces no additional host
target. `Component.ofLean` returns the real JavaScript function type, and
`Root.renderComponent` constructs an element from that exact value before
calling `renderNode`. The public hook surface is resource-typed: `useState`, `State.set`, and `State.modify` accept
`Lean.Vir.Js α`, not raw Lean scalar values. Use the explicit
`Lean.Vir.JsValue` helpers when a component needs scalar state. State setters
are runtime-side calls to React setter resources, not DOM mutations. They are
typed JavaScript resources and must cross public signatures as `Lean.Vir.Js
(Lean.Vir.React.StateSetter α)`.

`Hooks.useReducer` keeps reducer state and actions in JavaScript-land and takes
an exact `Js Reducer`. `Reducer.ofLean` explicitly converts a callback that
receives `Lean.Vir.Js state` and `Lean.Vir.Js action` values and returns the
next `Lean.Vir.Js state`. Structured Lean-owned reducer values should use
`Lean.Vir.JSL` handles and explicit `Lean.Vir.LeanRef.toJSL` / `fromJSL` calls at
the application boundary, so React stores retained-Lean handles instead of
JavaScript-shaped copies.

```lean
Lean.Vir.React.State.modify count fun previous => do
  let value ← Lean.Vir.JsValue.toNat previous
  Lean.Vir.JsValue.ofNat (value + 1)
```

State, updater, reducer, action, and scalar `JsValue` behavior is documented in
[HOST_BINDINGS.md](HOST_BINDINGS.md). These are the actual JavaScript values,
and the same purity, replay, and reachability responsibilities apply as in a
TypeScript React program.

The intended v0 authoring surface is a DOM-like helper set over that `Js Node`
resource ABI: named property helpers, named event-handler helpers, and keyed
or unkeyed constructors for the currently blessed elements. The
generic scalar prop, event, and element helpers remain intentional escape
hatches for demos that need a DOM case not yet covered by the named surface.
`docs/REACT_NODE.md` is the canonical reference for helper names, prop
mappings, validation rules, callback ownership, and the JavaScript renderer
contract.

The React browser fixtures are split by intent: `fixtures/ReactCounter.lean`
contains the hook-backed counter, static render, lifecycle, and stress cases, while
`fixtures/ReactInput.lean` contains hook-backed controlled text, change,
submit, textarea/select, attribute-conformance, and checkbox callbacks.
`Vir.Examples.Tamagotchi` keeps the shared Tamagotchi model and the flagship
`ReactTamagotchi.View`: a hook-backed keyed React tree with controlled text
input, checkbox state, form submit handling, timers, and action callbacks.
The browser page mounts that component as an application, while
`examples/ReactTamagotchiWidget.lean` mounts the same `ReactTamagotchi.View`
component through the live infoview shell.
`examples/ReactProofWidget.lean` is an infoview proof-action tool. It derives
common and hypothesis-specific tactics from the current goal and inserts the
selected tactic at the editor cursor.
`Vir.ProofWidgets.Html` adds the first shallow ProofWidgets-style authoring
facade over the same native React node ABI. `fixtures/ProofWidgetsHtml.lean`
uses `Html.text`, `Html.element`, `Html.ofComponent`, `Attr`, and `Handler`
aliases and is included in the host package as a compatibility regression.
`fixtures/ProofWidgetsJsxSubset.lean` ports a tiny upstream JSX-shaped pattern
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

The optional `Vir.Infoview` module is built with `lake build VirInfoview` and
provides the first infoview-facing shell:

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
`Lean.Vir.Js Bool` resource. This is the local synchronous
`InfoviewClipboardHost` capability, not a binding that claims the asynchronous
browser `Clipboard.writeText` contract. The infoview command and proof-widget RPC command
helpers follow the same `Js Bool` result convention at the low-level host
boundary. `Lean.Vir.Infoview.Command.revealPosition` keeps its public
`DocumentPosition -> DomM Bool` shape, but first builds a `Js DocumentPosition`
with the `infoview.documentPosition` conversion target from explicit
`Js String` and `Js Nat` fields.

`WidgetProps` deliberately keeps one blessed activation path: the bundled
infoview runtime shell, a repo-local `wasmPath`, an `IRPackage` declaration, and
entry names. The package roots are built from the active Lean server snapshot.
The component entry must have signature
`RuntimeM (Js (React.Component Surface))`; the mount entry must accept
`Js React.Root -> Js (React.Component Surface) -> Surface -> DomM Unit`. The
shell owns the official React root, creates the exact JavaScript component
function once per loaded runtime service, and passes those same values with the
current infoview `Surface` on every render. It unmounts the root before runtime
disposal and reloads the service only when the widget IR package revision
changes. That revision token hashes the compiled IR closure and local source
ranges, so imported helper changes are detected once the active Lean snapshot
contains them.

`vir_proof_widget` is the narrow authoring helper for Lean-authored React proof
widgets: users provide a `RuntimeM (Js (React.Component Surface))` factory, and
the command declares the standard `createComponent`, `mount`, `irPackage`, and
`widgetProps` entries in the current
namespace. `ReactWidget` is the lower-level expansion target when a caller
needs to assemble those pieces manually.
`examples/tutorials/ReactProofWidgetHello.lean` is the minimal live example and
`examples/ReactProofWidget.lean` is the next rung: a focused editor tool that
uses the goal surface and editor edit command without duplicating the infoview.
`node tests/infoview/widget.mjs` checks that the shell module loads and
that the proof-widget entries have the required signatures.

The JavaScript runtime binding map, external-host behavior, cleanup hooks,
and external browser/React API references are documented in
`docs/HOST_BINDINGS.md`.

## Example

```lean
import Vir.Browser

namespace HostInterop

def titleHandshake (label : String) : Lean.Vir.Browser.DomM String := do
  let title := "Lean VIR host: " ++ label
  let document ← Lean.Vir.Browser.Document.current
  Lean.Vir.Browser.Document.setTitle document (← Lean.Vir.JsValue.ofString title)
  Lean.Vir.JsValue.toString (← Lean.Vir.Browser.Document.getTitle document)

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
  irPackageSetBytes: [await fetchBytes("custom.irpkg")],
  hostBindings: {
    "demo.bumpNat": (n) => n + 1n,
  },
});
```

Host imports use an explicit JavaScript-resource boundary by default. Use
`Unit`, `Lean.Vir.Js α` resources, `Lean.Vir.Js.Nullable α` resources for
JavaScript `null`, or callback arguments whose own arguments/results are
`Unit` or resources. Nested callback arguments are rejected. Raw Lean scalars,
structures, arrays, lists, options, and products are rejected unless the target
is a built-in conversion primitive such as `js.nat.value`. `Unit` results
should return `undefined` or `null`.

Lean function values in host-import arguments are supported as callbacks from
JavaScript into Lean. The JavaScript runtime roots the closure in the WASM shim
and passes an ordinary callable function to the host binding. Private WeakMap
state associates the function with its closure root. Normal JavaScript
reachability keeps it alive; collection is a best-effort release backstop and
runtime disposal is the deterministic release boundary.
JavaScript-provided function values are not accepted as Lean arguments in this
phase.

`EventListener.ofLean`, `Timer.setTimeout`,
`Animation.requestAnimationFrame`, and raw React Node rendering use the callback ABI.
The underlying browser and React APIs determine event and callback validity;
VIR adds no callback scope. DOM listeners use native function-identity removal;
VIR-owned timeout, frame, and React-root registrations are explicitly
terminated on cancellation, firing, unmount, package reload, or runtime
disposal. See
[HOST_BINDINGS.md](HOST_BINDINGS.md) for the contract and the
[event callback roadmap](EVENT_CALLBACK_ROADMAP.md) for follow-up work.

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
