/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  createVirRuntimeFactory,
  fetchBytes,
  IR_PACKAGE_SET_FORMAT,
  IR_PACKAGE_SET_VERSION,
} from "../../web/src/vir-runtime.js";

const encoder = new TextEncoder();
const descriptorUrl = new URL(
  "https://example.test/packages/Root.irpkg-set.json",
);
const packageEntry = (module, role, path) => {
  const bytes = encoder.encode(new URL(path, descriptorUrl).href);
  return {
    module,
    role,
    path,
    byteLength: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
};
const validDescriptor = {
  format: IR_PACKAGE_SET_FORMAT,
  version: IR_PACKAGE_SET_VERSION,
  packages: [
    packageEntry("Example.Dependency", "dependency", "Root.parts/0.irpkg"),
    packageEntry("Example.Root", "root", "Root.irpkg"),
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
const packageSet = await factory.fetchIrPackageSet(descriptorUrl);
assert.deepEqual(fetchedUrls, [
  descriptorUrl.href,
  "https://example.test/packages/Root.parts/0.irpkg",
  "https://example.test/packages/Root.irpkg",
]);
assert.deepEqual(
  packageSet.members.map(({ bytes }) => new TextDecoder().decode(bytes)),
  fetchedUrls.slice(1),
);
assert.equal(packageSet.descriptorUrl, descriptorUrl);
assert.deepEqual(
  packageSet.members.map(({ module, role }) => [module, role]),
  [
    ["Example.Dependency", "dependency"],
    ["Example.Root", "root"],
  ],
);

await assertInvalidDescriptor(
  "not JSON",
  /invalid IR package-set descriptor JSON/,
);
await assertInvalidDescriptor(null, /must be a JSON object/);
await assertInvalidDescriptor(
  { ...validDescriptor, format: "other" },
  /unsupported IR package-set descriptor format "other".*expected "lean-vir-ir-package-set"/,
);
await assertInvalidDescriptor(
  { ...validDescriptor, version: IR_PACKAGE_SET_VERSION + 1 },
  /unsupported IR package-set descriptor version 3.*expected 2/,
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
  { ...validDescriptor.packages[1], module: "" },
  /entry 1 has no module/,
);
await assertInvalidEntry(
  { ...validDescriptor.packages[1], path: "" },
  /entry 1 has no path/,
);
await assertInvalidEntry(
  { ...validDescriptor.packages[1], byteLength: 0 },
  /byteLength must be a positive safe integer/,
);
await assertInvalidEntry(
  { ...validDescriptor.packages[1], sha256: "not-a-digest" },
  /sha256 must be a lowercase SHA-256 digest/,
);
for (const path of [
  "../Root.irpkg",
  "/Root.irpkg",
  "https://other.test/Root.irpkg",
  "Root\\file.irpkg",
  "Root.irpkg?download=1",
  "Root%2eirpkg",
  "Root parts/Root.irpkg",
]) {
  await assertInvalidEntry(
    { ...validDescriptor.packages[1], path },
    /path must be a normalized relative path/,
  );
}
await assertInvalidEntry(
  { ...validDescriptor.packages[1], module: " ModuleSetFixture.Root" },
  /module must be a normalized Lean module name/,
);
for (const module of ["..", "A B", "A/B", "A:", "«»", "A."]) {
  await assertInvalidEntry(
    { ...validDescriptor.packages[1], module },
    /module must be a normalized Lean module name/,
  );
}
const escapedModuleSet = await createVirRuntimeFactory({
  fetchBytes: async (url) =>
    String(url) === descriptorUrl.href
      ? encodeDescriptor({
          ...validDescriptor,
          packages: [
            packageEntry("«Example Dependency»", "root", "Root.irpkg"),
          ],
        })
      : encoder.encode(String(url)),
}).fetchIrPackageSet(descriptorUrl);
assert.equal(escapedModuleSet.members[0].module, "«Example Dependency»");
await assertInvalidDescriptor(
  {
    ...validDescriptor,
    packages: [
      validDescriptor.packages[0],
      {
        ...validDescriptor.packages[1],
        module: validDescriptor.packages[0].module,
      },
    ],
  },
  /entry 2 duplicates module "Example.Dependency"/,
);
await assertInvalidDescriptor(
  {
    ...validDescriptor,
    packages: [
      validDescriptor.packages[0],
      {
        ...validDescriptor.packages[1],
        path: validDescriptor.packages[0].path,
      },
    ],
  },
  /entry 2 duplicates path "Root.parts\/0.irpkg"/,
);
await assertInvalidDescriptor(
  {
    ...validDescriptor,
    packages: [
      { ...validDescriptor.packages[0], role: "root" },
      validDescriptor.packages[1],
    ],
  },
  /entry 1 must have role "dependency", got "root"/,
);
await assertInvalidDescriptor(
  {
    ...validDescriptor,
    packages: [
      validDescriptor.packages[0],
      { ...validDescriptor.packages[1], role: "dependency" },
    ],
  },
  /entry 2 must have role "root", got "dependency"/,
);

await assertMemberFailure(
  {
    ...validDescriptor.packages[1],
    byteLength: validDescriptor.packages[1].byteLength + 1,
  },
  /has .* bytes; expected/,
);

await assert.rejects(
  () => createVirRuntimeFactory().createRuntime({ irPackageSet: [] }),
  /byte input must be a non-empty array/,
);
await assert.rejects(
  () => createVirRuntimeFactory().createRuntime({ irPackageSet: {} }),
  /must be a fetched package-set object/,
);
await assert.rejects(
  () =>
    createVirRuntimeFactory().createRuntime({
      irPackageSetBytes: [new Uint8Array()],
    }),
  /unknown option: irPackageSetBytes/,
);
await assertMemberFailure(
  { ...validDescriptor.packages[1], sha256: "0".repeat(64) },
  /checksum mismatch/,
);

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
  return encoder.encode(
    typeof descriptor === "string" ? descriptor : JSON.stringify(descriptor),
  );
}

async function assertInvalidEntry(entry, pattern) {
  await assertInvalidDescriptor(
    { ...validDescriptor, packages: [entry] },
    pattern,
  );
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
  await assert.rejects(
    () => invalidFactory.fetchIrPackageSet(descriptorUrl),
    pattern,
  );
  assert.equal(
    memberFetches,
    0,
    "invalid descriptors must fail before member fetches start",
  );
}

async function assertMemberFailure(entry, pattern) {
  const memberFactory = createVirRuntimeFactory({
    fetchBytes: async (url) =>
      String(url) === descriptorUrl.href
        ? encodeDescriptor({ ...validDescriptor, packages: [entry] })
        : encoder.encode(String(url)),
  });
  await assert.rejects(
    () => memberFactory.fetchIrPackageSet(descriptorUrl),
    pattern,
  );
}
