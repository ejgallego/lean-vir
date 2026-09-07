# A native RPC response in a Lean React component

This two-file tutorial separates application effects from the Lean renderer:

- [rpc-reference-widget.js](rpc-reference-widget.js) owns the native Promise,
  loading/error display, cancellation and stale-result suppression.
- [RpcReferenceWidget.lean](RpcReferenceWidget.lean) calls the session, projects
  exact response properties, and renders a child with ordinary React hook state.

The executable server example is [RpcBrowserServer.lean](../../fixtures/infoview/RpcBrowserServer.lean).
Its `create` method returns a message and a genuine `Server.WithRpcRef` object;
`read` accepts that exact reference back. The cancellation-only query mode and
goal-snapshot methods are acceptance fixtures, not library APIs.

Given a loaded VIR runtime and the infoview's official `useRpcSession()` result:

```js
const view = runtime.call("RpcReferenceWidget.View"); // Once per runtime.
const query = { message: "Hello from Lean", fail: false, waitForCancellation: false };
root.render(React.createElement(RpcReferenceWidget, { runtime, view, session, query }));
```

Import `RpcReferenceWidget` from the JavaScript file. Keep `view` and `query`
stable across unrelated renders; changing the session or query starts a request.
The component shows the previous response during refresh or failure and preserves
its child's counter. It does not manufacture a placeholder RPC response.

Cancellation is best effort: a successful response may already be on its way.
The effect's `active` flag therefore guards publication independently of aborting.
React and the native Promise own this behavior; VIR adds no scheduler. Unmount
the React root before disposing the runtime. Pending continuations here are
native JavaScript functions and cannot reenter disposed Lean closures.

Do not copy a reference token into a Lean record or JSON string. `Js Reply` and
the nested `Js.Any` reference retain the exact graph registered by the official
RPC client. `readReference` demonstrates sending that same object back through
Lean. The unchecked property projections in this small tutorial assume the
server's declared response shape; they are not runtime schema validation.

Run `npm run test:infoview:browser` to compile the tutorial package and exercise
it in Chromium against a real Lean server. It uses the existing matching Wasm
artifact; no site build is needed. See [HARNESS.md](../../docs/HARNESS.md) for setup.
