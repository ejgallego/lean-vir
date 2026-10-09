import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveProgramExports,
  snapshotExpectedExports,
} from "../../web/src/resources/program-exports.js";
import { interfaceSignatureKey } from "../../web/src/runtime/interface-manifest.js";
import { INTERFACE_TAG } from "../../web/src/runtime/interface-tags.js";

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
      args: [],
      result: { type: "Nat", interfaceTag: 0 },
      effect: "pure",
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

const nat = { type: "Nat", interfaceTag: 0 };
const record = {
  type: "Segment",
  interfaceTag: 20,
  kind: "structure",
  name: "Segment",
  objectFieldCount: 2,
  usizeFieldCount: 0,
  scalarByteSize: 0,
  fields: [
    {
      name: "text",
      type: { type: "String", interfaceTag: 3 },
      layout: { kind: "object", index: 0 },
    },
    { name: "indent", type: nat, layout: { kind: "object", index: 1 } },
  ],
};
const recursive = {
  type: "Tree",
  interfaceTag: 25,
  kind: "customInductive",
  name: "Tree",
  constructors: [
    {
      name: "Tree.nil",
      jsName: "nil",
      tag: 0,
      objectFieldCount: 0,
      usizeFieldCount: 0,
      scalarByteSize: 0,
      fields: [],
    },
    {
      name: "Tree.node",
      jsName: "node",
      tag: 1,
      objectFieldCount: 1,
      usizeFieldCount: 0,
      scalarByteSize: 0,
      fields: [
        {
          name: "next",
          type: {
            type: "Tree",
            interfaceTag: 26,
            kind: "recursiveRef",
            depth: 0,
            name: "Tree",
          },
          layout: { kind: "object", index: 0 },
        },
      ],
    },
  ],
};

for (const [label, change] of [
  [
    "field layout",
    (type) => {
      type.fields[0].layout.index = 1;
      type.fields[1].layout.index = 0;
    },
  ],
  [
    "field order",
    (type) => {
      type.fields.reverse();
    },
  ],
  [
    "field type",
    (type) => {
      type.fields[1].type = { type: "Bool", interfaceTag: 2 };
    },
  ],
  [
    "runtime counts",
    (type) => {
      type.objectFieldCount = 3;
    },
  ],
  [
    "trivial representation",
    (type) => {
      type.trivialFieldIndex = 0;
    },
  ],
])
  test(`actual ABI comparison rejects ${label}`, () => {
    const signature = { args: [nat], result: record, effect: "pure" };
    const expected = snapshotExpectedExports({ "Root.format": signature });
    const result = structuredClone(record);
    change(result);
    assert.throws(
      () =>
        resolveProgramExports(
          [
            {
              entry: "Root.format",
              args: [{ name: "n", type: nat }],
              result,
              effect: "pure",
            },
          ],
          expected,
        ),
      /callable signature/,
    );
  });

test("constructor order, recursive identity and callback effects are ABI facts", () => {
  const signature = { args: [], result: recursive, effect: "pure" };
  const key = interfaceSignatureKey(signature);
  const swapped = structuredClone(recursive);
  swapped.constructors.reverse();
  swapped.constructors.forEach((ctor, i) => {
    ctor.tag = i;
  });
  assert.notEqual(
    interfaceSignatureKey({ ...signature, result: swapped }),
    key,
  );
  const wrongOwner = structuredClone(recursive);
  wrongOwner.constructors[1].fields[0].type.name = "Other";
  assert.throws(
    () => interfaceSignatureKey({ ...signature, result: wrongOwner }),
    /must match/,
  );
  assert.throws(
    () =>
      interfaceSignatureKey({
        ...signature,
        result: recursive.constructors[1].fields[0].type,
      }),
    /no enclosing recursive descriptor/,
  );
  const callback = {
    type: "Nat -> Nat",
    interfaceTag: 24,
    kind: "function",
    effect: "pure",
    args: [{ name: "n", type: nat }],
    result: nat,
  };
  assert.notEqual(
    interfaceSignatureKey({ ...signature, result: callback }),
    interfaceSignatureKey({
      ...signature,
      result: { ...callback, effect: "io" },
    }),
  );
  assert.equal(
    interfaceSignatureKey({ ...signature, result: callback }),
    interfaceSignatureKey({
      ...signature,
      result: {
        ...callback,
        args: [{ name: "ignored display name", type: nat }],
      },
    }),
  );
});

test("lexical recursion depth is checked at manifest admission", () => {
  for (const depth of [-1, 0.5, 1, undefined]) {
    const result = structuredClone(recursive);
    result.constructors[1].fields[0].type.depth = depth;
    assert.throws(() => interfaceSignatureKey({ args: [], result, effect: "pure" }),
      /depth.*(?:non-negative 32-bit integer|no enclosing recursive descriptor)/);
  }
  for (const interfaceTag of [17, 18, 19]) {
    assert.throws(() => interfaceSignatureKey({ args: [], result: { type: "retired container", interfaceTag }, effect: "pure" }),
      /interfaceTag is not supported/);
  }
});

test("structural key ignores key order/diagnostics but retains field names", () => {
  const signature = { args: [record], result: nat, effect: "pure" };
  // Reorder each JSON object without changing ordered arrays.
  const reverseKeys = (value) =>
    Array.isArray(value)
      ? value.map(reverseKeys)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value)
              .reverse()
              .map(([k, v]) => [k, reverseKeys(v)]),
          )
        : value;
  assert.equal(
    interfaceSignatureKey(signature),
    interfaceSignatureKey({ ...signature, args: [reverseKeys(record)] }),
  );
  assert.equal(
    interfaceSignatureKey(signature),
    interfaceSignatureKey({
      ...signature,
      args: [{ ...record, diagnostics: ["ignored"], timestamp: "ignored" }],
    }),
  );
  const renamed = structuredClone(record);
  renamed.fields[0].name = "different";
  assert.notEqual(
    interfaceSignatureKey(signature),
    interfaceSignatureKey({ ...signature, args: [renamed] }),
  );
});

test("every current interface tag has an explicit comparison rule", () => {
  const scalar = ["NAT", "INT", "BOOL", "STRING", "UINT8", "UINT16", "UINT32", "UINT64", "USIZE", "BYTE_ARRAY", "FLOAT", "FLOAT32", "EXPR", "UNIT"];
  const descriptors = scalar.map(name => ({ type: name, interfaceTag: INTERFACE_TAG[name] }));
  const enumCtor = { name: "Flag.off", jsName: "off", tag: 0 };
  descriptors.push(
    { type: "Flag", interfaceTag: 14, kind: "simpleEnum", constructors: [enumCtor] },
    ...[16].map(interfaceTag => ({ type: "container Nat", interfaceTag, element: nat })),
    record,
    { type: "Choice", interfaceTag: 21, kind: "taggedUnion", name: "Choice", constructors: [{ ...enumCtor, objectFieldCount: 1, usizeFieldCount: 0, scalarByteSize: 0, layout: { kind: "object", index: 0 }, type: nat }] },
    { type: "Js Unit", interfaceTag: 23, kind: "resource", name: "Js" },
    { type: "Nat -> Nat", interfaceTag: 24, kind: "function", args: [{ name: "n", type: nat }], result: nat, effect: "pure" },
    recursive,
    { type: "Expr", interfaceTag: 27, kind: "leanObject" },
  );
  const seen = new Set();
  for (const type of descriptors) {
    assert.equal(typeof interfaceSignatureKey({ args: [], result: type, effect: "pure" }), "string");
    seen.add(type.interfaceTag);
  }
  seen.add(26); // recursiveRef is exercised inside its owning custom descriptor above.
  assert.deepEqual([...seen].sort((a, b) => a - b), Object.values(INTERFACE_TAG).sort((a, b) => a - b));
});
