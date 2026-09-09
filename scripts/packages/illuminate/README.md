# Illuminate package tooling

This directory owns VIR's Illuminate browser package workflow:

- `export-browser-package.mjs` consumes an exact Illuminate workload package,
  builds the matching typed VIR entry in an isolated source view, and emits a
  checksummed browser package.
- `source-project.mjs` preserves the client's archived Lake configuration,
  toolchain and dependency pins, then registers VIR's adapter as a module in
  that temporary project. Lake builds `+VirIlluminateAcceptance.Exports` before
  the generator selects its marked exports by module identity.
- `browser-package-smoke.mjs` is copied into that package and checks the real
  VIR interpreter, `.irpkg`, and typed player-trace entry.

The exported Lean entry remains under `fixtures/illuminate/`. The exporter
deletes its temporary source view and package-generation report. Its
checksummed output directory, including the runtime bundle, package, and smoke
payload, is caller-owned and is not committed.

The client dependency must itself use Lean modules. Source files are not
rewritten to change their visibility or re-elaborated during packaging.
`node --test tests/packages/illuminate-source-project.test.mjs` checks source
isolation and preparation cleanup without requiring an external checkout.
Acceptance of a producer change also needs a build and package-generation check
against the selected real Illuminate revision; full runtime bundling/linking is
separate from this source-project unit test.
