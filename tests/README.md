# Tests

This directory owns test-only harness code and focused contract tests. Product
and maintainer tooling stays with its owning directory; tests import those
modules rather than making `scripts/` a mixed implementation-and-test folder.

- `benchmarks/` tests the repository benchmark harness without running a full
  performance campaign.
- `bindings/` owns direct unit coverage and end-to-end smoke checks for the
  shipped-binding explorer and type-anchor tooling under `scripts/bindings/`.
- `browser/` owns the Chromium page-smoke runner and its browser-only helpers.
- `fixtures/` owns the Lean host-oracle/Wasm comparison runner and its pure
  contracts. Authored inputs and the manifest remain under root `fixtures/`;
  test-only runner support remains under `support/`.
- `infoview/` owns widget and live-module smoke tests, real-server browser RPC
  and shell-lifetime checks, and their shared LSP/Chromium harness.
- `mailbox/` owns protocol and CLI contracts for the local agent mailbox.
- `native/` owns pure registry contracts and the build-backed client native
  extern manifest smoke test.
- `packages/` owns direct contracts for repository package configuration,
  artifact layout, shared repository-path resolution, C++ package IR builders,
  Lake facet integration, and repository-owned external-client producers.
- `runtime/` owns the JavaScript runtime smoke-test runner, its immutable test
  catalog and pure selection and scheduling policy, focused test cases, and
  host-engine Wasm feature probes.
  Run `npm run test:runtime:unit` to check the runner contract without executing
  the runtime smoke tests or building Lean artifacts.
- `surface/` tests the report-analysis and rendering tools under
  `scripts/analysis/`.
- `support/` contains helpers shared only by test suites.
- `upstream/` owns the end-to-end upstream interpreter smoke test and its
  scenario helpers.

Use the stable `npm run test:*` commands from the repository root.
Run `npm run test:fixtures:unit` for the fixture support contracts without a
Lean or Wasm build.
Run `npm run test:packages:unit` for package-tooling contracts without building
Lean or distributable artifacts.
Run `npm run test:native:unit` for native-registry contracts without building
Lean or the Wasm shim.
Implementations are grouped by the subsystem they exercise. See
[HARNESS.md](../docs/HARNESS.md) for artifact prerequisites and focused check
selection.

## Adding Lean package tests

Use `tests/support/module-project.mjs` for temporary Lake projects;
`createRuntimeModuleProject` pairs it with the prepared runtime-test generator.
The helper pins the repository toolchain and local dependency. Supply explicit
module names, source visibility and compile-time imports; it does not rewrite
headers. Pair its `env()` with its `directory` as cwd, build only the intended
roots, and clean up the scratch directory.

Separate compilation failures from package failures. Compile successfully
before asserting package-time diagnostics; attribute/typechecking negatives
instead assert the build failure. Keep independent negative cases in separate
modules rather than an umbrella import. Isolated marker and host-attribute
tests need `meta import Vir.Attributes` and `meta import Vir.Host`, respectively.
Assert `#eval` effects during compilation and their absence during packaging;
Lake replaying a build message does not mean source commands ran again.

Fixture oracle drivers import compiled bodies with `import all`, keep
`interpreter.prefer_native false`, and preserve unsafe-entry handling. Reuse
the compiled `vir_irpkg` generator instead of starting `lean --run` per fixture
or copying source text into a driver.

For shared module-project helper changes, run `npm run test:fixtures:unit`,
`npm run test:runtime -- module-project package-generation`, and the fixture
oracle suite.
