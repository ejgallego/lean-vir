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
import Vir.React.Core

open Lean.Vir.React

def greeting (name : String) : ReactM (Lean.Vir.Js Node) :=
  do
    let props ← Lean.Vir.Js.Object.empty
    Lean.Vir.Js.Object.set props
      (← Lean.Vir.JsValue.ofString "className")
      (← Lean.Vir.JsValue.ofString "greeting")
    let text ← Lean.Vir.JsValue.ofString s!"Hello, {name}"
    let children ← Lean.Vir.Js.Array.empty
    let _ ← Lean.Vir.Js.Array.push children (← Node.text text)
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

Import `Vir.ProofWidgets.Jsx` and open its scope for native construction:

```lean
import Vir.ProofWidgets.Jsx
open Lean.Vir Lean.Vir.React
open scoped Lean.Vir.Js Lean.Vir.ProofWidgets.Jsx

def greeting (name : Js String) : ReactM (Js Node) := do
  let style ← js%{ "color" := js#"red" }
  return ← <section className="greeting" style={style}>Hello, {name}</section>
```

Attributes accept exact JS values; literal strings are converted once. Use
native names such as `aria-label` and `data-testid`. Events take native
functions, so convert a Lean closure explicitly with `Callback.ofUnary`.
There are no per-attribute or per-tag helper catalogues.

In native object fields and JSX attributes, `js#"text"` inserts its conversion
at that position: `js%{ "title" := js#"Hello" }` and
`<span title={js#"Hello"}/>` need no extra arrow. Outside these positions it
remains a `RuntimeM (Js String)` action. Named property actions still require
explicit `←`; this shorthand does not execute arbitrary property expressions.

`js%{ "field" := value }` expands to a fresh `Js.Object.empty` followed by
`Js.Object.set` assignments in source order (last duplicate wins).
Literal `__proto__` keys are rejected in objects and JSX because assignment
would invoke the inherited prototype setter. Explicit `Object.set` retains
ordinary JavaScript assignment semantics, including setters.
`js#[a, b]` pushes exact values into a fresh native array. Neither constructs
an intermediate Lean property record or array. Values require explicit
conversion; these notations do not inspect or encode arbitrary Lean data.

Uppercase JSX takes a native function component. Supply an already-typed
props object with `<Component @props={props}/>`; this must be the sole attribute.
`@props` is VIR's exact-object argument, not a field named `props` or JavaScript
object spread. It performs no copying or merging before calling React. React
still applies its normal props construction. Attribute `{...props}` is rejected;
child `{...items}` remains child iteration.
With an untyped `FunctionComponent Props`, attributes construct ordinary native
props. For a typed component, declare a flat structure whose fields are native
`Js` values and use it only as the props shape:

```lean
structure LabelProps where
  title : Js String

def Label : RuntimeM (FunctionComponent LabelProps) :=
  FunctionComponent.ofLean fun props => do
    Node.text (← js_field% props "title")
```

Given `let Label ← Label`, `<Label title="Hello"/>` checks field names, required
fields and value types at compile time. No `LabelProps` record is allocated:
JSX still writes a fresh native object. All fields must be supplied; generic,
dependent and inherited schemas are outside this bounded surface. The special
`key` and `children` fields and `__proto__` are not supported schema fields.
`js_field% props "title"` uses that declaration for one native property read;
it does not validate an external response, require an own property, or intercept
getters. As with typed JavaScript, untrusted inputs need an explicit check.

Only declared component schemas receive these field/type checks. Lowercase
DOM tags and `FunctionComponent Props` accept untyped native properties, not
TypeScript's per-element attribute types. A schema is a static contract, not
validation of an RPC reply or other external object.

JSX does not merge arbitrary typed props or box a Lean record.
Application-owned data uses explicit `Props.WithData.make (← LeanRef.toJSL data)`.

Native strings need not be decoded for display: use `Node.text value`.
`Node.text` and `ElementType.tag` only widen the native string's phantom type;
their construction actions make no host call.
`Js.String.length value` reads the native UTF-16 length as `Js Float`; convert
only that number when Lean control flow needs to test whether the text is empty.
This differs from counting Lean string characters.

`Html` is a deferred `ReactM (Js Node)`, not a serialized tree. Attributes
are evaluated before children. `{node}`, `{text}` and `{nodes}` insert an
existing `Js Node`, `Js String` or `Js.Array Node` unchanged. A native array
occupies one child slot; JSX does not flatten it or add a fragment. Existing
child actions still run left-to-right; `{...items}` runs a Lean array of child
actions for compatibility. Prefer native mapping when the input is already native:

```lean
def labels (values : Js.Array String) : ReactM (Js Node) := do
  let render ← FunctionComponent.ofLean fun (label : Js String) =>
    <span key={label}>{label}</span>
  let nodes ← Js.Array.map values render
  return ← <div>{nodes}</div>
```

`Js.Array.map` calls native `array.map(callback)` with an explicitly created
JavaScript function. Its typed surface selects a unary callback and omits
`thisArg`; the native operation still supplies index/source arguments, skips
holes and propagates callback exceptions. No Lean array is constructed.
Keys and component identity follow React's ordinary rules.

`Html.text` explicitly converts Lean text. In a `do` block, use
`return ← <...>` for a final JSX expression to avoid Lean parsing `<` as comparison.

The [HTML fixture](../../fixtures/ProofWidgetsHtml.lean) and
[JSX fixture](../../fixtures/ProofWidgetsJsxSubset.lean) exercise tags, string and
interpolated attributes, text/child spreads, uppercase components, typed props,
keys and handlers. This native authoring facade is distinct from upstream's
[serialized `ProofWidgets.Html` protocol](INFOVIEW.md#optional-serialized-html).

## Components and roots

`FunctionComponent.ofLean` converts a Lean render function into one ordinary JavaScript
function. That returned function is the React component type: reuse it to
preserve identity; creating a new function asks React to mount a different type.
Its callback receives native `Js props`. `Node.functionComponent` takes that
function, a matching native props object, and native child array. There is no
second component function wrapping the Lean callback. React owns invocation,
hook state, replay and keys.

For application-owned Lean data, explicitly box it with `LeanRef.toJSL`, then
construct `Props.WithData.make box`. Read `Props.WithData.data props` and use
`LeanRef.fromJSL` inside the component. React may copy the outer props object;
the nested box retains its exact identity. `WithData.children` returns the exact
React node (undefined, one child or an array), not an assumed child array.
Native panel props and ordinary native components need no `WithData` object.

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
a native function needs no conversion. Its dependency argument is
`Js.UndefinedOr React.DependencyList`, the native `DependencyList | undefined`
union, not a Lean `Option`. Pass `(← Js.UndefinedOr.undefined)` to run after
each commit, or `Js.UndefinedOr.ofJs deps` for the exact array. An empty array
does not request reruns on updates; development Strict Mode can replay setup.
`DependencyList` corresponds to TypeScript's `readonly unknown[]`; VIR uses the
native JS array shape, so callers must not mutate it while React retains it.

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
[native Lean composition](../../Vir/React/Core.lean) own exact signatures. The comparison
baseline is the [React 19.2 public reference](https://react.dev/reference/react).

| React operation | Lean surface and boundary |
| --- | --- |
| `createElement(type, props, ...children)` | `Node.createElement` takes exact type/props and a JS child array. Tag/text/JSX helpers perform explicit construction above it. |
| Function component | `FunctionComponent.ofLean` creates the native function once; external component values can be passed as `Js ElementType`. |
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
explicit application-data property access, effect conversion and browser-root lifecycle.
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
