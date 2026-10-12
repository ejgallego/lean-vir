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
import { createRuntimeModuleProject } from "./shared.mjs";

const directory = await mkdtemp(join(tmpdir(), "vir-json-safe-values-"));
try {
  const packagePath = process.env.VIR_JSON_SAFE_PACKAGE ?? join(directory, "json-safe.irpkg");
  if (!process.env.VIR_JSON_SAFE_PACKAGE) {
    const project = await createRuntimeModuleProject(`${packagePath}.modules`, {
      JsonSafePrivate: await readFile(new URL("../../fixtures/runtime/JsonSafePrivate.lean", import.meta.url), "utf8"),
      JsonSafeValues: await readFile(new URL("../../fixtures/runtime/JsonSafeValues.lean", import.meta.url), "utf8"),
    });
    const built = project.build();
    assert.equal(built.status, 0, built.stderr + built.stdout);
    const generated = project.runVirIrpkg([packagePath, `${packagePath}.report.md`, "--target-marked-module", "JsonSafeValues"]);
    assert.equal(generated.status, 0, generated.stderr + generated.stdout);
  }
  const packageBytes = await readFile(packagePath);
  const wasmDirectory = process.env.VIR_JSON_SAFE_WASM_DIR
    ? pathToFileURL(`${process.env.VIR_JSON_SAFE_WASM_DIR}/`) : new URL("../../web/public/", import.meta.url);
  for (const profile of ["vir-upstream.wasm", "vir-upstream.dev.wasm"]) {
    const runtime = await createVirRuntimeFactory({ wasmBytes: await readFile(new URL(profile, wasmDirectory)) })
      .createRuntime({ irPackageSet: [packageBytes] });
    const call = (name, value) => runtime.call(`JsonSafeValues.${name}`, JSON.parse(JSON.stringify(value)));
    try {
      const huge = "900719925474099312345678901234567890";
      const regularPrivate = { amount: BigInt(huge) };
      assert.equal(runtime.call("JsonSafeValues.privateAmount", regularPrivate), BigInt(huge));
      assert.deepEqual(runtime.call("JsonSafeValues.privateIdentity", regularPrivate), regularPrivate);
      assert.equal(runtime.call("JsonSafeValues.charAmount", { val: 0x10ffff }), 0x10ffffn);
      assert.throws(() => runtime.call("JsonSafeValues.charIdentity", { val: 0xd800 }), /Unicode scalar/);
      assert.equal(runtime.call("JsonSafeValues.finAmount", { val: 99n }), 99n);
      assert.throws(() => runtime.call("JsonSafeValues.finIdentity", { val: 100n }), /Fin 100/);
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
      assert.equal(call("privateAmount", { amount: huge }), huge);
      assert.deepEqual(call("privateIdentity", { amount: huge }), { amount: huge });
      for (const val of [0, 0xd7ff, 0xe000, 0xfdd0, 0xffff, 0x1f600, 0x10ffff]) {
        assert.equal(call("charAmount", { val }), String(val));
        assert.deepEqual(call("charIdentity", { val }), { val });
        const letter = { kind: "letter", value: { val } };
        assert.equal(call("numberingAmount", letter), String(val));
        assert.deepEqual(call("numberingIdentity", letter), letter);
      }
      for (const val of [0xd800, 0xdfff, 0x110000, 2 ** 32 + 65]) {
        assert.throws(() => call("charIdentity", { val }), /Unicode scalar/);
        assert.throws(() => call("numberingIdentity", { kind: "letter", value: { val } }), /Unicode scalar/);
        assert.equal(runtime.failure, null);
      }
      for (const val of ["0", "99"]) {
        assert.equal(call("finAmount", { val }), val);
        assert.deepEqual(call("finIdentity", { val }), { val });
      }
      for (const val of ["100", "101", "-1", huge]) assert.throws(() => call("finIdentity", { val }));
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
