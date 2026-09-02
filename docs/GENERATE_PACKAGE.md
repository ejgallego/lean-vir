# Generate Package

This note is the maintainer map for the Lean package generator. User-facing
local package workflow stays in `docs/LOCAL_IRPKG.md`; manifest and supported
interface type details stay in `docs/INTERFACE_PIPELINE.md`.

## Entry Points

- `tools/GeneratePackage.lean` parses CLI target arguments and calls
  `Vir.GeneratePackage.run`.
- `tools/AnalyzeSurface.lean` scans installed Lean library IR against VIR's
  runtime capabilities; it does not generate a package.
- `scripts/analysis/render-surface-report.mjs` turns a surface JSON report into
  a static, lazily loaded HTML module browser.
- `Vir/GeneratePackage.lean` is the public import shim for the split library.
- `.lake/build/bin/vir_irpkg` is the Lake executable used by
  `scripts/packages/lean-to-irpkg.mjs`,
  `scripts/packages/generate-browser-package.mjs`, and the fixture runner.

Targets have one of five modes:

- `--target <source.lean> <root>...`: package explicit roots and export them.
- `--package-target <source.lean> <root>...`: include roots in the package
  closure without making them JavaScript-callable exports.
- `--target-all <source.lean>`: auto-discover public source definitions as
  roots and exports.
- `--target-marked <source.lean>`: package declarations marked with
  `@[vir_export]` or `@[vir_startup]` in a source file.
- `--target-marked-module <driver.lean> <module>`: package marked declarations
  owned by one imported module while excluding marked declarations from its
  dependencies. The CLI's internal
  `--module-set-output` arguments provide descriptor and shard destinations to
  the Lake `:vir` facet.

Every target mode follows opaque declaration ownership and loads the reached
module IR before validating the final closure. The module-marked mode also
retains declaration ownership for composable package-set emission.

## Module Map

The public shim and every library module in the package-generation pipeline use
Lean's module system. Downstream `module` sources may import the whole pipeline
with `public import Vir.GeneratePackage` or select a narrower module below.

- `Vir.Interface.Model`: package-independent interface types, effects, runtime
  field layouts, host boundary kinds, and their user-facing labels.
- `Vir.GeneratePackage.Basic`: package targets, collected declarations,
  manifests, package ABI limits, and default browser targets.
- `Vir.GeneratePackage.PackageFormat`: package magic, package section kinds,
  and current package/interface-manifest version constants used by generated
  bytes and metadata.
- `Vir.GeneratePackage.PackageIRTags`: source of truth for package `Name` and
  declaration-IR wire tag values. `scripts/native/ir-codec-tags.mjs` maps them
  to C++ enum names and reserved slots.
- `Vir.GeneratePackage.NativeExterns`: source of truth for native extern
  registrations required by packaged closures and attribute-time marker
  validation.
- `Vir.IRDependencies`: shared IR reference walking, JavaScript-extern
  recognition, and root-to-dependency path formatting.
- `Vir.HostMetadata`: host-import marker identity and the single encoder/decoder
  for VIR targets stored in Lean extern symbols.
- `Vir.InterfaceValidation`: module-safe, typed export-binder and startup
  preflight, effect recognition, diagnostic rendering, metadata stripping, and
  controlled abbreviation-head reduction shared by attributes and package
  generation. Successful startup analysis records whether the hook is pure or
  which supported effect it uses.
- `Vir.ExportValidation`: conclusive visible compiled-closure checks for
  marked entrypoints, plus explicit opaque-import deferrals. Declaration-kind
  checks and postponed-compilation handling live with the attributes in
  `Vir.Attributes`; binder and startup policy lives in
  `Vir.InterfaceValidation`.
- `Vir.ExternFallback`: the explicit `vir_extern_fallback` command, transparent
  extern-body cloning, and direct-recursion rejection used by portable package
  sources.
- `Vir.GeneratePackage.Frontend`: source elaboration, `DeclIndex` construction,
  marker collection, extern-fallback ownership adapters,
  declaration-to-module ownership, on-demand `import all` environments, module
  filtering, and declaration-name collision diagnostics.
- `Vir.GeneratePackage.Closure`: root resolution and transitive IR closure
  collection from typed `Lean.IR.Decl` values.
- `Vir.GeneratePackage.Interface.Encode`: descriptor tags and descriptor JSON
  encoders. The JSON descriptor field is `interfaceTag`.
- `Vir.Interface.Classify.Error`: typed interface-classifier
  failures, nested classification contexts, and user-facing error rendering.
- `Vir.Interface.Classify.Basic`: shared classifier helpers,
  host effect recognition, primitive/resource labels, layout helper utilities,
  and recursive-classification traversal state.
- `Vir.Interface.Classify.Core`: interface type classification,
  callback type classification, and runtime layout classification for structures
  and inductives.
- `Vir.Interface.Classify.Signature`: the named classified signature result,
  combined export preflight and classification, and host-import signature
  classification.
- `Vir.HostValidation`: typed host-import signature and boundary-policy analysis
  shared by the `@[vir_js]` attributes and package generation.
- `Vir.GeneratePackage.Interface.Collect`: export discovery, export call-summary
  extraction, package-owned boxed-boundary policy and diagnostics,
  duplicate-avoidance helpers, and host-import collection for `@[vir_js "..."]`
  declarations.
- `Vir.GeneratePackage.Json`: small JSON string, array, object, and primitive
  encoders shared by interface and manifest serialization.
- `Vir.GeneratePackage.Manifest`: package metadata, interface manifest
  collection, and duplicate export diagnostics.
- `Vir.GeneratePackage.Manifest.Encode`: interface manifest JSON encoders.
- `Vir.GeneratePackage.Emit`: binary `.irpkg` encoding.
- `Vir.GeneratePackage.Report`: human-readable generation report.
- `Vir.GeneratePackage.Surface`: installed-library discovery, declaration
  cataloging, and static runtime-closure analysis independent of package
  encoding.
- `Vir.GeneratePackage.Surface.Report`: versioned JSON and Markdown runnable
  surface reports.
- `Vir.GeneratePackage.Run`: top-level orchestration, filesystem writes, and
  command-line diagnostics.

## Data Flow

1. The CLI turns each target argument into a `Target`.
2. `Frontend.frontendEnv` elaborates each source unchanged with async
   elaboration disabled. Frontend commands such as `#eval` follow normal Lean
   semantics and may produce output during package generation.
3. `Frontend.loadDeclIndex` records each source environment, source-local IR
   declaration names, `@[vir_export]` and `@[vir_startup]` marker sets, and a
   name-to-declaration index. Module-marked targets filter those sets to
   declarations owned by the requested module. If two different source targets
   define the same Lean declaration name, the index records a diagnostic instead
   of silently letting the later target overwrite the first.
4. `Closure.collectClosure` resolves explicit roots, auto-discovered roots, and
   generated boxed entrypoints, then walks the IR references needed by the
   package. Module-set generation repeats this walk while newly missing
   declarations identify unloaded owning modules, stopping when the closure is
   complete or no additional module IR is available. When a source explicitly
   selected an extern reference-body fallback, frontend lookup supplies an
   adapter at the original extern name and the closure follows its internal
   compiled body.
5. `Interface.collectHostImports` repeats the typed `Vir.HostValidation`
   analysis used when `@[vir_js "..."]` is applied, then performs package-only
   IR arity and slot checks for host imports reached by the closure.
6. `Manifest.collectInterfaceManifest` runs the same typed marker preflight
   used by `Vir.Attributes`, then classifies callable exports, folds in
   host-import and declaration-index diagnostics, and rejects duplicate export
   ids or JavaScript names. A valid startup preflight directly supplies its
   zero-argument `Unit` signature and effect, so package generation does not
   classify that signature a second time.
7. `Report.reportFor` renders the same resolved roots recorded in manifest
   metadata, then lists closure contents, externs, host imports, exports, and
   diagnostics.
8. `Emit.emitPackage` writes the binary package only when the closure and
   manifest have no diagnostics that would make the package ambiguous or
   unsupported. `Run.runModuleSet` partitions a successful closure by module,
   filters Lean's dependency-first module order to the reached owners, and
   preserves initializer metadata in each owning member. Dependency members
   have empty public manifests and the root retains the aggregate interface.

## Ownership Checklist

Use the smallest focused check that covers the edited boundary, then rely on CI
for the full matrix.

- Interface descriptor JSON or descriptor tags:
  `npm run check:package-abi`, `lake build vir_irpkg`, and
  `npm run test:runtime -- package-generation`.
- Package `Name` or declaration-IR tag assignments:
  `npm run generate:ir-codec-tags`, `npm run check:ir-codec-tags`,
  `lake build vir_irpkg`, and `npm run test:upstream`.
- Interface type classification, abbrev unfolding, structures, inductives,
  resources, effects, or boxed-boundary checks: `lake build vir_irpkg` and
  `npm run generate:irpkg -- examples/Fib.lean /tmp/vir-fib.irpkg fib`. Add a
  targeted fixture when the supported boundary surface changes.
- Export discovery or host-import collection: `lake build vir_irpkg`,
  `npm run check:boundary-registry`, and
  `npm run test:runtime -- package-generation`.
- Native extern declarations: `npm run check:native-externs`. If entries are
  added, removed, or renamed, also run
  `npm run generate:boundary-registry` and
  `npm run check:boundary-registry`. If wrapper symbols or generated wrapper macros
  changed, also run `npm run check:native-wrappers`.
- Manifest metadata, diagnostics, duplicate export checks, or report output:
  `lake build vir_irpkg`, `npm run generate:irpkg -- examples/Fib.lean
  /tmp/vir-fib.irpkg fib`, and inspect the generated report when diagnostics
  change.
- Lean library packaging or import layout: `bash scripts/build-lean-lib.sh`.

## Source And Target Rules

Declaration names must be unique across different source targets in one
package generation run. This is stricter than Lean's module system because the
current `.irpkg` format stores declarations by Lean name and the closure lookup
must not depend on source order.

The same source may appear in more than one target mode. This is useful when a
package needs a public export target plus a package-only support target.

The generator does not rewrite source commands. A target containing `#eval`,
`run_cmd`, macros, or initializers is responsible for their normal elaboration
behavior and any resulting output.

## Interface Notes

The interface classifier recognizes the supported manifest surface described in
`docs/INTERFACE_PIPELINE.md`. It also retries unsupported type shapes after
unfolding reducible abbrev heads, so aliases such as `abbrev UserId := Nat` can
be used at package boundaries without changing their runtime representation.

`Vir.InterfaceValidation` performs representation-independent export-binder
and startup checks. `Vir.Interface.analyzeExportInterface` composes export
preflight with the complete classifier; both `Vir.Attributes` and package
generation call it, so unsupported `@[vir_export]` types and runtime layouts
are reported consistently. Host-import attributes likewise run the complete
signature classifier and JavaScript boundary policy. Package generation runs
the export analysis for explicit roots and raw marker metadata, reruns host
analysis for raw extern metadata, then adds package-only boxed-boundary, IR
arity, slot, duplicate, and dependency checks. Each layer renders typed errors
at its own user boundary instead of sharing preformatted success/failure
strings.

Interface classification follows the same rule: its core and signature layers
return `InterfaceClassifierError` values, preserving nested type context as
data. `Vir.HostValidation` composes those values with typed host-boundary errors,
while `Interface.Collect` renders them only when it creates package diagnostics.

That retry is deliberately conservative: the classifier first tries the source
type as written, then unfolds only abbrev heads whose outer type shape is not
already supported. This preserves existing primitive, container, resource, and
effect handling while allowing simple type aliases and effect aliases to pass.

## Version Bump Checklist

Version constants are intentionally small and explicit:

- `Vir.GeneratePackage.PackageFormat` owns the Lean generator's binary package,
  interface manifest, and package-set descriptor versions, plus the package-set
  format identifier.
- `scripts/packages/package-versions.mjs` owns the JavaScript-side expectations
  for package format, interface manifest, and runtime ABI versions.
- `npm run check:package-abi` verifies package magic, package-set descriptor
  identity, versions, and section kinds across Lean, Lake, C++, and JavaScript,
  plus the Lean/JavaScript interface tag and host-boundary tables.
- `Vir/GeneratePackage/PackageIRTags.lean` owns the format-10 package `Name`
  and declaration-IR tag assignments; `scripts/native/ir-codec-tags.mjs` maps the
  C++ enum structure. `npm run check:ir-codec-tags` verifies the assignments
  and that the emitter/decoder use every non-reserved tag.

Bump `packageFormatVersion` when the binary `.irpkg` encoding or decoder
contract changes incompatibly. Update the JavaScript package-format constant,
runtime decoder checks, and package fixture expectations in the same PR.

Bump `manifestVersion` when embedded manifest fields, interface type descriptor
shapes, or their semantics change incompatibly for JavaScript callers. Update
the manifest validator, runtime smoke tests, and `docs/INTERFACE_PIPELINE.md`
alongside the generator change.

Bump `currentPackageSetVersion` when the `.irpkg-set.json` descriptor shape or
semantics change incompatibly. Change `packageSetFormat` only when introducing a
different descriptor family. Update the Lake validator, JavaScript loader,
descriptor smoke tests, and `docs/IRPKG_FORMAT.md` together.

Bump `runtimeAbiVersion` when the SDK artifact compatibility changes outside
the embedded package/manifest schema, such as a WASM host ABI or JavaScript
runtime contract change. That value is currently recorded in the SDK artifact
metadata, not in generated `.irpkg` manifests. The same artifact metadata
records the exact build-time React and ReactDOM versions required by the
optional browser React host; these versions come from `package-lock.json`.

After any version bump, run at least:

```bash
lake build vir_irpkg
npm run check:package-abi
npm run check:ir-codec-tags
npm run build:demo
npm run test:runtime -- package-generation
```

## Troubleshooting

The generated report groups the common package failures by where generation
stopped:

Many conclusive closure failures and marker-level signature failures are
already reported by Lean at the marked declaration. Package diagnostics remain
necessary for explicit package roots, opaque imported IR, postponed
compilation, generated boundaries, raw marker metadata, and package-wide
constraints.

The three closure-blocker sections append one first-discovered path from a
resolved package root after `via`. The command-line diagnostic prints the same
path.

- `Missing IR Declarations`: a requested root or closure dependency was not
  present in the loaded source environments. Check the target source path,
  imports, explicit root names, and whether a package-only support target is
  needed. For a module-system export, this can be the opaque imported boundary
  named by the earlier attribute diagnostic.
- `Missing Native Extern Registrations`: the closure reached a Lean runtime
  primitive that needs a local demo shim. Add the registration in
  `Vir.GeneratePackage.NativeExterns`, then run `npm run check:native-externs`;
  if the registry entries changed, regenerate and rerun the boundary-registry
  check.
- `Unsupported Init Globals`: the closure reached initialization-backed state
  for which the loaded inputs did not provide an initializer function.
- `Package Diagnostics`: a requested export or host import could not be
  represented in the manifest. Typical causes are unsupported argument/result
  types, duplicate export ids or JavaScript names, and declaration-name
  collisions across targets.
- Boxed boundary diagnostics: top-level `Float`, `Float32`, `UInt64`, and
  trivial wrappers over them require a generated `_boxed` declaration for the
  wasm32 interpreter call boundary. The generator auto-includes the boxed
  declaration when it exists, and reports this diagnostic when it does not.
- Noisy frontend output: source commands such as `#eval` run with normal Lean
  semantics during generation. Keep executable examples out of API modules if
  their output is not wanted in package builds.

## Focused Checks

Useful checks after generator edits:

```bash
lake build vir_irpkg
npm run check:package-abi
npm run check:ir-codec-tags
npm run check:native-externs
npm run check:boundary-registry
npm run check:native-wrappers
bash scripts/build-lean-lib.sh
npm run generate:irpkg -- examples/Fib.lean /tmp/vir-fib.irpkg fib
npm run test:runtime -- package-generation
```
