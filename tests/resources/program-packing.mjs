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
import { encodeDescriptor } from "../../web/src/resources/descriptor.js";
import {
  irPackageManifestChecksum,
  readIrPackageInfo,
} from "../../web/src/runtime/ir-package.js";

// Run after building both native resource tools and the BrowserProgram :vir fixture.
const repo = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const tool = join(repo, ".lake/build/bin/vir_resource_program");
const packTool = join(repo, ".lake/build/bin/vir_resource_pack");
const programTool = join(repo, ".lake/build/bin/vir_program");
const program = join(
  repo,
  ".lake/build/vir/programs/tests/resources/BrowserProgram.virprogram",
);
const compat = join(repo, "vir-resources/compatibility.json");
assert.ok(existsSync(tool) && existsSync(program));
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
  const command =
    args[0] === "verify"
      ? programTool
      : ["runtime-plan", "stage"].includes(args[0])
        ? packTool
        : tool;
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
const build = (label, error, input = program) => {
  const stdout = run(
    label,
    ["build", recipePath, compat, input, repo, packPath],
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
for (const [i, source] of [
  "https://user:pass@example.invalid/program.virres",
  "https://user@example.invalid/program.virres",
  "https://user%40name:pass@example.invalid/program.virres",
  "https://?query/no-host",
  "https://#fragment/no-host",
  "https://example.invalid/with space",
].entries()) {
  writeRuntimeLock({ ...runtimeLock, source });
  runtimePlan(`runtime-plan-invalid-https-${i}`, /INVALID_RUNTIME_LOCK/);
}
// An @ in the path is not URL userinfo.
writeRuntimeLock({ ...runtimeLock, source: "https://example.invalid/path@name" });
assert.equal(
  JSON.parse(runtimePlan("runtime-plan-https-path-at")).source,
  "https://example.invalid/path@name",
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
for (const path of ["bundle.json/child", "BUNDLE.JSON/child/nested"]) {
  writeRecipe({
    ...recipe,
    supportFiles: [{ ...recipe.supportFiles[0], path }],
  });
  build("reserved-envelope-prefix", /INVALID_RECIPE/);
  assert.deepEqual(readFileSync(packPath), first);
}
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
  `"virVersion":${descriptor.compatibility.virVersion}`,
  `"virVersion":2`,
);
assert.notEqual(changedText, descriptorText, "compatibility negative must change virVersion");
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

// Valid outer transport must not conceal an invalid inner package-set contract.
const canonical = readFileSync(program);
const canonicalLength = canonical.readUInt32LE(8);
const canonicalDescriptor = JSON.parse(
  canonical.subarray(12, 12 + canonicalLength),
);
let canonicalOffset = 12 + canonicalLength;
const canonicalFiles = new Map(
  canonicalDescriptor.files.map((file) => {
    const bytes = canonical.subarray(
      canonicalOffset,
      canonicalOffset + file.byteLength,
    );
    canonicalOffset += file.byteLength;
    return [file.path, bytes];
  }),
);
function writeCanonical(label, mutate) {
  const descriptor = structuredClone(canonicalDescriptor);
  const files = new Map(canonicalFiles);
  mutate(descriptor, files);
  descriptor.files = descriptor.files.map((file) => ({
    ...file,
    byteLength: files.get(file.path).length,
    sha256: hash(files.get(file.path)),
  }));
  const json = Buffer.from(encodeDescriptor(descriptor));
  const size = Buffer.alloc(4);
  size.writeUInt32LE(json.length);
  const path = join(evidence, `${label}.virprogram`);
  writeFileSync(
    path,
    Buffer.concat([
      canonical.subarray(0, 8),
      size,
      json,
      ...descriptor.files.map((file) => files.get(file.path)),
    ]),
  );
  return path;
}
run("canonical-verified", ["verify", program, recipe.module]);
// Exercise public in-memory admission, not only read -> Pack.decode -> check.
const direct = spawnSync("lake", ["env", "lean", "--run",
  "tests/resources/ProgramCheck.lean", program, recipe.module], {
  cwd: repo, encoding: "utf8", timeout: 180000,
});
const directLog = `${direct.stdout ?? ""}${direct.stderr ?? ""}`;
writeFileSync(join(evidence, "direct-program-check.log"), directLog);
assert.ifError(direct.error);
assert.equal(direct.status, 0, directLog);
// Mutate valid inner metadata while preserving lengths, FNV checksums and every
// package-set/outer hash. Integrity checks must not hide missing compatibility
// checks, and both the root and dependency members must be admitted independently.
function mutateInterface(files, role, transform) {
  const set = JSON.parse(files.get("program.irpkg-set.json"));
  const member = set.packages.find((entry) => entry.role === role);
  assert.ok(member, `fixture requires a ${role} member`);
  const bytes = Buffer.from(files.get(member.path));
  const info = readIrPackageInfo(bytes);
  const section = info.package.sections.find((entry) => entry.kind === 5);
  const start = section.offset + 12;
  const original = bytes.subarray(start, section.offset + section.byteLength);
  const changed = Buffer.from(transform(original.toString(), info.manifest));
  assert.notDeepEqual(changed, original);
  assert.equal(changed.length, original.length, "mutation must preserve section layout");
  changed.copy(bytes, start);
  bytes.writeBigUInt64LE(irPackageManifestChecksum(changed), section.offset);
  files.set(member.path, bytes);
  member.sha256 = hash(bytes);
  files.set("program.irpkg-set.json", Buffer.from(JSON.stringify(set)));
}
function mutateMemberBytes(files, role, transform) {
  const set = JSON.parse(files.get("program.irpkg-set.json"));
  const member = set.packages.find(entry => entry.role === role);
  assert.ok(member);
  const bytes = Buffer.from(files.get(member.path));
  const original = Buffer.from(bytes);
  transform(bytes);
  assert.notDeepEqual(bytes, original);
  files.set(member.path, bytes);
  member.sha256 = hash(bytes);
  files.set("program.irpkg-set.json", Buffer.from(JSON.stringify(set)));
}
// These are the native adapter's actual framing boundary, not full IR decoding.
// Keep outer/set hashes valid so rejection must come from the selected member.
for (const role of ["root", "dependency"]) {
  for (const [label, transform] of [
    ["package-magic", bytes => { bytes[4] ^= 1; }],
    ["package-version", bytes => { bytes.writeUInt32LE(10, 4 + bytes.readUInt32LE(0)); }],
    ["section-bounds", bytes => {
      const firstEntry = 4 + bytes.readUInt32LE(0) + 12;
      bytes.writeUInt32LE(bytes.length + 1, firstEntry + 4);
    }],
  ]) {
    const name = `${role}-${label}`;
    const candidate = writeCanonical(name, (_descriptor, files) =>
      mutateMemberBytes(files, role, transform));
    run(`${name}-verify`, ["verify", candidate, recipe.module], /INVALID_COMPILED_PROGRAM/);
    build(`${name}-build`, /INVALID_COMPILED_PROGRAM/, candidate);
    assert.deepEqual(readFileSync(packPath), first, `${name}: preserve prior output`);
  }
  const name = `${role}-embedded-owner`;
  const candidate = writeCanonical(name, (_descriptor, files) =>
    mutateInterface(files, role, (text, manifest) => {
      const owner = manifest.metadata.packageSetMember;
      const before = `"packageSetMember":${JSON.stringify(owner)}`;
      const after = `"packageSetMember":${JSON.stringify({ ...owner, module: `X${owner.module.slice(1)}` })}`;
      assert.ok(text.includes(before), "mutation must target embedded ownership, not diagnostic module fields");
      return text.replace(before, after);
    }));
  run(`${name}-verify`, ["verify", candidate, recipe.module], /INVALID_COMPILED_PROGRAM/);
  build(`${name}-build`, /INVALID_COMPILED_PROGRAM/, candidate);
  assert.deepEqual(readFileSync(packPath), first, `${name}: preserve prior output`);
}
for (const role of ["root", "dependency"]) {
  for (const [label, transform] of [
    ["obsolete-interface", (text) => text.replace('"version":9', '"version":8')],
    ["wrong-manifest-metadata", (text) => text.replace('"manifestVersion":9', '"manifestVersion":8')],
    ["wrong-package-metadata", (text) => text.replace('"packageFormatVersion":11', '"packageFormatVersion":10')],
    ["wrong-lean-revision", (text, manifest) => text.replace(
      manifest.metadata.leanGithash, "0".repeat(manifest.metadata.leanGithash.length))],
    ["missing-manifest-metadata", (text) => text.replace('"manifestVersion"', '"manifestVersioX"')],
  ]) {
    const name = `${role}-${label}`;
    const candidate = writeCanonical(name, (_descriptor, files) =>
      mutateInterface(files, role, transform));
    run(`${name}-verify`, ["verify", candidate, recipe.module], /INVALID_COMPILED_PROGRAM/);
    build(`${name}-build`, /INVALID_COMPILED_PROGRAM/, candidate);
    assert.deepEqual(readFileSync(packPath), first, `${name}: preserve prior output`);
  }
}
for (const [label, mutate] of [
  [
    "wrong-root",
    (d) => {
      d.logicalId = "vir-compiled/Other.Root";
    },
  ],
  [
    "missing-report",
    (d) => {
      d.files = d.files.filter((f) => f.path !== "report.md");
    },
  ],
  [
    "wrong-member-hash",
    (_d, files) => {
      const set = JSON.parse(files.get("program.irpkg-set.json"));
      set.packages[0].sha256 = "0".repeat(64);
      files.set("program.irpkg-set.json", Buffer.from(JSON.stringify(set)));
    },
  ],
  [
    "wrong-member-role",
    (_d, files) => {
      const set = JSON.parse(files.get("program.irpkg-set.json"));
      set.packages[0].role = "root";
      files.set("program.irpkg-set.json", Buffer.from(JSON.stringify(set)));
    },
  ],
]) {
  const candidate = writeCanonical(label, mutate);
  run(label, ["verify", candidate, recipe.module], /INVALID_COMPILED_PROGRAM/);
}
const truncated = join(evidence, "truncated.virprogram");
writeFileSync(truncated, canonical.subarray(0, canonical.length - 1));
run(
  "canonical-truncated",
  ["verify", truncated, recipe.module],
  /TRUNCATED|LENGTH|PACK_/,
);

console.log(
  `program packing: compiled export, complete members, deterministic bytes, strict inputs and safe staging passed (${firstId})`,
);
