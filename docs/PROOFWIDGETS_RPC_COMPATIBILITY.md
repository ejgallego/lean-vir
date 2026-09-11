# Native RPC in ProofWidgets

VIR aims to let Lean-authored browser components use the same React values,
infoview contexts and libraries as TypeScript-authored ProofWidgets components.
RPC is one dependency a widget may use, not a separate widget execution model.

Start with the [RPC tutorial](../examples/tutorials/RpcReferenceWidget.md) for
an executable client and `@[server_rpc_method]` example. This guide owns the RPC
boundary; [HOST_BINDINGS.md](HOST_BINDINGS.md) owns foreign-value lifetime and
[HARNESS.md](HARNESS.md#infoview-rpc-and-lifetime-checks) owns validation commands.

## Sessions and calls

`Surface.rpcSession` supplies the exact official, position-specific
`RpcSessionAtPos` returned by the infoview's `useRpcSession()`.

| Lean operation or value | Native behavior |
| --- | --- |
| `RpcSession.call session method params` | `session.call(method, params)` |
| `RpcSession.callWithOptions session method params options` | `session.call(method, params, options)` |
| `Js.Promise Response` | The exact returned Promise, not an awaited or decoded reply |
| `Js Response` | The exact response graph, including registered server references |

Pass the JavaScript wire value expected by the server as request data. Options
are the native options object; pass an `AbortController`'s signal in
`options.abortSignal` when cancellation is needed.
JSL stores browser-local Lean values; it is not an RPC wire representation.

`callWithOptions` takes `Js.Any` request data; use `Js.erase` to forget only its
phantom type. Adding another request type parameter would exceed the current
six-argument interpreter import limit, which includes erased parameters and the
world token. The response type remains polymorphic.

## Promise continuations

Host imports execute synchronously. A native Promise crosses as an exact `Js`
result without awaiting, polling or translating it. Suspending the running Lean
call until settlement would require a different boundary, such as JSPI.

`Js.Promise.thenValue`, `thenPromise`, `thenVoid` and `catchValue` delegate to
native Promise methods over exact `Js.Function1` values. They select
value-return, native-Promise-return and `undefined` subsets of TypeScript's
generic signatures. Native resolution still assimilates thenables recursively;
VIR does not compute `Awaited` or reproduce full overload inference. Rejection
inputs are `Js.Any`; `catchValue` recovery retains the input Promise's result
type. See [Selected Promise Relationships](BINDING_MODALITIES.md#selected-promise-relationships)
for the checked relationships and their limits.

Convert a Lean closure explicitly with `Js.Function.ofLean` or `ofLeanVoid`.
Native functions, including React state setters passed to `thenVoid`, need no
conversion and acquire no VIR-specific lifetime.

`thenValueWithRejection` and `thenVoidWithRejection` forward both functions to
`promise.then(onFulfilled, onRejected)`. The value form selects a common generic
result type; the void form selects `undefined`. This is not
`then(onFulfilled).catch(onRejected)`: an exception in the fulfillment handler
rejects the chained Promise without invoking the sibling rejection handler.

## Server references and response types

Keep responses containing server references as exact JavaScript graphs. The
official RPC client registers the reference objects it receives; copying a token
into a Lean record or JSON string would not keep that registered object alive.

```text
Js Response → externref root → exact response → exact nested RpcPtr objects
```

Property access must preserve the exact nested reference. Passive fields can be
copied explicitly into a Lean snapshot, provided any server reference remains
rooted through its original JS object. Reference resolution uses the server's
`Server.WithRpcRef` protocol, not a VIR resolver or retention store.

A phantom response type describes an expected wire shape; it does not validate
a reply. Shared server/client declarations, runtime checks and decoding are
separate choices. `Js.Object.get` returns `Js.Any`; the tutorial's message
reader applies `Js.String.fromAny`, rejecting malformed fields without coercion.
Its reference reader returns the exact value. Neither is validation of the
whole response schema. See [Lean boundary types](HOST_BINDINGS.md#lean-boundary-types).

## Cancellation and UI cleanup

Cancellation does not guarantee rejection or prevent an already-completed
response from arriving. Guard publication against obsolete requests independently
of aborting them, as the tutorial's effect does with its `active` flag.
Aborting also does not remove attached Promise handlers.

Normal infoview UI unmount leaves retained Lean continuations callable in their
original runtime, so they can run application stale guards. Explicit runtime
disposal instead rejects a later callback invocation before its Lean body runs.
For the complete cleanup, replacement and failure rules, see
[UI cleanup versus runtime disposal](HOST_BINDINGS.md#ui-cleanup-versus-runtime-disposal).

React purity, hook ordering, effect dependencies and request policy remain
programmer responsibilities, just as in TypeScript. VIR supplies neither a
request scheduler nor additional Lean proofs of these rules.

## Optional serialized HTML

Upstream `mk_rpc_widget%` calls a server method returning serialized
`ProofWidgets.Html` and renders it with `HtmlDisplay`. It is an optional
server-rendered authoring path, not the definition of a ProofWidgets component.

VIR's similarly named `Lean.Vir.ProofWidgets.Html` is a native
`ReactM (Js React.Node)` action, not that wire datatype. For upstream wire
compatibility, pass the existing upstream value to upstream `HtmlDisplay`;
a Lean port must preserve its format and reuse its module-loading dependencies.
The [porting plan](PROOFWIDGETS_PORTING.md#planned-component-parity) tracks
`HtmlDisplay`, `InteractiveExpr` and the other component targets.

## Current authoring coverage

The tutorial has a JavaScript async parent and a Lean stateful renderer. It
exercises genuine `Server.WithRpcRef`, rerendering, cancellation and errors,
but does not yet demonstrate an all-Lean async parent or full component parity.
Its goal snapshot is display data, not an elaborator-owned expression/context.

The real-server shell test separately exercises Lean continuations after UI
cleanup and hard disposal. Neither test proves GC timing or arbitrary response
schemas. The [harness guide](HARNESS.md#infoview-rpc-and-lifetime-checks) distinguishes
these tests from standalone lifetime and upstream async-hook probes.

## Upstream reference points

The compatibility reference is ProofWidgets4
[`a8acbfd`](https://github.com/leanprover-community/ProofWidgets4/tree/a8acbfd87375ff4abe14ce09db5b7664d383bc7f)
(`ProofWidgets/Component/Basic.lean`, `ProofWidgets/Component/OfRpcMethod.lean`,
`widget/src/ofRpcMethod.tsx`)
and vscode-lean4
[`5a25e6a`](https://github.com/leanprover/vscode-lean4/tree/5a25e6abb2e973b4c89a053acc74c479c0bb2e9f)
(`lean4-infoview/src/infoview/rpcSessions.tsx`,
`lean4-infoview-api/src/rpcSessions.ts`). Browser tests use the published
`@leanprover/infoview-api` version pinned in `package-lock.json`, with the pinned
Lean server and official React.
