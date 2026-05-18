# Upstream Interpreter Boundary

The demo goal is to compile Lean's real `src/library/ir_interpreter.cpp` for
`wasm32-wasip1` and then supply only the runtime and environment surface needed
for a small example such as `fib`.

Run the boundary probe with:

```bash
npm run probe:upstream
```

The generated report is written to `build/upstream-probe/boundary.md`.

Current status: the strict `wasm32-wasip1` link succeeds with the real upstream
`ir_interpreter.cpp`, the linked Lean runtime subset, and
`wasm/upstream_shim/shim.cpp`. The remaining boundary is semantic: the `fib`
fixture is supplied as real Lean IR declaration objects, while its arithmetic
dependencies are still represented as unresolved-at-runtime IR `Extern`
declarations.

## Policy

- Keep `third_party/lean4-src/src/library/ir_interpreter.cpp` unmodified.
- Compile the exact upstream file against the pinned Lean `v4.30.0-rc2`
  headers.
- Link real Lean runtime source files into the WASI probe before adding local
  stubs.
- Do not model the demo interpreter with a parallel bespoke IR schema.
- Provide real Lean IR declaration objects through `lean_ir_find_env_decl`.
- Stub only runtime/library pieces that the `fib` path does not execute.
- Leave native symbol lookup unsupported until we need compiled externs.

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

The probe additionally links `wasm/upstream_shim/shim.cpp`. This is local demo
code, not a fork of Lean. It supplies:

- `lean_ir_find_env_decl` and `lean_ir_find_env_decl_boxed` for `fib`,
  `fib._boxed`, `Nat.add`, `Nat.sub`, and `Nat.decEq`.
- small WASI/platform stubs for dynamic symbol lookup, C++ exception throwing,
  trace/time/options hooks, and the few environment helpers pulled in by the
  interpreter.
- name construction primitives needed by `src/util/name.cpp`.

The WASI probe generates a local `lean/config.h` overlay with `LEAN_MIMALLOC`
disabled. The pinned Lean source checkout contains the runtime sources but does
not include vendored mimalloc sources for a WASI rebuild, so this selects Lean's
ordinary allocator path while still compiling Lean's real runtime code.

## Real IR Declarations

The upstream interpreter reads declarations through the Lean object layout
accessors in `ir_interpreter.cpp`. A fixture-backed provider therefore has to
return `Option decl` values using the same constructor layout:

- `decl` uses `Fun`/`Extern` constructors and carries `fun_id`, parameters,
  result type, and `fn_body`.
- `fn_body` uses the real `VDecl`, `Dec`, `Case`, `Ret`, and later additional
  body constructors.
- `expr` uses the real `Lit` and `FAp` constructors for the current `fib`
  fixture.
- `arg` uses constructor-backed variables and scalar erased arguments.
- arrays must be Lean array objects, not C arrays.

This is the main difference from the first harness in `wasm/interpreter_port/`,
which intentionally used a smaller C++ fixture schema.

## Next Boundary

To run `fib` through the real upstream interpreter, the next step is to remove
the arithmetic gap without relying on native lookup. The current shim has real
IR `Extern` declarations for `Nat.add`, `Nat.sub`, and `Nat.decEq`, so a call
that reaches them will report a missing native implementation. For the demo we
should provide their real IR bodies from Lean's generated `Init.ir` data and
keep native lookup unsupported.
