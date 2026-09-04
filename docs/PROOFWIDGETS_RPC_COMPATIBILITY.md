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
| RPC call | `session.call(method, params, options)` | Direct `RpcSession.call(session, method, params)` binding; options deferred | Add the exact optional options value when the cancellation fixture needs it; do not implement a VIR scheduler. |
| Async result | Native `Promise<S>` | Exact `Js.Promise S` with direct native `then` and `catch` operations over exact `Js.Function1` values | Preserve the Promise and callback objects; do not make the synchronous host dispatcher await either one. |
| Server references | Exact response objects registered by `RpcSessionAtPos` | Mirrored `RpcRef`/`ResolvedRef` records plus a bounded global store | Keep the response object graph exact so upstream reference reachability remains authoritative. |
| Request cancellation | Native `AbortController` passed through call options | No general RPC cancellation path | Bind the native objects when a changing-props fixture requires cancellation. |
| Props encoding | `RpcEncodable` JSON object supplied to the JavaScript component | Lean values retained in JSL for browser-side rendering | Construct the exact JavaScript request object explicitly; do not treat JSL as JSON. |
| Returned HTML | Serialized upstream `ProofWidgets.Html` rendered by `HtmlDisplay` | `ProofWidgets.Html` is a direct `ReactM (Js React.Node)` action | Do not silently equate these types. Either use upstream `HtmlDisplay` for wire compatibility or return data and render it with the VIR-native API. |
| Error display | Promise rejection plus upstream `mapRpcError` | Host command logs or callback failure | Preserve the rejection value first; presentation can be an explicit component helper. |

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

The first browser acceptance fixture should next call a real
`@[server_rpc_method]` through the position-specific session and retain the
exact response in React state. It must cover:

1. successful structured data;
2. a response containing a genuine `Server.WithRpcRef`;
3. Promise rejection;
4. rerender at a new position;
5. cancellation or stale-result handling using the same mechanism required in
   TypeScript;
6. unmount and package replacement without retained Lean callbacks.

The fixture should initially return data and render it through VIR's direct
React API. A second compatibility fixture may return upstream serialized
`ProofWidgets.Html` and delegate to upstream `HtmlDisplay`; it should not add a
second VIR-owned HTML tree.

## Retirement target

Once the direct session fixture covers the existing reference client, remove
the provisional `ProofWidgets.RpcRef`, `ResolvedRef`, descriptor normalization,
custom resolve command, and `proofWidgetsRpcRefStore`. The official RPC
session and its server-reference lifecycle should be the only authority.
