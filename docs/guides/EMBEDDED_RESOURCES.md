# Use VIR in an application

After adding `lean_vir` to your project, integration has three parts: mark the
functions to export, include their assets in a resource library, and tell Lake
to prepare those assets. The [Quickstart](../../examples/tutorials/quickstart/README.md)
is the complete runnable project used below.

## 1. Mark the functions JavaScript may call

In the [program module](../../examples/tutorials/quickstart/QuickstartApp/Program.lean),
use `@[vir_export]` on public entry points:

```lean
module
meta import Vir.Attributes

@[vir_export]
public def QuickstartApp.Program.greet (name : String) : String :=
  "Hello, " ++ name
```

One program can export several functions. The program module selects what Lake
builds; the full declaration name selects what JavaScript calls.

## 2. Include the assets in a resource library

Use an existing asset library or create one. Keep it separate from the library
containing your program, so building the program does not depend on its own
generated assets. Its [resource module](../../examples/tutorials/quickstart/QuickstartApp/Resources.lean)
contains:

```lean
module
public import Vir.Resources.Assets

public def QuickstartApp.Resources.resources : Vir.Resources.ResourceSet :=
  include_vir_assets (modules := #[QuickstartApp.Program])
```

This is an ordinary Lean value containing the selected program and its matching
precompiled interpreter. The include expression reads prepared assets; it does
not run a build or download them.

## 3. Add the Lake prerequisite

In [lakefile.lean](../../examples/tutorials/quickstart/lakefile.lean), register the
program and resource modules and add `needs` to the resource library:

```lean
lean_lib QuickstartProgram where
  roots := #[`QuickstartApp.Program]

lean_lib QuickstartResources where
  roots := #[`QuickstartApp.Resources]
  needs := #[`+QuickstartApp.Program:virResourcePack]
```

If the libraries already exist, add the prerequisite to the resource library's
configuration. Lake prepares the program before that library compiles. Keep the
`needs` entry: it requests the build, while the include expression uses its result.
The program must not import the resource module that embeds it.

For a dependency-owned program, qualify only the Lake key, such as
`@producer/+Program.Module:virResourcePack`. The literal include uses the full
semantic module name without that package qualifier. Custom source/build roots
and quoted module names need no authored generated paths.

## Run the complete example

The Quickstart includes the dependency, publisher and browser page. From the
repository root:

```bash
cd examples/tutorials/quickstart
lake exe publish _site
python3 -m http.server --directory _site 8000
```

Open <http://localhost:8000/> to see **Hello, world**. You can copy the project
out of the repository; its configuration pins a compatible VIR revision and
[toolchain](../../examples/tutorials/quickstart/lean-toolchain). Lean/Elan, Git
and `curl` are build prerequisites. Python is only the example HTTP server.
No npm, WASI SDK, supplied pack or repository website build is needed.

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
