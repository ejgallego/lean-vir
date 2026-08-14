# Tests

This directory owns test-only harness code and focused contract tests. Product
and maintainer tooling stays with its owning directory; tests import those
modules rather than making `scripts/` a mixed implementation-and-test folder.

- `benchmarks/` tests the repository benchmark harness without running a full
  performance campaign.
- `runtime/` owns the JavaScript runtime smoke-test runner and its focused test
  cases.

Use the stable `npm run test:*` commands from the repository root.
