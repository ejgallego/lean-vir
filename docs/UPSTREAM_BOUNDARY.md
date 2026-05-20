# Upstream Interpreter Boundary

The demo goal is to compile Lean's real `src/library/ir_interpreter.cpp` for
`wasm32-wasip1` and then supply only the runtime and environment surface needed
for small browser examples such as `fib`, `Tamagotchi.step`, and
`SortDemo.demoFromArray`.

Run the boundary probe with:

```bash
npm run probe:upstream
```

The generated report is written to `build/upstream-probe/boundary.md`.

Current status: the strict `wasm32-wasip1` link succeeds with the real upstream
`ir_interpreter.cpp`, the linked Lean runtime subset, and
`wasm/upstream_shim/`. The demo closure is supplied through a package-backed
provider as real Lean IR declaration objects, and the exported demo functions
execute that closure through the real upstream interpreter.

## Policy

- Keep `third_party/lean4-src/src/library/ir_interpreter.cpp` unmodified.
- Compile the exact upstream file against the pinned Lean `v4.30.0-rc2`
  headers.
- Link real Lean runtime source files into the WASI probe before adding local
  stubs.
- Do not model the demo interpreter with a parallel bespoke IR schema.
- Provide real Lean IR declaration objects through `lean_ir_find_env_decl`.
- Stub only runtime/library pieces that the current demo paths do not execute.
- Keep general native symbol lookup unsupported; register only the demo externs
  that are needed by the current closure.

## Linked Runtime

The probe links these upstream runtime sources:

- `src/runtime/alloc.cpp`
- `src/runtime/apply.cpp`
- `src/runtime/exception.cpp`
- `src/runtime/hash.cpp`
- `src/runtime/mpn.cpp`
- `src/runtime/mpz.cpp`
- `src/runtime/object.cpp`
- `src/runtime/object_ref.cpp`
- `src/runtime/utf8.cpp`

It also links `src/util/name.cpp`, which is not runtime proper but is needed by
the interpreter's name formatting and diagnostics.

The probe additionally links `wasm/upstream_shim/`. This is local demo code,
not a fork of Lean. It is split by responsibility:

- `shim.cpp` owns WASI/platform stubs and the exported Lean C hooks.
- `tools/GeneratePackage.lean` owns extraction of the demo declaration closure
  from typed `Lean.IR.Decl` values into `build/generated/vir-demo.irpkg`.
- `decl_provider.h` is the replacement point for a future module-backed
  provider.

Together they supply:

- `lean_ir_find_env_decl` and `lean_ir_find_env_decl_boxed` for the generated
  demo closure, including `fib`, `Tamagotchi.step`, `Tamagotchi.run`,
  `Tamagotchi.trace`, `Tamagotchi.demoScript`, `SortDemo.demoFromArray`, and
  their current dependencies.
- small WASI/platform stubs for dynamic symbol lookup, C++ exception throwing,
  trace/time/options hooks, and the few environment helpers pulled in by the
  interpreter.
- name construction primitives needed by `src/util/name.cpp`.

The WASI probe generates a local `lean/config.h` overlay with `LEAN_MIMALLOC`
disabled. The pinned Lean source checkout contains the runtime sources but does
not include vendored mimalloc sources for a WASI rebuild, so this selects Lean's
ordinary allocator path while still compiling Lean's real runtime code.

The build compiles stable sources into cached objects under
`build/upstream-probe/obj`. Example edits regenerate `web/public/vir-demo.irpkg`
without recompiling or relinking the WASM artifact. The artifact is relinked
only when stable objects, link flags, the Lean source commit, or the runtime
config overlay change.

## Real IR Declarations

The upstream interpreter reads declarations through the Lean object layout
accessors in `ir_interpreter.cpp`. A package-backed provider therefore has to
return `Option decl` values using the same constructor layout:

- `decl` uses `Fun`/`Extern` constructors and carries `fun_id`, parameters,
  result type, and `fn_body`.
- `fn_body` uses the real `VDecl`, `Dec`, `Case`, `Ret`, and later additional
  body constructors.
- `expr` uses the real `Lit`, `FAp`, `Ctor`, and `Proj` constructors for the
  current fixture closure.
- `arg` uses constructor-backed variables and scalar erased arguments.
- arrays must be Lean array objects, not C arrays.

This is the critical distinction from the discarded bootstrap runners: the demo
does not use a parallel C/C++ interpreter schema.

## Static Closure Strategy

For the demo, we will statically load the transitive declaration closure needed
by the examples rather than loading Lean module data. This keeps `.olean`
loading, module initialization, and full environment construction out of scope
while still exercising the real upstream interpreter over real Lean IR objects.

The closure is extracted by `tools/GeneratePackage.lean` from real
`Lean.IR.Decl` values. The generator starts with declarations produced for the
example sources, walks `FAp`/`PAP` references, and can now fall back to
`Lean.IR.findEnvDecl` for imported IR declarations already available through
the elaborated environment. This is still package-backed loading, not full
module loading, but it lets fixtures include small upstream library closures
such as `List.reverse._redArg`. The generator then emits a small binary package.
`wasm/upstream_shim/package_decl_provider.cpp` decodes that package into the
upstream interpreter's expected object layout at runtime. The generator report
separates missing Lean IR declarations from missing native extern
registrations, and the package decoder exposes its last load error for browser
and smoke-test diagnostics.
The current explicit native externs cover the small fixture/demo surface for
`Nat`, `Int`, `Array`, `ByteArray`, `USize`, `UInt8`, `UInt32`, `UInt64`,
`Float`, and `String`. This includes the arithmetic and comparison operations
needed by the demos, List/Array/String/ByteArray fixtures, array mutation
through `Array.replicate`/`Array.set!`/`Array.swapIfInBounds`/`Array.pop`,
String raw-position iteration through `String.Internal.next`/
`String.Pos.Raw.get`/`String.Internal.atEnd`, and the current
numeric boundary fixtures for `Nat.div`/`pow`/`log2`/shifts, small `Int`
arithmetic, `UInt8`/`UInt16` `toNat` plus arithmetic, bitwise, shift, and
comparison operations, `UInt32.ofNat`/`toNat` plus arithmetic, bitwise, shift,
and comparison operations, `UInt64.ofNat`/`toNat`/`toFloat` plus arithmetic,
bitwise, shift, and comparison operations including a wide `UInt64.toNat`
fixture returned through `vir_eval_const_nat_string`, and
`Float.scaleB`/`toUInt32`. They are backed by a table-driven shim registry; a full
native symbol loader is still out of scope. `ByteArray.empty` is exposed as
Lean's native constant symbol (`l_ByteArray_empty`), not as a boxed nullary
function, because the upstream interpreter loads native constants through the
symbol address. `ByteArray.extract` is exposed as Lean's compiled symbol stem
(`l_ByteArray_extract`) and delegates to the linked runtime
`lean_byte_array_copy_slice` path.

`scripts/check-boundary-registry.mjs` is a guard against drift in this explicit
registry. It checks that every `nativeExterns` entry in
`tools/GeneratePackage.lean` has a matching table entry, `dlsym` symbol, and
boxed wrapper or native constant entry in `wasm/upstream_shim/shim.cpp`.
`npm test` runs this before the smoke and fixture suites.

The boundary between the two approaches is intentionally narrow:
`lean_ir_find_env_decl` and `lean_ir_find_env_decl_boxed` delegate to
`decl_provider.h`. Today that provider is backed by a small package decoded from
`Lean.IR.Decl` data. Later it can be backed by generated module data or a real
environment loader without changing `ir_interpreter.cpp` or the WASI/platform
shim.

## Current Boundary

The remaining gap is fidelity, not execution. The demo bodies now come from the
real Lean compiler IR for the example sources and selected imported IR
declarations, but they are loaded from a demo-specific package instead of Lean's
generated module data. A later provider can replace this package with generated
module data behind `decl_provider.h`.

The fixture suite currently has no expected-unsupported entry. When the next
native or imported-IR gap appears, keep it explicit in `fixtures/manifest.json`
until the required shim or package-loader support is added.

## Future Loading Path

The current loader is intentionally demo-specific: it decodes the package format
emitted by `tools/GeneratePackage.lean`. The next compatibility step is to make
the package format match Lean's generated `.ir` or module data more closely, so
the same stable `vir_load_ir_package(ptr, len)` boundary can load artifacts
produced by Lean itself.
