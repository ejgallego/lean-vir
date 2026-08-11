# Lean browser benchmark app

This directory is one standalone browser benchmark application. Its example
selector currently exposes `Std.Format.prettyM` and the Illuminate player at
the same level and through the same page structure. Each example supplies its
own semantic contract, backend set, sampling controls, and studies while the
application owns navigation, artifact status, report actions, plotting, and
backend filtering. It has no runtime dependency on Verso, Reveal, Lake, or the
parent VIR repository's source tree.

The complete application can be moved to the root of another repository. The
root-level VIR npm commands are convenience pointers only and are not used by
this package.

Client examples use the compact `browser-benchmarks/example` v1 descriptor
under `examples/<id>/example.json`. It declares only identity, lifecycle, Lean
targets and exports, and a browser controller. Run `npm run examples:check` to
validate the catalog. See [`docs/EXAMPLE_FORMAT.md`](docs/EXAMPLE_FORMAT.md)
for the contribution and uniform VIR compilation contract.

## Responsibilities

- load the JavaScript, VIR JSON, VIR typed-Format, native FIR Wasm, and
  LLVM/Emscripten candidates;
- verify exact rendered-text and styling parity;
- collect marshal, execute, decode, and total timings;
- run corpus, scaling, interaction, retained-memory, and repeated-call studies;
- collect cold-start and isolated-runtime observations in fresh browser contexts;
- aggregate multiple fresh browser processes and generate forwardable cards;
- import a stable external attribution summary without embedding profiler code;
- display reports and campaigns with a shared, non-destructive backend filter;
  and
- import/export the complete JSON representation independently of the active
  presentation filter.

The slide deck is not part of this application. It may link here or present a
recorded report, but benchmark execution does not initialize Reveal or use
slide DOM state.

## Artifact contract

The example descriptors are canonical for VIR targets and exports. The
committed `artifact-builds.json` supplies exact producer and workload Git
revisions, producer dependencies, expected package files, lock paths, and
artifact-set provenance. The build driver resolves each `packageRef` through
the example descriptor before invoking the uniform VIR compiler. Local
checkout paths are supplied on the command line and are never committed. See
`docs/ARTIFACT_BUILDS.md` for the source-build contract and driver.

FIR and VIR producer checkouts can be selected with `--toolchain`, an ignored
`toolchains.local.json`, or `--toolchain-config`. Every selected checkout must
still match the exact catalogued commit. These settings control generation;
normal serving consumes already-built FIR packages selected and staged through
the immutable artifact-set lock.

Producer source remains in its owning Git repository. CI and self-contained
local builds materialize the exact catalogued commits under the ignored
`_sources/{vir,fir,workload}` directory; no producer source is copied into this
application or an artifact archive:

```sh
npm run artifacts:sources -- prettyM
```

The committed `artifact-set.lock.json` selects one immutable, compatible set.
Binary artifacts and downloaded release archives remain ignored by Git. The
current prototype lock has no public URL yet; assemble and consume it locally:

```sh
npm run artifacts:pack -- --build prettyM
npm run artifacts:fetch -- \
  --archive _artifacts/releases/<generated-archive>.tar
```

`artifacts:build` produces a validated `_artifacts/seed/`, and
`artifacts:pack` consumes it with this layout:

```text
lean-vir/js/vir-runtime.js
lean-vir/wasm/vir-upstream.wasm
prettyM-vir.irpkg
lean-native/{BUILD.json,prettyM-browser-adapter.mjs,prettyM.wasm,prettyM.wasm.json}
lean-llvm/{README.md,SHA256SUMS,emscripten-loader.mjs,
           prettyM-emscripten-adapter.mjs,prettyM.manifest.json,
           prettyM.mjs,prettyM.wasm}
```

It writes a deterministic normalized tar, member checksums, an
`ARTIFACT_SET.json` compatibility manifest, and the lockfile. The fetcher
verifies the outer archive before extraction, rejects unsafe tar members,
verifies every extracted member, installs it atomically under
`_artifacts/sets/`, and stages it. Every input, cache, set, and output path is
restricted to this application directory.
Source compilation caches remain in the explicitly selected producer
checkouts; only declared package bytes cross into this application.

Once the archive is uploaded as an immutable release asset, set its exact HTTPS
URL in the lockfile and change the status from `local-prototype` to `published`.
Clean clones can then use `npm run artifacts:fetch` without an override. See
`docs/ARTIFACT_SETS.md` for producer, promotion, and publication details.

The candidate workflow stops before that publication boundary. It builds from
the catalogued sources, packs to a separate candidate lock, re-imports the
archive, runs the application tests, and uploads the archive, checksums,
manifest, source receipt, and `CANDIDATE.json` as a short-lived CI artifact.
It never edits `artifact-set.lock.json` or publishes a release asset.

The artifact set is generic over Lean versions. Each candidate is a complete
bounded runtime carrying its own Lean version, runtime, adapter, and `prettyM`
workload. The browser only observes the common semantic input/output and timing
contract. Set 0001 intentionally combines a VIR runtime and workload built with
Lean 4.33.0-rc2 at the exact PR #104 head (`64e3078`) with native and LLVM
bounded runtimes built with Lean 4.32. Five-backend parity is the compatibility
gate; no cross-backend Lean heap values are exchanged.

The current VIR package retains the historical
`VersoSlides.Pretty.*ForVir` export names. They are declared in `src/config.js`
as artifact compatibility data; the application itself does not load Verso or
depend on slide sources. Renaming those two exports can accompany a later
artifact refresh without changing the benchmark or dashboard APIs.

## Develop and test

```sh
npm install
npm run artifacts:fetch
npm run build
npm run dev
```

Open <http://127.0.0.1:18334>. The root is a neutral example catalog; it does
not load or privilege either workload. Select an example there or use the
direct links `?example=prettyM` and `?example=illuminate`. The included server
supplies the cross-origin isolation headers required by threaded LLVM Wasm.
`_headers` and `.htaccess` files are included at the root of `dist/` for static
hosts; configure equivalent headers when the hosting platform does not consume
either format.

Backend selection in the report dashboard is presentation-only. The same
selection follows the corpus, scaling, memory, repeated-call, and interaction
views, while downloaded JSON always retains every backend in the source report.

Run the browser regression with:

```sh
npm test
```

Set `CHROMIUM` to an alternate Chrome/Chromium executable when necessary.

### Illuminate rehearsal

The `Illuminate player` example in the common application compares the legacy
JavaScript, typed VIR, and FIR-native implementations. It has the same
artifact-status, backend, protocol, study, and result sections as `prettyM`.
Until it gets its own canonical artifact-catalog record, stage its inputs as a
local rehearsal:

```sh
npm run stage:illuminate -- \
  --source /path/to/illuminate \
  --native-package /path/to/illuminate-player-package \
  --selection-package /path/to/illuminate-selection-player-package \
  --vir-sdk /path/to/extracted/lean-vir-sdk
npm run test:illuminate
```

`--vir-sdk` can point directly at an extracted `lean-vir-sdk` CI artifact; when
omitted, it defaults to the SDK under the Illuminate checkout. The stager
verifies its manifest and file digests before copying it. The selection package
is optional for older rehearsals; when present, the application prefers FIR's
selection-v4 API, uses its bit-exact scalar tick entry, and materializes patch
rows from the original host-owned animation. The full-action v3 package remains
the producer-side semantic oracle.

The canonical consumer-side adapter requires both accepted FIR packages. Once
an Illuminate catalog record can be built, `artifacts:fetch` selects it from
the artifact-set manifest and atomically stages only verified `illuminate/`
members. The app uses selection v4 and loads that set manifest as provenance,
while retaining `REHEARSAL.json` and v3-only compatibility for local rehearsals.

The application and downloaded report display the exact staged build
identities and mark all timings as non-authoritative. See
`docs/ILLUMINATE_REHEARSAL.md` for refreshed build hashes, correctness status,
and the remaining producer integration.

## Reproducible reports

With the app server running, collect one full report from a separate browser
process:

```sh
npm run report
```

The default output is `_results/pretty-benchmark.json`. Result paths are kept
inside this directory and ignored by Git. The collector includes five
fresh-context startup profiles, retained and isolated memory, and isolated
repeated-call traces for the two VIR entry points. The earlier independent JSON
round-trip control is intentionally no longer collected; the two VIR backends
still preserve the useful string-ABI versus direct-Format comparison.

For process-to-process variability and owner-ready summaries:

```sh
npm run campaign
npm run cards
```

`campaign` launches the Node collector in fresh processes and writes both JSON
and Markdown. `cards` turns the default report into VIR-001 through VIR-003.
Both Python scripts use only the standard library; browser automation continues
to use this package's Playwright dependency.

VIR-002 also reads the committed
`evidence/vir-pr104-runtime-call-profile.json`. This is a bounded, hash-identified
summary of two external diagnostic captures against the locked VIR package; raw
profiles and profiler machinery remain in the VIR producer worktree. Card
generation rejects the attribution when its Lean version or bounded runtime JS,
Wasm, and IR-package identities do not match the benchmark report.

The complete local refresh is:

```sh
npm run refresh
```

It stages the installed locked set (or the validated in-tree seed), builds and serves the app,
collects a report, refreshes cards, and runs a three-process campaign. It never
publishes or reads artifact directories outside this application.

## Spin-off boundary

The future repository root is exactly this directory. Source, styles, build and
serve scripts, browser tests, package metadata, licensing files, documentation,
and the artifact input contract are all contained here. The app uses only
browser APIs and its own npm development dependency.

The example controllers retain their workload-specific execution contracts.
The shared shell is deliberately smaller: it defines the uniform example
format, chooses the controller, and owns navigation. Illuminate supplies the
concrete second-client requirements without forcing either engine into a
lowest-common-denominator benchmark API.
