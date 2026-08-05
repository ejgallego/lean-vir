# Lake Integration

VIR provides a module facet for compiling marked Lean declarations into a
browser-loadable `.irpkg`, plus a package facet for installing the matching
JavaScript/Wasm SDK. This is intentionally a focused browser-program workflow,
not a general Lean-to-Wasm compiler.

## Add The Lake Dependency

Pin `lean_vir` to a release tag or exact commit in the client
`lakefile.lean`:

```lean
require lean_vir from git
  "https://github.com/ejgallego/lean-vir" @ "<tag-or-commit>"
```

Then resolve the dependency once:

```bash
lake update lean_vir
```

Use the same pinned revision when selecting an unreleased SDK artifact, as
described under [Install The Browser SDK](#install-the-browser-sdk).

## Mark The Browser Surface

Import `Vir` and mark JavaScript-callable declarations with `@[vir_export]`.
Use `@[vir_startup]` for startup hooks that the browser host should run after
loading the package.

```lean
import Vir

open Lean.Vir.Browser

namespace MySlides.Runtime

@[vir_export]
def answer : Nat := 42

@[vir_startup]
def mount : DomM Unit := do
  let some root ← Document.querySelector "#vir-slide-root" | pure ()
  Element.setTextContent root "This DOM was updated from Lean"

end MySlides.Runtime
```

Choose the marker according to how the browser host should invoke the
declaration:

- `@[vir_export]` makes a declaration callable explicitly with `vir.call(...)`.
- `@[vir_startup]` is also an export and sets `startup: true` in the manifest;
  `vir.runStartupEntries()` invokes it as a startup hook.

Startup hooks must take no JavaScript arguments and return `Unit`, possibly
through a supported effect such as `DomM`; the attribute reports parameter and
result/effect violations separately at the declaration. Ordinary exports use
the full supported argument and result surface.

After Lean compiles a declaration, both markers reject private or non-executable
declarations and unavailable dependencies that Lean can see in the compiled
closure. `@[vir_export]` additionally rejects erased, implicit, and instance
binders; the stricter startup signature is checked as described above. Closure
errors include the path from the marked declaration to the blocker, so a local
helper that reaches an unregistered primitive such as `IO.getEnv` fails at its
declaration.

Lean module imports normally expose dependency IR as opaque extern declarations.
At such a boundary, the attribute does not guess: it identifies the dependency
whose compiled IR package generation requires. The `:vir` facet follows the
owning module recorded by Lean, imports that module's compiled IR, and emits
only the reached declarations into a dependency member. If the dependency
still has no compiled body, generation reports the original root-to-boundary
path. When `compiler.postponeCompile` is enabled, disable it for package inputs
so Lean can produce the required IR. The facet remains responsible for final
interface layouts and generated boxed boundaries.

Only declarations marked in the requested module are selected. Imported
declarations are not implicitly re-exported. A marked build with no matching
declarations fails with a diagnostic instead of silently producing an empty
package.

Lean module-system files can import the marker definitions without pulling in
the full browser-facing `Vir` library:

```lean
module

public meta import Vir.Attributes

@[vir_export]
public def MyModule.value : Nat := 42
```

The canvas example below currently uses the legacy-source path because the
broader browser library has not yet migrated to the module system.

## Build The Module

```bash
lake build +MySlides.Runtime:vir
```

The facet writes a JSON descriptor, a root package, dependency members, and a
report under `.lake/build/vir/module-sets/`:

```text
MySlides/Runtime.irpkg-set.json
MySlides/Runtime.irpkg
MySlides/Runtime.parts/MySlides.Support.irpkg
MySlides/Runtime.report.md
```

For current, legacy Lean modules the generator re-elaborates the module source.
When Lake supplies compiled module IR, the facet depends on that `.ir` and uses
a generated `import all MySlides.Runtime` driver.

Every member is an ordinary format-10 `.irpkg` that owns its module's
declarations and initializer metadata. The descriptor filters Lean's canonical
dependency-first module order to the reached modules and puts the root last.
Only the root owns interface exports, export summaries, native extern
registrations, and the aggregate host-import table. The runtime loads all
members before running initializer globals in that module order. Duplicate
declaration, initializer, host-import, or export-summary identities fail the
candidate load.

The descriptor is the facet's returned artifact. The facet depends on Lake's
transitive import artifacts, so changing an imported
implementation regenerates the affected set even when the root module's public
interface and `.olean` remain unchanged. A missing root package, report, or
descriptor-listed shard also invalidates the cached descriptor target.

The descriptor is currently one Lake target: when it is invalidated, the facet
regenerates the root and every reached dependency member as a complete set. It
does not yet cache unchanged members independently. Before rebuilding, the
facet removes the previous descriptor, root, and root-specific shard directory,
so a failed generation cannot leave an old descriptor advertising stale or
partially replaced members.

An executable or renderer that consumes the package should declare the facet as
a build dependency:

```lean
lean_exe my_slides where
  root := `Main
  needs := #[`+MySlides.Runtime:vir]
```

A Verso Slides integration can expose configuration shaped like:

```lean
vir := some { module := `MySlides.Runtime }
```

That integration should copy the generated `.irpkg` and SDK beside the
presentation, create its mount element, wait for Reveal initialization, load
the runtime, and call `vir.runStartupEntries()`. It should call `vir.dispose()`
during page teardown and render initialization failures visibly. This is the
integration contract; Verso still needs to land the corresponding renderer
configuration.

## Install The Browser SDK

```bash
lake build :virSdk
```

This installs the release matching the installed `lean_vir` package version
under `.lake/build/vir/sdk/`. The corresponding GitHub release must exist; for
an unreleased revision, select the exact pinned commit:

```bash
VIR_SDK_COMMIT=<lean-vir-revision> lake build :virSdk
```

The commit fetch checks that the downloaded artifact was built from that exact
revision. The installer also checks the SDK version, runtime ABI, non-empty
source commit, and every manifest checksum. GitHub Actions artifact downloads
require `GITHUB_TOKEN` or an authenticated `gh` CLI. Set
`VIR_SDK_ARCHIVE=/path/to/lean-vir-sdk.tar.gz` to use a local or CI-provided
archive without network access. Lake tracks the selected source and local
archive contents when caching the facet.
Before accepting a cached SDK manifest, the facet rechecks every listed payload
checksum. A missing or modified payload invalidates the manifest target and
reinstalls the SDK from the configured source.

The browser host can then load and run all startup hooks in manifest order:

```js
import { createVirRuntime } from "./vir/sdk/js/vir-runtime.js";

const vir = await createVirRuntime({
  wasmUrl: "./vir/sdk/wasm/vir-upstream.wasm",
  irPackageSetUrl: "./vir/module-sets/MySlides/Runtime.irpkg-set.json",
});
vir.runStartupEntries();
```

Publish the descriptor together with every referenced `.irpkg`, preserving
their relative layout. The runtime resolves each member relative to the served
descriptor URL.

`runStartupEntries()` invokes startup hooks in manifest order and records each
one only after it succeeds. Calling it again skips completed hooks; if a hook
throws, a retry resumes at that hook without repeating earlier successful
work. A successful replacement package resets the startup-hook state; a failed
replacement leaves the existing package and its startup-hook state unchanged.

## Canvas Example

[`examples/SlidesCanvas.lean`](../examples/SlidesCanvas.lean) builds its status
element and canvas, draws a bouncing rectangle, and schedules every animation
frame entirely from Lean. Build its package with the same facet used by client
projects:

```bash
lake build +SlidesCanvas:vir
```

The public rectangle API keeps ordinary Lean floats:

```lean
def Lean.Vir.Browser.CanvasRenderingContext2D.fillRect
    (ctx : @& Lean.Vir.Js CanvasRenderingContext2D)
    (x y width height : Float) :
    DomM Unit
```

VIR converts these values to one-shot JavaScript resources that the canvas
binding consumes after each synchronous call, so animation frames do not retain
their coordinate values. The same browser surface includes DOM element
creation and mutation, class/style updates, canvas sizing and context lookup,
paths, styles, transforms, and animation-frame callbacks.
