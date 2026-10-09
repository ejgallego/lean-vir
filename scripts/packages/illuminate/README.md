# Illuminate package tooling

This directory owns VIR's Illuminate browser package workflow:

- `export-browser-package.mjs` consumes an exact Illuminate workload package,
  builds the matching typed VIR entry in an isolated source view, and emits a
  checksummed browser package.
- `source-project.mjs` preserves the client's archived Lake configuration,
  dependency pins, writes VIR's pinned toolchain into the temporary source
  view, then registers VIR's adapter as a module there. The generated package
  records both the client's declared pin and the effective build pin. Lake
  builds `+VirIlluminateAcceptance.Exports` before the generator selects its
  marked exports by module identity.
- `browser-package-smoke.mjs` is copied into that package and checks the real
  VIR interpreter, `.irpkg`, and typed player-trace entry.

The exported Lean entry remains under `fixtures/illuminate/`. The exporter
deletes its temporary source view and package-generation report. Its
checksummed output directory, including the runtime bundle, package, and smoke
payload, is caller-owned and is not committed.

The client dependency must itself use Lean modules. Its original checkout and
dependency manifest are not rewritten; only the caller-owned temporary view
uses VIR's toolchain. A successful export qualifies that exact source revision
under the recorded effective compiler, without changing the client's declared
support policy.
`node --test tests/packages/illuminate-source-project.test.mjs` checks source
isolation and preparation cleanup without requiring an external checkout.
Acceptance of a producer change also needs a build and package-generation check
against the selected real Illuminate revision; full runtime bundling/linking is
separate from this source-project unit test.
