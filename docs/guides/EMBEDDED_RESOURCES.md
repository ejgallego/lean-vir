# Run Lean in a web application

The client library declares a **program** (compiled Lean code) and prepares the
matching **runtime** (the JavaScript loader and Wasm interpreter). The application
builds through Lake, writes their compiled resource values to its site, and calls
the program from JavaScript. Those are the two things an application deploys.

Library setup is described below. Application authors use the library's ordinary
build and site-generation commands; they do not run VIR packaging tools.

The library acquires the exact prebuilt runtime from a public release on a cache
miss; warm use needs no runtime download. HTTPS acquisition requires `curl`.
An unavailable runtime fails clearly; it never triggers a Wasm build. Use the
pinned Lean toolchain and matching runtime; do not substitute another release's
Wasm. This integration is under review for the first release; see the
[acceptance checklist](../development/RESOURCE_ACCEPTANCE.md) for qualification.
Compatibility is one Lean source revision plus one VIR compatibility version;
the lock's content ID selects the exact runtime bundle. Client libraries inherit
this profile from VIR rather than independently choosing ABI or package-format
versions. See [the compatibility contract](../development/RESOURCE_BUNDLES.md#compatibility-versus-content-identity).
Unset `VIR_NATIVE_EXTERN_MANIFEST` when building resources: ambient custom native
profiles are rejected, even on cache hits. Custom-profile packaging remains a
separate lower-level `:vir` workflow with a matching runtime requirement.

The [build internals](BUILD_WORKFLOWS.md#how-resource-preparation-builds-its-inputs)
describe dependencies and caching. Their low-level commands are not additional
application setup steps.

## Client-library setup

Keep browser code separate from the native renderer and resource carrier.
For example, `program/Client/Program.lean`:

```lean
module
meta import Vir.Attributes

@[vir_export]
public def Client.Program.greet (name : String) : String := "Hello, " ++ name
```

Register the program and carrier as disjoint libraries in the client's lakefile:

```lean
lean_lib ClientProgram where
  srcDir := "program"
  roots := #[]
  globs := #[.one `Client.Program]

lean_lib ClientResources where
  srcDir := "resources"
  roots := #[]
  globs := #[.one `Client.Resources]
  needs := #[`@client_fixture/ClientResources:virResourcePack]
```

Replace `client_fixture` with your package name. Add any contributing modules to
the appropriate library registration, not to a second list of packaging roots.
There is one composition root per program; it can import other modules and export
wrappers. The program must not import its resource carrier.

Create `vir-resources/ClientResources.json`:

```json
{
  "schemaVersion": 1,
  "logicalId": "client-fixture/greeting",
  "module": "Client.Program",
  "exports": [{
    "role": "greet",
    "declaration": "Client.Program.greet",
    "interfaceId": "vir-fixture-greet-v1"
  }],
  "supportFiles": []
}
```

The recipe filename matches the carrier library. `module` names one composition
root. Roles are stable client-facing names;
`interfaceId` records the call contract, not a generated type check.

In `resources/Client/Resources.lean`, embed the prepared program files:

```lean
module
public import Vir.Resources.Embed

public def Client.Resources.bundle : Vir.Resources.Bundle :=
  include_vir_bundle "../../.vir-generated/ClientResources.virres"
```

The include path is relative to this source file. Your umbrella module can import
`Vir.Resources`, `Vir.Resources.Runtime` and `Client.Resources`, then expose:

```lean
public def Client.resources : Vir.Resources.ResourceSet := {
  runtime := Vir.Resources.Runtime.bundle
  programs := #[Client.Resources.bundle]
}
```

## Application and browser

The application requires and imports the client library, then runs its ordinary
native build/generator command. It consumes `Client.resources`, not internal
build files or executables. See the complete
[three-package fixture](../../fixtures/resources/) for a minimal publisher.

A publisher validates `ResourceSet.bundles`, writes each complete bundle under
its content ID, and writes a `bundle.json` envelope containing `contentId` and
`descriptor`. Keep file paths relative to that manifest and all program members
intact. The resulting site is movable and needs no Lean build directory.
The root `bundle.json` name is reserved, including descendants such as
`bundle.json/child`; a nested payload such as `assets/bundle.json` is allowed.

The publisher supplies site-relative URLs for the runtime module and the two
manifests. Resolve them relative to the generated page (including its deployment
prefix), not to a Lean build directory:

```js
// These paths come from the publisher's verified bundle plan.
const runtimeModuleUrl = new URL(published.runtimeModule, document.baseURI);
const runtimeManifestUrl = new URL(published.runtimeManifest, document.baseURI);
const programManifestUrl = new URL(published.programManifest, document.baseURI);
const { createProgram } = await import(runtimeModuleUrl.href);
const program = await createProgram({ runtimeManifestUrl, programManifestUrl });
try {
  console.log(program.call("greet", "world"));
} finally {
  program.dispose();
}
```

For an interactive component, keep the program until the component is unmounted
and dispose it there. Separate `createProgram` calls have separate Lean runtime
state, even when they use the same resource files. `interfaceId` remains
client-owned protocol metadata, not a runtime proof of argument/result types.

A client can require its independently reviewed callable contract at creation:

```js
const pending = new AbortController();
const program = await createProgram({
  runtimeManifestUrl,
  programManifestUrl,
  signal: pending.signal,
  expectedExports: {
    greet: {
      declaration: "Client.Program.greet",
      interfaceId: "vir-fixture-greet-v1",
      signature: {
        args: [{ type: "String", interfaceTag: 3 }],
        result: { type: "String", interfaceTag: 3 },
        effect: "pure",
      },
    },
  },
});
```

This example matches the greeting fixture, not Slides' formatter. For compound
types, retain the existing complete interface representation from separately
reviewed compiler output alongside the client's typed adapter. Do not construct
the expectation from the program being loaded. IDs and exact ABI agreement do
not prove semantics; native/browser oracle tests remain necessary.

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

See the [browser lifecycle contract](../development/RESOURCE_BUNDLES.md#browser-lifecycle)
for `program.status`, failure and disposal. A failed instance still needs disposal;
do not automatically replay its last call on a replacement.

### Overlapping loads

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

## Names in the API and implementation

- `Bundle` is one program or runtime's files and descriptor, held as Lean values.
- `ResourceSet` groups one runtime with the programs an application publishes.
- `.virres` is the build-time file used to transport and embed a bundle. The
  application uses the compiled value, not that file's build path.

The inner compiler output is an `.irpkg` package. The older runtime distribution
is called an SDK in contributor tooling. Neither is another application concept
or an extra artifact the author must assemble. The
[resource reference](../development/RESOURCE_BUNDLES.md) documents these formats.
