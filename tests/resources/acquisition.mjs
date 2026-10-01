/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

// Synthetic pack integrity and native preparation tests, not browser acceptance.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync,
  readdirSync, renameSync, statSync, symlinkSync, truncateSync, unlinkSync, writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeDescriptor } from "../../web/src/resources/descriptor.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const evidence = mkdtempSync(join(root, "build/resource-acquisition-"));
console.log(`acquisition evidence: ${evidence}`);
const tool = join(root, ".lake/build/bin/vir_resource_pack");
const compat = join(root, "vir-resources/compatibility.json");
const source = join(evidence, "source pack.virres");
const cache = join(evidence, "cache with spaces/pack");
const stage = join(evidence, "stage with spaces/pack");
function run(cmd, args, label, { cwd = evidence, env = process.env, error } = {}) {
  const result = spawnSync(cmd, args, { cwd, env, encoding: "utf8", timeout: 180000 });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  writeFileSync(join(evidence, `${label}.log`), output);
  if (result.error) throw result.error;
  if (error) {
    assert.notEqual(result.status, 0, label);
    assert.match(output, error, label);
  } else assert.equal(result.status, 0, `${label}: ${output}`);
  return output;
}
const acquire = (label, src = source, options = {}) => run(tool,
  ["acquire", compat, expected, src, cache, stage, ...(options.offline ? ["--offline"] : [])], label, options);
const snapshot = (path) => {
  const s = statSync(path, { bigint: true });
  return [s.ino, s.mtimeNs, s.size];
};
run(join(root, ".lake/build/bin/vir_resource_tests"), ["native-pack", source], "fixture");
const bytes = readFileSync(source);
const expected = createHash("sha256").update("vir-resource-bundle-v1\n")
  .update(bytes.subarray(12, 12 + bytes.readUInt32LE(8))).digest("hex");
acquire("cold");
assert.deepEqual(readFileSync(stage), bytes);
assert.deepEqual(readFileSync(cache), bytes);
const first = [snapshot(cache), snapshot(stage)];
acquire("warm-offline", "https://invalid.example/never-fetched", { offline: true });
assert.deepEqual([snapshot(cache), snapshot(stage)], first);
unlinkSync(stage);
acquire("repair-missing-stage", "-", { offline: true });
unlinkSync(cache);
acquire("recover-cache-from-stage", "-", { offline: true });
writeFileSync(cache, bytes.subarray(0, 20));
writeFileSync(stage, Buffer.from("corrupt"));
acquire("repair-corrupt-candidates");
assert.deepEqual(readFileSync(stage), bytes);
assert.deepEqual(readFileSync(cache), bytes);

// Replacement must not write through read-only cache hard links.
unlinkSync(cache);
unlinkSync(stage);
const retained = join(evidence, "retained-invalid-hardlink");
writeFileSync(retained, "old retained artifact");
chmodSync(retained, 0o444);
linkSync(retained, cache);
linkSync(retained, stage);
acquire("replace-hardlinks");
assert.equal(readFileSync(retained, "utf8"), "old retained artifact");
assert.equal(statSync(retained).mode & 0o777, 0o444);
assert.notEqual(statSync(cache).ino, statSync(retained).ino);
assert.notEqual(statSync(stage).ino, statSync(retained).ino);

// Fail before making output changes when a destination aliases another tree.
unlinkSync(stage);
symlinkSync(retained, stage);
acquire("reject-leaf-link", source, { error: /UNSAFE_RESOURCE_FILE/ });
unlinkSync(stage);
const alias = join(evidence, "alias");
symlinkSync(join(evidence, "stage with spaces"), alias);
run(tool, ["acquire", compat, expected, source, cache, join(alias, "pack")], "reject-parent-link",
  { error: /UNSAFE_RESOURCE_DIRECTORY/ });
assert.equal(readFileSync(retained, "utf8"), "old retained artifact");
unlinkSync(cache);
acquire("exact-offline-miss", "https://invalid.example/never-fetched",
  { offline: true, error: new RegExp(`RESOURCE_OFFLINE_MISS.*${expected}`) });
assert.ok(!existsSync(cache) && !existsSync(stage));
run(tool, ["acquire", compat, "bad", source, cache, stage], "invalid-id", { error: /INVALID_CONTENT_ID/ });
const badSource = join(evidence, "corrupt-source");
writeFileSync(badSource, bytes.subarray(0, bytes.length - 1));
acquire("reject-truncated-source", badSource, { error: /TRUNCATED_PACK/ });
truncateSync(badSource, 516 * 1024 * 1024 + 13); // sparse: reject before allocation
acquire("reject-oversized-source", badSource, { error: /PACK_LIMIT/ });
truncateSync(badSource, 0);
acquire("reject-insecure-transport", "http://invalid.example/pack",
  { error: /UNSUPPORTED_RESOURCE_TRANSPORT/ });
assert.ok(!existsSync(cache) && !existsSync(stage));

// Userinfo is rejected at source admission, before cache reuse or invoking curl.
// Keep this check on cold and warm candidates so anonymity does not depend on
// which path happened to satisfy acquisition.
for (const warm of [false, true]) {
  if (warm) {
    writeFileSync(cache, bytes);
    writeFileSync(stage, bytes);
  }
  const beforeCache = warm ? snapshot(cache) : null;
  const beforeStage = warm ? snapshot(stage) : null;
  for (const source of [
    "https://user:pass@example.invalid/pack",
    "https://user@example.invalid/pack",
    "https://?query/no-host",
  ]) {
    acquire(`invalid-anonymous-url-${warm}-${source.includes("pass") ? "password" : source.includes("user") ? "user" : "host"}`,
      source, { error: /INVALID_RESOURCE_URL/ });
    if (warm) {
      assert.deepEqual(snapshot(cache), beforeCache);
      assert.deepEqual(snapshot(stage), beforeStage);
    } else assert.ok(!existsSync(cache) && !existsSync(stage));
  }
}
unlinkSync(cache);
unlinkSync(stage);

// A transport replacement cannot change either selected content or Lean revision.
const descriptorSize = bytes.readUInt32LE(8);
const originalJson = bytes.subarray(12, 12 + descriptorSize).toString("utf8");
const json = Buffer.from(originalJson.replace(
  /"leanRevision":"[^"]+"/, '"leanRevision":"wrong-revision"'));
const header = Buffer.from(bytes.subarray(0, 12));
header.writeUInt32LE(json.length, 8);
const other = join(evidence, "other-compiler");
writeFileSync(other, Buffer.concat([header, json, bytes.subarray(12 + descriptorSize)]));
acquire("reject-transport-identity", other, { error: /CONTENT_ID_MISMATCH/ });
const otherId = createHash("sha256").update("vir-resource-bundle-v1\n").update(json).digest("hex");
run(tool, ["acquire", compat, otherId, other, cache, stage], "reject-compiler",
  { error: /LEAN_BUILD_MISMATCH/ });
assert.ok(!existsSync(cache) && !existsSync(stage));

// Matching content identity is not sufficient: enforce the resource compatibility
// before touching either destination, including already-cached/staged candidates.
const profile = JSON.parse(readFileSync(compat));
assert.deepEqual(JSON.parse(originalJson).compatibility, profile,
  "native producer must emit the selected compatibility values");
for (const [label, value] of Object.entries({
  obsolete: { leanBuildId: profile.leanRevision, runtimeAbi: "4", jsApiVersion: 1, irFormatVersion: 11 },
  mixed: { ...profile, runtimeAbi: "4" },
})) {
  const path = join(evidence, `${label}-profile.json`);
  writeFileSync(path, JSON.stringify(value));
  run(tool, ["acquire", path, expected, source, cache, stage],
    `reject-${label}-profile`, { error: /INVALID_COMPATIBILITY/ });
  assert.ok(!existsSync(cache) && !existsSync(stage));
}
for (const field of ["virVersion"]) {
  const value = profile[field] + 1;
  assert.notEqual(value, profile[field]);
  // Reject an unsupported requested profile even if matching cached bytes exist.
  const wrongProfile = join(evidence, `profile-${field}.json`);
  writeFileSync(wrongProfile, JSON.stringify({ ...profile, [field]: value }));
  const profileCache = join(evidence, `profile-${field}-cache`);
  const profileStage = join(evidence, `profile-${field}-stage`);
  writeFileSync(profileCache, bytes);
  writeFileSync(profileStage, bytes);
  run(tool, ["acquire", wrongProfile, expected, source, profileCache, profileStage],
    `unsupported-profile-${field}`, { error: /UNSUPPORTED_COMPATIBILITY/ });
  assert.deepEqual(readFileSync(profileCache), bytes);
  assert.deepEqual(readFileSync(profileStage), bytes);
  const descriptor = JSON.parse(originalJson);
  descriptor.compatibility[field] = value;
  const changedJson = Buffer.from(encodeDescriptor(descriptor));
  const changedHeader = Buffer.from(header);
  changedHeader.writeUInt32LE(changedJson.length, 8);
  const changed = Buffer.concat([changedHeader, changedJson, bytes.subarray(12 + descriptorSize)]);
  const changedId = createHash("sha256").update("vir-resource-bundle-v1\n").update(changedJson).digest("hex");
  const changedSource = join(evidence, `incompatible-${field}`);
  writeFileSync(changedSource, changed);
  for (const candidate of ["source", "cache", "stage"]) {
    const caseCache = join(evidence, `${field}-${candidate}-cache`);
    const caseStage = join(evidence, `${field}-${candidate}-stage`);
    const cacheBefore = candidate === "cache" ? changed : bytes;
    const stageBefore = candidate === "stage" ? changed : bytes;
    writeFileSync(caseCache, cacheBefore);
    writeFileSync(caseStage, stageBefore);
    run(tool, ["acquire", compat, changedId, changedSource, caseCache, caseStage],
      `incompatible-${field}-${candidate}`, { error: /INCOMPATIBLE/ });
    assert.deepEqual(readFileSync(caseCache), cacheBefore);
    assert.deepEqual(readFileSync(caseStage), stageBefore);
  }
}

// Concurrent producers may only install the selected complete pack.
await Promise.all(Array.from({ length: 8 }, (_, i) => new Promise((resolve, reject) => {
  const child = spawn(tool, ["acquire", compat, expected, source, cache, stage]);
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  child.on("error", reject);
  child.on("close", (code) => {
    writeFileSync(join(evidence, `concurrent-${i}.log`), output);
    if (code === 0) resolve(); else reject(new Error(output));
  });
})));
assert.deepEqual(readFileSync(cache), bytes);
assert.deepEqual(readFileSync(stage), bytes);
for (const dir of ["cache with spaces", "stage with spaces"]) {
  assert.deepEqual(readdirSync(join(evidence, dir)), ["pack"]);
}

// Controlled transport fault injection, NOT anonymous HTTPS acceptance. Killing
// the producer after a partial download must expose no successful output. Retry
// ignores the orphaned private temporary file and verifies fresh complete bytes.
unlinkSync(cache);
unlinkSync(stage);
const transport = join(evidence, "transport");
mkdirSync(transport);
const curl = join(transport, "curl");
writeFileSync(curl, `#!${process.execPath}
import fs from "node:fs";
const args = process.argv.slice(2);
fs.writeFileSync(process.env.TEST_CURL_LOG, JSON.stringify(args));
const out = args[args.indexOf("--output") + 1];
if (process.env.TEST_CURL_MODE === "success") {
  fs.copyFileSync(process.env.TEST_CURL_PACK, out);
} else {
  fs.writeFileSync(out, "partial");
  fs.writeFileSync(process.env.TEST_CURL_STARTED, "ready");
  if (process.env.TEST_CURL_MODE === "fail") process.exit(23);
  setInterval(() => {}, 1000);
}
`);
chmodSync(curl, 0o755);
const started = join(transport, "started");
const curlLog = join(transport, "args.json");
const transportEnv = { ...process.env, PATH: `${transport}:${process.env.PATH}`,
  TEST_CURL_LOG: curlLog, TEST_CURL_PACK: source, TEST_CURL_STARTED: started,
  TEST_CURL_MODE: "pause" };
const interrupted = spawn(tool, ["acquire", compat, expected, "https://test.invalid/pack", cache, stage],
  { env: transportEnv, detached: true });
let interruptedLog = "";
interrupted.stdout.on("data", (chunk) => { interruptedLog += chunk; });
interrupted.stderr.on("data", (chunk) => { interruptedLog += chunk; });
const closed = new Promise((resolve, reject) => {
  interrupted.on("error", reject);
  interrupted.on("close", (code, signal) => resolve({ code, signal }));
});
try {
  const deadline = Date.now() + 10000;
  while (!existsSync(started) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.ok(existsSync(started), "transport did not reach the partial-write boundary");
  assert.ok(!existsSync(cache) && !existsSync(stage));
} finally {
  // The process group consists only of this test producer and its curl stub.
  try { process.kill(-interrupted.pid, "SIGTERM"); }
  catch (error) { if (error.code !== "ESRCH") throw error; }
  writeFileSync(join(evidence, "interrupted.json"), JSON.stringify(await closed));
  writeFileSync(join(evidence, "interrupted.log"), interruptedLog);
}
assert.ok(!existsSync(cache) && !existsSync(stage));
acquire("failed-transport", "https://test.invalid/pack", {
  env: { ...transportEnv, TEST_CURL_MODE: "fail" }, error: /RESOURCE_DOWNLOAD_FAILED/,
});
assert.ok(!existsSync(cache) && !existsSync(stage));
acquire("retry-interrupted-transport", "https://test.invalid/pack", {
  env: { ...transportEnv, TEST_CURL_MODE: "success" },
});
assert.deepEqual(readFileSync(cache), bytes);
assert.deepEqual(readFileSync(stage), bytes);
const curlArgs = JSON.parse(readFileSync(curlLog));
assert.equal(curlArgs[0], "-q");
assert.equal(curlArgs[curlArgs.indexOf("--proto-redir") + 1], "=https");
assert.ok(curlArgs.includes("--max-filesize"));
assert.ok(!curlArgs.includes("--user") && !curlArgs.includes("-H"));

// Real downstream library prerequisites, using source-distributed synthetic bytes.
// The native executable is fetched through Lake; no nested Lake process or Node
// is used by preparation. The leaf has no VIR dependency/target/environment API.
const client = join(evidence, "client");
const leaf = join(evidence, "leaf");
mkdirSync(client);
mkdirSync(leaf);
for (const dir of [client, leaf]) writeFileSync(join(dir, "lean-toolchain"), readFileSync(join(root, "lean-toolchain")));
writeFileSync(join(client, "prebuilt.virres"), bytes);
writeFileSync(join(client, "lakefile.lean"), `import Lake
open Lake DSL
package client_fixture where
  buildDir := "compiled output"
require lean_vir from ${JSON.stringify(root)}
input_file resourceInput where
  path := "prebuilt.virres"
target prepared (pkg) : System.FilePath := do
  let some tool ← findLeanExe? \`vir_resource_pack | error "missing native resource tool"
  let executable ← tool.fetch
  let input ← resourceInput.fetch
  executable.bindM fun exe => input.mapM fun pack => do
    let stage := pkg.dir / ".vir-generated/fixture.virres"
    addLeanTrace
    addPureTrace ${JSON.stringify(expected)} "resource identity"
    proc { cmd := exe.toString, args := #["acquire", ${JSON.stringify(compat)}, ${JSON.stringify(expected)},
      pack.toString, (pkg.buildDir / "resource-cache/pack").toString, stage.toString] }
    addTrace (← computeTrace stage)
    return stage
lean_lib ClientResources where
  roots := #[]
  globs := #[.one \`Carrier]
  needs := #[prepared]
lean_lib Client where
  roots := #[\`Client]
`);
writeFileSync(join(client, "Carrier.lean"), `module
public import Vir.Resources.Embed
public def carried : Vir.Resources.Bundle := include_vir_bundle ".vir-generated/fixture.virres"
`);
writeFileSync(join(client, "Client.lean"), `module
public import Carrier
public def clientIdentity : String := carried.contentId
`);
writeFileSync(join(leaf, "lakefile.toml"), `name = "leaf_fixture"
[[require]]
name = "client_fixture"
path = "../client"
[[lean_exe]]
name = "generate"
root = "Main"
`);
writeFileSync(join(leaf, "Main.lean"), `import Client
def main : IO Unit := IO.println clientIdentity
`);
const build = (label) => {
  const output = run("lake", ["exe", "generate"], label, { cwd: leaf });
  assert.ok(output.includes(expected), output);
};
build("downstream-cold");
const staged = join(client, ".vir-generated/fixture.virres");
const warm = snapshot(staged);
build("downstream-warm");
assert.doesNotMatch(readFileSync(join(evidence, "downstream-warm.log"), "utf8"), /Built.*(?:Carrier|Client|Main)/);
assert.deepEqual(snapshot(staged), warm);
unlinkSync(staged);
build("downstream-repair");
assert.deepEqual(readFileSync(staged), bytes);
writeFileSync(staged, "invalid staged pack");
build("downstream-corruption");
assert.deepEqual(readFileSync(staged), bytes);
renameSync(join(client, ".vir-generated"), join(client, "retained-stage"));
renameSync(join(client, "prebuilt.virres"), join(client, "retained-source"));
const output = run(join(leaf, ".lake/build/bin/generate"), [], "downstream-raw-inputs-absent", { cwd: "/tmp" });
assert.equal(output.trim(), expected);
console.log("acquisition: identity, offline repair, hardlinks, concurrent writes and downstream needs passed");
