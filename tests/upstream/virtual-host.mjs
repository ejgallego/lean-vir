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
} from "../support/virtual-fixtures.mjs";
import { demoHostImportTargets } from "../../scripts/native/demo-host-import-targets.mjs";

export async function smokeVirtualHostRuntime(context) {
  const hostDocumentState = createVirtualDocumentState();
  const hostRuntime = await createVirRuntime({
    wasmBytes: context.wasmBytes,
    irPackageSetBytes: [context.hostPackageBytes],
    virtualDocumentState: hostDocumentState,
  });
  const actualHostImportTargets = hostRuntime.interfaceManifest.hostImports
    .map((entry) => entry.target)
    .sort();
  if (
    hostRuntime.packageInfo.hostImports !== demoHostImportTargets.length ||
    JSON.stringify(actualHostImportTargets) !==
      JSON.stringify(demoHostImportTargets)
  ) {
    throw new Error(
      `unexpected stock package host imports: expected ${JSON.stringify(demoHostImportTargets)}, got ${JSON.stringify(actualHostImportTargets)}`,
    );
  }
  const hostTitle = hostRuntime.call("HostInterop.titleHandshake", "smoke");
  if (hostTitle !== "Lean VIR host: smoke") {
    throw new Error(
      `Lean to JavaScript host title: expected Lean VIR host: smoke, got ${hostTitle}`,
    );
  }

  ensureVirtualElements(hostDocumentState, ["#react-unsupported"]);
  smokeUnsupportedVirtualReact(hostRuntime);
  await smokeMissingReactSelector(context);
  smokeTamagotchiDom(hostRuntime, hostDocumentState);
}

function smokeUnsupportedVirtualReact(runtime) {
  let message = "";
  try {
    runtime.call("ReactCounter.mount", "#react-unsupported");
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  if (
    !/require.*browser React host/.test(message) ||
    runtime.liveCallbacks.size !== 0
  ) {
    throw new Error(
      `Node React provider must fail cleanup-safely: ${JSON.stringify({ message, callbacks: runtime.liveCallbacks.size })}`,
    );
  }
}

async function smokeMissingReactSelector(context) {
  const missingSelectorDocumentState = createVirtualDocumentState();
  const missingSelectorRuntime = await createVirRuntime({
    wasmBytes: context.wasmBytes,
    irPackageSetBytes: [context.hostPackageBytes],
    virtualDocumentState: missingSelectorDocumentState,
  });
  const missingReactMountCount = missingSelectorRuntime.call(
    "ReactCounter.mount",
    "#missing-react-root",
  );
  if (
    missingReactMountCount !== false ||
    missingSelectorRuntime.liveCallbacks.size !== 0
  ) {
    throw new Error(
      `Lean React missing selector failed: ${JSON.stringify({ missingReactMountCount, callbacks: missingSelectorRuntime.liveCallbacks.size })}`,
    );
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
    throw new Error(
      `Lean Tamagotchi browser step failed: ${JSON.stringify(petStep)}`,
    );
  }
  const petDomReset = hostRuntime.call("Tamagotchi.uiResetFromDom");
  const petDomRename = hostRuntime.call("Tamagotchi.uiRenameFromDom");
  const petDomStep = hostRuntime.call("Tamagotchi.uiStepFromDom", "ignore");
  hostDocumentState.elements
    .get("[data-action='ignore']")
    .listeners.get("click")?.[0]
    ?.dispatch({});
  const petEventMood = hostDocumentState.elements
    .get("#pet-device")
    .attributes.get("data-mood");
  const petEventTrace = hostDocumentState.elements
    .get("#pet-device")
    .attributes.get("data-trace");
  if (
    petDomReset.name !== "Mochi" ||
    petDomRename.name !== "Mochi" ||
    petDomReset.mood !== "happy" ||
    petDomStep.mood !== "hungry" ||
    petDomStep.trace.join(" -> ") !== "happy -> hungry" ||
    petEventMood !== "angry" ||
    petEventTrace !== "happy,hungry,angry"
  ) {
    throw new Error(
      `Lean Tamagotchi DOM-driven step failed: ${JSON.stringify({ petDomReset, petDomRename, petDomStep, petEventMood, petEventTrace })}`,
    );
  }
}
