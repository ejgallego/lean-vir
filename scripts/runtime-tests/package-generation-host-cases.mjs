/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import {
  createVirRuntimeFactory,
  createVirtualDocumentState,
  ensureVirtualElementState,
  virtualReactElementById,
} from "../../web/src/vir-runtime-node.js";
import { hostResourceValue, releaseHostResource } from "../../web/src/host-resource.js";
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
      "test.react.value": () => freshHostDocumentState.resources.resourceForValue(7n),
      "test.runtime.value": () => freshHostDocumentState.resources.resourceForValue(9n),
    },
  });
  const hostRuntime = await hostFactory.createRuntime({ irPackageSetBytes: [await readFile(hostPackage)] });
  assert.equal(hostRuntime.interfaceManifest.hostImports.length, 17);
  assert.equal(hostRuntime.interfaceManifest.exports.find((entry) => entry.entry === "freshEchoBang")?.effect, "runtime");
  assert.equal(hostRuntime.interfaceManifest.exports.find((entry) => entry.entry === "freshTitleRoundtrip")?.effect, "dom");
  assert.equal(hostRuntime.interfaceManifest.exports.find((entry) => entry.entry === "freshReactValue")?.effect, "react");
  assert.equal(hostRuntime.interfaceManifest.exports.find((entry) => entry.entry === "freshRuntimeValue")?.effect, "runtime");
  assert.equal(hostRuntime.interfaceManifest.exports.find((entry) => entry.entry === "freshRuntimeInDom")?.effect, "dom");
  assert.equal(hostRuntime.interfaceManifest.exports.find((entry) => entry.entry === "freshRuntimeInReact")?.effect, "react");
  assert.equal(hostRuntime.interfaceManifest.hostImports.find((entry) => entry.target === "browser.document.setTitle")?.effect, "dom");
  assert.equal(hostRuntime.interfaceManifest.hostImports.find((entry) => entry.target === "test.react.value")?.effect, "react");
  assert.equal(hostRuntime.interfaceManifest.hostImports.find((entry) => entry.target === "test.runtime.value")?.effect, "runtime");
  assert.equal(hostRuntime.interfaceManifest.hostImports.find((entry) => entry.target === "test.react.value")?.result?.type, "Js");
  assert.equal(hostRuntime.interfaceManifest.hostImports.find((entry) => entry.target === "test.react.value")?.boundary, "hostResource");
  assert.equal(hostRuntime.interfaceManifest.hostImports.find((entry) => entry.target === "test.runtime.value")?.result?.type, "Js");
  assert.equal(hostRuntime.interfaceManifest.hostImports.find((entry) => entry.target === "test.runtime.value")?.boundary, "hostResource");
  const commonEchoImport = hostRuntime.interfaceManifest.hostImports.find((entry) => entry.target === "common.echoString");
  assert.equal(commonEchoImport?.effect, "runtime");
  assert.equal(commonEchoImport?.boundary, "hostResource");
  assert.equal(commonEchoImport?.args[0]?.type?.type, "Js");
  assert.equal(commonEchoImport?.result?.type, "Js");
  const ownedStringImport = hostRuntime.interfaceManifest.hostImports.find(
    (entry) => entry.target === "js.string.owned",
  );
  assert.equal(ownedStringImport?.effect, "runtime");
  assert.equal(ownedStringImport?.boundary, "explicitConversion");
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
  const jsObjectDocumentState = createVirtualDocumentState();
  const jsObjectRuntime = await createVirRuntimeFactory({
    wasmBytes,
    virtualDocumentState: jsObjectDocumentState,
    hostBindings: {
      "test.js.id": (value) => value,
      "test.js.length": (value) => jsObjectDocumentState.resources.resourceForValue(BigInt(hostResourceValue(value).length)),
    },
  }).createRuntime({ irPackageSetBytes: [await readFile(jsObjectPackage)] });
  const jsIdImport = jsObjectRuntime.interfaceManifest.hostImports.find((entry) => entry.target === "test.js.id");
  assert.equal(jsIdImport?.effect, "runtime");
  assert.equal(jsIdImport?.arity, 3);
  assert.equal(jsIdImport?.erasedPrefixArgs, 1);
  assert.equal(jsIdImport?.boundary, "hostResource");
  assert.equal(jsIdImport?.args.length, 1);
  assert.equal(jsIdImport?.args[0]?.type?.type, "Js");
  const jsLengthImport = jsObjectRuntime.interfaceManifest.hostImports.find((entry) => entry.target === "test.js.length");
  assert.equal(jsLengthImport?.effect, "runtime");
  assert.equal(jsLengthImport?.arity, 3);
  assert.equal(jsLengthImport?.erasedPrefixArgs, 1);
  assert.equal(jsLengthImport?.boundary, "hostResource");
  assert.equal(jsLengthImport?.args.length, 1);
  assert.equal(jsLengthImport?.args[0]?.type?.name, "Lean.Vir.Js");
  assert.equal(jsLengthImport?.result?.type, "Js");
  const jsResources = createHostResourceState();
  const jsArray = jsResources.resourceForValue([10, 20, 30]);
  const jsArrayAlias = jsObjectRuntime.call("freshJsIdNat", jsArray);
  assert.notEqual(jsArrayAlias, jsArray);
  assert.equal(hostResourceValue(jsArrayAlias), hostResourceValue(jsArray));
  releaseHostResource(jsArrayAlias);
  assert.deepEqual(hostResourceValue(jsArray), [10, 20, 30]);
  assert.equal(jsObjectRuntime.call("freshJsLengthNatArray", jsArray), "3");

  const leanRefSource = join(freshDir, "FreshLeanRef.lean");
  const leanRefPackage = join(freshDir, "lean-ref.irpkg");
  await writeRuntimeFixture(leanRefSource, "FreshLeanRef.lean");
  generateIrPackage(leanRefSource, leanRefPackage);
  const leanRefRuntime = await createVirRuntimeFactory({ wasmBytes })
    .createRuntime({ irPackageSetBytes: [await readFile(leanRefPackage)] });
  const leanRefToJsImport = leanRefRuntime.interfaceManifest.hostImports.find((entry) => entry.target === "js.leanRef");
  assert.equal(leanRefToJsImport?.boundary, "objectHandle");
  assert.equal(leanRefToJsImport?.args[0]?.type?.kind, "leanObject");
  assert.equal(leanRefToJsImport?.result?.type, "Js");
  const leanRefFromJsImport = leanRefRuntime.interfaceManifest.hostImports.find((entry) => entry.target === "js.leanRef.value");
  assert.equal(leanRefFromJsImport?.boundary, "objectHandle");
  assert.equal(leanRefFromJsImport?.args[0]?.type?.type, "Js");
  assert.equal(leanRefFromJsImport?.result?.kind, "leanObject");
  const leanRefRetainImport = leanRefRuntime.interfaceManifest.hostImports.find((entry) => entry.target === "js.leanRef.retain");
  assert.equal(leanRefRetainImport?.boundary, "objectHandle");
  assert.equal(leanRefRetainImport?.args[0]?.type?.type, "Js");
  assert.equal(leanRefRetainImport?.result?.type, "Js");
  const leanRefReleaseImport = leanRefRuntime.interfaceManifest.hostImports.find((entry) => entry.target === "js.leanRef.release");
  assert.equal(leanRefReleaseImport?.boundary, "objectHandle");
  assert.equal(leanRefReleaseImport?.args[0]?.type?.type, "Js");
  assert.equal(leanRefReleaseImport?.result?.type, "Unit");
  assert.equal(leanRefRuntime.call("Vir.Fixtures.FreshLeanRef.roundtripName", "Mochi"), "Mochi");
  assert.equal(leanRefRuntime.call("Vir.Fixtures.FreshLeanRef.roundtripFeed"), "feed");
  assert.equal(leanRefRuntime.call("Vir.Fixtures.FreshLeanRef.retainedAliasSurvivesRelease"), "alias");
  assert.equal(leanRefRuntime.call("Vir.Fixtures.FreshLeanRef.originalSurvivesAliasRelease"), "feed");
  assert.equal(leanRefRuntime.call("Vir.Fixtures.FreshLeanRef.nullableAliasSurvivesSourceRelease"), "nullable");
  assert.equal(
    leanRefRuntime.hostState.leanObjectHandleCells.size,
    0,
    "dropping the nullable wrapper must release its retained JSL child",
  );
  assert.throws(
    () => leanRefRuntime.call("Vir.Fixtures.FreshLeanRef.useReleased"),
    /js\.leanRef\.value argument value did not lift to a live host resource/,
  );

  const customJsValueSource = join(freshDir, "CustomJsValue.lean");
  const customJsValuePackage = join(freshDir, "custom-js-value.irpkg");
  await writeRuntimeFixture(customJsValueSource, "CustomJsValue.lean");
  generateIrPackage(customJsValueSource, customJsValuePackage);
  const customJsValueResources = createHostResourceState();
  const customJsValueRuntime = await createVirRuntimeFactory({
    wasmBytes,
    hostBindings: {
      "test.payload": (payload) => customJsValueResources.resourceForValue({ ...payload, name: `${payload.name}!` }),
    },
  }).createRuntime({ irPackageSetBytes: [await readFile(customJsValuePackage)] });
  const customPayloadImport = customJsValueRuntime.interfaceManifest.hostImports.find((entry) => entry.target === "test.payload");
  assert.equal(customPayloadImport?.boundary, "explicitConversion");
  assert.equal(customPayloadImport?.args[0]?.type?.kind, "structure");
  assert.equal(customPayloadImport?.result?.type, "Js");
  assert.deepEqual(hostResourceValue(customJsValueRuntime.call("Vir.Fixtures.CustomJsValue.makePayload")), {
    name: "custom!",
    count: "3",
  });

  const reactExternalSource = join(freshDir, "ReactExternalComponent.lean");
  const reactExternalPackage = join(freshDir, "react-external-component.irpkg");
  await writeRuntimeFixture(reactExternalSource, "ReactExternalComponent.lean");
  generateIrPackage(reactExternalSource, reactExternalPackage);
  const reactExternalDocumentState = createVirtualDocumentState();
  ensureVirtualElementState(reactExternalDocumentState, "#react-external-component");
  const externalBadge = createVirtualExternalBadgeComponent();
  const reactExternalRuntime = await createVirRuntimeFactory({
    wasmBytes,
    virtualDocumentState: reactExternalDocumentState,
    hostBindings: {
      "test.react.externalBadge": () => reactExternalDocumentState.resources.resourceForValue(externalBadge),
    },
  }).createRuntime({ irPackageSetBytes: [await readFile(reactExternalPackage)] });
  const externalBadgeImport = reactExternalRuntime.interfaceManifest.hostImports.find(
    (entry) => entry.target === "test.react.externalBadge",
  );
  assert.equal(externalBadgeImport?.effect, "react");
  assert.equal(externalBadgeImport?.args.length, 0);
  assert.equal(externalBadgeImport?.result?.type, "Js");
  assert.equal(
    reactExternalRuntime.interfaceManifest.hostImports.find((entry) => entry.target === "react.node.createElement")?.effect,
    "react",
  );
  assert.equal(
    reactExternalRuntime.interfaceManifest.hostImports.find((entry) => entry.target === "react.props.setRef")?.effect,
    "react",
  );
  assert.equal(reactExternalRuntime.call("Vir.Fixtures.ReactExternalComponent.mount", "#react-external-component"), true);
  const mounted = reactExternalDocumentState.elements.get("#react-external-component");
  assert.equal(mounted.textContent, "external child");
  assert.equal(reactExternalRuntime.liveCallbacks.size, 1);
  const badge = virtualReactElementById(mounted.reactRoot, "react-external-badge");
  assert.equal(badge.tag, "VirExternalBadge");
  assert.equal(badge.props.ref.current, "unset");
  mounted.reactRoot.unmount();
  assert.equal(reactExternalRuntime.liveCallbacks.size, 0);
  reactExternalRuntime.dispose();
}

function createVirtualExternalBadgeComponent() {
  function VirExternalBadge() {}
  VirExternalBadge.displayName = "VirExternalBadge";
  return VirExternalBadge;
}
