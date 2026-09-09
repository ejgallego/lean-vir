# Module-Only Package Inputs

VIR packages compiled Lean modules or live module snapshots. Both feed one
declaration index, dependency closure, interface validator and emitter.
Non-module developments and source-file package loading are unsupported.

For commands and migration examples, see [LOCAL_IRPKG.md](LOCAL_IRPKG.md).
[GENERATE_PACKAGE.md](GENERATE_PACKAGE.md) owns the implementation map and
[LAKE_INTEGRATION.md](LAKE_INTEGRATION.md) owns facets and module-package caches.

## Design Decisions

- **Separate identity from selection.** A target has a module or snapshot origin
  and one selection mode: explicit exports, package-only roots, all-public, or
  marked exports/startups. Module support does not force marked-only selection
  or universally sharded output.
- **Let Lake own compilation.** Compiled inputs use Lean's direct import API at
  the exported import level. Package generation does not elaborate source bodies,
  parse generated import drivers or infer module names from paths. Source `#eval`
  commands execute during compilation, not again during packaging.
- **Preserve live authority.** A snapshot uses the editor environment, including
  unsaved/private local IR. Its module is already loaded; acquisition must never
  replace it with disk artifacts. Stat, revision and emission share that input.
  The document requires `module`, even for imported-only roots, but need not be saved.
- **Keep ownership explicit.** All-public and marked selection belong to the
  selected module; explicit roots may name imported declarations. Reached owners
  determine dependency-first initialization, excluding meta-only runtime edges.
  Unreached imports are not included merely because they have initializers.
- **Keep effects at the edges.** Configuration normalization and package planning
  are pure; module acquisition, filesystem reads and writes are orchestration.
  Source locations remain provenance for diagnostics/navigation, not loader keys.

## Intentional Compatibility Boundaries

Version-2 package configs name modules rather than source paths. Old source CLI
flags, aliases, canonical-path caches and non-module Lake fallbacks are removed.
Adding `module` changes default visibility: expose intended interface declarations
with `public`/`public section`, not a blanket export of every dependency.

Lean's local label-removal semantics remain authoritative: removing `vir_export`
or `vir_startup` in a live environment does not erase recorded additions from
compiled imports. Change the original annotations and rebuild to change a
published marked interface; VIR does not add persistent removal metadata.

The runtime ABI, manifest compatibility and raw-byte/package-set transport are
independent of input acquisition and are not retired by this migration.
Analysis-only tools may still elaborate sources. Historical benchmark catalogs
use their pinned producers; they do not provide a fallback into this generator.
External adapters require matching module-capable dependencies and toolchains;
they must not rewrite downstream sources or silently override dependency pins.

## Review Checklist

| Boundary | Evidence to preserve |
| --- | --- |
| Selection | Four modes, repeated/empty targets, imported explicit roots, no dependency marker leakage. |
| Closure | Private/transitive/diamond imports, opaque IR, generated boxed entries, missing-body errors. |
| Initialization | Dependency-first order, exact initializer pairs/multiplicity, once-only owner partitioning, extern fallbacks. |
| Editor | Unsaved edits change revision/bytes; private locals stay local; stat/build agree; non-module rejection is explicit. |
| Compilation | No source re-elaboration; downstream Lake builds, relocation, cache invalidation and missing/corrupt artifacts. |
| Negative tests | Lean attribute/type rejection is distinct from package-time interface/closure rejection. |
| Runtime/UI | Host/Wasm oracles remain comparable; source links and real React/browser behavior remain intact. |

Use the smallest affected checks in [HARNESS.md](HARNESS.md): package unit tests,
module-input/CLI/project runtime smokes, Lake facet/cache checks and infoview
snapshot checks. Import-layout changes also require the manual library build.
External client execution and changed RPC/runtime combinations need their own
exact-checkpoint acceptance; successful package generation alone is not that evidence.
