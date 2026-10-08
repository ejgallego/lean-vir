# Application build internals

The first-release application workflow is library-owned preparation through
Lake, followed by site generation and browser loading. Follow the
[application guide](EMBEDDED_RESOURCES.md) for setup; this page explains the
implementation, not a choice of user workflows. Qualification is recorded in
the [acceptance checklist](../development/RESOURCE_ACCEPTANCE.md).

The client library declares `CarrierLibrary:virResourcePack` as a `needs`
dependency. The application imports its compiled `ResourceSet`, containing the
runtime and programs, and writes their files to the site. It does not invoke
the native generator, inspect build paths, or install a runtime development kit.

Program generation and runtime acquisition are independent Lake dependencies.
Producing the runtime itself is a separate maintainer operation, never a
fallback in an application build. Experimental live editor widgets have a
different input source; see [Infoview](INFOVIEW.md).

## How resource preparation builds its inputs

The carrier library declares `needs := #[@package/CarrierLibrary:virResourcePack]`.
This establishes ordering **and** a traced prerequisite before its source includes
the prepared pack. Program and carrier modules belong to separate registered
libraries so packaging the program cannot depend on compiling its own carrier.

```text
registered program + transitive imports ── full compiled artifacts ──┐
typed registration + compatibility + native producer tools ─────┤
                                                                  ↓
                                                        virResourcePack
                                                                  ↓
                                                    cached program .virres
                                                                  ↓
                                                 repaired source-relative stage
                                                                  ↓
                                                compiled client resource value ──┐
                                                                                ↓
runtime lock + compatibility + native pack tool ── virRuntimePack ── runtime carrier
                                                                                ↓
                                                                  ResourceSet / publisher
```

The two carrier branches meet in `ResourceSet`; program packaging does not
depend on acquiring the Wasm runtime. The steps below describe the implementation
in [lakefile.lean](../../lakefile.lean), not commands the application must run.

1. **Select.** Read the one bare Module key in the owning library's stock `needs`
   field, plus the compatibility and native producer jobs. The key retains Lean's
   semantic Name; no registration table or unbuilt VIR helper import is needed.
   Reject missing/ambiguous selections and roots belonging to another package.
2. **Check the graph.** Resolve the root with Lake's `findModule?`; unregistered
   modules fail. Fetch `transImports` and reject direct or transitive imports of
   the carrier library before requesting compiled program artifacts.
3. **Fetch the shared program.** The internal `virProgram` facet fetches `exportInfo` for the root and every transitive
   import. Consume `allArts`, including private data and interpretation IR, and
   add `allArtsTrace`. Lake owns compilation/cache retrieval and returns the real
   artifact locations; the producer does not reconstruct conventional paths.
   Acquiring the import graph does not mean shipping every declaration in it.
4. **Trace the build.** Explicitly trace the selected module Name: the bare
   Module input does not itself carry a content trace. Jobs retain tool,
   compatibility, Lean identity and full implementation/location traces.
5. **Build or restore two separate results.** The shared program facet uses
   `buildArtifactUnlessUpToDate` for a canonical selected program.
   On a miss, `vir_program` consumes the resolved setup and calls
   `Vir.GeneratePackage.runModuleSet` once. The resource adapter consumes that
   verified result, removes the private diagnostic report and caches the portable
   `.virres` pack. The generated root interface stays the sole callable inventory. It does not launch
   another generator or recompile sources. The diagnostic report stays internal.
6. **Stage even on a hit.** Use the artifact path returned by Lake, which may be in
   its cache rather than the conventional output directory. Validate and repair
   `.vir-generated/<Library>.virres` under the owning library's source directory.
   Prepare module-specific private input locators from Lake's source-only library
   collection, including local imported modules. Different libraries sharing a
   source directory remain distinct. Preserve the semantic input trace and add
   the prepared inputs' traces before returning the artifact path. Inclusion derives
   the same source root from the complete module-relative source filename,
   not the caller's working directory.
7. **Embed.** `include_vir_program` consumes this module's prepared input, validates the pack and
   generates owned Lean values. It performs no acquisition or subprocess build. The compiled
   native application can run without reopening the pack or producer checkout.

Explicit source-relative `include_vir_bundle` remains available to low-level
prepared-input tools. Neither include performs acquisition or triggers a build.
The private stage is an elaboration prerequisite, not the published
asset API. The setup map and report are build-local; only portable bundle members
and metadata reach the application. Output preflight rejects symlink aliases
before Lake can mutate owned output/trace/hash paths.

### Runtime acquisition is a separate branch

`VirResourceRuntime` has `needs := #[virRuntimePack]`. That target reads the
compatibility profile and `vir-resources/runtime.json` lock, then uses the native
pack tool to acquire the exact content identity:

1. Try the verified cache, then the existing verified stage.
2. Otherwise read the configured local pack or fetch its anonymous HTTPS URL.
3. Validate the complete pack and compatibility before installation; restore
   cache/stage without writing through existing hard links.

The previous contract's lock named a public release asset; the Lean-name
successor still needs its matching public distribution. Once selected, an empty runtime cache downloads
and verifies those exact bytes. `source: "-"` remains an available-only selection,
not a download source. There is no implicit SDK installation, npm invocation,
GitHub authentication, WASI installation, or local runtime build. HTTPS acquisition
uses `curl`; packing runtime distributions is a separate maintainer operation.

## Shared core, separate public contracts

`virResourcePack` **does not fetch `+Module:vir`, `:virSdk`, or `:virInputs`**.
Both program adapters depend on the internal `virProgram` facet instead.

| Boundary             | Package facet                                                                     | Resource facet                                                        |
| -------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Compiled acquisition | Shared `virProgram`: full artifacts, implementation/location traces and setup map | The same job, after carrier-cycle checks                              |
| Package generation   | Shared cached marked-root program via `vir_program` → `runModuleSet`              | The same cached result; no independent IR generation                  |
| Result               | Loose package-set descriptor, root/shards and report                              | One portable pack containing the package set and generated interface |
| Cache/publication    | File build rule plus package-set completeness checks                              | Lake artifact rule plus verified source-relative stage repair         |
| Runtime              | Independent `:virSdk` installs an SDK directory                                   | Independent `virRuntimePack` supplies a compiled runtime carrier      |

The inner cache key includes full implementation traces and resolved paths,
Lean/producer identity, marked-root selection and the native profile. Runtime
locks stay outside that key. It is a selected program,
not a canonical representation of every declaration in each imported module.
The existing pack codec supplies the internal container and its size limits;
there is no new public archive format or setup schema.

The loose adapter installs member bytes unchanged under existing paths, rewrites
only descriptor paths, and installs the descriptor last. The resource adapter
keeps the canonical member layout and reads the actual embedded root manifest on cache hits as well as misses. Damaged loose files can
be repaired without regeneration. A malformed internal cached result fails
closed; it is not silently substituted with a conventional-path program.

`+Module:virProgram` and `vir_program` are implementation plumbing, not additional
application workflows. Applications use the resource library; loose package
sets remain compiler outputs for repository tooling and existing integrations.

The general CLI's explicit/unmarked/multiple-target selections still need their
own request representation. Live snapshots carry authoritative editor environments
instead of an acquisition request. Consolidation should share analysis/encoding,
not force either input contract through the marked compiled-module facet.

`Vir.NativePayload` shares bounded reads, digest verification and verified
publication between SDK installation and resource acquisition. Domain validators
and selection remain separate: an SDK release/commit is not a resource content ID.
SDK authentication does not enter locked acquisition, and neither adapter adds
an automatic runtime-build fallback.

Repository npm producers acquire their registered modules through the same
compiled-input resolver, via the internal `lake run virPrepare` bridge. Lake
returns the generator executable, full artifact map and matching search path;
the npm adapter retains selection and output policy. `build:lean-lib` is simply
`lake build Vir`, not a second hand-maintained library build. External temporary
test projects still supply their own compilation environment to the standalone
generator: a map from this repository must not replace their module ownership.
The cache-only acquisition regression covers this bridge separately from the
resource adapter; it is not a claim about unexecuted client campaigns.

Resource builds reject `VIR_NATIVE_EXTERN_MANIFEST` before cache lookup, including
empty values; direct native producer calls reject it too. Their runtime is the
locked bundle, not an ambient provider profile. The lower-level `:vir` path retains
its traced custom-profile support. Supporting custom resource runtimes later needs
an explicit matched capability/profile contract, not merely passing this variable.

## Retained tools and replaced workflows

- The older application staging and public resolved-input proposals, PR161 and
  PR184, are closed in favor of library-owned resources. The first release is
  still under review; existing demo and maintainer tooling has not all migrated.
- The standalone generator remains compiled-module tooling, not a legacy source
  loader. Non-module developments and source-file package loading are unsupported.
- Experimental live editor snapshots remain a distinct input contract. No optimization may
  replace an unsaved root with a saved artifact or rebuild it behind the editor.
- `:vir` / `:virSdk` remain lower-level interfaces for existing integrations and
  compiler/runtime development, not a second first-release application workflow.
  Library-owned applications do not invoke them as manual preparation steps.

`prepare:irpkg` and `generate:package` are repository commands
for demo/fixture selection. `build:sdk-artifact` and `build:site` serve runtime
distribution and the hosted demos. Their continued use is not an application
requirement. See [the tooling inventory](../../scripts/packages/README.md) and
the [contributor harness](../HARNESS.md) before changing or removing their callers.

See the [generator reference](../reference/GENERATE_PACKAGE.md) for selection modes
and removed source flags. Closing old proposals does not delete their retained
source or evidence.
