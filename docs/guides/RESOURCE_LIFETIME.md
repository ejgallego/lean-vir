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

`expectedExports` requires the named signatures. Every export declared by the
root package remains callable. The key is the full Lean declaration name from the
[existing greeting fixture](../../fixtures/resources/client/program/Client/Program.lean).
For compound types, retain the existing complete interface representation from
separately reviewed compiler output alongside the client's typed adapter. Do not
construct expectations from the program being loaded. ABI agreement does not
prove semantics; applications check behavior separately.

## Owned programs from in-memory bytes

Hosts that already have package bytes first prepare their selected runtime.
Successful preparation returns a reusable program creator with the same owned
facade and independent contract checks as URL loading.

Use the matching resource runtime bundle produced by the
[application asset writer](EMBEDDED_RESOURCES.md#publish-with-the-applications-writer):
its generated `bundle.json` is `runtimeManifest`, and its `wasm` role identifies
the selected Wasm bytes. The publisher supplies `expectedRuntimeContentId` from
its build selection, for example `resources.runtime.contentId` from the producer's
Lean `ResourceSet` value, separately from the envelope received by JavaScript.
Do not compute the expected ID from that received envelope or fabricate a
replacement descriptor.

The SDK archive supplies the matching JavaScript entry points and Wasm profiles;
it does not contain a runtime envelope. Use the bundle's Wasm, or an SDK Wasm file
only when it matches that envelope's inventory exactly. The development Wasm is
not interchangeable with a bundle's selected release Wasm. For a standalone SDK
without resource-bundle inputs, use the low-level runtime factory instead.

```js
import { prepareRuntime } from "./js/vir-runtime.js";

const pending = new AbortController();
const runtime = await prepareRuntime({
  wasmBytes,
  runtimeManifest,          // resource runtime bundle's generated bundle.json
  expectedRuntimeContentId, // independently selected contentId for that build
  signal: pending.signal,
});
const program = await runtime.createProgram({
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
from the package being opened. Preparation verifies the envelope's canonical
content ID, supported VIR compatibility and Wasm inventory length/hash, then
asynchronously compiles the Wasm module. It creates no live instance or host provider.
`runtime.createProgram` checks package compiler identities and expected root
exports before initializing an instance, using the same admission and facade
implementation as URL loading. The URL loader retains its existing origin,
inventory and module-role rules.

The envelope's `runtimeModule` role describes the resource bundle's URL loader.
SDK preparation neither fetches nor imports it: the host has already imported
the matching SDK entry point. The complete bundle grammar is retained while the
byte path verifies the selected Wasm inventory.

Runtime bytes and envelope are copied at preparation entry. Package bytes and
expected contracts are copied at each `createProgram` invocation, before any
await. Successful preparation returns a frozen object exposing only
`createProgram`, with a private compiled module reused by independent instances.
Changing caller buffers cannot retarget it. Preparation accepts raw `wasmBytes`,
`runtimeManifest` and `expectedRuntimeContentId`; a bare `WebAssembly.Module`, URL
or asserted identity string cannot substitute for verified bytes. Existing
`imports`, `hostBindings` and `defaultHostBindings` configure each instance;
browser and Node entry points retain their usual host defaults.

The low-level `createVirRuntimeFactory` keeps its ordinary `createRuntime`
interface. Owned-program creation is available on a successfully prepared
runtime, without conditional factory modes or additional verification flags.

These checks establish agreement with a trusted publisher's selected bytes and
metadata. The embedder must load the JavaScript modules from the matching SDK;
the envelope cannot attest to arbitrary executing JavaScript or prove program
semantics. Keep the compiler, SDK, Wasm and generated packages matched. No
published artifact for a different Lean revision is an acceptable substitute.

`program` exposes only root `call`, `callWith`, `status` and idempotent `dispose`.
Disposal releases its instance, leaving the prepared runtime reusable. Preparation
has no live instance to dispose; releasing the creator's JavaScript references
releases its compiled-module ownership. Creation observes
`signal` before and after asynchronous work and disposes a late-created instance
on cancellation. Neither preparation nor byte creation has an implicit deadline.
Their signals have separate pending-operation scopes: abort after preparation
does not revoke the reusable creator; abort after program creation does not
dispose the program. A request owner can pass the same signal to both calls,
as above. URL loading retains its 120-second acquisition deadline.
Neither route promises prompt cancellation of a non-abortable operation. The
error and `cleanupError` rules below apply to both loading routes. Cancellation
does not stop compilation already in progress or preempt synchronous Lean
execution; a late compilation result is rejected before returning a creator.
A worker owner may terminate its worker
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
