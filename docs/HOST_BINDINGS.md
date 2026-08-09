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
`Lean.Vir.Js α` resources, `Lean.Vir.Js.Nullable α` resources for JavaScript
`null`, and callbacks whose own arguments/results are `Unit` or resources.
Callbacks are accepted only as host-import arguments; nested callback arguments
are rejected. Public Lean wrappers can convert to or from ordinary Lean values with
`Lean.Vir.JsValue` and `Lean.Vir.Js.Nullable`.

Raw Lean scalar, structure, array, list, option, and product types are rejected
in ordinary host imports. The supported boundary lanes are:

| Lean type surface | Owner / shape | Import boundary | Use |
| --- | --- | --- | --- |
| `Lean.Vir.Js α` | JavaScript-owned host resource with phantom Lean shape | `hostResource` | Pass real JavaScript objects without decoding them in Lean. |
| `Lean.Vir.Js.Nullable α` | JavaScript-owned nullable resource | `hostResource` | Pass JavaScript `null`/value results without generic Lean `Option` lowering. |
| `Lean.Vir.JSL α` | JavaScript handle to a retained Lean-owned value | `objectHandle` | Let JavaScript store or route Lean values without structural conversion. |
| Explicit conversion declarations | One side `Lean.Vir.Js ...`, one side an ordinary Lean value | `explicitConversion` | Decode or encode values at named host bindings such as `js.string.value` or `js.value.react.property`. |
| Structural interface values | JavaScript caller to exported Lean entrypoints | descriptor-guided object lowering | Call public Lean functions from JavaScript without a host-import wrapper. |

The package manifest records each host import boundary as `hostResource`,
`explicitConversion`, or `objectHandle`, and the runtime dispatches them through
the corresponding path. Explicit conversion declarations use
`@[vir_js_explicit_conversion "..."]`. Both host-import attributes validate the
complete signature and boundary policy when Lean elaborates the declaration, so
unsupported implicit arguments, result types, effects, and conversion shapes are
reported at the attribute. Package generation repeats the same typed analysis as
a final guard for raw extern metadata, then checks package-only limits such as IR
arity and import slots. The JavaScript runtime still requires a matching host
binding for the declared target. The manifest also records structural descriptor
tags for exported Lean entrypoints; those tags belong to the interface
descriptors, not to the ordinary host-resource import boundary.

For host imports, the relevant descriptor family is:

| Descriptor | Ordinary `hostResource` import | Other accepted path |
| --- | --- | --- |
| `INTERFACE_TAG.UNIT` | Argument or result | `js.leanRef.release` result |
| `INTERFACE_TAG.RESOURCE` | Argument or result | Explicit conversions and `JSL` handles use the generic `Js` resource shape. |
| `INTERFACE_TAG.FUNCTION` | Argument only | Callback arguments/results must be `INTERFACE_TAG.UNIT` or `INTERFACE_TAG.RESOURCE`. |
| `INTERFACE_TAG.LEAN_OBJECT` | No | Only the `js.leanRef` / `js.leanRef.value` object-handle imports. |
| Structural descriptors such as `INTERFACE_TAG.NAT`, `INTERFACE_TAG.STRING`, `INTERFACE_TAG.ARRAY`, and `INTERFACE_TAG.STRUCTURE` | No | Only JavaScript-to-Lean exports or declarations marked with `@[vir_js_explicit_conversion]`. |

For example, a package can define a named conversion for a Lean structure when
the JavaScript host binding wants to inspect that structure and return a real
JavaScript resource:

```lean
structure Payload where
  name : String
  count : Nat

@[vir_js_explicit_conversion "test.payload"]
opaque payloadToJs (payload : @& Payload) :
  Lean.Vir.RuntimeM (Lean.Vir.Js Payload)
```

## Built-In Targets

`Lean.Vir.Common.echoString` and `Lean.Vir.Common.addNat` map to `common.*`
helpers through explicit `Lean.Vir.JsValue` conversions. The low-level
`common.*` JavaScript targets receive and return `Lean.Vir.Js α` resources;
the public Lean wrappers return ordinary Lean values in `RuntimeM`.

`Lean.Vir.Browser.Console.log` maps to `console.log`.

`Lean.Vir.Browser.Document.getTitle` and `setTitle` map to `document.title`.
`Document.querySelector` returns an opaque element resource, or `none`/`null`
when there is no matching element. `Document.querySelectorAll` returns the
browser's native static `NodeList` as
`Lean.Vir.Js.NodeList (Lean.Vir.Js Element)`. Lean code can inspect it with
`Js.NodeList.length` and `item`, copy it on the JavaScript side with
`Js.NodeList.toArray`, or explicitly materialize a Lean array of independent
element handles with `Js.NodeList.toLeanArray`. Dropping the list or copied
array does not invalidate element handles already obtained from it.
`Document.createElement` creates a browser element resource by tag name.
The public Lean browser APIs continue to expose ordinary `String`, `Bool`,
`UInt32`, and `Float` values where appropriate, but their low-level
`browser.*` host targets use explicit `Lean.Vir.JsValue` scalar resources.

`Lean.Vir.Browser.Element.*` targets query descendants, read and write text
content, attributes, and `innerHTML`, append and remove elements, update
`classList`, and set inline style properties through DOM element
properties/methods. Replacing `innerHTML` detaches the old descendant DOM nodes;
Lean callers should first replace any runtime state that holds handles to those
descendants. Event listener targets retain Lean closures until the listener is
removed or the runtime is disposed.

`Lean.Vir.Browser.HTMLCanvasElement.*` narrows canvas elements, reads and writes
their bitmap size, and obtains a 2D context. `browser.canvas2d.*` covers
rectangles, paths, fill/stroke styles, line width, save/restore, translation,
and rotation. One-shot float and string arguments use owned resources that the
receiving canvas or text binding consumes after the synchronous DOM call.

`Lean.Vir.Browser.Event.target` and `currentTarget` return element resources
when the event target is an element. `Event.key` returns the string-valued
keyboard key when present. `preventDefault` and `stopPropagation` forward to
the browser event object.

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
`Lean.Vir.Js ElementType`, `Lean.Vir.Js Props`, and
`Lean.Vir.Js NodeChildren` resources; `react.elementType.tag` wraps ordinary
DOM tag strings, and component bindings can provide `Js ElementType` resources
directly. Public Lean helpers convert ordinary strings with `JsValue` and
populate props/children with explicit `react.props.*` and
`react.node.children.*` calls. The browser binding uses `React.createElement`
and `React.Fragment`, while the virtual binding builds test-visible virtual
React nodes.
`react.root.renderComponent` wraps the thunk produced by Lean's
`Root.renderComponent root component props` API in a real React function
component. The hook bindings `react.useState`, `react.useRef`,
`react.useMemo`, `react.useReducer`, `react.useEffect`, and
`react.useEffectWithDeps` are render-time `ReactM` operations. `useRef` returns
a host-owned React ref object; `react.ref.get` and `react.ref.set` are
`RuntimeM` operations over its `current` field and do not schedule renders.
`useMemo` receives an explicit `Lean.Vir.Js DependencyList` and returns an
explicit `Lean.Vir.Js α` value. `useReducer` keeps the low-level React boundary
in `Js` resources, but VIR evaluates reducers once at dispatch time and sends
a concrete state value through `React.useState`; an effectful Lean reducer is
never installed as a React-replayable reducer function. Reducer state and actions are typed by their
JavaScript resource marker, so structured Lean-owned values use
`Lean.Vir.JSL state` and `Lean.Vir.JSL action` explicitly with
`Lean.Vir.LeanRef.toJSL`/`fromJSL` instead of `js.value.*` conversion targets.
A retained Lean string therefore does not typecheck as a JavaScript-shaped
`Js String`.
`react.useMemo` and `react.useEffectWithDeps` receive a
`Lean.Vir.Js DependencyList` built by `react.deps.empty` and
`react.deps.push`, so dependency arrays do not cross the host boundary through
generic array lowering.
Reducer callbacks are staged per render generation, transferred to their hook
slot only from a commit-phase layout effect, and released on replacement,
abandoned-generation collection, unmount, package reload, or runtime dispose.
`useEffect` currently has a resource shape: setup returns a
host resource, and cleanup receives the same resource at React's cleanup point.
The no-deps binding reruns after committed renders. `useEffectWithDeps` maps to
React's dependency-array form and compares the Lean-provided dependency list
with `Object.is`; each dependency crosses the low-level host boundary as an
explicit `Lean.Vir.Js α` resource. `useEffectWithStringDeps` is only a
convenience wrapper over explicit string conversion.
`react.state.set` and `react.state.modify` are `RuntimeM` operations over
`Lean.Vir.Js α` resources and share the same browser and virtual host resource
store as React roots. `modify` evaluates its Lean callback exactly once against
VIR's latest committed-or-queued value, then gives React the concrete result;
React never receives the Lean callback as a functional updater. The small
`js.string`, `js.nat`, `js.bool`, and `js.float` scalar
helpers are runtime-level `Lean.Vir.JsValue` bindings used by both common host
helpers and React state examples. They let examples use primitive state without
giving APIs such as `react.useState` a scalar ABI. `JsValue.ofFloat` and
`JsValue.toFloat` preserve every JavaScript number, including NaN, positive and
negative infinity, and the sign of zero.
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
  ensureVirtualElementStates,
} from "lean-vir/vir-runtime-node";

const virtualDocumentState = createVirtualDocumentState();
ensureVirtualElementState(virtualDocumentState, "#target");
ensureVirtualElementStates(virtualDocumentState, ".row", [
  { textContent: "first" },
  { textContent: "second" },
]);

const vir = await createVirRuntime({
  wasmBytes,
  irPackageSetBytes: [packageMemberBytes],
  virtualDocumentState,
});
```

Virtual `Document.querySelector` follows DOM semantics and returns `none`/`null`
for missing selectors. `Document.querySelectorAll` returns a static NodeList;
use `ensureVirtualElementStates` to seed every match for a selector.
Virtual elements accept a `queries` map for descendant
`Element.querySelector` and `querySelectorAll` results, plus an `innerHTML`
string. Setting inner HTML clears the descendant query map, mirroring
replacement of the old child tree.
`createVirtualElementState` and
`createVirtualEventState` construct resources for direct virtual callback
dispatch. `findVirtualReactElementById` and `virtualReactElementById` locate
rendered virtual React nodes by DOM-like `id` props.
`Document.createElement`, DOM tree/class/style mutation, and canvas targets are
browser-only today; Node tests for those calls should install browser-like
custom bindings or use a DOM implementation.

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
  irPackageSetBytes: [await fetchBytes("custom.irpkg")],
  defaultHostBindings: createBrowserHostBindings({ resources }),
  hostBindings: {
    "demo.bumpNat": (n) => resources.resourceForValue(resources.resolveResource(n, "JsNat") + 1n),
  },
});

console.log(vir.call("bumpFromJs", 41)); // "42"
```

Host imports are a JavaScript-resource boundary by default: use `Unit`,
`Lean.Vir.Js α` resources, `Lean.Vir.Js.Nullable α` for JavaScript `null`
semantics, and callback arguments whose own arguments/results are `Unit` or
resources.
Raw Lean scalars, structures, arrays, lists, options, and products are rejected
unless they are part of a built-in conversion target such as `js.nat.value` or
`js.value.react.property`. `Unit` returns use `undefined` or `null`.
Function-valued Lean arguments are decoded as callable `VirCallback` objects. A
host binding receives one transferable lease. It may store that lease for one
owner, or call `callback.retain()` to create distinct leases for independent
owners; every owner eventually calls `release()` on its own lease. Host imports
are synchronous; returning a `Promise` is an error. Callback ownership
transfers to the binding only when the complete host call, including result
conversion, succeeds. A failed argument conversion, throwing binding, Promise
result, or failed result conversion revokes the whole newly lifted callback
root, including leases the failed binding created from it.

## Resource Lifetime

`createHostResourceState()` returns the shared host-resource store used when
composing browser, React, timer, animation, and virtual binding groups. The
store stamps opaque `HostResource` wrappers with one runtime-generation owner,
validates them on every resolution, and owns active disposable host objects.
It does not strongly retain ordinary resource wrappers.
See [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md) for diagrams of the
`Lean.Vir.Js α` resource path and the separate `VirCallback` closure-root path.

### Resource Ownership Policy

`resourceForValue(value)` creates a fresh wrapper. Lean roots are classified as
borrowed or owned: dropping a borrowed argument root only removes that root,
while dropping an unclaimed owned host-result root also invokes the wrapper's
idempotent disposer. Lifting a result to JavaScript *takes* the owned root
before the result object is decremented, so the returned wrapper remains live
until its JavaScript owner releases it. Passive DOM elements, strings, numeric
values, `Js.Array`, and `Js.NodeList` have no payload disposer.

Retainable payloads compose through containers. `Js.Nullable`, React event
handler values, and React props builders acquire independent child leases and
release all children when abandoned. Ownership graphs reject cycles rather
than relying on cyclic reference counts. A container may safely acquire a
lease from a live runtime-created JSL wrapper even though that wrapper is not
owned by the container's `HostResourceState`. Result lifting is transactional:
arrays and structures roll back every callback/resource already lifted when a
later field fails.

Fresh wrappers deliberately avoid alias-invalidating-release semantics.
Bindings do not explicitly release passive arguments/results. Weak interning
may be added later as an allocation optimization, but it must not become a
lifetime owner.

Event listeners, timers, animation frames, and React roots are active owners,
not passive values. Their registrations remain in the store's strong owner
set until listener removal, timer/frame cancellation, root unmounting, or
runtime teardown. A returned Lean handle names the registration but is not
what keeps its activity alive. Selected active values use a weak reverse index
so explicit cancellation can invalidate every still-reachable wrapper without
making the index an owner.

Lean-owned object handles created by `js.leanRef` use the same `Js` resource
transport, but their payload is a lease over one retained Lean object pointer.
`Lean.Vir.LeanRef.retainJSL` creates a distinct lease over the same object;
`releaseJSL` invalidates only the supplied lease. Dropping an unclaimed Lean
external wrapper now releases that lease automatically; `releaseJSL` remains
the deterministic early-release API. The final lease release
decrements the Lean object, while package/runtime teardown force-invalidates
every remaining lease before decrementing it once. Rewrapping a JSL payload in
another host-resource store also acquires an independent lease instead of
sharing an alias-invalidating live/dead flag.

The built-in React state, reducer, ref, and memo bindings acquire their own JSL
leases whenever React starts storing a payload. Replacing state/ref/memo data,
consuming a reducer action, or unmounting the component releases the matching
React-owned lease. Callback-produced state and memo results transfer into that
ownership lane. A JSL handle retained by Lean remains independently owned by
Lean and can still be released deterministically with `releaseJSL`.

Some resources are callback-local rather than retained:

- DOM and React event objects are callback-scoped. The event resource is
  released after the Lean callback returns. Event targets and current targets
  may be returned as separate element resources by the event host bindings.
- `react.state.modify` runs its one-shot VIR updater in a temporary resource
  scope. The `previous : Lean.Vir.Js α` handle passed to the updater is
  callback-local. `Lean.Vir.JsValue` resources allocated while computing the
  updater result are consumed after the host extracts the next JavaScript state
  payload. Lean code must not retain those updater-local handles for later use.

`VirCallback` values follow a separate ownership lane. JavaScript receives a
callable lease around a rooted Lean closure. `callback.retain()` creates a
distinct callable lease; `release()` is idempotent per lease, and the Lean root
is released after its last lease. Built-in active owners acquire their own
lease and relinquish the incoming transfer lease, then release the owned lease
at their natural lifetime boundary. Package reload/runtime disposal
force-revokes any leases that remain.

Browser React render generations do not enter a strong runtime owner registry.
Nodes are inert until commit and use weak finalization only as a safety net.
Reducer/state/ref/node ownership swaps occur from a real `useLayoutEffect`
commit hook. Effect setup and cleanup use fresh per-invocation callback leases,
so React's development setup→cleanup→setup replay does not reuse a released
lease. The virtual renderer keeps its explicit immediate-commit behavior.

Finalizer failures cannot unwind through a WASM finalizer. Diagnostics retain
only bounded strings, not failed payloads, and ordinary teardown still
attempts every release before reporting one error or an `AggregateError`.

`vir.dispose()` tears down runtime-side host state:

- built-in browser bindings remove live event listeners, clear pending timers,
  cancel pending animation frames, unmount live React roots, and release
  retained callbacks;
- the resource generation is invalidated, so stale passive wrappers cannot be
  passed into later Lean calls;
- custom host binding maps can expose `[VIR_HOST_DISPOSE]()` or `dispose()` for
  their own cleanup;
- any callback roots still tracked by the runtime are force-revoked, marking
  every outstanding `VirCallback` lease released;
- any JSL cells still tracked by the runtime are force-revoked, marking every
  outstanding alias released before dropping the retained Lean object;
- later calls through `vir.call(...)`, `exportsByName`, or a callback fail with
  a disposed-runtime error.

Teardown first enters a disposing phase in which cleanup callbacks and host
imports remain usable. New active registrations are rejected and rolled back
immediately during this phase. Teardown disposes active owners and invalidates
the resource generation, releases reverse Lean references, then clears
externref roots and marks the runtime terminal. Every item is attempted even
when a disposer throws;
failures are reported directly or as an `AggregateError` in cleanup order.
Repeated disposal is a no-op. A disposed resource store is not reused by a new
runtime generation.

Calling `vir.loadIrPackageSetBytes(...)` on a runtime that already has a package
set loaded performs the same package-resource cleanup during fresh-instance
handover. If old-instance cleanup throws, the prepared candidate is discarded
and the public runtime is left disposed rather than half-switched.

## References

- [MDN `console.log`](https://developer.mozilla.org/en-US/docs/Web/API/console/log_static)
- [MDN `Document.title`](https://developer.mozilla.org/en-US/docs/Web/API/Document/title)
- [MDN `Document.querySelector`](https://developer.mozilla.org/en-US/docs/Web/API/Document/querySelector)
- [MDN `Document.querySelectorAll`](https://developer.mozilla.org/en-US/docs/Web/API/Document/querySelectorAll)
- [MDN `Element.querySelector`](https://developer.mozilla.org/en-US/docs/Web/API/Element/querySelector)
- [MDN `Element.querySelectorAll`](https://developer.mozilla.org/en-US/docs/Web/API/Element/querySelectorAll)
- [MDN `Element.innerHTML`](https://developer.mozilla.org/en-US/docs/Web/API/Element/innerHTML)
- [MDN `Node.textContent`](https://developer.mozilla.org/en-US/docs/Web/API/Node/textContent)
- [MDN `Element.getAttribute`](https://developer.mozilla.org/en-US/docs/Web/API/Element/getAttribute)
- [MDN `Element.setAttribute`](https://developer.mozilla.org/en-US/docs/Web/API/Element/setAttribute)
- [MDN `Event`](https://developer.mozilla.org/en-US/docs/Web/API/Event)
- [MDN `Event.target`](https://developer.mozilla.org/en-US/docs/Web/API/Event/target)
- [MDN `Event.currentTarget`](https://developer.mozilla.org/en-US/docs/Web/API/Event/currentTarget)
- [MDN `Event.preventDefault`](https://developer.mozilla.org/en-US/docs/Web/API/Event/preventDefault)
- [MDN `Event.stopPropagation`](https://developer.mozilla.org/en-US/docs/Web/API/Event/stopPropagation)
- [MDN `KeyboardEvent.key`](https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/key)
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
