# Lake Integration

VIR provides a module facet for compiling marked Lean declarations into a
browser-loadable package set, a package facet for installing the matching
JavaScript/Wasm SDK, and an application facet for composing several package
sets with one SDK. This is intentionally a focused browser-program workflow,
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
  let some root ← Document.querySelectorString "#vir-slide-root" | pure ()
  let text ← Lean.Vir.JsValue.ofString "This DOM was updated from Lean"
  Element.setTextContent root (← Lean.Vir.Js.Nullable.ofJs text)

end MySlides.Runtime
```

Choose the marker according to how the browser host should invoke the
declaration:

- `@[vir_export]` makes a declaration callable explicitly with `vir.call(...)`.
- `@[vir_startup]` is also an export and sets `startup: true` in the manifest;
  `vir.runStartupEntries()` invokes it as a startup hook.

Startup hooks must take no JavaScript arguments and return `Unit`, possibly
through a supported effect such as `DomM`; the attribute names unexpected
parameters, the actual non-`Unit` result, and unsupported effect constructors
at the declaration. Ordinary exports use the full supported argument and
result surface.

After Lean compiles a declaration, both markers reject private or non-executable
declarations and unavailable dependencies that Lean can see in the compiled
closure. `@[vir_export]` additionally rejects erased, implicit, and instance
binders and unsupported JavaScript interface types or runtime layouts; the
stricter startup signature is checked as described above. Closure errors include
the path from the marked declaration to the blocker, so a local helper that
reaches an unregistered primitive such as `IO.getEnv` fails at its declaration.

Lean module imports normally expose dependency IR as opaque extern declarations.
At such a boundary, the attribute does not guess: it identifies the dependency
whose compiled IR package generation requires. The `:vir` facet follows the
owning module recorded by Lean, imports that module's compiled IR, and emits
only the reached declarations into a dependency member. If the dependency
still has no compiled body, generation reports the original root-to-boundary
path. When `compiler.postponeCompile` is enabled, disable it for package inputs
so Lean can produce the required IR. The facet remains responsible for
raw-marker fallback, generated boxed boundaries, and package-wide constraints.

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

## Opt Into A Lean Extern Reference Body

An imported `@[extern] def` normally remains a native boundary. When its Lean
definition is the intended portable implementation for a particular VIR
package, name it explicitly before marking the package entrypoint:

```lean
import Upstream.AcceleratedModule
import Vir

vir_extern_fallback Upstream.acceleratedRead, Upstream.acceleratedWrite

@[vir_export]
def portableEntry (input : ByteArray) : ByteArray :=
  Upstream.acceleratedWrite (Upstream.acceleratedRead input)
```

The command accepts only `@[extern] def`s with transparent kernel bodies. It
rejects bodyless or opaque declarations, duplicate requests, non-externs, and
directly recursive fallbacks. Lean's
ordinary native compiler continues to use the extern; the command compiles a
private reference-body clone only for VIR closure resolution. Package
generation emits an adapter at the original name and preserves the extern's
IR parameter ownership while calling the clone. Any dependencies newly exposed
by the reference body must still have ordinary IR or a registered native
provider.

Use this only as an explicit package portability decision. It does not add the
extern symbol to the shared runtime, enable general dynamic lookup, or affect
other externs.

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

The `+Module:vir` facet is the producer primitive. It is useful on its own for
inspection and custom artifact workflows. Applications should normally use the
application composition described below instead of wiring one producer
directly into an executable.

## Compose Application Web Assets

Add `vir-web-assets.json` at the root of the application package. Each entry
selects an existing `+Module:vir` producer. Use `package` when the module belongs
to a dependency or when its name would otherwise be ambiguous; `id` is the
stable URL directory name and defaults to the module name. An explicit `id`
must be a URL-safe slug containing only letters, digits, `.`, `_`, or `-`.

```json
{
  "format": "lean-vir-web-assets-config",
  "version": 1,
  "programs": [
    {
      "id": "slides",
      "package": "my_slides",
      "module": "MySlides.Runtime"
    },
    {
      "id": "widgets",
      "package": "some_dependency",
      "module": "Widgets.Runtime"
    }
  ]
}
```

Make the root package's `virWebAssets` facet a dependency of the normal
application target:

```lean
lean_exe my_slides where
  root := `Main
  needs := #[`@:virWebAssets]
```

Then the ordinary build produces the executable and its web assets together:

```bash
lake build my_slides
```

The facet resolves and builds every listed module facet, installs exactly one
SDK owned by the root application, verifies source and ABI compatibility, and
writes:

```text
.lake/build/vir/web-assets/
  VIR_WEB_ASSETS.json
  sdk/
    lean-vir-artifact.json
    js/...
    wasm/...
  programs/
    slides/
      Runtime.irpkg-set.json
      Runtime.irpkg
      Runtime.parts/...
    widgets/
      Runtime.irpkg-set.json
      Runtime.irpkg
```

`VIR_WEB_ASSETS.json` records the `lean_vir` version and source revision, SDK
identity and entry points, each program's package/module identity and
compatibility tuple, and SHA-256/size records for every staged payload. Program
descriptors retain their relative member layout. A version, package format,
interface manifest, runtime ABI, Lean toolchain, source revision, missing file,
or digest mismatch stops composition and removes the discovery manifest so a
partially updated directory is not advertised as valid.

The staging step is incremental. Changing one program rebuilds and restages
that program without reinstalling or recopying the SDK or unrelated programs.
Changing the selected SDK revalidates all programs and replaces only the SDK
subtree. Removing a program from the configuration removes its owned staging
directory.

The application can copy or serve this one directory without running npm,
selecting an SDK revision in nested packages, or teaching its renderer about
Lake's dependency build directories.

All entry-point and program paths in `VIR_WEB_ASSETS.json` are relative to that
manifest. A browser host can load one manifest, compile the shared Wasm module
once, and create an isolated runtime for each selected program:

```js
const manifestUrl = new URL(
  "./vir/VIR_WEB_ASSETS.json",
  window.location.href,
);
const assets = await fetch(manifestUrl).then((response) => {
  if (!response.ok) throw new Error(`failed to load VIR assets: ${response.status}`);
  return response.json();
});

if (assets.format !== "lean-vir-web-assets" || assets.version !== 1) {
  throw new Error("unsupported VIR web-assets manifest");
}

const runtimeModuleUrl = new URL(assets.sdk.runtimeModule, manifestUrl);
const { createVirRuntimeFactory } = await import(runtimeModuleUrl.href);
const factory = createVirRuntimeFactory({
  wasmUrl: new URL(assets.sdk.wasm, manifestUrl),
});

async function createProgramRuntime(id) {
  const program = assets.programs.find((candidate) => candidate.id === id);
  if (!program) throw new Error(`unknown VIR program: ${id}`);
  return factory.createRuntime({
    irPackageSetUrl: new URL(program.descriptor, manifestUrl),
  });
}

const slides = await createProgramRuntime("slides");
slides.runStartupEntries();

const widgets = await createProgramRuntime("widgets");
widgets.runStartupEntries();
```

The two runtimes above share the factory's compiled `WebAssembly.Module`, but
own separate Wasm instances, Lean heaps, host resources, and startup state.

A Verso Slides integration can expose configuration shaped like:

```lean
vir := some { module := `MySlides.Runtime }
```

That integration should depend on `@:virWebAssets`, copy the one composed
directory beside the presentation, create its mount element, wait for Reveal
initialization, load the selected program, and call
`vir.runStartupEntries()`. It should call `vir.dispose()` during page teardown
and render initialization failures visibly.

## Install The Browser SDK

```bash
lake build :virSdk
```

This installs the release matching the installed `lean_vir` package version
under `.lake/build/vir/sdk/`. The corresponding GitHub release must exist; for
an unreleased revision, select the exact pinned commit:

```bash
VIR_SDK_COMMIT=<lean-vir-revision> lake build my_slides
```

The facet derives the expected version and Git commit directly from the
resolved `lean_vir` dependency. `VIR_SDK_COMMIT` selects the unreleased artifact;
keep it set on each application build until that revision has a tagged release.
Clients do not need a separate expected-revision setting. The installer checks
the SDK version, runtime ABI, non-empty source commit, and every manifest
checksum. GitHub Actions artifact downloads
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

## Runtime Sharing Model

Several composed programs can share the SDK bytes and one compiled
`WebAssembly.Module`. Create one `VirRuntimeFactory` from the staged SDK and use
it to create a separate runtime instance for each program. This avoids repeated
Wasm compilation while preserving separate Lean heaps and startup state.

One live Wasm instance and Lean heap still load exactly one package set. A
single `+Root:vir` package set already includes the reached dependency cone for
that root. Loading several independent roots into one live instance is a
different future design; `virWebAssets` does not merge package sets or heaps.

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
