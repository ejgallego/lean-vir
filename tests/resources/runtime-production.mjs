/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

// Controlled maintainer-tool regressions, not Wasm or public release qualification.
import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../../", import.meta.url));
const evidence = mkdtempSync(join(root, "build/runtime-production-"));
console.log(`runtime production evidence: ${evidence}`);
function run(command, args, label, env = process.env) {
  const result = spawnSync(command, args, {
    cwd: root,
    env,
    encoding: "utf8",
    timeout: 30000,
  });
  writeFileSync(
    join(evidence, `${label}.log`),
    `${result.stdout ?? ""}${result.stderr ?? ""}`,
  );
  assert.ifError(result.error);
  return result;
}

test("runtime packaging creates parents but never reuses an existing destination", async () => {
  const wasm = join(evidence, "synthetic.wasm");
  const identity = join(evidence, "synthetic-identity.json");
  const output = join(evidence, "missing parent", "runtime");
  const compatibility = JSON.parse(
    readFileSync(join(root, "vir-resources/compatibility.json")),
  );
  // Valid minimal Wasm for packaging-only tests; deliberately not executable VIR.
  writeFileSync(wasm, Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]));
  writeFileSync(
    identity,
    JSON.stringify({
      profile: "release",
      leanSource: { commit: compatibility.leanRevision, dirty: false },
    }),
  );
  const args = ["scripts/resources/pack-runtime.mjs", wasm, identity, output];
  const first = run(process.execPath, args, "pack-missing-parent");
  assert.equal(first.status, 0, first.stderr);
  const provenance = JSON.parse(readFileSync(join(output, "provenance.json")));
  const pack = join(output, `${provenance.contentId}.virres`);
  const before = readFileSync(pack);
  const moduleBytes = readFileSync(join(output, "payloads/runtime.js"));
  const unminified = await build({
    absWorkingDir: root,
    entryPoints: ["web/src/resource-program.js"],
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    write: false,
    legalComments: "inline",
    outfile: "runtime.js",
  });
  assert.ok(moduleBytes.length < unminified.outputFiles[0].contents.length,
    "release module is minimized");
  const module = await import(pathToFileURL(join(output, "payloads/runtime.js")));
  assert.deepEqual(Object.keys(module), ["createProgram"]);
  assert.equal(typeof module.createProgram, "function", "public loader export remains callable");
  for (const [name, source] of [
    ["LICENSE", join(root, "LICENSE")], ["NOTICE", join(root, "NOTICE")],
    ["lean-LICENSE", join(root, "third_party/lean4-src/LICENSE")],
    ["lean-LICENSES", join(root, "third_party/lean4-src/LICENSES")],
  ])
    assert.deepEqual(readFileSync(join(output, "payloads", name)), readFileSync(source));
  const repeat = run(process.execPath, args, "pack-existing-destination");
  assert.notEqual(repeat.status, 0);
  assert.match(repeat.stderr, /EEXIST/);
  assert.deepEqual(readFileSync(pack), before);
});

const transport = join(evidence, "transport");
mkdirSync(transport);
const gh = join(transport, "gh");
writeFileSync(
  gh,
  `#!${process.execPath}
import { appendFileSync, copyFileSync, existsSync } from "node:fs";
import { basename, join } from "node:path";
const args = process.argv.slice(2);
appendFileSync(process.env.TEST_GH_LOG, JSON.stringify(args) + "\\n");
const remote = process.env.TEST_GH_REMOTE;
const name = basename(process.env.TEST_GH_PACK);
if (args[0] !== "release") throw new Error("unexpected gh operation");
if (process.env.TEST_GH_FAIL === args[1]) process.exit(23);
if (args[1] === "view") {
  if (args.includes("--json")) console.log(JSON.stringify({
    assets: existsSync(remote) ? [{ name }] : [],
  }));
} else if (args[1] === "download") {
  if (args[args.indexOf("--pattern") + 1] !== name) throw new Error("wrong asset");
  copyFileSync(remote, join(args[args.indexOf("--dir") + 1], name));
} else if (args[1] === "upload") {
  if (args.includes("--clobber")) throw new Error("runtime asset must not be clobbered");
  if (existsSync(remote)) {
    console.error("asset under the same name already exists"); process.exit(1);
  }
  copyFileSync(args[3], remote);
} else throw new Error("unexpected gh operation");
`,
);
chmodSync(gh, 0o755);

function publication(label, remoteBytes, fail) {
  const directory = join(evidence, label);
  mkdirSync(directory);
  const pack = join(directory, `${"a".repeat(64)}.virres`);
  const remote = join(directory, "published.virres");
  const log = join(directory, "gh.jsonl");
  writeFileSync(pack, "selected runtime bytes");
  if (remoteBytes !== undefined) writeFileSync(remote, remoteBytes);
  const env = {
    ...process.env,
    PATH: `${transport}:${process.env.PATH}`,
    TEST_GH_PACK: pack,
    TEST_GH_REMOTE: remote,
    TEST_GH_LOG: log,
    TEST_GH_FAIL: fail ?? "",
  };
  const result = run(
    process.execPath,
    ["scripts/resources/publish-runtime.mjs", "v-test", pack],
    label,
    env,
  );
  const calls = existsSync(log)
    ? readFileSync(log, "utf8").trim().split("\n").map(JSON.parse)
    : [];
  for (const args of calls.filter((args) => args[1] === "download"))
    assert.ok(
      !existsSync(args[args.indexOf("--dir") + 1]),
      "private download directory cleaned up",
    );
  return { result, calls, remote };
}

test("runtime release uploads an absent asset without clobber", () => {
  const { result, calls, remote } = publication("absent");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(remote, "utf8"), "selected runtime bytes");
  assert.equal(calls.filter((args) => args[1] === "upload").length, 1);
  assert.ok(calls.every((args) => !args.includes("--clobber")));
});

test("runtime release reuses an existing byte-identical asset", () => {
  const { result, calls, remote } = publication(
    "equal",
    "selected runtime bytes",
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(remote, "utf8"), "selected runtime bytes");
  assert.equal(calls.filter((args) => args[1] === "upload").length, 0);
});

test("runtime release rejects different bytes without replacing the asset", () => {
  const { result, calls, remote } = publication(
    "different",
    "retained other bytes",
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /existing runtime asset differs/);
  assert.equal(readFileSync(remote, "utf8"), "retained other bytes");
  assert.equal(calls.filter((args) => args[1] === "upload").length, 0);
});

for (const fail of ["view", "download", "upload"]) {
  test(`runtime release preserves the asset on ${fail} failure`, () => {
    const initial = fail === "upload" ? undefined : "selected runtime bytes";
    const { result, calls, remote } = publication(
      `failed-${fail}`,
      initial,
      fail,
    );
    assert.notEqual(result.status, 0);
    if (initial === undefined) assert.ok(!existsSync(remote));
    else assert.equal(readFileSync(remote, "utf8"), initial);
    assert.ok(
      calls.every(
        (args) => args[1] !== "delete" && !args.includes("--clobber"),
      ),
    );
    if (fail !== "upload")
      assert.ok(calls.every((args) => args[1] !== "upload"));
  });
}
