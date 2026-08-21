# Benchmarks

This directory owns performance campaigns and the tooling that runs them.

- `harness/` contains the repository-level Node and Wasm benchmark runners,
  comparison tools, scheduling, and artifact-cache support. Shared host-side
  workload values live with the regression inputs under `fixtures/js/`.
- `browser/` is the standalone browser benchmark site and artifact campaign.
  Its package also owns installation of the built benchmark Pages subtree.

Use the stable `npm run bench*` commands from the repository root. Focused
contract tests for the repository harness live in `tests/benchmarks/`; generic
build and package helpers remain under `scripts/`.
