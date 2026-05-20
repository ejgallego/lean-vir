# JavaScript Runtime API

`web/src/vir-runtime.js` is a small ES module wrapper around the WASM exports.
It loads `vir-upstream.wasm`, loads an `.irpkg`, and exposes the currently
supported `Nat`-returning entry shapes without requiring callers to manage WASM
memory.

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

console.log(vir.evalConstNat("SortDemo.demo"));
console.log(vir.evalNatToNat("fib", 12));
console.log(vir.evalNatArrayToNat("SortDemo.demoFromArray", [4, 1, 3, 2]));
console.log(vir.evalStringToNat("Vir.Fixtures.Basic.stringUtf8RoundtripScore", "Aé∀Z"));
console.log(vir.evalByteArrayToNat("Vir.Fixtures.Basic.byteArrayInputScore", [65, 66, 67]));
```

There is also a minimal browser page at `/runtime-example.html` that imports the
runtime directly and prints the calls above.

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

## Supported Calls

- `vir.evalConstNat(name)` for `() -> Nat`.
- `vir.evalNatToNat(name, value)` for `Nat -> Nat`.
- `vir.evalNatArrayToNat(name, values)` for `Array Nat -> Nat`.
- `vir.evalStringToNat(name, value)` for `String -> Nat`.
- `vir.evalByteArrayToNat(name, values)` for `ByteArray -> Nat`.

All results are returned as decimal strings so large `Nat` results are not
truncated to JavaScript's safe integer range. Raw WASM exports remain available
as `vir.exports` for demo-specific calls that do not have a generic wrapper yet.

## Generate A Local Package

Generate a package from one Lean file and one or more root declarations:

```bash
npm run generate:irpkg -- examples/MergeSort.lean build/generated/local.irpkg SortDemo.demo
```

Or package every declaration emitted by that file:

```bash
npm run generate:irpkg -- examples/MergeSort.lean build/generated/local.irpkg
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

The runtime uses the static package-backed path. It does not load `.olean`,
`.ir`, or full Lean module data in the browser. Only the generic entry shapes
listed above are wrapped today; additional input or result types need matching
WASM exports in `wasm/upstream_shim/shim.cpp`.
