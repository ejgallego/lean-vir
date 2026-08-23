# Lean-zip package tooling

This directory owns VIR's Lean-zip-specific package workflows:

- `acceptance.mjs` compares native and VIR behavior for an external Lean-zip
  checkout through the stable `npm run accept:lean-zip` command.
- `export-browser-package.mjs` implements the browser benchmark catalog's
  repository-owned `package-command` producer contract.
- `browser-package-smoke.mjs` is copied into each exported package and verifies
  its runtime, `.irpkg`, compressed bytes, and raw-DEFLATE round trip.

Authored Lean sources remain under `fixtures/lean-zip/`. Generated packages,
reports, runtime bundles, and smoke inputs remain caller-owned or ignored
artifacts and are not committed.
