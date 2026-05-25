# Lean VIR

Lean VIR is a proof of concept for running Lean 4's real IR interpreter from
WebAssembly in the browser.

It is a focused browser harness, not a full Lean-in-the-browser distribution:
the browser loads a generated IR package, then calls selected Lean declarations
through the upstream interpreter and a small JavaScript runtime wrapper.

The demo builds Lean `v4.30.0-rc2`'s upstream
`src/library/ir_interpreter.cpp` to `wasm32-wasip1`, links the required Lean
runtime subset, and serves generated artifacts:
`web/public/vir-upstream.wasm` plus the demo IR package
`web/public/vir-demo.irpkg`.

## Browser Demo

The browser page keeps `Tamagotchi.step` as the main interactive demo, driven
one action at a time through the upstream interpreter.

The Lean sources are in `examples/Fib.lean`, `examples/Tamagotchi.lean`, and
`examples/MergeSort.lean`.

The page also includes a fixture browser for the demo entries plus
`fixtures/manifest.json`. Each entry can show its Lean source file and run
through a fresh WASM interpreter instance backed by the same generated IR
package. Input-capable entries, currently `fib` and `SortDemo.demoFromArray`,
render an input control in the fixture source panel.

The package manifest also drives the local `/dev.html` runner. Supported
browser-call types include primitive scalars, recursive list/array/option/product
shapes over supported element types, nullary inductive enums such as the
Tamagotchi state/action types, and structural `Lean.Expr` values.

## Quick Start

```bash
npm install
npm run fetch:lean
npm run install:wasi
npm test
npm run dev
```

Open the Vite URL and the page should show the Tamagotchi demo plus fixture
source and run controls. `npm test` rebuilds the WASM artifact, runs the Node
smoke tests, and checks the fixture suite.

For focused local package experiments, generate an IR package from one Lean file:

```bash
npm run generate:irpkg -- examples/MergeSort.lean build/generated/local.irpkg SortDemo.demo
```

Omit the root names to package public source definitions from the file:

```bash
npm run generate:irpkg -- examples/MergeSort.lean build/generated/local.irpkg
```

The command prints the package path, report path, package format, Lean
toolchain, declaration count, interface exports, source targets, and resolved
roots. The same metadata is embedded in the package manifest.

Then run `npm run dev` and open `/dev.html`. The developer entry point can load
a served package URL such as `vir-demo.irpkg` or an uploaded `.irpkg` file, read
the embedded interface manifest, show the loaded package metadata, and generate
runnable controls automatically.

The browser-facing runtime wrapper is exported from `web/src/vir-runtime.js` and
documented in `docs/JS_API.md`. A minimal page that imports the wrapper directly
is available at `/runtime-example.html` when running `npm run dev`.

For the config-driven path that writes a manifest-bearing package:

```bash
npm run prepare:irpkg -- examples/fib.virpkg.json
npm run dev
```

## Hosted Demo

Pushes to `main` deploy the browser demo to GitHub Pages:

https://ejgallego.github.io/lean-vir/

The hosted page includes the main Tamagotchi and fixture demos, plus links to
the package runner for generated local sample packages. The Pages build prepares
the `fib` and `mergesort` packages before copying static assets into
the site artifact, then runs `npm run test:pages` to check the generated landing
page, package runner, WASM, and packages.

For a local browser sanity check of the built Pages artifact, run:

```bash
npm run test:pages:browser
```

That command serves `web/dist/` under `/lean-vir/`, launches local Chromium, and
checks the landing page plus the generated `fib` and `mergesort` package runner
links.

For local development, keep using `npm run dev`. The Pages workflow only builds
and deploys the static site artifact.

## Repository Shape

- `wasm/upstream_shim/` supplies the current WASI boundary for Lean's real
  upstream interpreter.
- `tools/GeneratePackage.lean` elaborates the demo and fixture Lean sources,
  walks the typed `Lean.IR.Decl` closure, and emits
  `build/generated/vir-demo.irpkg`.
- `docs/ADDING_DEMOS.md` describes the path for adding a Lean example and
  checking its package diagnostics.
- `docs/LOCAL_IRPKG.md` documents the focused `.lean` to `.irpkg` workflow and
  `/dev.html` package runner.
- `docs/JS_API.md` documents the browser-facing JavaScript runtime wrapper.
- `docs/INTERFACE_PIPELINE.md` documents the config-driven package plus
  embedded interface pipeline and the current WIT direction.
- `docs/FIXTURE_COVERAGE.md` records the current fixture and boundary coverage
  in detail.
- `scripts/build-upstream-probe.sh` compiles and links the upstream
  interpreter, writes `build/upstream-probe/boundary.md`, and copies the strict
  artifact to `web/public/vir-upstream.wasm`.
- `scripts/lean-to-irpkg.sh` generates a local `.irpkg` from a `.lean` file,
  either for explicit roots or public source definitions.
- `scripts/prepare-irpkg.mjs` generates a configured package for `/dev.html`
  and the hosted Pages package links.
- `scripts/smoke_upstream.mjs` executes the generated browser artifact in Node.
- `web/` is the browser harness. `/dev.html` is the local package runner.

## Status

The strict WASI link closes with zero unresolved symbols. The current demo is
not a full Lean module/environment port: it uses a demo IR package instead of
loading `Init.ir` or `.olean` module data.

The package-backed provider is isolated behind `decl_provider.h` so a future
provider can become more faithful without changing the upstream interpreter or
platform shim.

`npm run test:fixtures` runs the upstream-backed conformance fixture surface.
Each fixture is Lean source under `fixtures/`, elaborated by Lean 4.30-rc2 into
real `Lean.IR.Decl` values, packaged with `tools/GeneratePackage.lean`, and
then compared against Lean's host IR interpreter with
`interpreter.prefer_native=false`. The current passing surface covers recursive
functions, inductive pattern matching, common `List`/`Array`/`String`/
`ByteArray` operations, numeric primitive boundaries, nested manifest-backed
collection/option/product calls, structural `Lean.Expr` values, parser setup
paths, and selected task/ref initialization paths. See
`docs/FIXTURE_COVERAGE.md` for the detailed boundary list.

The fixture runner writes `build/fixtures/summary.json` with per-fixture status,
imported IR declarations, native externs, and missing-boundary diagnostics for
CI and boundary debugging. Known unsupported fixtures can be tracked in
`fixtures/manifest.json` so boundary gaps remain explicit.

`npm run check:boundary-registry` verifies that `tools/GeneratePackage.lean`
and the table-driven native shim registry in `wasm/upstream_shim/shim.cpp`
agree on the explicit native extern surface.
`npm test` runs this check before rebuilding the upstream smoke artifact and
running the fixture suite.

The build caches the upstream interpreter, Lean runtime, support, and shim
objects under `build/upstream-probe/obj`. Updating the Lean examples regenerates
the IR package asset, but does not recompile or relink `ir_interpreter.cpp`
unless the upstream source, compiler flags, runtime overlay, or shim changes.

## Generated Artifacts

`npm run build:demo` writes:

- `build/upstream-probe/ir_interpreter.strict.wasm`
- `build/upstream-probe/boundary.md`
- `build/generated/vir-demo.irpkg`
- `web/public/vir-upstream.wasm`
- `web/public/vir-demo.irpkg`

These generated files should not be committed.

`npm run build:site` also runs `npm run prepare:pages` and writes:

- `web/public/local-fib.irpkg`
- `web/public/local-mergesort.irpkg`
- `web/dist/`

These files are generated and should not be committed.

For fast example iteration, run `npm run check:package`. It regenerates the IR
package and points at `build/generated/ir-provider-report.md`, including
separate sections for missing IR declarations and missing native extern
registrations.

## Benchmarks

`npm run bench` compares the browser-style Node/V8 WASM path against Lean's
host IR interpreter with `interpreter.prefer_native=false`.

`npm run bench:engines` builds `build/upstream-probe/vir-engine-bench.wasm`, a
small WASI command module that embeds the generated demo IR package and measures
inside WASM. It runs under Node/V8 by default and also uses local CLI engines
when present. Install the optional local engines with:

```bash
npm run install:engines
npm run bench:engines
```

The engine installer writes Wasmtime, Wasmer, and WasmEdge under `.tools/`.
Slow or incompatible engines are reported instead of blocking the run. Override
the per-engine timeout with `VIR_ENGINE_TIMEOUT_MS`; WasmEdge has a shorter
default guard that can be overridden with `VIR_WASMEDGE_TIMEOUT_MS`.

The demo link uses 4 MiB of initial memory and a 1 MiB stack by default.
Override those with `VIR_WASM_INITIAL_MEMORY` and `VIR_WASM_STACK_SIZE`.

## License

This repository is licensed under the Apache License, Version 2.0. See
`LICENSE` and `NOTICE`.
Project-owned source files are copyright Lean FRO LLC, with Emilio J. Gallego
Arias listed as author.

The generated WASM demo can include object code compiled from Lean 4 source.
Lean 4 is also Apache-2.0 and retains its upstream copyright notices.

The default WASI installer pins `wasi-sdk-33.0-x86_64-linux.tar.gz` from
`WebAssembly/wasi-sdk` and verifies its SHA-256 digest. Override with
`WASI_SDK_VERSION`, `WASI_SDK_VERSION_FULL`, `WASI_SDK_ARCH`, `WASI_SDK_OS`, or
`WASI_SDK_SHA256` if needed.
