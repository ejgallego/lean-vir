# JavaScript Runtime API

`web/src/vir-runtime.js` is a small ES module wrapper around the WASM exports.
It loads `vir-upstream.wasm`, loads an `.irpkg`, and exposes the currently
supported `Nat` entry shapes without requiring callers to manage WASM memory.

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
```

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

- `vir.evalConstNat(name)` for `() -> Nat`;
- `vir.evalNatToNat(name, value)` for `Nat -> Nat`;
- `vir.evalNatArrayToNat(name, values)` for `Array Nat -> Nat`.

All results are returned as decimal strings so large `Nat` results are not
truncated to JavaScript's safe integer range. Raw WASM exports remain available
as `vir.exports` for demo-specific calls that do not have a generic wrapper yet.
