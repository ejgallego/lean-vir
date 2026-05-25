/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createVirRuntime as createExportedVirRuntime } from "lean-vir";
import {
  createVirRuntime,
  createVirRuntimeFactory,
  roundTripInterfaceTypeDescriptor,
  sameInterfaceWireType,
} from "../web/src/vir-runtime.js";
import {
  INTERFACE_MANIFEST_ARTIFACT,
  validateInterfaceManifest,
} from "../web/src/interface-manifest.js";

function assertManifestTypeDescriptorsRoundTrip(manifest) {
  for (const entry of manifest.exports) {
    for (const arg of entry.args) {
      const decoded = roundTripInterfaceTypeDescriptor(arg.type, `${entry.entry} argument ${arg.name}`);
      assert.ok(
        sameInterfaceWireType(arg.type, decoded),
        `${entry.entry} argument ${arg.name} descriptor should round-trip`,
      );
    }
    const decoded = roundTripInterfaceTypeDescriptor(entry.result, `${entry.entry} result`);
    assert.ok(
      sameInterfaceWireType(entry.result, decoded),
      `${entry.entry} result descriptor should round-trip`,
    );
  }
}

const validManifestShape = {
  artifact: INTERFACE_MANIFEST_ARTIFACT,
  version: 1,
  metadata: {},
  exports: [
    {
      id: "ok",
      jsName: "ok",
      entry: "ok",
      source: "Ok.lean",
      args: [{ name: "arg1", type: { type: "Nat", wireTag: 0 } }],
      result: { type: "Nat", wireTag: 0 },
    },
  ],
};

function assertInvalidManifest(mutator, pattern) {
  const manifest = structuredClone(validManifestShape);
  mutator(manifest);
  assert.throws(() => validateInterfaceManifest(manifest), pattern);
}

async function assertUnsupportedInterfaceSource(dir, stem, lines, patterns) {
  const source = join(dir, `${stem}.lean`);
  const packagePath = join(dir, `${stem}.irpkg`);
  const reportPath = join(dir, `${stem}.report.md`);
  await writeFile(source, lines.join("\n"));
  const generated = spawnSync(
    "lean",
    [
      "--run",
      "tools/GeneratePackage.lean",
      packagePath,
      reportPath,
      "--target-all",
      source,
    ],
    { encoding: "utf8" },
  );
  assert.notEqual(generated.status, 0, `${stem} unexpectedly generated successfully`);
  assert.match(generated.stderr, /unsupported interface exports/);
  const report = await readFile(reportPath, "utf8");
  for (const pattern of patterns) {
    assert.match(generated.stderr, pattern);
    assert.match(report, pattern);
  }
}

const wasmBytes = await readFile(new URL("../web/public/vir-upstream.wasm", import.meta.url));
const irPackageBytes = await readFile(new URL("../web/public/vir-demo.irpkg", import.meta.url));

const runtime = await createVirRuntime({ wasmBytes, irPackageBytes });
assert.equal(createExportedVirRuntime, createVirRuntime);
assert.equal(runtime.targetPointerBytes(), 4);
assert.ok(runtime.packageInfo.count > 0, "expected IR package to load declarations");
assert.equal(runtime.packageDeclCount(), runtime.packageInfo.count);
assert.equal(runtime.packageInfo.byteLength, irPackageBytes.byteLength);
assert.ok(runtime.packageInfo.interfaceExports > 0, "expected embedded interface exports");
assert.equal(runtime.packageInfo.metadata, runtime.packageMetadata);
assert.equal(runtime.packageMetadata.packageFormatVersion, 4);
assert.equal(runtime.packageMetadata.manifestVersion, 1);
assert.match(runtime.packageMetadata.leanToolchain, /leanprover\/lean4/);
assert.ok(runtime.packageMetadata.generatedAt.length > 0);
assert.ok(runtime.packageMetadata.targets.some((target) => target.source === "examples/Fib.lean"));
assert.ok(runtime.interfaceManifest.exports.some((entry) => entry.entry === "fib"));
assertManifestTypeDescriptorsRoundTrip(runtime.interfaceManifest);
assert.equal(validateInterfaceManifest(structuredClone(validManifestShape)).exports[0].entry, "ok");
assertInvalidManifest((manifest) => {
  manifest.exports[0].result = { type: "UnsupportedTag10", wireTag: 10 };
}, /result\.wireTag is not supported/);
assertInvalidManifest((manifest) => {
  manifest.exports[0].args[0].type = { type: "Array Nat", wireTag: 16 };
}, /args\[0\]\.type\.element must be an object/);
assertInvalidManifest((manifest) => {
  manifest.exports[0].result = {
    type: "Mode",
    wireTag: 14,
    kind: "simpleEnum",
    constructors: [
      { name: "Mode.cold", jsName: "cold", tag: 0 },
      { name: "Mode.hot", jsName: "hot", tag: 2 },
    ],
  };
}, /constructors\[1\]\.tag must be 1/);
assertInvalidManifest((manifest) => {
  manifest.exports[0].result = {
    type: "Sum Nat Nat",
    wireTag: 21,
    kind: "taggedUnion",
    name: "Sum",
    constructors: [],
  };
}, /constructors must be a non-empty array/);
assertInvalidManifest((manifest) => {
  manifest.exports[0].result = {
    type: "Box Nat",
    wireTag: 20,
    kind: "structure",
    name: "Box",
    objectFieldCount: 1,
    usizeFieldCount: 0,
    scalarByteSize: 0,
    trivialFieldIndex: 1,
    fields: [
      {
        name: "value",
        type: { type: "Nat", wireTag: 0 },
        layout: { kind: "object", index: 0 },
      },
    ],
  };
}, /trivialFieldIndex is out of range/);
assertInvalidManifest((manifest) => {
  manifest.exports[0].result = {
    type: "Box Nat",
    wireTag: 20,
    kind: "structure",
    name: "Box",
    objectFieldCount: 0,
    usizeFieldCount: 0,
    scalarByteSize: 0,
    fields: [
      {
        name: "value",
        type: { type: "Nat", wireTag: 0 },
        layout: { kind: "object", index: 0 },
      },
    ],
  };
}, /layout\.index is outside objectFieldCount/);
assertInvalidManifest((manifest) => {
  manifest.exports[0].result = {
    type: "ScalarBox",
    wireTag: 20,
    kind: "structure",
    name: "ScalarBox",
    objectFieldCount: 0,
    usizeFieldCount: 0,
    scalarByteSize: 1,
    fields: [
      {
        name: "flag",
        type: { type: "Bool", wireTag: 2 },
        layout: { kind: "scalar", size: 1, offset: 1 },
      },
    ],
  };
}, /layout is outside scalarByteSize/);
assertInvalidManifest((manifest) => {
  manifest.exports[0].args[0].type.type = "";
}, /args\[0\]\.type\.type must be a non-empty string/);
assertInvalidManifest((manifest) => {
  manifest.exports.push(structuredClone(manifest.exports[0]));
}, /entry duplicates another interface export/);
assertInvalidManifest((manifest) => {
  manifest.exports[0].result = {
    type: "Child",
    wireTag: 20,
    kind: "structure",
    name: "Child",
    objectFieldCount: 2,
    usizeFieldCount: 0,
    scalarByteSize: 0,
    fields: [
      {
        name: "toParent",
        subobject: true,
        type: {
          type: "Parent",
          wireTag: 20,
          kind: "structure",
          name: "Parent",
          objectFieldCount: 1,
          usizeFieldCount: 0,
          scalarByteSize: 0,
          fields: [
            {
              name: "value",
              type: { type: "Nat", wireTag: 0 },
              layout: { kind: "object", index: 0 },
            },
          ],
        },
        layout: { kind: "object", index: 0 },
      },
      {
        name: "value",
        type: { type: "Nat", wireTag: 0 },
        layout: { kind: "object", index: 1 },
      },
    ],
  };
}, /fields\[1\]\.name duplicates another flattened structure field/);
assert.equal(runtime.call("fib", 12), "144");
assert.equal(runtime.exportsByName.fib(12), "144");

const inspected = spawnSync("node", ["scripts/inspect-irpkg.mjs", "build/generated/vir-demo.irpkg"], {
  encoding: "utf8",
});
assert.equal(inspected.status, 0, inspected.stderr || inspected.stdout);
assert.match(inspected.stdout, /package: build\/generated\/vir-demo\.irpkg/);
assert.match(inspected.stdout, new RegExp(`exports: ${runtime.interfaceManifest.exports.length}`));
assert.match(inspected.stdout, /fib\(arg1: Nat\) -> Nat \[fib\]/);

const inspectedJson = spawnSync("node", ["scripts/inspect-irpkg.mjs", "--json", "build/generated/vir-demo.irpkg"], {
  encoding: "utf8",
});
assert.equal(inspectedJson.status, 0, inspectedJson.stderr || inspectedJson.stdout);
const inspectedInfo = JSON.parse(inspectedJson.stdout);
assert.equal(inspectedInfo.package.version, 4);
assert.equal(inspectedInfo.package.declarationCount, runtime.packageInfo.count);
assert.equal(inspectedInfo.manifest.exports.length, runtime.interfaceManifest.exports.length);
assert.equal(runtime.exportsByName.SortDemo_demo(), "192");
assert.equal(runtime.call("SortDemo.demo"), "192");
assert.equal(runtime.call("fib", 12), "144");
assert.equal(runtime.call("SortDemo.demoFromArray", [4, 1, 3, 2]), "30");
assert.equal(runtime.call("Vir.Fixtures.Basic.stringUtf8RoundtripScore", "Aé∀Z"), "1381");
assert.equal(runtime.call("Vir.Fixtures.Basic.byteArrayInputScore", [65, 66, 67]), "136");
assert.equal(runtime.call("Tamagotchi.step", "happy", "ignore"), "hungry");
assert.equal(runtime.call("Tamagotchi.step", "hungry", "feed"), "happy");
assert.deepEqual(runtime.call("Vir.Fixtures.ExprPrinter.constNatExpr"), {
  kind: "const",
  name: "Nat",
  levels: [],
});
assert.deepEqual(runtime.call("Vir.Fixtures.ExprPrinter.twoLitExpr"), {
  kind: "lit",
  literal: { kind: "nat", value: "2" },
});
assert.deepEqual(runtime.call("Vir.Fixtures.ExprPrinter.appExpr"), {
  kind: "app",
  fn: { kind: "const", name: "Nat.succ", levels: [] },
  arg: { kind: "lit", literal: { kind: "nat", value: "2" } },
});
assert.deepEqual(runtime.call("Vir.Fixtures.ExprPrinter.sortParamExpr"), {
  kind: "sort",
  level: { kind: "succ", of: { kind: "param", name: "u" } },
});
assert.deepEqual(runtime.call("Vir.Fixtures.ExprPrinter.fvarExpr"), {
  kind: "fvar",
  name: "x",
});
assert.deepEqual(runtime.call("Vir.Fixtures.ExprPrinter.mvarExpr"), {
  kind: "mvar",
  name: "m",
});
assert.deepEqual(runtime.call("Vir.Fixtures.ExprPrinter.lambdaExpr"), {
  kind: "lam",
  name: "x",
  type: { kind: "const", name: "Nat", levels: [] },
  body: { kind: "bvar", index: "0" },
  binderInfo: "default",
});
assert.deepEqual(runtime.call("Vir.Fixtures.ExprPrinter.forallExpr"), {
  kind: "forall",
  name: "x",
  type: { kind: "const", name: "Nat", levels: [] },
  body: { kind: "bvar", index: "0" },
  binderInfo: "implicit",
});
assert.deepEqual(runtime.call("Vir.Fixtures.ExprPrinter.letExpr"), {
  kind: "let",
  name: "x",
  type: { kind: "const", name: "Nat", levels: [] },
  value: { kind: "lit", literal: { kind: "nat", value: "2" } },
  body: { kind: "bvar", index: "0" },
  nondep: false,
});
assert.deepEqual(runtime.call("Vir.Fixtures.ExprPrinter.stringLitExpr"), {
  kind: "lit",
  literal: { kind: "string", value: "hi" },
});
assert.deepEqual(runtime.call("Vir.Fixtures.ExprPrinter.mdataExpr"), {
  kind: "mdata",
  expr: { kind: "bvar", index: "0" },
});
assert.deepEqual(runtime.call("Vir.Fixtures.ExprPrinter.projExpr"), {
  kind: "proj",
  typeName: "Prod",
  index: "1",
  struct: { kind: "const", name: "p", levels: [] },
});
assert.equal(runtime.call("Vir.Fixtures.ExprPrinter.exprCoverageScore"), "1232");
assert.equal(runtime.call("Vir.Fixtures.ExprPrinter.exprKindScore", { kind: "bvar", index: 4 }), "5");
assert.equal(runtime.call("Vir.Fixtures.ExprPrinter.exprKindScore", { kind: "lit", literal: { kind: "nat", value: 2 } }), "102");
assert.deepEqual(runtime.call("Vir.Fixtures.ExprPrinter.bumpBVar", { kind: "bvar", index: 4 }), {
  kind: "bvar",
  index: "5",
});
assert.deepEqual(runtime.call("Vir.Fixtures.ListOption.classifySum", 0), {
  kind: "inl",
  value: "10",
});
assert.deepEqual(runtime.call("Vir.Fixtures.ListOption.classifySum", 4), {
  kind: "inr",
  value: "4",
});
assert.equal(runtime.call("Vir.Fixtures.ListOption.sumScore", { kind: "inr", value: 7 }), "70");
assert.equal(runtime.call("Vir.Fixtures.ListOption.sumScore", { inl: 12 }), "12");
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
assert.equal(runtime.call("Vir.Fixtures.InterfaceShapes.arrayStringTotalLength", ["a", "bc"]), "3");
assert.equal(runtime.call("Vir.Fixtures.InterfaceShapes.listUInt32Sum", [1, 2, 3]), "6");
assert.equal(runtime.call("Vir.Fixtures.InterfaceShapes.uint32Bump", 41), 42);
assert.equal(runtime.call("Vir.Fixtures.InterfaceShapes.optionNatBump", null), "0");
assert.equal(runtime.call("Vir.Fixtures.InterfaceShapes.optionNatBump", { kind: "some", value: 41 }), "42");
assert.equal(runtime.call("Vir.Fixtures.InterfaceShapes.optionStringBang", null), "empty");
assert.equal(runtime.call("Vir.Fixtures.InterfaceShapes.optionStringBang", "ok"), "ok!");
assert.equal(runtime.call("Vir.Fixtures.InterfaceShapes.optionNatScore", { some: 6 }), "17");
assert.deepEqual(runtime.call("Vir.Fixtures.InterfaceShapes.prodNatNatSwap", { fst: 2, snd: 9 }), {
  fst: "9",
  snd: "2",
});
assert.equal(runtime.call("Vir.Fixtures.InterfaceShapes.prodNatNatSum", [4, 5]), "9");
assert.equal(runtime.call("Vir.Fixtures.InterfaceShapes.optionArrayNatSum", [4, 5, 6]), "15");
assert.equal(runtime.call("Vir.Fixtures.InterfaceShapes.optionArrayNatSum", null), "0");
assert.equal(runtime.call("Vir.Fixtures.InterfaceShapes.listProdNatStringScore", [
  { fst: 4, snd: "ab" },
  [5, "c"],
]), "12");
assert.deepEqual(runtime.call("Vir.Fixtures.InterfaceShapes.prodStringNatSwap", { fst: "ok", snd: 6 }), {
  fst: "7",
  snd: "ok!",
});
assert.equal(runtime.call("Vir.Fixtures.InterfaceShapes.arrayExprKindScore", [
  { kind: "const", name: "Nat", levels: [] },
  { kind: "bvar", index: 2 },
]), "13");
assert.deepEqual(runtime.call("Vir.Fixtures.InterfaceShapes.optionExprBump", { kind: "bvar", index: 6 }), {
  kind: "bvar",
  index: "7",
});
assert.deepEqual(runtime.call("Vir.Fixtures.InterfaceShapes.profileBump", {
  nickname: "lean",
  points: 4,
  tags: ["ir", "wasm"],
}), {
  nickname: "lean!",
  points: "6",
  tags: ["ir", "wasm"],
});
assert.equal(runtime.call("Vir.Fixtures.InterfaceShapes.profileScore", {
  nickname: "lean",
  points: 4,
  tags: ["ir", "wasm"],
}), "14");
assert.deepEqual(runtime.call("Vir.Fixtures.InterfaceShapes.profileSummary", {
  nickname: "lean",
  points: 4,
  tags: ["ir", "wasm"],
}), {
  label: "lean:2",
  total: "14",
  bonus: "14",
});
assert.equal(runtime.call("Vir.Fixtures.InterfaceShapes.profileEnvelopeScore", {
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
}), "48");
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
const profileStatsEntry = runtime.interfaceManifest.exports.find(
  (entry) => entry.entry === "Vir.Fixtures.InterfaceShapes.profileStatsBump",
);
assert.equal(profileStatsEntry.args[0].type.objectFieldCount, 1);
assert.equal(profileStatsEntry.args[0].type.usizeFieldCount, 1);
assert.equal(profileStatsEntry.args[0].type.scalarByteSize, 17);
assert.deepEqual(
  profileStatsEntry.args[0].type.fields.map((field) => [field.name, field.layout.kind]),
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
assert.deepEqual(runtime.call("Vir.Fixtures.InterfaceShapes.profileStatsBump", profileStatsInput), {
  enabled: false,
  level: 3,
  score16: 32,
  visits: 403,
  quota: "9",
  checksum: "6005",
  tier: "elite",
  note: "ok!",
});
assert.equal(runtime.call("Vir.Fixtures.InterfaceShapes.profileStatsScore", profileStatsInput), "6549");
assert.deepEqual(runtime.call("Vir.Fixtures.InterfaceShapes.boxNatBump", { value: 41 }), {
  value: "42",
});
const boxNatEntry = runtime.interfaceManifest.exports.find(
  (entry) => entry.entry === "Vir.Fixtures.InterfaceShapes.boxNatBump",
);
assert.equal(boxNatEntry.args[0].type.type, "Vir.Fixtures.InterfaceShapes.Box Nat");
assert.equal(boxNatEntry.args[0].type.trivialFieldIndex, 0);
const boxUInt32Entry = runtime.interfaceManifest.exports.find(
  (entry) => entry.entry === "Vir.Fixtures.InterfaceShapes.boxUInt32Bump",
);
assert.equal(boxUInt32Entry.args[0].type.type, "Vir.Fixtures.InterfaceShapes.Box UInt32");
assert.equal(boxUInt32Entry.args[0].type.trivialFieldIndex, 0);
assert.equal(boxUInt32Entry.args[0].type.fields[0].type.wireTag, 6);
assert.equal(boxUInt32Entry.args[0].type.fields[0].layout.kind, "object");
assert.deepEqual(runtime.call("Vir.Fixtures.InterfaceShapes.boxUInt32Bump", {
  value: 41,
}), {
  value: 42,
});
const uint32BoxEntry = runtime.interfaceManifest.exports.find(
  (entry) => entry.entry === "Vir.Fixtures.InterfaceShapes.uint32BoxBump",
);
assert.equal(uint32BoxEntry.args[0].type.type, "Vir.Fixtures.InterfaceShapes.UInt32Box");
assert.equal(uint32BoxEntry.args[0].type.trivialFieldIndex, 0);
assert.equal(uint32BoxEntry.args[0].type.fields[0].type.wireTag, 6);
assert.equal(uint32BoxEntry.args[0].type.fields[0].layout.kind, "scalar");
assert.deepEqual(runtime.call("Vir.Fixtures.InterfaceShapes.uint32BoxBump", {
  value: 41,
}), {
  value: 42,
});
assert.deepEqual(runtime.call("Vir.Fixtures.InterfaceShapes.nestedBoxNatBump", {
  value: { value: 4 },
}), {
  value: { value: "5" },
});
assert.equal(runtime.call("Vir.Fixtures.InterfaceShapes.taggedArrayScore", {
  label: "ab",
  payload: ["x", "yz"],
}), "5");
assert.deepEqual(runtime.call("Vir.Fixtures.InterfaceShapes.taggedProfileBump", {
  label: "profile",
  payload: {
    nickname: "lean",
    points: 4,
    tags: ["ir", "wasm"],
  },
}), {
  label: "profile!",
  payload: {
    nickname: "lean!",
    points: "6",
    tags: ["ir", "wasm"],
  },
});
assert.deepEqual(runtime.call("Vir.Fixtures.InterfaceShapes.meteredBoxBump", {
  active: false,
  count: 3,
  payload: { value: 4 },
}), {
  active: true,
  count: 4,
  payload: { value: "7" },
});
assert.equal(runtime.call("Vir.Fixtures.InterfaceShapes.boxExprKindScore", {
  value: { kind: "const", name: "Nat", levels: [] },
}), "10");
const extendedProfileInput = {
  nickname: "lean",
  active: true,
  visits: 5,
  score: 7,
  tags: ["ir"],
};
const extendedProfileEntry = runtime.interfaceManifest.exports.find(
  (entry) => entry.entry === "Vir.Fixtures.InterfaceShapes.extendedProfileBump",
);
assert.deepEqual(
  extendedProfileEntry.args[0].type.fields.map((field) => [field.name, field.subobject === true]),
  [["toProfileBase", true], ["score", false], ["tags", false]],
);
assert.deepEqual(runtime.call("Vir.Fixtures.InterfaceShapes.extendedProfileBump", extendedProfileInput), {
  nickname: "lean!",
  active: false,
  visits: 6,
  score: "8",
  tags: ["ir", "extended"],
});
assert.equal(runtime.call("Vir.Fixtures.InterfaceShapes.extendedProfileScore", extendedProfileInput), "118");
assert.throws(
  () => runtime.call("Vir.Fixtures.InterfaceShapes.extendedProfileScore", {
    toProfileBase: { nickname: "nested", active: true, visits: 1 },
    ...extendedProfileInput,
  }),
  /mixes toProfileBase with flattened inherited fields/,
);
assert.throws(
  () => runtime.call("Vir.Fixtures.InterfaceShapes.profileScore", {
    nickname: "lean",
    points: 4,
  }),
  /profileScore argument profile is missing field tags/,
);

const factory = createVirRuntimeFactory({ wasmBytes });
const unloaded = await factory.createRuntime();
assert.equal(unloaded.packageInfo, null);
assert.equal(unloaded.packageDeclCount(), 0);
assert.throws(
  () => unloaded.call("fib", 8),
  /interface entry not found: fib/,
);
const first = await factory.createRuntime({ irPackageBytes });
const second = await factory.createRuntime({ irPackageBytes });
assert.equal(first.call("SortDemo.demo"), "192");
assert.equal(second.call("fib", 8), "21");

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
assert.equal(badPackageRuntime.packageInfo, null);
assert.equal(badPackageRuntime.interfaceManifest, null);
assert.equal(badPackageRuntime.packageMetadata, null);
assert.equal(badPackageRuntime.packageDeclCount(), 0);

assert.throws(
  () => first.loadIrPackageBytes(badPackage),
  /invalid IR package magic/,
);
assert.equal(first.packageInfo, null);
assert.equal(first.interfaceManifest, null);
assert.equal(first.packageMetadata, null);
assert.equal(first.packageDeclCount(), 0);
assert.throws(
  () => first.call("fib", 8),
  /interface entry not found: fib/,
);

assert.throws(
  () => runtime.call("fib", -1),
  /fib argument arg1 must be non-negative/,
);

const freshDir = await mkdtemp(join(tmpdir(), "lean-vir-fresh-"));
try {
  const freshSource = join(freshDir, "FreshUser.lean");
  const freshPackage = join(freshDir, "fresh.irpkg");
  await writeFile(freshSource, [
    "inductive FreshMode where",
    "  | cold",
    "  | hot",
    "",
    "structure FreshBox where",
    "  label : String",
    "  value : Nat",
    "  enabled : Bool",
    "  hits : UInt32",
    "  quota : USize",
    "  mode : FreshMode",
    "",
    "structure FreshWrap (α : Type) where",
    "  label : String",
    "  payload : α",
    "",
    "structure FreshScalarBox where",
    "  value : UInt32",
    "",
    "def freshBump (n : Nat) : Nat := n + 7",
    "def freshSum (xs : Array Nat) : Nat := xs.foldl (fun acc n => acc + n) 0",
    "def freshPairSum (p : Nat × Nat) : Nat := p.fst + p.snd",
    "def freshClassifySum (n : Nat) : Sum Nat String :=",
    "  if n < 3 then .inl (n + 10) else .inr (toString n)",
    "",
    "def freshSumScore : Sum Nat String → Nat",
    "  | .inl n => n",
    "  | .inr text => text.length + 20",
    "",
    "def freshClassifyExcept (n : Nat) : Except String Nat :=",
    "  if n = 0 then .error \"zero\" else .ok (n + 1)",
    "",
    "def freshBoxBump (box : FreshBox) : FreshBox :=",
    "  { box with",
    "    value := box.value + box.label.length",
    "    enabled := !box.enabled",
    "    hits := box.hits + 1",
    "    quota := box.quota + 2",
    "    mode := .hot }",
    "",
    "def freshWrapBoxBump (wrap : FreshWrap FreshBox) : FreshWrap FreshBox :=",
    "  { label := wrap.label ++ \"!\", payload := freshBoxBump wrap.payload }",
    "",
    "def freshWrapUInt32Bump (wrap : FreshWrap UInt32) : FreshWrap UInt32 :=",
    "  { label := wrap.label ++ \"!\", payload := wrap.payload + 1 }",
    "",
    "def freshScalarBoxBump (box : FreshScalarBox) : FreshScalarBox :=",
    "  { value := box.value + 1 }",
    "",
  ].join("\n"));

  const generated = spawnSync(
    "bash",
    ["scripts/lean-to-irpkg.sh", freshSource, freshPackage],
    { encoding: "utf8" },
  );
  assert.equal(generated.status, 0, generated.stderr || generated.stdout);
  assert.match(generated.stdout, /mode:\s+auto-discover public definitions/);
  assert.match(generated.stdout, /local package ready/);

  const freshRuntime = await factory.createRuntime({ irPackageBytes: await readFile(freshPackage) });
  const freshManifest = freshRuntime.interfaceManifest;
  assert.equal(freshManifest.metadata.packageFormatVersion, 4);
  assert.equal(freshManifest.metadata.manifestVersion, 1);
  assert.match(freshManifest.metadata.leanToolchain, /leanprover\/lean4/);
  assert.ok(freshManifest.metadata.generatedAt.length > 0);
  assert.equal(freshManifest.metadata.targets.length, 1);
  assert.equal(freshManifest.metadata.targets[0].source, freshSource);
  assert.equal(freshManifest.metadata.targets[0].mode, "all");
  assert.deepEqual(freshManifest.metadata.targets[0].roots, []);
  assert.ok(freshManifest.metadata.targets[0].resolvedRoots.includes("freshBump"));
  assertManifestTypeDescriptorsRoundTrip(freshManifest);

  const freshEntries = freshManifest.exports.map((entry) => entry.entry).sort();
  assert.deepEqual(freshEntries, [
    "freshBoxBump",
    "freshBump",
    "freshClassifyExcept",
    "freshClassifySum",
    "freshPairSum",
    "freshScalarBoxBump",
    "freshSum",
    "freshSumScore",
    "freshWrapBoxBump",
    "freshWrapUInt32Bump",
  ]);
  const freshInspect = spawnSync("node", ["scripts/inspect-irpkg.mjs", "--json", freshPackage], {
    encoding: "utf8",
  });
  assert.equal(freshInspect.status, 0, freshInspect.stderr || freshInspect.stdout);
  const freshInfo = JSON.parse(freshInspect.stdout);
  assert.equal(freshInfo.manifest.metadata.targets[0].source, freshSource);
  assert.deepEqual(freshInfo.manifest.exports.map((entry) => entry.entry).sort(), freshEntries);
  assert.equal(freshRuntime.call("freshBump", 35), "42");
  assert.equal(freshRuntime.exportsByName.freshBump(1), "8");
  assert.equal(freshRuntime.call("freshSum", [4, 5, 6]), "15");
  assert.equal(freshRuntime.call("freshPairSum", { fst: 7, snd: 8 }), "15");
  assert.deepEqual(freshRuntime.call("freshClassifySum", 2), {
    kind: "inl",
    value: "12",
  });
  assert.deepEqual(freshRuntime.call("freshClassifySum", 5), {
    kind: "inr",
    value: "5",
  });
  assert.equal(freshRuntime.call("freshSumScore", { kind: "inr", value: "lean" }), "24");
  assert.deepEqual(freshRuntime.call("freshClassifyExcept", 0), {
    kind: "error",
    value: "zero",
  });
  assert.deepEqual(freshRuntime.call("freshClassifyExcept", 6), {
    kind: "ok",
    value: "7",
  });
  assert.deepEqual(freshRuntime.call("freshBoxBump", {
    label: "abc",
    value: 4,
    enabled: false,
    hits: 7,
    quota: 8,
    mode: "cold",
  }), {
    label: "abc",
    value: "7",
    enabled: true,
    hits: 8,
    quota: "10",
    mode: "hot",
  });
  const freshWrapUInt32Entry = freshManifest.exports.find((entry) => entry.entry === "freshWrapUInt32Bump");
  assert.equal(freshWrapUInt32Entry.args[0].type.type, "FreshWrap UInt32");
  assert.equal(freshWrapUInt32Entry.args[0].type.fields[1].type.wireTag, 6);
  assert.equal(freshWrapUInt32Entry.args[0].type.fields[1].layout.kind, "object");
  assert.deepEqual(freshRuntime.call("freshWrapUInt32Bump", {
    label: "u",
    payload: 9,
  }), {
    label: "u!",
    payload: 10,
  });
  const freshScalarBoxEntry = freshManifest.exports.find((entry) => entry.entry === "freshScalarBoxBump");
  assert.equal(freshScalarBoxEntry.args[0].type.trivialFieldIndex, 0);
  assert.equal(freshScalarBoxEntry.args[0].type.fields[0].layout.kind, "scalar");
  assert.deepEqual(freshRuntime.call("freshScalarBoxBump", {
    value: 9,
  }), {
    value: 10,
  });
  assert.deepEqual(freshRuntime.call("freshWrapBoxBump", {
    label: "box",
    payload: {
      label: "abc",
      value: 4,
      enabled: false,
      hits: 7,
      quota: 8,
      mode: "cold",
    },
  }), {
    label: "box!",
    payload: {
      label: "abc",
      value: "7",
      enabled: true,
      hits: 8,
      quota: "10",
      mode: "hot",
    },
  });

  await assertUnsupportedInterfaceSource(freshDir, "UnsupportedInterfaces", [
    "structure BadCounter where",
    "  callback : Nat → Nat",
    "",
    "structure RecursiveBox where",
    "  next : Option RecursiveBox",
    "",
    "inductive IndexedBox : Nat → Type where",
    "  | mk {n : Nat} (value : Nat) : IndexedBox n",
    "",
    "def badCounterIdentity (box : BadCounter) : BadCounter := box",
    "def recursiveBoxIdentity (box : RecursiveBox) : RecursiveBox := box",
    "def indexedBoxIdentity (box : IndexedBox 3) : IndexedBox 3 := box",
    "def implicitBump {offset : Nat} (n : Nat) : Nat := n + offset",
    "def uint64Identity (n : UInt64) : UInt64 := n + 1",
    "",
  ], [
    /badCounterIdentity/,
    /field `callback`/,
    /recursiveBoxIdentity/,
    /recursive structure `RecursiveBox` is not supported/,
    /indexedBoxIdentity/,
    /unsupported type `IndexedBox/,
    /implicitBump/,
    /unsupported implicit\/instance argument `offset`/,
    /uint64Identity/,
    /top-level UInt64 is not supported/,
  ]);
} finally {
  await rm(freshDir, { recursive: true, force: true });
}

console.log(
  `vir runtime smoke ok: ${runtime.packageInfo.count} declarations, SortDemo.demo = 192, fib 12 = 144`,
);
