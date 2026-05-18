# Repository Instructions

This repository is a proof of concept for running Lean 4 IR-shaped programs in
`wasm32-wasi`.

## Toolchain

- Use Lean `leanprover/lean4:v4.30.0-rc2`.
- Use Node/npm for the browser harness and WAT fallback.
- The strict C/WASI path requires `wasm-ld` or `WASI_SDK_PATH`.

## Local Commands

- `npm install`
- `npm run export:ir`
- `npm run install:wasi`
- `npm run build`
- `npm run build:wasi`
- `npm test`
- `npm run test:wasi`
- `npm run dev -- --port 5173`

## Git Layout

The Codex sandbox used for initial setup mounted `.git` read-only. In that
environment, use:

```bash
git --git-dir=.vir.git --work-tree=. status
```

In a normal checkout from GitHub, use ordinary `git` commands.

## Development Notes

- Keep generated `build/` outputs out of Git.
- `web/public/vir.wasm` is generated and should not be committed.
- Keep `wasm/runner.wat` and `wasm/runner.c` export-compatible:
  `vir_fib`, `vir_target_pointer_bytes`, `vir_target_size_t_bytes`, and
  `vir_target_layout_ok`.
- Do not claim full Lean runtime portability until the C++ interpreter path is
  linked and tested under `wasm32-wasi`.
