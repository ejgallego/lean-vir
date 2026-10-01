/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

// Independent host oracle for the standalone/facet adapters. Native generation
// must not spawn Node; the host test itself deliberately uses Node's crypto.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const evidence = mkdtempSync(join(repo, "build/resource-native-generation-"));
const bin = join(evidence, "bin");
mkdirSync(bin);
const unavailableNode = join(bin, "node");
writeFileSync(unavailableNode, "#!/bin/sh\nprintf 'unexpected native Node dependency\\n' >&2\nexit 97\n");
chmodSync(unavailableNode, 0o755);
const moduleName = "tests.resources.BrowserProgram";
const baseline = join(repo, ".lake/build/vir/module-sets/tests/resources/BrowserProgram.irpkg-set.json");
const setup = join(repo, ".lake/build/vir/programs/tests/resources/BrowserProgram.setup.json");
const generator = process.env.VIR_HASH_TEST_GENERATOR ?? join(repo, ".lake/build/bin/vir_irpkg");
const result = spawnSync("lake", ["env", generator,
  join(evidence, "program.irpkg"), join(evidence, "report.md"),
  "--setup", setup, "--module-set-output", join(evidence, "set.json"),
  join(evidence, "parts"), moduleName, "program.irpkg", "parts",
  "--target-marked-module", moduleName], {
  cwd: repo,
  env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  encoding: "utf8",
  timeout: 180000,
});
writeFileSync(join(evidence, "generation.log"), `${result.stdout ?? ""}${result.stderr ?? ""}`);
console.log(`native generation evidence: ${evidence}`);
assert.ifError(result.error);
assert.equal(result.status, 0, readFileSync(join(evidence, "generation.log"), "utf8"));

const actualText = readFileSync(join(evidence, "set.json"), "utf8");
const expectedText = readFileSync(baseline, "utf8");
const actual = JSON.parse(actualText);
const expected = JSON.parse(expectedText);
assert.equal(actualText, JSON.stringify(actual) + "\n", "canonical field order/newline");
assert.equal(actual.packages.length, expected.packages.length);
for (let i = 0; i < actual.packages.length; i++) {
  const member = actual.packages[i];
  const prior = expected.packages[i];
  assert.deepEqual({ ...member, path: prior.path }, prior, "only adapter paths may differ");
  const bytes = readFileSync(join(evidence, member.path));
  assert.equal(bytes.length, member.byteLength);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), member.sha256);
  assert.deepEqual(bytes, readFileSync(join(dirname(baseline), prior.path)));
}
console.log(`native generation: ${actual.packages.length} byte-identical members; no Node dependency`);
