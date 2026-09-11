# A native RPC response in a Lean React component

This two-file tutorial separates application effects from the Lean renderer:

- [rpc-reference-widget.js](rpc-reference-widget.js) owns the native Promise,
  loading/error display, cancellation and stale-result suppression.
- [RpcReferenceWidget.lean](RpcReferenceWidget.lean) calls the session, projects
  exact response properties, and renders a child with ordinary React hook state.

This example is not yet an all-Lean async widget: its pending continuations are
native JavaScript functions and cannot reenter a disposed Lean runtime. See the
[RPC guide](../../docs/INFOVIEW.md) for the direct Promise
API and the distinction between cancellation, stale results and disposal.

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

The effect's `active` flag suppresses stale publication independently of aborting.
`readReference` sends the original nested reference back through Lean; copying
its token would not preserve the RPC client's reference lifetime. The message
reader checks for a primitive string with `Js.String.fromAny`, without coercion;
it does not validate the whole reply schema.

For the executable real-server check and prerequisites, see
[Infoview RPC and lifetime checks](../../docs/HARNESS.md#infoview-rpc-and-lifetime-checks).
