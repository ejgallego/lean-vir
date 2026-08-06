# VIR Runnable Surface Analysis

This tool measures which functions in Lean's installed libraries have a
complete static IR dependency closure under VIR's current runtime
capabilities. Its purpose is to answer questions such as: if a runtime change
adds 300 KiB to the Wasm binary, exactly which additional Lean functions and
modules become runnable?

The versioned JSON report is the comparison artifact. The Markdown companion
is a compact human view of the same scan.

## Runnable Definition

For every selected module, the analyzer considers each owned Lean IR function
as a root and follows its transitive IR references. A root is statically
runnable when the walk reaches no unsupported terminal boundary. Cycles with
no unsupported boundary are complete.

The current terminal boundaries are:

- `missingExtern`: an extern is not in VIR's native capability table;
- `missingDecl`: referenced IR is absent from the imported environment; and
- `unsupportedInitGlobal`: an initializer-backed global cannot be reduced to a
  supported initializer dependency.

Registered native externs are supported graph nodes and contribute their
declared runtime dependencies. A `@[vir_js]` extern is treated as a satisfiable
host boundary; whether a particular host supplies it is a separate dynamic
question.

A function can reach several terminal boundaries. The aggregate tables assign
it one deterministic nearest primary blocker so blocker totals do not
double-count roots. Every declaration record includes that blocker and one
representative path to it.

The headline deliberately does not require:

- current `.irpkg` encodability, because VIR owns and can extend that format;
- direct JavaScript callability or a supported public interface type; or
- dynamic semantic validation in the browser runtime.

Those are useful independent axes, but making them gates here would obscure
the runtime-coverage question.

## Function Classes

The primary numerator is **public constants with IR**: non-private function
declarations that also have a Lean environment constant. This excludes boxed
wrappers and compiler-generated helpers from the public headline without
claiming that every remaining constant is an intentionally curated API.

The all-IR numerator also includes private constants, boxed wrappers, and
generated functions. This second view describes how much of the compiler's
actual closure is covered and explains why a single missing boundary can block
many generated declarations.

## Running A Scan

Build the executable and scan all installed `Init`, `Lean`, `Std`, and `Lake`
`.ir` modules:

```bash
lake build vir_surface
.lake/build/bin/vir_surface \
  build/vir-surface/lean-libraries.json \
  build/vir-surface/lean-libraries.md
```

For a fast focused scan, repeat `--module` as needed:

```bash
npm run analyze:surface -- \
  /tmp/lean-meta-basic.json \
  /tmp/lean-meta-basic.md \
  --module Lean.Meta.Basic
```

The executable reports import, analysis, rendering, and write times
separately. A complete report contains hundreds of thousands of declaration
records and representative paths, so its JSON can exceed 100 MiB. Keep normal
outputs under ignored `build/` paths.

Run the focused schema and closure-invariant check with:

```bash
npm run test:surface
```

## Interactive HTML Report

Render any JSON scan as a static browser report:

```bash
npm run render:surface -- \
  build/vir-surface/lean-libraries.json \
  build/vir-surface/html
```

Open `build/vir-surface/html/index.html` directly. The artifact supports both
`file://` browsing and an ordinary static HTTP server; it has no runtime npm or
CDN dependency.

The left navigator treats dotted Lean module names as folders and files. Both
folders and modules show a selectable public-constant or all-IR coverage
percentage. Selecting a folder shows its immediate subfolders/modules and
aggregate counts. Selecting a module loads only that module's declaration data
and provides function-name, status, and class filters. Blocked function rows
show the primary boundary, and selecting a function reveals its representative
dependency path.

The generated directory contains a small navigation index plus one compact
JavaScript data file per module with functions. This keeps initial browser load
independent of the complete declaration count and avoids parsing the full JSON
report before the user selects a module.

## Reading And Comparing Reports

The Markdown and HTML reports provide:

- total public-constant and all-IR coverage;
- top-level `Init`, `Lean`, `Std`, and `Lake` rollups;
- exact per-module counts; and
- top primary blockers with an example dependency path.

The JSON additionally records the Lean toolchain identity, selected modules,
the complete native capability table, and every declaration result. When
evaluating a runtime addition, run the same selected modules in control and
candidate worktrees, verify the toolchain identity matches, then compare
declarations by Lean name. The meaningful benefit is the newly runnable set,
grouped by library/module and blocker removed; a headline percentage alone is
not enough to justify binary growth.

Package encoding, JavaScript interface coverage, and dynamic browser tests can
then be applied to the newly runnable set as follow-up analyses without
changing this report's static runtime definition.
