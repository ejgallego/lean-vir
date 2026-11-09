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

<!-- resource-contract-example -->
```js
const pending = new AbortController();
const stringInterface = {
  native: { type: { tag: "string" } },
  value: { tag: "string" },
};
const program = await createProgram({
  runtimeManifestUrl,
  programManifestUrl,
  signal: pending.signal,
  expectedExports: {
    "Client.Program.greet": {
      args: [stringInterface],
      result: stringInterface,
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
prove semantics; applications check behavior separately.

## Owned programs from in-memory bytes

Hosts that already have package bytes can use the SDK factory directly. The
same owned facade and independent contract checks are available without URL
acquisition:

```js
import { createVirRuntimeFactory } from "./js/vir-runtime.js";

const factory = createVirRuntimeFactory({
  wasmBytes,
  runtimeManifest,          // existing { contentId, descriptor } runtime envelope
  expectedRuntimeContentId, // independently selected contentId for that build
});
const program = await factory.createProgram({
  irPackageSet: [dependencyBytes, rootBytes], // root last; one member is also valid
  expectedExports,          // independently reviewed callable contracts
  signal: pending.signal,
});
try {
  const result = program.call("Client.Program.greet", "Ada");
} finally {
  program.dispose();
}
```

The host supplies the existing runtime envelope and its independently selected
content ID; it does not author another lock or derive expected callable contracts
from the package being opened. This operation verifies the envelope's canonical
content ID and Wasm inventory length/hash, supported VIR compatibility, every
package's compiler identity and the expected root exports before initializing a
runtime. It uses the same admission and facade implementation as URL loading.
The URL loader retains its existing origin, inventory and module-role rules.

Runtime bytes and envelope are copied at factory construction. Package bytes and
expected contracts are copied at each `createProgram` invocation, before any
await. The factory privately associates its verified bytes with one compiled
module, reused by independent program instances. Changing caller buffers or the
factory's public low-level Wasm fields cannot retarget that association. A bare
`WebAssembly.Module` or identity string does not establish it. Configure this
operation with raw `wasmBytes`, `runtimeManifest` and
`expectedRuntimeContentId`, without other Wasm selectors.

These checks establish agreement with a trusted publisher's selected bytes and
metadata. The embedder must load the JavaScript modules from the matching SDK;
the envelope cannot attest to arbitrary executing JavaScript or prove program
semantics. Keep the compiler, SDK, Wasm and generated packages matched. No
published artifact for a different Lean revision is an acceptable substitute.

`program` exposes only root `call`, `callWith`, `status` and idempotent `dispose`.
Disposal releases its instance, leaving the factory reusable. Creation observes
`signal` before and after asynchronous work and disposes a late-created instance
on cancellation. Byte creation has no implicit deadline: its caller supplies
`signal` when needed. URL loading retains its 120-second acquisition deadline.
Neither route promises prompt cancellation of a non-abortable operation. The
error and `cleanupError` rules below apply to both loading routes. Synchronous
Lean execution is not preempted by abort; a worker owner may terminate its worker
when required. UI mounting and retained-callback lifetimes
keep their existing ownership rules.

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
