# Lean-zip package tooling

This directory owns VIR's Lean-zip-specific package workflows:

- `acceptance.mjs` compares native and VIR behavior for an external Lean-zip
  checkout through the stable `npm run accept:lean-zip` command.
- `acceptance-manifest.mjs` validates the generated native-oracle manifest
  before the runner reads any referenced artifacts.
- `export-browser-package.mjs` implements the browser benchmark catalog's
  repository-owned `package-command` producer contract for the current
  checkout. Catalog entry points remain relative to their pinned producer
  revisions.
- `browser-package-smoke.mjs` is copied into each exported package and verifies
  its runtime, `.irpkg`, compressed bytes, and raw-DEFLATE round trip.

Authored Lean sources remain under `fixtures/lean-zip/`. Generated packages,
reports, runtime bundles, and smoke inputs remain caller-owned or ignored
artifacts and are not committed.

## Acceptance boundary

The acceptance command builds two views of the exact checkout supplied by the
maintainer. `VirLeanZipAcceptance.NativeOracle` executes Lean-zip natively and
writes deterministic inputs, expected results, and `manifest.tsv`. The VIR
package generator separately selects the exports in
`VirLeanZipAcceptance.Exports`, and the shared Wasm runtime executes those
exports over the oracle inputs.

The runner requires native and VIR compression bytes and prescan decisions to
match and independently inflates every compressed result. When two or more
matrix passes are requested, it also checks that Wasm memory stabilizes after
the first pass. This covers the external package boundary, declaration closure,
interpreter behavior, native extern fallbacks, JavaScript value conversion, and
repeated runtime calls together. The manifest parser keeps the native fixture
as the sole owner of cases while rejecting missing categories, invalid values,
unsafe artifact names, duplicate vectors, and incomplete profiling groups
before execution.

The optional profiling contract is deliberately narrow. Every profiling row
uses the `large-heterogeneous` input. Levels 9 and 10 must each have a
`large-compress`, `profile-match`, and matching `profile-base` row. The
`profile-optimal` rows pair `fast` with level 9 and `exact` with level 10. The
runner rejects missing stages, different inputs, or matcher/base artifact
mismatches before starting Wasm execution.

Run this explicit check after changes to the interpreter, package generation,
runtime ABI or value conversion, native lookup, or Lean-zip integration. It is
not normally needed for documentation or mechanical layout changes. `--profile`
adds semantic checks and diagnostic timings for selected compression stages;
those single samples are not stable performance evidence.
