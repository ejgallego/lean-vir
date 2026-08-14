/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";

import { basePath, navigate, waitForReady } from "./harness.mjs";
import { clickSelector, waitForBrowserState } from "./page-actions.mjs";

export async function smokeReactTamagotchi(cdp, origin) {
  await navigate(cdp, `${origin}${basePath}react.html`);
  await waitForReady(cdp, "#react-status");
  await waitForBrowserState(cdp, reactStateScript("mounted"), {
    timeoutMessage: "React Tamagotchi did not mount",
  });

  await clickSelector(cdp, "#react-pet-action-ignore");
  await waitForBrowserState(cdp, reactStateScript(`
    state.mood === "hungry" &&
    state.widgetMood === "hungry" &&
    state.deviceLabel === "Octopus Octi mood hungry"
  `), {
    timeoutMessage: "React Tamagotchi action did not update",
  });

  await clickSelector(cdp, "#react-pet-art-toggle");
  const state = await waitForBrowserState(cdp, reactStateScript(`
    state.mood === "hungry" &&
    state.widgetMood === "hungry" &&
    state.deviceLabel === "Virtual pet Mochi mood hungry" &&
    state.art === "pet" &&
    state.toggleChecked === false
  `), {
    timeoutMessage: "React Tamagotchi view toggle did not update",
  });

  assert.deepEqual(state, {
    status: "Ready",
    mood: "hungry",
    widgetMood: "hungry",
    deviceMood: "hungry",
    deviceLabel: "Virtual pet Mochi mood hungry",
    art: "pet",
    toggleChecked: false,
  });
}

function reactStateScript(condition) {
  return `(() => {
    const widget = document.querySelector("#react-pet-widget");
    const device = document.querySelector("#react-pet-device");
    const toggle = document.querySelector("#react-pet-art-toggle");
    const mounted = widget instanceof HTMLElement
      && device instanceof HTMLElement
      && toggle instanceof HTMLInputElement;
    const state = {
      status: document.querySelector("#react-status")?.textContent?.trim(),
      mood: document.querySelector("#react-pet-mood")?.textContent,
      widgetMood: widget?.dataset.mood,
      deviceMood: device?.dataset.mood,
      deviceLabel: device?.getAttribute("aria-label"),
      art: device?.dataset.art,
      toggleChecked: toggle instanceof HTMLInputElement ? toggle.checked : undefined,
    };
    return {
      ready: Boolean(${condition}),
      value: state,
      mounted,
      ...state,
    };
  })()`;
}
