/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { createVirRuntime } from "../../web/src/vir-runtime-node.js";
import { assert, manifestEntry, readRuntimeArtifacts } from "./shared.mjs";

const { wasmBytes, defaultPackageBytes, leanPackageBytes } =
  await readRuntimeArtifacts();
const runtime = await createVirRuntime({
  wasmBytes,
  irPackageSet: [defaultPackageBytes],
});
const leanRuntime = await createVirRuntime({
  wasmBytes,
  irPackageSet: [leanPackageBytes],
});

assert.equal(
  leanRuntime.call("Vir.Fixtures.JsonCompress.jsonCompressObj"),
  '{"ok":true}',
);
assert.equal(
  leanRuntime.call("Vir.Fixtures.JsonCompress.jsonCompressWrapperObj"),
  '{"ok":true,"segments":["alpha","beta"]}',
);
assert.deepEqual(leanRuntime.call("Vir.Fixtures.ExprPrinter.constNatExpr"), {
  kind: "const",
  name: "Nat",
  levels: [],
});
assert.deepEqual(leanRuntime.call("Vir.Fixtures.ExprPrinter.twoLitExpr"), {
  kind: "lit",
  literal: { kind: "nat", value: 2n },
});
assert.deepEqual(leanRuntime.call("Vir.Fixtures.ExprPrinter.appExpr"), {
  kind: "app",
  fn: { kind: "const", name: "Nat.succ", levels: [] },
  arg: { kind: "lit", literal: { kind: "nat", value: 2n } },
});
assert.deepEqual(leanRuntime.call("Vir.Fixtures.ExprPrinter.sortParamExpr"), {
  kind: "sort",
  level: { kind: "succ", of: { kind: "param", name: "u" } },
});
assert.deepEqual(leanRuntime.call("Vir.Fixtures.ExprPrinter.fvarExpr"), {
  kind: "fvar",
  name: "x",
});
assert.deepEqual(
  leanRuntime.call("Vir.Fixtures.ExprPrinter.anonymousNameExpr"),
  {
    kind: "fvar",
    name: "[anonymous]",
  },
);
assert.deepEqual(leanRuntime.call("Vir.Fixtures.ExprPrinter.unicodeNameExpr"), {
  kind: "fvar",
  name: "αβ₁",
});
for (const entry of [
  "numeralNameExpr",
  "largeNumeralNameExpr",
  "dottedStringNameExpr",
  "emptyComponentNameExpr",
  "escapedNameExpr",
]) {
  assert.throws(
    () => leanRuntime.call(`Vir.Fixtures.ExprPrinter.${entry}`),
    /unsupported numeric, escaped, empty, or non-identifier components/,
    `expected ${entry} to be rejected by the raw Name getter`,
  );
}
assert.deepEqual(leanRuntime.call("Vir.Fixtures.ExprPrinter.mvarExpr"), {
  kind: "mvar",
  name: "m",
});
assert.deepEqual(leanRuntime.call("Vir.Fixtures.ExprPrinter.lambdaExpr"), {
  kind: "lam",
  name: "x",
  type: { kind: "const", name: "Nat", levels: [] },
  body: { kind: "bvar", index: 0n },
  binderInfo: "default",
});
assert.deepEqual(leanRuntime.call("Vir.Fixtures.ExprPrinter.forallExpr"), {
  kind: "forall",
  name: "x",
  type: { kind: "const", name: "Nat", levels: [] },
  body: { kind: "bvar", index: 0n },
  binderInfo: "implicit",
});
assert.deepEqual(leanRuntime.call("Vir.Fixtures.ExprPrinter.letExpr"), {
  kind: "let",
  name: "x",
  type: { kind: "const", name: "Nat", levels: [] },
  value: { kind: "lit", literal: { kind: "nat", value: 2n } },
  body: { kind: "bvar", index: 0n },
  nondep: false,
});
assert.deepEqual(leanRuntime.call("Vir.Fixtures.ExprPrinter.stringLitExpr"), {
  kind: "lit",
  literal: { kind: "string", value: "hi" },
});
assert.deepEqual(leanRuntime.call("Vir.Fixtures.ExprPrinter.mdataExpr"), {
  kind: "mdata",
  expr: { kind: "bvar", index: 0n },
});
assert.deepEqual(leanRuntime.call("Vir.Fixtures.ExprPrinter.projExpr"), {
  kind: "proj",
  typeName: "Prod",
  index: 1n,
  struct: { kind: "const", name: "p", levels: [] },
});
assert.equal(
  leanRuntime.call("Vir.Fixtures.ExprPrinter.exprCoverageScore"),
  1232n,
);
assert.equal(leanRuntime.call("Vir.Fixtures.ExprPrinter.exprKindScore", {
  kind: "bvar", index: 1048574,
}), 1048575n);
for (const index of [1048575, "18446744073709551615", "18446744073709551616", "9".repeat(200)]) {
  assert.throws(() => leanRuntime.call("Vir.Fixtures.ExprPrinter.exprKindScore", {
    kind: "bvar", index,
  }), /maximum index 1048574/);
  assert.equal(leanRuntime.failure, null, "invalid JS input must not trap the interpreter");
  const bytes = new TextEncoder().encode(String(index));
  const ptr = leanRuntime.allocBytes(bytes);
  try {
    assert.equal(leanRuntime.exports.vir_obj_expr_bvar(ptr, bytes.length), 0,
      "raw ABI also rejects indices outside the kernel's cached range");
  } finally {
    leanRuntime.freeBytes(ptr);
  }
}
assert.equal(
  leanRuntime.call("Vir.Fixtures.ExprPrinter.exprKindScore", {
    kind: "bvar",
    index: 4,
  }),
  5n,
);
assert.equal(
  leanRuntime.call("Vir.Fixtures.ExprPrinter.exprKindScore", {
    kind: "lit",
    literal: { kind: "nat", value: 2 },
  }),
  102n,
);
assert.deepEqual(
  leanRuntime.call("Vir.Fixtures.ExprPrinter.bumpBVar", {
    kind: "bvar",
    index: 4,
  }),
  {
    kind: "bvar",
    index: 5n,
  },
);
assert.deepEqual(runtime.call("Vir.Fixtures.ListOption.classifySum", 0), {
  kind: "inl",
  value: 10n,
});
assert.deepEqual(runtime.call("Vir.Fixtures.ListOption.classifySum", 4), {
  kind: "inr",
  value: 4n,
});
assert.equal(
  runtime.call("Vir.Fixtures.ListOption.sumScore", { kind: "inr", value: 7 }),
  70n,
);
assert.equal(
  runtime.call("Vir.Fixtures.ListOption.sumScore", {
    kind: "inl",
    value: 12,
  }),
  12n,
);
assert.deepEqual(runtime.call("Vir.Fixtures.ListOption.classifyExcept", 0), {
  kind: "error",
  value: 90n,
});
assert.deepEqual(runtime.call("Vir.Fixtures.ListOption.classifyExcept", 5), {
  kind: "ok",
  value: {
    kind: "some",
    value: { kind: "inr", value: 5n },
  },
});
assert.equal(
  runtime.call("Vir.Fixtures.InterfaceShapes.baseUnitRoundtrip", undefined),
  undefined,
);
assert.equal(
  runtime.call("Vir.Fixtures.InterfaceShapes.baseBoolFlip", true),
  false,
);
assert.equal(
  runtime.call("Vir.Fixtures.InterfaceShapes.baseNatBump", 41),
  42n,
);
assert.equal(
  runtime.call("Vir.Fixtures.InterfaceShapes.baseIntNegate", -41),
  41n,
);
assert.equal(
  runtime.call("Vir.Fixtures.InterfaceShapes.baseStringRoundtrip", "ok"),
  "ok",
);
assert.equal(
  runtime.call("Vir.Fixtures.InterfaceShapes.baseUInt8Bump", 41),
  42,
);
assert.equal(
  runtime.call("Vir.Fixtures.InterfaceShapes.baseUInt16Bump", 41),
  42,
);
assert.equal(
  runtime.call("Vir.Fixtures.InterfaceShapes.arrayStringTotalLength", [
    "a",
    "bc",
  ]),
  3n,
);
assert.equal(
  runtime.call("Vir.Fixtures.InterfaceShapes.baseArrayNatSum", [4, 5, 6]),
  15n,
);
assert.equal(
  runtime.call("Vir.Fixtures.InterfaceShapes.listUInt32Sum", [1, 2, 3]),
  6n,
);
assert.deepEqual(
  runtime.call("Vir.Fixtures.InterfaceShapes.arrayNatBumpAll", [4, 5]),
  [5n, 6n],
);
assert.deepEqual(
  runtime.call("Vir.Fixtures.InterfaceShapes.listStringBangAll", ["a", "bc"]),
  ["a!", "bc!"],
);
assert.equal(runtime.call("Vir.Fixtures.InterfaceShapes.uint32Bump", 41), 42);
assert.equal(
  runtime.call(
    "Vir.Fixtures.InterfaceShapes.uint64Bump",
    "18446744073709551615",
  ),
  0n,
);
assert.equal(
  runtime.call("Vir.Fixtures.InterfaceShapes.baseUSizeBump", "41"),
  42,
);
assert.equal(runtime.call("Vir.Fixtures.InterfaceShapes.floatScale", 1.5), 6);
assert.equal(
  runtime.call("Vir.Fixtures.InterfaceShapes.floatScore", 3.25),
  4n,
);
assert.equal(
  runtime.call("Vir.Fixtures.InterfaceShapes.float32Roundtrip", 1.25),
  1.25,
);
assert.deepEqual(
  runtime.call(
    "Vir.Fixtures.InterfaceShapes.baseByteArrayRoundtrip",
    Uint8Array.from([65, 66, 67]),
  ),
  Uint8Array.from([65, 66, 67]),
);
const floatScaleEntry = manifestEntry(
  runtime.interfaceManifest,
  "Vir.Fixtures.InterfaceShapes.floatScale",
);
assert.deepEqual(floatScaleEntry.args[0].type.native.type, { tag: "float", width: 64 });
assert.deepEqual(floatScaleEntry.result.native.type, { tag: "float", width: 64 });
const float32Entry = manifestEntry(
  runtime.interfaceManifest,
  "Vir.Fixtures.InterfaceShapes.float32Roundtrip",
);
assert.deepEqual(float32Entry.args[0].type.native.type, { tag: "float", width: 32 });
assert.deepEqual(float32Entry.result.native.type, { tag: "float", width: 32 });
assert.deepEqual(
  runtime.call("Vir.Fixtures.InterfaceShapes.optionNatBump", { kind: "none" }),
  { kind: "some", value: 0n },
);
assert.deepEqual(
  runtime.call("Vir.Fixtures.InterfaceShapes.optionNatBump", { kind: "some", value: 41 }),
  { kind: "some", value: 42n },
);
assert.deepEqual(
  runtime.call("Vir.Fixtures.InterfaceShapes.optionStringBang", { kind: "none" }),
  { kind: "some", value: "empty" },
);
assert.deepEqual(
  runtime.call("Vir.Fixtures.InterfaceShapes.optionStringBang", { kind: "some", value: "ok" }),
  { kind: "some", value: "ok!" },
);
assert.equal(
  runtime.call("Vir.Fixtures.InterfaceShapes.optionNatScore", { kind: "some", value: 6 }),
  17n,
);
assert.deepEqual(
  runtime.call("Vir.Fixtures.InterfaceShapes.prodNatNatSwap", {
    fst: 2,
    snd: 9,
  }),
  {
    fst: 9n,
    snd: 2n,
  },
);
assert.equal(
  runtime.call("Vir.Fixtures.InterfaceShapes.prodNatNatSum", {
    fst: 4,
    snd: 5,
  }),
  9n,
);
assert.equal(
  runtime.call("Vir.Fixtures.InterfaceShapes.optionArrayNatSum", { kind: "some", value: [4, 5, 6] }),
  15n,
);
assert.equal(
  runtime.call("Vir.Fixtures.InterfaceShapes.optionArrayNatSum", { kind: "none" }),
  0n,
);
assert.equal(
  runtime.call("Vir.Fixtures.InterfaceShapes.listProdNatStringScore", [
    { fst: 4, snd: "ab" },
    { fst: 5, snd: "c" },
  ]),
  12n,
);
assert.deepEqual(
  runtime.call("Vir.Fixtures.InterfaceShapes.prodStringNatSwap", {
    fst: "ok",
    snd: 6,
  }),
  {
    fst: 7n,
    snd: "ok!",
  },
);
assert.equal(
  runtime.call("Vir.Fixtures.InterfaceShapes.arrayExprKindScore", [
    { kind: "const", name: "Nat", levels: [] },
    { kind: "bvar", index: 2 },
  ]),
  13n,
);
assert.deepEqual(
  runtime.call("Vir.Fixtures.InterfaceShapes.optionExprBump", {
    kind: "some",
    value: { kind: "bvar", index: 6 },
  }),
  {
    kind: "some",
    value: { kind: "bvar", index: 7n },
  },
);
assert.deepEqual(
  runtime.call("Vir.Fixtures.InterfaceShapes.profileBump", {
    nickname: "lean",
    points: 4,
    tags: ["ir", "wasm"],
  }),
  {
    nickname: "lean!",
    points: 6n,
    tags: ["ir", "wasm"],
  },
);
assert.equal(
  runtime.call("Vir.Fixtures.InterfaceShapes.profileScore", {
    nickname: "lean",
    points: 4,
    tags: ["ir", "wasm"],
  }),
  14n,
);
// A getter can reenter conversion for the same descriptor while the outer
// constructor owns partially lowered fields. Only the metadata may be shared.
{
  const tags = ["outer"];
  let nestedScore;
  Object.defineProperty(tags, 0, { get() {
    nestedScore = runtime.call("Vir.Fixtures.InterfaceShapes.profileScore", {
      nickname: "inner", points: 10, tags: ["xy"],
    });
    return "tag";
  } });
  assert.equal(runtime.call("Vir.Fixtures.InterfaceShapes.profileScore", {
    nickname: "outer", points: 1, tags,
  }), 9n);
  assert.equal(nestedScore, 17n);
}
assert.deepEqual(
  runtime.call("Vir.Fixtures.InterfaceShapes.profileSummary", {
    nickname: "lean",
    points: 4,
    tags: ["ir", "wasm"],
  }),
  {
    label: "lean:2",
    total: 14n,
    bonus: { kind: "some", value: 14n },
  },
);
assert.equal(
  runtime.call("Vir.Fixtures.InterfaceShapes.profileEnvelopeScore", {
    profile: {
      nickname: "lean",
      points: 4,
      tags: ["ir", "wasm"],
    },
    summary: {
      label: "lean:2",
      total: 14,
      bonus: { kind: "some", value: 14 },
    },
  }),
  48n,
);
const profileStatsInput = {
  enabled: true,
  level: 2,
  score16: 30,
  visits: 400,
  quota: 5,
  checksum: 6000,
  tier: "pro",
  note: "ok",
};
const profileStatsEntry = manifestEntry(
  runtime.interfaceManifest,
  "Vir.Fixtures.InterfaceShapes.profileStatsBump",
);
const profileStatsCtor = profileStatsEntry.args[0].type.native.metadata.constructors[0];
assert.equal(profileStatsCtor.storage.objectFieldCount, 1);
assert.equal(profileStatsCtor.storage.usizeFieldCount, 1);
assert.equal(profileStatsCtor.storage.scalarByteSize, 17);
assert.deepEqual(
  profileStatsCtor.fields.map((field) => [
    field.name,
    field.location.tag,
  ]),
  [
    ["enabled", "scalar"],
    ["level", "scalar"],
    ["score16", "scalar"],
    ["visits", "scalar"],
    ["quota", "usize"],
    ["checksum", "scalar"],
    ["tier", "scalar"],
    ["note", "object"],
  ],
);
assert.deepEqual(
  runtime.call(
    "Vir.Fixtures.InterfaceShapes.profileStatsBump",
    profileStatsInput,
  ),
  {
    enabled: false,
    level: 3,
    score16: 32,
    visits: 403,
    quota: 9,
    checksum: 6005n,
    tier: "elite",
    note: "ok!",
  },
);
assert.equal(
  runtime.call(
    "Vir.Fixtures.InterfaceShapes.profileStatsScore",
    profileStatsInput,
  ),
  6549n,
);
assert.deepEqual(
  runtime.call("Vir.Fixtures.InterfaceShapes.boxNatBump", { value: 41 }),
  {
    value: 42n,
  },
);
const boxNatEntry = manifestEntry(
  runtime.interfaceManifest,
  "Vir.Fixtures.InterfaceShapes.boxNatBump",
);
assert.equal(
  boxNatEntry.args[0].type.native.metadata.declaration,
  "Vir.Fixtures.InterfaceShapes.Box",
);
assert.equal(boxNatEntry.args[0].type.native.metadata.constructors[0].representation, "identity");
const boxUInt32Entry = manifestEntry(
  runtime.interfaceManifest,
  "Vir.Fixtures.InterfaceShapes.boxUInt32Bump",
);
assert.equal(
  boxUInt32Entry.args[0].type.native.metadata.declaration,
  "Vir.Fixtures.InterfaceShapes.Box",
);
const boxUInt32Ctor = boxUInt32Entry.args[0].type.native.metadata.constructors[0];
assert.equal(boxUInt32Ctor.representation, "identity");
assert.deepEqual(boxUInt32Ctor.fields[0].type.type, { tag: "unsigned", width: 32 });
assert.deepEqual(
  runtime.call("Vir.Fixtures.InterfaceShapes.boxUInt32Bump", {
    value: 41,
  }),
  {
    value: 42,
  },
);
const boxUInt64Entry = manifestEntry(
  runtime.interfaceManifest,
  "Vir.Fixtures.InterfaceShapes.boxUInt64Bump",
);
assert.equal(
  boxUInt64Entry.args[0].type.native.metadata.declaration,
  "Vir.Fixtures.InterfaceShapes.Box",
);
const boxUInt64Ctor = boxUInt64Entry.args[0].type.native.metadata.constructors[0];
assert.equal(boxUInt64Ctor.representation, "identity");
assert.deepEqual(boxUInt64Ctor.fields[0].type.type, { tag: "unsigned", width: 64 });
assert.deepEqual(
  runtime.call("Vir.Fixtures.InterfaceShapes.boxUInt64Bump", {
    value: "18446744073709551615",
  }),
  {
    value: 0n,
  },
);
const uint32BoxEntry = manifestEntry(
  runtime.interfaceManifest,
  "Vir.Fixtures.InterfaceShapes.uint32BoxBump",
);
assert.equal(
  uint32BoxEntry.args[0].type.native.metadata.declaration,
  "Vir.Fixtures.InterfaceShapes.UInt32Box",
);
const uint32BoxCtor = uint32BoxEntry.args[0].type.native.metadata.constructors[0];
assert.equal(uint32BoxCtor.representation, "identity");
assert.deepEqual(uint32BoxCtor.fields[0].type.type, { tag: "unsigned", width: 32 });
assert.deepEqual(uint32BoxEntry.args[0].type.value.fields[0], {
  key: "value",
  path: [0],
  value: { tag: "number" },
});
assert.deepEqual(
  runtime.call("Vir.Fixtures.InterfaceShapes.uint32BoxBump", {
    value: 41,
  }),
  {
    value: 42,
  },
);
const uint64BoxEntry = manifestEntry(
  runtime.interfaceManifest,
  "Vir.Fixtures.InterfaceShapes.uint64BoxBump",
);
assert.equal(
  uint64BoxEntry.args[0].type.native.metadata.declaration,
  "Vir.Fixtures.InterfaceShapes.UInt64Box",
);
const uint64BoxCtor = uint64BoxEntry.args[0].type.native.metadata.constructors[0];
assert.equal(uint64BoxCtor.representation, "identity");
assert.deepEqual(uint64BoxCtor.fields[0].type.type, { tag: "unsigned", width: 64 });
assert.deepEqual(uint64BoxEntry.args[0].type.value.fields[0], {
  key: "value",
  path: [0],
  value: { tag: "bigint" },
});
assert.deepEqual(
  runtime.call("Vir.Fixtures.InterfaceShapes.uint64BoxBump", {
    value: "18446744073709551615",
  }),
  {
    value: 0n,
  },
);
assert.deepEqual(
  runtime.call("Vir.Fixtures.InterfaceShapes.nestedBoxNatBump", {
    value: { value: 4 },
  }),
  {
    value: { value: 5n },
  },
);
assert.equal(
  runtime.call("Vir.Fixtures.InterfaceShapes.taggedArrayScore", {
    label: "ab",
    payload: ["x", "yz"],
  }),
  5n,
);
assert.deepEqual(
  runtime.call("Vir.Fixtures.InterfaceShapes.taggedProfileBump", {
    label: "profile",
    payload: {
      nickname: "lean",
      points: 4,
      tags: ["ir", "wasm"],
    },
  }),
  {
    label: "profile!",
    payload: {
      nickname: "lean!",
      points: 6n,
      tags: ["ir", "wasm"],
    },
  },
);
assert.deepEqual(
  runtime.call("Vir.Fixtures.InterfaceShapes.meteredBoxBump", {
    active: false,
    count: 3,
    payload: { value: 4 },
  }),
  {
    active: true,
    count: 4,
    payload: { value: 7n },
  },
);
assert.equal(
  runtime.call("Vir.Fixtures.InterfaceShapes.boxExprKindScore", {
    value: { kind: "const", name: "Nat", levels: [] },
  }),
  10n,
);
const extendedProfileInput = {
  nickname: "lean",
  active: true,
  visits: 5,
  score: 7,
  tags: ["ir"],
};
const extendedProfileEntry = manifestEntry(
  runtime.interfaceManifest,
  "Vir.Fixtures.InterfaceShapes.extendedProfileBump",
);
assert.deepEqual(
  extendedProfileEntry.args[0].type.value.fields.map(({ key, path }) => [key, path]),
  [["nickname", [0, 0]], ["active", [0, 1]], ["visits", [0, 2]], ["score", [1]], ["tags", [2]]],
);
assert.deepEqual(
  extendedProfileEntry.args[0].type.native.metadata.constructors[0].fields.map(({ name }) => name),
  ["toProfileBase", "score", "tags"],
);
assert.deepEqual(
  runtime.call(
    "Vir.Fixtures.InterfaceShapes.extendedProfileBump",
    extendedProfileInput,
  ),
  {
    nickname: "lean!",
    active: false,
    visits: 6,
    score: 8n,
    tags: ["ir", "extended"],
  },
);
assert.equal(
  runtime.call(
    "Vir.Fixtures.InterfaceShapes.extendedProfileScore",
    extendedProfileInput,
  ),
  118n,
);
assert.throws(
  () =>
    runtime.call("Vir.Fixtures.InterfaceShapes.extendedProfileScore", {
      toProfileBase: { nickname: "nested", active: true, visits: 1 },
      ...extendedProfileInput,
    }),
  /profile\.toProfileBase is unexpected/,
);
assert.throws(
  () =>
    runtime.call("Vir.Fixtures.InterfaceShapes.profileScore", {
      nickname: "lean",
      points: 4,
    }),
  /profile\.tags is missing/,
);

assert.throws(
  () => runtime.call("fib", -1),
  /fib argument arg1 must be non-negative/,
);
assert.throws(
  () => runtime.call("Vir.Fixtures.InterfaceShapes.baseArrayNatSum", new Set([1, 2])),
  /must be an array/,
);
assert.throws(
  () => runtime.call("Vir.Fixtures.InterfaceShapes.floatScale", "1.5"),
  /must be a number/,
);
assert.throws(
  () =>
    runtime.call("Vir.Fixtures.InterfaceShapes.profileStatsScore", {
      ...profileStatsInput,
      tier: 1,
    }),
  /stats\.tier has unknown enum value/,
);
assert.throws(
  () => runtime.call("Vir.Fixtures.InterfaceShapes.baseByteArrayRoundtrip", [1, 2]),
  /must be a Uint8Array/,
);
assert.throws(
  () => runtime.call("Vir.Fixtures.InterfaceShapes.prodNatNatSum", [4, 5]),
  /argument pair must be a record/,
);
assert.throws(
  () => runtime.call("Vir.Fixtures.ListOption.sumScore", { inl: 12 }),
  /sumScore argument arg1 must specify variant kind/,
);
assert.throws(
  () => leanRuntime.call("Vir.Fixtures.ExprPrinter.exprKindScore", "Nat"),
  /unsupported Lean\.Expr kind undefined/,
);

runtime.dispose();
leanRuntime.dispose();

console.log("structural object ABI smoke ok");
