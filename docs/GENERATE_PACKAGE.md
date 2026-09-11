# Package Generator

VIR packages compiled Lean modules or live module snapshots through one
declaration index, closure collector, interface validator and emitter.
Non-module developments and source-file package loading are unsupported.
Use [Packages](PACKAGES.md) for commands, facets and caches, and the
[format reference](IRPKG_FORMAT.md) for binary and manifest schemas.

## Entry points and selection

[`tools/GeneratePackage.lean`](../tools/GeneratePackage.lean) parses CLI targets
and calls `Vir.GeneratePackage.run`. Lake builds it as `.lake/build/bin/vir_irpkg`,
used by the npm package scripts and fixture runner. Targets are required; the
browser catalog, not the generator, owns demo roots and package composition.

A target has an independent `PackageTargetOrigin` (compiled module or live
snapshot) and four-case `TargetMode`. Compiled-module CLI forms are:

| Arguments | Selection |
| --- | --- |
| `--target-module <module> <root>...` | Export explicit roots, including intentionally selected imported declarations. |
| `--package-module <module> <root>...` | Include roots without exporting them. |
| `--target-all-module <module>` | Export public definitions owned by that module. |
| `--target-marked-module <module>` | Export that module's marked exports/startups, excluding dependency markers. |

The same module can participate in several selections and is acquired once
per invocation. Module inputs do not imply marked-only selection or sharded
output. The Lake `:vir` facet supplies internal `--module-set-output`
descriptor/shard destinations and requires a marked-module root. Only the wire
encoder maps compiled-module plus marked selection to `markedModule`; live
marked targets use `marked`.

## Input contract

### Compiled modules

Lake owns compilation. The generator calls Lean's direct `importModules` API
through `importModuleEnv`, without a source frontend or generated import driver.
Source commands such as `#eval` execute during compilation, not again during
packaging. Build the named module and artifacts before invoking the executable.

Acquisition preserves `module; import all M` semantics: ordinary/meta `Init`
imports, private target IR, persistent extensions and module-system visibility.
It explicitly requests the exported import level; Lean's default private level
would bypass module restrictions. Missing artifacts and non-module inputs fail
with Lean's import error. This internal import context produces no frontend-only
lint warnings.

Input identity is a typed module/snapshot identity, not a display label or
canonical source path. Configuration normalization and package planning are
pure; acquisition and filesystem reads/writes belong to orchestration. Source
locations are provenance for diagnostics and navigation, never loader keys.

### Live snapshots

`prepareSnapshotInput` uses the editor's current environment, including unsaved
and private local IR. The document requires `module`, even when every requested
root is imported, but does not need to be saved. Preparation rejects non-module
environments before closure, revision or emission; both package RPC methods map
that rejection to `invalidParams`.

The prepared input pairs a snapshot target (module identity and document
provenance) with its `DeclIndex`. Stat, revision and emission use that same
environment. RPC tasks neither reacquire the source through the filesystem nor
run another frontend or enable global initializer execution. Declaration lookup
prefers already-loaded server IR over opaque imported entries, including
private dependency bodies.

The adapter assigns snapshot-local IR, including private/generated helpers, to
`env.mainModule` and records the module as already loaded. Owner resolution must
never reopen its disk artifact over unsaved edits. Imported declarations retain
their imported-module owners; document paths remain available for diagnostic
source ranges and revision calculation.

### Compatibility boundaries

Version-2 package configs use actual Lake module names. Source flags `--target`,
`--package-target`, `--target-all` and `--target-marked`, source-path aliases,
canonical-path caches and non-module Lake fallbacks are rejected or removed.
Adding `module` changes default visibility: use `public` or `public section`
for intended interface declarations rather than exporting all dependencies.

Local label removal does not retract compiled marker additions; see
[marker visibility](PACKAGES.md#marker-validation-and-visibility). VIR adds no
persistent removal metadata. Runtime ABI, manifest compatibility and raw-byte
or package-set transport remain independent of input acquisition.

Analysis tools may still elaborate sources, and historical benchmark catalogs
use their pinned producers. Neither is a package-generator fallback. External
adapters require matching module-capable dependencies/toolchains; they must not
rewrite downstream sources or silently override dependency pins.

## Implementation ownership

The public shim and pipeline library use Lean's module system. Downstream
`module` sources may `public import Vir.GeneratePackage` or import a narrower
module. The map below groups shared policy separately from orchestration;
[surface analysis](SURFACE_ANALYSIS.md) owns the independent analysis tools.

| Boundary | Source owners |
| --- | --- |
| Targets and acquisition | [`Basic`](../Vir/GeneratePackage/Basic.lean) defines targets, collected declarations and limits. [`Inputs`](../Vir/GeneratePackage/Inputs.lean) owns compiled/live acquisition, `DeclIndex`, markers, fallback adapters, declaration ownership, on-demand import-all environments and collision diagnostics. |
| Names and dependency closure | [`LeanName`](../Vir/LeanName.lean) parses strict dotted names for tools and clients. [`IRDependencies`](../Vir/IRDependencies.lean) walks IR references and formats dependency paths; [`Closure`](../Vir/GeneratePackage/Closure.lean) resolves roots and collects typed IR. [`ExternFallback`](../Vir/ExternFallback.lean) owns transparent extern-body clones and recursion rejection. |
| Native and host metadata | [`NativeExterns`](../Vir/GeneratePackage/NativeExterns.lean) owns VIR's registration policy; resolved compiler metadata and wrappers remain with [native tooling](../scripts/native/README.md). [`HostMetadata`](../Vir/HostMetadata.lean) is the single encoder/decoder of VIR targets in Lean extern symbols. |
| Interface policy | [`Interface.Model`](../Vir/Interface/Model.lean) defines descriptors, effects, layouts and boundaries. [`InterfaceValidation`](../Vir/InterfaceValidation.lean) owns typed binder/startup preflight, effects and abbreviation reduction. [`ExportValidation`](../Vir/ExportValidation.lean) checks visible compiled closures and defers opaque imports; [`Attributes`](../Vir/Attributes.lean) owns declaration-kind/postponed-compilation handling. |
| Classification and collection | [`Interface.Classify`](../Vir/Interface/Classify/) separates typed errors, helpers, type/layout classification and signature analysis. [`HostValidation`](../Vir/HostValidation.lean) shares host signature/boundary policy between attributes and packaging. [`Interface.Collect`](../Vir/GeneratePackage/Interface/Collect.lean) adds boxed-boundary, call-summary, duplicate and host-import collection checks. |
| Encoding | [`PackageFormat`](../Vir/GeneratePackage/PackageFormat.lean) owns format identities, versions and section kinds. [`PackageIRTags`](../Vir/GeneratePackage/PackageIRTags.lean) owns Name/IR tags. [`Interface.Encode`](../Vir/GeneratePackage/Interface/Encode.lean), [`Manifest.Encode`](../Vir/GeneratePackage/Manifest/Encode.lean), [`Json`](../Vir/GeneratePackage/Json.lean) and [`Emit`](../Vir/GeneratePackage/Emit.lean) encode descriptors, metadata and package bytes. |
| Output | [`Manifest`](../Vir/GeneratePackage/Manifest.lean) assembles metadata/interface diagnostics, [`Report`](../Vir/GeneratePackage/Report.lean) renders them, and [`Run`](../Vir/GeneratePackage/Run.lean) orchestrates generation and filesystem writes. |

## Data flow and initialization

1. The CLI constructs targets with independent origin and selection. Compiled
   inputs use `importModuleEnv`; server inputs use `prepareSnapshotInput`.
2. `Inputs.loadDeclIndex` records input environments, owned IR names and marker
   sets. All-public and marked selection filter to the requested module.
   Different module targets defining the same Lean declaration name produce a
   diagnostic: name-indexed closure lookup must not depend on target order.
3. `Closure.collectClosure` resolves roots and generated boxed entrypoints, then
   walks typed IR references. Every selection mode follows opaque declaration
   ownership, acquiring newly reached owners until the closure is complete or
   no more IR is available. Explicit extern fallbacks supply an original-name
   adapter whose closure reaches the compiled reference body.
4. `Interface.collectHostImports` repeats typed `Vir.HostValidation` for reached
   imports, then checks package-only IR arity and slot limits.
5. `Manifest.collectInterfaceManifest` shares marker preflight with attributes,
   classifies callable exports, includes host/index diagnostics, and rejects
   duplicate export ids and JavaScript names. Successful startup preflight
   already supplies its zero-argument `Unit` signature/effect; it is not
   classified again.
6. `Report.reportFor` lists the same resolved roots recorded in metadata,
   followed by closure contents, externs, imports, exports and diagnostics.
   `Emit.emitPackage` emits bytes only when closure and manifest diagnostics
   permit an unambiguous, supported package.
7. `Run.runModuleSet` partitions a successful closure by owning module and
   filters Lean's dependency-first runtime order to reached owners, ignoring
   meta-only import edges. Each initializer/global pair stays in its owning
   member with its multiplicity preserved. Dependency manifests have no public
   surface; the root retains the aggregate interface.

Selection is declaration-driven: an otherwise-unreferenced import is not
included merely because it has an initializer. A reached `@[vir_startup]` hook
is the appropriate root for browser lifecycle work. Facet output ownership and
cache invalidation are documented in [Packages](PACKAGES.md#rebuilds-and-output-ownership).

## Shared interface analysis

`Vir.Interface.analyzeExportInterface` composes representation-independent
binder/startup preflight with full type/layout classification. Attributes and
package generation use the same typed path. Host-import attributes similarly
run the complete signature classifier and JavaScript boundary policy.
Packaging reruns these checks for explicit roots and raw marker/extern metadata,
then adds boxed-boundary, IR arity, slot, duplicate and dependency checks.

Classification tries the source type as written first, unfolding reducible
abbreviation heads only when the outer shape is unsupported. This admits aliases
such as `abbrev UserId := Nat` and effect aliases while preserving primitive,
container and resource handling. Core/signature classification returns
`InterfaceClassifierError` values with nested type context. Host validation
composes them with typed boundary errors; each user boundary renders diagnostics
there, rather than sharing preformatted success/failure strings.

Supported layouts and descriptor fields are specified in
[IRPKG_FORMAT.md](IRPKG_FORMAT.md#interface-descriptors).

## Version changes

[`PackageFormat`](../Vir/GeneratePackage/PackageFormat.lean) owns Lean's binary,
manifest and package-set versions and descriptor identity.
[`package-versions.mjs`](../scripts/packages/package-versions.mjs) owns the
JavaScript expectations for binary, manifest and runtime ABI compatibility.
`npm run check:package-abi` checks identities, versions and sections across
Lean/Lake/C++/JS, plus interface tags and host-boundary tables.

| Version | Bump for an incompatible change to | Update together |
| --- | --- | --- |
| `packageFormatVersion` | Binary encoding or decoder contract. | JS format expectation, runtime decoder, package fixtures and [format reference](IRPKG_FORMAT.md). |
| `manifestVersion` | Embedded fields, descriptor shapes or their semantics for callers. | Manifest validator, runtime smokes and [IRPKG_FORMAT.md](IRPKG_FORMAT.md). |
| `currentPackageSetVersion` | Descriptor shape or semantics. | Lake validator, JS loader, descriptor smokes and format reference. Change `packageSetFormat` only for a different descriptor family. |
| `runtimeAbiVersion` | SDK compatibility outside the embedded schemas, such as Wasm host ABI or JS runtime contract. | SDK artifact metadata, installers and affected runtime checks. |

Runtime ABI is SDK metadata, not embedded package metadata. The same artifact
metadata records exact build-time React/ReactDOM versions from
`package-lock.json` for the optional React host. ABI 2 requires the
manifest/binary validation entrypoint and deeply freezes installed manifest
metadata; installers reject older ABIs before replacing an SDK.

Name and declaration-IR tags are a separate wire contract owned by
`PackageIRTags.lean`; `scripts/native/ir-codec-tags.mjs` maps C++ enums and
reserved slots. Run `npm run generate:ir-codec-tags` and
`npm run check:ir-codec-tags` after editing assignments. The check also verifies
that emitter/decoder use every non-reserved tag. See the
[format's tag rules](IRPKG_FORMAT.md#ir-tags-and-decoded-ownership) before
renumbering; unsupported `IRType.struct` and `IRType.union` slots remain reserved.

## Troubleshooting

Lean reports conclusive visible-closure and marker-signature failures at the
declaration. Package diagnostics still cover explicit roots, opaque imported
IR, postponed compilation, generated boundaries, raw metadata and package-wide
constraints. The three closure-blocker report sections append one
first-discovered root-to-blocker path after `via`; the CLI prints the same path.

| Report or diagnostic | Meaning and next check |
| --- | --- |
| `Missing IR Declarations` | Check module identity, imports, explicit roots and package-only support targets. Automatic owner loading normally supplies module-system dependencies; a remaining failure means ownership is unresolved or the owner supplies no compiled body. |
| `Missing Native Extern Registrations` | The closure needs a registered runtime provider. Review `NativeExterns`, check native externs, and regenerate/check the boundary registry if entries change. |
| `Unsupported Init Globals` | Reached initialization-backed state lacks an initializer function in the loaded inputs. |
| `Package Diagnostics` | Unsupported interface types/layouts, duplicate export ids/JS names or declaration-name collisions. Inspect the requested boundary and report. |
| Boxed boundary diagnostics | Top-level `Float`, `Float32`, `UInt64` and trivial wrappers over them need compiler-generated `_boxed` companions at the wasm32 boundary. Generation includes an available companion and fails explicitly when it is missing. |

## Review and validation

| Boundary | Evidence to preserve |
| --- | --- |
| Selection | Four modes; repeated/empty targets; imported explicit roots; no dependency marker leakage. |
| Closure | Private/transitive/diamond imports, opaque IR, generated boxed entries and missing-body errors. |
| Initialization | Dependency-first order, exact initializer pairs/multiplicity, once-only owner partitioning and extern fallbacks. |
| Editor | Unsaved edits change revision/bytes; private locals stay local; stat/build agree; non-module rejection is explicit. |
| Compilation | No source re-elaboration; downstream builds, relocation, cache invalidation and missing/corrupt artifacts. |
| Diagnostics | Attribute/type rejection is distinct from package-time interface/closure rejection; changed reports remain actionable. |
| Runtime/UI | Comparable host/Wasm oracles, correct source links and real React/browser behavior. |

Choose commands from [HARNESS.md](HARNESS.md#package-and-fixture-work), including
module-input/CLI, Lake facet and infoview snapshot checks where affected.
Descriptor/classifier and raw-metadata changes need package-generation coverage;
new supported shapes need a targeted fixture. Inspect reports when diagnostics
change. Public library/import-layout changes require
`bash scripts/build-lean-lib.sh`. Version changes need refreshed package/runtime
artifacts and the ABI/tag checks, not only constant agreement. External client
execution and changed RPC/runtime combinations require acceptance at the exact
checkpoint; successful package generation alone does not establish it.
