# Host Bindings

This page documents the JavaScript side of Lean-to-JavaScript host imports.
The Lean declaration list is maintained in `docs/LEAN_VIR_LIBRARY.md`; the
runtime API overview stays in `docs/JS_API.md`.

Lean sources call synchronous JavaScript functions through declarations marked
with `@[vir_js "..."]`. Built-in `common.*` and `browser.*` targets are
installed by the browser runtime. Node tests and tools can use
`lean-vir/vir-runtime-node`, which installs virtual browser and React bindings.

## Boundary Rule

`@[vir_js]` is a JavaScript host boundary, not the same surface as an exported
Lean declaration called from JavaScript. Host imports should expose
`Lean.Vir.Js α` resources, resource-shaped containers, and callbacks whose
arguments/results follow that same rule. Public Lean wrappers can convert to or
from ordinary Lean values with `Lean.Vir.JsValue`.

Raw Lean scalar and structure types are rejected in ordinary host imports. The
only scalar-shaped host imports are explicit conversion targets such as
`js.string`, `js.string.value`, `js.nat`, `js.nat.value`, `js.bool`,
`js.bool.value`, `js.float`, and `js.float.value`. Structured values that
JavaScript must inspect use named conversion targets such as
`js.value.react.property`, `js.value.react.eventHandler`, and
`js.value.proofwidgets.resolvedRef.value`; `js.value.*` is not a wildcard
extension lane. Lean-owned values that JavaScript only stores or routes can use
the `js.leanRef` object-handle boundary. The package manifest records each
host import boundary as `wire`, `conversion`, or `objectHandle`, and the
runtime dispatches them through the corresponding path.

## Built-In Targets

`Lean.Vir.Common.echoString` and `Lean.Vir.Common.addNat` map to `common.*`
helpers through explicit `Lean.Vir.JsValue` conversions. The low-level
`common.*` JavaScript targets receive and return `Lean.Vir.Js α` resources;
the public Lean wrappers return ordinary Lean values in `RuntimeM`.

`Lean.Vir.Browser.Console.log` maps to `console.log`.

`Lean.Vir.Browser.Document.getTitle` and `setTitle` map to `document.title`.
`Document.querySelector` returns an opaque element resource, or `none`/`null`
when there is no matching element.
The public Lean browser APIs continue to expose ordinary `String`, `Bool`,
`UInt32`, and `Float` values where appropriate, but their low-level
`browser.*` host targets use explicit `Lean.Vir.JsValue` scalar resources.

`Lean.Vir.Browser.Element.*` targets read and write text content and attributes
through DOM element properties/methods. Event listener targets retain Lean
closures until the listener is removed or the runtime is disposed.

`Lean.Vir.Browser.Event.target` and `currentTarget` return element resources
when the event target is an element. `preventDefault` and `stopPropagation`
forward to the browser event object.

`Lean.Vir.Browser.HTMLInputElement.fromElement` narrows an element resource
before reading or writing `checked` and `value`.

Timer targets map to `setTimeout` and `clearTimeout`. Animation targets map to
`requestAnimationFrame` and `cancelAnimationFrame`, with a timer fallback in
non-browser environments.

Infoview command targets use the same explicit scalar resource convention.
`infoview.documentPosition` builds a host `Js DocumentPosition` resource from
`Js String`/`Js Nat` fields, and `infoview.command.revealPosition` receives
that resource and returns a `Js Bool` success value.
ProofWidgets RPC refs follow the same shape: public Lean code keeps the
`RpcRef` record, `proofwidgets.rpc.ref` builds a host `Js RpcRef` resource from
explicit scalar fields, and `proofwidgets.rpc.resolveRef` receives that
resource. Resolve callbacks receive a `Js ResolvedRef` resource and the public
Lean wrapper calls `js.value.proofwidgets.resolvedRef.value` to decode it
explicitly.

Browser `react.root.*` targets are provided by
`lean-vir/react-host-bindings`. With that entry installed, React roots map to
`ReactDOMClient.createRoot`, `root.render`, and `root.unmount`.
`react.node.text`, `react.node.createElement`, and `react.node.fragment`
construct `ReactNode` resources. Their low-level host targets receive explicit
`Lean.Vir.Js String` resources for text, tags, and keys; the public Lean
helpers convert ordinary strings with `JsValue`. The browser binding uses
`React.createElement` and `React.Fragment`, while the virtual binding builds
test-visible virtual React nodes.
`react.root.renderComponent` wraps the thunk produced by Lean's
`Root.renderComponent root component props` API in a real React function
component. The hook bindings `react.useState`, `react.useRef`,
`react.useReducer`, `react.useEffect`, and `react.useEffectWithDeps` are
render-time `ReactM` operations. `useRef` returns a host-owned React ref object;
`react.ref.get` and `react.ref.set` are `RuntimeM` operations over its
`current` field and do not schedule renders. `useReducer` keeps the low-level
React boundary in `Js` resources. Reducer state and actions are typed by their
JavaScript resource marker, so structured Lean-owned values use
`Lean.Vir.JSL state` and `Lean.Vir.JSL action` explicitly with
`Lean.Vir.LeanRef.toJs`/`fromJs` instead of `js.value.*` conversion targets.
A retained Lean string therefore does not typecheck as a JavaScript-shaped
`Js String`.
Reducer callbacks are retained per hook slot,
replaced after committed renders, and released on failed render, unmount,
package reload, or runtime dispose.
`useEffect` currently has a resource shape: setup returns a
host resource, and cleanup receives the same resource at React's cleanup point.
The no-deps binding reruns after committed renders. `useEffectWithDeps` maps to
React's dependency-array form and compares the Lean-provided dependency list
with `Object.is`; each dependency crosses the low-level host boundary as an
explicit `Lean.Vir.Js String` resource.
`react.state.set` and `react.state.modify` are `RuntimeM` operations over
`Lean.Vir.Js α` resources and share the same browser and virtual host resource
store as React roots. The small `js.string`, `js.nat`, `js.bool`, and `js.float` scalar
helpers are runtime-level `Lean.Vir.JsValue` bindings used by both common host
helpers and React state examples. They let examples use primitive state without
giving APIs such as `react.useState` a scalar ABI.
`Root.render` accepts a `ReactM (Lean.Vir.Js Node)` tree. The
`react.root.render` host binding receives that render action as a releasable
callback, invokes it to obtain the concrete `Js Node` resource, renders the
resource, and releases the render callback.
`react.root.renderIntoSelector`,
`react.root.renderComponentIntoSelector`, and `react.root.unmountSelector`
provide the proof-widget path: the JavaScript host owns and reuses the React
root for a selector, while Lean supplies either a `ReactNode` resource or a
function component render callback. The selector arguments are also explicit
`Lean.Vir.Js String` resources at the low-level host boundary, and boolean
success/failure results are returned as explicit `Lean.Vir.Js Bool` resources.

## Virtual Node Bindings

The Node wrapper provides virtual document and element state for tests/tools:

```js
import {
  createVirRuntime,
  createVirtualDocumentState,
  ensureVirtualElementState,
} from "lean-vir/vir-runtime-node";

const virtualDocumentState = createVirtualDocumentState();
ensureVirtualElementState(virtualDocumentState, "#target");

const vir = await createVirRuntime({
  wasmBytes,
  irPackageBytes,
  virtualDocumentState,
});
```

Virtual `Document.querySelector` follows DOM semantics and returns `none`/`null`
for missing selectors. `createVirtualElementState` and
`createVirtualEventState` construct resources for direct virtual callback
dispatch. `findVirtualReactElementById` and `virtualReactElementById` locate
rendered virtual React nodes by DOM-like `id` props.

## Custom Targets

Custom imports can be declared directly:

```lean
import Vir.Js

@[vir_js "demo.bumpNat"]
opaque jsBumpNat (n : @& Lean.Vir.Js Nat) : Lean.Vir.RuntimeM (Lean.Vir.Js Nat)

def bumpFromJs (n : Nat) : Lean.Vir.RuntimeM Nat := do
  let input ← Lean.Vir.JsValue.ofNat n
  let output ← jsBumpNat input
  Lean.Vir.JsValue.toNat output
```

Bind custom targets when constructing the runtime. User bindings override the
default `common.*` and `browser.*` bindings:

```js
const resources = createHostResourceState();
const vir = await createVirRuntime({
  wasmUrl: "vir-upstream.wasm",
  irPackageUrl: "custom.irpkg",
  defaultHostBindings: createBrowserHostBindings({ resources }),
  hostBindings: {
    "demo.bumpNat": (n) => resources.resourceForValue(hostResourceValue(n) + 1n),
  },
});

console.log(vir.call("bumpFromJs", 41)); // "42"
```

Host imports are a JavaScript-resource boundary by default: use `Lean.Vir.Js α`
resources, `Option`/`Array` containers of resources, and callback types whose
arguments/results follow the same rule. Raw Lean scalars and structures are
rejected unless they are part of a built-in conversion target such as
`js.nat.value` or `js.value.react.property`. `Unit` returns use
`undefined` or `null`. Function-valued Lean arguments are decoded as callable
`VirCallback` objects. A host binding that stores a callback must eventually
call `callback.release()` or rely on `VirRuntime.dispose()` to release any
still-live callback roots. Host imports are synchronous; returning a
`Promise` is an error.

## Resource Lifetime

`createHostResourceState()` returns the shared host-resource store used when
composing browser, React, timer, animation, and virtual binding groups. The
store owns opaque `HostResource` wrappers, liveness checks, and disposable host
objects; its `dispose()` method performs the built-in teardown.
See [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md) for diagrams of the
`Lean.Vir.Js α` resource path and the separate `VirCallback` closure-root path.

### Resource Ownership Policy

The default rule is retained ownership. A binding that calls
`resourceForValue(value)` creates or reuses a live `HostResource` wrapper that
remains valid until the binding-specific cleanup path releases it, the package
is reloaded, or the runtime is disposed. Object and function values are
interned by identity through a `WeakMap`; primitive values are interned by
value. Releasing a resource invalidates that wrapper, and the store only removes
an interned mapping when the released wrapper is the current mapping for that
JavaScript value.

Built-in retained resources include DOM elements, React roots, React state
setters, React node resources, event listeners, timers, and animation frames.
Their API cleanup is owned by the binding that created them: listener removal,
timer/frame cancellation, React root unmounting, React node callback release,
and final runtime/package teardown all go through the shared resource store.
Lean-owned object handles created by `js.leanRef` use the same `Js` resource
transport, but their payload is a retained Lean object pointer. The runtime
increments the object when creating the resource and decrements it when the
resource is released during package/runtime teardown.

Some resources are callback-local rather than retained:

- DOM and React event objects are callback-scoped. The event resource is
  released after the Lean callback returns. Event targets and current targets
  may be returned as separate element resources by the event host bindings.
- `react.state.modify` runs its functional updater in a temporary resource
  scope. The `previous : Lean.Vir.Js α` handle passed to the updater is
  callback-local. `Lean.Vir.JsValue` resources allocated while computing the
  updater result are consumed after the host extracts the next JavaScript state
  payload. Lean code must not retain those updater-local handles for later use.

`VirCallback` values follow a separate ownership lane. JavaScript receives a
callable wrapper around a rooted Lean closure. A host binding that stores the
callback must call `callback.release()` at its natural lifetime boundary, or
let package reload/runtime disposal release any remaining live callbacks.

### Deferred Ownership Questions

The current React scalar-state story is intentionally conservative and will
need a focused pass once the API and examples are more mature:

- `react.useState` currently returns its render-time `state.value` as a retained
  `Lean.Vir.Js α` resource. For scalar state, repeated renders can therefore
  retain wrappers for distinct primitive values until component unmount or
  runtime teardown.
- `react.state.set` consumes a `Lean.Vir.Js α` value as the next JavaScript
  state payload, but does not yet distinguish an owned temporary scalar wrapper
  from a retained handle. Examples that call `JsValue.ofString`, `ofNat`, or
  `ofBool` immediately before `State.set` may retain those scalar wrappers
  longer than necessary.
- `react.useReducer` avoids scalar wrapper state for structured reducer values
  when callers use `Lean.Vir.JSL` handles, but those handles are retained for
  the reducer lifetime and should still be covered by resource lifetime tests.
- A future cleanup should decide whether render-time state values and
  direct-set scalar values need a scoped borrowed/owned API, debug resource
  counters, or a small retain/release discipline instead of relying on runtime
  teardown.

`vir.dispose()` tears down runtime-side host state:

- built-in browser bindings remove live event listeners, clear pending timers,
  cancel pending animation frames, unmount live React roots, and release
  retained callbacks;
- opaque host resources retained by the built-in resource store are invalidated,
  so stale resource objects cannot be passed into later Lean calls;
- custom host binding maps can expose `[VIR_HOST_DISPOSE]()` or `dispose()` for
  their own cleanup;
- any `VirCallback` objects still tracked by the runtime are released;
- later calls through `vir.call(...)`, `exportsByName`, or a callback fail with
  a disposed-runtime error.

Calling `vir.loadIrPackageBytes(...)` on a runtime that already has a package
loaded performs the same package-resource cleanup before installing the new
manifest.

## References

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
- [MDN `setInterval`](https://developer.mozilla.org/en-US/docs/Web/API/setInterval)
- [MDN `clearInterval`](https://developer.mozilla.org/en-US/docs/Web/API/clearInterval)
- [MDN `requestAnimationFrame`](https://developer.mozilla.org/en-US/docs/Web/API/window/requestAnimationFrame)
- [MDN `cancelAnimationFrame`](https://developer.mozilla.org/en-US/docs/Web/API/window/cancelAnimationFrame)
- [React `createRoot`](https://react.dev/reference/react-dom/client/createRoot)
- [React `useState`](https://react.dev/reference/react/useState)
- [React `useReducer`](https://react.dev/reference/react/useReducer)
- [React `useEffect`](https://react.dev/reference/react/useEffect)
- [React `root.unmount`](https://react.dev/reference/react-dom/client/createRoot#root-unmount)
