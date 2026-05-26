# Local IR Packages

The browser demo normally loads focused packages from `web/public/`, including
`fixtures-basic.irpkg`, `demo-host.irpkg`, `fixtures-lean.irpkg`, and
`fixtures-boundary.irpkg`. They are generated from the demo examples plus the
fixture manifest. For focused development, use the local package utility to
generate a smaller package from one Lean file and load it in `/dev.html`.

For the config-driven path, see `docs/INTERFACE_PIPELINE.md`.

## Generate A Package

This is the golden local path from one Lean source file to one browser-loadable
package:

```bash
npm run generate:irpkg -- <source.lean> [package.irpkg] [root ...]
```

Package the transitive closure for one or more explicit exports:

```bash
npm run generate:irpkg -- examples/MergeSort.lean build/generated/local.irpkg SortDemo.demo
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
project-owned `Lean.Vir.*` modules for host import declarations.

If a requested export cannot be packaged or mapped to the supported JavaScript
interface surface, generation exits nonzero and points at the report.

## Inspect A Package

Inspect a generated package without starting the browser:

```bash
npm run inspect:irpkg -- build/generated/local.irpkg
```

The inspector reads the embedded manifest from the `.irpkg` itself and prints
the package format, declaration count, metadata, source targets, exports,
host imports, argument/result types, and diagnostics. Use `--json` for bug
reports or tooling:

```bash
npm run inspect:irpkg -- --json build/generated/local.irpkg
```

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
  and the prepared local fib/mergesort packages.
- Upload a package file, which is the simplest way to test packages under
  `build/generated/`.
- Load a package URL, which is relative to Vite's served assets. For example,
  `fixtures-basic.irpkg` resolves to `web/public/fixtures-basic.irpkg`.

The package runner accepts URL parameters:

```text
dev.html?package=local-fib.irpkg&entry=fib
```

`entry` may be a manifest `id`, `jsName`, or Lean declaration name.

## Runtime Interface

The manifest includes package metadata plus one entry per export with its Lean
declaration name, JavaScript name, argument types, result type, and recursive
type tree. It also includes `hostImports` for Lean declarations marked with
`@[vir_js "..."]`. JavaScript validates inputs against that manifest and sends a
compact byte payload through the generic `vir_call` WASM export. WASM
constructs Lean runtime objects, calls the upstream IR interpreter, and encodes
the result bytes for JavaScript. When interpreted Lean code reaches a host
import, the shim calls the runtime's `env.vir_js_call` import and decodes the
synchronous result back into Lean.

Supported v1 types:

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
- `Lean.Expr`.

Large exact integer results are returned as decimal strings.
Top-level `Float`, `Float32`, `UInt64`, and trivial wrappers over them use the
generated Lean `_boxed` declarations automatically. If a requested export needs
one and the compiler did not produce it, package generation fails with an
explicit wasm32 boundary diagnostic.

Pure functions and `IO α` actions are supported on both exported entrypoints and
host imports. Host imports are currently synchronous, with at most 16 imported
declarations and IR arity at most 6.

`/dev.html` generates enum select controls and JSON textareas for structural
`Lean.Expr`, user-defined structures, and manifest-supported compound values
from the embedded manifest after the package is loaded.

One-field wrappers whose only runtime field is a direct scalar, such as
`Box UInt32`, are exported with the same JavaScript object shape as other
single-field structures.

## Current Scope

This is still the single-file declaration package path. It does not load
`.olean`, `.ir`, or full Lean module data. The package generator elaborates the
source with Lean 4.30-rc2, extracts typed `Lean.IR.Decl` values, and writes the
current package format. The WASM side decodes that package into real Lean IR
objects and serves them through `lean_ir_find_env_decl`. Loading a new package
replaces the previous provider state; a failed load clears it so stale
declarations cannot be called accidentally.
