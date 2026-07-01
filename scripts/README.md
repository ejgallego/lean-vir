# `scripts/`

This directory contains repository-local maintainer tooling for Lean VIR. The
public user workflow starts in the top-level `README.md`; the maintainer command
map lives in `docs/HARNESS.md`.

## Normal Entry Points

- `npm run setup`
  Fetch the pinned Lean source checkout, install the local WASI SDK, and build
  the demo WASM.
- `npm run doctor`
  Check the local toolchain, pinned Lean source checkout, generated WASM/package
  artifacts, WASI SDK, and optional Chromium browser.
- `npm run build:demo`
  Build the upstream IR interpreter WASM and generated browser packages. The
  browser package step uses the compiled `vir_irpkg` generator executable.
- `npm run build:demo:dist`
  Build the same optimized demo WASM and packages, then strip the public WASM
  artifact for distribution.
- `npm run generate:irpkg`
  Build the local Lean library and `vir_irpkg` generator executable, then
  generate one manifest-bearing `.irpkg`.
- `npm run test:upstream`
  Build the demo and run the upstream interpreter smoke test.
- `npm run test:upstream:no-build`
  Reuse existing demo WASM and browser packages for the upstream smoke test.
- `npm run test:runtime`
  Run all JavaScript runtime, host binding, callback lifecycle, manifest,
  package-generation, and SDK import smoke tests. Use
  `npm run test:runtime -- <substring>` or
  `VIR_RUNTIME_TEST_FILTER=<substring>` to narrow it. Pure runtime smokes run
  in parallel; Lean-dependent package-generation smokes are serialized because
  they share Lean build outputs.
- `npm run test:runtime:pure`
  Run the runtime smoke group that only needs Node plus existing demo artifacts.
- `npm run test:runtime:lean`
  Run the package-generation and SDK import runtime smoke group that also needs
  Lean. Use `npm run test:runtime -- --group <group>` for explicit group
  selection.
- `npm run test:wasm-extensions`
  Probe optional JS/Wasm interop features such as `externref` and JSPI.
  Missing `externref` support fails because the experimental React resource
  prototype requires it; unsupported JSPI is reported as skipped.
- `npm run test:fixtures`
  Run the fixture host-oracle suite. Use `VIR_FIXTURE_FILTER=<substring>` to
  narrow it.
- `npm run test:fixtures:no-build`
  Reuse an existing `web/public/vir-upstream.wasm` for faster fixture iteration.
- `npm run test:site`
  Build the Vite site, local archive, SDK archive, and check the generated
  `web/dist` artifact shape.
- `npm run test:pages:browser`
  Run the generated site in headless Chromium. Set `CHROMIUM=/path/to/chromium`
  if the browser is outside the usual discovery paths.
- `scripts/pr-message.sh`
  Print the public PR title/body scaffold for the current branch.

## Generated Outputs

Generated files are local artifacts unless the maintainer explicitly asks for a
tracked artifact-policy change:

- `build/`
- `web/dist/`
- `web/public/*.wasm`
- `web/public/*.irpkg`
- `web/public/*.input.json`
- `web/public/*.report.md`
- `web/public/downloads/`
- `.tools/`
- `third_party/lean4-src/`

Useful diagnostic reports include `build/upstream-probe/boundary.md`,
`build/generated/*.report.md`, and `build/fixtures/summary.json`.

Commands ending in `:no-build` and the runtime smoke tests expect
`web/public/vir-upstream.wasm` and browser `.irpkg` files from a previous
`npm run build:demo`. If one of those commands reports a missing
`web/public/...` artifact, rebuild the demo artifacts rather than committing a
generated output.

## Internal Helpers

Most files here are implementation details behind npm scripts. Prefer the npm
entry points above in documentation and routine validation, and call lower-level
scripts directly only when debugging that script or when a maintainer asks for a
specific narrow command.

The split helpers below are the intended extension points for focused changes:

- Runtime smoke cases live in `scripts/runtime-tests/*.mjs`; add new runtime,
  codec, manifest, or host binding checks there rather than growing
  `scripts/test-vir-runtime.mjs`.
- Browser smoke behavior is split across `scripts/browser-smoke-*.mjs`;
  `scripts/smoke-pages-browser.mjs` should stay an orchestrator.
- Child process wrappers live in `scripts/process-utils.mjs`; filesystem,
  artifact, and executable lookup helpers live in `scripts/file-utils.mjs`.
- IR package generator setup lives in `scripts/irpkg-generator.mjs`; reuse it
  instead of shelling out through `lean --run tools/GeneratePackage.lean`.
- Benchmark sample parsing and formatting live in `scripts/bench-utils.mjs`.
- Browser package metadata helpers live in `scripts/browser-package-config.mjs`
  and reusable SDK payload helpers live in `scripts/sdk-payloads.mjs`.

Performance comparison commands are documented in `docs/PERFORMANCE.md`.
Use `npm run bench -- --json PATH` for report capture,
`npm run bench:compare -- BEFORE.json AFTER.json` for saved reports, and
`npm run bench:paired -- --repeat 5 BEFORE_CHECKOUT AFTER_CHECKOUT` for
alternating repeated runs across two checked-out trees.
