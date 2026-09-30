# Upstream Shim

This directory contains the local WASI boundary used to run Lean's real IR
interpreter in `wasm32-wasip1`. The upstream interpreter source stays in
`third_party/lean4-src/src/library/ir_interpreter.cpp`. Package execution,
Lean object ownership, host calls and constrained platform providers live here.
These support the general package runtime as well as the demos.

## Directory Map

- `package/`: `.irpkg` decoding, loaded package state, declaration lookup,
  call-slot summary metadata, host-import metadata, and package-backed
  initializer-name lookup. Declaration-provider changes belong behind
  `package/decl_provider.h`.
- `abi/`: exported JS/WASM ABI entry points for package calls, closures, owned
  Lean objects, specialized `Lean.Level`/`Lean.Expr` support, and `Lean.Vir.Js α`
  resources.
- `interpreter/`: upstream interpreter lifecycle, `lean_ir_find_env_decl` hooks,
  and boxed interpreter execution.
- `runtime/`: shim-specific native extern wrappers, restricted native symbol
  lookup for both shim and compiler-generated wrappers, pinned Lean object
  constructors/name helpers, and WASI/runtime providers.
- `bench/`: local benchmark harness entry point. It is not linked into the
  browser WASM.

## Code Attribution

This table attributes the local shim code by responsibility and package-format
coupling. Generated adapters and selected upstream providers are outside this
directory; the build script records the actual linked inputs.

| Area | Files | Package coupling | Notes |
| --- | --- | --- | --- |
| Package envelope decoding | `package/package_section_directory.cpp`, `package/package_section_directory.h`, `package/package_binary_reader.h`, `package/package_decl_provider_types.h` | Direct | Reads the `.irpkg` header and section directory, checks required sections, and validates section bounds. |
| Package payload decoding | `package/package_ir_decoder.cpp` | Direct | Decodes section payloads into package declarations, init globals, host imports, export summaries, and the embedded manifest, with scoped cleanup for partial graphs. |
| Package IR object materialization | `package/package_ir_builders.cpp`, `package/package_ir_builders.h` | Direct IR object layout | Reconstructs Lean IR objects from decoded package fields under a consuming-child ownership convention. |
| Standalone package IR builder test | `package/package_ir_builders_test.cpp` | Native test only | Checks package IR object construction and ownership; excluded from the browser Wasm link. |
| Loaded package state and declaration provider | `package/package_decl_provider.cpp`, `package/decl_provider.h` | Direct | Owns loaded package indices, declaration lookup, structural export-index call slots, direct export call summaries, interface manifest, and init globals. |
| Package load ABI | `package/package_loader_abi.cpp` | Direct | Exposes package byte allocation, package loading, package errors, and interface manifest access to JavaScript. |
| Host import dispatch | `package/host_import_trampolines.cpp` | Direct metadata | Generates fixed typed slot/arity tables at compile time from producer-derived limits; uses package erased-prefix and effect metadata. Preparation validates the aggregate limits. |
| Native extern support | `runtime/native_symbols.cpp`, `runtime/native_symbol_lookup.{cpp,h}`, `native-support-sources.txt`, `tools/GenerateNativeWrappers.lean`, `scripts/native/native-symbol-registry.mjs`, `scripts/build-upstream-probe.sh` | Declaration/native symbol coupling | Standard boxed adapters and the lookup registry are emitted into `build/`. The tracked stage0 source list supplies selected Lean-defined raw exports; three ownership adapters and raw environment-policy providers remain in the shim. |
| JavaScript package-call ABI | `abi/call_abi.cpp` | Consumes package metadata | JS-facing entry point over call slots and summaries; null results signal failure. |
| IO error diagnostics | `runtime/io_error.cpp`, `runtime/io_error.h` | Low | Formats Lean IO errors for named calls, closures and initializers with explicit ownership; no host/UI presentation policy. |
| Upstream interpreter bridge | `interpreter/interpreter_bridge.cpp/.h`, `interpreter/persistent_ir_interpreter.cpp` | Low | Initializes the upstream interpreter, provides `lean_ir_find_env_decl` hooks, and owns the package-scoped interpreter session. |
| Object/resource/closure ABI | `abi/object_abi.cpp`, `abi/object_expr_abi.cpp`, `abi/resource_abi.cpp/.h`, `abi/closure_abi.cpp` | Low | Runtime object boundary used after explicit lowering; `object_expr_abi.cpp` provides the specialized Expr/Level interface used by parsers and other clients. |
| Lean object construction | `scripts/build-upstream-probe.sh`, `native-support-sources.txt`, `runtime/name_utils.cpp/.h` | Support | Pinned generated `Init/Prelude.c`, `Lean/Level.c` and `Lean/Expr.c` supply Name/Level/Expr constructors and cached metadata. Local dotted-name conversion is a restricted Expr interface. |
| Structural Lean Name identity | `runtime/name_identity.h` | Manifest 9 | Encodes Lean names by constructor structure for package identity; it does not use display-name formatting. |
| Lazy constant initialization | `runtime/once.cpp` | Pinned runtime ABI | Eight single-threaded `*_once_cold` providers preserve initialization and persistent roots without atomic waits or clocks; same-cell recursion traps by VIR policy and retires the instance ([pinned ABI](https://github.com/leanprover/lean4/blob/293d5d0c0c3f3dded4688b3ccd6a33939ac5102b/src/include/lean/lean.h#L3374), [upstream implementation](https://github.com/leanprover/lean4/blob/293d5d0c0c3f3dded4688b3ccd6a33939ac5102b/src/runtime/object.cpp#L2896)). |
| Platform/runtime providers | `runtime/runtime_environment_stubs.cpp`, `package/package_init_bridge.cpp`, `runtime/runtime_value_stubs.cpp`, `runtime/io_stubs.cpp` | Mostly low | Includes real ST references, initializing state and numeric conversion alongside constrained environment and diagnostic providers. |
| Benchmark harness | `bench/engine_bench.cpp` | Fixture-specific | Local benchmark entry point; not linked into the browser WASM. |

## Runtime limits

The provider names do not all describe stubs. ST references, `IO.initializing`,
numeric conversion, closure roots and foreign-resource ownership are implemented
runtime mechanisms. The following constraints remain explicit:

| Surface | Current behavior |
| --- | --- |
| System, heartbeat, stack and trace hooks | Inert; they do not supply cancellation or execution budgets. |
| Options | Boolean defaults without general option discovery/configuration. |
| Compiler environment metadata | No sorry-dependency/export metadata; the meta-check provider always accepts. This is limited parser/environment compatibility. |
| Diagnostics | The stderr provider discards output. Named calls, callbacks and initializers preserve Lean IO error text through their diagnostics. |
| Expr/Name conversion | Dotted string-component names are restricted, and JS lowering drops expression metadata. See [the SDK contract](../../docs/guides/JS_API.md). |
| Exceptions | Effectful host errors stop IO continuation and allow reuse. Pure host failures trap; the SDK retires the instance. C++ exceptions and other escaping Wasm traps also retire it, without claiming frame unwinding. |

Application code chooses artifact acquisition, rendering, scheduling and error
presentation. Object layout/refcounts, interpreter state, initialization and
cross-runtime roots remain VIR responsibilities.

## Editing Rules

- Keep the vanilla Lean interpreter source unmodified.
- Put demo-only WASI stubs and fixture providers in this directory.
- Keep static declaration lookup behind `package/decl_provider.h`.
- Keep native lookup restricted to symbols declared by the native extern policy
  table
  and generated registries; do not expose general dynamic lookup without a
  concrete runtime case.
- Prefer fail-fast stubs over fabricated kernel metadata when the package does
  not provide enough information.

When editing native extern policy or wrappers, first check that every entry
resolves through Lean's imported IR and extern metadata:

```bash
npm run check:native-externs
npm run check:native-wrappers
```

When adding or removing native extern wrappers, regenerate and check the
registry:

```bash
npm run generate:boundary-registry
npm run check:boundary-registry
npm run check:native-wrappers
```

`NativeExternSpec` stores VIR policy only. Lean supplies each declaration's
parameter/borrow/result ABI and native symbol except for intentional
provider aliases. Keep those aliases in `symbolOverride?`; the metadata check
rejects an override once it becomes redundant. The JavaScript registry and
inventory checks consume `vir_native_wrappers --catalog`, not the Lean source
text.

Set `generateBoxedWrapper := true` on a native extern specification when the
normal Lean compiler-generated boxed adapter is sufficient.
`npm run probe:upstream` generates the selected declaration bodies, boxed
adapters, and registry fragment under `build/upstream-probe/`, then links the
resulting object statically. This
includes compiler-generated raw bodies for selected Lean-defined support such as
`ByteArray.extract`. When an imported implementation closure exists only in
compiled upstream output, the probe cross-compiles the corresponding pinned
stage0 module listed in `native-support-sources.txt`. Local exceptions,
generated adapters, and those upstream objects are prelinked in that precedence
order. Duplicate tolerance is confined to the relocatable bundle and checked
against the generated/local symbol set before the strict final link. Put local
behavior and WASI policy in raw provider functions and continue to generate
their boxed adapters when the normal compiler output is sufficient. Keep a
boxed implementation in `runtime/native_symbols.cpp` only when the all-owned
interpreter boundary needs ownership adaptation that the standard wrapper
cannot express; the inventory contains the complete three-wrapper exception
allowlist.

The usual boundary validation is:

```bash
npm run probe:upstream
npm test
```
