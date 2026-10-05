/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { createVirRuntime } from "../../web/src/vir-runtime-node.js";
import { INTERFACE_TAG } from "../../web/src/runtime/interface-tags.js";
import { assert, readRuntimeArtifacts } from "./shared.mjs";

const { wasmBytes, defaultPackageBytes } = await readRuntimeArtifacts();
const runtime = await createVirRuntime({ wasmBytes, irPackageSet: [defaultPackageBytes] });
const max64 = (1n << 64n) - 1n;
const max32 = (1n << 32n) - 1n;
const cases = [
  ["UInt64", INTERFACE_TAG.UINT64, max64,
    [0n, 1n, (1n << 32n) - 1n, 1n << 32n, (1n << 53n) - 1n, (1n << 53n) + 1n,
      (1n << 63n) - 1n, 1n << 63n, max64], "uint64Bump"],
  ["USize", INTERFACE_TAG.USIZE, max32,
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
  // Keep legacy exports callable, but forbid their use by the ordinary codec.
  runtime.exports = { ...originalExports };
  for (const name of ["vir_obj_uint64", "vir_obj_uint64_decimal", "vir_obj_usize", "vir_obj_usize_decimal"]) {
    runtime.exports[name] = () => assert.fail(`ordinary codec called ${name}`);
  }
  for (const [name, interfaceTag, max, values, entry] of cases) {
    const type = { type: name, interfaceTag };
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
        assert.equal(output, BigInt(input).toString());
        assert.equal(typeof output, "string");
        assert.deepEqual(transport, { allocBytes: 0, freeBytes: 0, readWasmString: 0 });
      } finally {
        runtime.exports.vir_obj_dec(object);
      }
      assert.equal(runtime.call(`Vir.Fixtures.InterfaceShapes.${entry}`, input),
        ((BigInt(input) + 1n) & max).toString());
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
    assert.equal(runtime.call(`Vir.Fixtures.InterfaceShapes.${entry}`, max), "0");
  }

  for (const entry of ["boxUInt64Bump", "uint64BoxBump"]) {
    assert.deepEqual(runtime.call(`Vir.Fixtures.InterfaceShapes.${entry}`, { value: max64 }), { value: "0" });
  }
  for (const interfaceTag of [INTERFACE_TAG.UINT64, INTERFACE_TAG.USIZE]) {
    const type = { interfaceTag: INTERFACE_TAG.ARRAY, element: { interfaceTag } };
    const values = interfaceTag === INTERFACE_TAG.UINT64 ? [0n, 1n << 63n, max64] : [0n, 1n << 31n, max32];
    const object = runtime.makeObjectValue(type, values, "nested");
    try {
      assert.deepEqual(runtime.liftObjectValue(type, object, "nested"), values.map(String));
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

  // Legacy text entrypoints retain their signatures, range errors and ownership.
  runtime.exports = originalExports;
  for (const [name, _tag, max] of cases) {
    const prefix = name === "UInt64" ? "vir_obj_uint64" : "vir_obj_usize";
    for (const input of ["0", String(max), String(max + 1n), "-1", "invalid"]) {
      const bytes = new TextEncoder().encode(input);
      const ptr = runtime.allocBytes(bytes);
      try {
        const object = originalExports[prefix](ptr, bytes.length);
        if (input === "0" || input === String(max)) {
          assert.notEqual(object, 0);
          try { assert.equal(runtime.readObjectDecimal(object, `${prefix}_decimal`), input); }
          finally { originalExports.vir_obj_dec(object); }
        } else {
          assert.equal(object, 0);
        }
      } finally { runtime.freeBytes(ptr); }
    }
  }
  const huge = (1n << 256n) + 3n;
  assert.equal(runtime.call("Vir.Fixtures.InterfaceShapes.baseNatBump", huge), String(huge + 1n));
  assert.equal(runtime.call("Vir.Fixtures.InterfaceShapes.baseIntNegate", -huge), String(huge));
} finally {
  runtime.exports = originalExports;
  Object.assign(runtime, originalMethods);
  runtime.dispose();
}

console.log("fixed-width smoke ok: exact String results, direct scalars, legacy text ABI and cleanup");
