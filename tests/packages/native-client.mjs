/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Independent producer and cold native-precompiled consumer: a developer's
// dependency cache could conceal accidental umbrella imports. Retain evidence.
const root = fileURLToPath(new URL("../../", import.meta.url));
const evidence = mkdtempSync(join(tmpdir(), "vir-native-client-"));
const producer = join(evidence, "producer");
const client = join(evidence, "client");
mkdirSync(producer);
for (const path of ["Vir", "Vir.lean", "tools", "lakefile.lean", "lake-manifest.json",
    "lean-toolchain", "vir-resources"]) {
  cpSync(join(root, path), join(producer, path), { recursive: true });
}
mkdirSync(client);
for (const path of ["lakefile.lean", "NativeClient.lean", "Main.lean"]) {
  cpSync(join(root, "fixtures/native-client", path), join(client, path));
}
cpSync(join(root, "lean-toolchain"), join(client, "lean-toolchain"));
const lakefile = join(client, "lakefile.lean");
writeFileSync(lakefile, readFileSync(lakefile, "utf8").replace('"../.."', '"../producer"'));
console.log(`native client evidence: ${evidence}`);

function run(args, name) {
  const result = spawnSync(args[0], args.slice(1), {
    cwd: client, encoding: "utf8", timeout: 300000, maxBuffer: 8 * 1024 * 1024,
  });
  const output = (result.stdout ?? "") + (result.stderr ?? "");
  writeFileSync(join(evidence, name + ".log"), output);
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${name} failed; evidence: ${evidence}\n${output.slice(-6000)}`);
  return result.stdout;
}
run(["lake", "--no-cache", "build"], "cold-build");
const output = run([join(client, ".lake/build/bin/native_client")], "native-output");
const [greeting, numeric, descriptorText] = output.trim().split("\n");
assert.equal(greeting, "Hello, native 🌍");
assert.equal(numeric, "18014398509481986");
const descriptor = JSON.parse(descriptorText);
assert.equal(descriptor.logicalId, "native-client/encoder");
assert.equal(descriptor.schemaVersion, 2);
assert.ok(!Object.hasOwn(descriptor, "exports"));
assert.deepEqual(descriptor.compatibility,
  JSON.parse(readFileSync(join(producer, "vir-resources/compatibility.json"))));

// Use Lake's returned executable, not a reconstructed dependency build path.
const generator = run(["lake", "query", "@lean_vir/vir_irpkg"], "generator-build").trim();
run(["lake", "env", generator, join(evidence, "client.irpkg"), join(evidence, "report.md"),
  "--target-marked-module", "NativeClient"], "generator-run");
assert.ok(readFileSync(join(evidence, "client.irpkg")).length > 0);
const report = readFileSync(join(evidence, "report.md"), "utf8");
assert.ok(report.includes("NativeClient.greet") && report.includes("NativeClient.double"));
console.log("PASS cold native-precompiled client: markers, classifier, resource imports, native calls and generator");
