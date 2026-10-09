/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { createVirRuntime } from "../../web/src/vir-runtime-node.js";
import { createPrimitiveRuntimeFactory } from "../../web/src/runtime/primitive-factory.js";
import { INTERFACE_TAG } from "../../web/src/runtime/interface-tags.js";
import { assert, readFile, readRuntimeArtifacts } from "./shared.mjs";

const { wasmBytes: defaultWasmBytes, defaultPackageBytes } =
  await readRuntimeArtifacts();
const wasmBytes =
  process.argv[2] === undefined
    ? defaultWasmBytes
    : await readFile(process.argv[2]);
const huge = (1n << 256n) + 3n;
const cases = [
  [INTERFACE_TAG.NAT, [0n, 1n, (1n << 53n) - 1n, (1n << 53n) + 1n, huge]],
  [INTERFACE_TAG.INT, [0n, -1n, -(1n << 53n) - 1n, -huge, huge]],
  [INTERFACE_TAG.UINT64, [0n, 1n, 1n << 63n, (1n << 64n) - 1n]],
  [INTERFACE_TAG.USIZE, [0n, 1n, 1n << 31n, (1n << 32n) - 1n]],
];

for (const create of [
  () => createVirRuntime({ wasmBytes, irPackageSet: [defaultPackageBytes] }),
  () =>
    createPrimitiveRuntimeFactory({ wasmBytes }).createRuntime({
      irPackageSet: [defaultPackageBytes],
    }),
]) {
  const runtime = await create();
  try {
    for (const [interfaceTag, values] of cases) {
      const type = { interfaceTag };
      for (const value of values) {
        const inputs = [value, value.toString()];
        if (
          value >= BigInt(Number.MIN_SAFE_INTEGER) &&
          value <= BigInt(Number.MAX_SAFE_INTEGER)
        ) {
          inputs.push(Number(value));
        }
        for (const input of inputs) {
          const object = runtime.makeObjectValue(type, input, "number");
          try {
            assert.equal(
              runtime.liftObjectValue(type, object, "number"),
              interfaceTag === INTERFACE_TAG.USIZE ? Number(value) : value,
            );
          } finally {
            runtime.exports.vir_obj_dec(object);
          }
        }
      }
    }
    assert.equal(
      runtime.call("Vir.Fixtures.InterfaceShapes.baseNatBump", huge),
      huge + 1n,
    );
    assert.equal(
      runtime.call("Vir.Fixtures.InterfaceShapes.baseIntNegate", -huge),
      huge,
    );
    assert.equal(
      runtime.call("Vir.Fixtures.InterfaceShapes.baseNatBump", 0),
      1n,
    );
    assert.equal(runtime.failure, null);
  } finally {
    runtime.dispose();
  }
}

const runtime = await createVirRuntime({
  wasmBytes,
  irPackageSet: [defaultPackageBytes],
});
try {
  for (const sequenceKind of ["array", "list"]) {
    for (const [interfaceTag, values] of cases) {
      const element = { interfaceTag };
      const type =
        sequenceKind === "array"
          ? { interfaceTag: INTERFACE_TAG.ARRAY, element }
          : {
              ...runtime.findManifestEntry(
                "Vir.Fixtures.InterfaceShapes.listUInt32Sum",
              ).args[0].type,
              constructors: runtime
                .findManifestEntry("Vir.Fixtures.InterfaceShapes.listUInt32Sum")
                .args[0].type.constructors.map((ctor) => ({
                  ...ctor,
                  fields: ctor.fields.map((field, i) =>
                    i === 0 ? { ...field, type: element } : field,
                  ),
                })),
            };
      const object = runtime.makeObjectValue(type, values, "sequence");
      try {
        assert.deepEqual(
          runtime.liftObjectValue(type, object, "sequence"),
          interfaceTag === INTERFACE_TAG.USIZE ? values.map(Number) : values,
        );
      } finally {
        runtime.exports.vir_obj_dec(object);
      }
    }
  }
  const exprType = { interfaceTag: INTERFACE_TAG.EXPR };
  for (const [input, expected] of [
    [
      { kind: "bvar", index: 0 },
      { kind: "bvar", index: 0n },
    ],
    [
      {
        kind: "proj",
        typeName: "Prod",
        index: 1,
        struct: { kind: "bvar", index: 0 },
      },
      {
        kind: "proj",
        typeName: "Prod",
        index: 1n,
        struct: { kind: "bvar", index: 0n },
      },
    ],
    [
      { kind: "lit", literal: { kind: "nat", value: huge } },
      { kind: "lit", literal: { kind: "nat", value: huge } },
    ],
  ]) {
    const object = runtime.makeObjectValue(exprType, input, "Expr");
    try {
      assert.deepEqual(
        runtime.liftObjectValue(exprType, object, "Expr"),
        expected,
      );
    } finally {
      runtime.exports.vir_obj_dec(object);
    }
  }
} finally {
  runtime.dispose();
}

console.log(
  "numeric results smoke ok: full/primitive, exact stable types, sequences and Expr",
);
