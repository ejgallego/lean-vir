/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import { repositoryRootUrl as repoRoot } from "../../scripts/repository-paths.mjs";
import { INTERFACE_TAG } from "../../web/src/runtime/interface-tags.js";
import { createVirRuntime } from "../../web/src/vir-runtime-node.js";

const buildDir = new URL("build/infoview-smoke/", repoRoot);
await mkdir(buildDir, { recursive: true });
await writeFile(
  new URL("infoview-api-stub.mjs", buildDir),
  [
    "import * as React from 'react';",
    "",
    "export const EditorContext = React.createContext(null);",
    "export const DocumentPosition = {};",
    "export function InteractiveCode() { throw new Error('unexpected smoke component render'); }",
    "export function TaggedText_stripTags() { throw new Error('unexpected smoke tagged text call'); }",
    "export function useClientNotificationEffect() { throw new Error('unexpected smoke notification hook'); }",
    "",
    "export function useRpcSession() {",
    "  return { call() { throw new Error('unexpected smoke RPC call through React hook'); } };",
    "}",
    "",
  ].join("\n"),
);
await writeFile(
  new URL("infoview-react-dom-stub.mjs", buildDir),
  "export { createRoot } from 'react-dom/client';\n" +
    "export function createPortal() { throw new Error('unexpected smoke portal render'); }\n",
);
const widgetSource = await readFile(
  new URL("build/generated/infoview/vir-infoview-widget.js", repoRoot),
  "utf8",
);
const smokeWidgetSource =
  widgetSource
    .replace('from "@leanprover/infoview"', 'from "./infoview-api-stub.mjs"')
    .replaceAll('from "react-dom"', 'from "./infoview-react-dom-stub.mjs"');
await writeFile(
  new URL("vir-infoview-widget-smoke.mjs", buildDir),
  smokeWidgetSource,
);
const {
  default: infoviewWidgetComponent,
  decodeBase64Bytes,
  buildIRPackage,
  loadAssetBytes,
  loadRuntimeService,
  loadWasmModule,
  statAsset,
  validateWidgetComponentEntry,
} = await import(new URL("vir-infoview-widget-smoke.mjs", buildDir));

const wasmBytes = await readFile(
  new URL("web/public/vir-upstream.wasm", repoRoot),
);
const packageBytes = await readFile(
  new URL("web/public/native-infoview.irpkg", repoRoot),
);
const runtime = await createVirRuntime({
  wasmBytes,
  irPackageSet: [packageBytes],
});
let assetReadCount = 0;
let assetStatCount = 0;
let irPackageBuildCount = 0;
let irPackageFingerprint = "ir-package-v1";
const assetRevisions = new Map([
  ["web/public/vir-upstream.wasm", "wasm-v1"],
  ["web/public/native-infoview.irpkg", "package-v1"],
]);
const rpcSession = {
  async call(method, params) {
    if (method === "Lean.Vir.Infoview.buildIRPackage") {
      irPackageBuildCount += 1;
      return {
        entry: params.package.entry,
        fingerprint: irPackageFingerprint,
        dataBase64: packageBytes.toString("base64"),
      };
    }
    const bytes = await readFile(new URL(params.path, repoRoot));
    const metadata = {
      path: params.path,
      mime: params.path.endsWith(".wasm")
        ? "application/wasm"
        : "application/octet-stream",
      byteSize: String(bytes.length),
      modified: "100.0",
      revision: assetRevisions.get(params.path) ?? "asset-v1",
    };
    if (method === "Lean.Vir.Infoview.statAsset") {
      assetStatCount += 1;
      return metadata;
    }
    assert.equal(method, "Lean.Vir.Infoview.readAsset");
    assetReadCount += 1;
    return {
      ...metadata,
      dataBase64: bytes.toString("base64"),
    };
  },
};

assert.equal(typeof infoviewWidgetComponent, "function");
assert.equal(
  validateWidgetComponentEntry(runtime, "VirNativeInfoview.createComponent")
    .entry,
  "VirNativeInfoview.createComponent",
);
const factoryEntry = validateWidgetComponentEntry(runtime, "VirNativeInfoview.createComponent");
for (const incompatible of [
  { ...factoryEntry, args: [{ type: { interfaceTag: INTERFACE_TAG.RESOURCE } }] },
  { ...factoryEntry, result: { interfaceTag: INTERFACE_TAG.UNIT } },
]) {
  assert.throws(
    () => validateWidgetComponentEntry({ findManifestEntry: () => incompatible }, "invalid-factory"),
    /effectful \(\) -> Component/,
    "root-taking mounts and void entries must not be accepted as factories",
  );
}
assert.equal(
  decodeBase64Bytes(Buffer.from("vir").toString("base64"))[2],
  "r".charCodeAt(0),
);
assert.equal(
  (await statAsset(rpcSession, "web/public/vir-upstream.wasm")).revision,
  "wasm-v1",
);
await assert.rejects(
  () =>
    loadAssetBytes(
      {
        async call() {
          return {
            path: "web/public/other.wasm",
            mime: "application/wasm",
            dataBase64: Buffer.from("vir").toString("base64"),
          };
        },
      },
      "web/public/vir-upstream.wasm",
    ),
  /path mismatch/,
);
const irPackageServiceConfig = {
  wasmPath: "web/public/vir-upstream.wasm",
  irPackage: {
    entry: "VirNativeInfoview.createComponent",
    fingerprint: irPackageFingerprint,
  },
  position: { line: 0, character: 0 },
  setupHint: "",
};
const generatedPackage = {
  ...irPackageServiceConfig.irPackage,
  fingerprint: irPackageFingerprint,
};
assert.equal(
  (await buildIRPackage(rpcSession, generatedPackage, irPackageServiceConfig.position)).fingerprint,
  generatedPackage.fingerprint,
);
await assert.rejects(
  buildIRPackage(rpcSession, { ...generatedPackage, fingerprint: "another-generation" },
    irPackageServiceConfig.position),
  /fingerprint mismatch/,
  "generated packages must reject a response for a different generation",
);
await assert.rejects(
  buildIRPackage({
    async call(method, params) {
      return { ...await rpcSession.call(method, params), entry: "another.factory" };
    },
  }, generatedPackage, irPackageServiceConfig.position),
  /entry mismatch/,
  "matching fingerprints do not bypass response entry validation",
);
for (const fingerprint of [undefined, null, ""]) {
  const builds = irPackageBuildCount;
  await assert.rejects(
    buildIRPackage(rpcSession, { ...generatedPackage, fingerprint },
      irPackageServiceConfig.position),
    /fingerprint must be a non-empty string/,
  );
  assert.equal(irPackageBuildCount, builds, "missing identity never requests current-snapshot code");
}
const irPackageFirstService = await loadRuntimeService({
  rpcSession,
  config: irPackageServiceConfig,
});
assert.equal(
  typeof irPackageFirstService.runtime.hostState.defaultBindings[
    "react.root.create"
  ],
  "function",
);
assert.equal(
  Object.hasOwn(
    irPackageFirstService.runtime.hostState.defaultBindings,
    "react.node.text",
  ),
  false,
);
assert.equal(
  typeof irPackageFirstService.runtime.hostState.defaultBindings[
    "react.node.createElement"
  ],
  "function",
);
const firstIRPackageBuildCount = irPackageBuildCount;
const irPackageSecondService = await loadRuntimeService({
  rpcSession,
  config: irPackageServiceConfig,
});
assert.notEqual(
  irPackageSecondService.runtime,
  irPackageFirstService.runtime,
  "each widget consumer owns a distinct runtime",
);
assert.equal(
  irPackageSecondService.runtime.module,
  irPackageFirstService.runtime.module,
  "independent runtimes share the compiled module",
);
assert.notEqual(
  irPackageSecondService.runtime.hostState.defaultBindings,
  irPackageFirstService.runtime.hostState.defaultBindings,
  "independent runtimes own separate browser bindings",
);
assert.ok(irPackageBuildCount > firstIRPackageBuildCount);
const firstWasmModule = irPackageFirstService.runtime.module;
assert.ok(firstWasmModule instanceof WebAssembly.Module);
const readsBeforeCacheHit = assetReadCount;
assert.equal(await loadWasmModule(rpcSession, irPackageServiceConfig.wasmPath), firstWasmModule);
assert.equal(assetReadCount, readsBeforeCacheHit + 1, "acquisition identifies the bytes it reads");
assetRevisions.set(irPackageServiceConfig.wasmPath, "wasm-v2");
assert.equal(await loadWasmModule(rpcSession, irPackageServiceConfig.wasmPath), firstWasmModule,
  "equal bytes reuse compilation despite changed metadata");

function wasmReturning(value) {
  return Uint8Array.of(
    0,97,115,109,1,0,0,0, 1,5,1,96,0,1,127, 3,2,1,0,
    7,5,1,1,102,0,0, 10,6,1,4,0,65,value,11,
  );
}
function assetSource(bytes) {
  return { async call(method, { path }) {
    assert.equal(method, "Lean.Vir.Infoview.readAsset");
    return { path, mime: "application/wasm", byteSize: String(bytes.length),
      modified: "1", revision: "same-metadata", dataBase64: Buffer.from(bytes).toString("base64") };
  } };
}
const path = "same-project-relative-path.wasm";
const sourceA = assetSource(wasmReturning(1));
const sourceB = assetSource(wasmReturning(2));
const moduleA = await loadWasmModule(sourceA, path);
const moduleB = await loadWasmModule(sourceB, path);
assert.notEqual(moduleA, moduleB, "different projects cannot alias through path and metadata");
assert.equal(new WebAssembly.Instance(moduleB).exports.f(), 2);
assert.equal(await loadWasmModule(assetSource(wasmReturning(2)), "other-path.wasm"), moduleB,
  "equal bytes share compilation across sources and paths");

// Concurrent identical reads share compilation, and a failed compile is evicted.
const originalCompile = WebAssembly.compile;
let compilations = 0;
let failCompile = false;
WebAssembly.compile = (bytes) => {
  compilations++;
  if (failCompile) {
    failCompile = false;
    return Promise.reject(new Error("compile failure sentinel"));
  }
  return originalCompile(bytes);
};
try {
  const pair = await Promise.all([
    loadWasmModule(assetSource(wasmReturning(3)), path),
    loadWasmModule(assetSource(wasmReturning(3)), path),
  ]);
  assert.equal(pair[0], pair[1]);
  assert.equal(compilations, 1, "concurrent acquisitions compile identical bytes once");
  failCompile = true;
  await assert.rejects(loadWasmModule(assetSource(wasmReturning(4)), path), /compile failure sentinel/);
  const recovered = await loadWasmModule(assetSource(wasmReturning(4)), path);
  assert.equal(new WebAssembly.Instance(recovered).exports.f(), 4);
  assert.equal(compilations, 3, "failed compilation permits a later attempt");
} finally {
  WebAssembly.compile = originalCompile;
}

// A delayed read failure cannot evict another source's successful compilation.
const staleRead = Promise.withResolvers();
const staleFailure = assert.rejects(
  loadWasmModule({ call: () => staleRead.promise }, path), /superseded asset read/);
assert.equal(await loadWasmModule(sourceB, path), moduleB);
staleRead.reject(new Error("superseded asset read"));
await staleFailure;
assert.equal(await loadWasmModule(sourceB, path), moduleB);

const statsBeforeNoStat = assetStatCount;
const latestSnapshot = await loadRuntimeService({
  rpcSession: {
    async call(method, params) {
      assert.notEqual(method, "Lean.Vir.Infoview.statAsset",
        "Wasm identity uses read bytes, not a pre-read metadata token");
      const response = await rpcSession.call(method, params);
      return response;
    },
  },
  config: irPackageServiceConfig,
});
assert.equal(assetStatCount, statsBeforeNoStat);
latestSnapshot.runtime.dispose();

irPackageFingerprint = "ir-package-v2";
irPackageServiceConfig.irPackage.fingerprint = irPackageFingerprint;
const irPackageThirdService = await loadRuntimeService({
  rpcSession,
  config: irPackageServiceConfig,
});
assert.notEqual(irPackageThirdService.runtime, irPackageSecondService.runtime);
assert.ok(irPackageBuildCount > firstIRPackageBuildCount);
irPackageFirstService.runtime.dispose();
irPackageSecondService.runtime.dispose();
irPackageThirdService.runtime.dispose();
irPackageThirdService.runtime.dispose();
assert.equal(
  irPackageThirdService.runtime.disposed,
  true,
  "runtime disposal must be idempotent",
);

runtime.dispose();
console.log("vir infoview widget smoke ok");
