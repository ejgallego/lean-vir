/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { createVirRuntime as createExportedBrowserVirRuntime } from "lean-vir";
import {
  createCommonHostBindings as createExportedCommonHostBindings,
  createBrowserDocumentHostBindings as createExportedBrowserDocumentHostBindings,
  createBrowserElementHostBindings as createExportedBrowserElementHostBindings,
  createHostLifecycle as createExportedHostLifecycle,
} from "lean-vir/host-bindings";
import { createVirRuntime as createExportedNodeVirRuntime } from "lean-vir/vir-runtime-node";
import {
  createVirImports,
  createVirRuntime as createBrowserVirRuntime,
  createVirRuntimeFactory as createBrowserVirRuntimeFactory,
  debugWasmUrlFor,
  VIR_WASM_DEV_FILE,
  VIR_WASM_RELEASE_FILE,
} from "../../web/src/vir-runtime.js";
import {
  createVirRuntime,
  debugWasmUrlFor as debugNodeWasmUrlFor,
  VIR_WASM_DEV_FILE as NODE_VIR_WASM_DEV_FILE,
  VIR_WASM_RELEASE_FILE as NODE_VIR_WASM_RELEASE_FILE,
  createVirtualDocumentHostBindings,
  createVirtualDocumentState,
  createVirtualElementState,
  createVirtualEventState,
  ensureVirtualElementState,
  ensureVirtualElementStates,
} from "../../web/src/vir-runtime-node.js";
import {
  PACKAGE_FORMAT_VERSION,
  INTERFACE_MANIFEST_VERSION,
} from "../../scripts/packages/package-versions.mjs";
import {
  assert,
  assertInvalidManifest,
  assertManifestTypeDescriptorsRoundTrip,
  assertValidManifestShape,
  findTypeDescriptor,
  jsNatResourceValue,
  readRuntimeArtifacts,
} from "./shared.mjs";
import { demoHostImportTargets } from "../../scripts/native/demo-host-import-targets.mjs";
import { invalidManifestCases } from "./manifest-invalid-cases.mjs";

const {
  wasmBytes,
  defaultPackageBytes,
  hostPackageBytes,
  prettyPackageBytes,
  leanPackageBytes,
} = await readRuntimeArtifacts();
const hostlessImports = createVirImports(new WebAssembly.Module(wasmBytes));
assert.throws(
  () => hostlessImports.env.vir_js_call_objects(0, 0, 0),
  /without an attached host state/,
);

const runtime = await createVirRuntime({
  wasmBytes,
  irPackageSetBytes: [defaultPackageBytes],
});
const callbackRecords = [];
const virtualDocumentState = createVirtualDocumentState();
const hostRuntime = await createVirRuntime({
  wasmBytes,
  irPackageSetBytes: [hostPackageBytes],
  virtualDocumentState,
  hostBindings: {
    "test.callNatCallback": (input, callback) => callback(input),
    "test.recordNat": (value) => {
      callbackRecords.push(Number(jsNatResourceValue(value)));
      return undefined;
    },
  },
});
const prettyRuntime = await createVirRuntime({
  wasmBytes,
  irPackageSetBytes: [prettyPackageBytes],
});
const leanRuntime = await createVirRuntime({
  wasmBytes,
  irPackageSetBytes: [leanPackageBytes],
});
assert.equal(createExportedBrowserVirRuntime, createBrowserVirRuntime);
assert.equal(createExportedNodeVirRuntime, createVirRuntime);
assert.equal(typeof createExportedHostLifecycle, "function");
assert.equal(VIR_WASM_RELEASE_FILE, "vir-upstream.wasm");
assert.equal(VIR_WASM_DEV_FILE, "vir-upstream.dev.wasm");
assert.equal(NODE_VIR_WASM_RELEASE_FILE, VIR_WASM_RELEASE_FILE);
assert.equal(NODE_VIR_WASM_DEV_FILE, VIR_WASM_DEV_FILE);
assert.equal(debugNodeWasmUrlFor, debugWasmUrlFor);
assert.equal(debugWasmUrlFor("vir-upstream.wasm"), "vir-upstream.dev.wasm");
assert.equal(
  debugWasmUrlFor("./wasm/vir-upstream.wasm?rev=1#test"),
  "./wasm/vir-upstream.dev.wasm?rev=1#test",
);
assert.equal(createBrowserVirRuntimeFactory().wasmUrl, VIR_WASM_RELEASE_FILE);
assert.equal(
  createBrowserVirRuntimeFactory({ debugWasm: true }).wasmUrl,
  VIR_WASM_DEV_FILE,
);
assert.equal(
  createBrowserVirRuntimeFactory({
    wasmUrl: "./wasm/custom.wasm",
    debugWasm: true,
  }).wasmUrl,
  "./wasm/custom.dev.wasm",
);
assert.equal(
  createBrowserVirRuntimeFactory({
    wasmUrl: "./wasm/custom.wasm",
    wasmDebugUrl: "./wasm/custom-debug.wasm",
    debugWasm: true,
  }).wasmUrl,
  "./wasm/custom-debug.wasm",
);
assert.throws(
  () => debugWasmUrlFor("module.bin"),
  /debugWasm requires a \.wasm wasmUrl/,
);
{
  let fetchedWasmUrl = null;
  const debugFactory = createBrowserVirRuntimeFactory({
    debugWasm: true,
    fetchBytes: async (path) => {
      fetchedWasmUrl = path;
      return wasmBytes;
    },
  });
  assert.ok((await debugFactory.module()) instanceof WebAssembly.Module);
  assert.equal(fetchedWasmUrl, VIR_WASM_DEV_FILE);
}
{
  let fetchedWasmUrl = null;
  const debugFactory = createBrowserVirRuntimeFactory({
    wasmUrl: "./wasm/custom.wasm",
    wasmDebugUrl: "./wasm/custom-debug.wasm",
    debugWasm: true,
    fetchBytes: async (path) => {
      fetchedWasmUrl = path;
      return wasmBytes;
    },
  });
  assert.ok((await debugFactory.module()) instanceof WebAssembly.Module);
  assert.equal(fetchedWasmUrl, "./wasm/custom-debug.wasm");
}
{
  const previousDocument = Object.getOwnPropertyDescriptor(
    globalThis,
    "document",
  );
  const element = { textContent: "shared element" };
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    writable: true,
    value: {
      title: "",
      querySelector: (selector) => (selector === "#shared" ? element : null),
    },
  });
  try {
    const resources = createExportedHostLifecycle();
    const primitiveResource = false;
    assert.equal(primitiveResource, false);
    const commonBindings = createExportedCommonHostBindings(resources);
    const documentBindings =
      createExportedBrowserDocumentHostBindings(resources);
    const elementBindings = createExportedBrowserElementHostBindings(resources);
    const sharedElementNullable =
      documentBindings["browser.document.querySelector"]("#shared");
    assert.equal(
      commonBindings["js.nullable.isNull"](sharedElementNullable),
      false,
    );
    const sharedElement = commonBindings["js.nullable.value"](
      sharedElementNullable,
    );
    const sharedText =
      elementBindings["browser.element.getTextContent"](sharedElement);
    assert.equal(sharedText, "shared element");
    assert.equal(
      createExportedBrowserElementHostBindings()[
        "browser.element.getTextContent"
      ](sharedElement),
      "shared element",
    );
  } finally {
    if (previousDocument) {
      Object.defineProperty(globalThis, "document", previousDocument);
    } else {
      delete globalThis.document;
    }
  }
}
assert.equal(runtime.targetPointerBytes(), 4);
assert.ok(
  runtime.packageInfo.count > 0,
  "expected IR package to load declarations",
);
assert.equal(runtime.packageDeclCount(), runtime.packageInfo.count);
assert.equal(runtime.packageInfo.byteLength, defaultPackageBytes.byteLength);
assert.ok(
  runtime.packageInfo.interfaceExports > 0,
  "expected embedded interface exports",
);
assert.equal(runtime.packageInfo.hostImports, 0);
assert.equal(hostRuntime.packageInfo.hostImports, demoHostImportTargets.length);
assert.equal(runtime.packageInfo.metadata, runtime.packageMetadata);
assert.equal(
  runtime.packageMetadata.packageFormatVersion,
  PACKAGE_FORMAT_VERSION,
);
assert.equal(
  runtime.packageMetadata.manifestVersion,
  INTERFACE_MANIFEST_VERSION,
);
assert.match(runtime.packageMetadata.leanToolchain, /leanprover\/lean4/);
assert.ok(runtime.packageMetadata.generatedAt.length > 0);
assert.ok(
  runtime.packageMetadata.targets.some(
    (target) => target.source === "examples/Fib.lean",
  ),
);
assert.ok(
  runtime.interfaceManifest.exports.some((entry) => entry.entry === "fib"),
);
assertManifestTypeDescriptorsRoundTrip(runtime.interfaceManifest);
assertManifestTypeDescriptorsRoundTrip(hostRuntime.interfaceManifest);
assertManifestTypeDescriptorsRoundTrip(prettyRuntime.interfaceManifest);
assertManifestTypeDescriptorsRoundTrip(leanRuntime.interfaceManifest);
assertValidManifestShape();
for (const { name, mutate, pattern } of invalidManifestCases) {
  try {
    assertInvalidManifest(mutate, pattern);
  } catch (error) {
    if (error instanceof Error) {
      error.message = `${name}: ${error.message}`;
    }
    throw error;
  }
}
assert.deepEqual(
  hostRuntime.interfaceManifest.hostImports.map((entry) => entry.target).sort(),
  demoHostImportTargets,
);
const hostImportTarget = (target) =>
  hostRuntime.interfaceManifest.hostImports.find(
    (entry) => entry.target === target,
  );
const reactUseStateImports = hostRuntime.interfaceManifest.hostImports.filter(
  (entry) => entry.target === "react.useState",
);
assert.equal(reactUseStateImports.length, 1);
assert.equal(reactUseStateImports[0]?.effect, "react");
assert.equal(reactUseStateImports[0]?.boundary, "hostResource");
assert.equal(reactUseStateImports[0]?.args[0]?.type?.kind, "resource");
assert.equal(reactUseStateImports[0]?.args[0]?.type?.name, "Lean.Vir.Js");
assert.equal(reactUseStateImports[0]?.args[0]?.type?.type, "Js");
assert.equal(reactUseStateImports[0]?.result?.type, "Js");
const reactStateValueImport = hostRuntime.interfaceManifest.hostImports.find(
  (entry) => entry.target === "react.state.value",
);
assert.equal(reactStateValueImport?.args[0]?.type?.type, "Js");
assert.equal(reactStateValueImport?.result?.type, "Js");
const reactStateSetterImport = hostRuntime.interfaceManifest.hostImports.find(
  (entry) => entry.target === "react.state.setter",
);
assert.equal(reactStateSetterImport?.args[0]?.type?.type, "Js");
assert.equal(reactStateSetterImport?.result?.type, "Js");
const reactUseReducerImports = hostRuntime.interfaceManifest.hostImports.filter(
  (entry) => entry.target === "react.useReducer",
);
assert.equal(reactUseReducerImports.length, 1);
for (const entry of reactUseReducerImports) {
  assert.equal(entry.effect, "react");
  assert.equal(entry.args[0]?.type?.kind, "function");
  assert.equal(entry.args[0]?.type?.effect, "runtime");
  assert.equal(entry.args[0]?.type?.args[0]?.type?.type, "Js");
  assert.equal(entry.args[0]?.type?.args[1]?.type?.type, "Js");
  assert.equal(entry.args[0]?.type?.result?.type, "Js");
  assert.equal(entry.args[1]?.type?.type, "Js");
  assert.equal(entry.result?.type, "Js");
}
const reactReducerDispatchImports =
  hostRuntime.interfaceManifest.hostImports.filter(
    (entry) => entry.target === "react.reducer.dispatch",
  );
assert.equal(reactReducerDispatchImports.length, 1);
for (const entry of reactReducerDispatchImports) {
  assert.equal(entry.effect, "runtime");
  assert.equal(entry.args[0]?.type?.kind, "resource");
  assert.equal(entry.args[1]?.type?.type, "Js");
  assert.equal(entry.result?.type, "Unit");
}
const reactReducerStateValueImport =
  hostRuntime.interfaceManifest.hostImports.find(
    (entry) => entry.target === "react.reducerState.value",
  );
assert.equal(reactReducerStateValueImport?.effect, "runtime");
assert.equal(reactReducerStateValueImport?.args[0]?.type?.type, "Js");
assert.equal(reactReducerStateValueImport?.result?.type, "Js");
const reactReducerStateDispatchImport =
  hostRuntime.interfaceManifest.hostImports.find(
    (entry) => entry.target === "react.reducerState.dispatch",
  );
assert.equal(reactReducerStateDispatchImport?.effect, "runtime");
assert.equal(reactReducerStateDispatchImport?.args[0]?.type?.type, "Js");
assert.equal(reactReducerStateDispatchImport?.result?.type, "Js");
const reactUseRefImports = hostRuntime.interfaceManifest.hostImports.filter(
  (entry) => entry.target === "react.useRef",
);
assert.equal(reactUseRefImports.length, 1);
assert.equal(reactUseRefImports[0]?.effect, "react");
assert.equal(reactUseRefImports[0]?.args[0]?.type?.kind, "resource");
assert.equal(reactUseRefImports[0]?.result?.type, "Js");
assert.equal(reactUseRefImports[0]?.result?.name, "Lean.Vir.Js");
const reactUseEffectImports = hostRuntime.interfaceManifest.hostImports.filter(
  (entry) => entry.target === "react.useEffect",
);
assert.equal(reactUseEffectImports.length, 1);
assert.equal(reactUseEffectImports[0]?.effect, "react");
assert.equal(reactUseEffectImports[0]?.args[0]?.type?.kind, "function");
assert.equal(reactUseEffectImports[0]?.args[0]?.type?.effect, "dom");
assert.equal(reactUseEffectImports[0]?.args[1]?.type?.kind, "function");
assert.equal(reactUseEffectImports[0]?.args[1]?.type?.effect, "dom");
const reactUseEffectWithDepsImports =
  hostRuntime.interfaceManifest.hostImports.filter(
    (entry) => entry.target === "react.useEffectWithDeps",
  );
assert.equal(reactUseEffectWithDepsImports.length, 1);
assert.equal(reactUseEffectWithDepsImports[0]?.effect, "react");
assert.equal(reactUseEffectWithDepsImports[0]?.args[0]?.type?.type, "Js");
assert.equal(
  reactUseEffectWithDepsImports[0]?.args[0]?.type?.name,
  "Lean.Vir.Js",
);
assert.equal(reactUseEffectWithDepsImports[0]?.args[1]?.type?.kind, "function");
assert.equal(reactUseEffectWithDepsImports[0]?.args[1]?.type?.effect, "dom");
assert.equal(reactUseEffectWithDepsImports[0]?.args[2]?.type?.kind, "function");
assert.equal(reactUseEffectWithDepsImports[0]?.args[2]?.type?.effect, "dom");
const reactUseMemoImports = hostRuntime.interfaceManifest.hostImports.filter(
  (entry) => entry.target === "react.useMemo",
);
assert.equal(reactUseMemoImports.length, 1);
assert.equal(reactUseMemoImports[0]?.effect, "react");
assert.equal(reactUseMemoImports[0]?.args[0]?.type?.kind, "function");
assert.equal(reactUseMemoImports[0]?.args[0]?.type?.effect, "react");
assert.equal(reactUseMemoImports[0]?.args[0]?.type?.result?.type, "Js");
assert.equal(reactUseMemoImports[0]?.args[1]?.type?.type, "Js");
assert.equal(reactUseMemoImports[0]?.args[1]?.type?.name, "Lean.Vir.Js");
assert.equal(reactUseMemoImports[0]?.result?.type, "Js");
const reactRefGetImports = hostRuntime.interfaceManifest.hostImports.filter(
  (entry) => entry.target === "react.ref.get",
);
assert.equal(reactRefGetImports.length, 1);
assert.equal(reactRefGetImports[0]?.effect, "runtime");
assert.equal(reactRefGetImports[0]?.args[0]?.type?.kind, "resource");
assert.equal(reactRefGetImports[0]?.result?.type, "Js");
const reactRefSetImports = hostRuntime.interfaceManifest.hostImports.filter(
  (entry) => entry.target === "react.ref.set",
);
assert.equal(reactRefSetImports.length, 1);
assert.equal(reactRefSetImports[0]?.effect, "runtime");
assert.equal(reactRefSetImports[0]?.args[0]?.type?.kind, "resource");
assert.equal(reactRefSetImports[0]?.args[1]?.type?.type, "Js");
for (const target of [
  "js.string",
  "js.string.value",
  "js.nat",
  "js.nat.value",
  "js.bool",
  "js.bool.value",
  "js.float.value",
  "js.value.proofwidgets.resolvedRef.value",
  "js.value.react.eventHandler",
  "js.value.react.property",
]) {
  const entry = hostImportTarget(target);
  assert.equal(entry?.effect, "runtime");
  assert.equal(entry?.boundary, "explicitConversion");
}
const leanRefImports = hostRuntime.interfaceManifest.hostImports.filter(
  (entry) => entry.target === "js.leanRef",
);
assert.equal(leanRefImports.length, 1);
for (const entry of leanRefImports) {
  assert.equal(entry.effect, "runtime");
  assert.equal(entry.boundary, "objectHandle");
  assert.equal(entry.args[0]?.type?.kind, "leanObject");
  assert.equal(entry.result?.type, "Js");
}
const leanRefValueImports = hostRuntime.interfaceManifest.hostImports.filter(
  (entry) => entry.target === "js.leanRef.value",
);
assert.equal(leanRefValueImports.length, 1);
for (const entry of leanRefValueImports) {
  assert.equal(entry.effect, "runtime");
  assert.equal(entry.boundary, "objectHandle");
  assert.equal(entry.args[0]?.type?.type, "Js");
  assert.equal(entry.result?.kind, "leanObject");
}
assert.deepEqual(
  hostRuntime.interfaceManifest.hostImports
    .filter((entry) => entry.target.startsWith("js.leanRef"))
    .map((entry) => entry.target)
    .sort(),
  ["js.leanRef", "js.leanRef.value"],
);
for (const target of ["react.state.modify", "react.state.set"]) {
  const entry = hostImportTarget(target);
  assert.equal(entry?.effect, "runtime");
  assert.equal(entry?.boundary, "hostResource");
}
const documentSetTitleImport = hostRuntime.interfaceManifest.hostImports.find(
  (entry) => entry.target === "browser.document.setTitle",
);
assert.equal(documentSetTitleImport?.boundary, "hostResource");
assert.equal(documentSetTitleImport?.args[0]?.type?.type, "Js");
const documentGetTitleImport = hostRuntime.interfaceManifest.hostImports.find(
  (entry) => entry.target === "browser.document.getTitle",
);
assert.equal(documentGetTitleImport?.result?.type, "Js");
const querySelectorImport = hostRuntime.interfaceManifest.hostImports.find(
  (entry) => entry.target === "browser.document.querySelector",
);
assert.equal(querySelectorImport?.args[0]?.type?.type, "Js");
const getCheckedImport = hostRuntime.interfaceManifest.hostImports.find(
  (entry) => entry.target === "browser.htmlInputElement.getChecked",
);
assert.equal(getCheckedImport?.result?.type, "Js");
const setTimeoutImport = hostRuntime.interfaceManifest.hostImports.find(
  (entry) => entry.target === "browser.timer.setTimeout",
);
assert.equal(setTimeoutImport?.args[0]?.type?.type, "Js");
const animationFrameImport = hostRuntime.interfaceManifest.hostImports.find(
  (entry) => entry.target === "browser.animation.requestAnimationFrame",
);
assert.equal(animationFrameImport?.args[0]?.type?.kind, "function");
assert.equal(animationFrameImport?.args[0]?.type?.args[0]?.type?.type, "Js");
const infoviewClipboardImport = hostRuntime.interfaceManifest.hostImports.find(
  (entry) => entry.target === "infoview.clipboard.writeText",
);
assert.equal(infoviewClipboardImport?.args[0]?.type?.type, "Js");
assert.equal(infoviewClipboardImport?.result?.type, "Js");
const infoviewRevealPositionImport =
  hostRuntime.interfaceManifest.hostImports.find(
    (entry) => entry.target === "infoview.command.revealPosition",
  );
assert.equal(infoviewRevealPositionImport?.args[0]?.type?.type, "Js");
assert.equal(infoviewRevealPositionImport?.result?.type, "Js");
const infoviewInsertTextImport = hostRuntime.interfaceManifest.hostImports.find(
  (entry) => entry.target === "infoview.command.insertText",
);
assert.equal(infoviewInsertTextImport?.args[0]?.type?.type, "Js");
assert.equal(infoviewInsertTextImport?.args[1]?.type?.type, "Js");
assert.equal(infoviewInsertTextImport?.result?.type, "Js");
const infoviewDocumentPositionImport =
  hostRuntime.interfaceManifest.hostImports.find(
    (entry) => entry.target === "infoview.documentPosition",
  );
assert.equal(infoviewDocumentPositionImport?.effect, "runtime");
assert.equal(infoviewDocumentPositionImport?.args.length, 5);
for (const arg of infoviewDocumentPositionImport?.args ?? []) {
  assert.equal(arg.type?.type, "Js");
}
assert.equal(infoviewDocumentPositionImport?.result?.type, "Js");
const proofwidgetsResolveRefImport =
  hostRuntime.interfaceManifest.hostImports.find(
    (entry) => entry.target === "proofwidgets.rpc.resolveRef",
  );
assert.equal(proofwidgetsResolveRefImport?.args[0]?.type?.type, "Js");
assert.equal(proofwidgetsResolveRefImport?.args[1]?.type?.kind, "function");
assert.equal(
  proofwidgetsResolveRefImport?.args[1]?.type?.args[0]?.type?.type,
  "Js",
);
assert.equal(proofwidgetsResolveRefImport?.result?.type, "Js");
const proofwidgetsResolvedRefValueImport =
  hostRuntime.interfaceManifest.hostImports.find(
    (entry) => entry.target === "js.value.proofwidgets.resolvedRef.value",
  );
assert.equal(proofwidgetsResolvedRefValueImport?.effect, "runtime");
assert.equal(proofwidgetsResolvedRefValueImport?.args[0]?.type?.type, "Js");
assert.equal(
  proofwidgetsResolvedRefValueImport?.result?.name,
  "Lean.Vir.ProofWidgets.ResolvedRef",
);
const proofwidgetsRpcRefImport = hostRuntime.interfaceManifest.hostImports.find(
  (entry) => entry.target === "proofwidgets.rpc.ref",
);
assert.equal(proofwidgetsRpcRefImport?.effect, "runtime");
assert.equal(proofwidgetsRpcRefImport?.args.length, 5);
for (const arg of proofwidgetsRpcRefImport?.args ?? []) {
  assert.equal(arg.type?.type, "Js");
}
assert.equal(proofwidgetsRpcRefImport?.result?.type, "Js");
const proofwidgetsRpcRefFinishImport =
  hostRuntime.interfaceManifest.hostImports.find(
    (entry) => entry.target === "proofwidgets.rpc.ref.finish",
  );
assert.equal(proofwidgetsRpcRefFinishImport?.effect, "runtime");
assert.equal(proofwidgetsRpcRefFinishImport?.args[0]?.type?.type, "Js");
assert.equal(proofwidgetsRpcRefFinishImport?.args[1]?.type?.type, "Js");
assert.equal(proofwidgetsRpcRefFinishImport?.args[2]?.type?.type, "Js");
assert.equal(proofwidgetsRpcRefFinishImport?.args[3]?.type?.kind, "resource");
assert.equal(
  proofwidgetsRpcRefFinishImport?.args[3]?.type?.name,
  "Lean.Vir.Js",
);
assert.equal(proofwidgetsRpcRefFinishImport?.result?.type, "Js");
const testCallNatCallbackImport =
  hostRuntime.interfaceManifest.hostImports.find(
    (entry) => entry.target === "test.callNatCallback",
  );
assert.equal(testCallNatCallbackImport?.effect, "runtime");
assert.equal(testCallNatCallbackImport?.args[0]?.type?.type, "Js");
assert.equal(testCallNatCallbackImport?.args[1]?.type?.kind, "function");
assert.equal(testCallNatCallbackImport?.args[1]?.type?.effect, "runtime");
assert.equal(
  testCallNatCallbackImport?.args[1]?.type?.args[0]?.type?.type,
  "Js",
);
assert.equal(testCallNatCallbackImport?.args[1]?.type?.result?.type, "Js");
assert.equal(testCallNatCallbackImport?.result?.type, "Js");
const testRecordNatImport = hostRuntime.interfaceManifest.hostImports.find(
  (entry) => entry.target === "test.recordNat",
);
assert.equal(testRecordNatImport?.effect, "dom");
assert.equal(testRecordNatImport?.args[0]?.type?.type, "Js");
assert.equal(
  hostRuntime.interfaceManifest.hostImports.find(
    (entry) => entry.target === "react.root.render",
  )?.args[1]?.type?.kind,
  "function",
);
assert.equal(
  hostRuntime.interfaceManifest.hostImports.find(
    (entry) => entry.target === "react.root.render",
  )?.args[1]?.type?.effect,
  "react",
);
assert.equal(
  hostRuntime.interfaceManifest.hostImports.find(
    (entry) => entry.target === "react.root.render",
  )?.args[1]?.type?.args?.length,
  0,
);
assert.equal(
  hostRuntime.interfaceManifest.hostImports.find(
    (entry) => entry.target === "react.root.render",
  )?.args[1]?.type?.result?.type,
  "Js",
);
const reactRenderNodeImport = hostRuntime.interfaceManifest.hostImports.find(
  (entry) => entry.target === "react.root.renderNode",
);
if (reactRenderNodeImport !== undefined) {
  assert.equal(reactRenderNodeImport.args[0]?.type?.type, "Js");
  assert.equal(reactRenderNodeImport.args[1]?.type?.type, "Js");
  assert.equal(reactRenderNodeImport.result?.type, "Unit");
}
const reactRenderIntoSelectorImport =
  hostRuntime.interfaceManifest.hostImports.find(
    (entry) => entry.target === "react.root.renderIntoSelector",
  );
if (reactRenderIntoSelectorImport !== undefined) {
  assert.equal(reactRenderIntoSelectorImport.args[0]?.type?.type, "Js");
  assert.equal(reactRenderIntoSelectorImport.result?.type, "Js");
}
const reactRenderComponentIntoSelectorImport =
  hostRuntime.interfaceManifest.hostImports.find(
    (entry) => entry.target === "react.root.renderComponentIntoSelector",
  );
assert.equal(reactRenderComponentIntoSelectorImport?.args[0]?.type?.type, "Js");
assert.equal(reactRenderComponentIntoSelectorImport?.result?.type, "Js");
const reactUnmountSelectorImport =
  hostRuntime.interfaceManifest.hostImports.find(
    (entry) => entry.target === "react.root.unmountSelector",
  );
assert.equal(reactUnmountSelectorImport?.args[0]?.type?.type, "Js");
assert.equal(reactUnmountSelectorImport?.result?.type, "Js");
const reactPropertyImport = hostRuntime.interfaceManifest.hostImports.find(
  (entry) => entry.target === "js.value.react.property",
);
assert.equal(reactPropertyImport?.effect, "runtime");
assert.equal(
  reactPropertyImport?.args[0]?.type?.name,
  "Lean.Vir.React.Property",
);
assert.equal(reactPropertyImport?.result?.type, "Js");
const reactEventHandlerImport = hostRuntime.interfaceManifest.hostImports.find(
  (entry) => entry.target === "js.value.react.eventHandler",
);
assert.equal(reactEventHandlerImport?.effect, "runtime");
assert.equal(
  reactEventHandlerImport?.args[0]?.type?.name,
  "Lean.Vir.React.EventHandler",
);
assert.equal(reactEventHandlerImport?.result?.type, "Js");
const reactDepsEmptyImport = hostRuntime.interfaceManifest.hostImports.find(
  (entry) => entry.target === "react.deps.empty",
);
assert.equal(reactDepsEmptyImport?.effect, "react");
assert.equal(reactDepsEmptyImport?.args.length, 0);
assert.equal(reactDepsEmptyImport?.result?.type, "Js");
const reactDepsPushImport = hostRuntime.interfaceManifest.hostImports.find(
  (entry) => entry.target === "react.deps.push",
);
assert.equal(reactDepsPushImport?.effect, "react");
assert.equal(reactDepsPushImport?.args[0]?.type?.type, "Js");
assert.equal(reactDepsPushImport?.args[1]?.type?.type, "Js");
assert.equal(reactDepsPushImport?.result?.type, "Unit");
const reactPropsEmptyImport = hostRuntime.interfaceManifest.hostImports.find(
  (entry) => entry.target === "react.props.empty",
);
assert.equal(reactPropsEmptyImport?.effect, "react");
assert.equal(reactPropsEmptyImport?.args.length, 0);
assert.equal(reactPropsEmptyImport?.result?.type, "Js");
for (const target of [
  "react.props.setKey",
  "react.props.setProperty",
  "react.props.setEventHandler",
  "react.props.setRef",
]) {
  const entry = hostRuntime.interfaceManifest.hostImports.find(
    (hostImport) => hostImport.target === target,
  );
  assert.equal(entry?.effect, "react");
  assert.equal(entry?.args[0]?.type?.type, "Js");
  assert.equal(entry?.args[1]?.type?.type, "Js");
  assert.equal(entry?.result?.type, "Unit");
}
const reactChildrenEmptyImport = hostRuntime.interfaceManifest.hostImports.find(
  (entry) => entry.target === "react.node.children.empty",
);
assert.equal(reactChildrenEmptyImport?.effect, "react");
assert.equal(reactChildrenEmptyImport?.args.length, 0);
assert.equal(reactChildrenEmptyImport?.result?.type, "Js");
const reactChildrenPushImport = hostRuntime.interfaceManifest.hostImports.find(
  (entry) => entry.target === "react.node.children.push",
);
assert.equal(reactChildrenPushImport?.effect, "react");
assert.equal(reactChildrenPushImport?.args[0]?.type?.type, "Js");
assert.equal(reactChildrenPushImport?.args[1]?.type?.type, "Js");
assert.equal(reactChildrenPushImport?.result?.type, "Unit");
const reactTextImport = hostRuntime.interfaceManifest.hostImports.find(
  (entry) => entry.target === "react.node.text",
);
assert.equal(reactTextImport?.args[0]?.type?.type, "Js");
const reactElementTypeTagImport =
  hostRuntime.interfaceManifest.hostImports.find(
    (entry) => entry.target === "react.elementType.tag",
  );
assert.equal(reactElementTypeTagImport?.effect, "react");
assert.equal(reactElementTypeTagImport?.args[0]?.type?.type, "Js");
assert.equal(reactElementTypeTagImport?.result?.type, "Js");
const reactCreateElementImport = hostRuntime.interfaceManifest.hostImports.find(
  (entry) => entry.target === "react.node.createElement",
);
assert.equal(reactCreateElementImport?.args[0]?.type?.type, "Js");
assert.equal(reactCreateElementImport?.args[1]?.type?.type, "Js");
assert.equal(reactCreateElementImport?.args[2]?.type?.type, "Js");
const reactFragmentImport = hostRuntime.interfaceManifest.hostImports.find(
  (entry) => entry.target === "react.node.fragment",
);
assert.equal(reactFragmentImport?.effect, "react");
assert.equal(reactFragmentImport?.args[0]?.type?.type, "Js");
assert.equal(reactFragmentImport?.args[1]?.type?.type, "Js");
const reactPropValueType = findTypeDescriptor(
  reactPropertyImport?.args[0]?.type,
  (type) =>
    type.kind === "customInductive" &&
    typeof type.name === "string" &&
    type.name.endsWith(".PropValue"),
);
assert.deepEqual(
  reactPropValueType?.constructors.map((ctor) => ctor.jsName),
  ["string", "bool", "int", "float", "style", "classList"],
);
const virtualQueryState = createVirtualDocumentState();
const virtualQueryHost = createVirtualDocumentHostBindings(virtualQueryState);
const virtualNullableHost = createExportedCommonHostBindings(
  virtualQueryState.resources,
);
assert.equal(
  virtualNullableHost["js.nullable.isNull"](
    virtualQueryHost["browser.document.querySelector"]("#missing"),
  ),
  true,
);
ensureVirtualElementState(virtualQueryState, "#present");
const virtualPresentElement = virtualNullableHost["js.nullable.value"](
  virtualQueryHost["browser.document.querySelector"]("#present"),
);
assert.notEqual(virtualPresentElement, null);
assert.equal(
  virtualQueryHost["browser.element.getTextContent"](virtualPresentElement),
  "",
);
let virtualMissingEventTarget = "not-dispatched";
let virtualMissingEventCurrentTarget = "not-dispatched";
const virtualMissingEventCallback = (event) => {
  virtualMissingEventTarget = virtualQueryHost["browser.event.target"](event);
  virtualMissingEventCurrentTarget =
    virtualQueryHost["browser.event.currentTarget"](event);
};
const virtualMissingEventListener = virtualQueryHost[
  "browser.element.addEventListener"
](virtualPresentElement, "click", virtualMissingEventCallback);
virtualQueryState.elements
  .get("#present")
  .listeners.get("click")[0]
  .dispatch(
    createVirtualEventState({
      target: "#missing",
      currentTarget: "#missing",
    }),
  );
assert.equal(
  virtualNullableHost["js.nullable.isNull"](virtualMissingEventTarget),
  true,
);
assert.equal(
  virtualNullableHost["js.nullable.isNull"](virtualMissingEventCurrentTarget),
  true,
);
virtualQueryHost["browser.element.removeEventListener"](
  virtualMissingEventListener,
);
const browserRuntime = await createBrowserVirRuntime({
  wasmBytes,
  irPackageSetBytes: [hostPackageBytes],
});
assert.throws(
  () => browserRuntime.call("HostInterop.titleHandshake", "node"),
  /browser\.document host binding requires globalThis\.document|js\.string\.value argument value did not lift to a live host resource/,
);
const fibEntry = runtime.findManifestEntry("fib");
assert.notEqual(fibEntry, null);
assert.equal(runtime.call("fib", 12), "144");
assert.ok(
  (runtime.entryCallCache.get(fibEntry)?.callSlot ?? 0) > 0,
  "expected fib call slot to be cached",
);
assert.equal(runtime.exportsByName.fib(12), "144");
assert.equal(
  hostRuntime.call("HostInterop.titleHandshake", "runtime smoke"),
  "Lean VIR host: runtime smoke",
);
assert.equal(hostRuntime.call("HostInterop.callbackRoundTrip", 5), "12");

ensureVirtualElementStates(virtualDocumentState, ".query-all", [
  createVirtualElementState({ textContent: "first match" }),
  createVirtualElementState({ textContent: "second match" }),
]);
const queryRootBaseline =
  hostRuntime.hostState.resourceRoots.debugCounts().active;
assert.equal(
  hostRuntime.call("HostInterop.querySelectorAllCount", ".query-all"),
  "2",
);
assert.equal(
  hostRuntime.call("HostInterop.querySelectorAllLeanCount", ".query-all"),
  "2",
);
assert.equal(
  hostRuntime.call("HostInterop.querySelectorAllArrayCount", ".query-all"),
  "2",
);
assert.equal(
  hostRuntime.call("HostInterop.querySelectorAllFirstText", ".query-all"),
  "first match",
);
assert.equal(
  hostRuntime.call("HostInterop.querySelectorAllCountLoop", ".query-all", 1000),
  "2000",
);
const elementQueryRoot = ensureVirtualElementState(
  virtualDocumentState,
  "#element-query",
);
elementQueryRoot.queries.set("[data-e]", [
  createVirtualElementState({ attributes: new Map([["data-e", "0"]]) }),
  createVirtualElementState({ attributes: new Map([["data-e", "1"]]) }),
]);
assert.equal(
  hostRuntime.call(
    "HostInterop.elementQuerySelectorAllCount",
    "#element-query",
    "[data-e]",
  ),
  "2",
);
assert.equal(
  hostRuntime.call(
    "HostInterop.elementQuerySelectorText",
    "#element-query",
    "[data-e]",
  ),
  "",
);
elementQueryRoot.queries.get("[data-e]")[0].textContent = "first child";
assert.equal(
  hostRuntime.call(
    "HostInterop.elementQuerySelectorText",
    "#element-query",
    "[data-e]",
  ),
  "first child",
);
assert.equal(
  hostRuntime.call(
    "HostInterop.elementInnerHTMLRoundTrip",
    "#element-query",
    "<svg></svg>",
  ),
  "<svg></svg>",
);
assert.equal(hostRuntime.call("HostInterop.runtimeRefRoundTrip", 5), "714");
const keyTarget = ensureVirtualElementState(
  virtualDocumentState,
  "#key-target",
);
assert.equal(hostRuntime.call("HostInterop.mountKeyTitle", "#key-target"), "1");
keyTarget.listeners
  .get("keydown")[0]
  .dispatch(createVirtualEventState({ key: "Enter" }));
assert.equal(virtualDocumentState.title, "Enter");
assert.equal(
  hostRuntime.hostState.resourceRoots.debugCounts().active,
  queryRootBaseline,
  "querySelectorAll should release passive selector, NodeList, array, and element roots",
);
assert.ok(
  hostRuntime.liveCallbacks.size >= 1,
  "the runtime must track the live keydown callback root",
);
hostRuntime.dispose();
assert.equal(
  hostRuntime.liveCallbacks.size,
  0,
  "runtime disposal should release the key listener",
);
runtime.dispose();
prettyRuntime.dispose();
leanRuntime.dispose();

console.log("vir runtime manifest smoke ok");
