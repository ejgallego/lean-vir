/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import {
  createVirRuntime,
  createVirtualDocumentState,
} from "../../web/src/vir-runtime-node.js";
import {
  ensureTamagotchiVirtualDom,
  ensureVirtualElements,
} from "../virtual-fixtures.mjs";
import { demoHostImportTargets } from "../demo-host-import-targets.mjs";
import {
  smokeVirtualReactAttributes,
  smokeVirtualReactChangeInput,
  smokeVirtualReactCheckbox,
  smokeVirtualReactCounter,
  smokeVirtualReactReducer,
  smokeVirtualReactInput,
  smokeVirtualReactTamagotchi,
} from "../virtual-react-smoke-scenarios.mjs";

export async function smokeVirtualHostRuntime(context) {
  const hostDocumentState = createVirtualDocumentState();
  const hostRuntime = await createVirRuntime({
    wasmBytes: context.wasmBytes,
    irPackageBytes: context.hostPackageBytes,
    virtualDocumentState: hostDocumentState,
  });
  const actualHostImportTargets = hostRuntime.interfaceManifest.hostImports.map((entry) => entry.target).sort();
  if (hostRuntime.packageInfo.hostImports !== demoHostImportTargets.length ||
      JSON.stringify(actualHostImportTargets) !== JSON.stringify(demoHostImportTargets)) {
    throw new Error(
      `unexpected stock package host imports: expected ${JSON.stringify(demoHostImportTargets)}, got ${JSON.stringify(actualHostImportTargets)}`,
    );
  }
  const hostTitle = hostRuntime.call("HostInterop.titleHandshake", "smoke");
  if (hostTitle !== "Lean VIR host: smoke") {
    throw new Error(`Lean to JavaScript host title: expected Lean VIR host: smoke, got ${hostTitle}`);
  }

  ensureVirtualElements(hostDocumentState, [
    "#react-smoke",
    "#react-reducer-smoke",
    "#react-input-smoke",
    "#react-change-smoke",
    "#react-checkbox-smoke",
    "#react-attributes-smoke",
    "#react-pet-smoke",
  ]);
  smokeVirtualReactCounter(hostRuntime, hostDocumentState, "#react-smoke");
  smokeVirtualReactReducer(hostRuntime, hostDocumentState, "#react-reducer-smoke");
  await smokeMissingReactSelector(context);
  smokeVirtualReactInput(hostRuntime, hostDocumentState, "#react-input-smoke");
  smokeVirtualReactChangeInput(hostRuntime, hostDocumentState, "#react-change-smoke");
  smokeVirtualReactCheckbox(hostRuntime, hostDocumentState, "#react-checkbox-smoke");
  smokeVirtualReactAttributes(hostRuntime, hostDocumentState, "#react-attributes-smoke");
  await smokeVirtualReactTamagotchi(hostRuntime, hostDocumentState, "#react-pet-smoke");
  smokeTamagotchiDom(hostRuntime, hostDocumentState);
}

async function smokeMissingReactSelector(context) {
  const missingSelectorDocumentState = createVirtualDocumentState();
  const missingSelectorRuntime = await createVirRuntime({
    wasmBytes: context.wasmBytes,
    irPackageBytes: context.hostPackageBytes,
    virtualDocumentState: missingSelectorDocumentState,
  });
  const missingReactMountCount = missingSelectorRuntime.call("ReactCounter.mount", "#missing-react-root");
  if (missingReactMountCount !== false || missingSelectorRuntime.liveCallbacks.size !== 0) {
    throw new Error(`Lean React missing selector failed: ${JSON.stringify({ missingReactMountCount, callbacks: missingSelectorRuntime.liveCallbacks.size })}`);
  }
  missingSelectorRuntime.dispose();
}

function smokeTamagotchiDom(hostRuntime, hostDocumentState) {
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
}
