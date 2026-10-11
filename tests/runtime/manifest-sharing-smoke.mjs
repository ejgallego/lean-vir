/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
*/
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createVirRuntimeFactory } from "../../web/src/vir-runtime-node.js";
import { readIrPackageInfo } from "../../web/src/runtime/ir-package.js";
import { generateIrPackage } from "./shared.mjs";

const directory = await mkdtemp(join(tmpdir(), "vir-shared-pairs-"));
try {
  const path = join(directory, "shared.irpkg");
  await generateIrPackage("SharedBoundaryPairs", new URL("../../fixtures/runtime/SharedBoundaryPairs.lean", import.meta.url), path, "marked");
  const bytes = await readFile(path), info = readIrPackageInfo(bytes);
  const section = info.package.sections.find(section => section.name === "interfaceManifest");
  const wire = JSON.parse(new TextDecoder().decode(bytes.subarray(section.offset + 12, section.offset + section.byteLength)));
  assert.equal(wire.interfaces.length, 4, "two generic families at two instantiations, with repeated calls shared");
  assert.equal(wire.exports.length, 6);
  const entry = name => info.manifest.exports.find(entry => entry.entry === `SharedBoundaryPairs.${name}`);
  for (const [first, second] of [["boxNat", "boxNatAgain"], ["treeNat", "treeNatAgain"]]) {
    assert.equal(entry(first).args[0].type, entry(second).result);
  }
  assert.notEqual(entry("boxNat").result, entry("boxString").result);
  assert.notEqual(entry("treeNat").result, entry("treeString").result);
  assert.equal(entry("treeNat").result.native.metadata.declaration, entry("treeString").result.native.metadata.declaration);
  for (const profile of ["vir-upstream.wasm", "vir-upstream.dev.wasm"]) {
    const runtime = await createVirRuntimeFactory({ wasmBytes: await readFile(new URL(`../../web/public/${profile}`, import.meta.url)) }).createRuntime({ irPackageSet: [bytes] });
    const call = (name, value) => runtime.call(`SharedBoundaryPairs.${name}`, value);
    try {
      const nat = { kind: "branch", fields: { optional: { kind: "some", value: { kind: "leaf", value: 42n } }, children: [{ kind: "leaf", value: 43n }] } };
      const string = { kind: "branch", fields: { optional: { kind: "some", value: { kind: "leaf", value: "left" } }, children: [{ kind: "leaf", value: "right" }] } };
      assert.deepEqual(call("boxNat", { value: 42n }), { value: 42n });
      assert.deepEqual(call("boxString", { value: "text" }), { value: "text" });
      assert.deepEqual(call("treeNat", nat), nat);
      assert.deepEqual(call("treeNatAgain", nat), nat);
      assert.deepEqual(call("treeString", string), string);
      const first = runtime.findManifestEntry("SharedBoundaryPairs.treeNat").args[0].type;
      const second = runtime.findManifestEntry("SharedBoundaryPairs.treeNatAgain").result;
      assert.equal(first, second);
      assert.equal(runtime.nativeValueCodec(first), runtime.nativeValueCodec(second));
      const bad = structuredClone(nat); bad.fields.children[0].value = -1n;
      assert.throws(() => call("treeNat", bad), /non-negative|natural/);
      assert.equal(runtime.failure, null);
      assert.deepEqual(call("treeNatAgain", nat), nat);
      assert.equal(runtime.exports.vir_resource_roots_active(), 0);
    } finally { runtime.dispose(); }
  }
} finally { await rm(directory, { recursive: true, force: true }); }
console.log("shared instantiated pairs, recursive owners and per-runtime caches: both-profile PASS");
