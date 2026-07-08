# Upstream Shim

This directory contains the local WASI boundary used to run Lean's real IR
interpreter in `wasm32-wasip1`. The upstream interpreter source stays in
`third_party/lean4-src/src/library/ir_interpreter.cpp`; demo-only host support,
package lookup, and temporary runtime glue live here instead.

## File Map

- `shim.cpp`: package call entry points, Lean closure roots, and
  `lean_ir_find_env_decl` hooks.
- `host_import_trampolines.cpp`: package-scoped JavaScript host-import
  trampolines used by restricted `dlsym` lookup.
- `signature_cache.h` and `signature_cache.cpp`: package-call signature
  summaries keyed by the current loaded package generation.
- `object_abi.cpp`: owned `lean_object *` helpers used by the runtime object
  call path and boundary tests.
- `resource_abi.h` and `resource_abi.cpp`: shared external resource class for
  `Lean.Vir.Js α` values.
- `call_signature_summary.h` and `call_signature_summary.cpp`: streaming package-call
  signature parser used to compute call arity and boxed-boundary requirements.
- `name_utils.h` and `name_utils.cpp`: shared Lean `Name` helpers for package
  call resolution and object construction.
- `native_symbols.cpp`: handwritten native extern wrappers, restricted symbol
  lookup, and symbol-stem support for declarations carried in `.irpkg` files.
- `native_symbols_registry.inc`: generated registry of native extern names from
  `tools/GeneratePackage.lean`. Do not edit it by hand.
- `platform_stubs.cpp`: WASI/demo stubs for Lean platform APIs that are inert,
  package-backed, or deliberately fail-fast in this environment.
- `lean_object_constructors.cpp`: temporary Lean `Name`, `Level`, and `Expr`
  constructors needed by current fixtures.
- `decl_provider.h` and `package_decl_provider.cpp`: the package-backed static
  declaration provider. Future module-backed loading should replace this layer.
- `engine_bench.cpp`: local benchmark harness entry point.

## Editing Rules

- Keep the vanilla Lean interpreter source unmodified.
- Put demo-only WASI stubs and fixture providers in this directory.
- Keep static declaration lookup behind `decl_provider.h`.
- Do not add native lookup support until a real demo case requires it.
- Prefer fail-fast stubs over fabricated kernel metadata when the package does
  not provide enough information.

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
