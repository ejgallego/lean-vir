# ProofWidgets RPC Compatibility

ProofWidgets components are browser React exports that can use the infoview's
contexts and libraries. VIR's goal is to author those components in Lean with
the same React and JavaScript semantics as TypeScript-authored components.
RPC is one dependency a component may use, not its universal execution model.
This document records that boundary and the current acceptance evidence.

The comparison was made against:

- ProofWidgets4 commit `a8acbfd87375ff4abe14ce09db5b7664d383bc7f`, in
  `ProofWidgets/Component/Basic.lean`, `ProofWidgets/Component/OfRpcMethod.lean`
  and `widget/src/ofRpcMethod.tsx`;
- vscode-lean4 commit `5a25e6abb2e973b4c89a053acc74c479c0bb2e9f`, in
  `lean4-infoview/src/infoview/rpcSessions.tsx` and
  `lean4-infoview-api/src/rpcSessions.ts`.

Browser acceptance uses the published official `@leanprover/infoview-api`
package pinned to `0.13.0`, with the repository's pinned Lean server and React.

## Optional server-rendered authoring path

Upstream also offers `mk_rpc_widget%`: an authoring helper that accepts a named
server method of type:

```lean
Props → Lean.Server.RequestM (Lean.Server.RequestTask ProofWidgets.Html)
```

It produces a JavaScript widget module specialized with that method name. The
module calls the official `useRpcSession` hook, invokes
`RpcSessionAtPos.call(method, props, options)`, tracks the returned native
Promise through React state, cancels superseded work with `AbortController` or
the legacy cancellable protocol, and renders the serialized `ProofWidgets.Html`
with `HtmlDisplay`. This protocol is useful when server computation produces a
serializable UI description. Its inability to serialize arbitrary closures or
store React state in the server method does not restrict ordinary ProofWidgets
React components, including the client components VIR aims to implement in Lean.

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
| Wire props and RPC data | `RpcEncodable` data supplied across the server boundary | Exact JavaScript request/response objects; JSL is only for non-wire Lean values | Construct the exact JavaScript wire value explicitly; browser-only props can also contain ordinary JS functions and objects. |
| Optional serialized UI | Upstream `ProofWidgets.Html` rendered by `HtmlDisplay` | `Lean.Vir.ProofWidgets.Html` is a direct `ReactM (Js React.Node)` action | These are distinct authoring APIs. For upstream wire compatibility, pass the exact upstream `Html` value to upstream `HtmlDisplay`. |
| Error display | Promise rejection plus upstream `mapRpcError` | Exact native Promise rejection, including the server error | Preserve the rejection value first; presentation can be an explicit component helper. |

## Gaps, application rules, and bridge obligations

- **Compatibility gaps:** the native RPC foundation is exercised, but the
  reusable ProofWidgets components and their infoview-context integration still
  need parity examples. The [porting plan](PROOFWIDGETS_PORTING.md) lists the
  concrete targets. Testing a data-returning RPC method does not establish
  `InteractiveExpr` or serialized-`Html` compatibility.
- **Shared application rules:** component purity, hook ordering, valid effect
  dependencies, cancellation, stale-result suppression, and agreement on wire
  data remain the programmer's responsibilities just as in a TypeScript React
  app. VIR does not impose additional Lean-level proofs of these properties.
- **Foreign bridge obligations:** VIR must root exact JavaScript values while
  Lean holds them, retain Lean heap references behind JSL objects and converted
  callbacks, and release those foreign roots at runtime disposal. Owners must
  unmount React before disposing the runtime whose component functions it uses.
  These obligations do not require tracking React's internal hook queues or
  owning ordinary JS object graphs separately.

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

`thenValueWithRejection` and `thenVoidWithRejection` expose native
`promise.then(onFulfilled, onRejected)` with both function objects unchanged.
The value form selects a common non-Promise output shape for both handlers;
the void form selects `undefined`. Neither is `then(onFulfilled).catch(onRejected)`:
an exception thrown by the fulfillment handler rejects the chained Promise,
without calling the sibling rejection handler.

## Component unmount is not interpreter disposal

A pending Promise can still invoke its handlers after effect cleanup. While
the VIR runtime is live, a Lean callback can check an application-owned stale
flag just like a TypeScript callback. If the owner then calls `runtime.dispose()`,
however, VIR releases the callback's Lean closure root. A later invocation fails
in the JavaScript callback bridge before its Lean body can inspect that flag.
Aborting the request does not remove an already-attached Promise handler;
even a cancellation rejection can trigger it after disposal.

Ordinary ProofWidgets browser components do not dispose a separate interpreter
on unmount. Their pending JavaScript closures remain callable through normal JS
reachability. The pinned upstream
[InteractiveExpr](https://github.com/leanprover-community/ProofWidgets4/blob/a8acbfd87375ff4abe14ce09db5b7664d383bc7f/widget/src/interactiveExpr.tsx)
uses the shared infoview `useAsyncPersistent` hook. The optional
[ofRpcMethod renderer](https://github.com/leanprover-community/ProofWidgets4/blob/a8acbfd87375ff4abe14ce09db5b7664d383bc7f/widget/src/ofRpcMethod.tsx)
also uses that hook and explicitly cancels its request on replacement/unmount.
The shared [async hooks](https://github.com/leanprover/vscode-lean4/blob/5a25e6abb2e973b4c89a053acc74c479c0bb2e9f/lean4-infoview/src/infoview/util.ts)
own native Promise continuations and use request IDs to select the current
request state. This is library/application behavior, not an automatic guarantee
for every ProofWidgets component.

A candidate all-Lean authoring path is to bind these upstream hooks: a Lean
function starts the RPC synchronously and returns its exact Promise, while the
existing upstream hook handles settlement in JavaScript. This would require no
handwritten per-widget JS and could avoid pending Lean continuations in this
example. It remains an unimplemented acceptance target, not a reason to change
ordinary callback-disposal semantics or introduce a VIR request manager.

The manual [upstream async probe](../tests/infoview/upstream-async-probe.mjs)
executes the published `@leanprover/infoview` 0.13.0 hooks unchanged against
React 19.2.7 in Chromium, without VIR or a Lean server. It exposes two obstacles
to using this version as a drop-in replacement for the tutorial:

- Both `useAsync` and `useAsyncPersistent` start one request on initial Strict
  Mode rendering. Effect replay aborts it without starting a replacement. A
  cancellation-aware request leaves the hook rejected.
- With `useAsyncPersistent`, start B, replace it with C, resolve C, then resolve
  the cancelled B successfully. C remains visible initially, but starting D
  displays B from the persistent cache. Plain `useAsync` has no such cache.

The persistent hook also returns a rejection without the previous value. That
is an API/UI difference, distinct from the stale-result problem; keeping the
previous reply visible on error is the tutorial's application policy.

These are upstream observations, not failures introduced by the Lean boundary
or requirements for a new VIR ownership layer. The experiment has not yet
tested a Lean-authored parent using these hooks. The current tutorial and its
real-server acceptance remain unchanged pending a choice of upstream correction
or explicitly different application behavior.

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

Typed property accessors can provide views of this object, but they must return
the exact nested values. Copying passive fields into a Lean snapshot is a
separate explicit operation; any retained server references must still be held
as their exact registered JS objects.

Shared server/client datatype declarations, runtime validation, and decoding
solve different problems. Shared declarations describe the expected wire shape
and can reduce duplicated type definitions. They do not automatically validate a
received object. A validator checks a value; a decoder constructs a different
representation. Neither is mandatory merely because a component is authored in
Lean, and neither should silently replace the registered reference objects.
The current tutorial's typed projections assume the server's declared shape,
as an unchecked TypeScript property access would; they are not schema validation.

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

`npm run test:infoview:browser` now runs `examples/tutorials/RpcReferenceWidget.lean`
against real `@[server_rpc_method]` declarations in
`fixtures/infoview/RpcBrowserServer.lean`. Official React keeps the response in
state; the Lean-authored child renders it and keeps its own hook state across
position changes. The example projects the exact nested reference and sends it
back through Lean to the server. The acceptance also resolves a fixture-owned
goal snapshot in a real `h : p` context. That snapshot is display data, not an
elaborator expression/context.

The tutorial's `examples/tutorials/rpc-reference-widget.js` parent demonstrates
ordinary application effects: it passes a native AbortSignal and suppresses
stale results. Its owner unmounts React before disposing a VIR generation.
Pending Promise continuations are native
JavaScript functions, so they cannot reenter a disposed Lean runtime. This is
coverage of that composition, not a claim about Lean-authored asynchronous
effects or a new library request manager. Successful replies, rejection,
cancellation (including already-aborted signals), loading/error UI, rerender,
replacement, and unmount are executable checks. The test transport holds actual
successful replies until after cancellation, then releases them to test stale
success independently. It records every rejection, including inactive requests,
and fails on unexpected browser or transport errors.

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

A planned compatibility fixture will pass upstream serialized
`ProofWidgets.Html` directly to upstream `HtmlDisplay`. It should reuse upstream
module loading and rendering dependencies, including `InteractiveCode` where
needed, rather than introduce another HTML wire dialect or renderer.

## Retired provisional path

The descriptor resolver, normalizer, synthetic JSX reference demonstration,
unused infoview reference prefetch, and global reference store are removed.
The standalone JSX fixture retains its static component, props, keys, children,
and callback coverage. The two-file `RpcReferenceWidget` tutorial supplies the
real reference example. Goal snapshot methods belong only to the test server;
there is no public VIR-specific expression-reference protocol.

Real reference resolution uses `Server.WithRpcRef.val` directly. No client
wrapper or copied wire token substitutes for the session-owned object.
