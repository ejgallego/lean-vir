/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { createVirRuntime } from "../../web/src/vir-runtime-node.js";
import { INTERFACE_TAG } from "../../web/src/runtime/interface-tags.js";
import { assert, manifestEntry, readRuntimeArtifacts } from "./shared.mjs";

const { wasmBytes, defaultPackageBytes, leanPackageBytes } =
  await readRuntimeArtifacts();
const runtime = await createVirRuntime({
  wasmBytes,
  irPackageSetBytes: [defaultPackageBytes],
});
const leanRuntime = await createVirRuntime({
  wasmBytes,
  irPackageSetBytes: [leanPackageBytes],
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
  literal: { kind: "nat", value: "2" },
});
assert.deepEqual(leanRuntime.call("Vir.Fixtures.ExprPrinter.appExpr"), {
  kind: "app",
  fn: { kind: "const", name: "Nat.succ", levels: [] },
  arg: { kind: "lit", literal: { kind: "nat", value: "2" } },
});
assert.deepEqual(leanRuntime.call("Vir.Fixtures.ExprPrinter.sortParamExpr"), {
  kind: "sort",
  level: { kind: "succ", of: { kind: "param", name: "u" } },
});
assert.deepEqual(leanRuntime.call("Vir.Fixtures.ExprPrinter.fvarExpr"), {
  kind: "fvar",
  name: "x",
});
assert.deepEqual(leanRuntime.call("Vir.Fixtures.ExprPrinter.mvarExpr"), {
  kind: "mvar",
  name: "m",
});
assert.deepEqual(leanRuntime.call("Vir.Fixtures.ExprPrinter.lambdaExpr"), {
  kind: "lam",
  name: "x",
  type: { kind: "const", name: "Nat", levels: [] },
  body: { kind: "bvar", index: "0" },
  binderInfo: "default",
});
assert.deepEqual(leanRuntime.call("Vir.Fixtures.ExprPrinter.forallExpr"), {
  kind: "forall",
  name: "x",
  type: { kind: "const", name: "Nat", levels: [] },
  body: { kind: "bvar", index: "0" },
  binderInfo: "implicit",
});
assert.deepEqual(leanRuntime.call("Vir.Fixtures.ExprPrinter.letExpr"), {
  kind: "let",
  name: "x",
  type: { kind: "const", name: "Nat", levels: [] },
  value: { kind: "lit", literal: { kind: "nat", value: "2" } },
  body: { kind: "bvar", index: "0" },
  nondep: false,
});
assert.deepEqual(leanRuntime.call("Vir.Fixtures.ExprPrinter.stringLitExpr"), {
  kind: "lit",
  literal: { kind: "string", value: "hi" },
});
assert.deepEqual(leanRuntime.call("Vir.Fixtures.ExprPrinter.mdataExpr"), {
  kind: "mdata",
  expr: { kind: "bvar", index: "0" },
});
assert.deepEqual(leanRuntime.call("Vir.Fixtures.ExprPrinter.projExpr"), {
  kind: "proj",
  typeName: "Prod",
  index: "1",
  struct: { kind: "const", name: "p", levels: [] },
});
assert.equal(
  leanRuntime.call("Vir.Fixtures.ExprPrinter.exprCoverageScore"),
  "1232",
);
assert.equal(
  leanRuntime.call("Vir.Fixtures.ExprPrinter.exprKindScore", {
    kind: "bvar",
    index: 4,
  }),
  "5",
);
assert.equal(
  leanRuntime.call("Vir.Fixtures.ExprPrinter.exprKindScore", {
    kind: "lit",
    literal: { kind: "nat", value: 2 },
  }),
  "102",
);
assert.deepEqual(
  leanRuntime.call("Vir.Fixtures.ExprPrinter.bumpBVar", {
    kind: "bvar",
    index: 4,
  }),
  {
    kind: "bvar",
    index: "5",
  },
);
assert.deepEqual(runtime.call("Vir.Fixtures.ListOption.classifySum", 0), {
  kind: "inl",
  value: "10",
});
assert.deepEqual(runtime.call("Vir.Fixtures.ListOption.classifySum", 4), {
  kind: "inr",
  value: "4",
});
assert.equal(
  runtime.call("Vir.Fixtures.ListOption.sumScore", { kind: "inr", value: 7 }),
  "70",
);
assert.equal(
  runtime.call("Vir.Fixtures.ListOption.sumScore", {
    kind: "inl",
    value: 12,
  }),
  "12",
);
assert.deepEqual(runtime.call("Vir.Fixtures.ListOption.classifyExcept", 0), {
  kind: "error",
  value: "90",
});
assert.deepEqual(runtime.call("Vir.Fixtures.ListOption.classifyExcept", 5), {
  kind: "ok",
  value: {
    kind: "inr",
    value: "5",
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
  "42",
);
assert.equal(
  runtime.call("Vir.Fixtures.InterfaceShapes.baseIntNegate", -41),
  "41",
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
  "3",
);
assert.equal(
  runtime.call("Vir.Fixtures.InterfaceShapes.baseArrayNatSum", [4, 5, 6]),
  "15",
);
assert.equal(
  runtime.call("Vir.Fixtures.InterfaceShapes.listUInt32Sum", [1, 2, 3]),
  "6",
);
assert.deepEqual(
  runtime.call("Vir.Fixtures.InterfaceShapes.arrayNatBumpAll", [4, 5]),
  ["5", "6"],
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
  "0",
);
assert.equal(
  runtime.call("Vir.Fixtures.InterfaceShapes.baseUSizeBump", "41"),
  "42",
);
assert.equal(runtime.call("Vir.Fixtures.InterfaceShapes.floatScale", 1.5), 6);
assert.equal(
  runtime.call("Vir.Fixtures.InterfaceShapes.floatScore", 3.25),
  "4",
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
assert.equal(floatScaleEntry.args[0].type.interfaceTag, INTERFACE_TAG.FLOAT);
assert.equal(floatScaleEntry.result.interfaceTag, INTERFACE_TAG.FLOAT);
const float32Entry = manifestEntry(
  runtime.interfaceManifest,
  "Vir.Fixtures.InterfaceShapes.float32Roundtrip",
);
assert.equal(float32Entry.args[0].type.interfaceTag, INTERFACE_TAG.FLOAT32);
assert.equal(float32Entry.result.interfaceTag, INTERFACE_TAG.FLOAT32);
assert.equal(
  runtime.call("Vir.Fixtures.InterfaceShapes.optionNatBump", null),
  "0",
);
assert.equal(
  runtime.call("Vir.Fixtures.InterfaceShapes.optionNatBump", 41),
  "42",
);
assert.equal(
  runtime.call("Vir.Fixtures.InterfaceShapes.optionStringBang", null),
  "empty",
);
assert.equal(
  runtime.call("Vir.Fixtures.InterfaceShapes.optionStringBang", "ok"),
  "ok!",
);
assert.equal(
  runtime.call("Vir.Fixtures.InterfaceShapes.optionNatScore", 6),
  "17",
);
assert.deepEqual(
  runtime.call("Vir.Fixtures.InterfaceShapes.prodNatNatSwap", {
    fst: 2,
    snd: 9,
  }),
  {
    fst: "9",
    snd: "2",
  },
);
assert.equal(
  runtime.call("Vir.Fixtures.InterfaceShapes.prodNatNatSum", {
    fst: 4,
    snd: 5,
  }),
  "9",
);
assert.equal(
  runtime.call("Vir.Fixtures.InterfaceShapes.optionArrayNatSum", [4, 5, 6]),
  "15",
);
assert.equal(
  runtime.call("Vir.Fixtures.InterfaceShapes.optionArrayNatSum", null),
  "0",
);
assert.equal(
  runtime.call("Vir.Fixtures.InterfaceShapes.listProdNatStringScore", [
    { fst: 4, snd: "ab" },
    { fst: 5, snd: "c" },
  ]),
  "12",
);
assert.deepEqual(
  runtime.call("Vir.Fixtures.InterfaceShapes.prodStringNatSwap", {
    fst: "ok",
    snd: 6,
  }),
  {
    fst: "7",
    snd: "ok!",
  },
);
assert.equal(
  runtime.call("Vir.Fixtures.InterfaceShapes.arrayExprKindScore", [
    { kind: "const", name: "Nat", levels: [] },
    { kind: "bvar", index: 2 },
  ]),
  "13",
);
assert.deepEqual(
  runtime.call("Vir.Fixtures.InterfaceShapes.optionExprBump", {
    kind: "bvar",
    index: 6,
  }),
  {
    kind: "bvar",
    index: "7",
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
    points: "6",
    tags: ["ir", "wasm"],
  },
);
assert.equal(
  runtime.call("Vir.Fixtures.InterfaceShapes.profileScore", {
    nickname: "lean",
    points: 4,
    tags: ["ir", "wasm"],
  }),
  "14",
);
assert.deepEqual(
  runtime.call("Vir.Fixtures.InterfaceShapes.profileSummary", {
    nickname: "lean",
    points: 4,
    tags: ["ir", "wasm"],
  }),
  {
    label: "lean:2",
    total: "14",
    bonus: "14",
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
      bonus: 14,
    },
  }),
  "48",
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
assert.equal(profileStatsEntry.args[0].type.objectFieldCount, 1);
assert.equal(profileStatsEntry.args[0].type.usizeFieldCount, 1);
assert.equal(profileStatsEntry.args[0].type.scalarByteSize, 17);
assert.deepEqual(
  profileStatsEntry.args[0].type.fields.map((field) => [
    field.name,
    field.layout.kind,
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
    quota: "9",
    checksum: "6005",
    tier: "elite",
    note: "ok!",
  },
);
assert.equal(
  runtime.call(
    "Vir.Fixtures.InterfaceShapes.profileStatsScore",
    profileStatsInput,
  ),
  "6549",
);
assert.deepEqual(
  runtime.call("Vir.Fixtures.InterfaceShapes.boxNatBump", { value: 41 }),
  {
    value: "42",
  },
);
const boxNatEntry = manifestEntry(
  runtime.interfaceManifest,
  "Vir.Fixtures.InterfaceShapes.boxNatBump",
);
assert.equal(
  boxNatEntry.args[0].type.type,
  "Vir.Fixtures.InterfaceShapes.Box Nat",
);
assert.equal(boxNatEntry.args[0].type.trivialFieldIndex, 0);
const boxUInt32Entry = manifestEntry(
  runtime.interfaceManifest,
  "Vir.Fixtures.InterfaceShapes.boxUInt32Bump",
);
assert.equal(
  boxUInt32Entry.args[0].type.type,
  "Vir.Fixtures.InterfaceShapes.Box UInt32",
);
assert.equal(boxUInt32Entry.args[0].type.trivialFieldIndex, 0);
assert.equal(
  boxUInt32Entry.args[0].type.fields[0].type.interfaceTag,
  INTERFACE_TAG.UINT32,
);
assert.equal(boxUInt32Entry.args[0].type.fields[0].layout.kind, "object");
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
  boxUInt64Entry.args[0].type.type,
  "Vir.Fixtures.InterfaceShapes.Box UInt64",
);
assert.equal(boxUInt64Entry.args[0].type.trivialFieldIndex, 0);
assert.equal(
  boxUInt64Entry.args[0].type.fields[0].type.interfaceTag,
  INTERFACE_TAG.UINT64,
);
assert.equal(boxUInt64Entry.args[0].type.fields[0].layout.kind, "object");
assert.deepEqual(
  runtime.call("Vir.Fixtures.InterfaceShapes.boxUInt64Bump", {
    value: "18446744073709551615",
  }),
  {
    value: "0",
  },
);
const uint32BoxEntry = manifestEntry(
  runtime.interfaceManifest,
  "Vir.Fixtures.InterfaceShapes.uint32BoxBump",
);
assert.equal(
  uint32BoxEntry.args[0].type.type,
  "Vir.Fixtures.InterfaceShapes.UInt32Box",
);
assert.equal(uint32BoxEntry.args[0].type.trivialFieldIndex, 0);
assert.equal(
  uint32BoxEntry.args[0].type.fields[0].type.interfaceTag,
  INTERFACE_TAG.UINT32,
);
assert.equal(uint32BoxEntry.args[0].type.fields[0].layout.kind, "scalar");
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
  uint64BoxEntry.args[0].type.type,
  "Vir.Fixtures.InterfaceShapes.UInt64Box",
);
assert.equal(uint64BoxEntry.args[0].type.trivialFieldIndex, 0);
assert.equal(
  uint64BoxEntry.args[0].type.fields[0].type.interfaceTag,
  INTERFACE_TAG.UINT64,
);
assert.equal(uint64BoxEntry.args[0].type.fields[0].layout.kind, "scalar");
assert.deepEqual(
  runtime.call("Vir.Fixtures.InterfaceShapes.uint64BoxBump", {
    value: "18446744073709551615",
  }),
  {
    value: "0",
  },
);
assert.deepEqual(
  runtime.call("Vir.Fixtures.InterfaceShapes.nestedBoxNatBump", {
    value: { value: 4 },
  }),
  {
    value: { value: "5" },
  },
);
assert.equal(
  runtime.call("Vir.Fixtures.InterfaceShapes.taggedArrayScore", {
    label: "ab",
    payload: ["x", "yz"],
  }),
  "5",
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
      points: "6",
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
    payload: { value: "7" },
  },
);
assert.equal(
  runtime.call("Vir.Fixtures.InterfaceShapes.boxExprKindScore", {
    value: { kind: "const", name: "Nat", levels: [] },
  }),
  "10",
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
  extendedProfileEntry.args[0].type.fields.map((field) => [
    field.name,
    field.subobject === true,
  ]),
  [
    ["toProfileBase", true],
    ["score", false],
    ["tags", false],
  ],
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
    score: "8",
    tags: ["ir", "extended"],
  },
);
assert.equal(
  runtime.call(
    "Vir.Fixtures.InterfaceShapes.extendedProfileScore",
    extendedProfileInput,
  ),
  "118",
);
assert.throws(
  () =>
    runtime.call("Vir.Fixtures.InterfaceShapes.extendedProfileScore", {
      toProfileBase: { nickname: "nested", active: true, visits: 1 },
      ...extendedProfileInput,
    }),
  /mixes toProfileBase with flattened inherited fields/,
);
assert.throws(
  () =>
    runtime.call("Vir.Fixtures.InterfaceShapes.profileScore", {
      nickname: "lean",
      points: 4,
    }),
  /profileScore argument profile is missing field tags/,
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
  /must be an enum constructor name/,
);
assert.throws(
  () => runtime.call("Vir.Fixtures.InterfaceShapes.baseByteArrayRoundtrip", [1, 2]),
  /must be a Uint8Array/,
);
assert.throws(
  () => runtime.call("Vir.Fixtures.InterfaceShapes.prodNatNatSum", [4, 5]),
  /must be a pair \{ fst, snd \}/,
);
assert.throws(
  () => runtime.call("Vir.Fixtures.ListOption.sumScore", { inl: 12 }),
  /must specify tagged-union kind/,
);
assert.throws(
  () => leanRuntime.call("Vir.Fixtures.ExprPrinter.exprKindScore", "Nat"),
  /unsupported Lean\.Expr kind undefined/,
);

runtime.dispose();
leanRuntime.dispose();

console.log("structural object ABI smoke ok");
