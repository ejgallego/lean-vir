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
import {
  readIrPackageInfo,
  replaceIrPackageManifest,
} from "../../web/src/runtime/ir-package.js";
import {
  packageTargetModeLabel,
  validatePackageTargets,
} from "../../web/src/runtime/package-targets.js";
import { readRuntimeArtifacts } from "./shared.mjs";

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
  /entry 1\.module must be a non-empty module identity/,
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
  /module must be a non-empty module identity/,
);
for (const module of ["A\u0000B", "A\nB", "A\u007fB"]) {
  await assertInvalidEntry(
    { ...validDescriptor.packages[1], module },
    /module must be a non-empty module identity/,
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
const opaqueModuleSet = await createVirRuntimeFactory({
  fetchBytes: async (url) =>
    String(url) === descriptorUrl.href
      ? encodeDescriptor({
          ...validDescriptor,
          packages: [packageEntry("A/B", "root", "Root.irpkg")],
        })
      : encoder.encode(String(url)),
}).fetchIrPackageSet(descriptorUrl);
assert.equal(opaqueModuleSet.members[0].module, "A/B");
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

for (const mode of ["toString", "constructor", "__proto__", ["all"]]) {
  assert.equal(packageTargetModeLabel(mode), null);
}
for (const origin of [
  { source: "Example.lean" },
  { module: "Example" },
]) {
  const markedMode = origin.module ? "markedModule" : "marked";
  for (const mode of ["explicit", "packageOnly", "all", markedMode]) {
    const explicitRoots = mode === "explicit" || mode === "packageOnly";
    const target = {
      ...origin,
      mode,
      roots: explicitRoots ? ["Example.value"] : [],
      resolvedRoots: ["Example.value"],
    };
    assert.doesNotThrow(() =>
      validatePackageTargets([target], "targets", { manifestVersion: 8 }),
    );
    assert.throws(
      () =>
        validatePackageTargets(
          [{ ...target, roots: explicitRoots ? [] : ["Example.value"] }],
          "targets",
          { manifestVersion: 8 },
        ),
      explicitRoots ? /roots must be non-empty/ : /roots must be empty/,
    );
  }
  assert.throws(
    () =>
      validatePackageTargets(
        [
          {
            ...origin,
            mode: origin.module ? "marked" : "markedModule",
            roots: [],
            resolvedRoots: [],
          },
        ],
        "targets",
        { manifestVersion: 8 },
      ),
    origin.module
      ? /module requires mode markedModule/
      : /mode markedModule requires a module/,
  );
}
const legacyTarget = {
  source: "Example.lean",
  mode: "markedModules",
  roots: [],
  resolvedRoots: [],
};
for (const manifestVersion of [6, 7]) {
  assert.doesNotThrow(() =>
    validatePackageTargets([legacyTarget], "targets", { manifestVersion }),
  );
  assert.throws(
    () =>
      validatePackageTargets(
        [{ ...legacyTarget, source: undefined, module: "Example" }],
        "targets",
        { manifestVersion },
      ),
    /module requires mode markedModule/,
  );
}
assert.throws(
  () =>
    validatePackageTargets([legacyTarget], "targets", { manifestVersion: 8 }),
  /mode must be one of/,
);

// Fetched members and raw byte inputs remain caller-owned. Changing them while
// the real Wasm is acquired must not change the validated installation snapshot.
const { wasmBytes, defaultPackageBytes } = await readRuntimeArtifacts();
const manifest = readIrPackageInfo(defaultPackageBytes).manifest;
manifest.metadata.packageSetMember = { module: "Example.Root", role: "root" };
manifest.metadata.targets = [
  {
    module: "Example.Root",
    mode: "markedModule",
    roots: [],
    resolvedRoots: manifest.metadata.targets.flatMap(
      (target) => target.resolvedRoots,
    ),
  },
];
const rootBytes = replaceIrPackageManifest(defaultPackageBytes, manifest);
const rootEntry = {
  module: "Example.Root",
  role: "root",
  path: "Root.irpkg",
  byteLength: rootBytes.byteLength,
  sha256: createHash("sha256").update(rootBytes).digest("hex"),
};
for (const inputKind of ["fetched", "bytes"]) {
  let releaseWasm;
  let reachedWasm;
  const waitForWasm = new Promise((resolve) => {
    releaseWasm = resolve;
  });
  const wasmRequested = new Promise((resolve) => {
    reachedWasm = resolve;
  });
  const delayedFactory = createVirRuntimeFactory({
    wasmUrl: "https://example.test/vir.wasm",
    defaultHostBindings: {},
    fetchBytes: async (url) => {
      if (String(url).endsWith("vir.wasm")) {
        reachedWasm();
        await waitForWasm;
        return wasmBytes;
      }
      return String(url) === descriptorUrl.href
        ? encodeDescriptor({ ...validDescriptor, packages: [rootEntry] })
        : rootBytes;
    },
  });
  const input =
    inputKind === "fetched"
      ? await delayedFactory.fetchIrPackageSet(descriptorUrl)
      : [Uint8Array.from(rootBytes)];
  const callerBytes =
    inputKind === "fetched" ? input.members[0].bytes : input[0];
  const pendingRuntime = delayedFactory.createRuntime({ irPackageSet: input });
  await Promise.race([
    wasmRequested,
    pendingRuntime.then(() =>
      assert.fail("runtime completed before Wasm was released"),
    ),
  ]);
  const changedManifest = readIrPackageInfo(callerBytes).manifest;
  changedManifest.metadata.generator = `X${manifest.metadata.generator.slice(1)}`;
  const changedBytes = replaceIrPackageManifest(callerBytes, changedManifest);
  assert.equal(changedBytes.byteLength, callerBytes.byteLength);
  callerBytes.set(changedBytes);
  assert.notEqual(
    createHash("sha256").update(callerBytes).digest("hex"),
    rootEntry.sha256,
  );
  releaseWasm();
  const runtime = await pendingRuntime;
  try {
    assert.equal(
      runtime.packageMetadata.generator,
      manifest.metadata.generator,
    );
    assert.equal(runtime.call("fib", 12), "144");
    if (inputKind === "fetched") {
      assert.equal(
        runtime.packageInfo.packageSet.members[0].sha256,
        rootEntry.sha256,
      );
    }
  } finally {
    runtime.dispose();
  }
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
