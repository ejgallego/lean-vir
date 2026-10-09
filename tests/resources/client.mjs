/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

// Supplied-pack or anonymous published-pack acceptance. In both modes the leaf
// application's only command and dependency are the normal client ones.
import assert from "node:assert/strict";
import { replaceFixture } from "./fixture-edit.mjs";
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

const sourceRoot = fileURLToPath(new URL("../../", import.meta.url));
const source = process.argv[2];
if (!source)
  throw new Error(
    "usage: node tests/resources/client.mjs EXACT_RUNTIME_PACK | --published",
  );
const published = source === "--published";
mkdirSync(join(sourceRoot, "build"), { recursive: true });
const evidence = mkdtempSync(join(sourceRoot, "build/resource-client-"));
console.log(`resource client evidence: ${evidence}`);
let root = sourceRoot;
if (published) {
  // A committed source snapshot, not the producer's warm build/cache/stage.
  root = join(evidence, "producer");
  mkdirSync(root);
  const archive = spawnSync("git", ["archive", "HEAD"], {
    cwd: sourceRoot,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (archive.error) throw archive.error;
  assert.equal(archive.status, 0, archive.stderr.toString());
  const extracted = spawnSync("tar", ["-x", "-C", root], {
    input: archive.stdout,
  });
  if (extracted.error) throw extracted.error;
  assert.equal(extracted.status, 0, extracted.stderr.toString());
  assert.ok(!existsSync(join(root, ".lake")));
  assert.ok(!existsSync(join(root, ".vir-generated")));
}
const client = join(evidence, "client");
const leaf = join(evidence, "user");
cpSync(join(root, "fixtures/resources/client"), client, { recursive: true });
cpSync(join(root, "fixtures/resources/user"), leaf, { recursive: true });
for (const dir of [client, leaf])
  cpSync(join(root, "lean-toolchain"), join(dir, "lean-toolchain"));
let config = replaceFixture(readFileSync(join(client, "lakefile.lean"), "utf8"),
  '"../../../.."',
  JSON.stringify(root),
);
// Exercise the producer's configured directory, not a conventional lib/lean
// path reconstructed by the consumer or elaborator.
config = replaceFixture(config, 'buildDir := "build with spaces"',
  'buildDir := "build with spaces"\n  leanLibDir := "library output"');
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
if (published) assert.match(lock.source, /^https:\/\//);
const runtimeCache = join(
  root,
  ".lake/build/vir/resources/runtime",
  `${lock.contentId}.virres`,
);
const runtimeStage = join(root, ".vir-generated/VirResourceRuntime.virres");
if (!published)
  run(
    root,
    "seed-maintainer-runtime",
    join(root, ".lake/build/bin/vir_resource_pack"),
    [
      "acquire",
      join(root, "vir-resources/compatibility.json"),
      lock.contentId,
      resolve(source),
      runtimeCache,
      runtimeStage,
    ],
  );
const build = (label) =>
  run(leaf, label, "lake", ["exe", "generate-site", join(evidence, "site")]);
const snapshot = (path) => {
  const s = statSync(path, { bigint: true });
  return [s.ino, s.mtimeNs, s.size];
};
const producerLib = join(client, "build with spaces/library output");
const programStage = join(producerLib, "vir-assets/Client/Program.virres");
const producerCarrier = join(producerLib, "Client/Resources.olean");
// A foreign asset library prepares and embeds the dependency-owned program
// directly, before the dependency's own carrier has been compiled.
assert.ok(!existsSync(programStage));
assert.ok(!existsSync(producerCarrier));
run(leaf, "dependency-owned-cold", "lake", ["build", "UserAssets"]);
assert.ok(existsSync(programStage));
assert.ok(!existsSync(producerCarrier));
assert.ok(!existsSync(join(leaf, ".lake/build/lib/lean/vir-assets/Client/Program.virres")));
writeFileSync(join(leaf, "InspectAssets.lean"), `import UserAssets
#eval IO.println UserAssets.resources.runtime.contentId
#eval IO.println (reprStr (UserAssets.resources.programs.map (·.descriptor.logicalId)))
`);
const included = run(leaf, "dependency-owned-value", "lake", ["env", "lean", "InspectAssets.lean"]);
assert.match(included, new RegExp(lock.contentId));
assert.match(included, /#\["Client.Program"\]/);
const directProgram = readFileSync(programStage);
run(leaf, "dependency-owned-warm", "lake", ["build", "UserAssets"]);
assert.deepEqual(readFileSync(programStage), directProgram);
build("cold");
if (published) {
  const before = [snapshot(runtimeCache), snapshot(runtimeStage)];
  const tool = join(root, ".lake/build/bin/vir_resource_pack");
  const acquisition = [
    "acquire",
    join(root, "vir-resources/compatibility.json"),
    lock.contentId,
    lock.source,
  ];
  run(root, "warm-offline", tool, [
    ...acquisition,
    runtimeCache,
    runtimeStage,
    "--offline",
  ]);
  assert.deepEqual([snapshot(runtimeCache), snapshot(runtimeStage)], before);
  run(
    root,
    "cold-offline-miss",
    tool,
    [
      ...acquisition,
      join(evidence, "absent-cache.virres"),
      join(evidence, "absent-stage.virres"),
      "--offline",
    ],
    new RegExp(`RESOURCE_OFFLINE_MISS: required bundle ${lock.contentId}`),
  );
  assert.ok(!existsSync(join(evidence, "absent-cache.virres")));
  assert.ok(!existsSync(join(evidence, "absent-stage.virres")));
}
const programFirst = readFileSync(programStage);
assert.deepEqual(programFirst, directProgram, "both asset owners embed the same program");
const clientConfig = join(client, "lakefile.lean");
const originalConfig = readFileSync(clientConfig, "utf8");
for (const [label, change, diagnostic] of [
  ["unknown-module", text => replaceFixture(text, "`+Client.Program:virResourcePack",
    "`+Client.Absent:virResourcePack"), /module 'Client.Absent' not found/],
  ["carrier-as-root", text => replaceFixture(text, "`+Client.Program:virResourcePack",
    "`+Client.Resources:virResourcePack"),
    /VIR resource cycle/],
]) {
  writeFileSync(clientConfig, change(originalConfig));
  run(leaf, label, "lake", ["build", "generate-site"], diagnostic);
  assert.deepEqual(readFileSync(programStage), programFirst, "rejection preserves prepared program");
}
writeFileSync(clientConfig, originalConfig);
writeFileSync(clientConfig, replaceFixture(originalConfig,
  "`+Client.Program:virResourcePack", "`@client_fixture/+Client.Program:virResourcePack"));
build("qualified-selection");
assert.deepEqual(readFileSync(programStage), programFirst);
writeFileSync(clientConfig, originalConfig);
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
// The include consumes precisely its literal module list, not a carrier-name
// map or a second pass over configuration. A missing prepared root is explicit.
const carrierSource = join(client, "resources/Client/Resources.lean");
const originalCarrier = readFileSync(carrierSource, "utf8");
const missingCarrier = replaceFixture(originalCarrier, "#[Client.Program]",
  "#[Client.Alternative]");
writeFileSync(carrierSource, missingCarrier);
const missingLog = run(leaf, "unprepared-include", "lake", ["build", "generate-site"],
  /VIR_RESOURCE_NOT_PREPARED.*Client.Alternative/s);
const missingLines = missingCarrier.split("\n");
const missingLine = missingLines.findIndex(line => line.includes("#[Client.Alternative]"));
const missingColumn = missingLines[missingLine].indexOf("Client.Alternative");
assert.ok(missingLog.includes(`resources/Client/Resources.lean:${missingLine + 1}:${missingColumn}: VIR_RESOURCE_NOT_PREPARED`),
  "missing preparation diagnostic points to the requested module identifier");
assert.deepEqual(readFileSync(programStage), programFirst);
writeFileSync(carrierSource, originalCarrier);
build("include-restored");

// Multiple roots are an ordered literal list, not an ambiguous carrier mapping.
writeFileSync(clientConfig, replaceFixture(originalConfig,
  "`+Client.Program:virResourcePack",
  "`+Client.Alternative:virResourcePack, `+Client.Program:virResourcePack"));
writeFileSync(carrierSource, replaceFixture(originalCarrier, "#[Client.Program]",
  "#[Client.Alternative, Client.Program]"));
run(leaf, "two-roots", "lake", ["exe", "generate-site", join(evidence, "two-root-site")]);
assert.equal(readdirSync(join(evidence, "two-root-site")).length, 3);
writeFileSync(join(client, "Order.lean"), `import Client.Resources
#eval IO.println (reprStr (Client.Resources.resources.programs.map (·.descriptor.logicalId)))
`);
assert.match(run(client, "literal-order", "lake", ["env", "lean", "Order.lean"]),
  /Client.Alternative.*Client.Program/s);
writeFileSync(clientConfig, originalConfig);
writeFileSync(carrierSource, originalCarrier);
build("two-roots-restored");

const programSource = join(client, "program/Client/Program.lean");
const initialSource = readFileSync(programSource, "utf8");
writeFileSync(
  programSource,
  replaceFixture(initialSource, " ++ name", ' ++ name ++ "!"'),
);
build("program-edit");
assert.notDeepEqual(readFileSync(programStage), programFirst);
assert.deepEqual(snapshot(runtimeStage), first[1]);

// Reject a prerequisite cycle using the header graph, before compiled jobs wait.
writeFileSync(
  programSource,
  replaceFixture(initialSource,
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
renameSync(programStage, `${programStage}.retained`);
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
  `resource client (${published ? "anonymous published" : "supplied"}): ordinary cold/warm build, program edit, stage repair, cycle, relocated native execution PASS (${evidence})`,
);
