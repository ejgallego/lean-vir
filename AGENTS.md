# Repository Instructions

This repository is a proof of concept for running Lean 4's real IR interpreter
in `wasm32-wasip1`.

## Toolchain

- Use Lean `leanprover/lean4:v4.30.0-rc2`.
- Use the local WASI SDK installed by `npm run install:wasi`.
- Use Node/npm for the browser harness and smoke tests.

## Local Commands

- `npm install`
- `npm run fetch:lean`
- `npm run install:wasi`
- `npm run build:demo`
- `npm run build:site`
- `npm run probe:upstream`
- `npm test`
- `npm run test:upstream`
- `npm run dev -- --port 5173`

## Git Layout

Use ordinary `git` commands in this checkout.

## Development Notes

- Keep generated `build/` outputs out of Git.
- Keep generated `web/dist/` outputs out of Git.
- `web/public/vir-upstream.wasm` is generated and should not be committed.
- The current browser `fib` input range is `0..17`.
- Keep `third_party/lean4-src/src/library/ir_interpreter.cpp` unmodified.
- Put demo-only WASI stubs and fixture providers under `wasm/upstream_shim/`.
- Keep the static declaration provider behind `wasm/upstream_shim/decl_provider.h`;
  future module-backed loading should replace that provider, not the upstream
  interpreter or the platform shim.
- Do not add native lookup support until a real demo case requires it.
