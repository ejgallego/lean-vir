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
functions, so convert a Lean closure explicitly with `Js.Function.ofLeanVoid`.
There are no per-attribute or per-tag helper catalogues.

In native object fields, native arrays and JSX attributes, `js#"text"` inserts
its conversion at that position: `js%{ "title" := js#"Hello" }`,
`js#[js#"Hello"]` and `<span title={js#"Hello"}/>` need no extra arrow.
Parentheses do not change this rule. Elsewhere it remains a `RuntimeM (Js String)`
action. Named property/array actions still require explicit `←`; only literal
syntax receives this treatment.

`js%{ "field" := value }` creates a fresh ordinary object and defines own data
properties in source order (last duplicate wins). Array literals and JSX use the
same own-property construction semantics, without invoking inherited setters.
Ordinary `Js.Object.set` and `Js.Array.push` remain native assignment/push operations.
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
still applies its normal props construction. Both attribute `{...props}` and
child `{...items}` spreads are rejected; insert native child arrays with `{items}`.
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
JSX still writes a fresh native object. Fields must be supplied unless their
projection is tagged `attribute [js_optional] LabelProps.title`. Such a field
may be omitted entirely (no property is written); if supplied, it must match
the declared type. Its `js_field%` read returns `Js.UndefinedOr String`.
A field declared `Js.UndefinedOr String` without the tag remains required;
explicit `undefined` and omission are distinct. Generic,
dependent and inherited schemas are outside this bounded surface. The special
`key` and `children` fields and `__proto__` are not supported schema fields.
Supply `key` separately, for example `<Label key={id} title="Hello"/>`: it accepts
native string/number/bigint keys, optionally null or undefined. React consumes it
as element metadata; it is not readable through the component's props schema.
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
existing native value unchanged. Supported shapes are `Node`, `String`,
`Float` (number), `Nat` (bigint), `Bool`, `Js.Undefined.Value`, and recursively
native arrays/nullable/undefined-or unions of these. Native `null`, `undefined`
and booleans render nothing; optional children need no empty/singleton arrays.
Arbitrary objects and `Js.Any` are not implicitly narrowed to nodes. A native array
occupies one child slot; JSX does not flatten it or add a fragment. Existing
child actions still run left-to-right and may return any supported native shape.
Lean arrays (including arrays of actions) are not JSX children.
Ordinary node-taking calls use the same closed membership rule:

```lean
def renderLabels (root : Js Root) (values : Js.Array String) : DomM Unit :=
  Root.render root values
```

`Root.render` accepts `Js α` with `[Node.Shape α]`; `Node.createElement`,
`Node.fragment` and `Node.functionComponent` accept native child arrays with that
element constraint. Otherwise unconstrained empty child arrays default to `Node`.
`Node.ofJs` remains an explicit inline identity when a `Js Node` value is needed.
The evidence is erased; casts make no host call and never copy or traverse arrays.
JSX uses the same rule. No global coercion is introduced.
This checks declared shapes, not foreign payloads
or later mutations through aliases. Promises and arbitrary iterables from the
broader TypeScript `ReactNode` union are not included in this subset.

Use native mapping directly:

```lean
def labels (values : Js.Array String) : ReactM (Js Node) := do
  let render ← Js.Function.ofLean3 fun (label : Js String) (_ : Js Float)
      (_ : Js.Array String) =>
    <span key={label}>{label}</span>
  return ← <div>{values.map render}</div>
```

`Js.Array.map` calls native `array.map(callback)` with an explicitly created
JavaScript function. `Js.Function.ofLean3` exposes `(value, index, source)`;
the index is `Js Float` and source is the original `Js.Array`. Unary callbacks
also work through an `Array.map`-specific type-only coercion, preserving the
original function. When the result type is not known from context, supply it:
`values.map (β := Node) render`. No general function-subtyping layer is implied.
The native operation skips holes and propagates callback exceptions; `thisArg`
is not exposed. No Lean array is constructed.
The mapping expression runs once at its child position. Keys and component
identity follow React's ordinary rules. For a fixed native array, use
`js#[first, second]`; execute construction actions explicitly inside it, such
as `js#[← <span key="first">First</span>, ← <span key="second">Second</span>]`.

`Html.text` explicitly converts Lean text. In a `do` block, use
`return ← <...>` for a final JSX expression to avoid Lean parsing `<` as comparison.

The [HTML fixture](../../fixtures/ProofWidgetsHtml.lean) and
[JSX fixture](../../fixtures/ProofWidgetsJsxSubset.lean) exercise tags, string and
interpolated attributes, native child arrays, uppercase components, typed props,
keys and handlers. This native authoring facade is distinct from upstream's
[serialized `ProofWidgets.Html` protocol](INFOVIEW.md#optional-serialized-html).

## Components and roots

`ReactM` is a transparent alias for `RuntimeM`, not a render-purity boundary.
Generic `Js.Function.ofLean` can therefore create JSX-returning callbacks.
`FunctionComponent.ofLean` remains an equivalent, component-specific spelling;
neither enforces hooks, purity or replay safety beyond what React enforces.

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
`Hooks.useState value` checks the closed `Initial.Accepts input state` relation.
Explicit `(α := S)` and contextual state types take precedence. Otherwise state
is inferred only from `Initial.ofValue value`, an existing `Initial.Value S`, or
a supported `Js.Function0 (Js S)` initializer. Only one function layer is removed.
For a plain value use `Hooks.useState (α := String) text` or
`Hooks.useState (Initial.ofValue text)`; generic `Js T` values follow the same rule.
There is no universal value fallback: it would silently misclassify unsupported
functions as stored state. Void-returning or argument-taking functions therefore
need an explicit state choice or a supported initializer returning the function.
This is deliberately less automatic than TypeScript inference.
For example, initialize Lean-backed state only when React calls the initializer:

```lean
let initializer ← Js.Function.ofLean0 (LeanRef.toJSL initialState)
let state ← Hooks.useState initializer
```

React can replay initializers in development Strict Mode. To store a native
function `handler`, pass an initializer returning it, such as
`Js.Function.ofLean0 (pure handler)`. `Initial.ofValue handler` does not protect
a function from React's initializer semantics. Nor does explicitly requesting
function-valued state: annotations change types, not React's callable test.
`Initial.ofValue` and `Initial.ofInitializer` remain explicit identity widenings
for generic code. There is no automatic thunk insertion or input conversion.

These constrained operations are direct generated host imports. Their leading
type and proof arguments are erased slots skipped by the host boundary, not
runtime dictionaries or JavaScript arguments. No forwarding functions are needed.

Bind native state/reducer tuple entries with `js#let` (in scope `Lean.Vir.Js`):

```lean
js#let (value, setter) ← Hooks.useState (α := Nat) initial
```

`js#let (value, setter) := tuple` also accepts an existing native tuple. Both
forms evaluate the source once, then call `Js.Tuple2.first` and `second` in
order, without constructing a Lean pair. This is indexed projection, not JS
iterator destructuring; custom iterators are not consulted.
Native bigint counters can use `Js.Nat.add` and interpolate the resulting
`Js Nat` directly in JSX, without decoding and re-encoding the count. This
preserves arbitrary precision; it does not produce a JSON number.
Invoke native functions with
`Js.Function.callVoid`. A state setter accepts `SetStateAction.ofValue value`
or `SetStateAction.ofUpdater update`: both are identity widenings of the native
value or function. Passing a function as a value still follows React's updater
semantics; to store a function, return it from an updater.

Convert Lean functions with the generic `Js.Function.ofLean0`, `ofLean2` and
`ofLeanVoid` operations for calculations, reducers and event callbacks.
An effect setup is a zero-argument function returning native `undefined` or a
zero-argument cleanup function. Construct the latter with `ofLean0Void`, close
over setup locals directly, and widen it with `Js.UndefinedOr.ofJs`; there is no
split setup/cleanup record or intermediate JSL payload. Native functions need
no conversion. The `Hooks.useEffect` dependency argument is
`Js.UndefinedOr React.DependencyList`, the native `DependencyList | undefined`
union, not a Lean `Option`. Pass `(← Js.UndefinedOr.undefined)` to run after
each commit, or `Js.UndefinedOr.ofJs deps` for the exact array. An empty array
does not request reruns on updates; development Strict Mode can replay setup.
`DependencyList` corresponds to TypeScript's `readonly unknown[]`; VIR uses the
native JS array shape, so callers must not mutate it while React retains it.
Construct dependency arrays directly with `js#[Js.erase value, ...]`, without
an intermediate Lean array.

For callback bodies using the opaque browser effect, `DomM.toRuntime` explicitly
views the browser action as a generic runtime action. It is an inline identity;
it does not schedule, wrap or execute the callback.

Refs are the actual callback or `{ current }` object; React can write a DOM node
or `null` to `current`. Event props store the exact handler function and receive
the React event unchanged, typed as `Js React.SyntheticEvent`, not
`Js Browser.Event`. `SyntheticEvent.nativeEvent` exposes the underlying DOM
event explicitly. `target`, `currentTarget`, `defaultPrevented`,
`preventDefault` and `stopPropagation` access the native React object directly.
The supported type is TypeScript's `SyntheticEvent<EventTarget, Event>`;
narrow an event target explicitly before accessing element-specific members.
As in TypeScript, read `currentTarget` during dispatch: React can clear it after
the handler returns. VIR does not extend event validity or retain a copy.

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
| `useState(initial)` | Closed membership with initializer-first default inference; explicit/contextual state types are preserved. The no-argument overload is not exposed. |
| `useReducer(reducer, initialArg, init?)` | `Hooks.useReducer` passes state directly; `Hooks.useReducerWithInit` passes the exact input and initializer. Both return the native tuple; the supported reducer takes one action. |
| `dispatch(action)` | `Js.Function.callVoid` passes the exact action to the native dispatch function. |
| `useRef(initial)` | Exact ref object; `Ref.get` / `Ref.set` access `current`. |
| `useEffect(setup, dependencies?)` | Exact setup function, with omitted or exact JS dependency array. Lean setup/cleanup conversion is separate. |
| `useMemo(calculate, deps)` | Exact calculation and dependency array; returns React's selected value. |
| `useCallback(fn, deps)` | Exact callback and dependency array; preserves the selected `Js.Function0`–`Js.Function3` signature, including value/void result. Closed `Js.Function.Shape` evidence excludes non-functions without adding a runtime wrapper. |
| `useContext(context)` | Exact consumer context; context creation/provider bindings are not exposed. |
| `useId()` | `Hooks.useId : ReactM (Js String)` returns React's exact accessibility ID, without string conversion or a VIR ID registry. |

Dependencies are native arrays of arbitrary `Js` values, constructed with
`js#[...]`. React compares their entries as usual.
Root options, reducer initialization and broader context/external-library
bindings are not exposed. External components use the host's React instance.

Use `useId` inside components for accessibility relationships, not list keys or
persistent application identities. The binding does not add hydration or root
options such as `identifierPrefix`.

## Host implementation and validation

`lean-vir/react-host-bindings` installs the official browser React/ReactDOM
providers separately from the generic runtime. The code in
[`web/src/react/`](../../web/src/react) calls public React APIs; it contains no
copied reconciler or hook implementation. Additional providers implement
application-data property access and browser-root lifecycle. Lean closure
conversion belongs to the generic function bridge, not a React effect adapter.
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
