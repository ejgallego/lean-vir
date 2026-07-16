# Upstream Shim

This directory contains the local WASI boundary used to run Lean's real IR
interpreter in `wasm32-wasip1`. The upstream interpreter source stays in
`third_party/lean4-src/src/library/ir_interpreter.cpp`; demo-only host support,
package lookup, and temporary runtime glue live here instead.

## Directory Map

- `package/`: `.irpkg` decoding, loaded package state, declaration lookup,
  call-slot summary metadata, host-import metadata, and package-backed
  initializer-name lookup. Future module-backed loading should replace this
  layer first.
- `abi/`: exported JS/WASM ABI entry points for package calls, closures, owned
  Lean objects, temporary `Lean.Level`/`Lean.Expr` support, and `Lean.Vir.Js α`
  resources.
- `interpreter/`: upstream interpreter lifecycle, `lean_ir_find_env_decl` hooks,
  and boxed interpreter execution.
- `runtime/`: shim-specific native extern wrappers, restricted native symbol
  lookup for both shim and compiler-generated wrappers, temporary Lean object
  constructors/name helpers, and WASI/runtime stubs.
- `bench/`: local benchmark harness entry point. It is not linked into the
  browser WASM.

## Code Attribution

This table attributes the local shim code by ownership and package-format
coupling. Line counts are approximate and are meant for sizing, not policy.

| Area | Files | Approx. LOC | Package coupling | Notes |
| --- | --- | ---: | --- | --- |
| Package envelope decoding | `package/package_section_directory.cpp`, `package/package_section_directory.h`, `package/package_binary_reader.h`, `package/package_decl_provider_types.h` | 325 | Direct | Reads the `.irpkg` header and section directory, checks required sections, and validates section bounds. |
| Package payload decoding | `package/package_ir_decoder.cpp` | 562 | Direct | Decodes section payloads into package declarations, init globals, host imports, export summaries, and the embedded manifest, with scoped cleanup for partial graphs. |
| Package IR object materialization | `package/package_ir_builders.cpp`, `package/package_ir_builders.h` | 304 | Direct IR object layout | Reconstructs Lean IR objects from decoded package fields under a consuming-child ownership convention. |
| Loaded package state and declaration provider | `package/package_decl_provider.cpp`, `package/decl_provider.h` | 398 | Direct | Owns loaded package indices, declaration lookup, structural export-index call slots, direct export call summaries, interface manifest, and init globals. |
| Package load ABI | `package/package_loader_abi.cpp` | 49 | Direct | Exposes package byte allocation, package loading, package errors, and interface manifest access to JavaScript. |
| Host import dispatch | `package/host_import_trampolines.cpp` | 382 | Direct metadata | Uses package host-import slots, arity, erased-prefix count, and effect metadata. |
| Native extern support | `runtime/native_symbols.cpp`, `runtime/native_symbol_lookup.cpp`, `runtime/native_symbols_registry.inc`, `tools/GenerateNativeWrappers.lean` | ~1400 | Declaration/native symbol coupling | Standard boxed adapters can be emitted by Lean's compiler into build-local C; custom wrappers remain in the shim. Mostly runtime coverage and lookup policy, not package byte-format parsing. |
| JavaScript package-call ABI | `abi/call_abi.cpp` | 134 | Consumes package metadata | Thin JS-facing entry point over call slots and direct call summaries. |
| Upstream interpreter bridge | `interpreter/interpreter_bridge.cpp/.h` | 102 | Low | Initializes the upstream interpreter and provides `lean_ir_find_env_decl` hooks. |
| Object/resource/closure ABI | `abi/object_abi.cpp`, `abi/object_expr_abi.cpp`, `abi/resource_abi.cpp/.h`, `abi/closure_abi.cpp` | 776 | Low | Runtime object boundary used after explicit lowering; `object_expr_abi.cpp` is fixture/parser support. |
| Lean object construction helpers | `runtime/lean_object_constructors.cpp`, `runtime/name_utils.cpp/.h` | 435 | Support | Temporary constructors and name helpers needed while package decoding constructs Lean objects directly. |
| Platform/runtime stubs | `runtime/runtime_environment_stubs.cpp`, `package/package_init_bridge.cpp`, `runtime/runtime_value_stubs.cpp`, `runtime/io_stubs.cpp` | 167 | Mostly low | Runtime glue; `package/package_init_bridge.cpp` is package-backed but not package-format parsing. |
| Benchmark harness | `bench/engine_bench.cpp` | 211 | None | Local benchmark entry point; not linked into the browser WASM. |

## Editing Rules

- Keep the vanilla Lean interpreter source unmodified.
- Put demo-only WASI stubs and fixture providers in this directory.
- Keep static declaration lookup behind `package/decl_provider.h`.
- Keep native lookup restricted to symbols declared by the native extern table
  and generated registries; do not expose general dynamic lookup without a
  concrete runtime case.
- Prefer fail-fast stubs over fabricated kernel metadata when the package does
  not provide enough information.

When editing native extern declarations or wrappers, first check that the
Lean-side table matches Lean's imported IR signatures:

```bash
npm run check:native-externs
npm run check:native-wrappers
```

When adding or removing native extern wrappers, regenerate and check the
registry:

```bash
node scripts/check-boundary-registry.mjs --write
node scripts/check-boundary-registry.mjs
npm run check:native-wrappers
```

Set `generateBoxedWrapper := true` on a native extern when the normal Lean
compiler-generated boxed adapter is sufficient. `npm run probe:upstream`
generates the selected declaration bodies, boxed adapters, and registry fragment
under `build/upstream-probe/`, then links the resulting object statically. This
includes compiler-generated raw bodies for selected Lean-defined support such as
`ByteArray.extract`. Keep wrappers with extra control flow or ownership
adaptation in `runtime/native_symbols.cpp`. Put local raw substitutes for
unavailable runtime services or WASI policy in the focused runtime provider
files, and continue to generate their boxed adapters when the normal compiler
output is sufficient.

The usual boundary validation is:

```bash
npm run probe:upstream
npm test
```
