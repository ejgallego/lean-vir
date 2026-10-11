/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { createVirRuntime } from "../../web/src/vir-runtime-node.js";
import { assert, manifestEntry, readRuntimeArtifacts } from "./shared.mjs";
import {
  booleanBoundary,
  nativeDescriptor,
  nativeField,
  objectBoundary,
  objectConstructor,
  primitiveBoundary,
} from "../support/interface-fixtures.mjs";

const { wasmBytes, defaultPackageBytes } = await readRuntimeArtifacts();
const runtime = await createVirRuntime({ wasmBytes, irPackageSet: [defaultPackageBytes] });
const originalExports = runtime.exports;
const originalTextRead = runtime.readWasmString;
const max = 0xffffffffn;
let textReads = 0;
let growOnSlotRead = false;

// Keep two USize slots between an object field and packed scalar data. Their
// manifest indexes include the object fields; the codec plan indexes do not.
const note = primitiveBoundary("string", "string");
const usize = nativeDescriptor("unsigned", { width: "usize" });
const bool = booleanBoundary();
const mixed = objectBoundary(
  "USizeFields.Mixed",
  [objectConstructor("USizeFields.Mixed.mk", {
    objectFieldCount: 1, usizeFieldCount: 2, scalarByteSize: 1,
  }, [
    nativeField("note", note.native, { tag: "object", index: 0 }),
    nativeField("first", usize, { tag: "usize", index: 0 }),
    nativeField("second", usize, { tag: "usize", index: 1 }),
    nativeField("enabled", bool.native, { tag: "scalar", offset: 0, size: 1 }),
  ])],
  { tag: "record", fields: [
    { key: "note", path: [0], value: note.value },
    { key: "first", path: [1], value: { tag: "number" } },
    { key: "second", path: [2], value: { tag: "number" } },
    { key: "enabled", path: [3], value: bool.value },
  ] },
);
const nested = objectBoundary(
  "USizeFields.Nested",
  [objectConstructor("USizeFields.Nested.mk", {
    objectFieldCount: 1, usizeFieldCount: 0, scalarByteSize: 0,
  }, [nativeField("inner", mixed.native, { tag: "object", index: 0 })])],
  { tag: "record", fields: [{ key: "inner", path: [0], value: mixed.value }] },
);
const entry = "Vir.Fixtures.InterfaceShapes.profileStatsBump";

function roundtrip(type, input, expected) {
  const object = runtime.makeObjectValue(type, input, "fields");
  try {
    textReads = 0;
    assert.deepEqual(runtime.liftObjectValue(type, object, "fields"), expected);
    assert.equal(textReads, 1, "only the actual String field needs text inspection");
  } finally {
    originalExports.vir_obj_dec(object);
  }
}

try {
  const profile = manifestEntry(runtime.interfaceManifest, entry).args[0].type;
  const profileStorage = profile.native.metadata.constructors[0].storage;
  assert.equal(profileStorage.objectFieldCount, 1);
  assert.equal(profileStorage.usizeFieldCount, 1);
  assert.equal(profileStorage.scalarByteSize, 17);
  runtime.exports = { ...originalExports,
    vir_obj_ctor_scalar_data(object, skipCount) {
      const data = originalExports.vir_obj_ctor_scalar_data(object, skipCount);
      if (skipCount === 0 && growOnSlotRead) {
        growOnSlotRead = false;
        originalExports.memory.grow(1);
      }
      return data;
    },
  };
  runtime.readWasmString = function (...args) {
    textReads++;
    return originalTextRead.apply(this, args);
  };
  for (const value of [0n, 1n, 1n << 31n, max]) {
    for (const inputValue of [value, Number(value), String(value)]) {
      const input = { enabled: true, level: 2, score16: 30, visits: 400,
        quota: inputValue, checksum: 6000n, tier: "pro", note: "ok" };
      roundtrip(profile, input, { ...input, quota: Number(value), checksum: 6000n });
      assert.deepEqual(runtime.call(entry, input),
        { enabled: false, level: 3, score16: 32, visits: 403,
          quota: Number((value + 4n) & max), checksum: 6005n, tier: "elite", note: "ok!" });
    }
    const input = { note: "mixed", first: value, second: max - value, enabled: true };
    const expected = { ...input, first: Number(value), second: Number(max - value) };
    roundtrip(mixed, input, expected);
    roundtrip(nested, { inner: input }, { inner: expected });
  }

  // Grow the real memory inside the accessor: the old ArrayBuffer is detached.
  // A view captured before the call would fail even though the pointer is live.
  growOnSlotRead = true;
  roundtrip(mixed, { note: "growth", first: max, second: 0n, enabled: false },
    { note: "growth", first: Number(max), second: 0, enabled: false });
  assert.equal(growOnSlotRead, false);

  assert.equal(runtime.failure, null);
} finally {
  runtime.exports = originalExports;
  runtime.readWasmString = originalTextRead;
  runtime.dispose();
}

console.log("USize fields smoke ok: mixed/nested layouts, exact Numbers and memory growth");
