# `scripts/`

This directory contains repository-local build, packaging, analysis, and
maintainer tooling for Lean VIR. Most files are implementation details behind
the stable npm commands in `package.json`; prefer those commands in
documentation and routine validation.

The documentation owners are:

- `README.md` for the user-facing quickstart.
- `docs/HARNESS.md` for setup, validation commands, generated-artifact policy,
  and CI shape.
- `docs/PERFORMANCE.md` for benchmark capture and comparison workflows.
- `docs/MAILBOX_PROTOCOL.md` for mailbox commands and message semantics.
- `CONTRIBUTING.md` for branches, commits, pull requests, and
  `scripts/pr-message.sh`.

## Implementation Ownership

- Runtime, browser, upstream, surface, and integration checks live under
  `tests/`; test-only shared helpers live under `tests/support/`.
- Benchmark campaigns and their sampling, scheduling, reporting, and cache
  helpers live under `benchmarks/harness/`.
- Child-process wrappers live in `scripts/process-utils.mjs`; generic
  filesystem and executable lookup helpers live in `scripts/file-utils.mjs`.
  Nested tooling resolves the checkout through `scripts/repository-paths.mjs`.
- IR package generation, decoding, browser-package configuration, and
  distributable artifact policy live under `scripts/packages/`; reuse
  `scripts/packages/irpkg-generator.mjs` instead of invoking
  `lean --run tools/GeneratePackage.lean`.
- Surface analysis, frontier-size measurement, Wasm attribution, and static
  report generation live under `scripts/analysis/`; maintained presentation
  assets remain under `web/tools/` and focused coverage under `tests/surface/`.
- Shipped JavaScript binding inventory and report generation live in
  `tools/ExportVirJsInventory.lean` and
  `scripts/bindings/generate-shipped-bindings-report.mjs`. The compiler
  inventory also records every public executable declaration that transitively
  reaches a host target, including the exact IR declaration path.
- The consolidated binding explorer uses the colocated `Vir/*.bindings.json`
  manifests and `scripts/bindings/generate-binding-explorer.mjs`; run
  `npm run generate:bindings` to refresh it and `npm run check:bindings` to
  validate all layers. Reproducible explorer and descriptor outputs live under
  ignored `build/bindings/` and `build/type-descriptors/` paths.
- Binding and type-anchor implementations share their narrow CLI/output helpers
  under `scripts/bindings/`; their smoke coverage lives under `tests/bindings/`,
  authored comparison fixtures under `fixtures/type-anchors/`, and static
  explorer assets under `web/tools/binding-explorer/`.
- Native registry generation, wrapper inspection, declaration-IR tag mapping,
  demo host-import inventory, and object ABI linker flags live under
  `scripts/native/`; focused pure contracts live under `tests/native/` and
  implementation sources remain under `wasm/upstream_shim/`.
- Canonical browser package metadata lives in `fixtures/browser-packages.json`;
  `scripts/packages/browser-package-config.mjs` exposes its validated derived
  values to Node tooling. Reusable SDK payload and artifact-bundle policy live
  beside it under `scripts/packages/`.

Call a lower-level script directly only when debugging that implementation or
when a maintainer requests a narrow command.
