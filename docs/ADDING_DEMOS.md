# Adding Demos

The demo package is intentionally small: Lean examples are elaborated locally,
their typed `Lean.IR.Decl` closure is written to `build/generated/vir-demo.irpkg`,
and the browser loads that package without rebuilding the upstream interpreter.

## Workflow

1. Add or edit a Lean source under `examples/`.
2. Add the public root names to `targets` in `tools/GeneratePackage.lean`.
3. Run `npm run check:package`.
4. Inspect `build/generated/ir-provider-report.md`.
5. Run `npm run check:boundary-registry` if you add or change a native extern.
6. Run `npm test`.
7. Update `web/` only if the demo needs new UI or a new stable WASM export.

Most example-only edits should only regenerate `web/public/vir-demo.irpkg`.
They should not recompile or relink `ir_interpreter.cpp`.

## Reading The Report

The generated report has separate sections for the two common failure modes:

- `Missing IR Declarations`: a root or dependency was not found in the
  generated example declarations.
- `Missing Native Extern Registrations`: the closure references a primitive or
  runtime-backed function that needs an explicit demo shim registration.
- `Unsupported Init Globals`: the closure reached a nullary declaration emitted
  from Lean initialization code whose body is top-level `unreachable`; these
  need an initialized-global provider rather than another normal IR declaration.

If the package generator reaches an unsupported IR shape, it reports the
declaration being encoded and the unsupported package field. That usually means
the package encoder/decoder needs one more constructor or type case before the
new demo can run.

`build/fixtures/summary.json` also records imported IR declarations and native
extern dependencies per fixture. Use it to see whether a new fixture is growing
the package-backed imported closure or the explicit native boundary.

## Browser Entrypoints

Prefer `vir_eval_const_nat_string` for zero-argument `Nat` demos, since it also
handles values wider than 32 bits. If a demo needs browser-supplied input, add
a narrow export in `wasm/upstream_shim/shim.cpp` that constructs the Lean
argument object and then calls `lean::ir::run_boxed`. Keep the Lean declaration
itself in `examples/` and include it as a root in `tools/GeneratePackage.lean`.
