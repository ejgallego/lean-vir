/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";

import { basePath, distAssetPath, evaluate } from "./browser-smoke-harness.mjs";
import { defaultPackageFile, hostPackageFile, wasmPublicFile } from "./browser-package-config.mjs";
import {
  clickSelector,
  runDemoHostEntry,
  setInputValueAndDispatch,
  waitForBrowserState,
  waitForDocumentTitle,
  waitInBrowser,
} from "./browser-smoke-page-actions.mjs";

function textReadyScript(selector, expectedText, trapMessage = null) {
  return `(() => {
    const text = document.querySelector(${JSON.stringify(selector)})?.textContent;
    const status = document.querySelector("#status")?.textContent?.trim();
    const trapped = status === "Trap";
    return {
      ready: text === ${JSON.stringify(expectedText)},
      trap: ${JSON.stringify(trapMessage !== null)} && trapped,
      error: trapped ? ${JSON.stringify(trapMessage)} + ": " + document.querySelector("#dev-result")?.textContent : null,
      value: { text, status },
      text,
      status,
    };
  })()`;
}

function textMatchesScript(selector, regexSource, trapMessage) {
  return `(() => {
    const text = document.querySelector(${JSON.stringify(selector)})?.textContent;
    const status = document.querySelector("#status")?.textContent?.trim();
    const trapped = status === "Trap";
    return {
      ready: new RegExp(${JSON.stringify(regexSource)}).test(text ?? ""),
      trap: trapped,
      error: trapped ? ${JSON.stringify(trapMessage)} + ": " + document.querySelector("#dev-result")?.textContent : null,
      value: { text, status },
      text,
      status,
    };
  })()`;
}

function inputMountedScript(inputSelector, outputSelector, expectedOutput) {
  return `(() => {
    const input = document.querySelector(${JSON.stringify(inputSelector)});
    const output = document.querySelector(${JSON.stringify(outputSelector)});
    const text = output?.textContent;
    return {
      ready: input instanceof HTMLInputElement && text === ${JSON.stringify(expectedOutput)},
      text,
    };
  })()`;
}

export async function smokeBrowserCallbacks(cdp, origin) {
  await runDemoHostEntry(cdp, origin, "HostInterop.mountCallbackText", {
    runInputs: ["#callback-smoke-target"],
    expectedResult: "1",
    target: {
      id: "callback-smoke-target",
      tag: "button",
      textContent: "callback:idle",
    },
  });
  await clickSelector(cdp, "#callback-smoke-target");
  const clicked = await waitForBrowserState(
    cdp,
    textReadyScript("#callback-smoke-target", "callback:clicked"),
    { timeoutMessage: "callback click did not update the DOM" },
  );
  assert.deepEqual(clicked, {
    text: "callback:clicked",
    status: "Ready",
  });

  await runDemoHostEntry(cdp, origin, "ReactCounter.mount", {
    runInputs: ["#react-smoke-root"],
    target: { id: "react-smoke-root" },
  });
  await waitForBrowserState(
    cdp,
    textReadyScript("#react-counter-button", "react:0", "React counter mount trapped"),
    { timeoutMessage: "React counter did not mount" },
  );
  await clickSelector(cdp, "#react-counter-button", { count: 2 });
  const reactClicked = await waitForBrowserState(
    cdp,
    textMatchesScript("#react-counter-button", "^react:[12]$", "React counter rapid rerender trapped"),
    { timeoutMessage: "React counter click did not rerender" },
  );
  assert.match(reactClicked.text, /^react:[12]$/);
  assert.equal(reactClicked.status, "Ready");

  await runDemoHostEntry(cdp, origin, "ReactInput.mountInput", {
    runInputs: ["#react-input-smoke-root"],
    target: { id: "react-input-smoke-root" },
  });
  await waitForBrowserState(
    cdp,
    inputMountedScript("#react-name-input", "#react-name-output", ""),
    { timeoutMessage: "React input did not mount" },
  );
  await setInputValueAndDispatch(cdp, "#react-name-input", "Ada", "input");
  const reactInputChanged = await waitForBrowserState(
    cdp,
    textReadyScript("#react-name-output", "Ada", "React input callback trapped"),
    { timeoutMessage: "React input callback did not rerender" },
  );
  assert.deepEqual(reactInputChanged, {
    text: "Ada",
    status: "Ready",
  });

  await runDemoHostEntry(cdp, origin, "ReactInput.mountChangeInput", {
    runInputs: ["#react-change-smoke-root"],
    target: { id: "react-change-smoke-root" },
  });
  await waitForBrowserState(cdp, `(() => {
    const root = document.querySelector("#react-change-smoke-root");
    const form = document.querySelector("#react-change-widget");
    return {
      ready: form instanceof HTMLFormElement && root !== null,
      hasRoot: root !== null,
      formTag: form?.tagName,
    };
  })()`, { timeoutMessage: "React submit form did not mount" });
  const reactSubmitHandled = await evaluate(cdp, `(() => {
    const form = document.querySelector("#react-change-widget");
    if (!(form instanceof HTMLFormElement)) {
      throw new Error("React submit form did not mount");
    }
    let escapedRoot = false;
    const controller = new AbortController();
    document.body.addEventListener("submit", () => {
      escapedRoot = true;
    }, { once: true, signal: controller.signal });
    const event = new Event("submit", { bubbles: true, cancelable: true });
    const allowed = form.dispatchEvent(event);
    controller.abort();
    return {
      allowed,
      escapedRoot,
      defaultPrevented: event.defaultPrevented,
      status: document.querySelector("#status")?.textContent?.trim(),
    };
  })()`);
  assert.deepEqual(reactSubmitHandled, {
    allowed: false,
    escapedRoot: false,
    defaultPrevented: true,
    status: "Ready",
  });
  await waitForBrowserState(
    cdp,
    inputMountedScript("#react-change-input", "#react-change-output", ""),
    { timeoutMessage: "React change input did not mount" },
  );
  await setInputValueAndDispatch(cdp, "#react-change-input", "Grace", "input", {
    bubbles: true,
    cancelable: true,
  });
  const reactChangeChanged = await waitForBrowserState(
    cdp,
    textReadyScript("#react-change-output", "Grace", "React change input callback trapped"),
    { timeoutMessage: "React change input callback did not rerender" },
  );
  assert.deepEqual(reactChangeChanged, {
    text: "Grace",
    status: "Ready",
  });

  await runDemoHostEntry(cdp, origin, "ReactInput.mountCheckbox", {
    runInputs: ["#react-checkbox-smoke-root"],
    target: { id: "react-checkbox-smoke-root" },
  });
  await waitForBrowserState(
    cdp,
    inputMountedScript("#react-checkbox-input", "#react-checkbox-output", "checked:false"),
    { timeoutMessage: "React checkbox did not mount" },
  );
  await clickSelector(cdp, "#react-checkbox-input");
  const reactCheckboxChanged = await waitForBrowserState(
    cdp,
    textReadyScript("#react-checkbox-output", "checked:true", "React checkbox callback trapped"),
    { timeoutMessage: "React checkbox callback did not rerender" },
  );
  assert.deepEqual(reactCheckboxChanged, {
    text: "checked:true",
    status: "Ready",
  });

  await runDemoHostEntry(cdp, origin, "ReactInput.mountAttributes", {
    runInputs: ["#react-attributes-smoke-root"],
    target: { id: "react-attributes-smoke-root" },
  });
  const reactAttributesDom = await waitForBrowserState(cdp, `(() => {
    const widget = document.querySelector("#react-attributes-widget");
    const label = document.querySelector("#react-attributes-label");
    const input = document.querySelector("#react-attributes-input");
    const output = document.querySelector("#react-attributes-output");
    const ready =
      widget instanceof HTMLElement &&
      label instanceof HTMLLabelElement &&
      input instanceof HTMLInputElement &&
      output instanceof HTMLElement;
    return {
      ready,
      value: ready ? {
        text: document.querySelector("#react-attributes-smoke-root")?.textContent,
        role: widget.getAttribute("role"),
        ariaLabel: widget.getAttribute("aria-label"),
        dataCase: widget.getAttribute("data-case"),
        dataTestId: widget.getAttribute("data-testid"),
        tabIndex: widget.tabIndex,
        className: widget.className,
        color: widget.style.color,
        marginTop: widget.style.marginTop,
        labelFor: label.htmlFor,
        inputName: input.name,
        inputType: input.type,
        checked: input.checked,
        disabled: input.disabled,
        title: output.title,
        status: document.querySelector("#status")?.textContent?.trim(),
      } : null,
      hasWidget: widget !== null,
      hasLabel: label !== null,
      hasInput: input !== null,
      hasOutput: output !== null,
    };
  })()`, { timeoutMessage: "React attributes did not mount" });
  assert.deepEqual(reactAttributesDom, {
    text: "attrs:attrs",
    role: "group",
    ariaLabel: "React attribute fixture",
    dataCase: "attributes",
    dataTestId: "react-attributes",
    tabIndex: 3,
    className: "react-attributes is-mounted",
    color: "rgb(1, 2, 3)",
    marginTop: "4px",
    labelFor: "react-attributes-input",
    inputName: "attributes",
    inputType: "checkbox",
    checked: true,
    disabled: true,
    title: "attribute output",
    status: "Ready",
  });

  await runDemoHostEntry(cdp, origin, "HostInterop.timeoutTitle", {
    runInputs: ["pages-timeout"],
    expectedResult: "1",
  });
  const timeoutTitle = await waitForDocumentTitle(
    cdp,
    "timeout:pages-timeout",
    "setTimeout callback did not update document.title",
  );
  assert.equal(timeoutTitle, "timeout:pages-timeout");

  await runDemoHostEntry(cdp, origin, "HostInterop.animationTitle", {
    runInputs: ["pages-frame"],
    expectedResult: "1",
  });
  const frameTitle = await waitForDocumentTitle(
    cdp,
    "frame:pages-frame",
    "requestAnimationFrame callback did not update document.title",
  );
  assert.equal(frameTitle, "frame:pages-frame");
}

export async function smokeBrowserCallbackCleanup(cdp, origin) {
  await runDemoHostEntry(cdp, origin, "HostInterop.mountAndRemoveCallbackText", {
    runInputs: ["#callback-removed-target"],
    expectedResult: "1",
    target: {
      id: "callback-removed-target",
      tag: "button",
      textContent: "callback:removed-idle",
    },
  });
  await clickSelector(cdp, "#callback-removed-target");
  await waitInBrowser(cdp, 100);
  const removed = await evaluate(cdp, `({
    text: document.querySelector("#callback-removed-target")?.textContent,
    status: document.querySelector("#status")?.textContent?.trim(),
  })`);
  assert.deepEqual(removed, {
    text: "callback:removed-idle",
    status: "Ready",
  });

  await runDemoHostEntry(cdp, origin, "HostInterop.clearTimeoutTitle", {
    runInputs: ["cancelled-timeout"],
    expectedResult: "1",
    beforeRunScript: `document.title = "timeout:cancelled-sentinel"`,
  });
  await waitInBrowser(cdp, 120);
  const clearTimeoutTitle = await evaluate(cdp, "document.title");
  assert.equal(clearTimeoutTitle, "timeout:cancelled-sentinel");

  await runDemoHostEntry(cdp, origin, "HostInterop.cancelAnimationTitle", {
    runInputs: ["cancelled-frame"],
    expectedResult: "1",
    beforeRunScript: `document.title = "frame:cancelled-sentinel"`,
  });
  await waitInBrowser(cdp, 120);
  const cancelFrameTitle = await evaluate(cdp, "document.title");
  assert.equal(cancelFrameTitle, "frame:cancelled-sentinel");

  await runDemoHostEntry(cdp, origin, "HostInterop.mountCallbackText", {
    runInputs: ["#callback-reload-target"],
    expectedResult: "1",
    target: {
      id: "callback-reload-target",
      tag: "button",
      textContent: "callback:reload-idle",
    },
  });
  await evaluate(cdp, `(() => {
    const preset = document.querySelector("#dev-package-preset");
    if (!(preset instanceof HTMLSelectElement)) {
      throw new Error("package preset selector is missing");
    }
    preset.value = ${JSON.stringify(defaultPackageFile)};
    preset.dispatchEvent(new Event("change", { bubbles: true }));
  })()`);
  const reloadedState = await waitForBrowserState(cdp, `(() => {
    const state = {
      status: document.querySelector("#status")?.textContent?.trim(),
      packageName: document.querySelector("#dev-package-name")?.textContent?.trim(),
    };
    return {
      ready: state.status === "Ready" && state.packageName === ${JSON.stringify(defaultPackageFile)},
      value: state,
      ...state,
    };
  })()`, { timeoutMessage: `package preset did not reload ${defaultPackageFile}` });
  await clickSelector(cdp, "#callback-reload-target");
  await waitInBrowser(cdp, 100);
  const reloaded = {
    ...reloadedState,
    text: await evaluate(cdp, `document.querySelector("#callback-reload-target")?.textContent`),
  };
  assert.deepEqual(reloaded, {
    status: "Ready",
    packageName: defaultPackageFile,
    text: "callback:reload-idle",
  });

  const runtimeAsset = await distAssetPath("vir-runtime-");
  const disposed = await evaluate(cdp, `new Promise(async (resolve, reject) => {
    try {
      const runtimeModule = await import(${JSON.stringify(`${origin}${basePath}${runtimeAsset}`)});
      const createVirRuntime = runtimeModule.createVirRuntime ??
        Object.values(runtimeModule).find((value) =>
          typeof value === "function" && String(value).includes("irPackageUrl"));
      if (typeof createVirRuntime !== "function") {
        throw new Error("built runtime asset does not expose createVirRuntime");
      }
      const runtime = await createVirRuntime({
        wasmUrl: ${JSON.stringify(`${origin}${basePath}${wasmPublicFile}`)},
        irPackageUrl: ${JSON.stringify(`${origin}${basePath}${hostPackageFile}`)},
      });
      document.title = "dispose:sentinel";
      document.querySelector("#callback-dispose-target")?.remove();
      const target = document.createElement("button");
      target.id = "callback-dispose-target";
      target.textContent = "callback:dispose-idle";
      document.body.append(target);
      runtime.call("HostInterop.mountCallbackText", "#callback-dispose-target");
      runtime.call("HostInterop.delayedTimeoutTitle", "dispose-timeout");
      runtime.call("HostInterop.animationTitle", "dispose-frame");
      runtime.dispose();
      target.click();
      setTimeout(() => resolve({
        text: target.textContent,
        title: document.title,
      }), 160);
    } catch (error) {
      reject(error);
    }
  })`);
  assert.deepEqual(disposed, {
    text: "callback:dispose-idle",
    title: "dispose:sentinel",
  });
}
