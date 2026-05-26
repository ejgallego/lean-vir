# Lean VIR

Lean VIR runs selected Lean 4 declarations in the browser through Lean's real
IR interpreter compiled to `wasm32-wasip1`.

The main workflow is:

1. write a Lean file;
2. choose one or more declarations to export;
3. generate a `.irpkg` package;
4. load it in the browser package runner.

The browser runner reads the embedded interface manifest and builds runnable
controls automatically. For supported argument and result types, adding another
browser entry point is just adding another Lean root name to the package command.

## Lean File To Browser

Set up the toolchain once:

```bash
npm install
npm run fetch:lean
npm run install:wasi
npm run build:demo
```

Generate the bundled quickstart package:

```bash
npm run quickstart
```

Generate a browser-loadable package from one Lean file. List as many exports as
you want after the output package path:

```bash
npm run generate:irpkg -- examples/Quickstart.lean web/public/local-quickstart.irpkg Quickstart.double Quickstart.greet Quickstart.total Quickstart.choose
```

Run the local server:

```bash
npm run dev -- --port 5173
```

Open:

```text
http://127.0.0.1:5173/dev.html?package=local-quickstart.irpkg
```

`/dev.html` loads `web/public/local-quickstart.irpkg`, starts a fresh WASM
interpreter, shows package metadata, lists the exported declarations, renders
inputs from the manifest, and calls the selected Lean declaration in the browser.

The positional export names are Lean declaration names. Use fully qualified
names for declarations inside namespaces, such as `Quickstart.total`.

If you omit export names, the generator packages public definitions from the
source file:

```bash
npm run generate:irpkg -- examples/Fib.lean web/public/local-fib.irpkg
```

For packages written outside `web/public/`, open `/dev.html` and use the package
file picker:

```bash
npm run generate:irpkg -- examples/MergeSort.lean build/generated/local.irpkg SortDemo.demo
```

Inspect a package without starting the browser:

```bash
npm run inspect:irpkg -- web/public/local-quickstart.irpkg
npm run inspect:irpkg -- --json web/public/local-quickstart.irpkg
```

## What Gets Generated

An `.irpkg` contains:

- the transitive `Lean.IR.Decl` closure needed by the exported roots;
- an embedded manifest describing exports, argument types, result types, and
  JavaScript host imports;
- package metadata, including Lean toolchain, source target, resolved roots,
  declaration count, and generation time.

Package generation also writes a report next to the package. If an export cannot
be packaged or cannot be mapped to the current browser interface, the command
fails and points at that report.

## Supported Browser Interface

The manifest-driven browser call path currently supports pure declarations and
`IO` actions over these shapes:

- `Unit`, `Nat`, `Int`, `Bool`, `String`;
- `Float`, `Float32`, `UInt8`, `UInt16`, `UInt32`, `UInt64`, `USize`;
- `ByteArray`;
- recursive `Array`, `List`, `Option`, product, `Sum`, and `Except` shapes over
  supported element types;
- non-indexed structures with supported fields, including parameterized
  instances, scalar wrappers, and inherited fields flattened as JavaScript
  object keys;
- nullary inductive enums;
- structural `Lean.Expr` values.

Large exact integer results are returned as decimal strings so JavaScript does
not truncate them. Top-level `Float`, `Float32`, `UInt64`, and trivial wrappers
over them use generated Lean `_boxed` declarations automatically; generation
fails loudly if a requested export needs one and it is missing.

Lean code can call synchronous JavaScript host functions by importing
`Lean.Vir.Host`, `Lean.Vir.Common`, or `Lean.Vir.Browser` and marking opaque
declarations with `@[vir_js "target.name"]`. Host imports are recorded in the
same package manifest and routed through the browser runtime.

## Reproducible Package Configs

For repeatable packages, put the source, output, report, and roots in a config:

```json
{
  "version": 1,
  "source": "examples/Quickstart.lean",
  "package": "web/public/local-quickstart.irpkg",
  "report": "build/generated/local-quickstart.report.md",
  "roots": [
    "Quickstart.double",
    "Quickstart.greet",
    "Quickstart.total",
    "Quickstart.choose"
  ]
}
```

Then run:

```bash
npm run prepare:irpkg -- examples/quickstart.virpkg.json
```

The hosted Pages build uses this path for its sample package links.

## Built-In Demos

Run the complete local demo:

```bash
npm test
npm run dev -- --port 5173
```

Open the Vite URL to see the Tamagotchi demo, fixture browser, and links into
the package runner. The Lean sources are in `examples/`, with broader fixture
coverage under `fixtures/`.

The hosted demo is deployed from `main`:

https://ejgallego.github.io/lean-vir/

## Repository Map

- `examples/` contains small Lean browser examples.
- `fixtures/` contains conformance fixtures used by the test suite.
- `Lean/Vir/` provides Lean-side helper modules for browser and host imports.
- `tools/GeneratePackage.lean` elaborates Lean sources and emits `.irpkg`
  packages.
- `scripts/lean-to-irpkg.sh` is the direct Lean-file-to-package command used by
  `npm run generate:irpkg`.
- `scripts/prepare-irpkg.mjs` generates packages from JSON configs.
- `wasm/upstream_shim/` contains the WASI boundary around Lean's upstream
  `src/library/ir_interpreter.cpp`.
- `web/` contains the browser harness. `/dev.html` is the manifest-driven
  package runner.

Useful docs:

- `docs/LOCAL_IRPKG.md` for the full local package workflow.
- `docs/CALL_LEAN_FROM_JS.md` for calling exported Lean declarations from app
  JavaScript.
- `docs/INTERFACE_PIPELINE.md` for package configs, manifests, and interface
  details.
- `docs/JS_API.md` for using the runtime wrapper from JavaScript.
- `docs/LEAN_VIR_LIBRARY.md` for Lean-side host import helpers.
- `docs/ADDING_DEMOS.md` for adding examples to the built-in demo packages.
- `docs/FIXTURE_COVERAGE.md` for the current fixture and boundary surface.

## Development Commands

```bash
npm run build:demo        # build the WASM interpreter and demo packages
npm run generate:irpkg -- <source.lean> <package.irpkg> [root ...]
npm run prepare:irpkg -- <config.json>
npm run inspect:irpkg -- <package.irpkg>
npm run dev -- --port 5173
npm test
```

`npm test` checks the native boundary registry, rebuilds the upstream WASM smoke
artifact, runs runtime tests, and runs the fixture suite.

For a local browser sanity check of the built Pages artifact:

```bash
npm run build:site
npm run test:pages:browser
```

## Current Scope

This is a focused browser harness, not a full Lean-in-the-browser distribution.
It packages declarations from Lean source files; it does not load `.olean`,
`.ir`, or full Lean module data in the browser.

The upstream interpreter file
`third_party/lean4-src/src/library/ir_interpreter.cpp` stays unmodified. The
current package-backed declaration provider is isolated behind
`wasm/upstream_shim/decl_provider.h` so future module-backed loading can replace
that provider without changing the upstream interpreter or platform shim.

The `.irpkg` format is a trusted local artifact boundary. Generated demo
packages and local developer packages are validated before use, but arbitrary
hostile package contents are not treated as hardened public input. A bad package
can still trap the interpreter, consume the small WASM memory budget, hang the
tab, or confuse ABI decoding if its manifest lies about declaration types or
runtime layouts.

## Generated Artifacts

Generated files should not be committed. They include:

- `build/`
- `web/dist/`
- `web/public/*.wasm`
- `web/public/*.irpkg`
- `web/public/*.input.json`
- `web/public/*.report.md`

These paths are ignored by git.

## License

This repository is licensed under Apache-2.0. See `LICENSE` and `NOTICE`.
Generated WASM artifacts can include object code compiled from Lean 4 source,
which is also Apache-2.0 and keeps its upstream notices.
