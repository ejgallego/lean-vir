/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";

import {
  basePath,
  evaluate,
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
  await setTextareaValueAndDispatch(cdp, "#react-note-input", "hello", "input");
  await clickSelector(cdp, "#react-proof-goal-step");
  await clickSelector(cdp, "#react-checkbox-input");

  await waitForBrowserState(cdp, reactReviewStateScript(`
    state.counter === "react:1" &&
    state.input === "Ada" &&
    state.change === "Grace" &&
    state.selectTextarea === "note:hello; flavor:vanilla" &&
    state.checkbox === "checked:true" &&
    state.petMood === "happy" &&
    state.petWidgetMood === "happy" &&
    state.petDeviceMood === "happy" &&
    state.petDeviceLabel === "Octopus Octi mood happy" &&
    state.proofTitle === "Induction step" &&
    state.proofApi?.includes("Surface.goals3") &&
    state.proofApi?.includes("Hypothesis.fvarIds3 fvars") &&
    state.proofApi?.includes("Clipboard.writeTextcopy actions") &&
    state.proofApi?.includes("Command.revealPositioncursor") &&
    state.proofSurface?.includes("selectedLocationsmain") &&
    state.proofSurface?.includes("mvarIdstep")
  `), {
    timeoutMessage: "React review examples did not update",
  });
  await setSelectValueAndDispatch(cdp, "#react-flavor-select", "chocolate", "change");
  await waitForBrowserState(cdp, reactReviewStateScript(`
    state.selectTextarea === "note:hello; flavor:chocolate"
  `), {
    timeoutMessage: "React review select did not update",
  });
  await clickSelector(cdp, "#react-pet-action-ignore");

  await waitForBrowserState(cdp, reactReviewStateScript(`
    state.petMood === "hungry" &&
    state.petWidgetMood === "hungry" &&
    state.petDeviceMood === "hungry" &&
    state.petDeviceLabel === "Octopus Octi mood hungry"
  `), {
    timeoutMessage: "React Tamagotchi action did not update",
  });
  await clickSelector(cdp, "#react-pet-art-toggle");

  const reviewState = await waitForBrowserState(cdp, reactReviewStateScript(`
    state.petMood === "hungry" &&
    state.petWidgetMood === "hungry" &&
    state.petDeviceMood === "hungry" &&
    state.petDeviceLabel === "Virtual pet Mochi mood hungry" &&
    state.petArt === "pet" &&
    state.petToggleChecked === false &&
    state.proofTitle === "Induction step" &&
    state.proofApi?.includes("Hypothesis.fvarIds3 fvars") &&
    state.proofApi?.includes("Clipboard.writeTextcopy actions") &&
    state.proofApi?.includes("Command.revealPositioncursor") &&
    state.proofApi?.includes("WithRpcRef ExprWithCtxpending") &&
    state.proofSurface?.includes("mvarIdstep")
  `), {
    timeoutMessage: "React Tamagotchi toggle did not update",
  });
  assert.deepEqual(reviewState, {
    status: "Ready",
    counter: "react:1",
    input: "Ada",
    change: "Grace",
    selectTextarea: "note:hello; flavor:chocolate",
    checkbox: "checked:true",
    className: "react-attributes is-mounted",
    color: "rgb(1, 2, 3)",
    marginTop: "4px",
    petMood: "hungry",
    petWidgetMood: "hungry",
    petDeviceMood: "hungry",
    petDeviceLabel: "Virtual pet Mochi mood hungry",
    petArt: "pet",
    petToggleChecked: false,
    proofTitle: "Induction step",
    proofApi: "Surface.goals3Surface.selections1 selectionGoal.targetInduction stepHypothesis.fvarIds3 fvarsReact.onClickgoal tabsClipboard.writeTextcopy actionsCommand.revealPositioncursorWithRpcRef ExprWithCtxpending",
    proofSurface: "SelectedmainselectedLocationsmainmvarIdstepuserNamestepkindgoalfvarIds3",
  });
}

function reactReviewStateScript(condition) {
  return `(() => {
    const counterButton = document.querySelector("#react-counter-button");
    const nameInput = document.querySelector("#react-name-input");
    const changeInput = document.querySelector("#react-change-input");
    const noteInput = document.querySelector("#react-note-input");
    const flavorSelect = document.querySelector("#react-flavor-select");
    const checkbox = document.querySelector("#react-checkbox-input");
    const attributes = document.querySelector("#react-attributes-widget");
    const petWidget = document.querySelector("#react-pet-widget");
    const petDevice = document.querySelector("#react-pet-device");
    const petToggle = document.querySelector("#react-pet-art-toggle");
    const proofStepGoal = document.querySelector("#react-proof-goal-step");
    const proofApiStrip = document.querySelector("#react-proof-api-strip");
    const mountChecks = {
      counterButton: counterButton instanceof HTMLButtonElement,
      nameInput: nameInput instanceof HTMLInputElement,
      changeInput: changeInput instanceof HTMLInputElement,
      noteInput: noteInput instanceof HTMLTextAreaElement,
      flavorSelect: flavorSelect instanceof HTMLSelectElement,
      checkbox: checkbox instanceof HTMLInputElement,
      attributes: attributes instanceof HTMLElement,
      petWidget: petWidget instanceof HTMLElement,
      petDevice: petDevice instanceof HTMLElement,
      petToggle: petToggle instanceof HTMLInputElement,
      proofStepGoal: proofStepGoal instanceof HTMLButtonElement,
      proofApiStrip: proofApiStrip instanceof HTMLElement,
    };
    const missingMounts = Object.entries(mountChecks)
      .filter(([_name, present]) => !present)
      .map(([name]) => name);
    const mounted = missingMounts.length === 0;
    const state = {
      status: document.querySelector("#react-review-status")?.textContent?.trim(),
      counter: counterButton?.textContent,
      input: document.querySelector("#react-name-output")?.textContent,
      change: document.querySelector("#react-change-output")?.textContent,
      selectTextarea: document.querySelector("#react-select-textarea-output")?.textContent,
      checkbox: document.querySelector("#react-checkbox-output")?.textContent,
      className: attributes?.className,
      color: attributes?.style.color,
      marginTop: attributes?.style.marginTop,
      petMood: document.querySelector("#react-pet-mood")?.textContent,
      petWidgetMood: petWidget?.dataset.mood,
      petDeviceMood: petDevice?.dataset.mood,
      petDeviceLabel: petDevice?.getAttribute("aria-label"),
      petArt: petDevice?.dataset.art,
      petToggleChecked: petToggle instanceof HTMLInputElement ? petToggle.checked : undefined,
      proofTitle: document.querySelector("#react-proof-selected-title")?.textContent,
      proofApi: document.querySelector("#react-proof-api-strip")?.textContent,
      proofSurface: document.querySelector("#react-proof-surface-panel")?.textContent,
    };
    return {
      ready: Boolean(${condition}),
      value: state,
      mounted,
      missingMounts,
      ...state,
    };
  })()`;
}

async function setTextareaValueAndDispatch(cdp, selector, value, eventType, eventInit = { bubbles: true }) {
  return evaluate(cdp, `(() => {
    const textarea = document.querySelector(${JSON.stringify(selector)});
    if (!(textarea instanceof HTMLTextAreaElement)) {
      throw new Error(${JSON.stringify(`missing textarea element: ${selector}`)});
    }
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    if (typeof setter === "function") {
      setter.call(textarea, ${JSON.stringify(value)});
    } else {
      textarea.value = ${JSON.stringify(value)};
    }
    textarea.dispatchEvent(new Event(${JSON.stringify(eventType)}, ${JSON.stringify(eventInit)}));
    return true;
  })()`);
}

async function setSelectValueAndDispatch(cdp, selector, value, eventType, eventInit = { bubbles: true }) {
  return evaluate(cdp, `(() => {
    const select = document.querySelector(${JSON.stringify(selector)});
    if (!(select instanceof HTMLSelectElement)) {
      throw new Error(${JSON.stringify(`missing select element: ${selector}`)});
    }
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
    if (typeof setter === "function") {
      setter.call(select, ${JSON.stringify(value)});
    } else {
      select.value = ${JSON.stringify(value)};
    }
    select.dispatchEvent(new Event(${JSON.stringify(eventType)}, ${JSON.stringify(eventInit)}));
    return true;
  })()`);
}
