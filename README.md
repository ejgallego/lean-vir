# Lean VIR

Lean VIR is a proof of concept for running Lean 4's real IR interpreter from
WebAssembly in the browser.

The demo builds Lean `v4.30.0-rc2`'s upstream
`src/library/ir_interpreter.cpp` to `wasm32-wasip1`, links the required Lean
runtime subset, and serves generated artifacts:
`web/public/vir-upstream.wasm` plus the demo IR package
`web/public/vir-demo.irpkg`.

## Demos

The browser page currently runs three examples through that upstream interpreter:

- `fib`, with the current input range capped at `0..17`.
- `Tamagotchi.step`, a tiny automaton driven one action at a time.
- `SortDemo.demoFromArray`, a small merge-sort style demo over editable
  browser input passed to Lean as an `Array Nat`.

The Lean sources are in `examples/Fib.lean`, `examples/Tamagotchi.lean`, and
`examples/MergeSort.lean`.

## Quick Start

```bash
npm install
npm run fetch:lean
npm run install:wasi
npm test
npm run dev
```

Open the Vite URL and the page should show all three demos. `npm test` rebuilds the
WASM artifact and runs the Node smoke test.

## Hosted Demo

Pushes to `main` deploy the browser demo to GitHub Pages:

https://ejgallego.github.io/lean-vir/

For local development, keep using `npm run dev`. The Pages workflow only builds
and deploys the static site artifact.

## Repository Shape

- `wasm/upstream_shim/` supplies the current WASI boundary for Lean's real
  upstream interpreter.
- `tools/GeneratePackage.lean` elaborates the demo Lean sources, walks the
  typed `Lean.IR.Decl` closure, and emits `build/generated/vir-demo.irpkg`.
- `docs/ADDING_DEMOS.md` describes the path for adding a Lean example and
  checking its package diagnostics.
- `scripts/build-upstream-probe.sh` compiles and links the upstream
  interpreter, writes `build/upstream-probe/boundary.md`, and copies the strict
  artifact to `web/public/vir-upstream.wasm`.
- `scripts/smoke_upstream.mjs` executes the generated browser artifact in Node.
- `web/` is the browser harness.

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
Nat API, `USize` `sub`/`mul`/`land`/`shiftLeft`/`shiftRight`/`toNat`/`decLe`,
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
`Lean.Parser.parseHeader` is tracked as an expected-unsupported vertical target
while the demo still lacks more of the real environment/IO boundary it needs.
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

`npm run build:site` additionally writes `web/dist/`, which is also generated
and should not be committed.

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
