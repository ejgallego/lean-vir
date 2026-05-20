# Lean VIR

Lean VIR is a proof of concept for running Lean 4's real IR interpreter from
WebAssembly in the browser.

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

## Quick Start

```bash
npm install
npm run fetch:lean
npm run install:wasi
npm test
npm run dev
```

Open the Vite URL and the page should show the Tamagotchi demo plus fixture
source and run controls. `npm test` rebuilds the WASM artifact and runs the
Node smoke test.

For focused local package experiments, generate an IR package from one Lean file:

```bash
npm run generate:irpkg -- examples/MergeSort.lean build/generated/local.irpkg SortDemo.demo
```

Omit the root names to package every IR declaration produced by the file:

```bash
npm run generate:irpkg -- examples/MergeSort.lean build/generated/local.irpkg
```

Then run `npm run dev` and open `/dev.html`. The developer entry point can load a
served package URL such as `vir-demo.irpkg` or an uploaded `.irpkg` file, then
evaluate `() -> Nat`, `Nat -> Nat`, or `Array Nat -> Nat` entries through an
editable input spec.

For the config-driven path that also writes URL-loadable UI input specs:

```bash
npm run prepare:irpkg -- examples/fib.virpkg.json
npm run dev
```

## Hosted Demo

Pushes to `main` deploy the browser demo to GitHub Pages:

https://ejgallego.github.io/lean-vir/

The hosted page includes the main Tamagotchi and fixture demos, plus links to
the package runner for generated local sample packages. The Pages build prepares
the `fib` and `mergesort` package/spec pairs before copying static assets into
the site artifact, then runs `npm run test:pages` to check the generated landing
page, package runner, WASM, packages, and input specs.

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
- `docs/INTERFACE_PIPELINE.md` documents the config-driven package plus input
  spec pipeline and the current WIT direction.
- `scripts/build-upstream-probe.sh` compiles and links the upstream
  interpreter, writes `build/upstream-probe/boundary.md`, and copies the strict
  artifact to `web/public/vir-upstream.wasm`.
- `scripts/lean-to-irpkg.sh` generates a local `.irpkg` from a `.lean` file,
  either for explicit roots or all declarations in that source.
- `scripts/prepare-irpkg.mjs` generates a configured package plus optional
  browser input spec for `/dev.html` and the hosted Pages package links.
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
`interpreter.prefer_native=false`. Known unsupported fixtures can be tracked in
`fixtures/manifest.json` so boundary gaps remain explicit. The current passing
surface includes recursion, inductive pattern matching, local list processing,
standard `List.map`/`List.filter`/`List.foldl`/`List.any`/`List.all`/
`List.find?`/`List.zip`, partial application, array push/toList, branches over
comparisons, `Bool`, `Option`, `Prod`, `Sum`, `Except`, standard `Array.map`/
`Array.foldl`/`Array.any`/`Array.filter`/`Array.find?`, array construction and
mutation through `Array.emptyWithCapacity`/`Array.getInternal`/`Array.replicate`/
`Array.set`/`Array.set!`/`Array.swap`/`Array.swapIfInBounds`/`Array.pop`, plus basic
`String.append`/`String.length`/`String.utf8ByteSize`/`String.getUTF8Byte`/
`String.push`/`String.Internal.next`/`String.Internal.extract`/
`String.Pos.Raw.get`/`String.Pos.Raw.prev`/`String.Internal.atEnd`/
`String.decEq`/string ordering/`String.toUTF8`/`String.ofByteArray`/
`String.toUpper`/`String.toLower`/`String.capitalize`/
`String.decapitalize`/`String.hash`/`String.Internal.contains`/
`String.Pos.Raw.isValid` plus public `String.fromUTF8?`/`String.contains`/
`startsWith`/`drop`/`dropEnd`/`trimAscii`/`splitOn`/`intercalate`/`any`/
`front`/`pushn`/`isEmpty`/`String.Pos.Raw.nextWhile`/`String.find`/
`String.Pos.Raw.offsetOfPos`, `Char.toUpper`/`Char.toLower`/
`Char.utf8Size`, `UInt8`/`UInt16` `toNat` plus
arithmetic/bitwise/shift/comparison operations, `UInt32` literals,
`UInt32.ofNat`/`toNat`/`toUInt8`,
`UInt32` arithmetic/bitwise/shift/comparison operations, `UInt64.ofNat`/
`ofNatLT`/`toNat`/`toUSize`/`toFloat` plus arithmetic/bitwise/shift/comparison
operations, large `UInt64.toNat` results returned through the decimal-string
Nat API, package-backed `Nat` literals wider than 32 bits, `USize`
`sub`/`mul`/`land`/`shiftLeft`/`shiftRight`/`toNat`/`decLe`,
small `Int` arithmetic, `Nat.div`/`pow`/`log2`/`shiftLeft`/`shiftRight`,
`Float.scaleB`/`toUInt32`, and
`ByteArray.mk`/`ByteArray.empty`/`ByteArray.push`/`ByteArray.get`/
`ByteArray.get!`/`ByteArray.set!`/
`ByteArray.extract`/`ByteArray.size`/`ByteArray.validateUTF8`. It also covers the
hash/name/substring/pointer-address primitives reached by parser data paths,
namely `mixHash`, `Lean.Name.beq`, `Substring.Raw.Internal.beq`, and
`ptrAddrUnsafe`. The Lean parser input layer runs through `Lean.Parser.mkInputContext`,
`Lean.FileMap.toPosition`, and `Lean.Parser.mkParserState`.
The demo also has narrow synchronous coverage for already-resolved
`Task.pure`/`Task.get`/`Task.map`, because real `Environment` values store a
checked kernel environment behind `Task`.
It models normal execution as post-initialization (`IO.initializing = false`),
switches to initialization mode while running packaged `builtin_initialize`
globals through upstream `lean_run_init`, and has single-threaded
`ST.Prim.mkRef`/`ST.Prim.Ref.get`/`ST.Prim.Ref.set`/`ST.Prim.Ref.take` support
for ref access reached by fixtures and parser setup.
`Lean.Parser.parseHeader` is now a passing vertical parser fixture backed by
packaged initialized parser/environment extension globals.
The runner also writes `build/fixtures/summary.json` with per-fixture status,
imported IR declarations, native externs, and missing-boundary diagnostics for
CI and boundary debugging.

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
- `web/public/local-fib.input.json`
- `web/public/local-mergesort.irpkg`
- `web/public/local-mergesort.input.json`
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
