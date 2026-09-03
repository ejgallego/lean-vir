/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import {
  createVirRuntimeFactory,
} from "../../web/src/vir-runtime-node.js";
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
  const freshElement = {
    attributes: new Map(),
    textContent: "",
  };
  const freshDocument = {
    title: "",
    querySelector: (selector) => (selector === "#fresh" ? freshElement : null),
  };
  const hostFactory = createVirRuntimeFactory({
    wasmBytes,
    hostBindings: {
      "browser.document.current": () => freshDocument,
      "browser.document.getTitle": (documentValue) => documentValue.title,
      "browser.document.setTitle": (documentValue, title) => {
        documentValue.title = title;
        return undefined;
      },
      "browser.document.querySelector": (documentValue, selector) =>
        documentValue.querySelector(selector),
      "browser.element.getTextContent": (element) => element.textContent,
      "browser.element.setTextContent": (element, text) => {
        element.textContent = text;
        return undefined;
      },
      "browser.element.getAttribute": (element, name) =>
        element.attributes.get(name) ?? null,
      "browser.element.setAttribute": (element, name, value) => {
        element.attributes.set(name, value);
        return undefined;
      },
      "test.react.value": () => 7n,
      "test.runtime.value": () => 9n,
    },
  });
  const hostRuntime = await hostFactory.createRuntime({
    irPackageSet: [await readFile(hostPackage)],
  });
  assert.equal(hostRuntime.interfaceManifest.hostImports.length, 18);
  assert.equal(
    hostRuntime.interfaceManifest.exports.find(
      (entry) => entry.entry === "freshEchoBang",
    )?.effect,
    "runtime",
  );
  assert.equal(
    hostRuntime.interfaceManifest.exports.find(
      (entry) => entry.entry === "freshTitleRoundtrip",
    )?.effect,
    "dom",
  );
  assert.equal(
    hostRuntime.interfaceManifest.exports.find(
      (entry) => entry.entry === "freshReactValue",
    )?.effect,
    "react",
  );
  assert.equal(
    hostRuntime.interfaceManifest.exports.find(
      (entry) => entry.entry === "freshRuntimeValue",
    )?.effect,
    "runtime",
  );
  assert.equal(
    hostRuntime.interfaceManifest.exports.find(
      (entry) => entry.entry === "freshRuntimeInDom",
    )?.effect,
    "dom",
  );
  assert.equal(
    hostRuntime.interfaceManifest.exports.find(
      (entry) => entry.entry === "freshRuntimeInReact",
    )?.effect,
    "react",
  );
  assert.equal(
    hostRuntime.interfaceManifest.hostImports.find(
      (entry) => entry.target === "browser.document.setTitle",
    )?.effect,
    "dom",
  );
  assert.equal(
    hostRuntime.interfaceManifest.hostImports.find(
      (entry) => entry.target === "test.react.value",
    )?.effect,
    "react",
  );
  assert.equal(
    hostRuntime.interfaceManifest.hostImports.find(
      (entry) => entry.target === "test.runtime.value",
    )?.effect,
    "runtime",
  );
  assert.equal(
    hostRuntime.interfaceManifest.hostImports.find(
      (entry) => entry.target === "test.react.value",
    )?.result?.type,
    "Js",
  );
  assert.equal(
    hostRuntime.interfaceManifest.hostImports.find(
      (entry) => entry.target === "test.react.value",
    )?.boundary,
    "hostResource",
  );
  assert.equal(
    hostRuntime.interfaceManifest.hostImports.find(
      (entry) => entry.target === "test.runtime.value",
    )?.result?.type,
    "Js",
  );
  assert.equal(
    hostRuntime.interfaceManifest.hostImports.find(
      (entry) => entry.target === "test.runtime.value",
    )?.boundary,
    "hostResource",
  );
  const commonEchoImport = hostRuntime.interfaceManifest.hostImports.find(
    (entry) => entry.target === "common.echoString",
  );
  assert.equal(commonEchoImport?.effect, "runtime");
  assert.equal(commonEchoImport?.boundary, "hostResource");
  assert.equal(commonEchoImport?.args[0]?.type?.type, "Js");
  assert.equal(commonEchoImport?.result?.type, "Js");
  const nullableOfImport = hostRuntime.interfaceManifest.hostImports.find(
    (entry) => entry.target === "js.nullable.of",
  );
  assert.equal(nullableOfImport?.effect, "runtime");
  assert.equal(nullableOfImport?.boundary, "hostResource");
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

  const jsObjectSource = join(freshDir, "FreshJsObject.lean");
  const jsObjectPackage = join(freshDir, "js-object.irpkg");
  await writeRuntimeFixture(jsObjectSource, "FreshJsObject.lean");
  generateIrPackage(jsObjectSource, jsObjectPackage);
  const jsObjectRuntime = await createVirRuntimeFactory({
    wasmBytes,
    hostBindings: {
      "test.js.id": (value) => value,
      "test.js.length": (value) => BigInt(value.length),
    },
  }).createRuntime({ irPackageSet: [await readFile(jsObjectPackage)] });
  const jsIdImport = jsObjectRuntime.interfaceManifest.hostImports.find(
    (entry) => entry.target === "test.js.id",
  );
  assert.equal(jsIdImport?.effect, "runtime");
  assert.equal(jsIdImport?.arity, 3);
  assert.equal(jsIdImport?.erasedPrefixArgs, 1);
  assert.equal(jsIdImport?.boundary, "hostResource");
  assert.equal(jsIdImport?.args.length, 1);
  assert.equal(jsIdImport?.args[0]?.type?.type, "Js");
  const jsLengthImport = jsObjectRuntime.interfaceManifest.hostImports.find(
    (entry) => entry.target === "test.js.length",
  );
  assert.equal(jsLengthImport?.effect, "runtime");
  assert.equal(jsLengthImport?.arity, 3);
  assert.equal(jsLengthImport?.erasedPrefixArgs, 1);
  assert.equal(jsLengthImport?.boundary, "hostResource");
  assert.equal(jsLengthImport?.args.length, 1);
  assert.equal(jsLengthImport?.args[0]?.type?.name, "Lean.Vir.Js");
  assert.equal(jsLengthImport?.result?.type, "Js");
  const jsArray = [10, 20, 30];
  const jsArrayAlias = jsObjectRuntime.call("freshJsIdNat", jsArray);
  assert.equal(jsArrayAlias, jsArray);
  assert.deepEqual(jsArray, [10, 20, 30]);
  assert.equal(jsObjectRuntime.call("freshJsLengthNatArray", jsArray), "3");

  const leanRefSource = join(freshDir, "FreshLeanRef.lean");
  const leanRefPackage = join(freshDir, "lean-ref.irpkg");
  await writeRuntimeFixture(leanRefSource, "FreshLeanRef.lean");
  generateIrPackage(leanRefSource, leanRefPackage);
  const leanRefRuntime = await createVirRuntimeFactory({
    wasmBytes,
  }).createRuntime({ irPackageSet: [await readFile(leanRefPackage)] });
  const leanRefToJsImport = leanRefRuntime.interfaceManifest.hostImports.find(
    (entry) => entry.target === "js.leanRef",
  );
  assert.equal(leanRefToJsImport?.boundary, "objectHandle");
  assert.equal(leanRefToJsImport?.args[0]?.type?.kind, "leanObject");
  assert.equal(leanRefToJsImport?.result?.type, "Js");
  const leanRefFromJsImport = leanRefRuntime.interfaceManifest.hostImports.find(
    (entry) => entry.target === "js.leanRef.value",
  );
  assert.equal(leanRefFromJsImport?.boundary, "objectHandle");
  assert.equal(leanRefFromJsImport?.args[0]?.type?.type, "Js");
  assert.equal(leanRefFromJsImport?.result?.kind, "leanObject");
  assert.deepEqual(
    leanRefRuntime.interfaceManifest.hostImports
      .filter((entry) => entry.target.startsWith("js.leanRef"))
      .map((entry) => entry.target)
      .sort(),
    ["js.leanRef", "js.leanRef.value"],
  );
  assert.equal(
    leanRefRuntime.call("Vir.Fixtures.FreshLeanRef.roundtripName", "Mochi"),
    "Mochi",
  );
  assert.equal(
    leanRefRuntime.call("Vir.Fixtures.FreshLeanRef.roundtripFeed"),
    "feed",
  );
  assert.equal(
    leanRefRuntime.call("Vir.Fixtures.FreshLeanRef.nullablePreservesValue"),
    "nullable",
  );
  const leanRefHostState = leanRefRuntime.hostState;
  leanRefRuntime.dispose();
  assert.equal(
    leanRefHostState.leanObjectHandleCells.size,
    0,
    "runtime disposal must synchronously release every remaining JSL root",
  );

  const customJsValueSource = join(freshDir, "CustomJsValue.lean");
  const customJsValuePackage = join(freshDir, "custom-js-value.irpkg");
  await writeRuntimeFixture(customJsValueSource, "CustomJsValue.lean");
  generateIrPackage(customJsValueSource, customJsValuePackage);
  const customJsValueRuntime = await createVirRuntimeFactory({
    wasmBytes,
    hostBindings: {
      "test.payload": (payload) => ({ ...payload, name: `${payload.name}!` }),
    },
  }).createRuntime({
    irPackageSet: [await readFile(customJsValuePackage)],
  });
  const customPayloadImport =
    customJsValueRuntime.interfaceManifest.hostImports.find(
      (entry) => entry.target === "test.payload",
    );
  assert.equal(customPayloadImport?.boundary, "explicitConversion");
  assert.equal(customPayloadImport?.args[0]?.type?.kind, "structure");
  assert.equal(customPayloadImport?.result?.type, "Js");
  assert.deepEqual(
    customJsValueRuntime.call("Vir.Fixtures.CustomJsValue.makePayload"),
    {
      name: "custom!",
      count: "3",
    },
  );

  const reactExternalSource = join(freshDir, "ReactExternalComponent.lean");
  const reactExternalPackage = join(freshDir, "react-external-component.irpkg");
  await writeRuntimeFixture(reactExternalSource, "ReactExternalComponent.lean");
  generateIrPackage(reactExternalSource, reactExternalPackage);
  const externalBadge = createExternalBadgeComponent();
  const reactExternalRuntime = await createVirRuntimeFactory({
    wasmBytes,
    hostBindings: {
      "test.react.externalBadge": () => externalBadge,
    },
  }).createRuntime({
    irPackageSet: [await readFile(reactExternalPackage)],
  });
  const externalBadgeImport =
    reactExternalRuntime.interfaceManifest.hostImports.find(
      (entry) => entry.target === "test.react.externalBadge",
    );
  assert.equal(externalBadgeImport?.effect, "react");
  assert.equal(externalBadgeImport?.args.length, 0);
  assert.equal(externalBadgeImport?.result?.type, "Js");
  assert.equal(
    reactExternalRuntime.interfaceManifest.hostImports.find(
      (entry) => entry.target === "react.node.createElement",
    )?.effect,
    "react",
  );
  assert.equal(
    reactExternalRuntime.interfaceManifest.hostImports.find(
      (entry) => entry.target === "js.object.set",
    )?.effect,
    "runtime",
  );
  assert.throws(
    () =>
      reactExternalRuntime.call(
        "Vir.Fixtures.ReactExternalComponent.mount",
        "#react-external-component",
      ),
    /host import binding not found: js\.value\.react\.component/,
  );
  assert.equal(reactExternalRuntime.liveCallbacks.size, 0);
  reactExternalRuntime.dispose();
}

function createExternalBadgeComponent() {
  function VirExternalBadge() {}
  VirExternalBadge.displayName = "VirExternalBadge";
  return VirExternalBadge;
}
