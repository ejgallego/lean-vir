# Lean browser benchmark catalog

This directory is one standalone browser benchmark application. Its example
selector currently exposes `Std.Format.prettyM`, lean-zip raw DEFLATE, and the
Illuminate player at the same level and through the same page structure. Each
example supplies its own semantic contract, backend set, sampling controls, and
studies while the application owns navigation, artifact status, report
placement, and shared presentation. Every completed study can be compared
through the same backend filter, metric selector, chart, and value table; an
example may retain additional workload-specific report views. The application
has no runtime dependency on Verso, Reveal, Lake, or the parent VIR repository's
source tree.

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

- discover self-contained examples and variants from the catalog;
- load each admitted artifact set through its example controller;
- run the differential tests and benchmark studies declared by that example;
- preserve workload-defined inputs, correctness rules, timing phases, and
  artifact provenance;
- collect cold-start and isolated-runtime observations in fresh browser
  contexts;
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
normal serving consumes already-built artifact sets staged by the candidate
pipeline.

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
<example-id>/<producer-declared package files>
```

Every path and component is catalog-declared; the packer does not assume
prettyM, lean-zip, or a fixed compiler route. It writes a deterministic
normalized tar, member checksums, an
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
npm run build -- --deploy illuminate=default --deploy lean-zip=default \
  --deploy prettyM=default
```

Repeat `--deploy EXAMPLE=VARIANT` for every line in the plan.

Deployment admission requires a canonical build, an exact example/variant and
artifact-set identity, the canonical `tests.json` digest, and no missing,
changed, extra, or symbolic-link artifact files. Only admitted example
directories and artifacts are copied. The generated `examples/catalog.json`
therefore exposes only active canonical examples. Illuminate, lean-zip, and
prettyM all use the same source-materialization, candidate, browser-test, and
deployment loop.

The app normally receives COOP/COEP headers from `scripts/serve.mjs`. Static
hosts without configurable headers use the scoped `coi-serviceworker.js`
fallback and reload once before starting the application. CI tests that path
without server-supplied isolation and requires every backend and differential
test declared by the admitted variant to pass.

Artifact sets are generic over Lean versions. Each candidate is a complete
bounded runtime carrying its own Lean version, runtime, adapter, and workload.
The browser only observes the example's semantic input/output and timing
contract. `artifact-builds.json` owns the current producer and workload pins.
Backend parity is the compatibility gate; no cross-backend Lean heap values are
exchanged.

The current prettyM VIR package uses the producer-facing
`VersoSlides.Pretty.*ForVir` export names. `example.json` is their canonical
build declaration; `config.js` maps the same names to their browser roles. The
application itself does not load Verso or depend on slide sources. Renaming
those two exports can accompany a later artifact refresh without changing the
benchmark or dashboard APIs.

## Develop and test

```sh
npm install
npm run dev
```

`npm run dev` is deliberately strict: every active example must have the exact
artifact-set ID selected by `artifact-builds.json`. It reports each missing or
stale set and the canonical command that rebuilds it. When developing one
producer or reviewing a deliberately incomplete checkout, use
`npm run dev:partial` instead.

Open <http://127.0.0.1:18334>. The root is a neutral example catalog; it does
not load or privilege any workload. Select an example there or use
`?example=prettyM&variant=default`, `?example=lean-zip&variant=default`, or
`?example=illuminate&variant=default`. Example variants are selected in the
shared header rather than by workload-specific UI. The included server
supplies the required cross-origin isolation headers. `_headers` and
`.htaccess` are included for static hosts that consume them. The scoped service
worker covers hosts such as GitHub Pages that cannot configure those headers,
with one reload before application startup.

The generated catalog marks an example as ready only when its staged artifact
set ID, payload digests, and test-package identity match the canonical build.
Registered examples without local artifacts remain visible as **Not staged**,
but the application does not load their controller or request missing files.
Build and stage one with:

```sh
npm run example -- lean-zip default --materialize --prepare --serve
```

This resolves the canonical source revisions, builds and validates the
candidate, stages it, and serves the resulting partial catalog. Complete every
active example and use `npm run dev` for the strict full-site view. The build
summary lists the expected set ID for every ready, missing, or invalid example.

Backend selection in every report view is presentation-only. The shared view
normalizes example-owned report data without rewriting its source JSON, while
downloaded JSON always retains every backend. Workload-specific views may add
more detailed controls and own source-report import/export. Exported runtime
profiles retain artifact pathnames and hashes but omit URL origins and query
strings. They intentionally retain browser user-agent data.

Run the browser regression with:

```sh
npm test
```

Set `CHROMIUM` to an alternate Chrome/Chromium executable when necessary.

### Illuminate

The `Illuminate player` example compares the production JavaScript player,
typed VIR, and FIR's zero-import selection package. Its catalog record builds
the Illuminate-owned source/oracle package first, passes that package to VIR's
client compiler, and independently asks FIR to export its pinned selection
package. The candidate pipeline validates and stages all three components as
one artifact set.

```sh
npm run example -- illuminate default --materialize --prepare
```

The quick study is a differential gate over two representative animations and
three trace lengths. The registered scaling study uses the same contract but
does not make timings from an ordinary loaded machine into accepted evidence.
See [`docs/ILLUMINATE.md`](docs/ILLUMINATE.md) for the component and source
flow.

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

The example controllers retain their workload-specific execution and source
report contracts. The shared shell defines the uniform example format, chooses
the controller, owns navigation, and adapts completed reports to a compact
comparison view. It does not force clients to replace richer report schemas or
specialized analysis. Illuminate and lean-zip supply independent client shapes
that keep this adapter honest.
