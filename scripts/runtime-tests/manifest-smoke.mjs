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
import {
  assert,
  assertInvalidManifest,
  assertManifestTypeDescriptorsRoundTrip,
  assertValidManifestShape,
  findTypeDescriptor,
  readRuntimeArtifacts,
} from "./shared.mjs";
import { invalidManifestCases } from "./manifest-invalid-cases.mjs";

const { wasmBytes, irPackageBytes, hostPackageBytes, prettyPackageBytes, leanPackageBytes } = await readRuntimeArtifacts();
const hostlessImports = createVirImports(new WebAssembly.Module(wasmBytes));
assert.throws(
  () => hostlessImports.env.vir_js_call(0, 0, 0),
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
assert.equal(hostRuntime.packageInfo.hostImports, 26);
assert.equal(runtime.packageInfo.metadata, runtime.packageMetadata);
assert.equal(runtime.packageMetadata.packageFormatVersion, 5);
assert.equal(runtime.packageMetadata.manifestVersion, 1);
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
assert.deepEqual(hostRuntime.interfaceManifest.hostImports.map((entry) => entry.target).sort(), [
  "browser.animation.cancelAnimationFrame",
  "browser.animation.requestAnimationFrame",
  "browser.document.getTitle",
  "browser.document.querySelector",
  "browser.document.setTitle",
  "browser.element.addEventListener",
  "browser.element.getAttribute",
  "browser.element.removeEventListener",
  "browser.element.setAttribute",
  "browser.element.setTextContent",
  "browser.event.currentTarget",
  "browser.event.preventDefault",
  "browser.event.stopPropagation",
  "browser.event.target",
  "browser.htmlInputElement.fromElement",
  "browser.htmlInputElement.getChecked",
  "browser.htmlInputElement.getValue",
  "browser.htmlInputElement.setChecked",
  "browser.htmlInputElement.setValue",
  "browser.timer.clearTimeout",
  "browser.timer.setTimeout",
  "react.root.create",
  "react.root.render",
  "react.root.unmount",
  "test.callNatCallback",
  "test.recordNat",
]);
assert.equal(
  hostRuntime.interfaceManifest.hostImports.find((entry) => entry.target === "react.root.render")
    ?.args[1]?.type?.kind,
  "customInductive",
);
const reactHtmlType = hostRuntime.interfaceManifest.hostImports.find((entry) => entry.target === "react.root.render")
  ?.args[1]?.type;
const reactPropValueType = findTypeDescriptor(
  reactHtmlType,
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
assert.equal(runtime.call("fib", 12), "144");
assert.equal(runtime.exportsByName.fib(12), "144");
assert.equal(hostRuntime.call("HostInterop.titleHandshake", "runtime smoke"), "Lean VIR host: runtime smoke");
assert.equal(hostRuntime.call("HostInterop.callbackRoundTrip", 5), "12");
assert.equal(hostRuntime.liveCallbacks.size, 0);
hostRuntime.dispose();
runtime.dispose();
prettyRuntime.dispose();
leanRuntime.dispose();

console.log("vir runtime manifest smoke ok");
