/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { createVirRuntime } from "../../web/src/vir-runtime-node.js";
import { createPrimitiveRuntimeFactory } from "../../web/src/runtime/primitive-factory.js";
import { assert, manifestEntry, readFile, readRuntimeArtifacts } from "./shared.mjs";
import { arrayBoundary, primitiveBoundary } from "../support/interface-fixtures.mjs";

const { wasmBytes: defaultWasmBytes, defaultPackageBytes } =
  await readRuntimeArtifacts();
const wasmBytes =
  process.argv[2] === undefined
    ? defaultWasmBytes
    : await readFile(process.argv[2]);
const huge = (1n << 256n) + 3n;
const cases = [
  [primitiveBoundary("nat", "bigint"), [0n, 1n, (1n << 31n) - 1n, 1n << 31n,
    (1n << 32n) - 1n, (1n << 53n) - 1n, (1n << 53n) + 1n, 1n << 63n, huge]],
  [primitiveBoundary("int", "bigint"), [0n, -1n, -(1n << 53n) - 1n, -huge, huge]],
  [primitiveBoundary("unsigned", "bigint", { width: 64 }), [0n, 1n, 1n << 63n, (1n << 64n) - 1n]],
  [primitiveBoundary("unsigned", "number", { width: "usize" }), [0n, 1n, 1n << 31n, (1n << 32n) - 1n]],
];
const expected = (type, value) =>
  type.native.type.tag === "unsigned" && type.native.type.width === "usize"
    ? Number(value)
    : value;

for (const create of [
  () => createVirRuntime({ wasmBytes, irPackageSet: [defaultPackageBytes] }),
  () => createPrimitiveRuntimeFactory({ wasmBytes }).createRuntime({ irPackageSet: [defaultPackageBytes] }),
]) {
  const runtime = await create();
  try {
    for (const [type, values] of cases) {
      for (const value of values) {
        const inputs = [value, value.toString()];
        if (value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER))
          inputs.push(Number(value));
        for (const input of inputs) {
          const object = runtime.makeObjectValue(type, input, "number");
          try {
            assert.equal(runtime.liftObjectValue(type, object, "number"), expected(type, value));
          } finally {
            runtime.exports.vir_obj_dec(object);
          }
        }
      }
    }
    for (const value of cases[0][1])
      assert.equal(runtime.call("Vir.Fixtures.InterfaceShapes.baseNatBump", value), value + 1n);
    for (const invalid of [-1n, -1, Number.MAX_SAFE_INTEGER + 1, 1.5, NaN, Infinity])
      assert.throws(() => runtime.call("Vir.Fixtures.InterfaceShapes.baseNatBump", invalid),
        /non-negative|safe integer|decimal/);
    assert.equal(runtime.call("Vir.Fixtures.InterfaceShapes.baseIntNegate", -huge), huge);
    assert.equal(runtime.call("Vir.Fixtures.InterfaceShapes.baseNatBump", 0), 1n);
    assert.equal(runtime.failure, null);
  } finally {
    runtime.dispose();
  }
}

const runtime = await createVirRuntime({ wasmBytes, irPackageSet: [defaultPackageBytes] });
try {
  const listTemplate = manifestEntry(runtime.interfaceManifest, "Vir.Fixtures.InterfaceShapes.listUInt32Sum").args[0].type;
  for (const [type, values] of cases) {
    for (const sequence of [
      arrayBoundary(type.native, type.value),
      (() => {
        const list = structuredClone(listTemplate);
        list.native.metadata.constructors[1].fields[0].type = type.native;
        list.value.element = type.value;
        return list;
      })(),
    ]) {
      const object = runtime.makeObjectValue(sequence, values, "sequence");
      try {
        assert.deepEqual(runtime.liftObjectValue(sequence, object, "sequence"), values.map(value => expected(type, value)));
      } finally {
        runtime.exports.vir_obj_dec(object);
      }
    }
  }
  const exprArray = manifestEntry(runtime.interfaceManifest, "Vir.Fixtures.InterfaceShapes.arrayExprKindScore").args[0].type;
  const exprType = { native: exprArray.native.metadata.arrayElement, value: exprArray.value.element };
  for (const [input, result] of [
    [{ kind: "bvar", index: 0 }, { kind: "bvar", index: 0n }],
    [{ kind: "proj", typeName: "Prod", index: 1, struct: { kind: "bvar", index: 0 } },
      { kind: "proj", typeName: "Prod", index: 1n, struct: { kind: "bvar", index: 0n } }],
    [{ kind: "lit", literal: { kind: "nat", value: huge } }, { kind: "lit", literal: { kind: "nat", value: huge } }],
  ]) {
    const object = runtime.makeObjectValue(exprType, input, "Expr");
    try {
      assert.deepEqual(runtime.liftObjectValue(exprType, object, "Expr"), result);
    } finally {
      runtime.exports.vir_obj_dec(object);
    }
  }
} finally {
  runtime.dispose();
}

console.log("numeric results smoke ok: descriptor pairs, exact stable types, sequences and Expr");
