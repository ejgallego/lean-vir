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
- Child-process wrappers live in `scripts/process-utils.mjs`; filesystem,
  artifact, and executable lookup helpers live in `scripts/file-utils.mjs`.
- IR package generator setup lives in `scripts/irpkg-generator.mjs`; reuse it
  instead of invoking `lean --run tools/GeneratePackage.lean`.
- Native wrapper inspection lives in `scripts/inventory-native-wrappers.mjs`.
- IR declaration payload tag values live in
  `Vir/GeneratePackage/PackageIRTags.lean`; their generator and checker live in
  `scripts/ir-codec-tags.mjs` and `scripts/check-ir-codec-tags.mjs`.
- Object ABI linker flags live in `scripts/object-abi-linker-flags.mjs`, which
  consumes the shared runtime export-name manifest.
- Browser package metadata lives in `scripts/browser-package-config.mjs`, and
  reusable SDK payload helpers live in `scripts/sdk-payloads.mjs`.

Call a lower-level script directly only when debugging that implementation or
when a maintainer requests a narrow command.
