# Generate Package

This note is the maintainer map for the Lean package generator. User-facing
local package workflow stays in `docs/LOCAL_IRPKG.md`; manifest and supported
interface type details stay in `docs/INTERFACE_PIPELINE.md`.

## Entry Points

- `tools/GeneratePackage.lean` parses CLI target arguments and calls
  `Vir.GeneratePackage.run`.
- `Vir/GeneratePackage.lean` is the public import shim for the split library.
- `.lake/build/bin/vir_irpkg` is the Lake executable used by
  `scripts/lean-to-irpkg.sh`, `scripts/generate-browser-package.mjs`, and the
  fixture runner.

Targets have one of three modes:

- `--target <source.lean> <root>...`: package explicit roots and export them.
- `--package-target <source.lean> <root>...`: include roots in the package
  closure without making them JavaScript-callable exports.
- `--target-all <source.lean>`: auto-discover public source definitions as
  roots and exports.

## Module Map

- `Vir.GeneratePackage.Basic`: shared data structures, package metadata
  shapes, package ABI limits, and default browser targets.
- `Vir.GeneratePackage.PackageFormat`: package magic, package section kinds,
  and current package/interface-manifest version constants used by generated
  bytes and metadata.
- `Vir.GeneratePackage.PackageIRTags`: tracked generated constants for package
  `Name` and declaration-IR wire tags. `scripts/ir-codec-tags.mjs` is the source
  of truth.
- `Vir.GeneratePackage.NativeExterns`: source of truth for native extern
  registrations required by packaged closures.
- `Vir.GeneratePackage.Frontend`: unchanged source elaboration, `DeclIndex`
  construction, and declaration-name collision diagnostics.
- `Vir.GeneratePackage.Closure`: root resolution and transitive IR closure
  collection from typed `Lean.IR.Decl` values.
- `Vir.GeneratePackage.Interface.Encode`: interface labels, descriptor tags,
  and descriptor JSON encoders. The JSON descriptor field is `interfaceTag`.
- `Vir.GeneratePackage.Interface.Classify.Basic`: shared classifier helpers,
  host effect recognition, abbrev-head unfolding, primitive/resource labels,
  layout helper utilities, and boxed-boundary checks.
- `Vir.GeneratePackage.Interface.Classify.Core`: interface type classification,
  callback type classification, and runtime layout classification for structures
  and inductives.
- `Vir.GeneratePackage.Interface.Classify.Signature`: top-level export and host
  import signature classification.
- `Vir.GeneratePackage.Interface.Collect`: export discovery, export call-summary
  extraction, duplicate-avoidance helpers, boxed-boundary diagnostics, and
  host-import collection for `@[vir_js "..."]` declarations.
- `Vir.GeneratePackage.Json`: small JSON string, array, object, and primitive
  encoders shared by interface and manifest serialization.
- `Vir.GeneratePackage.Manifest`: package metadata, interface manifest
  collection, and duplicate export diagnostics.
- `Vir.GeneratePackage.Manifest.Encode`: interface manifest JSON encoders.
- `Vir.GeneratePackage.Emit`: binary `.irpkg` encoding.
- `Vir.GeneratePackage.Report`: human-readable generation report.
- `Vir.GeneratePackage.Run`: top-level orchestration, filesystem writes, and
  command-line diagnostics.

## Data Flow

1. The CLI turns each target argument into a `Target`.
2. `Frontend.frontendEnv` elaborates each source unchanged with async
   elaboration disabled. Frontend commands such as `#eval` follow normal Lean
   semantics and may produce output during package generation.
3. `Frontend.loadDeclIndex` records each source environment, source-local IR
   declaration names, and a name-to-declaration index. If two different source
   targets define the same Lean declaration name, the index records a
   diagnostic instead of silently letting the later target overwrite the first.
4. `Closure.collectClosure` resolves explicit roots, auto-discovered roots, and
   generated boxed entrypoints, then walks the IR references needed by the
   package.
5. `Interface.collectHostImports` classifies `@[vir_js "..."]` externs reached
   by the closure.
6. `Manifest.collectInterfaceManifest` classifies callable exports, folds in
   host-import and declaration-index diagnostics, and rejects duplicate export
   ids or JavaScript names.
7. `Report.reportFor` renders the same resolved roots recorded in manifest
   metadata, then lists closure contents, externs, host imports, exports, and
   diagnostics.
8. `Emit.emitPackage` writes the binary package only when the closure and
   manifest have no diagnostics that would make the package ambiguous or
   unsupported.

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
  `node scripts/check-boundary-registry.mjs --write` and
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

That retry is deliberately conservative: the classifier first tries the source
type as written, then unfolds only abbrev heads whose outer type shape is not
already supported. This preserves existing primitive, container, resource, and
effect handling while allowing simple type aliases and effect aliases to pass.

## Version Bump Checklist

Version constants are intentionally small and explicit:

- `Vir.GeneratePackage.PackageFormat` owns the Lean generator's
  `packageFormatVersion` and `manifestVersion` metadata values.
- `scripts/package-versions.mjs` owns the JavaScript-side expectations for
  package format, interface manifest, and runtime ABI versions.
- `npm run check:package-abi` verifies package magic, versions, and section
  kinds across Lean, C++, and JavaScript, plus the Lean/JavaScript interface tag
  and host-boundary tables.
- `scripts/ir-codec-tags.mjs` owns the format-10 package `Name` and
  declaration-IR tag assignments; `npm run check:ir-codec-tags` verifies that
  the tracked Lean/C++ outputs agree with it and that the emitter/decoder use
  every non-reserved tag.

Bump `packageFormatVersion` when the binary `.irpkg` encoding or decoder
contract changes incompatibly. Update the JavaScript package-format constant,
runtime decoder checks, and package fixture expectations in the same PR.

Bump `manifestVersion` when embedded manifest fields, descriptor shapes, or
their semantics change incompatibly for JavaScript callers. Update the
manifest validator, runtime smoke tests, and `docs/INTERFACE_PIPELINE.md`
alongside the generator change.

Bump `runtimeAbiVersion` when the SDK artifact compatibility changes outside
the embedded package/manifest schema, such as a WASM host ABI or JavaScript
runtime contract change. That value is currently recorded in the SDK artifact
metadata, not in generated `.irpkg` manifests.

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

- `Missing IR Declarations`: a requested root or closure dependency was not
  present in the loaded source environments. Check the target source path,
  imports, explicit root names, and whether a package-only support target is
  needed.
- `Missing Native Extern Registrations`: the closure reached a Lean runtime
  primitive that needs a local demo shim. Add the registration in
  `Vir.GeneratePackage.NativeExterns`, then run `npm run check:native-externs`;
  if the registry entries changed, regenerate and rerun the boundary-registry
  check.
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
