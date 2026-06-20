/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import {
  createVirRuntimeFactory,
  createVirtualDocumentState,
  ensureVirtualElementState,
} from "../../web/src/vir-runtime-node.js";
import { hostResourceValue } from "../../web/src/host-resource.js";
import { createHostResourceState } from "../../web/src/host/vir-host-resources.js";
import {
  assert,
  generateIrPackage,
  join,
  readFile,
  writeRuntimeFixture,
} from "./shared.mjs";

export async function runHostPackageSmoke({ freshDir, wasmBytes }) {
  const hostSource = join(freshDir, "FreshHost.lean");
  const hostPackage = join(freshDir, "host.irpkg");
  await writeRuntimeFixture(hostSource, "FreshHost.lean");

  generateIrPackage(hostSource, hostPackage);
  const freshHostDocumentState = createVirtualDocumentState();
  ensureVirtualElementState(freshHostDocumentState, "#fresh");
  const hostFactory = createVirRuntimeFactory({
    wasmBytes,
    virtualDocumentState: freshHostDocumentState,
    hostBindings: {
      "test.react.value": () => "7",
      "test.runtime.value": () => "9",
    },
  });
  const hostRuntime = await hostFactory.createRuntime({ irPackageBytes: await readFile(hostPackage) });
  assert.equal(hostRuntime.interfaceManifest.hostImports.length, 10);
  assert.equal(hostRuntime.interfaceManifest.exports.find((entry) => entry.entry === "freshEchoBang")?.effect, "pure");
  assert.equal(hostRuntime.interfaceManifest.exports.find((entry) => entry.entry === "freshTitleRoundtrip")?.effect, "dom");
  assert.equal(hostRuntime.interfaceManifest.exports.find((entry) => entry.entry === "freshReactValue")?.effect, "react");
  assert.equal(hostRuntime.interfaceManifest.exports.find((entry) => entry.entry === "freshRuntimeValue")?.effect, "runtime");
  assert.equal(hostRuntime.interfaceManifest.exports.find((entry) => entry.entry === "freshRuntimeInDom")?.effect, "dom");
  assert.equal(hostRuntime.interfaceManifest.exports.find((entry) => entry.entry === "freshRuntimeInReact")?.effect, "react");
  assert.equal(hostRuntime.interfaceManifest.hostImports.find((entry) => entry.target === "browser.document.setTitle")?.effect, "dom");
  assert.equal(hostRuntime.interfaceManifest.hostImports.find((entry) => entry.target === "test.react.value")?.effect, "react");
  assert.equal(hostRuntime.interfaceManifest.hostImports.find((entry) => entry.target === "test.runtime.value")?.effect, "runtime");
  assert.equal(hostRuntime.call("freshEchoBang", "ok"), "ok!");
  assert.equal(hostRuntime.call("freshTitleRoundtrip", "Lean.Vir"), "Lean.Vir");
  assert.equal(hostRuntime.call("freshReactValue"), "7");
  assert.equal(hostRuntime.call("freshRuntimeValue"), "9");
  assert.equal(hostRuntime.call("freshRuntimeInDom"), "10");
  assert.equal(hostRuntime.call("freshRuntimeInReact"), "11");
  assert.deepEqual(hostRuntime.call("freshElementRoundtrip", "element"), {
    fst: "element",
    snd: "element!",
  });

  const customHostSource = join(freshDir, "FreshCustomHost.lean");
  const customHostPackage = join(freshDir, "custom-host.irpkg");
  await writeRuntimeFixture(customHostSource, "FreshCustomHost.lean");
  generateIrPackage(customHostSource, customHostPackage);
  const customFactory = createVirRuntimeFactory({
    wasmBytes,
    hostBindings: {
      "test.bumpCounter": (counter) => ({
        label: `${counter.label}!`,
        value: (BigInt(counter.value) + 1n).toString(),
        enabled: !counter.enabled,
      }),
      "test.bumpNat": (n) => (BigInt(n) + 1n).toString(),
    },
  });
  const customRuntime = await customFactory.createRuntime({ irPackageBytes: await readFile(customHostPackage) });
  assert.deepEqual(customRuntime.interfaceManifest.hostImports.map((entry) => entry.target).sort(), [
    "test.bumpCounter",
    "test.bumpNat",
  ]);
  assert.equal(customRuntime.call("freshCustomBump", 41), "42");
  assert.deepEqual(customRuntime.call("freshCustomCounter", {
    label: "count",
    value: 4,
    enabled: true,
  }), {
    label: "count!",
    value: "5",
    enabled: false,
  });

  const objectImportFactory = createVirRuntimeFactory({
    wasmBytes,
    imports: {},
    hostBindings: {
      "test.bumpCounter": (counter) => counter,
      "test.bumpNat": (n) => (BigInt(n) + 2n).toString(),
    },
  });
  const objectImportRuntime = await objectImportFactory.createRuntime({ irPackageBytes: await readFile(customHostPackage) });
  assert.equal(objectImportRuntime.call("freshCustomBump", 40), "42");

  const jsObjectSource = join(freshDir, "FreshJsObject.lean");
  const jsObjectPackage = join(freshDir, "js-object.irpkg");
  await writeRuntimeFixture(jsObjectSource, "FreshJsObject.lean");
  generateIrPackage(jsObjectSource, jsObjectPackage);
  const jsObjectRuntime = await createVirRuntimeFactory({
    wasmBytes,
    hostBindings: {
      "test.js.id": (value) => value,
      "test.js.length": (value) => `${hostResourceValue(value).length}`,
    },
  }).createRuntime({ irPackageBytes: await readFile(jsObjectPackage) });
  const jsIdImport = jsObjectRuntime.interfaceManifest.hostImports.find((entry) => entry.target === "test.js.id");
  assert.equal(jsIdImport?.effect, "runtime");
  assert.equal(jsIdImport?.arity, 3);
  assert.equal(jsIdImport?.erasedPrefixArgs, 1);
  assert.equal(jsIdImport?.args.length, 1);
  assert.equal(jsIdImport?.args[0]?.type?.type, "Js");
  const jsLengthImport = jsObjectRuntime.interfaceManifest.hostImports.find((entry) => entry.target === "test.js.length");
  assert.equal(jsLengthImport?.effect, "runtime");
  assert.equal(jsLengthImport?.arity, 3);
  assert.equal(jsLengthImport?.erasedPrefixArgs, 1);
  assert.equal(jsLengthImport?.args.length, 1);
  assert.equal(jsLengthImport?.args[0]?.type?.name, "Lean.Vir.Js");
  const jsResources = createHostResourceState();
  const jsArray = jsResources.resourceForValue([10, 20, 30]);
  assert.equal(jsObjectRuntime.call("freshJsIdNat", jsArray), jsArray);
  assert.equal(jsObjectRuntime.call("freshJsLengthNatArray", jsArray), "3");
}
