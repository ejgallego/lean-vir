# Client guide

The workflow is: **declare the program in its owning library's Lake setup,
embed the prepared value, then publish its files with the application's asset
writer**. Applications using that library run their ordinary Lake command.
They do not discover producer paths, invoke packaging scripts or build Wasm.

Lake builds the Lean program and independently acquires the exact precompiled
JavaScript/Wasm runtime selected by the VIR dependency. Use that dependency's
`lean-toolchain`; anonymous HTTPS acquisition requires `curl`. An empty cache
downloads the locked runtime; warm use needs no download. A missing runtime is
an acquisition error, not a request to build it from source.

## 1. Select the program

In the browser program module, mark the public declarations JavaScript may call:

```lean
module
meta import Vir.Attributes

@[vir_export]
public def Client.Program.greet (name : String) : String := "Hello, " ++ name
```

Register that module in a library separate from the module embedding its output.
For a small project, the relevant part of `lakefile.lean` is:

```lean
import Lake
open Lake DSL

require lean_vir from git
  "https://github.com/ejgallego/lean-vir" @ "VIR_REVISION"

package greeting_app

lean_lib ClientProgram where
  roots := #[`Client.Program]

lean_lib ClientResources where
  roots := #[`Client.Resources]
  needs := #[`+Client.Program:virResourcePack]
```

Replace `VIR_REVISION` with the selected source revision. Existing application
and asset libraries can own these modules; no wrapper library is required.
Keep their ownership disjoint: a later broad `Client` library root would also
claim both modules. The program must not import its own resource carrier.

The `+Client.Program:virResourcePack` prerequisite checks the graph and prepares
the program before the asset library compiles. There is no registration table,
JSON recipe or carrier-library key.

## 2. Embed it in the library

In `Client/Resources.lean` (or the existing asset module):

```lean
module
public import Vir.Resources.Assets

public def Client.Resources.resources : Vir.Resources.ResourceSet :=
  include_vir_assets (modules := #[Client.Program])
```

The list contains exact, fully qualified Lean module names, as in imports.
Lake declares what must be built; the include declares what is used.
`Vir.Resources.Assets` supplies the macro and the library-owned runtime.
Inclusion reads prepared bytes through the shared decoder; it never downloads
or builds. Custom source/build directories and quoted module names require no
generated-path changes.

Keep the preparation prerequisite configured. Inclusion reads prepared input;
it does not inspect Lake configuration or detect later removal of that prerequisite.

## 3. Publish through the existing asset writer

The native application imports the library's resource set:

```lean
import Client.Resources
import Vir.Resources

def writeVirAssets (directory : System.FilePath) : IO Vir.Resources.SiteFiles := do
  let site ← IO.ofExcept <| (Client.Resources.resources.forSite "lib/vir").mapError reprStr
  for file in site.files do
    let path := directory / file.path
    IO.FS.createDirAll (path.parent.getD directory)
    IO.FS.writeBinFile path file.bytes
  return site
```

Use the application's existing asset writer in place of that small filesystem
loop when it has one. `forSite` returns all files and their loader paths; the
host does not re-encode manifests or construct content-ID directories.
It checks and deduplicates the resource set once and preserves payload bytes.
It performs no IO. The host owns filename conflicts, stale files and failures;
publication is not promised to be transactional.

`site.runtimeModule`, `site.runtimeManifest` and `site.programManifests[0]!`
are output-relative paths for this one-program example. Supply them to the page
as URLs relative to the published site's root, including its deployment prefix.
Other hosts can supply multiple programs without changing the file writer.

## 4. Load and call from JavaScript

With the three URLs supplied by the page's publisher:

```js
const { createProgram } = await import(runtimeModuleUrl.href);
const program = await createProgram({ runtimeManifestUrl, programManifestUrl });
try {
  console.log(program.call("Client.Program.greet", "world")); // Hello, world
} finally {
  program.dispose();
}
```

Call by fully qualified Lean declaration name. VIR generates the callable
interface from root `@[vir_export]` and `@[vir_startup]` declarations; startup
hooks are callable, not automatically executed. Separate `createProgram` calls
have independent Lean runtime state. The facade exposes `status`, `call` and
`dispose`; [optional contracts and lifecycle](RESOURCE_LIFETIME.md) describe
expectations and pending-creation cancellation.

Serve the whole output over HTTP(S) with JavaScript, JSON and Wasm content types.
Keep each bundle's manifest and payloads together. The output can move or be
served under a nested URL without a Lean build directory.

The [complete three-package fixture](../../fixtures/resources/) demonstrates a
client library consumed by a separate native publisher. [Build internals](BUILD_WORKFLOWS.md)
account for retained tooling and private staging; they are not extra setup steps.
The first release is under review; [qualification](../development/RESOURCE_ACCEPTANCE.md)
records executed results and limits. DOM/React/editor conveniences are
[experimental](../SUPPORT.md), not requirements of this workflow.

For Lean-owned models and captured functions, see
[opaque Lean state and explicit invocation](OPAQUE_LEAN_STATE.md).
