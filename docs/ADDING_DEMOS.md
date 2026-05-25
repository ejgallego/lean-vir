# Adding Demos

The demo package is intentionally small: Lean examples are elaborated locally,
their typed `Lean.IR.Decl` closure is written to `build/generated/vir-demo.irpkg`,
and the browser loads that package without rebuilding the upstream interpreter.

## Workflow

1. Add or edit a Lean source under `examples/`.
2. Add exported roots to `scripts/generate-browser-package.mjs`; use
   `packageOnly` only for internal roots that are needed by the demo but should
   not become JS interface exports.
3. Run `npm run check:package`.
4. Inspect `build/generated/ir-provider-report.md`.
5. Run `npm run check:boundary-registry` if you add or change a native extern.
6. Run `npm test`.
7. Update `web/` only if the demo needs new UI.

Most example-only edits should only regenerate `web/public/vir-demo.irpkg`.
They should not recompile or relink `ir_interpreter.cpp`.

## Local Package Runner

For a narrower developer loop, generate a package from a single Lean file:

```bash
npm run generate:irpkg -- examples/MergeSort.lean build/generated/local.irpkg SortDemo.demo
```

When no roots are supplied, the utility packages public source definitions:

```bash
npm run generate:irpkg -- examples/MergeSort.lean build/generated/local.irpkg
```

Run `npm run dev` and open `/dev.html` to load a served package URL or upload the
generated `.irpkg`; the page reads the embedded interface manifest and generates
entry controls automatically.
See `docs/LOCAL_IRPKG.md` for the full local package workflow and current
limitations.

For a reproducible local setup, prefer `npm run prepare:irpkg -- <config.json>`.
The example configs under `examples/*.virpkg.json` generate manifest-bearing
`.irpkg` files that `/dev.html` can load by URL.

## Reading The Report

The generated report has separate sections for the two common failure modes:

- `Missing IR Declarations`: a root or dependency was not found in the
  generated example declarations.
- `Missing Native Extern Registrations`: the closure references a primitive or
  runtime-backed function that needs an explicit demo shim registration.
- `Unsupported Init Globals`: the closure reached a nullary declaration emitted
  from Lean initialization code whose body is top-level `unreachable`; these
  need an initialized-global provider rather than another normal IR declaration.
- `Interface Diagnostics`: a requested export could not be mapped to the
  supported JavaScript interface surface. This is a loud failure; explicitly
  exclude or keep such declarations package-only if they are internal support
  roots.

If the package generator reaches an unsupported IR shape, it reports the
declaration being encoded and the unsupported package field. That usually means
the package encoder/decoder needs one more constructor or type case before the
new demo can run.

`build/fixtures/summary.json` also records imported IR declarations and native
extern dependencies per fixture. Use it to see whether a new fixture is growing
the package-backed imported closure or the explicit native boundary.

## Browser Entrypoints

Prefer the manifest-driven `vir.call(name, ...args)` API in
`web/src/vir-runtime.js`. If a demo needs another browser-supplied input or
result shape, extend the manifest type classifier and the generic call encoder
in `wasm/upstream_shim/shim.cpp`. Keep the Lean declaration itself in
`examples/` and include it as an exported root. Do not add per-function or
per-shape WASM exports for manifest-supported declarations; unsupported entries
should fail during package generation until their interface type is implemented.

The current generic interface covers primitive scalars, byte arrays, recursive
`Array`/`List`/`Option`/`Prod` shapes, non-indexed user-defined structures
including parameterized instances, nullary inductive enums, and structural
`Lean.Expr` values. For enums, no per-demo code is needed: the generator records
the constructor list in the package manifest and `/dev.html` renders a select
control from that manifest after the package is loaded.
