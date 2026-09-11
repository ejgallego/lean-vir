# Harness

This guide covers maintainer setup, generated artifacts, check selection and CI.
Start with the [quickstart](../README.md) to use VIR, the
[developer guide](DEVELOPER_GUIDE.md) to change its implementation, or
[tests/README.md](../tests/README.md) to add a test.

## Setup

```bash
npm install
npm run setup
npm run doctor
```

`setup` runs `fetch:lean`, `install:wasi` and `build:demo`. The toolchain in
`lean-toolchain` determines the matching upstream checkout under
`third_party/lean4-src/`. `doctor` fails for missing required commands/artifacts
and warns when Chromium is unavailable for browser checks.

The Wasm build defaults to 4 MiB initial memory and a 1 MiB stack. Set
`VIR_WASM_INITIAL_MEMORY` and `VIR_WASM_STACK_SIZE` in bytes to change them.
The size explorer additionally requires GNU `objdump`, `readelf` and `c++filt`
from binutils.

## Generated Artifacts

Generated artifacts are ignored and should remain outside commits unless the
maintainer requests a tracked fixture or report change.

| Artifacts | Preparation / use |
| --- | --- |
| `web/public/vir-upstream.wasm`, `vir-upstream.dev.wasm` and browser `.irpkg` packages | `npm run build:demo`; runtime and no-build smoke checks reuse these files. |
| Release Wasm and its debug companion | `npm run build:demo:release` strips the release file; the debug companion remains optimized and unstripped. SDK/local archives and SDK import smokes need both. |
| `web/dist/`, including SDK/local archives and analysis pages | `npm run build:site`; required before `test:pages:browser`. |
| Infoview JavaScript bundle under `build/generated/` | `lake build VirInfoview` requires npm dependencies. The default `Vir` library needs no npm bundle. |
| Local `.irpkg` and reports | Follow [local packages](guides/PACKAGES.md#generate-a-local-package) or [package configuration](guides/PACKAGES.md#configure-package-generation). |

Other ignored outputs include object caches and reports under `build/`, package
`.input.json` / `.report.md` files and `downloads/` under `web/public/`, the
fetched Lean checkout, and local SDK/engine installs under `.tools/`. The probe
generates its C++ codec tags and native registry under `build/generated/` before
compiling the shim; Lean codec constants remain ordinary source.

For failures, inspect `build/upstream-probe/boundary.md`, its `link.map` and
generated native wrappers, the relevant `build/generated/*.report.md`, or
`build/fixtures/summary.json`. [Fixture coverage](development/EXAMPLES_AND_FIXTURES.md) explains
the summary fields. Binding and surface reports live under `build/bindings/`,
`build/type-descriptors/` and `build/vir-surface/`.

If runtime, infoview or no-build checks report missing `web/public/` artifacts,
run `npm run build:demo`. Rebuild when the source of the reused Wasm or packages
changes; a no-build command does not refresh them.

## Smallest Useful Check

Choose the affected boundary first. `npm test` is the broad pre-merge code
check; [package.json](../package.json) owns its exact command order. Browser
semantics require the separate Chromium checks below.

### Package and fixture work

- Configuration, browser package catalog or output planning:
  `npm run test:packages:unit`. Add `npm run check:package` and runtime/browser
  checks against refreshed packages for catalog/root-selection changes. Fixture
  module changes also need the host/Wasm oracle suite.
- Compiled-module input and source re-elaboration regressions:
  `npm run test:runtime -- module-input`. For npm module CLI/config behavior,
  use `npm run test:runtime -- module-cli` alongside package units.
- Lake facets, marked-module selection, downstream input tracing, output
  ownership or SDK installation: `npm run test:lake`. Its cache checks cover
  the exercised scenarios; they do not establish cache-only artifact reuse.
- Fixture behavior: `VIR_FIXTURE_FILTER=<substring> npm run test:fixtures`;
  omit the filter for the whole oracle suite. Expectations, structured
  diagnostics and runner configuration alone use `npm run test:fixtures:unit`,
  without a Lean or Wasm build.
- IR object builders: `npm run test:package-ir-builders`. For package ABI
  changes, run `npm run check:package-abi`; name/declaration tag changes also
  need `npm run generate:ir-codec-tags`, `npm run check:ir-codec-tags` and
  upstream smoke. Decoder validation/failure cleanup uses
  `npm run test:runtime -- package-decoder`.

### Native and host boundaries

- Native declarations: `npm run check:native-externs`. Add
  `npm run check:client-native-externs` for client manifest selection, wrapper
  imports or provider handoff. Pure registry tooling uses
  `npm run test:native:unit`.
- Registry changes: regenerate with `npm run generate:boundary-registry`, then
  run `npm run check:boundary-registry` and `npm run check:native-wrappers` in
  addition to the declaration check. Boxed wrapper changes also need upstream
  smoke. See [native tooling](../scripts/native/README.md) for inspection.
- Interpreter or WASI behavior: `npm run test:upstream` builds the demo first.
  Use `npm run test:upstream:no-build` only after refreshing its artifacts.
- Lean host declarations, explicit conversions, JS providers or binding policy:
  `npm run check:bindings`. Array/Object/Promise type relationships can start
  with `npm run test:bindings:unit` and `npm run test:bindings:lean`; both are
  included in that gate and need no Wasm or temporary downstream project.
- External-client behavior across interpreter, package, ABI, native lookup or
  conversion changes: `npm run accept:lean-zip -- /path/to/lean-zip`. See
  [its acceptance contract](../scripts/packages/lean-zip/README.md); ordinary
  documentation or mechanical layout changes do not require this check.

### Runtime, browser and analysis work

- Runtime runner catalog, filtering or scheduling: `npm run test:runtime:unit`
  requires no generated artifacts. Runtime/host/manifest/callback behavior uses
  `npm run test:runtime:pure` with existing demo artifacts; package generation
  and SDK imports use `npm run test:runtime:lean`.
- Infoview bundle freshness, shell loading, widget-entry signatures, asset RPC
  or live module snapshots: `npm run test:infoview`. For actual-server RPC and
  lifetime behavior, use the [browser recipes below](#infoview-rpc-and-lifetime-checks).
- Site bundle or SDK/local archive shape: `npm run test:site` builds and checks
  the site. DOM, React, timers, animation and page interactions additionally
  need [Browser Smoke](#browser-smoke).
- React hooks, refs and component identity: `npm run build:demo-package`, then
  `CHROMIUM=/path/to/chromium node tests/browser/react-lifetimes.mjs`.
  Requires matching `web/public/vir-upstream.wasm` and npm dependencies, not a
  site build. Includes actual Lean/Wasm `useId` calls, committed rerender
  stability and accessible label/input/description links across instances and
  roots, with and without Strict Mode. The Pages suite runs the same probes
  using its `web/dist` artifacts.
- Surface analysis: `npm run test:surface`; add
  `CHROMIUM=/path/to/chromium npm run test:surface:browser` for report navigation
  or responsive layout. [Surface analysis](development/SURFACE_ANALYSIS.md) owns capture,
  comparison and rendering commands. API-coverage documentation uses
  `npm run check:api-coverage`.
- Benchmark harness/cache/sampling changes: `npm run test:bench`. Declaration
  lookup/provider performance uses `npm run bench:env-lookup -- --json <new-output-path>`
  and a separate `--cpu-profile` attribution run; see [performance](development/PERFORMANCE.md).
  After a demo build, `npm run test:env-lookup:wasm-pair` is a correctness smoke,
  not timing evidence. `npm run size:wasm` inspects built Wasm/linker-map sizes.
- Host-engine feature availability such as externref or JSPI:
  `npm run test:wasm-extensions`. Tutorial changes use `npm run test:tutorials`.

## Filters, Concurrency and No-Build Checks

`VIR_FIXTURE_FILTER` matches fixture id, source path, entry name and additional
roots by case-insensitive substring:

```bash
VIR_FIXTURE_FILTER=fib12 npm run test:fixtures
VIR_FIXTURE_FILTER=fib12 npm run test:fixtures:no-build
```

The no-build fixture path still builds the selected Lean modules and
`vir_irpkg`, then compares compiled host-driver and Wasm results. It skips only
the demo/Wasm build. [Fixture coverage](development/EXAMPLES_AND_FIXTURES.md) documents worker
limits and oracle expectations.

Select runtime smokes by id/path substring or group:

```bash
node tests/runtime/runner.mjs --list
npm run test:runtime -- package-decoder
npm run test:runtime -- --group pure
```

`VIR_RUNTIME_TEST_FILTER` also selects smokes; `VIR_RUNTIME_JOBS` controls worker
count. The `pure` group reuses demo artifacts and runs in parallel. The `lean`
group generates packages or checks SDK imports and runs serially to avoid
concurrent writes to shared `build/lean-lib` and `.lake` outputs. Pure runtime
smokes are distinct from the artifact-free runner unit tests.

## Browser Smoke

```bash
npm run build:site
CHROMIUM=/path/to/chromium npm run test:pages:browser
```

The browser runner serves `web/dist/` to headless Chromium over the Chrome
DevTools Protocol. It performs no build: missing artifacts or incompatible
package/manifest versions fail before Chromium starts, with `build:site` as the
remedy. Chromium is discovered in common Linux/macOS locations and `PATH`;
set `CHROMIUM` when it is elsewhere.

### Generation GC and mocked shell lifetime

These checks use matching demo Wasm/packages and npm dependencies, without a
site build:

```bash
node --expose-gc tests/runtime/generation-gc-smoke.mjs
CHROMIUM=/path/to/chromium node tests/browser/generation-gc.mjs
```

They cover callback/JSL finalizers and whole-generation collection. The browser
check bundles current source with real Wasm and official React Strict Mode and
Suspense. Retention controls distinguish collection from explicit cleanup.
Controlled-GC budgets are diagnostic: collection does not establish shared-map
lease cleanup or a Wasm capacity plateau.

For normal shell unmount/refresh and failed-setup teardown with real React and
Lean continuation bodies, but mocked asset/package RPC:

```bash
lake build VirInfoview vir_irpkg +ShellLifetime
lake env .lake/build/bin/vir_irpkg \
  build/shell-lifetime.irpkg build/shell-lifetime.report.md \
  --target-module ShellLifetime \
  Vir.Fixtures.ShellLifetime.createComponent Vir.Fixtures.ShellLifetime.mount
CHROMIUM=/path/to/chromium node tests/browser/shell-lifetime.mjs
```

This checks generation isolation, retained application activity, stale guards,
polling, failure cleanup and controlled GC. Mocked transport makes it separate
from the actual-server checks below.

### Infoview RPC and lifetime checks

```bash
CHROMIUM=/path/to/chromium npm run test:infoview:browser
```

The aggregate runs support/cleanup/error-formatting units and both real-server checks
sequentially, as in CI. Each builds its Lean fixtures and bundles current JS
against official React, the pinned RPC client and a real `lake serve` process.
They need npm dependencies and matching `web/public/vir-upstream.wasm`, but no
site build; use `npm run build:demo` for missing or changed Wasm.

- `node tests/infoview/rpc-browser.mjs` checks position-specific sessions,
  native Promise results, genuine `WithRpcRef`, rejection, cancellation and
  rerendering with the `tutorials.RpcReferenceWidget` package. Held real replies
  test stale success independently of aborting.
- `node tests/infoview/rpc-shell-lifetime.mjs` uses the actual shell,
  `ShellLifetime` and `RpcBrowserServer`. Wasm/packages arrive through real
  asset/package RPC. Delayed success and rejection after UI cleanup enter Lean
  stale guards; explicit disposal rejects before body entry. Live-generation
  and reference-round-trip controls distinguish them. The injected context
  accessor supplies official sessions; runtime instrumentation observes
  generations and supplies test bindings. Package/source/artifact hashes are
  reported after awaited teardown. It also checks readable build errors, slow
  initial packages with polling enabled or disabled, polling after installation,
  and abandoned-candidate teardown. This is not GC, warm-refresh recovery or
  server-restart acceptance.

The shared LSP/cancellation/response-gate/Chromium harness has focused units:
`node --test tests/infoview/rpc-browser-harness.test.mjs`. The separate
`npm run test:runtime -- infoview-rpc-promise` smoke checks exact Promise/function
identity and explicit Lean continuations through real Wasm.

### Upstream async-hook probe

```bash
CHROMIUM=/path/to/chromium node tests/infoview/upstream-async-probe.mjs
```

This manual characterization runs published infoview hooks unchanged with React
in Chromium; it needs npm dependencies, but no Lean or Wasm. It is separate from
the server gate. The [RPC guide](guides/INFOVIEW.md#pinned-upstream-hook-limitations)
records the pinned-version findings and their implications for hook adoption.

## CI Shape

CI builds the release/debug Wasm pair and browser packages once, runs upstream
smoke, and uploads demo artifacts plus a commit-addressed `lean-vir-sdk` archive.
Pure runtime jobs consume those artifacts without installing Lean;
Lean-dependent runtime and fixture jobs reuse them while building their Lean
inputs. They do not refetch Lean source or reinstall the WASI SDK.

For PRs, jobs check out the PR head SHA. GitHub artifact lookup and the SDK
manifest use that same commit, keeping source and downloaded artifacts aligned.
The [workflow files](../.github/workflows) own job definitions. Pages runs
`npm run build:site`; [surface analysis](development/SURFACE_ANALYSIS.md) explains its
deployed surface/size explorers.

## SDK Releases

Tags named `v<package.json version>` trigger
[release-sdk.yml](../.github/workflows/release-sdk.yml), which validates tag and
ABI versions, builds the SDK, imports its packaged modules and uploads the
archive to the matching release. Create the tag from the final merged commit
so its manifest identifies the revision clients use. Before the tag exists,
select `VIR_SDK_ARCHIVE` or the exact-commit artifact path; the zero-argument
`:virSdk` facet targets the tagged release. See
[SDK installation](guides/PACKAGES.md#install-the-browser-sdk).
