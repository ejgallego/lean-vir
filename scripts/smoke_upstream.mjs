/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { readFile } from "node:fs/promises";

import { createVirImports, VirRuntime } from "../web/src/vir-runtime.js";
import {
  createVirRuntime,
  createVirtualDocumentState,
  createVirtualElementState,
  createVirtualEventState,
  virtualReactElementById,
} from "../web/src/vir-runtime-node.js";
import {
  ensureTamagotchiVirtualDom,
  ensureVirtualElements,
  virtualReactTextContent,
} from "./virtual-fixtures.mjs";

const wasm = await readFile(new URL("../web/public/vir-upstream.wasm", import.meta.url));
const fixtureManifest = JSON.parse(await readFile(new URL("../fixtures/manifest.json", import.meta.url), "utf8"));
const browserPackages = JSON.parse(await readFile(new URL("../fixtures/browser-packages.json", import.meta.url), "utf8"));
const packageBytesByFile = new Map();
for (const spec of browserPackages.packages ?? []) {
  packageBytesByFile.set(spec.file, await readFile(new URL(`../web/public/${spec.file}`, import.meta.url)));
}
const packageFileByFixtureSource = new Map();
for (const spec of browserPackages.packages ?? []) {
  for (const source of spec.fixtureSources ?? []) {
    packageFileByFixtureSource.set(source, spec.file);
  }
}
const defaultPackageFile =
  (browserPackages.packages ?? []).find((spec) => spec.id === browserPackages.defaultPackage)?.file
    ?? "fixtures-basic.irpkg";
const hostPackageFile =
  (browserPackages.packages ?? []).find((spec) => spec.id === browserPackages.hostPackage)?.file
    ?? "demo-host.irpkg";
const irPackage = packageBytesByFile.get(defaultPackageFile);
const hostPackage = packageBytesByFile.get(hostPackageFile);
const mod = new WebAssembly.Module(wasm);
const imports = createVirImports(mod);

const { exports } = await WebAssembly.instantiate(mod, imports);
exports.__wasm_call_ctors?.();

if (typeof exports.vir_alloc_bytes !== "function") {
  throw new Error("vir_alloc_bytes export is missing");
}
if (typeof exports.vir_load_ir_package !== "function") {
  throw new Error("vir_load_ir_package export is missing");
}
if (!exports.memory) {
  throw new Error("memory export is missing");
}
if (typeof exports.vir_last_package_error !== "function") {
  throw new Error("vir_last_package_error export is missing");
}
if (typeof exports.vir_last_package_error_size !== "function") {
  throw new Error("vir_last_package_error_size export is missing");
}
if (typeof exports.vir_call !== "function") {
  throw new Error("vir_call export is missing");
}
if (typeof exports.vir_call_result_size !== "function") {
  throw new Error("vir_call_result_size export is missing");
}
if (typeof exports.vir_call_error !== "function") {
  throw new Error("vir_call_error export is missing");
}
if (typeof exports.vir_call_error_size !== "function") {
  throw new Error("vir_call_error_size export is missing");
}
if (typeof exports.vir_package_interface_manifest !== "function") {
  throw new Error("vir_package_interface_manifest export is missing");
}
if (typeof exports.vir_package_interface_manifest_size !== "function") {
  throw new Error("vir_package_interface_manifest_size export is missing");
}
if (typeof exports.vir_package_decl_count !== "function") {
  throw new Error("vir_package_decl_count export is missing");
}
if (exports.vir_package_decl_count() !== 0) {
  throw new Error("package declaration provider should be empty before an .irpkg is loaded");
}
if (exports.vir_upstream_target_pointer_bytes() !== 4) {
  throw new Error("upstream wasm target layout guard failed");
}

function readWasmString(ptr, len) {
  return new TextDecoder().decode(new Uint8Array(exports.memory.buffer, ptr, len));
}

function lastPackageError() {
  const len = exports.vir_last_package_error_size();
  if (len === 0) return "";
  return readWasmString(exports.vir_last_package_error(), len);
}

const badPackage = Uint8Array.from([
  3, 0, 0, 0, 98, 97, 100,
  1, 0, 0, 0,
  0, 0, 0, 0,
]);
const badPackagePtr = exports.vir_alloc_bytes(badPackage.byteLength);
try {
  new Uint8Array(exports.memory.buffer, badPackagePtr, badPackage.byteLength).set(badPackage);
  const loadedDecls = exports.vir_load_ir_package(badPackagePtr, badPackage.byteLength);
  if (loadedDecls !== 0) {
    throw new Error("invalid IR package unexpectedly loaded");
  }
  const error = lastPackageError();
  if (!error.includes("invalid IR package magic")) {
    throw new Error(`invalid package diagnostic did not mention magic: ${error}`);
  }
} finally {
  exports.vir_free_bytes?.(badPackagePtr);
}

const packagePtr = exports.vir_alloc_bytes(irPackage.byteLength);
try {
  new Uint8Array(exports.memory.buffer, packagePtr, irPackage.byteLength).set(irPackage);
  const loadedDecls = exports.vir_load_ir_package(packagePtr, irPackage.byteLength);
  if (loadedDecls === 0) {
    throw new Error("IR package load failed");
  }
  if (exports.vir_package_decl_count() !== loadedDecls) {
    throw new Error("loaded declaration count does not match package provider state");
  }
} finally {
  exports.vir_free_bytes?.(packagePtr);
}

const runtime = new VirRuntime(exports);

const fibCases = [
  [0, 0],
  [1, 1],
  [8, 21],
  [10, 55],
  [12, 144],
  [17, 1597],
];

for (const [input, expected] of fibCases) {
  const actual = runtime.call("fib", input);
  if (actual !== String(expected)) {
    throw new Error(`upstream fib ${input}: expected ${expected}, got ${actual}`);
  }
}

let repeatedFib = 0;
for (let i = 0; i < 80; i++) {
  repeatedFib += Number(runtime.call("fib", 17));
}
if (repeatedFib !== 127760) {
  throw new Error(`upstream repeated fib: expected 127760, got ${repeatedFib}`);
}

const sortChecksum = runtime.call("SortDemo.demo");
if (sortChecksum !== "192") {
  throw new Error(`upstream SortDemo.demo: expected 192, got ${sortChecksum}`);
}

const genericFib = runtime.call("fib", 12);
if (genericFib !== "144") {
  throw new Error(`generic fib input: expected 144, got ${genericFib}`);
}

const editableChecksum = runtime.call("SortDemo.demoFromArray", [4, 1, 3, 2]);
if (editableChecksum !== "30") {
  throw new Error(`upstream SortDemo.demoFromArray: expected 30, got ${editableChecksum}`);
}

const genericEditableChecksum = runtime.call("SortDemo.demoFromArray", [4, 1, 3, 2]);
if (genericEditableChecksum !== "30") {
  throw new Error(`generic SortDemo.demoFromArray: expected 30, got ${genericEditableChecksum}`);
}

const genericStringScore = runtime.call("Vir.Fixtures.Basic.stringUtf8RoundtripScore", "Aé∀Z");
if (genericStringScore !== "1381") {
  throw new Error(`generic String input: expected 1381, got ${genericStringScore}`);
}

const genericByteArrayScore = runtime.call("Vir.Fixtures.Basic.byteArrayInputScore", [65, 66, 67]);
if (genericByteArrayScore !== "136") {
  throw new Error(`generic ByteArray input: expected 136, got ${genericByteArrayScore}`);
}

const hostDocumentState = createVirtualDocumentState();
const hostRuntime = await createVirRuntime({
  wasmBytes: wasm,
  irPackageBytes: hostPackage,
  virtualDocumentState: hostDocumentState,
});
if (hostRuntime.packageInfo.hostImports !== 26) {
  throw new Error(`expected 26 stock package host imports, got ${hostRuntime.packageInfo.hostImports}`);
}
const hostTitle = hostRuntime.call("HostInterop.titleHandshake", "smoke");
if (hostTitle !== "Lean VIR host: smoke") {
  throw new Error(`Lean to JavaScript host title: expected Lean VIR host: smoke, got ${hostTitle}`);
}
ensureVirtualElements(hostDocumentState, [
  "#react-smoke",
  "#react-input-smoke",
  "#react-change-smoke",
  "#react-checkbox-smoke",
  "#react-attributes-smoke",
  "#react-pet-smoke",
]);
const reactMountCount = hostRuntime.call("ReactCounter.mount", "#react-smoke");
const reactElement = hostDocumentState.elements.get("#react-smoke");
if (reactMountCount !== true || reactElement.textContent !== "react:0" || hostRuntime.liveCallbacks.size !== 1) {
  throw new Error(`Lean React mount failed: ${JSON.stringify({ reactMountCount, text: reactElement.textContent, callbacks: hostRuntime.liveCallbacks.size })}`);
}
virtualReactElementById(reactElement.reactRoot, "react-counter-button").handlers.onClick({});
if (reactElement.textContent !== "react:1" || hostRuntime.liveCallbacks.size !== 1) {
  throw new Error(`Lean React click failed: ${JSON.stringify({ text: reactElement.textContent, callbacks: hostRuntime.liveCallbacks.size })}`);
}
reactElement.reactRoot.unmount();
if (hostRuntime.liveCallbacks.size !== 0 || reactElement.reactRoot !== undefined) {
  throw new Error(`Lean React unmount cleanup failed: ${JSON.stringify({ callbacks: hostRuntime.liveCallbacks.size, root: reactElement.reactRoot })}`);
}
const missingSelectorDocumentState = createVirtualDocumentState();
const missingSelectorRuntime = await createVirRuntime({
  wasmBytes: wasm,
  irPackageBytes: hostPackage,
  virtualDocumentState: missingSelectorDocumentState,
});
const missingReactMountCount = missingSelectorRuntime.call("ReactCounter.mount", "#missing-react-root");
if (missingReactMountCount !== false || missingSelectorRuntime.liveCallbacks.size !== 0) {
  throw new Error(`Lean React missing selector failed: ${JSON.stringify({ missingReactMountCount, callbacks: missingSelectorRuntime.liveCallbacks.size })}`);
}
missingSelectorRuntime.dispose();
const reactInputMountCount = hostRuntime.call("ReactInput.mountInput", "#react-input-smoke");
const reactInputElement = hostDocumentState.elements.get("#react-input-smoke");
if (reactInputMountCount !== true || reactInputElement.textContent !== "name:" || hostRuntime.liveCallbacks.size !== 1) {
  throw new Error(`Lean React input mount failed: ${JSON.stringify({ reactInputMountCount, text: reactInputElement.textContent, callbacks: hostRuntime.liveCallbacks.size })}`);
}
const reactNameInput = createVirtualElementState({ value: "Ada" });
hostDocumentState.elements.set("#react-name-input", reactNameInput);
virtualReactElementById(reactInputElement.reactRoot, "react-name-input").handlers.onInput(createVirtualEventState({
  currentTarget: reactNameInput,
  target: createVirtualElementState({ value: "unused-target" }),
}));
if (reactInputElement.textContent !== "name:Ada" || hostRuntime.liveCallbacks.size !== 1) {
  throw new Error(`Lean React input change failed: ${JSON.stringify({ text: reactInputElement.textContent, callbacks: hostRuntime.liveCallbacks.size })}`);
}
virtualReactElementById(reactInputElement.reactRoot, "react-name-input").handlers.onInput(createVirtualEventState({
  target: createVirtualElementState({ value: "Target" }),
}));
if (reactInputElement.textContent !== "name:Target" || hostRuntime.liveCallbacks.size !== 1) {
  throw new Error(`Lean React input target fallback failed: ${JSON.stringify({ text: reactInputElement.textContent, callbacks: hostRuntime.liveCallbacks.size })}`);
}
reactInputElement.reactRoot.unmount();
if (hostRuntime.liveCallbacks.size !== 0 || reactInputElement.reactRoot !== undefined) {
  throw new Error(`Lean React input unmount cleanup failed: ${JSON.stringify({ callbacks: hostRuntime.liveCallbacks.size, root: reactInputElement.reactRoot })}`);
}
const reactChangeMountCount = hostRuntime.call("ReactInput.mountChangeInput", "#react-change-smoke");
const reactChangeElement = hostDocumentState.elements.get("#react-change-smoke");
if (reactChangeMountCount !== true || reactChangeElement.textContent !== "change:" || hostRuntime.liveCallbacks.size !== 2) {
  throw new Error(`Lean React change input mount failed: ${JSON.stringify({ reactChangeMountCount, text: reactChangeElement.textContent, callbacks: hostRuntime.liveCallbacks.size })}`);
}
const reactSubmitEvent = createVirtualEventState();
virtualReactElementById(reactChangeElement.reactRoot, "react-change-widget").handlers.onSubmit(reactSubmitEvent);
if (!reactSubmitEvent.defaultPrevented || !reactSubmitEvent.propagationStopped || hostRuntime.liveCallbacks.size !== 2) {
  throw new Error(`Lean React submit failed: ${JSON.stringify({ defaultPrevented: reactSubmitEvent.defaultPrevented, propagationStopped: reactSubmitEvent.propagationStopped, callbacks: hostRuntime.liveCallbacks.size })}`);
}
const reactChangeInput = createVirtualElementState({ value: "Grace" });
const reactChangeEvent = createVirtualEventState({
  currentTarget: reactChangeInput,
});
virtualReactElementById(reactChangeElement.reactRoot, "react-change-input").handlers.onChange(reactChangeEvent);
if (reactChangeElement.textContent !== "change:Grace" || !reactChangeEvent.defaultPrevented || !reactChangeEvent.propagationStopped || hostRuntime.liveCallbacks.size !== 2) {
  throw new Error(`Lean React change input failed: ${JSON.stringify({ text: reactChangeElement.textContent, defaultPrevented: reactChangeEvent.defaultPrevented, propagationStopped: reactChangeEvent.propagationStopped, callbacks: hostRuntime.liveCallbacks.size })}`);
}
reactChangeElement.reactRoot.unmount();
if (hostRuntime.liveCallbacks.size !== 0 || reactChangeElement.reactRoot !== undefined) {
  throw new Error(`Lean React change input unmount cleanup failed: ${JSON.stringify({ callbacks: hostRuntime.liveCallbacks.size, root: reactChangeElement.reactRoot })}`);
}
const reactCheckboxMountCount = hostRuntime.call("ReactInput.mountCheckbox", "#react-checkbox-smoke");
const reactCheckboxElement = hostDocumentState.elements.get("#react-checkbox-smoke");
if (reactCheckboxMountCount !== true || reactCheckboxElement.textContent !== "checked:false" || hostRuntime.liveCallbacks.size !== 1) {
  throw new Error(`Lean React checkbox mount failed: ${JSON.stringify({ reactCheckboxMountCount, text: reactCheckboxElement.textContent, callbacks: hostRuntime.liveCallbacks.size })}`);
}
virtualReactElementById(reactCheckboxElement.reactRoot, "react-checkbox-input").handlers.onChange(createVirtualEventState({
  currentTarget: createVirtualElementState({ checked: true }),
}));
if (reactCheckboxElement.textContent !== "checked:true" || hostRuntime.liveCallbacks.size !== 1) {
  throw new Error(`Lean React checkbox failed: ${JSON.stringify({ text: reactCheckboxElement.textContent, callbacks: hostRuntime.liveCallbacks.size })}`);
}
virtualReactElementById(reactCheckboxElement.reactRoot, "react-checkbox-input").handlers.onChange(createVirtualEventState({
  target: createVirtualElementState({ checked: false }),
}));
if (reactCheckboxElement.textContent !== "checked:false" || hostRuntime.liveCallbacks.size !== 1) {
  throw new Error(`Lean React checkbox target fallback failed: ${JSON.stringify({ text: reactCheckboxElement.textContent, callbacks: hostRuntime.liveCallbacks.size })}`);
}
reactCheckboxElement.reactRoot.unmount();
if (hostRuntime.liveCallbacks.size !== 0 || reactCheckboxElement.reactRoot !== undefined) {
  throw new Error(`Lean React checkbox unmount cleanup failed: ${JSON.stringify({ callbacks: hostRuntime.liveCallbacks.size, root: reactCheckboxElement.reactRoot })}`);
}
const reactAttributesMountCount = hostRuntime.call("ReactInput.mountAttributes", "#react-attributes-smoke");
const reactAttributesElement = hostDocumentState.elements.get("#react-attributes-smoke");
if (reactAttributesMountCount !== true || reactAttributesElement.textContent !== "attrs:attrs" || hostRuntime.liveCallbacks.size !== 0) {
  throw new Error(`Lean React attributes mount failed: ${JSON.stringify({ reactAttributesMountCount, text: reactAttributesElement.textContent, callbacks: hostRuntime.liveCallbacks.size })}`);
}
const reactAttributesWidget = virtualReactElementById(reactAttributesElement.reactRoot, "react-attributes-widget");
if (
  reactAttributesWidget.props.role !== "group" ||
  reactAttributesWidget.props["aria-label"] !== "React attribute fixture" ||
  reactAttributesWidget.props["data-case"] !== "attributes" ||
  reactAttributesWidget.props["data-testid"] !== "react-attributes" ||
  reactAttributesWidget.props.tabIndex !== 3 ||
  reactAttributesWidget.props.className !== "react-attributes is-mounted" ||
  reactAttributesWidget.props.style?.color !== "rgb(1, 2, 3)" ||
  reactAttributesWidget.props.style?.marginTop !== "4px"
) {
  throw new Error(`Lean React attribute widget props failed: ${JSON.stringify(reactAttributesWidget.props)}`);
}
const reactAttributesLabel = virtualReactElementById(reactAttributesElement.reactRoot, "react-attributes-label");
const reactAttributesInput = virtualReactElementById(reactAttributesElement.reactRoot, "react-attributes-input");
const reactAttributesOutput = virtualReactElementById(reactAttributesElement.reactRoot, "react-attributes-output");
if (
  reactAttributesLabel.props.htmlFor !== "react-attributes-input" ||
  reactAttributesInput.props.name !== "attributes" ||
  reactAttributesInput.props.type !== "checkbox" ||
  reactAttributesInput.props.checked !== true ||
  reactAttributesInput.props.disabled !== true ||
  reactAttributesOutput.props.title !== "attribute output"
) {
  throw new Error(`Lean React attribute child props failed: ${JSON.stringify({ label: reactAttributesLabel.props, input: reactAttributesInput.props, output: reactAttributesOutput.props })}`);
}
reactAttributesElement.reactRoot.unmount();
const reactPetMountCount = hostRuntime.call("ReactTamagotchi.mount", "#react-pet-smoke");
const reactPetElement = hostDocumentState.elements.get("#react-pet-smoke");
if (reactPetMountCount !== true || hostRuntime.liveCallbacks.size !== 9) {
  throw new Error(`Lean React Tamagotchi mount failed: ${JSON.stringify({ reactPetMountCount, callbacks: hostRuntime.liveCallbacks.size })}`);
}
virtualReactElementById(reactPetElement.reactRoot, "react-pet-action-ignore").handlers.onClick({});
const reactPetSummary = virtualReactTextContent(virtualReactElementById(reactPetElement.reactRoot, "react-pet-summary"));
const reactPetTrace = virtualReactElementById(reactPetElement.reactRoot, "react-pet-trace");
const reactPetTraceText = virtualReactTextContent(reactPetTrace);
if (
  reactPetSummary !== "Octi is hungry; last ignore; care 2/5; turn 1" ||
  reactPetTraceText !== "happyhungry" ||
  reactPetTrace.props.role !== "list" ||
  reactPetTrace.props["aria-label"] !== "Mood trace: happy -> hungry" ||
  reactPetTrace.children[0].props.role !== "listitem" ||
  reactPetTrace.children[1].props.role !== "listitem" ||
  hostRuntime.liveCallbacks.size !== 9
) {
  throw new Error(`Lean React Tamagotchi action failed: ${JSON.stringify({ reactPetSummary, reactPetTraceText, traceProps: reactPetTrace.props, callbacks: hostRuntime.liveCallbacks.size })}`);
}
virtualReactElementById(reactPetElement.reactRoot, "react-pet-name-input").handlers.onChange(createVirtualEventState({
  currentTarget: createVirtualElementState({ value: "Ada" }),
}));
const reactPetRenamed = virtualReactTextContent(virtualReactElementById(reactPetElement.reactRoot, "react-pet-summary"));
if (reactPetRenamed !== "Ada is hungry; last rename; care 2/5; turn 1" || hostRuntime.liveCallbacks.size !== 9) {
  throw new Error(`Lean React Tamagotchi rename failed: ${JSON.stringify({ reactPetRenamed, callbacks: hostRuntime.liveCallbacks.size })}`);
}
reactPetElement.reactRoot.unmount();
if (hostRuntime.liveCallbacks.size !== 0 || reactPetElement.reactRoot !== undefined) {
  throw new Error(`Lean React Tamagotchi unmount cleanup failed: ${JSON.stringify({ callbacks: hostRuntime.liveCallbacks.size, root: reactPetElement.reactRoot })}`);
}
ensureTamagotchiVirtualDom(hostDocumentState);
const petMountCount = hostRuntime.call("Tamagotchi.uiMountFromDom");
if (petMountCount !== "8" || hostRuntime.liveCallbacks.size !== 8) {
  throw new Error(`Lean Tamagotchi mount callbacks failed: ${petMountCount}`);
}
const petReset = hostRuntime.call("Tamagotchi.uiReset", "Mochi", "pet");
const petStep = hostRuntime.call("Tamagotchi.uiStep", petReset, "ignore");
if (
  petStep.name !== "Mochi" ||
  petStep.mood !== "hungry" ||
  petStep.trace.join(" -> ") !== "happy -> hungry" ||
  petStep.turns !== "1" ||
  petStep.care !== "2"
) {
  throw new Error(`Lean Tamagotchi browser step failed: ${JSON.stringify(petStep)}`);
}
const petDomReset = hostRuntime.call("Tamagotchi.uiResetFromDom");
const petDomRename = hostRuntime.call("Tamagotchi.uiRenameFromDom");
const petDomStep = hostRuntime.call("Tamagotchi.uiStepFromDom", "ignore");
hostDocumentState.elements.get("[data-action='ignore']").listeners.get("click")?.[0]?.dispatch({});
const petEventMood = hostDocumentState.elements.get("#pet-device").attributes.get("data-mood");
const petEventTrace = hostDocumentState.elements.get("#pet-device").attributes.get("data-trace");
if (
  petDomReset.name !== "Mochi" ||
  petDomRename.name !== "Mochi" ||
  petDomReset.mood !== "happy" ||
  petDomStep.mood !== "hungry" ||
  petDomStep.trace.join(" -> ") !== "happy -> hungry" ||
  petEventMood !== "angry" ||
  petEventTrace !== "happy,hungry,angry"
) {
  throw new Error(`Lean Tamagotchi DOM-driven step failed: ${JSON.stringify({ petDomReset, petDomRename, petDomStep, petEventMood, petEventTrace })}`);
}

function packageForFixture(fixture) {
  return packageBytesByFile.get(packageFileByFixtureSource.get(fixture.source) ?? defaultPackageFile);
}

let repeatedSortChecksum = 0;
for (let i = 0; i < 5; i++) {
  repeatedSortChecksum += Number(runtime.call("SortDemo.demoFromArray", [4, 1, 3, 2]));
}
if (repeatedSortChecksum !== 150) {
  throw new Error(`upstream repeated SortDemo.demoFromArray: expected 150, got ${repeatedSortChecksum}`);
}

for (const fixture of fixtureManifest.fixtures ?? []) {
  if (fixture.result?.type !== "Nat") {
    throw new Error(`${fixture.id}: unsupported smoke result type ${fixture.result?.type}`);
  }
  let value;
  try {
    const { exports: fixtureExports } = await WebAssembly.instantiate(mod, imports);
    fixtureExports.__wasm_call_ctors?.();
    const fixturePackage = packageForFixture(fixture);
    const fixturePackagePtr = fixtureExports.vir_alloc_bytes(fixturePackage.byteLength);
    try {
      new Uint8Array(fixtureExports.memory.buffer, fixturePackagePtr, fixturePackage.byteLength).set(fixturePackage);
      const loadedDecls = fixtureExports.vir_load_ir_package(fixturePackagePtr, fixturePackage.byteLength);
      if (loadedDecls === 0) {
        throw new Error("IR package load failed");
      }
    } finally {
      fixtureExports.vir_free_bytes?.(fixturePackagePtr);
    }

    value = new VirRuntime(fixtureExports).call(fixture.entry);
  } catch (error) {
    throw new Error(`${fixture.id}: fixture evaluation failed`, { cause: error });
  }
  if (!/^\d+$/.test(value)) {
    throw new Error(`${fixture.id}: expected Nat result, got ${value}`);
  }
}

console.log(
  `upstream smoke ok: fib 17 = 1597, Lean DOM and React Tamagotchi work, editable SortDemo works, ${fixtureManifest.fixtures.length} fixtures run`,
);
