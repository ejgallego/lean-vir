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
import { createVirRuntime, createVirRuntimeFactory } from "../web/src/vir-runtime.js";

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
assert.equal(runtime.call("Vir.Fixtures.InterfaceShapes.arrayStringTotalLength", ["a", "bc"]), "3");
assert.equal(runtime.call("Vir.Fixtures.InterfaceShapes.listUInt32Sum", [1, 2, 3]), "6");
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
    "def freshBump (n : Nat) : Nat := n + 7",
    "def freshSum (xs : Array Nat) : Nat := xs.foldl (fun acc n => acc + n) 0",
    "def freshPairSum (p : Nat × Nat) : Nat := p.fst + p.snd",
    "def freshBoxBump (box : FreshBox) : FreshBox :=",
    "  { box with",
    "    value := box.value + box.label.length",
    "    enabled := !box.enabled",
    "    hits := box.hits + 1",
    "    quota := box.quota + 2",
    "    mode := .hot }",
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

  const freshEntries = freshManifest.exports.map((entry) => entry.entry).sort();
  assert.deepEqual(freshEntries, ["freshBoxBump", "freshBump", "freshPairSum", "freshSum"]);
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

  const unsupportedStructureSource = join(freshDir, "UnsupportedStructure.lean");
  const unsupportedStructurePackage = join(freshDir, "unsupported-structure.irpkg");
  const unsupportedStructureReport = join(freshDir, "unsupported-structure.report.md");
  await writeFile(unsupportedStructureSource, [
    "structure BadCounter where",
    "  callback : Nat → Nat",
    "",
    "def badCounterIdentity (box : BadCounter) : BadCounter := box",
    "",
  ].join("\n"));
  const unsupportedStructure = spawnSync(
    "lean",
    [
      "--run",
      "tools/GeneratePackage.lean",
      unsupportedStructurePackage,
      unsupportedStructureReport,
      "--target-all",
      unsupportedStructureSource,
    ],
    { encoding: "utf8" },
  );
  assert.notEqual(unsupportedStructure.status, 0);
  assert.match(unsupportedStructure.stderr, /unsupported interface exports/);
  assert.match(unsupportedStructure.stderr, /badCounterIdentity/);
  assert.match(unsupportedStructure.stderr, /field `callback`/);
} finally {
  await rm(freshDir, { recursive: true, force: true });
}

const unsupportedAll = spawnSync(
  "lean",
  [
    "--run",
    "tools/GeneratePackage.lean",
    "/tmp/vir-unsupported-interface.irpkg",
    "/tmp/vir-unsupported-interface.report.md",
    "--target-all",
    "fixtures/ListOption.lean",
  ],
  { encoding: "utf8" },
);
assert.notEqual(unsupportedAll.status, 0);
assert.match(unsupportedAll.stderr, /unsupported interface exports/);
assert.match(unsupportedAll.stderr, /Vir\.Fixtures\.ListOption\.classifySum/);

console.log(
  `vir runtime smoke ok: ${runtime.packageInfo.count} declarations, SortDemo.demo = 192, fib 12 = 144`,
);
