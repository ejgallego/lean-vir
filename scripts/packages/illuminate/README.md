# Illuminate package tooling

This directory owns VIR's Illuminate browser package workflow:

- `export-browser-package.mjs` consumes an exact Illuminate workload package,
  builds the matching typed VIR entry in an isolated source view, and emits a
  checksummed browser package.
- `browser-package-smoke.mjs` is copied into that package and checks the real
  VIR interpreter, `.irpkg`, and typed player-trace entry.

The exported Lean entry remains under `fixtures/illuminate/`. Generated source
views, runtime bundles, packages, reports, and smoke inputs remain caller-owned
or ignored artifacts and are not committed.
