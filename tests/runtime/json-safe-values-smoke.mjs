/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
*/
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createVirRuntimeFactory } from "../../web/src/vir-runtime-node.js";
import { ConstructorScratch } from "../../web/src/runtime/constructor-scratch.js";
import { generateIrPackage } from "./shared.mjs";

const directory = await mkdtemp(join(tmpdir(), "vir-json-safe-values-"));
try {
  const packagePath = process.env.VIR_JSON_SAFE_PACKAGE ?? join(directory, "json-safe.irpkg");
  if (!process.env.VIR_JSON_SAFE_PACKAGE)
    await generateIrPackage("JsonSafeValues", new URL("../../fixtures/runtime/JsonSafeValues.lean", import.meta.url), packagePath, "marked");
  const packageBytes = await readFile(packagePath);
  const wasmDirectory = process.env.VIR_JSON_SAFE_WASM_DIR
    ? pathToFileURL(`${process.env.VIR_JSON_SAFE_WASM_DIR}/`) : new URL("../../web/public/", import.meta.url);
  for (const profile of ["vir-upstream.wasm", "vir-upstream.dev.wasm"]) {
    const runtime = await createVirRuntimeFactory({ wasmBytes: await readFile(new URL(profile, wasmDirectory)) })
      .createRuntime({ irPackageSet: [packageBytes] });
    const call = (name, value) => runtime.call(`JsonSafeValues.${name}`, JSON.parse(JSON.stringify(value)));
    try {
      // Local prototype selection seam, not a new public factory/call option.
      // The production call/ownership path receives the selected bound codecs.
      runtime.makeObjectValue = function (pair, value, label) {
        const scratch = new ConstructorScratch(this);
        try { return this.nativeValueCodec(pair, { representation: "json-safe-v1" }).lower(value, label, scratch); }
        finally { scratch.dispose(); }
      };
      runtime.liftObjectValue = function (pair, obj, label) {
        return this.nativeValueCodec(pair, { representation: "json-safe-v1" }).lift(obj, label);
      };
      const huge = "900719925474099312345678901234567890";
      for (const [index, value] of [{ kind: "none" }, { kind: "some", value: { kind: "none" } },
        { kind: "some", value: { kind: "some", value: huge } }].entries()) {
        assert.equal(call("nestedKind", value), index, "independent Lean constructor observation");
        assert.equal(call("nestedAmount", value), index === 2 ? huge : "0");
        assert.deepEqual(call("nestedIdentity", value), value);
      }
      for (const [value, present] of [[{ kind: "none" }, false], [{ kind: "some", value: null }, true]]) {
        assert.equal(call("unitPresent", value), present);
        assert.deepEqual(call("unitIdentity", value), value);
      }
      assert.equal(call("intIdentity", `-${huge}`), `-${huge}`);
      assert.deepEqual(call("bytesIdentity", [0, 128, 255]), [0, 128, 255]);
      const packed = { large: "18446744073709551615", marker: true, size: 42, tiny: 255 };
      const descriptor = runtime.findManifestEntry("JsonSafeValues.packedIdentity").args[0].type.native;
      const fields = descriptor.metadata.constructors[0].fields;
      assert.equal(fields.find(field => field.name === "large").location.tag, "scalar");
      assert.equal(fields.find(field => field.name === "size").location.tag, "usize");
      assert.equal(call("packedAmount", packed), packed.large);
      assert.equal(call("packedMarker", packed), true);
      assert.deepEqual(call("packedIdentity", packed), packed);
      const tree = { kind: "node", value: [{ kind: "leaf", value: huge },
        { kind: "node", value: [{ kind: "leaf", value: "7" }] }] };
      assert.equal(call("treeFirstAmount", tree), huge);
      assert.equal(call("treeFirstAmount", tree.value[1]), "7");
      assert.deepEqual(call("treeIdentity", tree), tree);
      const rows = [{ label: "Unicode α雪", count: huge }, { label: "second", count: "7" }];
      assert.equal(call("rowsTotal", rows), (BigInt(huge) + 7n).toString());
      assert.deepEqual(call("rowsIdentity", rows), rows);
      for (const count of [1, "01", "-1", " 1", "1e3"]) {
        assert.throws(() => call("rowsIdentity", [...rows, { label: "later invalid", count }]), /canonical unsigned decimal/);
        assert.equal(runtime.failure, null);
        assert.equal(runtime.exports.vir_resource_roots_active(), 0);
        assert.equal(call("rowsTotal", rows), (BigInt(huge) + 7n).toString());
      }
      assert.throws(() => call("packedIdentity", { ...packed, large: "18446744073709551616" }), /out of range/);
      assert.throws(() => call("packedIdentity", { ...packed, size: "42" }), /must be an integer/);
      assert.throws(() => call("unitIdentity", { kind: "some" }), /missing value/);
      assert.deepEqual(call("packedIdentity", packed), packed);
      console.log(`${profile}: JSON-safe ordinary JSON / independent Lean observations / packed storage / recursion / failure and recovery PASS`);
    } finally { runtime.dispose(); }
  }
} finally { await rm(directory, { recursive: true, force: true }); }
