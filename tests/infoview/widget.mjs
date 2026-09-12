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
  "export { createRoot } from 'react-dom/client';\n",
);
const widgetSource = await readFile(
  new URL("build/generated/infoview/vir-infoview-widget.js", repoRoot),
  "utf8",
);
const smokeWidgetSource =
  widgetSource
    .replace('from "@leanprover/infoview"', 'from "./infoview-api-stub.mjs"')
    .replace('from "react-dom"', 'from "./infoview-react-dom-stub.mjs"') +
  "\nexport { disposeRuntimeService as disposeRuntimeServiceForTests };\n";
await writeFile(
  new URL("vir-infoview-widget-smoke.mjs", buildDir),
  smokeWidgetSource,
);
const {
  default: infoviewWidgetComponent,
  decodeBase64Bytes,
  disposeRuntimeServiceForTests,
  loadAssetBytes,
  loadRuntimeOptions,
  loadRuntimeService,
  loadWasmModule,
  shouldReloadIRPackage,
  statIRPackage,
  statAsset,
  validateWidgetComponentEntry,
} = await import(new URL("vir-infoview-widget-smoke.mjs", buildDir));

const wasmBytes = await readFile(
  new URL("web/public/vir-upstream.wasm", repoRoot),
);
const packageBytes = await readFile(
  new URL("web/public/demo-host.irpkg", repoRoot),
);
const runtime = await createVirRuntime({
  wasmBytes,
  irPackageSet: [packageBytes],
});
let assetReadCount = 0;
let assetStatCount = 0;
let irPackageBuildCount = 0;
let irPackageStatCount = 0;
let irPackageRevision = "ir-package-v1";
const assetRevisions = new Map([
  ["web/public/vir-upstream.wasm", "wasm-v1"],
  ["web/public/demo-host.irpkg", "package-v1"],
]);
const rpcSession = {
  async call(method, params) {
    if (method === "Lean.Vir.Infoview.statIRPackage") {
      irPackageStatCount += 1;
      return {
        source: "examples/VirNativeInfoview.lean",
        roots: params.package.roots,
        revision: irPackageRevision,
      };
    }
    if (method === "Lean.Vir.Infoview.buildIRPackage") {
      irPackageBuildCount += 1;
      return {
        source: "examples/VirNativeInfoview.lean",
        roots: params.package.roots,
        byteSize: String(packageBytes.length),
        revision: irPackageRevision,
        dataBase64: packageBytes.toString("base64"),
        report: "IR package report",
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
assert.equal(
  (
    await statIRPackage(
      rpcSession,
      {
        roots: [
          "VirNativeInfoview.createComponent",
        ],
      },
      { line: 0, character: 0 },
    )
  ).revision,
  "ir-package-v1",
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
const runtimeOptions = await loadRuntimeOptions({
  rpcSession,
  wasmPath: "web/public/vir-upstream.wasm",
  irPackage: {
    roots: [
      "VirNativeInfoview.createComponent",
    ],
  },
  position: { line: 0, character: 0 },
});
assert.ok(runtimeOptions.wasmModule instanceof WebAssembly.Module);
assert.equal(runtimeOptions.irPackageSet.length, 1);
assert.equal(runtimeOptions.irPackageSet[0].length, packageBytes.length);
assert.equal(
  await loadWasmModule(rpcSession, {
    kind: "path",
    value: "web/public/vir-upstream.wasm",
    revision: assetRevisions.get("web/public/vir-upstream.wasm"),
  }),
  runtimeOptions.wasmModule,
);
const reloadIRPackage = {
  roots: [
    "VirNativeInfoview.createComponent",
  ],
};
const reloadPosition = { line: 0, character: 0 };
const reloadStatCount = irPackageStatCount;
const reloadBuildCount = irPackageBuildCount;
assert.equal(
  await shouldReloadIRPackage({
    rpcSession,
    irPackage: reloadIRPackage,
    position: reloadPosition,
    currentRevision: "ir-package-v1",
  }),
  false,
);
assert.equal(irPackageBuildCount, reloadBuildCount);
assert.ok(irPackageStatCount > reloadStatCount);
irPackageRevision = "ir-package-v2";
const changedReloadStatCount = irPackageStatCount;
assert.equal(
  await shouldReloadIRPackage({
    rpcSession,
    irPackage: reloadIRPackage,
    position: reloadPosition,
    currentRevision: "ir-package-v1",
  }),
  true,
);
assert.equal(irPackageBuildCount, reloadBuildCount);
assert.ok(irPackageStatCount > changedReloadStatCount);
irPackageRevision = "ir-package-v1";
const irPackageServiceConfig = {
  wasmPath: "web/public/vir-upstream.wasm",
  irPackage: {
    roots: [
      "VirNativeInfoview.createComponent",
    ],
  },
  componentEntry: "VirNativeInfoview.createComponent",
  position: { line: 0, character: 0 },
  setupHint: "",
};
const irPackageHostContext = {
  rpcSession,
  editorConnection: null,
  position: { line: 0, character: 0 },
};
const irPackageFirstService = await loadRuntimeService({
  rpcSession,
  hostContext: irPackageHostContext,
  config: irPackageServiceConfig,
});
assert.equal(
  typeof irPackageFirstService.runtime.hostState.defaultBindings[
    "react.root.create"
  ],
  "function",
);
assert.equal(
  typeof irPackageFirstService.runtime.hostState.defaultBindings[
    "react.node.text"
  ],
  "function",
);
assert.equal(
  typeof irPackageFirstService.runtime.hostState.defaultBindings[
    "react.node.createElement"
  ],
  "function",
);
const firstIRPackageBuildCount = irPackageBuildCount;
const firstIRPackageStatCount = irPackageStatCount;
const irPackageSecondService = await loadRuntimeService({
  rpcSession,
  config: irPackageServiceConfig,
});
assert.notEqual(
  irPackageSecondService,
  irPackageFirstService,
  "stateful runtime services must remain local to one widget consumer",
);
assert.ok(irPackageBuildCount > firstIRPackageBuildCount);
assert.ok(irPackageStatCount > firstIRPackageStatCount);
irPackageRevision = "ir-package-v2";
const irPackageThirdService = await loadRuntimeService({
  rpcSession,
  config: irPackageServiceConfig,
});
assert.notEqual(irPackageThirdService, irPackageFirstService);
assert.ok(irPackageBuildCount > firstIRPackageBuildCount);
disposeRuntimeServiceForTests(irPackageFirstService);
disposeRuntimeServiceForTests(irPackageSecondService);
disposeRuntimeServiceForTests(irPackageThirdService);
disposeRuntimeServiceForTests(irPackageThirdService);
assert.equal(
  irPackageThirdService.disposed,
  true,
  "runtime service disposal must be idempotent",
);

runtime.dispose();
console.log("vir infoview widget smoke ok");
