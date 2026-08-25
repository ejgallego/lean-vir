# Illuminate package tooling

This directory owns VIR's Illuminate browser package workflow:

- `export-browser-package.mjs` consumes an exact Illuminate workload package,
  builds the matching typed VIR entry in an isolated source view, and emits a
  checksummed browser package.
- `browser-package-smoke.mjs` is copied into that package and checks the real
  VIR interpreter, `.irpkg`, and typed player-trace entry.

The exported Lean entry remains under `fixtures/illuminate/`. The exporter
deletes its temporary source view and package-generation report. Its
checksummed output directory, including the runtime bundle, package, and smoke
payload, is caller-owned and is not committed.
