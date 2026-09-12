# A native RPC response in a Lean React component

[RpcReferenceWidget.lean](RpcReferenceWidget.lean) is an all-Lean infoview
application. It owns the request effect, native Promise continuations,
cancellation, stale-result guard, loading/error state and rendered child state.
There is no application JavaScript companion.

`WidgetView` is a `RuntimeM (React.FunctionComponent
Infoview.PanelWidgetProps)` factory. React supplies the native panel props
directly; the component calls the actual `Infoview.useRpcSession` hook for its
position-specific session, whose context position can differ from `props.pos`.
It uses `props.pos` only for its edit-notification URI filter. `vir_proof_widget
WidgetView` generates `createComponent`, `irPackage` and `widgetProps`; the
factory is the only package root. In this repository, a file importing both
`tutorials.RpcReferenceWidget` and the native server fixture
`fixtures.infoview.RpcBrowserServer` can activate it with:

```lean
show_panel_widgets [local Lean.Vir.Infoview.widget with
  RpcReferenceWidget.widgetProps]
```

The executable server side remains
[RpcBrowserServer.lean](../../fixtures/infoview/RpcBrowserServer.lean). Its
`create` method returns a message and a genuine `Server.WithRpcRef`; `read`
accepts that exact registered reference back. Its cancellation-only and goal
snapshot methods are acceptance fixtures, not public VIR APIs.

## Request lifetime

The effect constructs an ordinary JavaScript options object with
`Infoview.ClientRequestOptions.empty`, then
`ClientRequestOptions.setAbortSignal` assigns the exact native
`AbortController` signal to `options.abortSignal`. Neither operation wraps the
options or signal, and the empty object omits `abortSignal` rather than using
`null`.

The effect attaches Lean callbacks to the exact Promise returned by
`RpcSession.callWithOptions`. Cleanup first marks its `RuntimeRef Bool` inactive
and then aborts the controller. Aborting is only a transport request: a late
success may still arrive, and attached handlers remain attached. The independent
`active` check prevents either a stale success or error from publishing state.
The last successful response remains visible while a replacement request loads
or fails; no placeholder response is fabricated. Failure displays a generic
message rather than assuming that an arbitrary rejection has a `.message` field.

The response stays an exact JavaScript graph. `reference` projects the original
nested server reference and `readReference` sends that value back to its owning
session. Copying a token into a Lean record or JSON value would not preserve the
RPC client's reference lifetime. `message` checks only that one field is a
primitive string; it does not validate the complete reply schema. JSX embeds
`Node.text label` directly, so this string is not decoded into Lean and encoded
again for display. With `open scoped Lean.Vir.Js`, `js#"message"` abbreviates
the effectful `JsValue.ofString "message"` construction for literal keys.

## Same-position edits

`Infoview.useClientNotificationEffect` forwards the method, callback and optional
dependency list to the upstream infoview hook. Native `undefined` and an empty
JavaScript array remain distinct, expressed by `Js.UndefinedOr`, not `Option`.
The tutorial subscribes to `textDocument/didChange`, filters notifications to
the URI projected from native `PanelWidgetProps.pos`, and increments a revision
included in the request effect's dependencies. Filtering by URI and choosing to
refresh are application policy; VIR does not queue, filter or schedule
notifications. This example passes `undefined` so the subscription follows the
current editor connection on every render as well as changes to the URI. This
subscribes/unsubscribes every render; the upstream hook does not await those
operations, and VIR adds no ordering. An explicit dependency list must account
for context changes.

The component function and request object remain stable across unrelated shell
renders. A matching edit starts another request at the same position without
replacing the child component, so its local counter is retained. A new session,
query identity or revision reruns the effect under the same stale-publication
rules.

## Cleanup

Normal infoview unmount runs React effect cleanup and removes the upstream
notification subscription, but it does not hard-dispose the VIR runtime.
Surviving callbacks therefore remain callable in their original generation and
must obey the application's stale guard.

This example leaves Promise continuations attached. Explicit runtime disposal
invalidates them before Lean body entry, so a later response can produce an
unhandled Promise rejection. Another Lean rejection handler or stale guard
cannot run after disposal. An embedding requiring quiet immediate teardown
needs terminal handling outside the disposed runtime; waiting for every request
is not sufficient for work that may never settle. See the
[runtime disposal contract](../../docs/reference/HOST_BINDINGS.md#lean-backed-javascript-values).

For the real-server browser check and prerequisites, see
[Infoview RPC and lifetime checks](../../docs/HARNESS.md#infoview-rpc-and-lifetime-checks).
