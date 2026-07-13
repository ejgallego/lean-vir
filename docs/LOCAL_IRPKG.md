# Local IR Packages

The local package path takes one Lean source file, packages one or more exported
declarations into a `.irpkg`, and loads that package in `/dev.html`. The browser
runner reads the embedded manifest and renders entry controls automatically.

The browser demo also loads generated focused packages from `web/public/`,
including `fixtures-basic.irpkg`, `demo-host.irpkg`, `pretty-printer.irpkg`,
`fixtures-lean.irpkg`, and `fixtures-boundary.irpkg`.

For calling packaged Lean declarations from JavaScript, see
`docs/CALL_LEAN_FROM_JS.md`. For the config-driven path, see
`docs/INTERFACE_PIPELINE.md`.

## Generate A Package

Generate the bundled quickstart package:

```bash
npm run quickstart
```

Then run the local server and open the printed URL:

```bash
npm run dev -- --port 5173
```

The general command shape is:

```bash
npm run generate:irpkg -- <source.lean> [package.irpkg] [root ...]
```

Package the transitive closure for one or more explicit exports. This is the
core "one Lean file, N browser entries" path:

```bash
npm run generate:irpkg -- examples/Quickstart.lean web/public/local-quickstart.irpkg Quickstart.double Quickstart.greet Quickstart.total Quickstart.choose Quickstart.classify Quickstart.validateName
```

Package public source definitions by omitting roots:

```bash
npm run generate:irpkg -- examples/Fib.lean build/generated/local.irpkg
```

Both commands write an `.irpkg` with an embedded interface manifest and a report
next to the package, for example `build/generated/local.report.md`. The report
lists roots, packaged declarations, native externs, initializer globals,
interface exports, JavaScript host imports, and any loud diagnostics.

On success, the command prints a package summary: package format, Lean
toolchain, generation time, total declarations, interface exports, JavaScript
host imports, source targets, and resolved roots. The same data is embedded in
`manifest.metadata`.

Local package generation also builds `build/lean-lib`, which provides the
project-owned `Vir.*` modules for host import declarations.

If a requested export cannot be packaged or mapped to the supported JavaScript
interface surface, generation exits nonzero and points at the report.

## Inspect A Package

Inspect a generated package without starting the browser:

```bash
npm run inspect:irpkg -- build/generated/local.irpkg
```

The inspector reads the embedded manifest from the `.irpkg` itself and prints
the package format, declaration count, section directory, metadata, source
targets, exports, host imports, argument/result types, and diagnostics. Use
`--json` for bug reports or tooling:

```bash
npm run inspect:irpkg -- --json build/generated/local.irpkg
```

For the binary envelope fields and current section IDs, see
`docs/IRPKG_FORMAT.md`.

## Load The Package

Start the local server:

```bash
npm run dev
```

Open `/dev.html`. The page creates a fresh WASM instance, loads the selected
`.irpkg`, reads the embedded interface manifest, and generates entry controls
from that manifest. The header also shows the package metadata, including
source targets, toolchain, generation time, declaration count, and export count.

There are three package loading paths:

- Choose a package preset, which covers the generated focused browser packages
  and the prepared local quickstart/fib/mergesort packages.
- Upload a package file, which is the simplest way to test packages under
  `build/generated/`.
- Load a package URL, which is relative to Vite's served assets. For example,
  `fixtures-basic.irpkg` resolves to `web/public/fixtures-basic.irpkg`.

The package runner accepts URL parameters:

```text
dev.html?package=local-quickstart.irpkg&entry=Quickstart.total
```

`entry` may be a manifest `id`, `jsName`, or Lean declaration name.

## Runtime Interface

The manifest includes package metadata plus one entry per export with its Lean
declaration name, JavaScript name, argument types, result type, and recursive
type tree. It also includes `hostImports` for Lean declarations marked with
`@[vir_js "..."]`, including their `hostResource`, `explicitConversion`, or `objectHandle`
host boundary.
JavaScript validates inputs against that manifest, lowers values to owned Lean
objects with `vir_obj_*` helpers, and calls
`vir_call_resolved_objects`. When interpreted Lean code reaches a host import,
the shim calls the runtime's `env.vir_js_call_objects` import with borrowed Lean
object arguments, and JavaScript returns an owned Lean object result. Package
format 10 keeps package-owned direct summaries for object-call validation and
package-owned arity/effect metadata for host-import dispatch and callback
rooting in named package sections.

Supported interface types:

- `Unit`;
- `Nat`, `Int`, `Bool`, `String`;
- `Float`, `Float32`;
- `UInt8`, `UInt16`, `UInt32`, `UInt64`, `USize`;
- `ByteArray`;
- recursive `Array α`, `List α`, `Option α`, `α × β`, `Sum α β`, and
  `Except ε α` shapes over supported types;
- non-indexed user-defined structures over manifest-supported fields, including
  parameterized instances, direct scalar fields, direct scalar wrappers, and
  inherited parent fields, represented as JavaScript objects with parent fields
  flattened into ordinary keys;
- nullary inductive enums;
- non-indexed custom inductives with nullary or runtime-payload constructors,
  including direct recursive references through supported container shapes;
- opaque host resources;
- `Lean.Vir.Js α`, an opaque `Js` resource for JavaScript-owned objects whose
  `α` parameter is a Lean-side phantom shape;
- `Lean.Vir.LeanRef.toJSL` / `fromJSL`, which move Lean-owned objects through an
  opaque `Lean.Vir.JSL α` handle without decoding the Lean value in
  JavaScript;
- Lean function values used as host callbacks;
- `Lean.Expr`;
- `Lean.Vir.React.Node` as an opaque JavaScript-owned resource under
  `Lean.Vir.Js`.

Large exact integer results are returned as decimal strings.
Top-level `Float`, `Float32`, `UInt64`, and trivial wrappers over them use the
generated Lean `_boxed` declarations automatically. If a requested export needs
one and the compiler did not produce it, package generation fails with an
explicit wasm32 boundary diagnostic.

Pure functions and recognized synchronous effects are supported on both
exported entrypoints and host imports. JavaScript resource/runtime APIs use
`Lean.Vir.RuntimeM α`; browser APIs use `Lean.Vir.Browser.DomM α`; React
render-construction APIs use `Lean.Vir.React.ReactM α`. Exported entrypoints
use descriptor-guided object lowering; host imports are narrower than exports:
low-level JavaScript imports should expose
`Unit`, `Lean.Vir.Js α` resources, `Lean.Vir.Js.Nullable α` resources,
callback arguments whose own arguments/results are `Unit` or resources, or
built-in named conversion targets. Nested callback arguments are rejected. Raw
Lean scalar, structure, array, list, option, and product host imports are
rejected.
Host imports are currently synchronous, with at most 128 imported declarations
and IR arity at most 6. Leading erased type parameters on host imports are
recorded in package format 6 and newer and skipped before JavaScript-visible
arguments.
The embedded JSON manifest preserves the effect labels as `pure`, `runtime`,
`io`, `dom`, or `react`; the binary call path currently consumes only pure
versus effectful.

`/dev.html` generates enum select controls and JSON textareas for structural
`Lean.Expr`, user-defined structures, and manifest-supported compound values
from the embedded manifest after the package is loaded.

One-field wrappers whose only runtime field is a direct scalar, such as
`Box UInt32`, are exported with the same JavaScript object shape as other
single-field structures.

## Current Scope

This is still the single-file declaration package path. It does not load
`.olean`, `.ir`, or full Lean module data. The package generator elaborates the
source with Lean 4.32.0-rc1, extracts typed `Lean.IR.Decl` values, and writes the
current package format. The WASM side decodes that package into real Lean IR
objects and serves them through `lean_ir_find_env_decl`.

Replacing a package through `VirRuntime.loadIrPackageBytes` creates a fresh
Wasm interpreter instance and loads and validates the candidate there first.
On success, the existing public `VirRuntime` object adopts the candidate and
then exposes its manifest and call slots. The old instance's callbacks,
resources, and per-instance host state are released during handover. Object
pointers, callback roots, resource roots, and cached package slots from the old
instance are invalid after that handover.

Replacement is atomic at the public runtime boundary: if candidate loading or
manifest validation fails, the candidate is discarded and the previous
package remains callable. The fresh-instance rule is required because the
upstream interpreter keeps native-symbol and initializer-global caches for the
lifetime of an interpreter instance.
