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

Given a loaded VIR runtime `runtime` (declared with `let`), a DOM `container`,
and the infoview's official `useRpcSession()` result `session`:

```js
import * as React from "react";
import { createRoot } from "react-dom/client";
import { createVirRuntime } from "lean-vir";
import { RpcReferenceWidget } from "./rpc-reference-widget.js";

let root = createRoot(container);
let view = runtime.call("RpcReferenceWidget.View"); // Once per runtime.
const query = { message: "Hello from Lean", fail: false, waitForCancellation: false };
root.render(React.createElement(RpcReferenceWidget, { runtime, view, session, query }));
```

Keep `view` and `query` stable across unrelated renders. To update the query or
position, render into the same root with the same `view`. Here `nextSession` is
the official session at the new position (or `session` if the position is unchanged):

```js
const nextQuery = { ...query, message: "Updated query" };
root.render(React.createElement(RpcReferenceWidget, {
  runtime, view, session: nextSession, query: nextQuery,
}));
```

This starts a request while preserving the child's counter. The component shows
the previous response during refresh or failure; it does not manufacture a
placeholder RPC response.

Replacing the runtime starts a new component lifetime. From the owning code,
outside React rendering, unmount synchronously before disposing the old runtime.
Then create a fresh runtime, component and root. `replacementOptions` contains
the new package and the usual browser React providers; see the
[runtime setup](../../docs/JS_API.md).

```js
root.unmount(); // Synchronously runs effect cleanup and detaches Lean callbacks.
runtime.dispose();
runtime = await createVirRuntime(replacementOptions);
view = runtime.call("RpcReferenceWidget.View");
root = createRoot(container); // An unmounted root cannot be rendered again.
root.render(React.createElement(RpcReferenceWidget, {
  runtime, view, session: nextSession, query: nextQuery,
}));
```

The new child's counter starts at zero. Do not pass the old `view` to the new
runtime: its function closes over the disposed Lean runtime.

Cancellation is best effort: a successful response may already be on its way.
The effect's `active` flag therefore guards publication independently of aborting.
React and the native Promise own this behavior; VIR adds no scheduler. Pending
continuations here are native JavaScript functions and cannot reenter disposed
Lean closures.

Do not copy a reference token into a Lean record or JSON string. `Js Reply` and
the nested `Js.Any` reference retain the exact graph registered by the official
RPC client. `readReference` demonstrates sending that same object back through
Lean. The unchecked property projections in this small tutorial assume the
server's declared response shape; they are not runtime schema validation.

Run `npm run test:infoview:browser` to compile the tutorial package and exercise
it in Chromium against a real Lean server. It uses the existing matching Wasm
artifact; no site build is needed. See [HARNESS.md](../../docs/HARNESS.md) for setup.
