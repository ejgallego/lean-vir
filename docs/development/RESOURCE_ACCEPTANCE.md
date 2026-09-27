# Embedded resources: review and acceptance

This is a draft implementation, not yet the default cold-install client workflow.
The API uses main's Lean 4.34.0 toolchain. A historical downstream Slides PrettyM
demo remains pinned to its separate, qualified Lean 4.35.0-rc3 resource checkpoint;
unstacking this PR does not migrate that demo. The checked-in runtime lock uses available-only
selection (`source: "-"`); it does not identify a public download. Publication of
a durable runtime distribution remains a release prerequisite.

## Review order

1. `Vir/Resources/Types.lean` and `Validate.lean`: typed portable data, canonical
   identities, exact member inventory and compatibility. No build paths escape.
2. `lakefile.lean`: independent core/program/carrier ownership, ordinary library
   prerequisites, full implementation traces, and cache-returned artifact paths.
3. `Vir/Resources/Build.lean` and the two resource tools: shared bounded native
   I/O, required exports and atomic installation. Runtime-only preparation must
   not depend on the program generator.
4. `Vir/Resources/Embed.lean`: preparation has already happened; elaboration only
   validates and embeds bytes. Native rendering does not reopen producer files.
5. `web/src/resource-program.js`: validate published resources, resolve roles to
   actual root exports, instantiate the existing runtime and dispose explicitly.
6. `fixtures/resources/` and `tests/resources/`: ordinary leaf builds and negative
   cases. The resource API contains no PrettyM or Slides-specific policy.

See [the contract and compiling recipe](RESOURCE_BUNDLES.md). This is based on
main, independently of the Lean 4.35 support PR. Runtime packs must match the
selected compiler exactly; a 4.35 pack cannot be reused under 4.34.

## Acceptance scope

“Covered” means the focused behavior has passing local evidence, not that the
complete product or every supported platform is qualified. CI runs core,
embedding, acquisition, packing, native program, descriptor, cache and browser
checks. The downstream Slides tests belong to Slides and are not run by VIR CI.

| Case | Status | Evidence / remaining distinction |
| --- | --- | --- |
| T01 Toolchain agreement | Covered | Native acquisition/program profile mismatch negatives and exact matching demo inputs. |
| T02 Core-only import | Covered | Core/embed/native producer builds without the optional runtime carrier. |
| T03 Runtime carrier | Covered locally | Cold runtime-only build prepares selected bytes without building the generator. |
| T04 Cold three-package build | Partial | Fresh source builds pass; runtime bytes are seeded, not anonymously downloaded. |
| T05 Client-owned program | Covered | Intermediary recipe/facet builds the registered marked program. |
| T06 Source-relative staging | Covered | Isolated dependency copies, build directory with spaces, native execution from another cwd. |
| T07 Cache restoration | Partial | Complete native artifact-cache restoration and packaging from cache-only inputs pass; a deliberately Lean-only cache still needs qualification. |
| T08 Deleted staging | Covered | Missing program staging repaired on both conventional and cache-only paths. |
| T09 Corrupt/missing bytes | Covered | Integrity negatives and corrupt staging repair. |
| T10 No-op build | Covered | Warm staging inode/mtime and bytes unchanged; no carrier recompilation. |
| T11 Program-only edit | Covered | Program bytes change; runtime unchanged. |
| T12 Transitive program edit | Covered for build invalidation | Imported private-body edit changes both dependent packs while public interfaces and setup JSON remain byte-identical at conventional paths; restoration recovers exact original packs. This is a package/build oracle, not an additional browser semantic run. |
| T13 JS-only runtime edit | Covered for build invalidation | Select new compatible JS bytes: runtime staging changes, program staging inode/mtime and bytes stay unchanged, no program facet rebuild. |
| T14 Recipe/export change | Covered | Recipe identity repackages from cached inputs; native export/role validation and obsolete recipe rejection pass. Support addition, bytes, destination, media type and removal invalidate the owning pack only. |
| T15 Offline warm build | Covered locally | Available-only selection, retained cache/stage, no runtime transport needed. |
| T16 Offline cold miss | Covered | Exact selected artifact named; no fallback revision or runtime source build. |
| T17 Anonymous acquisition | Pending | No durable release URL yet. Synthetic HTTPS fault tests do not satisfy this. |
| T18 Concurrent/interrupted production | Covered at installer boundary | Concurrent same-identity native installations and interrupted/failed transport checks. |
| T19 Compiled bytes | Covered | Native generator works with raw program packs unavailable; focused embedding also covers removed raw inputs. |
| T20 Site relocation | Covered | Actual Slides program executes at root and nested URL prefixes. |
| T21 Real PrettyM | Covered on historical 4.35 demo | Downstream browser/native shared 21-case semantic corpus; no automatic 4.34 Slides adoption claim. |
| T22 Format edges | Covered | Shared corpus includes Unicode, tags, groups and alignment/width cases. |
| T23 Invalid requests | Partial | Shared browser error cases and 13 additional native bounds cases; the full generated bounds set is not yet replayed in Wasm. |
| T24 Calls/disposal | Partial | Independent runtimes, sequential disposal/remount and deferred client mount races pass; retained-memory measurements remain. |
| T25 Paths/collisions | Covered | Portable path, case/prefix collision, integrity and link/hardlink tests; seven real-facet aliases preserve sentinels before rejection, including Lake trace/hash writes and warm-cache paths. Slides reserves publisher namespaces. |
| T26 Shared producer | Partial | Two independent carrier libraries share one producer/runtime in a cold cache build; distinct intermediary packages remain to be exercised. |
| T27 Build cycles | Covered | Program importing its owning carrier rejected before compiled jobs wait. |
| T28 Execution modes | Covered for documented modes | Compiled native and focused interpreted byte access; raw carrier elaboration without prerequisites is unsupported. |
| T29 Identity vectors | Covered | Cross-language canonical descriptor/hash and mutation/reordering checks. |
| T30 Semantics disclosure | Covered | Demo declares columns; ordinary pixel-measured Slides formatter unchanged. |

The cache campaign accepts an optional real pack:

```sh
npm run test:resources:cache -- EXACT_RUNTIME_PACK
```

With no argument, CI uses a clearly synthetic integrity-only runtime pack while
building real Lean program packages. It does not execute that synthetic runtime
or claim browser acceptance. Both modes run in fresh temporary producer/client/
leaf directories with their own Lake cache, retaining failure logs and inputs.
No frozen demo checkout or shared cache is modified.

The campaign includes a conventional-artifact phase (cache disabled only for that
test phase) to keep setup paths byte-identical across a private implementation
edit. It separately exercises enabled-cache warm reuse and cache-only generation.
This prevents changing content-addressed paths from hiding a missing semantic
dependency trace. Output safety tests use only campaign-owned sentinels and restore
moved paths even when a negative case fails.

## Before promoting the workflow

Finish the partial/pending build-graph and Wasm-bound cases above; measure resource
size, compile memory and retained browser memory; publish and qualify a durable
anonymous runtime source. Keep the native generation pipeline independent of
that release operation. The host publisher currently assumes a trusted single
writer and does not provide atomic old-or-new website replacement.
