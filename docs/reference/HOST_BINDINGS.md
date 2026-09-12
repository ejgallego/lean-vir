# Host Bindings

This page documents the JavaScript side of Lean-to-JavaScript host imports.
The Lean declarations are listed in [LEAN_VIR_LIBRARY.md](../guides/LEAN_VIR_LIBRARY.md),
and the runtime facade is documented in [JS_API.md](../guides/JS_API.md).

Lean calls a synchronous JavaScript function through a declaration marked
with `@[vir_js "..."]`. Browser builds install the common and browser binding
groups. React bindings are installed separately from
`lean-vir/react-host-bindings` so the generic runtime does not depend on React.

## Semantic Fidelity

The host binding receives the same JavaScript value that a TypeScript caller
would receive, and it returns the same value the corresponding JavaScript API
returns. VIR does not place resource, ownership-lease, or alias wrappers
around JavaScript values.

For example:

```js
hostBindings: {
  "demo.bumpNat": (value) => value + 1n,
  "demo.identity": (value) => value,
}
```

`value` in the second binding is the actual object. Returning it preserves
`Object.is` identity. The same rule applies to DOM nodes, React elements,
props objects, child arrays, dependency arrays, refs, callbacks, state values,
and reducer actions.

VIR does not impose guarantees that JavaScript or React does not impose. In
particular, Lean types do not make React components pure, make hook ordering
safe, or make dependency arrays complete. Those remain application
responsibilities exactly as in a TypeScript React program. Lean-friendly
operations that intentionally differ from an upstream JavaScript API must be
separately named and documented as adapters.

## Lean Boundary Types

Ordinary host imports use a deliberately narrow type surface:

| Lean type                | JavaScript value                                                | Purpose                                   |
| ------------------------ | --------------------------------------------------------------- | ----------------------------------------- |
| `Lean.Vir.Js α`          | The exact JavaScript value                                      | Phantom-typed JavaScript value.           |
| `Lean.Vir.Js.Nullable α` | The exact value or `null`                                       | Native nullable result or argument.       |
| `Lean.Vir.JSL α`         | An ordinary JavaScript object backed by one Lean root           | Store an opaque Lean value in JavaScript. |
| `Lean.Vir.Js.Function1 α β` | An exact ordinary JavaScript function                         | Native unary function with a phantom call shape. |
| Lean function argument   | An ordinary JavaScript function backed by one Lean closure root | Explicit callback conversion into Lean.   |
| `Unit`                   | `undefined`                                                     | No result.                                |

Raw Lean scalars and structures are rejected on an ordinary host-import
boundary. Named declarations marked `@[vir_js_explicit_conversion "..."]`
are the explicit exception used by conversions such as `js.string.value`.
Exported Lean functions called from JavaScript use the separate structural
interface codec.

`Js.Function1 argument result` does not wrap a function and VIR does not
dynamically inspect its TypeScript signature. `Js.Function.ofLean` and
`Js.Function.ofLeanVoid` are explicit conversions from Lean closures; native
functions such as React state setters already cross as `Js.Function1` values
and need no conversion. `Js.erase` similarly forgets only a phantom type and
returns the exact same JavaScript value as `Js.Any`.

Unknown values narrow through the polymorphic `Js.cast` operation. Its
`Js.Cast` instance selects a type-specific predicate and returns
`Except Js.TypeConvError (Js target)` in the instance's effect. The initial
browser `Element` instance delegates to one brand check that returns the exact
input on success. `Js.Object` is not the universal source type: JavaScript
primitives, `null`, and `undefined` erase to `Js.Any` as well.

Dynamic `Js.Object.get` reads a property once and returns `Js.Any`, including
native `undefined` for a missing property. A string key does not authorize an
arbitrary result phantom. Use a generated getter with an actual field contract,
or a narrow check before typed use. `Js.String.fromAny` accepts only primitive
strings and preserves the exact value; all other kinds, including boxed strings,
fail with `TypeError`. It does not coerce or decode/re-encode. In a native Promise
fulfillment callback, this check's failure rejects the resulting chain.

The package manifest currently calls the raw JavaScript-value lane
`hostResource`. That is a legacy ABI classification name, not a JavaScript
wrapper or public lifetime model. At runtime the lane transports the value
itself.

## Interpreter Transport

JavaScript values cross the C++/Wasm interpreter boundary through an
`externref` root table:

```text
exact JavaScript value
        │
        ▼
externref table slot  ◀── numeric root id ──▶  Lean external object
```

The root id is private transport. It is never presented to a host binding and
does not replace the JavaScript value with a handle object. A separate live-id
set makes every JavaScript value valid, including `null` and `undefined`.
Dropping the Lean external object releases its table slot.

## JavaScript Reachability

Ordinary composite values use the JavaScript object graph as their ownership
graph:

- a props object keeps its property values reachable;
- an array keeps its elements reachable;
- a React element keeps the graph React stores;
- a closure keeps values in its lexical environment reachable;
- returning or storing the same object does not create a VIR alias record.

VIR neither mirrors that graph nor tries to infer framework ownership from a
render, memo result, or commit. Consequently there is no resource cloning,
borrow/take distinction, payload graph, or per-hook lifetime ledger for
ordinary values.

## Lean-Backed JavaScript Values

JSL objects and converted Lean callbacks need bridge state because their payload
lives in the Lean heap. A JSL value is an ordinary empty JavaScript object with
one retained Lean pointer; a callback is an ordinary function with one closure
root. Private WeakMaps associate those values with their roots. There is no
public retain/release protocol, and native functions acquire no Lean lifetime.

A live value strongly retains its original runtime generation: the Wasm instance
and host state containing its Lean payload. Collection releases the foreign root
through a best-effort finalizer; explicit disposal releases it deterministically.
Calling a Lean callback after disposal fails before entering its Lean body.

Global finalization registries hold only weak references to cleanup records;
generation-owned sets keep those records available while the generation is live.
This includes the entire JSL cell and its `onRelease` closure. Otherwise global
metadata could anchor a runtime whose externref table points back to the targets.
A wholly unreachable generation can be collected without running every foreign
finalizer; this is not a collector for mixed Lean/JS cycles inside a runtime
still owned elsewhere.

Finalizer diagnostics store only bounded text, not error objects or failed
payload graphs that could keep Lean-backed values alive.

Intervals, listeners, Promise reactions and shared binding maps can retain their
callbacks and therefore a generation. Their owners remain responsible for
cancellation, removal and reference release. GC timing, released foreign roots
and Wasm memory/table capacity are different observations.

The shared binding-map lease counter is decremented by explicit teardown, not
by collection of an undisposed runtime. A retained factory/shared map can keep
an outstanding lease count and defer its last-owner disposer. Use explicit
disposal when deterministic shared-resource cleanup is needed; collection alone
does not establish that those resources were released.

## UI Cleanup Versus Runtime Disposal

Unmount owned React UI while its Lean cleanup callbacks are still usable.
After that, distinguish releasing UI ownership from shutting down the interpreter:

| Operation | Effect on the generation |
| --- | --- |
| Normal infoview unmount or mounted-generation refresh | Unmounts the owned root and detaches shell references; surviving callbacks/JSL remain usable in their original generation. |
| Explicit runtime disposal | Invalidates Lean callbacks/JSL and attempts all runtime-owned cleanup. |
| Core in-place package replacement | Invalidates old Lean roots; never moves them into the new exports. Public factory-managed replacement is described in [JS_API.md](../guides/JS_API.md#replacing-a-package-set). |

Normal shell cleanup detaches its loaded reference before unmount and surfaces
cleanup errors. Unmount stops shell polling; auto-refresh keeps its polling
effect. Obsolete load results cannot install UI. Refreshed services use fresh
factories and browser/React lifecycles, reusing compiled Wasm and the mutable
editor host context; the latter is not a frozen per-generation snapshot.
The separate React root receives that upstream `EditorContext` through a stable
per-service provider component; the inner component identity and nested prop
values are preserved. The shell does not implement notification subscriptions.

UI cleanup does not restrict new activity or cancel application-owned timers,
listeners, subscriptions or independent roots. Those still need application
cleanup. Failed setup, synchronous mount-entry failures and obsolete candidates
that were never installed retain hard teardown. The mount-entry catch does not
handle errors thrown later by React rendering.

## Active Resources

Explicit lifecycle bookkeeping is reserved for activities with a real
termination operation:

- timeouts and intervals;
- animation frames;
- React roots.

The shared `HostLifecycle` registers each active value together with its exact
cleanup function. Runtime disposal invokes those functions without inspecting
or guessing methods on the value. Timer and frame completion remove their
registration before invoking user code. Cancellation of a registered timer or
frame deactivates and detaches it before calling the platform cancellation
function. Explicit React-root unmount removes
its registration only after the platform unmount succeeds, so a failed unmount
remains visible to runtime teardown.

Each browser binding-factory invocation owns a fresh lifecycle unless the
caller explicitly supplies one. Package replacement can therefore dispose a
failed or superseded generation without invalidating the live generation.
Preconstructed binding maps are reference-counted only so intentional sharing
across an atomic replacement remains safe.

New lifecycle-managed resources are published transactionally. Before invoking a
binding, the runtime opens a private transaction. An active resource created by
that call registers an undo operation. The transaction commits only after the returned
JavaScript value has been completely lowered to Lean. If the binding throws,
returns a Promise for a non-resource result, or result lowering fails, rollback
terminates the newly created activity. A Promise declared as an exact `Js`
result is simply rooted and commits like any other JavaScript object. This
transaction is out of band and does not alter the returned value.

If argument lifting or the host call fails, callbacks created for that failed
call are released. A synchronous host exception is rethrown by the owning export
or callback call before any placeholder interpreter result is treated as success.

Custom binding maps may expose `[VIR_HOST_DISPOSE]()` for their own active
resources. Runtime disposal attempts every binding hook, active resource, Lean
handle, JSL cell and callback even if cleanup throws. One failure is rethrown
directly; multiple failures become an `AggregateError` in cleanup order.
Disposal is terminal and subsequent `dispose()` calls are no-ops.

## Browser Bindings

The built-in groups closely follow their browser APIs:

- `browser.document.*` exposes the exact `Document` receiver, title,
  selectors, and element creation. The separate `browser.document.current`
  operation retrieves the host-global document;
- `browser.element.*` exposes queries, content, attributes, tree operations,
  classes, styles, and event listeners;
- `browser.event.*` exposes exact `EventTarget | null` values, keyboard keys,
  cancellation, and form values; `browser.eventTarget.asElement` is separate
  checked identity-preserving narrowing;
- `browser.htmlInputElement.*` and `browser.htmlCanvasElement.*` narrow and
  operate on the actual browser objects;
- `browser.canvas2d.*` forwards to the actual 2D context;
- `browser.timer.*` and `browser.animation.*` return the exact native scheduling
  tokens. VIR keeps only private cancellation records for interpreter teardown;
- `infoview.*` connects the widget host, including its exact native RPC session.

Faithful bindings own the short operation names. For example,
`Document.querySelector` accepts exact `Js Document` and `Js String` values.
Callers convert Lean text with `JsValue.ofString` and nullable results with
`Js.Nullable.toOption` explicitly; there is no parallel call-and-convert API.

Canvas fill and stroke properties use the exact `Js CanvasStyle` union value.
`CanvasStyle.ofString` is the explicit conversion from Lean-owned text into
the union's string arm; callers pass that value directly to the faithful
generated property setter used for gradients and patterns.

Event-listener registration passes the exact JavaScript listener function to
the native `addEventListener` method and returns `Unit`, just like the selected
upstream overload. Removal requires the same receiver, event name, and function
identity. `EventListener.ofLean` is separate conversion sugar that turns a Lean
closure into an ordinary self-owning JavaScript function; the DOM, not a VIR
registration handle, retains that function.

DOM and React event objects likewise cross unchanged. VIR does not invalidate
an event when its callback returns; continued use follows the browser or
framework's own validity rules.

## React Bindings

The [React guide](../guides/REACT.md) owns component conversion, native values, hooks and
supported call shapes. Official React/ReactDOM in Chromium supplies semantics;
the host does not maintain an alternate hook or ownership model.

`createBrowserHostBindings` accepts its optional React bindings as a factory,
not as a preconstructed map. The browser host passes its one `HostLifecycle`
to that factory so React roots cannot be registered in a hidden independent
lifecycle.

## Non-browser Hosts

`lean-vir/vir-runtime-node` provides only environment-neutral JavaScript value
operations and console bindings. It deliberately has no built-in DOM model.
Applications that need a DOM outside a browser can use an external DOM implementation and
adapt its exact objects through `hostBindings`.

## Custom Targets

Declare the Lean boundary explicitly:

```lean
@[vir_js "demo.bumpNat"]
opaque jsBumpNat (n : @& Lean.Vir.Js Nat) :
  Lean.Vir.RuntimeM (Lean.Vir.Js Nat)
```

Then bind the exact JavaScript operation:

```js
const vir = await createVirRuntime({
  wasmBytes,
  irPackageSet: [packageBytes],
  hostBindings: {
    "demo.bumpNat": (n) => n + 1n,
  },
});
```

Bindings execute synchronously. Returning a Promise is allowed only as an
exact `Js` resource result; VIR roots the Promise object without awaiting it.
That exact-value path does not inspect `.then` or assimilate the result.
Returning a Promise for a structurally lowered or immediate result is an
error. User bindings override built-ins with the same target name.

## Validation

[HARNESS.md](../HARNESS.md#runtime-browser-and-analysis-work) lists the runtime and
browser checks. The [generation-lifetime](../HARNESS.md#generation-gc-and-mocked-shell-lifetime)
and [real-server](../HARNESS.md#infoview-rpc-and-lifetime-checks) suites cover
foreign-value collection, UI cleanup and hard disposal separately.

## References

- [MDN WebAssembly reference types](https://developer.mozilla.org/en-US/docs/WebAssembly/Reference_types)
- [MDN `FinalizationRegistry`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/FinalizationRegistry)
- [MDN `EventTarget.addEventListener`](https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/addEventListener)
- [React `createElement`](https://react.dev/reference/react/createElement)
- [React `createRoot`](https://react.dev/reference/react-dom/client/createRoot)
- [React hooks](https://react.dev/reference/react/hooks)
