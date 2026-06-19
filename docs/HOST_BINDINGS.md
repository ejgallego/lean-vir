# Host Bindings

This page documents the JavaScript side of Lean-to-JavaScript host imports.
The Lean declaration list is maintained in `docs/LEAN_VIR_LIBRARY.md`; the
runtime API overview stays in `docs/JS_API.md`.

Lean sources call synchronous JavaScript functions through declarations marked
with `@[vir_js "..."]`. Built-in `common.*` and `browser.*` targets are
installed by the browser runtime. Node tests and tools can use
`lean-vir/vir-runtime-node`, which installs virtual browser and React bindings.

## Built-In Targets

`Lean.Vir.Common.echoString` and `Lean.Vir.Common.addNat` map to `common.*`
helpers.

`Lean.Vir.Browser.Console.log` maps to `console.log`.

`Lean.Vir.Browser.Document.getTitle` and `setTitle` map to `document.title`.
`Document.querySelector` returns an opaque element resource, or `none`/`null`
when there is no matching element.

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

Browser `react.root.*` targets are provided by
`lean-vir/react-host-bindings`. With that entry installed, React roots map to
`ReactDOMClient.createRoot`, `root.render`, and `root.unmount`.
`react.node.text` and `react.node.createElement` construct `ReactNode` resources;
the browser binding uses `React.createElement`, while the virtual binding builds
test-visible virtual React nodes.
`react.root.renderComponent` wraps the thunk produced by Lean's
`Root.renderComponent root component props` API in a real React function
component. The hook binding `react.useState` is a render-time `ReactM`
operation. `react.state.set`, `react.state.modify`, and small `js.string`,
`js.nat`, and `js.bool` scalar helpers are `RuntimeM` operations over
`Lean.Vir.Js α` resources and share the same browser and virtual host resource
store as React roots. The scalar helpers let examples use primitive React state
without giving `react.useState` a scalar ABI.
`Root.render` accepts a `ReactM (Lean.Vir.Js Node)` tree. The
`react.root.render` host binding receives that render action as a releasable
callback, invokes it to obtain the concrete `Js Node` resource, renders the
resource, and releases the render callback.

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
import Vir.Host

@[vir_js "demo.bumpNat"]
opaque jsBumpNat (n : Nat) : Nat

def bumpFromJs (n : Nat) : Nat :=
  jsBumpNat n
```

Bind custom targets when constructing the runtime. User bindings override the
default `common.*` and `browser.*` bindings:

```js
const vir = await createVirRuntime({
  wasmUrl: "vir-upstream.wasm",
  irPackageUrl: "custom.irpkg",
  hostBindings: {
    "demo.bumpNat": (n) => (BigInt(n) + 1n).toString(),
  },
});

console.log(vir.call("bumpFromJs", 41)); // "42"
```

Bindings receive decoded JavaScript values and return a value matching the Lean
result type. `Unit` returns use `undefined` or `null`. Function-valued Lean
arguments are decoded as callable `VirCallback` objects. A host binding that
stores a callback must eventually call `callback.release()` or rely on
`VirRuntime.dispose()` to release any still-live callback roots. Host imports
are synchronous in v1; returning a `Promise` is an error.

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
- [MDN `requestAnimationFrame`](https://developer.mozilla.org/en-US/docs/Web/API/window/requestAnimationFrame)
- [MDN `cancelAnimationFrame`](https://developer.mozilla.org/en-US/docs/Web/API/window/cancelAnimationFrame)
- [React `createRoot`](https://react.dev/reference/react-dom/client/createRoot)
- [React `useState`](https://react.dev/reference/react/useState)
- [React `root.unmount`](https://react.dev/reference/react-dom/client/createRoot#root-unmount)
