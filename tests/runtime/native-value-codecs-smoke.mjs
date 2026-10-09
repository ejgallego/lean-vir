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
import { generateIrPackage } from "./shared.mjs";

const leaf = (amount) => ({ kind: "leaf", value: amount });
const value = {
  kind: "node",
  fields: {
    optional: { kind: "some", value: leaf(2n) },
    children: [leaf(5n), leaf(8n)],
    pair: { fst: 7n, snd: leaf(11n) },
    choice: { kind: "inl", value: leaf(13n) },
  },
};
const layout = {
  amount: 900719925474099312345678901234567890n,
  flag: true,
  stride: 42,
  wide: 9223372036854775815n,
  small: 2.5,
};
const directory = await mkdtemp(join(tmpdir(), "vir-native-codecs-"));
try {
  const path = join(directory, "codecs.irpkg");
  await generateIrPackage(
    "NativeValueCodecs",
    new URL("../../fixtures/runtime/NativeValueCodecs.lean", import.meta.url),
    path,
    "marked",
  );
  const packageBytes = await readFile(path);
  const sources = [
    [
      "public source",
      createVirRuntimeFactory,
      new URL("../../web/public/", import.meta.url),
    ],
  ];
  if (process.env.VIR_NATIVE_VALUE_CODECS_SDK) {
    const sdk = pathToFileURL(`${process.env.VIR_NATIVE_VALUE_CODECS_SDK}/`);
    const { createVirRuntimeFactory: createSdkFactory } = await import(
      new URL("js/vir-runtime-node.js", sdk)
    );
    sources.push(["extracted SDK", createSdkFactory, new URL("wasm/", sdk)]);
  }
  for (const [source, createFactory, base] of sources)
    for (const profile of ["vir-upstream.wasm", "vir-upstream.dev.wasm"]) {
      const runtime = await createFactory({
        wasmBytes: await readFile(new URL(profile, base)),
      }).createRuntime({ irPackageSet: [packageBytes] });
      const call = (name, ...args) =>
        runtime.call(`NativeValueCodecs.${name}`, ...args);
      try {
        const retiredTags = new Set([17, 18, 19]);
        function check(type) {
          if (type && typeof type === "object") {
            assert.ok(!retiredTags.has(type.interfaceTag));
            for (const child of Object.values(type)) check(child);
          }
        }
        check(runtime.interfaceManifest.exports);
        const tree = runtime.findManifestEntry("NativeValueCodecs.identity")
          .args[0].type;
        const fields = tree.constructors[1].fields;
        const optionalRef = fields[0].type.constructors[1].fields[0].type;
        const consFields = fields[1].type.constructors[1].fields;
        const pairRef = fields[2].type.fields[1].type;
        for (const ref of [optionalRef, consFields[0].type, pairRef])
          assert.deepEqual(
            [ref.name, ref.depth],
            ["NativeValueCodecs.Tree", 1],
          );
        assert.deepEqual(
          [consFields[1].type.name, consFields[1].type.depth],
          ["List", 0],
        );
        assert.deepEqual(
          [
            fields[3].type.constructors[0].type.name,
            fields[3].type.constructors[0].type.depth,
          ],
          ["NativeValueCodecs.Tree", 0],
        );
        assert.deepEqual(call("sample"), value);
        assert.equal(call("score", value), 47n);
        assert.deepEqual(call("identity", value), value);
        const lists = [[], [0n, 1n], [900719925474099312345678901234567890n]];
        assert.deepEqual(call("nestedLists", lists), lists);
        for (const marker of [
          { kind: "none" },
          { kind: "some", value: { kind: "none" } },
          { kind: "some", value: { kind: "some", value: undefined } },
        ]) {
          const present = { kind: "some", value: { fst: 0n, snd: marker } };
          assert.deepEqual(call("optionProduct", present), present);
        }
        assert.deepEqual(call("mixedLayout", layout), layout);
        const roots = runtime.exports.vir_resource_roots_active();
        const bad = structuredClone(value);
        bad.fields.children = [leaf(1n), leaf(2n), leaf(-1n)];
        assert.throws(
          () => call("identity", bad),
          /natural|decimal|non-negative/,
        );
        assert.equal(runtime.failure, null);
        assert.equal(runtime.exports.vir_resource_roots_active(), roots);
        assert.deepEqual(call("identity", value), value);
        const ctor = runtime.exports.vir_obj_ctor;
        let calls = 0;
        runtime.exports.vir_obj_ctor = (...args) =>
          ++calls === 5 ? 0 : ctor(...args);
        try {
          assert.throws(() => call("identity", value), /constructor object/);
        } finally {
          runtime.exports.vir_obj_ctor = ctor;
        }
        assert.equal(runtime.failure, null);
        assert.deepEqual(call("identity", value), value);
        const allocate = runtime.allocByteLength;
        let grown = false;
        runtime.allocByteLength = function (size, label) {
          const ptr = allocate.call(this, size, label);
          if (label === "constructor scratch" && !grown) {
            this.exports.memory.grow(1);
            grown = true;
          }
          return ptr;
        };
        try {
          assert.deepEqual(call("mixedLayout", layout), layout);
        } finally {
          runtime.allocByteLength = allocate;
        }
        assert.ok(grown);
        const long = Array.from({ length: 4096 }, (_, i) => [BigInt(i)]);
        assert.deepEqual(call("nestedLists", long), long);
        assert.equal(runtime.exports.vir_resource_roots_active(), roots);
        assert.equal(runtime.hostState.leanObjectHandleCells.size, 0);
        console.log(`${source} ${profile}: native value codecs PASS`);
      } finally {
        runtime.dispose();
      }
    }
  console.log(
    "native value codecs PASS: compiler layouts, lexical mixed recursion, nested parameters, failure cleanup and memory growth",
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
