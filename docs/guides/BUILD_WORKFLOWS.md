# Build workflows and ownership

VIR separates compiling Lean programs, acquiring a browser runtime, publishing
assets, and executing them. These are not interchangeable build commands.
Embedded resources are still a draft integration; see their
[acceptance limits](../development/RESOURCE_ACCEPTANCE.md).

## Choose an entry point

| Audience | Entry point | Contract |
| --- | --- | --- |
| Lean library user | `lake build Vir` | Core Lean library, without browser-runtime production. |
| Native application author | Ordinary application build / generator command | With the draft resource integration, consume the client library's `ResourceSet` and publish its bytes. No producer-path discovery. |
| Client-library author | `CarrierLibrary:virResourcePack` as a library `needs` dependency | Prepare one registered browser program, named export roles, and support files for a compiled carrier. |
| Custom browser host / package producer | `+Module:vir` and `:virSdk` | Build a marked program package set and independently acquire the matching SDK. The host owns loading and startup. |
| Editor-widget author | `VirInfoview` and widget/RPC APIs | Package the retained live module environment, including unsaved code. Not a disk rebuild. |
| Advanced producer / developer | `vir_irpkg`, `generate:irpkg`, `generate:package`, `prepare:irpkg` | Explicit compiled-module selection and repository package tooling. Not the application-author API. |
| VIR contributor / runtime maintainer | `build:demo`, `build:sdk-artifact`, `build:site` | Produce Wasm, SDK archives, or the repository site. Requires the contributor toolchain. |

The [resource guide](EMBEDDED_RESOURCES.md) owns client setup;
[Packages](PACKAGES.md) owns the lower-level package/SDK commands;
[Infoview](INFOVIEW.md) owns live widgets; the [harness](../HARNESS.md) owns
contributor prerequisites and tests. `lake build VirInfoview` additionally
prepares its JavaScript bundle and needs npm dependencies.

## How resource preparation builds its inputs

The carrier library declares `needs := #[@package/CarrierLibrary:virResourcePack]`.
This establishes ordering **and** a traced prerequisite before its source includes
the prepared pack. Program and carrier modules belong to separate registered
libraries so packaging the program cannot depend on compiling its own carrier.

```text
registered program + transitive imports ── full compiled artifacts ──┐
recipe + compatibility + support files + native producer tools ─────┤
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

1. **Plan.** Fetch the library's `vir-resources/<Library>.json`, VIR's compatibility
   file, and the native `vir_resource_program` / `vir_resource_pack` executable
   jobs. Lake builds or restores those executables and their Lean/native
   dependencies. The planner validates the recipe and returns its single root
   module and support-file inputs.
2. **Check the graph.** Resolve the root with Lake's `findModule?`; unregistered
   modules fail. Fetch `transImports` and reject direct or transitive imports of
   the carrier library before requesting compiled program artifacts.
3. **Acquire compiled inputs.** Fetch `exportInfo` for the root and every transitive
   import. Consume `allArts`, including private data and interpretation IR, and
   add `allArtsTrace`. Lake owns compilation/cache retrieval and returns the real
   artifact locations; the producer does not reconstruct conventional paths.
   Acquiring the import graph does not mean shipping every declaration in it.
4. **Trace the build.** Support files use `inputBinFile`. Jobs propagate recipe,
   tool and compatibility dependencies; the facet adds Lean identity, a producer
   contract marker, and the serialized resolved-path map. Paths matter for
   relocation; implementation traces matter when paths stay unchanged.
5. **Build or restore the program pack.** `buildArtifactUnlessUpToDate` owns the
   `.virres` artifact. On a miss, write a private `ModuleSetup` transport and invoke
   `vir_resource_program build`. That native tool calls the shared
   `Vir.GeneratePackage.runModuleSet` directly, using marked selection and the
   recipe's required exports. It collects only the executable closure, emits the
   package set in temporary storage, adds roles/support files, validates and packs
   it, then installs the output. It does not launch `vir_irpkg` or recompile sources.
6. **Stage even on a hit.** Use the artifact path returned by Lake, which may be in
   its cache rather than the conventional output directory. Validate and repair
   `.vir-generated/<Library>.virres` in the owning package. Preserve the semantic
   input trace and add the stage's content trace before returning the artifact
   path. The include expression uses the stable source-relative stage instead.
7. **Embed.** `include_vir_bundle` validates the prepared pack and generates owned
   Lean values. It performs no acquisition or subprocess build. The compiled
   native application can run without reopening the pack or producer checkout.

The source-relative stage is an elaboration prerequisite, not the published
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

The current lock uses `source: "-"`: only previously supplied matching bytes are
allowed. A miss fails. There is no implicit SDK installation, npm invocation,
GitHub authentication, WASI installation, or local runtime build. HTTPS acquisition
uses `curl`; packing runtime distributions is a separate maintainer operation.

## Shared core versus overlapping orchestration

`virResourcePack` **does not fetch `+Module:vir`, `:virSdk`, or `:virInputs`**.

| Boundary | Package facet | Resource facet |
| --- | --- | --- |
| Compiled acquisition | Shared `fetchVirCompiledSetup`: full artifacts, implementation/location traces and setup map | The same helper, after carrier-cycle checks |
| Package generation | `vir_irpkg` CLI → `runModuleSet` | Native resource producer → the same `runModuleSet` |
| Result | Loose package-set descriptor, root/shards and report | One portable pack containing the package set, roles and support files |
| Cache/publication | File build rule plus package-set completeness checks | Lake artifact rule plus verified source-relative stage repair |
| Runtime | Independent `:virSdk` installs an SDK directory | Independent `virRuntimePack` supplies a compiled runtime carrier |

Both facets now share one private acquisition/setup helper and the same generation
core. They still invoke generation independently: requesting both for one root
can emit its inner package set twice. The next possible consolidation is a shared
cached program result beneath two output adapters, not routing resource production
through loose-file publication. It requires one explicit key for selection, native
profile, compiler/generator identity and emission format, plus a common integrity
check. Do not cache a root-specific selected shard as a canonical whole module.

That shared program result could let a role/support-file edit rewrap a resource
without rerunning IR analysis, and let requests for both facets reuse emission.
Those are proposed benefits, not behavior implemented by this first pass.
Before consolidating emission:

- Define a canonical inner package layout independent of the consumer's output
  directory; preserve existing loose-output paths through its adapter.
- Keep recipe roles/support bytes outside the inner program cache key, but still
  validate required exports against cached results before advertising a bundle.
- Preserve the lower-level custom-native profile and the resource locked-profile
  restriction; only identical program semantics may share a cached result.
- Use one package-set integrity check without importing unbuilt VIR code into
  the lakefile. Test both adapters requesting the same program, warm reuse,
  private-body invalidation and repair of damaged members.

The general CLI's explicit/unmarked/multiple-target selections still need their
own request representation. Live snapshots carry authoritative editor environments
instead of an acquisition request. Consolidation should share analysis/encoding,
not force either input contract through the marked compiled-module facet.

SDK installation and resource acquisition also overlap in downloading and checking
bytes, but have different identities and distribution contracts. Sharing transport
must not import the SDK's release/Actions selection into the content-locked
resource path or add an automatic runtime-build fallback.

Repository npm producers still use conventional search-path resolution in some
paths. Their migration and shared acquisition are tracked in
[#205](https://github.com/ejgallego/lean-vir/issues/205); the resource tests do not
establish cache-only support for those callers.

Resource builds reject `VIR_NATIVE_EXTERN_MANIFEST` before cache lookup, including
empty values; direct native producer calls reject it too. Their runtime is the
locked bundle, not an ambient provider profile. The lower-level `:vir` path retains
its traced custom-profile support. Supporting custom resource runtimes later needs
an explicit matched capability/profile contract, not merely passing this variable.

## Replaced workflows

- The older application staging and public resolved-input proposals, PR161 and
  PR184, are closed in favor of the resource client direction. This does not mean
  the draft resource distribution is released or every old producer has migrated.
- The standalone generator remains compiled-module tooling, not a legacy source
  loader. Non-module developments and source-file package loading are unsupported.
- Live editor snapshots remain a distinct input contract. No optimization may
  replace an unsaved root with a saved artifact or rebuild it behind the editor.
- `:vir` / `:virSdk` remain supported lower-level interfaces. A resource application
  should not also invoke them as manual preparation steps.

See the [generator reference](../reference/GENERATE_PACKAGE.md) for selection modes
and removed source flags. Closing old proposals does not delete their retained
source or evidence.
