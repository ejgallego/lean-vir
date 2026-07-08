# Upstream Shim

This directory contains the local WASI boundary used to run Lean's real IR
interpreter in `wasm32-wasip1`. The upstream interpreter source stays in
`third_party/lean4-src/src/library/ir_interpreter.cpp`; demo-only host support,
package lookup, and temporary runtime glue live here instead.

## Directory Map

- `package/`: `.irpkg` decoding, loaded package state, declaration lookup,
  call-slot/signature metadata, host-import metadata, and package-backed
  initializer-name lookup. Future module-backed loading should replace this
  layer first.
- `abi/`: exported JS/WASM ABI entry points for package calls, closures, owned
  Lean objects, temporary `Lean.Level`/`Lean.Expr` support, and `Lean.Vir.Js α`
  resources.
- `interpreter/`: upstream interpreter lifecycle, `lean_ir_find_env_decl` hooks,
  and boxed interpreter execution.
- `runtime/`: handwritten native extern wrappers, restricted native symbol
  lookup, temporary Lean object constructors/name helpers, and WASI/runtime
  stubs.
- `bench/`: local benchmark harness entry point. It is not linked into the
  browser WASM.

## Code Attribution

This table attributes the local shim code by ownership and package-format
coupling. Line counts are approximate and are meant for sizing, not policy.

| Area | Files | Approx. LOC | Package coupling | Notes |
| --- | --- | ---: | --- | --- |
| Package decoding and materialization | `package/package_ir_decoder.cpp`, `package/package_decl_provider_types.h` | 749 | Direct | Reads `.irpkg` bytes and reconstructs Lean IR objects. Main target if we reduce package encoding complexity. |
| Loaded package state and declaration provider | `package/package_decl_provider.cpp`, `package/decl_provider.h` | 394 | Direct | Owns loaded package indices, declaration lookup, call slots, direct export call summaries, interface manifest, and init globals. |
| Host import dispatch | `package/host_import_trampolines.cpp` | 382 | Direct metadata | Uses package host-import slots, arity, erased-prefix count, and effect metadata. |
| Native extern support | `runtime/native_symbols.cpp`, `runtime/native_symbol_lookup.cpp`, `runtime/native_symbols_registry.inc` | 1696 | Declaration/native symbol coupling | Mostly runtime coverage and lookup policy, not package byte-format parsing. |
| JavaScript package-call ABI | `abi/call_abi.cpp` | 122 | Consumes package metadata | Thin JS-facing entry point over call slots and direct call summaries. |
| Upstream interpreter bridge | `interpreter/interpreter_bridge.cpp/.h` | 102 | Low | Initializes the upstream interpreter and provides `lean_ir_find_env_decl` hooks. |
| Object/resource/closure ABI | `abi/object_abi.cpp`, `abi/object_expr_abi.cpp`, `abi/resource_abi.cpp/.h`, `abi/closure_abi.cpp` | 776 | Low | Runtime object boundary used after explicit lowering; `object_expr_abi.cpp` is fixture/parser support. |
| Lean object construction helpers | `runtime/lean_object_constructors.cpp`, `runtime/name_utils.cpp/.h` | 435 | Support | Temporary constructors and name helpers needed while package decoding constructs Lean objects directly. |
| Platform/runtime stubs | `runtime/runtime_environment_stubs.cpp`, `package/package_init_bridge.cpp`, `runtime/runtime_value_stubs.cpp`, `runtime/io_stubs.cpp` | 167 | Mostly low | Runtime glue; `package/package_init_bridge.cpp` is package-backed but not package-format parsing. |
| Benchmark harness | `bench/engine_bench.cpp` | 211 | None | Local benchmark entry point; not linked into the browser WASM. |

## Editing Rules

- Keep the vanilla Lean interpreter source unmodified.
- Put demo-only WASI stubs and fixture providers in this directory.
- Keep static declaration lookup behind `package/decl_provider.h`.
- Do not add native lookup support until a real demo case requires it.
- Prefer fail-fast stubs over fabricated kernel metadata when the package does
  not provide enough information.

When editing native extern declarations or wrappers, first check that the
Lean-side table matches Lean's imported IR signatures:

```bash
npm run check:native-externs
```

When adding or removing native extern wrappers, regenerate and check the
registry:

```bash
node scripts/check-boundary-registry.mjs --write
node scripts/check-boundary-registry.mjs
```

The usual boundary validation is:

```bash
npm run probe:upstream
npm test
```
