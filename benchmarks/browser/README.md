# Lean browser benchmark catalog

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

Client examples use one self-contained directory under `examples/<id>/`. Its
compact descriptor declares identity, lifecycle, Lean targets and exports, a
browser controller, and a `tests.json` package containing selectable variants,
differential inputs, JavaScript-oracle availability, required backends, and the
benchmark entry point. Run `npm run examples:check` to validate the catalog.
See [`docs/EXAMPLE_FORMAT.md`](docs/EXAMPLE_FORMAT.md) for the contribution and
uniform VIR compilation contract. Maintainers should also read
[`docs/MAINTAINER_GUIDE.md`](docs/MAINTAINER_GUIDE.md) for the canonical build,
artifact, Pages, and validation workflow.

Select the complete build-and-test unit by example and variant:

```sh
npm run example -- prettyM default --plan
npm run example -- prettyM default --test-only
# From a clean checkout, materializes exact sources, prepares producers, builds,
# packs, imports, validates, then runs the declared differential tests:
npm run example -- prettyM default --materialize --prepare
# Existing FIR/VIR checkouts may instead be selected explicitly:
npm run example -- prettyM default --prepare --toolchain /path/to/lean-fir
```

The benchmark suite is part of the package but is not measured by these
commands. Performance collection remains an explicit controlled-machine step.

## Responsibilities

- load the JavaScript, VIR JSON, VIR typed-Format, native FIR Wasm, and
  LLVM/Emscripten candidates;
- verify exact rendered-text and styling parity;
- collect marshal, execute, decode, and total timings;
- run corpus, scaling, interaction, retained-memory, and repeated-call studies;
- collect cold-start and isolated-runtime observations in fresh browser contexts;
- aggregate multiple fresh browser processes into campaign reports;
- display reports and campaigns with a shared, non-destructive backend filter; and
- import/export the complete JSON representation independently of the active
  presentation filter.

The slide deck is not part of this application. It may link here or present a
recorded report, but benchmark execution does not initialize Reveal or use
slide DOM state.

## Artifact contract

The example descriptors are canonical for VIR targets and exports. The
committed `artifact-builds.json` supplies exact producer and workload Git
revisions, producer dependencies, expected package files, and artifact-set
provenance. Generated candidate locks are integrity records for exact local
re-import; they are not committed consumer state. The build driver resolves
each `packageRef` through the example descriptor before invoking the uniform
VIR compiler. Local checkout paths are supplied on the command line and are
never committed. See
`docs/ARTIFACT_BUILDS.md` for the source-build contract and driver.

FIR and VIR producer checkouts can be selected with `--toolchain`, an ignored
`toolchains.local.json`, or `--toolchain-config`. Every selected checkout must
still match the exact catalogued commit. These settings control generation;
normal serving consumes already-built FIR packages staged by the candidate
pipeline or an explicit local rehearsal.

Producer source remains in its owning Git repository. CI and self-contained
local builds materialize the exact catalogued commits under the ignored
`_sources/{vir,fir,lean,workload}` directory; no producer source is copied into
this application or an artifact archive:

```sh
npm run artifacts:sources -- prettyM
```

The repository does not retain obsolete prototype locks. Binary artifacts,
candidate locks, and downloaded release archives remain ignored by Git. The
`npm run example` command above is the normal complete workflow. See
[`ARTIFACT_BUILDS.md`](docs/ARTIFACT_BUILDS.md) for producer construction and
[`ARTIFACT_SETS.md`](docs/ARTIFACT_SETS.md) for the lower-level pack and import
boundary.

`artifacts:build` produces a validated `_artifacts/seed/`, and
`artifacts:pack` consumes it with this layout:

```text
prettyM/lean-vir/js/vir-runtime.js
prettyM/lean-vir/wasm/vir-upstream.wasm
prettyM/prettyM-vir.irpkg
prettyM/lean-native/{BUILD.json,prettyM-browser-adapter.mjs,
                     prettyM.wasm,prettyM.wasm.json}
prettyM/lean-llvm/{README.md,SHA256SUMS,emscripten-loader.mjs,
                   prettyM-emscripten-adapter.mjs,prettyM.manifest.json,
                   prettyM.mjs,prettyM.wasm}
```

It writes a deterministic normalized tar, member checksums, an
`ARTIFACT_SET.json` compatibility manifest, and the lockfile. The fetcher
verifies the outer archive before extraction, rejects unsafe tar members,
verifies every extracted member, installs it atomically under
`_artifacts/sets/`, and atomically stages only `artifacts/<example-id>/`.
Staging one example preserves every sibling. Artifact inputs and outputs plus
orchestrator-owned caches are restricted to this application directory.
Source compilation caches remain in the explicitly selected producer
checkouts; only declared package bytes cross into this application.

There is no accepted-lock or promotion phase. The candidate workflow builds
from the catalogued sources, writes an ignored lock, re-imports that exact
archive, runs the application tests, and uploads the archive, checksums,
manifest, source receipt, and `CANDIDATE.json` as short-lived CI diagnostics.
The fetcher retains exact-URL support as an optional transport mechanism, not
as a repository release lifecycle.

## GitHub Pages deployment

GitHub Pages consumes a candidate generated inside its own build job; it does
not require a pre-existing archive. `npm run pages:plan` lists the active
canonical example, variant, and build records that the workflow will build.
After those candidates are staged, the deployment build remains explicit and
accepts every selected example:

```sh
npm run pages:plan
npm run build -- --deploy prettyM=default
```

Repeat `--deploy EXAMPLE=VARIANT` for every line in the plan.

Deployment admission requires a canonical build, an exact example/variant and
artifact-set identity, the canonical `tests.json` digest, and no missing,
changed, extra, or symbolic-link artifact files. Only admitted example
directories and artifacts are copied. The generated `examples/catalog.json`
therefore exposes only active canonical examples. At present that is
`prettyM/default`; changing Illuminate from rehearsal to active will add it to
the same source-materialization, candidate, browser-test, and deployment loop.

The app normally receives COOP/COEP headers from `scripts/serve.mjs`. Static
hosts without configurable headers use the scoped `coi-serviceworker.js`
fallback and reload once before starting the application. CI tests that path
without server-supplied isolation and requires every backend and differential
test declared by the admitted variant to pass.

The artifact set is generic over Lean versions. Each candidate is a complete
bounded runtime carrying its own Lean version, runtime, adapter, and `prettyM`
workload. The browser only observes the common semantic input/output and timing
contract. `artifact-builds.json` owns the current producer and workload pins.
Five-backend parity is the compatibility gate; no cross-backend Lean heap
values are exchanged.

The current VIR package uses the producer-facing
`VersoSlides.Pretty.*ForVir` export names. `example.json` is their canonical
build declaration; `config.js` maps the same names to their browser roles. The
application itself does not load Verso or depend on slide sources. Renaming
those two exports can accompany a later artifact refresh without changing the
benchmark or dashboard APIs.

## Develop and test

```sh
npm install
npm run artifacts:fetch -- \
  --lock /path/inside/this/app/to/artifact-set.lock.json \
  --archive /path/inside/this/app/to/artifact-set.tar
npm run build
npm run dev
```

Open <http://127.0.0.1:18334>. The root is a neutral example catalog; it does
not load or privilege either workload. Select an example there or use the
direct links `?example=prettyM&variant=default` and
`?example=illuminate&variant=default`. Example variants are selected in the
shared header rather than by workload-specific UI. The included server supplies
the required cross-origin isolation headers. `_headers` and `.htaccess` are
included for static hosts that consume them. The scoped service worker covers
hosts such as GitHub Pages that cannot configure those headers, with one reload
before application startup.

Backend selection in the report dashboard is presentation-only. The same
selection follows the corpus, scaling, memory, repeated-call, and interaction
views, while downloaded JSON always retains every backend in the source report.
Exported runtime profiles retain artifact pathnames and hashes but omit URL
origins and query strings. They intentionally retain browser user-agent data.

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

The canonical consumer-side adapter requires both producer-validated FIR
packages. Once an Illuminate catalog record can be built, `artifacts:fetch`
selects it from the artifact-set manifest and atomically stages only verified
`illuminate/` members. The app uses selection v4 and loads that set manifest as
provenance, while retaining `REHEARSAL.json` and v3-only compatibility for local
rehearsals.

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

For process-to-process variability:

```sh
npm run campaign
```

`campaign` launches the Node collector in fresh processes and writes both JSON
and Markdown. The Python driver uses only the standard library; browser
automation continues to use this package's Playwright dependency.

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
