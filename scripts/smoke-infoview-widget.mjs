/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import { WIRE } from "../web/src/runtime/wire-tags.js";
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
  clearRuntimeServiceCacheForTests,
  createProofWidgetsExprWithCtxAtPos,
  createProofWidgetsExprWithCtxRef,
  loadAssetBytes,
  loadRuntimeOptions,
  loadRuntimeService,
  loadWasmModule,
  proofWidgetsExprFromSavedRef,
  resolveProofWidgetsRpcRef,
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
const resolvedRpcRefRequests = [];
const createdExprWithCtxRefRequests = [];
const createdExprWithCtxAtPosRequests = [];
const resolvedExprWithCtxRefRequests = [];
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
    if (method === "Lean.Vir.Infoview.resolveProofWidgetsRpcRef") {
      resolvedRpcRefRequests.push(params);
      return {
        ...params.ref,
        source: "examples/ReactProofWidget.lean",
        position: `ReactProofWidget.lean:${params.pos.line + 1}:${params.pos.character + 1}`,
        packageRevision: params.packageRevision,
        storeKey: `${params.packageRevision}:${params.ref.id}`,
        knownConstant: params.ref.id === "ReactProofWidget.mount",
      };
    }
    if (method === "Lean.Vir.Infoview.createProofWidgetsExprWithCtxRef") {
      createdExprWithCtxRefRequests.push(params);
      return {
        ref: { __rpcref: 17 },
        info: {
          ...params.ref,
          source: "examples/ReactProofWidget.lean",
          position: `ReactProofWidget.lean:${params.pos.line + 1}:${params.pos.character + 1}`,
          packageRevision: params.packageRevision,
          storeKey: `${params.packageRevision}:${params.ref.id}`,
          knownConstant: params.ref.id === "ReactProofWidget.mount",
        },
      };
    }
    if (method === "Lean.Vir.Infoview.createProofWidgetsExprWithCtxAtPos") {
      createdExprWithCtxAtPosRequests.push(params);
      if (params.pos.line === 99) {
        return null;
      }
      return {
        ref: { __rpcref: 19 },
        info: {
          id: "m.1",
          label: "case main",
          typeName: "ExprWithCtx",
          summary: `goal 1 target at ReactProofWidget.lean:${params.pos.line + 1}:${params.pos.character + 1}`,
          expression: "xs.reverse.reverse = xs",
          typeText: "Prop",
          context: "xs : List Nat",
          source: "examples/ReactProofWidget.lean",
          position: `ReactProofWidget.lean:${params.pos.line + 1}:${params.pos.character + 1}`,
          packageRevision: params.packageRevision,
          storeKey: `${params.packageRevision}:m.1`,
          knownConstant: false,
        },
      };
    }
    if (method === "Lean.Vir.Infoview.resolveProofWidgetsExprWithCtxRef") {
      resolvedExprWithCtxRefRequests.push(params);
      return {
        id: "ReactProofWidget.mount",
        label: "mount",
        typeName: "Const",
        summary: "server-owned resolve smoke",
        expression: "ReactProofWidget.mount",
        typeText: "String -> Surface -> DomM Bool",
        context: "",
        source: "examples/ReactProofWidget.lean",
        position: `ReactProofWidget.lean:${params.pos.line + 1}:${params.pos.character + 1}`,
        packageRevision: "server-package-v1",
        storeKey: "server-package-v1:ReactProofWidget.mount",
        knownConstant: true,
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
  () => validateWidgetEntry({
    interfaceManifest: {
      exports: [{
        entry: "WrongSurface.mount",
        effect: "dom",
        args: [
          { type: { wireTag: WIRE.STRING } },
          { type: { wireTag: WIRE.STRUCTURE, name: "Wrong.Surface" } },
        ],
        result: { wireTag: WIRE.BOOL },
      }],
    },
  }, "WrongSurface.mount"),
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
  proofWidgetsExpr: null,
});
assert.equal(surfaceFromInfoviewProps(infoviewPropsFixture).goals[0].target, "xs.reverse.reverse = xs");
assert.equal(
  surfaceCacheKey(surfaceFromInfoviewProps(infoviewPropsFixture)),
  surfaceCacheKey(surfaceFromInfoviewProps(structuredClone(infoviewPropsFixture))),
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
assert.deepEqual(
  await createProofWidgetsExprWithCtxRef(
    rpcSession,
    {
      id: "ReactProofWidget.mount",
      label: "mount",
      typeName: "Const",
      summary: "create server ref smoke",
      expression: "ReactProofWidget.mount",
      typeText: "String -> Surface -> DomM Bool",
      context: "",
    },
    { line: 2, character: 4 },
    "server-package-v1",
  ),
  {
    ref: { __rpcref: 17 },
    info: {
      id: "ReactProofWidget.mount",
      label: "mount",
      typeName: "Const",
      summary: "create server ref smoke",
      expression: "ReactProofWidget.mount",
      typeText: "String -> Surface -> DomM Bool",
      context: "",
      source: "examples/ReactProofWidget.lean",
      position: "ReactProofWidget.lean:3:5",
      packageRevision: "server-package-v1",
      storeKey: "server-package-v1:ReactProofWidget.mount",
      knownConstant: true,
    },
  },
);
assert.deepEqual(createdExprWithCtxRefRequests.at(-1), {
  ref: {
    id: "ReactProofWidget.mount",
    label: "mount",
    typeName: "Const",
    summary: "create server ref smoke",
    expression: "ReactProofWidget.mount",
    typeText: "String -> Surface -> DomM Bool",
    context: "",
  },
  pos: { line: 2, character: 4 },
  packageRevision: "server-package-v1",
});
assert.deepEqual(
  await createProofWidgetsExprWithCtxAtPos(
    rpcSession,
    { line: 6, character: 2 },
    "server-package-v2",
  ),
  {
    ref: { __rpcref: 19 },
    info: {
      id: "m.1",
      label: "case main",
      typeName: "ExprWithCtx",
      summary: "goal 1 target at ReactProofWidget.lean:7:3",
      expression: "xs.reverse.reverse = xs",
      typeText: "Prop",
      context: "xs : List Nat",
      source: "examples/ReactProofWidget.lean",
      position: "ReactProofWidget.lean:7:3",
      packageRevision: "server-package-v2",
      storeKey: "server-package-v2:m.1",
      knownConstant: false,
    },
  },
);
assert.deepEqual(createdExprWithCtxAtPosRequests.at(-1), {
  pos: { line: 6, character: 2 },
  packageRevision: "server-package-v2",
});
assert.equal(
  await createProofWidgetsExprWithCtxAtPos(
    rpcSession,
    { line: 99, character: 0 },
    "server-package-v2",
  ),
  null,
);
assert.deepEqual(
  await resolveProofWidgetsRpcRef(
    rpcSession,
    {
      id: "ReactProofWidget.mount",
      label: "mount",
      typeName: "Const",
      summary: "server-owned resolve smoke",
      expression: "",
      typeText: "",
      context: "",
      serverRef: { __rpcref: 17 },
    },
    { line: 7, character: 1 },
    "ignored-client-revision",
  ),
  {
    id: "ReactProofWidget.mount",
    label: "mount",
    typeName: "Const",
    summary: "server-owned resolve smoke",
    expression: "ReactProofWidget.mount",
    typeText: "String -> Surface -> DomM Bool",
    context: "",
    source: "examples/ReactProofWidget.lean",
    position: "ReactProofWidget.lean:8:2",
    packageRevision: "server-package-v1",
    storeKey: "server-package-v1:ReactProofWidget.mount",
    knownConstant: true,
  },
);
assert.deepEqual(resolvedExprWithCtxRefRequests.at(-1), {
  ref: { __rpcref: 17 },
  pos: { line: 7, character: 1 },
  packageRevision: "ignored-client-revision",
});
assert.deepEqual(
  await resolveProofWidgetsRpcRef(
    rpcSession,
    {
      id: "ReactProofWidget.mount",
      label: "mount",
      typeName: "Const",
      summary: "resolve smoke",
      expression: "ReactProofWidget.mount",
      typeText: "String -> Surface -> DomM Bool",
      context: "",
    },
    { line: 4, character: 2 },
    "package-smoke",
  ),
  {
    id: "ReactProofWidget.mount",
    label: "mount",
    typeName: "Const",
    summary: "resolve smoke",
    expression: "ReactProofWidget.mount",
    typeText: "String -> Surface -> DomM Bool",
    context: "",
    source: "examples/ReactProofWidget.lean",
    position: "ReactProofWidget.lean:5:3",
    packageRevision: "package-smoke",
    storeKey: "package-smoke:ReactProofWidget.mount",
    knownConstant: true,
  },
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
  wasmPath: "web/public/vir-upstream.wasm",
  irPackage: { roots: ["ReactProofWidget.mount", "ReactProofWidget.unmount"] },
  position: { line: 0, character: 0 },
});
assert.ok(runtimeOptions.wasmModule instanceof WebAssembly.Module);
assert.equal(runtimeOptions.irPackageBytes.length, packageBytes.length);
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
const irPackageServiceConfig = {
  wasmPath: "web/public/vir-upstream.wasm",
  irPackage: { roots: ["ReactProofWidget.mount", "ReactProofWidget.unmount"] },
  entry: "ReactProofWidget.mount",
  unmountEntry: "ReactProofWidget.unmount",
  position: { line: 0, character: 0 },
  setupHint: "",
};
const irPackageFirstService = await loadRuntimeService({ rpcSession, config: irPackageServiceConfig });
assert.equal(typeof irPackageFirstService.resources.resourceForValue, "function");
assert.equal(typeof irPackageFirstService.runtime.hostState.defaultBindings["react.root.create"], "function");
assert.equal(typeof irPackageFirstService.runtime.hostState.defaultBindings["react.node.text"], "function");
assert.equal(typeof irPackageFirstService.runtime.hostState.defaultBindings["react.node.createElement"], "function");
assert.equal(typeof irPackageFirstService.runtime.hostState.defaultBindings["react.root.renderIntoSelector"], "function");
assert.equal(typeof irPackageFirstService.runtime.hostState.defaultBindings["react.root.unmountSelector"], "function");
const serverOwnedExpr = proofWidgetsExprFromSavedRef({
  ref: { __rpcref: 18 },
  info: {
    id: "ReactProofWidget.mount",
    label: "mount",
    typeName: "ExprWithCtx",
    summary: "server-owned prop smoke",
    expression: "ReactProofWidget.mount",
    typeText: "String -> Surface -> DomM Bool",
    context: "",
  },
}, irPackageFirstService.resources);
assert.deepEqual(surfaceFromInfoviewProps(infoviewPropsFixture, serverOwnedExpr).proofWidgetsExpr.value, {
  code: "ReactProofWidget.mount",
  typeText: "String -> Surface -> DomM Bool",
  context: "",
});
const resolvedBeforeHostInspect = resolvedRpcRefRequests.length;
assert.equal(
  irPackageFirstService.runtime.hostState.defaultBindings["proofwidgets.rpc.inspectRef"]({
    id: "ReactProofWidget.mount",
    label: "mount",
    typeName: "Const",
    summary: "host binding smoke",
    expression: "ReactProofWidget.mount",
    typeText: "String -> Surface -> DomM Bool",
    context: "",
  }),
  true,
);
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(resolvedRpcRefRequests.length, resolvedBeforeHostInspect + 1);
assert.deepEqual(resolvedRpcRefRequests.at(-1), {
  ref: {
    id: "ReactProofWidget.mount",
    label: "mount",
    typeName: "Const",
    summary: "host binding smoke",
    expression: "ReactProofWidget.mount",
    typeText: "String -> Surface -> DomM Bool",
    context: "",
  },
  pos: { line: 0, character: 0 },
  packageRevision: "ir-package-v1",
});
let resolvedCallbackInfo = null;
let resolvedCallbackReleased = false;
const resolvedCallback = Object.assign((info) => {
  resolvedCallbackInfo = info;
}, {
  release() {
    resolvedCallbackReleased = true;
  },
});
const resolvedBeforeHostResolve = resolvedRpcRefRequests.length;
assert.equal(
  irPackageFirstService.runtime.hostState.defaultBindings["proofwidgets.rpc.resolveRef"]({
    id: "ReactProofWidget.mount",
    label: "mount",
    typeName: "Const",
    summary: "host resolve smoke",
    expression: "ReactProofWidget.mount",
    typeText: "String -> Surface -> DomM Bool",
    context: "",
  }, resolvedCallback),
  true,
);
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(resolvedRpcRefRequests.length, resolvedBeforeHostResolve + 1);
assert.deepEqual(resolvedRpcRefRequests.at(-1), {
  ref: {
    id: "ReactProofWidget.mount",
    label: "mount",
    typeName: "Const",
    summary: "host resolve smoke",
    expression: "ReactProofWidget.mount",
    typeText: "String -> Surface -> DomM Bool",
    context: "",
  },
  pos: { line: 0, character: 0 },
  packageRevision: "ir-package-v1",
});
assert.deepEqual(resolvedCallbackInfo, {
  id: "ReactProofWidget.mount",
  label: "mount",
  typeName: "Const",
  summary: "host resolve smoke",
  expression: "ReactProofWidget.mount",
  typeText: "String -> Surface -> DomM Bool",
  context: "",
  source: "examples/ReactProofWidget.lean",
  position: "ReactProofWidget.lean:1:1",
  packageRevision: "ir-package-v1",
  storeKey: "ir-package-v1:ReactProofWidget.mount",
  knownConstant: true,
});
assert.equal(resolvedCallbackReleased, true);
let serverOwnedCallbackInfo = null;
let serverOwnedCallbackReleased = false;
const serverOwnedCallback = Object.assign((info) => {
  serverOwnedCallbackInfo = info;
}, {
  release() {
    serverOwnedCallbackReleased = true;
  },
});
const serverOwnedBeforeHostResolve = resolvedExprWithCtxRefRequests.length;
assert.equal(
  irPackageFirstService.runtime.hostState.defaultBindings["proofwidgets.rpc.resolveRef"](
    serverOwnedExpr.ref,
    serverOwnedCallback,
  ),
  true,
);
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(resolvedExprWithCtxRefRequests.length, serverOwnedBeforeHostResolve + 1);
assert.deepEqual(resolvedExprWithCtxRefRequests.at(-1), {
  ref: { __rpcref: 18 },
  pos: { line: 0, character: 0 },
  packageRevision: "ir-package-v1",
});
assert.deepEqual(serverOwnedCallbackInfo, {
  id: "ReactProofWidget.mount",
  label: "mount",
  typeName: "Const",
  summary: "server-owned resolve smoke",
  expression: "ReactProofWidget.mount",
  typeText: "String -> Surface -> DomM Bool",
  context: "",
  source: "examples/ReactProofWidget.lean",
  position: "ReactProofWidget.lean:1:1",
  packageRevision: "server-package-v1",
  storeKey: "server-package-v1:ReactProofWidget.mount",
  knownConstant: true,
});
assert.equal(serverOwnedCallbackReleased, true);
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
