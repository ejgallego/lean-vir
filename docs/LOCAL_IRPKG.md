# Local IR Packages

The browser demo normally loads `web/public/vir-demo.irpkg`, which is generated
from the demo examples plus the fixture manifest. For focused development, use
the local package utility to generate a smaller package from one Lean file and
load it in `/dev.html`.

For a config-driven path that also writes a browser input spec, see
`docs/INTERFACE_PIPELINE.md`.

## Generate A Package

Package the transitive closure for one or more explicit roots:

```bash
npm run generate:irpkg -- examples/MergeSort.lean build/generated/local.irpkg SortDemo.demo
```

Package every IR declaration emitted for the source:

```bash
npm run generate:irpkg -- examples/MergeSort.lean build/generated/local.irpkg
```

Both commands also write a report next to the package, for example
`build/generated/local.report.md`. The report lists:

- root declarations;
- packaged IR declarations;
- explicit native extern declarations;
- missing IR declarations;
- missing native extern registrations;
- unsupported initializer globals.

The all-declarations mode is useful when iterating on one file and avoiding root
bookkeeping. Explicit roots are better when measuring package size or narrowing a
specific closure.

To produce both a package and URL-loadable input spec for `/dev.html`, use:

```bash
npm run prepare:irpkg -- examples/fib.virpkg.json
```

## Load The Package

Start the local server:

```bash
npm run dev
```

Open `/dev.html`. The page creates a fresh WASM instance, loads the selected
`.irpkg`, and evaluates entries described by the input spec.

There are two loading paths:

- Upload a package file, which is the simplest way to test packages under
  `build/generated/`.
- Load a package URL, which is relative to Vite's served assets. For example,
  `vir-demo.irpkg` resolves to `web/public/vir-demo.irpkg`. A generated package
  under `build/generated/` is not served by URL unless it is copied into
  `web/public/` or otherwise exposed by the dev server.

The input spec has the same two loading paths: edit the JSON directly, load a
spec URL such as `local-fib.input.json`, or upload a JSON file.

The package runner also accepts URL parameters:

```text
dev.html?package=local-fib.irpkg&spec=local-fib.input.json&entry=fib
```

`npm run build:site` uses that form for the hosted Pages landing links after it
generates the `fib` and `mergesort` sample packages with `npm run
prepare:pages`.

## Input Spec

The input spec is JSON. It is intentionally separate from the package: the
package contains declarations, while the spec describes which entry points the
developer page should expose and how to marshal browser input.

Example:

```json
{
  "version": 1,
  "entries": [
    {
      "id": "constant",
      "entry": "SortDemo.demo",
      "result": { "type": "Nat" },
      "inputs": []
    },
    {
      "id": "fib",
      "entry": "fib",
      "result": { "type": "Nat" },
      "inputs": [
        {
          "name": "n",
          "type": "Nat",
          "defaultValue": "8",
          "min": 0,
          "max": 17
        }
      ]
    },
    {
      "id": "sort",
      "entry": "SortDemo.demoFromArray",
      "result": { "type": "Nat" },
      "inputs": [
        {
          "name": "values",
          "type": "Array Nat",
          "defaultValue": "7, 3, 9, 1, 4, 1, 5, 2",
          "maxItems": 16,
          "maxValue": 9999
        }
      ]
    }
  ]
}
```

Supported entry shapes:

- `() -> Nat`, marshaled through `vir_eval_const_nat_string`;
- `Nat -> Nat`, marshaled through `vir_eval_nat_to_nat_string`;
- `Array Nat -> Nat`, marshaled through `vir_eval_nat_array_to_nat_string`.

`Nat` inputs are decimal strings. `Array Nat` inputs are comma- or
whitespace-separated decimal strings. The optional `min`, `max`, `maxItems`, and
`maxValue` fields are UI-side guardrails; the Lean function still receives the
normalized value after parsing.

## Current Scope

This is still the static package-backed path. It does not load `.olean`, `.ir`,
or full Lean module data. The package generator elaborates the source with Lean
4.30-rc2, extracts typed `Lean.IR.Decl` values, and writes the current demo
package format. The WASM side decodes that package into real Lean IR objects and
serves them through `lean_ir_find_env_decl`.

The generic developer entry point currently supports zero or one browser input,
and only `Nat` results. More input types should be added by extending the input
spec and adding a narrow WASM export that constructs the corresponding Lean
object before calling the upstream IR interpreter.
