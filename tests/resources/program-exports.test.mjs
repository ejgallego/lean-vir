import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveProgramExports,
  snapshotExpectedExports,
} from "../../web/src/resources/program-exports.js";
import { interfaceSignatureKey } from "../../web/src/runtime/interface-manifest.js";
import {
  arrayBoundary,
  boundary,
  enumBoundary,
  immediateConstructor,
  nativeDescriptor,
  nativeField,
  objectBoundary,
  objectConstructor,
  primitiveBoundary,
  recursiveRef,
  resourceBoundary,
  unitBoundary,
} from "../support/interface-fixtures.mjs";

test("fully qualified declarations are the only root call keys", () => {
  const wrong = { entry: "Test.wrong" };
  const right = { entry: "Test.right" };
  const declarations = resolveProgramExports([wrong, right]);
  assert.equal(declarations.get("Test.right"), right);
  assert.equal(declarations.has("right"), false);
});

test("dependency-only declarations are not root entrypoints", () => {
  const manifests = [
    { exports: [{ entry: "Dependency.run" }] },
    { exports: [{ entry: "Root.run" }] },
  ];
  const expected = snapshotExpectedExports({
    "Dependency.run": {
      args: [], result: primitiveBoundary("nat", "bigint"), effect: "pure",
    },
  });
  assert.throws(
    () => resolveProgramExports(manifests.at(-1).exports, expected),
    /missing program export Dependency.run/,
  );
});

test("ambiguous root declarations fail instead of first-wins selection", () => {
  assert.throws(
    () => resolveProgramExports([{ entry: "Root.run" }, { entry: "Root.run" }]),
    /ambiguous/,
  );
});

const nat = primitiveBoundary("nat", "bigint");
const string = primitiveBoundary("string", "string");
const record = objectBoundary(
  "Segment",
  [objectConstructor("Segment.mk", {
    objectFieldCount: 2, usizeFieldCount: 0, scalarByteSize: 0,
  }, [
    nativeField("text", string.native, { tag: "object", index: 0 }),
    nativeField("indent", nat.native, { tag: "object", index: 1 }),
  ])],
  { tag: "record", fields: [
    { key: "text", path: [0], value: string.value },
    { key: "indent", path: [1], value: nat.value },
  ] },
);
const recursive = objectBoundary(
  "Tree",
  [
    immediateConstructor("Tree.nil"),
    objectConstructor("Tree.node", {
      objectFieldCount: 1, usizeFieldCount: 0, scalarByteSize: 0,
    }, [nativeField("next", recursiveRef(0), { tag: "object", index: 0 })]),
  ],
  { tag: "variant", cases: [
    { kind: "nil", payload: "none" },
    { kind: "node", payload: "value", value: { tag: "recursive" } },
  ] },
);

for (const [label, change] of [
  ["field location", (pair) => {
    const fields = pair.native.metadata.constructors[0].fields;
    [fields[0].location.index, fields[1].location.index] =
      [fields[1].location.index, fields[0].location.index];
  }],
  ["field order", (pair) => {
    pair.native.metadata.constructors[0].fields.reverse();
    pair.value.fields.reverse();
    for (const mapping of pair.value.fields) mapping.path[0] = 1 - mapping.path[0];
  }],
  ["field type", (pair) => {
    pair.native.metadata.constructors[0].fields[1].type =
      primitiveBoundary("int", "bigint").native;
  }],
]) {
  test(`actual native/value comparison rejects changed ${label}`, () => {
    const signature = { args: [nat], result: record, effect: "pure" };
    const expected = snapshotExpectedExports({ "Root.format": signature });
    const result = structuredClone(record);
    change(result);
    assert.throws(
      () => resolveProgramExports([{
        entry: "Root.format",
        args: [{ name: "n", type: nat }],
        result,
        effect: "pure",
      }], expected),
      /callable signature/,
    );
  });
}

test("constructor order, lexical recursion and callback effects are ABI facts", () => {
  const signature = { args: [], result: recursive, effect: "pure" };
  const key = interfaceSignatureKey(signature);
  const swapped = structuredClone(recursive);
  swapped.native.metadata.constructors.reverse();
  swapped.value.cases.reverse();
  assert.notEqual(
    interfaceSignatureKey({ ...signature, result: swapped }),
    key,
  );
  const badDepth = structuredClone(recursive);
  badDepth.native.metadata.constructors[1].fields[0].type.ref = 1;
  assert.throws(
    () => interfaceSignatureKey({ ...signature, result: badDepth }),
    /no enclosing recursive descriptor/,
  );

  const callback = boundary(
    nativeDescriptor("leanObject", {}, {
      signature: { args: [nat.native], result: nat.native, effect: "pure" },
    }),
    { tag: "function", args: [nat.value], result: nat.value },
  );
  assert.notEqual(
    interfaceSignatureKey({ ...signature, result: callback }),
    interfaceSignatureKey({
      ...signature,
      result: boundary(callback.native, { ...callback.value, result: { tag: "safeInteger" } }),
    }),
  );
  assert.equal(
    interfaceSignatureKey({ ...signature, result: callback }),
    interfaceSignatureKey({ ...signature, result: structuredClone(callback) }),
  );
});

test("signature identity is independent of JavaScript object key order", () => {
  const signature = { args: [record], result: nat, effect: "pure" };
  const reverseKeys = (value) =>
    Array.isArray(value)
      ? value.map(reverseKeys)
      : value && typeof value === "object"
        ? Object.fromEntries(Object.entries(value).reverse().map(([k, v]) => [k, reverseKeys(v)]))
        : value;
  assert.equal(
    interfaceSignatureKey(signature),
    interfaceSignatureKey({ ...signature, args: [reverseKeys(record)] }),
  );
});

test("core native kinds compose with distinct value mappings", () => {
  const treeSequence = arrayBoundary(recursive.native, recursive.value);
  const descriptors = [
    primitiveBoundary("nat", "bigint"),
    primitiveBoundary("nat", "safeInteger"),
    primitiveBoundary("int", "bigint"),
    primitiveBoundary("string", "string"),
    primitiveBoundary("byteArray", "bytes"),
    primitiveBoundary("unsigned", "number", { width: 8 }),
    primitiveBoundary("unsigned", "number", { width: 16 }),
    primitiveBoundary("unsigned", "number", { width: 32 }),
    primitiveBoundary("unsigned", "bigint", { width: 64 }),
    primitiveBoundary("unsigned", "number", { width: "usize" }),
    primitiveBoundary("float", "number", { width: 32 }),
    primitiveBoundary("float", "number", { width: 64 }),
    unitBoundary(),
    enumBoundary("Flag", ["off", "on"]),
    resourceBoundary(),
    record,
    treeSequence,
    recursive,
  ];
  const keys = descriptors.map((result) => interfaceSignatureKey({
    args: [], result, effect: "pure",
  }));
  assert.equal(keys.length, new Set(keys).size);
});
