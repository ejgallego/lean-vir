/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { createVirRuntime } from "../../web/src/vir-runtime-node.js";
import { INTERFACE_TAG } from "../../web/src/runtime/interface-tags.js";
import { assert, manifestEntry, readRuntimeArtifacts } from "./shared.mjs";

const { wasmBytes, defaultPackageBytes } = await readRuntimeArtifacts();
const runtime = await createVirRuntime({ wasmBytes, irPackageSet: [defaultPackageBytes] });
const originalExports = runtime.exports;
const originalTextRead = runtime.readWasmString;
const max = 0xffffffffn;
let textReads = 0;
let growOnSlotRead = false;

// Keep two USize slots between an object field and packed scalar data. Their
// manifest indexes include the object fields; the codec plan indexes do not.
const mixed = {
  interfaceTag: INTERFACE_TAG.STRUCTURE,
  typeName: "USizeFields.Mixed",
  objectFieldCount: 1, usizeFieldCount: 2, scalarByteSize: 1,
  fields: [
    { name: "note", type: { interfaceTag: INTERFACE_TAG.STRING }, layout: { kind: "object", index: 0 } },
    { name: "first", type: { interfaceTag: INTERFACE_TAG.USIZE }, layout: { kind: "usize", index: 1 } },
    { name: "second", type: { interfaceTag: INTERFACE_TAG.USIZE }, layout: { kind: "usize", index: 2 } },
    { name: "enabled", type: { interfaceTag: INTERFACE_TAG.BOOL }, layout: { kind: "scalar", offset: 0, size: 1 } },
  ],
};
const nested = {
  interfaceTag: INTERFACE_TAG.STRUCTURE,
  typeName: "USizeFields.Nested",
  objectFieldCount: 1, usizeFieldCount: 0, scalarByteSize: 0,
  fields: [{ name: "inner", type: mixed, layout: { kind: "object", index: 0 } }],
};
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
  assert.equal(profile.objectFieldCount, 1);
  assert.equal(profile.usizeFieldCount, 1);
  assert.equal(profile.scalarByteSize, 17);
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
      roundtrip(profile, input, { ...input, quota: String(value), checksum: "6000" });
      assert.deepEqual(runtime.call(entry, input),
        { enabled: false, level: 3, score16: 32, visits: 403,
          quota: String((value + 4n) & max), checksum: "6005", tier: "elite", note: "ok!" });
    }
    const input = { note: "mixed", first: value, second: max - value, enabled: true };
    const expected = { ...input, first: String(value), second: String(max - value) };
    roundtrip(mixed, input, expected);
    roundtrip(nested, { inner: input }, { inner: expected });
  }

  // Grow the real memory inside the accessor: the old ArrayBuffer is detached.
  // A view captured before the call would fail even though the pointer is live.
  growOnSlotRead = true;
  roundtrip(mixed, { note: "growth", first: max, second: 0n, enabled: false },
    { note: "growth", first: String(max), second: "0", enabled: false });
  assert.equal(growOnSlotRead, false);

  const absent = originalExports.vir_obj_scalar(0);
  assert.throws(() => runtime.readObjectUSizeField(mixed, absent, 0, "absent"),
    /USize field 1 is unavailable/);
  assert.equal(runtime.failure, null);
} finally {
  runtime.exports = originalExports;
  runtime.readWasmString = originalTextRead;
  runtime.dispose();
}

console.log("USize fields smoke ok: mixed/nested layouts, exact strings and memory growth");
