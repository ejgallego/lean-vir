/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const evidence = mkdtempSync(join(root, "build/resource-native-payload-"));
for (const name of ["outside", "managed", "source"]) mkdirSync(join(evidence, name));
symlinkSync(join(evidence, "outside"), join(evidence, "managed", "link"));
function run(command, args, label) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", timeout: 30000 });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  writeFileSync(join(evidence, `${label}.log`), output);
  assert.ifError(result.error);
  return { result, output };
}
const invalidArchive = join(evidence, "invalid.tar.gz");
writeFileSync(invalidArchive, "not an archive");
const sdk = run(join(root, ".lake/build/bin/vir_fetch_sdk"), [
  "--archive", invalidArchive, "--out", join(evidence, "managed/link/new/sdk"),
], "sdk-ancestor");
assert.notEqual(sdk.result.status, 0);
assert.match(sdk.output, /UNSAFE_RESOURCE_DIRECTORY/);
assert.deepEqual(readdirSync(join(evidence, "outside")), [], "SDK must not traverse before rejection");
const native = run("lake", ["env", "lean", "--run", "tests/resources/NativePayload.lean", evidence], "shared-boundaries");
assert.equal(native.result.status, 0, native.output);
assert.deepEqual(readdirSync(join(evidence, "outside")), []);
assert.ok(existsSync(join(evidence, "managed/ordinary/new/payload/retained")));
assert.deepEqual(readdirSync(join(evidence, "managed/ordinary/new")), ["payload"], "no temporary directory remains");
console.log(`native payload safety passed; evidence: ${evidence}`);
