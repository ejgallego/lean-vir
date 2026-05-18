# Upstream Interpreter Boundary

The demo goal is to compile Lean's real `src/library/ir_interpreter.cpp` for
`wasm32-wasip1` and then supply only the runtime and environment surface needed
for small browser examples such as `fib` and `Tamagotchi.step`.

Run the boundary probe with:

```bash
npm run probe:upstream
```

The generated report is written to `build/upstream-probe/boundary.md`.

Current status: the strict `wasm32-wasip1` link succeeds with the real upstream
`ir_interpreter.cpp`, the linked Lean runtime subset, and
`wasm/upstream_shim/`. The static demo closure is supplied as real Lean IR
declaration objects, and the exported demo functions execute that closure
through the real upstream interpreter.

## Policy

- Keep `third_party/lean4-src/src/library/ir_interpreter.cpp` unmodified.
- Compile the exact upstream file against the pinned Lean `v4.30.0-rc2`
  headers.
- Link real Lean runtime source files into the WASI probe before adding local
  stubs.
- Do not model the demo interpreter with a parallel bespoke IR schema.
- Provide real Lean IR declaration objects through `lean_ir_find_env_decl`.
- Stub only runtime/library pieces that the current demo paths do not execute.
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

The probe additionally links `wasm/upstream_shim/`. This is local demo code,
not a fork of Lean. It is split by responsibility:

- `shim.cpp` owns WASI/platform stubs and the exported Lean C hooks.
- `static_decl_provider.cpp` owns the statically loaded demo declaration
  closure.
- `decl_provider.h` is the replacement point for a future module-backed
  provider.

Together they supply:

- `lean_ir_find_env_decl` and `lean_ir_find_env_decl_boxed` for `fib`,
  `fib._boxed`, `Nat.add`, `Nat.sub`, `Nat.decEq`, and `Tamagotchi.step`.
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
- `expr` uses the real `Lit`, `FAp`, `Ctor`, and `Proj` constructors for the
  current fixture closure.
- `arg` uses constructor-backed variables and scalar erased arguments.
- arrays must be Lean array objects, not C arrays.

This is the critical distinction from the discarded bootstrap runners: the demo
no longer uses a parallel C/C++ interpreter schema.

## Static Closure Strategy

For the demo, we will statically load the transitive declaration closure needed
by the examples rather than loading Lean module data. This keeps `.olean`
loading, module initialization, and full environment construction out of scope
while still exercising the real upstream interpreter over real Lean IR objects.

The current arithmetic closure uses a static Peano-shaped Nat representation:
`zero` is scalar constructor tag `0`, and `succ` is a constructor object with tag
`1` and one predecessor field. This keeps the arithmetic bodies expressible in
ordinary IR using `case`, `proj`, recursive `FAp`, and `ctor`, while avoiding
native lookup and the full Lean module loader.

The boundary between the two approaches is intentionally narrow:
`lean_ir_find_env_decl` and `lean_ir_find_env_decl_boxed` delegate to
`decl_provider.h`. Today that provider is backed by C++ fixture construction.
Later it can be backed by generated module data or a real environment loader
without changing `ir_interpreter.cpp` or the WASI/platform shim.

## Current Boundary

The remaining gap is fidelity, not execution. The demo bodies are static IR
bodies tailored to the closure needed by the current examples; they are not
loaded from Lean's generated module data. A later provider can replace this
static closure with generated module data behind `decl_provider.h`.
