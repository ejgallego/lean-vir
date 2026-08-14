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
- `npm run mailbox:check`
  Validate immutable v1 mailbox messages in the primary checkout.
- `npm run mailbox:list`
  Summarize nonterminal mailbox threads from the primary checkout. Pass
  `-- --all` to include closed and cancelled threads, or `-- --json` for
  machine-readable output.
- `npm run mailbox:deliver -- /path/to/draft.md`
  Validate a complete draft against the active mailbox and archive, then stage
  and atomically publish it without consuming the source draft or overwriting
  an existing message identity.
- `npm run mailbox:archive -- <thread-id>`
  Move a wholly closed or cancelled thread out of the active mailbox without
  deleting its immutable messages. Inspect retained threads with
  `npm run mailbox:list -- --archive`.
- `npm run test:mailbox`
  Exercise v1 parsing, documented examples, integrity checks, advisory
  workflow warnings, archival, primary-checkout discovery, and CLI output.
- `npm run build:demo`
  Build the upstream IR interpreter WASM and generated browser packages. The
  browser package step uses the compiled `vir_irpkg` generator executable. The
  build writes `web/public/vir-upstream.wasm` and the debug companion
  `web/public/vir-upstream.dev.wasm`.
- `npm run build:demo:release`
  Build the same optimized demo WASM and packages, then strip the public WASM
  artifact for distribution. The debug companion remains optimized but
  unstripped; it is not an `-O0` build.
- `npm run size:wasm`
  Print Markdown section-size tables for the generated WASM artifacts, including
  compressed sizes and link-map code-area attribution when available.
- `npm run analyze:frontier-size`
  Measure exact stripped release-Wasm raw and gzip costs for temporary native
  extern additions without changing the checked-in catalog. Positional names
  are measured in isolation; use `--plan` for directly priced clusters and
  `--surface-links` to attach primary-blocker pressure hints. The runner skips
  browser package generation and restores the byte-identical baseline artifact.
- `npm run analyze:surface -- REPORT.json REPORT.md [--module MODULE] [--root NAME]`
  Analyze installed libraries or a focused function set with VIR's pinned Lean
  toolchain.
- `npm run analyze:target-surface -- --project PROJECT --source FILE --module MODULE --root NAME --output-prefix PREFIX [--native-extern-manifest FILE]`
  Capture a complete blocker frontier with the target project's pinned Lean,
  then apply VIR's current runtime policy. The optional manifest, or
  `VIR_NATIVE_EXTERN_MANIFEST`, adds the matching client-native profile.
- `npm run render:surface -- REPORT.json OUTPUT_DIR [--frontier-costs COSTS.json] [--collection]`
  Build the static boundary explorer, including function/extern signatures and
  docstrings. Use `render:target-surface-index` for a collection landing page.
- `npm run build:size-site`
  Render the release/debug Wasm artifacts and strict linker map as the static
  size explorer deployed under `/size/`. With surface-link data it also shows
  native provider coverage, blocker pressure, and links back to declarations.
  The standalone command works without those optional joins.
- `npm run build:analysis-site`
  Build the complete runnable-surface report, price the tracked candidates in
  `scripts/frontier-size-plan.json`, rerender the surface UI with those costs,
  and build the cross-linked Wasm size explorer. `npm run build:site` uses this
  entry point for the analysis portion of the Pages artifact.
- `npm run generate:irpkg`
  Build the local Lean library and `vir_irpkg` generator executable, then
  generate one manifest-bearing `.irpkg`.
- `npm run inspect:native-wrappers`
  Print a generated inventory of the current boxed native extern wrappers,
  grouped into compiler-generated adapters and the audited handwritten
  ownership exceptions.
- `npm run check:native-wrappers`
  Run the same inventory in check mode and reject any missing, extra,
  reclassified, or unapproved handwritten boxed adapter.
- `npm run generate:boundary-registry`
  Generate the ignored C++ native-symbol registry from the tracked Lean native
  extern policy.
- `npm run check:boundary-registry`
  Verify registry coverage and the handwritten boxed-wrapper boundary.
- `npm run generate:ir-codec-tags`
  Generate the C++ IR declaration tag enums from the tracked Lean constants
  and `scripts/ir-codec-tags.mjs` mapping.
- `npm run check:ir-codec-tags`
  Verify the tag assignments and that the Lean emitter and C++ decoder use
  every non-reserved tag.
- `npm run test:upstream`
  Build the demo and run the upstream interpreter smoke test.
- `npm run test:upstream:no-build`
  Reuse existing demo WASM and browser packages for the upstream smoke test.
- `npm run test:bench`
  Run the dependency-free artifact-cache, benchmark sampler, focused-identity,
  and paired-runner contract tests.
- `npm run bench:env-lookup`
  Measure repeated public interpreter calls through a large package, with an
  optional execution-window V8 CPU profile. See `docs/PERFORMANCE.md`.
- `npm run bench:env-lookup:wasm-pair -- CONTROL_WASM CANDIDATE_WASM`
  Compare two frozen Wasm build modes in one process with alternating order,
  collection outside timing, checksum parity, and raw paired samples.
- `npm run test:env-lookup:wasm-pair`
  Run a post-build control/control correctness smoke of the paired Wasm runner.
- `npm run test:package-ir-builders`
  Check erased IR metadata object layouts at the C++ package boundary.
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
- `npm run check:native-externs`
  Resolve every native extern specification from Lean's imported IR and extern
  metadata, reject duplicates and stale symbol overrides, and report the split
  between Lean-derived symbols and VIR provider overrides.
- `npm run check:client-native-externs`
  Build the small client project fixture, generate its native wrapper/provider
  plan, verify native-over-fallback package selection, and reject malformed,
  duplicate, colliding, and unknown manifest entries.
- `npm run test:fixtures`
  Run the fixture host-oracle suite. Use `VIR_FIXTURE_FILTER=<substring>` to
  narrow it.
- `npm run test:fixtures:no-build`
  Reuse an existing `web/public/vir-upstream.wasm` for faster fixture iteration.
- `npm run accept:lean-zip -- /path/to/lean-zip`
  Build the checked-in native oracle against a lean-zip checkout, generate the
  matching VIR package, and compare levels 0 through 10, larger compressible
  inputs, and large-input incompressible-prescan decisions. The default three
  matrix passes also assert that Wasm memory stabilizes after the first pass;
  pass `--passes 1` for a quicker diagnostic without that assertion. Requires
  an existing `web/public/vir-upstream.wasm`; use `--wasm path` to select a
  different build and `--keep` to retain temporary artifacts. The checkout may
  instead be supplied through `LEAN_ZIP_CHECKOUT`. Add `--profile` to time
  direct levels 5 through 10 paths for the larger corpora through the opt-in
  runtime phase timer; these single samples are diagnostic attribution rather
  than benchmark evidence. The same mode native-checks and times the
  heterogeneous level-9/10 packed matcher, base-candidate preparation, and
  fast/exact optimal candidate separately.
- `npm run test:site`
  Build the Vite site, runnable-surface and Wasm-size reports, local archive,
  SDK archive, and check the generated `web/dist` artifact shape.
- `npm run test:pages:browser`
  Run the generated site in headless Chromium. Set `CHROMIUM=/path/to/chromium`
  if the browser is outside the usual discovery paths.
- `scripts/pr-message.sh`
  Print the public PR title/body scaffold for the current branch.

## Generated Outputs

The build and packaging outputs below are local artifacts unless the maintainer
explicitly asks for a tracked artifact-policy change:

- `build/`
- `web/dist/`
- `web/public/*.wasm`
- `web/public/*.irpkg`
- `web/public/*.input.json`
- `web/public/*.report.md`
- `web/public/downloads/`
- `.tools/`
- `third_party/lean4-src/`

The tracked Lean codec constants define the wire values; their C++ mirror and
the native-symbol registry are generated below `build/generated/`. The WASM
probe generates them as prerequisites; use
`npm run generate:ir-codec-tags` or `npm run generate:boundary-registry` when a
standalone generated copy is useful for inspection.

Useful diagnostic reports include `build/upstream-probe/boundary.md`,
`build/upstream-probe/link.map`, `build/generated/*.report.md`, and
`build/fixtures/summary.json`.

Commands ending in `:no-build` and the pure runtime smoke tests expect
`web/public/vir-upstream.wasm` and browser `.irpkg` files from a previous
`npm run build:demo`. SDK/local artifact packaging and SDK import smokes also
expect the optimized debug companion `web/public/vir-upstream.dev.wasm`. If one
of those commands reports a missing `web/public/...` artifact, rebuild the demo
artifacts rather than committing a generated output.

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
- Native wrapper inventory lives in `scripts/inventory-native-wrappers.mjs`;
  keep it as an inspection aid until regular wrapper generation exists.
- IR declaration payload tag values live in
  `Vir/GeneratePackage/PackageIRTags.lean`; run
  `npm run generate:ir-codec-tags` and `npm run check:ir-codec-tags` after
  changing them.
- Object ABI linker flags come from `scripts/object-abi-linker-flags.mjs`,
  which consumes the shared runtime export-name manifest rather than keeping a
  second linker-only list.
- Benchmark campaigns and their shared sampling/report helpers live in
  `benchmarks/harness/`; their focused contract tests live in
  `tests/benchmarks/`.
- Browser package metadata helpers live in `scripts/browser-package-config.mjs`
  and reusable SDK payload helpers live in `scripts/sdk-payloads.mjs`.

Performance comparison commands are documented in `docs/PERFORMANCE.md`.
Use `npm run bench -- --json PATH` for broad report capture,
`npm run bench:env-lookup -- --json PATH` for declaration lookup work,
`npm run bench:env-lookup:wasm-pair -- --json PATH CONTROL_WASM CANDIDATE_WASM`
for intentional Wasm build-mode comparisons,
`npm run bench:compare -- BEFORE.json AFTER.json` for saved reports, and
`npm run bench:paired -- --repeat 6 --out NEW_DIR BEFORE_CHECKOUT AFTER_CHECKOUT`
for AB/BA repeated runs across two checked-out trees.
