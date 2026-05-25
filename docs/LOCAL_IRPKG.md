# Local IR Packages

The browser demo normally loads `web/public/vir-demo.irpkg`, which is generated
from the demo examples plus the fixture manifest. For focused development, use
the local package utility to generate a smaller package from one Lean file and
load it in `/dev.html`.

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
interface exports, and any loud diagnostics.

On success, the command prints a package summary: package format, Lean
toolchain, generation time, total declarations, interface exports, source
targets, and resolved roots. The same data is embedded in
`manifest.metadata`.

If a requested export cannot be packaged or mapped to the supported JavaScript
interface surface, generation exits nonzero and points at the report.

## Inspect A Package

Inspect a generated package without starting the browser:

```bash
npm run inspect:irpkg -- build/generated/local.irpkg
```

The inspector reads the embedded manifest from the `.irpkg` itself and prints
the package format, declaration count, metadata, source targets, exports,
argument/result types, and diagnostics. Use `--json` for bug reports or tooling:

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

There are two package loading paths:

- Upload a package file, which is the simplest way to test packages under
  `build/generated/`.
- Load a package URL, which is relative to Vite's served assets. For example,
  `vir-demo.irpkg` resolves to `web/public/vir-demo.irpkg`.

The package runner accepts URL parameters:

```text
dev.html?package=local-fib.irpkg&entry=fib
```

`entry` may be a manifest `id`, `jsName`, or Lean declaration name.

## Runtime Interface

The manifest includes package metadata plus one entry per export with its Lean
declaration name, JavaScript name, argument types, result type, and recursive
type tree. JavaScript validates inputs against that manifest and sends a
compact byte payload through the generic `vir_call` WASM export. WASM
constructs Lean runtime objects, calls the upstream IR interpreter, and encodes
the result bytes for JavaScript.

Supported v1 types:

- `Nat`, `Int`, `Bool`, `String`;
- `UInt8`, `UInt16`, `UInt32`, `UInt64`, `USize`;
- `ByteArray`;
- recursive `Array α`, `List α`, `Option α`, and `α × β` shapes over
  supported types;
- plain non-parameterized structures over manifest-supported object-backed
  fields, represented as JavaScript objects keyed by Lean field name;
- nullary inductive enums;
- `Lean.Expr`.

Large exact integer results are returned as decimal strings.

`/dev.html` generates enum select controls and JSON textareas for structural
`Lean.Expr`, user-defined structures, and manifest-supported compound values
from the embedded manifest after the package is loaded.

## Current Scope

This is still the single-file declaration package path. It does not load
`.olean`, `.ir`, or full Lean module data. The package generator elaborates the
source with Lean 4.30-rc2, extracts typed `Lean.IR.Decl` values, and writes the
current package format. The WASM side decodes that package into real Lean IR
objects and serves them through `lean_ir_find_env_decl`. Loading a new package
replaces the previous provider state; a failed load clears it so stale
declarations cannot be called accidentally.
