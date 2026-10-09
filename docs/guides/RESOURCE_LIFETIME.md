# Optional resource contracts and lifecycle

Start with [the plain application example](EMBEDDED_RESOURCES.md). This reference
is for hosts that need independent callable-contract checks, pending-creation
cancellation or overlapping loads. None is required for the first greeting call.
UI mounting is an experimental integration; see [support scope](../SUPPORT.md).
The generic creation, status and disposal APIs retain their documented behavior.

The examples assume the runtime and program manifest URLs supplied by the
publisher. Keep the exact resource files together when deploying them.

## Independent callable contracts

A client can require its independently reviewed callable contract at creation:

```js
const pending = new AbortController();
const program = await createProgram({
  runtimeManifestUrl,
  programManifestUrl,
  signal: pending.signal,
  expectedExports: {
    "Client.Program.greet": {
      args: [{ type: "String", interfaceTag: 3 }],
      result: { type: "String", interfaceTag: 3 },
      effect: "pure",
    },
  },
});
```

The key is the full Lean declaration name from the
[existing greeting fixture](../../fixtures/resources/client/program/Client/Program.lean).
For compound types, retain the existing complete interface representation from
separately reviewed compiler output alongside the client's typed adapter. Do not
construct expectations from the program being loaded. ABI agreement does not
prove semantics; native/browser oracle tests remain necessary.

## Pending-creation cancellation

`signal` cancels only pending creation. After success, the program belongs to its
explicit `dispose()` lifecycle; a later abort neither disposes it nor interrupts
calls. Hosts must still dispose stale successful results. A cancellation is named
`AbortError`; inspect an own `cleanupError` even when ignoring stale cancellation:

```js
try {
  const candidate = await createProgram(options);
  // Hand off to the host's existing generation/disposal guard.
  acceptCandidate(candidate);
} catch (error) {
  if (Object.hasOwn(error, "cleanupError")) reportCleanup(error.cleanupError);
  if (error.name !== "AbortError") throw error;
}
```

Here `options` includes the caller's pending signal, `acceptCandidate` retains the
current candidate or disposes a stale one, and `reportCleanup` is the host's
diagnostic handler. Property presence matters: cleanup can throw
`undefined` or `null`. This handling does not replace explicit program disposal.

See the [browser lifecycle contract](../reference/RESOURCE_BUNDLES.md#browser-lifecycle)
for `program.status`, failure and disposal. A failed instance still needs disposal;
do not automatically replay its last call on a replacement.

## Overlapping loads

A component can unmount or request another program while `createProgram` is
pending. Each mount **and** unmount must invalidate older work. Dispose a stale
successful result; do not let a stale rejection update the current view. Keep
this policy in the host, not in the runtime or a shared singleton.

Here is a single-component example. `setStatus` is a synchronous, non-throwing
view update; it should also clear stale displayed results when loading/disposed.
Event handlers use only `current`, never a candidate captured by an older mount.

<!-- resource-mount-example -->
```js
let generation = 0;
let current = null;

function unmount() {
  ++generation;
  const previous = current;
  current = null;
  try {
    previous?.dispose();
  } finally {
    setStatus("Disposed");
  }
}

async function mount() {
  unmount();
  const mine = generation;
  setStatus("Loading");
  let candidate;
  try {
    candidate = await createProgram({ runtimeManifestUrl, programManifestUrl });
  } catch (error) {
    if (mine === generation) setStatus("Failed");
    throw error;
  }
  if (mine !== generation) {
    candidate.dispose();
    return;
  }
  current = candidate;
  setStatus("Ready");
}
```
<!-- /resource-mount-example -->

Observe every `mount()` promise, for example `mount().catch(reportError)` where
`reportError` logs diagnostics rather than changing this component's view. The
generation check already owns view updates. Unmount invalidates pending work
even when disposal throws; report that error too. It does not cancel acquisition:
late successful results are disposed when they arrive. Separate components have
separate generations and program ownership.
