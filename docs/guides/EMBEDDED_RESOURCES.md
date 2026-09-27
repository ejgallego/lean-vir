# Embed browser resources in a Lean client library

This **draft workflow** lets a native Lean application publish browser programs
without discovering VIR build paths or running package tools itself. Lake prepares
the resources; compiled Lean values own their bytes; the application writes them
to its site; JavaScript opens a program by export role.

The current runtime lock is available-only: a maintainer must first supply its
exact verified pack. A missing pack fails clearly; it never triggers a Wasm build.
Anonymous cold installation is not yet supported. Use the pinned Lean toolchain
and the matching runtime; do not substitute another release's Wasm.

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

In `resources/Client/Resources.lean`, embed the prepared pack:

```lean
module
public import Vir.Resources.Types
meta import Vir.Resources.Embed

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
native build/generator command. It consumes `Client.resources`, not setup files,
SDK paths or internal executables. See the complete
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

The [resource contract](../development/RESOURCE_BUNDLES.md) describes integrity,
publication and loader rules; the [acceptance checklist](../development/RESOURCE_ACCEPTANCE.md)
distinguishes tested behavior from remaining release gates.
