# Lean-zip package tooling

This directory owns VIR's Lean-zip-specific package workflows:

- `acceptance.mjs` compares native and VIR behavior for an external Lean-zip
  checkout through the stable `npm run accept:lean-zip` command.
- `acceptance-manifest.mjs` validates the generated native-oracle manifest
  before the runner reads any referenced artifacts.
- `module-project.mjs` creates the shared dependent Lake project for the
  compiled adapter and native oracle. Lake supplies dependency search paths
  and native libraries; neither command copies the client's Lake configuration
  nor constructs `LEAN_PATH` manually.
- `export-browser-package.mjs` implements the browser benchmark catalog's
  repository-owned `package-command` producer contract for the current
  checkout. Catalog entry points remain relative to their pinned producer
  revisions.
- `browser-package-smoke.mjs` is copied into each exported package and verifies
  its runtime, `.irpkg`, compressed bytes, and raw-DEFLATE round trip.

Authored Lean sources remain under `fixtures/lean-zip/`. Generated packages,
reports, runtime bundles, and smoke inputs remain caller-owned or ignored
artifacts and are not committed.

Both commands require module-capable lean-zip sources and the exact toolchain
named in VIR's `lean-toolchain`. The temporary project depends on the supplied
client and producer by local path and reads the adapter sources from VIR.
It does not edit their sources, configuration or dependency pins; ordinary Lake
builds may populate their build caches. The acceptance command removes its
temporary project unless `--keep` is requested; the browser exporter always
removes its temporary project.

The upstream module port is maintainer-owned. Full external acceptance of this
adapter migration is deferred until a matching module-capable checkpoint is
available. That run must compile the actual adapter, including the transparent
Lean bodies required by `vir_extern_fallback`, and exercise the compression
matrix below. The `lean-zip-module-project` runtime smoke checks real module
compilation and inherited native linking with a small test dependency; it does
not claim compression equivalence. Historical browser catalogs continue to
invoke their pinned producers and are not repinned by this migration.

## Acceptance boundary

The acceptance command builds two compiled modules against the checkout supplied
by the maintainer. `VirLeanZipAcceptance.NativeOracle` executes Lean-zip natively and
writes deterministic inputs, expected results, and `manifest.tsv`. The VIR
package generator separately selects the exports in
`VirLeanZipAcceptance.Exports`, and the shared Wasm runtime executes those
exports over the oracle inputs.

Package selection uses `--target-marked-module` for the acceptance matrix and
`--target-module` for the browser workload's explicit compression entry. The
browser exporter supplies the same client native-extern manifest to runtime
construction and package generation.

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
