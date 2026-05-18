# Lean VIR

Lean VIR is a proof of concept for running Lean 4 IR-shaped programs from
WebAssembly in the browser.

The target Lean toolchain is pinned to `leanprover/lean4:v4.30.0-rc2`.
The browser demo loads a `wasm32` module with a WASI Preview 1 import namespace
and calls `vir_fib`.

## Current Shape

- `examples/Fib.lean` is the Lean source for the demo program.
- `scripts/export_ir.py` runs Lean with `trace.compiler.ir.result`, records the
  generated IR, and emits a small bytecode fixture for the runner.
- `wasm/runner.c` is the freestanding `wasm32-wasi` bytecode runner intended for
  the strict C/WASI path.
- `wasm/runner.wat` is a checked-in runnable fallback used when `wasm-ld` or a
  WASI SDK is not available locally.
- `web/` is the browser harness.

The WAT fallback exists because this machine currently has Lean's bundled Clang
with a wasm backend but not `wasm-ld` or a WASI sysroot.

## Status

The current runnable milestone is a browser and Node smoke test for the Lean IR
shape emitted by `examples/Fib.lean`.

This is not yet a full upstream Lean IR interpreter port. The next milestone is
to stage Lean's `src/library/ir_interpreter.cpp` and enough runtime support from
Lean `v4.30.0-rc2` into the strict `wasm32-wasi` build.

## Quick Start

```bash
npm install
npm run build
npm test
npm run dev
```

Open the Vite URL and the page should report `fib 8 = 21`.

## Strict WASI C Build

When `wasm-ld` is available, or `WASI_SDK_PATH` points at a WASI SDK, run:

```bash
npm run export:ir
npm run build:wasi
```

That compiles `wasm/runner.c` for `wasm32-wasi` and writes
`web/public/vir.wasm`.

## Git Note

The environment mounted an empty read-only `.git` directory in this workspace.
That cannot be replaced from inside the sandbox. A usable bare Git directory was
created at `.vir.git`; use:

```bash
git --git-dir=.vir.git --work-tree=. status
```
