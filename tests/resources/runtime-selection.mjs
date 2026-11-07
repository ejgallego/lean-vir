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
  key: revision,
  logicalId: runtimeLogicalId(revision),
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
function pack(logicalId, compatibility = profile, kind = "runtime") {
  const members = [
    [
      "runtime.js",
      Buffer.from("export function createProgram(){}"),
      "text/javascript",
    ],
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
writeFileSync(good, pack(plan.logicalId));
writeFileSync(stale, pack(runtimeLogicalId("0".repeat(40))));
writeFileSync(bad, pack(plan.logicalId, { ...profile, leanRevision: "wrong" }));
const local = JSON.parse(
  run("explicit-archive-candidate", ["runtime-plan", archive], {
    extra: { VIR_RUNTIME_PACK: good },
  }),
);
assert.equal(local.source, good);
assert.equal(local.logicalId, "");
assert.match(local.key, /^[0-9a-f]{64}$/);
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
  logicalId = plan.logicalId,
  c = cache,
  s = stage,
) => ["acquire-runtime", source, logicalId, c, s];
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
run("oversized-cache-repaired-offline", [...acquire(), "--offline"], {extra: {...net, FAIL_FETCH: "1"}});
assert.deepEqual(readFileSync(cache), readFileSync(good));
const absent = join(evidence, "absent-cache"),
  absentStage = join(evidence, "absent-stage");
run(
  "missing-exact-revision-no-fallback",
  acquire(plan.source, plan.logicalId, absent, absentStage),
  { extra: { ...net, FAIL_FETCH: "1" }, error: /RESOURCE_DOWNLOAD_FAILED/ },
);
assert.ok(!existsSync(absent) && !existsSync(absentStage));
run(
  "cold-offline",
  [...acquire(plan.source, plan.logicalId, absent, absentStage), "--offline"],
  { error: /RESOURCE_OFFLINE_MISS/ },
);
for (const [label, source, error] of [
  ["stale-download", stale, /RUNTIME_SOURCE_MISMATCH/],
  ["incompatible-download", bad, /INCOMPATIBLE/],
]) {
  run(label, acquire(plan.source, plan.logicalId, absent, absentStage), {
    extra: { ...net, PACK: source },
    error,
  });
  assert.ok(!existsSync(absent) && !existsSync(absentStage));
}
run("explicit-candidate", acquire(good, "", absent, absentStage));
console.log(`source-addressed runtime selection PASS; evidence: ${evidence}`);

// Changing an explicit candidate must replace a compatible existing stage too.
run("changed-explicit-candidate", acquire(stale, "", absent, absentStage));
assert.deepEqual(readFileSync(absentStage), readFileSync(stale));
