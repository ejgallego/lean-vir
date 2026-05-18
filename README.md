# Lean VIR

Lean VIR is a proof of concept for running Lean 4's real IR interpreter from
WebAssembly in the browser.

The target Lean toolchain is pinned to `leanprover/lean4:v4.30.0-rc2`. The
browser demo loads a `wasm32-wasip1` module built from Lean's upstream
`src/library/ir_interpreter.cpp` and calls `vir_upstream_fib`.

## Current Shape

- `examples/Fib.lean` and `examples/Tamagotchi.lean` are the Lean sources for
  the demo programs.
- `wasm/upstream_shim/` supplies the current WASI boundary for Lean's real
  upstream interpreter. It provides fixture-backed Lean IR declaration objects
  and stubs platform/library pieces that the demo path should not execute.
- `wasm/upstream_shim/decl_provider.h` is the replacement point for a future
  module-backed provider. The current provider statically loads the declaration
  closure for `fib`, `fib._boxed`, `Nat.add`, `Nat.sub`, `Nat.decEq`, and
  `Tamagotchi.step`.
- `scripts/build-upstream-probe.sh` compiles Lean's real
  `src/library/ir_interpreter.cpp`, links the viable Lean runtime sources for
  WASI, writes `build/upstream-probe/boundary.md`, and copies the strict wasm to
  `web/public/vir-upstream.wasm`.
- `scripts/smoke_upstream.mjs` executes the generated browser artifact in Node.
- `web/` is the browser harness.

## Status

The current runnable milestone executes `fib` through Lean's real
`ir_interpreter.cpp` in both Node and the browser. The strict WASI link closes
with zero unresolved symbols.

This is not yet a full upstream Lean module/environment port. The demo uses a
statically loaded declaration closure instead of loading `Init.ir` or `.olean`
module data. The static closure is intentionally isolated behind
`decl_provider.h` so a later provider can become more faithful without changing
the upstream interpreter or platform shim.

## Quick Start

```bash
npm install
npm run fetch:lean
npm run install:wasi
npm run build:demo
npm test
npm run dev
```

Open the Vite URL and the page should show the `fib` runner and the
Tamagotchi automaton running through the upstream interpreter artifact.

## Demo Artifact

`npm run build:demo` writes:

- `build/upstream-probe/ir_interpreter.strict.wasm`
- `build/upstream-probe/boundary.md`
- `web/public/vir-upstream.wasm`

The browser artifact is generated and should not be committed.

The demo link currently gives the WASM module 4 MiB of initial memory and a
1 MiB stack. Override those with `VIR_WASM_INITIAL_MEMORY` and
`VIR_WASM_STACK_SIZE` when running `npm run build:demo`.

The browser `fib` input is capped at `17` for the current static Peano
arithmetic closure. Higher values still need either a more memory-efficient
closure or a more faithful module/runtime path.

By default the WASI installer pins `wasi-sdk-33.0-x86_64-linux.tar.gz` from
`WebAssembly/wasi-sdk` and verifies its SHA-256 digest. Override with
`WASI_SDK_VERSION`, `WASI_SDK_VERSION_FULL`, `WASI_SDK_ARCH`, `WASI_SDK_OS`, or
`WASI_SDK_SHA256` if needed.

Override the compiler target with `WASI_TARGET`; the default is
`wasm32-wasip1`, the current spelling for WASI Preview 1.

## Upstream Boundary

Track the unresolved boundary with:

```bash
npm run probe:upstream
```

The report is written to `build/upstream-probe/boundary.md`. The policy for the
demo is to keep `ir_interpreter.cpp` unmodified, link Lean's real runtime
sources first, provide real Lean IR declaration objects through
`lean_ir_find_env_decl`, and stub only unused runtime/library pieces as the fib
path needs them.

At this point `Nat.add`, `Nat.sub`, and `Nat.decEq` are executable real IR
function bodies over a static Peano-shaped Nat representation, not native
lookup stubs.

## Git Note

The initial sandbox mounted an empty read-only `.git` directory in this
workspace. A usable bare Git directory was created at `.vir.git`; use:

```bash
git --git-dir=.vir.git --work-tree=. status
```
