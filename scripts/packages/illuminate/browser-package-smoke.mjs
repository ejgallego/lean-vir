#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createVirRuntime } from "./lean-vir/js/vir-runtime.js";
import {
  normalizeVirTraceResult,
  prepareVirPlayerAnimation,
} from "./smoke.vir-player-trace.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const build = JSON.parse(await readFile(join(root, "BUILD.json"), "utf8"));
assert.equal(build.schemaVersion, 1);
assert.equal(build.kind, "vir/illuminate-browser-package");

const [wasmBytes, examples] = await Promise.all([
  readFile(join(root, build.runtime.wasm)),
  readFile(join(root, build.workload.smokeExamples), "utf8").then(JSON.parse),
]);
assert.ok(examples.length > 0);

const runtime = await createVirRuntime({
  wasmBytes,
  irPackageSet: pathToFileURL(join(root, build.package.setDescriptor)),
  fetchBytes: (url) => readFile(url),
});
try {
  assert.notEqual(runtime.findManifestEntry(build.entry), null);
  const example = examples[0];
  const value = normalizeVirTraceResult(
    runtime.call(build.entry, prepareVirPlayerAnimation(example.data), []),
  );
  assert.equal(value.ok, true);
  assert.equal(value.actions.length, 1);
  assert.equal(value.actions[0].frame, 0);
} finally {
  runtime.dispose();
}
console.log("VIR Illuminate browser package smoke passed");
