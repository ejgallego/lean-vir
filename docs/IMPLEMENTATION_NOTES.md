# Implementation Notes

The scoped POC deliberately keeps one active execution path:

- compile Lean `v4.30.0-rc2`'s real `src/library/ir_interpreter.cpp`;
- link the viable Lean runtime sources into a `wasm32-wasip1` module;
- provide the demo declaration closure through `lean_ir_find_env_decl`;
- run that module from Node and the browser.

The current declaration provider is static C++ fixture construction. It returns
real Lean IR declaration objects, not a parallel demo schema. This keeps the
browser demo small while preserving the future replacement point for generated
module data or a real environment loader.

Generated artifacts live under `build/` and `web/public/vir-upstream.wasm`.
They should not be committed.
