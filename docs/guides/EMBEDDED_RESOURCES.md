# Run Lean in a web application

This example builds a plain greeting function in your own Lake project, publishes
its files, and calls it from JavaScript. It uses the existing resource workflow;
no DOM bindings, React, editor integration or repository npm setup is required.
Those conveniences remain [experimental](../SUPPORT.md).

An application deploys two things: its **program** (compiled Lean declarations)
and the matching **runtime** (the JavaScript loader and Wasm interpreter). Lake
builds the program and acquires the exact precompiled runtime independently.
It can compile native Lean producer tools; it never builds Wasm on an application
cache miss. HTTPS runtime acquisition uses Lake's standard download operation,
which needs `curl` and uses its normal host configuration.

The first release is still under review. This example pins landed VIR source for
Lean 4.34.0; [qualification and limits](../development/RESOURCE_ACCEPTANCE.md)
are recorded separately. When changing the VIR revision, use its `lean-toolchain`
and runtime lock together.

The public runtime source must be usable without credentials. The complete
downloaded pack is checked before replacing either the cache or the carrier's
prepared input; warm use needs no runtime download.

## Client-library setup

Create this layout in a new project:

```text
greeting-app/
  lean-toolchain
  lakefile.lean
  program/Client/Program.lean
  resources/Client/Resources.lean
  vir-resources/ClientResources.json
  Client.lean
  Main.lean
```

Put this in `lean-toolchain`:

```text
leanprover/lean4:v4.34.0
```

In `lakefile.lean`, declare the dependency, the program and resource libraries,
and the native publisher:

```lean
import Lake
open Lake DSL

require lean_vir from git
  "https://github.com/ejgallego/lean-vir" @ "77dd14b652eeb91f173ab023dcfdaabb653b8327"

package greeting_app

lean_lib ClientProgram where
  srcDir := "program"
  roots := #[]
  globs := #[.one `Client.Program]

lean_lib ClientResources where
  srcDir := "resources"
  roots := #[]
  globs := #[.one `Client.Resources]
  needs := #[`@greeting_app/ClientResources:virResourcePack]

lean_lib Client where
  roots := #[]
  globs := #[.one `Client]

lean_exe «generate-site» where
  root := `Main
```

Keep these library registrations disjoint: a broad `Client` root would also
claim `Client.Program` and `Client.Resources` under the wrong source directory.
Keep the program separate from its resource carrier so it does not import the
files produced by its own build. Larger programs can import other modules;
register them with the appropriate library, keeping one composition root.

Write the greeting in `program/Client/Program.lean`:

```lean
module
meta import Vir.Attributes

@[vir_export]
public def Client.Program.greet (name : String) : String := "Hello, " ++ name
```

Declare that export in `vir-resources/ClientResources.json`:

```json
{
  "schemaVersion": 1,
  "logicalId": "greeting-app/greeting",
  "module": "Client.Program",
  "exports": [{
    "role": "greet",
    "declaration": "Client.Program.greet",
    "interfaceId": "greeting-app-greet-v1"
  }],
  "supportFiles": []
}
```

`greet` is the browser-facing role used by `program.call`. The current resource
adapter requires this recipe; `interfaceId` is application-owned contract
metadata, not a proof of argument/result types. You do not need to hand-author a
signature descriptor for this example.

Embed the prepared program in `resources/Client/Resources.lean`:

```lean
module
public import Vir.Resources.Embed

public def Client.Resources.bundle : Vir.Resources.Bundle :=
  include_vir_library ClientResources
```

The key is the registered owning library's literal name, not a Lean declaration
or the carrier module name. Its `virResourcePack` prerequisite prepares the
bytes before elaboration; the include never downloads or builds anything.
Custom source/build directories require no generated-path changes. In
`Client.lean`, combine it with the precompiled runtime:

```lean
module
public import Vir.Resources
public import Vir.Resources.Runtime
public import Client.Resources

public def Client.resources : Vir.Resources.ResourceSet := {
  runtime := Vir.Resources.Runtime.bundle
  programs := #[Client.Resources.bundle]
}
```

An existing application library can own this setup and expose its resource set
instead. Its users then need only its ordinary build and publication command.

## Application and browser

Write this small publisher in `Main.lean`. `forSite` prepares the complete file
inventory and loader paths; the publisher writes those files to its output root:

```lean
import Client

def main (args : List String) : IO Unit := do
  let [output] := args | throw <| IO.userError "usage: generate-site OUTPUT"
  let site ← IO.ofExcept <| (Client.resources.forSite "").mapError reprStr
  unless site.programManifests.size == 1 do
    throw <| IO.userError "This application requires exactly one program"
  let directory := System.FilePath.mk output
  for file in site.files do
    let path := directory / file.path
    IO.FS.createDirAll (path.parent.getD directory)
    IO.FS.writeBinFile path file.bytes
  IO.println s!"runtimeModule: {site.runtimeModule}"
  IO.println s!"runtimeManifest: {site.runtimeManifest}"
  IO.println s!"programManifest: {site.programManifests[0]!}"
```

From the project directory, run:

```sh
lake exe generate-site site
```

The first build acquires the locked runtime from its public release; warm builds
reuse it. An unavailable runtime reports an acquisition failure rather than
selecting another revision or compiling Wasm. Do not set
`VIR_NATIVE_EXTERN_MANIFEST` for this resource workflow.

The command creates the bundles under `site/` and prints three output-relative
loader paths. Create `site/main.js` below, replacing each placeholder with its
corresponding printed path. The exactly-one-program check belongs to this example
application; `forSite` also handles resource sets with multiple programs.

```js
const runtimeModuleUrl = new URL("./RUNTIME_MODULE_PATH", import.meta.url);
const runtimeManifestUrl = new URL("./RUNTIME_MANIFEST_PATH", import.meta.url);
const programManifestUrl = new URL("./PROGRAM_MANIFEST_PATH", import.meta.url);
const { createProgram } = await import(runtimeModuleUrl.href);
const program = await createProgram({ runtimeManifestUrl, programManifestUrl });
try {
  console.log(program.call("greet", "world")); // Hello, world
} finally {
  program.dispose();
}
```

Create `site/index.html`:

```html
<!doctype html>
<html lang="en">
  <meta charset="utf-8">
  <title>VIR greeting</title>
  <p>Open the browser console to see the Lean greeting.</p>
  <script type="module" src="./main.js"></script>
</html>
```

Serve `site/` over HTTP(S), using a static server with JavaScript, JSON and Wasm
content types. For example, if Python 3 is installed:

```sh
python3 -m http.server --directory site 8000
```

Open `http://localhost:8000/`; the console prints `Hello, world`. Copy the whole
`site/` directory when deploying. Its URLs resolve relative to `main.js`, so the
directory can move or be served under a nested prefix without a Lean build tree.
Keep all bundle payloads, including notices and package members, together.

Creation and calls can fail. Dispose a created program even after failure; a
terminal runtime failure needs a fresh instance. Do not automatically replay an
effectful call. Separate `createProgram` calls have independent Lean runtime state.

The current resource facade offers `status`, `call` and `dispose`. Custom host
bindings and low-level object access use the underlying [JavaScript runtime API](JS_API.md),
not extra options to `createProgram`. Explicit JSON converters are
[planned for 0.1.1](../SUPPORT.md#planned-for-011).

## Publication paths and guarantees

A publisher calls `Client.resources.forSite "lib/vir"` and writes the returned
`SiteFiles.files` through its ordinary asset writer. An empty prefix selects the
output root. The helper validates the resource set once, deduplicates bundles,
and prepares complete payloads and `bundle.json` envelopes under their
content IDs. It does no IO, downloading or producer-path discovery. Returned paths
are output-relative; spelling is preserved, not normalized. The host owns writing,
namespace conflicts with its other assets, stale files and publication failures;
the helper does not make the output transactional. Payload bytes, descriptor/content
identity and bundle-relative paths are preserved. File enumeration order and the
outer envelope's JSON whitespace/key spelling are not API guarantees.

`runtimeModule`, `runtimeManifest` and `programManifests` give the corresponding
loader paths. Program manifests retain the input program order, including repeated
references; the file inventory contains each bundle once. Hosts that need one
program check that policy themselves. The resulting site is movable and needs no
Lean build directory. Keep paths relative to each manifest and all members intact.
Within each bundle, the root `bundle.json` name is reserved, including descendants
such as `bundle.json/child`; a nested payload such as `assets/bundle.json` is allowed.
That reservation does not apply to the host's output prefix: `bundle.json/vir` is
a valid destination directory because bundle files live below their content IDs.

The returned paths are relative to the site's output root, not necessarily the
current page. The publisher rebases them for nested pages or supplies the output
root's URL (including any deployment prefix). They are not Lean build paths.

## Further integration details

- [Optional contracts and lifecycle](RESOURCE_LIFETIME.md): independently reviewed
  callable expectations, cancellation and overlapping UI loads.
- [Build internals](BUILD_WORKFLOWS.md): dependencies, caching and source/runtime
  compatibility; these are not extra first-run steps.
- [Existing three-package fixture](../../fixtures/resources/): a client library
  consumed by a separate publisher, used by the resource acceptance harness.

The recipe filename uses its carrier's Lean name spelling, including quotes when
needed (`«Client-Resources».json` for `lean_lib «Client-Resources»`). Dotted and
Unicode names work; names containing path separators are not filenames.

`Bundle` holds one program or runtime's files and descriptor; `ResourceSet` groups
the runtime and programs a publisher uses. `.virres` is their build-time carrier,
while `.irpkg` is the inner compiler output. Applications consume the compiled
values rather than discover these artifacts in VIR's build directory. The
[resource reference](../development/RESOURCE_BUNDLES.md) owns the format details.
