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
- `infoview/` owns the generated widget's Node smoke test.
- `mailbox/` owns protocol and CLI contracts for the local agent mailbox.
- `native/` owns pure registry contracts and the build-backed client native
  extern manifest smoke test.
- `packages/` owns direct contracts for repository package configuration,
  artifact layout, shared repository-path resolution, C++ package IR builders,
  and Lake facet integration.
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
The test root contains only this ownership map; implementations are grouped by
the subsystem they exercise.
