/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

// Producer-local acceptance. The maintainer supplies a matching prebuilt pack;
// the leaf application's only command and dependency are the normal client ones.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  statSync,
  unlinkSync,
  renameSync,
  existsSync,
  readdirSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = process.argv[2];
if (!source)
  throw new Error("usage: node tests/resources/client.mjs EXACT_RUNTIME_PACK");
const evidence = mkdtempSync(join(root, "build/resource-client-"));
const client = join(evidence, "client");
const leaf = join(evidence, "user");
cpSync(join(root, "fixtures/resources/client"), client, { recursive: true });
cpSync(join(root, "fixtures/resources/user"), leaf, { recursive: true });
for (const dir of [client, leaf])
  cpSync(join(root, "lean-toolchain"), join(dir, "lean-toolchain"));
const config = readFileSync(join(client, "lakefile.lean"), "utf8").replace(
  '"../../../.."',
  JSON.stringify(root),
);
writeFileSync(join(client, "lakefile.lean"), config);
function run(cwd, label, cmd, args, error = null) {
  const result = spawnSync(cmd, args, {
    cwd,
    encoding: "utf8",
    timeout: 240000,
  });
  const log = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  writeFileSync(join(evidence, `${label}.log`), log);
  if (result.error) throw result.error;
  if (error) {
    assert.notEqual(result.status, 0, label);
    assert.match(log, error, label);
  } else assert.equal(result.status, 0, `${label}: ${log}`);
  return log;
}
const lock = JSON.parse(readFileSync(join(root, "vir-resources/runtime.json")));
const runtimeCache = join(
  root,
  ".lake/build/vir/resources/runtime",
  `${lock.contentId}.virres`,
);
const runtimeStage = join(root, ".vir-generated/VirResourceRuntime.virres");
run(
  root,
  "seed-maintainer-runtime",
  join(root, ".lake/build/bin/vir_resource_pack"),
  ["acquire", lock.contentId, resolve(source), runtimeCache, runtimeStage],
);
const build = (label) =>
  run(leaf, label, "lake", ["exe", "generate-site", join(evidence, "site")]);
const snapshot = (path) => {
  const s = statSync(path, { bigint: true });
  return [s.ino, s.mtimeNs, s.size];
};
console.log(`resource client evidence: ${evidence}`);
build("cold");
const programStage = join(client, ".vir-generated/ClientResources.virres");
const programFirst = readFileSync(programStage);
const first = [snapshot(programStage), snapshot(runtimeStage)];
build("warm");
assert.deepEqual([snapshot(programStage), snapshot(runtimeStage)], first);
assert.doesNotMatch(
  readFileSync(join(evidence, "warm.log"), "utf8"),
  /Built.*(?:Client|Main|Runtime)/,
);
unlinkSync(programStage);
build("repair-stage");
assert.deepEqual(readFileSync(programStage), programFirst);
writeFileSync(programStage, "corrupt staged pack");
build("repair-corrupt-stage");
assert.deepEqual(readFileSync(programStage), programFirst);

const programSource = join(client, "program/Client/Program.lean");
const initialSource = readFileSync(programSource, "utf8");
writeFileSync(programSource, initialSource.replace('"Hello, "', '"Welcome, "'));
build("program-edit");
assert.notDeepEqual(readFileSync(programStage), programFirst);
assert.deepEqual(snapshot(runtimeStage), first[1]);

// Reject a prerequisite cycle using the header graph, before compiled jobs wait.
writeFileSync(
  programSource,
  initialSource.replace(
    "meta import Vir.Attributes",
    "meta import Vir.Attributes\nimport Client.Resources",
  ),
);
buildCycle();
function buildCycle() {
  run(
    leaf,
    "carrier-cycle",
    "lake",
    ["build", "generate-site"],
    /VIR resource cycle/,
  );
}
writeFileSync(programSource, initialSource);
build("restored");

// Native publication now needs only compiled/link prerequisites, not raw packs.
renameSync(programStage, join(client, ".vir-generated/retained.virres"));
const destination = join(evidence, "relocated-site");
run(
  "/tmp",
  "native-raw-program-absent",
  join(leaf, ".lake/build/bin/generate-site"),
  [destination],
);
assert.equal(readdirSync(destination).length, 2);
for (const id of readdirSync(destination)) {
  assert.ok(existsSync(join(destination, id, "bundle.json")));
}
console.log(
  `resource client: ordinary cold/warm build, program edit, stage repair, cycle, relocated native execution PASS (${evidence})`,
);
