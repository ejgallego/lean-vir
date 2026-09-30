# Embedded resources: review and acceptance

This is a draft implementation, not yet the default cold-install client workflow.
The API uses main's Lean 4.34.0 toolchain. The supplied-pack Slides strict-creation
checkpoint is qualified on 4.34; its older 4.35 canary remains historical evidence.
The checked-in runtime lock uses available-only
selection (`source: "-"`); it does not identify a public download. Publication of
a durable runtime distribution remains a release prerequisite.

The accepted downstream baseline is Slides `51c6d782` / VIR `47e82e9a`, runtime
`401b115e` and pure Except-v2 program `97b280b7`. Slides reports 101 native,
11 Node and 30 Chromium/Firefox passing checks; VIR reviewed the retained
identities and actual exported signature without duplicating those runs.
VIR's exact-head CI `36720794347` and candidate `36720794235` both passed.
These are baseline evidence, not qualification of later changes or the newly
selected runtime pack. The directory-prefix admission fix changes bundled
JavaScript and therefore the runtime content identity; downstream adoption of
that successor needs its own exact source/pack handoff.

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
| T07 Cache restoration | Covered | Full-cache restoration and cache-only packaging pass. With only Lean module artifacts retained, the ordinary leaf build rebuilds native tools/objects and its executable, reproduces every pack, and keeps setup inputs cache-resolved. |
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
| T21 Real PrettyM | Covered on supplied-pack 4.34 checkpoint | Slides51c6d782 / VIR47e82e9a native and Chromium/Firefox results use the same pure Except-v2 wrapper. Older 4.35 demo/corpus remains separate historical evidence. |
| T22 Format edges | Covered | Shared corpus includes Unicode, tags, groups and alignment/width cases. |
| T23 Invalid requests | Covered on supplied-pack 4.34 checkpoint | Slides51c6d782 checks its finite policy, actual identity/signature rejection, pending creation cancellation and cleanup, pagehide during Wasm creation, and same-program recovery. Broader realistic-goal, latency and final product qualification remain downstream. Historical a5b42f8 / VIR4d00dbf bounds evidence is retained, not reused to qualify the 4.34 pair. |
| T24 Calls/disposal | Partial | Independent runtimes, sequential disposal/remount and deferred client mount races pass. The documented mount example is tested for both completion orders, pending unmount, stale/current rejection and cleanup failure. The resource browser gate measures 300 scalar calls and collection of 14 disposed Wasm memories, including retained facades after normal and throwing cleanup; dynamic PrettyM/callback retention is not inferred. See below. |
| T25 Paths/collisions | Covered lexically and for the tested host operations | Shared Lean/JS corpus rejects inconsistent directory-prefix casing, duplicate leaves, file/directory collisions and reserved paths in either inventory order; safe spelling is retained. No case-insensitive-filesystem materialization test is claimed. Earlier link/hardlink and seven real-facet alias checks retain their separate host scope. |
| T26 Shared producer | Covered | Two distinct intermediary packages, each with two carriers, share one producer/runtime in a cold build. Publication contains one runtime plus four programs; client-specific edits preserve peer program bytes. |
| T27 Build cycles | Covered | Program importing its owning carrier rejected before compiled jobs wait. |
| T28 Execution modes | Covered for documented modes | Compiled native and focused interpreted byte access; raw carrier elaboration without prerequisites is unsupported. |
| T29 Identity vectors | Covered | Cross-language canonical descriptor/hash and mutation/reordering checks. |
| T30 Semantics disclosure | Covered for the bounded consumer checkpoint | Slides documents width/finite-policy semantics. Lean owns formatting, VIR execution and JS browser measurement/presentation. Mandatory production UI consolidation and removal of the superseded JS formatter remain Slides-owned. |

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

### Browser retention evidence

`test:resources:browser` records `retention.json` beside its package/runtime
identities. It observes actual Wasm memories through weak references and forces
Chromium GC between protocol turns. A live-instance control must remain reachable;
all observed memories must become collectable after disposal, including while a
disposed program facade is still held. Twelve additional create/call/dispose cycles test that this
does not only work for the first instance. The harness keeps raw JS heap and Wasm
capacity measurements, without a timing claim or a noisy heap-size threshold.

A final real instance exercises a test-only synchronous host-cleanup fault and
checks collection while its disposed facade remains held. The fault is injected
at callback-set cleanup, not by changing Wasm bytes or adding a public test API.
This checks error-path detachment, not callback-heavy application retention.

The scalar Format score is not the client PrettyM JSON wrapper, and does not
exercise callback roots. Its 300-call measurement must not be described as a
dynamic PrettyM allocation test. Disposal detaches the facade from its runtime
even if cleanup throws; repeated disposal remains harmless and later calls
reject. This changes neither the underlying runtime's ownership policy nor its
ABI. Collection is observed after explicit GC, not promised to occur immediately
on disposal, and linear memory capacity need not shrink while an instance lives.

## Before promoting the workflow

Finish the partial/pending build-graph and Wasm-bound cases above; measure resource
size, compile memory and retained browser memory; publish and qualify a durable
anonymous runtime source. Keep the native generation pipeline independent of
that release operation. The host publisher currently assumes a trusted single
writer and does not provide atomic old-or-new website replacement.
