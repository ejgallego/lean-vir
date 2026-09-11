# React

VIR binds native React values and operations for Lean-authored components.
Start here for component authoring; use [Infoview](INFOVIEW.md) to mount a
widget in the editor or call its Lean server. The [host contract](../reference/HOST_BINDINGS.md)
owns shared JavaScript identity and foreign-heap lifetime rules.

## Values and construction

`Js Node` is an actual React node, `Js ElementType` a native tag/component/type,
`Js Props` an ordinary object, and `Js.Array Node` an actual JavaScript array.
The binding receives those values unchanged; `React.createElement` decides
what to copy or retain. There is no VIR node graph or props protocol.

```lean
import Vir.React

open Lean.Vir.React

def greeting (name : String) : ReactM (Lean.Vir.Js Node) :=
  do
    let props ← Lean.Vir.Js.Object.empty
    Lean.Vir.Js.Object.set props
      (← Lean.Vir.JsValue.ofString "className")
      (← Lean.Vir.JsValue.ofString "greeting")
    let text ← Lean.Vir.JsValue.ofString s!"Hello, {name}"
    let children ← Lean.Vir.Js.Array.ofArray #[← Node.text text]
    let tag ← ElementType.tag (← Lean.Vir.JsValue.ofString "section")
    Node.createElement tag props children
```

`Node.createElement` accepts the exact element type, props object and JS child
array; the host spreads that array into React's variadic child arguments.
`ElementType.tag` and `Node.text` take exact JavaScript strings; convert Lean
strings explicitly with `JsValue.ofString`. `Node.fragment props children`
constructs a `React.Fragment` element with exact props and a JavaScript child
array, including an optional key in the props object.

### Lean HTML and JSX

Optional `Vir.ProofWidgets.Html` and `Vir.ProofWidgets.Jsx` provide Lean builders
and notation over these operations, not a serializable or alternate node tree.
`Html.ofComponent` passes `ComponentProps` containing props and child `Html`
actions to an ordinary Lean component function.

The [HTML fixture](../../fixtures/ProofWidgetsHtml.lean) and
[JSX fixture](../../fixtures/ProofWidgetsJsxSubset.lean) exercise tags, string and
interpolated attributes, text/child spreads, uppercase components, typed props,
keys and handlers. This native authoring facade is distinct from upstream's
[serialized `ProofWidgets.Html` protocol](INFOVIEW.md#optional-serialized-html).

## Components and roots

`Component.ofLean` converts a Lean render function into one ordinary JavaScript
function. That returned function is the React component type: reuse it to
preserve identity; creating a new function asks React to mount a different type.
Its callback receives `JSL props`; recover the Lean value explicitly with
`LeanRef.fromJSL`. `Node.component` accepts an explicitly boxed `JSL` props
object and places it under the native props object's `leanProps` field. Reuse
that box when props identity should stay stable. React owns invocation, hook
state, replay and keys.

`Root.create` returns the native `ReactDOMClient.createRoot` object.
`Root.render` calls its `render` method with the actual node. Construct that
node explicitly before submitting it.
Direct submissions need no VIR commit acknowledgement: React's JS graph keeps
callbacks and JSL values reachable, and superseded graphs can be collected.

Resolve and check the container explicitly before calling `Root.create`;
retain and reuse the returned root for updates. Root registration supports explicit
runtime teardown; failed publication of a newly created root rolls it back.
`Root.unmount` calls the native method before removing that registration, so a
failed unmount remains available for runtime cleanup. See
[active resources](../reference/HOST_BINDINGS.md#active-resources) for the lifecycle contract.

## Hooks, refs and events

Hooks receive exact JavaScript inputs and return React's chosen values.
`StateTuple.toState` and `ReducerTuple.toState` are explicit Lean projections of
the native result arrays, not alternative state implementations. State setters
and reducer dispatchers remain React's functions.

Convert Lean closures explicitly with `Reducer.ofLean`, `MemoCalculation.ofLean`
or `Callback.ofUnary`. `EffectCallback.ofLean` creates React's setup function
from a `{ setup, cleanup }` record. Pass that function to `Hooks.useEffect`;
a native function needs no conversion. This single public hook accepts optional
dependencies: omission calls React without a dependency argument, while
`some deps` passes the exact array, including an explicitly empty array.
The two native arity implementations are private.

Refs are the actual callback or `{ current }` object; React can write a DOM node
or `null` to `current`. Event props store the exact handler function and receive
the browser/React event unchanged. Event validity after a handler returns is
determined by that API, not by a VIR callback scope.

Purity, hook order, dependency completeness, effect discipline and replay-safe
reducers remain programmer responsibilities, just as in TypeScript React.
VIR keeps no speculative hook slots, action queues or dependency leases.

## Supported calls and gaps

This table describes selected call shapes, not full React coverage. The
[generated declarations](../../Vir/React/Generated.lean) and
[Lean composition and builders](../../Vir/React.lean) own exact signatures. The comparison
baseline is the [React 19.2 public reference](https://react.dev/reference/react).

| React operation | Lean surface and boundary |
| --- | --- |
| `createElement(type, props, ...children)` | `Node.createElement` takes exact type/props and a JS child array. Tag/text/JSX helpers perform explicit construction above it. |
| Function component | `Component.ofLean` creates the native function once; external component values can be passed as `Js ElementType`. |
| `Fragment` | `Node.fragment props children` takes exact props and a JS child array. |
| `createRoot(container, options?)` | `Root.create` selects an `Element` container and default options; other container types and root options are not exposed. |
| `root.render(node)` / `root.unmount()` | `Root.render` / `Root.unmount` call the native methods. |
| `useState(initial)` | Returns the exact state/setter array; `State.set` and `State.modify` offer value and functional-update conveniences. |
| `useReducer(reducer, initialArg, init?)` | Exact reducer, initial value and result tuple; the initializer overload is not exposed. |
| `dispatch(action)` | `ReducerDispatch.dispatch` passes the exact action. |
| `useRef(initial)` | Exact ref object; `Ref.get` / `Ref.set` access `current`. |
| `useEffect(setup, dependencies?)` | Exact setup function, with omitted or exact JS dependency array. Lean setup/cleanup conversion is separate. |
| `useMemo(calculate, deps)` | Exact calculation and dependency array; returns React's selected value. |
| `useCallback(fn, deps)` | Exact callback and dependency array; returns React's selected function. |
| `useContext(context)` | Exact consumer context; context creation/provider bindings are not exposed. |
| `useId()` | `Hooks.useId : ReactM (Js String)` returns React's exact accessibility ID, without string conversion or a VIR ID registry. |

Dependencies can contain arbitrary `Js` values; `DependencyList` helpers
explicitly build the JavaScript array. React compares its entries as usual.
Root options, reducer initialization and broader context/external-library
bindings are not exposed. External components use the host's React instance.

Use `useId` inside components for accessibility relationships, not list keys or
persistent application identities. The binding does not add hydration or root
options such as `identifierPrefix`.

## Host implementation and validation

`lean-vir/react-host-bindings` installs the official browser React/ReactDOM
providers separately from the generic runtime. The code in
[`web/src/react/`](../../web/src/react) calls public React APIs; it contains no
copied reconciler or hook implementation. Its extra JS implements explicit
Lean-function conversion, `leanProps` placement and browser-root lifecycle.
The [object ABI](../reference/OBJECT_ABI.md#externref-and-foreign-values) explains the Wasm
transport; it is not another React API.

Official React 19, ReactDOM and Chromium are the semantic oracle. The Node
wrapper installs no React or DOM implementation. Unit tests may inject a fake
root for registration/rollback tests, but do not establish React semantics.

The browser matrix checks exact value/ref identity, ref assignment and clearing,
Strict Mode effects, same-result memo updates, interleaved lanes, Suspense,
render/unmount and reused versus replaced component functions. The Lean/Wasm
`useId` fixture checks committed rerender stability, distinct IDs and accessible
label/input/description links across instances and roots, with and without
Strict Mode. Use the
[browser checks](../HARNESS.md#browser-smoke); editor/RPC behavior has
[separate real-server acceptance](../HARNESS.md#infoview-rpc-and-lifetime-checks).
