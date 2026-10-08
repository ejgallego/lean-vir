# Embedded resources: review and acceptance

The Lean-name successor under review in PR217 uses descriptor schema2 and resource compatibility3.
It now selects the [matching public e415 runtime](https://github.com/ejgallego/lean-vir/releases/tag/resource-e415e41a43eccf298b710056efccf6c3d436d5fceb4e130fb06cb09d12d027dd).
Its exact pack is 1,120,065 bytes, SHA256
`3910c29e40ee68c3b110355fa1d30dae3029f2b34967269642521fc8409848d7`.
Anonymous public download and independent native cold/warm/offline acquisition
passed; owning-library and downstream adoption qualification are separate.
The version1 public832 asset and all results below remain historical;
they do not qualify changed loader bytes or the new schema.

The prior integration used Lean 4.34.0 and a publicly downloadable exact prebuilt
pack. Upstream
anonymous acquisition and downstream ordinary cold-deck qualification are
separate gates; neither implies a complete product acceptance.

The historical downstream baseline is Slides `51c6d782` / VIR `47e82e9a`, runtime
`401b115e` and pure Except-v2 program `97b280b7`. Slides reports 101 native,
11 Node and 30 Chromium/Firefox passing checks; VIR reviewed the retained
identities and actual exported signature without duplicating those runs.
VIR's exact-head CI `36720794347` and candidate `36720794235` both passed.
These are baseline evidence, not qualification of later changes or the newly
selected runtime pack. The current reviewed supplied-pack successor is Slides
`ea079cd7` (evidence head `3f7dbc93`) / VIR `af3052ca`, runtime `832ab095` and the
same program `97b280b7`. Slides reports 46 focused Chromium/Firefox checks and
owning-library root/downstream builds, including the public Embed carrier,
directory-casing rejection and relocation. VIR independently checked its
identity ledger and actual inventories, without repeating those campaigns.
Both exact-source workflows `36784049788` and `36784049804` passed. These results
remain supplied-pack evidence, not anonymous downstream acceptance.

Slides subsequently reports ordinary anonymous cold root/downstream builds on
source `2461cfa7`, selecting VIR `87d7646d`, with retained evidence at
[Slides `06eb2c1a`](https://github.com/ejgallego/verso-slides/blob/06eb2c1a542d0d858da97fb043138744d5b07438/docs/vir-public-runtime.md).
Its runtime `832ab095` and program `97b280b7` match the earlier pair. Cold HTTP
500 retries, warm transport-denied reuse, explicit native offline miss and cold
ordinary transport failure are distinguished in that report. This is
consumer-reported build/acquisition evidence, not a new VIR-executed campaign or
final reduced-renderer browser/geometry/retention qualification.

## Published runtime

The [runtime release](https://github.com/ejgallego/lean-vir/releases/tag/resource-832ab095ad79df0f10f538bcf71272731bb74b90df44f965dac2f086c222897d)
provides the exact bytes selected by the lock:

- Content ID: `832ab095ad79df0f10f538bcf71272731bb74b90df44f965dac2f086c222897d`.
- Pack SHA-256: `d06bda0aba96547679093da441cd3d9b2b7a9291d1757f16c5c6fcf6ed081ba1`; 1,120,731 bytes.
- Compatibility: Lean revision `293d5d0c0c3f3dded4688b3ccd6a33939ac5102b`, VIR version 1.
- Pack producer: `0f720625`; release tag points to source successor `af3052ca`.
  That successor changes native embedding, not the runtime payload.

Anonymous public download and native acquisition into empty runtime cache/stage
passed. Native warm-offline reuse and an independent cold-offline miss passed;
the miss names the exact required content ID. No different revision, supplied
pack or source Wasm build was used. The identity is content-addressed and verified;
GitHub-enforced immutable releases are not enabled in this repository.

The network-dependent three-package campaign is an explicit qualification command,
not a second broad CI campaign:

```sh
npm run test:resources:published
```

It archives the current committed producer source into a fresh owned directory,
without copying `.lake` or runtime staging. The leaf application's ordinary
`lake exe generate-site` must acquire the public pack through the intermediary
library's prerequisites. Logs and source inputs are retained under `build/`,
including on failure. This does not test a public Git clone or a fresh Slides deck.
The campaign passed at `3a7c836c430cb13668f3e8c240b65f10f739e876`, including exact
cached/staged pack checksum, warm offline acquisition without inode/mtime changes,
cold offline miss, ordinary warm build, stage repair, program edit, carrier-cycle
rejection and relocated native rendering. See the
[publication checkpoint](../evidence/runtime-release/README.md).

## Review order

1. `Vir/Resources/Types.lean` and `Validate.lean`: typed portable data, canonical
   identities, exact member inventory and compatibility. No build paths escape.
2. `lakefile.lean`: independent core/program/carrier ownership, ordinary library
   prerequisites, full implementation traces, and cache-returned artifact paths.
3. `Vir/Resources/Build.lean`, `Program.lean` and the native resource tools:
   shared bounded native I/O, container integrity, member/interface metadata,
   required exports and atomic installation. Runtime-only preparation must not
   depend on the program generator. `Program.Checked` is build-adapter validation,
   not full IR execution admission; see the contract's boundary table.
4. `Vir/Resources/Embed.lean`: preparation has already happened; elaboration only
   validates and embeds bytes. Native rendering does not reopen producer files.
5. `web/src/resource-program.js`: validate published resources, bind full Lean names to
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
| T04 Cold three-package build | Covered upstream; consumer-reported Slides cold builds | Fresh producer snapshot and intermediary/leaf build acquire the public runtime without seeding. Slides06eb2c1 separately reports ordinary cold root/downstream builds; neither substitutes for final product qualification. |
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
| T15 Offline warm build | Covered at acquisition boundary | Published source, verified cache/stage reused with native `--offline`; no runtime transport needed. |
| T16 Offline cold miss | Covered | Exact selected artifact named; no fallback revision or runtime source build. |
| T17 Anonymous acquisition | Covered upstream; separately reported downstream | Actual public release asset, empty runtime cache/stage and exact identity verified. Slides06eb2c1 reports the independent ordinary cold-deck acquisition checks described above. |
| T18 Concurrent/interrupted production | Covered at installer boundary | Concurrent same-identity native installations and interrupted/failed transport checks. |
| T19 Compiled bytes | Covered | Native generator works with raw program packs unavailable; focused embedding also covers removed raw inputs. |
| T20 Site relocation | Covered | Actual Slides program executes at root and nested URL prefixes. |
| T21 Real PrettyM | Covered on supplied-pack 4.34 checkpoints | Historical Slides51c6d782 / VIR47e82e9a and reviewed successor Slides3f7dbc93 / VIRaf3052ca use the same pure Except-v2 program. Older 4.35 demo/corpus remains separate historical evidence. |
| T22 Format edges | Covered | Shared corpus includes Unicode, tags, groups and alignment/width cases. |
| T23 Invalid requests | Covered on supplied-pack 4.34 checkpoint | Slides51c6d782 checks its finite policy, actual identity/signature rejection, pending creation cancellation and cleanup, pagehide during Wasm creation, and same-program recovery. Broader realistic-goal, latency and final product qualification remain downstream. Historical a5b42f8 / VIR4d00dbf bounds evidence is retained, not reused to qualify the 4.34 pair. |
| T24 Calls/disposal | Partial | Independent runtimes, sequential disposal/remount and deferred client mount races pass. The documented mount example is tested for both completion orders, pending unmount, stale/current rejection and cleanup failure. The resource browser gate measures 300 scalar calls and collection of 14 disposed Wasm memories, including retained facades after normal and throwing cleanup; dynamic PrettyM/callback retention is not inferred. See below. |
| T25 Paths/collisions | Covered lexically and for the tested host operations | Shared Lean/JS corpus rejects inconsistent directory-prefix casing, duplicate leaves, file/directory collisions and reserved paths in either inventory order; safe spelling is retained. No case-insensitive-filesystem materialization test is claimed. Earlier link/hardlink and seven real-facet alias checks retain their separate host scope. |
| T26 Shared producer | Covered | Two distinct intermediary packages, each with two carriers, share one producer/runtime in a cold build. Publication contains one runtime plus four programs; client-specific edits preserve peer program bytes. |
| T27 Build cycles | Covered | Program importing its owning carrier rejected before compiled jobs wait. |
| T28 Execution modes | Covered for documented modes | Compiled native and focused interpreted byte access; raw carrier elaboration without prerequisites is unsupported. |
| T29 Identity vectors | Covered | Cross-language canonical descriptor/hash and mutation/reordering checks. |
| T30 Semantics disclosure | Covered for the bounded consumer checkpoint | Slides documents width/finite-policy semantics. Lean owns formatting, VIR execution and JS browser measurement/presentation. Reviewed Slides successors consolidate the mandatory UI and remove the superseded JS formatter; final visual/product acceptance remains Slides-owned. |

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
size, compile memory and retained browser memory; qualify the published runtime
through a fresh ordinary Slides build. Keep the native generation pipeline independent of
that release operation. The host publisher currently assumes a trusted single
writer and does not provide atomic old-or-new website replacement.
