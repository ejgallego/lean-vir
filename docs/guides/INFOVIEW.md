# Infoview widgets and RPC

VIR aims to let Lean-authored browser components use the same React values,
infoview contexts and libraries as TypeScript-authored ProofWidgets components.
RPC is one dependency a widget may use, not a separate widget execution model.

Use [React](REACT.md) for component authoring and the
[RPC tutorial](../../examples/tutorials/RpcReferenceWidget.md) for an executable
client and `@[server_rpc_method]` example. This guide owns editor integration;
[HOST_BINDINGS.md](../reference/HOST_BINDINGS.md) owns foreign-value lifetime and
[HARNESS.md](../HARNESS.md#infoview-rpc-and-lifetime-checks) owns validation commands.

## Widget activation

Import `Vir.Infoview`. The [hello widget](../../examples/tutorials/ReactProofWidgetHello.lean)
supplies a `RuntimeM (Js (React.Component Surface))` factory and uses
`vir_proof_widget View` inside its namespace. The command generates `widgetSpec`,
`createComponent`, `mount`, `irPackage` and `widgetProps`; `show_panel_widgets`
activates the bundled `Lean.Vir.Infoview.widget` with those props. This path needs
no application-authored JavaScript file.

For manual assembly, [ReactWidget](../../Vir/Infoview/Widget.lean) supplies the
package roots and props. The component entry returns
`RuntimeM (Js (React.Component Surface))`; the mount entry has type:

```lean
Js React.Root → Js (React.Component Surface) → Surface → DomM Unit
```

`WidgetProps` identifies the Wasm asset, `IRPackage`, component and mount entries.
The default shell creates a private runtime/binding factory and one inner
component function per loaded service. Because its separate React root does not
inherit the outer infoview context, the shell also creates one stable per-service
wrapper that supplies the exact current upstream `EditorContext`. The mount
entry receives that wrapper rather than literally the component-entry result;
the wrapper renders the inner component with unchanged prop values, including the
unchanged nested `leanProps` value. Cursor/surface updates reuse the wrapper,
inner function and React root; configuration or package revision changes
replace the service.
The [cleanup contract](../reference/HOST_BINDINGS.md#ui-cleanup-versus-runtime-disposal)
distinguishes normal UI release from hard disposal and failed setup.

Packages use the authoritative active Lean module snapshot, including unsaved
widget code. Revision checks cover its declaration closure and local source
ranges; imported changes become visible when the snapshot contains them. See
[module inputs](../reference/GENERATE_PACKAGE.md) for acquisition and visibility rules.
`autoReloadMs` controls stat/revision polling: zero disables it, `ReactWidget`
defaults to 1000 ms, and manually constructed `WidgetProps` defaults to zero.
Cursor movement alone does not request package replacement.

Build the optional widget module with `lake build VirInfoview`; see
[setup](../HARNESS.md#setup) for prerequisites. Restart the Lean server or reopen
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

Pass the JavaScript wire value expected by the server as request data.
`ClientRequestOptions.empty` constructs an ordinary empty JavaScript options
object and omits `abortSignal`. `ClientRequestOptions.setAbortSignal` assigns an
`AbortController`'s exact native signal to that object without wrapping either
value or changing cancellation behavior.
JSL stores browser-local Lean values; it is not an RPC wire representation.

`callWithOptions` takes `Js.Any` request data; use `Js.erase` to forget only its
phantom type. Adding another request type parameter would exceed the current
six-argument interpreter import limit, which includes erased parameters and the
world token. The response type remains polymorphic.

## Shared ordinary values

For reference-free requests and responses, import `Vir.JsonValue` and
explicitly choose `ToJson`/`FromJson` instances for a shared Lean type. The
[shared Foo](../../fixtures/runtime/JsonRpcFoo.lean) includes nested records,
arrays, an option and an inductive. The native
[server](../../fixtures/infoview/RpcBrowserServer.lean) and interpreted
[client](../../fixtures/runtime/JsonValueCodec.lean) import that same declaration;
neither needs a parallel JavaScript schema or application `.js` file.

On the server, `JsonRpc.serveValue` adapts a typed
`Request → RequestM (RequestTask Response)` handler to
`Json → RequestM (RequestTask Json)` for `@[server_rpc_method]`. It checks request
decoding and response encoding before serialization. Import its server-only
module with `public meta import Vir.Infoview.JsonRpc.Server`.

On the client, compose explicit conversion with the native position-specific
RPC API. Decode the reply inside the Lean continuation that uses it. For
example, with application-defined `showError`/`updateView` actions and native
`ignore`/`fail` callbacks for the terminal Promise:

```lean
match ← JsonValue.encodeJs request with
| .error error => showError error
| .ok params =>
  let pending : Js.Promise Js.Any.Value ←
    RpcSession.callWithOptions session method params options
  let receive ← Js.Function.ofLeanVoid fun reply => do
    match ← JsonValue.decodeJs (α := Response) reply with
    | .error error => showError error
    | .ok response => updateView response
  let handled ← Js.Promise.thenVoid pending receive
  let _ ← Js.Promise.thenVoidWithRejection handled ignore fail
  pure ()
```

Encoding failure precedes dispatch. The RPC Promise and its reply remain native;
the decoded `Response` stays in Lean, with no JSL intermediate. Transport/server
errors and exceptions in the continuation reject the resulting Promise; attach
rejection handling to that chain, as in the [RPC tutorial](../../examples/tutorials/RpcReferenceWidget.lean).
Request options preserve the exact abort signal. Cancellation and stale-result
guards remain application responsibilities.

The value domain is null, booleans, well-formed Unicode strings, dense arrays,
same-realm ordinary string-keyed data objects and mathematical integers in
`[-9007199254740991, 9007199254740991]`. Fractions, negative JS zero and unsafe
integers are rejected; native `JsonNumber` is checked before conversion can
round it. An existing instance that deliberately encodes a number as a string
still produces a string—there is no implicit numeric string fallback.

Undefined, functions, DOM objects, this SDK's JSL handles, accessors, cycles and
symbol/non-enumerable properties are excluded. Proxies and concurrent mutation
are outside the ordinary-data contract, not a sandbox guarantee. Copies do not
preserve object identity or aliases. Private handle brands from another SDK
instance are not detectable; do not submit foreign handles as ordinary data.

The codec does not infer reference provenance from field names: `p` and
`__rpcref` are ordinary data keys. The upstream infoview transport, however,
registers singleton `{"p":"…"}` or `{"__rpcref":"…"}` objects as references,
depending on its negotiated wire format. Avoid those shapes in ordinary RPC
responses. Successful value decoding does not establish reference-copy safety;
keep genuine `WithRpcRef` values on the raw RPC path with their original session.

An external server may already have lost numeric precision before decoding;
client checks cannot recover the original JSON lexeme. Use the paired server
adapter for pre-serialization validation. Custom instances remain responsible
for their round-trip laws and schema policy, including unknown-field handling.
`Vir.JsonValue` also exposes `encodeJs`/`decodeJs` for non-RPC uses. Conversion
visits each node through the object ABI; no zero-copy claim is made.

## Promise continuations

Host imports execute synchronously. A native Promise crosses as an exact `Js`
result without awaiting, polling or translating it.

`Js.Promise.thenValue`, `thenPromise`, `thenVoid` and `catchValue` delegate to
native Promise methods over exact `Js.Function1` values. They select
value-return, native-Promise-return and `undefined` subsets of TypeScript's
generic signatures. Native resolution still assimilates thenables recursively;
VIR does not compute `Awaited` or reproduce full overload inference. Rejection
inputs are `Js.Any`; `catchValue` recovery retains the input Promise's result
type. See [Selected Promise Relationships](../reference/BINDING_MODALITIES.md#selected-promise-relationships)
for the checked relationships and their limits.

Convert a Lean closure explicitly with `Js.Function.ofLean` or `ofLeanVoid`.
Native functions, including React state setters passed to `thenVoid`, need no
conversion and acquire no VIR-specific lifetime.

`thenValueWithRejection` and `thenVoidWithRejection` forward both functions to
`promise.then(onFulfilled, onRejected)`. The value form selects a common generic
result type; the void form selects `undefined`. This is not
`then(onFulfilled).catch(onRejected)`: an exception in the fulfillment handler
rejects the chained Promise without invoking the sibling rejection handler.

## Editor notifications

`Infoview.useClientNotificationEffect method callback dependencies` forwards to
the upstream infoview hook. The dependency argument is
`Js.UndefinedOr React.DependencyList`: `Js.UndefinedOr.undefined` produces native
`undefined` (the upstream omitted-argument behavior), while `Js.UndefinedOr.ofJs deps`
passes the exact JavaScript array, including `[]`.
The upstream `EditorContext` owns subscription and cleanup. VIR does not queue,
filter or schedule notifications.

The tutorial listens for `textDocument/didChange`, accepts only notifications
whose document URI equals the current `Surface.cursor.uri`, and increments an
application revision used by its request effect. The URI filter and decision to
rerun RPC are application policy, not behavior imposed by the binding. Other
applications may choose different methods, filters and dependencies while
following React's hook rules. The example passes `undefined` to follow editor
connection replacement too: upstream uses an explicit array exactly as supplied,
without adding the editor identity to it.

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
whole response schema. See [Lean boundary types](../reference/HOST_BINDINGS.md#lean-boundary-types).

## Cancellation and UI cleanup

Cancellation does not guarantee rejection or prevent an already-completed
response from arriving. Guard publication against obsolete requests independently
of aborting them, as the tutorial's effect does with its `active` flag.
Aborting also does not remove attached Promise handlers.

Normal infoview UI unmount leaves retained Lean continuations callable in their
original runtime, so they can run application stale guards. Explicit runtime
disposal instead rejects a later callback invocation before its Lean body runs.
For the complete cleanup, replacement and failure rules, see
[UI cleanup versus runtime disposal](../reference/HOST_BINDINGS.md#ui-cleanup-versus-runtime-disposal).

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

The tutorial is an all-Lean async application: its Lean effect owns Promise
continuations, abort setup, stale-result suppression, request status and child
state. It uses genuine `Server.WithRpcRef` values and contains a same-position
edit policy, but it is not full ProofWidgets component parity. Its goal snapshot
is display data, not an elaborator-owned expression/context.

The real-server shell test separately exercises Lean continuations after UI
cleanup and hard disposal. Neither test proves GC timing or arbitrary response
schemas. The [harness guide](../HARNESS.md#infoview-rpc-and-lifetime-checks) distinguishes
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

The [manual Chromium probe](../../tests/infoview/upstream-async-probe.mjs) runs
the published hooks unchanged against React. With `@leanprover/infoview` 0.13.0:

- Strict Mode effect replay aborts the initial request without replacement in
  both `useAsync` and `useAsyncPersistent`.
- A cancelled request's late success can enter `useAsyncPersistent`'s cache
  and appear when the next request starts; `useAsync` has no such cache.
- The persistent hook drops the previous value on rejection, unlike the
  tutorial's UI policy.

These observations are specific to the published upstream hooks, not VIR's
Promise bindings. [HARNESS.md](../HARNESS.md#upstream-async-hook-probe) gives the
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
