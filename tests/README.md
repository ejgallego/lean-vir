# Tests

This directory owns test-only harness code and focused contract tests. Product
and maintainer tooling stays with its owning directory; tests import those
modules rather than making `scripts/` a mixed implementation-and-test folder.

- `benchmarks/` tests the repository benchmark harness without running a full
  performance campaign.
- `browser/` owns the Chromium page-smoke runner and its browser-only helpers.
- `fixtures/` owns the Lean fixture host-oracle and Wasm comparison runner.
- `runtime/` owns the JavaScript runtime smoke-test runner and its focused test
  cases.
- `surface/` tests the report-analysis and rendering tools kept in `scripts/`.
- `support/` contains helpers shared only by test suites.
- `upstream/` owns the end-to-end upstream interpreter smoke test and its
  scenario helpers.

Use the stable `npm run test:*` commands from the repository root.
