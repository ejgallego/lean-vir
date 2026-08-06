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

The report also catalogs module-owned extern declarations as native, host, or
missing boundaries and preserves their declared backend targets. These extern
rows explain terminals such as `Lean.Expr.eqv`, but do not enter the function
coverage numerator or denominator: coverage continues to answer how many IR
functions have a complete closure, without counting a boundary twice.

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

## Comparing Runtime Experiments

Compare scans from control and candidate worktrees with:

```bash
npm run compare:surface -- \
  /path/to/control.json \
  /path/to/candidate.json \
  build/vir-surface/delta.json \
  build/vir-surface/delta.md
```

The comparator requires the same report version, Lean git hash, selected module
set, and declaration universe. A runtime experiment may change the native
capability registry, but not the Lean library being measured. This strictness
keeps source changes from being misreported as runtime coverage changes.

The delta JSON records the exact newly runnable and regressed declarations,
module/folder/library rollups, native-capability and extern-status transitions, and
blocked functions whose nearest boundary changed. The Markdown companion is a
compact review summary. In particular, a current primary-blocker count is only
an upper bound: satisfying that boundary may reveal another one. Only the A/B
delta's `newlyRunnable` set measures the benefit actually delivered by the
candidate runtime.

For a size experiment, pair this delta with the Wasm size report for the same
control and candidate artifacts. Review the added native capabilities, exact
new function set, module distribution, regressions, and byte increase together;
none of those numbers alone is a sufficient acceptance signal.

## Reference Experiment: `Lean.Expr.eqv`

The first end-to-end runtime frontier experiment used Lean 4.33.0-rc2 at
`d8b18978322de05a8f3dba51ef03cf5461676c17`. The control and candidate scanned
the same 2,481 modules and 398,519 IR functions; the candidate added only the
`Lean.Expr.eqv` native capability.

| Measurement | Control | Candidate | Delta |
| --- | ---: | ---: | ---: |
| Stripped release Wasm | 636,299 B | 643,016 B | +6,717 B |
| Gzip-compressed Wasm | 144,777 B | 147,113 B | +2,336 B |
| Runnable public constants | 26,307 / 36,887 | 26,547 / 36,887 | +240 |
| Runnable all-IR functions | 302,887 / 398,519 | 306,491 / 398,519 | +3,604 |
| Regressions | - | - | 0 |

The raw size cost is 6.56 KiB, or about 549 newly runnable IR functions and 37
newly runnable public constants per added KiB. Most of the gain is in
`Lean.Meta` (+1,930 all-IR, +127 public), followed by `Lean.Elab` (+900,
+32) and `Lean.Compiler` (+404, +30).

Before the experiment, `Lean.Expr.eqv` was the primary blocker for 9,803
functions. The exact comparison divided that upper bound into 3,604 real
unlocks and 6,199 functions that reached a newly exposed boundary. The largest
new boundaries include `Lean.Meta.whnf`, `Lean.Meta.inferType`, `Void.mk`,
`USize.toUInt64`, `Lean.Expr.dbgToString`, and `Lean.Level.beq`. This is the
intended use of the comparator: it both values the current runtime addition and
identifies candidates for the next measured experiment.

The candidate links upstream `expr_eq_fn.cpp` and its narrow kernel support
closure. A host-versus-Wasm fixture covers alpha-equivalent binders, mismatches,
nested applications, levels, literals, and syntax-bearing expression metadata.
The complete 83-fixture differential suite and the upstream smoke pass with the
candidate runtime.

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
aggregate counts. Selecting a module loads only that module's function data,
inserts its extern boundaries in name order, and provides declaration-name,
status, and class filters. Blocked function rows show the primary boundary;
linkable boundaries open their owning extern row and expose the backend target,
blocked-root impact, and representative dependency path. Declaration links use
the `#declaration=...` fragment and can be shared directly.

The generated directory contains a navigation index with the comparatively
small extern catalog plus one compact JavaScript data file per module with
functions. This keeps initial browser load independent of the complete
function count and avoids parsing the full JSON report before the user selects
a module.

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
