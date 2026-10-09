/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createVirRuntimeFactory } from "../../web/src/vir-runtime-node.js";
import { INTERFACE_TAG } from "../../web/src/runtime/interface-tags.js";
import { defaultValueForType } from "../../web/app/pages/interface-inputs.js";
import { generateIrPackage } from "./shared.mjs";

const huge = 900719925474099312345678901234567890n;
const none = { kind: "none" };
const some = (value) => ({ kind: "some", value });
const nested = [none, some(none), some(some(huge))];
const bundle = {
  nested: some(none), marker: some(undefined),
  items: [none, some(none), some(some(7n))],
  pair: { fst: none, snd: some("α雪") },
};
const tree = { kind: "next", value: some({ kind: "inl", value: { kind: "leaf", value: 19n } }) };

const directory = await mkdtemp(join(tmpdir(), "vir-option-values-"));
try {
  const packagePath = join(directory, "options.irpkg");
  await generateIrPackage("OptionValues", new URL("../../fixtures/runtime/OptionValues.lean", import.meta.url), packagePath, "marked");
  const packageBytes = await readFile(packagePath);
  const sources = [["public source", createVirRuntimeFactory, new URL("../../web/public/", import.meta.url)]];
  if (process.env.VIR_OPTION_VALUES_SDK) {
    const sdk = pathToFileURL(`${process.env.VIR_OPTION_VALUES_SDK}/`);
    const { createVirRuntimeFactory: createSdkFactory } = await import(new URL("js/vir-runtime-node.js", sdk));
    sources.push(["extracted SDK", createSdkFactory, new URL("wasm/", sdk)]);
  }
  for (const [composition, createFactory, wasmDirectory] of sources) {
    for (const profile of ["vir-upstream.wasm", "vir-upstream.dev.wasm"]) {
      const factory = createFactory({ wasmBytes: await readFile(new URL(profile, wasmDirectory)) });
      const runtime = await factory.createRuntime({ irPackageSet: [packageBytes] });
      const host = runtime.hostState;
      const call = (name, ...args) => runtime.call(`OptionValues.${name}`, ...args);
      assert.deepEqual(defaultValueForType(runtime.findManifestEntry("OptionValues.nestedIdentity").args[0].type), none);
      let callback;
      let retained;
      try {
        for (const [index, value] of nested.entries()) {
          // Independent Lean pattern matches distinguish the constructors and payload.
          assert.equal(call("nestedSampleKind", index), BigInt(index));
          assert.equal(call("nestedKind", value), BigInt(index));
          assert.equal(call("nestedAmount", value), index === 2 ? huge : 0n);
          const produced = call("nestedSample", index);
          assert.deepEqual(produced, value);
          assert.equal(call("nestedKind", produced), BigInt(index));
          assert.deepEqual(call("nestedIdentity", produced), value);
        }
        for (const present of [false, true]) {
          const value = present ? some(undefined) : none;
          assert.equal(call("unitSamplePresent", present), present);
          assert.deepEqual(call("unitSample", present), value);
          assert.equal(call("unitPresent", value), present);
          assert.deepEqual(call("unitIdentity", value), value);
        }
        // Unit accepts null too, but lifting keeps its regular undefined spelling.
        assert.deepEqual(call("unitIdentity", some(null)), some(undefined));
        assert.deepEqual(call("bundleSample"), bundle);
        assert.deepEqual(call("bundleIdentity", bundle), bundle);
        assert.equal(call("bundleObservation", bundle), 1104n);
        // Option fields follow the same required-field rule as other records.
        assert.throws(() => call("bundleIdentity", { items: [], pair: { fst: none, snd: none } }), /missing field nested/);
        assert.equal(runtime.failure, null);
        assert.deepEqual(call("bundleIdentity", bundle), bundle);
        for (const value of [tree, { kind: "next", value: none }, { kind: "next", value: some({ kind: "inr", value: false }) }]) {
          assert.deepEqual(call("treeIdentity", value), value);
        }
        assert.deepEqual(call("treeSample"), tree);
        assert.equal(call("treeScore", tree), 29n);

        const shared = { kind: "none", value: "this is payload data" };
        for (const value of [null, undefined, false, 0, -0, NaN, huge, "α雪", shared, [1, 2], Symbol("payload"), () => 7]) {
          assert.equal(call("wrapJsPresent", value), true);
          const produced = call("wrapJs", value);
          assert.equal(produced.kind, "some");
          assert.ok(Object.hasOwn(produced, "value"));
          assert.ok(Object.is(produced.value, value));
          assert.equal(call("jsPresent", produced), true);
          assert.ok(Object.is(call("jsIdentity", produced).value, value));
          assert.equal(runtime.exports.vir_resource_roots_active(), 0);
        }
        assert.equal(call("jsPresent", none), false);
        for (const value of [null, "α雪"]) {
          assert.equal(call("nullableIdentity", value), value);
        }
        for (const value of [undefined, "α雪"]) {
          assert.equal(call("undefinedOrIdentity", value), value);
        }
        assert.deepEqual(call("jsArrayIdentity", [none, some(null), some(undefined), some(shared)]), [none, some(null), some(undefined), some(shared)]);

        callback = call("callback", 5n);
        assert.deepEqual(callback(none), none);
        assert.deepEqual(callback(some(huge)), some(huge + 5n));
        retained = call("retainNat", huge);
        assert.equal(call("refAmount", some(retained)), huge);
        const returned = call("refIdentity", some(retained));
        assert.equal(returned.kind, "some");
        assert.equal(call("refAmount", returned), huge);
        assert.deepEqual(call("refIdentity", none), none);

        const live = host.leanObjectHandleCells.size;
        for (const invalid of [null, undefined, huge, [], {}, { kind: "other" }, { kind: "some" }, { kind: "none", value: 1 }, { kind: "some", value: none, extra: 1 }, some(null), some({ kind: "some" }), some(some(-1))]) {
          assert.throws(() => call("nestedIdentity", invalid), /Option|missing value|non-negative|Nat/);
          assert.equal(runtime.failure, null);
          assert.equal(host.leanObjectHandleCells.size, live);
          assert.equal(runtime.exports.vir_resource_roots_active(), 0);
          assert.deepEqual(call("nestedIdentity", nested[1]), nested[1]);
        }
        // A later malformed element must release the earlier resource allocation.
        for (let repeat = 0; repeat < 3; repeat++) {
          assert.throws(() => call("jsArrayIdentity", [some(shared), { kind: "some" }]), /missing value/);
          assert.equal(runtime.exports.vir_resource_roots_active(), 0);
          assert.equal(host.leanObjectHandleCells.size, live);
          assert.deepEqual(call("jsArrayIdentity", [some(shared)]), [some(shared)]);
        }
        assert.throws(() => callback({ kind: "some" }), /missing value/);
        assert.deepEqual(callback(some(7n)), some(12n));

        const fresh = await factory.createRuntime({ irPackageSet: [packageBytes] });
        const freshHost = fresh.hostState;
        try {
          assert.throws(() => fresh.call("OptionValues.refAmount", some(retained)), /live Lean object handle resource/);
          assert.equal(fresh.failure, null);
          assert.equal(fresh.call("OptionValues.nestedKind", nested[1]), 1n);
        } finally { fresh.dispose(); }
        assert.equal(freshHost.leanObjectHandleCells.size, 0);
        assert.equal(runtime.failure, null);
        console.log(`${composition}, ${profile}: tagged Option round trips, independent observations, mixed containers, callbacks, resources, failure/reuse and disposal PASS`);
      } finally { runtime.dispose(); }
      assert.equal(host.leanObjectHandleCells.size, 0);
      assert.throws(() => callback(none), /disposed/);
    }
  }
} finally { await rm(directory, { recursive: true, force: true }); }
