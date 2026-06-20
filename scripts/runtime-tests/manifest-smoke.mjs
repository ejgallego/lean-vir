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
} from "../../web/src/vir-runtime.js";
import {
  createVirRuntime,
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
      callbackRecords.push(Number(value));
      return undefined;
    },
  },
});
const prettyRuntime = await createVirRuntime({ wasmBytes, irPackageBytes: prettyPackageBytes });
const leanRuntime = await createVirRuntime({ wasmBytes, irPackageBytes: leanPackageBytes });
assert.equal(createExportedBrowserVirRuntime, createBrowserVirRuntime);
assert.equal(createExportedNodeVirRuntime, createVirRuntime);
assert.equal(typeof createExportedHostResourceState, "function");
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
    const sharedElement = documentBindings["browser.document.querySelector"]("#shared");
    assert.equal(elementBindings["browser.element.getTextContent"](sharedElement), "shared element");
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
assert.equal(reactUseStateImports[0]?.result?.fields?.find((field) => field.name === "value")?.type?.type, "Js");
const reactUseReducerImports = hostRuntime.interfaceManifest.hostImports.filter((entry) => entry.target === "react.useReducer");
assert.equal(reactUseReducerImports.length, 2);
for (const entry of reactUseReducerImports) {
  assert.equal(entry.effect, "react");
  assert.equal(entry.args[0]?.type?.kind, "function");
  assert.equal(entry.args[0]?.type?.effect, "runtime");
  assert.equal(entry.result?.fields?.find((field) => field.name === "dispatch")?.type?.kind, "resource");
}
const reactReducerDispatchImports = hostRuntime.interfaceManifest.hostImports.filter((entry) => entry.target === "react.reducer.dispatch");
assert.equal(reactReducerDispatchImports.length, 2);
for (const entry of reactReducerDispatchImports) {
  assert.equal(entry.effect, "runtime");
  assert.equal(entry.args[0]?.type?.kind, "resource");
}
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
assert.equal(reactUseEffectWithDepsImports[0]?.args[0]?.type?.element?.type, "String");
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
  "react.state.modify",
  "react.state.set",
]) {
  assert.equal(
    hostRuntime.interfaceManifest.hostImports.find((entry) => entry.target === target)?.effect,
    "runtime",
  );
}
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
const reactNodeType = hostRuntime.interfaceManifest.hostImports.find((entry) => entry.target === "react.node.createElement")
  ?.args[2]?.type;
const reactFragmentImport = hostRuntime.interfaceManifest.hostImports.find((entry) => entry.target === "react.node.fragment");
assert.equal(reactFragmentImport?.effect, "react");
assert.equal(reactFragmentImport?.args[0]?.type?.type, "Option String");
assert.equal(reactFragmentImport?.args[1]?.type?.kind, "array");
assert.equal(reactFragmentImport?.args[1]?.type?.element?.type, "Js");
const reactPropValueType = findTypeDescriptor(
  reactNodeType,
  (type) => type.kind === "customInductive" && typeof type.name === "string" && type.name.endsWith(".PropValue"),
);
assert.deepEqual(
  reactPropValueType?.constructors.map((ctor) => ctor.jsName),
  ["string", "bool", "int", "float", "style", "classList"],
);
const virtualQueryState = createVirtualDocumentState();
const virtualQueryHost = createVirtualDocumentHostBindings(virtualQueryState);
assert.equal(virtualQueryHost["browser.document.querySelector"]("#missing"), null);
ensureVirtualElementState(virtualQueryState, "#present");
const virtualPresentElement = virtualQueryHost["browser.document.querySelector"]("#present");
assert.notEqual(virtualPresentElement, null);
assert.equal(virtualQueryHost["browser.element.getTextContent"](virtualPresentElement), "");
let virtualMissingEventTarget = "not-dispatched";
let virtualMissingEventCurrentTarget = "not-dispatched";
const virtualMissingEventCallback = Object.assign((event) => {
  virtualMissingEventTarget = virtualQueryHost["browser.event.target"](event);
  virtualMissingEventCurrentTarget = virtualQueryHost["browser.event.currentTarget"](event);
}, { release: () => undefined });
const virtualMissingEventListener = virtualQueryHost["browser.element.addEventListener"](
  virtualPresentElement,
  "click",
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
  /browser\.document host binding requires globalThis\.document/,
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
