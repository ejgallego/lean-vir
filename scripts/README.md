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
  Build the upstream IR interpreter WASM and generated browser packages.
- `npm run test:upstream`
  Build the demo and run the upstream interpreter smoke test.
- `npm run test:runtime`
  Run JavaScript runtime, host binding, callback lifecycle, and manifest tests.
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

## Internal Helpers

Most files here are implementation details behind npm scripts. Prefer the npm
entry points above in documentation and routine validation, and call lower-level
scripts directly only when debugging that script or when a maintainer asks for a
specific narrow command.
