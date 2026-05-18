# Lean VIR

Lean VIR is a proof of concept for running Lean 4's real IR interpreter from
WebAssembly in the browser.

The demo builds Lean `v4.30.0-rc2`'s upstream
`src/library/ir_interpreter.cpp` to `wasm32-wasip1`, links the required Lean
runtime subset, and serves one generated artifact:
`web/public/vir-upstream.wasm`.

## Demos

The browser page currently runs two examples through that upstream interpreter:

- `fib`, with the current input range capped at `0..17`.
- `Tamagotchi.step`, a tiny automaton driven one action at a time.

The Lean sources are in `examples/Fib.lean` and
`examples/Tamagotchi.lean`.

## Quick Start

```bash
npm install
npm run fetch:lean
npm run install:wasi
npm test
npm run dev
```

Open the Vite URL and the page should show both demos. `npm test` rebuilds the
WASM artifact and runs the Node smoke test.

## Hosted Demo

Pushes to `main` deploy the browser demo to GitHub Pages:

https://ejgallego.github.io/lean-vir/

For local development, keep using `npm run dev`. The Pages workflow only builds
and deploys the static site artifact.

## Repository Shape

- `wasm/upstream_shim/` supplies the current WASI boundary for Lean's real
  upstream interpreter.
- `tools/GenerateProvider.lean` elaborates the demo Lean sources, walks the
  typed `Lean.IR.Decl` closure, and emits
  `build/generated/static_decl_provider.generated.cpp`.
- `scripts/build-upstream-probe.sh` compiles and links the upstream
  interpreter, writes `build/upstream-probe/boundary.md`, and copies the strict
  artifact to `web/public/vir-upstream.wasm`.
- `scripts/smoke_upstream.mjs` executes the generated browser artifact in Node.
- `web/` is the browser harness.

## Status

The strict WASI link closes with zero unresolved symbols. The current demo is
not a full Lean module/environment port: it uses a statically loaded declaration
closure instead of loading `Init.ir` or `.olean` module data.

The static closure is isolated behind `decl_provider.h` so a future provider
can become more faithful without changing the upstream interpreter or platform
shim.

The build caches the upstream interpreter, Lean runtime, support, and shim
objects under `build/upstream-probe/obj`. Updating the Lean examples regenerates
the provider and relinks the WASM artifact, but does not recompile
`ir_interpreter.cpp` unless the upstream source, compiler flags, or runtime
overlay change.

## Generated Artifacts

`npm run build:demo` writes:

- `build/upstream-probe/ir_interpreter.strict.wasm`
- `build/upstream-probe/boundary.md`
- `web/public/vir-upstream.wasm`

These generated files should not be committed.

`npm run build:site` additionally writes `web/dist/`, which is also generated
and should not be committed.

The demo link uses 4 MiB of initial memory and a 1 MiB stack by default.
Override those with `VIR_WASM_INITIAL_MEMORY` and `VIR_WASM_STACK_SIZE`.

The default WASI installer pins `wasi-sdk-33.0-x86_64-linux.tar.gz` from
`WebAssembly/wasi-sdk` and verifies its SHA-256 digest. Override with
`WASI_SDK_VERSION`, `WASI_SDK_VERSION_FULL`, `WASI_SDK_ARCH`, `WASI_SDK_OS`, or
`WASI_SDK_SHA256` if needed.
