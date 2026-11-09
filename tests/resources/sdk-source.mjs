// Verify ordinary Lake SDK acquisition rejects a same-Lean archive from another VIR source.
import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  readFileSync,
  existsSync,
  renameSync,
  chmodSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { RUNTIME_ABI_VERSION } from "../../web/src/runtime/versions.js";
const root = fileURLToPath(new URL("../../", import.meta.url));
const evidence = mkdtempSync(join(root, "build/sdk-source-"));
// Both default paths share the same owning-checkout resolver. Exercise the SDK
// adapter's clean, dirty and source-archive diagnostics without a download.
const fetcher = join(root, ".lake/build/bin/vir_fetch_sdk");
const checkout = join(evidence, "checkout");
execFileSync("git", ["clone", "--quiet", "--shared", root, checkout]);
const checkoutRevision = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: checkout,
  encoding: "utf8",
}).trim();
function resolveSource(path, error) {
  const result = spawnSync(fetcher, ["--source-revision", path], {
    encoding: "utf8",
  });
  assert.ifError(result.error);
  if (error) {
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, error);
  } else {
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), checkoutRevision);
  }
}
resolveSource(checkout);
writeFileSync(join(checkout, "README.md"), "SDK dirty-source control\n");
resolveSource(checkout, /VIR_UNRELEASED_SOURCE:.*VIR_SDK_ARCHIVE/);
const sourceArchive = join(evidence, "source-archive");
mkdirSync(sourceArchive);
resolveSource(
  sourceArchive,
  /VIR_SOURCE_REVISION_UNAVAILABLE:.*VIR_SDK_ARCHIVE/,
);
const sdk = join(root, ".lake/build/vir/sdk");
if (existsSync(sdk)) renameSync(sdk, join(evidence, "previous-sdk"));
const revision = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
}).trim();
const source = join(evidence, "source/lean-vir-sdk");
mkdirSync(join(source, "js"), { recursive: true });
const payload = Buffer.from("export const sdkSourceRegression = true;\n");
writeFileSync(join(source, "js/fixture.js"), payload);
const archive = join(evidence, "sdk.tar.gz");
function manifest(commit) {
  writeFileSync(
    join(source, "lean-vir-artifact.json"),
    JSON.stringify({
      name: "lean-vir-sdk",
      version: JSON.parse(readFileSync(join(root, "package.json"))).version,
      runtimeAbiVersion: RUNTIME_ABI_VERSION,
      gitCommit: commit,
      files: [
        {
          path: "js/fixture.js",
          sha256: createHash("sha256").update(payload).digest("hex"),
        },
      ],
    }),
  );
  execFileSync("tar", [
    "-czf",
    archive,
    "-C",
    join(evidence, "source"),
    "lean-vir-sdk",
  ]);
}
const transport = join(evidence, "transport");
mkdirSync(transport);
writeFileSync(
  join(transport, "curl"),
  `#!${process.execPath}
import fs from 'node:fs';const args=process.argv.slice(2);if(!args.some(x=>x.endsWith('/lean-vir-sdk.tar.gz')))throw Error('unexpected source');fs.appendFileSync(process.env.SDK_REQUESTS,JSON.stringify(args)+'\\n');fs.copyFileSync(process.env.SDK_FIXTURE,args[args.indexOf('-o')+1]);
`,
);
chmodSync(join(transport, "curl"), 0o755);
const env = {
  ...process.env,
  PATH: transport + ":" + process.env.PATH,
  SDK_REQUESTS: join(evidence, "requests.jsonl"),
  SDK_FIXTURE: archive,
};
for (const k of Object.keys(env)) if (k.startsWith("VIR_SDK_")) delete env[k];
function build(label, error) {
  const result = spawnSync("lake", ["build", ":virSdk"], {
    cwd: root,
    env,
    encoding: "utf8",
    timeout: 90000,
  });
  const log = (result.stdout ?? "") + (result.stderr ?? "");
  writeFileSync(join(evidence, label + ".log"), log);
  assert.ifError(result.error);
  if (error) {
    assert.notEqual(result.status, 0);
    assert.match(log, error);
  } else assert.equal(result.status, 0, log);
}
manifest("0".repeat(40));
build("stale-default-rejected", /SDK commit mismatch/);
assert.ok(!existsSync(join(sdk, "lean-vir-artifact.json")));
manifest(revision);
build("matching-default-installed");
const m = join(sdk, "lean-vir-artifact.json"),
  stat = () => {
    const s = statSync(m, { bigint: true });
    return [s.ino, s.size, s.mtimeNs];
  };
const before = stat(),
  requests = readFileSync(env.SDK_REQUESTS, "utf8");
build("matching-default-warm");
assert.deepEqual(stat(), before);
assert.equal(readFileSync(env.SDK_REQUESTS, "utf8"), requests);
console.log(
  `default SDK source binding PASS; controlled archive/transport, evidence: ${evidence}`,
);
