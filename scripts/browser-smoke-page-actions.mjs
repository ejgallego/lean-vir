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
import { hostPackageFile } from "./browser-package-config.mjs";
import { createDomTargetScript, inputValueHelperScript } from "./browser-smoke-dom-scripts.mjs";
import { runnerCaseFromManifest, runSelectedEntry } from "./browser-smoke-dev-runner.mjs";

const defaultTimeoutMs = 5000;
const defaultPollMs = 50;

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

export async function runDemoHostEntry(cdp, origin, entryName, {
  runInputs,
  expectedResult = "true",
  target = null,
  beforeRunScript = null,
}) {
  const runnerCase = await runnerCaseFromManifest(hostPackageFile, entryName, { runInputs });
  await navigate(cdp, `${origin}${basePath}${runnerCase.url}`);
  await waitForReady(cdp);
  if (target !== null) {
    await evaluate(cdp, createDomTargetScript(target));
  }
  if (beforeRunScript !== null) {
    await evaluate(cdp, beforeRunScript);
  }
  assert.equal(await runSelectedEntry(cdp, runnerCase.expected.runInputs), expectedResult);
  return runnerCase;
}

export async function waitForBrowserState(cdp, expression, {
  timeoutMessage = "browser state did not become ready",
  timeoutMs = defaultTimeoutMs,
  pollMs = defaultPollMs,
} = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastState = null;
  while (Date.now() <= deadline) {
    lastState = await evaluate(cdp, expression);
    if (lastState?.trap) {
      throw new Error(lastState.error ?? `browser trapped: ${JSON.stringify(lastState)}`);
    }
    if (lastState?.ready) {
      return Object.hasOwn(lastState, "value") ? lastState.value : lastState;
    }
    await delay(pollMs);
  }
  throw new Error(`${timeoutMessage}; last state: ${JSON.stringify(lastState)}`);
}

export async function clickSelector(cdp, selector, { count = 1 } = {}) {
  return evaluate(cdp, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!(element instanceof HTMLElement)) {
      throw new Error(${JSON.stringify(`missing clickable element: ${selector}`)});
    }
    for (let i = 0; i < ${JSON.stringify(count)}; i += 1) {
      element.click();
    }
    return true;
  })()`);
}

export async function setInputValueAndDispatch(cdp, selector, value, eventType, eventInit = { bubbles: true }) {
  return evaluate(cdp, `(() => {
    ${inputValueHelperScript()}
    const input = document.querySelector(${JSON.stringify(selector)});
    if (!(input instanceof HTMLInputElement)) {
      throw new Error(${JSON.stringify(`missing input element: ${selector}`)});
    }
    setInputValue(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event(${JSON.stringify(eventType)}, ${JSON.stringify(eventInit)}));
    return true;
  })()`);
}

export async function waitForDocumentTitle(cdp, expectedTitle, timeoutMessage) {
  return waitForBrowserState(cdp, `(() => {
    const title = document.title;
    return {
      ready: title === ${JSON.stringify(expectedTitle)},
      value: title,
      title,
    };
  })()`, { timeoutMessage });
}

export async function waitInBrowser(cdp, timeoutMs) {
  return evaluate(cdp, `new Promise((resolve) => setTimeout(resolve, ${JSON.stringify(timeoutMs)}))`);
}
