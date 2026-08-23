# Tests

This directory owns test-only harness code and focused contract tests. Product
and maintainer tooling stays with its owning directory; tests import those
modules rather than making `scripts/` a mixed implementation-and-test folder.

- `benchmarks/` tests the repository benchmark harness without running a full
  performance campaign.
- `bindings/` owns direct unit coverage and end-to-end smoke checks for the
  shipped-binding explorer and type-anchor tooling under `scripts/bindings/`.
- `browser/` owns the Chromium page-smoke runner and its browser-only helpers.
- `native/` owns pure contracts for registry generation under
  `scripts/native/`; build-backed boundary checks retain stable npm commands.
- `packages/` owns direct contracts for repository package configuration,
  artifact layout, and shared repository-path resolution.
- `fixture-runner.mjs` is the integration entry point for Lean fixture
  host-oracle and Wasm comparison checks; their inputs live in root
  `fixtures/`. The shared manifest and expectation contract lives beside those
  inputs in `fixtures/fixture-manifest.mjs`; report diagnostics, immutable
  runner configuration, result evaluation, summary construction, and the
  cached runner context live under `support/`. The pure contracts have direct
  coverage in the top-level `fixture-*.test.mjs` files.
- `runtime/` owns the JavaScript runtime smoke-test runner, its immutable test
  catalog and pure selection and scheduling policy, and its focused test cases.
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
Top-level files are focused integration entry points whose implementation
dependencies remain with their owning library or script directory.
