/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { createVirRuntime } from "../../web/src/vir-runtime-node.js";
import { assert, readRuntimeArtifacts } from "./shared.mjs";
import {
  arrayBoundary,
  boundary,
  nativeDescriptor,
} from "../support/interface-fixtures.mjs";

const { wasmBytes, defaultPackageBytes } = await readRuntimeArtifacts();
const runtime = await createVirRuntime({ wasmBytes, irPackageSet: [defaultPackageBytes] });
const max64 = (1n << 64n) - 1n;
const max32 = (1n << 32n) - 1n;
const cases = [
  ["UInt64", 64, "bigint", max64,
    [0n, 1n, (1n << 32n) - 1n, 1n << 32n, (1n << 53n) - 1n, (1n << 53n) + 1n,
      (1n << 63n) - 1n, 1n << 63n, max64], "uint64Bump"],
  ["USize", "usize", "number", max32,
    [0n, 1n, (1n << 31n) - 1n, 1n << 31n, max32], "baseUSizeBump"],
];
const originalExports = runtime.exports;
const transport = { allocBytes: 0, freeBytes: 0, readWasmString: 0 };
const originalMethods = {};
for (const name of Object.keys(transport)) {
  originalMethods[name] = runtime[name];
  runtime[name] = function (...args) {
    transport[name]++;
    return originalMethods[name].apply(this, args);
  };
}

try {
  assert.equal(runtime.targetPointerBytes(), 4);
  runtime.exports = { ...originalExports };
  for (const [name, width, valueTag, max, values, entry] of cases) {
    const type = boundary(
      nativeDescriptor("unsigned", { width }),
      { tag: valueTag },
    );
    const inputs = values.flatMap(n => n <= BigInt(Number.MAX_SAFE_INTEGER)
      ? [n, String(n), Number(n)] : [n, String(n)]);
    inputs.push(-0, " 00041 ");
    for (const input of inputs) {
      for (const key of Object.keys(transport)) transport[key] = 0;
      const object = runtime.makeObjectValue(type, input, name);
      assert.notEqual(object, 0, "numeric zero still owns a live Lean box");
      try {
        assert.equal(runtime.exports.vir_obj_is_scalar(object), 0);
        const output = runtime.liftObjectValue(type, object, name);
        assert.equal(output, width === "usize" ? Number(BigInt(input)) : BigInt(input));
        assert.equal(typeof output, valueTag);
        assert.deepEqual(transport, { allocBytes: 0, freeBytes: 0, readWasmString: 0 });
      } finally {
        runtime.exports.vir_obj_dec(object);
      }
      assert.equal(runtime.call(`Vir.Fixtures.InterfaceShapes.${entry}`, input),
        width === "usize"
          ? Number((BigInt(input) + 1n) & max)
          : (BigInt(input) + 1n) & max);
    }

    const constructor = name === "UInt64" ? "vir_obj_uint64_scalar" : "vir_obj_usize_scalar";
    const make = runtime.exports[constructor];
    runtime.exports[constructor] = () => assert.fail("invalid input reached the scalar constructor");
    try {
      const coercible = { [Symbol.toPrimitive]() { assert.fail("must not coerce objects"); } };
      const invalidInputs = [-1, -1n, "-1", max + 1n, String(max + 1n), 1.25,
        Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, null, undefined, {}, [], true,
        Symbol("integer"), coercible, "", " ", "+1", "1e2", "0x10", "1.0"];
      if (max < BigInt(Number.MAX_SAFE_INTEGER)) invalidInputs.push(Number(max + 1n));
      for (const input of invalidInputs) {
        for (const key of Object.keys(transport)) transport[key] = 0;
        assert.throws(() => runtime.makeObjectValue(type, input, name), /must be|out of range/);
        assert.deepEqual(transport, { allocBytes: 0, freeBytes: 0, readWasmString: 0 });
      }
    } finally {
      runtime.exports[constructor] = make;
    }
    assert.equal(runtime.failure, null);
    assert.equal(runtime.call(`Vir.Fixtures.InterfaceShapes.${entry}`, max),
      width === "usize" ? 0 : 0n);
  }

  for (const entry of ["boxUInt64Bump", "uint64BoxBump"]) {
    assert.deepEqual(runtime.call(`Vir.Fixtures.InterfaceShapes.${entry}`, { value: max64 }), { value: 0n });
  }
  for (const width of [64, "usize"]) {
    const elementNative = nativeDescriptor("unsigned", { width });
    const type = arrayBoundary(elementNative, { tag: width === "usize" ? "number" : "bigint" });
    const values = width === 64 ? [0n, 1n << 63n, max64] : [0n, 1n << 31n, max32];
    const object = runtime.makeObjectValue(type, values, "nested");
    try {
      assert.deepEqual(runtime.liftObjectValue(type, object, "nested"),
        width === "usize" ? values.map(Number) : values);
    } finally {
      runtime.exports.vir_obj_dec(object);
    }
    // A later invalid element must release the already constructed elements.
    let releases = 0;
    runtime.exports.vir_obj_dec = object => { releases++; originalExports.vir_obj_dec(object); };
    try {
      assert.throws(() => runtime.makeObjectValue(type, [0n, -1n], "nested"), /non-negative/);
      assert.equal(releases, 1);
    } finally {
      runtime.exports.vir_obj_dec = originalExports.vir_obj_dec;
    }
  }

  const huge = (1n << 256n) + 3n;
  assert.equal(runtime.call("Vir.Fixtures.InterfaceShapes.baseNatBump", huge), huge + 1n);
  assert.equal(runtime.call("Vir.Fixtures.InterfaceShapes.baseIntNegate", -huge), huge);
} finally {
  runtime.exports = originalExports;
  Object.assign(runtime, originalMethods);
  runtime.dispose();
}

console.log("fixed-width smoke ok: exact numeric results, direct scalars and cleanup");
