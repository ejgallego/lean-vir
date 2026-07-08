# Upstream Shim

This directory contains the local WASI boundary used to run Lean's real IR
interpreter in `wasm32-wasip1`. The upstream interpreter source stays in
`third_party/lean4-src/src/library/ir_interpreter.cpp`; demo-only host support,
package lookup, and temporary runtime glue live here instead.

## File Map

- `interpreter_bridge.h` and `interpreter_bridge.cpp`: upstream interpreter
  lifecycle, `lean_ir_find_env_decl` hooks, and boxed function execution.
- `call_abi.cpp`: package call entry points exposed to the JavaScript runtime.
- `closure_abi.cpp`: Lean closure roots and callback calls used when function
  values cross to JavaScript.
- `host_import_trampolines.cpp`: package-scoped JavaScript host-import
  trampolines used by restricted `dlsym` lookup.
- `signature_cache.h` and `signature_cache.cpp`: package-call signature
  summaries keyed by the current loaded package generation.
- `object_abi.cpp`: generic owned `lean_object *` helpers used by the runtime
  object call path and boundary tests.
- `object_expr_abi.cpp`: temporary `Lean.Level`, `Lean.Expr`, literal, and
  name-string helpers used by current object-boundary fixtures.
- `resource_abi.h` and `resource_abi.cpp`: shared external resource class for
  `Lean.Vir.Js α` values.
- `call_signature_summary.h` and `call_signature_summary.cpp`: streaming package-call
  signature parser used to compute call arity and boxed-boundary requirements.
- `name_utils.h` and `name_utils.cpp`: shared Lean `Name` helpers for package
  call resolution and object construction.
- `native_symbols.cpp`: handwritten native extern wrappers for declarations
  carried in `.irpkg` files.
- `native_symbol_lookup.cpp`: generated native extern registry include,
  restricted symbol lookup, symbol-stem support, and C++ exception stubs.
- `native_symbols_registry.inc`: generated registry of native extern names from
  `Vir/GeneratePackage/NativeExterns.lean`. Do not edit it by hand.
- `runtime_environment_stubs.cpp`: inert runtime-budget, tracing, option, and
  environment hooks for this single-threaded demo build.
- `package_init_bridge.cpp`: package-backed initializer-name lookup used by
  upstream initializer guards.
- `runtime_value_stubs.cpp`: small runtime value helpers that are not yet
  supplied by linked Lean runtime sources.
- `io_stubs.cpp`: demo stderr/error-reporting no-ops.
- `lean_object_constructors.cpp`: temporary Lean `Name`, `Level`, and `Expr`
  constructors needed by current fixtures.
- `package_ir_decoder.cpp`: `.irpkg` binary decoder and Lean IR object
  materializer.
- `decl_provider.h`, `package_decl_provider_types.h`, and
  `package_decl_provider.cpp`: the package-backed static declaration provider.
  Future module-backed loading should replace this layer.
- `engine_bench.cpp`: local benchmark harness entry point.

## Code Attribution

This table attributes the local shim code by ownership and package-format
coupling. Line counts are approximate and are meant for sizing, not policy.

| Area | Files | Approx. LOC | Package coupling | Notes |
| --- | --- | ---: | --- | --- |
| Package decoding and materialization | `package_ir_decoder.cpp`, `package_decl_provider_types.h` | 870 | Direct | Reads `.irpkg` bytes and reconstructs Lean IR objects. Main target if we reduce package encoding complexity. |
| Loaded package state and declaration provider | `package_decl_provider.cpp`, `decl_provider.h` | 394 | Direct | Owns loaded package indices, declaration lookup, call slots, interface manifest, and init globals. |
| Package call signatures | `call_signature_summary.cpp/.h`, `signature_cache.cpp/.h` | 398 | Direct metadata | Decodes compact export signatures used by `vir_call_resolved_objects`; likely shrinks if package metadata becomes closer to generated code. |
| Host import dispatch | `host_import_trampolines.cpp` | 382 | Direct metadata | Uses package host-import slots, arity, erased-prefix count, and effect metadata. |
| Native extern support | `native_symbols.cpp`, `native_symbol_lookup.cpp`, `native_symbols_registry.inc` | 1696 | Declaration/native symbol coupling | Mostly runtime coverage and lookup policy, not package byte-format parsing. |
| JavaScript package-call ABI | `call_abi.cpp` | 129 | Consumes package metadata | Thin JS-facing entry point over call slots and cached signatures. |
| Upstream interpreter bridge | `interpreter_bridge.cpp/.h` | 102 | Low | Initializes the upstream interpreter and provides `lean_ir_find_env_decl` hooks. |
| Object/resource/closure ABI | `object_abi.cpp`, `object_expr_abi.cpp`, `resource_abi.cpp/.h`, `closure_abi.cpp` | 776 | Low | Runtime object boundary used after explicit lowering; `object_expr_abi.cpp` is fixture/parser support. |
| Lean object construction helpers | `lean_object_constructors.cpp`, `name_utils.cpp/.h` | 435 | Support | Temporary constructors and name helpers needed while package decoding constructs Lean objects directly. |
| Platform/runtime stubs | `runtime_environment_stubs.cpp`, `package_init_bridge.cpp`, `runtime_value_stubs.cpp`, `io_stubs.cpp` | 167 | Mostly low | Runtime glue; `package_init_bridge.cpp` is package-backed but not package-format parsing. |
| Benchmark harness | `engine_bench.cpp` | 211 | None | Local benchmark entry point; not linked into the browser WASM. |

## Editing Rules

- Keep the vanilla Lean interpreter source unmodified.
- Put demo-only WASI stubs and fixture providers in this directory.
- Keep static declaration lookup behind `decl_provider.h`.
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
