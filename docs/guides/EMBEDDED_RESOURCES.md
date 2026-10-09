# The application workflow

Start with the [runnable Quickstart](../../examples/tutorials/quickstart/README.md).
It is the maintained source for the program, Lake setup, asset value, native
publisher and one-shot browser entry described here—not an excerpt to transcribe.

```bash
cd examples/tutorials/quickstart
lake exe publish _site
python3 -m http.server --directory _site 8000
```

Open <http://localhost:8000/>. The project can be copied out of the repository;
its [configuration](../../examples/tutorials/quickstart/lakefile.lean) pins an
immutable compatible VIR revision and [toolchain](../../examples/tutorials/quickstart/lean-toolchain).
Lean/Elan, Git and `curl` are build prerequisites. Python is only the example
HTTP server. No npm, WASI SDK, supplied pack or repository website build is needed.

## Declare preparation, then include the value

The [program](../../examples/tutorials/quickstart/QuickstartApp/Program.lean)
marks its public greeting with `@[vir_export]`. Its owner is separate from the
resource module's owner. The asset library declares the preparation dependency:

```lean
lean_lib QuickstartResources where
  roots := #[`QuickstartApp.Resources]
  needs := #[`+QuickstartApp.Program:virResourcePack]
```

The [resource module](../../examples/tutorials/quickstart/QuickstartApp/Resources.lean)
uses those prepared bytes:

```lean
module
public import Vir.Resources.Assets

public def QuickstartApp.Resources.resources : Vir.Resources.ResourceSet :=
  include_vir_assets (modules := #[QuickstartApp.Program])
```

The program module selects what is prepared; the full declaration name
`QuickstartApp.Program.greet` selects what JavaScript calls. Library names are
owners, not another program-selection key. In an existing application, reuse
suitable disjoint program and asset owners rather than inventing wrapper libraries.
The program must not import its own resource carrier.

Preparation and use are explicit, different relationships. Keep the `needs`
entry configured; inclusion does not inspect configuration or repair its removal.
For a dependency-owned program, qualify only the Lake key, such as
`@producer/+Program.Module:virResourcePack`. The literal include uses the full
semantic module name without that package qualifier. Custom source/build roots
and quoted module names need no authored generated paths.

## Publish with the application's writer

[Main.lean](../../examples/tutorials/quickstart/Main.lean) imports `Vir.Resources`
and calls `resources.forSite "lib/vir"`. It writes the returned `files` through
ordinary filesystem operations and encodes the returned runtime/program paths
as `app.json`. An existing application's asset writer can consume that same
inventory. Do not reconstruct manifests or content-ID directory names.

`forSite` performs no I/O. The host owns other-asset conflicts, stale files and
publication failure; the simple example writer is not transactional. Program
generation remains independent of acquiring the precompiled interpreter.
Missing acquisition is an error, never an implicit Wasm source build.

The page/JavaScript are embedded with Lean's standard `include_str`. An ordinary
Lake input-directory dependency tracks those files, so frontend edits rebuild
the publisher without regenerating the Lean program.

## Initialize once and call Lean

[main.js](../../examples/tutorials/quickstart/web/main.js) reads the generated
configuration beside itself, resolves its paths relative to that configuration,
imports the selected runtime and calls:

```js
program.call("QuickstartApp.Program.greet", "world");
```

It reports module-import, creation or call failure with the original diagnostic,
and disposes the finite program. There is no retry, recreation, call replay or
alternate JavaScript implementation. The whole published directory can move or
be hosted under a nested URL with JavaScript, JSON and Wasm content types.

VIR generates the interface from the root's `@[vir_export]` and `@[vir_startup]`
declarations. Startup hooks are callable, not automatically executed. Separate
creations have independent Lean state. [Optional contracts/lifecycle](RESOURCE_LIFETIME.md)
and [opaque Lean state](OPAQUE_LEAN_STATE.md) document capabilities beyond this
first call; they are not additional application setup steps.

[Build internals](BUILD_WORKFLOWS.md) account for retained developer tooling;
[qualification](../development/RESOURCE_ACCEPTANCE.md) distinguishes current and
historical evidence. DOM/React/editor integrations remain [experimental](../SUPPORT.md).
