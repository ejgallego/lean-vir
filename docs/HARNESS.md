# Harness

This document is for maintaining Lean VIR. The user-facing quickstart stays in
the top-level `README.md`; implementation ownership notes live in
`scripts/README.md`.

This document owns setup, generated-artifact policy, validation command
selection, and CI shape. Package config and manifest semantics live in
`docs/INTERFACE_PIPELINE.md`; architecture status lives in
`docs/IMPLEMENTATION_NOTES.md`; package generator internals live in
`docs/GENERATE_PACKAGE.md`.

The repository-local harness has three jobs:

- fetch and pin the upstream Lean source used for the WASI build
- build the upstream IR interpreter plus the local WASI shim
- generate and test `.irpkg`, WASM, site, and SDK artifacts

It is intentionally shell and npm based. This repository does not use a
branch-policy file, paired backports, or a large Python worktree harness.

## Setup

Install npm dependencies first:

```bash
npm install
```

Then prepare the local Lean source checkout, WASI SDK, and demo WASM:

```bash
npm run setup
npm run doctor
```

`npm run setup` expands to:

```bash
npm run fetch:lean
npm run install:wasi
npm run build:demo
```

`npm run doctor` checks the local command and artifact state after setup. It
fails for missing required pieces and warns when Chromium is not available for
browser smoke tests.

The Lean toolchain is pinned by `lean-toolchain`. The upstream source fetcher
pins the matching Lean source checkout under `third_party/lean4-src/`.
Generating the Wasm size site also uses GNU `objdump`, `readelf`, and `c++filt`
from binutils to enumerate sized functions and exact ELF byte classes in the
installed Lean archives.

## Generated Artifacts

Generated files are useful evidence while debugging, but they are not commit
material by default:

- `build/`: object caches, generated source inputs, packages, fixture reports,
  and summaries
- `web/dist/`: Vite Pages output
- `web/public/*.wasm`: generated browser WASM
- `web/public/*.irpkg`: generated browser packages
- `web/public/*.input.json` and `web/public/*.report.md`: generated package
  diagnostics
- `web/public/downloads/`: generated downloadable archives
- `third_party/lean4-src/`: fetched Lean source checkout
- `.tools/`: local WASI SDK and optional engine installs

The infoview widget bundle, C++ codec tags, and native-symbol registry are
generated below `build/generated/` rather than committed. The optional
`VirInfoview` library builds the infoview bundle; the default `Vir` library does
not require npm or generated JavaScript. The WASM probe generates both C++
inputs before compiling the shim. The Lean codec constants are ordinary source
and define the wire values used to generate the C++ tags.

The most useful generated diagnostics are:

- `build/upstream-probe/boundary.md`
- `build/upstream-probe/link.map`
- `build/upstream-probe/generated/native_wrappers.cpp`
- `build/upstream-probe/generated/native_wrappers_registry.inc`
- `build/generated/*.report.md`
- `build/fixtures/summary.json`
- `build/fixtures/*.report.md`
- `build/vir-surface/*.json`
- `build/vir-surface/*.md`
- `build/bindings/index.html` and `build/bindings/report.json`
- `build/type-descriptors/*.json`, `*.html`, and `*.md`

The versioned `build/fixtures/summary.json` contract records fixture
expectations, outcomes, phase timings, and structured package diagnostics.
Schema version 2 records zero seconds for package or Wasm phases that were not
reached, uses `null` for unavailable outcome values or diagnostics, and
preserves missing-dependency paths as `{ name, via }` objects.

Reference these reports in local notes or final summaries when they explain a
failure, but keep them out of Git unless the maintainer asks for a tracked
fixture/report change.

Commands that reuse generated runtime artifacts expect
`web/public/vir-upstream.wasm` and the generated browser `.irpkg` files to
exist. SDK/local artifact packaging and SDK import smokes also expect the
optimized debug companion `web/public/vir-upstream.dev.wasm`. Run
`npm run build:demo` first when `npm run test:runtime`,
`npm run test:runtime:pure`, `npm run test:runtime:lean`,
`npm run test:upstream:no-build`, or `npm run test:fixtures:no-build` reports a
missing `web/public/...` artifact.

## Command Map

Toolchain and build:

```bash
npm run fetch:lean
npm run install:wasi
npm run build:infoview
npm run check:infoview-bundle
npm run build:demo
npm run build:demo:release
npm run build:demo-package
npm run build:size-site
npm run build:surface-site
npm run build:frontier-size-site
npm run build:analysis-site
npm run build:site
npm run check:api-coverage
npm run check:package
npm run check:package-abi
npm run generate:ir-codec-tags
npm run check:bindings
npm run check:ir-codec-tags
npm run check:native-externs
npm run check:client-native-externs
npm run generate:boundary-registry
npm run check:boundary-registry
npm run check:native-wrappers
npm run analyze:surface -- build/vir-surface/lean-libraries.json build/vir-surface/lean-libraries.md
npm run analyze:surface -- /tmp/entry.json /tmp/entry.md --module Lean.Meta.Basic --root Lean.Meta.mkFreshExprMVar
npm run analyze:target-surface -- --project /path/to/project --source Library/Entry.lean --module Library.Entry --root Library.Entry.main --output-prefix build/vir-surface/library-entry
npm run analyze:frontier-size -- --plan /tmp/frontier-plan.json
npm run render:surface -- build/vir-surface/lean-libraries.json build/vir-surface/html
npm run render:target-surface-index -- build/vir-surface/targets demo "Demo target" build/vir-surface/demo.json
npm run compare:surface -- control.json candidate.json delta.json delta.md
```

Package generation and inspection:

```bash
npm run generate:irpkg -- examples/Fib.lean web/public/local-fib.irpkg
npm run prepare:irpkg -- examples/quickstart.virpkg.json
npm run prepare:irpkg -- examples/quickstart.virpkg.json examples/fib.virpkg.json
npm run inspect:irpkg -- web/public/local-quickstart.irpkg
npm run inspect:irpkg -- --json web/public/local-quickstart.irpkg
npm run inspect:native-wrappers
npm run size:wasm
node tests/fixtures/runner.mjs --help
```

Tests:

```bash
npm run test:mailbox
npm run test:packages:unit
npm run test:bindings:unit
npm run test:fixtures:unit
npm run test:tutorials
npm run test:bench
npm run test:native:unit
npm run test:surface
npm run test:surface:browser
npm run test:package-ir-builders
npm run test:upstream
npm run test:upstream:no-build
npm run test:env-lookup:wasm-pair
npm run test:infoview
npm run test:runtime
npm run test:runtime:unit
npm run test:runtime:pure
npm run test:runtime:lean
npm run test:lake
npm run test:wasm-extensions
npm run test:fixtures
npm run test:fixtures:no-build
npm run test:site
npm run test:pages:browser
npm run accept:lean-zip -- /path/to/lean-zip
npm test
```

`npm run accept:lean-zip -- /path/to/lean-zip` is an explicit external-client
compatibility check for a lean-zip checkout using the same Lean toolchain as
VIR. It builds a native oracle and a client-native VIR package, compares the
compression results byte for byte, and independently inflates them. Add
`--passes 1` for a shorter diagnostic run or `--profile` for attribution only;
neither mode is stable performance evidence. Run it when interpreter, package,
ABI, native-lookup, runtime-conversion, or Lean-zip integration changes need a
real external-client check; documentation and mechanical layout changes do not
normally require it. See the
[Lean-zip package tooling notes](../scripts/packages/lean-zip/README.md) for the
native-oracle/VIR boundary and the complete contract.

`npm test` begins with the mailbox, package, native-registry, fixture, tutorial,
benchmark, and surface contract suites. It then runs package ABI, declaration
IR, native-boundary, API-coverage, binding, Lake, and Wasm integration checks.
Finally, it builds the demo artifacts and reuses them for a paired-runner
control/control smoke, upstream smoke, infoview widget smoke, JavaScript runtime
tests, and the fixture suite. It is the default pre-merge signal for code
changes; `package.json` remains the exact command-order source of truth.

## Smallest Useful Check

- Artifact-cache, benchmark sampling, focused identity, or paired-runner changes:
  `npm run test:bench`
- Package declaration lookup or interpreter/provider performance changes:
  `npm run bench:env-lookup -- --json <new-output-path>`; use a separate
  `--cpu-profile` run for attribution
- Package IR object-builder layout changes: `npm run test:package-ir-builders`
- Paired Wasm runner integration changes: build the demo, then run
  `npm run test:env-lookup:wasm-pair`; this is a correctness smoke, not timing
  evidence
- Native runtime coverage or library-surface analyzer changes:
  `npm run test:surface`; use `npm run analyze:surface -- <report.json>
<report.md>` for a complete installed-library report, then
  `npm run render:surface -- <report.json> <html-directory>` for the interactive
  folder/module/function browser. For a project pinned to another Lean release,
  use `npm run analyze:target-surface -- ...` after building its imports; see
  `docs/SURFACE_ANALYSIS.md`. For report navigation or responsive-layout
  changes, also run `CHROMIUM=/path/to/chromium npm run test:surface:browser`.
- Native extern declaration changes:
  `npm run check:native-externs`; add
  `npm run check:client-native-externs` when client manifest selection,
  wrapper imports, or provider handoff changes
- Shim/native extern registry changes:
  `npm run check:native-externs`,
  `npm run generate:boundary-registry`, then
  `npm run check:boundary-registry` and `npm run check:native-wrappers`
- Boxed native wrapper changes:
  `npm run check:boundary-registry`, `npm run check:native-wrappers`, and
  `npm run test:upstream`
- API coverage documentation changes:
  `npm run check:api-coverage`; use
  `node scripts/check-api-coverage.mjs --write` only to materialize
  `build/analysis/api-coverage.tsv`
- Lean `@[vir_js]`, explicit conversion, JavaScript provider, or host-boundary
  policy changes: `npm run check:bindings`
- IR package name/declaration tag changes:
  `npm run generate:ir-codec-tags`, then `npm run check:ir-codec-tags` and
  `npm run test:upstream`
- IR package decoder validation or failure cleanup:
  `npm run test:runtime -- package-decoder`
- Upstream interpreter or WASI boundary changes:
  `npm run test:upstream`
- Upstream smoke after `npm run build:demo` has already refreshed the WASM and
  browser packages:
  `npm run test:upstream:no-build`
- WASM section size and linker-map attribution after `npm run build:demo` or
  `npm run build:demo:release`:
  `npm run size:wasm`
- JavaScript runtime, host bindings, manifest decoding, or callback lifecycle
  without Lean-dependent package generation:
  `npm run test:runtime:pure`
- Runtime runner catalog, filtering, configuration, or scheduling policy without
  generated Lean or Wasm artifacts:
  `npm run test:runtime:unit`
- Runtime package generation or SDK artifact import checks:
  `npm run test:runtime:lean`
- Lake module/package facets, marked-module selection, or SDK installer changes:
  `npm run test:lake`
- Local JS engine Wasm interop feature availability, such as `externref` or JSPI:
  `npm run test:wasm-extensions`
- A single runtime smoke id/path substring:
  `npm run test:runtime -- <substring>`
- An explicit runtime smoke group:
  `npm run test:runtime -- --group pure`
- Lean infoview bundle freshness, shell loading, local asset RPC, or widget-entry
  signature checks:
  `npm run test:infoview`
- React proof-widget demo iteration after `npm run build:demo`:
  open `examples/ReactProofWidget.lean` in VS Code; the widget package is built
  from the active Lean server snapshot. If the file was already open before the
  build, restart the Lean server or reopen the file so the editor sees the
  rebuilt `Vir.Infoview` widget module.
- Shared Tamagotchi widget demo iteration after `npm run build:demo`:
  open `examples/ReactTamagotchiWidget.lean` in VS Code. The widget reuses the
  same hook-backed `ReactTamagotchi.View` component as the browser React demo.
- Lean fixture behavior or package generation coverage:
  `npm run test:fixtures`
- Fixture expectation, report-diagnostic, and runner-configuration contracts
  without a Lean or Wasm build:
  `npm run test:fixtures:unit`
- A single fixture or fixture family:
  `VIR_FIXTURE_FILTER=<substring> npm run test:fixtures`
- A single fixture after `npm run build:demo` has already refreshed the WASM
  and browser packages:
  `VIR_FIXTURE_FILTER=<substring> npm run test:fixtures:no-build`
- Site bundle, SDK archive, or local archive shape:
  `npm run test:site`
- Browser interaction, DOM, React, timers, animation callbacks, or page runner
  behavior:
  `npm run build:site`
  then `CHROMIUM=/path/to/chromium npm run test:pages:browser`
- Broad pre-merge check:
  `npm test`

`VIR_FIXTURE_FILTER` matches fixture id, source path, entry name, and additional
roots by case-insensitive substring. For example:

```bash
VIR_FIXTURE_FILTER=string npm run test:fixtures
VIR_FIXTURE_FILTER=fib12 npm run test:fixtures
VIR_FIXTURE_FILTER=fib12 npm run test:fixtures:no-build
```

`VIR_RUNTIME_TEST_FILTER` similarly narrows `npm run test:runtime`, and
`VIR_RUNTIME_JOBS` controls the number of runtime smoke subprocesses. The
available runtime smoke ids and groups are printed by:

```bash
node tests/runtime/runner.mjs --list
```

Runtime smoke tests are split into two groups:

- `pure`: Node-only runtime, host binding, manifest, object ABI, and callback
  tests that reuse existing demo artifacts.
- `lean`: package-generator and SDK-import tests that require Lean and write
  shared `build/lean-lib` / `.lake` outputs.

The runtime runner executes pure tests in parallel, but serializes Lean-group
tests to avoid concurrent writes to shared Lean build outputs on cold CI
checkouts. The Lean-group helpers build `build/lean-lib` and `vir_irpkg` once
per test process. Internal helper calls may set `VIR_SKIP_IRPKG_BUILD=1` only
after that setup has completed; routine manual use should keep using the npm
commands above.

`test:fixtures:no-build` is a local iteration shortcut. It requires
`web/public/vir-upstream.wasm` from a previous `npm run build:demo`.

The local package-generation helper, browser package generator, and fixture
runner use the `vir_irpkg` Lake executable instead of repeatedly starting
`lean --run tools/GeneratePackage.lean`. The fixture runner builds that
executable once, then reuses it for per-fixture packages while continuing to
run the host oracle for every fixture.

The build and test entry points print compact timing summaries that are useful
when comparing CI runs:

- `npm run build:demo` prints browser package, compile, link, and total probe
  timing.
- `npm run build:demo:release` uses the same optimized build, then strips
  `web/public/vir-upstream.wasm` for distribution bundles while keeping
  `web/public/vir-upstream.dev.wasm` optimized but unstripped for debugging.
- `npm run prepare:irpkg` prints Lean library, generator, package, and total
  timing; when passed multiple configs, it prepares the generator once.
- `npm run test:runtime` prints selected groups/filters plus per-test timings
  and the slowest tests.
- `npm run test:fixtures` prints build, generator, fixture-run, and slowest
  fixture timings; the JSON summary also records per-fixture phase timings.

## SDK Releases

Tags named `v<package.json version>` trigger `.github/workflows/release-sdk.yml`,
which validates the tag and ABI versions, builds `lean-vir-sdk.tar.gz`, imports
the packaged SDK modules, and uploads it to the matching GitHub release. Create
the tag from the final merged commit so the archive manifest records the
revision clients actually depend on. Before that tag exists, test consumers
with `VIR_SDK_ARCHIVE` or the commit-artifact fetch path; the zero-argument
`:virSdk` facet intentionally targets the tagged release.

## CI Shape

The CI workflow keeps one job responsible for fetching the pinned Lean source,
installing the WASI SDK, building the release-profile
`web/public/vir-upstream.wasm` plus the optimized, unstripped
`web/public/vir-upstream.dev.wasm`, generating browser `.irpkg` files, and
running upstream smoke. That job uploads both the demo artifacts and the
commit-addressed `lean-vir-sdk` archive. The pure runtime job downloads the
demo artifacts and runs without installing Lean. The
Lean-dependent runtime job installs Lean for the Lake facet, package-generation,
and SDK metadata smoke tests. The fixture job also downloads the demo artifacts
and runs in parallel without re-fetching Lean source or reinstalling the WASI
SDK.

The Pages workflow runs the same `npm run build:site` entry point. Its static
artifact includes a fresh complete Lean-library surface scan under
`web/dist/surface/` and a linker-map-derived release/debug Wasm size explorer
under `web/dist/size/`. The reports cross-link declarations, native providers,
and retained symbols. The tracked native-frontier plan adds exact isolated and
cluster raw/gzip measurements; blocker pressure remains a ranking hint, and
only an A/B surface comparison gives exact unlocks. See
`docs/SURFACE_ANALYSIS.md` for accounting and local reproduction.
They are deployed at
`https://ejgallego.github.io/lean-vir/surface/` and
`https://ejgallego.github.io/lean-vir/size/` alongside the demo.

For pull requests, every job explicitly checks out the pull request's head SHA
instead of GitHub's synthetic merge ref. GitHub indexes commit artifacts by
that head SHA, while `package-sdk-artifact` records the checked-out Git commit
in the SDK manifest. Using the same ref in every job keeps source, artifact
lookup, and SDK metadata aligned.

## Browser Smoke

`npm run test:pages:browser` runs a built `web/dist/` site against headless
Chromium over the Chrome DevTools Protocol. This is an explicit no-build path:
before starting Chromium, it checks that every required artifact exists and
that each `.irpkg` has the current package and interface-manifest versions.
Missing or incompatible artifacts fail early and report `npm run build:site`
as the refresh command.

The script searches common Linux/macOS Chromium paths and `PATH`. If Chromium
is elsewhere, set:

```bash
CHROMIUM=/path/to/chromium npm run test:pages:browser
```

Run `npm run build:site` first when you want to refresh `web/dist/`.

## Performance Comparisons

Benchmark commands, artifact-cache behavior, and before/after comparison
workflow live in `docs/PERFORMANCE.md`.

## Implementation Map

Keep focused checks and shared helpers in the split modules instead of copying
logic into entry-point scripts or pages:

- Runtime smoke tests and host-engine Wasm probes: `tests/runtime/*.mjs`
- Browser smoke cases and page suites: `tests/browser/*.mjs`
- Fixture runner and pure contracts: `tests/fixtures/`; authored inputs:
  `fixtures/`; shared test-only support: `tests/support/`
- Process helpers: `scripts/process-utils.mjs`
- Benchmark helpers: `benchmarks/harness/bench-differential.mjs` and
  `benchmarks/harness/bench-utils.mjs`
- Filesystem and executable lookup helpers: `scripts/file-utils.mjs`
- Repository-root resolution shared by nested tooling:
  `scripts/repository-paths.mjs`
- Agent mailbox protocol and CLI: `docs/MAILBOX_PROTOCOL.md`,
  `scripts/mailbox-lib.mjs`, and `scripts/mailbox.mjs`; focused contracts:
  `tests/mailbox/`
- IR package, browser-package, and artifact tooling: `scripts/packages/`;
  shared artifact-bundle policy: `scripts/packages/artifact-bundle.mjs`;
  focused and Lake integration checks: `tests/packages/`
- Lean-zip acceptance and browser source-package producer:
  `scripts/packages/lean-zip/`
- Package-tooling contracts: `npm run test:packages:unit`
- Native registry, wrapper, codec-tag, host-import, and ABI tooling:
  `scripts/native/`; pure registry contracts: `npm run test:native:unit`
- Surface, frontier-size, Wasm attribution, and report-rendering tooling:
  `scripts/analysis/`; focused coverage: `tests/surface/`
- Binding inventory, descriptor, comparison, and explorer tooling:
  `scripts/bindings/`; focused coverage: `tests/bindings/`
- Infoview widget smoke coverage: `tests/infoview/`
- Browser page helpers: `web/app/pages/page-utils.js` and
  `web/app/pages/input-parsers.js`
- Host boundary, active lifecycle, and virtual binding internals:
  `web/src/host-boundary.js`, `web/src/host/vir-active-host-bindings.js`, and
  `web/src/host/vir-virtual-host-bindings.js`

## Worktree Workflow

For multi-step implementation work, prefer a linked worktree:

```bash
git worktree add -b feat/<slug> .worktrees/<slug> main
```

Keep `.worktrees/` local and ignored. Use ordinary Git commands; there is no
repository-specific worktree harness here.

The root checkout is the stable base. Avoid using it for unrelated parallel
implementation branches, and do not delete unrelated worktrees unless the
maintainer explicitly asks.

## Agent Mailbox

Inter-agent coordination uses the one local mailbox under the primary/root
checkout, including when the participating agents are running in linked
worktrees or dependent projects. See `docs/MAILBOX_PROTOCOL.md` for the small
validated envelope, immutable message files, advisory workflow fields, and
archival.

```bash
npm run mailbox:check
npm run mailbox:list
npm run mailbox:deliver -- /path/to/draft.md
npm run mailbox:archive -- <thread-id>
npm run mailbox:list -- --archive
npm run test:mailbox
```

The commands resolve the primary checkout from any linked worktree. `.agents/`
is ignored local state and must not appear in public PR descriptions.
