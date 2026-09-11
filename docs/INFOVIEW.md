# Infoview widgets and RPC

VIR aims to let Lean-authored browser components use the same React values,
infoview contexts and libraries as TypeScript-authored ProofWidgets components.
RPC is one dependency a widget may use, not a separate widget execution model.

Use [React](REACT.md) for component authoring and the
[RPC tutorial](../examples/tutorials/RpcReferenceWidget.md) for an executable
client and `@[server_rpc_method]` example. This guide owns editor integration;
[HOST_BINDINGS.md](HOST_BINDINGS.md) owns foreign-value lifetime and
[HARNESS.md](HARNESS.md#infoview-rpc-and-lifetime-checks) owns validation commands.

## Widget activation

Import `Vir.Infoview`. The [hello widget](../examples/tutorials/ReactProofWidgetHello.lean)
supplies a `RuntimeM (Js (React.Component Surface))` factory and uses
`vir_proof_widget View` inside its namespace. The command generates `widgetSpec`,
`createComponent`, `mount`, `irPackage` and `widgetProps`; `show_panel_widgets`
activates the bundled `Lean.Vir.Infoview.widget` with those props. This path needs
no application-authored JavaScript file.

For manual assembly, [ReactWidget](../Vir/Infoview/Widget.lean) supplies the
package roots and props. The component entry returns
`RuntimeM (Js (React.Component Surface))`; the mount entry has type:

```lean
Js React.Root → Js (React.Component Surface) → Surface → DomM Unit
```

`WidgetProps` identifies the Wasm asset, `IRPackage`, component and mount entries.
The default shell creates a private runtime/binding factory and one component
function per loaded service. Cursor/surface updates reuse that function and its
React root; configuration or package revision changes replace the service.
The [cleanup contract](HOST_BINDINGS.md#ui-cleanup-versus-runtime-disposal)
distinguishes normal UI release from hard disposal and failed setup.

Packages use the authoritative active Lean module snapshot, including unsaved
widget code. Revision checks cover its declaration closure and local source
ranges; imported changes become visible when the snapshot contains them. See
[module inputs](GENERATE_PACKAGE.md) for acquisition and visibility rules.
`autoReloadMs` controls stat/revision polling: zero disables it, `ReactWidget`
defaults to 1000 ms, and manually constructed `WidgetProps` defaults to zero.
Cursor movement alone does not request package replacement.

Build the optional widget module with `lake build VirInfoview`; see
[setup](HARNESS.md#setup) for prerequisites. Restart the Lean server or reopen
an already-open example after rebuilding that module. The shell bundle leaves
`react`, `react-dom` and `@leanprover/infoview` external to reuse the infoview's
dependencies. Its container stops propagation of click, context-menu,
mouse-down and pointer-down events to the outer panel.

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
result without awaiting, polling or translating it.

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
Its serialized component nodes carry a component identifier/export, encoded
props and children.

VIR's similarly named `Lean.Vir.ProofWidgets.Html` is a native
`ReactM (Js React.Node)` action, not that wire datatype. For upstream wire
compatibility, pass the existing upstream value to upstream `HtmlDisplay`.
The [component coverage](#component-coverage-and-gaps) below distinguishes
interoperability from a Lean implementation of the same component.

## Current authoring coverage

The tutorial has a JavaScript async parent and a Lean stateful renderer. It
exercises genuine `Server.WithRpcRef`, rerendering, cancellation and errors,
but does not yet demonstrate an all-Lean async parent or full component parity.
Its goal snapshot is display data, not an elaborator-owned expression/context.

The real-server shell test separately exercises Lean continuations after UI
cleanup and hard disposal. Neither test proves GC timing or arbitrary response
schemas. The [harness guide](HARNESS.md#infoview-rpc-and-lifetime-checks) distinguishes
these tests from standalone lifetime and upstream async-hook probes.

### Component coverage and gaps

Upstream `Component Props` names a React export in a widget module; its props
cross through `RpcEncodable`. The static
HTML/JSX fixtures and VIR goals/hypotheses panel establish native authoring;
they do not establish completed ports of these upstream components:

| Target | Behavior still to validate in a Lean-authored port |
| --- | --- |
| `InteractiveExpr` | Genuine elaborator-owned `ExprWithCtx`, tagged pretty-printing RPC and upstream `InteractiveCode`; a string goal snapshot is insufficient. |
| `HtmlDisplay` | The existing serialized Html format, component exports, props/children and upstream module resolution. Using upstream HtmlDisplay directly is interoperability, not a completed Lean port. |
| `MakeEditLink` | The supplied editor edit/selection and native child/event behavior. |
| `GoalTypePanel` / `SelectionPanel` | Panel props, position, goal locations and selected-expression behavior. |
| `FilterDetails` / `Maximizable` / `InteractiveSvg` | Stateful filtering/layout, SVG events and server updates. |

### Pinned upstream hook limitations

The [manual Chromium probe](../tests/infoview/upstream-async-probe.mjs) runs
the published hooks unchanged against React. With `@leanprover/infoview` 0.13.0:

- Strict Mode effect replay aborts the initial request without replacement in
  both `useAsync` and `useAsyncPersistent`.
- A cancelled request's late success can enter `useAsyncPersistent`'s cache
  and appear when the next request starts; `useAsync` has no such cache.
- The persistent hook drops the previous value on rejection, unlike the
  tutorial's UI policy.

These observations are specific to the published upstream hooks, not VIR's
Promise bindings. [HARNESS.md](HARNESS.md#upstream-async-hook-probe) gives the
reproduction command and prerequisites.

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
