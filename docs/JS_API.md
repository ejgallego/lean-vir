# JavaScript Runtime API

`web/src/vir-runtime.js` loads `vir-upstream.wasm`, loads a manifest-bearing
`.irpkg`, and exposes its Lean declarations through a generic JavaScript call
API without requiring callers to manage WASM memory.

The module is also exposed through the package entry point:

```js
import { createVirRuntime } from "lean-vir";
```

## Browser Usage

```js
import { createVirRuntime } from "./src/vir-runtime.js";

const vir = await createVirRuntime({
  wasmUrl: "vir-upstream.wasm",
  irPackageUrl: "vir-demo.irpkg",
});

console.log(vir.call("fib", 12));
console.log(vir.exportsByName.SortDemo_demo());
console.log(vir.exportsByName.SortDemo_demoFromArray([4, 1, 3, 2]));
console.log(vir.call("Vir.Fixtures.Basic.stringUtf8RoundtripScore", "Aé∀Z"));
console.log(vir.call("Vir.Fixtures.Basic.byteArrayInputScore", [65, 66, 67]));
console.log(vir.call("Tamagotchi.step", "happy", "ignore"));
console.log(vir.call("Vir.Fixtures.ExprPrinter.exprKindScore", { kind: "bvar", index: 4 }));
```

There is also a minimal browser page at `/runtime-example.html` that imports the
runtime directly and prints sample calls.

## Reusing The Compiled Module

Use a factory when creating multiple fresh interpreter instances from the same
WASM module:

```js
import { createVirRuntimeFactory, fetchBytes } from "./src/vir-runtime.js";

const factory = createVirRuntimeFactory({ wasmUrl: "vir-upstream.wasm" });
const irPackageBytes = await fetchBytes("vir-demo.irpkg");

const first = await factory.createRuntime({ irPackageBytes });
const second = await factory.createRuntime({ irPackageBytes });
```

## Calls And Manifest

- `vir.interfaceManifest` is the embedded package manifest.
- `vir.packageMetadata` is `vir.interfaceManifest.metadata`, including the
  package format version, Lean toolchain, generation time, source targets, and
  resolved roots.
- `vir.call(name, ...args)` accepts a manifest `id`, `jsName`, or Lean
  declaration name.
- `vir.exportsByName.<jsName>(...args)` exposes valid generated JS names as
  methods.
- `vir.packageInfo.interfaceExports` reports the number of generated exports.

Supported v1 types are `Nat`, `Int`, `Bool`, `String`, `UInt8`, `UInt16`,
`UInt32`, `UInt64`, `USize`, `ByteArray`, recursive `Array α`, `List α`,
`Option α`, `α × β`, `Sum α β`, and `Except ε α` shapes over supported types,
non-indexed user-defined structures including parameterized instances, nullary
inductive enums, and `Lean.Expr`.

Large exact integer values are returned as decimal strings. ByteArray results
are returned as `Uint8Array`.
Direct top-level `UInt64` arguments/results currently fail package generation
with an explicit wasm32 boundary diagnostic; nested `UInt64` fields and
compound values remain supported.

Nullary inductive enums are accepted as constructor names, generated JavaScript
names, or constructor indexes. Results are returned as the constructor's
generated JavaScript name.

Options are accepted as `null`, `{ kind: "none" }`, `{ kind: "some", value }`,
`{ some: value }`, or the bare inner value. Option results are returned as
`null` or the inner value. Product inputs are accepted as `{ fst, snd }` or
two-element arrays, and results are returned as `{ fst, snd }`.
`Sum`/`Except` inputs are accepted as `{ kind, value }`, `{ tag, value }`, or
single-constructor-key objects such as `{ inl: 4 }` and `{ ok: value }`;
results are returned as `{ kind, value }`. Non-indexed
structures, including parameterized instances like `Box Nat` and
`Tagged (Array String)`, are accepted and returned as objects keyed by their
Lean field names; inherited parent fields are accepted and returned as flattened
object keys. Direct `Bool`, `UInt*`, `USize`, and enum fields, including
single-field wrappers such as `Box UInt32`, use the same JS values as standalone
arguments/results. These shapes can be nested, for example `Option (Array Nat)`,
`List (Nat × String)`, `Except String (Option (Sum Nat Nat))`, a structure
containing another structure, and `Array Lean.Expr`.

`Lean.Expr` values use structural JavaScript objects such as
`{ kind: "const", name: "Nat", levels: [] }`,
`{ kind: "app", fn, arg }`, or `{ kind: "bvar", index: 0 }`. Level values use
the same shape with `kind` values `zero`, `succ`, `max`, `imax`, `param`, and
`mvar`. Metadata expression inputs are accepted by decoding their inner
expression; metadata results preserve a structural `mdata` wrapper.

Package loading validates the embedded interface manifest before any generated
entry is exposed. Malformed type trees, invalid structure layouts, unsupported
wire tags, duplicate export names, and bad enum constructor metadata are
reported as package-load errors.

## Generate A Local Package

Generate a package from one Lean file and one or more root declarations:

```bash
npm run generate:irpkg -- examples/MergeSort.lean build/generated/local.irpkg SortDemo.demo
```

Omit roots to auto-discover public source definitions:

```bash
npm run generate:irpkg -- examples/Fib.lean build/generated/fib.irpkg
```

The command prints the package path, report path, package format, toolchain,
declaration count, interface export count, and target roots. The same summary
is embedded in the manifest metadata so JavaScript and `/dev.html` can show
exactly what was loaded.

Inspect the embedded manifest without loading the browser:

```bash
npm run inspect:irpkg -- build/generated/fib.irpkg
```

Serve the generated `.irpkg` next to `vir-upstream.wasm`, or upload it through
`/dev.html` while iterating locally. The runtime only needs URLs or bytes for
the two assets:

```js
const vir = await createVirRuntime({
  wasmUrl: "/vir-upstream.wasm",
  irPackageUrl: "/my-package.irpkg",
});
```

## Current Limits

The runtime uses the single-file declaration package path. It does not load
`.olean`, `.ir`, or full Lean module data in the browser. Unsupported requested
exports fail during package generation instead of being omitted silently, and a
failed package load clears the runtime's package metadata instead of leaving
stale declarations callable.
