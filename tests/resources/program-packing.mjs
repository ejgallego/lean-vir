/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  linkSync,
  mkdtempSync,
  readFileSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Run after building both native resource tools and the BrowserProgram :vir fixture.
const repo = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const tool = join(repo, ".lake/build/bin/vir_resource_program");
const packTool = join(repo, ".lake/build/bin/vir_resource_pack");
const setup = join(
  repo,
  ".lake/build/vir/module-sets/tests/resources/BrowserProgram.setup.json",
);
const compat = join(repo, "vir-resources/compatibility.json");
assert.ok(existsSync(tool) && existsSync(setup));
const evidence = mkdtempSync(join(repo, "build/resource-program-"));
const recipePath = join(evidence, "recipe.json");
const runtimeLockPath = join(evidence, "runtime-lock.json");
const packPath = join(evidence, "program.virres");
const stagedPath = join(evidence, "stage", "program.virres");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const recipe = {
  schemaVersion: 1,
  logicalId: "resource-program-test/pretty",
  module: "tests.resources.BrowserProgram",
  exports: [
    {
      role: "prettyM",
      declaration: "Vir.Resources.Test.prettyScore",
      interfaceId: "vir-pretty-test-v1",
    },
  ],
  supportFiles: [
    {
      source: "tests/resources/BrowserProgram.lean",
      path: "support/BrowserProgram.lean",
      mediaType: "text/plain",
    },
  ],
};
const writeRecipe = (value) => writeFileSync(recipePath, JSON.stringify(value));
const runtimeLock = {
  schemaVersion: 1,
  contentId: "a".repeat(64),
  source: "tests/resources/BrowserProgram.lean",
};
const writeRuntimeLock = (value) =>
  writeFileSync(runtimeLockPath, JSON.stringify(value));
function run(label, args, error) {
  const command = ["runtime-plan", "stage"].includes(args[0]) ? packTool : tool;
  const result = spawnSync("lake", ["env", command, ...args], {
    cwd: repo,
    encoding: "utf8",
    timeout: 180000,
  });
  const log = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  writeFileSync(join(evidence, `${label}.log`), log);
  if (result.error) throw result.error;
  if (error) {
    assert.notEqual(result.status, 0, `${label}: ${log}`);
    assert.match(log, error, label);
  } else assert.equal(result.status, 0, `${label}: ${log}`);
  return result.stdout.trim();
}
const plan = () => run("plan", ["plan", recipePath, compat, repo]);
const build = (label, error) => {
  const stdout = run(
    label,
    ["build", recipePath, compat, setup, repo, packPath],
    error,
  );
  return stdout.split("\n").at(-1);
};
writeRecipe(recipe);
writeRuntimeLock(runtimeLock);
const runtimePlan = (label, error) =>
  run(label, ["runtime-plan", compat, runtimeLockPath, repo], error);
assert.deepEqual(JSON.parse(runtimePlan("runtime-plan-local")), {
  contentId: runtimeLock.contentId,
  source: join(repo, runtimeLock.source),
});
writeRuntimeLock({ ...runtimeLock, source: "-" });
assert.equal(JSON.parse(runtimePlan("runtime-plan-offline")).source, "-");
writeRuntimeLock({
  ...runtimeLock,
  source: "https://example.invalid/program.virres",
});
assert.equal(
  JSON.parse(runtimePlan("runtime-plan-https")).source,
  "https://example.invalid/program.virres",
);
writeRuntimeLock({ ...runtimeLock, source: "../elsewhere" });
runtimePlan("runtime-plan-traversal", /INVALID_RUNTIME_LOCK/);
writeRuntimeLock({ ...runtimeLock, contentId: "INVALID" });
runtimePlan("runtime-plan-id", /INVALID_RUNTIME_LOCK/);
writeRuntimeLock({ ...runtimeLock, extra: true });
runtimePlan("runtime-plan-unknown", /INVALID_RUNTIME_LOCK/);
writeRuntimeLock(runtimeLock);
assert.deepEqual(JSON.parse(plan()), {
  module: "tests.resources.BrowserProgram",
  supportFiles: ["tests/resources/BrowserProgram.lean"],
});
const firstId = build("build-cold");
assert.match(firstId, /^[0-9a-f]{64}$/);
const first = readFileSync(packPath);
assert.equal(first.subarray(0, 8).toString("hex"), "5649525245530001");
const descriptorLength = first.readUInt32LE(8);
const descriptor = JSON.parse(first.subarray(12, 12 + descriptorLength));
assert.equal(descriptor.logicalId, recipe.logicalId);
assert.equal(descriptor.kind, "program");
assert.deepEqual(descriptor.exports, recipe.exports);
assert.equal(descriptor.fileEntries[0].role, "programSet");
assert.equal(descriptor.fileEntries[0].path, "program.irpkg-set.json");
assert.ok(descriptor.files.some((f) => f.path === "program.irpkg"));
assert.ok(
  descriptor.files.some((f) => f.path === "support/BrowserProgram.lean"),
);
assert.equal(
  firstId,
  hash(
    Buffer.concat([
      Buffer.from("vir-resource-bundle-v1\n"),
      first.subarray(12, 12 + descriptorLength),
    ]),
  ),
);
let offset = 12 + descriptorLength;
const payload = new Map();
for (const file of descriptor.files) {
  const bytes = first.subarray(offset, offset + file.byteLength);
  assert.equal(hash(bytes), file.sha256);
  payload.set(file.path, bytes);
  offset += file.byteLength;
}
assert.equal(offset, first.length);
const set = JSON.parse(payload.get("program.irpkg-set.json"));
assert.equal(set.packages.at(-1).module, "tests.resources.BrowserProgram");
for (const member of set.packages) {
  assert.equal(hash(payload.get(member.path)), member.sha256);
  assert.equal(payload.get(member.path).length, member.byteLength);
}
const before = statSync(packPath, { bigint: true });
assert.equal(build("build-warm"), firstId);
const after = statSync(packPath, { bigint: true });
assert.equal(after.ino, before.ino);
assert.equal(after.mtimeNs, before.mtimeNs);
const oldPack = join(evidence, "old-pack-hardlink");
writeFileSync(oldPack, Buffer.alloc(first.length + 100, 0x4f));
unlinkSync(packPath);
linkSync(oldPack, packPath);
assert.equal(build("build-replace-larger-hardlink"), firstId);
assert.deepEqual(readFileSync(packPath), first);
assert.equal(statSync(oldPack).size, first.length + 100);
assert.notEqual(statSync(packPath).ino, statSync(oldPack).ino);
assert.equal(run("stage", ["stage", compat, packPath, stagedPath]), firstId);
assert.deepEqual(readFileSync(stagedPath), first);
const stageBefore = statSync(stagedPath, { bigint: true });
run("stage-warm", ["stage", compat, packPath, stagedPath]);
assert.equal(statSync(stagedPath, { bigint: true }).ino, stageBefore.ino);

// A prior good pack survives all validation failures.
writeRecipe({
  ...recipe,
  exports: [{ ...recipe.exports[0], declaration: "Missing.export" }],
});
build("missing-export", /required VIR interface export/);
assert.deepEqual(readFileSync(packPath), first);
writeRecipe({
  ...recipe,
  modules: ["tests.resources.BrowserProgram", "fixtures.Basic"],
});
run("multiple-roots", ["plan", recipePath, compat, repo], /INVALID_RECIPE/);
writeRecipe({ ...recipe, module: undefined, modules: [recipe.module] });
run(
  "obsolete-singleton",
  ["plan", recipePath, compat, repo],
  /obsolete `modules`/,
);
for (const [index, module] of [
  "",
  "Bad..Name",
  ["tests.resources.BrowserProgram"],
  "A".repeat(4097),
].entries()) {
  writeRecipe({ ...recipe, module });
  run(
    `invalid-module-${index}`,
    ["plan", recipePath, compat, repo],
    /INVALID_RECIPE/,
  );
}
writeRecipe({
  ...recipe,
  supportFiles: [{ ...recipe.supportFiles[0], source: "../outside" }],
});
run("traversal", ["plan", recipePath, compat, repo], /INVALID_RECIPE/);
writeRecipe({
  ...recipe,
  supportFiles: [{ ...recipe.supportFiles[0], path: "program.irpkg" }],
});
run("member-conflict", ["plan", recipePath, compat, repo], /INVALID_RECIPE/);
writeRecipe({ ...recipe, unknown: true });
run("unknown-field", ["plan", recipePath, compat, repo], /INVALID_RECIPE/);
writeFileSync(
  recipePath,
  JSON.stringify(recipe).replace(
    '"schemaVersion":1',
    '"schemaVersion":1,"schemaVersion":1',
  ),
);
run(
  "duplicate-field",
  ["plan", recipePath, compat, repo],
  /duplicate JSON key/,
);
writeRecipe(recipe);
const linkedSupport = join(evidence, "linked-support.lean");
symlinkSync(join(repo, recipe.supportFiles[0].source), linkedSupport);
writeRecipe({
  ...recipe,
  supportFiles: [
    { ...recipe.supportFiles[0], source: relative(repo, linkedSupport) },
  ],
});
run(
  "linked-support",
  ["plan", recipePath, compat, repo],
  /UNSAFE_RESOURCE_FILE/,
);
writeRecipe(recipe);

// Staging replaces a hardlink without mutating the other name, and rejects links.
const retained = join(evidence, "retained");
writeFileSync(retained, "old bytes");
unlinkSync(stagedPath);
linkSync(retained, stagedPath);
run("stage-hardlink", ["stage", compat, packPath, stagedPath]);
assert.deepEqual(readFileSync(stagedPath), first);
assert.equal(readFileSync(retained, "utf8"), "old bytes");
assert.notEqual(statSync(stagedPath).ino, statSync(retained).ino);
unlinkSync(stagedPath);
writeFileSync(retained, Buffer.alloc(first.length + 100, 0x5a));
linkSync(retained, stagedPath);
run("stage-larger-hardlink", ["stage", compat, packPath, stagedPath]);
assert.deepEqual(readFileSync(stagedPath), first);
assert.equal(statSync(retained).size, first.length + 100);
assert.notEqual(statSync(stagedPath).ino, statSync(retained).ino);
unlinkSync(stagedPath);
symlinkSync(retained, stagedPath);
run(
  "stage-symlink",
  ["stage", compat, packPath, stagedPath],
  /UNSAFE_RESOURCE_FILE/,
);
assert.equal(statSync(retained).size, first.length + 100);
assert.ok(existsSync(stagedPath));

const altered = Buffer.from(first);
const descriptorText = first
  .subarray(12, 12 + descriptorLength)
  .toString("utf8");
const changedText = descriptorText.replace(
  '"runtimeAbi":"2"',
  '"runtimeAbi":"3"',
);
assert.equal(changedText.length, descriptorText.length);
Buffer.from(changedText).copy(altered, 12);
const incompatiblePath = join(evidence, "incompatible.virres");
writeFileSync(incompatiblePath, altered);
run(
  "stage-incompatible",
  ["stage", compat, incompatiblePath, packPath],
  /INCOMPATIBLE/,
);
assert.deepEqual(readFileSync(packPath), first);

console.log(
  `program packing: compiled export, complete members, deterministic bytes, strict inputs and safe staging passed (${firstId})`,
);
