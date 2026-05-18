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
- `wasm/interpreter_port/` is the first upstream-shaped interpreter harness. It
  evaluates generated `FnBody`/`Expr`/`Arg` fixtures instead of bytecode.
- `wasm/upstream_shim/` is the current WASI boundary shim for Lean's real
  upstream interpreter. It supplies fixture-backed real Lean IR declaration
  objects and stubs platform/library pieces that the demo path should not use.
- `scripts/build-upstream-probe.sh` compiles Lean's real
  `src/library/ir_interpreter.cpp`, links viable Lean runtime sources for WASI,
  and writes an unresolved-boundary report.
- `wasm/runner.wat` is a checked-in runnable fallback used when `wasm-ld` or a
  WASI SDK is not available locally.
- `web/` is the browser harness.

The WAT fallback exists because this machine currently has Lean's bundled Clang
with a wasm backend but not `wasm-ld` or a WASI sysroot.

## Status

The current runnable milestone is a browser and Node smoke test for the Lean IR
shape emitted by `examples/Fib.lean`.

This is not yet a full upstream Lean IR interpreter port. The next milestone is
to implement the remaining semantic fixture boundary so the real upstream
interpreter can execute `fib` end to end. The strict link of the upstream
interpreter and local shim now closes with zero unresolved symbols.

## Quick Start

```bash
npm install
npm run build
npm test
npm run test:wasi
npm run test:interp
npm run probe:upstream
npm run dev
```

Open the Vite URL and the page should report `fib 8 = 21`.

## Strict WASI C Build

Install a local WASI SDK into `.tools/`:

```bash
npm run install:wasi
```

Then build the strict C runner:

```bash
npm run export:ir
npm run build:wasi
npm run test:wasi
```

That compiles `wasm/runner.c` for `wasm32-wasip1` and writes
`web/public/vir.wasm`.

By default the installer pins `wasi-sdk-33.0-x86_64-linux.tar.gz` from
`WebAssembly/wasi-sdk` and verifies its SHA-256 digest. Override with
`WASI_SDK_VERSION`, `WASI_SDK_VERSION_FULL`, `WASI_SDK_ARCH`, `WASI_SDK_OS`, or
`WASI_SDK_SHA256` if needed.

Override the compiler target with `WASI_TARGET`; the default is
`wasm32-wasip1`, the current spelling for WASI Preview 1.

## Interpreter Port Harness

Build and test the first upstream-shaped interpreter harness:

```bash
npm run test:interp
```

This path keeps native fallback, dynlibs, libuv, threads, and `.olean` loading
disabled. It feeds generated Lean IR tree fixtures to an evaluator with the
same core concepts as Lean's upstream interpreter: declaration lookup, function
bodies, expressions, arguments, cases, and stack slots.

Track the boundary for compiling the real upstream interpreter file:

```bash
npm run probe:upstream
```

The report is written to `build/upstream-probe/boundary.md`. The policy for the
demo is to keep `ir_interpreter.cpp` unmodified, link Lean's real runtime
sources first, provide real Lean IR declaration objects through
`lean_ir_find_env_decl`, and stub only unused runtime/library pieces as the fib
path needs them.

At this point the strict upstream probe links. The active boundary is that
`Nat.add`, `Nat.sub`, and `Nat.decEq` are present as real IR `Extern`
declarations but do not yet have non-native WASI implementations.

## Git Note

The environment mounted an empty read-only `.git` directory in this workspace.
That cannot be replaced from inside the sandbox. A usable bare Git directory was
created at `.vir.git`; use:

```bash
git --git-dir=.vir.git --work-tree=. status
```
