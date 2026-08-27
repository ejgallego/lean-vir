# Lake Integration

VIR provides a module facet for compiling marked Lean declarations into a
browser-loadable package set, a package facet for installing the matching
JavaScript/Wasm SDK, and a named library facet for composing one or more
explicit application roots with one SDK. This is intentionally a focused
browser-program workflow, not a general Lean-to-Wasm compiler.

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

Declare a named Lean library containing one or more explicit application roots.
The declaration supplies the owning package and exact modules through Lake's
typed target model; the facet does not discover marked modules automatically.
For a singleton bundle, the library target name is the program ID. For a
multi-program bundle, each full root module name is its program ID. IDs use the
ASCII slug alphabet `[A-Za-z0-9._-]`:

```lean
lean_lib «slides» where
  roots := #[`MySlides.Runtime]

lean_exe my_slides where
  root := `Main
  needs := #[`@/«slides»:virWebAssets]
```

The `@/` prefix selects a target in the current package. Imported package
contributions belong in an application root's dependency cone. Root wrappers
own exports and startup because annotations on imported declarations are not
promoted.

Then the ordinary build produces the executable and its web assets together:

```bash
lake build my_slides
```

The facet builds the selected root module facet, installs exactly one SDK owned
by the application package, verifies source and ABI compatibility, and
writes the SDK manifest's browser deployment profile. That profile contains the
release Wasm, browser helper, runtime module, its static JavaScript dependency
closure, and distribution metadata. The optional Node and browser-React entry
points plus the debug Wasm remain in the full SDK and are not copied into this
application:

```text
.lake/build/vir/web-assets/slides/
  VIR_WEB_ASSETS.json
  sdk/
    lean-vir-artifact.json
    README.txt
    LICENSE
    NOTICE
    js/vir-web-assets.js
    js/vir-runtime.js
    js/runtime/...
    js/host/...
    wasm/vir-upstream.wasm
  programs/
    slides/
      Runtime.irpkg-set.json
      Runtime.irpkg
      Runtime.parts/...
```

`VIR_WEB_ASSETS.json` records the `lean_vir` version and source revision, SDK
identity and entry points, each program's package/module identity and
compatibility tuple, and SHA-256/size records for every staged payload. Program
descriptors retain their relative member layout. A version, package format,
interface manifest, runtime ABI, Lean version or Git hash, source revision,
missing file, or digest mismatch stops composition and removes the discovery
manifest so a partially updated directory is not advertised as valid. The
toolchain token is canonicalized for diagnostics; Lean version and Git hash are
the authoritative compiler identity.

The version-1 manifest contract has six required top-level fields:

- `format` and `version` identify `lean-vir-web-assets` version 1;
- `hostPackage` names the application package and `vir` records the selected
  `lean_vir` version and source commit;
- `sdk` records its manifest, browser-helper, runtime-module and Wasm paths,
  identity, compatibility tuple, and complete selected `files` array, including
  the SDK README, license, and notice;
- `programs` contains each program's stable ID, package/module identity,
  descriptor path, compatibility tuple, and complete `files` array.

Every file record contains `path`, `sha256`, and `byteSize`. Every path is
relative to `VIR_WEB_ASSETS.json`; consumers should reject unsupported
top-level format or version values before resolving nested paths.

The staging step is incremental and exact. Changing one program rebuilds and restages
that program without reinstalling or recopying the SDK or unrelated programs.
Changing the selected SDK revalidates all programs and replaces only the SDK
subtree. Removing a program from the configuration removes its owned staging
directory. Unlisted files and empty directories under retained `sdk/` and
`programs/<id>/` subtrees are removed, so obsolete payloads cannot survive a
successful recomposition.

### Multiple Explicit Programs

The same named library facet is the normal `1..N` application-bundle API. A
bundle with two independent roots remains typed and stages one SDK:

```lean
lean_lib «presentation-assets» where
  roots := #[`MySlides.Runtime, `MyWidgets.Runtime]

lean_exe presentation where
  root := `Main
  needs := #[`@/«presentation-assets»:virWebAssets]
```

Its program IDs are `MySlides.Runtime` and `MyWidgets.Runtime`. Each selected
root still creates a separate runtime and heap. If both contributions must
share one live heap, import them under one application root and expose
root-owned wrappers instead.

The package-level facet and `vir-web-assets.json` remain a lower-level form for
selecting roots owned directly by several dependency packages:

```json
{
  "format": "lean-vir-web-assets-config",
  "version": 1,
  "programs": [
    {"id": "slides", "package": "my-slides", "module": "MySlides.Runtime"},
    {"id": "widgets", "package": "widgets", "module": "Widgets.Runtime"}
  ]
}
```

```lean
lean_exe multi_program_host where
  root := `Main
  needs := #[`@:virWebAssets]
```

Every entry remains explicit: `id` is its stable URL directory name, `package`
is the exact user-facing Lake package identifier, and `module` is the exact
root. For example, `package «my-slides»` is written as `"my-slides"` in JSON.
This lower-level form stages several independent programs; it does not merge
their package sets or heaps.

The application can copy or serve this one directory without running npm,
selecting an SDK revision in nested packages, or teaching its renderer about
Lake's dependency build directories.

All entry-point and program paths in `VIR_WEB_ASSETS.json` are relative to that
manifest. For a singleton manifest, omit the program ID because there is only
one valid choice:

```js
import { createVirWebAssetsRuntime } from
  "./vir/sdk/js/vir-web-assets.js";

const slides = await createVirWebAssetsRuntime(
  "./vir/VIR_WEB_ASSETS.json",
);
slides.runStartupEntries();
window.versoVir = slides;
window.addEventListener("pagehide", () => slides.dispose(), { once: true });
```

For a multi-program manifest, pass the ID explicitly or use a factory. An
omitted ID then fails with a diagnostic listing the available programs:

```js
const factory = await createVirWebAssetsFactory("./vir/VIR_WEB_ASSETS.json");
const slides = await factory.createRuntime("MySlides.Runtime");
```

The helper validates the discovery manifest, selected SDK paths, named program,
file records, and composite compatibility tuple before it imports the runtime
module and creates the program runtime. Applications selecting several
independent programs can call `createVirWebAssetsFactory()` once and then its
`createRuntime(id)` method for each program. This preserves shared Wasm
compilation while each runtime owns a separate instance, Lean heap, host
resources, and startup state.

A Verso Slides integration can expose configuration shaped like:

```lean
vir := some { module := `MySlides.Runtime }
```

That integration should declare its one-root named library, depend on the
library's `virWebAssets` facet, copy the returned composed directory beside the
presentation, create its mount element, wait for Reveal initialization, load
the selected program, and call
`vir.runStartupEntries()`. It should call `vir.dispose()` during page teardown
and render initialization failures visibly.

## Install The Browser SDK

```bash
lake build :virSdk
```

This installs the SDK under `.lake/build/vir/sdk/`. The facet derives the
expected VIR version and Git commit directly from the resolved `lean_vir`
dependency; clients do not need `VIR_SDK_COMMIT` alongside their Lake pin.

An exact `v<version>` Git dependency selects the durable release SDK. For a
clean untagged dependency on the same Lean toolchain, the facet first reuses a
validated cache and then tries the matching authenticated CI artifact as a fast
path. [Actions artifacts are temporary](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository?apiVersion=2022-11-28);
if one is unavailable, expired,
inaccessible, or absent, the automatic policy explains the failure and builds
the exact SDK locally. Lookup filters workflow runs by the dependency
`head_sha` and paginates both runs and their artifacts.
Dirty, vendored, or otherwise unidentified VIR sources are rejected before SDK
selection; an empty commit is never used as provenance and a matching version
string never manufactures release identity.

When the consuming workspace uses another Lean toolchain, the facet goes
directly to the same local build path. It builds from the resolved clean VIR
checkout and the exact Lean revision embedded in the consumer's compiler, and
caches the Lean source, build tree, and WASI SDK under
`.lake/build/vir/sdk-build-cache/`. The first build therefore needs Git,
Node/npm, and network access. Set `LEAN4_SRC` to an existing exact Lean source
checkout or `WASI_SDK_PATH` to an existing WASI SDK to reuse local tools. This
path fetches the exact Lean githash reported by the consumer compiler; it does
not treat the Elan toolchain token as a Git branch. It changes SDK acquisition,
but does not relax the program/SDK Lean version or Git-hash checks.

Set
`VIR_SDK_ARCHIVE=/path/to/lean-vir-sdk.tar.gz` to use a local or CI-provided
archive without network access. `VIR_SDK_URL`, `VIR_SDK_TAG`, and
`VIR_SDK_COMMIT` remain explicit source overrides; these are strict and never
silently switch to another source. Lake tracks the selected
source and local archive contents when caching the facet. Before accepting a
cached SDK manifest, the facet compares the installed VIR version and commit
with the resolved dependency and rechecks every listed payload checksum. A
stale identity, dirty producer, missing payload, or modified payload invalidates the manifest
target and reinstalls the SDK from the selected source. Locally built SDKs also
recheck the consumer's current Lean identity before reuse.

The Lake SDK/composition path is supported and tested on Linux and macOS. It
requires Node, Git, `curl`, `tar`, and `unzip`; hashing and temporary-directory
handling are portable across those hosts. Native Windows clients are not yet
an advertised target.

This standalone facet is intended for custom artifact assembly. Pair it with a
separately built `+Module:vir` descriptor, publish every referenced `.irpkg`
while preserving its relative layout, and load the set as described in
[Module Package Sets](JS_API.md#module-package-sets). Application hosts should
prefer the composed web-assets workflow above.

## Runtime Sharing Model

Several composed programs can share the SDK bytes and one compiled
`WebAssembly.Module`. Create one `VirRuntimeFactory` from the staged SDK and use
it to create a separate runtime instance for each program. This avoids repeated
Wasm compilation while preserving separate Lean heaps and startup state.

One live Wasm instance and Lean heap still load exactly one package set. A
single `+Root:vir` package set already includes the reached dependency cone for
that root. Loading several independent roots into one live instance is a
different future design; `virWebAssets` does not merge package sets or heaps.

For one application spanning several Lake packages, select one explicit
application-owned root. That root imports and calls each dependency
contribution, owns the public `@[vir_export]` wrappers, and owns the
`@[vir_startup]` wrapper that determines initialization order. An annotation on
an imported declaration is not promoted into the selected root's interface;
the root must retain and expose that declaration explicitly. The resulting one
package set can then be loaded with one `createRuntime` call and one startup
sequence. The
[cross-package runtime regression](../tests/runtime/cross-package-one-runtime-smoke.mjs)
locks this application-root contract without adding a runtime primitive.

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
