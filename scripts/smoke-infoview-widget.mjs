/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import { createVirRuntime } from "../web/src/vir-runtime-node.js";

const buildDir = new URL("../build/infoview-smoke/", import.meta.url);
await mkdir(buildDir, { recursive: true });
await writeFile(
  new URL("infoview-api-stub.mjs", buildDir),
  [
    "import * as React from 'react';",
    "",
    "export const EditorContext = React.createContext(null);",
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
const widgetSource = await readFile(new URL("../web/src/generated/vir-infoview-widget.js", import.meta.url), "utf8");
const smokeWidgetSource = widgetSource
  .replace('from "@leanprover/infoview"', 'from "./infoview-api-stub.mjs"')
  .replace('from "react-dom"', 'from "./infoview-react-dom-stub.mjs"');
await writeFile(new URL("vir-infoview-widget-smoke.mjs", buildDir), smokeWidgetSource);
const {
  default: infoviewWidgetComponent,
  decodeBase64Bytes,
  exactlyOneAssetSource,
  exactlyOnePackageSource,
  clearRuntimeServiceCacheForTests,
  loadAssetBytes,
  loadRuntimeOptions,
  loadRuntimeService,
  loadWasmModule,
  shouldReloadIRPackage,
  statIRPackage,
  statAsset,
  surfaceCacheKey,
  surfaceFromInfoviewProps,
  taggedTextToPlain,
  validateWidgetEntry,
  validateWidgetUnmountEntry,
} = await import(new URL("vir-infoview-widget-smoke.mjs", buildDir));

const wasmBytes = await readFile(new URL("../web/public/vir-upstream.wasm", import.meta.url));
const packageBytes = await readFile(new URL("../web/public/demo-host.irpkg", import.meta.url));
const runtime = await createVirRuntime({ wasmBytes, irPackageBytes: packageBytes });
const repoRoot = new URL("../", import.meta.url);
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
        source: "examples/ReactProofWidget.lean",
        roots: params.package.roots,
        revision: irPackageRevision,
      };
    }
    if (method === "Lean.Vir.Infoview.buildIRPackage") {
      irPackageBuildCount += 1;
      return {
        source: "examples/ReactProofWidget.lean",
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
      mime: params.path.endsWith(".wasm") ? "application/wasm" : "application/octet-stream",
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
assert.equal(validateWidgetEntry(runtime, "ReactProofWidget.mount").entry, "ReactProofWidget.mount");
assert.equal(validateWidgetUnmountEntry(runtime, "ReactProofWidget.unmount").entry, "ReactProofWidget.unmount");
assert.equal(validateWidgetUnmountEntry(runtime, ""), null);
assert.throws(
  () => validateWidgetEntry(runtime, "ReactCounter.mount"),
  /String -> Surface -> DomM Bool/,
);
assert.throws(
  () => validateWidgetUnmountEntry(runtime, "ReactProofWidget.mount"),
  /String -> DomM Bool/,
);
assert.equal(
  taggedTextToPlain({ append: [{ text: "List " }, { tag: [{}, { text: "Nat" }] }] }),
  "List Nat",
);
const infoviewPropsFixture = {
  pos: { uri: "file:///workspace/Example.lean", line: 6, character: 2 },
  goals: [
    {
      userName: "main",
      mvarId: { name: "m.1" },
      type: { text: "xs.reverse.reverse = xs" },
      hyps: [
        {
          names: ["xs"],
          type: { text: "List Nat" },
          val: null,
        },
      ],
    },
  ],
  selectedLocations: [{ kind: "hypothesis" }],
};
assert.deepEqual(surfaceFromInfoviewProps(infoviewPropsFixture), {
  position: "Example.lean:7:3",
  cursor: {
    uri: "file:///workspace/Example.lean",
    fileName: "Example.lean",
    line: 6,
    character: 2,
    label: "Example.lean:7:3",
  },
  goals: [
    {
      id: "m-1",
      kind: "goal",
      index: 0,
      title: "case main",
      userName: "main",
      mvarId: "m.1",
      status: "active",
      target: "xs.reverse.reverse = xs",
      hypotheses: [
        {
          id: "m-1-xs",
          names: ["xs"],
          fvarIds: [],
          type: "List Nat",
          value: null,
        },
      ],
    },
  ],
  selectedLocations: ["hypothesis"],
  selections: [
    {
      id: "hypothesis-hypothesis-0",
      kind: "hypothesis",
      label: "hypothesis",
    },
  ],
});
assert.equal(
  surfaceCacheKey(surfaceFromInfoviewProps(infoviewPropsFixture)),
  surfaceCacheKey(surfaceFromInfoviewProps(structuredClone(infoviewPropsFixture))),
);
assert.deepEqual(exactlyOneAssetSource("wasm", "vir-upstream.wasm", ""), {
  kind: "url",
  value: "vir-upstream.wasm",
});
assert.deepEqual(exactlyOneAssetSource("wasm", "", "web/public/vir-upstream.wasm"), {
  kind: "path",
  value: "web/public/vir-upstream.wasm",
});
assert.throws(
  () => exactlyOneAssetSource("wasm", "vir-upstream.wasm", "web/public/vir-upstream.wasm"),
  /exactly one/,
);
assert.deepEqual(exactlyOnePackageSource({
  packageUrl: "",
  packagePath: "",
  irPackage: { roots: ["ReactProofWidget.mount", "ReactProofWidget.unmount"] },
  entry: "ReactProofWidget.mount",
  unmountEntry: "ReactProofWidget.unmount",
  position: { line: 0, character: 0 },
}), {
  kind: "irPackage",
  package: { roots: ["ReactProofWidget.mount", "ReactProofWidget.unmount"] },
  roots: ["ReactProofWidget.mount", "ReactProofWidget.unmount"],
  position: { line: 0, character: 0 },
});
assert.throws(
  () => exactlyOnePackageSource({
    packageUrl: "demo-host.irpkg",
    packagePath: "",
    irPackage: { roots: ["ReactProofWidget.mount"] },
    entry: "ReactProofWidget.mount",
    unmountEntry: "",
    position: { line: 0, character: 0 },
  }),
  /exactly one/,
);
assert.equal(decodeBase64Bytes(Buffer.from("vir").toString("base64"))[2], "r".charCodeAt(0));
assert.equal((await statAsset(rpcSession, "web/public/vir-upstream.wasm")).revision, "wasm-v1");
assert.equal(
  (await statIRPackage(
    rpcSession,
    { roots: ["ReactProofWidget.mount", "ReactProofWidget.unmount"] },
    { line: 0, character: 0 },
  )).revision,
  "ir-package-v1",
);
await assert.rejects(
  () => loadAssetBytes({
    async call() {
      return {
        path: "web/public/other.wasm",
        mime: "application/wasm",
        dataBase64: Buffer.from("vir").toString("base64"),
      };
    },
  }, "web/public/vir-upstream.wasm"),
  /path mismatch/,
);
const runtimeOptions = await loadRuntimeOptions({
  rpcSession,
  wasmUrl: "",
  packageUrl: "",
  wasmPath: "web/public/vir-upstream.wasm",
  packagePath: "web/public/demo-host.irpkg",
});
assert.ok(runtimeOptions.wasmModule instanceof WebAssembly.Module);
assert.equal(runtimeOptions.irPackageBytes.length, packageBytes.length);
const irPackageRuntimeOptions = await loadRuntimeOptions({
  rpcSession,
  wasmUrl: "",
  packageUrl: "",
  wasmPath: "web/public/vir-upstream.wasm",
  packagePath: "",
  irPackage: { roots: ["ReactProofWidget.mount", "ReactProofWidget.unmount"] },
  entry: "ReactProofWidget.mount",
  unmountEntry: "ReactProofWidget.unmount",
  position: { line: 0, character: 0 },
});
assert.ok(irPackageRuntimeOptions.wasmModule instanceof WebAssembly.Module);
assert.equal(irPackageRuntimeOptions.irPackageBytes.length, packageBytes.length);
assert.equal(
  await loadWasmModule(rpcSession, {
    kind: "path",
    value: "web/public/vir-upstream.wasm",
    revision: assetRevisions.get("web/public/vir-upstream.wasm"),
  }),
  runtimeOptions.wasmModule,
);
const reloadIRPackage = { roots: ["ReactProofWidget.mount", "ReactProofWidget.unmount"] };
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
const serviceConfig = {
  runtimeUrl: "",
  wasmUrl: "",
  packageUrl: "",
  wasmPath: "web/public/vir-upstream.wasm",
  packagePath: "web/public/demo-host.irpkg",
  entry: "ReactProofWidget.mount",
  unmountEntry: "ReactProofWidget.unmount",
  setupHint: "",
};
const firstService = await loadRuntimeService({ rpcSession, config: serviceConfig });
assert.equal(typeof firstService.runtime.hostState.defaultBindings["react.root.create"], "function");
assert.equal(typeof firstService.runtime.hostState.defaultBindings["react.node.text"], "function");
assert.equal(typeof firstService.runtime.hostState.defaultBindings["react.node.createElement"], "function");
assert.equal(typeof firstService.runtime.hostState.defaultBindings["react.root.renderIntoSelector"], "function");
assert.equal(typeof firstService.runtime.hostState.defaultBindings["react.root.unmountSelector"], "function");
const firstServiceAssetReadCount = assetReadCount;
const firstServiceAssetStatCount = assetStatCount;
const secondService = await loadRuntimeService({ rpcSession, config: serviceConfig });
assert.equal(secondService, firstService);
assert.equal(assetReadCount, firstServiceAssetReadCount);
assert.ok(assetStatCount > firstServiceAssetStatCount);
assert.equal(firstService.runtime.call("ReactProofWidget.unmount", "#missing-proof-widget"), false);
assetRevisions.set("web/public/demo-host.irpkg", "package-v2");
const thirdService = await loadRuntimeService({ rpcSession, config: serviceConfig });
assert.notEqual(thirdService, firstService);
assert.ok(assetReadCount > firstServiceAssetReadCount);
await clearRuntimeServiceCacheForTests();

const irPackageServiceConfig = {
  runtimeUrl: "",
  wasmUrl: "",
  packageUrl: "",
  wasmPath: "web/public/vir-upstream.wasm",
  packagePath: "",
  irPackage: { roots: ["ReactProofWidget.mount", "ReactProofWidget.unmount"] },
  entry: "ReactProofWidget.mount",
  unmountEntry: "ReactProofWidget.unmount",
  position: { line: 0, character: 0 },
  setupHint: "",
};
const irPackageFirstService = await loadRuntimeService({ rpcSession, config: irPackageServiceConfig });
const firstIRPackageBuildCount = irPackageBuildCount;
const firstIRPackageStatCount = irPackageStatCount;
const irPackageSecondService = await loadRuntimeService({ rpcSession, config: irPackageServiceConfig });
assert.equal(irPackageSecondService, irPackageFirstService);
assert.equal(irPackageBuildCount, firstIRPackageBuildCount);
assert.ok(irPackageStatCount > firstIRPackageStatCount);
const afterSecondIRPackageStatCount = irPackageStatCount;
const irPackageMovedPositionService = await loadRuntimeService({
  rpcSession,
  config: {
    ...irPackageServiceConfig,
    position: { line: 87, character: 3 },
  },
});
assert.equal(irPackageMovedPositionService, irPackageFirstService);
assert.equal(irPackageBuildCount, firstIRPackageBuildCount);
assert.ok(irPackageStatCount > afterSecondIRPackageStatCount);
irPackageRevision = "ir-package-v2";
const irPackageThirdService = await loadRuntimeService({ rpcSession, config: irPackageServiceConfig });
assert.notEqual(irPackageThirdService, irPackageFirstService);
assert.ok(irPackageBuildCount > firstIRPackageBuildCount);
await clearRuntimeServiceCacheForTests();

runtime.dispose();
console.log("vir infoview widget smoke ok");
