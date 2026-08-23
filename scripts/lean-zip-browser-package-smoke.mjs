#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";

import { createVirRuntime } from "./lean-vir/js/vir-runtime.js";

const root = dirname(fileURLToPath(import.meta.url));
const build = JSON.parse(await readFile(join(root, "BUILD.json"), "utf8"));
assert.equal(build.schemaVersion, 1);
assert.equal(build.kind, "vir/lean-zip-browser-package");
assert.equal(build.entry, "VirLeanZipAcceptance.compressRaw");

const [wasmBytes, packageBytes, input, expected] = await Promise.all([
  readFile(join(root, build.runtime.wasm)),
  readFile(join(root, build.package.file)),
  readFile(join(root, build.smoke.input)),
  readFile(join(root, build.smoke.expected)),
]);
const runtime = await createVirRuntime({
  wasmBytes,
  irPackageSetBytes: [packageBytes],
});
try {
  assert.deepEqual(
    runtime.interfaceManifest.exports.map(({ entry }) => entry),
    [build.entry],
  );
  assert.notEqual(runtime.findManifestEntry(build.entry), null);
  const actual = runtime.call(build.entry, input, build.smoke.level);
  assert.ok(actual instanceof Uint8Array);
  assert.deepEqual(actual, new Uint8Array(expected));
  assert.deepEqual(inflateRawSync(actual), input);
} finally {
  runtime.dispose();
}
console.log("VIR lean-zip browser package smoke passed");
