/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { createVirRuntime as createExportedBrowserVirRuntime } from "lean-vir";
import {
  createBrowserDocumentHostBindings as createExportedBrowserDocumentHostBindings,
  createBrowserElementHostBindings as createExportedBrowserElementHostBindings,
  createHostResourceState as createExportedHostResourceState,
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
  createVirtualEventState,
  ensureVirtualElementState,
} from "../../web/src/vir-runtime-node.js";
import { PACKAGE_FORMAT_VERSION, INTERFACE_MANIFEST_VERSION } from "../package-versions.mjs";
import {
  assert,
  assertInvalidManifest,
  assertManifestTypeDescriptorsRoundTrip,
  assertValidManifestShape,
  findTypeDescriptor,
  jsNatResourceValue,
  readRuntimeArtifacts,
} from "./shared.mjs";
import { demoHostImportTargets } from "../demo-host-import-targets.mjs";
import { invalidManifestCases } from "./manifest-invalid-cases.mjs";

const { wasmBytes, irPackageBytes, hostPackageBytes, prettyPackageBytes, leanPackageBytes } = await readRuntimeArtifacts();
const hostlessImports = createVirImports(new WebAssembly.Module(wasmBytes));
assert.throws(
  () => hostlessImports.env.vir_js_call_objects(0, 0, 0),
  /without an attached host state/,
);

const runtime = await createVirRuntime({ wasmBytes, irPackageBytes });
const callbackRecords = [];
const virtualDocumentState = createVirtualDocumentState();
const hostRuntime = await createVirRuntime({
  wasmBytes,
  irPackageBytes: hostPackageBytes,
  virtualDocumentState,
  hostBindings: {
    "test.callNatCallback": (input, callback) => {
      try {
        return callback(input);
      } finally {
        callback.release();
      }
    },
    "test.recordNat": (value) => {
      callbackRecords.push(Number(jsNatResourceValue(value)));
      return undefined;
    },
  },
});
const prettyRuntime = await createVirRuntime({ wasmBytes, irPackageBytes: prettyPackageBytes });
const leanRuntime = await createVirRuntime({ wasmBytes, irPackageBytes: leanPackageBytes });
assert.equal(createExportedBrowserVirRuntime, createBrowserVirRuntime);
assert.equal(createExportedNodeVirRuntime, createVirRuntime);
assert.equal(typeof createExportedHostResourceState, "function");
assert.equal(VIR_WASM_RELEASE_FILE, "vir-upstream.wasm");
assert.equal(VIR_WASM_DEV_FILE, "vir-upstream.dev.wasm");
assert.equal(NODE_VIR_WASM_RELEASE_FILE, VIR_WASM_RELEASE_FILE);
assert.equal(NODE_VIR_WASM_DEV_FILE, VIR_WASM_DEV_FILE);
assert.equal(debugNodeWasmUrlFor, debugWasmUrlFor);
assert.equal(debugWasmUrlFor("vir-upstream.wasm"), "vir-upstream.dev.wasm");
assert.equal(debugWasmUrlFor("./wasm/vir-upstream.wasm?rev=1#test"), "./wasm/vir-upstream.dev.wasm?rev=1#test");
assert.equal(createBrowserVirRuntimeFactory().wasmUrl, VIR_WASM_RELEASE_FILE);
assert.equal(createBrowserVirRuntimeFactory({ debugWasm: true }).wasmUrl, VIR_WASM_DEV_FILE);
assert.equal(
  createBrowserVirRuntimeFactory({ wasmUrl: "./wasm/custom.wasm", debugWasm: true }).wasmUrl,
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
assert.throws(() => debugWasmUrlFor("module.bin"), /debugWasm requires a \.wasm wasmUrl/);
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
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const element = { textContent: "shared element" };
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    writable: true,
    value: {
      title: "",
      querySelector: (selector) => selector === "#shared" ? element : null,
    },
  });
  try {
    const resources = createExportedHostResourceState();
    const primitiveResource = resources.resourceForValue(false);
    assert.equal(resources.resolveResource(primitiveResource, "Js"), false);
    assert.equal(resources.resourceForValue(false), primitiveResource);
    const documentBindings = createExportedBrowserDocumentHostBindings(resources);
    const elementBindings = createExportedBrowserElementHostBindings(resources);
    const sharedElement = documentBindings["browser.document.querySelector"](resources.resourceForValue("#shared"));
    const sharedText = elementBindings["browser.element.getTextContent"](sharedElement);
    assert.equal(resources.resolveResource(sharedText, "JsString"), "shared element");
    assert.throws(
      () => createExportedBrowserElementHostBindings()["browser.element.getTextContent"](sharedElement),
      /Element resource is not live/,
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
assert.ok(runtime.packageInfo.count > 0, "expected IR package to load declarations");
assert.equal(runtime.packageDeclCount(), runtime.packageInfo.count);
assert.equal(runtime.packageInfo.byteLength, irPackageBytes.byteLength);
assert.ok(runtime.packageInfo.interfaceExports > 0, "expected embedded interface exports");
assert.equal(runtime.packageInfo.hostImports, 0);
assert.equal(hostRuntime.packageInfo.hostImports, demoHostImportTargets.length);
assert.equal(runtime.packageInfo.metadata, runtime.packageMetadata);
assert.equal(runtime.packageMetadata.packageFormatVersion, PACKAGE_FORMAT_VERSION);
assert.equal(runtime.packageMetadata.manifestVersion, INTERFACE_MANIFEST_VERSION);
assert.match(runtime.packageMetadata.leanToolchain, /leanprover\/lean4/);
assert.ok(runtime.packageMetadata.generatedAt.length > 0);
assert.ok(runtime.packageMetadata.targets.some((target) => target.source === "examples/Fib.lean"));
assert.ok(runtime.interfaceManifest.exports.some((entry) => entry.entry === "fib"));
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
assert.deepEqual(hostRuntime.interfaceManifest.hostImports.map((entry) => entry.target).sort(), demoHostImportTargets);
const reactUseStateImports = hostRuntime.interfaceManifest.hostImports.filter((entry) => entry.target === "react.useState");
assert.equal(reactUseStateImports.length, 1);
assert.equal(reactUseStateImports[0]?.effect, "react");
assert.equal(reactUseStateImports[0]?.args[0]?.type?.kind, "resource");
assert.equal(reactUseStateImports[0]?.args[0]?.type?.name, "Lean.Vir.Js");
assert.equal(reactUseStateImports[0]?.args[0]?.type?.type, "Js");
assert.equal(reactUseStateImports[0]?.result?.type, "Js");
const reactStateValueImport = hostRuntime.interfaceManifest.hostImports.find((entry) => entry.target === "react.state.value");
assert.equal(reactStateValueImport?.args[0]?.type?.type, "Js");
assert.equal(reactStateValueImport?.result?.type, "Js");
const reactStateSetterImport = hostRuntime.interfaceManifest.hostImports.find((entry) => entry.target === "react.state.setter");
assert.equal(reactStateSetterImport?.args[0]?.type?.type, "Js");
assert.equal(reactStateSetterImport?.result?.type, "Js");
const reactUseReducerImports = hostRuntime.interfaceManifest.hostImports.filter((entry) => entry.target === "react.useReducer");
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
const reactReducerDispatchImports = hostRuntime.interfaceManifest.hostImports.filter((entry) => entry.target === "react.reducer.dispatch");
assert.equal(reactReducerDispatchImports.length, 1);
for (const entry of reactReducerDispatchImports) {
  assert.equal(entry.effect, "runtime");
  assert.equal(entry.args[0]?.type?.kind, "resource");
  assert.equal(entry.args[1]?.type?.type, "Js");
  assert.equal(entry.result?.type, "Unit");
}
const reactReducerStateValueImport = hostRuntime.interfaceManifest.hostImports.find((entry) => entry.target === "react.reducerState.value");
assert.equal(reactReducerStateValueImport?.effect, "runtime");
assert.equal(reactReducerStateValueImport?.args[0]?.type?.type, "Js");
assert.equal(reactReducerStateValueImport?.result?.type, "Js");
const reactReducerStateDispatchImport = hostRuntime.interfaceManifest.hostImports.find((entry) => entry.target === "react.reducerState.dispatch");
assert.equal(reactReducerStateDispatchImport?.effect, "runtime");
assert.equal(reactReducerStateDispatchImport?.args[0]?.type?.type, "Js");
assert.equal(reactReducerStateDispatchImport?.result?.type, "Js");
const reactUseRefImports = hostRuntime.interfaceManifest.hostImports.filter((entry) => entry.target === "react.useRef");
assert.equal(reactUseRefImports.length, 1);
assert.equal(reactUseRefImports[0]?.effect, "react");
assert.equal(reactUseRefImports[0]?.args[0]?.type?.kind, "resource");
assert.equal(reactUseRefImports[0]?.result?.type, "Js");
assert.equal(reactUseRefImports[0]?.result?.name, "Lean.Vir.Js");
const reactUseEffectImports = hostRuntime.interfaceManifest.hostImports.filter((entry) => entry.target === "react.useEffect");
assert.equal(reactUseEffectImports.length, 1);
assert.equal(reactUseEffectImports[0]?.effect, "react");
assert.equal(reactUseEffectImports[0]?.args[0]?.type?.kind, "function");
assert.equal(reactUseEffectImports[0]?.args[0]?.type?.effect, "dom");
assert.equal(reactUseEffectImports[0]?.args[1]?.type?.kind, "function");
assert.equal(reactUseEffectImports[0]?.args[1]?.type?.effect, "dom");
const reactUseEffectWithDepsImports = hostRuntime.interfaceManifest.hostImports.filter((entry) => entry.target === "react.useEffectWithDeps");
assert.equal(reactUseEffectWithDepsImports.length, 1);
assert.equal(reactUseEffectWithDepsImports[0]?.effect, "react");
assert.equal(reactUseEffectWithDepsImports[0]?.args[0]?.type?.kind, "array");
assert.equal(reactUseEffectWithDepsImports[0]?.args[0]?.type?.element?.type, "Js");
assert.equal(reactUseEffectWithDepsImports[0]?.args[0]?.type?.element?.name, "Lean.Vir.Js");
assert.equal(reactUseEffectWithDepsImports[0]?.args[1]?.type?.kind, "function");
assert.equal(reactUseEffectWithDepsImports[0]?.args[1]?.type?.effect, "dom");
assert.equal(reactUseEffectWithDepsImports[0]?.args[2]?.type?.kind, "function");
assert.equal(reactUseEffectWithDepsImports[0]?.args[2]?.type?.effect, "dom");
const reactRefGetImports = hostRuntime.interfaceManifest.hostImports.filter((entry) => entry.target === "react.ref.get");
assert.equal(reactRefGetImports.length, 1);
assert.equal(reactRefGetImports[0]?.effect, "runtime");
assert.equal(reactRefGetImports[0]?.args[0]?.type?.kind, "resource");
assert.equal(reactRefGetImports[0]?.result?.type, "Js");
const reactRefSetImports = hostRuntime.interfaceManifest.hostImports.filter((entry) => entry.target === "react.ref.set");
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
  "js.value.tamagotchi.viewAction",
  "js.value.tamagotchi.viewAction.value",
  "js.value.tamagotchi.viewState",
  "js.value.tamagotchi.viewState.value",
  "react.state.modify",
  "react.state.set",
]) {
  assert.equal(
    hostRuntime.interfaceManifest.hostImports.find((entry) => entry.target === target)?.effect,
    "runtime",
  );
}
const documentSetTitleImport = hostRuntime.interfaceManifest.hostImports.find((entry) => entry.target === "browser.document.setTitle");
assert.equal(documentSetTitleImport?.args[0]?.type?.type, "Js");
const documentGetTitleImport = hostRuntime.interfaceManifest.hostImports.find((entry) => entry.target === "browser.document.getTitle");
assert.equal(documentGetTitleImport?.result?.type, "Js");
const querySelectorImport = hostRuntime.interfaceManifest.hostImports.find((entry) => entry.target === "browser.document.querySelector");
assert.equal(querySelectorImport?.args[0]?.type?.type, "Js");
const getCheckedImport = hostRuntime.interfaceManifest.hostImports.find((entry) => entry.target === "browser.htmlInputElement.getChecked");
assert.equal(getCheckedImport?.result?.type, "Js");
const setTimeoutImport = hostRuntime.interfaceManifest.hostImports.find((entry) => entry.target === "browser.timer.setTimeout");
assert.equal(setTimeoutImport?.args[0]?.type?.type, "Js");
const animationFrameImport = hostRuntime.interfaceManifest.hostImports.find((entry) => entry.target === "browser.animation.requestAnimationFrame");
assert.equal(animationFrameImport?.args[0]?.type?.kind, "function");
assert.equal(animationFrameImport?.args[0]?.type?.args[0]?.type?.type, "Js");
const infoviewClipboardImport = hostRuntime.interfaceManifest.hostImports.find((entry) => entry.target === "infoview.clipboard.writeText");
assert.equal(infoviewClipboardImport?.args[0]?.type?.type, "Js");
assert.equal(infoviewClipboardImport?.result?.type, "Js");
const infoviewRevealPositionImport = hostRuntime.interfaceManifest.hostImports.find((entry) => entry.target === "infoview.command.revealPosition");
assert.equal(infoviewRevealPositionImport?.args[0]?.type?.type, "Js");
assert.equal(infoviewRevealPositionImport?.result?.type, "Js");
const infoviewDocumentPositionImport = hostRuntime.interfaceManifest.hostImports.find((entry) => entry.target === "infoview.documentPosition");
assert.equal(infoviewDocumentPositionImport?.effect, "runtime");
assert.equal(infoviewDocumentPositionImport?.args.length, 5);
for (const arg of infoviewDocumentPositionImport?.args ?? []) {
  assert.equal(arg.type?.type, "Js");
}
assert.equal(infoviewDocumentPositionImport?.result?.type, "Js");
const proofwidgetsResolveRefImport = hostRuntime.interfaceManifest.hostImports.find((entry) => entry.target === "proofwidgets.rpc.resolveRef");
assert.equal(proofwidgetsResolveRefImport?.args[0]?.type?.type, "Js");
assert.equal(proofwidgetsResolveRefImport?.args[1]?.type?.kind, "function");
assert.equal(proofwidgetsResolveRefImport?.args[1]?.type?.args[0]?.type?.type, "Js");
assert.equal(proofwidgetsResolveRefImport?.result?.type, "Js");
const proofwidgetsResolvedRefValueImport = hostRuntime.interfaceManifest.hostImports.find(
  (entry) => entry.target === "js.value.proofwidgets.resolvedRef.value"
);
assert.equal(proofwidgetsResolvedRefValueImport?.effect, "runtime");
assert.equal(proofwidgetsResolvedRefValueImport?.args[0]?.type?.type, "Js");
assert.equal(proofwidgetsResolvedRefValueImport?.result?.name, "Lean.Vir.ProofWidgets.ResolvedRef");
const proofwidgetsRpcRefImport = hostRuntime.interfaceManifest.hostImports.find((entry) => entry.target === "proofwidgets.rpc.ref");
assert.equal(proofwidgetsRpcRefImport?.effect, "runtime");
assert.equal(proofwidgetsRpcRefImport?.args.length, 5);
for (const arg of proofwidgetsRpcRefImport?.args ?? []) {
  assert.equal(arg.type?.type, "Js");
}
assert.equal(proofwidgetsRpcRefImport?.result?.type, "Js");
const proofwidgetsRpcRefFinishImport = hostRuntime.interfaceManifest.hostImports.find((entry) => entry.target === "proofwidgets.rpc.ref.finish");
assert.equal(proofwidgetsRpcRefFinishImport?.effect, "runtime");
assert.equal(proofwidgetsRpcRefFinishImport?.args[0]?.type?.type, "Js");
assert.equal(proofwidgetsRpcRefFinishImport?.args[1]?.type?.type, "Js");
assert.equal(proofwidgetsRpcRefFinishImport?.args[2]?.type?.type, "Js");
assert.equal(proofwidgetsRpcRefFinishImport?.args[3]?.type?.kind, "option");
assert.equal(proofwidgetsRpcRefFinishImport?.args[3]?.type?.element?.type, "Js");
assert.equal(proofwidgetsRpcRefFinishImport?.result?.type, "Js");
const testCallNatCallbackImport = hostRuntime.interfaceManifest.hostImports.find((entry) => entry.target === "test.callNatCallback");
assert.equal(testCallNatCallbackImport?.effect, "runtime");
assert.equal(testCallNatCallbackImport?.args[0]?.type?.type, "Js");
assert.equal(testCallNatCallbackImport?.args[1]?.type?.kind, "function");
assert.equal(testCallNatCallbackImport?.args[1]?.type?.effect, "runtime");
assert.equal(testCallNatCallbackImport?.args[1]?.type?.args[0]?.type?.type, "Js");
assert.equal(testCallNatCallbackImport?.args[1]?.type?.result?.type, "Js");
assert.equal(testCallNatCallbackImport?.result?.type, "Js");
const testRecordNatImport = hostRuntime.interfaceManifest.hostImports.find((entry) => entry.target === "test.recordNat");
assert.equal(testRecordNatImport?.effect, "dom");
assert.equal(testRecordNatImport?.args[0]?.type?.type, "Js");
assert.equal(
  hostRuntime.interfaceManifest.hostImports.find((entry) => entry.target === "react.root.render")
    ?.args[1]?.type?.kind,
  "function",
);
assert.equal(
  hostRuntime.interfaceManifest.hostImports.find((entry) => entry.target === "react.root.render")
    ?.args[1]?.type?.effect,
  "react",
);
assert.equal(
  hostRuntime.interfaceManifest.hostImports.find((entry) => entry.target === "react.root.render")
    ?.args[1]?.type?.args?.length,
  0,
);
assert.equal(
  hostRuntime.interfaceManifest.hostImports.find((entry) => entry.target === "react.root.render")
    ?.args[1]?.type?.result?.type,
  "Js",
);
const reactRenderIntoSelectorImport = hostRuntime.interfaceManifest.hostImports.find(
  (entry) => entry.target === "react.root.renderIntoSelector",
);
if (reactRenderIntoSelectorImport !== undefined) {
  assert.equal(reactRenderIntoSelectorImport.args[0]?.type?.type, "Js");
  assert.equal(reactRenderIntoSelectorImport.result?.type, "Js");
}
const reactRenderComponentIntoSelectorImport = hostRuntime.interfaceManifest.hostImports.find(
  (entry) => entry.target === "react.root.renderComponentIntoSelector",
);
assert.equal(reactRenderComponentIntoSelectorImport?.args[0]?.type?.type, "Js");
assert.equal(reactRenderComponentIntoSelectorImport?.result?.type, "Js");
const reactUnmountSelectorImport = hostRuntime.interfaceManifest.hostImports.find(
  (entry) => entry.target === "react.root.unmountSelector",
);
assert.equal(reactUnmountSelectorImport?.args[0]?.type?.type, "Js");
assert.equal(reactUnmountSelectorImport?.result?.type, "Js");
const reactPropertyImport = hostRuntime.interfaceManifest.hostImports.find((entry) => entry.target === "js.value.react.property");
assert.equal(reactPropertyImport?.effect, "runtime");
assert.equal(reactPropertyImport?.args[0]?.type?.name, "Lean.Vir.React.Property");
assert.equal(reactPropertyImport?.result?.type, "Js");
const reactEventHandlerImport = hostRuntime.interfaceManifest.hostImports.find((entry) => entry.target === "js.value.react.eventHandler");
assert.equal(reactEventHandlerImport?.effect, "runtime");
assert.equal(reactEventHandlerImport?.args[0]?.type?.name, "Lean.Vir.React.EventHandler");
assert.equal(reactEventHandlerImport?.result?.type, "Js");
const reactTextImport = hostRuntime.interfaceManifest.hostImports.find((entry) => entry.target === "react.node.text");
assert.equal(reactTextImport?.args[0]?.type?.type, "Js");
const reactCreateElementImport = hostRuntime.interfaceManifest.hostImports.find(
  (entry) => entry.target === "react.node.createElement",
);
assert.equal(reactCreateElementImport?.args[0]?.type?.type, "Js");
assert.equal(reactCreateElementImport?.args[1]?.type?.kind, "option");
assert.equal(reactCreateElementImport?.args[1]?.type?.element?.type, "Js");
assert.equal(reactCreateElementImport?.args[2]?.type?.kind, "array");
assert.equal(reactCreateElementImport?.args[2]?.type?.element?.type, "Js");
assert.equal(reactCreateElementImport?.args[3]?.type?.kind, "array");
assert.equal(reactCreateElementImport?.args[3]?.type?.element?.type, "Js");
const reactFragmentImport = hostRuntime.interfaceManifest.hostImports.find((entry) => entry.target === "react.node.fragment");
assert.equal(reactFragmentImport?.effect, "react");
assert.equal(reactFragmentImport?.args[0]?.type?.kind, "option");
assert.equal(reactFragmentImport?.args[0]?.type?.element?.type, "Js");
assert.equal(reactFragmentImport?.args[1]?.type?.kind, "array");
assert.equal(reactFragmentImport?.args[1]?.type?.element?.type, "Js");
const reactPropValueType = findTypeDescriptor(
  reactPropertyImport?.args[0]?.type,
  (type) => type.kind === "customInductive" && typeof type.name === "string" && type.name.endsWith(".PropValue"),
);
assert.deepEqual(
  reactPropValueType?.constructors.map((ctor) => ctor.jsName),
  ["string", "bool", "int", "float", "style", "classList"],
);
const virtualQueryState = createVirtualDocumentState();
const virtualQueryHost = createVirtualDocumentHostBindings(virtualQueryState);
assert.equal(virtualQueryHost["browser.document.querySelector"](virtualQueryState.resources.resourceForValue("#missing")), null);
ensureVirtualElementState(virtualQueryState, "#present");
const virtualPresentElement =
  virtualQueryHost["browser.document.querySelector"](virtualQueryState.resources.resourceForValue("#present"));
assert.notEqual(virtualPresentElement, null);
assert.equal(
  virtualQueryState.resources.resolveResource(
    virtualQueryHost["browser.element.getTextContent"](virtualPresentElement),
    "JsString",
  ),
  "",
);
let virtualMissingEventTarget = "not-dispatched";
let virtualMissingEventCurrentTarget = "not-dispatched";
const virtualMissingEventCallback = Object.assign((event) => {
  virtualMissingEventTarget = virtualQueryHost["browser.event.target"](event);
  virtualMissingEventCurrentTarget = virtualQueryHost["browser.event.currentTarget"](event);
}, { release: () => undefined });
const virtualMissingEventListener = virtualQueryHost["browser.element.addEventListener"](
  virtualPresentElement,
  virtualQueryState.resources.resourceForValue("click"),
  virtualMissingEventCallback,
);
virtualQueryState.elements.get("#present").listeners.get("click")[0].dispatch(createVirtualEventState({
  target: "#missing",
  currentTarget: "#missing",
}));
assert.equal(virtualMissingEventTarget, null);
assert.equal(virtualMissingEventCurrentTarget, null);
virtualQueryHost["browser.element.removeEventListener"](virtualMissingEventListener);
const browserRuntime = await createBrowserVirRuntime({ wasmBytes, irPackageBytes: hostPackageBytes });
assert.throws(
  () => browserRuntime.call("HostInterop.titleHandshake", "node"),
  /browser\.document host binding requires globalThis\.document|js\.string\.value argument value did not lift to a live host resource/,
);
const fibEntry = runtime.findManifestEntry("fib");
assert.notEqual(fibEntry, null);
assert.equal(runtime.call("fib", 12), "144");
assert.ok((runtime.entryCallCache.get(fibEntry)?.callSlot ?? 0) > 0, "expected fib call slot to be cached");
assert.equal(runtime.exportsByName.fib(12), "144");
assert.equal(hostRuntime.call("HostInterop.titleHandshake", "runtime smoke"), "Lean VIR host: runtime smoke");
assert.equal(hostRuntime.call("HostInterop.callbackRoundTrip", 5), "12");
assert.equal(hostRuntime.liveCallbacks.size, 0);
hostRuntime.dispose();
runtime.dispose();
prettyRuntime.dispose();
leanRuntime.dispose();

console.log("vir runtime manifest smoke ok");
