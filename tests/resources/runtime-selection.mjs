// Native source-selection regressions with controlled transport, not public release acceptance.
import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  mkdtempSync,
  chmodSync,
  statSync,
  existsSync,
  unlinkSync,
  truncateSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeDescriptor } from "../../web/src/resources/descriptor.js";
import {
  runtimeAssetName,
  runtimeLogicalId,
} from "../../scripts/resources/runtime-source.mjs";
import { releaseTagFromToolchain } from "../../scripts/release-tag.mjs";
const root = fileURLToPath(new URL("../../", import.meta.url));
const tool = join(root, ".lake/build/bin/vir_resource_pack");
const revision = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
}).trim();
const evidence = mkdtempSync(join(root, "build/runtime-selection-"));
const env = { ...process.env };
delete env.VIR_RUNTIME_PACK;
function run(label, args, { error, extra = {} } = {}) {
  const result = spawnSync(tool, args, {
    cwd: root,
    env: { ...env, ...extra },
    encoding: "utf8",
    timeout: 30000,
  });
  const log = (result.stdout ?? "") + (result.stderr ?? "");
  writeFileSync(join(evidence, label + ".log"), log);
  assert.ifError(result.error);
  if (error) {
    assert.notEqual(result.status, 0, label);
    assert.match(log, error);
  } else assert.equal(result.status, 0, log);
  return result.stdout.trim();
}
const checkout = join(evidence, "checkout");
execFileSync("git", ["clone", "--quiet", "--shared", root, checkout]);
const plan = JSON.parse(run("default-plan", ["runtime-plan", checkout]));
assert.deepEqual(plan, {
  identity: { kind: "sourceRevision", value: revision },
  source: `https://github.com/ejgallego/lean-vir/releases/download/${releaseTagFromToolchain(readFileSync(join(root, "lean-toolchain"), "utf8"))}/${runtimeAssetName(revision)}`,
});
writeFileSync(join(checkout, "README.md"), "dirty source control\n");
run("dirty-source-needs-candidate", ["runtime-plan", checkout], {
  error: /VIR_UNRELEASED_SOURCE/,
});
const archive = join(evidence, "source-archive");
mkdirSync(archive);
run("no-enclosing-repository-fallback", ["runtime-plan", archive], {
  error: /VIR_SOURCE_REVISION_UNAVAILABLE/,
});
const profile = JSON.parse(
  readFileSync(join(root, "vir-resources/compatibility.json")),
);
function pack(
  logicalId,
  compatibility = profile,
  kind = "runtime",
  moduleSource = "export function createProgram(){}",
) {
  const members = [
    ["runtime.js", Buffer.from(moduleSource), "text/javascript"],
    [
      "runtime.wasm",
      Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]),
      "application/wasm",
    ],
  ];
  const d = {
    schemaVersion: 2,
    kind,
    logicalId,
    compatibility,
    files: members.map(([path, b, mediaType]) => ({
      path,
      byteLength: b.length,
      sha256: createHash("sha256").update(b).digest("hex"),
      mediaType,
    })),
    fileEntries: [
      { role: "runtimeModule", path: "runtime.js" },
      { role: "wasm", path: "runtime.wasm" },
    ],
  };
  const raw = Buffer.from(encodeDescriptor(d)),
    header = Buffer.from("564952524553000100000000", "hex");
  header.writeUInt32LE(raw.length, 8);
  return Buffer.concat([header, raw, ...members.map((m) => m[1])]);
}
const good = join(evidence, "selected.virres"),
  stale = join(evidence, "stale-same-Lean.virres"),
  bad = join(evidence, "wrong-compiler.virres");
writeFileSync(good, pack(runtimeLogicalId(revision)));
writeFileSync(stale, pack(runtimeLogicalId("0".repeat(40))));
writeFileSync(
  bad,
  pack(runtimeLogicalId(revision), { ...profile, leanRevision: "wrong" }),
);
const local = JSON.parse(
  run("explicit-archive-candidate", ["runtime-plan", archive], {
    extra: { VIR_RUNTIME_PACK: good },
  }),
);
assert.equal(local.source, good);
assert.equal(local.identity.kind, "contentId");
assert.match(local.identity.value, /^[0-9a-f]{64}$/);
const transport = join(evidence, "transport");
mkdirSync(transport);
writeFileSync(
  join(transport, "curl"),
  `#!${process.execPath}
import fs from 'node:fs';const args=process.argv.slice(2);fs.appendFileSync(process.env.REQUESTS,JSON.stringify(args)+'\\n');if(process.env.FAIL_FETCH)process.exit(22);const out=args[args.indexOf('-o')+1];fs.copyFileSync(process.env.PACK,out);
`,
);
chmodSync(join(transport, "curl"), 0o755);
const requests = join(evidence, "requests.jsonl");
const net = {
  PATH: transport + ":" + env.PATH,
  PACK: good,
  REQUESTS: requests,
};
const cache = join(evidence, "cache"),
  stage = join(evidence, "stage");
const acquire = (
  source = plan.source,
  identity = plan.identity,
  c = cache,
  s = stage,
) => ["acquire-runtime", identity.kind, identity.value, source, c, s];
// A valid same-Lean stale pack must not satisfy the source-addressed cache key.
writeFileSync(cache, readFileSync(stale));
writeFileSync(stage, readFileSync(stale));
run("stale-cache-and-stage-repaired", acquire(), { extra: net });
assert.deepEqual(readFileSync(cache), readFileSync(good));
assert.deepEqual(readFileSync(stage), readFileSync(good));
const stat = (p) => {
  const s = statSync(p, { bigint: true });
  return [s.ino, s.mtimeNs, s.size];
};
const before = [stat(cache), stat(stage)],
  count = readFileSync(requests, "utf8").split("\n").length;
run("warm-no-network", acquire(), { extra: { ...net, FAIL_FETCH: "1" } });
run("offline-no-network", [...acquire(), "--offline"], {
  extra: { ...net, FAIL_FETCH: "1" },
});
assert.deepEqual([stat(cache), stat(stage)], before);
assert.equal(readFileSync(requests, "utf8").split("\n").length, count);
// Oversized corrupt cache bytes remain a rejected candidate; a valid stage repairs them.
unlinkSync(cache);
writeFileSync(cache, "");
truncateSync(cache, 2 ** 30); // sparse file, above the bounded pack limit
run("oversized-cache-repaired-offline", [...acquire(), "--offline"], {
  extra: { ...net, FAIL_FETCH: "1" },
});
assert.deepEqual(readFileSync(cache), readFileSync(good));
const absent = join(evidence, "absent-cache"),
  absentStage = join(evidence, "absent-stage");
run(
  "missing-exact-revision-no-fallback",
  acquire(plan.source, plan.identity, absent, absentStage),
  { extra: { ...net, FAIL_FETCH: "1" }, error: /RESOURCE_DOWNLOAD_FAILED/ },
);
assert.ok(!existsSync(absent) && !existsSync(absentStage));
run(
  "cold-offline",
  [...acquire(plan.source, plan.identity, absent, absentStage), "--offline"],
  { error: /RESOURCE_OFFLINE_MISS/ },
);
for (const [label, source, error] of [
  ["stale-download", stale, /RUNTIME_SOURCE_MISMATCH/],
  ["incompatible-download", bad, /INCOMPATIBLE/],
]) {
  run(label, acquire(plan.source, plan.identity, absent, absentStage), {
    extra: { ...net, PACK: source },
    error,
  });
  assert.ok(!existsSync(absent) && !existsSync(absentStage));
}
run("explicit-candidate", acquire(good, local.identity, absent, absentStage));

// Changing an explicit candidate must replace a compatible existing stage too.
run(
  "changed-explicit-candidate",
  acquire(
    stale,
    { kind: "contentId", value: contentId(readFileSync(stale)) },
    absent,
    absentStage,
  ),
);
assert.deepEqual(readFileSync(absentStage), readFileSync(stale));

// Same compiler/profile, different actual payloads and CIDs: retain the reviewed
// A -> B failure, including the absent B-cache and incorrectly keyed cache cases.
const explicitA = pack(
  runtimeLogicalId("0".repeat(40)),
  profile,
  "runtime",
  'export const candidate = "A";',
);
const explicitB = pack(
  runtimeLogicalId("1".repeat(40)),
  profile,
  "runtime",
  'export const candidate = "B";',
);
const selectedB = join(evidence, "explicit-B.virres");
writeFileSync(selectedB, explicitB);
const planB = JSON.parse(
  run("explicit-B-plan", ["runtime-plan", archive], {
    extra: { VIR_RUNTIME_PACK: selectedB },
  }),
);
function contentId(bytes) {
  return createHash("sha256")
    .update("vir-resource-bundle-v2\n")
    .update(bytes.subarray(12, 12 + bytes.readUInt32LE(8)))
    .digest("hex");
}
const expectedB = contentId(explicitB);
assert.deepEqual(planB.identity, { kind: "contentId", value: expectedB });
for (const [label, cacheBytes, stageBytes] of [
  ["empty-control", null, null],
  ["stage-A-absent-B-cache", null, explicitA],
  ["A-under-B-cache-key", explicitA, null],
  ["cache-and-stage-A", explicitA, explicitA],
  ["recover-B-cache-from-stage-offline", null, explicitB],
  ["repair-B-stage-from-cache-offline", explicitB, null],
]) {
  const dir = join(evidence, `explicit-${label}`);
  mkdirSync(dir);
  const cacheB = join(dir, `${planB.identity.value}.virres`),
    stageB = join(dir, "stage");
  if (cacheBytes) writeFileSync(cacheB, cacheBytes);
  if (stageBytes) writeFileSync(stageB, stageBytes);
  const args = acquire(planB.source, planB.identity, cacheB, stageB);
  run(`explicit-${label}`, [...args, "--offline"]);
  assert.deepEqual(readFileSync(cacheB), explicitB, label);
  assert.deepEqual(readFileSync(stageB), explicitB, label);
  const warm = [stat(cacheB), stat(stageB)];
  run(`explicit-${label}-warm-offline`, [...args, "--offline"]);
  assert.deepEqual([stat(cacheB), stat(stageB)], warm, label);
}
for (const [label, selected, error] of [
  ["profile-invalid", bad, /INCOMPATIBLE/],
  ["malformed", join(evidence, "explicit-malformed.virres"), /TRUNCATED_PACK/],
]) {
  if (label === "malformed") writeFileSync(selected, "bad");
  const dir = join(evidence, `explicit-${label}`);
  mkdirSync(dir);
  const retainedCache = join(dir, "cache"),
    retainedStage = join(dir, "stage");
  writeFileSync(retainedCache, explicitA);
  writeFileSync(retainedStage, explicitA);
  run(
    `explicit-${label}`,
    acquire(
      selected,
      {
        kind: "contentId",
        value:
          label === "malformed" ? expectedB : contentId(readFileSync(selected)),
      },
      retainedCache,
      retainedStage,
    ),
    { error },
  );
  assert.deepEqual(readFileSync(retainedCache), explicitA);
  assert.deepEqual(readFileSync(retainedStage), explicitA);
}
// Planning freezes B even when the local transport changes before acquisition.
const changedCache = join(evidence, "changed-source-cache"),
  changedStage = join(evidence, "changed-source-stage");
writeFileSync(selectedB, explicitA);
run(
  "planned-B-source-now-A",
  acquire(planB.source, planB.identity, changedCache, changedStage),
  {
    error: /CONTENT_ID_MISMATCH/,
  },
);
assert.ok(!existsSync(changedCache) && !existsSync(changedStage));
writeFileSync(changedStage, explicitB);
unlinkSync(selectedB);
run("planned-B-offline-recovery-with-missing-source", [
  ...acquire(planB.source, planB.identity, changedCache, changedStage),
  "--offline",
]);
assert.deepEqual(readFileSync(changedCache), explicitB);
for (const identity of [
  { kind: "unknown", value: expectedB },
  { kind: "contentId", value: "bad" },
  { kind: "sourceRevision", value: "A".repeat(40) },
]) {
  run(
    `invalid-identity-${identity.kind}-${identity.value.length}`,
    acquire("-", identity),
    { error: /INVALID_RUNTIME_IDENTITY/ },
  );
}
console.log(`source-addressed runtime selection PASS; evidence: ${evidence}`);
