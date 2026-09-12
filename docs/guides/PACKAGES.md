# Packages

VIR packages selected Lean declarations for its browser runtime. Downstream
projects use Lake's module `:vir` facet to build a package set and its package
`:virSdk` facet to install the matching JavaScript/Wasm SDK. The repository's
npm commands build focused, single-member packages for local development.
This is a browser-program workflow, not a general Lean-to-Wasm compiler.

For application calls, follow [Call Lean from JavaScript](CALL_LEAN_FROM_JS.md).
[Generator internals](../reference/GENERATE_PACKAGE.md) owns compiled/live input selection;
[the format reference](../reference/IRPKG_FORMAT.md) owns binary and manifest schemas.

## Add the Lake dependency

Pin `lean_vir` to a release tag or exact commit in the client `lakefile.lean`:

```lean
require lean_vir from git
  "https://github.com/ejgallego/lean-vir" @ "<tag-or-commit>"
```

Resolve it once with `lake update lean_vir`. Use the same revision when
[selecting an unreleased SDK](#install-the-browser-sdk).

## Mark the browser surface

Import `Vir.Browser` for browser types and `Vir.Attributes` at meta time for
the markers. The umbrella `Vir` module remains available for sources that need
the whole public surface.

```lean
module

public import Vir.Browser
meta import Vir.Attributes

public section

open Lean.Vir.Browser

namespace MySlides.Runtime

@[vir_export]
def answer : Nat := 42

@[vir_startup]
def mount : DomM Unit := do
  let document ← Document.current
  let selector ← Lean.Vir.JsValue.ofString "#vir-slide-root"
  let some root ← Lean.Vir.Js.Nullable.toOption (← Document.querySelector document selector) | pure ()
  let text ← Lean.Vir.JsValue.ofString "This DOM was updated from Lean"
  Element.setTextContent root (← Lean.Vir.Js.Nullable.ofJs text)

end MySlides.Runtime
```

`@[vir_export]` makes a declaration callable with `vir.call(...)`.
`@[vir_startup]` also exports it, sets `startup: true` in the manifest, and lets
`vir.runStartupEntries()` invoke it. Startup hooks take no JavaScript arguments
and return `Unit`, possibly through a supported effect such as `DomM`.
Ordinary exports use the supported [interface value shapes](JS_API.md#calls-and-manifest).
Sources that only need marker metadata can use `meta import Vir.Attributes`
without the browser library.

### Marker validation and visibility

After compilation, both markers reject private or non-executable declarations
and unavailable dependencies visible in the compiled closure. Exports also
reject erased, implicit and instance binders, unsupported interface types, and
unsupported runtime layouts. Startup diagnostics identify unexpected parameters,
non-`Unit` results and unsupported effects. Closure errors include a path from
the marked declaration to the blocker.

At an opaque module import, attribute validation identifies the dependency
whose compiled IR packaging needs. The generator loads its owning module and
includes only reached declarations. If no compiled body is available, it
reports the original root-to-boundary path. Disable `compiler.postponeCompile`
for package inputs so Lean can produce the required IR. Package generation
still checks raw markers, generated boxed boundaries and package-wide limits.

Marked selection belongs to the requested module: dependency markers do not
implicitly re-export declarations. A marked build with no matching declarations
fails instead of producing an empty package.

Lean's `attribute [-vir_export]` and `attribute [-vir_startup]` remove labels
only from the local elaboration environment. Compiled imports restore recorded
additions. To change a compiled package's interface, remove the original
annotation or attribute addition and rebuild. A live editor snapshot observes
the local labels at its position and can differ from the compiled module.

## Use a Lean extern reference body

An imported `@[extern] def` normally remains a native boundary. To select its
Lean definition as a portable implementation for this package, place an
explicit request before marking the entrypoint:

```lean
vir_extern_fallback Upstream.acceleratedRead, Upstream.acceleratedWrite
```

The command accepts only extern definitions with transparent kernel bodies. It
rejects opaque/bodyless declarations, non-externs, duplicates and directly
recursive fallbacks. Lean's native compiler continues to use the extern.
For VIR, the command compiles a reserved-name reference-body clone, exported
internally so `import all` can load it. The package emits an adapter at the
original name, preserving the extern's IR parameter ownership while calling
the clone. Newly exposed dependencies still need ordinary IR or a registered
native provider. This is an explicit portability choice; it adds neither a
shared-runtime extern registration nor general dynamic lookup.

## Build a module package set

```bash
lake build +MySlides.Runtime:vir
```

The facet requires a `module` source and Lake's compiled `.ir` artifact. It
passes the module identity directly to the generator, without a generated
driver or source re-elaboration, and returns the descriptor under
`.lake/build/vir/module-sets/`:

```text
MySlides/Runtime.irpkg-set.json
MySlides/Runtime.irpkg
MySlides/Runtime.parts/0.irpkg
MySlides/Runtime.report.md
```

The root selects one `markedModule` target. Reached dependency modules precede
it in Lean's dependency order, excluding meta-only import edges. Each member
owns its declarations and initializer metadata; only the root owns exports,
export summaries, native extern registrations and the aggregate host-import
table. Importing an otherwise-unreferenced module solely for initializer side
effects does not include it. Expose browser lifecycle work as a reached
`@[vir_startup]` hook.

Every member is an ordinary format-11 `.irpkg`. The descriptor binds its module,
role and bytes; the runtime validates the set before running initializers.
See the [descriptor schema](../reference/IRPKG_FORMAT.md#package-set-descriptor) and
[load transaction](../reference/UPSTREAM_BOUNDARY.md#package-instance-lifecycle) for exact
ordering, integrity and duplicate-identity rules. Browsers load neither
`.olean` nor Lean's raw `.ir` files.

An executable or renderer consuming this output should declare the facet as a
build dependency:

```lean
lean_exe my_slides where
  root := `Main
  needs := #[`+MySlides.Runtime:vir]
```

### Rebuilds and output ownership

The facet tracks Lake's transitive import artifacts, so imported implementation
changes regenerate the set even when the root's public interface and `.olean`
stay unchanged. The selected `VIR_NATIVE_EXTERN_MANIFEST` path and contents are
also inputs. A missing root, report or listed shard, or a member whose length
or SHA-256 differs from the descriptor, invalidates the cached target. Size
checks use filesystem metadata; one portable Node crypto invocation hashes all
members.

Compiled inputs use Lake's resolved artifact paths, including cache-only hits
with no conventional `.olean` or `.ir` files restored under `.lake/build`.
The facet carries root and transitive private/IR artifacts through a local Lean
setup file; later owning-module loads use the same mapping. No cache restoration
setting is required. The setup file is build-local input metadata, not part of
the published package set; output locations and descriptor ownership are unchanged.

The descriptor is one Lake target. Invalidating it regenerates every reached
member; unchanged members are not independently cached. Before generation the
facet removes the previous descriptor, root and root-specific shard directory.
Non-module inputs fail explicitly and invalidate stale outputs, including when
replacing a previously successful module; there is no source fallback.

Module identities and ordinal shard names avoid checkout-local paths in the
package set. Manifests omit wall-clock timestamps, so identical
source/toolchain/profile inputs can produce identical bytes across build
directories. The diagnostic report retains its generation timestamp.

## Install the browser SDK

```bash
lake build :virSdk
```

This installs the release matching the installed `lean_vir` package version
under `.lake/build/vir/sdk/`. That GitHub release must exist. For an unreleased
revision, select the exact dependency commit:

```bash
VIR_SDK_COMMIT=<lean-vir-revision> lake build :virSdk
```

The installer verifies the selected commit, SDK version, runtime ABI, non-empty
source commit and every manifest checksum. Actions artifact downloads require
`GITHUB_TOKEN` or authenticated `gh`. Set
`VIR_SDK_ARCHIVE=/path/to/lean-vir-sdk.tar.gz` for a local or CI archive without
network access. Lake tracks the selected source and local archive contents;
cached SDK manifests recheck every payload checksum and reinstall missing or
modified payloads from the configured source.

Publish the SDK, descriptor and every referenced `.irpkg`, preserving the
descriptor's relative layout. Member URLs resolve relative to its served URL:

```js
import { createVirRuntime } from "./vir/sdk/js/vir-runtime.js";

const vir = await createVirRuntime({
  wasmUrl: "./vir/sdk/wasm/vir-upstream.wasm",
  irPackageSet: "./vir/module-sets/MySlides/Runtime.irpkg-set.json",
});
vir.runStartupEntries();
```

Startup hooks run in manifest order and are recorded only after success. A
retry skips completed hooks and resumes at the failed hook. Successful package
replacement resets that state; failed replacement preserves it. The
[replacement API](JS_API.md#replacing-a-package-set) owns candidate failure,
old-generation invalidation and cleanup-failure behavior.

The [SlidesCanvas example](../../examples/SlidesCanvas.lean) creates its DOM and
canvas and schedules animation frames entirely from Lean:

```bash
lake build +SlidesCanvas:vir
```

See the [browser library](LEAN_VIR_LIBRARY.md) for the canvas and animation API.

## Generate a local package

The npm workflow operates in this repository's Lake workspace. Register the
module in the appropriate `lean_lib` roots/globs, such as `VirExamples.roots`
for `examples/MyApp.lean`. Sources must begin with `module`; expose intended
callable definitions with `public def` or `public section`. Independent
downstream projects use the Lake workflow above.

For the bundled quickstart, run `npm run quickstart`, then
`npm run dev -- --port 5173` and open the printed URL. The general CLI is:

```bash
npm run generate:irpkg -- <Module.Name> [package.irpkg] [root ...]
```

Select explicit exports, or omit roots to export the module's public definitions:

```bash
npm run generate:irpkg -- Quickstart web/public/local-quickstart.irpkg Quickstart.double Quickstart.greet
npm run generate:irpkg -- Fib build/generated/local.irpkg
```

The command builds the module and generator with Lake, then loads compiled IR.
Source commands such as `#eval` run during compilation, never again during
packaging. Reached opaque imports are materialized through their owning modules
and folded into the single output package; the Lake facet uses the same closure
logic but emits members by owner.

Use the actual module identity, not a source path or Lake target/facet syntax.
Without an output path, `App.Widget` writes `build/generated/Widget.irpkg` and
`Widget.report.md`; quoted module names require an explicit path. A successful
command prints format/toolchain metadata, declaration/export/host-import counts,
targets and resolved roots. Its report also lists closure declarations, native
externs, initializers and diagnostics. Unpackageable exports or unsupported
interfaces exit nonzero and point to the report.

## Configure package generation

```json
{
  "version": 2,
  "module": "Fib",
  "package": "web/public/local-fib.irpkg",
  "report": "build/generated/local-fib.report.md",
  "roots": ["fib"]
}
```

```bash
npm run prepare:irpkg -- examples/fib.virpkg.json
npm run prepare:irpkg -- examples/quickstart.virpkg.json examples/fib.virpkg.json
```

`roots` is the only selection setting. A nonempty array selects exactly those
exports; omission or `[]` selects all public definitions of the module. An
unsupported public export fails with report diagnostics. Prefer explicit roots
for a stable interface or size-sensitive experiment.

Validation rejects unknown fields, wrong types, `includeAll` and version-1
source configs before building. Migrate `source` to the actual Lake module
identity, not a mechanical path conversion. Config version 2 is independent of
binary and manifest versions.

`package` defaults to `build/generated/<last module component>.irpkg`.
`report` replaces the package's `.irpkg` suffix with `.report.md`, or appends
that suffix for another extension. Paths are repository-relative, not relative
to the config file. Quoted module names require an explicit package path.
Batches reuse one generator and deduplicate module builds. Package/report
destinations must be distinct across the batch; normalized collisions fail
before building or writing.

## Inspect a package

The inspector reads the embedded manifest from the package itself:

```bash
npm run inspect:irpkg -- build/generated/local.irpkg
npm run inspect:irpkg -- --json build/generated/local.irpkg
```

Text output includes the envelope, section directory, metadata, targets,
exports, host imports, argument/result types and diagnostics. `--json` emits
the parsed header and full manifest for tooling or bug reports. The
[format reference](../reference/IRPKG_FORMAT.md) defines the fields.

## Load the development runner

Run `npm run dev` and open `/dev.html`. Choose a preset, upload a package from
disk, or enter a served URL (`fixtures-basic.irpkg`, for example, resolves to
`web/public/fixtures-basic.irpkg`). The runner creates a fresh Wasm instance,
reads the manifest and generates controls, including enum selects and JSON
inputs for compound values, structures and `Lean.Expr`.

An `.irpkg` selection is a focused one-member set; `.irpkg-set.json` URLs load
complete module sets. Application code uses `irPackageSet` for either form.
Deep links select a package and entry:

```text
dev.html?package=local-quickstart.irpkg&entry=Quickstart.total
```

`entry` accepts a manifest `id`, `jsName` or Lean declaration name. The Pages
build's `prepare:pages` step generates URL-loadable samples in one generator
session; [HARNESS.md](../HARNESS.md) owns site build/check commands. Generated
packages, reports and `web/dist/` remain ignored local outputs.

The [JS API](JS_API.md#calls-and-manifest) defines caller values, while
[host bindings](../reference/HOST_BINDINGS.md) defines the narrower Lean-to-JavaScript
boundary. The runner needs the package's embedded manifest, not a separate
interface sidecar.
