/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";

import {
  createVirRuntimeFactory,
  fetchBytes,
} from "../../web/src/vir-runtime.js";

const encoder = new TextEncoder();
const descriptorUrl = new URL("https://example.test/packages/Root.irpkg-set.json");
const validDescriptor = {
  format: "lean-vir-ir-package-set",
  version: 1,
  packages: [
    {
      module: "Example.Dependency",
      role: "dependency",
      path: "Root.parts/Example.Dependency.irpkg",
    },
    {
      module: "Example.Root",
      role: "root",
      path: "Root.irpkg",
    },
  ],
};

const fetchedUrls = [];
const factory = createVirRuntimeFactory({
  fetchBytes: async (url) => {
    fetchedUrls.push(String(url));
    if (String(url) === descriptorUrl.href) {
      return encodeDescriptor(validDescriptor);
    }
    return encoder.encode(String(url));
  },
});
const members = await factory.fetchIrPackageSet(descriptorUrl);
assert.deepEqual(fetchedUrls, [
  descriptorUrl.href,
  "https://example.test/packages/Root.parts/Example.Dependency.irpkg",
  "https://example.test/packages/Root.irpkg",
]);
assert.deepEqual(
  members.map((bytes) => new TextDecoder().decode(bytes)),
  fetchedUrls.slice(1),
);

await assertInvalidDescriptor("not JSON", /invalid IR package-set descriptor JSON/);
await assertInvalidDescriptor(null, /must be a JSON object/);
await assertInvalidDescriptor(
  { ...validDescriptor, format: "other" },
  /unsupported IR package-set descriptor format "other".*expected "lean-vir-ir-package-set"/,
);
await assertInvalidDescriptor(
  { ...validDescriptor, version: 2 },
  /unsupported IR package-set descriptor version 2.*expected 1/,
);
await assertInvalidDescriptor(
  { ...validDescriptor, packages: [] },
  /must list at least one package/,
);
await assertInvalidDescriptor(
  { ...validDescriptor, packages: [[]] },
  /entry 1 must be an object/,
);
await assertInvalidEntry(
  { module: "", role: "root", path: "Root.irpkg" },
  /entry 1 has no module/,
);
await assertInvalidEntry(
  { module: "Example.Root", role: "root", path: "" },
  /entry 1 has no path/,
);
await assertInvalidDescriptor({
  ...validDescriptor,
  packages: [validDescriptor.packages[0], {
    ...validDescriptor.packages[1],
    module: validDescriptor.packages[0].module,
  }],
}, /entry 2 duplicates module "Example.Dependency"/);
await assertInvalidDescriptor({
  ...validDescriptor,
  packages: [validDescriptor.packages[0], {
    ...validDescriptor.packages[1],
    path: validDescriptor.packages[0].path,
  }],
}, /entry 2 duplicates path "Root.parts\/Example.Dependency.irpkg"/);
await assertInvalidDescriptor({
  ...validDescriptor,
  packages: [{ ...validDescriptor.packages[0], role: "root" }, validDescriptor.packages[1]],
}, /entry 1 must have role "dependency", got "root"/);
await assertInvalidDescriptor({
  ...validDescriptor,
  packages: [validDescriptor.packages[0], { ...validDescriptor.packages[1], role: "dependency" }],
}, /entry 2 must have role "root", got "dependency"/);

const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = async () => ({
    ok: false,
    status: 404,
    statusText: "Not Found",
  });
  await assert.rejects(
    () => fetchBytes("https://example.test/missing.irpkg"),
    /failed to load https:\/\/example\.test\/missing\.irpkg: HTTP 404 Not Found/,
  );
} finally {
  globalThis.fetch = originalFetch;
}

console.log("IR package-set descriptor smoke ok");

function encodeDescriptor(descriptor) {
  return encoder.encode(typeof descriptor === "string" ? descriptor : JSON.stringify(descriptor));
}

async function assertInvalidEntry(entry, pattern) {
  await assertInvalidDescriptor({ ...validDescriptor, packages: [entry] }, pattern);
}

async function assertInvalidDescriptor(descriptor, pattern) {
  let memberFetches = 0;
  const invalidFactory = createVirRuntimeFactory({
    fetchBytes: async (url) => {
      if (String(url) === descriptorUrl.href) {
        return encodeDescriptor(descriptor);
      }
      memberFetches += 1;
      return new Uint8Array();
    },
  });
  await assert.rejects(() => invalidFactory.fetchIrPackageSet(descriptorUrl), pattern);
  assert.equal(memberFetches, 0, "invalid descriptors must fail before member fetches start");
}
