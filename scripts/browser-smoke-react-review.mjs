/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";

import {
  basePath,
  navigate,
  waitForReady,
} from "./browser-smoke-harness.mjs";
import {
  clickSelector,
  setInputValueAndDispatch,
  waitForBrowserState,
} from "./browser-smoke-page-actions.mjs";

export async function smokeReactReview(cdp, origin) {
  await navigate(cdp, `${origin}${basePath}react.html`);
  await waitForReady(cdp, "#react-review-status");
  await waitForBrowserState(cdp, reactReviewStateScript("mounted"), {
    timeoutMessage: "React review examples did not mount",
  });

  await clickSelector(cdp, "#react-counter-button");
  await setInputValueAndDispatch(cdp, "#react-name-input", "Ada", "input");
  await setInputValueAndDispatch(cdp, "#react-change-input", "Grace", "input", {
    bubbles: true,
    cancelable: true,
  });
  await setInputValueAndDispatch(cdp, "#react-pet-name-input", "Ada", "input");
  await clickSelector(cdp, "#react-checkbox-input");

  await waitForBrowserState(cdp, reactReviewStateScript(`
    state.counter === "react:1" &&
    state.input === "Ada" &&
    state.change === "Grace" &&
    state.checkbox === "checked:true" &&
    state.petSummary === "Ada is happy; last rename; care 3/5; turn 0"
  `), {
    timeoutMessage: "React review examples did not update",
  });
  await clickSelector(cdp, "#react-pet-action-ignore");

  await waitForBrowserState(cdp, reactReviewStateScript(`
    state.petSummary === "Ada is hungry; last ignore; care 2/5; turn 1" &&
    state.petMood === "hungry" &&
    state.petTrace === "happyhungry" &&
    state.petTraceRole === "list" &&
    state.petTraceAriaLabel === "Mood trace: happy -> hungry"
  `), {
    timeoutMessage: "React Tamagotchi action did not update",
  });
  await clickSelector(cdp, "#react-pet-art-toggle");

  const reviewState = await waitForBrowserState(cdp, reactReviewStateScript(`
    state.petSummary === "Ada is hungry; last artwork; care 2/5; turn 1" &&
    state.petArt === "pet" &&
    state.petToggleChecked === false
  `), {
    timeoutMessage: "React Tamagotchi toggle did not update",
  });
  assert.deepEqual(reviewState, {
    status: "Ready",
    counter: "react:1",
    input: "Ada",
    change: "Grace",
    checkbox: "checked:true",
    className: "react-attributes is-mounted",
    color: "rgb(1, 2, 3)",
    marginTop: "4px",
    petSummary: "Ada is hungry; last artwork; care 2/5; turn 1",
    petMood: "hungry",
    petTrace: "happyhungry",
    petTraceRole: "list",
    petTraceAriaLabel: "Mood trace: happy -> hungry",
    petArt: "pet",
    petToggleChecked: false,
  });
}

function reactReviewStateScript(condition) {
  return `(() => {
    const counterButton = document.querySelector("#react-counter-button");
    const nameInput = document.querySelector("#react-name-input");
    const changeInput = document.querySelector("#react-change-input");
    const checkbox = document.querySelector("#react-checkbox-input");
    const attributes = document.querySelector("#react-attributes-widget");
    const petNameInput = document.querySelector("#react-pet-name-input");
    const petToggle = document.querySelector("#react-pet-art-toggle");
    const mounted =
      counterButton instanceof HTMLButtonElement &&
      nameInput instanceof HTMLInputElement &&
      changeInput instanceof HTMLInputElement &&
      checkbox instanceof HTMLInputElement &&
      attributes instanceof HTMLElement &&
      petNameInput instanceof HTMLInputElement &&
      petToggle instanceof HTMLInputElement;
    const state = {
      status: document.querySelector("#react-review-status")?.textContent?.trim(),
      counter: counterButton?.textContent,
      input: document.querySelector("#react-name-output")?.textContent,
      change: document.querySelector("#react-change-output")?.textContent,
      checkbox: document.querySelector("#react-checkbox-output")?.textContent,
      className: attributes?.className,
      color: attributes?.style.color,
      marginTop: attributes?.style.marginTop,
      petSummary: document.querySelector("#react-pet-summary")?.textContent,
      petMood: document.querySelector("#react-pet-mood")?.textContent,
      petTrace: document.querySelector("#react-pet-trace")?.textContent,
      petTraceRole: document.querySelector("#react-pet-trace")?.getAttribute("role"),
      petTraceAriaLabel: document.querySelector("#react-pet-trace")?.getAttribute("aria-label"),
      petArt: document.querySelector("#react-pet-device")?.dataset.art,
      petToggleChecked: petToggle instanceof HTMLInputElement ? petToggle.checked : undefined,
    };
    return {
      ready: Boolean(${condition}),
      value: state,
      mounted,
      ...state,
    };
  })()`;
}
