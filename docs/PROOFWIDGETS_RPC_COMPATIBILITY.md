# ProofWidgets RPC Compatibility

This document compares the upstream RPC-backed component path with VIR's
current browser-native path. It is an implementation checklist, not a promise
that VIR will reproduce an upstream JavaScript helper internally.

The comparison was made against:

- ProofWidgets4 commit `a8acbfd87375ff4abe14ce09db5b7664d383bc7f`, in
  `ProofWidgets/Component/OfRpcMethod.lean` and `widget/src/ofRpcMethod.tsx`;
- vscode-lean4 commit `5a25e6abb2e973b4c89a053acc74c479c0bb2e9f`, in
  `lean4-infoview/src/infoview/rpcSessions.tsx` and
  `lean4-infoview-api/src/rpcSessions.ts`.

Browser acceptance uses the published official `@leanprover/infoview-api`
package pinned to `0.13.0`, with the repository's pinned Lean server and React.

## Upstream execution path

`mk_rpc_widget%` accepts a named server method of type:

```lean
Props → Lean.Server.RequestM (Lean.Server.RequestTask ProofWidgets.Html)
```

It produces a JavaScript widget module specialized with that method name. The
module calls the official `useRpcSession` hook, invokes
`RpcSessionAtPos.call(method, props, options)`, tracks the returned native
Promise through React state, cancels superseded work with `AbortController` or
the legacy cancellable protocol, and renders the serialized `ProofWidgets.Html`
with `HtmlDisplay`.

Those pieces have distinct ownership:

- React owns component, hook, effect, and rerender semantics.
- `RpcSessionAtPos` owns RPC-session behavior and registers server reference
  objects found in responses with its `FinalizationRegistry`.
- the native Promise owns its continuation functions while they are reachable.
- `AbortController` owns request cancellation.
- `ProofWidgets.Html` is a JSON/RPC-encoded server-to-browser tree.

## Compatibility matrix

| Concern | Upstream | VIR at this checkpoint | Required direction |
| --- | --- | --- | --- |
| React component | JavaScript widget-module export | Exact JavaScript function created from a Lean closure | Keep the exact component value; do not add a component registry. |
| RPC session | `useRpcSession(): RpcSessionAtPos` | `Surface.rpcSession` carries that exact object into VIR | Keep the position-specific session raw; do not add a session registry. |
| RPC call | `session.call(method, params, options)` | Direct `RpcSession.call` and `callWithOptions` bindings | Keep the session, request, options and Promise exact. |
| Async result | Native `Promise<S>` | Exact `Js.Promise S` with direct native `then` and `catch` operations over exact `Js.Function1` values | Preserve the Promise and callback objects; do not make the synchronous host dispatcher await either one. |
| Server references | Exact response objects registered by `RpcSessionAtPos` | Genuine `Server.WithRpcRef` response/reference round trip | Keep references exact; no descriptor resolver or separate retention store. |
| Request cancellation | Native `AbortController` passed through call options | Exact options forwarded to the official client; real LSP cancellation tested | Cancellation does not guarantee local rejection; callers must still suppress stale results. |
| Props encoding | `RpcEncodable` JSON object supplied to the JavaScript component | Lean values retained in JSL for browser-side rendering | Construct the exact JavaScript request object explicitly; do not treat JSL as JSON. |
| Returned HTML | Serialized upstream `ProofWidgets.Html` rendered by `HtmlDisplay` | `ProofWidgets.Html` is a direct `ReactM (Js React.Node)` action | Do not silently equate these types. Either use upstream `HtmlDisplay` for wire compatibility or return data and render it with the VIR-native API. |
| Error display | Promise rejection plus upstream `mapRpcError` | Exact native Promise rejection, including the server error | Preserve the rejection value first; presentation can be an explicit component helper. |

## Exact Promise boundary

VIR host imports still execute synchronously. A binding may now return a
native Promise only when its declared result is an exact `Js` resource. In
that case the dispatcher roots the Promise object and immediately returns its
handle; it does not await, poll, cancel, or translate the Promise.

`Js.Promise.thenValue`, `thenPromise`, `thenVoid`, and `catchValue` call the
corresponding native methods with exact `Js.Function1` values. The separate
`then` forms expose direct-value, assimilated-Promise, and `undefined` result
shapes rather than hiding JavaScript's `Awaited` behavior. They do not convert
Lean closures. An application that needs a Lean-authored continuation first
calls the explicit `Js.Function.ofLean` or `ofLeanVoid` conversion. A native
React state setter can instead be passed directly to `thenVoid`; the Promise's
ordinary JavaScript reachability keeps that function callable even after VIR
teardown.
JSPI would only be needed for a different API that suspends the running Lean
call until the Promise settles.

## Server-reference invariant

RPC responses containing `RpcPtr` values must remain exact JavaScript object
graphs while VIR retains them. Structurally copying such a response into an
unrelated Lean record would allow the original registered JavaScript reference
object to be collected and released while the copied token remained in Lean.

Therefore the faithful default is:

```text
Lean.Vir.Js Response
    -> externref root
    -> exact RpcSessionAtPos response object
    -> exact nested RpcPtr objects
```

Generated property accessors may provide typed views of this object, but they
must return the exact nested values. A decoded Lean snapshot is acceptable
only for response data proven not to contain server references.

## Boundary smoke and first acceptance fixture

`fixtures/runtime/InfoviewRpcPromise.lean` and its runtime smoke now establish
the minimal direct boundary. The fixture calls an exact session supplied both
directly and through `Surface.rpcSession`, verifies that the request object
reaches `session.call` by identity, receives the same native Promise object,
chains explicitly converted Lean callbacks through native `Promise.then` and
`Promise.catch`, passes a native state-setter-shaped function directly to
`thenVoid`, and reads a response property without structurally decoding the
response. The native-function regression settles after runtime disposal and
therefore also proves that the Promise path adds no VIR callback lifetime to
native functions.

`npm run test:infoview:browser` now runs `examples/RpcReferenceWidget.lean`
against real `@[server_rpc_method]` declarations in
`fixtures/infoview/RpcBrowserServer.lean`. Official React keeps the response in
state; the Lean-authored child renders it and keeps its own hook state across
position changes. The example projects the exact nested reference and sends it
back through Lean to the server. The acceptance also resolves the existing
goal-reference method in a real `h : p` context.

The test-only JavaScript parent demonstrates ordinary application effects:
it passes a native AbortSignal, suppresses stale results, and unmounts React
before disposing a VIR generation. Pending Promise continuations are native
JavaScript functions, so they cannot reenter a disposed Lean runtime. This is
coverage of that composition, not a claim about Lean-authored asynchronous
effects or a new library request manager. Successful replies, rejection,
cancellation (including already-aborted signals), rerender, replacement, and
unmount are executable checks.

The runner reuses the Chromium harness, the official `RpcSessions` class, and
`vscode-jsonrpc` for LSP framing/cancellation. Its localhost HTTP relay and
keepalive scheduling are test transport only. It negotiates the actual RPC wire
format and lets the official client register references; finalizer timing is
not an acceptance condition. It builds only the example package and infoview
imports and uses the existing matching Wasm artifact.

`callWithOptions` takes `Js.Any` request data: the extra generic request
parameter would exceed the current six-argument interpreter import limit
(which includes erased type parameters and the world token). `Js.erase` keeps
this a pure phantom-type change. The result remains polymorphic.

A later compatibility fixture may return upstream serialized
`ProofWidgets.Html` and delegate to upstream `HtmlDisplay`; it should not add a
second VIR-owned HTML tree.

## Retired provisional path

The descriptor resolver, normalizer, synthetic JSX reference demonstration,
unused infoview reference prefetch, and global reference store are removed.
The standalone JSX fixture retains its static component, props, keys, children,
and callback coverage. `RpcReferenceWidget` supplies the real reference example;
the browser test covers the current-goal methods that remain in
`Vir.Infoview.ProofWidgetsRpc`.

Real reference resolution uses `Server.WithRpcRef.val` directly. No client
wrapper or copied wire token substitutes for the session-owned object.
