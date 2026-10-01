# Package tooling reference

Applications follow [library-owned setup](EMBEDDED_RESOURCES.md). This page
documents lower-level tools retained for VIR development and existing
integrations, not an alternative first-release application workflow.

The module `:vir` facet writes compiler package files; `:virSdk` installs the
JavaScript/Wasm distribution used by older hosts. Repository npm commands select
declarations for demos and tests. Applications do not manually assemble these
outputs or run the commands below.

[Direct runtime calls](CALL_LEAN_FROM_JS.md) describes the repository development
runner, not normal application setup.
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

The supported compatibility tuple is manifest 9, package format 11 and runtime
ABI 4. Generate the package set and install the JavaScript/Wasm SDK from the
same `lean_vir` revision. After changing that revision or the generator,
regenerate the `.irpkg` members and descriptor and reinstall the matching SDK.

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
or SHA-256 differs from the descriptor, is repaired from the shared compiled
program result. Verification and hashing run in the native Lean tool; this path
does not require Node.

Compiled inputs use Lake's resolved artifact paths, including cache-only hits
with no conventional `.olean` or `.ir` files restored under `.lake/build`.
The facet carries root and transitive private/IR artifacts through a local Lean
setup file; later owning-module loads use the same mapping. No cache restoration
setting is required. The setup file is build-local input metadata, not part of
the published package set; output locations and descriptor ownership are unchanged.

The marked program is one cached Lake result, shared with `virResourcePack`.
Its key includes full implementation/location traces, compiler/producer identity,
root selection and native profile. A program edit regenerates every reached
member; unchanged members are not independently cached. The loose-file adapter
preserves the existing output names and installs the descriptor last. Repairing
loose outputs does not rerun IR analysis. This is build-directory publication,
not a transactional deployment mechanism for concurrent readers.
Non-module inputs fail explicitly and invalidate stale outputs, including when
replacing a previously successful module; there is no source fallback.

The internal result reuses the validated resource-pack container and its bounded
inventory (4096 files, 512 MiB of payload). It is not a public resource recipe:
roles/support files and runtime acquisition do not affect its identity. Reports
and setup maps remain build-local and are not embedded in public resources.

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

Startup runs once per runtime, invoking hooks in manifest order. After success,
repeated calls do nothing. Failure stops the sequence and throws the error;
later startup calls report failure without retrying the failed hook or running
remaining hooks. Effects already performed are not rolled back. Enable the
application only after startup succeeds. Synchronous host reentry does not invoke hooks
recursively. Ordinary exported calls can still return recoverable errors;
a fatal host failure or Wasm trap retires the runtime. When selecting another
package generation, create a new runtime and dispose the previous runtime when
its callbacks and resources should become invalid.

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

Use a configuration file to select the module and its exports:

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

For the bundled quickstart, run `npm run prepare:irpkg -- examples/quickstart.virpkg.json`,
then `npm run dev -- --port 5173` and open
`http://127.0.0.1:5173/dev.html?package=local-quickstart.irpkg`.

The command builds the module and generator with Lake, then loads compiled IR.
Source commands such as `#eval` run during compilation, never again during
packaging. Reached opaque imports are materialized through their owning modules
and folded into the single output package; the Lake facet uses the same closure
logic but emits members by owner. The report lists closure declarations, native
externs, initializers and diagnostics; unsupported interfaces exit nonzero.

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

`entry` accepts a manifest `entry`, `id`, or `jsName` alias from the
[shared call namespace](JS_API.md#calls-and-manifest). The Pages
build's `prepare:pages` step generates URL-loadable samples in one generator
session; [HARNESS.md](../HARNESS.md) owns site build/check commands. Generated
packages, reports and `web/dist/` remain ignored local outputs.

After a fatal Wasm failure, the runner disables Run and offers **Reload
runtime**. Reload creates a fresh instance while preserving the selected entry
and inputs; it does not execute the entry again. Ordinary input errors and
recoverable Lean IO errors leave Run available for a corrected attempt.

The [JS API](JS_API.md#calls-and-manifest) defines caller values, while
[host bindings](../reference/HOST_BINDINGS.md) defines the narrower Lean-to-JavaScript
boundary. The runner needs the package's embedded manifest, not a separate
interface sidecar.
