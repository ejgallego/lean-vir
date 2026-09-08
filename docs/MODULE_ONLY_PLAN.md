# Module-Only Package Inputs

Status: input model, compiled-module adapter, browser and runtime-test producers
migrated locally; remaining adapters and source-loader removal are TODO. Baseline: PR #166,
landed as `57c95a21895a8ddde5098a00ccd47b634fce1b64`.

## Objective

Remove support for non-module developments and simplify the producer API, not
just require a `module` header. Support two input adapters:

- Compiled modules, built by Lake, for reproducible CLI and artifact builds.
- Elaborated module environments from the language server, for live editor
  widgets including unsaved changes.

Both adapters feed the same declaration indexing, dependency closure,
interface validation and package emission. This is a deliberately breaking
authoring/producer change; it does not require changing interpreter behavior.

## Starting Point At PR #166

- `Target` in `Vir/GeneratePackage/Basic.lean` always carries a source path.
  Only `TargetMode.markedModule` carries a module name. Input identity is
  therefore coupled to root selection even for compiled-module builds.
- `buildVirPackageSetFacet` in `lakefile.lean` branches on `artifacts.ir?`:
  module inputs get a generated `import all` driver; other inputs fall back to
  their original Lean source. Both paths still pass a source file to the CLI.
- `loadDeclIndex` in `Vir/GeneratePackage/Frontend.lean` canonicalizes source
  paths, collects aliases, and elaborates the files. Opaque dependency bodies
  are subsequently loaded through their owning modules.
- The server adapter already uses `declIndexFromEnvironment source snap.env`.
  It does not reload the source or need the CLI fallback. Server-mode tests
  cover private/transitive imports, private initialized values and unsaved
  changes. There is no outstanding opaque-import workaround to remove here.
- Package-set metadata already identifies module-owned roots without exposing
  temporary driver paths. Removing physical CLI drivers is a different task
  from changing that existing public metadata contract.

These describe the starting point. See [GENERATE_PACKAGE.md](GENERATE_PACKAGE.md) and
[LAKE_INTEGRATION.md](LAKE_INTEGRATION.md) for today's supported workflow.

## First Implementation Slice

`Target` now pairs `PackageTargetOrigin` with four-case `TargetMode`.
`DeclIndex` remains the shared prepared representation, avoiding a second
package pipeline. Direct compiled-module CLI inputs support all four selections,
and Lake no longer generates driver files. Imported-module enumeration merges
loaded runtime IR with ordinary module entries, preferring runtime bodies over
opaque entries; all-public selection excludes private/generated declarations.
Wire marked-module metadata remains unchanged.

Source flags, source elaboration and Lake's non-module fallback intentionally
remain until consumers migrate. The infoview change in this slice is only the
mechanical source-origin constructor update; it still consumes `snap.env`.

The public npm CLI and version-2 package configs now use explicit module names.
A shared pure normalizer owns validation, selection and
output defaults; Lake builds the selected modules and supplies their search
path. Fib, Quickstart and MergeSort are registered as example modules. Runtime
fixture helpers likewise build explicit modules before calling the low-level
generator in their temporary project's environment.

Browser package assembly now plans explicit module inputs from the version-2
catalog, retaining source paths only for fixture coverage and navigation.
Root unions and package-only selections share a pure planner. Browser fixtures
are registered modules with public interface declarations; hardcoded demo
`defaultTargets` have been removed from the Lean library.

The fixture runner now builds selected modules before parallel execution and
generates packages by module identity. Its host drivers import compiled runtime
IR using separate public and `import all` imports, preserving
`interpreter.prefer_native false` and unsafe-entry handling without copying
fixture bodies. One temporary Lake-project helper serves these drivers and the
six all-public fresh runtime fixtures. It keeps each input separate, pins the
dependency toolchain, and pairs Lake's search environment with its project cwd.
Runtime direct-generator and negative-test callers now use explicit modules,
including marker attributes, raw marker/extern bypasses, extern fallbacks and
declaration collisions. Attribute/type errors remain compilation checks;
postponed compilation is checked at elaboration time because it intentionally
produces no IR artifact. Package-negative inputs must compile first.

The accepted marker contract follows Lean's local label-removal semantics:
`attribute [-vir_export]` and `[-vir_startup]` change the live environment, but
compiled imports restore the recorded additions. Tests assert both local
removal during elaboration and restored export/startup selection during
packaging. Published interfaces change by editing the original annotations and
rebuilding, not through VIR-specific persistent removal metadata. See
[LAKE_INTEGRATION.md](LAKE_INTEGRATION.md). The client-native contract check now
uses its existing Lake fixture project as a compiled module and checks both
native-over-fallback selection and fallback without the manifest.
Illuminate's producer likewise builds the adapter inside its existing isolated
client source view, preserving the client's Lake configuration and dependency
pins. It uses marked-module selection for package-set emission. Type anchors,
live snapshot ownership and the lean-zip producer remain pending.

## Design Decisions

- Module identity and root selection become separate typed values. Preserve
  explicit exports, package-only roots, all-public discovery and marked
  export/startup selection; do not replace them all with marked exports.
- Compiled inputs are selected by module identity within a resolved project
  environment. Do not infer module names by replacing slashes in arbitrary
  source paths. Lake owns compiling the inputs and their dependencies.
- Module loading must not re-elaborate input bodies or execute their source
  commands again. Compilation-time `#eval` output belongs to compilation.
  Investigate Lean's existing import APIs before introducing another loader;
  any temporary import environment remains internal, not a public driver API.
- Selection and ownership must be explicit: all-public and marked selection
  operate on the selected module, not every imported declaration. Preserve
  intentional explicit selection of reachable imported roots where supported.
- Adding `module` changes default visibility. Migrate exported declarations
  and interface types with deliberate `public`/`public section` boundaries;
  an empty all-public selection is not a successful mechanical migration.
- Snapshots carry their own environment and document provenance. Resolve the
  current module's local ownership explicitly rather than treating every
  declaration without an imported-module index as a legacy root. Do not
  replace an unsaved environment with the module's on-disk artifacts.
- Keep source locations for diagnostics and browser source links. Remove
  source paths as package-input identity, not every field named `source`.
- Keep the core transformations pure where possible. Put filesystem reads,
  module acquisition and artifact writes at the edges; use typed alternatives
  rather than another combination of selection booleans.

The first slice's Lean types and CLI names are documented in
[GENERATE_PACKAGE.md](GENERATE_PACKAGE.md). No compatibility aliases should
survive the completed migration merely to preserve old CLI spellings.

## Consumer Inventory

| Group | Current source-based boundary | Migration requirement |
| --- | --- | --- |
| Local CLI/config (migrated) | `scripts/packages/lean-to-irpkg.mjs`, `prepare-irpkg.mjs`, example `.virpkg.json` files | Module names and version-2 configs; omitted-roots all-public behavior, explicit roots, and output/report defaults preserved. |
| Generator preparation | `scripts/packages/irpkg-generator.mjs` | Build actual input modules and supply their project search environment, not only the VIR generator and optional prerequisites. |
| Browser package assembly (migrated) | `generate-browser-package.mjs`, `fixtures/browser-packages.json` | Explicit modules preserve multi-input root unions and package-only roots; implicit Lean demo defaults removed. |
| Fixtures and runtime tests | `tests/support/fixture-runner-context.mjs`, `tests/runtime/shared.mjs`, fixture catalog and generated Lean strings | Introduce one shared temporary module-project helper; build fixtures before parallel execution. Preserve host/Wasm oracle comparison and negative-test phases. |
| Client-native test producer (migrated) | `tests/native/client-native-extern.mjs`, `fixtures/client-native-extern/` | Build the existing fixture module before packaging; retain wrapper/registry diagnostics and check native versus fallback selection. Client-specific Wasm execution is separate acceptance. |
| Type anchors | `scripts/bindings/type-anchor-manifest.mjs`, `fixtures/type-anchors/vir-v1.fixture.lean` | Give the fixture an importable module arrangement; preserve reviewed export inventory, aliases and deterministic manifest output. Coordinate edits with the bindings owner. |
| Illuminate producer (migrated) | `scripts/packages/illuminate/`, `fixtures/illuminate/` | Build the adapter module in the isolated client project and emit its marked module package set; preserve dependency pins and source provenance. |
| Lean-zip producer (dependency migration needed) | `scripts/packages/lean-zip/`, `fixtures/lean-zip/` | The catalogued client at `273d0d6` still has non-module dependencies. Require a module-capable downstream checkpoint or an explicit decision to retire current-client support; do not rewrite or repin the dependency in this lane. |
| Historical benchmark producer | `benchmarks/browser/scripts/build-artifacts.mjs` | Its `--target` invokes the catalogued old VIR revision (prettyM: `b519d5a`), not this checkout's generator. Preserve historical build reproducibility; adopting a module-only producer is a new catalog/workload migration, not a prerequisite for deleting VIR's current source loader. |
| Browser source display | `web/app/pages/browser-package-config.js`, fixture catalog/source helpers | Distinguish display/filter paths from compilation identity; preserve source navigation and package coverage checks. |
| Live infoview | `Vir/Infoview/Package.lean` | Retain the environment adapter and revision/build consistency. Coordinate its API migration with the RPC owner after #169 adaptation. |

This is an inventory of producer boundaries, not a count of files that need a
`module` header. Generated test sources and dependencies are part of the work.
Lean modules cannot import non-module developments; dependencies must satisfy
the same requirement. External projects retain their own migration authority.

## Reviewable Implementation Sequence

One follow-up PR, split into behavioral commits. Temporary migration bridges
may exist between commits; the final tree must not retain both old and new
production input systems.

1. [x] Separate input identity from selection and reuse the common prepared
   `DeclIndex`. Add focused tests for module-owned versus imported roots and
   preserve snapshot-local declarations when moving constructors.
2. [ ] Complete the compiled-module-only boundary:

   - [x] Implement the compiled-module adapter and migrate Lake's module path.
   - [x] Remove generated driver files and test no source-body re-elaboration.
   - [ ] Reject non-module inputs after the consumers below have migrated.

3. [ ] Migrate shared producer/config helpers, repository examples and fixture
   modules. Preserve multi-module bundled output; module-only inputs do not
   imply a universal change to output partitioning.

   - [x] Migrate public npm CLI/configs and register their example modules.
   - [x] Migrate browser package assembly and authored browser fixture modules.
   - [ ] Migrate generated/runtime fixture inputs and remaining adapters.
4. [x] Migrate test generation and host oracles through a shared module-project
   helper. Keep tests intended to fail Lean elaboration separate from tests
   intended to fail VIR package validation. Preserve the oracle's
   `interpreter.prefer_native false` setting and unsafe-entry handling so the
   comparison does not silently switch execution modes.

   - [x] Shared temporary Lake projects, authored fixture host/package inputs,
     and six successful all-public runtime fixtures.
   - [x] Migrate runtime direct-generator and negative tests, checking both
     live and compiled marker-removal semantics.
   - [x] Migrate the existing client-native fixture project and package checks.
5. [ ] Migrate infoview, type-anchor and external-producer adapters after
   coordinating the affected boundaries. Do not silently rebuild an external
   workload under VIR's unrelated project environment.
6. [ ] Remove dead source loaders, path aliases/caches, legacy ownership and
   initialization-order special cases once both adapters express ownership
   correctly. Update CLI/config validation and error messages.
7. [ ] Update user guides and examples, run the acceptance checks below, and
   review the final diff specifically for leftover migration bridges.

## Acceptance And Corner Cases

| Concern | Required evidence |
| --- | --- |
| Selection | Explicit versus package-only roots, marked startup/export selection, all-public discovery, no accidental re-export of dependency markers, empty and duplicate targets. |
| Module closure | Public/private and transitive imports, shared dependency diamonds, opaque bodies, generated boxed entries and missing-body diagnostics. |
| Initialization | Private initialized globals and dependency-first ordering, once-only shared initialization, preserved extern fallback ownership and behavior. |
| Editor | Unsaved module edits survive packaging; revision and bytes refer to the same snapshot; imported dependencies and current-module locals remain distinguishable. |
| Builds and cache | Real downstream Lake consumer, no source re-elaboration, repeated module reuse, deterministic bytes, relocation, dependency/registry changes and corrupted or missing artifacts. |
| Negative tests | Attribute/elaboration rejection remains distinct from package-time rejection. An earlier import collision must not mask signature/startup validation coverage. |
| Runtime/UI | Existing package sets, host bindings, real React/Chromium behavior and source links remain functional. No synthetic React implementation. |

Use the smallest relevant commands from [HARNESS.md](HARNESS.md) per slice:
`test:packages:unit`, `test:package-ir-builders`, `test:lake`,
`test:runtime:lean`, `test:infoview`, fixture tests and the Chromium suite.
Broaden at the shared boundaries; do not repeat expensive unchanged interpreter
builds to validate a documentation or input-model-only change.

## Review Risks And Non-Goals

- A `module`-header-only sweep leaves most producer complexity intact.
- Removing the ownerless-root fallback too early can break editor-local or
  generated declarations. Replace its semantics before deleting its code.
- Existing tests for source `#eval` and symlink elaboration need phase-correct
  replacements, not deletion. Existing collision tests may fail earlier under
  module imports; retain independent package-validation coverage.
- Package outputs may change as source identity becomes module identity.
  Review deterministic metadata changes and cache invalidation explicitly;
  do not turn changed goldens into an unexamined bulk update.
- Do not retire manifest 6/7 compatibility, change the runtime ABI, remove
  singleton package sets/raw-byte transport, or require universal package-set
  sharding as an incidental consequence of this migration.
- Do not modify Lean's upstream interpreter or introduce a large new harness.
- This plan is not a prerequisite for #169 RPC adaptation to landed #166.
  Keep RPC, bindings, shared-assets and external consumers under their existing
  owners. The follow-up begins locally; publication is a separate action.
