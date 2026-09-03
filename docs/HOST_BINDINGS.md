# Host Bindings

This page documents the JavaScript side of Lean-to-JavaScript host imports.
The Lean declarations are listed in [LEAN_VIR_LIBRARY.md](LEAN_VIR_LIBRARY.md),
and the runtime facade is documented in [JS_API.md](JS_API.md).

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
| Function argument        | An ordinary JavaScript function backed by one Lean closure root | JavaScript callback into Lean.            |
| `Unit`                   | `undefined`                                                     | No result.                                |

Raw Lean scalars and structures are rejected on an ordinary host-import
boundary. Named declarations marked `@[vir_js_explicit_conversion "..."]`
are the explicit exception used by conversions such as `js.string.value`.
Exported Lean functions called from JavaScript use the separate structural
interface codec.

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

JSL objects and Lean callbacks require one unavoidable bridge because their
payload lives in the Lean heap.

`Lean.Vir.JSL α` is represented by an ordinary empty JavaScript object. Private
WeakMap state associates that object with one retained Lean pointer. The
object's finalizer releases the pointer after collection, and runtime disposal
releases it deterministically. There is no public `retain`, `release`, handle,
or wrapper API.

A Lean callback is represented by an ordinary JavaScript function. Private
WeakMap state associates the function with one closure root. JavaScript code
calls and stores it like any other function. Collection is a best-effort
release backstop; runtime disposal deterministically invalidates remaining
callbacks and releases their roots.

`FinalizationRegistry` scheduling is nondeterministic. Applications that need
deterministic cleanup dispose the VIR runtime. A callback invoked after its
runtime is disposed fails instead of entering freed Lean state.

## Active Resources

Explicit lifecycle bookkeeping is reserved for activities with a real
termination operation:

- timeouts and intervals;
- animation frames;
- React roots.

The shared `HostLifecycle` registers each active value together with its exact
cleanup function. Runtime disposal invokes those functions without inspecting
or guessing methods on the value. Terminal host operations remove their
registration before performing platform cleanup and are safe to repeat where
the platform API is repeatable.

Host calls are failure-atomic. Immediately before invoking a binding, the
runtime opens a private transaction. An active resource created by that call
registers an undo operation. The transaction commits only after the returned
JavaScript value has been completely lowered to Lean. If the binding throws,
returns a Promise, or result lowering fails, rollback terminates the newly
created activity. This transaction is out of band and does not alter the
returned value.

Custom binding maps may expose `[VIR_HOST_DISPOSE]()` for their own active
resources. Runtime teardown attempts every cleanup and reports multiple
failures as an `AggregateError`.

## Browser Bindings

The built-in groups closely follow their browser APIs:

- `browser.document.*` exposes the exact `Document` receiver, title,
  selectors, and element creation. The separate `browser.document.current`
  operation retrieves the host-global document;
- `browser.element.*` exposes queries, content, attributes, tree operations,
  classes, styles, and event listeners;
- `browser.event.*` exposes targets, keyboard keys, cancellation, and form
  values;
- `browser.htmlInputElement.*` and `browser.htmlCanvasElement.*` narrow and
  operate on the actual browser objects;
- `browser.canvas2d.*` forwards to the actual 2D context;
- `browser.timer.*` and `browser.animation.*` return the exact native scheduling
  tokens. VIR keeps only private cancellation records for interpreter teardown;
- `infoview.*` and `proofwidgets.rpc.*` connect the widget host.

Convenience conversions have separate Lean names. For example,
`Document.querySelector` accepts exact `Js Document` and `Js String` values,
while `querySelectorString` keeps the same explicit receiver and converts only
the Lean `String`. This keeps both conversion and ambient-global selection out
of the faithful low-level binding.

Event-listener registration passes the exact JavaScript listener function to
the native `addEventListener` method and returns `Unit`, just like the selected
upstream overload. Removal requires the same receiver, event name, and function
identity. `EventListener.ofLean` is separate conversion sugar that turns a Lean
closure into an ordinary self-owning JavaScript function; the DOM, not a VIR
registration handle, retains that function.

## React Bindings

The browser React host uses official React 19 and ReactDOM:

- props are actual JavaScript objects;
- child collections and dependency lists are actual arrays;
- `React.createElement` returns the actual React element;
- `useState`, `useReducer`, `useRef`, and `useMemo` return or store the values
  chosen by React;
- setter and dispatcher functions are React's functions;
- refs expose React's mutable `{ current }` object;
- roots are the objects returned by `ReactDOMClient.createRoot`.

VIR does not emulate hook state, render replay, reconciliation, lanes, or
commit semantics. Official React running in Chromium is the semantic oracle.

The Node virtual document remains useful for DOM-independent host tests, but
its React bindings are explicit cleanup-safe unsupported shims. Attempting to
construct nodes, roots, or use hooks there reports that the browser React host
is required.

The principal intentional React conveniences are:

- Lean builders for props, property descriptions, event-handler descriptions,
  and child arrays;
- `Component.ofLean`, which explicitly creates an ordinary reusable JavaScript
  component function whose identity React observes;
- `EffectCallback.ofLean`, which explicitly creates React's setup-function
  shape from a Lean setup/cleanup descriptor;
- `Root.render` and `Root.renderComponent`, which are Lean composition over
  node construction and the exact `Root.renderNode` boundary.

The conversions have declarations separate from the exact bindings. The React
hook host contains no Lean-specific hook path, and the React root host contains
no callback-render or component-render path. Direct `Root.renderNode` needs no
VIR acknowledgement for superseded submissions because React retains the exact
JavaScript node graph.

## Node Virtual Bindings

Use the Node wrapper for virtual document and event tests:

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
  irPackageSetBytes: [packageBytes],
  virtualDocumentState,
});
```

Virtual elements and events are plain JavaScript test doubles. Values returned
from one binding can be passed directly to another. Package replacement
disposes the previous generation's active lifecycle, but does not invalidate
ordinary JavaScript values merely because they were observed by that runtime.

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
  irPackageSetBytes: [packageBytes],
  hostBindings: {
    "demo.bumpNat": (n) => n + 1n,
  },
});
```

Bindings are synchronous. Returning a Promise is an error. User bindings
override built-ins with the same target name. Do not manually encode handles,
wrap values, or perform conversions that belong in an explicitly named Lean
adapter.

## Validation

Changes to the JavaScript-value boundary should cover:

- exact identity for objects, functions, arrays, `null`, and `undefined`;
- successful callback invocation and runtime-disposal invalidation;
- JSL and callback finalization as a best-effort backstop;
- active-resource completion, explicit cancellation, package replacement, and
  runtime disposal;
- failure after active-resource creation but before result publication;
- official React behavior in Chromium, including Strict Mode and Suspense.

Relevant commands include `npm run test:runtime`,
`npm run test:upstream:no-build`, and
`CHROMIUM=/path/to/chromium npm run test:pages:browser`.

## References

- [MDN WebAssembly reference types](https://developer.mozilla.org/en-US/docs/WebAssembly/Reference_types)
- [MDN `FinalizationRegistry`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/FinalizationRegistry)
- [MDN `EventTarget.addEventListener`](https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/addEventListener)
- [React `createElement`](https://react.dev/reference/react/createElement)
- [React `createRoot`](https://react.dev/reference/react-dom/client/createRoot)
- [React hooks](https://react.dev/reference/react/hooks)
