/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { createVirRuntime as createExportedVirRuntime } from "lean-vir";
import { createVirRuntime, createVirRuntimeFactory } from "../web/src/vir-runtime.js";

const wasmBytes = await readFile(new URL("../web/public/vir-upstream.wasm", import.meta.url));
const irPackageBytes = await readFile(new URL("../web/public/vir-demo.irpkg", import.meta.url));

const runtime = await createVirRuntime({ wasmBytes, irPackageBytes });
assert.equal(createExportedVirRuntime, createVirRuntime);
assert.equal(runtime.targetPointerBytes(), 4);
assert.ok(runtime.packageInfo.count > 0, "expected IR package to load declarations");
assert.equal(runtime.packageInfo.byteLength, irPackageBytes.byteLength);
assert.equal(runtime.evalConstNat("SortDemo.demo"), "192");
assert.equal(runtime.evalNatToNat("fib", 12), "144");
assert.equal(runtime.evalNatArrayToNat("SortDemo.demoFromArray", [4, 1, 3, 2]), "30");
assert.equal(runtime.evalStringToNat("Vir.Fixtures.Basic.stringUtf8RoundtripScore", "Aé∀Z"), "1381");
assert.equal(runtime.evalByteArrayToNat("Vir.Fixtures.Basic.byteArrayInputScore", [65, 66, 67]), "136");

const factory = createVirRuntimeFactory({ wasmBytes });
const first = await factory.createRuntime({ irPackageBytes });
const second = await factory.createRuntime({ irPackageBytes });
assert.equal(first.evalConstNat("SortDemo.demo"), "192");
assert.equal(second.evalNatToNat("fib", 8), "21");

const badPackageRuntime = await factory.createRuntime();
const badPackage = Uint8Array.from([
  3, 0, 0, 0, 98, 97, 100,
  1, 0, 0, 0,
  0, 0, 0, 0,
]);
assert.throws(
  () => badPackageRuntime.loadIrPackageBytes(badPackage),
  /invalid IR package magic/,
);

assert.throws(
  () => runtime.evalNatToNat("fib", -1),
  /value must be an integer in 0\.\.4294967295/,
);

console.log(
  `vir runtime smoke ok: ${runtime.packageInfo.count} declarations, SortDemo.demo = 192, fib 12 = 144`,
);
